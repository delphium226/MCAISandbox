import './style.css';
import { ItemStack, itemDef, creativeItems, ITEMS } from '../../../shared/src/items';
import { WindowUpdate } from '../../../shared/src/protocol';
import { GLYPHS } from './pixelFont';
import { HUD_ICONS } from './hudIcons';
import type { IconRenderer } from './icons';
import type { GraphicsSettings } from '../render/renderer';

export interface ClientSettings extends GraphicsSettings {
  sensitivity: number;
  master: number;
  music: number;
  sfx: number;
  guiScale: number;
  name: string;
  server: string;
  viewBobbing: boolean;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

const SPLASHES = [
  'Now with AI players!', 'Procedurally generated!', 'Punch the trees!', '100% pixel-perfect!', 'Shaders included!',
  'Also try the original!', 'Voxel-tastic!', 'Agents welcome!', 'Built in a day!', 'Creepers not included... wait', 'Emergent societies!',
  'Craft responsibly!', 'Made with Three.js!', 'Now in your browser!', 'PIANO ready!', 'Diamonds await!',
];

export interface UIHandlers {
  play: (name: string, server: string) => void;
  resume: () => void;
  disconnect: () => void;
  respawn: () => void;
  settingsChanged: (s: ClientSettings) => void;
  click: (w: number, slot: number, button: number, shift: boolean) => void;
  drag: (w: number, slots: number[], button: number) => void;
  closeWindow: () => void;
  creativeSet: (slot: number, item: ItemStack | null) => void;
  chat: (text: string) => void;
  uiSound: () => void;
}

export class UI {
  root: HTMLElement;
  hud: HTMLElement;
  icons!: IconRenderer;
  private screen: HTMLElement | null = null;
  screenName = '';
  private hotbarSlots: HTMLElement[] = [];
  private hotbarSel!: HTMLElement;
  private heartsRow!: HTMLElement;
  private foodRow!: HTMLElement;
  private armorRow!: HTMLElement;
  private airRow!: HTMLElement;
  private itemName!: HTMLElement;
  private actionMsg!: HTMLElement;
  private chatBox!: HTMLElement;
  private chatInputWrap: HTMLElement | null = null;
  private chatLines: { el: HTMLElement; time: number }[] = [];
  private debugLeft!: HTMLElement;
  private debugRight!: HTMLElement;
  private playerList!: HTMLElement;
  private hurtVignette!: HTMLElement;
  private cursorEl!: HTMLElement;
  private tooltip!: HTMLElement;
  private itemNameTimer = 0;
  private actionTimer = 0;
  window: WindowUpdate | null = null;
  private windowSlots: HTMLElement[] = [];
  private dragging: { button: number; slots: number[] } | null = null;
  private mouse = { x: 0, y: 0 };
  private creativeTab = 0;
  private creativeSearch = '';
  gamemode: 'survival' | 'creative' | 'spectator' = 'survival';
  inventory: (ItemStack | null)[] = new Array(36).fill(null);
  armor: (ItemStack | null)[] = [null, null, null, null];
  selected = 0;
  hudHidden = false;
  debugVisible = false;
  sentHistory: string[] = [];
  private historyIdx = -1;
  private progressUpdater: (() => void) | null = null;

