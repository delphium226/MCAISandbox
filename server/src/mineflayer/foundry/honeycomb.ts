/**
 * Foundry skill `harvest_honeycomb`: harvest honeycomb by using shears on bee nests or beehives in the state
 * honey_level=5 without breaking or placing blocks, and pick up the dropped honeycomb. Includes the activity adapter
 * that tracks bee nests and beehives within 144 blocks of the village's storage hut.
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
  syncInventory,
  walk,
  wetAt,
} from '../mcUtil';
import { timeScale } from '../mcRules';

type FoundryPlace = Record<string, unknown> | { why: string };

const NO_SHEARS_MSG = 'no shears: withdraw one from storage';
const NO_PLACE_MSG = 'no bee nest in the state honey_level=5 within 144 blocks of the storage hut (bees refill them over minutes)';
const LIST_REFRESH_MS = 10 * 60_000;
const PLACE_CACHE_MS = 60_000;
const HUT_RADIUS = 144;
const HUT_MAX_NESTS = 24;

interface CachedNestList {
  at: number;
  hx: number;
  hz: number;
  nests: Vec3[];
}

interface CachedPlace {
  at: number;
  hx: number;
  hz: number;
  place: FoundryPlace;
}

const nestListCache = new Map<string, CachedNestList>();
const placeCache = new Map<string, CachedPlace>();
const lastPlaceTarget = new Map<string, { x: number; y: number; z: number }>();

function isBeeBlockName(name: string | undefined): boolean {
  return name === 'bee_nest' || name === 'beehive';
}

function beeBlockIds(a: BotAgent): number[] {
  const ids: number[] = [];
  const byName = a?.world?.registry?.blocksByName;
  if (!byName) return ids;
  for (const name of ['bee_nest', 'beehive']) {
    const b = byName[name];
    if (b && typeof b.id === 'number') ids.push(b.id);
  }
  return ids;
}

/**
 * Safely read `honey_level` from `bot.blockAt(pos).getProperties()`. Returns null if the block is missing, unloaded,
 * not a bee_nest or beehive, or its properties are missing (lesson 104).
 */
function readHoneyLevel(a: BotAgent, pos: Vec3): number | null {
  try {
    const block = a?.bot?.blockAt?.(pos);
    if (!block || !isBeeBlockName(block.name)) return null;
    if (typeof block.getProperties !== 'function') return null;
    const props = block.getProperties();
    if (!props || typeof props !== 'object') return null;
    const raw = (props as Record<string, unknown>).honey_level;
    if (raw === undefined || raw === null) return null;
    const lvl = Number(raw);
    return Number.isFinite(lvl) ? lvl : null;
  } catch {
    return null;
  }
}

function readBlockFacing(a: BotAgent, pos: Vec3): string | null {
  try {
    const block = a?.bot?.blockAt?.(pos);
    if (!block || typeof block.getProperties !== 'function') return null;
    const props = block.getProperties();
    if (!props || typeof props !== 'object') return null;
    const f = (props as Record<string, unknown>).facing;
    return typeof f === 'string' ? f : null;
  } catch {
    return null;
  }
}

/** Check on the server (or local inventory if RCON is disabled) whether the agent has at least one shears. */
async function hasShears(a: BotAgent): Promise<boolean> {
  const srv = await a.world.rcon.count(a.name, 'minecraft:shears');
  if (srv !== null) {
    if (srv <= 0) return false;
    if (!a.bot.inventory?.items().some((i) => i.name === 'shears')) {
      await syncInventory(a);
    }
    return true;
  }
  const id = itemId(a, 'shears');
  if (id !== undefined && countItem(a, id) > 0) return true;
  await syncInventory(a);
  return id !== undefined && countItem(a, id) > 0;
}

/** Count honeycomb on the server via `clear <name> minecraft:honeycomb 0` (falling back to local inventory only if RCON is disabled). */
async function serverHoneycombCount(a: BotAgent): Promise<number> {
  const n = await a.world.rcon.count(a.name, 'minecraft:honeycomb');
  if (n !== null) return n;
  const id = itemId(a, 'honeycomb');
  return id !== undefined ? countItem(a, id) : 0;
}

