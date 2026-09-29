/**
 * Survival skills for agents in real Minecraft: mining and collecting, placing, crafting (making missing planks,
 * sticks and the crafting table on the way, like the sandbox), smelting, eating, fighting, exploring and trading.
 * Arguments and names match the sandbox's skills (skills.ts).
 */
import { Vec3 } from 'vec3';
import type { Block } from 'prismarine-block';
import type { Entity } from 'prismarine-entity';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import {
  abortable, at, checkAbort, countItem, freeSpotNearby, stepOffVillageGround, goals, itemId, itemName, nearestBlocks, num, reach, resolveItem,
  sleep, str, syncInventory, walk,
} from './mcUtil';

type Recipe = ReturnType<BotAgent['bot']['recipesAll']>[number];

// ---------------------------------------------------------------------------------------------
// Mining
// ---------------------------------------------------------------------------------------------

const PICK_ORDER = ['wooden_pickaxe', 'stone_pickaxe', 'copper_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'];

/** The weakest tool that harvests a block, for failure messages ("needs a wooden_pickaxe or better"). */
function weakestTool(a: BotAgent, block: Block): string {
  const names = Object.keys(block.harvestTools ?? {}).map((id) => itemName(a, Number(id)));
  return PICK_ORDER.find((p) => names.includes(p)) ?? names[0] ?? 'a tool';
}

/** Walk to the drops that just fell near pos and pick them up (best effort, a few seconds at most). */
async function pickUpDrops(a: BotAgent, pos: Vec3, signal: AbortSignal) {
  const bot = a.bot;
  const t0 = Date.now();
  await sleep(250, signal);
  while (Date.now() - t0 < 6000) {
    const drops = Object.values(bot.entities).filter((e) => e.name === 'item' && e.position.distanceTo(pos) < 4);
    if (!drops.length) return;
    const e = drops.sort((u, v) => u.position.distanceTo(bot.entity.position) - v.position.distanceTo(bot.entity.position))[0];
    try {
      await walk(a, new goals.GoalNear(e.position.x, e.position.y, e.position.z, 0.5), 'the dropped item', signal, 5000);
    } catch (err) {
      if ((err as Error).message === 'cancelled') throw err;
      return;
    }
    await sleep(200, signal);
  }
}

/** Mine one block: walk into reach, pick the best tool, dig, collect the drops. */
async function mineBlock(a: BotAgent, pos: Vec3, signal: AbortSignal, force = false, walkMs = 60000): Promise<string> {
  const bot = a.bot;
  let block = bot.blockAt(pos);
  if (!block) throw new Error(`the block at ${at(pos)} is not loaded; move closer first`);
  if (block.boundingBox === 'empty' && !/grass|fern|bush|flower|sapling|snow/.test(block.name)) return `nothing to mine at ${at(pos)} (${block.name})`;
  if (block.hardness === null || block.hardness < 0) throw new Error(`${block.name} at ${at(pos)} cannot be broken`);
  const tools = block.harvestTools;
  if (tools && !force && !bot.inventory.items().some((it) => tools[it.type]))
    throw new Error(`needs ${weakestTool(a, block)} (or better) to harvest ${block.name}; without one it drops nothing`);
  const eye = bot.entity.position.offset(0, 1.62, 0);
  if (eye.distanceTo(pos.offset(0.5, 0.5, 0.5)) > 4.2) {
    const label = `${block.name} at ${at(pos)}`;
    try {
      // Somewhere it can be seen from; failing that (it is buried), dig through the terrain to it
      await walk(a, new goals.GoalLookAtBlock(pos, bot.world, { reach: 4 }), label, signal, walkMs);
    } catch (e) {
      if (!/^no path/.test((e as Error).message)) throw e;
      await walk(a, new goals.GoalNear(pos.x, pos.y, pos.z, 2), label, signal, walkMs);
    }
  }
  block = bot.blockAt(pos)!;
  if (block.boundingBox === 'empty') {
    await pickUpDrops(a, pos.offset(0.5, 0.5, 0.5), signal); // dug on the way
    return `mined ${block.name} at ${at(pos)}`;
  }
  const tool = bot.pathfinder.bestHarvestTool(block);
  if (tool) await bot.equip(tool, 'hand');
  const name = block.name;
  // The pathfinder may still be finishing a dig of its own after a walk (stop() waits for it): its dig and this one
  // cancelled each other ("Digging aborted", several times a run with four bots). Let it finish, then dig; once more
  // if it was aborted anyway and the block is still there
  bot.pathfinder.setGoal(null);
  for (let i = 0; i < 30 && bot.pathfinder.isMining(); i++) await sleep(100, signal);
  try {
    await abortable(bot.dig(block, true), signal, () => bot.stopDigging());
  } catch (e) {
    if (!/Digging aborted/i.test((e as Error).message) || bot.blockAt(pos)?.name !== name) throw e;
    await sleep(300, signal);
    await abortable(bot.dig(bot.blockAt(pos)!, true), signal, () => bot.stopDigging());
  }
  a.pushEvent('broke', `broke ${name} at ${at(pos)}`, { block: name, x: pos.x, y: pos.y, z: pos.z });
  await pickUpDrops(a, pos.offset(0.5, 0.5, 0.5), signal);
  return `mined ${name} at ${at(pos)}`;
}

/**
 * What `collect` looks for: block ids, and the items that count as progress. "logs" means any log; an item name
 * (cobblestone, coal, raw_iron) means the blocks that drop it; an ore includes its deepslate variant.
 */
export function collectTargets(a: BotAgent, raw: string): { blocks: number[]; items: number[]; label: string } {
  const reg = a.world.registry;
  const n = raw.trim().toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_');
  const blocks = new Set<number>();
  const items = new Set<number>();
  if (/^(logs?|wood|trees?|any_log)$/.test(n)) {
    for (const b of reg.blocksArray) if (/_log$/.test(b.name) && !b.name.startsWith('stripped_')) blocks.add(b.id);
    for (const b of blocks) items.add(reg.itemsByName[reg.blocks[b].name]?.id ?? -1);
  } else {
    const name = reg.blocksByName[n] || reg.itemsByName[n] ? n : n.replace(/s$/, '');
    const block = reg.blocksByName[name];
    const item = reg.itemsByName[name];
    if (block) {
      blocks.add(block.id);
      if (/_ore$/.test(name) && reg.blocksByName[`deepslate_${name}`]) blocks.add(reg.blocksByName[`deepslate_${name}`].id);
      for (const b of blocks) for (const d of reg.blocks[b].drops as Array<number | { drop: number | { id: number } }>) items.add(typeof d === 'number' ? d : typeof d.drop === 'number' ? d.drop : d.drop.id);
    }
    if (item) {
      // Blocks that drop the item (cobblestone from stone, coal from coal ore)
      for (const b of reg.blocksArray)
        if ((b.drops as Array<number | { drop: number | { id: number } }>).some((d) => (typeof d === 'number' ? d : typeof d.drop === 'number' ? d.drop : d.drop.id) === item.id)) blocks.add(b.id);
      if (!block) items.clear();
      items.add(item.id);
    }
    if (!blocks.size) throw new Error(`unknown block ${raw}; use a block id such as oak_log, stone, coal_ore, sand, or 'logs' for any tree`);
    // Building blocks that also drop themselves are almost always placed by someone: cobblestone comes from stone
    // (a gatherer was mining the meeting hall's cobblestone floor)
    if (blocks.size > 1) for (const placed of ['cobblestone', 'mossy_cobblestone', 'stone_bricks', 'bricks']) blocks.delete(reg.blocksByName[placed]?.id ?? -1);
  }
  items.delete(-1);
  return { blocks: [...blocks], items: [...items], label: n };
}

/** Whether a block touches air or another see-through block (can be seen and reached without digging). */
export function exposed(a: BotAgent, p: Vec3): boolean {
  return FACES.some((f) => {
    const b = a.bot.blockAt(p.plus(f));
    return !!b && b.boundingBox === 'empty' && b.name !== 'water' && b.name !== 'lava';
  });
}

/** Where a village member's home is: its storage chest, or its first plot's centre. */
function homeOf(a: BotAgent): { x: number; z: number } | null {
  const v = a.village();
  const c = v?.storage?.chests[0];
  if (c) return { x: c.x, z: c.z };
  const p = v?.plots[0];
  return p ? { x: (p.x1 + p.x2) / 2, z: (p.z1 + p.z2) / 2 } : null;
}

