/**
 * AI agent framework.
 *
 * Agents are real players on the server (visible to everyone, same rules, same inventory/crafting code),
 * but instead of a WebSocket client their body is driven server-side by an AgentController which executes
 * high-level *skills* (move_to, mine, collect, craft, smelt, place, attack, follow, give, chat, ...).
 *
 * Something external (an LLM, a scripted policy, a research harness such as a PIANO-style architecture)
 * decides WHICH skills to run. It can do that either
 *   - in-process by implementing `AgentBrain` (see brains.ts), or
 *   - over HTTP via the REST API below (observe -> act loop), from any language.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Game } from './game';
import { Player, Connection } from './player';
import type { Entity } from './entity';
import { ItemEntity } from './entity';
import { Mob } from './mobs';
import type { S2C } from '../../shared/src/protocol';
import { ItemStack, itemDef, ITEMS_BY_NAME, itemId } from '../../shared/src/items';
import { BLOCKS, BLOCKS_BY_NAME, blockOf } from '../../shared/src/blocks';
import { BIOMES } from '../../shared/src/biomes';
import { findPath, PathNode, standable } from '../../shared/src/pathfinding';
import { stepPlayer, MoveInput, raycast } from '../../shared/src/physics';
import { breakTicks, canHarvest } from '../../shared/src/mining';
import { RECIPES, Recipe, TAGS, SMELTING, fuelValue } from '../../shared/src/recipes';
import { countItem, removeItem } from '../../shared/src/inventory';
import { DAY_LENGTH, FACE_DIRS, PLAYER_EYE_HEIGHT, PLAYER_WIDTH, REACH_DISTANCE } from '../../shared/src/constants';
import { readJson, sendJson } from './api';
import { VillageRegistry, Village, Area, Reservation, Design, overlaps, areaText } from './village';
import { validateDesign } from './designs';
import { BRAINS, AgentBrain } from './brains';
import type { FurnaceState } from './containers';

// ---------------------------------------------------------------------------------------------
// Events & observations
// ---------------------------------------------------------------------------------------------

export interface AgentEvent {
  id: number;
  tick: number;
  type: 'chat' | 'damage' | 'death' | 'pickup' | 'crafted' | 'action_done' | 'action_failed' | 'system' | 'killed' | 'broke';
  text: string;
  data?: Record<string, unknown>;
}

export interface Observation {
  name: string;
  tick: number;
  timeOfDay: number;
  isDay: boolean;
  position: { x: number; y: number; z: number };
  yaw: number;
  health: number;
  food: number;
  gamemode: string;
  dead: boolean;
  biome: string;
  holding: string | null;
  inventory: Record<string, number>;
  equipment: (string | null)[];
  nearbyBlocks: Record<string, { count: number; nearest: [number, number, number] }>;
  nearbyEntities: Array<{ id: number; kind: string; name?: string; x: number; y: number; z: number; distance: number; health?: number }>;
  currentAction: ActionStatus | null;
  queuedActions: number;
  recentEvents: AgentEvent[];
}

export interface ActionStatus {
  id: number;
  type: string;
  args: Record<string, unknown>;
  state: 'queued' | 'running' | 'done' | 'failed';
  message?: string;
  startedTick?: number;
}

/** Connection stand-in for an agent: collects the messages a human client would receive. */
class AgentConnection implements Connection {
  readonly isAgent = true;
  constructor(private agent: () => Agent | undefined) {}
  send(msg: S2C) {
    const a = this.agent();
    if (!a || typeof a.hearChat !== 'function') return;
    if (msg.t === 'chat' && msg.from && msg.from !== a.player.name) a.hearChat(msg.from, msg.text);
    else if (msg.t === 'death') a.pushEvent('death', msg.msg);
  }
  sendBinary() {}
  close() {}
}

// ---------------------------------------------------------------------------------------------
// Skills (actions)
// ---------------------------------------------------------------------------------------------

type SkillResult = 'running' | 'done' | { done: string } | { fail: string };

abstract class Skill {
  ticks = 0;
  constructor(public agent: Agent, public args: Record<string, unknown>) {}
  /** Called every tick until it returns 'done' or {fail}. */
  abstract tick(): SkillResult;
  cancel() {}
  get game() {
    return this.agent.game;
  }
  get player() {
    return this.agent.player;
  }
}

const num = (v: unknown, name: string): number => {
  const n = Number(v);
  if (!isFinite(n)) throw new Error(`argument '${name}' must be a number`);
  return n;
};
const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v) throw new Error(`argument '${name}' must be a string`);
  return v;
};

/** Walks along an A* path. Reused by most other skills. */
class Navigator {
  path: PathNode[] | null = null;
  idx = 0;
  stuck = 0;
  lastDist = Infinity;
  replans = 0;
  digging = false;
  digTicks = 0;
  constructor(public agent: Agent, public goal: PathNode, public range: number) {}

  /** In creative mode, when there is no path, tunnel straight toward the goal through natural blocks instead of giving up. */
  private startDigging(): false | 'fail' {
    if (this.agent.player.gamemode !== 'creative' || this.digging) return 'fail';
    this.digging = true;
    this.digTicks = 0;
    return false;
  }

  private dig(): boolean | 'fail' {
    const p = this.agent.player;
    const b = p.body;
    const w = this.agent.game.world;
    if (++this.digTicks > 20 * 30) return 'fail';
    const dx = this.goal.x + 0.5 - b.x, dz = this.goal.z + 0.5 - b.z, hd = Math.hypot(dx, dz);
    const bx = Math.floor(b.x), fy = Math.floor(b.y + 0.01), bz = Math.floor(b.z);
    const up = this.goal.y > fy, down = this.goal.y < fy && hd < 1.5;
    const cells: Array<[number, number, number]> = [];
    if (hd > 0.5) {
      const nx = Math.floor(b.x + (dx / hd) * 0.9), nz = Math.floor(b.z + (dz / hd) * 0.9);
      // Going up: keep the block ahead at foot level as a step and clear headroom to jump onto it
      if (up) cells.push([nx, fy + 1, nz], [nx, fy + 2, nz], [bx, fy + 2, bz]);
      else cells.push([nx, fy, nz], [nx, fy + 1, nz]);
    }
    if (down) cells.push([bx, fy - 1, bz]);
    for (const [x, y, z] of cells) {
      const def = blockOf(w.getBlock(x, y, z));
      if (def.solid && def.hardness >= 0 && NATURAL.test(def.name)) p.breakBlock(x, y, z); // never tunnel through builds
    }
    this.agent.lookAt(this.goal.x + 0.5, b.y + PLAYER_EYE_HEIGHT, this.goal.z + 0.5, true);
    this.agent.input.forward = hd > 0.3 ? 1 : 0;
    this.agent.input.jump = up;
    return false;
  }

  /** Returns true when within range; 'fail' if unreachable. */
  step(): boolean | 'fail' {
    const p = this.agent.player;
    const b = p.body;
    const d = Math.hypot(b.x - (this.goal.x + 0.5), b.y - this.goal.y, b.z - (this.goal.z + 0.5));
    if (d <= this.range + 0.3) {
      this.agent.input.forward = 0;
      this.agent.input.jump = false;
      return true;
    }
    if (this.digging) return this.dig();
    if (!this.path || this.idx >= this.path.length) {
      // Global per-tick pathfinding budget keeps tick time flat with many agents
      if (this.agent.manager.pathBudget <= 0) {
        this.agent.input.forward = 0;
        return false;
      }
      this.agent.manager.pathBudget--;
      if (this.replans++ > 6) return this.startDigging();
      this.path = findPath(this.agent.game.world, { x: b.x, y: b.y + 0.01, z: b.z }, this.goal, this.range, 3500);
      this.idx = 1;
      if (!this.path) return this.startDigging();
      if (this.path.length <= 1) {
        // Already at the closest reachable spot
        this.agent.input.forward = 0;
        return d <= this.range + 1.5 ? true : this.startDigging();
      }
    }
    const wp = this.path[this.idx];
    // Open a closed door on the way (the pathfinder treats doors as passable); toggling one half moves both
    const world = this.agent.game.world;
    for (const dy of [0, 1]) {
      const s = world.getBlock(wp.x, wp.y + dy, wp.z);
      if (BLOCKS[s & 0xff].name === 'oak_door' && !((s >> 8) & 4)) {
        this.agent.lookAt(wp.x + 0.5, wp.y + dy + 0.5, wp.z + 0.5);
        p.useOnBlock(wp.x, wp.y + dy, wp.z, 0, 0.5, 0.5, 0.5, false);
        break;
      }
    }
    const tx = wp.x + 0.5, tz = wp.z + 0.5;
    const dx = tx - b.x, dz = tz - b.z;
    const hd = Math.hypot(dx, dz);
    if (hd < 0.35 && Math.abs(b.y - wp.y) < 1.2) {
      this.idx++;
      this.stuck = 0;
      return false;
    }
    this.agent.lookAt(tx, b.y + PLAYER_EYE_HEIGHT, tz, true);
    this.agent.input.forward = hd > 0.15 ? 1 : 0;
    this.agent.input.sprint = this.path.length - this.idx > 6 && p.food > 6;
    this.agent.input.jump = (wp.y > Math.floor(b.y + 0.01) && hd < 1.6) || (b.inWater && wp.y >= Math.floor(b.y));
    // Stuck detection
    if (Math.abs(hd - this.lastDist) < 0.01) this.stuck++;
    else this.stuck = 0;
    this.lastDist = hd;
    if (this.stuck > 30) {
      this.path = null;
      this.stuck = 0;
      this.agent.input.jump = true;
    }
    return false;
  }
}

class MoveToSkill extends Skill {
  nav: Navigator;
  constructor(agent: Agent, args: Record<string, unknown>) {
    super(agent, args);
    this.nav = new Navigator(agent, { x: Math.floor(num(args.x, 'x')), y: Math.floor(num(args.y, 'y')), z: Math.floor(num(args.z, 'z')) }, args.range !== undefined ? num(args.range, 'range') : 1);
  }
  tick(): SkillResult {
    if (++this.ticks > 20 * 120) return { fail: 'timed out' };
    const r = this.nav.step();
    if (r === 'fail') return { fail: 'no path to target' };
    return r ? 'done' : 'running';
  }
}

class MineSkill extends Skill {
  nav: Navigator;
  digTicks = 0;
  target: [number, number, number];
  collectTicks = 0;
  constructor(agent: Agent, args: Record<string, unknown>) {
    super(agent, args);
    this.target = [Math.floor(num(args.x, 'x')), Math.floor(num(args.y, 'y')), Math.floor(num(args.z, 'z'))];
    const [x, y, z] = this.target;
    this.nav = new Navigator(agent, { x, y, z }, 3.2);
  }
  tick(): SkillResult {
    if (++this.ticks > 20 * 90) return { fail: 'timed out' };
    const [x, y, z] = this.target;
    const world = this.game.world;
    const s = world.getBlock(x, y, z);
    if ((s & 0xff) === 0 || blockOf(s).fluid) {
      // Wait a moment to collect drops
      if (this.collectTicks++ < 80 && this.agent.collectNearbyItems(x, y, z)) return 'running';
      return 'done';
    }
    const def = blockOf(s);
    if (def.hardness < 0) return { fail: `${def.name} is unbreakable` };
    const r = this.nav.step();
    if (r === 'fail') return { fail: 'cannot reach block' };
    if (!r) return 'running';
    this.agent.input.forward = 0;
    this.agent.equipBestTool(s);
    this.agent.lookAt(x + 0.5, y + 0.5, z + 0.5);
    if (!canHarvest(def, this.player.heldItem()) && this.args.force !== true) return { fail: `need a better tool to harvest ${def.name}` };
    const p = this.player;
    if (!p.digging || p.digging.x !== x || p.digging.y !== y || p.digging.z !== z) {
      p.digging = { x, y, z, start: this.game.tick, stage: -1 };
      this.digTicks = 0;
    }
    this.digTicks++;
    if (this.digTicks % 5 === 0) this.game.broadcastNear(p, { t: 'anim', id: p.id, a: 'swing' });
    const need = breakTicks(s, p.heldItem(), { inWater: p.body.eyesInWater, onGround: p.body.onGround, creative: p.gamemode === 'creative' });
    if (this.digTicks >= need) {
      p.digging = null;
      p.breakBlock(x, y, z);
    }
    return 'running';
  }
  cancel() {
    this.player.digging = null;
  }
}

