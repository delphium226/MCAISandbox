import * as THREE from 'three';
import { Body, makeBody, stepPlayer, raycast, RayHit, updateEnvironment, rayAABB, AABB } from '../../../shared/src/physics';
import { PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_SNEAK_EYE, REACH_DISTANCE, TICK_MS, GameMode, FACE_DIRS } from '../../../shared/src/constants';
import { World } from '../../../shared/src/world';
import { ItemStack, itemDef } from '../../../shared/src/items';
import { blockOf, BLOCKS } from '../../../shared/src/blocks';
import { breakTicks } from '../../../shared/src/mining';
import { Input } from './input';

export interface TargetEntity {
  id: number;
  box: AABB;
}

export interface PlayerHooks {
  send: (msg: import('../../../shared/src/protocol').C2S) => void;
  entities: () => TargetEntity[];
  heldItem: () => ItemStack | null;
  sound: (name: string, x?: number, y?: number, z?: number, volume?: number, pitch?: number) => void;
  onBreakBlock: (x: number, y: number, z: number, state: number) => void;
  onSwing: () => void;
  gamemode: () => GameMode;
  foodLevel: () => number;
  predictPlace: (x: number, y: number, z: number, face: number) => void;
}

export class LocalPlayer {
  body: Body;
  prev = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  flying = false;
  sneaking = false;
  sprinting = false;
  private tickAcc = 0;
  target: RayHit | null = null;
  targetEntity: number | null = null;
  digging: { x: number; y: number; z: number; progress: number; need: number; face: number } | null = null;
  private digCooldown = 0;
  private useCooldown = 0;
  private attackCooldown = 0;
  eating = 0;
  bob = 0;
  bobAmount = 0;
  private stepDist = 0;
  private lastSent = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, onGround: false, sneak: false, sprint: false, flying: false };
  private sentTicks = 0;
  /** Smoothed eye height for sneaking transitions */
  eye = PLAYER_EYE_HEIGHT;
  fovBoost = 1;
  swingTime = 0;
  noClip = false;
  hurtTilt = 0;
  private wasInWater = false;
  frozen = true; // until the spawn chunk is loaded

  constructor(private world: World, private input: Input, private hooks: PlayerHooks) {
    this.body = makeBody(0, 100, 0, 0.6, PLAYER_HEIGHT);
  }

  setPosition(x: number, y: number, z: number) {
    this.body.x = x;
    this.body.y = y;
    this.body.z = z;
    this.body.vx = this.body.vy = this.body.vz = 0;
    this.body.fallDistance = 0;
    this.prev.set(x, y, z);
  }

  get eyeHeight() {
    return this.sneaking && !this.flying ? PLAYER_SNEAK_EYE : PLAYER_EYE_HEIGHT;
  }

  /** Interpolated feet position. */
  renderPos(out: THREE.Vector3) {
    const a = this.tickAcc / TICK_MS;
    return out.set(
      this.prev.x + (this.body.x - this.prev.x) * a,
      this.prev.y + (this.body.y - this.prev.y) * a,
      this.prev.z + (this.body.z - this.prev.z) * a,
    );
  }

  lookDir(): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  update(dtMs: number, uiOpen: boolean) {
    const input = this.input;
    if (!uiOpen) {
      this.yaw -= input.mouseDX * input.sensitivity;
      this.pitch -= input.mouseDY * input.sensitivity;
      this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));
    }
    const gm = this.hooks.gamemode();
    if (gm === 'spectator') this.flying = true;
    if (gm === 'survival') this.flying = false;

    this.tickAcc += Math.min(dtMs, 250);
    while (this.tickAcc >= TICK_MS) {
      this.tickAcc -= TICK_MS;
      this.tick(uiOpen);
    }
    // Smooth eye height
    const targetEye = this.eyeHeight;
    this.eye += (targetEye - this.eye) * Math.min(1, dtMs / 60);
    const fovTarget = (this.sprinting ? 1.12 : 1) * (this.flying && this.sprinting ? 1.08 : 1);
    this.fovBoost += (fovTarget - this.fovBoost) * Math.min(1, dtMs / 120);
    if (this.swingTime > 0) this.swingTime = Math.max(0, this.swingTime - dtMs / 300);
    if (this.hurtTilt > 0) this.hurtTilt = Math.max(0, this.hurtTilt - dtMs / 500);
    this.updateTarget();
  }

  private tick(uiOpen: boolean) {
    const input = this.input;
    const b = this.body;
    this.prev.set(b.x, b.y, b.z);
    if (this.frozen) return;
    const gm = this.hooks.gamemode();
    let forward = 0, strafe = 0, jump = false, sneak = false;
    if (!uiOpen) {
      if (input.down('KeyW')) forward += 1;
      if (input.down('KeyS')) forward -= 1;
      if (input.down('KeyD')) strafe += 1;
      if (input.down('KeyA')) strafe -= 1;
      jump = input.down('Space');
      sneak = input.down('ShiftLeft') || input.down('ShiftRight');
      if (gm !== 'survival' && input.consumeDoubleTap('Space')) {
        this.flying = !this.flying || gm === 'spectator';
        b.vy = 0;
      }
      if ((input.down('ControlLeft') || input.consumeDoubleTap('KeyW')) && forward > 0) this.sprinting = true;
    }
    if (forward <= 0 || sneak || (gm === 'survival' && this.hooks.foodLevel() <= 6) || (b.horizontalCollision && !this.flying)) this.sprinting = false;
    if (this.eating > 0) this.sprinting = false;
    this.sneaking = sneak && !this.flying;
    const eatSlow = this.eating > 0 ? 0.25 : 1;
    const moveInput = { forward: forward * eatSlow, strafe: strafe * eatSlow, jump, sneak, sprint: this.sprinting, yaw: this.yaw, flying: this.flying };
    if (gm === 'spectator') {
      // No-clip flight
      const d = this.lookDir();
      const speed = this.sprinting ? 1.2 : 0.6;
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      b.x += (d.x * forward + right.x * strafe) * speed;
      b.z += (d.z * forward + right.z * strafe) * speed;
      b.y += d.y * forward * speed + (jump ? speed : 0) - (sneak ? speed : 0);
    } else {
      // Suffocation guard: if stuck inside a solid block (e.g. after a teleport), pop up
      for (let i = 0; i < 16; i++) {
        const fy = Math.floor(b.y + 0.05), hy = Math.floor(b.y + 1.5);
        const solidAt = (y: number) => BLOCKS[this.world.getBlock(Math.floor(b.x), y, Math.floor(b.z)) & 0xff].opaque;
        if (!solidAt(fy) && !solidAt(hy)) break;
        b.y = fy + 1;
        b.vy = 0;
      }
      b.height = this.sneaking ? 1.5 : PLAYER_HEIGHT;
      stepPlayer(this.world, b, moveInput, this.eyeHeight);
      if (this.flying && b.onGround && gm === 'creative') this.flying = false;
    }
    // Footsteps & water sounds
    const moved = Math.hypot(b.x - this.prev.x, b.z - this.prev.z);
    if (b.onGround && moved > 0.01 && !this.sneaking) {
      this.stepDist += moved;
      if (this.stepDist > 1.7) {
        this.stepDist = 0;
        const below = this.world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.2), Math.floor(b.z));
        const def = blockOf(below);
        if ((below & 0xff) !== 0) this.hooks.sound(`step_${def.sound}`, b.x, b.y, b.z, 0.35, 0.9 + Math.random() * 0.2);
      }
    }
    if (b.inWater && !this.wasInWater && this.prev.y - b.y > 0.2) this.hooks.sound('splash', b.x, b.y, b.z, 0.6);
    if (b.inWater && moved > 0.05 && Math.random() < 0.08) this.hooks.sound('swim', b.x, b.y, b.z, 0.25);
    this.wasInWater = b.inWater;
    // View bobbing
    const speedH = Math.hypot(b.vx, b.vz);
    this.bobAmount += ((b.onGround && !this.flying ? Math.min(1, speedH * 6) : 0) - this.bobAmount) * 0.3;
    this.bob += speedH * 3.2;

    if (!uiOpen) this.tickActions();
    this.sendMove();
  }

  private tickActions() {
    const input = this.input;
    const gm = this.hooks.gamemode();
    if (this.digCooldown > 0) this.digCooldown--;
    if (this.useCooldown > 0) this.useCooldown--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    const left = input.buttons.has(0);
    const right = input.buttons.has(2);
    const held = this.hooks.heldItem();
    const heldDef = held ? itemDef(held.id) : null;

    // --- Attack / dig ---
    if (left) {
      if (this.targetEntity !== null && !this.digging) {
        if (this.attackCooldown <= 0) {
          this.hooks.send({ t: 'attack', id: this.targetEntity });
          this.swing();
          this.attackCooldown = 8;
        }
      } else if (this.target && gm !== 'spectator') {
        const t = this.target;
        if (!this.digging || this.digging.x !== t.x || this.digging.y !== t.y || this.digging.z !== t.z) {
          if (this.digging) this.hooks.send({ t: 'dig', a: 'stop', x: this.digging.x, y: this.digging.y, z: this.digging.z, face: 0 });
          if (this.digCooldown <= 0) {
            const need = breakTicks(t.state, held, { creative: gm === 'creative', inWater: this.body.eyesInWater, onGround: this.body.onGround || this.flying });
            if (heldDef?.tool?.type === 'sword' && gm === 'creative') {
              // swords can't break blocks in creative
            } else if (need === 0) {
              this.hooks.send({ t: 'dig', a: 'start', x: t.x, y: t.y, z: t.z, face: t.face });
              this.hooks.send({ t: 'dig', a: 'done', x: t.x, y: t.y, z: t.z, face: t.face });
              this.hooks.onBreakBlock(t.x, t.y, t.z, t.state);
              this.digCooldown = gm === 'creative' ? 5 : 0;
              this.swing();
            } else if (isFinite(need)) {
              this.digging = { x: t.x, y: t.y, z: t.z, progress: 0, need, face: t.face };
              this.hooks.send({ t: 'dig', a: 'start', x: t.x, y: t.y, z: t.z, face: t.face });
            }
          }
        } else {
          const d = this.digging;
          const state = this.world.getBlock(d.x, d.y, d.z);
          d.need = breakTicks(state, held, { creative: gm === 'creative', inWater: this.body.eyesInWater, onGround: this.body.onGround || this.flying });
          d.progress++;
          if (d.progress % 4 === 0) {
            this.hooks.sound(`dig_${blockOf(state).sound}`, d.x + 0.5, d.y + 0.5, d.z + 0.5, 0.3, 0.6 + Math.random() * 0.2);
          }
          if (d.progress % 5 === 0) this.swing();
          if (d.progress >= d.need) {
            this.hooks.send({ t: 'dig', a: 'done', x: d.x, y: d.y, z: d.z, face: d.face });
            this.hooks.onBreakBlock(d.x, d.y, d.z, state);
            this.digging = null;
            this.digCooldown = 5;
          }
        }
      } else if (this.digging) {
        this.cancelDig();
      }
      if (input.clicked.has(0) && !this.target && this.targetEntity === null) this.swing();
    } else if (this.digging) {
      this.cancelDig();
    }

    // --- Use / place / eat ---
    if (right && this.useCooldown <= 0 && gm !== 'spectator') {
      const food = heldDef?.food && (this.hooks.foodLevel() < 20 || gm === 'creative' || heldDef.name === 'golden_apple');
      if (this.targetEntity !== null && input.clicked.has(2)) {
        this.hooks.send({ t: 'interact', id: this.targetEntity });
        this.swing();
        this.useCooldown = 4;
      } else if (this.target && !(food && !this.isInteractive(this.target.state))) {
        const t = this.target;
        const hit = this.hitPoint();
        const isFluidItem = heldDef?.name === 'bucket';
        const tgt = isFluidItem ? this.fluidTarget() ?? t : t;
        this.hooks.send({ t: 'useBlock', x: tgt.x, y: tgt.y, z: tgt.z, face: tgt.face, hx: hit.x - tgt.x, hy: hit.y - tgt.y, hz: hit.z - tgt.z, sneak: this.sneaking });
        if (heldDef?.block && !this.isInteractive(t.state)) this.hooks.predictPlace(t.x, t.y, t.z, t.face);
        this.swing();
        this.useCooldown = 4;
      } else if (food) {
        this.eating++;
        if (this.eating % 4 === 0) this.hooks.sound('eat', this.body.x, this.body.y + 1.5, this.body.z, 0.5, 0.9 + Math.random() * 0.2);
        if (this.eating >= 32) {
          this.hooks.send({ t: 'eat' });
          this.eating = 0;
          this.useCooldown = 4;
        }
      } else if (heldDef?.name === 'bucket' && this.fluidTarget()) {
        const f = this.fluidTarget()!;
        this.hooks.send({ t: 'useBlock', x: f.x, y: f.y, z: f.z, face: f.face, hx: 0.5, hy: 0.5, hz: 0.5, sneak: false });
        this.useCooldown = 5;
      } else if (input.clicked.has(2) && heldDef && ['snowball', 'egg', 'bow'].includes(heldDef.name)) {
        this.hooks.send({ t: 'useItem' });
        this.swing();
        this.useCooldown = heldDef.name === 'bow' ? 15 : 4;
      }
    }
    if (!right) this.eating = 0;
  }

  private isInteractive(state: number) {
    return BLOCKS[state & 0xff].interactive && !this.sneaking;
  }

  private fluidTarget(): RayHit | null {
    const eye = this.eyePos();
    const d = this.lookDir();
    const hit = raycast(this.world, eye.x, eye.y, eye.z, d.x, d.y, d.z, REACH_DISTANCE, true);
    if (hit && BLOCKS[hit.state & 0xff].fluid) return hit;
    return null;
  }

  cancelDig() {
    if (!this.digging) return;
    this.hooks.send({ t: 'dig', a: 'stop', x: this.digging.x, y: this.digging.y, z: this.digging.z, face: 0 });
    this.digging = null;
  }

  swing() {
    if (this.swingTime <= 0.5) this.swingTime = 1;
    this.hooks.onSwing();
  }

  eyePos(): THREE.Vector3 {
    return new THREE.Vector3(this.body.x, this.body.y + this.eyeHeight, this.body.z);
  }

  private hitPoint(): THREE.Vector3 {
    const eye = this.eyePos();
    const d = this.lookDir();
    return eye.addScaledVector(d, this.target ? this.target.dist : 0);
  }

  private updateTarget() {
    if (this.hooks.gamemode() === 'spectator') {
      this.target = null;
      this.targetEntity = null;
      return;
    }
    const eye = this.eyePos();
    const d = this.lookDir();
    const reach = this.hooks.gamemode() === 'creative' ? REACH_DISTANCE + 0.5 : REACH_DISTANCE;
    const hit = raycast(this.world, eye.x, eye.y, eye.z, d.x, d.y, d.z, reach);
    let best = hit ? hit.dist : reach;
    let ent: number | null = null;
    for (const e of this.hooks.entities()) {
      const t = rayAABB(eye.x, eye.y, eye.z, d.x, d.y, d.z, e.box);
      if (t >= 0 && t < best && t < 3.5) {
        best = t;
        ent = e.id;
      }
    }
    this.targetEntity = ent;
    this.target = ent === null ? hit : null;
  }

  private sendMove() {
    const b = this.body;
    const s = this.lastSent;
    this.sentTicks++;
    const changed = Math.abs(s.x - b.x) > 1e-4 || Math.abs(s.y - b.y) > 1e-4 || Math.abs(s.z - b.z) > 1e-4 || Math.abs(s.yaw - this.yaw) > 1e-3 || Math.abs(s.pitch - this.pitch) > 1e-3 ||
      s.onGround !== b.onGround || s.sneak !== this.sneaking || s.sprint !== this.sprinting || s.flying !== this.flying;
    if (!changed && this.sentTicks < 20) return;
    this.sentTicks = 0;
    s.x = b.x; s.y = b.y; s.z = b.z; s.yaw = this.yaw; s.pitch = this.pitch; s.onGround = b.onGround; s.sneak = this.sneaking; s.sprint = this.sprinting; s.flying = this.flying;
    this.hooks.send({ t: 'move', x: b.x, y: b.y, z: b.z, yaw: this.yaw, pitch: this.pitch, onGround: b.onGround, sneak: this.sneaking, sprint: this.sprinting, flying: this.flying });
  }

  /** Placement position for a predicted block given target + face. */
  static placePos(world: World, x: number, y: number, z: number, face: number): [number, number, number] {
    const t = blockOf(world.getBlock(x, y, z));
    if (t.replaceable) return [x, y, z];
    return [x + FACE_DIRS[face][0], y + FACE_DIRS[face][1], z + FACE_DIRS[face][2]];
  }

  envUpdate() {
    updateEnvironment(this.world, this.body, this.eyeHeight);
  }
}
