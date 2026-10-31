/**
 * A Gothic cathedral drawn by code (the monument, M0; runs/2026-10-25/monument/report.md, route B): a split grammar of
 * parametrised parts (west front with towers, portals and a rose; nave bays with aisles, arcade, triforium, clerestory,
 * buttresses and flyers; a crossing with nothing, a flèche or a tower and spire; transept arms; an apse with its
 * ambulatory, or a flat east end; towers beside the body), each a function of the scale, the bay pitch, the vault height
 * and the materials. Presets give a real cathedral's measures in metres (1 m = 1 block at 1:1); the scale divides them.
 * Code draws every cell, so the bill is exact (lesson 1); a model chooses only the preset and its parameters.
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
import type { CivicSource } from './civic';
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
  /** False: the roses only at the transept ends (England's, under a west window of lancets). */
  westRose?: boolean;
  /** Five aisles (Cologne): `aisle` is then both aisles of a side, split by a row of piers, under a lean-to half as steep. */
  aisles?: 3 | 5;
  /** Radiating chapels round the apse's ambulatory (0: none). */
  chapels?: number;
  /** Openwork spires (Cologne's): solid bands every third course, a lattice of posts between. */
  openwork?: boolean;
  /** The east end: a rounded apse with its ambulatory (the default) or a flat gable with a great window (England's). */
  east?: 'apse' | 'flat';
  /** Towers beside the body (Vienna's south tower, Seville's Giralda): the west face's distance from the west front, the
   *  side, the side's length, the height and a spire above it (metres); a door in the outer face. */
  sideTowers?: Array<{ at: number; side: 'n' | 's'; size: number; height: number; spire: number }>;
  /** A cloister on that side of the nave, against the transept's west side: its square's side (metres). */
  cloister?: { side: 'n' | 's'; size: number };
  /** 'tower': a free-standing bell tower (`nave` its side, `towerHeight`, `spires[0]`, `upper` a narrower top stage),
   *  nothing else drawn. */
  form?: 'church' | 'tower';
  upper?: { side: number; height: number };
  /** A civic building (GOTHIC_CIVIC, the civic tier's), not a monument: its category, title, place and date. */
  kind?: 'monument' | 'civic';
  category?: string;
  title?: string;
  place?: string;
  built?: string;
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
  cologne: {
    name: 'cologne', description: 'Cologne: sheer height, five aisles, twin openwork spires, an apse ringed with chapels',
    length: 144, bay: 7.5, nave: 14, aisle: 14, buttress: 5, vault: 43, aisleHeight: 18,
    transeptBay: 9, transeptBays: 2, transeptArm: 20,
    towers: 2, towerHeight: 95, spires: [62, 62], crossing: 'fleche', crossingHeight: 0, crossingSpire: 45, rose: 0,
    aisles: 5, chapels: 7, openwork: true,
  },
  amiens: {
    name: 'amiens', description: 'Amiens: the largest French cathedral, a 42 m vault on slender piers, a flèche of 112 m, seven chapels',
    length: 145, bay: 9, nave: 14.6, aisle: 8.65, buttress: 5, vault: 42.3, aisleHeight: 19.7,
    transeptBay: 6, transeptBays: 2, transeptArm: 19,
    towers: 2, towerHeight: 65, spires: [0, 0], crossing: 'fleche', crossingHeight: 0, crossingSpire: 56, rose: 11,
    chapels: 7,
  },
  reims: {
    name: 'reims', description: 'Reims: the coronation church, a west front of statues round a 12 m rose, two 81 m towers built for spires',
    length: 149, bay: 7.5, nave: 14.65, aisle: 8.7, buttress: 5, vault: 38, aisleHeight: 16.5,
    transeptBay: 10, transeptBays: 2, transeptArm: 14.5,
    towers: 2, towerHeight: 81.5, spires: [0, 0], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 12.5,
    chapels: 5,
  },
  beauvais: {
    name: 'beauvais', description: 'Beauvais: the highest Gothic vault ever built, 48 m, over a choir and transept alone (the nave was never built)',
    length: 72.5, bay: 9, nave: 16, aisle: 9, buttress: 6, vault: 48.5, aisleHeight: 21,
    transeptBay: 1, transeptBays: 2, transeptArm: 10,
    towers: 0, towerHeight: 0, spires: [], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 11,
    chapels: 7,
  },
  bourges: {
    name: 'bourges', description: 'Bourges: no transept, five stepped aisles under one unbroken vault, a double ambulatory with five small chapels',
    length: 125, bay: 6, nave: 15, aisle: 13.2, buttress: 5, vault: 37.15, aisleHeight: 21.3,
    transeptBay: 9, transeptBays: 2, transeptArm: 0,
    towers: 2, towerHeight: 65, spires: [0, 0], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 9,
    aisles: 5, chapels: 5,
  },
  westminster: {
    name: 'westminster', description: 'Westminster Abbey: the tallest English vault, Hawksmoor\'s twin west towers, a French chevet of chapels',
    length: 130, bay: 5.5, nave: 10, aisle: 7.9, buttress: 4, vault: 31, aisleHeight: 12,
    transeptBay: 11, transeptBays: 2, transeptArm: 18,
    towers: 2, towerHeight: 68.7, spires: [0, 0], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 10, westRose: false,
    chapels: 5,
  },
  york: {
    name: 'york', description: 'York Minster: the widest Gothic nave in England, a great crossing tower, a flat east end with the largest medieval window',
    length: 160, bay: 10, nave: 15, aisle: 8.3, buttress: 4, vault: 30.2, aisleHeight: 14,
    transeptBay: 8, transeptBays: 2, transeptArm: 18,
    towers: 2, towerHeight: 60, spires: [0, 0], crossing: 'tower', crossingHeight: 72, crossingSpire: 0, rose: 7, westRose: false,
    east: 'flat',
  },
  lincoln: {
    name: 'lincoln', description: 'Lincoln: an 83 m crossing tower (once under the tallest spire in the world), two transept roses, a square east end',
    length: 147, bay: 11, nave: 11.6, aisle: 6.4, buttress: 4, vault: 25, aisleHeight: 13,
    transeptBay: 7, transeptBays: 2, transeptArm: 21.7,
    towers: 2, towerHeight: 61, spires: [0, 0], crossing: 'tower', crossingHeight: 82.6, crossingSpire: 0, rose: 7.5, westRose: false,
    east: 'flat',
  },
  canterbury: {
    name: 'canterbury', description: 'Canterbury: Bell Harry over the crossing, a Perpendicular nave, twin west towers, the round Corona at the east',
    length: 160, bay: 7, nave: 11, aisle: 5.3, buttress: 4, vault: 24.4, aisleHeight: 13,
    transeptBay: 8, transeptBays: 2, transeptArm: 8,
    towers: 2, towerHeight: 47, spires: [0, 0], crossing: 'tower', crossingHeight: 72, crossingSpire: 0, rose: 0,
    chapels: 1,
  },
  wells: {
    name: 'wells', description: 'Wells: a screen front of statues between low towers, a crossing tower braced by scissor arches, a square east end',
    length: 126.5, bay: 4.9, nave: 10, aisle: 7.5, buttress: 3, vault: 20.4, aisleHeight: 10,
    transeptBay: 10, transeptBays: 2, transeptArm: 10,
    towers: 2, towerHeight: 38, spires: [0, 0], crossing: 'tower', crossingHeight: 55, crossingSpire: 0, rose: 0,
    east: 'flat',
  },
  ely: {
    name: 'ely', description: 'Ely: a long Romanesque nave, one great west tower and the timber Octagon lantern over the crossing',
    length: 163.7, bay: 6.2, nave: 10, aisle: 6.9, buttress: 3, vault: 21.9, aisleHeight: 11,
    transeptBay: 12, transeptBays: 2, transeptArm: 15,
    towers: 1, towerHeight: 66, spires: [0], crossing: 'tower', crossingHeight: 52, crossingSpire: 0, rose: 0,
    east: 'flat',
  },
  milan: {
    name: 'milan', description: 'Milan: five aisles of white marble under a forest of pinnacles, a crossing spire with the gilded Madonnina at 108 m',
    length: 158.5, bay: 9.6, nave: 19, aisle: 19, buttress: 4, vault: 45, aisleHeight: 30,
    transeptBay: 9, transeptBays: 2, transeptArm: 13.5,
    towers: 0, towerHeight: 0, spires: [], crossing: 'tower', crossingHeight: 68, crossingSpire: 40.5, rose: 0,
    aisles: 5,
  },
  seville: {
    name: 'seville', description: 'Seville: the largest Gothic church, five aisles in a square-ended block, the Giralda minaret-belfry beside it',
    length: 116, bay: 13, nave: 16, aisle: 22, buttress: 4, vault: 36, aisleHeight: 26,
    transeptBay: 5, transeptBays: 1, transeptArm: 0,
    towers: 0, towerHeight: 0, spires: [], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0,
    aisles: 5, east: 'flat', sideTowers: [{ at: 102, side: 'n', size: 13.6, height: 70, spire: 34.5 }],
  },
  burgos: {
    name: 'burgos', description: 'Burgos: twin openwork spires by Juan de Colonia, a star-vaulted crossing lantern and a ring of great chapels',
    length: 106, bay: 7, nave: 11, aisle: 7.5, buttress: 4, vault: 25, aisleHeight: 13,
    transeptBay: 7, transeptBays: 2, transeptArm: 16.5,
    towers: 2, towerHeight: 58, spires: [30, 30], crossing: 'tower', crossingHeight: 54, crossingSpire: 0, rose: 6,
    chapels: 3, openwork: true,
  },
  leon: {
    name: 'leon', description: 'León: Pulchra Leonina, walls nearly all glass (1,800 m² of medieval windows) round a French chevet',
    length: 90, bay: 7, nave: 13, aisle: 8, buttress: 4, vault: 30, aisleHeight: 15,
    transeptBay: 7, transeptBays: 2, transeptArm: 6,
    towers: 2, towerHeight: 45, spires: [20, 23], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 8,
    chapels: 5,
  },
  toledo: {
    name: 'toledo', description: 'Toledo: five aisles round a double ambulatory, one tall north-west tower and spire of 92 m',
    length: 120, bay: 8, nave: 15, aisle: 14, buttress: 4, vault: 44.5, aisleHeight: 25,
    transeptBay: 8, transeptBays: 2, transeptArm: 3,
    towers: 2, towerHeight: 60, spires: [32, 0], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 6,
    aisles: 5, chapels: 7,
  },
  ulm: {
    name: 'ulm', description: 'Ulm Minster: the tallest church spire in the world, 161.5 m and openwork, on a single west tower',
    length: 123.5, bay: 8, nave: 15, aisle: 17, buttress: 4, vault: 41.6, aisleHeight: 20.5,
    transeptBay: 9, transeptBays: 1, transeptArm: 0,
    towers: 1, towerHeight: 86, spires: [75.5], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0,
    aisles: 5, openwork: true,
    sideTowers: [{ at: 94, side: 'n', size: 8, height: 60, spire: 26 }, { at: 94, side: 's', size: 8, height: 60, spire: 26 }],
  },
  strasbourg: {
    name: 'strasbourg', description: 'Strasbourg: a lacework west front round a 13.6 m rose, one north spire of 142 m, for centuries the tallest building',
    length: 112, bay: 8, nave: 16, aisle: 8, buttress: 4, vault: 32, aisleHeight: 19,
    transeptBay: 9, transeptBays: 2, transeptArm: 8,
    towers: 2, towerHeight: 66, spires: [76, 0], crossing: 'tower', crossingHeight: 58, crossingSpire: 0, rose: 13.6,
    openwork: true,
  },
  st_vitus: {
    name: 'st_vitus', description: 'St. Vitus, Prague: Parler\'s choir ringed with chapels, the great south tower and twin neo-Gothic west spires',
    length: 124, bay: 8, nave: 13, aisle: 6, buttress: 4, vault: 33.2, aisleHeight: 18,
    transeptBay: 8, transeptBays: 2, transeptArm: 6,
    towers: 2, towerHeight: 50, spires: [32, 32], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 10.4,
    chapels: 5, sideTowers: [{ at: 49, side: 's', size: 15, height: 66, spire: 30.6 }],
  },
  st_stephen: {
    name: 'st_stephen', description: 'St. Stephen\'s, Vienna: a hall church under a steep tiled roof, the 136 m south tower (the Steffl) beside the nave',
    length: 108.7, bay: 9, nave: 12, aisle: 10, buttress: 3, vault: 28, aisleHeight: 22.4,
    transeptBay: 6, transeptBays: 1, transeptArm: 0,
    towers: 2, towerHeight: 66, spires: [0, 0], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0,
    sideTowers: [{ at: 58, side: 's', size: 13, height: 70, spire: 66.4 }, { at: 58, side: 'n', size: 13, height: 68.3, spire: 0 }],
  },
  lichfield: {
    name: 'lichfield', description: 'Lichfield: the only medieval English cathedral with three spires (the Ladies of the Vale)',
    length: 112.8, bay: 5.3, nave: 9, aisle: 5.9, buttress: 3, vault: 17.4, aisleHeight: 9,
    transeptBay: 8, transeptBays: 2, transeptArm: 12,
    towers: 2, towerHeight: 30, spires: [28, 28], crossing: 'tower', crossingHeight: 38, crossingSpire: 39, rose: 0,
    east: 'flat',
  },
};

