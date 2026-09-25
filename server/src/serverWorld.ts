import { Worker } from 'node:worker_threads';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { World, numKey } from '../../shared/src/world';
import { Chunk, decodeBlocks, encodeBlocks } from '../../shared/src/chunk';
import { B, BLOCKS, blockOf, makeState, isLeaves, isLog } from '../../shared/src/blocks';
import { WORLD_HEIGHT, FACE_DIRS } from '../../shared/src/constants';
import { WorldGenerator } from '../../shared/src/worldgen';
import { hash3 } from '../../shared/src/noise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Pending {
  resolve: (c: Chunk) => void;
  promise: Promise<Chunk>;
}

export interface WorldEvents {
  blockChanged(x: number, y: number, z: number, state: number, prev: number): void;
  dropBlockItems(x: number, y: number, z: number, state: number): void;
  spawnFalling(x: number, y: number, z: number, state: number): void;
  chunkLoaded(chunk: Chunk): void;
}

const H4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const LANTERN = BLOCKS.find((b) => b.name === 'lantern')!.id;

export class ServerWorld extends World {
  readonly gen: WorldGenerator;
  readonly dir: string;
  private workers: Worker[] = [];
  private nextWorker = 0;
  private reqId = 0;
  private waiting = new Map<number, (c: { cx: number; cz: number; blocks: Uint16Array; biomes: Uint8Array }) => void>();
  private pending = new Map<number, Pending>();
  /** Scheduled block ticks: tick -> packed positions */
  private scheduled = new Map<number, number[]>();
  private scheduledSet = new Set<string>();
  tick = 0;
  events!: WorldEvents;
  /** Last tick each chunk was needed by a player (for unloading). */
  lastNeeded = new Map<number, number>();

  constructor(seed: number, dir: string) {
    super();
    this.gen = new WorldGenerator(seed);
    this.dir = dir;
    fs.mkdirSync(path.join(dir, 'chunks'), { recursive: true });
    const n = Math.max(1, Math.min(6, os.cpus().length - 1));
    const workerFile = path.join(__dirname, 'genWorker.ts');
    for (let i = 0; i < n; i++) {
      const w = new Worker(workerFile, { workerData: { seed }, execArgv: ['--import', 'tsx'] });
      w.on('message', (m) => {
        const cb = this.waiting.get(m.id);
        if (cb) {
          this.waiting.delete(m.id);
          cb(m);
        }
      });
      w.on('error', (e) => console.error('gen worker error', e));
      this.workers.push(w);
    }
  }

  private chunkFile(cx: number, cz: number) {
    return path.join(this.dir, 'chunks', `${cx}_${cz}.bin`);
  }

  /** Get or load/generate a chunk. */
  requestChunk(cx: number, cz: number): Promise<Chunk> {
    const existing = this.getChunk(cx, cz);
    if (existing) return Promise.resolve(existing);
    const k = numKey(cx, cz);
    const p = this.pending.get(k);
    if (p) return p.promise;
    let resolve!: (c: Chunk) => void;
    const promise = new Promise<Chunk>((r) => (resolve = r));
    this.pending.set(k, { resolve, promise });

    const finish = (chunk: Chunk) => {
      this.pending.delete(k);
      if (!this.getChunk(cx, cz)) {
        this.addChunk(chunk);
        this.events?.chunkLoaded(chunk);
      }
      resolve(this.getChunk(cx, cz)!);
    };

    const file = this.chunkFile(cx, cz);
    if (fs.existsSync(file)) {
      fs.readFile(file, (err, data) => {
        if (!err) {
          try {
            const raw = zlib.inflateSync(data);
            const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
            const biomes = new Uint8Array(buf, 0, 256);
            const rle = new Uint16Array(buf.slice(256));
            const chunk = new Chunk(cx, cz, decodeBlocks(rle));
            chunk.biomes.set(biomes);
            finish(chunk);
            return;
          } catch (e) {
            console.warn(`Corrupt chunk ${cx},${cz}, regenerating`, e);
          }
        }
        this.generateAsync(cx, cz, finish);
      });
    } else this.generateAsync(cx, cz, finish);
    return promise;
  }

