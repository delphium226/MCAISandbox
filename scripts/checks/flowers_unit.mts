/**
 * The flowers knowledge gap, offline (10-22): the planner gathers flowers, cactus and beetroot and plans dyes, stained
 * glass, concrete powder and coloured wool (white wool + a dye) from the commons, a dye from the flower storage holds
 * (wildflowers before the tall flowers nobody picked), green dye smelted from cactus; plans that use no dye unchanged;
 * the flowers library spec valid with its research block (dyeing), its skill registered.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/flowers_unit.mts
 */
import fs from 'node:fs';
import minecraftData from 'minecraft-data';
import { Materials } from '../../server/src/mineflayer/mcMaterials';
import { validateLibrarySpec } from '../../server/src/library';
import { FOUNDRY_SKILLS } from '../../server/src/mineflayer/foundry/list';
import { FLOWERS } from '../../server/src/mineflayer/foundry/flowers';

const reg = minecraftData('26.1');
const m = new Materials(reg);
let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};
const plan = (bill: Record<string, number>, have: Record<string, number> = {}) => m.plan(bill, have);
const gathers = (bill: Record<string, number>, have: Record<string, number> = {}) => plan(bill, have).gather;

// From the commons: what storage holds is used, nothing else gathered
const fromCommons = (item: string, have: Record<string, number>) => {
  const p = plan({ [item]: 1 }, have);
  const g = Object.keys(p.gather).filter((n) => n !== 'any:logs');
  ok(!g.length && !p.problems.length, `${item} from ${JSON.stringify(have)}: gathers ${JSON.stringify(p.gather)}, from stock ${JSON.stringify(p.fromStock)}`);
};
fromCommons('red_dye', { beetroot: 3 });
fromCommons('red_dye', { poppy: 2 });
fromCommons('yellow_dye', { wildflowers: 4 });
fromCommons('white_dye', { lily_of_the_valley: 1 });
fromCommons('magenta_dye', { lilac: 1 });
fromCommons('white_stained_glass', { lily_of_the_valley: 1, glass: 8 });
fromCommons('yellow_stained_glass', { wildflowers: 1, glass: 8 });
fromCommons('yellow_concrete_powder', { wildflowers: 1, sand: 4, gravel: 4 });
fromCommons('red_wool', { white_wool: 1, beetroot: 1 });
fromCommons('red_banner', { white_wool: 6, beetroot: 6, stick: 1 });

// Planned at all (with nothing held): dyes from flowers, green dye smelted from cactus, coloured wool from white wool
ok(!!gathers({ green_dye: 1 }).cactus && plan({ green_dye: 1 }).steps.some((s) => s.do === 'smelt' && s.item === 'green_dye'), 'green dye smelted from cactus');
ok(!!gathers({ red_banner: 1 }).white_wool && !gathers({ red_banner: 1 }).red_banner, `red banner planned (${JSON.stringify(gathers({ red_banner: 1 }))})`);
ok(!!gathers({ blue_wool: 1 }).white_wool, 'blue wool from white wool and a dye');
ok(plan({ yellow_dye: 1 }, { wildflowers: 4 }).fromStock.wildflowers === 1, 'yellow dye from the wildflowers held, not sunflowers');

// Plans that use no dye are as before
const same: Array<[string, Record<string, number>]> = [['torch', { 'any:logs': 2 }], ['oak_door', { oak_log: 2 }], ['bread', { wheat: 3 }], ['white_banner', { white_wool: 6, 'any:logs': 1 }], ['white_carpet', { white_wool: 2 }]];
for (const [item, g] of same) ok(JSON.stringify(gathers({ [item]: 1 })) === JSON.stringify(g), `${item} unchanged: ${JSON.stringify(gathers({ [item]: 1 }))}`);

// The library spec and the skill
const spec = JSON.parse(fs.readFileSync('server/library/flowers.json', 'utf8'));
ok(validateLibrarySpec(spec, { registry: reg, skills: new Set(['pick_flowers']) }).length === 0, `flowers.json valid: ${validateLibrarySpec(spec, { registry: reg, skills: new Set(['pick_flowers']) }).join('; ')}`);
ok(spec.research?.name === 'dyeing with flowers' && spec.research.goods.every((g: { item: string }) => !Object.keys(gathers({ [g.item]: 1 }, { wildflowers: 8, lily_of_the_valley: 4, lilac: 4, glass: 16 })).filter((n) => n !== 'any:logs').length), 'every research good plans from flowers and glass in the commons');
ok(FOUNDRY_SKILLS.some((f) => f.name === 'pick_flowers' && !!f.activity), 'pick_flowers registered with an activity');
ok(Object.keys(FLOWERS).every((f) => !!reg.blocksByName[f] && !!reg.itemsByName[f]), 'every flower is a block and an item');

console.log(`flowers_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
