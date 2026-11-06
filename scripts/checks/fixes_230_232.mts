// Train 22's fixes (F356, runs/2026-11-05/train22/report.md), offline:
// #230 (MC_NIGHT_BAND): code's home band holds with beds while the nights run their length (a night past 800 ticks that
//   nobody slept away), until a night ends short again; the hunt keeps to its inner ring then. Off by its flag.
// #231: the hunt's offer and its start agree: offered above 14, it starts within 3 below that after healing, so a member
//   offered the hunt at 15 and hit once before the start (train 22: 61 of 68 picks failed at 11-14) still goes.
// #232: the stone stage's ballot: its "no" and its frame name towers on the standing ring, not "a wall" again.
// #225 follow-up (MC_GRAVEL_TRIPS): the flint trip's gravel from the atlas (dry gravel cells), on the village's side of open
//   water, a spot that gave none passed over; no trip offered when no gravel is to be had.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/fixes_230_232.mts
import { execFileSync } from 'node:child_process';

process.env.MC_WORLD_MODE ??= 'hostile';
if (process.env.MODE_CHILD) {
  const C = await import('../../server/src/mineflayer/mcCombat');
  const box = { x1: 0, z1: 0, x2: 60, z2: 60 };
  const v = { layouts: [{ ...box, buildings: [] }], structures: [] } as never;
  C.resetNights();
  C.nightsRun(13400);
  console.log(JSON.stringify({ on: C.nightBandOn(), beds: C.codeBand(v, true, 13400) !== null, none: C.codeBand(v, false, 13400) !== null }));
} else {
  const C = await import('../../server/src/mineflayer/mcCombat');
  let fails = 0;
  const ok = (cond: unknown, what: string) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
    if (!cond) fails++;
  };
  // (each fix's section on its own: an error in one, as on the old code, fails it and the others still run)
  const sec = async (name: string, f: () => Promise<void> | void) => {
    try { await f(); } catch (e) { ok(false, `${name}: ${(e as Error).message}`); }
  };

  await sec('#230', async () => {
  // ---- #230 ------------------------------------------------------------------------------------------------------
  const box = { x1: 0, z1: 0, x2: 60, z2: 60 }, home = { x: 30, y: 64, z: 30 };
  const v = { layouts: [{ ...box, buildings: [] }], structures: [] } as never;
  ok(C.nightBandOn(), 'MC_NIGHT_BAND on by default with monsters');
  C.resetNights();
  // (no bed: the band holds as before, #194)
  ok(C.codeBand(v, false, 6000)?.code === true && !C.codeBand(v, false, 6000)?.beds, 'no bed: home by dusk as before');
  // (beds, a night a sleeper ends: no band, the trips go on)
  ok(C.codeBand(v, true, 11500) === null && C.codeBand(v, true, 12600) === null, 'beds, before any night ran: no band at dusk or nightfall');
  ok(C.codeBand(v, true, 13000) === null, 'beds, 459 ticks into the night: still none (a sleeper ends it in 5-35 s)');
  C.codeBand(v, true, 200);
  ok(C.codeBand(v, true, 11500) === null, 'a night slept away short: none at the next dusk');
  // (beds, train 22's nights: one runs on past 800 ticks)
  const b = C.codeBand(v, true, 13400);
  ok(b?.code && b.beds && C.curfewActs(13400, b.phase), 'beds, a night under way 859 ticks after nightfall: the band holds (train 22)');
  ok(b && C.pastBand(b, home, 120, 30) && !C.pastBand(b, home, 70, 30), "the band: the built bounds + 16 (a death 126 out lies past it)");
  ok(/run their length/.test(C.bandWords(b!)) && !/no member has a bed/.test(C.bandWords(b!)), "its words: the nights run, not 'no bed'");
  ok(C.codeBand(v, true, 100) !== null && C.curfewActs(100, 'dusk'), 'after that night, at dawn: the band and its dawn tail hold');
  ok(C.codeBand(v, true, 6000) !== null && !C.curfewActs(6000, 'dusk'), 'by day the band is there but does not act (curfewActs)');
  ok(C.codeBand(v, true, 10200) !== null && C.curfewActs(10200, 'dusk'), 'the next dusk: the band acts from its lead, before dark');
  C.codeBand(v, true, 12700);
  C.codeBand(v, true, 300);
  ok(C.codeBand(v, true, 11500) === null, 'a night slept away again: the band lifts');
  // (the hunt)
  C.resetNights();
  C.codeBand(v, true, 13400);
  const band = C.codeBand(v, true, 13400);
  ok(C.huntWide(true, null) && !C.huntWide(true, band) && !C.huntWide(false, null), 'the hunt walks the wide rings (bounds + 48) only with beds and no code band');
  ok(C.huntRings(box, C.huntWide(true, band)).every((q) => !C.pastBand(band!, home, q.x, q.z)), "with nights that run, every spot of the hunt's ring lies inside the band");
  ok(C.huntRings(box, C.huntWide(true, null)).some((q) => C.pastBand(band!, home, q.x, q.z)), '(the wide rings would lie past it)');
  const child = (extra: Record<string, string>) => JSON.parse(execFileSync(process.execPath, [...process.execArgv, new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], {
    env: { ...process.env, MODE_CHILD: '1', ...extra }, encoding: 'utf-8',
  }).trim().split('\n').pop()!);
  const off = child({ MC_WORLD_MODE: 'hostile', MC_NIGHT_BAND: 'off' }), peace = child({ MC_WORLD_MODE: 'peaceful' });
  ok(!off.on && !off.beds && off.none, 'MC_NIGHT_BAND=off: with beds no band (the old rule), without beds the band');
  ok(!peace.on && !peace.beds, 'peaceful: no night band');

  });
  await sec('#231', async () => {
  // ---- #231 ------------------------------------------------------------------------------------------------------
  ok(C.huntOffered(15) && !C.huntOffered(14), 'the menu offers the hunt above 14');
  ok(C.huntStart(15) === 'go' && C.huntStart(13) === 'heal' && C.huntStart(12) === 'heal' && C.huntStart(11) === 'no', 'it starts at once above 14, heals first at 12-14, not at 11');
  let agree = true;
  for (let h = 1; h <= 20; h++) if (C.huntOffered(h) && C.huntStart(h - C.HUNT_SLACK) === 'no') agree = false;
  ok(agree, 'any member offered the hunt still starts it after losing up to 3 health (a hit or a stale menu)');
  ok(C.huntStart(11) === 'no' && C.HUNT_HEALTH - C.HUNT_SLACK > C.HUNT_LOW, "the start's floor stays above the give-up (health 10)");

  });
  await sec('#232', async () => {
  // ---- #232 ------------------------------------------------------------------------------------------------------
  const B = await import('../../server/src/wallBallot');
  const Vt = await import('../../server/src/vote');
  const ring = B.noneOption('wall:no'), towers = B.noneOption('wall:no', 'towers');
  ok(ring.name === 'No wall for now', "the ring's ballot: 'No wall for now' as before");
  ok(towers.id === 'wall:no' && !/wall for now/i.test(towers.name) && /tower/i.test(towers.name) && /ring stays/.test(towers.facts), "the stone stage's 'no': no towers, the ring stays");
  const st = B.stageOption({ id: 'castle:yes', kind: 'towers', cells: 0, parts: 21, bill: { stone: 2672 }, water: 'dammed', towers: 20, gatehouses: 1 }, 2);
  const ctx = { persona: '', pattern: '', self: '', village: 'V: 13 members' };
  const pt = Vt.buildBallot({ ...ctx, stage: 'towers' }, [st, towers], 'wall');
  ok(!/a wall round the village|defensive wall round/i.test(pt.system + pt.user), 'the stone-stage ballot never asks for a wall round the village');
  ok(/already stands/.test(pt.system) && /towers and gatehouses on the fence wall/.test(pt.user), 'its frame: the fence wall stands, the vote is on towers and gatehouses');
  const pr = Vt.buildBallot(ctx, [B.stageOption({ id: 'wall:yes', kind: 'ring', cells: 692, parts: 29, bill: { cobblestone: 692, logs: 289 }, water: 'dammed' }, 2), ring], 'wall');
  ok(/a wall round the village/.test(pr.user) && /defensive wall/.test(pr.system), "the ring's ballot unchanged");

  });
  await sec('#225 gravel', async () => {
  // ---- #225 follow-up: the flint trip's gravel ----------------------------------------------------------------------
  const S = await import('../../server/src/mineflayer/mcSandTrips');
  const F = await import('../../server/src/mineflayer/mcFlint');
  // (a fake atlas: chunk cells by letter; home at 8,8)
  const chunk = (cx: number, cz: number, letters: string, gravel: number, sand = 0) => ({ cx, cz, t: 0, by: '', y: [60, 62, 64] as [number, number, number], flat: 0, water: 0, lava: 0, logs: {}, low: {}, surface: { gravel, sand }, h: Array(16).fill(63), s: letters });
  const grass = 'o'.repeat(16), water = '~'.repeat(16);
  const atlas = (cs: ReturnType<typeof chunk>[]) => ({ near: () => cs });
  const h0 = { x: 8, z: 8 };
  const gNear = chunk(5, 0, 'gggg' + 'o'.repeat(12), 30), gFar = chunk(12, 0, 'g'.repeat(16), 200), gWet = chunk(-8, 0, 'g'.repeat(16), 200);
  const A1 = atlas([chunk(0, 0, grass, 0), gNear, gFar, gWet, ...[-1, -2, -3, -4, -5, -6, -7].map((cx) => chunk(cx, 0, water, 0))]);
  const s1 = S.gravelSpot(A1, h0, new Set());
  ok(s1 && s1.x >= 80 && s1.x < 96 && s1.z < 16 && s1.dist < 100, `the nearest dry gravel cell: ${s1?.x},${s1?.z} (${s1?.dist} blocks)`);
  const s2 = S.gravelSpot(A1, h0, new Set(['82,2', '86,2', '90,2', '94,2']));
  ok(s2 && s2.x >= 192, `a spot that gave none passed over: the next, ${s2?.x},${s2?.z}`);
  ok(S.gravelSpot(atlas([chunk(0, 0, grass, 0), gWet, ...[-1, -2, -3, -4, -5, -6, -7].map((cx) => chunk(cx, 0, water, 0))]), h0, new Set()) === null, 'never across open water');
  ok(S.gravelSpot(atlas([chunk(20, 0, 'g'.repeat(16), 200)]), h0, new Set()) === null, 'never past the range (256)');
  ok(S.gravelSpot(atlas([chunk(3, 0, 'g' + 'o'.repeat(15), 2)]), h0, new Set()) === null, 'not a chunk with under 4 gravel columns');
  ok(S.sandSpot(atlas([chunk(7, 0, 's'.repeat(16), 0, 100), gFar]), h0, 96, new Set())?.x === 114, 'the sand expeditions unchanged (sandSpot)');
  const spot = { x: 82, y: 63, z: 2, dist: 74, key: '82,2' };
  ok(F.gravelSource(5, true, null, null) === 'store' && F.gravelSource(0, false, null, null) === 'near', 'stored gravel first; near home while it has not run out');
  ok(F.gravelSource(0, true, spot, null) === 'far' && F.gravelSource(0, true, spot, 'only in the morning') === null && F.gravelSource(0, true, null, null) === null, 'run out near home: the atlas spot, or no trip at all');
  ok(!F.gravelOut('GV', 0) && (F.noteGravelOut('GV', 0), F.gravelOut('GV', 1000)) && !F.gravelOut('GV', F.GRAVEL_OUT_MS + 1), 'the near gravel counts as out for 30 minutes after a trip found none');
  ok(S.GRAVEL_TRIPS.on, 'MC_GRAVEL_TRIPS on by default');

  });
  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
}
