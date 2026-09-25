/**
 * Chunk mesher: converts padded block + light data into packed vertex buffers.
 * Runs inside Web Workers. Pure computation, no DOM / three.js.
 *
 * Vertex format (24 bytes):
 *   a_pos   Int16  x4 : x*16, y*16, z*16 (chunk-local, in 1/16 block units), normal index (0-5, 6 = plant)
 *   a_tex   Uint16 x4 : u*16, v*16 (texture pixel coords * 16), layer, flags
 *   a_light Uint8  x4 : sky*17, block*17, ao*85, extra (0)
 *   a_color Uint8  x4 : tint r, g, b, wave phase
 */
import { BLOCKS, BlockDef, fluidHeight, isLog, isDirectional, doorPanel, stairBoxes, fenceBoxes, fenceConnects } from '../../../shared/src/blocks';
import { BIOMES } from '../../../shared/src/biomes';
import { WORLD_HEIGHT } from '../../../shared/src/constants';

export const FLAG_WAVE_LEAVES = 1;
export const FLAG_WAVE_PLANT = 2;
export const FLAG_WATER = 4;
export const FLAG_LAVA = 8;
export const FLAG_TINT_MASK = 16; // tint only pixels whose alpha is ~0.5 (grass side)
export const FLAG_EMISSIVE = 32;
export const FLAG_TINT = 64; // tint whole texture
export const FLAG_GLASS = 128;

export const PAD = 18;
export const PAD_AREA = PAD * PAD;
export const PAD_H = WORLD_HEIGHT + 2;
export const padIndex = (x: number, y: number, z: number) => x + 1 + (z + 1) * PAD + (y + 1) * PAD_AREA;

export interface MeshJob {
  cx: number;
  cz: number;
  blocks: Uint16Array; // padded 18 x (H+2) x 18
  light: Uint8Array; // padded
  biomes: Uint8Array; // 18*18 padded biome ids
  minY: number;
  maxY: number;
}

export interface MeshBuffers {
  /** Interleaved per-attribute arrays */
  pos: Int16Array;
  tex: Uint16Array;
  light: Uint8Array;
  color: Uint8Array;
  index: Uint32Array;
  vertexCount: number;
}

export interface MeshResult {
  cx: number;
  cz: number;
  opaque: MeshBuffers;
  translucent: MeshBuffers;
}

class Builder {
  pos: Int16Array;
  tex: Uint16Array;
  light: Uint8Array;
  color: Uint8Array;
  index: Uint32Array;
  vc = 0;
  ic = 0;
  constructor(cap = 16384) {
    this.pos = new Int16Array(cap * 4);
    this.tex = new Uint16Array(cap * 4);
    this.light = new Uint8Array(cap * 4);
    this.color = new Uint8Array(cap * 4);
    this.index = new Uint32Array(cap * 1.5);
  }
  reset() {
    this.vc = 0;
    this.ic = 0;
  }
  private grow() {
    const n = this.pos.length * 2;
    const g = <T extends Int16Array | Uint16Array | Uint8Array | Uint32Array>(a: T, len: number): T => {
      const b = new (a.constructor as new (n: number) => T)(len);
      b.set(a);
      return b;
    };
    this.pos = g(this.pos, n);
    this.tex = g(this.tex, n);
    this.light = g(this.light, n);
    this.color = g(this.color, n);
    this.index = g(this.index, (n / 4) * 1.5);
  }
  vertex(x: number, y: number, z: number, n: number, u: number, v: number, layer: number, flags: number, sky: number, blk: number, ao: number, r: number, g: number, b: number, phase: number) {
    if (this.vc * 4 + 4 > this.pos.length) this.grow();
    const o = this.vc * 4;
    this.pos[o] = Math.round(x * 16);
    this.pos[o + 1] = Math.round(y * 16);
    this.pos[o + 2] = Math.round(z * 16);
    this.pos[o + 3] = n;
    this.tex[o] = Math.round(u * 16);
    this.tex[o + 1] = Math.round(v * 16);
    this.tex[o + 2] = layer;
    this.tex[o + 3] = flags;
    this.light[o] = Math.min(255, Math.round(sky * 17));
    this.light[o + 1] = Math.min(255, Math.round(blk * 17));
    this.light[o + 2] = Math.round(ao * 85);
    this.light[o + 3] = 0;
    this.color[o] = r;
    this.color[o + 1] = g;
    this.color[o + 2] = b;
    this.color[o + 3] = phase;
    this.vc++;
  }
  /** Add indices for the last 4 vertices as a quad. flip swaps the triangulation diagonal. */
  quad(flip: boolean) {
    const b = this.vc - 4;
    if (this.ic + 6 > this.index.length) {
      const idx = new Uint32Array(this.index.length * 2);
      idx.set(this.index);
      this.index = idx;
    }
    const i = this.index;
    const c = this.ic;
    if (!flip) {
      i[c] = b; i[c + 1] = b + 1; i[c + 2] = b + 2;
      i[c + 3] = b; i[c + 4] = b + 2; i[c + 5] = b + 3;
    } else {
      i[c] = b + 1; i[c + 1] = b + 2; i[c + 2] = b + 3;
      i[c + 3] = b + 1; i[c + 4] = b + 3; i[c + 5] = b;
    }
    this.ic += 6;
  }
  finish(): MeshBuffers {
    return {
      pos: this.pos.slice(0, this.vc * 4),
      tex: this.tex.slice(0, this.vc * 4),
      light: this.light.slice(0, this.vc * 4),
      color: this.color.slice(0, this.vc * 4),
      index: this.index.slice(0, this.ic),
      vertexCount: this.vc,
    };
  }
}

