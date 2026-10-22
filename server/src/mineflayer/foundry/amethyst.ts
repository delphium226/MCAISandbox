/**
 * Foundry skill `harvest_amethyst`: dig a staircase down to underground amethyst geodes sealed underground, mine
 * amethyst clusters for amethyst shard using a pickaxe without breaking budding amethyst, pick up drops, and climb
 * back up to the surface. Includes the activity adapter that tracks amethyst clusters within 144 blocks of the hut.
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
  reach,
  sleep,
  standableY,
  syncInventory,
  walk,
  wetAt,
  wetOver,
} from '../mcUtil';
import { timeScale } from '../mcRules';
import { FALLING } from '../mcBlocks';

type FoundryPlace = Record<string, unknown> | { why: string };

const NO_PICKAXE_MSG = 'no pickaxe: withdraw one from storage';
const NO_CLUSTER_MSG = 'no amethyst cluster known within 144 blocks of the storage hut away from the village (explore to find a geode)';
const LIST_REFRESH_MS = 10 * 60_000;
const PLACE_CACHE_MS = 60_000;
const HUT_RADIUS = 144;
const HUT_MAX_CLUSTERS = 24;

const PICK_TIERS = [
  'netherite_pickaxe',
  'diamond_pickaxe',
  'iron_pickaxe',
  'golden_pickaxe',
  'stone_pickaxe',
  'wooden_pickaxe',
] as const;

interface CachedClusterList {
  at: number;
  hx: number;
  hz: number;
  clusters: Vec3[];
}

interface CachedPlace {
  at: number;
  hx: number;
  hz: number;
  place: FoundryPlace;
}

const clusterListCache = new Map<string, CachedClusterList>();
const placeCache = new Map<string, CachedPlace>();
const lastPlaceTarget = new Map<string, { x: number; y: number; z: number }>();

/**
 * Check whether (x, z) is within `margin` blocks horizontally of any village's ground (plots, structures, layouts).
 * Evaluates in 2D so underground depths are not falsely excluded by surface height filters.
 */
