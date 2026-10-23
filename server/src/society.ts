/**
 * The village clock (G1, PLAN E.2, #26): a code-kept day of MC_DAY_MIN minutes (memory.ts' clockOf) with four windows,
 * dawn, day, dusk and night, each member acting at its own offset inside a window. World-free: the world calls tick()
 * from its 30 s sweep with the members present; everything else reads the clock on demand.
 *
 * - Dawn: a member's first model decision of the day sets its intention for the day (choose.ts), unless the night's
 *   reflection set one already.
 * - Day: decisions as before.
 * - Dusk: a hook (onDusk) for E.6's ballots; logged only.
 * - Night: code writes each member's day line and the village's (memory.ts), then each member with chores that day makes
 *   one reflection call at its own offset (the user's choice, 10-21): up to 2 notes to keep (replacing old ones by id) and
 *   its intention for tomorrow. E.6 extends this call (profiles, proposals, endorsements).
 * Bodies keep working through every window.
 */
import type { ToolDef } from './world';
import { callModel, parseSpec, type ModelSpec } from './modelCall';
import { usage, isCloudModel, REASONING } from './modelUsage';
import { CHOOSE } from './choose';
import { SOCIAL, memberSocial, profileLine, roleLine, type Profile } from './social';
import { PROPOSALS_ON, addProposal, allProposals, endorse, parsePropose, proposeLine, withPropose, type CheckCtx, type Proposal } from './proposals';
import { refusedSince } from './acts';
import { addLaw, backLaw, classOf, lawFrom, laws, putClassOf, rulesInForce, type Law } from './rules';
import { councilOn, councilTick } from './council';
import {
  FOCUS, MEMORY, agentMemory, applyWrites, clockOf, closeAgentDays, closeVillageDays, liveNotes, logAct, offsetIn, recordLine, scrub, villageLineShown, villageMemory,
  type Phase,
} from './memory';

export interface Member {
  name: string;
  /** The persona line its chore menus show ('' when none). */
  persona: string;
  /** memory.chooseModel / execModel, else the chooser's model. */
  model?: string;
}

const duskHooks: Array<(village: string, day: number) => void> = [];
/** E.6's ballots hang here. */
export function onDusk(fn: (village: string, day: number) => void): void {
  duskHooks.push(fn);
}

/** Reflections in flight, by village|agent (one at a time per member). */
const reflecting = new Set<string>();

/** Injected in tests. */
let call: typeof callModel = callModel;
export function setReflectCall(fn: typeof callModel): void {
  call = fn;
}

/**
 * The clock's sweep (the world's 30 s sweep): phase changes logged, dusk hooks run, and at night each member's day line,
 * the village's, and the members' reflections at their offsets. Never throws.
 */
export function tick(now: number, villages: Array<{ name: string; members: Member[] }>): void {
  if (!MEMORY.clock) return;
  for (const { name: village, members } of villages) {
    try {
      const c = clockOf(village, now);
      const v = villageMemory(village);
      if (!c || !v) continue;
      const tag = `${c.day}:${c.phase}`;
      if (v.phase !== tag) {
        v.phase = tag;
        logAct({ type: 'clock', village, run: v.run, day: c.day, phase: c.phase });
        console.log(`[clock] ${village}: day ${c.day}, ${c.phase}`);
        if (c.phase === 'dusk') for (const fn of duskHooks) {
          try {
            fn(village, c.day);
          } catch (e) {
            console.log(`[clock] a dusk hook failed: ${String((e as Error)?.message ?? e)}`);
          }
        }
      }
      // (G3, MC_COUNCIL: the agenda, the dusk ballots and the count)
      councilTick(village, members, now);
      // (days that ended while the server was down: closed without reflections)
      closeVillageDays(village, c.phase === 'night' ? c.day : c.day - 1);
      for (const m of members) {
        const a = agentMemory(village, m.name);
        if (!a) continue;
        const due = c.phase === 'night' && c.frac >= offsetIn(m.name, 'night');
        if (a.nightDone < c.day - 1) closeAgentDays(village, m.name, c.day - 1);
        if (!due || a.nightDone >= c.day) continue;
        const had = a.log.some((e) => e.day === c.day && !e.cut);
        closeAgentDays(village, m.name, c.day);
        if (had && MEMORY.reflect && CHOOSE.mode !== 'scripted') void reflect(village, m, c.day, now);
        // (G5, the scripted controller: a proposal from a script on a fixed night, so staged runs exercise the store,
        // triage and the answers without models)
        if (had && PROPOSALS_ON && CHOOSE.mode === 'scripted') scriptedProposal(village, m.name, c.day);
        if (had && councilOn() && CHOOSE.mode === 'scripted') scriptedLaw(village, m.name, c.day, now);
      }
    } catch (e) {
      console.log(`[clock] ${village}: ${String((e as Error)?.stack ?? e).slice(0, 300)}`);
    }
  }
}

