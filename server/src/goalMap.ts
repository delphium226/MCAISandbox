/**
 * The start screen's goal mapping (spec runs/2026-10-30/startscreen/spec.md 2.3, as revised in 12.2.4-5): a typed goal's
 * words mapped by one model call (kind goal_map) to the levers the world has: one of the six life-goal measures (or none)
 * and up to 3 pursuit templates; every phrase with no lever is put in `unmatched`, never stretched onto one. The lever
 * catalogue is made from the code's own tables (goals.ts' GOAL_MEANING, pursuits.ts' templates); code checks the answer.
 * Also the village-mode takes (kind goal_take): a member's own version of the village goal, from its persona. World-free:
 * scripts/goal_map.mts and the bench call it.
 */
import { GOALS, GOAL_MEANING, GOAL_TEXT_MAX, clip, type Goal, type GoalSpec } from './goals';
import { TEMPLATES, TEMPLATE_WORDS } from './pursuits';
import { fnv1a } from './choose';
import type { ToolDef } from './world';
import { MODES, worldMode, type WorldMode } from './worldMode';

/** The settings that put a measure in play (goals.ts' goalsInPlay, against a profile's settings, not this process's). */
export const MEASURE_NEEDS: Partial<Record<Goal, string>> = { wealth: 'MC_OWN', invention: 'MC_INNOVATE' };
const ON = /^(on|1|true|yes)$/i;

/** The measures in play under these effective settings (MC_GOALS_ONLY narrows them, as goalsInPlay does). */
export function measuresInPlay(eff: Record<string, string>): Goal[] {
  const only = (eff.MC_GOALS_ONLY ?? '').split(/[,;+]/).filter(Boolean);
  return GOALS.filter((g) => (!MEASURE_NEEDS[g] || ON.test(eff[MEASURE_NEEDS[g]!] ?? '')) && (!only.length || only.includes(g)));
}

/** What the world is, for the words with no lever (the model's facts; spec 2.5's "nothing can be taken"); by MC_WORLD_MODE
 *  (survival: peaceful's words as before; the others say what hurts, and hunger and nights where they are real). */
export function worldFacts(mode: WorldMode = worldMode()): string {
  const m = MODES[mode];
  if (!m.damage) return PEACEFUL_FACTS;
  const harm = m.mobs ? 'Monsters come out at night and in the dark; falls, deep water, fire and lava hurt' : 'There are no hostile mobs, but falls, deep water, fire and lava hurt';
  return `The world: a Minecraft village of members who gather, craft, farm, build and trade. ${harm}${m.hunger ? '; members get hungry and must eat, and nights fall (one member asleep in a bed ends the night)' : ''}. A member who dies wakes at the village storage with their things. There is no stealing (storage is shared and nothing can be taken from another member), no travel beyond walking and no magic. ${PEACEFUL_FACTS.slice(PEACEFUL_FACTS.indexOf('Members can'))}`;
}
const PEACEFUL_FACTS = 'The world: a peaceful Minecraft village of members who gather, craft, farm, build and trade. There are no hostile mobs, no damage, no fighting, no stealing (storage is shared and nothing can be taken from another member), no travel beyond walking and no magic. Members can explore the land around the village (survey points on rings), research new things, make goods, light and decorate the village, furnish their own houses, help others\' projects, build public works, and, when own stock is on, keep and trade goods of their own for emeralds.';
const WORLD_FACTS = worldFacts();

/** The catalogue's version (the cache key's half): changes when a measure's or template's words change. */
export function catalogueVersion(): string {
  return fnv1a(JSON.stringify([GOAL_MEANING, TEMPLATE_WORDS, WORLD_FACTS])).toString(36);
}

/** The lever catalogue as the model reads it: the measures (with which are in play) and the pursuit templates. */
export function catalogue(inPlay: Goal[]): string {
  const m = GOALS.map((g) => `- ${g}${inPlay.includes(g) ? '' : ` (not in play in this run: needs ${MEASURE_NEEDS[g]})`}: ${GOAL_MEANING[g]}`);
  const t = TEMPLATES.map((x) => `- ${x}: ${TEMPLATE_WORDS[x]}`);
  return `${WORLD_FACTS}\n\nMEASURES (a life goal has at most one; it is what the member's progress is counted by):\n${m.join('\n')}\n\nPURSUIT TEMPLATES (projects a member can take on; at most 3, the best first):\n${t.join('\n')}`;
}

export const MAP_TOOL: ToolDef = {
  name: 'map_goal',
  description: 'Map the goal\'s words to the levers in the catalogue. Every phrase that no measure or template really serves goes in unmatched.',
  input_schema: {
    type: 'object',
    properties: {
      measure: { type: ['string', 'null'], enum: [...GOALS, null], description: 'the one measure the goal is about, or null when none fits' },
      pursuits: { type: 'array', items: { type: 'string', enum: [...TEMPLATES] }, maxItems: 3, description: 'pursuit templates that serve the goal, best first' },
      unmatched: { type: 'array', items: { type: 'string' }, description: 'phrases of the goal (quoted from it) that nothing in the catalogue serves' },
      why: { type: 'string', description: 'one short sentence' },
    },
    required: ['measure', 'pursuits', 'unmatched'],
  },
};