function withinVillageGroundXZ(a: BotAgent, x: number, z: number, margin = 8): boolean {
  const villages = a.world?.villages?.villages;
  if (!villages) return false;
  for (const v of villages.values()) {
    for (const p of v.plots ?? []) {
      if (
        x >= Math.min(p.x1, p.x2) - margin &&
        x <= Math.max(p.x1, p.x2) + margin &&
        z >= Math.min(p.z1, p.z2) - margin &&
        z <= Math.max(p.z1, p.z2) + margin
      ) {
        return true;
      }
    }
    for (const s of v.structures ?? []) {
      if (
        x >= Math.min(s.x1, s.x2) - margin &&
        x <= Math.max(s.x1, s.x2) + margin &&
        z >= Math.min(s.z1, s.z2) - margin &&
        z <= Math.max(s.z1, s.z2) + margin
      ) {
        return true;
      }
    }
    for (const l of v.layouts ?? []) {
      if (
        x >= Math.min(l.x1, l.x2) - margin &&
        x <= Math.max(l.x1, l.x2) + margin &&
        z >= Math.min(l.z1, l.z2) - margin &&
        z <= Math.max(l.z1, l.z2) + margin
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Check on the server or inventory whether the agent has any usable pickaxe. */
async function hasPickaxe(a: BotAgent): Promise<boolean> {
  const tagged = await a.world.rcon.count(a.name, '#minecraft:pickaxes').catch(() => null);
  if (tagged !== null) {
    if (tagged <= 0) return false;
    if (!a.bot.inventory?.items().some((i) => i.name.endsWith('_pickaxe'))) {
      await syncInventory(a);
    }
    return true;
  }
  let total = 0;
  for (const p of PICK_TIERS) {
    const c = await a.world.rcon.count(a.name, `minecraft:${p}`).catch(() => null);
    if (c === null) {
      total = -1;
      break;
    }
    total += c;
  }
  if (total >= 0) {
    if (total <= 0) return false;
    if (!a.bot.inventory?.items().some((i) => i.name.endsWith('_pickaxe'))) {
      await syncInventory(a);
    }
    return true;
  }
  if (a.bot.inventory?.items().some((i) => i.name.endsWith('_pickaxe'))) return true;
  await syncInventory(a);
  return a.bot.inventory?.items().some((i) => i.name.endsWith('_pickaxe')) ?? false;
}

/** Find the best pickaxe in inventory. */
function getPickaxe(a: BotAgent) {
  const items = a.bot.inventory?.items() ?? [];
  for (const tier of PICK_TIERS) {
    const it = items.find((i) => i.name === tier);
    if (it) return it;
  }
  return items.find((i) => i.name.endsWith('_pickaxe'));
}

/** Equip a pickaxe in main hand, throwing if none is left. */
async function equipPickaxe(a: BotAgent): Promise<void> {
  let pick = getPickaxe(a);
  if (!pick) {
    await syncInventory(a);
    pick = getPickaxe(a);
  }
  if (!pick) {
    throw new Error('the pickaxe broke: withdraw another');
  }
  if (a.bot.heldItem?.name !== pick.name) {
    await a.bot.equip(pick, 'hand');
  }
}

/** Count amethyst shards on the server via `clear <name> minecraft:amethyst_shard 0`. */
async function serverShardCount(a: BotAgent): Promise<number> {
  const n = await a.world.rcon.count(a.name, 'minecraft:amethyst_shard').catch(() => null);
  if (n !== null) return n;
  const id = itemId(a, 'amethyst_shard');
  return id !== undefined ? countItem(a, id) : 0;
}

/** Whether the server still has `name` at `pos` after a dig. */
async function stillOnServer(a: BotAgent, pos: Vec3, name: string, ms: number, signal: AbortSignal): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    const r = await a.world.rcon.command(`execute if block ${pos.x} ${pos.y} ${pos.z} minecraft:${name}`).catch(() => '');
    if (!/passed/i.test(r)) return false;
    if (Date.now() + 150 > end) return true;
    await sleep(150, signal);
  }
}

/** Check why a cell cannot be dug safely (returns null if safe). */
function unsafeAmethyst(a: BotAgent, p: Vec3): string | null {
  const b = a.bot.blockAt(p);
  if (!b) return `${p.x},${p.y},${p.z} is not loaded: the tunnel stops there (try another one)`;
  if (b.name === 'budding_amethyst') return 'budding amethyst';
  if (wetAt(a, p) || /water|lava/.test(b.name)) {
    return `${b.name} beside the way down at ${p.x},${p.y},${p.z}: the tunnel stops there (try another one)`;
  }
  for (const [dx, dy, dz] of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]) {
    const nbPos = p.offset(dx, dy, dz);
    const nb = a.bot.blockAt(nbPos);
    if (wetAt(a, nbPos) || (nb && /water|lava/.test(nb.name))) {
      const kind = nb ? nb.name : 'water or lava';
      return `${kind} beside the way down at ${p.x},${p.y},${p.z}: the tunnel stops there (try another one)`;
    }
    if (nb && (FALLING.has(nb.name) || /sand|gravel/.test(nb.name))) {
      return `${nb.name} beside the way down at ${p.x},${p.y},${p.z}: the tunnel stops there (try another one)`;
    }
  }
  for (let upY = 1; upY <= 8; upY++) {
    const up = a.bot.blockAt(p.offset(0, upY, 0));
    if (up && (FALLING.has(up.name) || /sand|gravel/.test(up.name))) {
      return `${up.name} over ${p.x},${p.y},${p.z} (falling block): the tunnel stops there (try another one)`;
    }
  }
  if (wetOver(a, p)) {
    return `water or lava over ${p.x},${p.y},${p.z}: the tunnel stops there (try another one)`;
  }
  if (withinVillageGroundXZ(a, p.x, p.z, 0)) {
    return `${p.x},${p.y},${p.z} is on village ground: the tunnel stops there (try another one)`;
  }
  return null;
}

/** Find the highest solid block Y coordinate in the column at (x, z), not counting trees (leaves, logs). */
function getColumnSurfaceY(a: BotAgent, x: number, z: number): number | null {
  const p = new Vec3(x, 0, z);
  const botY = Math.floor(a.bot.entity.position.y);
  for (let y = Math.min(319, Math.max(128, botY + 48)); y >= botY - 1; y--) {
    p.y = y;
    const b = a.bot.blockAt(p);
    if (b && b.boundingBox === 'block' && !/leaves|_log$|_wood$|_stem$|hyphae/.test(b.name)) {
      return y;
    }
  }
  return null;
}

/** Name the blocks at a cell's feet, head and head+1 (for climb log lines and failure messages). */
function cellsAt(a: BotAgent, p: Vec3): string {
  const n = (dy: number) => a.bot.blockAt(p.offset(0, dy, 0))?.name ?? 'unloaded';
  return `feet=${n(0)}, head=${n(1)}, head+1=${n(2)}`;
}

/** Dig a single cell with pickaxe equipped, never breaking budding amethyst or placing blocks. */
async function digAmethystCell(a: BotAgent, p: Vec3, signal: AbortSignal): Promise<boolean> {
  checkAbort(signal);
  const b = a.bot.blockAt(p);
  if (!b || b.boundingBox === 'empty') return false;
  if (b.name === 'budding_amethyst') {
    throw new Error(`cannot break budding_amethyst at ${at(p)}`);
  }
  const name = b.name;
  await equipPickaxe(a);

  a.bot.pathfinder.setGoal(null);
  for (let i = 0; i < 30 && a.bot.pathfinder.isMining(); i++) {
    await sleep(100, signal);
  }

  await a.bot.lookAt(p.offset(0.5, 0.5, 0.5), true);
  const state = b.stateId;
  const late = Math.max(450, 4 * a.bot.digTime(b));

  try {
    const digPromise = a.bot.dig(b, true);
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        try {
          a.bot.stopDigging();
        } catch {
          /* ignore */
        }
        reject(new Error('cancelled'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      digPromise.then(
        () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });
  } catch (e) {
    if ((e as Error).message === 'cancelled') throw e;
    if (!getPickaxe(a)) {
      throw new Error('the pickaxe broke: withdraw another');
    }
    const bNow = a.bot.blockAt(p);
    if (!bNow || bNow.name !== name) {
      a.pushEvent('broke', `broke ${name} at ${at(p)}`, { block: name, x: p.x, y: p.y, z: p.z });
      return true;
    }
    await sleep(300, signal);
    await equipPickaxe(a);
    const bRetry = a.bot.blockAt(p);
    if (bRetry && bRetry.boundingBox !== 'empty') {
      try {
        await a.bot.dig(bRetry, true);
      } catch (e2) {
        if ((e2 as Error).message === 'cancelled') throw e2;
        if (!getPickaxe(a)) {
          throw new Error('the pickaxe broke: withdraw another');
        }
      }
    }
  }

  if (!getPickaxe(a)) {
    throw new Error('the pickaxe broke: withdraw another');
  }

  if (await stillOnServer(a, p, name, late, signal)) {
    const view = a.bot.world as unknown as { setBlockStateId(pos: Vec3, id: number): void };
    view.setBlockStateId(p, state);
    await equipPickaxe(a);
    const bServerRetry = a.bot.blockAt(p);
    if (bServerRetry && bServerRetry.boundingBox !== 'empty') {
      try {
        await a.bot.dig(bServerRetry, true);
      } catch (e3) {
        if ((e3 as Error).message === 'cancelled') throw e3;
        if (!getPickaxe(a)) {
          throw new Error('the pickaxe broke: withdraw another');
        }
      }
    }
    if (await stillOnServer(a, p, name, late, signal)) {
      view.setBlockStateId(p, state);
      throw new Error(`the ${name} at ${at(p)} is still there after digging it twice (the server did not count the digs); try another one`);
    }
  }

  a.pushEvent('broke', `broke ${name} at ${at(p)}`, { block: name, x: p.x, y: p.y, z: p.z });
  return true;
}

/** Walk with digging and scaffolding disabled. */
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
  m.canDig = false;
  m.scafoldingBlocks = [];
  m.allow1by1towers = false;
  m.allowParkour = false;
  try {
    await walk(a, goal, label, signal, timeoutMs, { scaffold: false });
  } finally {
    m.canDig = prevDig;
    m.scafoldingBlocks = prevScaf;
    m.allow1by1towers = prevTowers;
    m.allowParkour = prevParkour;
  }
}

/** Walk into an open dug staircase step. */
async function walkToStep(a: BotAgent, pos: Vec3, signal: AbortSignal): Promise<void> {
  if (a.bot.entity.position.distanceTo(pos) <= 0.8) return;

  // Direct physical nudge first for adjacent step (distance <= 2.2 blocks)
  const dist = a.bot.entity.position.distanceTo(pos);
  if (dist <= 2.2) {
    checkAbort(signal);
    const goingUp = pos.y > a.bot.entity.position.y + 0.3;
    await a.bot.lookAt(pos.offset(0, goingUp ? 0.8 : 0.2, 0), true);
    a.bot.setControlState('forward', true);
    if (goingUp) a.bot.setControlState('jump', true);
    for (let i = 0; i < 15 && a.bot.entity.position.distanceTo(pos) > 0.8; i++) {
      await sleep(50, signal);
    }
    a.bot.setControlState('forward', false);
    if (goingUp) a.bot.setControlState('jump', false);
    if (a.bot.entity.position.distanceTo(pos) <= 0.8) {
      a.halt();
      return;
    }
  }

  // Fallback to pathfinder reach
  const m = a.moves();
  const prevDig = m.canDig;
  const prevScaf = m.scafoldingBlocks;
  const prevTowers = m.allow1by1towers;
  m.canDig = false;
  m.scafoldingBlocks = [];
  m.allow1by1towers = false;
  try {
    await reach(a, pos, 0.8, signal, 3000);
  } catch (e) {
    if ((e as Error).message === 'cancelled') throw e;
  } finally {
    m.canDig = prevDig;
    m.scafoldingBlocks = prevScaf;
    m.allow1by1towers = prevTowers;
  }

  if (a.bot.entity.position.distanceTo(pos) > 0.8) {
    checkAbort(signal);
    const goingUp = pos.y > a.bot.entity.position.y + 0.3;
    await a.bot.lookAt(pos.offset(0, goingUp ? 0.8 : 0.2, 0), true);
    a.bot.setControlState('forward', true);
    if (goingUp) a.bot.setControlState('jump', true);
    for (let i = 0; i < 20 && a.bot.entity.position.distanceTo(pos) > 0.8; i++) {
      await sleep(50, signal);
    }
    a.bot.setControlState('forward', false);
    if (goingUp) a.bot.setControlState('jump', false);
  }
  a.halt();
}

/** Whether the bot has unobstructed line of sight to `targetPos` within survival reach. */
function hasLineOfSight(a: BotAgent, targetPos: Vec3): boolean {
  const eye = a.bot.entity.position.offset(0, 1.62, 0);
  const targetCenter = targetPos.offset(0.5, 0.5, 0.5);
  const dist = eye.distanceTo(targetCenter);
  if (dist > 4.5) return false;
  const steps = Math.max(2, Math.ceil(dist * 6));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const px = Math.floor(eye.x + (targetCenter.x - eye.x) * t);
    const py = Math.floor(eye.y + (targetCenter.y - eye.y) * t);
    const pz = Math.floor(eye.z + (targetCenter.z - eye.z) * t);
    if (px === targetPos.x && py === targetPos.y && pz === targetPos.z) break;
    const b = a.bot.blockAt(new Vec3(px, py, pz));
    if (b && b.boundingBox === 'block') {
      return false;
    }
  }
  return true;
}