/** G2 (MCAI_SOCIAL=on): the profiles a member dealt with today (met, helped, owed or heard about), at most 5, most recent. */
function touched(village: string, agent: string, dayStart: number): Profile[] {
  const ps = Object.values(memberSocial(village, agent).profiles ?? {});
  const deal = (p: Profile) => p.helped + p.helpedBy + p.kept + p.broke + (p.heardKept ?? 0) + (p.heardBroke ?? 0);
  return ps.filter((p) => p.lastMet >= dayStart || deal(p) > 0).sort((x, y) => y.lastMet - x.lastMet || deal(y) - deal(x)).slice(0, 5);
}

/** G5 (#90): what the village can do, for code's check of a proposal (the world's, registered at its start). */
let proposalCtx: ((village: string) => CheckCtx | null) | null = null;
export function setProposalCtx(fn: (village: string) => CheckCtx | null): void {
  proposalCtx = fn;
}

/** G5 (MC_PROPOSALS): others' open proposals a member may back, and whether its day gave it a reason to propose (a failed
 *  chore, a refused request) or to back one. */
function proposing(village: string, agent: string, day: number, dayMs: number, now: number): { others: Proposal[]; reason: boolean } | null {
  if (!PROPOSALS_ON) return null;
  const a = agentMemory(village, agent);
  const failed = (a?.log ?? []).some((e) => e.day === day && !e.ok && !e.cut);
  const refused = refusedSince(village, agent, now - dayMs) > 0;
  const others = allProposals(village).filter((p) => p.by !== agent && (p.status === 'open' || p.status === 'endorsed'));
  return failed || refused || others.length ? { others, reason: failed || refused } : null;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const REFLECT_SYSTEM ='You are a member of a Minecraft village. Night has come in the village and you look back on your day. '
  + 'Keep only what will help you choose well on later days, in your own words, and say what you mean to do tomorrow. '
  + 'Call `reflect` once.';

/** The night's prompt (pure: memorybench rebuilds it). */
export function reflectPrompt(village: string, m: Member, day: number, now: number): { system: string; user: string; tools: ToolDef[] } | null {
  const a = agentMemory(village, m.name);
  if (!a) return null;
  const v = villageMemory(village);
  const live = liveNotes(a);
  const todayLog = a.log.filter((e) => e.day === day && !e.cut).slice(-12);
  const lines: string[] = [];
  if (m.persona.trim()) lines.push(m.persona.trim());
  lines.push(`Day ${day} in ${village} is ending (a village day is ${Math.round((v?.dayMs ?? MEMORY.dayMs) / 60000)} minutes).`);
  if (a.today?.day === day) lines.push(`Your intention for today was: ${a.today.text}`);
  lines.push(`Your chores today:\n${todayLog.map((e) => `- ${e.line}${!e.ok && e.msg ? ` (${e.msg})` : ''}`).join('\n') || '- none'}`);
  const rec = recordLine(a);
  if (rec) lines.push(`Your record so far: ${rec}.`);
  if (a.days.length > 1) lines.push(`Earlier days: ${a.days.slice(-4, -1).map((d) => d.line).join(' ')}`);
  const vd = villageLineShown() ? v?.days.find((d) => d.day === day) : undefined;
  if (vd) lines.push(`The village today: ${vd.line}`);
  // (G2, MCAI_SOCIAL=on: the members it dealt with, as code keeps them, each open to a feeling and a short note)
  const people = SOCIAL.mode === 'on' ? touched(village, m.name, now - (v?.dayMs ?? MEMORY.dayMs)) : [];
  if (people.length) lines.push(`Members you dealt with (what you saw and were told, kept for you):\n${people.map((p) => profileLine(p, now)).join('\n')}`);
  const role = roleLine(village, m.name);
  if (role) lines.push(role);
  lines.push(live.length ? `Your notes (${live.length} of ${MEMORY.notes}${live.length >= MEMORY.notes ? ', full: a new note must replace one' : ''}):\n${live.map((n) => `- [${n.id}, day ${n.day}] ${n.text}`).join('\n')}` : 'Your notes: none yet.');
  lines.push('Call reflect with up to 2 notes worth keeping for later days (a lesson from what worked or failed and why, a plan, '
    + 'something about the village or another member; not the counts above, which are kept for you), each replacing one of '
    + 'your notes by its id when it corrects or outdates it, your intention for tomorrow in one sentence, and its focus, the kind '
    + `of work you mean to do most: one of ${FOCUS.join(', ')}.`);
  // (G3, MC_COUNCIL: the rules in force, others' open laws to back, and a law of its own)
  // (the user's, 10-23: the laws waiting for backing come first, most backed first, so a member backs the rule it means
  // rather than writing it again; the same rule proposed again joins the open one in code)
  // (only laws still short of the 2 backers: one that has them is on the next ballot, and more backing only piles on, the
  // review's 6)
  const openLaws = councilOn() ? laws(village).filter((l) => l.by !== m.name && l.status === 'open' && !l.backers.includes(m.name) && !l.opposers.includes(m.name) && l.backers.length - l.opposers.length < 2)
    .sort((x, y) => y.backers.length - x.backers.length || x.at - y.at).slice(0, 3) : [];
  if (councilOn()) lines.push(lawLines(rulesInForce(village).map((r) => r.text), openLaws));
  // (G5, MC_PROPOSALS: the propose field on nights the day gave a reason, others' open proposals to back)
  const pr = proposing(village, m.name, day, v?.dayMs ?? MEMORY.dayMs, now);
  if (pr) lines.push(proposeLine(pr.others));
  const tools = reflectTools({ live: live.map((n) => n.id), people: people.map((p) => p.of), openLaws: councilOn() ? openLaws.map((l) => l.id) : null, propose: pr ? pr.others.slice(0, 3).map((p) => p.id) : null });
  return { system: REFLECT_SYSTEM, user: scrub(village, m.name, lines.join('\n\n')), tools };
}

/** The night prompt's council paragraph (pure: rulebench puts it into recorded prompts): the rules in force, the open laws
 *  to back (most backed first) and the invitation to propose one, in the shapes code reads. */
export function lawLines(inForce: string[], openLaws: Array<Pick<Law, 'id' | 'text' | 'backers'>>): string {
  return [
    inForce.length ? `Village rules in force: ${inForce.join('; ')}.` : 'The village has no rules yet.',
    ...(openLaws.length ? [`Rules members proposed, waiting for backing (back or oppose up to 2 with \`back_laws\`; a rule backed by 2 others goes to the next dusk's secret vote):\n${openLaws.map((l) => `- [${l.id}] ${capital(l.text)} (backed by ${l.backers.length})`).join('\n')}`] : []),
    // (lawbench, 10-23: a template of sentences narrowed the laws to one type, 29 of 33; the kinds in prose keep their spread)
    `You may propose one village rule (\`law\`, one sentence) if your day showed a need for it${openLaws.length ? ' and none above says it' : ''}: a daily quota on tools, logs or torches taken from storage, a minimum storage keeps of an item, an amount of something each member puts into storage a day, a duty every member does once a day, a levy on members' shares, a place kept free of building, or a custom in words. Most nights there is none.`,
  ].join('\n');
}

/** The reflect tool for a night (pure:rulebench rebuilds it from a recorded prompt): the note ids it may replace or keep,
 *  the members it may write profiles of, the council's fields (open laws' ids, or null with the council off) and G5's. */
export function reflectTools(o: { live: string[]; people: string[]; openLaws: string[] | null; propose: string[] | null }): ToolDef[] {
  const tools: ToolDef[] = [{
    name: 'reflect',
    description: 'Keep up to 2 notes and set your intention for tomorrow.',
    input_schema: {
      type: 'object',
      properties: {
        notes: {
          type: 'array', maxItems: 2, description: 'Notes to keep (may be empty).',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', maxLength: 160, description: 'The note, one sentence.' },
              ...(o.live.length ? { replaces: { type: 'string', enum: o.live, description: 'The id of a note this one replaces.' } } : {}),
            },
            required: ['text'],
          },
        },
        // (#86, MC_MEMORY_QUALITY: gpt-oss answered the notes with ids of notes to keep, F273; a place for them)
        ...(MEMORY.quality && o.live.length ? { keep: { type: 'array', items: { type: 'string', enum: o.live }, description: 'Optional: ids of notes you keep as they are (kept notes need no new text).' } } : {}),
        intention: { type: 'string', maxLength: 200, description: 'What you mean to do tomorrow and why, one sentence.' },
        focus: { type: 'string', enum: FOCUS, description: 'The kind of work you mean to do most tomorrow.' },
        ...(o.people.length ? {
          profiles: {
            type: 'array', maxItems: 3, description: 'Optional: up to 3 members above, how you feel about them and a short note (12 words at most).',
            items: { type: 'object', properties: { member: { type: 'string', enum: o.people }, feel: { type: 'integer', minimum: -2, maximum: 2 }, note: { type: 'string', maxLength: 90 } }, required: ['member'] },
          },
        } : {}),
      },
      required: ['notes', 'intention', 'focus'],
    },
  }];
  if (o.openLaws) {
    const sch = tools[0].input_schema as { properties: Record<string, unknown> };
    sch.properties.law = { type: 'object', description: 'Optional, and rare: a village rule you propose.', properties: { what: { type: 'string', maxLength: 140, description: 'The rule, one sentence.' }, why: { type: 'string', maxLength: 200 } }, required: ['what'] };
    if (o.openLaws.length) sch.properties.back_laws = { type: 'array', maxItems: 2, items: { type: 'object', properties: { id: { type: 'string', enum: o.openLaws }, oppose: { type: 'boolean' } }, required: ['id'] } };
  }
  if (!o.propose) return tools;
  const withP = withPropose(tools);
  if (o.propose.length) {
    const sch = withP[0].input_schema as { properties: Record<string, unknown> };
    sch.properties.back = { type: 'array', maxItems: 2, description: "Optional: others' proposals you back (or oppose) because your own day met the same need.", items: { type: 'object', properties: { id: { type: 'string', enum: o.propose }, oppose: { type: 'boolean' } }, required: ['id'] } };
  }
  return withP;
}

