/**
 * The cathedral's kiln (M2, #145; MC_KILN, off): a row of furnaces beside the quarry that its masons load and unload
 * without waiting at them (a furnace cooks on by itself: 10 s an item at 1x, so a mason waiting at one smelted 6 a
 * minute; a row of 16 loaded in a walk smelts 96). It smelts what the cathedral's stage wants smelted: cobblestone into
 * stone (crafted into stone bricks at the hut's table), and with MC_GLAZING sand into glass. World-free: its size, its
 * cells, the ledger of what each furnace holds and when it will be done; mcKiln.ts builds and tends it, mcWorld.ts
 * offers it.
 *
 * The yard's ledger (monument.ts) moves with it: a load takes the input out of the yard into a furnace's count, an unload
 * puts the output (stone, glass) back in; what the furnaces hold counts as their output for the stage's wants, so no
 * gatherer is sent for cobblestone already in a furnace.
 */
import { rawSetting } from './settings';
import type { Area } from './village';

export const KILN = {
  on: /^(on|1|true|yes)$/i.test(rawSetting('MC_KILN') ?? 'off'),
};

/** What the kiln smelts (input -> output). */
export const KILN_SMELTS: Record<string, string> = { cobblestone: 'stone', sand: 'glass' };
/** A furnace's input slot, and an item's cook at 1x (ms). */
export const SLOT = 64, COOK_MS = 10000;

export interface KilnFurnace { x: number; y: number; z: number; input?: string; n: number; until: number }
/** The kiln's record (Monument.kiln). */
export interface Kiln extends Area {
  y: number;
  state: 'building' | 'ready';
  furnaces: KilnFurnace[];
  by: string;
  at: number;
  /** Smelted in all, by output; loads and unloads (tends). */
  made: Record<string, number>;
  tends: number;
  structure?: string;
}

/** Furnaces for a cathedral that wants `smelts` in all: one an ~250 smelts, 4 to 16. */
export function kilnSize(smelts: number): number {
  return Math.max(4, Math.min(16, Math.ceil(smelts / 250)));
}

/** The kiln's strip for k furnaces: k + 2 long, 3 wide (the furnaces down the middle, a walk on each side). */
export const kilnStrip = (k: number) => ({ w: k + 2, d: 3 });

/** The furnaces' cells on a strip prepared at level y (standing on it: y + 1). */
export function kilnCells(area: Area, y: number, k: number): Array<{ x: number; y: number; z: number }> {
  return Array.from({ length: k }, (_, i) => ({ x: area.x1 + 1 + i, y: y + 1, z: area.z1 + 1 }));
}

/** A new kiln record. */
export function newKiln(area: Area, y: number, k: number, by: string, now: number): Kiln {
  return { ...area, y, state: 'building', furnaces: kilnCells(area, y, k).map((c) => ({ ...c, n: 0, until: 0 })), by, at: now, made: {}, tends: 0 };
}

/** What a furnace has smelted by now (estimated from its load and the game's speed). */
export function cookedBy(f: KilnFurnace, now: number, scale = 1): number {
  if (!f.n) return 0;
  const left = Math.max(0, Math.ceil((f.until - now) / (COOK_MS / scale)));
  return Math.max(0, f.n - left);
}

/** A load: n of `input` into a furnace (the same input, or an empty one); its finish time pushed on. */
export function loadFurnace(f: KilnFurnace, input: string, n: number, now: number, scale = 1): void {
  if (n <= 0) return;
  if (f.n && f.input !== input) throw new Error(`a furnace holding ${f.input} cannot take ${input}`);
  f.input = input;
  f.n += n;
  f.until = Math.max(now, f.until) + n * (COOK_MS / scale);
}

/** An unload: n taken out (what it reported), the rest still in it; an empty furnace forgets its input. */
export function unloadFurnace(f: KilnFurnace, n: number): void {
  f.n = Math.max(0, f.n - n);
  if (!f.n) {
    f.input = undefined;
    f.until = 0;
  }
}

/** What the furnaces hold, as their outputs (the stage's wants count it as had). */
export function kilnHolds(k: Kiln | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of k?.furnaces ?? []) if (f.n && f.input) out[KILN_SMELTS[f.input]] = (out[KILN_SMELTS[f.input]] ?? 0) + f.n;
  return out;
}

/** A lane's furnaces (masons tend every `lanes`-th one, so two at once never open the same furnace). */
export function laneFurnaces(k: Kiln, lane: number, lanes: number): KilnFurnace[] {
  return k.furnaces.filter((_, i) => i % lanes === (lane - 1) % lanes);
}

/** Room for more input in a lane, by input (a furnace takes one input at a time; an empty one any). */
export function laneRoom(fs: KilnFurnace[], input: string): number {
  return fs.reduce((t, f) => t + (!f.n || f.input === input ? SLOT - f.n : 0), 0);
}

/**
 * How a load of `have` (input -> count) spreads over a lane's furnaces: each furnace's input and count, the inputs kept
 * apart (furnaces already on an input first, then empty ones).
 */
export function spreadLoad(fs: KilnFurnace[], have: Record<string, number>): Array<{ f: KilnFurnace; input: string; n: number }> {
  const left = { ...have };
  const plan: Array<{ f: KilnFurnace; input: string; n: number }> = [];
  const room = new Map(fs.map((f) => [f, SLOT - f.n]));
  const kinds = new Map(fs.map((f) => [f, f.n ? f.input : undefined]));
  const got = new Map<KilnFurnace, Record<string, number>>();
  // One item at a time to the least-loaded furnace that takes it (its own input, or empty), the inputs in turn: a load is
  // spread over the furnaces, which cook in parallel (M2's live check filled one to 64 before the next, and 133
  // cobblestone cooked in two furnaces one at a time while the stage waited), and a second input is not starved
  for (let more = true; more;) {
    more = false;
    for (const input of Object.keys(left)) {
      if (left[input] <= 0) continue;
      const f = fs.filter((g) => room.get(g)! > 0 && (kinds.get(g) ?? input) === input)
        .sort((a, b) => SLOT - room.get(a)! - (SLOT - room.get(b)!))[0];
      if (!f) continue;
      room.set(f, room.get(f)! - 1);
      kinds.set(f, input);
      left[input]--;
      const g = got.get(f) ?? {};
      g[input] = (g[input] ?? 0) + 1;
      got.set(f, g);
      more = true;
    }
  }
  for (const f of fs) for (const [input, n] of Object.entries(got.get(f) ?? {})) plan.push({ f, input, n });
  return plan;
}

/** The lane's furnaces as a load sees them now: what each should still be cooking (what is done comes out at the visit),
 *  one with nothing left to cook free for any input. M2's live check: 2 cobblestone left in each of the 8 furnaces kept
 *  the glass stage's sand out of all of them, and 8 done a lane never asked for a tend. */
export function loadView(fs: KilnFurnace[], now: number, scale = 1): KilnFurnace[] {
  return fs.map((f) => {
    const n = f.n - cookedBy(f, now, scale);
    return { ...f, n, input: n > 0 ? f.input : undefined };
  });
}

/** The record's line for logs. */
export function kilnLine(k: Kiln, now: number, scale = 1): string {
  const held = k.furnaces.reduce((t, f) => t + f.n, 0), ready = k.furnaces.reduce((t, f) => t + cookedBy(f, now, scale), 0);
  const made = Object.entries(k.made).map(([n, q]) => `${q} ${n}`).join(', ') || 'nothing yet';
  return `kiln of ${k.furnaces.length} at ${k.x1},${k.z1} ${k.state}: ${held} in the furnaces (${ready} done), ${k.tends} tends; made ${made}`;
}
