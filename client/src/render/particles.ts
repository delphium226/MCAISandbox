import * as THREE from 'three';
import { World } from '../../../shared/src/world';
import { BLOCKS, blockOf } from '../../../shared/src/blocks';
import { COMMON } from './shaders';
import { U } from './renderer';
import { Atlas } from './atlas';

const MAX = 3000;

const VERT = /* glsl */ `
precision highp float;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;   // particle centre
in vec4 corner;     // corner xy (-1..1), size, rotation
in vec4 uvl;        // u0, v0, uvSize, layer
in vec4 col;        // rgb tint, emissive
in vec2 light;
out vec3 vUv;
out vec4 vCol;
out vec2 vLight;
out vec3 vWorld;
void main() {
  vec4 view = viewMatrix * vec4(position, 1.0);
  float c = cos(corner.w), s = sin(corner.w);
  vec2 off = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c) * corner.z;
  view.xy += off;
  vUv = vec3(uvl.xy + (corner.xy * 0.5 + 0.5) * vec2(uvl.z, -uvl.z) + vec2(0.0, uvl.z), uvl.w);
  vCol = col;
  vLight = light;
  vWorld = position;
  gl_Position = projectionMatrix * view;
}
`;
const FRAG = /* glsl */ `
${COMMON}
uniform sampler2DArray uAtlas;
in vec3 vUv;
in vec4 vCol;
in vec2 vLight;
in vec3 vWorld;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 tex = vUv.z < 0.0 ? vec4(1.0) : textureLod(uAtlas, vUv, 0.0);
  if (tex.a < 0.3) discard;
  vec3 albedo = tex.rgb * vCol.rgb;
  vec3 light = uAmbient * lightCurve(vLight.x) + uSunColor * 0.35 * smoothstep(0.55, 0.95, vLight.x) + vec3(1.0, 0.62, 0.3) * lightCurve(vLight.y) * 1.2 + vec3(0.02);
  vec3 c = mix(albedo * light, albedo * 2.0, vCol.a);
  outColor = vec4(applyFog(c, vWorld), 1.0);
}
`;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number;
  u: number; v: number; uvSize: number; layer: number;
  r: number; g: number; b: number; emissive: number;
  gravity: number;
  rot: number;
  collide: boolean;
  grow: number;
}

export class Particles {
  readonly mesh: THREE.Mesh;
  private list: Particle[] = [];
  private pos: Float32Array;
  private corner: Float32Array;
  private uvl: Float32Array;
  private col: Float32Array;
  private light: Float32Array;
  private geo: THREE.BufferGeometry;

