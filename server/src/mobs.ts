import { Entity, ArrowEntity } from './entity';
import { EntityKind, EntityState } from '../../shared/src/protocol';
import { stepEntity } from '../../shared/src/physics';
import { findPath, PathNode } from '../../shared/src/pathfinding';
import { B, BLOCKS } from '../../shared/src/blocks';
import { itemId, ItemStack } from '../../shared/src/items';
import { WOOL_COLORS } from '../../shared/src/blocks';
import type { Game } from './game';
import type { Player } from './player';

export type MobKind = 'pig' | 'cow' | 'sheep' | 'chicken' | 'zombie' | 'skeleton' | 'creeper' | 'spider';

interface MobSpec {
  width: number;
  height: number;
  health: number;
  speed: number;
  hostile: boolean;
  drops: Array<[string, number, number]>;
  cookedDrops?: Record<string, string>;
  sound: string;
}

export const MOB_SPECS: Record<MobKind, MobSpec> = {
  pig: { width: 0.9, height: 0.9, health: 10, speed: 0.1, hostile: false, drops: [['porkchop', 1, 3]], cookedDrops: { porkchop: 'cooked_porkchop' }, sound: 'pig' },
  cow: { width: 0.9, height: 1.4, health: 10, speed: 0.09, hostile: false, drops: [['beef', 1, 3], ['leather', 0, 2]], cookedDrops: { beef: 'cooked_beef' }, sound: 'cow' },
  sheep: { width: 0.9, height: 1.3, health: 8, speed: 0.1, hostile: false, drops: [['mutton', 1, 2]], cookedDrops: { mutton: 'cooked_mutton' }, sound: 'sheep' },
  chicken: { width: 0.4, height: 0.7, health: 4, speed: 0.1, hostile: false, drops: [['feather', 0, 2], ['chicken', 1, 1]], cookedDrops: { chicken: 'cooked_chicken' }, sound: 'chicken' },
  zombie: { width: 0.6, height: 1.95, health: 20, speed: 0.115, hostile: true, drops: [['rotten_flesh', 0, 2]], sound: 'zombie' },
  skeleton: { width: 0.6, height: 1.99, health: 20, speed: 0.12, hostile: true, drops: [['bone', 0, 2], ['arrow', 0, 2]], sound: 'skeleton' },
  creeper: { width: 0.6, height: 1.7, health: 20, speed: 0.1, hostile: true, drops: [['gunpowder', 0, 2]], sound: 'creeper' },
  spider: { width: 1.4, height: 0.9, health: 16, speed: 0.14, hostile: true, drops: [['string', 0, 2]], sound: 'spider' },
};

export class Mob extends Entity {
  readonly kind: EntityKind;
  readonly spec: MobSpec;
  target: Player | null = null;
  wanderTarget: { x: number; z: number } | null = null;
  panic = 0;
  attackCooldown = 0;
  idleTimer = 0;
  stuckTicks = 0;
  sideStep = 0;
  lastPos = { x: 0, z: 0 };
  /** sheep: wool colour index (0 = white), bit 16 = sheared */
  variant = 0;
  fuse = -1;
  headYaw = 0;
  persistent = false;
  followItem: number | null = null;
  /** Cached A* path towards the current target (melee mobs). */
  private path: PathNode[] | null = null;
  private pathIdx = 0;

  constructor(game: Game, public mobKind: MobKind, x: number, y: number, z: number) {
    const spec = MOB_SPECS[mobKind];
    super(game, x, y, z, spec.width, spec.height);
    this.kind = mobKind;
    this.spec = spec;
    this.health = this.maxHealth = spec.health;
    this.yaw = Math.random() * Math.PI * 2;
    if (mobKind === 'sheep') {
      const r = Math.random();
      this.variant = r < 0.82 ? 0 : r < 0.87 ? 15 : r < 0.92 ? 7 : r < 0.97 ? 8 : r < 0.99 ? 12 : 6; // white, black, gray, light gray, brown, pink
    }
    if (mobKind === 'cow' || mobKind === 'sheep' || mobKind === 'pig') this.followItem = itemId('wheat');
    if (mobKind === 'chicken') this.followItem = itemId('wheat_seeds');
  }