/** Walk with digging, block placement, 1x1 towers, parkour, and entering water disabled. */
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
  const foot = a.bot.entity?.position?.floored?.();
  const inWaterNow = foot ? wetAt(a, foot) : false;
  const hadWaterAvoid = waterId !== undefined ? m.blocksToAvoid.has(waterId) : true;
  m.canDig = false;
  m.scafoldingBlocks = [];
  m.allow1by1towers = false;
  m.allowParkour = false;
  if (waterId !== undefined && !inWaterNow) m.blocksToAvoid.add(waterId);
  try {
    await walk(a, goal, label, signal, timeoutMs, { scaffold: false });
  } finally {
    m.canDig = prevDig;
    m.scafoldingBlocks = prevScaf;
    m.allow1by1towers = prevTowers;
    m.allowParkour = prevParkour;
    if (waterId !== undefined && !hadWaterAvoid) m.blocksToAvoid.delete(waterId);
  }
}

const FACING_VEC: Record<string, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  west: [-1, 0],
  east: [1, 0],
};

/**
 * Find dry standable ground cells within 3 blocks horizontally of `target` from which `target` is within survival reach
 * (4.5 blocks from the eyes; targets may hang 2-5 blocks above the ground on a tree trunk).
 */
function findStandSpots(a: BotAgent, target: Vec3): Vec3[] {
  const botPos = a.bot.entity?.position;
  if (!botPos) return [];
  const botFloor = botPos.floored();
  const tx = target.x, ty = target.y, tz = target.z;
  const center = new Vec3(tx + 0.5, ty + 0.5, tz + 0.5);
  const facing = readBlockFacing(a, target);
  const fVec = facing ? FACING_VEC[facing] : undefined;

  const candidates: Array<{ pos: Vec3; score: number }> = [];

  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      const hDist = Math.hypot(dx, dz);
      if (hDist > 3) continue;
      const sx = tx + dx, sz = tz + dz;

      for (let sy = ty - 5; sy <= ty + 1; sy++) {
        if (onVillageGround(a, sx, sz, sy)) continue;
        if (wetAt(a, new Vec3(sx, sy, sz)) || wetAt(a, new Vec3(sx, sy + 1, sz)) || wetAt(a, new Vec3(sx, sy - 1, sz))) continue;

        const under = a.bot.blockAt(new Vec3(sx, sy - 1, sz));
        const here = a.bot.blockAt(new Vec3(sx, sy, sz));
        const above = a.bot.blockAt(new Vec3(sx, sy + 1, sz));
        if (!under || under.boundingBox !== 'block') continue;
        // Stand on actual ground, never on tree trunks, leaves, bee nests, fences, or hazards
        if (/leaves|log|wood|stem|hyphae|bee_nest|beehive|cactus|magma|fence|wall|berry|fire|campfire|water|lava|ice|cobweb|scaffolding/.test(under.name)) continue;
        if (!here || here.boundingBox !== 'empty' || /water|lava|fire|campfire|berry|cobweb|cactus/.test(here.name)) continue;
        if (!above || above.boundingBox !== 'empty' || /water|lava|fire|campfire|berry|cobweb|cactus/.test(above.name)) continue;

        if (dx === 0 && dz === 0) {
          if (ty < sy + 2) continue;
          let clearAbove = true;
          for (let yy = sy + 2; yy < ty; yy++) {
            const b = a.bot.blockAt(new Vec3(tx, yy, tz));
            if (!b || b.boundingBox !== 'empty') {
              clearAbove = false;
              break;
            }
          }
          if (!clearAbove) continue;
        }

        const eye = new Vec3(sx + 0.5, sy + 1.62, sz + 0.5);
        const eyeDist = eye.distanceTo(center);
        if (eyeDist > 4.35) continue;

        // Check whether a solid block (e.g. the tree trunk) sits immediately between the target and this stand column
        const stepX = Math.sign(dx), stepZ = Math.sign(dz);
        let blockedAdj = false;
        if (stepX !== 0 || stepZ !== 0) {
          const adj = a.bot.blockAt(new Vec3(tx + stepX, ty, tz + stepZ));
          if (adj && adj.boundingBox === 'block') blockedAdj = true;
        }

        const alreadyHere = botFloor.x === sx && botFloor.z === sz && Math.abs(botPos.y - sy) <= 0.6;
        const dBot = alreadyHere && !blockedAdj ? -100 : Math.hypot(sx + 0.5 - botPos.x, sz + 0.5 - botPos.z);
        const facingBonus = fVec && (dx * fVec[0] + dz * fVec[1] > 0) ? -2 : 0;
        const distPref = hDist >= 1 && hDist <= 2.5 ? 0 : 1.5;
        const blockedPenalty = blockedAdj ? 25 : 0;
        const score = dBot + distPref + facingBonus + blockedPenalty + eyeDist * 0.5;

        candidates.push({ pos: new Vec3(sx, sy, sz), score });
      }
    }
  }

  candidates.sort((u, v) => u.score - v.score);
  return candidates.map((c) => c.pos);
}

