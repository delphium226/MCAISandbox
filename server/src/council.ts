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
import { RULES, enact, feasibility, judgeDays, laws, levyRate, preview, ruleResults, rulesInForce, stake, wordsOnly, type Law } from './rules';
import { rawSetting } from './settings';

export const COUNCIL = {
  on: /^(on|1|true|yes)$/i.test(rawSetting('MC_COUNCIL') ?? ''),
  /** #1, the need vote: a need its answers sat untaken on for a village day goes on the next ballot (MC_NEED_VOTE, off). */
  needVote: /^(on|1|true|yes)$/i.test(rawSetting('MC_NEED_VOTE') ?? ''),
  /** Experiment 2 (#33): a code-placed levy item on this day's ballot (MC_LEVY_VOTE=day2: rates 0-50%, the lower median). */
  levyVoteDay: Number(/^day(\d+)$/i.exec(rawSetting('MC_LEVY_VOTE') ?? '')?.[1] ?? 0) || 0,
  /** Experiment 2's imposed arm: code sets the levy to R% at the moment the vote would be counted (MC_LEVY_SET=day2:30). */
  levySet: (() => { const m = /^day(\d+):(\d+)$/i.exec(rawSetting('MC_LEVY_SET') ?? ''); return m ? { day: Number(m[1]), rate: Number(m[2]) } : null; })(),
  /** Experiment 2's influencers (MCAI_INFLUENCERS=pro|anti): these members argue for a higher or lower levy and cast no
   *  levy ballot (MCAI_INFLUENCER_NAMES, default three of the 24 workers). */
  influencers: (rawSetting('MCAI_INFLUENCERS') ?? '').toLowerCase() as '' | 'pro' | 'anti',
  influencerNames: (rawSetting('MCAI_INFLUENCER_NAMES') ?? 'Ben,Kai,Sam').split(',').map((x) => x.trim()).filter(Boolean),
  /** #107, deliberation's zero-cost form (MC_DELIBERATE, off): a later voter's ballot shows earlier voters' reasons for
   *  each item, attributed, both sides when both were given (the staggered offsets order the voters). */
  deliberate: /^(on|1|true|yes)$/i.test(rawSetting('MC_DELIBERATE') ?? ''),
  /** #164 (MC_COUNCIL_SCRIPTED, off; test train 8's F1 arm): under the fixed chooser the night's laws come from the script
   *  (society.ts scriptedLaw) and the dusk ballots are predicted, with no model call, as under the scripted controller. */
  scripted: /^(on|1|true|yes)$/i.test(rawSetting('MC_COUNCIL_SCRIPTED') ?? ''),
};
/** Test hook. */
export function setCouncilSettings(s: Partial<typeof COUNCIL>): void {
  Object.assign(COUNCIL, s);
}
export const councilOn = () => COUNCIL.on && RULES.on && MEMORY.clock;
/** Whether the council is scripted: the scripted controller's, or MC_COUNCIL_SCRIPTED under the fixed chooser (#164's F1). */
export const councilScripted = () => CHOOSE.mode === 'scripted' || (COUNCIL.scripted && CHOOSE.mode === 'fixed');

/** At most this many items a meeting; a law lapses after this many days without reaching a ballot. */
export const ITEMS_MAX = 3, LAPSE_DAYS = 3;

/** A law's ballot: yes, no or abstain; a need item's: one of its options' ids (A, B...), 'none' or abstain. */
type Vote = string;
/** A need item (#1): the need, code's words for it, and the chores that answered it on members' menus (2-4, by option). */
interface NeedItem { need: string; text: string; options: Array<{ id: string; name: string; option: string }> }
interface Meeting {
  day: number;
  items: string[];
  /** Ballots cast, by member: item -> vote (never shown). */
  cast: Record<string, Record<string, Vote>>;
  present: number;
  tallied?: boolean;
  result?: Record<string, { yes: number; no: number; abstain: number; passed: boolean; winner?: string; counts?: Record<string, number> }>;
  /** Need items on this ballot, by item id ("need:food"). */
  needs?: Record<string, NeedItem>;
  /** Experiment 2: the levy item is on this ballot. */
  levy?: boolean;
  /** #107 (MC_DELIBERATE): the reasons voters gave so far, by item, in the order cast. */
  said?: Record<string, Array<{ by: string; vote: string; reason: string }>>;
}

