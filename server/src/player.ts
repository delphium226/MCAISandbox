import { Entity, ItemEntity, spawnXp } from './entity';
import { C2S, EntityState, S2C } from '../../shared/src/protocol';
import { GameMode, MAX_FOOD, MAX_HEALTH, PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_SNEAK_EYE, REACH_DISTANCE, FACE_DIRS } from '../../shared/src/constants';
import { ItemStack, itemDef, ITEMS, sameItem, stackSizeOf, itemId, ITEMS_BY_NAME } from '../../shared/src/items';
import { addToSlots } from '../../shared/src/inventory';
import { B, BLOCKS, blockOf, makeState, isLog, isDirectional, BLOCKS_BY_NAME } from '../../shared/src/blocks';
import { breakTicks, blockDrops } from '../../shared/src/mining';
import { updateEnvironment, blockBoxes } from '../../shared/src/physics';
import { OpenWindow, playerWindow, craftingTableWindow, furnaceWindow, chestWindow } from './containers';
import { numKey } from '../../shared/src/world';
import type { Game } from './game';
import { Mob } from './mobs';

export interface Connection {
  send(msg: S2C): void;
  sendBinary(data: Uint8Array): void;
  close(reason?: string): void;
  readonly isAgent: boolean;
  bufferedAmount?(): number;
}

export interface PlayerData {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  food: number;
  saturation: number;
  inventory: (ItemStack | null)[];
  armor: (ItemStack | null)[];
  selected: number;
  gamemode: GameMode;
  spawn?: [number, number, number];
  xp?: number;
}

export class Player extends Entity {
  readonly kind = 'player' as const;
  inventory: (ItemStack | null)[] = new Array(36).fill(null);
  armor: (ItemStack | null)[] = [null, null, null, null];
  craftGrid: (ItemStack | null)[] = [null, null, null, null];
  selected = 0;
  gamemode: GameMode = 'survival';
  food = MAX_FOOD;
  saturation = 5;
  exhaustion = 0;
  air = 300;
  dead = false;
  sneaking = false;
  sprinting = false;
  flying = false;
  skin = 0;
  viewDistance = 8;
  sentChunks = new Set<number>();
  pendingChunks = new Set<number>();
  tracked = new Set<number>();
  playerWin: OpenWindow;
  openWin: OpenWindow | null = null;
  private nextWindowId = 1;
  digging: { x: number; y: number; z: number; start: number; stage: number } | null = null;
  private regenTimer = 0;
  private starveTimer = 0;
  private lastMoveY = 0;
  private lastOnGround = true;
  private lastPos = { x: 0, z: 0 };
  spawnPoint: [number, number, number];
  lastChatAt = 0;
  isAgent: boolean;

  constructor(game: Game, public conn: Connection, public name: string, data?: PlayerData) {
    super(game, 0, 0, 0, 0.6, PLAYER_HEIGHT);
    this.isAgent = conn.isAgent;
    this.health = this.maxHealth = MAX_HEALTH;
    const sp = game.spawn;
    this.spawnPoint = [sp.x, sp.y, sp.z];
    if (data) {
      this.body.x = data.x;
      this.body.y = data.y;
      this.body.z = data.z;
      this.yaw = data.yaw;
      this.pitch = data.pitch;
      this.health = data.health;
      this.food = data.food;
      this.saturation = data.saturation;
      data.inventory.forEach((s, i) => (this.inventory[i] = s && ITEMS[s.id] ? s : null));
      data.armor.forEach((s, i) => (this.armor[i] = s));
      this.selected = data.selected;
      this.gamemode = data.gamemode;
      if (data.spawn) this.spawnPoint = data.spawn;
      this.xpTotal = data.xp ?? 0;
      if (this.health <= 0) this.health = MAX_HEALTH;
    } else {
      this.body.x = sp.x;
      this.body.y = sp.y;
      this.body.z = sp.z;
    }
    this.lastMoveY = this.body.y;
    this.playerWin = playerWindow(this);
    this.skin = hashName(name) % 8;
    this.flying = this.gamemode === 'creative' && false;
  }

  save(): PlayerData {
    return {
      name: this.name, x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch,
      health: this.health, food: this.food, saturation: this.saturation,
      inventory: this.inventory, armor: this.armor, selected: this.selected, gamemode: this.gamemode, spawn: this.spawnPoint,
      xp: this.xpTotal,
    };
  }

  get eyeHeight() {
    return this.sneaking ? PLAYER_SNEAK_EYE : PLAYER_EYE_HEIGHT;
  }

  state(): EntityState {
    return {
      ...super.state(),
      name: this.name,
      item: this.heldItem(),
      skin: this.skin,
      sneaking: this.sneaking,
      armor: this.armor.map((a) => (a ? a.id : null)),
      isAgent: this.isAgent,
    };
  }

  send(msg: S2C) {
    this.conn.send(msg);
  }

  heldItem(): ItemStack | null {
    return this.inventory[this.selected];
  }

  // ---- Inventory helpers ------------------------------------------------------------------

  /** Add items to the inventory; returns the remainder that didn't fit. */
  addItem(stack: ItemStack): ItemStack | null {
    const order = [...Array(9).keys(), ...Array.from({ length: 27 }, (_, i) => i + 9)];
    const rem = addToSlots(this.inventory, stack, order);
    this.sendInventory();
    return rem;
  }

