/**
 * G8's iron age (MC_IRON_AGE), offline: the iron level's per-leg claims, the miners' gate and the next iron levels, on
 * stub records (no world). Run:
 *   npx tsx scripts/checks/iron_legs_unit.mts
 * claimIronLeg (a leg per miner, turns when every leg going is held, 'busy', null when every tunnel ended, lapsed holds
 * freed), ironGate (IRON_MINERS at once, the stairs one at a time), ironDeeperStart and layNextIronLevel (12 below, three
 * levels at most, never aimed below y 0; `dug` and `got` run on), and mineAreas / mineLights over finished levels.
 */
process.env.MC_IRON_AGE = 'on';
const ORE = process.env.MC_ORE_MINE === 'on';
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

// (the iron age's checks with MC_ORE_MINE off; the ore mine's in a second run with it on, below)
if (!ORE) {
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
    // #256, MC_MINE_LANES: a village sized for five miners lets five down and tells the sixth; the sizing follows members
    {
      const LF = await import('../../server/src/ladderFlags');
      ok(LF.ironMinersFor(25) === (LF.MINE_LANES ? 5 : 3) && LF.ironMinersFor(4) === 3 && LF.ironMinersFor(200) === (LF.MINE_LANES ? 8 : 3), `miners by members (${LF.ironMinersFor(25)} at 25, ${LF.ironMinersFor(200)} at 200)`);
      MM.setIronMiners('G5', 5);
      const names = ['Ada', 'Ben', 'Cal', 'Dan', 'Eve'];
      ok(names.every((n) => MM.ironGate('G5', n, i, until) === null), 'five miners go down on a level sized for five');
      const sixth = MM.ironGate('G5', 'Fay', i, until);
      ok(!!sixth && /five miners/.test(sixth), `a sixth is told (${sixth})`);
      ok(!!MM.ironLevelFull('G5', 'Fay') && !MM.ironLevelFull('G5', 'Ada'), 'the menus read the level full for a sixth, not for one of the five');
      for (const n of names) MM.releaseIronClaims('G5', n);
    }
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

  // #113: stairs no bot gets to are given up for fresh starts (dug cells of the mine only), 8 a round, then the level
  // waits 30 minutes and is tried again, the unreached starts forgotten
  {
    const L = 50;
    const cob: MineLeg = { x: 9, z: 0, y: L, dir: [1, 0], dug: 78, main: 30, br: { 1: 12, 2: 12, 4: 12, 5: 12 }, ended: [] };
    const air = new Set<string>();
    for (const c of [{ x: 9, z: 0 }, ...MM.legCells(cob)]) { air.add(`${c.x},${L},${c.z}`); air.add(`${c.x},${L + 1},${c.z}`); }
    const a = {
      name: 'Ada', world: { villages: reg },
      bot: { world: { getColumn: () => null }, blockAt: (p: { x: number; y: number; z: number }) => { const o = air.has(`${p.x},${p.y},${p.z}`); return { name: o ? 'air' : 'stone', boundingBox: o ? 'empty' : 'block', position: p }; } },
    } as never;
    const m = { top: { x: 0, z: 0 }, dir: [1, 0], steps: 10, level: L, dug: 78, ended: [], got: {}, hut: { x1: -2, z1: -2, x2: 2, z2: 2 }, legs: [cob] } as unknown as Mine;
    const s0 = MM.ironStart(m)!;
    m.iron = { x: s0.x, z: s0.z, y: s0.y, dir: s0.dir, steps: 0, legs: [], dug: 0, got: {} };
    const i = m.iron;
    const starts = new Set<string>([`${i.x},${i.z},${i.dir}`]);
    let n = 0;
    for (; n < 12 && !i.finished; n++) {
      MM.giveUpIronStairs(a, v, m, i, `could not get to the iron stairs at ${i.x},${i.y},${i.z}`);
      if (i.finished) break;
      ok(air.has(`${i.x},${L},${i.z}`), `fresh start ${n + 1} is a dug cell (${i.x},${i.z})`);
      ok(!starts.has(`${i.x},${i.z},${i.dir}`), `fresh start ${n + 1} is new (${i.x},${i.z} ${i.dir})`);
      starts.add(`${i.x},${i.z},${i.dir}`);
    }
    ok(i.finished && /no way down/.test(i.finished) && (i.abandoned?.length ?? 0) === 8, `finished after 8 starts (${i.abandoned?.length}: ${i.finished})`);
    const r = i as IronLevel & { retryAt?: number; triesFrom?: number };
    ok(r.retryAt !== undefined && Math.abs(r.retryAt - Date.now() - 30 * 60000) < 5000, 'a retry in 30 minutes');
    ok(MM.ironDone(m) && !MM.ironDone(m, Date.now() + 31 * 60000), 'finished for the menus until the retry time, then offered again');
    MM.ironRetry(v, m, i, reg, Date.now() + 10 * 60000);
    ok(!!i.finished, 'no retry before its time');
    MM.ironRetry(v, m, i, reg, Date.now() + 31 * 60000);
    ok(!i.finished && r.retryAt === undefined && (i.abandoned ?? []).every((d) => d.steps > 0) && r.triesFrom === (i.abandoned ?? []).length, 'at its time: open again, the unreached starts forgotten, a fresh round');
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
    // (the user's 10-28: no level below it, so a new shaft at a free height, never below y -8; new_shaft.mts)
    const below = MM.layNextIronLevel(reg, v, m, n);
    ok(m.iron === n ? below === '' : /new shaft/.test(below) && m.iron!.targetY! >= -8, `no level aimed below y -8 (2 - 12): ${below || 'none'}`);
    const deep = { ...level({ level: 28, finished: 'x' }) };
    const m3 = { ...m, ironPast: [level(), level(), level()], iron: deep } as Mine;
    ok(/new shaft/.test(MM.layNextIronLevel(reg, v, m3, deep)) && (m3.iron as IronLevel & { from?: number }).from !== undefined, 'four levels at most in a shaft: a new shaft');
    const m2 = { ...m, ironPast: undefined, iron: level({ level: 28, finished: 'x' }) } as Mine;
    ok(!!MM.layNextIronLevel(reg, v, m2, m2.iron!) && m2.iron!.targetY === 16, `a level at y 28 is followed by one aimed at 16 (${m2.iron!.targetY})`);
  }
}

