/**
 * The thriving scorecard's sample (#80, M1 of docs/STRATEGY.md): what a village has at one moment, read from its record
 * and two world readings. Members and houses; needs met, the welfare gauges of needs.ts (food, housing, light, furnish) each
 * as the share met (fed members, housed members, lit spots, filled decor spots); goods in storage and in members' own
 * chests (items and kinds); techniques (innovation's unlocked entries) and recipes (every good the village has made);
 * works (structures standing, houses among them, public works built) and roads (street cells of the layouts); trades
 * (barter offers taken, emeralds traded with the merchant). The simulator writes one every 10 simulated minutes
 * (sim.score.jsonl), the panel keeps one a minute (/api/scorecard); scripts/scorecard.py bins and judges them. Reading only,
 * world-free: the world's readings come in through ScoreWorld.
 */
import { appetiteOn, stateOf } from './appetite';
import { housesOf } from './grow';
import type { Village } from './village';

type Counts = Record<string, number>;

/** What the sample needs from the world: the village's members, and its light and decor parts (mcWorld's). */
export interface ScoreWorld {
  members(v: Village): number;
  lightParts?(v: Village): Array<{ kind: string; unlit: number; spots: unknown[] }>;
  decorParts?(v: Village): Array<{ open: unknown[]; spots: unknown[] }>;
}

export type ScoreNeed = 'food' | 'housing' | 'light' | 'furnish';

export interface ScoreSample {
  /** ms since the epoch */
  t: number;
  members: number;
  /** Residents who are not members (vanilla villagers, #4): absent until a village keeps them. */
  residents?: number;
  houses: number;
  /** Each kept welfare need's share met, 0..1; a need the village does not keep is absent. */
  needs: Partial<Record<ScoreNeed, number>>;
  /** The mean of `needs`, null when none is kept. */
  needsMet: number | null;
  store: { items: number; kinds: number };
  own: { items: number; kinds: number; chests: number };
  /** Kinds held anywhere (storage or an own chest). */
  kinds: number;
  techniques: number;
  recipes: number;
  structures: number;
  publicWorks: number;
  roads: number;
  /** Barter offers taken; emeralds traded with the merchant. */
  trades: { barter: number; merchant: number };
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const share = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 1);

/** One sample of a village now. */
export function scoreSample(w: ScoreWorld, v: Village, now = Date.now()): ScoreSample {
  const members = w.members(v);
  const houses = housesOf(v);
  const needs: Partial<Record<ScoreNeed, number>> = {};
  // (as mcWorld.needTick reads them: fed members while the appetite is on, housed members, building light spots lit, decor
  // spots filled)
  if (appetiteOn(v) && members > 0) {
    const fed = Object.values(v.food.members).filter((m) => stateOf(m.level ?? 20) === 'fed').length;
    needs.food = round(share(fed, Object.keys(v.food.members).length || members));
  }
  if (members > 0) needs.housing = round(share(houses, members));
  const lights = (w.lightParts?.(v) ?? []).filter((p) => p.kind === 'building');
  const spots = lights.reduce((s, p) => s + p.spots.length, 0);
  if (spots > 0) needs.light = round(1 - share(lights.reduce((s, p) => s + p.unlit, 0), spots));
  const decor = w.decorParts?.(v) ?? [];
  const decorSpots = decor.reduce((s, p) => s + p.spots.length, 0);
  if (decorSpots > 0) needs.furnish = round(1 - share(decor.reduce((s, p) => s + p.open.length, 0), decorSpots));
  const met = Object.values(needs);
  const store: Counts = {};
  for (const c of v.storage?.chests ?? []) for (const [n, q] of Object.entries(c.items)) if (q > 0) store[n] = (store[n] ?? 0) + q;
  const own: Counts = {};
  const homes = Object.values(v.homes ?? {});
  for (const h of homes) for (const [n, q] of Object.entries(h.chest?.items ?? {})) if (q > 0) own[n] = (own[n] ?? 0) + q;
  const sum = (c: Counts) => Object.values(c).reduce((s, q) => s + q, 0);
  // (street cells once each: the layouts' street rectangles overlap at their corners)
  const cells = new Set<string>();
  for (const l of v.layouts ?? []) for (const s of l.streets ?? []) for (let x = Math.min(s.x1, s.x2); x <= Math.max(s.x1, s.x2); x++) for (let z = Math.min(s.z1, s.z2); z <= Math.max(s.z1, s.z2); z++) cells.add(`${x},${z}`);
  return {
    t: now,
    members,
    ...(Array.isArray((v as { residents?: unknown[] }).residents) ? { residents: (v as { residents?: unknown[] }).residents!.length } : {}),
    houses,
    needs,
    needsMet: met.length ? round(met.reduce((s, x) => s + x, 0) / met.length) : null,
    store: { items: sum(store), kinds: Object.keys(store).length },
    own: { items: sum(own), kinds: Object.keys(own).length, chests: homes.filter((h) => h.chest).length },
    kinds: new Set([...Object.keys(store), ...Object.keys(own)]).size,
    // (read off the record: techOf and boardOf add the record when it is missing)
    techniques: (v as { innovation?: { unlocked?: string[] } }).innovation?.unlocked?.length ?? 0,
    recipes: Object.keys(v.tech ?? {}).length,
    structures: v.structures.filter((s) => s.kind !== 'storage').length,
    publicWorks: (v.initiatives ?? []).filter((i) => i.state === 'built').length,
    roads: cells.size,
    trades: { barter: (v as { board?: { taken?: number } }).board?.taken ?? 0, merchant: v.merchant?.xp ?? 0 },
  };
}

