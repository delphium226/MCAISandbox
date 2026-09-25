import * as fs from 'node:fs';
import * as path from 'node:path';
import { ServerWorld } from './serverWorld';
import { Entity, ItemEntity, FallingBlockEntity, TntEntity, ArrowEntity } from './entity';
import { Player, Connection, PlayerData } from './player';
import { Mob, MobKind, MOB_SPECS } from './mobs';
import { BlockEntity, FurnaceState, ChestState, tickFurnace } from './containers';
import { handleCommand } from './commands';
import { S2C, encodeChunkPacket } from '../../shared/src/protocol';
import { B, BLOCKS, BlockDef, blockOf, makeState } from '../../shared/src/blocks';
import { ItemStack } from '../../shared/src/items';
import { blockDrops } from '../../shared/src/mining';
import { numKey } from '../../shared/src/world';
import { DAY_LENGTH, SEA_LEVEL, TICK_MS, WORLD_HEIGHT } from '../../shared/src/constants';
import { raycast } from '../../shared/src/physics';
import { Biome } from '../../shared/src/biomes';
import type { AgentManager } from './agents';

export interface GameOptions {
  seed: number;
  dir: string;
  viewDistance: number;
  pvp: boolean;
  motd: string;
}

interface LevelData {
  seed: number;
  time: number;
  spawn: { x: number; y: number; z: number };
}

const PASSIVE: MobKind[] = ['pig', 'cow', 'sheep', 'chicken'];
const HOSTILE: MobKind[] = ['zombie', 'skeleton', 'creeper', 'spider'];

export class Game {
  world: ServerWorld;
  entities = new Map<number, Entity>();
  players = new Set<Player>();
  tick = 0;
  time = 1000;
  /** Time speed multiplier (1 = normal). */
  timeRate = 1;
  spawn: { x: number; y: number; z: number };
  pvp: boolean;
  blockEntities = new Map<string, BlockEntity>();
  private activeFurnaces = new Set<string>();
  agents!: AgentManager;
  readonly opts: GameOptions;
  private timer: NodeJS.Timeout | null = null;
  tickTimes: number[] = [];
  /** Listeners for chat (used by AI agents to "hear" messages). */
  chatListeners: Array<(from: Player | null, text: string) => void> = [];
  doMobSpawning = true;
  doDaylightCycle = true;

  constructor(opts: GameOptions) {
    this.opts = opts;
    this.pvp = opts.pvp;
    fs.mkdirSync(opts.dir, { recursive: true });
    fs.mkdirSync(path.join(opts.dir, 'players'), { recursive: true });
    const levelFile = path.join(opts.dir, 'level.json');
    let level: LevelData | null = null;
    if (fs.existsSync(levelFile)) level = JSON.parse(fs.readFileSync(levelFile, 'utf8'));
    const seed = level?.seed ?? opts.seed;
    this.world = new ServerWorld(seed, opts.dir);
    this.time = level?.time ?? 1000;
    this.spawn = level?.spawn ?? this.world.gen.findSpawn();
    const beFile = path.join(opts.dir, 'blockentities.json');
    if (fs.existsSync(beFile)) {
      const data = JSON.parse(fs.readFileSync(beFile, 'utf8')) as Record<string, BlockEntity>;
      for (const [k, v] of Object.entries(data)) {
        this.blockEntities.set(k, v);
        if (v.kind === 'furnace') this.activeFurnaces.add(k);
      }
    }
    this.world.events = {
      blockChanged: (x, y, z, s, prev) => this.onBlockChanged(x, y, z, s, prev),
      dropBlockItems: (x, y, z, s) => this.dropBlockItems(x, y, z, s),
      spawnFalling: (x, y, z, s) => this.addEntity(new FallingBlockEntity(this, x, y, z, s)),
      chunkLoaded: (c) => this.onChunkLoaded(c.cx, c.cz),
    };
    this.save();
  }

  get seed() {
    return this.world.gen.seed;
  }

