/**
 * Shared village storage for the village economy: gatherers and crafters deposit into the village's chests, builders
 * withdraw what a building needs. The first chest is one an agent crafted and carries: deposit puts it down near the
 * agent, outside the plots, and registers it (with a 1x1 "storage" structure, so building and site preparation keep off
 * it). When the chests are full, a carried chest goes down in a row beside the others, one block apart so chests never
 * join into double chests (each is read once). The contents of each chest are cached in the village record whenever an
 * agent opens it, for the planners' village summary and the control panel.
 */
import { Vec3 } from 'vec3';
import type { Village, StorageChest } from '../village';
import { overlaps } from '../village';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { placeAt } from './mcSurvival';
import { abortable, at, checkAbort, countItem, itemId, num, reach, resolveItem, standableY, str, syncInventory } from './mcUtil';

type Window = Awaited<ReturnType<BotAgent['bot']['openContainer']>>;

/** Kept by deposit "all": the tools an agent works with. */
const TOOL = /_(pickaxe|axe|shovel|hoe|sword)$|^(shears|flint_and_steel|fishing_rod|bucket|water_bucket)$/;
/** Left out of deposit "all": what gathering picks up by the way (a chest filled up with saplings, seeds and dirt). */
const JUNK = /_sapling$|_seeds$|^(dirt|coarse_dirt|rooted_dirt|gravel|flint|stick|egg|brown_egg|blue_egg|feather|bone|string|rotten_flesh|poppy|dandelion|cactus_flower|dead_bush|short_grass|wildflowers|.*_tulip|pink_petals|firefly_bush)$/;
/** Names that stand for any kind of an item. */
const KINDS: Array<[RegExp, RegExp, string]> = [
  [/^(any[ _:]?)?(wood(en)?[ _])?planks?$/, /_planks$/, 'planks'],
  [/^(any[ _:]?)?(logs?|wood)$/, /^(?!stripped_).*_(log|stem)$/, 'logs'],
];

/** Which items an argument means: one item id, or any kind of planks or logs; null if unknown. */
function matcher(a: BotAgent, raw: string): { test: (name: string) => boolean; label: string } | null {
  const n = raw.trim().toLowerCase();
  for (const [re, items, label] of KINDS) if (re.test(n)) return { test: (x) => items.test(x), label: `${label} (any kind)` };
  const name = resolveItem(a, n);
  return name ? { test: (x) => x === name, label: name } : null;
}

const total = (items: Record<string, number>) => Object.values(items).reduce((s, q) => s + q, 0);

/** Everything in a village's storage, summed over its chests. */
export function storageContents(v: Village): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of v.storage?.chests ?? []) for (const [n, q] of Object.entries(c.items)) out[n] = (out[n] ?? 0) + q;
  return out;
}

/** One line for summaries and messages: "40 cobblestone, 12 oak_log, ..." (most first). */
export function describeStorage(v: Village, max = 20): string {
  const items = Object.entries(storageContents(v)).sort((x, y) => y[1] - x[1]);
  if (!items.length) return 'empty';
  return items.slice(0, max).map(([n, q]) => `${q} ${n}`).join(', ') + (items.length > max ? `, and ${items.length - max} more kinds` : '');
}

/** Free room for an item in a window's slots [from, to): empty slots and partial stacks of the same item. */
function room(a: BotAgent, w: Window, from: number, to: number, type: number): number {
  const stack = a.world.registry.items[type]?.stackSize ?? 64;
  let free = 0;
  for (let i = from; i < to; i++) {
    const it = w.slots[i];
    if (!it) free += stack;
    else if (it.type === type) free += Math.max(0, stack - it.count);
  }
  return free;
}

/** A chest window's contents by item name. */
function chestItems(w: Window): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of w.containerItems()) out[it.name] = (out[it.name] ?? 0) + it.count;
  return out;
}