/** Samples kept a village, one a minute at most, a day of them (the panel's trend). In memory. */
export const SCORE_KEEP = 24 * 60;

export class ScoreClock {
  private samples = new Map<string, ScoreSample[]>();

  /** A sample of each village unless its last is under `everyMs` old. */
  sample(w: ScoreWorld, villages: Village[], now = Date.now(), everyMs = 60_000): void {
    for (const v of villages) {
      const xs = this.samples.get(v.name) ?? [];
      if (xs.length && now - xs[xs.length - 1].t < everyMs) continue;
      xs.push(scoreSample(w, v, now));
      if (xs.length > SCORE_KEEP) xs.splice(0, xs.length - SCORE_KEEP);
      this.samples.set(v.name, xs);
    }
  }

  of(village: string): ScoreSample[] {
    return this.samples.get(village) ?? [];
  }
}

// ---- the view: 10-minute points, hours, the pass mark (scripts/scorecard.py's rules, for the panel) ----------------------

const BIN_MS = 10 * 60_000;

/** One 10-minute point: busy (%) and needs met over it, the levels at its end, the counters' additions in it. */
export interface ScorePoint {
  minute: number;
  busy: number | null;
  needsMet: number | null;
  needs: Partial<Record<ScoreNeed, number>>;
  members: number;
  houses: number;
  goodsPerMember: number;
  kinds: number;
  techniques: number;
  works: number;
  publicWorks: number;
  roads: number;
  /** Barter offers taken, and emeralds traded with the merchant (its xp: emeralds, not trades). */
  trades: number;
  emeralds: number;
}

export interface ScoreVerdict { verdict: 'PASS' | 'FAIL' | 'NO VERDICT'; collapse: number | null; why: string[] }

export interface ScoreView { start: number; binMin: number; points: ScorePoint[]; hours: ScorePoint[]; verdict: ScoreVerdict }

const mean = (xs: Array<number | null | undefined>) => {
  const k = xs.filter((x): x is number => typeof x === 'number');
  return k.length ? k.reduce((s, x) => s + x, 0) / k.length : null;
};

/**
 * The pass mark (STRATEGY.md, the user's of 10-21; scripts/scorecard.py's verdict): a collapse is any hour after the first
 * whose busy falls below half of hour 1's. Hours are whole 6-point hours (a last hour of at least 3 points counts); the
 * collapse minute is the start of the first 30-minute window after hour 1 whose mean is under that half. Needs met is not
 * judged.
 */
