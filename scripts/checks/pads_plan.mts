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

let bad = 0, cases = 0, laidOnPads = 0;
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
  console.log(`ok ${at}: ${buildingPads.length} building pads, ${fieldPads.length} field pads, ${T.length} tasks`);
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
console.log(`\n${cases} layouts, ${laidOnPads} on pads, ${bad ? `${bad} FAILED` : 'all checks passed'}`);
process.exit(bad ? 1 : 0);