  constructor(private world: World, private atlas: Atlas) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 4 * 3);
    this.corner = new Float32Array(MAX * 4 * 4);
    this.uvl = new Float32Array(MAX * 4 * 4);
    this.col = new Float32Array(MAX * 4 * 4);
    this.light = new Float32Array(MAX * 4 * 2);
    const idx = new Uint32Array(MAX * 6);
    for (let i = 0; i < MAX; i++) {
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const dyn = (a: Float32Array, n: number) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('corner', dyn(this.corner, 4));
    this.geo.setAttribute('uvl', dyn(this.uvl, 4));
    this.geo.setAttribute('col', dyn(this.col, 4));
    this.geo.setAttribute('light', dyn(this.light, 2));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.RawShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, glslVersion: THREE.GLSL3, uniforms: { ...U } });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  /** Block break / dig particles from a block's texture. */
  blockBreak(x: number, y: number, z: number, state: number, count = 64) {
    const def = blockOf(state);
    if (def.shape === 'none') return;
    const tex = def.textures.side;
    const layer = this.atlas.layers[tex] ?? 0;
    const tint = def.tint !== 'none' && def.name !== 'grass_block' ? tintRGB(def.tint) : [1, 1, 1];
    const n = Math.round(Math.cbrt(count));
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < n; k++) {
          const px = x + (i + 0.5) / n, py = y + (j + 0.5) / n, pz = z + (k + 0.5) / n;
          this.spawn({
            x: px, y: py, z: pz,
            vx: (px - x - 0.5) * 0.12 + (Math.random() - 0.5) * 0.05,
            vy: (py - y - 0.5) * 0.12 + Math.random() * 0.1,
            vz: (pz - z - 0.5) * 0.12 + (Math.random() - 0.5) * 0.05,
            life: 0, maxLife: 0.6 + Math.random() * 0.8, size: 0.05 + Math.random() * 0.04,
            u: Math.floor(Math.random() * 12) / 16, v: Math.floor(Math.random() * 12) / 16, uvSize: 4 / 16, layer,
            r: tint[0], g: tint[1], b: tint[2], emissive: def.lightEmission > 10 ? 0.5 : 0, gravity: 0.04 * 20, rot: 0, collide: true, grow: 0,
          });
        }
  }

  /** Small burst while digging (on the hit face). */
  blockHit(x: number, y: number, z: number, face: number, state: number) {
    const def = blockOf(state);
    const layer = this.atlas.layers[def.textures.side] ?? 0;
    const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][face] ?? [0, 1, 0];
    const tint = def.tint !== 'none' && def.name !== 'grass_block' ? tintRGB(def.tint) : [1, 1, 1];
    for (let i = 0; i < 2; i++) {
      const px = x + 0.5 + n[0] * 0.52 + (n[0] ? 0 : Math.random() - 0.5), py = y + 0.5 + n[1] * 0.52 + (n[1] ? 0 : Math.random() - 0.5), pz = z + 0.5 + n[2] * 0.52 + (n[2] ? 0 : Math.random() - 0.5);
      this.spawn({
        x: px, y: py, z: pz, vx: n[0] * 0.05 + (Math.random() - 0.5) * 0.05, vy: n[1] * 0.05 + Math.random() * 0.05, vz: n[2] * 0.05 + (Math.random() - 0.5) * 0.05,
        life: 0, maxLife: 0.4 + Math.random() * 0.4, size: 0.04, u: Math.floor(Math.random() * 12) / 16, v: Math.floor(Math.random() * 12) / 16, uvSize: 4 / 16, layer,
        r: tint[0], g: tint[1], b: tint[2], emissive: 0, gravity: 0.8, rot: 0, collide: true, grow: 0,
      });
    }
  }

  explosion(x: number, y: number, z: number, power: number) {
    for (let i = 0; i < 60 * power; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1);
      const sp = Math.random() * 0.4 * power;
      const g = 0.5 + Math.random() * 0.5;
      this.spawn({
        x: x + (Math.random() - 0.5) * power, y: y + (Math.random() - 0.5) * power, z: z + (Math.random() - 0.5) * power,
        vx: Math.sin(b) * Math.cos(a) * sp, vy: Math.cos(b) * sp * 0.6 + 0.05, vz: Math.sin(b) * Math.sin(a) * sp,
        life: 0, maxLife: 0.6 + Math.random() * 1.2, size: 0.25 + Math.random() * 0.5, u: 0, v: 0, uvSize: 1, layer: -1,
        r: g, g: g, b: g, emissive: i % 4 === 0 ? 0.6 : 0, gravity: -0.4, rot: Math.random() * 6, collide: false, grow: 0.8,
      });
    }
  }

  smoke(x: number, y: number, z: number, n = 4, color = 0.3) {
    for (let i = 0; i < n; i++)
      this.spawn({
        x: x + (Math.random() - 0.5) * 0.3, y, z: z + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 0.02, vy: 0.03 + Math.random() * 0.03, vz: (Math.random() - 0.5) * 0.02,
        life: 0, maxLife: 0.8 + Math.random() * 0.8, size: 0.06 + Math.random() * 0.06, u: 0, v: 0, uvSize: 1, layer: -1,
        r: color, g: color, b: color, emissive: 0, gravity: -0.15, rot: Math.random() * 6, collide: false, grow: 0.3,
      });
  }

  flame(x: number, y: number, z: number) {
    this.spawn({
      x, y, z, vx: 0, vy: 0.012, vz: 0, life: 0, maxLife: 0.5 + Math.random() * 0.3, size: 0.035, u: 0, v: 0, uvSize: 1, layer: -1,
      r: 1.0, g: 0.6, b: 0.2, emissive: 1, gravity: -0.05, rot: 0, collide: false, grow: -0.05,
    });
  }

  crit(x: number, y: number, z: number, color: [number, number, number] = [0.9, 0.85, 0.6]) {
    for (let i = 0; i < 12; i++)
      this.spawn({
        x, y, z, vx: (Math.random() - 0.5) * 0.4, vy: Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.4, life: 0, maxLife: 0.5 + Math.random() * 0.3,
        size: 0.05, u: 0, v: 0, uvSize: 1, layer: -1, r: color[0], g: color[1], b: color[2], emissive: 0.7, gravity: 0.5, rot: Math.PI / 4, collide: false, grow: -0.05,
      });
  }

  splash(x: number, y: number, z: number) {
    for (let i = 0; i < 16; i++)
      this.spawn({
        x: x + (Math.random() - 0.5), y, z: z + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 0.1, vy: 0.1 + Math.random() * 0.15, vz: (Math.random() - 0.5) * 0.1,
        life: 0, maxLife: 0.6, size: 0.04, u: 0, v: 0, uvSize: 1, layer: -1, r: 0.6, g: 0.75, b: 1.0, emissive: 0.1, gravity: 1.2, rot: 0, collide: true, grow: 0,
      });
  }

  bubble(x: number, y: number, z: number) {
    this.spawn({
      x, y, z, vx: (Math.random() - 0.5) * 0.02, vy: 0.06, vz: (Math.random() - 0.5) * 0.02, life: 0, maxLife: 1.2, size: 0.04, u: 0, v: 0, uvSize: 1, layer: -1,
      r: 0.7, g: 0.85, b: 1.0, emissive: 0.2, gravity: -0.2, rot: 0, collide: false, grow: 0,
    });
  }

  private spawn(p: Particle) {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push(p);
  }

  update(dt: number) {
    const w = this.world;
    let n = 0;
    const alive: Particle[] = [];
    for (const p of this.list) {
      p.life += dt;
      if (p.life >= p.maxLife) continue;
      p.vy -= p.gravity * dt;
      const nx = p.x + p.vx * dt * 20, ny = p.y + p.vy * dt * 20, nz = p.z + p.vz * dt * 20;
      if (p.collide && BLOCKS[w.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz)) & 0xff].solid) {
        p.vx *= 0.3; p.vz *= 0.3; p.vy = 0;
      } else {
        p.x = nx; p.y = ny; p.z = nz;
      }
      p.vx *= 0.96; p.vz *= 0.96;
      p.size = Math.max(0.005, p.size + p.grow * dt * 0.2);
      alive.push(p);
    }
    this.list = alive;
    const sky = (x: number, y: number, z: number) => w.getSkyLight(Math.floor(x), Math.floor(y), Math.floor(z)) / 15;
    const blk = (x: number, y: number, z: number) => w.getBlockLight(Math.floor(x), Math.floor(y), Math.floor(z)) / 15;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const p of this.list) {
      const fade = p.layer < 0 ? 1 - p.life / p.maxLife : 1;
      const ls = sky(p.x, p.y, p.z), lb = blk(p.x, p.y, p.z);
      for (let c = 0; c < 4; c++) {
        const vi = n * 4 + c;
        this.pos.set([p.x, p.y, p.z], vi * 3);
        this.corner.set([corners[c][0], corners[c][1], p.size * (p.layer < 0 ? 0.6 + fade * 0.4 : 1), p.rot], vi * 4);
        this.uvl.set([p.u, p.v, p.uvSize, p.layer], vi * 4);
        this.col.set([p.r * (p.layer < 0 ? 0.6 + 0.4 * fade : 1), p.g * (p.layer < 0 ? 0.6 + 0.4 * fade : 1), p.b * (p.layer < 0 ? 0.6 + 0.4 * fade : 1), p.emissive], vi * 4);
        this.light.set([ls, lb], vi * 2);
      }
      n++;
    }
    this.geo.setDrawRange(0, n * 6);
    for (const k of ['position', 'corner', 'uvl', 'col', 'light']) {
      const a = this.geo.getAttribute(k) as THREE.BufferAttribute;
      a.needsUpdate = true;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4 * a.itemSize);
    }
  }
}

function tintRGB(t: string): number[] {
  switch (t) {
    case 'grass': return [0.57, 0.74, 0.35];
    case 'foliage': return [0.47, 0.67, 0.18];
    case 'birch': return [0.5, 0.65, 0.33];
    case 'spruce': return [0.38, 0.6, 0.38];
    case 'water': return [0.25, 0.46, 0.9];
    default: return [1, 1, 1];
  }
}
