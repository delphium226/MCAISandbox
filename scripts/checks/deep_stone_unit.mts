/**
 * MC_DEEP_STONE offline (#162 tier 3, chain A; mcMaterials' CUT_GATHER, mcMine's deepLevel; no server):
 * - with the flag and `cut`, deepslate tiles, tile stairs and tuff bricks are cut 1:1 from gathered cobbled deepslate and
 *   tuff (no table crafting, nothing smelted);
 * - without the flag cobbled deepslate is not a gathered stone (the plan as before);
 * - the deep level: none above y 0 with no level below in reach, the next level when it is (G1: 8 -> -4), the current
 *   one when at or below 0.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/deep_stone_unit.mts (sets MC_DEEP_STONE itself)
 */
process.env.MC_DEEP_STONE = 'on';
process.env.MC_IRON_AGE = 'on';
const { default: minecraftData } = await import('minecraft-data');
const { Materials } = await import('../../server/src/mineflayer/mcMaterials');
const { deepLevel, deepenForStone } = await import('../../server/src/mineflayer/mcMine');
const { fullBlock, deepStandIn, standIn } = await import('../../server/src/monument');
import type { Mine } from '../../server/src/village';

const reg = minecraftData('26.1');
let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  FAIL ${msg}`); };

// Notre-Dame 1:3's low roof and plinth (bills.mts: ~234 tiles and stairs, 109 tuff bricks)
const want = { deepslate_tile_stairs: 200, deepslate_tiles: 34, tuff_bricks: 109 };
const p = new Materials(reg, { cut: true }).plan(want, { cobbled_deepslate: 75 });
for (const [item, input] of [['deepslate_tile_stairs', 'cobbled_deepslate'], ['deepslate_tiles', 'cobbled_deepslate'], ['tuff_bricks', 'tuff']]) {
  const st = p.steps.find((s) => s.item === item);
  if (!st?.cut || st.input !== input) fail(`${item} not cut from ${input}: ${JSON.stringify(st)}`);
}
if (p.steps.some((s) => s.do === 'smelt')) fail('smelting in a deep stone plan');
if (p.gather.cobbled_deepslate !== 234 - 75) fail(`cobbled deepslate gathered ${p.gather.cobbled_deepslate}, want ${234 - 75}`);
if (p.gather.tuff !== 109) fail(`tuff gathered ${p.gather.tuff}, want 109`);
console.log(`plan: gather ${JSON.stringify(p.gather)}; ${p.steps.length} steps`);

const lvl = (level: number, finished?: string) => ({ iron: { x: 0, z: 0, y: level + 6, dir: [1, 0], steps: 6, level, legs: [], dug: 0, got: {}, finished } }) as unknown as Mine;
const cases: Array<[Mine | undefined, string]> = [
  [undefined, 'null'], [lvl(18), 'null'], [lvl(8), '{"y":-4,"open":false}'], [lvl(-4), '{"y":-4,"open":true}'], [lvl(-4, 'done'), '{"y":-4,"open":false}'],
];
for (const [m, exp] of cases) if (JSON.stringify(deepLevel(m)) !== exp) fail(`deepLevel(${m?.iron?.level}) = ${JSON.stringify(deepLevel(m))}, want ${exp}`);

// the palette: kept with `deep` (detail on), today's stand-ins without; the stand-in back to the wood and bricks
if (fullBlock('deepslate_tile_stairs[facing=east]', 'oak', {}, true, true) !== 'deepslate_tile_stairs[facing=east]') fail('deep: tile stairs not kept');
if (fullBlock('tuff_bricks', 'oak', {}, true, true) !== 'tuff_bricks') fail('deep: tuff bricks not kept');
if (fullBlock('deepslate_tiles', 'oak', {}, true, false) !== 'oak_planks' || fullBlock('tuff_bricks', 'oak', {}, true) !== 'stone_bricks') fail('without deep: not the wood and bricks');
if (standIn('deepslate_tile_stairs[facing=east]', { deepslate_tile_stairs: deepStandIn('deepslate_tile_stairs', 'spruce') }) !== 'spruce_stairs[facing=east]') fail('stair stand-in');
if (deepStandIn('tuff_bricks', 'oak') !== 'stone_bricks' || deepStandIn('deepslate_tile_slab', 'oak') !== 'oak_slab') fail('stand-ins');

// deepenForStone: a level whose stairs still go down to a deep aim is the deep level (D1: it stood the tuff in at once)
const reg0 = { note: () => {}, save: () => {} };
const vOf = (iron: object) => ({ name: 'T', mine: { iron } }) as never;
if (deepenForStone(reg0, vOf({ x: 0, z: 0, y: 8, dir: [1, 0], steps: 3, legs: [], dug: 0, got: {}, targetY: -4 })) !== -4) fail('stairs going down to a deep aim not the deep level');
if (deepenForStone(reg0, vOf({ x: 0, z: 0, y: 8, dir: [1, 0], steps: 3, legs: [], dug: 0, got: {}, targetY: 8 })) !== null) fail('a shallow aim taken for deep');
if (deepenForStone(reg0, vOf({ x: 0, z: 0, y: 0, dir: [1, 0], steps: 9, level: -4, legs: [], dug: 0, got: {} })) !== -4) fail('a deep level not found');

console.log(failures ? `deep_stone_unit: ${failures} failed` : 'deep_stone_unit: ok');
process.exit(failures ? 1 : 0);
