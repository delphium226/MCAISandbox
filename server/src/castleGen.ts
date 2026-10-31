/**
 * A castle drawn by code (the monument's second type, #153; runs/2026-10-25/monument/castle_note.md), beside gothicGen.ts:
 * a grammar of parts, each a function of the scale and the materials: drum towers (a round shell with timber floors, a
 * door to the ward, a door to the wall-walk, arrow slits, a crenellated top and on some a slim watch turret), curtain
 * wall segments between tower centres (solid, a wall-walk with a parapet and merlons on the outer face), gatehouses (an
 * open passage through a wall with a raised portcullis, and a barbican in front: a walled forecourt with corner turrets),
 * halls against a curtain (a stone shell with windows and a timber roof whose stairs face uphill) and a square keep (the
 * White Tower's: pilaster buttresses, corner turrets, timber floors, windows). A tower may be square and may carry a conical
 * roof instead of battlements; a wall may have its own height and thickness (a concentric castle's low outer ring) and end
 * at a plain corner with no tower. Presets give a real castle's measures in metres (1 m = 1 block at 1:1; approximate,
 * from the standard histories); the scale divides them, with minimums that keep every passage walkable. Code draws every cell, so the bill is exact (lesson 1).
 *
 * The plan's long axis runs west to east (x), its main gate in the west at x = 0 and the middle of z, as the cathedral's
 * west portal (monument.ts' site search puts that door toward the village). The output is gothicGen's Cathedral shape
 * (design, stages, jobs of 300-800 blocks cut by x slices, bill, cell maps) plus the stage names: the castle's stages are
 * the order real castles grew in (the keep, the curtain, its towers, the gatehouses, the halls, the battlements), with
 * those a preset has no part for left out and the rest numbered from 1.
 */
import type { CivicSource } from './civic';
import { CIVIC_BLOCK, type Cathedral, type GothicJob } from './gothicGen';
import type { Design } from './village';

export interface CastleTower {
  /** Centre in metres in the plan (x west to east, z north to south). */
  x: number; z: number;
  /** Diameter and height (metres; d 0: a corner of the curtain with no tower); a slim watch turret on its top. */
  d: number; h: number;
  turret?: boolean;
  /** A square tower (side d) rather than a drum (Vincennes', Malbork's). */
  square?: boolean;
  /** A conical roof (a pyramid on a square tower) this high above the top, in place of the battlements (metres). */
  roof?: number;
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
  /** Curtain segments, by tower index: the ring and any cross-walls; a third and fourth number give that segment its own
   *  height and thickness (metres: a concentric castle's low outer ring). */
  walls: Array<[number, number] | [number, number, number, number]>;
  gates: CastleGate[];
  /** Halls against a curtain, metres: the box they stand in (one side on the curtain) and their wall height. */
  halls: Array<{ x0: number; x1: number; z0: number; z1: number; h: number }>;
  /** A square keep: its corner (metres), size, height, wall thickness; one corner turret round (the White Tower's NE). */
  keep?: { x: number; z: number; w: number; d: number; h: number; t: number; round?: 'ne' | 'nw' | 'se' | 'sw' };
  /** The passage through a gate (metres). */
  gateWidth: number;
  gateHeight: number;
  /** A civic building (CASTLE_CIVIC, the civic tier's), not a monument: its category, title, place and date. */
  kind?: 'monument' | 'civic';
  category?: string;
  title?: string;
  place?: string;
  built?: string;
}

/** The towers of a rectangle of 2 x n drum towers (north row then south row). */
const rowTowers = (xs: number[], width: number, d: number, h: number, turret: (i: number) => boolean): CastleTower[] =>
  [0, width].flatMap((z) => xs.map((x, i) => ({ x, z, d, h, turret: turret(i) })));
/** A tower at (x, z), d across, h high. */
const T = (x: number, z: number, d: number, h: number, more: Partial<CastleTower> = {}): CastleTower => ({ x, z, d, h, ...more });
/** Walls round towers from..from+n-1 in order, closing the ring (a height and thickness each when given). */
const loop = (from: number, n: number, ht?: [number, number]): CastlePreset['walls'] =>
  Array.from({ length: n }, (_, i) => (ht ? [from + i, from + ((i + 1) % n), ...ht] : [from + i, from + ((i + 1) % n)]));
/** n towers round an ellipse (centre and semi-axes, metres), clockwise from just north of its west point; the first and
 *  last stand either side of the west point at least 26 m apart, room for a gate between them at every scale. */
