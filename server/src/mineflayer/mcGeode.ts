/**
 * Geodes kept out of every walk (MC_GEODE_GUARD, off; #133's geode case, #162 tier 3). A geode is a hollow ball: smooth
 * basalt, then calcite, then a lining of amethyst blocks with budding amethyst, then air. A member whose path dug through
 * the shell dropped into the hollow and could not path out (T2d: 73 [stuck] at -1759,22,62, inside the shell). Two rules,
 * both read from the blocks themselves (no record of where geodes are, no search):
 * - the pathfinder never digs a shell's block on its way (its break cost), so no path opens a geode;
 * - it never steps into the hollow: a cell over any shell block (the lining has gaps: 13 of 49 floor cells in T2d's geode
 *   were bare calcite, 2 smooth basalt), or holding a bud or cluster, costs too much (its step cost), unless the bot already stands in one (it must be able
 *   to walk out, as the farm's rule lets it off a field).
 * Mining a geode on purpose (the amethyst activity, the gem cutter) digs by `mineBlock`, which these costs do not touch.
 */
import { rawSetting } from '../settings';

export const GEODE_GUARD = /^(on|1|true|yes)$/i.test(rawSetting('MC_GEODE_GUARD') ?? 'off');

/** The shell's blocks: never dug by a path. */
export const GEODE_SHELL = ['smooth_basalt', 'calcite', 'amethyst_block', 'budding_amethyst'];
/** The hollow's floor: a cell standing on one is inside the ball (calcite and smooth basalt are geodes' only in the
 *  overworld but for stony peaks' calcite patches, which paths then walk around). */
export const GEODE_LINING = GEODE_SHELL;
/** What grows into the hollow: a cell holding one is inside the ball. */
export const GEODE_GROWTH = ['small_amethyst_bud', 'medium_amethyst_bud', 'large_amethyst_bud', 'amethyst_cluster'];

/** Over 100 drops the move from every path (the pathfinder's exclusion costs). */
export const GEODE_COST = 1000;

/** The cost of digging a block of this name on a path. */
export function geodeBreakCost(name: string | undefined): number {
  return name && GEODE_SHELL.includes(name) ? GEODE_COST : 0;
}

/** The cost of stepping into a cell holding `feet` over `below`; `inside`: the bot stands in a geode now. */
export function geodeStepCost(feet: string | undefined, below: string | undefined, inside: boolean): number {
  if (inside) return 0;
  return (below && GEODE_LINING.includes(below)) || (feet && GEODE_GROWTH.includes(feet)) ? GEODE_COST : 0;
}

/** Block state ids of the names, for cheap lookups in the pathfinder's costs (`bot.world.getBlockStateId`). */
export function stateIds(reg: { blocksByName: Record<string, { minStateId: number; maxStateId: number } | undefined> }, names: string[]): Map<number, string> {
  const ids = new Map<number, string>();
  for (const n of names) {
    const b = reg.blocksByName[n];
    if (b) for (let s = b.minStateId; s <= b.maxStateId; s++) ids.set(s, n);
  }
  return ids;
}
