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
export const LETTERS = flag('MC_LETTERS');
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
