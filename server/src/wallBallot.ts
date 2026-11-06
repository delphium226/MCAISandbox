/**
 * #217 step 1 (MC_WALL_BALLOT, on; with monsters only): what the wall's vote shows, pure (the world and the ballot bench
 * both use it). Never whether the vote is held or who decides (the user's 11-04 ruling): the vote keeps its own frame (the
 * `wall` topic in vote.ts), the benefit is given in the counts a wall answers (monsters and harm near home, not deaths on
 * far trips, which are pointed at the curfew), the option is the next stage with its own bill, the "no" is worded
 * neutrally, and a member who kept watch or was hurt near home is named as its proposer (the user's answers to Q4).
 */
import type { VoteOption } from './vote';

/** The danger count's numbers the ballot reads (mcCombat's Danger, near home and far). */
export interface WallStake {
  /** Most hostiles seen within 48 blocks of home at one count after dark. */
  peak48: number;
  /** Deaths within 48 of home, 48-100, over 100 (trips). */
  deathsNear: number;
  deathsMid: number;
  deathsFar: number;
  /** Members hit by a monster within the built bounds + 16. */
  hurtNear: number;
}

/** A stage on the ballot: its name, what it is and does, and its bill. */
export interface WallStage {
  id: string;
  /** 'ring': the fence ring (stage 1); 'towers': towers and gatehouses on the ring (stage 2). */
  kind: 'ring' | 'towers';
  cells: number;
  parts: number;
  bill: Record<string, number>;
  /** Water on the ring: closed by stone dams (MC_WALL_WATER), or left open. */
  water: 'dammed' | 'open';
  towers?: number;
  gatehouses?: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const billWords = (b: Record<string, number>) => Object.entries(b).filter(([, n]) => n > 0).sort((p, q) => q[1] - p[1]).slice(0, 3)
  .map(([k, n]) => `~${n} ${k.replace(/_/g, ' ')}`).join(', ');

/** The benefit in counts, scoped to what a wall at the village's edge answers; '' when there is nothing near home. */
export function stakeWords(s: WallStake): string {
  const near: string[] = [];
  if (s.peak48) near.push(`up to ${s.peak48} monsters came within 48 blocks of home at night`);
  if (s.deathsNear) near.push(`${plural(s.deathsNear, 'member')} killed near home`);
  if (s.hurtNear) near.push(`${plural(s.hurtNear, 'hit')} on members by monsters inside the village`);
  const far = s.deathsMid + s.deathsFar;
  // (the bench's control, 11-05: with nothing said of the danger, 152 of 300 ballots took the wall, more than with it shown:
  // the absence is a fact the voter needs too)
  const out = near.length ? `So far ${near.join('; ')}.` : 'So far no monsters have come near home at night and no member has been hurt or killed near home.';
  return far ? `${out}${out ? ' ' : ''}${plural(far, 'death')} on trips away from home ${far === 1 ? 'is' : 'are'} not something a wall prevents (the curfew is for those).` : out;
}

/**
 * Members' hours a stage takes in all: building (~200 ring cells or ~250 stone an hour, N11's staged ring) and mining the
 * stone (~250 an hour a member, the trains' mine trips), rounded.
 */
export function stageHours(st: WallStage): number {
  const stone = st.bill.cobblestone ?? st.bill.stone ?? 0;
  return Math.max(1, Math.round(st.kind === 'ring' ? st.cells / 200 + stone / 250 : stone / 250 + stone / 250));
}

/** The stage's option: what it is, what it does (only what its plan can do), who builds it, its bill and its time. */
export function stageOption(st: WallStage, cap: number): VoteOption {
  const builders = `built by members who take its chores (at most ${plural(cap, 'member')} at a time), about ${plural(stageHours(st), 'hour')} of members' work in all`;
  if (st.kind === 'ring') {
    const does = st.water === 'dammed'
      ? 'once closed it keeps zombies and skeletons out at night (spiders can still climb it; gates shut behind members; stone dams where it crosses water)'
      : 'once closed it keeps zombies and skeletons out at night (spiders can still climb it; gates shut behind members), but it stays open where it crosses water';
    return {
      id: st.id, name: 'A wall round the village', current: false, novel: true,
      facts: `a fence on a stone footing ${st.cells} blocks round, 6 blocks outside the houses, with gates and torches; ${does}; ${builders}; ${billWords(st.bill)} from storage and the mine`.slice(0, 500),
      units: Math.ceil(st.cells / 16), volume: st.cells * 2,
    };
  }
  return {
    id: st.id, name: 'Watchtowers and gatehouses on the wall', current: false, novel: true,
    facts: `${plural(st.towers ?? 0, 'stone tower')} on the wall's corners and ${plural(st.gatehouses ?? 0, 'stone gatehouse')} where streets cross it: posts to keep watch from at night and see monsters coming; ${builders}; ${billWords(st.bill)}, from storage and the mine`.slice(0, 500),
    units: Math.ceil(Object.values(st.bill).reduce((n, q) => n + q, 0) / 64), volume: (st.towers ?? 0) * 200 + (st.gatehouses ?? 0) * 300,
  };
}

/**
 * The "no" option, neutral (neither freedom nor loss), for the stage voted (#232: the stone stage's "no" read "No wall for
 * now" while the fence ring stood, and ballots answered whether to have a wall at all).
 */
export function noneOption(id: string, kind: WallStage['kind'] = 'ring'): VoteOption {
  if (kind === 'towers')
    return { id, name: 'No towers for now', facts: 'the fence ring stays as it is, without stone towers or gatehouses; members keep to their other work; nights rely on the ring, the curfew, the lamps and the watch; the village is asked again after another death', current: true, novel: false, units: 0, volume: 0 };
  return { id, name: 'No wall for now', facts: 'members keep to their other work; nights rely on the curfew, the lamps and the watch; the village is asked again after another death', current: true, novel: false, units: 0, volume: 0 };
}

/**
 * Who proposes the wall: the member with the most watch nights, else the last member hurt near home; null when none.
 * Its line for the ballot ("Proposed by Iris, who kept watch 2 nights.").
 */
export function wallProposer(watchNights: Record<string, number>, lastHurtNear: string | undefined, members: string[]): { by: string; line: string } | null {
  const watch = Object.entries(watchNights).filter(([n, k]) => k > 0 && members.includes(n)).sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]))[0];
  if (watch) return { by: watch[0], line: `Proposed by ${watch[0]}, who kept watch ${plural(watch[1], 'night')}.` };
  if (lastHurtNear && members.includes(lastHurtNear)) return { by: lastHurtNear, line: `Proposed by ${lastHurtNear}, who was hurt by a monster inside the village.` };
  return null;
}

/** A member's proposal that asks for a wall or a defence (G5's store): it opens a refused wall's vote again. */
export const asksForWall = (text: string): boolean => /\b(wall|walls|palisade|rampart|fortif\w*|defen[cs]es?|stockade|watchtower)\b/i.test(text);
