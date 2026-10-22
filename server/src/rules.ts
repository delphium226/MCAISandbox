/**
 * Village rules (G3, PLAN E.6, #30; spec runs/2026-10-21/g3-rules/spec.md): typed rules with parameters in bands code
 * allows, a law (a member's proposed rule) read from its words or its typed fields, code's neutral text, the rules in
 * force, and the predicates the world enforces them by. World-free: the world asks whether an option breaks a rule (the
 * items it takes from storage, its kind), records what members take, and logs compliance; the council (council.ts)
 * passes laws into rules. Kept in the village's social memory (memory.ts' store: `rules`, `laws`, `takes`).
 *
 * Enforced by code: `quota` (items of a class a member takes from storage a day: tools, logs, torches; never food) and
 * `floor` (a storage minimum an option's takes may not cross; never meals, carries or builds) remove options from the
 * menu with the rule named. Measured: `duty` (tagged and ranked first, not forced: spec 13), `levy` (the members' own
 * choice; its share answers wait for MC_OWN's pending shares, own.ts), `norm` (counted by kind). `zone` is refused for
 * now (site search and placement are not this module's).
 *
 * Settings: MC_RULES off (default) | on: the store, the rules line, enforcement, compliance logs.
 */
import { KIND_WORDS, clockOf, logAct, touchMemory, villageSocialOf } from './memory';
import type { Rule } from './social';

export const RULES = { on: /^(on|1|true|yes)$/i.test(process.env.MC_RULES ?? '') };
/** Test hook. */
export function setRulesSettings(s: Partial<typeof RULES>): void {
  Object.assign(RULES, s);
}

export const RULE_TYPES = ['quota', 'floor', 'zone', 'duty', 'levy', 'norm'] as const;
export type RuleType = (typeof RULE_TYPES)[number];
export const QUOTA_CLASSES = ['tools', 'logs', 'torches'] as const;
export type QuotaClass = (typeof QUOTA_CLASSES)[number];

/** A member's proposed rule, from the night's `propose` (kind law) until its ballot. */
export interface Law {
  id: string;
  by: string;
  at: number;
  day: number;
  type: RuleType;
  params: Record<string, number | string>;
  text: string;
  what: string;
  why: string;
  backers: string[];
  opposers: string[];
  status: 'open' | 'agenda' | 'passed' | 'failed' | 'lapsed' | 'refused';
  /** Why code refused it (out of band, not built). */
  refused?: string;
  ballotDay?: number;
  result?: { yes: number; no: number; abstain: number; voters: number };
}

interface RulesState {
  next: number;
  laws: Law[];
  /** Items of a quota class taken from storage, by member, day and class. */
  takes: Record<string, number>;
}

function state(village: string): RulesState {
  const s = villageSocialOf(village) as { council?: RulesState };
  return (s.council ??= { next: 1, laws: [], takes: {} });
}
function rulesOf(village: string): Rule[] {
  const s = villageSocialOf(village) as { rules?: Rule[] };
  return (s.rules ??= []);
}

export const rulesInForce = (village: string): Rule[] => (villageSocialOf(village) as { rules?: Rule[] }).rules?.filter((r) => !r.supersededBy) ?? [];
export const laws = (village: string): Law[] => state(village).laws;
export const law = (village: string, id: string) => state(village).laws.find((l) => l.id === id);
const dayOf = (village: string, now: number) => clockOf(village, now)?.day ?? Math.floor(now / (20 * 60000));

// ---------------------------------------------------------------------------------------------
// Bands, reading and words
// ---------------------------------------------------------------------------------------------

const kindOfWord = (w: string): string | undefined => {
  const f = w.toLowerCase().trim();
  if (KIND_WORDS[f]) return f;
  return Object.entries(KIND_WORDS).find(([, x]) => x === f || f.includes(x) || x.includes(f))?.[0];
};

/** Why a rule's parameters are out of their band (spec 3), or null. */
export function validate(type: RuleType, p: Record<string, number | string>): string | null {
  switch (type) {
    case 'quota':
      if (!(QUOTA_CLASSES as readonly string[]).includes(String(p.class))) return 'a quota is on tools, logs or torches taken from storage (never food)';
      return Number.isInteger(Number(p.n)) && Number(p.n) >= 1 && Number(p.n) <= 64 ? null : 'a quota must be 1 to 64 a day';
    case 'floor':
      if (!p.item || typeof p.item !== 'string') return 'a floor needs an item storage keeps';
      return Number.isInteger(Number(p.n)) && Number(p.n) >= 0 && Number(p.n) <= 256 ? null : 'a floor must be 0 to 256';
    case 'duty':
      return p.kind && KIND_WORDS[String(p.kind)] && p.kind !== 'eat' && p.kind !== 'tidy' && p.kind !== 'task' ? null : 'a duty needs a kind of work';
    case 'levy':
      return [0, 10, 20, 30, 40, 50].includes(Number(p.rate)) ? null : 'a levy is 0 to 50% in steps of 10';
    case 'norm':
      return typeof p.text === 'string' && p.text.trim().length >= 8 ? null : 'a norm needs words';
    case 'zone':
      return 'zones are not built yet';
  }
}

