/**
 * An agent in real Minecraft: a Mineflayer bot with a skill queue, an event stream and memory, implementing WorldAgent
 * so the same brains run here as in the sandbox. Skills (mcSkills.ts) are async functions that stop when their
 * AbortSignal fires; the queue runs them one at a time, like the sandbox's.
 */
import { createRequire } from 'node:module';
import mineflayer, { type Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { ActionStatus, AgentBrain, AgentEvent, MapView, Observation, WorldAgent } from '../world';
import { makeMapView } from '../world';
import type { Village } from '../village';
import { preparedAt } from '../village';
import type { MineflayerWorld } from './mcWorld';
import { MC_SKILLS } from './mcSkills';
import { attack } from './mcSurvival';
import { ContentionError, at, goals, walk, wetAt } from './mcUtil';
import { mineAreas } from './mcMine';
import { home, netherArrived, outOfWater, recallFromDim, rescue, swimUp, teleportHome } from './mcRescue';
import { timeScale } from './mcRules';
import { modeSpec, takesDamage } from '../worldMode';
import { HOSTILE, combatTick, fightsMobs, mayWake, noteDeath, phaseOf } from './mcCombat';
import { noteDeathLesson } from '../instincts';
import { spawnCellFor, survivalB } from './mcSurvivalB';
import { isWallGate } from './mcWalls';
import { buriedAt, causeFromState, deathCauseOf, hazardOf, lavaStep, noteTrap, safeCellNear, trappedUnderWater, type DeathCause, type Hazard } from './mcHazard';
import { isPaused } from '../runClock';
import { WALK_DIG } from './mcBlocks';
import { GEODE_GROWTH, GEODE_GUARD, GEODE_LINING, geodeBreakCost, geodeStepCost, stateIds } from './mcGeode';
import { dimOf, overworld, type Dim } from './mcDim';
import { farBox } from '../netherPlan';

const { pathfinder, Movements } = pathfinderPkg;
/** Blocks no walk enters (the Nether rung, spec row 16): portals carry a member to another dimension; soul fire burns. */
export const AVOID_BLOCKS = ['nether_portal', 'end_portal', 'end_gateway', 'soul_fire'];
/** The pathfinder's move (a neighbour in its search: a cell, the blocks left, a cost); not in its typings. */
const Move = createRequire(import.meta.url)('mineflayer-pathfinder/lib/move') as new (x: number, y: number, z: number, remainingBlocks: number, cost: number) => unknown;

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

/** Whether x, z lies in a box's x/z span (the pathfinder's exclusion costs, called per searched cell). */
const onBox = (q: { x1: number; z1: number; x2: number; z2: number }, x: number, z: number) => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2;

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
  /** Where the bot stood the tick before, and the ticks since it last moved with forward held (the door nudge, F250). */
  prev?: { x: number; z: number };
  still?: number;
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
  /** The first spawn has happened (#223: a death before it is a log-in while dead). */
  private spawned = false;
  history: ActionStatus[] = [];
  brain: AgentBrain | null = null;
  /** Resolves once the bot has spawned in the world. */
  readonly ready: Promise<void>;
  private lastHealth = 20;
  private movements: InstanceType<typeof Movements> | null = null;
  /** The self-defence reflex, while it runs: it pauses the queue. */
  private reflex: AbortController | null = null;
  /** The reflex runReflex started (combat, arm, curfew, eat, sleep...) and when, for the panel; null when none runs. */
  reflexNow: { what: string; at: number } | null = null;
  /** Where recent moves failed (a rescue starts when they keep failing from one spot). */
  private moveFails: Array<{ p: Vec3; t: number }> = [];
  private lastHurt = 0;
  /** Survival (a), MC_WORLD_MODE=damage and up: what hurt it last, the fall under way (its highest y) and the last one's
   *  height, the death message heard, the spawnpoint set, when the last hazard reflex ended. */
  private hurtBy: { hazard: Hazard | null; fell: number } | null = null;
  private fallFrom: number | null = null;
  private lastFall = { h: 0, t: 0 };
  private deathHeard: { cause: DeathCause; text: string; t: number } | null = null;
  private spawnSet = '';
  private spawnCheckedAt = 0;
  private hazardEnded = 0;
  /** #181: the recent swim-ups (a third within a minute and 3 blocks means trapped). */
  private airUps: Array<{ p: Vec3; t: number }> = [];
  private deathTimes: number[] = [];
  /** The current walk's physics tally (mcUtil walkOnce), or null. */
  walkTally: WalkTally | null = null;
  /** #163: blocks walked in x and z since the bot joined (the chores' walk distance), and where it stood last tick. */
  walked = 0;
  private odoAt: { x: number; z: number } | null = null;
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
      this.spawned = true;
      (this.bot.physics as unknown as { playerHalfWidth: number }).playerHalfWidth = PLAYER_HALF_WIDTH;
      this.lastHealth = this.bot.health ?? 20;
      this.dimSeen = dimOf(this.bot);
      // (the Nether rung, spec row 11: a member that logs in off the overworld, an agent server restarted mid-trip, is
      // recalled home before anything else; never spreadplayers, which would put it in the overworld at its Nether x, z)
      if (this.dimSeen !== 'overworld') void recallFromDim(this, 'logged in there (a saved position)');
      else void this.unbury();
    });
    // The shared atlas: every chunk this bot receives is summarised, and chunks whose blocks change are again later
    // (overworld bots only: a Nether chunk at the same cx, cz went into atlas.json, 317 of them in the probe, spec row 1)
    this.bot.on('chunkColumnLoad', (p) => { if (overworld(this)) world.atlas.loaded(p.x >> 4, p.z >> 4); });
    this.bot.on('blockUpdate', (_old, b) => { if (b && overworld(this)) world.atlas.touched(b.position.x, b.position.z); });
    // (the Nether rung: a dimension change ends any walk and dig the old world held, lesson 183's path; logged, told)
    // (read after the packet's other listeners: mineflayer's health plugin emits 'respawn' before the game plugin has set
    // the new dimension, and a change back went unseen, nether2 11-14)
    this.bot.on('respawn', () => {
      setImmediate(() => this.dimChanged());
    });
    this.listen();
  }

  /** A respawn seen: a dimension change ends any walk and dig the old world held; logged and told. */
  private dimChanged() {
    {
      const d = dimOf(this.bot);
      if (d === this.dimSeen) return;
      const from = this.dimSeen;
      this.dimSeen = d;
      try {
        this.bot.pathfinder?.setGoal(null);
        this.bot.stopDigging?.();
      } catch { /* (nothing running) */ }
      this.protectedCache.at = 0;
      this.farmCache.at = 0;
      netherArrived(this, from, d);
    }
  }

  get gamemode() {
    return this.bot.game?.gameMode ?? 'survival';
  }

  /** The dimension the bot is in (the Nether rung; mcDim.ts). */
  get dim(): Dim {
    return dimOf(this.bot);
  }

  /** The dimension last seen at a spawn or respawn (a change is told once). */
  private dimSeen: Dim = 'overworld';

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
    // (the Nether rung, spec row 6: village ground is the overworld's; off it, only the ground round its village's far
    // portal in that dimension, so no walk digs the way back away)
    if (!overworld(this)) {
      const far = this.village()?.nether?.far;
      this.protectedCache = { at: now, boxes: far && far.dim === this.dim ? [farBox(far)] : [] };
      return this.protectedCache.boxes;
    }
    const p = this.bot.entity?.position;
    const boxes: Array<{ x1: number; z1: number; x2: number; z2: number; y: number; y2?: number }> = [];
    for (const v of this.world.villages.villages.values()) {
      const over = (a: { x1: number; z1: number; x2: number; z2: number }) => v.plots.find((q) => q.x1 <= a.x2 && q.x2 >= a.x1 && q.z1 <= a.z2 && q.z2 >= a.z1);
      for (const q of v.plots) {
        // (a plot prepared in parts, S.6: only the parts done, each with the margin on the plot's edge; walks may dig the
        // rest, which is levelled anyway: a whole layout closed to digging stalled walks through unprepared woods, F154)
        if (q.parts) for (const r of q.parts) boxes.push({ x1: r.x1 - (r.x1 === q.x1 ? 2 : 0), z1: r.z1 - (r.z1 === q.z1 ? 2 : 0), x2: r.x2 + (r.x2 === q.x2 ? 2 : 0), z2: r.z2 + (r.z2 === q.z2 ? 2 : 0), y: q.y - 4 });
        else boxes.push({ x1: q.x1 - 2, z1: q.z1 - 2, x2: q.x2 + 2, z2: q.z2 + 2, y: q.y - 4 });
      }
      // A laid-out plot at the level of the prepared plot over it (before it is prepared its level is not known; while it
      // is prepared in parts, its parts above)
      for (const l of v.layouts ?? []) {
        const q = over(l);
        if (q && !q.parts) boxes.push({ x1: l.x1 - 2, z1: l.z1 - 2, x2: l.x2 + 2, z2: l.z2 + 2, y: q.y - 4 });
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
    if (!overworld(this)) {
      this.farmCache = { at: now, boxes: [] };
      return this.farmCache.boxes;
    }
    const p = this.bot.entity?.position;
    const boxes: Array<{ x1: number; z1: number; x2: number; z2: number; y: number }> = [];
    for (const v of this.world.villages.villages.values())
      for (const l of v.layouts ?? []) {
        const f = l.farm;
        // (once its ground is prepared: on a plot prepared in parts, its parts, S.6)
        const y = f && preparedAt(v, f)?.y;
        if (f && y !== undefined && (!p || Math.max(f.x1 - p.x, p.x - f.x2, f.z1 - p.z, p.z - f.z2) < 160)) boxes.push({ x1: f.x1, z1: f.z1, x2: f.x2, z2: f.z2, y });
        // (and each farm slot once it holds a kind: opportunistic farming, 10-08)
        for (const q of l.slots ?? []) {
          // (on pads, #84 C1: the slot's own pad and level, not the layout-wide record's home level)
          const qy = !q.kind ? undefined : v.plots.some((r) => r.pads) ? preparedAt(v, q)?.y : v.plots.find((r) => r.x1 <= q.x2 && r.x2 >= q.x1 && r.z1 <= q.z2 && r.z2 >= q.z1)?.y;
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
      // (the Nether rung, spec row 16: a portal's cells have no box and were safe to the pathfinder, so any walk past the
      // village's portal could carry a member to the Nether; soul fire was not avoided either. Before the fast-block table)
      for (const n of AVOID_BLOCKS) {
        const b = this.world.registry.blocksByName[n];
        if (b) m.blocksToAvoid.add(b.id);
      }
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
          // (survival (d), MC_WALLS: a village wall's gate is opened on the way, as a door; the gatekeeper shuts it after)
          const pos = (b as unknown as { position?: { x: number; y: number; z: number } }).position;
          b.openable = !open && !!pos && isWallGate(pos.x, pos.y, pos.z);
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
      // (no closures made per call in these hooks: tsx names each one it makes, and the searches call them per node)
      m.getMoveForward = (node, dir, neighbors) => {
        const n = neighbors.length;
        forward(node, dir, neighbors);
        for (let i = n; i < neighbors.length; i++) {
          const mv = neighbors[i] as unknown as { remainingBlocks: number; toPlace: Array<{ useOne?: boolean }> };
          for (const t of mv.toPlace) if (t.useOne) mv.remainingBlocks++;
        }
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
        (b) => {
          if (!b.position) return 0;
          const { x, y, z } = b.position;
          for (const q of this.protectedGround()) if (onBox(q, x, z) && y >= q.y && (q.y2 === undefined || y <= q.y2)) return 100;
          return 0;
        },
        // (#181: nor a block with water under it: the pathfinder's flow check looks above and beside only, and a hole into
        // a water pocket under the lake shore drowned two members in train 14's D)
        (b) => (b.position && wetAt(this, new Vec3(b.position.x, b.position.y - 1, b.position.z)) ? 100 : 0),
      ];
      // ...nor build on it: a builder walking to its stand spot pillared up with dirt in front of the mining hut's doorway
      // and sealed the mine (Minevale19, 10-04). Placing there costs too much for any path to take it
      (m as unknown as { exclusionAreasPlace: Array<(b: { position: { x: number; y: number; z: number } }) => number> }).exclusionAreasPlace = [
        (b) => {
          if (!b.position) return 0;
          const { x, y, z } = b.position;
          for (const q of this.protectedGround()) if (onBox(q, x, z) && y >= q.y && (q.y2 === undefined || y <= q.y2 + 1)) return 1000;
          return 0;
        },
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
          const { x, y, z } = b.position;
          for (const q of this.farmGround())
            if (onBox(q, x, z) && y >= q.y && y <= q.y + 2 && !(p && onBox(q, Math.floor(p.x), Math.floor(p.z)))) return 1000;
          return 0;
        },
      ];
      // MC_GEODE_GUARD (#133): no path digs a geode's shell or steps into its hollow (mcGeode.ts); a bot already inside
      // walks out freely
      if (GEODE_GUARD) {
        const ex = m as unknown as Record<'exclusionAreasBreak' | 'exclusionAreasStep', Array<(b: { name?: string; position: { x: number; y: number; z: number } }) => number>>;
        const lining = stateIds(this.bot.registry, GEODE_LINING), growth = stateIds(this.bot.registry, GEODE_GROWTH);
        const at = (x: number, y: number, z: number) => this.bot.world.getBlockStateId(new Vec3(x, y, z)) ?? -1;
        const inside = () => {
          const p = this.bot.entity?.position;
          if (!p) return false;
          const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
          return lining.has(at(x, y - 1, z)) || growth.has(at(x, y, z));
        };
        ex.exclusionAreasBreak.push((b) => geodeBreakCost(b.name));
        ex.exclusionAreasStep.push((b) => {
          if (!b.position) return 0;
          const { x, y, z } = b.position;
          const cost = geodeStepCost(growth.get(at(x, y, z)), lining.get(at(x, y - 1, z)), false);
          return cost && !inside() ? cost : 0;
        });
      }
      // Around water rather than through it: a gatherer that walked into a lake stayed stuck in it for ten minutes
      (m as unknown as { liquidCost: number }).liquidCost = 20; // (missing from the typings)
      // Diagonal steps only with both sides clear: the pathfinder allows one side blocked, and a bot cutting past that
      // corner catches on it and wiggles in place until the walk watchdog calls it stuck
      const diagonal = m.getMoveDiagonal.bind(m);
      m.getMoveDiagonal = (node, dir, neighbors) => {
        // The typings say Vec3; the pathfinder passes its path node (which has x, y, z)
        const at = node as unknown as Parameters<typeof m.getBlock>[0];
        const y = m.getBlock(at, dir.x, 0, dir.z).physical ? 1 : 0;
        if (m.getBlock(at, 0, y, dir.z).physical || m.getBlock(at, 0, y + 1, dir.z).physical) return;
        if (m.getBlock(at, dir.x, y, 0).physical || m.getBlock(at, dir.x, y + 1, 0).physical) return;
        diagonal(node, dir, neighbors);
      };
      // #204: no move ends with the head under water. Paths crossed rivers along the bed (feet and head in water, a node
      // per cell of the bottom), but the pathfinder holds jump in any water: the bot floated at the surface over a node 1-2
      // blocks down, never reached it, circled over it until the pathfinder's 3.5 s reset and got the same path again
      // (Jonah and Kai, 24 and 33 stalls in a river in fix202's run 6). Paths through water swim its surface now; from a
      // node already under water (a bot that sank, or one bobbing low at the start) the way on is straight up
      const neighbours = m.getNeighbors.bind(m);
      const wv = new Vec3(0, 0, 0);
      m.getNeighbors = (node) => {
        const out = neighbours(node);
        let k = 0;
        for (const mv of out) if (!wetAt(this, wv.set(mv.x, mv.y + 1, mv.z))) out[k++] = mv;
        out.length = k;
        const n = node as unknown as { x: number; y: number; z: number; remainingBlocks: number };
        if (wetAt(this, wv.set(n.x, n.y + 1, n.z)) && !m.getBlock(node as unknown as Parameters<typeof m.getBlock>[0], 0, 2, 0).physical)
          out.push(new Move(n.x, n.y + 1, n.z, n.remainingBlocks, 1) as (typeof out)[number]);
        return out;
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
    // Every bot hears every line: the world routes it once, by distance, and chooses who answers (E.0, mcWorld.hearChat)
    bot.on('chat', (from, text) => {
      if (from === this.name) return;
      this.world.hearChat(from, text);
    });
    bot.on('entityHurt', (e) => {
      if (e === bot.entity) this.lastHurt = Date.now();
    });
    bot.on('health', () => {
      if (bot.health < this.lastHealth) {
        // (survival (a): what hurt it, for the death line when no message names the cause)
        this.hurtBy = { hazard: hazardOf(this, 1), fell: Date.now() - this.lastFall.t < 1500 ? this.lastFall.h : 0 };
        // Damage informs the brain; it wakes the model only when nothing handles it: low health with no reflex running
        // (a death wakes it on its own event). Every hit used to wake it (the survival research's 3)
        const health = Math.round(bot.health);
        // (survival (c): with monsters, at most once per 3 minutes per member: a night attack is no wake storm)
        const urgent = bot.health > 0 && bot.health <= 6 && !this.reflex && (!modeSpec().mobs || mayWake(this.name));
        this.pushEvent('damage', `took ${Math.round(this.lastHealth - bot.health)} damage (health ${health})`, { health, urgent });
      }
      this.lastHealth = bot.health;
    });
    // (the server's death message names the cause: "Ada fell from a high place")
    bot.on('messagestr', (line: string) => {
      const cause = deathCauseOf(this.name, line);
      if (cause) this.deathHeard = { cause, text: line, t: Date.now() };
    });
    bot.on('playerCollect', (collector, collected) => {
      if (collector !== bot.entity) return;
      const it = collected.getDroppedItem?.();
      if (it) this.pushEvent('pickup', `picked up ${it.count}x ${it.name}`, { item: it.name, count: it.count });
    });
    bot.on('death', () => {
      // (#223: a player saved dead logs in dead: mineflayer's first health packet reads 0 before any spawn and it calls
      // that a death. Ada and Lena "died" at the world spawn at +0 of train 21's I0; no death happened in the run)
      if (!this.spawned) {
        console.log(`[death] ${this.name} logged in dead at ${bot.entity?.position ? at(bot.entity.position) : 'the world spawn'}: respawns, not counted (no death in this run)`);
        return;
      }
      this.stop();
      const where = bot.entity?.position?.clone();
      const t = Date.now();
      // (the death message may come just after the health packet: wait a second for it)
      setTimeout(() => this.died(where, t), 1000);
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
      // (#163: the odometer; more than 4 blocks in a tick is a teleport, not a walk)
      const q = bot.entity?.position;
      if (q) {
        if (this.odoAt) {
          const d = Math.hypot(q.x - this.odoAt.x, q.z - this.odoAt.z);
          if (d < 4) this.walked += d;
        }
        this.odoAt = { x: q.x, z: q.z };
      }
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
      // Pressed on an open door's panel (F250, issue #7): a 1-wide doorway with an open door leaves a bot centred on the
      // path node 0.0125 of room, and a drift of a few hundredths puts the panel in its way: the pathfinder's straight-line
      // simulation fails, it lets go of forward and stands there until its 3.5 s reset, again and again. After 4 ticks of
      // a moving path and no move, a panel in its way pushes it off sideways (at most 0.15)
      const moved = t.prev ? Math.abs(p.x - t.prev.x) + Math.abs(p.z - t.prev.z) : 1;
      t.prev = { x: p.x, z: p.z };
      t.still = bot.pathfinder.isMoving() && moved < 0.01 ? (t.still ?? 0) + 1 : 0;
      if (t.still >= 4) {
        t.still = 0;
        this.offDoorPanel();
      }
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

  /**
   * Put the bot in the middle of an open door's free gap (F250): the door cells round its feet and head, each panel's box
   * from the block's collision shape; a bot in the door's column (across the panel's thin axis) and within 0.6 of it
   * (along the other) moves across to the middle of what the panel leaves of the doorway, about 0.1 of room each side,
   * when that is a move of 0.02 to 0.3 (a nudge, not a teleport). Returns whether it moved.
   */
  private offDoorPanel(): boolean {
    const bot = this.bot;
    const p = bot.entity.position, W = 0.3;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) {
      const b = bot.blockAt(new Vec3(Math.floor(p.x) + dx, Math.floor(p.y + 0.1) + dy, Math.floor(p.z) + dz));
      if (!b || !/_door$/.test(b.name)) continue;
      const props = b.getProperties() as Record<string, unknown>;
      if (!(props.open === true || props.open === 'true')) continue;
      for (const s of (b.shapes ?? []) as number[][]) {
        const alongX = s[3] - s[0] < s[5] - s[2];
        // (the thin axis: the cell's start, the panel's span in the cell; the long axis: the panel's span in the world)
        const [a, cell, a0, a1] = alongX ? [p.x, b.position.x, s[0], s[3]] : [p.z, b.position.z, s[2], s[5]];
        const [l, l0, l1] = alongX ? [p.z, b.position.z + s[2], b.position.z + s[5]] : [p.x, b.position.x + s[0], b.position.x + s[3]];
        if (a < cell || a >= cell + 1 || l + W + 0.6 <= l0 || l - W - 0.6 >= l1) continue;
        // (the gap: from the cell's far side to the panel)
        const to = cell + (a0 > 0.5 ? a0 / 2 : (a1 + 1) / 2);
        if (Math.abs(to - a) < 0.02 || Math.abs(to - a) > 0.3) continue;
        if (alongX) p.x = to; else p.z = to;
        console.log(`[door] ${this.name} moved into the open door's gap at ${b.position.x},${b.position.y},${b.position.z}: ${alongX ? 'x' : 'z'} ${a.toFixed(2)} -> ${to.toFixed(2)}`);
        return true;
      }
    }
    return false;
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
      this.current.status.endedAt = Date.now();
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
    // (#115: a paused run starts nothing and thinks nothing; an action under way runs on in the frozen world)
    if (isPaused()) return;
    this.brain?.tick?.(this);
    if (takesDamage()) this.survival();
    // (survival (c), mcCombat.ts: the stage's reflex with monsters; the old one otherwise and with MC_COMBAT=off)
    if (fightsMobs()) combatTick(this);
    else this.selfDefence();
    if (this.reflex || this.current || !this.queue.length) return;
    const status = this.queue.shift()!;
    const run: Running = { status, abort: new AbortController(), from: this.bot.entity.position.clone() };
    this.current = run;
    status.state = 'running';
    status.startedTick = this.world.ticks;
    status.startedAt = Date.now();
    status.firstStartedAt ??= status.startedAt;
    MC_SKILLS[status.type]
      .run(this, status.args, run.abort.signal)
      .then(
        (msg) => this.finish(run, { done: msg ?? '' }),
        // (another agent's work in the way carries its code and resource into the event, E.0)
        (err: unknown) => this.finish(run, { fail: (err as Error).message, ...(err instanceof ContentionError ? { code: err.code, resource: err.resource } : {}) }),
      );
  }

  /** #221: the running action's status when `args` are its own (a skill called inside another gets none): a skill reads
   *  its first start and memo there, which survive a reflex putting the action back. */
  runOf(args: Record<string, unknown>): ActionStatus | undefined {
    return this.current?.status.args === args ? this.current.status : undefined;
  }

  /** Put the interrupted action back at the front of the queue (its run is cancelled and ignored) and stop moving. */
  private interrupt() {
    if (this.current) {
      const st = this.current.status;
      this.current.abort.abort();
      this.current = null;
      st.state = 'queued';
      st.resumes = (st.resumes ?? 0) + 1;
      this.queue.unshift(st);
    }
    this.halt();
  }

  /**
   * Survival stage (a), every tick when damage is on: the fall under way (for the death line), the spawnpoint at home
   * (every 20 s), and the hazard reflexes: swim up when air runs low, step out of fire and lava. Code, like the fighting
   * reflex: drowning from full takes ~25 s after 15 s of air, a model turn up to 20 (the survival research's 3).
   */
  private survival() {
    const bot = this.bot;
    if (this.gamemode === 'creative' || (bot.health ?? 20) <= 0) return;
    const y = bot.entity.position.y;
    if (!bot.entity.onGround && !(bot.entity as unknown as { isInWater?: boolean }).isInWater) this.fallFrom = Math.max(this.fallFrom ?? y, y);
    else if (this.fallFrom !== null) {
      this.lastFall = { h: this.fallFrom - y, t: Date.now() };
      this.fallFrom = null;
    }
    const now = Date.now();
    // (every 2 s until one is set: a member's village is known only once its spawn has finished, and a fall in between
    // respawned Gus at the world spawn, 1,600 blocks off; then every 20 s, for a home that moves)
    if (now - this.spawnCheckedAt > (this.spawnSet ? 20000 : 2000) && overworld(this)) {
      this.spawnCheckedAt = now;
      void this.keepSpawnpoint();
    }
    // (stage (b): the after-burn and the eating reflex, mcSurvivalB.ts; it keeps its own watch on fire and health, and
    // starts nothing while a reflex runs)
    survivalB(this);
    if (this.reflex) return;
    const hz = hazardOf(this);
    // (#188: lava at once, not after the 1.5 s pause: it kills from full health in ~2.5 s)
    if (hz && (hz === 'lava' || now - this.hazardEnded >= 1500)) this.hazardReflex(hz);
  }

  /** A reflex is running (stage (b)'s night tick and reflexes ask before starting one). */
  inReflex(): boolean {
    return !!this.reflex;
  }

  /**
   * Run `fn` in the reflex slot (stage (b), mcSurvivalB.ts), like hazardReflex: the action under way is put back and
   * resumes after. False when a reflex already runs. `done` gets fn's message; `failed` its error (not a cancel).
   */
  runReflex(what: string, fn: (signal: AbortSignal) => Promise<string>, done?: (msg: string) => void, failed?: (e: Error) => void): boolean {
    if (this.reflex) return false;
    this.interrupt();
    const ac = new AbortController();
    this.reflex = ac;
    const shown = (this.reflexNow = { what, at: Date.now() });
    fn(ac.signal).then(
      (msg) => (done ? done(msg) : console.log(`[hazard] ${this.name} ${what}: ${msg} (health ${Math.round(this.bot.health ?? 0)})`)),
      (e: Error) => {
        if (e.message === 'cancelled') return;
        if (failed) failed(e);
        else console.log(`[hazard] ${this.name} ${what}: ${e.message}`);
      },
    ).finally(() => {
      if (this.reflex === ac) this.reflex = null;
      if (this.reflexNow === shown) this.reflexNow = null;
      this.hazardEnded = Date.now();
      this.halt();
    });
    return true;
  }

  /**
   * #227: at log-in, a bot whose eyes are inside a block (a saved position from an earlier run in land a reset restored)
   * is moved at once to the surface at its x, z by the server (spreadplayers reads the ground; lesson 37), before the
   * spawn's own teleport, which comes after the ready wait: Kai suffocated a second after logging in at y 26 in rock.
   * The chunk is waited for up to 3 s.
   */
  private async unbury() {
    const bot = this.bot;
    const read = (p: Vec3) => {
      const b = bot.blockAt(p);
      return b ? { name: b.name, boundingBox: b.boundingBox } : null;
    };
    for (let i = 0; i < 30 && bot.entity; i++) {
      if ((bot.health ?? 20) <= 0) return;
      const p = bot.entity.position.clone();
      const buried = buriedAt(read, p);
      if (buried === false) return;
      if (buried) {
        const x = Math.floor(p.x) + 0.5, z = Math.floor(p.z) + 0.5;
        const eye = bot.blockAt(new Vec3(Math.floor(p.x), Math.floor(p.y + 1.62), Math.floor(p.z)))?.name ?? '?';
        try {
          const out = await this.world.rcon.command(`spreadplayers ${x} ${z} 0 1 false ${this.name}`);
          console.log(`[spawn] ${this.name} logged in inside ${eye} at ${at(p)} (a saved position): moved to the surface (${out.trim().slice(0, 120)})`);
        } catch (e) {
          console.log(`[spawn] ${this.name} logged in inside ${eye} at ${at(p)}: could not move it (${(e as Error).message})`);
        }
        return;
      }
      await new Promise((ok) => setTimeout(ok, 100));
    }
  }

  /** Set the spawnpoint at home again on the next check (a bed slept in moved it to the bed, stage (b)). */
  resetSpawnpoint() {
    this.spawnSet = '';
    this.spawnCheckedAt = 0;
  }

  /** The member's spawnpoint beside home (the storage hut's aisle, else the chest), set over RCON when home moves: a death
   *  respawned members at the world spawn, 900 blocks off (lesson 37). */
  private async keepSpawnpoint() {
    const h = home(this);
    if (!h || h.y === undefined || h.what === 'the world spawn') return;
    // (stage (b): a home cell blocked or burning gives the nearest safe cell within 6 blocks, mcSurvivalB.ts)
    const c = spawnCellFor(this, { x: h.x, y: h.y, z: h.z });
    const key = `${c.x} ${c.y} ${c.z}`;
    if (key === this.spawnSet) return;
    this.spawnSet = key;
    try {
      const out = await this.world.rcon.command(`spawnpoint ${this.name} ${key}`);
      console.log(`[spawnpoint] ${this.name} at ${key} (${h.what}${c.why ? `; home unsafe: ${c.why}` : ''}): ${out.trim()}`);
    } catch (e) {
      this.spawnSet = '';
      console.log(`[spawnpoint] ${this.name}: not set (${(e as Error).message})`);
    }
  }

  /** Out of the water's depth, the fire or the lava, in the reflex's slot; then the interrupted action resumes. */
  private hazardReflex(hz: Hazard) {
    const from = this.bot.entity.position.clone();
    if (hz === 'air') {
      const now = Date.now();
      this.airUps = [...this.airUps.filter((u) => now - u.t < 60000 && u.p.distanceTo(from) < 3), { p: from, t: now }];
      if (trappedUnderWater(this.airUps, this.bot.health ?? 20)) return this.trappedReflex(from);
    }
    this.interrupt();
    const ac = new AbortController();
    this.reflex = ac;
    // (#188: logged as it starts: a bot that dies in it left no line)
    if (hz !== 'air') console.log(`[hazard] ${this.name} ${hz} at ${at(from)}: stepping out (health ${Math.round(this.bot.health ?? 0)})`);
    const out = async (): Promise<string> => {
      if (hz === 'air') {
        await swimUp(this, ac.signal);
        return 'swam up for air';
      }
      const c = safeCellNear(this);
      // (#188: out of lava by steering, at most 2 s; the pathfinder's 5 s walk outlasted the bot)
      if (hz === 'lava') {
        if (await lavaStep(this, c, ac.signal)) return `stepped out of the lava${c ? ` toward ${at(c)}` : ''}`;
        return 'still in lava after the step';
      }
      if (c) {
        try {
          await walk(this, new goals.GoalBlock(c.x, c.y, c.z), `out of the ${hz}`, ac.signal, 5000);
          return `stepped out to ${at(c)}`;
        } catch (e) {
          if ((e as Error).message === 'cancelled') throw e;
        }
      }
      // (no cell found, or the walk failed: jump forward out of it)
      this.bot.setControlState('jump', true);
      this.bot.setControlState('forward', true);
      await new Promise((ok) => setTimeout(ok, 1200));
      return 'jumped out';
    };
    out().then(
      (msg) => {
        console.log(`[hazard] ${this.name} ${hz} at ${at(from)}: ${msg} (health ${Math.round(this.bot.health ?? 0)})`);
        this.pushEvent('system', `Reflex: ${hz === 'air' ? 'you were running out of air under water' : `you were in ${hz}`}; ${msg}. Resuming your action.`);
      },
      (e: Error) => e.message !== 'cancelled' && console.log(`[hazard] ${this.name} ${hz} at ${at(from)}: ${e.message}`),
    ).finally(() => {
      if (this.reflex === ac) this.reflex = null;
      this.hazardEnded = Date.now();
      this.halt();
    });
  }

  /**
   * #181: trapped under water (swim-ups that lead back down, or health falling): out of it (mcRescue's outOfWater: a walk
   * to dry ground, else a teleport home), the place kept off by gathering, and the interrupted action dropped rather than
   * resumed, since it led there: its failure tells the chooser.
   */
  private trappedReflex(from: Vec3) {
    this.airUps = [];
    const cur = this.current?.status;
    if (this.current) this.current.abort.abort();
    this.current = null;
    this.halt();
    const ac = new AbortController();
    this.reflex = ac;
    noteTrap(from);
    const health = Math.round(this.bot.health ?? 0);
    const stats = ((this.memory.rescues ??= {}) as Record<string, number | string>);
    outOfWater(this, ac.signal).then(
      (r) => {
        stats[`water-${r.how}`] = Number(stats[`water-${r.how}`] ?? 0) + 1;
        stats.last = `${new Date().toISOString().slice(11, 19)} water-${r.how}: ${r.text}`;
        console.log(`[rescue] ${this.name} trapped under water at ${at(from)} (health ${health}): ${r.how}: ${r.text}`);
        this.pushEvent('system', `Rescue: you were trapped under water at ${at(from)}; ${r.text}. Keep away from that water.`);
      },
      (e: Error) => e.message !== 'cancelled' && console.log(`[rescue] ${this.name} trapped under water at ${at(from)}: ${e.message}`),
    ).finally(() => {
      if (this.reflex === ac) this.reflex = null;
      this.hazardEnded = Date.now();
      this.halt();
      if (cur) {
        const why = `trapped under water at ${at(from)} and rescued; the action is dropped (it led there)`;
        Object.assign(cur, { state: 'failed', message: why, endedAt: Date.now() });
        this.history.push(cur);
        if (this.history.length > 100) this.history.shift();
        this.pushEvent('action_failed', `${cur.type} failed: ${why}`, { action: cur.id, type: cur.type, args: cur.args, message: why });
      }
    });
  }

  /**
   * A death (survival stage (a)): a `[death]` line with its cause, counted in memory (`deaths`), and the brain told. The bot
   * respawns at its spawnpoint (home, keepSpawnpoint) with its things (keep_inventory); one that woke elsewhere walks home.
   */
  private died(where: Vec3 | undefined, t: number) {
    const heard = this.deathHeard && Math.abs(this.deathHeard.t - t) < 3000 ? this.deathHeard : null;
    const cause = heard?.cause ?? causeFromState(this.hurtBy);
    this.deathHeard = null;
    this.hurtBy = null;
    const deaths = ((this.memory.deaths ??= {}) as Record<string, number>);
    deaths[cause] = (deaths[cause] ?? 0) + 1;
    const place = where ? at(where) : 'somewhere';
    // (#181: the last death, for a choosing member's next choices; mcWorld remembers it once, MC_MEMORY)
    this.memory.lastDeath = { cause, place, t };
    this.airUps = [];
    console.log(`[death] ${this.name} ${cause} at ${place}${heard ? ` ("${heard.text}")` : ' (no death message: guessed)'}`);
    // (stage (d): the danger count's deaths by distance from home and phase)
    noteDeath(this, where);
    // (#220, E5: a death teaches the member to keep away from where it died, for the chore it was doing)
    if (where) {
      const v = this.village(), c = v?.storage?.chests[0];
      const keepOff = v ? [...(v.storageHut ? [v.storageHut] : []), ...v.structures] : [];
      try {
        noteDeathLesson({ village: v?.name, agent: this.name, cause: heard?.text.replace(new RegExp(`^${this.name} `), '') ?? cause, x: where.x, z: where.z,
          night: phaseOf(this.bot.time?.timeOfDay) === 'night', home: c ? { x: c.x, z: c.z } : null, keepOff });
      } catch { /* (never stop the death's handling) */ }
    }
    // (a third death in 3 minutes: home itself kills (lava at the spawnpoint in a probe: 10 deaths in a row), so no walk or
    // teleport back there)
    this.deathTimes = [...this.deathTimes.filter((d) => t - d < 180000), t];
    const again = this.deathTimes.length >= 3;
    if (again) console.log(`[death] ${this.name} died ${this.deathTimes.length} times in 3 minutes: stays where it wakes`);
    const h = home(this);
    this.pushEvent('death', `you died (${heard?.text ?? cause}) at ${place}; you woke at ${h?.what ?? 'the world spawn'} with your things (keep_inventory)`, { cause });
    // Home again, unless the respawn already put it there (it takes a moment: wait for the spawn)
    setTimeout(() => {
      const hh = home(this);
      const p = this.bot.entity?.position;
      if (again || !hh || hh.what === 'the world spawn' || !p || Math.hypot(p.x - hh.x, p.z - hh.z) < 16 || this.reflex) return;
      const ac = new AbortController();
      this.reflex = ac;
      const goal = hh.y !== undefined ? new goals.GoalNear(hh.x, hh.y, hh.z, 2) : new goals.GoalNearXZ(hh.x, hh.z, 2);
      // (a respawn far off means no spawnpoint was set yet: a teleport, as the rescue's last resort; nearer, a walk of at
      // most 3 minutes in all, its 40-block legs included)
      const far = Math.hypot(p.x - hh.x, p.z - hh.z) > 200;
      const walkAc = new AbortController();
      const cap = setTimeout(() => walkAc.abort(), 180000);
      ac.signal.addEventListener('abort', () => walkAc.abort());
      const go = far ? Promise.reject(new Error(`woke ${Math.round(Math.hypot(p.x - hh.x, p.z - hh.z))} blocks from home`))
        : walk(this, goal, hh.what, walkAc.signal, 60000).then(() => `walked home to ${hh.what}`);
      go.finally(() => clearTimeout(cap)).catch(async (e: Error) => {
        if (ac.signal.aborted) throw e;
        return `could not walk home (${e.message}); ${(await teleportHome(this, ac.signal)) ?? 'no home to go to'}`;
      }).then(
        (msg) => {
          console.log(`[death] ${this.name} after the death: ${msg}`);
          this.pushEvent('system', `After your death: ${msg}.`);
        },
        () => undefined,
      ).finally(() => {
        if (this.reflex === ac) this.reflex = null;
        this.halt();
      });
    }, 3000);
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
      st.resumes = (st.resumes ?? 0) + 1;
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

  private finish(run: Running, r: { done: string } | { fail: string; code?: string; resource?: string }) {
    if (this.current !== run) return; // cancelled
    const st = run.status;
    run.abort.abort();
    st.endedAt = Date.now();
    if ('done' in r) {
      st.state = 'done';
      if (r.done) st.message = r.done;
      this.pushEvent('action_done', `${st.type} finished${r.done ? `: ${r.done}` : ''}`, { action: st.id, type: st.type, args: st.args });
    } else {
      st.state = 'failed';
      st.message = r.fail;
      // (the contention code on the status too: a chore's end tells another agent's work in the way from a failure, A.2)
      if (r.code) st.code = r.code;
      this.pushEvent('action_failed', `${st.type} failed: ${r.fail}`, { action: st.id, type: st.type, args: st.args, message: r.fail, ...(r.code ? { code: r.code, resource: r.resource } : {}) });
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

  /** A rescue or another reflex is under way (its walks do not call for another rescue: mcUtil walk). */
  get rescuing(): boolean {
    return this.reflex !== null;
  }

  /**
   * #204: a walk stalled `n` times at one spot without getting anywhere (mcUtil walk, PINNED_STALLS): a teleport home,
   * charged nothing, logged as a rescue. Returns what it did, or null with no home to go to.
   */
  async rescuePinned(n: number, water: boolean, signal: AbortSignal): Promise<string | null> {
    const from = this.bot.entity.position.clone();
    // (the Nether rung, spec row 10: off the overworld the far portal, then the recall: mcRescue's teleportHome there)
    const t = await teleportHome(this, signal);
    if (!t) return null;
    const how = water ? 'pinned-water' : 'pinned';
    const stats = ((this.memory.rescues ??= {}) as Record<string, number | string>);
    stats[how] = Number(stats[how] ?? 0) + 1;
    stats.last = `${new Date().toISOString().slice(11, 19)} ${how}: ${t}`;
    console.log(`[rescue] ${this.name} stalled ${n} times at ${at(from)}${water ? ' in water' : ''} without getting anywhere: teleported: ${t}`);
    this.pushEvent('system', `Rescue: your walks kept stalling at ${at(from)}${water ? ' in the water' : ''}; ${t}. Carry on from here.`);
    return t;
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
    // The nearest 30 others and up to 30 players besides (E.0: with 25 agents, players alone could fill the 30 before any
    // animal or drop)
    const players = nearbyEntities.filter((e) => e.kind === 'player');
    const shown = [...nearbyEntities.filter((e) => e.kind !== 'player').slice(0, 30), ...players.slice(0, 30)].sort((a, b) => a.distance - b.distance);
    const biomeId = bot.world.getBiome?.(p.floored()) as number | undefined;
    const slots = bot.inventory.slots;
    return {
      name: this.name,
      tick: this.world.ticks,
      timeOfDay: bot.time.timeOfDay,
      isDay: bot.time.isDay,
      position: { x: round1(p.x), y: round1(p.y), z: round1(p.z) },
      ...(this.dim !== 'overworld' ? { dimension: this.dim } : {}),
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
      nearbyEntities: shown,
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
