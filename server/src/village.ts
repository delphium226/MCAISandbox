/**
 * Shared village state for agents building together: prepared plots, finished structures, a library of building
 * designs, a task board, and short-lived reservations that stop two agents from working the same ground.
 * Everything is saved to <world>/villages.json shortly after every change (E.0: written at most every 250 ms to 1 s, to a
 * temporary file renamed over it; flushSync() at shutdown), so it survives restarts.
 */
import type { VoteRecord } from './vote';
import fs from 'node:fs';
import path from 'node:path';
import type { BuildingStyle } from './buildingGen';
import type { FarmSpot, SignSpot } from './streetPlan';
import type { Side } from './farmSlots';
import { growing, housesOf } from './grow';
import { appetiteOn, stateOf, type Appetite } from './appetite';

export interface Area {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}
export interface Plot extends Area {
  id: string;
  y: number;
  preparedBy: string;
  /** The annex prepared beside the village after completion for its pens (10-09): not a plot to build on. */
  annex?: boolean;
  /** The works plot prepared beside the annex for the workshop's furnaces (S.9): not a plot to build on either. */
  works?: boolean;
  /**
   * A layout prepared in parts by several agents at once (S.6): the record is the whole layout at its one level from the
   * first part done, and this lists the parts done so far; deleted once every part is.
   */
  parts?: Area[];
  /** A green prepared for small works (s36): the id of the initiative that asked for it. A plot to build them on. */
  green?: string;
}

/** A part of a layout's plot prepared by one agent (S.6), with its margins [north, south, west, east]: 2 on the plot's edge, 0 inside. */
export type PlotPart = Area & { m: [number, number, number, number] };
/** A part's claim: its rectangle and its margins (the parts' claims tile the plot and its 2-block margin). */
export const partClaim = (p: PlotPart): Area => ({ x1: p.x1 - p.m[2], z1: p.z1 - p.m[0], x2: p.x2 + p.m[3], z2: p.z2 + p.m[1] });

/**
 * The prepared plot under all of `area`: with a plot prepared in parts (S.6), only once the parts holding every cell of it
 * are done (the lamps, the farm and the hut's stations read their level from it).
 */
export function preparedAt(v: Village, area: Area): Plot | undefined {
  const inside = (p: Area, x: number, z: number) => x >= p.x1 && x <= p.x2 && z >= p.z1 && z <= p.z2;
  return v.plots.find((p) => {
    if (area.x1 < p.x1 || area.x2 > p.x2 || area.z1 < p.z1 || area.z2 > p.z2) return false;
    if (!p.parts) return true;
    for (let x = area.x1; x <= area.x2; x++)
      for (let z = area.z1; z <= area.z2; z++) if (!p.parts.some((q) => inside(q, x, z))) return false;
    return true;
  });
}
export interface Structure extends Area {
  id: string;
  y: number;
  kind: string;
  builtBy: string;
}
export interface Reservation extends Area {
  id: string;
  by: string;
  purpose: string;
  until: number;
}
/** A village storage chest and what it held when last opened. */
export interface StorageChest {
  x: number;
  y: number;
  z: number;
  items: Record<string, number>;
  /** The material group it holds, in a sorted storage (the storage hut): logs, planks, cobblestone, ..., misc. */
  group?: string;
}
/**
 * The village mine (plan step V.5): stairs from inside the mining hut down to stone, then a main tunnel with branches at
 * that level. `level` is set once the stairs reach it (the height a bot stands at in the tunnels); `dug` counts the tunnel
 * columns dug in all (since V.5b, every tunnel's; the size limit, collect's messages and the summary read it); `ended`
 * the branches cut short (water, lava, a cave, something built), in records from before V.5b.
 */
export interface Mine {
  hut: Area;
  /** The first step (inside the hut) and the stairs' direction. */
  top: { x: number; z: number };
  dir: [number, number];
  steps: number;
  level?: number;
  dug: number;
  ended: number[];
  /** What the tunnels have given, and ores seen in their walls. */
  got: Record<string, number>;
  /** Why the stairs stopped short, or why no tunnel can go on, if so. */
  stopped?: string;
  /**
   * The main tunnels (V.5b), set once the stairs reach stone: the first runs on from the bottom step; when a main tunnel
   * meets a hillside, water or village ground, the next turns left or right at one of its junctions. `dug` and `ended`
   * above are the first one's in records from before (kept for old readers); `dug` counts the cells dug in every tunnel.
   */
  legs?: MineLeg[];
  /**
   * Stairs on down to deeper levels (V.5b), dug when no tunnel at the level above can go on: each starts at the bottom
   * step above it (x, z; that level is y) and runs on in `dir`, one block down per step; `level` once it is dug, or why
   * it stopped short (no level is tried after that).
   */
  down?: Array<{ x: number; z: number; y: number; steps: number; level?: number; stopped?: string }>;
  /** The iron level (the iron age, 10-08): its own stairs, tunnels and record, never the cobblestone mine's. */
  iron?: IronLevel;
  /** The iron tools made from the village's iron (kept here: the first can be made from stored iron before any trip has
   *  made the iron level's record, VanI7 made a second pickaxe instead of a bucket). */
  ironMade?: string[];
  /** Failed iron chores by stage, and the last (a back-off; on the mine, not the iron level: see ironMade). */
  ironTries?: Record<string, number>;
  ironLastTry?: { at: number; stage: string; why: string };
}

/**
 * The iron level (10-08; a chore once the village stands): stairs from the deepest level's bottom step (x, z, at level
 * y) in `dir`, sideways off that level's tunnels, one block down per step to about y 18, then tunnels there (legs) that
 * keep the iron and coal in their walls. `got`: what its digging gave; `finished` once it has no more to give (or no way
 * down).
 */
export interface IronLevel {
  x: number;
  z: number;
  y: number;
  dir: [number, number];
  steps: number;
  level?: number;
  stopped?: string;
  legs: MineLeg[];
  dug: number;
  got: Record<string, number>;
  finished?: string;
  /** Stairs given up above y 40 (water or a cave in the way), kept as they are dug: the next start keeps off them. */
  abandoned?: Array<{ x: number; z: number; y: number; dir: [number, number]; steps: number; why: string }>;
  /** The cell the last trip failed at, and how many trips in a row (two end its branch or tunnel). */
  stuckAt?: { at: string; n: number };
}

/**
 * One main tunnel of the mine and its branches (V.5b). Branch ids: 3s + 1 is the left and 3s + 2 the right branch at
 * junction s + 1 (main cell 3(s + 1)). Since S.2 the cobblestone mine's tunnels keep their progress per part (`main`,
 * `br`), so that several miners dig one tunnel's branches at once; the iron level's keep the one counter (`dug`).
 */
export interface MineLeg {
  /** The cell it starts from (dug already), the level a bot stands at in it, and its direction. */
  x: number;
  z: number;
  y: number;
  dir: [number, number];
  /** Cells done in its digging order (main, left, right, stretch by stretch), and its branches cut short. With `br`, the
   *  cells done in all, for display only. */
  dug: number;
  ended: number[];
  /** Main cells done, passed ones included (S.2). */
  main?: number;
  /** Cells done per branch id, 0..12 (S.2): a tunnel is kept per part exactly when this is set. */
  br?: Record<number, number>;
  /** Why its main tunnel ended. */
  end?: string;
  /** Turns tried from it: 1 left, 2 right. */
  turned?: number;
}

/** Main tunnel columns between junctions, and a branch's length (the mine's geometry, mcMine.ts; here for the migration). */
export const MINE_STEP = 3, MINE_BRANCH = 12;

/** A tunnel's progress per part from its in-order counter (S.2): main cells done and cells done per branch. */
export function fromOrder(dug: number): { main: number; br: Record<number, number> } {
  const per = MINE_STEP + 2 * MINE_BRANCH;
  const s = Math.floor(dug / per), r = dug % per;
  const br: Record<number, number> = {};
  for (let q = 0; q < s; q++) br[3 * q + 1] = br[3 * q + 2] = MINE_BRANCH;
  if (r > MINE_STEP) br[3 * s + 1] = Math.min(MINE_BRANCH, r - MINE_STEP);
  if (r > MINE_STEP + MINE_BRANCH) br[3 * s + 2] = r - MINE_STEP - MINE_BRANCH;
  return { main: MINE_STEP * s + Math.min(r, MINE_STEP), br };
}

/**
 * A mine from before V.5b as its first main tunnel, starting at the bottom step. A mine stopped because its main tunnel
 * met something goes on: that tunnel ends there and the next turns. And tunnels from before S.2 kept per part (from their
 * in-order counter; branches cut short keep that count, as before). Not the iron level's: they stay in order.
 */
export function upgradeMine(m: Mine) {
  if (m.level === undefined) return;
  if (!m.legs) {
    m.legs = [{ x: m.top.x + m.dir[0] * (m.steps - 1), z: m.top.z + m.dir[1] * (m.steps - 1), y: m.level, dir: [m.dir[0], m.dir[1]], dug: m.dug, ended: [...m.ended] }];
    const met = 'the main tunnel met ';
    if (m.stopped?.startsWith(met)) {
      m.legs[0].end = m.stopped.slice(met.length);
      delete m.stopped;
    }
  }
  for (const l of m.legs) if (!l.br) Object.assign(l, fromOrder(l.dug));
}

/** A building drawn as layers (bottom-up) of rows (north to south) of palette characters (west to east). */
export interface Design {
  name: string;
  description: string;
  palette: Record<string, string>;
  layers: string[][];
  width: number;
  depth: number;
  height: number;
  blocks: number;
  by: string;
  /** The style code drew it from (buildingGen.ts, phase D.2). */
  style?: BuildingStyle;
}
/** A member's initiative (s35): a small work on the village's ground, built by whoever helps. */
export interface Initiative {
  id: string; by: string; kind: string; design: string; x: number; y: number; z: number; at: number;
  state: 'open' | 'built' | 'failed' | 'lapsed';
  crew: string[];
  steps: Array<{ agent: string; what: string; at: number }>;
  fails?: number; backoff?: number; end?: number; why?: string;
  /** No spot yet (s36): the plots were full, so its first step prepares a green (Plot.green = its id); x, y, z are the
   *  village's home until a spot on the green is found. */
  pending?: boolean;
  /** What its crew has gathered for it (the user's, s36: initiatives gather their own materials, storage is not drawn
   *  on), by item: logs as the village wood's log, cobblestone, sand. */
  gathered?: Record<string, number>;
}

