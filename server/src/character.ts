/**
 * Character v2 (goal 2; spec runs/2026-10-22/character/spec.md, draft 2 and sections 13-14): what makes one member differ
 * from another, kept by code in layers, each moving named decisions through a weight code applies and writing one short
 * line the model reads; the model never rewrites a layer. World-free: the world reports events (chore ends, promises,
 * help, rests, works built), asks for an option's character factor and the prompt's lines, and samples the series.
 *
 * Layers built here (the motivation build's ambition and own food and tools are not built yet: the identity core shows
 * no ambition step and the needs layer is energy alone):
 *   1 temperament  HEXACO six traits, redrawn from a new seed (the user's, 10-22), their chore weights (`tw`)
 *   2 values       Schwartz's four, half from the traits, half an independent draw, self-enhancement dominant <= 25%;
 *                  life goals drawn from them (the user's)
 *   3 needs        energy: falls with work, rises at home; a rest option in the night window only (the user's)
 *   4 mood         a sum of decaying thoughts from events, trait-shifted; it weighs own projects (and proposals)
 *   5 affinity     pair affinity from verified facts; it weighs help on a friend's project and taking a request
 *   6 identity     a "who I am" line by code; role, title and achievements only with MCAI_SOCIAL_ROLES=show
 * The layers beyond temperament multiply into one character factor clamped to 0.67..1.5; with any layer on, every
 * option's weight product is capped at 6.25 and floored at 0.16 (choose.ts weights()).
 *
 * Settings (read once):
 *   MC_CHARACTER  off (default) | on: every layer below on; it needs MCAI_TEMPERAMENT=on MC_SKILL=on MC_GOALS=on set
 *                 explicitly (a contradiction refuses to start: the spec's B3; off needs them off or unset)
 *   MC_HEXACO, MC_VALUES, MC_GAUGES, MC_MOOD, MC_AFFINITY, MC_IDENTITY: each layer alone (default MC_CHARACTER's)
 */
import fs from 'node:fs';
import path from 'node:path';
import { workerNumber, workerName } from './agentNames';
import { KIND_WORDS, logAct } from './memory';

