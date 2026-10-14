/**
 * Real Minecraft as a world for agents (WorldAdapter): agents are Mineflayer bots on a Java server, and RCON does
 * what bots cannot do themselves (game modes, teleports). Villages are kept in their own registry next to the server's
 * world, since their coordinates belong to that world.
 */
import path from 'node:path';
import minecraftData from 'minecraft-data';
import { FARM_TRIP_RANGE, MINE_TASK, PARTS_MAKE, PICK_GATHER, PICK_SUPPLY, STATION_NAMES, VillageRegistry, WINDOWS, preparedAt, signTask, stationsOwed, villageHome, type Task, type Village } from '../village';
import { STORAGE_HUT } from '../huts';
import type { ActionStatus, ChoiceContext, ChoiceKind, ChoiceMenu, ChoiceMeta, ChoiceOption, ChoiceStatus, ChoiceSummary, ToolDef, WorldAdapter, WorldAgent } from '../world';
import { TOOLS } from '../skills';
import { BotAgent } from './botAgent';
import { MC_SKILLS } from './mcSkills';
import { Vec3 } from 'vec3';
import { collectFilter, collectTargets, exposed } from './mcSurvival';
import { nearestBlocks, onVillageGround, stateAt } from './mcUtil';
import { annexBusy, cakeShort, harvesting, slotBusy } from './mcBuild';
import { mineCanGive, mineFaces } from './mcMine';
import { EGGS, PEN_KINDS, PEN_ORDER, SLOT_KINDS, SLOT_ORDER, penPlan } from '../farmSlots';
import { timeScale } from './mcRules';
import { choiceId, countsDelta, itemCounts, logChoice, logChoiceBan, logChoiceDrop, logChoiceEnd, type ChoiceDrop, type ChoiceLogOption } from './mcChoiceLog';
import { CHOOSE, ChoiceStats, ChooserQueue, choose, choreProductive, fixedPick, trimMenu } from '../choose';
import { label, parseSpec, type ModelSpec } from '../modelCall';
import { TieredBrain } from '../tieredBrain';
import { REASONING, isCloudModel, usage } from '../modelUsage';
import { LLMBrain } from '../llmBrain';
import { TaskBrain } from '../taskBrain';
import type { AgentBrain } from '../world';
import type { Design } from '../village';
import { Materials, designBill, designBlockList, gatherNames, gatherTasks, hardToGather, inWood, type Counts } from './mcMaterials';
import { storageContents } from './mcStorage';
import type { WorldRulesStatus } from './mcRules';
import type { Rcon } from './rcon';
import { Atlas } from './mcAtlas';
import { vanillaLibrary, villageBiome } from '../vanillaPieces';
import { vanillaJar } from '../vanillaData';
import { HOUSE_UNITS, LANDMARK_UNITS, MAX_SMELTS, isLandmark, validateDesign } from '../designs';

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
};

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
    if (own.length || v.mine?.level === undefined || !v.tasks.some((t) => /^Build /.test(t.title) && t.status === 'open')) return;
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
    if (v.complete) {
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

  async spawn(rawName: string, o: SpawnOptions = {}): Promise<BotAgent> {
    const name = rawName.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);
    if (!name) throw new Error('invalid name');
    if (this.isAgent(name)) throw new Error(`agent ${name} already exists`);
    const brain = o.brain ?? null;
    if (brain && !MC_BRAINS[brain]) throw new Error(`unknown brain ${brain}. Options: ${Object.keys(MC_BRAINS).join(', ')}`);
    const a = new BotAgent(this, name, o.role ?? 'villager');
    this.agents.set(name.toLowerCase(), a);
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
        if (unloaded || ripe < 4 || ripe < 0.75 * grown) continue;
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
      this.slotChores(v);
    }
  }

  /**
   * Chores under way, by agent (lower-cased name; F193, 10-09: one chore an agent, so a second idle worker and the mayor
   * take chores of other kinds at the same time). `key` names what the chore works on: `slot:k:j`, `farm:k`, `start`,
   * `annex`, `pen`, `iron` or `explore` (A.2's instances: `explore:i`, `start:k:j`, and further keys in `choice.holds`);
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
      ...(o.lp !== undefined ? { lp: o.lp } : {}), ...(shown && shown.includes(o.id) ? { shown: shown.indexOf(o.id) + 1 } : {}),
    }));
    const position = opt && shown?.includes(opt.id) ? shown.indexOf(opt.id) + 1 : undefined;
    logChoice({
      id: choice.id, agent: worker.name, village: v.name, t: choice.t, key, what, kind, reason: meta?.reason ?? 'fixed order', options,
      ...(opt ? { chosen: opt.id } : {}), source: meta?.source ?? 'fixed', ...(meta?.why ? { why: meta.why } : {}),
      ...(position ? { position } : {}), ...(shown ? { shownCount: shown.length } : {}),
      ...(!shown && meta?.shown?.length ? { shownIds: meta.shown } : {}),
      ...(meta?.modelChose ? { modelChose: meta.modelChose, modelReason: meta.modelReason ?? '' } : {}),
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
    const message = bad?.message ?? (done ? c.status[c.status.length - 1]?.message ?? '' : 'agent gone');
    const ok = !bad && done;
    const v = this.villages.get(c.village);
    const held = agent ? heldCounts(agent) : null;
    const carried = held ? countsDelta(c.choice.carried, held) : null;
    // (a stop or a removal fails every action as "cancelled", which the chores' own failed callbacks ignore too)
    const cut = !ok && (!agent || bad?.message === 'cancelled');
    const code = bad?.code;
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
  private runPick(agent: WorldAgent, id: string | null, meta: ChoiceMeta): { ok: true; key: string } | { ok: false; why: string } {
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
        return ripe < 4 || ripe < 0.75 * grown ? null : { ripe, grown, plot };
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
   * farm starts, the annex, pens, pen work, the cake, the iron age, exploring). Pure: the writes the old picker made while
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
    const others = (kind: ChoiceKind) => {
      const names = [...this.chores.values()].filter((c) => c.village === v.name && c.agent !== a.name && !c.choice.ended && c.choice.kind === kind).map((c) => c.agent);
      return names.length ? `; on it: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}` : '';
    };
    const record = (kind: ChoiceKind) => {
      const s = this.choiceStats.agentKind(v.name, a.name, kind);
      return s ? `you: ${s.ok} of ${s.n} done, ~${Math.max(0.1, Math.round(s.minutes * 10) / 10)} min each` : 'you: never done';
    };
    const lastOf = (kind: ChoiceKind) => {
      const l = this.choiceStats.villageLast(v.name, kind);
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
      const name = `Harvest the wheat field${multi && k > 1 ? ' of the second plot' : ''}`;
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
          id: `slot:${k}:${j}`, kind: 'slot', key: `slot:${k}:${j}`, excludes, name: `Harvest the ${words(slot.kind)} farm${layouts.length > 1 && k > 1 ? ' of the second plot' : ''}${(lay.slots ?? []).filter((s) => s.kind === slot.kind).length > 1 ? ` on slot ${numberWord(j)}` : ''}`,
          rank: 100 + 10 * k + j, at: { x: Math.floor((slot.x1 + slot.x2) / 2), z: Math.floor((slot.z1 + slot.z2) / 2) },
          facts: `${f.ripe} ripe; ${dist((slot.x1 + slot.x2) / 2, (slot.z1 + slot.z2) / 2)}; ${record('slot')}${others('slot')}${lastOf('slot')}`,
          effect: `about ${f.ripe} ${words(slot.kind)}`,
        }, { kind: 'slot', k, j, ripe: f.ripe, slotKind: slot.kind });
      }

    // Farm starts: a free slot started with a kind found near the village. Single keys: one start at a time, on the first
    // free slot, with the first kind seen (today's); instances: up to two at once, on different slots and of different
    // kinds (each holds its slot and its kind, spec 3)
    const freeSlots = layouts.flatMap((lay, i) => (lay.slots ?? []).map((slot, jj) => ({ slot, k: i + 1, j: jj + 1 })))
      .filter(({ slot, k, j }) => !slot.annex && !slot.kind && !slotBusy.has(`${v.name}:${k}:${j}`) && effTries(slot.tries, slot.lastTry?.at, now) < 3 && (!slot.lastTry || now - slot.lastTry.at > 10 * 60000));
    const startInst = instances('start');
    const freeOpen = startInst ? freeSlots.filter(({ k, j }) => !busy.has(`start:${k}:${j}`)) : freeSlots.slice(0, 1);
    const want = startInst ? Math.min(2, freeOpen.length) : freeOpen.length ? 1 : 0;
    if (!freeOpen.length) reasons.start = freeSlots.length ? 'free slots taken' : 'no free slot';
    else if (startInst ? busy.has('pen') : busy.has('start') || busy.has('pen')) reasons.start = 'busy';
    else {
      const free = freeOpen[0];
      const farmed = new Set(layouts.flatMap((l) => (l.slots ?? []).map((q) => q.kind)).filter(Boolean));
      const badSeen = new Set(layouts.flatMap((l) => (l.slots ?? []).flatMap((q) => q.bad ?? [])));
      const home = facts.startHome;
      let found = 0;
      for (const [s, kind] of SLOT_ORDER.entries()) {
        if (found >= want) break;
        const skip = `${v.name}:${kind}`;
        if (farmed.has(kind) || (this.slotSkip.get(skip) ?? 0) > now || !home) continue;
        // (a kind another start holds: not walked, not skipped)
        if (startInst && busy.has(`farmkind:${kind}`)) continue;
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

    // Pens on the annex: one with animals of each kind (no harvest, farm start or other lure beside it, the pen review's L3)
    const penEx = ['pen', 'annex', 'start', 'slot', 'farm'];
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
        if ((pen.animals ?? 0) >= 2 && (pen.animals ?? 0) < spec.cap && (store[spec.lure] ?? 0) >= 2 && due(pen, 'breed', 5 / scale)) works.push([2, 'breed', 'breed_pen', `Breed the ${slot.kind}s`, `${store[spec.lure] ?? 0} ${words(spec.lure)} in storage`]);
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
      // The cake (at most two in storage)
      if (excluded(['cake'], busy)) reasons.cake = 'busy';
      else if (cakeShort(store).length) reasons.cake = 'storage short';
      else if ((store.cake ?? 0) >= 2) reasons.cake = 'two cakes stored';
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

    // Model mode's guards (D5): bans, the agent's own cooldown, learning progress, then the trim
    const guarded: Array<{ id: string; why: string }> = [];
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
        if (this.choiceStats.agentCooling(v.name, a.name, o.kind, now)) {
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

  /** The prompt's context (pure): the village at a glance, the others' chores, the agent's last outcomes. */
  private choiceContext(v: Village, a: BotAgent, facts: Facts): ChoiceContext {
    const s = facts.store;
    const items = ['wheat', 'wheat_seeds', 'bread', 'raw_iron', 'bucket', 'milk_bucket', 'egg', 'sugar_cane', 'cake'].filter((n) => s[n]).map((n) => `${s[n]} ${words(n)}`);
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
    return {
      persona: typeof a.memory.persona === 'string' ? a.memory.persona.slice(0, 300) : '',
      village: village.slice(0, 300), others: others.slice(0, 200),
      outcomes: this.choiceStats.outcomes(v.name, a.name, 5),
    };
  }

  /**
   * Run an option: the writes the old picker made at queue time (spec 1.3: a pen's workAt, the cake's back-off, the explore
   * ring), then the skill queued and the chore recorded. Called only inside runPick's try (D9).
   */
  private runOption(v: Village, worker: BotAgent, opt: ChoiceOption, meta: ChoiceMeta) {
    const d = OPTION_RUN.get(opt);
    if (!d) throw new Error(`no run data for ${opt.id}`);
    switch (d.kind) {
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
    // Expired guards' bookkeeping
    for (const [k, until] of this.bansLogged) if (until < now) this.bansLogged.delete(k);
    const members = this.idleMembers(v, now);
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
      for (const [n, a] of members.entries()) {
        if (!this.isIdleMember(v, a, now)) continue;
        const model = this.chooseMode(a) === 'model';
        const { menu, skips } = this.menu(v, a, ctx.busy, model, facts, ctx.first);
        const pick = menu.options[0];
        // (the old picker wrote these only when it walked the farm starts: a member whose pick is a field or a ripe slot
        // never got there)
        if (model || !pick || pick.rank >= 200) for (const s of skips) this.slotSkip.set(s, now + 10 * 60000);
        // (every ring point visited: the ring is done once a member finds none left, as the old picker wrote it when it got
        // that far; the village's log keeps 40 notes, so the note's timing shows in it)
        if ((model || !pick) && menu.reasons.explore === 'all visited' && v.explore && !v.explore.done) {
          v.explore.done = true;
          this.villages.note(v, 'explored all round the village');
          this.villages.save();
        }
        if (!pick) {
          none.push({ agent: a.name, reasons: menu.reasons });
          if (!model) {
            // (today's loop stopped at the first member with nothing: the rest have nothing either)
            for (const b of members.slice(n + 1)) if (this.isIdleMember(v, b, now)) none.push({ agent: b.name, reasons: menu.reasons });
            break;
          }
          continue;
        }
        if (!model) {
          const r = this.runChoice(a, pick.id, { source: 'fixed', reason: 'fixed order', menu });
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
  private submitDecision(v: Village, a: BotAgent, menu: ChoiceMenu, call: { decisionId: string; spec: ModelSpec }) {
    const id = a.name.toLowerCase();
    const p: PendingChoice = { id, agent: a, village: v.name, decisionId: call.decisionId, ac: new AbortController(), since: Date.now(), state: 'queued', menu };
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
          promptTokens: r.promptTokens, outputTokens: r.outputTokens, menu, prompt: r.prompt,
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
        this.runPick(a, r.id, meta);
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
}

/** What running an option takes, beside the option's data (kept off the option, which stays plain data). */
type OptionRun =
  | { kind: 'farm'; k: number; ripe: number; grown: number }
  | { kind: 'slot'; k: number; j: number; ripe: number; slotKind: string }
  | { kind: 'start'; k: number; j: number; slotKind: string; x: number; y: number; z: number }
  | { kind: 'annex'; again: boolean; area: string }
  | { kind: 'pen'; j: number; slotKind: string; x: number; y: number; z: number }
  | { kind: 'penwork'; j: number; what: string; skill: string; slotKind: string; animals: number }
  | { kind: 'cake' }
  | { kind: 'iron'; stage: string; tool: string; iron: number }
  | { kind: 'explore'; i: number; x: number; z: number; home: { x: number; z: number } };
const OPTION_RUN = new WeakMap<ChoiceOption, OptionRun>();

const CHOICE_KINDS: ChoiceKind[] = ['farm', 'slot', 'start', 'annex', 'pen', 'penwork', 'cake', 'iron', 'explore'];
/** Ring point i's direction (0 east, clockwise: z grows to the south). */
const DIRECTIONS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
const KIND_WORDS: Record<string, string> = { farm: 'harvesting', slot: 'harvesting', start: 'starting farms', annex: 'preparing the annex', pen: 'leading animals', penwork: 'tending pens', cake: 'baking', iron: 'iron work', explore: 'exploring' };

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
const ago = (ms: number) => (ms < 90000 ? `${Math.max(0, Math.round(ms / 1000))} s ago` : `${Math.round(ms / 60000)} min ago`);
const clock = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
