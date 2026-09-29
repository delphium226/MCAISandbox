/**
 * An agent in real Minecraft: a Mineflayer bot with a skill queue, an event stream and memory, implementing WorldAgent
 * so the same brains run here as in the sandbox. Skills (mcSkills.ts) are async functions that stop when their
 * AbortSignal fires; the queue runs them one at a time, like the sandbox's.
 */
import mineflayer, { type Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { ActionStatus, AgentBrain, AgentEvent, MapView, Observation, WorldAgent } from '../world';
import { makeMapView } from '../world';
import type { Village } from '../village';
import type { MineflayerWorld } from './mcWorld';
import { MC_SKILLS } from './mcSkills';
import { attack } from './mcSurvival';
import { at, goals, walk } from './mcUtil';
import { rescue } from './mcRescue';

const { pathfinder, Movements } = pathfinderPkg;

let nextEventId = 1;
let nextActionId = 1;

/** Blocks the pathfinder may dig through to get somewhere: natural terrain only, never anything built. */
const NATURAL = /^(dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|clay|gravel|sand|red_sand|snow|snow_block|stone|deepslate|tuff|andesite|diorite|granite|calcite|netherrack|moss_block|short_grass|tall_grass|fern|large_fern|dead_bush|.*_leaves|.*_ore)$/;

/**
 * Mineflayer's physics uses a player half-width of exactly 0.3, the server 0.6f / 2 (a hair wider). Pressed against a
 * wall, the bot then stands where the server's box overlaps the block, and the server rejects every move from there
 * (teleporting the bot back each tick), so it is stuck for good. A slightly wider client box avoids it.
 */
const PLAYER_HALF_WIDTH = 0.3001;

/**
 * Failure messages of skills that could not get somewhere (collect's and explore's too, which quote the walk's), a walk
 * that ran out of time included (Accept17's mayor timed out twice at its spawn and was never rescued). Counted only when
 * the action got nowhere: a gatherer next to a tall tree, after a long walk, was "rescued" before that check.
 */
const MOVE_FAILED = /stuck at|no path|timed out at/;

/** Mobs the self-defence reflex fights (creepers are fled from instead). */
const HOSTILE = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged', 'spider', 'cave_spider', 'witch', 'pillager', 'vindicator', 'slime', 'silverfish', 'phantom', 'creaking']);

interface Running {
  status: ActionStatus;
  abort: AbortController;
  /** Where the bot was when the action started (a failed walk that got somewhere is not being stuck). */
  from?: Vec3;
}

export class BotAgent implements WorldAgent {
  readonly bot: Bot;
  memory: Record<string, unknown> = {};
  events: AgentEvent[] = [];
  queue: ActionStatus[] = [];
  current: Running | null = null;
  history: ActionStatus[] = [];
  brain: AgentBrain | null = null;
  /** Resolves once the bot has spawned in the world. */
  readonly ready: Promise<void>;
  private lastHealth = 20;
  private movements: InstanceType<typeof Movements> | null = null;
  /** The self-defence reflex, while it runs: it pauses the queue. */
  private reflex: AbortController | null = null;
  /** Where recent moves failed (a rescue starts when they keep failing from one spot). */
  private moveFails: Array<{ p: Vec3; t: number }> = [];
  private lastHurt = 0;

  constructor(readonly world: MineflayerWorld, readonly name: string, readonly role: string) {
    this.bot = mineflayer.createBot({ host: world.host, port: world.port, username: name, version: world.version, auth: 'offline' });
    this.bot.loadPlugin(pathfinder);
    this.ready = new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error(`${name} did not spawn within 30 s`)), 30000);
      // Ready once the chunks around the bot have arrived, so the first skills see the terrain
      this.bot.once('spawn', () => {
        this.bot.waitForChunksToLoad().then(() => {
          clearTimeout(t);
          ok();
        }, fail);
      });
      this.bot.once('kicked', (r) => fail(new Error(`${name} was kicked: ${typeof r === 'string' ? r : JSON.stringify(r)}`)));
      this.bot.once('error', (e) => fail(e));
    });
    this.bot.once('spawn', () => {
      (this.bot.physics as unknown as { playerHalfWidth: number }).playerHalfWidth = PLAYER_HALF_WIDTH;
      this.lastHealth = this.bot.health ?? 20;
    });
    // The shared atlas: every chunk this bot receives is summarised, and chunks whose blocks change are again later
    this.bot.on('chunkColumnLoad', (p) => world.atlas.loaded(p.x >> 4, p.z >> 4));
    this.bot.on('blockUpdate', (_old, b) => b && world.atlas.touched(b.position.x, b.position.z));
    this.listen();
  }

  get gamemode() {
    return this.bot.game?.gameMode ?? 'survival';
  }

  village(): Village | undefined {
    return this.world.villages.get(this.memory.village);
  }

  idle() {
    return !this.current && this.queue.length === 0 && !this.reflex;
  }

  /** The top block of every column around the bot (trees and water included), for the control panel's map. */
  mapAround(radius: number): MapView {
    const bot = this.bot;
    const reg = this.world.registry;
    const p = bot.entity.position;
    const py = Math.floor(p.y);
    const v = new Vec3(0, 0, 0);
    return makeMapView(Math.floor(p.x), Math.floor(p.z), radius, (x, z) => {
      for (let y = py + 16; y > py - 40; y--) {
        const id = bot.world.getBlockStateId(v.set(x, y, z)) as number | undefined;
        if (id === undefined) return null; // not loaded
        const name = reg.blocksByStateId[id]?.name;
        if (name && name !== 'air' && name !== 'cave_air' && name !== 'void_air') return [name, y];
      }
      return null;
    });
  }

  private protectedCache: { at: number; boxes: Array<{ x1: number; z1: number; x2: number; z2: number; y: number }> } = { at: 0, boxes: [] };

  /**
   * Village ground the pathfinder may not dig into, near this bot (every village's, refreshed every 5 s): plots, laid-out
   * plots and prepare_site's 2-block margin from 4 blocks under the level up; buildings and a block around them from
   * their floor up.
   */
  protectedGround() {
    const now = Date.now();
    if (now - this.protectedCache.at < 5000) return this.protectedCache.boxes;
    const p = this.bot.entity?.position;
    const boxes: Array<{ x1: number; z1: number; x2: number; z2: number; y: number }> = [];
    for (const v of this.world.villages.villages.values()) {
      const level = (a: { x1: number; z1: number; x2: number; z2: number }) => v.plots.find((q) => q.x1 <= a.x2 && q.x2 >= a.x1 && q.z1 <= a.z2 && q.z2 >= a.z1)?.y;
      for (const q of v.plots) boxes.push({ x1: q.x1 - 2, z1: q.z1 - 2, x2: q.x2 + 2, z2: q.z2 + 2, y: q.y - 4 });
      // A laid-out plot at the level of the prepared plot over it (before it is prepared its level is not known)
      for (const l of v.layouts ?? []) {
        const y = level(l);
        if (y !== undefined) boxes.push({ x1: l.x1 - 2, z1: l.z1 - 2, x2: l.x2 + 2, z2: l.z2 + 2, y: y - 4 });
      }
      for (const s of v.structures) boxes.push({ x1: s.x1 - 1, z1: s.z1 - 1, x2: s.x2 + 1, z2: s.z2 + 1, y: s.y - 1 });
    }
    const near = p ? boxes.filter((q) => Math.max(q.x1 - p.x, p.x - q.x2, q.z1 - p.z, p.z - q.z2) < 160) : boxes;
    this.protectedCache = { at: now, boxes: near };
    return near;
  }

  /** Pathfinder movement rules for this bot (dig natural blocks only, no parkour, scaffold with dirt). */
  moves() {
    if (!this.movements) {
      const m = new Movements(this.bot);
      // All bots share this process: with four of them, 5 s (the default) ran out on paths 15 blocks long (set here:
      // the plugin is not attached yet when it is loaded)
      this.bot.pathfinder.thinkTimeout = 15000;
      // ...but at most 15 ms of searching per tick each (40 by default: four bots searching at once starved the event
      // loop, and the API stopped answering)
      this.bot.pathfinder.tickTimeout = 15;
      m.allowParkour = false;
      m.blocksCantBreak = new Set(this.world.registry.blocksArray.filter((b) => !NATURAL.test(b.name)).map((b) => b.id));
      // Pillar and bridge with dirt only: the default also spends cobblestone, a building material in the village economy
      m.scafoldingBlocks = [this.world.registry.itemsByName.dirt.id];
      // Doors open (off by default in the pathfinder, "probably due to non-Paper servers"; this is Paper): a builder
      // left inside a finished cottage had no path out
      m.canOpenDoors = true;
      // Never dig into any village's ground on the way somewhere: a cobblestone gatherer standing on a prepared plot dug
      // a shaft from its surface to the stone 5 blocks under it, beside the storage hut (Hutvale1, 2026-09-29)
      (m as unknown as { exclusionAreasBreak: Array<(b: { position: { x: number; y: number; z: number } }) => number> }).exclusionAreasBreak = [
        (b) => (this.protectedGround().some((q) => b.position.x >= q.x1 && b.position.x <= q.x2 && b.position.z >= q.z1 && b.position.z <= q.z2 && b.position.y >= q.y) ? 100 : 0),
      ];
      // Around water rather than through it: a gatherer that walked into a lake stayed stuck in it for ten minutes
      (m as unknown as { liquidCost: number }).liquidCost = 20; // (missing from the typings)
      // Diagonal steps only with both sides clear: the pathfinder allows one side blocked, and a bot cutting past that
      // corner catches on it and wiggles in place until the walk watchdog calls it stuck
      const diagonal = m.getMoveDiagonal.bind(m);
      m.getMoveDiagonal = (node, dir, neighbors) => {
        // The typings say Vec3; the pathfinder passes its path node (which has x, y, z)
        const block = (dx: number, dy: number, dz: number) => m.getBlock(node as unknown as Parameters<typeof m.getBlock>[0], dx, dy, dz);
        const y = block(dir.x, 0, dir.z).physical ? 1 : 0;
        for (const [dx, dz] of [[0, dir.z], [dir.x, 0]]) if (block(dx, y, dz).physical || block(dx, y + 1, dz).physical) return;
        diagonal(node, dir, neighbors);
      };
      this.movements = m;
    }
    return this.movements;
  }

  pushEvent(type: AgentEvent['type'], text: string, data?: Record<string, unknown>) {
    this.events.push({ id: nextEventId++, tick: this.world.ticks, type, text, data });
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    this.brain?.onEvent?.(this, this.events[this.events.length - 1]);
  }

  private listen() {
    const bot = this.bot;
    bot.on('chat', (from, text) => {
      if (from === this.name) return;
      const speaker = bot.players[from]?.entity;
      const distance = speaker ? Math.round(speaker.position.distanceTo(bot.entity.position)) : undefined;
      this.pushEvent('chat', `<${from}> ${text}`, { from, text, ...(distance !== undefined ? { distance } : {}) });
    });
    bot.on('entityHurt', (e) => {
      if (e === bot.entity) this.lastHurt = Date.now();
    });
    bot.on('health', () => {
      if (bot.health < this.lastHealth) this.pushEvent('damage', `took ${Math.round(this.lastHealth - bot.health)} damage (health ${Math.round(bot.health)})`);
      this.lastHealth = bot.health;
    });
    bot.on('playerCollect', (collector, collected) => {
      if (collector !== bot.entity) return;
      const it = collected.getDroppedItem?.();
      if (it) this.pushEvent('pickup', `picked up ${it.count}x ${it.name}`, { item: it.name, count: it.count });
    });
    bot.on('death', () => {
      this.stop();
      this.pushEvent('death', 'you died and dropped your items');
    });
    bot.on('kicked', (reason) => this.pushEvent('system', `kicked from the server: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`));
    bot.on('end', (reason) => this.pushEvent('system', `disconnected: ${reason}`));
  }

  enqueue(type: string, args: Record<string, unknown>, replace = false): ActionStatus {
    const spec = MC_SKILLS[type];
    if (!spec) throw new Error(`unknown action '${type}'. Available: ${Object.keys(MC_SKILLS).join(', ')}`);
    spec.check?.(args); // throws on bad arguments
    const status: ActionStatus = { id: nextActionId++, type, args, state: 'queued' };
    if (replace) this.stop();
    this.queue.push(status);
    return status;
  }

  stop() {
    this.reflex?.abort();
    this.reflex = null;
    if (this.current) {
      this.current.abort.abort();
      this.current.status.state = 'failed';
      this.current.status.message = 'cancelled';
      this.history.push(this.current.status);
      this.current = null;
    }
    for (const q of this.queue) {
      q.state = 'failed';
      q.message = 'cancelled';
    }
    this.queue = [];
    this.halt();
  }

  /** Stop moving and digging. */
  halt() {
    this.bot.pathfinder?.stop();
    this.bot.clearControlStates();
    if (this.bot.targetDigBlock) this.bot.stopDigging();
  }

  tick() {
    if (!this.bot.entity) return;
    this.brain?.tick?.(this);
    this.selfDefence();
    if (this.reflex || this.current || !this.queue.length) return;
    const status = this.queue.shift()!;
    const run: Running = { status, abort: new AbortController(), from: this.bot.entity.position.clone() };
    this.current = run;
    status.state = 'running';
    status.startedTick = this.world.ticks;
    MC_SKILLS[status.type]
      .run(this, status.args, run.abort.signal)
      .then(
        (msg) => this.finish(run, { done: msg ?? '' }),
        (err: unknown) => this.finish(run, { fail: (err as Error).message }),
      );
  }

  /**
   * A reflex, like a player's: when a hostile mob that just hurt the bot is close, stop what it is doing and fight back
   * (or back away from a creeper), then resume the interrupted action. The brain only hears about it afterwards: an
   * LLM turn takes seconds, and a zombie kills in about ten.
   */
  private selfDefence() {
    const bot = this.bot;
    if (this.reflex || this.gamemode === 'creative' || (bot.health ?? 20) <= 0) return;
    const p = bot.entity.position;
    const near = Object.values(bot.entities)
      .filter((e) => e.name && (HOSTILE.has(e.name) || e.name === 'creeper') && e.position.distanceTo(p) < 5)
      .sort((u, v) => u.position.distanceTo(p) - v.position.distanceTo(p));
    const mob = near[0];
    if (!mob || !(Date.now() - this.lastHurt < 3000 || (mob.name === 'creeper' && mob.position.distanceTo(p) < 4))) return;
    // Put the interrupted action back at the front of the queue (its run is cancelled and ignored)
    if (this.current) {
      const st = this.current.status;
      this.current.abort.abort();
      this.current = null;
      st.state = 'queued';
      this.queue.unshift(st);
    }
    this.halt();
    const ac = new AbortController();
    this.reflex = ac;
    const what = mob.name!;
    // Bare fists lose to a zombie (1 damage a hit against 20 health): without a weapon, or badly hurt, run instead
    const armed = bot.inventory.items().some((it) => /_(sword|axe)$/.test(it.name));
    const flee = what === 'creeper' || !armed || (bot.health ?? 20) <= 6;
    const why = what === 'creeper' ? 'creepers explode' : !armed ? 'no weapon: craft a wooden_sword or stone_sword to fight back' : 'health is low';
    const act = flee
      ? walk(this, new goals.GoalInvert(new goals.GoalFollow(mob, 16)), `away from the ${what}`, ac.signal, 10000).then(
          () => `ran away (${why})`,
          (e: Error) => {
            if (e.message === 'cancelled') throw e;
            return `tried to run away (${why}) but ${e.message}`;
          },
        )
      : attack(this, { id: mob.id }, ac.signal);
    act.then(
      (msg) => this.pushEvent('system', `Reflex: a ${what} attacked you; ${msg}. Resuming your action.`),
      (err: Error) => err.message !== 'cancelled' && this.pushEvent('system', `Reflex: a ${what} attacked you; ${err.message}`),
    ).finally(() => {
      if (this.reflex === ac) this.reflex = null;
      this.halt();
    });
  }

  private finish(run: Running, r: { done: string } | { fail: string }) {
    if (this.current !== run) return; // cancelled
    const st = run.status;
    run.abort.abort();
    if ('done' in r) {
      st.state = 'done';
      if (r.done) st.message = r.done;
      this.pushEvent('action_done', `${st.type} finished${r.done ? `: ${r.done}` : ''}`, { action: st.id, type: st.type, args: st.args });
    } else {
      st.state = 'failed';
      st.message = r.fail;
      this.pushEvent('action_failed', `${st.type} failed: ${r.fail}`, { action: st.id, type: st.type, args: st.args, message: r.fail });
    }
    this.history.push(st);
    if (this.history.length > 100) this.history.shift();
    this.current = null;
    this.halt();
    // Stuck means the failed action got nowhere: a gatherer that walked 25 blocks to a tall tree and could not reach its
    // top logs was "rescued"
    if ('fail' in r && MOVE_FAILED.test(r.fail) && (!run.from || run.from.distanceTo(this.bot.entity.position) < 4)) this.movedFailed();
  }

  /**
   * A move failed. Two within 3 blocks of here in 6 minutes means stuck (a pit, a lake): get out before the next action
   * (mcRescue.ts), in the reflex's slot so nothing else starts meanwhile, and tell the brain what happened.
   */
  private movedFailed() {
    const p = this.bot.entity.position.clone();
    const now = Date.now();
    this.moveFails = [...this.moveFails.filter((f) => now - f.t < 6 * 60000 && f.p.distanceTo(p) < 3), { p, t: now }];
    if (this.moveFails.length < 2 || this.reflex || this.gamemode === 'creative') return;
    this.moveFails = [];
    const ac = new AbortController();
    this.reflex = ac;
    const stats = ((this.memory.rescues ??= {}) as Record<string, number | string>);
    rescue(this, ac.signal).then(
      (r) => {
        stats[r.how] = Number(stats[r.how] ?? 0) + 1;
        stats.last = `${new Date().toISOString().slice(11, 19)} ${r.how}: ${r.text}`;
        console.log(`[rescue] ${this.name} stuck at ${at(p)}: ${r.how}: ${r.text}`);
        this.pushEvent('system', `Rescue: your moves kept failing at ${at(p)} (stuck); ${r.text}. Carry on from here.`);
      },
      (e: Error) => e.message !== 'cancelled' && this.pushEvent('system', `Rescue: stuck at ${at(p)}; getting out failed: ${e.message}`),
    ).finally(() => {
      if (this.reflex === ac) this.reflex = null;
      this.halt();
    });
  }

  observe(radius = 16): Observation {
    const bot = this.bot;
    const reg = this.world.registry;
    const p = bot.entity.position;
    const inventory: Record<string, number> = {};
    for (const it of bot.inventory.items()) inventory[it.name] = (inventory[it.name] ?? 0) + it.count;
    // Blocks exposed to air (visible), counted by name with the nearest of each
    const nearbyBlocks: Observation['nearbyBlocks'] = {};
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    const v = new Vec3(0, 0, 0);
    const state = (x: number, y: number, z: number) => bot.world.getBlockStateId(v.set(x, y, z)) as number | undefined;
    const clear = (id: number | undefined) => id !== undefined && !!reg.blocksByStateId[id]?.transparent;
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++)
        for (let dy = -8; dy <= 8; dy++) {
          const x = px + dx, y = py + dy, z = pz + dz;
          const id = state(x, y, z);
          if (id === undefined) continue;
          const name = reg.blocksByStateId[id]?.name;
          if (!name || name === 'air' || name === 'cave_air' || name === 'void_air') continue;
          if (!(clear(state(x + 1, y, z)) || clear(state(x - 1, y, z)) || clear(state(x, y + 1, z)) || clear(state(x, y - 1, z)) || clear(state(x, y, z + 1)) || clear(state(x, y, z - 1)))) continue;
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
    for (const e of Object.values(bot.entities)) {
      if (e === bot.entity || !e.position) continue;
      const distance = e.position.distanceTo(p);
      if (distance > 32) continue;
      const kind = e.name ?? e.type ?? 'unknown';
      const item = kind === 'item' ? e.getDroppedItem?.()?.name : undefined;
      nearbyEntities.push({
        id: e.id, kind, name: e.type === 'player' ? e.username : item,
        x: round1(e.position.x), y: round1(e.position.y), z: round1(e.position.z), distance: round1(distance),
        ...(typeof e.health === 'number' ? { health: e.health } : {}),
      });
    }
    nearbyEntities.sort((a, b) => a.distance - b.distance);
    const biomeId = bot.world.getBiome?.(p.floored()) as number | undefined;
    const slots = bot.inventory.slots;
    return {
      name: this.name,
      tick: this.world.ticks,
      timeOfDay: bot.time.timeOfDay,
      isDay: bot.time.isDay,
      position: { x: round1(p.x), y: round1(p.y), z: round1(p.z) },
      yaw: round1(bot.entity.yaw),
      health: Math.round(bot.health ?? 20),
      food: Math.round(bot.food ?? 20),
      gamemode: this.gamemode,
      dead: (bot.health ?? 20) <= 0,
      biome: (biomeId !== undefined && reg.biomes[biomeId]?.name) || 'unknown',
      holding: bot.heldItem?.name ?? null,
      inventory,
      equipment: [5, 6, 7, 8].map((i) => slots[i]?.name ?? null),
      nearbyBlocks,
      nearbyEntities: nearbyEntities.slice(0, 30),
      currentAction: this.current?.status ?? null,
      queuedActions: this.queue.length,
      recentEvents: this.events.slice(-20),
    };
  }

  quit() {
    this.stop();
    this.bot.quit();
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;