export interface Task {
  id: string;
  title: string;
  detail: string;
  status: 'open' | 'claimed' | 'done' | 'failed';
  /** A prerequisite whose failure does not block what waits for it (gathering: the build checks its materials itself). */
  soft?: boolean;
  postedBy: string;
  /** Tasks that must be done first. */
  after: string[];
  claimedBy?: string;
  /** How many times a claim was given up; a task given up twice is marked failed. */
  tries: number;
  result?: string;
  updated: number;
  /** Its Build prerequisites count as met once claimed (the street lamps of a layout with no storage hut, #4; S.4). */
  afterClaimed?: boolean;
  /** Not claimable until then (ms): handed back because others hold what it needs (S.1), or given up with tries left (S.4). */
  cooldown?: number;
  /** How many give-ups mark it failed (default 2): a building's sign task has 4 (S.4). */
  retries?: number;
  /** When it was last claimed afresh (ms; the stage script's claim times, S.4). */
  claimedAt?: number;
}

/** The soft pickaxe supply (S.1): stone pickaxes made into storage, so miners leave the builds' cobblestone alone. */
export const PICK_SUPPLY = /^Make (\d+) stone_pickaxe into storage$/;
/** Its own cobblestone, gathered first; never counted for a building or the village's needs. */
export const PICK_GATHER = / for stone pickaxes$/;
/**
 * The village's parts made once (S.3): "Make 14 glass_pane into storage" (its detail adds the glass and the lamps' torches),
 * smelted and crafted at the storage hut for every building's windows, its sand gathered once "for the windows".
 */
export const PARTS_MAKE = /^Make (\d+) (glass_pane|glass|torch) into storage$/;
/** Code-posted tail work claimed before gathering (S.4): the pooled parts, the street lamps, the name signs. */
export const TAIL_TASK = /^(make_into_storage|light_streets|put_up_signs) /;
/** The label the pooled windows' sand is gathered for. */
export const WINDOWS = 'the windows';
/** Whether a village's glass or pane task is still to do or under way. */
export const windowsMaking = (v: Village) => v.tasks.some((t) => (t.status === 'open' || t.status === 'claimed') && /^glass/.test(PARTS_MAKE.exec(t.title)?.[2] ?? ''));
/** The storage hut's two stations (S.5: placed early, before the hut, in its own cells). */
export const STATION_NAMES = ['crafting_table', 'furnace'] as const;
export type StationName = (typeof STATION_NAMES)[number];
/**
 * The hard task that sets the stations up (S.5): posted with a new village's storage hut, houses and the windows wait for
 * it. Code closes it as soon as both stand (the storage set-up places the table, the mine's digger the furnace), so it is
 * claimed only as the fallback.
 */
export const STATIONS_TASK = 'Set up the village stations';
/** The stations not standing yet that their own task is still to place (open or held): billed for it, not the hut. */
export function stationsOwed(v: Village): StationName[] {
  const live = v.tasks.some((t) => t.title === STATIONS_TASK && (t.status === 'open' || t.status === 'claimed'));
  return live ? STATION_NAMES.filter((n) => !v.stations?.[n]) : [];
}
/** What the owed stations take from storage: a log for the table, 8 cobblestone for the furnace (S.5, stockCovers). */
export function stationsWanted(v: Village): { logs: number; cobblestone: number } {
  const owed = stationsOwed(v);
  return { logs: owed.includes('crafting_table') ? 1 : 0, cobblestone: owed.includes('furnace') ? 8 : 0 };
}
/** A building's own sign task's call (S.4: one task a building, by the centre build_design takes). */
export const signCall = (layout: number, s: { cx: number; cz: number }) => `put_up_signs layout=${layout} x=${s.cx} z=${s.cz}`;
/** That task on the board (its detail goes on with the prose after a space). */
export const signTask = (v: Village, layout: number, s: { cx: number; cz: number }) => v.tasks.find((t) => t.detail.startsWith(`${signCall(layout, s)} `));
/**
 * How many tries a sign task gets in all: one failed for a passing reason (a stall, a short craft, data get) goes back on
 * the board until then (S.4's review: four tries of passing failures let completion go without the sign).
 */
export const SIGN_TRIES = 10;
/**
 * The signs completion waits for (S.4): each sign not recorded up whose own task is on the board and has not failed for
 * good (a sign that failed all SIGN_TRIES is never waited on: completion would be held for good), nor can never go up
 * there (`never`: no wall, the cell taken). Layouts marked `signed` (all up, or a village from before S.4, one task for
 * every sign) are skipped.
 */
export function signsMissing(v: Village): string[] {
  const out: string[] = [];
  (v.layouts ?? []).forEach((l, i) => {
    if (l.signed) return;
    for (const s of l.signs ?? []) {
      const t = s.up || s.never ? undefined : signTask(v, i + 1, s);
      if (t && (t.status !== 'failed' || t.tries < SIGN_TRIES)) out.push(`${t.title.replace(/^Put up the sign: /, '')} (${t.id} ${t.status})`);
    }
  });
  return out;
}
/**
 * collect's answer when the only candidates left are the ones other gatherers are on their way to (S.1): not "none here",
 * so the task goes back for later and nothing is marked unavailable (sand closed for good while others held the last of it).
 */
export const TAKEN_BY_OTHERS = /are being taken by other gatherers/;
/** How long a task handed back for that stays off the board (eleven workers took it and handed it back in turn). */
export const TAKEN_COOLDOWN_MS = 45000;
/** A task the village mine serves (S.2: the claim gate counts them against the mine's faces). */
export const MINE_TASK = /^collect block=(cobblestone|stone) count=\d+/;
/** collect's answer when every face of the mine stayed held by other miners (never the task's fault). */
export const MINE_BUSY = /the mine is busy/;
/** How long a worker that handed a mine task back as busy takes no other (unless a face comes free first). */
export const MINE_COOL_MS = 60000;
/**
 * The codes skills give failures that are other agents' work in the way (E.0; `action_failed` data.code, with
 * data.resource): 'busy' (the mine, "mine:<village>"; a farm or annex slot, "slot:<key>"), 'reserved' (ground another
 * agent has reserved, "ground:x1,z1") and 'taken' (what is left of a material held by other gatherers, "block:<name>").
 * Brains hand the task back on them, with no failure, loop-guard entry or give-up counted.
 */
export type ContentionCode = 'busy' | 'reserved' | 'taken';
export function contentionOf(e: { type: string; data?: Record<string, unknown> }): { code: ContentionCode; resource: string } | null {
  const code = e.type === 'action_failed' ? e.data?.code : undefined;
  return code === 'busy' || code === 'reserved' || code === 'taken' ? { code, resource: String(e.data?.resource ?? '') } : null;
}
/** How long a task handed back because its ground was reserved by another agent stays off the board (a reservation lasts minutes). */
export const RESERVED_COOL_MS = 60000;
/**
 * A farm slot (opportunistic farming, 10-08): a 5x7 field like the wheat's (a channel down the middle), free until a farm
 * of a kind is started on it (`laying` while that runs). `cells`: what grows there (crops, cane, stems); `fruit`: where a
 * stem's pumpkin or melon can grow; `from`: the sighting its first plants came from. `tries` and `lastTry`: failed starts
 * (a back-off); `bad`: sightings that failed, by kind.
 */
export type FarmSlot = FarmSpot & {
  kind?: string;
  laying?: boolean;
  planted?: number;
  cells?: Array<[number, number]>;
  fruit?: Array<[number, number]>;
  from?: [number, number, number];
  tries?: number;
  lastTry?: { at: number; kind: string; why: string };
  bad?: string[];
  harvests?: number;
  lastHarvest?: { at: number; ok: boolean; why?: string };
  /** On the annex (10-09): never a plant farm; `face` is its end facing the village, where a pen's gate goes. */
  annex?: boolean;
  face?: Side;
  /**
   * A pen (kind 'chicken' or 'cow', PEN_KINDS): its gate and the gate's facing, whether the ring stands, the animals
   * counted inside; pens v2 (10-09): eggs taken in all and when, the last breeding and the young born of it, the last
   * milking, and when each was last tried (a back-off).
   */
  pen?: { gate: [number, number]; facing: string; wood?: string; built?: boolean; animals?: number; at?: number;
    eggs?: number; eggsAt?: number; bredAt?: number; born?: number; milk?: number; milkAt?: number; workAt?: Record<string, number> };
};

/**
 * A 13x9 plot prepared beside the village's plot after completion (the annex, the works plot): `state` 'preparing' until
 * prepare_site finished it; `tries`, `lastTry`: failed preparations; `bad`: rectangles that failed (by "x1,z1").
 */
export type SidePlot = Area & {
  y: number;
  side: Side;
  state: 'preparing' | 'ready';
  tries?: number;
  lastTry?: { at: number; why: string };
  bad?: string[];
};

/**
 * The annex (10-09, the user's choice): a side plot with two slots for pens. `penTries`, `penLastTry`: failed pen starts,
 * a village's back-off.
 */
export type Annex = SidePlot & {
  penTries?: number;
  penLastTry?: { at: number; why: string };
  /** Failed pen starts by kind (pens v2: a cow pen's failures no longer hold the chickens back, the diff review's L1). */
  penBy?: Record<string, { tries: number; at: number; why: string }>;
  /** Where animals were sought in vain ("kind:x,z,time"; v1's "x,z,time" were chickens): sightings within 8 of one are
   *  passed over for an hour. */
  penBad?: string[];
};

