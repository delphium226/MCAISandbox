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
import type { Area, Design, Reservation, Structure, Village } from '../village';
import { MINE_SUPPORT, inIronLevel, ironTrip, mineAreas, mineFacesGoing, nearMineFace } from './mcMine';
import { teleportHome } from './mcRescue';
import { FARM_TRIP_RANGE, PARTS_MAKE, SCOUT_RANGE, STATION_NAMES, STATIONS_TASK, VILLAGE_RANGE, areaText, overlaps, partClaim, preparedAt, signCall, signTask, villageHome, type StationName } from '../village';
import { EGGS, PEN_KINDS, PEN_ORDER, SLOT_KINDS, SLOT_ORDER, annexCandidates, annexSlots, penPlan, slotCell, slotPlan, worksFurnaces, type Side } from '../farmSlots';
import { FOOD_GOODS, MAKE_GOODS, WORKS_FURNACES, WORKS_TABLE_RANGE, holdKey, holdsRelease, lightCarried, makeBill, makeHolds, makeLeft, worksBusy } from './mcWorkshop';
import { doorOutward, outsideCells, turnState } from '../designs';
import { holdsSign, holdsStandingTorch, holdsTorch, placedDoor, type SignSpot } from '../streetPlan';
import { MINING_HUT, STORAGE_HUT, STORAGE_HUT_STATIONS } from '../huts';
import type { LightPart } from './mcWorld';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { WOODS, chargedItem, describeWork, gatherTasks, woodName, woodPart, type Counts } from './mcMaterials';
import { STORAGE_SKILLS, holdingStorageTask, refreshStorage, storageContents, withdrawItems } from './mcStorage';
import { SURVIVAL_SKILLS, STATION_REACH, holdVillageFurnace, placeStation, recordStation, stationNear, stationSpot, stationsReady, villageStation, villageStationCell } from './mcSurvival';
import { ContentionError, at, checkAbort, goals, nearestBlocks, num, onVillageGround, reach, sleep, standableY, stateAt, str, syncInventory, unmoved, walk } from './mcUtil';
import { atlasSites } from './mcSiteAtlas';
import { taskCalls } from '../taskBrain';
import { BUILD_ISLOG, LIQUID, NATURAL, NATURAL_GROUND, NON_GROUND, TOOL, TREE_LOG, waterloggedEmpty } from './mcBlocks';
import { timeScale } from './mcRules';
import { GROW, GROW_FARMS, housesOf, taskNum, type PadOption } from '../grow';
import { APPETITE, FOOD_POINTS, appetiteOn, chooseMeal, holdMeal, noteFood, releaseMeal, stateOf, storeForMeals } from '../appetite';
import { postLayout } from '../layout';
import { CHOOSE } from '../choose';

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
  /** Block entity data set with it (a sign's text): one setblock of its own, never merged into a run. */
  nbt?: string;
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

