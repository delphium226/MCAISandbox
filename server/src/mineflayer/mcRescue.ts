/**
 * Getting a stuck bot out: a bot whose moves keep failing from one spot (a pit, a lake, a hole it dug itself) swims up,
 * walks out in any direction, climbs out (digging up through natural blocks and pillaring with carried ones), and as
 * a last resort is teleported beside its village's storage over RCON, which is logged as such. Before this,
 * Meadowford3's Worker1 failed 25 actions over 13 minutes from one spot in a lake.
 */
import { Vec3 } from 'vec3';
import type { BotAgent } from './botAgent';
import { at, checkAbort, goals, sleep, walk } from './mcUtil';
import { timeScale } from './mcRules';
// Blocks the climb may dig through: natural terrain only, never anything built
import { RESCUE_DIGGABLE as DIGGABLE } from './mcBlocks';

/** Carried blocks it may pillar with (dirt and plain stone first; never planks, logs or glass). */
const PILLAR = ['dirt', 'coarse_dirt', 'sand', 'red_sand', 'netherrack', 'andesite', 'diorite', 'granite', 'tuff', 'stone', 'cobblestone', 'cobbled_deepslate'];

const inWater = (a: BotAgent) => !!(a.bot.entity as unknown as { isInWater?: boolean }).isInWater;
const solid = (a: BotAgent, p: Vec3) => a.bot.blockAt(p)?.boundingBox === 'block';

/** Swim straight up, then toward the nearest dry ground, for up to 10 seconds. */
async function swimUp(a: BotAgent, signal: AbortSignal) {
  const bot = a.bot;
  bot.pathfinder.stop();
  bot.setControlState('jump', true);
  try {
    for (let i = 0; i < 50 && inWater(a); i++) {
      // Forward once at the surface, toward the shore
      if (i === 15) bot.setControlState('forward', true);
      await sleep(200, signal);
    }
    await sleep(400, signal);
  } finally {
    bot.clearControlStates();
  }
}

/** Walk to any point about 10 blocks away (four directions, a few seconds each). */
async function walkOut(a: BotAgent, from: Vec3, signal: AbortSignal): Promise<boolean> {
  for (let i = 0; i < 8; i += 2) {
    const ang = (i * Math.PI) / 4;
    const x = Math.round(from.x + Math.cos(ang) * 10), z = Math.round(from.z + Math.sin(ang) * 10);
    try {
      await walk(a, new goals.GoalNearXZ(x, z, 3), `${x},${z}`, signal, 20000);
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
    }
    if (a.bot.entity.position.distanceTo(from) > 4 && !inWater(a)) return true;
  }
  return false;
}

/** The highest ground in the ring around a column (where climbing out has to get to). */
function rimHeight(a: BotAgent, feet: Vec3): number {
  let top = feet.y;
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) {
      if (!dx && !dz) continue;
      for (let y = feet.y + 12; y > top; y--)
        if (solid(a, new Vec3(feet.x + dx, y, feet.z + dz))) {
          top = y + 1;
          break;
        }
    }
  return top;
}

/**
 * Climb straight up: dig natural blocks above the head, jump and put a carried block underfoot, until level with the
 * rim around. Returns how many blocks it rose, or why it could not.
 */
