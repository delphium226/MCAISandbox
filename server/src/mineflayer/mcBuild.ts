/**
 * Building skills for agents in real Minecraft, with the sandbox's names, arguments, checks and village records:
 * find_site, prepare_site (fell trees, cut and fill to one level), build_design, build_box and build (hut, house,
 * platform, wall).
 *
 * Blocks are placed with server commands (/setblock and /fill over RCON, which need no operator rights for the bots),
 * paced by memory.buildSpeed like the sandbox (1 is about 10 blocks a second), while the bot stands by the site and
 * looks at what it builds. Creative agents build for free. Survival agents pay for every block (the village economy):
 * before placing anything the builder works out what is still missing, takes it from the village storage, and fails
 * with the shortage and how to get it if anything is still short; each run of blocks is then taken from its inventory
 * (/clear) as it is placed. Wood kinds are swapped for the kind the builder can supply (designs say oak, the land
 * grows acacia). A build stopped part-way continues where it stopped when run again. prepare_site is landscaping and
 * stays free; in survival the preparer keeps the logs of the trees it fells. memory.buildMode "commands" builds free
 * in survival (tests).
 */
import { Vec3 } from 'vec3';
import type { Area, Design, Reservation } from '../village';
import { areaText, overlaps } from '../village';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { chargedItem, describeWork, gatherTasks, type Counts } from './mcMaterials';
import { STORAGE_SKILLS, refreshStorage, storageContents, withdrawItems } from './mcStorage';
import { SURVIVAL_SKILLS } from './mcSurvival';
import { at, checkAbort, goals, nearestBlocks, num, sleep, standableY, str, syncInventory, walk } from './mcUtil';

type Pos = [number, number, number];

interface Target {
  x: number;
  y: number;
  z: number;
  /** A block id ('air' to clear), optionally with states: "oak_stairs[facing=east]". */
  block: string;
  /** Outward direction for doors. */
  facing?: [number, number];
  /** Survival: placed only if the builder carries the block (the walkway in front of a door). */
  optional?: boolean;
}

interface Built extends Area {
  y: number;
  kind: string;
}

interface Plot extends Area {
  y: number;
}

const MAX_BUILD_BLOCKS = 2000;
const baseName = (b: string) => b.replace(/^minecraft:/, '').replace(/\[.*$/, '');

/** Plants, trees and snow: not ground. */
const NON_GROUND = /leaves|_log$|_wood$|_stem$|grass$|fern|flower|dandelion|poppy|tulip|orchid|allium|bluet|daisy|lilac|peony|rose_bush|sunflower|bush|sapling|^snow$|vine|mushroom|sugar_cane|bamboo|cactus|azalea|dripleaf|moss_carpet|leaf_litter|petals|cobweb/;
/** Ground as nature makes it (find_site counts anything else as built on). */
const NATURAL_GROUND = /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|mud|sand|red_sand|gravel|stone|deepslate|tuff|granite|diorite|andesite|calcite|snow_block|clay|moss_block|sandstone|red_sandstone|terracotta|.*_terracotta|packed_ice|ice)$/;
/** Blocks that occur in the wild: preparing a site may remove these, never anything built. */
const NATURAL = /^(stone|deepslate|tuff|granite|diorite|andesite|calcite|grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|mud|bedrock|water|lava|sand|red_sand|gravel|sandstone|red_sandstone|snow_block|snow|ice|packed_ice|clay|terracotta|.*_terracotta|moss_block|moss_carpet|mossy_cobblestone|cactus|sugar_cane|bamboo|dead_bush|short_grass|tall_grass|short_dry_grass|tall_dry_grass|fern|large_fern|bush|firefly_bush|leaf_litter|pumpkin|melon|vine|cobweb|.*_mushroom|.*_mushroom_block|mushroom_stem|dandelion|poppy|.*_tulip|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|lilac|peony|rose_bush|sunflower|pink_petals|wildflowers)$|_ore$|_log$|_wood$|_leaves$|_sapling$/;
const isLog = (n: string) => /_log$|_wood$|_stem$/.test(n);
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'];
/** A wooden item: its wood kind and part ("acacia", "planks"). */
const WOOD_ITEM = new RegExp(`^(${WOODS.join('|')})_(planks|log|wood|door|slab|stairs|fence|fence_gate|trapdoor|pressure_plate|button)$`);
const isLeaves = (n: string) => n.endsWith('_leaves');
const FACES: Pos[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// ---------------------------------------------------------------------------------------------
// Looking at the terrain
// ---------------------------------------------------------------------------------------------

interface Surface { y: number; block: string; liquid: boolean; trees: number }

function blockName(a: BotAgent, x: number, y: number, z: number): string | null {
  return a.bot.blockAt(new Vec3(x, y, z))?.name ?? null;
}

const LIQUID = /^(water|lava|bubble_column)$/;

/** The top of a column as a builder sees it: liquid, or the first solid non-plant block, plus tree blocks above it. */
function surfaceAt(a: BotAgent, x: number, z: number, yHint: number): Surface | null {
  const v = new Vec3(x, 0, z);
  let trees = 0;
  for (let y = yHint + 32; y > yHint - 48; y--) {
    const b = a.bot.blockAt(v.set(x, y, z));
    if (!b) return null; // not loaded
    if (b.name === 'air' || b.name === 'cave_air') continue;
    if (LIQUID.test(b.name) || b.getProperties?.().waterlogged === true && b.boundingBox === 'empty') return { y, block: b.name, liquid: true, trees };
    if (isLog(b.name) || isLeaves(b.name)) trees++;
    if (b.boundingBox === 'block' && !NON_GROUND.test(b.name)) return { y, block: b.name, liquid: false, trees };
  }
  // Loaded, but no ground within 48 blocks down: a ravine or a cave shaft (reported as far below the level, not as
  // unloaded: "walk closer" sent a worker standing beside the plot walking in circles)
  return { y: yHint - 48, block: 'air', liquid: false, trees };
}

/** The whole tree around a log or leaf block: its connected logs and the leaves around them (tree felling). */
function treeAt(a: BotAgent, x: number, y: number, z: number): Pos[] {
  const k = (p: Pos) => `${p[0]},${p[1]},${p[2]}`;
  const name = (p: Pos) => blockName(a, p[0], p[1], p[2]) ?? '';
  let start: Pos | null = isLog(name([x, y, z])) ? [x, y, z] : null;
  if (!start && isLeaves(name([x, y, z]))) {
    // Leaves are at most a few blocks from their trunk: search through them for a log
    const seen = new Set([k([x, y, z])]);
    let frontier: Pos[] = [[x, y, z]];
    for (let depth = 0; depth < 6 && frontier.length && !start; depth++) {
      const next: Pos[] = [];
      for (const p of frontier)
        for (const d of FACES) {
          const q: Pos = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
          if (seen.has(k(q))) continue;
          seen.add(k(q));
          const n = name(q);
          if (isLog(n)) {
            start = q;
            break;
          }
          if (isLeaves(n)) next.push(q);
        }
      frontier = next;
    }
  }
  if (!start) return [];
  const logs: Pos[] = [start];
  const checked = new Set([k(start)]);
  for (let i = 0; i < logs.length && logs.length < 300; i++)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const q: Pos = [logs[i][0] + dx, logs[i][1] + dy, logs[i][2] + dz];
          if (checked.has(k(q)) || Math.abs(q[0] - start[0]) > 8 || Math.abs(q[2] - start[2]) > 8) continue;
          checked.add(k(q));
          if (isLog(name(q))) logs.push(q);
        }
  // The leaves: a search of its own (the log search looked at the cells around each log, leaves included)
  const seen = new Set(logs.map(k));
  const leaves: Pos[] = [];
  let frontier = logs;
  for (let depth = 0; depth < 6 && frontier.length && leaves.length < 2000; depth++) {
    const next: Pos[] = [];
    for (const p of frontier)
      for (const d of FACES) {
        const q: Pos = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
        if (seen.has(k(q))) continue;
        seen.add(k(q));
        if (isLeaves(name(q))) next.push(q);
      }
    leaves.push(...next);
    frontier = next;
  }
  return [...logs, ...leaves];
}

