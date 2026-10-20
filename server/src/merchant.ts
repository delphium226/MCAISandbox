/**
 * The merchant (s41, runs/2026-10-20/s41/spec_shop_v2.md): a trader standing in the village's first market stall who
 * sells what a peaceful world cannot give (string, bone, gunpowder...) and buys the village's own goods, all for
 * emeralds. Code sets the prices (lesson 1) as "N items for M emeralds", from a hand table until the labour of each good
 * is measured; members only choose what to trade. World-free: the catalogue, the offers' NBT, the stall's cell and the
 * arbitrage check; the world summons it, restocks it and charges trades (mcWorld.ts, the trade skill).
 */
import type { Counts } from './mineflayer/mcMaterials';

export const MERCHANT_ON = (process.env.MC_MERCHANT ?? 'off') === 'on';
/** Minutes between restocks (wall minutes times MC_TIME_SCALE, as the other after-phase clocks). */
export const MERCHANT_RESTOCK_MIN = Number(process.env.MC_MERCHANT_RESTOCK ?? 20);
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
];

export const OFFERS: MerchantOffer[] = [...BUYS, ...SELLS];
/** The items the merchant sells, by name. */
export const SOLD = new Set(SELLS.map((o) => o.item));

/** Whether an item can be had here: not unobtainable, or sold by the merchant while it trades (F1). */
export function obtainableHere(item: string, unobtainable: Record<string, string>): boolean {
  return !unobtainable[item] || (MERCHANT_ON && SOLD.has(item));
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
