/**
 * Timber-framed and vernacular buildings drawn by code (the civic tier, civic.ts): guildhalls and town halls, market halls
 * on posts or arcades, tithe barns, mills, inns and almshouses, 30 real ones as presets of their measures in metres (1 m
 * = 1 block at 1:1; approximate, from the published dimensions; runs/2026-10-31/civic/report.md lists the sources). The
 * scale divides them, with minimums that keep every storey walkable.
 *
 * Forms: a hall (a range of storeys, each jettied out over the one below on the sides that jetty, framed, boarded or of
 * stone, under a roof with cross-gables, porches, chimneys, a louvre, corner turrets or a tower), a court (ranges round a
 * yard: a row, an L, a U or a quadrangle, with galleries to the yard for inns), and the mills (a smock or tower mill, a
 * post mill on its trestle, a watermill with its wheel, and the Laxey wheel on its pier). Roofs are civicDraw's height
 * fields, so every stair faces uphill and gables, porches and wings join. Long axis west to east (x), the door in the
 * west at x = 0 toward the village. Code draws every cell, so the bill is exact (lesson 1).
 */
import type { Cathedral } from './gothicGen';
import { C, Grid, ROOF_BRICK, ROOF_COBBLE, ROOF_WOOD, cone, drawRoof, finishCivic, gableFill, ring, roundShell, scaled, squareShell, type RoofMat, type RoofPart } from './civicDraw';

export type WallStyle = 'timber' | 'boarded' | 'stone' | 'rubble' | 'brick' | 'sandstone' | 'plaster';
export type TimberKind = 'guildhall' | 'market_hall' | 'tithe_barn' | 'mill' | 'inn' | 'almshouse';

export interface TimberPreset {
  name: string;
  /** Its name in lines ("Lavenham Guildhall"). */
  title: string;
  kind: TimberKind;
  description: string;
  /** Where and when (for the report and the chooser's line). */
  place: string;
  built: string;
  form: 'hall' | 'court' | 'smock' | 'postmill' | 'towermill' | 'watermill' | 'wheel';
  /** The outer box (metres): along x, along z. */
  length: number;
  width: number;
  storeys: number;
  /** A storey's height (metres). */
  storey: number;
  /** The ground storey's walls, and the walls above (one style when `upper` is absent); 'open': posts or arches only. */
  ground: WallStyle | 'open' | 'arcade';
  upper?: WallStyle;
  /** Each upper storey's jetty (metres) and the sides it jetties on. */
  jetty?: number;
  jettySides?: 'front' | 'end' | 'all';
  /** The frame's bay (metres between posts) and close studding (a post every second cell). */
  bay?: number;
  close?: boolean;
  /** The roof: rise per run (1: 45 degrees), hipped, its covering (wood shingles or thatch, stone slate, stone). */
  pitch: number;
  hip?: boolean;
  roof: 'wood' | 'slate' | 'stone';
  /** Cross-gables on the front (z = 0) and on both long sides ('both'), centred along the length at these fractions. */
  gables?: number[];
  gableSides?: 'front' | 'both';
  /** Stepped gable walls standing above the roof (the Römer's). */
  stepped?: boolean;
  /** Two parallel ridges (a double pile: the Merchant Adventurers' Hall). */
  piles?: 1 | 2;
  /** Wagon porches on the long sides, centred at these fractions: width and depth (metres). */
  porches?: { at: number[]; width: number; depth: number; sides: 'front' | 'both' };
  buttresses?: boolean;
  /** Interior posts in two rows (an aisled barn). */
  aisled?: boolean;
  chimneys?: number;
  louvre?: boolean;
  /** Corner turrets on the front with spires (Michelstadt's oriels, Abbot's Hospital's): their diameter (metres). */
  turrets?: number;
  /** A tower: its side and height (metres), its top, and where it stands (the front's middle, or the west end). */
  tower?: { size: number; height: number; top: 'spire' | 'pyramid' | 'cupola' | 'turrets'; at: 'middle' | 'west' };
  /** A court's shape and its ranges' depth (metres); galleries to the yard on the upper storeys. */
  court?: { shape: 'L' | 'U' | 'quad'; depth: number };
  gallery?: boolean;
  /** Doors along the front (a row of almshouses' doors). */
  doors?: number;
  /** A mill's measures (metres). Windmill: body's diameter at the foot and the top, its height, the sails' span, a gallery
   *  (stage) at this height, the sides (8: octagonal), arches under the tower (Chesterton's). Watermill: the wheel's
   *  diameter and width. Laxey: the wheel's, the pier's height and the viaduct's length. */
  mill?: { base?: number; top?: number; height?: number; sails?: number; stage?: number; sides?: 0 | 8; arches?: number; wheel?: number; wheelWidth?: number; viaduct?: number; body?: [number, number, number]; trestle?: number };
}

/** A preset, short. */
const P = (p: TimberPreset) => p;

