import { Body, makeBody, stepEntity, AABB } from '../../shared/src/physics';
import { EntityKind, EntityState } from '../../shared/src/protocol';
import { ItemStack, sameItem, stackSizeOf } from '../../shared/src/items';
import type { Game } from './game';

export abstract class Entity {
  static nextId = 1;
  readonly id = Entity.nextId++;
  abstract readonly kind: EntityKind;
  body: Body;
  yaw = 0;
  pitch = 0;
  removed = false;
  age = 0;
  health = 20;
  maxHealth = 20;
  /** Ticks of invulnerability after being hurt. */
  hurtCooldown = 0;
  /** Burning ticks remaining */
  fire = 0;
  /** Last broadcast position */
  sent = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN };

  constructor(public game: Game, x: number, y: number, z: number, width: number, height: number) {
    this.body = makeBody(x, y, z, width, height);
  }

  get x() {
    return this.body.x;
  }
  get y() {
    return this.body.y;
  }
  get z() {
    return this.body.z;
  }

  aabb(): AABB {
    const hw = this.body.width / 2;
    return [this.x - hw, this.y, this.z - hw, this.x + hw, this.y + this.body.height, this.z + hw];
  }

  distanceTo(e: { x: number; y: number; z: number }) {
    return Math.hypot(this.x - e.x, this.y - e.y, this.z - e.z);
  }

  abstract tick(): void;

  state(): EntityState {
    return { id: this.id, kind: this.kind, x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch };
  }

  /** Apply damage. Returns true if damage was dealt. */
  damage(amount: number, source: Entity | null, _cause = 'generic'): boolean {
    if (this.removed || this.hurtCooldown > 0 || this.health <= 0) return false;
    this.health -= amount;
    this.hurtCooldown = 10;
    this.game.broadcastNear(this, { t: 'anim', id: this.id, a: 'hurt' });
    if (source) {
      const dx = this.x - source.x, dz = this.z - source.z;
      const d = Math.hypot(dx, dz) || 1;
      this.knockback(dx / d, dz / d, 0.4);
    }
    if (this.health <= 0) this.die(source);
    return true;
  }

  knockback(nx: number, nz: number, strength: number) {
    this.body.vx = this.body.vx / 2 + nx * strength;
    this.body.vz = this.body.vz / 2 + nz * strength;
    if (this.body.onGround) this.body.vy = Math.min(0.4, this.body.vy / 2 + strength);
  }

  die(_killer: Entity | null) {
    this.remove();
  }

  remove() {
    this.removed = true;
  }

  /** Common environmental damage for living entities. */
  environmentTick() {
    if (this.hurtCooldown > 0) this.hurtCooldown--;
    if (this.body.inLava) {
      this.fire = 300;
      this.damage(4, null, 'lava');
    }
    if (this.fire > 0) {
      this.fire--;
      if (this.body.inWater) this.fire = 0;
      else if (this.fire % 20 === 0) this.damage(1, null, 'fire');
    }
    if (this.y < -64) this.damage(4, null, 'void');
  }
}

export class ItemEntity extends Entity {
  readonly kind = 'item' as const;
  pickupDelay = 10;
  constructor(game: Game, x: number, y: number, z: number, public stack: ItemStack) {
    super(game, x, y, z, 0.25, 0.25);
    this.body.stepHeight = 0;
    this.body.vx = (Math.random() - 0.5) * 0.2;
    this.body.vz = (Math.random() - 0.5) * 0.2;
    this.body.vy = 0.2;
  }
  state(): EntityState {
    return { ...super.state(), item: this.stack };
  }
  tick() {
    this.age++;
    if (this.pickupDelay > 0) this.pickupDelay--;
    stepEntity(this.game.world, this.body, 0.04, 0.98, 0.6);
    if (this.body.inLava) return this.remove();
    if (this.age > 6000 || this.y < -64) return this.remove();
    // Merge with nearby identical items every second
    if (this.age % 20 === 0) {
      for (const e of this.game.entitiesNear(this.x, this.y, this.z, 1.5)) {
        if (e === this || !(e instanceof ItemEntity) || e.removed) continue;
        if (sameItem(e.stack, this.stack) && e.stack.count + this.stack.count <= stackSizeOf(this.stack.id)) {
          this.stack = { ...this.stack, count: this.stack.count + e.stack.count };
          e.remove();
          this.game.broadcastNear(this, { t: 'meta', id: this.id, e: { item: this.stack } });
        }
      }
    }
  }
}