/**
 * A wooden pickaxe made on the spot, with the logs for it: stone wants one, and the model churned for minutes over
 * tables, sticks and planks (or tried to mine stone by hand again and again).
 */
async function makePickaxe(a: BotAgent, signal: AbortSignal): Promise<void> {
  // The inventory as the server has it (the bot's own view still showed logs it had deposited)
  await syncInventory(a);
  await sleep(300, signal);
  // With 3 cobblestone in hand a stone pickaxe (131 blocks, a wooden one 59): its sticks take 2 planks
  const stone = countItem(a, itemId(a, 'cobblestone')!) >= 3;
  // 3 planks and 2 sticks (2 planks), and 4 more for a table when there is none to use
  const table = nearestBlockNamed(a, 'crafting_table', STATION_REACH);
  const want = (stone ? 2 : 5) + (table && Math.abs(table.position.y - a.bot.entity.position.y) <= 3 || a.bot.inventory.items().some((it) => it.name === 'crafting_table') ? 0 : 4);
  // Wood of one kind: 3 birch planks and 2 oak planks are five planks but no pickaxe (its sticks came up short). New
  // logs may be of yet another kind: look again after collecting
  for (let i = 0; i < 3; i++) {
    const wood = bestPlanks(a)?.n ?? 0;
    if (wood >= want) break;
    await collect(a, { block: 'logs', count: Math.ceil((want - wood) / 4) }, signal);
  }
  if (stone) {
    try {
      await craft(a, { item: 'stone_pickaxe', count: 1 }, signal);
      return;
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
    }
  }
  await craft(a, { item: 'wooden_pickaxe', count: 1 }, signal);
}

/** Blocks a bot could not get to, by position, until when (10 minutes): the next collect does not walk to them again. */
const unreachable = new Map<string, number>();
/**
 * Blocks a gatherer is on its way to, by position: others pick another (four workers walked to the same logs, and one
 * breaking a log first aborted the other's dig). All bots run in this process, so a map is enough.
 */
const targeted = new Map<string, { by: string; until: number }>();

// ---------------------------------------------------------------------------------------------
// Felling trees
// ---------------------------------------------------------------------------------------------

const isTreeLog = (name: string | undefined) => !!name && name.endsWith('_log') && !name.startsWith('stripped_');
/** How high above the ground a tree may reach to be felled (giant jungle and spruce trees are left standing). */
const TREE_MAX_HEIGHT = 30;
/** How far up a log can be cut from where the bot stands (its eyes are 1.62 above its feet; reach ~4.3). */
const CUT_REACH = 4.3;

/**
 * The logs of the tree a log belongs to: the logs connected to it, diagonals included (acacia branches, 2x2 trunks),
 * within 4 blocks sideways, up to 160. `keep` leaves out logs that are not the tree's (a building's log walls).
 */
function treeLogs(a: BotAgent, start: Vec3, keep: (p: Vec3) => boolean): Vec3[] {
  const seen = new Set<string>([at(start)]);
  const out: Vec3[] = [];
  let frontier = [start];
  while (frontier.length && out.length < 160) {
    const next: Vec3[] = [];
    for (const p of frontier) {
      if (!isTreeLog(a.bot.blockAt(p)?.name) || !keep(p)) continue;
      out.push(p);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const q = p.offset(dx, dy, dz);
            if (Math.abs(q.x - start.x) > 4 || Math.abs(q.z - start.z) > 4 || seen.has(at(q))) continue;
            seen.add(at(q));
            next.push(q);
          }
    }
    frontier = next;
  }
  return out;
}

/** The first solid ground under x, z below y (logs and leaves do not count); null if not loaded or none within 40. */
function groundBelow(a: BotAgent, x: number, y: number, z: number): number | null {
  const v = new Vec3(x, 0, z);
  for (let yy = y - 1; yy > y - 40; yy--) {
    const b = a.bot.blockAt(v.set(x, yy, z));
    if (!b) return null;
    if (b.boundingBox === 'block' && !isTreeLog(b.name) && !b.name.endsWith('_leaves')) return yy;
  }
  return null;
}

/** Jump and put a block of dirt under the feet: one block up. Returns where the block went. */
async function pillarUp(a: BotAgent, signal: AbortSignal): Promise<Vec3> {
  const bot = a.bot;
  const feet = bot.entity.position.floored();
  const below = bot.blockAt(feet.offset(0, -1, 0));
  if (below?.boundingBox !== 'block') throw new Error(`nothing solid under ${at(feet)} to build up from`);
  // Room to jump: two blocks over the head (a jump lifts the feet 1.25, the head to feet + 3.05). Leaves are cleared,
  // anything else stops the climb; with only one free block the bot rose to 75.42 over a block at 75 and every
  // placement was refused (Fell1)
  for (const dy of [2, 3]) {
    const over = bot.blockAt(feet.offset(0, dy, 0));
    if (!over || over.boundingBox === 'empty') continue;
    // (a log right over the pillar is the tree's, missed by the log search: Fell1 stopped under one)
    if (!over.name.endsWith('_leaves') && !isTreeLog(over.name)) throw new Error(`${over.name} above ${at(feet)}`);
    await abortable(bot.dig(over, true), signal, () => bot.stopDigging());
  }
  const dirt = bot.inventory.items().find((it) => it.name === 'dirt');
  if (!dirt) throw new Error('no dirt left to build up with');
  await bot.equip(dirt, 'hand');
  bot.pathfinder.setGoal(null);
  // Whether the dirt is there is the server's word: on 26.1 the placer is often not sent the block update, so
  // Mineflayer reports "the block is still air" (and its physics stands on nothing) when the dirt was placed; a retry
  // then put a second block on top (StageT2). Placed on the server means placed, and the bot's view is told so
  const placedOnServer = async () => /passed/i.test(await a.world.rcon.command(`execute if block ${feet.x} ${feet.y} ${feet.z} minecraft:dirt`).catch(() => ''));
  let placed = false;
  for (let attempt = 0; attempt < 2 && !placed; attempt++) {
    bot.setControlState('jump', true);
    let problem = '';
    try {
      for (let i = 0; i < 20 && bot.entity.position.y < feet.y + 1; i++) await sleep(50, signal);
      await sleep(50, signal);
      // Still in the block: placing would be refused (and has been, and then placed later: StageT4)
      if (bot.entity.position.y < feet.y + 1) throw new Error(`jumped only to ${bot.entity.position.y.toFixed(2)}`);
      await abortable(bot.placeBlock(below, new Vec3(0, 1, 0)), signal);
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      problem = (e as Error).message;
    } finally {
      bot.setControlState('jump', false);
    }
    placed = await placedOnServer();
    if (problem || !placed) console.log(`[trees] ${a.name} pillar at ${at(feet)}, try ${attempt + 1}: ${placed ? 'placed on the server' : 'not placed'}${problem ? `; Mineflayer said: ${problem.slice(0, 120)}` : ''}; view ${bot.blockAt(feet)?.name}, feet y ${bot.entity.position.y.toFixed(2)}`);
    if (placed && bot.blockAt(feet)?.name !== 'dirt') {
      const dirt = a.world.registry.blocksByName.dirt;
      (bot.world as unknown as { setBlockStateId(p: Vec3, id: number): void }).setBlockStateId(feet, dirt.defaultState ?? dirt.minStateId!);
    }
    if (!placed && attempt === 1) throw new Error(`could not put dirt under the feet at ${at(feet)}${problem ? ` (${problem})` : ''}`);
    for (let i = 0; i < 30 && !bot.entity.onGround; i++) await sleep(50, signal);
  }
  for (let i = 0; i < 20 && !(bot.entity.onGround && bot.entity.position.y >= feet.y + 0.99); i++) await sleep(50, signal);
  return feet;
}

/**
 * Dig a pillar back down while standing on it, top first, taking only the blocks it placed; what is left after that
 * (the bot's view lags the server's after digs: a check found the bottom block still there) is taken in a second and
 * third pass, walking to it if need be. Returns the blocks still there.
 */
