/**
 * Foundry skill `gather_string` (#178): string from cobwebs, the peaceful world's string (no spiders). Cobwebs lie in
 * mineshafts and trial chambers (the test world: 44 within 128 blocks of minevale3, the nearest 78 off and ~30 down); a
 * sword breaks one into a string (by hand or with a pickaxe it drops nothing, shears give the web). The trip is the
 * amethyst one: a staircase down with a pickaxe, the webs within reach broken with the sword, the string picked up, the
 * climb back. Two string and three sticks make a fishing rod in the workshop. runs/2026-10-31/rod/report.md.
 */
import type { FoundrySkill } from './types';
import { digDownSkill, type DigKind } from './amethyst';

export const COBWEB: DigKind = {
  skill: 'gather_string',
  tag: 'cobweb',
  block: 'cobweb',
  item: 'string',
  breakWith: { tiers: ['netherite_sword', 'diamond_sword', 'iron_sword', 'golden_sword', 'stone_sword', 'wooden_sword'], words: 'sword' },
  scout: true,
  target: 'cobweb',
  itemWords: 'string',
  explore: 'cobwebs lie in old mineshafts underground',
  description: 'Dig down to cobwebs underground (old mineshafts) with a pickaxe and break them with a sword for string.',
};

export const FOUNDRY: FoundrySkill = digDownSkill(COBWEB);