  giveOrDrop(stack: ItemStack) {
    const rem = this.addItem(stack);
    if (rem) this.dropStack(rem, false);
  }

  dropStack(stack: ItemStack, thrown = true) {
    const dir = this.lookDir();
    const e = new ItemEntity(this.game, this.x, this.y + this.eyeHeight - 0.3, this.z, stack);
    if (thrown) {
      e.body.vx = dir[0] * 0.3;
      e.body.vy = dir[1] * 0.3 + 0.1;
      e.body.vz = dir[2] * 0.3;
    }
    e.pickupDelay = 40;
    this.game.addEntity(e);
  }

  lookDir(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  damageHeldItem(n: number) {
    if (this.gamemode === 'creative') return;
    const s = this.heldItem();
    if (!s) return;
    const t = itemDef(s.id).tool;
    if (!t) return;
    const dmg = (s.damage ?? 0) + n;
    if (dmg >= t.durability) {
      this.inventory[this.selected] = null;
      this.game.playSound('break_tool', this.x, this.y + 1, this.z);
    } else this.inventory[this.selected] = { ...s, damage: dmg };
    this.sendInventory();
  }

  consumeHeld(n = 1) {
    if (this.gamemode === 'creative') return;
    const s = this.heldItem();
    if (!s) return;
    this.inventory[this.selected] = s.count > n ? { ...s, count: s.count - n } : null;
    this.sendInventory();
  }

  replaceHeld(stack: ItemStack | null) {
    if (this.gamemode === 'creative' && stack && itemDef(stack.id).name === 'bucket') return;
    const s = this.heldItem();
    if (s && s.count > 1 && stack) {
      this.inventory[this.selected] = { ...s, count: s.count - 1 };
      this.giveOrDrop(stack);
    } else this.inventory[this.selected] = stack;
    this.sendInventory();
  }

  onCrafted(stack: ItemStack) {
    this.game.onCrafted(this, stack);
  }

  sendInventory() {
    this.send({ t: 'inv', slots: this.inventory, armor: this.armor, selected: this.selected });
    // Keep the open window in sync too
    this.sendWindow(this.openWin ?? this.playerWin);
  }

  sendWindow(w: OpenWindow) {
    this.send({ t: 'window', id: w.id, kind: w.kind, title: w.title, slots: w.win.snapshot(), cursor: w.win.cursor, props: w.props?.() });
  }

  sendHealth() {
    this.send({ t: 'health', hp: this.health, food: this.food, sat: this.saturation, air: this.air });
  }

  // ---- Windows --------------------------------------------------------------------------------

  openWindow(kind: 'crafting_table' | 'furnace' | 'chest', pos: [number, number, number]) {
    this.closeWindow(false);
    const id = this.nextWindowId++;
    let w: OpenWindow;
    if (kind === 'crafting_table') w = craftingTableWindow(this, id, pos);
    else if (kind === 'furnace') w = furnaceWindow(this, id, pos, this.game.getBlockEntity(pos, 'furnace') as never);
    else w = chestWindow(this, id, pos, this.game.getBlockEntity(pos, 'chest') as never);
    w.win.onChange = () => this.game.containerChanged(pos, this);
    this.openWin = w;
    this.sendWindow(w);
    if (kind === 'chest') this.game.playSound('chest_open', pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5);
  }

  closeWindow(notify = true) {
    const w = this.openWin ?? this.playerWin;
    if (w.win.cursor) {
      this.giveOrDrop(w.win.cursor);
      w.win.cursor = null;
    }
    w.onClose?.();
    if (this.openWin?.kind === 'chest' && this.openWin.pos) {
      const p = this.openWin.pos;
      this.game.playSound('chest_close', p[0] + 0.5, p[1] + 0.5, p[2] + 0.5);
    }
    this.openWin = null;
    if (notify) this.send({ t: 'closeWindow' });
    this.sendInventory();
  }

  // ---- Message handling ---------------------------------------------------------------------

  handle(msg: C2S) {
    if (this.dead && msg.t !== 'respawn' && msg.t !== 'chat' && msg.t !== 'ping') return;
    switch (msg.t) {
      case 'move':
        return this.handleMove(msg);
      case 'dig':
        if (msg.a === 'start') {
          this.digging = { x: msg.x, y: msg.y, z: msg.z, start: this.game.tick, stage: -1 };
          if (this.gamemode === 'creative') {
            this.breakBlock(msg.x, msg.y, msg.z);
            this.digging = null;
          }
        } else if (msg.a === 'stop') {
          if (this.digging) this.game.broadcastNear(this, { t: 'breakAnim', id: this.id, x: msg.x, y: msg.y, z: msg.z, stage: -1 }, this);
          this.digging = null;
        } else if (msg.a === 'done') this.finishDig(msg.x, msg.y, msg.z);
        return;
      case 'useBlock':
        return void this.useOnBlock(msg.x, msg.y, msg.z, msg.face, msg.hx, msg.hy, msg.hz, msg.sneak);
      case 'useItem':
        return void this.useItemInAir();
      case 'eat':
        return void this.eat();
      case 'hotbar':
        if (Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < 9) {
          this.selected = msg.slot;
          this.game.broadcastNear(this, { t: 'meta', id: this.id, e: { item: this.heldItem() } }, this);
        }
        return;
      case 'click': {
        // The player inventory (id 0) is only interactive while no container is open
        const w = this.openWin ? (this.openWin.id === msg.w ? this.openWin : null) : msg.w === 0 ? this.playerWin : null;
        if (!w) return;
        w.win.click(msg.slot, msg.button, msg.shift);
        this.sendWindow(w);
        this.send({ t: 'inv', slots: this.inventory, armor: this.armor, selected: this.selected });
        return;
      }
      case 'drag': {
        // The player inventory (id 0) is only interactive while no container is open
        const w = this.openWin ? (this.openWin.id === msg.w ? this.openWin : null) : msg.w === 0 ? this.playerWin : null;
        if (!w) return;
        w.win.drag(msg.slots, msg.button);
        this.sendWindow(w);
        this.send({ t: 'inv', slots: this.inventory, armor: this.armor, selected: this.selected });
        return;
      }
      case 'creative': {
        if (this.gamemode !== 'creative') return;
        const w = this.openWin ?? this.playerWin;
        if (msg.slot === -1) {
          // set cursor
          w.win.cursor = msg.item ? { ...msg.item } : null;
        } else if (msg.slot === -2) {
          // give to inventory directly (creative pick)
          if (msg.item) this.addItem({ ...msg.item });
        } else if (Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < 36) {
          this.inventory[msg.slot] = msg.item ? { ...msg.item } : null;
        }
        this.sendWindow(w);
        this.send({ t: 'inv', slots: this.inventory, armor: this.armor, selected: this.selected });
        return;
      }
      case 'closeWindow':
        return this.closeWindow(false);
      case 'chat':
        return this.game.handleChat(this, msg.text);
      case 'attack':
        return this.attack(msg.id);
      case 'interact': {
        const e = this.game.entities.get(msg.id);
        if (e instanceof Mob && this.distanceTo(e) < 6) e.interact(this);
        return;
      }
      case 'drop': {
        const s = this.heldItem();
        if (!s) return;
        const n = msg.all ? s.count : 1;
        this.dropStack({ ...s, count: n });
        this.inventory[this.selected] = s.count > n ? { ...s, count: s.count - n } : null;
        this.sendInventory();
        return;
      }
      case 'respawn':
        if (this.dead) this.respawn();
        return;
      case 'swing':
        this.game.broadcastNear(this, { t: 'anim', id: this.id, a: 'swing' }, this);
        return;
      case 'pickBlock': {
        const id = msg.state & 0xff;
        const itemIdToPick = id === B.litFurnace ? B.furnace : id === B.grass ? B.grass : id;
        if (!ITEMS[itemIdToPick] || id === 0) return;
        // Existing slot in hotbar?
        for (let i = 0; i < 9; i++)
          if (this.inventory[i]?.id === itemIdToPick) {
            this.selected = i;
            this.sendInventory();
            return;
          }
        if (this.gamemode === 'creative') {
          const empty = this.inventory.slice(0, 9).findIndex((s) => !s);
          const slot = empty >= 0 ? empty : this.selected;
          this.inventory[slot] = { id: itemIdToPick, count: 1 };
          this.selected = slot;
          this.sendInventory();
        } else {
          const idx = this.inventory.findIndex((s, i) => i >= 9 && s?.id === itemIdToPick);
          if (idx >= 0) {
            const tmp = this.inventory[this.selected];
            this.inventory[this.selected] = this.inventory[idx];
            this.inventory[idx] = tmp;
            this.sendInventory();
          }
        }
        return;
      }
      case 'ping':
        this.send({ t: 'pong', n: msg.n });
        return;
    }
  }

  private handleMove(m: Extract<C2S, { t: 'move' }>) {
    if (!isFinite(m.x) || !isFinite(m.y) || !isFinite(m.z)) return;
    const d = Math.hypot(m.x - this.x, m.y - this.y, m.z - this.z);
    if (d > 20 && this.gamemode !== 'creative' && this.gamemode !== 'spectator') {
      this.send({ t: 'teleport', x: this.x, y: this.y, z: this.z });
      return;
    }
    const dy = m.y - this.y;
    const horiz = Math.hypot(m.x - this.x, m.z - this.z);
    this.body.x = m.x;
    this.body.y = m.y;
    this.body.z = m.z;
    this.yaw = m.yaw;
    this.pitch = m.pitch;
    this.flying = m.flying && this.gamemode !== 'survival';
    if (this.sneaking !== m.sneak) {
      this.sneaking = m.sneak;
      this.game.broadcastNear(this, { t: 'meta', id: this.id, e: { sneaking: m.sneak } }, this);
    }
    this.sprinting = m.sprint;
    if (this.sprinting) this.exhaustion += horiz * 0.1;
    // Fall damage bookkeeping
    updateEnvironment(this.game.world, this.body, this.eyeHeight);
    if (this.flying || this.body.inWater || this.body.onLadder) this.body.fallDistance = 0;
    else if (dy < 0) this.body.fallDistance -= dy;
    if (m.onGround && !this.lastOnGround && dy >= -0.01) {
      // jumped/landed transition handled below
    }
    if (m.onGround) {
      if (this.body.fallDistance > 3 && this.gamemode === 'survival') {
        const dmg = Math.ceil(this.body.fallDistance - 3);
        this.damage(dmg, null, 'fall');
        this.game.playSound(dmg > 4 ? 'fall_big' : 'fall_small', this.x, this.y, this.z);
      }
      this.body.fallDistance = 0;
    }
    if (!m.onGround && this.lastOnGround && dy > 0) this.exhaustion += this.sprinting ? 0.2 : 0.05;
    this.lastOnGround = m.onGround;
    this.body.onGround = m.onGround;
    this.lastMoveY = m.y;
  }

  // ---- Actions (used by both network clients and AI agents) ---------------------------------

  canReach(x: number, y: number, z: number) {
    const ex = this.x, ey = this.y + this.eyeHeight, ez = this.z;
    return Math.hypot(x + 0.5 - ex, y + 0.5 - ey, z + 0.5 - ez) <= REACH_DISTANCE + 1.5;
  }

  requiredBreakTicks(x: number, y: number, z: number) {
    const s = this.game.world.getBlock(x, y, z);
    return breakTicks(s, this.heldItem(), { creative: this.gamemode === 'creative', inWater: this.body.eyesInWater, onGround: this.body.onGround || this.flying });
  }

  private finishDig(x: number, y: number, z: number) {
    const d = this.digging;
    this.digging = null;
    if (!d || d.x !== x || d.y !== y || d.z !== z) {
      // Instant-break blocks (hardness 0) may skip 'start'
      if (this.requiredBreakTicks(x, y, z) > 1) return this.resync(x, y, z, 'no dig in progress');
    } else {
      const need = this.requiredBreakTicks(x, y, z);
      const elapsed = this.game.tick - d.start;
      if (elapsed + 6 < need * 0.7) return this.resync(x, y, z, `too fast (${elapsed}/${need} ticks)`);
    }
    if (!this.breakBlock(x, y, z)) this.resync(x, y, z, 'break refused');
  }

  private resync(x: number, y: number, z: number, reason = '') {
    if (reason && process.env.MC_DEBUG) console.log(`[dig] ${this.name} rejected at ${x},${y},${z}: ${reason}`);
    this.send({ t: 'block', x, y, z, s: this.game.world.getBlock(x, y, z) });
  }

  /** Break a block as this player (drops, tool damage, sounds). */
  breakBlock(x: number, y: number, z: number): boolean {
    const world = this.game.world;
    if (this.gamemode === 'spectator') return false;
    if (!this.canReach(x, y, z) && !this.isAgent) return false;
    const s = world.getBlock(x, y, z);
    const def = blockOf(s);
    if ((s & 0xff) === 0 || def.fluid || (def.hardness < 0 && this.gamemode !== 'creative')) return false;
    this.game.broadcastNear(this, { t: 'breakAnim', id: this.id, x, y, z, stage: -1 }, this);
    this.game.destroyBlock(x, y, z, this.gamemode === 'creative' ? null : this, this.heldItem());
    if (this.gamemode !== 'creative') {
      const tool = this.heldItem();
      if (tool && itemDef(tool.id).tool && def.hardness > 0) this.damageHeldItem(itemDef(tool.id).tool!.type === 'sword' ? 2 : 1);
      this.exhaustion += 0.005;
    }
    return true;
  }

  /** Right-click on a block face. Returns true if something happened. */
  useOnBlock(x: number, y: number, z: number, face: number, hx: number, hy: number, hz: number, sneak: boolean): boolean {
    const world = this.game.world;
    if (!this.canReach(x, y, z) || this.gamemode === 'spectator') return false;
    const target = world.getBlock(x, y, z);
    const tdef = blockOf(target);
    const held = this.heldItem();
    const heldDef = held ? itemDef(held.id) : null;

    // Interactive blocks
    if (tdef.interactive && !(sneak && held)) {
      const id = target & 0xff;
      if (id === B.craftingTable) return this.openWindow('crafting_table', [x, y, z]), true;
      if (id === B.furnace || id === B.litFurnace) return this.openWindow('furnace', [x, y, z]), true;
      if (id === B.chest) return this.openWindow('chest', [x, y, z]), true;
      if (id === B.tnt && heldDef?.name === 'flint_and_steel') {
        this.game.primeTnt(x, y, z);
        this.damageHeldItem(1);
        return true;
      }
      if (id === B.bed) return this.game.trySleep(this, [x, y, z]), true;
      if (id === DOOR) {
        const meta = target >> 8;
        const oy = meta & 8 ? y - 1 : y + 1;
        const other = world.getBlock(x, oy, z);
        world.set(x, y, z, makeState(DOOR, meta ^ 4), false);
        if ((other & 0xff) === DOOR) world.set(x, oy, z, makeState(DOOR, (other >> 8) ^ 4), false);
        this.game.playSound('door', x + 0.5, y + 0.5, z + 0.5);
        return true;
      }
    }
    if (!held || !heldDef) return false;

    // Tools / special items
    const name = heldDef.name;
    const tid = target & 0xff;
    if (heldDef.tool?.type === 'hoe' && (tid === B.grass || tid === B.dirt) && (world.getBlock(x, y + 1, z) & 0xff) === 0) {
      this.game.setBlockBy(this, x, y, z, B.farmland);
      this.game.playSound('step_gravel', x + 0.5, y + 1, z + 0.5);
      this.damageHeldItem(1);
      return true;
    }
    if (heldDef.tool?.type === 'shovel' && tid === B.grass && face !== 3) {
      // path blocks don't exist; skip
    }
    if (name === 'bone_meal') {
      if (tid === B.wheat) {
        this.game.setBlockBy(this, x, y, z, makeState(B.wheat, Math.min(7, (target >> 8) + 2 + Math.floor(Math.random() * 3))));
        this.consumeHeld();
        this.game.particles('heart', x + 0.5, y + 0.5, z + 0.5);
        return true;
      }
      if (tid === B.oakSapling || tid === B.birchSapling || tid === B.spruceSapling) {
        this.game.growTree(x, y, z, tid);
        this.consumeHeld();
        return true;
      }
      if (tid === B.grass) {
        for (let i = 0; i < 20; i++) {
          const gx = x + Math.floor(Math.random() * 7) - 3, gz = z + Math.floor(Math.random() * 7) - 3;
          if ((world.getBlock(gx, y, gz) & 0xff) === B.grass && (world.getBlock(gx, y + 1, gz) & 0xff) === 0)
            this.game.setBlockBy(this, gx, y + 1, gz, Math.random() < 0.85 ? B.shortGrass : Math.random() < 0.5 ? B.dandelion : B.poppy);
        }
        this.consumeHeld();
        return true;
      }
    }
    if (name === 'bucket') {
      // raycast includes fluids on client; client sends the fluid block position
      if ((tid === B.water || tid === B.lava) && (target >> 8) === 0) {
        this.game.setBlockBy(this, x, y, z, 0);
        this.replaceHeld({ id: itemId(tid === B.water ? 'water_bucket' : 'lava_bucket'), count: 1 });
        this.game.playSound('bucket_fill', x + 0.5, y + 0.5, z + 0.5);
        return true;
      }
      return false;
    }
    if (name === 'water_bucket' || name === 'lava_bucket') {
      const [px, py, pz] = tdef.replaceable ? [x, y, z] : [x + FACE_DIRS[face][0], y + FACE_DIRS[face][1], z + FACE_DIRS[face][2]];
      const cur = blockOf(world.getBlock(px, py, pz));
      if (!cur.replaceable) return false;
      this.game.setBlockBy(this, px, py, pz, name === 'water_bucket' ? B.water : B.lava);
      this.replaceHeld({ id: itemId('bucket'), count: 1 });
      this.game.playSound('bucket_empty', px + 0.5, py + 0.5, pz + 0.5);
      return true;
    }
    if (name === 'flint_and_steel') {
      if (tid === B.tnt) {
        this.game.primeTnt(x, y, z);
        this.damageHeldItem(1);
        return true;
      }
      return false;
    }

    // Placing blocks
    const placeName = heldDef.places ?? (heldDef.block ? heldDef.name : null);
    if (!placeName) return false;
    const pdef = BLOCKS_BY_NAME.get(placeName);
    if (!pdef) return false;

    // Slab merging
    if (pdef.shape === 'slab' && tid === pdef.id && pdef.name !== 'bed') {
      const top = (target >> 8) & 1;
      if ((face === 2 && !top) || (face === 3 && top)) {
        const full = pdef.name === 'stone_slab' ? B_SMOOTH : pdef.name === 'oak_slab' ? B.oakPlanks : B.cobblestone;
        this.game.setBlockBy(this, x, y, z, full);
        this.game.playSound(`place_${pdef.sound}`, x + 0.5, y + 0.5, z + 0.5);
        this.consumeHeld();
        return true;
      }
    }

    let px = x, py = y, pz = z;
    if (!tdef.replaceable || tid === pdef.id) {
      px += FACE_DIRS[face][0];
      py += FACE_DIRS[face][1];
      pz += FACE_DIRS[face][2];
    }
    if (py < 0 || py >= 256) return false;
    const existing = world.getBlock(px, py, pz);
    const edef = blockOf(existing);
    if (!edef.replaceable || ((existing & 0xff) === pdef.id && pdef.id !== B.water)) {
      if (!edef.replaceable) return false;
    }
    // Merge into a slab placed at the target position
    let meta = 0;
    const lookYaw = this.yaw;
    if (isLog(pdef.id)) meta = face <= 1 ? 1 : face >= 4 ? 2 : 0;
    else if (isDirectional(pdef.id)) meta = facingFromYaw(lookYaw);
    else if (pdef.shape === 'torch') {
      if (face === 3 && pdef.name !== 'lantern') return false;
      meta = face;
    } else if (pdef.shape === 'ladder') {
      if (face === 2 || face === 3) return false;
      meta = face;
    } else if (pdef.shape === 'stairs') {
      const d = this.lookDir();
      meta = Math.abs(d[0]) > Math.abs(d[2]) ? (d[0] > 0 ? 0 : 2) : d[2] > 0 ? 1 : 3;
      if (face === 3 || (face !== 2 && hy > 0.5)) meta |= 4;
    } else if (pdef.shape === 'slab') {
      meta = face === 3 || (face !== 2 && hy > 0.5) ? 1 : 0;
      if (pdef.name === 'bed') meta = 0;
    } else if (pdef.name.endsWith('leaves')) meta = 4; // player placed: no decay
    if (pdef.id === DOOR) {
      // Two-block tall door: needs solid ground and free space above
      if (!blockOf(world.getBlock(px, py - 1, pz)).solid || !blockOf(world.getBlock(px, py + 1, pz)).replaceable || py + 1 >= 256) return false;
      const d = this.lookDir();
      const facing = Math.abs(d[0]) > Math.abs(d[2]) ? (d[0] > 0 ? 0 : 2) : d[2] > 0 ? 1 : 3;
      world.set(px, py, pz, makeState(DOOR, facing), false);
      world.set(px, py + 1, pz, makeState(DOOR, facing | 8));
      this.game.playSound('place_wood', px + 0.5, py + 0.5, pz + 0.5);
      this.consumeHeld();
      return true;
    }
    const state = makeState(pdef.id, meta);
    if (pdef.needsSupport && !this.game.world.hasSupport(px, py, pz, state)) return false;
    if (pdef.id === B.wheat && (world.getBlock(px, py - 1, pz) & 0xff) !== B.farmland) return false;
    // Entity collision check
    if (pdef.solid) {
      for (const bb of blockBoxes(state)) {
        const box = [bb[0] + px, bb[1] + py, bb[2] + pz, bb[3] + px, bb[4] + py, bb[5] + pz];
        for (const e of this.game.entitiesNear(px + 0.5, py + 0.5, pz + 0.5, 3)) {
          if (e.kind === 'item' || e.kind === 'arrow' || e.removed) continue;
          const a = e.aabb();
          if (a[0] < box[3] && a[3] > box[0] && a[1] < box[4] && a[4] > box[1] && a[2] < box[5] && a[5] > box[2]) return false;
        }
      }
    }
    if (edef.replaceable && (existing & 0xff) !== 0 && !edef.fluid) this.game.dropBlockItems(px, py, pz, existing);
    this.game.setBlockBy(this, px, py, pz, state);
    this.game.playSound(`place_${pdef.sound}`, px + 0.5, py + 0.5, pz + 0.5);
    this.consumeHeld();
    return true;
  }

  useItemInAir() {
    const held = this.heldItem();
    if (!held) return;
    const def = itemDef(held.id);
    if (def.name === 'snowball' || def.name === 'egg') {
      // Thrown items: simple arrow-like projectile with low damage
      this.game.throwProjectile(this, 0);
      this.consumeHeld();
    } else if (def.name === 'bow') {
      const arrows = this.inventory.findIndex((s) => s && itemDef(s.id).name === 'arrow');
      if (arrows < 0 && this.gamemode !== 'creative') return;
      this.game.throwProjectile(this, 6);
      if (this.gamemode !== 'creative' && arrows >= 0) {
        const s = this.inventory[arrows]!;
        this.inventory[arrows] = s.count > 1 ? { ...s, count: s.count - 1 } : null;
      }
      this.damageHeldItem(1);
    }
  }

  eat(): boolean {
    const held = this.heldItem();
    if (!held) return false;
    const def = itemDef(held.id);
    if (!def.food) return false;
    if (this.food >= MAX_FOOD && def.name !== 'golden_apple' && this.gamemode !== 'creative') return false;
    this.food = Math.min(MAX_FOOD, this.food + def.food.hunger);
    this.saturation = Math.min(this.food, this.saturation + def.food.saturation);
    if (def.name === 'golden_apple') this.health = Math.min(this.maxHealth, this.health + 4);
    if (def.name === 'mushroom_stew') this.replaceHeld({ id: itemId('bowl'), count: 1 });
    else this.consumeHeld();
    this.game.playSound('burp', this.x, this.y + 1.5, this.z);
    this.sendHealth();
    return true;
  }

  attack(id: number) {
    const e = this.game.entities.get(id);
    if (!e || e === this || e.removed || this.gamemode === 'spectator') return;
    if (this.distanceTo(e) > 6) return;
    if (e.kind === 'item' || e.kind === 'arrow') return;
    const held = this.heldItem();
    const tool = held ? itemDef(held.id).tool : undefined;
    let dmg = tool && tool.type !== 'none' ? tool.damage : 1;
    const crit = !this.body.onGround && this.body.fallDistance > 0 && !this.body.inWater;
    if (crit) {
      dmg *= 1.5;
      this.game.particles('crit', e.x, e.y + e.body.height * 0.7, e.z);
    }
    if (e instanceof Player && (e.gamemode !== 'survival' || !this.game.pvp)) return;
    if (e.damage(dmg, this, 'player')) {
      if (this.sprinting) {
        const d = this.lookDir();
        e.knockback(d[0], d[2], 0.5);
      }
      this.game.playSound(crit ? 'hit_crit' : 'hit', e.x, e.y + 1, e.z);
      if (tool) this.damageHeldItem(tool.type === 'sword' ? 1 : 2);
    }
    this.exhaustion += 0.1;
  }

  damage(amount: number, source: Entity | null, cause = 'generic'): boolean {
    if (this.dead || this.gamemode !== 'survival') return false;
    // Hits during the invulnerability window are ignored and must not wear armour either
    if (this.removed || this.hurtCooldown > 0 || this.health <= 0) return false;
    // Armor reduces damage (except fall/void/starve/drown)
    let dmg = amount;
    const armored = cause !== 'fall' && cause !== 'void' && cause !== 'starve' && cause !== 'drown';
    const defense = armored ? this.armor.reduce((a, s) => a + (s ? itemDef(s.id).armor?.defense ?? 0 : 0), 0) : 0;
    if (defense > 0) dmg = amount * (1 - Math.min(20, defense) / 25);
    const ok = super.damage(Math.max(0.5, Math.round(dmg * 2) / 2), source, cause);
    if (ok && defense > 0) {
      for (let i = 0; i < 4; i++) {
        const a = this.armor[i];
        if (!a) continue;
        const info = itemDef(a.id).armor;
        if (!info) continue;
        const nd = (a.damage ?? 0) + 1;
        this.armor[i] = nd >= info.durability ? null : { ...a, damage: nd };
      }
      this.sendInventory();
    }
    if (ok) {
      this.exhaustion += 0.1;
      this.lastDamageCause = cause;
      this.lastDamageSource = source;
      this.game.playSound('player_hurt', this.x, this.y + 1, this.z);
      if (source) this.send({ t: 'velocity', vx: this.body.vx, vy: this.body.vy, vz: this.body.vz });
      this.sendHealth();
    }
    return ok;
  }
  lastDamageCause = 'generic';
  /** Total experience points and derived level (Minecraft formulas). */
  xpTotal = 0;
  static xpForLevel(level: number): number {
    if (level < 16) return 2 * level + 7;
    if (level < 31) return 5 * level - 38;
    return 9 * level - 158;
  }
  xpLevel(): { level: number; progress: number } {
    let level = 0, left = this.xpTotal;
    while (left >= Player.xpForLevel(level)) {
      left -= Player.xpForLevel(level);
      level++;
    }
    return { level, progress: left / Player.xpForLevel(level) };
  }
  addXp(n: number) {
    const before = this.xpLevel().level;
    this.xpTotal = Math.max(0, this.xpTotal + n);
    const after = this.xpLevel().level;
    this.game.playSound('pop', this.x, this.y + 1, this.z, 0.2, 1.6 + Math.random() * 0.5);
    if (after > before && after % 5 === 0) this.game.playSound('levelup', this.x, this.y + 1, this.z, 0.75);
    this.sendXp();
  }
  sendXp() {
    const { level, progress } = this.xpLevel();
    this.send({ t: 'xp', level, progress, total: this.xpTotal });
  }
  lastDamageSource: Entity | null = null;

  die(killer: Entity | null) {
    if (this.dead) return;
    this.dead = true;
    // Drop some experience (7 per level, max 100) and lose the rest
    const lvl = this.xpLevel().level;
    if (lvl > 0) spawnXp(this.game, this.x, this.y + 0.5, this.z, Math.min(100, lvl * 7));
    this.xpTotal = 0;
    this.sendXp();
    this.health = 0;
    this.sendHealth();
    this.closeWindow();
    // Drop everything
    for (let i = 0; i < this.inventory.length; i++) {
      const s = this.inventory[i];
      if (s) {
        const e = new ItemEntity(this.game, this.x, this.y + 1, this.z, s);
        e.body.vx = (Math.random() - 0.5) * 0.5;
        e.body.vz = (Math.random() - 0.5) * 0.5;
        this.game.addEntity(e);
      }
      this.inventory[i] = null;
    }
    for (let i = 0; i < 4; i++) {
      const s = this.armor[i];
      if (s) this.game.dropItem(this.x, this.y + 1, this.z, s);
      this.armor[i] = null;
    }
    this.sendInventory();
    const msg = deathMessage(this, killer ?? this.lastDamageSource, this.lastDamageCause);
    this.send({ t: 'death', msg });
    this.game.broadcast({ t: 'chat', text: msg, color: '#ff5555' });
    this.game.broadcastNear(this, { t: 'anim', id: this.id, a: 'death' }, this);
    this.game.onPlayerDied(this);
  }

  respawn() {
    this.dead = false;
    this.health = this.maxHealth;
    this.food = MAX_FOOD;
    this.saturation = 5;
    this.air = 300;
    this.fire = 0;
    this.body.fallDistance = 0;
    // A bed spawn point is only valid while the bed still exists
    const sp = this.game.spawn;
    const [bx, by, bz] = this.spawnPoint.map(Math.floor);
    if ((this.spawnPoint[0] !== sp.x || this.spawnPoint[1] !== sp.y || this.spawnPoint[2] !== sp.z) && this.game.world.isLoaded(bx, bz) && (this.game.world.getBlock(bx, by - 1, bz) & 0xff) !== B.bed) {
      this.spawnPoint = [sp.x, sp.y, sp.z];
      this.send({ t: 'chat', text: 'You have no home bed, or it was obstructed', color: '#aaaaaa' });
    }
    const [x, y, z] = this.spawnPoint;
    this.teleport(x, y, z);
    this.sendHealth();
    this.game.onPlayerRespawn(this);
  }

  teleport(x: number, y: number, z: number, yaw?: number, pitch?: number) {
    this.body.x = x;
    this.body.y = y;
    this.body.z = z;
    this.body.vx = this.body.vy = this.body.vz = 0;
    this.body.fallDistance = 0;
    if (yaw !== undefined) this.yaw = yaw;
    if (pitch !== undefined) this.pitch = pitch;
    this.send({ t: 'teleport', x, y, z, yaw, pitch });
  }

  setGamemode(mode: GameMode) {
    this.gamemode = mode;
    if (mode === 'survival') this.flying = false;
    this.send({ t: 'gamemode', mode });
  }

  // ---- Tick -------------------------------------------------------------------------------------

  tick() {
    this.age++;
    if (this.dead) return;
    updateEnvironment(this.game.world, this.body, this.eyeHeight);
    if (this.gamemode === 'survival') {
      this.environmentTick();
      this.tickHunger();
      this.tickAir();
    } else {
      this.fire = 0;
    }
    this.pickupItems();
    this.tickDigAnimation();
    const moved = Math.hypot(this.x - this.lastPos.x, this.z - this.lastPos.z);
    if (moved > 0.5) {
      this.lastPos = { x: this.x, z: this.z };
    }
  }

  private tickDigAnimation() {
    const d = this.digging;
    if (!d) return;
    const need = this.requiredBreakTicks(d.x, d.y, d.z);
    if (!isFinite(need) || need <= 0) return;
    const stage = Math.min(9, Math.floor(((this.game.tick - d.start) / need) * 10));
    if (stage !== d.stage) {
      d.stage = stage;
      this.game.broadcastNear(this, { t: 'breakAnim', id: this.id, x: d.x, y: d.y, z: d.z, stage }, this);
    }
    if (this.age % 5 === 0) this.game.broadcastNear(this, { t: 'anim', id: this.id, a: 'swing' }, this);
  }

  private tickHunger() {
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.food = Math.max(0, this.food - 1);
      this.sendHealth();
    }
    if (this.food >= 18 && this.health < this.maxHealth) {
      if (++this.regenTimer >= 80) {
        this.regenTimer = 0;
        this.health = Math.min(this.maxHealth, this.health + 1);
        this.exhaustion += 3;
        this.sendHealth();
      }
    } else this.regenTimer = 0;
    if (this.food <= 0) {
      if (++this.starveTimer >= 80) {
        this.starveTimer = 0;
        if (this.health > 1) this.damage(1, null, 'starve');
      }
    }
  }

