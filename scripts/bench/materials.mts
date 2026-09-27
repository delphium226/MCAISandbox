// Bills of materials for every design in mc/server/villages.json, and a few item lists: what to gather, craft and
// smelt (mcMaterials.ts). Run: node_modules/.bin/tsx scripts/bench/materials.mts
import fs from 'node:fs';
import minecraftData from 'minecraft-data';
import { Materials, designBill, describePlan } from '../../server/src/mineflayer/mcMaterials';
const m = new Materials(minecraftData('26.1'));
const data = JSON.parse(fs.readFileSync('mc/server/villages.json', 'utf8'));
const vs: any[] = Array.isArray(data) ? data : Object.values(data.villages ?? data);
for (const v of vs) for (const d of Object.values(v.designs ?? {}) as any[]) {
  const p = m.plan(designBill(d));
  console.log(`\n== ${v.name}/${d.name} (${d.blocks} cells)\n${describePlan(p)}\nsteps: ${p.steps.map((s) => `${s.do} ${s.item} x${s.runs}`).join(' > ')}`);
}
for (const [items, have] of [[{ chest: 1, crafting_table: 1, oak_door: 3 }, {}], [{ chest: 1, oak_door: 1 }, { acacia_planks: 5, oak_log: 1 }], [{ bookshelf: 2, lantern: 1, furnace: 1, mossy_cobblestone: 2, stone_bricks: 4, bricks: 2, white_wool: 3, oak_fence: 3, cobblestone_wall: 6, smooth_stone: 4 }, { coal: 1 }]] as const) {
  const p = m.plan(items as any, have as any);
  console.log(`\n== ${JSON.stringify(items)} have ${JSON.stringify(have)}\n${describePlan(p)}\nsteps: ${p.steps.map((s) => `${s.do} ${s.item} x${s.runs}`).join(' > ')}`);
}
