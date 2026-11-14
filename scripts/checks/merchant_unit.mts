/**
 * The merchant's tables, offline (s41, spec_shop_v2): every offer's item exists and is real; sold items are the ones a
 * peaceful world lacks (UNOBTAINABLE) or rare inland; the offers' NBT is well formed; no crafting recipe turns items
 * bought from the merchant into a good it buys for more emeralds than they cost (merchant.ts arbitrage, the shop check's
 * F6), over minecraft-data's recipes for the server's version; the stall cell is the market stall's back cell.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/merchant_unit.mts
 */
import minecraftData from 'minecraft-data';
import { BUYS, OFFERS, SELLS, arbitrage, obtainableHere, offersCommands, offersNbt, stallCell, summonCommand } from '../../server/src/merchant';
import { UNOBTAINABLE, type Counts } from '../../server/src/mineflayer/mcMaterials';
import { SMALL_WORKS } from '../../server/src/smallWorks';

const reg = minecraftData('26.1');
let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};

for (const o of [...OFFERS]) {
  ok(!!reg.itemsByName[o.item], `${o.item} exists`);
  ok(Number.isInteger(o.n) && o.n >= 1 && o.n <= 64, `${o.item}: n ${o.n} in 1..64`);
  ok(Number.isInteger(o.emeralds) && o.emeralds >= 1 && o.emeralds <= 64, `${o.item}: emeralds ${o.emeralds} in 1..64`);
  ok(Number.isInteger(o.stock) && o.stock >= 1, `${o.item}: stock ${o.stock}`);
}
// (#21, MC_LETTERS: leather and sugar cane are scarce near the villages, measured: one cow and no cane within 160)
for (const o of SELLS) ok(!!UNOBTAINABLE[o.item] || o.item === 'ink_sac' || o.item === 'fishing_rod' || (process.env.MC_LETTERS === 'on' && (o.item === 'leather' || o.item === 'sugar_cane')) || (o.item === 'bell' && (process.env.MC_MONUMENT_DETAIL ?? 'on') === 'on') || (o.item === 'carrot' && (process.env.MC_PIG_CARROTS ?? 'on') !== 'off') || (o.item === 'amethyst_shard' && (process.env.MC_COPPER_AGE ?? 'on') !== 'off') || (o.item === 'redstone' && ['MC_MUSIC_AGE', 'MC_MACHINES_AGE', 'MC_MAPS_AGE'].some((f) => (process.env[f] ?? 'on') !== 'off')) || (o.item === 'gold_ingot' && (process.env.MC_MACHINES_AGE ?? 'on') !== 'off') || (o.item === 'bee_nest' && (process.env.MC_BEES_AGE ?? 'on') !== 'off'), `${o.item} is something a peaceful world lacks (UNOBTAINABLE), rare inland, scarce here (letters; the pigs' carrots: no slot grows them; the copper age's amethyst shard: geodes only; the music, machines and maps ages' redstone: below the iron levels; the machines age's gold: deeper still; the bees age's nest: Silk Touch to move one), has no recipe (#162's bell), or made of it (a rod: string)`);
for (const o of BUYS) ok(!UNOBTAINABLE[o.item], `${o.item} (bought) is obtainable here`);
ok(new Set(OFFERS.map((o) => `${o.dir}:${o.item}`)).size === OFFERS.length, 'no offer twice');
// (with the merchant off, sold items stay unobtainable; MC_MERCHANT is read at load: this run's value, on by default since s42)
ok(obtainableHere('string', UNOBTAINABLE) === ((process.env.MC_MERCHANT ?? 'on') === 'on'), 'string obtainable only while the merchant trades');
ok(obtainableHere('oak_log', UNOBTAINABLE), 'oak_log obtainable');

const nbt = offersNbt([2, 99]);
ok(nbt.startsWith('{Recipes:[') && nbt.endsWith(']}'), 'NBT shape');
ok((nbt.match(/\{buy:/g) ?? []).length === OFFERS.length, 'one recipe an offer');
ok(nbt.includes(`uses:2,`) && nbt.includes(`uses:${OFFERS[1].stock},`), 'uses kept and capped at maxUses');
ok(/priceMultiplier:0f,demand:0,specialPrice:0/.test(nbt), 'no price drift');
// (RCON takes about 1446 bytes a request: s41's live summon with every offer in it closed the connection)
const cmds = [summonCommand('B25x2', -1630, 65, -37), ...offersCommands('@e[type=minecraft:villager,tag=mcai_merchant,tag=mcai_v_b25x2,limit=1]')];
ok(cmds.every((c) => Buffer.byteLength(c) < 1400), `every command under RCON's limit (longest ${Math.max(...cmds.map((c) => Buffer.byteLength(c)))} bytes)`);
const cmd = summonCommand('B25x2', -1630, 65, -37);
ok(cmd.includes('Tags:["mcai_merchant"') && cmd.includes('"mcai_v_b25x2"') && cmd.includes('NoAI:1b') && cmd.startsWith('summon minecraft:villager -1629.5 65 -36.5'), 'summon command');
let depth = 0, balanced = true;
for (const ch of cmd) {
  if (ch === '{' || ch === '[') depth++;
  if (ch === '}' || ch === ']') depth--;
  if (depth < 0) balanced = false;
}
ok(balanced && depth === 0, 'summon command brackets balance');

// The stall's back cell: the market stall's design, built at its centre (smallWorks.ts: x1 = x - floor(w/2))
const stall = SMALL_WORKS.find((k) => k.kind === 'market_stall')!.make('birch');
const c = stallCell({ x: 10, y: 64, z: 20 });
const x1 = 10 - Math.floor(stall.width / 2), z1 = 20 - Math.floor(stall.depth / 2);
ok(stall.layers[1][c.z - z1][c.x - x1] === '.' && stall.layers[2][c.z - z1][c.x - x1] === '.', `the merchant's cell is open in layers 1-2 (${stall.layers[1][c.z - z1]})`);
ok(c.y === 65, 'one above the ground');

// Arbitrage over every crafting recipe
const recipes: Array<{ out: string; n: number; ins: Counts }> = [];
for (const [id, variants] of Object.entries(reg.recipes ?? {})) {
  const out = reg.items[Number(id)]?.name;
  if (!out) continue;
  for (const r of variants as Array<{ result: { count: number }; inShape?: Array<Array<number | null>>; ingredients?: Array<number | null> }>) {
    const ins: Counts = {};
    const cells = r.inShape ? r.inShape.flat() : r.ingredients ?? [];
    for (const i of cells) {
      if (i === null || i === undefined || (i as unknown as number) < 0) continue;
      const n = reg.items[i as number]?.name;
      if (n) ins[n] = (ins[n] ?? 0) + 1;
    }
    recipes.push({ out, n: r.result?.count ?? 1, ins });
  }
}
const loops = arbitrage(recipes);
ok(recipes.length > 500, `recipes read (${recipes.length})`);
ok(!loops.length, `no arbitrage loop${loops.length ? `: ${loops.slice(0, 3).join('; ')}` : ''}`);
// (the rule itself: a planted loop is found)
ok(arbitrage([{ out: 'torch', n: 64, ins: { string: 1 } }]).length === 1, 'a planted loop is found');

console.log(`${fail ? 'FAIL' : 'OK'} merchant_unit: ${pass} of ${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
