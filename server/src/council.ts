/**
 * The village council (G3, PLAN E.6, #30; spec runs/2026-10-21/g3-rules/spec.md sections 2, 5, 13): the agenda of laws
 * members proposed and backed, a secret ballot at dusk (one call a member at its own offset over dusk and the first half
 * of the night; predicted ballots for the scripted controller), the count (quorum half the members present, 60% of the
 * ballots cast to pass, a tie keeps the status quo, a rate by the lower median), and the result put in force at once.
 * Only aggregates are ever shown. World-free: society.ts' clock tick drives it with the members present.
 *
 * Settings: MC_COUNCIL off (default) | on (needs MC_RULES, MC_MEMORY and MC_CLOCK).
 */
import type { ToolDef } from './world';
import { callModel, parseSpec } from './modelCall';
import { usage, isCloudModel, REASONING } from './modelUsage';
import { CHOOSE, fnv1a, mulberry32, shuffled } from './choose';
import { MEMORY, WINDOWS, clockOf, logAct, offsetIn, touchMemory, villageSocialOf } from './memory';
import { RULES, enact, laws, preview, rulesInForce, type Law } from './rules';

export const COUNCIL = { on: /^(on|1|true|yes)$/i.test(process.env.MC_COUNCIL ?? '') };
/** Test hook. */
export function setCouncilSettings(s: Partial<typeof COUNCIL>): void {
  Object.assign(COUNCIL, s);
}
export const councilOn = () => COUNCIL.on && RULES.on && MEMORY.clock;

/** At most this many items a meeting; a law lapses after this many days without reaching a ballot. */
export const ITEMS_MAX = 3, LAPSE_DAYS = 3;

type Vote = 'yes' | 'no' | 'abstain';
interface Meeting {
  day: number;
  items: string[];
  /** Ballots cast, by member: item -> vote (never shown). */
  cast: Record<string, Record<string, Vote>>;
  present: number;
  tallied?: boolean;
  result?: Record<string, { yes: number; no: number; abstain: number; passed: boolean }>;
}
interface CouncilState { meetings: Record<string, Meeting> }

function state(village: string): CouncilState {
  const s = villageSocialOf(village) as { meetings?: CouncilState };
  return (s.meetings ??= { meetings: {} });
}
export const meeting = (village: string, day: number): Meeting | undefined => state(village).meetings[String(day)];

/**
 * The day's agenda (spec 2, 13): open laws with at least 2 backers from others net of opposers, ranked by net backing then
 * age, at most ITEMS_MAX, no proposer over a quarter of the items of the last 3 meetings (at least one item each); laws
 * older than LAPSE_DAYS without a ballot lapse.
 */
export function agenda(village: string, day: number): Law[] {
  const ls = laws(village);
  for (const l of ls) if (l.status === 'open' && day - l.day > LAPSE_DAYS) {
    l.status = 'lapsed';
    logAct({ type: 'law', village, id: l.id, op: 'lapsed' });
  }
  const recent = Object.values(state(village).meetings).filter((m) => m.day >= day - 3 && m.day < day);
  const items = recent.flatMap((m) => m.items);
  const byOf = (id: string) => ls.find((l) => l.id === id)?.by;
  const ready = ls.filter((l) => l.status === 'open' && l.backers.length - l.opposers.length >= 2)
    .sort((x, y) => (y.backers.length - y.opposers.length) - (x.backers.length - x.opposers.length) || x.at - y.at);
  const out: Law[] = [];
  for (const l of ready) {
    if (out.length >= ITEMS_MAX) break;
    const mine = items.filter((id) => byOf(id) === l.by).length + out.filter((x) => x.by === l.by).length;
    if (mine >= Math.max(1, Math.floor(0.25 * (items.length + out.length + 1)))) continue;
    out.push(l);
  }
  return out;
}

const SYSTEM = 'You are a member of a Minecraft village. At dusk the village votes in secret on rules members proposed. '
  + 'Your ballot is never shown to anyone; only the totals are. Vote as you judge best for yourself and the village. Call `vote` once.';

