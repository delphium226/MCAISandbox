/**
 * A Gothic cathedral drawn by code (the monument, M0; runs/2026-10-25/monument/report.md, route B): a split grammar of
 * parametrised parts (west front with towers, portals and a rose; nave bays with aisles, arcade, triforium, clerestory,
 * buttresses and flyers; a crossing with nothing, a flèche or a tower and spire; transept arms; an apse with its
 * ambulatory), each a function of the scale, the bay pitch, the vault height and the materials. Presets give a real
 * cathedral's measures in metres (1 m = 1 block at 1:1); the scale divides them. Code draws every cell, so the bill is
 * exact (lesson 1); a model chooses only the preset and its parameters.
 *
 * The plan is worked out on a 2D mask first (outside, low: aisles and ambulatory, high: nave, choir, transept, apse),
 * whose edges become walls: a high cell beside a low one is an arcade (piers, arches, triforium, clerestory), a high or
 * low cell beside the outside an outer wall. Roofs and vaults are height fields from the walls (Chebyshev distance), so
 * every roof stair faces uphill and the crossing and apse join without special cases; gable ends (the west front, the
 * transept ends) are left out of the roof's distance so the ridge runs into them. The long axis runs west to east (x),
 * the west front at x = 0 and the apse at the east, as real cathedrals face.
 *
 * Output: a Design (layers bottom-up, rows north to south, west to east; '.' air) and the cells split into the
 * report's eight stages, each cut into jobs of about 300-800 blocks by x slices (M1 hands them out; jobDesign gives a
 * job as a Design with '_' everywhere else). World-independent, like buildingGen.ts; not wired into the game yet.
 */
import type { Design } from './village';

/** A cathedral's measures in metres (1:1) and its parts. */
export interface GothicPreset {
  name: string;
  description: string;
  /** West front to the end of the apse. */
  length: number;
  /** Bay pitch along the nave. */
  bay: number;
  /** Inner width of the nave, of one aisle (a double aisle counts as one wide one), a buttress's depth. */
  nave: number;
  aisle: number;
  buttress: number;
  /** The nave's vault top and the aisles' wall height. */
  vault: number;
  aisleHeight: number;
  /** Transept: the bay it starts at (from the west front), its width in bays, how far each arm reaches past the aisles. */
  transeptBay: number;
  transeptBays: number;
  transeptArm: number;
  /** West towers: 0, 1 (over the west front's middle) or 2; their height and each one's spire above it (0: none). */
  towers: 0 | 1 | 2;
  towerHeight: number;
  spires: number[];
  /** The crossing: nothing, a slim flèche above the ridge, or a tower (crossingHeight) with a spire. */
  crossing: 'none' | 'fleche' | 'tower';
  crossingHeight: number;
  crossingSpire: number;
  /** The west rose's diameter; transept ends get one of the same size when they are wide enough. */
  rose: number;
}

export const GOTHIC_PRESETS: Record<string, GothicPreset> = {
  notre_dame: {
    name: 'notre_dame', description: 'Notre-Dame de Paris: twin-towered west front, three roses, flying buttresses, a flèche',
    length: 128, bay: 7, nave: 12, aisle: 10, buttress: 4, vault: 33, aisleHeight: 10,
    transeptBay: 10, transeptBays: 2, transeptArm: 4,
    towers: 2, towerHeight: 69, spires: [0, 0], crossing: 'fleche', crossingHeight: 0, crossingSpire: 50, rose: 10,
  },
  salisbury: {
    name: 'salisbury', description: 'Salisbury: a long low nave, a deep transept and the tallest spire, over the crossing',
    length: 135, bay: 6, nave: 10, aisle: 6, buttress: 3, vault: 26, aisleHeight: 12,
    transeptBay: 9, transeptBays: 2, transeptArm: 18,
    towers: 0, towerHeight: 0, spires: [], crossing: 'tower', crossingHeight: 60, crossingSpire: 63, rose: 0,
  },
  chartres: {
    name: 'chartres', description: 'Chartres: a tall vault, much glass, two unlike spires on the west towers',
    length: 130, bay: 7, nave: 14, aisle: 8, buttress: 4, vault: 37, aisleHeight: 14,
    transeptBay: 9, transeptBays: 2, transeptArm: 16,
    towers: 2, towerHeight: 60, spires: [45, 53], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 13,
  },
};

