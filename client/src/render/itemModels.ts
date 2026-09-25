import * as THREE from 'three';
import { ITEMS, ITEM_COUNT, itemDef, ItemDef } from '../../../shared/src/items';
import { BLOCKS, isDirectional, BlockDef } from '../../../shared/src/blocks';
import { generateItemTexture } from './textures/itemTextures';
import { Atlas } from './atlas';
import { COMMON } from './shaders';
import { U } from './renderer';

/**
 * Builds 3D meshes for items: blocks as small cubes (textured from the block atlas),
 * flat items as Minecraft-style extruded sprites.
 */

const ITEM_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec3 normal;
in vec3 uvl;
in vec3 tint;
out vec3 vUv;
out vec3 vN;
out vec3 vWorld;
out vec3 vTint;
void main() {
  vUv = uvl;
  vTint = tint;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const ITEM_FRAG = /* glsl */ `
${COMMON}
uniform sampler2DArray uArr;
uniform vec2 uLight;
uniform float uFirstPerson;
in vec3 vUv;
in vec3 vN;
in vec3 vWorld;
in vec3 vTint;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 tex = texture(uArr, vUv);
  if (textureLod(uArr, vUv, 0.0).a < 0.1) discard;
  vec3 albedo = tex.rgb * pow(vTint, vec3(2.2));
  vec3 n = normalize(vN);
  float face = abs(n.y) > 0.5 ? (n.y > 0.0 ? 1.0 : 0.5) : (abs(n.x) > 0.5 ? 0.6 : 0.8);
  float skyL = lightCurve(uLight.x);
  float blkL = lightCurve(uLight.y);
  float exposure = smoothstep(0.55, 0.95, uLight.x);
  vec3 light = uAmbient * skyL * face + uSunColor * max(dot(n, uSunDir), 0.0) * exposure * (1.0 - uFirstPerson * 0.5)
             + vec3(1.0, 0.62, 0.3) * blkL * 1.3 * face + vec3(0.02);
  if (uFirstPerson > 0.5) light = max(light, uAmbient * skyL * face * 1.2 + vec3(1.0, 0.62, 0.3) * blkL * face);
  vec3 col = albedo * light;
  if (uFirstPerson < 0.5) col = applyFog(col, vWorld);
  outColor = vec4(col, 1.0);
}
`;

export class ItemModels {
  readonly itemAtlas: THREE.DataArrayTexture;
  readonly itemLayers = new Map<number, number>();
  readonly itemPixels = new Map<number, Uint8ClampedArray>();
  private geoCache = new Map<number, THREE.BufferGeometry>();
  private blockMat: THREE.RawShaderMaterial;
  private itemMat: THREE.RawShaderMaterial;

  constructor(private atlas: Atlas) {
    // Build an array texture of all pure item sprites
    const ids: number[] = [];
    for (let id = 256; id < ITEM_COUNT; id++) if (ITEMS[id] && !ITEMS[id].name.startsWith('unknown')) ids.push(id);
    const data = new Uint8Array(1024 * Math.max(1, ids.length + 1));
    ids.forEach((id, i) => {
      const def = ITEMS[id];
      let px = generateItemTexture(def.icon);
      if (!px) px = missing();
      this.itemPixels.set(id, px);
      // bleed colour into transparent pixels for mip filtering
      let r = 0, g = 0, b = 0, n = 0;
      for (let p = 0; p < 256; p++) if (px[p * 4 + 3] > 0) { r += px[p * 4]; g += px[p * 4 + 1]; b += px[p * 4 + 2]; n++; }
      const o = (i + 1) * 1024;
      for (let p = 0; p < 256; p++) {
        const a = px[p * 4 + 3];
        data[o + p * 4] = a ? px[p * 4] : r / Math.max(1, n);
        data[o + p * 4 + 1] = a ? px[p * 4 + 1] : g / Math.max(1, n);
        data[o + p * 4 + 2] = a ? px[p * 4 + 2] : b / Math.max(1, n);
        data[o + p * 4 + 3] = a;
      }
      this.itemLayers.set(id, i + 1);
    });
    this.itemAtlas = new THREE.DataArrayTexture(data, 16, 16, ids.length + 1);
    this.itemAtlas.colorSpace = THREE.SRGBColorSpace;
    this.itemAtlas.magFilter = THREE.NearestFilter;
    this.itemAtlas.minFilter = THREE.NearestMipmapLinearFilter;
    this.itemAtlas.generateMipmaps = true;
    this.itemAtlas.needsUpdate = true;

    const mk = (tex: THREE.Texture) =>
      new THREE.RawShaderMaterial({
        vertexShader: ITEM_VERT,
        fragmentShader: ITEM_FRAG,
        glslVersion: THREE.GLSL3,
        uniforms: { ...U, uArr: { value: tex }, uLight: { value: new THREE.Vector2(1, 0) }, uFirstPerson: { value: 0 } },
        side: THREE.DoubleSide,
      });
    this.blockMat = mk(atlas.texture);
    this.itemMat = mk(this.itemAtlas);
  }

  /** Pixels (16x16 RGBA) used for an item's 2D icon, or null for 3D block icons. */
  iconPixels(id: number): Uint8ClampedArray | null {
    const def = itemDef(id);
    if (def.block && !def.flatIcon) return null;
    if (def.block) return this.atlas.pixels.get(def.icon) ?? null;
    return this.itemPixels.get(id) ?? null;
  }

  /** Material for an item (needs its own uniforms for light, so clone per instance). */
  material(id: number, firstPerson = false): THREE.RawShaderMaterial {
    const def = itemDef(id);
    const base = def.block ? this.blockMat : this.itemMat;
    const m = base.clone();
    m.uniforms = { ...U, uArr: base.uniforms.uArr, uLight: { value: new THREE.Vector2(1, 0) }, uFirstPerson: { value: firstPerson ? 1 : 0 } };
    return m;
  }

  isFlat(id: number) {
    const def = itemDef(id);
    return !def.block || !!def.flatIcon;
  }

  /** Geometry for an item, centred at origin, unit size ~1 (block = 1x1x1 cube, sprite = 1x1 x 1/16). */
  geometry(id: number): THREE.BufferGeometry {
    let g = this.geoCache.get(id);
    if (g) return g;
    const def = itemDef(id);
    if (def.block && !def.flatIcon) g = this.cubeGeometry(def.block);
    else if (def.block) g = this.spriteGeometry(this.atlas.pixels.get(def.icon)!, this.atlas.layers[def.icon] ?? 0, def.block.tint !== 'none' ? tintOf(def.block) : [1, 1, 1]);
    else g = this.spriteGeometry(this.itemPixels.get(id) ?? missing(), this.itemLayers.get(id) ?? 0, [1, 1, 1]);
    this.geoCache.set(id, g);
    return g;
  }

  private cubeGeometry(b: BlockDef): THREE.BufferGeometry {
    const L = this.atlas.layers;
    const layer = (n: string | undefined) => (n && L[n] !== undefined ? L[n] : 0);
    const t = b.textures;
    const pos: number[] = [], nrm: number[] = [], uvl: number[] = [], tint: number[] = [], idx: number[] = [];
    let y0 = -0.5, y1 = 0.5;
    if (b.shape === 'slab') y1 = 0;
    if (b.shape === 'snow_layer') y1 = -0.5 + 2 / 16;
    if (b.shape === 'farmland') y1 = 0.5 - 1 / 16;
    const inset = b.shape === 'cactus' ? 1 / 16 : 0;
    const x0 = -0.5 + inset, x1 = 0.5 - inset, z0 = -0.5 + inset, z1 = 0.5 - inset;
    const faces: Array<{ n: number[]; p: number[][]; tex: string }> = [
      { n: [1, 0, 0], p: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], tex: t.side },
      { n: [-1, 0, 0], p: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], tex: t.side },
      { n: [0, 1, 0], p: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], tex: t.top },
      { n: [0, -1, 0], p: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], tex: t.bottom },
      { n: [0, 0, 1], p: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], tex: isDirectional(b.id) || b.name === 'crafting_table' ? t.front ?? t.side : t.side },
      { n: [0, 0, -1], p: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], tex: t.side },
    ];
    const tc = b.tint !== 'none' ? tintOf(b) : [1, 1, 1];
    const vTop = 1 - (y1 + 0.5);
    for (const f of faces) {
      const base = pos.length / 3;
      const isSide = f.n[1] === 0;
      const uv = isSide ? [[0, 1], [1, 1], [1, vTop], [0, vTop]] : [[0, 1], [1, 1], [1, 0], [0, 0]];
      let tex = f.tex;
      let col = tc;
      if (b.name === 'grass_block' && isSide) { tex = 'grass_block_side'; col = [1, 1, 1]; }
      if (b.name === 'grass_block' && f.n[1] < 0) col = [1, 1, 1];
      f.p.forEach((p, i) => {
        pos.push(p[0], p[1], p[2]);
        nrm.push(f.n[0], f.n[1], f.n[2]);
        uvl.push(uv[i][0], uv[i][1], layer(tex));
        tint.push(col[0], col[1], col[2]);
      });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      // Grass side fringe: second pass with tint using the overlay texture
      if (b.name === 'grass_block' && isSide) {
        const b2 = pos.length / 3;
        f.p.forEach((p, i) => {
          pos.push(p[0] + f.n[0] * 0.001, p[1], p[2] + f.n[2] * 0.001);
          nrm.push(f.n[0], f.n[1], f.n[2]);
          uvl.push(uv[i][0], uv[i][1], layer('grass_block_side_overlay'));
          tint.push(tc[0], tc[1], tc[2]);
        });
        idx.push(b2, b2 + 1, b2 + 2, b2, b2 + 2, b2 + 3);
      }
    }
    return buildGeo(pos, nrm, uvl, tint, idx);
  }

  /** Extruded sprite: front + back quads and side faces along every opaque/transparent boundary. */
  private spriteGeometry(px: Uint8ClampedArray, layer: number, tc: number[]): THREE.BufferGeometry {
    const pos: number[] = [], nrm: number[] = [], uvl: number[] = [], tint: number[] = [], idx: number[] = [];
    const d = 1 / 32; // half thickness
    const solid = (x: number, y: number) => x >= 0 && x < 16 && y >= 0 && y < 16 && px[(y * 16 + x) * 4 + 3] > 20;
    const quad = (p: number[][], n: number[], uv: number[][]) => {
      const base = pos.length / 3;
      for (let i = 0; i < 4; i++) {
        pos.push(p[i][0], p[i][1], p[i][2]);
        nrm.push(n[0], n[1], n[2]);
        uvl.push(uv[i][0], uv[i][1], layer);
        tint.push(tc[0], tc[1], tc[2]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    quad([[-0.5, -0.5, d], [0.5, -0.5, d], [0.5, 0.5, d], [-0.5, 0.5, d]], [0, 0, 1], [[0, 1], [1, 1], [1, 0], [0, 0]]);
    quad([[0.5, -0.5, -d], [-0.5, -0.5, -d], [-0.5, 0.5, -d], [0.5, 0.5, -d]], [0, 0, -1], [[1, 1], [0, 1], [0, 0], [1, 0]]);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (!solid(x, y)) continue;
        const X0 = x / 16 - 0.5, X1 = (x + 1) / 16 - 0.5;
        const Y1 = 0.5 - y / 16, Y0 = 0.5 - (y + 1) / 16;
        const u0 = x / 16 + 0.001, u1 = (x + 1) / 16 - 0.001, v0 = y / 16 + 0.001, v1 = (y + 1) / 16 - 0.001;
        const uv = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
        if (!solid(x, y - 1)) quad([[X0, Y1, d], [X1, Y1, d], [X1, Y1, -d], [X0, Y1, -d]], [0, 1, 0], uv);
        if (!solid(x, y + 1)) quad([[X0, Y0, -d], [X1, Y0, -d], [X1, Y0, d], [X0, Y0, d]], [0, -1, 0], uv);
        if (!solid(x - 1, y)) quad([[X0, Y0, -d], [X0, Y0, d], [X0, Y1, d], [X0, Y1, -d]], [-1, 0, 0], uv);
        if (!solid(x + 1, y)) quad([[X1, Y0, d], [X1, Y0, -d], [X1, Y1, -d], [X1, Y1, d]], [1, 0, 0], uv);
      }
    return buildGeo(pos, nrm, uvl, tint, idx);
  }
}

function buildGeo(pos: number[], nrm: number[], uvl: number[], tint: number[], idx: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uvl', new THREE.Float32BufferAttribute(uvl, 3));
  g.setAttribute('tint', new THREE.Float32BufferAttribute(tint, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function tintOf(b: BlockDef): number[] {
  switch (b.tint) {
    case 'grass': return [0x91 / 255, 0xbd / 255, 0x59 / 255];
    case 'foliage': return [0x77 / 255, 0xab / 255, 0x2f / 255];
    case 'birch': return [128 / 255, 167 / 255, 85 / 255];
    case 'spruce': return [97 / 255, 153 / 255, 97 / 255];
    case 'water': return [0x3f / 255, 0x76 / 255, 0xe4 / 255];
    default: return [1, 1, 1];
  }
}

function missing() {
  const px = new Uint8ClampedArray(1024);
  for (let i = 0; i < 256; i++) {
    const on = (((i & 15) >> 3) ^ (i >> 7)) & 1;
    px[i * 4] = on ? 255 : 0; px[i * 4 + 2] = on ? 255 : 0; px[i * 4 + 3] = 255;
  }
  return px;
}

export type { ItemDef };
export { BLOCKS };