/** A furnace on the works plot (S.9), written only after the server confirmed it: where, by whom and when (ms). */
export interface WorksFurnace { x: number; y: number; z: number; by: string; at: number }

/** The first time the village made an item (S.9's tech record): when, by whom, how, how many, and on which job. */
export interface TechEntry { at: number; by: string; how: 'craft' | 'smelt'; n: number; via: string }

/** B.4: a part's torch spots ("x,y,z"): confirmed by the server, never able to hold one, skipped (runs, chunk loaded); the last run. */
export interface LightRecord { done: string[]; never?: string[]; skips?: Record<string, number>; at: number; by: string }

export interface Village {
  name: string;
  objective: string;
  mayor?: string;
  complete?: boolean;
  /** Exploring once complete (opportunistic farming, 10-08): the ring points scouted (by index), and when it ended. */
  explore?: { visited: number[]; done?: boolean; last?: string };
  /** Cakes baked at the storage hut (pens v2, 10-09: milk, sugar, an egg and wheat). */
  cakes?: number;
  /** What the village has made, by item, the first time each (S.9; kept on the village, which always exists, lesson 103). */
  tech?: Record<string, TechEntry>;
  /** The torches put up in its buildings and its mine, by part ("light:<part>"'s part; B.4, kept on the village, lesson 103). */
  lights?: Record<string, LightRecord>;
  /** X.1: the furniture put up in its buildings, by part (the structure id; the same record as lights'). */
  decor?: Record<string, LightRecord>;
  /** X.1: the wood kind the workshop's catalogue makes wood goods in, pinned once (v.wood, else the most stocked logs then):
   *  a kind that flipped with each gathering trip orphaned the old kind's stock and targets (the critique's 2). */
  catalogWood?: string;
  plots: Plot[];
  structures: Structure[];
  designs: Record<string, Design>;
  tasks: Task[];
  reservations: Reservation[];
  log: string[];
  /** Shared storage (real Minecraft's village economy): chests and their contents as last seen. */
  storage?: { chests: StorageChest[]; updated: number };
  /** The storage hut laid out for the village (footprint and chest spots, in the order chests go down). */
  storageHut?: Area & { spots: Array<{ x: number; z: number }> };
  /**
   * The storage hut's table and furnace once they stand in its cells (S.5: placed before the hut is built, each written
   * only after the server confirmed it), by whom, when (ms) and on which job.
   */
  stations?: Partial<Record<StationName, { x: number; y: number; z: number; by: string; at: number; via?: string }>>;
  /** The wood kind the village gathers and builds in (the commonest near its first site; real Minecraft). */
  wood?: string;
  /**
   * Buildings (by their task label) built in another wood kind than the village's (F164, 10-08, the user's choice: whole
   * buildings): given when the storage covers a building's logs in that kind alone, and kept.
   */
  woodFor?: Record<string, string>;
  /** How its first plot is laid out: "street" (phase D, V2.3: a vanilla town centre, streets, houses facing them), else rows. */
  plan?: 'street';
  /** The biome its vanilla library came from (the street plan's town centre is that biome's, V2.3). */
  vanillaBiome?: string;
  /** Plots plan_layout has laid buildings out on (kept off by later site searches and layouts). */
  /** (`streets`: the street plan's streets, which prepare_site lays as dirt_path, V2.3.) */
  /** (`green`: the area a green village keeps free inside its ring street, V2.4) */
  /** (lamps: the street lamps' cells, `lit` once light_streets put them up; not structures: the plot covers them) */
  /** (signs: each building's name sign, each `up` once put_up_signs checked it on the server, S.4; `signed` once all are,
   * as before; not structures either) */
  layouts?: Array<Area & { buildings: string[]; streets?: Area[]; green?: Area; lamps?: Array<{ x: number; z: number }>; lit?: boolean; signs?: SignSpot[]; signed?: boolean;
    /** The plot prepared in parts (S.6): each part's rectangle and margins (prepare_site layout=N part=K, K from 1), and the
     *  one level for all of them, written by the first part to work it out; `seamsBad` while the last seam check failed. */
    parts?: PlotPart[]; y?: number; seamsBad?: boolean;
    /** The wheat field (10-08): `planted` cells confirmed sown; the hoe's materials and the seeds asked for again once each. */
    farm?: FarmSpot & { planted?: number; requeuedHoe?: boolean; requeuedSeeds?: boolean;
      /** Harvests (10-08, farming v2): how many, the bread baked in all, and the last one's time and outcome (a back-off). */
      harvests?: number; bread?: number; lastHarvest?: { at: number; ok: boolean; why?: string } };
    /** Farm slots kept free for whatever is found (opportunistic farming, 10-08): a kind once a farm is started there. */
    slots?: FarmSlot[];
    /** The annex beside this layout's plot (the first layout only). */
    annex?: Annex;
    /** The works plot beside the annex (S.9; the first layout only): its furnaces by k - 1 (null once found gone). */
    works?: SidePlot & { furnaces?: Array<WorksFurnace | null> };
    /** A neighbourhood laid out as the village grows (s30): its index among the growth layouts, from 1. */
    grow?: number;
    /** Why a neighbourhood laid out with a field has none (s30's food step: the biome, the grass, no room, too far). */
    farmWhy?: string }>;
  /**
   * The village's appetite (s30's food step, appetite.ts; kept on the village, lesson 103): each member's level and meals
   * by name; the food made, used other than eaten (seeds from melon slices, a start's carrots) and eaten, by item; the meals.
   */
  food?: { members: Record<string, Appetite>; made: Record<string, number>; eaten: Record<string, number>; meals: number; used?: Record<string, number> };
  /**
   * The village growing once complete (s30, grow.ts; kept on the village, lesson 103): the neighbourhood on the board
   * (`from`: its first task's id number; `builds`: its Build tasks; `members` and `before`: members and houses when it was
   * posted; `sig`/`changed`: its tasks' statuses and when they last changed, the stuck rule), those ended, failed layouts
   * in a row and the back-off (ms), chore failures in a row, "no site" answers, squares plan_layout refused (kept off by
   * the next survey), and why growth stopped. A past layout's `left`: tasks still open when it ended (lamps, signs).
   */
  growth?: {
    active?: { k: number; layout: number; from: number; at: number; by: string; plot: Area; houses: string[];
      builds: string[]; members: number; before: number; changed: number; sig: string; style?: string;
      /** X.2: a public work (the piece's design name), not a neighbourhood of houses. */
      project?: string };
    past: Array<{ k: number; layout: number; at: number; end: number; houses: number; built: number; failed: number;
      members: number; why?: 'built' | 'failed' | 'stuck'; left?: number; style?: string; project?: string }>;
    /** The next neighbourhood's style, decided by a vote (spec_vote1): kept until its layout is posted (the critique's
     *  H1: a failed lay-out does not vote again). style '' and vote 'none': no vote this time (growth as before). */
    next?: { style: string; vote: string };
    /** X.2: the next public work decided by a vote (a piece, or '' for "no new work"), kept until its layout is posted;
     *  pieces that failed as a project (never offered again); when the last "no new work" won. */
    work?: { piece: string; vote: string; at: number };
    projectBad?: string[];
    /** X.2: public works' own failures in a row and back-off (house growth's `fails`/`backoff` stay its own). */
    projectFails?: number; projectBackoff?: number;
    /** X.2: the largest pad a public work may still ask for, after a "no free NxN site" (N - 1; the land round the village
     *  fills up: X2q2's 26x26 found none after 10 layouts). */
    workRoom?: number;
    fails?: number; tries?: number; backoff?: number; noSite?: Array<{ at: number; by: string }>; bad?: Array<Area & { at: number }>; stop?: string };
  /** Buildings of the objective that did not fit on the site: they wait for a second site and plan_layout. */
  unplaced?: string[];
  /**
   * Initiatives (s35, spec runs/2026-10-18/s35/spec_initiatives_v2.md): small works a member starts on its own and others
   * help with, no vote: the kind, its design and spot, who started it, the crew (everyone who took a step), each step,
   * and how it ended. `initiativeN` numbers them.
   */
  initiatives?: Initiative[];
  initiativeN?: number;
  /** N.1 (MC_NEEDS show/on): each need's state, stepped every 30 s by the world (needs.ts NeedState). */
  needStates?: Record<string, import('./needs').NeedState>;
  /** The village's votes (spec_vote1), the last 20, written at the tally only (a vote under way is held in memory). */
  votes?: VoteRecord[];
  /** Items the mayor wants kept in stock besides the buildings' materials (add_need). */
  needs?: Record<string, number>;
  /**
   * What still has to be gathered (computed by the world, real Minecraft): the raw materials of the laid-out buildings
   * not built or being built yet and of `needs`, less the storage and what the village's agents carry.
   */
  needed?: { items: Record<string, number>; for: string[]; updated: number };
  /**
   * Materials a gatherer found none of within the village's range (sand only: without it the windows stay open). Code
   * posts no gather task for them again (F96: Shelf's sand tasks failed 12 times in 20 s).
   */
  unavailable?: string[];
  /**
   * Scouting (step 2.4): when code posted scout tasks (once per village, after the mayor's first site search found
   * nothing good), when code ran find_site again after they came back, and when that search ended (scouting is over).
   */
  scouted?: number;
  scoutRerun?: number;
  scoutDone?: number;
  /** The village mine (V.5). */
  mine?: Mine;
}

/** How far a village's mayor and its site searches may go from home. */
export const VILLAGE_RANGE = 96;
/** How far a farm slot's start (a chore once the village stands) may walk for its first plants, and exploring may go. */
export const FARM_TRIP_RANGE = 160;
/**
 * How far a new village may look before its first layout (step 2.4): its first site search and its scouts. Within 96
 * the spawn's own view (~128 blocks) already showed everything, so scouting there added nothing.
 */
export const SCOUT_RANGE = 256;