/** The materials (the default palette, the user's 10-25: stone bricks toned with andesite and tuff, a deepslate roof). */
const M = {
  floor: 'polished_andesite', wall: 'stone_bricks', pier: 'stone_bricks', rib: 'polished_andesite', vault: 'stone_bricks',
  tone: 'tuff_bricks', tile: 'deepslate_tiles', tileStair: 'deepslate_tile_stairs', tileSlab: 'deepslate_tile_slab',
  stair: 'stone_brick_stairs', post: 'stone_brick_wall', slab: 'stone_brick_slab',
  pane: 'glass_pane', blue: 'blue_stained_glass_pane', red: 'red_stained_glass_pane', yellow: 'yellow_stained_glass_pane',
};

export const GOTHIC_STAGES = [
  'pad and floor', 'aisle walls and west-front base', 'piers and arcade', 'clerestory and buttresses',
  'vault and roof', 'towers', 'glass and rose', 'spires and pinnacles',
] as const;

export interface GothicJob {
  /** 1-8, GOTHIC_STAGES[stage - 1]. */
  stage: number;
  index: number;
  /** The job's box in the design's grid (x west to east, y layers, z north to south), inclusive. */
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  blocks: number;
  bill: Record<string, number>;
}

export interface Cathedral {
  design: Design;
  scale: number;
  /** Blocks of each stage (index 0 = stage 1). */
  stages: number[];
  jobs: GothicJob[];
  bill: Record<string, number>;
  /** Grid cell (x,y,z) -> stage, and -> its job's index in `jobs`. */
  cellStage: Map<string, number>;
  cellJob: Map<string, number>;
}

/** The item a block costs: its name without states (stained panes, tiles and bricks are items of their own). */
export const gothicItem = (block: string) => block.replace(/\[.*\]$/, '');

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const STEP4: Array<[number, number, string]> = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];

