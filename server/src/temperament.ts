/**
 * Temperaments (A.3p part 1, spec runs/2026-10-16/s33/spec_a3p.md): a fixed trait vector per agent name, the weight it
 * gives each chore kind, and the persona line code writes from it. World-free and pure: the world multiplies the weights
 * into its menu (mcWorld.ts choiceOptions: an option's `tw`), choose.ts reads `tw` in the fixed pick, the trim and the
 * prompt's tags. Five traits, the user's choice (10-16): curiosity, care, diligence and pride weight chore kinds;
 * sociability weights an option by how many others are on its kind now.
 *
 * Setting (read once, when the module loads):
 *   MCAI_TEMPERAMENT   on (the default since s33, the user's): the vectors below;
 *                      identical: every agent the zero vector, the own-pattern reminder shown (E.8's arms);
 *                      off: no weights, tags, persona line or reminder (the goldens run with it).
 */
import { workerName, workerNumber } from './agentNames';
import { CHOOSE, fnv1a, mulberry32, shuffled } from './choose';
import type { ChoiceKind } from './world';

export type TemperamentMode = 'off' | 'on' | 'identical';
const rawMode = (process.env.MCAI_TEMPERAMENT ?? 'on').trim().toLowerCase();
export const TEMPERAMENT_MODE: TemperamentMode = rawMode === 'off' || rawMode === 'identical' ? rawMode : 'on';

export const TRAITS = ['curiosity', 'care', 'diligence', 'pride', 'sociability'] as const;
export type Trait = (typeof TRAITS)[number];
export type Temperament = Record<Trait, number>;

/** The weight of the most-liked kind (the least-liked gets its inverse, 0.4). */
export const WEIGHT_MAX = 2.5;
/** The kinds a temperament weights (eat is always 1). */
export const KINDS: ChoiceKind[] = ['farm', 'slot', 'start', 'annex', 'pen', 'penwork', 'cake', 'iron', 'explore', 'works', 'make', 'gather', 'light', 'furnish', 'initiate', 'help'];
/** Kinds behind a family that weigh only while it is on (X.1: a village that never offers furnishing must not move every
 *  other kind's centred weight, nor tell a member it most enjoys furnishing; the critique's 10). */
const FAMILY_KINDS: Partial<Record<ChoiceKind, string>> = { furnish: 'furnish', initiate: 'initiatives', help: 'initiatives' };
/** The kinds weighed now: KINDS less those whose family is off. */
export const activeKinds = (): ChoiceKind[] => KINDS.filter((k) => !FAMILY_KINDS[k] || CHOOSE.families.has(FAMILY_KINDS[k]!));
const KIND_TRAITS: Trait[] = ['curiosity', 'care', 'diligence', 'pride'];
/** Each kind's loading on the four kind traits (spec 1). */
const LOAD: Record<string, Partial<Record<Trait, number>>> = {
  explore: { curiosity: 1 },
  start: { curiosity: 0.6, care: 0.4 },
  iron: { curiosity: 0.5, diligence: 0.5 },
  farm: { care: 0.5, diligence: 0.5 },
  slot: { care: 0.5, diligence: 0.5 },
  pen: { care: 1 },
  penwork: { care: 1 },
  annex: { care: 0.5, pride: 0.5 },
  cake: { care: 0.5, pride: 0.5 },
  works: { diligence: 0.4, pride: 0.6 },
  light: { diligence: 0.4, pride: 0.6 },
  make: { diligence: 0.6, pride: 0.4 },
  gather: { diligence: 1 },
  furnish: { pride: 0.8, care: 0.2 },
  initiate: { pride: 0.5, curiosity: 0.3, diligence: 0.2 },
  help: { diligence: 0.5, care: 0.3, pride: 0.2 },
};
/** A kind in the persona line's words (farm and slot are both harvesting). */
export const KIND_PHRASE: Record<string, string> = {
  farm: 'harvesting', slot: 'harvesting', start: 'starting new farms', annex: 'preparing the annex', pen: 'leading animals into pens',
  penwork: 'tending the pens', cake: 'baking', iron: 'digging for iron', explore: 'exploring', works: 'setting up the works',
  make: 'making goods', gather: 'gathering materials', light: 'lighting the village', furnish: 'furnishing the houses',
  initiate: 'starting projects of your own', help: "helping with others' projects",
};

const ZERO: Temperament = { curiosity: 0, care: 0, diligence: 0, pride: 0, sociability: 0 };
/** The Mayor's, by hand (spec 1). */
const MAYOR: Temperament = { curiosity: -0.4, care: 0, diligence: 0.3, pride: 0.8, sociability: 0.6 };
const WORKERS = 24;