// MC_ORE_MINE: drifts to the iron seen, turns toward it, next levels where it is thicker, the mine's bound
if (ORE) {
  // A level whose one tunnel has dug its first 3 main cells (x 23-25 at z 0), iron seen 6 off the last of them
  const lvl = (seen: Array<[number, number, number]>, extra: Partial<IronLevel> = {}) => ({ ...level({ legs: [leg(22, 0, 18, [1, 0], 3)] }), seen, ...extra }) as IronLevel;
  const d = MM.oreDrift(lvl([[25, 18, 6]]));
  ok(!!d && d.leg.x === 25 && d.leg.z === 0 && d.leg.dir[0] === 0 && d.leg.dir[1] === 1 && d.len === 6, `a drift straight to it from the nearest dug cell (${JSON.stringify(d && { ...d.leg, len: d.len })})`);
  ok(!!d && d.leg.br && Object.keys(d.leg.br).length === 0 && MM.legCells(d.leg).length === 0, 'kept per part: main cells only');
  ok(MM.oreDrift(lvl([[25, 18, 6]]), () => false) === null, 'never from a cell the world shows undug');
  ok(MM.oreDrift(lvl([[25, 12, 6]])) === null, 'iron at a height the level cannot take: no drift');
  ok(MM.oreDrift(lvl([[25, 18, 30]])) === null, `iron beyond ${12} cells: no drift`);
  ok(MM.oreDrift(lvl([[24, 18, 5], [25, 19, 3]]))?.len === 3, 'the nearest first');
  ok(MM.oreDrift(lvl([[25, 20, 6]]))?.len === 6, 'in line at the ceiling\'s height: taken over the cell');
  ok(MM.oreDrift(lvl([[26, 20, 6]])) === null, 'a column off at the ceiling\'s height (no cell takes it): no drift');

  // claimIronLeg: a drift before the tunnel's next cell; its iron left to it
  const i = lvl([[25, 18, 6]]);
  const A = MM.claimIronLeg(bot('Ada'), v, i);
  ok(A && A !== 'busy' && MM.isDrift(i, A as MineLeg), 'the first miner drifts to the iron seen');
  const B = MM.claimIronLeg(bot('Ben'), v, i);
  ok(B === i.legs[0], 'the next takes the tunnel: the iron is the drift\'s');
  ok(MM.claimIronLeg(bot('Ada'), v, i) === A, 'a drifter keeps its drift');
  MM.releaseIronClaims(v.name, 'Ada');
  MM.releaseIronClaims(v.name, 'Ben');
  // A miner on a tunnel lets it go for a new drift
  const j = lvl([]);
  ok(MM.claimIronLeg(bot('Cal'), v, j) === j.legs[0], 'no iron seen: the tunnel');
  (j as IronLevel & { seen: unknown[] }).seen = [[25, 18, -5]];
  const C = MM.claimIronLeg(bot('Cal'), v, j);
  ok(C && C !== 'busy' && MM.isDrift(j, C as MineLeg) && (C as MineLeg).dir[1] === -1, 'iron seen: the tunnel let go for a drift to it');
  ok(MM.claimIronLeg(bot('Dan'), v, j) === j.legs[0], 'and the tunnel free for another');
  MM.releaseIronClaims(v.name, 'Cal');
  MM.releaseIronClaims(v.name, 'Dan');
  // Turns toward the iron: the side its line passes
  const t = lvl([[22, 18, 14], [23, 18, 20]], { legs: [leg(22, 0, 18, [1, 0], 3, 'water')] });
  const T = MM.claimIronLeg(bot('Eve'), v, t);
  ok(T && T !== 'busy' && (T as MineLeg).dir[1] === 1, `the turn toward the iron seen (${T && T !== 'busy' ? (T as MineLeg).dir : T})`);
  MM.releaseIronClaims(v.name, 'Eve');

  // The next level: 6 below, or deeper where the iron is thicker, toward it
  ok(MM.oreNextLevel(level())?.y === 12 && !MM.oreNextLevel(level())?.toward, 'nothing seen: 6 below');
  const thick = MM.oreNextLevel(level({ ...({ seen: Array.from({ length: 8 }, (_, k) => [40 + k, 1, 10] as [number, number, number]) } as object) }));
  ok(!!thick && thick.y <= 2 && thick.y >= -1 && thick.toward?.x === 44 && thick.toward?.z === 10, `iron thick at y 1: the level there, toward it (${JSON.stringify(thick)})`);
  const atl = MM.oreNextLevel(level(), [{ cx: 3, cz: -2, ores: { iron: [12, 4, 6] } }]);
  ok(!!atl && atl.y <= 6 && atl.y >= 2 && atl.toward?.x === 56 && atl.toward?.z === -24, `the atlas' iron in caves counts too (${JSON.stringify(atl)})`);
  ok(MM.oreNextLevel(level({ level: -4 })) === null, 'none below y -8');
  const m = { top: { x: 0, z: 0 }, dir: [1, 0], steps: 10, level: 59, dug: 0, ended: [], got: {}, hut: { x1: -2, z1: -2, x2: 2, z2: 2 }, legs: [] } as unknown as Mine;
  const old = level({ finished: 'x', dug: 500, legs: [leg(22, 0, 18, [1, 0], 120)], ...({ seen: [[30, 14, 30]] } as object) });
  const m1 = { ...m, iron: old } as Mine;
  ok(!!MM.layNextIronLevel(reg, v, m1, old) && m1.iron!.targetY === 12 && (m1.iron as IronLevel & { aboveY?: number; seen?: unknown[] }).aboveY === 18 && (m1.iron as IronLevel & { seen?: unknown[] }).seen?.length === 1,
    `laid 6 below, the level above and the iron seen kept (${JSON.stringify({ t: m1.iron!.targetY })})`);
  const full = level({ finished: 'x', dug: 8000 });
  // (a shaft's 8,000 cells or ten levels: no next level in it; a new shaft instead, the user's 10-28, new_shaft.mts)
  const mf = { ...m, iron: full } as Mine;
  ok(/new shaft/.test(MM.layNextIronLevel(reg, v, mf, full)) && (mf.iron as IronLevel & { shaftAt?: number }).shaftAt === 8000, 'the shaft\'s 8,000 cells: a new shaft, its count from there');
  const m9 = { ...m, ironPast: Array.from({ length: 9 }, () => level()), iron: level({ finished: 'x', level: 28 }) } as Mine;
  ok(/new shaft/.test(MM.layNextIronLevel(reg, v, m9, m9.iron!)) && (m9.iron as IronLevel & { from?: number }).from !== undefined, 'ten levels at most in a shaft: a new shaft');

  // The torches' wait: a drift's next cell is its next main cell
  const dl = MM.oreDrift(lvl([[25, 18, 6]]))!.leg;
  const md = { ...m, iron: { ...level({ legs: [dl] }), drifts: [[0, 6]] } } as unknown as Mine;
  ok(MM.mineFacesGoing(md).some((f) => f.x === 25 && f.z === 1 && f.y === 19), 'a drift\'s face is its next main cell');

  // MC_IRON_STAIRS2 (#101, in this run too): the second lane's shape, protection, torches and faces, and its own lock
  {
    const two = { ...level({ steps: 9, legs: [] }), dir: [0, 1] as [number, number], x: 0, z: 0, y: 40, lane: [1, 0] as [number, number], steps2: 9 } as IronLevel;
    const cols = MM.laneColumns(two as never);
    ok(cols.length === 9 && cols.every((c, k) => c.x === 1 && c.z === k + 1), `the second lane: the first's columns one block over (${JSON.stringify(cols.slice(0, 2))})`);
    const mm = { ...m, iron: two } as Mine;
    const box = MM.mineAreas(mm).find((b) => b.y2 === 42)!;
    ok(!!box && box.x1 === -1 && box.x2 === 2, `the stairs' box takes in the second lane and a block around (${box?.x1}..${box?.x2})`);
    const spots = MM.mineLights(mm).filter((q) => q.x === 1);
    ok(spots.length === 1 && spots[0].z === 7 && spots[0].sides.length === 1 && spots[0].sides[0].support[0] === 2, `a torch on the second lane's outer wall at step 7 (${JSON.stringify(spots)})`);
    const behind = { ...two, level: undefined, steps2: 4 } as IronLevel;
    ok(MM.mineFacesGoing({ ...m, iron: behind } as Mine).some((f) => f.x === 1 && f.z === 5), 'the second lane\'s next step is a face while it is behind');
    // One digger a lane: the first takes the stairs, a second the other lane, a third waits
    const until = Date.now() + 60000;
    const s = level({ level: undefined, legs: [] });
    ok(MM.ironGate('L', 'Ada', s, until) === null && MM.takeIronStairs('L', 'Ada', until), 'the first digs the first lane');
    ok(MM.ironGate('L', 'Ben', s, until) === null && MM.takeIronLane2('L', 'Ben', until), 'a second comes in for the second lane');
    const st = MM.ironGate('L', 'Cal', s, until);
    ok(!!st && /stairs/.test(st) && !MM.takeIronLane2('L', 'Cal', until), `a third waits: both lanes held (${st})`);
    MM.releaseIronClaims('L', 'Ben');
    ok(MM.ironGate('L', 'Cal', s, until) === null && MM.takeIronLane2('L', 'Cal', until), 'the second lane free again for the next');
    for (const n of ['Ada', 'Cal']) MM.releaseIronClaims('L', n);
  }
}

// The ore mine's and the two-lane stairs' checks, in a second run with the flags on (the flags are read once, at import)
if (!ORE) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/checks/iron_legs_unit.mts'], { env: { ...process.env, MC_ORE_MINE: 'on', MC_IRON_STAIRS2: 'on' }, encoding: 'utf-8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  for (const l of out.split('\n')) if (l.startsWith('FAIL')) console.log(`${l} (MC_ORE_MINE)`);
  const n = /: (\d+)\/(\d+) checks/.exec(out);
  ok(!!n && n[1] === n[2], `the MC_ORE_MINE run (${n ? `${n[1]}/${n[2]}` : out.slice(-300)})`);
  if (n) checks += Number(n[2]) - 1, failures += Number(n[2]) - Number(n[1]) - (n[1] === n[2] ? 0 : 1);
}

console.log(`${failures ? 'FAILED' : 'OK'}: ${checks - failures}/${checks} checks`);
process.exit(failures ? 1 : 0);
