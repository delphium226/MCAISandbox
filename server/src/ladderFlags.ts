/** G8's flags (ladder.ts), apart so the mine and build skills can read them without ladder.ts' imports. */
import { rawSetting } from './settings';
const flag = (name: string) => /^(on|1|true|yes)$/i.test(rawSetting(name) ?? '');
/** MC_LADDER: the ladder's state, the progress line, the stage tags and the rung ballot (wanted.ts reads the same). */
export const LADDER = flag('MC_LADDER');
/** MC_IRON_AGE: the widened iron chain (dig on up to 3 legs, smelt at the works furnaces, forge for a named member,
 *  new iron levels as each ends); usable without the ladder. */
export const IRON_AGE = flag('MC_IRON_AGE');
/** MC_ORE_MINE (with MC_IRON_AGE): the iron levels follow the iron seen (short drifts to ore seen near the tunnels, turns
 *  and next levels toward it, levels 6 apart down to y -8) instead of fixed patterns only, up to 8,000 cells in all. */
export const ORE_MINE = flag('MC_ORE_MINE');
/** MC_IRON_STAIRS2 (with MC_IRON_AGE, #101): each iron level's stairs get a second lane beside the first, dug by a second
 *  miner (a lock per lane) or on a later trip; miners walk down one lane and up the other. */
export const IRON_STAIRS2 = flag('MC_IRON_STAIRS2');
/** MC_LETTERS (with MC_LADDER, #21): the age of letters' four counted stages (cane, leather, books, the library), the
 *  rung's make goods, the merchant's leather and sugar cane, the cane harvest's replanting and the library's shelving. */
/** (on by default since 11-14, the user's; MC_LETTERS=off turns it off) */
export const LETTERS = !/^(off|0|false|no)$/i.test(rawSetting('MC_LETTERS') ?? 'on');
/** MC_LETTERS_PACE (#134): the letters rung at 1x: while the cane slots hold fewer than a slot's 14 stalks the merchant
 *  sells cane for them and harvests (or a top-up visit) replant from storage; and the first market stall is posted as a
 *  village work at completion (with MC_MERCHANT), so the merchant comes early. */
/** (on by default since 10-25, the user's after test train 2; MC_LETTERS_PACE=off turns it off) */
export const LETTERS_PACE = !/^(off|0|false|no)$/i.test(rawSetting('MC_LETTERS_PACE') ?? 'on');
/** MC_DIAMOND_AGE (with MC_LADDER and MC_IRON_AGE, #22; on by default, the user's rule since 10-30; off turns it off): the
 *  diamond rung's four counted stages (depth, diamonds, the first diamond pickaxe, one per deep miner), the iron chain laid
 *  deep to the diamond level while the rung is current, diamond ore kept by the mine, and the diamond pickaxe forge. */
export const DIAMOND_AGE = !/^(off|0|false|no)$/i.test(rawSetting('MC_DIAMOND_AGE') ?? 'on');
/** MC_TRADE_AGE (with MC_LADDER, #246; on by default, the user's rule since 10-30; off turns it off): the age of trade's
 *  four counted stages (lots sold to the merchant, market stalls standing, emeralds in storage, merchant orders filled or,
 *  with MC_MERCHANT_ORDERS off, lots of crafted goods sold); while it is current the workshop makes a lot more of the
 *  goods the merchant buys, storage sells until it holds the rung's emeralds, and the village posts market stalls. */
export const TRADE_AGE = !/^(off|0|false|no)$/i.test(rawSetting('MC_TRADE_AGE') ?? 'on');
/** MC_COPPER_AGE (with MC_LADDER and MC_IRON_AGE, #247; on by default; off turns it off): the copper age's four counted
 *  stages (raw copper kept from the iron mine, copper blocks made, a copper-roofed canopy built, a lightning rod and a
 *  spyglass made); while it is current the mine keeps copper ore, the workshop makes the rung's goods and the merchant
 *  sells an amethyst shard for the spyglass. */
export const COPPER_AGE = !/^(off|0|false|no)$/i.test(rawSetting('MC_COPPER_AGE') ?? 'on');
/** MC_HUSBANDRY_AGE (with MC_LADDER, on by default; off turns it off): the age of husbandry's four counted stages (pens of
 *  three kinds holding a breeding pair, young bred in the pens, wool sheared from a pen's flock, hay bales stored); while
 *  it is current the workshop bales the village's spare wheat into hay. */