/** Find and mine N blocks of a type (e.g. collect 5 oak_log). */
class CollectSkill extends Skill {
  blockIds: Set<number>;
  want: number;
  itemIdWanted: number | null;
  startCount: number;
  current: MineSkill | null = null;
  failed = new Set<string>();
  constructor(agent: Agent, args: Record<string, unknown>) {
    super(agent, args);
    const name = str(args.block, 'block');
    const names = name.startsWith('#') ? TAGS[name.slice(1)] ?? [] : name === 'log' || name === 'logs' ? TAGS.logs : [name];
    this.blockIds = new Set(names.map((n) => BLOCKS_BY_NAME.get(n)?.id).filter((x): x is number => x !== undefined));
    if (!this.blockIds.size) throw new Error(`unknown block ${name}`);
    this.want = args.count !== undefined ? num(args.count, 'count') : 1;
    // What item do these blocks drop? (count progress by blocks mined if unclear)
    const first = BLOCKS[[...this.blockIds][0]];
    const drop = first.drops === 'self' ? first.name : Array.isArray(first.drops) && first.drops[0] ? first.drops[0].item : null;
    this.itemIdWanted = drop ? itemId(drop) : null;
    this.startCount = this.itemIdWanted !== null ? countItem(agent.player.inventory, this.itemIdWanted) : 0;
    this.mined = 0;
  }
  mined: number;
  tick(): SkillResult {
    if (++this.ticks > 20 * 300) return { fail: 'timed out' };
    const have = this.itemIdWanted !== null ? countItem(this.player.inventory, this.itemIdWanted) - this.startCount : this.mined;
    if (have >= this.want) return 'done';
    if (!this.current) {
      const pos = this.agent.findNearestBlock((id) => this.blockIds.has(id), 48, this.failed);
      if (!pos) return have > 0 ? { fail: `only found ${have}; no more nearby` } : { fail: 'none found nearby' };
      this.current = new MineSkill(this.agent, { x: pos[0], y: pos[1], z: pos[2] });
    }
    const r = this.current.tick();
    if (r === 'done') {
      this.mined++;
      this.current = null;
    } else if (typeof r === 'object' && 'fail' in r) {
      const t = this.current.target;
      this.failed.add(t.join(','));
      this.current = null;
      if (this.failed.size > 8) return { fail: r.fail };
    }
    return 'running';
  }
  cancel() {
    this.current?.cancel();
  }
}

class PlaceSkill extends Skill {
  nav: Navigator;
  target: [number, number, number];
  constructor(agent: Agent, args: Record<string, unknown>) {
    super(agent, args);
    this.target = [Math.floor(num(args.x, 'x')), Math.floor(num(args.y, 'y')), Math.floor(num(args.z, 'z'))];
    this.nav = new Navigator(agent, { x: this.target[0], y: this.target[1], z: this.target[2] }, 3.5);
  }
  tick(): SkillResult {
    if (++this.ticks > 20 * 60) return { fail: 'timed out' };
    const item = str(this.args.item, 'item');
    const [x, y, z] = this.target;
    const world = this.game.world;
    if (!blockOf(world.getBlock(x, y, z)).replaceable) return { fail: 'position is occupied' };
    if (!this.agent.equip(item)) return { fail: `no ${item} in inventory` };
    const r = this.nav.step();
    if (r === 'fail') return { fail: 'cannot reach position' };
    if (!r) return 'running';
    // Standing inside the target? step away first
    const b = this.player.body;
    if (Math.floor(b.x) === x && Math.floor(b.z) === z && (Math.floor(b.y) === y || Math.floor(b.y) + 1 === y)) {
      this.agent.input.forward = -1;
      return 'running';
    }
    // Find a neighbour face to place against
    for (let f = 0; f < 6; f++) {
      const d = FACE_DIRS[f];
      const nx = x - d[0], ny = y - d[1], nz = z - d[2];
      if (!blockOf(world.getBlock(nx, ny, nz)).solid) continue;
      this.agent.lookAt(x + 0.5, y + 0.5, z + 0.5);
      const ok = this.player.useOnBlock(nx, ny, nz, f, 0.5, 0.5, 0.5, true);
      return ok ? 'done' : { fail: 'placement rejected' };
    }
    return { fail: 'nothing to place against' };
  }
}

/** Craft an item using recipes. Uses a nearby crafting table for 3x3 recipes (placing one if carried). */
class CraftSkill extends Skill {
  crafted = 0;
  prepCrafts = 0;
  tableNav: Navigator | null = null;
  tick(): SkillResult {
    if (++this.ticks > 20 * 60) return { fail: 'timed out' };
    const name = str(this.args.item, 'item');
    const count = this.args.count !== undefined ? num(this.args.count, 'count') : 1;
    const recipes = RECIPES.filter((r) => r.result.item === name);
    if (!recipes.length) {
      const guess = [name.replace(/s$/, ''), `${name}s`, name.replace(/es$/, '')].find((n) => n !== name && RECIPES.some((r) => r.result.item === n));
      return { fail: `no recipe for ${name}${guess ? ` (did you mean ${guess}?)` : ''}` };
    }
    const inv = this.player.inventory;
    // Choose the first recipe we have ingredients for
    const recipe = recipes.find((r) => this.agent.canAfford(r));
    if (!recipe) {
      // Make missing intermediate ingredients (planks from logs, sticks from planks) one craft per tick, then retry.
      if (this.prepCrafts < 32 && recipes.some((r) => this.agent.missing(r).some(([ing]) => this.craftToward(ing, 2)))) {
        this.prepCrafts++;
        return 'running';
      }
      const short = this.agent.missing(recipes[0]).map(([ing, need, have]) => `${need}x ${ing} (have ${have})`).join(', ');
      return { fail: `missing ingredients for ${name}: needs ${describeRecipe(recipes[0])}; short of ${short}` };
    }
    const needsTable = isTableRecipe(recipe);
    if (needsTable) {
      const table = this.agent.findNearestBlock((id) => id === BLOCKS_BY_NAME.get('crafting_table')!.id, 12);
      if (!table) {
        if (countItem(inv, itemId('crafting_table')) > 0) {
          const spot = this.agent.findPlaceSpot();
          if (!spot) return { fail: 'no space to place a crafting table' };
          this.agent.equip('crafting_table');
          const [sx, sy, sz] = spot;
          this.player.useOnBlock(sx, sy - 1, sz, 2, 0.5, 1, 0.5, true);
          return 'running';
        }
        return { fail: 'needs a crafting table (craft one from 4 planks)' };
      }
      if (!this.tableNav) this.tableNav = new Navigator(this.agent, { x: table[0], y: table[1], z: table[2] }, 3.5);
      const r = this.tableNav.step();
      if (r === 'fail') return { fail: 'cannot reach crafting table' };
      if (!r) return 'running';
      this.agent.lookAt(table[0] + 0.5, table[1] + 0.5, table[2] + 0.5);
    }
    this.craftOnce(recipe);
    this.crafted += recipe.result.count;
    return this.crafted >= count ? 'done' : 'running';
  }

  private craftOnce(recipe: Recipe) {
    this.agent.consumeRecipe(recipe);
    this.player.giveOrDrop({ id: itemId(recipe.result.item), count: recipe.result.count });
    this.game.onCrafted(this.player, { id: itemId(recipe.result.item), count: recipe.result.count });
    this.game.broadcastNear(this.player, { t: 'anim', id: this.player.id, a: 'swing' });
  }

  /** Craft one step toward an ingredient (item or #tag) using only 2x2 recipes, recursing into their inputs. */
  private craftToward(ing: string, depth: number): boolean {
    const names = ing.startsWith('#') ? TAGS[ing.slice(1)] ?? [] : [ing];
    for (const r of RECIPES) {
      if (!names.includes(r.result.item) || isTableRecipe(r)) continue;
      if (this.agent.canAfford(r)) {
        this.craftOnce(r);
        return true;
      }
      if (depth > 0 && this.agent.missing(r).some(([sub]) => this.craftToward(sub, depth - 1))) return true;
    }
    return false;
  }
}

const isTableRecipe = (r: Recipe) => r.kind === 'shaped' && (r.pattern.length > 2 || r.pattern.some((row) => row.length > 2));

class SmeltSkill extends Skill {
  nav: Navigator | null = null;
  furnacePos: [number, number, number] | null = null;
  loaded = false;
  startOut = 0;
  tick(): SkillResult {
    if (++this.ticks > 20 * 240) return { fail: 'timed out' };
    const input = str(this.args.item, 'item');
    const count = this.args.count !== undefined ? num(this.args.count, 'count') : 1;
    const outName = SMELTING[input];
    if (!outName) return { fail: `${input} cannot be smelted` };
    const inv = this.player.inventory;
    if (!this.furnacePos) {
      const f = this.agent.findNearestBlock((id) => id === BLOCKS_BY_NAME.get('furnace')!.id || id === BLOCKS_BY_NAME.get('lit_furnace')!.id, 12);
      if (!f) {
        if (countItem(inv, itemId('furnace')) > 0) {
          const spot = this.agent.findPlaceSpot();
          if (!spot) return { fail: 'no space for a furnace' };
          this.agent.equip('furnace');
          this.player.useOnBlock(spot[0], spot[1] - 1, spot[2], 2, 0.5, 1, 0.5, true);
          return 'running';
        }
        return { fail: 'needs a furnace (craft one from 8 cobblestone)' };
      }
      this.furnacePos = f;
      this.nav = new Navigator(this.agent, { x: f[0], y: f[1], z: f[2] }, 3.5);
    }
    const r = this.nav!.step();
    if (r === 'fail') return { fail: 'cannot reach furnace' };
    if (!r) return 'running';
    const fs = this.game.getBlockEntity(this.furnacePos, 'furnace') as FurnaceState;
    const inId = itemId(input), outId = itemId(outName);
    if (!this.loaded) {
      const have = countItem(inv, inId);
      if (have <= 0) return { fail: `no ${input} in inventory` };
      const n = Math.min(have, count);
      if (fs.input && fs.input.id !== inId) return { fail: 'furnace is busy' };
      removeItem(inv, inId, n);
      fs.input = { id: inId, count: (fs.input?.count ?? 0) + n };
      // fuel: prefer coal/charcoal, then planks/logs/sticks
      const fuelPref = ['coal', 'charcoal', 'coal_block', 'oak_planks', 'birch_planks', 'spruce_planks', 'oak_log', 'birch_log', 'spruce_log', 'stick'];
      let needBurn = n * 200 - (fs.burn ?? 0);
      for (const fname of fuelPref) {
        if (needBurn <= 0) break;
        const fid = itemId(fname);
        const fh = countItem(inv, fid);
        if (!fh) continue;
        if (fs.fuel && fs.fuel.id !== fid) continue;
        const per = fuelValue(fid);
        const use = Math.min(fh, Math.ceil(needBurn / per));
        removeItem(inv, fid, use);
        fs.fuel = { id: fid, count: (fs.fuel?.count ?? 0) + use };
        needBurn -= use * per;
      }
      if (!fs.fuel && fs.burn <= 0) return { fail: 'no fuel (coal, planks or logs)' };
      this.player.sendInventory();
      this.game.containerChanged(this.furnacePos);
      this.loaded = true;
      this.startOut = fs.output?.id === outId ? fs.output.count : 0;
      return 'running';
    }
    // Wait for output
    const out = fs.output && fs.output.id === outId ? fs.output.count : 0;
    if (out - this.startOut >= count || (!fs.input && out > 0)) {
      if (fs.output) this.player.giveOrDrop(fs.output);
      fs.output = null;
      this.game.containerChanged(this.furnacePos);
      return 'done';
    }
    if (!fs.input && out === 0 && this.ticks > 40) return { fail: 'smelting stopped (out of fuel?)' };
    return 'running';
  }
}

class AttackSkill extends Skill {
  cooldown = 0;
  tick(): SkillResult {
    if (++this.ticks > 20 * 60) return { fail: 'timed out' };
    let target: Entity | undefined;
    if (this.args.id !== undefined) target = this.game.entities.get(num(this.args.id, 'id'));
    else if (this.args.kind) {
      const kind = str(this.args.kind, 'kind');
      let best: Entity | undefined, bd = 32;
      for (const e of this.game.entities.values()) {
        if (e.kind !== kind || e.removed || e === this.player) continue;
        const d = e.distanceTo(this.player);
        if (d < bd) { bd = d; best = e; }
      }
      target = best;
      if (target) this.args.id = target.id;
    }
    if (!target || target.removed || target.health <= 0) return this.ticks > 1 ? 'done' : { fail: 'target not found' };
    this.agent.equipBestWeapon();
    const d = target.distanceTo(this.player);
    this.agent.lookAt(target.x, target.y + target.body.height * 0.7, target.z);
    if (d > 2.8) {
      const nav = new Navigator(this.agent, { x: Math.floor(target.x), y: Math.floor(target.y), z: Math.floor(target.z) }, 2);
      nav.step();
      if (d < 6) {
        this.agent.input.forward = 1;
        this.agent.input.jump = this.player.body.horizontalCollision;
      }
    } else {
      this.agent.input.forward = 0;
      if (this.cooldown-- <= 0) {
        this.player.attack(target.id);
        this.game.broadcastNear(this.player, { t: 'anim', id: this.player.id, a: 'swing' });
        this.cooldown = 10;
      }
    }
    return 'running';
  }
}

class FollowSkill extends Skill {
  nav: Navigator | null = null;
  tick(): SkillResult {
    const name = str(this.args.player, 'player');
    const dist = this.args.distance !== undefined ? num(this.args.distance, 'distance') : 3;
    const duration = this.args.seconds !== undefined ? num(this.args.seconds, 'seconds') * 20 : 20 * 60;
    if (++this.ticks > duration) return 'done';
    const t = this.game.getPlayer(name);
    if (!t) return { fail: `player ${name} not found` };
    const d = t.distanceTo(this.player);
    if (d <= dist) {
      this.agent.input.forward = 0;
      this.agent.lookAt(t.x, t.y + t.eyeHeight, t.z);
      this.nav = null;
      return 'running';
    }
    if (!this.nav || this.ticks % 20 === 0) this.nav = new Navigator(this.agent, { x: Math.floor(t.x), y: Math.floor(t.y), z: Math.floor(t.z) }, dist);
    const r = this.nav.step();
    if (r === 'fail') {
      this.nav = null;
      this.agent.input.forward = 0;
    }
    return 'running';
  }
}

