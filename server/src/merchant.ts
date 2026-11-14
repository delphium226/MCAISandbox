/**
 * The merchant (s41, runs/2026-10-20/s41/spec_shop_v2.md): a trader standing in the village's first market stall who
 * sells what a peaceful world cannot give (string, bone, gunpowder...) and buys the village's own goods, all for
 * emeralds. Code sets the prices (lesson 1) as "N items for M emeralds", from a hand table until the labour of each good
 * is measured; members only choose what to trade. World-free: the catalogue, the offers' NBT, the stall's cell and the
 * arbitrage check; the world summons it, restocks it and charges trades (mcWorld.ts, the trade skill).
 */
import type { Counts } from './mineflayer/mcMaterials';
import { COPPER_AGE, LETTERS } from './ladderFlags';
import { rawSetting } from './settings';
import { CUTTER } from './cutter';
import { DYE_BED } from './dyeBed';
import { FURNISH } from './furnish';
import { STRING } from './supply';
import { PIG_CARROTS } from './farmSlots';

/** On by default since s42 (Stg2: purchases only of what the village uses); MC_MERCHANT=off turns it off. */
export const MERCHANT_ON = (rawSetting('MC_MERCHANT') ?? 'on') === 'on';
/** Minutes between restocks (wall minutes times MC_TIME_SCALE, as the other after-phase clocks). */
export const MERCHANT_RESTOCK_MIN = Number(rawSetting('MC_MERCHANT_RESTOCK') ?? 20);
/** The merchant's entity tag, and a village's own. */
export const MERCHANT_TAG = 'mcai_merchant';
export const villageTag = (village: string) => `mcai_v_${village.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;

/** One offer: `give` items of `item` for `emeralds` (buys: the merchant takes the goods and pays), or `emeralds` for
 *  `give` items (sells), at most `stock` times a restock. */
export interface MerchantOffer { item: string; n: number; emeralds: number; stock: number; dir: 'buys' | 'sells' }

/** What the merchant buys (the village's goods: those with keeps the world can count, F3/F4 of the check); planks at a
 *  log's price (4 planks a log: crafting must not double a good's worth). */
export const BUYS: MerchantOffer[] = [
  { item: 'birch_log', n: 16, emeralds: 1, stock: 8, dir: 'buys' },
  { item: 'oak_log', n: 16, emeralds: 1, stock: 8, dir: 'buys' },
  { item: 'birch_planks', n: 64, emeralds: 1, stock: 4, dir: 'buys' },
  { item: 'oak_planks', n: 64, emeralds: 1, stock: 4, dir: 'buys' },
  { item: 'wheat', n: 20, emeralds: 1, stock: 6, dir: 'buys' },
  { item: 'bread', n: 6, emeralds: 1, stock: 6, dir: 'buys' },
  { item: 'stone_bricks', n: 16, emeralds: 1, stock: 6, dir: 'buys' },
  { item: 'glass', n: 12, emeralds: 1, stock: 4, dir: 'buys' },
  { item: 'torch', n: 24, emeralds: 1, stock: 4, dir: 'buys' },
];

/** What it sells (a peaceful world's missing drops; the Nether's and the End's stay out while Phase S holds them). */
/** #217 step 6: flint and arrows sold where monsters come and bows are on. */
const BOWS = !/^(off|0|false|no)$/i.test(rawSetting('MC_BOWS') ?? 'on') && /^(hostile|normal)$/i.test(rawSetting('MC_WORLD_MODE') ?? 'peaceful');
export const SELLS: MerchantOffer[] = [
  { item: 'string', n: 2, emeralds: 1, stock: 12, dir: 'sells' },
  { item: 'bone', n: 3, emeralds: 1, stock: 8, dir: 'sells' },
  { item: 'gunpowder', n: 1, emeralds: 1, stock: 6, dir: 'sells' },
  { item: 'spider_eye', n: 2, emeralds: 1, stock: 4, dir: 'sells' },
  { item: 'slime_ball', n: 1, emeralds: 1, stock: 4, dir: 'sells' },
  { item: 'ink_sac', n: 2, emeralds: 1, stock: 4, dir: 'sells' },
  { item: 'ender_pearl', n: 1, emeralds: 4, stock: 2, dir: 'sells' },
  // (the fishing activity's rod: the workshop's goods take only easy materials, so the merchant sells rods themselves;
  // they wear out, so they are bought again)
  { item: 'fishing_rod', n: 1, emeralds: 2, stock: 2, dir: 'sells' },
  // (#21, MC_LETTERS: the age of letters' leather, the user's 10-22 and 10-24, 12 a restock; and the first cane farm's
  // seed, bought only while no slot farms cane. Appended last so a saved merchant's uses keep their indices)
  ...(LETTERS ? [
    { item: 'leather', n: 2, emeralds: 1, stock: 6, dir: 'sells' as const },
    { item: 'sugar_cane', n: 4, emeralds: 1, stock: 4, dir: 'sells' as const },
  ] : []),
  // (#162: the monument's bell, which no recipe makes; vanilla's armourers sell one. Last, for the same reason)
  // (#162 E, MC_FURNISH_CANDLES: the furnishing's bell)
  ...(CUTTER.on && (DYE_BED.on || FURNISH.candles) ? [{ item: 'bell', n: 1, emeralds: 12, stock: 1, dir: 'sells' as const }] : []),
  // (#217 step 6, MC_BOWS: the fletcher's trade when the chain is short: flint for arrows (no gravel trip yet), and arrows.
  // Last, for the same reason; only in worlds with monsters, where the bow goods are made)
  ...(BOWS ? [{ item: 'flint', n: 4, emeralds: 1, stock: 8, dir: 'sells' as const }, { item: 'arrow', n: 8, emeralds: 1, stock: 4, dir: 'sells' as const }] : []),
  // (MC_PIG_CARROTS: a farmer's carrots for a pig pen while no slot grows them. Last, for the same reason)
  ...(PIG_CARROTS ? [{ item: 'carrot', n: 4, emeralds: 1, stock: 4, dir: 'sells' as const }] : []),
  // (#247, MC_COPPER_AGE: the copper age's spyglass takes an amethyst shard, which only a geode gives (MC_GEODE, off); bought
  // only while the rung wants one. Last, for the same reason)
  ...(COPPER_AGE ? [{ item: 'amethyst_shard', n: 1, emeralds: 2, stock: 2, dir: 'sells' as const }] : []),
];

export const OFFERS: MerchantOffer[] = [...BUYS, ...SELLS];
/**
 * s42 (#73, the user's idea at s41: the merchant drives demand): orders. At each restock the merchant posts orders for goods
 * the village's workshop can make ("wants 16 birch_fence, pays 3 emeralds"); an open order raises the good's make target by
 * its count (a sink for the workshop, F258) and lib:sell fills it once storage holds the count. Unfilled for
 * ORDER_EXPIRE_RESTOCKS restocks it expires (logged: a candidate for a foundry ticket later). The emeralds traded raise the
 * merchant's level (vanilla's five), which allows dearer orders and more of them at once. Off by default
 * (MC_MERCHANT_ORDERS=on).
 */
export const ORDERS_ON = (rawSetting('MC_MERCHANT_ORDERS') ?? 'off') === 'on';
export interface MerchantOrder { id: string; item: string; n: number; emeralds: number; raw: number; at: number; restocks: number; state: 'open' | 'filled' | 'expired'; by?: string; end?: number }
/** Emeralds traded to reach each level (1-5). */
export const LEVEL_XP = [0, 10, 40, 100, 200];
export const levelOf = (xp: number) => LEVEL_XP.filter((t) => xp >= t).length;
/** The most raw materials one order may take at a level (index: the level), and the orders open at once. */
export const ORDER_RAW_CAP = [0, 16, 32, 64, 128, Infinity];
export const ordersOpen = (level: number) => 1 + Math.floor(level / 2);
export const ORDER_EXPIRE_RESTOCKS = 3;
/** An order's count in the good's batches (MC_MERCHANT_ORDER_SIZE, 1). */
export const ORDER_SIZE = Math.max(1, Number(rawSetting('MC_MERCHANT_ORDER_SIZE') ?? 1) || 1);
/** An order's pay: its raw materials at the logs' price (16 an emerald) and half again for the work, at least 1. */
export const orderPay = (raw: number) => Math.max(1, Math.round((1.5 * raw) / 16));
/** A stable pick among candidates (FNV-1a of the seed): the same village and order number give the same order. */
export function stablePick<T>(xs: T[], seed: string): T | undefined {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return xs.length ? xs[h % xs.length] : undefined;
}

/** The items the merchant sells, by name. */
export const SOLD = new Set(SELLS.map((o) => o.item));

/** Whether an item can be had here: not unobtainable, or sold by the merchant while it trades (F1). */
export function obtainableHere(item: string, unobtainable: Record<string, string>): boolean {
  // (#178, MC_STRING: string from cobwebs)
  return !unobtainable[item] || (MERCHANT_ON && SOLD.has(item)) || (item === 'string' && STRING);
}

/** An offer's value in emeralds for one item (what one unit is worth at this price). */
export const unitEmeralds = (o: MerchantOffer) => o.emeralds / o.n;

/** One offer as Paper's villager recipe NBT, its uses as given (capped at maxUses); no price drift: priceMultiplier, demand
 *  and specialPrice 0 (F5), no XP. */
export function recipeNbt(o: MerchantOffer, uses = 0): string {
  const item = (id: string, count: number) => `{id:"minecraft:${id}",count:${count}}`;
  const [buy, sell] = o.dir === 'buys' ? [item(o.item, o.n), item('emerald', o.emeralds)] : [item('emerald', o.emeralds), item(o.item, o.n)];
  return `{buy:${buy},sell:${sell},maxUses:${o.stock},uses:${Math.max(0, Math.min(o.stock, uses))},rewardExp:0b,xp:0,priceMultiplier:0f,demand:0,specialPrice:0}`;
}

/** The offers as NBT (`{Recipes:[...]}`, OFFERS' order): for checks only; RCON takes ~1446 bytes a command, so the world
 *  sets them with offersCommands. */
export function offersNbt(uses: number[] = []): string {
  return `{Recipes:[${OFFERS.map((o, i) => recipeNbt(o, uses[i] ?? 0)).join(',')}]}`;
}

/** The commands that set an entity's offers, one recipe each (RCON's request limit, s41's live test: one command with
 *  every offer closed the connection). `sel` must select one entity. */
export function offersCommands(sel: string, uses: number[] = []): string[] {
  return [`data modify entity ${sel} Offers set value {Recipes:[]}`, ...OFFERS.map((o, i) => `data modify entity ${sel} Offers.Recipes append value ${recipeNbt(o, uses[i] ?? 0)}`)];
}

/** The summon command for a village's merchant at x, y, z (facing south: its back to the stall's north row), without its
 *  offers (offersCommands sets them). */
export function summonCommand(village: string, x: number, y: number, z: number): string {
  return `summon minecraft:villager ${x + 0.5} ${y} ${z + 0.5} {NoAI:1b,Invulnerable:1b,PersistenceRequired:1b,Silent:1b,NoGravity:1b,`
    + `Rotation:[0f,0f],Tags:["${MERCHANT_TAG}","${villageTag(village)}"],CustomName:"Merchant",`
    + `VillagerData:{profession:"minecraft:farmer",level:5,type:"minecraft:plains"}}`;
}

/** The merchant's cell in a built market stall (smallWorks.ts marketStall, 5x3, built at its centre x, z on ground y):
 *  the back row's free middle cell (x1 + 2, z1), one above the floor (the check's F9). */
export function stallCell(stall: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: stall.x, y: stall.y + 1, z: stall.z - 1 };
}

/**
 * Recipes that would turn items bought from the merchant into a good it buys for more than they cost (the check's F6):
 * emeralds from nothing. `recipes`: crafting recipes as { out, n, ins }; a recipe counts only when one of its inputs is
 * sold by the merchant; an input's cost is its sold price, or a village good's bought price (selling it instead), or
 * nothing (free labour). Value added by crafting village goods alone is labour, not a loop. Empty: no loop.
 */
export function arbitrage(recipes: Array<{ out: string; n: number; ins: Counts }>): string[] {
  const buyOf = new Map(BUYS.map((o) => [o.item, unitEmeralds(o)]));
  const sellOf = new Map(SELLS.map((o) => [o.item, unitEmeralds(o)]));
  const out: string[] = [];
  for (const r of recipes) {
    const pays = buyOf.get(r.out);
    if (pays === undefined) continue;
    let cost = 0, touched = false;
    for (const [n, q] of Object.entries(r.ins)) {
      const c = sellOf.get(n) ?? buyOf.get(n);
      if (c === undefined) continue;
      if (sellOf.has(n)) touched = true;
      cost += c * q;
    }
    if (touched && pays * r.n > cost + 1e-9) out.push(`${r.out} x${r.n} pays ${(pays * r.n).toFixed(3)} for inputs worth ${cost.toFixed(3)} (${Object.entries(r.ins).map(([n, q]) => `${q} ${n}`).join(', ')})`);
  }
  return out;
}
