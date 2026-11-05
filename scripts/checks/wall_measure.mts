// #217 step 0 (docs/specs/castle-walls.md 3-4): what a castle wall on a village's planned ring would take. For each
// village of a checkpoint with a voted wall (its rects as saved), or else the ring startWall would plan (the hull of its
// layouts and structures + WALL_MARGIN, other villages' boxes kept off as mcWalls.ts keepBoxes does), it reads the
// ground under every ring cell from the checkpoint's saved world (scripts/checks/wall_columns.py over region_blocks.py)
// and prints: the ring's length, water cells and their depth (surface to bed), the relief (footing: per cell, the
// highest ground of its two ring neighbours minus its own, when above), street and pad-path crossings, corners, and the
// stone bill of each stage with the spec's per-unit numbers.
// Run: node node_modules/tsx/dist/cli.mjs scripts/checks/wall_measure.mts [CHECKPOINT ...]   (default w203_n9 w211_n3)
//      a CHECKPOINT may also be a path to a villages.json, with WORLD=<world folder> for its blocks
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WALL_MARGIN, growBox, hull, orderRing, straightAxis, wallPlan, type Box, type Cell } from '../../server/src/walls';

type V = { name: string; plots?: Box[]; layouts?: Array<Box & { streets?: Box[]; paths?: Array<{ cells: number[][] }>; pads?: Box[] }>; structures?: Array<Box & { kind?: string }>; wall?: { state: string; rects: Box[]; segs: Array<{ cells: Cell[] }>; built?: Record<string, { y: number }>; gaps?: string[] } };

const ROOT = new URL('../../', import.meta.url);
const key = (x: number, z: number) => `${x},${z}`;
const boxesOf = (v: V): Box[] => [...(v.layouts ?? []), ...(v.structures ?? [])].map((b) => ({ x1: b.x1, z1: b.z1, x2: b.x2, z2: b.z2 }));
const keepBoxes = (all: V[], v: V): Box[] => all.filter((o) => o.name !== v.name).flatMap((o) => [...boxesOf(o), ...(o.plots ?? [])].map((b) => growBox(b, 1)));

// The spec's per-unit stone (section 3)
const CORNER_MERGE = 10, CURTAIN = 10.5, LEAN = 6.5, TOWER = 160, GATEHOUSE = 300, TOWER_EVERY = 40;