/** Where a village is: its first plot's centre, else its storage chest, else where the agent started (memory.origin). */
export function villageHome(v: Village | undefined, memory?: Record<string, unknown>): { x: number; z: number } | null {
  const p = v?.layouts?.[0] ?? v?.plots[0];
  if (p) return { x: Math.floor((p.x1 + p.x2) / 2), z: Math.floor((p.z1 + p.z2) / 2) };
  const c = v?.storage?.chests[0];
  if (c) return { x: c.x, z: c.z };
  const o = memory?.origin as { x?: unknown; z?: unknown } | undefined;
  return o && typeof o.x === 'number' && typeof o.z === 'number' ? { x: Math.floor(o.x), z: Math.floor(o.z) } : null;
}

const RESERVATION_MS = 3 * 60 * 1000;
/** Reservations a compact summary lists one by one; more are counted by agent (E.0). */
const RESERVATIONS_LISTED = 6;

export const overlaps = (a: Area, b: Area, margin = 0) =>
  a.x1 - margin <= b.x2 && a.x2 + margin >= b.x1 && a.z1 - margin <= b.z2 && a.z2 + margin >= b.z1;
export const areaText = (a: Area) => `x ${a.x1}..${a.x2}, z ${a.z1}..${a.z2}`;

/** Saving (E.0): written this long after the last change, and no later than SAVE_MAX_MS after the first unsaved one. */
const SAVE_QUIET_MS = 250, SAVE_MAX_MS = 1000;
/** Errors of a rename over a file another process holds open for a moment (Windows readers: check scripts, antivirus). */
const SAVE_RETRY = new Set(['EPERM', 'EBUSY', 'EACCES']);
/**
 * How often a village's board is refreshed with nothing written (what gatherers carry changes unsaved): refreshNeeds keeps
 * its own 3 s, so it runs every 3-4 s as when idle workers polled the board.
 */
const BOARD_REFRESH_MS = 1000;
/**
 * An idle agent looks for a task when the board's version has moved since it last looked, else at most this often (E.0:
 * cooldowns ending, the mine's faces and the budget change with no write; it looked 20 times a second before).
 */
export const CLAIM_LOOK_MS = 1000;

export class VillageRegistry {
  villages = new Map<string, Village>();
  private nextId = 1;
  /**
   * Bumped by every save() (note() saves too): every task, storage-record, needs and reservation change goes through one
   * of them (E.0). Idle agents look for a task again only when it moves (or after a short while: cooldowns and the mine's
   * faces change with time, not by a write).
   */
  private ver = 0;
  get version(): number {
    return this.ver;
  }
  /** The version each village's board was last refreshed at (refreshBoard), and when. */
  private refreshedAt = new Map<string, number>();
  private refreshedTime = new Map<string, number>();
  /** Saving: since when changes are unsaved (0: none), the pending write, a write under way, and the snapshots' order. */
  private dirtySince = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;
  /** Snapshots are numbered as taken (gen); `committed` is the newest renamed into place, so an older one never replaces it. */
  private gen = 0;
  private committed = 0;
  /** Set by a world that computes what a village still needs (real Minecraft); run by refreshBoard. */
  refreshNeeds?: (v: Village) => void;
  /** Set by a world that keeps state per claim (real Minecraft, S.1: the pickaxe supply's start, a build's drawn stock). */
  onClaim?: (v: Village, t: Task) => void;
  /**
   * Set by a world with a village mine (S.2): whether `t` may be claimed now (mine tasks no more than its faces allow);
   * by `by` when given, `cooled` being when `by` last handed a mine task back as busy (within MINE_COOL_MS).
   */
  claimLimit?: (v: Village, t: Task, by?: string, cooled?: number) => boolean;
  /** When each worker last handed a mine task back as busy, by "village|worker" (S.2; a claim of a mine task clears it). */
  private mineCool = new Map<string, number>();