export const TIMBER_PRESETS: Record<string, TimberPreset> = {
  // Guildhalls and town halls
  lavenham_guildhall: P({ name: 'lavenham_guildhall', title: 'Lavenham Guildhall', kind: 'guildhall', place: 'Lavenham, Suffolk', built: '1529',
    description: 'a close-studded wool guildhall, its upper storey jettied over the street, a gabled cross-wing at the west end',
    form: 'hall', length: 21, width: 7, storeys: 2, storey: 3, ground: 'timber', jetty: 0.6, jettySides: 'front', bay: 2.4, close: true,
    pitch: 1.2, roof: 'wood', gables: [0.13], chimneys: 1 }),
  romer: P({ name: 'romer', title: 'the Römer', kind: 'guildhall', place: 'Frankfurt', built: '1405',
    description: 'Frankfurt\'s town hall: three stone houses side by side, each under its own stepped gable to the square',
    form: 'hall', length: 27, width: 16, storeys: 4, storey: 3.6, ground: 'sandstone', upper: 'stone', pitch: 2, roof: 'slate',
    gables: [1 / 6, 1 / 2, 5 / 6], stepped: true, bay: 3 }),
  ypres_cloth_hall: P({ name: 'ypres_cloth_hall', title: 'the Cloth Hall of Ypres', kind: 'guildhall', place: 'Ypres, Flanders', built: '1304 (rebuilt 1967)',
    description: 'a stone cloth hall 125 m long under a steep roof, its belfry rising from the middle of the front',
    form: 'hall', length: 125, width: 18, storeys: 2, storey: 7, ground: 'stone', pitch: 1.6, roof: 'slate', bay: 5, turrets: 3,
    tower: { size: 15, height: 70, top: 'turrets', at: 'middle' } }),
  york_merchant_adventurers: P({ name: 'york_merchant_adventurers', title: 'the Merchant Adventurers\' Hall', kind: 'guildhall', place: 'York', built: '1361',
    description: 'a timber-framed guild hall over a brick undercroft, two parallel roofs, the largest of its age in England',
    form: 'hall', length: 27, width: 12, storeys: 2, storey: 3.5, ground: 'brick', upper: 'timber', bay: 3, pitch: 1, roof: 'wood', piles: 2 }),
  michelstadt_rathaus: P({ name: 'michelstadt_rathaus', title: 'Michelstadt Town Hall', kind: 'guildhall', place: 'Michelstadt, Hesse', built: '1484',
    description: 'a half-timbered town hall on an open hall of oak posts, two corner oriels with spires, a very steep roof',
    form: 'hall', length: 10, width: 9, storeys: 3, storey: 3, ground: 'open', upper: 'timber', bay: 2.5, pitch: 2.4, roof: 'slate', turrets: 2 }),

  // Market halls
  thaxted_guildhall: P({ name: 'thaxted_guildhall', title: 'Thaxted Guildhall', kind: 'market_hall', place: 'Thaxted, Essex', built: 'c. 1450',
    description: 'a market hall of three storeys, the two upper ones jettied out on three sides over an open ground floor',
    form: 'hall', length: 12, width: 7, storeys: 3, storey: 2.7, ground: 'open', upper: 'timber', jetty: 0.6, jettySides: 'all', bay: 2.4, close: true, pitch: 1.2, roof: 'wood' }),
  ledbury_market_house: P({ name: 'ledbury_market_house', title: 'Ledbury Market House', kind: 'market_hall', place: 'Ledbury, Herefordshire', built: 'c. 1617',
    description: 'a black-and-white market house on sixteen chestnut posts, its upper room close-studded',
    form: 'hall', length: 18, width: 7, storeys: 2, storey: 3, ground: 'open', upper: 'timber', bay: 2.6, close: true, pitch: 1.1, roof: 'slate' }),
  chipping_campden_market: P({ name: 'chipping_campden_market', title: 'Chipping Campden Market Hall', kind: 'market_hall', place: 'Chipping Campden, Gloucestershire', built: '1627',
    description: 'an open arcade of Cotswold stone under a stone-slate roof with gables on both long sides',
    form: 'hall', length: 13, width: 8, storeys: 1, storey: 4.5, ground: 'arcade', upper: 'rubble', bay: 2.6, pitch: 1.4, roof: 'stone',
    gables: [0.25, 0.75], gableSides: 'both' }),
  pembridge_market: P({ name: 'pembridge_market', title: 'Pembridge Market Hall', kind: 'market_hall', place: 'Pembridge, Herefordshire', built: 'early 16th century',
    description: 'a stone-tiled roof on eight oak posts and nothing else: the simplest market hall',
    form: 'hall', length: 9, width: 5, storeys: 1, storey: 3, ground: 'open', bay: 3, pitch: 0.9, hip: true, roof: 'stone' }),
  ross_market_house: P({ name: 'ross_market_house', title: 'Ross-on-Wye Market House', kind: 'market_hall', place: 'Ross-on-Wye, Herefordshire', built: '1654',
    description: 'a red sandstone market house: an open arcade below, a hall above, a clock louvre on the ridge',
    form: 'hall', length: 22, width: 9, storeys: 2, storey: 4, ground: 'arcade', upper: 'brick', bay: 3.2, pitch: 1.1, roof: 'slate', louvre: true }),

  // Tithe barns
  great_coxwell: P({ name: 'great_coxwell', title: 'the Great Coxwell barn', kind: 'tithe_barn', place: 'Great Coxwell, Oxfordshire', built: 'c. 1292',
    description: 'a Cotswold stone barn of the Cistercians, buttressed, two wagon porches, its stone-slate roof on an aisled frame',
    form: 'hall', length: 46, width: 13.4, storeys: 1, storey: 5.5, ground: 'rubble', bay: 4, pitch: 1.35, roof: 'stone', buttresses: true, aisled: true,
    porches: { at: [0.5], width: 6, depth: 4, sides: 'both' } }),
  bradford_on_avon: P({ name: 'bradford_on_avon', title: 'the Bradford-on-Avon tithe barn', kind: 'tithe_barn', place: 'Bradford-on-Avon, Wiltshire', built: '14th century',
    description: 'a fourteen-bay stone barn of Shaftesbury Abbey, buttressed, with a wagon porch on each side',
    form: 'hall', length: 51, width: 10, storeys: 1, storey: 5, ground: 'rubble', bay: 3.6, pitch: 1.4, roof: 'stone', buttresses: true,
    porches: { at: [0.42], width: 5, depth: 3.5, sides: 'both' } }),
  abbotsbury_barn: P({ name: 'abbotsbury_barn', title: 'the Abbotsbury tithe barn', kind: 'tithe_barn', place: 'Abbotsbury, Dorset', built: 'c. 1390',
    description: 'once the longest barn in England, of local stone under a thatched roof, two porches on the south side',
    form: 'hall', length: 83, width: 9.4, storeys: 1, storey: 5, ground: 'rubble', bay: 4.5, pitch: 1.3, roof: 'wood', buttresses: true,
    porches: { at: [0.3, 0.7], width: 5, depth: 3, sides: 'front' } }),
  harmondsworth_barn: P({ name: 'harmondsworth_barn', title: 'the Great Barn at Harmondsworth', kind: 'tithe_barn', place: 'Harmondsworth, Middlesex', built: '1426',
    description: 'an oak-framed, weatherboarded barn of twelve bays, aisled, its tiled roof hipped at both ends',
    form: 'hall', length: 58, width: 11.4, storeys: 1, storey: 3.5, ground: 'boarded', bay: 4.8, pitch: 1.2, hip: true, roof: 'wood', aisled: true }),
  glastonbury_barn: P({ name: 'glastonbury_barn', title: 'the Abbey Barn at Glastonbury', kind: 'tithe_barn', place: 'Glastonbury, Somerset', built: '14th century',
    description: 'a cruciform stone barn of Glastonbury Abbey, its two great porches making the arms of a cross',
    form: 'hall', length: 28, width: 10, storeys: 1, storey: 5, ground: 'rubble', bay: 3.5, pitch: 1.3, roof: 'stone', buttresses: true,
    porches: { at: [0.5], width: 7, depth: 5, sides: 'both' } }),

  // Mills
  kinderdijk_mill: P({ name: 'kinderdijk_mill', title: 'a Kinderdijk mill', kind: 'mill', place: 'Kinderdijk, South Holland', built: '1738-1740',
    description: 'an octagonal thatched ground-sailer that drained the polder, its sails sweeping the ground',
    form: 'smock', length: 10, width: 10, storeys: 1, storey: 3, ground: 'timber', pitch: 1, roof: 'wood',
    mill: { base: 10, top: 5, height: 15, sails: 28, sides: 8 } }),
  pitstone_windmill: P({ name: 'pitstone_windmill', title: 'Pitstone Windmill', kind: 'mill', place: 'Pitstone, Buckinghamshire', built: '1627',
    description: 'one of the oldest post mills in Britain: a weatherboarded body turned into the wind on its trestle',
    form: 'postmill', length: 6, width: 4, storeys: 2, storey: 2.7, ground: 'boarded', pitch: 1, roof: 'wood',
    mill: { body: [5.5, 3.7, 6], trestle: 3.5, sails: 16 } }),
  chesterton_windmill: P({ name: 'chesterton_windmill', title: 'Chesterton Windmill', kind: 'mill', place: 'Chesterton, Warwickshire', built: '1632',
    description: 'a round stone tower mill raised on six arches, under a domed cap',
    form: 'towermill', length: 7, width: 7, storeys: 2, storey: 3, ground: 'rubble', pitch: 1, roof: 'stone',
    mill: { base: 7, top: 6.5, height: 10, sails: 17, arches: 6 } }),
  mapledurham_mill: P({ name: 'mapledurham_mill', title: 'Mapledurham Watermill', kind: 'mill', place: 'Mapledurham, Oxfordshire', built: '15th century',
    description: 'the last working corn mill on the Thames, brick and weatherboard, its undershot wheel at the side',
    form: 'watermill', length: 18, width: 8, storeys: 2, storey: 3, ground: 'brick', upper: 'boarded', bay: 3, pitch: 1.1, roof: 'wood',
    mill: { wheel: 5, wheelWidth: 1.5 } }),
  laxey_wheel: P({ name: 'laxey_wheel', title: 'the Laxey Wheel', kind: 'mill', place: 'Laxey, Isle of Man', built: '1854',
    description: 'the largest working waterwheel in the world, 22 m across, on its stone pier at the head of a viaduct',
    form: 'wheel', length: 10, width: 5, storeys: 1, storey: 3, ground: 'stone', pitch: 1, roof: 'stone',
    mill: { wheel: 22, wheelWidth: 1.8, height: 13, viaduct: 30 } }),

  // Inns
  george_southwark: P({ name: 'george_southwark', title: 'the George Inn', kind: 'inn', place: 'Southwark, London', built: '1677',
    description: 'London\'s last galleried coaching inn: three storeys, open galleries along the yard',
    form: 'hall', length: 38, width: 8, storeys: 3, storey: 3, ground: 'brick', upper: 'timber', bay: 3, pitch: 1, roof: 'wood', gallery: true, chimneys: 3 }),
  feathers_ludlow: P({ name: 'feathers_ludlow', title: 'the Feathers', kind: 'inn', place: 'Ludlow, Shropshire', built: '1619',
    description: 'a richly carved timber front of three gables, each storey jettied over the street',
    form: 'hall', length: 14, width: 11, storeys: 3, storey: 3, ground: 'timber', jetty: 0.5, jettySides: 'front', bay: 2.3, pitch: 1.4, roof: 'wood',
    gables: [1 / 6, 1 / 2, 5 / 6], chimneys: 2 }),
  new_inn_gloucester: P({ name: 'new_inn_gloucester', title: 'the New Inn', kind: 'inn', place: 'Gloucester', built: 'c. 1450',
    description: 'a pilgrims\' inn round a courtyard, timber-framed, with galleries on every side of the yard',
    form: 'court', length: 32, width: 26, storeys: 3, storey: 3, ground: 'timber', bay: 3, pitch: 1.1, roof: 'wood', gallery: true,
    court: { shape: 'quad', depth: 7 }, chimneys: 2 }),
  george_norton: P({ name: 'george_norton', title: 'the George at Norton St Philip', kind: 'inn', place: 'Norton St Philip, Somerset', built: 'c. 1397',
    description: 'a stone ground floor under two timber-framed storeys jettied over the street, among the oldest inns in England',
    form: 'hall', length: 20, width: 9, storeys: 3, storey: 3, ground: 'rubble', upper: 'timber', jetty: 0.5, jettySides: 'front', bay: 2.5, pitch: 1.2, roof: 'slate', chimneys: 2 }),
  zum_riesen: P({ name: 'zum_riesen', title: 'the Riesen inn', kind: 'inn', place: 'Miltenberg, Bavaria', built: '1590',
    description: 'Germany\'s oldest inn: a tall half-timbered gable to the street, each storey jettied over the last',
    form: 'hall', length: 16, width: 11, storeys: 4, storey: 3, ground: 'sandstone', upper: 'timber', jetty: 0.4, jettySides: 'end', bay: 2.2, pitch: 1.8, roof: 'slate' }),

  // Almshouses
  st_cross: P({ name: 'st_cross', title: 'the Hospital of St Cross', kind: 'almshouse', place: 'Winchester', built: '1445',
    description: 'the brethren\'s stone ranges round the outer court, each lodging with its own tall chimney',
    form: 'court', length: 50, width: 36, storeys: 2, storey: 3, ground: 'rubble', bay: 3.5, pitch: 1.1, roof: 'slate', chimneys: 8,
    court: { shape: 'L', depth: 8 } }),
  lord_leycester: P({ name: 'lord_leycester', title: 'the Lord Leycester Hospital', kind: 'almshouse', place: 'Warwick', built: '1571 (in 14th-century guild buildings)',
    description: 'timber-framed guild buildings round a galleried courtyard, given to old soldiers',
    form: 'court', length: 28, width: 24, storeys: 2, storey: 3, ground: 'timber', bay: 2.5, close: true, pitch: 1.2, roof: 'wood', gallery: true,
    court: { shape: 'quad', depth: 6 }, jetty: 0.5, jettySides: 'front' }),
  fuggerei: P({ name: 'fuggerei', title: 'the Fuggerei', kind: 'almshouse', place: 'Augsburg', built: '1516-1523',
    description: 'the oldest social housing in the world: a row of plastered two-storey houses, a door to each',
    form: 'hall', length: 56, width: 9, storeys: 2, storey: 3, ground: 'plaster', bay: 3.5, pitch: 1.3, roof: 'slate', doors: 8, chimneys: 8 }),
  ewelme: P({ name: 'ewelme', title: 'the Ewelme almshouses', kind: 'almshouse', place: 'Ewelme, Oxfordshire', built: '1437',
    description: 'a brick and timber cloister of thirteen lodgings round a square court, one of the earliest brick buildings in England',
    form: 'court', length: 25, width: 25, storeys: 1, storey: 3.5, ground: 'brick', bay: 2.5, pitch: 1.1, roof: 'slate', gallery: true,
    court: { shape: 'quad', depth: 6 }, chimneys: 4 }),
  abbots_hospital: P({ name: 'abbots_hospital', title: 'Abbot\'s Hospital', kind: 'almshouse', place: 'Guildford, Surrey', built: '1619',
    description: 'a brick quadrangle entered under a gatehouse tower with four turrets',
    form: 'court', length: 30, width: 30, storeys: 2, storey: 3.2, ground: 'brick', bay: 3, pitch: 1.2, roof: 'slate', chimneys: 6,
    court: { shape: 'quad', depth: 6.5 }, tower: { size: 7, height: 17, top: 'turrets', at: 'west' } }),
};