/** The reply's notes and intention, from the reflect call's input (arguments written as strings normalised). With `quality`
 *  (#86), notes that are only an id ("n3") and the `keep` field are read as keeps, before the 2-note cut. */
export function parseReflect(input: unknown, quality = false): { notes: Array<{ text: string; replaces?: string }>; intention: string; focus?: string; keep?: string[] } | null {
  let o = input as Record<string, unknown> | string | null;
  if (typeof o === 'string') {
    try { o = JSON.parse(o) as Record<string, unknown>; } catch { return null; }
  }
  if (!o || typeof o !== 'object') return null;
  for (const k of ['arguments', 'parameters', 'input']) if (o[k] && !('intention' in o)) return parseReflect(o[k], quality);
  let notes = o.notes as unknown;
  if (typeof notes === 'string') {
    const raw = notes;
    try { notes = JSON.parse(raw); } catch { notes = raw.trim() ? [{ text: raw }] : []; }
  }
  const ID = /^\s*\[?(n\d+)\]?\s*$/i;
  const keep = quality ? [...(Array.isArray(o.keep) ? o.keep : []), ...(Array.isArray(notes) ? notes : [])]
    .map((n) => (typeof n === 'string' ? n : typeof (n as { text?: unknown })?.text === 'string' ? String((n as { text: string }).text) : ''))
    .map((t) => ID.exec(t)?.[1]?.toLowerCase()).filter((x): x is string => !!x) : [];
  // (#90: gpt-oss sends notes as {content, id}, {content, replace}, {id, text}: content and note read as text, replace and an
  // id as replaces; applyWrites replaces only a live note's id)
  const asNote = (n: unknown): { text?: unknown; replaces?: unknown } => {
    if (typeof n === 'string') return { text: n };
    const r = (n ?? {}) as Record<string, unknown>;
    return { text: r.text ?? r.content ?? r.note, replaces: r.replaces ?? r.replace ?? r.id };
  };
  const list = (Array.isArray(notes) ? notes : []).map(asNote)
    .filter((n) => typeof n?.text === 'string' && n.text.trim() && !(quality && ID.test(n.text)))
    .slice(0, 2).map((n) => ({ text: String(n.text), ...(typeof n.replaces === 'string' && n.replaces ? { replaces: n.replaces } : {}) }));
  const intention = typeof o.intention === 'string' ? o.intention : '';
  return { notes: list, intention, ...(typeof o.focus === 'string' ? { focus: o.focus } : {}), ...(keep.length ? { keep: [...new Set(keep)] } : {}) };
}