class GiveSkill extends Skill {
  nav: Navigator | null = null;
  tick(): SkillResult {
    if (++this.ticks > 20 * 90) return { fail: 'timed out' };
    const name = str(this.args.player, 'player');
    const item = str(this.args.item, 'item');
    const count = this.args.count !== undefined ? num(this.args.count, 'count') : 1;
    const t = this.game.getPlayer(name);
    if (!t) return { fail: `player ${name} not found` };
    const it = ITEMS_BY_NAME.get(item);
    if (!it) return { fail: `unknown item ${item}` };
    if (countItem(this.player.inventory, it.id) < count) return { fail: `not enough ${item}` };
    if (t.distanceTo(this.player) > 3) {
      if (!this.nav || this.ticks % 20 === 0) this.nav = new Navigator(this.agent, { x: Math.floor(t.x), y: Math.floor(t.y), z: Math.floor(t.z) }, 2.5);
      if (this.nav.step() === 'fail') return { fail: 'cannot reach player' };
      return 'running';
    }
    this.agent.input.forward = 0;
    this.agent.lookAt(t.x, t.y + 1, t.z);
    removeItem(this.player.inventory, it.id, count);
    this.player.sendInventory();
    const e = new ItemEntity(this.game, this.player.x, this.player.y + 1.3, this.player.z, { id: it.id, count });
    const dx = t.x - this.player.x, dz = t.z - this.player.z, dl = Math.hypot(dx, dz) || 1;
    e.body.vx = (dx / dl) * 0.25;
    e.body.vz = (dz / dl) * 0.25;
    e.body.vy = 0.2;
    e.pickupDelay = 10;
    this.game.addEntity(e);
    return 'done';
  }
}

class ChatSkill extends Skill {
  tick(): SkillResult {
    const msg = str(this.args.message, 'message').slice(0, 256);
    this.game.handleChat(this.player, msg);
    return 'done';
  }
}

class EatSkill extends Skill {
  tick(): SkillResult {
    const item = this.args.item ? str(this.args.item, 'item') : null;
    const inv = this.player.inventory;
    const idx = inv.findIndex((s) => s && itemDef(s.id).food && (!item || itemDef(s.id).name === item));
    if (idx < 0) return { fail: 'no food' };
    this.agent.equip(itemDef(inv[idx]!.id).name);
    if (++this.ticks < 32) return 'running';
    return this.player.eat() ? 'done' : { fail: 'not hungry' };
  }
}

class EquipSkill extends Skill {
  tick(): SkillResult {
    return this.agent.equip(str(this.args.item, 'item')) ? 'done' : { fail: 'item not in inventory' };
  }
}

class DropSkill extends Skill {
  tick(): SkillResult {
    const item = str(this.args.item, 'item');
    const it = ITEMS_BY_NAME.get(item);
    if (!it) return { fail: 'unknown item' };
    const count = this.args.count !== undefined ? num(this.args.count, 'count') : countItem(this.player.inventory, it.id);
    const n = removeItem(this.player.inventory, it.id, count);
    if (!n) return { fail: 'not in inventory' };
    this.player.sendInventory();
    this.player.dropStack({ id: it.id, count: n });
    return 'done';
  }
}

class LookSkill extends Skill {
  tick(): SkillResult {
    this.agent.lookAt(num(this.args.x, 'x'), num(this.args.y, 'y'), num(this.args.z, 'z'));
    return 'done';
  }
}

class WaitSkill extends Skill {
  tick(): SkillResult {
    const t = this.args.seconds !== undefined ? num(this.args.seconds, 'seconds') * 20 : 20;
    return ++this.ticks >= t ? 'done' : 'running';
  }
}

/** Wander in a direction (or randomly) to explore new terrain. */
class ExploreSkill extends Skill {
  nav: Navigator | null = null;
  tick(): SkillResult {
    const dist = this.args.distance !== undefined ? num(this.args.distance, 'distance') : 32;
    if (++this.ticks > 20 * 90) return 'done';
    if (!this.nav) {
      const ang = this.args.direction !== undefined ? ({ north: Math.PI, south: 0, east: Math.PI / 2, west: -Math.PI / 2 } as Record<string, number>)[String(this.args.direction)] ?? Math.random() * 6.28 : Math.random() * 6.28;
      // Aim as far as asked, or closer if that far is not loaded yet
      for (const f of [1, 0.75, 0.5]) {
        const tx = Math.floor(this.player.x + Math.sin(ang) * dist * f), tz = Math.floor(this.player.z + Math.cos(ang) * dist * f);
        const ty = this.game.world.getHeight(tx, tz) + 1;
        if (ty > 0) {
          this.nav = new Navigator(this.agent, { x: tx, y: ty, z: tz }, 3);
          break;
        }
      }
      if (!this.nav) return { fail: 'the area in that direction is not loaded yet' };
    }
    const r = this.nav.step();
    if (r === 'fail') return { fail: 'could not find a way' };
    return r ? 'done' : 'running';
  }
}

class SleepSkill extends Skill {
  tick(): SkillResult {
    const bedId = BLOCKS_BY_NAME.get('bed')!.id;
    const bed = this.agent.findNearestBlock((id) => id === bedId, 8);
    if (!bed) return { fail: 'no bed nearby' };
    this.game.trySleep(this.player, bed);
    return 'done';
  }
}

// ---------------------------------------------------------------------------------------------
// Building (best in creative mode: unlimited blocks, instant clearing)
// ---------------------------------------------------------------------------------------------

/** Take items from the creative inventory. */
class GetItemSkill extends Skill {
  tick(): SkillResult {
    const item = str(this.args.item, 'item');
    const count = this.args.count !== undefined ? Math.max(1, Math.min(64 * 9, Math.floor(num(this.args.count, 'count')))) : 64;
    if (this.player.gamemode !== 'creative') return { fail: 'get_item only works in creative mode' };
    if (!ITEMS_BY_NAME.has(item)) return { fail: `unknown item ${item}` };
    const max = itemDef(itemId(item)).stackSize || 64;
    for (let left = count; left > 0; left -= max) this.player.giveOrDrop({ id: itemId(item), count: Math.min(max, left) });
    this.player.sendInventory();
    return 'done';
  }
}

interface BuildTarget {
  x: number;
  y: number;
  z: number;
  block: string;
  tries: number;
  /** Horizontal direction to face while placing (doors take their orientation from it). */
  facing?: [number, number];
  /** The tree this block belongs to, once looked up: felled whole from its base. */
  tree?: { blocks: Pos[]; base: Pos } | null;
}

const MAX_BUILD_BLOCKS = 2000;
/** Building speed multiplier (MC_BUILD_SPEED): 1 is about 10 blocks per second; raise it to make tests faster. */
const BUILD_SPEED = Math.max(0.25, Math.min(20, Number(process.env.MC_BUILD_SPEED ?? 1) || 1));
const NON_GROUND = /leaves|_log$|grass$|fern|flower|dandelion|poppy|tulip|orchid|allium|bluet|daisy|bush|sapling|snow$/;

/** The y of the highest ground block (ignoring trees and plants) in a column, searching around y0. */
function groundY(agent: Agent, x: number, z: number, y0: number): number {
  const w = agent.game.world;
  for (let y = Math.min(255, y0 + 12); y > Math.max(1, y0 - 24); y--) {
    const def = blockOf(w.getBlock(x, y, z));
    if (def.solid && !NON_GROUND.test(def.name)) return y;
  }
  return y0 - 1;
}

interface Surface { y: number; block: string; liquid: boolean; trees: number }

/** The top of a column as a builder sees it: liquid, or the first solid non-plant block, plus tree blocks above it. */
function surfaceAt(agent: Agent, x: number, z: number, yHint: number): Surface | null {
  const w = agent.game.world;
  if (!w.isLoaded(x, z)) return null;
  let trees = 0;
  for (let y = Math.min(255, yHint + 32); y > Math.max(1, yHint - 48); y--) {
    const s = w.getBlock(x, y, z);
    if ((s & 0xff) === 0) continue;
    const def = blockOf(s);
    if (def.fluid) return { y, block: def.name, liquid: true, trees };
    if (/leaves|_log$/.test(def.name)) trees++;
    if (def.solid && !NON_GROUND.test(def.name)) return { y, block: def.name, liquid: false, trees };
  }
  return null;
}

const NATURAL_GROUND = /^(grass_block|dirt|coarse_dirt|podzol|sand|red_sand|gravel|stone|snow_block|clay|mycelium)$/;

/** Blocks that occur in the wild. Preparing a site may remove these, but never anything built. */
const NATURAL = /^(stone|grass_block|dirt|bedrock|water|lava|sand|red_sand|gravel|sandstone|snow_block|snow|ice|clay|terracotta|granite|diorite|andesite|moss_block|mossy_cobblestone|cactus|sugar_cane|dead_bush|short_grass|fern|dandelion|poppy|cornflower|red_mushroom|brown_mushroom|pumpkin|melon)$|_ore$|_log$|_leaves$|_sapling$/;
const isLog = (name: string) => name.endsWith('_log');
const isLeaves = (name: string) => name.endsWith('_leaves');

type Pos = [number, number, number];

/**
 * The whole tree around a log or leaf block (tree felling): its connected logs and the leaves around them, plus the
 * lowest log, which is where the agent stands to fell it. Null for leaves that belong to no tree.
 */