export const TIMBER_STAGES = ['pad and floor', 'ground storey', 'upper storeys', 'roof', 'towers and details'] as const;
const S = { pad: 1, ground: 2, upper: 3, roof: 4, top: 5 } as const;

/** A wall style's block at a wall cell: u along the wall from its start, v up from the storey's foot (0 = its sill), the
 *  storey's height, the wall's length and its axis. Windows in the middle of every second bay (none on a barn). */
function wallCell(style: WallStyle, u: number, v: number, sh: number, len: number, axis: 'x' | 'z', bay: number, close: boolean, windows: boolean): string {
  const corner = u === 0 || u === len - 1;
  const beam = axis === 'x' ? C.beamX : C.beamZ;
  const inBay = u % bay, bayNo = Math.floor(u / bay);
  const win = windows && v >= 1 && v <= Math.max(1, sh - 2) && bay >= 3 && bayNo % 2 === 1 && inBay >= 1 && inBay <= bay - 2 && !corner;
  if (style === 'timber' || style === 'boarded') {
    if (corner || inBay === 0) return C.post;
    if (v === sh - 1 || v === 0 && style === 'timber') return beam;
    if (win) return C.pane;
    if (style === 'boarded') return C.planks;
    if (close && u % 2 === 0) return C.post;
    // (a brace in the bays without a window: the diagonal from the post up)
    if (!close && bay >= 3 && bayNo % 2 === 0 && (inBay === v || bay - inBay === v)) return C.post;
    return C.planks;
  }
  if (win) return C.pane;
  if (style === 'rubble') return corner ? C.bricks : C.cobble;
  if (style === 'stone') return C.bricks;
  if (style === 'brick') return corner && v % 2 === 0 ? C.bricks : C.red;
  if (style === 'sandstone') return corner ? C.cutSand : C.sand;
  return corner ? C.bricks : C.stone;
}

