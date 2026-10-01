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

/**
 * Game speed for tests (MC_TIME_SCALE, plan step T.1): the server runs at 20 x this many ticks a second and the bots'
 * physics follows (botAgent.ts, the Mineflayer patch in patches/); digs keep their real-time length (Paper times them by
 * the wall clock). 1 when unset; acceptance runs stay at 1.
 */
export function timeScale(): number {
  const s = Number(process.env.MC_TIME_SCALE ?? 1);
  return Number.isFinite(s) && s >= 1 && s <= 4 ? s : 1;
}

export interface WorldRulesStatus {
  ok: boolean;
  /** The server's target tick rate as `tick query` reads it back (20 at normal speed). */
  tickRate?: number;
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
  // Every start sets the tick rate, so a test at 2x never leaves the server fast for the next run
  const rate = Math.round(20 * timeScale());
  await rcon.command(`tick rate ${rate}`);
  const query = await rcon.command('tick query');
  const tickRate = Number(/target tick rate:\s*([\d.]+)/i.exec(query)?.[1]);
  if (tickRate !== rate) problems.push(`tick rate: wanted ${rate}, server says ${query.trim() || 'nothing'}`);
  const ok = problems.length === 0;
  const speed = rate === 20 ? '' : `, tick rate ${rate} (${timeScale()}x)`;
  const summary = ok
    ? `peaceful, no damage, keep_inventory, always day${speed} (${Object.keys(WORLD_RULES).length} game rules checked)`
    : `world settings NOT applied: ${problems.join('; ')}`;
  return { ok, tickRate: Number.isFinite(tickRate) ? tickRate : undefined, summary, problems, checkedAt: Date.now() };
}