/** Code's neutral words for a rule. */
export function ruleText(type: RuleType, p: Record<string, number | string>): string {
  switch (type) {
    case 'quota': return `each member takes at most ${p.n} ${p.class} a day from storage`;
    case 'floor': return `storage keeps at least ${p.n} ${String(p.item).replace(/_/g, ' ')}`;
    case 'duty': return `every member does ${KIND_WORDS[String(p.kind)] ?? p.kind} once a day`;
    case 'levy': return `members leave ${p.rate}% of their share in the village storage`;
    case 'norm': return String(p.text).slice(0, 120);
    case 'zone': return `${p.area} is kept for ${p.for}`;
  }
}

/** A kind's words as a loose pattern ("tending pens": tend.. pens..), so "tends pens" finds it. */
const stems = (w: string) => new RegExp(`\\b${w.split(' ').map((x) => (x.length > 4 ? `${x.slice(0, 4)}\\w*` : `${x}\\w*`)).join(' ')}`, 'i');
/** An item word made singular: torches, boxes, logs. */
const singular = (w: string) => (/(ch|sh|x)es$/.test(w) ? w.slice(0, -2) : /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);

const CLASS_WORDS: Array<[RegExp, QuotaClass]> = [[/\b(logs?|wood|planks?)\b/i, 'logs'], [/\btorch(es)?\b/i, 'torches'], [/\b(tools?|pickaxes?|axes?|hoes?|shovels?|swords?|buckets?|shears|rods?)\b/i, 'tools']];

/** A law's type and parameters from a `propose` object (typed `rule: {type, params}`, else read from its words). */
export function readLaw(raw: Record<string, unknown>): { type: RuleType; params: Record<string, number | string> } {
  const r = (raw.rule && typeof raw.rule === 'object' ? raw.rule : {}) as Record<string, unknown>;
  const t = String(r.type ?? raw.type ?? '').toLowerCase();
  const p = (r.params && typeof r.params === 'object' ? r.params : {}) as Record<string, number | string>;
  const text = `${raw.what ?? ''} ${raw.text ?? ''}`.trim();
  if ((RULE_TYPES as readonly string[]).includes(t) && t !== 'norm' && Object.keys(p).length) return { type: t as RuleType, params: p };
  const num = (re: RegExp) => Number(re.exec(text)?.[1] ?? NaN);
  const cls = CLASS_WORDS.find(([re]) => re.test(text))?.[1];
  const at = num(/\bat most (\d+)/i);
  if (cls && Number.isFinite(at) && /\b(a|per|each) day\b/i.test(text)) return { type: 'quota', params: { class: cls, n: at } };
  const least = /\b(keep|keeps|always)\b.*?\bat least (\d+) ([a-z_ ]+?)(\b(in|at)\b|[.,;]|$)/i.exec(text);
  if (least) return { type: 'floor', params: { item: singular(least[3].trim().replace(/ /g, '_')), n: Number(least[2]) } };
  const rate = num(/(\d+)\s*%/);
  if (/\b(levy|tax|share)\b/i.test(text) && Number.isFinite(rate)) return { type: 'levy', params: { rate: Math.round(rate / 10) * 10 } };
  const duty = /\bevery (member|one|villager)\b.*?\b(once|one time) a day\b/i.test(text) ? Object.keys(KIND_WORDS).find((k) => k !== 'eat' && k !== 'tidy' && k !== 'task' && stems(KIND_WORDS[k]).test(text)) : undefined;
  if (duty) return { type: 'duty', params: { kind: duty } };
  if (t === 'duty' && typeof p.kind === 'string') return { type: 'duty', params: { kind: kindOfWord(p.kind) ?? p.kind } };
  return { type: 'norm', params: { text } };
}

// ---------------------------------------------------------------------------------------------
// Laws and rules
// ---------------------------------------------------------------------------------------------

/** A member's law, read and checked: one out of band is kept as refused with code's reason (told to the member). */
export function addLaw(village: string, by: string, raw: Record<string, unknown>, now: number): Law {
  const st = state(village);
  const { type, params } = readLaw(raw);
  const bad = validate(type, params);
  const l: Law = {
    id: `l${st.next++}`, by, at: now, day: dayOf(village, now), type, params, text: bad ? '' : ruleText(type, params),
    what: String(raw.what ?? raw.text ?? '').slice(0, 140), why: String(raw.why ?? raw.reason ?? '').slice(0, 240), backers: [], opposers: [],
    status: bad ? 'refused' : 'open', ...(bad ? { refused: bad } : {}),
  };
  st.laws.push(l);
  logAct({ type: 'law', village, agent: by, id: l.id, rule: type, params, text: l.text, status: l.status, ...(bad ? { refused: bad } : {}) });
  touchMemory();
  return l;
}