async function pillarDown(a: BotAgent, placed: Vec3[], signal: AbortSignal): Promise<Vec3[]> {
  const bot = a.bot;
  const left = () => placed.filter((p) => bot.blockAt(p)?.name === 'dirt');
  for (let pass = 0; pass < 3 && left().length; pass++) {
    for (const p of left().reverse()) {
      const b = bot.blockAt(p);
      if (b?.name !== 'dirt') continue;
      try {
        if (bot.entity.position.offset(0, 1.62, 0).distanceTo(p.offset(0.5, 0.5, 0.5)) <= CUT_REACH) await abortable(bot.dig(b, true), signal, () => bot.stopDigging());
        else await mineBlock(a, p, signal, false, 15000);
      } catch (e) {
        if ((e as Error).message === 'cancelled') throw e;
      }
      for (let i = 0; i < 30 && !(bot.entity.onGround && bot.entity.position.y < p.y + 0.5); i++) await sleep(50, signal);
    }
    await sleep(400, signal);
  }
  return left();
}

/**
 * Dirt for the climb: what the bot carries, or dug from the ground beside the tree (the holes are filled again after).
 * Returns the holes.
 */
async function dirtForClimb(a: BotAgent, need: number, foot: Vec3, keep: (p: Vec3) => boolean, signal: AbortSignal): Promise<Vec3[]> {
  const reg = a.world.registry;
  const dirtId = itemId(a, 'dirt')!;
  const holes: Vec3[] = [];
  if (countItem(a, dirtId) >= need) return holes;
  const ids = ['dirt', 'grass_block', 'podzol'].map((n) => reg.blocksByName[n]?.id).filter((n): n is number => n !== undefined);
  // Ground at the tree's foot, open above, not under the tree itself
  const spots = nearestBlocks(a, ids, 8, 32, (p) => keep(p) && Math.abs(p.y - (foot.y - 1)) <= 1 && (p.x !== foot.x || p.z !== foot.z)
    && a.bot.blockAt(p.offset(0, 1, 0))?.boundingBox === 'empty' && !/water|lava/.test(a.bot.blockAt(p.offset(0, 1, 0))?.name ?? ''));
  for (const p of spots) {
    if (countItem(a, dirtId) >= need) break;
    await mineBlock(a, p, signal, false, 15000);
    holes.push(p);
  }
  if (countItem(a, dirtId) < need) throw new Error(`needs ${need} dirt to climb the tree (has ${countItem(a, dirtId)}) and found too little ground to dig beside it`);
  return holes;
}

/**
 * Pick up the logs and dirt lying within `radius` of pos, nearest first, for up to `ms`: a felled tree drops its logs
 * around its foot (the first test kept 24 of 54 logs with pickUpDrops' 6 seconds and 4 blocks). An item out of reach is
 * skipped, not the end of it; saplings and sticks falling from the decaying leaves are left (walking after them made a
 * staged village 60% slower).
 */
async function sweepDrops(a: BotAgent, pos: Vec3, radius: number, ms: number, signal: AbortSignal) {
  const bot = a.bot;
  const t0 = Date.now();
  const skip = new Set<number>();
  const wanted = (d: Entity) => /_log$|^dirt$/.test(itemName(a, (d.getDroppedItem?.() as { type?: number } | null)?.type ?? -1));
  await sleep(500, signal);
  while (Date.now() - t0 < ms) {
    const e = Object.values(bot.entities)
      .filter((d) => d.name === 'item' && !skip.has(d.id) && d.position.distanceTo(pos) < radius && wanted(d))
      .sort((u, v) => u.position.distanceTo(bot.entity.position) - v.position.distanceTo(bot.entity.position))[0];
    if (!e) return;
    try {
      await walk(a, new goals.GoalNear(e.position.x, e.position.y, e.position.z, 0.5), 'the dropped item', signal, 6000);
      await sleep(250, signal);
    } catch (err) {
      if ((err as Error).message === 'cancelled') throw err;
    }
    if (bot.entities[e.id]) skip.add(e.id);
  }
}

/**
 * Fell the whole tree `log` belongs to, as a player would: from the ground under its lowest log, cut what is in reach,
 * then build up with dirt under the feet, cutting as it goes, and dig that pillar back down; the leaves decay by
 * themselves once the logs are gone. Before this, collect cut the logs it could reach and left the rest floating: 39
 * of 61 "could not reach logs" failures in the acceptance runs were bots standing under such a trunk (F54).
 * Returns the logs cut; logs it could not get to are returned in `left`.
 */
