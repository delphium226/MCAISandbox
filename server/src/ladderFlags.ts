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
/** MC_OWN_TOOLS: a tool given to a member stays with it (deposits keep it) and its skills use it before storage's. */
export const OWN_TOOLS = flag('MC_OWN_TOOLS');
/** Up to this many miners at once on the iron level, each on its own leg (spec B2). */
export const IRON_MINERS = 3;
