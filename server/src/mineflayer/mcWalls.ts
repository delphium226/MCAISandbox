/**
 * Survival (d) spec 5 (MC_WALLS, on; with monsters only): the village wall on the ground. walls.ts plans the ring; here
 * its segments are built (build_wall, a chore: fence on cobblestone charged to the builder, a fence gate on the ground,
 * torches on the fences), planned once growth is done (#203: mcWorld's wallVoteTick), the region grows with the village (a new neighbourhood past the ring adds a rectangle; the
 * ring's cells now inside are taken down), and the gates are kept shut: walks open a wall gate (botAgent's hook makes
 * it "openable" to the pathfinder), and the gatekeeper closes each open one once no player stands within 2.5 blocks
 * (zombies do not open gates; an open one lets them in).
 */
import { Vec3 } from 'vec3';
import type { BotAgent } from './botAgent';
import type { Village } from '../village';
import { rawSetting } from '../settings';
import { modeSpec } from '../worldMode';
import { WALL_MARGIN, growRegion, hull, inRegion, orderRing, ringCells, ringRuns, segBill, straightAxis, wallPlan, growBox, type Box, type Cell, type CastleRecord, type WallRecord, type WallSeg } from '../walls';
import { DECK, castlePlan, partBill, streetCrossings, type CastlePart, type Column, type Top } from '../castleWall';
import { blockName, runJob, surfaceAt, type Target } from './mcBuild';
import { NATURAL } from './mcBlocks';
import { storageContents } from './mcStorage';
import { isDwelling } from '../grow';
import { isHostile, phaseOf } from './mcCombat';
import { checkAbort, goals, walk } from './mcUtil';

const flagOn = (name: string) => !/^(off|0|false|no)$/i.test(rawSetting(name) ?? 'on');
/** Spec 5: the wall, offered in a vote once the danger count asks for it (with monsters only). */
export const wallsOn = (): boolean => modeSpec().mobs && flagOn('MC_WALLS');
/** For staged tests: the wall planned as soon as the village is complete, without the trigger or the vote. */
/** Torches storage keeps for the lit grounds before the wall takes any. */
export const TORCH_RESERVE = 16;
/** At most one wall builder per 6 members at once (as the watch and the hunt): the wall's cobblestone and wood are the village's. */
export const wallCap = (members: number): number => Math.max(1, Math.floor(members / 6));
/** The wall vote's options. */
export const WALL_VOTE = 'wall:yes', WALL_NONE = 'wall:no';
export const WALLS_NOW = /^(on|1|true|yes)$/i.test(rawSetting('MC_WALLS_NOW') ?? 'off');
/** #217: the stone stage's vote option. */
export const CASTLE_VOTE = 'wall:towers';
/** #217 step 1: the wall's ballot shows the wall truly (its own frame, the stage and its bill, the benefit near home). */
export const wallBallotOn = (): boolean => wallsOn() && flagOn('MC_WALL_BALLOT');
/** #217 step 5: the watch walks the wall's towers and keeps inside the ring (#215). */
export const wallWatchOn = (): boolean => wallsOn() && flagOn('MC_WALL_WATCH');

const key = (x: number, z: number) => `${x},${z}`;

