import * as THREE from 'three';
import { World, numKey } from '../../../shared/src/world';
import { MeshBuffers, MeshJob, MeshResult, PAD, PAD_AREA, PAD_H } from './mesher';
import { WORLD_HEIGHT } from '../../../shared/src/constants';

interface ChunkMeshes {
  cx: number;
  cz: number;
  opaque: THREE.Mesh | null;
  trans: THREE.Mesh | null;
}

export class ChunkRenderer {
  readonly opaqueScene = new THREE.Scene();
  readonly transScene = new THREE.Scene();
  private meshes = new Map<number, ChunkMeshes>();
  private workers: Worker[] = [];
  private workerLoad: number[] = [];
  private queue = new Set<number>();
  private inflight = new Map<number, number>(); // key -> job id
  private requeue = new Set<number>();
  private nextJob = 1;
  private jobKeys = new Map<number, number>();
  stats = { meshes: 0, vertices: 0, pending: 0 };
  onChunkMeshed: ((cx: number, cz: number) => void) | null = null;

  constructor(
    private world: World,
    layers: Record<string, number>,
    private opaqueMat: THREE.Material,
    private transMat: THREE.Material,
  ) {
    const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' });
      w.postMessage({ type: 'init', layers });
      w.onmessage = (e) => this.onResult(i, e.data);
      this.workers.push(w);
      this.workerLoad.push(0);
    }
    this.opaqueScene.matrixWorldAutoUpdate = true;
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    for (const k of [...this.meshes.keys()]) this.removeMesh(k);
  }

  /** Called when the world gains/loses chunks. */
  markAround(cx: number, cz: number) {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) if (this.world.hasChunk(cx + dx, cz + dz)) this.queue.add(numKey(cx + dx, cz + dz));
  }

  removeChunk(cx: number, cz: number) {
    const k = numKey(cx, cz);
    this.removeMesh(k);
    this.queue.delete(k);
  }

  private removeMesh(k: number) {
    const m = this.meshes.get(k);
    if (!m) return;
    if (m.opaque) {
      this.opaqueScene.remove(m.opaque);
      m.opaque.geometry.dispose();
    }
    if (m.trans) {
      this.transScene.remove(m.trans);
      m.trans.geometry.dispose();
    }
    this.meshes.delete(k);
  }

  hasMesh(cx: number, cz: number) {
    return this.meshes.has(numKey(cx, cz));
  }

  update(camX: number, camZ: number) {
    for (const k of this.world.dirtyChunks) this.queue.add(k);
    this.world.dirtyChunks.clear();
    this.stats.pending = this.queue.size;
    if (!this.queue.size) return;
    const ccx = Math.floor(camX) >> 4, ccz = Math.floor(camZ) >> 4;
    const sorted = [...this.queue].sort((a, b) => dist2(a, ccx, ccz) - dist2(b, ccx, ccz));
    for (const k of sorted) {
      if (this.inflight.has(k)) {
        this.requeue.add(k);
        this.queue.delete(k);
        continue;
      }
      // pick least loaded worker
      let wi = 0;
      for (let i = 1; i < this.workers.length; i++) if (this.workerLoad[i] < this.workerLoad[wi]) wi = i;
      if (this.workerLoad[wi] >= 2) break;
      const cx = Math.floor(k / 65536) - 32768, cz = (k % 65536) - 32768;
      if (!this.world.hasChunk(cx, cz)) {
        this.queue.delete(k);
        continue;
      }
      const job = this.buildJob(cx, cz);
      if (!job) {
        this.queue.delete(k); // wait until neighbours arrive (they re-mark us)
        continue;
      }
      const id = this.nextJob++;
      this.inflight.set(k, id);
      this.jobKeys.set(id, k);
      this.workerLoad[wi]++;
      this.queue.delete(k);
      this.workers[wi].postMessage({ type: 'mesh', id, job }, [job.blocks.buffer, job.light.buffer, job.biomes.buffer]);
    }
  }

  private buildJob(cx: number, cz: number): MeshJob | null {
    const chunks = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.world.getChunk(cx + dx, cz + dz);
        if (!c) return null;
        chunks.push(c);
      }
    const center = chunks[4];
    let maxY = 0;
    for (const c of chunks) maxY = Math.max(maxY, c.maxHeight());
    maxY = Math.min(WORLD_HEIGHT - 1, maxY + 1);
    const blocks = new Uint16Array(PAD_AREA * PAD_H);
    const light = new Uint8Array(PAD_AREA * PAD_H);
    const biomes = new Uint8Array(PAD * PAD);
    const yEnd = Math.min(WORLD_HEIGHT, maxY + 2);
    for (let pz = 0; pz < PAD; pz++) {
      const lz = pz - 1;
      const cz = lz < 0 ? 0 : lz > 15 ? 2 : 1;
      const iz = (lz + 16) & 15;
      for (let px = 0; px < PAD; px++) {
        const lx = px - 1;
        const cxi = lx < 0 ? 0 : lx > 15 ? 2 : 1;
        const ix = (lx + 16) & 15;
        const c = chunks[cz * 3 + cxi];
        const col = ix | (iz << 4);
        biomes[px + pz * PAD] = c.biomes[col];
        const cb = c.blocks, cl = c.light;
        let pi = px + pz * PAD + PAD_AREA; // y = 0 -> padded y index 1
        for (let y = 0; y < yEnd; y++, pi += PAD_AREA) {
          const ci = col | (y << 8);
          blocks[pi] = cb[ci];
          light[pi] = cl[ci];
        }
        // above top: full sky light
        for (let y = yEnd; y < WORLD_HEIGHT; y++) light[px + pz * PAD + (y + 1) * PAD_AREA] = 0xf0;
        light[px + pz * PAD + (WORLD_HEIGHT + 1) * PAD_AREA] = 0xf0;
      }
    }
    void center;
    return { cx, cz, blocks, light, biomes, minY: 0, maxY };
  }

  private onResult(worker: number, msg: { type: string; id: number; result: MeshResult }) {
    this.workerLoad[worker]--;
    const k = this.jobKeys.get(msg.id);
    this.jobKeys.delete(msg.id);
    if (k === undefined) return;
    if (this.inflight.get(k) === msg.id) this.inflight.delete(k);
    if (this.requeue.delete(k)) this.queue.add(k);
    const { cx, cz } = msg.result;
    if (!this.world.hasChunk(cx, cz)) return;
    let m = this.meshes.get(k);
    if (!m) {
      m = { cx, cz, opaque: null, trans: null };
      this.meshes.set(k, m);
    }
    m.opaque = this.replace(m.opaque, msg.result.opaque, this.opaqueMat, this.opaqueScene, cx, cz);
    m.trans = this.replace(m.trans, msg.result.translucent, this.transMat, this.transScene, cx, cz);
    this.onChunkMeshed?.(cx, cz);
    this.updateStats();
  }

  private replace(old: THREE.Mesh | null, buf: MeshBuffers, mat: THREE.Material, scene: THREE.Scene, cx: number, cz: number): THREE.Mesh | null {
    if (old) {
      scene.remove(old);
      old.geometry.dispose();
    }
    if (buf.vertexCount === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('a_pos', new THREE.BufferAttribute(buf.pos, 4));
    geo.setAttribute('a_tex', new THREE.BufferAttribute(buf.tex, 4));
    geo.setAttribute('a_light', new THREE.BufferAttribute(buf.light, 4, true));
    geo.setAttribute('a_color', new THREE.BufferAttribute(buf.color, 4, true));
    const idx = buf.vertexCount < 65536 ? new Uint16Array(buf.index) : buf.index;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // Bounding volume from the vertex y-range
    let minY = 1e9, maxY = -1e9;
    for (let i = 1; i < buf.pos.length; i += 4) {
      const y = buf.pos[i];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    minY /= 16; maxY /= 16;
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-1, minY - 1, -1), new THREE.Vector3(17, maxY + 1, 17));
    geo.boundingSphere = new THREE.Sphere();
    geo.boundingBox.getBoundingSphere(geo.boundingSphere);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx * 16, 0, cz * 16);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    (mesh as THREE.Mesh & { chunkDist?: number }).userData.chunk = [cx, cz];
    scene.add(mesh);
    return mesh;
  }

  private updateStats() {
    let v = 0;
    for (const m of this.meshes.values()) {
      if (m.opaque) v += (m.opaque.geometry.getAttribute('a_pos') as THREE.BufferAttribute).count;
      if (m.trans) v += (m.trans.geometry.getAttribute('a_pos') as THREE.BufferAttribute).count;
    }
    this.stats.meshes = this.meshes.size;
    this.stats.vertices = v;
  }

  /** Sort translucent meshes back-to-front / opaque front-to-back by chunk distance. */
  sortForCamera(cam: THREE.Vector3) {
    for (const m of this.meshes.values()) {
      const d = (m.cx * 16 + 8 - cam.x) ** 2 + (m.cz * 16 + 8 - cam.z) ** 2;
      if (m.opaque) m.opaque.renderOrder = d * 1e-6;
      if (m.trans) m.trans.renderOrder = d * 1e-6;
    }
  }
}

function dist2(k: number, cx: number, cz: number) {
  const x = Math.floor(k / 65536) - 32768, z = (k % 65536) - 32768;
  return (x - cx) ** 2 + (z - cz) ** 2;
}