/** A free-standing bell tower's preset (form 'tower'): the base's side, the square shaft's height, a narrower top stage
 *  and the spire (metres). */
const belfry = (name: string, title: string, place: string, built: string, description: string, side: number, height: number,
  spire: number, upper?: { side: number; height: number }, openwork = false): GothicPreset => ({
  name, description, title, place, built, kind: 'civic', category: 'bell tower', form: 'tower', ...(upper ? { upper } : {}), ...(openwork ? { openwork } : {}),
  length: side, bay: side, nave: side, aisle: 0, buttress: 0, vault: height, aisleHeight: 0, transeptBay: 0, transeptBays: 0, transeptArm: 0,
  towers: 1, towerHeight: height, spires: [spire], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0,
});

/** The civic tier's stone churches, abbeys, chapels and bell towers (kind 'civic'; the monument picker never sees them:
 *  CIVIC_SOURCE hands them to civic.ts). Measures from the sources in runs/2026-10-31/monuments40/report.md. */
export const GOTHIC_CIVIC: Record<string, GothicPreset> = {
  // Parish churches
  lavenham_church: {
    name: 'lavenham_church', title: 'the church of St Peter and St Paul', place: 'Lavenham', built: '1485-1525', kind: 'civic', category: 'parish church',
    description: 'a Suffolk wool church: a long clerestoried nave and a great flint west tower',
    length: 48, bay: 4.5, nave: 8, aisle: 6.5, buttress: 1.5, vault: 13, aisleHeight: 7, transeptBay: 6, transeptBays: 1, transeptArm: 0,
    towers: 1, towerHeight: 42.5, spires: [0], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
  },
  long_melford: {
    name: 'long_melford', title: 'Holy Trinity', place: 'Long Melford', built: '1467-1497', kind: 'civic', category: 'parish church',
    description: 'a wool church walled almost all in glass, long and low, with a west tower',
    length: 74.7, bay: 4.5, nave: 8, aisle: 5, buttress: 1.5, vault: 12.6, aisleHeight: 7.3, transeptBay: 8, transeptBays: 1, transeptArm: 0,
    towers: 1, towerHeight: 36, spires: [0], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
  },
  st_mary_redcliffe: {
    name: 'st_mary_redcliffe', title: 'St Mary Redcliffe', place: 'Bristol', built: '1292-1470', kind: 'civic', category: 'parish church',
    description: 'a parish church built like a cathedral: vaulted throughout, a transept, a tower and spire of 89 m',
    length: 76, bay: 5, nave: 9, aisle: 4.5, buttress: 2, vault: 16.7, aisleHeight: 9, transeptBay: 8, transeptBays: 2, transeptArm: 9,
    towers: 1, towerHeight: 34, spires: [46], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
  },
  patrington: {
    name: 'patrington', title: 'St Patrick\'s', place: 'Patrington', built: '1310-1410', kind: 'civic', category: 'parish church',
    description: 'the Queen of Holderness: a cruciform church with aisled transepts and a spire over the crossing',
    length: 45.7, bay: 5, nave: 8, aisle: 4, buttress: 1.5, vault: 11, aisleHeight: 8, transeptBay: 5, transeptBays: 2, transeptArm: 6,
    towers: 0, towerHeight: 0, spires: [], crossing: 'tower', crossingHeight: 25, crossingSpire: 28, rose: 0, east: 'flat',
  },
  cirencester_church: {
    name: 'cirencester_church', title: 'the church of St John the Baptist', place: 'Cirencester', built: '1400-1530', kind: 'civic', category: 'parish church',
    description: 'a Cotswold wool church: a tall Perpendicular nave of glass and a buttressed west tower',
    length: 55, bay: 5, nave: 9, aisle: 7, buttress: 2, vault: 15, aisleHeight: 8, transeptBay: 6, transeptBays: 1, transeptArm: 0,
    towers: 1, towerHeight: 41, spires: [0], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
  },
  // Abbeys and priories, each with its cloister
  fountains_abbey: {
    name: 'fountains_abbey', title: 'Fountains Abbey', place: 'North Yorkshire', built: '1132-1526', kind: 'civic', category: 'abbey',
    description: 'a great Cistercian abbey: a long aisled nave, Huby\'s tower at the north transept, a cloister to the south',
    length: 110, bay: 5.5, nave: 8.5, aisle: 5.5, buttress: 2, vault: 20, aisleHeight: 9, transeptBay: 11, transeptBays: 2, transeptArm: 10,
    towers: 0, towerHeight: 0, spires: [], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
    sideTowers: [{ at: 62, side: 'n', size: 10, height: 49, spire: 0 }], cloister: { side: 's', size: 39 },
  },
  rievaulx_abbey: {
    name: 'rievaulx_abbey', title: 'Rievaulx Abbey', place: 'North Yorkshire', built: '1132-1230', kind: 'civic', category: 'abbey',
    description: 'a Cistercian abbey in a narrow valley: a tall Early English choir and a cloister beside the nave',
    length: 107, bay: 5.5, nave: 9, aisle: 5, buttress: 2, vault: 22, aisleHeight: 10, transeptBay: 9, transeptBays: 2, transeptArm: 9,
    towers: 0, towerHeight: 0, spires: [], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
    cloister: { side: 's', size: 42 },
  },
  tintern_abbey: {
    name: 'tintern_abbey', title: 'Tintern Abbey', place: 'the Wye valley', built: '1269-1301', kind: 'civic', category: 'abbey',
    description: 'a Cistercian abbey church of great windows, its cloister on the north side',
    length: 69.5, bay: 5.5, nave: 11, aisle: 5.5, buttress: 2, vault: 22, aisleHeight: 10, transeptBay: 6, transeptBays: 2, transeptArm: 12,
    towers: 0, towerHeight: 0, spires: [], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
    cloister: { side: 'n', size: 30 },
  },
  melrose_abbey: {
    name: 'melrose_abbey', title: 'Melrose Abbey', place: 'the Scottish Borders', built: '1385-1500', kind: 'civic', category: 'abbey',
    description: 'a Cistercian abbey rebuilt in rich Gothic, a great east window, the cloister on the north',
    length: 78.6, bay: 5.5, nave: 9, aisle: 5, buttress: 2, vault: 18, aisleHeight: 9, transeptBay: 7, transeptBays: 2, transeptArm: 8,
    towers: 0, towerHeight: 0, spires: [], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
    cloister: { side: 'n', size: 35 },
  },
  fontenay_abbey: {
    name: 'fontenay_abbey', title: 'the Abbey of Fontenay', place: 'Burgundy', built: '1139-1147', kind: 'civic', category: 'abbey',
    description: 'the plainest Cistercian abbey: a barrel-vaulted church with a square east end and its cloister to the south',
    length: 66, bay: 5.5, nave: 8, aisle: 3.5, buttress: 1.5, vault: 16.7, aisleHeight: 8, transeptBay: 8, transeptBays: 1, transeptArm: 6,
    towers: 0, towerHeight: 0, spires: [], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
    cloister: { side: 's', size: 36 },
  },
  // Chapels
  sainte_chapelle: {
    name: 'sainte_chapelle', title: 'the Sainte-Chapelle', place: 'Paris', built: '1242-1248', kind: 'civic', category: 'chapel',
    description: 'a royal reliquary chapel: one tall vessel walled in stained glass, a rose, a flèche',
    length: 36, bay: 5, nave: 10.7, aisle: 0, buttress: 2, vault: 20.5, aisleHeight: 7, transeptBay: 3, transeptBays: 1, transeptArm: 0,
    towers: 0, towerHeight: 0, spires: [], crossing: 'fleche', crossingHeight: 0, crossingSpire: 33, rose: 9,
  },
  kings_college_chapel: {
    name: 'kings_college_chapel', title: 'King\'s College Chapel', place: 'Cambridge', built: '1446-1515', kind: 'civic', category: 'chapel',
    description: 'a long single vessel under the largest fan vault, a turret at each corner',
    length: 88, bay: 7.3, nave: 12.2, aisle: 0, buttress: 3, vault: 24.4, aisleHeight: 8, transeptBay: 6, transeptBays: 1, transeptArm: 0,
    towers: 0, towerHeight: 0, spires: [], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
    sideTowers: [{ at: 0, side: 'n', size: 4, height: 44, spire: 0 }, { at: 0, side: 's', size: 4, height: 44, spire: 0 },
      { at: 84, side: 'n', size: 4, height: 44, spire: 0 }, { at: 84, side: 's', size: 4, height: 44, spire: 0 }],
  },
  rosslyn_chapel: {
    name: 'rosslyn_chapel', title: 'Rosslyn Chapel', place: 'Roslin', built: '1456-1484', kind: 'civic', category: 'chapel',
    description: 'a small aisled collegiate chapel, every surface carved',
    length: 21, bay: 3.5, nave: 5, aisle: 2.2, buttress: 1.5, vault: 12.8, aisleHeight: 6, transeptBay: 2, transeptBays: 1, transeptArm: 0,
    towers: 0, towerHeight: 0, spires: [], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
  },
  st_georges_chapel: {
    name: 'st_georges_chapel', title: 'St George\'s Chapel', place: 'Windsor Castle', built: '1475-1528', kind: 'civic', category: 'chapel',
    description: 'the Garter chapel: a Perpendicular church in little, aisled, with short transepts and a lierne vault',
    length: 70.7, bay: 5, nave: 10, aisle: 5, buttress: 2, vault: 20, aisleHeight: 10, transeptBay: 7, transeptBays: 1, transeptArm: 4,
    towers: 0, towerHeight: 0, spires: [], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
  },
  eton_college_chapel: {
    name: 'eton_college_chapel', title: 'Eton College Chapel', place: 'Eton', built: '1441-1482', kind: 'civic', category: 'chapel',
    description: 'the choir of a church never finished: one tall vessel of great windows between buttresses',
    length: 53, bay: 6, nave: 12, aisle: 0, buttress: 3, vault: 25, aisleHeight: 8, transeptBay: 5, transeptBays: 1, transeptArm: 0,
    towers: 0, towerHeight: 0, spires: [], crossing: 'none', crossingHeight: 0, crossingSpire: 0, rose: 0, east: 'flat',
  },
  // Bell towers
  bruges_belfry: belfry('bruges_belfry', 'the Belfry of Bruges', 'Bruges', '1240-1487', 'a square brick belfry over the market, an octagonal lantern stage on top', 16, 50, 3, { side: 10, height: 30 }),
  giotto_campanile: belfry('giotto_campanile', 'Giotto\'s Campanile', 'Florence', '1334-1359', 'a square marble bell tower, straight to a flat top', 14.45, 84.7, 0),
  st_marks_campanile: belfry('st_marks_campanile', 'St Mark\'s Campanile', 'Venice', '1514 (rebuilt 1912)', 'a plain square brick shaft, an open belfry and a green pyramid spire', 12, 61, 30, { side: 9, height: 8 }),
  ghent_belfry: belfry('ghent_belfry', 'the Belfry of Ghent', 'Ghent', '1313-1380', 'a tall square belfry with corner turrets under a slender spire', 15.6, 55, 36),
  st_rumbolds_tower: belfry('st_rumbolds_tower', 'St Rumbold\'s Tower', 'Mechelen', '1452-1520', 'a vast square tower meant for a spire, left with a flat top', 24, 77, 0, { side: 17, height: 20 }),
};