// ---------------------------------------------------------------------------------------------
// Doing the work: commands, paced, with village reservations
// ---------------------------------------------------------------------------------------------

interface Job {
  targets: Target[];
  /** Ground reserved in the village while working (checked for conflicts first). */
  claim?: { area: Area; purpose: string; avoidStructures: boolean };
  /** Where to stand: the area worked on. */
  area: Area;
  y: number;
  /** Landscaping (prepare_site): never charged. */
  free?: boolean;
  /** What is being built, for messages ("the cottage"). */
  what?: string;
  /** The design (build_design): a short village build puts its task back on the board behind new gather tasks. */
  design?: string;
}

/**
 * A village build that is short of raw materials (some gathered wood went missing, say): post gather tasks for exactly
 * what is missing, put the build task back on the board behind them, and return what was withdrawn to the storage.
 * Returns what to tell the builder, or '' when the agent holds no such task.
 */
async function requeueBuild(a: BotAgent, job: Job, need: Counts, short: Counts, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const task = v && job.design ? v.tasks.find((t) => t.status === 'claimed' && t.claimedBy === a.name && t.detail.includes(`build_design "${job.design}"`)) : undefined;
  if (!v || !task) return '';
  const store = storageContents(v);
  // What is spare beyond the building's own blocks (the logs carried for its log corners are not plank material:
  // counting them, the requeue posted no log gathering and the build failed again)
  const other: Counts = { ...inventoryCounts(a) };
  for (const [n, q] of Object.entries(store)) other[n] = (other[n] ?? 0) + q;
  for (const [n, q] of Object.entries(need)) other[n] = Math.max(0, (other[n] ?? 0) - q);
  const plan = a.world.materials.plan(short, other);
  if (!Object.keys(plan.gather).length || plan.problems.length) return '';
  const reg = a.world.villages;
  const made = reg.post(v, gatherTasks(plan.gather, job.what?.replace(/^the /, '') ?? job.design!).map((t) => ({ ...t, soft: true })), a.name, 20);
  task.status = 'open';
  task.claimedBy = undefined;
  task.after = [...task.after, ...made.map((t) => t.id)];
  task.updated = Date.now();
  reg.note(v, `${task.id} "${task.title}" waits for ${made.map((t) => t.id).join(', ')}: materials were short`);
  // What this builder took from the storage goes back, for whoever builds it next
  await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch(() => undefined);
  return ` Posted ${made.map((t) => `${t.id} ${t.title}`).join('; ')} and put ${task.id} back on the board to wait for them; your part is done.`;
}

/** Survival builders pay for every block; creative builds free, and memory.buildMode "commands" too (tests). */
const charged = (a: BotAgent, job: Job) => !job.free && a.gamemode !== 'creative' && a.memory.buildMode !== 'commands';

function inventoryCounts(a: BotAgent): Counts {
  const out: Counts = {};
  for (const it of a.bot.inventory.items()) out[it.name] = (out[it.name] ?? 0) + it.count;
  return out;
}

/**
 * What the builder carries of these items, as the server counts it: Mineflayer's own view of the inventory has been
 * seen to drift after chest withdrawals (it showed 4 cobblestone where the server had 25).
 */
async function carriedCounts(a: BotAgent, items: string[]): Promise<Counts> {
  const out: Counts = {};
  for (const n of items) {
    const r = await a.world.rcon.command(`clear ${a.name} ${n} 0`);
    out[n] = Number(/Found (\d+)/i.exec(r)?.[1] ?? 0);
  }
  return out;
}

const listCounts = (c: Counts) => Object.entries(c).filter(([, q]) => q > 0).map(([n, q]) => `${q} ${n}`).join(', ');

/** Planks a wooden part costs per item (doors come three from six planks, slabs six from three). */
const PLANK_COST: Record<string, number> = { planks: 1, door: 2, slab: 0.5, stairs: 1.5, fence: 5 / 3, fence_gate: 4, trapdoor: 2, pressure_plate: 2, button: 1 };

/**
 * Builders place the wood they can get, part by part: log parts go to the kind with enough real logs, plank parts
 * (planks, doors, slabs...) to the kind with enough planks or logs left for them. One kind for the whole building
 * left 11 oak logs unused while the acacia ran out (log corners had taken 8 of 22 acacia logs). The design's own kind
 * wins ties. Returns "kind_part" -> kind to build it in.
 */
function chooseWood(place: Target[], have: Counts): Map<string, string> {
  const need = new Map<string, number>(); // "oak_planks" -> how many
  for (const t of place) {
    const m = WOOD_ITEM.exec(baseName(t.block));
    if (m) need.set(`${m[1]}_${m[2]}`, (need.get(`${m[1]}_${m[2]}`) ?? 0) + 1);
  }
  const logs: Counts = {}, planks: Counts = {};
  for (const k of WOODS) {
    logs[k] = (have[`${k}_log`] ?? 0) + (have[`${k}_wood`] ?? 0);
    planks[k] = have[`${k}_planks`] ?? 0;
  }
  const out = new Map<string, string>();
  const entries = [...need].map(([key, n]) => { const m = WOOD_ITEM.exec(key)!; return { key, kind: m[1], part: m[2], n }; });
  // Real logs first (planks cannot become logs), then the plank parts, biggest first
  for (const e of entries.filter((x) => x.part === 'log' || x.part === 'wood')) {
    let best = e.kind;
    for (const k of WOODS) if (logs[k] > logs[best] && (logs[best] < e.n)) best = k;
    logs[best] = Math.max(0, logs[best] - e.n);
    out.set(e.key, best);
  }
  for (const e of entries.filter((x) => x.part !== 'log' && x.part !== 'wood').sort((x, y) => y.n - x.n)) {
    const units = Math.ceil(e.n * (PLANK_COST[e.part] ?? 1));
    const supply = (k: string) => planks[k] + logs[k] * 4;
    let best = e.kind;
    for (const k of WOODS) if (supply(k) > supply(best) && supply(best) < units) best = k;
    const fromPlanks = Math.min(planks[best], units);
    planks[best] -= fromPlanks;
    logs[best] = Math.max(0, logs[best] - Math.ceil((units - fromPlanks) / 4));
    out.set(e.key, best);
  }
  return out;
}

function swapWood(block: string, woods: Map<string, string>): string {
  const m = WOOD_ITEM.exec(baseName(block));
  const k = m && woods.get(`${m[1]}_${m[2]}`);
  if (!m || !k || k === m[1]) return block;
  const i = block.indexOf('[');
  return `${k}_${m[2]}${i >= 0 ? block.slice(i) : ''}`;
}

/** Items the placing costs (a door is one item; optional blocks are not counted). */
function billOf(place: Target[]): Counts {
  const out: Counts = {};
  for (const t of place) {
    if (t.optional) continue;
    const item = chargedItem(t.block);
    out[item] = (out[item] ?? 0) + 1;
  }
  return out;
}

/** Why the builder cannot start (what is short, and how to get it), or null. */
function shortage(a: BotAgent, what: string, need: Counts, inv: Counts, store: Counts): string | null {
  const short: Counts = {};
  const lines: string[] = [];
  for (const [n, q] of Object.entries(need)) {
    const have = inv[n] ?? 0;
    if (have >= q) continue;
    short[n] = q - have;
    lines.push(`${q - have} ${n} (carrying ${have}, storage has ${store[n] ?? 0})`);
  }
  if (!lines.length) return null;
  // What else is in hand (logs, sand, ...) counts towards making them
  const other: Counts = { ...inv };
  for (const [n, q] of Object.entries(store)) other[n] = (other[n] ?? 0) + q;
  for (const n of Object.keys(need)) delete other[n];
  const plan = a.world.materials.plan(short, other);
  // Ingredients that are in storage rather than in hand have to be fetched first
  const fetch: Counts = {};
  for (const [n, q] of Object.entries(plan.fromStock)) {
    const f = Math.min(q, Math.max(0, q - (inv[n] ?? 0)), store[n] ?? 0);
    if (f > 0) fetch[n] = f;
  }
  const work = [Object.keys(fetch).length ? `withdraw ${listCounts(fetch)}` : '', describeWork(plan)].filter(Boolean).join('; ');
  return `short of materials for ${what}: ${lines.join(', ')}. To get them: ${work || 'gather them'}; then build again`;
}