  private generateAsync(cx: number, cz: number, done: (c: Chunk) => void) {
    const id = ++this.reqId;
    this.waiting.set(id, (m) => {
      const c = new Chunk(cx, cz, m.blocks);
      c.biomes.set(m.biomes);
      done(c);
    });
    const w = this.workers[this.nextWorker++ % this.workers.length];
    w.postMessage({ id, cx, cz });
  }

  saveChunk(c: Chunk) {
    const rle = encodeBlocks(c.blocks);
    const buf = Buffer.alloc(256 + rle.byteLength);
    buf.set(c.biomes, 0);
    Buffer.from(rle.buffer, rle.byteOffset, rle.byteLength).copy(buf, 256);
    fs.writeFileSync(this.chunkFile(c.cx, c.cz), zlib.deflateSync(buf));
    c.dirty = false;
  }

  saveAll() {
    let n = 0;
    for (const c of this.chunks.values())
      if (c.dirty) {
        this.saveChunk(c);
        n++;
      }
    return n;
  }

  unloadUnneeded(keepTicks = 600) {
    for (const [k, c] of this.chunks) {
      const last = this.lastNeeded.get(k) ?? 0;
      if (this.tick - last > keepTicks) {
        if (c.dirty) this.saveChunk(c);
        this.removeChunk(c.cx, c.cz);
        this.lastNeeded.delete(k);
      }
    }
  }

  shutdown() {
    this.saveAll();
    for (const w of this.workers) w.terminate();
  }

  // ---- Block updates ----------------------------------------------------------------------

