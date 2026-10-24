// #102, offline: a make from the village storage that makes nothing says what is short and how to make it, and the
// forge (make_iron_tool) makes a tool its smith already carries one of. Long4 (F294): all 13 "cannot be made" forges
// were by a member carrying the tool it forged (given to it earlier), which the plan counted as the one to make, with
// 142 ingots and 188 logs in storage; the message named only the ingots and fuel.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/make_short.mts
import minecraftData from 'minecraft-data';
import { Materials } from '../../server/src/mineflayer/mcMaterials';
import { makeShortfall, onHand } from '../../server/src/mineflayer/mcBuild';

const m = new Materials(minecraftData('26.1') as never);
let bad = 0;
const check = (what: string, ok: boolean, detail: string) => {
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${detail}`);
};

// Long4's case: Uma carries an iron_hoe (given at 138.9m) and forges one for Tess at 139.1m
const store = { iron_ingot: 142, birch_log: 188, oak_log: 52, coal: 2, charcoal: 4 };
const carried = { iron_hoe: 1, iron_pickaxe: 1 };
const old = m.plan({ iron_hoe: 1 }, onHand(carried, store, {}));
check('Long4 reproduced (carried tool unreserved)', old.steps.length === 0 && (old.fromStock.iron_hoe ?? 0) === 1, `steps ${old.steps.length}, from stock ${JSON.stringify(old.fromStock)}`);
const fixed = m.plan({ iron_hoe: 1 }, onHand(carried, store, { iron_hoe: carried.iron_hoe }));
check('the forge reserves the carried tool', fixed.steps.some((s) => s.item === 'iron_hoe') && !Object.keys(fixed.gather).length, `steps ${fixed.steps.map((s) => `${s.do} ${s.makes} ${s.item}`).join(', ')}`);
const was = makeShortfall(m, { iron_hoe: 1 }, onHand(carried, store, {}));
check('the unreserved case says the tool is in hand', /already in hand/.test(was), was);

// The issue's own case: ingots plentiful, no logs, planks or sticks: the message names the logs and the chain
const noWood = makeShortfall(m, { iron_pickaxe: 1 }, onHand({}, { iron_ingot: 142, coal: 2, charcoal: 4 }, {}));
check('short of wood: names logs and sticks', /logs/.test(noWood) && /stick/.test(noWood) && !/iron_ingot/.test(noWood.split(';')[0]), noWood);

// Not enough ingots, no raw iron: the message names the iron and the smelting
const noIron = makeShortfall(m, { iron_pickaxe: 1 }, onHand({}, { iron_ingot: 1, stick: 4 }, {}));
check('short of iron: names raw_iron and the smelt', /raw_iron/.test(noIron) && /smelt/.test(noIron), noIron);

// smelt_iron: ingots wanted, raw iron short
const smelt = makeShortfall(m, { iron_ingot: 5 }, onHand({}, { raw_iron: 2, coal: 3 }, {}));
check('smelt_iron short of raw iron', /3 raw_iron/.test(smelt), smelt);

console.log(bad ? `MAKE_SHORT ${bad} FAILED` : 'MAKE_SHORT ok');
process.exit(bad ? 1 : 0);
