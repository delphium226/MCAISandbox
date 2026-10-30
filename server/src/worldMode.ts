/**
 * The world's mode (MC_WORLD_MODE, the survival research's stages, runs/2026-10-30/survival/report.md): which game rules
 * and difficulty the agent server sets (mineflayer/mcRules.ts), whether members take damage (reflexes, walks' drop limit,
 * spawnpoints, botAgent.ts) and what the prompts say about harm (choose.ts' primer, memory.ts' note check). Peaceful by
 * default (the user's, 10-30: survival is an opt-in side experiment, an exception to the flags-on rule).
 *  - peaceful: no hostile mobs, no damage, always day (the base premise);
 *  - damage: stage (a): falls, drowning and fire (lava too) hurt; still peaceful difficulty, always day;
 *  - easy: stage (b)'s rules: easy difficulty (hunger real, starvation stops at 10 hp), no monsters, day and night;
 *  - normal: stage (c)'s rules on normal difficulty: monsters at night and in the dark, mob griefing off.
 * keep_inventory stays on in every mode (the user's, 10-30). easy and normal are rule sets only: the curfew, the eating
 * reflex and the fighting reflex's extensions are stages (b) and (c).
 */
import { rawSetting } from './settings';

export type WorldMode = 'peaceful' | 'damage' | 'easy' | 'normal';
export const WORLD_MODES: readonly WorldMode[] = ['peaceful', 'damage', 'easy', 'normal'];

export interface ModeSpec {
  difficulty: 'peaceful' | 'easy' | 'normal';
  /** Game rule -> the value it must have (every mode sets the same rules, so a switch back leaves nothing behind). */
  rules: Record<string, string>;
  /** Members take damage (falls, drowning, fire): the reflexes, the drop limit and the spawnpoints are on. */
  damage: boolean;
  /** Hostile mobs spawn. */
  mobs: boolean;
  /** The status line's words. */
  summary: string;
}

const BASE: Record<string, string> = {
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
  // (vanilla's value; off only with monsters: creepers and endermen take blocks. Sheep eating grass needs it)
  mob_griefing: 'true',
};
const HURTS = { fall_damage: 'true', drowning_damage: 'true', fire_damage: 'true' };

export const MODES: Record<WorldMode, ModeSpec> = {
  peaceful: { difficulty: 'peaceful', rules: BASE, damage: false, mobs: false, summary: 'peaceful, no damage, keep_inventory, always day' },
  damage: { difficulty: 'peaceful', rules: { ...BASE, ...HURTS }, damage: true, mobs: false,
    summary: 'peaceful, damage on (falls, drowning, fire), keep_inventory, always day (MC_WORLD_MODE=damage)' },
  easy: { difficulty: 'easy', rules: { ...BASE, ...HURTS, advance_time: 'true' }, damage: true, mobs: false,
    summary: 'easy, damage and hunger on, no monsters, keep_inventory, day and night (MC_WORLD_MODE=easy)' },
  normal: { difficulty: 'normal', rules: { ...BASE, ...HURTS, advance_time: 'true', spawn_monsters: 'true', mob_griefing: 'false' }, damage: true, mobs: true,
    summary: 'normal, damage and hunger on, monsters, no mob griefing, keep_inventory, day and night (MC_WORLD_MODE=normal)' },
};

/** The mode a value names, or null (case and spaces aside). */
export function parseMode(v: string | undefined): WorldMode | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s) return 'peaceful';
  return (WORLD_MODES as readonly string[]).includes(s) ? (s as WorldMode) : null;
}

let warned = false;
/** This process's mode (an unknown value is peaceful, with one warning). */
export function worldMode(): WorldMode {
  const raw = rawSetting('MC_WORLD_MODE');
  const m = parseMode(raw);
  if (m) return m;
  if (!warned) {
    warned = true;
    console.log(`[world] MC_WORLD_MODE=${raw} is not one of ${WORLD_MODES.join(', ')}: peaceful`);
  }
  return 'peaceful';
}

export const modeSpec = (): ModeSpec => MODES[worldMode()];
/** Members take damage in this mode. */
export const takesDamage = (): boolean => modeSpec().damage;

/** The primer's first sentence (choose.ts, MC_PRIMER) by mode. */
export function harmLine(mode: WorldMode = worldMode()): string {
  const m = MODES[mode];
  if (!m.damage) return 'you live in a peaceful Minecraft world, with no monsters and no harm; nobody dies.';
  return (m.mobs
    ? 'you live in a Minecraft world where monsters come out at night and in the dark, and falls, deep water, fire and lava hurt; '
    : 'you live in a Minecraft world with no monsters, but falls, deep water, fire and lava hurt; ')
    + 'a member who dies wakes at the village storage with their things and walks back to work.';
}
