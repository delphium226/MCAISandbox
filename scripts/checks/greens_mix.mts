/**
 * What fills a green (MC_GREENS_MIX, the user's 10-28; D1: 146 small works on 13 21x21 greens, 77 of them one 1x1 lamp).
 * Offline, no server:
 * - the parterre's shapes at 5, 7 and 9: symmetric four ways, a centre, paths between beds, every shape different;
 * - a green's reserves: the parterre's square at its centre, two corner trees clear of it, the same reserve found again
 *   once works stand round it, none once a parterre and two saplings stand; shapes and sizes differ from green to green;
 * - the caps (lamps together) and the menu's order (parterre and trees first, larger works next);
 * - gardenSpots with the reserves: a parterre spot a green (no flower ring), saplings only on the reserved corners;
 * - a fill of three 21x21 greens by 25 members' menus as the world makes them (the first two kinds with a spot, the
 *   first chosen), flag off and on: the commonest kind's share on greens, kinds per green, parterres and trees.
 * Writes runs/renders/greens_mix_green.json (one filled green with the flag on) for scripts/render_design.py.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/greens_mix.mts (sets its flag itself)
 */
import { mkdirSync, writeFileSync } from 'fs';

process.env.MC_GREENS_MIX = 'on';
const sw = await import('../../server/src/smallWorks');
const { shuffled } = await import('../../server/src/choose');
type Area = import('../../server/src/village').Area;
type Design = import('../../server/src/village').Design;

let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};

// 1. The shapes
const seen = new Set<string>();
for (const S of [5, 7, 9]) for (const shape of sw.PARTERRE_SHAPES) {
  const rows = sw.parterreRows(shape, S);
  const flip = (r: string[]) => [...r].reverse();
  const mirror = (r: string[]) => r.map((x) => [...x].reverse().join(''));
  const turn = (r: string[]) => r.map((_, j) => r.map((x) => x[j]).reverse().join(''));
  const planted = rows.join('').replace(/_/g, '').length;
  ok(rows.length === S && rows.every((r) => r.length === S), `${shape}${S}: ${S}x${S}`);
  ok(JSON.stringify(flip(rows)) === JSON.stringify(rows) && JSON.stringify(mirror(rows)) === JSON.stringify(rows) && JSON.stringify(turn(rows)) === JSON.stringify(rows), `${shape}${S}: symmetric four ways`);
  ok(rows[(S - 1) / 2][(S - 1) / 2] === 'C', `${shape}${S}: a centre`);
  ok(planted >= S && planted < S * S, `${shape}${S}: beds and paths (${planted} of ${S * S} planted)`);
  seen.add(rows.join('/'));
}
ok(seen.size === 18, `every shape and size its own pattern (${seen.size} of 18)`);
const kind = sw.GARDEN_WORKS.find((k) => k.kind === 'parterre')!;
ok(kind && sw.SMALL_WORKS.includes(kind), 'the parterre on the menu with the flag');
const pd = kind.make('birch', ['poppy', 'dandelion', 'cornflower'], 'star9');
ok(pd.width === 9 && pd.depth === 9 && pd.height === 2 && pd.name === 'small_parterre_birch~star9~poppy-dandelion-cornflower', `a star9 parterre of a mix (${pd.name})`);
ok(sw.smallWorkWood(pd.name) === 'birch' && sw.smallWorkKindOf(pd.name) === 'parterre' && sw.isSmallWork(pd.name), 'its wood and kind read from its name');
ok(pd.palette.A === 'poppy' && pd.palette.B === 'dandelion' && pd.palette.C === 'cornflower', 'A, B and C the mix\'s first three');
const two = kind.make('oak', ['wildflowers', 'allium'], 'quarters7');
ok(Object.values(two.palette).every((b) => /wildflowers|allium/.test(b)), 'a mix of two: the C bed falls back');
ok(sw.isFlowerWork('parterre'), 'a flower work (planted from the mix)');
// (a flower dropped from the mix redraws it in its own shape: G1's knot5 came back as a quarters7, larger than its spot)
ok(sw.parterreShapeOf(pd.name) === 'star9' && sw.parterreShapeOf('small_front_bed_oak~poppy') === undefined, 'the shape read back from a parterre\'s name');
const redrawn = kind.make('birch', ['dandelion'], sw.parterreShapeOf(pd.name));
ok(redrawn.width === 9 && redrawn.name === 'small_parterre_birch~star9~dandelion', `redrawn in its shape (${redrawn.name})`);

