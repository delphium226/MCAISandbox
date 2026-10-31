/**
 * New shafts (the user's, 10-28: a worked-out mine leads to a new one) and #168 (the stairs lock), offline, on the mine
 * that ran dry in the dyes-greens D1 run (train 7 A's: a level at y 22, the monument's deep level at -4, then nothing)
 * and on stub records. Run:
 *   npx tsx scripts/checks/new_shaft.mts [villages.json]
 * The worked-out mine is offered again (ironDone) and a new shaft laid off the y 22 level at a free height near the iron's
 * peak; its stairs keep off the deep level's; the levels below it chain from it (chainAbove), its counts its own; with
 * every height taken nothing is laid and the dig option goes for IRON_RETRY_MS; the stairs lock names its holder.
 */
process.env.MC_IRON_AGE = 'on';
process.env.MC_ORE_MINE = 'on';
import fs from 'node:fs';
import type { IronLevel, Mine, Village } from '../../server/src/village';
const MM = await import('../../server/src/mineflayer/mcMine');

let checks = 0, failures = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${what}`);
  }
}

const notes: string[] = [];
const reg = { note: (_v: Village, s: string) => void notes.push(s), save: () => undefined };
const file = process.argv[2] ?? 'scripts/checks/data/new_shaft_d1.json';
const mine0: Mine = JSON.parse(fs.readFileSync(file, 'utf-8'));
const fresh = () => structuredClone(mine0);
const v = { name: 'A' } as unknown as Village;
const cols = (i: IronLevel) => Array.from({ length: i.steps }, (_, k) => `${i.x + i.dir[0] * (k + 1)},${i.z + i.dir[1] * (k + 1)}`);

// The D1 mine: finished at y -4 for good, no level can follow (y -10 is below the floor)
{
  const m = fresh();
  ok(m.iron?.finished && m.iron.level === -4 && (m.ironPast?.length ?? 0) === 1, `the record is D1's (${m.iron?.level}, ${m.iron?.finished})`);
  ok(!MM.ironDone(m), 'a worked-out mine is offered again (a new shaft is due)');
  ok(MM.deepLevel(m)?.open === false, 'the finished deep level is not open for deep stone');
  const ch = MM.shaftChoices(m);
  ok(ch.length > 0, `new shafts possible (${ch.length})`);
  const best = ch[0];
  ok(best && best.from === 0 && best.target >= 10 && best.target <= 18, `the best is off the y 22 level near the peak (${JSON.stringify(best)})`);
  const f0 = m.ironPast![0], foot0 = { x: f0.x + f0.dir[0] * f0.steps, z: f0.z + f0.dir[1] * f0.steps };
  ok(!ch.some((c) => Math.abs(c.target - 22) < 6 && Math.hypot(c.foot.x - foot0.x, c.foot.z - foot0.z) < 48), 'no height beside the y 22 level near it');
  const deep = m.iron!, top = m.ironPast![0];
  const note = MM.openShaft(reg, v, m);
  const s = m.iron!;
  ok(note && s !== deep && m.ironPast?.at(-1) === deep, `a new shaft is laid (${note})`);
  ok(!s.finished && s.level === undefined && s.steps === 0 && s.y === top.level, `its stairs start on the y 22 level (${s.x},${s.y},${s.z})`);
  ok((s as IronLevel & { from?: number }).from === 0 && (s as IronLevel & { shaftAt?: number }).shaftAt === deep.dug, 'its parent and its count are recorded');
  ok(s.dug === deep.dug && s.dugAt === deep.dug && s.got.raw_iron === deep.got.raw_iron, 'the mine\'s totals run on');
  const deepCols = new Set([`${deep.x},${deep.z}`, ...cols(deep)]);
  ok(![`${s.x + s.dir[0]},${s.z + s.dir[1]}`, ...cols({ ...s, steps: 4 })].some((c) => deepCols.has(c)), 'its first steps keep off the deep level\'s stairs');
  ok(!MM.ironDone(m), 'the dig option stays');
  ok(MM.chainAbove(m, s).length === 1 && MM.chainAbove(m, s)[0] === top, 'a trip walks through the y 22 level only, not the deep one');
  // (its stairs dug: a level there; when it finishes the next one is laid below it, in the same shaft)
  s.steps = top.level! - s.targetY!;
  s.level = s.y - s.steps;
  s.legs = [{ x: s.x + s.dir[0] * s.steps, z: s.z + s.dir[1] * s.steps, y: s.level, dir: s.dir, dug: 30, ended: [] }];
  s.dug += 1150;
  s.finished = '1150 tunnel cells dug';
  const n2 = MM.layNextIronLevel(reg, v, m, s);
  ok(n2 && m.iron !== s && m.ironPast?.at(-1) === s && !(m.iron as IronLevel & { from?: number }).from, `the next level follows below it (${n2})`);
  ok((m.iron as IronLevel & { shaftAt?: number }).shaftAt === deep.dug, 'in the same shaft');
  ok(MM.chainAbove(m, m.iron!).map((p) => p.level).join(',') === `22,${s.level}`, `walked through y 22 and the shaft's first (${MM.chainAbove(m, m.iron!).map((p) => p.level)})`);
}

