/**
 * Foundry skill `fish`: catch fish (cod, salmon, pufferfish, tropical_fish) and treasure/junk at open water using a
 * fishing_rod from inventory, standing on dry ground without digging or placing blocks. Includes the activity adapter
 * that locates open water near the village's storage hut from the shared terrain atlas.
 */
import { Vec3 } from 'vec3';
import type { BotAgent } from '../botAgent';
import type { FoundryPlaceCtx, FoundrySkill } from './types';
import {
  at,
  checkAbort,
  countItem,
  goals,
  itemId,
  nearestBlocks,
  num,
  onVillageGround,
  sleep,
  standableY,
  stateAt,
  stateTables,
  syncInventory,
  walk,
  wetAt,
} from '../mcUtil';
import { timeScale } from '../mcRules';

type FoundryPlace = Record<string, unknown> | { why: string };

const FISH_ITEMS = ['cod', 'salmon', 'pufferfish', 'tropical_fish'] as const;
const OTHER_ITEMS = [
  'string',
  'bone',
  'leather',
  'bowl',
  'stick',
  'ink_sac',
  'lily_pad',
  'book',
  'enchanted_book',
  'name_tag',
  'nautilus_shell',
  'saddle',
  'tripwire_hook',
  'leather_boots',
  'bow',
  'potion',
  'rotten_flesh',
  'bamboo',
] as const;

const NO_ROD_MSG = 'no fishing rod: withdraw one from storage, or craft one from 3 sticks and 2 string (string comes from cobwebs)';
const PLACE_CACHE_MS = 120_000;

interface CachedPlace {
  at: number;
  hx: number;
  hz: number;
  place: FoundryPlace;
}

const placeCache = new Map<string, CachedPlace>();
const guardedBots = new WeakSet<object>();

/**
 * Guard Mineflayer's fishing plugin against partial/stub bobber entities in `bot.entities` (lessons 104, 145):
 * `fishing.js` reads `lastBobber.position.distanceTo(...)` inside `world_particles` without null-checking `position`.
 */
function guardFishingPlugin(a: BotAgent): void {
  const bot = a.bot as unknown as {
    _client?: {
      prependListener?: (ev: string, fn: (pkt: Record<string, unknown>) => void) => void;
    };
    entities?: Record<number, { id?: number; position?: Vec3 }>;
  };
  if (!bot || typeof bot !== 'object' || guardedBots.has(bot)) return;
  guardedBots.add(bot);
  const client = bot._client;
  if (!client || typeof client.prependListener !== 'function') return;
  client.prependListener('spawn_entity', (pkt) => {
    try {
      const id = typeof pkt?.entityId === 'number' ? pkt.entityId : undefined;
      if (id === undefined || !bot.entities) return;
      const ent = bot.entities[id];
      if (ent && !ent.position) {
        ent.position = new Vec3(
          typeof pkt.x === 'number' ? pkt.x : 0,
          typeof pkt.y === 'number' ? pkt.y : 0,
          typeof pkt.z === 'number' ? pkt.z : 0,
        );
      }
    } catch {
      /* never throw inside packet listener */
    }
  });
  client.prependListener('world_particles', () => {
    try {
      if (!bot.entities) return;
      for (const ent of Object.values(bot.entities)) {
        if (ent && !ent.position) ent.position = new Vec3(0, 0, 0);
      }
    } catch {
      /* never throw inside packet listener */
    }
  });
}

/** Check on the server (or local inventory if RCON is disabled) whether the agent has at least one fishing_rod. */
async function hasFishingRod(a: BotAgent): Promise<boolean> {
  const srv = await a.world.rcon.count(a.name, 'minecraft:fishing_rod');
  if (srv !== null) {
    if (srv <= 0) return false;
    if (!a.bot.inventory?.items().some((i) => i.name === 'fishing_rod')) {
      await syncInventory(a);
    }
    return true;
  }
  const id = itemId(a, 'fishing_rod');
  if (id !== undefined && countItem(a, id) > 0) return true;
  await syncInventory(a);
  return id !== undefined && countItem(a, id) > 0;
}

