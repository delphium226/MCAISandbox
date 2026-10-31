/**
 * Offline checks for train 15's fixes (#190-#192). Run:
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/fixes_190_192.mts
 * #190: civicKit leaves a kiln smaller than the new record's own (and its lodge) behind, keeps the quarries, and hands
 * on a kiln big enough. #191: the first iron give-up with no other start found waits IRON_START_RETRY_MS (5 min), twice
 * a level, then 30. #192: "right where you asked" dropped when a street's range of distances runs past 15 blocks.
 */
process.env.MC_IRON_AGE = 'on';
process.env.MC_CIVIC = 'on';
import type { IronLevel, Mine, Village } from '../../server/src/village';
const C = await import('../../server/src/civic');
const MM = await import('../../server/src/mineflayer/mcMine');
const T = await import('../../server/src/playerTalk');

let fails = 0;
function ok(cond: unknown, what: string) {
  if (!cond) {
    fails++;
    console.log(`FAIL ${what}`);
  } else console.log(`ok   ${what}`);
}

// #190
{
  const kiln = { furnaces: [{}, {}, {}, {}], state: 'ready' };
  const kitV = () => ({ name: 'P1', civics: [{ preset: 'pembridge_market', kit: { kiln, lodge: { state: 'ready' }, quarry: { q: 1 } } }] }) as unknown as Village;
  const small = C.civicKit(kitV(), 15);
  ok(!small.kiln && !small.lodge && !!small.quarry, `a 4-furnace kiln is left for a record wanting 15; the quarry goes on (${Object.keys(small).join(',')})`);
  const fits = C.civicKit(kitV(), 4);
  ok(fits.kiln === kiln && !!fits.lodge, 'a kiln of the size wanted goes on with its lodge');
  ok(C.civicKit(kitV()).kiln === kiln, 'no size given: the kit as before');
}

// #191
{
  const notes: string[] = [];
  const reg = { note: (_v: Village, s: string) => void notes.push(s), save: () => undefined };
  const bot = { name: 'Ada', world: { villages: reg } } as unknown as Parameters<typeof MM.giveUpIronStairs>[0];
  const v = { name: 'P1' } as unknown as Village;
  const i = { x: -1610, z: 34, y: 57, dir: [1, 0], steps: 0, legs: [], dug: 0, got: {} } as unknown as IronLevel;
  const m = { iron: i } as unknown as Mine;
  const waits: number[] = [];
  for (let n = 0; n < 3; n++) {
    const t0 = Date.now();
    MM.giveUpIronStairs(bot, v, m, i, 'air over -1610,58,35 (no solid ceiling)');
    const r = i as IronLevel & { retryAt?: number };
    waits.push(Math.round(((r.retryAt ?? 0) - t0) / 60000));
    MM.ironRetry(v, m, i, reg, (r.retryAt ?? 0) + 1);
  }
  ok(waits[0] === 5 && waits[1] === 5 && waits[2] === 30, `no other start found: 5, 5, then 30 minutes (${waits.join(', ')})`);
}

// #192
{
  const street = 'a street of houses for the 15 members without one (asked 10 min ago): finished 1 min ago; south of the village, ~20 blocks, 5 buildings ~10-95 blocks from the place asked';
  const o = T.answerLine('Your house was completed just a minute ago, right where you asked', street);
  ok(!/right where/i.test(o), `train 15's O line loses its claim: ${o}`);
  const close = T.answerLine('Your house stands right where you asked.', 'finished 2 min ago; 3 buildings ~4-12 blocks from the place asked');
  ok(/right where you asked/.test(close), `kept when the whole range is within 15: ${close}`);
}

console.log(fails ? `FIXES 190-192 FAIL (${fails})` : 'FIXES 190-192 OK');
process.exit(fails ? 1 : 0);
