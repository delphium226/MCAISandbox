/**
 * Real Minecraft as a world for agents (WorldAdapter): agents are Mineflayer bots on a Java server, and RCON does
 * what bots cannot do themselves (game modes, teleports). Villages are kept in their own registry next to the server's
 * world, since their coordinates belong to that world.
 */
import path from 'node:path';
import minecraftData from 'minecraft-data';
import { FARM_TRIP_RANGE, VillageRegistry, villageHome, type Village } from '../village';
import type { ActionStatus, ToolDef, WorldAdapter } from '../world';
import { TOOLS } from '../skills';
import { BotAgent } from './botAgent';
import { MC_SKILLS } from './mcSkills';
import type { Vec3 } from 'vec3';
import { collectFilter, collectTargets, exposed } from './mcSurvival';
import { nearestBlocks, onVillageGround, stateAt } from './mcUtil';
import { annexBusy, harvesting, slotBusy } from './mcBuild';
import { SLOT_KINDS, SLOT_ORDER, penPlan } from '../farmSlots';
import { TieredBrain } from '../tieredBrain';
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

export class MineflayerWorld implements WorldAdapter {
  readonly kind = 'minecraft' as const;
  readonly villages: VillageRegistry;
  /** The skills implemented so far (mcSkills.ts), with the shared tool definitions. */
  readonly skills: ToolDef[] = TOOLS.filter((t) => t.name in MC_SKILLS);
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
  materialTasks(d: Design, label: string, wood?: string, stations = true) {
    // In the village's wood kind: its logs are what gets gathered
    const bill = inWood(designBill(d), wood);
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
    const logs = Object.entries(plan.gather).filter(([n]) => /_log$|^any:logs$/.test(n)).reduce((s, [, q]) => s + q, 0);
    const units = Object.values(plan.gather).reduce((s, q) => s + q, 0);
    return { tasks: gatherTasks(plan.gather, label, wood), problems, logs, units, smelts: plan.fuel.smelts };
  }

