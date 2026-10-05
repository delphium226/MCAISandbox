/**
 * Shared village storage for the village economy: gatherers and crafters deposit into the village's chests, builders
 * withdraw what a building needs. The first chest is one an agent crafted and carries: deposit puts it down near the
 * agent, outside the plots, and registers it (with a 1x1 "storage" structure, so building and site preparation keep off
 * it). When the chests are full, a carried chest goes down in a row beside the others, one block apart so chests never
 * join into double chests (each is read once). The contents of each chest are cached in the village record whenever an
 * agent opens it, for the planners' village summary and the control panel.
 *
 * A village laid out with a storage hut (huts.ts) keeps sorted storage instead: its chests stand in the hut's chest
 * spots, each holds one material group (given at its first use), and deposit puts each item into its group's chest,
 * with a new chest in the next free spot when that one is full or missing. Old villages keep their loose chests.
 */
import { Vec3 } from 'vec3';
import type { Village, StorageChest } from '../village';
import { overlaps, storageText } from '../village';
import { STORAGE_HUT } from '../huts';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { placeAt, SURVIVAL_SKILLS } from './mcSurvival';
import { JUNK, TOOL } from './mcBlocks';
import { abortable, at, checkAbort, countItem, itemId, num, reach, resolveItem, sleep, standableY, str, syncInventory } from './mcUtil';

type Window = Awaited<ReturnType<BotAgent['bot']['openContainer']>>;

// Kept by deposit "all": TOOL, the tools an agent works with. Left out of it: JUNK, what gathering picks up by the way (a
// chest filled up with saplings, seeds and dirt; leaf litter and apples come from felling trees: 28 leaf litter filled a
// single-chest storage). Both in mcBlocks.ts
/** Names that stand for any kind of an item (mushroom stems are not logs). */
const KINDS: Array<[RegExp, RegExp, string]> = [
  [/^(any[ _:]?)?(wood(en)?[ _])?planks?$/, /_planks$/, 'planks'],
  [/^(any[ _:]?)?(logs?|wood)$/, /^(?!stripped_|mushroom_stem$).*_(log|stem)$/, 'logs'],
];

/** Which items an argument means: one item id, or any kind of planks or logs; null if unknown. */
function matcher(a: BotAgent, raw: string): { test: (name: string) => boolean; label: string } | null {
  const n = raw.trim().toLowerCase();
  for (const [re, items, label] of KINDS) if (re.test(n)) return { test: (x) => items.test(x), label: `${label} (any kind)` };
  const name = resolveItem(a, n);
  return name ? { test: (x) => x === name, label: name } : null;
}

const total = (items: Record<string, number>) => Object.values(items).reduce((s, q) => s + q, 0);

/** Material groups of a sorted storage: each chest in the storage hut holds one; anything else goes to "misc". */
const GROUPS: Array<[string, RegExp]> = [
  ['logs', /^(?!mushroom_stem$).*_(log|wood|stem|hyphae)$/],
  ['planks', /_planks$/],
  ['cobblestone', /^(cobblestone|cobbled_deepslate|stone|smooth_stone|deepslate|andesite|diorite|granite|tuff)$/],
  ['sand', /^(red_)?(sand|sandstone)$/],
  ['glass', /^glass(_pane)?$/],
  ['terracotta', /terracotta$/],
];
export const groupOf = (name: string) => GROUPS.find(([, re]) => re.test(name))?.[0] ?? 'misc';

/** Hut chest spots that hold no chest yet, in the order chests go down. */
const freeSpots = (v: Village) => (v.storageHut?.spots ?? []).filter((s) => !(v.storage?.chests ?? []).some((c) => c.x === s.x && c.z === s.z));

/** The level chests stand at in the storage hut: on its floor once built, else on the prepared plot; null before that. */
function hutY(v: Village): number | null {
  const h = v.storageHut!;
  const built = v.structures.find((s) => s.kind === STORAGE_HUT && overlaps(s, h));
  if (built) return built.y + 1;
  const placed = (v.storage?.chests ?? []).find((c) => h.spots.some((s) => s.x === c.x && s.z === c.z));
  if (placed) return placed.y;
  const plot = v.plots.find((p) => p.x1 <= h.x1 && p.x2 >= h.x2 && p.z1 <= h.z1 && p.z2 >= h.z2);
  return plot ? plot.y + 1 : null;
}