/** Compute the face vector and look point on `target` toward the bot's eyes. */
function faceTowardBot(a: BotAgent, target: Vec3): { faceDir: Vec3; lookPoint: Vec3 } {
  const eye = a.bot.entity.position.offset(0, 1.62, 0);
  const center = new Vec3(target.x + 0.5, target.y + 0.5, target.z + 0.5);
  const dx = eye.x - center.x;
  const dy = eye.y - center.y;
  const dz = eye.z - center.z;

  const candidates: Array<{ dir: Vec3; dot: number }> = [
    { dir: new Vec3(1, 0, 0), dot: dx },
    { dir: new Vec3(-1, 0, 0), dot: -dx },
    { dir: new Vec3(0, 0, 1), dot: dz },
    { dir: new Vec3(0, 0, -1), dot: -dz },
    { dir: new Vec3(0, -1, 0), dot: -dy },
    { dir: new Vec3(0, 1, 0), dot: dy },
  ].filter((c) => c.dot > 0);

  candidates.sort((u, v) => {
    const uOpen = a.bot.blockAt(target.offset(u.dir.x, u.dir.y, u.dir.z))?.boundingBox === 'empty' ? 1 : 0;
    const vOpen = a.bot.blockAt(target.offset(v.dir.x, v.dir.y, v.dir.z))?.boundingBox === 'empty' ? 1 : 0;
    if (uOpen !== vOpen) return vOpen - uOpen;
    return v.dot - u.dot;
  });

  const faceDir = candidates[0]?.dir ?? new Vec3(0, -1, 0);
  const lookPoint = new Vec3(
    center.x + faceDir.x * 0.45,
    center.y + faceDir.y * 0.45,
    center.z + faceDir.z * 0.45,
  );
  return { faceDir, lookPoint };
}