  private needsAt = new Map<string, number>();

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
    // The numbers are in one wood kind: the village's, else the commonest in storage, and then any logs and planks count
    // as it (birch deposits never lowered an oak need)
    const logKinds = Object.entries(store).filter(([n]) => /_log$/.test(n)).sort((x, y) => y[1] - x[1]);
    const wood = v.wood ?? logKinds[0]?.[0].replace(/_log$/, '') ?? 'oak';
    const bill: Counts = {};
    const unbuilt: string[] = [];
    for (const t of v.tasks) {
      if (!/^Build /.test(t.title) || t.status !== 'open') continue;
      const d = v.designs[/build_design "([^"]+)"/.exec(t.detail)?.[1] ?? ''];
      if (!d) continue;
      unbuilt.push(t.title.slice(6));
      // (in its own kind when it has one: F164's whole buildings, as the cover rule counts them)
      add(bill, inWood(designBill(d), (v.wood && v.woodFor?.[t.title.slice(6)]) || wood));
    }
    // The mayor's items, in the same wood ("logs" and "planks" mean the village's kind)
    const extra: Counts = {};
    for (const [n, q] of Object.entries(v.needs ?? {})) extra[n === 'logs' ? `${wood}_log` : n === 'planks' ? `${wood}_planks` : n] = q;
    add(bill, inWood(extra, wood));
    // Held: the storage, and what a worker carries of the material its gather task is for (the preparer's felled logs
    // count once deposited: counted in hand, they closed the log tasks the builds wait for)
    const norm = (b: string) => (b === 'logs' ? `${wood}_log` : b);
    const task = new Map<string, string>();
    for (const t of v.tasks) {
      const m = t.status === 'claimed' && t.claimedBy ? /^collect block=(\S+) count=\d+, then deposit/.exec(t.detail) : null;
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
    if (!v.wood)
      for (const n of Object.keys(have)) {
        const k = /_log$/.test(n) ? `${wood}_log` : /_planks$/.test(n) ? `${wood}_planks` : n;
        if (k !== n) {
          have[k] = (have[k] ?? 0) + have[n];
          delete have[n];
        }
      }
    const items = Object.keys(bill).length ? gatherNames(this.materials.plan(bill, have).gather, wood) : {};
    // A village without a wood kind gathers any logs
    if (!v.wood && items[`${wood}_log`] !== undefined) {
      items.logs = items[`${wood}_log`];
      delete items[`${wood}_log`];
    }
    // Not what no one can find near the village (sand: the windows stay open)
    for (const n of v.unavailable ?? []) delete items[n];
    v.needed = { items, for: unbuilt, updated: now };
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
    const gather = (t: { detail: string }) => {
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
      if (want > covered && !hopeless.has(item) && !open.length) {
        // Cobblestone after the mine is dug (it comes from there)
        const dig = item === 'cobblestone' ? v.tasks.find((t) => t.title === 'Dig the village mine' && (t.status === 'open' || t.status === 'claimed')) : undefined;
        // (logs and cobblestone wait for the storage; the rest is gathered meanwhile and deposited once it stands, #3)
        const early = /^(sand|red_sand|dirt|gravel|clay_ball|wheat_seeds)$/.test(item);
        const tasks = gatherTasks({ [item]: want - covered }, 'the village', v.wood).map((t) => ({ ...t, soft: true, after: [...(storage && storage.status !== 'done' && !early ? [storage.id] : []), ...(dig ? [dig.id] : [])] }));
        const made = reg.post(v, tasks, 'code', 20);
        reg.note(v, `code posted ${made.map((t) => t.id).join(', ')}: ${want} ${item} still to gather, ${covered} planned`);
        changed = true;
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

  agentList() {
    return [...this.agents.values()];
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
    return a;
  }

  remove(name: string): boolean {
    const a = this.get(name);
    if (!a) return false;
    this.agents.delete(name.toLowerCase());
    a.quit();
    return true;
  }

  tick() {
    this.ticks++;
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
    // Animals each bot can see, every 5 s (sightings for opportunistic farming, 10-08)
    if (Date.now() - this.animalsAt >= 5000) {
      this.animalsAt = Date.now();
      for (const a of this.agents.values())
        try {
          if (a.bot.entity) this.atlas.seen(a.name, a.bot.entity.position, Object.values(a.bot.entities));
        } catch (e) {
          console.error(`[atlas] ${a.name}'s animals:`, e);
        }
    }
  }

  private animalsAt = 0;

  private farmCheckAt = 0;

  /**
   * Ripe farms harvested (farming v2, 10-08, the user's choice: a chore, not a task on the board, so completion, the
   * mayor's wake-ups and the stop rules never see it): every 30 s, each planted field of a village with agents in the
   * world is read from the bots' view (ages are state ids); when 3/4 of its wheat (at least 4) is ripe, an idle worker
   * holding no task is given `harvest_farm`. Crops only grow near agents, so a field nobody has loaded is skipped. A
   * failed harvest waits 10 minutes before the next try.
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
      for (const [i, lay] of (v.layouts ?? []).entries()) {
        const farm = lay.farm;
        const k = i + 1;
        if (!farm?.planted || harvesting.has(`${v.name}:${k}`)) continue;
        // (nothing ripe after all, the bots' view and the server apart: 2 minutes)
        if (farm.lastHarvest && !farm.lastHarvest.ok && now - farm.lastHarvest.at < (farm.lastHarvest.why === 'nothing ripe' ? 2 : 10) * 60000) continue;
        // Not while the planting is still to finish (it may be back on the board for seeds)
        if (v.tasks.some((t) => t.detail.startsWith(`tend_farm layout=${k} `) && (t.status === 'open' || t.status === 'claimed'))) continue;
        const plot = v.plots.find((p) => farm.x1 >= p.x1 && farm.x2 <= p.x2 && farm.z1 >= p.z1 && farm.z2 <= p.z2);
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
        const worker = [...this.agents.values()].find((a) => a.village()?.name === v.name && a.memory.villageRole !== 'mayor' && !!a.bot.entity && a.idle()
          && !v.tasks.some((t) => t.status === 'claimed' && t.claimedBy === a.name));
        if (!worker) continue;
        // (`chore`: the brains leave its events alone, as the mayor's gathering)
        worker.enqueue('harvest_farm', { layout: k, chore: true });
        console.log(`[farm] ${v.name} layout ${k}: ${ripe} of ${grown} wheat ripe, ${worker.name} harvests`);
        this.villages.note(v, `${ripe} of ${grown} wheat ripe on layout ${k}'s farm: ${worker.name} harvests it (a chore)`);
      }
      this.slotChores(v);
    }
  }

  /** Chores the farm slots and exploring queued, by village (one at a time): its agent and the actions' statuses. */
  private chores = new Map<string, { agent: string; status: ActionStatus[]; what: string; failed?: (why: string) => void }>();
  /** Kinds with no sighting in range, by "village:kind": not searched for again until then. */
  private slotSkip = new Map<string, number>();

  /** Whether a village's chore is still under way (from the actions' own state: a stop fails them, lesson 67). */
  private choreBusy(v: Village): boolean {
    const c = this.chores.get(v.name);
    if (!c) return false;
    // (the agents map is keyed by the lower-cased name: VanX2 sent a second explorer out while the first walked home)
    if (this.agents.has(c.agent.toLowerCase()) && c.status.some((q) => q.state === 'queued' || q.state === 'running')) return true;
    this.chores.delete(v.name);
    const bad = c.status.find((q) => q.state === 'failed');
    if (bad && c.failed) c.failed(bad.message ?? 'failed');
    return false;
  }

  /**
   * The iron age (10-08; once the village is complete, after the farm slots' starts): an iron pickaxe once storage holds 3
   * raw iron (or ingots), then a bucket; while short, trips to the iron level (dig_iron) until it is finished. Each stage
   * backs off 10 minutes after a failure and is given up after 3. Returns whether a chore was queued.
   */
  private ironChores(v: Village, worker: BotAgent): boolean {
    const m = v.mine;
    if (!m || m.level === undefined) return false;
    const made = m.ironMade ?? [];
    if (made.includes('iron_pickaxe') && made.includes('bucket')) return false;
    const store = storageContents(v);
    const iron = (store.raw_iron ?? 0) + (store.iron_ingot ?? 0);
    const tool = made.includes('iron_pickaxe') ? 'bucket' : 'iron_pickaxe';
    const stage = iron >= 3 ? tool : 'dig';
    if (stage === 'dig' && m.iron?.finished) return false;
    // (failed stages forgiven after an hour, as the farm slots')
    if (m.ironTries && m.ironLastTry && Date.now() - m.ironLastTry.at > 60 * 60000) m.ironTries = {};
    const t = m.ironTries?.[stage] ?? 0, last = m.ironLastTry;
    if (t >= 3 || (last?.stage === stage && Date.now() - last.at < 10 * 60000)) return false;
    const status = stage === 'dig'
      ? worker.enqueue('dig_iron', { chore: true, minutes: 4, want: Math.max(1, (tool === 'bucket' ? 3 : 6) - iron) })
      : worker.enqueue('make_iron_tool', { item: stage, chore: true });
    const failed = (why: string) => {
      const mm = v.mine;
      if (!mm || why === 'cancelled') return;
      mm.ironTries = { ...(mm.ironTries ?? {}), [stage]: (mm.ironTries?.[stage] ?? 0) + 1 };
      mm.ironLastTry = { at: Date.now(), stage, why: why.slice(0, 200) };
      this.villages.save();
    };
    this.chores.set(v.name, { agent: worker.name, status: [status], what: `iron: ${stage}`, failed });
    console.log(`[iron] ${v.name}: ${worker.name} ${stage === 'dig' ? `digs the iron level (${iron} iron in storage)` : `makes a ${stage}`}`);
    return true;
  }

  /**
   * The annex (10-09, the user's choice: pens beside the village, not on its plot's slots): once complete, an idle worker
   * prepares it (prepare_annex); 10 minutes after a failure, given up after 3.
   */
  private annexChores(v: Village, worker: BotAgent): boolean {
    const lay = v.layouts?.[0];
    if (!lay || !v.plots.some((p) => !p.annex) || lay.annex?.state === 'ready' || annexBusy.has(v.name)) return false;
    const ax = lay.annex;
    if (ax?.tries && ax.lastTry && Date.now() - ax.lastTry.at > 60 * 60000) ax.tries = 0;
    if ((ax?.tries ?? 0) >= 3 || (ax?.lastTry && Date.now() - ax.lastTry.at < 10 * 60000)) return false;
    this.chores.set(v.name, { agent: worker.name, status: [worker.enqueue('prepare_annex', { chore: true })], what: 'prepare the annex' });
    console.log(`[annex] ${v.name}: ${worker.name} prepares the annex${ax && ax.x2 >= ax.x1 ? ` at ${ax.x1},${ax.z1}..${ax.x2},${ax.z2} (again)` : ''}`);
    return true;
  }

  /**
   * A chicken pen on the annex (10-09; v1: one pen with chickens a village): a free annex slot (or a pen left empty) is
   * started from the nearest chickens seen in the last 30 minutes within 96 blocks of the storage, off every village's
   * ground (penned ones are seen too, the pen review's H3; the skill finds the seeds to lure them with); 10
   * minutes after a failure, given up after 3 (`annex.penTries`).
   */
  private penChores(v: Village, worker: BotAgent): boolean {
    const lay = v.layouts?.[0];
    const ax = lay?.annex;
    if (!lay || ax?.state !== 'ready') return false;
    const now = Date.now();
    if (ax.penTries && ax.penLastTry && now - ax.penLastTry.at > 60 * 60000) ax.penTries = 0;
    if ((ax.penTries ?? 0) >= 3 || (ax.penLastTry && now - ax.penLastTry.at < 10 * 60000)) return false;
    const slots = (lay.slots ?? []).map((slot, jj) => ({ slot, j: jj + 1 })).filter(({ slot }) => slot.annex);
    if (slots.some(({ slot }) => slot.kind === 'chicken' && (slot.pen?.animals ?? 0) > 0)) return false;
    const pick = slots.find(({ slot }) => slot.kind === 'chicken' && !slot.laying) ?? slots.find(({ slot }) => !slot.kind);
    if (!pick || slotBusy.has(`${v.name}:1:${pick.j}`)) return false;
    const chest = v.storage?.chests[0];
    const home = chest ? { x: chest.x, z: chest.z } : villageHome(v, worker.memory);
    if (!home) return false;
    // (at about the annex's level, as the skill takes them, and not near a sighting that failed: review M3)
    // (an entry is "x,z,time": chickens wander, so a failed spot is forgiven after an hour)
    const bad = (ax.penBad ?? []).map((s) => s.split(',').map(Number)).filter(([, , t]) => !t || now - t < 60 * 60000);
    const seen = this.atlas.animalSightings('chicken', home.x, home.z, 96, 30 * 60000, (x, z) => onVillageGround(worker, x, z) || bad.some(([bx, bz]) => Math.hypot(x - bx, z - bz) <= 8))
      .find((s) => Math.abs(s.y - (ax.y + 1)) <= 4);
    if (!seen) return false;
    const [x, y, z] = [Math.floor(seen.x), Math.floor(seen.y), Math.floor(seen.z)];
    this.chores.set(v.name, { agent: worker.name, status: [worker.enqueue('start_pen', { layout: 1, slot: pick.j, x, y, z, chore: true })], what: 'start a chicken pen' });
    console.log(`[pen] ${v.name}: chicken seen at ${x},${y},${z}; ${worker.name} starts a pen on annex slot ${pick.j}`);
    this.villages.note(v, `chickens seen at ${x},${y},${z}: ${worker.name} leads them into a pen on the annex (a chore)`);
    return true;
  }

  private idleWorker(v: Village): BotAgent | undefined {
    return [...this.agents.values()].find((a) => a.village()?.name === v.name && a.memory.villageRole !== 'mayor' && !!a.bot.entity && a.idle()
      && !v.tasks.some((t) => t.status === 'claimed' && t.claimedBy === a.name));
  }

  /**
   * Opportunistic farming and exploring (10-08; chores beside the board, lesson 93): a planted slot that is ripe is
   * harvested (as the wheat: before completion only when nothing is claimable); once the village is complete, a free slot
   * is started with the first kind (SLOT_ORDER) not farmed yet that was seen within FARM_TRIP_RANGE of home on ground
   * collect may take from; with nothing to start, an idle worker explores, one ring point at a time.
   */
  private slotChores(v: Village) {
    if (this.choreBusy(v)) return;
    const now = Date.now();
    const layouts = v.layouts ?? [];
    // A start cut off by a restart (its finally never ran): the slot free again, or its planting kept (the diff review's
    // M1); failed starts forgiven after an hour
    for (const [i, lay] of layouts.entries())
      for (const [jj, slot] of (lay.slots ?? []).entries()) {
        if (slot.laying && !slotBusy.has(`${v.name}:${i + 1}:${jj + 1}`)) {
          // (a pen whose ring stands keeps it; its gate is shut, the count waits for the next try: the pen design's H2)
          if (slot.kind === 'chicken' && slot.pen?.built) {
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
        if (!spec || slot.laying || !slot.planted || slotBusy.has(`${v.name}:${k}:${j}`)) continue;
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
        this.chores.set(v.name, { agent: worker.name, status: [worker.enqueue('harvest_slot', { layout: k, slot: j, chore: true })], what: `harvest ${slot.kind}` });
        console.log(`[farm] ${v.name} slot ${k}.${j}: ${ripe} ${slot.kind} ripe, ${worker.name} harvests`);
        return;
      }
    if (!v.complete) return;
    const worker = this.idleWorker(v);
    if (!worker) return;
    // A free slot started with a kind found near the village
    const free = layouts.flatMap((lay, i) => (lay.slots ?? []).map((slot, jj) => ({ slot, k: i + 1, j: jj + 1 })))
      .find(({ slot, k, j }) => !slot.annex && !slot.kind && !slotBusy.has(`${v.name}:${k}:${j}`) && (slot.tries ?? 0) < 3 && (!slot.lastTry || now - slot.lastTry.at > 10 * 60000));
    if (free) {
      const farmed = new Set(layouts.flatMap((l) => (l.slots ?? []).map((q) => q.kind)).filter(Boolean));
      const bad = new Set(layouts.flatMap((l) => (l.slots ?? []).flatMap((q) => q.bad ?? [])));
      // (searched from collect's home, the storage chest, and judged by collect's own filter: the design review's M1)
      const chest = v.storage?.chests[0];
      const home = chest ? { x: chest.x, z: chest.z } : villageHome(v, worker.memory);
      const ok = collectFilter(worker, FARM_TRIP_RANGE);
      for (const kind of SLOT_ORDER) {
        const skip = `${v.name}:${kind}`;
        if (farmed.has(kind) || (this.slotSkip.get(skip) ?? 0) > now || !home) continue;
        const seen = this.atlas.sightings(kind, Math.floor(home.x), Math.floor(home.z), FARM_TRIP_RANGE)
          // (bad by column, F192; cane by the blocks a cut can take, which must cover the two a start needs: the atlas counts
          // a stalk's blocks above its base for cane, and a one-stalk sighting of two blocks gave one and failed twice)
          .find(([x, y, z, n]) => ok({ x, y, z }) && !bad.has(`${kind}@${x},${z}`) && !bad.has(`${kind}@${x},${y},${z}`) && (kind !== 'sugar_cane' || n >= 2));
        if (!seen) {
          this.slotSkip.set(skip, now + 10 * 60000);
          continue;
        }
        const [x, y, z] = seen;
        this.chores.set(v.name, { agent: worker.name, status: [worker.enqueue('start_farm', { layout: free.k, slot: free.j, kind, x, y, z, chore: true })], what: `start ${kind}` });
        console.log(`[farm] ${v.name}: ${kind} seen at ${x},${y},${z}; ${worker.name} starts a ${kind} farm on slot ${free.k}.${free.j}`);
        this.villages.note(v, `${kind} seen at ${x},${y},${z}: ${worker.name} starts a ${kind} farm on farm slot ${free.j} (a chore)`);
        return;
      }
    }
    // The annex and its pen before the iron age (a trip ties the chores up for minutes, again and again: the pen review's M2)
    if (this.annexChores(v, worker) || this.penChores(v, worker)) return;
    if (this.ironChores(v, worker)) return;
    // Exploring: one ring point at a time, FARM_TRIP_RANGE from home, the least known first, each point once (the bots at
    // home already see ~128 blocks: view distance 8, the design review's H3)
    // (only while a slot is free: there is nothing else to find for yet, the diff review's L4)
    if (!free) return;
    const ex = (v.explore ??= { visited: [] });
    if (ex.done || harvesting.size || slotBusy.size) return;
    const home = villageHome(v, worker.memory);
    if (!home) return;
    const points = Array.from({ length: 8 }, (_, i) => ({ i, x: Math.round(home.x + FARM_TRIP_RANGE * Math.cos((i * Math.PI) / 4)), z: Math.round(home.z + FARM_TRIP_RANGE * Math.sin((i * Math.PI) / 4)) }));
    const next = points.filter((q) => !ex.visited.includes(q.i)).sort((p, q) => this.atlas.known(p.x, p.z, 48) - this.atlas.known(q.x, q.z, 48))[0];
    if (!next) {
      ex.done = true;
      this.villages.note(v, 'explored all round the village');
      this.villages.save();
      return;
    }
    ex.visited.push(next.i);
    ex.last = `${worker.name} to ${next.x},${next.z}`;
    this.villages.save();
    const out = worker.enqueue('scout', { x: next.x, z: next.z, chore: true });
    // (home: true, teleported home when the walk back fails: Worker1 floated in a lake 4 min, F189)
    const back = worker.enqueue('scout', { x: Math.round(home.x), z: Math.round(home.z), chore: true, home: true });
    this.chores.set(v.name, { agent: worker.name, status: [out, back], what: `explore ${next.x},${next.z}` });
    console.log(`[explore] ${v.name}: ${worker.name} scouts ${next.x},${next.z} (${ex.visited.length} of 8), then home`);
  }
}
