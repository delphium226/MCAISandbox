import * as THREE from 'three';
import { EntityState } from '../../../shared/src/protocol';
import { World } from '../../../shared/src/world';
import { ItemStack, itemDef } from '../../../shared/src/items';
import { WOOL_COLORS, BLOCKS } from '../../../shared/src/blocks';
import { MODELS, BoxDef, boxFaceRects, ModelDef } from './entityModels';
import { generateEntityTexture } from './textures/entityTextures';
import { ENTITY_VERT, ENTITY_FRAG } from './shaders';
import { U } from './renderer';
import { ItemModels } from './itemModels';

const texCache = new Map<string, THREE.DataTexture>();
function entityTexture(kind: string, variant = 0): THREE.DataTexture {
  const key = `${kind}:${variant}`;
  let t = texCache.get(key);
  if (t) return t;
  const et = generateEntityTexture(kind, variant);
  t = new THREE.DataTexture(new Uint8Array(et.data.buffer, et.data.byteOffset, et.data.byteLength), et.width, et.height, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

function boxGeometry(b: BoxDef, texW: number, texH: number): THREE.BufferGeometry {
  const inf = b.inflate ?? 0;
  const [fx, fy, fz] = b.from;
  const [w, h, d] = b.size;
  const [px, py, pz] = b.pivot;
  const x0 = (fx - inf - px) / 16, x1 = (fx + w + inf - px) / 16;
  const y0 = (fy - inf - py) / 16, y1 = (fy + h + inf - py) / 16;
  const z0 = (fz - inf - pz) / 16, z1 = (fz + d + inf - pz) / 16;
  const r = boxFaceRects(b);
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], idx: number[] = [];
  // uv rect helper: returns corners [bl, br, tr, tl] in GL uv (v=0 top row since DataTexture is not flipped)
  const rect = (rc: [number, number, number, number], flipU = false, flipV = false) => {
    let [rx, ry, rw, rh] = rc;
    let u0 = rx / texW, u1 = (rx + rw) / texW;
    let v0 = ry / texH, v1 = (ry + rh) / texH;
    if (flipU !== !!b.mirror) [u0, u1] = [u1, u0];
    if (flipV) [v0, v1] = [v1, v0];
    return [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
  };
  const quad = (p: number[][], n: number[], uvs: number[][]) => {
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(p[i][0], p[i][1], p[i][2]);
      nrm.push(n[0], n[1], n[2]);
      uv.push(uvs[i][0], uvs[i][1]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const mir = !!b.mirror;
  // +X (right side), u increases towards -Z
  quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], rect(mir ? r.left : r.right));
  // -X (left side), u increases towards +Z
  quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], rect(mir ? r.right : r.left));
  // -Z (front), u increases towards -X
  quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], rect(r.front));
  // +Z (back), u increases towards +X
  quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], rect(r.back));
  // +Y top: u towards -X, bottom row (v large) = front edge (-Z)
  quad([[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], [0, 1, 0], rect(r.top));
  // -Y bottom
  quad([[x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0]], [0, -1, 0], rect(r.bottom));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

interface Model {
  root: THREE.Group;
  parts: Record<string, THREE.Object3D>;
  materials: THREE.RawShaderMaterial[];
  overlayMats: THREE.RawShaderMaterial[];
}

function makeMaterial(tex: THREE.Texture, light: THREE.Vector2, hurt: { value: number }, white: { value: number }, tint: THREE.Vector3) {
  return new THREE.RawShaderMaterial({
    vertexShader: ENTITY_VERT,
    fragmentShader: ENTITY_FRAG,
    glslVersion: THREE.GLSL3,
    uniforms: { ...U, uTex: { value: tex }, uLight: { value: light }, uHurt: hurt, uWhite: white, uTintColor: { value: tint } },
  });
}

function buildModel(kind: string, def: ModelDef, tex: THREE.Texture, overlayTex: THREE.Texture | null, light: THREE.Vector2, hurt: { value: number }, white: { value: number }, overlayTint: THREE.Vector3): Model {
  const root = new THREE.Group();
  const parts: Record<string, THREE.Object3D> = {};
  const mat = makeMaterial(tex, light, hurt, white, new THREE.Vector3(1, 1, 1));
  const omat = overlayTex ? makeMaterial(overlayTex, light, hurt, white, overlayTint) : null;
  for (const b of def.boxes) {
    const key = `${kind}:${b.name}`;
    let g = geoCache.get(key);
    if (!g) {
      g = boxGeometry(b, def.texSize[0], def.texSize[1]);
      geoCache.set(key, g);
    }
    const pivot = new THREE.Group();
    pivot.position.set(b.pivot[0] / 16, b.pivot[1] / 16, b.pivot[2] / 16);
    if (b.rot) pivot.rotation.set(b.rot[0], b.rot[1], b.rot[2]);
    const m = new THREE.Mesh(g, b.layer === 'overlay' && omat ? omat : mat);
    pivot.add(m);
    root.add(pivot);
    parts[b.name] = pivot;
  }
  return { root, parts, materials: [mat], overlayMats: omat ? [omat] : [] };
}

export class RenderEntity {
  group = new THREE.Group();
  model: Model | null = null;
  pos = new THREE.Vector3();
  target = new THREE.Vector3();
  yaw = 0;
  targetYaw = 0;
  pitch = 0;
  targetPitch = 0;
  bodyYaw = 0;
  walkPhase = 0;
  walkAmount = 0;
  hurt = { value: 0 };
  white = { value: 0 };
  light = new THREE.Vector2(1, 0);
  swing = 0;
  dying = 0;
  itemMesh: THREE.Object3D | null = null;
  heldMesh: THREE.Object3D | null = null;
  nameTag: THREE.Sprite | null = null;
  age = Math.random() * 100;
  overlayTint = new THREE.Vector3(1, 1, 1);
  woolParts: THREE.Object3D[] = [];
  lastHeld = -1;
  fuseScale = 0;

  constructor(public state: EntityState) {
    this.pos.set(state.x, state.y, state.z);
    this.target.copy(this.pos);
    this.yaw = this.targetYaw = this.bodyYaw = state.yaw;
    this.pitch = this.targetPitch = state.pitch;
  }

  get kind() {
    return this.state.kind;
  }

  /** Collision/selection box in world space. */
  box(): [number, number, number, number, number, number] {
    const [w, h] = entitySize(this.state);
    return [this.pos.x - w / 2, this.pos.y, this.pos.z - w / 2, this.pos.x + w / 2, this.pos.y + h, this.pos.z + w / 2];
  }
}

export function entitySize(s: EntityState): [number, number] {
  switch (s.kind) {
    case 'player': return [0.6, s.sneaking ? 1.5 : 1.8];
    case 'pig': return [0.9, 0.9];
    case 'cow': return [0.9, 1.4];
    case 'sheep': return [0.9, 1.3];
    case 'chicken': return [0.4, 0.7];
    case 'zombie': return [0.6, 1.95];
    case 'skeleton': return [0.6, 1.99];
    case 'creeper': return [0.6, 1.7];
    case 'spider': return [1.4, 0.9];
    case 'item': return [0.25, 0.25];
    case 'arrow': return [0.3, 0.3];
    default: return [0.98, 0.98];
  }
}

export class EntityRenderer {
  entities = new Map<number, RenderEntity>();
  readonly group = new THREE.Group();

  constructor(private scene: THREE.Scene, private world: World, private items: ItemModels) {
    scene.add(this.group);
  }

  add(state: EntityState) {
    this.remove(state.id, true);
    const e = new RenderEntity(state);
    this.build(e);
    this.entities.set(state.id, e);
    this.group.add(e.group);
    return e;
  }

  private build(e: RenderEntity) {
    const s = e.state;
    const kind = s.kind;
    if (kind === 'item') {
      this.setItem(e, s.item ?? null);
      return;
    }
    if (kind === 'falling_block' || kind === 'tnt') {
      const id = kind === 'tnt' ? BLOCKS.find((b) => b.name === 'tnt')!.id : (s.state ?? 1) & 0xff;
      const mesh = new THREE.Mesh(this.items.geometry(id), this.items.material(id));
      mesh.scale.setScalar(0.98);
      mesh.position.y = 0.49;
      e.itemMesh = mesh;
      e.group.add(mesh);
      return;
    }
    if (kind === 'arrow') {
      const id = itemDef(0).id;
      void id;
      const arrowId = [...Array(2000).keys()].find((i) => itemDef(i)?.name === 'arrow') ?? 0;
      const mesh = new THREE.Mesh(this.items.geometry(arrowId), this.items.material(arrowId));
      mesh.scale.setScalar(0.5);
      mesh.rotation.set(0, Math.PI / 2, Math.PI / 4);
      const holder = new THREE.Group();
      holder.add(mesh);
      e.itemMesh = holder;
      e.group.add(holder);
      return;
    }
    const def = MODELS[kind];
    if (!def) return;
    const variant = kind === 'player' ? s.skin ?? 0 : 0;
    const tex = entityTexture(kind, variant);
    const overlay = kind === 'sheep' ? entityTexture('sheep_fur') : null;
    e.model = buildModel(kind, def, tex, overlay, e.light, e.hurt, e.white, e.overlayTint);
    e.group.add(e.model.root);
    if (kind === 'sheep') {
      e.woolParts = Object.entries(e.model.parts).filter(([n]) => n.startsWith('wool')).map(([, p]) => p);
      this.updateSheep(e);
    }
    if (kind === 'player' && s.name) {
      e.nameTag = makeNameTag(s.name + (s.isAgent ? ' [AI]' : ''));
      e.nameTag.position.y = 2.1;
      e.group.add(e.nameTag);
    }
    if (kind === 'player' || kind === 'zombie' || kind === 'skeleton') this.updateHeld(e);
  }

  private updateSheep(e: RenderEntity) {
    const v = e.state.variant ?? 0;
    const sheared = (v & 16) !== 0;
    const color = v & 15;
    const c = color === 0 ? [233, 236, 236] : WOOL_COLORS[color - 1][2];
    e.overlayTint.set(c[0] / 255, c[1] / 255, c[2] / 255).multiplyScalar(1.0);
    // Brighten tinted wool a bit (texture is grayscale-bright)
    e.overlayTint.set(Math.pow(e.overlayTint.x, 2.2), Math.pow(e.overlayTint.y, 2.2), Math.pow(e.overlayTint.z, 2.2)).multiplyScalar(1.15);
    for (const p of e.woolParts) p.visible = !sheared;
  }

  private setItem(e: RenderEntity, stack: ItemStack | null) {
    if (e.itemMesh) e.group.remove(e.itemMesh);
    e.itemMesh = null;
    if (!stack) return;
    const holder = new THREE.Group();
    const flat = this.items.isFlat(stack.id);
    const copies = stack.count > 32 ? 4 : stack.count > 16 ? 3 : stack.count > 1 ? 2 : 1;
    const mat = this.items.material(stack.id);
    for (let i = 0; i < copies; i++) {
      const m = new THREE.Mesh(this.items.geometry(stack.id), mat);
      m.scale.setScalar(flat ? 0.5 : 0.25);
      m.position.set((i % 2) * 0.06 - 0.03 * (copies > 1 ? 1 : 0), i * 0.04, ((i >> 1) % 2) * 0.06 - (flat ? i * 0.03 : 0));
      holder.add(m);
    }
    holder.position.y = flat ? 0.25 : 0.125;
    e.itemMesh = holder;
    e.group.add(holder);
  }

  private updateHeld(e: RenderEntity) {
    if (!e.model) return;
    const item = e.state.item;
    const id = item ? item.id : -1;
    if (id === e.lastHeld) return;
    e.lastHeld = id;
    const arm = e.model.parts.rightArm;
    if (e.heldMesh) arm.remove(e.heldMesh);
    e.heldMesh = null;
    if (!item) return;
    const flat = this.items.isFlat(item.id);
    const m = new THREE.Mesh(this.items.geometry(item.id), this.items.material(item.id));
    const holder = new THREE.Group();
    holder.add(m);
    if (flat) {
      m.scale.setScalar(0.6);
      holder.position.set(1 / 16, -10 / 16, -2 / 16);
      holder.rotation.set(-Math.PI / 2 + 0.3, -Math.PI / 2, 0);
      // Tools point forward
      m.rotation.z = Math.PI / 4 - Math.PI / 2;
      m.position.set(0, 0.1, 0);
    } else {
      m.scale.setScalar(0.28);
      holder.position.set(1 / 16, -11 / 16, -3 / 16);
      holder.rotation.set(0.35, Math.PI / 4, 0);
    }
    e.heldMesh = holder;
    arm.add(holder);
  }

  update(id: number, patch: Partial<EntityState>) {
    const e = this.entities.get(id);
    if (!e) return;
    Object.assign(e.state, patch);
    if (patch.item !== undefined) {
      if (e.state.kind === 'item') this.setItem(e, patch.item ?? null);
      else this.updateHeld(e);
    }
    if (patch.variant !== undefined) {
      if (e.state.kind === 'sheep') this.updateSheep(e);
    }
  }

  move(id: number, x: number, y: number, z: number, yaw: number, pitch: number) {
    const e = this.entities.get(id);
    if (!e) return;
    e.target.set(x, y, z);
    e.targetYaw = yaw;
    e.targetPitch = pitch;
    // Teleports snap
    if (e.pos.distanceToSquared(e.target) > 64) e.pos.copy(e.target);
  }

  anim(id: number, a: string) {
    const e = this.entities.get(id);
    if (!e) return;
    if (a === 'hurt') e.hurt.value = 1;
    else if (a === 'swing') e.swing = 1;
    else if (a === 'death') e.dying = 0.001;
  }

  remove(id: number, immediate = false) {
    const e = this.entities.get(id);
    if (!e) return;
    if (!immediate && e.dying > 0 && e.dying < 1) {
      // let the death animation finish
      setTimeout(() => this.remove(id, true), 900);
      return;
    }
    this.group.remove(e.group);
    this.entities.delete(id);
  }

  frame(dt: number, camPos: THREE.Vector3) {
    for (const e of this.entities.values()) {
      e.age += dt;
      const k = Math.min(1, dt * 14);
      const prevX = e.pos.x, prevZ = e.pos.z;
      e.pos.lerp(e.target, k);
      e.yaw = lerpAngle(e.yaw, e.targetYaw, Math.min(1, dt * 12));
      e.pitch += (e.targetPitch - e.pitch) * Math.min(1, dt * 12);
      const speed = Math.hypot(e.pos.x - prevX, e.pos.z - prevZ) / Math.max(dt, 1e-3);
      e.walkAmount += (Math.min(1, speed / 4) - e.walkAmount) * Math.min(1, dt * 10);
      e.walkPhase += speed * dt * 2.6;
      if (e.hurt.value > 0) e.hurt.value = Math.max(0, e.hurt.value - dt * 2.5);
      if (e.swing > 0) e.swing = Math.max(0, e.swing - dt * 3.5);

      // Lighting at the entity
      const bx = Math.floor(e.pos.x), by = Math.floor(e.pos.y + 0.5), bz = Math.floor(e.pos.z);
      e.light.set(this.world.getSkyLight(bx, by, bz) / 15, this.world.getBlockLight(bx, by, bz) / 15);

      e.group.position.copy(e.pos);
      const kind = e.state.kind;
      if (kind === 'item') {
        if (e.itemMesh) {
          e.itemMesh.rotation.y = e.age * 1.2;
          e.itemMesh.position.y = (this.items.isFlat(e.state.item?.id ?? 0) ? 0.25 : 0.15) + Math.sin(e.age * 2.2) * 0.06;
          setMatLight(e.itemMesh, e.light);
        }
        continue;
      }
      if (kind === 'falling_block' || kind === 'tnt') {
        if (e.itemMesh) {
          setMatLight(e.itemMesh, e.light);
          if (kind === 'tnt') {
            const flash = Math.floor(e.age * 5) % 2 === 0;
            e.itemMesh.scale.setScalar(0.98 + Math.max(0, e.age - 3) * 0.1);
            e.itemMesh.traverse((o) => {
              const m = (o as THREE.Mesh).material as THREE.RawShaderMaterial | undefined;
              if (m?.uniforms?.uLight) m.uniforms.uLight.value.set(flash ? 1 : e.light.x, flash ? 1 : e.light.y);
            });
          }
        }
        continue;
      }
      if (kind === 'arrow') {
        e.group.rotation.set(0, e.yaw, 0, 'YXZ');
        if (e.itemMesh) {
          e.itemMesh.rotation.x = e.pitch;
          setMatLight(e.itemMesh, e.light);
        }
        continue;
      }
      if (!e.model) continue;
      // Body yaw follows head when moving, lags when still
      const diff = angleDiff(e.yaw, e.bodyYaw);
      if (e.walkAmount > 0.1) e.bodyYaw = lerpAngle(e.bodyYaw, e.yaw, Math.min(1, dt * 8));
      else if (Math.abs(diff) > 0.9) e.bodyYaw += diff - Math.sign(diff) * 0.9;
      e.group.rotation.set(0, e.bodyYaw, 0);
      this.animate(e, dt);
      if (e.dying > 0) {
        e.dying = Math.min(1, e.dying + dt * 1.6);
        e.model.root.rotation.z = (Math.PI / 2) * Math.min(1, e.dying * 1.5);
        e.hurt.value = 1;
      }
      if (e.nameTag) {
        const d = camPos.distanceTo(e.pos);
        e.nameTag.visible = d < 48 && !e.state.sneaking;
      }
    }
  }

  private animate(e: RenderEntity, dt: number) {
    const p = e.model!.parts;
    const walk = Math.sin(e.walkPhase) * e.walkAmount;
    const headYaw = angleDiff(e.yaw, e.bodyYaw);
    const kind = e.state.kind;
    const t = e.age;
    if (p.head) {
      p.head.rotation.set(-e.pitch * (kind === 'player' || kind === 'zombie' || kind === 'skeleton' || kind === 'creeper' ? 1 : 0.5), headYaw, 0, 'YXZ');
      if (p.hat) p.hat.rotation.copy(p.head.rotation);
      for (const n of ['snout', 'horn0', 'horn1', 'beak', 'wattle', 'woolHead']) if (p[n]) p[n].rotation.copy(p.head.rotation);
    }
    if (kind === 'player' || kind === 'zombie' || kind === 'skeleton') {
      const sneak = e.state.sneaking ? 1 : 0;
      p.rightLeg.rotation.x = walk * 0.9;
      p.leftLeg.rotation.x = -walk * 0.9;
      const idle = Math.sin(t * 1.2) * 0.04;
      if (kind === 'player') {
        p.rightArm.rotation.set(-walk * 0.9 + idle, 0, 0.03 + idle);
        p.leftArm.rotation.set(walk * 0.9 - idle, 0, -0.03 - idle);
        if (e.heldMesh) p.rightArm.rotation.x = p.rightArm.rotation.x * 0.5 - 0.3;
      } else {
        p.rightArm.rotation.set(-Math.PI / 2 + Math.sin(t * 2) * 0.05, 0, 0);
        p.leftArm.rotation.set(-Math.PI / 2 - Math.sin(t * 2) * 0.05, 0, 0);
      }
      if (e.swing > 0) {
        const s = Math.sin((1 - e.swing) * Math.PI);
        p.rightArm.rotation.x -= s * 1.2;
        p.rightArm.rotation.y = s * 0.4;
      }
      p.body.rotation.x = sneak * 0.5;
      p.head.position.y = (24 - sneak * 3) / 16;
      if (p.hat) p.hat.position.y = p.head.position.y;
      p.rightArm.position.y = (22 - sneak * 3) / 16;
      p.leftArm.position.y = (22 - sneak * 3) / 16;
      p.rightLeg.position.z = sneak * 4 / 16;
      p.leftLeg.position.z = sneak * 4 / 16;
    } else if (kind === 'spider') {
      for (let i = 0; i < 4; i++) {
        const ph = e.walkPhase * 2 + i * 1.3;
        const spread = (i - 1.5) * 0.5;
        const lr = p[`legR${i}`], ll = p[`legL${i}`];
        lr.rotation.set(0, spread + Math.sin(ph) * 0.4 * e.walkAmount, 0.6 - Math.abs(Math.cos(ph)) * 0.2 * e.walkAmount);
        ll.rotation.set(0, -spread - Math.sin(ph) * 0.4 * e.walkAmount, -0.6 + Math.abs(Math.cos(ph)) * 0.2 * e.walkAmount);
      }
    } else if (kind === 'chicken') {
      p.leg0.rotation.x = walk * 1.2;
      p.leg1.rotation.x = -walk * 1.2;
      const flap = Math.abs(e.target.y - e.pos.y) > 0.01 ? Math.sin(t * 30) * 0.8 + 0.8 : 0;
      p.wing0.rotation.z = -flap;
      p.wing1.rotation.z = flap;
    } else {
      // Quadrupeds & creeper
      for (let i = 0; i < 4; i++) {
        const leg = p[`leg${i}`];
        if (!leg) continue;
        leg.rotation.x = (i === 0 || i === 3 ? 1 : -1) * walk * 1.1;
        const wool = p[`woolLeg${i}`];
        if (wool) wool.rotation.x = leg.rotation.x;
      }
      if (kind === 'creeper') {
        const fusing = (e.state.variant ?? 0) === 1;
        e.fuseScale += ((fusing ? 1 : 0) - e.fuseScale) * Math.min(1, dt * 6);
        const s = 1 + e.fuseScale * 0.18 + (fusing ? Math.sin(t * 25) * 0.03 : 0);
        e.model!.root.scale.set(s, 1 + e.fuseScale * 0.08, s);
        e.white.value = fusing ? (Math.floor(t * 8) % 2) * 0.8 : 0;
      }
      if (p.woolBody && p.body) p.woolBody.rotation.copy(p.body.rotation);
    }
  }

  /** Targets for crosshair picking (living entities only). */
  pickable(): { id: number; box: [number, number, number, number, number, number] }[] {
    const out = [];
    for (const [id, e] of this.entities) {
      const k = e.state.kind;
      if (k === 'item' || k === 'arrow' || k === 'falling_block' || k === 'tnt' || e.dying > 0) continue;
      out.push({ id, box: e.box() });
    }
    return out;
  }
}

function setMatLight(o: THREE.Object3D, light: THREE.Vector2) {
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material as THREE.RawShaderMaterial | undefined;
    if (m?.uniforms?.uLight) m.uniforms.uLight.value.copy(light);
  });
}

function angleDiff(a: number, b: number) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function lerpAngle(a: number, b: number, t: number) {
  return a + angleDiff(b, a) * t;
}

function makeNameTag(text: string): THREE.Sprite {
  const scale = 4;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `${8 * scale}px MCPixel, monospace`;
  const w = Math.ceil(ctx.measureText(text).width) + 4 * scale;
  c.width = w;
  c.height = 12 * scale;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = `${8 * scale}px MCPixel, monospace`;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 2 * scale, c.height / 2 + scale);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set((c.width / c.height) * 0.3, 0.3, 1);
  return s;
}