function treeAt(agent: Agent, x: number, y: number, z: number): { blocks: Pos[]; base: Pos } | null {
  const w = agent.game.world;
  const name = (p: Pos) => BLOCKS[w.getBlock(p[0], p[1], p[2]) & 0xff].name;
  const k = (p: Pos) => `${p[0]},${p[1]},${p[2]}`;
  let start: Pos | null = isLog(name([x, y, z])) ? [x, y, z] : null;
  if (!start && isLeaves(name([x, y, z]))) {
    // Leaves are at most a few blocks from their trunk: search through them for a log
    const seen = new Set([k([x, y, z])]);
    let frontier: Pos[] = [[x, y, z]];
    for (let depth = 0; depth < 6 && frontier.length && !start; depth++) {
      const next: Pos[] = [];
      for (const p of frontier)
        for (const d of FACE_DIRS) {
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
  if (!start) return null;
  const logs: Pos[] = [start];
  const seen = new Set([k(start)]);
  for (let i = 0; i < logs.length && logs.length < 300; i++)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const q: Pos = [logs[i][0] + dx, logs[i][1] + dy, logs[i][2] + dz];
          if (seen.has(k(q)) || Math.abs(q[0] - start[0]) > 8 || Math.abs(q[2] - start[2]) > 8) continue;
          seen.add(k(q));
          if (isLog(name(q))) logs.push(q);
        }
  const leaves: Pos[] = [];
  let frontier = logs;
  for (let depth = 0; depth < 6 && frontier.length && leaves.length < 2000; depth++) {
    const next: Pos[] = [];
    for (const p of frontier)
      for (const d of FACE_DIRS) {
        const q: Pos = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
        if (seen.has(k(q))) continue;
        seen.add(k(q));
        if (isLeaves(name(q))) next.push(q);
      }
    leaves.push(...next);
    frontier = next;
  }
  const base = logs.reduce((a, b) => (b[1] < a[1] ? b : a));
  return { blocks: [...logs, ...leaves], base };
}

/** Find a dry, flat, open area for a structure and report its centre. */
class FindSiteSkill extends Skill {
  private cache = new Map<string, Surface | null>();

  tick(): SkillResult {
    const size = Math.max(3, Math.min(40, Math.floor(this.args.size !== undefined ? num(this.args.size, 'size') : 9)));
    const r = this.search(size);
    // Nothing that big: say what does fit, so the planner can scale the project instead of searching in circles
    if (typeof r === 'object' && 'fail' in r && size > 9)
      for (let s = size - 4; s >= Math.max(9, Math.floor(size / 2)); s -= 4) {
        const alt = this.search(s);
        if (typeof alt === 'object' && 'done' in alt)
          return { fail: `${r.fail.split(';')[0]}. The largest nearby is smaller: ${alt.done.replace(/^site found: /, '')} It is saved as the last site, so prepare_site defaults to it; plan the project to fit, or explore further` };
      }
    return r;
  }

  private search(size: number): SkillResult {
    // Searching a small radius mostly finds nothing; 32 blocks is the least worth a search
    const radius = Math.max(32, Math.min(64, Math.floor(this.args.radius !== undefined ? num(this.args.radius, 'radius') : 48)));
    const maxSlope = this.args.max_slope !== undefined ? num(this.args.max_slope, 'max_slope') : 2;
    const p = this.player;
    const ox = this.args.x !== undefined ? Math.floor(num(this.args.x, 'x')) : Math.floor(p.x);
    const oz = this.args.z !== undefined ? Math.floor(num(this.args.z, 'z')) : Math.floor(p.z);
    const cache = this.cache;
    const col = (x: number, z: number) => {
      const k = `${x},${z}`;
      if (!cache.has(k)) cache.set(k, surfaceAt(this.agent, x, z, Math.floor(p.y)));
      return cache.get(k)!;
    };
    const half = Math.floor(size / 2);
    // In a village, stay off buildings (with a walkway around them) and ground other agents have reserved
    const v = this.agent.village();
    const now = Date.now();
    const taken: Area[] = v
      ? [...v.structures.map((st) => ({ x1: st.x1 - 2, z1: st.z1 - 2, x2: st.x2 + 2, z2: st.z2 + 2 })), ...v.reservations.filter((r) => r.by !== p.name && r.until > now)]
      : [];
    let best: { x: number; z: number; y: number; range: number; trees: number; score: number } | null = null;
    let wet = 0, unloaded = 0, steep = 0, occupied = 0;
    for (let cx = ox - radius; cx <= ox + radius; cx += 2)
      next: for (let cz = oz - radius; cz <= oz + radius; cz += 2) {
        const dist = Math.hypot(cx - ox, cz - oz);
        if (dist > radius) continue;
        const fp = { x1: cx - half, z1: cz - half, x2: cx - half + size - 1, z2: cz - half + size - 1 };
        if (taken.some((t) => overlaps(fp, t))) {
          occupied++;
          continue;
        }
        let lo = 256, hi = 0, trees = 0, built = 0;
        const ys: number[] = [];
        for (let x = cx - half; x < cx - half + size; x++)
          for (let z = cz - half; z < cz - half + size; z++) {
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
        // Level ground matters most, then staying off existing builds, then fewer trees, then distance
        const score = (hi - lo) * 6 + built * 3 + trees * 0.3 + dist * 0.1;
        if (!best || score < best.score) {
          ys.sort((a, b) => a - b);
          best = { x: cx, z: cz, y: ys[ys.length >> 1], range: hi - lo, trees, score };
        }
      }
    if (!best) {
      const why = [wet && `${wet} over water`, steep && `${steep} too steep`, occupied && `${occupied} taken by buildings or other agents`, unloaded && `${unloaded} not loaded yet`].filter(Boolean).join(', ');
      return { fail: `no dry, flat ${size}x${size} site within ${radius} blocks (candidates rejected: ${why}); explore in another direction and try again, or use a smaller size or larger max_slope` };
    }
    this.agent.memory.lastSite = { x: best.x, y: best.y, z: best.z, size };
    const b = best;
    if (v && this.agent.memory.villageRole === 'mayor') this.agent.manager.villages.note(v, `${p.name} found a ${size}x${size} site centred at x=${b.x} z=${b.z} (ground y=${b.y})`);
    const onPlot = ((v ? v.plots : (this.agent.memory.plots as Plot[] | undefined)) ?? []).some(
      (q) => q.y === b.y && b.x - half >= q.x1 && b.x - half + size - 1 <= q.x2 && b.z - half >= q.z1 && b.z - half + size - 1 <= q.z2);
    const ready = onPlot && b.range === 0 && b.trees === 0 ? ' It is on a prepared plot and already level and clear: build there directly, no prepare_site needed.' : '';
    return { done: `site found: centre x=${b.x} z=${b.z}, ground y=${b.y}, ${size}x${size}, height range ${b.range}, ${b.trees} tree blocks to clear, ${Math.round(Math.hypot(b.x - ox, b.z - oz))} blocks away.${ready}` };
  }
}

/** The block an item places, or null. */
function placesBlock(item: string): string | null {
  const it = ITEMS_BY_NAME.get(item);
  if (!it) return null;
  const place = it.places ?? it.block?.name ?? null;
  return place && BLOCKS_BY_NAME.has(place) ? place : null;
}

function blockItem(name: string, what: string): string {
  if (!placesBlock(name)) throw new Error(`${what} '${name}' is not a placeable block (try oak_planks, cobblestone, stone_bricks, glass)`);
  return name;
}

/**
 * Places (or clears, block 'air') a list of blocks, walking to each: clearing top-down first, then placing
 * bottom-up, nearest-first within a layer. Targets that keep failing are skipped and reported in the result.
 */
abstract class BuildJob extends Skill {
  targets: BuildTarget[] = [];
  maxBlocks = MAX_BUILD_BLOCKS;
  placed = 0;
  cleared = 0;
  felled = 0;
  skipped = new Map<string, number>();
  nav: Navigator | null = null;
  navFor: BuildTarget | null = null;
  navStart = 0;
  budget = 0;
  walking = false;
  aside: Navigator | null = null;
  started = false;

  /** Computed when the skill starts, since the world can change while it waits in the queue. */
  abstract plan(): BuildTarget[];

  /** Ground this job works on, set by plan(): checked against the village and reserved while the job runs. */
  claim: { area: Area; purpose: string; avoidStructures: boolean } | null = null;
  village?: Village;
  reservation?: Reservation;

  /** Called once when the job succeeds, to record what it made; returns text to prepend to the result. */
  protected finished(): string {
    return '';
  }

  tick(): SkillResult {
    const r = this.run();
    if (r === 'running') {
      if (this.reservation && this.ticks % 200 === 0) this.agent.manager.villages.renew(this.reservation);
      return r;
    }
    this.release();
    if (r !== 'done' && 'done' in r) {
      const extra = this.finished();
      return extra ? { done: `${extra}; ${r.done}` } : r;
    }
    return r;
  }

  cancel() {
    this.release();
  }

  private release() {
    if (this.reservation && this.village) this.agent.manager.villages.release(this.village, this.reservation.id);
    this.reservation = undefined;
  }

  private remove(t: BuildTarget) {
    this.targets.splice(this.targets.indexOf(t), 1);
    if (this.navFor === t) this.navFor = null;
  }

  private skip(t: BuildTarget, reason: string) {
    this.remove(t);
    this.skipped.set(reason, (this.skipped.get(reason) ?? 0) + 1);
  }

  private next(): BuildTarget | undefined {
    // Stay with the target being walked to: re-picking the nearest each step makes the agent flip between two targets
    if (this.navFor && this.targets.includes(this.navFor)) return this.navFor;
    const p = this.player;
    const eye = p.y + p.eyeHeight;
    const clearing = this.targets.some((t) => t.block === 'air');
    let best: BuildTarget | undefined;
    let bestScore = Infinity;
    for (const t of this.targets) {
      if (clearing && t.block !== 'air') continue; // clear everything before placing anything
      // Do everything within arm's reach before walking: top-down when clearing (so nothing is left hanging),
      // bottom-up when placing (so blocks have support). Out of reach, walk to the nearest.
      const d = Math.hypot(t.x + 0.5 - p.x, t.y + 0.5 - eye, t.z + 0.5 - p.z);
      const score = t.tries * 8 + (d <= REACH_DISTANCE ? (clearing ? -t.y : t.y) : 1000 + d + (clearing ? 0 : t.y));
      if (score < bestScore) (best = t), (bestScore = score);
    }
    return best;
  }

  protected summary(): string {
    const skipped = [...this.skipped].map(([why, n]) => `${n} ${why}`).join(', ');
    return `placed ${this.placed} blocks, cleared ${this.cleared}${this.felled ? ` (${this.felled} trees felled)` : ''}${skipped ? `; skipped ${skipped}` : ''}`;
  }

  /** Walk to a free spot a couple of blocks away that is not part of the build. */
  private stepAside() {
    const b = this.player.body;
    const bx = Math.floor(b.x), by = Math.floor(b.y + 0.01), bz = Math.floor(b.z);
    const pending = new Set(this.targets.map((t) => `${t.x},${t.z}`));
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2], [3, 0], [0, 3], [-3, 0], [0, -3]])
      for (const dy of [0, 1, -1]) {
        const x = bx + dx, y = by + dy, z = bz + dz;
        if (!pending.has(`${x},${z}`) && standable(this.game.world, x, y, z)) {
          this.aside = new Navigator(this.agent, { x, y, z }, 0.4);
          return;
        }
      }
    this.agent.input.forward = -1;
  }

  private run(): SkillResult {
    if (++this.ticks > 20 * 600) return { fail: `timed out: ${this.summary()}` };
    if (!this.started) {
      this.started = true;
      this.targets = this.plan();
      if (this.targets.length > this.maxBlocks) return { fail: `too big (${this.targets.length} blocks, max ${this.maxBlocks})` };
      this.village = this.agent.village();
      if (this.claim && this.village) {
        const reg = this.agent.manager.villages;
        const why = reg.conflict(this.village, this.claim.area, this.player.name, this.claim.avoidStructures);
        if (why) return { fail: `cannot work at ${areaText(this.claim.area)}: ${why}; pick another spot (find_site avoids taken ground)` };
        this.reservation = reg.reserve(this.village, this.claim.area, this.player.name, this.claim.purpose);
      }
    }
    if (this.aside) {
      const r = this.aside.step();
      if (r === false && this.ticks % 200 !== 0) return 'running';
      this.aside = null;
    }
    // Pace the work: `speed` operations (a block placed, a block or tree cleared) per 2 ticks
    const speed = Math.max(0.25, Math.min(20, Number(this.agent.memory.buildSpeed) || BUILD_SPEED)); // per-agent override
    this.budget = Math.min(this.budget + speed / 2, speed + 1);
    while (this.budget >= 1) {
      this.budget--;
      this.walking = false;
      const r = this.work();
      if (r !== 'running' || this.walking) return r;
    }
    return 'running';
  }

  /** One unit of work: skip finished targets, then walk toward, clear or place the next one. */
  private work(): SkillResult {
    const world = this.game.world;
    const creative = this.player.gamemode === 'creative';
    for (let guard = 0; guard < 64; guard++) {
      const t = this.next();
      if (!t) return { done: this.summary() };
      const cur = world.getBlock(t.x, t.y, t.z);
      const curDef = blockOf(cur);
      const want = t.block === 'air' ? null : BLOCKS_BY_NAME.get(placesBlock(t.block)!)!;
      // Already right? Doors and stairs carry orientation in the state, so compare block ids.
      if (want ? (cur & 0xff) === want.id : (cur & 0xff) === 0 || curDef.fluid) {
        this.remove(t);
        continue;
      }
      // Trees in the way are felled whole from their base, so canopy out of reach is never left behind
      const clearing = (cur & 0xff) !== 0 && (!want || !curDef.replaceable);
      if (clearing && creative && (isLog(curDef.name) || isLeaves(curDef.name)) && t.tree === undefined) t.tree = treeAt(this.agent, t.x, t.y, t.z);
      const tree = clearing && creative ? t.tree : null;
      const [gx, gy, gz] = tree ? tree.base : [t.x, t.y, t.z];
      // Walk only when out of arm's reach, and not for long: chasing an unreachable block (tree tops, cliffs)
      // along partial paths would otherwise drag the agent away from the site.
      const eye = this.player.y + this.player.eyeHeight;
      if (Math.hypot(gx + 0.5 - this.player.x, gy + 0.5 - eye, gz + 0.5 - this.player.z) > REACH_DISTANCE) {
        if (this.navFor !== t) {
          this.nav = new Navigator(this.agent, { x: gx, y: gy, z: gz }, 4);
          this.navFor = t;
          this.navStart = this.ticks;
        }
        const r = this.nav!.step();
        this.walking = true;
        if (r === 'fail' || (r === false && this.ticks - this.navStart > 200)) {
          this.navFor = null;
          this.agent.input.forward = 0;
          if (++t.tries >= 2) this.skip(t, 'unreachable');
          return 'running';
        }
        if (!r) return 'running';
      }
      this.agent.input.forward = 0;
      if (tree) {
        for (const [x, y, z] of tree.blocks) {
          const n = BLOCKS[world.getBlock(x, y, z) & 0xff].name;
          if ((isLog(n) || isLeaves(n)) && this.player.breakBlock(x, y, z)) this.cleared++;
        }
        this.felled++;
        t.tree = undefined;
        return 'running';
      }
      // Clear whatever is in the way; plants are replaceable, so placement simply overwrites them.
      if (clearing) {
        if (!creative) {
          this.skip(t, 'occupied (clearing needs creative mode)');
          return 'running';
        }
        this.player.breakBlock(t.x, t.y, t.z);
        this.cleared++;
        return 'running';
      }
      if (!want) {
        this.remove(t);
        continue;
      }
      if (countItem(this.player.inventory, itemId(t.block)) === 0) {
        if (!creative) return { fail: `ran out of ${t.block}: ${this.summary()}` };
        this.player.giveOrDrop({ id: itemId(t.block), count: 64 });
      }
      this.agent.equip(t.block);
      const b = this.player.body;
      const by = Math.floor(b.y + 0.01);
      const half = PLAYER_WIDTH / 2;
      if (b.x + half > t.x && b.x - half < t.x + 1 && b.z + half > t.z && b.z - half < t.z + 1 && t.y >= by - 1 && t.y <= by + 1) {
        if (++t.tries >= 6) this.skip(t, 'blocked by the agent');
        else this.stepAside();
        this.walking = true;
        return 'running';
      }
      const face = [2, 0, 1, 4, 5, 3].find((f) => { // prefer placing on top of the block below
        const d = FACE_DIRS[f];
        return blockOf(world.getBlock(t.x - d[0], t.y - d[1], t.z - d[2])).solid;
      });
      if (face === undefined) {
        // Creative builders place floating blocks (roof overhangs, lintels) directly, as a player would by bridging
        if (creative && want.shape !== 'door') {
          this.game.setBlockBy(this.player, t.x, t.y, t.z, want.id);
          this.placed++;
          this.remove(t);
          return 'running';
        }
        if (++t.tries >= 6) this.skip(t, 'with nothing to place against');
        return 'running';
      }
      const d = FACE_DIRS[face];
      if (t.facing) this.agent.lookAt(b.x + t.facing[0] * 16, b.y + PLAYER_EYE_HEIGHT, b.z + t.facing[1] * 16);
      else this.agent.lookAt(t.x + 0.5, t.y + 0.5, t.z + 0.5);
      if (this.player.useOnBlock(t.x - d[0], t.y - d[1], t.z - d[2], face, 0.5, 0.5, 0.5, true)) {
        this.placed++;
        this.remove(t);
      } else if (++t.tries >= 4) this.skip(t, 'rejected (something in the way)');
      return 'running';
    }
    return 'running';
  }
}