async function reflect(village: string, m: Member, day: number, now: number): Promise<void> {
  const k = `${village.toLowerCase()}|${m.name.toLowerCase()}`;
  if (reflecting.has(k)) return;
  const spec: ModelSpec | null = parseSpec(m.model ?? CHOOSE.model);
  if (!spec) return;
  if ((isCloudModel(spec.model) && !usage.allows('reflection')) || usage.blocked(spec.model, m.name)) {
    logAct({ type: 'reflect', village, agent: m.name, day, skipped: 'budget' });
    return;
  }
  const p = reflectPrompt(village, m, day, now);
  if (!p) return;
  reflecting.add(k);
  const t0 = Date.now();
  try {
    const r = await call({ spec, system: p.system, user: p.user, tools: p.tools, level: REASONING.reflect, agent: m.name, kind: 'reflect', priority: 'reflection' });
    const c = r.reply.calls.find((x) => x.name === 'reflect') ?? r.reply.calls[0];
    const got = c ? parseReflect(c.input, MEMORY.quality) : parseReflect(r.reply.text.slice(r.reply.text.indexOf('{'), r.reply.text.lastIndexOf('}') + 1), MEMORY.quality);
    const done: string[] = [];
    for (const n of got?.notes ?? []) done.push(...applyWrites(village, m.name, { remember: n.text, replaces: n.replaces }, 'night', Date.now(), `night:${day}`));
    if (got?.intention) done.push(...applyWrites(village, m.name, { intention: got.intention, focus: got.focus }, 'night', Date.now(), `night:${day}`));
    // (G2: up to 3 profile edits, the model's only fields in a profile: a feeling and a note of 12 words at most)
    if (SOCIAL.mode === 'on') done.push(...applyProfileEdits(village, m.name, (c?.input ?? null), day));
    // (G5, MC_PROPOSALS: a proposal into the store, checked by code; backing others' where the member's day touched them)
    if (PROPOSALS_ON) done.push(...applyProposal(village, m.name, c?.input ?? null, day));
    // (G3, MC_COUNCIL: a law and backing others' laws)
    if (councilOn()) done.push(...applyLaws(village, m.name, c?.input ?? null, day, Date.now()));
    logAct({ type: 'reflect', village, agent: m.name, day, system: p.system, prompt: p.user, reply: got ?? { text: r.reply.text.slice(0, 400) }, done, ms: r.ms, waitMs: r.waitMs, promptTokens: r.reply.promptTokens, outputTokens: r.reply.outputTokens });
    console.log(`[reflect] ${village}: ${m.name} day ${day}: ${done.join(', ') || 'nothing kept'}${got?.intention ? `; tomorrow: ${got.intention.slice(0, 100)}` : ''}`);
  } catch (e) {
    logAct({ type: 'reflect', village, agent: m.name, day, error: String((e as Error)?.message ?? e).slice(0, 200), ms: Date.now() - t0 });
    console.log(`[reflect] ${village}: ${m.name} day ${day}: the call failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
  } finally {
    reflecting.delete(k);
  }
}

/** G5's scripted proposals: one member in eight proposes on day 1 (by a hash of its name), one in four backs the first open
 *  proposal on later nights (its day's touch not required: the plumbing's test). */
const SCRIPTED = [
  { kind: 'item', what: 'Make a smithing table for better tools', why: 'our tools wear out' },
  { kind: 'work', what: 'Build a fishing dock by the water for the fishers', why: 'fishing keeps us fed' },
  { kind: 'activity', what: 'Let us collect honey from bee nests', why: 'we have no sweet food' },
];
function scriptedProposal(village: string, agent: string, day: number): void {
  const h = [...`${agent}|${day}`].reduce((x, ch) => (Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0), 2166136261);
  const ctx = proposalCtx?.(village) ?? null;
  if (!ctx) return;
  if (day === 1 && h % 8 === 0) {
    const s = SCRIPTED[h % SCRIPTED.length];
    const got = addProposal({ village, by: agent, kind: s.kind, what: s.what, why: s.why, day, source: 'scripted' }, ctx);
    if (got) logAct({ type: 'proposal', village, agent, id: got.id, kind: got.kind, what: got.what, status: got.status, check: got.check.verdict, reason: got.check.reason, day, scripted: true });
  } else if (day > 1 && h % 4 === 0) {
    const first = allProposals(village).find((p) => p.by !== agent && (p.status === 'open' || p.status === 'endorsed'));
    if (first && endorse(first.id, agent)) logAct({ type: 'proposal', village, agent, back: first.id, counted: true, scripted: true });
  }
}

/** G3's scripted laws (the plumbing's test without models): on night 1 every member proposes one of four rules by a hash
 *  of its name, in Long1's words (a quota, a contribution, a duty and a floor), so the same rule proposed again joins the
 *  open one; on later nights one in three backs the first open law. */
const SCRIPTED_LAWS = [
  { dailyLogQuota: 'Each member may take up to 4 logs from storage per day.' },
  { 'each member puts at least 2 torches into storage each day': true },
  { what: 'Each villager must light at least one unlit spot each day.' },
  // (a floor on cobblestone, not torches: a torch floor would take the lighting duty's options away, the review's 7)
  { stone_minimum: { item: 'cobblestone', minimum: 16 } },
];
export function scriptedLaw(village: string, agent: string, day: number, now: number): void {
  const h = [...`law|${agent}|${day}`].reduce((x, ch) => (Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0), 2166136261);
  if (day === 1) {
    const lw = lawFrom(SCRIPTED_LAWS[h % SCRIPTED_LAWS.length]);
    if (lw) addLaw(village, agent, lw, now);
  } else if (h % 3 === 0) {
    const first = laws(village).find((l) => l.by !== agent && l.status === 'open');
    if (first) backLaw(village, first.id, agent);
  }
}

/** G3: the night's law and backing from the reflect call's input; backing counts only where the member's own day touched
 *  the law's target (its quota class, floor item or duty kind; for a custom, two of its words). */
export function applyLaws(village: string, agent: string, input: unknown, day: number, now: number): string[] {
  const done: string[] = [];
  let o = input as Record<string, unknown> | string | null;
  if (typeof o === 'string') {
    try { o = JSON.parse(o) as Record<string, unknown>; } catch { return done; }
  }
  if (!o || typeof o !== 'object') return done;
  const rec = o as Record<string, unknown>;
  // (any shape gpt-oss writes: {what}, a sentence, or the rule under its own key, Long1's 238 of 238; rules.ts lawFrom)
  const lw = lawFrom(rec.law ?? rec.rule);
  if (lw) {
    const l = addLaw(village, agent, lw, now);
    done.push(`law ${l.id}${l.refused ? ` refused (${l.refused})` : l.by !== agent ? ' joined' : ''}`);
  }
  const a = agentMemory(village, agent);
  const words = (a?.log ?? []).filter((e) => e.day === day).map((e) => `${e.name} ${e.line}`.toLowerCase()).join(' ');
  const touches = (l: Law) => {
    if (l.type === 'quota') return [...words.matchAll(/[a-z_]+/g)].some((w) => classOf(w[0]) === l.params.class) || words.includes(String(l.params.class).replace(/s$/, ''));
    if (l.type === 'floor') return l.params.class !== undefined ? [...words.matchAll(/[a-z_]+/g)].some((w) => (putClassOf(w[0]) ?? '') === l.params.class) || words.includes(String(l.params.class).replace(/s$/, '')) : words.includes(String(l.params.item).replace(/_/g, ' '));
    if (l.type === 'duty') return words.includes(String(l.params.kind));
    // (a contribution: any day that put goods of its class in storage, or any goods; every member's chores touch storage)
    if (l.type === 'contribute') return l.params.class === 'goods' || [...words.matchAll(/[a-z_]+/g)].some((w) => putClassOf(w[0]) === l.params.class) || words.includes(String(l.params.class).replace(/s$/, ''));
    return String(l.text).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && words.includes(w)).length >= 2;
  };
  const backs = Array.isArray(rec.back_laws) ? (rec.back_laws as unknown[]).slice(0, 2) : [];
  for (const b of backs) {
    const id = typeof b === 'string' ? b : String((b as { id?: unknown })?.id ?? '');
    const l = laws(village).find((x) => x.id === id);
    if (!l) continue;
    if (!touches(l)) {
      logAct({ type: 'law', village, agent, id, op: 'back', counted: false, why: 'its day did not touch it' });
      continue;
    }
    const oppose = (b as { oppose?: unknown })?.oppose === true;
    if (backLaw(village, id, agent, oppose)) done.push(`${oppose ? 'opposed' : 'backed'} ${id}`);
  }
  return done;
}

/** G5 (#90): the night's proposal and backing from the reflect call's input. A proposal is checked by code (the world's
 *  context) and stored; backing counts only where the member's own day named the target (an item, the failing chore). */
export function applyProposal(village: string, agent: string, input: unknown, day: number): string[] {
  const done: string[] = [];
  let o = input as Record<string, unknown> | string | null;
  if (typeof o === 'string') {
    try { o = JSON.parse(o) as Record<string, unknown>; } catch { return done; }
  }
  const p = parsePropose(o);
  const ctx = proposalCtx?.(village) ?? null;
  const a = agentMemory(village, agent);
  const today = (a?.log ?? []).filter((e) => e.day === day);
  if (p && ctx) {
    const evidence = p.evidence.map((ref) => ({ ref, text: liveNotes(a).find((n) => n.id === ref)?.text ?? today.find((e) => ref.includes(e.name))?.line ?? '' }));
    // (the day's failures as evidence of a fix, by code)
    for (const e of today.filter((x) => !x.ok && !x.cut).slice(0, 3)) evidence.push({ ref: `fail:${e.name}`, text: e.msg ?? '' });
    const got = addProposal({ village, by: agent, kind: p.kind, what: p.what, why: p.why, evidence, day }, ctx);
    if (got) {
      logAct({ type: 'proposal', village, agent, id: got.id, kind: got.kind, what: got.what, why: got.why, status: got.status, check: got.check.verdict, reason: got.check.reason, day });
      done.push(`proposed ${got.id} (${got.check.verdict})`);
    }
  }
  const backs = o && typeof o === 'object' && Array.isArray((o as Record<string, unknown>).back) ? ((o as Record<string, unknown>).back as unknown[]).slice(0, 2) : [];
  const words = today.map((e) => `${e.name} ${e.line} ${e.msg ?? ''}`.toLowerCase()).join(' ');
  for (const b of backs) {
    const id = typeof b === 'string' ? b : typeof (b as { id?: unknown })?.id === 'string' ? String((b as { id: string }).id) : '';
    const target = allProposals(village).find((q) => q.id === id);
    if (!target) continue;
    const t = target.target;
    const touched = [...(t.items ?? []).map((x) => x.replace(/_/g, ' ')), t.failure?.toLowerCase(), t.work?.replace(/_/g, ' '), t.capability?.replace(/_/g, ' ')].some((w) => !!w && words.includes(w));
    if (!touched) {
      logAct({ type: 'proposal', village, agent, back: id, counted: false, why: 'its day did not touch it' });
      continue;
    }
    const oppose = (b as { oppose?: unknown })?.oppose === true;
    if (endorse(id, agent, Date.now(), oppose)) {
      logAct({ type: 'proposal', village, agent, back: id, oppose, counted: true });
      done.push(`${oppose ? 'opposed' : 'backed'} ${id}`);
    }
  }
  return done;
}

/** G2: the night's profile edits from the reflect call's input (at most 3; members the member has a profile of). */
export function applyProfileEdits(village: string, agent: string, input: unknown, day: number): string[] {
  let o = input as Record<string, unknown> | string | null;
  if (typeof o === 'string') {
    try { o = JSON.parse(o) as Record<string, unknown>; } catch { return []; }
  }
  if (!o || typeof o !== 'object') return [];
  let list = (o as Record<string, unknown>).profiles as unknown;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  const ps = memberSocial(village, agent).profiles ?? {};
  const done: string[] = [];
  for (const e of (Array.isArray(list) ? list : []).slice(0, 3)) {
    const r = (e ?? {}) as { member?: unknown; feel?: unknown; note?: unknown };
    const p = typeof r.member === 'string' ? ps[r.member.trim()] : undefined;
    if (!p) continue;
    const f = Math.round(Number(r.feel));
    if (Number.isFinite(f) && r.feel !== undefined && r.feel !== null) p.feel = Math.max(-2, Math.min(2, f)) as Profile['feel'];
    if (typeof r.note === 'string' && r.note.trim()) p.note = r.note.trim().split(/\s+/).slice(0, 12).join(' ');
    logAct({ type: 'profile', village, agent, of: p.of, feel: p.feel, note: p.note, day });
    done.push(`profile ${p.of}`);
  }
  return done;
}

/** The phase now, for the panel ('' without a clock). */
export function phaseLine(village: string, now = Date.now()): string {
  const c = clockOf(village, now);
  return c ? `day ${c.day}, ${c.phase}` : '';
}
export type { Phase };
