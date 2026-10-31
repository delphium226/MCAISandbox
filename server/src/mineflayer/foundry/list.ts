/**
 * The foundry's skills (types.ts): a ticket adds its file to this folder and one import plus one entry here, and edits
 * no other table (mcSkills.ts and the world add these to MC_SKILLS and the tools). A skill whose library spec carries a
 * `research` block is locked until a village researches it (lock.ts, G6).
 */
import type { FoundrySkill } from './types';
import { locked } from './lock';
import { FOUNDRY as fish } from './fish';
import { FOUNDRY as trade } from './trade';
import { FOUNDRY as flowers } from './flowers';
import { FOUNDRY as honeycomb } from './honeycomb';
import { FOUNDRY as wool } from './wool';
import { FOUNDRY as amethyst } from './amethyst';
import { FOUNDRY as cobweb } from './cobweb';
import { STRING } from '../../supply';

export const FOUNDRY_SKILLS: FoundrySkill[] = [
  fish,
  trade,
  flowers,
  honeycomb,
  wool,
  amethyst,
  // (#178, MC_STRING: string from cobwebs; off, the skill and its spec are left out)
  ...(STRING ? [cobweb] : []),
].map(locked);