  private tickAir() {
    const prev = this.air;
    if (this.body.eyesInWater) {
      this.air--;
      if (this.air <= -20) {
        this.air = 0;
        this.damage(2, null, 'drown');
      }
    } else if (this.air < 300) this.air = Math.min(300, this.air + 5);
    if (Math.ceil(prev / 30) !== Math.ceil(this.air / 30)) this.sendHealth();
  }

  private pickupItems() {
    if (this.gamemode === 'spectator') return;
    for (const e of this.game.entitiesNear(this.x, this.y + 0.9, this.z, 2.6)) {
      if (!(e instanceof ItemEntity) || e.removed || e.pickupDelay > 0) continue;
      // Minecraft: player hitbox expanded by 1 horizontally and 0.5 vertically
      if (Math.abs(e.x - this.x) > 1.3 + 0.125 || Math.abs(e.z - this.z) > 1.3 + 0.125) continue;
      if (e.y + 0.25 < this.y - 0.5 || e.y > this.y + this.body.height + 0.5) continue;
      const before = e.stack.count;
      const rem = addToSlots(this.inventory, e.stack, [...Array(9).keys(), ...Array.from({ length: 27 }, (_, i) => i + 9)]);
      if (rem && rem.count === before) continue;
      this.game.onItemPickup(this, e, rem ? { ...e.stack, count: before - rem.count } : e.stack);
      if (rem) {
        e.stack = rem;
        this.game.broadcastNear(e, { t: 'meta', id: e.id, e: { item: rem } });
      } else e.remove();
      this.game.playSound('pop', this.x, this.y + 1, this.z, 0.25, 1 + Math.random() * 0.8);
      this.sendInventory();
    }
  }

