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
import { mineAreas } from './mcMine';
import { rescue } from './mcRescue';
import { timeScale } from './mcRules';
import { WALK_DIG } from './mcBlocks';

const { pathfinder, Movements } = pathfinderPkg;

// Our Mineflayer patch (patches/mineflayer+4.39.0.patch) runs the physics clock this many times faster (T.1)
declare module 'mineflayer' {
  interface BotOptions {
    timeScale?: number;
  }
}

let nextEventId = 1;
let nextActionId = 1;

/**
 * Mineflayer's physics uses a player half-width of exactly 0.3, the server 0.6f / 2 (a hair wider). Pressed against a
 * wall, the bot then stands where the server's box overlaps the block, and the server rejects every move from there
 * (teleporting the bot back each tick), so it is stuck for good. A slightly wider client box avoids it. It must be a
 * binary fraction: with 0.3001 a bot stopped at a wall face stood at face - 0.3001, and adding 0.3001 back gave a box
 * edge 4e-16 inside the wall at some faces (z -4, ±1024: 3 faces a side in 6,001), so prismarine-physics let it press on
 * into the block and Paper refused every move into it without a word (F147, the pit of F138). 1229/4096 adds back exactly.
 */
const PLAYER_HALF_WIDTH = 1229 / 4096; // 0.300048828125

/**
 * Failure messages of skills that could not get somewhere (collect's and explore's too, which quote the walk's), a walk
 * that ran out of time included (Accept17's mayor timed out twice at its spawn and was never rescued). Counted only when
 * the action got nowhere: a gatherer next to a tall tree, after a long walk, was "rescued" before that check.
 */
const MOVE_FAILED = /stuck at|no path|timed out at/;

/** Mobs the self-defence reflex fights (creepers are fled from instead). */
const HOSTILE = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged', 'spider', 'cave_spider', 'witch', 'pillager', 'vindicator', 'slime', 'silverfish', 'phantom', 'creaking']);

/**
 * What the bot's physics did during one walk (walkOnce sets it, the physicsTick listener counts), for the `[stuck]` log
 * line: a snapshot of the controls at the stuck moment says nothing, the pathfinder clears them every 3.5 s (F145).
 * Numbers only, nothing of the bot's or the pathfinder's objects.
 */
