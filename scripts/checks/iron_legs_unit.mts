/**
 * G8's iron age (MC_IRON_AGE), offline: the iron level's per-leg claims, the miners' gate and the next iron levels, on
 * stub records (no world). Run:
 *   npx tsx scripts/checks/iron_legs_unit.mts
 * claimIronLeg (a leg per miner, turns when every leg going is held, 'busy', null when every tunnel ended, lapsed holds
 * freed), ironGate (IRON_MINERS at once, the stairs one at a time), ironDeeperStart and layNextIronLevel (12 below, three
 * levels at most, never aimed below y 0; `dug` and `got` run on), and mineAreas / mineLights over finished levels.
 */
process.env.MC_IRON_AGE = 'on';
import type { IronLevel, Mine, MineLeg, Village } from '../../server/src/village';
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
const bot = (name: string) => ({ name, world: { villages: reg } });
const v = { name: 'T' } as unknown as Village;
const leg = (x: number, z: number, y: number, dir: [number, number], dug = 0, end?: string): MineLeg => ({ x, z, y, dir, dug, ended: [], ...(end ? { end } : {}) });
const level = (extra: Partial<IronLevel> = {}): IronLevel => ({ x: 0, z: 0, y: 40, dir: [1, 0], steps: 22, level: 18, legs: [leg(22, 0, 18, [1, 0])], dug: 0, got: {}, ...extra });

// claimIronLeg: one leg each; the second and third miners get turns off the bottom of the stairs; a fourth waits
{
  const i = level();
  const A = MM.claimIronLeg(bot('Ada'), v, i), B = MM.claimIronLeg(bot('Ben'), v, i), C = MM.claimIronLeg(bot('Cal'), v, i);
  ok(A === i.legs[0], 'the first miner takes the leg going');
  ok(B && B !== 'busy' && B !== A && i.legs.length >= 2, `the second gets a turn of its own (${i.legs.length} legs)`);
  ok(C && C !== 'busy' && C !== A && C !== B, 'the third gets another');
  const D = MM.claimIronLeg(bot('Dan'), v, i);
  ok(D === 'busy', `a fourth finds every leg held and no turn (${String(D && D !== 'busy' ? 'a leg' : D)})`);
  ok(MM.claimIronLeg(bot('Ada'), v, i) === A, 'a miner keeps its own leg');
  MM.releaseIronClaims(v.name, 'Ada');
  ok(MM.claimIronLeg(bot('Dan'), v, i) === A, 'a released leg goes to the next miner');
  // A held leg that ends: let go, and the next one taken
  (A as MineLeg).end = 'water';
  const D2 = MM.claimIronLeg(bot('Dan'), v, i);
  ok(D2 !== A, 'a miner whose leg ended moves on');
  for (const n of ['Ben', 'Cal', 'Dan']) MM.releaseIronClaims(v.name, n);
  for (const l of i.legs) l.end = 'stone';
  ok(MM.claimIronLeg(bot('Eve'), v, i) === null, 'every tunnel ended and no turn: null');
}

// Lapsed holds are free (a trip that never let go)
{
  const i = level();
  MM.claimIronLeg(bot('Gus'), v, i, Date.now() - 20 * 60000);
  ok(MM.claimIronLeg(bot('Hal'), v, i) === i.legs[0], 'a lapsed hold frees its leg');
  MM.releaseIronClaims(v.name, 'Hal');
  MM.releaseIronClaims(v.name, 'Gus');
}

// The level's room: no turn past 9 legs
{
  const i = level({ legs: Array.from({ length: 9 }, (_, k) => leg(22, k * 4, 18, [1, 0], 200)) });
  for (const [k, n] of ['Ada', 'Ben', 'Cal', 'Dan', 'Eve', 'Fay', 'Gil', 'Hap', 'Ivy'].entries()) ok(MM.claimIronLeg(bot(n), v, i) === i.legs[k], `miner ${k + 1} takes leg ${k + 1}`);
  ok(MM.claimIronLeg(bot('Jo'), v, i) === 'busy' && i.legs.length === 9, `no tenth leg (${i.legs.length})`);
  for (const n of ['Ada', 'Ben', 'Cal', 'Dan', 'Eve', 'Fay', 'Gil', 'Hap', 'Ivy']) MM.releaseIronClaims(v.name, n);
}

// ironGate: three miners at once; the stairs one at a time
{
  const until = Date.now() + 4 * 60000;
  const i = level();
  ok(MM.ironGate('G', 'Ada', i, until) === null && MM.ironGate('G', 'Ben', i, until) === null && MM.ironGate('G', 'Cal', i, until) === null, 'three miners go down');
  const no = MM.ironGate('G', 'Dan', i, until);
  ok(!!no && /three miners/.test(no), `a fourth is told (${no})`);
  MM.releaseIronClaims('G', 'Cal');
  ok(MM.ironGate('G', 'Dan', i, until) === null, 'a place freed is taken');
  for (const n of ['Ada', 'Ben', 'Dan']) MM.releaseIronClaims('G', n);
  // The stairs: taken only at their start (I4), so a miner on its way holds nothing
  const s = level({ level: undefined, legs: [] });
  ok(MM.ironGate('S', 'Ada', s, until) === null && MM.ironGate('S', 'Ben', s, until) === null, 'walkers to the stairs both go down');
  ok(MM.takeIronStairs('S', 'Ada', until), 'the first at the start digs the stairs');
  ok(!MM.takeIronStairs('S', 'Ben', until), 'the second at the start waits');
  const st = MM.ironGate('S', 'Cal', s, until);
  ok(!!st && /stairs/.test(st), `a miner coming while they are dug is told (${st})`);
  MM.releaseIronClaims('S', 'Ada');
  ok(MM.ironGate('S', 'Cal', s, until) === null && MM.takeIronStairs('S', 'Ben', until), 'the stairs free once their digger lets go');
  for (const n of ['Ben', 'Cal']) MM.releaseIronClaims('S', n);
}