// 2. Reserves
const G = (id: string, x1: number, z1: number, side = 21): import('../../server/src/smallWorks').GreenArea => ({ id, x1, z1, x2: x1 + side - 1, z2: z1 + side - 1, y: 64 });
const greens = [G('i1', 0, 0), G('i2', 30, 0), G('i3', 60, 0), G('i4', 90, 0, 15)];
const r0 = sw.greenReserves(greens, [], [], 'A');
ok(r0.every((r) => r.pattern), 'a parterre reserved on every green');
const p1 = r0[0].pattern!;
ok((p1.x1 + p1.x2) / 2 === 10 && (p1.z1 + p1.z2) / 2 === 10, `the first at its green's centre (${p1.x1},${p1.z1}-${p1.x2},${p1.z2})`);
ok(new Set(r0.map((r) => r.pattern!.shape)).size === 4, `shapes differ green to green (${r0.map((r) => r.pattern!.shape).join(', ')})`);
ok(r0[3].pattern!.shape.endsWith('5') && r0[0].pattern!.shape.endsWith('7'), "a 21 green's parterre 7 across, a 15 green's 5");
ok(r0.every((r) => r.trees.length === 2), 'two corner trees a green');
const clash = (a: Area, b: Area) => a.x1 <= b.x2 && a.x2 >= b.x1 && a.z1 <= b.z2 && a.z2 >= b.z1;
ok(r0.every((r) => r.trees.every((t) => !clash({ x1: t.x - 2, z1: t.z - 2, x2: t.x + 2, z2: t.z + 2 }, r.pattern!))), 'tree canopies clear of the parterre');
// (a work on the centre: the parterre moves aside, smaller if it must)
const centreWork = sw.greenReserves([greens[0]], [{ x1: 9, z1: 9, x2: 11, z2: 11 }], [], 'A')[0];
ok(centreWork.pattern && !clash(centreWork.pattern, { x1: 9, z1: 9, x2: 11, z2: 11 }), `a work on the centre: the parterre beside it (${JSON.stringify(centreWork.pattern)})`);
const full = sw.greenReserves([greens[0]], [{ x1: 1, z1: 1, x2: 19, z2: 19 }], [], 'A')[0];
ok(!full.pattern && !full.trees.length, 'a full green: no reserve');
const done = sw.greenReserves([greens[0]], [], [{ kind: 'parterre', x: 10, z: 10 }, { kind: 'sapling', x: 2, z: 2 }, { kind: 'sapling', x: 18, z: 18 }], 'A')[0];
ok(!done.pattern && !done.trees.length, 'a parterre and two trees standing: nothing reserved');

// 3. Caps and order
const counts = sw.greenCounts(greens, [{ kind: 'plains_lamp_1', x: 1, z: 1 }, { kind: 'lamp_posts', x: 2, z: 2 }, { kind: 'well', x: 3, z: 3 }]);
ok(sw.cappedGreens('plains_lamp_1', greens, counts).has('i1') && sw.cappedGreens('snowy_lamp_post_01', greens, counts).has('i1'), 'lamps capped together');
ok(!sw.cappedGreens('well', greens, counts).has('i1') && !sw.cappedGreens('plains_lamp_1', greens, counts).has('i2'), 'a kind under its cap, a green of its own');
const order = sw.greensMixOrder(sw.SMALL_WORKS, true).map((k) => k.kind);
ok(order[0] === 'sapling' && order[1] === 'parterre' || order[0] === 'parterre' && order[1] === 'sapling', `the parterre and trees first (${order.slice(0, 4).join(', ')})`);
const lampAt = order.indexOf('lamp_posts'), wellAt = order.indexOf('well'), gazeboAt = order.indexOf('gazebo');
ok(wellAt < lampAt && gazeboAt < lampAt, 'larger works before the lamps');
ok(sw.greensMixOrder(sw.SMALL_WORKS, false).indexOf(sw.SMALL_WORKS.find((k) => k.kind === 'sapling')!) > wellAt, 'no tree wanted: the sapling with the small works');