// (choose.ts' seeded helpers, copied: choose.ts imports this module, and the draws below run at load)
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled<T>(xs: T[], seed: string): T[] {
  const out = [...xs];
  const rnd = mulberry32(fnv1a(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const flag = (v: string | undefined) => /^(on|1|true|yes)$/i.test(v ?? '');
const CHARACTER_ON = flag(process.env.MC_CHARACTER);
const layer = (name: string) => (process.env[name] === undefined || process.env[name] === '' ? CHARACTER_ON : flag(process.env[name]));

export const CHARACTER = {
  on: CHARACTER_ON,
  hexaco: layer('MC_HEXACO'),
  values: layer('MC_VALUES'),
  gauges: layer('MC_GAUGES'),
  mood: layer('MC_MOOD'),
  affinity: layer('MC_AFFINITY'),
  identity: layer('MC_IDENTITY'),
};
// (B3: MC_CHARACTER is a convenience switch over three older flags; a series that contradicts it is refused)
if (process.env.MC_CHARACTER !== undefined && process.env.MC_CHARACTER !== '') {
  const want = CHARACTER_ON ? { MCAI_TEMPERAMENT: 'on', MC_SKILL: 'on', MC_GOALS: 'on' } : { MCAI_TEMPERAMENT: 'off', MC_SKILL: 'off', MC_GOALS: 'off' };
  const bad = Object.entries(want).filter(([k, v]) => (CHARACTER_ON ? (process.env[k] ?? '').toLowerCase() !== v : !['', v, undefined].includes((process.env[k] ?? '').toLowerCase()) && !(k === 'MCAI_TEMPERAMENT' && process.env[k] === 'identical')));
  if (bad.length) throw new Error(`MC_CHARACTER=${process.env.MC_CHARACTER} needs ${bad.map(([k, v]) => `${k}=${v}`).join(' ')} (set them with it)`);
}
/** Whether any layer is on (the cap and floor apply everywhere then). */
export const characterAny = () => CHARACTER.hexaco || CHARACTER.values || CHARACTER.gauges || CHARACTER.mood || CHARACTER.affinity || CHARACTER.identity;
/** Test hook. */
export function setCharacterSettings(s: Partial<typeof CHARACTER>): void {
  Object.assign(CHARACTER, s);
}

// ---------------------------------------------------------------------------------------------
// Layer 1: HEXACO
// ---------------------------------------------------------------------------------------------

export const HEXACO = ['H', 'E', 'X', 'A', 'C', 'O'] as const;
export type HexTrait = (typeof HEXACO)[number];
export type Hexaco = Record<HexTrait, number>;
export const TRAIT_NAMES: Record<HexTrait, string> = { H: 'honesty-humility', E: 'emotionality', X: 'extraversion', A: 'agreeableness', C: 'conscientiousness', O: 'openness' };
const WORKERS = 24;
/** The Mayor's, by hand: organised, outgoing, fairly honest. */
const MAYOR: Hexaco = { H: 0.3, E: 0, X: 0.5, A: 0.2, C: 0.6, O: 0.1 };
const ZERO: Hexaco = { H: 0, E: 0, X: 0, A: 0, C: 0, O: 0 };

/** Workers 1-24's six traits: a Latin hypercube seeded 'character-v2' (each trait's 24 values one per stratum of [-1, 1]). */
const WORKER_HEX: Hexaco[] = (() => {
  const rnd = mulberry32(fnv1a('character-v2'));
  const out: Hexaco[] = Array.from({ length: WORKERS }, () => ({ ...ZERO }));
  for (const t of HEXACO) {
    const strata = shuffled(Array.from({ length: WORKERS }, (_, i) => i), `character-v2|${t}`);
    for (let w = 0; w < WORKERS; w++) out[w][t] = Math.round((-1 + (2 * (strata[w] + rnd())) / WORKERS) * 100) / 100;
  }
  return out;
})();

/** A member's six traits: the Mayor's by hand, workers 1-24 drawn, any other name from a hash of it. */
export function hexacoOf(name: string): Hexaco {
  const n = name.trim().toLowerCase();
  if (n === 'mayor') return { ...MAYOR };
  const i = workerNumber(n);
  if (i >= 1 && i <= WORKERS) return { ...WORKER_HEX[i - 1] };
  const rnd = mulberry32(fnv1a(`character-v2|${n}`));
  return Object.fromEntries(HEXACO.map((t) => [t, Math.round((rnd() * 2 - 1) * 100) / 100])) as Hexaco;
}

/** Each kind's loading on the traits (draft 2): openness on exploring, new crafts, lighting, furnishing and works;
 *  conscientiousness on gathering, making, farming; emotionality on pens and home; extraversion and agreeableness on help
 *  and shared projects; honesty-humility on none. */
const LOAD: Record<string, Partial<Record<HexTrait, number>>> = {
  explore: { O: 1 }, activity: { O: 0.7, C: 0.3 }, light: { O: 0.6, C: 0.4 }, furnish: { O: 0.7, E: 0.3 }, works: { O: 0.5, C: 0.5 },
  start: { O: 0.5, C: 0.5 }, iron: { O: 0.4, C: 0.6 }, gather: { C: 1 }, make: { C: 0.8, O: 0.2 }, farm: { C: 0.7, E: 0.3 },
  slot: { C: 0.7, E: 0.3 }, pen: { E: 1 }, penwork: { E: 0.8, C: 0.2 }, annex: { E: 0.5, C: 0.5 }, cake: { E: 0.6, C: 0.4 },
  initiate: { O: 0.5, X: 0.2, C: 0.3 }, help: { X: 0.5, A: 0.5 }, grow: { E: 0.5, C: 0.5 }, own: { C: 0.5, E: 0.5 }, innovate: { O: 1 },
};
const WEIGHT_MAX = 2.5;

/** Each kind's weight 0.4..2.5 from the six traits (temperament.ts' kindWeights' shape: centred, the strongest +-1). */
export function hexacoWeights(name: string, kinds: string[]): Record<string, number> {
  const v = hexacoOf(name);
  const ks = kinds.filter((k) => LOAD[k]);
  const a = ks.map((k) => Object.entries(LOAD[k]).reduce((s, [t, l]) => s + (l ?? 0) * v[t as HexTrait], 0));
  const mean = a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const c = a.map((x) => x - mean);
  const top = Math.max(1e-9, ...c.map(Math.abs));
  const out: Record<string, number> = { eat: 1 };
  ks.forEach((k, i) => (out[k] = Math.round(WEIGHT_MAX ** (c[i] / top) * 100) / 100));
  return out;
}

const HIGH: Record<HexTrait, string> = { H: 'honest', E: 'sensitive', X: 'outgoing', A: 'forgiving', C: 'hard-working', O: 'curious' };
const LOW: Record<HexTrait, string> = { H: 'out for yourself', E: 'unflappable', X: 'reserved', A: 'slow to forgive', C: 'easy-going', O: 'conventional' };

/** The temperament's words: the two strongest traits high, the strongest low ("curious and honest, slow to forgive"). */
export function temperamentWords(name: string): string {
  const v = hexacoOf(name);
  const order = [...HEXACO].sort((x, y) => v[y] - v[x]);
  const hi = order.filter((t) => v[t] >= 0.25).slice(0, 2).map((t) => HIGH[t]);
  const lo = [...order].reverse().find((t) => v[t] <= -0.4);
  return [hi.length ? hi.join(' and ') : 'even-tempered', ...(lo ? [LOW[lo]] : [])].join(', ');
}

// ---------------------------------------------------------------------------------------------
// Layer 2: values, and life goals drawn from them
// ---------------------------------------------------------------------------------------------

export const VALUES = ['openness', 'conservation', 'enhancement', 'transcendence'] as const;
export type Value = (typeof VALUES)[number];
export type Values = Record<Value, number>;
const VALUE_WORDS: Record<Value, string> = { openness: 'openness to change', conservation: 'tradition and order', enhancement: 'getting ahead', transcendence: 'the good of others' };
/** At most this share of members with self-enhancement dominant (Human Values Matter's tipping; a parameter). */
export const ENHANCEMENT_CAP = 0.25;

const raw = (name: string): Values => {
  const v = hexacoOf(name);
  const u = mulberry32(fnv1a(`values|${name.toLowerCase()}`));
  const t: Values = { openness: (v.O + v.X) / 2, conservation: v.C, enhancement: -v.H, transcendence: (v.A + v.E) / 2 };
  return Object.fromEntries(VALUES.map((k) => [k, Math.round((0.5 * ((t[k] + 1) / 2) + 0.5 * u()) * 100) / 100])) as Values;
};
const dominant = (x: Values): Value => [...VALUES].sort((a, b) => x[b] - x[a])[0];

/** Every pool member's values, with the self-enhancement cap applied (the most dominant kept, the rest lowered below
 *  their next value). */
const VALUE_TABLE: Map<string, Values> = (() => {
  const names = ['Mayor', ...Array.from({ length: WORKERS }, (_, i) => workerName(i + 1))];
  const m = new Map(names.map((n) => [n.toLowerCase(), raw(n)]));
  const se = [...m.entries()].filter(([, x]) => dominant(x) === 'enhancement').sort((a, b) => (b[1].enhancement - Math.max(b[1].openness, b[1].conservation, b[1].transcendence)) - (a[1].enhancement - Math.max(a[1].openness, a[1].conservation, a[1].transcendence)));
  const allow = Math.floor(ENHANCEMENT_CAP * names.length);
  for (const [, x] of se.slice(allow)) x.enhancement = Math.round((Math.max(x.openness, x.conservation, x.transcendence) - 0.01) * 100) / 100;
  return m;
})();

export function valuesOf(name: string): Values {
  return { ...(VALUE_TABLE.get(name.toLowerCase()) ?? raw(name)) };
}

export function valuesLine(name: string): string {
  const v = valuesOf(name);
  const order = [...VALUES].sort((a, b) => v[b] - v[a]);
  return `You value ${VALUE_WORDS[order[0]]} most, ${VALUE_WORDS[order[3]]} least.`;
}

/** How well each life goal fits a member's values (draft 2): invention and beauty from openness, home and mastery from
 *  conservation (mastery with self-enhancement, home with self-transcendence), wealth from self-enhancement, standing
 *  from self-transcendence; a little of the traits to split the pairs. */
export const GOALS = ['invention', 'beauty', 'mastery', 'home', 'wealth', 'standing'] as const;
function goalScore(g: string, name: string): number {
  const v = valuesOf(name);
  const h = hexacoOf(name);
  switch (g) {
    case 'invention': return 0.8 * v.openness + 0.2 * (h.O + 1) / 2;
    case 'beauty': return 0.8 * v.openness + 0.2 * (h.E + 1) / 2;
    case 'mastery': return 0.6 * v.conservation + 0.4 * v.enhancement;
    case 'home': return 0.6 * v.conservation + 0.4 * v.transcendence;
    case 'wealth': return v.enhancement;
    default: return v.transcendence;
  }
}
/** Every pool member's goal: the best fits first, each goal at most ceil(25 / 6) + 1 members (goals.ts' balance). */
const GOAL_TABLE: Map<string, string> = (() => {
  const names = ['Mayor', ...Array.from({ length: WORKERS }, (_, i) => workerName(i + 1))];
  const cap = Math.ceil(names.length / GOALS.length) + 1;
  const pairs = names.flatMap((n) => GOALS.map((g) => ({ n, g, s: goalScore(g, n) }))).sort((a, b) => b.s - a.s || (a.n < b.n ? -1 : 1));
  const out = new Map<string, string>();
  const count = new Map<string, number>();
  // (each goal its best-fitting member first, as goals.ts' drawGoals, so no goal is left empty)
  for (const g of GOALS) {
    const p = pairs.find((x) => x.g === g && !out.has(x.n.toLowerCase()));
    if (!p) continue;
    out.set(p.n.toLowerCase(), g);
    count.set(g, 1);
  }
  for (const p of pairs) {
    if (out.has(p.n.toLowerCase()) || (count.get(p.g) ?? 0) >= cap) continue;
    out.set(p.n.toLowerCase(), p.g);
    count.set(p.g, (count.get(p.g) ?? 0) + 1);
  }
  return out;
})();

/** A member's life goal drawn from its values (the user's choice, 10-22). */
export function goalFromValues(name: string): string {
  return GOAL_TABLE.get(name.toLowerCase()) ?? [...GOALS].sort((a, b) => goalScore(b, name) - goalScore(a, name))[0];
}

// ---------------------------------------------------------------------------------------------
// The per-member state: energy, thoughts, affinity (in memory, saved in character.json)
// ---------------------------------------------------------------------------------------------

export interface Thought { v: number; src: string; start: number; end: number; social?: boolean; aboutOther?: boolean }
interface MemberState {
  energy: number;
  thoughts: Thought[];
  ended: Thought[];
  /** Pair affinity -10..10 from facts, and the facts behind it. */
  aff: Record<string, number>;
  facts: Record<string, { kept: number; broke: number; helped: number; helpedBy: number; refused: number; accepted: number; beside: number }>;
  rests: number[];
  lines: Record<string, string>;
  lineLog: Array<{ t: number; line: string }>;
  decisions: number;
  factors: number[];
}
interface VillageState {
  run: string;
  members: Record<string, MemberState>;
  /** Per member, a ring of points: [t, energy, appetite, mood, factor, decisions an hour]. */
  series: Record<string, number[][]>;
  /** Affinity matrix snapshots, a ring of 36: {t, names, m (rows, 0.1)}. */
  matrix: Array<{ t: number; names: string[]; m: number[][] }>;
  lastSample: number;
  lastMatrix: number;
  lastDecay: number;
}
interface Store { version: 1; villages: Record<string, VillageState> }

export const SERIES_POINTS = 360, MATRIX_POINTS = 36, THOUGHTS_ENDED = 50, LINE_LOG = 20;
const scale = Math.max(0.1, Number(process.env.MC_TIME_SCALE ?? 1) || 1);
/** A village minute in wall ms (sampling, decay). */
export const MINUTE_MS = 60000 / scale;
/** A village day (thought durations, decay), as memory.ts' MC_DAY_MIN. */
const DAY_MS = (Number(process.env.MC_DAY_MIN ?? 20) * 60000) / scale;

let store: Store = { version: 1, villages: {} };
let file: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

/** Load character.json from the world's folder (null: memory only). Never in a checkpoint (the spec's K1). */
export function initCharacter(dataDir: string | null): void {
  file = dataDir ? path.join(dataDir, 'character.json') : null;
  store = { version: 1, villages: {} };
  if (file && fs.existsSync(file)) {
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Store;
      if (s?.version === 1) store = s;
    } catch (e) {
      console.error(`[character] cannot read ${file}: ${(e as Error).message}; starting empty`);
      file = `${file}.new`;
    }
  }
}
function save(): void {
  dirty = true;
  if (!file || timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushCharacter();
  }, MINUTE_MS);
}
export function flushCharacter(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!dirty || !file) return;
  dirty = false;
  try {
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(store));
    try { fs.renameSync(tmp, file); } catch { fs.writeFileSync(file, JSON.stringify(store)); fs.rmSync(tmp, { force: true }); }
  } catch (e) {
    console.error(`[character] saving failed: ${(e as Error).message}`);
  }
}
export const serialiseCharacter = () => JSON.stringify(store);
export function loadCharacter(json: string): void {
  store = JSON.parse(json) as Store;
}

