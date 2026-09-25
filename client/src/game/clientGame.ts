import * as THREE from 'three';
import { World, numKey } from '../../../shared/src/world';
import { S2C, decodeChunkPacket, EntityState } from '../../../shared/src/protocol';
import { GameMode, DAY_LENGTH, PROTOCOL_VERSION, TICKS_PER_SECOND, FACE_DIRS } from '../../../shared/src/constants';
import { ItemStack, itemDef } from '../../../shared/src/items';
import { BLOCKS, blockOf, makeState, isLog, isDirectional, fluidHeight } from '../../../shared/src/blocks';
import { BIOMES } from '../../../shared/src/biomes';
import { selectionBox } from '../../../shared/src/physics';
import { Renderer, U } from '../render/renderer';
import { EntityRenderer, RenderEntity } from '../render/entityRenderer';
import { ItemModels } from '../render/itemModels';
import { Particles } from '../render/particles';
import { Hand } from '../render/hand';
import { Connection } from '../net/connection';
import { Input } from './input';
import { LocalPlayer } from './localPlayer';
import { UI, ClientSettings } from '../ui/ui';
import { IconRenderer } from '../ui/icons';
import { SoundEngine } from '../audio/sound';
import { PlayerPreview } from '../ui/playerPreview';
import { Weather } from '../render/weather';