/** Slots a chest's cached contents fill (27 is full). */
function slotsUsed(a: BotAgent, c: StorageChest): number {
  return Object.entries(c.items).reduce((s, [n, q]) => s + Math.ceil(q / (a.world.registry.itemsByName[n]?.stackSize ?? 64)), 0);
}

/** Walk to a registered chest and open it; refreshes its cached contents. */
async function openChest(a: BotAgent, v: Village, c: StorageChest, signal: AbortSignal): Promise<Window> {
  const pos = new Vec3(c.x, c.y, c.z);
  const far = a.bot.entity.position.distanceTo(pos);
  try {
    await reach(a, pos.offset(0.5, 0, 0.5), 3, signal, Math.min(120000, 20000 + 1500 * far));
  } catch (e) {
    if ((e as Error).message === 'cancelled') throw e;
    // The walk stalled (a chest on a step up from the plot, twice): try a standable spot right beside it
    let ok = false;
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const y = standableY(a, c.x + dx, c.y, c.z + dz);
      if (y === null) continue;
      try {
        await reach(a, new Vec3(c.x + dx + 0.5, y, c.z + dz + 0.5), 0.8, signal, 30000);
        ok = true;
        break;
      } catch (e2) {
        if ((e2 as Error).message === 'cancelled') throw e2;
      }
    }
    if (!ok) throw e;
  }
  const block = a.bot.blockAt(pos);
  if (!block) throw new Error(`the storage chest at ${at(pos)} is not loaded; move closer`);
  if (block.name !== 'chest') {
    // Gone (broken by someone): forget it, keeping what the record said it held in the message
    v.storage!.chests = v.storage!.chests.filter((x) => x !== c);
    v.structures = v.structures.filter((s) => !(s.kind === 'storage' && s.x1 === c.x && s.z1 === c.z && s.y === c.y));
    a.world.villages.save();
    throw new Error(`the storage chest at ${at(pos)} is gone (${block.name} there now); ${total(c.items)} items it held are lost from the record`);
  }
  let w: Window;
  try {
    w = await abortable(a.bot.openContainer(block), signal);
  } catch (e) {
    // Usually out of reach or seen past a corner: step right up to it and try once more
    checkAbort(signal);
    await reach(a, pos.offset(0.5, 0, 0.5), 1.5, signal, 20000).catch(() => undefined);
    try {
      w = await abortable(a.bot.openContainer(block), signal);
    } catch {
      throw new Error(`could not open the storage chest at ${at(pos)} (${(e as Error).message}); stand right next to it and try again`);
    }
  }
  c.items = chestItems(w);
  v.storage!.updated = Date.now();
  a.world.villages.save();
  return w;
}

/** Whether a spot can take a chest: air with air above, solid ground, clear of plots, buildings and others' ground. */
function chestSpotOk(a: BotAgent, v: Village, pos: Vec3): boolean {
  const bot = a.bot;
  const here = bot.blockAt(pos), above = bot.blockAt(pos.offset(0, 1, 0)), ground = bot.blockAt(pos.offset(0, -1, 0));
  if (!here || !above || !ground) return false;
  if (here.boundingBox !== 'empty' || here.name === 'water' || here.name === 'lava' || above.boundingBox !== 'empty' || ground.boundingBox !== 'block') return false;
  // Not on a block that opens when clicked (placing against a chest opens it instead: the server refused the chest)
  if (/chest|barrel|furnace|smoker|crafting_table|door|trapdoor|gate|bed$|shulker|anvil|table$|lectern|hopper|dispenser|dropper/.test(ground.name)) return false;
  const cell = { x1: pos.x, z1: pos.z, x2: pos.x, z2: pos.z };
  if (v.plots.some((p) => overlaps(cell, p, 1))) return false;
  if (a.world.villages.conflict(v, { x1: pos.x - 1, z1: pos.z - 1, x2: pos.x + 1, z2: pos.z + 1 }, a.name)) return false;
  // Not beside another chest (they would join into a double chest)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (bot.blockAt(pos.offset(dx, 0, dz))?.name === 'chest') return false;
  const feet = bot.entity.position.floored();
  return !(feet.x === pos.x && feet.z === pos.z);
}