function vs(village: string, now = Date.now()): VillageState {
  return (store.villages[village.toLowerCase()] ??= { run: `${village}@${now}`, members: {}, series: {}, matrix: [], lastSample: 0, lastMatrix: 0, lastDecay: now });
}
function ms(village: string, agent: string): MemberState {
  const v = vs(village);
  return (v.members[agent] ??= { energy: 1, thoughts: [], ended: [], aff: {}, facts: {}, rests: [], lines: {}, lineLog: [], decisions: 0, factors: [] });
}

/** A run begins (a spawn with reset, G1's rule): the village's character state and series are cleared. */
export function characterRunBegin(village: string, now: number): void {
  store.villages[village.toLowerCase()] = { run: `${village}@${now}`, members: {}, series: {}, matrix: [], lastSample: 0, lastMatrix: 0, lastDecay: now };
  save();
}

// ---------------------------------------------------------------------------------------------
// Layer 3: energy
// ---------------------------------------------------------------------------------------------

/** Energy lost a work minute: a 20-minute village day of near-constant work takes ~0.65. */
const ENERGY_PER_MIN = 0.05 * scale;
export function energyOf(village: string, agent: string): number {
  return ms(village, agent).energy;
}
/** A chore ended: energy falls with its minutes (wall minutes at the run's scale). */
export function noteWork(village: string, agent: string, minutes: number): void {
  if (!CHARACTER.gauges) return;
  const m = ms(village, agent);
  m.energy = Math.max(0, Math.round((m.energy - ENERGY_PER_MIN * Math.max(0, minutes)) * 1000) / 1000);
  save();
}
/** A rest at home ended: energy back up by 0.6. */
export function noteRest(village: string, agent: string, now: number): void {
  const m = ms(village, agent);
  m.energy = Math.min(1, Math.round((m.energy + 0.6) * 1000) / 1000);
  m.rests.push(now);
  if (m.rests.length > 50) m.rests.splice(0, m.rests.length - 50);
  logAct({ type: 'character', op: 'rest', village, agent, energy: m.energy });
  save();
}
/** The rest option's weight in the night window (the user's: rest at night only): fatigue 1 - energy, 1..3; null when not
 *  tired enough (energy 0.6 or more). */