  constructor(public settings: ClientSettings, private handlers: UIHandlers) {
    this.root = document.getElementById('ui')!;
    this.hud = h('div', 'hidden', this.root);
    this.hud.id = 'hud';
    this.buildHud();
    this.cursorEl = h('div', 'cursor-item hidden', document.body);
    this.tooltip = h('div', 'tooltip hidden', document.body);
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.cursorEl.style.left = `${e.clientX}px`;
      this.cursorEl.style.top = `${e.clientY}px`;
      this.positionTooltip();
    });
    window.addEventListener('mouseup', (e) => this.endDrag(e));
    this.applyGuiScale();
    window.addEventListener('resize', () => this.applyGuiScale());
  }

  applyGuiScale() {
    let s = this.settings.guiScale;
    if (!s) {
      // Auto: largest scale that fits 320x240 GUI pixels
      s = Math.max(1, Math.min(4, Math.floor(Math.min(window.innerWidth / 320, window.innerHeight / 240))));
    }
    document.documentElement.style.setProperty('--ui-scale', String(s));
  }

  // ======================================================================================
  // Screens
  // ======================================================================================
  closeScreen() {
    this.screen?.remove();
    this.screen = null;
    this.screenName = '';
    this.window = null;
    this.windowSlots = [];
    this.cursorEl.classList.add('hidden');
    this.tooltip.classList.add('hidden');
    this.progressUpdater = null;
  }

  private openScreen(name: string, cls: string): HTMLElement {
    this.closeScreen();
    const s = h('div', `screen ${cls}`, this.root);
    this.screen = s;
    this.screenName = name;
    return s;
  }

  private button(parent: HTMLElement, label: string, onClick: () => void, cls = '') {
    const b = h('button', `btn ${cls}`, parent, label);
    b.addEventListener('click', () => {
      this.handlers.uiSound();
      onClick();
    });
    return b;
  }

  private dirtBackground(el: HTMLElement, dirtUrl: string | null) {
    if (dirtUrl) el.style.backgroundImage = `url(${dirtUrl})`;
  }

  showTitle(dirtUrl: string | null, stoneUrl: HTMLCanvasElement | null) {
    const s = this.openScreen('title', 'dirt');
    this.dirtBackground(s, dirtUrl);
    const logo = h('div', 'logo', s);
    logo.appendChild(renderLogo('MCAI', 'SANDBOX', stoneUrl));
    h('div', 'splash', logo, SPLASHES[Math.floor(Math.random() * SPLASHES.length)]);
    const col = h('div', 'btn-col', s);
    h('div', 'field-label', col, 'Player name');
    const name = h('input', 'mc-input', col);
    name.value = this.settings.name;
    name.maxLength = 16;
    h('div', 'field-label', col, 'Server address');
    const server = h('input', 'mc-input', col);
    server.value = this.settings.server;
    h('div', '', col).style.height = 'calc(8px * var(--ui-scale))';
    const play = () => {
      const n = name.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16) || 'Steve';
      this.settings.name = n;
      this.settings.server = server.value.trim();
      this.handlers.settingsChanged(this.settings);
      this.handlers.play(n, this.settings.server);
    };
    this.button(col, 'Play', play);
    const row = h('div', 'btn-row', col);
    this.button(row, 'Options...', () => this.showOptions(() => this.showTitle(dirtUrl, stoneUrl)), 'half');
    this.button(row, 'Controls', () => this.showControls(() => this.showTitle(dirtUrl, stoneUrl)), 'half');
    name.addEventListener('keydown', (e) => e.key === 'Enter' && play());
    server.addEventListener('keydown', (e) => e.key === 'Enter' && play());
    h('div', 'version', s, 'MCAI Sandbox 1.0');
    h('div', 'copyright', s, 'Not affiliated with Mojang. Procedural assets.');
  }

  showMessage(title: string, sub = '', dirtUrl: string | null = null, back?: () => void) {
    const s = this.openScreen('message', 'dirt');
    this.dirtBackground(s, dirtUrl);
    h('h1', '', s, title);
    if (sub) h('div', 'subtitle', s, sub);
    if (back) this.button(s, 'Back to title screen', back);
    return s;
  }

  showLoading(title: string, dirtUrl: string | null, progress: () => number) {
    const s = this.showMessage(title, 'Building terrain', dirtUrl);
    const bar = h('div', 'loading-bar', s);
    const fill = h('div', '', bar);
    this.progressUpdater = () => (fill.style.width = `${Math.round(progress() * 100)}%`);
  }

  showPause() {
    const s = this.openScreen('pause', 'dim');
    h('h1', '', s, 'Game Menu');
    this.button(s, 'Back to Game', () => this.handlers.resume());
    const row = h('div', 'btn-row', s);
    this.button(row, 'Options...', () => this.showOptions(() => this.showPause()), 'half');
    this.button(row, 'Controls', () => this.showControls(() => this.showPause()), 'half');
    h('div', '', s).style.height = 'calc(12px * var(--ui-scale))';
    this.button(s, 'Save and Quit to Title', () => this.handlers.disconnect());
  }

  showDeath(msg: string) {
    const s = this.openScreen('death', 'death-screen');
    h('h1', '', s, 'You Died!');
    h('div', 'subtitle', s, msg);
    h('div', '', s).style.height = 'calc(20px * var(--ui-scale))';
    const b = this.button(s, 'Respawn', () => this.handlers.respawn());
    b.disabled = true;
    setTimeout(() => (b.disabled = false), 1000);
    this.button(s, 'Title Screen', () => this.handlers.disconnect());
  }

  showControls(back: () => void) {
    const s = this.openScreen('controls', 'dim');
    h('h1', '', s, 'Controls');
    const lines = [
      ['W A S D', 'Move'], ['Space', 'Jump / swim up (double-tap: fly in creative)'], ['Shift', 'Sneak / fly down'], ['Ctrl / double-tap W', 'Sprint'],
      ['Left click', 'Attack / break block'], ['Right click', 'Use / place block / eat'], ['Middle click', 'Pick block'], ['1-9 / wheel', 'Select hotbar slot'],
      ['E', 'Inventory'], ['Q', 'Drop item (Ctrl+Q: whole stack)'], ['T  or  /', 'Chat / command'], ['Tab', 'Player list'], ['F1', 'Hide HUD'], ['F3', 'Debug info'],
      ['F5', 'Toggle camera perspective'], ['Esc', 'Pause menu'],
    ];
    const grid = h('div', '', s);
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'auto auto';
    grid.style.gap = 'calc(2px * var(--ui-scale)) calc(16px * var(--ui-scale))';
    grid.style.marginBottom = 'calc(12px * var(--ui-scale))';
    for (const [k, v] of lines) {
      h('div', '', grid, k).style.color = '#ffff80';
      h('div', '', grid, v);
    }
    this.button(s, 'Done', back);
  }

  showOptions(back: () => void) {
    const s = this.openScreen('options', 'dim');
    h('h1', '', s, 'Options');
    const grid = h('div', 'options-grid', s);
    const st = this.settings;
    const changed = () => this.handlers.settingsChanged(st);
    this.slider(grid, 'FOV', 30, 110, 1, st.fov, (v) => ((st.fov = v), changed()), (v) => (v === 70 ? 'Normal' : String(v)));
    this.slider(grid, 'Render Distance', 2, 16, 1, st.viewDistance, (v) => ((st.viewDistance = v), changed()), (v) => `${v} chunks`);
    this.slider(grid, 'Sensitivity', 20, 200, 1, Math.round(st.sensitivity * 100), (v) => ((st.sensitivity = v / 100), changed()), (v) => `${v}%`);
    this.slider(grid, 'GUI Scale', 0, 4, 1, st.guiScale, (v) => ((st.guiScale = v), this.applyGuiScale(), changed()), (v) => (v === 0 ? 'Auto' : String(v)));
    this.slider(grid, 'Master Volume', 0, 100, 1, Math.round(st.master * 100), (v) => ((st.master = v / 100), changed()), (v) => `${v}%`);
    this.slider(grid, 'Music', 0, 100, 1, Math.round(st.music * 100), (v) => ((st.music = v / 100), changed()), (v) => `${v}%`);
    this.slider(grid, 'Sounds', 0, 100, 1, Math.round(st.sfx * 100), (v) => ((st.sfx = v / 100), changed()), (v) => `${v}%`);
    this.slider(grid, 'Render Scale', 50, 100, 5, Math.round(st.renderScale * 100), (v) => ((st.renderScale = v / 100), changed()), (v) => `${v}%`);
    const toggle = (label: string, key: 'shadows' | 'reflections' | 'bloom' | 'godrays' | 'clouds' | 'viewBobbing') => {
      const b = this.button(grid, '', () => {
        st[key] = !st[key];
        b.textContent = `${label}: ${st[key] ? 'ON' : 'OFF'}`;
        changed();
      });
      b.textContent = `${label}: ${st[key] ? 'ON' : 'OFF'}`;
    };
    toggle('Shadows', 'shadows');
    toggle('Water Reflections', 'reflections');
    toggle('Bloom', 'bloom');
    toggle('God Rays', 'godrays');
    toggle('Clouds', 'clouds');
    toggle('View Bobbing', 'viewBobbing');
    const sq = this.button(grid, '', () => {
      st.shadowSize = st.shadowSize >= 4096 ? 1024 : st.shadowSize * 2;
      sq.textContent = `Shadow Quality: ${st.shadowSize}`;
      changed();
    });
    sq.textContent = `Shadow Quality: ${st.shadowSize}`;
    const preset = this.button(grid, 'Graphics: Fancy', () => {
      const fast = st.shadows;
      st.shadows = st.reflections = st.bloom = st.godrays = !fast;
      preset.textContent = `Graphics: ${fast ? 'Fast' : 'Fancy'}`;
      changed();
      this.showOptions(back);
    });
    preset.textContent = `Graphics: ${st.shadows ? 'Fancy' : 'Fast'}`;
    h('div', '', s).style.height = 'calc(8px * var(--ui-scale))';
    this.button(s, 'Done', back);
  }

  private slider(parent: HTMLElement, label: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void, fmt: (v: number) => string) {
    const el = h('div', 'slider', parent);
    const knob = h('div', 'knob', el);
    const text = h('span', '', el);
    const set = (v: number) => {
      v = Math.max(min, Math.min(max, Math.round(v / step) * step));
      value = v;
      knob.style.left = `calc(${((v - min) / (max - min)) * 100}% - ${((v - min) / (max - min)) * 8}px * var(--ui-scale))`;
      text.textContent = `${label}: ${fmt(v)}`;
    };
    set(value);
    const fromEvent = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      set(min + ((e.clientX - r.left) / r.width) * (max - min));
      onChange(value);
    };
    el.addEventListener('mousedown', (e) => {
      fromEvent(e);
      const move = (ev: MouseEvent) => fromEvent(ev);
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        this.handlers.uiSound();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  // ======================================================================================
  // HUD
  // ======================================================================================
  private buildHud() {
    const hud = this.hud;
    h('div', 'crosshair', hud);
    this.hurtVignette = h('div', 'vignette-hurt', hud);
    const stats = h('div', 'stats', hud);
    this.heartsRow = h('div', 'stat-row hearts', stats);
    this.armorRow = h('div', 'stat-row armor', stats);
    this.foodRow = h('div', 'stat-row food', stats);
    this.airRow = h('div', 'stat-row air', stats);
    const bar = h('div', 'hotbar', hud);
    for (let i = 0; i < 9; i++) this.hotbarSlots.push(h('div', 'hslot', bar));
    this.hotbarSel = h('div', 'sel', bar);
    this.itemName = h('div', 'item-name', hud);
    this.actionMsg = h('div', 'action-msg', hud);
    this.chatBox = h('div', 'chat', hud);
    this.debugLeft = h('div', 'debug hidden', hud);
    this.debugRight = h('div', 'debug right hidden', hud);
    this.playerList = h('div', 'playerlist hidden', hud);
    this.setStats(20, 20, 300, 0);
  }

  showHud(v: boolean) {
    this.hud.classList.toggle('hidden', !v);
  }

  setHudHidden(v: boolean) {
    this.hudHidden = v;
    for (const el of this.hud.children) {
      if (el === this.chatBox) continue;
      (el as HTMLElement).style.visibility = v ? 'hidden' : '';
    }
  }

  private statImgs(row: HTMLElement, n: number): HTMLImageElement[] {
    while (row.children.length < n) h('img', 'pix', row);
    while (row.children.length > n) row.lastChild!.remove();
    return [...row.children] as HTMLImageElement[];
  }

  setStats(hp: number, food: number, air: number, armorPts: number) {
    const survival = this.gamemode === 'survival';
    this.heartsRow.style.display = survival ? '' : 'none';
    this.foodRow.style.display = survival ? '' : 'none';
    const hearts = this.statImgs(this.heartsRow, 10);
    const low = hp <= 4;
    hearts.forEach((img, i) => {
      const v = hp - i * 2;
      img.src = v >= 2 ? HUD_ICONS.heartFull : v === 1 ? HUD_ICONS.heartHalf : HUD_ICONS.heartEmpty;
      img.style.transform = low ? `translateY(${Math.round(Math.random() * 2 - 1)}px)` : '';
    });
    const foods = this.statImgs(this.foodRow, 10);
    foods.forEach((img, i) => {
      const v = food - i * 2;
      img.src = v >= 2 ? HUD_ICONS.foodFull : v === 1 ? HUD_ICONS.foodHalf : HUD_ICONS.foodEmpty;
    });
    const armorImgs = this.statImgs(this.armorRow, armorPts > 0 && survival ? 10 : 0);
    armorImgs.forEach((img, i) => {
      const v = armorPts - i * 2;
      img.src = v >= 2 ? HUD_ICONS.armorFull : v === 1 ? HUD_ICONS.armorHalf : HUD_ICONS.armorEmpty;
    });
    const bubbles = air < 300 && survival ? Math.max(0, Math.ceil((air * 10) / 300)) : 0;
    const airImgs = this.statImgs(this.airRow, bubbles);
    airImgs.forEach((img) => (img.src = HUD_ICONS.bubble));
  }

  hurtFlash() {
    this.hurtVignette.style.transition = 'none';
    this.hurtVignette.style.opacity = '1';
    requestAnimationFrame(() => {
      this.hurtVignette.style.transition = 'opacity 0.6s';
      this.hurtVignette.style.opacity = '0';
    });
  }

  setInventory(slots: (ItemStack | null)[], armor: (ItemStack | null)[], selected: number) {
    const prevSel = this.selected;
    const prevItem = this.inventory[this.selected]?.id;
    this.inventory = slots;
    this.armor = armor;
    this.selected = selected;
    this.renderHotbar();
    if (prevSel !== selected || prevItem !== slots[selected]?.id) this.showItemName();
  }

  select(i: number) {
    this.selected = i;
    this.renderHotbar();
    this.showItemName();
  }

  private showItemName() {
    const s = this.inventory[this.selected];
    this.itemName.textContent = s ? itemDef(s.id).displayName : '';
    this.itemName.style.opacity = '1';
    this.itemNameTimer = 2.5;
  }

  actionMessage(text: string, seconds = 2.5) {
    this.actionMsg.textContent = text;
    this.actionMsg.style.opacity = '1';
    this.actionTimer = seconds;
  }

  private renderHotbar() {
    for (let i = 0; i < 9; i++) this.renderStack(this.hotbarSlots[i], this.inventory[i]);
    this.hotbarSel.style.left = `calc(${this.selected * 20 - 1}px * var(--ui-scale))`;
  }

  renderStack(el: HTMLElement, s: ItemStack | null) {
    const key = s ? `${s.id}:${s.count}:${s.damage ?? 0}` : '';
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.querySelectorAll('.item-icon, .item-count, .durability').forEach((n) => n.remove());
    if (!s || !this.icons) return;
    const img = h('img', 'item-icon', el);
    img.src = this.icons.icon(s.id);
    if (s.count > 1) h('div', 'item-count', el, String(s.count));
    const tool = itemDef(s.id).tool;
    const armorInfo = itemDef(s.id).armor;
    const maxDur = tool?.durability ?? armorInfo?.durability;
    if (maxDur && s.damage) {
      const frac = 1 - s.damage / maxDur;
      const bar = h('div', 'durability', el);
      const fill = h('div', '', bar);
      fill.style.width = `${Math.round(frac * 100)}%`;
      fill.style.background = `hsl(${Math.round(frac * 120)}, 100%, 50%)`;
    }
  }

  frame(dt: number) {
    if (this.itemNameTimer > 0) {
      this.itemNameTimer -= dt;
      if (this.itemNameTimer <= 0) this.itemName.style.opacity = '0';
    }
    if (this.actionTimer > 0) {
      this.actionTimer -= dt;
      if (this.actionTimer <= 0) this.actionMsg.style.opacity = '0';
    }
    const now = performance.now();
    const chatOpen = !!this.chatInputWrap;
    for (const l of this.chatLines) {
      const age = (now - l.time) / 1000;
      l.el.style.opacity = chatOpen ? '1' : age > 10 ? String(Math.max(0, 1 - (age - 10))) : '1';
    }
    this.progressUpdater?.();
    if (this.window?.kind === 'furnace') this.updateFurnaceProgress();
  }

  // ---- Chat ----
  addChat(text: string, color?: string, from?: string) {
    const line = h('div', 'line', this.chatBox);
    if (from) {
      const n = h('span', '', line, `<${from}> `);
      n.style.color = '#fff';
    }
    const t = h('span', '', line, text);
    if (color) t.style.color = color;
    this.chatLines.push({ el: line, time: performance.now() });
    while (this.chatLines.length > 100) this.chatLines.shift()!.el.remove();
    // keep only the latest 10 visible when closed
    this.chatLines.forEach((l, i) => (l.el.style.display = this.chatInputWrap || i >= this.chatLines.length - 10 ? '' : 'none'));
  }

  get chatOpen() {
    return !!this.chatInputWrap;
  }

  openChat(prefix = '') {
    if (this.chatInputWrap) return;
    const wrap = h('div', 'chat-input-wrap', this.hud);
    const input = h('input', 'chat-input', wrap);
    input.maxLength = 256;
    input.value = prefix;
    this.chatInputWrap = wrap;
    this.historyIdx = -1;
    this.chatLines.forEach((l) => (l.el.style.display = ''));
    setTimeout(() => input.focus(), 0);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = input.value.trim();
        if (v) {
          this.handlers.chat(v);
          this.sentHistory.push(v);
        }
        this.closeChat();
      } else if (e.key === 'Escape') {
        this.closeChat();
      } else if (e.key === 'ArrowUp' && this.sentHistory.length) {
        this.historyIdx = this.historyIdx < 0 ? this.sentHistory.length - 1 : Math.max(0, this.historyIdx - 1);
        input.value = this.sentHistory[this.historyIdx];
        e.preventDefault();
      } else if (e.key === 'ArrowDown' && this.historyIdx >= 0) {
        this.historyIdx = Math.min(this.sentHistory.length - 1, this.historyIdx + 1);
        input.value = this.sentHistory[this.historyIdx];
        e.preventDefault();
      }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
  }

  closeChat() {
    this.chatInputWrap?.remove();
    this.chatInputWrap = null;
    this.chatLines.forEach((l, i) => (l.el.style.display = i >= this.chatLines.length - 10 ? '' : 'none'));
    this.onChatClosed();
  }
  onChatClosed: () => void = () => {};

  // ---- Debug / player list ----
  setDebug(left: string[] | null, right: string[] = []) {
    this.debugLeft.classList.toggle('hidden', !left);
    this.debugRight.classList.toggle('hidden', !left);
    if (!left) return;
    const fill = (el: HTMLElement, lines: string[]) => {
      while (el.children.length < lines.length) h('div', '', el);
      while (el.children.length > lines.length) el.lastChild!.remove();
      lines.forEach((l, i) => {
        const d = el.children[i] as HTMLElement;
        if (d.textContent !== l) d.textContent = l;
        d.style.visibility = l ? '' : 'hidden';
      });
    };
    fill(this.debugLeft, left);
    fill(this.debugRight, right);
  }

  setPlayerList(names: string[] | null) {
    this.playerList.classList.toggle('hidden', !names);
    if (!names) return;
    this.playerList.innerHTML = '';
    for (const n of names) h('div', '', this.playerList, n);
  }

  // ======================================================================================
  // Container windows
  // ======================================================================================
  openWindow(w: WindowUpdate) {
    if (this.gamemode === 'creative' && w.kind === 'player') return this.openCreative(w);
    const s = this.openScreen('window', 'container-screen');
    this.window = w;
    this.windowSlots = [];
    const panel = h('div', 'panel', s);
    const slotEl = (parent: HTMLElement, index: number, big = false, placeholder?: string) => {
      const el = h('div', `slot${big ? ' big' : ''}`, parent);
      el.dataset.index = String(index);
      if (placeholder) {
        const p = h('img', 'placeholder', el);
        p.src = placeholder;
      }
      this.windowSlots[index] = el;
      this.bindSlot(el, index);
      return el;
    };
    const grid = (parent: HTMLElement, start: number, cols: number, rows: number) => {
      const g = h('div', 'slot-grid', parent);
      g.style.gridTemplateColumns = `repeat(${cols}, calc(18px * var(--ui-scale)))`;
      for (let i = 0; i < cols * rows; i++) slotEl(g, start + i);
      return g;
    };
    const invSection = (mainStart: number) => {
      h('div', 'title', panel, 'Inventory').style.marginTop = 'calc(3px * var(--ui-scale))';
      grid(panel, mainStart, 9, 3);
      h('div', 'hotbar-gap', panel);
      grid(panel, mainStart + 27, 9, 1);
    };
    const arrowImg = (parent: HTMLElement) => {
      const a = h('img', 'arrow', parent);
      a.src = HUD_ICONS.arrowEmpty;
      a.style.margin = '0 calc(8px * var(--ui-scale))';
      return a;
    };
    if (w.kind === 'player') {
      const top = h('div', 'row', panel);
      top.style.alignItems = 'flex-start';
      const armorCol = h('div', 'col', top);
      for (let i = 0; i < 4; i++) slotEl(armorCol, 5 + i);
      const prev = h('div', 'player-preview', top);
      prev.style.margin = `0 calc(4px * var(--ui-scale))`;
      prev.id = 'player-preview';
      const craft = h('div', 'col', top);
      craft.style.marginLeft = 'calc(10px * var(--ui-scale))';
      h('div', 'title', craft, 'Crafting');
      const cr = h('div', 'row', craft);
      grid(cr, 1, 2, 2);
      arrowImg(cr);
      slotEl(cr, 0, true);
      invSection(9);
    } else if (w.kind === 'crafting_table') {
      h('div', 'title', panel, 'Crafting');
      const cr = h('div', 'row', panel);
      cr.style.marginLeft = 'calc(22px * var(--ui-scale))';
      cr.style.marginBottom = 'calc(4px * var(--ui-scale))';
      grid(cr, 1, 3, 3);
      arrowImg(cr);
      slotEl(cr, 0, true);
      invSection(10);
    } else if (w.kind === 'furnace') {
      h('div', 'title', panel, 'Furnace');
      const row = h('div', 'row', panel);
      row.style.marginLeft = 'calc(48px * var(--ui-scale))';
      row.style.marginBottom = 'calc(6px * var(--ui-scale))';
      const col = h('div', 'col', row);
      col.style.alignItems = 'center';
      slotEl(col, 0);
      const flame = h('img', 'flame', col);
      flame.id = 'furnace-flame';
      flame.src = HUD_ICONS.flameEmpty;
      flame.style.margin = 'calc(2px * var(--ui-scale)) 0';
      slotEl(col, 1);
      const arrWrap = h('div', '', row);
      arrWrap.style.position = 'relative';
      arrWrap.style.margin = '0 calc(12px * var(--ui-scale))';
      const a1 = h('img', 'arrow', arrWrap);
      a1.src = HUD_ICONS.arrowEmpty;
      const a2 = h('img', 'arrow', arrWrap);
      a2.src = HUD_ICONS.arrowFull;
      a2.id = 'furnace-arrow';
      a2.style.position = 'absolute';
      a2.style.left = '0';
      a2.style.top = '0';
      a2.style.clipPath = 'inset(0 100% 0 0)';
      slotEl(row, 2, true);
      invSection(3);
    } else if (w.kind === 'chest') {
      h('div', 'title', panel, 'Chest');
      grid(panel, 0, 9, 3);
      invSection(27);
    }
    this.updateWindow(w);
  }

  private updateFurnaceProgress() {
    const p = this.window?.props;
    if (!p) return;
    const arrow = document.getElementById('furnace-arrow');
    const flame = document.getElementById('furnace-flame') as HTMLImageElement | null;
    if (arrow) arrow.style.clipPath = `inset(0 ${100 - Math.round(p[0] * 100)}% 0 0)`;
    if (flame) {
      flame.src = p[1] > 0 ? HUD_ICONS.flame : HUD_ICONS.flameEmpty;
      flame.style.clipPath = p[1] > 0 ? `inset(${100 - Math.round(p[1] * 100)}% 0 0 0)` : '';
    }
  }

  updateWindow(w: WindowUpdate) {
    if (!this.window) {
      return;
    }
    if (this.screenName === 'creative') {
      this.window = w;
      this.updateCreative();
      return;
    }
    if (w.id !== this.window.id) return;
    this.window = w;
    w.slots.forEach((s, i) => {
      const el = this.windowSlots[i];
      if (el) this.renderStack(el, s);
    });
    this.renderCursor(w.cursor);
    this.updateFurnaceProgress();
  }

  private renderCursor(c: ItemStack | null) {
    this.cursorEl.classList.toggle('hidden', !c);
    this.renderStack(this.cursorEl, c);
    if (c) this.tooltip.classList.add('hidden');
  }

  private bindSlot(el: HTMLElement, index: number, windowId?: () => number) {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const w = this.window;
      if (!w) return;
      const wid = windowId ? windowId() : w.id;
      const button = e.button === 2 ? 1 : 0;
      if (e.shiftKey) {
        this.handlers.click(wid, index, button, true);
        this.handlers.uiSound();
        return;
      }
      if (w.cursor) {
        this.dragging = { button, slots: [index] };
        return;
      }
      this.handlers.click(wid, index, button, false);
    });
    el.addEventListener('mouseenter', () => {
      if (this.dragging && !this.dragging.slots.includes(index)) this.dragging.slots.push(index);
      this.hoverIndex = index;
      this.showTooltipFor(this.window?.slots[index] ?? null);
    });
    el.addEventListener('mouseleave', () => {
      this.hoverIndex = -1;
      this.tooltip.classList.add('hidden');
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  hoverIndex = -1;

  private endDrag(_e: MouseEvent) {
    const d = this.dragging;
    this.dragging = null;
    if (!d || !this.window) return;
    const wid = this.screenName === 'creative' ? 0 : this.window.id;
    if (d.slots.length > 1) this.handlers.drag(wid, d.slots, d.button);
    else this.handlers.click(wid, d.slots[0], d.button, false);
  }

  private showTooltipFor(s: ItemStack | null) {
    if (!s || this.window?.cursor) {
      this.tooltip.classList.add('hidden');
      return;
    }
    const def = itemDef(s.id);
    this.tooltip.innerHTML = '';
    h('div', '', this.tooltip, def.displayName);
    const tool = def.tool;
    if (tool?.damage && tool.type !== 'none') h('div', 'sub', this.tooltip, `${tool.damage} Attack Damage`);
    if (def.armor) h('div', 'sub', this.tooltip, `+${def.armor.defense} Armor`);
    const maxDur = tool?.durability ?? def.armor?.durability;
    if (maxDur && s.damage) h('div', 'sub', this.tooltip, `Durability: ${maxDur - s.damage} / ${maxDur}`);
    if (def.food) h('div', 'sub', this.tooltip, `Restores ${def.food.hunger / 2} hunger`);
    this.tooltip.classList.remove('hidden');
    this.positionTooltip();
  }

  private positionTooltip() {
    if (this.tooltip.classList.contains('hidden')) return;
    this.tooltip.style.left = `${this.mouse.x + 14}px`;
    this.tooltip.style.top = `${this.mouse.y - 18}px`;
  }

  // ---- Creative inventory ----
  private creativeItemsList(): number[] {
    const all = creativeItems();
    const q = this.creativeSearch.toLowerCase();
    if (this.creativeTab === 4 || q) return all.filter((id) => itemDef(id).displayName.toLowerCase().includes(q));
    const cat = (id: number) => {
      const d = itemDef(id);
      if (d.block) {
        const n = d.name;
        if (d.block.shape === 'cross' || d.block.shape === 'torch' || n.includes('glass') || n.includes('wool') || n.includes('leaves') || n.includes('sapling') || ['crafting_table', 'furnace', 'chest', 'bookshelf', 'ladder', 'tnt', 'glowstone', 'jack_o_lantern', 'pumpkin', 'melon', 'cactus', 'lantern', 'snow', 'ice'].includes(n)) return 1;
        return 0;
      }
      if (d.tool || d.armor || ['arrow', 'bow', 'bucket', 'water_bucket', 'lava_bucket', 'flint_and_steel', 'shears'].includes(d.name)) return 2;
      return 3;
    };
    return all.filter((id) => cat(id) === this.creativeTab);
  }

  openCreative(w: WindowUpdate) {
    const s = this.openScreen('creative', 'container-screen');
    this.window = w;
    this.windowSlots = [];
    const wrap = h('div', 'col', s);
    const tabs = h('div', 'creative-tabs', wrap);
    const tabIcons = ['bricks', 'poppy', 'iron_sword', 'apple', 'compass'];
    const tabNames = ['Building Blocks', 'Decoration Blocks', 'Tools & Combat', 'Food & Materials', 'Search Items'];
    tabNames.forEach((name, i) => {
      const t = h('div', `creative-tab${i === this.creativeTab ? ' active' : ''}`, tabs);
      t.title = name;
      const icon = ITEMS.find((it) => it?.name === tabIcons[i]);
      if (icon && this.icons) {
        const img = h('img', 'item-icon', t);
        img.src = this.icons.icon(icon.id);
      } else h('span', '', t, '?').style.color = '#404040';
      t.addEventListener('click', () => {
        this.creativeTab = i;
        this.handlers.uiSound();
        this.openCreative(this.window!);
      });
    });
    const panel = h('div', 'panel', wrap);
    const head = h('div', 'row', panel);
    head.style.justifyContent = 'space-between';
    h('div', 'title', head, tabNames[this.creativeTab]);
    if (this.creativeTab === 4) {
      const search = h('input', 'search', head);
      search.value = this.creativeSearch;
      search.placeholder = 'Search...';
      setTimeout(() => search.focus(), 0);
      search.addEventListener('input', () => {
        this.creativeSearch = search.value;
        this.fillCreativeGrid(grid);
      });
      search.addEventListener('keydown', (e) => e.stopPropagation());
    }
    const scroll = h('div', 'creative-scroll', panel);
    const grid = h('div', 'slot-grid', scroll);
    grid.style.gridTemplateColumns = 'repeat(9, calc(18px * var(--ui-scale)))';
    this.fillCreativeGrid(grid);
    h('div', 'hotbar-gap', panel);
    const bottom = h('div', 'row', panel);
    const hot = h('div', 'slot-grid', bottom);
    hot.style.gridTemplateColumns = 'repeat(9, calc(18px * var(--ui-scale)))';
    for (let i = 0; i < 9; i++) {
      const el = h('div', 'slot', hot);
      this.windowSlots[36 + i] = el;
      this.bindSlot(el, 36 + i, () => 0);
    }
    const trash = h('div', 'slot', bottom);
    trash.style.marginLeft = 'calc(4px * var(--ui-scale))';
    trash.title = 'Destroy Item';
    trash.style.background = '#7a3030';
    trash.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.shiftKey) {
        for (let i = 0; i < 36; i++) this.handlers.creativeSet(i, null);
      } else this.handlers.creativeSet(-1, null);
    });
    this.updateCreative();
  }

  private fillCreativeGrid(grid: HTMLElement) {
    grid.innerHTML = '';
    const list = this.creativeItemsList();
    const n = Math.max(45, Math.ceil(list.length / 9) * 9);
    for (let i = 0; i < n; i++) {
      const el = h('div', 'slot', grid);
      const id = list[i];
      if (id === undefined) continue;
      this.renderStack(el, { id, count: 1 });
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const w = this.window;
        if (!w) return;
        if (w.cursor) {
          this.handlers.creativeSet(-1, null);
          return;
        }
        const max = itemDef(id).stackSize;
        if (e.shiftKey) this.handlers.creativeSet(-2, { id, count: max });
        else this.handlers.creativeSet(-1, { id, count: e.button === 2 ? 1 : e.button === 1 ? max : max });
        this.handlers.uiSound();
      });
      el.addEventListener('mouseenter', () => this.showTooltipFor({ id, count: 1 }));
      el.addEventListener('mouseleave', () => this.tooltip.classList.add('hidden'));
    }
  }

  private updateCreative() {
    const w = this.window!;
    for (let i = 0; i < 9; i++) {
      const el = this.windowSlots[36 + i];
      if (el) this.renderStack(el, w.slots[36 + i] ?? null);
    }
    this.renderCursor(w.cursor);
  }
}