/** Where the next chest goes: in a row beside the last one (two blocks apart), or near the agent for the first. */
function nextChestSpot(a: BotAgent, v: Village): Vec3 | null {
  const chests = v.storage?.chests ?? [];
  const last = chests[chests.length - 1];
  const tries: Vec3[] = [];
  if (last) {
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) for (const dy of [0, 1, -1]) tries.push(new Vec3(last.x + dx, last.y + dy, last.z + dz));
    for (let r = 2; r <= 4; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) for (const dy of [0, 1, -1]) tries.push(new Vec3(last.x + dx, last.y + dy, last.z + dz));
  } else {
    // The agent's own level first, then a block up or down (a chest on a step made the walk to it stall)
    const base = a.bot.entity.position.floored();
    for (const dy of [0, -1, 1]) for (let r = 1; r <= 8; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r) tries.push(base.offset(dx, dy, dz));
  }
  return tries.find((p) => chestSpotOk(a, v, p)) ?? null;
}

/** Put a carried chest down as village storage and register it. */
async function placeChest(a: BotAgent, v: Village, signal: AbortSignal): Promise<StorageChest> {
  const first = !v.storage?.chests.length;
  if (!first) {
    // Stand near the row so the next spot is loaded and in reach
    const last = v.storage!.chests[v.storage!.chests.length - 1];
    await reach(a, new Vec3(last.x + 0.5, last.y, last.z + 0.5), 3, signal);
  }
  const spot = nextChestSpot(a, v);
  if (!spot) throw new Error(first
    ? 'no free spot within 8 blocks to put the storage chest (it goes on open, solid ground outside the plots); move to open ground beside the plots and deposit again'
    : 'no free spot beside the storage chests for another one; clear the ground next to them');
  await placeAt(a, 'chest', spot, signal);
  const b = a.bot.blockAt(spot);
  if (b?.name !== 'chest') throw new Error(`the chest did not appear at ${at(spot)}`);
  const c: StorageChest = { x: spot.x, y: spot.y, z: spot.z, items: {} };
  v.storage ??= { chests: [], updated: Date.now() };
  v.storage.chests.push(c);
  v.structures.push({ id: a.world.villages.id('s'), kind: 'storage', x1: spot.x, z1: spot.z, x2: spot.x, z2: spot.z, y: spot.y, builtBy: a.name });
  a.world.villages.note(v, `${a.name} put ${first ? 'the storage chest' : 'another storage chest'} at ${at(spot)}`);
  // That was the storage task (whatever steps were left of it)
  if (first)
    for (const t of v.tasks)
      if (/set up the village storage/i.test(t.title) && (t.status === 'open' || t.status === 'claimed')) {
        t.claimedBy ??= a.name;
        a.world.villages.finish(v, t.id, t.claimedBy, `storage chest at ${at(spot)}`);
      }
  return c;
}

