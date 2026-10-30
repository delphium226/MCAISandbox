/**
 * The village economy's world settings: peaceful by default (no hostile mobs and no damage, so agents only gather, craft
 * and build), or a survival stage's rules (MC_WORLD_MODE, the table in worldMode.ts).
 * Applied over RCON every time the agent server starts, then read back. 26.1 names game rules in snake_case
 * (fall_damage, keep_inventory); the old camelCase names are rejected.
 */
import type { Rcon } from './rcon';
import { rawSetting } from '../settings';
import { modeSpec, worldMode, type WorldMode } from '../worldMode';

/**
 * Game speed for tests (MC_TIME_SCALE, plan step T.1): the server runs at 20 x this many ticks a second and the bots'
 * physics follows (botAgent.ts, the Mineflayer patch in patches/); digs keep their real-time length (Paper times them by
 * the wall clock). 1 when unset; acceptance runs stay at 1.
 */
export function timeScale(): number {
  const s = Number(rawSetting('MC_TIME_SCALE') ?? 1);
  return Number.isFinite(s) && s >= 1 && s <= 4 ? s : 1;
}

/**
 * Random ticks per chunk section a tick (MC_RANDOM_TICK, the game rule random_tick_speed; vanilla 3): what makes crops,
 * cane, pumpkins and saplings grow, leaves decay and grass spread. Staged tests of the after phase raise it so fields
 * ripen in minutes instead of half an hour, by the game's own growth (unlike --ripen-fields). Set at every start, so a fast
 * value never stays for the next run; acceptance runs stay at 3.
 */
export function randomTickSpeed(): number {
  const s = Number(rawSetting('MC_RANDOM_TICK') ?? 3);
  return Number.isInteger(s) && s >= 0 && s <= 300 ? s : 3;
}

/**
 * Haste for every bot (MC_HASTE, the effect's level; 0 or unset: none): staged tests dig faster for real, since Paper's dig
 * check and Mineflayer's digTime both count the effect (lesson 40 still holds: digTime is never shortened by hand). Each
 * level is +20% dig speed (level 5 about 2x). Given at every spawn (mcWorld.ts); acceptance runs go without.
 */
export function hasteLevel(): number {
  const s = Number(rawSetting('MC_HASTE') ?? 0);
  return Number.isInteger(s) && s >= 0 && s <= 10 ? s : 0;
}

export interface WorldRulesStatus {
  ok: boolean;
  /** The mode the rules were set for (MC_WORLD_MODE; the scripts compare it with the one they asked for). */
  mode?: WorldMode;
  /** The server's target tick rate as `tick query` reads it back (20 at normal speed). */
  tickRate?: number;
  /** One line for the log and the panel. */
  summary: string;
  problems: string[];
  checkedAt: number;
}

/** Set the mode's difficulty and game rules, then check each one reads back as set. */
export async function applyWorldRules(rcon: Rcon): Promise<WorldRulesStatus> {
  const problems: string[] = [];
  const mode = worldMode(), spec = modeSpec();
  await rcon.command(`difficulty ${spec.difficulty}`);
  const difficulty = await rcon.command('difficulty');
  if (!new RegExp(spec.difficulty, 'i').test(difficulty)) problems.push(`difficulty: wanted ${spec.difficulty}, ${difficulty.trim() || 'no answer'}`);
  for (const [rule, value] of Object.entries(spec.rules)) {
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
  // Likewise the random tick speed (3 unless a test asks for faster growth)
  const ticks = String(randomTickSpeed());
  await rcon.command(`gamerule random_tick_speed ${ticks}`);
  const tickReply = await rcon.command('gamerule random_tick_speed');
  if (/set to:\s*(\S+)/.exec(tickReply)?.[1] !== ticks) {
    problems.push(`random_tick_speed: wanted ${ticks}, server says ${tickReply.trim() || 'nothing'}`);
  }
  const ok = problems.length === 0;
  const speed = (rate === 20 ? '' : `, tick rate ${rate} (${timeScale()}x)`)
    + (ticks === '3' ? '' : `, random ticks ${ticks} (MC_RANDOM_TICK)`)
    + (hasteLevel() ? `, bots with haste ${hasteLevel()} (MC_HASTE)` : '');
  const summary = ok
    ? `${spec.summary}${speed} (${Object.keys(spec.rules).length} game rules checked)`
    : `world settings NOT applied: ${problems.join('; ')}`;
  return { ok, mode, tickRate: Number.isFinite(tickRate) ? tickRate : undefined, summary, problems, checkedAt: Date.now() };
}