// The block lists (mcBlocks.ts, from vanilla's tags): NON_GROUND, plants, trees and snow that are not ground;
// NATURAL_GROUND, ground as nature makes it (find_site counts anything else as built on); NATURAL, blocks that occur in
// the wild (preparing a site may remove these, never anything built); isLog, a tree's logs (no stripped logs or wood)
const isLog = (n: string) => BUILD_ISLOG.has(n);
const isLeaves = (n: string) => n.endsWith('_leaves');
const FACES: Pos[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// ---------------------------------------------------------------------------------------------
// Looking at the terrain
// ---------------------------------------------------------------------------------------------

interface Surface { y: number; block: string; liquid: boolean; trees: number }

function blockName(a: BotAgent, x: number, y: number, z: number): string | null {
  return a.bot.blockAt(new Vec3(x, y, z))?.name ?? null;
}

/**
 * Per-state classes for surfaceAt (one table per registry): 1 air, 2 liquid, 4 a tree block, 8 ground, and each state's
 * block name. surfaceAt read every cell through blockAt, a Block object built per cell: find_site's survey took two
 * thirds of the agent server's CPU in E.1's 25-bot probe (lesson 53's cost, in the one scan it had not reached).
 */
const S_AIR = 1, S_LIQUID = 2, S_TREE = 4, S_GROUND = 8;
const surfaceTables = new WeakMap<object, { cls: Uint8Array; name: string[] }>();
function surfaceTable(a: BotAgent) {
  const reg = a.world.registry;
  let t = surfaceTables.get(reg);
  if (!t) {
    const n = reg.blocksArray.reduce((m, b) => Math.max(m, b.maxStateId + 1), 0);
    t = { cls: new Uint8Array(n), name: new Array<string>(n) };
    for (const b of reg.blocksArray) {
      // (kelp and seagrass are water too: their box is empty and they carry no waterlogged state, so a lake whose kelp
      // reached the surface read as dry ground at the seabed, T.3 review)
      const logged = LIQUID.has(b.name) ? null : waterloggedEmpty(b);
      const base = (b.name === 'air' || b.name === 'cave_air' ? S_AIR : 0) | (LIQUID.has(b.name) ? S_LIQUID : 0)
        | (isLog(b.name) || isLeaves(b.name) ? S_TREE : 0) | (b.boundingBox === 'block' && !NON_GROUND.has(b.name) ? S_GROUND : 0);
      for (let s = b.minStateId; s <= b.maxStateId; s++) {
        t.cls[s] = base | (logged?.(s) ? S_LIQUID : 0);
        t.name[s] = b.name;
      }
    }
    surfaceTables.set(reg, t);
  }
  return t;
}

/** The top of a column as a builder sees it: liquid, or the first solid non-plant block, plus tree blocks above it. */
function surfaceAt(a: BotAgent, x: number, z: number, yHint: number): Surface | null {
  const { cls, name } = surfaceTable(a);
  let trees = 0;
  // Ground higher than the window read as solid at its top cell: flat, treeless ground at yHint + 32 (F88: "ground
  // y=101, height range 0, 0 tree blocks" on a wooded hill at y 119). Start above the column's top instead
  const game = a.bot.game as unknown as { minY?: number; height?: number };
  const top = (game.minY ?? -64) + (game.height ?? 384) - 1;
  let start = yHint + 32;
  for (;;) {
    const s = stateAt(a, x, start, z);
    if (s < 0) return null; // not loaded
    if (name[s] === 'air' || start >= top) break;
    start = Math.min(top, start + 16);
  }
  for (let y = start; y > yHint - 48; y--) {
    const s = stateAt(a, x, y, z);
    if (s < 0) return null; // not loaded
    const c = cls[s];
    if (c & S_AIR) continue;
    if (c & S_LIQUID) return { y, block: name[s], liquid: true, trees };
    if (c & S_TREE) trees++;
    if (c & S_GROUND) return { y, block: name[s], liquid: false, trees };
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
  claim?: { area: Area; purpose: string; avoidStructures: boolean; ignore?: (s: Structure) => boolean };
  /** Where to stand: the area worked on. */
  area: Area;
  y: number;
  /** Landscaping (prepare_site): never charged. */
  free?: boolean;
  /** What is being built, for messages ("the cottage"). */
  what?: string;
  /** The design (build_design): a short village build puts its task back on the board behind new gather tasks. */
  design?: string;
  /** Another kind of village task that does the same when short (light_streets): its detail's first call. */
  task?: string;
}

/**
 * A village build that is short of raw materials (some gathered wood went missing, say): post gather tasks for exactly
 * what is missing, put the build task back on the board behind them, and return what was withdrawn to the storage.
 * Returns what to tell the builder, or '' when the agent holds no such task.
 */
async function requeueBuild(a: BotAgent, job: Job, need: Counts, short: Counts, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const mine = (d: string) => (job.task ? d === job.task || d.startsWith(`${job.task} `) : !!job.design && d.includes(`build_design "${job.design}"`));
  const task = v && (job.task || job.design) ? v.tasks.find((t) => t.status === 'claimed' && t.claimedBy === a.name && mine(t.detail)) : undefined;
  if (!v || !task) return '';
  const store = storageContents(v);
  // What is spare beyond the building's own blocks (the logs carried for its log corners are not plank material:
  // counting them, the requeue posted no log gathering and the build failed again)
  const other: Counts = { ...inventoryCounts(a) };
  for (const [n, q] of Object.entries(store)) other[n] = (other[n] ?? 0) + q;
  for (const [n, q] of Object.entries(need)) other[n] = Math.max(0, (other[n] ?? 0) - q);
  const plan = a.world.materials.plan(short, other);
  // Not what no one can find near the village (sand for glass: the windows stay open when only glass is short)
  for (const n of v.unavailable ?? []) delete plan.gather[n];
  if (!Object.keys(plan.gather).length || plan.problems.length) return '';
  // A log spare (a second requeue for one log happened), of any kind: the builder splits a part across kinds, and the
  // village's own kind may be what ran short near here
  const logKey = Object.keys(plan.gather).find((n) => /_log$|^any:logs$/.test(n));
  if (logKey) plan.gather[logKey] += 1;
  const reg = a.world.villages;
  const made = reg.post(v, gatherTasks(plan.gather, job.what?.replace(/^the /, '') ?? job.design ?? 'the work').map((t) => ({ ...t, soft: true })), a.name, 20);
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
  // (a lost answer is not 0: runJob settles its charges against these counts, E.1)
  for (const n of items) out[n] = await a.world.rcon.count(a.name, n);
  return out;
}

const listCounts = (c: Counts) => Object.entries(c).filter(([, q]) => q > 0).map(([n, q]) => `${q} ${n}`).join(', ');

/**
 * At a build shortfall, the storage record for the short items set against what the server says the chests hold (S.0:
 * did the record lose items, or was the village really short?). Read in the background with quietCommand, each chest
 * only while RCON has nothing else to do, so the agents' commands are not held up; each chest's record is taken at its
 * reply, so deposits made between the reads count on both sides (one still in progress can differ for a moment). The
 * storage record at the shortfall itself is given as well.
 */
function logShortfall(a: BotAgent, v: Village | undefined, what: string, need: Counts, carried: Counts, left: Counts) {
  const items = Object.keys(left);
  const atShort = v ? storageContents(v) : {};
  const chests = (v?.storage?.chests ?? []).map((c) => ({ x: c.x, y: c.y, z: c.z }));
  void (async () => {
    const record: Counts = {};
    const onServer: Counts = {};
    let unread = 0;
    for (const c of chests) {
      const r = await a.world.rcon.quietCommand(`data get block ${c.x} ${c.y} ${c.z} Items`).catch(() => '');
      // (an empty chest has no Items: "Found no elements matching Items")
      if (!/following block data|no elements/i.test(r)) { unread++; continue; }
      const kept = v?.storage?.chests.find((q) => q.x === c.x && q.y === c.y && q.z === c.z)?.items ?? {};
      for (const n of items) record[n] = (record[n] ?? 0) + (kept[n] ?? 0);
      for (const m of r.matchAll(/\{([^{}]*)\}/g)) {
        const id = /id: "minecraft:([a-z0-9_]+)"/.exec(m[1])?.[1];
        if (id && items.includes(id)) onServer[id] = (onServer[id] ?? 0) + Number(/count: (\d+)/.exec(m[1])?.[1] ?? 1);
      }
    }
    const each = items.map((n) => `${n} need ${need[n] ?? 0}, carried ${carried[n] ?? 0}, storage record ${atShort[n] ?? 0} at the shortfall, `
      + `${record[n] ?? 0} as each chest was read, chests on the server ${onServer[n] ?? 0}`);
    console.log(`[shortfall] ${a.name} short for ${what}: ${each.join('; ')}${unread ? ` (${unread} of ${chests.length} chests not read; both sides leave them out)` : ''}`);
  })();
}

/** Planks per crafting batch and items it makes, for a wooden part (6 planks make 3 doors; sticks at half a plank). */
const PLANK_BATCH: Record<string, [number, number]> = {
  planks: [1, 1], door: [6, 3], slab: [3, 6], stairs: [6, 4], fence: [5, 3], fence_gate: [4, 1], trapdoor: [6, 2], pressure_plate: [2, 1], button: [1, 1],
  // (6 planks and a stick make 3 signs)
  sign: [7, 3], wall_sign: [7, 3],
};
const plankUnits = (part: string, n: number) => { const [p, out] = PLANK_BATCH[part] ?? [1, 1]; return Math.ceil(n / out) * p; };
/** How many of a part `units` planks make, in whole batches. */
const partsFrom = (part: string, units: number) => { const [p, out] = PLANK_BATCH[part] ?? [1, 1]; return Math.floor(units / p) * out; };

/** Wood kinds for one part, in placing order: "oak_planks" -> [{kind: acacia, n: 30}, {kind: oak, n: 10}]. */
type WoodPlan = Map<string, Array<{ kind: string; n: number }>> & { short?: boolean };

/**
 * Builders place the wood they can get, part by part: log parts first (planks cannot become logs), then plank parts
 * (planks, doors, slabs...) biggest first. Each part goes to one kind when one has enough: the village's own kind,
 * then the design's, then the most plentiful. When none has enough alone the part is split across kinds, in placing
 * order (bottom up, so the change is a layer): one kind per part left a building 4 logs short with 6 oak and 6 acacia
 * logs in stock. Costs are in whole crafting batches (a door takes 6 planks, not 2).
 */
function chooseWood(place: Target[], have: Counts, prefer?: string): WoodPlan {
  const need = new Map<string, number>(); // "oak_planks" -> how many
  for (const t of place) {
    const m = woodPart(baseName(t.block));
    if (m) need.set(woodName(m.kind, m.part), (need.get(woodName(m.kind, m.part)) ?? 0) + 1);
  }
  const logs: Counts = {}, planks: Counts = {};
  for (const k of WOODS) {
    logs[k] = have[`${k}_log`] ?? 0;
    planks[k] = have[`${k}_planks`] ?? 0;
  }
  const out: WoodPlan = new Map();
  const entries = [...need].map(([key, n]) => { const m = woodPart(key)!; return { key, kind: m.kind, part: m.part, n }; });
  // Log parts (a stripped log and a bark block are charged as one log: chargedItem)
  const logPart = (part: string) => /(^|_)(log|wood)$/.test(part);
  // Kinds to try for a part: the village's, the design's, then by what there is
  const order = (own: string, amount: (k: string) => number) =>
    [...new Set([...(prefer ? [prefer] : []), own, ...[...WOODS].sort((u, w) => amount(w) - amount(u))])];
  const split = (e: { key: string; kind: string; n: number }, amount: (k: string) => number, can: (k: string, left: number) => number, use: (k: string, n: number) => void) => {
    const kinds = order(e.kind, amount);
    const whole = kinds.find((k) => can(k, e.n) >= e.n);
    const parts: Array<{ kind: string; n: number }> = [];
    if (whole) parts.push({ kind: whole, n: e.n });
    else {
      let left = e.n;
      for (const k of kinds.filter((x) => can(x, left) > 0)) {
        const n = Math.min(left, can(k, left));
        parts.push({ kind: k, n });
        left -= n;
        if (!left) break;
      }
      // Not enough in any mix: the rest in the first choice (the shortage message names it)
      if (left) {
        parts.push({ kind: kinds[0], n: left });
        out.short = true;
      }
    }
    for (const p of parts) use(p.kind, p.n);
    out.set(e.key, parts);
  };
  for (const e of entries.filter((x) => logPart(x.part)))
    split(e, (k) => logs[k], (k, left) => Math.min(left, logs[k]), (k, n) => { logs[k] = Math.max(0, logs[k] - n); });
  for (const e of entries.filter((x) => !logPart(x.part)).sort((x, y) => plankUnits(y.part, y.n) - plankUnits(x.part, x.n))) {
    const supply = (k: string) => planks[k] + logs[k] * 4;
    split(e, supply, (k, left) => Math.min(left, partsFrom(e.part, supply(k))), (k, n) => {
      const units = plankUnits(e.part, n);
      const fromPlanks = Math.min(planks[k], units);
      planks[k] -= fromPlanks;
      logs[k] = Math.max(0, logs[k] - Math.ceil((units - fromPlanks) / 4));
    });
  }
  return out;
}

/** The targets in the chosen wood kinds (a split part changes kind partway, in placing order). */
function swapWood(place: Target[], woods: WoodPlan): Target[] {
  const left = new Map([...woods].map(([key, parts]) => [key, parts.map((p) => ({ ...p }))]));
  return place.map((t) => {
    const m = woodPart(baseName(t.block));
    const parts = m && left.get(woodName(m.kind, m.part));
    if (!m || !parts?.length) return t;
    const p = parts[0];
    if (--p.n <= 0 && parts.length > 1) parts.shift();
    if (p.kind === m.kind) return t;
    const i = t.block.indexOf('[');
    return { ...t, block: `${woodName(p.kind, m.part)}${i >= 0 ? t.block.slice(i) : ''}` };
  });
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
 *
 * Anything to smelt at the village's furnace holds it for the whole job (S.3), taken before the storage is read: a
 * builder that queued behind another's glass finds the made panes in storage and takes them (not with `noStockPick`:
 * make_into_storage nets the storage out itself), and the panes, doors, slabs and stairs made beyond `need` go into
 * storage by name before the furnace is let go (not with `surplus` false).
 *
 * The workshop's make (S.9) passes `stock` (makeHeld's view of the storage: {} once it has withdrawn its inputs itself, so
 * nothing kept is taken) and `furnace`: false for none, or the furnace it holds and smelts at (a works furnace or the
 * hut's, chosen by its own rule). Every other caller passes neither.
 */
async function makeFromStock(a: BotAgent, need: Counts, short: Counts, back: () => Promise<void>, signal: AbortSignal,
  opts: { what?: string; noStockPick?: boolean; surplus?: boolean; stock?: Counts; furnace?: false | { x: number; y: number; z: number } } = {}): Promise<string | null> {
  const v = a.village();
  short = { ...short };
  // (by the hut's record, wherever the builder stands: a far builder that took no lock raced the panes' maker, S.3's review)
  const smelts = opts.furnace === false ? false : opts.furnace ? true : !!v && !!villageStationCell(v, 'furnace') && a.world.materials.plan(short, {}).fuel.smelts > 0;
  // (the walk to the hut before the wait, then the lock: released in the finally, a stopped action sends no report)
  const release = smelts ? await holdVillageFurnace(a, signal, `making ${listCounts(short)}${opts.what ? ` for ${opts.what}` : ''}`, opts.furnace || undefined) : () => undefined;
  try {
    let found: Counts = {};
    if (smelts && v && !opts.noStockPick) {
      // Made by another agent while this one queued (a maker's batch, a builder's surplus)
      const now = storageContents(v);
      const pick: Counts = {};
      for (const [n, q] of Object.entries(short)) if ((now[n] ?? 0) > 0) pick[n] = Math.min(q, now[n]);
      if (Object.keys(pick).length) {
        found = (await withdrawItems(a, v, pick, signal)).got;
        for (const [n, q] of Object.entries(found)) if (short[n] !== undefined && (short[n] -= q) <= 0) delete short[n];
        if (Object.keys(found).length) console.log(`[furnace] ${a.name} found ${listCounts(found)} in storage after the queue; not made again`);
      }
      if (!Object.keys(short).length) return `took ${listCounts(found)} from storage (made by another agent)`;
    }
    const made = await makeHeld(a, v, need, short, back, signal, { ...opts, held: smelts });
    return made ?? (Object.keys(found).length ? `took ${listCounts(found)} from storage (made by another agent)` : null);
  } finally {
    release();
  }
}

/** Panes, glass, doors, slabs and stairs made in batches: what a build leaves over goes into storage (S.3). */
const SURPLUS_PART = /^glass(_pane)?$|_(door|slab|stairs)$/;

async function makeHeld(a: BotAgent, v: Village | undefined, need: Counts, short: Counts, back: () => Promise<void>, signal: AbortSignal,
  opts: { what?: string; surplus?: boolean; held?: boolean; stock?: Counts; furnace?: false | { x: number; y: number; z: number } }): Promise<string | null> {
  // (read after the furnace is held: another agent's withdrawals and deposits while this one queued; a make's own view,
  // S.9)
  const store = opts.stock ?? (v ? storageContents(v) : {});
  const carried = inventoryCounts(a);
  // What is on hand beyond the building's own blocks (the cobblestone carried for the floor is not furnace material)
  const other: Counts = { ...carried };
  for (const [n, q] of Object.entries(store)) other[n] = (other[n] ?? 0) + q;
  for (const [n, q] of Object.entries(need)) other[n] = Math.max(0, (other[n] ?? 0) - q);
  // (the village's station, standing or still to be put in its hut cell by the craft or smelt itself, S.5: billed by
  // its own task, never by this job)
  const home = (n: StationName) => !!villageStation(a, n) || !!stationNear(a, n);
  const near = (n: string) => {
    const p = a.bot.entity.position;
    if ((n === 'crafting_table' || n === 'furnace') && home(n)) return true;
    // (the furnace held for the job, a works furnace: S.9)
    if (n === 'furnace' && opts.furnace) return true;
    // (state ids read directly, not findBlock: lesson 53)
    return nearestBlocks(a, [a.world.registry.blocksByName[n].id], STATION_REACH, 4).some((b) => Math.abs(b.y - p.y) <= 3);
  };
  // Only what can be made here: glass with no sand in reach must not stop the door and the chest being made (the
  // builder then leaves the windows open)
  const bill: Counts = {};
  for (const [n, q] of Object.entries(short)) {
    const p = a.world.materials.plan({ [n]: q }, other);
    if (!Object.keys(p.gather).length && !p.problems.length) bill[n] = q;
  }
  if (!Object.keys(bill).length) return null;
  let plan = a.world.materials.plan(bill, other);
  const stations: string[] = [];
  if (plan.fuel.smelts && !other.furnace && !near('furnace')) stations.push('furnace');
  if (plan.steps.some((st) => st.do === 'craft' && !/_planks$|^any:planks$|^stick$/.test(st.item)) && !other.crafting_table && !near('crafting_table')) stations.push('crafting_table');
  for (const n of stations) {
    bill[n] = (bill[n] ?? 0) + 1;
    // (S.4's proof: no lamp or sign job makes a station of its own)
    console.log(`[station] ${a.name} bills a ${n} for ${opts.what ?? 'its job'}: no village station in reach`);
  }
  plan = a.world.materials.plan(bill, other);
  if (Object.keys(plan.gather).length || plan.problems.length) return null;
  // Ingredients kept in storage come to hand first
  const fetch: Counts = {};
  for (const [n, q] of Object.entries(plan.fromStock)) {
    const spare = Math.max(0, (carried[n] ?? 0) - (need[n] ?? 0));
    const f = Math.min(q - spare, store[n] ?? 0);
    if (f > 0) fetch[n] = f;
  }
  // The coal or charcoal the plan burns, when storage holds it (the plan counts it as fuel, but smelting burns only what is
  // carried: F178); what is carried or fetched beyond the plan's ingredients (since D13 the fuel is counted without them,
  // S.9's review, lens 3 L1)
  const ingredientCoal = (plan.fromStock.coal ?? 0) + (plan.fromStock.charcoal ?? 0);
  for (const fuel of ['coal', 'charcoal']) {
    const want = plan.fuel.coal - Math.max(0, (carried.coal ?? 0) + (carried.charcoal ?? 0) + (fetch.coal ?? 0) + (fetch.charcoal ?? 0) - ingredientCoal);
    const f = Math.min(Math.max(0, want), store[fuel] ?? 0);
    if (f > 0) fetch[fuel] = (fetch[fuel] ?? 0) + f;
  }
  // A furnace or table kept in the storage comes along too (it was counted as there, then smelting found none)
  if (plan.fuel.smelts && !near('furnace') && !carried.furnace && store.furnace) fetch.furnace = 1;
  if (plan.steps.some((st) => st.do === 'craft' && !/_planks$|^any:planks$|^stick$/.test(st.item)) && !near('crafting_table') && !carried.crafting_table && store.crafting_table) fetch.crafting_table = 1;
  // The storage hut's table and furnace serve this job: it crafts and smelts there, beside the chests (always when it holds
  // the hut's furnace: it walked there for the lock, and its surplus panes must reach storage)
  const atHut = !!v?.storageHut && (!!opts.held || (home('crafting_table') && (!plan.fuel.smelts || home('furnace'))));
  if (v && Object.keys(fetch).length) {
    await withdrawItems(a, v, fetch, signal);
    // Craft at the site, where the table and furnace were looked for (not when they are the hut's: the walk there and
    // back to the hut held the furnace, S.3)
    if (!atHut) await back();
  }
  // The table and the furnace first (smelting does not depend on the furnace in the recipe chain)
  // (but after the planks and sticks, which need no station: sorted ahead of the "any planks" step that makes its own
  // planks, the table's craft sawed a log kept for that step, which then failed for want of a spare kind, F191)
  const station = (st: { item: string }) => (/_planks$|^any:planks$|^stick$/.test(st.item) ? 0 : /^(crafting_table|furnace)$/.test(st.item) ? 1 : 2);
  const steps = [...plan.steps].sort((x, y) => station(x) - station(y));
  const made: string[] = [];
  // The coal and charcoal the plan burns, shared by its smelts, when it also takes or makes some as an ingredient (a torch
  // batch): no more, so the ingredient is not burned (S.9's review, lens 1 M1, lens 3 M1); otherwise coal first as before
  const coal = ingredientCoal > 0 || plan.steps.some((st) => st.item === 'coal' || st.item === 'charcoal') ? { left: plan.fuel.coal } : undefined;
  // "Any planks" (sticks, a chest, fuel) come from the kind with logs to spare: not the logs kept for log parts, nor
  // those later steps saw into planks of their own kind
  const spareKind = (from: number) => {
    const inv = inventoryCounts(a);
    const spare = (k: string) => (inv[`${k}_log`] ?? 0) - (need[`${k}_log`] ?? 0)
      - steps.slice(from).reduce((s, st) => s + (st.do === 'craft' && st.item === `${k}_planks` ? st.runs : 0), 0);
    // (a kind not carried at all never wins: with every kind at no spare the tie went to oak, the first in WOODS, and a
    // birch builder failed "needs 1x oak_log" on the storage hut's planks, Minevale30, 31 and 33, F191)
    const carried = (k: string) => (inv[`${k}_log`] ?? 0) * 4 + (inv[`${k}_planks`] ?? 0);
    // (spare logs only: a kind whose logs are all kept for a later planks step must not win on them, F199; then a kind
    // carried at all before one that is not, the diff review)
    const held = (k: string) => Math.max(0, spare(k)) * 4 + (inv[`${k}_planks`] ?? 0);
    return [...WOODS].sort((u, w) => Number(held(w) > 0) - Number(held(u) > 0) || Number(carried(w) > 0) - Number(carried(u) > 0) || spare(w) - spare(u) || held(w) - held(u) || carried(w) - carried(u))[0];
  };
  for (const [i, st] of steps.entries()) {
    checkAbort(signal);
    try {
      // (every other craft and smelt told the spare kind too: the craft skill's own plank choice and smelting's fuel took
      // the logs and planks fetched for later steps, F165, F169)
      if (st.do === 'craft') await SURVIVAL_SKILLS.craft.run(a, { item: st.item === 'any:planks' ? `${spareKind(i + 1)}_planks` : st.item, count: st.makes, wood: spareKind(i + 1) }, signal);
      else {
        // "Any logs" (charcoal) from the kind with logs to spare, else whichever is carried: the first log carried was the
        // birch fetched for the lamps' fence planks, smelted, and the planks then failed (Minevale29)
        const spare = `${spareKind(i + 1)}_log`;
        const input = st.input === 'any:cobblestone' ? 'cobblestone' : st.input === 'any:logs' ? (inventoryCounts(a)[spare] ? spare : a.bot.inventory.items().find((it) => /_log$/.test(it.name))?.name ?? 'oak_log') : st.input ?? '';
        // (at the furnace held for the job when it is given one, S.9)
        const f = opts.furnace;
        await SURVIVAL_SKILLS.smelt.run(a, { item: input, count: st.runs, fuel: spareKind(i + 1), ...(coal ? { coal } : {}), ...(f ? { at: `${f.x},${f.y},${f.z}` } : {}) }, signal);
      }
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      throw new Error(`could not ${st.do} ${st.makes} ${st.item.replace(/^any:/, '')} for the building (${(e as Error).message})`);
    }
    made.push(`${st.do === 'smelt' ? 'smelted' : 'crafted'} ${st.makes} ${st.item.replace(/^any:/, '')}`);
  }
  // What a batch made beyond the job's own blocks (16 panes for 3) goes into storage while still at the hut, by name
  // (deposit all leaves no tool out, but a later "all" may never come: lesson 112)
  if (v && atHut && opts.surplus !== false) {
    const parts = [...new Set(steps.filter((st) => st.do === 'craft' && SURPLUS_PART.test(st.item)).map((st) => st.item))];
    if (parts.length) made.push(await depositSurplus(a, v, need, parts, opts.what ?? 'the job', signal));
  }
  return made.length ? `made from storage: ${made.filter(Boolean).join(', ')}` : null;
}

/**
 * Made parts carried beyond `need` (the server's counts, lesson 13) go into storage by name, except one the agent's own
 * claimed gather task names (lesson 64). No chest is crafted for them from the carried wood (a builder's wall planks: the
 * misc chest takes them instead). Returns what was put in, or '' (a failed deposit is logged and leaves the build alone).
 */
async function depositSurplus(a: BotAgent, v: Village, need: Counts, parts: string[], what: string, signal: AbortSignal): Promise<string> {
  const mine = (n: string) => v.tasks.some((t) => t.status === 'claimed' && t.claimedBy === a.name && new RegExp(`collect block=${n}\\b`).test(t.detail));
  const carried = await carriedCounts(a, parts);
  const put: string[] = [];
  for (const n of parts) {
    const q = (carried[n] ?? 0) - (need[n] ?? 0);
    if (q <= 0 || mine(n)) continue;
    try {
      await STORAGE_SKILLS.deposit.run(a, { item: n, count: q, keep_wood: true }, signal);
      console.log(`[parts] ${a.name} deposited ${q} ${n} beyond ${what}'s ${need[n] ?? 0} (storage now ${storageContents(v)[n] ?? 0})`);
      put.push(`${q} ${n}`);
    } catch (e) {
      if ((e as Error).message === 'cancelled' || unmoved(e)) throw e;
      console.log(`[parts] ${a.name} could not deposit ${q} ${n} beyond ${what}'s ${need[n] ?? 0}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return put.length ? `put ${put.join(', ')} left over into storage` : '';
}

/** Players (bots and people, not spectators) whose body overlaps the column of `n` cells from `pos` up. */
function playersIn(a: BotAgent, pos: Pos, n: number): string[] {
  const [x, y, z] = pos;
  const out: string[] = [];
  for (const [name, pl] of Object.entries(a.bot.players)) {
    const e = pl.entity;
    if (!e || pl.gamemode === 3) continue;
    const p = e.position;
    if (p.x + 0.3 > x && p.x - 0.3 < x + 1 && p.z + 0.3 > z && p.z - 0.3 < z + 1 && p.y + 1.8 > y && p.y < y + n) out.push(name);
  }
  return out;
}

/**
 * The ground no one stands on to wait (standSpot's, B.4's doorStand's): the village's buildings, built or laid out, the
 * mine, the street lamps, the name signs, the wheat field, every farm slot and the works plot. Others' reservations are
 * the caller's.
 */
function standTaken(a: BotAgent, v?: Village): Area[] {
  // (the buildings themselves, built or laid out, and the mine: a street cell beside a house is a fine place to wait)
  const taken: Area[] = [...(v?.structures ?? [])];
  for (const t of v?.tasks ?? []) {
    const m = /footprint x (-?\d+)\.\.(-?\d+), z (-?\d+)\.\.(-?\d+)/.exec(t.detail);
    if (m) taken.push({ x1: Number(m[1]), x2: Number(m[2]), z1: Number(m[3]), z2: Number(m[4]) });
  }
  if (v?.mine) taken.push(...mineAreas(v.mine));
  // (and the street lamps: a post's top is footing, in the torch's cell)
  for (const l of v?.layouts ?? []) for (const c of l.lamps ?? []) taken.push({ x1: c.x, x2: c.x, z1: c.z, z2: c.z });
  // (and the name signs: one by a door at head height)
  for (const l of v?.layouts ?? []) for (const c of l.signs ?? []) taken.push({ x1: c.x, x2: c.x, z1: c.z, z2: c.z });
  // (and the wheat field: no one waits on farmland, and the in-the-way teleport must not land there)
  for (const l of v?.layouts ?? []) if (l.farm) taken.push({ x1: l.farm.x1, x2: l.farm.x2, z1: l.farm.z1, z2: l.farm.z2 });
  // (and every farm slot, free or farmed: opportunistic farming, 10-08)
  for (const l of v?.layouts ?? []) for (const q of l.slots ?? []) taken.push({ x1: q.x1, x2: q.x2, z1: q.z1, z2: q.z2 });
  // (and S.9's works plot: a furnace's top is footing, lesson 61; B.4's review, lens 1 L5)
  for (const l of v?.layouts ?? []) if (l.works && l.works.x2 >= l.works.x1 && l.works.z2 >= l.works.z1) taken.push({ x1: l.works.x1, x2: l.works.x2, z1: l.works.z1, z2: l.works.z2 });
  return taken;
}

/**
 * Where to stand during a job: 3 blocks off all the ground it works on, south first, then north, east, west, at the
 * job's level (2 up or down), off every building of the village and those laid out, with a block round them (null if no
 * footing). Minevale19's builder looked for footing 24 up and down 3 blocks south of the storage hut, found the mining
 * hut's roof across the street and pillared up to it in front of its door.
 */
function standSpot(a: BotAgent, job: Job): { x: number; y: number; z: number } | null {
  const area = job.claim?.area ?? job.area;
  const cx = Math.floor((area.x1 + area.x2) / 2), cz = Math.floor((area.z1 + area.z2) / 2);
  const v = a.village();
  const taken = standTaken(a, v);
  // (and ground other agents have reserved for their own jobs, S.6: a part of the plot being prepared beside this one, a
  // building going up; the in-the-way teleport put bots there, on a neighbour's fill: lessons 44 and 61), unless there is
  // nowhere else (the last pass below)
  const now = Date.now();
  const reserved = (v?.reservations ?? []).filter((r) => r.by !== a.name && r.until > now);
  let others = true;
  const inside = (q: Area, x: number, z: number) => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2;
  const free = (x: number, z: number) => !taken.some((q) => inside(q, x, z)) && !(others && reserved.some((q) => inside(q, x, z)));
  // On the village plot (and its prepared margin) first, when the job is on one: on a green every building backs onto
  // the plot's edge, and "south" of one on the south side lay on unprepared ground (the review of V2.4)
  const lay = v?.layouts?.find((l) => area.x1 >= l.x1 && area.x2 <= l.x2 && area.z1 >= l.z1 && area.z2 <= l.z2);
  // (on a plot prepared in parts, S.6: the parts done, with their margins on the plot's edge, never ground still to level)
  const rec = lay ? v?.plots.find((q) => q.x1 === lay.x1 && q.z1 === lay.z1 && q.x2 === lay.x2 && q.z2 === lay.z2) : undefined;
  const onDone = (x: number, z: number) => !rec?.parts || rec.parts.some((q) => x >= q.x1 - (q.x1 === rec.x1 ? 2 : 0) && x <= q.x2 + (q.x2 === rec.x2 ? 2 : 0)
    && z >= q.z1 - (q.z1 === rec.z1 ? 2 : 0) && z <= q.z2 + (q.z2 === rec.z2 ? 2 : 0));
  const onPlot = (x: number, z: number) => !!lay && x >= lay.x1 - 2 && x <= lay.x2 + 2 && z >= lay.z1 - 2 && z <= lay.z2 + 2 && onDone(x, z);
  // Near the job's level first, then farther up or down (cut and fill at a plot's edge can be 3 or more; runJob's
  // in-the-way teleport needs a spot)
  // (the job's level still comes first: a level spot off the plot beats footing far down a drop on its margin)
  for (const pass of reserved.length ? [true, false] : [true]) {
    others = pass;
    for (const range of [2, 8, 24])
      for (const strict of lay ? [true, false] : [false])
        for (const d of [3, 2, 4])
          for (const [x, z] of [[cx, area.z2 + d], [cx, area.z1 - d], [area.x2 + d, cz], [area.x1 - d, cz]] as Array<[number, number]>) {
            if (!free(x, z) || (strict && !onPlot(x, z))) continue;
            const y = standableY(a, x, job.y + 1, z, range);
            if (y !== null) return { x, y, z };
          }
  }
  return null;
}

/**
 * Footing 2 blocks beside a target cell (the in-the-way teleport's spot when the job's own stand is far from it), on the
 * ground standSpot would take: off the job's own area, every building and laid-out ground (standTaken) and what other
 * agents have reserved (lessons 44 and 61; s30's fix review: a first version could put a bot on a neighbour's fill).
 */
function besideTarget(a: BotAgent, job: Job, pos: Pos): { x: number; y: number; z: number } | null {
  const area = job.claim?.area ?? job.area;
  const v = a.village();
  const now = Date.now();
  const taken = [...standTaken(a, v), { x1: area.x1 - 1, z1: area.z1 - 1, x2: area.x2 + 1, z2: area.z2 + 1 },
    ...(v?.reservations ?? []).filter((r) => r.by !== a.name && r.until > now)];
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2]]) {
    const x = pos[0] + dx, z = pos[2] + dz;
    if (taken.some((q) => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2)) continue;
    const y = standableY(a, x, pos[1], z, 3);
    if (y !== null) return { x, y, z };
  }
  return null;
}

/** Stand just south of the site (out of the way of the blocks), where it can be seen. */
async function standBy(a: BotAgent, job: Job, signal: AbortSignal, force = false) {
  // Outside all the ground the job works on: prepare_site fills its margin too, and a preparer standing on it was
  // buried and suffocated (Drop2)
  const area = job.claim?.area ?? job.area;
  const spot = standSpot(a, job);
  const cx = spot?.x ?? Math.floor((area.x1 + area.x2) / 2), sz = spot?.z ?? area.z2 + 3;
  const p = a.bot.entity.position;
  // Also out of the footprint itself: a builder standing inside was walled in by its own cottage
  const inside = p.x >= area.x1 - 1 && p.x < area.x2 + 2 && p.z >= area.z1 - 1 && p.z < area.z2 + 2;
  // (without scaffolding: a stand spot is somewhere to wait, never worth building up to)
  if (force || inside || Math.hypot(p.x - cx, p.z - sz) > 6)
    await walk(a, spot ? new goals.GoalNear(cx, spot.y, sz, 2) : new goals.GoalNearXZ(cx, sz, 2), `the site at ${cx},${sz}`, signal, 90000, { scaffold: false }).catch((e: Error) => {
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
  if (t.block === 'air') return cur === 'air' || cur === 'cave_air' || /^(water|lava|bubble_column)$/.test(cur);
  let same = cur === baseName(t.block);
  if (!same) {
    const c = anyWood ? woodPart(cur) : null, w = c ? woodPart(baseName(t.block)) : null;
    same = !!c && !!w && c.part === w.part;
  }
  // A stair or log the wrong way round is not there yet (the states a design sets; shapes and fence sides are the
  // server's, and doors are faced from their wall)
  if (same && !/_door$/.test(cur)) {
    const want = /\[(.*)\]$/.exec(t.block)?.[1];
    if (want) {
      const props = (a.bot.blockAt(new Vec3(t.x, t.y, t.z))?.getProperties() ?? {}) as Record<string, unknown>;
      for (const p of want.split(',')) {
        const [k, v] = p.split('=').map((s) => s.trim());
        if (/^(facing|half|axis|type|open)$/.test(k) && props[k] !== undefined && String(props[k]) !== v) return false;
      }
    }
  }
  return same;
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
    const c = reg.conflictOf(v, job.claim.area, a.name, job.claim.avoidStructures, job.claim.ignore);
    const text = c && `cannot work at ${areaText(job.claim.area)}: ${c.why}; pick another spot (find_site avoids taken ground)`;
    // (ground another agent is working on is contention, E.0, for a while; a building in the way is for good)
    if (c?.kind === 'reserved') throw new ContentionError(text!, 'reserved', `ground:${c.area.x1},${c.area.z1}`);
    if (text) throw new Error(text);
    reservation = reg.reserve(v, job.claim.area, a.name, job.claim.purpose);
  }
  const notes: string[] = [];
  // What the builder carries of each charged item as the server counted it, kept up to date by the charges and refunds
  // below: a charge or refund whose answer is lost is settled against it (E.1's review). Read again after a walk.
  const onHand = new Map<string, number>();
  const giveBack = async (item: string, n: number) => {
    const before = onHand.get(item);
    const out = await a.world.rcon.give(a.name, item, n, before);
    if (before !== undefined && /^Gave/i.test(out)) onHand.set(item, before + n);
    else onHand.delete(item);
  };
  try {
    await standBy(a, job, signal);
    // What is left to do, and in what order: clearing top-down, then placing bottom-up
    const todo = job.targets.filter((t) => !alreadyThere(a, t, pay));
    const clear = todo.filter((t) => t.block === 'air').sort((u, w) => w.y - u.y);
    let place = todo.filter((t) => t.block !== 'air').sort((u, w) => u.y - w.y || u.x - w.x || u.z - w.z);
    if (pay) {
      // Survival: have everything before starting, taking what is missing from the village storage
      // Two passes: a builder that comes up short reads the chests again and chooses the wood again (two builders
      // starting together each chose from a record the other was emptying, and one gave up with spruce left in storage)
      const orig = place;
      // The building this job builds (its claimed Build task, else the one unbuilt copy of the design given a kind), for
      // its own wood kind (F164)
      const ofDesign = (t: { title: string; detail: string }) => /^Build /.test(t.title) && t.detail.startsWith(`build_design "${job.design}"`);
      const mine = job.design ? v?.tasks.find((t) => t.status === 'claimed' && t.claimedBy === a.name && ofDesign(t)) : undefined;
      const given = job.design && !mine ? v?.tasks.filter((t) => t.status !== 'done' && ofDesign(t) && v.woodFor?.[t.title.slice(6)]) : undefined;
      const label = mine ? mine.title.slice(6) : given?.length === 1 ? given[0].title.slice(6) : undefined;
      let woods: WoodPlan = new Map();
      let need: Counts = {}, inv: Counts = {};
      let why: string | null = null;
      // Why making things from stock failed, for the failure message (it was lost, and a builder retried the same
      // build again and again carrying everything it needed)
      let makeError = '';
      for (let pass = 0; pass < 2; pass++) {
        await syncInventory(a);
        let store = v ? storageContents(v) : {};
        // The record looks short: look in the chests first (items put in or taken out by hand are not in the record)
        const rough = billOf(orig);
        if (v?.storage?.chests.length && (pass > 0 || Object.entries(rough).some(([n, q]) => (store[n] ?? 0) + (inventoryCounts(a)[n] ?? 0) < q))) {
          await refreshStorage(a, v, signal);
          store = storageContents(v);
        }
        const all = inventoryCounts(a);
        for (const [n, q] of Object.entries(store)) all[n] = (all[n] ?? 0) + q;
        const prefer = (label && v?.woodFor?.[label]) || v?.wood;
        woods = chooseWood(orig, all, prefer);
        // A whole building in one kind (F164, the user's choice): a plan that mixes kinds part by part gives way to one
        // kind that covers every part, the building's own first (VanW4: house 3 came out in birch with oak planks)
        const kindsUsed = new Set([...woods.values()].flatMap((ps) => ps.map((x) => x.kind)));
        if (kindsUsed.size > 1) {
          const amount = (k: string) => (all[`${k}_log`] ?? 0) * 4 + (all[`${k}_planks`] ?? 0);
          // (not a kind another unbuilt building counts on: the cover rule closed its log tasks on those logs, the review)
          const own = (label && v?.woodFor?.[label]) || v?.wood;
          const promised = (k: string) => k !== own && !!v?.wood && !!v.tasks.some((t) => /^Build /.test(t.title) && t.status !== 'done' && t.title.slice(6) !== label
            && (v.woodFor?.[t.title.slice(6)] ?? v.wood) === k);
          for (const k of [...new Set([...(prefer ? [prefer] : []), ...[...WOODS].sort((x, y) => amount(y) - amount(x))])]) {
            if (!amount(k) || promised(k)) continue;
            const only: Counts = { ...all };
            for (const o of WOODS) if (o !== k) only[`${o}_log`] = only[`${o}_planks`] = 0;
            const one = chooseWood(orig, only, k);
            if (one.short) continue;
            woods = one;
            // (recorded only in a village with a wood kind: without one, the needs are counted in any logs)
            if (label && v?.wood && k !== (v.woodFor?.[label] ?? v.wood)) {
              (v.woodFor ??= {})[label] = k;
              a.world.villages.note(v, `${label} is built in ${k}: one kind for the whole building`);
            }
            break;
          }
        }
        place = swapWood(orig, woods);
        need = billOf(place);
        inv = await carriedCounts(a, Object.keys(need));
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
        why = shortage(a, job.what ?? 'this', need, { ...inventoryCounts(a), ...inv }, v ? storageContents(v) : {});
        if (why) {
          // Short only of things that can be made from what is in hand and in storage: make them here
          const short: Counts = {};
          for (const [n, q] of Object.entries(need)) if ((inv[n] ?? 0) < q) short[n] = q - (inv[n] ?? 0);
          // A crafting step that fails (one log fewer than counted) falls through to the shortage below and the requeue
          const made = await makeFromStock(a, need, short, () => standBy(a, job, signal), signal, { what: job.what ?? job.design }).catch((e: Error) => {
            // (a stall that did not move the bot fails the build now, so the rescue comes soon: F146)
            if (e.message === 'cancelled' || unmoved(e)) throw e;
            notes.push(e.message);
            makeError = e.message;
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
        if (!why || !v?.storage?.chests.length) break;
      }
      const swapped = [...woods].filter(([key, parts]) => parts.some((p) => woodPart(key)?.kind !== p.kind))
        .map(([key, parts]) => `${parts.map((p) => (parts.length > 1 ? `${p.n} ${p.kind}` : p.kind)).join(' + ')} for the ${key.replace(/_/g, ' ')}`);
      if (swapped.length) notes.push(`built with ${swapped.join(', ')}`);
      if (why) {
        let left: Counts = {};
        for (const [n, q] of Object.entries(need)) if ((inv[n] ?? 0) < q) left[n] = q - (inv[n] ?? 0);
        // Short only of glass while the village's panes are being made (S.3): wait for their maker at the furnace (it holds
        // it until they are in storage), then take them; the windows stay open only if they are still missing then
        const maker = v?.tasks.find((t) => t.status === 'claimed' && t.claimedBy !== a.name && /^glass/.test(PARTS_MAKE.exec(t.title)?.[2] ?? ''));
        if (v && maker && Object.keys(left).every((n) => /^glass(_pane)?$/.test(n))) {
          const t0 = Date.now();
          const release = await holdVillageFurnace(a, signal, `waiting for ${maker.claimedBy}'s ${listCounts(left)}`);
          let got: Counts = {};
          try {
            got = (await withdrawItems(a, v, left, signal)).got;
          } finally {
            release();
          }
          console.log(`[parts] ${a.name} waited ${((Date.now() - t0) / 1000).toFixed(1)}s for ${maker.claimedBy}'s ${PARTS_MAKE.exec(maker.title)!.slice(1, 3).join(' ')} and took ${listCounts(got) || 'none'} for ${job.what ?? job.design ?? 'its build'}`);
          if (Object.keys(got).length) notes.push(`took ${listCounts(got)} from storage, made by ${maker.claimedBy}`);
          await standBy(a, job, signal);
          inv = await carriedCounts(a, Object.keys(need));
          left = {};
          for (const [n, q] of Object.entries(need)) if ((inv[n] ?? 0) < q) left[n] = q - (inv[n] ?? 0);
          why = shortage(a, job.what ?? 'this', need, { ...inventoryCounts(a), ...inv }, storageContents(v));
        }
      }
      if (why) {
        const left: Counts = {};
        for (const [n, q] of Object.entries(need)) if ((inv[n] ?? 0) < q) left[n] = q - (inv[n] ?? 0);
        logShortfall(a, v, job.what ?? job.design ?? 'this', need, inv, left);
        // Short only of glass (no sand near the village): leave the windows open rather than fail the building
        if (Object.keys(left).every((n) => /^glass(_pane)?$/.test(n))) {
          place = place.map((t) => (/^glass(_pane)?$/.test(chargedItem(t.block)) ? { ...t, optional: true } : t));
          notes.push(`left ${Object.values(left).reduce((s, q) => s + q, 0)} windows open (no glass: no sand to make it)`);
        } else throw new Error(why + (makeError ? ` (making them here failed: ${makeError})` : '') + (await requeueBuild(a, job, need, left, signal)));
      }
      // Everything it needs is in hand: the storage reserve stops counting this build (S.1; until now its furnace's
      // cobblestone in the chests was still the build's), or this lamp or sign job (S.4)
      const held = v?.tasks.find((t) => t.status === 'claimed' && t.claimedBy === a.name
        && (job.task ? t.detail === job.task || t.detail.startsWith(`${job.task} `) : /^Build /.test(t.title) && !!job.design && t.detail.includes(`build_design "${job.design}"`)));
      if (v && held) a.world.markDrawn(v, held.id, a.name);
      for (const [n, q] of Object.entries(inv)) onHand.set(n, q);
    }
    // Merge vertical runs of one block in one column into a single /fill; `item` is what placing it costs
    type Cmd = { cmd: string; n: number; pos: Pos; clear: boolean; item?: string; optional?: boolean; then?: string; open?: boolean };
    const cmds: Cmd[] = [];
    const columns = (list: Target[], clearing: boolean) => {
      const byCol = new Map<string, Target[]>();
      for (const t of list) {
        if (/_door$/.test(baseName(t.block))) {
          const f = DIR_NAMES[`${t.facing?.[0] ?? 0},${t.facing?.[1] ?? 1}`] ?? 'south';
          cmds.push({ cmd: `setblock ${t.x} ${t.y} ${t.z} ${baseName(t.block)}[facing=${f},half=lower]`, n: 1, pos: [t.x, t.y, t.z], clear: false, item: baseName(t.block),
            then: `setblock ${t.x} ${t.y + 1} ${t.z} ${baseName(t.block)}[facing=${f},half=upper]` });
          continue;
        }
        if (t.nbt) {
          cmds.push({ cmd: `setblock ${t.x} ${t.y} ${t.z} ${t.block}${t.nbt}`, n: 1, pos: [t.x, t.y, t.z], clear: false, item: chargedItem(t.block), optional: t.optional, open: /_sign$/.test(baseName(t.block)) });
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
    // Pace: memory.buildSpeed x 10 blocks a second, like the sandbox (and the game's speed, MC_TIME_SCALE)
    const speed = Math.max(0.25, Math.min(20, Number(a.memory.buildSpeed) || 1)) * timeScale();
    let placed = 0, cleared = 0, budget = 0;
    const skipped = new Map<string, number>();
    // Commands put back for a player standing in their cells: index -> tries
    const waited = new Map<number, number>();
    const spent: Counts = {};
    let lastRenew = Date.now();
    let outOf = -1;
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      checkAbort(signal);
      // A station put in its cell since the job was read (S.5: the one placer, during a craft of this job's) is not set
      // or charged again
      if (!c.clear && c.n === 1 && /^(crafting_table|furnace)$/.test(c.item ?? '') && blockName(a, c.pos[0], c.pos[1], c.pos[2]) === c.item) continue;
      while (budget <= 0) {
        await sleep(100, signal);
        budget += speed;
      }
      budget -= c.n;
      // Never set a block inside a player: Drop2's preparer stood where its fill went and suffocated (F99). The builder
      // walks out of the way once; agents still in the way are put at the stand spot outside the job (an idle worker
      // stood on the plot at its spawn); people's cells wait for the end of the job, three tries, then are left out
      // (a sign has no collision box: no one is in its way)
      if (!c.clear && !c.open) {
        const h = c.then ? 2 : Math.max(1, c.n);
        let inBody = playersIn(a, c.pos, h);
        if (inBody.length) console.log(`[build] ${a.name}: ${inBody.join(', ')} in the way of ${c.cmd}`);
        if (inBody.includes(a.name) && !waited.has(i)) {
          await standBy(a, job, signal, true);
          onHand.clear(); // (a walk can pick things up)
          inBody = playersIn(a, c.pos, h);
        }
        const bots = inBody.filter((name) => name === a.name || a.world.isAgent(name));
        if (bots.length) {
          let spot = standSpot(a, job);
          // (a target outside the job's area and far from its stand, a neighbourhood's lamp 55-90 blocks from the hut its
          // job stands at: beside the target instead, s30's review; a target inside the area keeps the stand, as before)
          const ja = job.claim?.area ?? job.area;
          const outside = c.pos[0] < ja.x1 - 2 || c.pos[0] > ja.x2 + 2 || c.pos[2] < ja.z1 - 2 || c.pos[2] > ja.z2 + 2;
          if (GROW.on && outside && (!spot || Math.hypot(spot.x - c.pos[0], spot.z - c.pos[2]) > 24)) spot = besideTarget(a, job, c.pos) ?? spot;
          if (spot) for (const name of bots) await a.world.rcon.command(`tp ${name} ${spot.x + 0.5} ${spot.y} ${spot.z + 0.5}`).catch(() => '');
          await sleep(300, signal);
          inBody = playersIn(a, c.pos, h);
        }
        if (inBody.length) {
          const tries = (waited.get(i) ?? 0) + 1;
          if (tries <= 3) {
            cmds.push(c);
            waited.set(cmds.length - 1, tries);
            await sleep(500, signal);
          } else skipped.set(`where ${inBody.join(' and ')} stood`, (skipped.get(`where ${inBody.join(' and ')} stood`) ?? 0) + c.n);
          continue;
        }
      }
      // Survival: take the blocks from the inventory first; running out stops the job (optional blocks are skipped)
      const cost = pay && c.item && c.n > 0 ? c.item : null;
      if (cost) {
        // (a lost answer is settled by counting: all taken goes on and places, part is given back, none was never charged)
        const before = onHand.get(cost) ?? (await a.world.rcon.count(a.name, cost));
        const got = await a.world.rcon.take(a.name, cost, c.n, before);
        onHand.set(cost, before - got);
        if (got < c.n) {
          if (got) await giveBack(cost, got);
          if (c.optional) continue;
          outOf = i;
          break;
        }
      }
      a.bot.lookAt(new Vec3(c.pos[0] + 0.5, c.pos[1] + 0.5, c.pos[2] + 0.5)).catch(() => {});
      const out = await a.world.rcon.command(c.cmd);
      // A door's upper half right after its lower one, never one without the other
      if (c.then && /^(Changed the block|Successfully filled)/i.test(out)) await a.world.rcon.command(c.then);
      if (/^(Changed the block|Successfully filled)/i.test(out)) {
        if (c.clear) cleared += c.n;
        else placed += c.n;
        if (cost) spent[cost] = (spent[cost] ?? 0) + c.n;
      } else {
        if (cost) await giveBack(cost, c.n); // not placed: give the blocks back
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

// One find_site or prepare_site scan at a time in the whole process (E.1): with 25 agents, surveys running together share
// the event loop's slices (find_site's survey reads up to ~70,000 columns) and starve the bots' keep-alives (lessons 16, 53). The next
// scan is let in on a later turn of the loop, so scans never run back to back in one stretch either.
let scanHeld = false;
const scanQueue: Array<() => void> = [];

class ScanTurn {
  private held = false;

  /** Wait for the turn (at once when no scan runs); throws 'cancelled' when the skill is cancelled while waiting. */
  async take(signal?: AbortSignal) {
    if (this.held) return;
    if (signal) checkAbort(signal);
    if (scanHeld)
      await new Promise<void>((ok, fail) => {
        const grant = () => {
          signal?.removeEventListener('abort', cancel);
          ok();
        };
        const cancel = () => {
          const i = scanQueue.indexOf(grant);
          if (i >= 0) scanQueue.splice(i, 1);
          fail(new Error('cancelled'));
        };
        scanQueue.push(grant);
        signal?.addEventListener('abort', cancel, { once: true });
      });
    else scanHeld = true;
    this.held = true;
  }

  /** Give the turn up (again is harmless): the next waiter gets it on a later turn of the loop. */
  release() {
    if (!this.held) return;
    this.held = false;
    setImmediate(() => {
      const next = scanQueue.shift();
      if (next) next();
      else scanHeld = false;
    });
  }
}

/** Run a scan holding the turn, given up however it ends. */
async function withScanTurn<T>(signal: AbortSignal | undefined, scan: () => Promise<T> | T): Promise<T> {
  const turn = new ScanTurn();
  await turn.take(signal);
  try {
    return await scan();
  } finally {
    turn.release();
  }
}

// ---------------------------------------------------------------------------------------------
// find_site
// ---------------------------------------------------------------------------------------------

/** The ground in a square around a point, surveyed once per position: each column's height and what stands on it. */
interface Ground {
  x0: number;
  z0: number;
  n: number;
  y: Int16Array;
  /** 0 usable, 1 not loaded, 2 water or lava, 3 taken (a building and its walkway, a layout, ground others reserved) */
  kind: Uint8Array;
  /** Prefix sums (n+1 by n+1) for window counts: not loaded, wet, taken, tree blocks, built-on columns. */
  sums: Record<'unloaded' | 'wet' | 'taken' | 'trees' | 'built', Int32Array>;
  /** Lowest and highest ground in every window of a size, computed on first use. */
  extremes: Map<number, { lo: Int16Array; hi: Int16Array }>;
}

async function surveyGround(a: BotAgent, cx: number, cz: number, r: number, taken: Area[], signal?: AbortSignal, noGroundWet = false): Promise<Ground> {
  const n = 2 * r + 1, x0 = cx - r, z0 = cz - r, yHint = Math.floor(a.bot.entity.position.y);
  taken = taken.filter((q) => q.x2 >= x0 && q.x1 <= x0 + n - 1 && q.z2 >= z0 && q.z1 <= z0 + n - 1);
  const y = new Int16Array(n * n), kind = new Uint8Array(n * n), trees = new Uint16Array(n * n), built = new Uint8Array(n * n);
  let t = Date.now();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i, x = x0 + i, z = z0 + j;
      if (taken.some((q) => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2)) {
        kind[k] = 3;
        continue;
      }
      const c = surfaceAt(a, x, z, yHint);
      if (!c) {
        kind[k] = 1;
        continue;
      }
      y[k] = c.y;
      trees[k] = c.trees;
      // (`noGroundWet`: a column with no ground within 48 down, a ravine, counts as unusable; read as ground at yHint - 48
      // it made a perfectly flat square of a valley, s30's review)
      if (c.liquid || (noGroundWet && c.block === 'air')) kind[k] = 2;
      else if (!NATURAL_GROUND.has(c.block)) built[k] = 1;
    }
    // Several bots share one event loop (F16): let the others run between rows
    if (Date.now() - t > 20) {
      await new Promise((res) => setImmediate(res));
      if (signal) checkAbort(signal);
      t = Date.now();
    }
  }
  const prefix = (f: (k: number) => number) => {
    const m = n + 1, P = new Int32Array(m * m);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) P[(j + 1) * m + i + 1] = f(j * n + i) + P[j * m + i + 1] + P[(j + 1) * m + i] - P[j * m + i];
    return P;
  };
  return {
    x0, z0, n, y, kind, extremes: new Map(),
    sums: {
      unloaded: prefix((k) => +(kind[k] === 1)), wet: prefix((k) => +(kind[k] === 2)), taken: prefix((k) => +(kind[k] === 3)),
      trees: prefix((k) => trees[k]), built: prefix((k) => built[k]),
    },
  };
}

/** Sum over the size-k window whose top-left cell is (i, j). */
const windowSum = (P: Int32Array, n: number, i: number, j: number, k: number) => {
  const m = n + 1;
  return P[(j + k) * m + i + k] - P[j * m + i + k] - P[(j + k) * m + i] + P[j * m + i];
};

/** The lowest (or highest) value in every k x k window of an n x n grid: sliding windows along rows, then columns. */
function windowExtreme(src: Int16Array, n: number, k: number, max: boolean): Int16Array {
  const m = n - k + 1, rows = new Int16Array(m * n), out = new Int16Array(m * m), q = new Int32Array(n);
  const worse = (u: number, w: number) => (max ? u <= w : u >= w);
  for (let j = 0; j < n; j++) {
    let h = 0, t = 0;
    for (let i = 0; i < n; i++) {
      const v = src[j * n + i];
      while (t > h && worse(src[j * n + q[t - 1]], v)) t--;
      q[t++] = i;
      if (q[h] <= i - k) h++;
      if (i >= k - 1) rows[j * m + i - k + 1] = src[j * n + q[h]];
    }
  }
  for (let i = 0; i < m; i++) {
    let h = 0, t = 0;
    for (let j = 0; j < n; j++) {
      const v = rows[j * m + i];
      while (t > h && worse(rows[q[t - 1] * m + i], v)) t--;
      q[t++] = j;
      if (q[h] <= j - k) h++;
      if (j >= k - 1) out[(j - k + 1) * m + i] = rows[q[h] * m + i];
    }
  }
  return out;
}

interface SiteCandidate { x: number; z: number; y: number; size: number; range: number; trees: number; wood: number; score: number }
interface Rejections { wet: number; steep: number; occupied: number; unloaded: number }

/**
 * The best sz x sz site in the surveyed ground: centre within `radius` of (ox, oz) and, in a village, within reach of
 * its home. Level ground matters most, then staying off existing builds, then fewer trees, then distance; in survival,
 * few trees within 48 blocks count against a site (none at all heavily: a desert site had none within 128 blocks, and
 * a far 30x30 with 5 logs near it beat a site in the woods).
 */
function bestSite(g: Ground, sz: number, maxSlope: number, ox: number, oz: number, radius: number, home: { x: number; z: number } | null,
  woodNear: ((x: number, z: number, y: number) => number) | null, why: Rejections, homeRange = VILLAGE_RANGE): SiteCandidate | null {
  const { n } = g, m = n - sz + 1, half = Math.floor(sz / 2);
  if (m <= 0) return null;
  let ext = g.extremes.get(sz);
  if (!ext) g.extremes.set(sz, (ext = { lo: windowExtreme(g.y, n, sz, false), hi: windowExtreme(g.y, n, sz, true) }));
  let best: SiteCandidate | null = null;
  for (let j = 0; j < m; j++)
    for (let i = 0; i < m; i++) {
      const cx = g.x0 + i + half, cz = g.z0 + j + half;
      const dist = Math.hypot(cx - ox, cz - oz);
      if (dist > radius || (home && Math.hypot(cx - home.x, cz - home.z) > homeRange)) continue;
      if (windowSum(g.sums.unloaded, n, i, j, sz)) {
        why.unloaded++;
        continue;
      }
      if (windowSum(g.sums.taken, n, i, j, sz)) {
        why.occupied++;
        continue;
      }
      if (windowSum(g.sums.wet, n, i, j, sz)) {
        why.wet++;
        continue;
      }
      const range = ext.hi[j * m + i] - ext.lo[j * m + i];
      if (range > maxSlope) {
        why.steep++;
        continue;
      }
      const trees = windowSum(g.sums.trees, n, i, j, sz);
      const score0 = range * 6 + windowSum(g.sums.built, n, i, j, sz) * 3 + trees * 0.3 + dist * 0.1;
      if (best && score0 >= best.score) continue;
      // (judged from the window's lowest ground: the level, its median, is not known yet and lies at most maxSlope above)
      const wood = woodNear ? woodNear(cx, cz, ext.lo[j * m + i]) : 0;
      const score = score0 + (woodNear ? Math.max(0, 40 - wood) : 0);
      if (!best || score < best.score) best = { x: cx, z: cz, y: 0, size: sz, range, trees, wood, score };
    }
  if (best) {
    // The ground level is the median height of the site's columns
    const ys: number[] = [];
    for (let z = best.z - half; z < best.z - half + sz; z++)
      for (let x = best.x - half; x < best.x - half + sz; x++) ys.push(g.y[(z - g.z0) * n + (x - g.x0)]);
    ys.sort((u, w) => u - w);
    best.y = ys[ys.length >> 1];
  }
  return best;
}

/** How far find_site looks around its first position, and one step (a leg) further when nothing fits there. */
const SITE_WIDE = 112, SITE_LEG = 40, SITE_LEGS = 2;
/** How far find_site looks in the atlas for a new village, and how far from an atlas candidate the column survey may
 *  move the site (plan step 2.3). */
const ATLAS_RADIUS = 256, ATLAS_CONFIRM = 32;
/** The longest walk to one atlas candidate, and to all of them together. */
const ATLAS_HOP = ATLAS_RADIUS, ATLAS_WALK = 300;
/** Log blocks within 48 blocks that make ground good for a survival village (it needs ~100 logs; Accept8's site had 1). */
const SITE_WOOD = 30;
const COMPASS: Array<[string, number, number]> = [['north', 0, -1], ['northeast', 0.71, -0.71], ['east', 1, 0], ['southeast', 0.71, 0.71], ['south', 0, 1], ['southwest', -0.71, 0.71], ['west', -1, 0], ['northwest', -0.71, -0.71]];

async function findSite(a: BotAgent, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const sz = Math.max(3, Math.min(40, args.size !== undefined ? int(args, 'size') : 9));
  const radius = Math.max(32, Math.min(64, args.radius !== undefined ? int(args, 'radius') : 48));
  const slopes = args.max_slope !== undefined ? [num(args.max_slope, 'max_slope')] : [2, 4];
  const fixed = args.x !== undefined || args.z !== undefined;
  const survival = a.gamemode !== 'creative';
  const v = a.village();
  const home = villageHome(v, a.memory);
  const now = Date.now();
  // Stay off buildings (with a walkway around them) and laid-out plots, of every village (only its own were kept off,
  // so a new village could be laid out over an old one), other villages' prepared plots, and ground reserved by others
  const pad = (q: Area) => ({ x1: q.x1 - 2, z1: q.z1 - 2, x2: q.x2 + 2, z2: q.z2 + 2 });
  const all = [...a.world.villages.villages.values()];
  const taken: Area[] = [
    // (its own annex and works plot too: they lie outside the layouts, 10-09, S.9)
    ...all.flatMap((o) => [...o.structures, ...(o.layouts ?? []), ...(o === v ? o.plots.filter((q) => q.annex || q.works) : o.plots)]).map(pad),
    ...(v ? v.reservations.filter((r) => r.by !== a.name && r.until > now) : []),
  ];
  const logIds = survival ? a.world.registry.blocksArray.filter((b) => TREE_LOG.has(b.name)).map((b) => b.id) : [];
  const why: Rejections = { wet: 0, steep: 0, occupied: 0, unloaded: 0 };
  const start = a.bot.entity.position.clone();
  const surveyed: Array<{ x: number; z: number }> = [];
  // The largest smaller site seen anywhere, in case nothing of the full size turns up
  let fallback: { c: SiteCandidate; logs: Vec3[] } | null = null;
  // Too few trees near a site for a survival village
  const scarce = (c: SiteCandidate) => survival && c.wood < SITE_WOOD;
  // A site of the full size but with no trees near it (survival), kept in case nothing better turns up
  let bare: { c: SiteCandidate; logs: Vec3[] } | null = null;
  // The column survey around one spot: the ground grid and the wood near it
  const survey = (ox: number, oz: number, r = SITE_WIDE + Math.floor(sz / 2), logR = 128) => withScanTurn(signal, async () => {
    const g = await surveyGround(a, ox, oz, r, taken, signal);
    // Survival: a village needs wood, so ground with trees within reach wins (a desert site had none within 128 blocks)
    // Trees, not wood buried far below (mineshaft supports at y=34 under a desert site at y=70 counted as wood near it,
    // and no one could get at them: Accept7), judged by the ground of each log's own column: a floor at the surveying
    // bot's y - 16 missed a valley's trees from a hill and counted buried logs from the mine (T.3 review, as F93)
    const colGround = new Map<string, number | null>();
    const groundOf = (x: number, z: number, yHint: number): number | null => {
      const i = x - g.x0, j = z - g.z0;
      if (i >= 0 && j >= 0 && i < g.n && j < g.n && (g.kind[j * g.n + i] === 0 || g.kind[j * g.n + i] === 2)) return g.y[j * g.n + i];
      const key = `${x},${z}`;
      if (!colGround.has(key)) colGround.set(key, surfaceAt(a, x, z, yHint)?.y ?? null);
      return colGround.get(key)!;
    };
    // (none below the lowest surveyed ground - 16: both counts below take logs from site y - 16 up, F106)
    let lowest = Infinity;
    for (let k = 0; k < g.kind.length; k++) if ((g.kind[k] === 0 || g.kind[k] === 2) && g.y[k] < lowest) lowest = g.y[k];
    const logs = survival ? nearestBlocks(a, logIds, logR, 4096, (q) => {
      const y0 = groundOf(q.x, q.z, q.y);
      return y0 !== null && q.y >= y0 - 16;
    }, Number.isFinite(lowest) ? { min: lowest - 16 } : undefined) : [];
    // ...and not more than 16 below the site itself, as collect and plan_layout count (a hill site counted the valley's
    // trees under it, which no worker may gather: review of B)
    const woodNear = survival ? (x: number, z: number, y: number) => logs.filter((q) => q.y >= y - 16 && Math.hypot(q.x - x, q.z - z) <= 48).length : null;
    return { g, logs, woodNear };
  });
  // Where the atlas knows the land (plan step 2.3): when the ground around the bot has nothing good, its best few areas
  // are checked by the column survey there, nearest first after the best, before any blind leg. Only for an agent in no
  // village and a mayor's first site: workers (told to run find_site after a failed prepare) and a mayor's second plot
  // stay with the local search (the review of 2.3)
  const atlasOk = !fixed && args.atlas !== false && (!v || (a.memory.villageRole === 'mayor' && !v.layouts?.length && !v.plots.length));
  // A new village's first site may lie up to SCOUT_RANGE from where its mayor started (step 2.4: within 96 the spawn's
  // own view had shown everything already); a later site stays within 96 of the village
  const firstSite = !!v && a.memory.villageRole === 'mayor' && !v.layouts?.length && !v.plots.length;
  const homeRange = firstSite ? SCOUT_RANGE : VILLAGE_RANGE;
  // How the search went, for code (step 2.4: a mayor's poor first result sends scouts out), not parsed from the reply
  const verdict = (k: 'good' | 'small' | 'treeless' | 'none') => {
    a.memory.siteSearch = { verdict: k, size: sz, at: Date.now() };
  };
  const tryAtlas = async (): Promise<string | null> => {
    const p0 = a.bot.entity.position.clone();
    let cands = atlasSites(a.world.atlas.chunks, {
      x: Math.floor(p0.x), z: Math.floor(p0.z), size: sz, radius: home ? homeRange : ATLAS_RADIUS,
      home, homeRange, taken, survival,
    });
    const tried: string[] = [];
    let walkedSoFar = 0;
    const own: Rejections = { wet: 0, steep: 0, occupied: 0, unloaded: 0 };
    while (cands.length) {
      checkAbort(signal ?? new AbortController().signal);
      const from = a.bot.entity.position.clone();
      const d = (q: { x: number; z: number }) => Math.hypot(q.x - from.x, q.z - from.z);
      const c = tried.length ? [...cands].sort((u, w) => d(u) - d(w))[0] : cands[0];
      cands = cands.filter((q) => q !== c);
      if (d(c) > ATLAS_HOP || walkedSoFar + d(c) > ATLAS_WALK) {
        tried.push(`${c.x},${c.z} (too far)`);
        continue;
      }
      if (d(c) > 16) {
        await walk(a, new goals.GoalNearXZ(c.x, c.z, 4), `${c.x},${c.z}`, signal ?? new AbortController().signal, 30000 + 600 * Math.round(d(c))).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
        });
        await a.bot.waitForChunksToLoad().catch(() => {});
      }
      const here = a.bot.entity.position;
      walkedSoFar += Math.hypot(here.x - from.x, here.z - from.z);
      if (Math.hypot(here.x - c.x, here.z - c.z) > 24) {
        tried.push(`${c.x},${c.z} (could not get there)`);
        continue;
      }
      surveyed.push({ x: c.x, z: c.z });
      const { g, logs, woodNear } = await survey(c.x, c.z, ATLAS_CONFIRM + Math.floor(sz / 2) + 1, ATLAS_CONFIRM + 48);
      for (const sl of slopes) {
        const b = bestSite(g, sz, sl, c.x, c.z, ATLAS_CONFIRM, home, woodNear, own, homeRange);
        if (!b) continue;
        if (!survival || b.wood >= SITE_WOOD) {
          console.log(`[site] ${a.name}: atlas candidate ${c.x},${c.z} (y ${c.y}, range ${c.range}, ${c.logs} logs, ${c.sand} sand, ${c.dist} away) -> site ${b.x},${b.z}${tried.length ? `; tried ${tried.join(', ')}` : ''}`);
          const w = Math.round(Math.hypot(here.x - p0.x, here.z - p0.z));
          verdict('good');
          return `${siteFound(a, b, logs)} (Found from the atlas: walked ${w} blocks from ${Math.floor(p0.x)},${Math.floor(p0.z)}.)`;
        }
        // Full size but few trees: kept in case nothing better turns up
        bare ??= { c: b, logs };
        break;
      }
      tried.push(`${c.x},${c.z} (no ${sz}x${sz} with trees there on the ground)`);
    }
    if (tried.length) console.log(`[site] ${a.name}: atlas candidates did not hold: ${tried.join(', ')}; searching on from ${Math.floor(a.bot.entity.position.x)},${Math.floor(a.bot.entity.position.z)}`);
    return null;
  };
  let atlasTried = false;
  for (let leg = 0; ; leg++) {
    const p = a.bot.entity.position;
    const ox = fixed && args.x !== undefined ? int(args, 'x') : Math.floor(p.x);
    const oz = fixed && args.z !== undefined ? int(args, 'z') : Math.floor(p.z);
    surveyed.push({ x: ox, z: oz });
    const { g, logs, woodNear } = await survey(ox, oz);
    // Nearby level ground first, then rougher nearby ground (prepare_site cuts and fills it), then farther out
    const tries: Array<[number, number]> = slopes.map((s) => [radius, s]);
    tries.push([SITE_WIDE, slopes[slopes.length - 1]]);
    let treeless = false;
    for (const [r, s] of tries) {
      const c = bestSite(g, sz, s, ox, oz, r, home, woodNear, why, homeRange);
      if (!c) continue;
      // In survival a site without trees near it is a last resort (every building needs wood): look further first
      if (!survival || c.wood >= SITE_WOOD || fixed) {
        verdict(scarce(c) ? 'treeless' : 'good');
        return siteFound(a, c, logs);
      }
      bare ??= { c, logs };
      treeless = true;
      break;
    }
    // Nothing that big: remember the largest that fits here, and in survival one with enough trees near it before a
    // bigger one without (a 29x29 with 19 logs near it beat a 24x24 with 41, Accept8's ground)
    const maxSlope = slopes[slopes.length - 1];
    for (let s = sz - 1; s >= Math.max(9, Math.floor(sz / 2)); s--) {
      if (fallback && !scarce(fallback.c) && s <= fallback.c.size) break;
      const c = bestSite(g, s, maxSlope, ox, oz, SITE_WIDE, home, woodNear, { wet: 0, steep: 0, occupied: 0, unloaded: 0 }, homeRange);
      if (!c) continue;
      if (!scarce(c)) {
        fallback = { c, logs };
        break;
      }
      if (!fallback || c.size > fallback.c.size) fallback = { c, logs };
    }
    // Nearly as big counts as found (models ask for generous sizes, then explore forever looking for them)
    if (fallback && fallback.c.size >= Math.ceil(sz * 0.8) && !treeless && !scarce(fallback.c)) break;
    if (atlasOk && !atlasTried && !signal?.aborted) {
      atlasTried = true;
      const before = a.bot.entity.position.clone();
      const found = await tryAtlas();
      if (found) return found;
      // Somewhere else now: look around there (as a leg)
      if (a.bot.entity.position.distanceTo(before) >= 16) continue;
    }
    if (fixed || leg >= SITE_LEGS || signal?.aborted) break;
    // Walk a leg toward the most dry, loaded land beyond the part already searched, staying within reach of home
    const dirs = COMPASS.map(([name, dx, dz]) => {
      const tx = Math.floor(ox + dx * SITE_LEG), tz = Math.floor(oz + dz * SITE_LEG);
      let land = 0;
      // Toward trees when the ground found so far has too few near it, else toward dry land
      if (treeless || (fallback && scarce(fallback.c)))
        for (const q of logs) {
          const x = q.x - ox, z = q.z - oz, d = Math.hypot(x, z);
          if (d > 20 && (x * dx + z * dz) / d > 0.7) land++;
        }
      else
        for (let k = 0; k < g.n * g.n; k++) {
          if (g.kind[k]) continue;
          const x = g.x0 + (k % g.n) - ox, z = g.z0 + Math.floor(k / g.n) - oz, d = Math.hypot(x, z);
          if (d > 50 && (x * dx + z * dz) / d > 0.92) land++;
        }
      return { name, tx, tz, land };
    }).filter((d) => d.land > 0 && (!home || Math.hypot(d.tx - home.x, d.tz - home.z) <= homeRange)
      && !surveyed.some((q) => Math.hypot(d.tx - q.x, d.tz - q.z) < SITE_LEG * 0.75))
      .sort((u, w) => w.land - u.land);
    let moved = false;
    for (const d of dirs.slice(0, 2)) {
      const from = a.bot.entity.position.clone();
      await walk(a, new goals.GoalNearXZ(d.tx, d.tz, 4), `${d.tx},${d.tz}`, signal ?? new AbortController().signal, 45000).catch(() => {});
      if (a.bot.entity.position.distanceTo(from) >= 16) {
        moved = true;
        await a.bot.waitForChunksToLoad().catch(() => {});
        break;
      }
    }
    if (!moved) break;
  }
  const walked = Math.round(Math.hypot(a.bot.entity.position.x - start.x, a.bot.entity.position.z - start.z));
  const searched = `within ${SITE_WIDE} blocks${walked >= 16 ? ` of ${surveyed.length} spots (walked ${walked} blocks)` : ''}${home ? `, staying within ${homeRange} of the village` : ''}`;
  // A smaller site with trees near it beats a full-size one without
  if (bare && !(fallback && !scarce(fallback.c) && fallback.c.size >= Math.ceil(sz * 0.6))) {
    verdict('treeless');
    return `${siteFound(a, bare.c, bare.logs)} Searched ${searched} for ground with trees near it and found none: a village here needs wood from farther away.`;
  }
  if (fallback) {
    const s = fallback.c.size;
    const rest = siteFound(a, fallback.c, fallback.logs).replace(/^site found: /, '');
    // (nearly as big counts as found, as in the search above)
    verdict(scarce(fallback.c) ? 'treeless' : s >= Math.ceil(sz * 0.8) ? 'good' : 'small');
    if (s >= Math.ceil(sz * 0.6)) return `site found (${s}x${s}, the largest ${searched}; ${sz}x${sz} does not fit): ${rest} Plan the project to fit it: plan_layout lays out what fits and says what does not.`;
    throw new Error(`no ${sz}x${sz} site ${searched}. The largest is smaller: ${rest} It is saved as the last site: plan the project to fit it (plan_layout lays out what fits), or use a smaller size`);
  }
  verdict('none');
  const reasons = [why.wet && `${why.wet} over water`, why.steep && `${why.steep} too steep`, why.occupied && `${why.occupied} taken by buildings, plots or other agents`, why.unloaded && `${why.unloaded} not loaded yet`].filter(Boolean).join(', ');
  throw new Error(`no dry, flat site of ${Math.max(9, Math.floor(sz / 2))}x${Math.max(9, Math.floor(sz / 2))} or more ${searched} (candidates rejected: ${reasons}); try a smaller size${home ? '' : ', or explore in another direction and try again'}`);
}

/** Record a site as the agent's last site (prepare_site and plan_layout default to it) and describe it. */
function siteFound(a: BotAgent, b: SiteCandidate, logs: Vec3[]): string {
  const sz = b.size, half = Math.floor(sz / 2);
  const survival = a.gamemode !== 'creative';
  const v = a.village();
  // The commonest wood kind around it (where gatherers go): a village built from it gathers and builds in one kind
  const kinds: Counts = {};
  const reachable = (q: Vec3) => {
    for (let d = 1; d <= 5; d++) {
      const n = a.bot.blockAt(q.offset(0, -d, 0))?.name ?? '';
      if (/_log$|_leaves$|^air$/.test(n)) continue;
      return true;
    }
    return false;
  };
  for (const q of logs) {
    if (Math.hypot(q.x - b.x, q.z - b.z) > 64 || q.y < b.y - 16 || !reachable(q)) continue;
    const k = /^(.*)_log$/.exec(a.bot.blockAt(q)?.name ?? '')?.[1];
    if (k && WOODS.includes(k)) kinds[k] = (kinds[k] ?? 0) + 1;
  }
  const wood = Object.entries(kinds).sort((u, w) => w[1] - u[1])[0];
  // The biome at the site's centre (V2.3: the street plan's town centre and the library's houses come from it)
  // (only where the column is loaded: an unloaded one reads as id 0, badlands)
  const biomeId = a.bot.blockAt(new Vec3(b.x, b.y, b.z)) ? (a.bot.world.getBiome?.(new Vec3(b.x, b.y + 1, b.z)) as number | undefined) : undefined;
  const biome = biomeId !== undefined ? (a.world.registry.biomes as Record<number, { name: string }>)[biomeId]?.name : undefined;
  a.memory.lastSite = { x: b.x, y: b.y, z: b.z, size: sz, ...(wood && wood[1] >= 12 ? { wood: wood[0], woodLogs: wood[1] } : {}), ...(biome ? { biome } : {}) };
  if (v && a.memory.villageRole === 'mayor') a.world.villages.note(v, `${a.name} found a ${sz}x${sz} site centred at x=${b.x} z=${b.z} (ground y=${b.y})`);
  const plots = ((v ? v.plots : (a.memory.plots as Plot[] | undefined)) ?? []) as Plot[];
  const onPlot = plots.some((q) => q.y === b.y && b.x - half >= q.x1 && b.x - half + sz - 1 <= q.x2 && b.z - half >= q.z1 && b.z - half + sz - 1 <= q.z2);
  const ready = onPlot && b.range === 0 && b.trees === 0 ? ' It is on a prepared plot and already level and clear: build there directly, no prepare_site needed.' : '';
  const woodNote = !survival ? '' : !b.wood ? ' No trees within 48 blocks: wood will have to come from farther away.'
    : b.wood < SITE_WOOD ? ` Only ${b.wood} log blocks within 48 blocks: too few trees for a village (it needs about 100 logs).`
    : ` ${b.wood} log blocks within 48 blocks${wood ? ` (mostly ${wood[0]})` : ''}.`;
  const p = a.bot.entity.position;
  const level = b.range > 2 ? ' (prepare_site levels it)' : '';
  return `site found: centre x=${b.x} z=${b.z}, ground y=${b.y}, ${sz}x${sz}, height range ${b.range}${level}, ${b.trees} tree blocks to clear, ${Math.round(Math.hypot(b.x - p.x, b.z - p.z))} blocks away.${woodNote}${ready}`;
}

// ---------------------------------------------------------------------------------------------
// prepare_site
// ---------------------------------------------------------------------------------------------

async function prepareSite(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  // The scan, from the first column read to the job's targets, holds the scan turn (E.1); given up for walks and the
  // job, and here however the skill ends
  const turn = new ScanTurn();
  try {
    return await prepareSiteHeld(a, args, signal, turn);
  } finally {
    turn.release();
  }
}

async function prepareSiteHeld(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal, turn: ScanTurn): Promise<string> {
  const p = a.bot.entity.position;
  const v = a.village();
  // One part of a layout's plot prepared in parts (S.6, layout=N part=K): its rectangle and margins come from the layout
  // record (2 on the plot's edge, 0 inside: no two parts' claims overlap)
  const layN = args.layout !== undefined ? int(args, 'layout') : undefined;
  const partK = args.part !== undefined ? int(args, 'part') : undefined;
  const ofLay = layN !== undefined ? v?.layouts?.[layN - 1] : undefined;
  const part = partK !== undefined ? ofLay?.parts?.[partK - 1] : undefined;
  if (partK !== undefined && !part) throw new Error(`prepare_site: ${ofLay ? `layout ${layN} has no part ${partK}` : `no layout ${layN ?? '(layout= missing)'} in your village`}; prepare the plot its task names`);
  const last = a.memory.lastSite as { x: number; z: number } | undefined;
  const w = part ? part.x2 - part.x1 + 1 : size(args, 'width', 9, 3, 40), d = part ? part.z2 - part.z1 + 1 : size(args, 'depth', 9, 3, 40), m = size(args, 'margin', 2, 0, 4);
  const cx = part ? part.x1 + Math.floor(w / 2) : args.x !== undefined ? int(args, 'x') : last?.x ?? Math.floor(p.x);
  const cz = part ? part.z1 + Math.floor(d / 2) : args.z !== undefined ? int(args, 'z') : last?.z ?? Math.floor(p.z);
  const x0 = cx - Math.floor(w / 2), z0 = cz - Math.floor(d / 2), x1 = x0 + w - 1, z1 = z0 + d - 1;
  // Margins north, south, west, east
  const [mN, mS, mW, mE] = part ? part.m : [m, m, m, m];
  const surf = new Map<string, Surface>();
  const scan = () => {
    surf.clear();
    const py = Math.floor(a.bot.entity.position.y);
    for (let x = x0 - mW; x <= x1 + mE; x++)
      for (let z = z0 - mN; z <= z1 + mS; z++) {
        const c = surfaceAt(a, x, z, py);
        if (!c) return false;
        surf.set(`${x},${z}`, c);
      }
    return true;
  };
  await turn.take(signal);
  if (!scan()) {
    // A 40 plot's far corners can lie beyond what the server sends from where the preparer stands (V2.4's review): walk
    // to its middle first
    turn.release();
    await walk(a, new goals.GoalNearXZ(cx, cz, 3), `the plot's middle at ${cx},${cz}`, signal, 90000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    await a.bot.waitForChunksToLoad().catch(() => {});
    await turn.take(signal);
    checkAbort(signal);
    if (!scan()) throw new Error(`part of the area is not loaded; walk closer to x=${cx} z=${cz} first`);
  }
  // The layout this area lies in: its streets are laid with it, and a plot prepared in parts keeps one level (S.6)
  const lay = ofLay ?? v?.layouts?.find((l) => l.x1 <= x0 && l.x2 >= x1 && l.z1 <= z0 && l.z2 >= z1);
  const sameAsLay = (q: Area) => !!lay && q.x1 === lay.x1 && q.z1 === lay.z1 && q.x2 === lay.x2 && q.z2 === lay.z2;
  const mode = (counts: Map<number, number>) => {
    if (!counts.size) throw new Error('the area is all water; use find_site to choose dry land');
    return [...counts].sort((u, v) => v[1] - u[1] || u[0] - v[0])[0][0];
  };
  // Level: the most common ground height on the plot itself (least digging and filling), unless given; a part's is the
  // whole layout's (today's rule over the layout), worked out by the first part from a full scan and read by the others
  // (a part never takes another level than its layout's once there is one)
  let y = part && lay?.y !== undefined ? lay.y : args.y !== undefined ? int(args, 'y') : lay?.y ?? (lay ? v?.plots.find(sameAsLay)?.y : undefined) ?? NaN;
  if (part && lay && lay.y === undefined && !Number.isNaN(y)) lay.y = y;
  if (Number.isNaN(y) && part && lay) {
    const layoutCounts = () => {
      const counts = new Map<number, number>();
      const py = Math.floor(a.bot.entity.position.y);
      for (let x = lay.x1; x <= lay.x2; x++)
        for (let z = lay.z1; z <= lay.z2; z++) {
          const c = surfaceAt(a, x, z, py);
          if (!c) return null;
          if (!c.liquid) counts.set(c.y, (counts.get(c.y) ?? 0) + 1);
        }
      return counts;
    };
    let counts = layoutCounts();
    if (!counts) {
      const mx = Math.floor((lay.x1 + lay.x2) / 2), mz = Math.floor((lay.z1 + lay.z2) / 2);
      turn.release();
      await walk(a, new goals.GoalNearXZ(mx, mz, 3), `the plot's middle at ${mx},${mz}`, signal, 90000).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
      });
      await a.bot.waitForChunksToLoad().catch(() => {});
      await turn.take(signal);
      checkAbort(signal);
      // (another part may have worked it out meanwhile; this part's own columns read again from here)
      counts = lay.y === undefined ? layoutCounts() : new Map();
      if (!scan()) throw new Error(`part of the area is not loaded; walk closer to x=${cx} z=${cz} first`);
      if (!counts) throw new Error(`part of the village plot is not loaded; walk closer to x=${mx} z=${mz} first`);
    }
    if (lay.y === undefined) {
      lay.y = mode(counts);
      a.world.villages.save();
      console.log(`[prepare] ${a.name} level y=${lay.y} for layout ${layN} (${(lay.x2 - lay.x1 + 1) * (lay.z2 - lay.z1 + 1)} columns)`);
    }
    y = lay.y;
  }
  if (Number.isNaN(y)) {
    const counts = new Map<number, number>();
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const c = surf.get(`${x},${z}`)!;
        if (!c.liquid) counts.set(c.y, (counts.get(c.y) ?? 0) + 1);
      }
    y = mode(counts);
  }
  const targets: Target[] = [];
  const seen = new Map<string, number>();
  // A block wins over an earlier 'air': a felled tree's cells came first as air, and the fill and grass of a column whose
  // trunk stood at or below the level were dropped as duplicates, leaving pits in a "ready" plot (F95, Shelf1)
  const add = (x: number, yy: number, z: number, block: string) => {
    const k = `${x},${yy},${z}`;
    const i = seen.get(k);
    if (i === undefined) seen.set(k, targets.push({ x, y: yy, z, block }) - 1);
    else if (targets[i].block === 'air' && block !== 'air') targets[i] = { x, y: yy, z, block };
  };
  let columns = 0, protectedCols = 0, felled = 0;
  // A felled tree's crawl never takes a cell in or beside a building (an annex is prepared beside a standing village,
  // 10-09: a tree touching it could reach a house's log frame or roof, lesson 30)
  const builtCells = [...a.world.villages.villages.values()].flatMap((o) => o.structures);
  const nearBuilt = (x: number, yy: number, z: number) => builtCells.some((s) => x >= s.x1 - 1 && x <= s.x2 + 1 && z >= s.z1 - 1 && z <= s.z2 + 1 && yy >= s.y - 1);
  // The village's streets in this area (the street plan, V2.3): dirt_path instead of grass, laid with the levelling (by
  // each part of a plot prepared in parts: the layout that contains the area, S.6)
  const street = (x: number, z: number) => !!lay?.streets?.some((s) => x >= s.x1 && x <= s.x2 && z >= s.z1 && z <= s.z2);
  // A part fells only the cells of trees in its own columns (S.6, lesson 45, F95): another part's are never set to air or
  // counted here, so no log is given twice and no air is set over a neighbour's fill. A cell outside every part's claim
  // belongs to the part whose claim is nearest (clamped onto the plot and its margin), so it too is felled by one
  const claims = part && lay?.parts ? lay.parts.map(partClaim) : null;
  const ours = (x: number, z: number) => {
    if (!claims || !lay) return true;
    const qx = Math.max(lay.x1 - 2, Math.min(lay.x2 + 2, x)), qz = Math.max(lay.z1 - 2, Math.min(lay.z2 + 2, z));
    return claims.findIndex((q) => qx >= q.x1 && qx <= q.x2 && qz >= q.z1 && qz <= q.z2) === partK! - 1;
  };
  // The mine's ground: a column whose cut or fill would reach into the mine (its stairs and hut, or a tunnel the ground
  // is open to) is left as it is, so no fill seals it (F131); a tunnel under solid ground is out of reach of the fill
  const mineBoxes = v?.mine ? mineAreas(v.mine).filter((b) => b.y2 >= y - 8) : [];
  let mineCols = 0;
  let paved = 0;
  const treeLogs = new Set<string>();
  // (every cell a crawl reached, kept or not: a cell skipped beside a building would start a crawl again, the review's L6)
  const crawled = new Set<string>();
  const drops: string[] = [];
  // Columns left as they are (built blocks, chests, margin over a drop): the check after the job passes them over
  const kept = new Set<string>();
  for (let x = x0 - mW; x <= x1 + mE; x++)
    next: for (let z = z0 - mN; z <= z1 + mS; z++) {
      // How far down the ground is (under shallow water: its bottom)
      const c = surf.get(`${x},${z}`)!;
      let g = c.y;
      if (c.liquid) {
        const box = (yy: number) => a.bot.blockAt(new Vec3(x, yy, z))?.boundingBox;
        while (g > y - 10 && box(g) !== 'block') g--;
      }
      if (mineBoxes.some((b) => x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2 && g + 1 <= b.y2)) {
        mineCols++;
        kept.add(`${x},${z}`);
        continue;
      }
      if (y - g > 8) {
        // The margin is only a walkway: where it runs over a drop it is left as it is (F83: a ravine 2 blocks past the
        // site find_site measured refused the whole plot)
        if (x < x0 || x > x1 || z < z0 || z > z1) {
          drops.push(`${x},${z}`);
          kept.add(`${x},${z}`);
          continue;
        }
        // Not "find another site": an executor did, and prepared a plot 43 blocks off the village's layout (F83)
        throw new Error(`the ground at ${x},${z} on the plot is ${y - g} blocks below the level y=${y} (deep water or a ravine): this plot cannot be prepared here; do not prepare a plot anywhere else, the village's buildings are laid out on this one`);
      }
      // Everything above the level goes, but columns with anything built in them are left alone
      const cut: number[] = [];
      for (let yy = y + 1; yy <= y + 32; yy++) {
        const n = blockName(a, x, yy, z) ?? 'air';
        if (n === 'air' || n === 'cave_air') continue;
        if (!NATURAL.has(n)) {
          protectedCols++;
          kept.add(`${x},${z}`);
          continue next;
        }
        cut.push(yy);
      }
      columns++;
      for (const yy of cut) {
        const n = blockName(a, x, yy, z)!;
        // Trees touching the plot are felled whole, so no canopy is left floating
        if ((isLog(n) || isLeaves(n)) && !crawled.has(`${x},${yy},${z}`)) {
          const tree = treeAt(a, x, yy, z);
          let took = 0;
          for (const [tx, ty, tz] of tree) {
            crawled.add(`${tx},${ty},${tz}`);
            if (nearBuilt(tx, ty, tz) || !ours(tx, tz)) continue;
            took++;
            treeLogs.add(`${tx},${ty},${tz}`);
            add(tx, ty, tz, 'air');
          }
          if (took) felled++;
        }
        add(x, yy, z, 'air');
      }
      // Fill low ground and shallow water up to the level
      for (let yy = g + 1; yy < y; yy++) add(x, yy, z, 'dirt');
      const top = blockName(a, x, y, z) ?? 'air';
      const solidTop = a.bot.blockAt(new Vec3(x, y, z))?.boundingBox === 'block';
      if (street(x, z)) {
        if (top !== 'dirt_path') add(x, y, z, 'dirt_path');
        paved++;
      } else if (top !== 'grass_block' && (g < y || top === 'dirt' || !solidTop)) add(x, y, z, 'grass_block');
    }
  if (!columns) throw new Error('the whole area is covered by existing buildings; use find_site to choose another spot');
  // (12000 for a 32 plot's 36x36 with the margin, as much again per column for a 40 plot's 44x44, V2.4)
  const maxWork = Math.max(12000, Math.round(12000 * ((w + mW + mE) * (d + mN + mS)) / (36 * 36)));
  if (targets.length > maxWork) throw new Error(`too much work (${targets.length} blocks, max ${maxWork}); prepare a smaller area`);
  const plot: Plot = { x1: x0, z1: z0, x2: x1, z2: z1, y };
  // Survival: the preparer keeps the logs of the trees it fells (the rest of the earth moving is free landscaping;
  // mushroom stems are cleared but are not logs)
  const logs: Counts = {};
  for (const key of treeLogs) {
    const [tx, ty, tz] = key.split(',').map(Number);
    const n = blockName(a, tx, ty, tz);
    if (n && isLog(n) && n !== 'mushroom_stem') logs[n] = (logs[n] ?? 0) + 1;
  }
  const claim = { area: { x1: x0 - mW, z1: z0 - mN, x2: x1 + mE, z2: z1 + mS }, purpose: part ? `prepare part ${partK} of the village plot` : 'prepare a plot', avoidStructures: false };
  turn.release();
  let summary = await runJob(a, { targets, area: plot, y, free: true, claim }, signal, felled);
  if (a.gamemode !== 'creative' && Object.keys(logs).length) {
    for (const [n, q] of Object.entries(logs)) await a.world.rcon.command(`give ${a.name} ${n} ${q}`);
    summary += `; kept ${listCounts(logs)} from the felled trees`;
  }
  // The plot as it came out (R.3, F95's follow-up): cells that still look unlike the plan are run once more (the
  // server's answer to each command is the check: "Changed" is a real repair), then every plot column must pass the
  // build's own rule (dry, ground at y-1..y, nothing above), or prepare_site fails instead of a build later ("not level")
  await sleep(1000, signal);
  // (only on the plot and its margin: a felled tree's cells beyond are not set again, whatever stands there now)
  const onClaim = (t: Target) => t.x >= claim.area.x1 && t.x <= claim.area.x2 && t.z >= claim.area.z1 && t.z <= claim.area.z2;
  const redo = targets.filter((t) => onClaim(t) && blockName(a, t.x, t.y, t.z) !== null && !alreadyThere(a, t));
  let people = '';
  if (redo.length) {
    const again = await runJob(a, { targets: redo, area: plot, y, free: true, claim }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      return `not redone: ${e.message.slice(0, 120)}`;
    });
    people = /skipped [^;]*where [^;]*stood/.exec(again)?.[0] ?? '';
    console.log(`[prepare] ${a.name}: ${redo.length} cells looked unlike the plan after the job (${redo.slice(0, 6).map((t) => `${t.block} at ${t.x},${t.y},${t.z}`).join('; ')}${redo.length > 6 ? ' ...' : ''}); second pass: ${again}`);
    summary += `; ${redo.length} cells redone (${again.replace(/;.*$/, '')})`;
    await sleep(1000, signal);
  }
  const bad: Array<{ x: number; z: number; y: number; why: string }> = [];
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      if (kept.has(`${x},${z}`)) continue;
      const c = surfaceAt(a, x, z, y);
      if (!c) continue;
      if (c.liquid) bad.push({ x, z, y: c.y, why: 'water' });
      else if (c.y < y - 1) bad.push({ x, z, y: c.y, why: 'hole' });
      else if (c.y > y) bad.push({ x, z, y: c.y, why: 'block above' });
    }
  // The bot's view against the server's (lesson 29), for at most 64 columns; only "Test failed" clears a column (an
  // error or an unexpected reply must not switch the check off)
  const wrong: typeof bad = [];
  for (const b of bad.slice(0, 64)) {
    const ask = b.why === 'hole' ? `execute if block ${b.x} ${y} ${b.z} #minecraft:replaceable if block ${b.x} ${y - 1} ${b.z} #minecraft:replaceable`
      : b.why === 'block above' ? `execute unless block ${b.x} ${b.y} ${b.z} #minecraft:air` : '';
    if (!ask || !/test failed/i.test(await a.world.rcon.command(ask).catch(() => ''))) wrong.push(b);
  }
  wrong.push(...bad.slice(64));
  // Water flows back whatever is done: say so, not "again"
  const wet = wrong.filter((b) => b.why === 'water');
  if (wet.length) throw new Error(`the plot has ${wet.length} columns of water after preparing (${wet.slice(0, 4).map((b) => `${b.x},${b.z}`).join(' ')}${wet.length > 4 ? ' ...' : ''}): water flows in from beside it; this plot cannot be made dry here`);
  if (wrong.length) {
    const kinds = [...new Set(wrong.map((b) => b.why))].join(', ');
    throw new Error(`the plot is not ready after two passes: ${wrong.length} columns not level at y=${y} (${kinds}: ${wrong.slice(0, 4).map((b) => `${b.x},${b.z}`).join(' ')}${wrong.length > 4 ? ' ...' : ''})${people ? `; ${people}` : ''}; run the same prepare_site again`);
  }
  const same = (q: Area) => q.x1 === plot.x1 && q.z1 === plot.z1 && q.x2 === plot.x2 && q.z2 === plot.z2;
  const felledLogs = Object.values(logs).reduce((s, q) => s + q, 0);
  let completes = false;
  if (v) {
    const reg = a.world.villages;
    if (part && lay?.parts) {
      // One plot record for the layout (S.6), from the first part done: the whole layout at its one level, listing the parts
      // done so far, so plots[0] is the village's plot to everything that reads it; "prepared" readers ask preparedAt
      const total = lay.parts.length;
      let rec = v.plots.find(sameAsLay);
      if (!rec) {
        rec = { x1: lay.x1, z1: lay.z1, x2: lay.x2, z2: lay.z2, y, id: reg.id('plot'), preparedBy: a.name, parts: [] };
        v.plots.push(rec);
      }
      // (the part whose record makes it whole checks the seams, or the one run again after a failed check: one at a time)
      if (rec.parts && !rec.parts.some(same)) {
        rec.parts.push({ x1: x0, z1: z0, x2: x1, z2: z1 });
        completes = rec.parts.length >= total;
      } else completes = !!rec.parts && rec.parts.length >= total && !!lay.seamsBad;
      reg.note(v, `${a.name} prepared part ${partK} of ${total} of the village plot at ${areaText(plot)}${rec.parts ? ` (${rec.parts.length} of ${total} done)` : ''}`);
      const done = /placed (\d+) blocks, cleared (\d+)/.exec(summary);
      console.log(`[prepare] ${a.name} part ${partK}/${total} ready: placed ${done?.[1] ?? '?'}, cleared ${done?.[2] ?? '?'}, ${felled} trees, ${felledLogs} logs${mineCols ? `, ${mineCols} mine columns left` : ''}`);
    } else {
      // (in place when prepared again: plots[0] is the village's own plot to everything that reads it, the annex's research)
      const i = v.plots.findIndex(same);
      if (i >= 0) {
        v.plots[i] = { ...v.plots[i], ...plot, preparedBy: a.name };
        // (the whole of a plot that was being prepared in parts: it is whole now)
        delete v.plots[i].parts;
      } else v.plots.push({ ...plot, id: reg.id('plot'), preparedBy: a.name, ...(args.annex === true ? { annex: true } : {}), ...(args.works === true ? { works: true } : {}) });
      reg.note(v, `${a.name} prepared a plot at ${areaText(plot)}`);
    }
    // The felled logs reach the storage (C5): the ground holding the storage hut (or a whole plot) sets the storage up with
    // them while its task is open, so no chest goes on ground still to be levelled (lesson 33); every other part, and any
    // call once the storage stands, deposits them (about 300 logs were stranded with the preparers otherwise). Not the
    // annex or the works plot: their own jobs deposit them
    if (a.gamemode !== 'creative' && args.annex !== true && args.works !== true && (felledLogs || part)) {
      const hut = v.storageHut;
      const holdsHut = !part || !hut || (hut.x1 >= x0 && hut.x2 <= x1 && hut.z1 >= z0 && hut.z2 <= z1);
      const set = holdsHut ? await storageFromFelled(a, signal) : '';
      // (and a part run again after a failed check, which fells nothing more: the logs given the first time)
      const n = set ? 0 : felledLogs || (await logsCarried(a));
      summary += n ? await depositFelled(a, v, n, part ? `part ${partK}` : 'the plot', !holdsHut, signal) : set;
    }
    // The part that completes the record checks the seams between the parts (C7) before the plot counts as whole (after its
    // logs are in: a failed check runs the part again, which fells nothing more)
    const rec = completes ? v.plots.find(sameAsLay) : undefined;
    if (rec?.parts) {
      summary += await seamCheck(a, v, lay!, layN!, partK!, y, signal);
      delete rec.parts;
      reg.save();
    }
  } else a.memory.plots = [...((a.memory.plots as Plot[] | undefined) ?? []).filter((q) => !same(q)), plot].slice(-20);
  const margin = part ? `margins ${mN}/${mS}/${mW}/${mE} north/south/west/east` : `a ${m}-block margin`;
  return `${part ? `part ${partK} of ${lay!.parts!.length} of the village plot ready` : 'plot ready'}: ${w}x${d} centred at x=${cx} z=${cz}, level ground at y=${y} (x ${x0}..${x1}, z ${z0}..${z1}, plus ${margin})${paved ? `, ${paved} blocks of street` : ''}${protectedCols ? `; left ${protectedCols} columns with existing buildings untouched` : ''}${mineCols ? `; left ${mineCols} columns over the mine as they are` : ''}${drops.length ? `; left ${drops.length} margin columns over a drop or deep water as they are (${drops.slice(0, 3).join(' ')}${drops.length > 3 ? ' ...' : ''})` : ''}; ${summary}`;
}