  start() {
    let next = performance.now();
    const loop = () => {
      const now = performance.now();
      let n = 0;
      while (now >= next && n < 5) {
        const t0 = performance.now();
        try {
          this.step();
        } catch (e) {
          console.error('Tick error', e);
        }
        this.tickTimes.push(performance.now() - t0);
        if (this.tickTimes.length > 100) this.tickTimes.shift();
        next += TICK_MS;
        n++;
      }
      if (now - next > 1000) next = now; // don't spiral if we fall far behind
      this.timer = setTimeout(loop, Math.max(1, next - performance.now()));
    };
    loop();
    setInterval(() => this.save(), 30000);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.save();
    this.world.shutdown();
  }

  save() {
    const level: LevelData = { seed: this.seed, time: this.time, spawn: this.spawn };
    fs.writeFileSync(path.join(this.opts.dir, 'level.json'), JSON.stringify(level, null, 2));
    fs.writeFileSync(path.join(this.opts.dir, 'blockentities.json'), JSON.stringify(Object.fromEntries(this.blockEntities)));
    for (const p of this.players) this.savePlayer(p);
    this.world.saveAll();
  }

  savePlayer(p: Player) {
    if (p.isAgent && !this.agents?.persistent(p)) return;
    fs.writeFileSync(path.join(this.opts.dir, 'players', `${sanitize(p.name)}.json`), JSON.stringify(p.save()));
  }

  loadPlayer(name: string): PlayerData | undefined {
    const f = path.join(this.opts.dir, 'players', `${sanitize(name)}.json`);
    if (!fs.existsSync(f)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      return undefined;
    }
  }

  // ---- Players -------------------------------------------------------------------------------

  join(conn: Connection, name: string, skin?: number): Player {
    for (const p of this.players)
      if (p.name.toLowerCase() === name.toLowerCase()) {
        p.conn.close('Logged in from another location');
        this.leave(p);
      }
    const p = new Player(this, conn, name, this.loadPlayer(name));
    if (skin !== undefined) p.skin = skin;
    p.viewDistance = conn.isAgent ? 3 : this.opts.viewDistance;
    this.players.add(p);
    this.entities.set(p.id, p);
    p.send({
      t: 'welcome', id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
      time: this.time, gamemode: p.gamemode, viewDistance: p.viewDistance, seed: this.seed, spawn: [this.spawn.x, this.spawn.y, this.spawn.z],
    });
    p.send({ t: 'time', time: this.time, rate: this.doDaylightCycle ? this.timeRate : 0 });
    p.sendInventory();
    p.sendHealth();
    this.broadcast({ t: 'chat', text: `${name} joined the game`, color: '#ffff55' });
    this.sendPlayerList();
    if (!conn.isAgent) p.send({ t: 'chat', text: this.opts.motd, color: '#aaaaaa' });
    // Make sure the player's own chunk exists before they start falling
    this.world.requestChunk(Math.floor(p.x) >> 4, Math.floor(p.z) >> 4).then((c) => {
      if (p.removed) return;
      // If saved position is inside blocks (world changed), move up
      let y = Math.floor(p.y);
      while (y < WORLD_HEIGHT - 2 && (BLOCKS[this.world.getBlock(Math.floor(p.x), y, Math.floor(p.z)) & 0xff].solid || BLOCKS[this.world.getBlock(Math.floor(p.x), y + 1, Math.floor(p.z)) & 0xff].solid)) y++;
      if (y !== Math.floor(p.y)) p.teleport(p.x, y, p.z);
      void c;
    });
    return p;
  }

  leave(p: Player) {
    if (!this.players.has(p)) return;
    p.closeWindow(false);
    this.savePlayer(p);
    this.players.delete(p);
    p.remove();
    this.entities.delete(p.id);
    for (const o of this.players) {
      if (o.tracked.delete(p.id)) o.send({ t: 'despawn', ids: [p.id] });
    }
    this.broadcast({ t: 'chat', text: `${p.name} left the game`, color: '#ffff55' });
    this.sendPlayerList();
  }

  sendPlayerList() {
    this.broadcast({ t: 'players', list: [...this.players].map((p) => ({ id: p.id, name: p.name, agent: p.isAgent })) });
  }