/** The mapping call's prompt. */
export function mapPrompt(text: string, inPlay: Goal[]): { system: string; user: string; tools: ToolDef[] } {
  const system = [
    'You map a player\'s goal for a village member onto the levers a simulation has. Answer with one call to map_goal.',
    'Rules: choose a measure only when the goal is mainly about it; choose null when no measure fits. Choose only templates that really serve the goal. Never stretch a lever to fit words it does not serve (stealing is not trading, fighting is not standing, flying is not exploring): put every such phrase, quoted from the goal, in unmatched. A goal can be partly matched: map what fits and list the rest. A measure not in play may still be the right one: choose it if the goal is about it.',
    '',
    catalogue(inPlay),
  ].join('\n');
  return { system, user: `The goal: "${clip(text, 400)}"`, tools: [MAP_TOOL] };
}

export interface Mapped { spec: Omit<GoalSpec, 'by'>; warnings: string[]; valid: boolean; why?: string }

/** The model's answer checked by code: known measure and templates only (at most 3), unmatched as phrases; a measure not in
 *  play is kept with a warning that names the setting. */
export function checkMapping(text: string, input: unknown, inPlay: Goal[], model?: string): Mapped {
  const x = (input ?? {}) as { measure?: unknown; pursuits?: unknown; unmatched?: unknown; why?: unknown };
  const warnings: string[] = [];
  let valid = true;
  let measure: Goal | null = null;
  if (typeof x.measure === 'string' && x.measure && x.measure !== 'null') {
    if ((GOALS as readonly string[]).includes(x.measure)) measure = x.measure as Goal;
    else {
      valid = false;
      warnings.push(`unknown measure "${x.measure}" dropped`);
    }
  }
  const pursuits: string[] = [];
  for (const raw of Array.isArray(x.pursuits) ? x.pursuits : []) {
    // (gpt-oss sometimes gives a template as {template, description}: the name is unambiguous, so it is taken)
    const t = raw && typeof raw === 'object' && typeof (raw as { template?: unknown }).template === 'string' ? (raw as { template: string }).template : raw;
    if (typeof t === 'string' && (TEMPLATES as readonly string[]).includes(t) && !pursuits.includes(t)) pursuits.push(t);
    else {
      valid = false;
      warnings.push(`unknown template "${String(t)}" dropped`);
    }
  }
  if (pursuits.length > 3) warnings.push(`${pursuits.length} templates: the first 3 kept`);
  const unmatched = (Array.isArray(x.unmatched) ? x.unmatched : []).filter((u): u is string => typeof u === 'string' && !!u.trim()).map((u) => clip(u.replace(/^["'\s]+|["'\s]+$/g, ''), 160));
  if (!Array.isArray(x.pursuits) || !Array.isArray(x.unmatched)) valid = false;
  if (measure && !inPlay.includes(measure)) warnings.push(`${measure} needs ${MEASURE_NEEDS[measure]}, which is off in this profile: turn it on?`);
  if (!measure && !pursuits.length) warnings.push('words only: shown to the member, nothing weighs for it');
  return { spec: { text: clip(text, GOAL_TEXT_MAX), measure, pursuits: pursuits.slice(0, 3), unmatched, mappedBy: 'model', ...(model ? { model } : {}) }, warnings, valid, ...(typeof x.why === 'string' ? { why: x.why.slice(0, 200) } : {}) };
}

/** The cache key of a mapping: the text, the measures in play and the catalogue's version. */
export const mapKey = (text: string, inPlay: Goal[]) => `${fnv1a(`${text.trim().toLowerCase()}|${inPlay.join(',')}`).toString(36)}-${catalogueVersion()}`;

export const TAKE_TOOL: ToolDef = {
  name: 'take',
  description: 'Your own version of the village goal.',
  input_schema: { type: 'object', properties: { goal: { type: 'string', description: `one sentence, at most ${GOAL_TEXT_MAX} characters, no "I"` } }, required: ['goal'] },
};

/** A village-mode take's prompt (spec 2.1, with 12.3.3: the persona and archetype only). */
export function takePrompt(villageGoal: string, persona: string): { system: string; user: string; tools: ToolDef[] } {
  return {
    system: `${persona}\n${WORLD_FACTS}\nThe village has set itself a goal. Say what it means for you, in your own way: your own life goal within it, in one short sentence. Your goal must still aim at what the village's goal aims at (if the village wants riches, yours is a way to riches); your character chooses the way, not a different aim. One short sentence (at most ${GOAL_TEXT_MAX} characters, without "I", like "grow rich trading what the far lands yield"). Answer with one call to take.`,
    user: `The village's goal: "${clip(villageGoal, GOAL_TEXT_MAX)}"`,
    tools: [TAKE_TOOL],
  };
}

/** A take's text from the model's answer ('' when none). */
export function checkTake(input: unknown, text = ''): string {
  const g = (input as { goal?: unknown } | null)?.goal;
  const s = typeof g === 'string' ? g : text;
  return clip(s.replace(/^["'\s]+|["'\s.]+$/g, '').replace(/^I\s+(want|will|would like)\s+to\s+/i, ''), GOAL_TEXT_MAX);
}
