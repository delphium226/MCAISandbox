/**
 * The diamond rung's choices and counts (G8, #22, MC_DIAMOND_AGE; spec runs/2026-10-30/diamond/spec.md). mcMine.ts lays the
 * iron chain deep while the rung is current (deepenForDiamonds) and keeps the diamond ore; these are the menu's and the
 * ladder's side, pure, for mcWorld.ts and the offline checks: the dig option's words while the chain is deep, who may take
 * it, who the next diamond pickaxe is for, and the rung's counts from a chore step's end.
 */
import type { Village } from '../village';
import { DIAMOND_AGE, DIAMOND_Y, IRON_AGE, LADDER } from '../ladderFlags';
import { DIAMOND_DEPTH, type Counter } from '../ladder';
import { chainDeepest, deepChain, diamondWanted } from './mcMine';

export { deepChain, deepenForDiamonds, hasIronPick } from './mcMine';

type Counts = Record<string, number>;

/** The rung acts (MC_DIAMOND_AGE with MC_LADDER and MC_IRON_AGE). */
export const DIAMONDS_ON = DIAMOND_AGE && IRON_AGE && LADDER;
/** A diamond pickaxe's diamonds (the jar's recipe, with 2 sticks). */
export const PICK_DIAMONDS = 3;

/** The dig option's words while the chain is deep or the village wants diamonds; null: iron's own. */
export function deepDigWords(v: Village, store: Counts): { name: string; facts: string; effect: string } | null {
  const m = v.mine, i = m?.iron;
  if (!DIAMONDS_ON || !m || !i || !(deepChain(m) || diamondWanted(v))) return null;
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
  if (!DIAMONDS_ON || !(diamondWanted(v) || deepChain(v.mine)) || carriesIronPick) return null;
  return (store.iron_pickaxe ?? 0) + (store.diamond_pickaxe ?? 0) + (store.netherite_pickaxe ?? 0) > 0 ? null : 'the deep level needs an iron pickaxe';
}

/**
 * Who the next diamond pickaxe is for (spec section 7), once the rung is current or reached: the deep miner (a member who
 * has taken the dig, most digs first) with none given yet, when `diamonds` (stored, less those earmarked) are enough.
 * A string says why none ('' when the rung has not begun: no reason shown).
 */
export function diamondForgeNeed(v: Village, members: Array<{ name: string; digs: number }>, diamonds: number): { for: string } | string {
  const st = v.ladder;
  if (!DIAMONDS_ON || !st || !(st.current === 'diamond' || st.reached.some((r) => r.rung === 'diamond'))) return '';
  const given = v.mine?.ironGiven ?? [];
  const miners = members.filter((q) => q.digs >= 1 && !given.some((g) => g.to === q.name && g.item === 'diamond_pickaxe'))
    .sort((p, q) => q.digs - p.digs || p.name.localeCompare(q.name));
  if (!miners.length) return 'every deep miner has a diamond pickaxe';
  if (diamonds < PICK_DIAMONDS) return `diamonds short for a diamond pickaxe (${diamonds} of ${PICK_DIAMONDS})`;
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