/** Draw a preset at 1:scale. `opts.jobMin`/`jobMax` set the job size (300/800). */
export function generateCathedral(p: GothicPreset, scale: number, opts: { jobMin?: number; jobMax?: number } = {}): Cathedral {
  const s = (m: number, min = 1) => Math.max(min, Math.round(m / scale));
  const odd = (n: number) => (n % 2 ? n : n + 1);
  const pitch = s(p.bay, 3);
  const nave = odd(s(p.nave, 3));
  const aisle = s(p.aisle, 2);
  const butW = s(p.buttress, 1);
  const Hv = s(p.vault, 7);
  const Ha = Math.min(s(p.aisleHeight, 3), Hv - 4);
  const arm = p.transeptArm ? s(p.transeptArm, 1) : 0;
  const k = (nave - 1) / 2;
  // z: [margin][aisle wall][aisle][pier line][nave][pier line][aisle][aisle wall][margin]; the margin holds buttresses
  // and the transept arms
  const zOff = Math.max(butW, arm);
  const zA = zOff, zP = zA + aisle + 1, zP2 = zP + nave + 1, zA2 = zP2 + aisle + 1;
  const D = zA2 + zOff + 1;
  const zc = (D - 1) / 2;
  const rI = k + 1, rO = rI + aisle + 1;
  const bays = Math.max(4, Math.floor((s(p.length, 20) - rO - 1) / pitch));
  const xe = bays * pitch;
  const W = xe + rO + butW + 2;
  const tb = Math.min(Math.max(1, Math.round(p.transeptBay * p.bay / scale / pitch)), bays - p.transeptBays - 1);
  const xt0 = tb * pitch, xt1 = (tb + p.transeptBays) * pitch;
  const zN = zA - arm, zS = zA2 + arm;
  const towerH = p.towers ? Math.max(s(p.towerHeight), Hv + 4) : 0;
  const tS = zP - (zA - butW) + 1; // a west tower's side: buttress, aisle wall, aisle, pier line

  // The plan: 0 outside, 1 low, 2 high
  const plan: number[][] = Array.from({ length: W }, () => new Array(D).fill(0));
  const apseD = (x: number, z: number) => Math.hypot(x - xe, z - zc);
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      if (x <= xe && z >= zA && z <= zA2) plan[x][z] = z >= zP && z <= zP2 ? 2 : 1;
      else if (x > xe && apseD(x, z) < rO + 0.5) plan[x][z] = apseD(x, z) < rI + 0.5 ? 2 : 1;
      if (arm && x >= xt0 && x <= xt1 && z >= zN && z <= zS) plan[x][z] = 2;
    }
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= W || z >= D ? 0 : plan[x][z]);
  const touches = (x: number, z: number, v: number) => STEP4.some(([dx, dz]) => at(x + dx, z + dz) === v);
  const inTower = (x: number, z: number) =>
    p.towers === 2 ? x < tS && ((z >= zA - butW && z <= zP) || (z >= zP2 && z <= zA2 + butW))
    : p.towers === 1 ? x < tS && z >= zP - 1 && z <= zP2 + 1 : false;
  // Gable ends: the west front's high wall and the transept arms' end walls
  const gable = (x: number, z: number) => at(x, z) === 2 && ((x === 0) || (arm > 0 && (z === zN || z === zS) && x >= xt0 && x <= xt1));

  const cells = new Map<string, string>();
  const stageOf = new Map<string, number>();
  const set = (x: number, y: number, z: number, b: string, st: number) => {
    if (x < 0 || z < 0 || x >= W || z >= D || y < 0) return;
    cells.set(key(x, y, z), b); stageOf.set(key(x, y, z), st);
  };
  const clear = (x: number, y: number, z: number) => { cells.delete(key(x, y, z)); stageOf.delete(key(x, y, z)); };
  const has = (x: number, y: number, z: number) => cells.has(key(x, y, z));

  // Chebyshev distance fields from the walls, over the high and the low plan
  const field = (inside: (x: number, z: number) => boolean, source: (x: number, z: number) => boolean) => {
    const d: number[][] = Array.from({ length: W }, () => new Array(D).fill(-1));
    let q: Array<[number, number]> = [];
    for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) if (inside(x, z) && source(x, z)) { d[x][z] = 0; q.push([x, z]); }
    while (q.length) {
      const next: Array<[number, number]> = [];
      for (const [x, z] of q)
        for (let dx = -1; dx <= 1; dx++)
          for (let dz = -1; dz <= 1; dz++) {
            const u = x + dx, v = z + dz;
            if (u < 0 || v < 0 || u >= W || v >= D || d[u][v] >= 0 || !inside(u, v)) continue;
            d[u][v] = d[x][z] + 1; next.push([u, v]);
          }
      q = next;
    }
    return d;
  };
  const isHigh = (x: number, z: number) => at(x, z) === 2;
  const isLow = (x: number, z: number) => at(x, z) === 1;
  const hWall = (x: number, z: number) => isHigh(x, z) && STEP4.some(([dx, dz]) => at(x + dx, z + dz) !== 2);
  const lWall = (x: number, z: number) => isLow(x, z) && touches(x, z, 0);
  const highRoof = field(isHigh, (x, z) => hWall(x, z) && !gable(x, z));
  const highIn = field(isHigh, hWall);
  const lowRoof = field(isLow, lWall);
  const roofHigh = (x: number, z: number) => Hv + 1 + highRoof[x][z];
  const roofLow = (x: number, z: number) => Ha + 1 + lowRoof[x][z];

  // Along a wall: the coordinate its bays are counted in (x along the side walls, z along the end walls, the arc in
  // the apse), and its windows: piers at the bay lines, the openings between (a margin each side when the bay is wide)
  const along = (x: number, z: number) => {
    if (x > xe) return Math.round(Math.atan2(z - zc, x - xe) * Math.hypot(x - xe, z - zc));
    const xSide = STEP4.some(([dx, dz]) => dz === 0 && at(x + dx, z) !== at(x, z));
    const zSide = STEP4.some(([dx, dz]) => dx === 0 && at(x, z + dz) !== at(x, z));
    if (xSide && zSide) return 0; // a corner: a pier
    return xSide ? z - zc + 1000 * pitch : x;
  };
  const winCol = (t: number) => {
    const m = ((t % pitch) + pitch) % pitch;
    if (m === 0) return 0;
    if (pitch >= 5 && (m === 1 || m === pitch - 1)) return 0;
    return pitch >= 6 && (m === 2 || m === pitch - 2) ? 1 : 2; // 1: the shoulder of a pointed head
  };
  const glassFor = (y: number, x: number) => ((y + x) % 5 === 0 ? M.red : M.blue);

  // 1. Pad and floor
  for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) if (at(x, z)) set(x, 0, z, M.floor, 1);

  // 2-4. Walls: outer low walls, outer high walls, arcades
  const arcH = Math.max(2, Ha - 2);
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      const t = along(x, z), w = winCol(t);
      if (lWall(x, z)) {
        for (let y = 1; y <= Ha; y++) set(x, y, z, y === 1 ? M.tone : M.wall, 2);
        const lo = 2, hi = Ha <= 5 ? Ha - 1 : Ha - 2 - (w === 1 ? 1 : 0);
        if (w) for (let y = lo; y <= hi; y++) set(x, y, z, M.pane, 7);
      } else if (hWall(x, z)) {
        const outer = STEP4.some(([dx, dz]) => at(x + dx, z + dz) === 0);
        // (the west front between the towers is a screen up to its gallery, as Notre-Dame's, hiding the roof's end)
        const screen = x === 0 && p.towers === 2 ? Math.round(towerH * 0.65) : 0;
        const top = gable(x, z) ? Math.max(roofHigh(x, z) - 1, screen) : Hv;
        for (let y = 1; y <= top; y++) set(x, y, z, y === 1 ? M.tone : M.wall, y <= Ha ? (outer ? 2 : 3) : 4);
        if (outer) {
          if (w && !gable(x, z)) for (let y = 2; y <= Hv - 3 - (w === 1 ? 1 : 0); y++) set(x, y, z, glassFor(y, x), 7);
        } else if (w || winCol(t) === 0 && ((t % pitch) + pitch) % pitch !== 0) {
          // Arcade: pointed arches below, a triforium band, the clerestory above the aisle roof
          for (let y = 1; y <= arcH - (w === 1 ? 1 : 0); y++) clear(x, y, z);
          if (w && ((t % 2) + 2) % 2 === 1) clear(x, Ha, z);
          const lowN = STEP4.map(([dx, dz]) => [x + dx, z + dz]).find(([u, v]) => isLow(u, v));
          const roofAt = lowN ? roofLow(lowN[0], lowN[1]) : Ha + 1;
          if (w) for (let y = roofAt + 1; y <= Hv - 2 - (w === 1 ? 1 : 0); y++) set(x, y, z, glassFor(y, x), 7);
        }
      }
    }

  // Portals: the west front's middle, each transept end, the apse's east; the towers add their own
  const ph = Math.max(3, Math.round(Hv * 0.3)), pw = nave >= 7 ? 1 : 0;
  const portal = (cx: number, cz: number, alongX: boolean, half: number, h: number) => {
    for (let o = -half; o <= half; o++)
      for (let y = 1; y <= h - (Math.abs(o) === half && half > 0 ? 1 : 0); y++) clear(alongX ? cx + o : cx, y, alongX ? cz : cz + o);
  };
  portal(0, zc, false, pw, ph);
  if (arm) {
    const cx = Math.round((xt0 + xt1) / 2);
    portal(cx, zN, true, pw, ph); portal(cx, zS, true, pw, ph);
  }
  portal(xe + rO, zc, false, 0, Math.min(Ha, 3));

  // Roses: a disc of stained panes in a wall's plane, tracery on the spokes of the larger ones
  const rose = (cx: number, cz: number, alongX: boolean, cy: number, r: number) => {
    for (let a = -r; a <= r; a++)
      for (let b = -r; b <= r; b++) {
        const d = Math.hypot(a, b);
        if (d > r + 0.3) continue;
        const block = d < 0.8 ? M.yellow : r >= 3 && d < r - 0.5 && (a === 0 || b === 0 || Math.abs(a) === Math.abs(b)) ? M.post
          : d > r - 0.7 ? M.red : M.blue;
        set(alongX ? cx + a : cx, cy + b, alongX ? cz : cz + a, block, block === M.post ? 7 : 7);
      }
  };
  const roseR = Math.max(1, Math.min(k, Math.floor(s(p.rose || p.nave * 0.6) / 2)));
  const roseY = Math.min(Hv - roseR - 1, Math.max(ph + roseR + 2, Math.round(Hv * 0.62)));
  if (p.rose) rose(0, zc, false, roseY, roseR);
  // The gallery: a parapet of posts along the screen's top
  if (p.towers === 2) for (let z = zP + 1; z < zP2; z++) set(0, Math.max(roofHigh(0, z) - 1, Math.round(towerH * 0.65)) + 1, z, M.post, 8);
  if (p.rose && arm && xt1 - xt0 - 1 >= 2 * roseR + 1) {
    const cx = Math.round((xt0 + xt1) / 2);
    rose(cx, zN, true, roseY, roseR); rose(cx, zS, true, roseY, roseR);
  }

  // Buttresses and flyers on every bay line of the nave and choir (not at the towers or the transept)
  const tower0 = p.towers ? tS : 0;
  for (let i = 0; i <= bays; i++) {
    const x = i * pitch;
    if (x < tower0 || (arm && x >= xt0 && x <= xt1)) continue;
    for (const side of [-1, 1]) {
      const wallZ = side < 0 ? zA : zA2, archZ = side < 0 ? zP : zP2;
      for (let j = 1; j <= butW; j++) {
        const z = wallZ + side * j, top = Ha + 2 - (j - 1);
        for (let y = 1; y < top; y++) set(x, y, z, M.wall, 4);
        set(x, top, z, `${M.stair}[facing=${side < 0 ? 'south' : 'north'},half=bottom]`, 4);
        if (j === butW) { set(x, top + 1, z, M.post, 8); set(x, top + 2, z, M.post, 8); }
      }
      // The flyer: from over the aisle wall up to the clerestory, always above the aisle roof
      let prev = -1;
      for (let z = wallZ, n = 0; z !== archZ; z -= side, n++) {
        const f = n / Math.max(1, aisle + 1);
        const y = Math.max(roofLow(x, z) + 1, Math.round(Ha + 3 + f * (Hv - 3 - (Ha + 3))));
        const from = prev < 0 ? y : Math.min(y, prev + 1);
        for (let yy = from; yy <= y; yy++) set(x, yy, z, M.wall, 4);
        prev = y;
      }
    }
  }

  // 5. Vaults and roofs
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      if (!isHigh(x, z) || hWall(x, z)) continue;
      // A pointed arch across the narrow way: steep by the walls, the apex at the vault's top
      const dmax = k + 1, d = Math.min(highIn[x][z], dmax), rise = dmax + 1;
      const v = (dd: number) => Hv - rise + Math.round(rise * Math.sqrt(Math.max(0, 4 - (2 - Math.min(dd, dmax) / dmax) ** 2)) / Math.sqrt(3));
      const y = v(d);
      let lo = y;
      for (const [dx, dz] of STEP4) {
        const u = x + dx, w = z + dz;
        if (isHigh(u, w) && !hWall(u, w)) lo = Math.min(lo, v(highIn[u][w]) + 1);
      }
      const rib = (x <= xe && x % pitch === 0) || (x > xe && Math.abs(along(x, z)) % pitch === 0);
      for (let yy = Math.min(lo, y); yy <= y; yy++) set(x, yy, z, rib ? M.rib : M.vault, 5);
    }
  const roofCell = (x: number, z: number, h: (u: number, v: number) => number, inside: (u: number, v: number) => boolean) => {
    const me = h(x, z);
    let best: string | null = null, bestH = me;
    for (const [dx, dz, f] of STEP4) {
      const u = x + dx, v = z + dz;
      if (!inside(u, v)) continue;
      const hn = h(u, v);
      if (hn > bestH) { bestH = hn; best = f; }
    }
    return best ? `${M.tileStair}[facing=${best},half=bottom]` : M.tile;
  };
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      // (not over the west screen, which stands above the roof's end)
      if (isHigh(x, z)) { if (!(x === 0 && p.towers === 2)) set(x, roofHigh(x, z), z, roofCell(x, z, roofHigh, isHigh), 5); }
      else if (isLow(x, z)) {
        // The lean-to rises to the high wall, which it meets below the clerestory
        const y = roofLow(x, z);
        const block = roofCell(x, z, roofLow, isLow);
        const up = STEP4.find(([dx, dz]) => isHigh(x + dx, z + dz));
        set(x, y, z, up && block === M.tile ? `${M.tileStair}[facing=${up[2]},half=bottom]` : block, 5);
      }
    }

  // 6. West towers: the footprint cleared above the floor, a shell with arches at the foot, belfry openings, a parapet
  const towerBoxes: Array<[number, number, number, number]> = [];
  if (p.towers === 2) towerBoxes.push([0, tS - 1, zA - butW, zP], [0, tS - 1, zP2, zA2 + butW]);
  if (p.towers === 1) towerBoxes.push([0, tS - 1, zP - 1, zP2 + 1]);
  const shellTower = (bx: [number, number, number, number], y0: number, y1: number, spire: number, foot: boolean) => {
    const [x0, x1, z0, z1] = bx;
    for (const kk of [...cells.keys()]) {
      const [x, y, z] = kk.split(',').map(Number);
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && y >= y0 && (y > 0 || !foot)) cells.delete(kk), stageOf.delete(kk);
    }
    const cxT = (x0 + x1) / 2, czT = (z0 + z1) / 2;
    const belfry = y1 - Math.max(3, Math.round((y1 - y0) * 0.25));
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1;
        if (foot && !edge) continue;
        if (!edge) { set(x, y1 - 1, z, M.slab + '[type=top]', 6); continue; }
        for (let y = y0; y < y1; y++) set(x, y, z, y === y0 && foot ? M.tone : M.wall, y <= Ha && foot ? 2 : 6);
        const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
        if (!corner && ((x + z) % 2 === 0)) set(x, y1, z, M.post, 6);
        if (corner) set(x, y1, z, M.post, 6);
        // Belfry openings: two tall slits in each face, away from the corners
        const off = x === x0 || x === x1 ? Math.abs(z - czT) : Math.abs(x - cxT);
        const halfSide = (x === x0 || x === x1 ? z1 - z0 : x1 - x0) / 2;
        if (!corner && off >= 1 && off <= halfSide - 1.5) for (let y = belfry; y < y1 - 2; y++) clear(x, y, z);
      }
    if (!foot) for (let x = x0 + 1; x < x1; x++) for (let z = z0 + 1; z < z1; z++) set(x, y1 - 1, z, M.slab + '[type=top]', 6);
    if (spire > 0) drawSpire(cxT, czT, (Math.min(x1 - x0, z1 - z0)) / 2, y1, spire);
  };
  const drawSpire = (cx: number, cz: number, r0: number, y0: number, h: number) => {
    for (let i = 0; i < h; i++) {
      const r = r0 * (1 - i / h);
      const inO = (x: number, z: number) => Math.abs(x - cx) <= r && Math.abs(z - cz) <= r && Math.abs(x - cx) + Math.abs(z - cz) <= r * 1.42;
      let any = false;
      for (let x = Math.floor(cx - r0); x <= Math.ceil(cx + r0); x++)
        for (let z = Math.floor(cz - r0); z <= Math.ceil(cz + r0); z++)
          if (inO(x, z) && STEP4.some(([dx, dz]) => !inO(x + dx, z + dz))) { set(x, y0 + i, z, M.wall, 8); any = true; }
      if (!any) { set(Math.round(cx), y0 + i, Math.round(cz), M.post, 8); }
    }
    set(Math.round(cx), y0 + h, Math.round(cz), M.post, 8);
  };
  towerBoxes.forEach((bx, i) => {
    shellTower(bx, 1, towerH, s(p.spires[i] ?? 0, 0), true);
    // At the foot: the west portal, an arch to the aisle (east face) and one to the nave (inner face)
    const [x0, x1, z0, z1] = bx, cz = Math.round((z0 + z1) / 2), cx = Math.round((x0 + x1) / 2);
    const h = Math.max(3, Math.min(ph, Ha));
    portal(x0, cz, false, pw, ph);
    portal(x1, Math.round(z0 > zc ? (zP2 + zA2) / 2 : (zA + zP) / 2), false, Math.min(pw, 1), h);
    if (p.towers === 2) portal(cx, z0 < zc ? z1 : z0, true, Math.min(pw, 1), h);
    else portal(cx, z0, true, 0, h), portal(cx, z1, true, 0, h);
  });

  // The crossing: a flèche above the ridge or a tower with a spire
  const cxC = Math.round((xt0 + xt1) / 2), czC = Math.round(zc);
  if (p.crossing === 'fleche') {
    const base = roofHigh(cxC, czC) + 1, h = s(p.crossingSpire, 6);
    for (let y = base; y < base + 3; y++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
      if (Math.abs(dx) + Math.abs(dz) < 2 || y === base) set(cxC + dx, y, czC + dz, M.tile, 8);
    for (let y = base + 3; y < base + h; y++) set(cxC, y, czC, M.post, 8);
  } else if (p.crossing === 'tower') {
    const y1 = Math.max(s(p.crossingHeight), Hv + 6);
    shellTower([xt0, xt1, zP, zP2], Hv + 1, y1, s(p.crossingSpire, 0), false);
  }

  return finish(p, scale, cells, stageOf, W, D, opts);
}

