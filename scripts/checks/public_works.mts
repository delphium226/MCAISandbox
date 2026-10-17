// X.2's pool (scripts/checks/public_works.mts; spec runs/2026-10-16/s34/spec_x2.md): the non-dwelling vanilla pieces (shops, smithies, stables, libraries, temples...) of the five
// biomes a peaceful village could build as public works: survival bill without hard materials, units and smelts in budget.
const minecraftData = (await import('minecraft-data')).default;
const { Materials, designBill, hardToGather } = await import('../../server/src/mineflayer/mcMaterials');
const { listPieces, readPiece, pieceToDesign, VILLAGE_BIOMES } = await import('../../server/src/vanillaPieces');
const { isDwelling } = await import('../../server/src/grow');
const m = new Materials(minecraftData('26.1'));
let ok = 0, all = 0;
for (const b of VILLAGE_BIOMES) {
  const rows: string[] = [];
  for (const p of listPieces(undefined, b, 'houses')) {
    const name = p.split('/').pop()!;
    if (isDwelling(name)) continue;
    let d;
    try { d = pieceToDesign(readPiece(p), b).design; } catch { continue; }
    all++;
    const plan = m.plan({ ...designBill(d), crafting_table: 1 });
    const hard = hardToGather(plan.gather);
    const units = Object.values(plan.gather).reduce((s, q) => s + q, 0);
    const fits = !hard.length && !plan.problems.length && units <= 300 && plan.fuel.smelts <= 32 && Math.max(d.width, d.depth) <= 13;
    if (fits) ok++;
    rows.push(`${fits ? '+' : '-'}${name}(${d.width}x${d.depth},${units}u${hard.length ? ',' + hard.join('/') : ''}${plan.fuel.smelts > 32 ? ',smelts ' + plan.fuel.smelts : ''})`);
  }
  console.log(`${b}: ${rows.join(' ')}`);
}
console.log(`${ok} of ${all} non-dwelling pieces fit (no hard materials, <= 300 units, <= 32 smelts, <= 13 wide)`);
// (53 of 63 on 10-16: a jar or Materials change that empties the pool shows here)
if (ok < 40) {
  console.log(`FAIL public_works: only ${ok} fit`);
  process.exit(1);
}
console.log(`OK public_works: ${ok} fit`);