  getPlayer(name: string): Player | undefined {
    const n = name.toLowerCase();
    for (const p of this.players) if (p.name.toLowerCase() === n) return p;
    return undefined;
  }

  // ---- Messaging ------------------------------------------------------------------------------

  broadcast(msg: S2C, except?: Player) {
    for (const p of this.players) if (p !== except) p.send(msg);
  }

  broadcastNear(e: { x: number; z: number }, msg: S2C, except?: Player, range = 96) {
    for (const p of this.players) {
      if (p === except) continue;
      if (Math.abs(p.x - e.x) > range || Math.abs(p.z - e.z) > range) continue;
      p.send(msg);
    }
  }

  playSound(s: string, x: number, y: number, z: number, v = 1, p = 1) {
    this.broadcastNear({ x, z }, { t: 'sound', s, x, y, z, v, p }, undefined, 48);
  }

  particles(k: 'block' | 'explosion' | 'smoke' | 'crit' | 'heart' | 'splash', x: number, y: number, z: number, s?: number) {
    this.broadcastNear({ x, z }, { t: 'particles', k, x, y, z, s }, undefined, 64);
  }

  handleChat(p: Player, text: string) {
    text = text.slice(0, 256).trim();
    if (!text) return;
    if (text.startsWith('/')) return handleCommand(this, p, text.slice(1));
    this.broadcast({ t: 'chat', text, from: p.name });
    console.log(`<${p.name}> ${text}`);
    for (const l of this.chatListeners) l(p, text);
  }

  systemMessage(text: string, color = '#aaaaaa') {
    this.broadcast({ t: 'chat', text, color });
  }

  // ---- Entities -------------------------------------------------------------------------------

  addEntity(e: Entity) {
    this.entities.set(e.id, e);
    return e;
  }

  entitiesNear(x: number, y: number, z: number, r: number): Entity[] {
    const out: Entity[] = [];
    const r2 = r * r;
    for (const e of this.entities.values()) {
      const dx = e.x - x, dy = e.y - y, dz = e.z - z;
      if (dx * dx + dy * dy + dz * dz <= r2) out.push(e);
    }
    return out;
  }