  constructor(private file: string) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { nextId: number; villages: Village[] };
      this.nextId = data.nextId ?? 1;
      for (const v of data.villages ?? []) {
        if (v.mine) upgradeMine(v.mine);
        this.villages.set(v.name.toLowerCase(), v);
      }
    } catch {
      /* no villages yet */
    }
  }

  static forWorld(dir: string) {
    return new VillageRegistry(path.join(dir, 'villages.json'));
  }

  /**
   * Mark a change (E.0): the file is written SAVE_QUIET_MS after the last change and at most SAVE_MAX_MS after the first,
   * one write at a time (a change during a write is written after it). Was a 2.2 MB synchronous write on every claim, note
   * and reservation. A kill loses at most the last second of changes; a clean stop calls flushSync().
   */
  save() {
    this.ver++;
    if (!this.dirtySince) this.dirtySince = Date.now();
    if (!this.writing) this.arm();
  }

  private arm() {
    if (this.timer) clearTimeout(this.timer);
    const now = Date.now();
    this.timer = setTimeout(() => void this.writeNow(), Math.max(0, Math.min(now + SAVE_QUIET_MS, this.dirtySince + SAVE_MAX_MS) - now));
  }

  private serialise(): string {
    return JSON.stringify({ nextId: this.nextId, villages: [...this.villages.values()] }, null, 1);
  }

  /** Write a snapshot to its own temporary file, then rename it over the file (a reader never sees half a file). */
  private async writeNow() {
    this.timer = null;
    if (!this.dirtySince) return;
    this.dirtySince = 0;
    this.writing = true;
    const gen = ++this.gen;
    const data = this.serialise();
    const tmp = `${this.file}.tmp-${process.pid}-${gen}`;
    try {
      await fs.promises.writeFile(tmp, data);
      for (let i = 0; ; i++) {
        // (flushSync wrote a newer snapshot meanwhile)
        if (gen <= this.committed) {
          await fs.promises.rm(tmp, { force: true });
          break;
        }
        // (renamed on this thread, so it cannot cross flushSync's rename)
        const err = this.rename(tmp, data, i >= 4);
        if (!err) {
          this.committed = gen;
          break;
        }
        await new Promise((r) => setTimeout(r, 50 * 2 ** i));
      }
    } catch (e) {
      console.error(`[villages] saving ${this.file} failed: ${(e as Error).message}; trying again`);
      // (each retry writes a new temporary file: never leave one behind)
      await fs.promises.rm(tmp, { force: true }).catch(() => {});
      this.dirtySince ||= Date.now();
    } finally {
      this.writing = false;
      if (this.dirtySince) this.arm();
    }
  }

  /**
   * Rename `tmp` over the file; true when a reader held it (try again). `last`: write the file in place instead, and give up
   * the temporary file. Other errors throw.
   */
  private rename(tmp: string, data: string, last: boolean): boolean {
    try {
      fs.renameSync(tmp, this.file);
      return false;
    } catch (e) {
      if (!SAVE_RETRY.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
      if (!last) return true;
      fs.writeFileSync(this.file, data);
      fs.rmSync(tmp, { force: true });
      console.log(`[villages] ${this.file} was held open by another process: written in place`);
      return false;
    }
  }

  /** Write any change now, synchronously (shutdown, the flush endpoint): also what a write under way was about to write. */
  flushSync() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirtySince && !this.writing) return;
    this.dirtySince = 0;
    const gen = ++this.gen;
    const data = this.serialise();
    const tmp = `${this.file}.tmp-${process.pid}-${gen}`;
    try {
      fs.writeFileSync(tmp, data);
      for (let i = 0; this.rename(tmp, data, i >= 4); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * 2 ** i);
      this.committed = gen;
    } catch (e) {
      console.error(`[villages] flushing ${this.file} failed: ${(e as Error).message}`);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {}
      this.dirtySince ||= Date.now();
      this.arm();
    }
  }

  id(prefix: string) {
    return `${prefix}${this.nextId++}`;
  }

  get(name: unknown): Village | undefined {
    return typeof name === 'string' ? this.villages.get(name.toLowerCase()) : undefined;
  }

  ensure(name: string, objective = ''): Village {
    let v = this.get(name);
    if (!v) {
      v = { name, objective, plots: [], structures: [], designs: {}, tasks: [], reservations: [], log: [] };
      this.villages.set(name.toLowerCase(), v);
    } else if (objective) v.objective = objective;
    this.save();
    return v;
  }

  note(v: Village, text: string) {
    v.log.push(text);
    if (v.log.length > 40) v.log.splice(0, v.log.length - 40);
    this.save();
  }

  /**
   * The village made `item` (S.9's tech record): written the first time only, so a village's saves stay bounded (later
   * crafts and smelts of it change nothing); `via` cut to 60 characters.
   */
  firstMade(v: Village, item: string, e: TechEntry): void {
    if (v.tech?.[item]) return;
    const via = e.via.length > 60 ? e.via.slice(0, 60) : e.via;
    (v.tech ??= {})[item] = { ...e, via };
    this.save();
    console.log(`[tech] ${v.name}: first ${item} (${e.how} ${e.n}) by ${e.by} via ${via}`);
  }

  /**
   * Why `area` cannot be used by `by` (an existing structure, or ground someone else reserved), or null if it can.
   * `ignore` lets structures through (storage chests a storage hut is built around).
   */
  conflict(v: Village, area: Area, by: string, avoidStructures = true, ignore?: (s: Structure) => boolean): string | null {
    return this.conflictOf(v, area, by, avoidStructures, ignore)?.why ?? null;
  }

  /** The same, with what is in the way: a building (for good) or another agent's reservation (for a while: contention, E.0). */
  conflictOf(v: Village, area: Area, by: string, avoidStructures = true, ignore?: (s: Structure) => boolean): { why: string; kind: 'structure' | 'reserved'; area: Area } | null {
    const now = Date.now();
    v.reservations = v.reservations.filter((r) => r.until > now);
    if (avoidStructures)
      for (const s of v.structures) if (overlaps(area, s) && !ignore?.(s)) return { why: `it overlaps ${s.builtBy}'s ${s.kind} (${areaText(s)})`, kind: 'structure', area: s };
    for (const r of v.reservations)
      if (r.by !== by && overlaps(area, r)) return { why: `${r.by} has reserved ${areaText(r)} to ${r.purpose}`, kind: 'reserved', area: r };
    return null;
  }

  reserve(v: Village, area: Area, by: string, purpose: string): Reservation {
    const r: Reservation = { ...area, id: this.id('r'), by, purpose, until: Date.now() + RESERVATION_MS };
    v.reservations.push(r);
    this.save();
    return r;
  }

  /** Keep a reservation alive while work continues (without writing the file every tick). */
  renew(r: Reservation) {
    r.until = Date.now() + RESERVATION_MS;
  }

  release(v: Village, id: string) {
    v.reservations = v.reservations.filter((r) => r.id !== id);
    this.save();
  }

  // --- Task board -----------------------------------------------------------------------------

  task(v: Village, id: unknown): Task | undefined {
    return v.tasks.find((t) => t.id === id);
  }

  /**
   * Whether the storage already covers a gather task ("collect block=X count=N, then deposit"): it holds as much of X as
   * every gather task for the buildings not yet built asks for, done ones included (what they brought is in the storage
   * too). Log tasks are summed together ("logs" from a short build's requeue, "oak_log" from the layout: summed per name,
   * the same logs passed both, the review of R.2). Built once per call; returns why it is covered, or null. `write`: move
   * buildings between wood kinds as below (refreshBoard only); without it the kinds are read as they are.
   */
  private stockCovers(v: Village, write = false): (t: Task) => string | null {
    const chests = v.storage?.chests ?? [];
    if (!chests.length) return () => null;
    const isLog = (item: string) => item === 'logs' || /_log$/.test(item);
    const stock = (item: string) => chests.reduce((s, c) => s + Object.entries(c.items)
      .filter(([n]) => (item === 'logs' ? /_log$/.test(n) : n === item)).reduce((t, [, q]) => t + q, 0), 0);
    // A gather task still waiting for part of the plot to be prepared (S.6: the houses' logs, behind the rest of the plot,
    // whose felled trees will cover them) is neither counted nor judged until that part is done: the huts' log tasks are
    // judged on the huts' ground's logs alone, ahead of the houses' (the houses' are judged with every building still
    // unbuilt once they can be claimed, so nothing the huts count on is promised twice, lesson 96)
    const preparing = new Set(v.tasks.filter((t) => /^Prepare /.test(t.title) && t.status !== 'done').map((t) => t.id));
    const gather = (t: Task) => {
      const m = /^collect block=(\S+) count=(\d+), then deposit/.exec(t.detail);
      const label = / for (.+?)( \(\d+\/\d+\))?$/.exec(t.title)?.[1];
      if (preparing.size && t.after.some((id) => preparing.has(id))) return null;
      return m && label ? { item: m[1], n: Number(m[2]), label } : null;
    };
    // (not a neighbourhood's failed house, s30: its gathering, closed once the neighbourhood is over, would stay wanted for
    // every later one, the check's L5)
    const unbuilt = new Set(v.tasks.filter((t) => /^Build /.test(t.title) && t.status !== 'done' && !(t.status === 'failed' && t.postedBy === 'grow')).map((t) => t.title.slice(6)));
    // The windows made once (S.3): their sand counts as an unbuilt building's until the pane task is done (its own sand
    // task was never closed as covered otherwise), and so does the log that fuels the smelting (6 a log, from storage;
    // gathered on the first house with windows, and still reserved here once that house is built)
    const windows = windowsMaking(v);
    if (windows) unbuilt.add(WINDOWS);
    const windowLogs = windows ? Math.ceil(v.tasks.reduce((s, t) => s + (gather(t)?.label === WINDOWS ? gather(t)!.n : 0), 0) / 6) : 0;
    // The street lamps' wood (a log a lamp, fences and charcoal for the torches, rounded up): they go up while builds still
    // draw on the storage (#4, S.4), so the logs covered for the builds leave it; and the name signs' (6 planks and a stick
    // make 3, about 2 logs), less the signs storage holds. Open or held (S.4: held while houses still draw; counted twice
    // for a while after the holder's withdraw, only conservative), but only open ones where buildings are moved between
    // wood kinds below: a holder's drawn logs counted twice there would make the kind look short and move an open house
    // to another and back (lesson 96, the check of S.4)
    const live = (open: boolean, t?: Task) => t?.status === 'open' || (!open && t?.status === 'claimed');
    const lampsOf = (open: boolean) => (v.layouts ?? []).reduce((s, l, i) => s + (l.lamps?.length && !l.lit && v.tasks.some((t) => live(open, t) && t.detail.startsWith(`light_streets layout=${i + 1} `)) ? l.lamps.length : 0), 0);
    // (a desert lamp's post is two cut sandstone, from the sandstone the desert houses are built of: that is reserved
    // instead, in batches of 4, and only the torches' wood, about a log for two, S.4's review)
    const desert = v.vanillaBiome === 'desert';
    const lampLogsOf = (open: boolean) => (desert ? Math.ceil(lampsOf(open) / 2) : lampsOf(open));
    const lampSandstone = desert ? Math.ceil((2 * lampsOf(false)) / 4) * 4 : 0;
    const storedSigns = chests.reduce((s, c) => s + Object.entries(c.items).filter(([n]) => /_sign$/.test(n)).reduce((q, [, k]) => q + k, 0), 0);
    // (a job each: every one-building job crafts its own three and puts the spares back only at its end, so jobs running
    // at once draw about 2 logs each, S.4's review)
    const signLogsOf = (open: boolean) => {
      const n = (v.layouts ?? []).reduce((s, l, i) => s + (l.signs ?? []).filter((g) => !g.up && !g.never && !l.signed && live(open, signTask(v, i + 1, g))).length, 0);
      return 2 * Math.max(0, n - storedSigns);
    };
    const lampLogs = lampLogsOf(false) + signLogsOf(false), lampOpen = lampLogsOf(true) + signLogsOf(true);
    // The stations still owed by their own task (S.5): billed as their own consumer, not the hut's, so the hut's gathering
    // could be closed on the furnace's cobblestone or the table's log
    const stations = stationsWanted(v);
    const wanted = new Map<string, number>(lampLogs + windowLogs + stations.logs ? [['logs', lampLogs + windowLogs + stations.logs]] : []);
    if (lampSandstone) wanted.set('sandstone', lampSandstone);
    // The pickaxe supply's cobblestone (3 a pickaxe), while open or held: its own gathering lands in the same chests, and a
    // house's cobblestone task closed against it came up short later (S.1). Held too, unlike the lamps: between the claim
    // and the withdraw the chests still hold it (counted twice after the withdraw, for half a minute: only conservative)
    const supply = v.tasks.find((t) => PICK_SUPPLY.test(t.title) && (t.status === 'open' || t.status === 'claimed'));
    if (supply) wanted.set('cobblestone', 3 * Number(PICK_SUPPLY.exec(supply.title)![1]));
    if (stations.cobblestone) wanted.set('cobblestone', (wanted.get('cobblestone') ?? 0) + stations.cobblestone);
    for (const t of v.tasks) {
      const g = gather(t);
      if (!g || !unbuilt.has(g.label)) continue;
      const k = isLog(g.item) ? 'logs' : g.item;
      wanted.set(k, (wanted.get(k) ?? 0) + g.n);
    }
    // With a village wood kind, logs are counted per kind (F164, the user's choice: whole buildings): each unbuilt
    // building is built in the village's kind unless `woodFor` gives it another, and a kind covers its buildings' log
    // tasks when the storage holds the logs of all of them together (the old rule, per kind: closing one never leaves
    // another short). While the village's kind falls short, buildings not yet started move, the latest posted first, to
    // another kind that holds their logs on top of its own buildings' (prepare_site's felled oak sat in birch villages'
    // storage while workers gathered birch: VanW2 9.6 min, 136 oak unused); a move that no longer covers is undone, and a
    // building under way is never moved (the design review)
    const logCover = new Map<string, string | null>();
    if (v.wood) {
      const wood = v.wood;
      const pools = new Map<string, number>();
      for (const c of chests)
        for (const [n, q] of Object.entries(c.items)) {
          const m = /^(?!stripped_)(\w+)_log$/.exec(n);
          if (m) pools.set(m[1], (pools.get(m[1]) ?? 0) + q);
        }
      const need = new Map<string, number>();
      for (const t of v.tasks) {
        const g = gather(t);
        if (g && unbuilt.has(g.label) && isLog(g.item)) need.set(g.label, (need.get(g.label) ?? 0) + g.n);
      }
      const builds = v.tasks.filter((t) => /^Build /.test(t.title) && t.status !== 'done' && need.get(t.title.slice(6)));
      const kindOf = (label: string) => v.woodFor?.[label] ?? wood;
      // (`held`: the lamps' and signs' logs while held too, for the cover itself; the moves count only open ones, above)
      const total = (k: string, held = false) => builds.filter((t) => kindOf(t.title.slice(6)) === k).reduce((s, t) => s + need.get(t.title.slice(6))!, 0) + (k === wood ? (held ? lampLogs : lampOpen) + windowLogs + stations.logs : 0);
      let changed = false;
      for (const t of write ? builds : []) {
        const label = t.title.slice(6), k = v.woodFor?.[label];
        // (not while any build is under way: its builder holds what it withdrew, and the pool looks short for a while:
        // VanW4's house 3 went back to birch while house 1's builder held the oak)
        if (k && k !== wood && !v.tasks.some((b) => /^Build /.test(b.title) && b.status === 'claimed') && (pools.get(k) ?? 0) < total(k)) {
          delete v.woodFor![label];
          changed = true;
          this.note(v, `${label} goes back to ${wood}: the storage no longer holds its logs in ${k}`);
        }
      }
      for (const t of write ? [...builds].reverse() : []) {
        if ((pools.get(wood) ?? 0) >= total(wood)) break;
        const label = t.title.slice(6), n = need.get(label)!;
        if (t.status === 'claimed' || kindOf(label) !== wood) continue;
        const k = [...pools].filter(([kind, q]) => kind !== wood && q >= total(kind) + n).sort((x, y) => y[1] - x[1])[0]?.[0];
        if (!k) continue;
        (v.woodFor ??= {})[label] = k;
        changed = true;
        this.note(v, `${label} will be built in ${k}: the storage holds its ${n} logs in ${k}, and too few ${wood} logs for every building`);
      }
      if (changed) this.save();
      for (const t of builds) {
        const label = t.title.slice(6), k = kindOf(label), have = pools.get(k) ?? 0, want = total(k, true);
        logCover.set(label, have >= want ? `the storage already holds enough ${k}_log (${have}, for ${want} logs wanted by the buildings still to build in ${k})` : null);
      }
    }
    const have = new Map<string, number>();
    return (t) => {
      const g = gather(t);
      if (!g || !unbuilt.has(g.label)) return null;
      if (v.wood && isLog(g.item)) return logCover.get(g.label) ?? null;
      const want = wanted.get(isLog(g.item) ? 'logs' : g.item) ?? 0;
      if (!have.has(g.item)) have.set(g.item, stock(g.item));
      const n = have.get(g.item)!;
      return n >= want ? `the storage already holds enough ${g.item} (${n}, for ${want} ${isLog(g.item) ? 'logs ' : ''}wanted by the buildings still to build)` : null;
    };
  }

  /**
   * Open gather tasks the storage already covers are marked done. prepare_site keeps the logs of the trees it fells: 287
   * jungle logs sat in the storage while four workers went on gathering jungle logs. So are a built building's own gather
   * tasks left open (handed back while its build ran, S.1: nothing else closed them, and completion waited for a trip).
   */
  private coveredByStock(v: Village, covers: (t: Task) => string | null) {
    let changed = false;
    const built = new Set(v.tasks.filter((t) => /^Build /.test(t.title) && t.status === 'done').map((t) => t.title.slice(6)));
    const unbuilt = new Set(v.tasks.filter((t) => /^Build /.test(t.title) && t.status !== 'done').map((t) => t.title.slice(6)));
    const windows = windowsMaking(v);
    const ofBuilt = (t: Task) => {
      const label = t.soft && /^collect block=\S+ count=\d+, then deposit/.test(t.detail) ? / for (.+?)( \(\d+\/\d+\))?$/.exec(t.title)?.[1] : undefined;
      // (the windows' sand once their pane task is over: S.3)
      if (label === WINDOWS && !windows) return "the windows' pane task is over";
      return label && built.has(label) && !unbuilt.has(label) ? `${label} is built` : null;
    };
    for (const t of v.tasks) {
      const why = t.status === 'open' ? covers(t) ?? ofBuilt(t) : null;
      if (!why) continue;
      t.status = 'done';
      t.result = why;
      t.updated = Date.now();
      this.note(v, `${t.id} "${t.title}" was not needed: ${why}`);
      changed = true;
    }
    if (changed) this.save();
  }

  /**
   * Everything the claim check used to do on its way (E.0; claimable() only reads now): the world's needs and their gather
   * tasks (refreshNeeds), buildings moved between wood kinds and gather tasks the storage covers closed (stockCovers,
   * coveredByStock), and the board's note of tasks that may start ahead of held gathering. Run by the world's tick
   * (tickBoard) and by claim(), so a claim is always judged on a fresh board.
   */
  refreshBoard(v: Village) {
    this.refreshNeeds?.(v);
    // (closing covered tasks changes no count: done tasks count in what is wanted, and the storage is untouched)
    this.coveredByStock(v, this.stockCovers(v, true));
    // Said once on the board when a task goes ahead of a held gather task (runs showed it only in BOARD lines)
    const ready = new Set(this.claimable(v));
    for (const t of v.tasks)
      if (ready.has(t) && !this.aheadNoted.has(t.id) && !t.afterClaimed) {
        const held = t.after.filter((id) => this.task(v, id)?.status === 'claimed');
        if (held.length) {
          this.aheadNoted.add(t.id);
          this.note(v, `${t.id} "${t.title}" may start: the storage covers what ${held.join(', ')} ${held.length > 1 ? 'are' : 'is'} still gathering`);
        }
      }
    this.refreshedAt.set(v.name, this.ver);
    this.refreshedTime.set(v.name, Date.now());
  }

  /** refreshBoard for the world's tick: when the board has changed since the last, or BOARD_REFRESH_MS have passed. */
  tickBoard(v: Village) {
    if (this.refreshedAt.get(v.name) === this.ver && Date.now() - (this.refreshedTime.get(v.name) ?? 0) < BOARD_REFRESH_MS) return;
    this.refreshBoard(v);
  }

  /**
   * Open tasks whose prerequisites are done (and whose designs have been drawn), and that the world's claim limit lets
   * through (S.2: the mine's faces); `by`: the worker asking, whose busy cooldown counts too. A pure read (E.0): the
   * board is kept up to date by refreshBoard.
   */
  claimable(v: Village, by?: string): Task[] {
    const covers = this.stockCovers(v);
    const finished = (id: string) => {
      const p = this.task(v, id);
      // A gather task still held counts as finished when the storage covers it: Hills1's testhut waited 3.3 min for a
      // 12-log task while the storage held enough (F97); the holder deposits what it brings, extra stock
      return p?.status === 'done' || (p?.status === 'failed' && !!p.soft) || (p?.status === 'claimed' && !!p.soft && !!covers(p));
    };
    const begun = (id: string) => { const p = this.task(v, id); return p?.status === 'claimed' && /^Build /.test(p.title); };
    const now = Date.now();
    const cooled = by ? this.cooledAt(v, by) : undefined;
    // (the claim limit last: it is asked only of tasks otherwise ready)
    const ready = v.tasks.filter((t) => t.status === 'open' && !((t.cooldown ?? 0) > now) && t.after.every((id) => finished(id) || (!!t.afterClaimed && begun(id))) && !this.missingDesigns(v, t).length
      && (!this.claimLimit || this.claimLimit(v, t, by, cooled)));
    // The village's parts, lamps and each built house's sign before gathering (S.4's review: in board order every ready
    // gather task for a later house went first, and the signs waited for the end of the run); builds and other work keep
    // their place ahead (a stable sort: board order within each)
    const rank = (t: Task) => (TAIL_TASK.test(t.detail) ? 1 : t.soft && /^collect block=\S+ count=\d+, then deposit/.test(t.detail) ? 2 : 0);
    return ready.sort((x, y) => rank(x) - rank(y));
  }
  private aheadNoted = new Set<string>();

  /**
   * Designs a building task names that are not in the library yet ('using the "cottage" design', 'build_design
   * meeting_hall'). Such a task waits until the design is drawn: claimed early, a worker finds no design and flounders.
   */
  missingDesigns(v: Village, t: Task): string[] {
    const text = `${t.title} ${t.detail}`;
    if (/^\s*design\b/i.test(t.title) || !/build/i.test(text) || !/design/i.test(text)) return [];
    const names = new Set<string>();
    for (const m of text.matchAll(/"([^"]{2,32})"/g)) names.add(m[1].trim().toLowerCase());
    // build_design cottage (a bare name), not build_design design=... (an argument name)
    for (const m of text.matchAll(/build_design\s+([a-z0-9_]+)\b(?!\s*=)/gi)) names.add(m[1].toLowerCase());
    const lib = Object.keys(v.designs);
    return [...names].filter((n) => /^[a-z0-9_ -]+$/.test(n) && !lib.includes(n) && !lib.includes(n.replace(/ /g, '_')) && !lib.includes(n.replace(/_/g, ' ')));
  }

  /** Post tasks; `after` may name existing task ids or earlier tasks in the same batch by 0-based index. */
  /** Post tasks (at most `max` at once: a guard against models flooding the board; code posting a layout lifts it). */
  post(v: Village, tasks: Array<{ title: string; detail?: string; after?: Array<string | number>; soft?: boolean; afterClaimed?: boolean; retries?: number }>, by: string, max = 8): Task[] {
    const made: Task[] = [];
    for (const t of tasks.slice(0, max)) {
      const after = (t.after ?? []).map((a) => (typeof a === 'number' ? made[a]?.id : String(a))).filter((id): id is string => !!id && !!(this.task(v, id) ?? made.find((m) => m.id === id)));
      const task: Task = { id: this.id('t'), title: String(t.title).slice(0, 120), detail: String(t.detail ?? '').slice(0, 400), status: 'open', postedBy: by, after, tries: 0, updated: Date.now(), ...(t.soft ? { soft: true } : {}), ...(t.afterClaimed ? { afterClaimed: true } : {}), ...(t.retries ? { retries: t.retries } : {}) };
      v.tasks.push(task);
      made.push(task);
    }
    this.note(v, `${by} posted ${made.map((t) => `${t.id} "${t.title}"`).join(', ')}`);
    return made;
  }

  claim(v: Village, id: string, by: string): Task | null {
    // (on a fresh board: whatever changed since the last refresh is acted on first, as the claim check did before E.0)
    if (this.refreshedAt.get(v.name) !== this.ver) this.refreshBoard(v);
    const t = this.task(v, id);
    if (!t || !(this.claimable(v, by).includes(t) || (t.status === 'claimed' && t.claimedBy === by))) return null;
    const fresh = t.status !== 'claimed';
    t.status = 'claimed';
    t.claimedBy = by;
    t.updated = Date.now();
    if (fresh) t.claimedAt = t.updated;
    if (fresh) this.onClaim?.(v, t);
    // (after onClaim: the world reads the cooldown it ends, S.2)
    if (MINE_TASK.test(t.detail)) this.mineCool.delete(`${v.name}|${by}`);
    this.save();
    return t;
  }

  /** When `by` handed a mine task back as busy, if within MINE_COOL_MS (S.2); else undefined. */
  cooledAt(v: Village, by: string): number | undefined {
    const k = `${v.name}|${by}`, at = this.mineCool.get(k);
    if (at === undefined || Date.now() - at < MINE_COOL_MS) return at;
    this.mineCool.delete(k);
    return undefined;
  }

  /**
   * A mine task handed back because every face of the mine stayed held (S.2): not the task's fault, so no try counted and
   * no cooldown on the task (another worker may take it if the claim limit allows); this worker takes no mine task for
   * MINE_COOL_MS, or until a face is free (the world's claim limit decides). Else it took the task back at once, 20 times a
   * second, and a scripted worker's give-up counted as finished and let its build start short of cobblestone.
   */
  handBackBusy(v: Village, id: string, by: string, why: string) {
    const t = this.task(v, id);
    if (!t || t.claimedBy !== by || t.status !== 'claimed') return;
    this.unclaim(v, id, by, why);
    this.mineCool.set(`${v.name}|${by}`, Date.now());
    console.log(`[mine] ${by} handed back ${id} "${t.title}": the mine is busy (no mine task for ${MINE_COOL_MS / 1000} s or until a face is free)`);
    this.save();
  }

  finish(v: Village, id: string, by: string, result: string) {
    const t = this.task(v, id);
    // (open is fine: the first deposit finishes the storage task whoever holds it; a failed or cancelled task stays so)
    if (!t || t.claimedBy !== by || t.status === 'done' || t.status === 'failed') return;
    t.status = 'done';
    t.result = result.slice(0, 300);
    t.updated = Date.now();
    this.note(v, `${by} finished ${t.id} "${t.title}"`);
  }

  /**
   * Put a claimed task back on the board without counting a try: handed back for a reason that is not the task's (the
   * mayor gathering while it waits must plan, the mine is busy), where giveUp would fail it the second time. `coolMs`: off
   * the board for that long (S.1: others hold what it needs, and the next idle worker would find the same).
   */
  unclaim(v: Village, id: string, by: string, why: string, coolMs = 0) {
    const t = this.task(v, id);
    if (!t || t.claimedBy !== by || t.status !== 'claimed') return;
    t.status = 'open';
    t.claimedBy = undefined;
    t.updated = Date.now();
    if (coolMs) t.cooldown = t.updated + coolMs;
    this.note(v, `${by} handed back ${t.id} "${t.title}": ${why.slice(0, 100)}`);
  }

  /**
   * A soft gather task handed back because others hold what is left of its material (S.1): off the board for a while, and
   * so is every other open task gathering the same block (a worker took the next sand task at once and found the same).
   */
  handBackTaken(v: Village, id: string, by: string, why: string, block: string) {
    this.unclaim(v, id, by, why, TAKEN_COOLDOWN_MS);
    const until = Date.now() + TAKEN_COOLDOWN_MS;
    const same = new RegExp(`^collect block=${block.toLowerCase().replace(/^minecraft:/, '')} count=\\d+, then deposit`);
    for (const t of v.tasks) if (t.id !== id && t.status === 'open' && t.soft && same.test(t.detail.toLowerCase())) t.cooldown = Math.max(t.cooldown ?? 0, until);
    this.save();
  }

  /**
   * Give a claimed task back; the second time (or its `retries`th) it is marked failed so the mayor can rethink it. A task
   * with more tries goes off the board for 30 s between them (S.4's signs: the idle worker that gave it up would take it
   * again at once). (That cooldown is not S.1's "handed back as taken", which noneToGather reads: only collect tasks get that)
   */
  giveUp(v: Village, id: string, by: string, why: string) {
    const t = this.task(v, id);
    if (!t || t.claimedBy !== by || t.status !== 'claimed') return;
    t.tries++;
    t.status = t.tries >= (t.retries ?? 2) ? 'failed' : 'open';
    t.claimedBy = t.status === 'failed' ? by : undefined;
    t.result = why.slice(0, 300);
    t.updated = Date.now();
    if (t.retries && t.status === 'open') t.cooldown = t.updated + 30000;
    this.note(v, `${by} gave up ${t.id} "${t.title}"${t.status === 'failed' ? ' (failed)' : t.retries ? ` (back on the board, try ${t.tries + 1} of ${t.retries})` : ''}: ${why.slice(0, 100)}`);
  }

  /** Mark a claimed task failed at once (its work cannot be done here). */
  fail(v: Village, id: string, by: string, why: string) {
    const t = this.task(v, id);
    if (!t || t.claimedBy !== by || t.status !== 'claimed') return;
    t.status = 'failed';
    t.result = why.slice(0, 300);
    t.updated = Date.now();
    this.note(v, `${by} could not do ${t.id} "${t.title}": ${why.slice(0, 100)}`);
  }

  /**
   * A soft gather task whose collect found none of its material (left) near the village fails at once (F96). When it was
   * sand and none at all, every other open sand task fails too (the next gatherer would search the same ground) and sand
   * is recorded as unavailable, so code does not post it again until the next layout. Not other materials: a collect
   * also says "none" while every candidate is marked out of reach for a while, and only glass has a fallback.
   */
  noneToGather(v: Village, id: string, by: string, item: string, why: string, none: boolean) {
    const held = this.task(v, id);
    if (!held || held.claimedBy !== by || held.status !== 'claimed') return;
    this.fail(v, id, by, why);
    const block = item.toLowerCase().replace(/^minecraft:/, '');
    // Only sand found nowhere: "none" also comes when every candidate is marked out of reach for a while (shared by all
    // bots), and closing log tasks would release their builds early (the review of R.1). Nor a task once handed back as
    // taken (S.1): the "none" may be others having taken the last of it, with what the buildings need in storage
    if (!none || held.cooldown || !/^(red_)?sand$/.test(block)) return this.save();
    const others = v.tasks.filter((t) => t.status === 'open' && t.soft && new RegExp(`^collect block=${block} count=\\d+, then deposit`).test(t.detail));
    for (const t of others) {
      t.status = 'failed';
      t.result = `not to be had: ${by} found none near the village (${held.id})`;
      t.updated = Date.now();
    }
    if (others.length) this.note(v, `${others.map((t) => t.id).join(', ')} closed: no more ${block} near the village`);
    if (!v.unavailable?.includes(block)) {
      v.unavailable = [...(v.unavailable ?? []), block];
      this.note(v, `no ${block} near the village: buildings go without glass (windows open)`);
    }
    this.save();
  }

  /** Close every task that is not finished (the objective is met, or the mayor is starting over). */
  cancelOpen(v: Village, why: string) {
    for (const t of v.tasks)
      if (t.status === 'open' || t.status === 'claimed') {
        t.status = 'failed';
        t.result = `cancelled: ${why}`;
        t.updated = Date.now();
      }
    this.save();
  }

  /**
   * A compact description for prompts. `compact` (workers' prompts on local models with an 8k context: Hutvale4's
   * executor prompts reached 8,391 tokens with 41 tasks, per-chest storage and the needs and mine lines): the agent's own
   * task in full, at most 10 other open tasks by title, no finished ones, designs by name, no chests as buildings.
   */
  summary(v: Village, forAgent?: string, compact = false, near?: { x: number; z: number }): string {
    const lines = [`Village ${v.name}${v.objective ? `, objective: ${v.objective}` : ''}${v.complete ? ' (declared complete)' : ''}`];
    const nb = growing(v) ? v.growth!.active! : undefined;
    if (nb) {
      const built = nb.builds.filter((id) => this.task(v, id)?.status === 'done').length;
      lines.push(`Growing: neighbourhood ${nb.k}, ${nb.builds.length} houses at ${areaText(nb.plot)} (built ${built} of ${nb.builds.length}); houses ${housesOf(v)} for ${nb.members} members`);
    }
    if (v.wood) lines.push(`Wood: the village gathers and builds in ${v.wood} (designs in other woods are built in it)`);
    // (not the annex or the works plot: they are for the pens, 10-09, and the workshop's furnaces, S.9; nor a green, the
    // initiatives' small works, s36)
    const plots = v.plots.filter((p) => !p.annex && !p.works && !p.green);
    // (a plot prepared in parts, S.6: how many are done; lessons 32 and 57)
    const partsOf = (p: Plot) => (v.layouts ?? []).find((l) => l.x1 === p.x1 && l.z1 === p.z1 && l.x2 === p.x2 && l.z2 === p.z2)?.parts?.length;
    if (plots.length) lines.push('Prepared plots (level ground; build inside them):', ...plots.map((p) => `- ${p.id}: ${areaText(p)}, ground y=${p.y}, by ${p.preparedBy}${p.parts ? ` (parts ${p.parts.length} of ${partsOf(p) ?? '?'} prepared)` : ''}`));
    const built = compact ? v.structures.filter((s) => s.kind !== 'storage') : v.structures;
    if (built.length) lines.push('Buildings (do not overlap them):', ...built.map((s) => `- ${s.kind} at ${areaText(s)}${compact ? '' : ` by ${s.builtBy}`}`));
    if (v.unplaced?.length) lines.push(`Not laid out yet (no room on the first site; they need a second site, then plan_layout): ${v.unplaced.join(', ')}`);
    const designs = Object.values(v.designs);
    if (designs.length) lines.push(compact ? `Design library: ${designs.map((d) => `"${d.name}" ${d.width}x${d.depth}`).join(', ')}` : 'Design library (build with build_design):', ...(compact ? [] : designs.map((d) => `- "${d.name}": ${d.width}x${d.depth}, ${d.height} high, ${d.description}`)));
    if (v.tasks.length && compact) {
      const mine = v.tasks.filter((t) => t.status === 'claimed' && t.claimedBy === forAgent);
      const others = v.tasks.filter((t) => (t.status === 'open' || t.status === 'claimed') && !mine.includes(t));
      lines.push('Task board (open and held tasks):',
        ...mine.map((t) => `- ${t.id} [yours] ${t.title}: ${t.detail}`),
        ...others.slice(0, 10).map((t) => `- ${t.id} [${t.status}${t.claimedBy ? ` by ${t.claimedBy}` : ''}] ${t.title}`),
        ...(others.length > 10 ? [`- and ${others.length - 10} more`] : []));
    } else if (v.tasks.length) {
      const shown = [...v.tasks.filter((t) => t.status !== 'done'), ...v.tasks.filter((t) => t.status === 'done').slice(-6)];
      lines.push('Task board:', ...shown.map((t) => {
        const who = t.claimedBy ? ` by ${t.claimedBy}` : '';
        const missing = t.status === 'open' ? this.missingDesigns(v, t) : [];
        const after = (t.after.length && t.status === 'open' ? ` (after ${t.after.join(', ')})` : '') + (missing.length ? ` (waiting for the design ${missing.map((n) => `"${n}"`).join(', ')} to be drawn)` : '');
        const result = t.result && t.status !== 'open' ? ` -> ${t.result.slice(0, 120)}` : '';
        return `- ${t.id} [${t.status}${who}] ${t.title}${after}${t.status === 'done' ? '' : `: ${t.detail}`}${result}`;
      }));
    }
    // (v.needed as the board's last refresh left it: the world's tick refreshes it every few seconds, E.0)
    if ((!v.complete || !!nb) && v.needed && (v.needed.for.length || Object.keys(v.needs ?? {}).length)) {
      const items = Object.entries(v.needed.items).filter(([, q]) => q > 0).sort((x, y) => y[1] - x[1]);
      lines.push(items.length
        ? `Materials still to gather (for ${v.needed.for.join(', ') || 'the stock the mayor asked for'}, less the storage and what workers carry; code posts gathering for them): ${items.map(([n, q]) => `${q} ${n}`).join(', ')}`
        : 'Materials still to gather: none (the storage and the workers hold everything the unbuilt buildings need)');
    }
    if (v.mine) {
      const m = v.mine;
      const got = Object.entries(m.got).filter(([n, q]) => q > 0 && !n.startsWith('seen ')).map(([n, q]) => `${q} ${n}`).join(', ');
      const ores = Object.entries(m.got).filter(([n]) => n.startsWith('seen ')).map(([n, q]) => `${q} ${n.slice(5)}`).join(', ');
      lines.push(m.level !== undefined && !m.stopped
        ? `Mine: stairs ${m.steps} steps down to y=${m.level}${(m.down ?? []).map((d) => (d.level !== undefined ? ` and on to y=${d.level}` : '')).join('')}, ${m.dug} tunnel cells dug${(m.legs?.length ?? 0) > 1 ? ` in ${m.legs!.length} main tunnels` : ''}${got ? `; it gave ${got}` : ''}${ores && !compact ? `; ores seen in its walls: ${ores}` : ''}: collect cobblestone digs it further`
        : m.stopped ? `Mine: stopped (${m.stopped}) after ${m.steps} steps${m.dug ? ` and ${m.dug} tunnel cells` : ''}; cobblestone is gathered outside` : 'Mine: not dug yet (the mining hut and "Dig the village mine" come first)');
    }
    // (the hut's table and furnace once they stand, S.5: they come before the hut, and crafting and smelting happen there)
    const stations = STATION_NAMES.filter((n) => v.stations?.[n]).map((n) => (n === 'crafting_table' ? 'table' : n));
    const stationsText = v.storageHut && stations.length ? `; stations: ${stations.join(', ')}` : '';
    if (v.storage?.chests.length) {
      const where = v.storage.chests.map((c) => `${c.x},${c.y},${c.z}`).join('; ');
      lines.push(v.storageHut
        ? `Village storage, in the storage hut (deposit sorts each item into its material's chest; withdraw finds it): ${storageText(v)}${stationsText}`
        : `Village storage (deposit / withdraw; chest${v.storage.chests.length > 1 ? 's' : ''} at ${where}): ${storageText(v)}`);
    } else if (stationsText) lines.push(`Village storage: no chest yet${stationsText}`);
    // (the appetite, s30: only once it keeps one, and not in a worker's compact summary, lesson 32)
    if (appetiteOn(v) && !compact) {
      const by = (s: string) => Object.entries(v.food.members).filter(([, e]) => stateOf(e.level) === s).map(([n]) => n);
      const hungry = by('hungry'), peckish = by('peckish');
      lines.push(`Food: ${v.food.meals} meals eaten from storage${hungry.length ? `; hungry (only food work until fed): ${hungry.join(', ')}` : ''}${peckish.length ? `; peckish: ${peckish.join(', ')}` : ''}`);
    }
    if (v.log.length) lines.push('Recent village events:', ...v.log.slice(compact ? -3 : -6).map((l) => `- ${l.slice(0, compact ? 160 : 400)}`));
    const now = Date.now();
    const res = v.reservations.filter((r) => r.until > now && r.by !== forAgent);
    // Many at once (E.0, 25 agents), in a worker's compact summary: counted by agent, and the 3 nearest `near` listed (the
    // mayor's summary keeps every one)
    if (compact && res.length > RESERVATIONS_LISTED) {
      const by = new Map<string, number>();
      for (const r of res) by.set(r.by, (by.get(r.by) ?? 0) + 1);
      const d = (r: Reservation) => (near ? Math.hypot((r.x1 + r.x2) / 2 - near.x, (r.z1 + r.z2) / 2 - near.z) : 0);
      const nearest = near ? [...res].sort((x, y) => d(x) - d(y)).slice(0, 3) : res.slice(0, 3);
      lines.push(`Ground others are working on: ${res.length} areas (${[...by].map(([n, k]) => `${n} ${k}`).join(', ')}); ${near ? 'nearest' : 'first'} 3:`, ...nearest.map((r) => `- ${r.by}: ${areaText(r)} (${r.purpose})`));
    } else if (res.length) lines.push('Ground others are working on:', ...res.map((r) => `- ${r.by}: ${areaText(r)} (${r.purpose})`));
    return lines.join('\n');
  }
}

