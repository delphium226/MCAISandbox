/**
 * The foundry's skills (types.ts): a ticket adds its file to this folder and one import plus one entry here, and edits
 * no other table (mcSkills.ts and the world add these to MC_SKILLS and the tools).
 */
import type { FoundrySkill } from './types';
import { FOUNDRY as fish } from './fish';

export const FOUNDRY_SKILLS: FoundrySkill[] = [
  fish,
];