const ROOFS: Record<TimberPreset['roof'], RoofMat> = { wood: ROOF_WOOD, slate: ROOF_BRICK, stone: ROOF_COBBLE };

/** Draw a preset at 1:scale. */
export function generateTimber(p: TimberPreset, scale: number, opts: { jobMin?: number; jobMax?: number } = {}): Cathedral {
  const g = new Grid();
  const s = scaled(scale);
  if (p.form === 'hall') hall(g, p, s, 0, 0);
  else if (p.form === 'court') court(g, p, s);
  else if (p.form === 'smock' || p.form === 'towermill') windmill(g, p, s);
  else if (p.form === 'postmill') postmill(g, p, s);
  else if (p.form === 'watermill') { hall(g, p, s, 0, 0); waterwheel(g, p, s); }
  else laxey(g, p, s);
  return finishCivic(p.name, `${p.title}, ${p.place} (${p.built}): ${p.description}`, scale, g, TIMBER_STAGES, 'timberGen', opts.jobMin, opts.jobMax);
}

/** The hall's measures at the scale. */
function hallDims(p: TimberPreset, s: ReturnType<typeof scaled>) {
  return {
    L: s(p.length, 5), B: s(p.width, 4), n: p.storeys, sh: s(p.storey, 3),
    jet: p.jetty ? Math.max(0, Math.min(1, s(p.jetty, 0) || (s(1, 1) <= 2 ? 1 : 0))) : 0,
    bay: Math.max(2, s(p.bay ?? 3, 2)),
  };
}

/**
 * A hall at (x0, z0): storeys of walls on a floor, the upper ones jettied, floors between them, a roof of the preset's
 * parts over the top storey, and the hall's extras. `axis` 'z' turns it (a court's east and west ranges). Returns the
 * roof parts it drew (a court joins its ranges' roofs in one height field).
 */
