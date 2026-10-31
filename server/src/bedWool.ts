/**
 * #187 (MC_BED_WOOL, on): the members' beds from the village's own sheep, so that in a world with nights
 * (MC_WORLD_MODE=easy and up) a bed comes soon and one sleeper ends the night. Measured first
 * (runs/2026-10-31/fixes187/report.md): the pristine test world holds 0-7 sheep within 64 blocks of a site and 1-16
 * within 96; a sheep pen sheared every 5 minutes gave 56 wool in 45 minutes (staged SC_easy: 18 beds, every night after
 * the first slept through); with no iron there are no shears and no wool (staged SB_easy: the mine met caves, one ingot in
 * 45 minutes, no bed). So, while any owned house lacks its bed:
 * - shears first: the forge makes the village's shears before its pickaxe and bucket when nobody has a pair (2 ingots);
 * - sheep first: leading sheep into a pen ranks before the other kinds;
 * - wild sheep one shearer at a time, and none for WILD_BACK_MS after a shearing came back short (SC_easy sent six
 *   members to three sheep at once; all six failed).
 * Pure; mcWorld's menus and forge read it (scripts/checks/bed_wool_unit.mts).
 */
import { rawSetting } from './settings';

export const BED_WOOL = { on: !/^(off|0|false|no)$/i.test(rawSetting('MC_BED_WOOL') ?? 'on') };

/** Whether the forge's next tool is the village's shears: beds owed and no pair in storage or in any member's hands. */
export function shearsFirst(bedsOwed: number, shears: number): boolean {
  return BED_WOOL.on && bedsOwed > 0 && shears < 1;
}

/** The pen kinds in the order the menu offers them: sheep first while beds are owed. */
export function penOrder(order: readonly string[], bedsOwed: number): string[] {
  if (!BED_WOOL.on || bedsOwed < 1 || !order.includes('sheep')) return [...order];
  return ['sheep', ...order.filter((k) => k !== 'sheep')];
}

/** The busy key one wild-sheep shearer holds at a time (a village's own: menu keys are per village). */
export const WILD_SHEAR_KEY = 'shear:wild';
/** How long wild shearing waits after one came back short (wool grows back as a sheep eats grass: about a minute each). */
export const WILD_BACK_MS = 4 * 60000;

const wildBack = new Map<string, number>();
/** A wild shearing's end: short (fewer than 3 wool of one colour) backs the village's wild shearing off. */
export function noteWildShear(village: string, short: boolean, now = Date.now()): void {
  if (short && BED_WOOL.on) wildBack.set(village, now + WILD_BACK_MS);
  else wildBack.delete(village);
}
/** Why wild shearing waits now, or null. */
export function wildShearWait(village: string, now = Date.now()): string | null {
  const t = wildBack.get(village);
  if (!BED_WOOL.on || t === undefined || t <= now) return null;
  return `the sheep near the village were sheared lately; their wool grows back in about ${Math.max(1, Math.ceil((t - now) / 60000))} min`;
}
