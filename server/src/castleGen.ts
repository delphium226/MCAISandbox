/**
 * A castle drawn by code (the monument's second type, #153; runs/2026-10-25/monument/castle_note.md), beside gothicGen.ts:
 * a grammar of parts, each a function of the scale and the materials: drum towers (a round shell with timber floors, a
 * door to the ward, a door to the wall-walk, arrow slits, a crenellated top and on some a slim watch turret), curtain
 * wall segments between tower centres (solid, a wall-walk with a parapet and merlons on the outer face), gatehouses (an
 * open passage through a wall with a raised portcullis, and a barbican in front: a walled forecourt with corner turrets),
 * halls against a curtain (a stone shell with windows and a timber roof whose stairs face uphill) and a square keep (the
 * White Tower's: pilaster buttresses, corner turrets, timber floors, windows). Presets give a real castle's measures in
 * metres (1 m = 1 block at 1:1; approximate, from the standard histories); the scale divides them, with minimums that
 * keep every passage walkable. Code draws every cell, so the bill is exact (lesson 1).
 *
 * The plan's long axis runs west to east (x), its main gate in the west at x = 0 and the middle of z, as the cathedral's
 * west portal (monument.ts' site search puts that door toward the village). The output is gothicGen's Cathedral shape
 * (design, stages, jobs of 300-800 blocks cut by x slices, bill, cell maps) plus the stage names: the castle's stages are
 * the order real castles grew in (the keep, the curtain, its towers, the gatehouses, the halls, the battlements), with
 * those a preset has no part for left out and the rest numbered from 1.
 */
import type { Cathedral, GothicJob } from './gothicGen';
import type { Design } from './village';

export interface CastleTower {
  /** Centre in metres in the plan (x west to east, z north to south). */
  x: number; z: number;
  /** Diameter and height (metres); a slim watch turret on its top. */
  d: number; h: number;
  turret?: boolean;
}
export interface CastleGate {
  /** The wall it passes through: between the centres of towers a and b. */
  a: number; b: number;
  /** A raised portcullis on its outer face, and a barbican this deep in front of it (metres; 0: none). */
  portcullis: boolean;
  barbican: number;
}
export interface CastlePreset {
  name: string;
  description: string;
  /** The curtain's height to its wall-walk and its thickness (metres). */
  wallHeight: number;
  wallThick: number;
  towers: CastleTower[];
  /** Curtain segments, by tower index: the ring and any cross-walls. */
  walls: Array<[number, number]>;
  gates: CastleGate[];
  /** Halls against a curtain, metres: the box they stand in (one side on the curtain) and their wall height. */
  halls: Array<{ x0: number; x1: number; z0: number; z1: number; h: number }>;
  /** A square keep: its corner (metres), size, height, wall thickness; one corner turret round (the White Tower's NE). */
  keep?: { x: number; z: number; w: number; d: number; h: number; t: number; round?: 'ne' | 'nw' | 'se' | 'sw' };
  /** The passage through a gate (metres). */
  gateWidth: number;
  gateHeight: number;
}

/** The towers of a rectangle of 2 x n drum towers (north row then south row). */
const rowTowers = (xs: number[], width: number, d: number, h: number, turret: (i: number) => boolean): CastleTower[] =>
  [0, width].flatMap((z) => xs.map((x, i) => ({ x, z, d, h, turret: turret(i) })));

export const CASTLE_PRESETS: Record<string, CastlePreset> = {
  conwy: {
    name: 'conwy',
    description: 'Conwy: a long ward of eight drum towers, an outer and an inner ward, a great hall, barbicans at both ends',
    // ~100 x 32 m between tower centres, towers ~9 m across and ~21 m high (the four of the inner ward with watch turrets),
    // curtain ~15 m to the wall-walk; the cross-wall between the wards stands at the third pair of towers
    wallHeight: 15, wallThick: 4,
    towers: rowTowers([0, 30, 66, 100], 32, 9, 21, (i) => i >= 2),
    walls: [[0, 1], [1, 2], [2, 3], [3, 7], [7, 6], [6, 5], [5, 4], [4, 0], [2, 6]],
    gates: [
      { a: 0, b: 4, portcullis: true, barbican: 10 },
      { a: 3, b: 7, portcullis: true, barbican: 12 },
      { a: 2, b: 6, portcullis: false, barbican: 0 },
    ],
    halls: [{ x0: 36, x1: 62, z0: 20, z1: 32, h: 9 }],
    gateWidth: 3, gateHeight: 5,
  },
  white_tower: {
    name: 'white_tower',
    description: 'The White Tower of London: a square Norman keep with pilaster buttresses and corner turrets, one round',
    wallHeight: 0, wallThick: 0, towers: [], walls: [], gates: [], halls: [],
    keep: { x: 0, z: 0, w: 36, d: 32, h: 27, t: 4, round: 'ne' },
    gateWidth: 3, gateHeight: 5,
  },
};