/**
 * What the village storage holds, for summaries and messages: chest by chest when the chests are sorted ("chest 1
 * (logs): 64 oak_log, 12 birch_log; chest 2 (cobblestone): 40 cobblestone"), else summed ("40 cobblestone, 12 oak_log").
 */
export function storageText(v: Village, max = 24): string {
  const total = (items: Record<string, number>) => Object.values(items).reduce((s, q) => s + q, 0);
  const chests = v.storage?.chests ?? [];
  const list = (items: Record<string, number>, n: number) => {
    const e = Object.entries(items).filter(([, q]) => q > 0).sort((x, y) => y[1] - x[1]);
    return e.length ? e.slice(0, n).map(([k, q]) => `${q} ${k}`).join(', ') + (e.length > n ? `, and ${e.length - n} more kinds` : '') : 'empty';
  };
  if (chests.some((c) => c.group) || v.storageHut)
    return chests.map((c, i) => `chest ${i + 1} (${c.group ?? (total(c.items) ? 'not sorted' : 'free')}): ${list(c.items, 8)}`).join('; ') || 'no chest yet';
  const sum: Record<string, number> = {};
  for (const c of chests) for (const [n, q] of Object.entries(c.items)) sum[n] = (sum[n] ?? 0) + q;
  return list(sum, max);
}

