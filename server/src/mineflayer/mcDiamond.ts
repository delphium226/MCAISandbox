/**
 * The diamond rung's choices and counts (G8, #22, MC_DIAMOND_AGE; spec runs/2026-10-30/diamond/spec.md). mcMine.ts lays the
 * iron chain deep while the rung is current (deepenForDiamonds) and keeps the diamond ore; these are the menu's and the
 * ladder's side, pure, for mcWorld.ts and the offline checks: the dig option's words while the chain is deep, who may take
 * it, who the next diamond pickaxe is for, and the rung's counts from a chore step's end.
 */
import type { Village } from '../village';
import { DIAMOND_AGE, DIAMOND_Y, IRON_AGE, LADDER } from '../ladderFlags';
import { DIAMOND_DEPTH, enchantmentCurrent, type Counter } from '../ladder';
import { IRON_MINERS } from '../ladderFlags';
import { chainDeepest, deepChain, deepPicksShort, diamondWanted, picksGiven } from './mcMine';

export { deepChain, deepenForDiamonds, hasIronPick } from './mcMine';

type Counts = Record<string, number>;

/** The rung acts (MC_DIAMOND_AGE with MC_LADDER and MC_IRON_AGE). */
export const DIAMONDS_ON = DIAMOND_AGE && IRON_AGE && LADDER;
/** A diamond pickaxe's diamonds (the jar's recipe, with 2 sticks). */
export const PICK_DIAMONDS = 3;

/** #180: whether the village digs iron first for its deep miners' pickaxes (it wants diamonds, has given fewer than
 *  IRON_MINERS iron pickaxes, and its chain is not yet deep): the iron dig's own words and no pickaxe gate. */
export const ironFirst = (v: Village): boolean => DIAMONDS_ON && deepPicksShort(v) && !deepChain(v.mine);

/** #180: the iron dig's fact while iron comes first, or ''. */
export function ironFirstFact(v: Village): string {
  return ironFirst(v) ? `the deep stairs wait for the deep miners' iron pickaxes (${picksGiven(v.mine)} of ${IRON_MINERS} given): iron first` : '';
}

/** The dig option's words while the chain is deep or the village wants diamonds; null: iron's own. */
export function deepDigWords(v: Village, store: Counts): { name: string; facts: string; effect: string } | null {
  const m = v.mine, i = m?.iron;
  if (!DIAMONDS_ON || !m || !i || !(deepChain(m) || diamondWanted(v)) || ironFirst(v)) return null;
  const gems = store.diamond ?? 0;
  const where = i.level !== undefined && i.level <= DIAMOND_Y + 2
    ? `the deep level at y ${i.level}, ${i.dug - (i.dugAt ?? 0)} cells dug there`
    : `the deep stairs going down to y ${DIAMOND_Y}, now at y ${chainDeepest(m) ?? i.y}`;
  return {
    name: 'Dig for diamonds in the deep mine',
    facts: `${where}; ${gems} diamonds in storage; an iron pickaxe needed`,
    effect: `diamonds for the diamond pickaxes (${gems} in storage)`,
  };
}

/** Why a member may not take the dig now: the village wants diamonds (or the chain is deep) and it carries no iron
 *  pickaxe, nor does storage hold one (a stone one would dig diamond ore for nothing, in the stairs as in the tunnels). */
export function deepDigBlocked(v: Village, carriesIronPick: boolean, store: Counts): string | null {
  if (!DIAMONDS_ON || !(diamondWanted(v) || deepChain(v.mine)) || carriesIronPick || ironFirst(v) || !pickForgeable(store)) return null;
  return (store.iron_pickaxe ?? 0) + (store.diamond_pickaxe ?? 0) + (store.netherite_pickaxe ?? 0) > 0 ? null : 'the deep level needs an iron pickaxe';
}

/** Whether storage holds the iron for an iron pickaxe (3 ingots, raw iron counted). Without it the deep dig is not held
 *  for one: the rungs test's diamond run (11-14) had no pickaxe held, no iron stored and the dig blocked for want of an
 *  iron pickaxe, so no iron ever came up to forge one; a stone pickaxe's trip brings the iron up (diamond ore it meets
 *  gives nothing) until one can be forged. */
export const pickForgeable = (store: Counts): boolean => (store.iron_ingot ?? 0) + (store.raw_iron ?? 0) >= 3;

/**
 * Who the next diamond pickaxe is for (spec section 7), once the rung is current or reached: the deep miner (a member who
 * has taken the dig, most digs first) with none given yet, when `diamonds` (stored, less those earmarked) are enough.
 * A string says why none ('' when the rung has not begun: no reason shown).
 */
export function diamondForgeNeed(v: Village, members: Array<{ name: string; digs: number }>, diamonds: number): { for: string } | string {
  const st = v.ladder;
  if (!DIAMONDS_ON || !st || !(st.current === 'diamond' || st.reached.some((r) => r.rung === 'diamond'))) return '';
  const given = v.mine?.ironGiven ?? [];
  const diggers = members.filter((q) => q.digs >= 1);
  const miners = diggers.filter((q) => !given.some((g) => g.to === q.name && g.item === 'diamond_pickaxe'))
    .sort((p, q) => q.digs - p.digs || p.name.localeCompare(q.name));
  // (#180: said only when true; train 13's menus said it while no member had dug at all)
  if (!diggers.length) return 'no member has dug in the mine yet';
  if (!miners.length) return 'every deep miner has a diamond pickaxe';
  // (the enchanting table's 2 diamonds kept while the enchantment rung has none placed: rungs test 11-14, enchantment5's
  // forge gave three deep miners diamond pickaxes from the stocked and mined diamonds and the table was never made)
  const keep = enchantmentCurrent(v) && !v.enchant?.table ? 2 : 0;
  if (diamonds - keep < PICK_DIAMONDS) return `diamonds short for a diamond pickaxe (${diamonds} of ${PICK_DIAMONDS}${keep ? `, ${keep} kept for the enchanting table` : ''})`;
  return { for: miners[0].name };
}

/**
 * The diamond rung's counts from a chore step done (spec section 2): the chain's depth below y 0 as its record stands now,
 * only what is new since the rung began (the stage's total); the diamonds a dig trip brought up; a diamond pickaxe given.
 * [] unless diamond is the current rung.
 */
export function diamondCounts(v: Village, type: string, message: string, item = ''): Array<[Counter, number]> {
  if (!DIAMONDS_ON || v.ladder?.current !== 'diamond') return [];
  const out: Array<[Counter, number]> = [];
  if (type === 'dig_iron') {
    const deepest = chainDeepest(v.mine);
    // (the diamond level reached within the deepening's slack counts as all the way)
    const depth = deepest === null ? 0 : deepest <= DIAMOND_Y + 2 ? DIAMOND_DEPTH : Math.min(DIAMOND_DEPTH, Math.max(0, -deepest));
    out.push(['depth', depth - (v.ladder.totals?.depth ?? 0)]);
    const g = /brought up \d+ raw iron, \d+ coal, (\d+) diamond\b/.exec(message);
    if (g) out.push(['diamonds', Number(g[1])]);
  } else if (type === 'make_iron_tool' && item === 'diamond_pickaxe' && /given to [A-Za-z0-9_]+/.test(message)) out.push(['dtools', 1]);
  return out.filter(([, n]) => n > 0);
}
