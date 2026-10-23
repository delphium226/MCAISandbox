/**
 * #104's R1 checked offline (MC_VANILLA_ALL; no server): with the flag on (the default here; MC_VANILLA_ALL=off gives
 * today's numbers to compare), per biome
 *  - the library's dwellings (vanillaLibrary with the survival checks of street_plan.mts and the budget houseBudget
 *    gives: HOUSE_UNITS_LARGE for a vanilla dwelling with the flag), small and larger homes, and the larger homes' pads
 *    (padFor alone and with three small houses, at most 31: the pad ladder's largest);
 *  - pickHouses on a street village: every small and larger home taken in turn, never two larger homes in one batch;
 *  - the importer's door cases (plains weaponsmith_1, snowy fisher cottage, weapon smith and shepherd's house, taiga
 *    medium_house_1, desert cartographer): each imports with an entrance whose door opens south (doorOf's way out south)
 *    and passes validateDesign with a door;
 *  - snowy pieces with diorite for snow and ice: which pass, and which would if diorite were easy to gather (it is not in
 *    mcMaterials' EASY_GATHER);
 *  - small-work kinds (SMALL_WORKS, VANILLA_WORKS) and yard works (YARD_WORKS), each in oak, birch and spruce: valid
 *    without a door, named small_<kind>_<wood>, its bill planned to logs, cobblestone and sand only (what an initiative's
 *    crew gathers), no other wood's logs, yards within YARD_MAX.
 * With the flag off it checks today's numbers hold: 4 small houses a library, 8 small-work kinds, no vanilla kinds or yards.
 * Prints PASS or FAIL (exit 1).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/vanilla_all.mts   Env: MC_VANILLA_ALL (on), JAR.
 */
process.env.MC_VANILLA_ALL ??= 'on';
const ON = /^(on|1|true)$/i.test(process.env.MC_VANILLA_ALL);
const minecraftData = (await import('minecraft-data')).default;
const { HOUSE_UNITS, HOUSE_UNITS_LARGE, LANDMARK_UNITS, MAX_SMELTS, VANILLA_ALL, houseBudget, isLandmark, validateDesign } = await import('../../server/src/designs');
const { Materials, designBill, hardToGather, inWood, woodPart } = await import('../../server/src/mineflayer/mcMaterials');
const { DEFAULT_JAR, VILLAGE_BIOMES, pieceToDesign, readPiece, vanillaLibrary } = await import('../../server/src/vanillaPieces');
const { isDwelling, padFor, pickHouses } = await import('../../server/src/grow');
const { doorOf } = await import('../../server/src/streetPlan');
const { SMALL_WORKS, VANILLA_WORKS, YARD_WORKS, YARD_MAX, crewCanBuild, isSmallWork } = await import('../../server/src/smallWorks');
type Design = import('../../server/src/village').Design;
type Village = import('../../server/src/village').Village;

const reg = minecraftData('26.1');
const materials = new Materials(reg);
const JAR = process.env.JAR ?? DEFAULT_JAR;
const fails: string[] = [];
const check = (ok: unknown, what: string) => { if (!ok) fails.push(what); };
if (VANILLA_ALL !== ON) fails.push(`designs.ts VANILLA_ALL is ${VANILLA_ALL}, MC_VANILLA_ALL=${process.env.MC_VANILLA_ALL}`);

const isPlaceable = (block: string) => {
  const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(block.trim());
  if (!m) return false;
  const b = reg.blocksByName[m[1]];
  if (!b || !reg.itemsByName[m[1]]) return false;
  if (m[2] === undefined) return true;
  const states = (b.states ?? []) as Array<{ name: string; type: string; values?: string[] }>;
  return m[2].split(',').every((p) => {
    const [k, v] = p.split('=').map((t) => t.trim());
    const st = states.find((x) => x.name === k);
    return !!st && v !== undefined && (st.type === 'enum' ? !!st.values?.includes(v) : st.type === 'bool' ? v === 'true' || v === 'false' : /^\d+$/.test(v));
  });
};

/** A design's survival plan as street_plan.mts plans it (the main wood, a crafting table, a furnace when smelting);
 *  `gathered`: blocks counted as gathered as they are (diorite, were it easy to gather). */
