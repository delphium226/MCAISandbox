/**
 * Skills built by the foundry (X.3, s41's spec_proposals_v2 A): one file each in this folder, exporting FOUNDRY, listed
 * once in list.ts. A skill may come with an activity adapter, which lets the `activity` chore kind run it from a library
 * spec (server/library/*.json): where the skill is done (its place) and what it holds while it runs.
 */
import type { ToolDef } from '../../world';
import type { Village } from '../../village';
import type { BotAgent } from '../botAgent';
import type { McSkill } from '../mcSkills';
import type { Counts } from '../mcMaterials';

export interface FoundryPlaceCtx {
  village: Village;
  agent: BotAgent;
  /** The village's storage hut centre (x, y, z), or null when it has none. */
  hut: { x: number; y: number; z: number } | null;
}

/** A run chosen in code (pick): the skill's arguments, what to withdraw from storage first, and what it gives. */
export interface FoundryPick {
  args: Record<string, unknown>;
  needs: Counts;
  /** The items its deposit counts (default: the spec's gives). */
  gives?: string[];
  /** A few words for the menu's facts ("sells 32 birch logs for 2 emeralds"). */
  facts?: string;
}

export interface FoundryActivity {
  /**
   * The skill's place arguments for one run (e.g. x, y, z of a water edge), or why there is none. Called inside the menu
   * for every idle member: cheap, cached by the module per village, never throws (lesson 104; a throw reads as no place).
   */
  place(ctx: FoundryPlaceCtx): Record<string, unknown> | { why: string };
  /**
   * A spec whose run is chosen in code each time (the merchant's trades): its arguments, needs and gives from the spare
   * storage now, or why there is none; it replaces the spec's needs, gives and keep. Cheap and never throwing, as place.
   */
  pick?(ctx: FoundryPlaceCtx & { spare: Counts; spec: string }): FoundryPick | { why: string };
  /** Keys this activity holds while it runs (shared things: a pen, a water spot), beyond its own `activity:<id>`. */
  holds?(v: Village): string[];
}

export interface FoundrySkill {
  /** The skill's name, as in its tool definition. */
  name: string;
  skill: McSkill;
  tool: ToolDef;
  activity?: FoundryActivity;
}
