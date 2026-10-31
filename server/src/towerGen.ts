/**
 * Lighthouses and clock towers drawn by code (the civic tier, civic.ts), beside timberGen.ts: 10 real ones as presets of
 * their measures in metres (1 m = 1 block at 1:1; approximate, from the published dimensions; the report lists the
 * sources). A lighthouse is a round, octagonal or square shaft tapering from its base to its gallery (straight, or
 * concave as Smeaton's and Stevenson's towers curve out at the foot), banded in two colours where the real one is
 * painted, an upper stage where it has one (the Tower of Hercules' octagon), a lantern of glass round a light under a
 * domed cap, on a platform (Cordouan's) and with a keeper's house where it has one. A clock tower is a square shaft with
 * floors, its clock faces (a disc of pale stone with hands) on the faces it has them, a gate passage through its foot
 * (the Zytglogge's, Venice's), wings either side (Venice's) and its top: a spire, a pyramid, corner turrets round a spire
 * (Prague's), a cupola, or a belfry under a spire (Westminster's). Long axis west to east (x), the door in the west at
 * x = 0 toward the village; code draws every cell (lesson 1).
 */
import type { Cathedral } from './gothicGen';
import { C, Grid, ROOF_BRICK, ROOF_COBBLE, cone, finishCivic, ring, roundShell, scaled, squareShell } from './civicDraw';

export type TowerKind = 'lighthouse' | 'clock_tower';
export interface TowerPreset {
  name: string;
  title: string;
  kind: TowerKind;
  description: string;
  place: string;
  built: string;
  /** The shaft's plan, its width at the foot and at the top (diameter or side, metres) and its height to the gallery or
   *  the cornice. */
  plan: 'round' | 'octagon' | 'square';
  base: number;
  top: number;
  height: number;
  /** Concave: the shaft curves out at its foot (a quarter of the height). */
  profile?: 'straight' | 'concave';
  /** The shaft's stone: pale (diorite), dressed (stone bricks), rubble (cobblestone), sandstone. */
  stone: 'pale' | 'dressed' | 'rubble' | 'sandstone';
  /** Painted bands: how many dark (or red) bands up the shaft. */
  bands?: { n: number; colour: 'red' | 'dark' };
  /** Lighthouse: the lantern's height and diameter, a gallery round its foot; an upper stage (Hercules'). */
  lantern?: { height: number; d: number };
  upper?: { plan: 'round' | 'octagon' | 'square'; d: number; height: number };
  platform?: { d: number; height: number };
  keeper?: { length: number; width: number; height: number };
  /** Clock tower: the clock's centre (metres up) and diameter, the faces it is on. */
  clock?: { at: number; d: number; faces: 'all' | 'west' | 'we' };
  /** Its top over the cornice and how high (metres). */
  roof?: { kind: 'spire' | 'pyramid' | 'turrets' | 'cupola' | 'belfry'; height: number };
  /** A passage through the foot, west to east (width, height). */
  gate?: { width: number; height: number };
  /** Lower wings north and south of the shaft (Venice's): their length out from it, depth and height. */
  wings?: { length: number; depth: number; height: number };
  /** A floor every this many metres inside the shaft. */
  floors?: number;
}

const P = (p: TowerPreset) => p;