/**
 * Make what is short from what is in hand and in the village storage: gatherers bring raw materials, the builder crafts
 * planks, doors and slabs and smelts glass (with a crafting table and a furnace, made too if there are none). Returns
 * what was made, or null when something still has to be gathered.
 */
async function makeFromStock(a: BotAgent, need: Counts, short: Counts, back: () => Promise<void>, signal: AbortSignal): Promise<string | null> {
  const v = a.village();
  const store = v ? storageContents(v) : {};
  const carried = inventoryCounts(a);
  // What is on hand beyond the building's own blocks (the cobblestone carried for the floor is not furnace material)
  const other: Counts = { ...carried };
  for (const [n, q] of Object.entries(store)) other[n] = (other[n] ?? 0) + q;
  for (const [n, q] of Object.entries(need)) other[n] = Math.max(0, (other[n] ?? 0) - q);
  const near = (n: string) => {
    const p = a.bot.entity.position;
    return !!a.bot.findBlock({ matching: a.world.registry.blocksByName[n].id, maxDistance: 16, useExtraInfo: (b) => Math.abs(b.position.y - p.y) <= 3 });
  };
  const bill: Counts = { ...short };
  let plan = a.world.materials.plan(bill, other);
  if (plan.fuel.smelts && !other.furnace && !near('furnace')) bill.furnace = 1;
  if (plan.steps.some((st) => st.do === 'craft' && !/_planks$|^any:planks$|^stick$/.test(st.item)) && !other.crafting_table && !near('crafting_table')) bill.crafting_table = 1;
  plan = a.world.materials.plan(bill, other);
  if (Object.keys(plan.gather).length || plan.problems.length) return null;
  // Ingredients kept in storage come to hand first
  const fetch: Counts = {};
  for (const [n, q] of Object.entries(plan.fromStock)) {
    const spare = Math.max(0, (carried[n] ?? 0) - (need[n] ?? 0));
    const f = Math.min(q - spare, store[n] ?? 0);
    if (f > 0) fetch[n] = f;
  }
  // A furnace or table kept in the storage comes along too (it was counted as there, then smelting found none)
  if (plan.fuel.smelts && !near('furnace') && !carried.furnace && store.furnace) fetch.furnace = 1;
  if (plan.steps.some((st) => st.do === 'craft' && !/_planks$|^any:planks$|^stick$/.test(st.item)) && !near('crafting_table') && !carried.crafting_table && store.crafting_table) fetch.crafting_table = 1;
  if (v && Object.keys(fetch).length) {
    await withdrawItems(a, v, fetch, signal);
    // Craft at the site, where the table and furnace were looked for
    await back();
  }
  // The table and the furnace first (smelting does not depend on the furnace in the recipe chain)
  const station = (st: { item: string }) => Number(!/^(crafting_table|furnace)$/.test(st.item));
  const steps = [...plan.steps].sort((x, y) => station(x) - station(y));
  const made: string[] = [];
  for (const st of steps) {
    checkAbort(signal);
    try {
      if (st.do === 'craft') await SURVIVAL_SKILLS.craft.run(a, { item: st.item === 'any:planks' ? 'planks' : st.item, count: st.makes }, signal);
      else {
        // "Any logs" (charcoal) is whichever kind is carried
        const input = st.input === 'any:cobblestone' ? 'cobblestone' : st.input === 'any:logs' ? a.bot.inventory.items().find((it) => /_log$/.test(it.name))?.name ?? 'oak_log' : st.input ?? '';
        await SURVIVAL_SKILLS.smelt.run(a, { item: input, count: st.runs }, signal);
      }
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      throw new Error(`could not ${st.do} ${st.makes} ${st.item.replace(/^any:/, '')} for the building (${(e as Error).message})`);
    }
    made.push(`${st.do === 'smelt' ? 'smelted' : 'crafted'} ${st.makes} ${st.item.replace(/^any:/, '')}`);
  }
  return made.length ? `made from storage: ${made.join(', ')}` : null;
}

