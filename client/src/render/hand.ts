import * as THREE from 'three';
import { ItemStack, itemDef } from '../../../shared/src/items';
import { MODELS, boxFaceRects } from './entityModels';
import { generateEntityTexture } from './textures/entityTextures';
import { ENTITY_VERT, ENTITY_FRAG } from './shaders';
import { U } from './renderer';
import { ItemModels } from './itemModels';

/** First-person arm + held item with Minecraft-like swing / bob / equip animations. */
export class Hand {
  readonly root = new THREE.Group();
  private arm: THREE.Mesh;
  private itemHolder = new THREE.Group();
  private itemMesh: THREE.Mesh | null = null;
  private currentId = -1;
  private equip = 0; // 0 = lowered, 1 = raised
  private light = new THREE.Vector2(1, 0);
  private armMat: THREE.RawShaderMaterial;

  constructor(private items: ItemModels, skin: number) {
    const tex = generateEntityTexture('player', skin);
    const t = new THREE.DataTexture(new Uint8Array(tex.data.buffer, tex.data.byteOffset, tex.data.byteLength), tex.width, tex.height);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    this.armMat = new THREE.RawShaderMaterial({
      vertexShader: ENTITY_VERT,
      fragmentShader: ENTITY_FRAG.replace('col = applyFog(col, vWorld);', ''),
      glslVersion: THREE.GLSL3,
      uniforms: { ...U, uTex: { value: t }, uLight: { value: this.light }, uHurt: { value: 0 }, uWhite: { value: 0 }, uTintColor: { value: new THREE.Vector3(1, 1, 1) } },
    });
    const box = MODELS.player.boxes.find((b) => b.name === 'rightArm')!;
    this.arm = new THREE.Mesh(armGeometry(box.size, box.uv), this.armMat);
    this.root.add(this.arm);
    this.root.add(this.itemHolder);
  }

  setItem(stack: ItemStack | null) {
    const id = stack ? stack.id : -1;
    if (id === this.currentId) return;
    this.currentId = id;
    this.equip = 0.2;
    if (this.itemMesh) this.itemHolder.remove(this.itemMesh);
    this.itemMesh = null;
    if (!stack) return;
    const m = new THREE.Mesh(this.items.geometry(stack.id), this.items.material(stack.id, true));
    this.itemMesh = m;
    this.itemHolder.add(m);
  }

  update(dt: number, opts: { swing: number; bob: number; bobAmount: number; eating: number; pitch: number; sky: number; blk: number; hidden: boolean }) {
    this.root.visible = !opts.hidden;
    this.equip = Math.min(1, this.equip + dt * 5);
    this.light.set(opts.sky, opts.blk);
    this.itemMesh?.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.RawShaderMaterial | undefined;
      if (mat?.uniforms?.uLight) mat.uniforms.uLight.value.set(opts.sky, opts.blk);
    });
    const swing = opts.swing > 0 ? 1 - opts.swing : 0; // 0..1 progress
    const sp = Math.sin(swing * Math.PI);
    const sq = Math.sin(Math.sqrt(swing) * Math.PI);
    const bobX = Math.sin(opts.bob) * 0.03 * opts.bobAmount;
    const bobY = -Math.abs(Math.cos(opts.bob)) * 0.04 * opts.bobAmount;
    const lower = (1 - this.equip) * -0.6;

    const hasItem = !!this.itemMesh;
    this.arm.visible = !hasItem;
    this.itemHolder.visible = hasItem;
    if (!hasItem) {
      // Bare arm (Minecraft's first person arm pose)
      // Shoulder sits off-screen bottom-right; the arm points forward/up towards the screen centre.
      const shoulder = new THREE.Vector3(0.62 + bobX - sq * 0.25, -0.78 + bobY + lower + Math.sin(Math.sqrt(swing) * Math.PI * 2) * 0.1, -0.35 - sp * 0.25);
      const dir = new THREE.Vector3(-0.28 - sq * 0.3, 0.38 + sp * 0.15, -1).normalize();
      this.arm.position.copy(shoulder);
      this.arm.lookAt(shoulder.clone().sub(dir));
      this.arm.rotateZ(0.6);
      return;
    }
    const def = itemDef(this.currentId);
    const flat = this.items.isFlat(this.currentId);
    const isTool = !!def.tool;
    let eatY = 0, eatRot = 0;
    if (opts.eating > 0) {
      eatY = Math.min(1, opts.eating / 6) * 0.15 + Math.abs(Math.sin(opts.eating * 0.8)) * 0.03;
      eatRot = Math.min(1, opts.eating / 6);
    }
    const h = this.itemHolder;
    h.position.set(0.52 + bobX - sq * 0.35 - eatRot * 0.4, -0.5 + bobY + lower + Math.sin(Math.sqrt(swing) * Math.PI * 2) * 0.18 + eatY, -0.85 - sp * 0.25 + eatRot * 0.25);
    h.rotation.set(0, 0, 0);
    const m = this.itemMesh!;
    if (flat) {
      m.scale.setScalar(isTool ? 0.62 : 0.5);
      m.position.set(0, isTool ? 0.08 : 0, 0);
      m.rotation.set(0, 0, 0);
      h.rotateY(-Math.PI / 2 + 0.05 + sq * 0.6 - eatRot * 0.6);
      h.rotateZ(isTool ? 0.35 - sp * 1.2 : 0.2 - sp * 0.8);
      h.rotateX(-0.05 - eatRot * 0.3);
    } else {
      m.scale.setScalar(0.3);
      m.position.set(0.05, 0.02, 0);
      m.rotation.set(0, 0, 0);
      h.rotateY(Math.PI / 4 + 0.2 + sq * 0.5);
      h.rotateX(-sp * 0.8);
    }
  }
}

function armGeometry(size: [number, number, number], uv: [number, number]): THREE.BufferGeometry {
  // Arm pointing along -Z (length 12px), origin at the shoulder end
  const [w, h, d] = size;
  const r = boxFaceRects({ size, uv });
  const s = 1 / 16;
  const x0 = -w / 2 * s, x1 = w / 2 * s, y0 = -d / 2 * s, y1 = d / 2 * s, z0 = -h * s, z1 = 0;
  const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], idx: number[] = [];
  const rect = (rc: [number, number, number, number], rot = false) => {
    const [rx, ry, rw, rh] = rc;
    const u0 = rx / 64, u1 = (rx + rw) / 64, v0 = ry / 64, v1 = (ry + rh) / 64;
    // bottom of face texture (hand end) maps to z0
    return rot ? [[u0, v1], [u1, v1], [u1, v0], [u0, v0]] : [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
  };
  const quad = (p: number[][], n: number[], uv: number[][]) => {
    const b = pos.length / 3;
    p.forEach((q, i) => { pos.push(q[0], q[1], q[2]); nrm.push(n[0], n[1], n[2]); uvs.push(uv[i][0], uv[i][1]); });
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  // Long faces (arm length along -Z): texture vertical = along arm
  quad([[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], [0, 1, 0], rect(r.front));
  quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], rect(r.back));
  quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], rect(r.right));
  quad([[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [-1, 0, 0], rect(r.left));
  // Hand end
  const [bx, by, bw, bh] = r.bottom;
  quad([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], [0, 0, -1], [[bx / 64, (by + bh) / 64], [bx / 64, by / 64], [(bx + bw) / 64, by / 64], [(bx + bw) / 64, (by + bh) / 64]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}