function measure(label: string, file: string, world: string): void {
  const all = (JSON.parse(readFileSync(file, 'utf8')) as { villages: V[] }).villages;
  for (const v of all) {
    let rects: Box[], src: string, built: Record<string, { y: number }> = {};
    if (v.wall?.state === 'voted') {
      rects = v.wall.rects;
      built = v.wall.built ?? {};
      src = `voted wall (${rects.length} rect${rects.length === 1 ? '' : 's'}, ${Object.keys(built).length} cells built)`;
    } else {
      const h = hull(boxesOf(v));
      if (!h) continue;
      rects = [growBox(h, WALL_MARGIN)];
      src = 'planned here as startWall would';
    }
    const plan = wallPlan(rects, { keep: keepBoxes(all, v) });
    const order = orderRing([...plan.ring].map((k) => { const [x, z] = k.split(',').map(Number); return { x, z }; }));
    const gapSet = new Set(plan.gaps.map((c) => key(c.x, c.z)));
    // Ground under every ring cell
    const tmp = mkdtempSync(join(tmpdir(), 'wall-measure-'));
    writeFileSync(join(tmp, 'cells.json'), JSON.stringify(order.map((c) => [c.x, c.z])));
    const cols = JSON.parse(execFileSync('python', [new URL('wall_columns.py', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), world, join(tmp, 'cells.json')], { maxBuffer: 1 << 26 }).toString()) as Record<string, { g: number | null; w: number | null; lava: boolean; top: string | null }>;
    // a built fence cell stands on its cobblestone: the ground is one below the lowest block set
    const ground = (c: Cell): number | null => (built[key(c.x, c.z)] ? built[key(c.x, c.z)].y - 1 : cols[key(c.x, c.z)]?.g ?? null);
    const n = order.length;
    // Water
    const wet = order.filter((c) => cols[key(c.x, c.z)]?.w != null && !cols[key(c.x, c.z)].lava);
    const lava = order.filter((c) => cols[key(c.x, c.z)]?.lava).length;
    const depths = wet.map((c) => { const q = cols[key(c.x, c.z)]; return q.g == null ? 20 : q.w! - q.g; });
    let wetRuns = 0;
    for (let i = 0; i < n; i++) if (cols[key(order[i].x, order[i].z)]?.w != null && cols[key(order[(i - 1 + n) % n].x, order[(i - 1 + n) % n].z)]?.w == null) wetRuns++;
    const hist = (xs: number[]) => { const m = new Map<number, number>(); for (const d of xs) m.set(d, (m.get(d) ?? 0) + 1); return [...m].sort((a, b) => a[0] - b[0]).map(([d, k]) => `${d}:${k}`).join(' '); };
    // Relief: per dry cell, the higher of its two ring neighbours' ground minus its own (the footing to bring it level)
    const reliefs: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = order[i];
      if (cols[key(c.x, c.z)]?.w != null) continue;
      const g = ground(c);
      if (g == null) continue;
      const nb = [order[(i - 1 + n) % n], order[(i + 1) % n]].filter((q) => cols[key(q.x, q.z)]?.w == null).map(ground).filter((y): y is number => y != null);
      reliefs.push(Math.max(0, ...nb.map((y) => y - g)));
    }
    const footing = reliefs.reduce((a, b) => a + b, 0);
    const grounds = order.map(ground).filter((y): y is number => y != null);
    // Crossings: street, pad and pad-path cells on the ring; then streets that end on their layout's edge, carried on
    // outward along their axis until they meet the ring (where a road out of the village would cross it)
    const onRing = new Set<string>();
    const ringHas = (x: number, z: number) => plan.ring.has(key(x, z));
    for (const l of v.layouts ?? []) {
      for (const s of [...(l.streets ?? []), ...(l.pads ?? [])]) for (let x = s.x1; x <= s.x2; x++) for (let z = s.z1; z <= s.z2; z++) if (ringHas(x, z)) onRing.add(key(x, z));
      for (const p of l.paths ?? []) for (const [x, z] of Array.isArray(p.cells) ? p.cells : []) if (ringHas(x, z)) onRing.add(key(x, z));
    }
    const exits: string[] = [];
    for (const l of v.layouts ?? []) for (const s of l.streets ?? []) {
      const wide = s.x2 - s.x1 >= s.z2 - s.z1; // runs east-west
      const ends: Array<[number, number, number, number]> = wide
        ? [[s.x1, (s.z1 + s.z2) >> 1, -1, 0], [s.x2, (s.z1 + s.z2) >> 1, 1, 0]].filter(([x]) => x === l.x1 || x === l.x2) as Array<[number, number, number, number]>
        : [[(s.x1 + s.x2) >> 1, s.z1, 0, -1], [(s.x1 + s.x2) >> 1, s.z2, 0, 1]].filter(([, z]) => z === l.z1 || z === l.z2) as Array<[number, number, number, number]>;
      for (const [x0, z0, dx, dz] of ends) {
        // (only an end on the layout's outside edge facing the way out)
        if ((dx < 0 && x0 !== l.x1) || (dx > 0 && x0 !== l.x2) || (dz < 0 && z0 !== l.z1) || (dz > 0 && z0 !== l.z2)) continue;
        for (let k = 1; k <= 200; k++) {
          const x = x0 + dx * k, z = z0 + dz * k;
          if (ringHas(x, z)) { exits.push(key(x, z)); break; }
        }
      }
    }
    // merge exits within 6 cells (one gatehouse)
    const gates: Cell[] = [];
    for (const e of [...onRing, ...exits]) { const [x, z] = e.split(',').map(Number); if (!gates.some((g) => Math.abs(g.x - x) + Math.abs(g.z - z) <= 6)) gates.push({ x, z }); }
    // Corners (cells not on a straight run), clustered; a tower at each and one more every TOWER_EVERY along the runs
    const ring = plan.ring;
    const isCorner = order.map((c) => straightAxis(ring, c.x, c.z) == null);
    const corners: number[] = [];
    // (corners within CORNER_MERGE cells along the ring are one tower: a grown ring's 1-2 cell jogs)
    for (let i = 0; i < n; i++) if (isCorner[i] && !isCorner[(i - 1 + n) % n] && (!corners.length || i - corners[corners.length - 1] > CORNER_MERGE)) corners.push(i);
    if (corners.length > 1 && corners[0] + n - corners[corners.length - 1] <= CORNER_MERGE) corners.pop();
    const rawCorners = order.filter((_, i) => isCorner[i] && !isCorner[(i - 1 + n) % n]).length;
    let runTowers = 0;
    for (let k = 0; k < corners.length; k++) {
      const a = corners[k], b = corners[(k + 1) % corners.length];
      const len = ((b - a + n) % n) || n;
      runTowers += Math.floor(len / TOWER_EVERY);
    }
    const towers = corners.length + runTowers;
    const dam = depths.reduce((a, d) => a + d + 2, 0);
    const curtain = Math.round(CURTAIN * n), foot2 = footing * 2;
    const lean = Math.round(LEAN * n);
    console.log(`\n== ${label} ${v.name}: ${src}`);
    console.log(`ring ${n} cells (${plan.gaps.length} kept off another village's work${gapSet.size ? '' : ''}); hull ${JSON.stringify(hull(rects))}`);
    console.log(`ground y ${Math.min(...grounds)}..${Math.max(...grounds)}; ${order.length - grounds.length} cells with no ground read`);
    console.log(`water: ${wet.length} cells in ${wetRuns} stretches; depth (surface to bed) ${hist(depths)}; mean ${(depths.reduce((a, b) => a + b, 0) / Math.max(1, depths.length)).toFixed(1)}${lava ? `; lava ${lava}` : ''}`);
    console.log(`relief (footing a cell, dry cells): ${hist(reliefs)}; sum ${footing} (x2 for 2 thick: ${foot2}); cells needing any ${reliefs.filter((r) => r > 0).length}`);
    console.log(`crossings: ${onRing.size} street/pad/path cells on the ring; ${exits.length} street ends carried out to it, ${gates.length} gatehouse sites (both merged within 6): ${gates.map((g) => key(g.x, g.z)).join(' ')}; the fence ring has ${plan.segs.length} segments (a gate each)`);
    console.log(`corners ${rawCorners} (${corners.length} after merging those within ${CORNER_MERGE} cells); towers ${towers} (corners + ${runTowers} every ${TOWER_EVERY} on the runs)`);
    const rows: Array<[string, string, string, number]> = [
      ['Curtain (2 x 4, parapet, merlons 0.5, lip)', `${CURTAIN} a cell`, `${n}`, curtain],
      ['Footing (measured relief, 2 columns)', 'measured', `${reliefs.filter((r) => r > 0).length} cells`, foot2],
      ['Towers', `${TOWER}`, `${towers}`, towers * TOWER],
      ['Gatehouses', `${GATEHOUSE}`, `${gates.length}`, gates.length * GATEHOUSE],
      ['Water dams (depth + 2 a cell)', 'measured', `${wet.length}`, dam],
    ];
    const whole = rows.reduce((a, r) => a + r[3], 0);
    console.log('| Part | Stone a unit | Units | Stone |\n|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.join(' | ')} |`);
    console.log(`| **Whole wall** | | | **${whole}** |`);
    console.log(`| Lean curtain instead (1 thick, ${LEAN} a cell + 1 footing column) + towers, gates, dams | | | ${lean + footing + towers * TOWER + gates.length * GATEHOUSE + dam} |`);
    console.log(`(dams with 2 columns: ${dam * 2}; curtain + footing only: ${curtain + foot2})`);
  }
}

const args = process.argv.slice(2);
for (const a of args.length ? args : ['w203_n9', 'w211_n3']) {
  const cp = new URL(`mc/testcheckpoints/${a}/`, ROOT);
  if (existsSync(new URL('villages.json', cp))) measure(a, new URL('villages.json', cp).pathname.replace(/^\/([A-Za-z]:)/, '$1'), new URL('world', cp).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  else measure(a, a, process.env.WORLD ?? 'mc/testserver/world');
}
