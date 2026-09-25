import * as THREE from 'three';
import { World } from '../../../shared/src/world';
import { BIOMES } from '../../../shared/src/biomes';
import { COMMON } from './shaders';
import { U } from './renderer';

const R = 11;

const VERT = /* glsl */ `
precision highp float;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
in vec3 position;
in vec3 info; // u (0..1 across quad), seed, snow
in vec2 light;
out vec3 vInfo;
out vec3 vWorld;
out vec2 vLight;
void main() {
  vInfo = info;
  vWorld = position;
  vLight = light;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
${COMMON}
in vec3 vInfo;
in vec3 vWorld;
in vec2 vLight;
layout(location = 0) out vec4 outColor;
void main() {
  float u = vInfo.x;
  float seed = vInfo.y;
  bool snow = vInfo.z > 0.5;
  float lane = floor(u * (snow ? 6.0 : 8.0));
  float h = hash12(vec2(lane, seed * 97.0));
  float a;
  if (snow) {
    float y = vWorld.y + uTime * (1.2 + h * 0.8) + h * 40.0;
    float wob = sin(uTime * 1.5 + h * 20.0 + vWorld.y * 0.5) * 0.08;
    float fu = fract(u * 6.0 + wob) - 0.5;
    float fy = fract(y * 0.9) - 0.5;
    a = smoothstep(0.16, 0.05, length(vec2(fu, fy * 0.6))) * step(0.35, hash12(vec2(lane, floor(y * 0.9) + seed)));
  } else {
    float y = vWorld.y + uTime * (14.0 + h * 5.0) + h * 50.0;
    float fu = abs(fract(u * 8.0) - 0.5);
    float seg = fract(y * 0.25);
    a = smoothstep(0.08, 0.0, fu) * smoothstep(0.0, 0.15, seg) * smoothstep(0.6, 0.35, seg) * step(0.3, hash12(vec2(lane, floor(y * 0.25) + seed)));
  }
  float dist = length(vWorld - uCamPos);
  a *= smoothstep(12.0, 5.0, dist) * smoothstep(0.8, 3.0, dist) * uRain * (snow ? 0.95 : 0.55);
  if (a < 0.01) discard;
  vec3 base = snow ? vec3(1.0) : vec3(0.65, 0.72, 0.85);
  vec3 light = uAmbient * lightCurve(vLight.x) * 1.4 + vec3(1.0, 0.62, 0.3) * lightCurve(vLight.y) + vec3(0.03);
  outColor = vec4(base * light, a);
}
`;

/** Minecraft-style precipitation: textured-looking streak columns around the camera, snow in cold biomes. */
export class Weather {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private pos = new Float32Array((2 * R + 1) ** 2 * 2 * 4 * 3);
  private info = new Float32Array((2 * R + 1) ** 2 * 2 * 4 * 3);
  private light = new Float32Array((2 * R + 1) ** 2 * 2 * 4 * 2);
  level = 0;
  target = 0;
  thunder = false;

  constructor(private world: World) {
    const quads = (2 * R + 1) ** 2 * 2;
    const idx = new Uint32Array(quads * 6);
    for (let i = 0; i < quads; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('info', new THREE.BufferAttribute(this.info, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('light', new THREE.BufferAttribute(this.light, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.RawShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: { ...U },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 900;
  }

  /** Is it snowing (vs raining) at this column? */
  isSnowAt(x: number, y: number, z: number): boolean {
    const c = this.world.getChunk(x >> 4, z >> 4);
    if (!c) return false;
    const b = BIOMES[c.biomes[(x & 15) | ((z & 15) << 4)]];
    return b.snowy || y > 125;
  }
  hasPrecipitation(x: number, z: number): boolean {
    const c = this.world.getChunk(x >> 4, z >> 4);
    if (!c) return false;
    const name = BIOMES[c.biomes[(x & 15) | ((z & 15) << 4)]].name;
    return name !== 'desert' && name !== 'savanna';
  }

  update(dt: number, cam: THREE.Vector3) {
    this.level += (this.target - this.level) * Math.min(1, dt * 0.25);
    if (Math.abs(this.level - this.target) < 0.002) this.level = this.target;
    U.uRain.value = this.level;
    this.mesh.visible = this.level > 0.01;
    if (!this.mesh.visible) return;
    const cx = Math.floor(cam.x), cz = Math.floor(cam.z), cy = cam.y;
    let q = 0;
    const right = new THREE.Vector3();
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R) continue;
        const x = cx + dx, z = cz + dz;
        if (!this.hasPrecipitation(x, z)) continue;
        const ground = this.world.getHeight(x, z) + 1;
        const top = Math.floor(cy) + 12;
        const bottom = Math.max(ground, Math.floor(cy) - 10);
        if (bottom >= top) continue;
        const snow = this.isSnowAt(x, ground, z) ? 1 : 0;
        const seed = ((x * 73856093) ^ (z * 19349663)) & 1023;
        const sky = this.world.getSkyLight(x, Math.max(ground, Math.floor(cy)), z) / 15;
        const blk = this.world.getBlockLight(x, Math.max(ground, Math.floor(cy)), z) / 15;
        // Two quads facing the camera direction (billboarded around Y)
        const px = x + 0.5, pz = z + 0.5;
        right.set(-(pz - cam.z), 0, px - cam.x).normalize().multiplyScalar(0.5);
        for (let k = 0; k < 2; k++) {
          const rx = k === 0 ? right.x : right.z, rz = k === 0 ? right.z : -right.x;
          const b = q * 4;
          const verts = [
            [px - rx, bottom, pz - rz, 0],
            [px + rx, bottom, pz + rz, 1],
            [px + rx, top, pz + rz, 1],
            [px - rx, top, pz - rz, 0],
          ];
          for (let i = 0; i < 4; i++) {
            this.pos.set([verts[i][0], verts[i][1], verts[i][2]], (b + i) * 3);
            this.info.set([verts[i][3], seed / 1023 + k * 0.5, snow], (b + i) * 3);
            this.light.set([sky, blk], (b + i) * 2);
          }
          q++;
        }
      }
    this.geo.setDrawRange(0, q * 6);
    for (const n of ['position', 'info', 'light']) (this.geo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }
}