const ellipseTowers = (cx: number, cz: number, a: number, b: number, n: number, d: number, h: number, more: Partial<CastleTower> = {}): CastleTower[] => {
  const t0 = Math.max(Math.PI / n, Math.asin(Math.min(1, 13 / b)));
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return Array.from({ length: n }, (_, i) => {
    const t = t0 + (i * (2 * Math.PI - 2 * t0)) / (n - 1);
    return T(r1(cx - a * Math.cos(t)), r1(cz - b * Math.sin(t)), d, h, more);
  });
};

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
  // The presets below are turned so their main gate faces west (x = 0), as the site search wants; the measures are the
  // sources' (runs/2026-10-31/monuments40/report.md), the plans drawn from them with round numbers
  caernarfon: {
    name: 'caernarfon',
    description: 'Caernarfon: a long hourglass of great polygonal towers, the Eagle Tower at its end, a twin-towered gate in the middle of one side',
    // ~150 x 44 m, two wards split at the waist by the King's Gate; curtain ~18 m, 4.5 m thick; the Queen's Gate at x = 0
    wallHeight: 18, wallThick: 4.5,
    towers: [T(0, 10, 10, 20), T(16, 0, 12, 22), T(58, 8, 11, 22), T(82, 8, 11, 22), T(114, 0, 12, 22), T(150, 22, 18, 28, { turret: true }),
      T(118, 44, 13, 24), T(82, 42, 14, 24), T(50, 40, 11, 20), T(22, 44, 11, 20), T(0, 34, 10, 20)],
    walls: [...loop(0, 11), [3, 7]],
    gates: [{ a: 10, b: 0, portcullis: true, barbican: 0 }, { a: 2, b: 3, portcullis: true, barbican: 0 }, { a: 3, b: 7, portcullis: false, barbican: 0 }],
    halls: [{ x0: 88, x1: 118, z0: 30, z1: 44, h: 10 }],
    gateWidth: 3, gateHeight: 5,
  },
  harlech: {
    name: 'harlech',
    description: 'Harlech: a concentric square, four drum towers and a great twin-towered gatehouse inside a low outer wall',
    // inner ward ~52 x 48 m, curtain 12 m and 3 m thick, gatehouse towers 24 m apart; the outer wall 8 m high, drawn 20 m
    // out (the real outer ward is ~10 m, too narrow beside 1:4's towers) with its small towers left out
    wallHeight: 12, wallThick: 3,
    towers: [T(0, 0, 10, 16, { turret: true }), T(52, 0, 10, 15, { turret: true }), T(52, 48, 10, 13), T(0, 48, 10, 13), T(0, 36, 11, 20), T(0, 12, 11, 20),
      T(-20, -20, 0, 0), T(72, -20, 0, 0), T(72, 68, 0, 0), T(-20, 68, 0, 0)],
    walls: [...loop(0, 6), ...loop(6, 4, [8, 1.5])],
    gates: [{ a: 4, b: 5, portcullis: true, barbican: 0 }, { a: 9, b: 6, portcullis: true, barbican: 12 }],
    halls: [{ x0: 12, x1: 40, z0: 0, z1: 12, h: 8 }],
    gateWidth: 3, gateHeight: 5,
  },
  beaumaris: {
    name: 'beaumaris',
    description: 'Beaumaris: the perfect concentric castle, a square inner ward with two great gatehouses inside a ring of twelve towers',
    // inner ward 60 x 54 m, curtain 11 m and 4.8 m thick, six towers and two twin-D gatehouses; outer ward 18 m wide,
    // its curtain 8 m high and 1.5 m thick with 6 towers (12 real: at 1:4 the rest would wall the outer ward into
    // pockets) and the gates in line with the inner ones (the real ones are offset)
    wallHeight: 11, wallThick: 4.8,
    towers: [T(0, 0, 12, 15), T(30, 0, 10, 15), T(60, 0, 12, 15), T(60, 15, 11, 18, { turret: true }), T(60, 39, 11, 18, { turret: true }),
      T(60, 54, 12, 15), T(30, 54, 10, 15), T(0, 54, 12, 15), T(0, 39, 11, 18, { turret: true }), T(0, 15, 11, 18, { turret: true }),
      T(-19, -19, 8, 10), T(30, -19, 5, 9), T(79, -19, 8, 10), T(79, 73, 5, 9), T(30, 73, 5, 9), T(-19, 73, 5, 9)],
    walls: [...loop(0, 10), ...loop(10, 6, [8, 1.5])],
    gates: [{ a: 8, b: 9, portcullis: true, barbican: 0 }, { a: 3, b: 4, portcullis: true, barbican: 0 },
      { a: 15, b: 10, portcullis: true, barbican: 10 }, { a: 12, b: 13, portcullis: false, barbican: 0 }],
    halls: [],
    gateWidth: 3, gateHeight: 5,
  },
  edinburgh: {
    name: 'edinburgh',
    description: 'Edinburgh: batteries round the crag top, the Half Moon Battery by the gate, a Portcullis Gate to Crown Square and its Great Hall',
    // ~220 x 85 m along the summit (the rock left out); the Great Hall 29 x 12.5 m on the south side of Crown Square
    wallHeight: 10, wallThick: 3,
    towers: [T(0, 28, 8, 14), T(40, 0, 10, 12), T(120, 5, 10, 12), T(170, 0, 8, 12), T(220, 30, 10, 14), T(190, 80, 10, 14), T(120, 85, 10, 12),
      T(60, 80, 24, 20), T(0, 52, 8, 14)],
    walls: [...loop(0, 9), [2, 6]],
    gates: [{ a: 8, b: 0, portcullis: true, barbican: 0 }, { a: 2, b: 6, portcullis: true, barbican: 0 }],
    halls: [{ x0: 140, x1: 175, z0: 66, z1: 84, h: 12 }],
    gateWidth: 3, gateHeight: 5,
  },
  windsor: {
    name: 'windsor',
    description: 'Windsor: three wards in a line, the Round Tower in the middle, St George\'s Chapel below and the state apartments above',
    // ~470 x 110 m; the Round Tower 31 m across and 30 m high (its motte left out), the Curfew Tower under a cone
    wallHeight: 12, wallThick: 2.5,
    towers: [T(0, 10, 10, 18, { roof: 10 }), T(170, 0, 10, 16), T(260, 0, 10, 16), T(470, 0, 12, 20), T(470, 110, 12, 20), T(260, 110, 10, 16),
      T(170, 105, 10, 16), T(85, 105, 10, 16), T(0, 90, 10, 16), T(0, 62, 8, 14), T(0, 38, 8, 14), T(215, 55, 31, 30)],
    walls: [...loop(0, 11), [1, 6], [2, 5]],
    gates: [{ a: 9, b: 10, portcullis: true, barbican: 0 }, { a: 1, b: 6, portcullis: false, barbican: 0 }, { a: 2, b: 5, portcullis: true, barbican: 0 }],
    halls: [{ x0: 30, x1: 100, z0: 0, z1: 22, h: 18 }, { x0: 275, x1: 455, z0: 0, z1: 25, h: 20 }],
    gateWidth: 3, gateHeight: 5,
  },
  dover: {
    name: 'dover',
    description: 'Dover: Henry II\'s great square keep in an inner bailey of square towers, inside the first concentric outer wall',
    // keep ~30 m square, 25 m high, walls 6.4 m; inner bailey ~90 x 70 m with 12 square towers (14 real); the outer wall
    // drawn 40 m out (the real one runs ~400 m), 10 m high
    wallHeight: 12, wallThick: 3,
    towers: [T(0, 0, 8, 16, { square: true }), T(30, 0, 8, 16, { square: true }), T(60, 0, 8, 16, { square: true }), T(90, 0, 8, 16, { square: true }),
      T(90, 23, 8, 16, { square: true }), T(90, 47, 8, 16, { square: true }), T(90, 70, 8, 16, { square: true }), T(60, 70, 8, 16, { square: true }),
      T(30, 70, 8, 16, { square: true }), T(0, 70, 8, 16, { square: true }), T(0, 47, 8, 16, { square: true }), T(0, 23, 8, 16, { square: true }),
      T(-45, -40, 9, 12), T(45, -40, 9, 12), T(135, -40, 9, 12), T(135, 35, 9, 12), T(135, 110, 9, 12), T(45, 110, 9, 12), T(-45, 110, 9, 12),
      T(-45, 47, 9, 12), T(-45, 23, 9, 12)],
    walls: [...loop(0, 12), ...loop(12, 9, [10, 2.5])],
    gates: [{ a: 10, b: 11, portcullis: true, barbican: 0 }, { a: 4, b: 5, portcullis: true, barbican: 0 }, { a: 19, b: 20, portcullis: true, barbican: 12 }],
    halls: [],
    keep: { x: 30, z: 20, w: 30, d: 30, h: 25, t: 6.4 },
    gateWidth: 3, gateHeight: 5,
  },
  bodiam: {
    name: 'bodiam',
    description: 'Bodiam: a moated quadrangle, round towers at the corners, square ones between, a twin-towered gatehouse and its barbican',
    // ~60 x 50 m, corner towers 9.4 m across and 18 m high, curtain 12 m and 2.1 m thick; the hall's range along the side
    // whose middle tower is left out (no room for both at 1:3), the moat left out
    wallHeight: 12, wallThick: 2.1,
    towers: [T(0, 0, 9.4, 18), T(60, 0, 9.4, 18), T(60, 25, 7, 18, { square: true }), T(60, 50, 9.4, 18),
      T(30, 50, 7, 18, { square: true }), T(0, 50, 9.4, 18), T(0, 37, 8, 20, { square: true }), T(0, 13, 8, 20, { square: true })],
    walls: loop(0, 8),
    gates: [{ a: 6, b: 7, portcullis: true, barbican: 10 }],
    halls: [{ x0: 8, x1: 52, z0: 0, z1: 12, h: 10 }],
    gateWidth: 3, gateHeight: 5,
  },
  vincennes: {
    name: 'vincennes',
    description: 'Vincennes: a vast rectangle of nine square towers round the tallest keep in Europe, 52 m, in its own walled square',
    // 330 x 175 m, towers 42 m high as built (most later cut down); the keep 16.5 m square, 52 m, walls 3.3 m, in a
    // 50 m square enceinte 11.5 m high (its corner turrets left out); the Sainte-Chapelle as a hall
    wallHeight: 15, wallThick: 3,
    towers: [T(0, 0, 12, 42, { square: true }), T(110, 0, 12, 42, { square: true }), T(220, 0, 12, 42, { square: true }), T(330, 0, 12, 42, { square: true }),
      T(330, 87.5, 12, 42, { square: true }), T(330, 175, 12, 42, { square: true }), T(220, 175, 12, 42, { square: true }),
      T(110, 175, 12, 42, { square: true }), T(0, 175, 12, 42, { square: true }),
      T(20, 62, 0, 0), T(70, 62, 0, 0), T(70, 112, 0, 0), T(20, 112, 0, 0)],
    walls: [...loop(0, 9), ...loop(9, 4, [11.5, 1.1])],
    gates: [{ a: 8, b: 0, portcullis: true, barbican: 0 }, { a: 12, b: 9, portcullis: true, barbican: 0 }],
    halls: [{ x0: 150, x1: 190, z0: 0, z1: 18, h: 20 }],
    keep: { x: 37, z: 79, w: 16.5, d: 16.5, h: 52, t: 3.3, round: 'ne' },
    gateWidth: 3, gateHeight: 5,
  },
  carcassonne: {
    name: 'carcassonne',
    description: 'Carcassonne: a walled city, two rings of towers under slate cones, the Château Comtal behind the inner gate',
    // the Cité ~500 x 250 m: the outer ring (18 towers here, 19 real) 10 m high, the inner (16 here, 26 real) 11 m; the
    // Château Comtal ~80 x 40 m as a keep
    wallHeight: 11, wallThick: 2.5,
    towers: [...ellipseTowers(250, 125, 250, 122, 18, 8, 13, { roof: 5 }), ...ellipseTowers(250, 125, 225, 100, 16, 7, 14, { roof: 6 })],
    walls: [...loop(0, 18, [10, 2]), ...loop(18, 16)],
    gates: [{ a: 17, b: 0, portcullis: true, barbican: 15 }, { a: 33, b: 18, portcullis: true, barbican: 0 }],
    halls: [],
    keep: { x: 60, z: 105, w: 80, d: 40, h: 20, t: 3 },
    gateWidth: 3, gateHeight: 5,
  },
  chateau_gaillard: {
    name: 'chateau_gaillard',
    description: 'Château Gaillard: three wards in a chain along a spur, Richard the Lionheart\'s round keep at the far end',
    // 200 x 80 m: the outer work, the middle ward and the inner ward, split by ditches (bridged here by gates); the keep
    // ~17 m across (8 m inside) and 18 m high; the chapel as a hall
    wallHeight: 10, wallThick: 3,
    towers: [T(0, 28, 8, 12), T(30, 8, 12, 16), T(55, 10, 8, 12), T(140, 5, 10, 14), T(200, 25, 8, 12), T(200, 55, 8, 12), T(140, 75, 10, 14),
      T(55, 70, 8, 12), T(30, 72, 12, 16), T(0, 52, 8, 12), T(160, 40, 17, 18)],
    walls: [...loop(0, 10), [2, 7], [3, 6]],
    gates: [{ a: 9, b: 0, portcullis: true, barbican: 0 }, { a: 2, b: 7, portcullis: false, barbican: 0 }, { a: 3, b: 6, portcullis: true, barbican: 0 }],
    halls: [{ x0: 70, x1: 95, z0: 58, z1: 72, h: 8 }],
    gateWidth: 3, gateHeight: 5,
  },
  krak_des_chevaliers: {
    name: 'krak_des_chevaliers',
    description: 'Krak des Chevaliers: the crusaders\' concentric castle, tall inner towers above a low outer ring, the knights\' hall within',
    // ~300 x 140 m: the outer ring of 12 round towers, 9 m high; the inner ward's 8 towers ~10 m across over walls 18 m
    // high (the glacis left out); the Gothic hall 27 x 7.5 m
    wallHeight: 18, wallThick: 3.5,
    towers: [...ellipseTowers(150, 70, 145, 68, 12, 8, 14), ...ellipseTowers(150, 70, 95, 45, 8, 10, 24)],
    walls: [...loop(0, 12, [9, 3]), ...loop(12, 8)],
    gates: [{ a: 11, b: 0, portcullis: true, barbican: 0 }, { a: 19, b: 12, portcullis: true, barbican: 0 }],
    halls: [{ x0: 120, x1: 150, z0: 24, z1: 36, h: 10 }],
    gateWidth: 3, gateHeight: 5,
  },
  malbork: {
    name: 'malbork',
    description: 'Malbork: the Teutonic Order\'s brick fortress, the closed square of the High Castle beyond the Middle Castle\'s ward',
    // the High Castle 61 x 51 m round a court (a keep with 10 m wings, 25 m high), the Middle Castle's ward ~110 x 80 m
    // (~110 x 96 m; the real bailey ~80 x 100) with the Great Refectory and the Grand Master's Palace; the Lower Castle, the main tower and the brick left out
    wallHeight: 12, wallThick: 2,
    towers: [T(0, 0, 8, 20, { square: true }), T(60, 0, 8, 20, { square: true }), T(110, 0, 8, 20, { square: true }), T(180, 0, 8, 20, { square: true }),
      T(180, 96, 8, 20, { square: true }), T(110, 96, 8, 20, { square: true }), T(60, 96, 8, 20, { square: true }), T(0, 96, 8, 20, { square: true }),
      T(0, 60, 8, 20, { square: true }), T(0, 36, 8, 20, { square: true })],
    walls: loop(0, 10),
    gates: [{ a: 8, b: 9, portcullis: true, barbican: 12 }],
    halls: [{ x0: 15, x1: 45, z0: 0, z1: 15, h: 14 }, { x0: 15, x1: 55, z0: 81, z1: 96, h: 18 }],
    keep: { x: 120, z: 22.5, w: 61, d: 51, h: 25, t: 10 },
    gateWidth: 3, gateHeight: 5,
  },
  alcazar_segovia: {
    name: 'alcazar_segovia',
    description: 'Alcázar of Segovia: a ship-shaped castle on a rock prow, slate cones on its towers, the tower of John II at the gate',
    // ~150 x 50 m; the tower of John II ~20 x 16 m, 33 m high as a keep; turrets under cones (the rock and moat left out)
    wallHeight: 12, wallThick: 2.5,
    towers: [T(0, 13, 6, 14, { roof: 6 }), T(60, 0, 6, 16, { roof: 7 }), T(110, 5, 7, 20, { roof: 8 }), T(150, 25, 8, 18, { roof: 8 }),
      T(110, 45, 7, 20, { roof: 8 }), T(60, 50, 6, 16, { roof: 7 }), T(0, 37, 6, 14, { roof: 6 })],
    walls: loop(0, 7),
    gates: [{ a: 6, b: 0, portcullis: true, barbican: 0 }],
    halls: [{ x0: 65, x1: 105, z0: 2, z1: 14, h: 14 }],
    keep: { x: 25, z: 17, w: 20, d: 16, h: 33, t: 3, round: 'ne' },
    gateWidth: 3, gateHeight: 5,
  },
  hohenzollern: {
    name: 'hohenzollern',
    description: 'Hohenzollern: a neo-Gothic palace on a hilltop inside a ring of bastions and tall spired towers',
    // the core ~70 x 20 m (narrowed to leave the ward a way round), 24 m high, as a keep; the bastion ring ~160 x 76 m,
    // four of its eight towers tall under spires (the palace's towers moved out to the ring)
    wallHeight: 10, wallThick: 3,
    towers: ellipseTowers(75, 25, 80, 38, 8, 14, 12).map((t, i) => ([2, 3, 5, 6].includes(i) ? { ...t, d: 8, h: 30, roof: 12 } : t)),
    walls: loop(0, 8),
    gates: [{ a: 7, b: 0, portcullis: true, barbican: 10 }],
    halls: [],
    keep: { x: 40, z: 15, w: 70, d: 20, h: 24, t: 3 },
    gateWidth: 3, gateHeight: 5,
  },
  bran: {
    name: 'bran',
    description: 'Bran: a small tall castle round a courtyard on a rock, four unlike towers under pointed roofs',
    // ~40 x 35 m (est.), the ranges ~16 m high, towers 20-26 m (the rock left out)
    wallHeight: 16, wallThick: 3,
    towers: [T(0, 0, 8, 24, { roof: 8 }), T(40, 4, 10, 26, { square: true, roof: 10 }), T(38, 35, 9, 22, { roof: 8 }), T(0, 35, 8, 20, { square: true, roof: 6 })],
    walls: loop(0, 4),
    gates: [{ a: 3, b: 0, portcullis: true, barbican: 0 }],
    halls: [],
    gateWidth: 3, gateHeight: 5,
  },
  eltz: {
    name: 'eltz',
    description: 'Eltz: eight tall residential towers under pointed roofs, crowded round an oval courtyard',
    // ~80 x 48 m (est., widened for a courtyard between 1:4's towers), the houses 30-40 m high: square towers 35 m under roofs, the ranges between 25 m
    wallHeight: 25, wallThick: 4,
    towers: ellipseTowers(40, 24, 40, 24, 8, 10, 35, { square: true, roof: 10 }),
    walls: loop(0, 8),
    gates: [{ a: 7, b: 0, portcullis: false, barbican: 0 }],
    halls: [],
    gateWidth: 3, gateHeight: 5,
  },
  castel_del_monte: {
    name: 'castel_del_monte',
    description: 'Castel del Monte: Frederick II\'s pure octagon, a tower at each corner round an octagonal court',
    // sides 16.5 m (the gate side widened for a gate at every scale), walls 25 m high and 3 m thick, the corner towers
    // 7.9 m across (octagonal, drawn round) and 26 m high
    wallHeight: 25, wallThick: 3,
    towers: ellipseTowers(21.6, 21.6, 21.6, 21.6, 8, 7.9, 26),
    walls: loop(0, 8),
    gates: [{ a: 7, b: 0, portcullis: false, barbican: 0 }],
    halls: [],
    gateWidth: 3, gateHeight: 5,
  },
  spis: {
    name: 'spis',
    description: 'Spiš: a hill of terraced wards, the round keep and palace on the summit, Jiskra\'s round fort in the lower court',
    // ~290 x 140 m: the lower court, the middle court ~100 x 60 m and the upper castle, each behind a gate; the round
    // keep ~20 m across (the hill and cliffs left out)
    wallHeight: 10, wallThick: 3,
    towers: [T(0, 63, 8, 14), T(0, 87, 8, 14), T(60, 10, 10, 14), T(130, 20, 8, 12), T(180, 40, 8, 12), T(230, 45, 8, 14), T(290, 60, 10, 16),
      T(290, 95, 10, 16), T(230, 100, 8, 14), T(180, 100, 8, 12), T(130, 130, 8, 12), T(60, 140, 10, 14), T(262, 72, 20, 25), T(65, 75, 17, 12)],
    walls: [[0, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 1], [1, 0], [3, 10], [5, 8]],
    gates: [{ a: 1, b: 0, portcullis: true, barbican: 10 }, { a: 3, b: 10, portcullis: false, barbican: 0 }, { a: 5, b: 8, portcullis: true, barbican: 0 }],
    halls: [{ x0: 238, x1: 285, z0: 86, z1: 100, h: 12 }],
    gateWidth: 3, gateHeight: 5,
  },
  prague_castle: {
    name: 'prague_castle',
    description: 'Prague Castle: a long walled ridge of courtyards and palaces, Vladislav Hall, round and square towers at the east end',
    // 570 x 128 m; Vladislav Hall 62 x 16 x 13 m; Mihulka and Daliborka round, the White and Black Towers square; the palace
    // wings as halls (St Vitus is its own cathedral preset)
    wallHeight: 10, wallThick: 2,
    towers: [T(0, 52, 8, 14, { square: true }), T(0, 76, 8, 14, { square: true }), T(150, 0, 10, 20, { square: true }), T(300, 0, 12, 20),
      T(450, 10, 10, 20, { square: true }), T(570, 30, 12, 20), T(570, 100, 12, 22, { square: true }), T(450, 128, 10, 18, { square: true }),
      T(300, 128, 10, 16, { square: true }), T(150, 128, 10, 16, { square: true }), T(0, 0, 10, 16, { square: true }), T(0, 128, 10, 16, { square: true })],
    walls: [[10, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 11], [11, 1], [1, 0], [0, 10], [2, 9], [3, 8]],
    gates: [{ a: 1, b: 0, portcullis: true, barbican: 0 }, { a: 2, b: 9, portcullis: false, barbican: 0 }, { a: 3, b: 8, portcullis: false, barbican: 0 }],
    halls: [{ x0: 15, x1: 140, z0: 0, z1: 20, h: 18 }, { x0: 15, x1: 140, z0: 108, z1: 128, h: 18 }, { x0: 320, x1: 390, z0: 108, z1: 128, h: 14 }],
    gateWidth: 3, gateHeight: 5,
  },
  kenilworth: {
    name: 'kenilworth',
    description: 'Kenilworth: a red sandstone palace-castle, the Norman keep and John of Gaunt\'s great hall in a wide outer bailey',
    // the outer bailey ~200 x 150 m behind Mortimer's Tower (the mere left out); the inner court ~70 x 70 m; the keep
    // 25 x 20 m, 30 m high, walls 5 m
    wallHeight: 10, wallThick: 4,
    towers: [T(0, 63, 8, 12, { square: true }), T(0, 87, 8, 12, { square: true }), T(0, 0, 8, 10), T(100, 0, 8, 10), T(200, 0, 8, 10), T(200, 150, 8, 10),
      T(100, 150, 8, 10), T(0, 150, 8, 10),
      T(90, 40, 10, 20, { square: true }), T(160, 40, 8, 18, { square: true }), T(160, 75, 8, 18, { square: true }), T(128, 110, 8, 18, { square: true }),
      T(90, 110, 8, 18, { square: true })],
    walls: [[2, 3, 8, 2], [3, 4, 8, 2], [4, 5, 8, 2], [5, 6, 8, 2], [6, 7, 8, 2], [7, 1, 8, 2], [1, 0, 8, 2], [0, 2, 8, 2], ...loop(8, 5)],
    gates: [{ a: 1, b: 0, portcullis: true, barbican: 12 }, { a: 12, b: 8, portcullis: true, barbican: 0 }],
    halls: [{ x0: 95, x1: 150, z0: 40, z1: 55, h: 14 }],
    keep: { x: 135, z: 88, w: 25, d: 20, h: 30, t: 5 },
    gateWidth: 3, gateHeight: 5,
  },
};

