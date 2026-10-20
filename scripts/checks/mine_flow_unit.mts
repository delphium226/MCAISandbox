/**
 * s40 (F256): the mine's cap per level, the cells it can still give and the mine trend, offline. Run:
 *   npx tsx scripts/checks/mine_flow_unit.mts [villages.json]
 * Synthetic mines check mineCellsLeft (a level's cap, the levels the stairs may still reach, a stopped mine) and
 * mineCanGive at a full level; needWorks' mineflowReading and needs.ts's blocked mine gauge; with a villages.json (default
 * runs/2026-10-19/s40/night40_villages.json when present) every recorded mine's cells left are printed.
 */
import fs from 'node:fs';
import type { Mine, MineLeg, Village } from '../../server/src/village';
import { mineCanGive, mineCellsLeft } from '../../server/src/mineflayer/mcMine';
import { MINE_HORIZON_H, addMineFlow, mineflowReading } from '../../server/src/needWorks';
import { readNeeds } from '../../server/src/needs';

let checks = 0, failures = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${what}`);
  }
}

const CAP = 1080;
const leg = (y: number, dug: number, end?: string): MineLeg => ({ x: 0, z: 0, y, dir: [1, 0], dug, ended: [], main: dug, br: {}, ...(end ? { end } : {}) }) as MineLeg;
const mine = (legs: MineLeg[], extra: Partial<Mine> = {}): Mine => ({ top: { x: 0, z: 0, y: 64 }, dir: [1, 0], steps: 10, level: 59, dug: legs.reduce((s, l) => s + l.dug, 0), ended: [], legs, ...extra }) as unknown as Mine;
const village = (m: Mine) => ({ name: 'T', mine: m }) as unknown as Village;

// mineCellsLeft: a level's cap, plus a full level for each the stairs may still reach (3 levels in all)
ok(mineCellsLeft(undefined) === null, 'no mine: null');
ok(mineCellsLeft({ ...mine([]), level: undefined } as Mine) === null, 'stairs not at stone: null');
ok(mineCellsLeft(mine([leg(59, 0)])) === 3 * CAP, `a new mine: 3 levels (${mineCellsLeft(mine([leg(59, 0)]))})`);
const n40 = mine([leg(59, 900, 'dirt'), leg(59, 89)]);
ok(mineCellsLeft(n40) === CAP - 989 + 2 * CAP, `Night40's: 91 at its level and 2 levels below (${mineCellsLeft(n40)})`);
ok(mineCanGive(village(n40), 'cobblestone'), 'gives below the cap');
const full = mine([leg(59, 1000), leg(59, 80)]);
ok(mineCellsLeft(full) === 2 * CAP, `a full level: the 2 below (${mineCellsLeft(full)})`);
ok(mineCanGive(village(full), 'cobblestone'), 'a full level still gives: the stairs go down (the old cap stopped it here)');
const lvl2 = mine([leg(59, 1080), leg(52, 300)], { down: [{ x: 0, z: 0, y: 59, steps: 7, level: 52, dugAt: 1080 }] });
ok(mineCellsLeft(lvl2) === CAP - 300 + CAP, `level 2 counts its own cells (${mineCellsLeft(lvl2)})`);
const last = mine([leg(59, 1080), leg(52, 1080), leg(45, 1080)], { down: [{ x: 0, z: 0, y: 59, steps: 7, level: 52, dugAt: 1080 }, { x: 0, z: 0, y: 52, steps: 7, level: 45, dugAt: 2160 }] });
ok(mineCellsLeft(last) === 0 && !mineCanGive(village(last), 'cobblestone'), 'three full levels: spent');
const blockedDown = mine([leg(59, 1080)], { down: [{ x: 0, z: 0, y: 59, steps: 3, stopped: 'water' }] });
ok(mineCellsLeft(blockedDown) === 0 && !mineCanGive(village(blockedDown), 'cobblestone'), 'a full level whose stairs down stopped: spent');
ok(mineCellsLeft(mine([leg(59, 10)], { stopped: 'every tunnel ended' })) === 0, 'stopped: 0');
// (mv3_grown25's shape: its tunnels count 1377 cells, passed ones included, against 710 dug: the level is not full)
const g25 = mine([leg(59, 900), leg(59, 477)], { dug: 710 });
ok(mineCellsLeft(g25) === CAP - 710 + 2 * CAP, `real digs, not the tunnels' counts (${mineCellsLeft(g25)})`);

// The trend: cells dug per game hour over the window, hours left, the level against the horizon
let f = addMineFlow(undefined, 0, 0);
ok(mineflowReading(f, 500) === null, 'no window yet: null');
for (let i = 0; i < 6; i++) f = addMineFlow(f, 10, 30);
const r = mineflowReading(f, 540);
ok(!!r && Math.abs(r.hours - 3) < 0.01 && Math.abs(r.level - (1 - 3 / MINE_HORIZON_H)) < 0.01, `180 an hour, 540 left: 3 h (${JSON.stringify(r)})`);
ok(mineflowReading(f, 0)?.level === 1, 'spent reads 1 at once');
let idle = addMineFlow(undefined, 0, 0);
for (let i = 0; i < 6; i++) idle = addMineFlow(idle, 10, 0);
ok(mineflowReading(idle, 500)?.level === 0 && /none dug lately/.test(mineflowReading(idle, 500)!.text), 'nothing dug: level 0');

// The gauge fix: a mine that gives no stone reads full (it went unread)
const g = readNeeds({ members: 25, mineBlocked: 'it gives no stone' } as never);
const mineG = g.find((x) => x.kind === 'mine');
ok(mineG?.level === 1 && /mine blocked/.test(mineG.text), `blocked mine read (${JSON.stringify(mineG)})`);

// Recorded villages, for the record
const file = process.argv[2] ?? (fs.existsSync('runs/2026-10-19/s40/night40_villages.json') ? 'runs/2026-10-19/s40/night40_villages.json' : '');
if (file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const vs: Village[] = Array.isArray(d.villages ?? d) ? (d.villages ?? d) : Object.values(d.villages ?? d);
  for (const v of vs) if (v.mine?.legs?.length) console.log(`  ${v.name}: dug ${v.mine.dug}, ${v.mine.legs.length} tunnels, cells left ${mineCellsLeft(v.mine)}, gives ${mineCanGive(v, 'cobblestone')}`);
}

process.stdout.write(`mine_flow_unit: ${checks - failures}/${checks} passed\n`);
if (failures) process.exit(1);