async function deposit(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('deposit puts items in the village storage, and you are not in a village');
  const raw = args.item === undefined ? 'all' : str(args.item, 'item');
  // "all" keeps tools, and chests (a carried chest becomes more storage when the chests are full)
  const m = /^(all|everything|\*)$/i.test(raw.trim()) ? { test: (n: string) => !TOOL.test(n) && !JUNK.test(n) && n !== 'chest', label: 'anything but tools and junk' } : matcher(a, raw);
  if (!m) throw new Error(`unknown item ${raw}; use an item id (oak_log, cobblestone), "logs", "planks" or "all"`);
  let left = args.count !== undefined ? Math.max(1, Math.floor(num(args.count, 'count'))) : Infinity;
  const carried = () => {
    const out = new Map<number, { name: string; count: number }>();
    for (const it of a.bot.inventory.items()) {
      if (!m.test(it.name)) continue;
      const e = out.get(it.type) ?? { name: it.name, count: 0 };
      e.count += it.count;
      out.set(it.type, e);
    }
    return out;
  };
  await syncInventory(a);
  let want = carried();
  if (!want.size) throw new Error(`not carrying ${m.label} (carrying ${a.bot.inventory.items().map((it) => `${it.count} ${it.name}`).join(', ') || 'nothing'})`);
  const chestId = itemId(a, 'chest')!;
  if (!v.storage?.chests.length && !countItem(a, chestId))
    throw new Error('the village has no storage chest yet: craft a chest (8 planks) and deposit again; deposit puts it down near you, outside the plots');
  const notes: string[] = [];
  const moved: Record<string, number> = {};
  for (let i = 0; left > 0 && want.size; i++) {
    checkAbort(signal);
    // Past the last chest (or none yet): a carried chest becomes the next one
    if (i >= (v.storage?.chests.length ?? 0)) {
      if (!countItem(a, chestId)) break;
      const c = await placeChest(a, v, signal);
      notes.push(`put ${i ? 'another' : 'the storage'} chest down at ${c.x},${c.y},${c.z}`);
      want = carried();
      if (!want.size) break;
    }
    // Chests with room (as last seen) first
    if (i === 0) v.storage!.chests.sort((x, y) => Number(slotsUsed(a, x) >= 27) - Number(slotsUsed(a, y) >= 27));
    const c = v.storage!.chests[i];
    const w = await openChest(a, v, c, signal);
    try {
      for (const [type, { name, count }] of want) {
        const n = Math.min(count, left, room(a, w, 0, w.inventoryStart, type));
        if (n <= 0) continue;
        // One item's failure (Mineflayer's view of the slots drifts) does not stop the rest
        try {
          await abortable(w.deposit(type, null, n), signal);
          moved[name] = (moved[name] ?? 0) + n;
          left -= n;
        } catch (e) {
          if ((e as Error).message === 'cancelled') throw e;
        }
      }
      c.items = chestItems(w);
    } finally {
      w.close();
    }
    await syncInventory(a);
    v.storage!.updated = Date.now();
    a.world.villages.save();
    want = carried();
  }
  const got = Object.entries(moved).map(([n, q]) => `${q} ${n}`).join(', ');
  const n = v.storage?.chests.length ?? 0;
  if (!got) throw new Error(`storage is full (${n} chest${n === 1 ? '' : 's'}): craft a chest (8 planks) and deposit again; it is put down beside the others`);
  const rest = left > 0 ? [...want.values()] : [];
  return `deposited ${got}${notes.length ? ` (${notes.join('; ')})` : ''}` +
    (rest.length ? `; storage is full, still carrying ${rest.map((r) => `${r.count} ${r.name}`).join(', ')}: craft a chest (8 planks) and deposit again` : '') +
    `. Storage now holds ${describeStorage(v, 12)}`;
}

/**
 * Take items from the storage chests: each want is a test on item names and how many; chests the record says hold
 * something wanted are opened first, the others only while nothing was found (someone may have filled them).
 */
async function take(a: BotAgent, v: Village, wants: Array<{ test: (name: string) => boolean; left: number }>, signal: AbortSignal) {
  const got: Record<string, number> = {};
  let invFull = false;
  const open = () => wants.filter((w) => w.left > 0);
  const has = (c: StorageChest) => Object.entries(c.items).some(([n, q]) => q > 0 && open().some((w) => w.test(n)));
  const order = [...(v.storage?.chests ?? [])].sort((x, y) => Number(has(y)) - Number(has(x)));
  for (const c of order) {
    if (!open().length || invFull) break;
    if (!has(c) && Object.keys(got).length) continue;
    checkAbort(signal);
    const w = await openChest(a, v, c, signal);
    try {
      for (const it of w.containerItems()) {
        const want = open().find((x) => x.test(it.name));
        if (!want) continue;
        const n = Math.min(want.left, it.count, room(a, w, w.inventoryStart, w.slots.length, it.type));
        if (n <= 0) { invFull = true; break; }
        await abortable(w.withdraw(it.type, null, n), signal);
        got[it.name] = (got[it.name] ?? 0) + n;
        want.left -= n;
      }
      c.items = chestItems(w);
    } finally {
      w.close();
    }
    await syncInventory(a);
    v.storage!.updated = Date.now();
    a.world.villages.save();
  }
  return { got, invFull };
}