// ---- Static per-block tables -----------------------------------------------------------------
const OPAQUE = new Uint8Array(256);
const SHAPE_CUBE = new Uint8Array(256);
for (const b of BLOCKS) {
  OPAQUE[b.id] = b.opaque ? 1 : 0;
  SHAPE_CUBE[b.id] = b.shape === 'cube' ? 1 : 0;
}

let LAYERS: Record<string, number> = {};
const faceLayer = new Int32Array(256 * 6);
const frontLayer = new Int32Array(256);

export function setTextureLayers(layers: Record<string, number>) {
  LAYERS = layers;
  const L = (n: string | undefined) => (n && n in layers ? layers[n] : layers['missing'] ?? 0);
  for (const b of BLOCKS) {
    const t = b.textures;
    for (let f = 0; f < 6; f++) faceLayer[b.id * 6 + f] = L(f === 2 ? t.top : f === 3 ? t.bottom : t.side);
    frontLayer[b.id] = L(t.front ?? t.side);
  }
}

const L = (name: string) => LAYERS[name] ?? 0;

// Face geometry: for each face, 4 corners (x,y,z) in CCW order seen from outside, and uv per corner.
// Corner order: 0 = (u0,v1) bottom-left, 1 = (u1,v1) bottom-right, 2 = (u1,v0) top-right, 3 = (u0,v0) top-left (v0 = texture top)
const FACES: Array<{ n: [number, number, number]; c: [number, number, number][] }> = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, // +X east
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] }, // -X west
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] }, // +Y up
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] }, // -Y down
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, // +Z south
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }, // -Z north
];
const CORNER_UV: [number, number][] = [[0, 16], [16, 16], [16, 0], [0, 0]];

// Tangent axes per face for AO sampling: for each face, two in-plane axis vectors
const FACE_AXES: Array<[[number, number, number], [number, number, number]]> = FACES.map((f) => {
  const n = f.n;
  if (n[0] !== 0) return [[0, 1, 0], [0, 0, 1]];
  if (n[1] !== 0) return [[1, 0, 0], [0, 0, 1]];
  return [[1, 0, 0], [0, 1, 0]];
});

export class Mesher {
  private opaque = new Builder(32768);
  private trans = new Builder(8192);
  private job!: MeshJob;