async function climb(a: BotAgent, signal: AbortSignal): Promise<{ rose: number; why?: string }> {
  const bot = a.bot;
  const start = bot.entity.position.floored();
  const goal = rimHeight(a, start);
  for (let i = 0; i < 16; i++) {
    checkAbort(signal);
    const feet = bot.entity.position.floored();
    if (feet.y >= goal) return { rose: feet.y - start.y };
    for (const up of [2, 3]) {
      const b = bot.blockAt(feet.offset(0, up, 0));
      if (!b || b.boundingBox !== 'block') continue;
      if (!DIGGABLE.has(b.name)) return { rose: feet.y - start.y, why: `${b.name} overhead (built, not dug)` };
      const tool = bot.pathfinder.bestHarvestTool(b);
      if (tool) await bot.equip(tool, 'hand');
      await bot.dig(b, true);
    }
    const item = PILLAR.map((n) => bot.inventory.items().find((it) => it.name === n)).find(Boolean);
    if (!item) return { rose: feet.y - start.y, why: 'nothing to pillar with (dirt or stone)' };
    await bot.equip(item, 'hand');
    const below = bot.blockAt(feet.offset(0, -1, 0));
    if (!below || below.boundingBox !== 'block') return { rose: feet.y - start.y, why: 'no ground underfoot to build on' };
    bot.setControlState('jump', true);
    try {
      for (let t = 0; t < 10 && bot.entity.position.y < feet.y + 1.05; t++) await sleep(50 / timeScale(), signal);
      await bot.placeBlock(below, new Vec3(0, 1, 0)).catch(() => undefined);
    } finally {
      bot.setControlState('jump', false);
    }
    await sleep(400, signal);
    if (bot.entity.position.floored().y <= feet.y) return { rose: feet.y - start.y, why: 'the block did not go down underfoot' };
  }
  return { rose: bot.entity.position.floored().y - start.y };
}

/** Where a village member belongs: beside its storage chest, else its first plot, else the world spawn. */
function home(a: BotAgent): { x: number; y?: number; z: number; what: string } | null {
  const v = a.village();
  const c = v?.storage?.chests[0];
  // Just inside the storage hut's doorway (the aisle: two blocks of air on the floor, chests stand at floor level + 1;
  // outside it the ground may not be levelled): onto a chest inside the hut would put the bot's head in the roof
  const h = v?.storageHut;
  if (c && h && c.x >= h.x1 && c.x <= h.x2 && c.z >= h.z1 && c.z <= h.z2) return { x: h.x1 + 3, y: c.y, z: h.z2 - 1, what: 'the storage hut' };
  // On top of the chest itself: spreadplayers puts a bot on the highest block, which in a jungle is the canopy
  if (c) return { x: c.x, y: c.y + 1, z: c.z, what: 'the village storage' };
  const p = v?.plots[0];
  if (p) return { x: Math.floor((p.x1 + p.x2) / 2), z: p.z2 + 3, what: 'the village plot' };
  const sp = a.bot.spawnPoint;
  return sp ? { x: Math.floor(sp.x), z: Math.floor(sp.z), what: 'the world spawn' } : null;
}

/** Get the bot out, trying the gentle ways first. Returns what it did (for the brain and the log). */
export async function rescue(a: BotAgent, signal: AbortSignal): Promise<{ how: 'walked' | 'climbed' | 'teleported' | 'failed'; text: string }> {
  const bot = a.bot;
  const from = bot.entity.position.clone();
  const done: string[] = [];
  if (inWater(a)) {
    await swimUp(a, signal);
    done.push('swam up');
  }
  if (await walkOut(a, from, signal)) return { how: 'walked', text: `${[...done, 'walked out'].join(', then ')} to ${at(bot.entity.position)}` };
  const c = await climb(a, signal).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
    return { rose: 0, why: e.message };
  });
  if (c.rose) done.push(`climbed ${c.rose} blocks`);
  if (c.rose && (await walkOut(a, bot.entity.position.clone(), signal)))
    return { how: 'climbed', text: `${[...done, 'walked out'].join(', then ')} to ${at(bot.entity.position)}` };
  // Last resort: a teleport, onto the surface beside home
  const h = home(a);
  if (!h) return { how: 'failed', text: `could not get out (${c.why ?? 'no way found'}) and has no home to go back to` };
  await a.world.rcon.command(h.y !== undefined ? `tp ${a.name} ${h.x + 0.5} ${h.y} ${h.z + 0.5}` : `spreadplayers ${h.x} ${h.z} 0 3 false ${a.name}`);
  await sleep(1000, signal);
  await bot.waitForChunksToLoad();
  return { how: 'teleported', text: `could not walk or climb out (${[...done, c.why].filter(Boolean).join('; ') || 'no way found'}): teleported to ${h.what} at ${at(bot.entity.position)} (last resort)` };
}
