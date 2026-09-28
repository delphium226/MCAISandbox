/**
 * Real Minecraft as a world for agents (WorldAdapter): agents are Mineflayer bots on a Java server, and RCON does
 * what bots cannot do themselves (game modes, teleports). Villages are kept in their own registry next to the server's
 * world, since their coordinates belong to that world.
 */
import minecraftData from 'minecraft-data';
import { VillageRegistry } from '../village';
import type { ToolDef, WorldAdapter } from '../world';
import { TOOLS } from '../skills';
import { BotAgent } from './botAgent';
import { MC_SKILLS } from './mcSkills';
import type { Vec3 } from 'vec3';
import { collectTargets, exposed } from './mcSurvival';
import { nearestBlocks } from './mcUtil';
import { TieredBrain } from '../tieredBrain';
import { LLMBrain } from '../llmBrain';
import { TaskBrain } from '../taskBrain';
import type { AgentBrain } from '../world';
import type { Design } from '../village';
import { Materials, designBill, gatherTasks, hardToGather, inWood } from './mcMaterials';
import type { WorldRulesStatus } from './mcRules';
import type { Rcon } from './rcon';

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

  constructor(readonly host: string, readonly port: number, readonly version: string, readonly rcon: Rcon, dataDir: string) {
    this.registry = minecraftData(version);
    this.materials = new Materials(this.registry);
    this.villages = VillageRegistry.forWorld(dataDir);
  }

  /** How many blocks collect would gather for each name lie near x,y,z, up to the number wanted (plan_layout's check). */
  materialsNear(by: string, want: Record<string, number>, x: number, y: number, z: number, range: number) {
    const a = this.agents.get(by.toLowerCase());
    if (!a) return null;
    const out: Record<string, number> = {};
    for (const [n, count] of Object.entries(want)) {
      try {
        // What collect can get: near the surface (wood 36 blocks down in a mineshaft could not be reached), anything
        // close to the site, and farther out only blocks in the open (Accept12: sandstone buried under sand 50-90 blocks
        // away counted, and gatherers found "none within 96 blocks"); only as many as wanted
        const keep = (p: Vec3) => { const d = Math.hypot(p.x - x, p.z - z); return p.y >= y - 16 && d <= range && (d <= 40 || exposed(a, p)); };
        out[n] = nearestBlocks(a, collectTargets(a, n).blocks, 128, Math.max(1, Math.ceil(count)), keep).length;
      } catch {
        // An unknown name: not this check's business
      }
    }
    return out;
  }

  /**
   * Gather tasks for building a design in survival: its raw materials (from the bill of materials and the recipe
   * chain, with a furnace and fuel when something must be smelted), in chunks two workers can share. Builders craft
   * and smelt the rest from the village storage themselves (build_design does it).
   */
  materialTasks(d: Design, label: string, wood?: string) {
    // In the village's wood kind: its logs are what gets gathered
    const bill = inWood(designBill(d), wood);
    let plan = this.materials.plan(bill);
    // A crafting table for the doors and the like, and a furnace when something must be smelted
    plan = this.materials.plan({ ...bill, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
    // Blocks that need iron ore, leather, clay or wool are too slow to gather for a village: a design using them is
    // sent back (a lantern meant mining raw iron with a stone pickaxe)
    const hard = hardToGather(plan.gather);
    const problems = [...plan.problems, ...(hard.length ? [`it needs ${hard.join(', ')}, which takes finding (drop the blocks made from it, e.g. mossy cobblestone, lanterns, bricks, wool, bookshelves; planks, logs, cobblestone and glass are gathered easily)`] : [])];
    // One log spare (a plank batch per wooden part rounds up; one kind, so no more than that)
    plan.gather['any:logs'] = (plan.gather['any:logs'] ?? 0) + (wood ? 1 : 2);
    const logs = Object.entries(plan.gather).filter(([n]) => /_log$|^any:logs$/.test(n)).reduce((s, [, q]) => s + q, 0);
    return { tasks: gatherTasks(plan.gather, label, wood), problems, logs };
  }

  isAgent(name: string) {
    return this.agents.has(name.toLowerCase());
  }

  /** A block with an item (so it can be carried and placed); states such as "[facing=east]" are allowed. */
  isPlaceable(block: string) {
    const name = block.replace(/^minecraft:/, '').replace(/\[.*\]$/, '');
    return !!this.registry.blocksByName[name] && !!this.registry.itemsByName[name];
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
      await this.rcon.command(o.position.y !== undefined ? `tp ${name} ${x} ${o.position.y} ${z}` : `spreadplayers ${x} ${z} 0 1 false ${name}`);
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
  }
}