function hall(g: Grid, p: TimberPreset, s: ReturnType<typeof scaled>, x0: number, z0: number, dims?: { L: number; B: number }, axis: 'x' | 'z' = 'x', opts: { door?: boolean; yardSide?: 'front' | 'back' } = {}): RoofPart[] {
  const d = hallDims(p, s);
  const L = dims?.L ?? d.L, B = dims?.B ?? d.B, { n, sh, jet, bay } = d;
  // (local u along the length, w across; world cells by the axis)
  const W = (u: number, w: number): [number, number] => (axis === 'x' ? [x0 + u, z0 + w] : [x0 + w, z0 + u]);
  const set = (u: number, y: number, w: number, b: string, st: number) => { const [x, z] = W(u, w); g.set(x, y, z, b, st); };
  const sides = p.jettySides ?? 'front';
  const box = (k: number) => {
    const j = jet * k;
    return {
      u0: sides === 'all' || sides === 'end' ? -j : 0, u1: L - 1 + (sides === 'all' ? j : 0),
      w0: sides === 'front' || sides === 'all' ? -j : 0, w1: B - 1 + (sides === 'all' ? j : 0),
    };
  };
  const windows = p.kind !== 'tithe_barn';
  // Pad and floor
  for (let u = 0; u < L; u++) for (let w = 0; w < B; w++) set(u, 0, w, p.ground === 'open' || p.ground === 'arcade' || p.kind === 'tithe_barn' ? C.cobble : C.planks, S.pad);
  for (let k = 0; k < n; k++) {
    const b = box(k), y0 = k * sh;
    const style: WallStyle | 'open' | 'arcade' = k === 0 ? p.ground : p.upper ?? (p.ground === 'open' || p.ground === 'arcade' ? 'timber' : p.ground);
    const st = k === 0 ? S.ground : S.upper;
    // (the floor over the storey below, out to this storey's jetty)
    // (put: the storey below's top row of wall stays as it is, the floor fills inside it and under the jetty)
    if (k > 0) for (let u = b.u0; u <= b.u1; u++) for (let w = b.w0; w <= b.w1; w++) { const [x, z] = W(u, w); g.put(x, y0, z, C.planks, st); }
    const perim = ring(b.u0, b.w0, b.u1, b.w1);
    const lenU = b.u1 - b.u0 + 1, lenW = b.w1 - b.w0 + 1;
    for (const [u, w] of perim) {
      const alongU = w === b.w0 || w === b.w1;
      const uu = alongU ? u - b.u0 : w - b.w0, len = alongU ? lenU : lenW;
      const ax: 'x' | 'z' = (alongU ? 'x' : 'z') === 'x' ? axis : axis === 'x' ? 'z' : 'x';
      for (let v = 0; v < sh; v++) {
        const y = y0 + 1 + v;
        let blk: string | null;
        if (style === 'open') blk = uu % bay === 0 || uu === len - 1 ? (v === 0 ? C.cobble : C.post) : v === sh - 1 ? (ax === 'x' ? C.beamX : C.beamZ) : null;
        else if (style === 'arcade') {
          const iu = uu % bay, pier = iu === 0 || uu === len - 1;
          blk = pier || v === sh - 1 ? C.bricks : v === sh - 2 && bay >= 3 && (iu === 1 || iu === bay - 1) ? C.brickStair(dirOf(ax, alongU ? (iu === 1 ? -1 : 1) : (iu === 1 ? -1 : 1)), 'top') : null;
        } else blk = wallCell(style, uu, v, sh, len, ax, bay, !!p.close && style === 'timber', windows && (y > 1 || p.kind !== 'tithe_barn'));
        if (blk) set(u, y, w, blk, st);
      }
    }
    // (a gallery to the yard: the floor out one cell over the yard, a rail of fences)
    if (p.gallery && k > 0 && opts.yardSide !== undefined) {
      const w = opts.yardSide === 'back' ? b.w1 + 1 : b.w0 - 1;
      for (let u = b.u0; u <= b.u1; u++) { set(u, y0, w, C.planks, st); set(u, y0 + 1, w, C.fence, st); }
      // (posts down to the yard under the gallery's corners and every bay)
      for (let u = b.u0; u <= b.u1; u += bay) for (let y = 1; y < y0; y++) set(u, y, w, C.post, st);
    }
  }
  // Doors: the west end's middle (toward the village) and along the front
  if (opts.door !== false && p.ground !== 'open' && p.ground !== 'arcade') {
    const wc = Math.floor((B - 1) / 2);
    for (let y = 1; y <= 2; y++) { const [x, z] = W(box(0).u0, wc); g.clear(x, y, z); }
    const nd = p.doors ?? 1;
    for (let i = 0; i < nd; i++) {
      const u = Math.round(((i + 0.5) / nd) * (L - 1));
      for (let y = 1; y <= 2; y++) { const [x, z] = W(u, 0); g.clear(x, y, z); }
    }
  }
  // Buttresses on the long sides of a stone barn, and the aisled frame inside
  if (p.buttresses) for (let u = bay; u < L - 1; u += bay) for (const w of [-1, B]) for (let y = 1; y < sh; y++) set(u, y, w, y === sh - 1 ? C.cobbleStair(dirOf('z', w < 0 ? 1 : -1, axis)) : C.cobble, S.ground);
  if (p.aisled && B >= 7) for (let u = bay; u < L - 1; u += bay) for (const w of [Math.round(B / 4), B - 1 - Math.round(B / 4)]) {
    set(u, 1, w, C.cobble, S.ground);
    for (let y = 2; y <= n * sh + Math.round(B / 4); y++) set(u, y, w, C.post, S.ground);
  }
  // Porches (barns): walls as high as the barn's, open at their outer end
  const porch: RoofPart[] = [];
  const eave = n * sh + 1;
  if (p.porches) {
    const pw = Math.max(3, s(p.porches.width, 3)), pd = Math.max(2, s(p.porches.depth, 2));
    for (const f of p.porches.at) {
      const pu0 = Math.round(f * L - pw / 2), pu1 = pu0 + pw - 1;
      for (const side of p.porches.sides === 'both' ? [-1, 1] : [-1]) {
        const wA = side < 0 ? -pd : B - 1, wB = side < 0 ? 0 : B - 1 + pd;
        for (let u = pu0; u <= pu1; u++) for (let w = wA; w <= wB; w++) set(u, 0, w, C.cobble, S.pad);
        for (let w = wA; w <= wB; w++) for (let y = 1; y < eave; y++) { set(pu0, y, w, wallCell(p.ground as WallStyle, w - wA, y - 1, sh, pd + 1, 'z', bay, false, false), S.ground); set(pu1, y, w, wallCell(p.ground as WallStyle, w - wA, y - 1, sh, pd + 1, 'z', bay, false, false), S.ground); }
        // (the barn's wall opened into the porch, the wagon's way)
        for (let u = pu0 + 1; u < pu1; u++) for (let y = 1; y < eave - 1; y++) g.clear(...W2(W, u, side < 0 ? 0 : B - 1, y));
        const [a, b2] = [W(pu0 - 1, side < 0 ? wA - 1 : B - 1), W(pu1 + 1, side < 0 ? 0 : wB + 1)];
        porch.push({ x0: Math.min(a[0], b2[0]), x1: Math.max(a[0], b2[0]), z0: Math.min(a[1], b2[1]), z1: Math.max(a[1], b2[1]), ridge: axis === 'x' ? 'z' : 'x', rise: p.pitch });
      }
    }
  }
  // The roof: the top storey's box and an overhang of one, its cross-gables and porches
  const top = box(n - 1);
  const parts: RoofPart[] = [];
  const piles = p.piles ?? 1;
  const rect = (u0: number, w0: number, u1: number, w1: number, ridgeAlongU: boolean): RoofPart => {
    const [a0, a1] = [W(u0, w0), W(u1, w1)];
    return { x0: Math.min(a0[0], a1[0]), x1: Math.max(a0[0], a1[0]), z0: Math.min(a0[1], a1[1]), z1: Math.max(a0[1], a1[1]), ridge: (ridgeAlongU ? axis : axis === 'x' ? 'z' : 'x'), rise: p.pitch, hip: p.hip };
  };
  if (piles === 2) {
    const mid = Math.floor((top.w0 + top.w1) / 2);
    parts.push(rect(top.u0 - 1, top.w0 - 1, top.u1 + 1, mid, true), rect(top.u0 - 1, mid, top.u1 + 1, top.w1 + 1, true));
  } else parts.push(rect(top.u0 - 1, top.w0 - 1, top.u1 + 1, top.w1 + 1, true));
  const gw = Math.max(3, Math.min(Math.round((top.u1 - top.u0 + 1) / Math.max(1, (p.gables?.length ?? 1) + 0.5)), top.w1 - top.w0 + 1));
  const gableCells: Array<[number, number]> = [];
  for (const f of p.gables ?? []) {
    const cu = top.u0 + Math.round(f * (top.u1 - top.u0)), u0 = cu - Math.floor(gw / 2), u1 = u0 + gw - 1;
    const midW = Math.floor((top.w0 + top.w1) / 2);
    for (const side of p.gableSides === 'both' ? ['front', 'back'] : ['front']) {
      parts.push(side === 'front' ? rect(u0 - 1, top.w0 - 1, u1 + 1, midW, false) : rect(u0 - 1, midW, u1 + 1, top.w1 + 1, false));
      for (let u = u0; u <= u1; u++) gableCells.push(W(u, side === 'front' ? top.w0 : top.w1));
    }
  }
  parts.push(...porch);
  const roofTop = drawRoof(g, parts, eave, ROOFS[p.roof], S.roof);
  // Gable walls: the top storey's wall line under the roof (its ends, the cross-gables' fronts, the porches' sides)
  const upStyle: WallStyle = (p.upper ?? (p.ground === 'open' || p.ground === 'arcade' ? 'timber' : p.ground)) as WallStyle;
  const wl = ring(top.u0, top.w0, top.u1, top.w1).map(([u, w]) => W(u, w));
  const gableBlock = (x: number, y: number, z: number) => {
    const u = axis === 'x' ? x - x0 : z - z0;
    return wallCell(upStyle, Math.abs(u), y - eave, sh, L, axis, bay, !!p.close, false);
  };
  gableFill(g, roofTop, wl, eave, gableBlock, S.roof);
  if (p.stepped) for (const [x, z] of gableCells) {
    // (the stepped gable: the wall a cell proud of the roof, in steps of two)
    const t = roofTop.get(`${x},${z}`) ?? eave, ts = Math.floor(t / 2) * 2 + 2;
    for (let y = eave; y <= ts; y++) g.set(x, y, z, C.bricks, S.top);
  }
  // Chimneys on the ridge, a louvre over the middle
  const ridgeW = Math.floor((top.w0 + top.w1) / 2), ridgeY = Math.max(...[...roofTop.values()]);
  for (let i = 0; i < (p.chimneys ?? 0); i++) {
    const u = Math.round(((i + 0.5) / (p.chimneys ?? 1)) * (L - 1));
    const [x, z] = W(u, piles === 2 ? top.w1 : ridgeW);
    const t = roofTop.get(`${x},${z}`) ?? ridgeY;
    for (let y = 1; y <= Math.max(t, ridgeY) + 2; y++) g.set(x, y, z, p.ground === 'brick' || p.upper === 'brick' ? C.red : C.cobble, y > eave ? S.top : S.ground);
  }
  if (p.louvre) {
    const [x, z] = W(Math.floor(L / 2), ridgeW);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { g.set(x + dx, ridgeY + 1, z + dz, dx || dz ? C.fence : C.planks, S.top); g.set(x + dx, ridgeY + 2, z + dz, C.slab, S.top); }
    g.set(x, ridgeY + 3, z, C.fence, S.top);
  }
  // Corner turrets on the front (oriels from the first floor up, spires above the eave)
  if (p.turrets) {
    const r = Math.max(1, s(p.turrets / 2, 1));
    const corners: Array<[number, number]> = p.tower && p.tower.at === 'middle' ? [[top.u0, top.w0], [top.u1, top.w0], [top.u0, top.w1], [top.u1, top.w1]] : [[top.u0, top.w0], [top.u1, top.w0]];
    for (const [u, w] of corners) {
      const [x, z] = W(u, w);
      const y0 = p.ground === 'open' ? sh + 1 : 1;
      roundShell(g, x, z, y0, eave + 1, r, r, (xx, yy) => (yy === eave + 1 ? C.bricks : upStyle === 'timber' ? (yy % 3 === 0 ? C.pane : C.planks) : C.bricks), () => S.top);
      cone(g, x, z, eave + 2, eave + 2 + Math.max(3, Math.round(r * 2.5)), r + 0.5, ROOFS[p.roof], S.top);
    }
  }
  if (p.tower) {
    const ts = Math.max(3, s(p.tower.size, 3)), th = Math.max(eave + 4, s(p.tower.height, 8));
    const u0 = p.tower.at === 'west' ? -Math.floor(ts / 2) : Math.round(L / 2 - ts / 2), w0 = p.tower.at === 'west' ? Math.round(B / 2 - ts / 2) : -Math.floor(ts / 3);
    const [a, b] = [W(u0, w0), W(u0 + ts - 1, w0 + ts - 1)];
    towerOn(g, Math.min(a[0], b[0]), Math.min(a[1], b[1]), ts, th, p.tower.top, upStyle === 'timber' || upStyle === 'boarded' ? 'stone' : upStyle, ROOFS[p.roof], scaled(1)(1));
    // (a passage through its foot when it stands in the front)
    const [cx, cz] = W(u0 + Math.floor(ts / 2), w0);
    for (let y = 1; y <= Math.min(3, th - 1); y++) for (let k = 0; k < ts; k++) { if (axis === 'x') g.clear(cx, y, cz + k); else g.clear(cx + k, y, cz); }
  }
  return parts;
}