// Every height taken: nothing laid, the dig option goes for 30 minutes, then is looked for again
{
  const m = fresh();
  const i = m.iron!;
  const shafts = MM.shaftChoices(m);
  // (a level at every height from 28 down, at each candidate's foot)
  const fill: IronLevel[] = [];
  for (const c of shafts) if (!fill.some((f) => f.level === c.target && f.x === c.foot.x && f.z === c.foot.z)) fill.push({ x: c.foot.x, z: c.foot.z, y: c.target, dir: [1, 0], steps: 0, level: c.target, legs: [], dug: 0, got: {} });
  m.ironPast = [...m.ironPast!, ...fill];
  ok(MM.shaftChoices(m).length === 0, `no height left (${MM.shaftChoices(m).length})`);
  const t = Date.now();
  ok(MM.openShaft(reg, v, m, undefined, t) === '' && m.iron === i, 'none laid');
  ok(MM.ironDone(m, t + 60000), 'the dig option goes');
  ok(!MM.ironDone(m, t + 31 * 60000), 'and comes back after the wait, for the next trip to look again');
}

// A level not finished, a level waiting on its retry: no shaft
{
  const m = fresh();
  delete m.iron!.finished;
  ok(MM.openShaft(reg, v, m) === '' && MM.ironDone(m) === false, 'a level still dug: no shaft');
  const r = fresh();
  Object.assign(r.iron!, { retryAt: Date.now() + 10 * 60000 });
  ok(MM.ironDone(r), 'a level waiting on its retry stays finished for the menus (its own back-off, not a shaft)');
}

// The old chain is unchanged: a level laid below the last walks through every level before it
{
  const m = fresh();
  delete (m.iron as IronLevel & { from?: number }).from;
  ok(MM.chainAbove(m, m.iron!).length === 1 && MM.chainAbove(m, m.iron!)[0] === m.ironPast![0], 'a record without `from` chains as before');
}

// #168: the stairs held by another member (no second lane) take the dig option off; the holder and others after it may go
{
  const m = fresh();
  MM.openShaft(reg, v, m);
  const until = Date.now() + 5 * 60000;
  ok(MM.ironStairsHeld('A', 'Ben', m) === null, 'nobody on the stairs: free');
  ok(MM.takeIronStairs('A', 'Ada', until), 'Ada takes the stairs');
  ok(MM.ironStairsHeld('A', 'Ben', m) === 'Ada', 'Ben sees them held by Ada');
  ok(MM.ironStairsHeld('A', 'Ada', m) === null, 'not for Ada herself');
  ok(MM.ironStairsHeld('A', 'Ben', m, until + 6 * 60000) === null, 'a lapsed hold is free');
  m.iron!.level = 10;
  ok(MM.ironStairsHeld('A', 'Ben', m) === null, 'stairs dug to their level: free');
  MM.releaseIronClaims('A', 'Ada');
}

// #169: the trip places as the menus see them are the ones ironGate counts, whatever chore took them (a monument
// deep-level trip holds no irondig slot)
{
  const m = fresh();
  m.iron!.level = 10;
  const until = Date.now() + 5 * 60000;
  ok(MM.ironLevelFull('B', 'Dev') === null, 'no trips: room');
  for (const n of ['Ada', 'Ben']) ok(MM.ironGate('B', n, m.iron!, until) === null, `${n}'s trip goes down`);
  MM.holdIronTrip('B', 'Cleo', until);
  ok(JSON.stringify(MM.ironLevelFull('B', 'Dev')) === '["Ada","Ben","Cleo"]', `three on the level: full for Dev (${MM.ironLevelFull('B', 'Dev')})`);
  ok(/three miners/.test(MM.ironGate('B', 'Dev', m.iron!, until) ?? ''), 'and ironGate refuses Dev');
  ok(MM.ironLevelFull('B', 'Ada') === null && MM.ironGate('B', 'Ada', m.iron!, until) === null, 'a miner already down is not counted against itself');
  ok(MM.ironLevelFull('B', 'Dev', until + 6 * 60000) === null, 'lapsed places free');
  MM.releaseIronClaims('B', 'Cleo');
  ok(MM.ironLevelFull('B', 'Dev') === null && MM.ironGate('B', 'Dev', m.iron!, until) === null, 'a released place: Dev goes down');
  for (const n of ['Ada', 'Ben', 'Dev']) MM.releaseIronClaims('B', n);
}

console.log(`${failures ? 'FAILED' : 'ok'}: new_shaft ${checks - failures}/${checks}`);
if (failures) process.exit(1);