/**
 * The seams of a plot prepared in parts (S.6's C7), checked by the part that completed it: the columns either side of every
 * line between two parts, two deep, by the build's rule (dry, ground at y-1..y, nothing natural above), each failure
 * confirmed on the server (lesson 29). What fails is set right once (lesson 50: the commands' answers are the check) and
 * read again; still wrong, the part fails so its task runs again (`seamsBad` keeps the check for that run). Buildings,
 * anything built and the mine are passed over.
 */
async function seamCheck(a: BotAgent, v: Village, lay: NonNullable<Village['layouts']>[number], n: number, k: number, y: number, signal: AbortSignal): Promise<string> {
  const parts = lay.parts ?? [];
  const cols = new Map<string, [number, number]>();
  const put = (x: number, z: number) => cols.set(`${x},${z}`, [x, z]);
  for (const q of parts) {
    // (an inside side has margin 0: its line, two columns each way)
    for (let d = -2; d <= 1; d++) {
      if (!q.m[0]) for (let x = q.x1; x <= q.x2; x++) put(x, q.z1 + d);
      if (!q.m[1]) for (let x = q.x1; x <= q.x2; x++) put(x, q.z2 + d + 1);
      if (!q.m[2]) for (let z = q.z1; z <= q.z2; z++) put(q.x1 + d, z);
      if (!q.m[3]) for (let z = q.z1; z <= q.z2; z++) put(q.x2 + d + 1, z);
    }
  }
  const mines = v.mine ? mineAreas(v.mine) : [];
  const skip = (x: number, z: number) => x < lay.x1 || x > lay.x2 || z < lay.z1 || z > lay.z2
    || v.structures.some((s) => x >= s.x1 && x <= s.x2 && z >= s.z1 && z <= s.z2) || mines.some((b) => x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2);
  let unloaded = 0, checked = 0;
  const read = async (list: Array<[number, number]>) => {
    const bad: Array<{ x: number; z: number; y: number; why: string }> = [];
    for (const [x, z] of list) {
      const c = surfaceAt(a, x, z, y);
      if (!c) {
        unloaded++;
        continue;
      }
      if (c.liquid) bad.push({ x, z, y: c.y, why: 'water' });
      else if (c.y < y - 1) bad.push({ x, z, y: c.y, why: 'hole' });
      // (a block built there, a lamp or a chest, is not the ground's fault)
      else if (c.y > y && NATURAL.has(blockName(a, x, c.y, z) ?? '')) bad.push({ x, z, y: c.y, why: 'block above' });
    }
    const wrong: typeof bad = [];
    for (const b of bad.slice(0, 64)) {
      const ask = b.why === 'hole' ? `execute if block ${b.x} ${y} ${b.z} #minecraft:replaceable if block ${b.x} ${y - 1} ${b.z} #minecraft:replaceable`
        : b.why === 'block above' ? `execute unless block ${b.x} ${b.y} ${b.z} #minecraft:air` : '';
      if (!ask || !/test failed/i.test(await a.world.rcon.command(ask).catch(() => ''))) wrong.push(b);
    }
    return [...wrong, ...bad.slice(64)];
  };
  const list = [...cols.values()].filter(([x, z]) => !skip(x, z));
  checked = list.length;
  let wrong = await read(list);
  let fixed = '';
  if (wrong.length && !wrong.some((b) => b.why === 'water')) {
    // Set right once: natural blocks above the level cleared, a hole filled to it (grass, or the street's path)
    const targets: Target[] = [];
    for (const b of wrong) {
      if (b.why === 'block above') {
        for (let yy = y + 1; yy <= Math.min(b.y, y + 32); yy++) if (NATURAL.has(blockName(a, b.x, yy, b.z) ?? '')) targets.push({ x: b.x, y: yy, z: b.z, block: 'air' });
      } else {
        for (let yy = b.y + 1; yy < y; yy++) targets.push({ x: b.x, y: yy, z: b.z, block: 'dirt' });
        const street = lay.streets?.some((s) => b.x >= s.x1 && b.x <= s.x2 && b.z >= s.z1 && b.z <= s.z2);
        targets.push({ x: b.x, y, z: b.z, block: street ? 'dirt_path' : 'grass_block' });
      }
    }
    const area = { x1: Math.min(...wrong.map((b) => b.x)), z1: Math.min(...wrong.map((b) => b.z)), x2: Math.max(...wrong.map((b) => b.x)), z2: Math.max(...wrong.map((b) => b.z)) };
    fixed = await runJob(a, { targets, area, y, free: true }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      return `not set right: ${e.message.slice(0, 120)}`;
    });
    console.log(`[prepare] ${a.name}: ${wrong.length} seam columns of layout ${n} not level (${wrong.slice(0, 6).map((b) => `${b.why} at ${b.x},${b.z}`).join('; ')}${wrong.length > 6 ? ' ...' : ''}); set right: ${fixed}`);
    await sleep(1000, signal);
    wrong = await read(wrong.map((b) => [b.x, b.z]));
  }
  console.log(`[prepare] layout ${n} complete: ${parts.length} parts, seams ${checked} columns, ${wrong.length} bad${unloaded ? `, ${unloaded} not loaded` : ''}${fixed ? ' (after setting them right)' : ''}`);
  if (wrong.length) {
    lay.seamsBad = true;
    a.world.villages.save();
    const kinds = [...new Set(wrong.map((b) => b.why))].join(', ');
    throw new Error(`the seams between the village plot's parts are not level at y=${y}: ${wrong.length} columns (${kinds}: ${wrong.slice(0, 4).map((b) => `${b.x},${b.z}`).join(' ')}${wrong.length > 4 ? ' ...' : ''}); run prepare_site layout=${n} part=${k} again`);
  }
  delete lay.seamsBad;
  return `; the plot's ${parts.length} parts are all prepared (seams checked: ${checked} columns${fixed ? ', set right once' : ''})`;
}

/**
 * The felled logs of a part (or of a plot prepared once the storage stands) deposited into the village storage (S.6's C5);
 * with `wait`, for up to 60 s while the storage is being set up (by an agent: not one held back by a test). Returns the
 * summary's note.
 */
async function depositFelled(a: BotAgent, v: Village, n: number, what: string, wait: boolean, signal: AbortSignal): Promise<string> {
  const setting = () => v.tasks.some((t) => t.title === 'Set up the village storage' && (t.status === 'open' || (t.status === 'claimed' && !!t.claimedBy && a.world.isAgent(t.claimedBy))));
  const t0 = Date.now();
  while (!v.storage?.chests.length) {
    if (!wait || !setting() || Date.now() - t0 > 60000) {
      console.log(`[prepare] ${a.name} kept ${n} felled logs (${what}): no village storage${wait && setting() ? ' after 60 s' : ''}`);
      return '';
    }
    await sleep(2000, signal);
  }
  const before = await logsCarried(a);
  try {
    await STORAGE_SKILLS.deposit.run(a, { item: 'logs' }, signal);
  } catch (e) {
    if ((e as Error).message === 'cancelled') throw e;
    console.log(`[prepare] ${a.name} could not deposit the felled logs (${what}): ${(e as Error).message.slice(0, 160)}`);
    return `; the felled logs not deposited (${(e as Error).message.slice(0, 100)})`;
  }
  const put = before - (await logsCarried(a));
  console.log(`[prepare] ${a.name} deposited ${put} felled logs (${what})`);
  return `; deposited ${put} logs into the village storage`;
}

/** How many logs of any kind the agent carries, on the server (lesson 13). */
const logsCarried = async (a: BotAgent) => Number(/Found (\d+)/i.exec(await a.world.rcon.command(`clear ${a.name} #minecraft:logs 0`).catch(() => ''))?.[1] ?? 0);

/**
 * The preparer, carrying the logs of the trees it felled, sets up the village storage itself (the opportunities analysis,
 * 10-08: a second worker collected 10 new logs for the chests while the preparer stood by with 200-380, and the
 * storage, the mining hut and the mine all came ~1.5 min later): the open storage task's own steps, less its collect,
 * then everything deposited, which covers the log tasks at once. Outside a storage hut the first chest finishes the
 * storage task (placeChest). In a hut village the task is held by the preparer and done only once everything is in
 * (S.1): finished at the first chest, its log tasks were claimed while the chests were still empty (Van12a: five agents
 * gathered logs the felled ones covered). Anything failing is only noted: the plot is ready, and the storage task stays
 * on the board as before (done if a chest stands).
 */