export function restWeight(village: string, agent: string): number | null {
  if (!CHARACTER.gauges) return null;
  const e = energyOf(village, agent);
  return e >= 0.6 ? null : Math.round((1 + 2 * (1 - e)) * 100) / 100;
}
export function needsLine(village: string, agent: string): string {
  if (!CHARACTER.gauges) return '';
  const e = energyOf(village, agent);
  return e < 0.35 ? `You are tired (energy ${Math.round(e * 100)}%); you can rest at home at night.` : e < 0.6 ? 'You are getting tired.' : '';
}

// ---------------------------------------------------------------------------------------------
// Layer 4: mood
// ---------------------------------------------------------------------------------------------

/** A thought's value and duration by event (RimWorld's model; durations in village time). */
export const THOUGHTS: Record<string, { v: number; days: number; social?: boolean; aboutOther?: boolean }> = {
  kept: { v: 4, days: 1, social: true }, broke: { v: -6, days: 1, social: true, aboutOther: true }, helped: { v: 3, days: 1, social: true },
  built: { v: 5, days: 2 }, refused: { v: -2, days: 0.5, social: true }, failed: { v: -1, days: 0.05 }, hungry: { v: -5, days: 0.25 },
  accepted: { v: 5, days: 1 }, rejected: { v: -2, days: 1 }, furnished: { v: 2, days: 1 }, rested: { v: 2, days: 0.5 },
};