/** A civic preset: no curtain, gates or halls unless given. */
const civic = (name: string, category: string, title: string, place: string, built: string, description: string, more: Partial<CastlePreset>): CastlePreset => ({
  name, description, kind: 'civic', category, title, place, built,
  wallHeight: 0, wallThick: 0, towers: [], walls: [], gates: [], halls: [], gateWidth: 3, gateHeight: 5, ...more,
});

/** The civic tier's tower houses, town gates, fortified manors and watchtowers (kind 'civic'; the monument picker never
 *  sees them: CIVIC_SOURCE hands them to civic.ts). Measures from the sources in runs/2026-10-31/monuments40/report.md;
 *  each turned so its door or gate faces west. */
export const CASTLE_CIVIC: Record<string, CastlePreset> = {
  // Tower houses
  threave: civic('threave', 'tower house', 'Threave Castle', 'Galloway', '1369', 'the Black Douglases\' tall tower house, an artillery wall with round towers before it', {
    // the tower 18.4 x 12.1 m, 21 m, walls ~2 m; the artillery wall 6 m high and 1.5 m thick, its round towers ~5 m
    // across (est.), drawn further out than its real 4.4 m from the tower
    wallHeight: 6, wallThick: 1.5, towers: [T(0, 0, 0, 0), T(55, 0, 5, 10), T(55, 35, 5, 10), T(0, 35, 0, 0)], walls: loop(0, 4),
    gates: [{ a: 3, b: 0, portcullis: true, barbican: 0 }], keep: { x: 14, z: 11, w: 18.4, d: 12.1, h: 21, t: 2 },
  }),
  eilean_donan: civic('eilean_donan', 'tower house', 'Eilean Donan', 'Loch Duich', '13th c., rebuilt 1912-1932', 'a keep on a tidal island in a small walled courtyard', {
    // the keep 16.5 x 12.4 m, walls 3 m, ~16 m high (est.); the courtyard ~45 x 26 m (est.); the island and bridge left out
    wallHeight: 7, wallThick: 2, towers: [T(0, 0, 0, 0), T(45, 0, 0, 0), T(45, 26, 0, 0), T(0, 26, 0, 0)], walls: loop(0, 4),
    gates: [{ a: 3, b: 0, portcullis: false, barbican: 0 }], keep: { x: 14, z: 7, w: 16.5, d: 12.4, h: 16, t: 3 },
  }),
  bunratty: civic('bunratty', 'tower house', 'Bunratty Castle', 'County Clare', 'c. 1425', 'a great Irish tower house, a turret at each corner joined by high arches', {
    // ~19 x 13 m (est.), ~25 m high
    keep: { x: 0, z: 0, w: 19, d: 13, h: 25, t: 3 },
  }),
  smailholm: civic('smailholm', 'tower house', 'Smailholm Tower', 'the Scottish Borders', '15th c.', 'a small, tall Border peel tower on a crag', {
    // 12.1 x 9.4 m, ~20 m high, walls 2.4 m (the barmkin and the crag left out)
    keep: { x: 0, z: 0, w: 12.1, d: 9.4, h: 19.8, t: 2.4 },
  }),
  blarney: civic('blarney', 'tower house', 'Blarney Castle', 'County Cork', '1446', 'a tall machicolated tower house over the river', {
    // ~18.3 x 11.9 m, ~27 m high, walls 3.6 m at the base
    keep: { x: 0, z: 0, w: 18.3, d: 11.9, h: 27, t: 3.6 },
  }),
  // Town gates
  holstentor: civic('holstentor', 'town gate', 'the Holstentor', 'Lübeck', '1464-1478', 'two round towers under conical roofs either side of the gate, a stretch of wall each side', {
    // ~30 m wide (est.): the towers ~11 m across, ~20 m to the eaves and ~30 m to the cone tips (est.), the gate block
    // between; drawn 24 m apart, room for a gate at 1:4
    wallHeight: 14, wallThick: 6, towers: [T(0, -20, 0, 0), T(0, 0, 11, 20, { roof: 10 }), T(0, 24, 11, 20, { roof: 10 }), T(0, 44, 0, 0)],
    walls: [[0, 1], [1, 2], [2, 3]], gates: [{ a: 1, b: 2, portcullis: true, barbican: 0 }],
  }),
  westgate_canterbury: civic('westgate_canterbury', 'town gate', 'the Westgate', 'Canterbury', '1379', 'the largest surviving English town gate: two drum towers, the city wall either side', {
    // 18 m high, the drum towers ~8 m across (est.), the city wall 1.2-2.3 m thick
    wallHeight: 8, wallThick: 2, towers: [T(0, -24, 0, 0), T(0, 0, 8, 18), T(0, 24, 8, 18), T(0, 48, 0, 0)],
    walls: [[0, 1], [1, 2], [2, 3]], gates: [{ a: 1, b: 2, portcullis: true, barbican: 0 }],
  }),
  krakow_barbican: civic('krakow_barbican', 'town gate', 'the Barbican', 'Kraków', '1498-1499', 'a round brick barbican with a watch turret before the city gate', {
    // 24.4 m across inside, walls ~3 m, ~12 m high (est.); drawn as one drum tower, its seven turrets as one
    towers: [T(0, 0, 27, 12, { turret: true })],
  }),
  avila_gate: civic('avila_gate', 'town gate', 'the Puerta del Alcázar', 'Ávila', '12th c.', 'two massive half-round towers joined over the gate, in the walls of Ávila with their round towers', {
    // the walls ~12 m high and 3 m thick, round towers every ~20 m (~8 m across, est.; drawn wider apart), the gate's
    // towers 20 m
    wallHeight: 12, wallThick: 3, towers: [T(0, -60, 0, 0), T(0, -36, 8, 16), T(0, 0, 12, 20), T(0, 24, 12, 20), T(0, 60, 8, 16), T(0, 84, 0, 0)],
    walls: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]], gates: [{ a: 2, b: 3, portcullis: true, barbican: 0 }],
  }),
  porta_nigra: civic('porta_nigra', 'town gate', 'the Porta Nigra', 'Trier', 'c. 170', 'a Roman city gate of black sandstone: two towers round-fronted to the field, a gate block between', {
    // ~36 m long, 21.5 m deep, 29.3 m high (the west tower)
    wallHeight: 21, wallThick: 21.5, towers: [T(0, 0, 15, 29), T(0, 24, 15, 29)], walls: [[0, 1]],
    gates: [{ a: 0, b: 1, portcullis: false, barbican: 0 }],
  }),
  // Fortified manors
  stokesay: civic('stokesay', 'fortified manor', 'Stokesay Castle', 'Shropshire', '1285-1291', 'a fortified manor: a great hall between a north tower and a tall south tower, round a walled courtyard', {
    // the courtyard ~46 x 38 m, the hall 16.6 x 9.4 m and ~10 m high, the south tower ~12 m across (est.); the curtain
    // ~10 m from the moat's floor (the moat and the timber gatehouse left out)
    wallHeight: 8, wallThick: 1.5, towers: [T(0, 0, 9, 16), T(46, 0, 12, 20), T(46, 38, 0, 0), T(0, 38, 0, 0)], walls: loop(0, 4),
    gates: [{ a: 3, b: 0, portcullis: false, barbican: 0 }], halls: [{ x0: 10, x1: 36, z0: 0, z1: 13, h: 10 }],
  }),
  ightham_mote: civic('ightham_mote', 'fortified manor', 'Ightham Mote', 'Kent', 'c. 1320-1530', 'a moated manor house: ranges round a courtyard, a gate tower in the west range', {
    wallHeight: 8, wallThick: 6, towers: [T(0, 0, 0, 0), T(36, 0, 0, 0), T(36, 32, 0, 0), T(0, 32, 0, 0), T(0, 28, 7, 14, { square: true }), T(0, 4, 7, 14, { square: true })],
    walls: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]], gates: [{ a: 4, b: 5, portcullis: false, barbican: 0 }],
    halls: [{ x0: 8, x1: 30, z0: 0, z1: 14, h: 9 }],
  }),
  oxburgh_hall: civic('oxburgh_hall', 'fortified manor', 'Oxburgh Hall', 'Norfolk', '1482', 'a moated brick manor round a courtyard, entered through a tall twin-turreted gatehouse', {
    wallHeight: 10, wallThick: 6, towers: [T(0, 0, 0, 0), T(55, 0, 0, 0), T(55, 50, 0, 0), T(0, 50, 0, 0), T(0, 37, 8, 24, { square: true }), T(0, 13, 8, 24, { square: true })],
    walls: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]], gates: [{ a: 4, b: 5, portcullis: false, barbican: 0 }],
    halls: [{ x0: 8, x1: 47, z0: 0, z1: 14, h: 10 }, { x0: 8, x1: 47, z0: 36, z1: 50, h: 10 }],
  }),
  markenfield_hall: civic('markenfield_hall', 'fortified manor', 'Markenfield Hall', 'North Yorkshire', '1310', 'a moated manor: a first-floor hall and its chapel tower on a walled courtyard', {
    wallHeight: 7, wallThick: 2, towers: [T(0, 0, 0, 0), T(42, 0, 7, 14, { square: true }), T(42, 40, 0, 0), T(0, 40, 0, 0)], walls: loop(0, 4),
    gates: [{ a: 3, b: 0, portcullis: false, barbican: 0 }], halls: [{ x0: 6, x1: 32, z0: 0, z1: 14, h: 10 }],
  }),
  haddon_hall: civic('haddon_hall', 'fortified manor', 'Haddon Hall', 'Derbyshire', '12th-16th c.', 'a rambling manor of two courtyards, the banqueting hall and the long gallery, the Eagle Tower', {
    wallHeight: 9, wallThick: 4, towers: [T(0, 0, 0, 0), T(50, 0, 0, 0), T(90, 0, 8, 20, { square: true }), T(90, 55, 0, 0), T(50, 55, 0, 0), T(0, 55, 0, 0),
      T(0, 40, 6, 14, { square: true }), T(0, 15, 6, 14, { square: true })],
    walls: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0], [1, 4]],
    gates: [{ a: 6, b: 7, portcullis: false, barbican: 0 }, { a: 1, b: 4, portcullis: false, barbican: 0 }],
    halls: [{ x0: 55, x1: 85, z0: 0, z1: 12, h: 12 }, { x0: 55, x1: 88, z0: 45, z1: 55, h: 10 }],
  }),
  // Watchtowers
  martello_tower: civic('martello_tower', 'watchtower', 'a Martello tower', 'the coast of Kent and Sussex', '1805-1812', 'a squat round gun tower of thick brick, two storeys and a gun platform', {
    // ~14.5 m across, ~10 m high, walls ~2.4 m (the first-floor door drawn at the ground)
    towers: [T(0, 0, 14.5, 10)],
  }),
  torre_de_belem: civic('torre_de_belem', 'watchtower', 'the Belém Tower', 'Lisbon', '1514-1519', 'a square Manueline tower over a bastion with corner watch turrets, on the Tagus', {
    // the tower ~12 m square and 30 m; the bastion ~36 x 24 m (est.) with its turrets, drawn a little apart from the tower
    wallHeight: 8, wallThick: 2, towers: [T(20, 0, 4, 10), T(44, 0, 4, 10), T(56, 12, 4, 10), T(44, 24, 4, 10), T(20, 24, 4, 10)], walls: loop(0, 5),
    gates: [{ a: 3, b: 4, portcullis: false, barbican: 0 }], keep: { x: 0, z: 6, w: 12, d: 12, h: 30, t: 2 },
  }),
  torre_del_oro: civic('torre_del_oro', 'watchtower', 'the Torre del Oro', 'Seville', '1220-1221', 'a twelve-sided Almohad watchtower on the river, smaller stages on top', {
    // 15.2 m across, ~20 m to the first stage's top (est.), 36.75 m with the upper stages (the dodecagon drawn round,
    // the stages as a turret)
    towers: [T(0, 0, 15.2, 20, { turret: true })],
  }),
  tour_de_constance: civic('tour_de_constance', 'watchtower', 'the Tour de Constance', 'Aigues-Mortes', '1242-1254', 'a great round tower with walls 6 m thick, a lantern turret on top', {
    // 22 m across, walls 6 m, ~32 m to the terrace, the lantern turret ~11 m
    towers: [T(0, 0, 22, 32, { turret: true })],
  }),
  galata_tower: civic('galata_tower', 'watchtower', 'the Galata Tower', 'Istanbul', '1348', 'a tall round Genoese tower under a conical roof', {
    // 16.45 m across, walls 3.75 m, the cone from ~48 m to 62.6 m (67 m with the finial)
    towers: [T(0, 0, 16.45, 48, { roof: 14.6 })],
  }),
};

