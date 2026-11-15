/**
 * #251 (MC_WILD_NESTS, on): the bees rung's nests from the land. A bee nest cannot be moved without Silk Touch (broken, it
 * drops nothing and its bees turn on the breaker), so a player who finds one tends it where it hangs: a lit campfire set
 * under it (within 5 blocks, nothing solid between: its smoke calms the bees) and the nest is sheared and bottled there.
 * The village does the same with the wild nests the atlas has seen within its range: each one tended so counts as one of
 * the rung's 2 hives (its own bees, nothing bought), and the apiary's shearing and bottling go to it too. While two wild
 * nests can be tended the merchant's nests are not bought; otherwise the apiary of bought nests stays the way.
 * World-free: the record (village.ts `apiary.wild`), the candidates, the campfire's cell. mcWorld.ts finds the nests (the
 * atlas, mcAtlas.ts nestsNear) and offers the chore; mcBuild.ts tend_wild_nest sets the campfire.
 */
import type { Village } from './village';
import { rawSetting } from './settings';

export const WILD_NESTS = !/^(off|0|false|no)$/i.test(rawSetting('MC_WILD_NESTS') ?? 'on');
/** Minutes before a nest that could not be tended (no room for a campfire, no bees, gone) is tried again. */
export const WILD_RETRY_MIN = 30;
/** The most blocks under a nest a campfire's smoke reaches it from (vanilla's CampfireBlock.isSmokeyPos looks 5 down). */
export const SMOKE_REACH = 5;

/** The wild nests tended (a campfire set under each), as x, y, z. */
export function wildTended(v: Village): Array<[number, number, number]> {
  return Object.entries(v.apiary?.wild ?? {}).filter(([, w]) => !!w.campfire).map(([k]) => k.split(',').map(Number) as [number, number, number]);
}

/** Whether a wild nest's record lets it be tried now: not tended yet and not failed within WILD_RETRY_MIN (game minutes
 *  as wall minutes times the time scale: `scale`). */
export function wildOpen(w: { campfire?: unknown; fail?: string; at?: number } | undefined, now: number, scale = 1): boolean {
  if (!w || w.campfire) return false;
  return !w.fail || now - (w.at ?? 0) > (WILD_RETRY_MIN * 60000) / Math.max(1, scale);
}

/** The wild nests the village may still tend, nearest the hut first. */
export function wildCandidates(v: Village, hut: { x: number; z: number }, now: number, scale = 1): Array<[number, number, number]> {
  return Object.entries(v.apiary?.wild ?? {}).filter(([, w]) => wildOpen(w, now, scale)).map(([k]) => k.split(',').map(Number) as [number, number, number])
    .sort((p, q) => Math.hypot(p[0] - hut.x, p[2] - hut.z) - Math.hypot(q[0] - hut.x, q[2] - hut.z));
}

/** Whether the wild nests tended and still to tend cover the rung's hives (so no nest need be bought). */
export function wildCover(v: Village, need: number, now = Date.now(), scale = 1): boolean {
  if (!WILD_NESTS) return false;
  const w = v.apiary?.wild ?? {};
  return Object.values(w).filter((x) => !!x.campfire || wildOpen(x, now, scale)).length >= need;
}

/** A cell that takes a campfire: air or a plant it replaces. */
const ROOM = /^(air|cave_air|short_grass|grass|tall_grass|fern|large_fern|snow|dead_bush|wildflowers|pink_petals|leaf_litter|bush|firefly_bush|short_dry_grass|tall_dry_grass|dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|torchflower)$|_tulip$/;

/**
 * Where the campfire goes under a nest: `under[k - 1]` is the block k below the nest (k = 1 .. SMOKE_REACH + 1), `solid(name)`
 * whether a block holds one up. The first cell from the top that takes a campfire and stands on a solid block, every cell
 * above it open (the smoke rises through): its depth k; or a lit campfire already there (`have`); or why there is none.
 */
export function campfireCell(under: string[], solid: (name: string) => boolean): { k: number; have?: boolean } | { why: string } {
  for (let k = 1; k <= SMOKE_REACH; k++) {
    const b = under[k - 1] ?? '';
    if (b === 'campfire') return { k, have: true };
    if (!ROOM.test(b)) return { why: `${b || 'an unread block'} ${k} below the nest blocks the smoke` };
    const below = under[k] ?? '';
    if (solid(below) && below !== 'campfire') return { k };
  }
  return { why: `no ground within ${SMOKE_REACH} blocks under the nest` };
}