const CRACK_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelMatrix; uniform mat4 viewMatrix; uniform mat4 projectionMatrix;
in vec3 position; in vec2 uv;
out vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }
`;
const CRACK_FRAG = /* glsl */ `
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray uAtlas; uniform float uLayer;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 t = texture(uAtlas, vec3(vUv.x, 1.0 - vUv.y, uLayer));
  vec3 c = mix(vec3(0.5), t.rgb * 0.5, t.a);
  outColor = vec4(c, 1.0);
}
`;

export class ClientGame {
  world = new World();
  renderer: Renderer;
  entities: EntityRenderer;
  items: ItemModels;
  particles: Particles;
  hand: Hand | null = null;
  conn = new Connection();
  input: Input;
  player: LocalPlayer;
  icons: IconRenderer;
  myId = -1;
  myName = '';
  gamemode: GameMode = 'survival';
  inventory: (ItemStack | null)[] = new Array(36).fill(null);
  armor: (ItemStack | null)[] = [null, null, null, null];
  selected = 0;
  health = 20;
  food = 20;
  air = 300;
  dead = false;
  time = 0;
  timeRate = 1;
  viewDistance = 8;
  seed = 0;
  private lastFrame = performance.now();
  private selection: THREE.LineSegments;
  private crack: THREE.Mesh;
  private crackMat: THREE.RawShaderMaterial;
  private otherCracks = new Map<number, { x: number; y: number; z: number; stage: number; mesh: THREE.Mesh }>();
  perspective = 0; // 0 first person, 1 back, 2 front
  private selfModel: RenderEntity | null = null;
  running = false;
  private loaded = false;
  private recentBreaks: { x: number; y: number; z: number; t: number }[] = [];
  private fps = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private players: { id: number; name: string; agent?: boolean }[] = [];
  private pingSent = 0;
  ping = 0;
  onExit: (reason: string) => void = () => {};
  private spawnPos = new THREE.Vector3();
  private cameraShake = 0;
  private lastHealth = 20;
  private disposed = false;
  private preview: PlayerPreview | null = null;
  weather: Weather;
  xp = { level: 0, progress: 0 };
  private bolts: { mesh: THREE.Mesh; life: number }[] = [];
  private rafId = 0;
  /** Listeners on window/canvas, removed on dispose so a new game after reconnecting doesn't double-fire. */
  private abort = new AbortController();
  /** Highest container window id the client closed; late updates for it must not reopen it. */
  private closedWindowId = 0;
  /** Sequence number of an unacknowledged hotbar change (0 = none). */
  private hotbarSeq = 0;
  private hotbarPending = 0;
  private lastFrameError = 0;
  /** Predicted block placements awaiting the server's confirmation (the server doesn't resync refused placements). */
  private pendingPlaces = new Map<string, { x: number; y: number; z: number; prev: number; state: number; t: number }>();

  constructor(private canvas: HTMLCanvasElement, public ui: UI, public settings: ClientSettings, public sound: SoundEngine) {
    ui.resetSession();
    this.renderer = new Renderer(canvas, this.world, settings);
    this.items = new ItemModels(this.renderer.atlas);
    this.icons = new IconRenderer(this.renderer.atlas, this.items);
    ui.icons = this.icons;
    this.entities = new EntityRenderer(this.renderer.entityScene, this.world, this.items);
    this.particles = new Particles(this.world, this.renderer.atlas);
    this.renderer.entityScene.add(this.particles.mesh);
    this.weather = new Weather(this.world);
    this.renderer.entityScene.add(this.weather.mesh);
    this.input = new Input(canvas);
    this.input.sensitivity = 0.0022 * settings.sensitivity;
    this.player = new LocalPlayer(this.world, this.input, {
      send: (m) => this.conn.send(m),
      entities: () => this.entities.pickable().filter((e) => e.id !== -999),
      heldItem: () => this.inventory[this.selected],
      sound: (n, x, y, z, v, p) => this.sound.play(n, { x, y, z, volume: v, pitch: p }),
      onBreakBlock: (x, y, z, s) => this.predictBreak(x, y, z, s),
      onSwing: () => this.conn.send({ t: 'swing' }),
      gamemode: () => this.gamemode,
      foodLevel: () => this.food,
      predictPlace: (x, y, z, face) => this.predictPlace(x, y, z, face),
    });

    // Selection outline
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.selection = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthTest: true }));
    this.selection.visible = false;
    this.renderer.entityScene.add(this.selection);
    this.crackMat = new THREE.RawShaderMaterial({
      vertexShader: CRACK_VERT,
      fragmentShader: CRACK_FRAG,
      glslVersion: THREE.GLSL3,
      uniforms: { uAtlas: U.uAtlas, uLayer: { value: 0 } },
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.SrcColorFactor,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.crackMat);
    this.crack.visible = false;
    this.renderer.entityScene.add(this.crack);

    this.conn.onMessage = (m) => this.handle(m);
    this.conn.onChunk = (buf) => {
      const c = decodeChunkPacket(buf);
      this.world.removeChunk(c.cx, c.cz);
      this.world.addChunk(c);
      this.renderer.chunks.markAround(c.cx, c.cz);
    };
    this.conn.onClose = (reason) => {
      if (this.running) this.stop(reason);
    };
    this.input.onLockChange = (locked) => {
      if (!locked && this.running && !this.ui.screenName && !this.ui.chatOpen && !this.dead) this.openPause();
    };
    // The browser refused the lock (no user gesture, or too soon after Esc): show the pause menu instead of
    // leaving the player in a game that ignores the mouse
    this.input.onLockError = () => {
      if (this.running && this.loaded && !this.ui.screenName && !this.ui.chatOpen && !this.dead) this.openPause();
    };
    const opts = { signal: this.abort.signal };
    canvas.addEventListener('click', () => {
      this.sound.unlock();
      if (this.running && !this.ui.screenName && !this.ui.chatOpen && !this.dead) this.input.lock();
    }, opts);
    this.ui.onChatClosed = () => {
      if (this.running && !this.ui.screenName && !this.dead) this.input.lock();
    };
    window.addEventListener('resize', () => this.renderer.resize(window.innerWidth, window.innerHeight), opts);
    window.addEventListener('keydown', (e) => this.onKey(e), opts);
  }

  applySettings(s: ClientSettings) {
    this.settings = s;
    this.renderer.applySettings(s);
    this.input.sensitivity = 0.0022 * s.sensitivity;
    this.sound.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
  }

  async connect(url: string, name: string) {
    this.myName = name;
    await this.conn.connect(url);
    if (this.disposed) return;
    this.conn.send({ t: 'hello', name, version: PROTOCOL_VERSION });
    this.running = true;
    this.loop();
  }

  stop(reason: string) {
    this.running = false;
    this.input.unlock();
    if (this.ui.chatOpen) this.ui.closeChat();
    this.conn.close();
    this.onExit(reason);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.abort.abort();
    this.input.dispose();
    this.conn.onMessage = () => {};
    this.conn.onChunk = () => {};
    this.conn.onClose = () => {};
    this.conn.close();
    this.preview?.dispose();
    this.preview = null;
    this.renderer.chunks.dispose();
    this.renderer.renderer.dispose();
  }

  // ======================================================================================
  // Network
  // ======================================================================================
  private handle(m: S2C) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        this.gamemode = m.gamemode;
        this.ui.gamemode = m.gamemode;
        this.time = m.time;
        this.viewDistance = m.viewDistance;
        this.seed = m.seed;
        this.player.setPosition(m.x, m.y, m.z);
        this.player.yaw = m.yaw;
        this.player.pitch = m.pitch;
        this.player.frozen = true;
        this.spawnPos.set(m.x, m.y, m.z);
        this.hand = new Hand(this.items, hashName(m.name) % 8);
        this.preview = new PlayerPreview(this.world, this.items, hashName(m.name) % 8);
        this.ui.onPlayerPreview = (el) => this.preview?.attach(el, this.inventory[this.selected]);
        this.player.flying = m.gamemode === 'spectator';
        this.renderer.handScene.add(this.hand.root);
        this.selfModel = new RenderEntity({ id: -1, kind: 'player', x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, skin: hashName(m.name) % 8 });
        this.selfModel = this.entities.add({ ...this.selfModel.state, id: -999 });
        this.selfModel.group.visible = false;
        this.ui.showLoading('Loading world...', this.dirtUrl(), () => this.loadProgress());
        break;
      case 'unload':
        this.world.removeChunk(m.cx, m.cz);
        this.renderer.chunks.removeChunk(m.cx, m.cz);
        break;
      case 'block':
        this.pendingPlaces.delete(`${m.x},${m.y},${m.z}`);
        this.world.setBlock(m.x, m.y, m.z, m.s);
        break;
      case 'spawn':
        if (m.e.id !== this.myId) this.entities.add(m.e);
        break;
      case 'despawn':
        for (const id of m.ids) this.entities.remove(id);
        break;
      case 'moves': {
        const d = m.d;
        for (let i = 0; i < d.length; i += 6) this.entities.move(d[i], d[i + 1], d[i + 2], d[i + 3], d[i + 4], d[i + 5]);
        break;
      }
      case 'meta':
        this.entities.update(m.id, m.e);
        break;
      case 'anim':
        if (m.id === this.myId) {
          if (m.a === 'hurt') this.onHurt();
        } else this.entities.anim(m.id, m.a);
        break;
      case 'inv':
        this.inventory = m.slots;
        this.armor = m.armor;
        // While our own hotbar change is in flight, the server's selection is stale: keep ours
        if (!this.hotbarPending) this.selected = m.selected;
        this.ui.setInventory(m.slots, m.armor, this.selected);
        this.hand?.setItem(this.inventory[this.selected]);
        this.updateStatsUI();
        this.entities.update(-999, { item: this.inventory[this.selected] });
        break;
      case 'window':
        if (m.id === 0) this.lastPlayerWindow = m;
        if (this.ui.window && this.ui.window.id === m.id) this.ui.updateWindow(m);
        else if (m.id > this.closedWindowId && !this.dead) {
          // A container opened (ids only grow; late updates for a window we already closed are ignored)
          this.input.unlock();
          this.ui.openWindow(m);
          if (this.ui.chatOpen) this.ui.closeChat();
        }
        break;
      case 'closeWindow':
        // Server-initiated close (container broken, death...): no need to echo a closeWindow back
        if (this.ui.window) this.closeScreen(false);
        break;
      case 'health':
        if (m.hp < this.health && this.health > 0) this.onHurt();
        this.health = m.hp;
        this.food = m.food;
        this.air = m.air;
        this.updateStatsUI();
        break;
      case 'chat':
        this.ui.addChat(m.text, m.color, m.from);
        break;
      case 'time':
        this.time = m.time;
        this.timeRate = m.rate;
        break;
      case 'players':
        this.players = m.list;
        break;
      case 'sound': {
        if (m.s.startsWith('break_') && this.isRecentLocalBreak(m.x, m.y, m.z)) break;
        this.sound.play(m.s, { x: m.x, y: m.y, z: m.z, volume: m.v, pitch: m.p });
        break;
      }
      case 'particles':
        if (m.k === 'block') {
          if (this.isRecentLocalBreak(m.x, m.y, m.z)) break;
          this.particles.blockBreak(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z), m.s ?? 1);
        } else if (m.k === 'explosion') {
          this.particles.explosion(m.x, m.y, m.z, m.s ?? 4);
          const d = this.player.eyePos().distanceTo(new THREE.Vector3(m.x, m.y, m.z));
          this.cameraShake = Math.max(this.cameraShake, Math.max(0, 1 - d / 24));
        } else if (m.k === 'crit') this.particles.crit(m.x, m.y, m.z);
        else if (m.k === 'heart') this.particles.crit(m.x, m.y, m.z, [1, 0.3, 0.4]);
        else if (m.k === 'smoke') this.particles.smoke(m.x, m.y, m.z, 8);
        else if (m.k === 'splash') this.particles.splash(m.x, m.y, m.z);
        break;
      case 'teleport':
        this.player.setPosition(m.x, m.y, m.z);
        if (m.yaw !== undefined) this.player.yaw = m.yaw;
        if (m.pitch !== undefined) this.player.pitch = m.pitch;
        break;
      case 'gamemode':
        this.gamemode = m.mode;
        this.ui.gamemode = m.mode;
        this.ui.setXp(this.xp.level, this.xp.progress);
        if (m.mode !== 'creative') this.player.flying = m.mode === 'spectator';
        this.player.cancelDig();
        this.updateStatsUI();
        // Switch between the survival and creative inventory screens if one is open
        if (this.ui.window?.id === 0) this.ui.openWindow(this.lastPlayerWindow ?? this.ui.window);
        this.ui.actionMessage(`Game mode: ${m.mode[0].toUpperCase()}${m.mode.slice(1)}`);
        break;
      case 'death':
        this.dead = true;
        this.input.unlock();
        this.player.cancelDig();
        this.ui.showDeath(m.msg);
        if (this.ui.chatOpen) this.ui.closeChat();
        break;
      case 'breakAnim':
        this.setOtherCrack(m.id, m.x, m.y, m.z, m.stage);
        break;
      case 'velocity':
        this.player.body.vx = m.vx;
        this.player.body.vy = m.vy;
        this.player.body.vz = m.vz;
        break;
      case 'weather':
        this.weather.target = m.rain;
        this.weather.thunder = m.thunder;
        break;
      case 'lightning':
        this.spawnBolt(m.x, m.y, m.z);
        break;
      case 'xp':
        this.xp = { level: m.level, progress: m.progress };
        this.ui.setXp(m.level, m.progress);
        break;
      case 'pong':
        if (m.n === 0) this.ping = performance.now() - this.pingSent;
        else if (m.n === this.hotbarPending) this.hotbarPending = 0;
        break;
      case 'kick':
        this.stop(m.reason);
        break;
    }
  }
  private lastPlayerWindow: import('../../../shared/src/protocol').WindowUpdate | null = null;

  private loadProgress() {
    const p = this.player.body;
    const cx = Math.floor(p.x) >> 4, cz = Math.floor(p.z) >> 4;
    let have = 0, total = 0;
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        total++;
        if (this.renderer.chunks.hasMesh(cx + dx, cz + dz)) have++;
      }
    return have / total;
  }

  private isRecentLocalBreak(x: number, y: number, z: number) {
    const now = performance.now();
    this.recentBreaks = this.recentBreaks.filter((b) => now - b.t < 1000);
    return this.recentBreaks.some((b) => Math.abs(b.x + 0.5 - x) < 0.6 && Math.abs(b.y + 0.5 - y) < 0.6 && Math.abs(b.z + 0.5 - z) < 0.6);
  }

  private predictBreak(x: number, y: number, z: number, s: number) {
    this.recentBreaks.push({ x, y, z, t: performance.now() });
    this.particles.blockBreak(x, y, z, s);
    this.sound.play(`break_${blockOf(s).sound}`, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
    this.world.setBlock(x, y, z, 0);
  }

  private predictPlace(x: number, y: number, z: number, face: number) {
    const held = this.inventory[this.selected];
    if (!held) return;
    const def = itemDef(held.id);
    const b = def.block;
    if (!b || b.shape !== 'cube' || isLog(b.id) || isDirectional(b.id) || b.name.endsWith('leaves') || b.gravity) return;
    const target = blockOf(this.world.getBlock(x, y, z));
    const [px, py, pz] = target.replaceable ? [x, y, z] : [x + FACE_DIRS[face][0], y + FACE_DIRS[face][1], z + FACE_DIRS[face][2]];
    if (!blockOf(this.world.getBlock(px, py, pz)).replaceable) return;
    // Don't place inside the player
    const pb = this.player.body;
    if (px + 1 > pb.x - 0.3 && px < pb.x + 0.3 && pz + 1 > pb.z - 0.3 && pz < pb.z + 0.3 && py + 1 > pb.y && py < pb.y + pb.height) return;
    const state = makeState(b.id, 0);
    this.pendingPlaces.set(`${px},${py},${pz}`, { x: px, y: py, z: pz, prev: this.world.getBlock(px, py, pz), state, t: performance.now() });
    this.world.setBlock(px, py, pz, state);
  }

  /** Undo predicted placements the server never confirmed (e.g. refused because a mob stands there). */
  private expirePredictions() {
    if (!this.pendingPlaces.size) return;
    const now = performance.now();
    const timeout = 1000 + Math.min(2000, this.ping * 2);
    for (const [k, p] of this.pendingPlaces) {
      if (now - p.t < timeout) continue;
      this.pendingPlaces.delete(k);
      if (this.world.getBlock(p.x, p.y, p.z) === p.state) this.world.setBlock(p.x, p.y, p.z, p.prev);
    }
  }

  private onHurt() {
    this.renderer.flash.color.set(0.6, 0, 0);
    this.renderer.flash.amount = 0.25;
    this.player.hurtTilt = 1;
    this.ui.hurtFlash();
  }

  private spawnBolt(x: number, y: number, z: number) {
    const pts: THREE.Vector3[] = [];
    let px = x, pz = z;
    for (let h = y + 110; h > y; h -= 3 + Math.random() * 4) {
      pts.push(new THREE.Vector3(px, h, pz));
      px += (Math.random() - 0.5) * 3;
      pz += (Math.random() - 0.5) * 3;
    }
    pts.push(new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'chordal', 0);
    const geo = new THREE.TubeGeometry(curve, pts.length * 3, 0.25, 4, false);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 9), transparent: true, opacity: 0.9, depthWrite: false }));
    this.renderer.entityScene.add(mesh);
    this.bolts.push({ mesh, life: 0.45 });
    this.renderer.flash.color.set(1, 1, 1);
    this.renderer.flash.amount = Math.max(this.renderer.flash.amount, 0.45 * Math.max(0.2, 1 - this.player.eyePos().distanceTo(new THREE.Vector3(x, y, z)) / 200));
  }

  private updateStatsUI() {
    const armorPts = this.armor.reduce((a, s) => a + (s ? itemDef(s.id).armor?.defense ?? 0 : 0), 0);
    this.ui.setStats(Math.ceil(this.health), this.food, this.air, armorPts);
  }

  private setOtherCrack(id: number, x: number, y: number, z: number, stage: number) {
    const existing = this.otherCracks.get(id);
    if (stage < 0) {
      if (existing) {
        this.renderer.entityScene.remove(existing.mesh);
        this.otherCracks.delete(id);
      }
      return;
    }
    let c = existing;
    if (!c) {
      const mat = this.crackMat.clone();
      mat.uniforms = { uAtlas: U.uAtlas, uLayer: { value: 0 } };
      const mesh = new THREE.Mesh(this.crack.geometry, mat);
      this.renderer.entityScene.add(mesh);
      c = { x, y, z, stage, mesh };
      this.otherCracks.set(id, c);
    }
    c.mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    ((c.mesh.material as THREE.RawShaderMaterial).uniforms.uLayer as THREE.IUniform).value = this.renderer.atlas.layers[`destroy_stage_${stage}`] ?? 0;
  }

  // ======================================================================================
  // Input
  // ======================================================================================
  private onKey(e: KeyboardEvent) {
    if (!this.running) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const screen = this.ui.screenName;
    if (e.code === 'Escape') {
      if (this.ui.window) this.closeScreen();
      else if (screen === 'pause') this.resume();
      else if (screen === 'options' || screen === 'controls') this.openPause();
      // In game without pointer lock (e.g. the lock request was refused): open the menu like Minecraft does
      else if (!screen && !this.ui.chatOpen && !this.dead && this.loaded && !this.input.locked) this.openPause();
      return;
    }
    if (e.code === 'KeyE' && (screen === 'window' || screen === 'creative')) {
      this.closeScreen();
      return;
    }
    if (screen || this.ui.chatOpen || this.dead) return;
    if (!this.input.locked) return;
    switch (e.code) {
      case 'KeyE':
        this.openInventory();
        break;
      case 'KeyT':
        this.input.unlock();
        this.ui.openChat();
        e.preventDefault();
        break;
      case 'Slash':
        this.input.unlock();
        this.ui.openChat('/');
        e.preventDefault();
        break;
      case 'KeyQ':
        this.conn.send({ t: 'drop', all: e.ctrlKey });
        this.player.swing();
        break;
      case 'F1':
        this.ui.setHudHidden(!this.ui.hudHidden);
        break;
      case 'F3':
        this.ui.debugVisible = !this.ui.debugVisible;
        if (!this.ui.debugVisible) this.ui.setDebug(null);
        break;
      case 'F5':
        this.perspective = (this.perspective + 1) % 3;
        break;
      default:
        if (e.code.startsWith('Digit')) {
          const n = parseInt(e.code.slice(5), 10);
          if (n >= 1 && n <= 9) this.selectSlot(n - 1);
        }
    }
  }

  private selectSlot(i: number) {
    if (i === this.selected) return;
    this.selected = i;
    this.ui.select(i);
    this.hand?.setItem(this.inventory[i]);
    this.conn.send({ t: 'hotbar', slot: i });
    // The pong for this ping tells us the server has processed the hotbar change (messages are handled in order)
    this.hotbarSeq = (this.hotbarSeq % 1e9) + 1;
    this.hotbarPending = this.hotbarSeq;
    this.conn.send({ t: 'ping', n: this.hotbarSeq });
    this.player.cancelDig();
    this.player.eating = 0;
    this.entities.update(-999, { item: this.inventory[i] });
  }

  openInventory() {
    this.input.unlock();
    const w = this.lastPlayerWindow ?? { t: 'window' as const, id: 0, kind: 'player' as const, title: 'Crafting', slots: new Array(45).fill(null), cursor: null };
    this.ui.openWindow(w);
  }

  closeScreen(notifyServer = true) {
    const w = this.ui.window;
    if (w) {
      if (notifyServer) this.conn.send({ t: 'closeWindow' });
      this.closedWindowId = Math.max(this.closedWindowId, w.id);
    }
    this.ui.closeScreen();
    if (this.running && !this.dead && !this.ui.chatOpen) this.input.lock();
  }

  openPause() {
    this.input.unlock();
    this.ui.showPause();
  }

  resume() {
    this.ui.closeScreen();
    this.input.lock();
  }

  respawn() {
    this.dead = false;
    this.conn.send({ t: 'respawn' });
    this.ui.closeScreen();
    this.input.lock();
  }

  // ======================================================================================
  // Frame loop
  // ======================================================================================
  private loop = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    if (!this.running) return;
    const now = performance.now();
    const dtMs = Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    const dt = dtMs / 1000;
    this.fpsFrames++;
    this.fpsTime += dtMs;
    if (this.fpsTime >= 1000) {
      this.fps = this.fpsFrames;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.pingSent = performance.now();
      this.conn.send({ t: 'ping', n: 0 });
    }
    this.time += dt * TICKS_PER_SECOND * this.timeRate;

    // Unfreeze once the terrain around the player is ready
    if (!this.loaded && this.myId >= 0) {
      if (this.loadProgress() >= 1) {
        this.loaded = true;
        this.player.frozen = false;
        // Only close the loading screen (a death screen or container may already have replaced it)
        if (this.ui.screenName === 'message') this.ui.closeScreen();
        this.ui.showHud(true);
        if (!this.ui.screenName && !this.ui.chatOpen) this.input.lock();
        this.sound.startMusic();
      }
    }

    const uiOpen = !!this.ui.screenName || this.ui.chatOpen || !this.input.locked;
    this.input.enabled = !uiOpen;
    // Each section is guarded so that an exception can't freeze rendering for good
    this.guard('input', () => {
      if (!uiOpen) {
        if (this.input.wheel) {
          this.selectSlot((((this.selected + this.input.wheel) % 9) + 9) % 9);
        }
        if (this.input.clicked.has(1) && this.player.target) this.conn.send({ t: 'pickBlock', state: this.player.target.state });
      }
      this.player.update(dtMs, uiOpen || this.dead);
      if (this.player.digging && Math.random() < 0.3) {
        const d = this.player.digging;
        this.particles.blockHit(d.x, d.y, d.z, d.face, this.world.getBlock(d.x, d.y, d.z));
      }
    });
    this.input.endFrame();
    this.guard('update', () => this.updateWorld(dt));
    this.guard('render', () => this.renderer.render(dt));
    this.guard('ui', () => {
      this.ui.frame(dt);
      if (this.ui.debugVisible) this.updateDebug();
      this.ui.setPlayerList(this.input.keys.has('Tab') && !uiOpen ? this.players.map((p) => p.name + (p.agent ? ' [AI]' : '')) : null);
    });
  };

  private guard(section: string, fn: () => void) {
    try {
      fn();
    } catch (e) {
      const now = performance.now();
      if (now - this.lastFrameError > 2000) {
        this.lastFrameError = now;
        console.error(`Frame error (${section}):`, e);
      }
    }
  }

  private updateWorld(dt: number) {
    this.expirePredictions();
    this.updateCamera(dt);
    this.updateSelection();
    this.renderer.setTime(this.time);
    this.entities.frame(dt, this.renderer.camera.position);
    this.updateSelfModel();
    this.particles.update(dt);
    this.weather.update(dt, this.renderer.camera.position);
    this.sound.setRain(this.weather.level * (this.weather.hasPrecipitation(Math.floor(this.player.body.x), Math.floor(this.player.body.z)) && !this.weather.isSnowAt(Math.floor(this.player.body.x), Math.floor(this.player.body.y), Math.floor(this.player.body.z)) ? 1 : 0) * (this.world.getSkyLight(Math.floor(this.player.body.x), Math.floor(this.player.body.y + 1), Math.floor(this.player.body.z)) > 10 ? 1 : 0.35));
    for (const b of this.bolts) {
      b.life -= dt;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.life / 0.45) * (Math.random() < 0.3 ? 0.4 : 0.95);
      if (b.life <= 0) {
        this.renderer.entityScene.remove(b.mesh);
        b.mesh.geometry.dispose();
      }
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);
    this.ambientParticles(dt);
    const eye = this.renderer.camera.position;
    const sky = this.world.getSkyLight(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z)) / 15;
    const blk = this.world.getBlockLight(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z)) / 15;
    this.hand?.setItem(this.inventory[this.selected]);
    this.hand?.update(dt, {
      swing: this.player.swingTime, bob: this.player.bob, bobAmount: this.settings.viewBobbing ? this.player.bobAmount : 0, eating: this.player.eating,
      pitch: this.player.pitch, sky, blk, hidden: this.perspective !== 0 || this.ui.hudHidden || this.gamemode === 'spectator',
    });
    this.renderer.flash.amount = Math.max(0, this.renderer.flash.amount - dt * 0.8);

    // Underwater
    const es = this.world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    const underwater = blockOf(es).name === 'water' && eye.y < Math.floor(eye.y) + fluidHeight(es >> 8) + 0.1;
    U.uUnderwater.value = underwater ? 1 : 0;
    this.sound.setUnderwater(underwater);
    this.sound.setListener(eye.x, eye.y, eye.z, this.player.yaw, this.player.pitch);
    const surface = this.world.getHeight(Math.floor(eye.x), Math.floor(eye.z));
    this.sound.updateAmbience({ depthBelowSurface: surface - eye.y, skyLight: sky * 15, inWater: underwater });
  }

  private updateCamera(dt: number) {
    const cam = this.renderer.camera;
    const feet = this.player.renderPos(new THREE.Vector3());
    const eye = feet.clone();
    eye.y += this.player.eye;
    let yaw = this.player.yaw, pitch = this.player.pitch;
    // View bobbing
    if (this.settings.viewBobbing && this.perspective === 0) {
      const b = this.player.bob, a = this.player.bobAmount;
      eye.y += Math.abs(Math.sin(b)) * 0.06 * a;
      const side = Math.cos(b) * 0.03 * a;
      eye.x += Math.cos(yaw) * side;
      eye.z -= Math.sin(yaw) * side;
    }
    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 1.5);
      eye.x += (Math.random() - 0.5) * this.cameraShake * 0.3;
      eye.y += (Math.random() - 0.5) * this.cameraShake * 0.3;
    }
    if (this.perspective !== 0) {
      const dir = this.player.lookDir();
      const back = this.perspective === 1 ? -1 : 1;
      let dist = 4;
      // Pull the camera in if it would clip into terrain
      for (let d = 0.2; d <= 4; d += 0.1) {
        const p = eye.clone().addScaledVector(dir, back * d);
        if (BLOCKS[this.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) & 0xff].opaque) {
          dist = d - 0.3;
          break;
        }
      }
      eye.addScaledVector(dir, back * Math.max(0.3, dist));
      if (this.perspective === 2) {
        yaw += Math.PI;
        pitch = -pitch;
      }
    }
    cam.position.copy(eye);
    const tilt = this.player.hurtTilt > 0 ? Math.sin(this.player.hurtTilt * Math.PI) * 0.12 : 0;
    cam.rotation.set(pitch, yaw, tilt, 'YXZ');
    const fov = this.settings.fov * this.player.fovBoost * (U.uUnderwater.value > 0.5 ? 0.9 : 1);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  private updateSelfModel() {
    const m = this.selfModel;
    if (!m) return;
    m.group.visible = this.perspective !== 0 && this.gamemode !== 'spectator';
    const p = this.player.renderPos(new THREE.Vector3());
    m.target.copy(p);
    m.pos.copy(p);
    m.targetYaw = this.player.yaw;
    m.targetPitch = this.player.pitch;
    m.state.sneaking = this.player.sneaking;
    if (this.player.swingTime > 0.95) m.swing = 1;
  }

  private updateSelection() {
    const t = this.player.target;
    const show = !!t && !this.ui.hudHidden && this.gamemode !== 'spectator';
    this.selection.visible = show;
    if (t && show) {
      const box = selectionBox(t.state) ?? [0, 0, 0, 1, 1, 1];
      const e = 0.002;
      this.selection.position.set(t.x + (box[0] + box[3]) / 2, t.y + (box[1] + box[4]) / 2, t.z + (box[2] + box[5]) / 2);
      this.selection.scale.set(box[3] - box[0] + e * 2, box[4] - box[1] + e * 2, box[5] - box[2] + e * 2);
    }
    const d = this.player.digging;
    this.crack.visible = !!d && d.need > 0;
    if (d) {
      const stage = Math.min(9, Math.floor((d.progress / d.need) * 10));
      this.crackMat.uniforms.uLayer.value = this.renderer.atlas.layers[`destroy_stage_${stage}`] ?? 0;
      this.crack.position.set(d.x + 0.5, d.y + 0.5, d.z + 0.5);
    }
  }

  private ambientTimer = 0;
  private ambientParticles(dt: number) {
    this.ambientTimer += dt;
    if (this.ambientTimer < 0.1) return;
    this.ambientTimer = 0;
    // Torch flames & smoke, lava pops, underwater bubbles near the player
    const p = this.player.body;
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(p.x + (Math.random() - 0.5) * 24), y = Math.floor(p.y + (Math.random() - 0.5) * 12), z = Math.floor(p.z + (Math.random() - 0.5) * 24);
      const s = this.world.getBlock(x, y, z);
      const id = s & 0xff;
      if (id === 0) continue;
      const name = BLOCKS[id].name;
      if (name === 'torch') {
        const meta = s >> 8;
        let fx = x + 0.5, fz = z + 0.5, fy = y + 0.7;
        if (meta !== 2 && meta <= 5) {
          const d = FACE_DIRS[meta];
          fx += d[0] * 0.27; fz += d[2] * 0.27; fy += 0.22;
        }
        this.particles.flame(fx, fy, fz);
        if (Math.random() < 0.5) this.particles.smoke(fx, fy + 0.05, fz, 1, 0.25);
      } else if (name === 'lava' && (this.world.getBlock(x, y + 1, z) & 0xff) === 0 && Math.random() < 0.05) {
        this.particles.flame(x + Math.random(), y + 1, z + Math.random());
        this.sound.play('lava_pop', { x: x + 0.5, y: y + 1, z: z + 0.5, volume: 0.4 });
      } else if (name === 'lit_furnace' && Math.random() < 0.3) {
        this.particles.smoke(x + 0.5, y + 1.05, z + 0.5, 1, 0.2);
      }
    }
    if (U.uUnderwater.value > 0.5 && Math.random() < 0.5) {
      const e = this.renderer.camera.position;
      const a = Math.random() * Math.PI * 2, d = 1.5 + Math.random() * 3;
      this.particles.bubble(e.x + Math.cos(a) * d, e.y - 1.5, e.z + Math.sin(a) * d);
    }
  }

  private updateDebug() {
    const p = this.player.body;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const c = this.world.getChunk(bx >> 4, bz >> 4);
    const biome = c ? BIOMES[c.biomes[(bx & 15) | ((bz & 15) << 4)]]?.displayName : '?';
    const yawDeg = ((((-this.player.yaw * 180) / Math.PI) % 360) + 540) % 360 - 180;
    const facing = ['south', 'west', 'north', 'east'][Math.round(((this.player.yaw / (Math.PI / 2)) % 4 + 4) % 4) % 4] ?? 'north';
    const facingName = ['north', 'west', 'south', 'east'][Math.round((((this.player.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4];
    void facing;
    const info = this.renderer.info;
    const t = this.player.target;
    const tDef = t ? blockOf(t.state) : null;
    const dayTime = Math.floor(((this.time % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH);
    const left = [
      `MCAI Sandbox 1.0 (${this.fps} fps)`,
      `${info.render.calls} draws, ${Math.round(info.render.triangles / 1000)}k tris, ${this.renderer.chunks.stats.meshes} chunk meshes, ${this.renderer.chunks.stats.pending} queued`,
      `Entities: ${this.entities.entities.size}  Particles on`,
      '',
      `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(5)} / ${p.z.toFixed(3)}`,
      `Block: ${bx} ${by} ${bz}  Chunk: ${bx & 15} ${by & 15} ${bz & 15} in ${bx >> 4} ${by >> 4} ${bz >> 4}`,
      `Facing: ${facingName} (${yawDeg.toFixed(1)} / ${((-this.player.pitch * 180) / Math.PI).toFixed(1)})`,
      `Light: ${this.world.getLightLevel(bx, by + 1, bz)} (${this.world.getSkyLight(bx, by + 1, bz)} sky, ${this.world.getBlockLight(bx, by + 1, bz)} block)`,
      `Biome: ${biome}`,
      `Day ${Math.floor(this.time / DAY_LENGTH)}, time ${dayTime}`,
      `Mode: ${this.gamemode}${this.player.flying ? ' (flying)' : ''}`,
      `Ping: ${Math.round(this.ping)} ms  Net: ${(this.conn.bytesIn / 1048576).toFixed(1)} MB`,
    ];
    const right = [
      `Seed: ${this.seed}`,
      `Chunks loaded: ${this.world.chunks.size}`,
      `Renderer: WebGL2 + custom shaders`,
      `Shadows: ${this.settings.shadows ? this.settings.shadowSize : 'off'}  SSR: ${this.settings.reflections ? 'on' : 'off'}`,
      '',
      t ? `Targeted Block: ${t.x}, ${t.y}, ${t.z}` : '',
      tDef ? `minecraft:${tDef.name}${t && t.state >> 8 ? ` [${t.state >> 8}]` : ''}` : '',
    ];
    this.ui.setDebug(left, right);
  }

  dirtUrl(): string | null {
    const px = this.renderer.atlas.pixels.get('dirt');
    if (!px) return null;
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(16, 16);
    img.data.set(px);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }
}

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

export { numKey };
export type { EntityState };