async function storageFromFelled(a: BotAgent, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const task = v?.tasks.find((t) => t.title === 'Set up the village storage' && t.status === 'open');
  if (!v || !task || v.storage?.chests.length) return '';
  // (and the hut's table, S.5: made from the felled logs while the task is held, so it stands before anything is crafted)
  const calls = taskCalls(task.detail, new Set(['craft', 'move_to', 'deposit', 'place_station']));
  const chests = Number(calls.find((c) => c.type === 'craft' && c.args.item === 'chest')?.args.count ?? 0);
  const logs = Number(/Found (\d+)/i.exec(await a.world.rcon.command(`clear ${a.name} #minecraft:logs 0`).catch(() => ''))?.[1] ?? 0);
  // (a chest is 8 planks, 2 logs; and a crafting table's log, made if none is near)
  if (!chests || logs < chests * 2 + 1) return '';
  const reg = a.world.villages;
  // (PLAN's scope, hut villages: the only kind the staged runs test, the check's #9)
  const hold = !!v.storageHut;
  if (hold) {
    task.status = 'claimed';
    task.claimedBy = a.name;
    task.updated = Date.now();
    reg.save();
  }
  const run = async () => {
    for (const c of calls) {
      if (c.type === 'craft') await SURVIVAL_SKILLS.craft.run(a, c.args, signal);
      // (into a storage hut the deposit walks to the chest spot's aisle itself; a loose chest goes down beside the agent,
      // so it walks there first, its height read as move_to does: VanO1's walk to the spot's given y found no path)
      else if (c.type === 'move_to') {
        if (v.storageHut) continue;
        const x = Math.floor(num(c.args.x, 'x')), z = Math.floor(num(c.args.z, 'z')), asked = Math.floor(num(c.args.y, 'y'));
        await walk(a, new goals.GoalNear(x, standableY(a, x, asked, z) ?? asked, z, 1), `the storage spot at ${x},${z}`, signal, 90000);
      }
      // (a failed placement leaves the storage set up: the stations task is the fallback)
      else if (c.type === 'place_station')
        await placeStation(a, stationArg(c.args.item), signal, 'the storage set-up').catch((e: Error) => {
          if (e.message === 'cancelled' || unmoved(e)) throw e;
          console.log(`[station] ${a.name}: the ${String(c.args.item)} not placed at the storage set-up: ${e.message.slice(0, 160)}`);
        });
      else await STORAGE_SKILLS.deposit.run(a, c.args, signal);
    }
  };
  try {
    if (hold) {
      await holdingStorageTask(v, run);
      const stocked = Object.entries(storageContents(v)).filter(([, q]) => q > 0).sort((x, y) => y[1] - x[1]);
      const what = stocked.slice(0, 4).map(([n, q]) => `${q} ${n}`).join(', ');
      reg.finish(v, task.id, a.name, `storage set up with the felled logs: ${v.storage?.chests.length ?? 0} chests, holding ${what}`);
      console.log(`[prepare] ${a.name} set up the storage with the felled logs: ${v.storage?.chests.length ?? 0} chests, deposited ${what}; ${task.id} ${v.tasks.find((t) => t.id === task.id)?.status}`);
    } else await run();
    const now = v.tasks.find((t) => t.id === task.id);
    return now?.status === 'done' ? `; set up the village storage with the felled logs (${task.id} done)` : '';
  } catch (e) {
    if ((e as Error).message === 'cancelled') throw e;
    console.log(`[prepare] ${a.name}: the storage not set up with the felled logs: ${(e as Error).message}`);
    // (the first chest may have finished the task before a later step failed)
    const left = v.tasks.find((t) => t.id === task.id)?.status === 'done' || (hold && v.storage?.chests.length) ? `${task.id} done` : `${task.id} stays on the board`;
    return `; the storage not fully set up with the felled logs (${(e as Error).message.slice(0, 100)}): ${left}`;
  } finally {
    // Held and not finished (a failure, or a stop, which sends no report: lesson 67): done if a chest stands, as the first
    // chest would have made it; else back on the board
    const t = v.tasks.find((x) => x.id === task.id);
    if (hold && t?.status === 'claimed' && t.claimedBy === a.name) {
      if (v.storage?.chests.length) reg.finish(v, t.id, a.name, `storage chest at ${v.storage.chests[0].x},${v.storage.chests[0].y},${v.storage.chests[0].z} (the rest of the felled logs not deposited)`);
      else {
        t.status = 'open';
        t.claimedBy = undefined;
        t.updated = Date.now();
        reg.note(v, `${a.name} put ${t.id} "${t.title}" back: the storage was not set up with the felled logs`);
      }
      reg.save();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// build_design, build_box, build
// ---------------------------------------------------------------------------------------------

/**
 * Ground level for a building footprint, or throws why the site is not ready: unloaded, water, not level, trees or
 * rocks in the way (prepare it), or another building (go elsewhere). `leave` holds what the design leaves as it is
 * ("_" cells, as "x,layer,z") and the storage chests standing on them ("x,z": the storage hut is built around them).
 */
function readySite(a: BotAgent, area: Area, height: number, what: string, leave?: { cells: Set<string>; chests: Set<string> }): number {
  const w = area.x2 - area.x1 + 1, d = area.z2 - area.z1 + 1;
  const cx = area.x1 + Math.floor(w / 2), cz = area.z1 + Math.floor(d / 2);
  const prep = `run prepare_site x=${cx} z=${cz} width=${w + 2} depth=${d + 2} first`;
  const there = a.village()?.structures.find((st) => overlaps(area, st) && !(st.kind === 'storage' && leave?.chests.has(`${st.x1},${st.z1}`)));
  if (there) {
    const same = there.kind === what.replace(/"/g, '') ? ' (the same design: if building it here was your task, it is already done)' : '';
    throw new Error(`a ${there.kind} built by ${there.builtBy} already stands at ${areaText(there)}${same}; otherwise pick a free spot on the plot`);
  }
  const py = Math.floor(a.bot.entity.position.y);
  const heights: number[] = [];
  let wet = 0;
  for (let x = area.x1; x <= area.x2; x++)
    for (let z = area.z1; z <= area.z2; z++) {
      if (leave?.chests.has(`${x},${z}`)) continue;
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
        if (leave?.cells.has(`${x},${y - y0},${z}`)) continue;
        const b = a.bot.blockAt(new Vec3(x, y, z));
        if (!b || b.name === 'air' || b.boundingBox === 'empty') continue;
        blocked++;
        if (!NATURAL.has(b.name)) built ||= `${b.name} at ${x},${y},${z}`;
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
  // Design column i (west to east) and row j (north to south), turned clockwise rot times
  const turn = (i: number, j: number): [number, number] => {
    let [u, v, w, h] = [i, j, d.width, d.depth];
    for (let r = 0; r < rot; r++) [u, v, w, h] = [h - 1 - v, u, h, w];
    return [u, v];
  };
  // What the design leaves as it is ("_"), and the village's storage chests standing there: the storage hut is built
  // around its chests (their 1x1 storage records would otherwise make the site "taken")
  const cells = new Set<string>(), columns = new Set<string>();
  d.layers.forEach((layer, li) => layer.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === '_') {
      const [ox, oz] = turn(i, j);
      cells.add(`${area.x1 + ox},${li},${area.z1 + oz}`);
      columns.add(`${area.x1 + ox},${area.z1 + oz}`);
    }
  }));
  const chests = new Set((a.village()?.storage?.chests ?? []).map((c) => `${c.x},${c.z}`).filter((k) => columns.has(k)));
  const kept = (s: Structure) => s.kind === 'storage' && chests.has(`${s.x1},${s.z1}`);
  // The storage hut's table and furnace placed before it (S.5), in their cells on layer 1: left as they are, and their
  // columns not read as ground (a table read as ground put the floor a block up, F59, and the chest check then threw)
  const hv = a.village();
  const hut = d.name === STORAGE_HUT && rot === 0 && hv?.storageHut && hv.storageHut.x1 === area.x1 && hv.storageHut.z1 === area.z1 ? hv : undefined;
  const stationAt = new Map<StationName, { x: number; y: number; z: number }>();
  for (const n of hut ? STATION_NAMES : []) {
    const [dx, dz] = STORAGE_HUT_STATIONS[n];
    const x = area.x1 + dx, z = area.z1 + dz, y = hut!.stations?.[n]?.y ?? stationSpot(hut!, n)?.y;
    if (y !== undefined && a.bot.blockAt(new Vec3(x, y, z))?.name === n) stationAt.set(n, { x, y, z });
  }
  const leave = { cells: new Set([...cells, ...[...stationAt.values()].map((s) => `${s.x},1,${s.z}`)]), chests: new Set([...chests, ...[...stationAt.values()].map((s) => `${s.x},${s.z}`)]) };
  const y0 = pending[key] ?? readySite(a, area, d.height, `"${d.name}"`, leave);
  // A chest the design leaves must be on a "_" cell at its own level: with the floor worked out a block higher (a bump
  // elsewhere in the footprint), the floor layer would be set on top of the chests and empty them
  for (const c of a.village()?.storage?.chests ?? [])
    if (chests.has(`${c.x},${c.z}`) && !cells.has(`${c.x},${c.y - y0},${c.z}`))
      throw new Error(`the storage chest at ${c.x},${c.y},${c.z} is not where the ${d.name} leaves room for it (its floor would be at y=${y0}, the chest at y=${y0 + 1}); level the ground around it (prepare_site keeps off the chests), then build again`);
  // ...and a station likewise on layer 1 (lesson 33), recorded or standing
  for (const n of hut ? STATION_NAMES : []) {
    const s = stationAt.get(n) ?? hut!.stations?.[n];
    if (s && s.y !== y0 + 1)
      throw new Error(`the village's ${n} at ${s.x},${s.y},${s.z} is not where the ${d.name} has it (its floor would be at y=${y0}, the ${n} at y=${y0 + 1}); level the ground around it (prepare_site keeps off it), then build again`);
  }
  // The fallback: a station still missing is put in its cell by the one placer before the walls go up (a worker set up
  // the storage, or the mine gave no stone), so the hut never makes one of its own elsewhere; a failure leaves it to the
  // build's own target
  if (hut && a.gamemode !== 'creative')
    for (const n of STATION_NAMES) {
      if (stationAt.has(n) || stationSpot(hut, n)?.y !== y0 + 1) continue;
      await placeStation(a, n, signal, `the ${d.name} build`).catch((e: Error) => {
        if (e.message === 'cancelled' || unmoved(e)) throw e;
        console.log(`[station] ${a.name}: the ${n} not placed before the ${d.name} (${e.message.slice(0, 160)}); the build places it`);
      });
    }
  const targets: Target[] = [];
  const doors: Array<[number, number, [number, number]]> = [];
  const outside = d.layers[1]?.length === d.depth ? outsideCells(d.layers[1]) : undefined;
  d.layers.forEach((layer, li) =>
    layer.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '_') continue;
        // Facing blocks turn with the building (stairs, logs on their side, trapdoors: phase D)
        const block = ch === '.' ? 'air' : turnState(d.palette[ch], rot);
        const [ox, oz] = turn(i, j);
        const x = area.x1 + ox, z = area.z1 + oz;
        let facing: [number, number] | undefined;
        if (/_door$/.test(baseName(block))) {
          // Out of the building's wall, which an overhang's ring or an L's notch moves in from the grid's edge
          facing = doorOutward(d, i, j, rot, outside, li);
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
  // What the build reserves: a block round the site, or for a building with an overhang its own area (the ring is the
  // clearance: layouts pack by walls, so two neighbours' rings meet over a 2-wide street)
  const claimed = d.style?.overhang ? { ...area } : { x1: area.x1 - 1, z1: area.z1 - 1, x2: area.x2 + 1, z2: area.z2 + 1 };
  // Keep the way out clear in front of each outside door, but not through the design's own cells (an overhang's eave
  // stair over the doorway would be cleared and placed again on every pass) nor another building's (a neighbour's eaves
  // over a 2-wide street)
  const drawn = new Set(targets.map((t) => `${t.x},${t.y},${t.z}`));
  const others: Area[] = (a.village()?.structures ?? []).filter((s) => s.kind !== 'storage' && !(s.x1 === area.x1 && s.z1 === area.z1 && s.kind === d.name));
  // ...and off the buildings the village's build tasks place, built or not (a neighbour being built has no record yet,
  // and its eaves can stand over the street already: the review of D.2)
  for (const t of a.village()?.tasks ?? []) {
    const m = /build_design "([^"]+)" x=(-?\d+) z=(-?\d+)(?: rotate=(\d+))?/.exec(t.detail);
    const pd = m ? lib[m[1]] : undefined;
    if (!m || !pd || (m[1] === d.name && Number(m[2]) === cx && Number(m[3]) === cz)) continue;
    const pr = ((Math.round(Number(m[4] ?? 0) / 90) % 4) + 4) % 4;
    const pw = pr % 2 ? pd.depth : pd.width, pdd = pr % 2 ? pd.width : pd.depth;
    const x1 = Number(m[2]) - Math.floor(pw / 2), z1 = Number(m[3]) - Math.floor(pdd / 2);
    others.push({ x1, z1, x2: x1 + pw - 1, z2: z1 + pdd - 1 });
  }
  const otherWork = (x: number, z: number) => others.some((s) => x >= s.x1 && x <= s.x2 && z >= s.z1 && z <= s.z2);
  for (const [x, z, [fx, fz]] of doors)
    for (let i = 1; i <= 2; i++) {
      const wx = x + fx * i, wz = z + fz * i;
      if (otherWork(wx, wz)) continue;
      if (!drawn.has(`${wx},${y0},${wz}`) && a.bot.blockAt(new Vec3(wx, y0, wz))?.boundingBox !== 'block') work.push({ x: wx, y: y0, z: wz, block: 'dirt', optional: true });
      for (let y = y0 + 1; y <= y0 + 3; y++) if (!drawn.has(`${wx},${y},${wz}`)) work.push({ x: wx, y, z: wz, block: 'air' });
    }
  if (work.length > 60000) throw new Error(`too big (${work.length} blocks, max 60000)`);
  a.memory.pendingBuilds = { ...pending, [key]: y0 };
  const summary = await runJob(a, {
    targets: work, area, y: y0, what: `the ${d.name}`, design: d.name,
    claim: { area: claimed, purpose: `build a ${d.name}`, avoidStructures: true, ignore: kept },
  }, signal).catch((e: Error) => {
    // A fresh build that placed nothing (short of materials, site taken) gets the site checks again next time
    if (pending[key] === undefined && !/^ran out of/.test(e.message)) delete (a.memory.pendingBuilds as Record<string, number>)[key];
    throw e;
  });
  delete (a.memory.pendingBuilds as Record<string, number>)[key];
  const rec = recordStructure(a, { ...area, y: y0, kind: d.name });
  // The hut's stations as the server has them (S.5): what the build placed itself is recorded too, and the stations task
  // closed once both stand
  if (hut) {
    for (const n of STATION_NAMES) {
      if (hut.stations?.[n]) continue;
      const [dx, dz] = STORAGE_HUT_STATIONS[n];
      const p = { x: area.x1 + dx, y: y0 + 1, z: area.z1 + dz };
      if (/passed/i.test(await a.world.rcon.command(`execute if block ${p.x} ${p.y} ${p.z} minecraft:${n}`).catch(() => ''))) recordStation(a, hut, n, p, `the ${d.name} build`);
      else console.log(`[station] ${a.name}: the ${d.name} is built without its ${n} at ${p.x},${p.y},${p.z}`);
    }
    stationsReady(a, hut);
    // (a stations task failed for good is over with the hut: nothing else would close it, and a hard task failed holds the
    // houses and completion; the hut's cells are the stations' from now on, as before S.5)
    for (const t of hut.tasks)
      if (t.title === STATIONS_TASK && t.status === 'failed') {
        t.status = 'done';
        t.result = `the storage hut is built (${STATION_NAMES.map((n) => `${n} ${hut.stations?.[n] ? 'standing' : 'missing'}`).join(', ')})`;
        t.updated = Date.now();
        a.world.villages.note(hut, `${t.id} "${t.title}" closed with the storage hut's build`);
      }
    a.world.villages.save();
  }
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
          if (!NATURAL.has(b.name)) built ||= `${b.name} at ${x},${y},${z}`;
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

/**
 * The street lamps of a village layout (10-06, the user's): a post of the village's wood with a torch on top at each of
 * the layout's lamp cells (desert: two cut sandstone, sandstone itself counts as natural ground), charged like any build.
 * The job stands by the storage hut, where the sticks, fences and charcoal are made (from the lamps' far side the hut's
 * table and furnace were out of reach and new ones would have been put down); the commands reach the whole plot. A
 * column whose ground is not the plot's (or with something built on it) is skipped.
 */
async function lightStreets(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('light_streets: not in a village');
  const k = Math.floor(num(args.layout, 'layout'));
  const lay = v.layouts?.[k - 1];
  if (!lay?.lamps?.length) throw new Error(`light_streets: layout ${k} has no street lamps`);
  // (the board has it wait for the hut's build, S.4; by the record, wherever the bot stands: without the hut's furnace the
  // job billed one of its own, 8 of the hut's cobblestone and a furnace off the plot)
  if (v.storageHut && !villageStationCell(v, 'furnace')) throw new Error("light_streets: the storage hut's furnace is not there yet");
  const desert = v.vanillaBiome === 'desert';
  const post = desert ? ['cut_sandstone', 'cut_sandstone'] : [`${v.wood ?? 'oak'}_fence`];
  const plant = (n: string) => n === 'air' || n === 'cave_air' || (NATURAL.has(n) && !NATURAL_GROUND.has(n) && !LIQUID.has(n));
  // (a post or torch already up counts as free: an earlier try, possibly in another wood when the village's was short)
  const ours = (n: string, i: number) => (i < post.length ? (desert ? n === post[i] : woodPart(n)?.part === 'fence') : n === 'torch');
  const targets: Target[] = [];
  const skipped: string[] = [];
  let y0 = 0;
  for (const l of lay.lamps) {
    // (its part prepared, on a plot prepared in parts: S.6)
    const plot = preparedAt(v, { x1: l.x, z1: l.z, x2: l.x, z2: l.z });
    if (!plot) {
      skipped.push(`${l.x},${l.z} (not on a prepared plot)`);
      continue;
    }
    y0 = plot.y;
    // The post's foot: on the ground at the plot's level or a block below (a cut cell), every cell of the lamp free
    let base: number | null = null;
    for (const g of [plot.y, plot.y - 1]) {
      const ground = blockName(a, l.x, g, l.z);
      const cells = [...post, 'torch'].map((_, i) => blockName(a, l.x, g + 1 + i, l.z));
      if (ground === null || plant(ground) || LIQUID.has(ground) || cells.some((n) => n === null)) continue;
      if (cells.every((n, i) => plant(n!) || ours(n!, i))) {
        base = g + 1;
        break;
      }
    }
    if (base === null) {
      skipped.push(`${l.x},${l.z} (not level or not free)`);
      continue;
    }
    post.forEach((b, i) => targets.push({ x: l.x, y: base! + i, z: l.z, block: b }));
    targets.push({ x: l.x, y: base + post.length, z: l.z, block: 'torch' });
  }
  if (!targets.length) throw new Error(`light_streets: no lamp could be put up (${skipped.join('; ')})`);
  const h = v.storageHut;
  const xs = lay.lamps.map((l) => l.x), zs = lay.lamps.map((l) => l.z);
  const area = h ? { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 } : { x1: Math.min(...xs), z1: Math.min(...zs), x2: Math.max(...xs), z2: Math.max(...zs) };
  const job: Job = { targets, area, y: y0, what: 'the street lamps', task: `light_streets layout=${k}` };
  let out = await runJob(a, job, signal);
  // Checked after, by the block the next step needs (R.3): a torch set before its post would have dropped
  await sleep(1000, signal);
  const missing = targets.filter((t) => !alreadyThere(a, t, true));
  if (missing.length) out += `; again: ${await runJob(a, { ...job, targets: missing }, signal)}`;
  await sleep(1000, signal);
  const lit = targets.filter((t) => t.block === 'torch' && alreadyThere(a, t)).length;
  lay.lit = lit === lay.lamps.length;
  a.world.villages.save();
  return `lit ${lit} street lamp${lit === 1 ? '' : 's'}${skipped.length ? ` (skipped ${skipped.join('; ')})` : ''}: ${out}`;
}

/** A sign's text as SNBT block entity data (26.1: plain strings are literal text), waxed so a player's click does not edit it. */
const signNbt = (text: string[]) => `{front_text:{messages:[${[0, 1, 2, 3].map((i) => JSON.stringify(text[i] ?? '')).join(',')}]},is_waxed:1b}`;

/**
 * The name signs of a village layout (10-08, the user's): a wall sign of the village's wood beside each building's door,
 * at the cells plan_layout chose (placeSigns), charged like any build and made at the storage hut's table (6 planks and a
 * stick make 3). With x and z, only the sign of the building build_design centres there (S.4: one task a building, after
 * its own build); without, every sign of the layout (boards from before). A building not built yet, a wall that is not
 * there or a cell taken is skipped. Checked after on the server (data get): a missing sign is set once more, wrong text is
 * written again (free: text is no item). Each sign's record says whether it is up; one building's job fails unless its
 * sign is, so "done" means checked up, or recorded as never able to go up there (no wall, the cell taken: `never`).
 * Spare signs go into storage by name for the next building's job.
 */
async function putUpSigns(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('put_up_signs: not in a village');
  const k = Math.floor(num(args.layout, 'layout'));
  const lay = v.layouts?.[k - 1];
  if (!lay?.signs?.length) throw new Error(`put_up_signs: layout ${k} has no signs`);
  const one = args.x !== undefined;
  const [bx, bz] = one ? [Math.floor(num(args.x, 'x')), Math.floor(num(args.z, 'z'))] : [0, 0];
  const mine = one ? lay.signs.filter((s) => s.cx === bx && s.cz === bz) : lay.signs;
  if (!mine.length) throw new Error(`put_up_signs: layout ${k} has no sign for the building at ${bx},${bz}`);
  // (a sign is a table recipe: the board has it wait for the hut's build, S.4; checked by the record, as light_streets)
  if (v.storageHut && !villageStationCell(v, 'crafting_table')) throw new Error("put_up_signs: the storage hut's crafting table is not there yet");
  const label = (s: SignSpot) => signTask(v, k, s)?.title.replace(/^Put up the sign: /, '') ?? s.building;
  const plant = (n: string) => n === 'air' || n === 'cave_air' || (NATURAL.has(n) && !NATURAL_GROUND.has(n) && !LIQUID.has(n));
  const step: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const targets: Target[] = [];
  const skipped: string[] = [];
  let y0 = 0;
  for (const s of mine) {
    const built = v.structures.find((t) => t.kind === s.building && s.cx >= t.x1 && s.cx <= t.x2 && s.cz >= t.z1 && s.cz <= t.z2);
    if (!built) {
      skipped.push(`${s.building}'s (not built)`);
      s.why = 'its building is not built';
      continue;
    }
    y0 = built.y;
    const y = built.y + s.layer;
    const [ox, oz] = step[s.facing];
    let wall = blockName(a, s.x - ox, y, s.z - oz), cell = blockName(a, s.x, y, s.z);
    // (not loaded from where the bot stands, a worker back from a far trip: walk near and read again rather than spend one
    // of the task's tries, S.4's review)
    if (wall === null || cell === null) {
      await reach(a, new Vec3(s.x + 0.5, y, s.z + 0.5), 24, signal).catch((e: Error) => {
        if (e.message === 'cancelled' || unmoved(e)) throw e;
      });
      wall = blockName(a, s.x - ox, y, s.z - oz);
      cell = blockName(a, s.x, y, s.z);
    }
    // (a sign already there, of any wood: an earlier try, the village's wood short then)
    if (wall === null || cell === null || !holdsSign(wall) || !(plant(cell) || woodPart(cell)?.part === 'wall_sign')) {
      const why = wall === null || cell === null ? 'not loaded' : !holdsSign(wall) ? `no wall: ${wall}` : `taken: ${cell}`;
      skipped.push(`${s.building}'s at ${s.x},${y},${s.z} (${why})`);
      s.why = why;
      // No wall (a window left open without sand) or a block in the cell, with the building built: it can never go up there,
      // and completion does not wait for it (four tries of the same failure held it ~2 min, S.4's review)
      if (wall !== null && cell !== null) s.never = true;
      continue;
    }
    delete s.never;
    targets.push({ x: s.x, y, z: s.z, block: `${v.wood ?? 'oak'}_wall_sign[facing=${s.facing}]`, nbt: signNbt(s.text) });
  }
  if (!targets.length) {
    a.world.villages.save();
    // (one building's sign that can never go up is done with, as the layout-wide job skipped it)
    if (one && mine.every((s) => s.never)) {
      console.log(`[signs] ${a.name}: the ${label(mine[0])} sign cannot go up (${skipped.join('; ')}); completion does not wait for it`);
      return `no sign put up: it cannot go up there (skipped ${skipped.join('; ')})`;
    }
    throw new Error(`put_up_signs: no sign could be put up (${skipped.join('; ')})`);
  }
  const h = v.storageHut;
  const xs = targets.map((t) => t.x), zs = targets.map((t) => t.z);
  const area = h ? { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 } : { x1: Math.min(...xs), z1: Math.min(...zs), x2: Math.max(...xs), z2: Math.max(...zs) };
  // (the task's own call, so a short job's requeue finds exactly this building's task)
  const job: Job = { targets, area, y: y0, what: 'the signs', task: one ? signCall(k, { cx: bx, cz: bz }) : `put_up_signs layout=${k}` };
  let out = await runJob(a, job, signal);
  // Checked on the server by its text (R.3; the bot's view of a block entity can lag)
  const text = async (t: Target) => (await a.world.rcon.command(`data get block ${t.x} ${t.y} ${t.z} front_text.messages`).catch(() => '')).replace(/^.*following block data: /s, '').trim();
  const signAt = (t: Target) => lay.signs!.find((s) => s.x === t.x && s.z === t.z);
  const want = (t: Target) => `[${[0, 1, 2, 3].map((i) => JSON.stringify(signAt(t)?.text[i] ?? '')).join(', ')}]`;
  await sleep(1000, signal);
  const missing: Target[] = [];
  for (const t of targets) {
    const got = await text(t);
    if (/^\[/.test(got)) {
      if (got.replace(/\s+/g, '') !== want(t).replace(/\s+/g, '')) await a.world.rcon.command(`data merge block ${t.x} ${t.y} ${t.z} ${t.nbt}`).catch(() => '');
    } else missing.push(t);
  }
  if (missing.length) out += `; again: ${await runJob(a, { ...job, targets: missing }, signal)}`;
  await sleep(1000, signal);
  let up = 0;
  for (const t of targets) {
    const s = signAt(t)!;
    s.up = (await text(t)).replace(/\s+/g, '') === want(t).replace(/\s+/g, '');
    s.y = t.y;
    if (s.up) {
      up++;
      delete s.why;
    } else s.why = 'not there or wrong text after two tries (data get)';
  }
  lay.signed = lay.signs.every((s) => s.up);
  a.world.villages.save();
  // The rest of a craft's three into storage by name (a later "all" may never come: lessons 64 and 112)
  const spare = await carriedCounts(a, [...new Set(a.bot.inventory.items().map((it) => it.name).filter((n) => /_sign$/.test(n)))]);
  let deposited = 0;
  for (const [n, q] of Object.entries(spare)) {
    if (q <= 0) continue;
    const ok = await STORAGE_SKILLS.deposit.run(a, { item: n, count: q }, signal).then(() => true, (e: Error) => {
      if (e.message === 'cancelled') throw e;
      return false;
    });
    if (ok) deposited += q;
  }
  // (S.4's proof: each sign by its building's end)
  for (const t of targets) {
    const s = signAt(t)!;
    const build = v.tasks.find((b) => /^Build /.test(b.title) && b.status === 'done' && b.detail.includes(`" x=${s.cx} z=${s.cz} `));
    const lag = build ? `${((Date.now() - build.updated) / 60000).toFixed(1)} min after its build` : 'its build not on the board';
    console.log(`[signs] ${a.name}: the ${label(s)} sign ${s.up ? 'up' : 'NOT up'} at ${t.x},${t.y},${t.z} (data get ${s.up ? 'ok' : 'failed'}), ${lag}; ${deposited} spare deposited`);
  }
  const result = `put up ${up} sign${up === 1 ? '' : 's'}${skipped.length ? ` (skipped ${skipped.join('; ')})` : ''}${deposited ? `; ${deposited} spare put into storage` : ''}: ${out}`;
  if (one && !mine.every((s) => s.up || s.never)) throw new Error(`put_up_signs: the ${label(mine[0])} sign is not up: ${mine.map((s) => s.why).filter(Boolean).join('; ') || result}`);
  return result;
}

/** The biome at a cell in the agent's view ('' where it is not loaded or the view has none; s30's food step). */
export function biomeAt(a: BotAgent, x: number, y: number, z: number): string {
  try {
    return String((a.bot.blockAt(new Vec3(Math.floor(x), Math.floor(y), Math.floor(z))) as { biome?: { name?: string } } | null)?.biome?.name ?? '');
  } catch {
    return '';
  }
}

/**
 * Wheat seeds the open plantings of the fields still need (s30's food step, G3f: a pen's lure held storage's seeds while a
 * neighbourhood field's planting ran, and the field was sown half for good): kept from the pens' lures and breeding. Only
 * with neighbourhood fields (a first layout's field is planted before completion, when no pen works).
 */
export function seedsForFields(v: Village): number {
  if (!GROW_FARMS) return 0;
  let n = 0;
  for (const [i, lay] of (v.layouts ?? []).entries()) {
    const f = lay.farm;
    if (!f || !v.tasks.some((t) => t.detail.startsWith(`tend_farm layout=${i + 1} `) && (t.status === 'open' || t.status === 'claimed'))) continue;
    n += Math.max(0, f.sow.length - (f.planted ?? 0));
  }
  return n;
}

/** The level a job standing by the storage hut looks for footing at: the hut's plot's for a neighbourhood's field or slot,
 *  whose own plot may lie blocks above or below it (s30's food step, lens 2 L2); else `y`. */
function hutLevel(v: Village, k: number, y: number): number {
  const h = v.storageHut;
  if (!h || !v.layouts?.[k - 1]?.grow) return y;
  return v.plots.find((p) => h.x1 >= p.x1 && h.x2 <= p.x2 && h.z1 >= p.z1 && h.z2 <= p.z2)?.y ?? y;
}

/**
 * A village layout's wheat field (10-08, the user's): the channel's water and the farmland are landscaping (free: water
 * needs a bucket, which needs iron; tilling uses no item), but the tiller must carry a hoe (from storage, or made at the
 * storage hut's table from a log's worth of planks); each sown cell is charged a wheat_seeds. As many cells are sown as
 * there are seeds; when short, the seeds are asked for once more (seed tasks posted, the task back on the board), then
 * the farm goes ahead with what there is. The job stands by the storage hut (its table), the commands reach the field.
 * Checked after on the server (farmland, water, wheat), what is missing set once more.
 */
async function tendFarm(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('tend_farm: not in a village');
  const k = Math.floor(num(args.layout, 'layout'));
  const farm = v.layouts?.[k - 1]?.farm;
  if (!farm) throw new Error(`tend_farm: layout ${k} has no farm`);
  // (every part under it prepared, on a plot prepared in parts: S.6)
  const plot = preparedAt(v, farm);
  if (!plot) throw new Error(`tend_farm: the farm at ${areaText(farm)} is not on a prepared plot yet; prepare the village plot first`);
  const y = plot.y;
  const inWater = (x: number, z: number) => x >= farm.water.x1 && x <= farm.water.x2 && z >= farm.water.z1 && z <= farm.water.z2;
  const plant = (n: string) => n === 'air' || n === 'cave_air' || (NATURAL.has(n) && !NATURAL_GROUND.has(n) && !LIQUID.has(n));
  const soil = (n: string) => /^(grass_block|dirt|coarse_dirt|rooted_dirt|dirt_path|farmland)$/.test(n);
  const solid = (x: number, yy: number, z: number) => a.bot.blockAt(new Vec3(x, yy, z))?.boundingBox === 'block';
  const h = v.storageHut;
  const area = h ? { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 } : { x1: farm.x1, z1: farm.z1, x2: farm.x2, z2: farm.z2 };
  const task = `tend_farm layout=${k}`;
  const till: Target[] = [];
  const job: Job = { targets: till, area, y: hutLevel(v, k, y), free: true, what: 'the farm', task };
  // Ground: each cell's at the plot's level (soil, or the channel's water already), nothing built above it
  const skipped: string[] = [];
  const read = () => {
    till.length = 0;
    skipped.length = 0;
    for (let x = farm.x1; x <= farm.x2; x++)
      for (let z = farm.z1; z <= farm.z2; z++) {
        const ground = blockName(a, x, y, z), above = blockName(a, x, y + 1, z);
        const wet = inWater(x, z);
        if (ground === null || above === null) {
          skipped.push(`${x},${z} (not loaded)`);
          continue;
        }
        if (!(soil(ground) || (wet && ground === 'water')) || !(plant(above) || (!wet && above === 'wheat'))) {
          skipped.push(`${x},${z} (${!soil(ground) && ground !== 'water' ? ground : above})`);
          continue;
        }
        if (above !== 'air' && above !== 'cave_air' && above !== 'wheat') till.push({ x, y: y + 1, z, block: 'air' });
        if (wet) {
          // (on solid ground: sand or a cave under the channel lets it drain away, F137; and past its ends, a cut cell or air
          // there lets it run out over the plot, the diff review)
          if (!solid(x, y - 1, z)) till.push({ x, y: y - 1, z, block: 'dirt' });
          for (const [ex, ez] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]])
            if ((ex < farm.x1 || ex > farm.x2 || ez < farm.z1 || ez > farm.z2) && blockName(a, ex, y, ez) !== null && !solid(ex, y, ez)) till.push({ x: ex, y, z: ez, block: 'dirt' });
          if (ground !== 'water') till.push({ x, y, z, block: 'water' });
        } else if (ground !== 'farmland') till.push({ x, y, z, block: 'farmland[moisture=7]' });
      }
  };
  read();
  // (a claimer far off, a neighbourhood's field up to 96 from the hut and the claimer anywhere in the village's range, reads
  // the field as not loaded: read again from the hut, where the job stands anyway; lens 2 M1)
  if (skipped.some((s) => s.endsWith('(not loaded)'))) {
    await standBy(a, job, signal);
    read();
  }
  const notes: string[] = [];
  // A hoe carried (the server's count: lesson 13), else one from storage, else one made at the hut's table
  const hoes = async () => Number(/Found (\d+)/i.exec(await a.world.rcon.command(`clear ${a.name} #minecraft:hoes 0`).catch(() => ''))?.[1] ?? 0);
  if (till.some((t) => /^farmland/.test(t.block)) && !(await hoes())) {
    const kept = Object.keys(storageContents(v)).find((n) => /_hoe$/.test(n));
    if (kept) await withdrawItems(a, v, { [kept]: 1 }, signal);
    if (!(await hoes())) {
      await standBy(a, job, signal);
      const made = await makeFromStock(a, {}, { wooden_hoe: 1 }, () => standBy(a, job, signal), signal).catch((e: Error) => {
        if (e.message === 'cancelled' || unmoved(e)) throw e;
        notes.push(e.message);
        return null;
      });
      if (made) notes.push(made);
    }
    if (!(await hoes())) {
      const again = farm.requeuedHoe ? '' : await requeueBuild(a, job, {}, { wooden_hoe: 1 }, signal);
      if (again) {
        farm.requeuedHoe = true;
        a.world.villages.save();
      }
      throw new Error(`tend_farm: no hoe to till the farm with, and none could be made from the village storage (a wooden_hoe takes 2 planks and 2 sticks at a crafting table${notes.length ? `; ${notes.join('; ')}` : ''})${again}`);
    }
  }
  let out = till.length ? await runJob(a, job, signal) : skipped.length ? 'nothing to lay' : 'the field was laid already';
  await sleep(1000, signal);
  // On the server (R.3; lesson 29): the water and farmland as set, once more where missing
  const there = async (t: { x: number; y: number; z: number }, block: string) => /passed/i.test(await a.world.rcon.command(`execute if block ${t.x} ${t.y} ${t.z} minecraft:${block}`).catch(() => ''));
  const missing: Target[] = [];
  for (const t of till) if (t.block !== 'air' && !(await there(t, t.block.replace(/\[.*$/, '')))) missing.push(t);
  if (missing.length) {
    out += `; again: ${await runJob(a, { ...job, targets: missing }, signal)}`;
    await sleep(1000, signal);
  }
  // Sowing: the sow cells that are farmland now and bare, as many as there are seeds; once more while cells are still bare
  // and seeds turn up (G3f, s30: a pen's lure put storage's seeds back while this sowed 8 of 16, and the requeue then saw
  // them in storage, posted nothing and the field stayed half sown)
  const scan = async () => {
    const bare: Array<[number, number]> = [];
    let n = 0;
    for (const [x, z] of farm.sow) {
      if (!(await there({ x, y, z }, 'farmland'))) continue;
      if (await there({ x, y: y + 1, z }, 'wheat')) n++;
      else if (blockName(a, x, y + 1, z) === 'air') bare.push([x, z]);
    }
    return { sown: n, bare };
  };
  let f = await scan(), have = 0;
  const bare0 = f.bare.length;
  for (let round = 0; round < 2 && f.bare.length; round++) {
    if (v.storage?.chests.length) await refreshStorage(a, v, signal);
    const carried = Number(/Found (\d+)/i.exec(await a.world.rcon.command(`clear ${a.name} wheat_seeds 0`).catch(() => ''))?.[1] ?? 0);
    have = carried + (storageContents(v).wheat_seeds ?? 0);
    const n = Math.min(f.bare.length, have);
    if (!n) break;
    const sowJob: Job = { targets: f.bare.slice(0, n).map(([x, z]) => ({ x, y: y + 1, z, block: 'wheat[age=0]' })), area, y: job.y, what: 'the farm', task };
    out += `; ${await runJob(a, sowJob, signal)}`;
    await sleep(1000, signal);
    f = await scan();
  }
  const sown = f.sown;
  if (bare0) {
    farm.planted = sown;
    a.world.villages.save();
    // Short of seeds (judged on the field: cells still bare): asked for once more (the field so far stays), then the farm
    // goes ahead with what is sown; a harvest sows the bare cells from its seeds (harvest_farm)
    if (f.bare.length && !farm.requeuedSeeds) {
      const again = await requeueBuild(a, { ...job, targets: [] }, {}, { wheat_seeds: f.bare.length }, signal);
      if (again) {
        farm.requeuedSeeds = true;
        a.world.villages.save();
        throw new Error(`tend_farm: sowed ${sown} of ${farm.sow.length} cells; short of ${f.bare.length} wheat_seeds (seeds come from breaking grass).${again}`);
      }
    }
    if (!sown) throw new Error(`tend_farm: no wheat could be sown (${have} wheat_seeds carried and in storage; seeds come from breaking grass)`);
  }
  // Nothing sown and nothing to sow on: the field is not there (every cell skipped), not a farm planted (the diff review)
  if (!sown) throw new Error(`tend_farm: no wheat on the farm at ${areaText(farm)}: no cell could be tilled and sown (skipped ${skipped.slice(0, 6).join('; ') || 'none'})`);
  farm.planted = sown;
  a.world.villages.save();
  return `planted ${sown} wheat on the farm at ${areaText(farm)}${notes.length ? ` (${notes.join('; ')})` : ''}${skipped.length ? ` (skipped ${skipped.slice(0, 6).join('; ')}${skipped.length > 6 ? ' ...' : ''})` : ''}: ${out}`;
}

/** Farms being harvested ("village:layout"): one harvest a field at a time (two would loot the same ripe cell). */
export const harvesting = new Set<string>();

/**
 * A layout's ripe wheat harvested (farming v2, 10-08; a chore code queues, mcWorld.ts farmChores): standing by the
 * storage hut, each ripe cell's loot is given by the server (`loot give ... mine`: the real loot table, 1 wheat and 1-4
 * seeds (VanH1: 49 from 16), no walking on the field) and the cell sown again, charged a seed; a looted cell with no seed left for it is
 * cleared, never left ripe (it would be looted again). The wheat is baked into bread at the hut's table, and the bread,
 * the leftover wheat and the seeds go into storage.
 */
async function harvestFarm(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('harvest_farm: not in a village');
  const k = Math.floor(num(args.layout, 'layout'));
  const farm = v.layouts?.[k - 1]?.farm;
  if (!farm) throw new Error(`harvest_farm: layout ${k} has no farm`);
  const plot = v.plots.find((p) => farm.x1 >= p.x1 && farm.x2 <= p.x2 && farm.z1 >= p.z1 && farm.z2 <= p.z2);
  if (!plot) throw new Error(`harvest_farm: the farm at ${areaText(farm)} is not on a prepared plot`);
  const key = `${v.name}:${k}`;
  if (harvesting.has(key)) throw new Error(`harvest_farm: the farm at ${areaText(farm)} is being harvested already`);
  harvesting.add(key);
  const y = plot.y + 1;
  const record = (ok: boolean, why?: string) => {
    farm.lastHarvest = { at: Date.now(), ok, ...(why ? { why: why.slice(0, 200) } : {}) };
    a.world.villages.save();
  };
  const rcon = (c: string) => a.world.rcon.command(c).catch(() => '');
  // (an error is not 0: a failed seed count once meant every looted cell left bare, the diff review)
  const count = async (item: string) => {
    const r = await rcon(`clear ${a.name} ${item} 0`);
    const m = /Found (\d+)/i.exec(r);
    if (m) return Number(m[1]);
    if (/No items were found/i.test(r)) return 0;
    throw new Error(`harvest_farm: the server did not count ${a.name}'s ${item} (${r.slice(0, 80) || 'no answer'})`);
  };
  const there = async (x: number, z: number, block: string) => /passed/i.test(await rcon(`execute if block ${x} ${y} ${z} minecraft:${block}`));
  try {
    const h = v.storageHut;
    const area = h ? { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 } : { x1: farm.x1, z1: farm.z1, x2: farm.x2, z2: farm.z2 };
    const job: Job = { targets: [], area, y: hutLevel(v, k, plot.y), free: true, what: 'the farm', task: `harvest_farm layout=${k}` };
    await standBy(a, job, signal);
    // Room for the loot: a full inventory loses it silently (the loot command drops nothing)
    await syncInventory(a);
    if (a.bot.inventory.emptySlotCount() < 3) {
      await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch(() => undefined);
      await syncInventory(a);
      if (a.bot.inventory.emptySlotCount() < 3) throw new Error(`harvest_farm: no room for the harvest (${a.bot.inventory.emptySlotCount()} free inventory slots after depositing; 3 needed)`);
    }
    const ripe: Array<[number, number]> = [];
    for (const [x, z] of farm.sow) if (await there(x, z, 'wheat[age=7]')) ripe.push([x, z]);
    if (!ripe.length) {
      record(false, 'nothing ripe');
      return `nothing ripe on the farm at ${areaText(farm)}`;
    }
    checkAbort(signal);
    // From here on every looted cell is sown again or cleared (no abort between: a cell left ripe is looted twice)
    const wheat0 = await count('wheat'), seeds0 = await count('wheat_seeds');
    const looted: Array<[number, number]> = [];
    for (const [x, z] of ripe) if (/Dropped/i.test(await rcon(`loot give ${a.name} mine ${x} ${y} ${z}`))) looted.push([x, z]);
    const notes: string[] = [];
    let wheat = 0, gotSeeds = 0, charged = 0, unpaid = false;
    try {
      wheat = (await count('wheat')) - wheat0;
      const seeds = await count('wheat_seeds');
      gotSeeds = seeds - seeds0;
      const n = Math.min(looted.length, seeds);
      // (a lost answer is settled by counting, E.1: read as 0 taken it left every looted cell bare)
      charged = n ? await a.world.rcon.take(a.name, 'wheat_seeds', n, seeds) : 0;
    } catch (e) {
      // The server's counts did not come back: every looted cell is sown all the same (a bare cell is never sown again;
      // a few seeds not charged is the lesser harm)
      unpaid = true;
      charged = looted.length;
      notes.push(`sown without charging: ${(e as Error).message.slice(0, 100)}`);
    }
    for (const [i, [x, z]] of looted.entries()) await rcon(`setblock ${x} ${y} ${z} minecraft:${i < charged ? 'wheat[age=0]' : 'air'}`);
    // On the server (R.3): each resown cell holds wheat (any age), once more where it does not; what is still missing
    // gets its seed back (a plain wait: a stop here must not skip the refund)
    await new Promise((r) => setTimeout(r, 1000));
    let resown = 0;
    for (const [x, z] of looted.slice(0, charged)) {
      if (!(await there(x, z, 'wheat'))) await rcon(`setblock ${x} ${y} ${z} minecraft:wheat[age=0]`);
      if (await there(x, z, 'wheat')) resown++;
    }
    if (resown < charged && !unpaid) await rcon(`give ${a.name} wheat_seeds ${charged - resown}`);
    if (looted.length > charged) notes.push(`${looted.length - charged} cells left bare: no seed to sow them`);
    // Bare cells of the field sown from the seeds the harvest brought (s30's food step, G3f: a neighbourhood's field planted
    // half while a pen held the seeds gave half its wheat for good), charged a seed each as the resowing is
    let filled = 0;
    if (GROW_FARMS && !unpaid) {
      const bare: Array<[number, number]> = [];
      for (const [x, z] of farm.sow) if ((await there(x, z, 'air')) && /passed/i.test(await rcon(`execute if block ${x} ${plot.y} ${z} minecraft:farmland`))) bare.push([x, z]);
      const spare = bare.length ? await count('wheat_seeds').catch(() => 0) : 0;
      const n = Math.min(bare.length, spare);
      const paid = n ? await a.world.rcon.take(a.name, 'wheat_seeds', n, spare).catch(() => 0) : 0;
      for (const [x, z] of bare.slice(0, paid)) await rcon(`setblock ${x} ${y} ${z} minecraft:wheat[age=0]`);
      if (paid) await new Promise((r) => setTimeout(r, 1000));
      for (const [x, z] of bare.slice(0, paid)) if (await there(x, z, 'wheat')) filled++;
      if (filled < paid) await rcon(`give ${a.name} wheat_seeds ${paid - filled}`);
      if (filled) {
        farm.planted = Math.min(farm.sow.length, (farm.planted ?? 0) + filled);
        notes.push(`sowed ${filled} bare cell${filled > 1 ? 's' : ''}`);
      }
    }
    // (the village's food ledger, s30, as soon as the server's counts give it: the wheat harvested and the seeds beyond those
    // sown; lens 3 L2)
    noteFood(v, 'made', { wheat, wheat_seeds: gotSeeds - charged - filled });
    // Bread at the storage hut's table (never a table put down elsewhere): three wheat a loaf, from the wheat beyond the
    // reserve storage keeps for the pens and the cake (pens v2: hunger does not drain in peaceful, bread can wait)
    let bread = 0;
    const keep = Math.max(0, wheatKeep(v) - (storageContents(v).wheat ?? 0));
    const loaves = Math.floor(Math.max(0, (await count('wheat')) - keep) / 3);
    if (loaves && villageStation(a, 'crafting_table')) {
      const before = await count('bread');
      await SURVIVAL_SKILLS.craft.run(a, { item: 'bread', count: loaves }, signal).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        notes.push(`bread not baked: ${e.message.slice(0, 120)}`);
      });
      bread = (await count('bread')) - before;
      noteFood(v, 'made', { bread });
    } else if (loaves) notes.push("not baked: the storage hut's crafting table is not within reach");
    const stored = await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      notes.push(`not deposited: ${e.message.slice(0, 120)}`);
      return '';
    });
    farm.harvests = (farm.harvests ?? 0) + 1;
    farm.bread = (farm.bread ?? 0) + bread;
    const out = `harvested ${looted.length} ripe wheat at ${areaText(farm)} (${wheat} wheat, ${gotSeeds} seeds), sowed ${resown} again, baked ${bread} bread${stored ? ' into the village storage' : ''}${notes.length ? ` (${notes.join('; ')})` : ''}`;
    record(true);
    a.world.villages.note(v, `${a.name} ${out}`);
    return out;
  } catch (e) {
    record(false, (e as Error).message);
    throw e;
  } finally {
    harvesting.delete(key);
  }
}