/** Workers 1-24's vectors (by pool name since s38, agentNames.ts; WorkerN still read): a Latin-hypercube draw seeded with 'A.3p' (each trait's 24 values one per stratum of [-1, 1]). */
const WORKER_VECTORS: Temperament[] = (() => {
  const rnd = mulberry32(fnv1a('A.3p'));
  const out: Temperament[] = Array.from({ length: WORKERS }, () => ({ ...ZERO }));
  for (const t of TRAITS) {
    const strata = shuffled(Array.from({ length: WORKERS }, (_, i) => i), `A.3p|${t}`);
    for (let w = 0; w < WORKERS; w++) out[w][t] = Math.round((-1 + (2 * (strata[w] + rnd())) / WORKERS) * 100) / 100;
  }
  return out;
})();

/** The agent's own vector, whatever the mode: the Mayor's by hand, workers 1-24's drawn, any other name zero. */
export function vectorOf(name: string): Temperament {
  const n = name.trim().toLowerCase();
  if (n === 'mayor') return { ...MAYOR };
  const i = workerNumber(n);
  return i >= 1 && i <= WORKERS ? { ...WORKER_VECTORS[i - 1] } : { ...ZERO };
}

/** The vector in force: off and identical give zero. */
export function temperament(name: string, mode: TemperamentMode = TEMPERAMENT_MODE): Temperament {
  return mode === 'on' ? vectorOf(name) : { ...ZERO };
}

/** Each kind's weight (0.4..2.5) from a vector: affinities centred over the kinds, scaled so the strongest is +-1. */
export function kindWeights(v: Temperament): Record<string, number> {
  const KINDS = activeKinds();
  const a = KINDS.map((k) => KIND_TRAITS.reduce((s, t) => s + (LOAD[k][t] ?? 0) * v[t], 0));
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const c = a.map((x) => x - mean);
  const top = Math.max(...c.map(Math.abs));
  const out: Record<string, number> = { eat: 1 };
  KINDS.forEach((k, i) => (out[k] = top > 1e-9 ? Math.round(WEIGHT_MAX ** (c[i] / top) * 100) / 100 : 1));
  return out;
}

/** An option's weight: its kind's, times sociability's pull toward (or away from) a kind `others` members are on now;
 *  a meal always 1 (the review: a loner's meal sank out of model mode's trim while others ate). */
export function optionWeight(v: Temperament, weights: Record<string, number>, kind: ChoiceKind, others: number): number {
  if (kind === 'eat') return 1;
  const social = WEIGHT_MAX ** (v.sociability * Math.min(1, others / 2));
  return Math.round((weights[kind] ?? 1) * social * 100) / 100;
}

const HIGH: Record<Trait, string> = { curiosity: 'curious', care: 'caring', diligence: 'hard-working', pride: 'proud of how the village looks', sociability: 'sociable' };
const LOW: Record<Trait, string> = { curiosity: 'content close to home', care: 'unbothered by animals', diligence: 'easy-going', pride: 'indifferent to looks', sociability: 'a loner' };

const andList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** One sentence (<= 200 chars) from the vector: its strong traits, then the two most-liked kinds and the least-liked. '' for zero. */
export function personaLine(v: Temperament): string {
  if (TRAITS.every((t) => v[t] === 0)) return '';
  const byStrength = [...TRAITS].sort((x, y) => Math.abs(v[y]) - Math.abs(v[x]));
  const words = byStrength.filter((t) => Math.abs(v[t]) >= 0.35).slice(0, 3).map((t) => (v[t] > 0 ? HIGH[t] : LOW[t]));
  const w = kindWeights(v);
  // (farm and slot share a phrase: one place each)
  const phrases: Array<{ p: string; w: number }> = [];
  for (const k of activeKinds()) {
    const p = KIND_PHRASE[k];
    const had = phrases.find((x) => x.p === p);
    if (had) had.w = Math.max(had.w, w[k]);
    else phrases.push({ p, w: w[k] });
  }
  phrases.sort((x, y) => y.w - x.w);
  const liked = phrases.slice(0, 2).filter((x) => x.w > 1).map((x) => x.p);
  const least = phrases[phrases.length - 1];
  const who = words.length ? `You are ${andList(words)}` : 'You have no strong leanings';
  const likes = liked.length ? `you most enjoy ${andList(liked)}${least.w < 1 ? `, and least ${least.p}` : ''}` : '';
  return `${who}${likes ? `: ${likes}` : ''}.`.slice(0, 200);
}

/** The persona line in force for a name ('' when off or identical). */
export function personaOf(name: string, mode: TemperamentMode = TEMPERAMENT_MODE): string {
  return personaLine(temperament(name, mode));
}

/** Every named agent's vector, weights and line (the panel, the API, the check and the report). */
export function temperamentTable(): Array<{ name: string; vector: Temperament; weights: Record<string, number>; persona: string }> {
  const names = ['Mayor', ...Array.from({ length: WORKERS }, (_, i) => workerName(i + 1))];
  return names.map((name) => {
    const vector = vectorOf(name);
    return { name, vector, weights: kindWeights(vector), persona: personaLine(vector) };
  });
}
