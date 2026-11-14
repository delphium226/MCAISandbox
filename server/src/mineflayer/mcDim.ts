/**
 * The Nether rung's one rule about dimensions (docs/specs/nether.md section 2): a bot knows its dimension (mineflayer's
 * game plugin sets `bot.game.dimension` from the login and respawn packets); everything that reads "the world" through a
 * bot reads only overworld bots, and everything that acts on a member (watchdogs, rescues, protection) asks first whether
 * it is in the overworld. A member off the overworld belongs to one chore, which owns it until it is home. Nothing else
 * is dimension-aware: village records and RCON commands with coordinates stay the overworld's.
 */

export type Dim = 'overworld' | 'the_nether' | 'the_end';

/** A position with its dimension (the Nether rung's own records: the far portal). */
export interface DimPos {
  x: number;
  y: number;
  z: number;
  dim: Dim;
}

/** Anything with a mineflayer bot, or a bot itself (a fake in the checks: `{ game: { dimension } }`). */
type HasGame = { game?: { dimension?: unknown } } | null | undefined;
type HasBot = { bot?: HasGame } | HasGame;

/** The dimension of a dimension name ('minecraft:the_nether', 'the_nether'); the overworld when unset or unknown. */
export function dimName(name: unknown): Dim {
  const n = String(name ?? '').replace(/^minecraft:/, '');
  return n === 'the_nether' || n === 'the_end' ? n : 'overworld';
}

/** A bot's dimension (or an agent's: its bot's). */
export function dimOf(x: HasBot): Dim {
  const g = x && 'bot' in (x as object) ? (x as { bot?: HasGame }).bot : (x as HasGame);
  return dimName(g?.game?.dimension);
}

/** Whether a bot (or agent) is in the overworld (a bot with no game yet counts as there). */
export const overworld = (x: HasBot): boolean => dimOf(x) === 'overworld';

/** A console command run in a dimension (`execute in minecraft:<dim> run <cmd>`); unchanged for the overworld, the
 *  console's own level. */
export function inDim(dim: Dim, cmd: string): string {
  return dim === 'overworld' ? cmd : `execute in minecraft:${dim} run ${cmd}`;
}

/** The game rules a world mode sets, as commands for every dimension (Paper keeps game rules per dimension: the probe
 *  found the Nether at fire_damage true and keep_inventory false while the overworld had both off, 11-14). */
export const DIMS: Dim[] = ['overworld', 'the_nether', 'the_end'];
