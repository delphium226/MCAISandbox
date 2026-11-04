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
import { takesDamage } from '../../worldMode';

/** harvest_amethyst only where a fall does not hurt (#219). */
export const AMETHYST_TRIP = !takesDamage();

export const FOUNDRY_SKILLS: FoundrySkill[] = [
  fish,
  trade,
  flowers,
  honeycomb,
  wool,
  // (#219: the amethyst trip's spiral stair and its climb were made in a world without damage; in train 20's hostile
  // world 4 of 8 deaths came from one amethyst stair (3 falls, a zombie in the dark). With falls hurting (every mode but
  // peaceful), the skill and its spec are left out, research included, until the descent is made safe. The cobweb trip
  // shares the stair but stays: the string supply's words count on it)
  ...(AMETHYST_TRIP ? [amethyst] : []),
  // (#178, MC_STRING: string from cobwebs; off, the skill and its spec are left out)
  ...(STRING ? [cobweb] : []),
].map(locked);