  /** Visible chunks this player wants, nearest first. */
  wantedChunks(): number[][] {
    const cx = Math.floor(this.x) >> 4, cz = Math.floor(this.z) >> 4;
    const r = this.viewDistance;
    const out: number[][] = [];
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > (r + 0.5) * (r + 0.5)) continue;
        out.push([cx + dx, cz + dz, d2]);
      }
    out.sort((a, b) => a[2] - b[2]);
    return out;
  }

  isChunkSent(cx: number, cz: number) {
    return this.sentChunks.has(numKey(cx, cz));
  }
}

const B_SMOOTH = BLOCKS_BY_NAME.get('smooth_stone')!.id;
const DOOR = BLOCKS_BY_NAME.get('oak_door')!.id;

function facingFromYaw(yaw: number): number {
  // Face towards the player: player looking -Z (yaw 0) => block front faces +Z (south, face 4)
  const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const q = Math.round(a / (Math.PI / 2)) % 4;
  return [4, 0, 5, 1][q];
}

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

function deathMessage(p: Player, killer: Entity | null, cause: string): string {
  if (killer && killer !== p) {
    const kname = killer instanceof Player ? killer.name : killer.kind[0].toUpperCase() + killer.kind.slice(1);
    if (killer.kind === 'creeper') return `${p.name} was blown up by Creeper`;
    if (killer.kind === 'skeleton') return `${p.name} was shot by Skeleton`;
    return `${p.name} was slain by ${kname}`;
  }
  switch (cause) {
    case 'fall': return `${p.name} hit the ground too hard`;
    case 'lava': return `${p.name} tried to swim in lava`;
    case 'fire': return `${p.name} burned to death`;
    case 'drown': return `${p.name} drowned`;
    case 'starve': return `${p.name} starved to death`;
    case 'void': return `${p.name} fell out of the world`;
    case 'explosion': return `${p.name} blew up`;
    default: return `${p.name} died`;
  }
}

export { sameItem, stackSizeOf, ITEMS_BY_NAME };
