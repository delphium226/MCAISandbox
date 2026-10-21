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
import {
  FOCUS, MEMORY, agentMemory, applyWrites, clockOf, closeAgentDays, closeVillageDays, liveNotes, logAct, offsetIn, recordLine, villageLineShown, villageMemory,
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
        if (had && MEMORY.reflect) void reflect(village, m, c.day, now);
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

const REFLECT_SYSTEM = 'You are a member of a Minecraft village. Night has come in the village and you look back on your day. '
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
              ...(live.length ? { replaces: { type: 'string', enum: live.map((n) => n.id), description: 'The id of a note this one replaces.' } } : {}),
            },
            required: ['text'],
          },
        },
        // (#86, MC_MEMORY_QUALITY: gpt-oss answered the notes with ids of notes to keep, F273; a place for them)
        ...(MEMORY.quality && live.length ? { keep: { type: 'array', items: { type: 'string', enum: live.map((n) => n.id) }, description: 'Optional: ids of notes you keep as they are (kept notes need no new text).' } } : {}),
        intention: { type: 'string', maxLength: 200, description: 'What you mean to do tomorrow and why, one sentence.' },
        focus: { type: 'string', enum: FOCUS, description: 'The kind of work you mean to do most tomorrow.' },
        ...(people.length ? {
          profiles: {
            type: 'array', maxItems: 3, description: 'Optional: up to 3 members above, how you feel about them and a short note (12 words at most).',
            items: { type: 'object', properties: { member: { type: 'string', enum: people.map((p) => p.of) }, feel: { type: 'integer', minimum: -2, maximum: 2 }, note: { type: 'string', maxLength: 90 } }, required: ['member'] },
          },
        } : {}),
      },
      required: ['notes', 'intention', 'focus'],
    },
  }];
  return { system: REFLECT_SYSTEM, user: lines.join('\n\n'), tools };
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
  const list = (Array.isArray(notes) ? notes : []).map((n) => (typeof n === 'string' ? { text: n } : n as { text?: unknown; replaces?: unknown }))
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
    logAct({ type: 'reflect', village, agent: m.name, day, system: p.system, prompt: p.user, reply: got ?? { text: r.reply.text.slice(0, 400) }, done, ms: r.ms, waitMs: r.waitMs, promptTokens: r.reply.promptTokens, outputTokens: r.reply.outputTokens });
    console.log(`[reflect] ${village}: ${m.name} day ${day}: ${done.join(', ') || 'nothing kept'}${got?.intention ? `; tomorrow: ${got.intention.slice(0, 100)}` : ''}`);
  } catch (e) {
    logAct({ type: 'reflect', village, agent: m.name, day, error: String((e as Error)?.message ?? e).slice(0, 200), ms: Date.now() - t0 });
    console.log(`[reflect] ${village}: ${m.name} day ${day}: the call failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
  } finally {
    reflecting.delete(k);
  }
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