/** #107: what a voter is shown of the reasons given before it, by item: the latest 2 of each side (for, against, other
 *  choices), at most 4, so a later voter sees both sides when both were given. */
export function heardReasons(m: Pick<Meeting, 'said'>, agent: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, list] of Object.entries(m.said ?? {})) {
    const sides = new Map<string, Array<{ by: string; vote: string; reason: string }>>();
    for (const r of list) if (r.by !== agent) sides.set(r.vote, [...(sides.get(r.vote) ?? []), r]);
    const pick = [...sides.values()].flatMap((rs) => rs.slice(-2)).slice(0, 4);
    if (pick.length) out[id] = pick.map((r) => `${r.by} (${r.vote === 'yes' ? 'for' : r.vote === 'no' ? 'against' : r.vote}): "${r.reason}"`);
  }
  return out;
}
// ---------------------------------------------------------------------------------------------
// Experiment 2 (#33; spec 8 and 13): the levy item, the imposed arm, the influencers
// ---------------------------------------------------------------------------------------------

export const LEVY_ITEM = 'levy:rate';
export const LEVY_RATES = [0, 10, 20, 30, 40, 50];
const isInfluencer = (name: string) => !!COUNCIL.influencers && COUNCIL.influencerNames.some((n) => n.toLowerCase() === name.toLowerCase());

/** An influencer's persona line (Experiment 2), added to its persona everywhere it is shown; '' for anyone else. */
export function influenceLine(name: string): string {
  if (!isInfluencer(name)) return '';
  return COUNCIL.influencers === 'pro'
    ? 'You believe the village levy on members\' shares should be higher, so the village storage keeps everyone supplied; when you speak with others, say so.'
    : 'You believe the village levy on members\' shares should be lower, so members keep more of what they earn; when you speak with others, say so.';
}
/** A persona with the influencer's line added (unchanged for everyone else, and with the experiment off). */
export const withInfluence = (name: string, persona: string): string => {
  const l = influenceLine(name);
  return l ? `${persona.trim()} ${l}`.trim() : persona;
};

/** The lower median of the rates cast (null under quorum: half the members present). */
export function countLevy(cast: Record<string, Record<string, Vote>>, present: number): { rate: number | null; counts: Record<string, number>; abstain: number } {
  const rates: number[] = [];
  const counts: Record<string, number> = {};
  let abstain = 0;
  for (const b of Object.values(cast)) {
    const v = b[LEVY_ITEM];
    const r = v !== undefined && /^\d+$/.test(v) ? Number(v) : NaN;
    if (LEVY_RATES.includes(r)) {
      rates.push(r);
      counts[`${r}%`] = (counts[`${r}%`] ?? 0) + 1;
    } else abstain++;
  }
  rates.sort((a, b) => a - b);
  const rate = rates.length && rates.length >= Math.ceil(present / 2) ? rates[Math.floor((rates.length - 1) / 2)] : null;
  return { rate, counts, abstain };
}

/** The levy put in force by the experiment (voted or imposed), with its record. */
function setLevy(village: string, day: number, rate: number, how: 'voted' | 'imposed', votes: { yes: number; no: number; abstain: number }, now: number) {
  const l: Law = { id: `levy-d${day}`, by: how === 'voted' ? 'the village' : 'code', at: now, day, type: 'levy', params: { rate }, text: `members leave ${rate}% of their share in the village storage`, what: '', why: '', backers: [], opposers: [], status: 'passed' };
  enact(village, l, votes, now);
  (state(village).levySet ??= {})[String(day)] = { rate, how };
  logAct({ type: 'rule', village, op: `levy ${how}`, rate, day, votes });
  console.log(`[council] ${village}: day ${day}: the levy ${how} at ${rate}%`);
}