/** Stand just south of the site (out of the way of the blocks), where it can be seen. */
async function standBy(a: BotAgent, job: Job, signal: AbortSignal) {
  const cx = Math.floor((job.area.x1 + job.area.x2) / 2), sz = job.area.z2 + 3;
  const sy = standableY(a, cx, job.y + 1, sz);
  const p = a.bot.entity.position;
  // Also out of the footprint itself: a builder standing inside was walled in by its own cottage
  const inside = p.x >= job.area.x1 - 1 && p.x < job.area.x2 + 2 && p.z >= job.area.z1 - 1 && p.z < job.area.z2 + 2;
  if (inside || Math.hypot(p.x - cx, p.z - sz) > 6)
    await walk(a, sy !== null ? new goals.GoalNear(cx, sy, sz, 2) : new goals.GoalNearXZ(cx, sz, 2), `the site at ${cx},${sz}`, signal, 90000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
}

/**
 * Whether a block is already what a target wants (by id; states such as door facing are not compared). With anyWood,
 * another wood kind of the same part counts (a survival build that swapped oak for acacia, resumed).
 */
function alreadyThere(a: BotAgent, t: Target, anyWood = false): boolean {
  const cur = blockName(a, t.x, t.y, t.z);
  if (cur === null) return false;
  if (t.block === 'air') return cur === 'air' || cur === 'cave_air' || LIQUID.test(cur);
  if (cur === baseName(t.block)) return true;
  const c = anyWood ? WOOD_ITEM.exec(cur) : null, w = c ? WOOD_ITEM.exec(baseName(t.block)) : null;
  return !!c && !!w && c[2] === w[2];
}

const DIR_NAMES: Record<string, string> = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' };

/**
 * Run a job: reserve its ground, stand by it, then clear (top-down) and place (bottom-up) with /fill and /setblock,
 * merging vertical runs of the same block. Returns the summary ("placed N blocks, cleared M; skipped ...").
 */
async function runJob(a: BotAgent, job: Job, signal: AbortSignal, felled = 0): Promise<string> {
  const pay = charged(a, job);
  const v = a.village();
  const reg = a.world.villages;
  let reservation: Reservation | undefined;
  if (job.claim && v) {
    const why = reg.conflict(v, job.claim.area, a.name, job.claim.avoidStructures);
    if (why) throw new Error(`cannot work at ${areaText(job.claim.area)}: ${why}; pick another spot (find_site avoids taken ground)`);
    reservation = reg.reserve(v, job.claim.area, a.name, job.claim.purpose);
  }
  const notes: string[] = [];
  try {
    await standBy(a, job, signal);
    // What is left to do, and in what order: clearing top-down, then placing bottom-up
    const todo = job.targets.filter((t) => !alreadyThere(a, t, pay));
    const clear = todo.filter((t) => t.block === 'air').sort((u, w) => w.y - u.y);
    let place = todo.filter((t) => t.block !== 'air').sort((u, w) => u.y - w.y || u.x - w.x || u.z - w.z);
    if (pay) {
      // Survival: have everything before starting, taking what is missing from the village storage
      await syncInventory(a);
      let store = v ? storageContents(v) : {};
      // The record looks short: look in the chests first (items put in or taken out by hand are not in the record)
      const rough = billOf(place);
      if (v?.storage?.chests.length && Object.entries(rough).some(([n, q]) => (store[n] ?? 0) + (inventoryCounts(a)[n] ?? 0) < q)) {
        await refreshStorage(a, v, signal);
        store = storageContents(v);
      }
      const all = inventoryCounts(a);
      for (const [n, q] of Object.entries(store)) all[n] = (all[n] ?? 0) + q;
      const woods = chooseWood(place, all);
      place = place.map((t) => ({ ...t, block: swapWood(t.block, woods) }));
      const swapped = [...woods].filter(([key, b]) => !key.startsWith(`${b}_`)).map(([key, b]) => `${b} for the ${key.replace(/_/g, ' ')}`);
      if (swapped.length) notes.push(`built with ${swapped.join(', ')}`);
      const need = billOf(place);
      let inv = await carriedCounts(a, Object.keys(need));
      const fetch: Counts = {};
      for (const [n, q] of Object.entries(need)) {
        const f = Math.min(q - (inv[n] ?? 0), store[n] ?? 0);
        if (f > 0) fetch[n] = f;
      }
      if (v && Object.keys(fetch).length) {
        const { got } = await withdrawItems(a, v, fetch, signal);
        if (Object.keys(got).length) notes.push(`took ${listCounts(got)} from storage`);
        await standBy(a, job, signal);
        inv = await carriedCounts(a, Object.keys(need));
      }
      let why = shortage(a, job.what ?? 'this', need, { ...inventoryCounts(a), ...inv }, v ? storageContents(v) : {});
      if (why) {
        // Short only of things that can be made from what is in hand and in storage: make them here
        const short: Counts = {};
        for (const [n, q] of Object.entries(need)) if ((inv[n] ?? 0) < q) short[n] = q - (inv[n] ?? 0);
        // A crafting step that fails (one log fewer than counted) falls through to the shortage below and the requeue
        const made = await makeFromStock(a, need, short, () => standBy(a, job, signal), signal).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
          notes.push(e.message);
          return 'partly made';
        });
        if (made) {
          notes.push(made);
          // Crafting planks uses whatever logs are carried, the ones fetched for log parts too: top up from storage
          inv = await carriedCounts(a, Object.keys(need));
          const again: Counts = {};
          const now = v ? storageContents(v) : {};
          for (const [n, q] of Object.entries(need)) {
            const f = Math.min(q - (inv[n] ?? 0), now[n] ?? 0);
            if (f > 0) again[n] = f;
          }
          if (v && Object.keys(again).length) await withdrawItems(a, v, again, signal);
          await standBy(a, job, signal);
          inv = await carriedCounts(a, Object.keys(need));
          why = shortage(a, job.what ?? 'this', need, { ...inventoryCounts(a), ...inv }, v ? storageContents(v) : {});
        }
      }
      if (why) {
        const left: Counts = {};
        for (const [n, q] of Object.entries(need)) if ((inv[n] ?? 0) < q) left[n] = q - (inv[n] ?? 0);
        // Short only of glass (no sand near the village): leave the windows open rather than fail the building
        if (Object.keys(left).every((n) => /^glass(_pane)?$/.test(n))) {
          place = place.map((t) => (/^glass(_pane)?$/.test(chargedItem(t.block)) ? { ...t, optional: true } : t));
          notes.push(`left ${Object.values(left).reduce((s, q) => s + q, 0)} windows open (no glass: no sand to make it)`);
        } else throw new Error(why + (await requeueBuild(a, job, need, left, signal)));
      }
    }
    // Merge vertical runs of one block in one column into a single /fill; `item` is what placing it costs
    type Cmd = { cmd: string; n: number; pos: Pos; clear: boolean; item?: string; optional?: boolean };
    const cmds: Cmd[] = [];
    const columns = (list: Target[], clearing: boolean) => {
      const byCol = new Map<string, Target[]>();
      for (const t of list) {
        if (/_door$/.test(baseName(t.block))) {
          const f = DIR_NAMES[`${t.facing?.[0] ?? 0},${t.facing?.[1] ?? 1}`] ?? 'south';
          cmds.push({ cmd: `setblock ${t.x} ${t.y} ${t.z} ${baseName(t.block)}[facing=${f},half=lower]`, n: 1, pos: [t.x, t.y, t.z], clear: false, item: baseName(t.block) });
          cmds.push({ cmd: `setblock ${t.x} ${t.y + 1} ${t.z} ${baseName(t.block)}[facing=${f},half=upper]`, n: 0, pos: [t.x, t.y + 1, t.z], clear: false });
          continue;
        }
        const k = `${t.x},${t.z},${t.block},${t.optional ? 1 : 0}`;
        if (!byCol.has(k)) byCol.set(k, []);
        byCol.get(k)!.push(t);
      }
      const runs: Array<{ x: number; z: number; y1: number; y2: number; block: string; optional?: boolean }> = [];
      for (const ts of byCol.values()) {
        const ys = ts.map((t) => t.y).sort((m, n) => m - n);
        const { x, z, block, optional } = ts[0];
        let y1 = ys[0], y2 = ys[0];
        for (const y of ys.slice(1)) {
          if (y === y2 + 1) y2 = y;
          else runs.push({ x, z, y1, y2, block, optional }), (y1 = y2 = y);
        }
        runs.push({ x, z, y1, y2, block, optional });
      }
      runs.sort((u, w) => (clearing ? w.y2 - u.y2 : u.y1 - w.y1));
      for (const r of runs)
        cmds.push({
          cmd: r.y1 === r.y2 ? `setblock ${r.x} ${r.y1} ${r.z} ${r.block}` : `fill ${r.x} ${r.y1} ${r.z} ${r.x} ${r.y2} ${r.z} ${r.block}`,
          n: r.y2 - r.y1 + 1, pos: [r.x, r.y1, r.z], clear: clearing, item: clearing ? undefined : chargedItem(r.block), optional: r.optional,
        });
    };
    columns(clear, true);
    columns(place, false);
    // Pace: memory.buildSpeed x 10 blocks a second, like the sandbox
    const speed = Math.max(0.25, Math.min(20, Number(a.memory.buildSpeed) || 1));
    let placed = 0, cleared = 0, budget = 0;
    const skipped = new Map<string, number>();
    const spent: Counts = {};
    let lastRenew = Date.now();
    let outOf = -1;
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      checkAbort(signal);
      while (budget <= 0) {
        await sleep(100, signal);
        budget += speed;
      }
      budget -= c.n;
      // Survival: take the blocks from the inventory first; running out stops the job (optional blocks are skipped)
      const cost = pay && c.item && c.n > 0 ? c.item : null;
      if (cost) {
        const r = await a.world.rcon.command(`clear ${a.name} ${cost} ${c.n}`);
        const got = Number(/Removed (\d+)/i.exec(r)?.[1] ?? 0);
        if (got < c.n) {
          if (got) await a.world.rcon.command(`give ${a.name} ${cost} ${got}`);
          if (c.optional) continue;
          outOf = i;
          break;
        }
      }
      a.bot.lookAt(new Vec3(c.pos[0] + 0.5, c.pos[1] + 0.5, c.pos[2] + 0.5)).catch(() => {});
      const out = await a.world.rcon.command(c.cmd);
      if (/^(Changed the block|Successfully filled)/i.test(out)) {
        if (c.clear) cleared += c.n;
        else placed += c.n;
        if (cost) spent[cost] = (spent[cost] ?? 0) + c.n;
      } else {
        if (cost) await a.world.rcon.command(`give ${a.name} ${cost} ${c.n}`); // not placed: give the blocks back
        if (!/Could not set the block|No blocks were filled/i.test(out)) {
          const why = /not loaded/i.test(out) ? 'in unloaded chunks' : `rejected (${out.slice(0, 60)})`;
          skipped.set(why, (skipped.get(why) ?? 0) + c.n);
        }
      }
      if (reservation && Date.now() - lastRenew > 30000) {
        reg.renew(reservation);
        lastRenew = Date.now();
      }
    }
    // The client hears about the changes a moment later
    await sleep(300, signal);
    if (outOf >= 0) {
      const left: Counts = {};
      for (const c of cmds.slice(outOf)) if (c.item && c.n > 0 && !c.optional) left[c.item] = (left[c.item] ?? 0) + c.n;
      throw new Error(`ran out of ${cmds[outOf].item} after placing ${placed} blocks; still needed: ${listCounts(left)}. Get them (withdraw from storage, or gather and craft), then run the same build again: it continues where it stopped`);
    }
    const sk = [...skipped].map(([why, n]) => `${n} ${why}`).join(', ');
    const used = pay && Object.keys(spent).length ? `; used ${listCounts(spent)}` : '';
    return `placed ${placed} blocks, cleared ${cleared}${felled ? ` (${felled} trees felled)` : ''}${used}${sk ? `; skipped ${sk}` : ''}${notes.length ? `; ${notes.join('; ')}` : ''}`;
  } finally {
    if (reservation && v) reg.release(v, reservation.id);
  }
}