/** A building to lay out: its design name and footprint. */
export interface Footprint {
  name: string;
  width: number;
  depth: number;
}

export interface Layout {
  /** The plot to prepare (buildings, streets and a margin), and its centre and size for prepare_site. */
  plot: Area;
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Each building's footprint and its centre (x, z as build_design takes them), in build order. */
  /** (`rotate`: build_design's quarter turns in degrees, the street plan's; width and depth are then as turned.) */
  places: Array<Footprint & Area & { x: number; z: number; rotate?: number }>;
}

/**
 * Pack buildings into rows on one plot centred at (cx, cz), with `street` blocks between buildings and rows and a
 * margin round the edge; the column count that gives the squarest plot wins. Code does this, not the mayor: models
 * placed buildings overlapping or sticking out of the plot.
 */
export function layoutBuildings(cx: number, cz: number, items: Footprint[], street = 3, margin = 2): Layout {
  const sorted = [...items].sort((a, b) => b.width * b.depth - a.width * a.depth);
  let best: { rows: Footprint[][]; rowWidth: number[]; rowDepth: number[]; W: number; D: number; score: number } | null = null;
  for (let cols = 1; cols <= Math.max(1, sorted.length); cols++) {
    const rows: Footprint[][] = [];
    for (let i = 0; i < sorted.length; i += cols) rows.push(sorted.slice(i, i + cols));
    const rowWidth = rows.map((r) => r.reduce((s, f) => s + f.width, 0) + street * (r.length - 1));
    const rowDepth = rows.map((r) => Math.max(...r.map((f) => f.depth)));
    const W = Math.max(...rowWidth) + 2 * margin;
    const D = rowDepth.reduce((s, d) => s + d, 0) + street * (rows.length - 1) + 2 * margin;
    const score = Math.max(W, D) * 1000 + W * D;
    if (!best || score < best.score) best = { rows, rowWidth, rowDepth, W, D, score };
  }
  const { rows, rowWidth, rowDepth, W, D } = best!;
  const x0 = cx - Math.floor(W / 2), z0 = cz - Math.floor(D / 2);
  const inner = W - 2 * margin;
  const places: Layout['places'] = [];
  let z = z0 + margin;
  rows.forEach((row, i) => {
    // Rows are centred across the plot; each building is centred in its row's depth
    let x = x0 + margin + Math.floor((inner - rowWidth[i]) / 2);
    for (const f of row) {
      const z1 = z + Math.floor((rowDepth[i] - f.depth) / 2);
      const area = { x1: x, z1, x2: x + f.width - 1, z2: z1 + f.depth - 1 };
      places.push({ ...f, ...area, x: x + Math.floor(f.width / 2), z: z1 + Math.floor(f.depth / 2) });
      x += f.width + street;
    }
    z += rowDepth[i] + street;
  });
  return { plot: { x1: x0, z1: z0, x2: x0 + W - 1, z2: z0 + D - 1 }, x: cx, z: cz, width: W, depth: D, places };
}