/** Farm slots being started or harvested ("village:layout:slot"): one job a slot at a time (set and cleared inside the
 *  skill, so a stopped agent never leaves a slot locked: lesson 67). */
export const slotBusy = new Set<string>();

function slotOf(a: BotAgent, args: Record<string, unknown>, what: string) {
  const v = a.village();
  if (!v) throw new Error(`${what}: not in a village`);
  const k = Math.floor(num(args.layout, 'layout')), j = Math.floor(num(args.slot, 'slot'));
  const slot = v.layouts?.[k - 1]?.slots?.[j - 1];
  if (!slot) throw new Error(`${what}: layout ${k} has no farm slot ${j}`);
  const plot = v.plots.find((p) => slot.x1 >= p.x1 && slot.x2 <= p.x2 && slot.z1 >= p.z1 && slot.z2 <= p.z2);
  if (!plot) throw new Error(`${what}: farm slot ${j} at ${areaText(slot)} is not on a prepared plot`);
  return { v, k, j, slot, plot, key: `${v.name}:${k}:${j}` };
}

/** An item the bot carries, counted on the server (lesson 13); an error is not 0. */
async function serverCount(a: BotAgent, item: string): Promise<number> {
  const r = await a.world.rcon.command(`clear ${a.name} ${item} 0`).catch(() => '');
  const m = /Found (\d+)/i.exec(r);
  if (m) return Number(m[1]);
  if (/No items were found/i.test(r)) return 0;
  throw new Error(`the server did not count ${a.name}'s ${item} (${r.slice(0, 80) || 'no answer'})`);
}

/** Room for loot: a full inventory loses it silently (the loot command drops nothing). */
async function roomForLoot(a: BotAgent, what: string, signal: AbortSignal) {
  await syncInventory(a);
  if (a.bot.inventory.emptySlotCount() >= 3) return;
  await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch(() => undefined);
  await syncInventory(a);
  if (a.bot.inventory.emptySlotCount() < 3) throw new Error(`${what}: no room for the harvest (${a.bot.inventory.emptySlotCount()} free inventory slots after depositing; 3 needed)`);
}

/**
 * A farm slot started with a kind found near the village (opportunistic farming, 10-08; a chore code queues once the
 * village stands, mcWorld.ts farmChores): the farmer walks to the sighting, collects the first plants there (`here`: no
 * walk home first, up to FARM_TRIP_RANGE), makes seeds of pumpkins or melon slices by hand, walks home and lays the slot
 * as the wheat field is laid (the channel's water, farmland or dirt: free landscaping; a hoe for farmland), then plants
 * what it brought (charged one item a cell; slotPlan says where). Checked on the server after. A start that plants
 * nothing leaves the slot free again; the sighting is marked bad when too little was brought from it.
 */
async function startFarm(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const { v, k, j, slot, plot, key } = slotOf(a, args, 'start_farm');
  const kind = str(args.kind, 'kind');
  const spec = SLOT_KINDS[kind];
  if (!spec) throw new Error(`start_farm: no farm kind ${kind} (${SLOT_ORDER.join(', ')})`);
  if (slotBusy.has(key)) throw new ContentionError(`start_farm: farm slot ${j} is busy`, 'busy', `slot:${key}`);
  if (slot.kind && !slot.laying) throw new Error(`start_farm: farm slot ${j} already holds ${slot.kind}`);
  // (from the village storage: a kind the village farms on another slot, its harvests the stock; s30's food step, D4)
  const fromStore = args.from === 'storage';
  const sx = fromStore ? 0 : Math.floor(num(args.x, 'x')), sy = fromStore ? 0 : Math.floor(num(args.y, 'y')), sz = fromStore ? 0 : Math.floor(num(args.z, 'z'));
  slotBusy.add(key);
  const sighting = fromStore ? 'the village storage' : `${sx},${sy},${sz}`;
  const notes: string[] = [];
  const save = () => a.world.villages.save();
  let planted = 0, badSighting = false;
  // (what the storage gave of a food, for the village's ledger: lesson 132)
  let stocked = 0, had = 0, usedNoted = false;
  // (once, by the server's count before anything goes back: the stock withdrawn and the stock carried before it, less what
  // is left; on a failed start too, lens 2 L1 and lens 3 L2-L3)
  const noteUsed = async () => {
    if (!stocked || usedNoted) return;
    const left = await serverCount(a, spec.take).catch(() => null);
    if (left === null) return;
    usedNoted = true;
    noteFood(v, 'used', { [spec.take]: Math.max(0, had + stocked - left) });
  };
  try {
    if (fromStore) {
      // At the storage hut: the kind's count withdrawn (the server's count, lesson 13)
      const h = v.storageHut;
      const area = h ? { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 } : { x1: slot.x1, z1: slot.z1, x2: slot.x2, z2: slot.z2 };
      await standBy(a, { targets: [], area, y: hutLevel(v, k, plot.y), free: true, what: `the ${kind} farm`, task: `start_farm layout=${k} slot=${j}` }, signal);
      // (what a stopped start left carried goes back by name first: seeds are junk to `deposit all`, lesson 112; lens 2 L1)
      for (const item of new Set([spec.take, spec.item]))
        if ((await serverCount(a, item).catch(() => 0)) > 0) await STORAGE_SKILLS.deposit.run(a, { item }, signal).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
        });
      had = await serverCount(a, spec.take);
      if (had < spec.count)
        await withdrawItems(a, v, { [spec.take]: spec.count - had }, signal).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
          notes.push(`withdraw: ${e.message.slice(0, 100)}`);
        });
      stocked = Math.max(0, (await serverCount(a, spec.take)) - had);
    } else {
      // The first plants, where they were seen
      const far = Math.hypot(a.bot.entity.position.x - sx, a.bot.entity.position.z - sz);
      await walk(a, new goals.GoalNearXZ(sx, sz, 3), `the ${kind} at ${sighting}`, signal, 30000 + 700 * Math.round(far)).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        notes.push(`walk: ${e.message.slice(0, 100)}`);
      });
      // (collect fails on a part as well: what was got is counted on the server, the design review's M2)
      await SURVIVAL_SKILLS.collect.run(a, { block: spec.take, count: spec.count, here: true, range: FARM_TRIP_RANGE }, signal).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        notes.push(`collect: ${e.message.slice(0, 140)}`);
      });
    }
    if (spec.make) {
      const took = await serverCount(a, spec.take);
      if (took)
        await SURVIVAL_SKILLS.craft.run(a, { item: spec.make, count: spec.make === 'pumpkin_seeds' ? took * 4 : took }, signal).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
          notes.push(`craft: ${e.message.slice(0, 120)}`);
        });
    }
    const items = await serverCount(a, spec.item);
    if (items < 2) {
      if (fromStore) throw new Error(`start_farm: the village storage gave ${items} ${spec.item} for the ${kind} farm (2 needed)${notes.length ? `; ${notes.join('; ')}` : ''}`);
      // (by column, not cell: the atlas saw the cut stalk's base next and it counted as a new sighting, F192)
      slot.bad = [...(slot.bad ?? []), `${kind}@${sx},${sz}`].slice(-20);
      badSighting = true;
      throw new Error(`start_farm: brought ${items} ${spec.item} from the ${kind} at ${sighting} (2 needed)${notes.length ? `; ${notes.join('; ')}` : ''}`);
    }
    // Home: the slot laid, then planted
    slot.kind = kind;
    slot.laying = true;
    save();
    const home = villageHome(v, a.memory);
    // (from storage it stands at the hut already: the commands reach the slot from there)
    if (!fromStore && home && Math.hypot(a.bot.entity.position.x - home.x, a.bot.entity.position.z - home.z) > 16)
      await walk(a, new goals.GoalNearXZ(Math.floor(home.x), Math.floor(home.z), 8), 'the village', signal, 240000).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        notes.push(`walk home: ${e.message.slice(0, 100)}`);
      });
    const plan = slotPlan(slot, kind);
    const y = plot.y;
    const h = v.storageHut;
    const area = h ? { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 } : { x1: slot.x1, z1: slot.z1, x2: slot.x2, z2: slot.z2 };
    const task = `start_farm layout=${k} slot=${j}`;
    const job: Job = { targets: [], area, y: hutLevel(v, k, y), free: true, what: `the ${kind} farm`, task };
    const soil = (n: string) => /^(grass_block|dirt|coarse_dirt|rooted_dirt|dirt_path|farmland|podzol)$/.test(n);
    const plant = (n: string) => n === 'air' || n === 'cave_air' || (NATURAL.has(n) && !NATURAL_GROUND.has(n) && !LIQUID.has(n));
    const solid = (x: number, yy: number, z: number) => a.bot.blockAt(new Vec3(x, yy, z))?.boundingBox === 'block';
    const skipped: string[] = [];
    const lay: Target[] = [];
    const ok = new Set<string>();
    // The channel (as the wheat field's: on solid ground, its ends closed)
    for (let r = 0; r < 7; r++) {
      const [x, z] = slotCell(slot, 2, r);
      const ground = blockName(a, x, y, z), above = blockName(a, x, y + 1, z);
      if (ground === null || above === null) {
        skipped.push(`${x},${z} (not loaded)`);
        continue;
      }
      if (above !== 'air' && above !== 'cave_air' && plant(above)) lay.push({ x, y: y + 1, z, block: 'air' });
      if (!solid(x, y - 1, z)) lay.push({ x, y: y - 1, z, block: 'dirt' });
      for (const [ex, ez] of [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]])
        if ((ex < slot.x1 || ex > slot.x2 || ez < slot.z1 || ez > slot.z2) && blockName(a, ex, y, ez) !== null && !solid(ex, y, ez)) lay.push({ x: ex, y, z: ez, block: 'dirt' });
      if (ground !== 'water') lay.push({ x, y, z, block: 'water' });
    }
    // Farmland or dirt under the plants and the fruit cells, nothing above
    const wantGround = new Map<string, string>([...plan.farmland.map(([x, z]) => [`${x},${z}`, 'farmland'] as const), ...plan.dirt.map(([x, z]) => [`${x},${z}`, 'dirt'] as const)]);
    for (const [cell, want] of wantGround) {
      const [x, z] = cell.split(',').map(Number);
      const ground = blockName(a, x, y, z), above = blockName(a, x, y + 1, z);
      if (ground === null || above === null) {
        skipped.push(`${x},${z} (not loaded)`);
        continue;
      }
      if (!soil(ground) || !(plant(above) || above === spec.block)) {
        skipped.push(`${x},${z} (${!soil(ground) ? ground : above})`);
        continue;
      }
      ok.add(cell);
      if (above !== 'air' && above !== 'cave_air' && above !== spec.block) lay.push({ x, y: y + 1, z, block: 'air' });
      if (want === 'farmland' && ground !== 'farmland') lay.push({ x, y, z, block: 'farmland[moisture=7]' });
      // (cane does not stand on farmland or a path; fruit grows on either, but a path it cannot: dirt for both)
      // (and plain dirt under cane, which the planting check looks for: podzol and the like set to dirt, the review's L5)
      if (want === 'dirt' && (/^(farmland|dirt_path)$/.test(ground) || (!spec.fruit && !/^(dirt|grass_block)$/.test(ground)))) lay.push({ x, y, z, block: 'dirt' });
    }
    if (spec.farmland && lay.some((t) => /^farmland/.test(t.block))) {
      const hoes = async () => Number(/Found (\d+)/i.exec(await a.world.rcon.command(`clear ${a.name} #minecraft:hoes 0`).catch(() => ''))?.[1] ?? 0);
      if (!(await hoes())) {
        const kept = Object.keys(storageContents(v)).find((n) => /_hoe$/.test(n));
        if (kept)
          await withdrawItems(a, v, { [kept]: 1 }, signal).catch((e: Error) => {
            if (e.message === 'cancelled') throw e;
            notes.push(`hoe: ${e.message.slice(0, 80)}`);
          });
      }
      if (!(await hoes())) {
        await standBy(a, job, signal);
        const made = await makeFromStock(a, {}, { wooden_hoe: 1 }, () => standBy(a, job, signal), signal).catch((e: Error) => {
          if (e.message === 'cancelled' || unmoved(e)) throw e;
          notes.push(e.message.slice(0, 120));
          return null;
        });
        if (made) notes.push(made);
      }
      if (!(await hoes())) throw new Error(`start_farm: no hoe to till the ${kind} farm with, and none could be made from the village storage (a wooden_hoe takes 2 planks and 2 sticks at a crafting table${notes.length ? `; ${notes.join('; ')}` : ''})`);
    }
    let out = lay.length ? await runJob(a, { ...job, targets: lay }, signal) : 'the slot was laid already';
    await sleep(1000, signal);
    const there = async (t: { x: number; y: number; z: number }, block: string) => /passed/i.test(await a.world.rcon.command(`execute if block ${t.x} ${t.y} ${t.z} minecraft:${block}`).catch(() => ''));
    const missing: Target[] = [];
    for (const t of lay) if (t.block !== 'air' && !(await there(t, t.block.replace(/\[.*$/, '')))) missing.push(t);
    if (missing.length) {
      out += `; again: ${await runJob(a, { ...job, targets: missing }, signal)}`;
      await sleep(1000, signal);
    }
    // Planting: as many cells as items carried, on the ground laid for them
    const cells: Array<[number, number]> = [];
    for (const [x, z] of plan.cells) {
      if (!ok.has(`${x},${z}`)) continue;
      if (!(await there({ x, y, z }, spec.farmland ? 'farmland' : 'dirt')) && !(!spec.farmland && (await there({ x, y, z }, 'grass_block')))) continue;
      cells.push([x, z]);
    }
    const n = Math.min(cells.length, await serverCount(a, spec.item));
    const block = spec.block === 'sugar_cane' ? 'sugar_cane' : `${spec.block}[age=0]`;
    const sow: Job = { targets: cells.slice(0, n).map(([x, z]) => ({ x, y: y + 1, z, block })), area, y: job.y, what: `the ${kind} farm`, task };
    if (n) {
      out += `; ${await runJob(a, sow, signal)}`;
      await sleep(1000, signal);
    }
    const grown: Array<[number, number]> = [];
    for (const t of sow.targets) if (await there(t, spec.block)) grown.push([t.x, t.z]);
    planted = grown.length;
    if (!planted) throw new Error(`start_farm: nothing could be planted on farm slot ${j} at ${areaText(slot)} (${n} of ${cells.length} cells with an item; skipped ${skipped.slice(0, 6).join('; ') || 'none'})`);
    slot.planted = planted;
    slot.cells = grown;
    if (spec.fruit) slot.fruit = plan.fruit;
    if (!fromStore) slot.from = [sx, sy, sz];
    delete slot.laying;
    save();
    // (what the storage's stock and the carried stock gave and do not get back, used other than eaten: the ledger's, L5;
    // the carried part counted too, lens 3 L3)
    if (stocked) await noteUsed();
    // What is left over goes into storage (seeds of a stem kind stay carried: JUNK; from storage they go back by name)
    await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      // (nothing to deposit is no news)
      if (!/not carrying anything/.test(e.message)) notes.push(`not deposited: ${e.message.slice(0, 100)}`);
    });
    if (fromStore && spec.item !== spec.take && (await serverCount(a, spec.item).catch(() => 0)) > 0) await STORAGE_SKILLS.deposit.run(a, { item: spec.item }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    const done = `started a ${kind} farm on slot ${j} at ${areaText(slot)}: planted ${planted} from ${fromStore ? sighting : `the ${kind} at ${sighting}`}${notes.length ? ` (${notes.join('; ')})` : ''}`;
    a.world.villages.note(v, `${a.name} ${done}`);
    return `${done}: ${out}`;
  } catch (e) {
    const why = (e as Error).message;
    // Nothing planted: the slot is free again (its laid ground stays; walks are banned only from a slot with a kind)
    if (slot.laying && !planted) {
      delete slot.kind;
      delete slot.laying;
    }
    // (a sighting too poor to start from is marked bad and never chosen again: not the slot's failure, the diff review's M2)
    if (why !== 'cancelled') {
      if (!badSighting) slot.tries = (slot.tries ?? 0) + 1;
      slot.lastTry = { at: Date.now(), kind, why: why.slice(0, 200) };
    }
    save();
    // A start that failed out at the sighting is not left there: the next chore (a pumpkin start) set off 297 blocks from
    // its plants (Minevale33, F192)
    const home = villageHome(v, a.memory);
    if (!signal.aborted && why !== 'cancelled' && home && Math.hypot(a.bot.entity.position.x - home.x, a.bot.entity.position.z - home.z) > 48)
      await teleportHome(a, signal).catch(() => null);
    // (what a start from storage withdrew goes back by name: seeds are junk to `deposit all`, lesson 112; what it used first
    // into the ledger, stopped or not: a stopped start's leftovers stay carried and go back at the next start's beginning)
    if (fromStore) await noteUsed();
    if (fromStore && stocked && !signal.aborted && why !== 'cancelled')
      for (const item of new Set([spec.take, spec.item])) await STORAGE_SKILLS.deposit.run(a, { item }, signal).catch(() => undefined);
    throw e;
  } finally {
    slotBusy.delete(key);
  }
}

/**
 * A farm slot's ripe plants harvested (a chore, as the wheat's): standing by the storage hut, each ripe cell's loot is
 * given by the server (`loot give ... mine`), crops sown again charged one planting item (their loot pays it), cane cut
 * above its base top-down (a cell cleared under cane drops the rest), fruit taken and the stems left; all into storage.
 */
async function harvestSlot(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const { v, k, j, slot, plot, key } = slotOf(a, args, 'harvest_slot');
  const spec = slot.kind ? SLOT_KINDS[slot.kind] : undefined;
  if (!spec || slot.laying) throw new Error(`harvest_slot: farm slot ${j} holds no farm yet`);
  if (slotBusy.has(key)) throw new ContentionError(`harvest_slot: farm slot ${j} is busy`, 'busy', `slot:${key}`);
  slotBusy.add(key);
  const y = plot.y + 1;
  const rcon = (c: string) => a.world.rcon.command(c).catch(() => '');
  const there = async (x: number, yy: number, z: number, block: string) => /passed/i.test(await rcon(`execute if block ${x} ${yy} ${z} minecraft:${block}`));
  const record = (ok: boolean, why?: string) => {
    slot.lastHarvest = { at: Date.now(), ok, ...(why ? { why: why.slice(0, 200) } : {}) };
    a.world.villages.save();
  };
  try {
    const h = v.storageHut;
    const area = h ? { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 } : { x1: slot.x1, z1: slot.z1, x2: slot.x2, z2: slot.z2 };
    await standBy(a, { targets: [], area, y: hutLevel(v, k, plot.y), free: true, what: `the ${slot.kind} farm`, task: `harvest_slot layout=${k} slot=${j}` }, signal);
    await roomForLoot(a, 'harvest_slot', signal);
    const notes: string[] = [];
    let taken = 0;
    // (the village's food ledger, s30: what the harvest leaves carried, counted on the server; only where it keeps one)
    const produce = appetiteOn(v) ? [...new Set([spec.take, spec.item, spec.fruit === 'melon' ? 'melon_slice' : spec.fruit ?? '', slot.kind === 'beetroots' ? 'beetroot' : ''].filter(Boolean))] : [];
    const before = produce.length ? await carriedCounts(a, produce).catch(() => null) : null;
    checkAbort(signal);
    // From here on every looted cell is reset (no abort between: a cell left ripe is looted twice)
    if (spec.ripe !== undefined) {
      const ripe: Array<[number, number]> = [];
      for (const [x, z] of slot.cells ?? []) if (await there(x, y, z, `${spec.block}[age=${spec.ripe}]`)) ripe.push([x, z]);
      if (!ripe.length) {
        record(false, 'nothing ripe');
        return `nothing ripe on the ${slot.kind} farm at ${areaText(slot)}`;
      }
      const looted: Array<[number, number]> = [];
      for (const [x, z] of ripe) if (/Dropped/i.test(await rcon(`loot give ${a.name} mine ${x} ${y} ${z}`))) looted.push([x, z]);
      let charged = looted.length;
      try {
        const have = await serverCount(a, spec.item);
        const n = Math.min(looted.length, have);
        charged = n ? await a.world.rcon.take(a.name, spec.item, n, have) : 0;
      } catch (e) {
        notes.push(`sown without charging: ${(e as Error).message.slice(0, 100)}`);
      }
      for (const [i, [x, z]] of looted.entries()) await rcon(`setblock ${x} ${y} ${z} minecraft:${i < charged ? `${spec.block}[age=0]` : 'air'}`);
      if (looted.length > charged) notes.push(`${looted.length - charged} cells left bare`);
      taken = looted.length;
    } else if (spec.fruit) {
      for (const [x, z] of slot.fruit ?? [])
        if (await there(x, y, z, spec.fruit)) {
          if (/Dropped/i.test(await rcon(`loot give ${a.name} mine ${x} ${y} ${z}`))) taken++;
          await rcon(`setblock ${x} ${y} ${z} minecraft:air`);
        }
    } else {
      // Cane: the blocks above the base, top-down (the design review's M4)
      for (const [x, z] of slot.cells ?? [])
        for (const yy of [y + 2, y + 1])
          if (await there(x, yy, z, 'sugar_cane')) {
            if (/Dropped/i.test(await rcon(`loot give ${a.name} mine ${x} ${yy} ${z}`))) taken++;
            await rcon(`setblock ${x} ${yy} ${z} minecraft:air`);
          }
    }
    if (!taken) {
      record(false, 'nothing ripe');
      return `nothing ripe on the ${slot.kind} farm at ${areaText(slot)}`;
    }
    if (before) {
      const after = await carriedCounts(a, produce).catch(() => null);
      if (after) noteFood(v, 'made', Object.fromEntries(produce.map((n) => [n, (after[n] ?? 0) - (before[n] ?? 0)])));
    }
    const stored = await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      notes.push(`not deposited: ${e.message.slice(0, 120)}`);
      return '';
    });
    slot.harvests = (slot.harvests ?? 0) + 1;
    const out = `harvested ${taken} ${slot.kind} at ${areaText(slot)}${stored ? ' into the village storage' : ''}${notes.length ? ` (${notes.join('; ')})` : ''}`;
    record(true);
    a.world.villages.note(v, `${a.name} ${out}`);
    return out;
  } catch (e) {
    record(false, (e as Error).message);
    throw e;
  } finally {
    slotBusy.delete(key);
  }
}

/** The village preparing its annex (one at a time; the chore's lock, held inside the skill, lesson 67). */
export const annexBusy = new Set<string>();

/**
 * Where the annex goes (10-09): annexCandidates round the village's plot, scored on one column survey. Taken: every
 * village's buildings (+ 2), other villages' plots and layouts (+ 2), ground others reserved, this village's mine hut and
 * stairs; the annex itself must be loaded, dry, untaken, unbuilt, and its claim (+ 2) loaded and dry with ground within
 * plot.y - 4 .. + 5. Lowest score wins: earthwork, trees, and the walk from the storage hut's door.
 *
 * `which` 'works' (S.9): the works plot, of the same geometry, with the annex taken too; only rectangles whose farthest
 * cell is within WORKS_TABLE_RANGE of the hut's crafting table (a craft after a smelt there still finds the hut's table,
 * the check's L6), and "beside the annex" as a score term (D8). The annex's own search keeps off a works plot recorded.
 */
async function annexSpot(a: BotAgent, v: Village, plot: Plot, signal: AbortSignal, which: 'annex' | 'works' = 'annex'): Promise<{ rect: Area & { side: Side }; score: number } | null> {
  const lay0 = v.layouts?.[0];
  const works = which === 'works';
  const bad = new Set((works ? lay0?.works : lay0?.annex)?.bad ?? []);
  // (the other side plot's rectangle, recorded even while it is being prepared)
  const other = works ? lay0?.annex : lay0?.works;
  const table = works ? villageStationCell(v, 'crafting_table') : null;
  if (works && !table) return null;
  const farthest = (c: Area) => Math.max(...[[c.x1, c.z1], [c.x1, c.z2], [c.x2, c.z1], [c.x2, c.z2]].map(([x, z]) => Math.hypot(x - table!.x, z - table!.z)));
  const cands = annexCandidates(plot).filter((c) => !bad.has(`${c.x1},${c.z1}`) && (!works || farthest(c) <= WORKS_TABLE_RANGE));
  if (!cands.length) return null;
  const cx = Math.floor((plot.x1 + plot.x2) / 2), cz = Math.floor((plot.z1 + plot.z2) / 2);
  const r = Math.ceil(Math.max(plot.x2 - plot.x1, plot.z2 - plot.z1) / 2) + 3 + 13 + 4;
  const pad = (q: Area, n: number) => ({ x1: q.x1 - n, z1: q.z1 - n, x2: q.x2 + n, z2: q.z2 + n });
  const all = [...a.world.villages.villages.values()];
  const now = Date.now();
  const taken: Area[] = [
    ...all.flatMap((o) => o.structures).map((s) => pad(s, 2)),
    ...all.filter((o) => o !== v).flatMap((o) => [...(o.layouts ?? []), ...o.plots]).map((q) => pad(q, 2)),
    // (and its own second site, laid out or prepared: the review's L1; and the other side plot, the annex or the works, S.9)
    // (a growth neighbourhood padded 5, as growSite pads the side plots: two prepare margins never touch, s30's review)
    ...[...(v.layouts ?? []).slice(1), ...v.plots.filter((p) => p !== plot && !(works ? p.works : p.annex))].map((q) => pad(q, 'grow' in q && q.grow ? 5 : 2)),
    ...(other && other.x2 >= other.x1 ? [pad(other, 2)] : []),
    ...all.flatMap((o) => o.reservations.filter((q) => q.by !== a.name && q.until > now)),
    // (the mine's hut and stairs, which reach the surface; its tunnels lie 6+ below the level, out of prepare_site's reach)
    ...(v.mine ? mineAreas(v.mine).filter((b) => b.y2 >= plot.y - 4) : []),
  ];
  // (prepare_annex's survey takes the scan turn as find_site's does, E.1)
  const g = await withScanTurn(signal, () => surveyGround(a, cx, cz, r, taken, signal));
  const m = g.n + 1;
  const rectSum = (P: Int32Array, q: Area) => {
    const i = q.x1 - g.x0, j = q.z1 - g.z0, w = q.x2 - q.x1 + 1, h = q.z2 - q.z1 + 1;
    return P[(j + h) * m + i + w] - P[j * m + i + w] - P[(j + h) * m + i] + P[j * m + i];
  };
  const inGrid = (q: Area) => q.x1 >= g.x0 && q.z1 >= g.z0 && q.x2 < g.x0 + g.n && q.z2 < g.z0 + g.n;
  const h = v.storageHut;
  const door = h ? { x: h.x1 + 3, z: h.z2 + 1 } : { x: cx, z: cz };
  let best: { rect: Area & { side: Side }; score: number } | null = null;
  for (const c of cands) {
    const claim = pad(c, 2);
    if (!inGrid(claim)) continue;
    if (rectSum(g.sums.taken, c) || rectSum(g.sums.built, c) || rectSum(g.sums.unloaded, claim) || rectSum(g.sums.wet, claim)) continue;
    let earth = 0, ok = true;
    for (let z = claim.z1; z <= claim.z2 && ok; z++)
      for (let x = claim.x1; x <= claim.x2; x++) {
        const k = (z - g.z0) * g.n + (x - g.x0);
        // (a taken cell of the margin is a building's walkway or the plot's own margin: prepare_site keeps built columns)
        if (g.kind[k] === 3) continue;
        const dy = g.y[k] - plot.y;
        if (dy < -4 || dy > 5) {
          ok = false;
          break;
        }
        earth += Math.abs(dy);
      }
    if (!ok) continue;
    const mid = c.side === 's' ? { x: c.x1 + 6, z: c.z1 } : c.side === 'n' ? { x: c.x1 + 6, z: c.z2 } : c.side === 'e' ? { x: c.x1, z: c.z1 + 6 } : { x: c.x2, z: c.z1 + 6 };
    // (the works plot beside the annex: centre to centre, D8)
    const besideAnnex = works && other && other.x2 >= other.x1
      ? 0.5 * (Math.abs((c.x1 + c.x2) / 2 - (other.x1 + other.x2) / 2) + Math.abs((c.z1 + c.z2) / 2 - (other.z1 + other.z2) / 2)) : 0;
    const score = earth + 0.3 * rectSum(g.sums.trees, claim) + 0.5 * (Math.abs(mid.x - door.x) + Math.abs(mid.z - door.z)) + besideAnnex;
    if (!best || score < best.score) best = { rect: c, score };
  }
  return best;
}

/**
 * The annex (10-09, the user's choice; a chore code queues once the village is complete): a 13x9 plot beside the
 * village's own, prepared by prepare_site at the plot's level, with two slots for pens. The rectangle is recorded before
 * the work (a restart prepares the same one again: prepare_site skips what is done); one that fails for its ground is
 * marked bad and another is chosen next time.
 */
async function prepareAnnex(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const lay = v?.layouts?.[0];
  if (!v || !lay) throw new Error('prepare_annex: the village has no layout');
  const plot = v.plots.find((p) => !p.annex && overlaps(p, lay));
  if (!plot) throw new Error('prepare_annex: the village plot is not prepared');
  if (annexBusy.has(v.name)) throw new Error('prepare_annex: the annex is being prepared');
  annexBusy.add(v.name);
  const save = () => a.world.villages.save();
  try {
    let ax = lay.annex;
    if (ax?.state === 'ready') return `the annex at ${areaText(ax)} is ready`;
    const home = villageHome(v, a.memory);
    if (home && Math.hypot(a.bot.entity.position.x - home.x, a.bot.entity.position.z - home.z) > 24)
      await walk(a, new goals.GoalNearXZ(Math.floor(home.x), Math.floor(home.z), 6), 'the village', signal, 120000).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
      });
    if (!ax || ax.x2 < ax.x1) {
      const spot = await annexSpot(a, v, plot, signal);
      if (!spot) throw new Error(`prepare_annex: no room for a 13x9 annex beside the plot at ${areaText(plot)} (every side taken, wet, too steep or built on)`);
      ax = lay.annex = { ...lay.annex, x1: spot.rect.x1, z1: spot.rect.z1, x2: spot.rect.x2, z2: spot.rect.z2, y: plot.y, side: spot.rect.side, state: 'preparing' };
      save();
      console.log(`[annex] ${v.name}: ${a.name} prepares the annex at ${areaText(ax)} (${ax.side} of the plot, score ${Math.round(spot.score)})`);
    }
    const w = ax.x2 - ax.x1 + 1, d = ax.z2 - ax.z1 + 1;
    const out = await prepareSite(a, { x: ax.x1 + Math.floor(w / 2), z: ax.z1 + Math.floor(d / 2), width: w, depth: d, y: ax.y, margin: 2, annex: true }, signal);
    const rec = v.plots.find((p) => p.x1 === ax!.x1 && p.z1 === ax!.z1 && p.x2 === ax!.x2 && p.z2 === ax!.z2);
    if (rec) rec.annex = true;
    lay.slots ??= [];
    if (!lay.slots.some((s) => s.annex)) lay.slots.push(...annexSlots({ ...ax, side: ax.side }).map((s) => ({ ...s, annex: true })));
    ax.state = 'ready';
    save();
    a.world.villages.note(v, `${a.name} prepared the annex at ${areaText(ax)} for the pens`);
    // (the felled trees' logs)
    const stored = await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      return '';
    });
    return `prepared the annex at ${areaText(ax)} (${ax.side} of the plot) with 2 pen slots: ${out.replace(/^plot ready: /, '')}${stored ? '; deposited what it carried' : ''}`;
  } catch (e) {
    const why = (e as Error).message;
    if (why !== 'cancelled' && !signal.aborted) {
      // (an empty rectangle: none chosen yet, or the last one given up)
      const ax = (lay.annex ??= { x1: 0, z1: 0, x2: -1, z2: -1, y: plot.y, side: 'n', state: 'preparing' });
      // Ground that cannot be made ready: another rectangle next time
      if (ax.state !== 'ready' && ax.x2 >= ax.x1 && /cannot be prepared here|cannot be made dry|not ready after two passes|whole area is covered|too much work/.test(why)) {
        ax.bad = [...(ax.bad ?? []), `${ax.x1},${ax.z1}`].slice(-20);
        ax.x2 = ax.x1 - 1;
      }
      ax.tries = (ax.tries ?? 0) + 1;
      ax.lastTry = { at: Date.now(), why: why.slice(0, 200) };
    }
    save();
    throw e;
  } finally {
    annexBusy.delete(v.name);
  }
}