/** CASTLE_CIVIC for the civic tier (civic.ts reads castleGen's CIVIC_SOURCE): small jobs, the village's blocks. */
export const CIVIC_SOURCE: CivicSource = {
  family: 'castle',
  entries: Object.values(CASTLE_CIVIC).map((p) => ({ id: p.name, title: p.title!, kind: p.category!, age: 'stone', description: p.description, place: p.place!, built: p.built! })),
  draw: (id, scale) => generateCastle(CASTLE_CIVIC[id], scale, { jobMin: 150, jobMax: 450, blocks: CIVIC_BLOCK }),
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
/** The job size (300/800), and each block swapped before the bill is made (the civic tier's CIVIC_BLOCK). */
export interface CastleOpts { jobMin?: number; jobMax?: number; blocks?: (block: string) => string }

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const STEP4: Array<[number, number, string]> = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];

/** Draw a preset at 1:scale. `opts.jobMin`/`jobMax` set the job size (300/800). */
export function generateCastle(p: CastlePreset, scale: number, opts: CastleOpts = {}): Castle {
  const s = (m: number, min = 1) => Math.max(min, Math.round(m / scale));
  const gateW = s(p.gateWidth, 1), gateH = s(p.gateHeight, 3);
  // (the curtain stands above its passages, their portcullis row and a lintel; towers above the curtain)
  const wallH = p.walls.length ? Math.max(s(p.wallHeight), gateH + 2) : 0;
  const thick = s(p.wallThick, 1);
  const segH = p.walls.map((w) => (w.length > 2 ? Math.max(s(w[2]!), gateH + 2) : wallH));
  const segT = p.walls.map((w) => (w.length > 3 ? s(w[3]!, 1) : thick));
  const maxT = Math.max(thick, ...segT);
  const towers = p.towers.map((t) => {
    const d = t.d ? s(t.d, 5) : 0;
    return { cx: Math.round(t.x / scale), cz: Math.round(t.z / scale), r: d / 2, t: d >= 8 ? 2 : 1, h: Math.max(s(t.h), wallH + 3), turret: !!t.turret,
      square: !!t.square, roof: t.roof ? s(t.roof, 3) : 0 };
  });
  const barbs = p.gates.map((g) => (g.barbican ? s(g.barbican, 3) : 0));
  // (a civic tower house's keep may be smaller: 5 blocks across leaves 3 inside, still walkable)
  const kMin = p.kind === 'civic' ? 5 : 7;
  const keep = p.keep && { x0: Math.round(p.keep.x / scale), z0: Math.round(p.keep.z / scale), w: s(p.keep.w, kMin), d: s(p.keep.d, kMin), h: s(p.keep.h, 8), t: s(p.keep.t, 1), round: p.keep.round };

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
  const wallCells: Array<{ x: number; z: number; seg: number; along: number; h: number; t: number }> = [];
  const wallTop = new Map<string, number>();

  // Curtain segments: the cells whose centre lies within the wall's thickness of the line between two tower centres (a
  // ring listed clockwise, west to east along the north)
  p.walls.forEach(([ia, ib], seg) => {
    const A = towers[ia], B = towers[ib], thick = segT[seg];
    const dx = B.cx - A.cx, dz = B.cz - A.cz, len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    for (let x = Math.min(A.cx, B.cx) - thick; x <= Math.max(A.cx, B.cx) + thick; x++)
      for (let z = Math.min(A.cz, B.cz) - thick; z <= Math.max(A.cz, B.cz) + thick; z++) {
        const ax = x - A.cx, az = z - A.cz;
        const along = ax * ux + az * uz, across = -ax * uz + az * ux;
        // (the ring runs clockwise, so +across is inward: the wall thickens into the ward and the towers, centred on its
        // outer face, stand out from it as Conwy's do)
        if (along < 0 || along > len || across < -thick / 2 + 0.01 || across >= thick / 2 + 0.01) continue;
        if (!mask.has(k2(x, z))) { mask.set(k2(x, z), 'wall'); wallCells.push({ x, z, seg, along, h: segH[seg], t: thick }); wallTop.set(k2(x, z), segH[seg]); }
      }
  });
  const inDisc = (t: (typeof towers)[number], x: number, z: number, dr = 0) =>
    (t.square ? Math.max(Math.abs(x - t.cx), Math.abs(z - t.cz)) : Math.hypot(x - t.cx, z - t.cz)) <= t.r + dr;
  for (const t of towers)
    if (t.r) for (let x = Math.floor(t.cx - t.r); x <= Math.ceil(t.cx + t.r); x++)
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
    for (let y = 1; y <= c.h; y++) set(c.x, y, c.z, y === 1 ? M.plinth : M.wall, S.walls);
  }
  // The wall-walk's battlements: a parapet on the outer face and merlons on every other cell above it (at one block thick,
  // the merlons stand on the wall itself)
  // (the barbicans stand in the outside the flood fill found: a wall's face toward one is still its outer face)
  const outerFace = (x: number, z: number) => STEP4.some(([dx, dz]) => isOut(x + dx, z + dz));
  for (const c of wallCells) {
    if (mask.get(k2(c.x, c.z)) !== 'wall' || !outerFace(c.x, c.z)) continue;
    if (c.t > 1) set(c.x, c.h + 1, c.z, M.wall, S.top);
    if ((c.x + c.z) % 2 === 0) set(c.x, c.h + (c.t > 1 ? 2 : 1), c.z, M.wall, S.top);
  }

  // 4. Drum towers: the disc's ring from the floor to the top, the inside cleared, timber floors at the wall-walk and
  // halfway up, a top of slabs; doors to the ward and to the wall-walk; slits in the outer face; battlements
  towers.forEach((t) => {
    if (!t.r) return;
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
    // (a lone tower, or one on a wall with no ward behind it, a town gate's: its door faces west)
    if (!target) target = [Math.floor(t.cx - t.r) - 1, Math.round(t.cz)];
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
        const top = STEP4.map(([dx, dz]) => (mask.get(k2(x + dx, z + dz)) === 'wall' ? wallTop.get(k2(x + dx, z + dz))! : -1))
          .find((h, i) => h >= 0 && get(x + STEP4[i][0], h, z + STEP4[i][1]));
        if (top !== undefined) { clear(x, top + 1, z); clear(x, top + 2, z); }
      }
    // Arrow slits: two high, on the outer face, every third cell round, one at each storey above the ground's
    for (const x of xs)
      for (const z of zs) {
        if (!ring(x, z) || !outerFace(x, z)) continue;
        const a = Math.round(((Math.atan2(z - t.cz, x - t.cx) + Math.PI) / (2 * Math.PI)) * Math.round(2 * Math.PI * t.r));
        if (a % 3) continue;
        for (const base of [3, ...floors.map((f) => f + 2)]) if (base + 1 < t.h && base + 1 < (floors.find((f) => f > base) ?? t.h)) { clear(x, base, z); clear(x, base + 1, z); }
      }
    // A conical roof (a pyramid on a square tower) from the top's rim, in place of the battlements and turret
    if (t.roof) {
      for (let i = 0; i < t.roof; i++) {
        const r = (t.r + 0.5) * (1 - i / t.roof);
        const inR = (x: number, z: number) => (t.square ? Math.max(Math.abs(x - t.cx), Math.abs(z - t.cz)) : Math.hypot(x - t.cx, z - t.cz)) <= r;
        let any = false;
        for (const x of xs)
          for (const z of zs)
            if (inR(x, z) && STEP4.some(([dx, dz]) => !inR(x + dx, z + dz))) { set(x, t.h + 1 + i, z, M.timber, S.top); any = true; }
        if (!any) set(Math.round(t.cx), t.h + 1 + i, Math.round(t.cz), M.timber, S.top);
      }
      set(Math.round(t.cx), t.h + 1 + t.roof, Math.round(t.cz), M.post, S.top);
      return;
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
        if ((alongZ ? c.z : c.x) !== along || mask.get(k2(c.x, c.z)) !== 'wall' || (alongZ ? Math.abs(c.x - mx) : Math.abs(c.z - mz)) > maxT) continue;
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
  stageNames: string[], opts: CastleOpts): Castle {
  if (opts.blocks) for (const [kk, b] of cells) cells.set(kk, opts.blocks(b));
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