/** Open every storage chest to re-read what it holds (someone may have filled or emptied it outside the record). */
export async function refreshStorage(a: BotAgent, v: Village, signal: AbortSignal): Promise<void> {
  for (const c of [...(v.storage?.chests ?? [])]) {
    checkAbort(signal);
    const w = await openChest(a, v, c, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      return null;
    });
    w?.close();
  }
  await syncInventory(a);
}

/** Take exact items from the village storage (builders fetching a bill of materials); returns what was taken. */
export async function withdrawItems(a: BotAgent, v: Village, want: Record<string, number>, signal: AbortSignal) {
  const wants = Object.entries(want).filter(([, q]) => q > 0).map(([name, q]) => ({ test: (n: string) => n === name, left: q }));
  return wants.length && v.storage?.chests.length ? take(a, v, wants, signal) : { got: {}, invFull: false };
}

async function withdraw(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('withdraw takes items from the village storage, and you are not in a village');
  if (!v.storage?.chests.length) throw new Error('the village has no storage chest yet (a chest is put down by the first deposit)');
  const raw = str(args.item, 'item');
  const m = matcher(a, raw);
  if (!m) throw new Error(`unknown item ${raw}; use an item id (oak_planks, glass), "logs" or "planks"`);
  const want = args.count !== undefined ? Math.max(1, Math.floor(num(args.count, 'count'))) : 64;
  const { got, invFull } = await take(a, v, [{ test: m.test, left: want }], signal);
  const n = Object.values(got).reduce((s, q) => s + q, 0);
  const taken = Object.entries(got).map(([k, q]) => `${q} ${k}`).join(', ');
  if (!taken) {
    if (invFull) throw new Error('inventory is full: deposit something first');
    throw new Error(`storage has no ${m.label}; it holds ${describeStorage(v, 12)}`);
  }
  const short = n < want ? (invFull ? `; inventory is full, ${want - n} not taken` : `; storage had only ${n} of the ${want} asked for`) : '';
  return `withdrew ${taken}${short}`;
}

/** Register a chest that is already in the world (API, tests). */
export function registerChest(a: { name: string }, v: Village, pos: { x: number; y: number; z: number }, reg: { id(p: string): string; note(v: Village, t: string): void }): string {
  v.storage ??= { chests: [], updated: Date.now() };
  if (v.storage.chests.some((c) => c.x === pos.x && c.y === pos.y && c.z === pos.z)) return `already registered: ${pos.x},${pos.y},${pos.z}`;
  v.storage.chests.push({ ...pos, items: {} });
  v.structures.push({ id: reg.id('s'), kind: 'storage', x1: pos.x, z1: pos.z, x2: pos.x, z2: pos.z, y: pos.y, builtBy: a.name });
  reg.note(v, `storage chest at ${pos.x},${pos.y},${pos.z} registered by ${a.name}`);
  return `registered ${pos.x},${pos.y},${pos.z}`;
}

export const STORAGE_SKILLS: Record<string, McSkill> = {
  deposit: { check: (x) => x.count !== undefined && void num(x.count, 'count'), run: deposit },
  withdraw: { check: (x) => { str(x.item, 'item'); if (x.count !== undefined) num(x.count, 'count'); }, run: withdraw },
};