/** A world cell of a hall's local (u, w) at y, for Grid.clear. */
const W2 = (W: (u: number, w: number) => [number, number], u: number, w: number, y: number): [number, number, number] => { const [x, z] = W(u, w); return [x, y, z]; };

/** The facing of a stair whose back is toward +1 or -1 along an axis (in a hall turned to `turn`). */
function dirOf(axis: 'x' | 'z', sign: number, turn: 'x' | 'z' = 'x'): string {
  const a = turn === 'x' ? axis : axis === 'x' ? 'z' : 'x';
  return a === 'x' ? (sign > 0 ? 'east' : 'west') : sign > 0 ? 'south' : 'north';
}

/** A square tower at (x0, z0) of side ts up to th: its shell with windows, floors, and its top: a spire, a pyramid, a
 *  cupola, or corner turrets with a spire between (Ypres', Prague's). */
export function towerOn(g: Grid, x0: number, z0: number, ts: number, th: number, top: 'spire' | 'pyramid' | 'cupola' | 'turrets', wall: WallStyle, roof: RoofMat, _unit = 1): void {
  const x1 = x0 + ts - 1, z1 = z0 + ts - 1, cx = x0 + (ts - 1) / 2, cz = z0 + (ts - 1) / 2;
  const wb = (x: number, y: number, z: number) => {
    const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
    const mid = (x === Math.round(cx) || z === Math.round(cz)) && !corner;
    if (mid && y > 3 && y % 5 >= 2 && y % 5 <= 3) return C.pane;
    return wall === 'brick' ? (corner ? C.bricks : C.red) : wall === 'sandstone' ? C.sand : wall === 'rubble' ? (corner ? C.bricks : C.cobble) : C.bricks;
  };
  squareShell(g, x0, z0, x1, z1, 1, th, wb, (y) => (y <= 2 ? S.ground : S.top), 6);
  // (battlements round the top, then the roof)
  ring(x0, z0, x1, z1).forEach(([x, z], i) => { if (i % 2 === 0) g.set(x, th + 1, z, C.bricks, S.top); });
  const r = (ts - 1) / 2;
  if (top === 'cupola') {
    roundShell(g, cx, cz, th + 1, th + 3, Math.max(1, r / 2), Math.max(1, r / 2), (_x, y) => (y === th + 2 ? C.fence : C.planks), () => S.top);
    cone(g, cx, cz, th + 4, th + 4 + Math.max(2, Math.round(r)), Math.max(1, r / 2) + 0.5, roof, S.top, 8, C.fence);
  } else if (top === 'turrets') {
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      roundShell(g, x, z, th + 1, th + 3, 1, 1, () => C.bricks, () => S.top);
      cone(g, x, z, th + 4, th + 4 + Math.max(3, Math.round(ts / 2)), 1.5, roof, S.top);
    }
    cone(g, cx, cz, th + 1, th + 1 + Math.max(4, Math.round(ts * 1.2)), r - 0.5, roof, S.top, 4, C.fence);
  } else cone(g, cx, cz, th + 1, th + 1 + Math.max(3, Math.round(top === 'spire' ? ts * 2 : ts * 0.8)), r + 0.5, roof, S.top, top === 'spire' ? 8 : 4, C.fence);
}