/** Wait for dropped honeycomb items near `targetPos` and walk to item entities within 6 blocks to pick them up. */
async function pickUpNearbyDrops(
  a: BotAgent,
  targetPos: Vec3,
  signal: AbortSignal,
  scale: number,
  hcBeforeTarget: number,
  hcBeforeAll: number,
  want: number,
): Promise<number> {
  await sleep(Math.max(150, Math.round(350 / scale)), signal);
  const maxPickupMs = Math.max(1500, Math.round(4500 / scale));
  const stepMs = Math.max(100, Math.round(220 / scale));
  const t0 = Date.now();
  const targetCenter = targetPos.offset(0.5, 0.5, 0.5);

  while (Date.now() - t0 < maxPickupMs) {
    checkAbort(signal);
    const nowCount = await serverHoneycombCount(a);
    if (nowCount - hcBeforeTarget >= 3 || nowCount - hcBeforeAll >= want) {
      return nowCount;
    }

    const botPos = a.bot.entity?.position;
    if (!botPos) break;

    const drops = Object.values(a.bot.entities ?? {}).filter((e) => {
      if (!e || e.name !== 'item' || !e.position || typeof e.position.distanceTo !== 'function') return false;
      const dBot = e.position.distanceTo(botPos);
      const dTarget = Math.hypot(e.position.x - targetCenter.x, e.position.z - targetCenter.z);
      if (dBot > 6 && dTarget > 6) return false;
      if (onVillageGround(a, Math.floor(e.position.x), Math.floor(e.position.z), Math.floor(e.position.y))) return false;
      return true;
    });

    if (drops.length === 0) {
      await sleep(stepMs, signal);
      const recheck = await serverHoneycombCount(a);
      if (recheck > hcBeforeTarget) return recheck;
      if (Date.now() - t0 >= Math.max(500, Math.round(1200 / scale))) break;
      continue;
    }

    drops.sort((u, v) => u.position.distanceTo(botPos) - v.position.distanceTo(botPos));
    const drop = drops[0];
    if (!drop?.position) continue;
    const dx = drop.position.x, dy = drop.position.y, dz = drop.position.z;

    if (Math.hypot(dx - botPos.x, dz - botPos.z) > 0.9) {
      try {
        await walkDry(
          a,
          new goals.GoalNear(dx, dy, dz, 0.8),
          'the dropped honeycomb',
          signal,
          Math.max(1500, Math.round(4000 / scale)),
        );
      } catch (e) {
        if ((e as Error).message === 'cancelled') throw e;
      }
    }
    await sleep(stepMs, signal);
  }

  return serverHoneycombCount(a);
}

