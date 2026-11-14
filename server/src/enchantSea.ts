/**
 * G8's tier-4 rungs, the age of enchantment (MC_ENCHANTMENT_AGE, #23, #19) and the age of the sea (MC_SEA_AGE): the pure
 * geometry and arithmetic the skills (mcBuild.ts make_obsidian, place_enchanting_table, enchant_books, build_dock) and the
 * offline check use. No world access: the skills read blocks and pass them in.
 */

export type P3 = { x: number; y: number; z: number };

/** Experience points from level 0 to `level` (vanilla's: L^2 + 6L up to 16, then 2.5L^2 - 40.5L + 360, then 4.5L^2 -
 *  162.5L + 2220). 8 levels are 112 points. */
export function xpTotal(level: number): number {
  const L = Math.max(0, Math.floor(level));
  if (L <= 16) return L * L + 6 * L;
  if (L <= 31) return Math.round(2.5 * L * L - 40.5 * L + 360);
  return Math.round(4.5 * L * L - 162.5 * L + 2220);
}

/** A level from `xp query NAME levels`' answer ("Ada has 5 experience levels"), or null. */
export function levelOf(reply: string): number | null {
  const m = /has (\d+) experience levels?/i.exec(reply);
  return m ? Number(m[1]) : null;
}

/**
 * The still lava sources the obsidian trip can reach from the deep level's tunnels: each within `reach` blocks (straight
 * line) of a dug tunnel cell's standing point (the cell and the one above it are air in a tunnel), never a tunnel cell
 * itself, nearest a tunnel cell first, at most `max`. Returns each with the tunnel cell to stand in.
 */
export function lavaTargets(lava: P3[], cells: P3[], max: number, reach = 3.5): Array<{ lava: P3; stand: P3 }> {
  const inTunnel = new Set(cells.flatMap((c) => [`${c.x},${c.y},${c.z}`, `${c.x},${c.y + 1},${c.z}`]));
  const out: Array<{ lava: P3; stand: P3; d: number }> = [];
  for (const l of lava) {
    if (inTunnel.has(`${l.x},${l.y},${l.z}`)) continue;
    let best: { c: P3; d: number } | null = null;
    for (const c of cells) {
      // (the eyes are 1.6 above the feet: the reach is measured from the cell's middle, a block up)
      const d = Math.hypot(l.x - c.x, l.y - (c.y + 1), l.z - c.z);
      if (d <= reach && (!best || d < best.d)) best = { c, d };
    }
    if (best) out.push({ lava: l, stand: best.c, d: best.d });
  }
  return out.sort((p, q) => p.d - q.d || p.lava.y - q.lava.y || p.lava.x - q.lava.x || p.lava.z - q.lava.z).slice(0, max).map(({ lava: l, stand }) => ({ lava: l, stand }));
}

/** The bookshelf places an enchanting table counts (vanilla: two out, on its level and the one above, the cell between
 *  them free), as offsets with the cell between. */
export const SHELF_OFFSETS: Array<{ dx: number; dy: number; dz: number; mx: number; mz: number }> = (() => {
  const out: Array<{ dx: number; dy: number; dz: number; mx: number; mz: number }> = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
    for (const dy of [0, 1]) out.push({ dx, dy, dz, mx: Math.trunc(dx / 2), mz: Math.trunc(dz / 2) });
  }
  return out;
})();

/** Bookshelves a table at `p` would count: on a shelf place, with the cell between free. */
export function shelvesAround(p: P3, shelf: (x: number, y: number, z: number) => boolean, free: (x: number, y: number, z: number) => boolean): number {
  return SHELF_OFFSETS.filter((o) => shelf(p.x + o.dx, p.y + o.dy, p.z + o.dz) && free(p.x + o.mx, p.y + o.dy, p.z + o.mz)).length;
}

/**
 * Where the enchanting table goes in the library: the inner floor cells (a ring in from the walls) at the floor's `y` with
 * room (`room`: the cell and the one above free, solid ground under it), most bookshelves counted first (they raise the
 * levels on offer), then nearest the room's middle; at most `max`.
 */
export function tableSpots(box: { x1: number; z1: number; x2: number; z2: number }, y: number, room: (x: number, y: number, z: number) => boolean,
  shelf: (x: number, y: number, z: number) => boolean, free: (x: number, y: number, z: number) => boolean, max = 8): Array<P3 & { shelves: number }> {
  const cx = (box.x1 + box.x2) / 2, cz = (box.z1 + box.z2) / 2;
  const out: Array<P3 & { shelves: number; d: number }> = [];
  for (let x = box.x1 + 1; x <= box.x2 - 1; x++) for (let z = box.z1 + 1; z <= box.z2 - 1; z++) {
    if (!room(x, y, z)) continue;
    out.push({ x, y, z, shelves: shelvesAround({ x, y, z }, shelf, free), d: Math.hypot(x - cx, z - cz) });
  }
  return out.sort((p, q) => q.shelves - p.shelves || p.d - q.d || p.x - q.x || p.z - q.z).slice(0, max).map(({ d: _d, ...r }) => r);
}

