import { BLOCKS } from './blocks';
import { Chunk } from './chunk';
import { WORLD_HEIGHT } from './constants';

export const numKey = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

const OPAQUE = new Uint8Array(256);
const FILTER = new Uint8Array(256);
const EMIT = new Uint8Array(256);
for (const b of BLOCKS) {
  OPAQUE[b.id] = b.opaque ? 1 : 0;
  FILTER[b.id] = b.lightFilter;
  EMIT[b.id] = b.lightEmission;
}
// Slabs / farmland are not full cubes but still block light in Minecraft
OPAQUE[BLOCKS.find((b) => b.name === 'farmland')!.id] = 0;

/** Growable FIFO of packed (x,y,z,level) entries. */
class Queue {
  xs = new Int32Array(4096);
  ys = new Int16Array(4096);
  zs = new Int32Array(4096);
  ls = new Uint8Array(4096);
  head = 0;
  tail = 0;
  push(x: number, y: number, z: number, l: number) {
    if (this.tail >= this.xs.length) {
      if (this.head > 0) this.compact();
      if (this.tail >= this.xs.length) this.grow();
    }
    const t = this.tail++;
    this.xs[t] = x;
    this.ys[t] = y;
    this.zs[t] = z;
    this.ls[t] = l;
  }
  private compact() {
    const n = this.tail - this.head;
    this.xs.copyWithin(0, this.head, this.tail);
    this.ys.copyWithin(0, this.head, this.tail);
    this.zs.copyWithin(0, this.head, this.tail);
    this.ls.copyWithin(0, this.head, this.tail);
    this.head = 0;
    this.tail = n;
  }
  private grow() {
    const n = this.xs.length * 2;
    const g = <T extends Int32Array | Int16Array | Uint8Array>(a: T, C: new (n: number) => T) => {
      const b = new C(n);
      b.set(a);
      return b;
    };
    this.xs = g(this.xs, Int32Array);
    this.ys = g(this.ys, Int16Array);
    this.zs = g(this.zs, Int32Array);
    this.ls = g(this.ls, Uint8Array);
  }
  get empty() {
    return this.head >= this.tail;
  }
  reset() {
    this.head = this.tail = 0;
  }
}

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];

/**
 * Voxel world container with Minecraft-style sky + block light propagation.
 * Shared by server (authoritative simulation) and client (rendering).
 */
export class World {
  chunks = new Map<number, Chunk>();
  /** Chunks whose render-relevant data (blocks or light) changed. Consumers clear it. */
  dirtyChunks = new Set<number>();
  /** Set false to skip lighting entirely (e.g. server-side world gen). */
  lightingEnabled = true;

  private lastChunk: Chunk | null = null;
  private lastKey = -1;
  private addQ = new Queue();
  private remQ = new Queue();

  getChunk(cx: number, cz: number): Chunk | undefined {
    const k = numKey(cx, cz);
    if (k === this.lastKey) return this.lastChunk!;
    const c = this.chunks.get(k);
    if (c) {
      this.lastKey = k;
      this.lastChunk = c;
    }
    return c;
  }

