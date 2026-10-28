/**
 * The cathedral's furnishing (#162, tier 2's chains C-E; runs/2026-10-26/tier2/spec.md 3C-3E): gothicGen's ninth stage
 * drawn only for the kinds whose flag is on, and what each furnishing item takes. C (MC_FURNISH_LANTERNS): lanterns on
 * chains, the smith's (iron ingots into nuggets, a torch a lantern). D (MC_FURNISH_BANNERS): wall banners, the weaver's
 * (6 wool and a stick each, the wool dyed). E (MC_FURNISH_CANDLES): the altar's candles (string and honeycomb) and the
 * bell, which no recipe makes: the merchant sells one. The stage never holds the cathedral: it counts as built once
 * stages 1-8 stand (monument.ts jobBuilt), and the furnishing's jobs come after. World-free: the flags, the kinds, the
 * recipes as counts; mcFurnish.ts makes them.
 */
import { rawSetting } from './settings';

const flag = (name: string) => /^(on|1|true|yes)$/i.test(rawSetting(name) ?? 'off');
/** The three chains' flags (all off by default). */
export const FURNISH = {
  lanterns: flag('MC_FURNISH_LANTERNS'),
  banners: flag('MC_FURNISH_BANNERS'),
  candles: flag('MC_FURNISH_CANDLES'),
};
/** Whether any furnishing is drawn. */
export const furnishOn = () => FURNISH.lanterns || FURNISH.banners || FURNISH.candles;
/** The generator's furnishing kinds from the flags (the bell and the altar go with the candles). */
export const furnishKinds = () => ({ lanterns: FURNISH.lanterns, banners: FURNISH.banners, candles: FURNISH.candles, bell: FURNISH.candles });
/** The stage's name in the plan (gothicGen's GOTHIC_STAGES_DETAIL). */
export const FURNISH_STAGE = 'furnishing';

/** Whether an item is a furnishing piece the furnishing chore makes (the altar's chiselled bricks are the carver's). */
export const furnishItem = (item: string) => /^(lantern|iron_chain|candle|bell|\w+_banner)$/.test(item);

/** Who makes an item: lanterns, chains, candles, the bell and flower pots the smith, banners and carpets the weaver. */
export const furnishTrade = (item: string): 'smith' | 'weaver' | 'carver' => (/_(banner|carpet)$/.test(item) ? 'weaver' : item === 'chiseled_stone_bricks' ? 'carver' : 'smith');

/** The most of an item one chore makes (a chore's trip and table time: a stack of wool is ~11 sheep). */
export function furnishBatch(item: string): number {
  if (item === 'bell') return 1;
  if (/_banner$/.test(item) || item === 'flower_pot') return 4;
  if (/_carpet$/.test(item)) return 6;
  return 8;
}

/** A furnishing item's makings for n: what it takes from storage (or the land and the merchant) and the crafts in order
 *  (`makes`: items out). Torches and sticks from storage when held, else made (coal or charcoal, planks). */