/** An event's thought, trait-shifted: emotionality scales negative ones x0.7..1.4, extraversion social ones, high
 *  agreeableness feels others' broken promises less. `text` is what the line says ("Ben kept a promise to you"). */
export function think(village: string, agent: string, kind: keyof typeof THOUGHTS, text: string, now: number): void {
  if (!CHARACTER.mood) return;
  const d = THOUGHTS[kind];
  const h = hexacoOf(agent);
  let v = d.v;
  if (v < 0) v *= 0.7 + 0.35 * (h.E + 1);
  if (d.social) v *= 0.85 + 0.15 * (h.X + 1);
  if (d.aboutOther) v *= 1.2 - 0.25 * (h.A + 1);
  const m = ms(village, agent);
  m.thoughts.push({ v: Math.round(v * 10) / 10, src: text.slice(0, 80), start: now, end: now + d.days * DAY_MS, ...(d.social ? { social: true } : {}) });
  save();
}
const valueAt = (t: Thought, now: number) => (now >= t.end ? 0 : now <= t.start ? t.v : (t.v * (t.end - now)) / (t.end - t.start));
/** Mood now, -30..30; ended thoughts move to `ended` (the last 50). */
export function moodOf(village: string, agent: string, now: number): number {
  const m = ms(village, agent);
  for (const t of m.thoughts.filter((x) => now >= x.end)) m.ended.push(t);
  if (m.ended.length > THOUGHTS_ENDED) m.ended.splice(0, m.ended.length - THOUGHTS_ENDED);
  m.thoughts = m.thoughts.filter((x) => now < x.end);
  return Math.max(-30, Math.min(30, Math.round(m.thoughts.reduce((s, t) => s + valueAt(t, now), 0) * 10) / 10));
}
export function moodLine(village: string, agent: string, now: number): string {
  if (!CHARACTER.mood) return '';
  const mood = moodOf(village, agent, now);
  if (Math.abs(mood) < 3) return '';
  const top = [...ms(village, agent).thoughts].sort((a, b) => Math.abs(valueAt(b, now)) - Math.abs(valueAt(a, now))).slice(0, 2).map((t) => t.src);
  return `You feel ${mood >= 10 ? 'good' : mood > 0 ? 'fairly good' : mood <= -10 ? 'low' : 'a little low'} (${mood > 0 ? '+' : ''}${Math.round(mood)}): ${top.join('; ')}.`;
}
/** Mood's weight on own projects (high mood 1.0..1.3) and on requests (low mood); 1 elsewhere. */
export function moodWeight(village: string, agent: string, kind: string, now: number): number {
  if (!CHARACTER.mood) return 1;
  const mood = moodOf(village, agent, now);
  if (kind === 'initiate') return Math.round((1 + 0.3 * Math.max(0, mood) / 30) * 100) / 100;
  return 1;
}