  mesh(job: MeshJob): MeshResult {
    this.job = job;
    this.opaque.reset();
    this.trans.reset();
    const { blocks } = job;
    const y0 = Math.max(0, job.minY);
    const y1 = Math.min(WORLD_HEIGHT - 1, job.maxY);
    for (let y = y0; y <= y1; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const s = blocks[padIndex(x, y, z)];
          const id = s & 0xff;
          if (id === 0) continue;
          const def = BLOCKS[id];
          switch (def.shape) {
            case 'cube':
              this.cube(x, y, z, s, def);
              break;
            case 'cross':
              this.cross(x, y, z, s, def);
              break;
            case 'crop':
              this.crop(x, y, z, s, def);
              break;
            case 'fluid':
              this.fluid(x, y, z, s, def);
              break;
            case 'torch':
              this.torch(x, y, z, s, def);
              break;
            case 'slab':
              this.box(x, y, z, s, def, 0, (s >> 8) & 1 ? 8 : 0, 0, 16, (s >> 8) & 1 ? 16 : 8, 16);
              break;
            case 'farmland':
              this.box(x, y, z, s, def, 0, 0, 0, 16, 15, 16);
              break;
            case 'snow_layer':
              this.box(x, y, z, s, def, 0, 0, 0, 16, 2, 16);
              break;
            case 'cactus':
              this.box(x, y, z, s, def, 1, 0, 1, 15, 16, 15, true);
              break;
            case 'ladder':
              this.ladder(x, y, z, s, def);
              break;
            case 'fence': {
              let m = 0;
              if (fenceConnects(s, this.get(x + 1, y, z))) m |= 1;
              if (fenceConnects(s, this.get(x, y, z + 1))) m |= 2;
              if (fenceConnects(s, this.get(x - 1, y, z))) m |= 4;
              if (fenceConnects(s, this.get(x, y, z - 1))) m |= 8;
              for (const fb of fenceBoxes(s, m)) this.box(x, y, z, s, def, fb[0], fb[1], fb[2], fb[3], fb[4], fb[5]);
              break;
            }
            case 'stairs':
              for (const sb of stairBoxes(s >> 8)) this.box(x, y, z, s, def, sb[0], sb[1], sb[2], sb[3], sb[4], sb[5]);
              break;
            case 'door': {
              const d = doorPanel(s >> 8);
              const layer = L((s >> 8) & 8 ? 'oak_door_top' : 'oak_door_bottom');
              for (let f = 0; f < 6; f++) this.emitFace(this.opaque, x, y, z, f, d[0], d[1], d[2], d[3], d[4], d[5], layer, 0, [255, 255, 255], 0, 0, false);
              break;
            }
          }
        }
    return { cx: job.cx, cz: job.cz, opaque: this.opaque.finish(), translucent: this.trans.finish() };
  }

  private get(x: number, y: number, z: number): number {
    if (y < 0) return 0x0006; // bedrock below world
    if (y >= WORLD_HEIGHT) return 0;
    return this.job.blocks[padIndex(x, y, z)];
  }
  private lightAt(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 0xf0;
    if (y < 0) return 0;
    return this.job.light[padIndex(x, y, z)];
  }