/** One member's ballot prompt: the rules in force, each item's neutral text and code's preview; yes and no shuffled. */
export function ballotPrompt(village: string, agent: string, items: Law[], persona: string, now: number): { system: string; user: string; tools: ToolDef[] } {
  const lines: string[] = [];
  if (persona.trim()) lines.push(persona.trim());
  const rs = rulesInForce(village);
  lines.push(rs.length ? `Rules in force: ${rs.map((r) => r.text).join('; ')}.` : 'No village rules are in force.');
  lines.push('Tonight\'s ballot:');
  for (const l of shuffled(items, `ballot|${agent}|${l0(items)}`)) {
    const pv = preview(village, l.type, l.params, now);
    lines.push(`- [${l.id}] ${capital(l.text)}${pv ? ` (${pv})` : ''}; proposed by a member, backed by ${l.backers.length}${l.opposers.length ? `, opposed by ${l.opposers.length}` : ''}.`);
  }
  const order = shuffled(['yes', 'no'], `yn|${agent}|${l0(items)}`);
  lines.push(`For each item give a one-sentence reason, then ${order.join(' or ')} (or abstain).`);
  const tools: ToolDef[] = [{
    name: 'vote',
    description: 'Cast your secret ballot: for each item, a reason first, then your vote.',
    input_schema: {
      type: 'object',
      properties: {
        votes: {
          type: 'array', maxItems: items.length,
          items: { type: 'object', properties: { item: { type: 'string', enum: items.map((l) => l.id) }, reason: { type: 'string', maxLength: 160 }, vote: { type: 'string', enum: [...order, 'abstain'] } }, required: ['item', 'vote'] },
        },
      },
      required: ['votes'],
    },
  }];
  return { system: SYSTEM, user: lines.join('\n'), tools };
}
const l0 = (items: Law[]) => items.map((l) => l.id).join(',');
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The votes in a ballot reply (arguments as strings normalised; an item keyed by id, a vote by yes/no words). */
export function parseBallot(input: unknown, items: Law[]): Record<string, Vote> {
  let o = input as Record<string, unknown> | string | null;
  if (typeof o === 'string') {
    try { o = JSON.parse(o) as Record<string, unknown>; } catch { return {}; }
  }
  if (!o || typeof o !== 'object') return {};
  for (const k of ['arguments', 'parameters', 'input']) if ((o as Record<string, unknown>)[k] && !('votes' in o)) return parseBallot((o as Record<string, unknown>)[k], items);
  let vs = (o as Record<string, unknown>).votes as unknown;
  if (typeof vs === 'string') {
    try { vs = JSON.parse(vs); } catch { vs = []; }
  }
  const out: Record<string, Vote> = {};
  const ids = new Set(items.map((l) => l.id));
  const read = (x: unknown): Vote | undefined => {
    const t = String(x ?? '').toLowerCase();
    return /^(yes|for|aye|approve|support)/.test(t) ? 'yes' : /^(no|against|nay|reject|oppose)/.test(t) ? 'no' : /^abstain/.test(t) ? 'abstain' : undefined;
  };
  if (Array.isArray(vs)) for (const v of vs) {
    const r = (v ?? {}) as Record<string, unknown>;
    const id = String(r.item ?? r.id ?? '');
    const vote = read(r.vote ?? r.choice);
    if (ids.has(id) && vote) out[id] = vote;
  } else if (vs && typeof vs === 'object') {
    for (const [id, v] of Object.entries(vs as Record<string, unknown>)) if (ids.has(id) && read(v)) out[id] = read(v)!;
  }
  return out;
}

/** The count (spec 5): quorum half the members present casting yes or no; 60% of those to pass; a tie fails. */
export function count(cast: Record<string, Record<string, Vote>>, item: string, present: number): { yes: number; no: number; abstain: number; passed: boolean } {
  let yes = 0, no = 0, abstain = 0;
  for (const b of Object.values(cast)) {
    const v = b[item];
    if (v === 'yes') yes++;
    else if (v === 'no') no++;
    else abstain++;
  }
  const quorum = yes + no >= Math.ceil(present / 2);
  return { yes, no, abstain, passed: quorum && yes + no > 0 && yes / (yes + no) >= 0.6 };
}

/** The decision prompt's council line: tonight's ballot (from dawn), and the last meeting's totals ('' when none). */
export function councilLine(village: string, now: number): string {
  if (!councilOn()) return '';
  const c = clockOf(village, now);
  if (!c) return '';
  const out: string[] = [];
  const today = meeting(village, c.day);
  if (today?.items.length) out.push(`Tonight's ballot: ${today.items.map((id) => laws(village).find((l) => l.id === id)?.text ?? id).join('; ')}.`);
  for (let d = c.day - 1; d >= Math.max(1, c.day - 2); d--) {
    const m = meeting(village, d);
    if (!m?.result) continue;
    out.push(`At the last vote: ${Object.entries(m.result).map(([id, r]) => `"${laws(village).find((l) => l.id === id)?.text ?? id}" ${r.passed ? 'passed' : 'failed'} ${r.yes} to ${r.no}${r.abstain ? ` (${r.abstain} abstained)` : ''}`).join('; ')}.`);
    break;
  }
  return out.join(' ');
}

export interface CouncilMember { name: string; persona: string; model?: string }

/** Ballots in flight, by village|day|member. */
const casting = new Set<string>();
/** Injected in tests. */
let call: typeof callModel = callModel;
export function setBallotCall(fn: typeof callModel): void {
  call = fn;
}

/**
 * The council's part of the clock's sweep: from dawn the day's agenda is set (once); from dusk each member present casts
 * at its own offset (dusk and the first half of the night); at the night's midpoint, or once everyone has cast, the count,
 * and passed laws go into force. Never throws.
 */
