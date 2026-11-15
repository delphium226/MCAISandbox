/**
 * The Nether rung's geometry (docs/specs/nether.md section 2, Phase A; pure, checked offline in nether_unit.mts): where the
 * village's portal stands and its cells, the far side's stand cell, an expedition's box, which Nether blocks a member may
 * dig, and the debris dig's lava rule. mcNether.ts reads the world and runs the skills.
 */

export type Axis = 'x' | 'z';
export interface Cell { x: number; y: number; z: number }
/** The portal as the village records it: the frame's lower corner (x, z the low end along the axis; y the bottom row, sunk
 *  into the ground so the inner cells are level with the stand cell), its axis and the stand cell in front of it. */
export interface PortalSite extends Cell { axis: Axis; stand: Cell }

/** The obsidian of a frame: 4 wide, 5 high, no corners (10 blocks). */
export const FRAME_BLOCKS = 10;
/** The farthest a portal is planned from the storage hut, and the least from another village's portal (vanilla links an
 *  overworld portal to a Nether portal within 16 Nether blocks, 128 overworld: two villages' portals closer than that would
 *  share a far portal). */
export const PORTAL_REACH = 40, PORTAL_APART = 160;
/** An expedition's box round the far portal: 32 out, 12 up and down (the member's own 8-chunk view covers it). */
export const TRIP_OUT = 32, TRIP_UPDOWN = 12;
/** The most blocks one member brings a trip, and the trip's minutes (game time). */
export const TRIP_BLOCKS = 24, TRIP_MIN = 8;
/** Ancient debris lies mostly at y 8-22, a smaller feature up to y 119. Round minevale3's far portal all 25 at y 8-22
 *  within 64 lie under the lava sea (y 31), which no safe stair passes (nether9-11, 11-14); 3 lie above it (y 45, 109).
 *  So the dig looks from y 8 to 119 within 64, the stair's lava rule choosing. */
export const DEBRIS_Y = { min: 8, max: 119 }, DEBRIS_REACH = 64;

const along = (axis: Axis, i: number): [number, number] => (axis === 'x' ? [i, 0] : [0, i]);
const across = (axis: Axis, j: number): [number, number] => (axis === 'x' ? [0, j] : [j, 0]);