export const FOUNDRY: FoundrySkill = {
  name: 'harvest_honeycomb',
  skill: {
    check: (args) => {
      if (args.count !== undefined) num(args.count, 'count');
      if (args.x !== undefined) num(args.x, 'x');
      if (args.y !== undefined) num(args.y, 'y');
      if (args.z !== undefined) num(args.z, 'z');
      if (args.radius !== undefined) num(args.radius, 'radius');
    },

    async run(a, args, signal) {
      checkAbort(signal);

      const want = Math.max(1, Math.min(12, Math.floor(args.count !== undefined ? num(args.count, 'count') : 3)));
      const radius = Math.max(1, Math.min(96, Math.floor(args.radius !== undefined ? num(args.radius, 'radius') : 48)));
      const hasXYZ = args.x !== undefined && args.y !== undefined && args.z !== undefined;
      const givenX = hasXYZ ? Math.floor(num(args.x, 'x')) : undefined;
      const givenY = hasXYZ ? Math.floor(num(args.y, 'y')) : undefined;
      const givenZ = hasXYZ ? Math.floor(num(args.z, 'z')) : undefined;

      if (!(await hasShears(a))) {
        throw new Error(NO_SHEARS_MSG);
      }

      if (givenX !== undefined && givenY !== undefined && givenZ !== undefined) {
        if (onVillageGround(a, givenX, givenZ, givenY)) {
          throw new Error(`${givenX},${givenY},${givenZ} is on village ground: harvest honeycomb only from bee nests off village ground`);
        }
        const p0 = a.bot.entity.position;
        const distXZ = Math.hypot(givenX - p0.x, givenZ - p0.z);
        if (distXZ > 12) {
          try {
            await walkDry(
              a,
              new goals.GoalNearXZ(givenX, givenZ, 4),
              `${givenX},${givenY},${givenZ}`,
              signal,
              Math.min(90000, Math.round((20000 + distXZ * 1200) / Math.max(1, timeScale()))),
            );
          } catch (e) {
            if ((e as Error).message === 'cancelled') throw e;
          }
        }
      }

      const ids = beeBlockIds(a);
      const hcBefore = await serverHoneycombCount(a);
      const scale = Math.max(1, timeScale());
      const maxWallMs = Math.round(180_000 / scale);
      const t0 = Date.now();

      const tried = new Set<string>();
      let sawAnyBeeBlock = false;
      let sawInState = 0;
      let nestsHarvested = 0;
      let lastPos: Vec3 | null = null;
      let givenChecked = !hasXYZ;
      let stopWhy = `reached target of ${want} honeycomb`;

      while (true) {
        checkAbort(signal);
        const hcNow = await serverHoneycombCount(a);
        if (hcNow - hcBefore >= want) {
          stopWhy = `reached target of ${want} honeycomb`;
          break;
        }

        if (Date.now() - t0 >= maxWallMs) {
          stopWhy = '3 minute time limit reached';
          break;
        }

        if (!(await hasShears(a))) {
          stopWhy = 'the shears broke';
          break;
        }

        let targetPos: Vec3 | null = null;

        if (!givenChecked && givenX !== undefined && givenY !== undefined && givenZ !== undefined) {
          givenChecked = true;
          const gp = new Vec3(givenX, givenY, givenZ);
          const key = `${gp.x},${gp.y},${gp.z}`;
          if (!onVillageGround(a, gp.x, gp.z, gp.y)) {
            const lvl = readHoneyLevel(a, gp);
            if (lvl !== null) {
              sawAnyBeeBlock = true;
              if (lvl === 5) {
                sawInState++;
                targetPos = gp;
              } else {
                tried.add(key);
              }
            } else {
              tried.add(key);
            }
          }
        }

        if (!targetPos) {
          const found = ids.length
            ? nearestBlocks(a, ids, radius, 24, (p) => {
                if (onVillageGround(a, p.x, p.z, p.y)) return false;
                const lvl = readHoneyLevel(a, p);
                if (lvl === null) return false;
                sawAnyBeeBlock = true;
                const key = `${p.x},${p.y},${p.z}`;
                if (tried.has(key)) return false;
                return lvl === 5;
              })
            : [];
          if (found.length > 0) {
            sawInState += found.length;
            targetPos = found[0];
          }
        }

        if (!targetPos) {
          stopWhy = `no more bee nests in the state honey_level=5 within ${radius} blocks`;
          break;
        }

        const targetKey = `${targetPos.x},${targetPos.y},${targetPos.z}`;
        tried.add(targetKey);

        // If the target is far, walk near it horizontally first so surrounding ground blocks are in view
        const pBeforeWalk = a.bot.entity.position;
        const distToTargetXZ = Math.hypot(targetPos.x + 0.5 - pBeforeWalk.x, targetPos.z + 0.5 - pBeforeWalk.z);
        if (distToTargetXZ > 8) {
          try {
            await walkDry(
              a,
              new goals.GoalNearXZ(targetPos.x, targetPos.z, 3),
              at(targetPos),
              signal,
              Math.min(60000, Math.round((15000 + distToTargetXZ * 1200) / scale)),
            );
          } catch (e) {
            if ((e as Error).message === 'cancelled') throw e;
          }
        }

        const stands = findStandSpots(a, targetPos);
        if (stands.length === 0) continue;

        let reachedStand = false;
        const targetCenter = new Vec3(targetPos.x + 0.5, targetPos.y + 0.5, targetPos.z + 0.5);

        for (const stand of stands.slice(0, 6)) {
          checkAbort(signal);
          const bp = a.bot.entity.position;
          const bf = bp.floored();
          const alreadyAtStand = bf.x === stand.x && bf.z === stand.z && Math.abs(bp.y - stand.y) <= 0.6;
          if (!alreadyAtStand) {
            try {
              await walkDry(
                a,
                new goals.GoalBlock(stand.x, stand.y, stand.z),
                `${stand.x},${stand.y},${stand.z}`,
                signal,
                Math.max(10000, Math.round(25000 / scale)),
              );
            } catch (e) {
              if ((e as Error).message === 'cancelled') throw e;
              try {
                await walkDry(
                  a,
                  new goals.GoalNear(stand.x, stand.y, stand.z, 1),
                  `${stand.x},${stand.y},${stand.z}`,
                  signal,
                  Math.max(8000, Math.round(18000 / scale)),
                );
              } catch (e2) {
                if ((e2 as Error).message === 'cancelled') throw e2;
                continue;
              }
            }
          }

          const nowPos = a.bot.entity.position;
          const nowFloor = nowPos.floored();
          const hd = Math.hypot(nowFloor.x - targetPos.x, nowFloor.z - targetPos.z);
          const eyeDist = nowPos.offset(0, 1.62, 0).distanceTo(targetCenter);
          const inWater = wetAt(a, nowFloor) || !!(a.bot.entity as unknown as { isInWater?: boolean }).isInWater;
          if (!inWater && !onVillageGround(a, nowFloor.x, nowFloor.z, nowFloor.y) && hd <= 3.5 && eyeDist <= 4.5) {
            reachedStand = true;
            break;
          }
        }

        if (!reachedStand) continue;
        a.halt();

        // Re-read the block's state on arrival (another member may have used it: skip it)
        const arrivalLvl = readHoneyLevel(a, targetPos);
        if (arrivalLvl !== 5) continue;

        // Equip shears in main hand
        if (!(await hasShears(a))) {
          stopWhy = 'the shears broke';
          break;
        }
        let shearsItem = a.bot.inventory?.items().find((i) => i.name === 'shears');
        if (!shearsItem) {
          await syncInventory(a);
          shearsItem = a.bot.inventory?.items().find((i) => i.name === 'shears');
        }
        if (!shearsItem) {
          stopWhy = 'the shears broke';
          break;
        }
        if (a.bot.heldItem?.name !== 'shears') {
          await a.bot.equip(shearsItem, 'hand');
          await sleep(Math.max(60, Math.round(120 / scale)), signal);
        }

        const block = a.bot.blockAt(targetPos);
        if (!block || !isBeeBlockName(block.name)) continue;

        const hcBeforeTarget = await serverHoneycombCount(a);
        const { faceDir, lookPoint } = faceTowardBot(a, targetPos);
        await a.bot.lookAt(lookPoint, true);
        checkAbort(signal);
        await a.bot.activateBlock(block, faceDir);

        // Wait up to 2 s for the state to change
        const waitLimit = Math.max(400, Math.round(2000 / scale));
        const stepMs = Math.max(80, Math.round(150 / scale));
        let waited = 0;
        let retried = false;
        while (waited < waitLimit) {
          await sleep(stepMs, signal);
          waited += stepMs;
          const curLvl = readHoneyLevel(a, targetPos);
          if (curLvl !== null && curLvl < 5) break;
          if (!retried && waited >= Math.round(waitLimit * 0.45)) {
            retried = true;
            const bNow = a.bot.blockAt(targetPos);
            if (bNow && isBeeBlockName(bNow.name) && readHoneyLevel(a, targetPos) === 5) {
              const sh = a.bot.inventory?.items().find((i) => i.name === 'shears');
              if (sh && a.bot.heldItem?.name !== 'shears') await a.bot.equip(sh, 'hand');
              await a.bot.lookAt(lookPoint, true);
              await a.bot.activateBlock(bNow, faceDir);
            }
          }
        }

        // Pick up dropped honeycomb items within 6 blocks
        const hcAfterTarget = await pickUpNearbyDrops(a, targetPos, signal, scale, hcBeforeTarget, hcBefore, want);
        if (hcAfterTarget > hcBeforeTarget) {
          nestsHarvested++;
          lastPos = targetPos;
          placeCache.clear();
        }
        if (hcAfterTarget - hcBefore >= want) {
          stopWhy = `reached target of ${want} honeycomb`;
          break;
        }
      }

      const hcAfter = await serverHoneycombCount(a);
      const gained = Math.max(0, hcAfter - hcBefore);

      if (gained === 0) {
        if (stopWhy === 'the shears broke') {
          throw new Error('no shears: the shears broke; withdraw one from storage');
        }
        const where = givenX !== undefined && givenY !== undefined && givenZ !== undefined
          ? `${givenX},${givenY},${givenZ}`
          : at(a.bot.entity.position);
        if (!sawAnyBeeBlock) {
          throw new Error(`no bee nest or beehive within ${radius} blocks of ${where}: explore to find one`);
        }
        if (sawInState === 0) {
          throw new Error(`no bee nest or beehive in the state honey_level=5 within ${radius} blocks of ${where} (all of them used: bees refill them over minutes; try later)`);
        }
        throw new Error(`no honeycomb gathered from bee nests within ${radius} blocks of ${where} (bees refill them over minutes; try later)`);
      }

      const moreInState = ids.length
        ? nearestBlocks(a, ids, radius, 24, (p) => !onVillageGround(a, p.x, p.z, p.y) && readHoneyLevel(a, p) === 5).length
        : 0;
      const coord = lastPos ? `${lastPos.x},${lastPos.y},${lastPos.z}` : at(a.bot.entity.position);
      return `got ${gained} honeycomb from ${nestsHarvested} bee nests at ${coord} (${moreInState} more in the state within ${radius} blocks): ${stopWhy}`;
    },
  },

  tool: {
    name: 'harvest_honeycomb',
    description: 'Harvest honeycomb by using shears from inventory on nearby bee_nest or beehive blocks in the state honey_level=5 without breaking or placing blocks.',
    input_schema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of honeycomb to gather (1-12, default 3).' },
        x: { type: 'number', description: 'Optional bee nest or beehive X coordinate to harvest.' },
        y: { type: 'number', description: 'Optional bee nest or beehive Y coordinate to harvest.' },
        z: { type: 'number', description: 'Optional bee nest or beehive Z coordinate to harvest.' },
        radius: { type: 'number', description: 'Max distance to search for bee nests or beehives when x, y, z are not given (1-96, default 48).' },
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
        const a = ctx.agent;
        if (!a || !a.bot || typeof a.bot.blockAt !== 'function') {
          return { why: NO_PLACE_MSG };
        }

        if (vName) {
          const hit = placeCache.get(vName);
          if (hit && now - hit.at < PLACE_CACHE_MS && hit.hx === hut.x && hit.hz === hut.z) {
            if ('why' in hit.place) {
              lastPlaceTarget.delete(vName);
              return hit.place;
            }
            const px = Number(hit.place.x), py = Number(hit.place.y), pz = Number(hit.place.z);
            const curLvl = readHoneyLevel(a, new Vec3(px, py, pz));
            if (curLvl === 5) {
              lastPlaceTarget.set(vName, { x: px, y: py, z: pz });
              return hit.place;
            }
          }
        }

        let listEntry = vName ? nestListCache.get(vName) : undefined;
        if (!listEntry || now - listEntry.at >= LIST_REFRESH_MS || listEntry.hx !== hut.x || listEntry.hz !== hut.z) {
          const ids = beeBlockIds(a);
          const pos = a.bot.entity?.position;
          const canSearch = ids.length > 0 && pos && typeof pos.floored === 'function';
          const found = canSearch
            ? nearestBlocks(a, ids, HUT_RADIUS, HUT_MAX_NESTS, (p) => {
                if (Math.hypot(p.x - hut.x, p.z - hut.z) > HUT_RADIUS) return false;
                if (onVillageGround(a, p.x, p.z, p.y)) return false;
                return true;
              })
            : [];
          found.sort((u, v) => Math.hypot(u.x - hut.x, u.z - hut.z) - Math.hypot(v.x - hut.x, v.z - hut.z));
          listEntry = { at: now, hx: hut.x, hz: hut.z, nests: found.slice(0, HUT_MAX_NESTS) };
          if (vName) nestListCache.set(vName, listEntry);
        }

        let chosen: Vec3 | null = null;
        for (const p of listEntry.nests) {
          if (onVillageGround(a, p.x, p.z, p.y)) continue;
          if (readHoneyLevel(a, p) === 5) {
            chosen = p;
            break;
          }
        }

        const ans: FoundryPlace = chosen
          ? { x: chosen.x, y: chosen.y, z: chosen.z }
          : { why: NO_PLACE_MSG };

        if (vName) {
          placeCache.set(vName, { at: now, hx: hut.x, hz: hut.z, place: ans });
          if (chosen) lastPlaceTarget.set(vName, { x: chosen.x, y: chosen.y, z: chosen.z });
          else lastPlaceTarget.delete(vName);
        }
        return ans;
      } catch {
        return { why: NO_PLACE_MSG };
      }
    },

    holds(v): string[] {
      try {
        const p = v?.name ? lastPlaceTarget.get(v.name) : undefined;
        return p ? [`honeycomb:${p.x},${p.y},${p.z}`] : [];
      } catch {
        return [];
      }
    },
  },
};