/** Fill a box with a block (optionally hollow, with the inside cleared), or clear it with block 'air'. */
class BuildBoxSkill extends BuildJob {
  built: (Area & { y: number; kind: string }) | null = null;

  protected finished(): string {
    return this.placed ? recordStructure(this.agent, this.built) : '';
  }

  plan(): BuildTarget[] {
    const block = str(this.args.block, 'block');
    if (block !== 'air') blockItem(block, 'block');
    const c = (k: string) => Math.floor(num(this.args[k], k));
    const [x1, x2] = [Math.min(c('x1'), c('x2')), Math.max(c('x1'), c('x2'))];
    const [y1, y2] = [Math.min(c('y1'), c('y2')), Math.max(c('y1'), c('y2'))];
    const [z1, z2] = [Math.min(c('z1'), c('z2')), Math.max(c('z1'), c('z2'))];
    if ((x2 - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1) > MAX_BUILD_BLOCKS) throw new Error(`box too big (max ${MAX_BUILD_BLOCKS} blocks)`);
    const hollow = !!this.args.hollow;
    this.claim = { area: { x1, z1, x2, z2 }, purpose: `build_box ${block}`, avoidStructures: false };
    if (block !== 'air') this.built = { x1, z1, x2, z2, y: y1, kind: typeof this.args.label === 'string' && this.args.label ? this.args.label : `${block} box` };
    const out: BuildTarget[] = [];
    for (let x = x1; x <= x2; x++)
      for (let y = y1; y <= y2; y++)
        for (let z = z1; z <= z2; z++) {
          const shell = x === x1 || x === x2 || y === y1 || y === y2 || z === z1 || z === z2;
          out.push({ x, y, z, block: hollow && !shell ? 'air' : block, tries: 0 });
        }
    return out;
  }
}

interface Plot { x1: number; z1: number; x2: number; z2: number; y: number }

/**
 * Prepare ground for building: fell every tree touching the area, cut high ground down and fill low ground (and
 * shallow water) up to one level, with grass on top. Columns containing anything built are left untouched. The plot is recorded in
 * memory.plots; preparing next to it at the same y extends it seamlessly.
 */
class PrepareSiteSkill extends BuildJob {
  maxBlocks = 12000;
  plot: Plot | null = null;
  margin = 0;
  protectedCols = 0;

  plan(): BuildTarget[] {
    const p = this.player;
    const last = this.agent.memory.lastSite as { x: number; z: number } | undefined;
    const cx = this.args.x !== undefined ? Math.floor(num(this.args.x, 'x')) : last?.x ?? Math.floor(p.x);
    const cz = this.args.z !== undefined ? Math.floor(num(this.args.z, 'z')) : last?.z ?? Math.floor(p.z);
    const size = (k: string, def: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(hi, Math.floor(this.args[k] !== undefined ? num(this.args[k], k) : def)));
    const w = size('width', 9, 3, 32), d = size('depth', 9, 3, 32), m = (this.margin = size('margin', 2, 0, 4));
    const x0 = cx - Math.floor(w / 2), z0 = cz - Math.floor(d / 2), x1 = x0 + w - 1, z1 = z0 + d - 1;
    const world = this.game.world;
    const surf = new Map<string, Surface>();
    for (let x = x0 - m; x <= x1 + m; x++)
      for (let z = z0 - m; z <= z1 + m; z++) {
        const c = surfaceAt(this.agent, x, z, Math.floor(p.y));
        if (!c) throw new Error(`part of the area is not loaded; walk closer to x=${cx} z=${cz} first`);
        surf.set(`${x},${z}`, c);
      }
    // Level: the most common ground height on the plot itself (least digging and filling), unless given
    let y = this.args.y !== undefined ? Math.floor(num(this.args.y, 'y')) : NaN;
    if (isNaN(y)) {
      const counts = new Map<number, number>();
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const c = surf.get(`${x},${z}`)!;
          if (!c.liquid) counts.set(c.y, (counts.get(c.y) ?? 0) + 1);
        }
      if (!counts.size) throw new Error('the area is all water; use find_site to choose dry land');
      y = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    }
    const out: BuildTarget[] = [];
    const add = (x: number, yy: number, z: number, block: string) => out.push({ x, y: yy, z, block, tries: 0 });
    let columns = 0;
    this.protectedCols = 0;
    for (let x = x0 - m; x <= x1 + m; x++)
      next: for (let z = z0 - m; z <= z1 + m; z++) {
        // Everything above the level goes, but columns with anything built in them are left alone
        const cut: number[] = [];
        for (let yy = y + 1; yy <= Math.min(255, y + 32); yy++) {
          const n = BLOCKS[world.getBlock(x, yy, z) & 0xff].name;
          if (n === 'air') continue;
          if (!NATURAL.test(n)) {
            this.protectedCols++;
            continue next;
          }
          cut.push(yy);
        }
        columns++;
        for (const yy of cut) add(x, yy, z, 'air');
        // Fill low ground and shallow water up to the level
        const c = surf.get(`${x},${z}`)!;
        let g = c.y;
        if (c.liquid) while (g > y - 10 && !blockOf(world.getBlock(x, g, z)).solid) g--;
        if (y - g > 8) throw new Error(`the ground at ${x},${z} is ${y - g} blocks below the level (deep water or a ravine); choose a flatter site with find_site`);
        for (let yy = g + 1; yy < y; yy++) add(x, yy, z, 'dirt');
        const top = BLOCKS[world.getBlock(x, y, z) & 0xff].name;
        if (top !== 'grass_block' && (g < y || top === 'dirt' || !blockOf(world.getBlock(x, y, z)).solid)) add(x, y, z, 'grass_block');
      }
    if (!columns) throw new Error('the whole area is covered by existing buildings; use find_site to choose another spot');
    this.plot = { x1: x0, z1: z0, x2: x1, z2: z1, y };
    this.claim = { area: { x1: x0 - m, z1: z0 - m, x2: x1 + m, z2: z1 + m }, purpose: 'prepare a plot', avoidStructures: false };
    return out;
  }

  tick(): SkillResult {
    const r = super.tick();
    if (typeof r !== 'object' || !('done' in r) || !this.plot) return r;
    const pl = this.plot;
    const same = (q: Plot) => q.x1 === pl.x1 && q.z1 === pl.z1 && q.x2 === pl.x2 && q.z2 === pl.z2;
    if (this.village) {
      const reg = this.agent.manager.villages;
      this.village.plots = this.village.plots.filter((q) => !same(q));
      this.village.plots.push({ ...pl, id: reg.id('plot'), preparedBy: this.player.name });
      reg.note(this.village, `${this.player.name} prepared a plot at ${areaText(pl)}`);
    } else this.agent.memory.plots = [...((this.agent.memory.plots as Plot[] | undefined) ?? []).filter((q) => !same(q)), pl].slice(-20);
    const cx = Math.floor((pl.x1 + pl.x2) / 2), cz = Math.floor((pl.z1 + pl.z2) / 2);
    return { done: `plot ready: ${pl.x2 - pl.x1 + 1}x${pl.z2 - pl.z1 + 1} centred at x=${cx} z=${cz}, level ground at y=${pl.y} (x ${pl.x1}..${pl.x2}, z ${pl.z1}..${pl.z2}, plus a ${this.margin}-block margin)${this.protectedCols ? `; left ${this.protectedCols} columns with existing buildings untouched` : ''}; ${r.done}` };
  }
}

/** Add a finished building to the agent's village, if it has one. */
function recordStructure(agent: Agent, b: (Area & { y: number; kind: string }) | null): string {
  const v = agent.village();
  if (!v || !b) return '';
  const reg = agent.manager.villages;
  v.structures.push({ ...b, id: reg.id('s'), builtBy: agent.player.name });
  reg.note(v, `${agent.player.name} built a ${b.kind} at ${areaText(b)}`);
  return `${b.kind} recorded in village ${v.name} at ${areaText(b)}`;
}

/**
 * Ground level for a building footprint, or throws why the site is not ready: unloaded, water, not level, trees or
 * rocks in the way (prepare it), or another building (go elsewhere).
 */