/** Count items on the server via `clear <name> <item> 0` (falling back to local inventory only if RCON is disabled). */
async function serverCounts(a: BotAgent, names: readonly string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of names) {
    const n = await a.world.rcon.count(a.name, `minecraft:${name}`);
    if (n !== null) {
      out[name] = n;
    } else {
      const id = itemId(a, name);
      out[name] = id !== undefined ? countItem(a, id) : 0;
    }
  }
  return out;
}

/** Walk with digging, block placement, parkour, and entering water disabled. */
async function walkDry(
  a: BotAgent,
  goal: InstanceType<typeof goals.Goal>,
  label: string,
  signal: AbortSignal,
  timeoutMs = 30000,
): Promise<void> {
  const m = a.moves();
  const prevDig = m.canDig;
  const prevScaf = m.scafoldingBlocks;
  const prevTowers = m.allow1by1towers;
  const prevParkour = m.allowParkour;
  const waterId = a.world.registry.blocksByName.water?.id;
  const foot = a.bot.entity?.position?.floored();
  const inWaterNow = foot ? wetAt(a, foot) : false;
  const hadWaterAvoid = waterId !== undefined ? m.blocksToAvoid.has(waterId) : true;
  m.canDig = false;
  m.scafoldingBlocks = [];
  m.allow1by1towers = false;
  m.allowParkour = false;
  if (waterId !== undefined && !inWaterNow) m.blocksToAvoid.add(waterId);
  try {
    await walk(a, goal, label, signal, timeoutMs);
  } finally {
    m.canDig = prevDig;
    m.scafoldingBlocks = prevScaf;
    m.allow1by1towers = prevTowers;
    m.allowParkour = prevParkour;
    if (waterId !== undefined && !hadWaterAvoid) m.blocksToAvoid.delete(waterId);
  }
}

interface FishingCandidate {
  water: Vec3;
  stand: Vec3;
  aim: Vec3;
  score: number;
}

/** Build the set of air block state ids for the registry. */
function airStateSet(a: BotAgent): Set<number> {
  const s = new Set<number>([0]);
  for (const name of ['air', 'cave_air', 'void_air']) {
    const b = a.world.registry.blocksByName[name];
    if (b) for (let id = b.minStateId; id <= b.maxStateId; id++) s.add(id);
  }
  return s;
}

/** Whether `(x, y, z)` is a water block with air above, open to the sky, and not on any village's ground. */
function isOpenWaterAt(a: BotAgent, x: number, y: number, z: number, airStates: Set<number>, waterMin: number, waterMax: number): boolean {
  const st = stateAt(a, x, y, z);
  if (st < waterMin || st > waterMax) return false;
  if (!airStates.has(stateAt(a, x, y + 1, z))) return false;
  if (onVillageGround(a, x, z, y)) return false;
  for (let yy = y + 2; yy <= y + 64; yy++) {
    const above = stateAt(a, x, yy, z);
    if (above < 0 || !airStates.has(above)) return false;
  }
  return true;
}

/** Whether `(sx, sy, sz)` is a dry standable spot 1-3 blocks from `w` with a clear cast line to `w`. */
function isValidStandSpot(a: BotAgent, sx: number, sy: number, sz: number, w: Vec3): boolean {
  const dist = Math.hypot(sx - w.x, sz - w.z);
  if (dist < 1 || dist > 3) return false;
  if (sy < w.y || sy > w.y + 3) return false;
  if (onVillageGround(a, sx, sz, sy)) return false;
  if (wetAt(a, new Vec3(sx, sy, sz)) || wetAt(a, new Vec3(sx, sy + 1, sz)) || wetAt(a, new Vec3(sx, sy - 1, sz))) return false;
  const under = a.bot.blockAt(new Vec3(sx, sy - 1, sz));
  const here = a.bot.blockAt(new Vec3(sx, sy, sz));
  const above = a.bot.blockAt(new Vec3(sx, sy + 1, sz));
  if (!under || under.boundingBox !== 'block') return false;
  if (/leaves|cactus|magma|fence|wall|berry|fire|campfire|water|lava|ice|cobweb/.test(under.name)) return false;
  if (!here || here.boundingBox !== 'empty' || /water|lava|fire|berry|cobweb/.test(here.name)) return false;
  if (!above || above.boundingBox !== 'empty' || /water|lava|fire|cobweb/.test(above.name)) return false;
  // Check intermediate cells between the stand spot and the water cell so the cast does not hit a wall or bank
  const steps = Math.max(Math.abs(sx - w.x), Math.abs(sz - w.z));
  for (let i = 1; i < steps; i++) {
    const mx = Math.round(sx + ((w.x - sx) * i) / steps);
    const mz = Math.round(sz + ((w.z - sz) * i) / steps);
    const midLow = a.bot.blockAt(new Vec3(mx, w.y + 1, mz));
    const midHigh = a.bot.blockAt(new Vec3(mx, sy + 1, mz));
    if ((midLow && midLow.boundingBox !== 'empty') || (midHigh && midHigh.boundingBox !== 'empty')) return false;
  }
  return true;
}

