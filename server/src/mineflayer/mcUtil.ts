/**
 * Helpers shared by the Minecraft skills: argument checks, cancellable waits, walking with a watchdog, and inventory
 * and block lookups.
 */
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { Block } from 'prismarine-block';
import type { BotAgent } from './botAgent';

const { goals } = pathfinderPkg;
export { goals };

export const num = (v: unknown, name: string): number => {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
};
export const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required`);
  return v.trim();
};
export const at = (v: { x: number; y: number; z: number }) => `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`;

export function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((ok, fail) => {
    if (signal.aborted) return fail(new Error('cancelled'));
    const t = setTimeout(ok, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      fail(new Error('cancelled'));
    }, { once: true });
  });
}

export function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new Error('cancelled');
}

/** Wait for a promise, but give up (running onAbort) when the skill is cancelled. */
export function abortable<T>(p: Promise<T>, signal: AbortSignal, onAbort: () => void = () => {}): Promise<T> {
  return new Promise<T>((ok, fail) => {
    if (signal.aborted) return fail(new Error('cancelled'));
    const abort = () => {
      onAbort();
      fail(new Error('cancelled'));
    };
    signal.addEventListener('abort', abort, { once: true });
    p.then(ok, fail).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Pathfinder errors, reworded to say what to do next. */
function pathError(e: Error, target: string): Error {
  const m = e.message;
  if (/no path/i.test(m)) return new Error(`no path to ${target} from here (blocked by terrain, water or buildings); try a nearer point or explore first`);
  if (/took to long|too long/i.test(m)) return new Error(`path search to ${target} took too long; try a nearer point`);
  if (/goal was changed|stopped before/i.test(m)) return new Error('cancelled');
  return new Error(`could not reach ${target}: ${m}`);
}

/**
 * Walk to a goal with the pathfinder, giving up when the bot stops making progress, the time runs out or the skill is
 * cancelled (the pathfinder alone can keep retrying the same blocked move forever). With no path at all it tries once
 * more allowing longer drops: a bot that climbed a tree for logs can stand on leaves 5 blocks up with no way down
 * within the usual 4-block drop.
 */
export async function walk(a: BotAgent, goal: InstanceType<typeof goals.Goal>, target: string, signal: AbortSignal, timeoutMs = 60000) {
  const moves = a.moves();
  try {
    await walkOnce(a, goal, target, signal, timeoutMs);
  } catch (e) {
    if (!/^no path/.test((e as Error).message)) throw e;
    const drop = moves.maxDropDown;
    moves.maxDropDown = 8;
    try {
      await walkOnce(a, goal, target, signal, timeoutMs);
    } finally {
      moves.maxDropDown = drop;
    }
  }
}

async function walkOnce(a: BotAgent, goal: InstanceType<typeof goals.Goal>, target: string, signal: AbortSignal, timeoutMs: number) {
  const bot = a.bot;
  bot.pathfinder.setMovements(a.moves());
  let settled = false;
  let last = bot.entity.position.clone();
  let lastMove = Date.now();
  const t0 = Date.now();
  await new Promise<void>((ok, fail) => {
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      signal.removeEventListener('abort', onAbort);
      if (err) {
        bot.pathfinder.stop();
        fail(err);
      } else ok();
    };
    const onAbort = () => done(new Error('cancelled'));
    const watch = setInterval(() => {
      const p = bot.entity.position;
      if (p.distanceTo(last) > 0.5) {
        last = p.clone();
        lastMove = Date.now();
      }
      // Digging or placing a block on the way can hold the bot still for a while
      const busy = bot.pathfinder.isMining() || bot.pathfinder.isBuilding();
      if (!busy && Date.now() - lastMove > 10000) done(new Error(`stuck at ${at(p)} on the way to ${target}; try a different route or a nearer point`));
      else if (Date.now() - t0 > timeoutMs) done(new Error(`timed out at ${at(p)} on the way to ${target}`));
    }, 500);
    signal.addEventListener('abort', onAbort, { once: true });
    bot.pathfinder.goto(goal).then(() => done(), (e: Error) => done(pathError(e, target)));
  });
}

/** Walk until within `range` blocks of pos (does nothing if already there). */
export async function reach(a: BotAgent, pos: Vec3, range: number, signal: AbortSignal, timeoutMs = 60000) {
  if (a.bot.entity.position.distanceTo(pos) <= range) return;
  await walk(a, new goals.GoalNear(pos.x, pos.y, pos.z, range), at(pos), signal, timeoutMs);
}

/**
 * The nearest y in the column at x, z where a player can stand (solid below, two free blocks), searching up and down
 * from y; null if the column is not loaded or has no such spot nearby. Models often guess y from the wrong place.
 */
export function standableY(a: BotAgent, x: number, y: number, z: number): number | null {
  const v = new Vec3(x, 0, z);
  const box = (yy: number) => a.bot.blockAt(v.set(x, yy, z))?.boundingBox;
  for (let d = 0; d <= 24; d++)
    for (const yy of d ? [y - d, y + d] : [y]) {
      const below = box(yy - 1);
      if (below === undefined) return null;
      if (below === 'block' && box(yy) === 'empty' && box(yy + 1) === 'empty') return yy;
    }
  return null;
}

/** How many of an item (by id) the bot carries. */
export function countItem(a: BotAgent, id: number): number {
  return a.bot.inventory.items().reduce((s, it) => s + (it.type === id ? it.count : 0), 0);
}

export function itemId(a: BotAgent, name: string): number | undefined {
  return a.world.registry.itemsByName[name]?.id;
}

export function itemName(a: BotAgent, id: number): string {
  return a.world.registry.items[id]?.name ?? `item ${id}`;
}

/** An item name as models write it ("sticks", "Oak Planks", "wooden pickaxe") mapped to a real id, or null. */
export function resolveItem(a: BotAgent, raw: string): string | null {
  const reg = a.world.registry.itemsByName;
  const n = raw.trim().toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_');
  for (const c of [n, n.replace(/s$/, ''), n.replace(/es$/, ''), `${n}s`]) if (reg[c]) return c;
  return null;
}

/** A block the bot can stand next to and see: the first of `blocks` (nearest first) not in `skip`. */
export function nearestBlocks(a: BotAgent, ids: number[], maxDistance: number, count = 64): Vec3[] {
  const p = a.bot.entity.position;
  return a.bot.findBlocks({ matching: ids, maxDistance, count }).sort((u, v) => u.distanceTo(p) - v.distanceTo(p));
}

/** A free spot next to the bot to put a block down (air with air above and solid ground below, not where it stands). */
export function freeSpotNearby(a: BotAgent): { ground: Block; pos: Vec3 } | null {
  const bot = a.bot;
  const base = bot.entity.position.floored();
  const tries: Vec3[] = [];
  for (let r = 1; r <= 3; r++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) for (const dy of [0, -1, 1]) tries.push(base.offset(dx, dy, dz));
  for (const pos of tries) {
    if (pos.x === base.x && pos.z === base.z) continue;
    const ground = bot.blockAt(pos.offset(0, -1, 0));
    const here = bot.blockAt(pos), above = bot.blockAt(pos.offset(0, 1, 0));
    if (ground?.boundingBox === 'block' && here?.boundingBox === 'empty' && here.name !== 'water' && here.name !== 'lava' && above?.boundingBox === 'empty') return { ground, pos };
  }
  return null;
}