/** A need vote's winner: options whose id starts with `option` weigh 1.5x on menus until the end of day `until`. */
interface NeedChoice { need: string; option: string; name: string; day: number; until: number }
interface CouncilState { meetings: Record<string, Meeting>; needChoices?: NeedChoice[]; levySet?: Record<string, { rate: number; how: 'voted' | 'imposed' }> }

// ---------------------------------------------------------------------------------------------
// The need vote (#1; spec 6 and 13): a need 'ignored' (answers offered, none taken) for a village day goes on the ballot
// ---------------------------------------------------------------------------------------------

/** Each need's status since when, and the answering options seen on members' menus (by option id, without its instance). */
const needSeen = new Map<string, { status: string; since: number; text: string; offers: Map<string, { name: string; n: number }> }>();
const needKey = (village: string, need: string) => `${village.toLowerCase()}|${need}`;
const optionBase = (id: string) => id.replace(/:\d+(:\d+)?$/, '');

/** The world's needTick: a need's status now (and its words), for the agenda's trigger. */
export function noteNeedStatus(village: string, need: string, status: string, text: string, now: number): void {
  if (!COUNCIL.needVote || !councilOn()) return;
  const k = needKey(village, need);
  const s = needSeen.get(k);
  // (the offers counted afresh from when it became ignored: the ballot's choices are the ignored day's, the review's 10)
  if (!s || s.status !== status) needSeen.set(k, { status, since: now, text, offers: status === 'ignored' || !s ? new Map() : s.offers });
  else s.text = text;
}

/** The world's menus: an option that answers a need (its name kept, counted, for the need item's choices). */
export function noteNeedOffer(village: string, need: string, option: { id: string; name: string }, now = Date.now()): void {
  if (!COUNCIL.needVote || !councilOn()) return;
  const k = needKey(village, need);
  const s = needSeen.get(k) ?? { status: 'low', since: now, text: '', offers: new Map() };
  needSeen.set(k, s);
  const b = optionBase(option.id);
  const o = s.offers.get(b) ?? { name: option.name, n: 0 };
  o.n++;
  s.offers.set(b, o);
}

/** Need items for a day's ballot: each need ignored for at least a village day with at least 2 answering options. */
function needItems(village: string, now: number, dayMs: number): Record<string, NeedItem> {
  const out: Record<string, NeedItem> = {};
  const recent = new Set((state(village).needChoices ?? []).filter((c) => c.until >= (clockOf(village, now)?.day ?? 0)).map((c) => c.need));
  for (const [k, s] of needSeen) {
    const [v, need] = k.split('|');
    if (v !== village.toLowerCase() || s.status !== 'ignored' || now - s.since < dayMs || recent.has(need)) continue;
    const top = [...s.offers.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3);
    if (top.length < 2) continue;
    out[`need:${need}`] = { need, text: s.text, options: top.map(([option, o], i) => ({ id: String.fromCharCode(65 + i), name: o.name, option })) };
  }
  return out;
}

/** A need vote's weight on an option (1.5 while its winner holds, else 1) and the menu's tag. */
export function needBoost(village: string, optionId: string, now: number): { w: number; tag?: string } {
  if (!COUNCIL.needVote || !councilOn()) return { w: 1 };
  const day = clockOf(village, now)?.day ?? 0;
  const c = (state(village).needChoices ?? []).find((x) => x.until >= day && x.day <= day && optionBase(optionId) === x.option);
  return c ? { w: 1.5, tag: `[the village voted for this: ${c.need}]` } : { w: 1 };
}