// ---------------------------------------------------------------------------------------------
// Layer 5: affinity
// ---------------------------------------------------------------------------------------------

type Fact = 'kept' | 'broke' | 'helped' | 'helpedBy' | 'refused' | 'accepted' | 'beside';
const FACT_V: Record<Fact, number> = { kept: 2, broke: -3, helped: 1, helpedBy: 1, refused: -1, accepted: 1, beside: 0.2 };
/** A verified fact between two members into `agent`'s affinity for `other` (work beside capped at 1 a village day). */
export function noteFact(village: string, agent: string, other: string, fact: Fact): void {
  if (!CHARACTER.affinity || agent === other) return;
  const m = ms(village, agent);
  const f = (m.facts[other] ??= { kept: 0, broke: 0, helped: 0, helpedBy: 0, refused: 0, accepted: 0, beside: 0 });
  f[fact]++;
  if (fact === 'beside' && f.beside > 5) return;
  const gain = fact === 'beside' ? FACT_V.beside * (0.75 + 0.25 * (hexacoOf(agent).X + 1)) : FACT_V[fact];
  m.aff[other] = Math.max(-10, Math.min(10, Math.round(((m.aff[other] ?? 0) + gain) * 10) / 10));
  save();
}
export function affinityOf(village: string, agent: string, other: string, feel = 0): number {
  return Math.max(-10, Math.min(10, (ms(village, agent).aff[other] ?? 0) + feel));
}
/** The daily decay toward 0 (10%; negative values of forgiving members 2x faster); the world calls it each sweep. */
export function decayAffinity(village: string, now: number): void {
  const v = vs(village, now);
  if (now - v.lastDecay < DAY_MS) return;
  v.lastDecay = now;
  for (const [agent, m] of Object.entries(v.members)) {
    const forgiving = hexacoOf(agent).A > 0.3;
    for (const o of Object.keys(m.aff)) m.aff[o] = Math.round(m.aff[o] * (m.aff[o] < 0 && forgiving ? 0.8 : 0.9) * 10) / 10;
  }
  save();
}
/** A word for a pair (G2's profile line): friend from +3, wary from -3. */
export const affinityWord = (a: number) => (a >= 3 ? 'friend' : a <= -3 ? 'wary of' : '');
/** Affinity's weight on help for `owner`'s project, 1.0..1.4 (friends only). */
export const helpWeight = (village: string, agent: string, owner: string) => (CHARACTER.affinity ? Math.round((1 + 0.4 * Math.max(0, affinityOf(village, agent, owner)) / 10) * 100) / 100 : 1);
/** A request's tag weight by agreeableness 0.8..1.25, and against a requester the member is wary of (affinity under -3). */
export function requestWeight(village: string, agent: string, requester: string): number {
  if (!CHARACTER.affinity && !CHARACTER.hexaco) return 1;
  const A = hexacoOf(agent).A;
  let w = 0.8 + 0.225 * (A + 1);
  if (CHARACTER.affinity && affinityOf(village, agent, requester) < -3) w *= 0.8 + 0.1 * (A + 1);
  return Math.round(w * 100) / 100;
}

