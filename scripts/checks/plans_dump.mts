// Every registry item's plan (lesson 76): gather and steps, for a before/after diff of a Materials change.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/plans_dump.mts OUT.json (run before and after; diff the two)
import fs from 'node:fs';
const minecraftData = (await import('minecraft-data')).default;
const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
const reg = minecraftData('26.1');
const m = new Materials(reg);
const out: Record<string, unknown> = {};
const t0 = Date.now();
for (const it of reg.itemsArray) {
  const p = m.plan({ [it.name]: 1 }, {});
  out[it.name] = { gather: p.gather, steps: p.steps.map((s) => `${s.do}:${s.item}x${s.runs}`), problems: p.problems.length };
}
fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 0));
console.log(`${Object.keys(out).length} items in ${Date.now() - t0} ms -> ${process.argv[2]}`);