function readySite(agent: Agent, a: Area, height: number, what: string): number {
  const p = agent.player;
  const w = a.x2 - a.x1 + 1, d = a.z2 - a.z1 + 1;
  const cx = a.x1 + Math.floor(w / 2), cz = a.z1 + Math.floor(d / 2);
  const prep = `run prepare_site x=${cx} z=${cz} width=${w + 2} depth=${d + 2} first`;
  const v = agent.village();
  const there = v?.structures.find((st) => overlaps(a, st));
  if (there) {
    const same = there.kind === what.replace(/"/g, '') ? ' (the same design: if building it here was your task, it is already done)' : '';
    throw new Error(`a ${there.kind} built by ${there.builtBy} already stands at ${areaText(there)}${same}; otherwise pick a free spot on the plot`);
  }
  const heights: number[] = [];
  let wet = 0;
  for (let x = a.x1; x <= a.x2; x++)
    for (let z = a.z1; z <= a.z2; z++) {
      const c = surfaceAt(agent, x, z, Math.floor(p.y));
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
  for (let x = a.x1; x <= a.x2; x++)
    for (let z = a.z1; z <= a.z2; z++)
      for (let y = y0 + 1; y < y0 + height; y++) {
        const def = blockOf(agent.game.world.getBlock(x, y, z));
        if (def.id === 0 || def.replaceable) continue;
        blocked++;
        if (!NATURAL.test(def.name)) built ||= `${def.name} at ${x},${y},${z}`;
      }
  if (built) throw new Error(`the site overlaps an existing structure (${built}); choose another site with find_site`);
  if (blocked) throw new Error(`${blocked} blocks (trees or rocks) stand where the ${what} would go; ${prep}`);
  return y0;
}

/** Build a design from the village design library (or the agent's own), turned clockwise by `rotate`, on prepared ground. */
class BuildDesignSkill extends BuildJob {
  maxBlocks = 5000;
  built: (Area & { y: number; kind: string }) | null = null;
  already = '';

  protected finished(): string {
    return this.already || recordStructure(this.agent, this.built);
  }

  plan(): BuildTarget[] {
    const name = str(this.args.design, 'design').trim().toLowerCase();
    const lib = this.agent.village()?.designs ?? (this.agent.memory.designs as Record<string, Design> | undefined) ?? {};
    const d = lib[name];
    if (!d) {
      const names = Object.keys(lib);
      throw new Error(`no design called "${name}"; ${names.length ? `available: ${names.map((n) => `"${n}"`).join(', ')}` : 'create one with design_building first'}`);
    }
    const rot = (((Math.round(Number(this.args.rotate ?? 0) / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
    const W = rot % 2 ? d.depth : d.width, D = rot % 2 ? d.width : d.depth;
    const p = this.player;
    const cx = this.args.x !== undefined ? Math.floor(num(this.args.x, 'x')) : Math.floor(p.x);
    const cz = this.args.z !== undefined ? Math.floor(num(this.args.z, 'z')) : Math.floor(p.z);
    const area = { x1: cx - Math.floor(W / 2), z1: cz - Math.floor(D / 2), x2: cx - Math.floor(W / 2) + W - 1, z2: cz - Math.floor(D / 2) + D - 1 };
    // Asked to build what already stands there (e.g. a task someone else finished): that is done, not a failure
    const same = this.agent.village()?.structures.find((st) => st.kind === d.name && overlaps(area, st));
    if (same) {
      this.already = `a ${d.name} built by ${same.builtBy} already stands at ${areaText(same)}, so this is already done`;
      return [];
    }
    const y0 = readySite(this.agent, area, d.height, `"${d.name}"`);
    // Design column i (west to east) and row j (north to south), turned clockwise rot times
    const turn = (i: number, j: number): [number, number] => {
      let [a, b, w, h] = [i, j, d.width, d.depth];
      for (let r = 0; r < rot; r++) [a, b, w, h] = [h - 1 - b, a, h, w];
      return [a, b];
    };
    const out: BuildTarget[] = [];
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
          if (block === 'oak_door') {
            facing = ox === 0 ? [-1, 0] : ox === W - 1 ? [1, 0] : oz === 0 ? [0, -1] : [0, 1];
            if (li === 1) doors.push([x, z, facing]);
          }
          out.push({ x, y: y0 + li, z, block, tries: 0, facing });
        }
      }),
    );
    // Keep the way out clear in front of each outside door
    for (const [x, z, [fx, fz]] of doors)
      for (let i = 1; i <= 2; i++) {
        const wx = x + fx * i, wz = z + fz * i;
        if (!blockOf(this.game.world.getBlock(wx, y0, wz)).solid) out.push({ x: wx, y: y0, z: wz, block: 'dirt', tries: 0 });
        for (let y = y0 + 1; y <= y0 + 3; y++) out.push({ x: wx, y, z: wz, block: 'air', tries: 0 });
      }
    this.claim = { area: { x1: area.x1 - 1, z1: area.z1 - 1, x2: area.x2 + 1, z2: area.z2 + 1 }, purpose: `build a ${d.name}`, avoidStructures: true };
    this.built = { ...area, y: y0, kind: d.name };
    return out;
  }
}

const STRUCTURES = ['hut', 'house', 'platform', 'wall'];
const SIDES: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

/** Blueprint builder: finds the ground level, clears the site and builds a whole structure. */
class BlueprintSkill extends BuildJob {
  built: (Area & { y: number; kind: string }) | null = null;

  protected finished(): string {
    return recordStructure(this.agent, this.built);
  }

  plan(): BuildTarget[] {
    const kind = str(this.args.structure, 'structure');
    if (!STRUCTURES.includes(kind)) throw new Error(`unknown structure ${kind}. Options: ${STRUCTURES.join(', ')}`);
    const material = blockItem(typeof this.args.material === 'string' ? this.args.material : 'oak_planks', 'material');
    const roof = blockItem(typeof this.args.roof === 'string' ? this.args.roof : material, 'roof');
    const floor = blockItem(typeof this.args.floor === 'string' ? this.args.floor : kind === 'platform' ? material : 'cobblestone', 'floor');
    const p = this.player;
    const cx = this.args.x !== undefined ? Math.floor(num(this.args.x, 'x')) : Math.floor(p.x) + 6;
    const cz = this.args.z !== undefined ? Math.floor(num(this.args.z, 'z')) : Math.floor(p.z);
    const size = (k: string, def: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(hi, Math.floor(this.args[k] !== undefined ? num(this.args[k], k) : def)));
    const out: BuildTarget[] = [];
    const add = (x: number, y: number, z: number, block: string, facing?: [number, number]) => out.push({ x, y, z, block, tries: 0, facing });

    if (kind === 'wall') {
      const [dx, dz] = SIDES[String(this.args.direction ?? 'east')] ?? SIDES.east;
      const len = size('length', 8, 1, 32), h = size('height', 3, 1, 5);
      for (let i = 0; i < len; i++) {
        const x = cx + dx * i, z = cz + dz * i;
        const g = groundY(this.agent, x, z, Math.floor(p.y));
        for (let y = g + 1; y <= g + h; y++) add(x, y, z, material);
      }
      const area = { x1: Math.min(cx, cx + dx * (len - 1)), z1: Math.min(cz, cz + dz * (len - 1)), x2: Math.max(cx, cx + dx * (len - 1)), z2: Math.max(cz, cz + dz * (len - 1)) };
      this.claim = { area, purpose: 'build a wall', avoidStructures: true };
      this.built = { ...area, y: groundY(this.agent, cx, cz, Math.floor(p.y)), kind: 'wall' };
      return out;
    }

    const w = size('width', kind === 'house' ? 7 : 5, 3, 11), d = size('depth', kind === 'house' ? 7 : 5, 3, 11);
    const h = kind === 'platform' ? 0 : size('height', kind === 'house' ? 4 : 3, 2, 5);
    const x0 = cx - Math.floor(w / 2), z0 = cz - Math.floor(d / 2);
    const x1 = x0 + w - 1, z1 = z0 + d - 1;
    let wet = 0;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (surfaceAt(this.agent, x, z, Math.floor(p.y))?.liquid) wet++;
    if (wet) throw new Error(`the ${w}x${d} site at x=${cx} z=${cz} has ${wet} columns of water or lava; use find_site (size ${Math.max(w, d) + 2}) to pick a dry spot`);
    // Floor level: the median ground height over the footprint, so a sloped site is partly dug in, partly raised
    const ground = new Map<string, number>();
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) ground.set(`${x},${z}`, groundY(this.agent, x, z, Math.floor(p.y)));
    const heights = [...ground.values()].sort((a, b) => a - b);
    const level = heights[heights.length - 1] - heights[0] <= 1 && kind !== 'platform' ? heights[heights.length - 1] : heights[heights.length >> 1];
    const y0 = this.args.y !== undefined ? Math.floor(num(this.args.y, 'y')) : level;
    // Houses and huts go on prepared ground: level, with nothing standing where the building will be
    if (kind !== 'platform') {
      const prep = `run prepare_site x=${cx} z=${cz} width=${w + 2} depth=${d + 2} first`;
      if (heights[heights.length - 1] - heights[0] > 1) throw new Error(`the ground is not level here (heights ${heights[0]}..${heights[heights.length - 1]}); ${prep}`);
      let blocked = 0, built = '';
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++)
          for (let y = y0 + 1; y <= y0 + h + 1; y++) {
            const def = blockOf(this.game.world.getBlock(x, y, z));
            if (def.id === 0 || def.replaceable) continue;
            blocked++;
            if (!NATURAL.test(def.name)) built ||= `${def.name} at ${x},${y},${z}`;
          }
      if (built) throw new Error(`the site overlaps an existing structure (${built}); choose another site with find_site`);
      if (blocked) throw new Error(`${blocked} blocks (trees or rocks) stand where the ${kind} would go; ${prep}`);
    }

    // Door on the side facing the agent unless told otherwise
    const side = typeof this.args.door === 'string' && SIDES[this.args.door] ? this.args.door
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
            if (rel === 1) add(x, y, z, 'oak_door', [sdx, sdz]); // face through the wall so the door swings clear
            else add(x, y, z, 'air');
          }
          else {
            const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
            const mid = x === x0 || x === x1 ? z === cz : x === cx;
            add(x, y, z, !corner && mid && rel === 2 && w >= 5 && d >= 5 ? 'glass' : material);
          }
        }
      }
    this.claim = { area: { x1: x0 - 1, z1: z0 - 1, x2: x1 + 1, z2: z1 + 1 }, purpose: `build a ${kind}`, avoidStructures: true };
    this.built = { x1: x0, z1: z0, x2: x1, z2: z1, y: y0, kind };
    // Keep the way out clear: two blocks of walkway in front of the door, with ground under them
    if (kind !== 'platform')
      for (let i = 1; i <= 2; i++) {
        const x = doorX + sdx * i, z = doorZ + sdz * i;
        if (!blockOf(this.game.world.getBlock(x, y0, z)).solid) add(x, y0, z, floor);
        for (let y = y0 + 1; y <= y0 + 3; y++) add(x, y, z, 'air');
      }
    return out;
  }
}

export const SKILLS: Record<string, { cls: new (a: Agent, args: Record<string, unknown>) => Skill; doc: string }> = {
  move_to: { cls: MoveToSkill, doc: 'Walk to a position. args: x, y, z, range?' },
  mine: { cls: MineSkill, doc: 'Mine the block at x,y,z (walks there, uses best tool, collects drops).' },
  collect: { cls: CollectSkill, doc: "Find and mine blocks of a type until `count` items obtained. args: block (e.g. 'oak_log', 'logs', 'stone', 'coal_ore'), count" },
  place: { cls: PlaceSkill, doc: 'Place a block item at x,y,z. args: item, x, y, z' },
  craft: { cls: CraftSkill, doc: 'Craft an item (uses/places a crafting table for 3x3 recipes). args: item, count?' },
  smelt: { cls: SmeltSkill, doc: 'Smelt an item in a nearby furnace (places one if carried). args: item, count?' },
  attack: { cls: AttackSkill, doc: 'Attack an entity until it dies. args: id | kind' },
  follow: { cls: FollowSkill, doc: 'Follow a player. args: player, distance?, seconds?' },
  give: { cls: GiveSkill, doc: 'Walk to a player and toss them items. args: player, item, count?' },
  chat: { cls: ChatSkill, doc: 'Say something in chat. args: message' },
  eat: { cls: EatSkill, doc: 'Eat food from the inventory. args: item?' },
  equip: { cls: EquipSkill, doc: 'Hold an item. args: item' },
  drop: { cls: DropSkill, doc: 'Drop items. args: item, count?' },
  look_at: { cls: LookSkill, doc: 'Look at a position. args: x, y, z' },
  wait: { cls: WaitSkill, doc: 'Do nothing for a while. args: seconds?' },
  explore: { cls: ExploreSkill, doc: 'Walk ~distance blocks in a direction to explore. args: direction? (north/south/east/west), distance?' },
  sleep: { cls: SleepSkill, doc: 'Sleep in a nearby bed (skips the night).' },
  prepare_site: { cls: PrepareSiteSkill, doc: 'Prepare a building plot: fell trees, level the ground (cut and fill) with a margin, never demolishing builds. args: x?, z? (default: last find_site), width?, depth? (default 9), margin? (default 2), y? (level; reuse an existing plot y to extend it)' },
  find_site: { cls: FindSiteSkill, doc: 'Find a dry, flat, open area to build on and report its centre. args: size? (default 9, up to 40), radius? (default 48), x?, z? (search around), max_slope? (default 2)' },
  build_design: { cls: BuildDesignSkill, doc: 'Build a design from the village design library centred on x,z, on prepared ground. args: design, x, z, rotate? (0/90/180/270 clockwise)' },
  get_item: { cls: GetItemSkill, doc: 'Creative mode only: take items from the creative inventory. args: item, count? (default 64)' },
  build_box: { cls: BuildBoxSkill, doc: "Fill a box with a block, or clear it with block 'air'. args: x1, y1, z1, x2, y2, z2, block, hollow?, label? (what it is, e.g. 'well', recorded in the village)" },
  build: { cls: BlueprintSkill, doc: `Build a whole structure centred on x,z (ground level found automatically). args: structure (${STRUCTURES.join('/')}), x?, z?, y?, material?, roof?, floor?, width?, depth?, height?, door? (north/south/east/west), length?/direction? (wall)` },
};

function describeRecipe(r: Recipe): string {
  const counts: Record<string, number> = {};
  const ings = r.kind === 'shaped' ? r.pattern.join('').split('').filter((c) => c !== ' ').map((c) => r.key[c]) : r.ingredients;
  for (const i of ings) counts[i] = (counts[i] ?? 0) + 1;
  return Object.entries(counts).map(([k, v]) => `${v}x ${k}`).join(', ');
}

// ---------------------------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------------------------

let nextEventId = 1;
let nextActionId = 1;