// ---------------------------------------------------------------------------------------------
// Layer 6: identity, and the prompt's lines
// ---------------------------------------------------------------------------------------------

/** The identity core (B2: name, life goal, house; role and achievements only when roles are shown) with the
 *  temperament's words. */
export function identityLine(name: string, o: { goal?: string; house?: string; role?: string; achievements?: string[] }): string {
  const parts = [`You are ${name}, ${temperamentWords(name)}`];
  if (o.goal) parts.push(`your life goal is ${o.goal}`);
  if (o.house) parts.push(`you live in ${o.house}`);
  if (o.role) parts.push(`you have become the village's ${o.role}${o.achievements?.length ? ` (${o.achievements.join(', ')})` : ''}`);
  return `${parts.join('; ')}.`;
}

/** The character's lines for a decision prompt, recorded as last written (the panel's view) with the last 20 kept. */
export function noteLines(village: string, agent: string, lines: Record<string, string>, now: number): void {
  const m = ms(village, agent);
  const joined = Object.values(lines).filter(Boolean).join(' | ');
  if (m.lineLog[m.lineLog.length - 1]?.line !== joined) {
    m.lineLog.push({ t: now, line: joined });
    if (m.lineLog.length > LINE_LOG) m.lineLog.splice(0, m.lineLog.length - LINE_LOG);
  }
  m.lines = lines;
}

// ---------------------------------------------------------------------------------------------
// The character factor, the cap and floor
// ---------------------------------------------------------------------------------------------

export const FACTOR_MIN = 0.67, FACTOR_MAX = 1.5, CAP = 6.25, FLOOR = 0.16;
/** The layers beyond temperament as one factor, clamped (B1). */
export const characterFactor = (ws: { mw?: number; fw?: number; dw?: number; aw?: number }) => Math.round(Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, (ws.mw ?? 1) * (ws.fw ?? 1) * (ws.dw ?? 1) * (ws.aw ?? 1))) * 1000) / 1000;
/** An option's weight product capped and floored (with any layer on). */
export const capFloor = (p: number) => Math.min(CAP, Math.max(FLOOR, p));
/** A decision's factors (the chosen option's, for the series). */
export function noteDecision(village: string, agent: string, factor: number): void {
  const m = ms(village, agent);
  m.decisions++;
  m.factors.push(factor);
  if (m.factors.length > 30) m.factors.splice(0, m.factors.length - 30);
}

// ---------------------------------------------------------------------------------------------
// The series (spec 14.1, S1) and the views' data
// ---------------------------------------------------------------------------------------------

/** The sweep's sample: once a village minute a point per member (energy, appetite, mood, mean factor, decisions an
 *  hour); every 10 village minutes the affinity matrix and a `character` record into acts.jsonl. */
export function sample(village: string, members: Array<{ name: string; appetite?: number }>, now: number): void {
  if (!characterAny()) return;
  const v = vs(village, now);
  decayAffinity(village, now);
  if (now - v.lastSample < MINUTE_MS) return;
  v.lastSample = now;
  for (const mem of members) {
    const m = ms(village, mem.name);
    const ring = (v.series[mem.name] ??= []);
    const mood = moodOf(village, mem.name, now);
    const f = m.factors.length ? m.factors.reduce((s, x) => s + x, 0) / m.factors.length : 1;
    // (decisions in the village minute, as a rate a village hour)
    ring.push([now, m.energy, mem.appetite ?? -1, mood, Math.round(f * 1000) / 1000, m.decisions * 60]);
    m.decisions = 0;
    if (ring.length > SERIES_POINTS) ring.splice(0, ring.length - SERIES_POINTS);
  }
  if (now - v.lastMatrix >= 10 * MINUTE_MS) {
    v.lastMatrix = now;
    const names = members.map((x) => x.name);
    const m = names.map((a) => names.map((b) => (a === b ? 0 : Math.round(affinityOf(village, a, b) * 10) / 10)));
    v.matrix.push({ t: now, names, m });
    if (v.matrix.length > MATRIX_POINTS) v.matrix.splice(0, v.matrix.length - MATRIX_POINTS);
    logAct({ type: 'character', op: 'snapshot', village, members: Object.fromEntries(names.map((n) => [n, { energy: ms(village, n).energy, mood: moodOf(village, n, now) }])), matrix: m, names });
  }
  save();
}