/** The count of a need item: the most-chosen option among those cast (quorum half present; a tie or 'none' first: none). */
export function countNeed(cast: Record<string, Record<string, Vote>>, item: string, options: string[], present: number): { winner?: string; counts: Record<string, number>; abstain: number } {
  const counts: Record<string, number> = {};
  let abstain = 0;
  for (const b of Object.values(cast)) {
    const v = b[item];
    if (v && (options.includes(v) || v === 'none')) counts[v] = (counts[v] ?? 0) + 1;
    else abstain++;
  }
  const cast_ = Object.values(counts).reduce((s, n) => s + n, 0);
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const quorum = cast_ >= Math.ceil(present / 2);
  const winner = quorum && ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) && ranked[0][0] !== 'none' ? ranked[0][0] : undefined;
  return { winner, counts, abstain };
}

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
export function ballotPrompt(village: string, agent: string, items: Law[], persona: string, now: number, needs: Record<string, NeedItem> = {}, levy = false, heard: Record<string, string[]> = {}): { system: string; user: string; tools: ToolDef[]; order: string[] } {
  const lines: string[] = [];
  if (persona.trim()) lines.push(persona.trim());
  const rs = rulesInForce(village);
  // (#164, MC_RULE_RESULTS: each rule with its result in code's counts)
  const res = ruleResults(village, now);
  lines.push(res.length ? `Rules in force: ${res.join('; ')}.` : rs.length ? `Rules in force: ${rs.map((r) => r.text).join('; ')}.` : 'No village rules are in force.');
  lines.push('Tonight\'s ballot:');
  for (const l of shuffled(items, `ballot|${agent}|${l0(items)}`)) {
    // (#164: a norm's words-only line, MC_RULE_WORDS; a duty's or contribution's yesterday, MC_RULE_FEASIBLE)
    const pv = [preview(village, l.type, l.params, now), wordsOnly(l.type), feasibility(village, l.type, l.params, now)].filter(Boolean).join('; ');
    // (10-23: what it would have meant for this member yesterday, code's facts: rulebench saw 99% yes without them)
    const sk = stake(village, agent, l.type, l.params, storeOf?.(village) ?? {}, now);
    lines.push(`- [${l.id}] ${capital(l.text)}${pv ? ` (${pv})` : ''}; proposed by a member, backed by ${l.backers.length}${l.opposers.length ? `, opposed by ${l.opposers.length}` : ''}.${sk ? ` For you: ${sk}.` : ''}`);
    // (#107, MC_DELIBERATE: reasons given before this voter)
    if (heard[l.id]?.length) lines.push(`  Said before you: ${heard[l.id].join('; ')}`);
  }
  // (#1: a need item, its chores in the order the menus offered them most; the winner weighs 1.5x for two days)
  const needIds = Object.keys(needs);
  for (const id of needIds) {
    const n = needs[id];
    // (the choices shown in a member's own seeded order, their letters fixed: position bias measurable, rulebench)
    lines.push(`- [${id}] The village need "${n.text || n.need}": the chores that answer it were offered all day and nobody took them. Which should members do first for the next two days? ${shuffled(n.options, `need|${agent}|${id}`).map((o) => `${o.id}: ${o.name}`).join('; ')}; or none.`);
    if (heard[id]?.length) lines.push(`  Said before you: ${heard[id].join('; ')}`);
  }
  // (Experiment 2: the levy item, its rates in order, not shuffled: spec 13)
  if (levy) lines.push(`- [${LEVY_ITEM}] The levy on members' shares (now ${Math.round((levyRate(village) ?? 0) * 100)}%): what should it be from tomorrow? One of ${LEVY_RATES.map((r) => `${r}%`).join(', ')}.`);
  if (levy && heard[LEVY_ITEM]?.length) lines.push(`  Said before you: ${heard[LEVY_ITEM].join('; ')}`);
  const order = shuffled(['yes', 'no'], `yn|${agent}|${l0(items)}`);
  if (levy || needIds.length) {
    const asks = [items.length ? `${order.join(' or ')} (or abstain) for a rule` : '', needIds.length ? 'the letter of your choice (or none) for a need' : '', levy ? 'a rate for the levy' : ''].filter(Boolean);
    lines.push(`For each item give a one-sentence reason, then ${asks.length > 1 ? `${asks.slice(0, -1).join(', ')} and ${asks[asks.length - 1]}` : asks[0]}.`);
  } else lines.push(`For each item give a one-sentence reason, then ${order.join(' or ')} (or abstain).`);
  const tools: ToolDef[] = [{
    name: 'vote',
    description: 'Cast your secret ballot: for each item, a reason first, then your vote.',
    input_schema: {
      type: 'object',
      properties: {
        votes: {
          type: 'array', maxItems: items.length + needIds.length + (levy ? 1 : 0),
          items: { type: 'object', properties: { item: { type: 'string', enum: [...items.map((l) => l.id), ...needIds, ...(levy ? [LEVY_ITEM] : [])] }, reason: { type: 'string', maxLength: 160 }, vote: { type: 'string', enum: [...(items.length ? [...order, 'abstain'] : []), ...(needIds.length ? [...new Set(needIds.flatMap((id) => needs[id].options.map((o) => o.id))), 'none'] : []), ...(levy ? LEVY_RATES.map((r) => `${r}%`) : [])] } }, required: ['item', 'vote'] },
        },
      },
      required: ['votes'],
    },
  }];
  return { system: SYSTEM, user: lines.join('\n'), tools, order: [...shuffled(items, `ballot|${agent}|${l0(items)}`).map((l) => l.id), ...needIds, ...(levy ? [LEVY_ITEM] : [])] };
}
const l0 = (items: Law[]) => items.map((l) => l.id).join(',');
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The votes in a ballot reply (arguments as strings normalised; an item keyed by id, a vote by yes/no words). */
export function parseBallot(input: unknown, items: Law[], needs: Record<string, NeedItem> = {}, order?: string[], levy = false): Record<string, Vote> {
  let o = input as Record<string, unknown> | string | null;
  if (typeof o === 'string') {
    try { o = JSON.parse(o) as Record<string, unknown>; } catch { return {}; }
  }
  if (!o || typeof o !== 'object') return {};
  for (const k of ['arguments', 'parameters', 'input']) if ((o as Record<string, unknown>)[k] && !('votes' in o)) return parseBallot((o as Record<string, unknown>)[k], items, needs, order, levy);
  let vs = (o as Record<string, unknown>).votes as unknown;
  if (typeof vs === 'string') {
    try { vs = JSON.parse(vs); } catch { vs = []; }
  }
  const out: Record<string, Vote> = {};
  const ids = new Set([...items.map((l) => l.id), ...Object.keys(needs), ...(levy ? [LEVY_ITEM] : [])]);
  const read = (id: string, x: unknown): Vote | undefined => {
    const t = String(x ?? '').toLowerCase().trim();
    // (the levy item: a rate on the list, "30%", "30", "30 percent")
    if (id === LEVY_ITEM) {
      const r = Number(/(\d+)/.exec(t)?.[1] ?? NaN);
      return LEVY_RATES.includes(r) ? String(r) : /^(none|abstain)/.test(t) ? 'abstain' : undefined;
    }
    const n = needs[id];
    if (n) {
      // (a need's choice by its letter, "B", "B: Bake bread", or the chore's name)
      const o = n.options.find((c) => t === c.id.toLowerCase() || t.startsWith(`${c.id.toLowerCase()}:`) || t.startsWith(`${c.id.toLowerCase()})`) || t === c.name.toLowerCase());
      return o ? o.id : /^(none|neither|no\b)/.test(t) ? 'none' : /^abstain/.test(t) ? 'abstain' : undefined;
    }
    // (a law's "none" or a need's letter on it is no vote: an abstention, the review's 4)
    if (/^(none|abstain)\b/.test(t) || (Object.keys(needs).length && /^[a-d](\b|:|\))/.test(t))) return 'abstain';
    return /^(yes|for|aye|approve|support)/.test(t) ? 'yes' : /^(no|against|nay|reject|oppose)\b/.test(t) ? 'no' : undefined;
  };
  // (rulebench, 10-23: gpt-oss leaves the item out on a one-item ballot, {"votes": [{"reason", "vote"}]}, or writes
  // ["l1", "yes"] and "reason; Yes": an entry without an item takes the next item in the order the member was shown)
  const shown = (order ?? [...items.map((l) => l.id), ...Object.keys(needs)]).filter((id) => ids.has(id));
  const free = () => shown.find((id) => !(id in out) && !named.has(id));
  const named = new Set<string>();
  const entries = (Array.isArray(vs) ? vs : []).map((v) => {
    if (Array.isArray(v)) return { id: String(v[0] ?? ''), vote: v[v.length - 1] };
    if (typeof v === 'string') {
      // (a sentence: its item at the start, "l6: ...", and its vote as the last word, "..., so yes." / "...; C")
      const m = /^\s*\[?(l\d+|need:[a-z_]+)\]?\s*[:=-]\s*/i.exec(v);
      const last = /\b(yes|no|abstain|none|[A-D])\W*$/i.exec(v.trim())?.[1];
      return { id: m && ids.has(m[1]) ? m[1] : '', vote: last };
    }
    const r = (v ?? {}) as Record<string, unknown>;
    return { id: String(r.item ?? r.id ?? ''), vote: r.vote ?? r.choice ?? r.decision ?? r.answer };
  });
  for (const e of entries) if (ids.has(e.id)) named.add(e.id);
  for (const e of entries) {
    const id = ids.has(e.id) ? e.id : free();
    const vote = id ? read(id, e.vote) : undefined;
    if (id && vote) out[id] = vote;
  }
  if (!Array.isArray(vs) && vs && typeof vs === 'object') {
    for (const [id, v] of Object.entries(vs as Record<string, unknown>)) {
      const vote = ids.has(id) ? read(id, v) : undefined;
      if (vote) out[id] = vote;
    }
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
  const words = (m: Meeting, id: string) => (id === LEVY_ITEM ? "the levy on members' shares" : m.needs?.[id] ? `what to do first for the ${m.needs[id].need} need` : laws(village).find((l) => l.id === id)?.text ?? id);
  if (today?.items.length) out.push(`Tonight's ballot: ${today.items.map((id) => words(today, id)).join('; ')}.`);
  // (Experiment 2: the levy set last night, in the same words in both arms, the voted arm's saying it was voted: spec 13)
  const set = state(village).levySet?.[String(c.day - 1)];
  if (set) out.push(`From today the levy is ${set.rate}%${set.how === 'voted' ? ', as the village voted last night' : ''}.`);
  for (let d = c.day - 1; d >= Math.max(1, c.day - 2); d--) {
    const m = meeting(village, d);
    if (!m?.result) continue;
    const res = Object.entries(m.result).filter(([id]) => id !== LEVY_ITEM);
    if (!res.length) break;
    out.push(`At the last vote: ${res.map(([id, r]) => (r.counts
      ? `on ${words(m, id)}, ${r.winner ? `"${r.winner}" won` : 'no choice won'} (${Object.entries(r.counts).map(([o, n]) => `${m.needs?.[id]?.options.find((x) => x.id === o)?.name ?? o} ${n}`).join(', ')})`
      : `"${words(m, id)}" ${r.passed ? 'passed' : 'failed'} ${r.yes} to ${r.no}${r.abstain ? ` (${r.abstain} abstained)` : ''}`)).join('; ')}.`);
    break;
  }
  return out.join(' ');
}