/** Find open water blocks and their best dry standable spots within `radius`. */
function findFishingCandidates(
  a: BotAgent,
  radius: number,
  givenX?: number,
  givenY?: number,
  givenZ?: number,
): FishingCandidate[] {
  const waterBlock = a.world.registry.blocksByName.water;
  if (!waterBlock) return [];
  const waterMin = waterBlock.minStateId;
  const waterMax = waterBlock.maxStateId;
  const airStates = airStateSet(a);
  const { wet } = stateTables(a.world.registry);

  const keep = (p: Vec3): boolean => {
    if (!isOpenWaterAt(a, p.x, p.y, p.z, airStates, waterMin, waterMax)) return false;
    // Must have at least one non-wet cell within 3 blocks horizontally at water level so mid-ocean cells don't crowd out the shore
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        if (dx === 0 && dz === 0) continue;
        const st = stateAt(a, p.x + dx, p.y, p.z + dz);
        if (st >= 0 && wet[st] === 0) return true;
      }
    }
    return false;
  };

  const botPos = a.bot.entity.position;
  const botFloor = botPos.floored();
  const searchRadius = givenX !== undefined && givenZ !== undefined
    ? Math.min(64, Math.max(radius, Math.ceil(Math.hypot(givenX - botPos.x, givenZ - botPos.z)) + 12))
    : radius;

  const waters = nearestBlocks(a, [waterBlock.id], searchRadius, 64, keep);

  // If x, z were given, also explicitly check the 5x5 neighbourhood around (givenX, givenZ) in case >64 water blocks were closer
  if (givenX !== undefined && givenZ !== undefined) {
    const seen = new Set(waters.map((w) => `${w.x},${w.y},${w.z}`));
    const baseY = givenY ?? Math.floor(botPos.y);
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let dy = -6; dy <= 6; dy++) {
          const wx = givenX + dx, wy = baseY + dy, wz = givenZ + dz;
          const key = `${wx},${wy},${wz}`;
          if (seen.has(key)) continue;
          if (isOpenWaterAt(a, wx, wy, wz, airStates, waterMin, waterMax)) {
            seen.add(key);
            waters.push(new Vec3(wx, wy, wz));
          }
        }
      }
    }
  }

  const candidates: FishingCandidate[] = [];
  for (const w of waters) {
    if (givenX === undefined && givenZ === undefined && w.distanceTo(botPos) > radius + 0.5) continue;
    let waterNeighbors = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const st = stateAt(a, w.x + dx, w.y, w.z + dz);
        if (st >= waterMin && st <= waterMax) waterNeighbors++;
      }
    }

    let bestStand: Vec3 | null = null;
    let bestStandScore = Infinity;

    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const dist = Math.hypot(dx, dz);
        if (dist < 1 || dist > 3) continue;
        const sx = w.x + dx, sz = w.z + dz;
        const sy = standableY(a, sx, w.y + 1, sz, 2);
        if (sy === null) continue;
        if (!isValidStandSpot(a, sx, sy, sz, w)) continue;
        const alreadyHere = botFloor.x === sx && botFloor.z === sz && Math.abs(botPos.y - sy) <= 0.6;
        const dBot = alreadyHere ? -100 : Math.hypot(sx + 0.5 - botPos.x, sz + 0.5 - botPos.z);
        // Prefer standing 1-2 blocks from the water and at water level + 1
        const sScore = dBot + dist * 1.5 + Math.abs(sy - (w.y + 1)) * 2;
        if (sScore < bestStandScore) {
          bestStandScore = sScore;
          bestStand = new Vec3(sx, sy, sz);
        }
      }
    }

    if (!bestStand) continue;
    // Aim at the top surface of the water cell, nudged slightly away from the bank when the next cell out is also open water
    const stepX = Math.sign(w.x - bestStand.x);
    const stepZ = Math.sign(w.z - bestStand.z);
    const furtherOpen = (stepX !== 0 || stepZ !== 0)
      && isOpenWaterAt(a, w.x + stepX, w.y, w.z + stepZ, airStates, waterMin, waterMax);
    const aim = new Vec3(
      w.x + 0.5 + (furtherOpen ? stepX * 0.35 : 0),
      w.y + 0.85,
      w.z + 0.5 + (furtherOpen ? stepZ * 0.35 : 0),
    );

    const alreadyAtStand = botFloor.x === bestStand.x && botFloor.z === bestStand.z && Math.abs(botPos.y - bestStand.y) <= 0.6;
    const primaryDist = givenX !== undefined && givenZ !== undefined
      ? Math.hypot(w.x - givenX, w.z - givenZ) * 4 + (alreadyAtStand ? -50 : bestStand.distanceTo(botPos))
      : (alreadyAtStand ? -50 : bestStand.distanceTo(botPos)) - Math.min(waterNeighbors, 4) * 0.4;

    candidates.push({ water: w, stand: bestStand, aim, score: primaryDist });
  }

  candidates.sort((u, v) => u.score - v.score);
  return candidates;
}