export class Agent {
  player: Player;
  events: AgentEvent[] = [];
  queue: Array<{ status: ActionStatus; skill: Skill }> = [];
  current: { status: ActionStatus; skill: Skill } | null = null;
  history: ActionStatus[] = [];
  input: MoveInput = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, yaw: 0, flying: false };
  brain: AgentBrain | null = null;
  role: string;
  /** Free-form memory store usable by brains / external controllers. */
  memory: Record<string, unknown> = {};

  /** The village this agent belongs to (memory.village), if any. */
  village(): Village | undefined {
    return this.manager.villages.get(this.memory.village);
  }
  hearingRange = 48;

  constructor(public game: Game, public manager: AgentManager, name: string, role: string) {
    this.role = role;
    const conn = new AgentConnection(() => this.manager.agents.get(name.toLowerCase()));
    this.player = game.join(conn, name);
  }

  pushEvent(type: AgentEvent['type'], text: string, data?: Record<string, unknown>) {
    this.events.push({ id: nextEventId++, tick: this.game.tick, type, text, data });
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    this.brain?.onEvent?.(this, this.events[this.events.length - 1]);
  }

  hearChat(from: string, text: string) {
    const speaker = this.game.getPlayer(from);
    const dist = speaker ? speaker.distanceTo(this.player) : 0;
    if (speaker && dist > this.hearingRange) return; // too far away to hear
    this.pushEvent('chat', `<${from}> ${text}`, { from, text, distance: Math.round(dist) });
  }

  enqueue(type: string, args: Record<string, unknown>, replace = false): ActionStatus {
    const spec = SKILLS[type];
    if (!spec) throw new Error(`unknown action '${type}'. Available: ${Object.keys(SKILLS).join(', ')}`);
    const skill = new spec.cls(this, args); // throws on bad arguments
    const status: ActionStatus = { id: nextActionId++, type, args, state: 'queued' };
    if (replace) this.stop();
    this.queue.push({ status, skill });
    return status;
  }

  stop() {
    if (this.current) {
      this.current.skill.cancel();
      this.current.status.state = 'failed';
      this.current.status.message = 'cancelled';
      this.history.push(this.current.status);
    }
    this.current = null;
    for (const q of this.queue) {
      q.status.state = 'failed';
      q.status.message = 'cancelled';
    }
    this.queue = [];
    this.resetInput();
  }

  private resetInput() {
    this.input.forward = 0;
    this.input.strafe = 0;
    this.input.jump = false;
    this.input.sprint = false;
  }

  lookAt(x: number, y: number, z: number, yawOnly = false) {
    const p = this.player;
    const dx = x - p.x, dy = y - (p.y + p.eyeHeight), dz = z - p.z;
    p.yaw = Math.atan2(-dx, -dz);
    if (!yawOnly) p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    else p.pitch *= 0.8;
    this.input.yaw = p.yaw;
  }

  tick() {
    const p = this.player;
    if (p.dead) {
      if (this.current || this.queue.length) this.stop();
      // respawn after a short delay
      if (this.game.tick % 60 === 0) p.respawn();
      return;
    }
    this.brain?.tick?.(this);
    this.resetInput();
    this.input.yaw = p.yaw;
    if (!this.current && this.queue.length) {
      this.current = this.queue.shift()!;
      this.current.status.state = 'running';
      this.current.status.startedTick = this.game.tick;
    }
    if (this.current) {
      let r: SkillResult;
      try {
        r = this.current.skill.tick();
      } catch (e) {
        r = { fail: (e as Error).message };
      }
      if (r !== 'running') {
        const st = this.current.status;
        if (r === 'done' || 'done' in r) {
          st.state = 'done';
          if (r !== 'done') st.message = r.done;
          this.pushEvent('action_done', `${st.type} finished${r !== 'done' ? `: ${r.done}` : ''}`, { action: st.id, type: st.type });
        } else {
          st.state = 'failed';
          st.message = r.fail;
          this.pushEvent('action_failed', `${st.type} failed: ${r.fail}`, { action: st.id, type: st.type });
        }
        this.current.skill.cancel();
        this.history.push(st);
        if (this.history.length > 100) this.history.shift();
        this.current = null;
        this.resetInput();
      }
    }
    // Physics
    const b = p.body;
    this.input.yaw = p.yaw;
    const wasOnGround = b.onGround;
    stepPlayer(this.game.world, b, this.input, p.eyeHeight);
    if (b.onGround) {
      if (b.fallDistance > 3 && !wasOnGround) p.damage(Math.ceil(b.fallDistance - 3), null, 'fall');
      b.fallDistance = 0;
    }
    if (b.inWater) b.fallDistance = 0;
    p.sprinting = this.input.sprint;
  }

  // ---- helpers used by skills ------------------------------------------------------------

  findNearestBlock(match: (id: number) => boolean, radius = 32, exclude?: Set<string>): [number, number, number] | null {
    const w = this.game.world;
    const px = Math.floor(this.player.x), py = Math.floor(this.player.y), pz = Math.floor(this.player.z);
    let best: [number, number, number] | null = null, bd = Infinity;
    const y0 = Math.max(1, py - 24);
    // Search square rings outwards so we can stop as soon as nothing closer can exist
    for (let r = 0; r <= radius; r++) {
      if (r * r > bd) break;
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = px + dx, z = pz + dz;
          const c = w.getChunk(x >> 4, z >> 4);
          if (!c) continue;
          const col = (x & 15) | ((z & 15) << 4);
          const top = Math.min(255, Math.max(py + 24, c.heightmap[col]));
          const blocks = c.blocks;
          for (let y = y0; y <= top; y++) {
            const id = blocks[col | (y << 8)] & 0xff;
            if (!match(id)) continue;
            const d = dx * dx + dz * dz + (y - py) * (y - py) * 1.5;
            if (d < bd && !(exclude && exclude.has(`${x},${y},${z}`))) {
              bd = d;
              best = [x, y, z];
            }
          }
        }
    }
    return best;
  }

  /** An empty standable spot adjacent to the agent for placing utility blocks. */
  findPlaceSpot(): [number, number, number] | null {
    const w = this.game.world;
    const px = Math.floor(this.player.x), py = Math.floor(this.player.y), pz = Math.floor(this.player.z);
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [1, 2], [-2, -1], [-1, -2]]) {
      const x = px + dx, z = pz + dz;
      for (const dy of [0, 1, -1]) {
        const y = py + dy;
        if (blockOf(w.getBlock(x, y, z)).replaceable && blockOf(w.getBlock(x, y - 1, z)).solid && blockOf(w.getBlock(x, y + 1, z)).replaceable) return [x, y, z];
      }
    }
    return null;
  }

  equip(itemName: string): boolean {
    const it = ITEMS_BY_NAME.get(itemName);
    if (!it) return false;
    const inv = this.player.inventory;
    if (inv[this.player.selected]?.id === it.id) return true;
    const idx = inv.findIndex((s) => s?.id === it.id);
    if (idx < 0) return false;
    if (idx < 9) this.player.selected = idx;
    else {
      const slot = this.player.selected;
      const tmp = inv[slot];
      inv[slot] = inv[idx];
      inv[idx] = tmp;
    }
    this.player.sendInventory();
    this.game.broadcastNear(this.player, { t: 'meta', id: this.player.id, e: { item: this.player.heldItem() } });
    return true;
  }

  equipBestTool(state: number) {
    const def = blockOf(state);
    let best: string | null = null, bestSpeed = 1;
    for (const s of this.player.inventory) {
      if (!s) continue;
      const t = itemDef(s.id).tool;
      if (t && t.type === def.tool && t.speed > bestSpeed) {
        bestSpeed = t.speed;
        best = itemDef(s.id).name;
      }
    }
    if (best) this.equip(best);
  }

  equipBestWeapon() {
    let best: string | null = null, bd = 1;
    for (const s of this.player.inventory) {
      if (!s) continue;
      const t = itemDef(s.id).tool;
      if (t && t.damage > bd) { bd = t.damage; best = itemDef(s.id).name; }
    }
    if (best) this.equip(best);
  }

  private pickupNav: Navigator | null = null;
  private pickupTarget: number | null = null;
  /** Walk towards the nearest dropped item around (x,y,z). Returns false when nothing is left to collect. */
  collectNearbyItems(x: number, y: number, z: number): boolean {
    let best: ItemEntity | null = null, bd = 6;
    for (const e of this.game.entitiesNear(x + 0.5, y + 0.5, z + 0.5, 6)) {
      if (!(e instanceof ItemEntity) || e.removed) continue;
      const d = e.distanceTo(this.player);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) {
      this.pickupNav = null;
      return false;
    }
    if (this.pickupTarget !== best.id || !this.pickupNav) {
      this.pickupTarget = best.id;
      this.pickupNav = new Navigator(this, { x: Math.floor(best.x), y: Math.floor(best.y + 0.2), z: Math.floor(best.z) }, 0.6);
    }
    const r = this.pickupNav.step();
    if (r === 'fail' || r === true) {
      // close enough or unreachable: nudge directly towards it
      this.lookAt(best.x, best.y, best.z, true);
      this.input.forward = bd > 0.5 ? 1 : 0;
      this.input.jump = best.y > this.player.y + 0.5;
    }
    return true;
  }

  private ingredientCounts(r: Recipe): Map<string, number> {
    const m = new Map<string, number>();
    const ings = r.kind === 'shaped' ? r.pattern.join('').split('').filter((c) => c !== ' ').map((c) => r.key[c]) : r.ingredients;
    for (const i of ings) m.set(i, (m.get(i) ?? 0) + 1);
    return m;
  }

  private idsFor(ing: string): number[] {
    return (ing.startsWith('#') ? TAGS[ing.slice(1)] ?? [] : [ing]).map((n) => ITEMS_BY_NAME.get(n)?.id).filter((x): x is number => x !== undefined);
  }

  canAfford(r: Recipe): boolean {
    const inv = this.player.inventory;
    for (const [ing, n] of this.ingredientCounts(r)) {
      const have = this.idsFor(ing).reduce((a, id) => a + countItem(inv, id), 0);
      if (have < n) return false;
    }
    return true;
  }

  /** Ingredients the inventory is short of for a recipe, as [ingredient, needed, have]. */
  missing(r: Recipe): Array<[string, number, number]> {
    const inv = this.player.inventory;
    const out: Array<[string, number, number]> = [];
    for (const [ing, n] of this.ingredientCounts(r)) {
      const have = this.idsFor(ing).reduce((a, id) => a + countItem(inv, id), 0);
      if (have < n) out.push([ing, n, have]);
    }
    return out;
  }

  consumeRecipe(r: Recipe) {
    const inv = this.player.inventory;
    for (const [ing, n] of this.ingredientCounts(r)) {
      let left = n;
      for (const id of this.idsFor(ing)) {
        if (left <= 0) break;
        left -= removeItem(inv, id, left);
      }
    }
    this.player.sendInventory();
  }

  observe(radius = 16): Observation {
    const p = this.player;
    const w = this.game.world;
    const inventory: Record<string, number> = {};
    for (const s of p.inventory) if (s) inventory[itemDef(s.id).name] = (inventory[itemDef(s.id).name] ?? 0) + s.count;
    const nearbyBlocks: Observation['nearbyBlocks'] = {};
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    const interesting = (name: string) => !['air', 'stone', 'dirt', 'grass_block', 'water', 'bedrock', 'sand', 'gravel', 'short_grass', 'deepslate'].includes(name) || true;
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++)
        for (let dy = -8; dy <= 8; dy++) {
          const x = px + dx, y = py + dy, z = pz + dz;
          const id = w.getBlock(x, y, z) & 0xff;
          if (id === 0) continue;
          const name = BLOCKS[id].name;
          if (!interesting(name)) continue;
          // only count blocks that are exposed to air (visible), like a player would see
          let exposed = false;
          for (const [ex, ey, ez] of FACE_DIRS) if (!BLOCKS[w.getBlock(x + ex, y + ey, z + ez) & 0xff].opaque) { exposed = true; break; }
          if (!exposed) continue;
          const d2 = dx * dx + dy * dy + dz * dz;
          const e = nearbyBlocks[name];
          if (!e) nearbyBlocks[name] = { count: 1, nearest: [x, y, z] };
          else {
            e.count++;
            const n = e.nearest;
            if (d2 < (n[0] - px) ** 2 + (n[1] - py) ** 2 + (n[2] - pz) ** 2) e.nearest = [x, y, z];
          }
        }
    const nearbyEntities: Observation['nearbyEntities'] = [];
    for (const e of this.game.entitiesNear(p.x, p.y, p.z, 32)) {
      if (e === p || e.removed) continue;
      nearbyEntities.push({
        id: e.id, kind: e.kind, name: e instanceof Player ? e.name : e instanceof ItemEntity ? itemDef(e.stack.id).name : undefined,
        x: round1(e.x), y: round1(e.y), z: round1(e.z), distance: round1(e.distanceTo(p)), health: e instanceof Mob || e instanceof Player ? e.health : undefined,
      });
    }
    nearbyEntities.sort((a, b) => a.distance - b.distance);
    const c = w.getChunk(px >> 4, pz >> 4);
    return {
      name: p.name,
      tick: this.game.tick,
      timeOfDay: Math.floor(this.game.time % DAY_LENGTH),
      isDay: this.game.isDay(),
      position: { x: round1(p.x), y: round1(p.y), z: round1(p.z) },
      yaw: round1(p.yaw),
      health: p.health,
      food: p.food,
      gamemode: p.gamemode,
      dead: p.dead,
      biome: c ? BIOMES[c.biomes[(px & 15) | ((pz & 15) << 4)]]?.name ?? 'unknown' : 'unknown',
      holding: p.heldItem() ? itemDef(p.heldItem()!.id).name : null,
      inventory,
      equipment: p.armor.map((a) => (a ? itemDef(a.id).name : null)),
      nearbyBlocks,
      nearbyEntities: nearbyEntities.slice(0, 30),
      currentAction: this.current?.status ?? null,
      queuedActions: this.queue.length,
      recentEvents: this.events.slice(-20),
    };
  }

  /** What the agent sees directly ahead (for vision-like queries). */
  lookingAt(): { block: string; x: number; y: number; z: number } | null {
    const p = this.player;
    const d = p.lookDir();
    const hit = raycast(this.game.world, p.x, p.y + p.eyeHeight, p.z, d[0], d[1], d[2], 8);
    return hit ? { block: BLOCKS[hit.state & 0xff].name, x: hit.x, y: hit.y, z: hit.z } : null;
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------------------------
// Manager + REST API
// ---------------------------------------------------------------------------------------------

export interface AgentMetrics {
  role: string;
  spawnedTick: number;
  uniqueItems: Set<string>;
  /** Tick at which each unique item was first obtained (progression curve, as in Project Sid). */
  firstObtained: Record<string, number>;
  crafted: Record<string, number>;
  mined: Record<string, number>;
  chatsSent: number;
  deaths: number;
  kills: Record<string, number>;
  distanceTravelled: number;
  lastPos: { x: number; z: number } | null;
}

export class AgentManager {
  agents = new Map<string, Agent>();
  metrics = new Map<string, AgentMetrics>();
  /** Social graph: speaker -> listener -> number of messages heard. */
  heard = new Map<string, Map<string, number>>();

  villages: VillageRegistry;

  constructor(public game: Game) {
    this.villages = VillageRegistry.forWorld(game.world.dir);
    game.chatListeners.push((from, text) => this.onChat(from, text));
  }

  private m(name: string): AgentMetrics | undefined {
    return this.metrics.get(name.toLowerCase());
  }

  private obtained(p: Player, item: string) {
    const m = this.m(p.name);
    if (!m) return;
    if (!m.uniqueItems.has(item)) {
      m.uniqueItems.add(item);
      m.firstObtained[item] = this.game.tick - m.spawnedTick;
    }
  }

  private onChat(from: Player | null, _text: string) {
    if (!from) return;
    const sm = this.m(from.name);
    if (sm) sm.chatsSent++;
    for (const a of this.agents.values()) {
      if (!a.player || a.player === from || a.player.distanceTo(from) > a.hearingRange) continue;
      let row = this.heard.get(from.name);
      if (!row) this.heard.set(from.name, (row = new Map()));
      row.set(a.player.name, (row.get(a.player.name) ?? 0) + 1);
    }
  }

  /** Summary suitable for experiment logging (JSON-serialisable). */
  metricsReport() {
    const agents: Record<string, unknown> = {};
    for (const [key, m] of this.metrics) {
      const a = this.agents.get(key);
      agents[a?.player.name ?? key] = {
        role: m.role,
        alive: !!a && !a.player.dead,
        ticksAlive: this.game.tick - m.spawnedTick,
        uniqueItemCount: m.uniqueItems.size,
        uniqueItems: [...m.uniqueItems],
        firstObtained: m.firstObtained,
        crafted: m.crafted,
        mined: m.mined,
        kills: m.kills,
        chatsSent: m.chatsSent,
        deaths: m.deaths,
        distanceTravelled: Math.round(m.distanceTravelled),
        inventory: a ? a.observe(1).inventory : {},
      };
    }
    const social: Record<string, Record<string, number>> = {};
    for (const [from, row] of this.heard) social[from] = Object.fromEntries(row);
    return { tick: this.game.tick, timeOfDay: this.game.time % DAY_LENGTH, agents, social };
  }

  /** Called every tick to accumulate movement statistics. */
  private trackMovement() {
    if (this.game.tick % 20 !== 0) return;
    for (const [key, a] of this.agents) {
      const m = this.metrics.get(key);
      if (!m || !a.player) continue;
      if (m.lastPos) m.distanceTravelled += Math.hypot(a.player.x - m.lastPos.x, a.player.z - m.lastPos.z);
      m.lastPos = { x: a.player.x, z: a.player.z };
    }
  }

  spawn(name: string, role = 'villager', brain: string | null = null, pos?: { x: number; y: number; z: number }): Agent {
    name = name.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);
    if (!name) throw new Error('invalid name');
    if (this.agents.has(name.toLowerCase())) throw new Error(`agent ${name} already exists`);
    if (this.game.getPlayer(name)) throw new Error(`a player named ${name} is online`);
    const placeholder = { name } as unknown as Agent;
    this.agents.set(name.toLowerCase(), placeholder);
    const agent = new Agent(this.game, this, name, role);
    this.agents.set(name.toLowerCase(), agent);
    if (pos) agent.player.teleport(pos.x, pos.y, pos.z);
    if (brain) {
      const factory = BRAINS[brain];
      if (!factory) throw new Error(`unknown brain ${brain}. Options: ${Object.keys(BRAINS).join(', ')}`);
      agent.brain = factory();
      agent.brain.init?.(agent);
    }
    this.metrics.set(name.toLowerCase(), { role, spawnedTick: this.game.tick, uniqueItems: new Set(), firstObtained: {}, crafted: {}, mined: {}, chatsSent: 0, deaths: 0, kills: {}, distanceTravelled: 0, lastPos: null });
    agent.pushEvent('system', `You are ${name}, a ${role}. You just arrived in the world.`);
    return agent;
  }

  remove(name: string): boolean {
    const a = this.agents.get(name.toLowerCase());
    if (!a) return false;
    a.stop();
    this.agents.delete(name.toLowerCase());
    this.game.leave(a.player);
    return true;
  }

  get(name: string) {
    return this.agents.get(name.toLowerCase());
  }

  /** Pathfinding searches allowed per server tick (shared by all agents). */
  pathBudget = 3;

  tick() {
    this.trackMovement();
    this.pathBudget = 3;
    // Rotate the starting agent so budget-limited work is shared fairly
    const list = [...this.agents.values()];
    const start = this.game.tick % Math.max(1, list.length);
    for (let i = 0; i < list.length; i++) {
      const a = list[(start + i) % list.length];
      if (a.player) a.tick();
    }
  }

  persistent(_p: Player) {
    return true;
  }

  onBlockBroken(p: Player, x: number, y: number, z: number, s: number) {
    const mm = this.m(p.name);
    if (mm) mm.mined[BLOCKS[s & 0xff].name] = (mm.mined[BLOCKS[s & 0xff].name] ?? 0) + 1;
    this.get(p.name)?.pushEvent('broke', `broke ${BLOCKS[s & 0xff].name} at ${x},${y},${z}`, { block: BLOCKS[s & 0xff].name, x, y, z });
  }
  onCrafted(p: Player, s: ItemStack) {
    const mm = this.m(p.name);
    if (mm) mm.crafted[itemDef(s.id).name] = (mm.crafted[itemDef(s.id).name] ?? 0) + s.count;
    this.obtained(p, itemDef(s.id).name);
    this.get(p.name)?.pushEvent('crafted', `crafted ${s.count}x ${itemDef(s.id).name}`, { item: itemDef(s.id).name, count: s.count });
  }
  onItemPickup(p: Player, s: ItemStack) {
    this.obtained(p, itemDef(s.id).name);
    this.get(p.name)?.pushEvent('pickup', `picked up ${s.count}x ${itemDef(s.id).name}`, { item: itemDef(s.id).name, count: s.count });
  }
  onMobKilled(m: Mob, killer: Entity | null) {
    if (killer instanceof Player) {
      const mm = this.m(killer.name);
      if (mm) mm.kills[m.kind] = (mm.kills[m.kind] ?? 0) + 1;
    }
    if (killer instanceof Player) this.get(killer.name)?.pushEvent('killed', `killed a ${m.kind}`, { kind: m.kind });
  }
  onPlayerDied(p: Player) {
    const mm = this.m(p.name);
    if (mm) mm.deaths++;
    this.get(p.name)?.pushEvent('death', 'you died and dropped your items');
  }

  /** `/agent` chat command for humans in-game. */
  command(p: Player, args: string[]): string {
    const [sub, name, ...rest] = args;
    try {
      switch (sub) {
        case 'spawn': {
          const brain = rest[1] ?? 'worker';
          const a = this.spawn(name ?? `Agent${this.agents.size + 1}`, rest[0] ?? 'villager', brain === 'none' ? null : brain, { x: p.x + 2, y: p.y, z: p.z });
          return `Spawned agent ${a.player.name} (${a.role}, brain: ${brain})`;
        }
        case 'remove':
          return this.remove(name ?? '') ? `Removed ${name}` : 'No such agent';
        case 'list':
          return this.agents.size ? [...this.agents.values()].map((a) => `${a.player.name} (${a.role}${a.current ? `, doing ${a.current.status.type}` : ''})`).join(', ') : 'No agents';
        case 'do': {
          const a = this.get(name ?? '');
          if (!a) return 'No such agent';
          const [action, ...kv] = rest;
          const argsObj: Record<string, unknown> = {};
          for (const pair of kv) {
            const [k, v] = pair.split('=');
            argsObj[k] = v !== undefined && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === '~' ? undefined : v;
          }
          if (argsObj.player === '@me') argsObj.player = p.name;
          const st = a.enqueue(action, argsObj);
          return `Queued ${action} #${st.id} for ${a.player.name}`;
        }
        case 'stop': {
          const a = this.get(name ?? '');
          if (!a) return 'No such agent';
          a.stop();
          return `${a.player.name} stopped`;
        }
        default:
          return 'Usage: /agent spawn <name> [role] [brain] | remove <name> | list | do <name> <action> k=v ... | stop <name>';
      }
    } catch (e) {
      return `Error: ${(e as Error).message}`;
    }
  }

  async handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'agents', name, ...]
    if (parts[1] === 'skills') {
      sendJson(res, 200, Object.fromEntries(Object.entries(SKILLS).map(([k, v]) => [k, v.doc])));
      return true;
    }
    if (parts[1] === 'metrics') {
      sendJson(res, 200, this.metricsReport());
      return true;
    }
    if (parts[1] === 'recipes') {
      const item = url.searchParams.get('item');
      sendJson(res, 200, item ? RECIPES.filter((r) => r.result.item === item) : RECIPES);
      return true;
    }
    if (parts[1] === 'village') {
      if (req.method === 'POST' && !parts[2]) {
        const body = await readJson(req);
        const name = String(body.name ?? '').trim();
        if (!name) return sendJson(res, 400, { error: 'name is required' }), true;
        sendJson(res, 200, this.villages.ensure(name, typeof body.objective === 'string' ? body.objective : ''));
        return true;
      }
      if (!parts[2]) return sendJson(res, 200, [...this.villages.villages.values()]), true;
      const v = this.villages.get(decodeURIComponent(parts[2]));
      if (v && parts[3] === 'designs' && req.method === 'POST') {
        const { design, errors, fixes } = validateDesign(await readJson(req), 'api');
        if (!design) return sendJson(res, 400, { errors }), true;
        v.designs[design.name] = design;
        this.villages.note(v, `design "${design.name}" added through the API`);
        sendJson(res, 200, { ok: true, name: design.name, fixes });
        return true;
      }
      sendJson(res, v ? 200 : 404, v ?? { error: 'no such village' });
      return true;
    }
    if (parts[1] === 'block') {
      const c = ['x', 'y', 'z'].map((k) => Math.floor(Number(url.searchParams.get(k))));
      if (c.some((v) => !isFinite(v))) return sendJson(res, 400, { error: 'x, y and z are required' }), true;
      if (!this.game.world.isLoaded(c[0], c[2])) return sendJson(res, 200, { x: c[0], y: c[1], z: c[2], loaded: false }), true;
      const st = this.game.world.getBlock(c[0], c[1], c[2]);
      sendJson(res, 200, { x: c[0], y: c[1], z: c[2], block: BLOCKS[st & 0xff].name, meta: st >> 8 });
      return true;
    }
    if (parts[1] === 'chat' && req.method === 'POST') {
      const body = await readJson(req);
      this.game.systemMessage(String(body.text ?? ''), '#55ffff');
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (parts[1] !== 'agents') return false;
    const name = parts[2];
    if (!name) {
      if (req.method === 'GET') {
        sendJson(res, 200, [...this.agents.values()].map((a) => ({ name: a.player.name, role: a.role, brain: a.brain?.name ?? null, position: { x: a.player.x, y: a.player.y, z: a.player.z }, action: a.current?.status ?? null })));
        return true;
      }
      if (req.method === 'POST') {
        const body = await readJson(req);
        if (this.get(String(body.name ?? ''))) {
          sendJson(res, 409, { error: 'agent already exists' });
          return true;
        }
        const a = this.spawn(String(body.name ?? ''), String(body.role ?? 'villager'), body.brain ?? null, body.position);
        // Initial memory is set before the brain's first tick (e.g. a per-agent model for the tiered brain).
        if (body.memory && typeof body.memory === 'object') Object.assign(a.memory, body.memory);
        if (typeof a.memory.village === 'string' && a.memory.village) this.villages.ensure(a.memory.village);
        if (body.gamemode === 'creative' || body.gamemode === 'survival') a.player.setGamemode(body.gamemode);
        sendJson(res, 201, { name: a.player.name, id: a.player.id });
        return true;
      }
    }
    const a = this.get(name ?? '');
    if (!a) {
      sendJson(res, 404, { error: `agent ${name} not found` });
      return true;
    }
    const sub = parts[3];
    if (!sub && req.method === 'DELETE') {
      this.remove(name);
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (sub === 'observe' || (!sub && req.method === 'GET')) {
      const r = Number(url.searchParams.get('radius') ?? 16);
      sendJson(res, 200, a.observe(Math.max(4, Math.min(32, r))));
      return true;
    }
    if (sub === 'act' && req.method === 'POST') {
      const body = await readJson(req);
      const list = Array.isArray(body) ? body : [body];
      const out = [];
      for (const b of list) {
        const { action, replace, ...args } = b;
        out.push(a.enqueue(String(action), args, !!replace));
      }
      sendJson(res, 200, Array.isArray(body) ? out : out[0]);
      return true;
    }
    if (sub === 'stop' && req.method === 'POST') {
      a.stop();
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (sub === 'events') {
      const since = Number(url.searchParams.get('since') ?? 0);
      sendJson(res, 200, a.events.filter((e) => e.id > since));
      return true;
    }
    if (sub === 'actions') {
      sendJson(res, 200, { current: a.current?.status ?? null, queued: a.queue.map((q) => q.status), history: a.history.slice(-30) });
      return true;
    }
    if (sub === 'memory') {
      if (req.method === 'POST') Object.assign(a.memory, await readJson(req));
      sendJson(res, 200, a.memory);
      return true;
    }
    sendJson(res, 404, { error: 'unknown endpoint' });
    return true;
  }
}

export { standable };
