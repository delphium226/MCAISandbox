/** G8's flags (ladder.ts), apart so the mine and build skills can read them without ladder.ts' imports. */
const flag = (name: string) => /^(on|1|true|yes)$/i.test(process.env[name] ?? '');
/** MC_LADDER: the ladder's state, the progress line, the stage tags and the rung ballot (wanted.ts reads the same). */
export const LADDER = flag('MC_LADDER');
/** MC_IRON_AGE: the widened iron chain (dig on up to 3 legs, smelt at the works furnaces, forge for a named member,
 *  new iron levels as each ends); usable without the ladder. */
export const IRON_AGE = flag('MC_IRON_AGE');
/** MC_OWN_TOOLS: a tool given to a member stays with it (deposits keep it) and its skills use it before storage's. */
export const OWN_TOOLS = flag('MC_OWN_TOOLS');
/** Up to this many miners at once on the iron level, each on its own leg (spec B2). */
export const IRON_MINERS = 3;