/** The village laying out a neighbourhood (one at a time; the chore's lock, held inside the skill, lesson 67). */
export const growBusy = new Set<string>();

/**
 * Where the next neighbourhood goes (s30, D6): an S x S square of the village's own survey round its home, not find_site
 * (its legs, atlas walks, smaller fallbacks and `lastSite` belong to the mayor's first site, lesson 74). Centres within
 * GROW.range of home (a 23 pad's corners stay within 96), slope 2, then 4, full size only. Taken, padded 5 (two
 * prepare_site margins of 2 never touch): find_site's list (every village's buildings and layouts, other villages' plots,
 * its own annex and works plot); the annex and works rectangles while they are prepared; while a side plot is still to be
 * chosen (fewer than 3 tries), a ring of 18 round the first plot for it; the mine's hut and stairs near the surface; and
 * the chunks holding a sighted sugar cane, pumpkin or melon, each chunk padded 2 (rare plants a farm slot starts from,
 * lesson 99); and the squares plan_layout refused before (`growth.bad`). A column with no ground within 48 counts as wet.
 * Null with the survey's rejections. The pad ladder (s30's food step, D2): one survey at the largest pad's radius, each
 * option's size tried in order (slope 2, then 4), the first found returned with its option.
 */
async function growSite(a: BotAgent, v: Village, opts: PadOption[], signal: AbortSignal): Promise<{ x: number; y: number; z: number; opt: PadOption } | { why: string }> {
  const home = villageHome(v, a.memory);
  if (!home) return { why: 'the village has no home' };
  const r = Math.max(...opts.map((o) => growReach(o.size) + Math.ceil(o.size / 2) + 1));
  const taken = growTaken(a, v, home, r);
  const why: Rejections = { wet: 0, steep: 0, occupied: 0, unloaded: 0 };
  // (the survey takes the scan turn as find_site's and the annex's do, E.1)
  const g = await withScanTurn(signal, () => surveyGround(a, home.x, home.z, r, taken, signal, true));
  for (const opt of opts) {
    const S = opt.size, reach = growReach(S);
    for (const slope of [2, 4]) {
      for (const k of Object.keys(why) as Array<keyof Rejections>) why[k] = 0;
      const c = bestSite(g, S, slope, home.x, home.z, reach, home, null, why, reach);
      if (c) return { x: c.x, y: c.y, z: c.z, opt };
    }
  }
  return { why: `wet ${why.wet}, steep ${why.steep}, taken ${why.occupied}, unloaded ${why.unloaded}` };
}

/** lay_out_houses' `options` ("30:4:2,27:3:1,22:4:-1": size, houses, slots; slots -1: no field), in order. */
function padOptions(raw: unknown, houses: number): PadOption[] {
  const out = String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [S, n, k] = s.split(':').map(Number);
    if (![S, n, k].every(Number.isFinite)) throw new Error(`lay_out_houses: an option is size:houses:slots, not "${s}"`);
    return { size: Math.max(9, Math.min(40, Math.floor(S))), n: Math.max(1, Math.min(houses, Math.floor(n))), slots: Math.max(-1, Math.min(2, Math.floor(k))) };
  });
  if (!out.length) throw new Error('lay_out_houses: options= is empty (size:houses:slots, comma-separated)');
  return out;
}

/** An option as the [grow] lines name it ("30x30, 4 houses, field + 2 slots"). */
const optionText = (o: PadOption) => `${o.size}x${o.size}, ${o.n} house${o.n > 1 ? 's' : ''}, ${o.slots < 0 ? 'no field' : `field + ${o.slots} slot${o.slots === 1 ? '' : 's'}`}`;

/** How far from home a neighbourhood's centre may be: GROW.range, less what keeps an S x S pad's corners within the
 *  village's range (80 for 23; a 29 pad at 80 reached 99.8, s30's review). */
const growReach = (S: number) => Math.min(GROW.range, VILLAGE_RANGE - Math.ceil(Math.max(Math.floor(S / 2), S - 1 - Math.floor(S / 2)) * Math.SQRT2));

/** The ground growSite keeps off (its doc), read now: built again after the survey to test the square chosen (the village's
 *  records may have changed meanwhile, s30's review). */
function growTaken(a: BotAgent, v: Village, home: { x: number; z: number }, r: number): Area[] {
  const lay0 = v.layouts?.[0];
  const pad = (q: Area, n: number) => ({ x1: q.x1 - n, z1: q.z1 - n, x2: q.x2 + n, z2: q.z2 + n });
  const all = [...a.world.villages.villages.values()];
  const now = Date.now();
  const sides = [lay0?.annex, lay0?.works].filter((q): q is NonNullable<typeof q> => !!q && q.x2 >= q.x1);
  // (a side plot not chosen yet keeps a ring round the plot free for it: the annex always, the works plot with its family)
  const ringFor = (q: { x2: number; x1: number; tries?: number } | undefined) => (!q || q.x2 < q.x1) && (q?.tries ?? 0) < 3;
  const ring = lay0 && (ringFor(lay0.annex) || (CHOOSE.families.has('works') && ringFor(lay0.works))) ? [pad(lay0, 18)] : [];
  const level = v.plots.find((p) => !p.annex && !p.works && lay0 && overlaps(p, lay0))?.y ?? Math.floor(a.bot.entity.position.y);
  const plants: Area[] = [];
  for (const kind of ['sugar_cane', 'pumpkin', 'melon'])
    for (const [x, , z] of a.world.atlas.sightings(kind, home.x, home.z, r + 24)) {
      const cx = Math.floor(x / 16) * 16, cz = Math.floor(z / 16) * 16;
      plants.push({ x1: cx - 2, z1: cz - 2, x2: cx + 17, z2: cz + 17 });
    }
  return [
    // (every plot of every village: its own outside the layouts too, an executor's own prepare_site, s30's review)
    ...all.flatMap((o) => [...o.structures, ...(o.layouts ?? []), ...o.plots]).map((q) => pad(q, 5)),
    ...sides.map((q) => pad(q, 5)),
    ...ring,
    ...(v.mine ? mineAreas(v.mine).filter((b) => b.y2 >= level - 6) : []),
    ...plants,
    ...(v.growth?.bad ?? []),
    ...all.flatMap((o) => o.reservations.filter((q) => q.by !== a.name && q.until > now)),
  ];
}

/**
 * The next neighbourhood laid out (s30; a chore code queues once the village is complete and has fewer houses than
 * members, never a model's tool): home first, a square found (growSite), then plan_layout's neighbourhood mode posts its
 * tasks as 'grow', synchronously after the survey, so the layout record holds the ground from the moment it is chosen
 * (D7). `houses`: the design names, comma-separated; `size`: the pad's side (grow.ts padFor); or `options` (s30's food
 * step, D2: grow.ts padLadder's rungs as "size:houses:slots,...", the first `houses` of the list each, slots -1 no field),
 * tried in order on one survey.
 */
async function layOutHouses(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('lay_out_houses: not in a village');
  if (!GROW.on) throw new Error('lay_out_houses: growth is off (MC_GROW)');
  if (!v.complete) throw new Error('lay_out_houses: the village is not complete yet');
  if (v.growth?.active) throw new Error(`lay_out_houses: neighbourhood ${v.growth.active.k} is still being built`);
  if (growBusy.has(v.name)) throw new Error('lay_out_houses: a neighbourhood is being laid out');
  const all = (Array.isArray(args.houses) ? args.houses : String(args.houses ?? '').split(',')).map((h) => String(h).trim()).filter(Boolean);
  if (!all.length) throw new Error('lay_out_houses: give houses= (design names, comma-separated)');
  const ladder = args.options !== undefined;
  const opts: PadOption[] = ladder ? padOptions(args.options, all.length) : [{ size: Math.max(9, Math.min(40, Math.floor(num(args.size, 'size')))), n: all.length, slots: -1 }];
  growBusy.add(v.name);
  try {
    // Out of the deep first (lesson 101: never walked up from the iron level or a cave), then home, as prepare_annex
    const plotY = v.plots[0]?.y ?? a.bot.entity.position.y;
    if (inIronLevel(a) || a.bot.entity.position.y < plotY - 4) await teleportHome(a, signal);
    const home = villageHome(v, a.memory);
    if (home && Math.hypot(a.bot.entity.position.x - home.x, a.bot.entity.position.z - home.z) > 24)
      await walk(a, new goals.GoalNearXZ(Math.floor(home.x), Math.floor(home.z), 6), 'the village', signal, 120000).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
      });
    const site = await growSite(a, v, opts, signal);
    if ('why' in site) {
      const S0 = opts[0].size, rest = opts.slice(1).map((o) => `${o.size}x${o.size}`);
      throw new Error(`lay_out_houses: no free ${S0}x${S0} site${rest.length ? ` (nor ${rest.join(', ')})` : ''} within ${growReach(S0)} blocks of the village (${site.why})`);
    }
    const S = site.opt.size, houses = all.slice(0, site.opt.n);
    // (no await from here to the record: D7. The village may have changed during the survey: growth stopped, enough houses
    // for the members now, or the square taken by records written meanwhile, tested against the list read afresh)
    if (!v.complete || v.growth?.active || v.growth?.stop) throw new Error('lay_out_houses: the village changed during the survey');
    if (housesOf(v) >= a.world.growMembers(v).length) throw new Error('lay_out_houses: the village changed during the survey (enough houses)');
    const square = { x1: site.x - Math.floor(S / 2), z1: site.z - Math.floor(S / 2), x2: site.x - Math.floor(S / 2) + S - 1, z2: site.z - Math.floor(S / 2) + S - 1 };
    const clash = home && growTaken(a, v, home, growReach(S) + Math.ceil(S / 2) + 1).find((q) => overlaps(square, q));
    if (clash) throw new Error(`lay_out_houses: the village changed during the survey (the square at ${areaText(square)} is taken now)`);
    const before = new Set(v.tasks.map((t) => t.id));
    const field = site.opt.slots >= 0 ? { farm: true, slots: site.opt.slots } : {};
    // (a field's biome rule reads the village's library biome, else the site's: the biome the view has there, lens 2 L5)
    const biome = site.opt.slots >= 0 && !v.vanillaBiome ? biomeAt(a, site.x, site.y + 1, site.z) : '';
    const out = postLayout(a.world, v, a.name, { x: site.x, y: site.y, z: site.z, size: S, ...(biome ? { biome } : {}) }, houses, true, undefined, { poster: 'grow', neighbourhood: true, ...field });
    if (!out.startsWith('Laid out')) {
      // (a square refused is kept off by the next survey, which would pick the same one: five tries on one site stopped
      // growth, s30's review)
      const g = (v.growth ??= { past: [] });
      g.bad = [...(g.bad ?? []), { ...square, at: Date.now() }].slice(-8);
      throw new Error(out);
    }
    const made = v.tasks.filter((t) => !before.has(t.id));
    const n = v.layouts!.length, lay = v.layouts![n - 1];
    const g = (v.growth ??= { past: [] });
    const k = lay.grow ?? g.past.length + 1;
    const members = a.world.growMembers(v).length, H = housesOf(v);
    const builds = made.filter((t) => /^Build /.test(t.title)).map((t) => t.id);
    const plot = { x1: lay.x1, z1: lay.z1, x2: lay.x2, z2: lay.z2 };
    // (the style voted for, spec_vote1: kept on the neighbourhood, and the vote's decision spent only now, the critique's H1)
    const style = typeof args.style === 'string' && args.style ? args.style : undefined;
    g.active = { k, layout: n, from: Math.min(...made.map(taskNum)), at: Date.now(), by: a.name, plot, houses: [...lay.buildings], builds, members, before: H, changed: Date.now(), sig: '', ...(style ? { style } : {}) };
    delete g.next;
    delete g.tries;
    delete g.noSite;
    a.world.villages.save();
    // (with the ladder, the rung taken and what came of its field: s30's food step)
    const rung = ladder ? ` (${optionText(site.opt)}${site.opt.slots >= 0 ? `: ${lay.farm ? `field at ${areaText(lay.farm)}, ${lay.slots?.length ?? 0} slots` : `no field, ${lay.farmWhy ?? 'refused'}`}` : ''})` : '';
    console.log(`[grow] ${v.name}: layout ${n} (neighbourhood ${k}) posted by ${a.name}: ${builds.length} houses (${lay.buildings.join(', ')}) on ${S}x${S}${rung} at ${areaText(plot)}, members ${members}, houses ${H}; ${made.length} tasks`);
    a.world.villages.note(v, `${a.name} laid out neighbourhood ${k}: ${lay.buildings.join(', ')} at ${areaText(plot)}${lay.farm ? ' with a wheat field' : ''}`);
    return `laid out neighbourhood ${k}: ${builds.length} houses on ${S}x${S}${rung} at ${areaText(plot)}, ${made.length} tasks posted`;
  } finally {
    growBusy.delete(v.name);
  }
}

/**
 * The works plot (S.9, D8; a chore code queues once the annex is ready): a 13x9 plot of the annex's geometry beside the
 * annex, within 48 blocks of the hut's table, prepared at the plot's level like the annex (prepareAnnex's rules: the
 * rectangle recorded first, one that fails for its ground marked bad). Its first slot takes a row of three furnaces
 * (place_works_furnace), its second stays free for a sheep pen later. A plot entry `works: true`: protected village ground.
 */
async function prepareWorks(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const lay = v?.layouts?.[0];
  if (!v || !lay) throw new Error('prepare_works: the village has no layout');
  const plot = v.plots.find((p) => !p.annex && !p.works && overlaps(p, lay));
  if (!plot) throw new Error('prepare_works: the village plot is not prepared');
  if (lay.annex?.state !== 'ready') throw new Error('prepare_works: the annex is not ready yet (the works plot goes beside it)');
  if (!villageStationCell(v, 'crafting_table')) throw new Error("prepare_works: the storage hut's crafting table does not stand yet");
  if (worksBusy.has(v.name)) throw new Error('prepare_works: the works plot is being prepared');
  worksBusy.add(v.name);
  const save = () => a.world.villages.save();
  try {
    let wk = lay.works;
    if (wk?.state === 'ready') return `the works plot at ${areaText(wk)} is ready`;
    const home = villageHome(v, a.memory);
    if (home && Math.hypot(a.bot.entity.position.x - home.x, a.bot.entity.position.z - home.z) > 24)
      await walk(a, new goals.GoalNearXZ(Math.floor(home.x), Math.floor(home.z), 6), 'the village', signal, 120000).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
      });
    if (!wk || wk.x2 < wk.x1) {
      const spot = await annexSpot(a, v, plot, signal, 'works');
      if (!spot) throw new Error(`prepare_works: no room for a 13x9 works plot beside the plot at ${areaText(plot)} within ${WORKS_TABLE_RANGE} blocks of the hut's table (every side taken, wet, too steep or built on)`);
      wk = lay.works = { ...lay.works, x1: spot.rect.x1, z1: spot.rect.z1, x2: spot.rect.x2, z2: spot.rect.z2, y: plot.y, side: spot.rect.side, state: 'preparing' };
      save();
      console.log(`[works] ${v.name}: ${a.name} prepares the works plot at ${areaText(wk)} (${wk.side}, score ${Math.round(spot.score)})`);
    }
    const w = wk.x2 - wk.x1 + 1, d = wk.z2 - wk.z1 + 1;
    const out = await prepareSite(a, { x: wk.x1 + Math.floor(w / 2), z: wk.z1 + Math.floor(d / 2), width: w, depth: d, y: wk.y, margin: 2, works: true }, signal);
    const rec = v.plots.find((p) => p.x1 === wk!.x1 && p.z1 === wk!.z1 && p.x2 === wk!.x2 && p.z2 === wk!.z2);
    if (rec) rec.works = true;
    wk.state = 'ready';
    save();
    a.world.villages.note(v, `${a.name} prepared the works plot at ${areaText(wk)} for the workshop's furnaces`);
    // (the felled trees' logs)
    const stored = await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      return '';
    });
    return `prepared the works plot at ${areaText(wk)} (${wk.side} of the plot) with room for ${WORKS_FURNACES} furnaces: ${out.replace(/^plot ready: /, '')}${stored ? '; deposited what it carried' : ''}`;
  } catch (e) {
    const why = (e as Error).message;
    if (why !== 'cancelled' && !signal.aborted) {
      // (an empty rectangle: none chosen yet, or the last one given up)
      const wk = (lay.works ??= { x1: 0, z1: 0, x2: -1, z2: -1, y: plot.y, side: 'n', state: 'preparing' });
      // Ground that cannot be made ready: another rectangle next time
      if (wk.state !== 'ready' && wk.x2 >= wk.x1 && /cannot be prepared here|cannot be made dry|not ready after two passes|whole area is covered|too much work/.test(why)) {
        wk.bad = [...(wk.bad ?? []), `${wk.x1},${wk.z1}`].slice(-20);
        wk.x2 = wk.x1 - 1;
      }
      wk.tries = (wk.tries ?? 0) + 1;
      wk.lastTry = { at: Date.now(), why: why.slice(0, 200) };
    }
    save();
    // The logs of trees felled before the failure go into storage too (not on a stop or an unmoved stall; S.9's review,
    // lens 1 L3, lesson 112)
    if (why !== 'cancelled' && !signal.aborted && !unmoved(e))
      await STORAGE_SKILLS.deposit.run(a, { item: 'logs', keep_wood: true }, signal).catch(() => '');
    throw e;
  } finally {
    worksBusy.delete(v.name);
  }
}

/** The most seeds a luring bot holds (none are used up: TemptGoal only looks at the hands). */
const LURE_SEEDS = 8;

/**
 * A chicken pen on a free annex slot (10-09, the user's choices: one lure trip of up to 4; eggs and breeding later; a
 * chore code queues once the annex is ready). The slot is recorded as a pen first (its walk ban holds from the start,
 * the design review's H2); at the storage hut the ring of the village's wood goes up by command, charged, its gate open;
 * then the bot walks to the chickens seen at x, y, z, holds wheat seeds in its off-hand (set by command: walks never swap
 * it, review M9) and leads up to 4 home in 4-block hops, waiting for them after each; from the cell beyond the gate it is
 * teleported to the back row, the chickens follow it in through the open gate (the live tests: all 4 within 3 s), the
 * gate is closed by command once no chicken or player stands in it, and the bot is teleported out. Never through the gate
 * on foot: a walk takes a gate for a full block (review H1).
 */
async function startPen(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const { v, k, j, slot, plot, key } = slotOf(a, args, 'start_pen');
  if (!slot.annex) throw new Error(`start_pen: farm slot ${j} is not on the annex`);
  if (slotBusy.has(key)) throw new ContentionError(`start_pen: farm slot ${j} is busy`, 'busy', `slot:${key}`);
  const kind = args.kind === undefined ? 'chicken' : str(args.kind, 'kind');
  const spec = PEN_KINDS[kind];
  if (!spec) throw new Error(`start_pen: no pen for ${kind} (${PEN_ORDER.join(', ')})`);
  const lure = spec.lure;
  if (slot.kind && slot.kind !== kind) throw new Error(`start_pen: farm slot ${j} already holds ${slot.kind}`);
  const sx = Math.floor(num(args.x, 'x')), sy = Math.floor(num(args.y, 'y')), sz = Math.floor(num(args.z, 'z'));
  const P = penPlan(slot, slot.face ?? 'n');
  const y = plot.y + 1;
  const name = a.name;
  const rcon = (c: string) => a.world.rcon.command(c).catch(() => '');
  const save = () => a.world.villages.save();
  const tp = (c: [number, number]) => rcon(`tp ${name} ${c[0] + 0.5} ${y} ${c[1] + 0.5}`);
  const box = (q: Area) => `x=${q.x1},y=${y},z=${q.z1},dx=${q.x2 - q.x1},dy=2,dz=${q.z2 - q.z1}`;
  const gateCell = { x1: P.gate[0], z1: P.gate[1], x2: P.gate[0], z2: P.gate[1] };
  const count = async (q: Area) => Number(/count: (\d+)/i.exec(await rcon(`execute if entity @e[type=minecraft:${kind},${box(q)}]`))?.[1] ?? 0);
  // (-1 when the server gave no count: the pen's base must not read 0 for a pen holding animals, the fixes review's L1)
  const known = async (q: Area) => {
    const r = await rcon(`execute if entity @e[type=minecraft:${kind},${box(q)}]`);
    const m = /count: (\d+)/i.exec(r);
    return m ? Number(m[1]) : /Test failed/i.test(r) ? 0 : -1;
  };
  // (a village with no wood kind recorded: the kind storage holds most wood of, not oak, whose craft failed first in VanA3;
  // kept on the pen, so the gate is always set again in its own wood)
  const stock = storageContents(v);
  const held4 = (k: string) => 4 * (stock[`${k}_log`] ?? 0) + (stock[`${k}_planks`] ?? 0);
  const wood = slot.pen?.wood ?? v.wood ?? [...WOODS].sort((p, q) => held4(q) - held4(p))[0];
  const gate = (open: boolean) => `${wood}_fence_gate[facing=${P.facing},open=${open}]`;
  let gateOpen = false, held = 0;
  const mv = a.moves();
  const saved = { canDig: mv.canDig, scafoldingBlocks: mv.scafoldingBlocks, allow1by1towers: mv.allow1by1towers, allowSprinting: mv.allowSprinting, maxDropDown: mv.maxDropDown };
  const notes: string[] = [];
  try {
    slotBusy.add(key);
    slot.kind = kind;
    slot.laying = true;
    slot.pen = { ...slot.pen, gate: P.gate, facing: P.facing, wood };
    save();
    // The ring (charged, at the storage hut), the gate open; anything grown inside the slot cleared
    const h = v.storageHut;
    const area = h ? { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 } : { x1: slot.x1, z1: slot.z1, x2: slot.x2, z2: slot.z2 };
    const job: Job = { targets: [], area, y: plot.y, what: `the ${kind} pen`, task: `start_pen layout=${k} slot=${j}` };
    if (!slot.pen.built) {
      const targets: Target[] = P.ring.map(([x, z]) => ({ x, y, z, block: `${wood}_fence` }));
      targets.push({ x: P.gate[0], y, z: P.gate[1], block: gate(true) });
      for (let x = P.inner.x1; x <= P.inner.x2; x++)
        for (let z = P.inner.z1; z <= P.inner.z2; z++) {
          const n = blockName(a, x, y, z);
          if (n && n !== 'air' && n !== 'cave_air') targets.push({ x, y, z, block: 'air' });
        }
      notes.push(await runJob(a, { ...job, targets }, signal));
      await sleep(1000, signal);
      const missing = targets.filter((t) => !alreadyThere(a, t, true));
      if (missing.length) notes.push(`again: ${await runJob(a, { ...job, targets: missing }, signal)}`);
      if (!/passed/i.test(await rcon(`execute if block ${P.gate[0]} ${y} ${P.gate[1]} #minecraft:fence_gates`)))
        throw new Error(`start_pen: the pen's gate at ${P.gate[0]},${y},${P.gate[1]} is not there after two passes`);
      slot.pen.built = true;
      save();
      gateOpen = true;
    }
    // (a pen with animals already keeps its gate shut until the bot is at it with the new ones: VanC2's pens held one
    // animal each, too few to breed, so a second trip comes)
    const counted = slot.pen.built ? await known(P.inner) : 0;
    const base = counted < 0 || (counted === 0 && (slot.pen.animals ?? 0) > 0) ? (slot.pen.animals ?? 0) : counted;
    if (!base && !gateOpen) {
      await rcon(`setblock ${P.gate[0]} ${y} ${P.gate[1]} minecraft:${gate(true)}`);
      gateOpen = true;
    }
    // A lure left in the off-hand by a run cut off before its clean-up (a restart): back into the inventory (review M1;
    // any kind's: a chicken start's seeds blocked every cow start, the diff review's L2)
    for (const l of new Set(Object.values(PEN_KINDS).map((q) => q.lure))) {
      const left = await rcon(`execute if items entity ${name} weapon.offhand minecraft:${l}`);
      if (!/passed/i.test(left)) continue;
      await rcon(`item replace entity ${name} weapon.offhand with minecraft:air`);
      await rcon(`give ${name} minecraft:${l} ${Number(/count: (\d+)/i.exec(left)?.[1] ?? 1)}`);
      await syncInventory(a);
    }
    // The lure: from storage, else (seeds) a few from the grass (none are used up; the wheat field took every seed gathered
    // before its first harvest, VanA2); wheat comes only from the field's harvests
    if ((await serverCount(a, lure)) < 1) {
      // (never the seeds a field's open planting still needs: G3f's lure held a neighbourhood field's 8 while it was sown, s30)
      const store = Math.max(0, (storageContents(v)[lure] ?? 0) - (lure === 'wheat_seeds' ? seedsForFields(v) : 0));
      if (store) await withdrawItems(a, v, { [lure]: Math.min(LURE_SEEDS, store) }, signal);
      else if (lure === 'wheat_seeds')
        await SURVIVAL_SKILLS.collect.run(a, { block: 'wheat_seeds', count: 3 }, signal).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
          notes.push(`seeds: ${e.message.slice(0, 100)}`);
        });
    }
    const seeds = Math.min(LURE_SEEDS, await serverCount(a, lure));
    if (!seeds) throw new Error(`start_pen: no ${lure} to lure the ${kind}s with (the storage holds none${lure === 'wheat_seeds' ? ', and none came from the grass' : ''}${notes.length ? `: ${notes.join('; ')}` : ''})`);
    // To the animals, up to their height (F205: up to 8 above the pen; a walk that stopped at a ledge's foot left them out of
    // the 4 in y they are chosen from), without a dirt tower (a sheer face they could not come down); on no path, near
    // them across as before
    const far = Math.hypot(a.bot.entity.position.x - sx, a.bot.entity.position.z - sz);
    await walk(a, new goals.GoalNear(sx, sy, sz, 4), `the ${kind}s at ${sx},${sy},${sz}`, signal, 30000 + 700 * Math.round(far), { scaffold: false }).catch(async (e: Error) => {
      if (e.message === 'cancelled') throw e;
      notes.push(`walk: ${e.message.slice(0, 100)}`);
      if (/no path/i.test(e.message))
        await walk(a, new goals.GoalNearXZ(sx, sz, 4), `the ${kind}s at ${sx},${sz}`, signal, 30000 + 700 * Math.round(Math.hypot(a.bot.entity.position.x - sx, a.bot.entity.position.z - sz))).catch((er: Error) => {
          if (er.message === 'cancelled') throw er;
        });
    });
    // The lure in the off-hand, by command (an empty one only)
    if (/passed/i.test(await rcon(`execute if items entity ${name} weapon.offhand *`))) throw new Error('start_pen: the off-hand holds something already');
    const cleared = await a.world.rcon.take(name, `minecraft:${lure}`, seeds);
    if (!cleared) throw new Error(`start_pen: the ${lure} could not be taken from the inventory`);
    held = cleared;
    await rcon(`item replace entity ${name} weapon.offhand with minecraft:${lure} ${held}`);
    await sleep(1500, signal);
    // The animals near (not on any village's ground: penned ones are seen too, review H3), and at about the bot's height:
    // ones on a hill 10 above it were out of the 10 blocks a chicken is tempted from, and do not come down a drop (VanA1)
    const me = () => a.bot.entity.position;
    const flat = (e: { position: Vec3 }) => Math.hypot(e.position.x - me().x, e.position.z - me().z);
    // (within 9 in 3D: the tempt rule's 10 with a margin, F205's review M5)
    const near = (r: number) => Object.values(a.bot.entities)
      .filter((e) => e.name === kind && e.position.distanceTo(me()) <= r && Math.abs(e.position.y - me().y) <= 4 && !onVillageGround(a, Math.floor(e.position.x), Math.floor(e.position.z)))
      .sort((p, q) => flat(p) - flat(q));
    const where = (ids: number[]) => ids.map((id) => (a.bot.entities[id] ? `${at(a.bot.entities[id].position)} (${a.bot.entities[id].position.distanceTo(me()).toFixed(1)})` : `${id} gone`)).join(', ');
    let chosen = near(9).slice(0, 4).map((e) => e.id);
    if (!chosen.length) {
      // (they wander: to the nearest within 24 at any height, then a second look)
      const e = Object.values(a.bot.entities).filter((c) => c.name === kind && flat(c) <= 24 && !onVillageGround(a, Math.floor(c.position.x), Math.floor(c.position.z))).sort((p, q) => flat(p) - flat(q))[0];
      if (e) {
        await walk(a, new goals.GoalNear(Math.floor(e.position.x), Math.floor(e.position.y), Math.floor(e.position.z), 3), `the nearest ${kind}`, signal, 20000, { scaffold: false }).catch((er: Error) => {
          if (er.message === 'cancelled') throw er;
        });
        await sleep(1500, signal);
        chosen = near(9).slice(0, 4).map((c) => c.id);
      }
    }
    if (!chosen.length) throw new Error(`start_pen: no ${kind} within 9 blocks of ${at(me())} (seen at ${sx},${sy},${sz})`);
    const led = chosen.length;
    console.log(`[pen] ${name}: leads ${led} ${kind}${led > 1 ? 's' : ''} from ${at(me())}: ${where(chosen)}`);
    // Home in hops: no digging, building or sprinting on the way (they keep up at ~2.5 m/s, the bot walks 4.3), and no drop
    // over 3, the most an animal's own path takes (a 6-block face held them at its edge; F205's live facts)
    const startY = me().y;
    Object.assign(mv, { canDig: false, scafoldingBlocks: [], allow1by1towers: false, allowSprinting: false, maxDropDown: 3 });
    const [ax, az] = P.approach;
    const dist = () => Math.hypot(me().x - (ax + 0.5), me().z - (az + 0.5));
    const maxHops = Math.ceil(dist() / 4) + 15;
    let hops = 0, still = 0;
    const away = new Map<number, number>();
    while (dist() > 1.5) {
      checkAbort(signal);
      if (++hops > maxHops) throw new Error(`start_pen: could not lead the ${kind}s home in ${maxHops} hops (${Math.round(dist())} blocks short)`);
      const from = me().clone();
      a.bot.pathfinder.setMovements(mv);
      a.bot.pathfinder.setGoal(new goals.GoalNearXZ(ax, az, 1));
      const t0 = Date.now();
      // (a hop: 4 blocks of the pathfinder's own way home, or 5 s)
      while (Date.now() - t0 < 5000 && from.distanceTo(me()) < 4 && dist() > 1.5) await sleep(100, signal);
      a.bot.pathfinder.setGoal(null);
      a.bot.clearControlStates();
      still = from.distanceTo(me()) < 1 ? still + 1 : 0;
      if (still >= 4) throw new Error(`start_pen: stuck at ${at(me())} on the way home with the ${kind}s${startY - y > 4 && me().y - y > 3 ? ` (no way down with drops of 3 or less from y ${Math.floor(startY)})` : ''}`);
      // Wait for them (at most 8 s); one lost (gone or over 12 away) at the end of two waits in a row is left behind (one
      // coming down a slope the long way trails for a hop: F205's review M3)
      const w0 = Date.now();
      while (Date.now() - w0 < 8000) {
        if (chosen.every((id) => a.bot.entities[id] && a.bot.entities[id].position.distanceTo(me()) <= 4)) break;
        await sleep(250, signal);
      }
      chosen = chosen.filter((id) => {
        const off = !a.bot.entities[id] || a.bot.entities[id].position.distanceTo(me()) > 12;
        away.set(id, off ? (away.get(id) ?? 0) + 1 : 0);
        return (away.get(id) ?? 0) < 2;
      });
      console.log(`[pen] ${name}: hop ${hops} to ${at(me())}, ${Math.round(dist())} from the gate; ${where(chosen)}`);
      if (!chosen.length)
        throw new Error(`start_pen: the ${kind}s were lost on the way, ${Math.round(dist())} blocks from the pen${startY - y > 4 ? ` (did not follow down from y ${Math.floor(startY)})` : ''}`);
    }
    // Close up first (they hold at 2.5): a chicken trailing on the far side was 11 from the back row once the bot was
    // teleported there, out of the 10 blocks it is tempted from (VanA4b)
    const w1 = Date.now();
    while (Date.now() - w1 < 8000) {
      if (chosen.every((id) => a.bot.entities[id] && a.bot.entities[id].position.distanceTo(me()) <= 3)) break;
      await sleep(250, signal);
    }
    // (the last hop's stragglers get this wait too: dropped only when still beyond 12 or gone after it, the diff review's M1)
    chosen = chosen.filter((id) => a.bot.entities[id] && a.bot.entities[id].position.distanceTo(me()) <= 12);
    if (!chosen.length) throw new Error(`start_pen: the ${kind}s were lost at the gate`);
    if (!gateOpen) {
      await rcon(`setblock ${P.gate[0]} ${y} ${P.gate[1]} minecraft:${gate(true)}`);
      gateOpen = true;
    }
    // In through the open gate behind the bot: teleported 2 cells inside (within 6 of them), then once they are in, to
    // the back row, so they go deep enough for the gate to close; closed when its cell is clear
    const toward = (u: number, w: number) => u + 2 * Math.sign(w - u);
    await tp([toward(P.gate[0], P.back[0]), toward(P.gate[1], P.back[1])]);
    const t1 = Date.now();
    while (Date.now() - t1 < 6000) {
      if ((await count(P.inner)) >= base + chosen.length) break;
      await sleep(500, signal);
    }
    await tp(P.back);
    const t2 = Date.now();
    while (Date.now() - t2 < 4000) {
      if ((await count(P.inner)) >= base + chosen.length && !(await count(gateCell))) break;
      await sleep(500, signal);
    }
    // Animals left in or just outside the open gate are put in by command: two cows led to the gate jammed in its cell and
    // never came in (pens v2's live tests; chickens, 0.4 wide, walk through)
    let nudged = 0;
    if ((await count(P.inner)) < base + chosen.length) {
      const xs = [P.gate[0], P.approach[0]], zs = [P.gate[1], P.approach[1]];
      const near = { x1: Math.min(...xs) - 1, z1: Math.min(...zs) - 1, x2: Math.max(...xs) + 1, z2: Math.max(...zs) + 1 };
      const c = [Math.floor((P.inner.x1 + P.inner.x2) / 2), Math.floor((P.inner.z1 + P.inner.z2) / 2)];
      // ("Teleported 2 entities to ..." or, for one, "Teleported Cow to ...": the diff review's L5)
      const r = await rcon(`tp @e[type=minecraft:${kind},${box(near)}] ${c[0] + 0.5} ${y} ${c[1] + 0.5}`);
      nudged = /Teleported (\d+) entities/i.test(r) ? Number(/Teleported (\d+)/i.exec(r)![1]) : /Teleported /i.test(r) ? 1 : 0;
      if (nudged) await sleep(1000, signal);
    }
    console.log(`[pen] ${name}: in the back row ${Math.round((Date.now() - t1) / 100) / 10} s: ${await count(P.inner)} inside${nudged ? ` (${nudged} put in from the gate)` : ''}, ${await count(gateCell)} in the gate; ${where(chosen)}`);
    let closed = false;
    for (let i = 0; i < 3 && !closed; i++) {
      if (!(await count(gateCell)) && !playersIn(a, [P.gate[0], y, P.gate[1]], 2).length) {
        await rcon(`setblock ${P.gate[0]} ${y} ${P.gate[1]} minecraft:${gate(false)}`);
        closed = true;
      } else await sleep(1000, signal);
    }
    if (!closed) await rcon(`setblock ${P.gate[0]} ${y} ${P.gate[1]} minecraft:${gate(false)}`);
    gateOpen = false;
    await tp(P.approach);
    await sleep(3000, signal);
    const animals = await count(P.inner);
    slot.pen = { ...slot.pen, animals, at: Date.now() };
    slot.from = [sx, Math.floor(num(args.y, 'y')), sz];
    delete slot.laying;
    save();
    // The seeds back in hand and into storage (the review's L8)
    await rcon(`item replace entity ${name} weapon.offhand with minecraft:air`);
    await rcon(`give ${name} minecraft:${lure} ${held}`);
    held = 0;
    await syncInventory(a).catch(() => {});
    await STORAGE_SKILLS.deposit.run(a, { item: lure }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    if (animals <= base) throw new Error(`start_pen: none of the ${led} ${kind}s led home came into the pen (${chosen.length} followed to the gate)`);
    const done = `put ${animals - base} ${kind}${animals - base > 1 ? 's' : ''} into the pen on annex slot ${j} at ${areaText(slot)} (${led} led from ${sx},${sz}, ${hops} hops)`;
    a.world.villages.note(v, `${name} ${done}`);
    return `${done}${notes.length ? `: ${notes.join('; ')}` : ''}`;
  } catch (e) {
    const why = (e as Error).message;
    // The ring stays once up (a pen with no chickens yet, tried again later); before that the slot is free again
    if (!slot.pen?.built) {
      delete slot.kind;
      delete slot.pen;
    }
    delete slot.laying;
    const ann = v.layouts?.[0]?.annex;
    if (ann && why !== 'cancelled' && !signal.aborted) {
      ann.penBy = { ...ann.penBy, [kind]: { tries: (ann.penBy?.[kind]?.tries ?? 0) + 1, at: Date.now(), why: why.slice(0, 200) } };
      // (animals not found there, lost or not led in: that sighting is passed over next time, review M3)
      if (/no (chicken|cow) within|were lost|could not lead|none of the|stuck at/.test(why)) ann.penBad = [...(ann.penBad ?? []), `${kind}:${sx},${sz},${Date.now()}`].slice(-20);
    }
    save();
    const home = villageHome(v, a.memory);
    if (!signal.aborted && why !== 'cancelled' && home && Math.hypot(a.bot.entity.position.x - home.x, a.bot.entity.position.z - home.z) > 48)
      await teleportHome(a, signal).catch(() => null);
    throw e;
  } finally {
    Object.assign(mv, saved);
    a.bot.pathfinder.setGoal(null);
    // (no signal-aware waits here: a stop must not skip them, review M4)
    // A bot stopped inside the pen is put outside first: there is no way out on foot (review M2)
    const pos = a.bot.entity?.position;
    if (pos && pos.x >= slot.x1 && pos.x < slot.x2 + 1 && pos.z >= slot.z1 && pos.z < slot.z2 + 1) await tp(P.approach);
    if (gateOpen && !playersIn(a, [P.gate[0], y, P.gate[1]], 2).length) await rcon(`setblock ${P.gate[0]} ${y} ${P.gate[1]} minecraft:${gate(false)}`);
    if (held) {
      await rcon(`item replace entity ${name} weapon.offhand with minecraft:air`);
      await rcon(`give ${name} minecraft:${lure} ${held}`);
    }
    await syncInventory(a).catch(() => {});
    slotBusy.delete(key);
  }
}