export function judge(points: ScorePoint[], minutes: number): ScoreVerdict {
  if (minutes < 120) return { verdict: 'NO VERDICT', collapse: null, why: [`${Math.round(minutes)} min: the pass mark needs at least 2 hours (6 for the strategy's)`] };
  const vals = points.map((p) => p.busy);
  const hours: Array<number | null> = [];
  for (let h = 0; h < vals.length; h += 6) {
    const part = vals.slice(h, h + 6);
    if (part.length < 3) break;
    hours.push(mean(part));
  }
  if (hours.length < 2 || hours[0] === null) return { verdict: 'NO VERDICT', collapse: null, why: ['busy: hour 1 or a later hour not measured'] };
  const half = hours[0] / 2;
  const failed = hours.map((x, h) => (h > 0 && x !== null && x < half ? h + 1 : 0)).filter((h) => h > 0);
  let collapse: number | null = null;
  for (let k = 6; k < vals.length; k++) {
    const m = mean(vals.slice(k, k + 3));
    if (m !== null && m < half) {
      collapse = k * 10;
      break;
    }
  }
  const later = hours.slice(1).map((x) => (x === null ? '-' : String(Math.round(x * 100) / 100))).join(' / ');
  const why = [`busy: hour 1 ${+hours[0].toPrecision(3)} (half ${+half.toPrecision(3)}); later hours ${later}${failed.length ? `; below half in hour ${failed.join(', ')}` : '; none below half'}${collapse !== null ? `; the 30-minute mean first below half at minute ${collapse}` : ''}`];
  const worst = Math.min(...hours.slice(1).filter((x): x is number => x !== null));
  if (Number.isFinite(worst) && hours[0]) why.push(`worst later hour ${(worst / hours[0]).toFixed(2)}x hour 1`);
  if (minutes < 360) why.push(`(a ${Math.round(minutes)}-minute run: the strategy's pass mark is for 6 hours)`);
  return { verdict: failed.length ? 'FAIL' : 'PASS', collapse, why };
}

/**
 * Samples (at least one) and busy shares per 10-minute bin from the first sample (0..1, null where unknown) as 10-minute
 * points, hours (a level's mean, a counter's sum; an hour with at least 3 points) and the pass mark.
 */
export function scorecardView(samples: ScoreSample[], busy: Array<number | null>): ScoreView {
  const start = samples[0].t, end = samples[samples.length - 1].t;
  const n = Math.max(1, Math.ceil((end - start) / BIN_MS));
  const s0 = samples[0];
  const points: ScorePoint[] = [];
  let i = 0, prev = s0, last = s0;
  for (let k = 0; k < n; k++) {
    const inBin: ScoreSample[] = [];
    while (i < samples.length && samples[i].t <= start + (k + 1) * BIN_MS + 30_000) inBin.push((last = samples[i++]));
    const b = busy[k];
    points.push({
      minute: k * 10, busy: typeof b === 'number' ? Math.round(b * 1000) / 10 : null,
      needsMet: last.needsMet, needs: last.needs, members: last.members, houses: last.houses,
      goodsPerMember: Math.round((last.store.items / Math.max(1, last.members)) * 10) / 10, kinds: last.store.kinds,
      techniques: last.techniques - prev.techniques, works: last.structures - prev.structures, publicWorks: last.publicWorks - prev.publicWorks,
      roads: last.roads, trades: last.trades.barter - prev.trades.barter, emeralds: last.trades.merchant - prev.trades.merchant,
    });
    prev = last;
  }
  const hours: ScorePoint[] = [];
  for (let h = 0; h * 6 < n; h++) {
    const ps = points.slice(h * 6, h * 6 + 6);
    if (ps.length < 3) break;
    const sum = (f: (p: ScorePoint) => number) => ps.reduce((s, p) => s + f(p), 0);
    const avg = (f: (p: ScorePoint) => number | null, d = 1) => { const m = mean(ps.map(f)); return m === null ? null : Math.round(m * 10 ** d) / 10 ** d; };
    const lastP = ps[ps.length - 1];
    hours.push({
      minute: h * 60, busy: avg((p) => p.busy), needsMet: avg((p) => p.needsMet, 3), needs: lastP.needs, members: lastP.members, houses: lastP.houses,
      goodsPerMember: avg((p) => p.goodsPerMember) ?? 0, kinds: avg((p) => p.kinds) ?? 0, techniques: sum((p) => p.techniques), works: sum((p) => p.works),
      publicWorks: sum((p) => p.publicWorks), roads: lastP.roads, trades: sum((p) => p.trades), emeralds: sum((p) => p.emeralds),
    });
  }
  return { start, binMin: 10, points, hours, verdict: judge(points, (end - start) / 60_000) };
}
