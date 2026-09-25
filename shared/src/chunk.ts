import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT } from './constants';
import { BLOCKS } from './blocks';

/** Index layout: x + z*16 + y*256 (y-major so horizontal layers are contiguous). */
export const chunkIndex = (x: number, y: number, z: number) => x | (z << 4) | (y << 8);

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  blocks: Uint16Array;
  /** Packed light: high nibble = sky light, low nibble = block light. */
  light: Uint8Array;
  /** Highest y with a non-air block per column, -1 if empty. */
  heightmap: Int16Array;
  /** Biome id per column (x + z*16). */
  biomes: Uint8Array;
  /** Set when block data changes (for saving). */
  dirty = false;
  /** Whether sky light has been initialised. */
  lightReady = false;

  constructor(cx: number, cz: number, blocks?: Uint16Array) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = blocks ?? new Uint16Array(CHUNK_VOLUME);
    this.light = new Uint8Array(CHUNK_VOLUME);
    this.heightmap = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    this.biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.recomputeHeightmap();
  }

  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.blocks[x | (z << 4) | (y << 8)];
  }

  set(x: number, y: number, z: number, v: number) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.blocks[x | (z << 4) | (y << 8)] = v;
    this.dirty = true;
    const hi = x | (z << 4);
    const h = this.heightmap[hi];
    if ((v & 0xff) !== 0) {
      if (y > h) this.heightmap[hi] = y;
    } else if (y === h) {
      let ny = y - 1;
      while (ny >= 0 && (this.blocks[hi | (ny << 8)] & 0xff) === 0) ny--;
      this.heightmap[hi] = ny;
    }
  }

  recomputeHeightmap() {
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const hi = x | (z << 4);
        let y = WORLD_HEIGHT - 1;
        while (y >= 0 && (this.blocks[hi | (y << 8)] & 0xff) === 0) y--;
        this.heightmap[hi] = y;
      }
  }

  /** Highest y with a block that blocks or filters light (for sky light). */
  maxHeight(): number {
    let m = -1;
    for (let i = 0; i < 256; i++) if (this.heightmap[i] > m) m = this.heightmap[i];
    return m;
  }

  getSky(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 15;
    if (y < 0) return 0;
    return this.light[x | (z << 4) | (y << 8)] >> 4;
  }
  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.light[x | (z << 4) | (y << 8)] & 15;
  }
}

// ---- Serialisation (RLE over 16-bit states) ------------------------------------------------------

/** Encode chunk blocks as run-length pairs [count u16, value u16]. */
export function encodeBlocks(blocks: Uint16Array): Uint16Array {
  const out: number[] = [];
  let prev = blocks[0];
  let run = 1;
  for (let i = 1; i < blocks.length; i++) {
    const v = blocks[i];
    if (v === prev && run < 65535) run++;
    else {
      out.push(run, prev);
      prev = v;
      run = 1;
    }
  }
  out.push(run, prev);
  return Uint16Array.from(out);
}

export function decodeBlocks(rle: Uint16Array, out = new Uint16Array(CHUNK_VOLUME)): Uint16Array {
  let o = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const n = rle[i];
    out.fill(rle[i + 1], o, o + n);
    o += n;
  }
  return out;
}

/** True if any block in the chunk emits light (quick check to skip block light work). */
export function chunkHasEmitters(c: Chunk): boolean {
  const b = c.blocks;
  for (let i = 0; i < b.length; i++) if (BLOCKS[b[i] & 0xff].lightEmission) return true;
  return false;
}