/** Wheat storage keeps for the pens and the cake: harvests bake bread only from what is beyond it (pens v2). */
const WHEAT_KEEP = 16;

/** The keep in a village with an appetite (s30's food step, D13): a cake's 3, a cow breeding's 2 and one spare; the keep of
 *  16 baked nothing from a first harvest. Bread makes take only what is beyond it too. */
export const wheatKeep = (v: Village | undefined) => (appetiteOn(v) ? 6 : WHEAT_KEEP);

/**
 * A pen's own work (pens v2, 10-09; chores after completion): the bot walks to the cell beyond the pen's gate and the
 * work is done there by command, charged to its inventory (the design review: no bot inside a closed pen, no clicking on
 * animals Mineflayer cannot tell from their young). Returns the slot, its plan, a count of its animals and the selector
 * of its inside.
 */
function penOf(a: BotAgent, args: Record<string, unknown>, what: string, kind?: string) {
  const s = slotOf(a, args, what);
  const { slot, plot, j } = s;
  if (!slot.annex || !slot.kind || !PEN_KINDS[slot.kind] || !slot.pen?.built || (kind && slot.kind !== kind))
    throw new Error(`${what}: annex slot ${j} holds no ${kind ?? 'animal'} pen`);
  const P = penPlan(slot, slot.face ?? 'n');
  const y = plot.y + 1;
  const sel = `x=${P.inner.x1},y=${y},z=${P.inner.z1},dx=${P.inner.x2 - P.inner.x1},dy=2,dz=${P.inner.z2 - P.inner.z1}`;
  const rcon = (c: string) => a.world.rcon.command(c).catch(() => '');
  // (-1 when the server gave no count: a failed command read as 0 wiped a pen's record, the diff review's M2)
  const count = async (extra = '') => {
    const r = await rcon(`execute if entity @e[type=minecraft:${slot.kind},${sel}${extra}]`);
    const m = /count: (\d+)/i.exec(r);
    return m ? Number(m[1]) : /Test failed/i.test(r) ? 0 : -1;
  };
  const toGate = (signal: AbortSignal) => walk(a, new goals.GoalNearXZ(P.approach[0], P.approach[1], 2), `the ${slot.kind} pen's gate`, signal, 60000)
    .then(() => '').catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      return `walk: ${e.message.slice(0, 80)}`;
    });
  return { ...s, P, y, sel, rcon, count, toGate, pen: slot.pen, kind: slot.kind };
}

/**
 * Buckets, milk and eggs a member still carries, into storage by name (none leave by `deposit all`: buckets are tools,
 * eggs junk): a chore stopped after a withdraw left them with a worker, and storage, which the milking and the cake are
 * judged by, never saw them again (the diff review's M1). Run at the start of the pens' chores and the cake.
 */
async function depositKept(a: BotAgent, signal: AbortSignal): Promise<void> {
  for (const item of ['bucket', 'milk_bucket', ...EGGS])
    if ((await serverCount(a, item).catch(() => 0)) > 0)
      await STORAGE_SKILLS.deposit.run(a, { item }, signal).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
      });
}

/** Eggs lying in a chicken pen into storage: teleported to the bot by command, counted on the server, deposited by name
 *  (eggs are junk to `deposit all`); an egg item despawns 5 minutes after it is laid (6000 ticks). */
async function collectEggs(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const { v, j, key, sel, rcon, toGate, pen } = penOf(a, args, 'collect_eggs', 'chicken');
  if (slotBusy.has(key)) throw new ContentionError(`collect_eggs: annex slot ${j} is busy`, 'busy', `slot:${key}`);
  slotBusy.add(key);
  try {
    await depositKept(a, signal);
    await roomForLoot(a, 'collect_eggs', signal);
    const notes = [await toGate(signal)].filter(Boolean);
    const got: Record<string, number> = {};
    for (const egg of EGGS) {
      const before = await serverCount(a, egg);
      if (!/Teleported/i.test(await rcon(`tp @e[type=minecraft:item,${sel},nbt={Item:{id:"minecraft:${egg}"}}] ${a.name}`))) continue;
      // (picked up after the item's pickup delay, 10 ticks)
      for (let i = 0; i < 10; i++) {
        await sleep(300, signal);
        if ((got[egg] = (await serverCount(a, egg)) - before) > 0) break;
      }
      if (!got[egg]) delete got[egg];
    }
    const n = Object.values(got).reduce((s, q) => s + q, 0);
    pen.eggs = (pen.eggs ?? 0) + n;
    noteFood(v, 'made', got);
    pen.eggsAt = Date.now();
    a.world.villages.save();
    if (!n) return `no eggs in the chicken pen on annex slot ${j}${notes.length ? ` (${notes.join('; ')})` : ''}`;
    await syncInventory(a).catch(() => {});
    for (const egg of Object.keys(got))
      await STORAGE_SKILLS.deposit.run(a, { item: egg }, signal).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        notes.push(`${egg} not deposited: ${e.message.slice(0, 80)}`);
      });
    const out = `collected ${Object.entries(got).map(([e, q]) => `${q} ${e}`).join(', ')} from the chicken pen on annex slot ${j}`;
    a.world.villages.note(v, `${a.name} ${out}`);
    return `${out}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  } finally {
    slotBusy.delete(key);
  }
}

/** Two adults of a pen bred (food charged: one each; put in love by command, the live tests: young within ~2 s). Only
 *  ready adults (Age 0: young and parents on their 5-minute cooldown are not), and never beyond the pen's cap. */
async function breedPen(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const { v, j, key, sel, rcon, count, toGate, pen, kind } = penOf(a, args, 'breed_pen');
  const { lure: food, cap } = PEN_KINDS[kind];
  if (slotBusy.has(key)) throw new ContentionError(`breed_pen: annex slot ${j} is busy`, 'busy', `slot:${key}`);
  slotBusy.add(key);
  let refund = 0;
  try {
    await depositKept(a, signal);
    // (counted from the gate: the pen's entities are loaded there)
    const notes = [await toGate(signal)].filter(Boolean);
    const total = await count(), ready = await count(',nbt={Age:0}');
    if (total < 0 || ready < 0) throw new Error(`breed_pen: the server gave no count of the ${kind}s in the pen on annex slot ${j}`);
    pen.animals = total;
    if (ready < 2 || total + 1 > cap) {
      a.world.villages.save();
      return ready < 2 ? `the ${kind} pen on annex slot ${j} has ${ready} adult${ready === 1 ? '' : 's'} ready to breed of ${total}` : `the ${kind} pen on annex slot ${j} is full (${total} of ${cap})`;
    }
    const have = await serverCount(a, food);
    // (never the seeds a field's open planting still needs, s30)
    const kept = food === 'wheat_seeds' ? seedsForFields(v) : 0;
    if (have < 2 && (!kept || (storageContents(v)[food] ?? 0) - kept >= 2 - have)) await withdrawItems(a, v, { [food]: 2 - have }, signal);
    if ((await serverCount(a, food)) < 2) throw new Error(`breed_pen: needs 2 ${food} to breed the ${kind}s (storage has ${storageContents(v)[food] ?? 0}${kept ? `, ${kept} kept for a field's planting` : ''})`);
    notes.push(await toGate(signal));
    refund = await a.world.rcon.take(a.name, `minecraft:${food}`, 2);
    if (refund < 2) throw new Error(`breed_pen: could not take 2 ${food} from the inventory`);
    const r = await rcon(`execute as @e[type=minecraft:${kind},${sel},nbt={Age:0},limit=2,sort=random] run data merge entity @s {InLove:600}`);
    const fed = (r.match(/Modified entity data/gi) ?? []).length;
    refund = 2 - fed;
    if (fed < 2) throw new Error(`breed_pen: only ${fed} ${kind} could be fed (${r.slice(0, 80) || 'no answer'})`);
    let now = total;
    for (let i = 0; i < 16 && now <= total; i++) {
      await sleep(500, signal);
      now = Math.max(total, await count());
    }
    pen.bredAt = Date.now();
    pen.born = (pen.born ?? 0) + Math.max(0, now - total);
    pen.animals = now;
    a.world.villages.save();
    const out = `fed 2 ${kind}s ${food} in the pen on annex slot ${j}: ${now > total ? `${now - total} young born, ${now} in the pen` : 'no young yet'}`;
    if (now > total) a.world.villages.note(v, `${a.name} ${out}`);
    const said = notes.filter(Boolean);
    return `${out}${said.length ? ` (${said.join('; ')})` : ''}`;
  } finally {
    // (food taken but not fed is given back)
    if (refund > 0) await rcon(`give ${a.name} minecraft:${food} ${refund}`);
    slotBusy.delete(key);
  }
}

/** Milk from the cow pen into storage: each empty bucket storage holds becomes a milk bucket (an adult cow gives milk
 *  with no cooldown; charged by command: a bucket taken, a milk bucket given), up to the cake's three. */
async function milkCows(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const { v, j, key, sel, rcon, toGate, pen } = penOf(a, args, 'milk_cows', 'cow');
  if (slotBusy.has(key)) throw new ContentionError(`milk_cows: annex slot ${j} is busy`, 'busy', `slot:${key}`);
  slotBusy.add(key);
  let taken = 0;
  try {
    await depositKept(a, signal);
    // (counted from the gate, where the pen's entities are loaded: the fixes review's L2)
    const notes = [await toGate(signal)].filter(Boolean);
    await rcon('scoreboard objectives add mcai_age dummy');
    await rcon(`execute as @e[type=minecraft:cow,${sel}] store result score @s mcai_age run data get entity @s Age`);
    const r = await rcon(`execute if entity @e[type=minecraft:cow,${sel},scores={mcai_age=0..}]`);
    const adults = /count: (\d+)/i.test(r) ? Number(/count: (\d+)/i.exec(r)![1]) : /Test failed/i.test(r) ? 0 : -1;
    if (adults < 0) throw new Error(`milk_cows: the server gave no count of the cows in the pen on annex slot ${j}`);
    if (!adults) throw new Error(`milk_cows: no grown cow in the pen on annex slot ${j} (calves give no milk)`);
    const store = storageContents(v);
    const want = Math.max(0, 3 - (store.milk_bucket ?? 0) - (await serverCount(a, 'milk_bucket')));
    if (!want) return 'the storage holds 3 milk buckets already';
    const have = await serverCount(a, 'bucket');
    if (have < want && store.bucket) await withdrawItems(a, v, { bucket: Math.min(want - have, store.bucket) }, signal);
    const n = Math.min(want, await serverCount(a, 'bucket'));
    if (!n) throw new Error('milk_cows: no empty bucket (the storage holds none; the iron age makes them)');
    notes.push(await toGate(signal));
    let milked = 0;
    for (let i = 0; i < n; i++) {
      taken = await a.world.rcon.take(a.name, 'minecraft:bucket', 1);
      if (!taken) break;
      await rcon(`give ${a.name} minecraft:milk_bucket 1`);
      taken = 0;
      milked++;
    }
    pen.milk = (pen.milk ?? 0) + milked;
    noteFood(v, 'made', { milk_bucket: milked });
    pen.milkAt = Date.now();
    a.world.villages.save();
    await syncInventory(a).catch(() => {});
    for (const item of ['milk_bucket', 'bucket'])
      if ((await serverCount(a, item)) > 0)
        await STORAGE_SKILLS.deposit.run(a, { item }, signal).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
          notes.push(`${item} not deposited: ${e.message.slice(0, 80)}`);
        });
    const out = `milked the cows on annex slot ${j}: ${milked} milk bucket${milked === 1 ? '' : 's'}`;
    a.world.villages.note(v, `${a.name} ${out}`);
    const said = notes.filter(Boolean);
    return `${out}${said.length ? ` (${said.join('; ')})` : ''}`;
  } finally {
    if (taken) await rcon(`give ${a.name} minecraft:bucket ${taken}`);
    slotBusy.delete(key);
  }
}

/** What a cake takes (the jar's recipe: 3 milk buckets, 2 sugar, an egg of any kind, 3 wheat), and what storage lacks. */
export function cakeShort(store: Counts): string[] {
  const short: string[] = [];
  if ((store.milk_bucket ?? 0) < 3) short.push(`${3 - (store.milk_bucket ?? 0)} milk_bucket`);
  if (!EGGS.some((e) => (store[e] ?? 0) > 0)) short.push('1 egg');
  if ((store.wheat ?? 0) < 3) short.push(`${3 - (store.wheat ?? 0)} wheat`);
  if ((store.sugar ?? 0) + (store.sugar_cane ?? 0) < 2) short.push(`${2 - (store.sugar ?? 0) - (store.sugar_cane ?? 0)} sugar or sugar_cane`);
  return short;
}

/** A cake at the storage hut's table from storage (the payoff of the pens and the cane farm; the buckets go back). */
async function bakeCake(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('bake_cake: not in a village');
  const h = v.storageHut;
  const job: Job = { targets: [], area: h ? { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 } : v.plots[0] ?? { x1: 0, z1: 0, x2: 0, z2: 0 }, y: v.plots[0]?.y ?? 64, free: true, what: 'the cake', task: 'bake_cake' };
  await standBy(a, job, signal);
  await depositKept(a, signal);
  if (v.storage?.chests.length) await refreshStorage(a, v, signal);
  const store = storageContents(v);
  const short = cakeShort(store);
  if (short.length) throw new Error(`bake_cake: the storage is short of ${short.join(', ')}`);
  const egg = EGGS.find((e) => (store[e] ?? 0) > 0)!;
  const sugar = Math.min(2, store.sugar ?? 0);
  const want: Record<string, number> = { milk_bucket: 3, [egg]: 1, wheat: 3, sugar, sugar_cane: 2 - sugar };
  for (const [item, q] of Object.entries(want)) want[item] = Math.max(0, q - (await serverCount(a, item)));
  await withdrawItems(a, v, want, signal);
  await syncInventory(a);
  const notes: string[] = [];
  try {
    if ((await serverCount(a, 'sugar')) < 2) await SURVIVAL_SKILLS.craft.run(a, { item: 'sugar', count: 2 - (await serverCount(a, 'sugar')) }, signal);
    const before = await serverCount(a, 'cake');
    await SURVIVAL_SKILLS.craft.run(a, { item: 'cake', count: 1 }, signal);
    if ((await serverCount(a, 'cake')) <= before) throw new Error('bake_cake: the craft made no cake');
  } catch (e) {
    // (what was withdrawn goes back by name: the egg is junk to `deposit all`, the diff review's L4)
    if ((e as Error).message !== 'cancelled' && !signal.aborted)
      for (const item of [...new Set(['milk_bucket', 'bucket', egg, 'wheat', 'sugar', 'sugar_cane'])])
        if ((await serverCount(a, item).catch(() => 0)) > 0) await STORAGE_SKILLS.deposit.run(a, { item }, signal).catch(() => undefined);
    throw e;
  }
  v.cakes = (v.cakes ?? 0) + 1;
  noteFood(v, 'made', { cake: 1 });
  a.world.villages.save();
  await syncInventory(a).catch(() => {});
  for (const item of ['cake', 'bucket'])
    if ((await serverCount(a, item)) > 0)
      await STORAGE_SKILLS.deposit.run(a, { item }, signal).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        notes.push(`${item} not deposited: ${e.message.slice(0, 80)}`);
      });
  a.world.villages.note(v, `${a.name} baked a cake (${v.cakes} in all)`);
  return `baked a cake from the village storage (3 milk buckets, 2 sugar, 1 ${egg}, 3 wheat; the buckets back)${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

/**
 * A meal from the village storage (s30's appetite, D9; a chore code queues for a peckish member, never a model's tool): at
 * the storage hut, food carried goes in first by name (a stopped meal's, lesson 112), then the meal code chooses
 * (appetite.ts chooseMeal) is withdrawn, counted on the server and consumed by `clear` (vanilla `eat` refuses at 20/20, and
 * peaceful refills the bar), the level raised and the meal recorded on the village; what is left goes back by name.
 */
async function eatMeal(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('eat_meal: not in a village');
  const e = appetiteOn(v) ? v.food!.members[a.name] : undefined;
  if (!e) throw new Error('eat_meal: the village keeps no appetite for you');
  const h = v.storageHut;
  const job: Job = { targets: [], area: h ? { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 } : v.plots[0] ?? { x1: 0, z1: 0, x2: 0, z2: 0 }, y: v.plots[0]?.y ?? 64, free: true, what: 'a meal', task: 'eat_meal' };
  // (the meal chosen is held from the other members' meals and claims until this ends: the record stays as it was until a
  // withdrawal, lens 1 M1)
  let mine: { item: string; n: number } | undefined;
  const choose = () => {
    const m = chooseMeal(e.level, storeForMeals(v.name, storageContents(v), a.name));
    if (m) mine = holdMeal(v.name, a.name, m);
    return m;
  };
  try {
    await standBy(a, job, signal);
    const back = async (item: string) => STORAGE_SKILLS.deposit.run(a, { item }, signal).catch((err: Error) => {
      if (err.message === 'cancelled') throw err;
      return '';
    });
    for (const item of Object.keys(inventoryCounts(a))) if (FOOD_POINTS[item] !== undefined) await back(item);
    // The meal, withdrawn; the chests read again once when the record has nothing or the withdrawal got none
    let meal = choose(), have = 0;
    for (let round = 0; round < 2; round++) {
      if (round || !meal) {
        if (!v.storage?.chests.length) break;
        await refreshStorage(a, v, signal);
        meal = choose();
      }
      if (!meal) break;
      have = await serverCount(a, meal.item);
      if (have < meal.n) await withdrawItems(a, v, { [meal.item]: meal.n - have }, signal);
      have = await serverCount(a, meal.item);
      if (have) break;
    }
    // (another member was first to the last of it: contention, which neither bans eating for the village nor cools it)
    if (!meal || !have) throw new ContentionError('eat_meal: nothing to eat in the village storage (other members took it)', 'taken', 'stock:food');
    // (from the take to the record nothing awaits but the take itself: a stop there still records the meal, as harvest_farm's loot)
    const took = await a.world.rcon.take(a.name, meal.item, Math.min(meal.n, have), have);
    if (!took) throw new Error(`eat_meal: the server took no ${meal.item} from ${a.name}`);
    const before = e.level;
    e.level = Math.min(APPETITE.cap, e.level + took * FOOD_POINTS[meal.item]);
    e.meals = (e.meals ?? 0) + 1;
    e.lastMeal = { at: Date.now(), item: meal.item, n: took };
    const f = v.food!;
    f.eaten[meal.item] = (f.eaten[meal.item] ?? 0) + took;
    f.meals = (f.meals ?? 0) + 1;
    a.world.villages.save();
    console.log(`[food] ${a.name} ate ${took} ${meal.item} (${before.toFixed(1)} -> ${e.level.toFixed(1)} of 20; ${stateOf(e.level)})`);
    if ((await serverCount(a, meal.item).catch(() => 0)) > 0) await back(meal.item);
    return `ate ${took} ${meal.item} from the village storage (appetite ${Math.round(before)} -> ${Math.round(e.level)} of 20)`;
  } finally {
    releaseMeal(v.name, a.name, mine);
  }
}

/** Pickaxes from the weakest up (an iron one beats the stone ones a miner makes). */
const PICKS = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'];
const pickRank = (n: string) => PICKS.indexOf(n);
/** Pickaxe uses an iron trip starts with: trip 3 of Minevale33 dug 207 blocks in 5 minutes (a new iron pickaxe's 250 is enough). */
const TRIP_USES = 250;

/**
 * At the storage hut, the pickaxes an iron trip needs (the design review's M2, M3): the best one kept in storage if it
 * beats the best carried, and at least two of stone or better (a trip digs some 450 blocks; a wooden one would lose the
 * iron ore it digs), made from storage when short.
 */
async function ironPickaxes(a: BotAgent, v: Village, job: Job, signal: AbortSignal): Promise<string> {
  const notes: string[] = [];
  await syncInventory(a);
  const carried = () => a.bot.inventory.items().filter((it) => pickRank(it.name) >= 0);
  const best = () => Math.max(-1, ...carried().map((it) => pickRank(it.name)));
  const stored = Object.keys(storageContents(v)).filter((n) => pickRank(n) >= 0).sort((x, y) => pickRank(y) - pickRank(x))[0];
  if (stored && pickRank(stored) > best()) {
    await withdrawItems(a, v, { [stored]: 1 }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      notes.push(`not withdrawn: ${e.message.slice(0, 80)}`);
    });
    await syncInventory(a);
  }
  // Counted by the uses left, not by pickaxes: a worn stone pickaxe counted as one of the two, so none was made and two of
  // Minevale33's five trips stopped "no pickaxe left" after a few steps (F190). A trip digs up to ~250 blocks
  const left = (it: { maxDurability?: number; durabilityUsed?: number | null }) => Math.max(0, (it.maxDurability ?? 131) - (it.durabilityUsed ?? 0));
  const uses = carried().filter((it) => pickRank(it.name) >= 1).reduce((s, it) => s + left(it as never), 0);
  const make = Math.min(2, Math.ceil(Math.max(0, TRIP_USES - uses) / 131));
  if (make > 0) {
    await standBy(a, job, signal);
    // (the carried stone pickaxes as the need, so that they are not counted as stock for the new ones)
    const have = inventoryCounts(a).stone_pickaxe ?? 0;
    const made = await makeFromStock(a, have ? { stone_pickaxe: have } : {}, { stone_pickaxe: make }, () => standBy(a, job, signal), signal).catch((e: Error) => {
      if (e.message === 'cancelled' || unmoved(e)) throw e;
      notes.push(e.message.slice(0, 100));
      return null;
    });
    if (made) notes.push(made);
  }
  if (!carried().some((it) => pickRank(it.name) >= 1)) throw new Error(`dig_iron: no stone pickaxe and none could be made from the village storage (3 cobblestone and 2 sticks at a crafting table)${notes.length ? `; ${notes.join('; ')}` : ''}`);
  return notes.join('; ');
}

/**
 * The iron age (10-08; a chore code queues once the village stands, mcWorld.ts ironChores): one trip to the iron level.
 * At the storage hut first: everything carried deposited (room for the iron, the review's M7) and the pickaxes; then
 * mcMine.ts ironTrip (the stairs down to y 18 and its tunnels, keeping the iron and coal in their walls) for up to
 * `minutes`, or until `want` raw iron are carried; then everything deposited. Fails only when the trip gave nothing.
 */
async function digIron(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v?.mine || v.mine.level === undefined) throw new Error('dig_iron: the village has no mine at a level yet');
  const minutes = args.minutes !== undefined ? Math.max(1, num(args.minutes, 'minutes')) : 6;
  const want = args.want !== undefined ? Math.max(1, Math.floor(num(args.want, 'want'))) : 6;
  const h = v.storageHut;
  const job: Job = { targets: [], area: h ? { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 } : v.mine.hut, y: v.plots[0]?.y ?? v.mine.level, free: true, what: 'the iron level', task: 'dig_iron' };
  await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
  });
  const picks = await ironPickaxes(a, v, job, signal);
  const raw = () => a.bot.inventory.items().filter((it) => it.name === 'raw_iron').reduce((n, it) => n + it.count, 0);
  const coal = () => a.bot.inventory.items().filter((it) => it.name === 'coal').reduce((n, it) => n + it.count, 0);
  const before = { iron: v.mine.iron?.got.raw_iron ?? 0, dug: v.mine.iron?.dug ?? 0, steps: v.mine.iron?.steps ?? 0, gaveUp: v.mine.iron?.abandoned?.length ?? 0 };
  let out = await ironTrip(a, v, want, signal, Date.now() + minutes * 60000);
  // Still down there (its walks up failed, or it fell into a cave below the level): teleported home, never left 40 blocks
  // down, nor walked up (VanI5: the deposit's walk from a cave at y 11 dug a shaft up under the storage hut; the diff
  // review's M1)
  // (below the plot's level by more than a step: on hilly ground the hut can stand lower than the mine's top, the final review)
  const topY = Math.min(v.mine.level + v.mine.steps - 1, v.plots[0]?.y ?? Infinity);
  if (inIronLevel(a) || a.bot.entity.position.y < topY - 4) out += `; ${(await teleportHome(a, signal)) ?? 'no home to go back to'}`;
  const i = v.mine.iron;
  const carried = { iron: raw(), coal: coal() };
  const stored = await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
    return `not deposited: ${e.message.slice(0, 100)}`;
  });
  const progress = !!i && (i.steps > before.steps || i.dug > before.dug || (i.got.raw_iron ?? 0) > before.iron || (i.abandoned?.length ?? 0) > before.gaveUp);
  const text = `iron trip: ${out}; stairs ${i?.steps ?? 0} steps${i?.level !== undefined ? ` (level y=${i.level})` : ''}, ${i?.dug ?? 0} tunnel cells, ${i?.got.raw_iron ?? 0} raw iron and ${i?.got.coal ?? 0} coal in all; brought up ${carried.iron} raw iron, ${carried.coal} coal${picks ? ` (${picks})` : ''}; ${stored}`;
  if (!progress && !i?.finished) throw new Error(`dig_iron: no progress: ${text}`);
  return text;
}

/**
 * An iron tool made from the village's raw iron (the iron age, 10-08; a chore): at the storage hut, raw iron smelted to
 * ingots at its furnace (fuel from storage: F178) and the tool crafted at its table (makeFromStock chains them), then
 * put into storage by name (tools are kept back by "deposit all"), where miners take the best pickaxe from.
 */
async function makeIronTool(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('make_iron_tool: not in a village');
  const item = str(args.item, 'item');
  if (!/^(iron_pickaxe|bucket|shears|iron_axe|iron_shovel|iron_hoe)$/.test(item)) throw new Error(`make_iron_tool: not an iron tool: ${item}`);
  const h = v.storageHut;
  const job: Job = { targets: [], area: h ? { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 } : v.plots[0] ?? { x1: 0, z1: 0, x2: 0, z2: 0 }, y: v.plots[0]?.y ?? 64, free: true, what: `the ${item}`, task: 'make_iron_tool' };
  await standBy(a, job, signal);
  if (v.storage?.chests.length) await refreshStorage(a, v, signal);
  // (a tool already in storage is not this one: the chore makes one)
  const made = await makeFromStock(a, {}, { [item]: 1 }, () => standBy(a, job, signal), signal, { noStockPick: true, surplus: false });
  if (!made) throw new Error(`make_iron_tool: the ${item} cannot be made from the village storage yet (${Object.entries(storageContents(v)).filter(([n]) => /iron|coal/.test(n)).map(([n, q]) => `${q} ${n}`).join(', ') || 'no iron'})`);
  await syncInventory(a);
  if (!a.bot.inventory.items().some((it) => it.name === item)) throw new Error(`make_iron_tool: ${made}, but no ${item} is carried`);
  const stored = await STORAGE_SKILLS.deposit.run(a, { item }, signal).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
    return `not deposited: ${e.message.slice(0, 100)}`;
  });
  // (one entry a tool made: buckets are counted, a cake's milk takes three, pens v2)
  if (v.mine) v.mine.ironMade = [...(v.mine.ironMade ?? []), item];
  a.world.villages.note(v, `${a.name} made a ${item} from the village's iron`);
  a.world.villages.save();
  return `made a ${item} (${made}); ${stored}`;
}

/** A part made once for the village (make_into_storage) and the batch's leftovers that go back into storage by name. */
export const makeKeeps = (item: string): string[] => item === 'torch' ? [item] : [item, 'glass', 'sand'];

/**
 * Parts made once for the whole village (S.3; the soft task "Make 14 glass_pane into storage"): at the storage hut, as
 * many as the buildings still to draw their stock want (`partsWanted`: windows, or the lamps' torches) less what storage
 * holds, smelted and crafted from storage, then put into storage by name. The furnace is held from the reading of the
 * storage to the last deposit: a builder queued behind finds the panes there. Not a tool for models (code posts it).
 */
async function makeIntoStorage(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('make_into_storage: not in a village');
  const item = str(args.item, 'item');
  if (!/^(glass_pane|glass|torch)$/.test(item)) throw new Error(`make_into_storage: not a part the village makes once: ${item}`);
  const h = v.storageHut;
  // (the records, not villageStation: that also asks where the bot stands, and a worker in the mine was refused; both
  // stations, not the hut's build: they stand before it since S.5, and the panes are made before the houses)
  if (!h || !villageStationCell(v, 'crafting_table') || !villageStationCell(v, 'furnace')) throw new Error("make_into_storage: the storage hut's crafting table and furnace are not both standing yet");
  const t0 = Date.now();
  const job: Job = { targets: [], area: { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 }, y: v.plots[0]?.y ?? 64, free: true, what: `the village's ${item}`, task: 'make_into_storage' };
  await standBy(a, job, signal);
  // The chests read again only when the record cannot make what is wanted (items put in or taken out outside it; the
  // record is kept at every chest's close, and a full read takes the maker ~10 s before it queues for the furnace)
  const early = a.world.partsWanted(v, item).want - (storageContents(v)[item] ?? 0);
  const rest: Counts = { ...storageContents(v) };
  delete rest[item];
  if (v.storage?.chests.length && early > 0 && Object.keys(a.world.materials.plan({ [item]: early }, rest).gather).length) await refreshStorage(a, v, signal);
  // Leftovers carried in go in by name at the end too (sand and glass of a pane batch: lesson 112)
  const keep = makeKeeps(item);
  const release = await holdVillageFurnace(a, signal, `making ${item} into storage`);
  let text: string;
  try {
    const { want, buildings } = a.world.partsWanted(v, item);
    const store = storageContents(v)[item] ?? 0;
    const held = (await carriedCounts(a, [item]))[item] ?? 0;
    const make = want - store - held;
    const sec = () => ((Date.now() - t0) / 1000).toFixed(0);
    if (make <= 0) {
      console.log(`[parts] ${a.name} made nothing: storage holds ${store} ${item} (and it carries ${held}) for the ${want} wanted by ${buildings} ${item === 'torch' ? 'lamp jobs' : 'buildings'}`);
      text = `storage already holds ${store} ${item} for the ${want} still wanted; nothing made`;
    } else {
      // (the stock and what is carried count as the job's own, so they are netted out: otherwise the plan takes the stored
      // panes for the shortfall, makes nothing and reads as a failure, S.3's check)
      const makeIt = (q: number) => makeFromStock(a, { [item]: store + held }, { [item]: q }, async () => undefined, signal, { noStockPick: true, surplus: false, what: `the village's ${item}` });
      let made = await makeIt(make);
      // Short of the whole: as many whole batches as the stock makes (sand for one batch of two made none, and builders
      // then smelted the rest one by one, S.3's review); the rest is reported short
      let part = 0;
      if (!made) {
        const unit = item === 'glass_pane' ? 16 : item === 'torch' ? 4 : 1;
        const have: Counts = { ...inventoryCounts(a) };
        for (const [n, q] of Object.entries(storageContents(v))) have[n] = (have[n] ?? 0) + q;
        delete have[item];
        for (let k = Math.ceil(make / unit) - 1; k >= 1 && !part; k--) {
          const p = a.world.materials.plan({ [item]: k * unit }, have);
          if (!Object.keys(p.gather).length && !p.problems.length) part = k * unit;
        }
        if (part) made = await makeIt(part);
      }
      if (!made) {
        if (item !== 'torch' && v.unavailable?.includes('sand')) {
          console.log(`[parts] ${a.name} made nothing: no sand near the village (${make} ${item} wanted)`);
          text = `no sand: the windows stay open (${make} ${item} wanted)`;
        } else {
          const other: Counts = { ...storageContents(v) };
          delete other[item];
          const plan = a.world.materials.plan({ [item]: make }, other);
          throw new Error(`make_into_storage: ${make} ${item} cannot be made from the village storage yet (${describeWork(plan) || 'nothing to make it from'})`);
        }
      } else {
        const n = (await carriedCounts(a, [item]))[item] ?? 0;
        const rest = part ? `; ${make - (n - held)} more short (${item !== 'torch' && v.unavailable?.includes('sand') ? 'no sand: those windows stay open' : 'storage holds too little to make them yet'})` : '';
        console.log(`[parts] ${a.name} made ${n - held} ${item} into storage (wanted ${want} by ${buildings} ${item === 'torch' ? 'lamp jobs' : 'buildings'}, storage had ${store}) in ${sec()}s${rest}`);
        text = `made ${n - held} ${item} (${made})${rest}`;
      }
    }
    // Everything carried of it (and of the batch's leftovers) into storage, counted on the server, before the furnace is
    // let go
    const carried = await carriedCounts(a, keep);
    const put: string[] = [];
    for (const n of keep) {
      if (!carried[n]) continue;
      const r = await STORAGE_SKILLS.deposit.run(a, { item: n, count: carried[n] }, signal).catch((e: Error) => {
        if (e.message === 'cancelled' || unmoved(e)) throw e;
        return `not deposited: ${e.message.slice(0, 100)}`;
      });
      put.push(/^not deposited/.test(r ?? '') ? `${carried[n]} ${n} ${r}` : `${carried[n]} ${n}`);
    }
    if (put.length) text += `; put into storage: ${put.join(', ')}`;
  } finally {
    release();
  }
  return text;
}

/** Items as the make's end line lists them ("cobblestone:12,oak_log:1"; "none"). */
const countsList = (c: Counts) => Object.entries(c).filter(([, q]) => q > 0).map(([n, q]) => `${n}:${q}`).join(',') || 'none';

/**
 * The workshop's make (S.9, D1; a chore code queues for an idle member of a complete village, not a tool for models): one
 * batch of a good kept in stock (mcWorkshop.ts MAKE_GOODS), made at the storage hut from spare storage and put into
 * storage by name. Beside make_into_storage, sharing its machinery: the plan is the world's (makePlan: the batch, its bill
 * and the inputs it may take, leaving out other agents' earmarks); the inputs are withdrawn first and the batch made with
 * an empty storage view, so nothing kept is taken (D2); a smelting batch holds furnace `furnace` (k 1-3 the works plot's,
 * 0 the hut's) for the whole job. Every count that decides is the server's (lessons 4, 13). Its earmark ends at the
 * withdrawal and in the finally (lesson 67); what a stop leaves in hand is in makeLeft for the world to deposit.
 */
