/**
 * MC_OWN's share, offline (own.ts): what earns a share and what a wealth member can sell (the wealth monoculture, 10-23:
 * 25 members' own chests empty after 30 minutes). An iron trip and a gathering trip share their stone and coal, never the
 * iron, tools, seeds or emeralds; a make shares nothing; 25% of a trip's 19 andesite is 4 owed, its fraction kept; the
 * merchant buys the shared stone and coal; an emerald's barter value is still the food sales' (16).
 * Usage: MC_OWN=on node node_modules/tsx/dist/cli.mjs scripts/checks/own_share_unit.mts
 */
import { baseValue } from '../../server/src/barter';
import { OWN, OWN_GOODS, OWN_SALES, SHARED, earnShare } from '../../server/src/own';
import type { OwnStock } from '../../server/src/village';

let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};
if (!OWN.on) console.log('(MC_OWN is off: the share is 0.25 all the same)');
ok(SHARED.has('iron') && SHARED.has('gather') && !SHARED.has('make'), 'iron and gather trips share, makes do not');
// (Xavier's iron trip in W1: cobblestone, the stone kinds, coal and raw iron into the commons)
const own: OwnStock = { owed: {}, got: {}, used: {} };
const got = earnShare(own, { cobblestone: 132, andesite: 19, diorite: 14, granite: 9, stone: 4, coal: 5, raw_iron: 4, stone_pickaxe: 1, wheat_seeds: 20, emerald: 3 }, 0.25);
ok(got.andesite === 4 && got.diorite === 3 && got.granite === 2 && got.stone === 1 && got.coal === 1, `the stone and coal shared: ${JSON.stringify(got)}`);
ok(!got.raw_iron && !got.cobblestone && !got.stone_pickaxe && !got.wheat_seeds && !got.emerald, 'no iron, cobblestone, tools, seeds or emeralds');
ok(own.part?.andesite === 0.75 && own.part?.coal === 0.25, `fractions kept: ${JSON.stringify(own.part)}`);
ok(['coal', 'granite', 'andesite', 'diorite', 'stone', 'cod', 'wheat'].every((n) => OWN_SALES[n] > 0 && OWN_GOODS.has(n)), 'the merchant buys what is shared');
ok(Math.abs(baseValue('emerald') - 16.02) < 0.01, `an emerald is worth the food sales' 16.02 (${baseValue('emerald')})`);
console.log(`${fail ? 'FAIL' : 'PASS'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
