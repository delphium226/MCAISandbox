/**
 * #138's offline check (MC_GROW_OUTWARD and MC_PAD_PER_BUILDING set here; no server). On every scripts/test_sites.json
 * site with a site, a street plan of four houses at size 40 (plains) is laid out on pads with pads_plan.mts's fake world,
 * on two made-up slopes (1 in 5 and 1 in 2): each pad at its ground's level, the first layout's paths planned
 * (padPaths.ts). Then outward.ts places four more houses as lay_out_houses would (the same taken rules: pads, paths,
 * fields and lamps or signs by 1), and each is posted as a layout of its own (postLayout's `outward`).
 *
 * Checks:
 * - every house placed, its pad and the ring round it off everything taken and off the other new pads;
 * - its door step on its pad's ring, the door turned toward the meeting point;
 * - its level within home -3..+6 and within its gap + 1 of every pad;
 * - one task each for its pad and its path (the path after the pad), and the Build after its own pad only;
 * - the layout record's pad at the placed level and door, with no neighbourhood name on its sign;
 * - its path planned from its door to the first layout's tree (planPadPaths with `tree` and `only`): joined, no
 *   centreline step over 1, no cell on the tree or on a footprint.
 * Reports the spread (each new house's distance from the meeting point: median and most).
 * Run: node_modules/.bin/tsx scripts/checks/grow_outward.mts
 */
process.env.MC_PAD_PER_BUILDING = 'on';
process.env.MC_GROW_OUTWARD = 'on';
const { readFileSync, mkdtempSync } = await import('fs');
const { join } = await import('path');
const { tmpdir } = await import('os');
const { VillageRegistry } = await import('../../server/src/village');
type Area = import('../../server/src/village').Area;
type Design = import('../../server/src/village').Design;
type Village = import('../../server/src/village').Village;
const { postLayout } = await import('../../server/src/layout');
const { planPadPaths } = await import('../../server/src/padPaths');
const { GROW_OUTWARD, placeOutward } = await import('../../server/src/outward');
const { doorOf } = await import('../../server/src/streetPlan');
const { vanillaLibrary, villageBiome } = await import('../../server/src/vanillaPieces');
const { vanillaJar } = await import('../../server/src/vanillaData');

const sites = (JSON.parse(readFileSync('scripts/test_sites.json', 'utf-8')).sites as Array<{ name: string; site: { x: number; y: number; z: number; size: number } | null }>).filter((s) => s.site);
const reg = new VillageRegistry(join(mkdtempSync(join(tmpdir(), 'outward-')), 'villages.json'));
const jar = vanillaJar();
const world = (village: Village): unknown => ({
  villages: reg,
  skills: [{ name: 'light_streets' }, { name: 'put_up_signs' }, { name: 'tend_farm' }],
  taskSkills: ['make_into_storage', 'place_station'],
  preparesParts: true,
  vanillaLibrary: (b: string) => vanillaLibrary(villageBiome(b), () => true, jar),
  materialTasks: (_d: unknown, label: string) => ({ tasks: [
    { title: `Gather 12 birch_log for ${label}`, detail: 'collect block=birch_log count=12, then deposit item=all into the village storage' },
  ], problems: [], logs: 12 }),
  sharedParts: (ds: Array<{ name: string }>) => ({ panes: 14, glass: 0, sand: 6, logs: 1, separate: 0, with: ds.map((d) => d.name), copies: ds.length,
    tasks: [{ title: 'Gather 6 sand for the windows', detail: 'collect block=sand count=6, then deposit item=all into the village storage' }] }),
  village,
});

let bad = 0, cases = 0, placedN = 0, joined = 0;
const dists: number[] = [];
const ins = (q: Area, x: number, z: number, n = 0) => x >= q.x1 - n && x <= q.x2 + n && z >= q.z1 - n && z <= q.z2 + n;
const gap = (p: Area, q: Area) => Math.max(0, Math.max(q.x1 - p.x2, p.x1 - q.x2, q.z1 - p.z2, p.z1 - q.z2) - 1);