/** Big blocky title logo rendered from the pixel font glyphs with a stone texture and 3D extrusion. */
function renderLogo(line1: string, line2: string, stone: HTMLCanvasElement | null): HTMLCanvasElement {
  const px = 4; // pixels per glyph pixel
  const lines = [line1, line2];
  const widthOf = (s: string) => [...s].reduce((a, ch) => a + ((GLYPHS[ch]?.[0]?.length ?? 5) + 1), 0);
  const W = Math.max(...lines.map(widthOf)) * px * 2 + 40;
  const H = 2 * 9 * px * 2 + 40;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const pattern = stone ? ctx.createPattern(stone, 'repeat') : null;
  lines.forEach((line, li) => {
    const scale = li === 0 ? 2 : 1.3;
    const lw = widthOf(line) * px * scale;
    let x = (W - lw) / 2;
    const y0 = 8 + li * 9 * px * 2.1;
    for (const ch of line) {
      const g = GLYPHS[ch];
      if (!g) { x += 5 * px * scale; continue; }
      const gw = g[0].length;
      for (let depth = 5; depth >= 0; depth--) {
        g.forEach((row, ry) => {
          for (let rx = 0; rx < row.length; rx++) {
            if (row[rx] !== '#') continue;
            const bx = x + rx * px * scale + depth * scale, by = y0 + ry * px * scale + depth * scale;
            if (depth > 0) {
              ctx.fillStyle = depth === 5 ? '#000' : `rgb(${40 + depth * 6},${40 + depth * 6},${40 + depth * 6})`;
              ctx.fillRect(bx, by, px * scale + 1, px * scale + 1);
            } else {
              ctx.fillStyle = pattern ?? '#888';
              ctx.fillRect(bx, by, px * scale, px * scale);
              ctx.fillStyle = 'rgba(255,255,255,0.18)';
              ctx.fillRect(bx, by, px * scale, 1);
            }
          }
        });
      }
      x += (gw + 1) * px * scale;
    }
  });
  return c;
}
