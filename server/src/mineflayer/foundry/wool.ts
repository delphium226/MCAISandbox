/**
 * Foundry skill `shear_sheep_at`: walk to a given place without digging or placing blocks and run the existing
 * `shear_sheep` skill there. Includes the activity adapter that picks the best recent sheep sighting cluster within
 * 144 blocks of the village's storage hut from the shared atlas.
 */
import { Vec3 } from 'vec3';
import type { BotAgent } from '../botAgent';
import { ANIMAL_SKILLS } from '../mcAnimals';
import type { FoundryPlaceCtx, FoundrySkill } from './types';
import { at, checkAbort, countItem, goals, itemId, num, syncInventory, walk } from '../mcUtil';

type FoundryPlace = Record<string, unknown> | { why: string };

const NO_PLACE_ARG_MSG = 'no place given';
const NO_SHEARS_MSG = 'no shears: withdraw one from storage';
const NO_HUT_MSG = 'no storage hut';
const NO_SHEEP_PLACE_MSG = 'no sheep seen within 144 blocks of the storage hut (explore to find some)';

const WALK_RANGE = 4;
const WALK_TIMEOUT_MS = 90_000;
const HUT_RADIUS = 144;
const RECENT_MS = 30 * 60_000;
const CLUSTER_RADIUS = 16;
const PLACE_CACHE_MS = 60_000;

interface CachedPlace {
  at: number;
  hx: number;
  hz: number;
  size: number;
  place: FoundryPlace;
}

const placeCache = new Map<string, CachedPlace>();

/** Guard against stubs or partial positions (lesson 104). */
function validPos(p: unknown): p is Vec3 {
  return !!p
    && typeof (p as Vec3).x === 'number' && Number.isFinite((p as Vec3).x)
    && typeof (p as Vec3).y === 'number' && Number.isFinite((p as Vec3).y)
    && typeof (p as Vec3).z === 'number' && Number.isFinite((p as Vec3).z);
}

/** Parse and validate `x`, `y`, `z` from `args`, failing with `'no place given'` when missing or non-numeric. */
function parsePlace(args: unknown): { x: number; y: number; z: number } {
  if (!args || typeof args !== 'object') throw new Error(NO_PLACE_ARG_MSG);
  const q = args as Record<string, unknown>;
  const coord = (v: unknown): number => {
    if (v === undefined || v === null || v === '' || typeof v === 'boolean') {
      throw new Error(NO_PLACE_ARG_MSG);
    }
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(NO_PLACE_ARG_MSG);
    return Math.floor(n);
  };
  return { x: coord(q.x), y: coord(q.y), z: coord(q.z) };
}

/** Check on the server (or local inventory if RCON is unavailable) whether the agent has at least one shears. */
async function hasShears(a: BotAgent): Promise<boolean> {
  const id = itemId(a, 'shears');
  const srv = await a?.world?.rcon?.count?.(a.name, 'minecraft:shears')?.catch?.(() => -1) ?? -1;
  if (srv === 0) return false;
  if (srv > 0) {
    if (id !== undefined && countItem(a, id) === 0 && a.bot?.heldItem?.type !== id) {
      await syncInventory(a).catch(() => {});
    }
    return true;
  }
  if (id === undefined) return false;
  if (countItem(a, id) > 0 || a.bot?.heldItem?.type === id) return true;
  await syncInventory(a).catch(() => {});
  return countItem(a, id) > 0 || a.bot?.heldItem?.type === id;
}

/** Count wool on the server (`clear <name> #minecraft:wool 0`), falling back to `fallback` if RCON is unavailable. */
async function serverWoolCount(a: BotAgent, fallback = 0): Promise<number> {
  const n = await a?.world?.rcon?.count?.(a.name, '#minecraft:wool')?.catch?.(() => -1) ?? -1;
  return typeof n === 'number' && n >= 0 ? n : fallback;
}

/** Walk within `WALK_RANGE` blocks of `(x, y, z)` without digging or placing any block, giving up after 90 s. */
async function walkToPlace(a: BotAgent, x: number, y: number, z: number, signal: AbortSignal): Promise<void> {
  const pos = a.bot?.entity?.position;
  if (!validPos(pos)) throw new Error('bot is not spawned in the world yet');
  const targetVec = new Vec3(x, y, z);
  if (pos.distanceTo(targetVec) <= WALK_RANGE) return;

  const mv = typeof a.moves === 'function' ? a.moves() : undefined;
  const saved = mv
    ? { canDig: mv.canDig, scafoldingBlocks: mv.scafoldingBlocks, allow1by1towers: mv.allow1by1towers }
    : undefined;
  if (mv) {
    mv.canDig = false;
    mv.scafoldingBlocks = [];
    mv.allow1by1towers = false;
  }
  const label = `${x},${y},${z}`;
  try {
    await walk(a, new goals.GoalNear(x, y, z, WALK_RANGE), label, signal, WALK_TIMEOUT_MS, { scaffold: false });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (msg === 'cancelled' || signal.aborted) throw e;
    const gotTo = validPos(a.bot?.entity?.position) ? at(a.bot.entity.position) : 'unknown';
    throw new Error(msg.includes(gotTo) ? msg : `could not reach ${label} (got to ${gotTo}): ${msg}`);
  } finally {
    if (mv && saved) Object.assign(mv, saved);
  }
}