function check(name: string, site: { x: number; y: number; z: number; size: number }, designs: Design[], run: number) {
  cases++;
  const v = reg.ensure(`Out-${cases}`);
  for (const d of designs) v.designs[d.name] = d;
  v.plan = 'street';
  const at = `${name} 1/${run}`;
  const fail = (what: string) => {
    bad++;
    console.log(`FAIL ${at}: ${what}`);
  };
  const out = postLayout(world(v) as never, v, 'Mayor', { ...site, size: 40, wood: 'birch', woodLogs: 2000, biome: 'plains' }, designs.map((d) => d.name), true, 11);
  const lay = v.layouts?.[0];
  if (out.startsWith('plan_layout:') || !lay?.pads) {
    console.log(`skip ${at}: ${out.slice(0, 120)}`);
    return;
  }
  // The ground: a slope; each pad at its middle's ground, kept within 1 a block of the pads levelled before it
  const ground = (x: number, z: number) => site.y + Math.floor((x - lay.x1) / run) + Math.floor((z - lay.z1) / (run * 2));
  const levelled: Array<Area & { y: number }> = [];
  for (const q of lay.pads) {
    let y = ground(Math.floor((q.x1 + q.x2) / 2), Math.floor((q.z1 + q.z2) / 2));
    for (const p of levelled) y = Math.max(p.y - gap(p, q) - 1, Math.min(p.y + gap(p, q) + 1, y));
    q.y = y;
    levelled.push({ ...q, y });
  }
  const storage = lay.pads[0];
  const home = storage.y!;
  lay.y = home;
  const hubK = Math.max(0, lay.pads.findIndex((q) => /meeting/.test(q.what)));
  const area0 = { x1: lay.x1 - 3, z1: lay.z1 - 3, x2: lay.x2 + 3, z2: lay.z2 + 3 };
  const plan = planPadPaths({ area: area0, pads: lay.pads.map((q) => ({ ...q, y: q.y! })), hub: hubK, ground });
  for (const q of lay.paths ?? []) {
    const p = plan.find((r) => r.pad === q.pad);
    if (p && !p.fail) Object.assign(q, { cells: p.cells, line: p.line });
  }
  v.complete = true;
  // Outward: four more houses, as lay_out_houses places them
  const hubPad = lay.pads[hubK];
  const hub = { x: Math.round((hubPad.x1 + hubPad.x2) / 2), z: Math.round((hubPad.z1 + hubPad.z2) / 2) };
  const pads = lay.pads;
  const area = { x1: Math.min(...pads.map((q) => q.x1)) - 20, z1: Math.min(...pads.map((q) => q.z1)) - 20, x2: Math.max(...pads.map((q) => q.x2)) + 20, z2: Math.max(...pads.map((q) => q.z2)) + 20 };
  const pathCells = new Set((lay.paths ?? []).flatMap((q) => (q.cells ?? []).map(([x, z]) => `${x},${z}`)));
  const fields = [...(lay.farm ? [lay.farm] : []), ...(lay.slots ?? [])];
  const marks = [...(lay.lamps ?? []), ...(lay.signs ?? [])];
  const taken = (x: number, z: number) => pads.some((q) => ins(q, x, z)) || pathCells.has(`${x},${z}`) || fields.some((q) => ins(q, x, z, 1))
    || marks.some((c) => Math.abs(c.x - x) <= 1 && Math.abs(c.z - z) <= 1);
  const houses = designs.slice(0, 4);
  const items = houses.map((d) => ({ name: d.name, width: d.width, depth: d.depth, ...doorOf(d) }));
  const t0 = Date.now();
  const placed = placeOutward({ area, ground, taken, hub, home, pads: levelled, items });
  const ms = Date.now() - t0;
  const news: Area[] = [];
  for (const p of placed) {
    if ('why' in p) {
      fail(p.why);
      continue;
    }
    placedN++;
    const pad = { x1: p.x1 - 1, z1: p.z1 - 1, x2: p.x2 + 1, z2: p.z2 + 1 };
    for (let x = pad.x1 - 1; x <= pad.x2 + 1; x++)
      for (let z = pad.z1 - 1; z <= pad.z2 + 1; z++) if (taken(x, z)) fail(`${p.name}'s pad or ring on taken ground at ${x},${z}`);
    for (const q of news) if (gap(pad, q) < 1 && !(pad.x1 > q.x2 || q.x1 > pad.x2 || pad.z1 > q.z2 || q.z1 > pad.z2) ? true : gap(pad, q) < 1 && false) fail(`${p.name} overlaps another new pad`);
    for (const q of news) if (!(pad.x2 + 1 < q.x1 || q.x2 + 1 < pad.x1 || pad.z2 + 1 < q.z1 || q.z2 + 1 < pad.z1)) fail(`${p.name}'s pad within a block of another new pad`);
    // its door step on the ring, turned toward the meeting point
    const onRing = ins(pad, p.door.x, p.door.z) && !ins({ x1: p.x1, z1: p.z1, x2: p.x2, z2: p.z2 }, p.door.x, p.door.z);
    if (!onRing) fail(`${p.name}'s door step ${p.door.x},${p.door.z} is not on its ring`);
    const cx = (p.x1 + p.x2) / 2, cz = (p.z1 + p.z2) / 2;
    if ((p.door.x - cx) * (hub.x - cx) + (p.door.z - cz) * (hub.z - cz) <= 0) fail(`${p.name}'s door faces away from the meeting point`);
    // its level
    if (p.y < home - 3 || p.y > home + 6) fail(`${p.name} at y=${p.y}, outside home ${home} -3..+6`);
    for (const q of [...levelled]) if (Math.abs(p.y - q.y) > gap(pad, q) + 1) fail(`${p.name} at y=${p.y} beside a pad at y=${q.y} ${gap(pad, q)} apart`);
    news.push(pad);
    levelled.push({ ...pad, y: p.y });
    dists.push(Math.round(Math.hypot(cx - hub.x, cz - hub.z)));
    // Posted as a layout of its own
    const before = new Set(v.tasks.map((t) => t.id));
    const res = postLayout(world(v) as never, v, 'grow', { x: p.x, y: p.y, z: p.z, size: 12 }, [p.name], true, undefined, { poster: 'grow', neighbourhood: true, outward: p });
    if (!res.startsWith('Laid out')) {
      fail(`postLayout refused ${p.name}: ${res.slice(0, 160)}`);
      continue;
    }
    const n = v.layouts!.length, L = v.layouts![n - 1];
    const T = v.tasks.filter((t) => !before.has(t.id));
    const padT = T.filter((t) => t.detail.startsWith(`prepare_site layout=${n} pad=1 `));
    const pathT = T.filter((t) => t.detail.startsWith(`prepare_site layout=${n} path=1 `));
    const build = T.find((t) => /^Build /.test(t.title));
    if (padT.length !== 1 || pathT.length !== 1 || !build) fail(`${p.name}: ${padT.length} pad, ${pathT.length} path tasks, build ${!!build}`);
    else {
      if (!pathT[0].after.includes(padT[0].id)) fail(`${p.name}'s path does not wait for its pad`);
      if (!build.after.includes(padT[0].id) || build.after.some((id) => id !== padT[0].id && /pad=/.test(v.tasks.find((t) => t.id === id)?.detail ?? ''))) fail(`${p.name}'s build waits for ${build.after.join(',')}`);
    }
    if (!L.pads || L.pads.length !== 1 || L.pads[0].y !== p.y || L.pads[0].door?.x !== p.door.x || L.pads[0].door?.z !== p.door.z) fail(`${p.name}'s layout pad is not as placed`);
    if (L.name) fail(`${p.name}'s layout has a neighbourhood name (${L.name})`);
    // Its path to the first layout's tree
    const tree: Array<[number, number, number]> = [...(lay.paths ?? []).flatMap((q) => q.cells ?? []), ...lay.pads.filter((q) => q.door && q.y !== undefined).map((q): [number, number, number] => [q.door!.x, q.door!.z, q.y!])];
    const mid = { x: cx, z: cz };
    const near = tree.reduce((b, c) => (Math.hypot(c[0] - mid.x, c[1] - mid.z) < Math.hypot(b[0] - mid.x, b[1] - mid.z) ? c : b));
    const pa = { x1: Math.min(L.x1, near[0]) - 6, z1: Math.min(L.z1, near[1]) - 6, x2: Math.max(L.x2, near[0]) + 6, z2: Math.max(L.z2, near[1]) + 6 };
    const allPads = [...L.pads.map((q) => ({ ...q, y: q.y! })), ...lay.pads.map((q) => ({ ...q, y: q.y! }))];
    const pp = planPadPaths({ area: pa, pads: allPads, hub: -1, ground, tree, only: [0] });
    const path = pp.find((r) => r.pad === 0);
    if (!path || path.fail || !path.line.length) {
      fail(`${p.name}: no path to the village (${path?.fail ?? 'none planned'})`);
      continue;
    }
    joined++;
    const treeKeys = new Set(tree.map(([x, z]) => `${x},${z}`));
    const end = path.line[path.line.length - 1];
    if (!treeKeys.has(`${end[0]},${end[1]}`)) fail(`${p.name}'s path ends off the tree at ${end}`);
    const tgt = new Map(path.cells.map(([x, z, y]) => [`${x},${z}`, y]));
    for (const [x, z] of path.cells.map(([x, z]) => [x, z])) if (treeKeys.has(`${x},${z}`)) fail(`${p.name}'s path regrades a tree cell at ${x},${z}`);
    for (const [x, z] of path.cells.map(([x, z]) => [x, z])) for (const q of allPads) if (q.inner && ins(q.inner, x, z)) fail(`${p.name}'s path on ${q.what}'s footprint at ${x},${z}`);
    const lvl = (x: number, z: number) => tgt.get(`${x},${z}`) ?? tree.find((c) => c[0] === x && c[1] === z)?.[2];
    for (let i = 1; i < path.line.length; i++) {
      const a = lvl(...path.line[i - 1]), b = lvl(...path.line[i]);
      if (a !== undefined && b !== undefined && Math.abs(a - b) > 1) fail(`${p.name}'s path steps ${Math.abs(a - b)} at ${path.line[i]}`);
    }
  }
  console.log(`ok ${at}: ${placed.filter((p) => !('why' in p)).length} placed in ${ms} ms at ${dists.slice(-4).join('/')} from the meeting point, ${v.layouts!.length} layouts`);
}

if (!GROW_OUTWARD) {
  console.log('FAIL MC_GROW_OUTWARD=on not read');
  process.exit(1);
}
const lib = vanillaLibrary('plains', () => true, jar);
const chosen = lib.houses.filter((d) => /small_house/.test(d.name)).slice(0, 4);
for (const s of sites) for (const run of [5, 2]) check(s.name, s.site!, chosen, run);
const sorted = [...dists].sort((a, b) => a - b);
console.log(`\n${cases} villages, ${placedN} houses placed outward, ${joined} joined by a path; distance from the meeting point median ${sorted[sorted.length >> 1] ?? '-'}, most ${sorted[sorted.length - 1] ?? '-'}; ${bad ? `${bad} FAILED` : 'all checks passed'}`);
process.exit(bad ? 1 : 0);