export interface FurnishPlan { takes: Record<string, number>; crafts: Array<{ item: string; makes: number }> }
export function furnishPlan(item: string, n: number, have: Record<string, number> = {}): FurnishPlan {
  const takes: Record<string, number> = {}, crafts: FurnishPlan['crafts'] = [];
  const add = (k: string, q: number) => { if (q > 0) takes[k] = (takes[k] ?? 0) + q; };
  // (sticks: 2 planks make 4)
  const sticks = (q: number) => {
    const short = Math.max(0, q - (have.stick ?? 0));
    add('stick', q - short);
    if (short) {
      add('planks', Math.ceil(short / 4) * 2);
      crafts.push({ item: 'stick', makes: Math.ceil(short / 4) * 4 });
    }
  };
  if (item === 'lantern' || item === 'iron_chain') {
    // (a lantern: 8 nuggets round a torch; a chain: an ingot between 2 nuggets; 9 nuggets an ingot)
    const nuggets = item === 'lantern' ? 8 * n : 2 * n;
    const held = Math.min(have.iron_nugget ?? 0, nuggets), nugIngots = Math.ceil((nuggets - held) / 9);
    add('iron_nugget', held);
    add('iron_ingot', nugIngots + (item === 'iron_chain' ? n : 0));
    if (nugIngots) crafts.push({ item: 'iron_nugget', makes: nugIngots * 9 });
    if (item === 'lantern') {
      const short = Math.max(0, n - (have.torch ?? 0));
      add('torch', n - short);
      if (short) {
        // (4 torches a coal and a stick)
        const runs = Math.ceil(short / 4);
        add('coal', runs);
        sticks(runs);
        crafts.push({ item: 'torch', makes: runs * 4 });
      }
    }
  } else if (/_banner$/.test(item)) {
    const colour = item.replace(/_banner$/, '');
    add('white_wool', 6 * n);
    if (colour !== 'white') {
      add(`${colour}_dye`, 6 * n);
      crafts.push({ item: `${colour}_wool`, makes: 6 * n });
    }
    sticks(n);
  } else if (/_carpet$/.test(item)) {
    // (#141's house decorations: 2 wool make 3 carpets, the wool dyed first as a banner's)
    const colour = item.replace(/_carpet$/, ''), runs = Math.ceil(n / 3);
    add('white_wool', 2 * runs);
    if (colour !== 'white') {
      add(`${colour}_dye`, 2 * runs);
      crafts.push({ item: `${colour}_wool`, makes: 2 * runs });
    }
    crafts.push({ item, makes: 3 * runs });
    return { takes, crafts };
  } else if (item === 'flower_pot') {
    // (#141: 3 bricks a pot, the bricks smelted from clay)
    add('brick', 3 * n);
  } else if (item === 'candle') {
    add('string', n);
    add('honeycomb', n);
  } else if (item === 'bell') {
    add('bell', n);
    return { takes, crafts };
  } else if (item === 'chiseled_stone_bricks') {
    // (the altar: 2 slabs a chiselled brick, 6 slabs from 3 bricks)
    const slabs = Math.ceil((2 * n) / 6) * 6;
    add('stone_bricks', slabs / 2);
    crafts.push({ item: 'stone_brick_slab', makes: slabs });
  } else return { takes: { [item]: n }, crafts };
  crafts.push({ item, makes: n });
  return { takes, crafts };
}

/** The furnishing's items still wanted (the open furnishing jobs' bills less the yard, the altar's bricks too), by item. */
export function furnishWants(bills: Array<Record<string, number>>, yard: Record<string, number>): Record<string, number> {
  const need: Record<string, number> = {};
  for (const b of bills) for (const [k, q] of Object.entries(b)) need[k] = (need[k] ?? 0) + q;
  const out: Record<string, number> = {};
  for (const [k, q] of Object.entries(need)) if (q - (yard[k] ?? 0) > 0) out[k] = Math.ceil(q - (yard[k] ?? 0));
  return out;
}

/** A coloured banner's stand-in once its chore could not make it (no dye to be had): the wall banner of that colour
 *  drawn white, so the furnishing's last job is not held by a colour (N1: Notre-Dame 1:3 waited on blue banners with no
 *  blue dye in the yard, 22 members idle). Null for white or not a banner. */
export function bannerStandIn(item: string): { block: string; as: string } | null {
  const m = /^(\w+)_banner$/.exec(item);
  return m && m[1] !== 'white' ? { block: `${m[1]}_wall_banner`, as: 'white_wall_banner' } : null;
}

/** Chores for a furnishing kind failed (its makings not to be had: no iron for lanterns, chains or shears) before the
 *  furnishing leaves that kind out (the bell is never left out: it is bought, and without it the job would go). */
export const FURNISH_FAILS = 4;
/** The furnishing kind an item belongs to, for leaving it out. */
export function furnishKindOf(item: string): 'lanterns' | 'banners' | 'candles' | null {
  return /^(lantern|iron_chain)$/.test(item) ? 'lanterns' : /_banner$/.test(item) ? 'banners' : /candle$/.test(item) ? 'candles' : null;
}

/** The emeralds the bell costs (merchant.ts' offer). */
export const BELL_EMERALDS = 12;