  nearestPlayer(x: number, y: number, z: number, r: number, filter?: (p: Player) => boolean): Player | null {
    let best: Player | null = null, bd = r;
    for (const p of this.players) {
      if (p.dead || (filter && !filter(p))) continue;
      const d = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  canSee(a: Entity, b: Entity): boolean {
    const ax = a.x, ay = a.y + a.body.height * 0.85, az = a.z;
    const bx = b.x, by = b.y + b.body.height * 0.85, bz = b.z;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const hit = raycast(this.world, ax, ay, az, dx / d, dy / d, dz / d, d);
    return !hit || !BLOCKS[hit.state & 0xff].opaque;
  }

  dropItem(x: number, y: number, z: number, stack: ItemStack) {
    if (!stack || stack.count <= 0) return;
    this.addEntity(new ItemEntity(this, x, y, z, stack));
  }

  dropBlockItems(x: number, y: number, z: number, state: number, tool: ItemStack | null = null) {
    for (const s of blockDrops(state, tool)) this.dropItem(x + 0.5, y + 0.3, z + 0.5, s);
  }

  blockDef(state: number): BlockDef {
    return blockOf(state);
  }

  isDay() {
    const t = this.time % DAY_LENGTH;
    return t < 12300 || t > 23700;
  }

  /** Sky light reduction due to time of day (0 = noon, 11 = midnight). */
  skyDarkening(): number {
    const t = (this.time % DAY_LENGTH) / DAY_LENGTH;
    const angle = t * Math.PI * 2;
    const b = Math.cos(angle) * 2 + 0.5; // 0 at sunrise
    const bright = Math.max(0, Math.min(1, b));
    return Math.round((1 - bright) * 11);
  }

  // ---- Blocks ---------------------------------------------------------------------------------

  setBlockBy(_p: Player | null, x: number, y: number, z: number, state: number) {
    this.world.set(x, y, z, state);
  }

  destroyBlock(x: number, y: number, z: number, breaker: Player | null, tool: ItemStack | null) {
    const s = this.world.getBlock(x, y, z);
    const def = blockOf(s);
    this.particles('block', x + 0.5, y + 0.5, z + 0.5, s);
    this.playSound(`break_${def.sound}`, x + 0.5, y + 0.5, z + 0.5);
    this.world.set(x, y, z, 0);
    // Block entity contents
    const key = `${x},${y},${z}`;
    const be = this.blockEntities.get(key);
    if (be) {
      const stacks = be.kind === 'chest' ? be.items : [be.input, be.fuel, be.output];
      for (const st of stacks) if (st) this.dropItem(x + 0.5, y + 0.5, z + 0.5, st);
      this.blockEntities.delete(key);
      this.activeFurnaces.delete(key);
      for (const p of this.players) if (p.openWin?.pos && `${p.openWin.pos}` === `${x},${y},${z}`) p.closeWindow();
    }
    if (breaker) {
      this.dropBlockItems(x, y, z, s, tool);
      this.agents?.onBlockBroken(breaker, x, y, z, s);
    }
    // Ice leaves water behind
    if ((s & 0xff) === B.ice && breaker) this.world.set(x, y, z, B.water);
  }

  private onBlockChanged(x: number, y: number, z: number, s: number, _prev: number) {
    const cx = x >> 4, cz = z >> 4;
    const k = numKey(cx, cz);
    for (const p of this.players) if (p.sentChunks.has(k)) p.send({ t: 'block', x, y, z, s });
  }

  getBlockEntity(pos: [number, number, number], kind: 'furnace' | 'chest'): BlockEntity {
    const key = pos.join(',');
    let be = this.blockEntities.get(key);
    if (!be || be.kind !== kind) {
      be = kind === 'furnace'
        ? ({ kind: 'furnace', input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0 } as FurnaceState)
        : ({ kind: 'chest', items: new Array(27).fill(null) } as ChestState);
      this.blockEntities.set(key, be);
    }
    if (kind === 'furnace') this.activeFurnaces.add(key);
    return be;
  }

  containerChanged(pos: [number, number, number], except?: Player) {
    const key = pos.join(',');
    if (this.blockEntities.get(key)?.kind === 'furnace') this.activeFurnaces.add(key);
    for (const p of this.players) {
      if (p === except || !p.openWin?.pos) continue;
      if (p.openWin.pos.join(',') === key) p.sendWindow(p.openWin);
    }
  }

  private tickFurnaces() {
    for (const key of this.activeFurnaces) {
      const f = this.blockEntities.get(key);
      if (!f || f.kind !== 'furnace') {
        this.activeFurnaces.delete(key);
        continue;
      }
      const [x, y, z] = key.split(',').map(Number);
      if (!this.world.isLoaded(x, z)) continue;
      const r = tickFurnace(f);
      if (r.lit) {
        const s = this.world.getBlock(x, y, z);
        const meta = s >> 8;
        this.world.set(x, y, z, makeState(f.burn > 0 ? B.litFurnace : B.furnace, meta));
      }
      if (!r.changed) this.activeFurnaces.delete(key);
      if (this.tick % 4 === 0 || r.changed) {
        for (const p of this.players) if (p.openWin?.pos && p.openWin.pos.join(',') === key) p.sendWindow(p.openWin);
      }
    }
  }

  primeTnt(x: number, y: number, z: number, fuse = 80) {
    this.world.set(x, y, z, 0);
    this.addEntity(new TntEntity(this, x, y, z, fuse));
    this.playSound('fuse', x + 0.5, y + 0.5, z + 0.5);
  }

  explode(x: number, y: number, z: number, power: number, source: Entity | null) {
    this.playSound('explode', x, y, z, 4);
    this.particles('explosion', x, y, z, power);
    const destroyed = new Set<string>();
    const N = 16;
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        for (let k = 0; k < N; k++) {
          if (i !== 0 && i !== N - 1 && j !== 0 && j !== N - 1 && k !== 0 && k !== N - 1) continue;
          let dx = (i / (N - 1)) * 2 - 1, dy = (j / (N - 1)) * 2 - 1, dz = (k / (N - 1)) * 2 - 1;
          const len = Math.hypot(dx, dy, dz);
          dx /= len; dy /= len; dz /= len;
          let intensity = power * (0.7 + Math.random() * 0.6);
          let px = x, py = y, pz = z;
          while (intensity > 0) {
            const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
            const s = this.world.getBlock(bx, by, bz);
            const id = s & 0xff;
            if (id !== 0) {
              const d = BLOCKS[id];
              const res = d.hardness < 0 ? 3600000 : d.fluid ? 100 : d.name === 'obsidian' ? 1200 : d.hardness * 3;
              intensity -= (res + 0.3) * 0.3;
              if (intensity > 0 && by > 0) destroyed.add(`${bx},${by},${bz}`);
            }
            px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
            intensity -= 0.22500001;
          }
        }
    for (const key of destroyed) {
      const [bx, by, bz] = key.split(',').map(Number);
      const s = this.world.getBlock(bx, by, bz);
      const id = s & 0xff;
      if (id === 0) continue;
      if (id === B.tnt) {
        this.world.set(bx, by, bz, 0);
        this.addEntity(new TntEntity(this, bx, by, bz, 10 + Math.floor(Math.random() * 20)));
        continue;
      }
      const be = this.blockEntities.get(key);
      if (be) {
        const stacks = be.kind === 'chest' ? be.items : [be.input, be.fuel, be.output];
        for (const st of stacks) if (st) this.dropItem(bx + 0.5, by + 0.5, bz + 0.5, st);
        this.blockEntities.delete(key);
      }
      this.world.set(bx, by, bz, 0);
      if (Math.random() < 1 / power) this.dropBlockItems(bx, by, bz, s);
    }
    // Damage entities
    const r = power * 2;
    for (const e of this.entitiesNear(x, y, z, r)) {
      if (e === source || e.removed) continue;
      const dist = e.distanceTo({ x, y, z }) / r;
      if (dist > 1) continue;
      const impact = 1 - dist;
      if (e instanceof ItemEntity) {
        if (impact > 0.5) e.remove();
        continue;
      }
      const dmg = Math.floor(((impact * impact + impact) / 2) * 7 * r + 1);
      const dx = e.x - x, dz = e.z - z, dl = Math.hypot(dx, dz) || 1;
      e.damage(dmg, source, 'explosion');
      e.knockback(dx / dl, dz / dl, impact * 1.2);
      e.body.vy += impact * 0.6;
      if (e instanceof Player) e.send({ t: 'velocity', vx: e.body.vx, vy: e.body.vy, vz: e.body.vz });
    }
  }

  growTree(x: number, y: number, z: number, saplingId: number) {
    const w = this.world;
    const spruce = saplingId === B.spruceSapling;
    const birch = saplingId === B.birchSapling;
    const height = spruce ? 7 + Math.floor(Math.random() * 3) : (birch ? 5 : 4) + Math.floor(Math.random() * 3);
    for (let i = 1; i <= height; i++) if (BLOCKS[w.getBlock(x, y + i, z) & 0xff].solid) return;
    const log = spruce ? B.spruceLog : birch ? B.birchLog : B.oakLog;
    const leaf = spruce ? B.spruceLeaves : birch ? B.birchLeaves : B.oakLeaves;
    const put = (px: number, py: number, pz: number, s: number) => {
      const cur = w.getBlock(px, py, pz) & 0xff;
      if (cur === 0 || BLOCKS[cur].replaceable) w.set(px, py, pz, s);
    };
    const top = y + height;
    if (spruce) {
      let radius = 0;
      for (let ly = top; ly >= y + 2; ly--) {
        for (let dx = -radius; dx <= radius; dx++)
          for (let dz = -radius; dz <= radius; dz++) if (!(Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 0)) put(x + dx, ly, z + dz, leaf);
        radius = radius >= 2 ? 1 : radius + 1;
      }
      put(x, top + 1, z, leaf);
    } else {
      for (let ly = top - 3; ly <= top; ly++) {
        const rr = ly >= top - 1 ? 1 : 2;
        for (let dx = -rr; dx <= rr; dx++)
          for (let dz = -rr; dz <= rr; dz++) {
            if (Math.abs(dx) === rr && Math.abs(dz) === rr && (ly === top || Math.random() < 0.5)) continue;
            put(x + dx, ly, z + dz, leaf);
          }
      }
    }
    w.set(x, y, z, log);
    for (let i = 1; i < height; i++) w.set(x, y + i, z, log);
  }

  trySleep(p: Player, pos: [number, number, number]) {
    p.spawnPoint = [pos[0] + 0.5, pos[1] + 1, pos[2] + 0.5];
    if (this.isDay()) {
      p.send({ t: 'chat', text: 'You can only sleep at night. Respawn point set.', color: '#aaaaaa' });
      return;
    }
    const monsters = this.entitiesNear(pos[0], pos[1], pos[2], 8).some((e) => e instanceof Mob && e.hostile);
    if (monsters) {
      p.send({ t: 'chat', text: 'You may not rest now; there are monsters nearby', color: '#aaaaaa' });
      return;
    }
    this.time = Math.floor(this.time / DAY_LENGTH + 1) * DAY_LENGTH;
    this.broadcast({ t: 'time', time: this.time, rate: this.doDaylightCycle ? this.timeRate : 0 });
    this.systemMessage(`${p.name} slept through the night`, '#ffff55');
  }

  throwProjectile(p: Player, damage: number) {
    const d = p.lookDir();
    const speed = damage > 0 ? 3 : 1.5;
    const a = new ArrowEntity(this, p.x + d[0] * 0.5, p.y + p.eyeHeight - 0.1 + d[1] * 0.5, p.z + d[2] * 0.5, d[0] * speed, d[1] * speed, d[2] * speed, p, damage || 0.001);
    this.addEntity(a);
    this.playSound(damage > 0 ? 'bow' : 'throw', p.x, p.y + 1.5, p.z);
  }

  // ---- Hooks (agents observe these) ----------------------------------------------------------

  onCrafted(p: Player, stack: ItemStack) {
    this.agents?.onCrafted(p, stack);
  }
  onItemPickup(p: Player, _e: ItemEntity, stack: ItemStack) {
    this.agents?.onItemPickup(p, stack);
  }
  onMobKilled(mob: Mob, killer: Entity | null) {
    this.agents?.onMobKilled(mob, killer);
  }
  onPlayerDied(p: Player) {
    this.agents?.onPlayerDied(p);
  }
  onPlayerRespawn(p: Player) {
    // Force re-tracking so others see the player at the new location
    for (const o of this.players) {
      if (o !== p && o.tracked.delete(p.id)) o.send({ t: 'despawn', ids: [p.id] });
    }
  }

  // ---- Chunks ----------------------------------------------------------------------------------

  private onChunkLoaded(cx: number, cz: number) {
    // Populate passive animals in fresh grassy chunks occasionally
    if (!this.doMobSpawning) return;
    const c = this.world.getChunk(cx, cz);
    if (!c || Math.random() > 0.08) return;
    const bio = c.biomes[8 | (8 << 4)];
    if (bio === Biome.Ocean || bio === Biome.DeepOcean || bio === Biome.Desert) return;
    const kind = PASSIVE[Math.floor(Math.random() * PASSIVE.length)];
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(Math.random() * 16), z = Math.floor(Math.random() * 16);
      const y = c.heightmap[x | (z << 4)];
      if ((c.get(x, y, z) & 0xff) !== B.grass) continue;
      const m = new Mob(this, kind, cx * 16 + x + 0.5, y + 1, cz * 16 + z + 0.5);
      m.persistent = true;
      this.addEntity(m);
    }
  }

  private streamChunks(p: Player) {
    const wanted = p.wantedChunks();
    const r = p.viewDistance;
    let budget = p.isAgent ? 0 : 6;
    let requests = 0;
    const buffered = p.conn.bufferedAmount?.() ?? 0;
    if (buffered > 4_000_000) budget = 0;
    for (const [cx, cz] of wanted) {
      const k = numKey(cx, cz);
      this.world.lastNeeded.set(k, this.world.tick);
      if (p.sentChunks.has(k)) continue;
      const c = this.world.getChunk(cx, cz);
      if (c) {
        if (p.isAgent) {
          p.sentChunks.add(k);
          continue;
        }
        if (budget <= 0) continue;
        p.conn.sendBinary(encodeChunkPacket(c));
        p.sentChunks.add(k);
        budget--;
      } else if (requests < 12) {
        requests++;
        this.world.requestChunk(cx, cz);
      }
    }
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    for (const k of p.sentChunks) {
      const cx = Math.floor(k / 65536) - 32768, cz = (k % 65536) - 32768;
      if (Math.abs(cx - pcx) > r + 2 || Math.abs(cz - pcz) > r + 2) {
        p.sentChunks.delete(k);
        if (!p.isAgent) p.send({ t: 'unload', cx, cz });
      }
    }
  }

  private trackEntities(p: Player) {
    const spawnList: Entity[] = [];
    const gone: number[] = [];
    const range = Math.min(p.viewDistance * 16, 96);
    for (const e of this.entities.values()) {
      if (e === p) continue;
      const inRange = !e.removed && Math.abs(e.x - p.x) < range && Math.abs(e.z - p.z) < range && p.isChunkSent(Math.floor(e.x) >> 4, Math.floor(e.z) >> 4);
      const tracked = p.tracked.has(e.id);
      if (inRange && !tracked) {
        if (e instanceof Player && e.dead) continue;
        spawnList.push(e);
        p.tracked.add(e.id);
      } else if (!inRange && tracked) {
        gone.push(e.id);
        p.tracked.delete(e.id);
      }
    }
    for (const id of p.tracked) {
      const e = this.entities.get(id);
      if (!e) {
        gone.push(id);
        p.tracked.delete(id);
      }
    }
    if (p.isAgent) return;
    for (const e of spawnList) p.send({ t: 'spawn', e: e.state() });
    if (gone.length) p.send({ t: 'despawn', ids: gone });
  }

  private step() {
    this.tick++;
    if (this.doDaylightCycle) this.time += this.timeRate;
    this.world.tickScheduled();

    // Entities
    for (const e of this.entities.values()) {
      if (!e.removed) e.tick();
    }
    this.agents?.tick();
    // Collect removed
    const removed: number[] = [];
    for (const [id, e] of this.entities) {
      if (e.removed && !(e instanceof Player)) {
        this.entities.delete(id);
        removed.push(id);
      }
    }

    // Streaming, tracking and movement broadcast
    const moved: number[] = [];
    for (const e of this.entities.values()) {
      const s = e.sent;
      if (Math.abs(s.x - e.x) > 0.001 || Math.abs(s.y - e.y) > 0.001 || Math.abs(s.z - e.z) > 0.001 || Math.abs(s.yaw - e.yaw) > 0.01 || Math.abs(s.pitch - e.pitch) > 0.01 || isNaN(s.x)) {
        s.x = e.x; s.y = e.y; s.z = e.z; s.yaw = e.yaw; s.pitch = e.pitch;
        moved.push(e.id);
      }
    }
    for (const p of this.players) {
      this.streamChunks(p);
      this.trackEntities(p);
      if (p.isAgent) continue;
      const d: number[] = [];
      for (const id of moved) {
        if (id === p.id || !p.tracked.has(id)) continue;
        const e = this.entities.get(id)!;
        d.push(id, r3(e.x), r3(e.y), r3(e.z), r2(e.yaw), r2(e.pitch));
      }
      if (d.length) p.send({ t: 'moves', d });
    }

    this.tickFurnaces();

    // Random ticks near players
    if (this.players.size) {
      const done = new Set<number>();
      for (const p of this.players) {
        const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
        for (let dz = -6; dz <= 6; dz++)
          for (let dx = -6; dx <= 6; dx++) {
            const k = numKey(pcx + dx, pcz + dz);
            if (done.has(k)) continue;
            done.add(k);
            this.world.randomTick(pcx + dx, pcz + dz, (x, y, z, id) => this.growTree(x, y, z, id));
          }
      }
    }

    if (this.tick % 20 === 0) {
      if (this.doMobSpawning) this.spawnMobs();
      this.broadcast({ t: 'time', time: this.time, rate: this.doDaylightCycle ? this.timeRate : 0 });
    }
    if (this.tick % 200 === 0) this.world.unloadUnneeded(600);
  }

  private spawnMobs() {
    const humans = [...this.players].filter((p) => !p.dead);
    if (!humans.length) return;
    let hostileCount = 0, passiveCount = 0;
    for (const e of this.entities.values()) {
      if (!(e instanceof Mob)) continue;
      if (e.hostile) hostileCount++;
      else passiveCount++;
    }
    const perPlayerHostile = 16, perPlayerPassive = 12;
    for (const p of humans) {
      const night = !this.isDay();
      // Hostile mobs
      if (hostileCount < perPlayerHostile * humans.length && Math.random() < 0.5) {
        const pos = this.findSpawnSpot(p, true, night);
        if (pos) {
          const kind = HOSTILE[Math.floor(Math.random() * HOSTILE.length)];
          const m = new Mob(this, kind, pos[0] + 0.5, pos[1], pos[2] + 0.5);
          this.addEntity(m);
          hostileCount++;
        }
      }
      // Passive mobs during the day on grass
      if (passiveCount < perPlayerPassive * humans.length && Math.random() < 0.05) {
        const pos = this.findSpawnSpot(p, false, false);
        if (pos && (this.world.getBlock(pos[0], pos[1] - 1, pos[2]) & 0xff) === B.grass) {
          const kind = PASSIVE[Math.floor(Math.random() * PASSIVE.length)];
          for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
            const m = new Mob(this, kind, pos[0] + 0.5 + Math.random(), pos[1], pos[2] + 0.5 + Math.random());
            m.persistent = true;
            this.addEntity(m);
            passiveCount++;
          }
        }
      }
    }
  }