async function fellTree(a: BotAgent, log: Vec3, keep: (p: Vec3) => boolean, signal: AbortSignal, walkMs: number): Promise<{ cut: number; left: Vec3[]; text: string }> {
  const b = a.bot;
  const logs = treeLogs(a, log, keep);
  if (!logs.length) return { cut: 0, left: [], text: 'no tree' };
  // A tree has leaves on its logs; logs without are built (a frame of log posts and beams, a player's cabin)
  const leafy = logs.some((p) => FACES.some((f) => b.blockAt(p.plus(f))?.name.endsWith('_leaves')));
  if (!leafy) throw new Error(`the logs at ${at(log)} have no leaves: built by someone, not a tree`);
  const lowest = logs.reduce((m, p) => (p.y < m.y ? p : m));
  const top = logs.reduce((m, p) => Math.max(m, p.y), lowest.y);
  const groundY = groundBelow(a, lowest.x, lowest.y, lowest.z);
  if (groundY === null) throw new Error(`no ground under the tree at ${at(lowest)}`);
  if (top - groundY > TREE_MAX_HEIGHT) throw new Error(`the tree at ${at(lowest)} is ${top - groundY} blocks tall (more than ${TREE_MAX_HEIGHT})`);
  for (const p of logs) targeted.set(at(p), { by: a.name, until: Date.now() + 5 * 60000 });
  const foot = new Vec3(lowest.x, groundY + 1, lowest.z);
  const standing = () => logs.filter((p) => isTreeLog(b.blockAt(p)?.name));
  let cut = 0;
  const cutInReach = async () => {
    const before = cut;
    for (const p of standing().sort((u, w) => u.y - w.y)) {
      const blk = b.blockAt(p)!;
      if (b.entity.position.offset(0, 1.62, 0).distanceTo(p.offset(0.5, 0.5, 0.5)) > CUT_REACH) continue;
      const tool = b.pathfinder.bestHarvestTool(blk);
      if (tool) await b.equip(tool, 'hand');
      b.pathfinder.setGoal(null);
      for (let i = 0; i < 30 && b.pathfinder.isMining(); i++) await sleep(100, signal);
      await abortable(b.dig(blk, true), signal, () => b.stopDigging());
      a.pushEvent('broke', `broke ${blk.name} at ${at(p)}`, { block: blk.name, x: p.x, y: p.y, z: p.z });
      cut++;
    }
    return cut - before;
  };
  // To the tree's foot, cutting what can be reached from the ground; then into the column of its lowest log, where each
  // log cut above falls onto the bot (a floating trunk's column is free already)
  await walk(a, new goals.GoalNear(foot.x, foot.y, foot.z, 2), `the tree at ${at(lowest)}`, signal, walkMs).catch((e: Error) => {
    if (e.message !== 'cancelled') console.log(`[trees] ${a.name} at ${at(b.entity.position)} could not walk to the tree at ${at(foot)}: ${e.message.slice(0, 160)}`);
    throw e;
  });
  await cutInReach();
  // Logs that can be cut from the ground elsewhere around the tree (a second trunk joined by a branch, low branches):
  // walked to one by one. Climbing is only for what stands too high (the first test climbed for logs 4 blocks to the
  // side and ran out of dirt)
  for (const p of standing().filter((q) => q.y <= groundY + 5)) {
    if (!isTreeLog(b.blockAt(p)?.name)) continue;
    try {
      await mineBlock(a, p, signal, false, 20000);
      cut++;
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      console.log(`[trees] ${a.name} could not cut ${at(p)} from the ground: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  await walk(a, new goals.GoalBlock(foot.x, foot.y, foot.z), `the foot of the tree at ${at(foot)}`, signal, 15000).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
    // Built up from where it stands instead
  });
  await cutInReach();
  const need = Math.max(0, top - groundY - 5) + 1;
  const placed: Vec3[] = [];
  let holes: Vec3[] = [];
  let problem = '';
  let climbFrom: Vec3 | null = null;
  // Worth climbing while logs stand above what can be cut from here (the feet + 5)
  const high = () => standing().some((p) => p.y > b.entity.position.y + 4);
  // ...and only from beside the trunk at its foot: a bot whose walk into the column failed stood 4 blocks lower, over
  // nothing solid, and tried to build up from there
  const me = b.entity.position.floored();
  const atFoot = Math.abs(me.x - foot.x) <= 2 && Math.abs(me.z - foot.z) <= 2 && Math.abs(me.y - foot.y) <= 1;
  try {
    if (high() && !atFoot) throw new Error(`could not get to the foot of the tree at ${at(foot)} (stood at ${at(me)})`);
    if (high()) {
      holes = await dirtForClimb(a, need, b.entity.position.floored(), keep, signal);
      // Back to where it stood: digging the dirt can leave it in one of those holes, and a climb from there filled the
      // hole with its first pillar block
      if (holes.length) await walk(a, new goals.GoalBlock(me.x, me.y, me.z), 'the foot of the tree', signal, 15000).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
      });
      const now = b.entity.position.floored();
      if (now.y !== me.y || Math.abs(now.x - me.x) > 1 || Math.abs(now.z - me.z) > 1) throw new Error(`could not get back to the foot of the tree at ${at(me)} after digging dirt`);
    }
    // Up one block at a time, cutting as it goes; three climbs that cut nothing end it
    let idle = 0;
    climbFrom = b.entity.position.floored();
    while (high() && idle < 3 && placed.length <= TREE_MAX_HEIGHT) {
      placed.push(await pillarUp(a, signal));
      idle = (await cutInReach()) ? 0 : idle + 1;
    }
  } catch (e) {
    if ((e as Error).message === 'cancelled') throw e;
    problem = (e as Error).message;
  } finally {
    if (!signal.aborted) {
      await pillarDown(a, placed, signal);
      for (const h of holes) await placeAt(a, 'dirt', h, signal).catch(() => undefined);
    }
  }
  await sweepDrops(a, foot, 8, 20000, signal);
  const left = standing();
  // The pillar as the server has it: the bot's view lags after placing and digging, and bottom blocks were left standing
  // (twice in the first tests) or reported left when gone. Anything left is broken by command (it drops like dug dirt)
  if (climbFrom) {
    const gone: string[] = [];
    for (let y = climbFrom.y; y <= climbFrom.y + placed.length + 1; y++) {
      // (a hole it dug for dirt and filled again is ground, not pillar)
      if (holes.some((h) => h.x === climbFrom!.x && h.y === y && h.z === climbFrom!.z)) continue;
      const r = await a.world.rcon.command(`execute if block ${climbFrom.x} ${y} ${climbFrom.z} minecraft:dirt`).catch(() => '');
      if (!/passed/i.test(r)) continue;
      await a.world.rcon.command(`setblock ${climbFrom.x} ${y} ${climbFrom.z} air destroy`).catch(() => '');
      gone.push(`${climbFrom.x},${y},${climbFrom.z}`);
    }
    if (gone.length) {
      console.log(`[trees] ${a.name} left pillar blocks at ${gone.join('; ')}: broken by command`);
      await sweepDrops(a, climbFrom, 4, 5000, signal);
    }
  }
  const text = `felled the tree at ${at(foot)}: ${cut} logs${placed.length ? `, climbed ${placed.length}` : ''}${left.length ? `; ${left.length} out of reach left${problem ? ` (${problem})` : ''}` : ''}`;
  console.log(`[trees] ${a.name} ${text}`);
  return { cut, left, text };
}

/**
 * Gather `count` of a block. It gives up soon on blocks it cannot get to: after 3 of them, or 90 seconds spent on
 * failed walks, or 2 minutes without collecting anything (six tries of up to two minutes each took five minutes).
 */
async function collect(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const { blocks, items, label } = collectTargets(a, str(args.block, 'block'));
  // Shared by every bot: a log another worker could not reach is usually out of reach for all (high in a canopy)
  const bad = unreachable;
  for (const [k, until] of bad) if (until < Date.now()) bad.delete(k);
  for (const [k, t] of targeted) if (t.until < Date.now() || t.by === a.name) targeted.delete(k);
  const takenByOther = (p: Vec3) => { const t = targeted.get(at(p)); return !!t && t.by !== a.name && t.until > Date.now(); };
  if (a.gamemode === 'creative') throw new Error(`in creative mode broken blocks drop nothing; use get_item ${label} instead`);
  const want = args.count !== undefined ? Math.max(1, Math.floor(num(args.count, 'count'))) : 1;
  const have = () => items.reduce((s, id) => s + countItem(a, id), 0);
  const start = have();
  let mined = 0;
  const failed = new Set<string>();
  let lastError = '';
  // Pickaxes made during this call (a wooden one lasts 59 blocks: one broke halfway through gathering cobblestone)
  let tools = 0;
  const t0 = Date.now();
  let failMs = 0, lastGot = 0, lastGain = Date.now();
  // A village member far from home walks back first, so that what it finds (or not) is what the village has: a worker
  // explored hop by hop to 180 blocks away, then gave up every gathering task it took (Accept14)
  const base = homeOf(a);
  if (base && Math.hypot(a.bot.entity.position.x - base.x, a.bot.entity.position.z - base.z) > 64)
    await walk(a, new goals.GoalNearXZ(Math.floor(base.x), Math.floor(base.z), 8), `the village at ${Math.floor(base.x)},${Math.floor(base.z)}`, signal, 180000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
  const from = a.bot.entity.position.clone();
  const giveUp = (got: number) => new Error(`could not reach ${label}: ${failed.size} tried from ${at(from)} in ${Math.round((Date.now() - t0) / 1000)} s${got ? ` (collected ${got} of ${want})` : ''}; last problem: ${lastError}. ${base
    ? `${got ? 'Deposit what you have; ' : ''}collect again: it searches within 96 blocks of the village by itself (no need to explore)`
    : `${got ? 'Deposit what you have, or c' : 'C'}ollect somewhere else: explore 30 blocks or more in another direction first`}`);
  const fail = (p: Vec3, m: string, ms: number) => {
    failed.add(at(p));
    bad.set(at(p), Date.now() + 10 * 60000);
    lastError = m;
    failMs += ms;
  };
  while (true) {
    checkAbort(signal);
    const got = items.length ? have() - start : mined;
    if (got >= want) return `collected ${got} ${label}`;
    if (got > lastGot) { lastGot = got; lastGain = Date.now(); }
    if (failed.size >= 3 || failMs > 90000 || (failed.size && Date.now() - lastGain > 2 * 60000)) throw giveUp(got);
    if (Date.now() - t0 > 5 * 60000) throw new Error(`timed out after collecting ${got} of ${want} ${label}`);
    // Many candidates, nearest first: findBlocks returns them in scan order, and 64 of them can all be far off. A village
    // member stays within 96 blocks of home (the storage chest or plot): gathering walk by walk it drifted 150 away
    const home = homeOf(a);
    // Never inside a village building (its footprint, from its floor up)
    // Nor in a prepared plot, down to a few blocks under its level (cobblestone gatherers dug the levelled stone of a
    // plot, and its buildings then found the ground uneven)
    // (and the 2-block margin prepare_site levels around a plot: gatherers dug an 18-deep hole at a plot's edge, Accept8)
    // Every village's, not only its own: Gus, in no village, felled the jungle-log frames of Accept15's cottages and hall
    // as trees (2026-09-29)
    const vil = a.village();
    const all = [...a.world.villages.villages.values()];
    const built = [...all.flatMap((v) => v.structures), ...all.flatMap((v) => v.plots).map((pl) => ({ x1: pl.x1 - 2, z1: pl.z1 - 2, x2: pl.x2 + 2, z2: pl.z2 + 2, y: pl.y - 3 }))];
    // Nor far below the village: logs 45 blocks down a ravine or mineshaft cost a worker 10 minutes (Accept8)
    const homeY = vil?.plots[0]?.y ?? vil?.storage?.chests[0]?.y;
    const near = (p: Vec3) => (!home || Math.hypot(p.x - home.x, p.z - home.z) <= 96) && (homeY === undefined || p.y >= homeY - 16)
      && !built.some((st) => p.x >= st.x1 - 1 && p.x <= st.x2 + 1 && p.z >= st.z1 - 1 && p.z <= st.z2 + 1 && p.y >= st.y - 1);
    const dry = (p: Vec3) => !/water|lava/.test(a.bot.blockAt(p.offset(0, 1, 0))?.name ?? '');
    const found = nearestBlocks(a, blocks, 48, 1024, (p) => near(p) && dry(p)).filter((p) => !failed.has(at(p)) && !bad.has(at(p)));
    // The cheapest to get at: near, not far below (exposed stone deep in a cave had no path to it, six times), and in
    // the open rather than buried; buried ones only within 16 blocks
    const me = a.bot.entity.position;
    // Logs high in a canopy cost too: the path search to them ran out of time again and again
    const effort = (p: Vec3) => p.distanceTo(me) + 2 * Math.max(0, me.y - p.y) + 1.5 * Math.max(0, p.y - me.y - 2) - (exposed(a, p) ? 4 : 0);
    let next: Vec3 | undefined = found.filter((p) => (p.distanceTo(me) < 16 || exposed(a, p)) && !takenByOther(p)).sort((u, w) => effort(u) - effort(w))[0];
    if (next) targeted.set(at(next), { by: a.name, until: Date.now() + 90000 });
    if (!next) {
      // Nothing close: look through everything loaded (~128 blocks) for one in the open and go there; in a desert a
      // worker told to "explore" wandered for minutes without ever looking again
      next = nearestBlocks(a, blocks, 128, 256).filter((p) => !failed.has(at(p)) && !bad.has(at(p)) && near(p)).find((p) => exposed(a, p));
      if (next) {
        const far = Math.round(next.distanceTo(a.bot.entity.position));
        const t1 = Date.now();
        await reach(a, next.offset(0.5, 0, 0.5), 4, signal, Math.min(120000, 20000 + 1000 * far)).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
          fail(next!, e.message, Date.now() - t1);
        });
        continue;
      }
    }
    if (!next) {
      if (got > 0) throw new Error(`only found ${got} ${label}; none left within ${home ? '96 blocks of the village' : '128 blocks'}: deposit what you have${home ? '; the rest has to come from farther away' : ', explore 100 blocks or more in one direction, then collect again'}`);
      throw new Error(home
        ? `no ${label} within 96 blocks of the village: it cannot be gathered here (a building that needs it goes without, or the task is handed back)${lastError ? ` (last problem: ${lastError})` : ''}`
        : `no ${label} within 128 blocks; explore 100 blocks or more in one direction, then collect again${lastError ? ` (last problem: ${lastError})` : ''}`);
    }
    const t1 = Date.now();
    // A log: its whole tree is felled, so no trunk is left floating out of reach (F54)
    if (isTreeLog(a.bot.blockAt(next)?.name)) {
      try {
        const r = await fellTree(a, next, near, signal, 20000 + 500 * Math.round(next.distanceTo(me)));
        mined += r.cut;
        // What it could not get to is out of reach for every bot (one failure for the tree, not one per log)
        for (const p of r.left) bad.set(at(p), Date.now() + 10 * 60000);
        if (!r.cut) fail(next, r.text, Date.now() - t1);
      } catch (e) {
        const m = (e as Error).message;
        if (m === 'cancelled') throw e;
        for (const p of treeLogs(a, next, near)) bad.set(at(p), Date.now() + 10 * 60000);
        fail(next, m, Date.now() - t1);
      }
      continue;
    }
    try {
      // A walk of 20 seconds for a block close by, a little more for one farther off
      await mineBlock(a, next, signal, false, 20000 + 500 * Math.round(next.distanceTo(me)));
      mined++;
    } catch (e) {
      const m = (e as Error).message;
      // Stone wants a pickaxe: make a wooden one (and the logs for it) rather than hand the chore to the model, which
      // churned for minutes over tables, sticks and planks
      if (/^needs wooden_pickaxe/.test(m) && tools < 2 && !a.bot.inventory.items().some((it) => it.name.endsWith('_pickaxe'))) {
        tools++;
        await makePickaxe(a, signal);
        continue;
      }
      if (m === 'cancelled' || m.startsWith('needs ')) throw e;
      // Gone meanwhile (another worker took it): not a failure
      if (!blocks.includes(a.bot.blockAt(next)?.type ?? -1)) continue;
      fail(next, m, Date.now() - t1);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Placing
// ---------------------------------------------------------------------------------------------

const FACES = [new Vec3(0, -1, 0), new Vec3(0, 1, 0), new Vec3(-1, 0, 0), new Vec3(1, 0, 0), new Vec3(0, 0, -1), new Vec3(0, 0, 1)];

/** Place a carried block at pos, against any solid neighbour. */
export async function placeAt(a: BotAgent, item: string, pos: Vec3, signal: AbortSignal): Promise<void> {
  const bot = a.bot;
  const id = itemId(a, item);
  if (id === undefined || !countItem(a, id)) throw new Error(`no ${item} in inventory`);
  const target = bot.blockAt(pos);
  if (!target) throw new Error(`${at(pos)} is not loaded; move closer first`);
  if (target.boundingBox !== 'empty') throw new Error(`${at(pos)} is occupied by ${target.name}`);
  let ref: Block | null = null, face: Vec3 | null = null;
  for (const f of FACES) {
    const b = bot.blockAt(pos.plus(f));
    if (b?.boundingBox === 'block') {
      ref = b;
      face = f.scaled(-1);
      break;
    }
  }
  if (!ref || !face) throw new Error(`nothing solid next to ${at(pos)} to place against`);
  // Stand within reach, but not in the spot itself
  const feet = bot.entity.position.floored();
  if (feet.x === pos.x && feet.z === pos.z && (feet.y === pos.y || feet.y + 1 === pos.y))
    await walk(a, new goals.GoalInvert(new goals.GoalNear(pos.x, pos.y, pos.z, 1.5)), 'a spot beside the target', signal, 10000);
  else if (bot.entity.position.offset(0, 1.62, 0).distanceTo(pos.offset(0.5, 0.5, 0.5)) > 4.2) await reach(a, pos, 3, signal);
  await bot.equip(id, 'hand');
  for (let attempt = 0; ; attempt++) {
    try {
      await abortable(bot.placeBlock(ref, face), signal);
      return;
    } catch (e) {
      const now = bot.blockAt(pos);
      if (now && now.name !== target.name) return; // placed; the confirmation was just late
      if ((e as Error).message === 'cancelled') throw e;
      // Refused once ("the block is still air"): look at it and try again
      if (attempt === 0) {
        await bot.lookAt(pos.offset(0.5, 0.5, 0.5)).catch(() => {});
        await sleep(400, signal);
        continue;
      }
      throw new Error(`placing ${item} at ${at(pos)} failed: ${(e as Error).message}`);
    }
  }
}

/** Put a carried block (crafting table, furnace) down next to the bot; returns the placed block. */
async function placeNearby(a: BotAgent, item: string, signal: AbortSignal): Promise<Block> {
  // Never on village ground (plots, buildings): off it first when there is no spot beside it
  let spot = freeSpotNearby(a);
  if (!spot && (await stepOffVillageGround(a, signal))) spot = freeSpotNearby(a);
  if (!spot) throw new Error(`no free spot nearby to put down the ${item} (not on a village's plots or beside its buildings); move to open ground`);
  await placeAt(a, item, spot.pos, signal);
  const b = a.bot.blockAt(spot.pos);
  if (!b || b.name !== item) throw new Error(`the ${item} did not appear at ${at(spot.pos)}`);
  return b;
}

// ---------------------------------------------------------------------------------------------
// Crafting
// ---------------------------------------------------------------------------------------------

/**
 * How far a crafting table or furnace already standing is used rather than a new one put down: they stand off the
 * village plots (placeNearby), up to ~18 blocks from a builder in the middle of a 30x30 plot.
 */
export const STATION_REACH = 32;

function nearestBlockNamed(a: BotAgent, name: string, maxDistance: number): Block | null {
  const id = a.world.registry.blocksByName[name]?.id;
  if (id === undefined) return null;
  const p = nearestBlocks(a, [id], maxDistance, 4)[0];
  return p ? a.bot.blockAt(p) : null;
}

const woodOf = (planks: string) => planks.replace(/_planks$/, '');

/** Logs (or stems) that make a given planks type, in the inventory. */
function logsFor(a: BotAgent, planks: string): Array<{ id: number; count: number }> {
  const wood = woodOf(planks);
  return a.bot.inventory.items()
    .filter((it) => it.name === `${wood}_log` || it.name === `stripped_${wood}_log` || it.name === `${wood}_wood` || it.name === `${wood}_stem` || (wood === 'bamboo' && it.name === 'bamboo_block'))
    .map((it) => ({ id: it.type, count: it.count }));
}

/** How many of an item could be had now: carried, plus planks from logs (4 each). */
function obtainable(a: BotAgent, id: number): number {
  const name = itemName(a, id);
  let n = countItem(a, id);
  if (name.endsWith('_planks')) n += 4 * logsFor(a, name).reduce((s, l) => s + l.count, 0);
  return n;
}

/**
 * Planks of any kind that could be had (for sticks and tables): a kind already carried as enough planks first, so no
 * logs are sawn (a builder's logs are kept for its log parts), then the kind with the most, counting logs.
 */
function bestPlanks(a: BotAgent, n = 0): { name: string; n: number } | null {
  let best: { name: string; n: number } | null = null;
  for (const it of a.world.registry.itemsArray) {
    if (!it.name.endsWith('_planks')) continue;
    if (n && countItem(a, it.id) >= n) return { name: it.name, n: obtainable(a, it.id) };
    const got = obtainable(a, it.id);
    if (got > 0 && (!best || got > best.n)) best = { name: it.name, n: got };
  }
  return best;
}

/**
 * Craft a recipe and wait for the server's inventory update. Crafts sent back to back desync the inventory: the
 * server drops some while the client counts them as made, and later crafts fail on items that are not there.
 */
/**
 * Craft `times` of a recipe by server command, charged exactly: the ingredients are counted and taken on the server
 * (/clear) and the result given (/give). Mineflayer's window clicking is unreliable on 26.1: working from a stale view
 * of the inventory it put crafted planks back into the grid and made an oak_button of them, or crafted nothing, in
 * most of a series of chest crafts. A recipe that needs a table still needs one placed nearby (ensureTable).
 */
async function doCraft(a: BotAgent, r: Recipe, times: number, _table: Block | null, signal: AbortSignal): Promise<number> {
  checkAbort(signal);
  const rcon = a.world.rcon;
  const name = itemName(a, r.result.id);
  const count = async (item: string) => Number(/Found (\d+)/i.exec(await rcon.command(`clear ${a.name} ${item} 0`))?.[1] ?? 0);
  const ingredients = needs(r).map(({ id, count: n }) => ({ item: itemName(a, id), n: n * times }));
  for (const { item, n } of ingredients) {
    const have = await count(item);
    if (have < n) throw new Error(`missing ingredients for ${times} x ${name}: needs ${n} ${item} (have ${have})`);
  }
  const taken: Array<{ item: string; n: number }> = [];
  for (const { item, n } of ingredients) {
    const got = Number(/Removed (\d+)/i.exec(await rcon.command(`clear ${a.name} ${item} ${n}`))?.[1] ?? 0);
    if (got < n) {
      // Something changed under us: give everything back
      for (const t of [...taken, { item, n: got }]) if (t.n) await rcon.command(`give ${a.name} ${t.item} ${t.n}`);
      throw new Error(`crafting ${name} failed: could only take ${got} of ${n} ${item}`);
    }
    taken.push({ item, n });
  }
  const made = r.result.count * times;
  const before = countItem(a, r.result.id);
  await rcon.command(`give ${a.name} ${name} ${made}`);
  // Wait until the bot sees the result: a pickaxe crafted inside collect was not there yet for the very next dig
  for (let i = 0; i < 30 && countItem(a, r.result.id) < before + made; i++) await sleep(100, signal);
  await syncInventory(a);
  a.pushEvent('crafted', `crafted ${made}x ${name}`, { item: name, count: made });
  return made;
}

/** Craft `times` of a recipe that needs no table (planks, sticks, the table itself). */
async function craftSimple(a: BotAgent, name: string, times: number, signal: AbortSignal): Promise<void> {
  const id = itemId(a, name)!;
  let r = a.bot.recipesFor(id, null, 1, null)[0];
  if (!r) {
    // Mineflayer's view of the inventory lags behind (logs just collected were not in it): look again
    await syncInventory(a);
    r = a.bot.recipesFor(id, null, 1, null)[0];
  }
  if (r) return void (await doCraft(a, r, times, null, signal));
  // Still none: try each variant on the server's counts (doCraft takes nothing unless everything is there)
  let last = '';
  for (const v of a.bot.recipesAll(id, null, false)) {
    try {
      await doCraft(a, v, times, null, signal);
      return;
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      last = (e as Error).message;
    }
  }
  throw new Error(`cannot make ${name} from what is carried${last ? ` (${last})` : ''}`);
}

/** Make sure at least n of a planks type are carried, sawing logs as needed. */
async function ensurePlanks(a: BotAgent, planks: string, n: number, signal: AbortSignal, notes: string[]) {
  const id = itemId(a, planks)!;
  const short = n - countItem(a, id);
  if (short <= 0) return;
  const logs = Math.ceil(short / 4);
  await craftSimple(a, planks, logs, signal);
  notes.push(`made ${logs * 4} ${planks}`);
}

async function ensureSticks(a: BotAgent, n: number, signal: AbortSignal, notes: string[]) {
  const id = itemId(a, 'stick')!;
  const short = n - countItem(a, id);
  if (short <= 0) return;
  const times = Math.ceil(short / 4);
  const p = bestPlanks(a, 2 * times);
  if (!p || p.n < 2 * times) throw new Error(`needs ${2 * times} planks for ${times * 4} sticks (have ${p?.n ?? 0}, counting logs)`);
  await ensurePlanks(a, p.name, 2 * times, signal, notes);
  await craftSimple(a, 'stick', times, signal);
  notes.push(`made ${times * 4} sticks`);
}

/** A crafting table within reach of use: a nearby one, or one carried or made and put down. */
async function ensureTable(a: BotAgent, signal: AbortSignal, notes: string[]): Promise<Block> {
  // A table far above or below may be out of reach (one on a ledge 4 blocks up had no path to it)
  const near = nearestBlockNamed(a, 'crafting_table', STATION_REACH);
  if (near && Math.abs(near.position.y - a.bot.entity.position.y) <= 3) return near;
  if (!countItem(a, itemId(a, 'crafting_table')!)) {
    const p = bestPlanks(a, 4);
    if (!p || p.n < 4) throw new Error(`needs a crafting table: craft one from 4 planks (have ${p?.n ?? 0}, counting logs)`);
    await ensurePlanks(a, p.name, 4, signal, notes);
    await craftSimple(a, 'crafting_table', 1, signal);
    notes.push('made a crafting_table');
  }
  const b = await placeNearby(a, 'crafting_table', signal);
  notes.push(`put the crafting_table down at ${at(b.position)}`);
  return b;
}

/** Ingredients a recipe consumes, by item id. */
const needs = (r: Recipe) => r.delta.filter((d) => d.count < 0).map((d) => ({ id: d.id, count: -d.count }));

/** What cannot be had for one craft of r even after sawing logs and making sticks: [name, need, have]. */
function shortfall(a: BotAgent, r: Recipe): Array<[string, number, number]> {
  const out: Array<[string, number, number]> = [];
  // Planks left over for sticks, after the recipe's own planks (roughly: the most plentiful kind)
  let planks = bestPlanks(a)?.n ?? 0;
  for (const { id, count } of needs(r)) if (itemName(a, id).endsWith('_planks')) planks -= count;
  for (const { id, count } of needs(r)) {
    const name = itemName(a, id);
    let have = obtainable(a, id);
    if (name === 'stick' && have < count) {
      const planksNeeded = 2 * Math.ceil((count - have) / 4);
      if (planks >= planksNeeded) have = count;
      planks -= planksNeeded;
    }
    if (have < count) out.push([name, count, countItem(a, id)]);
  }
  return out;
}

/** Uncommon ingredient variants, so ties go to the everyday recipe (cobblestone rather than deepslate). */
const EXOTIC = /deepslate|blackstone|cherry|bamboo|crimson|warped|mangrove|pale_oak|copper/;
const exotic = (a: BotAgent, r: Recipe) => needs(r).filter(({ id }) => EXOTIC.test(itemName(a, id))).length;

const describe = (a: BotAgent, r: Recipe) => needs(r).map(({ id, count }) => `${count}x ${itemName(a, id)}`).join(', ');

async function craft(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const raw = str(args.item, 'item');
  let name = resolveItem(a, raw);
  // "planks" alone: whichever kind the carried logs make
  if (!name && /^(wooden_)?planks?$/.test(raw.trim().toLowerCase())) name = bestPlanks(a)?.name ?? 'oak_planks';
  if (!name) throw new Error(`unknown item ${raw}; use exact ids like oak_planks, stick, crafting_table, wooden_pickaxe`);
  const id = itemId(a, name)!;
  const want = args.count !== undefined ? Math.max(1, Math.floor(num(args.count, 'count'))) : 1;
  await syncInventory(a);
  const all = a.bot.recipesAll(id, null, true);
  if (!all.length) throw new Error(`${name} has no crafting recipe${/ingot|glass|charcoal|stone$|brick$/.test(name) ? ' (try smelt)' : ''}`);
  const start = countItem(a, id);
  const notes: string[] = [];
  for (let round = 0; round < 12; round++) {
    checkAbort(signal);
    const made = countItem(a, id) - start;
    if (made >= want) break;
    // The recipe this inventory gets closest to (logs count as planks)
    // Ties go to the variant of what is carried (a pickaxe made of the acacia in hand, not "needs dark_oak_planks")
    const held = (r: Recipe) => needs(r).reduce((s, { id }) => s + obtainable(a, id), 0);
    const scored = all.map((r) => ({ r, short: shortfall(a, r) })).sort((u, v) => u.short.length - v.short.length || exotic(a, u.r) - exotic(a, v.r) || held(v.r) - held(u.r));
    const { r, short } = scored[0];
    if (short.length) {
      // A recipe that takes any planks says so
      const anyKind = (n: string) => /_planks$/.test(n) && all.some((x) => needs(x).some(({ id }) => /_planks$/.test(itemName(a, id)) && itemName(a, id) !== n));
      const miss = short.map(([n, need, have]) => `${need}x ${anyKind(n) ? 'planks (any kind)' : n} (have ${have})`).join(', ');
      // Planks and sticks come from logs: say how many more logs would do it
      const wood = short.reduce((s, [n, need, have]) => s + (/_planks$/.test(n) ? need - have : n === 'stick' ? Math.ceil((need - have) / 4) * 2 : 0), 0);
      const hint = wood && wood === short.reduce((s, [n, need, have]) => s + (/_planks$|^stick$/.test(n) ? (/_planks$/.test(n) ? need - have : Math.ceil((need - have) / 4) * 2) : 1000), 0)
        ? `; collect ${Math.ceil(wood / 4)} more log${Math.ceil(wood / 4) > 1 ? 's' : ''} and craft again` : '';
      const needsText = needs(r).map(({ id, count }) => `${count}x ${anyKind(itemName(a, id)) ? 'planks (any kind)' : itemName(a, id)}`).join(', ');
      throw new Error(`missing ingredients for ${name}: needs ${needsText}; short of ${miss}${made ? ` (made ${made} so far)` : ''}${hint}`);
    }
    // The table first (it takes 4 planks), then sticks (they take planks), then the recipe's planks
    const table = r.requiresTable ? await ensureTable(a, signal, notes) : null;
    for (const { id: need, count } of needs(r)) if (itemName(a, need) === 'stick' && name !== 'stick') await ensureSticks(a, count, signal, notes);
    for (const { id: need, count } of needs(r)) {
      const n = itemName(a, need);
      if (n.endsWith('_planks') && n !== name) await ensurePlanks(a, n, count, signal, notes);
    }
    if (table) await reach(a, table.position.offset(0.5, 0, 0.5), 3.5, signal);
    // As many crafts as wanted and affordable
    const ready = a.bot.recipesFor(id, null, 1, table).find((x) => JSON.stringify(x.delta) === JSON.stringify(r.delta)) ?? a.bot.recipesFor(id, null, 1, table)[0];
    if (!ready) throw new Error(`could not craft ${name} (needs ${describe(a, r)})`);
    const afford = Math.min(...needs(ready).map(({ id: i, count }) => Math.floor(countItem(a, i) / count)));
    const times = Math.max(1, Math.min(Math.ceil((want - made) / ready.result.count), afford));
    await doCraft(a, ready, times, table, signal);
  }
  const made = countItem(a, id) - start;
  return `crafted ${made} ${name}${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Smelting
// ---------------------------------------------------------------------------------------------

const FUELS = ['coal', 'charcoal', 'coal_block'];

async function smelt(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const bot = a.bot;
  let input = resolveItem(a, str(args.item, 'item'));
  // Ores smelt from their raw drop in modern Minecraft
  if (input && !countItem(a, itemId(a, input)!) && /_ore$/.test(input)) {
    const raw = `raw_${input.replace(/^deepslate_/, '').replace(/_ore$/, '')}`;
    if (itemId(a, raw) !== undefined) input = raw;
  }
  if (!input) throw new Error(`unknown item ${String(args.item)}`);
  await syncInventory(a);
  const inId = itemId(a, input)!;
  const have = countItem(a, inId);
  if (!have) throw new Error(`no ${input} in inventory`);
  const count = Math.min(have, args.count !== undefined ? Math.max(1, Math.floor(num(args.count, 'count'))) : have);
  let furnaceBlock = nearestBlockNamed(a, 'furnace', STATION_REACH);
  if (furnaceBlock && Math.abs(furnaceBlock.position.y - bot.entity.position.y) > 3) furnaceBlock = null;
  const notes: string[] = [];
  if (!furnaceBlock) {
    if (!countItem(a, itemId(a, 'furnace')!)) throw new Error('needs a furnace: craft one from 8 cobblestone');
    furnaceBlock = await placeNearby(a, 'furnace', signal);
    notes.push(`put a furnace down at ${at(furnaceBlock.position)}`);
  }
  await reach(a, furnaceBlock.position.offset(0.5, 0, 0.5), 3.5, signal);
  const furnace = await abortable(bot.openFurnace(furnaceBlock), signal);
  try {
    // Fuel: coal first, then planks, logs last (a plank or a log smelts 1.5 items, and a log makes 4 planks: burning
    // logs used a builder's wood four times as fast as planned, and the logs kept for its log parts)
    // The first stack found can be a leftover of one or two planks: top up from the next when the fire goes out
    // (four glass came out one: "ran out of fuel after 1 of 4" with planks still in hand, Accept9 and Accept10)
    const addFuel = async (left: number) => {
      // The furnace window's own view of the inventory: the bot's lagged (it offered the plank already burning)
      const items = furnace.items();
      const fuel = items.find((it) => FUELS.includes(it.name)) ?? items.find((it) => /_planks$/.test(it.name)) ?? items.find((it) => /_log$/.test(it.name));
      if (!fuel) return false;
      const perItem = FUELS.includes(fuel.name) ? 8 : 1.5;
      await furnace.putFuel(fuel.type, null, Math.min(fuel.count, Math.ceil(left / perItem)));
      return true;
    };
    if (!furnace.fuelItem() && !(await addFuel(count))) throw new Error('no fuel: needs coal, charcoal, planks or logs');
    await furnace.putInput(inId, null, count);
    let got = 0;
    const deadline = Date.now() + count * 11000 + 15000;
    while (got < count && Date.now() < deadline) {
      await sleep(2000, signal);
      const out = furnace.outputItem();
      if (out) got += (await furnace.takeOutput())?.count ?? 0;
      // The last item leaves the input slot while it is still cooking: wait for it too (8 sand gave 7 glass)
      if (!furnace.inputItem() && !furnace.outputItem() && !(furnace.progress > 0)) break;
      if (!furnace.fuelItem() && furnace.fuel <= 0 && furnace.inputItem() && !(await addFuel(count - got))) throw new Error(`ran out of fuel after ${got} of ${count}`);
    }
    return `smelted ${got} ${input}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  } finally {
    furnace.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Survival: eating, fighting
// ---------------------------------------------------------------------------------------------

async function eat(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const bot = a.bot;
  const foods = a.world.registry.foodsByName;
  if (bot.food >= 20) throw new Error('not hungry (food 20/20)');
  const wanted = args.item ? resolveItem(a, String(args.item)) : null;
  const options = bot.inventory.items().filter((it) => foods[it.name] && (!wanted || it.name === wanted) && !/rotten_flesh|spider_eye|poisonous|pufferfish/.test(it.name));
  const food = options.sort((u, v) => (foods[v.name].foodPoints ?? 0) - (foods[u.name].foodPoints ?? 0))[0];
  if (!food) throw new Error(wanted ? `no ${wanted} to eat` : 'no food in inventory (kill animals or collect apples, bread, berries)');
  await bot.equip(food, 'hand');
  await abortable(bot.consume(), signal);
  return `ate ${food.name} (food ${Math.round(bot.food)}/20)`;
}

const WEAPONS = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword', 'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'];

export async function attack(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const bot = a.bot;
  let target: Entity | undefined;
  if (args.id !== undefined) target = bot.entities[num(args.id, 'id')];
  else {
    const kind = str(args.kind, 'kind').toLowerCase();
    target = Object.values(bot.entities)
      .filter((e) => e !== bot.entity && (e.name === kind || e.username?.toLowerCase() === kind) && e.position.distanceTo(bot.entity.position) < 32)
      .sort((u, v) => u.position.distanceTo(bot.entity.position) - v.position.distanceTo(bot.entity.position))[0];
  }
  if (!target)
    throw new Error(args.id !== undefined
      ? `entity ${args.id} is gone (killed, despawned or out of sight); use an id from the current observation`
      : `no ${args.kind} within 32 blocks`);
  const what = target.name ?? target.username ?? 'target';
  if (what === 'creeper') throw new Error('do not fight creepers up close: they explode; move away from it instead');
  const weapon = WEAPONS.map((w) => bot.inventory.items().find((it) => it.name === w)).find(Boolean);
  if (weapon) await bot.equip(weapon, 'hand');
  bot.pathfinder.setMovements(a.moves());
  bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
  const t0 = Date.now();
  let hits = 0;
  try {
    while (bot.entities[target.id] && target.isValid !== false) {
      checkAbort(signal);
      if (Date.now() - t0 > 60000) throw new Error(`the ${what} is still alive after a minute (${hits} hits)`);
      const d = target.position.distanceTo(bot.entity.position);
      if (d > 40) throw new Error(`the ${what} got away`);
      if (d < 3.2) {
        await bot.lookAt(target.position.offset(0, (target.height ?? 1.6) * 0.8, 0), true);
        bot.attack(target);
        hits++;
      }
      await sleep(650, signal); // attack cooldown
    }
  } finally {
    bot.pathfinder.setGoal(null);
  }
  return `killed the ${what} (${hits} hits)`;
}

// ---------------------------------------------------------------------------------------------
// Moving around and trading
// ---------------------------------------------------------------------------------------------

const DIRS: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

async function explore(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const bot = a.bot;
  const dist = args.distance !== undefined ? Math.min(128, Math.max(8, num(args.distance, 'distance'))) : 32;
  const dir = typeof args.direction === 'string' && DIRS[args.direction] ? DIRS[args.direction] : (() => {
    const t = Math.random() * Math.PI * 2;
    return [Math.cos(t), Math.sin(t)] as [number, number];
  })();
  const p = bot.entity.position;
  const tx = Math.floor(p.x + dir[0] * dist), tz = Math.floor(p.z + dir[1] * dist);
  // Only x and z matter: a goal at an estimated ground height reported "no path ... stopped at" the spot it reached
  const goal = new goals.GoalNearXZ(tx, tz, 3);
  const from = p.clone();
  try {
    await walk(a, goal, `${tx},${tz}`, signal, 90000);
  } catch (e) {
    const moved = bot.entity.position.distanceTo(from);
    if ((e as Error).message === 'cancelled' || moved < 8) throw e;
    return `explored ${Math.round(moved)} blocks to ${at(bot.entity.position)} (stopped early: ${(e as Error).message})`;
  }
  return `explored to ${at(bot.entity.position)}`;
}

function playerEntity(a: BotAgent, name: string): Entity {
  const e = Object.values(a.bot.players).find((p) => p.username.toLowerCase() === name.toLowerCase())?.entity;
  if (!e) throw new Error(`player ${name} is not in sight (too far away or offline)`);
  return e;
}

async function follow(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const e = playerEntity(a, str(args.player, 'player'));
  const d = args.distance !== undefined ? Math.max(1, num(args.distance, 'distance')) : 3;
  const s = args.seconds !== undefined ? Math.min(600, Math.max(1, num(args.seconds, 'seconds'))) : 60;
  a.bot.pathfinder.setMovements(a.moves());
  a.bot.pathfinder.setGoal(new goals.GoalFollow(e, d), true);
  try {
    await sleep(s * 1000, signal);
  } finally {
    a.bot.pathfinder.setGoal(null);
  }
  return `followed ${e.username} for ${s} s`;
}

async function give(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const item = resolveItem(a, str(args.item, 'item'));
  if (!item) throw new Error(`unknown item ${String(args.item)}`);
  const id = itemId(a, item)!;
  const count = args.count !== undefined ? Math.max(1, Math.floor(num(args.count, 'count'))) : 1;
  const have = countItem(a, id);
  if (have < count) throw new Error(`not enough ${item} (have ${have})`);
  const e = playerEntity(a, str(args.player, 'player'));
  await reach(a, e.position, 2.5, signal, 60000);
  await a.bot.lookAt(e.position.offset(0, 1.2, 0), true);
  await a.bot.toss(id, null, count);
  return `gave ${count} ${item} to ${e.username}`;
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

const xyz = (a: Record<string, unknown>) => ['x', 'y', 'z'].forEach((k) => num(a[k], k));

export const SURVIVAL_SKILLS: Record<string, McSkill> = {
  mine: {
    check: xyz,
    async run(a, args, signal) {
      const pos = new Vec3(Math.floor(num(args.x, 'x')), Math.floor(num(args.y, 'y')), Math.floor(num(args.z, 'z')));
      try {
        return await mineBlock(a, pos, signal, args.force === true);
      } catch (e) {
        // Stone by hand drops nothing: make the pickaxe, as collect does
        if (!/^needs wooden_pickaxe/.test((e as Error).message) || a.gamemode === 'creative' || a.bot.inventory.items().some((it) => it.name.endsWith('_pickaxe'))) throw e;
        await makePickaxe(a, signal);
        return `${await mineBlock(a, pos, signal)} (made a wooden_pickaxe first)`;
      }
    },
  },
  collect: { check: (x) => void str(x.block, 'block'), run: collect },
  place: {
    check: (x) => (str(x.item, 'item'), xyz(x)),
    async run(a, args, signal) {
      const item = resolveItem(a, str(args.item, 'item'));
      if (!item) throw new Error(`unknown item ${String(args.item)}`);
      const pos = new Vec3(Math.floor(num(args.x, 'x')), Math.floor(num(args.y, 'y')), Math.floor(num(args.z, 'z')));
      await placeAt(a, item, pos, signal);
      return `placed ${item} at ${at(pos)}`;
    },
  },
  craft: { check: (x) => void str(x.item, 'item'), run: craft },
  smelt: { check: (x) => void str(x.item, 'item'), run: smelt },
  eat: { run: eat },
  attack: {
    check: (x) => {
      if (x.id === undefined && !x.kind) throw new Error('give id or kind');
    },
    run: attack,
  },
  explore: { run: explore },
  follow: { check: (x) => void str(x.player, 'player'), run: follow },
  give: { check: (x) => (str(x.player, 'player'), str(x.item, 'item')), run: give },
  equip: {
    check: (x) => void str(x.item, 'item'),
    async run(a, args) {
      const item = resolveItem(a, str(args.item, 'item'));
      const id = item ? itemId(a, item) : undefined;
      if (id === undefined || !countItem(a, id)) throw new Error(`no ${String(args.item)} in inventory`);
      await a.bot.equip(id, 'hand');
      return `holding ${item}`;
    },
  },
  drop: {
    check: (x) => void str(x.item, 'item'),
    async run(a, args) {
      const item = resolveItem(a, str(args.item, 'item'));
      const id = item ? itemId(a, item) : undefined;
      const have = id !== undefined ? countItem(a, id) : 0;
      if (!have) throw new Error(`no ${String(args.item)} in inventory`);
      const n = args.count !== undefined ? Math.min(have, Math.max(1, Math.floor(num(args.count, 'count')))) : have;
      await a.bot.toss(id!, null, n);
      return `dropped ${n} ${item}`;
    },
  },
  get_item: {
    check: (x) => void str(x.item, 'item'),
    async run(a, args) {
      if (a.gamemode !== 'creative') throw new Error('get_item works only in creative mode; gather or craft it instead');
      const item = resolveItem(a, str(args.item, 'item'));
      if (!item) throw new Error(`unknown item ${String(args.item)}`);
      const n = args.count !== undefined ? Math.min(64 * 9, Math.max(1, Math.floor(num(args.count, 'count')))) : 64;
      const out = await a.world.rcon.command(`give ${a.name} ${item} ${n}`);
      if (!/gave/i.test(out)) throw new Error(`could not get ${item}: ${out}`);
      return `got ${n} ${item}`;
    },
  },
};