export const TOWER_PRESETS: Record<string, TowerPreset> = {
  // Lighthouses
  smeatons_tower: P({ name: 'smeatons_tower', title: 'Smeaton\'s Tower', kind: 'lighthouse', place: 'Eddystone Rocks, now Plymouth Hoe', built: '1759',
    description: 'the third Eddystone light, of dovetailed granite, curving out at its foot like an oak; painted in red and white bands',
    plan: 'round', base: 8, top: 5, height: 18, profile: 'concave', stone: 'pale', bands: { n: 2, colour: 'red' }, lantern: { height: 4, d: 4 }, floors: 3 }),
  tower_of_hercules: P({ name: 'tower_of_hercules', title: 'the Tower of Hercules', kind: 'lighthouse', place: 'A Coruña, Galicia', built: '2nd century (cased 1791)',
    description: 'the oldest Roman lighthouse still lit: a square stone tower of three storeys under an octagonal lantern stage',
    plan: 'square', base: 11.4, top: 11.4, height: 34, stone: 'dressed', upper: { plan: 'octagon', d: 6, height: 9 }, lantern: { height: 4, d: 4 }, floors: 11, platform: { d: 18, height: 1 } }),
  hook_head: P({ name: 'hook_head', title: 'Hook Lighthouse', kind: 'lighthouse', place: 'Hook Head, County Wexford', built: 'c. 1245',
    description: 'a medieval round tower of four storeys with walls 4 m thick, white with two black bands, the keepers\' houses at its foot',
    plan: 'round', base: 13, top: 11, height: 31, stone: 'pale', bands: { n: 2, colour: 'dark' }, lantern: { height: 4, d: 5 }, floors: 8,
    keeper: { length: 12, width: 6, height: 5 } }),
  cordouan: P({ name: 'cordouan', title: 'Cordouan Lighthouse', kind: 'lighthouse', place: 'the Gironde estuary', built: '1611',
    description: 'the "Versailles of the sea": a Renaissance tower of stacked storeys rising from a round bastion in the estuary',
    plan: 'round', base: 16, top: 6, height: 60, stone: 'sandstone', lantern: { height: 6, d: 5 }, platform: { d: 41, height: 8 }, floors: 8 }),
  bell_rock: P({ name: 'bell_rock', title: 'the Bell Rock Lighthouse', kind: 'lighthouse', place: 'the Inchcape reef, off Arbroath', built: '1810',
    description: 'Stevenson\'s granite tower on a reef awash at high tide, the oldest surviving sea-washed lighthouse, its foot curved',
    plan: 'round', base: 13, top: 4.6, height: 31, profile: 'concave', stone: 'pale', lantern: { height: 4, d: 4 }, floors: 4 }),

  // Clock towers
  zytglogge: P({ name: 'zytglogge', title: 'the Zytglogge', kind: 'clock_tower', place: 'Bern', built: '1218-1220 (clock 1530)',
    description: 'Bern\'s gate tower turned clock tower: a passage through its foot, the astronomical clock, a steep spire over all',
    plan: 'square', base: 11, top: 11, height: 36, stone: 'sandstone', clock: { at: 24, d: 5, faces: 'we' }, roof: { kind: 'spire', height: 18 },
    gate: { width: 4, height: 6 }, floors: 5 }),
  prague_town_hall: P({ name: 'prague_town_hall', title: 'the Old Town Hall tower', kind: 'clock_tower', place: 'Prague', built: '1364 (clock 1410)',
    description: 'the tower of the astronomical clock: a square Gothic shaft, a gallery with four corner turrets, a pointed roof',
    plan: 'square', base: 9, top: 9, height: 50, stone: 'dressed', clock: { at: 10, d: 6, faces: 'west' }, roof: { kind: 'turrets', height: 19 }, floors: 6 }),
  elizabeth_tower: P({ name: 'elizabeth_tower', title: 'the Elizabeth Tower', kind: 'clock_tower', place: 'Westminster', built: '1859',
    description: 'Big Ben\'s tower: a square shaft of stone, four clock faces 7 m across, the belfry, and a spire with pinnacles',
    plan: 'square', base: 12, top: 12, height: 61, stone: 'sandstone', clock: { at: 55, d: 7, faces: 'all' }, roof: { kind: 'belfry', height: 35 }, floors: 6 }),
  torre_orologio: P({ name: 'torre_orologio', title: 'the Torre dell\'Orologio', kind: 'clock_tower', place: 'Venice', built: '1499',
    description: 'the clock tower over the Mercerie: an arch through its foot, a blue and gold clock, wings either side, the Moors on top',
    plan: 'square', base: 8, top: 8, height: 24, stone: 'pale', clock: { at: 14, d: 4.5, faces: 'we' }, roof: { kind: 'cupola', height: 5 },
    gate: { width: 4, height: 7 }, wings: { length: 6, depth: 8, height: 16 }, floors: 5 }),
  gros_horloge: P({ name: 'gros_horloge', title: 'the Gros-Horloge', kind: 'clock_tower', place: 'Rouen', built: '1389 (the arch 1529)',
    description: 'a Renaissance arch carrying a great one-handed clock over the street, beside its Gothic belfry',
    plan: 'square', base: 7, top: 7, height: 30, stone: 'dressed', clock: { at: 9, d: 5, faces: 'we' }, roof: { kind: 'pyramid', height: 8 },
    gate: { width: 5, height: 6 }, wings: { length: 6, depth: 7, height: 13 }, floors: 5 }),
};