function finish(p: GothicPreset, scale: number, cells: Map<string, string>, stageOf: Map<string, number>, W: number, D: number,
  opts: { jobMin?: number; jobMax?: number }): Cathedral {
  let H = 0;
  for (const kk of cells.keys()) H = Math.max(H, Number(kk.split(',')[1]) + 1);
  const blocks = [...new Set(cells.values())].sort();
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+-=<>?@!~^:;,(){}[]|/';
  if (blocks.length > CHARS.length) throw new Error(`gothicGen: ${blocks.length} blocks, more than the palette holds`);
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
  const stages = new Array(GOTHIC_STAGES.length).fill(0);
  for (const [kk, b] of cells) {
    bill[gothicItem(b)] = (bill[gothicItem(b)] ?? 0) + 1;
    stages[stageOf.get(kk)! - 1]++;
  }
  const design: Design = {
    name: `${p.name}_1_${scale}`.slice(0, 32), description: `${p.description} (1:${scale})`.slice(0, 200),
    palette, layers, width: W, depth: D, height: H, blocks: cells.size, by: 'gothicGen',
  };
  const cellJob = new Map<string, number>();
  const jobs = cutJobs(cells, stageOf, opts.jobMin ?? 300, opts.jobMax ?? 800, cellJob);
  return { design, scale, stages, jobs, bill, cellStage: stageOf, cellJob };
}