/** #217 step 2: the fence ring closes over water with stone dams (the user's Q5: no iron bars). */
export const wallWaterOn = (): boolean => wallsOn() && flagOn('MC_WALL_WATER');
/** The deepest water a dam is built in (deeper stays a gap, logged). */
export const DAM_MAX = 12;
/** Water and what grows in it: a dam's column replaces them. */
const WATERY = new Set(['water', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass', 'bubble_column']);
/** The bed under water whose surface is at `y`: the first block down that is not water (null: deeper than DAM_MAX, or lava). */
function bedOf(a: BotAgent, x: number, y: number, z: number): number | null {
  for (let yy = y; yy >= y - DAM_MAX; yy--) {
    const n = blockName(a, x, yy, z);
    if (n === null) return null;
    if (!WATERY.has(n)) return n === 'lava' ? null : yy;
  }
  return null;
}

/** The boxes the wall encloses: every layout (fields too) and structure of the village. */
export function wallBoxes(v: Pick<Village, 'layouts' | 'structures'>): Box[] {
  return [...(v.layouts ?? []), ...(v.structures ?? [])].map((b) => ({ x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2 }));
}

/** Other villages' work the ring keeps off (a cell inside one is a gap). */
function keepBoxes(all: Iterable<Village>, v: Village): Box[] {
  const out: Box[] = [];
  for (const o of all) if (o.name !== v.name) out.push(...wallBoxes(o).map((b) => growBox(b, 1)), ...o.plots.map((b) => growBox(b, 1)));
  return out;
}

/** A segment is done when every cell of it is built or a gap. */
export const segDone = (w: WallRecord, s: WallSeg): boolean => {
  const under = castleCells(w);
  return s.cells.every((c) => w.built[key(c.x, c.z)] || w.gaps?.includes(key(c.x, c.z)) || under.has(key(c.x, c.z)));
};

/** The wall's first plan: the hull of the village's boxes + WALL_MARGIN. */
export function startWall(v: Village, all: Iterable<Village>, vote?: string): WallRecord | null {
  const h = hull(wallBoxes(v));
  if (!h) return null;
  const rects = [growBox(h, WALL_MARGIN)];
  const p = wallPlan(rects, { keep: keepBoxes(all, v) });
  return { state: 'voted', at: Date.now(), ...(vote ? { vote } : {}), rects, segs: p.segs, built: {}, gaps: p.gaps.map((c) => key(c.x, c.z)) };
}

/**
 * Growth (spec 5): a box past the region adds a rectangle round it; the ring is planned again, cells already built stay
 * built, and those of the old ring now inside go to `down`. Returns a line for the log, or '' when nothing changed.
 */
export function regrowWall(v: Village, all: Iterable<Village>): string {
  const w = v.wall;
  if (!w || w.state !== 'voted') return '';
  // (#203: only homes extend it: a neighbourhood with a house, a house, or a work standing on the ring's own cells. Small
  // works, the bell tower and public works outside it stay outside: N2's ring, planned once growth was done, grew 434 ->
  // 568 cells round flower beds and the tower's pad, its built segments planned again; N3's 488 -> 716 round the public
  // works laid out after the houses)
  const ring = new Set(w.segs.flatMap((s) => s.cells.map((c) => key(c.x, c.z))));
  const onRing = (b: Box) => {
    for (let x = b.x1 - 1; x <= b.x2 + 1; x++) for (let z = b.z1 - 1; z <= b.z2 + 1; z++) if (ring.has(key(x, z))) return true;
    return false;
  };
  const grows = [...(v.layouts ?? []).filter((l) => l.buildings.some(isDwelling) || onRing(l)), ...(v.structures ?? []).filter((s) => isDwelling(s.kind) || onRing(s))].map((b) => ({ x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2 }));
  const rects = growRegion(w.rects, grows);
  if (rects.length === w.rects.length) return '';
  const p = wallPlan(rects, { keep: keepBoxes(all, v) });
  const added = rects.length - w.rects.length;
  w.rects = rects;
  w.segs = p.segs;
  w.gaps = p.gaps.map((c) => key(c.x, c.z));
  // (#217: stone stays where it stands, an inner wall once the village grows past it)
  const stone = castleCells(w);
  const down = Object.entries(w.built).filter(([k]) => !p.ring.has(k) && !stone.has(k));
  for (const [k, b] of down) {
    const [x, z] = k.split(',').map(Number);
    (w.down ??= []).push({ x, z, y: b.y, top: b.top });
    delete w.built[k];
  }
  // (a gate's axis may differ on the new ring: a built cell keeps what stands)
  for (const s of w.segs) for (const c of s.cells) {
    const b = w.built[key(c.x, c.z)];
    if (b) c.gate = b.gate;
  }
  return `the wall grows round ${added} new area${added === 1 ? '' : 's'}: ${w.segs.length} segments, ${down.length} cells of the old ring to take down`;
}

/** The ring's cells as boxes, for growth's survey to keep off (layout.ts keeps the ring free). */
export function wallTaken(v: Village): Box[] {
  const w = v.wall;
  if (!w || w.state !== 'voted') return [];
  const parts = (w.castle?.state === 'voted' ? w.castle.parts : []).flatMap((p) => p.cols.map((c) => ({ x: c.x, z: c.z })));
  return ringRuns([...w.segs.flatMap((s) => s.cells), ...parts]);
}

// ---- Gates ----------------------------------------------------------------------------------

/** Every built wall gate's cell, "x,y,z": botAgent's pathfinder hook opens these (a pen's gate stays a wall to walks). */
export const wallGates = new Set<string>();
export const isWallGate = (x: number, y: number, z: number): boolean => wallGates.has(`${x},${y},${z}`);
/** Rebuilds wallGates from the villages' records (at load and after a build). */
export function noteGates(villages: Iterable<Village>): void {
  wallGates.clear();
  for (const v of villages)
    for (const [k, b] of Object.entries(v.wall?.built ?? {})) {
      if (!b.gate) continue;
      const [x, z] = k.split(',').map(Number);
      wallGates.add(`${x},${b.y},${z}`);
    }
  for (const v of villages) for (const d of Object.values(v.wall?.castle?.done ?? {})) for (const g of d.gates) wallGates.add(g);
}

const gateFacing = (axis: 'x' | 'z') => (axis === 'x' ? 'south' : 'east');
export const gateStats = { closed: 0, seenOpen: 0, heldForLead: 0 };
/**
 * Members leading animals home (start_pen's hops). The gatekeeper leaves a gate open while one is within LEAD_HOLD of it:
 * in train 25 both cow restocks lost their cow at the ring (48 and 56 blocks from the pen), the gate shut behind the
 * member before the cow, 3-12 blocks back, came through.
 */
export const leading = new Set<string>();
export const LEAD_HOLD = 8;
const lastClose = new Map<string, number>();

/**
 * The gatekeeper (every second or so): each open wall gate some member can see, with no player within 2.5 blocks, is shut
 * by command (in its own wood and facing).
 */
export async function gateTick(agents: Iterable<BotAgent>, command: (c: string) => Promise<string>): Promise<void> {
  if (!wallGates.size) return;
  const bots = [...agents].filter((a) => a.bot?.entity);
  if (!bots.length) return;
  const now = Date.now();
  for (const g of wallGates) {
    const [x, y, z] = g.split(',').map(Number);
    const seer = bots.find((a) => a.bot.world.getColumn(x >> 4, z >> 4));
    const b = seer?.bot.blockAt(new Vec3(x, y, z));
    if (!b || !/_fence_gate$/.test(b.name)) continue;
    const p = b.getProperties() as Record<string, unknown>;
    if (!(p.open === true || p.open === 'true')) continue;
    gateStats.seenOpen++;
    const c = new Vec3(x + 0.5, y, z + 0.5);
    const near = bots.some((a) => a.bot.entity.position.distanceTo(c) < 2.5)
      || Object.values(seer!.bot.entities).some((e) => e.type === 'player' && e.position.distanceTo(c) < 2.5);
    if (near || now - (lastClose.get(g) ?? 0) < 1500) continue;
    if (bots.some((a) => leading.has(a.name) && a.bot.entity.position.distanceTo(c) < LEAD_HOLD)) {
      gateStats.heldForLead++;
      continue;
    }
    lastClose.set(g, now);
    gateStats.closed++;
    await command(`setblock ${x} ${y} ${z} minecraft:${b.name}[facing=${p.facing ?? 'south'},open=false]`).catch(() => '');
  }
}

// ---- Hostiles inside the ring (spec 5's pass mark) -----------------------------------------------

/** Per village: night samples of hostiles inside the ring (once a game minute), their sum and the most at once. */
export const inside = new Map<string, { samples: number; sum: number; peak: number; now: number; entered?: number; spawned?: number }>();
/** #217: each hostile's side of the ring when first seen (by village), and those counted as having come in. */
const sideOf = new Map<string, Map<number, 'in' | 'out' | 'came'>>();
export function insideTick(v: Village, agents: BotAgent[]): void {
  const w = v.wall;
  if (!w || w.state !== 'voted' || !agents.length) return;
  const t = agents.find((a) => typeof a.bot.time?.timeOfDay === 'number')?.bot.time.timeOfDay;
  const seen = new Set<number>();
  let n = 0;
  // (inside the ring: in the region and off its edge cells)
  const shrunk = w.rects.map((b) => growBox(b, -1));
  const homeY = v.storage?.chests[0]?.y;
  const r = inside.get(v.name) ?? { samples: 0, sum: 0, peak: 0, now: 0 };
  const sides = sideOf.get(v.name) ?? new Map<number, 'in' | 'out' | 'came'>();
  sideOf.set(v.name, sides);
  for (const a of agents)
    for (const e of Object.values(a.bot.entities)) {
      if (seen.has(e.id) || !isHostile(e.name)) continue;
      seen.add(e.id);
      // (#217: near home's height only, as the danger count's spawns inside: cave mobs under the village counted, step 0)
      if (homeY !== undefined && Math.abs(e.position.y - homeY) > 8) continue;
      const inRing = inRegion(shrunk, Math.floor(e.position.x), Math.floor(e.position.z));
      if (inRing) n++;
      // (first seen inside: spawned there or came in unseen; seen outside first and now in: came in, over or through)
      const was = sides.get(e.id);
      if (was === undefined) {
        sides.set(e.id, inRing ? 'in' : 'out');
        if (inRing) r.spawned = (r.spawned ?? 0) + 1;
      } else if (was === 'out' && inRing) {
        sides.set(e.id, 'came');
        r.entered = (r.entered ?? 0) + 1;
        console.log(`[wall] ${v.name}: a ${e.name} came inside the ring at ${Math.floor(e.position.x)},${Math.floor(e.position.y)},${Math.floor(e.position.z)}`);
      }
    }
  if (sides.size > 4000) for (const id of [...sides.keys()].slice(0, 2000)) sides.delete(id);
  r.now = n;
  if (phaseOf(t) === 'night') {
    r.samples++;
    r.sum += n;
    r.peak = Math.max(r.peak, n);
  }
  inside.set(v.name, r);
}

/** The `[wall]` line: segments and cells built, gates, hostiles inside at night. */
export function wallLine(v: Village): string {
  const w = v.wall!;
  const cells = w.segs.reduce((n, s) => n + s.cells.length, 0), built = Object.keys(w.built).length;
  const done = w.segs.filter((s) => segDone(w, s)).length;
  const gates = Object.values(w.built).filter((b) => b.gate).length;
  const r = inside.get(v.name);
  const mean = r && r.samples ? (r.sum / r.samples).toFixed(2) : '-';
  const water = Object.keys(w.water ?? {}).length;
  const c = w.castle;
  const castle = c ? `; castle ${c.state}: ${Object.keys(c.done).length} of ${c.parts.length} parts (${c.parts.filter((p) => p.kind === 'tower').length} towers, ${c.parts.filter((p) => p.kind === 'gatehouse').length} gatehouses), ${Object.keys(c.dropped ?? {}).length} dropped, stone placed ${castleStats.stone}` : '';
  return `[wall] ${v.name}: ${w.state}; ${done} of ${w.segs.length} segments done, ${built} of ${cells} cells built, ${gates} gates, ${w.gaps?.length ?? 0} gaps, ${water} dammed, ${w.down?.length ?? 0} to take down; gates shut ${gateStats.closed} (seen open ${gateStats.seenOpen}, held open for led animals ${gateStats.heldForLead}); hostiles inside the ring ${r?.now ?? 0} now, at night mean ${mean}, peak ${r?.peak ?? 0} (${r?.samples ?? 0} samples), entered ${r?.entered ?? 0}${castle}`;
}

// ---- The build ---------------------------------------------------------------------------------

/** A segment's bounding box. */
const segBox = (s: WallSeg): Box => hull(s.cells.map((c) => ({ x1: c.x, z1: c.z, x2: c.x, z2: c.z })))!;
/** What a cell may stand on and replace: air, plants and nature's own blocks (never anything built). */
const free = (n: string | null) => n !== null && (n === 'air' || n === 'cave_air' || n === 'short_grass' || n === 'tall_grass' || NATURAL.has(n));

/**
 * build_wall (a chore, not in TOOLS): one segment's cells not built yet. A wall cell is cobblestone from the ground up to
 * the highest ground beside it (inside or out, so nothing steps over it) and a fence on top, a torch on the fence where
 * planned: 2.5 blocks a zombie cannot jump. A gate cell is a closed fence gate on the ground with the ground on both sides
 * levelled to it (a walk opens a gate only on the level); where it cannot be, the cell is wall. Water and lava columns are
 * gaps. Charged to the builder (runJob takes the bill from storage and makes the fences, gates and torches there).
 */
export async function buildWall(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const w = v?.wall;
  const id = Math.floor(Number(args.seg));
  const s = w?.segs.find((x) => x.id === id);
  if (!v || !w || !s) throw new Error(`build_wall: no wall segment ${id}`);
  // (as the menu offered it: the village's goods wood, #203's N6)
  const wood = a.world.catalogWoodOf(v);
  const box = segBox(s);
  const mx = Math.floor((box.x1 + box.x2) / 2), mz = Math.floor((box.z1 + box.z2) / 2);
  const home = v.storage?.chests[0];
  const y0 = Math.floor(home?.y ?? a.bot.entity.position.y);
  // (near the segment first: its columns and their neighbours must be loaded to be read)
  if (Math.hypot(a.bot.entity.position.x - mx, a.bot.entity.position.z - mz) > 24)
    await walk(a, new goals.GoalNearXZ(mx, mz, 6), 'the wall segment', signal, 120000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
  checkAbort(signal);
  const ring = new Set(w.segs.flatMap((x) => x.cells.map((c) => key(c.x, c.z))));
  // (torches only when storage holds them: the wall stands without, and a job short of coal would fail whole)
  // (and TORCH_RESERVE over: the lit grounds' torches first, the first pair's wall took them and grounds lighting fell 190 -> 13)
  const torches = (storageContents(v).torch ?? 0) + a.bot.inventory.items().filter((it) => it.name === 'torch').reduce((n, it) => n + it.count, 0) >= s.cells.filter((c) => c.torch).length + TORCH_RESERVE;
  const ground = (x: number, z: number) => surfaceAt(a, x, z, y0);
  const offRing = (c: Cell) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: c.x + dx, z: c.z + dz })).filter((n) => !ring.has(key(n.x, n.z)));
  // A gate only on level ground: both sides' ground at the gate's own (a side a block higher stood half a block below the
  // closed gate's top, and a watcher walked onto it and stuck there 8 times, the first pair); else the cell is wall and the
  // gate moves to a level straight cell of the segment not built yet
  const level = (c: Cell): boolean => {
    const g = ground(c.x, c.z);
    return !!g && !g.liquid && offRing(c).every((n) => {
      const q = ground(n.x, n.z);
      return !!q && !q.liquid && q.y === g.y && [g.y + 1, g.y + 2].every((y) => free(blockName(a, n.x, y, n.z)));
    });
  };
  const hasGate = s.cells.some((c) => w.built[key(c.x, c.z)]?.gate);
  for (const c of s.cells) if (c.gate && !w.built[key(c.x, c.z)] && !level(c)) delete c.gate;
  if (!hasGate && !s.cells.some((c) => c.gate)) {
    const mid = Math.floor(s.cells.length / 2);
    const byMid = s.cells.map((c, i) => ({ c, i })).sort((p, q) => Math.abs(p.i - mid) - Math.abs(q.i - mid));
    for (const { c } of byMid) {
      const axis = straightAxis(ring, c.x, c.z);
      if (!w.built[key(c.x, c.z)] && axis && level(c)) {
        c.gate = axis;
        c.torch = false;
        break;
      }
    }
  }
  const targets: Target[] = [];
  const cells: Array<{ c: (typeof s.cells)[number]; y: number; top: number; gate?: 'x' | 'z'; t: Target[] }> = [];
  const skipped: string[] = [];
  const under = castleCells(w);
  for (const c of s.cells) {
    if (w.built[key(c.x, c.z)] || under.has(key(c.x, c.z))) continue;
    const g = ground(c.x, c.z);
    if (!g) {
      skipped.push(`${c.x},${c.z} not loaded`);
      continue;
    }
    // (#217 step 2, MC_WALL_WATER: water is dammed, a cobblestone column from the bed with the fence on it; lava and
    // water deeper than DAM_MAX stay gaps)
    const bed = g.liquid && Math.abs(g.y - y0) <= 24 && wallWaterOn() ? bedOf(a, c.x, g.y, c.z) : null;
    if ((g.liquid && bed === null) || Math.abs(g.y - y0) > 24) {
      (w.gaps ??= []).push(key(c.x, c.z));
      skipped.push(`${c.x},${c.z} ${g.liquid ? `${g.block}${wallWaterOn() && g.block === 'water' ? ' deeper than the dam' : ''}` : 'far below or above'}`);
      continue;
    }
    if (bed !== null) (w.water ??= {})[key(c.x, c.z)] = g.y - bed;
    // (the neighbours off the ring: inside and outside)
    const gs = offRing(c).map((n) => ({ n, g: ground(n.x, n.z) }));
    const M = Math.min(g.y + 2, Math.max(g.y, ...gs.map((q) => (q.g && !q.g.liquid ? q.g.y : g.y))));
    const t: Target[] = [];
    // (a dam is never a gate: a river's crossing is the gatehouse's, step 4)
    const gate = bed === null ? c.gate : undefined;
    if (gate) {
      // (plants cleared in the way through: both sides' two cells above the ground)
      for (const q of gs) for (const y of [g.y + 1, g.y + 2]) if (!/^(air|cave_air)$/.test(blockName(a, q.n.x, y, q.n.z) ?? 'air')) t.push({ x: q.n.x, y, z: q.n.z, block: 'air' });
      t.push({ x: c.x, y: g.y + 1, z: c.z, block: `${wood}_fence_gate[facing=${gateFacing(gate)},open=false]` });
      for (const y of [g.y + 2, g.y + 3]) if (blockName(a, c.x, y, c.z) !== 'air' && free(blockName(a, c.x, y, c.z))) t.push({ x: c.x, y, z: c.z, block: 'air' });
    } else {
      const cells2 = [];
      for (let y = (bed ?? g.y) + 1; y <= M + 1; y++) cells2.push(y);
      if (![...cells2, M + 2].every((y) => free(blockName(a, c.x, y, c.z)) || WATERY.has(blockName(a, c.x, y, c.z) ?? '') || blockName(a, c.x, y, c.z) === 'cobblestone' || /_fence$/.test(blockName(a, c.x, y, c.z) ?? ''))) {
        (w.gaps ??= []).push(key(c.x, c.z));
        skipped.push(`${c.x},${c.z} built on`);
        continue;
      }
      for (const y of cells2) t.push({ x: c.x, y, z: c.z, block: 'cobblestone' });
      t.push({ x: c.x, y: M + 2, z: c.z, block: `${wood}_fence` });
      if (c.torch && torches && free(blockName(a, c.x, M + 3, c.z))) t.push({ x: c.x, y: M + 3, z: c.z, block: 'torch' });
    }
    targets.push(...t);
    const top = Math.max(...t.filter((q) => q.x === c.x && q.z === c.z).map((q) => q.y));
    cells.push({ c, y: (bed ?? g.y) + 1, top, gate, t });
  }
  if (!targets.length) {
    a.world.villages.save();
    if (segDone(w, s)) return `the wall's segment ${id} stands${skipped.length ? ` (gaps: ${skipped.join('; ')})` : ''}`;
    throw new Error(`build_wall: nothing to build in segment ${id} (${skipped.join('; ') || 'no cells'})`);
  }
  // (no claim on the ground: a segment round a corner claimed its whole box, and two builders' boxes overlapped, 88
  // failures in the first pair; the ring's cells are the wall's alone, growth keeps 5 off them)
  const job = { targets, area: box, y: y0, what: 'the village wall' };
  let out = await runJob(a, job, signal);
  // (checked by the bot's view after a second, as light_streets: the first pair read 13 builds' cells as missing at once;
  // a fence or gate of any wood counts, as the build may swap the kind; what is missing is set once more)
  const stands = (t: Target) => {
    const name = blockName(a, t.x, t.y, t.z), want = t.block.replace(/\[.*$/, '');
    if (t.block === 'air') return name === 'air' || name === 'cave_air';
    return name === want || (/_fence(_gate)?$/.test(want) && !!name && name.replace(/^.*?_fence/, '_fence') === want.replace(/^.*?_fence/, '_fence'));
  };
  await new Promise((r) => setTimeout(r, 1000));
  const missing = targets.filter((t) => !stands(t));
  if (missing.length) {
    out += `; again: ${await runJob(a, { ...job, targets: missing }, signal).catch((e: Error) => e.message)}`;
    await new Promise((r) => setTimeout(r, 1000));
  }
  let n = 0, gates = 0;
  for (const q of cells) {
    if (!q.t.every(stands)) continue;
    n++;
    if (q.gate) gates++;
    w.built[key(q.c.x, q.c.z)] = { y: q.y, top: q.top, ...(q.gate ? { gate: q.gate } : {}) };
  }
  noteGates(a.world.villages.villages.values());
  a.world.villages.save();
  const left = s.cells.filter((c) => !w.built[key(c.x, c.z)] && !w.gaps?.includes(key(c.x, c.z)) && !under.has(key(c.x, c.z))).length;
  console.log(`[wall] ${a.name} ${v.name}: segment ${id}: ${n} cells built (${gates} gates), ${left} left${skipped.length ? `; skipped ${skipped.slice(0, 4).join('; ')}` : ''}`);
  if (left) throw new Error(`build_wall: segment ${id} has ${left} cells not standing after the build (${out.slice(0, 160)})`);
  return `built ${n} cells of the village wall's segment ${id} (${gates} gate${gates === 1 ? '' : 's'}): ${out}`;
}

/** take_down_wall (a chore): the old ring's cells now inside the region, cleared (their blocks are lost). */
export async function takeDownWall(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const w = v?.wall;
  if (!v || !w?.down?.length) throw new Error('take_down_wall: nothing to take down');
  const part = w.down.slice(0, 24);
  const targets: Target[] = [];
  for (const d of part) for (let y = d.top; y >= d.y; y--) targets.push({ x: d.x, y, z: d.z, block: 'air' });
  const box = hull(part.map((d) => ({ x1: d.x, z1: d.z, x2: d.x, z2: d.z })))!;
  const out = await runJob(a, { targets, area: box, y: part[0].y, free: true, what: 'the old wall' }, signal);
  w.down = w.down.slice(part.length);
  noteGates(a.world.villages.villages.values());
  a.world.villages.save();
  return `took down ${part.length} cells of the old wall: ${out}`;
}

/** The wall's skills (chores, not in TOOLS). */
export const WALL_SKILLS = {
  build_wall: { run: buildWall },
  take_down_wall: { run: takeDownWall },
  build_castle: { run: buildCastle },
};

/** A segment for a member: the first not done, not taken (`taken(id)`) and not backing off, nearest the member first. */
export function nextSeg(v: Village, a: BotAgent, taken: (id: number) => boolean, now = Date.now()): WallSeg | null {
  const w = v.wall;
  if (!w || w.state !== 'voted') return null;
  const p = a.bot.entity?.position;
  const open = w.segs.filter((s) => !segDone(w, s) && !taken(s.id) && (w.back?.[s.id] ?? 0) <= now);
  if (!open.length) return null;
  if (!p) return open[0];
  const d = (s: WallSeg) => Math.min(...s.cells.map((c) => Math.hypot(c.x - p.x, c.z - p.z)));
  return open.sort((x, y) => d(x) - d(y))[0];
}
export { segBill };
export type { Cell };

// ---- #217 step 4 (MC_CASTLE_WALL): towers and gatehouses on the ring ------------------------------------------------

/** The stone stage: towers and gatehouses on the fence ring (the user's Q3: curtain sections later, votes of their own). */
export const castleOn = (): boolean => wallsOn() && flagOn('MC_CASTLE_WALL');
/** The mine's stones the wall's bulk is laid in, a rubble of whatever storage holds (cobblestone for the plinth course). */
export const WALL_STONES = ['cobblestone', 'andesite', 'diorite', 'granite', 'cobbled_deepslate', 'tuff'];
/** Counts for the `[wall]` line and the report: stone placed by the castle's builds. */
export const castleStats = { stone: 0, parts: 0, failed: 0 };

const cellsCache = new WeakMap<CastleRecord, { n: number; set: Set<string> }>();
/** Ring cells under a castle part not dropped (voted parts only): the fence is not built there, the part stands in its place. */
export function castleCells(w: WallRecord): Set<string> {
  const c = w.castle;
  if (!c || c.state !== 'voted') return new Set();
  const n = c.parts.length * 100 + Object.keys(c.dropped ?? {}).length;
  const hit = cellsCache.get(c);
  if (hit && hit.n === n) return hit.set;
  const set = new Set(c.parts.filter((p) => !c.dropped?.[p.id]).flatMap((p) => p.ring));
  cellsCache.set(c, { n, set });
  return set;
}

/** Where streets and pad paths cross the ring, nearest home first; with none, the ring cell nearest home. */
export function crossingsOf(v: Village, ring: Set<string>): Cell[] {
  const streets = (v.layouts ?? []).flatMap((l) => l.streets ?? []).map((b) => ({ x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2 }));
  const out = streetCrossings(ring, streets);
  for (const l of v.layouts ?? []) for (const p of l.paths ?? []) for (const [x, z] of p.line ?? []) if (ring.has(key(x, z))) out.push({ x, z });
  const home = v.storage?.chests[0];
  if (!home) return out;
  const d = (c: Cell) => Math.hypot(c.x - home.x, c.z - home.z);
  if (!out.length) {
    const near = [...ring].map((k) => k.split(',').map(Number)).map(([x, z]) => ({ x, z })).sort((p, q) => d(p) - d(q))[0];
    if (near) out.push(near);
  }
  return out.sort((p, q) => d(p) - d(q));
}

/** The stone stage's plan for a voted ring: its towers and gatehouses (castleWall.ts), the curtain left for later. */
export function startCastle(v: Village, all: Iterable<Village>, vote?: string): CastleRecord | null {
  const w = v.wall;
  if (!w || w.state !== 'voted') return null;
  const order = orderRing(ringCells(w.rects));
  const ring = new Set(order.map((c) => key(c.x, c.z)));
  const p = castlePlan(order, w.rects, { crossings: crossingsOf(v, ring), keep: keepBoxes(all, v), avoid: wallBoxes(v).map((b) => growBox(b, 1)) });
  if (p.skipped.length) console.log(`[castle] ${v.name}: ${p.skipped.join('; ')}`);
  const parts = [...p.gatehouses, ...p.towers];
  if (!parts.length) return null;
  return { state: 'voted', at: Date.now(), ...(vote ? { vote } : {}), parts, done: {} };
}

/** The stone stage's bill on flat ground (the footing is read on the ground when built). */
export function castleBill(parts: CastlePart[]): { stone: number; stairs: number; gates: number; torches: number } {
  const out = { stone: 0, stairs: 0, gates: 0, torches: 0 };
  for (const p of parts) {
    const b = partBill(p);
    out.stone += b.stone + b.stairs;
    out.gates += b.gates;
    out.torches += b.torches;
  }
  return out;
}

/** A part's name for menus and logs: "the north-west tower", "the south gatehouse". */
export function partName(w: WallRecord, p: CastlePart): string {
  const h = hull(w.rects)!;
  const cx = (h.x1 + h.x2) / 2, cz = (h.z1 + h.z2) / 2, dx = p.at.x - cx, dz = p.at.z - cz;
  const ns = Math.abs(dz) > (h.z2 - h.z1) / 6 ? (dz < 0 ? 'north' : 'south') : '';
  const ew = Math.abs(dx) > (h.x2 - h.x1) / 6 ? (dx < 0 ? 'west' : 'east') : '';
  return `the ${[ns, ew].filter(Boolean).join('-') || 'middle'} ${p.kind === 'tower' ? 'tower' : 'gatehouse'} (${p.id})`;
}

/** The next part for a member: not built, dropped, taken or backing off; gatehouses first, then the nearest. */
export function nextPart(v: Village, a: BotAgent, taken: (id: string) => boolean, now = Date.now()): CastlePart | null {
  const c = v.wall?.castle;
  if (!c || c.state !== 'voted') return null;
  const open = c.parts.filter((p) => !c.done[p.id] && !c.dropped?.[p.id] && !taken(p.id) && (c.back?.[p.id] ?? 0) <= now);
  if (!open.length) return null;
  const pos = a.bot.entity?.position;
  const d = (p: CastlePart) => (pos ? Math.hypot(p.at.x - pos.x, p.at.z - pos.z) : 0);
  return open.sort((p, q) => (p.kind === q.kind ? 0 : p.kind === 'gatehouse' ? -1 : 1) || d(p) - d(q))[0];
}

/** Whether the stone stage is done: every part built or dropped. */
export const castleDone = (c: CastleRecord): boolean => c.parts.every((p) => c.done[p.id] || c.dropped?.[p.id]);

/** What a castle column may replace: nature, water, and the ring's own fence, stone and torches. */
const replaceable = (n: string | null) => n !== null && (free(n) || WATERY.has(n) || n === 'torch' || /_fence(_gate)?$/.test(n) || WALL_STONES.includes(n) || n === 'stone_bricks' || /_stairs$/.test(n));
const isAir = (n: string | null) => n === 'air' || n === 'cave_air';
/** A cheap position hash (the rubble pattern). */
const hash = (x: number, y: number, z: number) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0;

/**
 * build_castle (a chore, not in TOOLS): one tower or gatehouse of the stone stage. Its base is the median ground under its
 * solid columns (a ring cell already built reads its ground under the fence); every column is made solid from its own
 * ground (the bed, under water) to the deck, then its tops; the ring's fence and torches it stands on are replaced. The
 * bulk is laid in whatever mine stones storage holds (a rubble, cobblestone for the plinth course), merlons in stone
 * bricks when storage holds them, steps as blocks unless stairs are stored. A part whose ground rises more than 3 above
 * its base, or that stands on something built, or on water deeper than a dam, is dropped (logged). Charged to the builder.
 */
export async function buildCastle(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const w = v?.wall;
  const c = w?.castle;
  const p = c?.parts.find((x) => x.id === String(args.part));
  if (!v || !w || !c || !p) throw new Error(`build_castle: no part ${String(args.part)} of the wall`);
  const name = partName(w, p);
  if (c.done[p.id]) return `${name} stands`;
  const box = hull(p.cols.map((q) => ({ x1: q.x, z1: q.z, x2: q.x, z2: q.z })))!;
  const mx = Math.floor((box.x1 + box.x2) / 2), mz = Math.floor((box.z1 + box.z2) / 2);
  const home = v.storage?.chests[0];
  const y0 = Math.floor(home?.y ?? a.bot.entity.position.y);
  if (Math.hypot(a.bot.entity.position.x - mx, a.bot.entity.position.z - mz) > 16)
    await walk(a, new goals.GoalNearXZ(mx, mz, 6), name, signal, 120000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
  checkAbort(signal);
  const drop = (why: string) => {
    (c.dropped ??= {})[p.id] = why;
    a.world.villages.save();
    console.log(`[castle] ${a.name} ${v.name}: ${name} dropped: ${why}`);
    return `${name} cannot stand here (${why}): the fence ring keeps its place`;
  };
  // The ground under each column: a built ring cell's own (under its fence), else the surface (the bed under water)
  type G = { y: number; water: boolean };
  const grounds = new Map<string, G>();
  for (const q of p.cols) {
    const k = key(q.x, q.z), b = w.built[k];
    if (b) {
      grounds.set(k, { y: b.y - 1, water: (w.water?.[k] ?? -1) >= 0 });
      continue;
    }
    const g = surfaceAt(a, q.x, q.z, y0);
    if (!g) throw new Error(`build_castle: the ground at ${q.x},${q.z} is not loaded yet (walk closer to ${name})`);
    if (g.liquid) {
      const bed = g.block === 'water' ? bedOf(a, q.x, g.y, q.z) : null;
      if (bed === null) return drop(`${g.block} too deep at ${q.x},${q.z}`);
      grounds.set(k, { y: bed, water: true });
    } else grounds.set(k, { y: g.y, water: false });
  }
  const dry = p.cols.filter((q) => q.fill === DECK).map((q) => grounds.get(key(q.x, q.z))!).filter((g) => !g.water).map((g) => g.y).sort((x, y) => x - y);
  const B = dry.length ? dry[Math.floor(dry.length / 2)] : Math.max(...[...grounds.values()].map((g) => g.y));
  const high = Math.max(...p.cols.filter((q) => q.fill >= 0).map((q) => grounds.get(key(q.x, q.z))!.y));
  if (high - B > 3) return drop(`the ground rises ${high - B} above its base`);
  if (Math.abs(B - y0) > 24) return drop('far below or above the village');
  // Stock for the look
  const st = storageContents(v);
  const carried: Record<string, number> = {};
  for (const it of a.bot.inventory.items()) carried[it.name] = (carried[it.name] ?? 0) + it.count;
  const have = (n: string) => (st[n] ?? 0) + (carried[n] ?? 0);
  const tops = p.cols.flatMap((q) => q.tops);
  const merlons = tops.filter((t) => t.tok === 'merlon').length, steps = tops.filter((t) => t.tok === 'stairs').length;
  const torches = tops.filter((t) => t.tok === 'torch').length;
  const brick = have('stone_bricks') >= merlons;
  const stairs = have('cobblestone_stairs') >= steps;
  const lit = have('torch') >= torches + TORCH_RESERVE;
  const wood = a.world.catalogWoodOf(v);
  const targets: Target[] = [];
  const bulk: Target[] = [];
  const gates: string[] = [];
  const blocked: string[] = [];
  const put = (x: number, y: number, z: number, block: string, isBulk = false) => {
    const n = blockName(a, x, y, z);
    if (block === 'air') {
      if (isAir(n)) return;
      if (!replaceable(n)) blocked.push(`${n} at ${x},${y},${z}`);
      else targets.push({ x, y, z, block });
      return;
    }
    if (!replaceable(n) && n !== block) {
      blocked.push(`${n} at ${x},${y},${z}`);
      return;
    }
    const t = { x, y, z, block };
    targets.push(t);
    if (isBulk) bulk.push(t);
  };
  const facingOf = (t: Top) => t.facing ?? 'north';
  for (const q of p.cols) {
    const k = key(q.x, q.z), g = grounds.get(k)!;
    const set = new Set<number>();
    if (q.fill >= 0) for (let y = g.y + 1; y <= B + q.fill; y++) {
      put(q.x, y, q.z, 'cobblestone', true);
      set.add(y);
    }
    for (const t of q.tops) {
      const y = B + t.dy;
      set.add(y);
      if (t.tok === 'stone') put(q.x, y, q.z, 'cobblestone', true);
      else if (t.tok === 'merlon') put(q.x, y, q.z, brick ? 'stone_bricks' : 'cobblestone', !brick);
      else if (t.tok === 'stairs') put(q.x, y, q.z, stairs ? `cobblestone_stairs[facing=${facingOf(t)},half=bottom]` : 'cobblestone', !stairs);
      else if (t.tok === 'lip') put(q.x, y, q.z, `cobblestone_stairs[facing=${facingOf(t)},half=top]`);
      else if (t.tok === 'gate') {
        put(q.x, y, q.z, `${wood}_fence_gate[facing=${gateFacing(t.axis ?? 'x')},open=false]`);
        gates.push(`${q.x},${y},${q.z}`);
      } else if (t.tok === 'torch') {
        if (lit) put(q.x, y, q.z, 'torch');
      } else put(q.x, y, q.z, 'air');
    }
    // (the ring's fence and torch above what the part sets there go)
    const b = w.built[k];
    if (b) for (let y = b.y; y <= b.top; y++) if (!set.has(y) && y > B + q.fill) put(q.x, y, q.z, 'air');
  }
  if (blocked.length) return drop(`built on: ${blocked.slice(0, 3).join(', ')}`);
  // The rubble: the plinth course and footings in cobblestone, the rest shared among the stones storage holds by their stock
  const kinds = WALL_STONES.filter((n) => n !== 'cobblestone' && have(n) >= 16);
  const upper = bulk.filter((t) => t.y > B + 1).sort((p1, p2) => hash(p1.x, p1.y, p1.z) - hash(p2.x, p2.y, p2.z));
  const pool = kinds.reduce((n, k) => n + have(k), 0) + have('cobblestone');
  let i = 0;
  for (const k of kinds) {
    const share = pool ? Math.floor((upper.length * have(k)) / Math.max(pool, upper.length)) : 0;
    for (let j = 0; j < Math.min(share, have(k)) && i < upper.length; j++) upper[i++].block = k;
  }
  const job = { targets, area: box, y: B, what: name };
  let out = await runJob(a, job, signal);
  const stands = (t: Target) => {
    const n = blockName(a, t.x, t.y, t.z), want = t.block.replace(/\[.*$/, '');
    return t.block === 'air' ? isAir(n) : n === want || (/_fence_gate$/.test(want) && /_fence_gate$/.test(n ?? ''));
  };
  await new Promise((r) => setTimeout(r, 1000));
  let missing = targets.filter((t) => !stands(t));
  if (missing.length) {
    out += `; again: ${await runJob(a, { ...job, targets: missing }, signal).catch((e: Error) => e.message)}`;
    await new Promise((r) => setTimeout(r, 1000));
    missing = targets.filter((t) => !stands(t));
  }
  const placed = bulk.filter(stands).length;
  castleStats.stone += placed;
  if (missing.length > Math.max(2, targets.length * 0.03)) {
    castleStats.failed++;
    console.log(`[castle] ${a.name} ${v.name}: ${name}: ${missing.length} of ${targets.length} blocks not standing (${placed} stone placed)`);
    throw new Error(`build_castle: ${missing.length} blocks of ${name} not standing after the build (${out.slice(0, 160)})`);
  }
  c.done[p.id] = { base: B, gates };
  castleStats.parts++;
  // (the ring cells it stands on: built, gates gone, the part's top as theirs)
  for (const k of p.ring) {
    const g = grounds.get(k)!;
    w.built[k] = { y: g.y + 1, top: B + DECK + 2 };
  }
  noteGates(a.world.villages.villages.values());
  a.world.villages.save();
  const done = Object.keys(c.done).length;
  console.log(`[castle] ${a.name} ${v.name}: ${name} stands at base ${B}: ${placed} stone, ${gates.length} gates (${done} of ${c.parts.length} parts)`);
  return `built ${name} (${placed} stone${gates.length ? `, ${gates.length} gates` : ''}): ${out}`;
}

/** A part's deck spot for the watch: the tower's centre (stand at base + 5) once built. */
export function towerSpots(v: Village): Array<{ x: number; y: number; z: number; id: string }> {
  const c = v.wall?.castle;
  if (!c) return [];
  return c.parts.filter((p) => p.kind === 'tower' && c.done[p.id]).map((p) => ({ x: p.at.x, y: c.done[p.id].base + DECK + 1, z: p.at.z, id: p.id }));
}
export type { Column };