  state(): EntityState {
    return { ...super.state(), variant: this.variant, health: this.health };
  }

  get hostile() {
    return this.spec.hostile;
  }

  tick() {
    this.age++;
    const b = this.body;
    this.environmentTick();
    if (this.removed) return;
    if (this.attackCooldown > 0) this.attackCooldown--;

    // Burn undead in sunlight
    if ((this.kind === 'zombie' || this.kind === 'skeleton') && this.game.isDay() && this.age % 20 === 0) {
      const bx = Math.floor(this.x), by = Math.floor(this.y + b.height), bz = Math.floor(this.z);
      if (this.game.world.getSkyLight(bx, by, bz) >= 15 && !b.inWater) this.fire = Math.max(this.fire, 100);
    }

    let desiredX = 0, desiredZ = 0, speed = this.spec.speed, wantJump = false;

    if (this.hostile) {
      if (!this.target || this.target.removed || this.target.dead || this.target.gamemode !== 'survival' || this.distanceTo(this.target) > 40) {
        this.target = null;
        if (this.age % 10 === 0) {
          const sense = this.kind === 'spider' && this.game.isDay() ? 0 : 20;
          this.target = this.game.nearestPlayer(this.x, this.y, this.z, sense, (p) => p.gamemode === 'survival' && !p.dead);
        }
      }
    }

    const t = this.target;
    if (t) {
      const dx = t.x - this.x, dz = t.z - this.z;
      const dist = Math.hypot(dx, dz);
      const dist3 = this.distanceTo(t);
      this.yaw = Math.atan2(-dx, -dz);
      if (this.kind === 'skeleton') {
        if (dist > 12) { desiredX = dx / dist; desiredZ = dz / dist; }
        else if (dist < 6) { desiredX = -dx / dist; desiredZ = -dz / dist; }
        if (this.attackCooldown <= 0 && dist3 < 16 && this.game.canSee(this, t)) {
          this.shootArrow(t);
          this.attackCooldown = 40 + Math.floor(Math.random() * 20);
        }
      } else if (this.kind === 'creeper') {
        if (dist3 < 3 && this.game.canSee(this, t)) {
          if (this.fuse < 0) {
            this.fuse = 30;
            this.game.playSound('creeper_hiss', this.x, this.y, this.z);
            this.game.broadcastNear(this, { t: 'meta', id: this.id, e: { variant: 1 } });
          }
        } else if (this.fuse >= 0 && dist3 > 7) {
          this.fuse = -1;
          this.game.broadcastNear(this, { t: 'meta', id: this.id, e: { variant: 0 } });
        }
        if (this.fuse < 0 && dist > 1) { desiredX = dx / dist; desiredZ = dz / dist; }
      } else {
        if (dist > 0.8) { desiredX = dx / dist; desiredZ = dz / dist; }
        // Path around obstacles when the target isn't directly reachable (budgeted per tick)
        if (dist > 2.5 && (this.age + this.id) % 30 === 0 && this.game.mobPathBudget > 0) {
          this.game.mobPathBudget--;
          this.path = findPath(this.game.world, { x: this.x, y: this.y + 0.01, z: this.z }, { x: t.x, y: t.y, z: t.z }, 1.5, 400);
          this.pathIdx = 1;
        }
        if (this.path && dist > 2.5) {
          while (this.pathIdx < this.path.length) {
            const wp = this.path[this.pathIdx];
            if (Math.hypot(wp.x + 0.5 - this.x, wp.z + 0.5 - this.z) < 0.5) this.pathIdx++;
            else break;
          }
          const wp = this.path[this.pathIdx];
          if (wp) {
            const wx = wp.x + 0.5 - this.x, wz = wp.z + 0.5 - this.z, wd = Math.hypot(wx, wz) || 1;
            desiredX = wx / wd;
            desiredZ = wz / wd;
            this.yaw = Math.atan2(-wx, -wz);
            if (wp.y > Math.floor(this.y + 0.01) && b.onGround) wantJump = true;
          }
        } else if (dist <= 2.5) this.path = null;
        const reach = this.kind === 'spider' ? 1.8 : 1.6;
        if (dist3 < reach + b.width / 2 && this.attackCooldown <= 0 && Math.abs(t.y - this.y) < 2) {
          this.attackCooldown = 20;
          this.game.broadcastNear(this, { t: 'anim', id: this.id, a: 'swing' });
          t.damage(this.kind === 'zombie' ? 3 : 2, this, 'mob');
        }
      }
      if (this.kind === 'spider' && b.horizontalCollision) b.vy = 0.2;
    } else if (this.panic > 0) {
      this.panic--;
      speed *= 2;
      if (!this.wanderTarget || this.age % 20 === 0) this.wanderTarget = { x: this.x + (Math.random() - 0.5) * 16, z: this.z + (Math.random() - 0.5) * 16 };
    } else {
      // Follow players holding food
      if (this.followItem !== null && this.age % 5 === 0) {
        const p = this.game.nearestPlayer(this.x, this.y, this.z, 8, (pl) => pl.heldItem()?.id === this.followItem);
        if (p) this.wanderTarget = { x: p.x, z: p.z };
      }
      if (!this.wanderTarget && Math.random() < 0.008) {
        this.wanderTarget = { x: this.x + (Math.random() - 0.5) * 14, z: this.z + (Math.random() - 0.5) * 14 };
      }
      // Sheep eat grass to regrow wool
      if (this.kind === 'sheep' && this.variant & 16 && Math.random() < 0.002) {
        const bx = Math.floor(this.x), by = Math.floor(this.y) - 1, bz = Math.floor(this.z);
        if ((this.game.world.getBlock(bx, by, bz) & 0xff) === B.grass) {
          this.game.world.set(bx, by, bz, B.dirt);
          this.variant &= ~16;
          this.game.broadcastNear(this, { t: 'meta', id: this.id, e: { variant: this.variant } });
        }
      }
      if (this.kind === 'chicken' && Math.random() < 1 / 6000) this.game.dropItem(this.x, this.y + 0.3, this.z, { id: itemId('egg'), count: 1 });
    }

    if (!t && this.wanderTarget) {
      const dx = this.wanderTarget.x - this.x, dz = this.wanderTarget.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.7) this.wanderTarget = null;
      else {
        desiredX = dx / d;
        desiredZ = dz / d;
        this.yaw = Math.atan2(-dx, -dz);
      }
    }

