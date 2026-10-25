/**
 * #84 C1's offline check of a village laid out on pads (MC_PAD_PER_BUILDING=on, set here; no server): postLayout with
 * huts_box.mts's fake world on every scripts/test_sites.json site with a site, in street and green plans (each village
 * biome's library, sizes 40 and 32), for 11 workers and for 2. Checks:
 * - one pad per building, plus the wheat field's and each farm slot's;
 * - each pad is its footprint (or field) and a 1-block ring, inside the plot's 2-block margin;
 * - no pad's ring reaches another building's footprint;
 * - one task per pad (prepare_site layout=1 pad=K), the storage hut's pad first and the mining hut's second;
 * - the storage set-up waits for the storage hut's pad only;
 * - each Build waits for its own pad and no other;
 * - the rest posted after the storage hut's build, and no parts;
 * - the farm, the lamps and the signs wait for every building's and the field's pad;
 * - at most 100 tasks.
 * C2's paths (#84): a path record and task (prepare_site layout=1 path=K) for each building's door but the hub's, each after
 * every pad, the lamps after every path; then padPaths.ts's plan on two made-up slopes (1 in 5 and 1 in 2, the pads at
 * their own ground's level, kept within 1 a block apart as the levels' rule does): every door joined, no step over 1
 * between neighbouring centreline cells, no path cell on a footprint or field, and the steps over 1 among all the path's
 * cells and onto the pads counted (reported; a few beside steep ground are expected); lamps off the paths and footprints.
 * Rows layouts keep today's parts.
 * Run: node_modules/.bin/tsx scripts/checks/pads_plan.mts
 */
process.env.MC_PAD_PER_BUILDING = 'on';
const { readFileSync, mkdtempSync } = await import('fs');
const { join } = await import('path');
const { tmpdir } = await import('os');
const { VillageRegistry, overlaps } = await import('../../server/src/village');
type Area = import('../../server/src/village').Area;
type Design = import('../../server/src/village').Design;
type Village = import('../../server/src/village').Village;
const { postLayout, PAD_PER_BUILDING } = await import('../../server/src/layout');
const { MINING_HUT, STORAGE_HUT } = await import('../../server/src/huts');
const { VILLAGE_BIOMES, vanillaLibrary, villageBiome } = await import('../../server/src/vanillaPieces');
const { vanillaJar } = await import('../../server/src/vanillaData');
const { planPadPaths, pathLamps } = await import('../../server/src/padPaths');

const sites = (JSON.parse(readFileSync('scripts/test_sites.json', 'utf-8')).sites as Array<{ name: string; site: { x: number; y: number; z: number; size: number } | null }>).filter((s) => s.site);
const reg = new VillageRegistry(join(mkdtempSync(join(tmpdir(), 'pads-')), 'villages.json'));
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

let bad = 0, cases = 0, laidOnPads = 0, planned = 0, pathCells = 0, bandSteps = 0, lampsN = 0;
const stepsBy: Record<number, [number]> = {}, cellsBy: Record<number, number> = {};
const grow = (a: Area, n: number): Area => ({ x1: a.x1 - n, z1: a.z1 - n, x2: a.x2 + n, z2: a.z2 + n });
const same = (a: Area, b: Area) => a.x1 === b.x1 && a.z1 === b.z1 && a.x2 === b.x2 && a.z2 === b.z2;
const within = (a: Area, b: Area) => a.x1 >= b.x1 && a.x2 <= b.x2 && a.z1 >= b.z1 && a.z2 <= b.z2;