export const FOUNDRY: FoundrySkill = {
  name: 'shear_sheep_at',
  skill: {
    check: (args) => {
      parsePlace(args);
      if (args.count !== undefined && args.count !== null) num(args.count, 'count');
      if (args.radius !== undefined && args.radius !== null) num(args.radius, 'radius');
    },

    async run(a, args, signal) {
      checkAbort(signal);
      const { x, y, z } = parsePlace(args);

      const rawCount = args?.count !== undefined && args?.count !== null ? num(args.count, 'count') : 3;
      const count = Math.max(1, Math.min(12, Math.floor(rawCount)));
      const rawRadius = args?.radius !== undefined && args?.radius !== null ? num(args.radius, 'radius') : 16;
      const radius = Math.max(1, Math.min(32, Math.floor(rawRadius)));

      if (!(await hasShears(a))) {
        throw new Error(NO_SHEARS_MSG);
      }

      const woolBefore = await serverWoolCount(a, 0);

      await walkToPlace(a, x, y, z, signal);

      const msg = await ANIMAL_SKILLS.shear_sheep.run(a, { count, radius }, signal);
      const woolAfter = await serverWoolCount(a, woolBefore);
      const gained = Math.max(0, woolAfter - woolBefore);
      const text = typeof msg === 'string' && msg ? msg : `sheared ${gained} wool`;
      return `at ${x},${y},${z}: ${text} (+${gained} wool)`;
    },
  },

  tool: {
    name: 'shear_sheep_at',
    description: 'Walk to a given (x, y, z) place without digging or placing blocks and shear nearby adult sheep for wool using shears from inventory.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate of the place to shear sheep at.' },
        y: { type: 'number', description: 'Y coordinate of the place to shear sheep at.' },
        z: { type: 'number', description: 'Z coordinate of the place to shear sheep at.' },
        count: { type: 'number', description: 'Amount of wool wanted (1-12, default 3).' },
        radius: { type: 'number', description: 'Max distance around the place to search for sheep (1-32, default 16).' },
      },
      required: ['x', 'y', 'z'],
    },
  },

  activity: {
    place(ctx: FoundryPlaceCtx): FoundryPlace {
      try {
        if (!ctx || !ctx.hut) return { why: NO_HUT_MSG };
        const hut = ctx.hut;
        if (!Number.isFinite(hut.x) || !Number.isFinite(hut.y) || !Number.isFinite(hut.z)) {
          return { why: NO_HUT_MSG };
        }

        const vName = ctx.village?.name ?? '';
        const now = Date.now();
        const animals = ctx.agent?.world?.atlas?.animals;
        const mapSize = animals && typeof animals.size === 'number' ? animals.size : 0;

        if (vName) {
          const hit = placeCache.get(vName);
          if (hit && now - hit.at < PLACE_CACHE_MS && hit.hx === hut.x && hit.hz === hut.z && hit.size === mapSize) {
            return hit.place;
          }
        }

        if (!animals || typeof animals.values !== 'function') {
          const none: FoundryPlace = { why: NO_SHEEP_PLACE_MSG };
          if (vName) placeCache.set(vName, { at: now, hx: hut.x, hz: hut.z, size: mapSize, place: none });
          return none;
        }

        const sheep: Array<{ x: number; y: number; z: number; distHut: number }> = [];
        for (const s of animals.values()) {
          if (!s || s.kind !== 'sheep') continue;
          if (
            typeof s.x !== 'number' || !Number.isFinite(s.x)
            || typeof s.y !== 'number' || !Number.isFinite(s.y)
            || typeof s.z !== 'number' || !Number.isFinite(s.z)
            || typeof s.t !== 'number' || !Number.isFinite(s.t)
          ) {
            continue;
          }
          if (now - s.t > RECENT_MS) continue;
          const distHut = Math.hypot(s.x - hut.x, s.z - hut.z);
          if (distHut > HUT_RADIUS) continue;
          sheep.push({ x: Math.floor(s.x), y: Math.floor(s.y), z: Math.floor(s.z), distHut });
        }

        let best: { x: number; y: number; z: number; count: number; distHut: number } | null = null;
        for (const cand of sheep) {
          let count = 0;
          for (const other of sheep) {
            if (Math.hypot(other.x - cand.x, other.z - cand.z) <= CLUSTER_RADIUS) {
              count++;
            }
          }
          if (
            !best
            || count > best.count
            || (count === best.count && cand.distHut < best.distHut)
          ) {
            best = { x: cand.x, y: cand.y, z: cand.z, count, distHut: cand.distHut };
          }
        }

        const ans: FoundryPlace = best
          ? { x: best.x, y: best.y, z: best.z }
          : { why: NO_SHEEP_PLACE_MSG };

        if (vName) {
          placeCache.set(vName, { at: now, hx: hut.x, hz: hut.z, size: mapSize, place: ans });
        }
        return ans;
      } catch {
        return { why: NO_SHEEP_PLACE_MSG };
      }
    },
  },
};