/** Add a finished building to the agent's village, if it has one. */
function recordStructure(a: BotAgent, b: Built | null): string {
  const v = a.village();
  if (!v || !b) return '';
  const reg = a.world.villages;
  v.structures.push({ ...b, id: reg.id('s'), builtBy: a.name });
  reg.note(v, `${a.name} built a ${b.kind} at ${areaText(b)}`);
  return `${b.kind} recorded in village ${v.name} at ${areaText(b)}`;
}

function placeableBlock(a: BotAgent, name: string, what: string): string {
  if (!a.world.isPlaceable(baseName(name))) throw new Error(`${what} '${name}' is not a placeable block (try oak_planks, cobblestone, stone_bricks, glass)`);
  return name;
}

const int = (args: Record<string, unknown>, k: string) => Math.floor(num(args[k], k));
const size = (args: Record<string, unknown>, k: string, def: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.floor(args[k] !== undefined ? num(args[k], k) : def)));

// ---------------------------------------------------------------------------------------------
// find_site
// ---------------------------------------------------------------------------------------------

function searchSite(a: BotAgent, args: Record<string, unknown>, sz: number, cache: Map<string, Surface | null>): { done: string } | { fail: string } {
  const radius = Math.max(32, Math.min(64, args.radius !== undefined ? int(args, 'radius') : 48));
  const maxSlope = args.max_slope !== undefined ? num(args.max_slope, 'max_slope') : 2;
  const p = a.bot.entity.position;
  const ox = args.x !== undefined ? int(args, 'x') : Math.floor(p.x);
  const oz = args.z !== undefined ? int(args, 'z') : Math.floor(p.z);
  const col = (x: number, z: number) => {
    const k = `${x},${z}`;
    if (!cache.has(k)) cache.set(k, surfaceAt(a, x, z, Math.floor(p.y)));
    return cache.get(k)!;
  };
  const half = Math.floor(sz / 2);
  // In a village, stay off buildings (with a walkway around them) and ground other agents have reserved
  const v = a.village();
  const now = Date.now();
  const taken: Area[] = v
    ? [...v.structures.map((st) => ({ x1: st.x1 - 2, z1: st.z1 - 2, x2: st.x2 + 2, z2: st.z2 + 2 })), ...v.reservations.filter((r) => r.by !== a.name && r.until > now)]
    : [];
  // Survival: a village needs wood, so ground with trees within reach wins (a desert site had none within 128 blocks)
  const survival = a.gamemode !== 'creative';
  const logIds = survival ? a.world.registry.blocksArray.filter((b) => /^(?!stripped_).*_log$/.test(b.name)).map((b) => b.id) : [];
  const logs = survival ? nearestBlocks(a, logIds, 128, 4096) : [];
  const logsNear = (x: number, z: number) => logs.filter((q) => Math.hypot(q.x - x, q.z - z) <= 48).length;
  let best: { x: number; z: number; y: number; range: number; trees: number; score: number; wood: number } | null = null;
  let wet = 0, unloaded = 0, steep = 0, occupied = 0;
  for (let cx = ox - radius; cx <= ox + radius; cx += 2)
    next: for (let cz = oz - radius; cz <= oz + radius; cz += 2) {
      const dist = Math.hypot(cx - ox, cz - oz);
      if (dist > radius) continue;
      const fp = { x1: cx - half, z1: cz - half, x2: cx - half + sz - 1, z2: cz - half + sz - 1 };
      if (taken.some((t) => overlaps(fp, t))) {
        occupied++;
        continue;
      }
      let lo = 1e9, hi = -1e9, trees = 0, built = 0;
      const ys: number[] = [];
      for (let x = fp.x1; x <= fp.x2; x++)
        for (let z = fp.z1; z <= fp.z2; z++) {
          const c = col(x, z);
          if (!c) {
            unloaded++;
            continue next;
          }
          if (c.liquid) {
            wet++;
            continue next;
          }
          lo = Math.min(lo, c.y);
          hi = Math.max(hi, c.y);
          if (hi - lo > maxSlope) {
            steep++;
            continue next;
          }
          trees += c.trees;
          if (!NATURAL_GROUND.test(c.block)) built++;
          ys.push(c.y);
        }
      // Level ground matters most, then staying off existing builds, then fewer trees, then distance; in survival, no
      // trees at all within 48 blocks counts heavily against a site
      const wood = survival ? logsNear(cx, cz) : 0;
      const score = (hi - lo) * 6 + built * 3 + trees * 0.3 + dist * 0.1 + (survival && !wood ? 40 : 0);
      if (!best || score < best.score) {
        ys.sort((m, n) => m - n);
        best = { x: cx, z: cz, y: ys[ys.length >> 1], range: hi - lo, trees, score, wood };
      }
    }
  if (!best) {
    const why = [wet && `${wet} over water`, steep && `${steep} too steep`, occupied && `${occupied} taken by buildings or other agents`, unloaded && `${unloaded} not loaded yet`].filter(Boolean).join(', ');
    return { fail: `no dry, flat ${sz}x${sz} site within ${radius} blocks (candidates rejected: ${why}); explore in another direction and try again, or use a smaller size or larger max_slope` };
  }
  a.memory.lastSite = { x: best.x, y: best.y, z: best.z, size: sz };
  const b = best;
  if (v && a.memory.villageRole === 'mayor') a.world.villages.note(v, `${a.name} found a ${sz}x${sz} site centred at x=${b.x} z=${b.z} (ground y=${b.y})`);
  const plots = ((v ? v.plots : (a.memory.plots as Plot[] | undefined)) ?? []) as Plot[];
  const onPlot = plots.some((q) => q.y === b.y && b.x - half >= q.x1 && b.x - half + sz - 1 <= q.x2 && b.z - half >= q.z1 && b.z - half + sz - 1 <= q.z2);
  const ready = onPlot && b.range === 0 && b.trees === 0 ? ' It is on a prepared plot and already level and clear: build there directly, no prepare_site needed.' : '';
  const woodNote = survival ? (b.wood ? ` ${b.wood} log blocks within 48 blocks.` : ' No trees within 48 blocks: wood will have to come from farther away.') : '';
  return { done: `site found: centre x=${b.x} z=${b.z}, ground y=${b.y}, ${sz}x${sz}, height range ${b.range}, ${b.trees} tree blocks to clear, ${Math.round(Math.hypot(b.x - ox, b.z - oz))} blocks away.${woodNote}${ready}` };
}

async function findSite(a: BotAgent, args: Record<string, unknown>): Promise<string> {
  const sz = Math.max(3, Math.min(40, args.size !== undefined ? int(args, 'size') : 9));
  const cache = new Map<string, Surface | null>();
  const r = searchSite(a, args, sz, cache);
  if ('done' in r) return r.done;
  // Nothing that big: say what does fit, so the planner can scale the project instead of searching in circles.
  // Nearly as big counts as found (models ask for generous sizes, then explore forever looking for them).
  if (sz > 9)
    for (let s = sz - 2; s >= Math.max(9, Math.floor(sz / 2)); s -= 2) {
      const alt = searchSite(a, args, s, cache);
      if ('done' in alt) {
        const rest = alt.done.replace(/^site found: /, '');
        if (s >= sz * 0.6) return `site found (${s}x${s}, the largest near here; ${sz}x${sz} does not fit): ${rest} Plan the project to fit it.`;
        throw new Error(`${r.fail.split(';')[0]}. The largest nearby is smaller: ${rest} It is saved as the last site, so prepare_site defaults to it; plan the project to fit, or explore further`);
      }
    }
  throw new Error(r.fail);
}

