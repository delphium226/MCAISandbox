/**
 * The masons' lodge (#163; MC_LODGE, off): the monument's workshop beside its pad and quarry. One level strip holds the
 * kiln's furnaces (kiln.ts), the stonecutter at the kiln's end (cutter.ts), a crafting table and a row of the yard's own
 * chests, so a monument chore (a quarry trip, a tend, a cut, a build job) withdraws and deposits there instead of at the
 * storage hut 100-140 blocks off (T2d: hut to pad ~110, to the quarry ~105). The lodge's chests are village storage
 * chests marked `lodge` (the yard stays a ledger over storage), kept out of the hut's gauge, its sorting and the bulk cap
 * (mcStorage.ts). It is chosen with the kiln, on ground nearest the point between the pad and the quarry: a two-row kiln
 * that found no ground within 64 of the crowded hut (#161) is looked for there.
 *
 * Bulk trips (the user's, 10-26): cobblestone, logs and sand for the monument gathered MC_LODGE_TRIP stacks at a time or
 * for TRIP_MIN minutes (digs are timed by Paper's wall clock, lesson 40: only the walks between them shrink), the last
 * ones cut to what the stage still wants after the trips already out, and at most BULK_LANES out at once for an item so
 * the other members keep the kiln and the builders fed.
 *
 * World-free: the lodge's size and cells, its site search over a ground function, a trip's amount; mcKiln.ts builds it.
 */
import { rawSetting } from './settings';
import type { Area } from './village';
import { kilnStrip } from './kiln';
import { searchQuarry } from './quarry';

export const LODGE = {
  on: /^(on|1|true|yes)$/i.test(rawSetting('MC_LODGE') ?? 'off'),
  /** Stacks a bulk trip aims for. */
  stacks: Math.max(1, Math.min(8, Math.floor(Number(rawSetting('MC_LODGE_TRIP') ?? 4) || 4))),
};
/** A bulk trip's time (wall-clock minutes) and the bulk trips out at once for one item. */
export const TRIP_MIN = 5, BULK_LANES = 3;
/** The least a bulk trip is sent for while another trip for the item is out (the rest comes with it). */
const TRIP_FLOOR = 16;

type Cell = { x: number; y: number; z: number };
/** The lodge's record (Monument.lodge). */
export interface Lodge extends Area {
  y: number;
  state: 'building' | 'ready';
  /** The chests' cells (the row under the kiln) and the table's. */
  chests: Cell[];
  table: Cell;
  by: string;
  at: number;
  structure?: string;
}

/** The lodge's strip for k furnaces: the kiln's strip (its rows and walks), then the row of chests and the table, and a
 *  walk outside it; 7 wide at least (three chests). */
export function lodgeSize(k: number): { w: number; d: number } {
  const s = kilnStrip(k);
  return { w: Math.max(s.w, 7), d: s.d + 2 };
}

/** The parts of a lodge prepared at level y (standing on it: y + 1): the kiln's strip at its north-west corner, the table
 *  and the chests (every second cell, so no two join) in the row south of it. */
export function lodgeParts(area: Area, y: number, k: number): { kiln: Area; chests: Cell[]; table: Cell } {
  const { w, d } = kilnStrip(k);
  const kiln = { x1: area.x1, z1: area.z1, x2: area.x1 + w - 1, z2: area.z1 + d - 1 };
  const row = area.z1 + d;
  const chests: Cell[] = [];
  for (let x = area.x1 + 1; x <= area.x2; x += 2) chests.push({ x, y: y + 1, z: row });
  return { kiln, chests, table: { x: area.x1, y: y + 1, z: row } };
}

/** A new lodge record. */
export function newLodge(area: Area, y: number, k: number, by: string, now: number): Lodge {
  const { chests, table } = lodgeParts(area, y, k);
  return { ...area, y, state: 'building', chests, table, by, at: now };
}

const mid = (a: Area) => ({ x: (a.x1 + a.x2) / 2, z: (a.z1 + a.z2) / 2 });

/**
 * The lodge's site (pure): level ground (within 2), dry, off everything `takenAt` names with searchQuarry's margin,
 * nearest the point between the pad and the quarry (the hut's when there is no quarry yet), within half their distance
 * and the strip's size plus 24, then 48 (as searchSite widens).
 */
export function searchLodge(input: {
  k: number; pad: Area; quarry?: Area; hut: { x: number; z: number }; maxRange?: number;
  ground: (x: number, z: number) => { y: number; trees: number } | null; takenAt: (x: number, z: number) => boolean;
}): { area: Area; y: number; cost: number; target: { x: number; z: number } } | null {
  const { w, d } = lodgeSize(input.k);
  const p = mid(input.pad), q = input.quarry ? mid(input.quarry) : input.hut;
  const target = { x: Math.round((p.x + q.x) / 2), z: Math.round((p.z + q.z) / 2) };
  const half = Math.round(Math.hypot(p.x - q.x, p.z - q.z) / 2);
  for (const extra of [24, 48]) {
    const range = Math.min(input.maxRange ?? 96, half + Math.max(w, d) + extra);
    const found = searchQuarry({ side: w, depthSide: d, center: target, hut: target, range, ground: input.ground, takenAt: input.takenAt });
    if (found) return { area: found.area, y: found.y, cost: found.cost, target };
  }
  return null;
}

/**
 * A bulk trip's amount: what the stage still wants of the item after the trips out for it, at most `stacks` stacks; null
 * when nothing is left to send a trip for (or only a little while another trip is out: it comes with that one).
 */
export function bulkTrip(want: number, out: number, stacks = LODGE.stacks): number | null {
  const left = Math.ceil(want - out);
  if (left <= 0 || (out > 0 && left < TRIP_FLOOR)) return null;
  return Math.min(stacks * 64, left);
}

/** The monument's own goods, the ones the lodge's chests take (#163): what its yard holds, any piece of its bill, its raw
 *  stone and sand, the kiln's output and fuel. The rest a monument chore carries goes to the hut (L3: a dyer's wheat seeds
 *  went to the lodge, and the dye bed's composter had none left for bone meal). */
const LODGE_GOODS = /^(cobblestone|stone|smooth_stone|sand|red_sand|glass|andesite|diorite|granite|tuff|coal|charcoal|.*_log|.*_planks)$/;
export function lodgeKeeps(m: { yard: Record<string, number> } | undefined, bill: Record<string, number> | undefined, name: string): boolean {
  return LODGE_GOODS.test(name) || (m?.yard[name] ?? 0) > 0 || (bill?.[name] ?? 0) > 0;
}

/** The record's line for logs. */
export function lodgeLine(l: Lodge): string {
  return `lodge ${l.x2 - l.x1 + 1}x${l.z2 - l.z1 + 1} at ${l.x1},${l.z1} y ${l.y} ${l.state}: ${l.chests.length} chests, table at ${l.table.x},${l.table.z}`;
}