export interface CouncilMember { name: string; persona: string; model?: string }

/** The village storage's contents (the world's, registered at its start), for a floor's stake line. */
let storeOf: ((village: string) => Record<string, number>) | null = null;
export function setCouncilStore(fn: (village: string) => Record<string, number>): void {
  storeOf = fn;
}

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
    // (yesterday's compliance with the duties and contributions in force, once a day)
    judgeDays(village, members.map((x) => x.name), now);
    let m = st.meetings[key];
    if (!m) {
      const items = agenda(village, c.day);
      // (#1: code's need items, beside the members' laws and not counted in their 3)
      const needs = COUNCIL.needVote ? needItems(village, now, c.dayMs) : {};
      // (Experiment 2: the code-placed levy item on its day, whatever members proposed)
      const levy = COUNCIL.levyVoteDay === c.day;
      m = st.meetings[key] = { day: c.day, items: [...items.map((l) => l.id), ...Object.keys(needs), ...(levy ? [LEVY_ITEM] : [])], cast: {}, present: 0, ...(Object.keys(needs).length ? { needs } : {}), ...(levy ? { levy } : {}) };
      for (const l of items) {
        l.status = 'agenda';
        l.ballotDay = c.day;
      }
      if (m.items.length) logAct({ type: 'meeting', village, day: c.day, op: 'agenda', items: m.items, ...(m.needs ? { needs: m.needs } : {}) });
      touchMemory();
    }
    const [d0] = WINDOWS.dusk;
    const mid = (WINDOWS.night[0] + WINDOWS.night[1]) / 2;
    // (Experiment 2's imposed arm: code sets the levy at the night's midpoint of its day, the voted arm's count; no ballot)
    if (COUNCIL.levySet?.day === c.day && c.frac >= mid && !st.levySet?.[key]) setLevy(village, c.day, COUNCIL.levySet.rate, 'imposed', { yes: 0, no: 0, abstain: 0 }, now);
    if (!m.items.length || m.tallied) return;
    const items = m.items.map((id) => laws(village).find((l) => l.id === id)).filter((l): l is Law => !!l);
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
  // (the scripted controller, and MC_COUNCIL_SCRIPTED's fixed chooser: predicted ballots, seeded: yes 70%)
  if (councilScripted()) {
    const rnd = mulberry32(fnv1a(`ballot|${village}|${m.day}|${mem.name}`));
    m.cast[mem.name] = Object.fromEntries(items.map((l) => [l.id, rnd() < 0.7 ? 'yes' : 'no'])) as Record<string, Vote>;
    // (a need item: the chore offered most, A)
    for (const [id, n] of Object.entries(m.needs ?? {})) m.cast[mem.name][id] = n.options[0].id;
    if (m.levy && !isInfluencer(mem.name)) m.cast[mem.name][LEVY_ITEM] = String(LEVY_RATES[Math.floor(rnd() * 4) + 1]);
    // (#107: the scripted voter is shown the reasons before it and gives its own, for the staged check)
    const heard = COUNCIL.deliberate ? heardReasons(m, mem.name) : {};
    if (COUNCIL.deliberate) noteSaid(m, mem.name, Object.entries(m.cast[mem.name]).map(([item, vote]) => ({ item, vote, reason: `${mem.name}'s scripted reason, ${vote}` })));
    logAct({ type: 'ballot', village, agent: mem.name, day: m.day, votes: m.cast[mem.name], scripted: true, ...(COUNCIL.deliberate ? { heard: Object.values(heard).reduce((t, x) => t + x.length, 0) } : {}) });
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
  // (Experiment 2: influencers cast no levy ballot; one with nothing else to vote on casts none)
  const levy = !!m.levy && !isInfluencer(mem.name);
  if (!items.length && !Object.keys(m.needs ?? {}).length && !levy) {
    m.cast[mem.name] = {};
    logAct({ type: 'ballot', village, agent: mem.name, day: m.day, skipped: 'influencer' });
    return;
  }
  const heard = COUNCIL.deliberate ? heardReasons(m, mem.name) : {};
  const p = ballotPrompt(village, mem.name, items, withInfluence(mem.name, mem.persona), now, m.needs, levy, heard);
  try {
    const r = await call({ spec, system: p.system, user: p.user, tools: p.tools, level: REASONING.ballot, agent: mem.name, kind: 'ballot', priority: 'ballot' });
    const c = r.reply.calls.find((x) => x.name === 'vote') ?? r.reply.calls[0];
    const votes = parseBallot(c?.input ?? r.reply.text.slice(r.reply.text.indexOf('{'), r.reply.text.lastIndexOf('}') + 1), items, m.needs, p.order, levy);
    m.cast[mem.name] = votes;
    // (#107: the reasons it gave, shown to the voters after it)
    if (COUNCIL.deliberate) noteSaid(m, mem.name, reasonsOf(c?.input).map((x) => ({ ...x, vote: votes[x.item] ?? '' })).filter((x) => x.vote && x.vote !== 'abstain'));
    logAct({ type: 'ballot', village, agent: mem.name, day: m.day, votes, ...(COUNCIL.deliberate ? { heard: Object.values(heard).reduce((t, x) => t + x.length, 0) } : {}), prompt: p.user, reply: c?.input ?? r.reply.text.slice(0, 300), ms: r.ms, promptTokens: r.reply.promptTokens, outputTokens: r.reply.outputTokens });
  } catch (e) {
    m.cast[mem.name] = {};
    logAct({ type: 'ballot', village, agent: mem.name, day: m.day, error: String((e as Error)?.message ?? e).slice(0, 160) });
  }
  touchMemory();
}