/** The castle's stages in the order real castles grew (the note's); a preset's empty ones are left out. */
export const CASTLE_STAGES = [
  'pad and footings', 'keep', 'curtain walls', 'towers', 'gatehouses and barbicans', 'halls and roofs', 'battlements and turrets',
] as const;
const S = { pad: 1, keep: 2, walls: 3, towers: 4, gates: 5, halls: 6, top: 7 } as const;

/** The materials: gothicGen's palette (monument.ts maps it to what the village can make), iron bars for the portcullis. */
const M = {
  floor: 'polished_andesite', wall: 'stone_bricks', plinth: 'tuff_bricks', slab: 'stone_brick_slab', post: 'stone_brick_wall',
  timber: 'deepslate_tiles', tileStair: 'deepslate_tile_stairs', pane: 'glass_pane', bars: 'iron_bars',
};

export type Castle = Cathedral & { stageNames: string[] };

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const STEP4: Array<[number, number, string]> = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];

/** Draw a preset at 1:scale. `opts.jobMin`/`jobMax` set the job size (300/800). */
export function generateCastle(p: CastlePreset, scale: number, opts: { jobMin?: number; jobMax?: number } = {}): Castle {
  const s = (m: number, min = 1) => Math.max(min, Math.round(m / scale));
  const gateW = s(p.gateWidth, 1), gateH = s(p.gateHeight, 3);
  // (the curtain stands above its passages, their portcullis row and a lintel; towers above the curtain)
  const wallH = p.walls.length ? Math.max(s(p.wallHeight), gateH + 2) : 0;
  const thick = s(p.wallThick, 1);
  const towers = p.towers.map((t) => {
    const d = s(t.d, 5);
    return { cx: Math.round(t.x / scale), cz: Math.round(t.z / scale), r: d / 2, t: d >= 8 ? 2 : 1, h: Math.max(s(t.h), wallH + 3), turret: !!t.turret };
  });
  const barbs = p.gates.map((g) => (g.barbican ? s(g.barbican, 3) : 0));
  const keep = p.keep && { x0: Math.round(p.keep.x / scale), z0: Math.round(p.keep.z / scale), w: s(p.keep.w, 7), d: s(p.keep.d, 7), h: s(p.keep.h, 8), t: s(p.keep.t, 1), round: p.keep.round };

  // The grid: everything drawn in plan coordinates first, then shifted so its west and north edges are 0
  const cells = new Map<string, string>();
  const stageOf = new Map<string, number>();
  const set = (x: number, y: number, z: number, b: string, st: number) => { if (y >= 0) { cells.set(key(x, y, z), b); stageOf.set(key(x, y, z), st); } };
  const clear = (x: number, y: number, z: number) => { cells.delete(key(x, y, z)); stageOf.delete(key(x, y, z)); };
  const get = (x: number, y: number, z: number) => cells.get(key(x, y, z));
  /** Set only where nothing stands (halls and barbicans fit round the towers and walls). */
  const setFree = (x: number, y: number, z: number, b: string, st: number) => { if (!cells.has(key(x, y, z))) set(x, y, z, b, st); };

  // 2D masks (plan cells): curtain, tower discs, keep, barbicans
  const mask = new Map<string, 'wall' | 'tower' | 'keep' | 'barb'>();
  const k2 = (x: number, z: number) => `${x},${z}`;
  const wallCells: Array<{ x: number; z: number; seg: number; along: number }> = [];

  // Curtain segments: the cells whose centre lies within the wall's thickness of the line between two tower centres (a
  // ring listed clockwise, west to east along the north)
  p.walls.forEach(([ia, ib], seg) => {
    const A = towers[ia], B = towers[ib];
    const dx = B.cx - A.cx, dz = B.cz - A.cz, len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    for (let x = Math.min(A.cx, B.cx) - thick; x <= Math.max(A.cx, B.cx) + thick; x++)
      for (let z = Math.min(A.cz, B.cz) - thick; z <= Math.max(A.cz, B.cz) + thick; z++) {
        const ax = x - A.cx, az = z - A.cz;
        const along = ax * ux + az * uz, across = -ax * uz + az * ux;
        // (the ring runs clockwise, so +across is inward: the wall thickens into the ward and the towers, centred on its
        // outer face, stand out from it as Conwy's do)
        if (along < 0 || along > len || across < -thick / 2 + 0.01 || across >= thick / 2 + 0.01) continue;
        if (!mask.has(k2(x, z))) { mask.set(k2(x, z), 'wall'); wallCells.push({ x, z, seg, along }); }
      }
  });
  const inDisc = (t: (typeof towers)[number], x: number, z: number, dr = 0) => Math.hypot(x - t.cx, z - t.cz) <= t.r + dr;
  for (const t of towers)
    for (let x = Math.floor(t.cx - t.r); x <= Math.ceil(t.cx + t.r); x++)
      for (let z = Math.floor(t.cz - t.r); z <= Math.ceil(t.cz + t.r); z++) if (inDisc(t, x, z)) mask.set(k2(x, z), 'tower');
  if (keep) for (let x = keep.x0; x < keep.x0 + keep.w; x++) for (let z = keep.z0; z < keep.z0 + keep.d; z++) mask.set(k2(x, z), 'keep');

  // The wards: plan cells inside the ring (not reached from beyond the bounds without crossing a wall or tower)
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const kk of mask.keys()) {
    const [x, z] = kk.split(',').map(Number);
    bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z);
  }
  const outside = new Set<string>();
  {
    let q: Array<[number, number]> = [];
    for (let x = bx0 - 1; x <= bx1 + 1; x++) q.push([x, bz0 - 1], [x, bz1 + 1]);
    for (let z = bz0; z <= bz1; z++) q.push([bx0 - 1, z], [bx1 + 1, z]);
    for (const [x, z] of q) outside.add(k2(x, z));
    while (q.length) {
      const next: Array<[number, number]> = [];
      for (const [x, z] of q)
        for (const [dx, dz] of STEP4) {
          const u = x + dx, v = z + dz;
          if (u < bx0 - 1 || u > bx1 + 1 || v < bz0 - 1 || v > bz1 + 1 || outside.has(k2(u, v)) || mask.has(k2(u, v))) continue;
          outside.add(k2(u, v)); next.push([u, v]);
        }
      q = next;
    }
  }
  const isOut = (x: number, z: number) => outside.has(k2(x, z)) || x < bx0 - 1 || x > bx1 + 1 || z < bz0 - 1 || z > bz1 + 1;
  const ward = (x: number, z: number) => !isOut(x, z) && !mask.has(k2(x, z));

  // Barbicans: a walled forecourt in front of each gate, as wide as the wall between its towers allows (up to ~16 m)
  const barbBoxes: Array<{ x0: number; x1: number; z0: number; z1: number; ox: number; oz: number; gx: number; gz: number } | null> = p.gates.map((g, i) => {
    const depth = barbs[i];
    if (!depth) return null;
    const A = towers[g.a], B = towers[g.b];
    const mx = Math.round((A.cx + B.cx) / 2), mz = Math.round((A.cz + B.cz) / 2);
    // (outward: the side of the gate's wall that is outside)
    const along = A.cx === B.cx ? 'z' : 'x';
    const half = Math.max(gateW + 1, Math.min(s(8, 2), Math.floor((Math.abs(along === 'z' ? B.cz - A.cz : B.cx - A.cx) - 2 * A.r) / 2) - 1));
    let ox = 0, oz = 0;
    if (along === 'z') ox = isOut(mx - Math.ceil(thick / 2) - 1, mz) ? -1 : 1; else oz = isOut(mx, mz - Math.ceil(thick / 2) - 1) ? -1 : 1;
    // (the face of the wall on the outside: the first cell beyond the wall along the outward step)
    let fx = mx, fz = mz;
    while (mask.get(k2(fx, fz)) === 'wall') { fx += ox; fz += oz; }
    const box = along === 'z'
      ? { x0: Math.min(fx, fx + ox * (depth - 1)), x1: Math.max(fx, fx + ox * (depth - 1)), z0: mz - half, z1: mz + half }
      : { x0: mx - half, x1: mx + half, z0: Math.min(fz, fz + oz * (depth - 1)), z1: Math.max(fz, fz + oz * (depth - 1)) };
    for (let x = box.x0; x <= box.x1; x++) for (let z = box.z0; z <= box.z1; z++) if (!mask.has(k2(x, z))) mask.set(k2(x, z), 'barb');
    return { ...box, ox, oz, gx: mx, gz: mz };
  });

  // 1. The pad: every cell of the castle's plan (wards, walls, towers, keep, barbicans) floored at layer 0
  for (const kk of mask.keys()) { const [x, z] = kk.split(',').map(Number); set(x, 0, z, M.floor, S.pad); }
  for (let x = bx0; x <= bx1; x++) for (let z = bz0; z <= bz1; z++) if (ward(x, z)) set(x, 0, z, M.floor, S.pad);

  // 3. Curtain walls: solid to the wall-walk, a plinth course at the foot
  for (const c of wallCells) {
    if (mask.get(k2(c.x, c.z)) !== 'wall') continue;
    for (let y = 1; y <= wallH; y++) set(c.x, y, c.z, y === 1 ? M.plinth : M.wall, S.walls);
  }
  // The wall-walk's battlements: a parapet on the outer face and merlons on every other cell above it (at one block thick,
  // the merlons stand on the wall itself)
  // (the barbicans stand in the outside the flood fill found: a wall's face toward one is still its outer face)
  const outerFace = (x: number, z: number) => STEP4.some(([dx, dz]) => isOut(x + dx, z + dz));
  for (const c of wallCells) {
    if (mask.get(k2(c.x, c.z)) !== 'wall' || !outerFace(c.x, c.z)) continue;
    if (thick > 1) set(c.x, wallH + 1, c.z, M.wall, S.top);
    if ((c.x + c.z) % 2 === 0) set(c.x, wallH + (thick > 1 ? 2 : 1), c.z, M.wall, S.top);
  }

  // 4. Drum towers: the disc's ring from the floor to the top, the inside cleared, timber floors at the wall-walk and
  // halfway up, a top of slabs; doors to the ward and to the wall-walk; slits in the outer face; battlements
  towers.forEach((t) => {
    const ring = (x: number, z: number) => inDisc(t, x, z) && !inDisc(t, x, z, -t.t);
    const xs: number[] = [], zs: number[] = [];
    for (let x = Math.floor(t.cx - t.r); x <= Math.ceil(t.cx + t.r); x++) xs.push(x);
    for (let z = Math.floor(t.cz - t.r); z <= Math.ceil(t.cz + t.r); z++) zs.push(z);
    const floors = [wallH, ...(wallH >= 8 ? [Math.floor(wallH / 2)] : []), ...(t.h - wallH >= 8 ? [wallH + Math.floor((t.h - wallH) / 2)] : [])].filter((y) => y > 2 && y < t.h - 1);
    for (const x of xs)
      for (const z of zs) {
        if (!inDisc(t, x, z)) continue;
        for (let y = 1; y <= t.h; y++) {
          if (ring(x, z)) set(x, y, z, y === 1 ? M.plinth : M.wall, S.towers);
          else if (y === t.h) set(x, y, z, `${M.slab}[type=top]`, S.towers);
          else if (floors.includes(y)) set(x, y, z, M.timber, S.towers);
          else clear(x, y, z);
        }
      }
    // The door to the ward: a 4-connected stair-step path from the centre toward the nearest ward cell, two high
    let target: [number, number] | null = null, best = Infinity;
    for (let x = Math.floor(t.cx - t.r - 3); x <= Math.ceil(t.cx + t.r + 3); x++)
      for (let z = Math.floor(t.cz - t.r - 3); z <= Math.ceil(t.cz + t.r + 3); z++) {
        if (!ward(x, z)) continue;
        const d = Math.hypot(x - t.cx, z - t.cz);
        if (d < best) { best = d; target = [x, z]; }
      }
    if (target) {
      let x = t.cx, z = t.cz;
      for (let n = 0; n < 20 && !(x === target[0] && z === target[1]); n++) {
        const ex = target[0] - x, ez = target[1] - z;
        if (Math.abs(ex) >= Math.abs(ez)) x += Math.sign(ex); else z += Math.sign(ez);
        for (let y = 1; y <= 2; y++) clear(x, y, z);
      }
    }
    // Doors to the wall-walk: a ring cell beside a curtain cell's top, opened two high above it
    for (const x of xs)
      for (const z of zs) {
        if (!ring(x, z)) continue;
        if (STEP4.some(([dx, dz]) => mask.get(k2(x + dx, z + dz)) === 'wall' && get(x + dx, wallH, z + dz))) {
          clear(x, wallH + 1, z); clear(x, wallH + 2, z);
        }
      }
    // Arrow slits: two high, on the outer face, every third cell round, one at each storey above the ground's
    for (const x of xs)
      for (const z of zs) {
        if (!ring(x, z) || !outerFace(x, z)) continue;
        const a = Math.round(((Math.atan2(z - t.cz, x - t.cx) + Math.PI) / (2 * Math.PI)) * Math.round(2 * Math.PI * t.r));
        if (a % 3) continue;
        for (const base of [3, ...floors.map((f) => f + 2)]) if (base + 1 < t.h && base + 1 < (floors.find((f) => f > base) ?? t.h)) { clear(x, base, z); clear(x, base + 1, z); }
      }
    // Battlements on the outer ring, and a watch turret on the side toward the ward
    for (const x of xs)
      for (const z of zs) {
        if (!inDisc(t, x, z) || inDisc(t, x, z, -1)) continue;
        set(x, t.h + 1, z, M.wall, S.top);
        if ((x + z) % 2 === 0) set(x, t.h + 2, z, M.wall, S.top);
      }
    if (t.turret && target) {
      const ux = Math.sign(target[0] - t.cx), uz = Math.sign(target[1] - t.cz);
      const tx = t.cx + Math.round(ux * (t.r - 1.5)), tz = t.cz + Math.round(uz * (t.r - 1.5));
      const th = s(6, 3);
      for (let y = t.h + 1; y <= t.h + th; y++) for (const [dx, dz] of [[0, 0], [ux || 1, 0], [0, uz || 1], [ux || 1, uz || 1]]) set(tx + dx, y, tz + dz, M.wall, S.top);
      for (const [dx, dz] of [[0, 0], [ux || 1, 0], [0, uz || 1], [ux || 1, uz || 1]]) set(tx + dx, t.h + th + 1, tz + dz, M.post, S.top);
    }
  });

  // 5. Gatehouses: the passage through the wall (gateW wide, gateH clear), its portcullis raised in the row above, and
  // the barbican in front (its walls half the curtain's, an opening opposite the gate, a turret at each outer corner)
  p.gates.forEach((g, i) => {
    const A = towers[g.a], B = towers[g.b];
    const mx = Math.round((A.cx + B.cx) / 2), mz = Math.round((A.cz + B.cz) / 2);
    const alongZ = A.cx === B.cx;
    const lo = -Math.floor((gateW - 1) / 2), hi = lo + gateW - 1;
    for (let o = lo; o <= hi; o++) {
      const along = alongZ ? mz + o : mx + o;
      for (const c of wallCells) {
        if ((alongZ ? c.z : c.x) !== along || mask.get(k2(c.x, c.z)) !== 'wall' || (alongZ ? Math.abs(c.x - mx) : Math.abs(c.z - mz)) > thick) continue;
        for (let y = 1; y <= gateH; y++) clear(c.x, y, c.z);
        // (the lintel's row carries the gatehouse's stage, the portcullis hangs in it on the outer face)
        set(c.x, gateH + 1, c.z, g.portcullis && outerFace(c.x, c.z) ? M.bars : M.wall, S.gates);
      }
    }
    const bb = barbBoxes[i];
    if (!bb) return;
    const bh = Math.max(gateH + 1, Math.round(wallH / 2));
    const farX = bb.ox < 0 ? bb.x0 : bb.ox > 0 ? bb.x1 : null, farZ = bb.oz < 0 ? bb.z0 : bb.oz > 0 ? bb.z1 : null;
    for (let x = bb.x0; x <= bb.x1; x++)
      for (let z = bb.z0; z <= bb.z1; z++) {
        if (mask.get(k2(x, z)) !== 'barb') continue;
        const side = alongZ ? (z === bb.z0 || z === bb.z1 || x === farX) : (x === bb.x0 || x === bb.x1 || z === farZ);
        if (!side) continue;
        // (the opening opposite the gate)
        const opening = alongZ ? x === farX && z - bb.gz >= lo && z - bb.gz <= hi : z === farZ && x - bb.gx >= lo && x - bb.gx <= hi;
        for (let y = 1; y <= bh; y++) if (!opening || y > gateH) setFree(x, y, z, y === 1 ? M.plinth : M.wall, S.gates);
        if ((x + z) % 2 === 0) setFree(x, bh + 1, z, M.wall, S.top);
      }
    // Corner turrets: solid 2 x 2 posts at the far corners, above the barbican's walls
    const corners = alongZ ? [[farX!, bb.z0], [farX!, bb.z1]] : [[bb.x0, farZ!], [bb.x1, farZ!]];
    for (const [cx, cz] of corners)
      for (const [dx, dz] of [[0, 0], [alongZ ? -bb.ox : 0, alongZ ? 0 : -bb.oz], [alongZ ? 0 : (cx === bb.x0 ? 1 : -1), alongZ ? (cz === bb.z0 ? 1 : -1) : 0]]) {
        for (let y = 1; y <= bh + 2; y++) set(cx + dx, y, cz + dz, y === 1 ? M.plinth : M.wall, S.gates);
        set(cx + dx, bh + 3, cz + dz, M.post, S.top);
      }
  });

  // 6. Halls against a curtain: the free sides walled to its eaves, the gable ends to the roof, a door and windows on the
  // ward's side, a timber roof whose ridge runs along the hall and whose stairs face uphill
  for (const hp of p.halls) {
    let x0 = Math.round(hp.x0 / scale), x1 = Math.round(hp.x1 / scale), z0 = Math.round(hp.z0 / scale), z1 = Math.round(hp.z1 / scale);
    // (the box shrunk to ward cells: off the curtain, the towers and the cross-walls)
    while (x0 <= x1 && [...Array(z1 - z0 + 1).keys()].some((i) => !ward(x0, z0 + i) && mask.get(k2(x0, z0 + i)) !== 'wall')) x0++;
    while (x1 >= x0 && [...Array(z1 - z0 + 1).keys()].some((i) => !ward(x1, z0 + i) && mask.get(k2(x1, z0 + i)) !== 'wall')) x1--;
    const rowsWard = (z: number) => [...Array(x1 - x0 + 1).keys()].every((i) => ward(x0 + i, z));
    while (z1 >= z0 && !rowsWard(z1)) z1--;
    while (z0 <= z1 && !rowsWard(z0)) z0++;
    // (a tower's disc reaching in: the hall keeps a cell off it)
    const nearTower = (x: number, z: number) => towers.some((t) => inDisc(t, x, z, 1));
    while (x0 <= x1 && [...Array(z1 - z0 + 1).keys()].some((i) => nearTower(x0, z0 + i))) x0++;
    while (x1 >= x0 && [...Array(z1 - z0 + 1).keys()].some((i) => nearTower(x1, z0 + i))) x1--;
    if (x1 - x0 < 4 || z1 - z0 < 3) continue;
    // The curtain is on the side whose next row is wall; the hall's wall on the other
    const southCurtain = [...Array(x1 - x0 + 1).keys()].some((i) => mask.get(k2(x0 + i, z1 + 1)) === 'wall');
    const hh = Math.max(4, s(hp.h, 4));
    const zw = southCurtain ? z0 : z1; // the hall's long wall toward the ward
    const width = z1 - z0 + 1;
    const dz = (z: number) => Math.min(z - z0, z1 - z);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const end = x === x0 || x === x1;
        if (end) for (let y = 1; y <= hh + dz(z); y++) setFree(x, y, z, y === 1 ? M.plinth : M.wall, S.halls);
        else if (z === zw) for (let y = 1; y <= hh; y++) setFree(x, y, z, y === 1 ? M.plinth : M.wall, S.halls);
        else if (z === (southCurtain ? z1 : z0)) { /* (the curtain's side: open to it) */ }
        // The roof: rows rising from both eaves to the ridge (a full block on an odd width's middle row)
        const d = dz(z), mid = width % 2 === 1 && d === (width - 1) / 2;
        const facing = z - z0 < z1 - z ? 'south' : 'north';
        setFree(x, hh + 1 + d, z, mid ? M.timber : `${M.tileStair}[facing=${facing},half=bottom]`, S.halls);
      }
    // The door (two high, in the long wall's middle) and windows (every third cell, away from the door and the ends)
    const xm = Math.round((x0 + x1) / 2);
    for (let x = x0 + 2; x <= x1 - 2; x++) {
      if (Math.abs(x - xm) <= 1) continue;
      if ((x - x0) % 3 === 0) for (let y = 2; y <= hh - 1; y++) if (get(x, y, zw) === M.wall) set(x, y, zw, M.pane, S.halls);
    }
    for (let y = 1; y <= 2; y++) clear(xm, y, zw);
  }

  // 2. The keep: walls of thickness t, pilaster buttresses a block proud, corner turrets rising above the battlements
  // (one round), timber floors every ~5, windows between the pilasters, a door in the west face, a slab roof
  if (keep) {
    const { x0, z0, w, d, h, t } = keep;
    const xe = x0 + w - 1, ze = z0 + d - 1;
    const storey = Math.max(4, Math.round(h / Math.max(2, Math.round(h / 5))));
    const floors: number[] = [];
    for (let y = storey; y < h - 1; y += storey) floors.push(y);
    const edge = (x: number, z: number) => Math.min(x - x0, xe - x, z - z0, ze - z);
    for (let x = x0; x <= xe; x++)
      for (let z = z0; z <= ze; z++)
        for (let y = 1; y <= h; y++) {
          if (edge(x, z) < t) set(x, y, z, y === 1 ? M.plinth : M.wall, S.keep);
          else if (y === h) set(x, y, z, `${M.slab}[type=top]`, S.keep);
          else if (floors.includes(y)) set(x, y, z, M.timber, S.keep);
        }
    // Pilasters: on each face every ~4, a block proud, full height (not at the door)
    const pitch = Math.max(3, s(8, 3));
    for (let x = x0 + pitch; x < xe - 1; x += pitch) for (const z of [z0 - 1, ze + 1]) for (let y = 1; y <= h; y++) set(x, y, z, M.wall, S.keep);
    const zDoor = Math.round((z0 + ze) / 2);
    for (let z = z0 + pitch; z < ze - 1; z += pitch) for (const x of [x0 - 1, xe + 1]) if (!(x < x0 && (z === zDoor || z === zDoor + 1))) for (let y = 1; y <= h; y++) set(x, y, z, M.wall, S.keep);
    // Windows: two high on each storey, midway between pilasters, through the wall
    const winRow = (y0: number) => y0 + 2;
    for (const base of [0, ...floors]) {
      const y = winRow(base);
      if (y + 1 >= (floors.find((f) => f > base) ?? h)) continue;
      // (a pane in the outer face, the embrasure behind it open)
      const win = (x: number, yy: number, z: number, n: number) => { if (n === 0) set(x, yy, z, M.pane, S.keep); else clear(x, yy, z); };
      for (let x = x0 + Math.floor(pitch / 2); x < xe; x += pitch) for (let n = 0; n < t; n++) for (const z of [z0 + n, ze - n]) for (const yy of [y, y + 1]) win(x, yy, z, n);
      for (let z = z0 + Math.floor(pitch / 2); z < ze; z += pitch) for (let n = 0; n < t; n++) for (const x of [x0 + n, xe - n]) for (const yy of [y, y + 1]) win(x, yy, z, n);
    }
    // The door: the west face's middle, through the wall, three high
    for (let n = 0; n < t; n++) for (let y = 1; y <= 3; y++) for (const z of [zDoor, zDoor + 1]) clear(x0 + n, y, z);
    // Battlements and corner turrets
    for (let x = x0; x <= xe; x++)
      for (let z = z0; z <= ze; z++) {
        if (edge(x, z) !== 0) continue;
        set(x, h + 1, z, M.wall, S.top);
        if ((x + z) % 2 === 0) set(x, h + 2, z, M.wall, S.top);
      }
    const tw = Math.max(2, s(6, 2)), th = s(5, 3);
    const corners: Array<[string, number, number]> = [['nw', x0, z0], ['ne', xe - tw + 1, z0], ['sw', x0, ze - tw + 1], ['se', xe - tw + 1, ze - tw + 1]];
    for (const [name, cx, cz] of corners) {
      const round = keep.round === name;
      const r = tw / 2, ccx = cx + (tw - 1) / 2, ccz = cz + (tw - 1) / 2;
      for (let x = cx - (round ? 1 : 0); x < cx + tw + (round ? 1 : 0); x++)
        for (let z = cz - (round ? 1 : 0); z < cz + tw + (round ? 1 : 0); z++) {
          if (round && Math.hypot(x - ccx, z - ccz) > r + 0.6) continue;
          for (let y = h + 1; y <= h + th; y++) set(x, y, z, M.wall, S.top);
          if ((x + z) % 2 === 0) set(x, h + th + 1, z, M.wall, S.top);
        }
    }
  }

  // Shift to the grid: the west and north edges at 0
  let gx0 = Infinity, gz0 = Infinity;
  for (const kk of cells.keys()) { const [x, , z] = kk.split(',').map(Number); gx0 = Math.min(gx0, x); gz0 = Math.min(gz0, z); }
  const shifted = new Map<string, string>(), shiftedStage = new Map<string, number>();
  let W = 0, D = 0;
  for (const [kk, b] of cells) {
    const [x, y, z] = kk.split(',').map(Number);
    const nk = key(x - gx0, y, z - gz0);
    shifted.set(nk, b); shiftedStage.set(nk, stageOf.get(kk)!);
    W = Math.max(W, x - gx0 + 1); D = Math.max(D, z - gz0 + 1);
  }
  // The stages a preset has parts for, numbered from 1
  const used = [...new Set(shiftedStage.values())].sort((a, b) => a - b);
  const renum = new Map(used.map((st, i) => [st, i + 1]));
  for (const [kk, st] of shiftedStage) shiftedStage.set(kk, renum.get(st)!);
  const stageNames = used.map((st) => CASTLE_STAGES[st - 1]);
  return finish(p, scale, shifted, shiftedStage, W, D, stageNames, opts);
}