// The world's test of a deeper start (I4): a dug cell to start from, no air on the way down
{
  const old = level({ finished: 'x', dug: 320, legs: [leg(22, 0, 18, [1, 0], 120)] });
  const air = new Set<string>();
  const dig = (x: number, z: number) => { air.add(`${x},18,${z}`); air.add(`${x},19,${z}`); };
  dig(22, 0);
  for (const c of MM.legCells(old.legs[0])) dig(c.x, c.z);
  const world = (extra: string[] = []) => ({
    name: 'Ada', world: { villages: reg },
    bot: {
      world: { getColumn: () => null },
      blockAt: (p: { x: number; y: number; z: number }) => {
        const open = air.has(`${p.x},${p.y},${p.z}`) || extra.includes(`${p.x},${p.y},${p.z}`);
        return { name: open ? 'air' : 'stone', boundingBox: open ? 'empty' : 'block', position: p };
      },
    },
  }) as never;
  const lay = (a: never) => {
    const m = { top: { x: 0, z: 0 }, dir: [1, 0], steps: 10, level: 59, dug: 0, ended: [], got: {}, hut: { x1: -2, z1: -2, x2: 2, z2: 2 }, legs: [], iron: { ...old } } as unknown as Mine;
    MM.layNextIronLevel(reg, v, m, m.iron!, a);
    return m.iron!;
  };
  const n1 = lay(world());
  ok(n1.x === 22 && n1.z === 0 && n1.dir[1] === -1, `solid all the way: the bottom step, sideways (${n1.x},${n1.z} ${n1.dir})`);
  // A cave two steps down that way: the other side
  const n2 = lay(world(['22,17,-2']));
  ok(n2.x === 22 && n2.z === 0 && n2.dir[1] === 1, `air two steps down: not that way (${n2.x},${n2.z} ${n2.dir})`);
  // The bottom step not open (a record cell passed undug): a dug cell instead
  air.delete('22,18,0');
  const n3 = lay(world());
  ok(!(n3.x === 22 && n3.z === 0) && air.has(`${n3.x},18,${n3.z}`) && air.has(`${n3.x},19,${n3.z}`), `an undug cell is never a start (${n3.x},${n3.z})`);
}

// The next iron level: from the old one's bottom step, sideways, 12 below
{
  const old = level({ finished: '320 tunnel cells dug', dug: 320, got: { raw_iron: 17, coal: 9 }, legs: [leg(22, 0, 18, [1, 0], 120)] });
  const s = MM.ironDeeperStart(old, []);
  ok(!!s && s.x === 22 && s.z === 0 && s.y === 18 && s.dir[0] === 0, `starts at the bottom step, sideways (${JSON.stringify(s)})`);
  const tried = MM.ironDeeperStart(old, [{ x: s!.x, z: s!.z, y: 18, dir: s!.dir, steps: 3, why: 'water' }]);
  ok(!!tried && !(tried.x === s!.x && tried.z === s!.z && tried.dir[0] === s!.dir[0] && tried.dir[1] === s!.dir[1]), 'never the same way as stairs given up');
  const m = { top: { x: 0, z: 0 }, dir: [1, 0], steps: 10, level: 59, dug: 0, ended: [], got: {}, hut: { x1: -2, z1: -2, x2: 2, z2: 2 }, legs: [], iron: old } as unknown as Mine;
  const lightsBefore = MM.mineLights(m).length, areasBefore = MM.mineAreas(m).length;
  const note = MM.layNextIronLevel(reg, v, m, old);
  ok(!!note && m.iron !== old && m.ironPast?.[0] === old, `a new level is laid (${note})`);
  const n = m.iron!;
  ok(!n.finished && n.level === undefined && n.steps === 0 && n.targetY === 6, `unfinished, aimed at y 6 (${JSON.stringify({ t: n.targetY, f: n.finished })})`);
  ok(n.dug === 320 && n.dugAt === 320 && n.got.raw_iron === 17 && n.got !== old.got, '`dug` and `got` run on, the old record kept apart');
  ok(MM.mineAreas(m).length === areasBefore, 'the old level stays protected (its boxes kept)');
  ok(MM.mineLights(m).length === lightsBefore && MM.mineLights(m).every((q) => q.part.startsWith('mine:')), 'the old level keeps its torch spots');
  // Not again from an unfinished level, nor aimed below y -8, nor past four levels
  ok(MM.layNextIronLevel(reg, v, m, n) === '', 'an unfinished level lays nothing');
  Object.assign(n, { steps: 13, level: 2, legs: [leg(22, 13, 2, [0, 1], 50)], finished: 'every tunnel ended' });
  ok(MM.layNextIronLevel(reg, v, m, n) === '' && m.iron === n, 'no level aimed below y -8 (2 - 12)');
  const deep = { ...level({ level: 28, finished: 'x' }) };
  const m3 = { ...m, ironPast: [level(), level(), level()], iron: deep } as Mine;
  ok(MM.layNextIronLevel(reg, v, m3, deep) === '', 'four levels at most');
  const m2 = { ...m, ironPast: undefined, iron: level({ level: 28, finished: 'x' }) } as Mine;
  ok(!!MM.layNextIronLevel(reg, v, m2, m2.iron!) && m2.iron!.targetY === 16, `a level at y 28 is followed by one aimed at 16 (${m2.iron!.targetY})`);
}

console.log(`${failures ? 'FAILED' : 'OK'}: ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
