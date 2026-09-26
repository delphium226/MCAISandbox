/**
 * An agent in real Minecraft: a Mineflayer bot with a skill queue, an event stream and memory, implementing WorldAgent
 * so the same brains run here as in the sandbox. Skills (mcSkills.ts) are async functions that stop when their
 * AbortSignal fires; the queue runs them one at a time, like the sandbox's.
 */
import mineflayer, { type Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { ActionStatus, AgentBrain, AgentEvent, Observation, WorldAgent } from '../world';
import type { Village } from '../village';
import type { MineflayerWorld } from './mcWorld';
import { MC_SKILLS } from './mcSkills';

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

interface Running {
  status: ActionStatus;
  abort: AbortController;
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
    this.listen();
  }

  get gamemode() {
    return this.bot.game?.gameMode ?? 'survival';
  }

  village(): Village | undefined {
    return this.world.villages.get(this.memory.village);
  }

  idle() {
    return !this.current && this.queue.length === 0;
  }

  /** Pathfinder movement rules for this bot (dig natural blocks only, no parkour). */
  moves() {
    if (!this.movements) {
      const m = new Movements(this.bot);
      m.allowParkour = false;
      m.blocksCantBreak = new Set(this.world.registry.blocksArray.filter((b) => !NATURAL.test(b.name)).map((b) => b.id));
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
    bot.on('health', () => {
      if (bot.health < this.lastHealth) this.pushEvent('damage', `took ${Math.round(this.lastHealth - bot.health)} damage (health ${Math.round(bot.health)})`);
      this.lastHealth = bot.health;
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
    if (this.current || !this.queue.length) return;
    const status = this.queue.shift()!;
    const run: Running = { status, abort: new AbortController() };
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

  private finish(run: Running, r: { done: string } | { fail: string }) {
    if (this.current !== run) return; // cancelled
    const st = run.status;
    run.abort.abort();
    if ('done' in r) {
      st.state = 'done';
      if (r.done) st.message = r.done;
      this.pushEvent('action_done', `${st.type} finished${r.done ? `: ${r.done}` : ''}`, { action: st.id, type: st.type });
    } else {
      st.state = 'failed';
      st.message = r.fail;
      this.pushEvent('action_failed', `${st.type} failed: ${r.fail}`, { action: st.id, type: st.type, args: st.args, message: r.fail });
    }
    this.history.push(st);
    if (this.history.length > 100) this.history.shift();
    this.current = null;
    this.halt();
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