function costOf(d: Design, gathered: RegExp | null = null) {
  const raw = designBill(d);
  let extra = 0;
  if (gathered) for (const n of Object.keys(raw)) if (gathered.test(n)) { extra += raw[n]; delete raw[n]; }
  const kinds: Record<string, number> = {};
  for (const [n, q] of Object.entries(raw)) { const w = woodPart(n); if (w) kinds[w.kind] = (kinds[w.kind] ?? 0) + q; }
  const bill = inWood(raw, Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0]);
  let plan = materials.plan(bill);
  plan = materials.plan({ ...bill, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
  const units = Object.values(plan.gather).reduce((t, q) => t + q, 0) + 1 + extra;
  return { units, hard: hardToGather(plan.gather), problems: plan.problems, smelts: plan.fuel.smelts };
}
const unitsMemo = new Map<string, number>();
const unitsOf = (d: Design) => unitsMemo.get(d.name) ?? (unitsMemo.set(d.name, costOf(d).units), unitsMemo.get(d.name)!);
/** street_plan.mts's survival checks with houseBudget (the world's accept as R1 wants it). */
function accept(d: Design, centre: boolean, easy: RegExp | null = null): boolean {
  if (!validateDesign({ ...d } as unknown as Record<string, unknown>, 'vanilla', { isPlaceable, states: true, requireDoor: !centre }).design) return false;
  const c = costOf(d, easy);
  return !c.problems.length && !c.hard.length && c.units <= houseBudget(d.name) && c.smelts <= MAX_SMELTS;
}

// ---- 1. the library's dwellings, the larger homes and their pads; pickHouses' batches
console.log(`== MC_VANILLA_ALL=${ON ? 'on' : 'off'}: the library (house budget ${HOUSE_UNITS}${ON ? `, larger homes ${HOUSE_UNITS_LARGE}` : ''})`);
const totals = { small: 0, large: 0, other: 0, landmark: 0 };
for (const biome of VILLAGE_BIOMES) {
  const lib = vanillaLibrary(biome, (d, centre) => accept(d, centre), JAR);
  const dwell = lib.houses.filter((d) => isDwelling(d.name));
  // (larger by the bill, as pickHouses judges with the world's units: plan_layout's one building over HOUSE_UNITS)
  const large = dwell.filter((d) => unitsOf(d) > HOUSE_UNITS);
  const small = dwell.filter((d) => !large.includes(d));
  const landmark = lib.houses.filter((d) => isLandmark(d.name));
  const other = lib.houses.length - dwell.length - landmark.length;
  totals.small += small.length; totals.large += large.length; totals.other += other; totals.landmark += landmark.length;
  console.log(`${biome.padEnd(8)} dwellings ${dwell.length} (small ${small.length}, larger ${large.length}), other ${other}, landmark ${landmark.length}; centre ${lib.centre?.design.name ?? 'none'}`);
  console.log(`         within ${HOUSE_UNITS}: ${small.map((d) => `${d.name.replace(`${biome}_`, '')} ${d.width}x${d.depth} ${unitsOf(d)}u`).join(', ')}`);
  for (const d of small.filter((x) => Math.max(x.width, x.depth) > 9 && Math.max(x.width, x.depth) <= 13)) {
    const alone = padFor([d]);
    console.log(`         wide: ${d.name.replace(`${biome}_`, '')} ${d.width}x${d.depth}; pad alone ${alone ? alone.size : 'NONE'}`);
    check(alone && alone.size <= 31, `${d.name}: no pad of 31 or less places it alone`);
  }
  if (!ON) check(small.length <= 4 && !large.length, `${biome}: flag off keeps at most 4 small houses and no larger home (${small.length}, ${large.length})`);
  else check(dwell.every((d) => unitsOf(d) <= HOUSE_UNITS_LARGE), `${biome}: a dwelling over ${HOUSE_UNITS_LARGE}`);
  for (const d of large) {
    const smalls = dwell.filter((x) => x !== d && !large.includes(x)).slice(0, 3);
    const alone = padFor([d]), withThree = padFor([d, ...smalls]);
    console.log(`         larger: ${d.name.replace(`${biome}_`, '')} ${d.width}x${d.depth} ${unitsOf(d)}u; pad alone ${alone ? `${alone.size}` : 'NONE'}, with ${smalls.length} small ${withThree ? `${withThree.size} for ${withThree.n}` : 'NONE'}`);
    check(alone && alone.size <= 31, `${d.name}: no pad of 31 or less places it alone`);
    check(withThree && withThree.n >= 1 && withThree.size <= 31, `${d.name}: no pad places it with small houses`);
  }
  // pickHouses on a street village with this library: every home in turn, one larger home a batch
  const v = { name: 'T', plan: 'street', designs: {}, tasks: [], layouts: [], structures: [] } as unknown as Village;
  const seen = new Set<string>();
  for (let round = 0; round < 8; round++) {
    const pick = pickHouses(v, 4, lib.houses, unitsOf);
    const bigs = pick.filter((n) => large.some((d) => d.name === n));
    check(bigs.length <= (ON ? 1 : 0), `${biome}: a batch with ${bigs.length} larger homes (${pick.join(', ')})`);
    for (const n of pick) { seen.add(n); (v.tasks as unknown[]).push({ id: `t${v.tasks.length + 1}`, title: `Build ${n}`, detail: `build_design "${n}" at 0,0`, status: 'done' }); }
  }
  // (a dwelling over 13 across is no home: savanna's 15x8 medium house 1)
  const homes = dwell.filter((d) => !ON || (d.width <= 13 && d.depth <= 13));
  check(homes.every((d) => seen.has(d.name)), `${biome}: pickHouses never took ${homes.filter((d) => !seen.has(d.name)).map((d) => d.name).join(', ')}`);
  check([...seen].every((n) => homes.some((d) => d.name === n)), `${biome}: pickHouses took a design that is not a home`);
  console.log(`         8 batches of 4 took ${seen.size} designs`);
}
console.log(`total: small ${totals.small}, larger ${totals.large} (dwellings ${totals.small + totals.large}), other ${totals.other}, landmarks ${totals.landmark}`);
if (ON) check(totals.small + totals.large >= 31, `dwellings across styles ${totals.small + totals.large} < 31`);

// ---- 2. the importer's door cases
console.log('\n== door cases');
const CASES = ['plains/houses/plains_weaponsmith_1', 'snowy/houses/snowy_fisher_cottage', 'snowy/houses/snowy_weapon_smith_1', 'snowy/houses/snowy_shepherds_house_1', 'taiga/houses/taiga_medium_house_1', 'desert/houses/desert_cartographer_house_1'];
for (const path of CASES) {
  const biome = path.split('/')[0];
  try {
    const imp = pieceToDesign(readPiece(path, JAR), biome);
    const d = imp.design;
    const door = doorOf(d);
    const valid = validateDesign({ ...d } as unknown as Record<string, unknown>, 'vanilla', { isPlaceable, states: true, requireDoor: true });
    const c = costOf(d);
    // (a dwelling for the library under houseBudget; a work for the public works pool under a landmark's units, as mcWorld's publicWorks)
    const home = isDwelling(d.name), budget = home ? houseBudget(d.name) : LANDMARK_UNITS;
    const passes = !!valid.design && !c.problems.length && !c.hard.length && c.units <= budget && c.smelts <= MAX_SMELTS && (home || !!padFor([d]));
    console.log(`${d.name.padEnd(28)} ${d.width}x${d.depth}x${d.height} front ${imp.front}, door ${door.door} out ${door.out}; ${valid.design ? 'valid' : `INVALID: ${valid.errors.join('; ')}`}; ${c.units}u${c.hard.length ? ` hard ${c.hard.join('/')}` : ''}${c.smelts > MAX_SMELTS ? ` ${c.smelts} smelts` : ''}; ${passes ? 'passes' : 'refused'} as a ${home ? 'home' : 'public work'} (${budget}); ${imp.notes.join('; ')}`);
    check(ON, `${path}: imports with the flag off`);
    check(door.out[0] === 0 && door.out[1] === 1, `${path}: its door's way out is ${door.out}, not south`);
    check(valid.design, `${path}: invalid with a door`);
  } catch (e) {
    console.log(`${path.split('/').pop()!.padEnd(28)} refused: ${(e as Error).message}`);
    check(!ON, `${path}: ${(e as Error).message}`);
  }
}

// ---- 3. snowy pieces with diorite for snow and ice
console.log('\n== snowy pieces (snow and ice as diorite with the flag)');
{
  const { listPieces } = await import('../../server/src/vanillaPieces');
  const easyDiorite = /^diorite$/;
  let pass = 0, ifEasy = 0, withDiorite = 0;
  for (const path of listPieces(JAR, 'snowy', 'houses')) {
    let d: Design;
    try { d = pieceToDesign(readPiece(path, JAR), 'snowy').design; } catch { continue; }
    const diorite = Object.values(d.palette).some((b) => /^diorite/.test(b));
    if (!diorite) continue;
    withDiorite++;
    const ok = accept(d, false), okEasy = accept(d, false, easyDiorite);
    pass += Number(ok); ifEasy += Number(okEasy);
    const c = costOf(d), ce = costOf(d, easyDiorite);
    console.log(`${d.name.padEnd(26)} ${c.units}u (${ce.units}u with diorite gathered) ${ok ? 'passes' : okEasy ? 'passes once diorite is gathered (mcMaterials)' : `refused (${ce.hard.join('/') || (ce.units > houseBudget(d.name) ? `${ce.units}u over ${houseBudget(d.name)}` : 'invalid')})`}`);
  }
  console.log(`snowy pieces with diorite: ${withDiorite}; pass ${pass}; would pass with diorite in EASY_GATHER ${ifEasy}`);
  if (ON) check(withDiorite > 0, 'no snowy piece has diorite with the flag');
  else check(!withDiorite, 'diorite in a snowy piece with the flag off');
}

// ---- 3b. the public works pool (mcWorld's publicWorks: non-dwellings with a door, a landmark's units, a pad)
{
  const { listPieces } = await import('../../server/src/vanillaPieces');
  let n = 0;
  const by: string[] = [];
  for (const biome of VILLAGE_BIOMES) {
    let b = 0;
    for (const path of listPieces(JAR, biome, 'houses')) {
      if (isDwelling(path.split('/').pop()!)) continue;
      let d: Design;
      try { d = pieceToDesign(readPiece(path, JAR), biome).design; } catch { continue; }
      if (!validateDesign({ ...d } as unknown as Record<string, unknown>, 'vanilla', { isPlaceable, states: true, requireDoor: true }).design) continue;
      const c = costOf(d);
      if (c.problems.length || c.hard.length || c.units > LANDMARK_UNITS || c.smelts > MAX_SMELTS || !padFor([d])) continue;
      b++;
    }
    n += b;
    by.push(`${biome} ${b}`);
  }
  console.log(`
== public works pool: ${n} (${by.join(', ')})`);
}

// ---- 4. small works and yards
console.log('\n== small works and yards');
// (sandstone too: the world's initiative crews collect it with MC_VANILLA_ALL)
const EASY = /^(any:logs|any:cobblestone|.*_(log|stem)|bamboo_block|cobblestone|sand|(red_)?sandstone)$/;
const fmt = (c: Record<string, number>) => Object.entries(c).sort((a, b) => b[1] - a[1]).map(([n, q]) => `${q} ${n}`).join(', ');
/** One kind in three woods; `held`: what keeps it off the menu is reported, not failed (crewCanBuild's sandstone and coal). */
function workCheck(k: (typeof SMALL_WORKS)[number], yard: boolean, held = false): string {
  let line = '';
  const fails0 = fails.length;
  for (const wood of ['oak', 'birch', 'spruce']) {
    const d = k.make(wood);
    const tag = `${k.kind}/${wood}`;
    // (small works under 3 across build, as the 1x1 sapling does; validateDesign's side limit is the architect's, and it
    // reads a 1-wide design's rows as one flat list: those are checked here, the shape and every block placeable)
    if (Math.min(d.width, d.depth) >= 3) {
      const { design, errors } = validateDesign({ ...d, layers: d.layers.map((l) => [...l]), palette: { ...d.palette } } as unknown as Record<string, unknown>, d.by, { isPlaceable, states: true, requireDoor: false });
      if (!design) fails.push(`${tag}: ${errors.join('; ')}`);
    } else {
      if (d.layers.some((l) => l.length !== d.depth || l.some((r) => r.length !== d.width || [...r].some((c) => c !== '.' && c !== '_' && !d.palette[c])))) fails.push(`${tag}: layers not ${d.width}x${d.depth} or a symbol not in the palette`);
      for (const b of Object.values(d.palette)) if (!isPlaceable(b)) fails.push(`${tag}: ${b} is not placeable`);
    }
    if (d.name !== `small_${k.kind}_${wood}` || (!yard && !held && !isSmallWork(d.name))) fails.push(`${tag}: name ${d.name}`);
    if (yard && (d.width > YARD_MAX || d.depth > YARD_MAX)) fails.push(`${tag}: ${d.width}x${d.depth} is over ${YARD_MAX}`);
    if (d.height > 12) fails.push(`${tag}: ${d.height} layers`);
    for (const b of Object.values(d.palette)) { const m = /^(?:stripped_)?(oak|birch|spruce|acacia|jungle|dark_oak|mangrove|cherry|pale_oak)_/.exec(b); if (m && m[1] !== wood) fails.push(`${tag}: ${b} is not ${wood}`); }
    const plan = materials.plan(designBill(d));
    const other = Object.keys(plan.gather).filter((n) => !EASY.test(n));
    if (plan.problems.length) fails.push(`${tag}: ${plan.problems.join('; ')}`);
    if (other.length) fails.push(`${tag}: gathers ${other.join(', ')} (an initiative gathers logs, cobblestone, sand and sandstone)`);
    const alien = Object.keys(plan.gather).filter((n) => /_(log|stem)$/.test(n) && n !== `${wood}_log`);
    if (alien.length) fails.push(`${tag}: gathers ${alien.join(', ')} (not ${wood})`);
    const units = Object.values(plan.gather).reduce((s, q) => s + q, 0);
    if (held && wood === 'birch') line = `HELD (${fails.splice(fails0).map((f) => f.replace(/^[^:]+: /, '')).join('; ').slice(0, 120)}) `;
    if (held) fails.splice(fails0);
    if (wood === 'birch') line += `${k.kind.padEnd(24)} ${(k.biome ?? '').padEnd(7)} ${d.width}x${d.depth}x${d.height} ${String(d.blocks).padStart(3)} blocks | "${k.words}" | gather: ${fmt(plan.gather)} (${units} units)`;
  }
  return line;
}
const vanillaInSmall = SMALL_WORKS.filter((k) => k.biome);
console.log(`small-work kinds: ${SMALL_WORKS.length} (code ${SMALL_WORKS.length - vanillaInSmall.length}, vanilla ${vanillaInSmall.length}); yard works ${YARD_WORKS.length}`);
for (const k of VANILLA_WORKS) console.log('  ' + workCheck(k, false, !SMALL_WORKS.includes(k)));
const held = VANILLA_WORKS.filter((k) => !SMALL_WORKS.includes(k));
console.log(`vanilla kinds held off the menu (a crew cannot gather for them yet): ${held.map((k) => k.kind).join(', ') || 'none'}`);
const yardsBy: Record<string, number> = {};
// (yards are a pool for the world to offer: a yard a crew cannot gather for yet, the desert's sandstone, is reported)
for (const k of YARD_WORKS) { yardsBy[k.biome!] = (yardsBy[k.biome!] ?? 0) + 1; console.log('  yard ' + workCheck(k, true, !crewCanBuild(k))); }
console.log(`yards a crew can gather for now: ${YARD_WORKS.filter(crewCanBuild).length} of ${YARD_WORKS.length}`);
console.log(`yards by biome: ${VILLAGE_BIOMES.map((b) => `${b} ${yardsBy[b] ?? 0}`).join(', ')}; vanilla small works by biome: ${VILLAGE_BIOMES.map((b) => `${b} ${VANILLA_WORKS.filter((k) => k.biome === b).length}`).join(', ')}`);
check(new Set(SMALL_WORKS.map((k) => k.kind)).size === SMALL_WORKS.length, 'two small-work kinds share a key');
check(!YARD_WORKS.some((y) => SMALL_WORKS.some((k) => k.kind === y.kind)), 'a yard is also on the small works list');
if (ON) {
  // (13 pieces: the report's "14" counted one twice; desert's camel_spawn is no decoration)
  check(VANILLA_WORKS.length === 13, `${VANILLA_WORKS.length} vanilla lamp and decoration kinds, not 13`);
  check(SMALL_WORKS.length === 8 + VANILLA_WORKS.filter(crewCanBuild).length + (SMALL_WORKS.some((k) => k.kind === 'front_bed') ? 3 : 0) && SMALL_WORKS.length >= 18, `${SMALL_WORKS.length} small-work kinds`);
  check(YARD_WORKS.length >= 20, `only ${YARD_WORKS.length} yard works`);
} else {
  check(!VANILLA_WORKS.length && !YARD_WORKS.length && !vanillaInSmall.length, 'vanilla kinds with the flag off');
}

console.log(fails.length ? `\nFAIL (${fails.length}):\n  ${fails.slice(0, 40).join('\n  ')}` : `\nPASS (MC_VANILLA_ALL=${ON ? 'on' : 'off'}): dwellings ${totals.small + totals.large} (small ${totals.small}, larger ${totals.large}); small-work kinds ${SMALL_WORKS.length}; yards ${YARD_WORKS.length}`);
process.exit(fails.length ? 1 : 0);
