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
import { KIND_WORDS, agentMemory, clockOf, logAct, membersOf, touchMemory, villageSocialOf } from './memory';
import { FOOD_POINTS } from './appetite';
import type { Rule } from './social';
import type { Village } from './village';
import { rawSetting } from './settings';
import { customOf, noteStarted } from './customs';
import { modeSpec } from './worldMode';

const isFood = (item: string) => item in FOOD_POINTS;

export const RULES = {
  on: /^(on|1|true|yes)$/i.test(rawSetting('MC_RULES') ?? ''),
  /** A levy in force from the start, set by code (Experiment 2's imposed base, `MC_LEVY=0.2`), until a voted one replaces it. */
  levy: Number.isFinite(Number(rawSetting('MC_LEVY'))) && rawSetting('MC_LEVY') ? Math.min(0.5, Math.max(0, Number(rawSetting('MC_LEVY')))) : undefined as number | undefined,
  /** Experiment 2: a pending share is asked once it holds at least this many items (MC_LEVY_MIN, default 1: G3m1's shares
   *  were 1-4 items, the levy of 1 the same as all, so every answer paid). */
  levyMin: Math.max(1, Number(rawSetting('MC_LEVY_MIN')) || 1),
  /** #164 (MC_RULE_WORDS): a norm's ballot line says code will not enforce or count it. */
  words: /^(on|1|true|yes)$/i.test(rawSetting('MC_RULE_WORDS') ?? ''),
  /** #164 (MC_RULE_FEASIBLE): a duty's or contribution's ballot line says how many members did it yesterday. */
  feasible: /^(on|1|true|yes)$/i.test(rawSetting('MC_RULE_FEASIBLE') ?? ''),
  /** #164 (MC_RULE_RESULTS): the rules in force with their results in code's counts (night prompt and ballot). */
  results: /^(on|1|true|yes)$/i.test(rawSetting('MC_RULE_RESULTS') ?? ''),
  /** #164 (MC_RULE_TYPES, a list of claim, report and stock): the rule types read from members' words beside G3's: a claim on
   *  shared work posted on the board, a report of a trip's find or failure, and contributions and floors of ore, seeds,
   *  fuel and buckets. */
  types: new Set((rawSetting('MC_RULE_TYPES') ?? '').toLowerCase().split(/[\s,]+/).filter((x) => x === 'claim' || x === 'report' || x === 'stock')),
};
/** Test hook. */
export function setRulesSettings(s: Partial<typeof RULES>): void {
  Object.assign(RULES, s);
}

/** Survival stage (d), spec 2 (MC_SAFETY_RULES, on; with monsters only): the curfew is read from members' words and kept. */
export const safetyOn = (): boolean => modeSpec().mobs && !/^(off|0|false|no)$/i.test(rawSetting('MC_SAFETY_RULES') ?? 'on');
/** The curfew's band: blocks from home, and from which phase until dawn. */
const CURFEW_MIN = 32, CURFEW_MAX = 128, CURFEW_DEFAULT = 64;
/** The world's danger counts for a village (mcCombat's, set by the world): the deaths' fact and the last night's counts. */
let dangerFacts: (village: string) => { fact: string; lastNight?: { out: number; deaths: number } } | null = () => null;
export function setDangerFacts(fn: typeof dangerFacts): void {
  dangerFacts = fn;
}

export const RULE_TYPES = ['quota', 'floor', 'zone', 'duty', 'levy', 'contribute', 'norm', 'repeal', 'claim', 'report', 'curfew'] as const;
export type RuleType = (typeof RULE_TYPES)[number];
export const QUOTA_CLASSES = ['tools', 'logs', 'torches'] as const;
export type QuotaClass = (typeof QUOTA_CLASSES)[number];
/** What a `contribute` rule asks each member to put into storage a day (the user's, 10-23: the members' own most-proposed
 *  rule in Long1, "each member deposits at least one torch a day"); `goods` is anything. #164's stock classes (ore, seeds,
 *  fuel, bucket) only with MC_RULE_TYPES' stock. */
export const PUT_CLASSES = ['logs', 'torches', 'tools', 'food', 'stone', 'goods', 'ore', 'seeds', 'fuel', 'bucket'] as const;
export type PutClass = (typeof PUT_CLASSES)[number];
/** #164's stock classes: 15 of the 80 norms of train 7 and G3m1 kept or put ore, seeds, fuel or a bucket. */
export const STOCK_CLASSES = ['ore', 'seeds', 'fuel', 'bucket'] as const;
/** #164: the shared work a claim holds on the board (the iron level, the land by each house for its own farm, the greens'
 *  free plots), and the claim's minutes in code's band. */
export const CLAIM_WORKS = ['iron', 'farm_site', 'green'] as const;
export type ClaimWork = (typeof CLAIM_WORKS)[number];
const CLAIM_WORDS: Record<ClaimWork, string> = { iron: 'the iron level', farm_site: 'the land by a house for its own farm', green: "a green's free plots" };
const CLAIM_MIN = 3, CLAIM_MAX = 15, CLAIM_DEFAULT = 10;

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
  /** Members whose own proposal of the same rule joined this one (counted among the backers; the user's, 10-23). */
  joined?: string[];
  ballotDay?: number;
  result?: { yes: number; no: number; abstain: number; voters: number };
}

interface RulesState {
  next: number;
  laws: Law[];
  /** Items of a quota class taken from storage, by member, day and class. */
  takes: Record<string, number>;
  /** Goods of a put class a member's chores put into storage (net of what they took), by member, day and class. */
  puts?: Record<string, number>;
  /** What each option's runs have put into storage, by option id and put class (a contribute rule tags the options that do). */
  optionPuts?: Record<string, Record<string, number>>;
  /** Village days whose compliance has been logged. */
  judged?: number;
  /** #164: claims posted on the board (the live ones and the last hour's). */
  claims?: Claim[];
  /** #164: reports posted on the board, and each member's report waiting for its choice to post it. */
  reports?: Report[];
  pendingReports?: Record<string, PendingReport>;
  reportNext?: number;
  /** #164: counts by `what|work|day` (blocked, waited, posted, skipped, used: the results lines). */
  counts?: Record<string, number>;
}

/** #164: a claim on shared work, posted on the board by the member who started it, held until `until`. */
export interface Claim { work: ClaimWork; key: string; by: string; at: number; until: number; label: string; rule: string }
/** #164: a trip's find or failure, posted on the board (a fact on other members' options of the same work until `until`). */
export interface Report { id: string; by: string; at: number; until: number; option: string; text: string }
export interface PendingReport { option: string; text: string; at: number }

function state(village: string): RulesState {
  const s = villageSocialOf(village) as { council?: RulesState };
  return (s.council ??= { next: 1, laws: [], takes: {} });
}
/** A rule a repeal ended (#164): superseded by the repeal's id, with no successor rule, from `repealedAt`. */
type RepealedRule = Rule & { repealedAt?: number };
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
      if (p.class !== undefined) return [...QUOTA_CLASSES, 'food', ...(RULES.types.has('stock') ? STOCK_CLASSES : [])].includes(String(p.class)) && Number.isInteger(Number(p.n)) && Number(p.n) >= 0 && Number(p.n) <= 256 ? null : 'a floor must be 0 to 256 of an item';
      if (!p.item || typeof p.item !== 'string') return 'a floor needs an item storage keeps';
      return Number.isInteger(Number(p.n)) && Number(p.n) >= 0 && Number(p.n) <= 256 ? null : 'a floor must be 0 to 256';
    case 'duty':
      return p.kind && KIND_WORDS[String(p.kind)] && p.kind !== 'eat' && p.kind !== 'tidy' && p.kind !== 'task' ? null : 'a duty needs a kind of work';
    case 'levy':
      return [0, 10, 20, 30, 40, 50].includes(Number(p.rate)) ? null : 'a levy is 0 to 50% in steps of 10';
    case 'contribute':
      if (!String(p.class).split('+').every((c) => (PUT_CLASSES as readonly string[]).includes(c) && (RULES.types.has('stock') || !(STOCK_CLASSES as readonly string[]).includes(c)))) return `a contribution is logs, torches, tools, food, stone${RULES.types.has('stock') ? ', ore, seeds, fuel, a bucket' : ''} or any goods put into storage`;
      return Number.isInteger(Number(p.n)) && Number(p.n) >= 1 && Number(p.n) <= 64 ? null : 'a contribution must be 1 to 64 a day';
    case 'norm':
      return typeof p.text === 'string' && p.text.trim().length >= 8 ? null : 'a norm needs words';
    case 'repeal':
      return typeof p.of === 'string' && /^r/.test(p.of) && p.rule ? null : 'a repeal must name a rule in force by its id (as [rl5]); the levy changes by its own vote';
    case 'claim':
      if (!(CLAIM_WORKS as readonly string[]).includes(String(p.work))) return 'a claim holds the iron level, the land by a house for its own farm, or a green\'s free plots';
      return Number.isInteger(Number(p.min)) && Number(p.min) >= CLAIM_MIN && Number(p.min) <= CLAIM_MAX ? null : `a claim holds ${CLAIM_MIN} to ${CLAIM_MAX} minutes`;
    case 'report':
      return null;
    case 'curfew':
      if (p.phase !== 'dusk' && p.phase !== 'night') return 'a curfew holds from dusk or from nightfall until dawn';
      return Number.isInteger(Number(p.dist)) && Number(p.dist) >= CURFEW_MIN && Number(p.dist) <= CURFEW_MAX ? null : `a curfew keeps members within ${CURFEW_MIN} to ${CURFEW_MAX} blocks of home`;
    case 'zone':
      if (p.use !== 'nobuild' && p.use !== 'farms') return 'a zone keeps a place free of building, or for farms only';
      return [p.x1, p.z1, p.x2, p.z2].every((x) => Number.isFinite(Number(x))) ? null : `a zone must name a place of the village (${ZONE_PLACES})`;
  }
}