export function councilTick(village: string, members: CouncilMember[], now: number): void {
  if (!councilOn()) return;
  try {
    const c = clockOf(village, now);
    if (!c) return;
    const st = state(village);
    const key = String(c.day);
    let m = st.meetings[key];
    if (!m) {
      const items = agenda(village, c.day);
      m = st.meetings[key] = { day: c.day, items: items.map((l) => l.id), cast: {}, present: 0 };
      for (const l of items) {
        l.status = 'agenda';
        l.ballotDay = c.day;
      }
      if (items.length) logAct({ type: 'meeting', village, day: c.day, op: 'agenda', items: m.items });
      touchMemory();
    }
    if (!m.items.length || m.tallied) return;
    const items = m.items.map((id) => laws(village).find((l) => l.id === id)).filter((l): l is Law => !!l);
    const [d0] = WINDOWS.dusk;
    const mid = (WINDOWS.night[0] + WINDOWS.night[1]) / 2;
    if (c.frac >= d0 && c.frac < mid) {
      m.present = Math.max(m.present, members.length);
      for (const mem of members) {
        const k = `${village}|${c.day}|${mem.name}`;
        // (its offset spread over dusk and the first half of the night)
        const at = d0 + ((offsetIn(mem.name, 'dusk') - d0) / (WINDOWS.dusk[1] - d0)) * (mid - d0) * 0.9;
        if (c.frac < at || m.cast[mem.name] || casting.has(k)) continue;
        casting.add(k);
        void castOne(village, mem, items, m, now).finally(() => casting.delete(k));
      }
    }
    if (c.frac >= mid || (m.present && Object.keys(m.cast).length >= m.present)) tallyMeeting(village, m, items, now);
  } catch (e) {
    console.log(`[council] ${village}: ${String((e as Error)?.stack ?? e).slice(0, 300)}`);
  }
}

async function castOne(village: string, mem: CouncilMember, items: Law[], m: Meeting, now: number): Promise<void> {
  // (the scripted controller: predicted ballots, seeded: yes 70%)
  if (CHOOSE.mode === 'scripted') {
    const rnd = mulberry32(fnv1a(`ballot|${village}|${m.day}|${mem.name}`));
    m.cast[mem.name] = Object.fromEntries(items.map((l) => [l.id, rnd() < 0.7 ? 'yes' : 'no'])) as Record<string, Vote>;
    logAct({ type: 'ballot', village, agent: mem.name, day: m.day, votes: m.cast[mem.name], scripted: true });
    touchMemory();
    return;
  }
  const spec = parseSpec(mem.model ?? CHOOSE.model);
  if (!spec) return;
  if ((isCloudModel(spec.model) && !usage.allows('reflection')) || usage.blocked(spec.model, mem.name)) {
    m.cast[mem.name] = {};
    logAct({ type: 'ballot', village, agent: mem.name, day: m.day, skipped: 'budget' });
    return;
  }
  const p = ballotPrompt(village, mem.name, items, mem.persona, now);
  try {
    const r = await call({ spec, system: p.system, user: p.user, tools: p.tools, level: REASONING.ballot, agent: mem.name, kind: 'ballot', priority: 'ballot' });
    const c = r.reply.calls.find((x) => x.name === 'vote') ?? r.reply.calls[0];
    const votes = parseBallot(c?.input ?? r.reply.text.slice(r.reply.text.indexOf('{'), r.reply.text.lastIndexOf('}') + 1), items);
    m.cast[mem.name] = votes;
    logAct({ type: 'ballot', village, agent: mem.name, day: m.day, votes, prompt: p.user, reply: c?.input ?? r.reply.text.slice(0, 300), ms: r.ms, promptTokens: r.reply.promptTokens, outputTokens: r.reply.outputTokens });
  } catch (e) {
    m.cast[mem.name] = {};
    logAct({ type: 'ballot', village, agent: mem.name, day: m.day, error: String((e as Error)?.message ?? e).slice(0, 160) });
  }
  touchMemory();
}

function tallyMeeting(village: string, m: Meeting, items: Law[], now: number) {
  m.tallied = true;
  m.result = {};
  for (const l of items) {
    const r = count(m.cast, l.id, m.present);
    m.result[l.id] = r;
    l.result = { yes: r.yes, no: r.no, abstain: r.abstain, voters: m.present };
    l.status = r.passed ? 'passed' : 'failed';
    if (r.passed) enact(village, l, r, now);
  }
  logAct({ type: 'meeting', village, day: m.day, op: 'tally', present: m.present, cast: Object.keys(m.cast).length, result: m.result });
  console.log(`[council] ${village}: day ${m.day}'s vote: ${Object.entries(m.result).map(([id, r]) => `${id} ${r.passed ? 'passed' : 'failed'} ${r.yes}-${r.no} (${r.abstain} abstained)`).join('; ')}`);
  touchMemory();
}