export class FallingBlockEntity extends Entity {
  readonly kind = 'falling_block' as const;
  constructor(game: Game, x: number, y: number, z: number, public blockState: number) {
    super(game, x + 0.5, y, z + 0.5, 0.98, 0.98);
    this.body.stepHeight = 0;
  }
  state(): EntityState {
    return { ...super.state(), state: this.blockState };
  }
  tick() {
    this.age++;
    stepEntity(this.game.world, this.body, 0.04, 0.98, 0.6);
    if (this.body.onGround || this.age > 600) {
      const bx = Math.floor(this.x), by = Math.floor(this.y + 0.5), bz = Math.floor(this.z);
      const cur = this.game.world.getBlock(bx, by, bz);
      const def = this.game.blockDef(cur);
      if (def.replaceable) this.game.world.set(bx, by, bz, this.blockState);
      else this.game.dropItem(this.x, this.y, this.z, { id: this.blockState & 0xff, count: 1 });
      this.remove();
    }
  }
}

export class TntEntity extends Entity {
  readonly kind = 'tnt' as const;
  constructor(game: Game, x: number, y: number, z: number, public fuse = 80) {
    super(game, x + 0.5, y, z + 0.5, 0.98, 0.98);
    this.body.vy = 0.2;
    this.body.vx = (Math.random() - 0.5) * 0.04;
    this.body.vz = (Math.random() - 0.5) * 0.04;
  }
  tick() {
    stepEntity(this.game.world, this.body, 0.04, 0.98, 0.6);
    if (--this.fuse <= 0) {
      this.remove();
      this.game.explode(this.x, this.y + 0.5, this.z, 4, this);
    }
  }
}

export class ArrowEntity extends Entity {
  readonly kind = 'arrow' as const;
  stuck = false;
  constructor(game: Game, x: number, y: number, z: number, vx: number, vy: number, vz: number, public shooter: Entity | null, public damageAmount = 4) {
    super(game, x, y, z, 0.3, 0.3);
    this.body.vx = vx;
    this.body.vy = vy;
    this.body.vz = vz;
    this.body.stepHeight = 0;
    this.updateRotation();
  }
  private updateRotation() {
    const b = this.body;
    this.yaw = Math.atan2(-b.vx, -b.vz);
    this.pitch = Math.atan2(b.vy, Math.hypot(b.vx, b.vz));
  }
  tick() {
    this.age++;
    if (this.age > 1200) return this.remove();
    if (this.stuck) return;
    const b = this.body;
    // Entity hit test along the path
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const px = b.x + (b.vx * i) / steps, py = b.y + (b.vy * i) / steps, pz = b.z + (b.vz * i) / steps;
      for (const e of this.game.entitiesNear(px, py, pz, 1.2)) {
        if (e === this || e === this.shooter || e.kind === 'item' || e.kind === 'arrow' || e.removed) continue;
        const bb = e.aabb();
        if (px >= bb[0] - 0.15 && px <= bb[3] + 0.15 && py >= bb[1] && py <= bb[4] && pz >= bb[2] - 0.15 && pz <= bb[5] + 0.15) {
          const speed = Math.hypot(b.vx, b.vy, b.vz);
          e.damage(Math.ceil(this.damageAmount * speed / 2), this.shooter);
          this.remove();
          return;
        }
      }
    }
    const ox = b.x, oy = b.y, oz = b.z;
    stepEntity(this.game.world, b, 0.05, 0.99, 1);
    const moved = Math.hypot(b.x - ox, b.y - oy, b.z - oz);
    if (moved < 0.01 || b.onGround || b.horizontalCollision) {
      this.stuck = true;
      b.vx = b.vy = b.vz = 0;
    } else this.updateRotation();
  }
}