function check(name: string, site: { x: number; y: number; z: number; size: number }, designs: Design[], workers: number, biome: string) {
  cases++;
  const v = reg.ensure(`Pads-${cases}`);
  for (const d of designs) v.designs[d.name] = d;
  v.plan = 'street';
  const out = postLayout(world(v) as never, v, 'Mayor', { ...site, wood: 'birch', woodLogs: 2000, biome }, designs.map((d) => d.name), true, workers);
  const at = `${name} ${site.size} ${biome} w${workers}`;
  const fail = (what: string) => {
    bad++;
    console.log(`FAIL ${at}: ${what}`);
  };
  if (out.startsWith('plan_layout:')) {
    console.log(`skip ${at}: ${out.slice(0, 160)}`);
    return;
  }
  const lay = v.layouts![0];
  if (!lay.streets) {
    console.log(`rows ${at}: no street plan, parts as today`);
    return;
  }
  const T = v.tasks, byId = new Map(T.map((t) => [t.id, t]));
  const titles = (ids: string[]) => ids.map((id) => byId.get(id)?.title).join(' | ');
  if (T.length > 100) fail(`${T.length} tasks (cap 100)`);
  if (lay.parts) fail('parts on a layout laid out on pads');
  const pads = lay.pads;
  if (!pads) {
    fail('no pads');
    return;
  }
  laidOnPads++;
  // The pads: a building each, the field and the slots
  const places = v.structures.length ? [] : lay.buildings;
  const buildingPads = pads.filter((q) => q.kind === 'building'), fieldPads = pads.filter((q) => q.kind === 'field');
  if (buildingPads.length !== places.length) fail(`${buildingPads.length} building pads for ${places.length} buildings`);
  if (fieldPads.length !== (lay.farm ? 1 : 0) + (lay.slots?.length ?? 0)) fail(`${fieldPads.length} field pads for ${lay.farm ? 1 : 0} farm and ${lay.slots?.length ?? 0} slots`);
  for (const f of [...(lay.farm ? [lay.farm] : []), ...(lay.slots ?? [])]) if (!fieldPads.some((q) => same(q, grow(f, 1)))) fail(`no pad for the field at ${f.x1},${f.z1}`);
  if (pads[0].what !== STORAGE_HUT || pads[1].what !== MINING_HUT) fail(`the first pads are ${pads[0].what}, ${pads[1].what}`);
  for (const [k, q] of pads.entries()) if (!within(q, grow(lay, 2))) fail(`pad ${k + 1} (${q.what}) outside the plot's margin`);
  // No ring on another building's footprint (the Build tasks' footprints)
  const feet = T.filter((t) => /^Build /.test(t.title)).map((t) => {
    const m = /footprint x (-?\d+)\.\.(-?\d+), z (-?\d+)\.\.(-?\d+)/.exec(t.detail)!;
    return { t, a: { x1: +m[1], x2: +m[2], z1: +m[3], z2: +m[4] } };
  });
  for (const [k, q] of pads.entries())
    for (const f of feet) if (!same(grow(f.a, 1), q) && overlaps(q, f.a)) fail(`pad ${k + 1} (${q.what}) reaches ${f.t.title}'s footprint`);
  // The tasks
  const prep = T.filter((t) => /^prepare_site layout=1 pad=\d+ /.test(t.detail));
  if (prep.length !== pads.length || T.some((t) => t.title.startsWith('Prepare the village plot'))) fail(`${prep.length} pad tasks for ${pads.length} pads`);
  const padId = (k: number) => prep.find((t) => t.detail.startsWith(`prepare_site layout=1 pad=${k + 1} `))?.id;
  const storage = T.find((t) => t.title === 'Set up the village storage')!;
  if (!(storage.after.length === 1 && storage.after[0] === padId(0))) fail(`the storage waits for ${titles(storage.after)}`);
  const allPadIds = new Set(prep.map((t) => t.id));
  for (const f of feet) {
    const own = pads.findIndex((q) => same(q, grow(f.a, 1)));
    const waits = f.t.after.filter((id) => allPadIds.has(id));
    if (own < 0 || waits.length !== 1 || waits[0] !== padId(own)) fail(`${f.t.title} waits for pads ${titles(waits)}`);
  }
  const hutBuild = T.find((t) => t.title === `Build ${STORAGE_HUT}`)!;
  if (pads.length > 2 && T.indexOf(byId.get(padId(2)!)!) < T.indexOf(hutBuild)) fail("a pad besides the huts' is posted before the storage hut's build");
  const mainIds = pads.map((q, k) => (q.kind === 'building' || (lay.farm && same(q, grow(lay.farm, 1))) ? padId(k)! : '')).filter(Boolean);
  for (const t of T)
    if (/^(Plant the farm|Light the streets|Put up the sign)/.test(t.title) && !mainIds.every((id) => t.after.includes(id))) fail(`${t.title} does not wait for every pad`);
  // C2: the paths' records and tasks
  const hub = Math.max(0, pads.findIndex((q) => /meeting/.test(q.what)));
  const doors = pads.map((q, k) => ({ q, k })).filter(({ q, k }) => q.kind === 'building' && q.door && k !== hub);
  if (buildingPads.some((q, k) => !q.door && !(k === hub && /meeting/.test(q.what)))) fail(`${buildingPads.filter((q) => !q.door).map((q) => q.what).join(', ')} without a door step`);
  if ((lay.paths?.length ?? 0) !== doors.length) fail(`${lay.paths?.length ?? 0} paths for ${doors.length} doors`);
  const pathT = T.filter((t) => /^prepare_site layout=1 path=\d+ /.test(t.detail));
  if (pathT.length !== doors.length) fail(`${pathT.length} path tasks for ${doors.length} doors`);
  // (every building's pad and the wheat field's; the slots' pads are posted later, and paths keep off fields)
  for (const t of pathT) if (!mainIds.every((id) => t.after.includes(id))) fail(`${t.title} does not wait for every pad`);
  const lampsT = T.find((t) => /^Light the streets/.test(t.title));
  if (lampsT && !pathT.every((t) => lampsT.after.includes(t.id))) fail('the lamps do not wait for every path');
  for (const [k, q] of pads.entries()) if (q.door && !(q.door.x >= q.x1 && q.door.x <= q.x2 && q.door.z >= q.z1 && q.door.z <= q.z2 && !(q.inner && q.door.x >= q.inner.x1 && q.door.x <= q.inner.x2 && q.door.z >= q.inner.z1 && q.door.z <= q.inner.z2)))
    fail(`pad ${k + 1} (${q.what})'s door step ${q.door.x},${q.door.z} is not on its ring`);
  // C2: the plan on two slopes
  for (const run of [5, 2]) {
    const ground = (x: number, z: number) => site.y + Math.floor((x - lay.x1) / run) + Math.floor((z - lay.z1) / (run * 2));
    const mid = (q: Area) => ground(Math.floor((q.x1 + q.x2) / 2), Math.floor((q.z1 + q.z2) / 2));
    // (the levels as prepare_site sets them: home the storage hut's, each other pad its own within -3..+6 of home and its
    // gap + 1 of every pad before it, nearest the storage hut first)
    const levelled = pads.map((q) => ({ ...q, y: mid(q) }));
    const gap = (p: Area, q: Area) => Math.max(0, Math.max(q.x1 - p.x2, p.x1 - q.x2, q.z1 - p.z2, p.z1 - q.z2) - 1);
    const cen = (q: Area) => [(q.x1 + q.x2) / 2, (q.z1 + q.z2) / 2];
    const home = levelled[0].y, done = [0];
    for (const k of levelled.map((_, k) => k).slice(1).sort((i, j) => Math.hypot(cen(pads[i])[0] - cen(pads[0])[0], cen(pads[i])[1] - cen(pads[0])[1]) - Math.hypot(cen(pads[j])[0] - cen(pads[0])[0], cen(pads[j])[1] - cen(pads[0])[1]))) {
      let lo = home - 3, hi = home + 6;
      for (const j of done) {
        lo = Math.max(lo, levelled[j].y - gap(pads[k], pads[j]) - 1);
        hi = Math.min(hi, levelled[j].y + gap(pads[k], pads[j]) + 1);
      }
      levelled[k].y = lo <= hi ? Math.max(lo, Math.min(hi, levelled[k].y)) : Math.round((lo + hi) / 2);
      done.push(k);
    }
    const area = grow(lay, 3);
    const plan = planPadPaths({ area, pads: levelled, hub, ground });
    planned++;
    const fails = plan.filter((p) => p.fail);
    if (fails.length) fail(`slope 1/${run}: ${fails.map((p) => p.fail).join('; ')}`);
    const t = new Map<string, number>();
    for (const p of plan) for (const [x, z, y] of p.cells) {
      if (!Number.isInteger(y)) fail(`slope 1/${run}: cell ${x},${z} of the path to ${p.what} has no level (${y})`);
      if (t.has(`${x},${z}`)) fail(`slope 1/${run}: cell ${x},${z} in two paths`);
      t.set(`${x},${z}`, y);
    }
    pathCells += t.size;
    cellsBy[run] = (cellsBy[run] ?? 0) + t.size;
    const lineCells = new Set(plan.flatMap((p) => p.line.map(([x, z]) => `${x},${z}`)));
    for (const c of lineCells) {
      const [x, z] = c.split(',').map(Number);
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const n = `${x + dx},${z + dz}`;
        if (lineCells.has(n) && Math.abs(t.get(n)! - t.get(c)!) > 1) fail(`slope 1/${run}: a centreline step of ${Math.abs(t.get(n)! - t.get(c)!)} at ${c}`);
      }
    }
    // (every cell's level: the path's target, a building pad's level, else the ground)
    const level = (x: number, z: number) => t.get(`${x},${z}`) ?? levelled.find((q) => q.kind === 'building' && x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2)?.y ?? ground(x, z);
    for (const [c, y] of t) {
      const [x, z] = c.split(',').map(Number);
      for (const q of levelled) if ((q.kind === 'field' && x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2) || (q.inner && x >= q.inner.x1 && x <= q.inner.x2 && z >= q.inner.z1 && z <= q.inner.z2)) fail(`slope 1/${run}: path cell ${c} on ${q.what}`);
      for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const X = x + dx, Z = z + dz;
        const onPad = levelled.some((q) => q.kind === 'building' && X >= q.x1 && X <= q.x2 && Z >= q.z1 && Z <= q.z2);
        if ((t.has(`${X},${Z}`) || onPad) && Math.abs(level(X, Z) - y) > 1) {
          bandSteps++;
          (stepsBy[run] ??= [0])[0]++;
        }
      }
    }
    const lamps = pathLamps(plan.filter((p) => !p.fail), ground, (x, z) => levelled.some((q) => x >= q.x1 - 1 && x <= q.x2 + 1 && z >= q.z1 - 1 && z <= q.z2 + 1));
    lampsN += lamps.length;
    for (const l of lamps) if (t.has(`${l.x},${l.z}`)) fail(`slope 1/${run}: a lamp on the path at ${l.x},${l.z}`);
    if (doors.length && !lamps.length) fail(`slope 1/${run}: no lamps along ${doors.length} paths`);
  }
  console.log(`ok ${at}: ${buildingPads.length} building pads, ${fieldPads.length} field pads, ${pathT.length} paths, ${T.length} tasks`);
}