/** Run a single `bot.fish()` cast with a per-cast timeout and abort handling, never leaving an unhandled rejection. */
async function castOnce(a: BotAgent, timeoutMs: number, signal: AbortSignal): Promise<'caught' | 'timeout' | 'cancelled_cast'> {
  checkAbort(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  let lineOut = true;

  const reelInSafe = () => {
    if (!lineOut) return;
    lineOut = false;
    try {
      a.bot.activateItem();
    } catch {
      /* ignore */
    }
  };

  try {
    const fishCall = a.bot.fish();
    // Prevent unhandled promise rejection if timeout or abort wins the race (lesson 104, 145)
    fishCall.catch(() => undefined);

    const result = await new Promise<'caught' | 'timeout' | 'cancelled_cast'>((resolve, reject) => {
      onAbort = () => {
        reelInSafe();
        reject(new Error('cancelled'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      timer = setTimeout(() => {
        reelInSafe();
        resolve('timeout');
      }, timeoutMs);

      fishCall.then(
        () => {
          lineOut = false;
          resolve('caught');
        },
        (err: unknown) => {
          lineOut = false;
          if (signal.aborted) {
            reject(new Error('cancelled'));
            return;
          }
          const msg = (err as Error)?.message ?? String(err);
          if (/Fishing cancelled/i.test(msg)) {
            resolve('cancelled_cast');
          } else {
            resolve('cancelled_cast');
          }
        },
      );
    });

    if (result === 'timeout' || result === 'cancelled_cast') {
      // Let the server's entity_destroy packet for the old bobber arrive before the next cast starts
      await sleep(Math.max(100, Math.round(350 / timeScale())), signal);
    }
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
    if (signal.aborted && lineOut) {
      reelInSafe();
    }
  }
}

export const FOUNDRY: FoundrySkill = {
  name: 'fish',
  skill: {
    check: (args) => {
      if (args.count !== undefined) num(args.count, 'count');
      if (args.x !== undefined || args.z !== undefined) {
        num(args.x, 'x');
        num(args.z, 'z');
      }
      if (args.y !== undefined) num(args.y, 'y');
      if (args.radius !== undefined) num(args.radius, 'radius');
    },

    async run(a, args, signal) {
      checkAbort(signal);
      guardFishingPlugin(a);

      const want = Math.max(1, Math.min(16, Math.floor(args.count !== undefined ? num(args.count, 'count') : 4)));
      const radius = Math.max(1, Math.min(64, Math.floor(args.radius !== undefined ? num(args.radius, 'radius') : 32)));
      const hasXZ = args.x !== undefined && args.z !== undefined;
      const givenX = hasXZ ? Math.floor(num(args.x, 'x')) : undefined;
      const givenZ = hasXZ ? Math.floor(num(args.z, 'z')) : undefined;
      const givenY = args.y !== undefined ? Math.floor(num(args.y, 'y')) : undefined;

      if (!(await hasFishingRod(a))) {
        throw new Error(NO_ROD_MSG);
      }

      // When target water coordinates are given and far away, walk near them first so the chunk is in view
      if (givenX !== undefined && givenZ !== undefined) {
        const p0 = a.bot.entity.position;
        const distXZ = Math.hypot(givenX - p0.x, givenZ - p0.z);
        if (distXZ > 12) {
          try {
            await walkDry(
              a,
              new goals.GoalNearXZ(givenX, givenZ, 6),
              `${givenX},${givenZ}`,
              signal,
              Math.min(90000, Math.round((20000 + distXZ * 1200) / timeScale())),
            );
          } catch (e) {
            if ((e as Error).message === 'cancelled') throw e;
          }
        }
      }

      const candidates = findFishingCandidates(a, radius, givenX, givenY, givenZ);
      if (candidates.length === 0) {
        const where = givenX !== undefined && givenZ !== undefined ? `${givenX},${givenZ}` : at(a.bot.entity.position);
        throw new Error(`no open water within ${radius} blocks of ${where}: explore or try from another place`);
      }

      // Walk to a dry standable spot 1-3 blocks from open water (never entering water or breaking/placing blocks)
      let chosen: FishingCandidate | null = null;
      for (const cand of candidates.slice(0, 6)) {
        checkAbort(signal);
        const bp = a.bot.entity.position;
        const bf = bp.floored();
        const alreadyThere = bf.x === cand.stand.x && bf.z === cand.stand.z && Math.abs(bp.y - cand.stand.y) <= 0.6;
        if (!alreadyThere) {
          try {
            await walkDry(
              a,
              new goals.GoalBlock(cand.stand.x, cand.stand.y, cand.stand.z),
              `${cand.stand.x},${cand.stand.y},${cand.stand.z}`,
              signal,
              30000,
            );
          } catch (e) {
            if ((e as Error).message === 'cancelled') throw e;
            try {
              await walkDry(
                a,
                new goals.GoalNear(cand.stand.x, cand.stand.y, cand.stand.z, 1),
                `${cand.stand.x},${cand.stand.y},${cand.stand.z}`,
                signal,
                20000,
              );
            } catch (e2) {
              if ((e2 as Error).message === 'cancelled') throw e2;
              continue;
            }
          }
        }
        const nowFloor = a.bot.entity.position.floored();
        const hd = Math.hypot(nowFloor.x - cand.water.x, nowFloor.z - cand.water.z);
        const inWater = wetAt(a, nowFloor) || !!(a.bot.entity as unknown as { isInWater?: boolean }).isInWater;
        if (!inWater && !onVillageGround(a, nowFloor.x, nowFloor.z, nowFloor.y) && hd >= 0.8 && hd <= 3.8) {
          chosen = cand;
          break;
        }
      }

      if (!chosen) {
        throw new Error(`no open water with a reachable dry bank within ${radius} blocks of ${at(a.bot.entity.position)}: explore or try from another place`);
      }

      a.halt();

      // Count fish and other catches on the server before casting
      const fishBefore = await serverCounts(a, FISH_ITEMS);
      const otherBefore = await serverCounts(a, OTHER_ITEMS);

      const scale = Math.max(1, timeScale());
      const maxWallMs = Math.round(240_000 / scale);
      const singleCastMs = Math.round(60_000 / scale);
      const t0 = Date.now();

      let casts = 0;
      let caughtFish = 0;
      let fishAfter = { ...fishBefore };
      let stopWhy = `reached target of ${want} fish`;

      while (caughtFish < want) {
        checkAbort(signal);
        const elapsed = Date.now() - t0;
        if (elapsed >= maxWallMs) {
          stopWhy = '4 minute time limit reached';
          break;
        }

        if (!(await hasFishingRod(a))) {
          stopWhy = 'the fishing rod broke';
          break;
        }

        // Check that the water block is still water (in case the world changed)
        const wBlock = a.bot.blockAt(chosen.water);
        if (wBlock && wBlock.name !== 'water') {
          const fresh = findFishingCandidates(a, 4, chosen.water.x, chosen.water.y, chosen.water.z);
          if (fresh.length > 0 && Math.hypot(a.bot.entity.position.x - fresh[0].water.x, a.bot.entity.position.z - fresh[0].water.z) <= 3.8) {
            chosen = fresh[0];
          } else {
            stopWhy = 'open water disappeared';
            break;
          }
        }

        // Equip the fishing rod in hand
        let rod = a.bot.inventory.items().find((i) => i.name === 'fishing_rod');
        if (!rod) {
          await syncInventory(a);
          rod = a.bot.inventory.items().find((i) => i.name === 'fishing_rod');
        }
        if (!rod) {
          stopWhy = 'the fishing rod broke';
          break;
        }
        if (a.bot.heldItem?.name !== 'fishing_rod') {
          await a.bot.equip(rod, 'hand');
        }

        // Look at the water cell before casting
        await a.bot.lookAt(chosen.aim, true);

        const invBeforeCast = a.bot.inventory.items().reduce((s, i) => s + i.count, 0);
        const castBudget = Math.min(singleCastMs, Math.max(1000, maxWallMs - (Date.now() - t0)));
        casts++;

        const outcome = await castOnce(a, castBudget, signal);

        if (outcome === 'caught') {
          // Wait for the reeled-in catch to fly to the bot and be picked up on the server
          const pickupWaitMs = Math.max(350, Math.round(1600 / scale));
          const stepMs = Math.max(80, Math.round(160 / scale));
          let waited = 0;
          while (waited < pickupWaitMs) {
            await sleep(stepMs, signal);
            waited += stepMs;
            const invNow = a.bot.inventory.items().reduce((s, i) => s + i.count, 0);
            if (invNow > invBeforeCast && waited >= Math.max(250, Math.round(400 / scale))) {
              await sleep(stepMs, signal);
              break;
            }
          }
          fishAfter = await serverCounts(a, FISH_ITEMS);
          caughtFish = FISH_ITEMS.reduce((sum, k) => sum + Math.max(0, (fishAfter[k] ?? 0) - (fishBefore[k] ?? 0)), 0);
          if (caughtFish >= want) {
            stopWhy = `reached target of ${want} fish`;
            break;
          }
        }
      }

      // Final server counts for fish and other items
      fishAfter = await serverCounts(a, FISH_ITEMS);
      const otherAfter = await serverCounts(a, OTHER_ITEMS);

      const cod = Math.max(0, (fishAfter.cod ?? 0) - (fishBefore.cod ?? 0));
      const salmon = Math.max(0, (fishAfter.salmon ?? 0) - (fishBefore.salmon ?? 0));
      const pufferfish = Math.max(0, (fishAfter.pufferfish ?? 0) - (fishBefore.pufferfish ?? 0));
      const tropical = Math.max(0, (fishAfter.tropical_fish ?? 0) - (fishBefore.tropical_fish ?? 0));
      caughtFish = cod + salmon + pufferfish + tropical;

      let otherTotal = 0;
      const otherParts: string[] = [];
      for (const k of OTHER_ITEMS) {
        const diff = Math.max(0, (otherAfter[k] ?? 0) - (otherBefore[k] ?? 0));
        if (diff > 0) {
          otherTotal += diff;
          otherParts.push(`${diff} ${k}`);
        }
      }
      const otherList = otherParts.length > 0 ? otherParts.join(', ') : 'none';
      const wCoord = `${chosen.water.x},${chosen.water.y},${chosen.water.z}`;

      if (caughtFish === 0) {
        if (stopWhy === 'the fishing rod broke') {
          throw new Error(`the fishing rod broke at ${wCoord} after ${casts} casts: withdraw another from storage or craft another from 3 sticks and 2 string`);
        }
        if (stopWhy === 'open water disappeared') {
          throw new Error(`no open water left at ${wCoord}: explore or try from another place`);
        }
        throw new Error(
          `nothing bit in 4 minutes at ${wCoord} (${casts} casts${otherTotal > 0 ? `, caught ${otherTotal} other items: ${otherList}` : ''}): try another open water spot or check that the water is open to the sky`,
        );
      }

      return `caught ${caughtFish} fish (${cod} cod, ${salmon} salmon, ${pufferfish} pufferfish, ${tropical} tropical fish) and ${otherTotal} other items (${otherList}) at ${wCoord} in ${casts} casts (${stopWhy})`;
    },
  },

  tool: {
    name: 'fish',
    description: 'Catch fish (cod, salmon, pufferfish, tropical_fish) and treasure/junk at open water using a fishing_rod from inventory, standing on dry ground without digging or placing blocks.',
    input_schema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of fish to catch (1-16, default 4).' },
        x: { type: 'number', description: 'Optional water X coordinate to fish at.' },
        y: { type: 'number', description: 'Optional water Y coordinate to fish at.' },
        z: { type: 'number', description: 'Optional water Z coordinate to fish at.' },
        radius: { type: 'number', description: 'Max distance to search for open water when x, z are not given (1-64, default 32).' },
      },
    },
  },

  activity: {
    place(ctx: FoundryPlaceCtx): FoundryPlace {
      try {
        if (!ctx || !ctx.hut) return { why: 'no storage hut' };
        const hut = ctx.hut;
        const vName = ctx.village?.name ?? '';
        const now = Date.now();
        if (vName) {
          const hit = placeCache.get(vName);
          if (hit && now - hit.at < PLACE_CACHE_MS && hit.hx === hut.x && hit.hz === hut.z) {
            return hit.place;
          }
        }

        const atlas = ctx.agent?.world?.atlas;
        if (!atlas || typeof atlas.near !== 'function') {
          return { why: 'no open water within 64 blocks of the storage hut' };
        }

        const chunks = atlas.near(hut.x, hut.z, 64);
        const cells = new Map<string, { ch: string; h: number | null }>();
        for (const c of chunks) {
          if (!c || typeof c.s !== 'string' || !Array.isArray(c.h)) continue;
          for (let rz = 0; rz < 4; rz++) {
            for (let rx = 0; rx < 4; rx++) {
              const idx = rz * 4 + rx;
              const gx = c.cx * 4 + rx;
              const gz = c.cz * 4 + rz;
              cells.set(`${gx},${gz}`, { ch: c.s[idx] ?? ' ', h: c.h[idx] ?? null });
            }
          }
        }

        const isDry = (ch: string | undefined) => !!ch && ch !== '~' && ch !== '^' && ch !== ' ';
        const dirs = [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
          [-1, -1],
          [-1, 1],
          [1, -1],
          [1, 1],
        ];

        let best: { x: number; y: number; z: number; d: number } | null = null;
        for (const [key, cell] of cells) {
          if (cell.ch !== '~' || cell.h === null || !Number.isFinite(cell.h)) continue;
          const [gxStr, gzStr] = key.split(',');
          const gx = Number(gxStr), gz = Number(gzStr);
          const x = gx * 4 + 2;
          const z = gz * 4 + 2;
          const y = Math.floor(cell.h);
          const d = Math.hypot(x - hut.x, z - hut.z);
          if (d > 64) continue;
          if (best && d >= best.d) continue;
          if (onVillageGround(ctx.agent, x, z, y)) continue;
          const hasDryNeighbour = dirs.some(([dx, dz]) => isDry(cells.get(`${gx + dx},${gz + dz}`)?.ch));
          if (!hasDryNeighbour) continue;
          best = { x, y, z, d };
        }

        const ans: FoundryPlace = best
          ? { x: best.x, y: best.y, z: best.z }
          : { why: 'no open water within 64 blocks of the storage hut' };

        if (vName) {
          placeCache.set(vName, { at: now, hx: hut.x, hz: hut.z, place: ans });
        }
        return ans;
      } catch {
        return { why: 'no open water within 64 blocks of the storage hut' };
      }
    },
  },
};