/** The civic tier's blocks (civic.ts takes only what a village can get): smooth stone for the andesite floor, cobblestone
 *  for the tuff, the village wood (drawn as oak) for the deepslate roof, plain panes for the stained glass, fences for
 *  bars. */
export const CIVIC_BLOCK = (block: string): string => {
  const m = /^([a-z_]+)(\[.*\])?$/.exec(block);
  if (!m) return block;
  const [, name, st = ''] = m;
  if (name === 'polished_andesite') return 'smooth_stone';
  if (name === 'tuff_bricks') return 'cobblestone';
  if (name === 'deepslate_tiles' || name === 'cut_copper') return 'oak_planks';
  if (name === 'deepslate_tile_stairs' || name === 'cut_copper_stairs') return `oak_stairs${st}`;
  if (name === 'deepslate_tile_slab' || name === 'cut_copper_slab') return `oak_slab${st}`;
  if (name.endsWith('_stained_glass_pane')) return 'glass_pane';
  if (name === 'iron_bars') return 'oak_fence';
  return block;
};

/** GOTHIC_CIVIC for the civic tier (civic.ts reads gothicGen's CIVIC_SOURCE): small jobs, the village's blocks. */
export const CIVIC_SOURCE: CivicSource = {
  family: 'gothic',
  entries: Object.values(GOTHIC_CIVIC).map((p) => ({ id: p.name, title: p.title!, kind: p.category!, age: 'stone', description: p.description, place: p.place!, built: p.built! })),
  draw: (id, scale) => generateCathedral(GOTHIC_CIVIC[id], scale, { jobMin: 150, jobMax: 450, blocks: CIVIC_BLOCK }),
};

