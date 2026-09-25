import * as THREE from 'three';
import { SimplexNoise } from '../../../shared/src/noise';
import { CLOUD_VERT, CLOUD_FRAG } from './shaders';
import { U } from './renderer';

const CELLS = 64;
const CELL = 12;
const THICK = 4;
const HEIGHT = 192;
const TILE = CELLS * CELL;

/** Minecraft-style blocky clouds: a tiling grid of 12x4x12 boxes drifting slowly west→east. */
export class Clouds {
  readonly mesh = new THREE.Group();
  private tiles: THREE.Mesh[] = [];

  constructor() {
    const noise = new SimplexNoise(1337);
    const map: boolean[] = [];
    for (let z = 0; z < CELLS; z++)
      for (let x = 0; x < CELLS; x++) {
        // Tileable noise via sampling on a torus
        const a = (x / CELLS) * Math.PI * 2, b = (z / CELLS) * Math.PI * 2;
        const n = noise.noise3(Math.cos(a) * 3, Math.sin(a) * 3 + Math.cos(b) * 3, Math.sin(b) * 3) * 0.7 +
          noise.noise3(Math.cos(a) * 9 + 50, Math.sin(a) * 9, Math.cos(b) * 9 + Math.sin(b) * 9) * 0.3;
        map.push(n > 0.18);
      }
    const at = (x: number, z: number) => map[((z + CELLS) % CELLS) * CELLS + ((x + CELLS) % CELLS)];
    const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
    const quad = (p: number[][], n: number[]) => {
      const b = pos.length / 3;
      for (const v of p) { pos.push(v[0], v[1], v[2]); nrm.push(n[0], n[1], n[2]); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    for (let z = 0; z < CELLS; z++)
      for (let x = 0; x < CELLS; x++) {
        if (!at(x, z)) continue;
        const x0 = x * CELL, x1 = x0 + CELL, z0 = z * CELL, z1 = z0 + CELL, y0 = 0, y1 = THICK;
        quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0]);
        quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
        if (!at(x + 1, z)) quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0]);
        if (!at(x - 1, z)) quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0]);
        if (!at(x, z + 1)) quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
        if (!at(x, z - 1)) quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1]);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mat = new THREE.RawShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: { ...U },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 1000;
      this.tiles.push(m);
      this.mesh.add(m);
    }
  }

  update(cam: THREE.Vector3, time: number, enabled: boolean, _viewDist: number) {
    this.mesh.visible = enabled;
    if (!enabled) return;
    const drift = (time * 0.6) % TILE;
    const baseX = Math.floor((cam.x - drift) / TILE) * TILE + drift;
    const baseZ = Math.floor(cam.z / TILE) * TILE;
    let i = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const t = this.tiles[i++];
        t.position.set(baseX + dx * TILE, HEIGHT, baseZ + dz * TILE);
      }
  }
}
