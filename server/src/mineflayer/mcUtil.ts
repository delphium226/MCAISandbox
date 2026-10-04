/**
 * Helpers shared by the Minecraft skills: argument checks, cancellable waits, walking with a watchdog, and inventory
 * and block lookups.
 */
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { Block } from 'prismarine-block';
import type { BotAgent } from './botAgent';
import type { Column } from './mcAtlas';
import { overlaps } from '../village';

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
export async function walk(a: BotAgent, goal: InstanceType<typeof goals.Goal>, target: string, signal: AbortSignal, timeoutMs = 60000, opts: { scaffold?: boolean } = {}) {
  const moves = a.moves();
  // Without scaffolding (a builder going to its stand spot: Minevale19's built a dirt tower to reach a roof)
  if (opts.scaffold === false) {
    const blocks = moves.scafoldingBlocks;
    moves.scafoldingBlocks = [];
    try {
      return await walk(a, goal, target, signal, timeoutMs);
    } finally {
      moves.scafoldingBlocks = blocks;
    }
  }
  // Far away: go in legs of ~40 blocks toward it (a single path search over 150 blocks found "no path" home), trying
  // a little to either side when a leg is blocked
  const g = goal as unknown as { x?: number; z?: number };
  if (typeof g.x === 'number' && typeof g.z === 'number') {
    for (let leg = 0; leg < 16; leg++) {
      const p = a.bot.entity.position;
      const dx = g.x - p.x, dz = g.z - p.z;
      if (Math.hypot(dx, dz) <= 64) break;
      let moved = false;
      for (const turn of [0, 0.5, -0.5, 1, -1]) {
        const ang = Math.atan2(dz, dx) + turn;
        const nx = Math.round(p.x + Math.cos(ang) * 40), nz = Math.round(p.z + Math.sin(ang) * 40);
        try {
          await walkOnce(a, new goals.GoalNearXZ(nx, nz, 4), `${nx},${nz} on the way to ${target}`, signal, 45000);
          moved = true;
          break;
        } catch (e) {
          if ((e as Error).message === 'cancelled') throw e;
        }
      }
      if (!moved) break;
    }
  }
  try {
    await walkOnce(a, goal, target, signal, timeoutMs);
  } catch (e) {
    // Stuck in water (the pathfinder swims badly): swim up and toward the goal for a few seconds, then try again
    if (/^stuck/.test((e as Error).message) && (a.bot.entity as unknown as { isInWater?: boolean }).isInWater) {
      await swimOut(a, g, signal);
      return walkOnce(a, goal, target, signal, timeoutMs);
    }
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

/** Swim toward a point (or just up and forward) for up to 6 seconds, until out of the water. */
async function swimOut(a: BotAgent, toward: { x?: number; z?: number }, signal: AbortSignal) {
  const bot = a.bot;
  const p = bot.entity.position;
  if (typeof toward.x === 'number' && typeof toward.z === 'number') await bot.lookAt(new Vec3(toward.x, p.y + 1, toward.z)).catch(() => {});
  bot.pathfinder.stop();
  bot.setControlState('jump', true);
  bot.setControlState('forward', true);
  try {
    for (let i = 0; i < 30 && (bot.entity as unknown as { isInWater?: boolean }).isInWater; i++) await sleep(200, signal);
    await sleep(600, signal);
  } finally {
    bot.setControlState('jump', false);
    bot.setControlState('forward', false);
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
    // (the goal's test takes a path node; a position has what it reads)
    const arrived = () => [bot.entity.position.floored(), bot.entity.position].some((p) => goal.isEnd(p as unknown as Parameters<typeof goal.isEnd>[0]));
    // Resolving is not arriving: boxed in by built walls, goto returned at once and move_to said "arrived" where the bot
    // stood (a trapped bot told it had succeeded never gets rescued)
    bot.pathfinder.goto(goal).then(
      () => done(arrived() ? undefined
        : new Error(`no path to ${target} from here (stopped at ${at(bot.entity.position)}; blocked by terrain, water or buildings); try a nearer point or explore first`)),
      (e: Error) => done(pathError(e, target)),
    );
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
export function standableY(a: BotAgent, x: number, y: number, z: number, range = 24): number | null {
  const v = new Vec3(x, 0, z);
  const box = (yy: number) => a.bot.blockAt(v.set(x, yy, z))?.boundingBox;
  for (let d = 0; d <= range; d++)
    for (const yy of d ? [y - d, y + d] : [y]) {
      const below = box(yy - 1);
      if (below === undefined) return null;
      // (not in water: an empty box is also water's)
      if (below === 'block' && box(yy) === 'empty' && box(yy + 1) === 'empty' && !/water|lava/.test(a.bot.blockAt(v.set(x, yy, z))?.name ?? '')) return yy;
    }
  return null;
}

/**
 * Have the server resend the whole inventory. Mineflayer's own view drifts after crafts and chest transfers (it has
 * counted 3 new planks for 8, and acacia logs for an oak one), and recipes are then planned on items that are not
 * there. A no-op click with an impossible state id always gets the full inventory back (Mineflayer's _syncWindow).
 */
export async function syncInventory(a: BotAgent): Promise<void> {
  const sync = (a.bot as unknown as { _syncWindow?: (w: unknown) => Promise<void> })._syncWindow;
  if (!sync) return;
  await Promise.race([sync(a.bot.inventory).catch(() => undefined), new Promise((ok) => setTimeout(ok, 2000))]);
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

/** Per-state lookups for the fast block reads (one per registry): see-through and not liquid, wet (water or lava). */
const tablesOf = new WeakMap<object, { open: Uint8Array; wet: Uint8Array; match: Map<string, Uint8Array> }>();
function tables(a: BotAgent) {
  const reg = a.world.registry;
  let t = tablesOf.get(reg);
  if (!t) {
    const n = reg.blocksArray.reduce((m, b) => Math.max(m, b.maxStateId + 1), 0);
    t = { open: new Uint8Array(n), wet: new Uint8Array(n), match: new Map() };
    for (const b of reg.blocksArray) {
      const open = b.boundingBox === 'empty' && b.name !== 'water' && b.name !== 'lava' ? 1 : 0, wet = /water|lava/.test(b.name) ? 1 : 0;
      for (let s = b.minStateId; s <= b.maxStateId; s++) {
        t.open[s] = open;
        t.wet[s] = wet;
      }
    }
    tablesOf.set(reg, t);
  }
  return t;
}

const cellQ = { x: 0, y: 0, z: 0 };
// The agent whose scan is running (synchronous, so one at a time) and the column stateAt read last
let scanning: BotAgent | null = null, lastCx = 0, lastCz = 0, lastCol: Column | null = null;
/** The state id at a block in the bot's view, or -1 where its chunk is not loaded (no Block object: F106). */
export function stateAt(a: BotAgent, x: number, y: number, z: number): number {
  const cx = x >> 4, cz = z >> 4;
  let col: Column | null;
  // During a scan the last column is reused (getColumn builds a string key each time; filters read thousands of cells)
  if (scanning === a && cx === lastCx && cz === lastCz) col = lastCol;
  else {
    col = a.bot.world.getColumn(cx, cz) as unknown as Column | null;
    if (scanning === a) {
      lastCx = cx;
      lastCz = cz;
      lastCol = col;
    }
  }
  if (!col) return -1;
  const minY = col.minY ?? ((a.bot.game as { minY?: number }).minY ?? -64);
  if (y < minY || y >= minY + col.sections.length * 16) return 0;
  cellQ.x = x & 15;
  cellQ.y = y;
  cellQ.z = z & 15;
  return col.getBlockStateId(cellQ);
}

/** Whether a block touches air or another see-through block that is not liquid (can be seen and reached without digging). */
export function exposedAt(a: BotAgent, x: number, y: number, z: number): boolean {
  const { open } = tables(a);
  const o = (s: number) => s >= 0 && open[s] === 1;
  return o(stateAt(a, x, y - 1, z)) || o(stateAt(a, x, y + 1, z)) || o(stateAt(a, x - 1, y, z)) || o(stateAt(a, x + 1, y, z)) || o(stateAt(a, x, y, z - 1)) || o(stateAt(a, x, y, z + 1));
}

/** Whether there is water or lava on top of a block. */
export function wetAbove(a: BotAgent, p: Vec3): boolean {
  const s = stateAt(a, p.x, p.y + 1, p.z);
  return s >= 0 && tables(a).wet[s] === 1;
}

/**
 * Up to `count` blocks of `ids` within `maxDistance` of the bot (from its floored position, as findBlocks measures),
 * nearest first, that pass `keep`, with y in `ys` when given. Reads state ids straight from the loaded sections (F106):
 * mineflayer's findBlocks built a Block for every cell of each section that might hold the block, and a section filled
 * with one state (all air, all stone) has no palette, so it scanned the whole sky; 2-2.4 s for logs in a desert, up to
 * 5.4 s for stone. Sections whose palette or single state holds none of the blocks are passed over; `keep` runs on
 * matches only. Columns go nearest first and the search stops once `count` are found closer than any column left.
 */
function scanBlocks(a: BotAgent, ids: number[], maxDistance: number, count: number, keep?: (p: Vec3) => boolean, ys?: { min?: number; max?: number }): Vec3[] {
  const t = tables(a);
  const key = ids.join(',');
  let match = t.match.get(key);
  if (!match) {
    match = new Uint8Array(t.open.length);
    for (const id of ids) {
      const b = a.world.registry.blocks[id];
      if (b) for (let s = b.minStateId; s <= b.maxStateId; s++) match[s] = 1;
    }
    t.match.set(key, match);
  }
  const m = match;
  const pt = a.bot.entity.position.floored();
  const R = maxDistance;
  const y1 = Math.max(pt.y - R, ys?.min ?? -Infinity), y2 = Math.min(pt.y + R, ys?.max ?? Infinity);
  if (y1 > y2) return [];
  // Columns within reach, by the nearest any of their blocks can be (horizontally)
  const cols: Array<{ cx: number; cz: number; d: number }> = [];
  const cr = Math.ceil(R / 16) + 1, pcx = pt.x >> 4, pcz = pt.z >> 4;
  for (let cx = pcx - cr; cx <= pcx + cr; cx++) {
    for (let cz = pcz - cr; cz <= pcz + cr; cz++) {
      const dx = Math.max(cx * 16 - pt.x, 0, pt.x - (cx * 16 + 15)), dz = Math.max(cz * 16 - pt.z, 0, pt.z - (cz * 16 + 15));
      const d = Math.hypot(dx, dz);
      if (d <= R) cols.push({ cx, cz, d });
    }
  }
  cols.sort((u, v) => u.d - v.d);
  let out: Array<{ p: Vec3; d: number }> = [];
  const byD = (u: { d: number }, v: { d: number }) => u.d - v.d;
  for (const c of cols) {
    if (out.length >= count) {
      // Keep the nearest `count`; stop when the farthest of them is nearer than anything in this column
      out.sort(byD);
      out.length = count;
      if (out[count - 1].d <= c.d) break;
    }
    const col = a.bot.world.getColumn(c.cx, c.cz) as unknown as Column | null;
    if (!col) continue;
    const minY = col.minY ?? ((a.bot.game as { minY?: number }).minY ?? -64);
    const s1 = Math.max(0, (Math.max(y1, minY) - minY) >> 4), s2 = Math.min(col.sections.length - 1, (y2 - minY) >> 4);
    for (let s = s1; s <= s2; s++) {
      const sec = col.sections[s];
      if (!sec) continue;
      // One state fills it (all air, all stone): either every cell matches or none; or its palette holds none of them
      if (sec.palette ? !sec.palette.some((st) => m[st]) : sec.data.value !== undefined && !m[sec.data.value]) continue;
      const sy = minY + s * 16;
      for (let j = 0; j < 4096; j++) {
        if (!m[sec.data.get(j)]) continue;
        const y = sy + (j >> 8);
        if (y < y1 || y > y2) continue;
        const x = c.cx * 16 + (j & 15), z = c.cz * 16 + ((j >> 4) & 15);
        const d = Math.hypot(x - pt.x, y - pt.y, z - pt.z);
        if (d > R) continue;
        const p = new Vec3(x, y, z);
        if (keep && !keep(p)) continue;
        out.push({ p, d });
      }
    }
  }
  out = out.sort(byD).slice(0, count);
  return out.map((o) => o.p);
}

/**
 * Blocks of `ids` within `maxDistance` that pass `keep` (positions only: read what you need with stateAt, exposedAt
 * and wetAbove, not blockAt, when matches can be many), at most `count`, nearest first; `ys` limits their height.
 */
export function nearestBlocks(a: BotAgent, ids: number[], maxDistance: number, count = 64, keep?: (p: Vec3) => boolean, ys?: { min?: number; max?: number }): Vec3[] {
  const p = a.bot.entity.position;
  const t0 = performance.now();
  scanning = a;
  lastCol = null;
  lastCx = lastCz = NaN;
  let found: Vec3[];
  try {
    found = scanBlocks(a, ids, maxDistance, count, keep, ys);
  } finally {
    scanning = null;
    lastCol = null;
  }
  // Long searches hold every bot's event loop (lesson 16): logged to find them
  const ms = performance.now() - t0;
  if (ms > 200) console.log(`[search] ${a.name}: ${Math.round(ms)} ms for ${ids.length > 3 ? `${ids.length} block kinds` : ids.map((i) => a.world.registry.blocks[i]?.name).join(', ')} within ${maxDistance} (${found.length} of ${count} found)`);
  return found.sort((u, v) => u.distanceTo(p) - v.distanceTo(p));
}

/** A free spot next to the bot to put a block down (air with air above and solid ground below, not where it stands). */
/**
 * Whether x, z is on any village's ground: a prepared or laid-out plot, or within 2 blocks of a building. A crafting
 * table a gatherer put down there (for its pickaxe) stood inside the future storage hut and raised its floor (StageH3).
 */
export function onVillageGround(a: BotAgent, x: number, z: number, y?: number): boolean {
  const cell = { x1: x, z1: z, x2: x, z2: z };
  // With a height, only near the ground's level: a gatherer mining under a plot may still put its table down there
  const level = (g: number) => y === undefined || (y >= g - 3 && y <= g + 12);
  for (const v of a.world.villages.villages.values()) {
    if (v.plots.some((p) => overlaps(cell, p) && level(p.y + 1)) || v.structures.some((s) => overlaps(cell, s, 2) && level(s.y + 1))) return true;
    // A laid-out plot not yet prepared has no level: any height counts
    if ((v.layouts ?? []).some((l) => overlaps(cell, l) && !v.plots.some((p) => overlaps(p, l) && !level(p.y + 1)))) return true;
  }
  return false;
}

/** Walk off village ground: to a dry spot 3 blocks past the edge of the ground the bot stands on. False if it could not. */
export async function stepOffVillageGround(a: BotAgent, signal: AbortSignal): Promise<boolean> {
  const p = a.bot.entity.position.floored();
  if (!onVillageGround(a, p.x, p.z, p.y)) return true;
  // The ground it stands on, as one box (a plot and the buildings on it)
  const cell = { x1: p.x, z1: p.z, x2: p.x, z2: p.z };
  const areas = [...a.world.villages.villages.values()].flatMap((v) => [...v.plots, ...(v.layouts ?? []), ...v.structures.map((s) => ({ x1: s.x1 - 2, z1: s.z1 - 2, x2: s.x2 + 2, z2: s.z2 + 2 }))]).filter((q) => overlaps(cell, q));
  const box = { x1: Math.min(...areas.map((q) => q.x1)), z1: Math.min(...areas.map((q) => q.z1)), x2: Math.max(...areas.map((q) => q.x2)), z2: Math.max(...areas.map((q) => q.z2)) };
  const spots = [[box.x1 - 3, p.z], [box.x2 + 3, p.z], [p.x, box.z1 - 3], [p.x, box.z2 + 3]]
    .sort(([x1, z1], [x2, z2]) => Math.abs(x1 - p.x) + Math.abs(z1 - p.z) - Math.abs(x2 - p.x) - Math.abs(z2 - p.z));
  for (const [x, z] of spots) {
    if (onVillageGround(a, x, z)) continue;
    const y = standableY(a, x, p.y, z);
    // Within 3 blocks up or down: a table or furnace much higher or lower is not reused (ensureTable, smelt)
    if (y === null || Math.abs(y - p.y) > 3) continue;
    const here = a.bot.blockAt(new Vec3(x, y, z)), under = a.bot.blockAt(new Vec3(x, y - 1, z));
    if (!under || /^(water|lava)$/.test(under.name) || here?.name === 'water') continue;
    try {
      await reach(a, new Vec3(x + 0.5, y, z + 0.5), 1.5, signal, 30000);
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
    }
    const now = a.bot.entity.position.floored();
    if (!onVillageGround(a, now.x, now.z, now.y)) return true;
  }
  return false;
}

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
    // Not on a block that opens when clicked (placing against a crafting table opens it: the server refused a furnace)
    const clickable = !!ground && /chest|barrel|furnace|smoker|crafting_table|door|trapdoor|gate|bed$|shulker|anvil|table$|lectern|hopper|dispenser|dropper/.test(ground.name);
    // Air only: a cell with wildflowers or grass in it refused the crafting table ("the block is still wildflowers", F68)
    // Nor in a village's mine (Minevale19: a miner's crafting table walled it into a tunnel)
    const mine = a.protectedGround().some((q) => q.y2 !== undefined && pos.x >= q.x1 && pos.x <= q.x2 && pos.z >= q.z1 && pos.z <= q.z2 && pos.y >= q.y && pos.y <= q.y2 + 1);
    if (ground?.boundingBox === 'block' && !clickable && /^(cave_)?air$/.test(here?.name ?? '') && above?.boundingBox === 'empty' && !mine && !onVillageGround(a, pos.x, pos.z, pos.y)) return { ground, pos };
  }
  return null;
}