    // Avoid walking off cliffs when not chasing
    if ((desiredX || desiredZ) && !t && b.onGround) {
      const ax = Math.floor(this.x + desiredX * 0.8), az = Math.floor(this.z + desiredZ * 0.8);
      let drop = 0;
      for (let y = Math.floor(this.y) - 1; y > this.y - 5; y--) {
        const s = this.game.world.getBlock(ax, y, az);
        if (BLOCKS[s & 0xff].solid || BLOCKS[s & 0xff].fluid) break;
        drop++;
      }
      const ahead = this.game.world.getBlock(ax, Math.floor(this.y), az) & 0xff;
      if (drop >= 3 || ahead === B.lava || ahead === B.cactus) {
        desiredX = desiredZ = 0;
        this.wanderTarget = null;
      }
    }

    // Stuck detection -> side step
    if (desiredX || desiredZ) {
      if (this.age % 20 === 0) {
        const moved = Math.hypot(this.x - this.lastPos.x, this.z - this.lastPos.z);
        this.lastPos = { x: this.x, z: this.z };
        if (moved < 0.3) this.stuckTicks++;
        else this.stuckTicks = 0;
        if (this.stuckTicks > 2) {
          this.sideStep = 20;
          this.stuckTicks = 0;
          if (!t) this.wanderTarget = null;
        }
      }
      if (this.sideStep > 0) {
        this.sideStep--;
        const sx = -desiredZ, sz = desiredX;
        desiredX = desiredX * 0.3 + sx;
        desiredZ = desiredZ * 0.3 + sz;
      }
      if (b.horizontalCollision && b.onGround) wantJump = true;
    }

