/**
 * #104's R2 checked offline (MC_WOOD_VARIANTS; no server): with the flag on (the default here; MC_WOOD_VARIANTS=off checks
 * nothing changes)
 *  - variants: every house piece the importer takes (each biome's houses/), in every wood of VARIANT_WOODS and bamboo:
 *    the same layers, named "base@wood", no other wood left in its palette, every block placeable, its bill (Materials.plan)
 *    within 5% of the base's units (bamboo is expected out: its planks come two a block); looks per house counted;
 *  - the woods chosen per neighbourhood (grow.ts hoodWood, hoodWoods) for a stub of trees near home, four neighbourhoods
 *    in a row, and hoodWoodAt on their plots; pickHouses with a wood: variant names, the variants in the library, shapes
 *    taking turns across woods;
 *  - names (lesson 89: key on the name the data carries): isDwelling, isLandmark, houseBudget, isVanillaPieceName on
 *    variants; the sign text of a variant by both paths (by 'vanilla', and by the name alone as a staged run's 'api'
 *    designs are) equal to its base's; the vanilla lights of a variant equal to its base's; smallWorkWood;
 *  - the style vote's biome x wood options (vote.ts woodStyleOptions).
 * Prints PASS or FAIL (exit 1).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/wood_variants.mts   Env: MC_WOOD_VARIANTS (on), JAR.
 */
process.env.MC_WOOD_VARIANTS ??= 'on';
const ON = /^(on|1|true)$/i.test(process.env.MC_WOOD_VARIANTS);
const minecraftData = (await import('minecraft-data')).default;
const D = await import('../../server/src/designs');
const { Materials, designBill } = await import('../../server/src/mineflayer/mcMaterials');
const { DEFAULT_JAR, VILLAGE_BIOMES, listPieces, pieceToDesign, readPiece, vanillaLights } = await import('../../server/src/vanillaPieces');
const G = await import('../../server/src/grow');
const { signLabel } = await import('../../server/src/streetPlan');
const { SMALL_WORKS, smallWorkWood } = await import('../../server/src/smallWorks');
const { woodStyleOptions, parseStyle } = await import('../../server/src/vote');
type Design = import('../../server/src/village').Design;
type Village = import('../../server/src/village').Village;

