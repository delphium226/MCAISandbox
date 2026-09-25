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
import { findPath, PathNode, standable } from '../../shared/src/pathfinding';
import { stepPlayer, MoveInput, raycast } from '../../shared/src/physics';
import { breakTicks, canHarvest } from '../../shared/src/mining';
import { RECIPES, Recipe, TAGS, SMELTING, fuelValue } from '../../shared/src/recipes';
import { countItem, removeItem } from '../../shared/src/inventory';
import { DAY_LENGTH, FACE_DIRS, PLAYER_EYE_HEIGHT } from '../../shared/src/constants';
import { readJson, sendJson } from './api';
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

type SkillResult = 'running' | 'done' | { fail: string };

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
  constructor(public agent: Agent, public goal: PathNode, public range: number) {}

  /** Returns true when within range; 'fail' if unreachable. */
  step(): boolean | 'fail' {
    const p = this.agent.player;
    const b = p.body;
    const d = Math.hypot(b.x - (this.goal.x + 0.5), b.y - this.goal.y, b.z - (this.goal.z + 0.5));
    if (d <= this.range + 0.3) {
      this.agent.input.forward = 0;
      return true;
    }
    if (!this.path || this.idx >= this.path.length) {
      if (this.replans++ > 6) return 'fail';
      this.path = findPath(this.agent.game.world, { x: b.x, y: b.y + 0.01, z: b.z }, this.goal, this.range, 6000);
      this.idx = 1;
      if (!this.path) return 'fail';
      if (this.path.length <= 1) {
        // Already at the closest reachable spot
        this.agent.input.forward = 0;
        return d <= this.range + 1.5 ? true : 'fail';
      }
    }
    const wp = this.path[this.idx];
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
    } else if (typeof r === 'object') {
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
  tableNav: Navigator | null = null;
  tick(): SkillResult {
    if (++this.ticks > 20 * 60) return { fail: 'timed out' };
    const name = str(this.args.item, 'item');
    const count = this.args.count !== undefined ? num(this.args.count, 'count') : 1;
    const recipes = RECIPES.filter((r) => r.result.item === name);
    if (!recipes.length) return { fail: `no recipe for ${name}` };
    const inv = this.player.inventory;
    // Choose the first recipe we have ingredients for
    const recipe = recipes.find((r) => this.agent.canAfford(r));
    if (!recipe) return { fail: `missing ingredients for ${name}: needs ${describeRecipe(recipes[0])}` };
    const needsTable = recipe.kind === 'shaped' && (recipe.pattern.length > 2 || recipe.pattern.some((row) => row.length > 2));
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
    // Consume ingredients & produce
    this.agent.consumeRecipe(recipe);
    this.player.giveOrDrop({ id: itemId(recipe.result.item), count: recipe.result.count });
    this.game.onCrafted(this.player, { id: itemId(recipe.result.item), count: recipe.result.count });
    this.crafted += recipe.result.count;
    this.game.broadcastNear(this.player, { t: 'anim', id: this.player.id, a: 'swing' });
    return this.crafted >= count ? 'done' : 'running';
  }
}

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
      const tx = Math.floor(this.player.x + Math.sin(ang) * dist), tz = Math.floor(this.player.z + Math.cos(ang) * dist);
      const ty = this.game.world.getHeight(tx, tz) + 1;
      if (ty <= 0) return { fail: 'target area not loaded' };
      this.nav = new Navigator(this.agent, { x: tx, y: ty, z: tz }, 3);
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
        if (r === 'done') {
          st.state = 'done';
          this.pushEvent('action_done', `${st.type} finished`, { action: st.id, type: st.type });
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
    const r = radius;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const x = px + dx, z = pz + dz;
        const c = w.getChunk(x >> 4, z >> 4);
        if (!c) continue;
        const top = Math.min(255, Math.max(py + 24, c.heightmap[(x & 15) | ((z & 15) << 4)]));
        for (let y = Math.max(1, py - 24); y <= top; y++) {
          const id = c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)] & 0xff;
          if (!match(id)) continue;
          const d = dx * dx + dz * dz + (y - py) * (y - py) * 1.5;
          if (d < bd && !(exclude && exclude.has(`${x},${y},${z}`))) {
            bd = d;
            best = [x, y, z];
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
      biome: c ? String(c.biomes[(px & 15) | ((pz & 15) << 4)]) : 'unknown',
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

export class AgentManager {
  agents = new Map<string, Agent>();

  constructor(public game: Game) {
    game.chatListeners.push(() => {});
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

  tick() {
    for (const a of this.agents.values()) if (a.player) a.tick();
  }

  persistent(_p: Player) {
    return true;
  }

  onBlockBroken(p: Player, x: number, y: number, z: number, s: number) {
    this.get(p.name)?.pushEvent('broke', `broke ${BLOCKS[s & 0xff].name} at ${x},${y},${z}`, { block: BLOCKS[s & 0xff].name, x, y, z });
  }
  onCrafted(p: Player, s: ItemStack) {
    this.get(p.name)?.pushEvent('crafted', `crafted ${s.count}x ${itemDef(s.id).name}`, { item: itemDef(s.id).name, count: s.count });
  }
  onItemPickup(p: Player, s: ItemStack) {
    this.get(p.name)?.pushEvent('pickup', `picked up ${s.count}x ${itemDef(s.id).name}`, { item: itemDef(s.id).name, count: s.count });
  }
  onMobKilled(m: Mob, killer: Entity | null) {
    if (killer instanceof Player) this.get(killer.name)?.pushEvent('killed', `killed a ${m.kind}`, { kind: m.kind });
  }
  onPlayerDied(p: Player) {
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
    if (parts[1] === 'recipes') {
      const item = url.searchParams.get('item');
      sendJson(res, 200, item ? RECIPES.filter((r) => r.result.item === item) : RECIPES);
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
          sendJson(res, 409, { error:  });
          return true;
        }
        const a = this.spawn(String(body.name ?? ''), String(body.role ?? 'villager'), body.brain ?? null, body.position);
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