/** A court: ranges round a yard (the preset's L, U or quadrangle), a gateway through the west range toward the village. */
function court(g: Grid, p: TimberPreset, s: ReturnType<typeof scaled>): void {
  const Lx = s(p.length, 10), Lz = s(p.width, 10), dp = Math.max(4, s(p.court!.depth, 4));
  const shape = p.court!.shape;
  // (north range along x; west range along z; south and east for the U and quadrangle)
  hall(g, p, s, 0, 0, { L: Lx, B: dp }, 'x', { door: false, yardSide: 'back' });
  hall(g, { ...p, tower: undefined }, s, 0, 0, { L: Lz, B: dp }, 'z', { door: false, yardSide: 'back' });
  if (shape !== 'L') hall(g, { ...p, tower: undefined }, s, 0, Lz - dp, { L: Lx, B: dp }, 'x', { door: false, yardSide: 'front' });
  if (shape === 'quad') hall(g, { ...p, tower: undefined }, s, Lx - dp, 0, { L: Lz, B: dp }, 'z', { door: false, yardSide: 'front' });
  // (the gateway: a passage through the west range at its middle, two high)
  const zc = Math.floor(Lz / 2), h = Math.max(3, s(p.storey, 3));
  for (let x = -1; x <= dp; x++) for (let z = zc - 1; z <= zc + 1; z++) for (let y = 1; y < h; y++) g.clear(x, y, z);
  for (let x = 0; x < dp; x++) for (let z = zc - 1; z <= zc + 1; z++) g.set(x, 0, z, C.cobble, S.pad);
  // (the yard paved)
  for (let x = dp; x < Lx - (shape === 'quad' ? dp : 0); x++) for (let z = dp; z < Lz - (shape === 'L' ? 0 : dp); z++) g.put(x, 0, z, C.cobble, S.pad);
}

/** A smock or tower mill: a tapered body (octagonal and boarded, or round and of stone), on arches for Chesterton's,
 *  a cap, and four sails in the plane of its west face. */
function windmill(g: Grid, p: TimberPreset, s: ReturnType<typeof scaled>): void {
  const m = p.mill!;
  const r0 = Math.max(2, s(m.base! / 2, 2)), r1 = Math.max(1.5, s(m.top! / 2, 1)), H = Math.max(6, s(m.height!, 6));
  const R = Math.ceil(Math.max(r0, s(m.sails! / 2, 4)));
  const cx = R, cz = R;
  const ya = m.arches ? Math.max(3, Math.round(H * 0.3)) : 0;
  for (let dx = -r0; dx <= r0; dx++) for (let dz = -r0; dz <= r0; dz++) if (Math.hypot(dx, dz) <= r0 + 0.5) g.set(cx + dx, 0, cz + dz, C.cobble, S.pad);
  if (m.arches) {
    // (piers round the foot, arches between, a floor over them)
    for (let i = 0; i < m.arches; i++) {
      const a = (i / m.arches) * 2 * Math.PI, x = cx + Math.round(Math.cos(a) * r0), z = cz + Math.round(Math.sin(a) * r0);
      for (let y = 1; y <= ya; y++) g.set(x, y, z, C.bricks, S.ground);
    }
    roundShell(g, cx, cz, ya, ya, r0, r0, () => C.bricks, () => S.ground, { floorEvery: 1, floor: C.planks });
  }
  const body = p.form === 'smock' ? (x: number, y: number, z: number) => (y % 4 === 2 && Math.abs(z - cz) <= 0 ? C.pane : C.planks) : (x: number, y: number, z: number) => (y % 4 === 2 && x - cx < -r1 + 1 && Math.abs(z - cz) <= 0 ? C.pane : C.cobble);
  roundShell(g, cx, cz, ya + 1, H, r0, r1, body, (y) => (y < H / 2 ? S.ground : S.upper), { sides: m.sides === 8 ? 8 : 0, floorEvery: 4 });
  // (the foot: stone under a smock mill's boards)
  if (p.form === 'smock') roundShell(g, cx, cz, 1, 2, r0, r0, () => C.bricks, () => S.ground, { sides: 8 });
  // (doors west and east at the foot)
  for (let y = 1; y <= 2; y++) for (const dx of [-1, 1]) for (let k = 0; k <= r0; k++) { const x = cx + dx * k; if (Math.hypot(x - cx, 0) >= r0 - 0.5) g.clear(x, y + ya, cz); }
  // (the cap: a dome or a thatched cone)
  cone(g, cx, cz, H + 1, H + 1 + Math.max(2, Math.round(r1 * (p.form === 'smock' ? 1.2 : 0.8))), r1 + 0.5, p.form === 'smock' ? ROOF_WOOD : ROOF_COBBLE, S.roof, p.form === 'smock' ? 8 : 0);
  sails(g, cx - Math.ceil(r1) - 1, H - 1, cz, s(m.sails! / 2, 4), S.top);
}

/** Four sails in the plane x = xs round the hub (yc, zc): stocks of logs on the diagonals, a lattice of fences on one side
 *  of each from a fifth of the way out. */
function sails(g: Grid, xs: number, yc: number, zc: number, R: number, stage: number): void {
  g.set(xs, yc, zc, C.post, stage);
  g.set(xs + 1, yc, zc, C.beamX, stage);
  for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]] as const) {
    const n = Math.round(R / Math.SQRT2);
    for (let t = 1; t <= n; t++) {
      g.set(xs, yc + a * t, zc + b * t, C.planks, stage);
      if (t < n / 5) continue;
      const w = Math.max(1, Math.round(n / 5));
      for (let k = 1; k <= w; k++) g.put(xs, yc + a * t + b * k, zc + b * t - a * k, t % 2 ? C.fence : C.planks, stage);
    }
  }
}

/** A post mill: its trestle (cross-trees on stone piers, quarter bars, the post), the boarded body on it under a gabled
 *  roof, its steps at the back and its sails at the front. */