if (!PAD_PER_BUILDING) {
  console.log('FAIL MC_PAD_PER_BUILDING=on not read');
  process.exit(1);
}
for (const s of sites)
  for (const biome of VILLAGE_BIOMES) {
    const lib = vanillaLibrary(biome, () => true, jar);
    const chosen: Design[] = [];
    for (const kind of ['small', 'small', 'landmark', 'other']) {
      const h = lib.houses.find((d) => !chosen.includes(d) && (kind === 'small' ? /small_house/.test(d.name) : kind === 'landmark' ? /_(library|temple)_/.test(d.name) : !/small_house|_(library|temple)_/.test(d.name)));
      if (h) chosen.push(h);
    }
    for (const workers of [11, 2]) for (const size of [40, 32]) check(s.name, { ...s.site!, size }, chosen, workers, biome);
  }
console.log(`\n${cases} layouts, ${laidOnPads} on pads; paths planned ${planned} times, ${pathCells} path cells, ${bandSteps} steps over 1 among path cells and onto pads, ${lampsN} lamps; ${bad ? `${bad} FAILED` : 'all checks passed'}`);
console.log(`steps over 1 by slope: ${Object.keys(cellsBy).map((r) => `1/${r}: ${stepsBy[+r]?.[0] ?? 0} of ${cellsBy[+r]} cells`).join(', ')}`);
process.exit(bad ? 1 : 0);