  private tint(def: BlockDef, x: number, z: number): [number, number, number] {
    if (def.tint === 'none') return [255, 255, 255];
    if (def.tint === 'birch') return [128, 167, 85];
    if (def.tint === 'spruce') return [97, 153, 97];
    // Blend biome colour over a 3x3 neighbourhood
    let r = 0, g = 0, b = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const bio = BIOMES[this.job.biomes[x + 1 + dx + (z + 1 + dz) * PAD]] ?? BIOMES[0];
        const c = def.tint === 'grass' ? bio.grass : def.tint === 'water' ? bio.water : bio.foliage;
        r += c[0]; g += c[1]; b += c[2];
      }
    return [r / 9, g / 9, b / 9];
  }

  /** Whether a face of block `id` should be drawn against neighbour state `n`. */
  private faceVisible(id: number, def: BlockDef, n: number, face: number): boolean {
    const nid = n & 0xff;
    if (nid === 0) return true;
    if (OPAQUE[nid]) return false;
    const nd = BLOCKS[nid];
    if (nid === id && (def.layer === 'translucent' || def.name === 'glass' || def.name.endsWith('glass'))) return false;
    if (nd.shape === 'slab') {
      const top = (n >> 8) & 1;
      if (face === 2 && !top) return false; // our top face against a bottom slab above
      if (face === 3 && top) return false;
      return true;
    }
    if (nd.shape === 'farmland' && face === 3) return false;
    return true;
  }

  private cube(x: number, y: number, z: number, s: number, def: BlockDef) {
    const id = s & 0xff;
    const meta = s >> 8;
    const b = def.layer === 'translucent' ? this.trans : this.opaque;
    const tintCol = this.tint(def, x, z);
    let flags = 0;
    if (def.waving === 1) flags |= FLAG_WAVE_LEAVES;
    if (def.lightEmission >= 13) flags |= FLAG_EMISSIVE;
    if (def.layer === 'translucent') flags |= FLAG_GLASS;
    const log = isLog(id);
    const dir = isDirectional(id);
    const phase = ((x * 7 + z * 13 + y * 3) & 255);
    for (let f = 0; f < 6; f++) {
      const fd = FACES[f];
      const n = this.get(x + fd.n[0], y + fd.n[1], z + fd.n[2]);
      if (!this.faceVisible(id, def, n, f)) continue;
      let layer = faceLayer[id * 6 + f];
      let rotate = 0;
      let faceFlags = flags;
      let col = tintCol;
      if (log && meta !== 0) {
        // Horizontal logs: rings on the axis faces, bark rotated elsewhere
        const axisFace = meta === 1 ? f <= 1 : f >= 4;
        if (axisFace) layer = faceLayer[id * 6 + 2];
        else {
          layer = faceLayer[id * 6 + 0];
          rotate = meta === 1 ? (f >= 2 && f <= 3 ? 1 : 1) : f <= 1 ? 1 : 0;
          if (meta === 2 && (f === 2 || f === 3)) rotate = 0;
          if (meta === 1 && (f === 4 || f === 5)) rotate = 1;
        }
      } else if (dir && f === meta && f !== 2 && f !== 3) layer = frontLayer[id];
      else if (dir && meta === 0 && f === 4 && def.name === 'crafting_table') layer = frontLayer[id];
      if (def.name === 'grass_block') {
        if (f !== 2 && f !== 3) {
          if (meta & 1) {
            layer = L('grass_block_snow');
            col = [255, 255, 255];
          } else faceFlags |= FLAG_TINT_MASK;
        } else if (f === 3) col = [255, 255, 255];
        else if (f === 2) faceFlags |= FLAG_TINT;
      } else if (def.tint !== 'none') faceFlags |= FLAG_TINT;
      this.emitFace(b, x, y, z, f, 0, 0, 0, 16, 16, 16, layer, faceFlags, col, phase, rotate, true);
    }
  }

  /** Generic box (in pixels) with per-face culling against full neighbours. */
  private box(x: number, y: number, z: number, s: number, def: BlockDef, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, cactus = false) {
    const id = s & 0xff;
    const b = def.layer === 'translucent' ? this.trans : this.opaque;
    const col = this.tint(def, x, z);
    for (let f = 0; f < 6; f++) {
      const fd = FACES[f];
      // Only cull faces that touch the block boundary
      const touches = (f === 0 && x1 === 16) || (f === 1 && x0 === 0) || (f === 2 && y1 === 16) || (f === 3 && y0 === 0) || (f === 4 && z1 === 16) || (f === 5 && z0 === 0);
      if (touches) {
        const n = this.get(x + fd.n[0], y + fd.n[1], z + fd.n[2]);
        if (!this.faceVisible(id, def, n, f)) continue;
        if (cactus && (n & 0xff) === id && (f === 2 || f === 3)) continue;
      }
      const layer = faceLayer[id * 6 + f];
      this.emitFace(b, x, y, z, f, x0, y0, z0, x1, y1, z1, layer, def.tint !== 'none' ? FLAG_TINT : 0, col, 0, 0, touches);
    }
  }

  /**
   * Emit one face of a box [x0..x1]x[y0..y1]x[z0..z1] (pixels) with smooth lighting & AO.
   * `aoFull` = sample AO/light from the neighbour cell (true for faces on the block boundary).
   */
  private emitFace(
    b: Builder, x: number, y: number, z: number, f: number,
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    layer: number, flags: number, col: [number, number, number], phase: number, rotate: number, aoFull: boolean,
  ) {
    const fd = FACES[f];
    const [ax, ay] = FACE_AXES[f];
    const nx = fd.n[0], ny = fd.n[1], nz = fd.n[2];
    // Light sample origin: the cell in front of the face (or the block itself if face is inset)
    const ox = aoFull ? x + nx : x, oy = aoFull ? y + ny : y, oz = aoFull ? z + nz : z;
    const lights: number[] = [];
    const aos: number[] = [];
    const pts: [number, number, number][] = [];
    const uvs: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
      const c = fd.c[i];
      const px = (c[0] ? x1 : x0) / 16, py = (c[1] ? y1 : y0) / 16, pz = (c[2] ? z1 : z0) / 16;
      pts.push([x + px, y + py, z + pz]);
      // UV from the face-local coordinates so partial boxes use the matching texture region
      let u: number, v: number;
      if (f <= 1) { u = f === 0 ? 16 - (c[2] ? z1 : z0) : (c[2] ? z1 : z0); v = 16 - (c[1] ? y1 : y0); }
      else if (f <= 3) { u = c[0] ? x1 : x0; v = f === 2 ? (c[2] ? z1 : z0) : 16 - (c[2] ? z1 : z0); }
      else { u = f === 4 ? (c[0] ? x1 : x0) : 16 - (c[0] ? x1 : x0); v = 16 - (c[1] ? y1 : y0); }
      if (rotate) { const t = u; u = v; v = 16 - t; }
      uvs.push([u, v]);
      // Corner direction along the two tangent axes
      const s1 = (c[0] * ax[0] + c[1] * ax[1] + c[2] * ax[2]) ? 1 : -1;
      const s2 = (c[0] * ay[0] + c[1] * ay[1] + c[2] * ay[2]) ? 1 : -1;
      const e1: [number, number, number] = [ax[0] * s1, ax[1] * s1, ax[2] * s1];
      const e2: [number, number, number] = [ay[0] * s2, ay[1] * s2, ay[2] * s2];
      const aS = this.get(ox + e1[0], oy + e1[1], oz + e1[2]);
      const bS = this.get(ox + e2[0], oy + e2[1], oz + e2[2]);
      const cS = this.get(ox + e1[0] + e2[0], oy + e1[1] + e2[1], oz + e1[2] + e2[2]);
      const side1 = OPAQUE[aS & 0xff], side2 = OPAQUE[bS & 0xff], corner = OPAQUE[cS & 0xff];
      const ao = aoFull ? (side1 && side2 ? 0 : 3 - (side1 + side2 + corner)) : 3;
      aos.push(ao);
      // Smooth light: average of the up-to-4 non-opaque cells around this vertex
      const l0 = this.lightAt(ox, oy, oz);
      let sky = l0 >> 4, blk = l0 & 15, cnt = 1;
      if (aoFull) {
        if (!side1) { const l = this.lightAt(ox + e1[0], oy + e1[1], oz + e1[2]); sky += l >> 4; blk += l & 15; cnt++; }
        if (!side2) { const l = this.lightAt(ox + e2[0], oy + e2[1], oz + e2[2]); sky += l >> 4; blk += l & 15; cnt++; }
        if (!corner && !(side1 && side2)) { const l = this.lightAt(ox + e1[0] + e2[0], oy + e1[1] + e2[1], oz + e1[2] + e2[2]); sky += l >> 4; blk += l & 15; cnt++; }
      }
      lights.push(sky / cnt, blk / cnt);
    }
    for (let i = 0; i < 4; i++) {
      const p = pts[i];
      b.vertex(p[0], p[1], p[2], f, uvs[i][0], uvs[i][1], layer, flags, lights[i * 2], lights[i * 2 + 1], aos[i], col[0], col[1], col[2], phase);
    }
    // Flip the diagonal to avoid AO interpolation artefacts
    const flip = aos[0] + aos[2] < aos[1] + aos[3];
    b.quad(flip);
  }

  private cross(x: number, y: number, z: number, s: number, def: BlockDef) {
    const id = s & 0xff;
    const l = this.lightAt(x, y, z);
    const sky = l >> 4, blk = l & 15;
    const col = this.tint(def, x, z);
    const layer = faceLayer[id * 6 + 0];
    let flags = def.tint !== 'none' ? FLAG_TINT : 0;
    const waving = def.waving === 2;
    // Random offset like Minecraft's plant jitter
    const h = ((x * 3129871) ^ (z * 116129781) ^ y) >>> 0;
    const jx = (((h >> 4) & 15) / 15 - 0.5) * 0.3;
    const jz = (((h >> 8) & 15) / 15 - 0.5) * 0.3;
    const a = 0.15, bnd = 0.85;
    const planes: [number, number, number, number][] = [
      [a, a, bnd, bnd],
      [a, bnd, bnd, a],
    ];
    const phase = (h >> 12) & 255;
    for (const [px0, pz0, px1, pz1] of planes) {
      for (const side of [0, 1]) {
        const X0 = x + (side ? px1 : px0) + jx, Z0 = z + (side ? pz1 : pz0) + jz;
        const X1 = x + (side ? px0 : px1) + jx, Z1 = z + (side ? pz0 : pz1) + jz;
        const fb = waving ? flags : flags;
        this.opaque.vertex(X0, y, Z0, 6, 0, 16, layer, fb, sky, blk, 3, col[0], col[1], col[2], phase);
        this.opaque.vertex(X1, y, Z1, 6, 16, 16, layer, fb, sky, blk, 3, col[0], col[1], col[2], phase);
        this.opaque.vertex(X1, y + 1, Z1, 6, 16, 0, layer, waving ? fb | FLAG_WAVE_PLANT : fb, sky, blk, 3, col[0], col[1], col[2], phase);
        this.opaque.vertex(X0, y + 1, Z0, 6, 0, 0, layer, waving ? fb | FLAG_WAVE_PLANT : fb, sky, blk, 3, col[0], col[1], col[2], phase);
        this.opaque.quad(false);
      }
    }
    void flags;
    flags = 0;
  }

  private crop(x: number, y: number, z: number, s: number, _def: BlockDef) {
    const l = this.lightAt(x, y, z);
    const sky = l >> 4, blk = l & 15;
    const stage = Math.min(7, (s >> 8) & 7);
    const layer = L(`wheat_stage${stage}`);
    const phase = ((x * 31 + z * 17) & 255);
    const yb = y - 1 / 16;
    const addPlane = (x0: number, z0: number, x1: number, z1: number) => {
      for (const side of [0, 1]) {
        const ax = side ? x1 : x0, az = side ? z1 : z0, bx = side ? x0 : x1, bz = side ? z0 : z1;
        this.opaque.vertex(x + ax, yb, z + az, 6, 0, 16, layer, 0, sky, blk, 3, 255, 255, 255, phase);
        this.opaque.vertex(x + bx, yb, z + bz, 6, 16, 16, layer, 0, sky, blk, 3, 255, 255, 255, phase);
        this.opaque.vertex(x + bx, yb + 1, z + bz, 6, 16, 0, layer, FLAG_WAVE_PLANT, sky, blk, 3, 255, 255, 255, phase);
        this.opaque.vertex(x + ax, yb + 1, z + az, 6, 0, 0, layer, FLAG_WAVE_PLANT, sky, blk, 3, 255, 255, 255, phase);
        this.opaque.quad(false);
      }
    };
    addPlane(0.25, 0, 0.25, 1);
    addPlane(0.75, 0, 0.75, 1);
    addPlane(0, 0.25, 1, 0.25);
    addPlane(0, 0.75, 1, 0.75);
  }

  private ladder(x: number, y: number, z: number, s: number, def: BlockDef) {
    const l = this.lightAt(x, y, z);
    const sky = l >> 4, blk = l & 15;
    const layer = faceLayer[def.id * 6];
    const f = (s >> 8) & 7;
    const o = 1 / 16;
    // Ladder sits against the wall opposite to the face it was placed on
    let pts: [number, number, number][];
    if (f === 0) pts = [[o, 0, 1], [o, 0, 0], [o, 1, 0], [o, 1, 1]];
    else if (f === 1) pts = [[1 - o, 0, 0], [1 - o, 0, 1], [1 - o, 1, 1], [1 - o, 1, 0]];
    else if (f === 4) pts = [[0, 0, o], [1, 0, o], [1, 1, o], [0, 1, o]];
    else pts = [[1, 0, 1 - o], [0, 0, 1 - o], [0, 1, 1 - o], [1, 1, 1 - o]];
    const uv: [number, number][] = [[0, 16], [16, 16], [16, 0], [0, 0]];
    for (const side of [0, 1]) {
      for (let i = 0; i < 4; i++) {
        const k = side ? [1, 0, 3, 2][i] : i;
        const p = pts[k];
        this.opaque.vertex(x + p[0], y + p[1], z + p[2], f, uv[k][0], uv[k][1], layer, 0, sky, blk, 3, 255, 255, 255, 0);
      }
      this.opaque.quad(false);
    }
  }

  private torch(x: number, y: number, z: number, s: number, def: BlockDef) {
    const l = this.lightAt(x, y, z);
    const sky = l >> 4, blk = Math.max(l & 15, def.lightEmission);
    const layer = faceLayer[def.id * 6];
    const meta = s >> 8;
    const lantern = def.name === 'lantern';
    // Build the model in pixel space then transform for wall torches
    const boxes: Array<{ x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; u0: number; v0: number; top: [number, number, number, number] }> = [];
    if (lantern) {
      const yo = meta === 3 ? 7 : 0;
      boxes.push({ x0: 5, y0: yo, z0: 5, x1: 11, y1: yo + 7, z1: 11, u0: 5, v0: 9, top: [5, 9, 11, 15] });
      boxes.push({ x0: 7, y0: yo + 7, z0: 7, x1: 9, y1: yo + 9, z1: 9, u0: 7, v0: 6, top: [7, 6, 9, 8] });
    } else {
      boxes.push({ x0: 7, y0: 0, z0: 7, x1: 9, y1: 10, z1: 9, u0: 7, v0: 6, top: [7, 6, 9, 8] });
    }
    const wall = !lantern && meta !== 2 && meta <= 5;
    const tilt = 0.4;
    const transform = (px: number, py: number, pz: number): [number, number, number] => {
      let X = px / 16 - 0.5, Y = py / 16, Z = pz / 16 - 0.5;
      if (wall) {
        // Lean away from the wall: wall is opposite the face direction
        const dx = meta === 0 ? 1 : meta === 1 ? -1 : 0;
        const dz = meta === 4 ? 1 : meta === 5 ? -1 : 0;
        X += dx * Y * tilt - dx * 0.5 + dx * 0.0;
        Z += dz * Y * tilt - dz * 0.5;
        Y += 3.5 / 16;
        X += dx * 0.18;
        Z += dz * 0.18;
      }
      return [x + 0.5 + X, y + Y, z + 0.5 + Z];
    };
    const flags = FLAG_EMISSIVE;
    for (const bx of boxes) {
      const w = bx.x1 - bx.x0, h = bx.y1 - bx.y0;
      const sides: Array<{ p: [number, number, number][]; uv: [number, number][] }> = [
        { p: [[bx.x1, bx.y0, bx.z1], [bx.x1, bx.y0, bx.z0], [bx.x1, bx.y1, bx.z0], [bx.x1, bx.y1, bx.z1]], uv: [] },
        { p: [[bx.x0, bx.y0, bx.z0], [bx.x0, bx.y0, bx.z1], [bx.x0, bx.y1, bx.z1], [bx.x0, bx.y1, bx.z0]], uv: [] },
        { p: [[bx.x0, bx.y0, bx.z1], [bx.x1, bx.y0, bx.z1], [bx.x1, bx.y1, bx.z1], [bx.x0, bx.y1, bx.z1]], uv: [] },
        { p: [[bx.x1, bx.y0, bx.z0], [bx.x0, bx.y0, bx.z0], [bx.x0, bx.y1, bx.z0], [bx.x1, bx.y1, bx.z0]], uv: [] },
      ];
      const normals = [0, 1, 4, 5];
      sides.forEach((sd, i) => {
        const uvs: [number, number][] = [[bx.u0, bx.v0 + h], [bx.u0 + w, bx.v0 + h], [bx.u0 + w, bx.v0], [bx.u0, bx.v0]];
        for (let k = 0; k < 4; k++) {
          const t = transform(sd.p[k][0], sd.p[k][1], sd.p[k][2]);
          this.opaque.vertex(t[0], t[1], t[2], normals[i], uvs[k][0], uvs[k][1], layer, flags, sky, blk, 3, 255, 255, 255, 0);
        }
        this.opaque.quad(false);
      });
      // Top & bottom
      const [tu0, tv0, tu1, tv1] = bx.top;
      const top: [number, number, number][] = [[bx.x0, bx.y1, bx.z1], [bx.x1, bx.y1, bx.z1], [bx.x1, bx.y1, bx.z0], [bx.x0, bx.y1, bx.z0]];
      const tuv: [number, number][] = [[tu0, tv1], [tu1, tv1], [tu1, tv0], [tu0, tv0]];
      for (let k = 0; k < 4; k++) {
        const t = transform(top[k][0], top[k][1], top[k][2]);
        this.opaque.vertex(t[0], t[1], t[2], 2, tuv[k][0], tuv[k][1], layer, flags, sky, blk, 3, 255, 255, 255, 0);
      }
      this.opaque.quad(false);
      const bot: [number, number, number][] = [[bx.x0, bx.y0, bx.z0], [bx.x1, bx.y0, bx.z0], [bx.x1, bx.y0, bx.z1], [bx.x0, bx.y0, bx.z1]];
      for (let k = 0; k < 4; k++) {
        const t = transform(bot[k][0], bot[k][1], bot[k][2]);
        this.opaque.vertex(t[0], t[1], t[2], 3, tuv[k][0], tuv[k][1], layer, flags, sky, blk, 3, 255, 255, 255, 0);
      }
      this.opaque.quad(false);
    }
  }

  private fluidLevelAt(x: number, y: number, z: number, id: number): number {
    const s = this.get(x, y, z);
    if ((s & 0xff) !== id) return -1;
    const above = this.get(x, y + 1, z);
    if ((above & 0xff) === id) return 1;
    return fluidHeight(s >> 8);
  }

  private fluid(x: number, y: number, z: number, s: number, def: BlockDef) {
    const id = s & 0xff;
    const isWater = def.name === 'water';
    const b = isWater ? this.trans : this.opaque;
    const flags = isWater ? FLAG_WATER | FLAG_TINT : FLAG_LAVA | FLAG_EMISSIVE;
    const col = isWater ? this.tint(def, x, z) : ([255, 255, 255] as [number, number, number]);
    const aboveSame = (this.get(x, y + 1, z) & 0xff) === id;
    // Corner heights (average of the 4 cells sharing the corner)
    const cornerH = (cx: number, cz: number) => {
      let sum = 0, n = 0;
      for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const lx = x + cx + dx, lz = z + cz + dz;
        if ((this.get(lx, y + 1, lz) & 0xff) === id) return 1;
        const h = this.fluidLevelAt(lx, y, lz, id);
        if (h >= 0) { sum += h; n++; }
      }
      return n ? sum / n : 0.1;
    };
    const h00 = aboveSame ? 1 : cornerH(0, 0), h10 = aboveSame ? 1 : cornerH(1, 0);
    const h11 = aboveSame ? 1 : cornerH(1, 1), h01 = aboveSame ? 1 : cornerH(0, 1);
    const l = this.lightAt(x, y, z);
    const lu = this.lightAt(x, y + 1, z);
    const sky = Math.max(l >> 4, lu >> 4), blk = Math.max(l & 15, lu & 15);
    const topLayer = faceLayer[id * 6 + 2], sideLayer = faceLayer[id * 6 + 0];
    const V = (px: number, py: number, pz: number, n: number, u: number, v: number, layer: number, sl = sky, bl = blk) =>
      b.vertex(x + px, y + py, z + pz, n, u, v, layer, flags, sl, bl, 3, col[0], col[1], col[2], 0);
    // Top
    if (!aboveSame) {
      const up = this.get(x, y + 1, z);
      if (!OPAQUE[up & 0xff] || true) {
        V(0, h01, 1, 2, 0, 16, topLayer);
        V(1, h11, 1, 2, 16, 16, topLayer);
        V(1, h10, 0, 2, 16, 0, topLayer);
        V(0, h00, 0, 2, 0, 0, topLayer);
        b.quad(false);
        if (isWater) {
          // Underside of the surface so it is visible from below
          V(0, h00, 0, 3, 0, 0, topLayer);
          V(1, h10, 0, 3, 16, 0, topLayer);
          V(1, h11, 1, 3, 16, 16, topLayer);
          V(0, h01, 1, 3, 0, 16, topLayer);
          b.quad(false);
        }
      }
    }
    // Bottom
    const below = this.get(x, y - 1, z);
    if ((below & 0xff) !== id && !OPAQUE[below & 0xff]) {
      const lb = this.lightAt(x, y - 1, z);
      V(0, 0, 0, 3, 0, 0, topLayer, lb >> 4, lb & 15);
      V(1, 0, 0, 3, 16, 0, topLayer, lb >> 4, lb & 15);
      V(1, 0, 1, 3, 16, 16, topLayer, lb >> 4, lb & 15);
      V(0, 0, 1, 3, 0, 16, topLayer, lb >> 4, lb & 15);
      b.quad(false);
    }
    // Sides
    const sides: Array<[number, number, number, [number, number, number, number]]> = [
      [0, 1, 0, [1, 1, 1, 0]], // +X: corners (1,1)->(1,0)
      [1, -1, 0, [0, 0, 0, 1]],
      [4, 0, 1, [0, 1, 1, 1]],
      [5, 0, -1, [1, 0, 0, 0]],
    ];
    const hAt = (cx: number, cz: number) => (cx ? (cz ? h11 : h10) : cz ? h01 : h00);
    for (const [f, dx, dz, [ax, az, bx, bz]] of sides) {
      const n = this.get(x + dx, y, z + dz);
      const nid = n & 0xff;
      if (nid === id || OPAQUE[nid]) continue;
      const ln = this.lightAt(x + dx, y, z + dz);
      const sl = Math.max(ln >> 4, sky - 1), bl = Math.max(ln & 15, blk - 1);
      const ha = hAt(ax, az), hb = hAt(bx, bz);
      V(ax, 0, az, f, 0, 16, sideLayer, sl, bl);
      V(bx, 0, bz, f, 16, 16, sideLayer, sl, bl);
      V(bx, hb, bz, f, 16, 16 - hb * 16, sideLayer, sl, bl);
      V(ax, ha, az, f, 0, 16 - ha * 16, sideLayer, sl, bl);
      b.quad(false);
      if (isWater) {
        V(ax, ha, az, f, 0, 16 - ha * 16, sideLayer, sl, bl);
        V(bx, hb, bz, f, 16, 16 - hb * 16, sideLayer, sl, bl);
        V(bx, 0, bz, f, 16, 16, sideLayer, sl, bl);
        V(ax, 0, az, f, 0, 16, sideLayer, sl, bl);
        b.quad(false);
      }
    }
  }
}