function postmill(g: Grid, p: TimberPreset, s: ReturnType<typeof scaled>): void {
  const m = p.mill!;
  const [bl, bw, bh] = m.body!.map((v) => s(v, 3)), T = Math.max(3, s(m.trestle!, 3));
  const R = Math.max(s(m.sails! / 2, 4), bl);
  const cx = R + 1, cz = R;
  // (the trestle: stone piers at the cross-trees' ends, the cross-trees, the post)
  const arm = Math.max(2, Math.round(bl / 2));
  for (let k = -arm; k <= arm; k++) { g.set(cx + k, 1, cz, C.beamX, S.ground); g.set(cx, 1, cz + k, C.beamZ, S.ground); }
  for (const [dx, dz] of [[-arm, 0], [arm, 0], [0, -arm], [0, arm]]) g.set(cx + dx, 0, cz + dz, C.cobble, S.pad);
  for (let y = 2; y <= T; y++) g.set(cx, y, cz, C.post, S.ground);
  for (let k = 1; k < arm; k++) for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.set(cx + dx * (arm - k), 1 + k, cz + dz * (arm - k), C.post, S.ground);
  // (the body)
  const x0 = cx - Math.floor(bl / 2), z0 = cz - Math.floor(bw / 2), x1 = x0 + bl - 1, z1 = z0 + bw - 1, y0 = T + 1, y1 = T + bh;
  squareShellBox(g, x0, z0, x1, z1, y0, y1, (x, y, z) => (y === y0 || y === Math.round((y0 + y1) / 2) ? (x === x0 || x === x1 ? C.beamZ : C.beamX) : z === Math.round((z0 + z1) / 2) && x === x1 && (y - y0) % 3 === 2 ? C.pane : C.planks), S.upper, true);
  const top = drawRoof(g, [{ x0: x0, x1: x1, z0: z0 - 1, z1: z1 + 1, ridge: 'x', rise: 1.2 }], y1 + 1, ROOF_WOOD, S.roof);
  gableFill(g, top, [...ring(x0, z0, x1, z1)], y1 + 1, () => C.planks, S.roof);
  // (the ladder up to the door at the back)
  for (let k = 0; k <= T; k++) g.set(x1 + 1 + T - k, k, cz, C.stair('west'), S.top);
  for (let y = y0 + 1; y <= y0 + 2; y++) g.clear(x1, y, cz);
  sails(g, x0 - 1, Math.round((y0 + y1) / 2) + 1, cz, s(m.sails! / 2, 4), S.top);
}

/** A closed box's shell (walls, a floor at its foot, and its top when `lid`). */
function squareShellBox(g: Grid, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, wall: (x: number, y: number, z: number) => string, stage: number, floor = false): void {
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    if (floor) g.set(x, y0, z, C.planks, stage);
    for (let y = y0; y <= y1; y++) if (x === x0 || x === x1 || z === z0 || z === z1) g.set(x, y, z, wall(x, y, z), stage);
  }
}

/** A watermill's wheel against its north wall: a ring of planks with spokes, a log axle into the wall, its race of stone. */
function waterwheel(g: Grid, p: TimberPreset, s: ReturnType<typeof scaled>): void {
  const m = p.mill!, d = hallDims(p, s);
  const r = Math.max(2, s(m.wheel! / 2, 2)), w = Math.max(1, s(m.wheelWidth!, 1));
  const cx = Math.round(d.L * 0.6), yc = r;
  wheel(g, cx, yc, -1 - w, -2, r, S.top);
  for (let z = -1 - w; z <= -1; z++) g.set(cx, yc, z, C.beamZ, S.top);
  // (the race: a stone channel under the wheel)
  for (let x = cx - r - 1; x <= cx + r + 1; x++) for (const z of [-2 - w, 0 - 1 + 0]) g.put(x, 0, z, C.cobble, S.pad);
}

/** A wheel in the plane z0..z1 (its width) round (cx, yc): rim, spokes every eighth of a turn, paddles. */
function wheel(g: Grid, cx: number, yc: number, z0: number, z1: number, r: number, stage: number): void {
  for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) {
    const n = Math.ceil(2 * Math.PI * r * 1.5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      g.set(cx + Math.round(Math.cos(a) * r), yc + Math.round(Math.sin(a) * r), z, i % 4 === 0 ? C.post : C.planks, stage);
    }
    if (z === Math.min(z0, z1) || z === Math.max(z0, z1)) for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 2 * Math.PI;
      for (let t = 1; t < r; t++) g.put(cx + Math.round(Math.cos(a) * t), yc + Math.round(Math.sin(a) * t), z, C.fence, stage);
    }
  }
  g.set(cx, yc, z0, C.beamZ, stage);
}

/** The Laxey wheel: the stone pier, the wheel on its north side, a stair up the pier to the platform at the wheel's top,
 *  and the viaduct of arches that carried the pump rod west from it. */
function laxey(g: Grid, p: TimberPreset, s: ReturnType<typeof scaled>): void {
  const m = p.mill!;
  const r = Math.max(4, s(m.wheel! / 2, 4)), w = Math.max(1, s(m.wheelWidth!, 1));
  const L = s(p.length, 5), B = s(p.width, 3), H = Math.max(r + 2, s(m.height!, r));
  const vx = Math.max(6, s(m.viaduct!, 6));
  // (the pier east of the viaduct, the wheel against its north face)
  const px0 = vx, px1 = vx + L - 1;
  for (let x = px0; x <= px1; x++) for (let z = 0; z < B; z++) {
    g.set(x, 0, z, C.cobble, S.pad);
    for (let y = 1; y <= H; y++) if (x === px0 || x === px1 || z === 0 || z === B - 1 || y === H) g.set(x, y, z, y % 6 === 3 && (x === px0 || x === px1) && z === Math.floor(B / 2) ? C.pane : C.white, y <= 2 ? S.ground : S.upper);
  }
  crenel(g, ring(px0, 0, px1, B - 1), H + 1, C.fence, S.top);
  const cx = Math.round((px0 + px1) / 2), yc = r + 1;
  wheel(g, cx, yc, -1 - w, -2, r, S.top);
  for (let z = -1 - w; z <= -1; z++) g.set(cx, yc, z, C.beamZ, S.top);
  // (the viaduct: piers and arches west from the pier, its deck at a third of the wheel's height)
  const vh = Math.max(3, Math.round(yc * 0.7)), zc = Math.floor(B / 2);
  for (let x = 0; x < px0; x++) {
    const pier = x % 4 === 0;
    for (let y = 1; y <= vh; y++) if (pier || y === vh || (y === vh - 1 && (x % 4 === 1 || x % 4 === 3))) for (let z = zc - 1; z <= zc + 1; z++) g.set(x, y, z, y === vh - 1 && !pier ? C.brickStair(x % 4 === 1 ? 'east' : 'west', 'top') : C.bricks, y < vh ? S.ground : S.upper);
    for (const z of [zc - 1, zc + 1]) g.set(x, vh + 1, z, C.brickWall, S.top);
    if (pier) for (let z = zc - 1; z <= zc + 1; z++) g.set(x, 0, z, C.cobble, S.pad);
  }
  // (the door in the pier's west face)
  for (let y = 1; y <= 2; y++) g.clear(px0, y, zc);
}

/** Battlements (civicDraw's, re-exported for the mills). */
function crenel(g: Grid, cells: Array<[number, number]>, y: number, block: string, stage: number): void {
  cells.forEach(([x, z], i) => { if (i % 2 === 0) g.set(x, y, z, block, stage); });
}