const reg = minecraftData('26.1');
const materials = new Materials(reg);
const JAR = process.env.JAR ?? DEFAULT_JAR;
const fails: string[] = [];
const check = (ok: unknown, what: string) => { if (!ok) fails.push(what); };
check(D.WOOD_VARIANTS === ON, `designs.ts WOOD_VARIANTS is ${D.WOOD_VARIANTS}`);
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
const unitsOf = (d: Design) => { const p = materials.plan(designBill(d)); return { units: Object.values(p.gather).reduce((s, q) => s + q, 0), problems: p.problems }; };
const WOODS_RE = /^(?:stripped_)?(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_/;

// ---- 1. variants of every house piece
console.log(`== MC_WOOD_VARIANTS=${ON ? 'on' : 'off'}: variants (${D.VARIANT_WOODS.length} woods; bamboo, crimson and warped shown, left out)`);
const looks: number[] = [];
const outBy: Record<string, number> = {};
let pieces = 0;
for (const biome of VILLAGE_BIOMES) {
  const rows: string[] = [];
  for (const path of listPieces(JAR, biome, 'houses')) {
    let d: Design;
    try { d = pieceToDesign(readPiece(path, JAR), biome).design; } catch { continue; }
    pieces++;
    const base = unitsOf(d);
    if (base.problems.length) continue;
    let ok = 0;
    const spread: string[] = [];
    for (const w of [...D.VARIANT_WOODS, 'bamboo', 'crimson', 'warped']) {
      const v = D.woodVariant(d, w);
      const same = v.width === d.width && v.depth === d.depth && v.height === d.height && v.blocks === d.blocks && JSON.stringify(v.layers) === JSON.stringify(d.layers);
      check(same, `${v.name}: its shape is not the base's`);
      check(v.name === `${d.name}@${w}` && D.baseName(v.name) === d.name && D.variantWood(v.name) === w, `${v.name}: name`);
      const alien = Object.values(v.palette).filter((b) => { const m = WOODS_RE.exec(b); return m && m[1] !== w; });
      check(!alien.length, `${v.name}: ${alien.join(', ')} not in ${w}`);
      const unplaceable = Object.values(v.palette).filter((b) => !isPlaceable(b));
      const u = unitsOf(v);
      const within = !u.problems.length && Math.abs(u.units - base.units) <= base.units * 0.05;
      const listed = D.VARIANT_WOODS.includes(w);
      if (listed && !unplaceable.length && within) ok++;
      else if (listed) { outBy[w] = (outBy[w] ?? 0) + 1; check(false, `${v.name}: ${unplaceable.length ? `not placeable: ${unplaceable.join(', ')}` : ''}${u.problems.length ? u.problems.join('; ') : ''}${!within && !u.problems.length ? ` ${u.units} units against ${base.units}` : ''}`); }
      else outBy[w] = (outBy[w] ?? 0) + Number(!within || unplaceable.length > 0);
      if (w === 'spruce' || w === 'bamboo') spread.push(`${w} ${u.units}`);
    }
    looks.push(ok);
    rows.push(`${d.name.replace(`${biome}_`, '')} ${base.units}u: ${ok} woods (${spread.join(', ')})`);
  }
  console.log(`${biome.padEnd(8)} ${rows.join('; ')}`);
}
const minLooks = Math.min(...looks), maxLooks = Math.max(...looks);
console.log(`pieces ${pieces}; looks per house ${minLooks}-${maxLooks} (its own wood among them); outside 5% or unplaceable: bamboo ${outBy.bamboo ?? 0}, crimson ${outBy.crimson ?? 0}, warped ${outBy.warped ?? 0} of ${looks.length}`);
check(minLooks >= D.VARIANT_WOODS.length, `a house with only ${minLooks} looks`);

// ---- 2. a wood a neighbourhood, from a stub of trees near home
console.log('\n== woods per neighbourhood (stub: trees near home)');
const chunks = [{ low: { birch: 250, oak: 120 } }, { low: { birch: 150, oak: 180, spruce: 95 } }, { logs: { dark_oak: 20, spruce: 400 }, low: { dark_oak: 20 } }];
const trees = G.treesNear(chunks);
console.log(`trees near home: ${JSON.stringify(trees)}; a neighbourhood needs 60 logs (90 near home)`);
const v = { name: 'T', plan: 'street', wood: 'birch', designs: {}, tasks: [], layouts: [], structures: [] } as unknown as Village;
const lib: Design[] = [];
for (const p of listPieces(JAR, 'plains', 'houses').filter((x) => /small_house_[1-4]$/.test(x))) lib.push(pieceToDesign(readPiece(p, JAR), 'plains').design);
const chosen: string[] = [];
for (let k = 0; k < 4; k++) {
  const used = G.hoodWoods(v);
  const wood = G.hoodWood(trees, 60, used);
  chosen.push(wood ?? '(village wood)');
  const pick = G.pickHouses(v, 4, lib, undefined, undefined, wood ?? undefined);
  console.log(`neighbourhood ${k + 1}: used ${used.join(', ')} -> ${wood ?? 'none: the village wood'}; houses ${pick.join(', ')}`);
  if (ON) {
    check(wood && pick.every((n) => D.variantWood(n) === wood && v.designs[n]?.name === n), `neighbourhood ${k + 1}: picks not in ${wood}`);
    check(pick.every((n) => Object.values(v.designs[n].palette).every((b) => { const m = WOODS_RE.exec(b); return !m || m[1] === wood; })), `neighbourhood ${k + 1}: a pick's blocks not in ${wood}`);
  } else check(!wood && pick.every((n) => !n.includes('@')), 'flag off: a wood or a variant');
  const x1 = k * 40;
  (v.layouts as unknown[]).push({ x1, z1: 0, x2: x1 + 22, z2: 22, buildings: pick, grow: true });
  for (const n of pick) (v.tasks as unknown[]).push({ id: `t${v.tasks.length + 1}`, title: `Build ${n}`, detail: `build_design "${n}" at 0,0`, status: 'done' });
  check(G.hoodWoodAt(v, x1 + 5, 5) === (ON ? wood : undefined), `hoodWoodAt on neighbourhood ${k + 1}`);
}
if (ON) {
  // (birch 400, oak 300, spruce 95 pass 90; dark oak 20 does not: unused woods first by most trees, oak then spruce;
  // then every wood is used, so the most trees, birch)
  check(JSON.stringify(chosen) === JSON.stringify(['oak', 'spruce', 'birch', 'birch']), `woods chosen ${chosen.join(', ')}, not oak, spruce, birch, birch`);
  check(G.hoodWood({ birch: 50 }, 60, ['birch']) === null, 'a wood with too few trees was chosen');
  // (shapes take turns across woods: 16 picks of 4 designs, each 4 times)
  const counts: Record<string, number> = {};
  for (const l of v.layouts ?? []) for (const n of l.buildings) counts[D.baseName(n)] = (counts[D.baseName(n)] ?? 0) + 1;
  console.log(`shapes over the four: ${JSON.stringify(counts)}`);
  check(Object.values(counts).every((c) => c === 4), 'shapes did not take turns across woods');
}
check(G.hoodWoodAt(v, -100, -100) === undefined, 'hoodWoodAt off every neighbourhood');

// ---- 3. names (lesson 89)
console.log('\n== names (lesson 89)');
const STREET_PLAN_TODAY = /^(plains|desert|savanna|snowy|taiga)_[a-z_]+_\d+$/;
for (const base of ['plains_small_house_1', 'taiga_medium_house_2', 'plains_library_2', 'desert_butcher_shop_1']) {
  const name = `${base}@dark_oak`;
  check(G.isDwelling(name) === G.isDwelling(base), `isDwelling(${name})`);
  check(D.isLandmark(name) === D.isLandmark(base), `isLandmark(${name})`);
  check(D.houseBudget(name) === D.houseBudget(base), `houseBudget(${name})`);
  check(D.isVanillaPieceName(name) && D.isVanillaPieceName(base), `isVanillaPieceName(${name})`);
  const want = signLabel(base, true).join(' / ');
  const byVanilla = signLabel(name, true).join(' / ');
  const byName = signLabel(name, D.isVanillaPieceName(name)).join(' / ');
  const today = signLabel(name, STREET_PLAN_TODAY.test(name)).join(' / ');
  check(byVanilla === want && byName === want, `${name}: sign "${byVanilla}" / "${byName}", not "${want}"`);
  console.log(`${name.padEnd(32)} sign "${want}" (by 'vanilla' "${byVanilla}", by the name "${byName}"; streetPlan's own test today on an 'api' design: "${today}")`);
}
for (const p of ['plains/houses/plains_small_house_1', 'savanna/houses/savanna_small_house_3']) {
  const biome = p.split('/')[0];
  const d = pieceToDesign(readPiece(p, JAR), biome).design;
  const lb = vanillaLights(d), lv = vanillaLights(D.woodVariant(d, 'cherry'));
  check(lb && JSON.stringify(lb) === JSON.stringify(lv), `vanillaLights of ${d.name}@cherry differ from the base's`);
  const posted = { ...D.woodVariant(d, 'cherry'), palette: { ...D.woodVariant(d, 'cherry').palette, A: 'stone' } };
  check(vanillaLights(posted) === null, `a design posted under ${d.name}@cherry with other blocks has the piece's lights`);
}
for (const k of SMALL_WORKS.slice(0, 8)) for (const w of ['dark_oak', 'spruce']) check(smallWorkWood(k.make(w).name) === w, `smallWorkWood(${k.make(w).name})`);
check(smallWorkWood('plains_small_house_1') === undefined, 'smallWorkWood of a house');
console.log(`sign, lights and small-work names checked; small works take a neighbourhood's wood: ${SMALL_WORKS[0].make('cherry').name}`);

// ---- 4. the vote's biome x wood options
console.log('\n== the style vote, biome x wood');
const opts = [
  { id: 'plains', name: 'Plains cottages', facts: 'cottages', current: true, novel: false, units: 110, volume: 300 },
  { id: 'savanna', name: 'Savanna houses', facts: 'airy houses', current: false, novel: true, units: 70, volume: 280 },
];
const wopts = woodStyleOptions(opts, trees, 60, ['birch'], 'birch');
for (const o of wopts) console.log(`${o.id.padEnd(16)} ${o.name} | current ${o.current} novel ${o.novel} | ${o.facts}`);
check(wopts.length === 4 && wopts[0].id === 'plains@birch' && wopts[0].current && wopts.filter((o) => o.current).length === 1, 'the current style in the current wood first, and only it current');
check(wopts.every((o) => parseStyle(o.id).wood && opts.some((b) => b.id === parseStyle(o.id).biome)), 'option ids are biome@wood');
check(!wopts.some((o) => parseStyle(o.id).wood === 'dark_oak'), 'dark oak (20 logs) offered');
check(JSON.stringify(woodStyleOptions(opts, {}, 60, [], 'birch')) === JSON.stringify(opts), 'no trees: the options as they were');

console.log(fails.length ? `\nFAIL (${fails.length}):\n  ${fails.slice(0, 40).join('\n  ')}` : `\nPASS (MC_WOOD_VARIANTS=${ON ? 'on' : 'off'}): ${pieces} pieces, ${minLooks}-${maxLooks} looks a house; woods chosen ${chosen.join(', ')}; ${wopts.length} vote options`);
process.exit(fails.length ? 1 : 0);