/**
 * The table's offer to take (Mineflayer's enchantment window: three slots, slot i costs i + 1 lapis and i + 1 levels and
 * asks for `level` levels held): the cheapest slot the member can pay for, or -1.
 */
export function enchantChoice(offers: Array<{ level: number } | null | undefined>, levels: number, lapis: number): number {
  for (let i = 0; i < 3; i++) {
    const o = offers[i];
    if (o && o.level > 0 && o.level <= levels && i + 1 <= lapis && i + 1 <= levels) return i;
  }
  return -1;
}

/** Enchantments a book takes at the table's cheapest slot (level 1), for the charged command when the window does not open. */
export const BOOK_ENCHANTS = ['unbreaking', 'efficiency', 'protection', 'sharpness', 'power', 'feather_falling', 'looting', 'fortune', 'respiration', 'lure'];

/** The boat of a wood kind (bamboo's is a raft; the Nether woods have none: oak). */
export function boatOf(wood: string | undefined): string {
  const w = wood ?? 'oak';
  if (w === 'bamboo') return 'bamboo_raft';
  return /^(crimson|warped)$/.test(w) ? 'oak_boat' : `${w}_boat`;
}

/** The dock's size: a deck 3 wide running DOCK_LEN out over the water (DOCK_MIN at least). */
export const DOCK_LEN = 6, DOCK_MIN = 4, DOCK_WIDTH = 3;

/** One block of the dock's plan. */
export interface DockCell { x: number; y: number; z: number; block: string }
export interface DockPlan { cells: DockCell[]; root: P3; dir: [number, number]; len: number; water: number }

const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * The dock on the nearest water (pure; `read` gives a block's name, null when not loaded): from a shore cell, a deck of
 * DOCK_WIDTH cells running straight out over the water, one above the water's surface (the shore's level), DOCK_LEN long
 * (DOCK_MIN at least), every deck cell over water with air over it; fence posts under its far corners down to the water's
 * bed, a fence on each far corner with a torch on it. `waters`: surface water cells (water with air above) to start from;
 * the shore nearest `home` first. Null when no water holds one.
 */
export function planDock(read: (x: number, y: number, z: number) => string | null, waters: P3[], home: { x: number; z: number }, wood: string): DockPlan | null {
  const isWater = (x: number, y: number, z: number) => read(x, y, z) === 'water';
  const isAir = (x: number, y: number, z: number) => { const n = read(x, y, z); return n === 'air' || n === 'cave_air'; };
  const solid = (x: number, y: number, z: number) => { const n = read(x, y, z); return !!n && !/^(air|cave_air|water|lava|bubble_column)$/.test(n) && !/(_leaves|grass|fern|flower|tulip|poppy|dandelion|_sapling|seagrass|kelp|lily_pad)$/.test(n); };
  let best: (DockPlan & { score: number }) | null = null;
  const seen = new Set<string>();
  for (const w of waters) {
    const wy = w.y;
    if (!isWater(w.x, wy, w.z) || !isAir(w.x, wy + 1, w.z)) continue;
    for (const [dx, dz] of DIRS) {
      // (the root: land at the water's level or one above it, behind the first deck cell, with room over it)
      const rx = w.x - dx, rz = w.z - dz;
      const key = `${rx},${rz},${dx},${dz}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const top = solid(rx, wy + 1, rz) ? wy + 1 : solid(rx, wy, rz) ? wy : null;
      if (top === null || !isAir(rx, top + 1, rz) || !isAir(rx, top + 2, rz)) continue;
      const [px, pz] = [dz, dx];
      let len = 0;
      for (let i = 0; i < DOCK_LEN; i++) {
        let ok = true;
        for (const s of [-1, 0, 1]) {
          const x = w.x + dx * i + px * s, z = w.z + dz * i + pz * s;
          if (!isWater(x, wy, z) || !isAir(x, wy + 1, z) || !isAir(x, wy + 2, z)) ok = false;
        }
        if (!ok) break;
        len++;
      }
      if (len < DOCK_MIN) continue;
      const score = Math.hypot(rx - home.x, rz - home.z) - len;
      if (best && best.score <= score) continue;
      const cells: DockCell[] = [];
      const dy = wy + 1;
      for (let i = 0; i < len; i++) for (const s of [-1, 0, 1]) cells.push({ x: w.x + dx * i + px * s, y: dy, z: w.z + dz * i + pz * s, block: `${wood}_planks` });
      let water = 0;
      for (const s of [-1, 1]) {
        const x = w.x + dx * (len - 1) + px * s, z = w.z + dz * (len - 1) + pz * s;
        // (a post down through the water to its bed, six at most)
        for (let y = wy; y > wy - 6 && isWater(x, y, z); y--) {
          cells.push({ x, y, z, block: `${wood}_fence` });
          water++;
        }
        cells.push({ x, y: dy + 1, z, block: `${wood}_fence` }, { x, y: dy + 2, z, block: 'torch' });
      }
      best = { cells, root: { x: rx, y: top, z: rz }, dir: [dx, dz], len, water, score };
    }
  }
  if (!best) return null;
  const { score: _s, ...plan } = best;
  return plan;
}