/** The frame's 10 obsidian cells. */
export function frameCells(p: { x: number; y: number; z: number; axis: Axis }): Cell[] {
  const out: Cell[] = [];
  const at = (i: number, dy: number) => {
    const [dx, dz] = along(p.axis, i);
    out.push({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
  };
  for (const i of [1, 2]) at(i, 0), at(i, 4);
  for (const dy of [1, 2, 3]) at(0, dy), at(3, dy);
  return out;
}

/** The six inner cells the portal fills. */
export function innerCells(p: { x: number; y: number; z: number; axis: Axis }): Cell[] {
  const out: Cell[] = [];
  for (const i of [1, 2]) for (const dy of [1, 2, 3]) {
    const [dx, dz] = along(p.axis, i);
    out.push({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
  }
  return out;
}

/** The cells in front of and behind the portal's inner columns (side -1 and +1), at the inner bottom's level. */
export function faceCells(p: { x: number; y: number; z: number; axis: Axis }, side: 1 | -1): Cell[] {
  return [1, 2].map((i) => {
    const [dx, dz] = along(p.axis, i), [ex, ez] = across(p.axis, side);
    return { x: p.x + dx + ex, y: p.y + 1, z: p.z + dz + ez };
  });
}

/** What planPortal reads of the world: the ground's top at a column (the highest solid block with air over it near the
 *  hint), whether that ground is firm (not liquid, leaves or a log) and the 5 cells over it are clear or plants. */
export interface GroundRead {
  (x: number, z: number): { y: number; firm: boolean; clear: boolean } | null;
}

/**
 * Where the village's portal goes: a 4-wide frame and a cell of room on each face (a 4 by 3 footprint), all on firm ground
 * at one level with nothing over it, off every protected box (plots and their margins, structures, the mine: the caller's
 * `blocked`), more than PORTAL_APART from another village's portal, within PORTAL_REACH of the storage hut; its face
 * toward the hut (the stand cell on the hut's side). The nearest such site, else null.
 */
export function planPortal(hut: { x: number; z: number }, ground: GroundRead, blocked: (x: number, z: number, y: number) => boolean, others: Array<{ x: number; z: number }>): PortalSite | null {
  const cands: Array<{ x: number; z: number; d: number }> = [];
  for (let dx = -PORTAL_REACH; dx <= PORTAL_REACH; dx++) for (let dz = -PORTAL_REACH; dz <= PORTAL_REACH; dz++) {
    const d = Math.hypot(dx, dz);
    if (d >= 6 && d <= PORTAL_REACH) cands.push({ x: hut.x + dx, z: hut.z + dz, d });
  }
  cands.sort((p, q) => p.d - q.d || p.x - q.x || p.z - q.z);
  for (const c of cands) {
    // (the face toward the hut: a hut east or west of the site faces the portal along x, so its frame spans z)
    const axis: Axis = Math.abs(hut.x - c.x) > Math.abs(hut.z - c.z) ? 'z' : 'x';
    const side: 1 | -1 = axis === 'x' ? (hut.z >= c.z ? 1 : -1) : (hut.x >= c.x ? 1 : -1);
    const site = fits(c.x, c.z, axis, side, ground, blocked, others);
    if (site) return site;
  }
  return null;
}

function fits(x: number, z: number, axis: Axis, side: 1 | -1, ground: GroundRead, blocked: (x: number, z: number, y: number) => boolean, others: Array<{ x: number; z: number }>): PortalSite | null {
  if (others.some((o) => Math.hypot(o.x - x, o.z - z) < PORTAL_APART)) return null;
  let level: number | null = null;
  for (let i = 0; i < 4; i++) for (const j of [-1, 0, 1]) {
    const [ax, az] = along(axis, i), [bx, bz] = across(axis, j);
    const cx = x + ax + bx, cz = z + az + bz;
    const g = ground(cx, cz);
    if (!g || !g.firm || !g.clear) return null;
    if (level === null) level = g.y;
    if (g.y !== level) return null;
    if (blocked(cx, cz, g.y) || blocked(cx, cz, g.y + 1)) return null;
  }
  const p = { x, y: level!, z, axis };
  const stand = faceCells(p, side)[0];
  return { ...p, stand };
}

/** The floor kept round the far portal (no expedition or walk digs it): 2 out from its lower corner, the two layers under
 *  its bottom. The first trips dug its floor away and the way back stood on air (nether3, 11-14); a wider box with the
 *  walls in it left the members no way out of an arrival cave (nether4-5): walls may be dug, the floor not. */
export const FAR_KEEP = { out: 2, under: 2 };
/** `column`: at any height, a block more round it (an expedition's targets: a block under the floor is reached only
 *  through it, and every dig of nether4's first trips was "no path"). */
export function nearPortal(far: Cell, c: Cell, column = false): boolean {
  const out = FAR_KEEP.out + (column ? 1 : 0);
  return Math.abs(c.x - far.x) <= out && Math.abs(c.z - far.z) <= out && (column || (c.y >= far.y - FAR_KEEP.under && c.y <= far.y - 1));
}
/** The far portal's kept floor as a protected box (botAgent.protectedGround off the overworld). */
export function farBox(far: Cell): { x1: number; z1: number; x2: number; z2: number; y: number; y2: number } {
  return { x1: far.x - FAR_KEEP.out, z1: far.z - FAR_KEEP.out, x2: far.x + FAR_KEEP.out, z2: far.z + FAR_KEEP.out, y: far.y - FAR_KEEP.under, y2: far.y - 1 };
}

/** Whether a Nether cell lies in an expedition's box round the far portal. */
export function inTripBox(far: Cell, c: Cell): boolean {
  return Math.abs(c.x - far.x) <= TRIP_OUT && Math.abs(c.z - far.z) <= TRIP_OUT && Math.abs(c.y - far.y) <= TRIP_UPDOWN;
}

/** The blocks an expedition digs (each drops itself, or netherrack for nylium, quartz for its ore, gold nuggets for
 *  nether gold ore; a pickaxe for all of them), and the items it counts as brought back (ladder.ts NETHER_BLOCKS). */
export const DIG_NETHER = ['netherrack', 'crimson_nylium', 'warped_nylium', 'blackstone', 'basalt', 'soul_sand', 'soul_soil', 'magma_block', 'nether_quartz_ore', 'nether_gold_ore', 'glowstone'];

/** Blocks a dig keeps away from (one cell): they flow or burn. */
export const HOT = /^(lava|fire|soul_fire)$/;

/**
 * Whether a member may dig a cell on an expedition or a debris dig (the spec's rules): never the block under its feet,
 * never one with lava or fire beside or above it (six neighbours), never one that would let lava in (the read is the
 * caller's: `name(x, y, z)` from the bot's own world, '' unloaded, which also refuses).
 */
export function safeToDig(c: Cell, feet: Cell, name: (x: number, y: number, z: number) => string): boolean {
  if (c.x === feet.x && c.z === feet.z && c.y === feet.y - 1) return false;
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const n = name(c.x + dx, c.y + dy, c.z + dz);
    if (!n || HOT.test(n)) return false;
  }
  return true;
}

/** An exposed cell (a face on air), so a member reaches it without digging a tunnel. */
export function exposed(c: Cell, name: (x: number, y: number, z: number) => string): boolean {
  return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => /^(air|cave_air)$/.test(name(c.x + dx, c.y + dy, c.z + dz)));
}

/** The far portal's stand cell: of the cells beside the arrival portal's columns (both faces, then its ends), the first
 *  with firm ground under it and air at the feet and the head. */
export function farStand(portal: Cell[], name: (x: number, y: number, z: number) => string): Cell | null {
  if (!portal.length) return null;
  const xs = new Set(portal.map((c) => c.x)), zs = new Set(portal.map((c) => c.z));
  const axis: Axis = xs.size > 1 ? 'x' : 'z';
  const low = Math.min(...portal.map((c) => c.y));
  const bottom = portal.filter((c) => c.y === low);
  const free = (c: Cell) => /^(air|cave_air)$/.test(name(c.x, c.y, c.z)) && /^(air|cave_air)$/.test(name(c.x, c.y + 1, c.z));
  const firm = (c: Cell) => { const n = name(c.x, c.y - 1, c.z); return !!n && !/^(air|cave_air|lava|fire|soul_fire|water|nether_portal)$/.test(n); };
  const tries: Cell[] = [];
  for (const side of [-1, 1]) for (const b of bottom) tries.push(axis === 'x' ? { x: b.x, y: low, z: b.z + side } : { x: b.x + side, y: low, z: b.z });
  const ends = axis === 'x' ? [Math.min(...xs) - 1, Math.max(...xs) + 1].map((x) => ({ x, y: low, z: [...zs][0] })) : [Math.min(...zs) - 1, Math.max(...zs) + 1].map((z) => ({ x: [...xs][0], y: low, z }));
  tries.push(...ends);
  return tries.find((c) => free(c) && firm(c)) ?? null;
}

/**
 * One step of the debris dig's stair from `p` (the member's feet) toward `t`: one block along the axis with the longer way
 * to go, and one down while the feet are more than one above the target (one up while below it). `dig`: the cells to clear
 * (the head room over the next cell, its head and its feet); `to`: the next cell's feet.
 */
export function stairStep(p: Cell, t: Cell): { to: Cell; dig: Cell[] } {
  const ax = Math.abs(t.x - p.x) >= Math.abs(t.z - p.z);
  // (straight over the target: a step aside, never down through the floor underfoot)
  const dx = ax ? Math.sign(t.x - p.x) || 1 : 0, dz = ax ? 0 : Math.sign(t.z - p.z);
  const dy = p.y > t.y + 1 ? -1 : p.y < t.y ? 1 : 0;
  const to = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
  const dig = dy < 0 ? [{ x: to.x, y: p.y + 1, z: to.z }, { x: to.x, y: p.y, z: to.z }, { x: to.x, y: to.y, z: to.z }]
    : dy > 0 ? [{ x: p.x, y: p.y + 2, z: p.z }, { x: to.x, y: to.y + 1, z: to.z }, { x: to.x, y: to.y, z: to.z }]
    : [{ x: to.x, y: to.y + 1, z: to.z }, { x: to.x, y: to.y, z: to.z }];
  return { to, dig };
}

/**
 * The whole stair from `p` to within reach of `t`, read from the world before a block is dug (the debris dig's choice of
 * target: nether9's stairs all ran into the lava sea at y 31 over the debris): every cell dug and its neighbours free of
 * lava and fire and loaded, nothing loose over them, each step's floor firm or a cave bridged (at most `bridges`), never
 * water or lava under a step. Null with why it fails, else the steps and the bridges it takes.
 */
export function planStair(p: Cell, t: Cell, name: (x: number, y: number, z: number) => string, bridges = 16, maxSteps = 120): { steps: number; bridges: number } | { why: string } {
  let cur = { ...p }, used = 0;
  const dug = new Set<string>();
  const key = (c: Cell) => `${c.x},${c.y},${c.z}`;
  // (cells already dug or bridged by the plan read as such)
  const read = (x: number, y: number, z: number) => (dug.has(`${x},${y},${z}`) ? 'air' : name(x, y, z));
  for (let n = 0; n < maxSteps; n++) {
    if (Math.hypot(t.x + 0.5 - (cur.x + 0.5), t.y + 0.5 - (cur.y + 1.62), t.z + 0.5 - (cur.z + 0.5)) <= 4.2) return { steps: n, bridges: used };
    const st = stairStep(cur, t);
    for (const c of st.dig) {
      const b = read(c.x, c.y, c.z);
      if (!b) return { why: `unloaded at ${key(c)}` };
      if (/^(air|cave_air)$/.test(b)) continue;
      if (/^(bedrock|obsidian|crying_obsidian|nether_portal)$/.test(b) || (b === 'ancient_debris' && key(c) !== key(t))) return { why: `${b} at ${key(c)}` };
      if (!safeToDig(c, cur, read) || /^(gravel|sand|soul_sand|red_sand)$/.test(read(c.x, c.y + 1, c.z))) return { why: `lava or loose ground by ${key(c)}` };
      dug.add(key(c));
    }
    const f = read(st.to.x, st.to.y - 1, st.to.z);
    if (!f || HOT.test(f) || /^(water|nether_portal)$/.test(f)) return { why: `${f || 'unloaded'} under ${key(st.to)}` };
    if (/^(air|cave_air)$/.test(f) && ++used > bridges) return { why: `more than ${bridges} caves to bridge` };
    cur = st.to;
  }
  return { why: 'too long' };
}

/** The overworld point a Nether position stands for (vanilla's 1:8). */
export const overworldOf = (c: { x: number; z: number }) => ({ x: c.x * 8, z: c.z * 8 });

/*
 * B4, the long Nether walk applied to the debris dig (MC_NETHER_TREK; spec section 2, B4). Round minevale3's far portal
 * the portal stands on a floating island in the open cave over the lava sea: walking reaches 171 cells, none off it, and no
 * dry debris (11-15's measurement of world 2's region files). One flat bridge of netherrack at the island's level (25-34
 * blocks there) reaches the mainland, with 25 dry debris within 100 blocks and 364 within 300. So a trek: the bridge (laid
 * once, kept for later trips), then legs of up to 40 blocks toward the nearest debris that is not under lava, each leg's
 * end a breadcrumb, a dig wherever a safe stair reaches one, and the way back along the breadcrumbs.
 */

/** A trek's limits: legs of 40 blocks, out to 300 from the far portal, a bridge of at most 40 netherrack, a ground of
 *  1500 standing cells counted as the mainland, the trip 15 minutes (game time) with the walk out ending at 8, walk reach
 *  read 40 across at most 4000 cells (one event loop serves every bot, lesson 16). */
export const TREK = { leg: 40, out: 300, bridge: 40, mainland: 1500, tripMin: 15, outMin: 8, reach: 40, cap: 4000 };

/** A member's trek while it is out (BotAgent.trek): the breadcrumbs (each leg's end; the first the bridge's far end), the
 *  pinned stalls it backed off from, and whether a pinned stall ended it. */
export interface Trek { crumbs: Cell[]; backoffs: number; ended?: boolean }

type Name = (x: number, y: number, z: number) => string;
const AIRN = /^(air|cave_air|void_air)$/;
const SOFT = /^(crimson_fungus|warped_fungus|crimson_roots|warped_roots|nether_sprouts|twisting_vines|twisting_vines_plant|weeping_vines|weeping_vines_plant|short_grass|red_mushroom|brown_mushroom)$/;
/** A cell a body passes through (air, or a Nether plant). */
const clearAt = (n: string) => AIRN.test(n) || SOFT.test(n);
const SIX = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Lava or fire in the cell or beside it (or the cell not loaded). */
function hotBy(name: Name, x: number, y: number, z: number): boolean {
  return SIX.some(([dx, dy, dz]) => { const n = name(x + dx, y + dy, z + dz); return !n || HOT.test(n); });
}
const key = (c: Cell) => `${c.x},${c.y},${c.z}`;

/** A cell a member can stand in on a trek: firm ground under it (not lava, fire, water, magma or a portal), its feet and
 *  head clear, no lava or fire in or beside either. */
export function standable(name: Name, x: number, y: number, z: number): boolean {
  const g = name(x, y - 1, z);
  if (!g || clearAt(g) || HOT.test(g) || /^(water|nether_portal|magma_block)$/.test(g)) return false;
  const f = name(x, y, z), h = name(x, y + 1, z);
  if (!f || !h || !clearAt(f) || !clearAt(h)) return false;
  return !hotBy(name, x, y, z) && !hotBy(name, x, y + 1, z);
}

/**
 * Where a member walks from `start` without digging (the measurement's rule, close to the pathfinder's): a step to a side
 * cell level, one up (head room over the start), or down by up to 3 (the column clear), onto a standable cell; within
 * `radius` across, at most `cap` cells. The cells with their walk steps.
 */
export function walkReach(start: Cell, name: Name, radius = TREK.reach, cap = TREK.cap): Map<string, { c: Cell; d: number }> {
  const out = new Map<string, { c: Cell; d: number }>();
  const memo = new Map<string, boolean>();
  const can = (c: Cell) => { const k = key(c); let s = memo.get(k); if (s === undefined) memo.set(k, (s = standable(name, c.x, c.y, c.z))); return s; };
  out.set(key(start), { c: start, d: 0 });
  const q: Cell[] = [start];
  for (let i = 0; i < q.length && out.size < cap; i++) {
    const p = q[i], d = out.get(key(p))!.d;
    for (const [dx, dz] of DIRS4) for (const dy of [1, 0, -1, -2, -3]) {
      const n = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
      if (Math.abs(n.x - start.x) > radius || Math.abs(n.z - start.z) > radius || out.has(key(n))) continue;
      if (dy === 1 && !clearAt(name(p.x, p.y + 2, p.z))) continue;
      if (dy < 0) {
        let ok = true;
        for (let h = dy + 2; h < 2 && ok; h++) ok = clearAt(name(n.x, p.y + h, n.z));
        if (!ok) continue;
      }
      if (!can(n)) continue;
      out.set(key(n), { c: n, d: d + 1 });
      q.push(n);
      if (out.size >= cap) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// An expedition's ground (11-15): netherT1's Dev and netherT3's Elena dug round the far portal on minevale3's floating
// island, walked off its edge (the walk's drops of 4, then 8 when no path) and fell 11 and 23 blocks; the way back failed
// and both were recalled. An expedition now walks only the island's own ground (level steps and steps of one up or down,
// each walked back as it was walked out), digs from a stand with no drop beside it, and never digs a floor that ground is.
// ---------------------------------------------------------------------------------------------

/** The cells walked from `start` by level steps and steps of one up or down (no drops: every step walks back), within
 *  `radius` across and `updown` up or down, at most `cap`. */
export function islandReach(start: Cell, name: Name, radius: number, updown: number, cap = TREK.cap): Map<string, Cell> {
  const out = new Map<string, Cell>([[key(start), start]]);
  const q: Cell[] = [start];
  for (let i = 0; i < q.length && out.size < cap; i++) {
    const p = q[i];
    for (const [dx, dz] of DIRS4) for (const dy of [0, 1, -1]) {
      const n = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
      if (Math.abs(n.x - start.x) > radius || Math.abs(n.z - start.z) > radius || Math.abs(n.y - start.y) > updown || out.has(key(n))) continue;
      // (head room over the lower of the two cells: over the start to step up, over the next cell to step down)
      if (dy === 1 && !clearAt(name(p.x, p.y + 2, p.z))) continue;
      if (dy === -1 && !clearAt(name(n.x, p.y + 1, n.z))) continue;
      if (!standable(name, n.x, n.y, n.z)) continue;
      out.set(key(n), n);
      q.push(n);
      if (out.size >= cap) break;
    }
  }
  return out;
}

/** A stand with no drop beside it: each side cell at its level is a wall, or open with a floor one or two below (not
 *  lava, fire or unloaded). */
export function inland(c: Cell, name: Name): boolean {
  for (const [dx, dz] of DIRS4) {
    const x = c.x + dx, z = c.z + dz;
    const f = name(x, c.y, z);
    if (!f) return false;
    if (!clearAt(f)) continue;
    let floor = false;
    for (const dy of [1, 2]) {
      const g = name(x, c.y - dy, z);
      if (!g || HOT.test(g)) return false;
      if (!clearAt(g)) { floor = true; break; }
    }
    if (!floor) return false;
  }
  return true;
}

/** An island's dig stands, by column (x,z), and the floors under its cells: what expeditionStand reads. */
export interface IslandDig { stands: Map<string, Cell[]>; floors: Set<string>; cells: Map<string, Cell> }
export function islandDig(island: Map<string, Cell>, name: Name): IslandDig {
  const stands = new Map<string, Cell[]>(), floors = new Set<string>();
  for (const c of island.values()) {
    floors.add(key({ x: c.x, y: c.y - 1, z: c.z }));
    if (!inland(c, name)) continue;
    const k = `${c.x},${c.z}`;
    stands.set(k, [...(stands.get(k) ?? []), c]);
  }
  return { stands, floors, cells: island };
}

/** After a dig at `c`: a floor dug is a pit one deep, its cell the ground's now (the one over it no longer, the floor
 *  under it kept); the stands beside it read again (a wall dug away can leave a drop beside a stand). */
export function afterIslandDig(d: IslandDig, c: Cell, name: Name): void {
  if (d.floors.has(key(c))) {
    const over = { x: c.x, y: c.y + 1, z: c.z };
    d.cells.delete(key(over));
    const k = `${c.x},${c.z}`, list = (d.stands.get(k) ?? []).filter((s) => s.y !== over.y);
    if (list.length) d.stands.set(k, list); else d.stands.delete(k);
    d.floors.delete(key(c));
    d.cells.set(key(c), c);
    d.floors.add(key({ x: c.x, y: c.y - 1, z: c.z }));
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const k = `${c.x + dx},${c.z + dz}`, list = d.stands.get(k);
    if (!list) continue;
    const kept = list.filter((s) => inland(s, name));
    if (kept.length) d.stands.set(k, kept); else d.stands.delete(k);
  }
}

/** Where an expedition digs `c` from: an inland stand of the island within reach of it (the eye 4.2 from its middle),
 *  not standing on it, nearest `feet`. Null when nothing solid lies under `c` (its drop would fall: netherT5-7's digs under
 *  the floating island's edge brought back none of 24 a trip), or when no stand reaches it. A floor of the ground with
 *  something solid under it is dug as a pit one deep (afterIslandDig), never a hole in the way back. */
export function expeditionStand(c: Cell, d: IslandDig, feet: Cell, name: Name): Cell | null {
  const below = name(c.x, c.y - 1, c.z);
  if (!below || clearAt(below) || HOT.test(below) || /^(water|nether_portal)$/.test(below)) return null;
  let best: Cell | null = null, bd = Infinity;
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
    for (const s of d.stands.get(`${c.x + dx},${c.z + dz}`) ?? []) {
      if (s.x === c.x && s.z === c.z && s.y === c.y + 1) continue;
      if (Math.hypot(s.x + 0.5 - (c.x + 0.5), s.y + 1.62 - (c.y + 0.5), s.z + 0.5 - (c.z + 0.5)) > 4.2) continue;
      const q = Math.hypot(s.x - feet.x, s.y - feet.y, s.z - feet.z);
      if (q < bd) { bd = q; best = s; }
    }
  }
  return best;
}

/** Whether a standing cell is on the mainland: walking from it reaches TREK.mainland cells (a small islet does not). */
export function onMainland(c: Cell, name: Name): boolean {
  return walkReach(c, name, 64, TREK.mainland).size >= TREK.mainland;
}

/** A bridge off the far portal's island: the cell it starts from, the feet cells walked in order, the floor cells laid
 *  with netherrack (the ones over air), and the landing on the mainland. */
export interface BridgePlan { from: Cell; path: Cell[]; cells: Cell[]; land: Cell }

/**
 * The cheapest flat bridge at feet level `y` from the island's cells (`island`, the walk reach from the far portal) to the
 * mainland: a walk over the plane at that level, a step onto existing firm ground free, a step over air one netherrack laid
 * under it; never lava or fire in or beside the feet, the head or the floor, no lava within 3 under the floor (no
 * bridging at lava level), no water or portal under it; at most `max` blocks. Null when none lands.
 */
export function planBridge(island: Cell[], y: number, name: Name, max = TREK.bridge, mainland: (c: Cell) => boolean = (c) => onMainland(c, name)): BridgePlan | null {
  const home = new Set(island.map(key));
  const starts = island.filter((c) => c.y === y);
  if (!starts.length) return null;
  const k2 = (x: number, z: number) => `${x},${z}`;
  const cost = new Map<string, number>(), parent = new Map<string, string>(), small = new Set<string>();
  const layers: Array<Array<[number, number]>> = [[]];
  for (const c of starts) { cost.set(k2(c.x, c.z), 0); layers[0].push([c.x, c.z]); }
  const x0 = Math.min(...starts.map((c) => c.x)) - max - 8, x1 = Math.max(...starts.map((c) => c.x)) + max + 8;
  const z0 = Math.min(...starts.map((c) => c.z)) - max - 8, z1 = Math.max(...starts.map((c) => c.z)) + max + 8;
  const back = (x: number, z: number): BridgePlan => {
    const path: Cell[] = [];
    let k: string | undefined = k2(x, z);
    while (k) { const [px, pz] = k.split(',').map(Number); path.unshift({ x: px, y, z: pz }); k = parent.get(k); }
    const from = path.shift()!;
    const cells = path.filter((c) => AIRN.test(name(c.x, y - 1, c.z))).map((c) => ({ x: c.x, y: y - 1, z: c.z }));
    return { from, path, cells, land: { x, y, z } };
  };
  for (let b = 0; b < layers.length && b <= max; b++) {
    const layer = layers[b];
    for (let i = 0; i < layer.length; i++) {
      const [x, z] = layer[i];
      if (cost.get(k2(x, z)) !== b) continue;
      for (const [dx, dz] of DIRS4) {
        const nx = x + dx, nz = z + dz;
        if (nx < x0 || nx > x1 || nz < z0 || nz > z1) continue;
        const f = name(nx, y, nz), h = name(nx, y + 1, nz), g = name(nx, y - 1, nz);
        if (!f || !h || !g || !clearAt(f) || !clearAt(h) || hotBy(name, nx, y, nz) || hotBy(name, nx, y + 1, nz) || hotBy(name, nx, y - 1, nz)) continue;
        if (/^(water|nether_portal)$/.test(g) || HOT.test(g)) continue;
        let w = 0;
        if (clearAt(g)) {
          // (a plant is no floor; air only, and nothing hot within 3 under it)
          if (!AIRN.test(g)) continue;
          let dry = true;
          for (let k = 2; k <= 4 && dry; k++) { const u = name(nx, y - k, nz); dry = !!u && !HOT.test(u); }
          if (!dry) continue;
          w = 1;
        }
        const nb = b + w, nk = k2(nx, nz);
        if (nb > max || (cost.get(nk) ?? Infinity) <= nb) continue;
        cost.set(nk, nb);
        parent.set(nk, k2(x, z));
        const cell = { x: nx, y, z: nz };
        if (w === 0 && !home.has(key(cell)) && !small.has(key(cell)) && standable(name, nx, y, nz)) {
          if (mainland(cell)) return back(nx, nz);
          small.add(key(cell));
        }
        (layers[nb] ??= []).push([nx, nz]);
      }
    }
  }
  return null;
}

/**
 * The next leg's end: of the cells the member reaches by walking (`reach`), within a leg's walk, the one nearest the
 * target across; only if it comes at least 6 blocks nearer than where the member stands. Null: no way on toward it.
 */
export function chooseLeg(reach: Map<string, { c: Cell; d: number }>, cur: Cell, target: Cell, leg = TREK.leg): Cell | null {
  const far = (c: Cell) => Math.hypot(c.x - target.x, c.z - target.z);
  let best: Cell | null = null, bd = far(cur) - 6;
  for (const { c, d } of reach.values()) {
    if (d > leg * 2) continue;
    const q = far(c);
    if (q < bd) { bd = q; best = c; }
  }
  return best;
}

/** Whether a debris is worth walking toward: safe to dig and no lava in its column within 24 above it (not under the lava
 *  sea or a lake), every cell read loaded. */
export function trekTarget(c: Cell, name: Name): boolean {
  if (!safeToDig(c, { x: c.x, y: c.y + 99, z: c.z }, name)) return false;
  for (let k = 1; k <= 24; k++) { const n = name(c.x, c.y + k, c.z); if (!n || HOT.test(n)) return false; }
  return true;
}

/**
 * The trek-aware pinned rule (spec section 6, risk 10): a walk pinned on a trek does not send the member home (the far
 * portal) but back to the last breadcrumb more than 6 blocks off, twice at most; after that the trek ends where it is
 * (null) and the way back starts, keeping what it dug.
 */
export function trekPinned(t: Trek, pos: Cell): Cell | null {
  if (t.backoffs >= 2) return null;
  for (let i = t.crumbs.length - 1; i >= 0; i--) {
    const c = t.crumbs[i];
    if (Math.hypot(c.x - pos.x, c.y - pos.y, c.z - pos.z) > 6) return c;
  }
  return null;
}

/** The debris option's back-off after a trip, in game minutes: 4, doubled for each trip in a row that dug nothing, to 32. */
export const futileBackoffMin = (futile: number) => 4 * 2 ** Math.max(0, Math.min(3, futile));

/** Whether a Nether cell is one of the bridge's floor blocks (expeditions and stairs keep off it). */
export function onBridge(bridge: { cells: Cell[] } | undefined, c: Cell): boolean {
  return !!bridge && bridge.cells.some((q) => q.x === c.x && q.y === c.y && q.z === c.z);
}