  hasChunk(cx: number, cz: number) {
    return this.chunks.has(numKey(cx, cz));
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.blocks[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }

  isLoaded(x: number, z: number) {
    return !!this.getChunk(x >> 4, z >> 4);
  }

  getSkyLight(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 15;
    if (y < 0) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 15;
    return c.light[(x & 15) | ((z & 15) << 4) | (y << 8)] >> 4;
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.light[(x & 15) | ((z & 15) << 4) | (y << 8)] & 15;
  }

  /** Combined light level (0-15) given current sky darkening (0 = day, 11 = night). */
  getLightLevel(x: number, y: number, z: number, skyDarken = 0): number {
    return Math.max(this.getSkyLight(x, y, z) - skyDarken, this.getBlockLight(x, y, z));
  }

  getHeight(x: number, z: number): number {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return -1;
    return c.heightmap[(x & 15) | ((z & 15) << 4)];
  }

  addChunk(chunk: Chunk) {
    const k = numKey(chunk.cx, chunk.cz);
    this.chunks.set(k, chunk);
    this.lastKey = -1;
    if (this.lightingEnabled) this.initChunkLight(chunk);
    // This chunk and all 8 neighbours may have faces/lighting that depend on it
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.markDirty(chunk.cx + dx, chunk.cz + dz);
  }

  removeChunk(cx: number, cz: number) {
    this.chunks.delete(numKey(cx, cz));
    this.dirtyChunks.delete(numKey(cx, cz));
    this.lastKey = -1;
    this.lastChunk = null;
  }

  markDirty(cx: number, cz: number) {
    const k = numKey(cx, cz);
    if (this.chunks.has(k)) this.dirtyChunks.add(k);
  }

  private markDirtyAt(x: number, z: number) {
    const cx = x >> 4, cz = z >> 4;
    this.markDirty(cx, cz);
    const lx = x & 15, lz = z & 15;
    if (lx === 0) this.markDirty(cx - 1, cz);
    else if (lx === 15) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    else if (lz === 15) this.markDirty(cx, cz + 1);
  }

  /**
   * Set a block state. Returns previous state. Updates lighting incrementally.
   */
  setBlock(x: number, y: number, z: number, state: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    const lx = x & 15, lz = z & 15;
    const idx = lx | (lz << 4) | (y << 8);
    const prev = c.blocks[idx];
    if (prev === state) return prev;
    c.set(lx, y, lz, state);
    this.markDirtyAt(x, z);
    // corners: diagonal neighbours matter for AO
    if ((lx === 0 || lx === 15) && (lz === 0 || lz === 15)) {
      this.markDirty((x >> 4) + (lx === 0 ? -1 : 1), (z >> 4) + (lz === 0 ? -1 : 1));
    }
    if (this.lightingEnabled && c.lightReady) this.updateLightAt(x, y, z, prev & 0xff, state & 0xff);
    return prev;
  }

  // ---- Lighting ----------------------------------------------------------------------------

  private rawLight(x: number, y: number, z: number): number {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return -1;
    return c.light[(x & 15) | ((z & 15) << 4) | (y << 8)];
  }

  private initChunkLight(c: Chunk) {
    const light = c.light;
    const blocks = c.blocks;
    light.fill(0);
    const q = this.addQ;
    q.reset();
    const bx = c.cx * 16, bz = c.cz * 16;
    // Max terrain height including neighbours for seeding horizontal spread
    let maxH = c.maxHeight();
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.getChunk(c.cx + ox, c.cz + oz);
      if (n) maxH = Math.max(maxH, n.maxHeight());
    }
    // 1) Sky columns
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        let level = 15;
        const col = x | (z << 4);
        const top = c.heightmap[col];
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          const i = col | (y << 8);
          if (y > top) {
            light[i] = 0xf0;
            continue;
          }
          const id = blocks[i] & 0xff;
          if (OPAQUE[id]) level = 0;
          else if (FILTER[id]) level = Math.max(0, level - FILTER[id]);
          if (level === 0) break;
          light[i] = level << 4;
        }
      }
    // 2) Seed horizontal spread for cells in the "interesting" y band
    const yMax = Math.min(WORLD_HEIGHT - 1, maxH + 1);
    for (let y = 0; y <= yMax; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const l = light[x | (z << 4) | (y << 8)] >> 4;
          if (l > 1) q.push(bx + x, y, bz + z, l);
        }
    // Pull light from existing neighbours' border cells
    for (let y = 0; y <= yMax; y++)
      for (let i = 0; i < 16; i++) {
        this.seedFrom(bx - 1, y, bz + i, q, true);
        this.seedFrom(bx + 16, y, bz + i, q, true);
        this.seedFrom(bx + i, y, bz - 1, q, true);
        this.seedFrom(bx + i, y, bz + 16, q, true);
      }
    this.propagate(q, true);

    // 3) Block light
    q.reset();
    for (let i = 0; i < blocks.length; i++) {
      const e = EMIT[blocks[i] & 0xff];
      if (e) {
        light[i] = (light[i] & 0xf0) | e;
        q.push(bx + (i & 15), i >> 8, bz + ((i >> 4) & 15), e);
      }
    }
    for (let y = 0; y < WORLD_HEIGHT; y++)
      for (let i = 0; i < 16; i++) {
        this.seedFrom(bx - 1, y, bz + i, q, false);
        this.seedFrom(bx + 16, y, bz + i, q, false);
        this.seedFrom(bx + i, y, bz - 1, q, false);
        this.seedFrom(bx + i, y, bz + 16, q, false);
      }
    this.propagate(q, false);
    c.lightReady = true;
  }

  private seedFrom(x: number, y: number, z: number, q: Queue, sky: boolean) {
    const r = this.rawLight(x, y, z);
    if (r < 0) return;
    const l = sky ? r >> 4 : r & 15;
    if (l > 1) q.push(x, y, z, l);
  }

  /** BFS flood fill of light from queued cells. */
  private propagate(q: Queue, sky: boolean) {
    while (!q.empty) {
      const h = q.head++;
      const x = q.xs[h], y = q.ys[h], z = q.zs[h];
      const c0 = this.getChunk(x >> 4, z >> 4);
      if (!c0) continue;
      const cur = c0.light[(x & 15) | ((z & 15) << 4) | (y << 8)];
      const level = sky ? cur >> 4 : cur & 15;
      if (level <= 1 && !(sky && level === 1)) continue;
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const nx = x + DX[d], nz = z + DZ[d];
        const c = this.getChunk(nx >> 4, nz >> 4);
        if (!c) continue;
        const ni = (nx & 15) | ((nz & 15) << 4) | (ny << 8);
        const id = c.blocks[ni] & 0xff;
        if (OPAQUE[id]) continue;
        let nl: number;
        if (sky && d === 3 && level === 15 && FILTER[id] === 0) nl = 15;
        else nl = level - 1 - FILTER[id];
        if (nl <= 0) continue;
        const raw = c.light[ni];
        const existing = sky ? raw >> 4 : raw & 15;
        if (existing >= nl) continue;
        c.light[ni] = sky ? (raw & 0x0f) | (nl << 4) : (raw & 0xf0) | nl;
        this.dirtyChunks.add(numKey(nx >> 4, nz >> 4));
        q.push(nx, ny, nz, nl);
      }
    }
    q.reset();
  }

  private setLight(x: number, y: number, z: number, sky: boolean, v: number) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return;
    const i = (x & 15) | ((z & 15) << 4) | (y << 8);
    const raw = c.light[i];
    c.light[i] = sky ? (raw & 0x0f) | (v << 4) : (raw & 0xf0) | v;
    this.markDirtyAt(x, z);
  }

  private updateLightAt(x: number, y: number, z: number, oldId: number, newId: number) {
    for (const sky of [true, false]) {
      const raw = this.rawLight(x, y, z);
      if (raw < 0) continue;
      const oldLevel = sky ? raw >> 4 : raw & 15;
      const rem = this.remQ;
      const add = this.addQ;
      rem.reset();
      add.reset();
      // Remove the light at this cell and everything that depended on it.
      if (oldLevel > 0) {
        this.setLight(x, y, z, sky, 0);
        rem.push(x, y, z, oldLevel);
      }
      while (!rem.empty) {
        const h = rem.head++;
        const cx = rem.xs[h], cy = rem.ys[h], cz = rem.zs[h], lvl = rem.ls[h];
        for (let d = 0; d < 6; d++) {
          const ny = cy + DY[d];
          if (ny < 0 || ny >= WORLD_HEIGHT) continue;
          const nx = cx + DX[d], nz = cz + DZ[d];
          const r = this.rawLight(nx, ny, nz);
          if (r < 0) continue;
          const nl = sky ? r >> 4 : r & 15;
          if (nl === 0) continue;
          if (nl < lvl || (sky && d === 3 && lvl === 15 && nl === 15)) {
            this.setLight(nx, ny, nz, sky, 0);
            rem.push(nx, ny, nz, nl);
            // an emitter we just darkened must re-emit
            if (!sky) {
              const e = EMIT[this.getBlock(nx, ny, nz) & 0xff];
              if (e) {
                this.setLight(nx, ny, nz, false, e);
                add.push(nx, ny, nz, e);
              }
            }
          } else {
            add.push(nx, ny, nz, nl);
          }
        }
      }
      // New block's own emission / sky exposure
      if (!sky && EMIT[newId]) {
        this.setLight(x, y, z, false, EMIT[newId]);
        add.push(x, y, z, EMIT[newId]);
      }
      if (sky && !OPAQUE[newId] && y >= this.getHeight(x, z)) {
        // Directly under the sky: full light
        const above = y + 1 >= WORLD_HEIGHT ? 15 : this.getSkyLight(x, y + 1, z);
        if (above === 15) {
          const v = Math.max(0, 15 - FILTER[newId]);
          this.setLight(x, y, z, true, v);
          add.push(x, y, z, v);
        }
      }
      // Neighbours spill into the (possibly now transparent) cell
      if (!OPAQUE[newId]) {
        for (let d = 0; d < 6; d++) {
          const ny = y + DY[d];
          if (ny < 0 || ny >= WORLD_HEIGHT) continue;
          const r = this.rawLight(x + DX[d], ny, z + DZ[d]);
          if (r < 0) continue;
          const nl = sky ? r >> 4 : r & 15;
          if (nl > 0) add.push(x + DX[d], ny, z + DZ[d], nl);
        }
      }
      this.propagate(add, sky);
    }
    void oldId;
  }
}