/** GET /api/character?village=V: every member compact (traits, values, goal, energy and mood now with the top 2 feelings,
 *  the identity line, the top 3 and bottom 2 affinities), the village's distributions, the flags. */
export function villageView(village: string, names: string[], goals: Record<string, string>, now: number) {
  const q = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const at = (f: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))] : 0);
    return [at(0), at(0.25), at(0.5), at(0.75), at(1)];
  };
  const members = names.map((n) => {
    const m = ms(village, n);
    const aff = Object.entries(m.aff).sort((a, b) => b[1] - a[1]);
    return {
      name: n, traits: hexacoOf(n), values: valuesOf(n), goal: goals[n] ?? null, energy: m.energy, mood: moodOf(village, n, now),
      feelings: [...m.thoughts].sort((a, b) => Math.abs(valueAt(b, now)) - Math.abs(valueAt(a, now))).slice(0, 2).map((t) => ({ v: Math.round(valueAt(t, now) * 10) / 10, src: t.src })),
      identity: m.lines.identity ?? '', top: aff.slice(0, 3), bottom: aff.slice(-2).filter(([, x]) => x < 0),
      flags: { tired: m.energy < 0.35 },
    };
  });
  return {
    village, run: vs(village, now).run, flags: { ...CHARACTER }, members,
    dist: { mood: q(members.map((m) => m.mood)), energy: q(members.map((m) => m.energy)) },
  };
}

/** GET /api/agents/:name/character?since=T: one member in full. */
export function memberView(village: string, name: string, since: number, now: number) {
  const m = ms(village, name);
  const v = vs(village, now);
  return {
    name, run: v.run, traits: hexacoOf(name), traitWords: temperamentWords(name), values: valuesOf(name), goalFromValues: goalFromValues(name),
    energy: m.energy, mood: moodOf(village, name, now), rests: m.rests,
    thoughts: m.thoughts.map((t) => ({ ...t, now: Math.round(valueAt(t, now) * 10) / 10 })), ended: m.ended,
    affinity: Object.entries(m.aff).map(([o, a]) => ({ of: o, a, word: affinityWord(a), facts: m.facts[o] ?? null })).sort((x, y) => y.a - x.a),
    series: (v.series[name] ?? []).filter((p) => p[0] > since), columns: ['t', 'energy', 'appetite', 'mood', 'factor', 'decisionsPerHour'],
    lines: m.lines, lineLog: m.lineLog,
  };
}

/** GET /api/character/series?village=V&since=T[&matrix=1]: mood's and energy's quartiles a minute, rests, the matrix. */
export function seriesView(village: string, since: number, matrix: boolean) {
  const v = vs(village);
  const byT = new Map<number, { mood: number[]; energy: number[] }>();
  for (const ring of Object.values(v.series)) for (const p of ring) {
    if (p[0] <= since) continue;
    const k = Math.round(p[0] / MINUTE_MS) * MINUTE_MS;
    const e = byT.get(k) ?? { mood: [], energy: [] };
    e.mood.push(p[3]);
    e.energy.push(p[1]);
    byT.set(k, e);
  }
  const q = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return [0.25, 0.5, 0.75].map((f) => s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))] ?? 0);
  };
  return {
    village, run: v.run,
    points: [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, x]) => ({ t, mood: q(x.mood), energy: q(x.energy) })),
    rests: Object.entries(v.members).flatMap(([n, m]) => m.rests.filter((t) => t > since).map((t) => ({ name: n, t }))),
    ...(matrix ? { matrix: v.matrix.filter((s) => s.t > since) } : {}),
  };
}

/** Kind words for the views. */
export const kindWord = (k: string) => KIND_WORDS[k] ?? k;