export const TOWER_STAGES = ['pad and floor', 'lower shaft', 'upper shaft', 'top', 'lantern, clock and details'] as const;
const S = { pad: 1, lower: 2, upper: 3, top: 4, detail: 5 } as const;

const STONE: Record<TowerPreset['stone'], { wall: string; dress: string }> = {
  pale: { wall: C.white, dress: C.bricks }, dressed: { wall: C.bricks, dress: C.stone }, rubble: { wall: C.cobble, dress: C.bricks }, sandstone: { wall: C.sand, dress: C.cutSand },
};

/** Draw a preset at 1:scale. */
export function generateTower(p: TowerPreset, scale: number, opts: { jobMin?: number; jobMax?: number } = {}): Cathedral {
  const g = new Grid();
  const s = scaled(scale);
  if (p.kind === 'lighthouse') lighthouse(g, p, s);
  else clockTower(g, p, s);
  return finishCivic(p.name, `${p.title}, ${p.place} (${p.built}): ${p.description}`, scale, g, TOWER_STAGES, 'towerGen', opts.jobMin, opts.jobMax);
}

const sidesOf = (plan: 'round' | 'octagon' | 'square') => (plan === 'octagon' ? 8 : plan === 'square' ? 4 : 0);

function lighthouse(g: Grid, p: TowerPreset, s: ReturnType<typeof scaled>): void {
  const st = STONE[p.stone];
  const r0 = Math.max(2, s(p.base / 2, 2)), r1 = Math.max(1.5, s(p.top / 2, 1)), H = Math.max(8, s(p.height, 8));
  const pr = p.platform ? Math.max(r0 + 2, s(p.platform.d / 2, 3)) : 0, ph = p.platform ? Math.max(1, s(p.platform.height, 1)) : 0;
  const R = Math.ceil(Math.max(r0, pr)) + 1;
  const cx = R, cz = R;
  // (the platform: a round bastion, paved, a parapet; Cordouan's)
  if (p.platform) {
    roundShell(g, cx, cz, 0, ph, pr, pr, () => C.bricks, () => S.pad, { floorEvery: ph || 1, floor: C.cobble });
    roundShell(g, cx, cz, ph + 1, ph + 1, pr, pr, (_x, _y, _z, i) => (i % 2 ? C.brickWall : null), () => S.pad);
  } else roundShell(g, cx, cz, 0, 0, r0 + 1, r0 + 1, () => C.cobble, () => S.pad, { floorEvery: 1, floor: C.cobble, sides: sidesOf(p.plan) });
  const y0 = ph + 1;
  const fl = Math.max(3, s(p.floors ?? 4, 3));
  const band = (y: number) => {
    if (!p.bands) return false;
    const n = p.bands.n, h = H - y0;
    const k = Math.floor(((y - y0) / Math.max(1, h)) * (2 * n + 1));
    return k % 2 === 1;
  };
  const wall = (x: number, y: number, z: number, i: number) => {
    if (y > y0 + 2 && (y - y0) % fl === 2 && i % 8 === 4) return C.pane;
    if (band(y)) return p.bands!.colour === 'red' ? C.red : C.bricks;
    return (y - y0) % 6 === 0 ? st.dress : st.wall;
  };
  // (the shaft: a concave foot curves out over its lowest quarter)
  const top = y0 + H - 1;
  if (p.profile === 'concave') {
    const yq = y0 + Math.round(H / 4);
    for (let y = y0; y <= top; y++) {
      const t = (y - y0) / (top - y0);
      const r = y <= yq ? r1 + (r0 - r1) * Math.pow(1 - t, 2.2) : r1 + (r0 - r1) * 0.35 * (1 - t) / 0.75;
      roundShell(g, cx, cz, y, y, r, r, wall, (yy) => (yy < y0 + H / 2 ? S.lower : S.upper), { sides: sidesOf(p.plan), floorEvery: (y - y0) % fl === 0 ? 1 : 0 });
    }
  } else roundShell(g, cx, cz, y0, top, r0, r1, wall, (y) => (y < y0 + H / 2 ? S.lower : S.upper), { sides: sidesOf(p.plan), floorEvery: fl });
  // (the door west)
  for (let y = y0; y <= y0 + 1; y++) for (let x = cx - r0 - 1; x <= cx; x++) if (Math.abs(x - cx) >= r0 - 1.5) g.clear(x, y, cz);
  let ytop = top, rt = r1;
  if (p.upper) {
    const ru = Math.max(1.5, s(p.upper.d / 2, 1)), hu = Math.max(3, s(p.upper.height, 3));
    roundShell(g, cx, cz, top + 1, top + 1, r1, r1, () => st.dress, () => S.top, { sides: sidesOf(p.plan), floorEvery: 1, floor: st.dress });
    roundShell(g, cx, cz, top + 2, top + 1 + hu, ru, ru, (_x, y, _z, i) => (y % 3 === 0 && i % 4 === 2 ? C.pane : st.wall), () => S.top, { sides: sidesOf(p.upper.plan) });
    ytop = top + 1 + hu; rt = ru;
  }
  // (the gallery: a floor out past the shaft, a rail; the lantern of glass round the light, a dome over it)
  const rg = rt + 1, lh = p.lantern ? Math.max(2, s(p.lantern.height, 2)) : 2, lr = p.lantern ? Math.max(1, s(p.lantern.d / 2, 1)) : 1;
  roundShell(g, cx, cz, ytop + 1, ytop + 1, rg, rg, () => C.bricks, () => S.detail, { floorEvery: 1, floor: C.bricks });
  roundShell(g, cx, cz, ytop + 2, ytop + 2, rg, rg, () => C.fence, () => S.detail);
  roundShell(g, cx, cz, ytop + 2, ytop + 1 + lh, lr, lr, () => C.pane, () => S.detail);
  g.set(cx, ytop + 2, cz, C.bricks, S.detail);
  g.set(cx, ytop + 3, cz, C.torch, S.detail);
  cone(g, cx, cz, ytop + 2 + lh, ytop + 2 + lh + Math.max(1, Math.round(lr)), lr + 0.5, ROOF_COBBLE, S.detail, 0, C.fence);
  // (the keepers' house east of the tower, a gabled range)
  if (p.keeper) {
    const kl = s(p.keeper.length, 5), kw = s(p.keeper.width, 4), kh = Math.max(3, s(p.keeper.height, 3));
    const x0 = cx + Math.ceil(r0) + 1, z0 = cz - Math.floor(kw / 2);
    squareShell(g, x0, z0, x0 + kl - 1, z0 + kw - 1, 1, kh, (x, y, z) => (y === 2 && (x - x0) % 3 === 1 && (z === z0 || z === z0 + kw - 1) ? C.pane : C.white), () => S.lower);
    for (let x = x0; x < x0 + kl; x++) for (let z = z0; z < z0 + kw; z++) g.set(x, 0, z, C.cobble, S.pad);
    for (let x = x0 - 1; x <= x0 + kl; x++) for (let z = z0 - 1; z <= z0 + kw; z++) {
      const d = Math.min(z - (z0 - 1), z0 + kw - z);
      const y = kh + 1 + d, ridge = z - (z0 - 1) === z0 + kw - z;
      g.set(x, y, z, ridge ? C.bricks : C.brickStair(z - (z0 - 1) < z0 + kw - z ? 'south' : 'north'), S.top);
      if (x === x0 - 1 || x === x0 + kl) continue;
      for (let yy = kh + 1; yy < y; yy++) if (x === x0 || x === x0 + kl - 1) g.set(x, yy, z, C.white, S.top);
    }
  }
}