  private findSpawnSpot(p: Player, hostile: boolean, surfaceOk: boolean): [number, number, number] | null {
    const a = Math.random() * Math.PI * 2;
    const d = 24 + Math.random() * 32;
    const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
    if (!this.world.isLoaded(x, z)) return null;
    const h = this.world.getHeight(x, z);
    let y: number;
    if (!hostile || (surfaceOk && Math.random() < 0.6)) y = h + 1;
    else y = 5 + Math.floor(Math.random() * Math.max(1, h - 8));
    // Find floor
    for (let i = 0; i < 16 && y > 1; i++, y--) {
      const below = this.world.getBlock(x, y - 1, z) & 0xff;
      const here = this.world.getBlock(x, y, z) & 0xff;
      const above = this.world.getBlock(x, y + 1, z) & 0xff;
      if (BLOCKS[below].solid && BLOCKS[below].opaque && here === 0 && above === 0) break;
    }
    const below = this.world.getBlock(x, y - 1, z) & 0xff;
    if (!BLOCKS[below].solid || (this.world.getBlock(x, y, z) & 0xff) !== 0 || (this.world.getBlock(x, y + 1, z) & 0xff) !== 0) return null;
    if (below === B.water || below === B.lava || isLeavesId(below)) return null;
    if (hostile) {
      const sky = this.world.getSkyLight(x, y, z) - this.skyDarkening();
      const blk = this.world.getBlockLight(x, y, z);
      if (Math.max(sky, blk) > 0 && !(Math.max(sky, blk) <= 7 && Math.random() < 0.3)) return null;
      if (y > SEA_LEVEL - 10 && this.isDay() && this.world.getSkyLight(x, y, z) > 8) return null;
    } else if (this.world.getSkyLight(x, y, z) < 9) return null;
    // not too close to any player
    for (const o of this.players) if (Math.hypot(o.x - x, o.y - y, o.z - z) < 20) return null;
    return [x, y, z];
  }
}

function isLeavesId(id: number) {
  return id === B.oakLeaves || id === B.birchLeaves || id === B.spruceLeaves;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

function sanitize(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export { MOB_SPECS };