// ---------------------------------------------------------------------------------------------
// prepare_site
// ---------------------------------------------------------------------------------------------

async function prepareSite(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const p = a.bot.entity.position;
  const last = a.memory.lastSite as { x: number; z: number } | undefined;
  const cx = args.x !== undefined ? int(args, 'x') : last?.x ?? Math.floor(p.x);
  const cz = args.z !== undefined ? int(args, 'z') : last?.z ?? Math.floor(p.z);
  const w = size(args, 'width', 9, 3, 32), d = size(args, 'depth', 9, 3, 32), m = size(args, 'margin', 2, 0, 4);
  const x0 = cx - Math.floor(w / 2), z0 = cz - Math.floor(d / 2), x1 = x0 + w - 1, z1 = z0 + d - 1;
  const surf = new Map<string, Surface>();
  for (let x = x0 - m; x <= x1 + m; x++)
    for (let z = z0 - m; z <= z1 + m; z++) {
      const c = surfaceAt(a, x, z, Math.floor(p.y));
      if (!c) throw new Error(`part of the area is not loaded; walk closer to x=${cx} z=${cz} first`);
      surf.set(`${x},${z}`, c);
    }
  // Level: the most common ground height on the plot itself (least digging and filling), unless given
  let y = args.y !== undefined ? int(args, 'y') : NaN;
  if (Number.isNaN(y)) {
    const counts = new Map<number, number>();
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const c = surf.get(`${x},${z}`)!;
        if (!c.liquid) counts.set(c.y, (counts.get(c.y) ?? 0) + 1);
      }
    if (!counts.size) throw new Error('the area is all water; use find_site to choose dry land');
    y = [...counts].sort((u, v) => v[1] - u[1] || u[0] - v[0])[0][0];
  }
  const targets: Target[] = [];
  const seen = new Set<string>();
  const add = (x: number, yy: number, z: number, block: string) => {
    const k = `${x},${yy},${z}`;
    if (!seen.has(k)) seen.add(k), targets.push({ x, y: yy, z, block });
  };
  let columns = 0, protectedCols = 0, felled = 0;
  const treeLogs = new Set<string>();
  for (let x = x0 - m; x <= x1 + m; x++)
    next: for (let z = z0 - m; z <= z1 + m; z++) {
      // Everything above the level goes, but columns with anything built in them are left alone
      const cut: number[] = [];
      for (let yy = y + 1; yy <= y + 32; yy++) {
        const n = blockName(a, x, yy, z) ?? 'air';
        if (n === 'air' || n === 'cave_air') continue;
        if (!NATURAL.test(n)) {
          protectedCols++;
          continue next;
        }
        cut.push(yy);
      }
      columns++;
      for (const yy of cut) {
        const n = blockName(a, x, yy, z)!;
        // Trees touching the plot are felled whole, so no canopy is left floating
        if ((isLog(n) || isLeaves(n)) && !treeLogs.has(`${x},${yy},${z}`)) {
          const tree = treeAt(a, x, yy, z);
          if (tree.length) felled++;
          for (const [tx, ty, tz] of tree) {
            treeLogs.add(`${tx},${ty},${tz}`);
            add(tx, ty, tz, 'air');
          }
        }
        add(x, yy, z, 'air');
      }
      // Fill low ground and shallow water up to the level
      const c = surf.get(`${x},${z}`)!;
      let g = c.y;
      if (c.liquid) {
        const box = (yy: number) => a.bot.blockAt(new Vec3(x, yy, z))?.boundingBox;
        while (g > y - 10 && box(g) !== 'block') g--;
      }
      if (y - g > 8) throw new Error(`the ground at ${x},${z} is ${y - g} blocks below the level (deep water or a ravine); choose a flatter site with find_site`);
      for (let yy = g + 1; yy < y; yy++) add(x, yy, z, 'dirt');
      const top = blockName(a, x, y, z) ?? 'air';
      const solidTop = a.bot.blockAt(new Vec3(x, y, z))?.boundingBox === 'block';
      if (top !== 'grass_block' && (g < y || top === 'dirt' || !solidTop)) add(x, y, z, 'grass_block');
    }
  if (!columns) throw new Error('the whole area is covered by existing buildings; use find_site to choose another spot');
  if (targets.length > 12000) throw new Error(`too much work (${targets.length} blocks, max 12000); prepare a smaller area`);
  const plot: Plot = { x1: x0, z1: z0, x2: x1, z2: z1, y };
  // Survival: the preparer keeps the logs of the trees it fells (the rest of the earth moving is free landscaping)
  const logs: Counts = {};
  for (const key of treeLogs) {
    const [tx, ty, tz] = key.split(',').map(Number);
    const n = blockName(a, tx, ty, tz);
    if (n && isLog(n)) logs[n] = (logs[n] ?? 0) + 1;
  }
  let summary = await runJob(a, {
    targets, area: plot, y, free: true,
    claim: { area: { x1: x0 - m, z1: z0 - m, x2: x1 + m, z2: z1 + m }, purpose: 'prepare a plot', avoidStructures: false },
  }, signal, felled);
  if (a.gamemode !== 'creative' && Object.keys(logs).length) {
    for (const [n, q] of Object.entries(logs)) await a.world.rcon.command(`give ${a.name} ${n} ${q}`);
    summary += `; kept ${listCounts(logs)} from the felled trees`;
  }
  const same = (q: Plot) => q.x1 === plot.x1 && q.z1 === plot.z1 && q.x2 === plot.x2 && q.z2 === plot.z2;
  const v = a.village();
  if (v) {
    const reg = a.world.villages;
    v.plots = v.plots.filter((q) => !same(q));
    v.plots.push({ ...plot, id: reg.id('plot'), preparedBy: a.name });
    reg.note(v, `${a.name} prepared a plot at ${areaText(plot)}`);
  } else a.memory.plots = [...((a.memory.plots as Plot[] | undefined) ?? []).filter((q) => !same(q)), plot].slice(-20);
  return `plot ready: ${w}x${d} centred at x=${cx} z=${cz}, level ground at y=${y} (x ${x0}..${x1}, z ${z0}..${z1}, plus a ${m}-block margin)${protectedCols ? `; left ${protectedCols} columns with existing buildings untouched` : ''}; ${summary}`;
}

// ---------------------------------------------------------------------------------------------
// build_design, build_box, build
// ---------------------------------------------------------------------------------------------

/**
 * Ground level for a building footprint, or throws why the site is not ready: unloaded, water, not level, trees or
 * rocks in the way (prepare it), or another building (go elsewhere).
 */