async function makeGoods(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('make: not in a village');
  // The earmark the world set for this chore, read before any await: only that one is this run's to end (a late finally
  // deleted the next chore's, S.9's review, lens 1 L1, lens 2 L5); a refusal ends it at once, not at the next sweep
  const key = holdKey(v.name, a.name), mine = makeHolds.get(key);
  const refuse = (why: string) => {
    holdsRelease(key, mine);
    return new Error(why);
  };
  const item = str(args.item, 'item');
  const good = [...MAKE_GOODS, ...FOOD_GOODS].find((g) => g.item === item);
  if (!good) throw refuse(`make: ${item} is not a good the workshop keeps`);
  const h = v.storageHut;
  if (!v.complete || !h || !villageStationCell(v, 'crafting_table') || !villageStationCell(v, 'furnace'))
    throw refuse("make: the workshop runs once the village is complete, with the storage hut's crafting table and furnace standing");
  const k = args.furnace !== undefined ? Math.floor(num(args.furnace, 'furnace')) : undefined;
  const wk = v.layouts?.[0]?.works;
  // A works furnace the server no longer has: its record cleared, so its placement is offered again (the check's M7)
  const gone = () => {
    if (!k || !wk?.furnaces?.[k - 1]) return;
    wk.furnaces[k - 1] = null;
    a.world.villages.save();
    console.log(`[works] ${v.name}: furnace ${k} is gone (found by ${a.name}); its record cleared`);
  };
  let cell: { x: number; y: number; z: number } | undefined;
  try {
    if (k !== undefined && k >= 1) {
      const f = wk?.furnaces?.[k - 1];
      if (!f) throw new Error(`make: works furnace ${k} is not recorded`);
      cell = { x: f.x, y: f.y, z: f.z };
      // (only a "failed" answer means gone: a cell whose chunk the server has not loaded is checked again at the smelt)
      const r = await a.world.rcon.command(`execute if block ${f.x} ${f.y} ${f.z} minecraft:furnace`).catch(() => '');
      if (/failed/i.test(r)) {
        gone();
        throw new Error(`make: works furnace ${k} is gone`);
      }
    } else if (k === 0) cell = villageStationCell(v, 'furnace') ?? undefined;
  } catch (e) {
    holdsRelease(key, mine);
    throw e;
  }
  const t0 = Date.now();
  const what = `the workshop's ${good.words}`;
  // Before the withdrawal: what the agent carries, the server's counts for the good, the inputs and the fuel and the synced
  // view for the rest; every gain against it goes back into storage by name (lesson 112)
  let start: Counts | null = null, view0: Counts = {}, keyNames: string[] = [];
  const gains = async (): Promise<Counts> => {
    await syncInventory(a).catch(() => undefined);
    const view = inventoryCounts(a);
    // (a tool in hand other than the good is the agent's own, as deposit "all" keeps it: B4f's stone_hoe make listed the
    // maker's stone pickaxe as left over, for the sweep to put into storage)
    const names = [...new Set([...keyNames, ...Object.keys(view), ...Object.keys(view0)])]
      .filter((n) => keyNames.includes(n) || (view[n] ?? 0) !== (view0[n] ?? 0)).filter((n) => n === item || !TOOL.has(n));
    const now = await carriedCounts(a, names);
    const out: Counts = {};
    for (const n of names) if ((now[n] ?? 0) > (start?.[n] ?? 0)) out[n] = now[n] - (start?.[n] ?? 0);
    return out;
  };
  const putBack = async (c: Counts) => {
    for (const [n, q] of Object.entries(c)) {
      if (q <= 0) continue;
      await STORAGE_SKILLS.deposit.run(a, { item: n, count: q, keep_wood: true }, signal).catch((e: Error) => {
        if (e.message === 'cancelled' || unmoved(e)) throw e;
        console.log(`[make] ${a.name} could not put ${q} ${n} back into storage: ${e.message.slice(0, 120)}`);
      });
    }
  };
  // What is still carried beyond the start: none, or makeLeft's for the world to deposit (4.10); written only over this
  // run's own record (a stopped make's late settle overwrote the next make's, S.9's review, lens 2 L5)
  let leftRec: Counts | undefined;
  const settle = async () => {
    const left = await gains();
    if (makeLeft.has(key) && makeLeft.get(key) !== leftRec) return left;
    if (Object.keys(left).length) makeLeft.set(key, (leftRec = left));
    else makeLeft.delete(key);
    return left;
  };
  let planned: Counts = {}, took: Counts = {}, count = 0, smelts = false, storeBefore = 0, backDone = false;
  const endLine = (made: number, back: Counts, left: Counts) =>
    console.log(`[make] ${a.name} ${v.name} item=${item} made=${made} batch=${count} furnace=${smelts ? k ?? 0 : '-'} planned=${countsList(planned)} took=${countsList(took)} `
      + `back=${countsList(back)} left=${countsList(left)} storage=${storeBefore}->${storageContents(v)[item] ?? 0} sec=${((Date.now() - t0) / 1000).toFixed(0)}`);
  // What was gained put back by name (the batch not made), settled and logged with what went back (the end line read
  // "back=none" after a put-back, S.9's review, lens 2 L7)
  const backOf = (g: Counts, left: Counts) => {
    const back: Counts = {};
    for (const [x, q] of Object.entries(g)) if (q - (left[x] ?? 0) > 0) back[x] = q - (left[x] ?? 0);
    return back;
  };
  const giveBack = async () => {
    const g = await gains();
    await putBack(g);
    backDone = true;
    const left = await settle();
    endLine(0, backOf(g, left), left);
  };
  try {
    const job: Job = { targets: [], area: { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 }, y: v.plots[0]?.y ?? 64, free: true, what, task: 'make' };
    await standBy(a, job, signal);
    // The chests read again only when the record cannot make it (make_into_storage's rule)
    let p = a.world.makePlan(v, good, a.name);
    if ('why' in p && p.why === 'inputs short' && v.storage?.chests.length) {
      await refreshStorage(a, v, signal);
      p = a.world.makePlan(v, good, a.name);
    }
    if ('why' in p) throw new ContentionError(`make: ${item}: ${p.why}`, 'taken', `stock:${item}`);
    // A batch offered as crafting that smelts now (the charcoal it counted on was taken): no furnace key is held for it, so
    // it goes back to the menu, which offers it with a free furnace (S.9's review, lens 1 L4, lens 4 L5)
    if (p.smelts && k === undefined && args.chore) throw new ContentionError(`make: ${item}: the batch smelts now and holds no furnace`, 'taken', 'furnace:0');
    planned = p.inputs;
    count = p.count;
    smelts = p.smelts;
    let bill = p.bill, craftOf = p.craft;
    storeBefore = storageContents(v)[item] ?? 0;
    keyNames = [...new Set([item, ...Object.keys(p.inputs), 'coal', 'charcoal'])];
    await syncInventory(a);
    view0 = inventoryCounts(a);
    start = { ...view0, ...(await carriedCounts(a, keyNames)) };
    took = { ...((await withdrawItems(a, v, p.inputs, signal)).got as Record<string, number>) };
    holdsRelease(key, mine);
    makeLeft.set(key, (leftRec = { ...took }));
    // Short (another agent took some meanwhile; there is no chest lock): the largest smaller whole batch from what was
    // withdrawn, else everything back and the contention said
    const shortOf = Object.keys(p.inputs).find((n) => (took[n] ?? 0) < p.inputs[n]);
    if (shortOf) {
      const plan = (b: Counts, have: Counts) => a.world.materials.plan(b, have);
      let smaller: ReturnType<typeof makeBill> = null;
      for (let c = count - good.unit; c > 0 && !smaller; c -= good.unit) {
        const b = makeBill(a.world.registry, plan, good, c, took, p.craft?.wood ?? v.wood);
        if (b?.feasible) {
          smaller = b;
          count = c;
        }
      }
      if (!smaller) {
        await giveBack();
        throw new ContentionError(`make: ${item}: another agent took the ${shortOf} (got ${took[shortOf] ?? 0} of ${p.inputs[shortOf]}); what was withdrawn went back`, 'taken', `stock:${shortOf}`);
      }
      bill = smaller.bill;
      craftOf = smaller.craft;
      smelts = plan(bill, took).fuel.smelts > 0;
      console.log(`[make] ${a.name} ${v.name}: ${item} short of ${shortOf} (took ${took[shortOf] ?? 0} of ${p.inputs[shortOf]}): a smaller batch of ${count}`);
      // (a smaller batch that smelts where the whole one did not: no furnace key either, as above)
      if (smelts && k === undefined && args.chore) {
        await giveBack();
        throw new ContentionError(`make: ${item}: the smaller batch smelts and holds no furnace; what was withdrawn went back`, 'taken', 'furnace:0');
      }
    }
    // Only what was withdrawn is used: everything carried before is the agent's own (its pickaxe), netted out
    const need: Counts = { ...start };
    // (no furnace held for a crafting batch; a smelting one without a key, only outside a chore, falls back to the hut's
    // by today's rule)
    const opts = { noStockPick: true, surplus: false, stock: {}, furnace: smelts ? cell : (false as const), what };
    let made: string | null;
    if (craftOf) {
      // A variant good (barrel, composter): its planks and slabs of one kind, then the good itself at the hut's table
      const parts: Counts = {};
      for (const [n, q] of Object.entries(bill)) if (q > (took[n] ?? 0)) parts[n] = q - (took[n] ?? 0);
      // (the parts withdrawn as they are stay the good's: planned against, 4 slabs withdrawn for a composter stood for the
      // 3 still to make, nothing was made and the craft came up short, S9s1)
      const kept: Counts = { ...need };
      for (const [n, q] of Object.entries(bill)) if (took[n]) kept[n] = (kept[n] ?? 0) + Math.min(q, took[n]);
      const madeParts = Object.keys(parts).length ? await makeFromStock(a, kept, parts, async () => undefined, signal, opts) : 'its parts withdrawn';
      made = madeParts && `${madeParts}; ${await SURVIVAL_SKILLS.craft.run(a, { item, count: craftOf.count, wood: craftOf.wood }, signal)}`;
    } else {
      made = await makeFromStock(a, need, bill, async () => undefined, signal, opts);
      if (!made) {
        // (F226: 8 smooth stone from 2 charcoal and 8 cobblestone refused in 2 s, the server holding both; what the view
        // and the server said is logged, then once more after a fresh inventory)
        const view = inventoryCounts(a), server = await carriedCounts(a, Object.keys(bill).concat(Object.keys(took)));
        console.log(`[make] ${a.name} ${v.name}: ${item} planned nothing; view ${listCounts(view) || 'empty'}; server ${listCounts(server) || 'empty'}; need ${listCounts(need) || 'none'}; once more`);
        await syncInventory(a);
        made = await makeFromStock(a, need, bill, async () => undefined, signal, opts);
      }
    }
    if (!made) {
      await giveBack();
      throw new Error(`make: could not make ${count} ${item} from what was withdrawn (${listCounts(took) || 'nothing'})`);
    }
    // The batch and every leftover (planks, sticks, inputs not used) into storage by name, counted on the server
    const g = await gains();
    // (bread and pies into the village's food ledger, s30, as soon as the server's count gives them: a make stopped in its
    // put-back leaves them in makeLeft, put back later; lens 3 L2)
    if (good.food) noteFood(v, 'made', { [item]: g[item] ?? 0 });
    await putBack(g);
    backDone = true;
    const left = await settle();
    const n = Math.max(0, (g[item] ?? 0) - (left[item] ?? 0));
    const back: Counts = {};
    for (const [x, q] of Object.entries(g)) if (x !== item && q - (left[x] ?? 0) > 0) back[x] = q - (left[x] ?? 0);
    endLine(g[item] ?? 0, back, left);
    if (!g[item]) throw new Error(`make: made no ${item} (${made})`);
    return `made ${g[item]} ${item} (${made}); put into storage: ${n} ${item}${Object.keys(back).length ? `, ${listCounts(back)}` : ''}${Object.keys(left).length ? `; still carrying ${listCounts(left)}` : ''}`;
  } catch (e) {
    const why = (e as Error).message;
    if (/furnace at .* is gone/.test(why)) gone();
    // As partsBack: a failure that is not a stop or an unmoved stall puts what was gained back by name; whatever is still in
    // hand stays in makeLeft (a stopped make's leftovers: its deposits would fail on the aborted signal)
    if (start && !backDone) {
      // (a count that fails must not replace the error being reported, nor skip the settle: S.9's review, lens 4 L4)
      let g: Counts = {};
      if (why !== 'cancelled' && !signal.aborted && !unmoved(e))
        await gains().then((x) => putBack((g = x))).catch(() => undefined);
      await settle().then((left) => endLine(0, backOf(g, left), left)).catch(() => undefined);
    }
    throw e;
  } finally {
    holdsRelease(key, mine);
  }
}

/**
 * A furnace on the works plot (S.9, 6.2; a chore once the plot is ready): furnace k of worksFurnaces' row, placed as the
 * stations are (placeStation with the cell: 8 cobblestone from storage, crafted at the hut's table, set by command with
 * `keep` and its facing, never inside a player, confirmed on the server, given back when not placed; lessons 29, 33, 44),
 * recorded on the works plot (found or placed). Its 8 cobblestone are earmarked by the world until they are withdrawn (the
 * check's M5; not through the craft and the walk back, S.9's review, lens 1 L2), and only this chore's earmark is ended
 * (as make's).
 */
async function placeWorksFurnace(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const key = v ? holdKey(v.name, a.name) : '';
  const mine = key ? makeHolds.get(key) : undefined;
  try {
    if (!v) throw new Error('place_works_furnace: not in a village');
    const k = Math.floor(num(args.k, 'k'));
    const wk = v.layouts?.[0]?.works;
    if (wk?.state !== 'ready') throw new Error('place_works_furnace: the works plot is not prepared yet');
    if (!(k >= 1 && k <= WORKS_FURNACES)) throw new Error(`place_works_furnace: k is 1 to ${WORKS_FURNACES}, not ${k}`);
    const c = worksFurnaces(wk)[k - 1];
    let how = 'placed';
    const b = await placeStation(a, 'furnace', signal, `works furnace ${k}`, 0, false, {
      pos: { x: c.x, y: wk.y + 1, z: c.z },
      facing: c.facing,
      lockKey: `${v.name}:works:${k}`,
      withdrawn: () => holdsRelease(key, mine),
      record: (pos, found) => {
        how = found ? 'found' : 'placed';
        const f = (wk.furnaces ??= []);
        while (f.length < k) f.push(null);
        const was = f[k - 1];
        if (was && was.x === pos.x && was.y === pos.y && was.z === pos.z) return;
        f[k - 1] = { x: pos.x, y: pos.y, z: pos.z, by: a.name, at: Date.now() };
        a.world.villages.note(v, `${a.name} ${how} works furnace ${k} at ${at(pos)}`);
        a.world.villages.save();
        console.log(`[works] ${v.name}: furnace ${k} ${how} at ${pos.x},${pos.y},${pos.z} by ${a.name}`);
      },
    });
    const pos = b?.position ?? { x: c.x, y: wk.y + 1, z: c.z };
    const stand = (wk.furnaces ?? []).slice(0, WORKS_FURNACES).filter(Boolean).length;
    return `${how} works furnace ${k} at ${at(pos)} (${stand} of ${WORKS_FURNACES} stand on the works plot)`;
  } finally {
    if (key) holdsRelease(key, mine);
  }
}

/** place_station's item: the storage hut's crafting table or furnace (S.5). */
function stationArg(raw: unknown): StationName {
  const n = String(raw ?? '').trim().toLowerCase().replace(/^minecraft:/, '');
  const name = n === 'table' ? 'crafting_table' : n;
  if (!(STATION_NAMES as readonly string[]).includes(name)) throw new Error(`place_station: item is crafting_table or furnace, not ${String(raw)}`);
  return name as StationName;
}

/**
 * The village's table or furnace into its cell of the storage hut, before the hut is built (S.5; code-posted tasks name it:
 * the storage set-up, the mine's digger once it has walked out, and the stations task, the fallback). Not a tool for models.
 * `optional=true` (the mine's digger): a placement that fails is reported, not failed, so the task it ends (the dig, which
 * the cobblestone gathering waits for) is never held by it; the stations task places it then.
 */
async function placeStationSkill(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const name = stationArg(args.item);
  const v = a.village();
  const t = v?.tasks.find((x) => x.status === 'claimed' && x.claimedBy === a.name && /place_station /.test(x.detail));
  let b: Awaited<ReturnType<typeof placeStation>>;
  try {
    // (the stations task gathers what storage cannot give; the mine's digger leaves it to that task)
    b = await placeStation(a, name, signal, t ? `${t.id} "${t.title}"` : 'place_station', 0, String(args.optional) !== 'true');
  } catch (e) {
    if (String(args.optional) !== 'true' || (e as Error).message === 'cancelled' || unmoved(e)) throw e;
    console.log(`[station] ${a.name}: the ${name} not placed (${(e as Error).message.slice(0, 160)}); left to the stations task`);
    return `the ${name} was not placed (${(e as Error).message}); the stations task places it`;
  }
  const s = v?.stations?.[name];
  return `the village's ${name} stands in the storage hut at ${s ? `${s.x},${s.y},${s.z}` : b ? at(b.position) : 'its cell'}`;
}

/**
 * Where a lighter stands to light a building (B.4, M5, lesson 61: somewhere to wait outside, visibly at its door; the
 * torches are set by command, so reach is not physical): 3 out of the entrance door and 2 or 1 to either side, then 4 out
 * and 2 to either side, then straight out 2 and 3 on its walkway (not for the mining hut, whose doorway line is the
 * miners' way); at the building's own level only, outside its area and a block round it, within 12 blocks of its centre or
 * its door, off the ground no one waits on (standTaken), others' reservations, every building's doorway and the cell in
 * front of it, and other buildings' walkways 2 and 3 out (a straight-out candidate is walked to exactly). A town centre, or a building with none, a stand spot as a job's ('fallback'); null: place from where the
 * bot stands.
 */
function doorStand(a: BotAgent, part: LightPart): { x: number; y: number; z: number; how: 'door' | 'fallback'; exact?: boolean } | null {
  const v = a.village();
  const st = part.structure;
  if (!v || !st) return null;
  const door = part.place ? placedDoor(part.place) : null;
  if (door) {
    // (the mine's tunnel boxes lie far under the street: only the hut and its stairs' box, up to the hut's floor, take ground
    // here; a tunnel under the houses sent 16 of 203 stored buildings to the fallback)
    const taken = standTaken(a, v).filter((q) => (q as Area & { y2?: number }).y2 === undefined || (q as Area & { y2: number }).y2 >= st.y);
    const now = Date.now();
    const reserved = v.reservations.filter((r) => r.by !== a.name && r.until > now);
    // (every building's doorway and the cell in front of it; another building's walkway 2 and 3 out as well, the spec's
    // k = 1..3: a lighter waiting there stands in the way of everyone using that door, B.4's review, lens 1 L4)
    const doorways = new Set<string>();
    for (const b of a.world.lightParts(v)) {
      const d = b.kind === 'building' && b.place ? placedDoor(b.place) : null;
      if (d) for (const k of b.part === part.part ? [0, 1] : [0, 1, 2, 3]) doorways.add(`${d.x + d.ox * k},${d.z + d.oz * k}`);
    }
    const inside = (q: Area, x: number, z: number) => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2;
    const near = (x: number, z: number) => Math.hypot(x - (st.x1 + st.x2) / 2, z - (st.z1 + st.z2) / 2) <= 12 || Math.hypot(x - door.x, z - door.z) <= 12;
    const { ox, oz } = door, [sx, sz] = [oz, -ox];
    const cands: Array<[number, number, boolean]> = [];
    for (const s2 of [2, -2, 1, -1]) cands.push([door.x + 3 * ox + s2 * sx, door.z + 3 * oz + s2 * sz, false]);
    for (const s2 of [2, -2]) cands.push([door.x + 4 * ox + s2 * sx, door.z + 4 * oz + s2 * sz, false]);
    // (none straight out: range 1 from 2 out accepted the cell in front of the door, inside the building's ring, lens 1 L4,
    // and a walk to the cell itself stalled ~10 s on a dirt path, the fix review's M2; the side cells cover 192 of 199)
    for (const [x, z, exact] of cands) {
      if (inside({ x1: st.x1 - 1, z1: st.z1 - 1, x2: st.x2 + 1, z2: st.z2 + 1 }, x, z) || !near(x, z)) continue;
      if (taken.some((q) => inside(q, x, z)) || reserved.some((q) => inside(q, x, z)) || doorways.has(`${x},${z}`)) continue;
      const y = standableY(a, x, st.y + 1, z, 2);
      if (y !== null) return { x, y, z, how: 'door', ...(exact ? { exact } : {}) };
    }
  }
  const spot = standSpot(a, { targets: [], area: { x1: st.x1, z1: st.z1, x2: st.x2, z2: st.z2 }, y: st.y, free: true, what: `the ${part.label}` });
  return spot ? { ...spot, how: 'fallback' } : null;
}

/** A block in the bot's view with its states ("oak_stairs[facing=east,half=bottom]"), null when not loaded. */
function stateName(a: BotAgent, x: number, y: number, z: number): string | null {
  const b = a.bot.blockAt(new Vec3(x, y, z));
  if (!b) return null;
  const props = Object.entries((b.getProperties?.() ?? {}) as Record<string, unknown>).map(([k, q]) => `${k}=${String(q)}`);
  return props.length ? `${b.name}[${props.join(',')}]` : b.name;
}

/** Which light run last wrote an agent's lightCarried ("village|agent"): only that run deletes it. */
const lightRuns = new Map<string, symbol>();

/**
 * put_up_torches part= count= (B.4; a chore, not in TOOLS): torches from the village storage into a part's unlit spots, by
 * command and charged one at a time (lesson 44's case is suffocation; a torch has no collision box, so no player check).
 * At the storage hut: the part's recorded spots checked again in the bot's view, the first `count` unlit ones taken as
 * targets and their torches withdrawn (the world's earmark ends there; carried, they lower the demand, L2). A building
 * is lit from beside its door (doorStand; a failed walk is not fatal, but never from inside), the mine from the hut. Each
 * spot is judged in the bot's view before it is set (a torch set on a bad support stays floating, the live facts: the
 * rule must be exact): a building's by its planned support, the mine's by the first wall of MINE_SUPPORT; a cell not
 * loaded is skipped and not counted, any other skip twice makes the spot never (M4). Confirmed on the server a second
 * later (lessons 29, 50, 80), recorded on the village (v.lights, lesson 103), and torches beyond what it carried at the
 * start put back by name (lesson 112). Stopped, stalled unmoved or not put back: what it carries beyond that is makeLeft's
 * for the sweep to deposit. A run that confirms, finds or rules out nothing ends "no progress" (the world backs it off).
 */
async function putUpTorches(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('put_up_torches: not in a village');
  // (the world's earmark for this chore, read before any await: only that one is this run's to end, as make's)
  const key = holdKey(v.name, a.name), mine = makeHolds.get(key);
  const refuse = (why: string) => {
    holdsRelease(key, mine);
    return new Error(why);
  };
  const part = str(args.part, 'part');
  const count = Math.max(1, Math.floor(num(args.count, 'count')));
  const h = v.storageHut;
  if (!v.complete || !v.storage?.chests.length || !h) throw refuse('put_up_torches: lighting runs once the village is complete, with its storage hut and chests');
  const P = a.world.lightParts(v).find((q) => q.part === part);
  if (!P) throw refuse(`put_up_torches: the village has no part ${part} to light`);
  const t0 = Date.now();
  const reg = a.world.villages;
  const old = v.lights?.[part];
  const done = new Set(old?.done ?? []), never = new Set(old?.never ?? []);
  const skips: Record<string, number> = { ...(old?.skips ?? {}) };
  const keyOf = (q: { x: number; y: number; z: number }) => `${q.x},${q.y},${q.z}`;
  let carried0 = 0, took = 0, placed = 0, standing = 0, dropped = 0, unconfirmed = 0, newNever = 0, skipped = 0, found = 0, back = 0, left = 0, counted = false;
  // (the count before the last deposit: a failure during it still reports what went back, B.4's review, lens 2 L9)
  let beforeBack: number | null = null;
  let walked: 'ok' | 'failed' | 'none' = 'none';
  const record = () => {
    v.lights = { ...(v.lights ?? {}), [part]: { done: [...done], ...(never.size ? { never: [...never] } : {}), ...(Object.keys(skips).length ? { skips } : {}), at: Date.now(), by: a.name } };
    reg.save();
  };
  const endLine = () => console.log(`[light] ${a.name} ${v.name} part=${part} placed=${placed} standing=${standing} dropped=${dropped} never=${newNever} skipped=${skipped} carried0=${carried0} took=${took} back=${back} left=${left} walk=${walked} sec=${((Date.now() - t0) / 1000).toFixed(0)}${unconfirmed ? ` unconfirmed=${unconfirmed}` : ''}`);
  const skip = (k: string, loaded: boolean) => {
    skipped++;
    if (!loaded) return;
    skips[k] = (skips[k] ?? 0) + 1;
    if (skips[k] >= 2 && !never.has(k)) {
      never.add(k);
      newNever++;
    }
  };
  const markNever = (k: string) => {
    if (never.has(k)) return;
    never.add(k);
    newNever++;
  };
  const torch = (q: LightPart['spots'][number], name: string | null) => name === q.block || (q.block === 'wall_torch' && name === 'wall_torch');
  // The torches it carries, for the demand (lightCarried), and what a stop or stall leaves in hand, for the sweep (makeLeft):
  // each written and deleted only while it is this run's (a stopped run's catch awaiting RCON overwrote the agent's next
  // chore's, B.4's review, lens 1 L6 and lens 2 L6; make's leftRec guard)
  const run = Symbol(part);
  const carry = (n: number) => {
    lightRuns.set(key, run);
    lightCarried.set(key, n);
  };
  const uncarry = () => {
    if (lightRuns.get(key) !== run) return;
    lightRuns.delete(key);
    lightCarried.delete(key);
  };
  let leftRec: Counts | undefined;
  const leave = (n: number) => {
    if (makeLeft.has(key) && makeLeft.get(key) !== leftRec) return;
    if (n > 0) makeLeft.set(key, (leftRec = { torch: n }));
    else if (makeLeft.has(key)) makeLeft.delete(key);
  };
  const step: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  // A spot's torch judged in the bot's view by its support (the cell itself free): the block to set, or null; `loaded`
  // false when a support's chunk is not in the view (not the spot's fault, never counted toward never: lens 1 L8); and
  // the support with its state, for the server to confirm before a second placement
  const judge = (q: LightPart['spots'][number]): { block: string | null; loaded: boolean; support?: [number, number, number]; state?: string } => {
    if (P.kind === 'mine') {
      for (const sd of q.sides ?? []) {
        const sup = blockName(a, ...sd.support);
        if (sup === null) return { block: null, loaded: false };
        if (MINE_SUPPORT.has(sup)) return { block: `wall_torch[facing=${sd.facing}]`, loaded: true, support: sd.support, state: sup };
      }
      return { block: null, loaded: true };
    }
    if (q.block === 'wall_torch' && q.facing) {
      const [fx, fz] = step[q.facing];
      const s: [number, number, number] = [q.x - fx, q.y, q.z - fz];
      const sup = stateName(a, ...s);
      if (sup === null) return { block: null, loaded: false };
      return holdsTorch(sup, q.facing) ? { block: `wall_torch[facing=${q.facing}]`, loaded: true, support: s, state: sup } : { block: null, loaded: true };
    }
    if (q.block === 'torch') {
      const s: [number, number, number] = [q.x, q.y - 1, q.z];
      const sup = stateName(a, ...s);
      if (sup === null) return { block: null, loaded: false };
      return holdsStandingTorch(sup) ? { block: 'torch', loaded: true, support: s, state: sup } : { block: null, loaded: true };
    }
    return { block: null, loaded: true };
  };
  try {
    // 0. Out of the deep first (lesson 101): never walked up from the iron level or a cave
    const plotY = v.plots[0]?.y ?? a.bot.entity.position.y;
    if (inIronLevel(a) || a.bot.entity.position.y < plotY - 4) await teleportHome(a, signal);
    // 1. At the storage hut
    const job: Job = { targets: [], area: { x1: h.x1, z1: h.z1, x2: h.x2, z2: h.z2 }, y: v.plots[0]?.y ?? 64, free: true, what: `the ${P.label}'s torches`, task: 'put_up_torches' };
    await standBy(a, job, signal);
    // The recorded spots again, in the bot's view: one missing or wrong is unlit again (a hand dig took its wall)
    for (const q of P.spots) {
      const k = keyOf(q);
      if (!done.has(k)) continue;
      const name = blockName(a, q.x, q.y, q.z);
      if (name !== null && !torch(q, name)) done.delete(k);
    }
    const faces = P.kind === 'mine' && v.mine ? mineFacesGoing(v.mine) : [];
    const targets = P.spots.filter((q) => !done.has(keyOf(q)) && !never.has(keyOf(q)) && !(P.kind === 'mine' && nearMineFace(faces, q))).slice(0, count);
    if (!targets.length) throw new ContentionError(`put_up_torches: nothing unlit in the ${P.label} (another lighter was first)`, 'taken', `light:${part}`);
    carried0 = await a.world.rcon.count(a.name, 'torch');
    counted = true;
    const want = Math.min(count, targets.length) - carried0;
    if (want > 0) took = ((await withdrawItems(a, v, { torch: want }, signal)).got as Record<string, number>).torch ?? 0;
    holdsRelease(key, mine);
    carry(carried0 + took);
    // (what it carries now from the server, not the chest window's count: the view drifts after withdrawals, lesson 13;
    // B.4's review, lens 1 L7)
    if (want > 0) {
      const have = await a.world.rcon.count(a.name, 'torch').catch(() => null);
      if (have !== null) {
        took = Math.max(0, have - carried0);
        carry(carried0 + took);
      }
    }
    if (carried0 + took <= 0) throw new ContentionError('put_up_torches: no torches in storage (another agent took them)', 'taken', 'stock:torch');
    // 2. A building: to the stand spot beside its door
    let inside = false;
    if (P.kind === 'building' && P.structure) {
      const st = P.structure;
      const spot = doorStand(a, P);
      const within = () => {
        const p = a.bot.entity.position;
        return p.x >= st.x1 - 1 && p.x < st.x2 + 2 && p.z >= st.z1 - 1 && p.z < st.z2 + 2;
      };
      if (spot) {
        console.log(`[light] ${a.name} walks to the ${P.label}: stand ${spot.x},${spot.y},${spot.z} (${spot.how}), ${P.walk ?? '?'} blocks from the hut`);
        // (the second try ends on the cell itself: a range-1 goal met from inside the ring walks nowhere, lens 1 L4)
        const go = (exact: boolean) => walk(a, new goals.GoalNear(spot.x, spot.y, spot.z, exact ? 0 : 1), `the ${P.label}'s door`, signal, 90000, { scaffold: false });
        walked = 'ok';
        await go(!!spot.exact).catch((e: Error) => {
          if (e.message === 'cancelled' || unmoved(e)) throw e;
          walked = 'failed';
        });
        if (within()) await go(true).catch((e: Error) => {
          if (e.message === 'cancelled' || unmoved(e)) throw e;
          walked = 'failed';
        });
      }
      // (never placed from inside: a stand spot that left it there, or a walk that failed in the doorway)
      inside = within();
    }
    // 3. Each target judged in the bot's view, then set by command and charged, paced at buildSpeed x 10 a second
    const pace = 1000 / (Math.max(0.25, Math.min(20, Number(a.memory.buildSpeed) || 1)) * 10 * timeScale());
    let before = carried0 + took;
    const set: Array<{ q: LightPart['spots'][number]; block: string }> = [];
    // 'out': no torch left to charge (not the spot's fault)
    const put = async (x: number, y: number, z: number, block: string): Promise<'set' | 'refused' | 'out'> => {
      if (before <= 0) return 'out';
      const n = await a.world.rcon.take(a.name, 'torch', 1, before);
      if (n < 1) {
        before = await a.world.rcon.count(a.name, 'torch');
        return 'out';
      }
      before -= n;
      const r = await a.world.rcon.command(`setblock ${x} ${y} ${z} minecraft:${block} keep`).catch(() => '');
      if (/Changed the block/i.test(r)) {
        placed++;
        return 'set';
      }
      // (refused: water, a torch already there, a block; the torch given back)
      await a.world.rcon.give(a.name, 'torch', 1, before).catch(() => '');
      before += 1;
      return 'refused';
    };
    for (const q of inside ? [] : targets) {
      checkAbort(signal);
      if (before <= 0) break;
      const k = keyOf(q);
      const cell = blockName(a, q.x, q.y, q.z);
      if (cell === null) {
        skip(k, false);
        continue;
      }
      if (torch(q, cell)) {
        done.add(k);
        found++;
        continue;
      }
      const j = cell === 'air' || cell === 'cave_air' ? judge(q) : { block: null, loaded: true };
      if (!j.block) {
        skip(k, j.loaded);
        continue;
      }
      const r = await put(q.x, q.y, q.z, j.block);
      if (r === 'out') break;
      if (r === 'set') set.push({ q, block: j.block });
      else skip(k, true);
      await sleep(pace, signal);
    }
    // 4. Confirmed on the server a second later: passed is standing, failed is dropped (set once more while its support
    // still holds one, then never); no answer (a timeout, a chunk not loaded) is neither, left to the next run's view (a
    // lost answer counted as standing, and a timeout's retry refused by the torch there marked it never: B.4's review,
    // lens 1 L3)
    const there = async (x: number, y: number, z: number, block: string): Promise<boolean | null> => {
      for (let i = 0; i < 2; i++) {
        const r = await a.world.rcon.command(`execute if block ${x} ${y} ${z} minecraft:${block}`).catch(() => '');
        if (/passed/i.test(r)) return true;
        if (/failed/i.test(r)) return false;
      }
      return null;
    };
    // (a second placement is judged again first, in the view and its support on the server: a support changed, or never
    // what the view showed, left the torch floating and recorded done, lens 1 L1)
    const retry = async (q: LightPart['spots'][number]): Promise<(typeof set)[number] | null> => {
      const j = judge(q);
      if (!j.loaded) return null;
      const held = j.block && j.support && j.state ? await there(...j.support, j.state) : false;
      if (held === null) return null;
      if (!held || !j.block) {
        markNever(keyOf(q));
        return null;
      }
      const r = await put(q.x, q.y, q.z, j.block);
      if (r === 'set') return { q, block: j.block };
      // (refused: never, unless a torch stands there after all, which the next run's view finds; out: not the spot's fault)
      if (r === 'refused' && !torch(q, blockName(a, q.x, q.y, q.z))) markNever(keyOf(q));
      return null;
    };
    if (set.length) await sleep(1000, signal);
    const again: typeof set = [];
    for (const t of set) {
      const ok = await there(t.q.x, t.q.y, t.q.z, t.block);
      if (ok) {
        standing++;
        done.add(keyOf(t.q));
      } else if (ok === null) unconfirmed++;
      else {
        dropped++;
        const r = await retry(t.q);
        if (r) again.push(r);
      }
    }
    if (again.length) await sleep(1000, signal);
    for (const t of again) {
      const ok = await there(t.q.x, t.q.y, t.q.z, t.block);
      if (ok) {
        standing++;
        done.add(keyOf(t.q));
      } else if (ok === null) unconfirmed++;
      else {
        dropped++;
        markNever(keyOf(t.q));
      }
    }
    // 5. The record, then torches beyond what it carried at the start back by name (a building's deposit walks to the hut);
    // counted as carried until they are back (they were in neither storage nor the demand's offset, lens 2 L6), and what
    // does not go back is the sweep's to deposit (a failed deposit left them unrecorded, lens 1 M1)
    record();
    const now = await a.world.rcon.count(a.name, 'torch');
    const extra = Math.max(0, now - carried0);
    carry(extra);
    beforeBack = now;
    if (extra) await STORAGE_SKILLS.deposit.run(a, { item: 'torch', count: extra }, signal).catch((e: Error) => {
      if (e.message === 'cancelled' || unmoved(e)) throw e;
      console.log(`[light] ${a.name} could not put ${extra} torches back into storage: ${e.message.slice(0, 120)}`);
    });
    left = extra ? await a.world.rcon.count(a.name, 'torch') : now;
    back = Math.max(0, now - left);
    leave(left - carried0);
    uncarry();
    endLine();
    const lit = P.spots.filter((q) => done.has(keyOf(q))).length;
    // (nothing newly confirmed, found lit or marked never is no progress: the world backs the part off, or it was the fixed
    // pick again at once, forever; B.4's review, lens 2 M1; the note goes last, endChoice keys on it)
    const progress = standing + found + newNever > 0;
    const notes = [`${lit} of ${P.spots.length} lit`, ...(never.size ? [`${never.size} never`] : []), ...(skipped ? [`${skipped} skipped`] : []),
      ...(unconfirmed ? [`${unconfirmed} not confirmed`] : []), ...(inside ? ['none placed: the lighter stood inside'] : []), ...(back ? [`${back} torches put back`] : []),
      ...(progress ? [] : ['no progress'])];
    return `lit ${standing} torch spot${standing === 1 ? '' : 's'} in the ${P.label} (${notes.join('; ')})`;
  } catch (e) {
    const why = (e as Error).message;
    // What was set or found so far is recorded (the next run would find it and count it done anyway)
    if (standing || found || newNever || Object.keys(skips).length) record();
    if (counted) {
      const now = await a.world.rcon.count(a.name, 'torch').catch(() => null);
      if (now !== null) {
        left = now;
        // (a failure in the last deposit: what went back before it, lens 2 L9)
        if (beforeBack !== null) back = Math.max(0, beforeBack - now);
        // A stop, or a stall that did not move the bot (partsBack skips its deposits there, F146): what it carries beyond
        // the start is the sweep's to deposit (its own deposits would fail on the aborted signal or stall again; lens 1
        // M1); any other failure: partsBack puts the torches back
        if (why === 'cancelled' || signal.aborted || unmoved(e)) leave(now - carried0);
      }
      endLine();
    }
    throw e;
  } finally {
    holdsRelease(key, mine);
    uncarry();
  }
}

const box = (x: Record<string, unknown>) => ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].forEach((k) => num(x[k], k));

/**
 * A lamp or sign job that fails puts what it drew or made back into storage by name (S.4: they run while builds still draw,
 * and the next holder found storage short while the fences and signs sat with the last one, lesson 112). Not when stopped:
 * the task runner deposits them at a hand-back.
 */
const TAIL_PARTS = /_(fence|sign|planks|log)$|^(torch|stick|charcoal)$/;
const partsBack = (run: McSkill['run']): McSkill['run'] => async (a, args, signal) => {
  try {
    return await run(a, args, signal);
  } catch (e) {
    // (not after a stall that did not move the bot: each deposit's walk would stall there too and hold off the rescue, F146)
    if ((e as Error).message !== 'cancelled' && !signal.aborted && !unmoved(e))
      for (const n of new Set(a.bot.inventory.items().map((it) => it.name).filter((n) => TAIL_PARTS.test(n))))
        await STORAGE_SKILLS.deposit.run(a, { item: n }, signal).catch(() => undefined);
    throw e;
  }
};

export const BUILD_SKILLS: Record<string, McSkill> = {
  find_site: { run: findSite },
  prepare_site: { run: prepareSite },
  build_design: { check: (x) => (str(x.design, 'design'), num(x.x, 'x'), num(x.z, 'z')), run: buildDesign },
  build_box: { check: (x) => (box(x), str(x.block, 'block')), run: buildBox },
  build: { check: (x) => void str(x.structure, 'structure'), run: buildStructure },
  light_streets: { check: (x) => void num(x.layout, 'layout'), run: partsBack(lightStreets) },
  put_up_signs: {
    check: (x) => {
      num(x.layout, 'layout');
      if ((x.x === undefined) !== (x.z === undefined)) throw new Error('put_up_signs: give x and z together (the building build_design centres there), or neither for every sign');
      if (x.x !== undefined) {
        num(x.x, 'x');
        num(x.z, 'z');
      }
    },
    run: partsBack(putUpSigns),
  },
  tend_farm: { check: (x) => void num(x.layout, 'layout'), run: tendFarm },
  // (not in TOOLS: no model calls it; code queues it as a chore)
  harvest_farm: { check: (x) => void num(x.layout, 'layout'), run: harvestFarm },
  // (the farm slots', chores as well: opportunistic farming, 10-08)
  // (from=storage: no sighting, the kind's first plants from the village storage, s30's food step D4)
  start_farm: { check: (x) => (num(x.layout, 'layout'), num(x.slot, 'slot'), str(x.kind, 'kind'), x.from === 'storage' ? undefined : (num(x.x, 'x'), num(x.y, 'y'), num(x.z, 'z'))), run: startFarm },
  harvest_slot: { check: (x) => (num(x.layout, 'layout'), num(x.slot, 'slot')), run: harvestSlot },
  prepare_annex: { run: prepareAnnex },
  // (s30's, a chore as well: the next neighbourhood of a village that grows)
  lay_out_houses: { check: (x) => (x.options !== undefined ? void padOptions(x.options, 4) : void num(x.size, 'size')), run: layOutHouses },
  start_pen: { check: (x) => (num(x.layout, 'layout'), num(x.slot, 'slot'), num(x.x, 'x'), num(x.y, 'y'), num(x.z, 'z')), run: startPen },
  // (pens v2's, 10-09)
  collect_eggs: { check: (x) => (num(x.layout, 'layout'), num(x.slot, 'slot'), undefined), run: collectEggs },
  breed_pen: { check: (x) => (num(x.layout, 'layout'), num(x.slot, 'slot'), undefined), run: breedPen },
  milk_cows: { check: (x) => (num(x.layout, 'layout'), num(x.slot, 'slot'), undefined), run: milkCows },
  bake_cake: { run: bakeCake },
  // (s30's appetite: a meal from the village storage, a chore code queues for a peckish member, never a model's tool)
  eat_meal: { run: eatMeal },
  // (the iron age's, chores too, 10-08)
  dig_iron: { run: digIron },
  make_iron_tool: { check: (x) => void str(x.item, 'item'), run: makeIronTool },
  // (S.3's, not in TOOLS either: code-posted tasks name it, run as written; WorldAdapter.taskSkills)
  make_into_storage: { check: (x) => void str(x.item, 'item'), run: makeIntoStorage },
  // (S.5's, the same: the stations placed before the storage hut)
  place_station: { check: (x) => void stationArg(x.item), run: placeStationSkill },
  // (S.9's, chores: the workshop's make, the works plot and its furnaces)
  make: { check: (x) => (str(x.item, 'item'), num(x.count, 'count'), undefined), run: makeGoods },
  prepare_works: { run: prepareWorks },
  place_works_furnace: { check: (x) => void num(x.k, 'k'), run: placeWorksFurnace },
  // (B.4's, a chore too: torches from storage into a building or a part of the mine)
  put_up_torches: { check: (x) => (str(x.part, 'part'), num(x.count, 'count'), undefined), run: partsBack(putUpTorches) },
};