/** Find all amethyst clusters within 4 blocks of the bot that have line of sight. */
function findReachableClusters(a: BotAgent): Vec3[] {
  const bp = a.bot.entity.position;
  const bx = Math.floor(bp.x);
  const by = Math.floor(bp.y);
  const bz = Math.floor(bp.z);
  const clusters: Vec3[] = [];
  for (let dx = -4; dx <= 4; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dz = -4; dz <= 4; dz++) {
        const p = new Vec3(bx + dx, by + dy, bz + dz);
        const b = a.bot.blockAt(p);
        if (b && b.name === 'amethyst_cluster') {
          if (hasLineOfSight(a, p)) {
            clusters.push(p);
          }
        }
      }
    }
  }
  clusters.sort((u, v) => u.distanceTo(bp) - v.distanceTo(bp));
  return clusters;
}

/** Pick up dropped amethyst shard items within 6 blocks. */
async function pickUpShardDrops(a: BotAgent, signal: AbortSignal, scale: number): Promise<void> {
  await sleep(Math.max(150, Math.round(350 / scale)), signal);
  const maxPickupMs = Math.max(1500, Math.round(4000 / scale));
  const t0 = Date.now();
  while (Date.now() - t0 < maxPickupMs) {
    checkAbort(signal);
    const bp = a.bot.entity.position;
    if (!bp) break;
    const drops = Object.values(a.bot.entities ?? {}).filter((e) => {
      if (!e || e.name !== 'item' || !e.position) return false;
      return e.position.distanceTo(bp) <= 6;
    });
    if (drops.length === 0) break;
    drops.sort((u, v) => u.position.distanceTo(bp) - v.position.distanceTo(bp));
    const drop = drops[0];
    if (drop.position.distanceTo(bp) > 0.8) {
      try {
        await walkDry(a, new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 0.6), 'shard drop', signal, 3500);
      } catch {
        /* continue */
      }
    }
    await sleep(Math.max(100, Math.round(150 / scale)), signal);
  }
}