// 4. gardenSpots with the reserves
const gs = sw.gardenSpots({
  doors: [], greens: greens.map((g) => ({ x: Math.floor((g.x1 + g.x2) / 2), z: Math.floor((g.z1 + g.z2) / 2), y: g.y, x1: g.x1, z1: g.z1, x2: g.x2, z2: g.z2 })),
  hard: [], soil: () => true, reserves: r0,
});
ok(gs.filter((s) => s.kind === 'parterre').length === 4 && gs.every((s) => s.kind !== 'flower_ring'), 'a parterre spot a green, no ring');
ok(gs.filter((s) => s.kind === 'parterre').every((s, i) => s.shape === r0[i].pattern!.shape), 'each with its green\'s shape');
const p0 = gs.find((s) => s.kind === 'parterre')!;
const pdes = kind.make('oak', undefined, p0.shape);
ok(p0.x === p1.x1 + Math.floor(pdes.width / 2) && p0.z === p1.z1 + Math.floor(pdes.depth / 2), "build_design's centre of the reserved square");
ok(gs.filter((s) => s.kind === 'sapling').length === 8, `saplings only on the reserved corners (${gs.filter((s) => s.kind === 'sapling').length})`);

// 5. A fill: the members' menus on three 21x21 greens, as the world makes them
interface Placed { kind: string; d: Design; x1: number; z1: number }
function fill(mix: boolean, rounds = 200): { placed: Placed[]; greens: typeof greens } {
  const gr = greens.slice(0, 3);
  const placed: Placed[] = [];
  const kinds = sw.menuWorks('plains').filter((k) => !['front_bed', 'flower_ring'].includes(k.kind) && (mix || k.kind !== 'parterre'));
  for (let n = 0; n < rounds; n++) {
    const member = `W${n % 25}|${placed.length}`;
    const works: import('../../server/src/smallWorks').WorkAt[] = placed.map((p) => ({ kind: p.kind, x: p.x1 + Math.floor(p.d.width / 2), z: p.z1 + Math.floor(p.d.depth / 2) }));
    // (blocked as the world keeps a structure: its box and 1 round it)
    const own = placed.map((p) => ({ x1: p.x1, z1: p.z1, x2: p.x1 + p.d.width - 1, z2: p.z1 + p.d.depth - 1 }));
    const blocked = own.map((a) => ({ x1: a.x1 - 1, z1: a.z1 - 1, x2: a.x2 + 1, z2: a.z2 + 1 }));
    const reserves = mix ? sw.greenReserves(gr, own, works, 'A') : [];
    const counts = sw.greenCounts(gr, works);
    const wantsTrees = reserves.some((r) => r.trees.length);
    let order = shuffled(kinds, member);
    if (mix) order = sw.greensMixOrder(order, wantsTrees);
    let r = 0, chosen: Placed | null = null;
    for (const k of order) {
      if (r >= 2) break;
      let spot: { x1: number; z1: number } | null = null;
      const d = k.make('oak', undefined, undefined);
      if (k.kind === 'parterre' || k.kind === 'sapling') {
        if (!mix && k.kind === 'sapling') continue;
        const g = sw.gardenSpots({ doors: [], greens: gr.map((g) => ({ x: 0, z: 0, y: 64, ...g })), hard: own, soil: () => true, reserves }).filter((s) => s.kind === k.kind);
        if (!g.length) continue;
        const s = g[0];
        const dd = k.make('oak', undefined, s.shape);
        spot = { x1: s.x - Math.floor(dd.width / 2), z1: s.z - Math.floor(dd.depth / 2) };
        if (!chosen) chosen = { kind: k.kind, d: dd, ...spot };
        r++;
        continue;
      }
      const capped = mix ? sw.cappedGreens(k.kind, gr, counts) : new Set<string>();
      const plots = gr.filter((g) => !capped.has(g.id));
      const spots = sw.smallWorkSpots({ plots, blocked: [...blocked, ...sw.reserveAreas(reserves)] }, d.width, d.depth, 8);
      if (!spots.length) continue;
      const s = spots[n % spots.length];
      if (!chosen) chosen = { kind: k.kind, d, x1: s.x - Math.floor(d.width / 2), z1: s.z - Math.floor(d.depth / 2) };
      r++;
    }
    if (chosen) placed.push(chosen);
  }
  return { placed, greens: gr };
}
const tally = (ps: Placed[]) => {
  const c = new Map<string, number>();
  for (const p of ps) c.set(p.kind, (c.get(p.kind) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
};
const off = fill(false), on = fill(true);
const top = (ps: Placed[]) => (tally(ps)[0]?.[1] ?? 0) / Math.max(1, ps.length);
console.log(`  off: ${off.placed.length} works, ${tally(off.placed).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`  on:  ${on.placed.length} works, ${tally(on.placed).map(([k, n]) => `${k} ${n}`).join(', ')}`);
const perGreen = (f: typeof on) => f.greens.map((g) => new Set(f.placed.filter((p) => p.x1 >= g.x1 && p.x1 <= g.x2).map((p) => p.kind)).size);
console.log(`  kinds per green: off ${perGreen(off).join('/')}, on ${perGreen(on).join('/')}`);
ok(top(on.placed) <= 0.25, `on: no kind over 25% of the works (${Math.round(100 * top(on.placed))}%)`);
ok(on.greens.every((g) => on.placed.some((p) => p.kind === 'parterre' && p.x1 >= g.x1 && p.x1 <= g.x2)), 'on: a parterre on every green');
ok(on.greens.every((g) => on.placed.filter((p) => p.kind === 'sapling' && p.x1 >= g.x1 - 2 && p.x1 <= g.x2).length >= 2), 'on: two trees on every green');
ok(Math.min(...perGreen(on)) >= 6, `on: six kinds or more a green (${perGreen(on).join('/')})`);
// (no two works' boxes overlap)
const boxes = on.placed.map((p) => ({ x1: p.x1, z1: p.z1, x2: p.x1 + p.d.width - 1, z2: p.z1 + p.d.depth - 1 }));
ok(boxes.every((a, i) => boxes.every((b, j) => i === j || !clash(a, b))), 'on: no works overlap');

// The first green as one design for scripts/render_design.py (grass, the works' top layers on it)
{
  const g = on.greens[0], W = g.x2 - g.x1 + 1, D = g.z2 - g.z1 + 1;
  const pal: Record<string, string> = { G: 'grass_block' };
  const code = new Map<string, string>();
  const sym = (b: string) => {
    if (!code.has(b)) {
      const c = String.fromCharCode(0x41 + code.size + (code.size >= 6 ? 1 : 0));
      code.set(b, c === 'G' ? 'Z' : c);
      pal[code.get(b)!] = b;
    }
    return code.get(b)!;
  };
  const H = Math.max(...on.placed.filter((p) => p.x1 >= g.x1 && p.x1 <= g.x2).map((p) => p.d.height));
  const layers = Array.from({ length: H }, (_, y) => Array.from({ length: D }, () => Array.from({ length: W }, () => (y === 0 ? 'G' : '.'))));
  for (const p of on.placed) {
    if (p.x1 < g.x1 || p.x1 > g.x2) continue;
    p.d.layers.forEach((L, y) => L.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch === '_' || ch === '.' || y === 0 && !p.d.palette[ch]) return;
      const z = p.z1 - g.z1 + j, x = p.x1 - g.x1 + i;
      if (z >= 0 && z < D && x >= 0 && x < W) layers[y][z][x] = sym(p.d.palette[ch]);
    })));
  }
  mkdirSync('runs/renders', { recursive: true });
  // (and the six shapes at 7, side by side, each in a mix of three)
  {
    const mixes = [['poppy', 'dandelion', 'cornflower'], ['allium', 'oxeye_daisy', 'pink_tulip'], ['blue_orchid', 'wildflowers', 'red_tulip'], ['cornflower', 'white_tulip', 'poppy'], ['orange_tulip', 'azure_bluet', 'allium'], ['lily_of_the_valley', 'poppy', 'dandelion']];
    const sheetPal: Record<string, string> = { G: 'grass_block' }, sheetCode = new Map<string, string>();
    const ds = sw.PARTERRE_SHAPES.map((s, i) => kind.make('oak', mixes[i], `${s}7`));
    const SW = ds.length * 8 + 1, rows = Array.from({ length: 9 }, () => Array.from({ length: SW }, () => '.'));
    ds.forEach((d, n) => d.layers[1].forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch === '_') return;
      const b = d.palette[ch];
      if (!sheetCode.has(b)) sheetCode.set(b, 'ABCDEFHIJKLMNOPQRSTUVWXYZ'[sheetCode.size]), (sheetPal[sheetCode.get(b)!] = b);
      rows[j + 1][n * 8 + 1 + i] = sheetCode.get(b)!;
    })));
    writeFileSync('runs/renders/greens_mix_shapes.json', JSON.stringify({ name: 'parterres_7', palette: sheetPal, layers: [Array.from({ length: 9 }, () => 'G'.repeat(SW)), rows.map((r) => r.join(''))], width: SW, depth: 9, height: 2 }));
  }
  writeFileSync('runs/renders/greens_mix_green.json',JSON.stringify({ name: 'green_mix_21', palette: pal, layers: layers.map((l) => l.map((r) => r.join(''))), width: W, depth: D, height: H }));
}

console.log(`${failures ? 'FAIL' : 'OK'} greens_mix: ${checks - failures} of ${checks} checks ok`);
process.exit(failures ? 1 : 0);