    const control = b.onGround ? 0.4 : b.inWater ? 0.2 : 0.05;
    b.vx += (desiredX * speed - b.vx) * control;
    b.vz += (desiredZ * speed - b.vz) * control;
    if (wantJump) b.vy = 0.42;
    if (b.inWater || b.inLava) {
      if (b.vy < 0.1) b.vy += 0.09; // swim up
    }
    if (this.kind === 'chicken' && !b.onGround && b.vy < -0.05) b.vy *= 0.6;
    stepEntity(this.game.world, b, 0.08, 0.98, 1);
    if (b.onGround && b.fallDistance > 3.5 && this.kind !== 'chicken') {
      this.damage(Math.ceil(b.fallDistance - 3), null, 'fall');
    }
    if (b.onGround) b.fallDistance = 0;

    // Creeper fuse
    if (this.fuse >= 0) {
      this.fuse--;
      if (this.fuse <= 0) {
        this.remove();
        this.game.explode(this.x, this.y + 0.8, this.z, 3, this);
        return;
      }
    }

    // Idle sounds
    if (Math.random() < 0.002) this.game.playSound(this.spec.sound, this.x, this.y + 0.5, this.z);

    // Despawn hostile mobs far from players
    if (!this.persistent && this.hostile && this.age % 40 === 0) {
      const near = this.game.nearestPlayer(this.x, this.y, this.z, 96);
      if (!near) this.remove();
    }
  }

  private shootArrow(t: Player) {
    const sx = this.x, sy = this.y + 1.5, sz = this.z;
    const dx = t.x - sx, dy = t.y + 1.2 - sy, dz = t.z - sz;
    const dh = Math.hypot(dx, dz);
    if (dh < 0.01) return; // target straight above/below: direction undefined
    const speed = 1.6;
    const vy = dy / dh * speed + dh * 0.012;
    const len = Math.hypot(dx, dz);
    const inacc = 0.08;
    const arrow = new ArrowEntity(this.game, sx, sy, sz, (dx / len) * speed + (Math.random() - 0.5) * inacc, vy, (dz / len) * speed + (Math.random() - 0.5) * inacc, this, 3);
    this.game.addEntity(arrow);
    this.game.playSound('bow', sx, sy, sz);
    this.game.broadcastNear(this, { t: 'anim', id: this.id, a: 'swing' });
  }

  damage(amount: number, source: Entity | null, cause = 'generic'): boolean {
    const ok = super.damage(amount, source, cause);
    if (ok) {
      this.game.playSound(`${this.spec.sound}_hurt`, this.x, this.y + 0.5, this.z);
      if (!this.hostile) this.panic = 100;
      else if (source && (source as Player).kind === 'player') this.target = source as Player;
    }
    return ok;
  }

  die(killer: Entity | null) {
    super.die(killer);
    this.game.broadcastNear(this, { t: 'anim', id: this.id, a: 'death' });
    this.game.playSound(`${this.spec.sound}_death`, this.x, this.y + 0.5, this.z);
    const drops: ItemStack[] = [];
    for (const [name, min, max] of this.spec.drops) {
      const n = min + Math.floor(Math.random() * (max - min + 1));
      if (n <= 0) continue;
      const cooked = this.fire > 0 && this.spec.cookedDrops?.[name];
      drops.push({ id: itemId(cooked || name), count: n });
    }
    if (this.kind === 'sheep' && !(this.variant & 16)) {
      const color = this.variant & 15;
      drops.push({ id: itemId(color === 0 ? 'white_wool' : `${WOOL_COLORS[color - 1][0]}_wool`), count: 1 });
    }
    for (const d of drops) this.game.dropItem(this.x, this.y + 0.3, this.z, d);
    this.game.onMobKilled(this, killer);
  }

  /** Right click interactions: shearing sheep, etc. Returns true if handled. */
  interact(p: Player): boolean {
    const held = p.heldItem();
    if (this.kind === 'sheep' && held && held.id === itemId('shears') && !(this.variant & 16)) {
      const color = this.variant & 15;
      const wool = itemId(color === 0 ? 'white_wool' : `${WOOL_COLORS[color - 1][0]}_wool`);
      this.game.dropItem(this.x, this.y + 0.8, this.z, { id: wool, count: 1 + Math.floor(Math.random() * 3) });
      this.variant |= 16;
      p.damageHeldItem(1);
      this.game.broadcastNear(this, { t: 'meta', id: this.id, e: { variant: this.variant } });
      this.game.playSound('shear', this.x, this.y, this.z);
      return true;
    }
    return false;
  }
}