export const FOUNDRY: FoundrySkill = {
  name: 'harvest_amethyst',
  skill: {
    check: (args) => {
      if (args.count !== undefined) num(args.count, 'count');
      if (args.x !== undefined || args.y !== undefined || args.z !== undefined) {
        if (args.x !== undefined) num(args.x, 'x');
        if (args.y !== undefined) num(args.y, 'y');
        if (args.z !== undefined) num(args.z, 'z');
      }
      if (args.radius !== undefined) num(args.radius, 'radius');
    },

    async run(a, args, signal) {
      checkAbort(signal);

      const want = Math.max(1, Math.min(16, Math.floor(args.count !== undefined ? num(args.count, 'count') : 4)));
      const radius = Math.max(1, Math.min(64, Math.floor(args.radius !== undefined ? num(args.radius, 'radius') : 32)));
      const hasXYZ = args.x !== undefined && args.y !== undefined && args.z !== undefined;
      const givenX = hasXYZ ? Math.floor(num(args.x, 'x')) : undefined;
      const givenY = hasXYZ ? Math.floor(num(args.y, 'y')) : undefined;
      const givenZ = hasXYZ ? Math.floor(num(args.z, 'z')) : undefined;

      if (!(await hasPickaxe(a))) {
        throw new Error(NO_PICKAXE_MSG);
      }

      let targetPos: Vec3;
      if (hasXYZ && givenX !== undefined && givenY !== undefined && givenZ !== undefined) {
        targetPos = new Vec3(givenX, givenY, givenZ);
        const b = a.bot.blockAt(targetPos);
        if (b && b.name !== 'amethyst_cluster') {
          throw new Error(`no amethyst cluster at ${givenX},${givenY},${givenZ}: explore to find a geode`);
        }
      } else {
        const clusterId = a.world?.registry?.blocksByName?.amethyst_cluster?.id;
        if (clusterId === undefined) {
          throw new Error(`no amethyst cluster found within ${radius} blocks of ${at(a.bot.entity.position)} (explore to find a geode)`);
        }
        const found = nearestBlocks(a, [clusterId], radius, 24, (p) => !withinVillageGroundXZ(a, p.x, p.z, 8));
        if (found.length === 0) {
          throw new Error(`no amethyst cluster found within ${radius} blocks of ${at(a.bot.entity.position)} (explore to find a geode)`);
        }
        targetPos = found[0];
      }

      // Find a standable cell 3-6 blocks horizontally from target's column, not within 8 blocks (x, z) of village ground
      const botPos = a.bot.entity.position;
      const botFloor = botPos.floored();
      let bestSurfaceSpot: Vec3 | null = null;
      let bestScore = Infinity;

      for (let dx = -6; dx <= 6; dx++) {
        for (let dz = -6; dz <= 6; dz++) {
          const hDist = Math.hypot(dx, dz);
          if (hDist < 2.8 || hDist > 6.2) continue;
          const sx = targetPos.x + dx;
          const sz = targetPos.z + dz;
          if (withinVillageGroundXZ(a, sx, sz, 8)) continue;
          const sy = standableY(a, sx, Math.floor(botPos.y), sz, 20);
          if (sy === null) continue;
          if (withinVillageGroundXZ(a, sx, sz, 8)) continue;

          const alreadyHere = botFloor.x === sx && botFloor.z === sz && Math.abs(botPos.y - sy) <= 0.6;
          const dBot = alreadyHere ? -50 : Math.hypot(sx + 0.5 - botPos.x, sz + 0.5 - botPos.z);
          const score = dBot + Math.abs(hDist - 5) * 2;
          if (score < bestScore) {
            bestScore = score;
            bestSurfaceSpot = new Vec3(sx, sy, sz);
          }
        }
      }

      if (!bestSurfaceSpot) {
        bestSurfaceSpot = new Vec3(botFloor.x, Math.floor(botPos.y), botFloor.z);
      }

      // Walk to the surface stand spot
      const curFloor = a.bot.entity.position.floored();
      if (curFloor.x !== bestSurfaceSpot.x || curFloor.z !== bestSurfaceSpot.z || Math.abs(curFloor.y - bestSurfaceSpot.y) > 0.6) {
        try {
          await walkDry(
            a,
            new goals.GoalBlock(bestSurfaceSpot.x, bestSurfaceSpot.y, bestSurfaceSpot.z),
            `${bestSurfaceSpot.x},${bestSurfaceSpot.y},${bestSurfaceSpot.z}`,
            signal,
            35000,
          );
        } catch (e) {
          if ((e as Error).message === 'cancelled') throw e;
        }
      }

      a.halt();

      // Re-check target cluster after walking
      const targetBlock = a.bot.blockAt(targetPos);
      if (targetBlock && targetBlock.name !== 'amethyst_cluster') {
        throw new Error(`no amethyst cluster at ${targetPos.x},${targetPos.y},${targetPos.z}: explore to find a geode`);
      }

      const shardsBefore = await serverShardCount(a);
      const scale = Math.max(1, timeScale());
      const maxWallMs = Math.round(300_000 / scale);
      const t0 = Date.now();

      const startStand = a.bot.entity.position.floored();
      const dugStairs: Vec3[] = [startStand.clone()];
      let dugCellsCount = 0;
      let clustersMined = 0;
      let stopWhy = `reached target of ${want} amethyst shard`;
      const depth = Math.abs(startStand.y - targetPos.y);
      // (the ticket's 48-cell cap did not reach a geode 16 down with the turns' extra cells: it grows with the depth, to 192)
      const maxDugCells = Math.min(192, Math.max(96, Math.ceil((depth + 8) * 4)));

      // Corridor bounds: between Gus's spot and the geode / target, widened by 1
      const minX = Math.min(startStand.x, targetPos.x - 3) - 1;
      const maxX = Math.max(startStand.x, targetPos.x + 3) + 1;
      const minZ = Math.min(startStand.z, targetPos.z - 3) - 1;
      const maxZ = Math.max(startStand.z, targetPos.z + 3) + 1;

      let currentPos = startStand.clone();
      let lastDx = 0;
      let lastDz = 0;

      // Phase 1: Dig staircase down toward the target depth
      while (currentPos.y > targetPos.y && dugCellsCount < maxDugCells && Date.now() - t0 < maxWallMs) {
        checkAbort(signal);

        // If we already have line of sight to a cluster, stop descending
        if (findReachableClusters(a).length > 0) {
          break;
        }

        const distX = targetPos.x - currentPos.x;
        const distZ = targetPos.z - currentPos.z;
        const candDirs: Array<[number, number]> = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];

        interface StepCandidate {
          dx: number;
          dz: number;
          score: number;
          unsafeWhy: string | null;
        }

        const evaluated: StepCandidate[] = [];

        for (const [dx, dz] of candDirs) {
          const nextX = currentPos.x + dx;
          const nextZ = currentPos.z + dz;
          if (nextX < minX || nextX > maxX || nextZ < minZ || nextZ > maxZ) continue;
          if (dx === -lastDx && dz === -lastDz) continue;

          // Check the 3 cells for this step (headroom, head, feet)
          const cHeadSpace = new Vec3(nextX, currentPos.y + 1, nextZ);
          const cHead = new Vec3(nextX, currentPos.y, nextZ);
          const cFeet = new Vec3(nextX, currentPos.y - 1, nextZ);

          let whyUnsafe: string | null = null;
          for (const cp of [cHeadSpace, cHead, cFeet]) {
            const why = unsafeAmethyst(a, cp);
            if (why) {
              whyUnsafe = why;
              break;
            }
          }

          // If turning, also check headroom over the turn
          const isTurn = (lastDx !== 0 || lastDz !== 0) && (dx !== lastDx || dz !== lastDz);
          if (!whyUnsafe && isTurn) {
            const cTurnHead = new Vec3(nextX, currentPos.y + 2, nextZ);
            const why = unsafeAmethyst(a, cTurnHead);
            if (why) whyUnsafe = why;
          }

          const newDistH = Math.hypot(targetPos.x - nextX, targetPos.z - nextZ);
          // Prioritize moving closer to the target column (lower score = higher priority)
          // When within 2.2 blocks horizontally, stay beside the geode rather than cutting into the hollow from above
          const score = (newDistH >= 2.2 ? newDistH : (2.2 - newDistH) * 5) - (dx === lastDx && dz === lastDz ? 0.4 : 0);

          evaluated.push({ dx, dz, score, unsafeWhy: whyUnsafe });
        }

        evaluated.sort((u, v) => u.score - v.score);
        const valid = evaluated.filter((e) => !e.unsafeWhy);

        if (valid.length === 0) {
          const firstBlocked = evaluated[0]?.unsafeWhy;
          if (firstBlocked && !/budding/.test(firstBlocked)) {
            throw new Error(firstBlocked);
          }
          stopWhy = firstBlocked ?? 'the way down blocked: try another one';
          break;
        }

        const pick = valid[0];
        const nextX = currentPos.x + pick.dx;
        const nextZ = currentPos.z + pick.dz;

        const isTurn = (lastDx !== 0 || lastDz !== 0) && (pick.dx !== lastDx || pick.dz !== lastDz);
        const cellsToDig = [
          ...(isTurn ? [new Vec3(nextX, currentPos.y + 2, nextZ)] : []),
          new Vec3(nextX, currentPos.y + 1, nextZ),
          new Vec3(nextX, currentPos.y, nextZ),
          new Vec3(nextX, currentPos.y - 1, nextZ),
        ];

        for (const cp of cellsToDig) {
          checkAbort(signal);
          if (dugCellsCount >= maxDugCells || Date.now() - t0 >= maxWallMs) break;
          // (#93: a cluster in the way is mined too: its shards fall in the tunnel and are picked up on the way)
          const wasCluster = a.bot.blockAt(cp)?.name === 'amethyst_cluster';
          const dug = await digAmethystCell(a, cp, signal);
          if (dug) dugCellsCount++;
          if (dug && wasCluster) clustersMined++;
        }

        if (dugCellsCount >= maxDugCells) {
          stopWhy = `${maxDugCells} cells dug limit reached`;
          break;
        }
        if (Date.now() - t0 >= maxWallMs) {
          stopWhy = '5 minute time limit reached';
          break;
        }

        // Step down one
        const newFloorY = currentPos.y - 1;
        const newStand = new Vec3(nextX + 0.5, newFloorY, nextZ + 0.5);
        await walkToStep(a, newStand, signal);
        currentPos = new Vec3(nextX, newFloorY, nextZ);
        dugStairs.push(currentPos.clone());
        lastDx = pick.dx;
        lastDz = pick.dz;
      }

      // Phase 2: Once at target depth / beside it, dig straight through what lies between bot and target
      while (!hasLineOfSight(a, targetPos) && dugCellsCount < maxDugCells && Date.now() - t0 < maxWallMs) {
        checkAbort(signal);
        if (findReachableClusters(a).length > 0) break;

        const hDistToTarget = Math.hypot(targetPos.x - currentPos.x, targetPos.z - currentPos.z);
        if (hDistToTarget <= 0.8) break;

        const diffX = targetPos.x - currentPos.x;
        const diffZ = targetPos.z - currentPos.z;
        const primaryDir: [number, number] = Math.abs(diffX) >= Math.abs(diffZ)
          ? [Math.sign(diffX), 0]
          : [0, Math.sign(diffZ)];

        const altDir: [number, number] = primaryDir[0] !== 0
          ? [0, diffZ !== 0 ? Math.sign(diffZ) : 1]
          : [diffX !== 0 ? Math.sign(diffX) : 1, 0];

        let chosenDir: [number, number] | null = null;

        for (const dir of [primaryDir, altDir, [altDir[0], -altDir[1]] as [number, number]]) {
          const nextX = currentPos.x + dir[0];
          const nextZ = currentPos.z + dir[1];
          if (nextX < minX || nextX > maxX || nextZ < minZ || nextZ > maxZ) continue;

          const cellsAhead = [
            new Vec3(nextX, currentPos.y + 2, nextZ),
            new Vec3(nextX, currentPos.y + 1, nextZ),
            new Vec3(nextX, currentPos.y, nextZ),
          ];

          let safe = true;
          for (const cp of cellsAhead) {
            const why = unsafeAmethyst(a, cp);
            if (why) {
              safe = false;
              break;
            }
          }
          if (safe) {
            chosenDir = dir;
            break;
          }
        }

        if (!chosenDir) {
          stopWhy = 'way through shell blocked (try another one)';
          break;
        }

        const nextX = currentPos.x + chosenDir[0];
        const nextZ = currentPos.z + chosenDir[1];

        // Dig straight through what lies ahead (head and feet)
        for (const dy of [2, 1, 0]) {
          checkAbort(signal);
          if (dugCellsCount >= maxDugCells || Date.now() - t0 >= maxWallMs) break;
          const cp = new Vec3(nextX, currentPos.y + dy, nextZ);
          const wasCluster = a.bot.blockAt(cp)?.name === 'amethyst_cluster';
          const dug = await digAmethystCell(a, cp, signal);
          if (dug) dugCellsCount++;
          if (dug && wasCluster) clustersMined++;
        }

        if (dugCellsCount >= maxDugCells || Date.now() - t0 >= maxWallMs) break;

        // Step forward into the dug opening
        const newStand = new Vec3(nextX + 0.5, currentPos.y, nextZ + 0.5);
        await walkToStep(a, newStand, signal);
        currentPos = new Vec3(nextX, currentPos.y, nextZ);
        dugStairs.push(currentPos.clone());
      }

      // Phase 3: Mine amethyst clusters within 4 blocks (first the drops of any broken on the way, #93)
      if (clustersMined > 0) await pickUpShardDrops(a, signal, scale);
      let shardsAfter = await serverShardCount(a);
      let shardsGained = shardsAfter - shardsBefore;

      while (shardsGained < want && dugCellsCount < maxDugCells && Date.now() - t0 < maxWallMs) {
        checkAbort(signal);
        const clusters = findReachableClusters(a);
        if (clusters.length === 0) break;

        let minedAnyInPass = false;
        for (const clusterPos of clusters) {
          checkAbort(signal);
          if (shardsGained >= want || dugCellsCount >= maxDugCells || Date.now() - t0 >= maxWallMs) break;

          const clBlock = a.bot.blockAt(clusterPos);
          if (clBlock && clBlock.name === 'amethyst_cluster') {
            const dug = await digAmethystCell(a, clusterPos, signal);
            if (dug) {
              dugCellsCount++;
              clustersMined++;
              minedAnyInPass = true;
            }
            await pickUpShardDrops(a, signal, scale);
            shardsAfter = await serverShardCount(a);
            shardsGained = shardsAfter - shardsBefore;
          }
        }

        if (!minedAnyInPass) break;
      }

      shardsAfter = await serverShardCount(a);
      shardsGained = Math.max(0, shardsAfter - shardsBefore);

      const leftWithin4 = findReachableClusters(a).length;

      // Phase 4: Climb back up the staircase to the surface
      for (let i = dugStairs.length - 1; i >= 0; i--) {
        checkAbort(signal);
        const step = dugStairs[i];
        const targetStand = new Vec3(step.x + 0.5, step.y, step.z + 0.5);
        try {
          await walkToStep(a, targetStand, signal);
        } catch {
          /* continue climbing */
        }

        const bp = a.bot.entity.position;
        const dist = bp.distanceTo(targetStand);
        if (dist <= 0.85) {
          console.log(`[amethyst:climb] step ${i} (${step.x},${step.y},${step.z}) ok -> bot at ${at(bp)}`);
        } else {
          console.log(
            `[amethyst:climb] step ${i} (${step.x},${step.y},${step.z}) failed -> bot at ${at(bp)} ` +
              `(bot: ${cellsAt(a, bp.floored())}; step: ${cellsAt(a, step)})`,
          );
        }
      }

      if (bestSurfaceSpot) {
        try {
          await walkDry(
            a,
            new goals.GoalBlock(bestSurfaceSpot.x, bestSurfaceSpot.y, bestSurfaceSpot.z),
            'surface exit',
            signal,
            25000,
          );
        } catch {
          /* ignore */
        }
      }

      // Fallback (#96): when the climb ends more than 2 blocks below the surface (the highest solid block in the bot's
      // column), the bot digs its own stair up, one block a step, three cells high ahead, toward the surface spot
      let endPos = a.bot.entity.position.floored();
      const surfY = getColumnSurfaceY(a, endPos.x, endPos.z);
      let fallbackDug = 0;
      let climbedOwnStair = false;
      let stuckMsg: string | null = null;

      if (surfY !== null && surfY - endPos.y > 2) {
        const refSurfaceY = surfY;
        console.log(`[amethyst] climb ended at ${at(endPos)}, ${refSurfaceY - endPos.y} blocks below the surface (y ${refSurfaceY}): digging its own stair`);
        const tFallback0 = Date.now();
        const maxFallbackMs = Math.round(120_000 / scale);
        const exitSpot = bestSurfaceSpot ?? startStand;
        // (columns the bot dug itself: an opening into them is not the surface)
        const ownCols = new Set(dugStairs.map((s) => `${s.x},${s.z}`));
        const failedSteps = new Set<string>();
        let blocker: string | null = null;
        let lastTry = '';

        // At the surface: nothing solid over the bot's head, and its feet within a block of the ground it was under, or
        // level (+-1) with a neighbouring column it did not dig (an opening on lower ground, downhill)
        const atSurface = (p: Vec3): boolean => {
          const top = getColumnSurfaceY(a, p.x, p.z);
          if (top !== null && top >= p.y) return false;
          if (p.y >= refSurfaceY) return true;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (ownCols.has(`${p.x + dx},${p.z + dz}`)) continue;
            const t = getColumnSurfaceY(a, p.x + dx, p.z + dz);
            if (t !== null && t + 1 >= p.y - 1 && t + 1 <= p.y + 1) return true;
          }
          return false;
        };

        for (;;) {
          checkAbort(signal);
          const cur = a.bot.entity.position.floored();
          if (atSurface(cur)) {
            climbedOwnStair = true;
            break;
          }
          if (fallbackDug >= 32) {
            blocker = `after the 32-cell limit of its own stair${lastTry}`;
            break;
          }
          if (Date.now() - tFallback0 >= maxFallbackMs) {
            blocker = `after the 2-minute limit of its own stair${lastTry}`;
            break;
          }

          const sx = Math.sign(exitSpot.x - cur.x);
          const sz = Math.sign(exitSpot.z - cur.z);
          const pref: Array<[number, number]> = Math.abs(exitSpot.x - cur.x) >= Math.abs(exitSpot.z - cur.z)
            ? [[sx, 0], [0, sz], [0, -sz], [-sx, 0]]
            : [[0, sz], [sx, 0], [-sx, 0], [0, -sz]];
          const dirs: Array<[number, number]> = [];
          for (const d of [...pref, [1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
            if ((d[0] === 0) === (d[1] === 0)) continue;
            if (!dirs.some((c) => c[0] === d[0] && c[1] === d[1])) dirs.push(d);
          }

          let chosen: Vec3[] | null = null;
          let chosenStand: Vec3 | null = null;
          let chosenKey = '';
          let firstWhy: string | null = null;
          for (const [dx, dz] of dirs) {
            const nx = cur.x + dx;
            const nz = cur.z + dz;
            const key = `${cur.x},${cur.y},${cur.z}:${dx},${dz}`;
            if (failedSteps.has(key)) {
              firstWhy ??= `the step to ${nx},${cur.y + 1},${nz} did not raise it (${cellsAt(a, new Vec3(nx, cur.y + 1, nz))})`;
              continue;
            }
            const floor = new Vec3(nx, cur.y, nz);
            const fb = a.bot.blockAt(floor);
            if (!fb || fb.boundingBox !== 'block') {
              firstWhy ??= `with no floor for the next step (${fb?.name ?? 'unloaded'} at ${at(floor)})`;
              continue;
            }
            // (its own head+1, for the jump, then the step's feet, head and head+1)
            const cells = [
              new Vec3(cur.x, cur.y + 2, cur.z),
              new Vec3(nx, cur.y + 1, nz),
              new Vec3(nx, cur.y + 2, nz),
              new Vec3(nx, cur.y + 3, nz),
            ];
            let why: string | null = null;
            for (const cp of cells) {
              why = unsafeAmethyst(a, cp);
              if (why) break;
            }
            if (why) {
              const m = /^(\S+) (over|beside)/.exec(why);
              const head = m ? (m[2] === 'over' ? `under ${m[1]}` : `beside ${m[1]}`) : 'blocked';
              firstWhy ??= `${head} (${why.replace(/: the tunnel stops there \(try another one\)$/, '')})`;
              continue;
            }
            chosen = cells;
            chosenStand = new Vec3(nx + 0.5, cur.y + 1, nz + 0.5);
            chosenKey = key;
            break;
          }

          if (!chosen || !chosenStand) {
            blocker = firstWhy ?? 'with every way up blocked';
            break;
          }

          for (const cp of chosen) {
            checkAbort(signal);
            if (fallbackDug >= 32) break;
            if (await digAmethystCell(a, cp, signal)) {
              fallbackDug++;
              dugCellsCount++;
            }
          }
          if (fallbackDug >= 32 && chosen.some((cp) => a.bot.blockAt(cp)?.boundingBox === 'block')) continue;

          await walkToStep(a, chosenStand, signal);
          const after = a.bot.entity.position.floored();
          ownCols.add(`${chosenStand.x - 0.5},${chosenStand.z - 0.5}`);
          lastTry = ` (last step to ${at(chosenStand.floored())}: ${cellsAt(a, chosenStand.floored())})`;
          console.log(`[amethyst:stair] step to ${at(chosenStand.floored())} -> bot at ${at(after)} (${fallbackDug} cells)`);
          if (after.y <= cur.y) failedSteps.add(chosenKey);
        }

        endPos = a.bot.entity.position.floored();
        if (climbedOwnStair) {
          console.log(`[amethyst] climbed out by its own stair (${fallbackDug} cells) to ${at(endPos)}`);
        } else {
          stuckMsg =
            `stuck at ${endPos.x},${endPos.y},${endPos.z} ${blocker}, ${refSurfaceY + 1 - endPos.y} blocks below the surface ` +
            `(dug ${fallbackDug} cells of its own stair): dig a way up from here before the next job`;
          console.log(`[amethyst] own stair failed: ${stuckMsg}`);
        }
      }

      // (#93: counted again once out: drops lying in the tunnel are picked up on the climb, after the count above)
      shardsAfter = await serverShardCount(a);
      shardsGained = Math.max(0, shardsAfter - shardsBefore);

      endPos = a.bot.entity.position.floored();
      const backCoord = `${endPos.x},${endPos.y},${endPos.z}`;
      const targetCoord = `${targetPos.x},${targetPos.y},${targetPos.z}`;

      if (shardsGained === 0) {
        if (!getPickaxe(a)) {
          throw new Error('the pickaxe broke: withdraw another');
        }
        if (clustersMined === 0 && leftWithin4 === 0) {
          throw new Error(`no amethyst cluster found within ${radius} blocks of ${targetCoord}: explore to find a geode`);
        }
        throw new Error(`the way down blocked (${stopWhy}): try another one${stuckMsg ? `; then ${stuckMsg}` : ''}`);
      }

      if (shardsGained >= want) {
        stopWhy = `reached target of ${want} amethyst shard`;
      }

      const stairMsg = climbedOwnStair
        ? `; climbed out by its own stair (${fallbackDug} cells)`
        : stuckMsg
          ? `; ${stuckMsg}`
          : '';
      return `got ${shardsGained} amethyst shard from ${clustersMined} amethyst clusters at ${targetCoord} (${leftWithin4} left within 4 blocks; dug ${dugCellsCount} cells; back at ${backCoord}${stairMsg}): ${stopWhy}`;
    },
  },

  tool: {
    name: 'harvest_amethyst',
    description: 'Dig down to underground amethyst geodes and mine amethyst clusters for amethyst shards using a pickaxe, avoiding budding amethyst.',
    input_schema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of amethyst shards to gather (1-16, default 4).' },
        x: { type: 'number', description: 'Optional amethyst cluster X coordinate to dig to.' },
        y: { type: 'number', description: 'Optional amethyst cluster Y coordinate to dig to.' },
        z: { type: 'number', description: 'Optional amethyst cluster Z coordinate to dig to.' },
        radius: { type: 'number', description: 'Max distance to search for amethyst clusters when x, y, z are not given (1-64, default 32).' },
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
          return { why: NO_CLUSTER_MSG };
        }

        if (vName) {
          const hit = placeCache.get(vName);
          if (hit && now - hit.at < PLACE_CACHE_MS && hit.hx === hut.x && hit.hz === hut.z) {
            if ('why' in hit.place) {
              lastPlaceTarget.delete(vName);
              return hit.place;
            }
            const px = Number(hit.place.x), py = Number(hit.place.y), pz = Number(hit.place.z);
            const b = a.bot.blockAt(new Vec3(px, py, pz));
            if (b && b.name === 'amethyst_cluster') {
              lastPlaceTarget.set(vName, { x: px, y: py, z: pz });
              return hit.place;
            }
          }
        }

        let listEntry = vName ? clusterListCache.get(vName) : undefined;
        if (!listEntry || now - listEntry.at >= LIST_REFRESH_MS || listEntry.hx !== hut.x || listEntry.hz !== hut.z) {
          const clusterId = a.world?.registry?.blocksByName?.amethyst_cluster?.id;
          const pos = a.bot.entity?.position;
          const canSearch = clusterId !== undefined && pos && typeof pos.floored === 'function';
          const found = canSearch
            ? nearestBlocks(a, [clusterId], HUT_RADIUS, HUT_MAX_CLUSTERS, (p) => {
                if (Math.hypot(p.x - hut.x, p.z - hut.z) > HUT_RADIUS) return false;
                if (withinVillageGroundXZ(a, p.x, p.z, 8)) return false;
                return true;
              })
            : [];
          found.sort((u, v) => Math.hypot(u.x - hut.x, u.z - hut.z) - Math.hypot(v.x - hut.x, v.z - hut.z));
          listEntry = { at: now, hx: hut.x, hz: hut.z, clusters: found.slice(0, HUT_MAX_CLUSTERS) };
          if (vName) clusterListCache.set(vName, listEntry);
        }

        let chosen: Vec3 | null = null;
        for (const p of listEntry.clusters) {
          if (withinVillageGroundXZ(a, p.x, p.z, 8)) continue;
          const b = a.bot.blockAt(p);
          if (b && b.name === 'amethyst_cluster') {
            chosen = p;
            break;
          }
        }

        const ans: FoundryPlace = chosen
          ? { x: chosen.x, y: chosen.y, z: chosen.z }
          : { why: NO_CLUSTER_MSG };

        if (vName) {
          placeCache.set(vName, { at: now, hx: hut.x, hz: hut.z, place: ans });
          if (chosen) lastPlaceTarget.set(vName, { x: chosen.x, y: chosen.y, z: chosen.z });
          else lastPlaceTarget.delete(vName);
        }
        return ans;
      } catch {
        return { why: NO_CLUSTER_MSG };
      }
    },

    holds(v): string[] {
      try {
        const p = v?.name ? lastPlaceTarget.get(v.name) : undefined;
        if (!p) return [];
        const gx = Math.floor(p.x / 16) * 16;
        const gy = Math.floor(p.y / 16) * 16;
        const gz = Math.floor(p.z / 16) * 16;
        return [`amethyst:${gx},${gy},${gz}`];
      } catch {
        return [];
      }
    },
  },
};