/** The materials (the default palette, the user's 10-25: stone bricks toned with andesite and tuff, a deepslate roof). */
const M = {
  floor: 'polished_andesite', wall: 'stone_bricks', pier: 'stone_bricks', rib: 'polished_andesite', vault: 'stone_bricks',
  tone: 'tuff_bricks', tile: 'deepslate_tiles', tileStair: 'deepslate_tile_stairs', tileSlab: 'deepslate_tile_slab',
  stair: 'stone_brick_stairs', post: 'stone_brick_wall', slab: 'stone_brick_slab',
  pane: 'glass_pane', blue: 'blue_stained_glass_pane', red: 'red_stained_glass_pane', yellow: 'yellow_stained_glass_pane',
};

/** #162 tier 3, chain B: the high roof's copper (cut at the stonecutter from copper blocks, 4 a block; it weathers green). */
export const COPPER = { tile: 'cut_copper', tileStair: 'cut_copper_stairs', tileSlab: 'cut_copper_slab' };

/** #162 tier 3, chain C: the geode's accents. */
export const GEM = { calcite: 'calcite', amethyst: 'amethyst_block' };

export const GOTHIC_STAGES = [
  'pad and floor', 'aisle walls and west-front base', 'piers and arcade', 'clerestory and buttresses',
  'vault and roof', 'towers', 'glass and rose', 'spires and pinnacles',
] as const;
/** With `detail` (#162): a ninth stage, the furnishing (lanterns on chains, the bell, the altar's candles, banners). */
export const GOTHIC_STAGES_DETAIL = [...GOTHIC_STAGES, 'furnishing'] as const;

/** #162's tier 2 (`detail`): the stonecutter's pieces, a patterned floor, glass in many colours and the furnishing. */
const T2 = {
  capital: 'chiseled_stone_bricks', jamb: 'chiseled_stone_bricks', floorB: 'polished_diorite', aisleFloor: 'polished_andesite',
  mullion: 'stone_brick_wall', chain: 'iron_chain[axis=y]', lantern: 'lantern[hanging=true]', bell: 'bell[attachment=ceiling,facing=north]', bellFloor: 'bell[attachment=floor,facing=north]',
  altar: 'chiseled_stone_bricks', candle: 'candle[candles=1,lit=true]',
};
/** The window colours `detail` cycles through by bay when none are given (each lancet one colour, the roses in rings). */
export const DETAIL_COLOURS = ['blue', 'red', 'purple', 'light_blue', 'magenta', 'orange', 'cyan', 'yellow', 'pink', 'lime', 'white', 'green'];

/** A block's cost as an item and a count (#162): wall banners are the banner item, a candle block holds `candles`. */
export function gothicCost(block: string): [string, number] {
  const name = gothicItem(block);
  const banner = /^(\w+)_wall_banner$/.exec(name);
  if (banner) return [`${banner[1]}_banner`, 1];
  if (/(^|_)candle$/.test(name)) return [name, Number(/candles=(\d)/.exec(block)?.[1] ?? 1)];
  return [name, 1];
}

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
  /** The stages' names (GOTHIC_STAGES, or GOTHIC_STAGES_DETAIL with `detail`). */
  stageNames: readonly string[];
}

export interface GothicOpts {
  jobMin?: number;
  jobMax?: number;
  /** #162: the tier-2 palette (off: the cells exactly as before). */
  detail?: boolean;
  /** With `detail`: the dye colours the windows cycle through (default DETAIL_COLOURS). */
  colours?: string[];
  /** With `detail`: the banners' colours, alternating (default white and the first window colour). */
  banners?: string[];
  /** With `detail`: the ninth stage, the furnishing (default on; off: eight stages, no lanterns, bell, candles or banners). */
  furnish?: boolean;
  /** With `furnish`: only these kinds drawn (#162 C-E's flags; absent: every kind). */
  furnishKinds?: { lanterns?: boolean; bell?: boolean; candles?: boolean; banners?: boolean };
  /** #162 tier 3, chain B: the high roof (nave, choir, transepts) and the flèche's base in cut copper (off: deepslate). */
  copperRoof?: boolean;
  /** #162 tier 3, chain C (with `detail`): the geode's accents, calcite round the west portals and in a string course across
   *  the west front at the aisles' height, amethyst at the roses' hubs and on the apse altar (off: the cells as before). */
  accents?: boolean;
  /** Each block swapped before the bill is made (the civic tier's: blocks a village can get; CIVIC_BLOCK). */
  blocks?: (block: string) => string;
}

/** The item a block costs: its name without states (stained panes, tiles and bricks are items of their own). */
export const gothicItem = (block: string) => block.replace(/\[.*\]$/, '');

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const STEP4: Array<[number, number, string]> = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];