/** Each stage's cells cut into jobs: whole x slices gathered west to east until a job holds jobMin; a slice larger
 *  than jobMax is cut into bands of layers. The last job of a stage may be smaller. */
function cutJobs(cells: Map<string, string>, stageOf: Map<string, number>, jobMin: number, jobMax: number, cellJob: Map<string, number>): GothicJob[] {
  const jobs: GothicJob[] = [];
  for (let st = 1; st <= GOTHIC_STAGES.length; st++) {
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
        j.bill[gothicItem(b)] = (j.bill[gothicItem(b)] ?? 0) + 1;
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

/** A job as a Design of its own (its box; '_' for every cell outside the job, so a build leaves them as they are),
 *  with the offset of its box in the cathedral's grid. */
export function jobDesign(c: Cathedral, j: GothicJob): { design: Design; offset: [number, number, number] } {
  const d = c.design, n = c.jobs.indexOf(j);
  const layers: string[][] = [];
  for (let y = j.y0; y <= j.y1; y++) {
    const rows: string[] = [];
    for (let z = j.z0; z <= j.z1; z++) {
      let row = '';
      for (let x = j.x0; x <= j.x1; x++) {
        const ch = d.layers[y][z][x];
        row += ch !== '.' && c.cellJob.get(key(x, y, z)) === n ? ch : '_';
      }
      rows.push(row);
    }
    layers.push(rows);
  }
  const used = new Set(layers.flat().join(''));
  const palette = Object.fromEntries(Object.entries(d.palette).filter(([ch]) => used.has(ch)));
  return {
    design: { ...d, name: `${d.name}_s${j.stage}_${j.index}`.slice(0, 32), palette, layers, width: j.x1 - j.x0 + 1, depth: j.z1 - j.z0 + 1, height: j.y1 - j.y0 + 1, blocks: j.blocks },
    offset: [j.x0, j.y0, j.z0],
  };
}