/** Backing or opposing an open law (once a member, never one's own). */
export function backLaw(village: string, id: string, by: string, oppose = false): boolean {
  const l = law(village, id);
  if (!l || l.by === by || (l.status !== 'open' && l.status !== 'agenda') || l.backers.includes(by) || l.opposers.includes(by)) return false;
  (oppose ? l.opposers : l.backers).push(by);
  logAct({ type: 'law', village, agent: by, id, op: oppose ? 'oppose' : 'back' });
  touchMemory();
  return true;
}

/** A passed law into force: a rule of the same type and target is superseded. */
export function enact(village: string, l: Law, votes: { yes: number; no: number; abstain: number }, now: number): Rule {
  const all = rulesOf(village);
  const r: Rule = { id: `r${l.id}`, type: l.type as Rule['type'], params: l.params, text: l.text, since: now, votedBy: votes };
  const target = (x: Rule) => (x.type === 'quota' ? x.params.class : x.type === 'floor' ? x.params.item : x.type === 'duty' ? x.params.kind : x.type);
  for (const old of all) if (!old.supersededBy && old.type === r.type && target(old) === target(r)) old.supersededBy = r.id;
  all.push(r);
  logAct({ type: 'rule', village, op: 'enacted', id: r.id, rule: r.type, params: r.params, text: r.text, votes, from: l.id });
  touchMemory();
  return r;
}

/** The decision prompt's line: the rules in force ('' when none). */
export function rulesLine(village: string): string {
  if (!RULES.on) return '';
  const rs = rulesInForce(village);
  return rs.length ? `Village rules (voted): ${rs.map((r) => r.text).join('; ')}.` : '';
}

// ---------------------------------------------------------------------------------------------
// Enforcement and compliance
// ---------------------------------------------------------------------------------------------

/** An item's quota class, or undefined (food never). */
export function classOf(item: string): QuotaClass | undefined {
  if (/_log$|_planks$|^logs$/.test(item)) return 'logs';
  if (item === 'torch') return 'torches';
  if (/(_pickaxe|_axe|_shovel|_hoe|_sword|^shears|^fishing_rod|^bucket)$/.test(item)) return 'tools';
  return undefined;
}

/**
 * Why an option breaks a rule in force, or null (spec 3, 13): its takes from storage over the member's quota left today,
 * or below a floor; never a meal (the caller does not ask for meals, carries or builds).
 */
export function breaks(village: string, agent: string, takes: Record<string, number>, store: Record<string, number>, now: number): string | null {
  if (!RULES.on) return null;
  const rs = rulesInForce(village);
  if (!rs.length) return null;
  const st = state(village);
  const day = dayOf(village, now);
  for (const r of rs) {
    if (r.type === 'quota') {
      const cls = String(r.params.class);
      const want = Object.entries(takes).filter(([i]) => classOf(i) === cls).reduce((s, [, n]) => s + n, 0);
      if (want && (st.takes[`${agent}|${day}|${cls}`] ?? 0) + want > Number(r.params.n)) return `the quota: ${r.text}`;
    } else if (r.type === 'floor') {
      const item = String(r.params.item);
      const want = takes[item] ?? 0;
      if (want && (store[item] ?? 0) - want < Number(r.params.n)) return `the floor: ${r.text}`;
    }
  }
  return null;
}

/** What a member's chore took from storage (the world, at its start), for the quotas. */
export function noteTakes(village: string, agent: string, takes: Record<string, number>, now: number): void {
  if (!RULES.on) return;
  const st = state(village);
  const day = dayOf(village, now);
  let any = false;
  for (const [item, n] of Object.entries(takes)) {
    const cls = classOf(item);
    if (!cls || n <= 0) continue;
    st.takes[`${agent}|${day}|${cls}`] = (st.takes[`${agent}|${day}|${cls}`] ?? 0) + n;
    any = true;
  }
  if (any) touchMemory();
}

/** The duties in force (kinds), for the menu's tag and rank. */
export const duties = (village: string): string[] => (RULES.on ? rulesInForce(village).filter((r) => r.type === 'duty').map((r) => String(r.params.kind)) : []);

/** A refusal or a tagged duty, into the ledger (rules_use.py reads it). */
export function noteCompliance(village: string, agent: string, rec: Record<string, unknown>): void {
  logAct({ type: 'compliance', village, agent, ...rec });
}

/** Code's dry-run preview of a quota over the last 3 village days (spec 13): the takes it would have refused. */
export function preview(village: string, type: RuleType, p: Record<string, number | string>, now: number): string {
  if (type !== 'quota') return '';
  const st = state(village);
  const day = dayOf(village, now);
  let refused = 0;
  const who = new Set<string>();
  for (const [k, n] of Object.entries(st.takes)) {
    const [agent, d, cls] = k.split('|');
    if (cls !== p.class || Number(d) < day - 3) continue;
    if (n > Number(p.n)) {
      refused += n - Number(p.n);
      who.add(agent);
    }
  }
  return `over the last 3 days it would have refused ${refused} ${p.class} taken by ${who.size} member${who.size === 1 ? '' : 's'}`;
}