function clockTower(g: Grid, p: TowerPreset, s: ReturnType<typeof scaled>): void {
  const st = STONE[p.stone];
  const a = Math.max(5, s(p.base, 5)), H = Math.max(10, s(p.height, 10));
  const wl = p.wings ? Math.max(3, s(p.wings.length, 3)) : 0, wd = p.wings ? Math.max(4, s(p.wings.depth, 4)) : 0, wh = p.wings ? Math.max(5, s(p.wings.height, 5)) : 0;
  const x0 = 0, z0 = wl, x1 = a - 1, z1 = z0 + a - 1;
  const fl = Math.max(3, s(p.floors ?? 5, 3));
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) g.set(x, 0, z, C.cobble, S.pad);
  const wall = (x: number, y: number, z: number) => {
    const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
    if (corner || y === H) return st.dress;
    const mid = Math.abs(x - cx) < 1 || Math.abs(z - cz) < 1;
    if (mid && y > 3 && (y % fl === 2) && y < H - 1) return C.pane;
    return st.wall;
  };
  squareShell(g, x0, z0, x1, z1, 1, H, wall, (y) => (y < H / 2 ? S.lower : S.upper), fl);
  // (the gate passage west to east, or a door in the west face)
  const gw = p.gate ? Math.min(a - 2, Math.max(2, s(p.gate.width, 2))) : 1, gh = p.gate ? Math.min(H - 3, Math.max(3, s(p.gate.height, 3))) : 2;
  const gz0 = Math.round(cz - (gw - 1) / 2);
  for (let x = p.gate ? x0 : x0; x <= (p.gate ? x1 : x0); x++) for (let z = gz0; z < gz0 + gw; z++) for (let y = 1; y <= gh; y++) g.clear(x, y, z);
  if (p.gate) for (const x of [x0, x1]) for (const [z, f] of [[gz0, 'south'], [gz0 + gw - 1, 'north']] as const) if (gw >= 3) g.set(x, gh, z, C.brickStair(f, 'top'), S.lower);
  // (wings north and south: lower ranges with windows and a flat parapet)
  if (p.wings) for (const [za, zb] of [[0, z0 - 1], [z1 + 1, z1 + wl]]) {
    const wx0 = Math.round(cx - wd / 2), wx1 = wx0 + wd - 1;
    for (let x = wx0; x <= wx1; x++) for (let z = za; z <= zb; z++) g.set(x, 0, z, C.cobble, S.pad);
    for (let y = 1; y <= wh; y++) for (let x = wx0; x <= wx1; x++) for (let z = za; z <= zb; z++) {
      const edge = x === wx0 || x === wx1 || z === za || z === zb || y === wh;
      if (!edge) continue;
      g.set(x, y, z, y % 4 === 2 && (x === wx0 || x === wx1) && (z - za) % 2 === 1 ? C.pane : st.wall, y < wh / 2 ? S.lower : S.upper);
    }
    ring(wx0, za, wx1, zb).forEach(([x, z], i) => { if (i % 2 === 0) g.set(x, wh + 1, z, C.brickWall, S.detail); });
  }
  // (the clock faces: a disc of pale stone with a dark ring, the hands from the centre)
  if (p.clock) {
    const rc = Math.max(1, s(p.clock.d / 2, 1)), yc = Math.min(H - rc - 1, Math.max(rc + 2, s(p.clock.at, rc + 2)));
    const faces: Array<'w' | 'e' | 'n' | 's'> = p.clock.faces === 'all' ? ['w', 'e', 'n', 's'] : p.clock.faces === 'we' ? ['w', 'e'] : ['w'];
    for (const f of faces) {
      const at = (u: number, v: number): [number, number, number] => f === 'w' ? [x0 - 1, yc + v, cz + u] : f === 'e' ? [x1 + 1, yc + v, cz - u] : f === 'n' ? [cx - u, yc + v, z0 - 1] : [cx + u, yc + v, z1 + 1];
      for (let u = -rc; u <= rc; u++) for (let v = -rc; v <= rc; v++) {
        const d = Math.hypot(u, v);
        if (d > rc + 0.3) continue;
        const hand = (u === 0 && v >= 0 && v <= rc - 1) || (v === 0 && u >= 0 && u <= Math.max(1, rc - 2));
        const [x, y, z] = at(u, v);
        g.set(x, y, z, d > rc - 0.7 ? C.bricks : hand ? 'oak_planks' : C.white, S.detail);
      }
    }
  }
  // (the top: battlements or a cornice, then the roof)
  const r = (a - 1) / 2;
  if (p.roof?.kind !== 'belfry') ring(x0, z0, x1, z1).forEach(([x, z], i) => { if (i % 2 === 0 || p.roof?.kind === 'pyramid') g.set(x, H + 1, z, p.roof?.kind === 'pyramid' ? C.brickSlab : st.dress, S.top); });
  const rh = Math.max(3, s(p.roof?.height ?? 6, 3));
  const kind = p.roof?.kind ?? 'pyramid';
  if (kind === 'spire') cone(g, cx, cz, H + 1, H + rh, r + 0.5, ROOF_COBBLE, S.top, 4, C.fence);
  else if (kind === 'pyramid') cone(g, cx, cz, H + 2, H + 1 + rh, r + 0.3, ROOF_BRICK, S.top, 4, C.fence);
  else if (kind === 'cupola') {
    roundShell(g, cx, cz, H + 1, H + 2, Math.max(1, r / 2), Math.max(1, r / 2), (_x, y) => (y === H + 1 ? C.fence : st.dress), () => S.top, { sides: 4 });
    cone(g, cx, cz, H + 3, H + 2 + Math.max(2, Math.round(rh / 2)), Math.max(1, r / 2) + 0.5, ROOF_BRICK, S.top, 0, C.fence);
  } else if (kind === 'turrets') {
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      roundShell(g, x, z, H + 1, H + 3, 1, 1, () => st.dress, () => S.top);
      cone(g, x, z, H + 4, H + 4 + Math.max(3, Math.round(rh / 2)), 1.5, ROOF_COBBLE, S.top, 0, C.fence);
    }
    cone(g, cx, cz, H + 1, H + rh, r - 0.5, ROOF_COBBLE, S.top, 4, C.fence);
  } else {
    // (the belfry: an open stage of pillars over the cornice, then a spire with pinnacles at its corners)
    const bh = Math.max(3, Math.round(rh * 0.25));
    for (let y = H + 1; y <= H + bh; y++) for (const [x, z] of ring(x0, z0, x1, z1)) {
      const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
      if (corner || (x + z) % 3 === 0 || y === H + bh) g.set(x, y, z, st.dress, S.top);
    }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) g.put(x, H + 1, z, C.bricks, S.top);
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) for (let y = H + bh + 1; y <= H + bh + 3; y++) g.set(x, y, z, y === H + bh + 3 ? C.fence : C.brickWall, S.detail);
    cone(g, cx, cz, H + bh + 1, H + rh, r - 0.5, ROOF_BRICK, S.top, 4, C.fence);
  }
}
