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
/** Ancient debris lies at y 8-22 (two vanilla features; the probe found 6-7 within 48 of minevale3's far portal). */
export const DEBRIS_Y = { min: 8, max: 22 }, DEBRIS_REACH = 48;

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

/** The ground kept round the far portal (no expedition or walk digs it): 4 out, 3 under its bottom, 5 over it. The first
 *  trips dug its floor away and the members' way back stood on air (nether3, 11-14). */
export const FAR_KEEP = { out: 4, under: 3, over: 5 };
/** `column`: at any height, a block more round it (an expedition's targets: a block under the kept ground is reached only
 *  through it, and every dig of nether4's first trips was "no path"). */
export function nearPortal(far: Cell, c: Cell, column = false): boolean {
  const out = FAR_KEEP.out + (column ? 1 : 0);
  return Math.abs(c.x - far.x) <= out && Math.abs(c.z - far.z) <= out && (column || (c.y >= far.y - FAR_KEEP.under && c.y <= far.y + FAR_KEEP.over));
}
/** The far portal's kept ground as a protected box (botAgent.protectedGround off the overworld). */
export function farBox(far: Cell): { x1: number; z1: number; x2: number; z2: number; y: number; y2: number } {
  return { x1: far.x - FAR_KEEP.out, z1: far.z - FAR_KEEP.out, x2: far.x + FAR_KEEP.out, z2: far.z + FAR_KEEP.out, y: far.y - FAR_KEEP.under, y2: far.y + FAR_KEEP.over };
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

/** The overworld point a Nether position stands for (vanilla's 1:8). */
export const overworldOf = (c: { x: number; z: number }) => ({ x: c.x * 8, z: c.z * 8 });