/** The item a block costs: its name without states. */
export const castleItem = (block: string) => block.replace(/\[.*\]$/, '');

function finish(p: CastlePreset, scale: number, cells: Map<string, string>, stageOf: Map<string, number>, W: number, D: number,
  stageNames: string[], opts: { jobMin?: number; jobMax?: number }): Castle {
  let H = 0;
  for (const kk of cells.keys()) H = Math.max(H, Number(kk.split(',')[1]) + 1);
  const blocks = [...new Set(cells.values())].sort();
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+-=<>?@!~^:;,(){}[]|/';
  if (blocks.length > CHARS.length) throw new Error(`castleGen: ${blocks.length} blocks, more than the palette holds`);
  const charOf = new Map(blocks.map((b, i) => [b, CHARS[i]]));
  const palette: Record<string, string> = Object.fromEntries(blocks.map((b) => [charOf.get(b)!, b]));
  const layers: string[][] = [];
  for (let y = 0; y < H; y++) {
    const rows: string[] = [];
    for (let z = 0; z < D; z++) {
      let row = '';
      for (let x = 0; x < W; x++) { const b = cells.get(key(x, y, z)); row += b ? charOf.get(b)! : '.'; }
      rows.push(row);
    }
    layers.push(rows);
  }
  const bill: Record<string, number> = {};
  const stages = new Array(stageNames.length).fill(0);
  for (const [kk, b] of cells) {
    bill[castleItem(b)] = (bill[castleItem(b)] ?? 0) + 1;
    stages[stageOf.get(kk)! - 1]++;
  }
  const design: Design = {
    name: `${p.name}_1_${scale}`.slice(0, 32), description: `${p.description} (1:${scale})`.slice(0, 200),
    palette, layers, width: W, depth: D, height: H, blocks: cells.size, by: 'castleGen',
  };
  const cellJob = new Map<string, number>();
  const jobs = cutJobs(cells, stageOf, stageNames.length, opts.jobMin ?? 300, opts.jobMax ?? 800, cellJob);
  return { design, scale, stages, jobs, bill, cellStage: stageOf, cellJob, stageNames };
}