function readySite(a: BotAgent, area: Area, height: number, what: string): number {
  const w = area.x2 - area.x1 + 1, d = area.z2 - area.z1 + 1;
  const cx = area.x1 + Math.floor(w / 2), cz = area.z1 + Math.floor(d / 2);
  const prep = `run prepare_site x=${cx} z=${cz} width=${w + 2} depth=${d + 2} first`;
  const there = a.village()?.structures.find((st) => overlaps(area, st));
  if (there) {
    const same = there.kind === what.replace(/"/g, '') ? ' (the same design: if building it here was your task, it is already done)' : '';
    throw new Error(`a ${there.kind} built by ${there.builtBy} already stands at ${areaText(there)}${same}; otherwise pick a free spot on the plot`);
  }
  const py = Math.floor(a.bot.entity.position.y);
  const heights: number[] = [];
  let wet = 0;
  for (let x = area.x1; x <= area.x2; x++)
    for (let z = area.z1; z <= area.z2; z++) {
      const c = surfaceAt(a, x, z, py);
      if (!c) throw new Error(`the site is not loaded; walk closer to x=${cx} z=${cz}`);
      if (c.liquid) wet++;
      heights.push(c.y);
    }
  if (wet) throw new Error(`the ${w}x${d} site at x=${cx} z=${cz} has ${wet} columns of water or lava; use find_site to pick a dry spot`);
  heights.sort((m, n) => m - n);
  // A block-deep dip is fine: the building's floor layer fills it
  if (heights[heights.length - 1] - heights[0] > 1) throw new Error(`the ground is not level here (heights ${heights[0]}..${heights[heights.length - 1]}); ${prep}`);
  const y0 = heights[heights.length - 1];
  let blocked = 0, built = '';
  for (let x = area.x1; x <= area.x2; x++)
    for (let z = area.z1; z <= area.z2; z++)
      for (let y = y0 + 1; y < y0 + height; y++) {
        const b = a.bot.blockAt(new Vec3(x, y, z));
        if (!b || b.name === 'air' || b.boundingBox === 'empty') continue;
        blocked++;
        if (!NATURAL.test(b.name)) built ||= `${b.name} at ${x},${y},${z}`;
      }
  if (built) throw new Error(`the site overlaps an existing structure (${built}); choose another site with find_site`);
  if (blocked) throw new Error(`${blocked} blocks (trees or rocks) stand where the ${what} would go; ${prep}`);
  return y0;
}

async function buildDesign(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const name = str(args.design, 'design').toLowerCase();
  const lib = a.village()?.designs ?? (a.memory.designs as Record<string, Design> | undefined) ?? {};
  const d = lib[name];
  if (!d) {
    const names = Object.keys(lib);
    throw new Error(`no design called "${name}"${names.length ? ` (available: ${names.map((n) => `"${n}"`).join(', ')})` : ''}; if it is not drawn yet, draw it first with design_building name="${name}" and a short brief, then build it`);
  }
  const rot = (((Math.round(Number(args.rotate ?? 0) / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const W = rot % 2 ? d.depth : d.width, D = rot % 2 ? d.width : d.depth;
  const p = a.bot.entity.position;
  const cx = args.x !== undefined ? int(args, 'x') : Math.floor(p.x);
  const cz = args.z !== undefined ? int(args, 'z') : Math.floor(p.z);
  const area = { x1: cx - Math.floor(W / 2), z1: cz - Math.floor(D / 2), x2: cx - Math.floor(W / 2) + W - 1, z2: cz - Math.floor(D / 2) + D - 1 };
  // Asked to build what already stands there (e.g. a task someone else finished): that is done, not a failure
  const same = a.village()?.structures.find((st) => st.kind === d.name && overlaps(area, st));
  if (same) return `a ${d.name} built by ${same.builtBy} already stands at ${areaText(same)}, so this is already done`;
  // A build stopped part-way (out of materials) continues at the same level: its own walls would fail the site checks
  const key = `${d.name}@${cx},${cz},${rot}`;
  const pending = (a.memory.pendingBuilds ?? {}) as Record<string, number>;
  const y0 = pending[key] ?? readySite(a, area, d.height, `"${d.name}"`);
  // Design column i (west to east) and row j (north to south), turned clockwise rot times
  const turn = (i: number, j: number): [number, number] => {
    let [u, v, w, h] = [i, j, d.width, d.depth];
    for (let r = 0; r < rot; r++) [u, v, w, h] = [h - 1 - v, u, h, w];
    return [u, v];
  };
  const targets: Target[] = [];
  const doors: Array<[number, number, [number, number]]> = [];
  d.layers.forEach((layer, li) =>
    layer.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '_') continue;
        const block = ch === '.' ? 'air' : d.palette[ch];
        const [ox, oz] = turn(i, j);
        const x = area.x1 + ox, z = area.z1 + oz;
        let facing: [number, number] | undefined;
        if (/_door$/.test(baseName(block))) {
          facing = ox === 0 ? [-1, 0] : ox === W - 1 ? [1, 0] : oz === 0 ? [0, -1] : [0, 1];
          // A door is placed whole from its lower half; the layer above it stays as the design says
          if (targets.some((t) => t.x === x && t.z === z && t.y === y0 + li - 1 && /_door$/.test(baseName(t.block)))) continue;
          if (li === 1) doors.push([x, z, facing]);
        }
        targets.push({ x, y: y0 + li, z, block, facing });
      }
    }),
  );
  // The upper half of each door is part of the door: do not clear or overwrite it
  const doorTops = new Set(targets.filter((t) => /_door$/.test(baseName(t.block))).map((t) => `${t.x},${t.y + 1},${t.z}`));
  const work = targets.filter((t) => !doorTops.has(`${t.x},${t.y},${t.z}`));
  // Keep the way out clear in front of each outside door
  for (const [x, z, [fx, fz]] of doors)
    for (let i = 1; i <= 2; i++) {
      const wx = x + fx * i, wz = z + fz * i;
      if (a.bot.blockAt(new Vec3(wx, y0, wz))?.boundingBox !== 'block') work.push({ x: wx, y: y0, z: wz, block: 'dirt', optional: true });
      for (let y = y0 + 1; y <= y0 + 3; y++) work.push({ x: wx, y, z: wz, block: 'air' });
    }
  if (work.length > 60000) throw new Error(`too big (${work.length} blocks, max 60000)`);
  a.memory.pendingBuilds = { ...pending, [key]: y0 };
  const summary = await runJob(a, {
    targets: work, area, y: y0, what: `the ${d.name}`, design: d.name,
    claim: { area: { x1: area.x1 - 1, z1: area.z1 - 1, x2: area.x2 + 1, z2: area.z2 + 1 }, purpose: `build a ${d.name}`, avoidStructures: true },
  }, signal).catch((e: Error) => {
    // A fresh build that placed nothing (short of materials, site taken) gets the site checks again next time
    if (pending[key] === undefined && !/^ran out of/.test(e.message)) delete (a.memory.pendingBuilds as Record<string, number>)[key];
    throw e;
  });
  delete (a.memory.pendingBuilds as Record<string, number>)[key];
  const rec = recordStructure(a, { ...area, y: y0, kind: d.name });
  return rec ? `${rec}; ${summary}` : summary;
}

async function buildBox(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const block = str(args.block, 'block');
  if (block !== 'air') placeableBlock(a, block, 'block');
  const [x1, x2] = [Math.min(int(args, 'x1'), int(args, 'x2')), Math.max(int(args, 'x1'), int(args, 'x2'))];
  const [y1, y2] = [Math.min(int(args, 'y1'), int(args, 'y2')), Math.max(int(args, 'y1'), int(args, 'y2'))];
  const [z1, z2] = [Math.min(int(args, 'z1'), int(args, 'z2')), Math.max(int(args, 'z1'), int(args, 'z2'))];
  if ((x2 - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1) > MAX_BUILD_BLOCKS) throw new Error(`box too big (max ${MAX_BUILD_BLOCKS} blocks)`);
  const hollow = !!args.hollow;
  const targets: Target[] = [];
  for (let x = x1; x <= x2; x++)
    for (let y = y1; y <= y2; y++)
      for (let z = z1; z <= z2; z++) {
        const shell = x === x1 || x === x2 || y === y1 || y === y2 || z === z1 || z === z2;
        targets.push({ x, y, z, block: hollow && !shell ? 'air' : block });
      }
  const area = { x1, z1, x2, z2 };
  const summary = await runJob(a, { targets, area, y: y1, what: `the ${block} box`, claim: { area, purpose: `build_box ${block}`, avoidStructures: false } }, signal);
  const placedSome = !/^placed 0 /.test(summary);
  const rec = block !== 'air' && placedSome ? recordStructure(a, { ...area, y: y1, kind: typeof args.label === 'string' && args.label ? args.label : `${block} box` }) : '';
  return rec ? `${rec}; ${summary}` : summary;
}

const STRUCTURES = ['hut', 'house', 'platform', 'wall'];
const SIDES: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

/** The y of the highest ground block (ignoring trees and plants) in a column. */
function groundY(a: BotAgent, x: number, z: number, y0: number): number {
  return surfaceAt(a, x, z, y0)?.y ?? y0 - 1;
}

async function buildStructure(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const kind = str(args.structure, 'structure');
  if (!STRUCTURES.includes(kind)) throw new Error(`unknown structure ${kind}. Options: ${STRUCTURES.join(', ')}`);
  const material = placeableBlock(a, typeof args.material === 'string' ? args.material : 'oak_planks', 'material');
  const roof = placeableBlock(a, typeof args.roof === 'string' ? args.roof : material, 'roof');
  const floor = placeableBlock(a, typeof args.floor === 'string' ? args.floor : kind === 'platform' ? material : 'cobblestone', 'floor');
  const p = a.bot.entity.position;
  const py = Math.floor(p.y);
  const cx = args.x !== undefined ? int(args, 'x') : Math.floor(p.x) + 6;
  const cz = args.z !== undefined ? int(args, 'z') : Math.floor(p.z);
  const targets: Target[] = [];
  const add = (x: number, y: number, z: number, block: string, facing?: [number, number]) => targets.push({ x, y, z, block, facing });

  if (kind === 'wall') {
    const [dx, dz] = SIDES[String(args.direction ?? 'east')] ?? SIDES.east;
    const len = size(args, 'length', 8, 1, 32), h = size(args, 'height', 3, 1, 5);
    for (let i = 0; i < len; i++) {
      const x = cx + dx * i, z = cz + dz * i;
      const g = groundY(a, x, z, py);
      for (let y = g + 1; y <= g + h; y++) add(x, y, z, material);
    }
    const area = { x1: Math.min(cx, cx + dx * (len - 1)), z1: Math.min(cz, cz + dz * (len - 1)), x2: Math.max(cx, cx + dx * (len - 1)), z2: Math.max(cz, cz + dz * (len - 1)) };
    const y = groundY(a, cx, cz, py);
    const summary = await runJob(a, { targets, area, y, claim: { area, purpose: 'build a wall', avoidStructures: true } }, signal);
    const rec = recordStructure(a, { ...area, y, kind: 'wall' });
    return rec ? `${rec}; ${summary}` : summary;
  }

  const w = size(args, 'width', kind === 'house' ? 7 : 5, 3, 11), d = size(args, 'depth', kind === 'house' ? 7 : 5, 3, 11);
  const h = kind === 'platform' ? 0 : size(args, 'height', kind === 'house' ? 4 : 3, 2, 5);
  const x0 = cx - Math.floor(w / 2), z0 = cz - Math.floor(d / 2);
  const x1 = x0 + w - 1, z1 = z0 + d - 1;
  let wet = 0;
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (surfaceAt(a, x, z, py)?.liquid) wet++;
  if (wet) throw new Error(`the ${w}x${d} site at x=${cx} z=${cz} has ${wet} columns of water or lava; use find_site (size ${Math.max(w, d) + 2}) to pick a dry spot`);
  // Floor level: the median ground height over the footprint, so a sloped site is partly dug in, partly raised
  const ground = new Map<string, number>();
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) ground.set(`${x},${z}`, groundY(a, x, z, py));
  const heights = [...ground.values()].sort((m, n) => m - n);
  const level = heights[heights.length - 1] - heights[0] <= 1 && kind !== 'platform' ? heights[heights.length - 1] : heights[heights.length >> 1];
  // A build stopped part-way (out of materials) continues at the same level, without the site checks
  const key = `${kind}@${cx},${cz}`;
  const pending = (a.memory.pendingBuilds ?? {}) as Record<string, number>;
  const y0 = args.y !== undefined ? int(args, 'y') : pending[key] ?? level;
  // Houses and huts go on prepared ground: level, with nothing standing where the building will be
  if (kind !== 'platform' && pending[key] === undefined) {
    const prep = `run prepare_site x=${cx} z=${cz} width=${w + 2} depth=${d + 2} first`;
    if (heights[heights.length - 1] - heights[0] > 1) throw new Error(`the ground is not level here (heights ${heights[0]}..${heights[heights.length - 1]}); ${prep}`);
    let blocked = 0, built = '';
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        for (let y = y0 + 1; y <= y0 + h + 1; y++) {
          const b = a.bot.blockAt(new Vec3(x, y, z));
          if (!b || b.name === 'air' || b.boundingBox === 'empty') continue;
          blocked++;
          if (!NATURAL.test(b.name)) built ||= `${b.name} at ${x},${y},${z}`;
        }
    if (built) throw new Error(`the site overlaps an existing structure (${built}); choose another site with find_site`);
    if (blocked) throw new Error(`${blocked} blocks (trees or rocks) stand where the ${kind} would go; ${prep}`);
  }
  // Door on the side facing the agent unless told otherwise
  const side = typeof args.door === 'string' && SIDES[args.door] ? args.door
    : Math.abs(p.x - cx) > Math.abs(p.z - cz) ? (p.x > cx ? 'east' : 'west') : p.z > cz ? 'south' : 'north';
  const [sdx, sdz] = SIDES[side];
  const doorX = sdx ? (sdx > 0 ? x1 : x0) : cx, doorZ = sdz ? (sdz > 0 ? z1 : z0) : cz;
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      for (let y = ground.get(`${x},${z}`)! + 1; y < y0; y++) add(x, y, z, floor); // raise low ground to the floor
      add(x, y0, z, floor);
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      for (let y = y0 + 1; y <= y0 + h + 2; y++) {
        const rel = y - y0;
        if (kind === 'platform' || rel > h + 1) add(x, y, z, 'air');
        else if (rel === h + 1) add(x, y, z, roof);
        else if (!edge) add(x, y, z, 'air');
        else if (x === doorX && z === doorZ && rel <= 2) {
          if (rel === 1) add(x, y, z, 'oak_door', [sdx, sdz]); // the upper half comes with it
        } else {
          const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
          const mid = x === x0 || x === x1 ? z === cz : x === cx;
          add(x, y, z, !corner && mid && rel === 2 && w >= 5 && d >= 5 ? 'glass' : material);
        }
      }
    }
  // Keep the way out clear: two blocks of walkway in front of the door, with ground under them
  if (kind !== 'platform')
    for (let i = 1; i <= 2; i++) {
      const x = doorX + sdx * i, z = doorZ + sdz * i;
      if (a.bot.blockAt(new Vec3(x, y0, z))?.boundingBox !== 'block') targets.push({ x, y: y0, z, block: floor, optional: true });
      for (let y = y0 + 1; y <= y0 + 3; y++) add(x, y, z, 'air');
    }
  if (targets.length > MAX_BUILD_BLOCKS) throw new Error(`too big (${targets.length} blocks, max ${MAX_BUILD_BLOCKS})`);
  const area = { x1: x0, z1: z0, x2: x1, z2: z1 };
  if (kind !== 'platform') a.memory.pendingBuilds = { ...pending, [key]: y0 };
  const summary = await runJob(a, { targets, area, y: y0, what: `the ${kind}`, claim: { area: { x1: x0 - 1, z1: z0 - 1, x2: x1 + 1, z2: z1 + 1 }, purpose: `build a ${kind}`, avoidStructures: true } }, signal).catch((e: Error) => {
    if (pending[key] === undefined && !/^ran out of/.test(e.message)) delete (a.memory.pendingBuilds as Record<string, number> | undefined)?.[key];
    throw e;
  });
  delete (a.memory.pendingBuilds as Record<string, number> | undefined)?.[key];
  const rec = recordStructure(a, { ...area, y: y0, kind });
  return rec ? `${rec}; ${summary}` : summary;
}

const box = (x: Record<string, unknown>) => ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].forEach((k) => num(x[k], k));

export const BUILD_SKILLS: Record<string, McSkill> = {
  find_site: { run: (a, args) => findSite(a, args) },
  prepare_site: { run: prepareSite },
  build_design: { check: (x) => (str(x.design, 'design'), num(x.x, 'x'), num(x.z, 'z')), run: buildDesign },
  build_box: { check: (x) => (box(x), str(x.block, 'block')), run: buildBox },
  build: { check: (x) => void str(x.structure, 'structure'), run: buildStructure },
};