export const HUSBANDRY_AGE = !/^(off|0|false|no)$/i.test(rawSetting('MC_HUSBANDRY_AGE') ?? 'on');
/** MC_MUSIC_AGE (with MC_LADDER, on by default; off turns it off): the age of music's four counted stages (redstone bought
 *  for note blocks, note blocks made, a bandstand of them tuned to a scale, a bell hung in the square); while it is current
 *  the merchant sells redstone and the bell, the workshop makes note blocks and the village posts the two works. */
export const MUSIC_AGE = !/^(off|0|false|no)$/i.test(rawSetting('MC_MUSIC_AGE') ?? 'on');
/** MC_MACHINES_AGE (with MC_LADDER and MC_IRON_AGE, #24; on by default; off turns it off): the age of machines' four counted
 *  stages (a hopper egg collector under the chicken pen, 16 rails and a minecart made, a rail line from the mine to the
 *  storage hut, 6 powered rails on it lit by a redstone torch); the merchant sells gold ingots and redstone for them. */
export const MACHINES_AGE = !/^(off|0|false|no)$/i.test(rawSetting('MC_MACHINES_AGE') ?? 'on');
/** MC_BEES_AGE (with MC_LADDER, on by default; off turns it off): the age of bees' four counted stages (an apiary of 2 bee
 *  nests over campfires among flowers, 16 honeycomb and 8 honey bottles taken from them, the copper canopy's roof waxed);
 *  the merchant sells a bee nest with its bees. */
export const BEES_AGE = !/^(off|0|false|no)$/i.test(rawSetting('MC_BEES_AGE') ?? 'on');
/** MC_MAPS_AGE (with MC_LADDER, on by default; off turns it off): the age of maps' four counted stages (a cartography table,
 *  a map of the village's area, a map wall of the four nearest areas in item frames, a 3x3 atlas of the land). */
export const MAPS_AGE = !/^(off|0|false|no)$/i.test(rawSetting('MC_MAPS_AGE') ?? 'on');
/** MC_ENCHANTMENT_AGE (with MC_LADDER and MC_IRON_AGE, #23; on by default; off turns it off): the age of enchantment's four
 *  counted stages (obsidian cast from still lava at the deep level, the enchanting table in the library, 8 levels held by a
 *  member, 5 books enchanted at the table). */
export const ENCHANTMENT_AGE = !/^(off|0|false|no)$/i.test(rawSetting('MC_ENCHANTMENT_AGE') ?? 'on');
/** MC_SEA_AGE (with MC_LADDER; on by default; off turns it off): the age of the sea's four counted stages (boats made, a
 *  dock built out over the nearest water, fish caught, a lighthouse built). */
export const SEA_AGE = !/^(off|0|false|no)$/i.test(rawSetting('MC_SEA_AGE') ?? 'on');
/** MC_NETHER_AGE (with MC_LADDER and MC_IRON_AGE; on by default; off turns it off): the Nether's four counted stages (a
 *  portal of obsidian lit with a flint and steel, 64 Nether blocks brought back by an expedition party, 4 ancient debris dug
 *  in the Nether, a netherite ingot made); docs/specs/nether.md. Peaceful worlds only (MC_WORLD_MODE=peaceful, the
 *  default): in the other modes lava, fire and falls hurt, and the rung stays in words, off the ballot. */
export const NETHER_AGE = !/^(off|0|false|no)$/i.test(rawSetting('MC_NETHER_AGE') ?? 'on') && /^\s*(peaceful)?\s*$/i.test(rawSetting('MC_WORLD_MODE') ?? '');
/** MC_NETHER_PARTY: the most members in the Nether at once on the village's expeditions and digs (3). */
export const NETHER_PARTY = Math.max(1, Math.min(8, Math.floor(Number(rawSetting('MC_NETHER_PARTY') ?? 3)) || 3));
/** The diamond level's y (runs/2026-10-30/diamond/spec.md: diamond ore peaks at -57 to -53 on minevale3, 2 laid open per
 *  100 cells dug at -56, lava below -55 cutting 8% of tunnels there). */
export const DIAMOND_Y = -56;
/** MC_LADDER_START (tests, #22): the rung a village's new ladder starts on instead of iron, the rungs before it counted
 *  reached (a staged or model-driven test of a later rung from a checkpoint saved before the ladder began). */
export const LADDER_START = rawSetting('MC_LADDER_START') ?? '';
/** MC_OWN_TOOLS: a tool given to a member stays with it (deposits keep it) and its skills use it before storage's. */
export const OWN_TOOLS = flag('MC_OWN_TOOLS');
/** Up to this many miners at once on the iron level, each on its own leg (spec B2). */
export const IRON_MINERS = 3;
