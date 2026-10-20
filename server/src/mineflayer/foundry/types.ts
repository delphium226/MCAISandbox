/**
 * Skills built by the foundry (X.3, s41's spec_proposals_v2 A): one file each in this folder, exporting FOUNDRY, listed
 * once in list.ts. A skill may come with an activity adapter, which lets the `activity` chore kind run it from a library
 * spec (server/library/*.json): where the skill is done (its place) and what it holds while it runs.
 */
import type { ToolDef } from '../../world';
import type { Village } from '../../village';
import type { BotAgent } from '../botAgent';
import type { McSkill } from '../mcSkills';

export interface FoundryPlaceCtx {
  village: Village;
  agent: BotAgent;
  /** The village's storage hut centre (x, y, z), or null when it has none. */
  hut: { x: number; y: number; z: number } | null;
}

export interface FoundryActivity {
  /**
   * The skill's place arguments for one run (e.g. x, y, z of a water edge), or why there is none. Called inside the menu
   * for every idle member: cheap, cached by the module per village, never throws (lesson 104; a throw reads as no place).
   */
  place(ctx: FoundryPlaceCtx): Record<string, unknown> | { why: string };
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
