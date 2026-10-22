/**
 * Picking flowers (the flowers knowledge gap, 10-22; written by hand, not by the foundry): the existing `collect` skill run
 * on the flower that grows most near the village's storage hut, so the workshop has flowers for dyes (yellow from
 * wildflowers and dandelions, white from lilies of the valley, magenta from lilacs...). Its library spec
 * (server/library/flowers.json) carries a research block: dyeing is a locked innovation entry, so menus are unchanged with
 * MC_INNOVATE off (lock.ts).
 */
import type { BotAgent } from '../botAgent';
import { SURVIVAL_SKILLS } from '../mcSurvival';
import { nearestBlocks, str, num } from '../mcUtil';
import type { FoundryPlaceCtx, FoundrySkill } from './types';

/** The flowers a village may pick, each with the dye it makes (the registry's recipes, 26.1). */
export const FLOWERS: Record<string, string> = {
  wildflowers: 'yellow_dye', dandelion: 'yellow_dye', sunflower: 'yellow_dye', poppy: 'red_dye', rose_bush: 'red_dye', red_tulip: 'red_dye',
  lily_of_the_valley: 'white_dye', lilac: 'magenta_dye', allium: 'magenta_dye', peony: 'pink_dye', pink_tulip: 'pink_dye', pink_petals: 'pink_dye',
  cornflower: 'blue_dye', blue_orchid: 'light_blue_dye', azure_bluet: 'light_gray_dye', oxeye_daisy: 'light_gray_dye', white_tulip: 'light_gray_dye',
  orange_tulip: 'orange_dye', torchflower: 'orange_dye',
};

/** How far from the hut the adapter looks, and how long a village's flower count is kept. */
const REACH = 96, COUNT_MS = 10 * 60000;
const counted = new Map<string, { at: number; hx: number; hz: number; best: string | null; n: number }>();

/** The flower with the most blocks within REACH of the hut (one nearestBlocks search a kind, at most every 10 minutes). */
function bestFlower(ctx: FoundryPlaceCtx): { best: string | null; n: number } {
  const hut = ctx.hut!;
  const key = ctx.village?.name ?? '';
  const hit = counted.get(key);
  if (hit && Date.now() - hit.at < COUNT_MS && hit.hx === hut.x && hit.hz === hut.z) return hit;
  const a = ctx.agent;
  const reg = a?.bot?.registry;
  let best: string | null = null, n = 0;
  if (reg && a.bot.entity?.position) {
    for (const name of Object.keys(FLOWERS)) {
      const id = reg.blocksByName?.[name]?.id;
      if (id === undefined) continue;
      const found = nearestBlocks(a, [id], REACH, 32, (p) => Math.hypot(p.x - hut.x, p.z - hut.z) <= REACH).length;
      if (found > n) {
        best = name;
        n = found;
      }
    }
  }
  const out = { at: Date.now(), hx: hut.x, hz: hut.z, best, n };
  if (key) counted.set(key, out);
  return out;
}

async function pickFlowers(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const flower = args.flower !== undefined ? str(args.flower, 'flower') : 'wildflowers';
  if (!FLOWERS[flower]) throw new Error(`${flower} is not a flower the village picks (${Object.keys(FLOWERS).slice(0, 6).join(', ')}...)`);
  const count = Math.max(1, Math.min(32, Math.floor(args.count !== undefined ? num(args.count, 'count') : 8)));
  const msg = await SURVIVAL_SKILLS.collect.run(a, { block: flower, count }, signal);
  return `picked ${flower.replace(/_/g, ' ')} (for ${FLOWERS[flower].replace(/_/g, ' ')}): ${msg}`;
}

export const FOUNDRY: FoundrySkill = {
  name: 'pick_flowers',
  skill: {
    check: (x) => {
      if (x.flower !== undefined) void str(x.flower, 'flower');
    },
    run: pickFlowers,
  },
  tool: {
    name: 'pick_flowers',
    description: 'Pick flowers growing near the village (by kind: wildflowers, dandelion, poppy, lily_of_the_valley, lilac...) for the workshop to make dyes from.',
    input_schema: {
      type: 'object',
      properties: {
        flower: { type: 'string', description: 'The flower to pick (default wildflowers).' },
        count: { type: 'number', description: 'How many to pick (1-32, default 8).' },
      },
    },
  },
  activity: {
    place(ctx) {
      try {
        if (!ctx?.hut) return { why: 'no storage hut' };
        const { best, n } = bestFlower(ctx);
        return best ? { flower: best } : { why: `no flowers within ${REACH} blocks of the storage hut (n ${n})` };
      } catch {
        return { why: 'no flowers found' };
      }
    },
  },
};