/** Draw a preset at 1:scale. `opts.jobMin`/`jobMax` set the job size (300/800); `opts.detail` the tier-2 palette. */
export function generateCathedral(p: GothicPreset, scale: number, opts: GothicOpts = {}): Cathedral {
  if (p.form === 'tower') return generateBelfry(p, scale, opts);
  const detail = !!opts.detail, accents = detail && !!opts.accents;
  const colours = opts.colours?.length ? opts.colours : DETAIL_COLOURS;
  const s = (m: number, min = 1) => Math.max(min, Math.round(m / scale));
  const odd = (n: number) => (n % 2 ? n : n + 1);
  const pitch = s(p.bay, 3);
  const nave = odd(s(p.nave, 3));
  // (aisle 0: a single vessel, a chapel's: its walls are the outer walls, its apse has no ambulatory)
  const aisle = p.aisle ? s(p.aisle, 2) : 0;
  const butW = s(p.buttress, 1);
  const Hv = s(p.vault, 7);
  const Ha = Math.min(s(p.aisleHeight, 3), Hv - 4);
  const arm = p.transeptArm ? s(p.transeptArm, 1) : 0;
  const k = (nave - 1) / 2;
  const flat = p.east === 'flat';
  const rI = k + 1, rO = rI + (aisle ? aisle + 1 : 0);
  // (a flat east end: the length is all nave and choir)
  // (a civic building may be short: three bays at least, not a cathedral's four)
  const civic = p.kind === 'civic';
  const bays = Math.max(civic ? 3 : 4, Math.floor((s(p.length, civic ? 8 : 20) - (flat ? 0 : rO) - 1) / pitch));
  const xe = bays * pitch;
  const tb = Math.min(Math.max(1, Math.round(p.transeptBay * p.bay / scale / pitch)), bays - p.transeptBays - 1);
  const xt0 = tb * pitch, xt1 = (tb + p.transeptBays) * pitch;
  // Side towers: a square box against the aisle wall (beyond a transept arm it stands beside)
  const sides = (p.sideTowers ?? []).map((t) => {
    const sz = s(t.size, 5), x0 = Math.min(Math.max(0, s(t.at, 0)), xe - sz);
    const past = arm > 0 && x0 <= xt1 && x0 + sz - 1 >= xt0 ? arm : 0;
    return { ...t, sz, x0, past };
  });
  // z: [margin][aisle wall][aisle][pier line][nave][pier line][aisle][aisle wall][margin]; the margin holds buttresses
  // and the transept arms (and side towers)
  const cs = p.cloister ? s(p.cloister.size, 6) : 0;
  const zOff = Math.max(butW, arm, ...sides.map((t) => t.sz + t.past), cs);
  const zA = zOff, zP = aisle ? zA + aisle + 1 : zA, zP2 = zP + nave + 1, zA2 = aisle ? zP2 + aisle + 1 : zP2;
  const D = zA2 + zOff + 1;
  const zc = (D - 1) / 2;
  // Radiating chapels: discs of low cells round the ambulatory, centred just outside it
  const nCh = flat ? 0 : p.chapels ?? 0;
  const rCh = nCh ? Math.max(1.5, (Math.PI * rO / nCh) * 0.45) : 0;
  const chapelAt = Array.from({ length: nCh }, (_, i) => {
    const a = -Math.PI / 2 + Math.PI * (i + 0.5) / nCh;
    return [xe + Math.cos(a) * (rO + rCh * 0.5), (zA + zA2) / 2 + Math.sin(a) * (rO + rCh * 0.5)];
  });
  const W = flat ? xe + butW + 2 : xe + rO + Math.max(butW, nCh ? Math.ceil(rCh * 1.5 + 1) : 0) + 2;
  const zN = zA - arm, zS = zA2 + arm;
  const towerH = p.towers ? Math.max(s(p.towerHeight), Hv + 4) : 0;
  const tS = zP - (zA - butW) + 1; // a west tower's side: buttress, aisle wall, aisle, pier line

  // The plan: 0 outside, 1 low, 2 high
  const plan: number[][] = Array.from({ length: W }, () => new Array(D).fill(0));
  const apseD = (x: number, z: number) => Math.hypot(x - xe, z - zc);
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      if (x <= xe && z >= zA && z <= zA2) plan[x][z] = z >= zP && z <= zP2 ? 2 : 1;
      else if (!flat && x > xe && apseD(x, z) < rO + 0.5) plan[x][z] = apseD(x, z) < rI + 0.5 ? 2 : 1;
      if (arm && x >= xt0 && x <= xt1 && z >= zN && z <= zS) plan[x][z] = 2;
      if (!plan[x][z] && x > xe && chapelAt.some(([u, v]) => Math.hypot(x - u, z - v) < rCh + 0.5)) plan[x][z] = 1;
    }
  const at = (x: number, z: number) => (x < 0 || z < 0 || x >= W || z >= D ? 0 : plan[x][z]);
  const touches = (x: number, z: number, v: number) => STEP4.some(([dx, dz]) => at(x + dx, z + dz) === v);
  const inTower = (x: number, z: number) =>
    p.towers === 2 ? x < tS && ((z >= zA - butW && z <= zP) || (z >= zP2 && z <= zA2 + butW))
    : p.towers === 1 ? x < tS && z >= zP - 1 && z <= zP2 + 1 : false;
  // Gable ends: the west front's high wall and the transept arms' end walls (and a flat east end's)
  const gable = (x: number, z: number) => at(x, z) === 2 && ((x === 0) || (flat && x === xe) || (arm > 0 && (z === zN || z === zS) && x >= xt0 && x <= xt1));

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
  const five = p.aisles === 5;
  const roofLow = (x: number, z: number) => Ha + 1 + (five ? Math.floor(lowRoof[x][z] / 2) : lowRoof[x][z]);

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
  const glassFor = (y: number, x: number, t?: number) => detail && t !== undefined
    ? `${colours[((Math.floor(t / pitch) % colours.length) + colours.length) % colours.length]}_stained_glass_pane`
    : ((y + x) % 5 === 0 ? M.red : M.blue);
  // (detail: a mullion down the middle of a window three or more wide)
  const winCols = pitch - 1 - (pitch >= 5 ? 2 : 0);
  const mullion = (t: number) => detail && winCols >= 3 && ((t % pitch) + pitch) % pitch === Math.floor(pitch / 2);
  const glassAt = (y: number, x: number, t: number, plain: boolean) => (mullion(t) ? T2.mullion : plain && !detail ? M.pane : glassFor(y, x, t));

  // 1. Pad and floor
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++)
      if (at(x, z)) set(x, 0, z, !detail ? M.floor : at(x, z) === 2 ? ((x + z) % 2 ? T2.floorB : M.floor) : T2.aisleFloor, 1);

  // 2-4. Walls: outer low walls, outer high walls, arcades
  const arcH = Math.max(2, Ha - 2);
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      const t = along(x, z), w = winCol(t);
      if (lWall(x, z)) {
        for (let y = 1; y <= Ha; y++) set(x, y, z, y === 1 ? M.tone : M.wall, 2);
        const lo = 2, hi = Ha <= 5 ? Ha - 1 : Ha - 2 - (w === 1 ? 1 : 0);
        if (w) for (let y = lo; y <= hi; y++) set(x, y, z, glassAt(y, x, t, true), 7);
      } else if (hWall(x, z)) {
        const outer = STEP4.some(([dx, dz]) => at(x + dx, z + dz) === 0);
        // (the west front between the towers is a screen up to its gallery, as Notre-Dame's, hiding the roof's end)
        const screen = x === 0 && p.towers === 2 ? Math.round(towerH * 0.65) : 0;
        const top = gable(x, z) ? Math.max(roofHigh(x, z) - 1, screen) : Hv;
        for (let y = 1; y <= top; y++) set(x, y, z, y === 1 ? M.tone : M.wall, y <= Ha ? (outer ? 2 : 3) : 4);
        if (outer) {
          // (a flat east end's gable holds the great east window)
          if (w && (!gable(x, z) || (flat && x === xe))) for (let y = 2; y <= Hv - 3 - (w === 1 ? 1 : 0); y++) set(x, y, z, glassAt(y, x, t, false), 7);
        } else if (w || winCol(t) === 0 && ((t % pitch) + pitch) % pitch !== 0) {
          // Arcade: pointed arches below, a triforium band, the clerestory above the aisle roof
          for (let y = 1; y <= arcH - (w === 1 ? 1 : 0); y++) clear(x, y, z);
          if (w && ((t % 2) + 2) % 2 === 1) clear(x, Ha, z);
          const lowN = STEP4.map(([dx, dz]) => [x + dx, z + dz]).find(([u, v]) => isLow(u, v));
          const roofAt = lowN ? roofLow(lowN[0], lowN[1]) : Ha + 1;
          if (w) for (let y = roofAt + 1; y <= Hv - 2 - (w === 1 ? 1 : 0); y++) set(x, y, z, glassAt(y, x, t, false), 7);
        }
      }
    }

  // Five aisles: a row of piers down the middle of each side's aisles (stage 3), pointed arches between them and a
  // spandrel wall up to the lean-to
  const zMid = [zA + 1 + Math.floor(aisle / 2), zA2 - 1 - Math.floor(aisle / 2)];
  if (five)
    for (let x = 1; x < xe; x++)
      for (const z of zMid) {
        if (!isLow(x, z) || (arm && x >= xt0 && x <= xt1)) continue;
        const m = x % pitch, top = roofLow(x, z) - 1;
        const from = m === 0 ? 1 : arcH + (pitch >= 3 && (m === 1 || m === pitch - 1) ? 0 : 1);
        for (let y = from; y <= top; y++) set(x, y, z, M.pier, 3);
      }

  // Portals: the west front's middle, each transept end, the apse's east; the towers add their own
  const ph = Math.max(3, Math.round(Hv * 0.3)), pw = nave >= 7 ? 1 : 0;
  const portal = (cx: number, cz: number, alongX: boolean, half: number, h: number) => {
    for (let o = -half; o <= half; o++)
      for (let y = 1; y <= h - (Math.abs(o) === half && half > 0 ? 1 : 0); y++) clear(alongX ? cx + o : cx, y, alongX ? cz : cz + o);
    // (detail: chiselled jambs either side, as high as the opening)
    if (detail)
      for (const o of [-half - 1, half + 1])
        for (let y = 1; y < h; y++) {
          const jx = alongX ? cx + o : cx, jz = alongX ? cz : cz + o;
          if (has(jx, y, jz) && !/glass|_wall$/.test(cells.get(key(jx, y, jz))!)) set(jx, y, jz, T2.jamb, stageOf.get(key(jx, y, jz))!);
        }
    // (accents: a west portal's ring in calcite, the jambs and the course over the opening)
    if (accents && cx === 0 && !alongX)
      for (let o = -half - 1; o <= half + 1; o++)
        for (let y = 1; y <= h + 1; y++) {
          const inside = (u: number, w: number) => Math.abs(u) <= half && w >= 1 && w <= h - (Math.abs(u) === half && half > 0 ? 1 : 0);
          if (inside(o, y) || ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([du, dw]) => inside(o + du, y + dw))) continue;
          const jz = cz + o;
          if (has(cx, y, jz) && !/glass|_wall$/.test(cells.get(key(cx, y, jz))!)) set(cx, y, jz, GEM.calcite, stageOf.get(key(cx, y, jz))!);
        }
  };
  portal(0, zc, false, pw, ph);
  if (arm) {
    const cx = Math.round((xt0 + xt1) / 2);
    portal(cx, zN, true, pw, ph); portal(cx, zS, true, pw, ph);
  }
  if (!flat) portal(xe + rO, zc, false, 0, Math.min(Ha, 3));

  // detail: each arcade pier's capital (chiselled, at the arches' height) and the arches' shoulders (upside-down stairs at
  // the top of an opening beside a pier, their backs to it), where the opening stays two high
  if (detail)
    for (let x = 0; x < W; x++)
      for (let z = 0; z < D; z++) {
        if (!hWall(x, z) || STEP4.some(([dx, dz]) => at(x + dx, z + dz) === 0)) continue;
        const arcade = (u: number, v: number) => hWall(u, v) && !STEP4.some(([ex, ez]) => at(u + ex, v + ez) === 0);
        const along2 = STEP4.filter(([dx, dz]) => arcade(x + dx, z + dz));
        if (has(x, 1, z)) {
          if (along2.some(([dx, dz]) => !has(x + dx, 1, z + dz)) && has(x, arcH, z)) set(x, arcH, z, T2.capital, 3);
          continue;
        }
        let top = 1;
        while (top < Hv && !has(x, top, z)) top++;
        const pier = along2.find(([dx, dz]) => has(x + dx, 1, z + dz));
        if (pier && top - 2 >= 2) set(x, top - 1, z, `${M.stair}[facing=${pier[2]},half=top]`, 3);
      }

  // Roses: a disc of stained panes in a wall's plane, tracery on the spokes of the larger ones
  const rose = (cx: number, cz: number, alongX: boolean, cy: number, r: number) => {
    for (let a = -r; a <= r; a++)
      for (let b = -r; b <= r; b++) {
        const d = Math.hypot(a, b);
        if (d > r + 0.3) continue;
        const ring = `${colours[Math.floor(d) % colours.length]}_stained_glass_pane`;
        const block = d < 0.8 ? (accents ? GEM.amethyst : detail ? `${colours[colours.length > 7 ? 7 : 0]}_stained_glass_pane` : M.yellow)
          : r >= 3 && d < r - 0.5 && (a === 0 || b === 0 || Math.abs(a) === Math.abs(b)) ? M.post
          : detail ? ring : d > r - 0.7 ? M.red : M.blue;
        set(alongX ? cx + a : cx, cy + b, alongX ? cz : cz + a, block, block === M.post ? 7 : 7);
      }
  };
  const roseR = Math.max(1, Math.min(k, Math.floor(s(p.rose || p.nave * 0.6) / 2)));
  const roseY = Math.min(Hv - roseR - 1, Math.max(ph + roseR + 2, Math.round(Hv * 0.62)));
  if (p.rose && p.westRose !== false) rose(0, zc, false, roseY, roseR);
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

  // The cloister: a square against the aisle wall west of the transept, its outer wall with a door in the west side, a
  // walk round it under a flat roof, an arcade of posts onto the garth (the box cleared of buttresses first)
  if (cs) {
    const south = p.cloister!.side === 's', w = Math.max(1, s(4)), hW = Math.max(3, s(4.5, 3));
    const cx1 = Math.max(cs - 1, xt0 - 1), cx0 = Math.max(0, cx1 - cs + 1);
    const cz0 = south ? zA2 + 1 : zA - cs, cz1 = south ? zA2 + cs : zA - 1;
    // (e: the rows in from the outer edge; the church side's first row is the walk, its wall the aisle's)
    const e = (x: number, z: number) => Math.min(x - cx0, cx1 - x, south ? cz1 - z : z - cz0, (south ? z - cz0 : cz1 - z) + 1);
    const zm = Math.round((cz0 + cz1) / 2);
    for (let x = cx0; x <= cx1; x++)
      for (let z = cz0; z <= cz1; z++) {
        for (const kk of [...cells.keys()]) if (kk.startsWith(`${x},`) && kk.endsWith(`,${z}`) && Number(kk.split(',')[1]) > 0) clear(x, Number(kk.split(',')[1]), z);
        set(x, 0, z, M.floor, 1);
        const d = e(x, z);
        if (d === 0 && !(x === cx0 && (z === zm || z === zm + 1)))
          for (let y = 1; y <= hW; y++) set(x, y, z, y === 1 ? M.tone : M.wall, 2);
        if (d === w + 1) {
          for (let y = 1; y < hW; y++) if ((x + z) % 2 === 0) set(x, y, z, M.post, 3);
          set(x, hW, z, M.wall, 3);
        }
        if (d <= w + 1) set(x, hW + 1, z, M.slab, 5);
      }
    // (a floored path from the door to the grid's west edge, the passage through the west range)
    for (let x = 0; x < cx0; x++) for (const z of [zm, zm + 1]) set(x, 0, z, M.floor, 1);
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
  // (#162 tier 3: the high roof's own names, cut copper with `copperRoof`; the low roof keeps the deepslate)
  const hiTile = opts.copperRoof ? COPPER.tile : M.tile, hiStair = opts.copperRoof ? COPPER.tileStair : M.tileStair;
  const roofCell = (x: number, z: number, h: (u: number, v: number) => number, inside: (u: number, v: number) => boolean, tile = M.tile, tileStair = M.tileStair) => {
    const me = h(x, z);
    let best: string | null = null, bestH = me;
    for (const [dx, dz, f] of STEP4) {
      const u = x + dx, v = z + dz;
      if (!inside(u, v)) continue;
      const hn = h(u, v);
      if (hn > bestH) { bestH = hn; best = f; }
    }
    return best ? `${tileStair}[facing=${best},half=bottom]` : tile;
  };
  for (let x = 0; x < W; x++)
    for (let z = 0; z < D; z++) {
      // (not over the west screen, which stands above the roof's end)
      if (isHigh(x, z)) { if (!(x === 0 && p.towers === 2)) set(x, roofHigh(x, z), z, roofCell(x, z, roofHigh, isHigh, hiTile, hiStair), 5); }
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
    // (detail: a west tower's belfry floor, for the bell)
    if (detail && foot) for (let x = x0 + 1; x < x1; x++) for (let z = z0 + 1; z < z1; z++) set(x, belfry - 1, z, M.slab + '[type=top]', 6);
    if (spire > 0) drawSpire(cxT, czT, (Math.min(x1 - x0, z1 - z0)) / 2, y1, spire);
  };
  const drawSpire = (cx: number, cz: number, r0: number, y0: number, h: number) => spire(set, cx, cz, r0, y0, h, !!p.openwork);
  towerBoxes.forEach((bx, i) => {
    shellTower(bx, 1, towerH, s(p.spires[i] ?? 0, 0), true);
    // At the foot: the west portal, an arch to the aisle (east face) and one to the nave (inner face)
    const [x0, x1, z0, z1] = bx, cz = Math.round((z0 + z1) / 2), cx = Math.round((x0 + x1) / 2);
    const h = Math.max(3, Math.min(ph, Ha));
    portal(x0, cz, false, pw, ph);
    // (a single tower's east arch opens into the nave)
    portal(x1, p.towers === 1 ? Math.round(zc) : Math.round(z0 > zc ? (zP2 + zA2) / 2 : (zA + zP) / 2), false, Math.min(pw, 1), h);
    if (p.towers === 2) portal(cx, z0 < zc ? z1 : z0, true, Math.min(pw, 1), h);
    else portal(cx, z0, true, 0, h), portal(cx, z1, true, 0, h);
  });
  // Side towers: floored, a shell from the ground as the west towers', a door in the outer face
  for (const t of sides) {
    const north = t.side === 'n';
    const z0 = north ? (t.past ? zN : zA) - t.sz : (t.past ? zS : zA2) + 1, z1 = z0 + t.sz - 1;
    const bx: [number, number, number, number] = [t.x0, t.x0 + t.sz - 1, z0, z1];
    for (let x = bx[0]; x <= bx[1]; x++) for (let z = z0; z <= z1; z++) set(x, 0, z, M.floor, 1);
    shellTower(bx, 1, Math.max(s(t.height), Hv + 4), s(t.spire, 0), true);
    portal(Math.round((bx[0] + bx[1]) / 2), north ? z0 : z1, true, 0, Math.max(3, Math.min(ph, Ha)));
    // (a floored path from the door to the grid's edge when a wider margin, a cloister's, leaves one between)
    for (let z = north ? 0 : z1 + 1; z < (north ? z0 : D); z++) set(Math.round((bx[0] + bx[1]) / 2), 0, z, M.floor, 1);
  }

  // (accents: a calcite string course across the west front at the aisles' height)
  if (accents)
    for (let z = 0; z < D; z++) {
      const b = cells.get(key(0, Ha, z));
      if (b === M.wall || b === M.tone) set(0, Ha, z, GEM.calcite, stageOf.get(key(0, Ha, z))!);
    }

  // The crossing: a flèche above the ridge or a tower with a spire
  const cxC = Math.round((xt0 + xt1) / 2), czC = Math.round(zc);
  if (p.crossing === 'fleche') {
    const base = roofHigh(cxC, czC) + 1, h = s(p.crossingSpire, 6);
    for (let y = base; y < base + 3; y++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
      if (Math.abs(dx) + Math.abs(dz) < 2 || y === base) set(cxC + dx, y, czC + dz, hiTile, 8);
    for (let y = base + 3; y < base + h; y++) set(cxC, y, czC, M.post, 8);
  } else if (p.crossing === 'tower') {
    const y1 = Math.max(s(p.crossingHeight), Hv + 6);
    shellTower([xt0, xt1, zP, zP2], Hv + 1, y1, s(p.crossingSpire, 0), false);
  }

  // 9 (detail). The furnishing: a lantern on a chain from the vault's crown at each bay line of the nave, the bell under a
  // tower's ceiling, an altar with candles in the apse when the nave is wide enough to walk round it, banners on the
  // arcade piers facing into the nave
  const furnish = detail && opts.furnish !== false;
  if (furnish) {
    const fk = opts.furnishKinds, kind = (k: 'lanterns' | 'bell' | 'candles' | 'banners') => !fk || !!fk[k];
    const empty = (x: number, y: number, z: number) => !has(x, y, z);
    const zr = Math.round(zc);
    for (let i = 0; kind('lanterns') && i <= Math.floor(xe / pitch); i++) {
      const x = i * pitch;
      if (inTower(x, zr) || x < tower0) continue;
      let yv = 2;
      while (yv <= Hv + 1 && empty(x, yv, zr)) yv++;
      if (yv > Hv + 1) continue;
      const len = Math.max(1, Math.min(6, Math.round((yv - 4) / 2)));
      const yl = Math.max(3, yv - 1 - len);
      if (yl >= yv) continue;
      for (let y = yl + 1; y < yv; y++) set(x, y, zr, T2.chain, 9);
      set(x, yl, zr, T2.lantern, 9);
    }
    // (the bell stands on a west tower's belfry floor, or hangs from the crossing tower's ceiling)
    const bellBox: [number, number, number, number] | null = towerBoxes[0] ?? (p.crossing === 'tower' ? [xt0, xt1, zP, zP2] : null);
    if (bellBox && kind('bell')) {
      const bx = Math.floor((bellBox[0] + bellBox[1]) / 2), bz = Math.floor((bellBox[2] + bellBox[3]) / 2);
      if (towerBoxes[0]) {
        const belfry = towerH - Math.max(3, Math.round((towerH - 1) * 0.25));
        if (has(bx, belfry - 1, bz) && empty(bx, belfry, bz)) set(bx, belfry, bz, T2.bellFloor, 9);
      } else {
        const top = Math.max(s(p.crossingHeight), Hv + 6);
        if (has(bx, top - 1, bz) && empty(bx, top - 2, bz)) set(bx, top - 2, bz, T2.bell, 9);
      }
    }
    if (nave >= 7 && kind('candles')) {
      const ax = flat ? xe - 2 : xe + Math.max(1, Math.floor(rI / 2));
      if ([-1, 0, 1].every((o) => isHigh(ax, zr + o) && !hWall(ax, zr + o) && empty(ax, 1, zr + o))) {
        for (const o of [-1, 0, 1]) set(ax, 1, zr + o, accents ? GEM.amethyst : T2.altar, 9);
        for (const o of [-1, 1]) set(ax, 2, zr + o, T2.candle, 9);
      }
    }
    const banners = opts.banners?.length ? opts.banners : ['white', colours[0]];
    let nb = 0;
    for (let x = tower0; kind('banners') && x <= xe; x++)
      for (let z = 0; z < D; z++) {
        if (!hWall(x, z) || inTower(x, z) || STEP4.some(([dx, dz]) => at(x + dx, z + dz) === 0) || !has(x, 1, z) || (arm && x >= xt0 && x <= xt1)) continue;
        if (!STEP4.some(([dx, dz]) => hWall(x + dx, z + dz) && !has(x + dx, 1, z + dz))) continue;
        const into = STEP4.find(([dx, dz]) => isHigh(x + dx, z + dz) && !hWall(x + dx, z + dz));
        const y = arcH + 1;
        if (!into || y < 3 || !has(x, y, z) || !empty(x + into[0], y, z + into[1])) continue;
        set(x + into[0], y, z + into[1], `${banners[nb++ % banners.length]}_wall_banner[facing=${into[2]}]`, 9);
      }
  }

  // A roof stair in a saddle (small chapels, a tower's foot): nothing higher before it, or roof behind it above, is a full
  // tile, so every stair left faces uphill
  for (const [kk, b] of [...cells]) {
    const m = /^(\w+_stairs)\[facing=(\w+),half=bottom\]$/.exec(b);
    if (!m || (m[1] !== M.tileStair && m[1] !== COPPER.tileStair)) continue;
    const [x, y, z] = kk.split(',').map(Number);
    const [dx, dz] = STEP4.find((st) => st[2] === m[2])!;
    const behind = cells.get(key(x - dx, y + 1, z - dz));
    if (!has(x + dx, y, z + dz) && !has(x + dx, y + 1, z + dz) || (behind && /tile/.test(behind) && behind !== M.tileSlab))
      cells.set(kk, m[1] === COPPER.tileStair ? COPPER.tile : M.tile);
  }

  return finish(p, scale, cells, stageOf, W, D, opts, furnish ? GOTHIC_STAGES_DETAIL : GOTHIC_STAGES);
}

/** A spire: an octagon (a square with its corners cut) narrowing to a post, solid or openwork (Cologne's: solid bands
 *  every third course, a lattice of posts between). */
function spire(set: (x: number, y: number, z: number, b: string, st: number) => void, cx: number, cz: number, r0: number, y0: number, h: number, openwork: boolean) {
  for (let i = 0; i < h; i++) {
    const lattice = openwork && i % 3 !== 0 && i < h - 2;
    const r = r0 * (1 - i / h);
    const inO = (x: number, z: number) => Math.abs(x - cx) <= r && Math.abs(z - cz) <= r && Math.abs(x - cx) + Math.abs(z - cz) <= r * 1.42;
    let any = false;
    for (let x = Math.floor(cx - r0); x <= Math.ceil(cx + r0); x++)
      for (let z = Math.floor(cz - r0); z <= Math.ceil(cz + r0); z++)
        if (inO(x, z) && STEP4.some(([dx, dz]) => !inO(x + dx, z + dz))) {
          any = true;
          if (!lattice) set(x, y0 + i, z, M.wall, 8);
          else if ((x + z + i) % 2 === 0) set(x, y0 + i, z, M.post, 8);
        }
    if (!any) { set(Math.round(cx), y0 + i, Math.round(cz), M.post, 8); }
  }
  set(Math.round(cx), y0 + h, Math.round(cz), M.post, 8);
}

/** A free-standing bell tower (form 'tower'): a square shell (`nave` its side) with floors every storey, a door in the
 *  west face, belfry openings, a parapet; a narrower top stage (`upper`) and a spire (`spires[0]`) when given. */
function generateBelfry(p: GothicPreset, scale: number, opts: GothicOpts): Cathedral {
  const s = (m: number, min = 1) => Math.max(min, Math.round(m / scale));
  const cells = new Map<string, string>(), stageOf = new Map<string, number>();
  const set = (x: number, y: number, z: number, b: string, st: number) => { cells.set(key(x, y, z), b); stageOf.set(key(x, y, z), st); };
  const clear = (x: number, y: number, z: number) => { cells.delete(key(x, y, z)); stageOf.delete(key(x, y, z)); };
  const n = Math.max(5, s(p.nave, 5)), H = Math.max(8, s(p.towerHeight, 8)), storey = Math.max(4, s(8, 4));
  // A square stage from y0 to y1 (the parapet above y1), side m from (o, o)
  const stage = (o: number, m: number, y0: number, y1: number, ground: boolean) => {
    const c = o + (m - 1) / 2, belfry = y1 - Math.max(3, Math.round((y1 - y0) * 0.25));
    for (let x = o; x < o + m; x++)
      for (let z = o; z < o + m; z++) {
        const edge = x === o || x === o + m - 1 || z === o || z === o + m - 1;
        if (ground) set(x, 0, z, M.floor, 1);
        if (!edge) {
          for (let y = y0 + storey; y < y1 - 1; y += storey) set(x, y, z, `${M.slab}[type=top]`, 6);
          set(x, y1 - 1, z, `${M.slab}[type=top]`, 6);
          continue;
        }
        for (let y = y0; y < y1; y++) set(x, y, z, y === 1 ? M.tone : M.wall, y <= 4 ? 2 : 6);
        const corner = (x === o || x === o + m - 1) && (z === o || z === o + m - 1);
        if (corner || (x + z) % 2 === 0) set(x, y1, z, M.post, 8);
        const off = x === o || x === o + m - 1 ? Math.abs(z - c) : Math.abs(x - c);
        if (!corner && off >= (m >= 7 ? 1 : 0) && off <= (m - 1) / 2 - 1) for (let y = belfry; y < y1 - 2; y++) clear(x, y, z);
      }
  };
  stage(0, n, 1, H, true);
  const c = (n - 1) / 2;
  for (const dz of n % 2 ? [0] : [-0.5, 0.5]) for (let y = 1; y <= 3; y++) clear(0, y, Math.round(c + dz));
  let top = H, r0 = (n - 1) / 2;
  if (p.upper) {
    const m = Math.max(3, Math.min(n - 2, s(p.upper.side, 3))), o = Math.round((n - m) / 2);
    if ((n - m) % 2) set(o + m, H, o + m, M.wall, 6);
    top = H + Math.max(3, s(p.upper.height, 3));
    stage(o, m, H, top, false);
    r0 = (m - 1) / 2;
  }
  const sp = s(p.spires[0] ?? 0, 0);
  if (sp) spire(set, c, c, r0, top, sp, !!p.openwork);
  return finish(p, scale, cells, stageOf, n, n, opts, GOTHIC_STAGES);
}

function finish(p: GothicPreset, scale: number, cells: Map<string, string>, stageOf: Map<string, number>, W: number, D: number,
  opts: GothicOpts, stageNames: readonly string[]): Cathedral {
  if (opts.blocks) for (const [kk, b] of cells) cells.set(kk, opts.blocks(b));
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
  const stages = new Array(stageNames.length).fill(0);
  for (const [kk, b] of cells) {
    const [item, n] = gothicCost(b);
    bill[item] = (bill[item] ?? 0) + n;
    stages[stageOf.get(kk)! - 1]++;
  }
  const design: Design = {
    name: `${p.name}_1_${scale}`.slice(0, 32), description: `${p.description} (1:${scale})`.slice(0, 200),
    palette, layers, width: W, depth: D, height: H, blocks: cells.size, by: 'gothicGen',
  };
  const cellJob = new Map<string, number>();
  const jobs = cutJobs(cells, stageOf, opts.jobMin ?? 300, opts.jobMax ?? 800, cellJob, stageNames.length);
  return { design, scale, stages, jobs, bill, cellStage: stageOf, cellJob, stageNames };
}

/** Each stage's cells cut into jobs: whole x slices gathered west to east until a job holds jobMin; a slice larger
 *  than jobMax is cut into bands of layers. The last job of a stage may be smaller. */
function cutJobs(cells: Map<string, string>, stageOf: Map<string, number>, jobMin: number, jobMax: number, cellJob: Map<string, number>, nStages: number): GothicJob[] {
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
        const [item, n] = gothicCost(b);
        j.bill[item] = (j.bill[item] ?? 0) + n;
        cellJob.set(key(x, y, z), jobs.length);
      }
      jobs.push(j); cur = [];
    };
    for (const x of [...bySlice.keys()].sort((a, b) => a - b)) {
      let slice = bySlice.get(x)!;
      if (slice.length > jobMax) {
        // (a job gathered short of jobMin goes with the big slice's bands)
        if (cur.length >= jobMin) flush();
        else slice = [...cur, ...slice], cur = [];
        slice.sort((a, b) => a[1] - b[1]);
        // (bands of jobMax, or equal bands when the last would fall under jobMin)
        const band = slice.length % jobMax && slice.length % jobMax < jobMin ? Math.ceil(slice.length / Math.ceil(slice.length / jobMax)) : jobMax;
        for (let i = 0; i < slice.length; i += band) { cur = slice.slice(i, i + band); flush(); }
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