/** Each stage's cells cut into jobs as gothicGen cuts the cathedral's: whole x slices west to east until a job holds
 *  jobMin; a slice larger than jobMax is cut into bands of layers. The last job of a stage may be smaller. */
function cutJobs(cells: Map<string, string>, stageOf: Map<string, number>, nStages: number, jobMin: number, jobMax: number, cellJob: Map<string, number>): GothicJob[] {
  const jobs: GothicJob[] = [];
  for (let st = 1; st <= nStages; st++) {
    const bySlice = new Map<number, Array<[number, number, number, string]>>();
    for (const [kk, b] of cells) {
      if (stageOf.get(kk) !== st) continue;
      const [x, y, z] = kk.split(',').map(Number);
      (bySlice.get(x) ?? bySlice.set(x, []).get(x)!).push([x, y, z, b]);
    }
    let cur: Array<[number, number, number, string]> = [];
    let index = 0;
    const flush = () => {
      if (!cur.length) return;
      const j: GothicJob = { stage: st, index: index++, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity, blocks: cur.length, bill: {} };
      for (const [x, y, z, b] of cur) {
        j.x0 = Math.min(j.x0, x); j.x1 = Math.max(j.x1, x); j.y0 = Math.min(j.y0, y); j.y1 = Math.max(j.y1, y);
        j.z0 = Math.min(j.z0, z); j.z1 = Math.max(j.z1, z);
        j.bill[castleItem(b)] = (j.bill[castleItem(b)] ?? 0) + 1;
        cellJob.set(key(x, y, z), jobs.length);
      }
      jobs.push(j); cur = [];
    };
    for (const x of [...bySlice.keys()].sort((a, b) => a - b)) {
      const slice = bySlice.get(x)!;
      if (slice.length > jobMax) {
        flush();
        slice.sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < slice.length; i += jobMax) { cur = slice.slice(i, i + jobMax); flush(); }
        continue;
      }
      if (cur.length + slice.length > jobMax && cur.length >= jobMin) flush();
      cur.push(...slice);
      if (cur.length >= jobMin) flush();
    }
    flush();
  }
  return jobs;
}