/** Everything in a village's storage, summed over its chests. */
export function storageContents(v: Village): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of v.storage?.chests ?? []) for (const [n, q] of Object.entries(c.items)) out[n] = (out[n] ?? 0) + q;
  return out;
}

/** One line for summaries and messages: "40 cobblestone, 12 oak_log, ..." (most first), chest by chest when sorted. */
export function describeStorage(v: Village, max = 20): string {
  return storageText(v, max);
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

/**
 * Whether a spot can take a chest: air with air above, solid ground, clear of plots, buildings and others' ground (a
 * storage hut's chest spots are on the plot and inside the hut: only the blocks count there).
 */
function chestSpotOk(a: BotAgent, v: Village, pos: Vec3, inHut = false): boolean {
  const bot = a.bot;
  const here = bot.blockAt(pos), above = bot.blockAt(pos.offset(0, 1, 0)), ground = bot.blockAt(pos.offset(0, -1, 0));
  if (!here || !above || !ground) return false;
  if (here.boundingBox !== 'empty' || here.name === 'water' || here.name === 'lava' || above.boundingBox !== 'empty' || ground.boundingBox !== 'block') return false;
  // Not on a block that opens when clicked (placing against a chest opens it instead: the server refused the chest)
  if (/chest|barrel|furnace|smoker|crafting_table|door|trapdoor|gate|bed$|shulker|anvil|table$|lectern|hopper|dispenser|dropper/.test(ground.name)) return false;
  const cell = { x1: pos.x, z1: pos.z, x2: pos.x, z2: pos.z };
  if (!inHut && v.plots.some((p) => overlaps(cell, p, 1))) return false;
  if (!inHut && a.world.villages.conflict(v, { x1: pos.x - 1, z1: pos.z - 1, x2: pos.x + 1, z2: pos.z + 1 }, a.name)) return false;
  // Not beside another chest (they would join into a double chest)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (bot.blockAt(pos.offset(dx, 0, dz))?.name === 'chest') return false;
  const feet = bot.entity.position.floored();
  return !(feet.x === pos.x && feet.z === pos.z);
}

/** Where the next chest goes: the storage hut's next free spot; else in a row beside the last one, or near the agent. */
function nextChestSpot(a: BotAgent, v: Village): Vec3 | null {
  if (v.storageHut) {
    const y = hutY(v);
    if (y === null) return null;
    // At the hut's level only: a chest a block higher or lower would be in the floor or roof the build sets
    for (const s of freeSpots(v)) {
      const p = new Vec3(s.x, y, s.z);
      if (chestSpotOk(a, v, p, true)) return p;
    }
    return null;
  }
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
  if (v.storageHut) {
    const y = hutY(v), free = freeSpots(v);
    if (y === null) throw new Error("the storage hut's ground is not prepared yet: the village plot is prepared first, then deposit again");
    if (!free.length) throw new Error('the storage hut is full (all 9 chest spots taken)');
    // Stand in the aisle beside the spot (inside the hut once it is built, through the door)
    const h = v.storageHut, mid = h.x1 + 3, s = free[0];
    const ax = s.x < mid ? s.x + 1 : s.x > mid ? s.x - 1 : s.x, az = s.x === mid ? s.z + 1 : s.z;
    await reach(a, new Vec3(ax + 0.5, y, az + 0.5), 0.5, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
  } else if (!first) {
    // Stand near the row so the next spot is loaded and in reach
    const last = v.storage!.chests[v.storage!.chests.length - 1];
    await reach(a, new Vec3(last.x + 0.5, last.y, last.z + 0.5), 3, signal);
  }
  const spot = nextChestSpot(a, v);
  if (!spot) throw new Error(v.storageHut
    ? `no free chest spot in the storage hut can take a chest (spots ${freeSpots(v).map((s) => `${s.x},${s.z}`).join('; ')}: something stands there, or the ground is missing)`
    : first
    ? 'no free spot within 8 blocks to put the storage chest (it goes on open, solid ground outside the plots); move to open ground beside the plots and deposit again'
    : 'no free spot beside the storage chests for another one; clear the ground next to them');
  await placeAt(a, 'chest', spot, signal);
  // The bot is often not sent its own placement (lesson 29): ask the server before calling it a failure
  if (a.bot.blockAt(spot)?.name !== 'chest' && !/passed/i.test(await a.world.rcon.command(`execute if block ${spot.x} ${spot.y} ${spot.z} minecraft:chest`).catch(() => '')))
    throw new Error(`the chest did not appear at ${at(spot)}`);
  const c: StorageChest = { x: spot.x, y: spot.y, z: spot.z, items: {} };
  v.storage ??= { chests: [], updated: Date.now() };
  v.storage.chests.push(c);
  v.structures.push({ id: a.world.villages.id('s'), kind: 'storage', x1: spot.x, z1: spot.z, x2: spot.x, z2: spot.z, y: spot.y, builtBy: a.name });
  a.world.villages.note(v, `${a.name} put ${first ? 'the storage chest' : 'another storage chest'} at ${at(spot)}${v.storageHut ? ' (in the storage hut)' : ''}`);
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
  // "all" keeps tools, and chests (a carried chest becomes more storage when the chests are full); junk is not junk to
  // the agent gathering it (Minevale19: dirt gathered for a vanilla house stayed in the gatherer's hands), while a miner
  // keeps its dirt (the review: with the village's needs as the rule, every miner emptied its scaffolding into storage)
  const needed = (n: string) => v.tasks.some((t) => t.status === 'claimed' && t.claimedBy === a.name && new RegExp(`collect block=${n}\\b`).test(t.detail));
  const m = /^(all|everything|\*)$/i.test(raw.trim()) ? { test: (n: string) => !TOOL.has(n) && (!JUNK.has(n) || needed(n)) && n !== 'chest', label: 'anything but tools and junk' } : matcher(a, raw);
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
    throw new Error(`the village has no storage chest yet: craft a chest (8 planks) and deposit again; deposit puts it down ${v.storageHut ? "in the storage hut's first chest spot" : 'near you, outside the plots'}`);
  const notes: string[] = [];
  const moved: Record<string, number> = {};
  let slipped = 0;
  if (v.storageHut) left = await depositSorted(a, v, m.test, left, moved, notes, signal);
  for (let i = 0; !v.storageHut && left > 0 && want.size; i++) {
    checkAbort(signal);
    // A put that failed with room left (the chest's slots drifted, or another worker had it open): once more from the
    // first chest, not "storage is full" (four workers at one chest were told that with 23 slots free)
    if (i >= (v.storage?.chests.length ?? 0) && slipped === 1 && v.storage?.chests.some((c) => slotsUsed(a, c) < 27)) {
      slipped++;
      await sleep(1000, signal);
      i = -1;
      continue;
    }
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
          if (!slipped) slipped = 1;
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
  want = carried();
  const got = Object.entries(moved).map(([n, q]) => `${q} ${n}`).join(', ');
  const n = v.storage?.chests.length ?? 0;
  // (no path is not a full storage: a miner told to craft a chest put a table down in its tunnel and walled itself in)
  if (!got && v.storageHut && notes.some((n) => /no path|stuck|timed out|could not reach/.test(n))) throw new Error(`could not reach the storage hut (${notes.join('; ')}): walk back to the village first (move_to near the storage hut at ${v.storageHut.x1 + 3},${v.storageHut.z2 + 2}), then deposit again`);
  if (!got && v.storageHut) throw new Error(`could not put anything in the storage hut${notes.length ? ` (${notes.join('; ')})` : ''}: craft a chest (8 planks) and deposit again`);
  if (!got) throw new Error(`storage is full (${n} chest${n === 1 ? '' : 's'}): craft a chest (8 planks) and deposit again; it is put down beside the others`);
  const rest = left > 0 ? [...want.values()] : [];
  const roomLeft = v.storage?.chests.some((c) => slotsUsed(a, c) < 27);
  return `deposited ${got}${notes.length ? ` (${notes.join('; ')})` : ''}` +
    (rest.length && roomLeft ? `; could not put in ${rest.map((r) => `${r.count} ${r.name}`).join(', ')} though there is room${v.storageHut ? '' : ' (another worker at the chest?)'}: deposit again` : '') +
    (rest.length && !roomLeft ? `; storage is full, still carrying ${rest.map((r) => `${r.count} ${r.name}`).join(', ')}: craft a chest (8 planks) and deposit again` : '') +
    `. Storage now holds ${describeStorage(v, 12)}`;
}

/**
 * Sorted storage (a village with a storage hut): each item goes to the chest of its material group. Carried chests go
 * into the free hut spots first (the storage task brings several). A group without a chest with room takes a free one
 * (empty, no group yet), else a new chest in the next free spot (crafted from wood carried or in storage), else any
 * chest with room. Returns how many of `left` are still to put in.
 */
async function depositSorted(a: BotAgent, v: Village, test: (n: string) => boolean, left: number, moved: Record<string, number>, notes: string[], signal: AbortSignal): Promise<number> {
  const chestId = itemId(a, 'chest')!;
  const chests = () => v.storage?.chests ?? [];
  // A chest holding something but with no group yet (registered by a test, say) takes the group of what it holds most of
  for (const c of chests())
    if (!c.group) {
      const top = Object.entries(c.items).filter(([, q]) => q > 0).sort((x, y) => y[1] - x[1])[0];
      if (top) c.group = groupOf(top[0]);
    }
  // As many as were carried at the start: the bot's view of its inventory lags its placements (StageH3: a fifth of
  // four chests was tried, and the deposit failed with "no chest in inventory")
  let placed = 0;
  const carriedChests = countItem(a, chestId);
  while (placed < carriedChests && freeSpots(v).length && (hutY(v) !== null || !chests().length)) {
    try {
      await placeChest(a, v, signal);
    } catch (e) {
      if ((e as Error).message === 'cancelled' || !chests().length) throw e;
      notes.push((e as Error).message);
      break;
    }
    placed++;
  }
  if (placed) notes.push(`put ${placed > 1 ? `${placed} chests` : 'a chest'} in the storage hut`);
  // Groups that have a chest go first, so a chest crafted for a new group is made from logs in storage rather than the
  // ones being deposited. Crafting can leave a log or planks over (StageH1, H2: one log of three taken, a table being
  // near): a group is visited a second time when more of it turns up
  const visits = new Map<string, number>();
  const nextGroup = () => {
    const gs = [...new Set(a.bot.inventory.items().filter((it) => test(it.name)).map((it) => groupOf(it.name)))].filter((g) => (visits.get(g) ?? 0) < 2);
    const fresh = gs.filter((g) => !visits.has(g));
    const pool = fresh.length ? fresh : gs;
    return pool.find((g) => chests().some((c) => c.group === g && slotsUsed(a, c) < 27)) ?? pool[0];
  };
  // A put that fails with room left (Mineflayer's view of the slots drifts) gets that chest once more (StageH1: one log
  // of eight was refused, then went in at the next deposit)
  const slips = new Set<StorageChest>();
  // Groups no new chest could be had for: their second visit goes to another chest with room
  const noChest = new Set<string>();
  for (let g = nextGroup(); g && left > 0; g = nextGroup()) {
    visits.set(g, (visits.get(g) ?? 0) + 1);
    const tried = new Set<StorageChest>();
    for (let round = 0; round < 6 && left > 0; round++) {
      checkAbort(signal);
      const items = new Map<number, { name: string; count: number }>();
      for (const it of a.bot.inventory.items()) {
        if (!test(it.name) || groupOf(it.name) !== g) continue;
        const e = items.get(it.type) ?? { name: it.name, count: 0 };
        e.count += it.count;
        items.set(it.type, e);
      }
      if (!items.size) break;
      const open = chests().filter((c) => !tried.has(c));
      // A free chest only when the group has no chest with room (StageH3: one cobblestone the view lost track of went
      // into the last free chest while the cobblestone chest had 25 slots free)
      const own = chests().some((x) => x.group === g && slotsUsed(a, x) < 27);
      let c = open.find((x) => x.group === g && slotsUsed(a, x) < 27) ?? (own ? undefined : open.find((x) => !x.group && !total(x.items)));
      if (!c && own) break;
      if (!c) {
        const made = noChest.has(g) ? null : await newChest(a, v, signal, notes);
        if (!made) noChest.add(g);
        c = made ?? open.find((x) => x.group === 'misc' && slotsUsed(a, x) < 27) ?? open.find((x) => slotsUsed(a, x) < 27);
        if (!c) break;
        if (c.group && c.group !== g) notes.push(`${g} went into chest ${chests().indexOf(c) + 1} (${c.group}): no chest for ${g} could be had`);
      }
      tried.add(c);
      const w = await openChest(a, v, c, signal).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        notes.push(e.message);
        return null;
      });
      if (!w) continue;
      let slipped = false;
      try {
        // What is carried as the open window sees it: the inventory view lags inside windows (lesson 24)
        const held = new Map<number, { name: string; count: number }>();
        for (let i = w.inventoryStart; i < w.slots.length; i++) {
          const it = w.slots[i];
          if (!it || !test(it.name) || groupOf(it.name) !== g) continue;
          const e = held.get(it.type) ?? { name: it.name, count: 0 };
          e.count += it.count;
          held.set(it.type, e);
        }
        for (const [type, { name, count }] of held) {
          const n = Math.min(count, left, room(a, w, 0, w.inventoryStart, type));
          if (n <= 0) continue;
          try {
            await abortable(w.deposit(type, null, n), signal);
            moved[name] = (moved[name] ?? 0) + n;
            left -= n;
            c.group ??= g;
          } catch (e) {
            if ((e as Error).message === 'cancelled') throw e;
            slipped = true;
          }
        }
        c.items = chestItems(w);
      } finally {
        w.close();
      }
      if (slipped && !slips.has(c)) {
        slips.add(c);
        tried.delete(c);
        await sleep(1000, signal);
      }
      await syncInventory(a);
      v.storage!.updated = Date.now();
      a.world.villages.save();
    }
  }
  return left;
}

/** A new chest in the storage hut's next free spot, carried or crafted for it; null if there is no spot or no wood. */
async function newChest(a: BotAgent, v: Village, signal: AbortSignal, notes: string[]): Promise<StorageChest | null> {
  if (!freeSpots(v).length) return null;
  try {
    if (!(await ensureChest(a, v, signal, notes))) return null;
    return await placeChest(a, v, signal);
  } catch (e) {
    if ((e as Error).message === 'cancelled') throw e;
    notes.push((e as Error).message);
    return null;
  }
}

/** Have a chest to put down: carried, or crafted from carried wood, or from 3 logs taken from the storage. */
async function ensureChest(a: BotAgent, v: Village, signal: AbortSignal, notes: string[]): Promise<boolean> {
  const chestId = itemId(a, 'chest')!;
  if (countItem(a, chestId)) return true;
  const logs = KINDS[1][1];
  // Planks of one kind (a recipe takes one: 6 oak and 2 birch planks made no chest, StageH8), counting logs as 4
  const wood = () => {
    const by: Record<string, number> = {};
    for (const it of a.bot.inventory.items()) {
      const kind = /_planks$/.test(it.name) ? it.name.replace(/_planks$/, '') : logs.test(it.name) ? it.name.replace(/^stripped_/, '').replace(/_(log|wood|stem|hyphae)$/, '') : null;
      if (kind) by[kind] = (by[kind] ?? 0) + (/_planks$/.test(it.name) ? it.count : 4 * it.count);
    }
    return Math.max(0, ...Object.values(by));
  };
  // 8 planks for the chest and 4 for a crafting table, if none is near
  if (wood() < 12) await take(a, v, [{ test: (n) => logs.test(n), left: 3 }], signal);
  if (wood() < 8) return false;
  // (the crafting table craft may put down stays off village ground: placeNearby)
  await SURVIVAL_SKILLS.craft.run(a, { item: 'chest', count: 1 }, signal);
  notes.push('crafted a chest for it');
  return countItem(a, chestId) > 0;
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

/** Register a chest that is already in the world (API, tests), with its material group in a sorted storage. */
export function registerChest(a: { name: string }, v: Village, pos: { x: number; y: number; z: number }, reg: { id(p: string): string; note(v: Village, t: string): void }, group?: string): string {
  v.storage ??= { chests: [], updated: Date.now() };
  if (v.storage.chests.some((c) => c.x === pos.x && c.y === pos.y && c.z === pos.z)) return `already registered: ${pos.x},${pos.y},${pos.z}`;
  v.storage.chests.push({ ...pos, items: {}, ...(group ? { group } : {}) });
  v.structures.push({ id: reg.id('s'), kind: 'storage', x1: pos.x, z1: pos.z, x2: pos.x, z2: pos.z, y: pos.y, builtBy: a.name });
  reg.note(v, `storage chest at ${pos.x},${pos.y},${pos.z} registered by ${a.name}`);
  return `registered ${pos.x},${pos.y},${pos.z}`;
}

export const STORAGE_SKILLS: Record<string, McSkill> = {
  deposit: { check: (x) => x.count !== undefined && void num(x.count, 'count'), run: deposit },
  withdraw: { check: (x) => { str(x.item, 'item'); if (x.count !== undefined) num(x.count, 'count'); }, run: withdraw },
};
