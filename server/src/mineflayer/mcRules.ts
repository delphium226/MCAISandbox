/**
 * The peaceful village economy's world settings: no hostile mobs and no damage, so agents only gather, craft and build.
 * Applied over RCON every time the agent server starts, then read back. 26.1 names game rules in snake_case
 * (fall_damage, keep_inventory); the old camelCase names are rejected.
 */
import type { Rcon } from './rcon';

/** Game rule -> the value it must have. */
export const WORLD_RULES: Record<string, string> = {
  fall_damage: 'false',
  drowning_damage: 'false',
  fire_damage: 'false',
  freeze_damage: 'false',
  keep_inventory: 'true',
  // Peaceful already stops these; the rules keep them off if the difficulty is ever reset
  spawn_monsters: 'false',
  spawn_phantoms: 'false',
  spawn_patrols: 'false',
  spawn_wardens: 'false',
  // Lightning or lava must not burn down plank villages
  fire_spread_radius_around_player: '0',
  // Always day, so the user can watch (26.1's name for doDaylightCycle)
  advance_time: 'false',
};

export interface WorldRulesStatus {
  ok: boolean;
  /** One line for the log and the panel. */
  summary: string;
  problems: string[];
  checkedAt: number;
}

/** Set peaceful difficulty and the game rules, then check each one reads back as set. */
export async function applyWorldRules(rcon: Rcon): Promise<WorldRulesStatus> {
  const problems: string[] = [];
  await rcon.command('difficulty peaceful');
  const difficulty = await rcon.command('difficulty');
  if (!/peaceful/i.test(difficulty)) problems.push(`difficulty: ${difficulty.trim() || 'no answer'}`);
  for (const [rule, value] of Object.entries(WORLD_RULES)) {
    await rcon.command(`gamerule ${rule} ${value}`);
    const reply = await rcon.command(`gamerule ${rule}`);
    const now = /set to:\s*(\S+)/.exec(reply)?.[1];
    if (now !== value) problems.push(`${rule}: wanted ${value}, server says ${reply.trim() || 'nothing'}`);
  }
  const ok = problems.length === 0;
  const summary = ok
    ? `peaceful, no damage, keep_inventory, always day (${Object.keys(WORLD_RULES).length} game rules checked)`
    : `world settings NOT applied: ${problems.join('; ')}`;
  return { ok, summary, problems, checkedAt: Date.now() };
}
