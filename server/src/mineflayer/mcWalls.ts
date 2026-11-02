/**
 * Survival (d) spec 5 (MC_WALLS, on; with monsters only): the village wall on the ground. walls.ts plans the ring; here
 * its segments are built (build_wall, a chore: fence on cobblestone charged to the builder, a fence gate on the ground,
 * torches on the fences), the region grows with the village (a new neighbourhood past the ring adds a rectangle; the
 * ring's cells now inside are taken down), and the gates are kept shut: walks open a wall gate (botAgent's hook makes
 * it "openable" to the pathfinder), and the gatekeeper closes each open one once no player stands within 2.5 blocks
 * (zombies do not open gates; an open one lets them in).
 */
import { Vec3 } from 'vec3';
import type { BotAgent } from './botAgent';
import type { Village } from '../village';
import { rawSetting } from '../settings';
import { modeSpec } from '../worldMode';
import { WALL_MARGIN, growRegion, hull, inRegion, ringRuns, segBill, straightAxis, wallPlan, growBox, type Box, type Cell, type WallRecord, type WallSeg } from '../walls';
import { blockName, runJob, surfaceAt, type Target } from './mcBuild';
import { NATURAL } from './mcBlocks';
import { storageContents } from './mcStorage';
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

const key = (x: number, z: number) => `${x},${z}`;

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
export const segDone = (w: WallRecord, s: WallSeg): boolean => s.cells.every((c) => w.built[key(c.x, c.z)] || w.gaps?.includes(key(c.x, c.z)));

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
  const rects = growRegion(w.rects, wallBoxes(v));
  if (rects.length === w.rects.length) return '';
  const p = wallPlan(rects, { keep: keepBoxes(all, v) });
  const added = rects.length - w.rects.length;
  w.rects = rects;
  w.segs = p.segs;
  w.gaps = p.gaps.map((c) => key(c.x, c.z));
  const down = Object.entries(w.built).filter(([k]) => !p.ring.has(k));
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
  return ringRuns(w.segs.flatMap((s) => s.cells));
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
}

const gateFacing = (axis: 'x' | 'z') => (axis === 'x' ? 'south' : 'east');
export const gateStats = { closed: 0, seenOpen: 0 };
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
    lastClose.set(g, now);
    gateStats.closed++;
    await command(`setblock ${x} ${y} ${z} minecraft:${b.name}[facing=${p.facing ?? 'south'},open=false]`).catch(() => '');
  }
}

// ---- Hostiles inside the ring (spec 5's pass mark) -----------------------------------------------

/** Per village: night samples of hostiles inside the ring (once a game minute), their sum and the most at once. */
export const inside = new Map<string, { samples: number; sum: number; peak: number; now: number }>();
export function insideTick(v: Village, agents: BotAgent[]): void {
  const w = v.wall;
  if (!w || w.state !== 'voted' || !agents.length) return;
  const t = agents.find((a) => typeof a.bot.time?.timeOfDay === 'number')?.bot.time.timeOfDay;
  const seen = new Set<number>();
  let n = 0;
  // (inside the ring: in the region and off its edge cells)
  const shrunk = w.rects.map((b) => growBox(b, -1));
  for (const a of agents)
    for (const e of Object.values(a.bot.entities)) {
      if (seen.has(e.id) || !isHostile(e.name)) continue;
      seen.add(e.id);
      if (inRegion(shrunk, Math.floor(e.position.x), Math.floor(e.position.z))) n++;
    }
  const r = inside.get(v.name) ?? { samples: 0, sum: 0, peak: 0, now: 0 };
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
  return `[wall] ${v.name}: ${w.state}; ${done} of ${w.segs.length} segments done, ${built} of ${cells} cells built, ${gates} gates, ${w.gaps?.length ?? 0} gaps, ${w.down?.length ?? 0} to take down; gates shut ${gateStats.closed} (seen open ${gateStats.seenOpen}); hostiles inside the ring ${r?.now ?? 0} now, at night mean ${mean}, peak ${r?.peak ?? 0} (${r?.samples ?? 0} samples)`;
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
  const wood = v.wood ?? 'oak';
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
  for (const c of s.cells) {
    if (w.built[key(c.x, c.z)]) continue;
    const g = ground(c.x, c.z);
    if (!g) {
      skipped.push(`${c.x},${c.z} not loaded`);
      continue;
    }
    if (g.liquid || Math.abs(g.y - y0) > 24) {
      (w.gaps ??= []).push(key(c.x, c.z));
      skipped.push(`${c.x},${c.z} ${g.liquid ? 'water' : 'far below or above'}`);
      continue;
    }
    // (the neighbours off the ring: inside and outside)
    const gs = offRing(c).map((n) => ({ n, g: ground(n.x, n.z) }));
    const M = Math.min(g.y + 2, Math.max(g.y, ...gs.map((q) => (q.g && !q.g.liquid ? q.g.y : g.y))));
    const t: Target[] = [];
    const gate = c.gate;
    if (gate) {
      // (plants cleared in the way through: both sides' two cells above the ground)
      for (const q of gs) for (const y of [g.y + 1, g.y + 2]) if (!/^(air|cave_air)$/.test(blockName(a, q.n.x, y, q.n.z) ?? 'air')) t.push({ x: q.n.x, y, z: q.n.z, block: 'air' });
      t.push({ x: c.x, y: g.y + 1, z: c.z, block: `${wood}_fence_gate[facing=${gateFacing(gate)},open=false]` });
      for (const y of [g.y + 2, g.y + 3]) if (blockName(a, c.x, y, c.z) !== 'air' && free(blockName(a, c.x, y, c.z))) t.push({ x: c.x, y, z: c.z, block: 'air' });
    } else {
      const cells2 = [];
      for (let y = g.y + 1; y <= M + 1; y++) cells2.push(y);
      if (![...cells2, M + 2].every((y) => free(blockName(a, c.x, y, c.z)) || blockName(a, c.x, y, c.z) === 'cobblestone' || /_fence$/.test(blockName(a, c.x, y, c.z) ?? ''))) {
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
    cells.push({ c, y: g.y + 1, top, gate, t });
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
  const left = s.cells.filter((c) => !w.built[key(c.x, c.z)] && !w.gaps?.includes(key(c.x, c.z))).length;
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