/** Code's neutral words for a rule. */
export function ruleText(type: RuleType, p: Record<string, number | string>): string {
  switch (type) {
    case 'quota': return `each member takes at most ${p.n} ${p.class} a day from storage`;
    case 'floor': return `storage keeps at least ${p.n} ${String(p.class ?? p.item).replace(/_/g, ' ')}`;
    case 'contribute': {
      // (one of a class in the singular: "1 torch", "1 item", not "1 goods")
      const one: Record<string, string> = { torches: 'torch', logs: 'log', tools: 'tool', food: 'food item', stone: 'stone', goods: 'item' };
      const words = String(p.class).split('+').map((c) => (Number(p.n) === 1 ? one[c] ?? c : c === 'goods' ? 'items' : c));
      return `each member puts at least ${p.n} ${words.join(' or ')} a day into storage`;
    }
    case 'duty': return `every member does ${KIND_WORDS[String(p.kind)] ?? p.kind} once a day`;
    case 'levy': return `members leave ${p.rate}% of their share in the village storage`;
    case 'norm': return String(p.text).slice(0, 120);
    case 'repeal': return `repeal the rule [${p.of}] "${p.rule}"`;
    case 'zone': return p.use === 'farms' ? `${p.place ?? p.area} is kept for farms` : `nothing new is built on ${p.place ?? p.area}`;
    case 'claim': return p.work === 'farm_site'
      ? 'the land by each member\'s house is kept for its own farm, posted on the board by the storage hut; others\' farms keep off it'
      : `a member who starts on ${CLAIM_WORDS[p.work as ClaimWork] ?? p.work} posts a claim on the board by the storage hut; the others keep off it for ${p.min} minutes`;
    case 'report': return 'a member whose trip found or failed something posts it on the board by the storage hut';
    case 'curfew': return `no member goes more than ${p.dist} blocks from home from ${p.phase === 'dusk' ? 'dusk' : 'nightfall'} until dawn`;
  }
}

// ---------------------------------------------------------------------------------------------
// Zones: a place of the village kept free of building, or for farms only (site search and placement keep off it)
// ---------------------------------------------------------------------------------------------

const ZONE_PLACES = 'a neighbourhood by its name, the green, the storage hut, the mine, the pens, the works or the fields';

/** A zone's words: nothing built on a place ("no new buildings on the north green", "keep the green clear"), or a place kept
 *  for farms ("the fields are kept for farming"). The place stays words until code finds it (placeArea). */
