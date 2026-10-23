/**
 * MC_ORE_MINE's per-step cost, offline (IM2 froze the agent server for ~120 s at 5,226 cells): loads a saved iron level
 * (default mc/testserver/villages.json, village B25x2) and times the ore work a dig step runs (noteIron, oreDrift with and
 * without the world's dug test, claimIronLeg, oreScore over every turn, dropSeen) on a stub world: the level's dug cells
 * open, the sightings iron ore, the rest stone. Run:
 *   npx tsx scripts/checks/ore_mine_bench.mts [villages.json] [village]
 * Prints the worst and mean ms per call; exits 1 when a call's worst passes 5 ms.
 */
process.env.MC_IRON_AGE = 'on';
process.env.MC_ORE_MINE = 'on';
import fs from 'node:fs';
import type { IronLevel, MineLeg, Village } from '../../server/src/village';
const MM = await import('../../server/src/mineflayer/mcMine');

const file = process.argv[2] ?? 'mc/testserver/villages.json', name = process.argv[3] ?? 'B25x2';
const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
const all: Village[] = Array.isArray(raw) ? raw : Array.isArray(raw.villages) ? raw.villages : Object.values(raw.villages ?? raw);
const v = all.find((x) => x.name === name)!;
const fresh = () => JSON.parse(JSON.stringify(v.mine!.iron)) as IronLevel;
const i0 = fresh();
const L = i0.level!;
console.log(`${name}: level y=${L}, ${i0.legs.length} legs, ${i0.dug} cells in all (${i0.dug - (i0.dugAt ?? 0)} here), ${(i0 as { seen?: unknown[] }).seen?.length ?? 0} seen`);

// The stub world: open cells from the record, iron at the sightings, stone elsewhere; state ids 0 air, 1 stone, 2 iron
const open = new Set<string>();
for (const l of i0.legs) for (const c of [{ x: l.x, z: l.z }, ...MM.legCells(l)]) { open.add(`${c.x},${L},${c.z}`); open.add(`${c.x},${L + 1},${c.z}`); }
const ore = new Set(((i0 as { seen?: Array<[number, number, number]> }).seen ?? []).map((p) => p.join(',')));
const state = (x: number, y: number, z: number) => (open.has(`${x},${y},${z}`) ? 0 : ore.has(`${x},${y},${z}`) ? 2 : 1);
const col = { minY: -64, sections: new Array(24), getBlockStateId: (q: { x: number; y: number; z: number }) => state(cur.cx * 16 + q.x, q.y, cur.cz * 16 + q.z) };
const cur = { cx: 0, cz: 0 };
const notes: string[] = [];
const a = {
  name: 'Tess',
  world: { villages: { note: (_v: Village, s: string) => void notes.push(s), save: () => undefined }, registry: { blocksByName: { iron_ore: { minStateId: 2, maxStateId: 2 }, deepslate_iron_ore: { minStateId: 2, maxStateId: 2 } } } },
  bot: {
    game: { minY: -64 },
    world: { getColumn: (cx: number, cz: number) => { cur.cx = cx; cur.cz = cz; return col; } },
    blockAt: (p: { x: number; y: number; z: number }) => ({ name: state(p.x, p.y, p.z) ? 'stone' : 'air', boundingBox: state(p.x, p.y, p.z) ? 'block' : 'empty', position: p }),
  },
} as never;
const dug = (x: number, z: number) => open.has(`${x},${L},${z}`) && open.has(`${x},${L + 1},${z}`);

let worst = 0;
function time(label: string, n: number, f: (k: number) => void) {
  const ms: number[] = [];
  for (let k = 0; k < n; k++) { const t = performance.now(); f(k); ms.push(performance.now() - t); }
  const max = Math.max(...ms), mean = ms.reduce((s, x) => s + x, 0) / n;
  worst = Math.max(worst, max);
  console.log(`${label.padEnd(44)} worst ${max.toFixed(2).padStart(9)} ms  mean ${mean.toFixed(3).padStart(8)} ms  (${n} calls)`);
}
const cells = i0.legs.flatMap((l) => MM.legCells(l));
time('noteIron (a dug cell of the level)', 200, (k) => { const c = cells[k % cells.length]; MM.noteIron(a, v, fresh(), c.x, L, c.z); });
const i1 = fresh();
time('oreDrift, no world test', 50, () => MM.oreDrift(i1));
time('oreDrift, the world\'s dug test', 50, () => MM.oreDrift(i1, dug));
time('oreScore over every turn of every leg', 20, () => { for (const l of i1.legs) for (const side of [1, 2] as const) { const t = MM.turnFrom(l, side, false); if (t) MM.oreScore(i1, t); } });
time('claimIronLeg (fresh level each call)', 30, (k) => { const i = fresh(); MM.claimIronLeg(a, v, i, Date.now() + 60000, dug); MM.releaseIronClaims(v.name, 'Tess'); void k; });
// A run of claims on one level, as a trip's loop makes (drifts added and ended as they go)
const i2 = fresh();
time('claimIronLeg, 200 steps on one level', 200, () => {
  const l = MM.claimIronLeg(a, v, i2, Date.now() + 60000, dug);
  if (l && l !== 'busy' && MM.isDrift(i2, l)) { l.end = 'bench'; MM.dropSeen(i2, l as MineLeg); }
});
MM.releaseIronClaims(v.name, 'Tess');
// The trip loop's steps that never wait (a cell found open is passed at once, an ended branch skipped): how many in a row
// from the saved level, with the record's cells open, before a step would dig (and wait)
{
  const i = fresh();
  let n = 0;
  const t = performance.now();
  for (; n < 100000; n++) {
    const l = MM.claimIronLeg(a, v, i, Date.now() + 60000, dug);
    if (!l || l === 'busy') break;
    const len = MM.isDrift(i, l) ? (i as IronLevel & { drifts: Array<[number, number]> }).drifts.find(([k]) => i.legs[k] === l)![1] : undefined;
    if (len !== undefined && l.dug >= len) { l.end = 'reached'; MM.dropSeen(i, l); continue; }
    const c = len !== undefined ? { x: l.x + l.dir[0] * (l.dug + 1), z: l.z + l.dir[1] * (l.dug + 1), branch: 0 } : MM.tunnelCell(l, l.dug);
    if (l.ended.includes(c.branch)) { l.dug++; continue; }
    if (!dug(c.x, c.z)) break;
    l.dug++;
    if (len !== undefined) l.main = l.dug;
  }
  MM.releaseIronClaims(v.name, 'Tess');
  console.log(`${'trip loop steps without a wait'.padEnd(44)} ${n} steps in ${(performance.now() - t).toFixed(1)} ms`);
}
console.log(`worst call ${worst.toFixed(2)} ms`);
process.exit(worst > 5 ? 1 : 0);