export interface WalkTally {
  ticks: number;
  fwd: number;
  jump: number;
  sprint: number;
  ground: number;
  water: number;
  busy: number;
  /** Ticks the pathfinder had no path (F148: it idles silently on an empty path short of a goal it computed once). */
  idle: number;
  /** ...of them with no goal set, and where and when the current run of path-less ticks began. */
  noGoal: number;
  idleFrom?: { t: number; x: number; y: number; z: number };
  /** When the pathfinder last sent a path (a search still going on is not an idle path). */
  lastUpdate?: number;
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  /** Times the server put the bot back, and where (the corrected position) the last time. */
  forced: number;
  forcedAt?: { x: number; y: number; z: number };
  /**
   * The block levels the bot stood on since the last horizontal progress (the walk watchdog clears it), and when it last
   * stood on one outside them: climbing (a dirt pillar, steps out of a pit) is progress, a hop or a set-back is not.
   */
  band: [number, number] | null;
  levelAt: number;
}

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
  /** The current walk's physics tally (mcUtil walkOnce), or null. */
  walkTally: WalkTally | null = null;
  /** Where the last walk that stalled was going, from where, and when (the rescue walks out the other way first). */
  lastStall: { x: number; z: number; t: number; at: { x: number; z: number } } | null = null;
  /** The pathfinder's recent events, repeats folded into one entry (for the `[stuck]` line). */
  readonly pathEvents: Array<{ t0: number; t: number; key: string; text: string; n: number }> = [];

  constructor(readonly world: MineflayerWorld, readonly name: string, readonly role: string) {
    // At MC_TIME_SCALE 2 the bot's physics runs at the server's 40 ticks a second. Digging stays in real time: Paper
    // times block breaking by the wall clock, not by ticks, and refuses a dig finished early (T.1 review)
    this.bot = mineflayer.createBot({ host: world.host, port: world.port, username: name, version: world.version, auth: 'offline', timeScale: timeScale() });
    this.bot.loadPlugin(pathfinder);
    // A server not running at our speed (restarted at 20 while we expect 40, say) would make every walk wrong
    this.bot._client.on('set_ticking_state', (p: { tick_rate?: number }) => {
      if (p.tick_rate !== undefined && Math.abs(p.tick_rate - 20 * timeScale()) > 0.01)
        console.log(`[speed] ${name}: the server ticks ${p.tick_rate} a second, the bots ${20 * timeScale()} (MC_TIME_SCALE ${timeScale()})`);
    });
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

  private protectedCache: { at: number; boxes: Array<{ x1: number; z1: number; x2: number; z2: number; y: number; y2?: number }> } = { at: 0, boxes: [] };

  /**
   * Village ground the pathfinder may not dig into, near this bot (every village's, refreshed every 5 s): plots, laid-out
   * plots and prepare_site's 2-block margin from 4 blocks under the level up; buildings and a block around them from
   * their floor up; the mine, floor to ceiling.
   */
  protectedGround() {
    const now = Date.now();
    if (now - this.protectedCache.at < 5000) return this.protectedCache.boxes;
    const p = this.bot.entity?.position;
    const boxes: Array<{ x1: number; z1: number; x2: number; z2: number; y: number; y2?: number }> = [];
    for (const v of this.world.villages.villages.values()) {
      const level = (a: { x1: number; z1: number; x2: number; z2: number }) => v.plots.find((q) => q.x1 <= a.x2 && q.x2 >= a.x1 && q.z1 <= a.z2 && q.z2 >= a.z1)?.y;
      for (const q of v.plots) boxes.push({ x1: q.x1 - 2, z1: q.z1 - 2, x2: q.x2 + 2, z2: q.z2 + 2, y: q.y - 4 });
      // A laid-out plot at the level of the prepared plot over it (before it is prepared its level is not known)
      for (const l of v.layouts ?? []) {
        const y = level(l);
        if (y !== undefined) boxes.push({ x1: l.x1 - 2, z1: l.z1 - 2, x2: l.x2 + 2, z2: l.z2 + 2, y: y - 4 });
      }
      for (const s of v.structures) boxes.push({ x1: s.x1 - 1, z1: s.z1 - 1, x2: s.x2 + 1, z2: s.z2 + 1, y: s.y - 1 });
      // The mine, from its tunnel floor up: no shafts dug down into it from the surface, nor up out of it (V.5)
      if (v.mine) boxes.push(...mineAreas(v.mine));
    }
    const near = p ? boxes.filter((q) => Math.max(q.x1 - p.x, p.x - q.x2, q.z1 - p.z, p.z - q.z2) < 160) : boxes;
    this.protectedCache = { at: now, boxes: near };
    return near;
  }

  private farmCache: { at: number; boxes: Array<{ x1: number; z1: number; x2: number; z2: number; y: number }> } = { at: 0, boxes: [] };

  /**
   * Every village's wheat field near this bot, at its plot's level (refreshed every 5 s): farmland turns to dirt under a
   * jump or a step down onto it (walking never tramples), so walks keep off it.
   */
  farmGround() {
    const now = Date.now();
    if (now - this.farmCache.at < 5000) return this.farmCache.boxes;
    const p = this.bot.entity?.position;
    const boxes: Array<{ x1: number; z1: number; x2: number; z2: number; y: number }> = [];
    for (const v of this.world.villages.villages.values())
      for (const l of v.layouts ?? []) {
        const f = l.farm;
        const y = f && v.plots.find((q) => q.x1 <= f.x2 && q.x2 >= f.x1 && q.z1 <= f.z2 && q.z2 >= f.z1)?.y;
        if (f && y !== undefined && (!p || Math.max(f.x1 - p.x, p.x - f.x2, f.z1 - p.z, p.z - f.z2) < 160)) boxes.push({ x1: f.x1, z1: f.z1, x2: f.x2, z2: f.z2, y });
        // (and each farm slot once it holds a kind: opportunistic farming, 10-08)
        for (const q of l.slots ?? []) {
          const qy = q.kind ? v.plots.find((r) => r.x1 <= q.x2 && r.x2 >= q.x1 && r.z1 <= q.z2 && r.z2 >= q.z1)?.y : undefined;
          if (qy !== undefined && (!p || Math.max(q.x1 - p.x, p.x - q.x2, q.z1 - p.z, p.z - q.z2) < 160)) boxes.push({ x1: q.x1, z1: q.z1, x2: q.x2, z2: q.z2, y: qy });
        }
      }
    this.farmCache = { at: now, boxes };
    return boxes;
  }

  /** Pathfinder movement rules for this bot (dig natural blocks only, no parkour, scaffold with dirt). */
  moves() {
    if (!this.movements) {
      const m = new Movements(this.bot);
      // All bots share this process: with four of them, 5 s (the default) ran out on paths 15 blocks long (set here:
      // the plugin is not attached yet when it is loaded)
      this.bot.pathfinder.thinkTimeout = 15000;
      // ...but at most 15 ms of searching per tick each (40 by default: four bots searching at once starved the event
      // loop, and the API stopped answering); at 2x there are twice the ticks, so half each
      this.bot.pathfinder.tickTimeout = 15 / timeScale();
      m.allowParkour = false;
      // (walks dig natural terrain only, never anything built: WALK_DIG in mcBlocks.ts)
      m.blocksCantBreak = new Set(this.world.registry.blocksArray.filter((b) => !WALK_DIG.has(b.name)).map((b) => b.id));
      // Pillar and bridge with dirt only: the default also spends cobblestone, a building material in the village economy
      m.scafoldingBlocks = [this.world.registry.itemsByName.dirt.id];
      // Doors open (off by default in the pathfinder, "probably due to non-Paper servers"; this is Paper): a builder
      // left inside a finished cottage had no path out
      m.canOpenDoors = true;
      // ...but it opens fence gates only: a door (open or closed) is a solid block to it, so no bot ever walked into a
      // building (the storage hut's furnace was out of reach, StageH7). Open wooden doors, and the upper half of a
      // closed one, are passable; a closed lower half is "openable", which the pathfinder right-clicks open on its way
      const doors = new Set(this.world.registry.blocksArray.filter((b) => /_door$/.test(b.name) && b.name !== 'iron_door').map((b) => b.id));
      // Fence gates: the pathfinder took any gate for a full block (it is not in its fence set; an open one has no shapes)
      // and clicked closed ones open, never shutting them: a pen's gate would be left open by any walk past it (the pen
      // design's review, 10-09). An open gate is passable, a closed one a wall no walk opens
      const gates = new Set(this.world.registry.blocksArray.filter((b) => /_fence_gate$/.test(b.name)).map((b) => b.id));
      const getBlock = m.getBlock.bind(m);
      m.getBlock = (pos, dx, dy, dz) => {
        const b = getBlock(pos, dx, dy, dz) as ReturnType<typeof getBlock> & { type?: number; safe: boolean; physical: boolean; openable: boolean };
        if (b?.type !== undefined && gates.has(b.type)) {
          const p = (b as unknown as { getProperties?: () => Record<string, unknown> }).getProperties?.() ?? {};
          const open = p.open === true || p.open === 'true';
          b.safe = open;
          b.physical = !open;
          b.openable = false;
        } else if (b?.type !== undefined && doors.has(b.type)) {
          const p = (b as unknown as { getProperties?: () => Record<string, unknown> }).getProperties?.() ?? {};
          if (p.open === true || p.open === 'true' || p.half === 'upper') {
            b.safe = true;
            b.physical = false;
            b.openable = false;
          } else b.openable = true;
        }
        return b;
      };
      // The pathfinder counts opening a door as placing a block: without dirt it went to -1 blocks left and its "none
      // left" checks stopped holding
      const forward = m.getMoveForward.bind(m);
      m.getMoveForward = (node, dir, neighbors) => {
        const n = neighbors.length;
        forward(node, dir, neighbors);
        for (const mv of neighbors.slice(n) as unknown as Array<{ remainingBlocks: number; toPlace: Array<{ useOne?: boolean }> }>)
          mv.remainingBlocks += mv.toPlace.filter((t) => t.useOne).length;
      };
      // Its door click does not look whether the door is open: a second bot following a first would shut it again
      const activate = this.bot.activateBlock.bind(this.bot);
      this.bot.activateBlock = (async (block: Parameters<typeof activate>[0], ...rest: unknown[]) => {
        const p = (block as unknown as { getProperties?: () => Record<string, unknown> })?.getProperties?.() ?? {};
        if (block && doors.has(block.type) && (p.open === true || p.open === 'true')) return;
        return (activate as (...x: unknown[]) => Promise<void>)(block, ...rest);
      }) as typeof this.bot.activateBlock;
      // Never dig into any village's ground on the way somewhere: a cobblestone gatherer standing on a prepared plot dug
      // a shaft from its surface to the stone 5 blocks under it, beside the storage hut (Hutvale1, 2026-09-29)
      (m as unknown as { exclusionAreasBreak: Array<(b: { position: { x: number; y: number; z: number } }) => number> }).exclusionAreasBreak = [
        (b) => (b.position && this.protectedGround().some((q) => b.position.x >= q.x1 && b.position.x <= q.x2 && b.position.z >= q.z1 && b.position.z <= q.z2 && b.position.y >= q.y && (q.y2 === undefined || b.position.y <= q.y2)) ? 100 : 0),
      ];
      // ...nor build on it: a builder walking to its stand spot pillared up with dirt in front of the mining hut's doorway
      // and sealed the mine (Minevale19, 10-04). Placing there costs too much for any path to take it
      (m as unknown as { exclusionAreasPlace: Array<(b: { position: { x: number; y: number; z: number } }) => number> }).exclusionAreasPlace = [
        (b) => (b.position && this.protectedGround().some((q) => b.position.x >= q.x1 && b.position.x <= q.x2 && b.position.z >= q.z1 && b.position.z <= q.z2 && b.position.y >= q.y && (q.y2 === undefined || b.position.y <= q.y2 + 1)) ? 1000 : 0),
      ];
      // ...nor step onto a village's wheat field (the farm's review, 10-08): the cost is the moving body's (feet and head
      // cells, from the channel's water up to head height over the farmland), and over 100 drops the move, so no path
      // crosses it (with a mere cost, paths cut across and the pathfinder's jumps trample). A field the bot stands on is
      // let off: the cost is paid on entering each cell, and from the middle of one every way out was banned (the diff review)
      (m as unknown as { exclusionAreasStep: Array<(b: { position: { x: number; y: number; z: number } }) => number> }).exclusionAreasStep = [
        (b) => {
          // (a block in an unloaded chunk is the pathfinder's stub, with no position: reading it threw inside the
          // pathfinder's tick and took the whole agent server down on a scout's walk home, Minevale33, F188)
          if (!b.position) return 0;
          const p = this.bot.entity?.position;
          const on = (q: { x1: number; z1: number; x2: number; z2: number }, x: number, z: number) => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2;
          return this.farmGround().some((q) => on(q, b.position.x, b.position.z) && b.position.y >= q.y && b.position.y <= q.y + 2 && !(p && on(q, Math.floor(p.x), Math.floor(p.z)))) ? 1000 : 0;
        },
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
    // What the pathfinder did and what the physics made of it, for walkOnce's `[stuck]` line (F145). Registered here,
    // once: the bot object lives as long as the agent, through respawns. Numbers are copied at once (a path update's
    // result holds the A* search's closed set)
    const xyz = (p: { x: number; y: number; z: number }, d = 2) => `${p.x.toFixed(d)},${p.y.toFixed(d)},${p.z.toFixed(d)}`;
    bot.on('path_update', (r) => {
      if (this.walkTally) this.walkTally.lastUpdate = Date.now();
      const n = r.path[0] as unknown as { x: number; y: number; z: number; toBreak?: unknown[]; toPlace?: unknown[] } | undefined;
      const first = n ? ` first ${xyz(n, 1)}${n.toBreak?.length ? ` break ${n.toBreak.length}` : ''}${n.toPlace?.length ? ` place ${n.toPlace.length}` : ''}` : '';
      // (where the path ends, and whether the goal takes that end: short of it, the pathfinder stops there and idles, F148;
      // nodes from the first with a dig, a placement or a door on keep their cell's corner, not +0.5: `work`)
      const nodes = r.path as unknown as Array<{ x: number; y: number; z: number; toBreak?: unknown[]; toPlace?: Array<{ useOne?: boolean }> }>;
      const e = nodes.length > 1 ? nodes[nodes.length - 1] : undefined;
      let last = '';
      if (e) {
        let ok = '?';
        try {
          const g = bot.pathfinder.goal;
          // (floored, and the cell above as the pathfinder's own arrival test: a node on a slab or path block stands at y + 0.5)
          const f = new Vec3(e.x, e.y, e.z).floored();
          if (g) ok = [f, f.offset(0, 1, 0)].some((q) => g.isEnd(q as unknown as Parameters<typeof g.isEnd>[0])) ? 'end' : 'NOT end';
        } catch { /* (diagnostic only) */ }
        const w = nodes.findIndex((q) => q.toBreak?.length || q.toPlace?.length);
        const doors = nodes.reduce((s, q) => s + (q.toPlace?.filter((t) => t.useOne).length ?? 0), 0);
        last = ` last ${xyz(e, 1)} ${ok}${w >= 0 ? ` work ${w}` : ''}${doors ? ` doors ${doors}` : ''}`;
      }
      // (a partial search updates every tick with a growing path: one entry, the latest)
      this.pathEvent(`update ${r.status} len ${r.path.length}${first}${last}`, r.status === 'partial' ? 'update partial' : undefined);
    });
    bot.on('path_reset', (reason) => this.pathEvent(`reset ${reason}`));
    bot.on('goal_updated', () => this.pathEvent('goal'));
    bot.on('path_stop', () => this.pathEvent('stop'));
    bot.on('goal_reached', () => this.pathEvent('reached'));
    bot.on('forcedMove', () => {
      const p = bot.entity.position;
      this.pathEvent(`forced ${xyz(p)}`, 'forced');
      const t = this.walkTally;
      if (!t) return;
      t.forced++;
      t.forcedAt = { x: p.x, y: p.y, z: p.z };
    });
    bot.on('physicsTick', () => {
      const t = this.walkTally;
      if (!t) return;
      const e = bot.entity;
      const p = e.position;
      t.ticks++;
      if (bot.getControlState('forward')) t.fwd++;
      if (bot.getControlState('jump')) t.jump++;
      if (bot.getControlState('sprint')) t.sprint++;
      if ((e as unknown as { isInWater?: boolean }).isInWater) t.water++;
      if (bot.pathfinder.isMining() || bot.pathfinder.isBuilding()) t.busy++;
      if (!bot.pathfinder.isMoving()) {
        t.idle++;
        if (!bot.pathfinder.goal) t.noGoal++;
        t.idleFrom ??= { t: Date.now(), x: p.x, y: p.y, z: p.z };
      } else t.idleFrom = undefined;
      t.x0 = Math.min(t.x0, p.x); t.x1 = Math.max(t.x1, p.x);
      t.y0 = Math.min(t.y0, p.y); t.y1 = Math.max(t.y1, p.y);
      t.z0 = Math.min(t.z0, p.z); t.z1 = Math.max(t.z1, p.z);
      if (e.onGround) {
        t.ground++;
        // (+0.1: farmland and path blocks stand 15/16 high)
        const lv = Math.floor(p.y + 0.1);
        if (!t.band) t.band = [lv, lv];
        else if (lv < t.band[0] || lv > t.band[1]) {
          t.band = [Math.min(lv, t.band[0]), Math.max(lv, t.band[1])];
          t.levelAt = Date.now();
        }
      }
    });
  }

  /** Record a pathfinder event in the ring; a repeat of the last one (same key) only counts. */
  private pathEvent(text: string, key = text) {
    const now = Date.now();
    const last = this.pathEvents[this.pathEvents.length - 1];
    if (last && last.key === key) {
      last.n++;
      last.t = now;
      last.text = text;
      return;
    }
    this.pathEvents.push({ t0: now, t: now, key, text, n: 1 });
    if (this.pathEvents.length > 16) this.pathEvents.shift();
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