export function readZone(raw: string): { area: string; use: 'nobuild' | 'farms' } | null {
  // (the clause before any purpose: "..., so", "to keep", "because"; the zone's words must open it)
  const s = raw.trim().split(/,? (?:and |so |so that |to keep |because |in order to )/i)[0].replace(/^(?:a rule:|rule:|that) /i, '');
  const place = (x: string) => x.trim().replace(/^(the|our|a) /i, '').replace(/ (area|zone|space|land)$/i, '');
  const farm = /^(?:the )?([a-z][a-z' ]{2,40}?) (?:is|are|stays?|shall be|must be|should be) (?:kept |reserved |used |left )?(?:only )?for (?:farms?|farming|fields?|crops?)\b/i.exec(s)
    ?? /^only (?:farms?|fields?|crops?) (?:may |can )?(?:be )?(?:on|in|at|placed on|planted on) (?:the )?([a-z][a-z' ]{2,40}?)[.!]?$/i.exec(s);
  if (farm) return { area: place(farm[1]), use: 'farms' };
  const nob = /^(?:nothing|no (?:new )?(?:buildings?|houses?|structures?|works|construction|building))\b(?: new)?(?: (?:is|are|may|can|shall|should|must|will))?(?: be)?(?: (?:built|placed|put up|constructed|added|raised))? (?:on|in|at|inside|within) (?:the )?([a-z][a-z' ]{2,40}?)[.!]?$/i.exec(s)
    ?? /^keep (?:the )?([a-z][a-z' ]{2,40}?) (?:free|clear|open|empty)(?: of (?:new )?(?:building|buildings|houses|structures))?[.!]?$/i.exec(s);
  if (nob) return { area: place(nob[1]), use: 'nobuild' };
  return null;
}

type Box = { x1: number; z1: number; x2: number; z2: number };
const isBox = (a: unknown): a is Box => !!a && typeof a === 'object' && ['x1', 'z1', 'x2', 'z2'].every((k) => Number.isFinite((a as Record<string, number>)[k]));

/** The village's named places with their rectangles: neighbourhoods by name, the first green, the storage hut, the mine's
 *  hut, the annex (pens), the works plot, and the fields (field works, not members' own). */
export function places(v: Village): Array<{ name: string; words: RegExp; box: Box }> {
  const out: Array<{ name: string; words: RegExp; box: Box }> = [];
  const ls = v.layouts ?? [];
  for (const l of ls) if (l.name) out.push({ name: l.name, words: new RegExp(`\\b${l.name.toLowerCase().replace(/[^a-z ]/g, '')}\\b`), box: l });
  const green = ls.find((l) => isBox(l.green))?.green;
  if (green) out.push({ name: 'the green', words: /\b(green|park|square|common)\b/, box: green });
  if (v.storageHut) out.push({ name: 'the storage hut', words: /\b(storage|store ?house|store)\b/, box: v.storageHut });
  if (v.mine?.hut) out.push({ name: 'the mine', words: /\bmin(e|ing)\b/, box: v.mine.hut });
  const annex = ls[0]?.annex as unknown;
  if (isBox(annex)) out.push({ name: 'the pens', words: /\b(annex|pens?|animals?)\b/, box: annex });
  const works = ls[0]?.works as unknown;
  if (isBox(works)) out.push({ name: 'the works', words: /\b(works|furnaces?|smithy|forge)\b/, box: works });
  const fields = ls.filter((l) => l.field && !l.owner);
  if (fields.length) out.push({ name: 'the fields', words: /\b(fields?|farmland|farms?)\b/, box: { x1: Math.min(...fields.map((f) => f.x1)), z1: Math.min(...fields.map((f) => f.z1)), x2: Math.max(...fields.map((f) => f.x2)), z2: Math.max(...fields.map((f) => f.z2)) } });
  return out;
}

/** The place a zone's words name (a neighbourhood's name first, then the kinds of place), or null. */
export function placeArea(v: Village, words: string): { name: string; box: Box } | null {
  const w = words.toLowerCase().replace(/[^a-z' ]/g, ' ');
  // (the whole phrase is the place: its words, with "north", "village", "main" and the like, leave nothing over; "the path
  // to the mine" is not the mine, the review's 1)
  const whole = (re: RegExp) => !w.replace(new RegExp(re.source, 'g'), ' ').replace(/\b(the|our|village'?s?|main|central|old|new|big|small|north|south|east|west|northern|southern|eastern|western|near|area|hut|plot|ground|space)\b/g, ' ').trim();
  const ps = places(v);
  const p = ps.find((x) => x.words.test(w) && /^[A-Z]/.test(x.name) && whole(x.words)) ?? ps.find((x) => x.words.test(w) && whole(x.words));
  return p ? { name: p.name, box: { x1: p.box.x1, z1: p.box.z1, x2: p.box.x2, z2: p.box.z2 } } : null;
}

/** The world's village by name, for zones (registered by the world at its start; none in checks without a world). */
let villageOf: ((village: string) => Village | undefined) | null = null;
export function setZoneVillages(fn: (village: string) => Village | undefined): void {
  villageOf = fn;
}

/** The zones in force whose use forbids `use` (a place kept free forbids building and farms; kept for farms, building). */
export function zoneBoxes(village: string, use: 'build' | 'farm'): Array<Box & { text: string }> {
  if (!RULES.on) return [];
  return rulesInForce(village).filter((r) => (r.type as RuleType) === 'zone' && (r.params.use === 'nobuild' || use === 'build'))
    .map((r) => ({ x1: Number(r.params.x1), z1: Number(r.params.z1), x2: Number(r.params.x2), z2: Number(r.params.z2), text: r.text }));
}

/** Why `area` breaks a zone in force for `use`, or null (village.ts conflictOf, the site searches). */
export function zoneConflict(village: string, area: Box, use: 'build' | 'farm' = 'build'): string | null {
  const z = zoneBoxes(village, use).find((b) => area.x1 <= b.x2 && area.x2 >= b.x1 && area.z1 <= b.z2 && area.z2 >= b.z1);
  return z ? `the zone rule: ${z.text}` : null;
}

/** A kind's words as a loose pattern ("tending pens": tend.. pens..), so "tends pens" finds it. */
const stems = (w: string) => new RegExp(`\\b${w.split(' ').map((x) => (x.length > 4 ? `${x.slice(0, 4)}\\w*` : `${x}\\w*`)).join(' ')}`, 'i');
/** An item word made singular: torches, boxes, logs. */
const singular = (w: string) => (/seeds$/.test(w) ? w : /(ch|sh|x)es$/.test(w) ? w.slice(0, -2) : /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);

const CLASS_WORDS: Array<[RegExp, QuotaClass]> = [[/\b(logs?|wood|planks?)\b/i, 'logs'], [/\btorch(es)?\b/i, 'torches'], [/\b(tools?|pickaxes?|axes?|hoes?|shovels?|swords?|buckets?|shears|rods?)\b/i, 'tools']];
/** Words for what is put into storage, by put class (several classes, or a generic word, make `goods`). */
const PUT_WORDS: Array<[RegExp, PutClass]> = [
  [/\b(logs?|wood|planks?|timber)\b/i, 'logs'], [/\btorch(es)?\b/i, 'torches'],
  [/\b(tools?|pickaxes?|axes?|hoes?|shovels?|swords?|shears)\b/i, 'tools'],
  [/\b(food|meals?|bread|cooked|edible|eggs?|wheat|pies?|crops?|fish)\b/i, 'food'], [/\b(stone|cobblestone|cobble)\b/i, 'stone'],
];
const GENERIC = /\b(items?|resources?|materials?|goods|anything|things?|ores?|supplies)\b/i;
/** #164 (MC_RULE_TYPES' stock): the stock classes' words, read before G3's (a bucket is its own class, not a tool's). */
const STOCK_WORDS: Array<[RegExp, PutClass]> = [
  [/\b(ores?|raw (?:iron|copper|gold)|iron ore|copper ore)\b/i, 'ore'], [/\bseeds?\b/i, 'seeds'], [/\b(fuel|coal|charcoal)\b/i, 'fuel'], [/\bbuckets?\b/i, 'bucket'],
];
const stockWords = () => (RULES.types.has('stock') ? STOCK_WORDS : []);
/** Food words: a quota or floor on food is refused (never between a member and a meal: spec 13). */
const FOOD = /\b(food|meals?|bread|cooked|edible|pies?)\b/i;
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20 };
/** Number words and stacks as digits ("one stack of logs": 64 logs). */
const digits = (s: string) => s
  .replace(/\b(e\.g|i\.e)\.,?/gi, '').replace(/\b(?:a|one|1) (?:full )?stacks?(?: \(64\))? of\b/gi, '64')
  .replace(/\b(\d+|two|three|four) (?:full )?stacks of\b/gi, (_, n: string) => String(64 * (Number(n) || NUMBER_WORDS[n.toLowerCase()] || 1)))
  .replace(/\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty)\b(?= (?:\w+ ){0,3}?(?:logs?|torch|torches|tools?|items?|units?|stacks?|meals?|pieces?|pickaxes?|axes?|resources?|food|stone|cobblestone|bread|blocks?|planks?|saplings?|sticks?|iron|ores?|charcoal|coal|materials?|goods?|buckets?|seeds?|fuel)\b)/gi, (w) => String(NUMBER_WORDS[w.toLowerCase()]));
const DAILY = /\b(each|every|per|a|one) (day|night|evening|morning)\b|\bdaily\b|\bnightly\b|\bbefore (nightfall|sunset|dusk|night)\b|\bby (sunset|nightfall|dusk)\b|\bend of (each|the) day\b/i;
const STORAGE = /\b(storage|stores?|chests?|stockpile|supply|pool|woodshed|commons)\b/i;

/** A put class from the words naming what is put (one class named; several, or a generic word: goods). */
function putClass(raw: string): PutClass {
  const phrase = raw.replace(/\b(food|logs?|torch(?:es)?|tools?|stone|wood)\s+(items?|units?)\b/i, '$1').replace(/\bunits? of\b/i, '');
  const stock = stockWords().filter(([re]) => re.test(phrase)).map(([, c]) => c);
  // (#164: a stock class named wins over the tools' words, "a bucket"; "ore" is no generic word with stock on)
  const hits = new Set([...stock, ...PUT_WORDS.filter(([re, c]) => re.test(phrase) && !(c === 'tools' && stock.includes('bucket') && !/\b(tools?|pickaxes?|axes?|hoes?|shovels?|swords?|shears)\b/i.test(phrase))).map(([, c]) => c)]);
  if (!hits.size || GENERIC.test(phrase.replace(/\bunits?\b/i, '').replace(stock.includes('ore') ? /\bores?\b/gi : /^$/, ''))) return 'goods';
  // (several classes named, "logs or torches": any of them, the review's 5)
  return [...hits].sort().join('+') as PutClass;
}

/** Duty verbs and the kind they name (checked after storage and number rules; the first that matches). */
const DUTY_WORDS: Array<[RegExp, string]> = [
  [/\b(light|lights|lit)\b|\bplace\b.*\btorch(es)?\b.*\b(in|at|along|on)\b/i, 'light'], [/\b(help|helps|assist|assists|aid)\b/i, 'help'],
  [/\btend(s)?\b.*\bpens?\b|\b(feed|milk|shear)\b/i, 'penwork'], [/\bharvest(s)?\b/i, 'farm'], [/\bexplor(e|es)\b/i, 'explore'],
  [/\bfurnish(es)?\b/i, 'furnish'], [/\bbake(s)?\b/i, 'cake'], [/\bdig(s)?\b.*\biron\b/i, 'iron'], [/\b(gather|gathers|collect|collects|chop|chops|fell|fells)\b/i, 'gather'],
  [/\b(make|makes|craft|crafts|cook|cooks)\b/i, 'make'], [/\binnovat|\bresearch/i, 'innovate'],
];

/** A law's type and parameters from a `propose` object (typed `rule: {type, params}`, else read from its words). */
export function readLaw(raw: Record<string, unknown>): { type: RuleType; params: Record<string, number | string> } {
  const r = (raw.rule && typeof raw.rule === 'object' ? raw.rule : {}) as Record<string, unknown>;
  const t = String(r.type ?? raw.type ?? '').toLowerCase();
  const p = (r.params && typeof r.params === 'object' ? r.params : {}) as Record<string, number | string>;
  const text = `${raw.what ?? ''} ${raw.text ?? ''}`.trim();
  if ((RULE_TYPES as readonly string[]).includes(t) && t !== 'norm' && (t !== 'repeal' || RULES.results) && (t !== 'claim' && t !== 'report' || RULES.types.has(t)) && (t !== 'curfew' || safetyOn()) && Object.keys(p).length) {
    return { type: t as RuleType, params: t === 'claim' ? { min: CLAIM_DEFAULT, ...p } : t === 'curfew' ? { dist: CURFEW_DEFAULT, phase: 'night', ...p } : p };
  }
  // (survival (d), MC_SAFETY_RULES: a curfew from the whole sentence, before the storage rules: "be home by dusk" is no duty)
  if (safetyOn()) {
    const c = readCurfew(text);
    if (c) return { type: 'curfew', params: c };
  }
  // (#164, MC_RULE_RESULTS: a repeal opens the law and names a rule, by its id or in words; addLaw finds the rule in force)
  if (RULES.results && REPEAL.test(text) && (RULE_ID.test(text) || REPEAL_NAMES.test(text.split(/[,;.]/)[0]))) {
    return { type: 'repeal', params: { of: RULE_ID.exec(text)?.[1].toLowerCase() ?? '', text: text.slice(0, 200) } };
  }
  // (the first clause only: "take up to 30 logs a day, but leave at least 50" is the quota)
  const s = digits(text.split(/;|, but |\bbut\b|\bunless\b|\bexcept\b/i)[0]);
  const daily = DAILY.test(s);
  // a levy: a rate of members' shares
  const rate = /(\d+)\s*%/.exec(s);
  if (/\b(levy|tax|tithe|share)\b/i.test(s) && rate) return { type: 'levy', params: { rate: Math.round(Number(rate[1]) / 10) * 10 } };
  // a floor: storage keeps at least N (it must remain, a minimum kept, never below)
  const floor = /(?:^|\b(?:at least|a minimum of|minimum of|no fewer than|never (?:fewer|less) than|never below) )(\d+) ((?:[a-z_]+ ){0,2}?[a-z_]+) (?:(?:must|should|shall) )?(?:always )?(?:remain|stay|be kept|be left)\b/i.exec(s)
    ?? /\b(?:maintain|maintains|keep|keeps|hold|holds)\b (?:at least|a minimum of|minimum of) (\d+) ([a-z_ ]+?) (?:in|at) (?:the )?(?:\w+ )?(?:storage|stores?|chests?|stockpile)\b/i.exec(s)
    ?? /\b(?:storage|stores?|chests?|stockpile|supply)\b[^.]*?\b(?:keeps?|maintains?|retains?|holds?|has|have|contains?)\b[^.]*?\b(?:at least|a minimum of|minimum of|no fewer than) (\d+) ([a-z_ ]+?)(?:\b(?:in|at|for|to)\b|[.,;]|$)/i.exec(s)
    ?? /\b(?:leave|leaves|keep|keeps)\b (?:at least|a minimum of) (\d+) ([a-z_ ]+?) in (?:the )?(?:\w+ )?(?:storage|stores?|chests?)\b/i.exec(s);
  if (floor && !/\b(personal|own|their|his|her) (food )?(chest|stores?|reserve|inventory)\b/i.test(s)) {
    const words = floor[2].trim().replace(/^(units of|pieces of|of) /, '').replace(/ or .*$/, '');
    // (food in general is the class; a named food, "bread", stays an item)
    if (/\b(food|meals?|edible|cooked)\b/i.test(words)) return { type: 'floor', params: { class: 'food', n: Number(floor[1]) } };
    // (#164's stock classes first: "one empty bucket", "five seeds", "20 coal")
    const cls = stockWords().find(([re]) => re.test(words))?.[1] ?? CLASS_WORDS.find(([re]) => re.test(words))?.[1];
    // (a wood's logs stay an item, "birch logs": birch_log; any other class word is the class, "spare torches": torches)
    const wood = /^(oak|birch|spruce|jungle|acacia|dark oak|mangrove|cherry|pale oak) (logs?|planks?)$/.test(words);
    const item = singular(words.replace(/ /g, '_'));
    return { type: 'floor', params: cls && !wood ? { class: cls, n: Number(floor[1]) } : { item, n: Number(floor[1]) } };
  }
  // a quota: each member takes at most N of a class from storage a day
  const quota = /\b(?:take|takes|withdraw|withdraws|borrow|borrows|use|uses|reserve|reserves|remove|removes|draw|draws|request|requests)\b[^.]*?\b(?:at most|up to|no more than|a maximum of|maximum of|max(?:imum)?|only) (\d+) ([a-z0-9_ ]+?)(?:\b(?:from|out of|per|a|each|every|daily)\b|[.,;]|$)/i.exec(s)
    ?? /\b(?:at most|up to|no more than|a maximum of) (\d+) ([a-z_ ]+?) (?:may|can|per member|each)\b[^.]*\b(?:taken|withdrawn)\b/i.exec(s);
  if (quota && daily) {
    const words = quota[2];
    if (FOOD.test(words)) return { type: 'quota', params: { class: 'food', n: Number(quota[1]) } };
    const cls = CLASS_WORDS.find(([re]) => re.test(words))?.[1];
    if (cls) return { type: 'quota', params: { class: cls, n: Number(quota[1]) } };
  }
  // a contribution: each member puts at least N into storage a day
  const put = /\b(?:deposit|deposits|contribute|contributes|place|places|put|puts|add|adds|donate|donates|bring|brings|give|gives|store|stores|leave|leaves|supply|supplies|return|returns)\b[^.]*?\b(?:at least|a minimum of|minimum of|no fewer than)?\s*(\d+) ([a-z0-9_ ,()-]+?)\b(?:in|into|to|inside)\b/i.exec(s);
  if (put && daily && STORAGE.test(s.slice(put.index)) && !/\bweek|\bmonth/i.test(s)) {
    return { type: 'contribute', params: { class: putClass(put[2]), n: Number(put[1]) } };
  }
  // (#164, MC_RULE_TYPES: a claim on shared work before starting it, and a report of finds or failures, on the board; read
  // from the whole sentence, before zones: "reserve a 9x9 farm plot by their house" is the farm-site claim, the user's Q3)
  if (RULES.types.has('claim')) {
    const c = readClaim(text);
    if (c) return { type: 'claim', params: c };
  }
  if (RULES.types.has('report') && readReport(text)) return { type: 'report', params: { what: 'finds' } };
  // a zone: nothing is built on a place, or a place is kept for farms (only once the storage rules found nothing, and at a
  // clause's start: "...so nothing is built in a rush" is no zone, the review's 1; code finds the place: addLaw)
  const zone = readZone(text.split(/;|, but |\bbut\b|\bunless\b|\bexcept\b/i)[0]);
  if (zone) return { type: 'zone', params: zone };
  // a duty: every member does a kind of work once a day
  if (daily && /\b(each|every|all) (members?|villagers?|ones?|of us|residents?)\b/i.test(s) && !/\b(record|log|report|announce|return|deposit|deposits|donate|donates)\b/i.test(s)) {
    const k = DUTY_WORDS.find(([re]) => re.test(s))?.[1] ?? Object.keys(KIND_WORDS).find((x) => x !== 'eat' && x !== 'tidy' && x !== 'task' && stems(KIND_WORDS[x]).test(s));
    if (k) return { type: 'duty', params: { kind: k } };
  }
  if (t === 'duty' && typeof p.kind === 'string') return { type: 'duty', params: { kind: kindOfWord(p.kind) ?? p.kind } };
  return { type: 'norm', params: { text } };
}

/**
 * #164: a claim's work and minutes from a law's words, or null. Train 7's and G3m1's claim norms (norm_classes.txt): "post a
 * claim on the iron schedule board ... before digging for iron", "when a member begins digging a shared mine level, they must
 * post a brief notice", "announce when they begin digging a resource level"; and the kept plot (Q3): "reserve a 9x9 personal
 * farm plot within 24 blocks of their house", "maintain a clear 9x9 plot ... for personal farming". A building footprint is
 * not a claim code holds: it stays a norm.
 */
export function readClaim(text: string): { work: ClaimWork; min: number } | null {
  const s = text.toLowerCase();
  const min = Math.min(CLAIM_MAX, Math.max(CLAIM_MIN, Number(/(\d+)\s*(?:min\b|mins\b|minutes?\b)/.exec(s)?.[1]) || CLAIM_DEFAULT));
  // (the land by a house kept for its farm: a plot or 9x9 named with a house, kept, reserved or claimed)
  if (/\b(reserve|reserves|keep|keeps|maintain|maintains|claim|claims|hold|holds)\b/.test(s) && /\b(9 ?x ?9|9×9|plots?|farm sites?|farm land)\b/.test(s) && /\b(house|houses|home|homes|personal|own)\b/.test(s) && /\bfarm/.test(s)) return { work: 'farm_site', min };
  const verb = /\b(claims?|reserves?|announces?|posts?|registers?|books?|signs? up|notif(?:y|ies)|schedules?)\b/.test(s);
  const before = /\bbefore (?:they )?(?:start|starting|begin|beginning|dig|digging|work|working|mine|mining|attempt|attempting|commenc\w*|plant\w*|lay\w*|build\w*)\b|\bwhen (?:a member |they |members )?(?:begins?|starts?)\b|\bwait for (?:clearance|confirmation)\b|\bclaims?\b/.test(s);
  if (!verb || !before) return null;
  if (/\b(iron|mine|mining|shaft|tunnel|ore|resource level|dig level|levels?)\b/.test(s) && !/\bfootprint\b/.test(s)) return { work: 'iron', min };
  if (/\b(farm|field|plot|9 ?x ?9)\b/.test(s)) return { work: 'farm_site', min };
  if (/\bgreens?\b/.test(s)) return { work: 'green', min };
  return null;
}

/**
 * Survival (d): a curfew's band from a law's words, or null: "no one outside after dark", "be home by dusk", "no trips at
 * night", "stay within 64 blocks of the village at night". The distance named (blocks) is held to 32-128 (64 when none is
 * named); the phase is dusk when the words name dusk, sunset or the evening, else nightfall.
 */
export function readCurfew(text: string): { dist: number; phase: 'dusk' | 'night' } | null {
  const s = text.toLowerCase();
  const dark = /\b(after dark|in the dark|at night|after nightfall|by nightfall|before nightfall|after dusk|by dusk|before dusk|at dusk|by sunset|after sunset|before dark|by dark|nights?|nighttime|night-time|evenings?)\b/.test(s);
  if (!dark && !/\bcurfew\b/.test(s)) return null;
  const stay = /\bcurfew\b|\b(no one|nobody|no member|no villager|none of us)\b[^.]*\b(outside|out|leaves?|travels?|wanders?|goes|ventures?|beyond|past|away)\b|\bno (trips?|travel|journeys?|expeditions?|exploring|gathering trips?)\b|\b(be|get|return|come|head|go|stay|remain|keep)\b[^.]*\b(home|inside|indoors|within|in the village|near (?:the )?(?:village|home|storage))\b|\b(don't|do not|must not|should not|never)\b[^.]*\b(leave|travel|wander|venture|go far|go out)\b/.test(s);
  if (!stay) return null;
  const n = Number(/(\d+)\s*(?:blocks?|m\b|metres?|meters?)/.exec(s)?.[1]);
  const dist = Math.min(CURFEW_MAX, Math.max(CURFEW_MIN, Number.isFinite(n) && n > 0 ? n : CURFEW_DEFAULT));
  return { dist, phase: /\b(dusk|sunset|evenings?|before dark|by dark)\b/.test(s) ? 'dusk' : 'night' };
}

/** The curfew in force (survival (d)): its distance and phase, or null (none, the rules or the flag off, or no monsters). */
export function curfewBand(village: string): { dist: number; phase: 'dusk' | 'night' } | null {
  if (!RULES.on || !safetyOn()) return null;
  const r = rulesInForce(village).find((x) => (x.type as string) === 'curfew');
  return r ? { dist: Number(r.params.dist), phase: r.params.phase === 'dusk' ? 'dusk' : 'night' } : null;
}

/** #164: whether a law asks members to post a trip's finds or failures ("post its coordinates on the common board", "report
 *  any dead-end or blocked tunnel they discover", "record the amount of ore collected on the board"); not a record of takes. */
export function readReport(text: string): boolean {
  const s = text.toLowerCase();
  if (!/\b(reports?|posts?|records?|logs?|shares?|notes?|marks?|announces?|writes?)\b/.test(s)) return false;
  if (/\b(taken|takes|took|withdraw\w*) from storage\b/.test(s)) return false;
  return /\b(finds?|found|discover\w*|resource nodes?|coordinates|locations?|dead[- ]ends?|blocked|failures?|failed|veins?|sightings?|seen)\b/.test(s)
    || (/\b(ore|iron|sugar cane|resources?)\b/.test(s) && /\b(board|map)\b/.test(s));
}

const REPEAL = /^\s*(?:let us |let's |we should |i propose (?:to |that we )?)?(?:repeal|drop|abolish|scrap|revoke|rescind|cancel|end|lift|retire)\b/i;
const RULE_ID = /\[?\b(r(?:l\d+|levy-d\d+))\b\]?/i;
const REPEAL_NAMES = /\b(rules?|laws?|duty|quota|requirement|norm|contribution)\b/i;

/**
 * A law as the night's reply wrote it (F2xx: gpt-oss wrote Long1's 238 laws as their own key, {"dailyToolQuota": "Each
 * member may take..."}, and the `what` reader dropped every one): a string, {what|text|rule|description}, or a named key
 * whose value is a sentence or an object with one ({"charcoal_minimum": {"item": "charcoal", "minimum": 20}} read as words).
 * Null when there is none (null, {}, an empty or short string).
 */
export function lawFrom(raw: unknown): { what: string; why: string; rule?: unknown } | null {
  let o = raw;
  if (typeof o === 'string') {
    const s = o.trim();
    if (s.startsWith('{')) {
      try { o = JSON.parse(s); } catch { /* words */ }
    }
    if (typeof o === 'string') return s.length >= 8 && !NONE.test(s) && !TEMPLATE.test(s) ? { what: s.slice(0, 200), why: '' } : null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const why = String(r.why ?? r.reason ?? r.because ?? '').slice(0, 240);
  const direct = r.what ?? r.text ?? r.rule ?? r.law ?? r.description ?? r.proposal;
  if (typeof direct === 'string' && (TEMPLATE.test(direct) || NONE.test(direct.trim()))) return null;
  if (typeof direct === 'string' && direct.trim().length >= 8) return { what: direct.trim().slice(0, 200), why, ...(r.rule && typeof r.rule === 'object' ? { rule: r.rule } : {}) };
  if (direct && typeof direct === 'object') return lawFrom(direct);
  // (the longest sentence among the values, so a title, {law_name: "Torch rule", law_text: "..."}, does not win: the review's 8)
  const longest = Object.entries(r).filter(([k, v]) => !/^(why|reason|because|id|kind|type)$/i.test(k) && typeof v === 'string' && v.trim().includes(' '))
    .map(([, v]) => String(v).trim()).sort((a, b) => b.length - a.length)[0];
  if (longest && longest.length >= 12 && !TEMPLATE.test(longest)) return { what: longest.slice(0, 200), why };
  for (const [k, v] of Object.entries(r)) {
    if (/^(why|reason|because|id|kind|type)$/i.test(k)) continue;
    // (the sentence as the key, its value true, null or empty: lawbench, 10-23; the prompt's own template echoed is none,
    // and so is a key that says there is none, "No new law tonight")
    if (/\s/.test(k) && k.trim().length >= 16 && (v === true || v === null || v === '' || (typeof v === 'object' && !Object.keys(v as object).length))) {
      return TEMPLATE.test(k) || /^(no|none)\b.*\b(laws?|rules?|need)\b/i.test(k) ? null : { what: k.trim().slice(0, 200), why };
    }
    if (typeof v === 'string' && v.trim().length >= 8) return { what: v.trim().slice(0, 200), why };
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const x = v as Record<string, unknown>;
      const d = x.what ?? x.text ?? x.description ?? x.rule;
      if (typeof d === 'string' && d.trim().length >= 8) return { what: d.trim().slice(0, 200), why: String(x.why ?? x.reason ?? why).slice(0, 240) };
      // (fields only: a floor or a quota in its parts, read into words code's reader takes)
      const item = x.item ?? x.resource, n = x.minimum ?? x.min ?? x.at_least ?? x.max ?? x.maximum ?? x.limit ?? x.amount ?? x.quantity;
      if (typeof item === 'string' && Number.isFinite(Number(n))) {
        const name = k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
        const words = /min|floor|reserve|keep/.test(name) || x.minimum !== undefined || x.min !== undefined ? `Storage keeps at least ${n} ${item}` : /quota|max|limit/.test(name) ? `Each member takes at most ${n} ${item} a day from storage` : `${name}: ${n} ${item}`;
        return { what: words.replace(/_/g, ' '), why: String(x.why ?? x.reason ?? why).slice(0, 240) };
      }
    }
  }
  return null;
}

/** The prompt's own words echoed back ("a kind of work", "N of an item"), or a reply that there is none. */
const TEMPLATE = /\b(a kind of work|of an item)\b|\bN\b/;
const NONE = /^(none|no|n\/a|null|nothing)\.?$/i;

/** What two laws are about, so a second proposal of the same rule joins the first (type and target; a custom by its words). */
export function lawTarget(type: RuleType, p: Record<string, number | string>): string {
  switch (type) {
    case 'quota': return `quota:${p.class}`;
    case 'floor': return `floor:${p.class ?? p.item}`;
    case 'duty': return `duty:${p.kind}`;
    case 'contribute': return `contribute:${p.class}`;
    case 'levy': return 'levy';
    case 'zone': return `zone:${p.area}`;
    case 'norm': return `norm:${contentWords(String(p.text)).slice(0, 8).sort().join(' ')}`;
    case 'repeal': return `repeal:${p.of}`;
    case 'claim': return `claim:${p.work}`;
    case 'report': return 'report';
    case 'curfew': return 'curfew';
  }
}
const STOP = new Set('each every member members villager villagers must should shall may will their they them with from into that this have least most more than once day days daily before after other others village communal storage'.split(' '));
const contentWords = (t: string) => [...new Set(t.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.replace(/s$/, '')))];
/** Two customs are the same when most of their content words are shared (Jaccard 0.5 or more). */
function sameNorm(a: string, b: string): boolean {
  const x = new Set(contentWords(a)), y = new Set(contentWords(b));
  if (!x.size || !y.size) return false;
  const both = [...x].filter((w) => y.has(w)).length;
  return both / (x.size + y.size - both) >= 0.5;
}

// ---------------------------------------------------------------------------------------------
// Laws and rules
// ---------------------------------------------------------------------------------------------

/**
 * A member's law, read and checked: one out of band is kept as refused with code's reason (told to the member). The user's
 * (10-23, against Long1's 22 laws a night): a law with the same type and target as an open one joins it, its proposer
 * counted as a backer (`joined`); a member with a law of its own still open adds no second one (kept as refused, why).
 */
export function addLaw(village: string, by: string, raw: Record<string, unknown>, now: number): Law {
  const st = state(village);
  const { type, params } = readLaw(raw);
  // (a zone's place found on the village now: its name and rectangle kept with the rule)
  if (type === 'zone') {
    const v = villageOf?.(village);
    const pa = v ? placeArea(v, String(params.area)) : null;
    if (pa) Object.assign(params, { place: pa.name, ...pa.box });
  }
  // (#164: a repeal's rule in force, by its id, else the one whose words it shares most, 2 at least; never the levy)
  if (type === 'repeal') {
    const rs = rulesInForce(village).filter((r) => r.type !== 'levy');
    const words = contentWords(String(params.text ?? '').replace(REPEAL, ''));
    const shared = (r: Rule) => contentWords(r.text).filter((w) => words.includes(w)).length;
    const r = rs.find((x) => x.id === params.of) ?? (params.of ? undefined : rs.filter((x) => shared(x) >= 2).sort((a, b) => shared(b) - shared(a))[0]);
    if (r) Object.assign(params, { of: r.id, rule: r.text.slice(0, 120) });
  }
  let bad = validate(type, params);
  const target = lawTarget(type, params);
  const sameRule = (x: { type: string; params: Record<string, number | string> }) => x.type === type
    && (type === 'norm' ? sameNorm(String(x.params.text), String(params.text)) : lawTarget(x.type as RuleType, x.params) === target);
  // (the numbers close enough to be one rule: within half again, a levy's rate equal; the review's 2)
  const close = (x: Record<string, number | string>) => {
    const a = Number(x.n ?? x.rate), b = Number(params.n ?? params.rate);
    return !Number.isFinite(a) || !Number.isFinite(b) || (type === 'levy' ? a === b : Math.max(a, b) <= 1.5 * Math.max(1, Math.min(a, b)));
  };
  // (a rule already in force, or voted down in the last 2 days, is not put up again: the review's 3)
  if (!bad) {
    const inForce = rulesInForce(village).find((r) => sameRule(r) && close(r.params));
    const failed = st.laws.find((x) => x.status === 'failed' && sameRule(x) && close(x.params) && (x.ballotDay ?? 0) >= dayOf(village, now) - 2);
    if (inForce) bad = `it is already a village rule (${inForce.text})`;
    else if (failed) bad = `the village voted it down on day ${failed.ballotDay}`;
  }
  if (!bad) {
    const same = st.laws.find((x) => (x.status === 'open' || x.status === 'agenda') && sameRule(x) && close(x.params));
    if (same) {
      const joins = same.by !== by && !same.backers.includes(by) && !same.opposers.includes(by);
      if (joins) {
        same.backers.push(by);
        (same.joined ??= []).push(by);
      }
      logAct({ type: 'law', village, agent: by, id: same.id, op: joins ? 'joined' : 'repeat', rule: type, params, what: String(raw.what ?? '').slice(0, 140) });
      touchMemory();
      return same;
    }
  }
  const mine = bad ? undefined : st.laws.find((x) => x.by === by && x.status === 'open');
  if (mine) {
    logAct({ type: 'law', village, agent: by, op: 'held', rule: type, params, what: String(raw.what ?? '').slice(0, 140), open: mine.id });
    return { id: mine.id, by, at: now, day: dayOf(village, now), type, params, text: '', what: String(raw.what ?? '').slice(0, 140), why: '', backers: [], opposers: [], status: 'refused', refused: `your rule ${mine.id} is still waiting for backing` };
  }
  const l: Law = {
    id: `l${st.next++}`, by, at: now, day: dayOf(village, now), type, params, text: bad ? '' : ruleText(type, params),
    what: String(raw.what ?? raw.text ?? '').slice(0, 140), why: String(raw.why ?? raw.reason ?? '').slice(0, 240), backers: [], opposers: [],
    status: bad ? 'refused' : 'open', ...(bad ? { refused: bad } : {}),
  };
  st.laws.push(l);
  logAct({ type: 'law', village, agent: by, id: l.id, rule: type, params, text: l.text, status: l.status, ...(bad ? { refused: bad } : {}) });
  // (#164, MC_CUSTOMS: a norm that names a custom's act starts that custom, in the ledger; it stays a norm on the ballot)
  const custom = type === 'norm' && !bad ? customOf(String(params.text)) : null;
  if (custom) noteStarted(village, by, custom, l.id, now);
  touchMemory();
  return l;
}

/** Backing or opposing an open law (once a member, never one's own). */
export function backLaw(village: string, id: string, by: string, oppose = false, reason?: 'failure'): boolean {
  const l = law(village, id);
  if (!l || l.by === by || (l.status !== 'open' && l.status !== 'agenda') || l.backers.includes(by) || l.opposers.includes(by)) return false;
  (oppose ? l.opposers : l.backers).push(by);
  // (#164: `by: failure` when the back counted only through the backer's failures, MC_LAW_BACKING)
  logAct({ type: 'law', village, agent: by, id, op: oppose ? 'oppose' : 'back', ...(reason ? { by: reason } : {}) });
  touchMemory();
  return true;
}

/** A passed law into force: a rule of the same type and target is superseded. A repeal (#164) ends the rule it names: it is
 *  superseded by the repeal's id and no rule takes its place. */
export function enact(village: string, l: Law, votes: { yes: number; no: number; abstain: number }, now: number): Rule {
  const all = rulesOf(village);
  if (l.type === 'repeal') {
    const old = all.find((x) => x.id === l.params.of && !x.supersededBy);
    const r: Rule = old ?? { id: String(l.params.of), type: 'norm', params: {}, text: String(l.params.rule ?? ''), since: now };
    if (old) Object.assign(old, { supersededBy: `r${l.id}`, repealedAt: now });
    logAct({ type: 'rule', village, op: 'repealed', id: r.id, rule: r.type, text: r.text, votes, from: l.id, found: !!old });
    touchMemory();
    return r;
  }
  const r: Rule = { id: `r${l.id}`, type: l.type as Rule['type'], params: l.params, text: l.text, since: now, votedBy: votes };
  const target = (x: Rule) => (x.type === 'norm' ? x.id : lawTarget(x.type as RuleType, x.params));
  for (const old of all) if (!old.supersededBy && old.type === r.type && target(old) === target(r)) old.supersededBy = r.id;
  all.push(r);
  logAct({ type: 'rule', village, op: 'enacted', id: r.id, rule: r.type, params: r.params, text: r.text, votes, from: l.id });
  touchMemory();
  return r;
}

/** The levy's rate in force (0..1): a voted levy, else MC_LEVY's; undefined when there is none. */
export function levyRate(village: string): number | undefined {
  if (!RULES.on) return undefined;
  const r = rulesInForce(village).find((x) => x.type === 'levy');
  return r ? Number(r.params.rate) / 100 : RULES.levy;
}

/** The decision prompt's line: the rules in force, and MC_LEVY's levy while no vote has set one ('' when none). */
export function rulesLine(village: string): string {
  if (!RULES.on) return '';
  const rs = rulesInForce(village);
  const texts = rs.map((r) => r.text);
  if (RULES.levy !== undefined && !rs.some((r) => r.type === 'levy')) texts.push(ruleText('levy', { rate: Math.round(RULES.levy * 100) }));
  return texts.length ? `Village rules: ${texts.join('; ')}.` : '';
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
      // (a floor of a class sums the class's items: logs of every wood, food of every kind)
      const of = (i: string) => (r.params.class !== undefined ? inClass(i, String(r.params.class)) : i === r.params.item);
      const want = Object.entries(takes).filter(([i]) => of(i)).reduce((s, [, n]) => s + n, 0);
      const have = Object.entries(store).filter(([i]) => of(i)).reduce((s, [, n]) => s + n, 0);
      if (want && have - want < Number(r.params.n)) return `the floor: ${r.text}`;
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

/** An item's put class (a contribute rule's), or undefined. */
export function putClassOf(item: string): PutClass | undefined {
  const q = classOf(item);
  if (q) return q;
  if (isFood(item)) return 'food';
  if (/^(cobblestone|stone|cobbled_deepslate|andesite|diorite|granite)$/.test(item)) return 'stone';
  return undefined;
}
/** #164: an item's stock classes (with MC_RULE_TYPES' stock): ore, seeds, fuel, a bucket. */
export function stockClassesOf(item: string): PutClass[] {
  if (!RULES.types.has('stock')) return [];
  const out: PutClass[] = [];
  if (/^(raw_(iron|copper|gold)|\w+_ore|diamond|emerald|lapis_lazuli|redstone)$/.test(item)) out.push('ore');
  if (/_seeds$/.test(item)) out.push('seeds');
  if (/^(coal|charcoal|coal_block)$/.test(item)) out.push('fuel');
  if (item === 'bucket') out.push('bucket');
  return out;
}
/** Whether an item is of a floor's or contribution's class (food, a quota class, a put class or a stock class). */
export function inClass(item: string, cls: string): boolean {
  if (cls === 'food') return isFood(item);
  return classOf(item) === cls || putClassOf(item) === cls || stockClassesOf(item).includes(cls as PutClass);
}
/** Goods that do not count toward "any goods" (what digging and clearing turn up). */
const JUNK = /^(dirt|coarse_dirt|gravel|sand|red_sand|stick|rotten_flesh|flint|clay_ball|\w+_seeds|\w+_sapling|\w+_leaves|short_grass|tall_grass|fern|dandelion|poppy|\w+_tulip|azure_bluet|oxeye_daisy|cornflower|allium|blue_orchid|lily_of_the_valley)$/;
/** An item's weight toward a put class: planks a quarter log (a log taken out comes back as four planks, the review's 5). */
const putWeight = (item: string) => (/_planks$/.test(item) ? 0.25 : 1);

/**
 * What a member's chore put into the village storage, net of what it took (the server's storage flow, mcStorage.ts' credits,
 * at the chore's end): into the member-day's counts by put class (a contribute rule's compliance) and the option's record
 * (which options put which classes: the contribute tag).
 */
export function notePuts(village: string, agent: string, option: string, puts: Record<string, number>, now: number): void {
  if (!RULES.on) return;
  const st = state(village);
  const day = dayOf(village, now);
  const pm = (st.puts ??= {}), om = (st.optionPuts ??= {});
  const opt = (om[optionBase(option)] ??= {});
  let any = false;
  for (const [item, n] of Object.entries(puts)) {
    if (!(n > 0)) continue;
    any = true;
    const cls = putClassOf(item);
    const w = n * putWeight(item);
    for (const c of [...(cls ? [cls] : []), ...stockClassesOf(item), ...(JUNK.test(item) ? [] : ['goods'])]) {
      pm[`${agent}|${day}|${c}`] = (pm[`${agent}|${day}|${c}`] ?? 0) + w;
      opt[c] = (opt[c] ?? 0) + w;
    }
  }
  if (any) touchMemory();
}

/** An option's id without its instance (slot:1:2, farm:3): its puts are learned by the kind of option. */
export const optionBase = (id: string) => id.replace(/:\d+(:\d+)?$/, '');
/** What a member put today toward a class (or any of a list, logs+torches; an item counts in one class only). */
const putToday = (st: RulesState, agent: string, day: number, cls: string) => cls.split('+').reduce((s, c) => s + (st.puts?.[`${agent}|${day}|${c}`] ?? 0), 0);

/** The contribution rules a member has not met today, as menu tags by the option ids that have put their class before. */
export function contributeTag(village: string, agent: string, optionId: string, now: number): string | null {
  if (!RULES.on) return null;
  const rs = rulesInForce(village).filter((r) => (r.type as RuleType) === 'contribute');
  if (!rs.length) return null;
  const st = state(village);
  const day = dayOf(village, now);
  const opt = st.optionPuts?.[optionBase(optionId)];
  if (!opt) return null;
  for (const r of rs) {
    const cls = String(r.params.class);
    if (putToday(st, agent, day, cls) >= Number(r.params.n)) continue;
    if (cls.split('+').some((c) => (opt[c] ?? 0) > 0)) return `[the rule: ${r.params.n} ${cls.split('+').join(' or ')} a day into storage]`;
  }
  return null;
}

/** #172: a contribution rule the member has not met today whose class takes the item (not "any goods"), in words; else
 *  null (the open chooser's reason for a make or a gather past the keep). */
export function contributeOwed(village: string, agent: string, item: string, now: number): string | null {
  if (!RULES.on) return null;
  const st = state(village);
  const day = dayOf(village, now);
  for (const r of rulesInForce(village).filter((x) => (x.type as RuleType) === 'contribute')) {
    const cls = String(r.params.class), n = Number(r.params.n);
    if (!cls.split('+').some((c) => c !== 'goods' && inClass(item, c))) continue;
    const put = putToday(st, agent, day, cls);
    if (put < n) return `a law asks you to put ${n} ${cls.split('+').join(' or ')} a day, ${put} put today`;
  }
  return null;
}

/**
 * Each finished village day's compliance with the rules a member's own day can show (duty: the kind done; contribute: the
 * class put; norm: a kind its words name, when they name one), one `compliance` record a member and rule (rules_use.py's
 * day table). Once a day, from the council's sweep; members as present at the sweep.
 */
export function judgeDays(village: string, members: string[], now: number): void {
  if (!RULES.on) return;
  const st = state(village);
  const today = dayOf(village, now);
  // (days missed while the server was down are judged too, up to 3: the review's 11)
  const from = Math.max((st.judged ?? 0) + 1, today - 3);
  if (from >= today) return;
  const all = rulesOf(village);
  for (let day = from; day < today; day++) {
    // (the rules in force that day: enacted before its middle, and not yet superseded by then; one enacted at its night
    // counts from the next)
    const c = clockOf(village, now);
    const mid = (c ? c.dayStart - (c.day - day - 1) * c.dayMs : now) - (c ? c.dayMs / 2 : 0);
    const rs = all.filter((r) => r.since < mid && !all.some((x) => x.id === r.supersededBy && x.since < mid) && !((r as RepealedRule).repealedAt! < mid));
    for (const r of rs) {
      const t = r.type as RuleType;
      if (t !== 'duty' && t !== 'contribute') continue;
      for (const m of members) {
        if (t === 'duty') {
          const done = !!agentMemory(village, m)?.log.some((e) => e.day === day && e.kind === r.params.kind && e.ok);
          logAct({ type: 'compliance', village, agent: m, op: 'day', day, rule: r.id, ruleType: t, met: done });
        } else {
          const got = putToday(st, m, day, String(r.params.class));
          logAct({ type: 'compliance', village, agent: m, op: 'day', day, rule: r.id, ruleType: t, met: got >= Number(r.params.n), got, n: Number(r.params.n) });
        }
      }
    }
    st.judged = day;
  }
  touchMemory();
}

/** The duties in force (kinds), for the menu's tag and rank. */
export const duties = (village: string): string[] => (RULES.on ? rulesInForce(village).filter((r) => r.type === 'duty').map((r) => String(r.params.kind)) : []);

/** A refusal or a tagged duty, into the ledger (rules_use.py reads it). */
export function noteCompliance(village: string, agent: string, rec: Record<string, unknown>): void {
  logAct({ type: 'compliance', village, agent, ...rec });
}

/**
 * What a law would have meant for one member yesterday, in code's words (the ballot's stake line, rulebench 10-23: with no
 * stake shown gpt-oss voted yes on 99% of laws): a quota's takes it would have refused, a contribution's goods it put, a
 * floor's stock now; '' when code has nothing to say.
 */
export function stake(village: string, agent: string, type: RuleType, p: Record<string, number | string>, store: Record<string, number>, now: number): string {
  if (!RULES.on) return '';
  const st = state(village);
  const y = dayOf(village, now) - 1;
  if (type === 'quota') {
    const took = st.takes[`${agent}|${y}|${p.class}`] ?? 0;
    return `yesterday you took ${took} ${p.class} from storage${took > Number(p.n) ? `: it would have refused ${took - Number(p.n)} of yours` : ''}`;
  }
  if (type === 'contribute') {
    const put = Math.floor(putToday(st, agent, y, String(p.class)));
    return `yesterday you put ${put} ${String(p.class).split('+').join(' or ')} into storage${put < Number(p.n) ? `, short of ${p.n}` : ''}`;
  }
  if (type === 'duty') {
    const did = agentMemory(village, agent)?.log.filter((e) => e.day === y && e.kind === p.kind && e.ok).length ?? 0;
    return `yesterday you did ${KIND_WORDS[String(p.kind)] ?? p.kind} ${did === 0 ? 'not at all' : did === 1 ? 'once' : `${did} times`}`;
  }
  if (type === 'floor') {
    if (!Object.keys(store).length) return '';
    const of = (i: string) => (p.class !== undefined ? inClass(i, String(p.class)) : i === p.item);
    const have = Object.entries(store).filter(([i]) => of(i)).reduce((s, [, n]) => s + n, 0);
    return `storage holds ${have} now`;
  }
  // (survival (d): the deaths' fact from code's counts, the stake in the world #164 asked for)
  if (type === 'curfew') return dangerFacts(village)?.fact ?? '';
  return '';
}

/** #164: the ballot's words-only line for a norm (MC_RULE_WORDS): code reads no type in it, so nothing enforces or counts
 *  it; '' for typed laws or with the flag off. */
export function wordsOnly(type: RuleType): string {
  return RULES.words && type === 'norm' ? 'words only: code will not enforce or count this; members keep it or not' : '';
}

/** Members of the village (from memory), and those of them whose day `day` did a duty's kind or put a contribution's class. */
function meeting(village: string, type: RuleType, p: Record<string, number | string>, day: number): { did: number; of: number } | null {
  if (type !== 'duty' && type !== 'contribute') return null;
  const st = state(village);
  const ms = membersOf(village);
  const did = ms.filter((m) => (type === 'duty'
    ? m.log.some((e) => e.day === day && e.kind === p.kind && e.ok)
    : putToday(st, m.name, day, String(p.class)) >= Number(p.n))).length;
  return { did, of: ms.length };
}

/**
 * #164 (MC_RULE_FEASIBLE): what a duty or contribution would have asked of the village yesterday, in code's counts ("yesterday
 * 3 of 25 members did lighting"; train 7 passed a tool contribution met on 4% of member-days and a lighting duty on 14%,
 * the work seldom on members' menus); '' for other types or with the flag off.
 */
export function feasibility(village: string, type: RuleType, p: Record<string, number | string>, now: number): string {
  if (!RULES.feasible) return '';
  const m = meeting(village, type, p, dayOf(village, now) - 1);
  if (!m || !m.of) return '';
  if (type === 'duty') return `yesterday ${m.did} of ${m.of} members did ${KIND_WORDS[String(p.kind)] ?? p.kind}`;
  return `yesterday ${m.did} of ${m.of} members put ${p.n} ${String(p.class).split('+').join(' or ')} or more into storage`;
}

/**
 * #164 (MC_RULE_RESULTS): each rule in force with its result in code's counts over the last finished village days since it
 * passed (at most 3): a duty or contribution met by members a day, a norm "words only, not counted", a levy its rate; a
 * quota or floor names that it is enforced (its refusals are the world's). [] with the flag off.
 */
export function ruleResults(village: string, now: number): string[] {
  if (!RULES.results) return [];
  // (each with its id, so a member can name it in a repeal)
  return rulesInForce(village).map((r) => `[${r.id}] ${r.text} (${ruleResult(village, r, now)})`);
}

/** One rule's result in code's counts (ruleResults; a repeal's ballot line). */
export function ruleResult(village: string, r: Rule, now: number): string {
  const today = dayOf(village, now);
  const c = clockOf(village, now);
  const t = r.type as RuleType;
  // (village days finished since it passed: a rule passed at a dusk counts from the next day)
  const since = c ? c.day - Math.floor((now - r.since) / c.dayMs) : today;
  const days = [today - 3, today - 2, today - 1].filter((d) => d > since && d >= 1);
  if (t === 'duty' || t === 'contribute') {
    const per = days.map((d) => meeting(village, t, r.params, d)).filter((m): m is { did: number; of: number } => !!m);
    return per.length ? `met by ${per.map((m) => `${m.did} of ${m.of}`).join(', then ')} members a day` : 'no full day yet';
  }
  if (t === 'norm') return 'words only: not enforced or counted';
  if (t === 'curfew') {
    const n = dangerFacts(village)?.lastNight;
    return n ? `${n.out} member${n.out === 1 ? '' : 's'} out after dark last night, ${n.deaths} death${n.deaths === 1 ? '' : 's'}` : 'no night since it passed';
  }
  if (t === 'levy') return `in force at ${r.params.rate}%`;
  // (#164: a claim's blocked trips of its work since against the 2 days before, and the menus that waited on a claim; a
  // report's finds posted of those reportable and the trips that used one)
  if (t === 'claim' || t === 'report') {
    // (by the day it passed: the days after it against the 2 days up to it)
    const from = dayOf(village, r.since);
    const after = (what: string, work: string) => sumDays(village, what, work, (d) => d > from);
    const before = (what: string, work: string) => sumDays(village, what, work, (d) => d <= from && d > from - 2);
    if (t === 'report') return `${after('posted', '*')} of ${after('reportable', '*')} finds posted since; ${after('used', '*')} trips used a report`;
    const w = String(r.params.work);
    return `${after('blocked', w)} blocked trips since (${before('blocked', w)} in the 2 days before); ${after('waited', w)} menus waited on a claim`;
  }
  return 'enforced by code (options that break it leave the menu)';
}

// ---------------------------------------------------------------------------------------------
// #164: claims and reports on the board by the storage hut (MC_RULE_TYPES; the world carries them out)
// ---------------------------------------------------------------------------------------------

/** A count by what, work and village day (`*` for a report's). */
function count(village: string, what: string, work: string, now: number, n = 1): void {
  const st = state(village);
  const k = `${what}|${work}|${dayOf(village, now)}`;
  (st.counts ??= {})[k] = (st.counts[k] ?? 0) + n;
}
function sumDays(village: string, what: string, work: string, day: (d: number) => boolean): number {
  let n = 0;
  for (const [k, q] of Object.entries(state(village).counts ?? {})) {
    const [w, wk, d] = k.split('|');
    if (w === what && wk === work && day(Number(d))) n += q;
  }
  return n;
}

/** The claim rule in force on a work, or undefined (MC_RULES and MC_RULE_TYPES' claim). */
export function claimRule(village: string, work: ClaimWork): Rule | undefined {
  if (!RULES.on || !RULES.types.has('claim')) return undefined;
  return rulesInForce(village).find((r) => (r.type as RuleType) === 'claim' && r.params.work === work);
}
/** Whether a report rule is in force. */
export function reportRule(village: string): Rule | undefined {
  if (!RULES.on || !RULES.types.has('report')) return undefined;
  return rulesInForce(village).find((r) => (r.type as RuleType) === 'report');
}

/** The claims on the board now, oldest first. */
export function liveClaims(village: string, now: number): Claim[] {
  return (state(village).claims ?? []).filter((c) => c.until > now && !!claimRule(village, c.work));
}

/** The reports on the board now, newest first. */
export function liveReports(village: string, now: number): Report[] {
  return reportRule(village) ? (state(village).reports ?? []).filter((r) => r.until > now).sort((a, b) => b.at - a.at) : [];
}

/** Another member's claim on a work and key holding now, or undefined (the menu takes the option off, the rule named). */
export function claimHeld(village: string, work: ClaimWork, key: string, agent: string, now: number): Claim | undefined {
  return liveClaims(village, now).find((c) => c.work === work && c.key === key && c.by !== agent);
}

/** A member starts claimed work: its claim posted (renewed when it holds one already) for the rule's minutes, and logged.
 *  Undefined with no claim rule on that work. */
export function postClaim(village: string, work: ClaimWork, key: string, agent: string, label: string, now: number): Claim | undefined {
  const r = claimRule(village, work);
  if (!r) return undefined;
  const st = state(village);
  const cs = (st.claims ??= []).filter((c) => c.until > now - 3600000);
  st.claims = cs;
  const until = now + Number(r.params.min) * 60000;
  let c = cs.find((x) => x.work === work && x.key === key && x.by === agent && x.until > now);
  if (c) c.until = until;
  else cs.push((c = { work, key, by: agent, at: now, until, label: label.slice(0, 60), rule: r.id }));
  count(village, 'posted', work, now);
  logAct({ type: 'claim', village, agent, op: 'posted', work, key, until, rule: r.id });
  touchMemory();
  return c;
}

/** An option left a member's menu for another's claim (the rule's idle cost): counted, and logged once a member, option
 *  and 10 minutes. */
const waitLogged = new Map<string, number>();
export function noteClaimWait(village: string, agent: string, option: string, c: Claim, now: number): void {
  const k = `${village}|${agent}|${option}`;
  if ((waitLogged.get(k) ?? 0) > now - 10 * 60000) return;
  waitLogged.set(k, now);
  count(village, 'waited', c.work, now);
  logAct({ type: 'claim', village, agent, op: 'waited', work: c.work, key: c.key, option, by: c.by, until: c.until });
}

/** A trip of claimable work turned back by another member (the iron level's miners, "no free 9x9 site"): counted whether a
 *  claim rule is in force or not (the before and after, and the off arm). */
export function noteBlocked(village: string, agent: string, work: ClaimWork, option: string, msg: string, now: number): void {
  if (!RULES.on) return;
  count(village, 'blocked', work, now);
  logAct({ type: 'claim', village, agent, op: 'blocked', work, option, msg: msg.slice(0, 160), ...(claimRule(village, work) ? { rule: claimRule(village, work)!.id } : {}) });
}

/** A trip found or failed something a member may post (with a report rule in force): kept for the member's next menu (10
 *  minutes), logged as reportable. A newer find replaces an older one unposted (counted skipped). */
export function pendReport(village: string, agent: string, option: string, text: string, now: number): void {
  if (!reportRule(village)) return;
  const st = state(village);
  const pr = (st.pendingReports ??= {});
  if (pr[agent]) skipReport(village, agent, now, 'replaced');
  pr[agent] = { option, text: text.slice(0, 120), at: now };
  count(village, 'reportable', '*', now);
  logAct({ type: 'report', village, agent, op: 'reportable', option, text: text.slice(0, 120) });
  touchMemory();
}
/** A member's find waiting for its choice (posted or not), or undefined. */
export function pendingReport(village: string, agent: string, now: number): PendingReport | undefined {
  const p = state(village).pendingReports?.[agent];
  if (p && now - p.at > 10 * 60000) {
    skipReport(village, agent, now, 'lapsed');
    return undefined;
  }
  return p && reportRule(village) ? p : undefined;
}
/** The member chose to post its find: on the board for 30 minutes, a fact on the others' options of the same work. */
export function postReport(village: string, agent: string, now: number): Report | undefined {
  const st = state(village);
  const p = st.pendingReports?.[agent];
  if (!p) return undefined;
  delete st.pendingReports![agent];
  const rs = (st.reports ??= []).filter((r) => r.until > now - 3600000);
  st.reportNext = (st.reportNext ?? 0) + 1;
  const r: Report = { id: `rp${st.reportNext}`, by: agent, at: now, until: now + 30 * 60000, option: p.option, text: p.text };
  rs.push(r);
  st.reports = rs;
  count(village, 'posted', '*', now);
  logAct({ type: 'report', village, agent, op: 'posted', id: r.id, option: p.option, text: p.text, report: 'posted' });
  touchMemory();
  return r;
}
/** The member went on without posting its find (another chore chosen while it was offered, a newer find, or 10 minutes). */
export function skipReport(village: string, agent: string, now: number, why = 'went on'): void {
  const st = state(village);
  const p = st.pendingReports?.[agent];
  if (!p) return;
  delete st.pendingReports![agent];
  count(village, 'skipped', '*', now);
  logAct({ type: 'report', village, agent, op: 'skipped', option: p.option, why, report: 'skipped' });
  touchMemory();
}
/** The newest posted report by another member on an option's work (its id, or its base: gather:sugar_cane), or undefined. */
export function reportFor(village: string, agent: string, option: string, now: number): Report | undefined {
  if (!reportRule(village)) return undefined;
  const base = optionBase(option);
  return (state(village).reports ?? []).filter((r) => r.until > now && r.by !== agent && (r.option === option || optionBase(r.option) === base)).sort((a, b) => b.at - a.at)[0];
}
/** A member picked an option that cited a report (and, at its end, how the trip went). */
export function noteReportUsed(village: string, agent: string, r: Report, option: string, now: number, ok?: boolean): void {
  if (ok === undefined) count(village, 'used', '*', now);
  logAct({ type: 'report', village, agent, op: ok === undefined ? 'used' : 'outcome', id: r.id, by: r.by, option, ...(ok === undefined ? {} : { ok }) });
}

/** The board's signs (4 lines of up to 15 letters each): one a claim holding, then one a report, newest first; at most `n`. */
export function boardSigns(village: string, now: number, n = 4): string[][] {
  const out: string[][] = [];
  const cut = (s: string) => s.slice(0, 15);
  for (const c of liveClaims(village, now)) out.push(['CLAIM', cut(c.label), cut(`by ${c.by}`), cut(`${Math.max(1, Math.ceil((c.until - now) / 60000))} min left`)]);
  if (claimRule(village, 'farm_site')) out.push(['FARM PLOTS', 'by each house', 'kept for its', 'own farm']);
  const rs = reportRule(village) ? (state(village).reports ?? []).filter((r) => r.until > now).sort((a, b) => b.at - a.at) : [];
  for (const r of rs) {
    const w = r.text.split(' ');
    const lines: string[] = [];
    for (const x of w) {
      if (lines.length && (lines[lines.length - 1] + ' ' + x).length <= 15) lines[lines.length - 1] += ` ${x}`;
      else lines.push(cut(x));
    }
    out.push([cut(`${r.by}:`), ...lines.slice(0, 3)]);
  }
  return out.slice(0, n);
}

/** Code's dry-run preview of a quota over the last 3 village days (spec 13): the takes it would have refused. */
export function preview(village: string, type: RuleType, p: Record<string, number | string>, now: number): string {
  // (#164: a repeal shows the result of the rule it ends)
  if (type === 'repeal') {
    const r = rulesInForce(village).find((x) => x.id === p.of);
    return r ? `its result so far: ${ruleResult(village, r, now)}` : 'that rule is no longer in force';
  }
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