/** #107: a ballot reply's reasons by item (the vote tool's votes[].reason), whatever the shape gpt-oss wrapped it in. */
function reasonsOf(input: unknown): Array<{ item: string; reason: string }> {
  let o = input as Record<string, unknown> | string | null;
  if (typeof o === 'string') {
    try { o = JSON.parse(o) as Record<string, unknown>; } catch { return []; }
  }
  if (!o || typeof o !== 'object') return [];
  for (const k of ['arguments', 'parameters', 'input']) if (o[k] && !('votes' in o)) return reasonsOf(o[k]);
  let vs = o.votes as unknown;
  if (typeof vs === 'string') {
    try { vs = JSON.parse(vs); } catch { vs = []; }
  }
  const out: Array<{ item: string; reason: string }> = [];
  for (const x of Array.isArray(vs) ? vs : []) {
    const r = x as { item?: unknown; reason?: unknown };
    if (typeof r?.item === 'string' && typeof r.reason === 'string' && r.reason.trim()) out.push({ item: r.item, reason: r.reason.replace(/\s+/g, ' ').trim().slice(0, 160) });
  }
  return out;
}

function noteSaid(m: Meeting, by: string, rs: Array<{ item: string; vote: string; reason: string }>) {
  for (const r of rs) ((m.said ??= {})[r.item] ??= []).push({ by, vote: r.vote, reason: r.reason });
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
  // (Experiment 2: the levy item, the lower median of the rates cast, quorum half the voters present (influencers out))
  if (m.levy) {
    const r = countLevy(m.cast, Math.max(1, m.present - (COUNCIL.influencers ? COUNCIL.influencerNames.length : 0)));
    m.result[LEVY_ITEM] = { yes: 0, no: 0, abstain: r.abstain, passed: r.rate !== null, ...(r.rate !== null ? { winner: `${r.rate}%` } : {}), counts: r.counts };
    if (r.rate !== null) setLevy(village, m.day, r.rate, 'voted', { yes: Object.values(r.counts).reduce((a, b) => a + b, 0), no: 0, abstain: r.abstain }, now);
    else logAct({ type: 'rule', village, op: 'levy vote: no quorum', day: m.day, counts: r.counts });
  }
  // (#1: a need item's winner weighs on its chores from the next day for two days)
  for (const [id, n] of Object.entries(m.needs ?? {})) {
    const r = countNeed(m.cast, id, n.options.map((o) => o.id), m.present);
    const w = n.options.find((o) => o.id === r.winner);
    m.result[id] = { yes: 0, no: 0, abstain: r.abstain, passed: !!w, ...(w ? { winner: w.name } : {}), counts: r.counts };
    // (none chosen: the need waits another whole day before it is put up again)
    const seen = needSeen.get(needKey(village, n.need));
    if (seen) seen.since = now;
    if (w) {
      const st = state(village);
      (st.needChoices ??= []).push({ need: n.need, option: w.option, name: w.name, day: m.day + 1, until: m.day + 2 });
      logAct({ type: 'rule', village, op: 'need vote', need: n.need, option: w.option, name: w.name, counts: r.counts, from: m.day + 1, until: m.day + 2 });
    }
  }
  logAct({ type: 'meeting', village, day: m.day, op: 'tally', present: m.present, cast: Object.keys(m.cast).length, result: m.result });
  console.log(`[council] ${village}: day ${m.day}'s vote: ${Object.entries(m.result).map(([id, r]) => (r.counts ? `${id} ${r.winner ? `chose "${r.winner}"` : 'chose none'} ${JSON.stringify(r.counts)}` : `${id} ${r.passed ? 'passed' : 'failed'} ${r.yes}-${r.no} (${r.abstain} abstained)`)).join('; ')}`);
  touchMemory();
}