  /** Set a block, notify listeners and neighbours. */
  set(x: number, y: number, z: number, state: number, notify = true): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const prev = this.setBlock(x, y, z, state);
    if (prev === state) return prev;
    this.events?.blockChanged(x, y, z, state, prev);
    if (notify) {
      this.neighborChanged(x, y, z);
      for (const [dx, dy, dz] of FACE_DIRS) this.neighborChanged(x + dx, y + dy, z + dz);
    }
    if (isLog(prev & 0xff)) this.scheduleLeafDecay(x, y, z);
    return prev;
  }

  schedule(x: number, y: number, z: number, delay: number) {
    const key = `${x},${y},${z}`;
    if (this.scheduledSet.has(key)) return;
    this.scheduledSet.add(key);
    const t = this.tick + Math.max(1, delay);
    let list = this.scheduled.get(t);
    if (!list) this.scheduled.set(t, (list = []));
    list.push(x, y, z);
  }

  private neighborChanged(x: number, y: number, z: number) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const s = this.getBlock(x, y, z);
    const id = s & 0xff;
    const def = BLOCKS[id];
    if (def.fluid) this.schedule(x, y, z, id === B.water ? 5 : 30);
    else if (def.gravity) this.schedule(x, y, z, 2);
    else if (def.needsSupport) this.schedule(x, y, z, 1);
    else if (id === B.grass && BLOCKS[this.getBlock(x, y + 1, z) & 0xff].opaque) this.schedule(x, y, z, 20);
    // Fluids adjacent to a now-empty cell need to flow into it
    if (id === 0 || def.replaceable) {
      for (const [dx, dy, dz] of FACE_DIRS) {
        const n = this.getBlock(x + dx, y + dy, z + dz);
        if (BLOCKS[n & 0xff].fluid && dy >= 0) this.schedule(x + dx, y + dy, z + dz, (n & 0xff) === B.water ? 5 : 30);
      }
    }
  }

  tickScheduled() {
    this.tick++;
    const list = this.scheduled.get(this.tick);
    if (!list) return;
    this.scheduled.delete(this.tick);
    for (let i = 0; i < list.length; i += 3) {
      const x = list[i], y = list[i + 1], z = list[i + 2];
      this.scheduledSet.delete(`${x},${y},${z}`);
      if (!this.isLoaded(x, z)) continue;
      this.updateBlock(x, y, z);
    }
  }

  private updateBlock(x: number, y: number, z: number) {
    const s = this.getBlock(x, y, z);
    const id = s & 0xff;
    const def = BLOCKS[id];
    if (def.fluid) return this.updateFluid(x, y, z, s);
    if (def.gravity) {
      const below = this.getBlock(x, y - 1, z);
      const bd = blockOf(below);
      if (y > 0 && (below & 0xff) === 0 || bd.fluid || (bd.replaceable && !bd.solid)) {
        this.set(x, y, z, 0);
        this.events.spawnFalling(x, y, z, s);
      }
      return;
    }
    if (def.needsSupport && !this.hasSupport(x, y, z, s)) {
      this.set(x, y, z, 0);
      this.events.dropBlockItems(x, y, z, s);
      return;
    }
    if (id === B.grass && BLOCKS[this.getBlock(x, y + 1, z) & 0xff].opaque) this.set(x, y, z, B.dirt);
    if (isLeaves(id)) this.checkLeafDecay(x, y, z, s);
  }

  hasSupport(x: number, y: number, z: number, s: number): boolean {
    const id = s & 0xff;
    const below = this.getBlock(x, y - 1, z) & 0xff;
    const bdef = BLOCKS[below];
    if (id === B.torch || id === LANTERN) {
      const m = s >> 8;
      if (m === 2) return bdef.solid; // standing on the floor
      if (m === 3) return BLOCKS[this.getBlock(x, y + 1, z) & 0xff].solid; // hanging
      // wall torch: meta = face it is attached on (0..5), support is opposite
      const d = FACE_DIRS[m];
      return BLOCKS[this.getBlock(x - d[0], y, z - d[2]) & 0xff].solid;
    }
    if (id === B.ladder) {
      const d = FACE_DIRS[s >> 8] ?? FACE_DIRS[4];
      return BLOCKS[this.getBlock(x - d[0], y, z - d[2]) & 0xff].solid;
    }
    if (id === B.cactus) {
      for (const [dx, dz] of H4) if (BLOCKS[this.getBlock(x + dx, y, z + dz) & 0xff].solid) return false;
      return below === B.sand || below === B.redSand || below === B.cactus;
    }
    if (id === B.sugarCane) {
      if (below === B.sugarCane) return true;
      if (below !== B.grass && below !== B.dirt && below !== B.sand) return false;
      for (const [dx, dz] of H4) if ((this.getBlock(x + dx, y - 1, z + dz) & 0xff) === B.water) return true;
      return false;
    }
    if (id === B.wheat) return below === B.farmland;
    if (id === B.deadBush) return below === B.sand || below === B.redSand || below === B.dirt || below === B.terracotta;
    if (id === B.redMushroom || id === B.brownMushroom) return bdef.opaque;
    if (id === B.snow) return bdef.opaque || isLeaves(below);
    // plants
    return below === B.grass || below === B.dirt || below === B.farmland || below === B.mossBlock;
  }

  // ---- Fluids -------------------------------------------------------------------------------

  private updateFluid(x: number, y: number, z: number, s: number) {
    const id = s & 0xff;
    const isWater = id === B.water;
    const meta = s >> 8;
    const level = meta & 7;
    const falling = (meta & 8) !== 0;
    const drop = isWater ? 1 : 2;
    const maxLevel = isWater ? 7 : 6;
    const delay = isWater ? 5 : 30;

    // Lava meeting water
    if (!isWater) {
      for (const [dx, dy, dz] of FACE_DIRS) {
        if (dy < 0) continue;
        if ((this.getBlock(x + dx, y + dy, z + dz) & 0xff) === B.water) {
          this.set(x, y, z, level === 0 && !falling ? B.obsidian : B.cobblestone);
          return;
        }
      }
    }

    let newMeta = meta;
    if (level !== 0 || falling) {
      // Recompute level from neighbours
      const above = this.getBlock(x, y + 1, z);
      let sources = 0;
      let best = 99;
      for (const [dx, dz] of H4) {
        const n = this.getBlock(x + dx, y, z + dz);
        if ((n & 0xff) !== id) continue;
        const nm = n >> 8;
        const nl = nm & 8 ? 0 : nm & 7;
        if ((nm & 7) === 0 && !(nm & 8)) sources++;
        best = Math.min(best, nl + drop);
      }
      if ((above & 0xff) === id) newMeta = 8;
      else if (isWater && sources >= 2 && (blockOf(this.getBlock(x, y - 1, z)).solid || this.getBlock(x, y - 1, z) === makeState(id, 0))) newMeta = 0;
      else if (best <= maxLevel) newMeta = best;
      else newMeta = -1;
      if (newMeta === -1) {
        this.set(x, y, z, 0);
        return;
      }
      if (newMeta !== meta) {
        this.set(x, y, z, makeState(id, newMeta));
        return; // neighbours rescheduled by set()
      }
    }

    // Spread
    const below = this.getBlock(x, y - 1, z);
    const bdef = blockOf(below);
    if (y > 0 && this.canFlowInto(below, id)) {
      if ((below & 0xff) === B.lava && isWater) this.set(x, y - 1, z, (below >> 8) === 0 ? B.obsidian : B.cobblestone);
      else {
        if (bdef.replaceable && !bdef.fluid && (below & 0xff) !== 0) this.events.dropBlockItems(x, y - 1, z, below);
        this.set(x, y - 1, z, makeState(id, 8));
      }
      return;
    }
    if (bdef.fluid && (below & 0xff) === id && !(level === 0 && !falling)) return; // flowing onto fluid: don't spread sideways
    const cur = newMeta & 8 ? 0 : newMeta & 7;
    const next = cur + drop;
    if (next > maxLevel) return;
    for (const [dx, dz] of H4) {
      const n = this.getBlock(x + dx, y, z + dz);
      const nid = n & 0xff;
      if (nid === id) {
        const nm = n >> 8;
        if (!(nm & 8) && (nm & 7) > next) this.set(x + dx, y, z + dz, makeState(id, next));
        continue;
      }
      if (!this.canFlowInto(n, id)) continue;
      if (nid === B.lava && isWater) {
        this.set(x + dx, y, z + dz, (n >> 8) === 0 ? B.obsidian : B.cobblestone);
        continue;
      }
      if (nid === B.water && !isWater) {
        this.set(x, y, z, B.cobblestone);
        return;
      }
      const nd = BLOCKS[nid];
      if (nid !== 0 && nd.replaceable && !nd.fluid) this.events.dropBlockItems(x + dx, y, z + dz, n);
      this.set(x + dx, y, z + dz, makeState(id, next));
    }
    void delay;
  }

  private canFlowInto(state: number, fluidId: number): boolean {
    const id = state & 0xff;
    if (id === 0) return true;
    const d = BLOCKS[id];
    if (d.fluid) return id !== fluidId || (state >> 8) !== 0;
    return !d.solid && (d.replaceable || d.shape === 'cross' || d.shape === 'crop' || d.shape === 'torch' || d.shape === 'snow_layer');
  }

  // ---- Leaves -------------------------------------------------------------------------------

  private scheduleLeafDecay(x: number, y: number, z: number) {
    for (let dx = -4; dx <= 4; dx++)
      for (let dy = -4; dy <= 4; dy++)
        for (let dz = -4; dz <= 4; dz++) {
          const s = this.getBlock(x + dx, y + dy, z + dz);
          if (isLeaves(s & 0xff) && !((s >> 8) & 4)) this.schedule(x + dx, y + dy, z + dz, 20 + Math.floor(Math.random() * 200));
        }
  }

  /** Leaves with meta bit 2 set were placed by players and never decay. */
  private checkLeafDecay(x: number, y: number, z: number, s: number) {
    if ((s >> 8) & 4) return;
    // BFS through leaves up to distance 4 looking for a log
    const seen = new Set<string>();
    let frontier: [number, number, number][] = [[x, y, z]];
    for (let d = 0; d <= 4; d++) {
      const next: [number, number, number][] = [];
      for (const [px, py, pz] of frontier) {
        for (const [dx, dy, dz] of FACE_DIRS) {
          const nx = px + dx, ny = py + dy, nz = pz + dz;
          const k = `${nx},${ny},${nz}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const id = this.getBlock(nx, ny, nz) & 0xff;
          if (isLog(id)) return;
          if (isLeaves(id)) next.push([nx, ny, nz]);
        }
      }
      frontier = next;
    }
    this.set(x, y, z, 0);
    this.events.dropBlockItems(x, y, z, s);
  }

  // ---- Random ticks -------------------------------------------------------------------------

  randomTick(cx: number, cz: number, growTree: (x: number, y: number, z: number, kind: number) => void) {
    const c = this.getChunk(cx, cz);
    if (!c) return;
    const maxY = Math.min(WORLD_HEIGHT - 1, c.maxHeight() + 1);
    for (let i = 0; i < 12; i++) {
      const r = Math.random();
      const x = Math.floor(r * 16), z = Math.floor(Math.random() * 16), y = Math.floor(Math.random() * (maxY + 1));
      const s = c.get(x, y, z);
      const id = s & 0xff;
      if (id === 0) continue;
      const wx = cx * 16 + x, wz = cz * 16 + z;
      if (id === B.grass) {
        const above = BLOCKS[this.getBlock(wx, y + 1, wz) & 0xff];
        if (above.opaque) {
          this.set(wx, y, wz, B.dirt);
          continue;
        }
        // Spread to nearby dirt with light
        for (let k = 0; k < 2; k++) {
          const tx = wx + Math.floor(Math.random() * 3) - 1, ty = y + Math.floor(Math.random() * 5) - 3, tz = wz + Math.floor(Math.random() * 3) - 1;
          if ((this.getBlock(tx, ty, tz) & 0xff) === B.dirt && !BLOCKS[this.getBlock(tx, ty + 1, tz) & 0xff].opaque && this.getLightLevel(tx, ty + 1, tz) >= 9)
            this.set(tx, ty, tz, B.grass);
        }
      } else if (id === B.wheat) {
        const age = s >> 8;
        if (age < 7 && this.getLightLevel(wx, y + 1, wz) >= 9 && Math.random() < 0.35) this.set(wx, y, wz, makeState(B.wheat, age + 1));
      } else if (id === B.oakSapling || id === B.birchSapling || id === B.spruceSapling) {
        if (this.getLightLevel(wx, y + 1, wz) >= 9 && Math.random() < 0.12) growTree(wx, y, wz, id);
      } else if (id === B.sugarCane || id === B.cactus) {
        if ((this.getBlock(wx, y + 1, wz) & 0xff) === 0 && Math.random() < 0.1) {
          let h = 1;
          while ((this.getBlock(wx, y - h, wz) & 0xff) === id) h++;
          if (h < 3) this.set(wx, y + 1, wz, id);
        }
      } else if (id === B.farmland) {
        // Hydrate if water within 4 blocks
        let wet = false;
        for (let dx = -4; dx <= 4 && !wet; dx++)
          for (let dz = -4; dz <= 4 && !wet; dz++)
            for (let dy = 0; dy <= 1 && !wet; dy++) if ((this.getBlock(wx + dx, y + dy, wz + dz) & 0xff) === B.water) wet = true;
        const m = s >> 8;
        if (wet && m !== 7) this.set(wx, y, wz, makeState(B.farmland, 7));
        else if (!wet) {
          if (m > 0) this.set(wx, y, wz, makeState(B.farmland, m - 1));
          else if ((this.getBlock(wx, y + 1, wz) & 0xff) !== B.wheat) this.set(wx, y, wz, B.dirt);
        }
      } else if (id === B.ice && this.getBlockLight(wx, y, wz) > 11) {
        this.set(wx, y, wz, B.water);
      }
    }
    void hash3;
  }
}
