// Offline count (lesson 129): the work X.1's catalogue and furniture give mv3_base25 after completion, in raw materials,
// gathering trips and make chores; and the furniture a new house adds.
import fs from 'node:fs';
const minecraftData = (await import('minecraft-data')).default;
const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
const { buildCatalog } = await import('../../server/src/activities');
const W = await import('../../server/src/mineflayer/mcWorkshop');
const { buildingDecor } = await import('../../server/src/streetPlan');
const reg = minecraftData('26.1');
const m = new Materials(reg);
const d = JSON.parse(fs.readFileSync(process.argv[2] ?? 'mc/testcheckpoints/mv3_base25/villages.json', 'utf-8'));
const vs = d.villages ?? d;
const v = (Array.isArray(vs) ? vs : Object.values(vs))[0] as any;
const store: Record<string, number> = {};
for (const c of v.storage.chests) for (const [n, q] of Object.entries(c.items as Record<string, number>)) store[n] = (store[n] ?? 0) + q;
const wood = process.argv[3] ?? 'birch';
// Furniture: every vanilla building with a done Build task (as decorPartsOf; huts and centres skipped)
const demand: Record<string, number> = {};
let spots = 0;
for (const st of v.structures) {
  const des = v.designs[st.kind];
  if (!des || /storage_hut|mining_hut|meeting_point/.test(st.kind)) continue;
  for (const t of v.tasks) {
    const mm = t.status === 'done' ? /^build_design "([^"]+)" x=(-?\d+) z=(-?\d+)(?: rotate=(-?\d+))?/.exec(t.detail) : null;
    if (!mm || mm[1] !== st.kind) continue;
    const rot = ((Math.round(Number(mm[4] ?? 0) / 90) % 4) + 4) % 4;
    const ds = buildingDecor({ design: des, x: Number(mm[2]), z: Number(mm[3]), rot }, wood, {});
    spots += ds.length;
    console.log(`${st.kind}: ${ds.length} spots (${ds.map((q) => q.item).join(', ')})`);
    for (const q of ds) {
      demand[q.item] = (demand[q.item] ?? 0) + 1;
      if (q.also) demand[q.also.item] = (demand[q.also.item] ?? 0) + 1;
    }
    break;
  }
}
console.log(`furniture: ${spots} spots, wants ${JSON.stringify(demand)}`);
for (const [label, dem] of [['catalogue only', {}], ['catalogue + furniture', demand]] as const) {
  const { specs } = buildCatalog(reg, m, { wood, decorDemand: dem, keep: W.MAKE_GOODS, food: [] });
  const bill: Record<string, number> = {};
  let batches = 0;
  for (const s of specs) {
    const g = s.good;
    if (!g || g.food) continue;
    const def = Math.max(0, g.target - (store[g.item] ?? 0));
    if (!def) continue;
    bill[g.item] = def;
    batches += Math.ceil(def / g.batch);
  }
  const p = m.plan(bill, store);
  const gather = p.gather;
  const logs = Object.entries(gather).filter(([n]) => /log/.test(n)).reduce((s, [, q]) => s + q, 0);
  const cobble = Object.entries(gather).filter(([n]) => /cobblestone/.test(n)).reduce((s, [, q]) => s + q, 0);
  const sand = gather.sand ?? 0;
  const other = Object.entries(gather).filter(([n]) => !/log|cobblestone|^sand$/.test(n));
  // trips at the workshop's trip sizes; minutes a trip from S.9's runs (rough: logs 4, cobblestone 3, sand 3; a make 1)
  const trips = { logs: Math.ceil(logs / 12), cobblestone: Math.ceil(cobble / 32), sand: Math.ceil(sand / 16) };
  const minutes = trips.logs * 4 + trips.cobblestone * 3 + trips.sand * 3 + batches * 1 + spots * 0.3;
  console.log(`${label}: ${Object.keys(bill).length} goods short, ${batches} make batches; gather logs ${logs}, cobblestone ${cobble}, sand ${sand}${other.length ? `, other ${JSON.stringify(other)}` : ''}; trips ${JSON.stringify(trips)}; ~${Math.round(minutes)} agent-minutes; smelts ${p.fuel.smelts}`);
  console.log(`  at 25 members over 60 min (1500 agent-minutes): ~${Math.round((minutes / 1500) * 100)}% busy if spread; the logs cap (96 an hour) allows ${Math.min(logs, 96)} logs an hour`);
}
