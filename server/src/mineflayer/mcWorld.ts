/**
 * Real Minecraft as a world for agents (WorldAdapter): agents are Mineflayer bots on a Java server, and RCON does
 * what bots cannot do themselves (game modes, teleports). Villages are kept in their own registry next to the server's
 * world, since their coordinates belong to that world.
 */
import path from 'node:path';
import minecraftData from 'minecraft-data';
import { FARM_TRIP_RANGE, MINE_TASK, PARTS_MAKE, PICK_GATHER, PICK_SUPPLY, STATION_NAMES, VillageRegistry, WINDOWS, preparedAt, signTask, stationsOwed, villageHome, type Task, type Village } from '../village';
import { MINING_HUT, STORAGE_HUT } from '../huts';
import type { ActionStatus, ChoiceContext, ChoiceKind, ChoiceMenu, ChoiceMeta, ChoiceOption, ChoiceStatus, ChoiceSummary, ToolDef, WorldAdapter, WorldAgent } from '../world';
import { TOOLS } from '../skills';
import { BotAgent } from './botAgent';
import { MC_SKILLS } from './mcSkills';
import { Vec3 } from 'vec3';
import { collectFilter, collectTargets, exposed, villageStationCell } from './mcSurvival';
import { nearestBlocks, onVillageGround, stateAt } from './mcUtil';
import { annexBusy, biomeAt, cakeShort, harvesting, makeKeeps, seedsForFields, slotBusy, wheatKeep } from './mcBuild';
import { mineAreas, mineCanGive, mineCellsLeft, mineFaces, mineFacesGoing, mineGrowing, mineLights, nearMineFace, type MineLightSpot } from './mcMine';
import { EGGS, PEN_KINDS, PEN_ORDER, SLOT_KINDS, SLOT_ORDER, penPlan, worksFurnaces } from '../farmSlots';
import { FOOD_GOODS, GATHER_ALSO, GATHER_KINDS, GATHER_LOGS_HOUR, LIGHT_MIN_TRIP, LIGHT_TRIP, MAKE_GOODS, MAKE_KEEP, MAKE_NEVER, MAKE_PARALLEL, MINE_LIGHT_MIN, TORCH_DEMAND_CAP, TORCH_RESERVE, WORKS_FURNACES, FURNISH_TRIP, FURNISH_MIN_TRIP, decorCarried, holdKey, holdsDelete, holdsSet, holdsVersion, lightCarried, makeBill, makeHolds, makeLeft, worksBusy, type MakeGood, type Material } from './mcWorkshop';
import { hasteLevel, timeScale } from './mcRules';
import { choiceId, countsDelta, itemCounts, logChoice, logChoiceBan, logChoiceDrop, logChoiceEnd, type ChoiceDrop, type ChoiceLogOption } from './mcChoiceLog';
import { CHOOSE, ChoiceStats, ChooserQueue, DISLIKED, choose, choreProductive, fixedPick, fnv1a, shuffled, trimMenu } from '../choose';
import { workerNumber } from '../agentNames';
import { KIND_PHRASE, TEMPERAMENT_MODE, kindWeights, optionWeight, personaOf, temperament } from '../temperament';
import { BALLOTS_PARALLEL, STYLE_LOOK, VOTE_MAX_MS, VOTE_SETTING, castAll, predictedBallot, predictedChoice, styleOption, tally, type Ballot, type BallotRequest, type StyleHouse, type VoteMode, type VoteOption, type VoteRecord, type VoteTopic } from '../vote';
import { label, parseSpec, type ModelSpec } from '../modelCall';
import { TieredBrain } from '../tieredBrain';
import { REASONING, isCloudModel, usage } from '../modelUsage';
import { LLMBrain } from '../llmBrain';
import { TaskBrain } from '../taskBrain';
import type { AgentBrain } from '../world';
import type { Area, Design, Initiative, Structure } from '../village';
import { Materials, designBill, designBlockList, gatherNames, gatherTasks, hardToGather, inWood, type Counts, type MaterialPlan } from './mcMaterials';
import { PART_RE, storageContents, storageSlots } from './mcStorage';
import type { WorldRulesStatus } from './mcRules';
import type { Rcon } from './rcon';
import { Atlas } from './mcAtlas';
import { VILLAGE_BIOMES, listPieces, pieceToDesign, readPiece, vanillaLibrary, vanillaLights, villageBiome } from '../vanillaPieces';
import { buildingDecor, buildingLights, placedDoor, signLabel, type DecorSpot, type LightSpot, type SignPlace } from '../streetPlan';
import { buildCatalog, type ActivitySpec } from '../activities';
import { SMALL_WORKS, smallWorkSpots, type SmallWorkKind } from '../smallWorks';
import { signpostText } from '../placeNames';
import { LOW, NEED_TRAIT, needWeight, readNeeds, stepNeed, type NeedKind, type NeedReading } from '../needs';
import { UtilClock, type UtilView } from '../utilisation';
import { FARMSTEAD_ON, NEED_WORKS, addFlow, addMineFlow, farmsteadDue, fieldDue, foodTarget, foodflowReading, madePoints, mineflowReading, stepShort, storedPoints } from '../needWorks';
import { vanillaJar } from '../vanillaData';
import { HOUSE_UNITS, LANDMARK_UNITS, MAX_SMELTS, isLandmark, validateDesign } from '../designs';
import { GROW, GROW_FARMS, HOUSING, NO_FIELD_BIOME, growing, housesOf, isDwelling, isGrowTask, padFor, padLadder, pickHouses, taskNum } from '../grow';
import { APPETITE, FOOD_POINTS, appetiteOn, chooseMeal, drain, foodPoints, foodText, holdMeal, isFoodKind, isFoodTask, releaseMeal, stateOf, storeForMeals, type Appetite } from '../appetite';

/** Brains that only use the world interface (the scripted ones in brains.ts are sandbox-only). */
export const MC_BRAINS: Record<string, () => AgentBrain> = {
  idle: () => ({ name: 'idle' }),
  tiered: () => new TieredBrain(),
  llm: () => new LLMBrain(),
  // Scripted village worker (tests): runs the skill calls each task spells out
  tasks: () => new TaskBrain(),
};

export interface SpawnOptions {
  role?: string;
  brain?: string | null;
  gamemode?: string;
  position?: { x: number; y?: number; z: number };
  memory?: Record<string, unknown>;
  /** Start afresh: empty inventory, full health and food, at the world spawn (a name keeps its player data otherwise). */
  reset?: boolean;
}

/**
 * A chore's place in the decision log (A.1): its choice id and start, the storage and the agent's inventory then (for the
 * yield at its end), and the village's chores that overlapped it.
 */
type ChoiceState = {
  id: string; t: number; ended?: boolean; store: Counts; carried: Counts; with: Set<string>;
  /** A.2: when it ended (heldKeys' async hold), its decision, the further keys it holds, what it was (kind, option id and
   *  name), and for an explore its ring point with how much of its land the atlas knew at the start. */
  endedAt?: number; decisionId?: string; holds: string[]; kind?: ChoiceKind; option?: string; name?: string;
  point?: { x: number; z: number; known0: number };
  /** S.9: a make's good, batch and furnace (k; none: crafted), netted out of its deficit while it goes; a gathering's
   *  material and trip (`n`: the amount, counted as incoming until the chore ends). */
  make?: { item: string; count: number; smelts: boolean; k?: number };
  gather?: { material: Material; n: number };
  /** s36: an initiative's gathering trip (its own field: the workshop's demand must not count it as incoming). */
  initiative?: { id: string; material: Material; n: number };
  /** S.9: a works furnace placement's k (its 8 cobblestone earmarked, so gathering's demand leaves it out). */
  furnace?: number;
  /** B.4: a light chore's part and its torches. */
  light?: { part: string; n: number };
  /** X.1: a furnish chore's part and its spots. */
  furnish?: { part: string; n: number };
};

/**
 * A part the village lights (B.4): a building (a structure with its design and a done Build task) or a piece of the mine
 * ("mine:stairs", "mine:<leg>", "mine:down:<k>", "mine:iron"), its torch spots in the world, how many are unlit (not done,
 * not never; in the mine not within 2 cells of a face still going), whether it still grows (the mine) and, for a building,
 * the walk from the storage hut to its door (blocks).
 */
export type LightPart = {
  part: string; label: string; kind: 'building' | 'mine'; structure?: Structure; place?: SignPlace;
  spots: Array<{ x: number; y: number; z: number; block: 'wall_torch' | 'torch'; facing?: string; sides?: MineLightSpot['sides']; src?: 'vanilla' | 'code' }>;
  unlit: number; growing: boolean; walk?: number;
};

/**
 * A building the village furnishes (X.1): its furniture spots in the world (buildingDecor's, inside the structure's box,
 * `y` the cell's), the open ones (not done, not never), and lighting's label, place and walk from the storage hut.
 */
export type DecorPart = {
  part: string; label: string; structure: Structure; place: SignPlace; walk?: number;
  spots: Array<DecorSpot & { y: number }>; open: Array<DecorSpot & { y: number }>;
};

/** Vanilla's facade torches lit too (D4: vanilla's own look); off, only the spots inside. */
const LIGHT_FACADES = process.env.MC_LIGHT_FACADES !== '0';

/** One good's plan for the workshop now (makePlan): the batch it makes, or why none. */
type MakePlan = { count: number; bill: Counts; inputs: Counts; smelts: boolean; craft?: { item: string; count: number; wood: string } } | { why: string };
/** Gathering's demand per material (gatherWanted). */
type GatherWanted = Record<Material, { need: number; incoming: number; want: number; for: string[] }>;
/** Gathering's materials in their table order (ties of the menu's order). */
const MATERIALS: Material[] = ['sand', 'logs', 'cobblestone'];
/** The smallest trip a further gatherer is sent for while some of the material is already on the way (no walk for one
 *  log; with nothing incoming any want goes, so the last few still come). */
const GATHER_MIN_TRIP: Record<Material, number> = { logs: 6, sand: 8, cobblestone: 8 };
/** A gathering that found none of its material backs it off this long; a second such answer counts toward "unavailable"
 *  only this long after the first (S.9's review, lens 4 M2). */
const GATHER_NONE_BACK = 30 * 60000;
const GATHER_NONE_APART = 10 * 60000;

/** Stone pickaxes the supply makes into storage (S.1; S.8 raises it to 8). */
const PICK_BATCH = 4;
/** Members from which a village gets the pickaxe supply whatever its workers are doing, and miners keep off the reserve. */
const SUPPLY_MEMBERS = 5;
/** How far a chat line is heard (E.0; the chat skill says the same), and the window of the wake caps per pair. */
const HEAR_RANGE = 48;
const PAIR_WINDOW_MS = 5 * 60000;

/** What an agent carries as Mineflayer sees it (no server command: measurement only); null if it cannot be read. */
function heldCounts(a: BotAgent): Counts | null {
  try {
    return itemCounts(a.bot.inventory.items());
  } catch {
    return null;
  }
}

export class MineflayerWorld implements WorldAdapter {
  readonly kind = 'minecraft' as const;
  readonly villages: VillageRegistry;
  /** The skills implemented so far (mcSkills.ts), with the shared tool definitions. */
  readonly skills: ToolDef[] = TOOLS.filter((t) => t.name in MC_SKILLS);
  /** Skills only code-posted tasks name (S.3), kept out of the models' tools (a longer prompt each, lesson 32). */
  readonly taskSkills = ['make_into_storage', 'place_station'];
  /** What a handed-back task's holder may carry for it (F228): a village part's batch, or a gather task's material. */
  taskLeftovers(detail: string): string[] {
    const make = /\bmake_into_storage item=(\S+)/.exec(detail)?.[1];
    if (make) return makeKeeps(make.replace(/[,.;]+$/, ''));
    const block = /\bcollect block=(\S+)/.exec(detail)?.[1]?.replace(/[,.;]+$/, '');
    return block ? [block] : [];
  }
  readonly registry: ReturnType<typeof minecraftData>;
  /** Bills of materials and recipe chains (mcMaterials.ts). */
  readonly materials: Materials;
  agents = new Map<string, BotAgent>();
  ticks = 0;
  /** Peaceful and no-damage settings (mcRules.ts), applied when the agent server starts. */
  worldRules: WorldRulesStatus | null = null;
  /** What the bots have seen, one summary per chunk, shared by every agent (mcAtlas.ts). */
  readonly atlas: Atlas;

  constructor(readonly host: string, readonly port: number, readonly version: string, readonly rcon: Rcon, dataDir: string) {
    this.registry = minecraftData(version);
    this.materials = new Materials(this.registry);
    this.villages = VillageRegistry.forWorld(dataDir);
    this.villages.refreshNeeds = (v) => this.refreshNeeds(v);
    this.villages.onClaim = (v, t) => this.claimed(v, t);
    this.villages.claimLimit = (v, t, _by, cooled) => this.mineClaim(v, t, cooled);
    this.atlas = new Atlas(this.registry, path.join(dataDir, 'atlas.json'), (cx, cz) => {
      for (const a of this.agents.values()) {
        const column = (a.bot.world as unknown as { getColumn(x: number, z: number): unknown }).getColumn(cx, cz);
        if (column) return { by: a.name, column: column as Parameters<Atlas['summarise']>[0] };
      }
      return null;
    });
  }

  /**
   * How many blocks collect would gather for each name lie near x,y,z, up to the number wanted (plan_layout's check),
   * outside `skip` (the farm's grass check: prepare_site cuts the plot's own plants).
   */
  materialsNear(by: string, want: Record<string, number>, x: number, y: number, z: number, range: number, skip?: { x1: number; z1: number; x2: number; z2: number }) {
    const a = this.agents.get(by.toLowerCase());
    if (!a) return null;
    const out: Record<string, number> = {};
    for (const [n, count] of Object.entries(want)) {
      try {
        // What collect can get: near the surface (wood 36 blocks down in a mineshaft could not be reached), anything
        // close to the site, and farther out only blocks in the open (Accept12: sandstone buried under sand 50-90 blocks
        // away counted, and gatherers found "none within 96 blocks"); only as many as wanted
        const off = (p: Vec3) => !skip || p.x < skip.x1 || p.x > skip.x2 || p.z < skip.z1 || p.z > skip.z2;
        const keep = (p: Vec3) => { const d = Math.hypot(p.x - x, p.z - z); return p.y >= y - 16 && d <= range && off(p) && (d <= 40 || exposed(a, p)); };
        out[n] = nearestBlocks(a, collectTargets(a, n).blocks, 128, Math.max(1, Math.ceil(count)), keep, { min: y - 16 }).length;
      } catch {
        // An unknown name: not this check's business
      }
    }
    return out;
  }

  /**
   * Scouting (step 2.4): eight points on a ring of 160 blocks around home (a bot sees ~128 blocks, so the ring's
   * walkers bring in the land out to ~256), those whose surroundings the atlas mostly does not know yet, in order
   * around the ring. On land the atlas knows already, none: find_site reads it as it is.
   */
  scoutPoints(home: { x: number; z: number }) {
    const out: Array<{ x: number; z: number }> = [];
    for (let k = 0; k < 8; k++) {
      const t = (k * Math.PI) / 4;
      const x = Math.round(home.x + 160 * Math.cos(t)), z = Math.round(home.z + 160 * Math.sin(t));
      if (this.atlas.known(x, z, 64) < 0.5) out.push({ x, z });
    }
    return out;
  }

  /** The first vote's style (spec_vote1 1): a biome's accepted small houses, each with its bill's units, size and gathering. */
  styleHouses(biome: string): Array<StyleHouse & { design: Design }> {
    const lib = this.vanillaLibrary(biome)?.houses ?? [];
    return lib.filter((d) => /_small_house_\d+$/.test(d.name)).map((d) => {
      const m = this.materialTasks(d, d.name);
      const gather: Record<string, number> = {};
      for (const t of m.tasks ?? []) {
        const g = /^Gather (\d+) (\w+)/.exec(t.title);
        if (g) gather[g[2]] = (gather[g[2]] ?? 0) + Number(g[1]);
      }
      return { name: d.name, units: m.units ?? 0, volume: d.width * d.depth * d.height, gather, design: d };
    });
  }

  /**
   * Vanilla's pieces for a biome (V2.3), each passing the checks the architect's survival designs pass (valid with block
   * states, obtainable and easy materials, the budget, the furnace runs). Null when the jar cannot be read.
   */
  vanillaLibrary(biome: string) {
    const accept = (d: Design, centre: boolean) => {
      if (!validateDesign({ ...d } as unknown as Record<string, unknown>, 'vanilla', { isPlaceable: (b) => this.isPlaceable(b), states: true, requireDoor: !centre }).design) return false;
      const m = this.materialTasks(d, d.name);
      return !m.problems.length && (m.units ?? 0) <= (isLandmark(d.name) ? LANDMARK_UNITS : HOUSE_UNITS) && (m.smelts ?? 0) <= MAX_SMELTS;
    };
    try {
      return vanillaLibrary(villageBiome(biome), accept, vanillaJar());
    } catch (e) {
      console.warn(`[vanilla] cannot read the village pieces: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Gather tasks for building a design in survival: its raw materials (from the bill of materials and the recipe
   * chain, with a furnace and fuel when something must be smelted), in chunks two workers can share. Builders craft
   * and smelt the rest from the village storage themselves (build_design does it).
   */
  materialTasks(d: Design, label: string, wood?: string, stations = true, without: string[] = [], extra: Counts = {}) {
    // In the village's wood kind: its logs are what gets gathered (less the parts billed for the village once: S.3's windows)
    const own = designBill(d);
    for (const n of without) delete own[n];
    const bill = inWood(own, wood);
    let plan = this.materials.plan(bill);
    // A crafting table for the doors and the like, and a furnace when something must be smelted (not for a building
    // built after the storage hut, `stations` false: it uses the hut's, and each house billed 8 cobblestone and a log
    // for its own, the opportunities analysis #5)
    if (stations) plan = this.materials.plan({ ...bill, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
    // Blocks that need iron ore, leather, clay or wool are too slow to gather for a village: a design using them is
    // sent back (a lantern meant mining raw iron with a stone pickaxe)
    const hard = hardToGather(plan.gather);
    const problems = [...plan.problems, ...(hard.length ? [`it needs ${hard.join(', ')}, which takes finding (drop the blocks made from it, e.g. mossy cobblestone, lanterns, bricks, wool, bookshelves; planks, logs, cobblestone and glass are gathered easily)`] : [])];
    // One log spare (a plank batch per wooden part rounds up; one kind, so no more than that)
    plan.gather['any:logs'] = (plan.gather['any:logs'] ?? 0) + (wood ? 1 : 2);
    // (and what the caller adds: the pooled windows' fuel on the first building with windows, S.3's review)
    for (const [n, q] of Object.entries(extra)) if (q > 0) plan.gather[n] = (plan.gather[n] ?? 0) + q;
    const logs = Object.entries(plan.gather).filter(([n]) => /_log$|^any:logs$/.test(n)).reduce((s, [, q]) => s + q, 0);
    const units = Object.values(plan.gather).reduce((s, q) => s + q, 0);
    return { tasks: gatherTasks(plan.gather, label, wood), problems, logs, units, smelts: plan.fuel.smelts };
  }

  /**
   * The windows billed once for the village (S.3): each building's glass and panes summed over every placed copy and
   * planned together (14 panes are 6 glass from 6 sand, where three buildings billed alone gather 18), with gather tasks
   * for the sand only. The fuel's logs (`logs`) go on the first building with windows' own log gathering (a log task "for
   * the windows" would never be closed as covered; billed nowhere, the smelting burned logs gathered for later houses,
   * S.3's review).
   */
  sharedParts(designs: Design[], wood?: string) {
    const parts = (d: Design) => { const b = designBill(d); return { glass_pane: b.glass_pane ?? 0, glass: b.glass ?? 0 }; };
    const sandOf = (c: Counts) => Object.entries(this.materials.plan(c).gather).filter(([n]) => /^(red_)?sand$/.test(n)).reduce((s, [, q]) => s + q, 0);
    const bill = { glass_pane: 0, glass: 0 };
    let separate = 0, copies = 0;
    const withWindows = new Set<string>();
    for (const d of designs) {
      const p = parts(d);
      if (!p.glass_pane && !p.glass) continue;
      bill.glass_pane += p.glass_pane;
      bill.glass += p.glass;
      separate += sandOf(Object.fromEntries(Object.entries(p).filter(([, q]) => q > 0)));
      copies++;
      withWindows.add(d.name);
    }
    if (!copies) return null;
    const pooled: Counts = Object.fromEntries(Object.entries(bill).filter(([, q]) => q > 0));
    const all = this.materials.plan(pooled).gather;
    const gather = Object.fromEntries(Object.entries(all).filter(([n]) => /^(red_)?sand$/.test(n)));
    const sand = Object.values(gather).reduce((s, q) => s + q, 0);
    const logs = Object.entries(all).filter(([n]) => /_log$|^any:logs$/.test(n)).reduce((s, [, q]) => s + q, 0);
    return { panes: bill.glass_pane, glass: bill.glass, sand, logs, separate, with: [...withWindows], copies, tasks: gatherTasks(gather, WINDOWS, wood) };
  }

  /**
   * How many of a part the village still wants made into storage (S.3's make_into_storage), and for how many buildings or
   * lamp jobs: glass and panes for every build not claimed yet or claimed with its stock not drawn, less what those
   * builders carry; torches for the unlit lamps whose job is open or under way, less what its holder carries.
   */
  partsWanted(v: Village, item: string): { want: number; buildings: number } {
    const carries = (name?: string) => (name ? heldCounts(this.agents.get(name.toLowerCase())!)?.[item] ?? 0 : 0);
    let want = 0, buildings = 0;
    if (item === 'torch') {
      (v.layouts ?? []).forEach((l, i) => {
        const t = v.tasks.find((x) => (x.status === 'open' || x.status === 'claimed') && x.detail.startsWith(`light_streets layout=${i + 1} `));
        if (!l.lamps?.length || l.lit || !t) return;
        want += Math.max(0, l.lamps.length - (t.status === 'claimed' && this.agents.has(t.claimedBy?.toLowerCase() ?? '') ? carries(t.claimedBy) : 0));
        buildings++;
      });
      return { want, buildings };
    }
    for (const t of v.tasks) {
      if (!/^Build /.test(t.title) || !(t.status === 'open' || (t.status === 'claimed' && this.drawn.get(`${v.name}:${t.id}`) !== t.claimedBy))) continue;
      const d = v.designs[/build_design "([^"]+)"/.exec(t.detail)?.[1] ?? ''];
      const n = d ? designBill(d)[item] ?? 0 : 0;
      if (!n) continue;
      const builder = t.status === 'claimed' && this.agents.has(t.claimedBy?.toLowerCase() ?? '') ? t.claimedBy : undefined;
      want += Math.max(0, n - carries(builder));
      buildings++;
    }
    return { want, buildings };
  }

  private needsAt = new Map<string, number>();

  /**
   * The one wood kind a village's numbers are in: its own, else the commonest in storage, and then any logs and planks
   * count as it (birch deposits never lowered an oak need). For refreshNeeds and the storage reserve alike.
   */
  private woodOf(v: Village, store: Counts): string {
    const logKinds = Object.entries(store).filter(([n]) => /_log$/.test(n)).sort((x, y) => y[1] - x[1]);
    return v.wood ?? logKinds[0]?.[0].replace(/_log$/, '') ?? 'oak';
  }

  /** One Build task's bill, in its own wood kind when it has one (F164's whole buildings, as the cover rule counts them). */
  private buildBill(v: Village, t: { title: string; detail: string }, wood: string): Counts | null {
    const d = v.designs[/build_design "([^"]+)"/.exec(t.detail)?.[1] ?? ''];
    if (!d) return null;
    const bill = inWood(designBill(d), (v.wood && v.woodFor?.[t.title.slice(6)]) || wood);
    // The storage hut's table and furnace (S.5): billed to their own task while it is open or held (stationsBill), and to
    // no one once they stand; only a hut whose stations task is over without them (the fallback) bills them itself
    if (d.name === STORAGE_HUT) for (const n of STATION_NAMES) if (v.stations?.[n] || stationsOwed(v).includes(n)) delete bill[n];
    return bill;
  }

  /** The stations their own task still owes (S.5), as a bill: a table (a log) and a furnace (8 cobblestone). */
  private stationsBill(v: Village): Counts {
    return Object.fromEntries(stationsOwed(v).map((n) => [n, 1]));
  }

  /** The bill of every laid-out building not claimed yet (open), each in its own wood kind, and their labels. */
  private openBill(v: Village, wood: string): { bill: Counts; unbuilt: string[] } {
    const bill: Counts = {};
    const unbuilt: string[] = [];
    for (const t of v.tasks) {
      if (!/^Build /.test(t.title) || t.status !== 'open') continue;
      const b = this.buildBill(v, t, wood);
      if (!b) continue;
      unbuilt.push(t.title.slice(6));
      for (const [n, q] of Object.entries(b)) bill[n] = (bill[n] ?? 0) + q;
    }
    return { bill, unbuilt };
  }

  /**
   * Claimed builds whose builder has taken everything it needs from storage (runJob's withdrawals and makeFromStock), by
   * village and task id, to the builder (S.1). A claim clears it (`onClaim`); not kept over a restart (reserved again).
   */
  private drawn = new Map<string, string>();

  /** A claimed build's materials are all in its builder's hands: the storage reserve leaves it out from now on. */
  markDrawn(v: Village, id: string, by: string) {
    this.drawn.set(`${v.name}:${id}`, by);
  }

  /**
   * When the pickaxe supply was claimed: its maker's cobblestone and stone pickaxes (3 each), and the storage's stone
   * pickaxes (3 each), by village and id.
   */
  private supplyStart = new Map<string, { by: string; held: number; stored: number }>();

  private stoneHeld(a: BotAgent): number {
    return a.bot.inventory.items().reduce((s, it) => s + (it.name === 'cobblestone' ? it.count : it.name === 'stone_pickaxe' ? 3 * it.count : 0), 0);
  }

  private claimed(v: Village, t: Task) {
    const key = `${v.name}:${t.id}`;
    this.drawn.delete(key);
    const maker = PICK_SUPPLY.test(t.title) ? this.agents.get(t.claimedBy?.toLowerCase() ?? '') : undefined;
    if (maker) this.supplyStart.set(key, { by: maker.name, held: this.stoneHeld(maker), stored: 3 * (storageContents(v).stone_pickaxe ?? 0) });
    // A worker back at the mine within its busy cooldown (S.2): a face came free (said before the claim ends the cooldown,
    // and to the agent, for the stage script's count of hand-backs)
    const cooled = t.claimedBy && MINE_TASK.test(t.detail) ? this.villages.cooledAt(v, t.claimedBy) : undefined;
    if (cooled !== undefined) {
      const f = this.faces(v);
      const said = `${t.id} ${Math.round((Date.now() - cooled) / 1000)} s into its busy cooldown: a face is free (faces ${f.faces}, held ${f.held})`;
      console.log(`[mine] ${t.claimedBy} claims ${said}`);
      this.agents.get(t.claimedBy!.toLowerCase())?.pushEvent('system', `Claims ${said}`);
    }
  }

  /** The mine's faces by village, kept 250 ms (the claim gate asks on every claimable call: ~220 a second with 11 idle workers). */
  private facesAt = new Map<string, { at: number; f: ReturnType<typeof mineFaces> }>();
  private faces(v: Village) {
    const now = Date.now(), c = this.facesAt.get(v.name);
    if (c && now - c.at < 250) return c.f;
    const f = mineFaces(v, (n) => this.agents.has(n.toLowerCase()));
    this.facesAt.set(v.name, { at: now, f });
    return f;
  }
  /** Villages whose claim gate was shut when last asked (said once a change). */
  private gateShut = new Set<string>();

  /**
   * The claim gate (S.2): no more mine tasks held than the mine has faces, plus two to be on their way; one always allowed
   * when none is held (a face count gone wrong can never shut the mine). A worker that handed a mine task back as busy
   * (`cooled`) takes the next only once a face is free. Other tasks, and a village whose mine cannot give, go through.
   * Only claims by agents in the world count, as in mineFaces (a removed agent's claims stay on the board).
   */
  private mineClaim(v: Village, t: Task, cooled?: number): boolean {
    if (!MINE_TASK.test(t.detail) || !mineCanGive(v, 'cobblestone')) return true;
    const f = this.faces(v);
    const held = v.tasks.filter((x) => x.status === 'claimed' && MINE_TASK.test(x.detail) && this.agents.has((x.claimedBy ?? '').toLowerCase())).length;
    if (held > 0 && cooled !== undefined && f.free === 0) return false;
    const open = held === 0 || held < f.faces + 2;
    if (open === this.gateShut.has(v.name)) {
      if (open) this.gateShut.delete(v.name);
      else this.gateShut.add(v.name);
      console.log(`[mine] claim gate ${open ? 'open' : 'shut'} in ${v.name}: ${held} cobblestone tasks held, ${f.faces} faces (+2)`);
    }
    return open;
  }

  /**
   * What of the storage is spoken for (S.1), by item (logs by kind, "any logs" in the village's): the raw materials of
   * every building not claimed yet, beyond the made things the storage already holds (planks, a furnace); of every
   * claimed build whose builder has not drawn its stock yet, beyond what that builder carries (runJob walks to the site,
   * withdraws, and makes the furnace from storage cobblestone only after that: Van12a's storage hut was short exactly its
   * furnace after miners took the cobblestone for pickaxes); the pickaxe supply's cobblestone; and the lamps' and signs'
   * logs (S.4). A build that comes up
   * short goes back to open (requeueBuild) and is counted again.
   */
  /**
   * Leftover building parts in storage nobody counts on (s37 S5, MC_PARTS): each part (mcStorage PART_RE) less what the
   * bills of Build tasks not done or failed and of open initiatives name of it (storageReserve lists raw materials only, and
   * build_design fetches exact-name parts from storage). What fuel may burn.
   */
  partsSpare(v: Village): Counts {
    const store = storageContents(v);
    const out: Counts = {};
    for (const [n, q] of Object.entries(store)) if (q > 0 && PART_RE.test(n)) out[n] = q;
    if (!Object.keys(out).length) return out;
    const take = (bill: Counts) => {
      for (const [n, q] of Object.entries(bill)) if (out[n]) out[n] = Math.max(0, out[n] - q);
    };
    for (const t of v.tasks) {
      if (!/^Build /.test(t.title) || t.status === 'done' || t.status === 'failed') continue;
      const d = v.designs[/build_design "([^"]+)"/.exec(t.detail)?.[1] ?? ''];
      // (in the wood it is built in, as buildBill: the parts' report)
      if (d) take(v.wood ? inWood(designBill(d), v.woodFor?.[t.title.slice(6)] ?? v.wood) : designBill(d));
    }
    const wood = v.catalogWood ?? v.wood ?? 'oak';
    for (const it of v.initiatives ?? []) {
      const d = it.state === 'open' ? v.designs[it.design] : undefined;
      if (d) take(inWood(designBill(d), wood));
    }
    for (const n of Object.keys(out)) if (!out[n]) delete out[n];
    return out;
  }

  storageReserve(v: Village): Counts {
    const store = storageContents(v);
    const wood = this.woodOf(v, store);
    const out: Counts = {};
    const add = (gather: Counts) => {
      for (const [n, q] of Object.entries(gather)) {
        const k = n === 'any:logs' ? `${wood}_log` : n.replace(/^any:/, '');
        out[k] = (out[k] ?? 0) + q;
      }
    };
    const { bill } = this.openBill(v, wood);
    // (and the stations their own task owes, S.5: the furnace's 8 cobblestone kept from the miners' pickaxes)
    for (const [n, q] of Object.entries(this.stationsBill(v))) bill[n] = (bill[n] ?? 0) + q;
    if (Object.keys(bill).length) {
      const raw = new Set(Object.keys(this.materials.plan(bill, {}).gather).map((n) => n.replace(/^any:/, '')));
      const made: Counts = {};
      for (const [n, q] of Object.entries(store)) if (!raw.has(n) && !/_log$/.test(n)) made[n] = q;
      add(this.materials.plan(bill, made).gather);
    }
    for (const t of v.tasks) {
      if (!/^Build /.test(t.title) || t.status !== 'claimed' || this.drawn.get(`${v.name}:${t.id}`) === t.claimedBy) continue;
      const b = this.buildBill(v, t, wood);
      if (!b) continue;
      const builder = this.agents.get(t.claimedBy?.toLowerCase() ?? '');
      add(this.materials.plan(b, (builder && heldCounts(builder)) ?? {}).gather);
    }
    // The street lamps' and name signs' logs (S.4: they now run while miners make pickaxes from spare logs), as the cover
    // rule counts them (a log a lamp, in a desert two sandstone a lamp in batches of 4 and a log for two lamps' torches; 2
    // a sign job less the stored signs), while open or held and not drawn yet
    const waiting = (t?: Task) => !!t && (t.status === 'open' || (t.status === 'claimed' && this.drawn.get(`${v.name}:${t.id}`) !== t.claimedBy));
    let lamps = 0, signs = 0;
    (v.layouts ?? []).forEach((l, i) => {
      if (l.lamps?.length && !l.lit && waiting(v.tasks.find((t) => t.detail.startsWith(`light_streets layout=${i + 1} `)))) lamps += l.lamps.length;
      if (!l.signed) signs += (l.signs ?? []).filter((s) => !s.up && !s.never && waiting(signTask(v, i + 1, s))).length;
    });
    const desert = v.vanillaBiome === 'desert';
    if (desert && lamps) out.sandstone = (out.sandstone ?? 0) + Math.ceil((2 * lamps) / 4) * 4;
    const stored = Object.entries(store).filter(([n]) => /_sign$/.test(n)).reduce((s, [, q]) => s + q, 0);
    const tail = (desert ? Math.ceil(lamps / 2) : lamps) + 2 * Math.max(0, signs - stored);
    if (tail) out[`${wood}_log`] = (out[`${wood}_log`] ?? 0) + tail;
    const draw = this.supplyDraw(v);
    if (draw) out.cobblestone = (out.cobblestone ?? 0) + draw;
    return out;
  }

  /** How much of an item in storage is spoken for (`storageReserve`); "logs": every kind together. */
  reservedInStorage(v: Village, item: string): number {
    const r = this.storageReserve(v);
    return item === 'logs' ? Object.entries(r).filter(([k]) => /_log$/.test(k)).reduce((s, [, q]) => s + q, 0) : r[item] ?? 0;
  }

  // ---- S.9: the workshop's numbers (pure; the menu, the make skill and the offline checks read them) --------------------

  /**
   * The logs the workshop leaves in storage (spec 4.5): a pen ring's 10 for each annex pen slot with no pen built yet, and
   * 4 for a new storage chest's and a hoe made on the spot (a ring is charged from storage through runJob, the check's M6).
   */
  logsKeep(v: Village): number {
    // (an annex not yet prepared has no slots recorded: its two count, or makes took the logs down to 4 while it was
    // prepared, S.9's review, lens 4 L2)
    const lay0 = v.layouts?.[0];
    const slots = lay0?.annex?.state === 'ready' || (lay0?.slots ?? []).some((s) => s.annex) ? (lay0?.slots ?? []).filter((s) => s.annex && !s.pen?.built).length : 2;
    return Math.min(24, MAKE_KEEP.logsBase + MAKE_KEEP.logsPerPen * slots);
  }

  /**
   * What of the storage a make may take (spec 4.5): the storage less the reserve (after completion ~nothing), the keeps
   * (cobblestone 14, coal 2, logsKeep in the village's kind, else from the most stocked kinds) and what other agents' queued
   * makes and furnace placements have earmarked (D6; `agent`'s own is its to withdraw); nothing of MAKE_NEVER or `except`
   * (the good's own item: a batch is never made from its own stock). A food good's `allow` (s30) lets those through, less
   * their keeps (`foodKeep`).
   */
  makeSpare(v: Village, agent: string, except?: string, store: Counts = storageContents(v), allow?: string[]): Counts {
    const reserve = this.storageReserve(v);
    const own = agent ? holdKey(v.name, agent) : '';
    const held: Counts = {};
    for (const [k, c] of makeHolds) if (k.startsWith(`${v.name}|`) && k !== own) for (const [n, q] of Object.entries(c)) held[n] = (held[n] ?? 0) + q;
    const out: Counts = {};
    for (const [n, q] of Object.entries(store)) {
      const allowed = !!allow?.includes(n);
      if ((MAKE_NEVER.has(n) && !allowed) || n === except) continue;
      const keep = n === 'cobblestone' ? MAKE_KEEP.cobblestone : n === 'coal' ? MAKE_KEEP.coal : allowed ? this.foodKeep(v, n, store) : 0;
      const s = q - (reserve[n] ?? 0) - keep - (held[n] ?? 0);
      if (s > 0) out[n] = s;
    }
    let keep = this.logsKeep(v);
    const kinds = v.wood ? [`${v.wood}_log`] : Object.keys(out).filter((n) => /_log$/.test(n)).sort((x, y) => out[y] - out[x]);
    for (const k of kinds) {
      const t = Math.min(out[k] ?? 0, keep);
      keep -= t;
      if (t && !(out[k] -= t)) delete out[k];
    }
    return out;
  }

  /**
   * What storage keeps of a food good's inputs (s30's food step, spec 5): wheat for the cake and a cow breeding (wheatKeep),
   * an egg for the cake when no other kind is stored, the cake's 2 sugar cane (and sugar while the cane is short), 2
   * pumpkins while a farm slot is free (a start from storage takes them, the check's L6).
   */
  private foodKeep(v: Village, item: string, store: Counts): number {
    if (item === 'wheat') return wheatKeep(v);
    if (item === 'egg') return (store.brown_egg ?? 0) + (store.blue_egg ?? 0) > 0 ? 0 : 1;
    if (item === 'sugar_cane') return 2;
    if (item === 'sugar') return Math.max(0, 2 - (store.sugar_cane ?? 0));
    if (item === 'pumpkin') return (v.layouts ?? []).some((l) => (l.slots ?? []).some((q) => !q.annex && !q.kind)) ? 2 : 0;
    return 0;
  }

  /** The workshop's goods in a village: the food goods too where it keeps an appetite (s30); with X.1's catalog family
   *  on, the catalogue's (keeps first, then the recipe graph's goods in the village's pinned wood and what its furniture
   *  wants), as the catalogue's specs give them. */
  goodsFor(v: Village): MakeGood[] {
    const base = appetiteOn(v) ? [...MAKE_GOODS, ...FOOD_GOODS] : MAKE_GOODS;
    if (!CHOOSE.families.has('catalog')) return base;
    const c = this.catalog(v);
    return c ? c.goods.filter((g) => !g.food || appetiteOn(v)) : base;
  }

  /** The catalogue's cache, by village: the key it was built on (wood and the furniture's demand). */
  private catalogCache = new Map<string, { key: string; goods: MakeGood[]; specs: Map<string, ActivitySpec> }>();
  private catalogFailed = new Set<string>();

  /** The wood kind the catalogue makes wood goods in: pinned on the village by the sweep (catalogWood), else as it would be. */
  catalogWoodOf(v: Village): string {
    return v.catalogWood ?? v.wood ?? this.woodOf(v, storageContents(v));
  }

  /**
   * X.1's catalogue for a village (activities.ts buildCatalog: every spec validated), cached on its wood and the
   * furniture's open demand, logged once a change. An exception is logged once a village and gives null (the keeps alone):
   * it runs inside the menu, and one village's bad record must not stop every village's chores (B.4's review, lens 3 L5).
   */
  catalog(v: Village): { goods: MakeGood[]; specs: Map<string, ActivitySpec> } | null {
    try {
      const wood = this.catalogWoodOf(v);
      const demand = CHOOSE.families.has('furnish') ? this.decorDemand(v) : {};
      const key = `${wood}|${Object.entries(demand).sort(([x], [y]) => x.localeCompare(y)).map(([n, q]) => `${n}:${q}`).join(',')}`;
      const old = this.catalogCache.get(v.name);
      if (old?.key === key) return old;
      const { specs, dropped } = buildCatalog(this.registry, this.materials, { wood, decorDemand: demand, keep: MAKE_GOODS, food: FOOD_GOODS });
      const goods = specs.filter((sp) => sp.kind === 'make' && sp.good).map((sp) => (sp.wood ? { ...sp.good!, wood: sp.wood } : sp.good!));
      const entry = { key, goods, specs: new Map(specs.map((sp) => [sp.id, sp])) };
      this.catalogCache.set(v.name, entry);
      const by = (src: string) => specs.filter((sp) => sp.kind === 'make' && sp.source === src).length;
      console.log(`[catalog] ${v.name}: ${goods.length} goods (${by('keep')} keep, ${by('food')} food, ${by('catalog')} catalogue, ${by('decor')} furniture) in ${wood}; furniture wants ${countsList(demand)}${dropped.length ? `; ${dropped.length} dropped (${dropped.slice(0, 3).map((d) => `${d.id}: ${d.why}`).join('; ')})` : ''}`);
      return entry;
    } catch (e) {
      if (!this.catalogFailed.has(v.name)) console.error(`[catalog] ${v.name}: the catalogue could not be built (the keeps alone):`, e);
      this.catalogFailed.add(v.name);
      return null;
    }
  }

  /** decorParts' cache, by village, and the villages whose parts threw (logged once), as lighting's. */
  private decorCache = new Map<string, { sig: string; parts: DecorPart[] }>();
  private decorFailed = new Set<string>();

  /**
   * The buildings a village furnishes (X.1): lighting's buildings but the storage and mining huts and town centres, each
   * with buildingDecor's spots in the catalogue's wood (off its torch spots and signs), kept inside the structure's box and
   * between its floor and its top (lessons 30, 102), by open spots, most first. Cached on a signature; an exception is
   * logged once a village and gives none (as lightParts).
   */
  decorParts(v: Village): DecorPart[] {
    try {
      return this.decorPartsOf(v);
    } catch (e) {
      if (!this.decorFailed.has(v.name)) console.error(`[decor] ${v.name}: the furniture spots could not be worked out (no furnishing):`, e);
      this.decorFailed.add(v.name);
      return [];
    }
  }

  private decorPartsOf(v: Village): DecorPart[] {
    const wood = this.catalogWoodOf(v);
    const buildings = this.lightParts(v).filter((P) => P.kind === 'building' && P.place && P.structure && P.structure.kind !== STORAGE_HUT && P.structure.kind !== MINING_HUT && !/_meeting_point_/.test(P.place.design.name) && !P.place.noSign);
    const signs = (v.layouts ?? []).flatMap((l) => l.signs ?? []);
    const sig = JSON.stringify([wood, buildings.map((P) => [P.part, P.place!.design.name, P.place!.x, P.place!.z, P.place!.rot, P.structure!.y, P.walk]), signs.map((q) => `${q.x},${q.layer},${q.z}`), v.decor ?? null]);
    const old = this.decorCache.get(v.name);
    if (old?.sig === sig) return old.parts;
    const parts: DecorPart[] = [];
    for (const P of buildings) {
      const st = P.structure!, place = P.place!;
      const lights: LightSpot[] = P.spots.map((q) => ({ x: q.x, layer: q.y - st.y, z: q.z, block: q.block, ...(q.facing ? { facing: q.facing as LightSpot['facing'] } : {}), src: q.src ?? 'code', inside: true }));
      const spots = buildingDecor(place, wood, { lights, signs })
        .filter((q) => q.x >= st.x1 && q.x <= st.x2 && q.z >= st.z1 && q.z <= st.z2 && q.layer >= 1 && q.layer < place.design.height && (!q.also || q.also.layer < place.design.height))
        .map((q) => ({ ...q, y: st.y + q.layer }));
      if (!spots.length) continue;
      const r = v.decor?.[P.part];
      const open = spots.filter((q) => !r?.done.includes(`${q.x},${q.y},${q.z}`) && !r?.never?.includes(`${q.x},${q.y},${q.z}`));
      parts.push({ part: P.part, label: P.label, structure: st, place, walk: P.walk, spots, open });
    }
    parts.sort((p, q) => q.open.length - p.open.length);
    this.decorCache.set(v.name, { sig, parts });
    return parts;
  }

  /** The furniture the open spots want, by item, less what furnish chores carry (X.1; the catalogue's targets). */
  decorDemand(v: Village): Counts {
    const out: Counts = {};
    for (const P of this.decorParts(v))
      for (const q of P.open) {
        out[q.item] = (out[q.item] ?? 0) + 1;
        if (q.also) out[q.also.item] = (out[q.also.item] ?? 0) + 1;
      }
    for (const [k, c] of decorCarried) if (k.startsWith(`${v.name}|`)) for (const [n, q] of Object.entries(c)) if (out[n]) out[n] = Math.max(0, out[n] - q);
    for (const n of Object.keys(out)) if (!out[n]) delete out[n];
    return out;
  }

  /**
   * One good's plan now (spec 2.6): its deficit (the target less the stock and other agents' makes of it under way), then
   * batches from the largest whole one down by its unit, the first whose bill plans from the spare storage with nothing to
   * gather (lesson 1: code finds the batch). `inputs`: what the plan takes from storage plus the coal and charcoal it burns
   * (spare coal first); `smelts` by the plan's own fuel count, the rule the skill uses too (D5).
   */
  makePlan(v: Village, good: MakeGood, agent: string, store: Counts = storageContents(v), base?: Counts): MakePlan {
    const stock = store[good.item] ?? 0;
    const going = this.goingS9(v, agent).make.filter((m) => m.item === good.item).reduce((s, m) => s + m.count, 0);
    const want = this.makeTarget(v, good) - stock - going;
    if (want <= 0) return { why: 'at stock' };
    // (`base`: makeSpare(v, agent, undefined, store) computed once for many goods, X.1's catalogue: its reserve is a plan of
    // every open build, too dear to repeat for each of ~70 goods; the good's own item left out as makeSpare's `except`)
    let spare: Counts;
    if (base && !good.allow) {
      spare = { ...base };
      delete spare[good.item];
    } else spare = this.makeSpare(v, agent, good.item, store, good.allow);
    // A good of one wood kind (X.1) plans from that kind's logs and planks only (the critique's 2)
    if (good.wood) for (const n of Object.keys(spare)) if (/_(log|planks)$/.test(n) && !n.startsWith(`${good.wood}_`)) delete spare[n];
    const plans = new Map<string, MaterialPlan>();
    const plan = (b: Counts, have: Counts) => {
      const key = `${JSON.stringify(b)}|${have === spare ? '' : JSON.stringify(have)}`;
      let p = plans.get(key);
      if (!p) plans.set(key, (p = this.materials.plan(b, have)));
      return p;
    };
    const wood = v.wood ?? this.woodOf(v, store);
    for (let count = Math.min(good.batch, Math.ceil(want / good.unit) * good.unit); count > 0; count -= good.unit) {
      const b = makeBill(this.registry, plan, good, count, spare, wood);
      if (!b) return { why: 'no recipe' };
      if (!b.feasible) continue;
      const p = plan(b.bill, spare);
      if (Object.keys(p.gather).length || p.problems.length) continue;
      const inputs: Counts = { ...p.fromStock };
      // (the fuel's coal from what the ingredients left of the spare coal, then charcoal: D13's planner counts it once)
      let fuel = p.fuel.coal;
      for (const n of ['coal', 'charcoal']) {
        const t = Math.min(fuel, (spare[n] ?? 0) - (p.fromStock[n] ?? 0));
        if (t <= 0) continue;
        inputs[n] = (inputs[n] ?? 0) + t;
        fuel -= t;
      }
      return { count, bill: b.bill, inputs, smelts: p.fuel.smelts > 0, ...(b.craft ? { craft: b.craft } : {}) };
    }
    return { why: 'inputs short' };
  }

  /**
   * Gathering's demand per material (spec 4.8): the raw materials of every good's deficit (makes under way netted out, the
   * check's M1; variants in the village's wood unless stocked slabs make them), planned from the spare storage without the
   * goods themselves (a stock already lowers the deficit), with the works furnaces' cobblestone once the plot is ready (less
   * the placements under way); the keeps' shortfall (logs, cobblestone). Less what gathering chores under way bring
   * (incoming).
   */
  gatherWanted(v: Village, store: Counts = storageContents(v)): GatherWanted {
    const going = this.goingS9(v);
    const spare = this.makeSpare(v, '', undefined, store);
    // (X.1: with the catalog family, every good of the catalogue but food, as before only the keeps)
    const goods = CHOOSE.families.has('catalog') ? this.goodsFor(v).filter((g) => !g.food) : MAKE_GOODS;
    for (const g of goods) delete spare[g.item];
    const wood = v.wood ?? this.woodOf(v, store);
    const plan = (b: Counts, have: Counts) => this.materials.plan(b, have);
    // (a good of one wood kind planned from that kind's logs and planks only, as makePlan: its gather added beside the bill)
    const ownWood = (g: MakeGood) => {
      const s2 = { ...spare };
      for (const n of Object.keys(s2)) if (/_(log|planks)$/.test(n) && !n.startsWith(`${g.wood}_`)) delete s2[n];
      return s2;
    };
    // (each kind's goods in one bill, planned once: planned alone, each counted the same stored logs, the review's L4)
    const woodBills: Record<string, Counts> = {};
    const out = Object.fromEntries(MATERIALS.map((m) => [m, { need: 0, incoming: 0, want: 0, for: [] as string[] }])) as GatherWanted;
    const mat = (n: string): Material | null => (n === 'any:logs' || /_log$/.test(n) ? 'logs' : /^(red_)?sand$/.test(n) ? 'sand' : /^(any:)?cobblestone$/.test(n) ? 'cobblestone' : null);
    const bill: Counts = {};
    for (const g of goods) {
      const d = Math.max(0, this.makeTarget(v, g) - (store[g.item] ?? 0) - going.make.filter((x) => x.item === g.item).reduce((s, x) => s + x.count, 0));
      if (!d) continue;
      if (g.wood) {
        const wb = (woodBills[g.wood] ??= {});
        wb[g.item] = (wb[g.item] ?? 0) + d;
        for (const m of new Set(Object.keys(plan({ [g.item]: d }, ownWood(g)).gather).map(mat))) if (m) out[m].for.push(g.words);
        continue;
      }
      const b = g.variant ? makeBill(this.registry, plan, g, d, spare, wood)?.bill : { [g.item]: d };
      if (!b) continue;
      for (const [n, q] of Object.entries(b)) bill[n] = (bill[n] ?? 0) + q;
      // (what each good wants gathered, for the facts: planned alone)
      const own = plan(b, spare).gather;
      for (const m of new Set(Object.keys(own).map(mat))) if (m) out[m].for.push(g.words);
    }
    // The works furnaces' 8 cobblestone each, once the plot is ready: in the bill planned from the spare storage with the
    // goods, less the placements under way (their 8 are earmarked, so the spare is already short of them): a stocked village
    // gathered 24 cobblestone it held for as long as a furnace stood unplaced (S.9's review, lens 2 H1, lens 4 M1)
    const wk = v.layouts?.[0]?.works;
    if (wk?.state === 'ready') {
      const placed = (wk.furnaces ?? []).slice(0, WORKS_FURNACES).filter(Boolean).length;
      const missing = Math.max(0, WORKS_FURNACES - placed - going.furnaces.filter((k) => !wk.furnaces?.[k - 1]).length);
      if (missing > 0) {
        bill.cobblestone = (bill.cobblestone ?? 0) + 8 * missing;
        if (plan({ cobblestone: 8 * missing }, spare).gather.cobblestone) out.cobblestone.for.push('the works furnaces');
      }
    }
    const gathered = Object.keys(bill).length ? { ...plan(bill, spare).gather } : {};
    for (const [w, wb] of Object.entries(woodBills)) for (const [n, q] of Object.entries(plan(wb, ownWood({ wood: w } as MakeGood)).gather)) gathered[n] = (gathered[n] ?? 0) + q;
    for (const [n, q] of Object.entries(gathered)) {
      const m = mat(n);
      if (m) out[m].need += q;
    }
    const logs = v.wood ? store[`${v.wood}_log`] ?? 0 : Object.entries(store).filter(([n]) => /_log$/.test(n)).reduce((s, [, q]) => s + q, 0);
    const keepLogs = Math.max(0, this.logsKeep(v) - logs), keepCobble = Math.max(0, MAKE_KEEP.cobblestone - (store.cobblestone ?? 0));
    out.logs.need += keepLogs;
    out.cobblestone.need += keepCobble;
    if (keepLogs) out.logs.for.push('the keep');
    if (keepCobble) out.cobblestone.for.push('the keep');
    for (const g of going.gather) out[g.material].incoming += g.n;
    for (const m of MATERIALS) out[m].want = Math.max(0, out[m].need - out[m].incoming);
    return out;
  }

  /** Free furnace keys for a smelting make (D5), in order 1, 2, 3 (the works furnaces recorded), then 0 (the hut's). */
  freeFurnaces(v: Village, busy: Set<string>): number[] {
    const out: number[] = [];
    const f = v.layouts?.[0]?.works?.furnaces ?? [];
    const now = Date.now();
    // (not one a smelt could not reach in the last 10 minutes: F233's works furnace failed every catalogue smelt sent to it)
    for (let k = 1; k <= WORKS_FURNACES; k++) if (f[k - 1] && !busy.has(`furnace:${k}`) && (this.furnaceBack.get(`${v.name}:${k}`) ?? 0) <= now) out.push(k);
    if (villageStationCell(v, 'furnace') && !busy.has('furnace:0')) out.push(0);
    return out;
  }

  // ---- B.4: lighting's parts and the torch demand (pure; the menu, the skill and the offline checks read them) ----------

  /** lightParts' cache, by village: the signature it was computed on (L3; left out of the golden check's purity snapshot). */
  private lightCache = new Map<string, { sig: string; parts: LightPart[] }>();

  /**
   * The parts a village lights (B.4, D3, D9): its buildings (structures with a design in v.designs and a done Build task
   * at their x, z; turned by the task's rotate), by unlit spots, most first, then the mine's parts. A building's spots are
   * buildingLights' (vanilla's own cells, then code's inside ones; off its signs and lamps) at the structure's floor; the
   * mine's mineLights'. Cached on a signature of what they are computed from. An exception (a malformed stored design, a
   * mine record missing a field) is logged once a village and gives no parts: makeTarget, the make and gather menus and the
   * sweep read them, and one village's bad record stopped every village's chores (B.4's review, lens 3 L5).
   */
  lightParts(v: Village): LightPart[] {
    try {
      return this.lightPartsOf(v);
    } catch (e) {
      if (!this.lightFailed.has(v.name)) console.error(`[light] ${v.name}: the light parts could not be worked out (no lighting):`, e);
      this.lightFailed.add(v.name);
      return [];
    }
  }

  /** Villages whose light parts threw (logged once). */
  private lightFailed = new Set<string>();

  private lightPartsOf(v: Village): LightPart[] {
    const m = v.mine;
    const builds = v.tasks.filter((t) => t.status === 'done' && /^build_design "/.test(t.detail)).map((t) => t.detail.slice(0, 120));
    const sig = JSON.stringify([
      v.complete ?? false, v.structures.map((st) => `${st.id}:${st.kind}:${st.x1},${st.z1},${st.y}`), builds, Object.keys(v.designs),
      (v.layouts ?? []).map((l) => [l.signs?.map((q) => `${q.x},${q.layer},${q.z}`), l.lamps]),
      m ? [m.level, m.steps, m.stopped, m.dug, (m.legs ?? []).map((l) => [l.main, l.br, l.dug, l.ended, l.end]), m.down, m.iron ? [m.iron.x, m.iron.z, m.iron.steps, m.iron.level, m.iron.finished, m.iron.legs.map((l) => [l.dug, l.end])] : null] : null,
      v.lights ?? null,
    ]);
    const old = this.lightCache.get(v.name);
    if (old?.sig === sig) return old.parts;
    const rec = (part: string) => v.lights?.[part];
    const unlitOf = (part: string, keys: string[]) => {
      const r = rec(part);
      return keys.filter((k) => !r?.done.includes(k) && !r?.never?.includes(k));
    };
    const signs = (v.layouts ?? []).flatMap((l) => l.signs ?? []);
    const lamps = (v.layouts ?? []).flatMap((l) => l.lamps ?? []);
    const buildings: LightPart[] = [];
    const labels = new Map<string, number>();
    for (const st of v.structures) {
      const d = v.designs[st.kind];
      if (!d) continue;
      // (the Build task that put it here: its centre and quarter turns, L4: rotate is in degrees)
      let place: SignPlace | null = null;
      for (const t of v.tasks) {
        const mm = t.status === 'done' ? /^build_design "([^"]+)" x=(-?\d+) z=(-?\d+)(?: rotate=(-?\d+))?/.exec(t.detail) : null;
        if (!mm || mm[1] !== st.kind) continue;
        const rot = ((Math.round(Number(mm[4] ?? 0) / 90) % 4) + 4) % 4;
        const W = rot % 2 ? d.depth : d.width, D = rot % 2 ? d.width : d.depth;
        const x = Number(mm[2]), z = Number(mm[3]);
        if (x - Math.floor(W / 2) !== st.x1 || z - Math.floor(D / 2) !== st.z1) continue;
        place = { design: d, x, z, rot, ...(/_meeting_point_/.test(d.name) ? { noSign: true } : {}) };
        break;
      }
      if (!place) continue;
      const lights = buildingLights(place, { vanilla: vanillaLights(d), signs, lamps, facades: LIGHT_FACADES })
        // (every spot inside the structure's area, the spec's assertion: one outside would light a neighbour)
        .filter((q) => q.x >= st.x1 && q.x <= st.x2 && q.z >= st.z1 && q.z <= st.z2);
      const spots = lights.map((q) => ({ x: q.x, y: st.y + q.layer, z: q.z, block: q.block, ...(q.facing ? { facing: q.facing } : {}), src: q.src }));
      const vanilla = d.by === 'vanilla' || /^(plains|desert|savanna|snowy|taiga)_[a-z_]+_\d+$/.test(d.name);
      let label = d.name === STORAGE_HUT ? 'storage hut' : d.name === MINING_HUT ? 'mining hut' : /_meeting_point_/.test(d.name) ? 'meeting point' : signLabel(d.name, vanilla).join(' ').toLowerCase();
      const seen = (labels.get(label) ?? 0) + 1;
      labels.set(label, seen);
      if (seen > 1) label = `${label} ${['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][seen] ?? seen}`;
      const keys = spots.map((q) => `${q.x},${q.y},${q.z}`);
      buildings.push({ part: st.id, label, kind: 'building', structure: st, place, spots, unlit: unlitOf(st.id, keys).length, growing: false });
    }
    // The walk from the storage hut's door to each building's (the facts' minutes)
    const hutPart = buildings.find((b) => b.structure?.kind === STORAGE_HUT);
    const hutDoor = (hutPart?.place && placedDoor(hutPart.place)) ?? (v.storageHut ? { x: Math.round((v.storageHut.x1 + v.storageHut.x2) / 2), z: v.storageHut.z2 + 1 } : null);
    for (const b of buildings) {
      const door = b.place ? placedDoor(b.place) : null;
      const to = door ?? (b.structure ? { x: (b.structure.x1 + b.structure.x2) / 2, z: (b.structure.z1 + b.structure.z2) / 2 } : null);
      if (hutDoor && to) b.walk = Math.round(Math.hypot(to.x - hutDoor.x, to.z - hutDoor.z));
    }
    buildings.sort((p, q) => q.unlit - p.unlit);
    const mine: LightPart[] = [];
    if (m) {
      const faces = mineFacesGoing(m);
      const byPart = new Map<string, MineLightSpot[]>();
      for (const q of mineLights(m)) byPart.set(q.part, [...(byPart.get(q.part) ?? []), q]);
      const tunnels = new Map<string, number>();
      for (const [part, list] of byPart) {
        const spots = list.map((q) => ({ x: q.x, y: q.y, z: q.z, block: 'wall_torch' as const, sides: q.sides }));
        const waiting = new Set(list.filter((q) => nearMineFace(faces, q)).map((q) => `${q.x},${q.y},${q.z}`));
        const unlit = unlitOf(part, spots.map((q) => `${q.x},${q.y},${q.z}`)).filter((k) => !waiting.has(k)).length;
        let label = 'mine stairs';
        const leg = /^mine:(\d+)$/.exec(part), down = /^mine:down:(\d+)$/.exec(part);
        if (part === 'mine:iron') label = 'iron level';
        else if (down) label = `mine's stairs down${Number(down[1]) ? ` ${['', 'two', 'three'][Number(down[1])] ?? Number(down[1]) + 1}` : ''}`;
        else if (leg) {
          const l = m.legs![Number(leg[1])];
          const dir = l.dir[0] > 0 ? 'east' : l.dir[0] < 0 ? 'west' : l.dir[1] > 0 ? 'south' : 'north';
          const n = (tunnels.get(dir) ?? 0) + 1;
          tunnels.set(dir, n);
          label = `mine's ${dir} tunnel${n > 1 ? ` ${['', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? n}` : ''}`;
        }
        mine.push({ part, label, kind: 'mine', spots, unlit, growing: mineGrowing(m, part) });
      }
    }
    const parts = [...buildings, ...mine];
    this.lightCache.set(v.name, { sig, parts });
    return parts;
  }

  /** The torches lighting still wants (D7): every part's unlit spots, less the torches light chores carry (L2). */
  torchDemand(v: Village): number {
    let unlit = this.lightParts(v).reduce((n, p) => n + p.unlit, 0);
    // (a growing village's: the neighbourhood's lamps still to light, whose job takes stored torches first, s30)
    if (growing(v))
      (v.layouts ?? []).forEach((l, i) => {
        if (l.lamps?.length && !l.lit && v.tasks.some((t) => (t.status === 'open' || t.status === 'claimed') && t.detail.startsWith(`light_streets layout=${i + 1} `))) unlit += l.lamps.length;
      });
    let carried = 0;
    for (const [k, q] of lightCarried) if (k.startsWith(`${v.name}|`)) carried += q;
    return Math.max(0, unlit - carried);
  }

  /** A good's target in storage (D7): torches follow lighting's demand while the light family is on, max(32, min(64,
   *  demand) + 8); every other good, and torches with the family off, the table's. */
  makeTarget(v: Village, g: MakeGood): number {
    // (food, s30's D13: bread two a member, pies one for two, where the village keeps an appetite; none otherwise)
    // (s39 tier 1, MC_NEED_WORKS: three and one a member while the food flow is short)
    if (g.food) return !appetiteOn(v) ? 0 : foodTarget(g.item === 'bread' ? 'bread' : 'pumpkin_pie', this.growMembers(v).length, NEED_WORKS && !!v.foodFlow?.short);
    if (g.item !== 'torch' || !CHOOSE.families.has('light')) return g.target;
    return Math.max(g.target, Math.min(TORCH_DEMAND_CAP, this.torchDemand(v)) + TORCH_RESERVE);
  }

  /** The village's makes and gathering trips under way (S.9), but `except`'s own (its make plans with itself left out). */
  private goingS9(v: Village, except?: string) {
    const make: Array<{ item: string; count: number; smelts: boolean; k?: number }> = [], gather: Array<{ material: Material; n: number }> = [], furnaces: number[] = [];
    const skip = except?.toLowerCase();
    for (const [id, c] of this.chores) {
      if (c.village !== v.name || id === skip || !this.agents.has(id) || !c.status.some((q) => q.state === 'queued' || q.state === 'running')) continue;
      if (c.choice.make) make.push(c.choice.make);
      if (c.choice.gather) gather.push(c.choice.gather);
      if (c.choice.furnace !== undefined) furnaces.push(c.choice.furnace);
    }
    return { make, gather, furnaces };
  }

  /**
   * Whether miners leave the storage's spoken-for cobblestone alone (S.1): only where the pickaxe supply makes up for it,
   * in a village of five or more or once a supply is posted. In a smaller one the reserve made the first pickaxe wooden
   * (half the digging speed, 59 blocks) where two or three miners took at most a few cobblestone before.
   */
  pickaxeReserve(v: Village): boolean {
    return v.tasks.some((t) => PICK_SUPPLY.test(t.title)) || [...this.agents.values()].filter((a) => a.village() === v).length >= SUPPLY_MEMBERS;
  }

  /**
   * Cobblestone in storage the pickaxe supply is still to take: all of it while the task waits with its own gathering
   * finished; while it runs, all of it less what its maker and the storage's pickaxes gained since its claim (withdrawn,
   * made into pickaxes, deposited: its own pickaxe and leftover cobblestone are not the task's); nothing otherwise.
   */
  private supplyDraw(v: Village): number {
    const t = v.tasks.find((x) => PICK_SUPPLY.test(x.title) && (x.status === 'open' || x.status === 'claimed'));
    if (!t) return 0;
    const n = 3 * Number(PICK_SUPPLY.exec(t.title)![1]);
    if (t.status === 'open') return t.after.every((id) => !/^(open|claimed)$/.test(v.tasks.find((q) => q.id === id)?.status ?? '')) ? n : 0;
    const maker = this.agents.get(t.claimedBy?.toLowerCase() ?? '');
    const start = this.supplyStart.get(`${v.name}:${t.id}`);
    if (!maker || !start || start.by !== maker.name) return n;
    const gained = this.stoneHeld(maker) - start.held + 3 * (storageContents(v).stone_pickaxe ?? 0) - start.stored;
    return Math.max(0, n - Math.max(0, gained));
  }

  /**
   * The soft pickaxe supply (S.1): "Make 4 stone_pickaxe into storage", once a village, when the mine is dug and buildings
   * still wait, so miners without a pickaxe take a stone one from storage instead of the builds' cobblestone. Its
   * cobblestone is gathered for it first unless the storage has that much to spare beyond the reserve. Posted last on the
   * board, and only where it is off the critical path: five or more members, or two workers holding no task (a scripted
   * worker takes the first claimable task, so in a three-agent village it would take it a second before a build). Closed
   * as moot once nothing is left to build.
   */
  private pickaxeSupply(v: Village, store: Counts, wood: string) {
    const reg = this.villages;
    const own = v.tasks.filter((t) => PICK_SUPPLY.test(t.title) || PICK_GATHER.test(t.title));
    if (!v.tasks.some((t) => /^Build /.test(t.title) && (t.status === 'open' || t.status === 'claimed'))) {
      const moot = own.filter((t) => t.status === 'open');
      for (const t of moot) {
        t.status = 'done';
        t.result = 'not needed: every building is built';
        t.updated = Date.now();
        reg.note(v, `${t.id} "${t.title}" was not needed: every building is built`);
      }
      if (moot.length) reg.save();
      return;
    }
    // (not in a complete village: a growing one's board would take it as the neighbourhood's, for miners who have pickaxes;
    // G3 made 4 nobody needed, s30's review)
    if (v.complete || own.length || v.mine?.level === undefined || !v.tasks.some((t) => /^Build /.test(t.title) && t.status === 'open')) return;
    const members = [...this.agents.values()].filter((a) => a.village() === v);
    const busy = new Set(v.tasks.filter((t) => t.status === 'claimed').map((t) => t.claimedBy?.toLowerCase()));
    const idle = members.filter((a) => a.role !== 'mayor' && !busy.has(a.name.toLowerCase())).length;
    if (members.length < SUPPLY_MEMBERS && idle < 2) return;
    // Logs for the sticks (and a table where none is near): the village's kind, else the storage's commonest
    const logs = Object.entries(store).filter(([n, q]) => /_log$/.test(n) && q >= 3).sort((x, y) => y[1] - x[1]);
    const kind = v.wood && (store[`${v.wood}_log`] ?? 0) >= 3 ? `${v.wood}_log` : logs[0]?.[0];
    if (!kind) return;
    const n = PICK_BATCH, need = 3 * n;
    const reserved = this.reservedInStorage(v, 'cobblestone');
    const gather = (store.cobblestone ?? 0) - reserved >= need ? [] : gatherTasks({ cobblestone: need }, 'stone pickaxes').map((t) => ({ ...t, soft: true }));
    const made = reg.post(v, [...gather, {
      title: `Make ${n} stone_pickaxe into storage`,
      detail: `withdraw item=cobblestone count=${need}, withdraw item=${kind} count=3, craft item=stone_pickaxe count=${n} wood=${kind.replace(/_log$/, '')}, then deposit item=stone_pickaxe count=${n} (by name: deposit all keeps tools)`,
      soft: true,
      after: gather.length ? [0] : [],
    }], 'code', 4);
    const why = `storage ${store.cobblestone ?? 0} cobblestone, ${reserved} reserved for buildings${gather.length ? `; its ${need} gathered first` : ''}`;
    reg.note(v, `code posted ${made.map((t) => t.id).join(', ')}: a stone pickaxe supply for the miners (${why})`);
    reg.save();
    console.log(`[pickaxe] code posted ${made.map((t) => `${t.id} "${t.title}"`).join(', ')} in ${v.name} (${why}; ${members.length} members, ${idle} workers idle)`);
  }

  /**
   * What a village still needs gathered (plan step V.3), kept in `v.needed` and shown in every village summary: the raw
   * materials of its laid-out buildings not built or being built yet and of the mayor's `add_need` items, less the
   * storage and what each worker carries of the material it is gathering. Gather tasks follow it (syncGather). At most
   * every 3 s per village.
   */
  refreshNeeds(v: Village) {
    if (!v.tasks.some((t) => t.title === 'Set up the village storage')) return;
    // (a growing village's neighbourhood is gathered for as before completion, s30 D12)
    if (v.complete && !growing(v)) {
      delete v.needed;
      return;
    }
    const now = Date.now();
    if (now - (this.needsAt.get(v.name) ?? 0) < 3000) return;
    this.needsAt.set(v.name, now);
    const add = (to: Counts, c: Counts) => { for (const [n, q] of Object.entries(c)) to[n] = (to[n] ?? 0) + q; };
    const store = storageContents(v);
    const wood = this.woodOf(v, store);
    const { bill, unbuilt } = this.openBill(v, wood);
    // The stations their own task owes (S.5): gathering is posted for them when the storage falls short, as for a building
    const owed = this.stationsBill(v);
    add(bill, owed);
    if (Object.keys(owed).length) unbuilt.push('the stations');
    // The mayor's items, in the same wood ("logs" and "planks" mean the village's kind)
    const extra: Counts = {};
    for (const [n, q] of Object.entries(v.needs ?? {})) extra[n === 'logs' ? `${wood}_log` : n === 'planks' ? `${wood}_planks` : n] = q;
    add(bill, inWood(extra, wood));
    // Held: the storage, and what a worker carries of the material its gather task is for (the preparer's felled logs
    // count once deposited: counted in hand, they closed the log tasks the builds wait for)
    const norm = (b: string) => (b === 'logs' ? `${wood}_log` : b);
    const task = new Map<string, string>();
    for (const t of v.tasks) {
      // (not the pickaxe supply's own cobblestone: it is not for the buildings, S.1)
      const m = t.status === 'claimed' && t.claimedBy && !PICK_GATHER.test(t.title) ? /^collect block=(\S+) count=\d+, then deposit/.exec(t.detail) : null;
      if (m) task.set(t.claimedBy!.toLowerCase(), norm(m[1]));
    }
    const have: Counts = { ...store };
    const carried = new Map<string, number>();
    for (const a of this.agents.values()) {
      const item = task.get(a.name.toLowerCase());
      if (a.village() !== v || !item) continue;
      const n = a.bot.inventory.items().filter((it) => (v.wood ? it.name === item : norm(it.name.replace(/^\w+_log$/, 'logs')) === item)).reduce((s, it) => s + it.count, 0);
      carried.set(a.name.toLowerCase(), n);
      have[item] = (have[item] ?? 0) + n;
    }
    // The windows' maker holds their sand, glass and panes between its withdrawal and its deposit (S.3): counted, or the
    // sand would be posted again "for the village" in that window
    for (const t of v.tasks) {
      const maker = t.status === 'claimed' && /^glass/.test(PARTS_MAKE.exec(t.title)?.[2] ?? '') ? this.agents.get(t.claimedBy?.toLowerCase() ?? '') : undefined;
      const held = maker ? heldCounts(maker) : null;
      if (held) for (const n of ['sand', 'glass', 'glass_pane']) if (held[n]) have[n] = (have[n] ?? 0) + held[n];
    }
    if (!v.wood)
      for (const n of Object.keys(have)) {
        const k = /_log$/.test(n) ? `${wood}_log` : /_planks$/.test(n) ? `${wood}_planks` : n;
        if (k !== n) {
          have[k] = (have[k] ?? 0) + have[n];
          delete have[n];
        }
      }
    // Not the cobblestone in storage the pickaxe supply is about to take (S.1): counted as the builds', it closed their
    // gathering and they came up short once the supply withdrew it
    const draw = this.supplyDraw(v);
    if (draw && have.cobblestone !== undefined) have.cobblestone = Math.max(0, have.cobblestone - draw);
    const items = Object.keys(bill).length ? gatherNames(this.materials.plan(bill, have).gather, wood) : {};
    // A village without a wood kind gathers any logs
    if (!v.wood && items[`${wood}_log`] !== undefined) {
      items.logs = items[`${wood}_log`];
      delete items[`${wood}_log`];
    }
    // Not what no one can find near the village (sand: the windows stay open)
    for (const n of v.unavailable ?? []) delete items[n];
    v.needed = { items, for: unbuilt, updated: now };
    // (before the guard below: a build under way must not hold the supply back)
    this.pickaxeSupply(v, store, wood);
    // Not while a build is under way: its builder withdraws and places, and the numbers jump (tasks were closed and
    // posted again)
    if (!v.tasks.some((t) => /^Build /.test(t.title) && t.status === 'claimed')) this.syncGather(v, items, carried);
  }

  /**
   * Gather tasks in step with what the village needs: what no open or held task covers is posted (a held task covers what
   * its worker has still to collect), and those posted here are closed again when no longer needed.
   */
  private syncGather(v: Village, need: Counts, carried: Map<string, number>) {
    const reg = this.villages;
    const norm = (b: string) => (b === 'logs' && v.wood ? `${v.wood}_log` : b);
    // (not the pickaxe supply's own cobblestone: it covers none of the buildings' need, S.1)
    const gather = (t: { title: string; detail: string }) => {
      if (PICK_GATHER.test(t.title)) return null;
      const m = /^collect block=(\S+) count=(\d+), then deposit/.exec(t.detail);
      return m ? { item: norm(m[1]), n: Number(m[2]) } : null;
    };
    // A material nobody found at all near the village (a gather task failed as not to be had) is not posted again
    const hopeless = new Set([...v.tasks.filter((t) => t.status === 'failed' && /cannot be gathered here/.test(t.result ?? '')).map((t) => gather(t)?.item), ...(v.unavailable ?? [])]);
    const storage = v.tasks.find((t) => t.title === 'Set up the village storage' && t.status !== 'failed');
    let changed = false;
    const items = new Set([...Object.keys(need), ...v.tasks.filter((t) => t.status === 'open').map((t) => gather(t)?.item).filter((x): x is string => !!x)]);
    for (const item of items) {
      const want = need[item] ?? 0;
      const open = v.tasks.filter((t) => t.status === 'open' && gather(t)?.item === item);
      const held = v.tasks.filter((t) => t.status === 'claimed' && gather(t)?.item === item);
      let covered = open.reduce((s, t) => s + gather(t)!.n, 0) + held.reduce((s, t) => s + Math.max(0, gather(t)!.n - (carried.get(t.claimedBy?.toLowerCase() ?? '') ?? 0)), 0);
      // More planned than needed: close open ones this code posted, the largest first, while the rest still covers the
      // need. Not a building's own gather tasks: closing one lets that build start early (StageH12: the storage hut's
      // cobblestone task closed because the hall's covered the total, and the hut came up 15 short); the storage check
      // closes those building by building (coveredByStock)
      for (const t of open.filter((x) => x.postedBy === 'code' && / for the village( \(\d+\/\d+\))?$/.test(x.title)).sort((x, y) => gather(y)!.n - gather(x)!.n)) {
        if (covered - gather(t)!.n < want) continue;
        covered -= gather(t)!.n;
        t.status = 'done';
        t.result = want ? `not needed: other gather tasks already cover the ${want} ${item} still to gather` : `not needed: the storage and the workers gathering it hold enough ${item}`;
        t.updated = Date.now();
        reg.note(v, `${t.id} "${t.title}" was not needed: ${t.result}`);
        changed = true;
      }
      // Less planned than needed (materials went elsewhere, the mayor asked for more): post the rest
      // A small rest of cobblestone or logs is rounded up to 8, or added to an open task this code posted (S.1: Van12a's
      // "Gather 1 cobblestone" tasks, each a whole trip to the mine). Not scarce or slow items: 1 seed made 8 is ~64 grass
      // broken, and 2 sand made 8 can fail as "only found" where the 2 were there (the check's #8)
      const rest = want - covered;
      const small = rest < 8 && /^(cobblestone|logs|\w+_log)$/.test(item);
      if (rest > 0 && !hopeless.has(item) && !open.length) {
        // Cobblestone after the mine is dug (it comes from there)
        const dig = item === 'cobblestone' ? v.tasks.find((t) => t.title === 'Dig the village mine' && (t.status === 'open' || t.status === 'claimed')) : undefined;
        // (logs and cobblestone wait for the storage; the rest is gathered meanwhile and deposited once it stands, #3)
        const early = /^(sand|red_sand|dirt|gravel|clay_ball|wheat_seeds)$/.test(item);
        const tasks = gatherTasks({ [item]: small ? 8 : rest }, 'the village', v.wood).map((t) => ({ ...t, soft: true, after: [...(storage && storage.status !== 'done' && !early ? [storage.id] : []), ...(dig ? [dig.id] : [])] }));
        const made = reg.post(v, tasks, 'code', 20);
        reg.note(v, `code posted ${made.map((t) => t.id).join(', ')}: ${want} ${item} still to gather, ${covered} planned${small ? ` (rounded up from ${rest})` : ''}`);
        changed = true;
      } else if (rest > 0 && small && !hopeless.has(item)) {
        // (a building's own gather tasks are never changed: the cover rule and their builds' prerequisites count them)
        const host = open.find((t) => t.postedBy === 'code' && / for the village( \(\d+\/\d+\))?$/.test(t.title));
        if (host) {
          const n = gather(host)!.n + rest;
          host.title = host.title.replace(/^Gather \d+/, `Gather ${n}`);
          host.detail = host.detail.replace(/count=\d+/, `count=${n}`);
          host.updated = Date.now();
          reg.note(v, `code added ${rest} ${item} to ${host.id} (now ${n}): ${want} still to gather, ${covered} planned`);
          changed = true;
        }
      }
    }
    if (changed) reg.save();
  }

  /** Whether an item id exists (add_need). */
  isItem(name: string) {
    return !!this.registry.itemsByName[name];
  }

  isAgent(name: string) {
    return this.agents.has(name.toLowerCase());
  }

  /**
   * A block with an item (so it can be carried and placed); states such as "[facing=east]" must name the block's own
   * states and values (a misspelt one passed, and /setblock then refused the block at build time, leaving a hole).
   */
  isPlaceable(block: string) {
    const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(block.trim());
    if (!m) return false;
    const b = this.registry.blocksByName[m[1]];
    if (!b || !this.registry.itemsByName[m[1]]) return false;
    if (m[2] === undefined) return true;
    const states = (b.states ?? []) as Array<{ name: string; type: string; values?: string[] }>;
    return m[2].split(',').every((p) => {
      const [k, v] = p.split('=').map((t) => t.trim());
      const st = states.find((x) => x.name === k);
      if (!st || v === undefined) return false;
      return st.type === 'enum' ? !!st.values?.includes(v) : st.type === 'bool' ? v === 'true' || v === 'false' : /^\d+$/.test(v);
    });
  }

  /** What the architect may build with (phase D; mcMaterials.ts designBlockList), with block states. */
  designBlocks(survival: boolean) {
    return { blocks: designBlockList(survival), states: true };
  }

  get(name: string) {
    return this.agents.get(name.toLowerCase());
  }

  /** Chat is routed here (E.0): who hears a line (within HEAR_RANGE of its speaker) and who should answer it. */
  readonly routesChat = true;
  /** Lines just routed ("from\0text" to when): every bot hears every line, and it is routed once. */
  private heardAt = new Map<string, number>();
  /** Lines waiting to be routed, in order (a human's position may come over RCON). */
  private chatQueue: Promise<void> = Promise.resolve();
  /** Wakes by speaker and listener ("from|to") in the last PAIR_WINDOW_MS (the caps). */
  private pairWakes = new Map<string, number[]>();
  /** Humans' positions read over RCON (a spectator is not sent to the bots), kept a second. */
  private humanAt = new Map<string, { at: number; p: Vec3 | null }>();

  /** A chat line one of the bots heard (botAgent): routed once, in the order heard. */
  hearChat(from: string, text: string) {
    const now = Date.now(), key = `${from}\u0000${text}`;
    if (now - (this.heardAt.get(key) ?? 0) < 1000) return;
    this.heardAt.set(key, now);
    if (this.heardAt.size > 100) for (const [k, t] of this.heardAt) if (now - t >= 1000) this.heardAt.delete(k);
    this.chatQueue = this.chatQueue.then(() => this.routeChat(from, text)).catch((e: unknown) => console.error('[chat] routing failed:', e));
  }

  /** Where a speaker is: an agent's own body, a player any bot sees, else (a spectator) the server's answer; null if unknown. */
  private async speakerAt(from: string): Promise<Vec3 | null> {
    const agent = this.get(from);
    if (agent) return agent.bot.entity?.position ?? null;
    for (const a of this.agents.values()) {
      const e = a.bot.players[from]?.entity;
      if (e) return e.position;
    }
    if (!/^[A-Za-z0-9_]{1,16}$/.test(from) || /^(Server|Rcon)$/.test(from)) return null;
    const c = this.humanAt.get(from);
    if (c && Date.now() - c.at < 1000) return c.p;
    let p: Vec3 | null = null;
    try {
      const out = await Promise.race([this.rcon.command(`data get entity ${from} Pos`), new Promise<string>((r) => setTimeout(() => r(''), 2000))]);
      const m = /\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/.exec(out);
      if (m) p = new Vec3(Number(m[1]), Number(m[2]), Number(m[3]));
    } catch {
      /* unknown: out of range */
    }
    this.humanAt.set(from, { at: Date.now(), p });
    return p;
  }

  /** A wake from `from` to `to` within the pair's cap (counted when allowed). */
  private pairWake(from: string, to: string, cap: number): boolean {
    const now = Date.now(), k = `${from}|${to}`;
    const times = (this.pairWakes.get(k) ?? []).filter((t) => now - t < PAIR_WINDOW_MS);
    if (times.length >= cap) {
      this.pairWakes.set(k, times);
      return false;
    }
    times.push(now);
    this.pairWakes.set(k, times);
    return true;
  }

  /**
   * Who hears a line and who answers it (E.0, communications rule 2): agents within HEAR_RANGE of the speaker get it (an
   * unknown position is out of range). A human's line wakes the agents it names (as before, in any case: "mayor, ..."),
   * up to 3 and wherever they are, else the nearest in range; an agent's line wakes only agents it names, case-sensitively
   * and in range. Wakes are capped per speaker and listener (agents 2, humans 20 in 5 minutes): past it the line arrives
   * without one. Server lines (say, no player) reach every agent and wake none.
   */
  private async routeChat(from: string, text: string) {
    const listeners = [...this.agents.values()].filter((a) => a.name.toLowerCase() !== from.toLowerCase());
    if (!listeners.length) return;
    const human = !this.isAgent(from);
    const pos = await this.speakerAt(from);
    if (human && !pos && (/^(Server|Rcon)$/.test(from) || !/^[A-Za-z0-9_]{1,16}$/.test(from))) {
      for (const a of listeners) a.pushEvent('chat', `<${from}> ${text}`, { from, text });
      return;
    }
    const dist = new Map<BotAgent, number>();
    for (const a of listeners) if (pos && a.bot.entity) dist.set(a, pos.distanceTo(a.bot.entity.position));
    const inRange = (a: BotAgent) => (dist.get(a) ?? Infinity) <= HEAR_RANGE;
    const named = (a: BotAgent, flags: string) => new RegExp(`\\b${a.name}\\b`, flags).exec(text)?.index ?? -1;
    let wake: BotAgent[];
    if (human) {
      wake = listeners.filter((a) => named(a, 'i') >= 0).sort((x, y) => named(x, 'i') - named(y, 'i')).slice(0, 3);
      if (!wake.length) wake = listeners.filter(inRange).sort((x, y) => dist.get(x)! - dist.get(y)!).slice(0, 1);
    } else wake = listeners.filter((a) => inRange(a) && named(a, '') >= 0);
    wake = wake.filter((a) => this.pairWake(from, a.name, human ? 20 : 2));
    for (const a of listeners) {
      const woken = wake.includes(a);
      if (!woken && !inRange(a)) continue;
      const d = dist.get(a);
      a.pushEvent('chat', `<${from}> ${text}`, { from, text, ...(d !== undefined ? { distance: Math.round(d) } : {}), ...(woken ? { wake: true } : {}) });
    }
  }

  agentList() {
    return [...this.agents.values()];
  }

  /** prepare_site takes a layout's part (S.6). */
  readonly preparesParts = true;

  /** The village's workers in the world now (not its mayor): plan_layout splits the plot into more parts for four or more. */
  memberCount(v: Village): number {
    return [...this.agents.values()].filter((a) => a.village() === v && a.memory.villageRole !== 'mayor').length;
  }

  /** Every member of the village in the world, its mayor included: a village that grows wants a house for each (s30). */
  growMembers(v: Village): BotAgent[] {
    return [...this.agents.values()].filter((a) => a.village() === v);
  }

  /** The members whose brains take board tasks (the mayor never does): a neighbourhood nobody can build is not laid out. */
  growClaimers(v: Village): BotAgent[] {
    return this.growMembers(v).filter((a) => a.memory.villageRole !== 'mayor' && !!a.brain?.claimsTasks?.(a));
  }

  /** When each agent (lower-cased name) was last spawned: a claim older than its holder's spawn is no longer held (s30). */
  private spawnedAt = new Map<string, number>();

  // ---- s30: the village appetite (appetite.ts) ------------------------------------------------------------------------

  /** A member's appetite state where its village keeps one, else 'fed'. */
  private hungerOf(v: Village, a: { name: string }): 'fed' | 'peckish' | 'hungry' {
    const e = appetiteOn(v) ? v.food!.members[a.name] : undefined;
    return e ? stateOf(e.level) : 'fed';
  }

  /**
   * The claim gate (D8; brains filter their claims by task with it): a peckish member with food in storage takes no new
   * board task until it has eaten (one sweep, 30 s at most); a hungry one only food work (planting a field, its seeds).
   * True wherever the village keeps no appetite, before completion included (nothing drains then). "Food" is a meal this
   * member would eat (no cake while only peckish, lens 1 L1) beyond the meals other members are on their way to (M1).
   */
  mayClaim(agent: WorldAgent, task?: Task): boolean {
    const v = agent.village();
    // (N.2: another member's house is left to its owner a while, H7)
    if (HOUSING && v && task && this.ownerFirst(v, agent, task)) return false;
    if (!v || !appetiteOn(v)) return true;
    const s = this.hungerOf(v, agent);
    if (s === 'fed') return true;
    // (food work whatever storage holds: the meal may not be runnable, all eaters' places taken or its key cooling, lens 1 M2)
    if (s === 'hungry' && task && isFoodTask(task)) return true;
    if (chooseMeal(v.food.members[agent.name].level, storeForMeals(v.name, storageContents(v), agent.name))) return false;
    return s === 'peckish';
  }

  /** A member's appetite and state (the panel's bar), or null where its village keeps none. */
  appetiteOf(agent: WorldAgent): (Appetite & { state: string }) | null {
    const v = agent.village();
    const e = appetiteOn(v) ? v!.food!.members[agent.name] : undefined;
    return e ? { ...e, state: stateOf(e.level) } : null;
  }

  /** Levels set for tests (POST /api/village/:v/appetite): the members named, or every member in the world; the record
   *  started if it was not (the appetite then holds for the village from now). Returns the members' entries. */
  setAppetite(v: Village, names: string[], level: number): Record<string, Appetite> {
    const f = (v.food ??= { members: {}, made: {}, eaten: {}, meals: 0 });
    const now = Date.now();
    for (const raw of names) {
      const name = this.get(raw)?.name ?? raw;
      const e = (f.members[name] ??= { level, at: now, meals: 0, hungryMs: 0 });
      e.level = Math.max(0, Math.min(APPETITE.cap, level));
      e.at = now;
    }
    this.villages.save();
    console.log(`[food] ${v.name}: appetite set to ${level} for ${names.join(', ') || 'nobody'} (the API)`);
    return f.members;
  }

  /** #67: who is busy, every 5 s, as the runs' BusyClock counts it (an action running), for the panel's graphs. */
  private util = new UtilClock();
  private utilAt = 0;
  private utilTick() {
    const now = Date.now();
    if (now - this.utilAt < 5000) return;
    this.utilAt = now;
    this.util.sample(now, [...this.agents.values()].map((a) => ({ name: a.name, busy: !!a.current?.status })));
  }

  /** #67: busy shares over time (overall and per agent), the last `points` points of `binMin` minutes. */
  utilisation(binMin: number, points: number): UtilView {
    return this.util.view(Date.now(), binMin, points);
  }

  /** When the appetite last drained (wall ms; 0: not yet), the reference bot's world age then, and the last periodic save. */
  private appetiteAt = 0;
  private ageRef: { name: string; age: number } | null = null;
  private appetiteSaved = 0;
  private ageWarned = false;

  /**
   * Game minutes in a drain interval (the check's M4): the change in a bot's world age (the server's own ticks: a server
   * running slow at 2x drains less, as its crops grow less), else the wall time at the configured scale; an age that went
   * back, jumped (a rejoin) or nearly stopped falls back to the wall clock.
   */
  private gameMinutes(wallMs: number): number {
    const wall = (wallMs / 60000) * timeScale();
    const ref = [...this.agents.values()].find((a) => a.bot.entity && typeof a.bot.time?.age === 'number');
    const last = this.ageRef;
    this.ageRef = ref ? { name: ref.name, age: ref.bot.time.age } : null;
    if (!ref || !last || last.name !== ref.name) return wall;
    const game = (ref.bot.time.age - last.age) / 1200;
    if (game >= 0.25 * wall && game <= 2 * wall + 0.05) return game;
    if (!this.ageWarned && wall > 0) {
      this.ageWarned = true;
      console.log(`[food] world age moved ${game.toFixed(2)} game-min in ${(wallMs / 1000).toFixed(1)} s: draining by the wall clock (${timeScale()}x) when it does not follow it`);
    }
    return wall;
  }

  /**
   * The drain (D7; every 5 s from the world tick, off when MC_APPETITE is): each member of a complete village with a planted
   * wheat field loses appetite by game time, the full rate while busy (an action other than a meal running or queued), a
   * quarter idle. The interval is the tick's own, at most 15 s (the check's M3: never since a stored time, so a restart or a
   * long absence drains nothing extra). The village's record starts at its first drain; a member's entry at
   * MC_APPETITE_START. A state change is logged and saved, other changes saved at most once a minute.
   */
  private appetiteTick() {
    if (!APPETITE.rate) return;
    const now = Date.now();
    if (now - this.appetiteAt < 5000) return;
    const wallMs = this.appetiteAt ? Math.min(15000, now - this.appetiteAt) : 0;
    this.appetiteAt = now;
    const minutes = this.gameMinutes(wallMs);
    let changed = false, kept = false;
    const villages = new Map<string, Village>();
    for (const a of this.agents.values()) {
      const v = a.village();
      if (v) villages.set(v.name, v);
    }
    for (const v of villages.values()) {
      if (!v.complete || !(v.layouts ?? []).some((l) => (l.farm?.planted ?? 0) > 0)) continue;
      kept = true;
      if (!v.food) {
        v.food = { members: {}, made: {}, eaten: {}, meals: 0 };
        changed = true;
        console.log(`[food] ${v.name}: the appetite starts (${APPETITE.rate} a busy game-hour, ${APPETITE.rate * APPETITE.idle} idle; members start at ${APPETITE.start})`);
      }
      const store = storageContents(v);
      // (s39, MC_NEED_WORKS: what the members drain, counted as rate x minutes, never from levels, which stop at 0)
      let drained = 0;
      for (const a of this.growMembers(v)) {
        let e = v.food.members[a.name];
        if (!e) e = v.food.members[a.name] = { level: APPETITE.start, at: now, meals: 0, hungryMs: 0 };
        const was = stateOf(e.level);
        const running = a.current?.status.type ?? a.queue[0]?.type;
        const busy = !a.idle() && running !== 'eat_meal';
        drained += (minutes * (busy ? APPETITE.rate : APPETITE.rate * APPETITE.idle)) / 60;
        e.level = drain(e.level, minutes, busy);
        e.at = now;
        const s = stateOf(e.level);
        if (s === 'hungry') e.hungryMs = (e.hungryMs ?? 0) + wallMs;
        if (s !== was) {
          changed = true;
          console.log(`[food] ${a.name} ${s} (${e.level.toFixed(1)} of 20; storage ${foodText(store)})`);
        }
      }
      if (NEED_WORKS) {
        // (made: the rise of the ledger's finished food, in points; the first reading only sets where it stands)
        const seen = madePoints(v.food.made);
        const made = v.foodFlow?.madeSeen === undefined ? 0 : Math.max(0, seen - v.foodFlow.madeSeen);
        const flow = { ...addFlow(v.foodFlow, minutes, drained, made), madeSeen: seen };
        const reading = foodflowReading(flow, storedPoints(store));
        v.foodFlow = stepShort(flow, reading, minutes);
        if (!!v.foodFlow.short !== !!flow.short) {
          changed = true;
          console.log(`[needwork] ${v.name}: food ${v.foodFlow.short ? 'short' : 'no longer short'} (${reading?.text ?? 'no reading'}): bread and pie targets ${v.foodFlow.short ? 'raised' : 'back'}`);
        }
      }
    }
    if (changed || (kept && now - this.appetiteSaved >= 60000)) {
      this.appetiteSaved = now;
      this.villages.save();
    }
  }

  async spawn(rawName: string, o: SpawnOptions = {}): Promise<BotAgent> {
    const name = rawName.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);
    if (!name) throw new Error('invalid name');
    if (this.isAgent(name)) throw new Error(`agent ${name} already exists`);
    const brain = o.brain ?? null;
    if (brain && !MC_BRAINS[brain]) throw new Error(`unknown brain ${brain}. Options: ${Object.keys(MC_BRAINS).join(', ')}`);
    const a = new BotAgent(this, name, o.role ?? 'villager');
    this.agents.set(name.toLowerCase(), a);
    this.spawnedAt.set(name.toLowerCase(), Date.now());
    try {
      await a.ready;
    } catch (e) {
      this.agents.delete(name.toLowerCase());
      a.bot.quit();
      throw e;
    }
    if (o.reset) {
      for (const c of [`clear ${name}`, `effect clear ${name}`, `effect give ${name} minecraft:instant_health 1 10 true`, `effect give ${name} minecraft:saturation 1 10 true`, `xp set ${name} 0 levels`])
        await this.rcon.command(c);
      // Back to the world spawn (the server tells every bot where it is), on the surface
      const sp = a.bot.spawnPoint;
      if (!o.position && sp) o.position = { x: Math.floor(sp.x) + 0.5, z: Math.floor(sp.z) + 0.5 };
    }
    if (o.gamemode === 'creative' || o.gamemode === 'survival') await this.rcon.command(`gamemode ${o.gamemode} ${name}`);
    // (staged tests: real faster digging, MC_HASTE; after the reset's effect clear)
    if (hasteLevel()) await this.rcon.command(`effect give ${name} minecraft:haste infinite ${hasteLevel() - 1} true`);
    if (o.position) {
      // Without y, land on the highest block at x, z
      const { x, z } = o.position;
      if (o.position.y !== undefined) await this.rcon.command(`tp ${name} ${x} ${o.position.y} ${z}`);
      else {
        // spreadplayers refuses water ("Could not spread"), and the agent then stayed where its name last stood, 1,300
        // blocks away (Scout1, F105): the nearest dry land within 16, then 64 blocks, else dropped in from above
        let out = '';
        for (const r of [0, 16, 64]) {
          out = await this.rcon.command(`spreadplayers ${x} ${z} 0 ${Math.max(1, r)} false ${name}`);
          if (!/could not spread/i.test(out)) break;
        }
        if (/could not spread/i.test(out)) {
          console.log(`[spawn] ${name}: no dry land within 64 of ${x},${z}; dropped in from y 120`);
          await this.rcon.command(`tp ${name} ${x} 120 ${z}`);
        }
      }
      // Let the teleport arrive, then the chunks around the new place
      await new Promise((ok) => setTimeout(ok, 1000));
      await a.bot.waitForChunksToLoad();
    }
    if (o.memory) Object.assign(a.memory, o.memory);
    if (typeof a.memory.village === 'string' && a.memory.village) this.villages.ensure(a.memory.village);
    // (a fresh start empties the appetite too, s30's D6)
    const fresh = o.reset && APPETITE.rate ? a.village()?.food?.members[a.name] : undefined;
    if (fresh) {
      fresh.level = APPETITE.start;
      fresh.at = Date.now();
      // (saved now: the drain's periodic save may be a minute off, and a restart before it kept the old level, lens 1 L3)
      this.villages.save();
    }
    if (brain) {
      a.brain = MC_BRAINS[brain]();
      a.brain.init?.(a);
    }
    a.pushEvent('system', `You are ${name}, a ${a.role}. You just arrived in the world.`);
    // (the token budget's limit and shares follow the agent count, E.0)
    usage.setAgents(this.agents.size, [...this.agents.values()].filter((x) => x.role === 'mayor').map((x) => x.name));
    return a;
  }

  remove(name: string): boolean {
    const a = this.get(name);
    if (!a) return false;
    this.agents.delete(name.toLowerCase());
    a.quit();
    usage.setAgents(this.agents.size, [...this.agents.values()].filter((x) => x.role === 'mayor').map((x) => x.name));
    return true;
  }

  tick() {
    this.ticks++;
    // The task boards of the villages with agents here (E.0: the claim check only reads now): when one changed, and every
    // few seconds for what changes unsaved (what gatherers carry)
    const villages = new Set<Village>();
    for (const a of this.agents.values()) {
      const v = a.village();
      if (v) villages.add(v);
    }
    for (const v of villages)
      try {
        this.villages.tickBoard(v);
      } catch (e) {
        console.error(`[board] ${v.name}: refresh failed:`, e);
      }
    for (const a of this.agents.values()) {
      try {
        a.tick();
      } catch (e) {
        console.error(`[mc] ${a.name} tick failed:`, e);
      }
    }
    try {
      this.atlas.tick();
    } catch (e) {
      console.error('[atlas] tick failed:', e);
    }
    try {
      this.farmChores();
    } catch (e) {
      console.error('[farm] check failed:', e);
    }
    try {
      this.appetiteTick();
    } catch (e) {
      console.error('[food] appetite check failed:', e);
    }
    this.utilTick();
    try {
      this.endChoices();
    } catch (e) {
      console.error('[choice] end check failed:', e);
    }
    // Animals each bot can see, each bot about every 5 s (sightings for opportunistic farming, 10-08); one bot a tick in
    // turn (E.1), so 25 bots' passes over every recorded animal never land in one tick
    const bots = [...this.agents.values()], step = 5000 / Math.max(1, bots.length), now = Date.now();
    if (bots.length && now - this.animalsAt >= step) {
      // (stepped on from the last turn, not from now: at 25 bots a 200 ms step would drift to every 250 ms on 50 ms ticks)
      this.animalsAt = Math.max(this.animalsAt + step, now - step);
      const a = bots[this.animalsNext % bots.length];
      this.animalsNext = (this.animalsNext + 1) % bots.length;
      try {
        if (a.bot.entity) this.atlas.seen(a.name, a.bot.entity.position, Object.values(a.bot.entities));
      } catch (e) {
        console.error(`[atlas] ${a.name}'s animals:`, e);
      }
    }
  }

  private animalsAt = 0;
  /** The next bot in turn for the animal sightings. */
  private animalsNext = 0;

  private farmCheckAt = 0;

  /**
   * Ripe farms harvested (farming v2, 10-08, the user's choice: a chore, not a task on the board, so completion, the
   * mayor's wake-ups and the stop rules never see it): every 30 s, each planted field of a village with agents in the
   * world is read from the bots' view (ages are state ids); when 3/4 of its wheat (at least 4) is ripe, an idle worker
   * holding no task is given `harvest_farm`. Crops only grow near agents, so a field nobody has loaded is skipped. A
   * failed harvest waits 10 minutes before the next try. In a complete village the fields are options of its members'
   * menus instead (A.2, slotChores' sweep).
   */
  private farmChores() {
    const now = Date.now();
    if (now - this.farmCheckAt < 30000) return;
    this.farmCheckAt = now;
    const wheat = this.registry.blocksByName.wheat;
    if (!wheat) return;
    const villages = new Map<string, Village>();
    for (const a of this.agents.values()) {
      const v = a.village();
      if (v) villages.set(v.name, v);
    }
    for (const v of villages.values()) {
      // (a complete village's fields go on its members' menus: the sweep in slotChores, A.2)
      for (const [i, lay] of (v.complete ? [] : v.layouts ?? []).entries()) {
        const farm = lay.farm;
        const k = i + 1;
        if (!farm?.planted || harvesting.has(`${v.name}:${k}`)) continue;
        // (nothing ripe after all, the bots' view and the server apart: 2 minutes)
        if (farm.lastHarvest && !farm.lastHarvest.ok && now - farm.lastHarvest.at < (farm.lastHarvest.why === 'nothing ripe' ? 2 : 10) * 60000) continue;
        // Not while the planting is still to finish (it may be back on the board for seeds)
        if (v.tasks.some((t) => t.detail.startsWith(`tend_farm layout=${k} `) && (t.status === 'open' || t.status === 'claimed'))) continue;
        // (its ground prepared: a plot prepared in parts covers it only once its parts are done, S.6)
        const plot = preparedAt(v, farm);
        if (!plot) continue;
        let grown = 0, ripe = 0, unloaded = false;
        for (const [x, z] of farm.sow) {
          let s = -1;
          // (not a bot without an entity: dead, respawning or disconnected, its view may be stale)
          for (const a of this.agents.values()) if (a.bot.entity && (s = stateAt(a, x, plot.y + 1, z)) >= 0) break;
          if (s < 0) {
            unloaded = true;
            break;
          }
          if (s < wheat.minStateId || s > wheat.maxStateId) continue;
          grown++;
          if (s - wheat.minStateId >= 7) ripe++;
        }
        // (with neighbourhood farms a field of 1-3 plants is harvested once they are ripe, so harvest_farm sows its bare cells)
        if (unloaded || ripe < (GROW_FARMS ? Math.min(4, Math.max(1, grown)) : 4) || ripe < 0.75 * grown) continue;
        // Never ahead of the board's work: a worker between tasks would take the next one only after the harvest (F163's
        // pattern, the diff review)
        if (!v.complete && this.villages.claimable(v).length) continue;
        // (not while a pen's lure runs: the harvester holds seeds the chickens would follow, the pen review's L3)
        const busy = this.choreKeys(v);
        if (busy.has(`farm:${k}`) || busy.has('pen')) continue;
        const worker = this.idleWorker(v);
        if (!worker) continue;
        // (`chore`: the brains leave its events alone, as the mayor's gathering)
        this.setChore(v, worker, `farm:${k}`, [worker.enqueue('harvest_farm', { layout: k, chore: true })], `harvest the wheat on layout ${k}`);
        console.log(`[farm] ${v.name} layout ${k}: ${ripe} of ${grown} wheat ripe, ${worker.name} harvests`);
        this.villages.note(v, `${ripe} of ${grown} wheat ripe on layout ${k}'s farm: ${worker.name} harvests it (a chore)`);
      }
      // (before the sweep, which leaves members to the growth's chore and tasks, s30)
      try {
        if (v.initiatives?.length) this.initiativeTick(v);
      } catch (e) {
        console.error(`[initiative] ${v.name}: check failed:`, e);
      }
      try {
        if (HOUSING && v.complete) this.homeTick(v);
      } catch (e) {
        console.error(`[home] ${v.name}: check failed:`, e);
      }
      try {
        if (NEEDS_MODE !== 'off' && v.complete) this.needTick(v);
      } catch (e) {
        console.error(`[need] ${v.name}: check failed:`, e);
      }
      try {
        this.growTick(v);
      } catch (e) {
        console.error(`[grow] ${v.name}: check failed:`, e);
        // (and growth rests a while: the sweep's hold on the mayor must not outlive a check that keeps failing)
        this.growError.set(v.name, Date.now() + 10 * 60000);
      }
      this.slotChores(v);
    }
  }

  // ---- s30: a village that grows -----------------------------------------------------------------------------------------

  /** When this server first saw each village complete (the first growth waits GROW_WAIT_MS after it), by name. */
  private growSeen = new Map<string, number>();
  /** Villages this server has seen not complete: their completion happened here (the sweep's hold on the mayor, M1). */
  private growWatched = new Set<string>();
  /** The last "enough houses" line, by village (logged once per change of houses or members). */
  private growEnough = new Map<string, string>();
  /** Until when a village's growth rests after its check threw, by name. */
  private growError = new Map<string, number>();
  /** Checks in a row a growth task's holder was idle, on no chore, without its brain holding it, by "village|task". */
  private growOrphan = new Map<string, number>();

  /** Whether a village's growth chore is queued, running or not yet dropped (a pure read: no chore is dropped here). */
  private growQueued(v: Village, now: number): boolean {
    return this.heldKeys(v, now, 'sweep').has('grow') || [...this.chores.values()].some((c) => c.village === v.name && c.key === 'grow');
  }

  /**
   * Whether growth waits only for a free member (D2 but the agent): on, complete, no neighbourhood on the board, not
   * stopped or backing off, no growth chore, fewer houses than members. With `wait`, the first GROW_WAIT_MS after this
   * server first saw the village complete count too.
   */
  private growDue(v: Village, now: number, wait: boolean): boolean {
    const g = v.growth;
    if (!GROW.on || !v.complete || g?.active || g?.stop || (g?.backoff ?? 0) > now || (this.growError.get(v.name) ?? 0) > now) return false;
    // (N.2: growth's code trigger retired; a street of houses only when a member or a vote asked for one)
    if (HOUSING && !g?.request) return false;
    if (wait && now - (this.growSeen.get(v.name) ?? now) < GROW_WAIT_MS) return false;
    if (this.growQueued(v, now)) return false;
    // (and a worker whose brain takes board tasks: the mayor never does, and a layout nobody claims sat 10 minutes until
    // "stuck", three times over, s30's review)
    return (HOUSING ? this.homeless(v).length > 0 : housesOf(v) < this.growMembers(v).length) && this.growClaimers(v).length > 0;
  }

  /**
   * The growth decision (s30, D1-D2, D14; every 30 s from farmChores, before the sweep): a neighbourhood on the board is
   * watched to its end (growEnd); otherwise, once the village has stood complete GROW_WAIT_MS (a planner call in flight at
   * completion ends first; the golden check's sweeps fall inside it, L1) and has fewer houses than members, the mayor (else
   * the first idle member) gets the chore that lays out the next one. Code decides; no model is asked. A neighbourhood
   * inherited by a server running without MC_GROW is still watched to its end (its tasks stay claimable while it is on the
   * board: growing() does not read the flag), so it never stays on the board for good; no new one is laid out.
   */
  // ---------------------------------------------------------------------------------------------
  // The first vote: the next neighbourhood's style (spec runs/2026-10-16/s33/spec_vote1.md)
  // ---------------------------------------------------------------------------------------------

  /** Votes under way, by village: in memory only (a restart forgets one; growth then holds a new one, the critique's M6). */
  private voting = new Map<string, VoteRun>();

  /** MC_VOTE, else model when the village's members choose their chores by model (memory.choose), else predicted. */
  private voteMode(v: Village): VoteMode {
    if (VOTE_SETTING) return VOTE_SETTING;
    return this.growMembers(v).some((a) => this.chooseMode(a) === 'model') ? 'model' : 'predicted';
  }

  /** The style of a layout's houses: the biome all its vanilla small houses share; null when it has none, or drawn or mixed. */
  private layoutStyle(names: string[]): string | null {
    const b = new Set(names.filter(isDwelling).map((n) => /^(plains|desert|savanna|taiga|snowy)_small_house_\d+$/.exec(n)?.[1] ?? '?'));
    return b.size === 1 && !b.has('?') ? [...b][0] : null;
  }

  /** The village's current style: that of its last layout with houses (the critique's M7), null when not one vanilla style. */
  currentStyle(v: Village): string | null {
    for (const l of [...(v.layouts ?? [])].reverse()) if (l.buildings.some(isDwelling)) return this.layoutStyle(l.buildings);
    return null;
  }

  /**
   * The vote's options (spec 1, the critique's M5): the current style first, then each other biome with 2+ accepted small
   * houses whose bill's uncommon materials (not logs, cobblestone, sand or dirt) lie near home for a whole neighbourhood
   * (GROW.batch houses), counted from a member within 32 blocks of home (none there: such styles are left out); at most 4.
   */
  private styleOptions(v: Village, current: string): VoteOption[] {
    const built = (b: string) => (v.layouts ?? []).filter((l) => this.layoutStyle(l.buildings) === b).length;
    const cur = this.styleHouses(current);
    if (!cur.length) return [];
    const out: VoteOption[] = [styleOption(current, cur, built(current), true)];
    const home = villageHome(v);
    const y = v.plots[0]?.y ?? 64;
    const near = home ? this.growMembers(v).find((a) => a.bot.entity && Math.hypot(a.bot.entity.position.x - home.x, a.bot.entity.position.z - home.z) <= 32) : undefined;
    for (const b of Object.keys(STYLE_LOOK)) {
      if (b === current || out.length >= 4) continue;
      const hs = this.styleHouses(b);
      if (hs.length < 2) continue;
      const want: Record<string, number> = {};
      for (const h of hs) for (const [k, q] of Object.entries(h.gather)) if (!/(_log|^logs|^cobblestone|^sand|^dirt)$/.test(k)) want[k] = (want[k] ?? 0) + (q / hs.length) * GROW.batch;
      if (Object.keys(want).length) {
        const found = near && home ? this.materialsNear(near.name, want, home.x, y, home.z, 96) : null;
        if (!found || Object.entries(want).some(([k, q]) => (found[k] ?? 0) < Math.ceil(q))) {
          console.log(`[vote] ${v.name}: ${STYLE_LOOK[b].name} left off the ballot (${Object.entries(want).map(([k, q]) => `${Math.ceil(q)} ${k}`).join(', ')} wanted near home; ${found ? `found ${Object.entries(want).map(([k]) => found[k] ?? 0).join(', ')}` : 'no member near home to look'})`);
          continue;
        }
      }
      out.push(styleOption(b, hs, built(b), false));
    }
    return out;
  }

  /** What a voter sees of itself and the village (spec 3). */
  private voterContext(v: Village, a: BotAgent): { persona: string; pattern: string; self: string; village: string } {
    const mine = v.structures.filter((s) => s.builtBy === a.name).length;
    const styles = new Map<string, number>();
    for (const l of v.layouts ?? []) {
      const s = this.layoutStyle(l.buildings);
      if (s) styles.set(s, (styles.get(s) ?? 0) + 1);
    }
    const hoods = [...styles.entries()].map(([s, n]) => `${n} of ${(STYLE_LOOK[s]?.name ?? s).toLowerCase()}`).join(', ');
    return {
      persona: (typeof a.memory.persona === 'string' && a.memory.persona) || personaOf(a.name),
      pattern: this.patternLine(v, a),
      self: `You built ${mine} of the village's ${v.structures.length} buildings.`,
      village: `${v.name}, ${housesOf(v)} houses for ${this.growMembers(v).length} members; areas of houses: ${hoods || 'none of one style'}`,
    };
  }

  /**
   * The next neighbourhood's style (spec 2): a biome (its houses only; the current: the picks as before), null (no vote:
   * growth as before), or undefined (a vote under way: growth waits). The style decided stays in `growth.next` until its
   * layout is posted (lay_out_houses clears it, the critique's H1).
   */
  private styleFor(v: Village, now: number): string | null | undefined {
    const g = (v.growth ??= { past: [] });
    if (g.next) return g.next.style || null;
    const run = this.voting.get(v.name);
    if (run) return run.topic !== 'style' ? undefined : run.done || now - run.started >= VOTE_MAX_MS + 35000 ? this.closeVote(v, run, now) : undefined;
    const mode = this.voteMode(v);
    if (mode === 'off' || v.plan !== 'street') return null;
    const current = this.currentStyle(v);
    const options = current ? this.styleOptions(v, current) : [];
    if (options.length < 2) {
      g.next = { style: '', vote: 'none' };
      console.log(`[vote] ${v.name}: no style vote (${!current ? 'its houses are of no one vanilla style' : 'no other style buildable here'})`);
      return null;
    }
    const k = g.past.length + 1;
    const id = `${v.name}-n${k}-${now.toString(36)}`;
    const voters = this.growMembers(v).filter((a) => a.bot.entity);
    const r: VoteRun = { id, topic: 'style', k, options, started: now, mode, done: false, ballots: [], voters: voters.map((a) => a.name), ac: new AbortController() };
    this.voting.set(v.name, r);
    console.log(`[vote] ${v.name}: style vote ${id} for neighbourhood ${k} (${mode}, ${voters.length} voters): ${options.map((o) => `${o.name}${o.current ? ' (current)' : ''}`).join(', ')}`);
    const predicted = (name: string) => predictedChoice(temperament(name), options, `${id}|${name}`);
    if (mode === 'predicted') {
      r.ballots = voters.map((a) => predictedBallot(id, a.name, options, predicted(a.name)));
      return this.closeVote(v, r, now);
    }
    const reqs: BallotRequest[] = [];
    for (const a of voters) {
      const spec = parseSpec(typeof a.memory.chooseModel === 'string' ? a.memory.chooseModel : typeof a.memory.execModel === 'string' ? a.memory.execModel : CHOOSE.model);
      if (spec) reqs.push({ voteId: id, agent: a.name, spec, level: REASONING.ballot, options, predicted: predicted(a.name), ctx: this.voterContext(v, a), signal: r.ac.signal });
    }
    castAll(id, reqs, BALLOTS_PARALLEL, now + VOTE_MAX_MS, r.ballots).then(() => (r.done = true), (e) => {
      console.log(`[vote] ${v.name}: ballots failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      r.done = true;
    });
    return undefined;
  }

  /** The tally (spec 3): the record written, the style kept for the next neighbourhood; returns the winner. */
  private closeVote(v: Village, r: VoteRun, now: number): string {
    this.voting.delete(v.name);
    r.ac.abort();
    const ballots = [...r.ballots];
    for (const name of r.voters) if (!ballots.some((b) => b.agent === name)) ballots.push({ agent: name, choice: null, reason: '', why: 'late', predicted: null, shown: [], source: 'model' });
    const t = tally(r.id, r.options, ballots);
    // (a work vote with no ballot cast starts nothing nobody chose: a rest, the review's 5)
    if (r.topic === 'work' && !ballots.some((b) => b.choice)) t.winner = PROJECT_NONE;
    const rec: VoteRecord = {
      id: r.id, topic: r.topic, k: r.k, at: r.started, mode: r.mode, options: r.options.map((o) => ({ id: o.id, name: o.name, facts: o.facts })),
      ballots, tally: t.tally, winner: t.winner, ...(t.tie ? { tie: t.tie } : {}), closedAt: now,
    };
    v.votes = [...(v.votes ?? []), rec].slice(-20);
    const g = (v.growth ??= { past: [] });
    // (X.2: a public work's vote decides the next work, '' for "no new work"; the style vote the next neighbourhood's style)
    if (r.topic === 'work') g.work = { piece: t.winner === PROJECT_NONE ? '' : t.winner, vote: r.id, at: now };
    else g.next = { style: t.winner, vote: r.id };
    const what = r.topic === 'work' ? `public work ${r.k}` : `neighbourhood ${r.k}`;
    const name = (id: string) => r.options.find((o) => o.id === id)?.name ?? id;
    for (const b of ballots) console.log(`[ballot] ${v.name}: ${b.agent} -> ${b.choice ? name(b.choice) : `none (${b.why ?? '?'})`} (predicted ${b.predicted ? name(b.predicted) : '-'}${b.position ? `, shown ${b.position} of ${b.shown.length}` : ''}): ${b.reason.replace(/\s+/g, ' ').slice(0, 160)}`);
    const cast = ballots.filter((b) => b.choice), agree = cast.filter((b) => b.choice === b.predicted).length;
    const counts = r.options.map((o) => `${o.name} ${t.tally[o.id]}`).join(', ');
    console.log(`[vote] ${v.name}: ${name(t.winner)} wins for ${what} (${counts})${t.tie ? `, a tie drawn among ${t.tie.map(name).join(', ')}` : ''}; ${cast.length} of ${ballots.length} ballots cast, ${agree} as their temperament predicts; ${Math.round((now - r.started) / 1000)} s`);
    this.villages.note(v, `the village voted ${name(t.winner)} for ${what} (${counts})`);
    this.villages.save();
    return t.winner;
  }

  private growTick(v: Village) {
    if (!GROW.on && !PROJECTS_ON && !v.growth?.active) return;
    const now = Date.now();
    if (!v.complete) {
      this.growWatched.add(v.name);
      this.growSeen.delete(v.name);
      return;
    }
    if (!this.growSeen.has(v.name)) this.growSeen.set(v.name, now);
    if (now - this.growSeen.get(v.name)! < GROW_WAIT_MS) return;
    // (a check that threw rests the growth, the neighbourhood's end included: a record it cannot read is not read again
    // every 30 s)
    if ((this.growError.get(v.name) ?? 0) > now) return;
    // A vote ended or overdue is closed here, whatever its topic: a member joining or leaving mid-vote moves growTick to
    // the other topic's path, which never closed it (the X.2 review's H1)
    const run = this.voting.get(v.name);
    if (run && (run.done || now - run.started >= VOTE_MAX_MS + 35000)) this.closeVote(v, run, now);
    // (s40, MC_NEED_WORKS: a field work beside growth and the vote, its own gate)
    if (NEED_WORKS) this.fieldTick(v, now);
    if (v.growth?.active) return this.growEnd(v, now);
    if (HOUSING) this.homeRequestAge(v, now);
    if (!GROW.on || !this.growDue(v, now, true)) {
      if (GROW.on) {
        const M = this.growMembers(v).length, H = housesOf(v);
        const sig = H >= M ? `${H}|${M}` : !this.growClaimers(v).length ? `none|${H}|${M}` : '';
        if (sig && !v.growth?.stop && this.growEnough.get(v.name) !== sig) {
          this.growEnough.set(v.name, sig);
          console.log(H >= M ? `[grow] ${v.name}: enough houses (${H} for ${M} members)` : `[grow] ${v.name}: no worker here takes board tasks (houses ${H} for ${M} members)`);
        }
      }
      // X.2: a public work when growth has nothing to do
      if (PROJECTS_ON) this.projectTick(v, now);
      return;
    }
    this.growEnough.delete(v.name);
    // The next neighbourhood's style (spec_vote1): a vote under way holds the growth
    const style = this.styleFor(v, now);
    if (style === undefined) return;
    const members = this.growMembers(v);
    // (never a hungry member: it takes food work only, s30's D12)
    const fed = (a: BotAgent) => this.hungerOf(v, a) !== 'hungry';
    // (N.2: the member who asked for the street lays it out while it is idle, s37)
    const asker = HOUSING ? members.find((a) => a.name === v.growth?.request?.by && this.isIdleMember(v, a, now) && fed(a)) : undefined;
    const agent = asker ?? members.find((a) => a.memory.villageRole === 'mayor' && this.isIdleMember(v, a, now) && fed(a)) ?? this.idleMembers(v, now).find(fed);
    if (!agent) return;
    this.layOutNext(v, agent, style, now);
  }

  /** growTick's tail (s37: also a street of houses a member starts, H3): the next neighbourhood's houses and pad, and the
   *  lay_out_houses chore for `agent`; `meta`/`opt` when a member chose it from its menu. */
  private layOutNext(v: Village, agent: BotAgent, style: string | null, now: number, meta?: ChoiceMeta, opt?: ChoiceOption) {
    void now;
    const members = this.growMembers(v);
    const n = Math.min(GROW.batch, HOUSING ? this.homeless(v).length : members.length - housesOf(v));
    if (n < 1) return;
    const holds = opt?.holds ?? [];
    const lib = this.vanillaLibrary(v.vanillaBiome ?? 'plains')?.houses ?? null;
    // (a style voted in: its houses only, the current one too: as before, a won "current" savanna drew the village's own
    // plains library, Vm; no vote: the picks as before)
    const only = style ? this.styleHouses(style).map((h) => h.design) : undefined;
    const pick = pickHouses(v, n, lib, (d) => this.materialTasks(d, d.name).units ?? 0, only);
    const styled = style ? { style } : {};
    // With neighbourhood farms (s30's D2): the pad ladder, fields where the biome allows one (the village's library biome,
    // else the biome the agent's view has at home: a staged village has no library biome, lens 2 L5), and not once a
    // neighbourhood's field was refused for the biome (that holds for the village: a field-sized pad for no field took the
    // room of the squares growth needs, lens 2 L4; thin grass does not hold: harvests fill the seed stock it is judged by,
    // the food fix review's second Medium)
    const home = GROW_FARMS ? villageHome(v) : null;
    const biome = (v.vanillaBiome ?? (home ? biomeAt(agent, home.x, v.plots[0]?.y ?? agent.bot.entity?.position.y ?? 64, home.z) : '')).toLowerCase();
    const barren = (v.layouts ?? []).some((l) => l.grow && /biome/.test(l.farmWhy ?? ''));
    if (GROW_FARMS && pick.length && !NO_FIELD_BIOME.test(biome) && !barren) {
      const ladder = padLadder(pick.map((h) => v.designs[h]));
      if (!ladder.length) return this.growStop(v, 'no house design');
      const options = ladder.map((o) => `${o.size}:${o.n}:${o.slots}`).join(',');
      let st: ActionStatus;
      try {
        st = agent.enqueue('lay_out_houses', { chore: true, houses: pick.join(','), options, ...styled });
      } catch (e) {
        console.log(`[grow] ${v.name}: lay_out_houses not queued for ${agent.name}: ${(e as Error).message}`);
        return;
      }
      this.setChore(v, agent, 'grow', [st], `lay out ${ladder[0].n} house${ladder[0].n > 1 ? 's' : ''}`, (why) => this.growFailed(v, agent.name, why), meta, holds, opt);
      console.log(`[grow] ${v.name}: ${agent.name} lays out up to ${ladder[0].n} houses (${pick.join(', ')}) on the first of ${ladder.map((o) => `${o.size}x${o.size}/${o.n}/${o.slots < 0 ? 'no field' : `field+${o.slots}`}`).join(', ')}; houses ${housesOf(v)} for ${members.length} members`);
      return;
    }
    const pad = pick.length ? padFor(pick.map((h) => v.designs[h])) : null;
    if (!pad) return this.growStop(v, 'no house design');
    const houses = pick.slice(0, pad.n);
    let st: ActionStatus;
    try {
      st = agent.enqueue('lay_out_houses', { chore: true, houses: houses.join(','), size: pad.size, ...styled });
    } catch (e) {
      console.log(`[grow] ${v.name}: lay_out_houses not queued for ${agent.name}: ${(e as Error).message}`);
      return;
    }
    this.setChore(v, agent, 'grow', [st], `lay out ${houses.length} house${houses.length > 1 ? 's' : ''}`, (why) => this.growFailed(v, agent.name, why), meta, holds, opt);
    console.log(`[grow] ${v.name}: ${agent.name} lays out ${houses.length} houses (${houses.join(', ')}) on ${pad.size}x${pad.size}; houses ${housesOf(v)} for ${members.length} members`);
  }

  // ---- N.2: owned houses (MC_HOUSING; spec runs/2026-10-18/s37/spec_batch_n2.md H) ---------------------------------------

  /** When each owned Build task was first asked about as claimable (H7's hold), by "village|task id"; in memory. */
  private homeReady = new Map<string, number>();

  /** The village's members in the order houses are given out (H2): the Mayor, workers by number (agentNames.ts), other
   *  names alphabetical after. */
  private homeOrder(v: Village): BotAgent[] {
    const key = (a: BotAgent): [number, number, string] => {
      const n = a.name.toLowerCase(), w = workerNumber(n);
      return n === 'mayor' ? [0, 0, n] : w ? [1, w, n] : [2, 0, n];
    };
    return this.growMembers(v).sort((p, q) => {
      const x = key(p), y = key(q);
      return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
    });
  }

  /** A member's home (H1): the dwelling it owns, else the Build task of its house (not failed: being built, or built and
   *  not yet marked on its structure). */
  private homeOf(v: Village, name: string): Structure | Task | undefined {
    return v.structures.find((s) => s.owner === name && isDwelling(s.kind))
      ?? v.tasks.find((t) => t.owner === name && /^Build /.test(t.title) && t.status !== 'failed');
  }

  /** The members without a home (H1), in homeOrder. */
  private homeless(v: Village): BotAgent[] {
    return this.homeOrder(v).filter((a) => !this.homeOf(v, a.name));
  }

  /** A Build task's centre (its build_design x= z=). */
  private static taskXZ(t: Task): { x: number; z: number } | null {
    const m = /\bx=(-?\d+) z=(-?\d+)/.exec(t.detail);
    return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
  }

  /** A house's name sign says whose it is (H2, H5): its text before it goes up, rewritten by RCON once up (text is free,
   *  as put_up_signs' own rewrite). */
  private houseSign(v: Village, building: string, at: (s: { cx: number; cz: number }) => boolean, name: string) {
    for (const l of v.layouts ?? []) for (const s of l.signs ?? []) {
      if (s.building !== building || !at(s)) continue;
      // (the neighbourhood's name on the third line kept, #10)
      const text = [`${name}'s`, 'house', ...s.text.slice(2)];
      if (s.text.join('|') === text.join('|')) return;
      s.text = text;
      this.villages.save();
      if (s.up && s.y !== undefined) {
        const nbt = `{front_text:{messages:[${[0, 1, 2, 3].map((i) => JSON.stringify(text[i] ?? '')).join(',')}]}}`;
        this.rcon.command(`data merge block ${s.x} ${s.y} ${s.z} ${nbt}`).catch((e: Error) => console.log(`[home] ${v.name}: ${name}'s sign at ${s.x},${s.y},${s.z} not rewritten: ${e.message}`));
      }
      return;
    }
  }

  /** A request for a street that has waited 15 minutes with no layout posted is dropped (H4). */
  private homeRequestAge(v: Village, now: number) {
    const r = v.growth?.request;
    if (!r || now - r.at < HOME_REQUEST_MS || this.growQueued(v, now)) return;
    delete v.growth!.request;
    this.villages.save();
    console.log(`[home] ${v.name}: ${r.by === 'vote' ? 'the vote\'s' : `${r.by}'s`} street of houses dropped: no layout in ${Math.round(HOME_REQUEST_MS / 60000)} min${v.growth?.stop ? ` (growth stopped: ${v.growth.stop})` : (v.growth?.backoff ?? 0) > now ? ' (growth backing off)' : ''}`);
  }

  /** A member's street of houses (H3): laid out now by `agent` when growth can (true), else left to growTick (a style
   *  vote under way, a back-off). */
  private homeLayout(v: Village, agent: BotAgent, now: number, meta?: ChoiceMeta, opt?: ChoiceOption): boolean {
    if (!this.growDue(v, now, false)) return false;
    const style = this.styleFor(v, now);
    if (style === undefined) return false;
    this.layOutNext(v, agent, style, now, meta, opt);
    return this.growQueued(v, now);
  }

  /**
   * Every farm tick with MC_HOUSING (H2, H5, H6): a houseless member moves into an unowned standing house; a new
   * neighbourhood's Build tasks get their owners (the asker first) and their signs the owners' names; a built house is
   * marked on its structure; a Build task that failed for good frees its owner.
   */
  private homeTick(v: Village) {
    if (!v.complete) return;
    let changed = false;
    // Built or failed: the owner's house marked on its structure, or the owner freed
    for (const t of v.tasks) {
      if (!t.owner || !/^Build /.test(t.title)) continue;
      if (t.status === 'failed' && !t.soft) {
        console.log(`[home] ${v.name}: ${t.owner}'s house (${t.id}) failed: ${t.owner} has no house again`);
        this.villages.note(v, `${t.owner}'s house (${t.id}) could not be built`);
        delete t.owner;
        changed = true;
        continue;
      }
      if (t.status !== 'done') continue;
      const c = MineflayerWorld.taskXZ(t);
      const st = c && v.structures.find((s) => isDwelling(s.kind) && c.x >= s.x1 && c.x <= s.x2 && c.z >= s.z1 && c.z <= s.z2);
      if (st && st.owner === t.owner) continue;
      if (!st || st.owner) {
        // (no house of its own at its spot: the owner is not housed by it, the safety review's L5)
        console.log(`[home] ${v.name}: ${t.owner}'s house (${t.id}) is done but ${st ? `${st.owner} owns the house there` : 'no house stands at its spot'}: ${t.owner} has no house again`);
        delete t.owner;
        changed = true;
        continue;
      }
      st.owner = t.owner;
      changed = true;
      console.log(`[home] ${v.name}: ${t.owner}'s house stands (${st.kind} ${st.id} at ${Math.round((st.x1 + st.x2) / 2)},${Math.round((st.z1 + st.z2) / 2)})`);
      this.villages.note(v, `${t.owner}'s house stands at ${Math.round((st.x1 + st.x2) / 2)},${Math.round((st.z1 + st.z2) / 2)}`);
    }
    // A new neighbourhood's houses: owners in board order, the asker first, then the houseless in homeOrder
    const g = v.growth;
    const act = g?.active;
    if (act && !act.project) {
      const builds = act.builds.map((id) => v.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t && t.status !== 'failed');
      if (builds.length && builds.every((t) => !t.owner) && !act.owned) {
        const queue = this.homeless(v).map((a) => a.name);
        const asker = g!.request?.by;
        if (asker && queue.includes(asker)) queue.splice(queue.indexOf(asker), 1), queue.unshift(asker);
        const given: string[] = [];
        for (const t of builds) {
          const who = queue.shift();
          if (!who) break;
          t.owner = who;
          given.push(`${who} (${t.id})`);
          const c = MineflayerWorld.taskXZ(t);
          const design = /build_design "([^"]+)"/.exec(t.detail)?.[1];
          if (c && design) this.houseSign(v, design, (s) => s.cx === c.x && s.cz === c.z, who);
        }
        act.owned = true;
        if (g!.request) delete g!.request;
        changed = true;
        console.log(`[home] ${v.name}: neighbourhood ${act.k}'s houses for ${given.join(', ') || 'nobody (no member without a house)'}`);
        if (given.length) this.villages.note(v, `neighbourhood ${act.k}'s houses are for ${given.map((x) => x.replace(/ \(.*/, '')).join(', ')}`);
      }
    }
    // Standing houses nobody owns, to the houseless (nearest the village's home first)
    const free = v.structures.filter((s) => isDwelling(s.kind) && !s.owner && !(act && !act.project && act.plot && s.x1 >= act.plot.x1 && s.x2 <= act.plot.x2 && s.z1 >= act.plot.z1 && s.z2 <= act.plot.z2));
    if (free.length) {
      const home = villageHome(v);
      const d = (s: Structure) => (home ? Math.hypot((s.x1 + s.x2) / 2 - home.x, (s.z1 + s.z2) / 2 - home.z) : 0);
      free.sort((p, q) => d(p) - d(q));
      for (const a of this.homeless(v)) {
        const st = free.shift();
        if (!st) break;
        st.owner = a.name;
        changed = true;
        const cx = Math.round((st.x1 + st.x2) / 2), cz = Math.round((st.z1 + st.z2) / 2);
        this.houseSign(v, st.kind, (s) => s.cx >= st.x1 && s.cx <= st.x2 && s.cz >= st.z1 && s.cz <= st.z2, a.name);
        console.log(`[home] ${v.name}: ${a.name} moves into ${st.kind} (${st.id}) at ${cx},${cz}`);
        this.villages.note(v, `${a.name} moves into the house at ${cx},${cz}`);
      }
    }
    if (changed) this.villages.save();
  }

  /** When each owned house's furnish or light option was first held back for its owner, by "village|option id". */
  private ownDecorSeen = new Map<string, number>();

  /** H8 (after the spec check's M2): another member's house is held for its owner while the owner is in the world, for
   *  OWN_DECOR_MS from the first time it was held; then anyone may help. */
  private ownDecorHeld(v: Village, id: string, owner: string, now: number): boolean {
    const o = this.agents.get(owner.toLowerCase());
    if (!o?.bot.entity || o.village() !== v) return false;
    const k = `${v.name}|${id}`;
    if (!this.ownDecorSeen.has(k)) this.ownDecorSeen.set(k, now);
    return now - this.ownDecorSeen.get(k)! < OWN_DECOR_MS;
  }

  /** The owner of a building part's structure when it is a dwelling (H8; read from the record: parts are cached). */
  private houseOwner(v: Village, st: Structure): string | undefined {
    const s = v.structures.find((x) => x.id === st.id) ?? st;
    return s.owner && isDwelling(s.kind) ? s.owner : undefined;
  }

  /**
   * H7: a Build task owned by another member is left to its owner for OWNER_FIRST_MS from when it was first asked about
   * as claimable, while the owner is in the world, takes board tasks and is not hungry (others may help after that).
   */
  private ownerFirst(v: Village, agent: WorldAgent, task: Task): boolean {
    if (!task.owner || task.owner === agent.name || !/^Build /.test(task.title)) return false;
    const o = this.agents.get(task.owner.toLowerCase());
    if (!o?.bot.entity || o.village() !== v || o.memory.villageRole === 'mayor' || !o.brain?.claimsTasks?.(o) || this.hungerOf(v, o) === 'hungry') return false;
    // (only while the owner is free to take it: an owner on a long chore held its house for nothing, the spec check's M3)
    if (!this.isIdleMember(v, o, Date.now())) return false;
    const k = `${v.name}|${task.id}`, now = Date.now();
    if (!this.homeReady.has(k)) this.homeReady.set(k, now);
    return now - this.homeReady.get(k)! < OWNER_FIRST_MS;
  }

  // ---- X.2: public works, voted (spec runs/2026-10-16/s34/spec_x2.md) --------------------------------------------------

  /** The pool, once a process: every biome's non-dwelling vanilla pieces that pass the survival test (the vanilla
   *  library's: placeable, no problems, a landmark's units and smelts) and fit a pad; null when the jar cannot be read. */
  private works: Array<{ biome: string; design: Design; units: number; volume: number; gather: Counts; size: number }> | null | undefined;

  publicWorks(): NonNullable<MineflayerWorld['works']> {
    if (this.works !== undefined) return this.works ?? [];
    const out: NonNullable<MineflayerWorld['works']> = [];
    try {
      const jar = vanillaJar();
      for (const biome of VILLAGE_BIOMES)
        for (const path of listPieces(jar, biome, 'houses')) {
          const name = path.split('/').pop()!;
          if (isDwelling(name)) continue;
          let d: Design;
          try {
            d = pieceToDesign(readPiece(path, jar), biome).design;
          } catch {
            continue;
          }
          if (!validateDesign({ ...d } as unknown as Record<string, unknown>, 'vanilla', { isPlaceable: (b) => this.isPlaceable(b), states: true, requireDoor: true }).design) continue;
          const m = this.materialTasks(d, d.name);
          if (m.problems.length || (m.units ?? 0) > LANDMARK_UNITS || (m.smelts ?? 0) > MAX_SMELTS) continue;
          const pad = padFor([d]);
          if (!pad) continue;
          const gather: Counts = {};
          for (const [n, q] of Object.entries(this.materials.plan(designBill(d)).gather)) gather[n] = q;
          out.push({ biome, design: d, units: m.units ?? 0, volume: d.width * d.depth * d.height, gather, size: pad.size });
        }
      this.works = out;
      console.log(`[work] ${out.length} public works in the pool (${VILLAGE_BIOMES.map((b) => `${b} ${out.filter((w) => w.biome === b).length}`).join(', ')})`);
    } catch (e) {
      console.warn(`[work] cannot read the public works: ${(e as Error).message}`);
      this.works = null;
    }
    return this.works ?? [];
  }

  /**
   * A public work vote's options (spec_x2 3): pieces not built here nor refused before, the village's biome first then
   * by cost, one of a kind (a library, a toolsmith...), their uncommon materials near home (as styleOptions), at most 3;
   * then the status quo, "no new public work for now", unless it won the last work vote: it may win once in a row (three
   * works split the builders' votes, and the easy-going's "none" won every predicted vote, 13 of 25).
   */
  private projectOptions(v: Village): VoteOption[] {
    const g = v.growth ?? { past: [] };
    const built = new Set([...v.structures.map((s) => s.kind), ...(v.layouts ?? []).flatMap((l) => l.buildings)]);
    const bad = new Set(g.projectBad ?? []);
    const own = v.vanillaBiome ? villageBiome(v.vanillaBiome) : this.currentStyle(v) ?? 'plains';
    const kindOf = workKind;
    const home = villageHome(v);
    const y = v.plots[0]?.y ?? 64;
    const near = home ? this.growMembers(v).find((a) => a.bot.entity && Math.hypot(a.bot.entity.position.x - home.x, a.bot.entity.position.z - home.z) <= 32) : undefined;
    const cands = this.publicWorks().filter((w) => !built.has(w.design.name) && !bad.has(w.design.name))
      .sort((p, q) => Number(q.biome === own) - Number(p.biome === own) || p.units - q.units || p.design.name.localeCompare(q.design.name));
    const out: VoteOption[] = [];
    const kinds = new Set<string>();
    for (const w of cands) {
      if (out.length >= 3) break;
      const kind = kindOf(w.design.name);
      if (kinds.has(kind)) continue;
      const want: Counts = {};
      for (const [k, q] of Object.entries(w.gather)) if (!/(_log|^any:logs|^logs|cobblestone|^sand|^dirt)$/.test(k)) want[k] = q;
      if (Object.keys(want).length) {
        const found = near && home ? this.materialsNear(near.name, want, home.x, y, home.z, 96) : null;
        if (!found || Object.entries(want).some(([k, q]) => (found[k] ?? 0) < Math.ceil(q))) continue;
      }
      // (with the quarter it leads: its companions' uncommon materials checked the same way, X.2 part 2a)
      const q = this.quarterOf(v, w.design.name);
      if (!q) continue;
      const others: Counts = {};
      for (const c of q.pieces.slice(1)) for (const [k, n] of Object.entries(c.gather)) if (!/(_log|^any:logs|^logs|cobblestone|^sand|^dirt)$/.test(k)) others[k] = (others[k] ?? 0) + n;
      if (Object.keys(others).length) {
        const found = near && home ? this.materialsNear(near.name, others, home.x, y, home.z, 96) : null;
        if (!found || Object.entries(others).some(([k, n]) => (found[k] ?? 0) < Math.ceil(n))) continue;
      }
      kinds.add(kind);
      const words = kind.replace(/_/g, ' ');
      const rest = q.pieces.slice(1).map((c) => workKind(c.design.name).replace(/_/g, ' '));
      const gather: Counts = {};
      for (const c of q.pieces) for (const [k, n] of Object.entries(c.gather)) gather[k] = (gather[k] ?? 0) + n;
      const main = Object.entries(gather).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `~${Math.round(n)} ${k.replace(/^any:/, '').replace(/_/g, ' ')}`).join(', ');
      out.push({
        id: w.design.name, name: rest.length ? `A ${words}'s quarter (${w.biome})` : `A ${words} (${w.biome})`,
        facts: `${rest.length ? `a ${words}${rest.length > 1 ? `, a ${rest.slice(0, -1).join(', a ')} and a ${rest[rest.length - 1]}` : ` and a ${rest[0]}`}` : `a ${w.design.width}x${w.design.depth} ${words}`} in the ${w.biome} look on one street; ~${q.units} units to gather (${main}); then furnished and lit`.slice(0, 200),
        current: false, novel: true, units: q.units, volume: q.pieces.reduce((s, c) => s + c.volume, 0),
      });
    }
    // (N.2: a street of houses for the members without one, H9)
    if (HOUSING) {
      const without = this.homeless(v).length, M = this.growMembers(v).length;
      // (only when growth could lay it out, and costed as houses: units 0 won every predicted ballot, the review's M2)
      const n = Math.min(GROW.batch, without);
      if (without >= 2 && GROW.on && !g.stop && this.growClaimers(v).length) out.push({ id: PROJECT_HOUSES, name: 'A street of houses for members without one', facts: `${without} of ${M} members have no house; up to ${GROW.batch} houses near the village, each with its owner's name on its sign`, current: false, novel: false, units: Math.round(n * HOUSE_UNITS * 0.6), volume: n * 300 });
    }
    // (s39's farmstead is no option here since s40: it is laid out beside the vote, projectTick, so it wins no vote a
    // public work would have)
    const rested = !!g.work && !g.work.piece;
    if (out.length && !rested) out.push({ id: PROJECT_NONE, name: 'No new public work for now', facts: 'members stay free for farms, pens and the workshop; the question comes back in a few minutes', current: true, novel: false, units: 0, volume: 0 });
    return out;
  }

  /**
   * A public work's quarter (X.2 part 2a): the voted piece and up to QUARTER - 1 companions of its biome, the cheapest
   * not built here nor refused, each of a kind no other piece of it has, at most one over a house's budget (postLayout's
   * village rule), on the smallest pad that places them (padFor drops the last until they fit). A lone piece built in
   * 1.5-3.5 min and the rests and gaps filled the rest of each cycle (F241). null when the lead is not in the pool.
   */
  quarterOf(v: Village, lead: string): { pieces: Array<NonNullable<MineflayerWorld['works']>[number]>; size: number; units: number } | null {
    const pool = this.publicWorks(), L = pool.find((w) => w.design.name === lead);
    if (!L) return null;
    const g = v.growth ?? { past: [] };
    const built = new Set([...v.structures.map((s) => s.kind), ...(v.layouts ?? []).flatMap((l) => l.buildings)]);
    const bad = new Set(g.projectBad ?? []);
    const pieces = [L];
    const kinds = new Set([workKind(L.design.name)]);
    let big = L.units > HOUSE_UNITS ? 1 : 0;
    for (const w of pool.filter((x) => x.biome === L.biome && x.design.name !== lead && !built.has(x.design.name) && !bad.has(x.design.name)).sort((p, q) => p.units - q.units || p.design.name.localeCompare(q.design.name))) {
      if (pieces.length >= QUARTER) break;
      if (kinds.has(workKind(w.design.name)) || (w.units > HOUSE_UNITS && big)) continue;
      pieces.push(w);
      kinds.add(workKind(w.design.name));
      if (w.units > HOUSE_UNITS) big++;
    }
    // (no larger than the room a failed survey left: companions dropped until the pad fits, F243)
    const room = g.workRoom ?? Infinity;
    let pad = padFor(pieces.map((w) => w.design));
    while (pad && pad.size > room && pieces.length > 1) {
      pieces.pop();
      pad = padFor(pieces.map((w) => w.design));
    }
    if (!pad || pad.size > room) return null;
    const kept = pieces.slice(0, pad.n);
    return { pieces: kept, size: pad.size, units: kept.reduce((s, w) => s + w.units, 0) };
  }

  /** Whether a public work may start now (spec_x2 2): growth has nothing to do, nothing on the board or queued, a worker
   *  takes board tasks, a minute after the last layout ended, growth's back-off and failure rules. */
  private projectDue(v: Village, now: number): boolean {
    const g = v.growth;
    if (!PROJECTS_ON || !v.complete || g?.active || (g?.backoff ?? 0) > now || (g?.projectBackoff ?? 0) > now || (g?.projectFails ?? 0) >= 3 || (this.growError.get(v.name) ?? 0) > now) return false;
    // (growth's stop for want of room or after failures holds projects too; one for want of house designs does not)
    if (g?.stop && !/house design/.test(g.stop)) return false;
    if (this.growQueued(v, now)) return false;
    if (GROW.on && !HOUSING && !g?.stop && housesOf(v) < this.growMembers(v).length) return false;
    // (N.2: houses are voluntary now; a street asked for goes first, and while members without a house have started one in
    // the last HOME_FIRST_MS (from completion on) no work vote cuts in: the spec check's M4, H9)
    if (HOUSING && g?.request) return false;
    if (HOUSING && this.homeless(v).length) {
      const last = Math.max(g?.active?.at ?? 0, g?.past?.[g.past.length - 1]?.end ?? 0, this.growSeen.get(v.name) ?? 0);
      if (now - last < HOME_FIRST_MS) return false;
    }
    const last = g?.past?.[g.past.length - 1];
    if (last && now - last.end < 60000) return false;
    return this.growClaimers(v).length > 0;
  }

  /** The next public work (as styleFor): a piece, null (none now: "no new work" won lately, or nothing buildable), or
   *  undefined (a vote under way). With MC_VOTE off, code's first option. */
  private projectFor(v: Village, now: number): string | null | undefined {
    const g = (v.growth ??= { past: [] });
    if (g.work?.piece) return g.work.piece;
    const run = this.voting.get(v.name);
    if (run) {
      if (run.topic !== 'work') return undefined;
      if (!run.done && now - run.started < VOTE_MAX_MS + 35000) return undefined;
      const w = this.closeVote(v, run, now);
      return w === PROJECT_NONE ? null : w;
    }
    if (g.work && !g.work.piece && now - g.work.at < PROJECT_REST_MS) return null;
    // (nothing buildable found lately on the same buildings and refusals: not searched again for 5 minutes, the review's 4)
    const noneSig = `${v.structures.length}|${(v.layouts ?? []).length}|${g.projectBad?.length ?? 0}|${g.workRoom ?? ''}`, none = this.workNone.get(v.name);
    if (none && none.sig === noneSig && none.until > now) return null;
    const options = this.projectOptions(v);
    if (!options.some((o) => o.id !== PROJECT_NONE) || (options.length < 2 && options[0]?.id === PROJECT_NONE)) {
      if (this.workLogged.get(v.name) !== 'none') console.log(`[work] ${v.name}: no public work buildable here (pool ${this.publicWorks().length}, refused ${g.projectBad?.length ?? 0})`);
      this.workLogged.set(v.name, 'none');
      this.workNone.set(v.name, { sig: noneSig, until: now + 5 * 60000 });
      return null;
    }
    this.workLogged.delete(v.name);
    // (each work vote its own number: a rest and the vote after it were both "public work 1", the review's 6)
    const k = (v.votes ?? []).filter((x) => x.topic === 'work').length + 1;
    const mode = this.voteMode(v);
    if (mode === 'off') {
      g.work = { piece: options[0].id, vote: 'none', at: now };
      return options[0].id;
    }
    const id = `${v.name}-w${k}-${now.toString(36)}`;
    const voters = this.growMembers(v).filter((a) => a.bot.entity);
    const r: VoteRun = { id, topic: 'work', k, options, started: now, mode, done: false, ballots: [], voters: voters.map((a) => a.name), ac: new AbortController() };
    this.voting.set(v.name, r);
    console.log(`[vote] ${v.name}: public work vote ${id} (${mode}, ${voters.length} voters): ${options.map((o) => o.name).join(', ')}`);
    const predicted = (name: string) => predictedChoice(temperament(name), options, `${id}|${name}`);
    if (mode === 'predicted') {
      r.ballots = voters.map((a) => predictedBallot(id, a.name, options, predicted(a.name)));
      const w = this.closeVote(v, r, now);
      return w === PROJECT_NONE ? null : w;
    }
    const reqs: BallotRequest[] = [];
    for (const a of voters) {
      const spec = parseSpec(typeof a.memory.chooseModel === 'string' ? a.memory.chooseModel : typeof a.memory.execModel === 'string' ? a.memory.execModel : CHOOSE.model);
      if (spec) reqs.push({ voteId: id, agent: a.name, spec, level: REASONING.ballot, options, predicted: predicted(a.name), ctx: this.voterContext(v, a), signal: r.ac.signal, topic: 'work' });
    }
    castAll(id, reqs, BALLOTS_PARALLEL, now + VOTE_MAX_MS, r.ballots).then(() => (r.done = true), (e) => {
      console.log(`[vote] ${v.name}: ballots failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      r.done = true;
    });
    return undefined;
  }

  /** What public works last logged, by village (once a change); when "nothing buildable" was last found, and on what. */
  private workLogged = new Map<string, string>();
  private workNone = new Map<string, { sig: string; until: number }>();

  /**
   * A public work's layout chore failed (the review's 3): its piece is never offered again and projects alone back off
   * (5 min a failure in a row, stopping after 3): growth's own counters, "no site" answers and stop stay its own.
   */
  private projectFailed(v: Village, piece: string, why: string) {
    if (why === 'cancelled') return;
    const g = (v.growth ??= { past: [] });
    // No free square of that size: the land's fault, not the piece's; later works ask for smaller pads (F243)
    const noSite = /^lay_out_houses: no free (\d+)x\d+ site/.exec(why);
    if (noSite) {
      g.workRoom = Math.min(g.workRoom ?? Infinity, Number(noSite[1]) - 1);
      delete g.work;
      g.projectBackoff = Date.now() + 2 * 60000;
      this.villages.save();
      console.log(`[work] ${v.name}: no room for the public work ${piece} (${why.slice(0, 120)}); works now ask for pads up to ${g.workRoom}x${g.workRoom}`);
      return;
    }
    g.projectBad = [...new Set([...(g.projectBad ?? []), piece])];
    delete g.work;
    g.projectFails = (g.projectFails ?? 0) + 1;
    g.projectBackoff = Date.now() + 5 * 60000 * g.projectFails;
    this.villages.save();
    console.log(`[work] ${v.name}: the public work ${piece} could not be laid out (${why.slice(0, 160)}); not offered again; projects rest ${5 * g.projectFails} min`);
  }

  /** A public work from vote to layout (spec_x2 5): the piece's design into the village's, its pad, the layout chore. */
  private projectTick(v: Village, now: number) {
    if (!this.projectDue(v, now)) return;
    // (s40, MC_NEED_WORKS: a farmstead due is laid out beside the vote, before the next one opens; one voted or under way
    // goes first. In s39 it was a vote option and won votes the larger quarters would have, Won2's busy 17% vs 20%)
    // (s40: behind MC_NEED_FARMSTEAD since the field works, which fit where it cannot)
    if (FARMSTEAD_ON && !this.voting.get(v.name) && !v.growth?.work?.piece && this.farmsteadPlan(v)) return this.layOutFarmstead(v, now);
    const piece = this.projectFor(v, now);
    if (!piece) return;
    const g = (v.growth ??= { past: [] });
    if (piece === PROJECT_HOUSES) {
      g.request = { by: 'vote', at: now, ...(g.work?.vote ? { vote: g.work.vote } : {}) };
      delete g.work;
      this.villages.save();
      console.log(`[home] ${v.name}: the village voted for a street of houses (${this.homeless(v).length} members without one)`);
      return;
    }
    if (piece === PROJECT_FARMSTEAD) return this.layOutFarmstead(v, now);
    const q = this.quarterOf(v, piece);
    const w = q?.pieces[0];
    if (!q || !w) {
      g.projectBad = [...new Set([...(g.projectBad ?? []), piece])];
      delete g.work;
      this.villages.save();
      return;
    }
    const fed = (a: BotAgent) => this.hungerOf(v, a) !== 'hungry';
    const agent = this.growMembers(v).find((a) => a.memory.villageRole === 'mayor' && this.isIdleMember(v, a, now) && fed(a)) ?? this.idleMembers(v, now).find(fed);
    if (!agent) return;
    for (const c of q.pieces) if (!v.designs[c.design.name]) v.designs[c.design.name] = structuredClone(c.design);
    const names = q.pieces.map((c) => c.design.name);
    let st: ActionStatus;
    try {
      st = agent.enqueue('lay_out_houses', { chore: true, houses: names.join(','), size: q.size, project: piece });
    } catch (e) {
      console.log(`[work] ${v.name}: lay_out_houses not queued for ${agent.name}: ${(e as Error).message}`);
      return;
    }
    this.setChore(v, agent, 'grow', [st], `lay out the public work ${piece}`, (why) => this.projectFailed(v, piece, why));
    console.log(`[work] ${v.name}: ${agent.name} lays out the public work ${piece}${names.length > 1 ? ` with ${names.slice(1).join(', ')}` : ''} (${q.units} units) on ${q.size}x${q.size}`);
  }

  /**
   * s39 tier 3 (MC_NEED_WORKS; spec_needworks_v2 B3): what a farmstead would be now, or null with the reason logged once
   * a change: the food flow short for the hold, no farm slot left to start (the slots answer first), none under way, the
   * cooldown since the last; its house the first small house growth would pick, on the pad padFor sizes for a field and
   * two slots.
   */
  private farmsteadPlan(v: Village): { house: string; size: number; units: number; why: string } | null {
    if (!NEED_WORKS || !appetiteOn(v)) return null;
    const free = this.freeFarmSlots(v);
    const underWay = v.growth?.active?.project === PROJECT_FARMSTEAD || this.voting.get(v.name)?.options.some((o) => o.id === PROJECT_FARMSTEAD) === true;
    const due = farmsteadDue(v.foodFlow, free, underWay);
    const log = (why: string) => {
      if (this.farmsteadLogged.get(v.name) !== why) console.log(`[needwork] ${v.name}: no farmstead offered (${why})`);
      this.farmsteadLogged.set(v.name, why);
    };
    if (!due.due) {
      if (v.foodFlow?.short) log(due.why);
      return null;
    }
    const lib = this.vanillaLibrary(v.vanillaBiome ?? 'plains')?.houses ?? null;
    const pick = pickHouses(v, 1, lib, (d) => this.materialTasks(d, d.name).units ?? 0);
    const pad = pick.length ? padFor([v.designs[pick[0]]].filter(Boolean), 2) : null;
    if (!pad) {
      log('no small house design');
      return null;
    }
    this.farmsteadLogged.set(v.name, '');
    const r = foodflowReading(v.foodFlow, storedPoints(storageContents(v)));
    return { house: pick[0], size: pad.size, units: Math.round(HOUSE_UNITS * 0.6), why: r?.text ?? 'food short' };
  }

  /** Farm slots the menus could start now (the slots answer first): with neighbourhood farms off a slot takes only a kind
   *  no other slot farms, so none once all are farmed; none while the menus said "nothing seen to farm" (s39's Won). */
  private freeFarmSlots(v: Village): number {
    const layouts = v.layouts ?? [];
    const farmed = new Set(layouts.flatMap((l) => (l.slots ?? []).map((q) => q.kind)).filter(Boolean));
    const startable = GROW_FARMS || farmed.size < SLOT_ORDER.length;
    const why = this.startSeen.get(v.name);
    const menuCan = !why || /^(busy|free slots taken)$/.test(why);
    return startable && menuCan ? layouts.flatMap((l) => l.slots ?? []).filter((q) => !q.annex && !q.kind && (q.tries ?? 0) < 3).length : 0;
  }

  /**
   * s40 (MC_NEED_WORKS; runs/2026-10-20/s40/spec_fields_v1.md and its check): the food flow's answer once no farm slot is
   * left, a wheat field on its own 9x9 pad (lay_out_field), by an idle fed member (the Mayor first), beside growth and the
   * vote: its own gate and back-off (projectDue's held it during every neighbourhood and after public works' failures, the
   * check's 6), never while a growth chore is queued. A field laid out but not sown (seeds short) is planted first.
   */
  private fieldTick(v: Village, now: number) {
    if (!appetiteOn(v) || !v.complete || (this.fieldBackoff.get(v.name) ?? 0) > now) return;
    if ([...this.chores.values()].some((c) => c.village === v.name && (c.key === 'grow:field' || c.key === 'grow'))) return;
    const layouts = v.layouts ?? [];
    const fields = layouts.filter((l) => l.field).length;
    if (this.fieldCount.get(v.name) !== fields) {
      this.fieldCount.set(v.name, fields);
      this.fieldFails.delete(v.name);
    }
    const fed = (a: BotAgent) => this.hungerOf(v, a) !== 'hungry';
    const pick = () => this.growMembers(v).find((a) => a.memory.villageRole === 'mayor' && this.isIdleMember(v, a, now) && fed(a)) ?? this.idleMembers(v, now).find(fed);
    const failed = (what: string) => (why: string) => {
      if (why === 'cancelled') return;
      const n = (this.fieldFails.get(v.name) ?? 0) + 1;
      this.fieldFails.set(v.name, n);
      // ("no site": the land is full, looked for again in 20 minutes; any other failure 5 minutes a failure in a row, to 30)
      const min = /no free \d+x\d+ site/.test(why) ? 20 : Math.min(30, 5 * n);
      this.fieldBackoff.set(v.name, Date.now() + min * 60000);
      console.log(`[needwork] ${v.name}: ${what} failed (${why.slice(0, 160)}); fields rest ${min} min`);
    };
    // (a field not sown yet: planted again, as its own chore)
    const k = layouts.findIndex((l) => l.field && l.farm && !l.farm.planted && preparedAt(v, l.farm)) + 1;
    if (k > 0) {
      const agent = pick();
      if (!agent) return;
      let st: ActionStatus;
      try {
        st = agent.enqueue('tend_farm', { chore: true, layout: k });
      } catch (e) {
        console.log(`[needwork] ${v.name}: tend_farm not queued for ${agent.name}: ${(e as Error).message}`);
        return;
      }
      this.setChore(v, agent, 'grow:field', [st], 'plant a wheat field', failed(`planting the field of layout ${k}`));
      console.log(`[needwork] ${v.name}: ${agent.name} plants the field of layout ${k}`);
      return;
    }
    const due = fieldDue(v.foodFlow, this.freeFarmSlots(v), false);
    if (!due.due) {
      if (v.foodFlow?.short && this.fieldLogged.get(v.name) !== due.why) console.log(`[needwork] ${v.name}: no field laid out (${due.why})`);
      this.fieldLogged.set(v.name, due.why);
      return;
    }
    const agent = pick();
    if (!agent) return;
    let st: ActionStatus;
    try {
      st = agent.enqueue('lay_out_field', { chore: true });
    } catch (e) {
      console.log(`[needwork] ${v.name}: lay_out_field not queued for ${agent.name}: ${(e as Error).message}`);
      return;
    }
    this.fieldLogged.set(v.name, '');
    this.setChore(v, agent, 'grow:field', [st], 'lay out a wheat field', failed('the field'));
    if (v.foodFlow) v.foodFlow.sinceField = 0;
    this.villages.save();
    const r = foodflowReading(v.foodFlow, storedPoints(storageContents(v)));
    console.log(`[needwork] ${v.name}: ${agent.name} lays out a wheat field (field ${fields + 1}): ${r?.text ?? 'food short'}`);
  }

  private fieldBackoff = new Map<string, number>();
  private fieldFails = new Map<string, number>();
  private fieldCount = new Map<string, number>();
  private fieldLogged = new Map<string, string>();

  private farmsteadLogged = new Map<string, string>();
  /** The last menu's word on starting a farm slot, by village: '' when one was offered, else the reason none was. */
  private startSeen = new Map<string, string>();

  /** A farmstead to layout (beside the vote since s40): the neighbourhood path with one house, a field and two slots (public work's rules). */
  private layOutFarmstead(v: Village, now: number) {
    const g = (v.growth ??= { past: [] });
    const fs = this.farmsteadPlan(v);
    // (the vote's record, g.work, is the vote's own: a farmstead beside it leaves it be, s40)
    if (!fs) return;
    const fed = (a: BotAgent) => this.hungerOf(v, a) !== 'hungry';
    const agent = this.growMembers(v).find((a) => a.memory.villageRole === 'mayor' && this.isIdleMember(v, a, now) && fed(a)) ?? this.idleMembers(v, now).find(fed);
    if (!agent) return;
    let st: ActionStatus;
    try {
      st = agent.enqueue('lay_out_houses', { chore: true, houses: fs.house, options: `${fs.size}:1:2`, project: PROJECT_FARMSTEAD });
    } catch (e) {
      console.log(`[needwork] ${v.name}: lay_out_houses not queued for ${agent.name}: ${(e as Error).message}`);
      return;
    }
    // (a failure backs off as a public work's, but a farmstead is never refused for good: the land's fault, not the work's)
    this.setChore(v, agent, 'grow', [st], 'lay out a farmstead', (why) => {
      if (why === 'cancelled') return;
      g.projectFails = (g.projectFails ?? 0) + 1;
      g.projectBackoff = Date.now() + 5 * 60000 * g.projectFails;
      this.villages.save();
      console.log(`[needwork] ${v.name}: the farmstead could not be laid out (${why.slice(0, 160)}); projects rest ${5 * g.projectFails} min`);
    });
    if (v.foodFlow) v.foodFlow.sinceFarmstead = 0;
    this.villages.save();
    console.log(`[needwork] ${v.name}: ${agent.name} lays out a farmstead (${fs.house}, field + 2 slots) on ${fs.size}x${fs.size}: ${fs.why}`);
  }

  // ---- s35: initiatives, small works members start and help with (spec runs/2026-10-18/s35/spec_initiatives_v2.md) --------

  /** Areas a small work keeps off (every village's buildings with a ring, streets, lamps, signs, farms, slots, the side
   *  plots, the mine, door fronts, reservations, other initiatives' spots); cached on a signature of what they come from. */
  private smallBlockedCache = new Map<string, { sig: string; blocked: Area[]; plots: Array<Area & { y: number }> }>();

  private smallBlocked(v: Village): { blocked: Area[]; plots: Array<Area & { y: number }> } {
    const now = Date.now();
    const res = v.reservations.filter((q) => q.until > now);
    const sig = JSON.stringify([v.structures.length, (v.layouts ?? []).length, (v.layouts ?? []).map((l) => [l.lamps?.length, l.signs?.length, l.slots?.length, !!l.farm]), v.plots.length,
      (v.initiatives ?? []).map((i) => `${i.id}:${i.state}:${i.pending ? 'p' : ''}`), res.map((q) => `${q.x1},${q.z1},${q.x2},${q.z2}`)]);
    const old = this.smallBlockedCache.get(v.name);
    if (old?.sig === sig) return old;
    const pad = (q: Area, n: number): Area => ({ x1: q.x1 - n, z1: q.z1 - n, x2: q.x2 + n, z2: q.z2 + n });
    const cell = (x: number, z: number, n = 0): Area => ({ x1: x - n, z1: z - n, x2: x + n, z2: z + n });
    const blocked: Area[] = [];
    for (const o of this.villages.villages.values()) for (const st of o.structures) blocked.push(pad(st, 1));
    for (const l of v.layouts ?? []) {
      for (const st of l.streets ?? []) blocked.push(st);
      for (const lp of l.lamps ?? []) blocked.push(cell(lp.x, lp.z, 1));
      for (const sg of l.signs ?? []) blocked.push(cell(sg.x, sg.z, 1));
      if (l.farm) blocked.push(pad(l.farm, 1));
      for (const sl of l.slots ?? []) blocked.push(pad(sl, 1));
      for (const side of [l.annex, l.works]) if (side && side.x2 >= side.x1) blocked.push(pad(side, 1));
    }
    if (v.mine) blocked.push(...mineAreas(v.mine).map((q) => pad(q, 1)));
    // (three cells out from every building's door: the way in stays clear)
    for (const P of this.lightParts(v)) {
      const door = P.kind === 'building' && P.place ? placedDoor(P.place) : null;
      if (door) for (let k = 0; k <= 3; k++) blocked.push(cell(door.x + door.ox * k, door.z + door.oz * k, 1));
    }
    for (const q of res) blocked.push(q);
    for (const i of v.initiatives ?? []) if (i.state === 'open' && !i.pending) {
      const k = SMALL_WORKS.find((x) => x.kind === i.kind);
      const d = k ? v.designs[i.design] : undefined;
      const w = d?.width ?? 7, dd = d?.depth ?? 7;
      blocked.push(pad({ x1: i.x - Math.floor(w / 2), z1: i.z - Math.floor(dd / 2), x2: i.x - Math.floor(w / 2) + w - 1, z2: i.z - Math.floor(dd / 2) + dd - 1 }, 2));
    }
    // (a green waits for its own initiative's spot before others may use it, s36's review)
    const waiting = new Set((v.initiatives ?? []).filter((i) => i.state === 'open' && i.pending).map((i) => i.id));
    const plots = v.plots.filter((q) => !q.annex && !q.works && !q.parts && !(q.green && waiting.has(q.green))).map((q) => ({ x1: q.x1, z1: q.z1, x2: q.x2, z2: q.z2, y: q.y }));
    const entry = { sig, blocked, plots };
    this.smallBlockedCache.set(v.name, entry);
    return entry;
  }

  /** A free spot for a small work (pure): one of the first spots smallWorkSpots finds, chosen by `seed` so members spread. */
  private smallWorkSpot(v: Village, k: SmallWorkKind, wood: string, seed: string): { x: number; y: number; z: number } | null {
    const d = k.make(wood);
    const { blocked, plots } = this.smallBlocked(v);
    const spots = smallWorkSpots({ plots, blocked }, d.width, d.depth, 8);
    if (!spots.length) return null;
    return spots[fnv1a(`${seed}|${k.kind}`) % spots.length];
  }

  /**
   * An open initiative's next step (s35): build once the spare storage covers its bill (one builder), else gather its
   * largest missing raw material that gathering can bring (logs, cobblestone from a free mine face, sand), up to
   * INITIATIVE_GATHERERS at once; null when nothing can be taken now.
   */
  initiativeStep(v: Village, it: Pick<Initiative, 'id' | 'design' | 'pending'>, spare: Counts, busy: Set<string>, design?: Design): InitiativeStep | null {
    // (no spot yet: its green first, one preparer, s36)
    if (it.pending) return busy.has(`initiative:${it.id}:prepare`) || v.plots.some((p) => p.green === it.id) ? null : { what: 'prepare' };
    const d = design ?? v.designs[it.design];
    if (!d) return null;
    if ([...busy].some((k) => k.startsWith(`initiative:${it.id}:build`))) return null;
    // (built already, before initiativeTick has marked it: no second build onto it, s36)
    const at = it as Partial<Initiative>;
    if (at.x !== undefined && at.z !== undefined && v.structures.some((st) => st.kind === d.name && at.x! >= st.x1 && at.x! <= st.x2 && at.z! >= st.z1 && at.z! <= st.z2)) return null;
    const wood = this.catalogWoodOf(v);
    // (against what its crew has gathered, not the spare storage: initiatives gather their own, the user's, s36)
    void spare;
    const gather = this.materials.plan(inWood(designBill(d), wood), (it as Partial<Initiative>).gathered ?? {}).gather;
    const left = Object.entries(gather).filter(([, q]) => q > 0);
    if (!left.length) return [...busy].some((k) => k.startsWith(`initiative:${it.id}:`)) ? null : { what: 'build' };
    if ([1, 2].slice(0, INITIATIVE_GATHERERS).every((n) => busy.has(`initiative:${it.id}:${n}`))) return null;
    const mat = (n: string): Material | null => (n === 'any:logs' || /_log$/.test(n) ? 'logs' : /^(red_)?sand$/.test(n) ? 'sand' : /^(any:)?cobblestone$/.test(n) ? 'cobblestone' : null);
    for (const [n, q] of left.sort((x, y) => y[1] - x[1])) {
      const m = mat(n);
      if (!m) continue;
      if (m === 'cobblestone' && !mineCanGive(v, 'cobblestone')) continue;
      if (m === 'sand' && v.unavailable?.includes('sand')) continue;
      const spec = GATHER_KINDS[m];
      return { what: 'gather', material: m, amount: Math.min(spec.trip, Math.max(4, Math.ceil(q))), block: spec.block(v.wood ?? v.catalogWood), deposit: spec.deposit(v.wood) };
    }
    return null;
  }

  /** One step queued as a chore: a gathering trip into storage, or the build (build_design at its spot). */
  private runInitiativeStep(v: Village, worker: BotAgent, it: Initiative, step: InitiativeStep, opt: ChoiceOption, meta: ChoiceMeta | undefined) {
    const k = SMALL_WORKS.find((x) => x.kind === it.kind);
    // (the step's own key held too: an initiator's first step runs under its initiate key, and a help option for the same
    // step must not be offered beside it, in this sweep or later; s36)
    const stepKey = `initiative:${it.id}:${step.what === 'gather' ? 1 : step.what}`;
    if (!opt.key.startsWith(`initiative:${it.id}:`) && !opt.holds.some((h) => h.startsWith(`initiative:${it.id}:`))) {
      opt = { ...opt, holds: [...opt.holds, stepKey] };
      this.sweepCtx?.busy.add(stepKey);
      this.sweepCtx?.first?.busy.add(stepKey);
    }
    it.steps.push({ agent: worker.name, what: step.what === 'gather' ? `gather ${step.amount} ${step.material}` : step.what, at: Date.now() });
    this.villages.save();
    if (step.what === 'prepare') {
      const st = worker.enqueue('prepare_green', { initiative: it.id, size: GREEN_SIZE, chore: true });
      const failed = (why: string) => {
        if (why === 'cancelled' || st.code) return;
        it.fails = (it.fails ?? 0) + 1;
        it.backoff = Date.now() + 10 * 60000;
        // (three tries: a first "no level ground" may be unloaded chunks, s36's review M2)
        if (it.fails >= 3) this.endInitiative(v, it, 'failed', `its green could not be prepared (${why.slice(0, 120)})`);
        this.villages.save();
      };
      this.setChore(v, worker, opt.key, [st], `prepare a green for ${it.id} (${k?.words ?? it.kind})`, failed, meta, opt.holds, opt);
      console.log(`[initiative] ${v.name}: ${worker.name} prepares a green for ${it.id} (${it.by}'s ${k?.words ?? it.kind})`);
      return;
    }
    if (step.what === 'build') {
      const st = worker.enqueue('build_design', { design: it.design, x: it.x, z: it.z, chore: true });
      const failed = (why: string) => {
        if (why === 'cancelled' || st.code) return;
        it.fails = (it.fails ?? 0) + 1;
        it.backoff = Date.now() + 10 * 60000;
        if (it.fails >= 3) this.endInitiative(v, it, 'failed', `the build failed 3 times (${why.slice(0, 120)})`);
        this.villages.save();
      };
      this.setChore(v, worker, opt.key, [st], `build ${it.id} (${k?.words ?? it.kind})`, failed, meta, opt.holds, opt);
      console.log(`[initiative] ${v.name}: ${worker.name} builds ${it.id} (${it.by}'s ${k?.words ?? it.kind}) at ${it.x},${it.z}`);
      return;
    }
    const collect = worker.enqueue('collect', { block: step.block, count: step.amount, chore: true });
    const deposit = worker.enqueue('deposit', { item: step.deposit, also: GATHER_ALSO, chore: true });
    const failed = (why: string) => {
      if (why === 'cancelled' || collect.code || deposit.code) return;
      if (deposit.state === 'done' && depositedOf(deposit.message ?? '', step.material) > 0) return;
      it.backoff = Date.now() + 5 * 60000;
    };
    this.setChore(v, worker, opt.key, [collect, deposit], `gather ${step.amount} ${step.material} for ${it.id}`, failed, meta, opt.holds, opt);
    // (judged by its deposit as gathering is: a partial collect whose load landed is a success, s36)
    const c = this.chores.get(worker.name.toLowerCase());
    if (c) c.choice.initiative = { id: it.id, material: step.material, n: step.amount };
    console.log(`[initiative] ${v.name}: ${worker.name} gathers ${step.amount} ${step.material} for ${it.id} (${it.by}'s ${k?.words ?? it.kind})`);
  }

  /** An initiative ended: the record, a note, a line with its crew. */
  private endInitiative(v: Village, it: Initiative, state: 'built' | 'failed' | 'lapsed', why: string) {
    it.state = state;
    it.end = Date.now();
    it.why = why;
    this.villages.note(v, `${it.by}'s ${it.kind} (${it.id}) ${state}: ${why}; crew ${it.crew.join(', ')}`);
    this.villages.save();
    console.log(`[initiative] ${v.name}: ${it.id} ${state} in ${((it.end - it.at) / 60000).toFixed(1)} min (${why}); started by ${it.by}, crew ${it.crew.join(', ')}; ${it.steps.length} steps`);
  }

  /** A signpost that stands shows its neighbourhood's name (#10; build_design puts it up blank): once, by RCON, its sign
   *  in the post's column (the design's centre) found by trying the heights over the spot. */
  private nameSignpost(v: Village, it: Initiative) {
    const text = signpostText(v, it.x, it.z);
    it.text = text;
    this.villages.save();
    const nbt = `{front_text:{messages:[${[0, 1, 2, 3].map((i) => JSON.stringify(text[i] ?? '')).join(',')}]},is_waxed:1b}`;
    void (async () => {
      for (let y = it.y; y <= it.y + 5; y++)
        if (/^Modified/i.test(await this.rcon.command(`data merge block ${it.x} ${y} ${it.z} ${nbt}`).catch(() => ''))) return console.log(`[initiative] ${v.name}: ${it.id}'s signpost reads "${text.join(' / ')}"`);
      console.log(`[initiative] ${v.name}: ${it.id}'s signpost at ${it.x},${it.z}: no sign found to write "${text.join(' / ')}" on`);
    })();
  }

  /** Every farm tick: an open initiative whose design stands at its spot is built (judged by the structure, lesson 138);
   *  one with no step taken for INITIATIVE_LAPSE_MS lapses. */
  private initiativeTick(v: Village) {
    const now = Date.now();
    for (const it of v.initiatives ?? []) {
      if (it.state === 'built' && it.kind === 'signpost' && !it.text) this.nameSignpost(v, it);
      if (it.state !== 'open') continue;
      // (a green ready: the spot on it, s36)
      if (it.pending) {
        const green = v.plots.find((p) => p.green === it.id);
        const k = SMALL_WORKS.find((x) => x.kind === it.kind);
        const d = v.designs[it.design];
        if (green && k && d) {
          // (its own green's reservation is not in the way: prepare_green holds it until prepareSite has deposited the
          // felled logs, after the plot is recorded; N1m's i5 failed on it, s36)
          const own = `prepare a green for ${it.id}`;
          const blocked = this.smallBlocked(v).blocked.filter((q) => (q as { purpose?: string }).purpose !== own);
          const spot = smallWorkSpots({ plots: [{ x1: green.x1, z1: green.z1, x2: green.x2, z2: green.z2, y: green.y }], blocked }, d.width, d.depth, 1)[0];
          // (and no verdict while its preparer is still at work)
          if (!spot && this.choreKeys(v).has(`initiative:${it.id}:prepare`)) continue;
          if (!spot) {
            this.endInitiative(v, it, 'failed', `no spot for it on its green at ${green.x1},${green.z1}`);
            continue;
          }
          Object.assign(it, { x: spot.x, y: spot.y, z: spot.z });
          delete it.pending;
          this.villages.save();
          console.log(`[initiative] ${v.name}: ${it.id}'s green is ready: its ${k.words} goes at ${spot.x},${spot.y},${spot.z}`);
        }
      }
      if (!it.pending && v.structures.some((st) => st.kind === it.design && it.x >= st.x1 && it.x <= st.x2 && it.z >= st.z1 && it.z <= st.z2)) {
        this.endInitiative(v, it, 'built', 'it stands');
        continue;
      }
      const last = Math.max(it.at, ...it.steps.map((q) => q.at));
      // (not while its green is being prepared: a slow preparer must not let a second green open, s36's review L2)
      if (it.pending && now - last > INITIATIVE_LAPSE_MS && this.choreKeys(v).has(`initiative:${it.id}:prepare`)) continue;
      if (now - last > INITIATIVE_LAPSE_MS) this.endInitiative(v, it, 'lapsed', `no step for ${Math.round(INITIATIVE_LAPSE_MS / 60000)} min`);
    }
  }

  /** N.1: the furniture the village wants, read once a menu for needOf (s36's review L1). */
  private needDemand(v: Village): Counts {
    return CHOOSE.families.has('furnish') ? this.decorDemand(v) : {};
  }

  /** N.1: the need an option answers, directly or by making what answers it (spec_needs_v2 B), or null. */
  private needOf(v: Village, o: { kind: ChoiceKind; id: string }, demand: Counts): NeedKind | null {
    if (o.kind === 'light' || o.id === 'make:torch') return 'light';
    if (o.kind === 'grow') return 'housing';
    if (o.kind === 'furnish' || (o.kind === 'make' && (demand[o.id.slice(5)] ?? 0) > 0)) return 'furnish';
    if (appetiteOn(v) && isFoodKind(o.kind, o)) return 'food';
    return null;
  }

  /** N.1: what the last sweep's menus showed of each need, for the next needTick: offered to an idle member, taken, or
   *  none offered with the direct kind's reason. */
  private needSeen = new Map<string, { offered: Set<NeedKind>; taken: Set<NeedKind>; blocked: Map<NeedKind, string> }>();
  private needAt = new Map<string, number>();
  private needReadings = new Map<string, NeedReading[]>();

  /** N.1: a sweep's menu and pick noted for the needs (show and on). */
  private needNote(v: Village, menu?: ChoiceMenu, ran?: ChoiceOption) {
    if (NEEDS_MODE === 'off') return;
    const seen = this.needSeen.get(v.name) ?? { offered: new Set(), taken: new Set(), blocked: new Map() };
    this.needSeen.set(v.name, seen);
    // (taken: an option that answers it ran, by either chooser, noted by runOption)
    const demand = this.needDemand(v);
    const t = ran && this.needOf(v, ran, demand);
    if (t) seen.taken.add(t);
    if (!menu) return;
    for (const o of menu.options) {
      const k = this.needOf(v, o, demand);
      if (k) seen.offered.add(k);
    }
    // (s39: whether a free farm slot could be started, as the menu says: a slot no kind can be found for answers nothing)
    if (NEED_WORKS) this.startSeen.set(v.name, menu.options.some((o) => o.kind === 'start') ? '' : menu.reasons.start ?? '');
    const direct: Array<[NeedKind, ChoiceKind]> = [['light', 'light'], ['furnish', 'furnish'], ['food', 'eat'], ...(HOUSING ? [['housing', 'grow'] as [NeedKind, ChoiceKind]] : [])];
    for (const [k, kind] of direct) {
      const why = menu.reasons[kind];
      // (busy: another member is on it; hungry: this member's menu only; neither blocks the need)
      // (nor a housed member's "has a house", nor a street under way: the review's L3)
      if (why && !NOT_BLOCKING.has(why) && !seen.blocked.has(k)) seen.blocked.set(k, why);
    }
  }

  /** N.1: a village's needs read and stepped, once per NEED_TICK_MS, whether or not anyone is idle (spec_needs_v2 B);
   *  `[need]` on a status change. Never from choices() or a menu (board_golden, the purity check). */
  private needTick(v: Village) {
    const now = Date.now();
    const last = this.needAt.get(v.name);
    if (last !== undefined && now - last < NEED_TICK_MS) return;
    this.needAt.set(v.name, now);
    const members = this.growMembers(v);
    const lights = this.lightParts(v).filter((p) => p.kind === 'building');
    const decor = CHOOSE.families.has('furnish') ? this.decorParts(v) : [];
    const faces = v.mine ? mineFaces(v, (n) => this.agents.has(n.toLowerCase())) : null;
    const readings = readNeeds({
      members: members.length,
      // (N.2: members housed, a house being built for them included, H10)
      houses: HOUSING ? members.length - this.homeless(v).length : housesOf(v),
      ...(lights.length ? { unlit: lights.reduce((s, p) => s + p.unlit, 0), spots: lights.reduce((s, p) => s + p.spots.length, 0), unlitParts: lights.filter((p) => p.unlit > 0).length } : {}),
      ...(decor.length ? { openDecor: decor.reduce((s, p) => s + p.open.length, 0), decorSpots: decor.reduce((s, p) => s + p.spots.length, 0), openDecorParts: decor.filter((p) => p.open.length).length } : {}),
      ...(appetiteOn(v) ? { hungry: members.filter((a) => stateOf(v.food!.members[a.name]?.level ?? 20) !== 'fed').length } : {}),
      // (s37 S1: slots used of the hut's, not chest spots: "9 of 9" had half its slots free)
      ...(v.storageHut ? (() => { const st = storageSlots(v, this.registry as never); return { slots: st.used, slotCap: st.cap, chests: st.chests, chestSpots: st.spots }; })() : {}),
      ...(faces && faces.faces ? { mineHeld: faces.held, mineFaces: faces.faces } : {}),
      ...(v.mine && !mineCanGive(v, 'cobblestone') ? { mineBlocked: 'it gives no stone' } : {}),
    });
    // (s39, MC_NEED_WORKS: the food flow, its level the net drain's share; answered by targets, slots and a farmstead)
    if (NEED_WORKS && appetiteOn(v)) {
      const fr = foodflowReading(v.foodFlow, storedPoints(storageContents(v)));
      if (fr) readings.push({ kind: 'foodflow', level: fr.level, amount: Math.round(fr.level * 100), text: fr.text.slice(0, 80) });
    }
    // (s40, F256: the mine trend, cells dug per game hour and hours of mine left; a gauge, nothing answers it yet)
    if (v.mine) {
      const wallMs = last === undefined ? 0 : Math.min(2 * NEED_TICK_MS, now - last);
      const dug = v.mineFlow?.dugSeen === undefined ? 0 : Math.max(0, v.mine.dug - v.mineFlow.dugSeen);
      v.mineFlow = { ...addMineFlow(v.mineFlow, this.gameMinutes(wallMs), dug), dugSeen: v.mine.dug };
      const mr = mineflowReading(v.mineFlow, mineCellsLeft(v.mine));
      if (mr) readings.push({ kind: 'mineflow', level: mr.level, amount: Math.round(mr.hours * 10) / 10, text: mr.text.slice(0, 80) });
    }
    this.needReadings.set(v.name, readings);
    const seen = this.needSeen.get(v.name);
    this.needSeen.delete(v.name);
    const states = (v.needStates ??= {});
    let changed = false;
    for (const r of readings) {
      const answerable = r.kind === 'light' || r.kind === 'furnish' || r.kind === 'food' || r.kind === 'foodflow' || (HOUSING && r.kind === 'housing');
      const prev = states[r.kind];
      const next = stepNeed(prev, r, last === undefined ? 0 : now - last, {
        offered: !!seen?.offered.has(r.kind), taken: !!seen?.taken.has(r.kind),
        ...(seen && !seen.offered.has(r.kind) && seen.blocked.has(r.kind) ? { blocked: seen.blocked.get(r.kind) } : {}),
      }, answerable);
      states[r.kind] = next;
      if (prev?.status !== next.status) {
        changed = true;
        console.log(`[need] ${v.name}: ${r.kind} ${prev?.status ?? 'new'} -> ${next.status} (level ${next.level.toFixed(2)}: ${r.text}${next.why ? `; ${next.why}` : ''})`);
      }
    }
    for (const k of Object.keys(states)) if (!readings.some((r) => r.kind === k)) {
      delete states[k];
      changed = true;
    }
    if (changed) this.villages.save();
  }

  /** N.1: a village's needs for the API and panel (null for an unknown village). */
  needsView(name: string) {
    // (the registry is keyed by the lower-cased name)
    const v = this.villages.villages.get(name.toLowerCase());
    if (!v) return null;
    const texts = new Map((this.needReadings.get(v.name) ?? []).map((r) => [r.kind, r.text]));
    return {
      village: v.name, mode: NEEDS_MODE,
      needs: Object.fromEntries(Object.entries(v.needStates ?? {}).map(([k, s]) => [k, { ...s, text: texts.get(k as NeedKind) ?? '' }])),
    };
  }

  /** Growth stopped for good (logged once). */
  private growStop(v: Village, why: string) {
    const g = (v.growth ??= { past: [] });
    if (g.stop) return;
    g.stop = why;
    this.villages.note(v, `the village stops growing: ${why}`);
    this.villages.save();
    console.log(`[grow] ${v.name}: stopped: ${why}`);
  }

  /**
   * The growth chore failed (D14): a stop or removal is nobody's fault; "no site" stops growth on its second answer at
   * least 5 minutes after the first (one survey of unloaded chunks must not end it) and backs off 5 minutes on the first;
   * anything else backs off 2 minutes and stops after 5 in a row.
   */
  private growFailed(v: Village, by: string, why: string) {
    if (why === 'cancelled') return;
    const g = (v.growth ??= { past: [] });
    const now = Date.now();
    let wait = 2;
    if (/^lay_out_houses: no free \d+x\d+ site/.test(why)) {
      const first = g.noSite?.[0];
      g.noSite = [...(g.noSite ?? []), { at: now, by }].slice(-5);
      if (first && now - first.at >= 5 * 60000) return this.growStop(v, `no site within ${VILLAGE_GROW_REACH} blocks`);
      wait = 5;
    } else {
      g.tries = (g.tries ?? 0) + 1;
      if (g.tries >= 5) {
        this.growStop(v, `the layout chore failed ${g.tries} times (${why.slice(0, 120)})`);
        // (and a back-off all the same: growStop writes nothing when growth had stopped already, and a chore failing every
        // 30 s ran on, the X.2 review's 2)
        g.backoff = now + 10 * 60000;
        this.villages.save();
        return;
      }
    }
    g.backoff = now + wait * 60000;
    this.villages.save();
    console.log(`[grow] ${v.name}: chore failed: ${why.slice(0, 200)}; next try after ${wait} min`);
  }

  /**
   * A neighbourhood watched to its end (s30, D13, D14; every growTick while it is on the board). Claims nobody holds any
   * more are given back (below). A hard-failed prepare ends it at once (L4: every build waits for it). A failed house's
   * gathering is closed; once every build is done or failed, the gathering and making nothing open waits for are closed and
   * the signs of failed houses failed; once nothing is open or held, it ends. Stuck: open tasks, none held, none claimable
   * (or no worker able to claim), no change for 10 minutes; with every house built that still ends as built. A layout that
   * built every house resets the failures; one that did not backs off 10 minutes a failure, and three in a row stop growth.
   */
  private growEnd(v: Village, now: number) {
    const g = v.growth!, act = g.active!;
    const reg = this.villages;
    const mine = v.tasks.filter((t) => taskNum(t) >= act.from);
    // Claims nobody holds any more go back on the board: a holder no longer in the world (L3); one spawned again since it
    // claimed (agent memory is not kept: its new brain knows nothing of the task); one idle, on no chore, whose brain does
    // not hold the task, GROW_ORPHAN_CHECKS checks in a row. A claim so left stopped the layout's end and every later
    // neighbourhood for good (the review's L-3 and M2)
    for (const t of mine) {
      if (t.status !== 'claimed' || !t.claimedBy) continue;
      const id = t.claimedBy.toLowerCase(), h = this.agents.get(id), key = `${v.name}|${t.id}`;
      let gone: string | undefined;
      if (!h) gone = 'its holder is no longer in the world';
      else if (h.brain?.holdsTask?.(h, t.id) === true) this.growOrphan.delete(key);
      else if ((t.claimedAt ?? t.updated) < (this.spawnedAt.get(id) ?? 0)) gone = 'its holder was spawned again since it claimed it';
      else if (this.chores.has(id) || this.pending.has(id) || !h.idle()) this.growOrphan.delete(key);
      else {
        const n = (this.growOrphan.get(key) ?? 0) + 1;
        this.growOrphan.set(key, n);
        if (n >= GROW_ORPHAN_CHECKS) gone = `its holder has been idle without it for ${n} checks`;
      }
      if (!gone) continue;
      this.growOrphan.delete(key);
      reg.unclaim(v, t.id, t.claimedBy, gone);
      console.log(`[grow] ${v.name}: ${t.id} "${t.title}" handed back for ${t.claimedBy}: ${gone}`);
    }
    const close = (t: Task, status: 'done' | 'failed', why: string) => {
      t.status = status;
      t.result = why;
      t.updated = now;
      reg.note(v, `${t.id} "${t.title}" ${status === 'done' ? 'was not needed' : 'closed'}: ${why}`);
    };
    let why: 'built' | 'failed' | 'stuck' | undefined;
    let left = 0;
    const prep = mine.find((t) => /^Prepare the village plot/.test(t.title));
    if (prep?.status === 'failed') {
      for (const t of mine) if (t.status === 'open') close(t, 'failed', "cancelled: the neighbourhood's plot could not be prepared");
      why = 'failed';
    }
    const builds = act.builds.map((id) => reg.task(v, id)).filter((t): t is Task => !!t);
    // (what an open or held task still waits for stays: a lamps task put back behind new gathering when torches ran short
    // would be claimable again without them, the review's L-1)
    const waitedNow = () => new Set(v.tasks.filter((t) => t.status === 'open' || t.status === 'claimed').flatMap((t) => t.after));
    let waited = waitedNow();
    const gather = (t: Task) => !!t.soft && /^collect block=\S+ count=\d+, then deposit/.test(t.detail);
    // A failed house's own gathering is closed at once (stockCovers no longer counts that house, so its gathering stayed
    // claimable to the neighbourhood's end, the review's L7)
    if (!why)
      for (const b of builds)
        if (b.status === 'failed')
          for (const id of b.after) {
            const t = reg.task(v, id);
            if (t && t.status === 'open' && taskNum(t) >= act.from && gather(t) && !waited.has(t.id)) close(t, 'done', 'not needed: its house was not built');
          }
    if (!why && builds.every((t) => t.status === 'done' || t.status === 'failed')) {
      const failed = new Set(builds.filter((t) => t.status === 'failed').map((t) => t.id));
      const all = failed.size ? 'not needed: every house of the neighbourhood is built or failed' : 'not needed: every house of the neighbourhood is built';
      // (until nothing more closes: the windows' sand goes once their make is closed)
      for (let more = true; more; ) {
        more = false;
        waited = waitedNow();
        for (const t of mine) {
          if (t.status !== 'open') continue;
          if ((gather(t) || PARTS_MAKE.test(t.title) || PICK_SUPPLY.test(t.title)) && !waited.has(t.id)) close(t, 'done', all);
          else if (/^put_up_signs /.test(t.detail) && t.after.some((id) => failed.has(id))) close(t, 'failed', 'its house was not built');
          else continue;
          more = true;
        }
      }
    }
    // The stuck rule: the tasks' statuses as a signature, and when it last changed
    const sig = mine.map((t) => t.status[0]).join('');
    if (sig !== act.sig) {
      act.sig = sig;
      act.changed = now;
    }
    // (with no worker here able to claim, what is claimable counts for nothing: the workers left or none takes board tasks,
    // the review's lens 3 L1)
    if (!why && mine.some((t) => t.status === 'open') && !mine.some((t) => t.status === 'claimed') && now - act.changed >= GROW_STUCK_MS
      && (!this.growClaimers(v).length || !reg.claimable(v).some((t) => isGrowTask(v, t)))) {
      for (const t of mine)
        if (t.status === 'open') {
          close(t, 'failed', "cancelled: the neighbourhood's board is stuck");
          left++;
        }
      // (every house standing: the village grew as meant, and lamps or signs left are no failed layout, lens 3 L2)
      why = builds.length && builds.every((t) => t.status === 'done') ? 'built' : 'stuck';
    }
    if (mine.some((t) => t.status === 'open' || t.status === 'claimed')) {
      // (saved only on a change: a save bumps the board's version, and every idle worker looks for a task again)
      if (act.changed === now) reg.save();
      return;
    }
    const built = builds.filter((t) => t.status === 'done').length, failed = builds.length - built;
    why ??= failed ? 'failed' : 'built';
    const lay = v.layouts?.[act.layout - 1];
    const M = this.growMembers(v).length, H = housesOf(v);
    g.past.push({ k: act.k, layout: act.layout, at: act.at, end: now, houses: builds.length, built, failed, members: act.members, why, ...(left ? { left } : {}), ...(act.style ? { style: act.style } : {}), ...(act.project ? { project: act.project } : {}) });
    // (X.2: a public work not built is never offered again)
    if (act.project && why !== 'built') g.projectBad = [...new Set([...(g.projectBad ?? []), act.project])];
    if (act.project) console.log(`[work] ${v.name}: public work ${act.project} ended ${why} in ${((now - act.at) / 60000).toFixed(1)} min`);
    delete g.active;
    for (const k of this.growOrphan.keys()) if (k.startsWith(`${v.name}|`)) this.growOrphan.delete(k);
    if (act.project) {
      // (a public work's failures are projects' own: house growth keeps its counters, the review's 3)
      if (why === 'built') delete g.projectFails;
      else {
        g.projectFails = (g.projectFails ?? 0) + 1;
        g.projectBackoff = now + 10 * 60000 * g.projectFails;
      }
    } else if (why === 'built') delete g.fails;
    else {
      g.fails = (g.fails ?? 0) + 1;
      g.backoff = now + 10 * 60000 * g.fails;
    }
    reg.note(v, act.project ? `the public work ${act.project} ended (${why})` : `neighbourhood ${act.k} ended (${why}): ${built} of ${builds.length} houses built`);
    reg.save();
    const signs = lay?.signs ? (lay.signed ? lay.signs.length : lay.signs.filter((s) => s.up).length) : 0;
    console.log(`[grow] ${v.name}: layout ${act.layout} ended ${why} in ${((now - act.at) / 60000).toFixed(1)} min: built ${built} of ${builds.length} houses, signs ${signs}, lamps ${lay?.lit ? 'lit' : 'not'}; houses ${H} for ${M} members${left ? `; ${left} tasks left open` : ''}`);
    if ((g.fails ?? 0) >= 3) this.growStop(v, `${g.fails} neighbourhoods in a row ended without every house built`);
  }

  /**
   * Chores under way, by agent (lower-cased name; F193, 10-09: one chore an agent, so a second idle worker and the mayor
   * take chores of other kinds at the same time). `key` names what the chore works on: `slot:k:j`, `farm:k`, `start`,
   * `annex`, `pen`, `iron` or `explore` (A.2's instances: `explore:i`, `start:k:j`, and further keys in `choice.holds`;
   * S.9's `works`, `worksfurnace:k`, `make:<item>` holding `furnace:k` when it smelts, `gather:<material>:<n>`);
   * no two chores of a village hold the same key (the skills' own locks are taken only when an action runs, so a key also
   * covers the time it waits in the queue).
   */
  private chores = new Map<string, ChoreEnd & { key: string; what: string }>();
  /** Keys of chores just ended, by "village|key", held until the time given. */
  private cooling = new Map<string, number>();
  /** Kinds with no sighting in range, by "village:kind": not searched for again until then. */
  private slotSkip = new Map<string, number>();
  /** When the cake was last tried, by village (a back-off). */
  private cakeAt = new Map<string, number>();
  /** S.9's back-offs: failed makes by "village:item" (10 minutes, an hour after 3), gathering by "village:material" (until),
   *  a works furnace by "village:k" (until); and the logs gathering deposited, by village (the hourly cap). */
  private makeBack = new Map<string, { tries: number; at: number }>();
  private gatherBack = new Map<string, number>();
  private worksBack = new Map<string, number>();
  /** B.4: a failed light chore backs its part off, by "village:part" (until); and the demand last logged, by village. */
  private lightBack = new Map<string, number>();
  /** X.1: a failed furnish chore backs its building off, by "village:part" (until). */
  private decorBack = new Map<string, number>();
  /** A works furnace a smelting make found no path to, by "village:k" (until; F233). */
  private furnaceBack = new Map<string, number>();
  /** A.3p: since when a disliked option has been left by members (by village|option id); anyone takes it after DECLINE_MS. */
  private declined = new Map<string, number>();
  private lightLogged = new Map<string, { sig: string; at: number }>();
  private gatherLog = new Map<string, Array<{ at: number; n: number }>>();
  /** A gathering's first "none found" answer, by "village:material": the material is marked unavailable only on a second
   *  from another agent at least GATHER_NONE_APART later (S.9's review, lens 4 M2). */
  private gatherNone = new Map<string, { agent: string; at: number }>();

  /**
   * The keys of a village's chores still under way (from the actions' own state: a stop fails them, lesson 67); finished
   * ones are dropped and a failure reported to their `failed` (reportFailed: in model mode endChoice did, at the end).
   */
  private choreKeys(v: Village): Set<string> {
    const keys = new Set<string>();
    for (const [k, until] of this.cooling)
      if (until < Date.now()) this.cooling.delete(k);
      else if (k.startsWith(`${v.name}|`)) keys.add(k.slice(v.name.length + 1));
    for (const [id, c] of this.chores) {
      if (c.village !== v.name) continue;
      // (the agents map is keyed by the lower-cased name: VanX2 sent a second explorer out while the first walked home)
      const going = c.status.some((q) => q.state === 'queued' || q.state === 'running');
      if (going && this.agents.has(id)) {
        keys.add(c.key);
        for (const h of c.choice.holds) keys.add(h);
        continue;
      }
      // (a stopped or removed agent's statuses fail at once while its skill's finally still runs its commands (a teleport,
      // the gate, the slot's lock): the key is held 10 s more, the design review's M3 and the diff review's L3; its further
      // keys with it, A.2)
      this.chores.delete(id);
      this.endChoice(c);
      this.cooling.set(`${v.name}|${c.key}`, Date.now() + 10000);
      for (const h of c.choice.holds) this.cooling.set(`${v.name}|${h}`, Date.now() + 10000);
      this.cooling.set(`agent|${id}`, Date.now() + 10000);
      this.reportFailed(c);
    }
    return keys;
  }

  /**
   * The keys a village's chores hold now, written nowhere (A.2). 'sweep' is what choreKeys would return at this moment
   * (cooled keys, then the keys of chores under way whose agent is here, with their further keys; chores it would drop
   * are not in it, nor the keys their drop would cool). 'async' (a pick checked after a model reply, an expiry or an API
   * call) also holds every chore that ended within 10 s, dropped or not: its keys and its agent (`agent|<id>`), which
   * closes the gap between a chore's end and the next sweep's drop (and a stop whose skill's finally still runs).
   */
  private heldKeys(v: Village, now: number, mode: 'sweep' | 'async'): Set<string> {
    const keys = new Set<string>();
    for (const [k, until] of this.cooling)
      if (until >= now && (k.startsWith(`${v.name}|`) || (mode === 'async' && k.startsWith('agent|')))) keys.add(k.startsWith('agent|') ? k : k.slice(v.name.length + 1));
    for (const [id, c] of this.chores) {
      if (c.village !== v.name) continue;
      const going = c.status.some((q) => q.state === 'queued' || q.state === 'running');
      if (going && this.agents.has(id)) {
        keys.add(c.key);
        for (const h of c.choice.holds) keys.add(h);
      } else if (mode === 'async' && now - (c.choice.endedAt ?? now) <= 10000) {
        keys.add(c.key);
        for (const h of c.choice.holds) keys.add(h);
        keys.add(`agent|${id}`);
      }
    }
    return keys;
  }

  private setChore(v: Village, worker: BotAgent, key: string, status: ActionStatus[], what: string, failed?: (why: string) => void, meta?: ChoiceMeta, holds: string[] = [], opt?: ChoiceOption) {
    const id = worker.name.toLowerCase();
    // (idleWorker never offers an agent holding a chore, so nothing is replaced; if one were, its end is logged)
    const old = this.chores.get(id);
    if (old) this.endChoice(old);
    const kind = (opt?.kind ?? key.split(':')[0]) as ChoiceKind;
    const choice: ChoiceState = { id: meta?.decisionId ?? choiceId(v.name), t: Date.now(), store: storageContents(v), carried: heldCounts(worker) ?? {}, with: new Set(), holds, kind, option: opt?.id ?? key, name: opt?.name ?? choreName(key, what), decisionId: meta?.decisionId };
    if (opt?.kind === 'explore' && opt.at) {
      try {
        choice.point = { x: opt.at.x, z: opt.at.z, known0: this.atlas.known(opt.at.x, opt.at.z, 48) };
      } catch {
        // (measurement only)
      }
    }
    // (the village's chores under way meanwhile: their deposits show in this one's storage change, and its in theirs)
    for (const o of this.chores.values())
      if (o.village === v.name && !o.choice.ended) {
        o.choice.with.add(choice.id);
        choice.with.add(o.choice.id);
      }
    this.chores.set(id, { agent: worker.name, village: v.name, key, status, what, failed, choice });
    // The decision log (A.1; A.2 adds the menu the choice was made on and how it was decided). Chores before completion
    // (the wheat field and ripe slots) are still code-driven: no menu, `options` empty.
    const menu = meta?.menu;
    // (positions only for the model's own choice: a fallback ran a fixed pick from a fresh menu, and the ids the model was
    // shown are logged apart, `shownIds`)
    const shown = meta?.source === 'model' ? meta.shown : undefined;
    const options: ChoiceLogOption[] = (menu?.options ?? []).map((o) => ({
      id: o.id, kind: o.kind, key: o.key, name: o.name, facts: o.facts, effect: o.effect, rank: o.rank,
      ...(o.lp !== undefined ? { lp: o.lp } : {}), ...(o.tw !== undefined ? { tw: o.tw } : {}), ...(o.nw !== undefined ? { nw: o.nw } : {}), ...(shown && shown.includes(o.id) ? { shown: shown.indexOf(o.id) + 1 } : {}),
    }));
    const position = opt && shown?.includes(opt.id) ? shown.indexOf(opt.id) + 1 : undefined;
    logChoice({
      id: choice.id, agent: worker.name, village: v.name, t: choice.t, key, what, kind, reason: meta?.reason ?? 'fixed order', options,
      ...(opt ? { chosen: opt.id } : {}), source: meta?.source ?? 'fixed', ...(meta?.why ? { why: meta.why } : {}),
      ...(position ? { position } : {}), ...(shown ? { shownCount: shown.length } : {}),
      ...(!shown && meta?.shown?.length ? { shownIds: meta.shown } : {}),
      ...(meta?.modelChose ? { modelChose: meta.modelChose, modelReason: meta.modelReason ?? '' } : {}),
      ...(meta?.reaskOf ? { reaskOf: meta.reaskOf } : {}),
      ...(meta?.decisionId && meta.shown?.length ? { seed: `${meta.decisionId}|${worker.name}` } : {}),
      ...(meta?.model ? { model: meta.model } : {}), ...(meta?.latencyMs !== undefined ? { latencyMs: meta.latencyMs } : {}),
      ...(meta?.waitMs !== undefined ? { waitMs: meta.waitMs } : {}), ...(meta?.queueWaitMs !== undefined ? { queueWaitMs: meta.queueWaitMs } : {}),
      ...(meta?.promptTokens !== undefined ? { promptTokens: meta.promptTokens } : {}), ...(meta?.outputTokens !== undefined ? { outputTokens: meta.outputTokens } : {}),
      ...(menu?.guarded.length ? { guarded: menu.guarded } : {}), ...(menu ? { ctx: menu.ctx } : {}),
    });
    if (meta) {
      this.decisions.set(id, { ...meta, chosen: opt?.id ?? null, at: choice.t });
      this.summarise(v.name, meta, opt);
    }
  }

  /**
   * A chore's `[choice-end]` record, once: from choreKeys when it drops the chore, or from the tick as soon as its actions
   * have ended (choreKeys runs only every 30 s and only for villages with agents in the world, so the tick gives the
   * minutes and catches chores whose agents were all removed). Logging only: the chore stays in `chores` until choreKeys
   * drops it. A.2: it also stamps the end (heldKeys' async hold), and feeds the outcome to the choice statistics (the
   * guards' learning progress, bans and cooldowns), judged from the chore's own result. In model mode it also reports a
   * failure to the chore's `failed` (reportFailed).
   */
  private endChoice(c: ChoreEnd) {
    if (c.choice.ended) return;
    c.choice.ended = true;
    c.choice.endedAt = Date.now();
    const bad = c.status.find((q) => q.state === 'failed');
    const agent = this.agents.get(c.agent.toLowerCase());
    if ((agent ? this.chooseMode(agent) : CHOOSE.mode) === 'model') this.reportFailed(c);
    const done = c.status.every((q) => q.state === 'done');
    let message = bad?.message ?? (done ? c.status[c.status.length - 1]?.message ?? '' : 'agent gone');
    let ok = !bad && done;
    // S.9's gathering is judged by its deposit: a partial collect ("only found 9") whose load landed is a success (the
    // check's M3), and the deposit's message is what choreProductive reads
    const g = c.choice.gather ?? c.choice.initiative;
    if (g) {
      const dep = c.status[c.status.length - 1];
      const n = dep?.state === 'done' ? depositedOf(dep.message ?? '', g.material) : 0;
      ok = n > 0;
      // (a failed deposit after a failed collect says only "not carrying sand": the collect's reason, the first failure,
      // is the one the log and the model's last chores read; S.9's review, lens 2 L1)
      if (dep?.state === 'done' && (n > 0 || !bad)) message = dep.message ?? message;
      // (a load landed: the material is there after all, a first "none found" is forgotten)
      if (n > 0) this.gatherNone.delete(`${c.village}:${g.material}`);
      if (n > 0 && g.material === 'logs' && c.choice.kind === 'gather') this.gatherLog.set(c.village, [...(this.gatherLog.get(c.village) ?? []).filter((e) => Date.now() - e.at < 60 * 60000), { at: Date.now(), n }]);
      // (an initiative's trip: what landed is credited to it, by the item its bill plans with; s36)
      const ini = c.choice.initiative;
      const vi = ini && n > 0 ? this.villages.villages.get(c.village.toLowerCase()) : undefined;
      const it = vi?.initiatives?.find((i) => i.id === ini!.id);
      if (vi && it && ini) {
        const item = ini.material === 'logs' ? `${this.catalogWoodOf(vi)}_log` : ini.material;
        it.gathered = { ...(it.gathered ?? {}), [item]: (it.gathered?.[item] ?? 0) + n };
        this.villages.save();
      }
    }
    // (an earmark left by a make or furnace placement stopped while queued, lesson 67; the skill's finally deletes its own)
    if (c.choice.kind === 'make' || c.choice.kind === 'works' || c.choice.kind === 'light' || c.choice.kind === 'furnish') holdsDelete(holdKey(c.village, c.agent));
    // (and a meal's: eat_meal's finally deletes its own, s30)
    if (c.choice.kind === 'eat') releaseMeal(c.village, c.agent);
    // A light run that confirmed, found and ruled out nothing (the lighter inside, spots not loaded) ends ok but backs the
    // part off 10 minutes as a failure does: otherwise it is the fixed pick again at once, forever (B.4's review, lens 2 M1)
    if (ok && c.choice.kind === 'light' && c.choice.light && /no progress\)$/.test(message)) this.lightBack.set(`${c.village}:${c.choice.light.part}`, Date.now() + 10 * 60000);
    // (and a furnish run's, X.1)
    if (ok && c.choice.kind === 'furnish' && c.choice.furnish && /no progress\)$/.test(message)) this.decorBack.set(`${c.village}:${c.choice.furnish.part}`, Date.now() + 10 * 60000);
    const v = this.villages.get(c.village);
    const held = agent ? heldCounts(agent) : null;
    const carried = held ? countsDelta(c.choice.carried, held) : null;
    // (a stop or a removal fails every action as "cancelled", which the chores' own failed callbacks ignore too)
    const cut = !ok && (!agent || bad?.message === 'cancelled');
    // (a gathering whose deposit landed is no contention, whatever its collect met)
    const code = ok ? undefined : bad?.code;
    let known: number | undefined;
    if (c.choice.point) {
      try {
        known = Math.round((this.atlas.known(c.choice.point.x, c.choice.point.z, 48) - c.choice.point.known0) * 1000) / 1000;
      } catch {
        known = undefined;
      }
    }
    const productive = choreProductive(c.choice.kind, c.status[0]?.type ?? '', ok, message, carried, known);
    logChoiceEnd({
      id: c.choice.id, ok, message, minutes: Math.round((Date.now() - c.choice.t) / 600) / 100, tEnd: Date.now(), cut,
      yield: { storage: v ? countsDelta(c.choice.store, storageContents(v)) : {}, carried, with: [...c.choice.with], ...(known !== undefined ? { known } : {}) },
      ...(code ? { code } : {}), productive,
    });
    try {
      this.noteEnd(c, ok, cut, !!code, productive, message, known);
    } catch (e) {
      console.error('[choice] end statistics failed:', e);
    }
  }

  /**
   * A failed chore's `failed` (the iron age's back-off), once. In model mode endChoice calls it at the end itself: picks are
   * also made outside the sweep (after a reply, an expiry, the API), and one made before choreKeys drops the chore would
   * see the option without its back-off (RACES-1). In fixed mode every pick follows choreKeys in a sweep, so the drop
   * reports it, as before A.2 (the golden check records the back-off's time).
   */
  private reportFailed(c: ChoreEnd) {
    // (an end seen while an action still runs, its agent gone: reported by the drop, once the actions have ended)
    if (c.failReported || c.status.some((q) => q.state === 'queued' || q.state === 'running')) return;
    c.failReported = true;
    const bad = c.status.find((q) => q.state === 'failed');
    if (!bad || !c.failed) return;
    try {
      c.failed(bad.message ?? 'failed');
    } catch (e) {
      console.error("[choice] a chore's failure callback failed:", e);
    }
  }

  /** Chores whose actions have ended (or whose agent is gone) get their end record now (see endChoice); pending decisions
   *  whose agent went away, got busy or left a complete village are dropped (A.2, spec 6). */
  private endChoices() {
    for (const [id, c] of this.chores) {
      if (c.choice.ended) continue;
      const going = c.status.some((q) => q.state === 'queued' || q.state === 'running');
      if (!going || !this.agents.has(id)) this.endChoice(c);
    }
    for (const p of [...this.pending.values()]) {
      const a = this.agents.get(p.id);
      const v = this.villages.get(p.village);
      const why: ChoiceDrop['why'] | null = !a ? 'gone' : a !== p.agent ? 'replaced' : !a.bot.entity ? 'no body' : !v?.complete || a.village()?.name !== p.village ? 'not complete'
        : v.tasks.some((t) => t.status === 'claimed' && t.claimedBy === a.name) ? 'task' : !a.idle() || this.chores.has(p.id) ? 'busy' : null;
      if (why) this.dropDecision(p, why);
    }
  }

  // ---- A.2: the menu ---------------------------------------------------------------------------------------------------

  /** Decisions waiting for or in a model call, by agent (lower-cased). */
  private pending = new Map<string, PendingChoice>();
  private chooser = new ChooserQueue({ parallel: CHOOSE.parallel, queueMs: CHOOSE.queueMs });
  private choiceStats = new ChoiceStats();
  /** Each agent's last decision (the panel's drill-down). */
  private decisions = new Map<string, ChoiceMeta & { chosen: string | null; at: number }>();
  /** The kind of each agent's last model decision (the repeat rule). */
  private lastModelKind = new Map<string, ChoiceKind>();
  /** Each village's decisions counted (the panel's chip). */
  private summaries = new Map<string, { s: ChoiceSummary; ms: number[]; queue: number[] }>();
  /** Each village's last explore yields (the scouting fact). */
  private exploreYields = new Map<string, number[]>();
  /** Bans already logged, by "village|id", with their end. */
  private bansLogged = new Map<string, number>();
  /** The last [choice-none] line by village: its reasons and when. */
  private noneAt = new Map<string, { sig: string; at: number }>();
  /** The village facts of the latest sweep or menu, by village (C10: one per sweep time). */
  private factsCache = new Map<string, Facts>();
  /** The sweep under way: its village, busy keys and the first ready field's own (today's choreKeys quirk, spec 2.3). */
  private sweepCtx: SweepCtx | undefined;

  /** Fixed order or the model, by agent (memory.choose; every agent of a village runs one mode, D5). */
  private chooseMode(a: BotAgent): 'fixed' | 'model' {
    const m = a.memory.choose;
    return m === 'model' || m === 'fixed' ? m : CHOOSE.mode;
  }

  /** idleWorker's test for one agent (workers and, once the village is complete, the mayor), plus no decision pending. */
  private isIdleMember(v: Village, a: BotAgent, now: number, held?: Set<string>): boolean {
    const id = a.name.toLowerCase();
    return a.village()?.name === v.name && !!a.bot.entity && a.idle() && !this.chores.has(id)
      && (this.cooling.get(`agent|${id}`) ?? 0) < now && !held?.has(`agent|${id}`)
      && !v.tasks.some((t) => t.status === 'claimed' && t.claimedBy === a.name)
      && (a.memory.villageRole !== 'mayor' || !!v.complete) && !this.pending.has(id);
  }

  /** The idle members in idleWorker's order: workers, then the mayor. */
  private idleMembers(v: Village, now: number): BotAgent[] {
    const free = [...this.agents.values()].filter((a) => this.isIdleMember(v, a, now));
    return [...free.filter((a) => a.memory.villageRole !== 'mayor'), ...free.filter((a) => a.memory.villageRole === 'mayor')];
  }

  /** A2: the menu this agent would choose from now; written nowhere (spec 1.3, 4.3). */
  choices(agent: WorldAgent): ChoiceMenu | null {
    const a = this.agents.get(agent.name.toLowerCase());
    if (!a || a !== (agent as unknown)) return null;
    const v = a.village();
    if (!v?.complete) return null;
    const now = Date.now();
    const ctx = this.sweepCtx?.village === v.name ? this.sweepCtx : undefined;
    if (!this.isIdleMember(v, a, now)) return null;
    const busy = ctx?.busy ?? this.heldKeys(v, now, 'sweep');
    return this.menu(v, a, busy, this.chooseMode(a) === 'model', this.sweepFacts(v, now, a), ctx?.first).menu;
  }

  /** A2: run one option, checked again against a fresh menu; never throws (D9). */
  runChoice(agent: WorldAgent, id: string, meta: ChoiceMeta): { ok: true; key: string } | { ok: false; why: string } {
    return this.runPick(agent, id, meta);
  }

  /**
   * One pick run: the option `id` if it is still on the agent's fresh menu, else (a model's pick taken meanwhile, or no id:
   * a fallback) the fresh menu's fixed pick. Inside a sweep the menu is the sweep's (its busy keys); after a reply, an
   * expiry or an API call it holds what heldKeys' async mode holds. Never throws.
   */
  private runPick(agent: WorldAgent, id: string | null, meta: ChoiceMeta, reask?: (fresh: ChoiceMenu) => boolean): { ok: true; key: string } | { ok: false; why: string } {
    try {
      const a = this.agents.get(agent.name.toLowerCase());
      const v = a?.village();
      const drop = (why: ChoiceDrop['why']) => {
        if (meta.decisionId) this.logDrop(meta.decisionId, agent.name, v?.name ?? String(agent.memory.village ?? ''), why, meta.queueWaitMs, meta, id);
        return { ok: false as const, why };
      };
      if (!a || a !== (agent as unknown)) return drop(a ? 'replaced' : 'gone');
      if (!v?.complete) return drop('not complete');
      const ctx = this.sweepCtx?.village === v.name ? this.sweepCtx : undefined;
      // (inside a sweep, the sweep's time: its facts are reused, C10)
      const now = ctx?.t ?? Date.now();
      // (outside a sweep, ended chores' back-offs first: in fixed mode the drop that reports them may be 30 s away, and an
      // API pick would see iron without its back-off, the fix review; reportFailed runs once a chore)
      if (!ctx) for (const c of this.chores.values()) if (c.village === v.name && c.choice.ended) this.reportFailed(c);
      const held = ctx ? undefined : this.heldKeys(v, now, 'async');
      if (!this.isIdleMember(v, a, now, held)) return drop(!a.bot.entity ? 'no body' : v.tasks.some((t) => t.status === 'claimed' && t.claimedBy === a.name) ? 'task' : 'busy');
      const busy = ctx?.busy ?? held!;
      const fresh = this.menu(v, a, busy, this.chooseMode(a) === 'model', this.sweepFacts(v, now, a), ctx?.first);
      // (checked against the guarded options before the trim: one the trim would cut now is still feasible, spec 6)
      let opt = id ? fresh.feasible.find((o) => o.id === id) : undefined;
      let m = meta;
      // (s40, F253: a pick taken meanwhile is asked once more on the fresh menu, the plan's E.4 rule; Night40 lost 103 of
      // 149 model decisions to the fixed pick, several members shown one single-holder option at once)
      if (id && !opt && reask && fresh.menu.options.length > 1 && reask(fresh.menu)) return drop('reask');
      if (id && !opt) m = { ...meta, source: 'fallback', why: 'taken', reason: 'fixed order', ...(meta.source === 'model' ? { modelChose: id, modelReason: meta.reason } : {}) };
      opt ??= fixedPick(fresh.menu);
      if (!opt) return drop('empty');
      // (a fallback is logged with the fresh menu its fixed pick was made on; the ids shown to the model stay in `shown`)
      if (!m.menu || m.source === 'fallback') m = { ...m, menu: fresh.menu };
      this.runOption(v, a, opt, m);
      return { ok: true, key: opt.key };
    } catch (e) {
      console.log(`[choice-error] ${agent?.name}: ${String((e as Error)?.stack ?? e).slice(0, 300)}`);
      return { ok: false, why: 'error' };
    }
  }

  /** The facts a village's members share, once per sweep time (C10): storage, collect's filter, ripe counts, sightings. */
  private sweepFacts(v: Village, t: number, a: BotAgent): Facts {
    const old = this.factsCache.get(v.name);
    if (old && old.t === t && this.agents.has(old.agent.name.toLowerCase())) return old;
    const f = this.makeFacts(v, t, a);
    this.factsCache.set(v.name, f);
    return f;
  }

  private makeFacts(v: Village, t: number, a: BotAgent): Facts {
    const store = storageContents(v);
    const memo = <T,>(fn: (k: string) => T) => {
      const m = new Map<string, T>();
      return (k: string) => {
        if (!m.has(k)) m.set(k, fn(k));
        return m.get(k)!;
      };
    };
    const since = <T,>(fn: () => T) => {
      let at: string | undefined, val: T;
      return () => {
        const g = this.goingS9(v);
        const sig = `${holdsVersion()}|${JSON.stringify(g)}`;
        if (sig !== at) {
          val = fn();
          at = sig;
        }
        return val;
      };
    };
    let ok: ((p: { x: number; y: number; z: number }) => boolean) | undefined;
    const chest = v.storage?.chests[0];
    const startHome = chest ? { x: chest.x, z: chest.z } : villageHome(v, a.memory);
    const read = (x: number, y: number, z: number) => {
      for (const b of this.agents.values()) {
        const st = b.bot.entity ? stateAt(b, x, y, z) : -1;
        if (st >= 0) return st;
      }
      return -1;
    };
    const is = (st: number, name: string) => {
      const b = this.registry.blocksByName[name];
      return !!b && st >= b.minStateId && st <= b.maxStateId;
    };
    const lay0 = v.layouts?.[0];
    const ax = lay0?.annex;
    const annexHome = ax ? { x: (ax.x1 + ax.x2) / 2, z: (ax.z1 + ax.z2) / 2 } : null;
    const bad = ax ? (ax.penBad ?? []).map((s) => (s.includes(':') ? s : `chicken:${s}`).split(':')).map(([k, c]) => [k, ...c.split(',').map(Number)] as [string, number, number, number])
      .filter(([, , , tt]) => !tt || t - tt < 60 * 60000) : [];
    return {
      t, agent: a, store,
      ok: () => (ok ??= collectFilter(a, FARM_TRIP_RANGE)),
      startHome,
      exploreHome: villageHome(v, a.memory),
      // The wheat fields as farmChores reads them (everything but the busy keys and an idle worker)
      field: memo((ks) => {
        const k = Number(ks), farm = v.layouts?.[k - 1]?.farm;
        const wheat = this.registry.blocksByName.wheat;
        if (!wheat || !farm?.planted || harvesting.has(`${v.name}:${k}`)) return null;
        if (farm.lastHarvest && !farm.lastHarvest.ok && t - farm.lastHarvest.at < (farm.lastHarvest.why === 'nothing ripe' ? 2 : 10) * 60000) return null;
        if (v.tasks.some((tk) => tk.detail.startsWith(`tend_farm layout=${k} `) && (tk.status === 'open' || tk.status === 'claimed'))) return null;
        const plot = preparedAt(v, farm);
        if (!plot) return null;
        let grown = 0, ripe = 0;
        for (const [x, z] of farm.sow) {
          let s = -1;
          for (const b of this.agents.values()) if (b.bot.entity && (s = stateAt(b, x, plot.y + 1, z)) >= 0) break;
          if (s < 0) return null;
          if (s < wheat.minStateId || s > wheat.maxStateId) continue;
          grown++;
          if (s - wheat.minStateId >= 7) ripe++;
        }
        return ripe < (GROW_FARMS ? Math.min(4, Math.max(1, grown)) : 4) || ripe < 0.75 * grown ? null : { ripe, grown, plot };
      }),
      // A planted slot as slotChores' ripe loop reads it ("k:j")
      slot: memo((kj) => {
        const [k, j] = kj.split(':').map(Number);
        const slot = v.layouts?.[k - 1]?.slots?.[j - 1];
        const spec = slot?.kind ? SLOT_KINDS[slot.kind] : undefined;
        if (!slot || !spec || slot.laying || !slot.planted || slotBusy.has(`${v.name}:${k}:${j}`)) return null;
        if (slot.lastHarvest && !slot.lastHarvest.ok && t - slot.lastHarvest.at < (slot.lastHarvest.why === 'nothing ripe' ? 2 : 10) * 60000) return null;
        const plot = v.plots.find((p) => slot.x1 >= p.x1 && slot.x2 <= p.x2 && slot.z1 >= p.z1 && slot.z2 <= p.z2);
        if (!plot) return null;
        const y = plot.y + 1;
        let ripe = 0, of = 0;
        if (spec.ripe !== undefined) {
          const b = this.registry.blocksByName[spec.block];
          for (const [x, z] of slot.cells ?? []) {
            const st = read(x, y, z);
            if (st < 0) return null;
            if (b && is(st, spec.block)) {
              of++;
              if (st - b.minStateId >= spec.ripe) ripe++;
            }
          }
        } else
          for (const [x, z] of (spec.fruit ? slot.fruit : slot.cells) ?? []) {
            const st = read(x, spec.fruit ? y : y + 1, z);
            if (st < 0) return null;
            if (is(st, spec.fruit ?? 'sugar_cane')) ripe++;
          }
        return ripe < 2 || (spec.ripe !== undefined && ripe < 0.75 * of) ? null : { ripe, of };
      }),
      // Sightings a start may go for, by kind (searched from collect's home, judged by collect's filter; bad sightings
      // are the slots', left to the menu)
      sightings: memo((kind) => (startHome ? this.atlas.sightings(kind, Math.floor(startHome.x), Math.floor(startHome.z), FARM_TRIP_RANGE) : [])),
      // Animals a pen may lure, by kind (within 96 of the annex in 30 minutes, off village ground, away from failed spots)
      animals: memo((kind) => (annexHome && ax ? this.atlas.animalSightings(kind, annexHome.x, annexHome.z, 96, 30 * 60000, (x, z) => onVillageGround(a, x, z) || bad.some(([bk, bx, bz]) => bk === kind && Math.hypot(x - bx, z - bz) <= 8)) : [])),
      // Eggs lying in a chicken pen ("j"), seen by any bot
      eggs: memo((js) => {
        const slot = lay0?.slots?.[Number(js) - 1];
        const plot = v.plots.find((p) => p.annex);
        if (!slot || !plot) return false;
        const P = penPlan(slot, slot.face ?? 'n');
        const inPen = (q: { x: number; y: number; z: number }) => q.x >= P.inner.x1 && q.x < P.inner.x2 + 1 && q.z >= P.inner.z1 && q.z < P.inner.z2 + 1 && Math.abs(q.y - (plot.y + 1)) <= 2;
        return [...this.agents.values()].some((b) => b.bot.entity && Object.values(b.bot.entities).some((e) => e.name === 'item' && inPen(e.position)));
      }),
      known: memo((xz) => {
        const [x, z] = xz.split(',').map(Number);
        return this.atlas.known(x, z, 48);
      }),
      // S.9's workshop, for no one agent (an idle member holds no earmark): planned again only once the earmarks or the
      // makes and trips under way changed, i.e. after one was taken in the sweep (spec 4.6)
      makePlans: since(() => {
        const goods = this.goodsFor(v);
        // (with the catalogue, one spare for every good: makeSpare's reserve is too dear to repeat for each, X.1)
        const base = goods.length > MAKE_GOODS.length + FOOD_GOODS.length ? this.makeSpare(v, '', undefined, store) : undefined;
        return new Map(goods.map((g) => [g.item, this.makePlan(v, g, '', store, base)]));
      }),
      gather: since(() => this.gatherWanted(v, store)),
      spare: since(() => this.makeSpare(v, '', undefined, store)),
    };
  }

  /** The full menu: options (guarded and trimmed in model mode), the reasons for kinds with none, and the context; beside
   *  it the guarded options before the trim (`feasible`, what a model's pick is checked against). */
  private menu(v: Village, a: BotAgent, busy: Set<string>, guards: boolean, facts: Facts, first?: SweepCtx['first']): { menu: ChoiceMenu; feasible: ChoiceOption[]; skips: string[] } {
    const r = this.choiceOptions(v, a, busy, guards, facts, first);
    return { menu: { agent: a.name, village: v.name, t: facts.t, options: r.options, guarded: r.guarded, reasons: r.reasons, ctx: this.choiceContext(v, a, facts) }, feasible: r.feasible, skips: r.effects.skips };
  }

  /**
   * The feasible chores for an idle member of a complete village, in rank order (today's fixed order: fields, ripe slots,
   * farm starts, the annex, pens, pen work, the cake, the iron age, exploring; then S.9's works plot, making and gathering
   * for the workshop, while MC_CHOICE_FAMILIES names them). Pure: the writes the old picker made while
   * looking are the sweep's housekeeping, the option's run (runOption) or `effects.skips` (spec 1.3). With `guards` (model
   * mode), banned and cooling options go to `guarded` and the rest are trimmed (choose.ts trimMenu).
   */
  private choiceOptions(v: Village, a: BotAgent, busy: Set<string>, guards: boolean, facts: Facts, first?: SweepCtx['first']):
    { options: ChoiceOption[]; feasible: ChoiceOption[]; effects: { skips: string[] }; reasons: Partial<Record<ChoiceKind, string>>; guarded: Array<{ id: string; why: string }> } {
    const now = facts.t;
    const out: ChoiceOption[] = [];
    const reasons: Partial<Record<ChoiceKind, string>> = {};
    const skips: string[] = [];
    const layouts = v.layouts ?? [];
    const store = facts.store;
    const multi = layouts.filter((l) => l.farm).length > 1;
    const instances = (kind: string) => CHOOSE.instances.has(kind);
    // (`id`: that option's chores and ends only: make's and gather's, whose ids are goods and materials; a glass maker was
    // "on it" for torches, S.9's review, lens 2 L2)
    const others = (kind: ChoiceKind, id?: string) => {
      const names = [...this.chores.values()].filter((c) => c.village === v.name && c.agent !== a.name && !c.choice.ended && c.choice.kind === kind && (id === undefined || c.choice.option === id)).map((c) => c.agent);
      return names.length ? `; on it: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}` : '';
    };
    const record = (kind: ChoiceKind) => {
      const s = this.choiceStats.agentKind(v.name, a.name, kind);
      return s ? `you: ${s.ok} of ${s.n} done, ~${Math.max(0.1, Math.round(s.minutes * 10) / 10)} min each` : 'you: never done';
    };
    const lastOf = (kind: ChoiceKind, id?: string) => {
      const l = this.choiceStats.villageLast(v.name, kind, id);
      return l ? `; last ${ago(now - l.at)}, ${l.ok ? 'done' : 'failed'}` : '';
    };
    const dist = (x: number, z: number) => {
      const p = a.bot.entity?.position;
      return p ? `${Math.round(Math.hypot(p.x - x, p.z - z))} blocks from you` : '';
    };
    const add = (o: Omit<ChoiceOption, 'holds'> & { holds?: string[] }, data: OptionRun) => {
      const opt: ChoiceOption = { holds: [], ...o, facts: o.facts.slice(0, 240) };
      OPTION_RUN.set(opt, data);
      out.push(opt);
    };

    // A meal first (s30's appetite, D11): a peckish member's own, while storage holds food and one of APPETITE.eaters
    // places at the hut is free (25 withdrawers at once would crowd its chest spots)
    const ap = appetiteOn(v) ? v.food!.members[a.name] : undefined;
    const state = ap ? stateOf(ap.level) : 'fed';
    if (ap && state !== 'fed') {
      // (from what the meals other members are on their way to leave: the record stays as it was until each has withdrawn,
      // lens 1 M1)
      const food = storeForMeals(v.name, store, a.name);
      const meal = chooseMeal(ap.level, food);
      const me = `eat:${a.name.toLowerCase()}`;
      const k = Array.from({ length: APPETITE.eaters }, (_, i) => i + 1).find((i) => !busy.has(`eaters:${i}`));
      if (!meal) reasons.eat = 'no food in storage';
      else if (busy.has(me) || k === undefined) reasons.eat = 'busy';
      else {
        const after = Math.min(APPETITE.cap, ap.level + meal.n * FOOD_POINTS[meal.item]);
        const h = v.storageHut;
        add({
          id: 'eat', kind: 'eat', key: me, holds: [`eaters:${k}`], excludes: [`${me}=`, `eaters:${k}=`], name: 'Eat a meal from the storage', rank: 0,
          ...(h ? { at: { x: Math.floor((h.x1 + h.x2) / 2), z: Math.floor((h.z1 + h.z2) / 2) } } : {}),
          facts: `you: appetite ${Math.round(ap.level)} of 20 (hungry at ${APPETITE.hungryAt}: then only food work); storage: ${foodText(food)}`,
          effect: `back to about ${Math.round(after)} of 20 (${meal.n} ${words(meal.item)})`,
        }, { kind: 'eat', level: ap.level, item: meal.item, n: meal.n });
      }
    }

    // The wheat fields
    for (const [i, lay] of layouts.entries()) {
      if (!lay.farm) continue;
      const k = i + 1;
      const f = facts.field(String(k));
      if (!f) {
        reasons.farm ??= 'nothing ripe';
        continue;
      }
      const excludes = [`farm:${k}`, 'pen'];
      if (excluded(excludes, first?.k === k ? first.busy : busy)) {
        reasons.farm ??= 'busy';
        continue;
      }
      // (a field work's by its number among the fields: several on one menu, the field spec's check 9)
      const name = lay.grow ? `Harvest the wheat field of neighbourhood ${lay.grow}` : lay.field ? `Harvest wheat field ${layouts.slice(0, k).filter((l) => l.field).length}` : `Harvest the wheat field${multi && k > 1 ? ' of the second plot' : ''}`;
      add({
        id: `farm:${k}`, kind: 'farm', key: `farm:${k}`, excludes, name, rank: 10 + k, at: { x: Math.floor((lay.farm.x1 + lay.farm.x2) / 2), z: Math.floor((lay.farm.z1 + lay.farm.z2) / 2) },
        facts: `${f.ripe} of ${f.grown} ripe; ${dist((lay.farm.x1 + lay.farm.x2) / 2, (lay.farm.z1 + lay.farm.z2) / 2)}; storage: ${store.wheat ?? 0} wheat, ${store.wheat_seeds ?? 0} seeds, ${store.bread ?? 0} bread; ${record('farm')}${others('farm')}${lastOf('farm')}`,
        effect: `about ${f.ripe} wheat and seeds`,
      }, { kind: 'farm', k, ripe: f.ripe, grown: f.grown });
    }

    // Ripe farm slots
    for (const [i, lay] of layouts.entries())
      for (const [jj, slot] of (lay.slots ?? []).entries()) {
        if (!slot.kind || !SLOT_KINDS[slot.kind]) continue;
        const k = i + 1, j = jj + 1;
        const f = facts.slot(`${k}:${j}`);
        if (!f) {
          reasons.slot ??= 'nothing ripe';
          continue;
        }
        const excludes = [`slot:${k}:${j}`, 'pen'];
        if (excluded(excludes, busy)) {
          reasons.slot ??= 'busy';
          continue;
        }
        add({
          id: `slot:${k}:${j}`, kind: 'slot', key: `slot:${k}:${j}`, excludes, name: `Harvest the ${words(slot.kind)} farm${lay.grow ? ` of neighbourhood ${lay.grow}` : layouts.length > 1 && k > 1 ? ' of the second plot' : ''}${(lay.slots ?? []).filter((s) => s.kind === slot.kind).length > 1 ? ` on slot ${numberWord(j)}` : ''}`,
          rank: 100 + 10 * k + j, at: { x: Math.floor((slot.x1 + slot.x2) / 2), z: Math.floor((slot.z1 + slot.z2) / 2) },
          facts: `${f.ripe} ripe; ${dist((slot.x1 + slot.x2) / 2, (slot.z1 + slot.z2) / 2)}; ${record('slot')}${others('slot')}${lastOf('slot')}`,
          effect: `about ${f.ripe} ${words(slot.kind)}`,
        }, { kind: 'slot', k, j, ripe: f.ripe, slotKind: slot.kind });
      }

    // Farm starts: a free slot started with a kind found near the village. Single keys: one start at a time, on the first
    // free slot, with the first kind seen (today's); instances: up to two at once, on different slots and of different
    // kinds (each holds its slot and its kind, spec 3)
    const freeSlots = layouts.flatMap((lay, i) => (lay.slots ?? []).map((slot, jj) => ({ slot, k: i + 1, j: jj + 1 })))
      .filter(({ slot, k, j }) => !slot.annex && !slot.kind && !slotBusy.has(`${v.name}:${k}:${j}`) && effTries(slot.tries, slot.lastTry?.at, now) < 3 && (!slot.lastTry || now - slot.lastTry.at > 10 * 60000)
        // (a neighbourhood's slot once its plot is prepared: it is laid out while the village stands complete, s30's food step)
        && (!layouts[k - 1]?.grow || !!preparedAt(v, slot)));
    const startInst = instances('start');
    const freeOpen = startInst ? freeSlots.filter(({ k, j }) => !busy.has(`start:${k}:${j}`)) : freeSlots.slice(0, 1);
    const want = startInst ? Math.min(2, freeOpen.length) : freeOpen.length ? 1 : 0;
    if (!freeOpen.length) reasons.start = freeSlots.length ? 'free slots taken' : 'no free slot';
    else if (startInst ? busy.has('pen') : busy.has('start') || busy.has('pen')) reasons.start = 'busy';
    else {
      const free = freeOpen[0];
      const farmed = new Set(layouts.flatMap((l) => (l.slots ?? []).map((q) => q.kind)).filter(Boolean));
      // (with neighbourhood farms, s30's D4: a slot may take a kind the village farms on another layout, started from storage)
      const here = GROW_FARMS ? new Set((layouts[free.k - 1]?.slots ?? []).map((q) => q.kind).filter(Boolean)) : farmed;
      const badSeen = new Set(layouts.flatMap((l) => (l.slots ?? []).flatMap((q) => q.bad ?? [])));
      const home = facts.startHome;
      let found = 0;
      for (const [s, kind] of SLOT_ORDER.entries()) {
        if (found >= want) break;
        const skip = `${v.name}:${kind}`;
        if (here.has(kind)) continue;
        // (a kind another start holds: not walked, not skipped)
        if (startInst && busy.has(`farmkind:${kind}`)) continue;
        if (farmed.has(kind)) {
          // Farmed elsewhere: from storage when it holds a start's worth (its harvests are the stock), never from a sighting
          const spec = SLOT_KINDS[kind];
          const stock = store[spec.take] ?? 0;
          if (stock < spec.count) continue;
          found++;
          const fs = layouts[free.k - 1]?.slots?.[free.j - 1];
          const key = startInst ? `start:${free.k}:${free.j}` : 'start';
          const excludes = startInst ? [`start:${free.k}:${free.j}=`, `farmkind:${kind}=`, 'pen'] : ['start', 'pen'];
          add({
            id: `start:${kind}`, kind: 'start', key, holds: startInst ? [`farmkind:${kind}`] : [], excludes, name: `Start a ${words(kind)} farm`, rank: 200 + s,
            ...(fs ? { at: { x: Math.floor((fs.x1 + fs.x2) / 2), z: Math.floor((fs.z1 + fs.z2) / 2) } } : {}),
            facts: `from storage (${stock} ${words(spec.take)} there; the village farms ${words(kind)} on another slot); ${freeSlots.length} free slot${freeSlots.length === 1 ? '' : 's'}; ${record('start')}${others('start')}`,
            effect: `a ${words(kind)} farm to harvest${layouts[free.k - 1]?.grow ? ` in neighbourhood ${layouts[free.k - 1].grow}` : ''}`,
          }, { kind: 'start', k: free.k, j: free.j, slotKind: kind, x: 0, y: 0, z: 0, store: true });
          continue;
        }
        if ((this.slotSkip.get(skip) ?? 0) > now || !home) continue;
        const ok = facts.ok();
        const seen = facts.sightings(kind)
          // (bad by column, F192; cane by the blocks a cut can take, which must cover the two a start needs: the atlas counts
          // a stalk's blocks above its base for cane, and a one-stalk sighting of two blocks gave one and failed twice)
          .find(([x, y, z, n]) => ok({ x, y, z }) && !badSeen.has(`${kind}@${x},${z}`) && !badSeen.has(`${kind}@${x},${y},${z}`) && (kind !== 'sugar_cane' || n >= 2));
        if (!seen) {
          skips.push(skip);
          continue;
        }
        found++;
        const [x, y, z, n] = seen;
        const key = startInst ? `start:${free.k}:${free.j}` : 'start';
        const excludes = startInst ? [`start:${free.k}:${free.j}=`, `farmkind:${kind}=`, 'pen'] : ['start', 'pen'];
        const tries = layouts.flatMap((l) => l.slots ?? []).filter((q) => q.lastTry?.kind === kind).reduce((t, q) => t + (q.tries ?? 0), 0);
        add({
          id: `start:${kind}`, kind: 'start', key, holds: startInst ? [`farmkind:${kind}`] : [], excludes, name: `Start a ${words(kind)} farm`, rank: 200 + s, at: { x, y, z },
          facts: `${words(kind)} seen ${Math.round(Math.hypot(x - home!.x, z - home!.z))} blocks from the storage${kind === 'sugar_cane' ? ` (${n} stalks)` : ''}; ${freeSlots.length} free slot${freeSlots.length === 1 ? '' : 's'}; ${record('start')}${tries ? `; the village tried this kind ${tries} time${tries === 1 ? '' : 's'}` : ''}${others('start')}`,
          effect: `a ${words(kind)} farm to harvest`,
        }, { kind: 'start', k: free.k, j: free.j, slotKind: kind, x, y, z });
      }
      if (!found) reasons.start = 'nothing seen to farm';
    }

    // The annex (before its pens)
    const lay0 = layouts[0];
    const ax = lay0?.annex;
    if (!lay0 || !v.plots.some((p) => !p.annex) || ax?.state === 'ready') reasons.annex = ax?.state === 'ready' ? 'ready' : 'no layout';
    else if (annexBusy.has(v.name) || excluded(['annex'], busy)) reasons.annex = 'busy';
    else if (effTries(ax?.tries, ax?.lastTry?.at, now) >= 3 || (ax?.lastTry && now - ax.lastTry.at < 10 * 60000)) reasons.annex = 'backing off';
    else
      add({
        id: 'annex', kind: 'annex', key: 'annex', excludes: ['annex'], name: 'Prepare the annex for animal pens', rank: 300,
        facts: `${ax && ax.x2 >= ax.x1 ? `${ax.x2 - ax.x1 + 1}x${ax.z2 - ax.z1 + 1} at ${ax.x1},${ax.z1}, tried ${effTries(ax.tries, ax.lastTry?.at, now)} times` : 'a 13x9 field beside the village, not started'}; ${record('annex')}${others('annex')}`,
        effect: 'room for two pens',
      }, { kind: 'annex', again: !!(ax && ax.x2 >= ax.x1), area: ax ? `${ax.x1},${ax.z1}..${ax.x2},${ax.z2}` : '' });

    // Pens on the annex: one with animals of each kind (no harvest, farm start or other lure beside it, the pen review's L3;
    // nor while the works plot beside the annex is prepared, S.9)
    const penEx = ['pen', 'annex', 'start', 'slot', 'farm', 'works'];
    if (!lay0 || ax?.state !== 'ready') reasons.pen = 'no annex';
    else if (excluded(penEx, busy)) reasons.pen = 'busy';
    else {
      const slots = (lay0.slots ?? []).map((slot, jj) => ({ slot, j: jj + 1 })).filter(({ slot }) => slot.annex);
      for (const [p, kind] of PEN_ORDER.entries()) {
        if (slots.some(({ slot }) => slot.kind === kind && (slot.pen?.animals ?? 0) >= 2)) continue;
        if (PEN_KINDS[kind].lure === 'wheat' && !(store.wheat ?? 0)) continue;
        const by = ax.penBy?.[kind];
        // (an entry over an hour old is forgiven: the sweep deletes it)
        if (by && now - by.at <= 60 * 60000 && (by.tries >= 3 || now - by.at < 10 * 60000)) continue;
        const pick = slots.find(({ slot }) => slot.kind === kind && !slot.laying) ?? slots.find(({ slot }) => !slot.kind);
        if (!pick || slotBusy.has(`${v.name}:1:${pick.j}`)) continue;
        const near = facts.animals(kind);
        const dy = (s: { y: number }) => s.y - (ax.y + 1);
        const seen = near.find((s) => Math.abs(dy(s)) <= 4) ?? near.find((s) => dy(s) >= -4 && dy(s) <= 8);
        if (!seen) continue;
        const [x, y, z] = [Math.floor(seen.x), Math.floor(seen.y), Math.floor(seen.z)];
        const lure = PEN_KINDS[kind].lure;
        add({
          id: `pen:${kind}`, kind: 'pen', key: 'pen', excludes: penEx, name: `Lead ${kind}s into a pen`, rank: 400 + p, at: { x, y, z },
          facts: `the nearest ${kind} seen ${Math.round(Math.hypot(seen.x - (ax.x1 + ax.x2) / 2, seen.z - (ax.z1 + ax.z2) / 2))} blocks from the annex, ${Math.abs(Math.round(dy(seen)))} ${dy(seen) >= 0 ? 'above' : 'below'} it; ${store[lure] ?? 0} ${words(lure)} in storage; tried ${by && now - by.at <= 60 * 60000 ? by.tries : 0} times; ${record('pen')}`,
          effect: `a pen of ${kind}s to breed`,
        }, { kind: 'pen', j: pick.j, slotKind: kind, x, y, z });
      }
      if (!out.some((o) => o.kind === 'pen')) reasons.pen = 'no animals to lead';
    }

    // A pen's own work, then the cake (the annex ready and its plot recorded, C3)
    const annexPlot = v.plots.find((p) => p.annex);
    if (!lay0 || ax?.state !== 'ready' || !annexPlot) {
      reasons.penwork = 'no pens';
      reasons.cake = 'no annex';
    } else {
      const scale = timeScale();
      const due = (pen: { workAt?: Record<string, number> }, what: string, minutes: number) => now - (pen.workAt?.[what] ?? 0) > minutes * 60000;
      for (const [jj, slot] of (lay0.slots ?? []).entries()) {
        const j = jj + 1, pen = slot.pen;
        const spec = slot.kind ? PEN_KINDS[slot.kind] : undefined;
        if (!slot.annex || !spec || !pen?.built || slot.laying || !(pen.animals ?? 0) || slotBusy.has(`${v.name}:1:${j}`)) continue;
        const excludes = [`penwork:${j}`];
        if (excluded(excludes, busy)) {
          reasons.penwork ??= 'busy';
          continue;
        }
        const works: Array<[number, string, string, string, string]> = [];
        if (slot.kind === 'chicken' && due(pen, 'eggs', 1) && facts.eggs(String(j))) works.push([0, 'eggs', 'collect_eggs', 'Collect eggs in the chicken pen', 'eggs lying in the pen']);
        if (slot.kind === 'cow' && (store.bucket ?? 0) > 0 && (store.milk_bucket ?? 0) < 3 && due(pen, 'milk', 2)) works.push([1, 'milk', 'milk_cows', 'Milk the cows', `${store.bucket ?? 0} buckets and ${store.milk_bucket ?? 0} milk in storage`]);
        // (never the seeds a field's open planting still needs: G3f's neighbourhood field was sown half, s30)
        const feed = (store[spec.lure] ?? 0) - (spec.lure === 'wheat_seeds' ? seedsForFields(v) : 0);
        if ((pen.animals ?? 0) >= 2 && (pen.animals ?? 0) < spec.cap && feed >= 2 && due(pen, 'breed', 5 / scale)) works.push([2, 'breed', 'breed_pen', `Breed the ${slot.kind}s`, `${store[spec.lure] ?? 0} ${words(spec.lure)} in storage`]);
        const twin = (lay0.slots ?? []).filter((s) => s.annex && s.kind === slot.kind && s.pen?.built).length > 1;
        for (const [w, what, skill, name, fact] of works) {
          const last = pen.workAt?.[what];
          add({
            id: `penwork:${j}:${what}`, kind: 'penwork', key: `penwork:${j}`, excludes, name: `${name}${twin ? ` on slot ${numberWord(j)}` : ''}`, rank: 500 + 10 * j + w,
            at: { x: Math.floor((slot.x1 + slot.x2) / 2), z: Math.floor((slot.z1 + slot.z2) / 2) },
            facts: `${pen.animals} ${slot.kind}s in the pen; ${fact}; ${last ? `last done ${ago(now - last)}` : 'never done'}; ${record('penwork')}`,
            effect: what === 'eggs' ? 'eggs into storage' : what === 'milk' ? 'milk buckets toward a cake' : `a young ${slot.kind}`,
          }, { kind: 'penwork', j, what, skill, slotKind: slot.kind ?? '', animals: pen.animals ?? 0 });
        }
      }
      if (!out.some((o) => o.kind === 'penwork')) reasons.penwork ??= 'nothing due';
      // The cake (at most two in storage; with an appetite one for six members, s30's D13)
      const cakeCap = appetiteOn(v) ? Math.max(2, Math.ceil(this.growMembers(v).length / 6)) : 2;
      if (excluded(['cake'], busy)) reasons.cake = 'busy';
      else if (cakeShort(store).length) reasons.cake = 'storage short';
      else if ((store.cake ?? 0) >= cakeCap) reasons.cake = cakeCap === 2 ? 'two cakes stored' : `${cakeCap} cakes stored`;
      else if (now - (this.cakeAt.get(v.name) ?? 0) <= 5 * 60000) reasons.cake = 'backing off';
      else
        add({
          id: 'cake', kind: 'cake', key: 'cake', excludes: ['cake'], name: 'Bake a cake', rank: 600,
          facts: `storage has ${store.milk_bucket ?? 0} milk, ${EGGS.reduce((s, e) => s + (store[e] ?? 0), 0)} eggs, ${store.wheat ?? 0} wheat, ${store.sugar ?? 0} sugar, ${store.sugar_cane ?? 0} sugar cane; ${store.cake ?? 0} cakes stored; ${record('cake')}`,
          // (what it is for, not only what it makes: choicebench's labelled case went to a dull scout 7 times in 10, s28)
          effect: `+1 cake, the village's best food (${store.cake ?? 0} stored); uses the milk, egg, wheat and sugar storage holds now`,
        }, { kind: 'cake' });
    }

    // The iron age: an iron pickaxe once storage holds 3 iron, then a bucket; while short, trips to the iron level (not
    // while milking or the cake hold the buckets: storage reads none then, the fixes review's M1)
    const m = v.mine;
    if (!m || m.level === undefined) reasons.iron = 'no mine';
    else if (excluded(['iron', 'cake', 'penwork'], busy)) reasons.iron = 'busy';
    else {
      const made = m.ironMade ?? [];
      // (three buckets once a cow pen holds cows: a cake takes three milk buckets at once, pens v2)
      const cows = (lay0?.slots ?? []).some((s) => s.annex && s.kind === 'cow' && (s.pen?.animals ?? 0) > 0);
      // (buckets the village holds count too: VanC2 was stocked with three and still made one)
      const buckets = Math.max(made.filter((t) => t === 'bucket').length, (store.bucket ?? 0) + (store.milk_bucket ?? 0));
      const iron = (store.raw_iron ?? 0) + (store.iron_ingot ?? 0);
      const tool = made.includes('iron_pickaxe') ? 'bucket' : 'iron_pickaxe';
      const stage = iron >= 3 ? tool : 'dig';
      // (failed stages forgiven after an hour, as the farm slots': the sweep resets them)
      const triesAll = m.ironTries && m.ironLastTry && now - m.ironLastTry.at > 60 * 60000 ? {} : m.ironTries ?? {};
      const t = (triesAll as Record<string, number>)[stage] ?? 0, last = m.ironLastTry;
      if (made.includes('iron_pickaxe') && buckets >= (cows ? 3 : 1)) reasons.iron = 'tools made';
      else if (stage === 'dig' && m.iron?.finished) reasons.iron = 'iron level finished';
      else if (t >= 3 || (last?.stage === stage && now - last.at < 10 * 60000)) reasons.iron = 'backing off';
      else
        add({
          id: `iron:${stage}`, kind: 'iron', key: 'iron', excludes: ['iron', 'cake', 'penwork'],
          name: stage === 'dig' ? 'Dig for iron in the mine' : stage === 'iron_pickaxe' ? 'Make an iron pickaxe' : 'Make a bucket', rank: 700,
          facts: `${iron} iron in storage; ${made.length ? `made: ${made.map(words).join(', ')}` : 'no iron tools made'}; ${stage === 'dig' ? `the iron level ${m.iron ? 'being dug' : 'not started'}` : `${words(stage)} next`}; tried ${t} times; ${record('iron')}${lastOf('iron')}`,
          // (what the tool is for: the bucket case went to a 1-ripe harvest or a scout 6 times in 10, s28)
          effect: stage === 'dig' ? `iron toward ${tool === 'bucket' ? 'a bucket' : 'an iron pickaxe'} (${iron} of 3 in storage)`
            : stage === 'bucket' ? `a bucket (the village has ${buckets}${cows ? '; the penned cows can be milked only with buckets, and a cake takes 3 milk' : '; milk once cows are penned'})`
            : 'an iron pickaxe, the first iron tool (a bucket comes next)',
        }, { kind: 'iron', stage, tool, iron });
    }

    // Exploring: ring points FARM_TRIP_RANGE from home, the least known first, each point once (the bots at home already
    // see ~128 blocks: view distance 8, the design review's H3); only while a farm slot is free (there is nothing else to
    // find for yet, the diff review's L4); single keys: one trip at a time, not while a start may fill the slot, and not
    // beside a lure; instances: a trip a point, free slot or not (A2f, s28: two starts took both free slots in the first
    // sweep and the eight points left every menu while 21 of 25 idled; a scout's sightings feed the pens and later farms
    // too), beside a lure as well (F224, live 10-14: a scout walking past or through a led herd changed nothing; the scout
    // skill puts a lure in hand away first, as one held took an animal away)
    const exInst = instances('explore');
    const exFree = exInst || freeSlots.length > 0;
    const ex = v.explore;
    const exHome = facts.exploreHome;
    if (!exFree) reasons.explore = 'no free slot';
    else if (!exInst && excluded(['explore', 'start', 'pen'], busy)) reasons.explore = 'busy';
    else if (ex?.done) reasons.explore = 'explored';
    else if (!exHome) reasons.explore = 'no home';
    else {
      const visited = ex?.visited ?? [];
      const points = Array.from({ length: 8 }, (_, i) => ({ i, x: Math.round(exHome.x + FARM_TRIP_RANGE * Math.cos((i * Math.PI) / 4)), z: Math.round(exHome.z + FARM_TRIP_RANGE * Math.sin((i * Math.PI) / 4)) }))
        .filter((q) => !visited.includes(q.i)).map((q) => ({ ...q, known: facts.known(`${q.x},${q.z}`) }))
        .sort((p, q) => p.known - q.known);
      const yields = this.exploreYields.get(v.name) ?? [];
      const dull = yields.length >= 2 && yields.slice(-2).every((y) => y < 0.1);
      const trips = yields.length ? `last trips: ${yields.filter((y) => y >= 0.1).length} of ${yields.length} found new land` : 'no trips yet';
      for (const [r, q] of points.entries()) {
        const excludes = exInst ? [`explore:${q.i}=`] : ['explore', 'start', 'pen'];
        if (exInst && excluded(excludes, busy)) continue;
        add({
          id: `explore:${q.i}`, kind: 'explore', key: exInst ? `explore:${q.i}` : 'explore', excludes, name: `Explore to the ${DIRECTIONS[q.i]}`, rank: 800 + r, at: { x: q.x, z: q.z },
          facts: `${dist(q.x, q.z)}; ${points.length} of 8 points left; this point's land ${Math.round(q.known * 100)}% known; ${dull ? 'the last 2 trips found nothing new' : trips}${others('explore')}`,
          // (sightings are what scouting is for: animals for the pens, plants for farm starts)
          effect: dull ? `probably little: the last 2 trips found nothing new, and the point is ${Math.round(q.known * 100)}% known` : 'new land in the atlas, with animals and plants for pens and farms',
          ...(dull ? { lp: 0.5 } : {}),
        }, { kind: 'explore', i: q.i, x: q.x, z: q.z, home: { x: Math.round(exHome.x), z: Math.round(exHome.z) } });
      }
      if (!out.some((o) => o.kind === 'explore')) reasons.explore = points.length ? 'busy' : 'all visited';
    }

    // S.9's families, each only while MC_CHOICE_FAMILIES names it (off: no option and no reason). Code does the arithmetic
    // (targets, batches, earmarks, what is wanted and how much at once), the model only chooses (lesson 1)
    const family = (f: string) => CHOOSE.families.has(f);

    // The works plot beside the annex (D8), then its three furnaces, one at a time on the menu
    const wk = lay0?.works;
    if (!family('works')) {
      // (off)
    } else if (!lay0 || ax?.state !== 'ready') reasons.works = 'no annex';
    else if (wk?.state !== 'ready') {
      if (worksBusy.has(v.name) || excluded(['works', 'annex', 'pen'], busy)) reasons.works = 'busy';
      else if (effTries(wk?.tries, wk?.lastTry?.at, now) >= 3 || (wk?.lastTry && now - wk.lastTry.at < 10 * 60000)) reasons.works = 'backing off';
      else
        add({
          id: 'works:prepare', kind: 'works', key: 'works', excludes: ['works', 'annex', 'pen'], name: 'Prepare the works plot', rank: 850,
          facts: `${wk && wk.x2 >= wk.x1 ? `${wk.x2 - wk.x1 + 1}x${wk.z2 - wk.z1 + 1} at ${wk.x1},${wk.z1}, tried ${effTries(wk.tries, wk.lastTry?.at, now)} times` : 'a 13x9 field beside the annex, not started'}; ${record('works')}${others('works')}`,
          effect: "room for a row of three furnaces (the hut's one furnace smelts one batch at a time) and later a sheep pen",
        }, { kind: 'works', stage: 'prepare', again: !!(wk && wk.x2 >= wk.x1), area: wk ? `${wk.x1},${wk.z1}..${wk.x2},${wk.z2}` : '' });
    } else {
      const placed = (wk.furnaces ?? []).slice(0, WORKS_FURNACES).filter(Boolean).length;
      const k = Array.from({ length: WORKS_FURNACES }, (_, i) => i + 1).find((kk) => !wk.furnaces?.[kk - 1] && !excluded([`worksfurnace:${kk}=`, 'works='], busy) && (this.worksBack.get(`${v.name}:${kk}`) ?? 0) <= now);
      const spare = facts.spare().cobblestone ?? 0;
      if (placed >= WORKS_FURNACES) reasons.works = 'furnaces placed';
      else if (!k) reasons.works = 'busy';
      else if (spare < 8) reasons.works = 'cobblestone short';
      else {
        const cell = worksFurnaces(wk)[k - 1];
        add({
          id: `works:furnace:${k}`, kind: 'works', key: `worksfurnace:${k}`, excludes: [`worksfurnace:${k}=`, 'works='], name: 'Put a furnace on the works plot', rank: 851 + k,
          at: { x: cell.x, y: wk.y + 1, z: cell.z },
          facts: `${placed} of ${WORKS_FURNACES} furnaces stand; takes 8 cobblestone (${spare} spare); ${record('works')}${others('works')}`,
          effect: `a ${ORDINALS[placed + 2] ?? 'further'} furnace: smelting jobs side by side`,
        }, { kind: 'works', stage: 'furnace', k });
      }
    }

    // Lighting (B.4): a chore a part, its torches from the spare storage (earmarked from the queue, D6), buildings first,
    // most unlit first, then the mine's parts; a mine part still growing waits for 2 unlit spots (ranks 860-899: here, so
    // the options stay in rank order, which the fixed sweep's first option relies on)
    if (!family('light')) {
      // (off)
    } else if (!v.storageHut) reasons.light = 'no hut';
    else {
      let spare = facts.spare().torch ?? 0;
      const why: string[] = [];
      const ts = timeScale();
      for (const [r, P] of this.lightParts(v).entries()) {
        if (excluded([`light:${P.part}=`], busy)) {
          why.push('busy');
          continue;
        }
        if ((this.lightBack.get(`${v.name}:${P.part}`) ?? 0) > now) {
          why.push('backing off');
          continue;
        }
        if (P.unlit < (P.kind === 'mine' && P.growing ? MINE_LIGHT_MIN : 1)) {
          why.push('nothing unlit');
          continue;
        }
        // (N.2: another member's house is its own to light; one's own is named so and goes first, H8)
        const owner = HOUSING && P.structure ? this.houseOwner(v, P.structure) : undefined;
        const theirs = owner && owner !== a.name ? owner : undefined;
        if (theirs && this.ownDecorHeld(v, `light:${P.part}`, theirs, now)) {
          why.push("others' houses");
          continue;
        }
        const n = Math.min(P.unlit, LIGHT_TRIP, spare);
        if (n < Math.min(P.unlit, LIGHT_MIN_TRIP)) {
          why.push('torches short');
          continue;
        }
        const id = `light:${P.part}`;
        const tail = `${record('light')}${others('light', id)}${lastOf('light', id)}`;
        let facts2: string, effect: string, at: { x: number; y?: number; z: number } | undefined;
        if (P.kind === 'building') {
          const r0 = v.lights?.[P.part];
          const k = P.spots.filter((q) => q.src === 'vanilla' && !r0?.done.includes(`${q.x},${q.y},${q.z}`) && !r0?.never?.includes(`${q.x},${q.y},${q.z}`)).length;
          const d = P.walk ?? 0;
          const min = Math.max(0.1, Math.round(((0.3 + (2 * d) / 4.3 / 60) / ts) * 10) / 10);
          // (short enough for add()'s 240-character cut with a record, others on it and a last end: the tail is what the cut
          // took first, B.4's review, lens 2 L4)
          facts2 = `${P.unlit} of ${P.spots.length} torch spots unlit${k ? ` (${k} vanilla's own)` : ''}; takes ${n} torches (${spare} spare); walks ${d} blocks from the hut and back, ~${min} min; ${tail}`;
          effect = `+${n} torches in the ${P.label}: for the village's look (time stands at day and no mobs spawn in this peaceful world, so the light is for the look)`;
          const door = P.place ? placedDoor(P.place) : null;
          if (door && P.structure) at = { x: door.x, y: P.structure.y + 1, z: door.z };
        } else {
          const min = Math.max(0.1, Math.round((0.4 / ts) * 10) / 10);
          facts2 = `${P.unlit} of ${P.spots.length} torch spots unlit; takes ${n} torches from storage (${spare} spare); set from the storage hut by command, ~${min} min; ${tail}`;
          // (no claim the bots need it: they dig in the dark as well, lesson 127; B.4's review, lens 2 L3)
          effect = `+${n} torches along the ${P.label}: for the look of the tunnels (bots dig in the dark too; no mobs spawn here)`;
        }
        add({
          id, kind: 'light', key: id, excludes: [`${id}=`], name: theirs ? `Help light ${theirs}'s house (${P.label})` : owner ? `Light your own house (${P.label})` : `Light the ${P.label}`, rank: Math.min(899, 860 + r) - (owner && !theirs ? 5 : 0), ...(at ? { at } : {}),
          facts: theirs ? `${theirs}'s house; ${facts2}` : owner ? `your own house; ${facts2}` : facts2, effect,
        }, { kind: 'light', part: P.part, n, unlit: P.unlit, label: P.label });
        spare -= n;
      }
      if (!out.some((o) => o.kind === 'light')) reasons.light = ['torches short', 'backing off', 'busy', "others' houses"].find((w) => why.includes(w)) ?? 'nothing unlit';
    }

    // Making into storage (the workshop, D1): each good below its target with a whole batch from spare storage; crafting
    // at the hut (MAKE_PARALLEL at once), smelting at a free furnace each (the works plot's, then the hut's)
    if (!family('make')) {
      // (off)
    } else if (!v.storageHut || !villageStationCell(v, 'crafting_table') || !villageStationCell(v, 'furnace')) reasons.make = 'no workshop';
    else {
      const plans = facts.makePlans();
      const going = this.goingS9(v).make;
      const crafting = going.filter((g) => !g.smelts).length;
      const free = this.freeFurnaces(v, busy);
      let nextFurnace = 0;
      const goingOf = (item: string) => going.filter((g) => g.item === item).reduce((s, g) => s + g.count, 0);
      // (the deficit order: the largest share of its target missing first, ties in the table's order)
      // (with lighting on, torches by their demand's target, L10: both reads)
      // (food goods only where the village keeps an appetite, ranked by D13: after the cake, before it while food is short)
      const goods = this.goodsFor(v);
      const order = goods.map((g, i) => ({ g, i, target: this.makeTarget(v, g) })).map(({ g, i, target }) => ({ g, i, target, d: Math.max(0, target - (store[g.item] ?? 0) - goingOf(g.item)) / target })).sort((p, q) => q.d - p.d || p.i - q.i);
      const why = new Set<string>();
      let atStock = 0;
      // (food goods present: by the flag, the catalogue's goods outnumber the keeps without any, the critique's 12)
      const foodLow = goods.some((g) => g.food) && foodPoints(store) < 5 * this.growMembers(v).length;
      for (const [r, { g, target }] of order.entries()) {
        const p = plans.get(g.item);
        if (!p || 'why' in p) {
          if (p && p.why === 'at stock') atStock++;
          else why.add('inputs short');
          continue;
        }
        if (excluded([`make:${g.item}=`], busy)) {
          why.add('busy');
          continue;
        }
        const back = this.makeBack.get(`${v.name}:${g.item}`);
        if (back && now - back.at < (effTries(back.tries, back.at, now) >= 3 ? 60 : 10) * 60000) {
          why.add('backing off');
          continue;
        }
        let k: number | undefined;
        if (p.smelts) {
          k = free[nextFurnace];
          if (k === undefined) {
            why.add('furnaces busy');
            continue;
          }
          nextFurnace++;
        } else if (crafting >= MAKE_PARALLEL) {
          why.add('hut busy');
          continue;
        }
        const stock = store[g.item] ?? 0;
        const smelts = p.smelts ? this.materials.plan(p.bill, p.inputs).fuel.smelts : 0;
        const min = Math.max(0.1, Math.round(((0.3 + (smelts * 10) / 60) / timeScale()) * 10) / 10);
        const cell = k === undefined ? villageStationCell(v, 'crafting_table') : k === 0 ? villageStationCell(v, 'furnace') : (() => {
          const f = wk?.furnaces?.[k - 1];
          return f ? { x: f.x, y: f.y, z: f.z } : null;
        })();
        add({
          id: `make:${g.item}`, kind: 'make', key: `make:${g.item}`, holds: k === undefined ? [] : [`furnace:${k}`], excludes: [`make:${g.item}=`, ...(k === undefined ? [] : [`furnace:${k}=`])],
          // (900 + r below gathering's 950 with the catalogue's many goods too, X.1: the options stay in rank order)
          name: `Make ${g.words}`, rank: g.food ? (foodLow ? 590 : 610) + (g.item === 'pumpkin_pie' ? 5 : 0) : 900 + Math.min(r, 49), ...(cell ? { at: { x: cell.x, y: cell.y, z: cell.z } } : {}),
          facts: `${stock} of the ${target} kept are in storage; this batch of ${p.count} takes ${countsText(p.inputs)} (all spare); ${k === undefined ? `crafted at the hut, ~${min} min` : `smelted at ${k ? `works furnace ${numberWord(k)}` : "the hut's furnace"}, ~${min} min`}; ${record('make')}${others('make', `make:${g.item}`)}${lastOf('make', `make:${g.item}`)}`,
          // (torches with lighting on: the spots beyond what storage holds, or the reserve once it covers them; the demand alone
          // read as the reason with 28 stored for 10 spots, B.4's review, lens 2 L1)
          effect: `+${p.count} ${g.words} (${stock} stored): ${g.item === 'torch' && family('light') ? torchWhy(this.torchDemand(v), stock) : g.forWhat}`,
        }, { kind: 'make', good: g, count: p.count, inputs: p.inputs, smelts: p.smelts, stock, ...(k === undefined ? {} : { k }) });
      }
      if (!out.some((o) => o.kind === 'make')) reasons.make = atStock === goods.length ? 'all at stock' : ['inputs short', 'hut busy', 'furnaces busy', 'backing off', 'busy'].find((w) => why.has(w)) ?? 'all at stock';
    }

    // Gathering for the workshop (D9): one option a material, as much as the goods' deficits, the keeps and the furnaces
    // want less what is on the way; sand two at once, logs three (within the hourly cap), cobblestone a free mine face each
    if (family('gather')) {
      const want = facts.gather();
      const going = this.goingS9(v).gather;
      const order = MATERIALS.map((m, i) => ({ m, i })).sort((p, q) => want[q.m].want - want[p.m].want || p.i - q.i);
      const logsHour = (this.gatherLog.get(v.name) ?? []).filter((e) => now - e.at < 60 * 60000).reduce((s, e) => s + e.n, 0);
      const why: string[] = [];
      for (const [r, { m }] of order.entries()) {
        const w = want[m], spec = GATHER_KINDS[m];
        if (w.want <= 0) continue;
        const held = [...busy].filter((key) => key.startsWith(`gather:${m}:`)).length;
        let trip = Math.min(spec.trip, w.want), extra = '';
        if (m === 'sand' && v.unavailable?.includes('sand')) {
          why.push('no sand near');
          continue;
        }
        if ((this.gatherBack.get(`${v.name}:${m}`) ?? 0) > now) {
          why.push('backing off');
          continue;
        }
        if (spec.atOnce === 'faces') {
          // (S.2's gate: a queued or walking miner holds no face yet, so the trips under way count against the faces; and
          // not the stairs down once the iron level exists, the check's M2 and L12)
          if (!mineCanGive(v, 'cobblestone')) {
            why.push('no mine');
            continue;
          }
          const f = this.faces(v);
          const free = Math.max(0, f.faces - (v.mine?.iron ? f.down : 0) - Math.max(f.held, going.filter((x) => x.material === m).length));
          if (free <= 0) {
            why.push('mine busy');
            continue;
          }
          extra = `; the mine has ${free} free face${free === 1 ? '' : 's'}`;
        } else if (held >= spec.atOnce) {
          why.push('busy');
          continue;
        }
        if (m === 'logs') {
          const left = GATHER_LOGS_HOUR - logsHour - w.incoming;
          if (left <= 0) {
            why.push('logs capped');
            continue;
          }
          trip = Math.min(trip, left);
        }
        if (w.incoming > 0 && trip < GATHER_MIN_TRIP[m]) {
          why.push('trip too small');
          continue;
        }
        let n = 1;
        while (busy.has(`gather:${m}:${n}`)) n++;
        const stored = m === 'logs' ? (v.wood ? store[`${v.wood}_log`] ?? 0 : Object.entries(store).filter(([x]) => /_log$/.test(x)).reduce((s, [, q]) => s + q, 0)) : store[m] ?? 0;
        const goods = w.for.slice(0, 4).join(', ') || 'the workshop';
        add({
          id: `gather:${m}`, kind: 'gather', key: `gather:${m}:${n}`, excludes: [`gather:${m}:${n}=`], name: spec.words, rank: 950 + r,
          facts: `${m}: ${spec.forWhat}; storage holds ${stored}, the workshop wants ${w.need} (${goods}); ${w.incoming} on the way${extra}`,
          effect: `+${trip} ${m} toward ${goods}`,
          // (the catalogue's wood goods plan from its pinned kind's logs: with the catalog family, that kind is felled, X.1)
        }, { kind: 'gather', material: m, n, amount: trip, block: spec.block(v.wood ?? (family('catalog') ? v.catalogWood : undefined)), deposit: spec.deposit(v.wood), need: w.need, incoming: w.incoming, for: w.for });
      }
      if (!out.some((o) => o.kind === 'gather')) reasons.gather = why[0] ?? 'nothing wanted';
    }

    // Furnishing (X.1): a chore a building, its open furniture spots (buildingDecor's) whose pieces the spare storage holds,
    // FURNISH_TRIP at most, earmarked from the queue as lighting's torches (ranks 1000 + r: after gathering, in rank order)
    if (!family('furnish')) {
      // (off)
    } else if (!v.storageHut) reasons.furnish = 'no hut';
    else {
      const spare = { ...facts.spare() };
      const why: string[] = [];
      const ts = timeScale();
      for (const [r, P] of this.decorParts(v).filter((q) => q.open.length).entries()) {
        const id = `furnish:${P.part}`;
        if (excluded([`${id}=`], busy)) {
          why.push('busy');
          continue;
        }
        if ((this.decorBack.get(`${v.name}:${P.part}`) ?? 0) > now) {
          why.push('backing off');
          continue;
        }
        // (N.2: another member's house is its own to furnish; one's own is named so and goes first, H8)
        const owner = HOUSING ? this.houseOwner(v, P.structure) : undefined;
        const theirs = owner && owner !== a.name ? owner : undefined;
        if (theirs && this.ownDecorHeld(v, id, theirs, now)) {
          why.push("others' houses");
          continue;
        }
        const items: Counts = {};
        let n = 0;
        for (const q of P.open) {
          if (n >= FURNISH_TRIP) break;
          const need: Counts = { [q.item]: 1 };
          if (q.also) need[q.also.item] = (need[q.also.item] ?? 0) + 1;
          if (!Object.entries(need).every(([k, c]) => (spare[k] ?? 0) - (items[k] ?? 0) >= c)) continue;
          for (const [k, c] of Object.entries(need)) items[k] = (items[k] ?? 0) + c;
          n++;
        }
        if (n < Math.min(P.open.length, FURNISH_MIN_TRIP)) {
          why.push('furniture short');
          continue;
        }
        for (const [k, c] of Object.entries(items)) spare[k] -= c;
        const d = P.walk ?? 0;
        const min = Math.max(0.1, Math.round(((0.4 + (2 * d) / 4.3 / 60) / ts) * 10) / 10);
        const door = placedDoor(P.place);
        add({
          id, kind: 'furnish', key: id, excludes: [`${id}=`], name: theirs ? `Help furnish ${theirs}'s house (${P.label})` : owner ? `Furnish your own house (${P.label})` : `Furnish the ${P.label}`, rank: 1000 + r - (owner && !theirs ? 5 : 0),
          ...(door ? { at: { x: door.x, y: P.structure.y + 1, z: door.z } } : {}),
          facts: `${theirs ? `${theirs}'s house; ` : owner ? 'your own house; ' : ''}${P.spots.length - P.open.length} of ${P.spots.length} furniture spots done; takes ${countsText(items)} (spare); walks ${d} blocks from the hut and back, ~${min} min; ${record('furnish')}${others('furnish', id)}${lastOf('furnish', id)}`,
          effect: `+${n} pieces of furniture in the ${P.label} (chairs, tables, workbenches, barrels): for the village's look and its homes`,
        }, { kind: 'furnish', part: P.part, n, items, open: P.open.length, label: P.label });
      }
      if (!out.some((o) => o.kind === 'furnish')) reasons.furnish = ['furniture short', 'backing off', 'busy', "others' houses"].find((w) => why.includes(w)) ?? 'nothing to furnish';
    }

    // N.2 (MC_HOUSING): a houseless member's first preference, a street of houses of its own starting (H3)
    if (HOUSING) {
      const g = v.growth;
      const why = !GROW.on ? 'growth off' : this.homeOf(v, a.name) ? 'has a house' : g?.active ? 'a layout is being built' : g?.request ? 'a street is asked for' : this.voting.has(v.name) ? 'a vote is under way'
        : g?.stop ? 'growth stopped' : (g?.backoff ?? 0) > now || (this.growError.get(v.name) ?? 0) > now ? 'backing off'
        : excluded(['grow='], busy) || [...this.chores.values()].some((c) => c.village === v.name && c.key === 'grow') ? 'busy'
        : !this.growClaimers(v).length ? 'no builders' : '';
      if (why) reasons.grow = why;
      else {
        const without = this.homeless(v).length, M = this.growMembers(v).length, more = Math.min(GROW.batch, without) - 1;
        add({
          id: 'grow:street', kind: 'grow', key: 'grow', excludes: ['grow='], rank: 1,
          name: `Start a street of houses: your own${more > 0 ? ` and up to ${more} more for members without one` : ''} (your own project)`,
          facts: `you have no house; ${without} of ${M} members have none; a small street near the village, built from the task board by the village's workers with you; your name goes on your house's sign`,
          effect: `a house of your own${more > 0 ? ` and homes for ${more} other${more > 1 ? 's' : ''}` : ''}`,
        }, { kind: 'grow', houseless: without });
      }
    }

    // Initiatives (s35): each open one's next step for anyone (ranks 1050 + r), then up to two of the member's own to start
    // (1100 + r) while fewer than INITIATIVES_MAX are open and it has none of its own open
    if (family('initiatives') && INITIATIVES_MAX > 0 && v.storageHut) {
      const open = (v.initiatives ?? []).filter((i) => i.state === 'open');
      const why: string[] = [];
      for (const [r, it] of open.entries()) {
        const kindOf = SMALL_WORKS.find((k) => k.kind === it.kind);
        if (!kindOf) continue;
        if ((it.backoff ?? 0) > now) {
          why.push('backing off');
          continue;
        }
        const step = this.initiativeStep(v, it, facts.spare(), busy);
        if (!step) {
          why.push('busy');
          continue;
        }
        const mine = it.by === a.name;
        const id = `help:${it.id}`;
        const key = step.what === 'gather' ? `initiative:${it.id}:${[1, 2].find((n) => !busy.has(`initiative:${it.id}:${n}`)) ?? 1}` : `initiative:${it.id}:${step.what}`;
        const crew = it.crew.filter((n) => n !== a.name);
        const short = step.what === 'build' ? 'build it' : step.what === 'prepare' ? `prepare a ${GREEN_SIZE}x${GREEN_SIZE} green for it` : `gather ${step.amount} ${step.material}`;
        const where = it.pending ? 'no spot yet: a green near the village first' : `at ${it.x},${it.z}`;
        add({
          id, kind: 'help', key, excludes: [`${key}=`, ...(step.what === 'gather' ? [`initiative:${it.id}:build=`] : [`initiative:${it.id}:`])],
          name: mine ? `Continue your ${kindOf.words}: ${short}` : `Help ${it.by} build a ${kindOf.words}: ${short}`,
          rank: 1050 + r, at: { x: it.x, y: it.y, z: it.z },
          facts: `${mine ? 'your own project' : `${it.by}'s project`}, started ${ago(now - it.at)}; ${crew.length ? `helping: ${crew.slice(0, 4).join(', ')}${crew.length > 4 ? ` and ${crew.length - 4} more` : ''}` : 'nobody helping yet'}; ${it.steps.length} steps taken; ${where}${step.what === 'gather' ? `; ${step.material} still to gather for it` : step.what === 'build' ? '; its materials are gathered' : ''}`,
          effect: step.what === 'build' ? `a ${kindOf.words} stands in the village: ${kindOf.forWhat}` : step.what === 'prepare' ? `level ground for the ${kindOf.words} and later small works` : `+${step.amount} ${step.material} toward the ${kindOf.words} (${kindOf.forWhat})`,
        }, { kind: 'help', id: it.id, step });
      }
      const mineOpen = open.some((i) => i.by === a.name);
      if (mineOpen) why.push('own project open');
      else if (open.length >= INITIATIVES_MAX) why.push('enough projects open');
      else {
        const wood = this.catalogWoodOf(v);
        // (two kinds a member, seeded by its name and how many initiatives the village has had: members differ, and a
        // member's offer changes once one is started)
        const order = shuffled(SMALL_WORKS, `${a.name}|${v.initiativeN ?? 0}`);
        let r = 0;
        const roomless: SmallWorkKind[] = [];
        for (const k of order) {
          if (r >= 2) break;
          const spot = this.smallWorkSpot(v, k, wood, a.name);
          if (!spot) {
            roomless.push(k);
            continue;
          }
          const d = k.make(wood);
          // (only a work whose first step can be taken now: otherwise it would open, sit and lapse; s36)
          if (!this.initiativeStep(v, { id: '_new', design: d.name }, facts.spare(), busy, d)) {
            why.push('nothing to gather for it now');
            continue;
          }
          const bill = inWood(designBill(d), wood);
          const raw = this.materials.plan(bill, {}).gather;
          // (logs of any kind counted with the wood's own: "18 birch_log", not "17 birch_log, 1 logs")
          const sum: Record<string, number> = {};
          for (const [n, q] of Object.entries(raw)) if (q > 0) {
            const key = n === 'any:logs' ? `${wood}_log` : n.replace(/^any:/, '');
            sum[key] = (sum[key] ?? 0) + q;
          }
          const takes = Object.entries(sum).map(([n, q]) => `${q} ${n}`).join(', ');
          add({
            id: `initiate:${k.kind}`, kind: 'initiate', key: `initiate:${a.name.toLowerCase()}`, excludes: [`initiate:${a.name.toLowerCase()}=`],
            name: `Start building a ${k.words} (your own project)`, rank: 1100 + r, at: spot,
            facts: `a ${d.width}x${d.depth} ${k.words} at ${spot.x},${spot.z}; takes ${takes || 'little'}, gathered by you and whoever helps; ${open.length} of ${INITIATIVES_MAX} projects open; others may help you`,
            effect: `your own ${k.words} in the village: ${k.forWhat}`,
          }, { kind: 'initiate', work: k.kind });
          r++;
        }
        // (no room on the plots for a kind: started on a green of its own, one green prepared at a time and at most
        // GREENS_MAX a village, s36)
        const greens = v.plots.filter((p) => p.green).length;
        const greensMax = Math.max(1, Math.ceil(this.growMembers(v).length / GREENS_PER));
        if (!r && roomless.length && !open.some((i) => i.pending) && greens < greensMax) {
          const k = roomless[0];
          const d = k.make(wood);
          add({
            id: `initiate:${k.kind}`, kind: 'initiate', key: `initiate:${a.name.toLowerCase()}`, excludes: [`initiate:${a.name.toLowerCase()}=`],
            name: `Start building a ${k.words} on a new green (your own project)`, rank: 1100 + r,
            facts: `no room left on the village's plots: first a ${GREEN_SIZE}x${GREEN_SIZE} green is prepared near the village (room for more small works), then a ${d.width}x${d.depth} ${k.words}; ${open.length} of ${INITIATIVES_MAX} projects open; others may help you`,
            effect: `your own ${k.words} on a new green: ${k.forWhat}`,
          }, { kind: 'initiate', work: k.kind, green: true });
          r++;
        }
        if (!r) why.push(greens >= greensMax ? 'no room (greens full)' : open.some((i) => i.pending) ? 'no room (a green is being prepared)' : 'no room');
      }
      // (help's own reasons only: initiate's "no room" is not why nothing can be helped, s36)
      if (!out.some((o) => o.kind === 'help')) reasons.help = (open.length ? why.find((w) => w === 'busy' || w === 'backing off') : undefined) ?? 'no project open';
      if (!out.some((o) => o.kind === 'initiate')) reasons.initiate = why.find((w) => w !== 'busy' && w !== 'backing off') ?? 'no room';
    }

    // A.3p: the temperament's weight on every option (both modes; the fixed pick and the trim read it), from the kind and
    // sociability's pull toward the kinds other members are on now
    if (TEMPERAMENT_MODE !== 'off') {
      const tv = temperament(a.name);
      const weights = kindWeights(tv);
      const on = new Map<string, number>();
      for (const c of this.chores.values()) if (c.village === v.name && c.agent !== a.name && !c.choice.ended && c.choice.kind) on.set(c.choice.kind, (on.get(c.choice.kind) ?? 0) + 1);
      // (a help option pulls a sociable member by its crew: members on its steps come and go, s35's check 10)
      const crewOf = (o: ChoiceOption) => {
        const d = OPTION_RUN.get(o);
        return d?.kind === 'help' ? (v.initiatives ?? []).find((i) => i.id === d.id)?.crew.filter((n) => n !== a.name).length ?? 0 : undefined;
      };
      for (const o of out) o.tw = optionWeight(tv, weights, o.kind, crewOf(o) ?? on.get(o.kind) ?? 0);
      // (N.2: a house of one's own is a houseless member's first preference whatever its temperament: the scale's top, H3)
      for (const o of out) if (o.kind === 'grow') o.tw = 2.5;
    }
    // N.1 (MC_NEEDS=on): an option that answers a village need at LOW or above says so, and the need weighs on it by its
    // level and the member's trait for it (needWeight; a neutral trait without temperaments)
    if (NEEDS_MODE === 'on') {
      const reads = new Map((this.needReadings.get(v.name) ?? []).filter((r) => r.level >= LOW).map((r) => [r.kind, r]));
      if (reads.size) {
        const tv = TEMPERAMENT_MODE !== 'off' ? temperament(a.name) : null;
        const demand = this.needDemand(v);
        for (const o of out) {
          const k = this.needOf(v, o, demand);
          const r = k && reads.get(k);
          if (!k || !r) continue;
          o.need = `village need: ${r.text}`;
          o.nw = Math.round(needWeight(r.level, tv ? tv[NEED_TRAIT[k]] : 0.5) * 100) / 100;
        }
      }
    }

    // The appetite (s30): the food makes and the meal in rank order (the fixed sweep runs the first option); a hungry member
    // takes food work only (D8), the rest guarded in model mode, left out in fixed mode, with why
    const starved: ChoiceOption[] = [];
    if (appetiteOn(v)) {
      out.sort((p, q) => p.rank - q.rank);
      if (state === 'hungry') {
        starved.push(...out.filter((o) => !isFoodKind(o.kind, o)));
        out.splice(0, out.length, ...out.filter((o) => isFoodKind(o.kind, o)));
        if (!guards) for (const o of starved) reasons[o.kind] ??= 'hungry';
      }
    }
    // Model mode's guards (D5): bans, the agent's own cooldown, learning progress, then the trim
    const guarded: Array<{ id: string; why: string }> = guards ? starved.map((o) => ({ id: o.id, why: 'hungry' })) : [];
    let options = out;
    // (`feasible`: guarded but not trimmed; the trim only presents the menu, so a pick it would cut now is still runnable)
    let feasible = out;
    if (guards) {
      options = [];
      for (const o of out) {
        const ban = this.choiceStats.banned(v.name, o.kind, o.id, now);
        if (ban) {
          guarded.push({ id: o.id, why: `banned until ${clock(ban.until)}` });
          continue;
        }
        if (this.choiceStats.agentCooling(v.name, a.name, o.kind, now, o.kind === 'make' || o.kind === 'gather' || o.kind === 'light' || o.kind === 'furnish' || o.kind === 'initiate' || o.kind === 'help' ? o.id : undefined)) {
          guarded.push({ id: o.id, why: 'you failed this kind in the last 5 minutes' });
          continue;
        }
        if (o.lp === undefined) o.lp = Math.round((0.5 + this.choiceStats.learningProgress(v.name, o.kind)) * 100) / 100;
        options.push(o);
      }
      feasible = options;
      const kept = trimMenu(options);
      for (const o of options) if (!kept.includes(o)) guarded.push({ id: o.id, why: 'trimmed' });
      options = kept;
    }
    for (const o of options) if (reasons[o.kind]) delete reasons[o.kind];
    return { options, feasible, effects: { skips }, reasons, guarded };
  }

  /** A.3p's own-pattern line from the agent's last 10 ends ('' when temperaments are off or none yet). */
  private patternLine(v: Village, a: BotAgent): string {
    const counts = TEMPERAMENT_MODE === 'off' ? [] : this.choiceStats.kindCounts(v.name, a.name, 10);
    const total = counts.reduce((s, c) => s + c.n, 0);
    // (farm and slot are both harvesting: one entry a phrase, in the counts' order)
    const byPhrase = new Map<string, number>();
    for (const c of counts) byPhrase.set(KIND_PHRASE[c.kind] ?? c.kind, (byPhrase.get(KIND_PHRASE[c.kind] ?? c.kind) ?? 0) + c.n);
    return total ? `Your last ${total} chore${total === 1 ? '' : 's'}: ${[...byPhrase.entries()].sort((x, y) => y[1] - x[1]).map(([p, n]) => `${p} ${n}`).join(', ')}` : '';
  }

  /** The prompt's context (pure): the village at a glance, the others' chores, the agent's last outcomes. */
  private choiceContext(v: Village, a: BotAgent, facts: Facts): ChoiceContext {
    const s = facts.store;
    const items = ['wheat', 'wheat_seeds', 'bread', 'raw_iron', 'bucket', 'milk_bucket', 'egg', 'sugar_cane', 'cake', ...(CHOOSE.families.has('light') ? ['torch'] : [])].filter((n) => s[n]).map((n) => `${s[n]} ${words(n)}`);
    const lay0 = v.layouts?.[0];
    const slots = (v.layouts ?? []).flatMap((l) => l.slots ?? []);
    const farms = [...(v.layouts ?? []).filter((l) => l.farm?.planted).map(() => 'a wheat field'), ...slots.filter((q) => !q.annex && q.kind).map((q) => `${words(q.kind!)} on a slot`)];
    const freeN = slots.filter((q) => !q.annex && !q.kind).length;
    const pens = slots.filter((q) => q.annex && q.kind && q.pen?.built).map((q) => `${q.pen?.animals ?? 0} ${q.kind}s`);
    const m = v.mine;
    const iron = !m || m.level === undefined ? 'no mine' : (m.ironMade ?? []).length ? `made ${(m.ironMade ?? []).map(words).join(', ')}` : m.iron ? 'being dug' : 'not started';
    const village = [`${v.name}, complete`, `Storage: ${items.join(', ') || 'nothing of note'}`,
      `Farms: ${farms.join(', ') || 'none'}${freeN ? `, ${freeN} slot${freeN === 1 ? '' : 's'} free` : ''}`,
      `Pens: ${lay0?.annex?.state === 'ready' ? pens.join(', ') || 'none yet' : 'no annex yet'}`,
      `Explored: ${v.explore?.visited.length ?? 0} of 8 points round the village`, `Iron: ${iron}`].join('. ');
    const kinds = new Map<string, string[]>();
    let choosing = 0, idle = 0;
    for (const b of this.agents.values()) {
      if (b === a || b.village()?.name !== v.name) continue;
      const c = this.chores.get(b.name.toLowerCase());
      if (c && !c.choice.ended) {
        const k = c.choice.kind ?? c.key.split(':')[0];
        kinds.set(k, [...(kinds.get(k) ?? []), b.name]);
      } else if (this.pending.has(b.name.toLowerCase())) choosing++;
      else if (b.idle()) idle++;
    }
    const others = [...[...kinds.entries()].map(([k, n]) => `${KIND_WORDS[k] ?? k} ${n.length} (${n.slice(0, 3).join(', ')}${n.length > 3 ? ', ...' : ''})`),
      ...(choosing ? [`choosing ${choosing}`] : []), `idle ${idle}`].join(', ');
    // (A.3p: the user's own persona first, else the temperament's line; the own-pattern reminder from the last 10 ends)
    const own = typeof a.memory.persona === 'string' ? a.memory.persona.slice(0, 300) : '';
    const pattern = this.patternLine(v, a);
    return {
      persona: own || personaOf(a.name),
      ...(pattern ? { pattern } : {}),
      village: village.slice(0, 300), others: others.slice(0, 200),
      outcomes: this.choiceStats.outcomes(v.name, a.name, 5),
      // (N.1: the needs at LOW or above, most acute first)
      ...(NEEDS_MODE === 'on' && (this.needReadings.get(v.name) ?? []).some((r) => r.level >= LOW)
        ? { needs: (this.needReadings.get(v.name) ?? []).filter((r) => r.level >= LOW).sort((x, y) => y.level - x.level).slice(0, 3).map((r) => r.text) } : {}),
    };
  }

  /**
   * Run an option: the writes the old picker made at queue time (spec 1.3: a pen's workAt, the cake's back-off, the explore
   * ring), then the skill queued and the chore recorded. Called only inside runPick's try (D9).
   */
  private runOption(v: Village, worker: BotAgent, opt: ChoiceOption, meta: ChoiceMeta) {
    this.needNote(v, undefined, opt);
    const d = OPTION_RUN.get(opt);
    if (!d) throw new Error(`no run data for ${opt.id}`);
    switch (d.kind) {
      case 'eat':
        this.setChore(v, worker, opt.key, [worker.enqueue('eat_meal', { chore: true })], `eat ${d.n} ${d.item}`, undefined, meta, opt.holds, opt);
        // (held from the other members' meals and claims until the chore ends: lens 1 M1)
        holdMeal(v.name, worker.name, { item: d.item, n: d.n });
        console.log(`[food] ${v.name}: ${worker.name} goes to eat ${d.n} ${d.item} (${d.level.toFixed(1)} of 20)`);
        return;
      case 'farm':
        // (`chore`: the brains leave its events alone, as the mayor's gathering)
        this.setChore(v, worker, opt.key, [worker.enqueue('harvest_farm', { layout: d.k, chore: true })], `harvest the wheat on layout ${d.k}`, undefined, meta, opt.holds, opt);
        console.log(`[farm] ${v.name} layout ${d.k}: ${d.ripe} of ${d.grown} wheat ripe, ${worker.name} harvests`);
        this.villages.note(v, `${d.ripe} of ${d.grown} wheat ripe on layout ${d.k}'s farm: ${worker.name} harvests it (a chore)`);
        return;
      case 'slot':
        this.setChore(v, worker, opt.key, [worker.enqueue('harvest_slot', { layout: d.k, slot: d.j, chore: true })], `harvest ${d.slotKind}`, undefined, meta, opt.holds, opt);
        console.log(`[farm] ${v.name} slot ${d.k}.${d.j}: ${d.ripe} ${d.slotKind} ripe, ${worker.name} harvests`);
        return;
      case 'start':
        // (from storage, s30's D4: a kind the village farms on another slot)
        if (d.store) {
          this.setChore(v, worker, opt.key, [worker.enqueue('start_farm', { layout: d.k, slot: d.j, kind: d.slotKind, from: 'storage', chore: true })], `start ${d.slotKind}`, undefined, meta, opt.holds, opt);
          console.log(`[farm] ${v.name}: ${worker.name} starts a ${d.slotKind} farm on slot ${d.k}.${d.j} from storage`);
          this.villages.note(v, `${worker.name} starts a ${d.slotKind} farm on farm slot ${d.j} of layout ${d.k} from the village storage (a chore)`);
          return;
        }
        this.setChore(v, worker, opt.key, [worker.enqueue('start_farm', { layout: d.k, slot: d.j, kind: d.slotKind, x: d.x, y: d.y, z: d.z, chore: true })], `start ${d.slotKind}`, undefined, meta, opt.holds, opt);
        console.log(`[farm] ${v.name}: ${d.slotKind} seen at ${d.x},${d.y},${d.z}; ${worker.name} starts a ${d.slotKind} farm on slot ${d.k}.${d.j}`);
        this.villages.note(v, `${d.slotKind} seen at ${d.x},${d.y},${d.z}: ${worker.name} starts a ${d.slotKind} farm on farm slot ${d.j} (a chore)`);
        return;
      case 'annex':
        this.setChore(v, worker, opt.key, [worker.enqueue('prepare_annex', { chore: true })], 'prepare the annex', undefined, meta, opt.holds, opt);
        console.log(`[annex] ${v.name}: ${worker.name} prepares the annex${d.again ? ` at ${d.area} (again)` : ''}`);
        return;
      case 'pen':
        this.setChore(v, worker, opt.key, [worker.enqueue('start_pen', { layout: 1, slot: d.j, kind: d.slotKind, x: d.x, y: d.y, z: d.z, chore: true })], `start a ${d.slotKind} pen`, undefined, meta, opt.holds, opt);
        console.log(`[pen] ${v.name}: ${d.slotKind} seen at ${d.x},${d.y},${d.z}; ${worker.name} starts a pen on annex slot ${d.j}`);
        this.villages.note(v, `${d.slotKind}s seen at ${d.x},${d.y},${d.z}: ${worker.name} leads them into a pen on the annex (a chore)`);
        return;
      case 'penwork': {
        const pen = v.layouts?.[0]?.slots?.[d.j - 1]?.pen;
        if (!pen) throw new Error(`no pen on annex slot ${d.j}`);
        // (each kind of work backs off after it was queued, done or not)
        pen.workAt = { ...pen.workAt, [d.what]: Date.now() };
        this.villages.save();
        this.setChore(v, worker, opt.key, [worker.enqueue(d.skill, { layout: 1, slot: d.j, chore: true })], `${d.skill} on annex slot ${d.j}`, undefined, meta, opt.holds, opt);
        console.log(`[pen] ${v.name}: ${worker.name} ${d.skill} on annex slot ${d.j} (${d.slotKind}, ${d.animals} in the pen)`);
        return;
      }
      case 'cake':
        this.cakeAt.set(v.name, Date.now());
        this.setChore(v, worker, opt.key, [worker.enqueue('bake_cake', { chore: true })], 'bake a cake', undefined, meta, opt.holds, opt);
        console.log(`[cake] ${v.name}: ${worker.name} bakes a cake`);
        return;
      case 'iron': {
        const stage = d.stage;
        const status = stage === 'dig'
          ? worker.enqueue('dig_iron', { chore: true, minutes: 4, want: Math.max(1, (d.tool === 'bucket' ? 3 : 6) - d.iron) })
          : worker.enqueue('make_iron_tool', { item: stage, chore: true });
        const failed = (why: string) => {
          const mm = v.mine;
          if (!mm || why === 'cancelled') return;
          mm.ironTries = { ...(mm.ironTries ?? {}), [stage]: (mm.ironTries?.[stage] ?? 0) + 1 };
          mm.ironLastTry = { at: Date.now(), stage, why: why.slice(0, 200) };
          this.villages.save();
        };
        this.setChore(v, worker, opt.key, [status], `iron: ${stage}`, failed, meta, opt.holds, opt);
        console.log(`[iron] ${v.name}: ${worker.name} ${stage === 'dig' ? `digs the iron level (${d.iron} iron in storage)` : `makes a ${stage}`}`);
        return;
      }
      case 'explore': {
        const ex = (v.explore ??= { visited: [] });
        ex.visited.push(d.i);
        ex.last = `${worker.name} to ${d.x},${d.z}`;
        this.villages.save();
        const out = worker.enqueue('scout', { x: d.x, z: d.z, chore: true });
        // (home: true, teleported home when the walk back fails: Worker1 floated in a lake 4 min, F189)
        const back = worker.enqueue('scout', { x: d.home.x, z: d.home.z, chore: true, home: true });
        this.setChore(v, worker, opt.key, [out, back], `explore ${d.x},${d.z}`, undefined, meta, opt.holds, opt);
        console.log(`[explore] ${v.name}: ${worker.name} scouts ${d.x},${d.z} (${ex.visited.length} of 8), then home`);
        return;
      }
      case 'make': {
        const item = d.good.item;
        // (X.1: the catalogue's spec says the skill and its fixed arguments; the count and furnace are this batch's)
        const step = CHOOSE.families.has('catalog') ? this.catalog(v)?.specs.get(`make:${item}`)?.steps[0] : undefined;
        const status = worker.enqueue(step?.skill ?? 'make', { ...(step?.args ?? {}), item, count: d.count, ...(d.k !== undefined ? { furnace: d.k } : {}), chore: true });
        // (a failure backs the good off, 10 minutes, an hour after 3; not a stop, nor another agent's work in the way)
        const failed = (why: string) => {
          if (why === 'cancelled' || status.code) return;
          // (no path to a works furnace: the furnace waits, not the good, F233)
          if (d.k && /no path to/.test(why)) {
            this.furnaceBack.set(`${v.name}:${d.k}`, Date.now() + 10 * 60000);
            return;
          }
          const k = `${v.name}:${item}`, b = this.makeBack.get(k);
          this.makeBack.set(k, { tries: effTries(b?.tries, b?.at, Date.now()) + 1, at: Date.now() });
        };
        this.setChore(v, worker, opt.key, [status], `make ${d.count} ${item}`, failed, meta, opt.holds, opt);
        const c = this.chores.get(worker.name.toLowerCase());
        if (c) c.choice.make = { item, count: d.count, smelts: d.smelts, ...(d.k !== undefined ? { k: d.k } : {}) };
        // Its inputs earmarked until it withdraws them (D6): other agents' plans leave them out meanwhile (set after the
        // chore, whose replacement of an old one would end it and delete the earmark)
        holdsSet(holdKey(v.name, worker.name), d.inputs);
        console.log(`[make] ${v.name}: ${worker.name} makes ${d.count} ${item} (${d.stock} of ${this.makeTarget(v, d.good)}; inputs ${countsList(d.inputs)}; ${d.k !== undefined ? `furnace ${d.k}` : 'crafted'})`);
        return;
      }
      case 'gather': {
        const collect = worker.enqueue('collect', { block: d.block, count: d.amount, chore: true });
        // (deposit runs after a failed collect too: a partial load is put in and counts, the check's M3)
        const deposit = worker.enqueue('deposit', { item: d.deposit, also: GATHER_ALSO, chore: true });
        const failed = (why: string) => {
          if (why === 'cancelled' || collect.code || deposit.code) return;
          if (deposit.state === 'done' && depositedOf(deposit.message ?? '', d.material) > 0) return;
          // Nothing landed. "None found" is one gatherer's answer: candidates another held as unreachable for 10 minutes, or
          // a search from far out, gave it while sand lay near (S.9's review, lens 4 M2). The first answer backs the
          // material off 30 minutes; sand is marked unavailable for the village (as noneToGather does: the windows and the
          // glass goods go without) only when another agent answers the same at least GATHER_NONE_APART later. Anything
          // else waits 10 minutes
          const gk = `${v.name}:${d.material}`;
          if (/cannot be gathered here/.test(collect.message ?? '')) {
            const first = this.gatherNone.get(gk), now = Date.now();
            if (d.material === 'sand' && first && first.agent !== worker.name && now - first.at >= GATHER_NONE_APART) {
              this.gatherNone.delete(gk);
              if (!v.unavailable?.includes('sand')) {
                v.unavailable = [...(v.unavailable ?? []), 'sand'];
                this.villages.note(v, `no sand near the village (found none by ${first.agent} and ${worker.name}): the workshop makes no glass`);
                this.villages.save();
              }
              return;
            }
            // (the first answer is kept: the second must come from another agent; one older than two hours starts afresh)
            if (!first || now - first.at > 2 * 60 * 60000) this.gatherNone.set(gk, { agent: worker.name, at: now });
            this.gatherBack.set(gk, now + GATHER_NONE_BACK);
            return;
          }
          this.gatherBack.set(gk, Date.now() + 10 * 60000);
        };
        this.setChore(v, worker, opt.key, [collect, deposit], `gather ${d.amount} ${d.material}`, failed, meta, opt.holds, opt);
        const c = this.chores.get(worker.name.toLowerCase());
        if (c) c.choice.gather = { material: d.material, n: d.amount };
        console.log(`[gather] ${v.name}: ${worker.name} gathers ${d.amount} ${d.material} (need ${d.need}, incoming ${d.incoming}; for ${d.for.join(', ') || 'the workshop'})`);
        return;
      }
      case 'works': {
        if (d.stage === 'prepare') {
          this.setChore(v, worker, opt.key, [worker.enqueue('prepare_works', { chore: true })], 'prepare the works plot', undefined, meta, opt.holds, opt);
          console.log(`[works] ${v.name}: ${worker.name} is to prepare the works plot${d.again ? ` (again, at ${d.area})` : ''}`);
          return;
        }
        const k = d.k;
        const status = worker.enqueue('place_works_furnace', { k, chore: true });
        // (a failed placement waits 10 minutes; the skill clears nothing on the record, the furnace k stays unrecorded)
        const failed = (why: string) => {
          if (why !== 'cancelled' && !status.code) this.worksBack.set(`${v.name}:${k}`, Date.now() + 10 * 60000);
        };
        this.setChore(v, worker, opt.key, [status], `place works furnace ${k}`, failed, meta, opt.holds, opt);
        const c = this.chores.get(worker.name.toLowerCase());
        if (c) c.choice.furnace = k;
        // Its 8 cobblestone earmarked (the check's M5), as a make's inputs
        holdsSet(holdKey(v.name, worker.name), { cobblestone: 8 });
        console.log(`[works] ${v.name}: ${worker.name} places works furnace ${k} (8 cobblestone earmarked)`);
        return;
      }
      case 'light': {
        const status = worker.enqueue('put_up_torches', { part: d.part, count: d.n, chore: true });
        // (a failure backs the part off 10 minutes; not a stop, nor another agent's work in the way)
        const failed = (why: string) => {
          if (why !== 'cancelled' && !status.code) this.lightBack.set(`${v.name}:${d.part}`, Date.now() + 10 * 60000);
        };
        this.setChore(v, worker, opt.key, [status], `light ${d.label}`, failed, meta, opt.holds, opt);
        const c = this.chores.get(worker.name.toLowerCase());
        if (c) c.choice.light = { part: d.part, n: d.n };
        // (the spare before this earmark: what the menu offered from)
        const spare = this.makeSpare(v, worker.name).torch ?? 0;
        // Its torches earmarked until it withdraws them (D6), set after the chore as a make's inputs
        holdsSet(holdKey(v.name, worker.name), { torch: d.n });
        console.log(`[light] ${v.name}: ${worker.name} lights ${d.part} (${d.label}): ${d.n} of ${d.unlit} unlit, ${spare} torches spare`);
        return;
      }
      case 'initiate': {
        // The record first, at a spot found again now (the menu's may be taken), then its first step at once (s35)
        const k = SMALL_WORKS.find((x) => x.kind === d.work);
        const wood = this.catalogWoodOf(v);
        const found = k ? this.smallWorkSpot(v, k, wood, worker.name) : null;
        // (no room on the plots: on a green of its own when offered so and none is being prepared, s36)
        const home = villageHome(v);
        const pending = !found && !!d.green && !!home && !(v.initiatives ?? []).some((i) => i.state === 'open' && i.pending);
        const spot = found ?? (pending && home ? { x: home.x, y: v.plots[0]?.y ?? 64, z: home.z } : null);
        if (!k || !spot || (v.initiatives ?? []).some((i) => i.state === 'open' && i.by === worker.name)) {
          console.log(`[initiative] ${v.name}: ${worker.name} could not start a ${d.work} (${!k ? 'unknown kind' : !spot ? 'no room left' : 'its own is open'})`);
          return;
        }
        const design = k.make(wood);
        // (its first step decided before the record: no initiative opens that nobody can work on, s36)
        const first = this.initiativeStep(v, { id: '_new', design: design.name, pending }, this.makeSpare(v, worker.name), new Set(), design);
        if (!first) {
          console.log(`[initiative] ${v.name}: ${worker.name} could not start a ${d.work} (nothing to gather for it now)`);
          return;
        }
        if (!v.designs[design.name]) v.designs[design.name] = design;
        const it: Initiative = { id: `i${(v.initiativeN = (v.initiativeN ?? 0) + 1)}`, by: worker.name, kind: k.kind, design: design.name, x: spot.x, y: spot.y, z: spot.z, at: Date.now(), state: 'open', crew: [worker.name], steps: [], ...(pending ? { pending: true } : {}) };
        v.initiatives = [...(v.initiatives ?? []), it];
        this.villages.note(v, `${worker.name} starts a ${k.words} of its own ${pending ? 'on a new green' : `at ${spot.x},${spot.z}`} (${it.id})`);
        this.villages.save();
        console.log(`[initiative] ${v.name}: ${worker.name} starts ${it.id}, a ${k.words} (${design.name}) ${pending ? 'on a new green' : `at ${spot.x},${spot.y},${spot.z}`}`);
        this.runInitiativeStep(v, worker, it, first, opt, meta);
        return;
      }
      case 'grow': {
        // N.2: the request first (growTick finishes it if it cannot be laid out now: a style vote under way), H3
        const g = (v.growth ??= { past: [] });
        if (g.request || g.active || this.homeOf(v, worker.name)) {
          console.log(`[home] ${v.name}: ${worker.name} could not start a street of houses (${g.request ? 'one is asked for' : g.active ? 'a layout is being built' : 'it has a house'})`);
          return;
        }
        const now = Date.now();
        g.request = { by: worker.name, at: now };
        this.villages.save();
        console.log(`[home] ${v.name}: ${worker.name} starts a street of houses (${d.houseless} of ${this.growMembers(v).length} members without one)`);
        this.villages.note(v, `${worker.name} starts a street of houses for itself and others without one`);
        if (!this.homeLayout(v, worker, now, meta, opt)) console.log(`[home] ${v.name}: ${worker.name}'s street waits (${this.voting.has(v.name) ? 'the style vote' : 'growth not ready'}): growTick lays it out`);
        return;
      }
      case 'help': {
        const it = (v.initiatives ?? []).find((i) => i.id === d.id && i.state === 'open');
        if (!it) return;
        if (!it.crew.includes(worker.name)) {
          it.crew.push(worker.name);
          console.log(`[initiative] ${v.name}: ${worker.name} joins ${it.id} (${it.by}'s ${it.kind}; crew ${it.crew.length})`);
        }
        this.runInitiativeStep(v, worker, it, d.step, opt, meta);
        return;
      }
      case 'furnish': {
        const status = worker.enqueue('furnish', { part: d.part, count: d.n, chore: true });
        // (a failure backs the building off 10 minutes; not a stop, nor another agent's work in the way)
        const failed = (why: string) => {
          if (why !== 'cancelled' && !status.code) this.decorBack.set(`${v.name}:${d.part}`, Date.now() + 10 * 60000);
        };
        this.setChore(v, worker, opt.key, [status], `furnish ${d.label}`, failed, meta, opt.holds, opt);
        const c = this.chores.get(worker.name.toLowerCase());
        if (c) c.choice.furnish = { part: d.part, n: d.n };
        // Its furniture earmarked until it withdraws it (D6), set after the chore as a make's inputs
        holdsSet(holdKey(v.name, worker.name), d.items);
        console.log(`[furnish] ${v.name}: ${worker.name} furnishes ${d.part} (${d.label}): ${d.n} of ${d.open} open spots, takes ${countsList(d.items)}`);
        return;
      }
    }
  }

  /**
   * An idle member of a village (F193's helper, kept for the chores before completion): a worker, else (once the village
   * is complete, the user's choice for F193) the mayor, whose brain makes no model calls by then.
   */
  private idleWorker(v: Village): BotAgent | undefined {
    const free = [...this.agents.values()].filter((a) => a.village()?.name === v.name && !!a.bot.entity && a.idle() && !this.chores.has(a.name.toLowerCase())
      && (this.cooling.get(`agent|${a.name.toLowerCase()}`) ?? 0) < Date.now()
      && !v.tasks.some((t) => t.status === 'claimed' && t.claimedBy === a.name));
    return free.find((a) => a.memory.villageRole !== 'mayor') ?? (v.complete ? free.find((a) => a.memory.villageRole === 'mayor') : undefined);
  }

  /**
   * Opportunistic farming and exploring (10-08; chores beside the board, lesson 93): a planted slot that is ripe is
   * harvested (as the wheat: before completion only when nothing is claimable); once the village is complete, every idle
   * member chooses its chore from a menu (A.2: the sweep).
   */
  private slotChores(v: Village) {
    const busy = this.choreKeys(v);
    const now = Date.now();
    const layouts = v.layouts ?? [];
    // A start cut off by a restart (its finally never ran): the slot free again, or its planting kept (the diff review's
    // M1); failed starts forgiven after an hour
    for (const [i, lay] of layouts.entries())
      for (const [jj, slot] of (lay.slots ?? []).entries()) {
        if (slot.laying && !slotBusy.has(`${v.name}:${i + 1}:${jj + 1}`)) {
          // (a pen whose ring stands keeps it; its gate is shut, the count waits for the next try: the pen design's H2)
          if (slot.kind && PEN_KINDS[slot.kind] && slot.pen?.built) {
            const plot = v.plots.find((p) => p.annex && p.x1 <= slot.x1 && p.x2 >= slot.x2 && p.z1 <= slot.z1 && p.z2 >= slot.z2);
            if (plot) {
              // (a village agent inside is put out first, the review's M2; then the gate shut in the pen's own wood)
              const out = penPlan(slot, slot.face ?? 'n').approach;
              const inside = [...this.agents.values()].filter((b) => b.village()?.name === v.name && b.bot.entity
                && b.bot.entity.position.x >= slot.x1 && b.bot.entity.position.x < slot.x2 + 1 && b.bot.entity.position.z >= slot.z1 && b.bot.entity.position.z < slot.z2 + 1
                // (at the pen's level: a miner in a tunnel under the annex is not in the pen, lesson 102)
                && Math.abs(b.bot.entity.position.y - (plot.y + 1)) <= 3);
              const cmds = [...inside.map((b) => `tp ${b.name} ${out[0] + 0.5} ${plot.y + 1} ${out[1] + 0.5}`),
                `setblock ${slot.pen.gate[0]} ${plot.y + 1} ${slot.pen.gate[1]} minecraft:${slot.pen.wood ?? v.wood ?? 'oak'}_fence_gate[facing=${slot.pen.facing},open=false]`];
              void (async () => {
                for (const c of cmds) await this.rcon.command(c).catch(() => '');
              })();
            }
          } else if (!slot.planted) {
            delete slot.kind;
            delete slot.pen;
          }
          delete slot.laying;
          this.villages.save();
        }
        if (slot.tries && slot.lastTry && now - slot.lastTry.at > 60 * 60000) slot.tries = 0;
      }
    if (v.complete) {
      this.sweep(v, busy);
      return;
    }
    const read = (x: number, y: number, z: number) => {
      for (const a of this.agents.values()) {
        const st = a.bot.entity ? stateAt(a, x, y, z) : -1;
        if (st >= 0) return st;
      }
      return -1;
    };
    const is = (st: number, name: string) => {
      const b = this.registry.blocksByName[name];
      return !!b && st >= b.minStateId && st <= b.maxStateId;
    };
    // Ripe slots
    for (const [i, lay] of layouts.entries())
      for (const [jj, slot] of (lay.slots ?? []).entries()) {
        const spec = slot.kind ? SLOT_KINDS[slot.kind] : undefined;
        const k = i + 1, j = jj + 1;
        // (not while a pen's lure runs: pumpkin and melon seeds tempt chickens too, the pen review's L3)
        if (!spec || slot.laying || !slot.planted || slotBusy.has(`${v.name}:${k}:${j}`) || busy.has(`slot:${k}:${j}`) || busy.has('pen')) continue;
        if (slot.lastHarvest && !slot.lastHarvest.ok && now - slot.lastHarvest.at < (slot.lastHarvest.why === 'nothing ripe' ? 2 : 10) * 60000) continue;
        const plot = v.plots.find((p) => slot.x1 >= p.x1 && slot.x2 <= p.x2 && slot.z1 >= p.z1 && slot.z2 <= p.z2);
        if (!plot) continue;
        const y = plot.y + 1;
        let ripe = 0, of = 0, unloaded = false;
        if (spec.ripe !== undefined) {
          const b = this.registry.blocksByName[spec.block];
          for (const [x, z] of slot.cells ?? []) {
            const st = read(x, y, z);
            if (st < 0) unloaded = true;
            else if (b && is(st, spec.block)) {
              of++;
              if (st - b.minStateId >= spec.ripe) ripe++;
            }
          }
        } else
          for (const [x, z] of (spec.fruit ? slot.fruit : slot.cells) ?? []) {
            const st = read(x, spec.fruit ? y : y + 1, z);
            if (st < 0) unloaded = true;
            else if (is(st, spec.fruit ?? 'sugar_cane')) ripe++;
          }
        if (unloaded || ripe < 2 || (spec.ripe !== undefined && ripe < 0.75 * of)) continue;
        if (!v.complete && this.villages.claimable(v).length) continue;
        const worker = this.idleWorker(v);
        if (!worker) return;
        this.setChore(v, worker, `slot:${k}:${j}`, [worker.enqueue('harvest_slot', { layout: k, slot: j, chore: true })], `harvest ${slot.kind}`);
        busy.add(`slot:${k}:${j}`);
        console.log(`[farm] ${v.name} slot ${k}.${j}: ${ripe} ${slot.kind} ripe, ${worker.name} harvests`);
      }
  }

  /**
   * The after-completion sweep (A.2, spec 4.1): every idle member, in idleWorker's order, gets a menu of the feasible
   * chores; in fixed mode it runs the menu's lowest rank (today's fixed order: the first member with nothing ends the
   * sweep, as nextChore's loop did), in model mode it decides (decide). `q` is this sweep's choreKeys: the busy keys come
   * out exactly as the old picker's several choreKeys calls gave them (the wheat loop's first call read the cooling
   * entries before its drops, every later call after them).
   */
  private sweep(v: Village, q: Set<string>) {
    const now = Date.now();
    const all = this.heldKeys(v, now, 'sweep');
    // Forgiven after an hour (the readers read the effective value; the old picker wrote these as it looked)
    const ax = v.layouts?.[0]?.annex;
    if (ax?.tries && ax.lastTry && now - ax.lastTry.at > 60 * 60000) ax.tries = 0;
    if (ax?.penBy) for (const [k, by] of Object.entries(ax.penBy)) if (now - by.at > 60 * 60000) delete ax.penBy[k];
    const m = v.mine;
    if (m?.ironTries && m.ironLastTry && now - m.ironLastTry.at > 60 * 60000) m.ironTries = {};
    // (and the works plot's, S.9)
    const wk = v.layouts?.[0]?.works;
    if (wk?.tries && wk.lastTry && now - wk.lastTry.at > 60 * 60000) wk.tries = 0;
    // Expired guards' bookkeeping
    for (const [k, until] of this.bansLogged) if (until < now) this.bansLogged.delete(k);
    for (const [k, until] of this.gatherBack) if (until <= now) this.gatherBack.delete(k);
    for (const [k, until] of this.lightBack) if (until <= now) this.lightBack.delete(k);
    for (const [k, until] of this.decorBack) if (until <= now) this.decorBack.delete(k);
    // X.1: the catalogue's and the furniture's wood kind, pinned once the village is complete (here, not in the pure menu;
    // furniture in a kind that followed the most stocked logs reopened its own chairs as another kind's, the review's L3)
    if ((CHOOSE.families.has('catalog') || CHOOSE.families.has('furnish')) && v.complete && !v.catalogWood) {
      v.catalogWood = this.catalogWoodOf(v);
      this.villages.save();
      console.log(`[catalog] ${v.name}: wood goods in ${v.catalogWood}`);
    }
    for (const [k, at] of this.declined) if (now - at > 10 * DECLINE_MS) this.declined.delete(k);
    // The torch demand, when it changed, at most once a minute (B.4)
    if (CHOOSE.families.has('light') && v.complete) {
      const parts = this.lightParts(v);
      const b = parts.filter((p) => p.kind === 'building').reduce((n, p) => n + p.unlit, 0), mn = parts.filter((p) => p.kind === 'mine').reduce((n, p) => n + p.unlit, 0);
      const dm = this.torchDemand(v), torch = MAKE_GOODS.find((g) => g.item === 'torch');
      const sig = `${dm}|${b}|${mn}`, last = this.lightLogged.get(v.name);
      if (torch && last?.sig !== sig && (!last || now - last.at >= 60000)) {
        this.lightLogged.set(v.name, { sig, at: now });
        console.log(`[light] ${v.name}: torch demand ${dm} (buildings ${b}, mine ${mn}), make target ${this.makeTarget(v, torch)}`);
      }
    }
    // What a stopped make left in an idle member's hands goes back into storage by name (S.9's 4.10, the check's L8): it is
    // busy with that and skips this sweep's menu
    for (const a of this.agents.values()) {
      const hk = holdKey(v.name, a.name), left = makeLeft.get(hk);
      if (!left || !this.isIdleMember(v, a, now)) continue;
      makeLeft.delete(hk);
      const items = Object.entries(left).filter(([, q]) => q > 0);
      for (const [n, q] of items) a.enqueue('deposit', { item: n, count: q, keep_wood: true, chore: true });
      if (items.length) console.log(`[make] ${v.name}: ${a.name} puts back what a stopped make left (${countsList(left)})`);
    }
    // (a public work's tasks are held for as a neighbourhood's, X.2)
    let members = GROW.on || PROJECTS_ON ? this.growHold(v, this.idleMembers(v, now), now) : this.idleMembers(v, now);
    if (!members.length) return;
    const facts = this.sweepFacts(v, now, members[0]);
    // The fields the old wheat loop got as far as reading the busy keys for
    const ready = (v.layouts ?? []).map((l, i) => (l.farm && facts.field(String(i + 1)) ? i + 1 : 0)).filter(Boolean);
    const busy = new Set(ready.length ? all : q);
    const ctx: SweepCtx = { village: v.name, t: now, busy, first: ready.length ? { k: ready[0], busy: new Set(q) } : undefined };
    const take = (key: string) => {
      ctx.busy.add(key);
      ctx.first?.busy.add(key);
    };
    const none: Array<{ agent: string; reasons: Partial<Record<ChoiceKind, string>> }> = [];
    let capped = 0;
    this.sweepCtx = ctx;
    try {
      // (model mode's cap: decisions that call the model only while the members still to decide have keys left over
      // the decisions in flight, C15)
      const modelVillage = members.some((a) => this.chooseMode(a) === 'model');
      const keysLeft = modelVillage ? new Map(members.map((a) => [a.name, new Set(this.menu(v, a, busy, true, facts, ctx.first).menu.options.map((o) => o.key))])) : null;
      // (A.3p, the response threshold: in a fixed sweep with temperaments on, the members who like their best option most
      // choose first, so a chore goes to one who likes it rather than to Worker1 because it is first)
      if (TEMPERAMENT_MODE === 'on' && !modelVillage && members.length > 1) {
        const best = new Map(members.map((a) => [a.name, fixedPick(this.menu(v, a, busy, false, facts, ctx.first).menu)?.tw ?? 0]));
        members = [...members].sort((x, y) => (best.get(y.name) ?? 0) - (best.get(x.name) ?? 0));
      }
      for (const [n, a] of members.entries()) {
        if (!this.isIdleMember(v, a, now)) continue;
        const model = this.chooseMode(a) === 'model';
        const { menu, skips } = this.menu(v, a, ctx.busy, model, facts, ctx.first);
        // (A.3p: with temperament weights on the options, the fixed pick weighs them; without, the first in rank order as
        // before)
        const pick = !model && menu.options.some((o) => o.tw !== undefined || o.nw !== undefined) ? fixedPick(menu) : menu.options[0];
        this.needNote(v, menu);
        // (the old picker wrote these only when it walked the farm starts: a member whose pick is a field or a ripe slot
        // never got there)
        // (A.3p: judged on the first in rank order, as before temperaments, so they never change when skips are written)
        const first = menu.options[0];
        if (model || !first || first.rank >= 200) for (const s of skips) this.slotSkip.set(s, now + 10 * 60000);
        // (every ring point visited: the ring is done once a member finds none left, as the old picker wrote it when it got
        // that far; the village's log keeps 40 notes, so the note's timing shows in it)
        if ((model || !pick) && menu.reasons.explore === 'all visited' && v.explore && !v.explore.done) {
          v.explore.done = true;
          this.villages.note(v, 'explored all round the village');
          this.villages.save();
        }
        if (!pick) {
          none.push({ agent: a.name, reasons: menu.reasons });
          // (today's loop stopped at the first member with nothing: the rest have nothing either; not with an appetite, where
          // menus differ by member: a hungry member's empty menu must not cost a fed one its chore, the food check's H2)
          if (!model && !appetiteOn(v)) {
            for (const b of members.slice(n + 1)) if (this.isIdleMember(v, b, now)) none.push({ agent: b.name, reasons: menu.reasons });
            break;
          }
          continue;
        }
        // A meal is code's to run, never a model call (the food check's M2: 72-86 meals a wall-hour at 25 members)
        if (pick.kind === 'eat') {
          const r = this.runChoice(a, pick.id, { source: 'fixed', reason: 'appetite', menu });
          if (r.ok) {
            take(r.key);
            for (const h of this.chores.get(a.name.toLowerCase())?.choice.holds ?? []) take(h);
          }
          continue;
        }
        if (!model) {
          // (A.3p: a disliked pick is left for a member who likes it, until it has waited DECLINE_MS; then anyone takes it)
          if (pick.tw !== undefined && pick.tw < DISLIKED) {
            const dk = `${v.name}|${pick.id}`;
            const since = this.declined.get(dk);
            if (since === undefined) {
              this.declined.set(dk, now);
              console.log(`[temper] ${v.name}: ${a.name} leaves ${pick.id} (weight ${pick.tw}) for one who likes it, at most ${Math.round(DECLINE_MS / 1000)} s`);
            }
            if (since === undefined || now - since < DECLINE_MS) continue;
          }
          const r = this.runChoice(a, pick.id, { source: 'fixed', reason: 'fixed order', menu });
          if (r.ok) this.declined.delete(`${v.name}|${pick.id}`);
          if (r.ok) {
            take(r.key);
            for (const h of this.chores.get(a.name.toLowerCase())?.choice.holds ?? []) take(h);
          }
          continue;
        }
        const d = this.decideAt(v, a, menu);
        if ('ran' in d) {
          if (d.ran.ok && d.ran.key) {
            take(d.ran.key);
            for (const h of this.chores.get(a.name.toLowerCase())?.choice.holds ?? []) take(h);
          }
          continue;
        }
        // A model call: only while keys are left for it
        const left = new Set<string>();
        for (const b of members.slice(n)) for (const k of keysLeft?.get(b.name) ?? []) if (!ctx.busy.has(k)) left.add(k);
        const inFlight = [...this.pending.values()].filter((p) => p.village === v.name).length;
        if (left.size - inFlight <= 0) {
          capped++;
          continue;
        }
        this.submitDecision(v, a, menu, d.call);
      }
    } finally {
      this.sweepCtx = undefined;
    }
    if (none.length || capped) this.noteNone(v, none, capped, now);
  }

  /**
   * The members a growing village's sweep leaves alone (s30, D10): the first k idle workers, k the neighbourhood's tasks
   * that can be claimed now (brains run before the sweep, so they claim on their next tick; board work first, as the
   * wheat's rule before completion), never the mayor; and the mayor while growth waits only for a free member (the check's
   * M1: the first sweep would send it on a 20-minute iron trip just before growTick wants it), from completion when this
   * server saw it happen, else once the first wait has passed.
   */
  private growHold(v: Village, members: BotAgent[], now: number): BotAgent[] {
    let out = members;
    if (growing(v)) {
      const tasks = this.villages.claimable(v).filter((t) => isGrowTask(v, t));
      let k = tasks.length;
      // (only workers whose brains take board tasks: one that never claims would be held for nothing, s30's review; and only
      // those the appetite lets claim one of them: a peckish member held here never got its meal, the food check's H1)
      if (!HOUSING) out = out.filter((a) => a.memory.villageRole === 'mayor' || !a.brain?.claimsTasks?.(a) || !tasks.some((t) => this.mayClaim(a, t)) || k-- <= 0);
      else {
        // (N.2: the owners of houses that can be claimed now are held first, H7)
        const owners = new Set(tasks.filter((t) => t.owner && /^Build /.test(t.title)).map((t) => t.owner!));
        const held = new Set<BotAgent>();
        for (const a of [...out.filter((x) => owners.has(x.name)), ...out.filter((x) => !owners.has(x.name))])
          if (a.memory.villageRole !== 'mayor' && a.brain?.claimsTasks?.(a) && tasks.some((t) => this.mayClaim(a, t)) && k-- > 0) held.add(a);
        out = out.filter((a) => !held.has(a));
      }
    }
    // (not a hungry mayor: growTick gives the chore to a fed member then, and a mayor held here would never eat)
    if (this.growDue(v, now, !this.growWatched.has(v.name))) out = out.filter((a) => a.memory.villageRole !== 'mayor' || this.hungerOf(v, a) === 'hungry');
    return out;
  }

  /** `[choice-none]`: idle members with nothing feasible, by reason; when the reasons change, at most every 5 minutes. */
  private noteNone(v: Village, none: Array<{ agent: string; reasons: Partial<Record<ChoiceKind, string>> }>, capped: number, now: number) {
    const counts = new Map<string, number>();
    for (const n of none) for (const [k, why] of Object.entries(n.reasons)) counts.set(`${k}: ${why}`, (counts.get(`${k}: ${why}`) ?? 0) + 1);
    if (capped) counts.set('capped', capped);
    const sig = [...counts.keys()].sort().join('|');
    const last = this.noneAt.get(v.name);
    if (last && last.sig === sig && now - last.at < 5 * 60000) return;
    this.noneAt.set(v.name, { sig, at: now });
    console.log(`[choice-none] ${v.name}: ${none.length} idle, nothing feasible (${[...counts.entries()].map(([k, n]) => `${k} ${n}`).join(', ')})`);
  }

  /**
   * A model-mode decision's start (spec 5.1 steps 0-4; E.4 swaps this one place for reservation and a re-ask, D6): a menu of
   * one runs at once ('only'); within minGapMs of the agent's last model decision an option of the same kind runs
   * ('repeat', else the fixed pick as 'rate'); over the hourly cap or the budget the fixed pick runs at once. Otherwise
   * the call is to be made (`call`: the decision id and the model).
   */
  private decideAt(v: Village, a: BotAgent, menu: ChoiceMenu): { ran: { ok: boolean; key?: string } } | { call: { decisionId: string; spec: ModelSpec } } {
    const decisionId = choiceId(v.name);
    const now = Date.now();
    const run = (id: string | null, meta: Omit<ChoiceMeta, 'decisionId' | 'menu'>) => {
      const r = id ? this.runChoice(a, id, { ...meta, decisionId, menu }) : this.runPick(a, null, { ...meta, decisionId, menu });
      return { ran: r.ok ? { ok: true, key: r.key } : { ok: false } };
    };
    if (menu.options.length === 1) return run(menu.options[0].id, { source: 'only', reason: 'fixed order' });
    const id = a.name.toLowerCase();
    if (now - this.choiceStats.lastModelAt(a.name) < CHOOSE.minGapMs) {
      const kind = this.lastModelKind.get(id);
      const same = kind ? menu.options.filter((o) => o.kind === kind).sort((p, q) => p.rank - q.rank)[0] : undefined;
      return same ? run(same.id, { source: 'repeat', reason: 'fixed order' }) : run(null, { source: 'fallback', why: 'rate', reason: 'fixed order' });
    }
    if (this.choiceStats.modelCallsLastHour(a.name, now) >= CHOOSE.perHour) return run(null, { source: 'fallback', why: 'rate', reason: 'fixed order' });
    const spec = parseSpec(typeof a.memory.chooseModel === 'string' ? a.memory.chooseModel : typeof a.memory.execModel === 'string' ? a.memory.execModel : CHOOSE.model);
    if (!spec) return run(null, { source: 'fallback', why: 'error', reason: 'fixed order' });
    if ((isCloudModel(spec.model) && !usage.allows('decisions')) || usage.blocked(spec.model, a.name)) return run(null, { source: 'fallback', why: 'budget', reason: 'fixed order', model: label(spec) });
    return { call: { decisionId, spec } };
  }

  /** Steps 5-9: the decision queued, the call made, the reply run (or the fixed pick over a fresh menu). Every continuation is
   *  caught (D9): a throw logs `[choice-error]` and releases the agent. */
  private submitDecision(v: Village, a: BotAgent, menu: ChoiceMenu, call: { decisionId: string; spec: ModelSpec }, reaskOf?: string) {
    const id = a.name.toLowerCase();
    const p: PendingChoice = { id, agent: a, village: v.name, decisionId: call.decisionId, ac: new AbortController(), since: Date.now(), state: 'queued', menu, ...(reaskOf ? { reaskOf } : {}) };
    this.pending.set(id, p);
    this.chooser.submit(a.name, async (queueWaitMs) => {
      try {
        if (this.pending.get(id) !== p) return;
        p.state = 'running';
        p.queueWaitMs = queueWaitMs;
        const r = await choose({ agent: a.name, spec: call.spec, level: REASONING.choose, menu, seed: call.decisionId, signal: p.ac.signal });
        // (dropped meanwhile: the drop rule wrote its record; nothing queued, no fallback, C16)
        if (p.ac.signal.aborted || this.pending.get(id) !== p) return;
        this.pending.delete(id);
        const meta: ChoiceMeta = {
          source: r.id ? 'model' : 'fallback', ...(r.id ? {} : { why: r.why ?? 'error' }), reason: r.id ? r.reason || '(no reason)' : 'fixed order',
          decisionId: p.decisionId, shown: r.shown, model: label(call.spec), latencyMs: r.latencyMs, waitMs: r.waitMs, queueWaitMs,
          promptTokens: r.promptTokens, outputTokens: r.outputTokens, menu, prompt: r.prompt, ...(p.reaskOf ? { reaskOf: p.reaskOf } : {}),
        };
        if (this.agents.get(id) !== a) {
          this.logDrop(p.decisionId, a.name, v.name, this.agents.has(id) ? 'replaced' : 'gone', queueWaitMs, meta, r.id);
          return;
        }
        // (a call that reached the model counts toward the agent's rate, answered or not)
        const reached = !!r.id || r.why === 'invalid' || r.why === 'timeout' || r.why === 'error';
        if (reached) this.choiceStats.noteModel(a.name, Date.now());
        if (r.id) {
          const kind = menu.options.find((o) => o.id === r.id)?.kind;
          if (kind) this.lastModelKind.set(id, kind);
        } else if (reached) {
          // (the latest model decision chose nothing: no kind to repeat within the gap, the fixed pick goes as 'rate')
          this.lastModelKind.delete(id);
        }
        // (one re-ask, never a re-ask's re-ask, and only while the budget allows a call)
        const reask = p.reaskOf ? undefined : (fresh: ChoiceMenu) => {
          if ((isCloudModel(call.spec.model) && !usage.allows('decisions')) || usage.blocked(call.spec.model, a.name)) return false;
          this.submitDecision(v, a, fresh, { decisionId: choiceId(v.name), spec: call.spec }, p.decisionId);
          return true;
        };
        this.runPick(a, r.id, meta, reask);
      } catch (e) {
        this.choiceError(p, e);
      }
    }, () => {
      try {
        if (this.pending.get(id) !== p || p.ac.signal.aborted) return;
        this.pending.delete(id);
        this.runPick(a, null, { source: 'fallback', why: 'queue', reason: 'fixed order', decisionId: p.decisionId, queueWaitMs: CHOOSE.queueMs, menu });
      } catch (e) {
        this.choiceError(p, e);
      }
    });
  }

  private choiceError(p: PendingChoice, e: unknown) {
    try {
      console.log(`[choice-error] ${p.agent.name}: ${String((e as Error)?.stack ?? e).slice(0, 300)}`);
      if (this.pending.get(p.id) === p) this.pending.delete(p.id);
      this.chooser.cancel(p.agent.name);
    } catch {
      // (nothing may escape, D9)
    }
  }

  /** A pending decision dropped (spec 6): its call aborted or its queue entry cancelled, one record. */
  private dropDecision(p: PendingChoice, why: ChoiceDrop['why']) {
    if (this.pending.get(p.id) !== p) return;
    this.pending.delete(p.id);
    p.ac.abort();
    this.chooser.cancel(p.agent.name);
    this.logDrop(p.decisionId, p.agent.name, p.village, why, p.queueWaitMs);
  }

  /** A dropped decision's record; one dropped after its call carries the call's numbers (`meta`) and the model's pick
   *  (`chose`), and its tokens count in the village's summary (no source counted: it ran nothing). */
  private logDrop(decisionId: string, agent: string, village: string, why: ChoiceDrop['why'], queueWaitMs?: number, meta?: ChoiceMeta, chose?: string | null) {
    const m = meta;
    logChoiceDrop({
      decisionId, agent, village, t: Date.now(), why, ...(queueWaitMs !== undefined ? { queueWaitMs } : {}),
      ...(m?.model ? { model: m.model } : {}), ...(m?.latencyMs !== undefined ? { latencyMs: m.latencyMs } : {}), ...(m?.waitMs !== undefined ? { waitMs: m.waitMs } : {}),
      ...(m?.promptTokens !== undefined ? { promptTokens: m.promptTokens } : {}), ...(m?.outputTokens !== undefined ? { outputTokens: m.outputTokens } : {}),
      ...(m?.source === 'model' && chose ? { modelChose: chose, modelReason: m.reason } : {}),
    });
    const acc = this.summaryOf(village);
    acc.s.drops++;
    if (m) {
      acc.s.promptTokens += m.promptTokens ?? 0;
      acc.s.outputTokens += m.outputTokens ?? 0;
      if (m.latencyMs && replied(m)) acc.ms = [...acc.ms, m.latencyMs].slice(-500);
    }
    const id = agent.toLowerCase();
    // (the model's reply and tokens kept for the panel when the decision reached it, the fix review)
    if (why === 'empty')
      this.decisions.set(id, {
        ...(m ?? {}), source: 'fallback', why: m?.why ?? 'taken', reason: 'fixed order', decisionId, chosen: null, at: Date.now(),
        ...(m?.source === 'model' && chose ? { modelChose: chose, modelReason: m.reason } : {}),
      });
  }

  private summaryOf(village: string) {
    let acc = this.summaries.get(village);
    if (!acc) this.summaries.set(village, (acc = { s: { model: 0, fixed: 0, only: 0, repeat: 0, rate: 0, fallback: {}, drops: 0, positions: [], expected: [], promptTokens: 0, outputTokens: 0, msP50: 0, queueWaitP90: 0 }, ms: [], queue: [] }));
    return acc;
  }

  /** A decision counted for the panel's chip. */
  private summarise(village: string, meta: ChoiceMeta, opt?: ChoiceOption) {
    const acc = this.summaryOf(village);
    const s = acc.s;
    if (meta.source === 'fallback') {
      if (meta.why === 'rate') s.rate++;
      else if (meta.why) s.fallback[meta.why] = (s.fallback[meta.why] ?? 0) + 1;
    } else s[meta.source]++;
    if (meta.source === 'model' && opt && meta.shown?.length) {
      const n = meta.shown.length, at = meta.shown.indexOf(opt.id);
      for (let p = 0; p < n; p++) {
        s.positions[p] ??= 0;
        s.expected[p] = Math.round(((s.expected[p] ?? 0) + 1 / n) * 1000) / 1000;
      }
      if (at >= 0) s.positions[at]++;
    }
    s.promptTokens += meta.promptTokens ?? 0;
    s.outputTokens += meta.outputTokens ?? 0;
    // (the model answer's time: only decisions whose reply came, not timeouts, errors or calls never sent)
    if (meta.latencyMs && replied(meta)) acc.ms = [...acc.ms, meta.latencyMs].slice(-500);
    if (meta.queueWaitMs !== undefined) acc.queue = [...acc.queue, meta.queueWaitMs + (meta.waitMs ?? 0)].slice(-500);
  }

  /** An end fed to the statistics; a ban that starts is logged once (spec 7.3). */
  private noteEnd(c: { agent: string; village: string; choice: ChoiceState }, ok: boolean, cut: boolean, contention: boolean, productive: boolean, message: string, known?: number) {
    const kind = c.choice.kind;
    if (!kind || !CHOICE_KINDS.includes(kind)) return;
    const now = Date.now();
    const id = c.choice.option ?? kind;
    const verb = ok ? (productive ? 'done' : 'done, nothing gained') : cut ? 'cut short' : `failed (${message.slice(0, 60)})`;
    this.choiceStats.record({
      village: c.village, agent: c.agent, kind, id, ok, cut, contention, productive, minutes: Math.round((now - c.choice.t) / 600) / 100, at: now,
      line: `${c.choice.name ?? id}: ${verb}, ${Math.round((now - c.choice.t) / 6000) / 10} min${known !== undefined ? `, ${known >= 0.1 ? 'new land' : 'little new land'}` : ''}`,
    });
    // (every trip that was not cut, failed ones too: spec 7.5's "the last 2 trips found nothing new")
    if (kind === 'explore' && known !== undefined && !cut) this.exploreYields.set(c.village, [...(this.exploreYields.get(c.village) ?? []), known].slice(-10));
    // Bans apply only in model mode (D5): a fixed run logs none
    const agent = this.agents.get(c.agent.toLowerCase());
    if (!ok && !cut && !contention && (agent ? this.chooseMode(agent) : CHOOSE.mode) === 'model') {
      const ban = this.choiceStats.banned(c.village, kind, id, now);
      // (a ban of the whole kind is logged once, under the kind's name)
      const name = ban?.scope === 'kind' ? kind : id;
      const k = `${c.village}|${name}`;
      if (ban && this.bansLogged.get(k) !== ban.until) {
        this.bansLogged.set(k, ban.until);
        logChoiceBan({ village: c.village, t: now, id: name, scope: ban.scope, until: ban.until, message });
      }
    }
  }

  /** A2: the panel's compact line (cached fields only, C10). */
  choiceStatus(agent: WorldAgent): ChoiceStatus | null {
    const id = agent.name.toLowerCase();
    const p = this.pending.get(id);
    if (p) return { state: p.state === 'running' ? 'choosing' : 'queued', since: p.since, menuSize: p.menu.options.length };
    const c = this.chores.get(id);
    const d = this.decisions.get(id);
    const last = d ? {
      ...(d.chosen ? { name: d.menu?.options.find((o) => o.id === d.chosen)?.name, kind: d.menu?.options.find((o) => o.id === d.chosen)?.kind } : {}),
      source: d.source, ...(d.why ? { why: d.why } : {}), reason: d.reason.slice(0, 160),
      ...(d.source === 'model' && d.chosen && d.shown?.includes(d.chosen) ? { position: d.shown.indexOf(d.chosen) + 1 } : {}), ...(d.source === 'model' && d.shown ? { shown: d.shown.length } : {}),
      at: d.at, ...(d.menu ? { menuSize: d.menu.options.length } : {}),
    } : {};
    if (c && !c.choice.ended) return { ...last, state: 'running', since: c.choice.t, ...(c.choice.name ? { name: c.choice.name } : {}), ...(c.choice.kind ? { kind: c.choice.kind } : {}) };
    return d ? { ...last, state: 'none' } : null;
  }

  choiceHistory(agent: WorldAgent) {
    const v = agent.village();
    return v ? this.choiceStats.agentHistory(v.name, agent.name) : [];
  }

  lastDecision(agent: WorldAgent): (ChoiceMeta & { chosen: string | null; at: number }) | null {
    return this.decisions.get(agent.name.toLowerCase()) ?? null;
  }

  choiceSummary(village: string): ChoiceSummary | null {
    const acc = this.summaries.get(village);
    if (!acc) return null;
    const q = (xs: number[], f: number) => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length ? s[Math.min(s.length - 1, Math.ceil(f * s.length) - 1)] : 0;
    };
    return { ...acc.s, fallback: { ...acc.s.fallback }, positions: [...acc.s.positions], expected: [...acc.s.expected], msP50: q(acc.ms, 0.5), queueWaitP90: q(acc.queue, 0.9) };
  }
}

/** A2: what the sweep needs per village, once per sweep time (spec 2.3, C10). */
interface Facts {
  t: number;
  /** The member the village-level reads go through (collect's filter, village ground: the same for every member). */
  agent: BotAgent;
  store: Counts;
  ok: () => (p: { x: number; y: number; z: number }) => boolean;
  startHome: { x: number; z: number } | null;
  exploreHome: { x: number; z: number } | null;
  field: (k: string) => { ripe: number; grown: number; plot: { y: number } } | null;
  slot: (kj: string) => { ripe: number; of: number } | null;
  sightings: (kind: string) => Array<[number, number, number, number]>;
  animals: (kind: string) => Array<{ x: number; y: number; z: number }>;
  eggs: (j: string) => boolean;
  known: (xz: string) => number;
  /** S.9: every good's makePlan, by item; gathering's demand; the spare storage (makeSpare), all for no one agent. */
  makePlans: () => Map<string, MakePlan>;
  gather: () => GatherWanted;
  spare: () => Counts;
}

/** A chore as its end is handled: its actions, its `failed` callback and whether that was called (reportFailed). */
interface ChoreEnd {
  agent: string;
  village: string;
  status: ActionStatus[];
  failed?: (why: string) => void;
  failReported?: boolean;
  choice: ChoiceState;
}

/** The sweep under way (A.2): its busy keys, and the first ready field's own (choreKeys' first-call quirk). */
interface SweepCtx {
  village: string;
  t: number;
  busy: Set<string>;
  first?: { k: number; busy: Set<string> };
}

/** A decision waiting for or in its model call (A.2, spec 5.1). */
interface PendingChoice {
  id: string;
  agent: BotAgent;
  village: string;
  decisionId: string;
  ac: AbortController;
  since: number;
  state: 'queued' | 'running';
  menu: ChoiceMenu;
  queueWaitMs?: number;
  /** A re-ask (s40): the first decision's id; its own pick, if taken too, runs the fixed pick. */
  reaskOf?: string;
}

/** What running an option takes, beside the option's data (kept off the option, which stays plain data). */
type OptionRun =
  | { kind: 'farm'; k: number; ripe: number; grown: number }
  | { kind: 'slot'; k: number; j: number; ripe: number; slotKind: string }
  | { kind: 'start'; k: number; j: number; slotKind: string; x: number; y: number; z: number; store?: boolean }
  | { kind: 'annex'; again: boolean; area: string }
  | { kind: 'pen'; j: number; slotKind: string; x: number; y: number; z: number }
  | { kind: 'penwork'; j: number; what: string; skill: string; slotKind: string; animals: number }
  | { kind: 'cake' }
  | { kind: 'iron'; stage: string; tool: string; iron: number }
  | { kind: 'explore'; i: number; x: number; z: number; home: { x: number; z: number } }
  | { kind: 'make'; good: MakeGood; count: number; inputs: Counts; smelts: boolean; k?: number; stock: number }
  | { kind: 'gather'; material: Material; n: number; amount: number; block: string; deposit: string; need: number; incoming: number; for: string[] }
  | { kind: 'works'; stage: 'prepare'; again: boolean; area: string }
  | { kind: 'works'; stage: 'furnace'; k: number }
  | { kind: 'light'; part: string; n: number; unlit: number; label: string }
  | { kind: 'furnish'; part: string; n: number; items: Counts; open: number; label: string }
  | { kind: 'initiate'; work: string; green?: boolean }
  | { kind: 'help'; id: string; step: InitiativeStep }
  | { kind: 'grow'; houseless: number }
  | { kind: 'eat'; level: number; item: string; n: number };
const OPTION_RUN = new WeakMap<ChoiceOption, OptionRun>();

/** The first growth waits this long after the village is first seen complete (s30, D2); a neighbourhood whose open tasks
 *  nobody holds or can claim for GROW_STUCK_MS is ended as stuck (D13); a site within the village's range (D6). */
const GROW_WAIT_MS = 60000, GROW_STUCK_MS = 10 * 60000, VILLAGE_GROW_REACH = 96;
/** A growth claim whose holder was idle on no chore, its brain not holding it, this many checks in a row (30 s apart) is
 *  handed back (s30's review, L-3). */
const GROW_ORPHAN_CHECKS = 4;
const CHOICE_KINDS: ChoiceKind[] = ['farm', 'slot', 'start', 'annex', 'pen', 'penwork', 'cake', 'iron', 'explore', 'works', 'make', 'gather', 'light', 'furnish', 'initiate', 'help'];
/** An initiative's next step (s35): gathering a material into storage, or building it once the storage covers the bill. */
type InitiativeStep = { what: 'gather'; material: Material; amount: number; block: string; deposit: string } | { what: 'build' } | { what: 'prepare' };
/** A green's side (s36): room for two or three small works with their rings. */
const GREEN_SIZE = 15;
/** Members a green (the user's, s36): a village prepares one green per GREENS_PER members for small works. */
const GREENS_PER = 5;
/** Ring point i's direction (0 east, clockwise: z grows to the south). */
const DIRECTIONS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
/** A vote under way (spec_vote1): its ballots come in as the calls end. */
interface VoteRun { id: string; topic: VoteTopic; k: number; options: VoteOption[]; started: number; mode: VoteMode; done: boolean; ballots: Ballot[]; voters: string[]; ac: AbortController }

/** X.2: public works (MC_PROJECTS, on by default since X2p: 7 works in an hour, steady busy 1% -> 3-4%); the status quo
 *  option's id; how long a "no new work" win rests the question (2 min: at 5 the rests were most of each cycle, X2p). */
const PROJECTS_ON = !/^(off|0|false)$/i.test(process.env.MC_PROJECTS ?? 'on');
/** Menu reasons that do not block a need (needNote): another member is on it, this member only, or it is under way. */
const NOT_BLOCKING = new Set(['busy', 'hungry', 'has a house', 'a street is asked for', 'a layout is being built', 'a vote is under way']);
const PROJECT_FARMSTEAD = 'farmstead';
const PROJECT_NONE = 'none', PROJECT_HOUSES = 'houses', PROJECT_REST_MS = Number(process.env.MC_PROJECT_REST_MS ?? 2 * 60000);
/** s35: initiatives open at once in a village (MC_INITIATIVES; 0: none), gatherers on one initiative at once, and how
 *  long one waits with no step taken before it lapses. */
/** N.2 (s37): a street of houses asked for and not laid out within this long is dropped (H4); a member's own house is
 *  left to it this long once its Build task can be claimed (H7); public works wait this long after the last street while
 *  members have no house; another member's house is its own to furnish and light this long, then anyone may help (H8). */
const HOME_REQUEST_MS = 15 * 60000, OWNER_FIRST_MS = 3 * 60000, HOME_FIRST_MS = 10 * 60000, OWN_DECOR_MS = 10 * 60000;
const INITIATIVES_MAX = Number(process.env.MC_INITIATIVES ?? 3), INITIATIVE_GATHERERS = 2, INITIATIVE_LAPSE_MS = 30 * 60000;
/** N.1's needs (spec_needs_v2): off; show (measured, logged, on the API and panel); on (also on the menus). */
const NEEDS_MODE: 'off' | 'show' | 'on' = process.env.MC_NEEDS === 'show' || process.env.MC_NEEDS === 'on' ? process.env.MC_NEEDS : 'off';
/** How often a village's needs are read. */
const NEED_TICK_MS = 30000;

/** X.2 part 2a: the most pieces a public work's quarter holds (MC_QUARTER; 1: a lone piece, as part 1). */
const QUARTER = Math.max(1, Number(process.env.MC_QUARTER ?? 3));
/** A non-dwelling piece's kind ("plains_tool_smith_1" -> "tool_smith"): one of a kind on a ballot and in a quarter. */
const workKind = (name: string) => name.replace(/^(plains|desert|savanna|snowy|taiga)_/, '').replace(/_\d+$/, '').replace(/_(house|shop)$/, '').replace(/s$/, '');

/** A.3p: how long a disliked option waits for a member who likes it before anyone takes it (MC_DECLINE_MS). */
const DECLINE_MS = Number(process.env.MC_DECLINE_MS ?? 90000);

const KIND_WORDS: Record<string, string> = { farm: 'harvesting', slot: 'harvesting', start: 'starting farms', annex: 'preparing the annex', pen: 'leading animals', penwork: 'tending pens', cake: 'baking', iron: 'iron work', explore: 'exploring',
  works: 'preparing the works', make: 'making goods', gather: 'gathering for the workshop', light: 'lighting', furnish: 'furnishing', initiate: 'starting projects', help: 'helping with projects', grow: 'laying out houses', eat: 'eating' };
/** The furnaces counted with the hut's (a works furnace is the village's second, third or fourth). */
const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth'];

/** Items as the facts say them ("12 cobblestone, 1 oak log") and as the log lines list them ("cobblestone:12,oak_log:1"). */
const countsText = (c: Counts) => Object.entries(c).filter(([, q]) => q > 0).map(([n, q]) => `${q} ${words(n)}`).join(', ') || 'nothing';
const countsList = (c: Counts) => Object.entries(c).filter(([, q]) => q > 0).map(([n, q]) => `${n}:${q}`).join(',') || 'none';

/** What a deposit's message says went in of a gathering's material ("deposited 4 oak_log, 8 birch_log (...). Storage now
 *  holds ...": only the head, not the storage's own list). */
function depositedOf(message: string, m: Material): number {
  const head = /^deposited ([^(;.]*)/.exec(message)?.[1] ?? '';
  const name = m === 'logs' ? '[a-z_]+_log' : m === 'sand' ? '(?:red_)?sand' : 'cobblestone';
  let n = 0;
  for (const x of head.matchAll(new RegExp(`(\\d+) ${name}\\b`, 'g'))) n += Number(x[1]);
  return n;
}

/** Whether a decision's model reply came (a choice, an invalid one, or a pick taken meanwhile). */
const replied = (m: ChoiceMeta) => m.source === 'model' || m.why === 'invalid' || !!m.modelChose;

/** A chore's words-only name when it was set without an option (the wheat field and ripe slots before completion: the
 *  outcome lines the model reads, spec 5.3), as the menu names them. */
function choreName(key: string, what: string): string {
  const [kind, k] = key.split(':');
  if (kind === 'farm') return `Harvest the wheat field${Number(k) > 1 ? ' of the second plot' : ''}`;
  const crop = /^harvest (.+)$/.exec(what)?.[1];
  if (kind === 'slot' && crop) return `Harvest the ${words(crop)} farm`;
  return what ? what[0].toUpperCase() + what.slice(1) : KIND_WORDS[kind] ?? kind;
}

/** An option matches a busy key (ChoiceOption.excludes: "x=" exactly, "x" as itself or a prefix of "x:..."). */
function excluded(excludes: string[], busy: Set<string>): boolean {
  for (const e of excludes) {
    if (e.endsWith('=')) {
      if (busy.has(e.slice(0, -1))) return true;
      continue;
    }
    if (busy.has(e)) return true;
    const p = `${e}:`;
    for (const k of busy) if (k.startsWith(p)) return true;
  }
  return false;
}

/** Tries forgiven an hour after the last (the readers' effective value). */
function effTries(tries: number | undefined, lastAt: number | undefined, now: number): number {
  return tries && lastAt !== undefined && now - lastAt > 60 * 60000 ? 0 : tries ?? 0;
}

const words = (s: string) => s.replace(/_/g, ' ');
const numberWord = (n: number) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] ?? 'another';
/** What a torch batch is for with lighting on (B.4): the spots storage cannot light yet, else the reserve. */
const torchWhy = (demand: number, stock: number) => demand > stock
  ? `${demand - stock} more torch spot${demand - stock === 1 ? '' : 's'} wait in the houses and the mine than storage holds torches for`
  : `the reserve kept beyond the ${demand} torch spot${demand === 1 ? '' : 's'} still waiting (storage covers them)`;
const ago =(ms: number) => (ms < 90000 ? `${Math.max(0, Math.round(ms / 1000))} s ago` : `${Math.round(ms / 60000)} min ago`);
const clock = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
