import { loadPixelFont } from './ui/pixelFont';
import { UI, ClientSettings } from './ui/ui';
import { DEFAULT_SETTINGS } from './render/renderer';
import { buildAtlas } from './render/atlas';
import { SoundEngine } from './audio/sound';
import { ClientGame } from './game/clientGame';
import { defaultServerUrl } from './net/connection';

const STORAGE_KEY = 'mcai-settings-v1';

function loadSettings(): ClientSettings {
  const defaults: ClientSettings = {
    ...DEFAULT_SETTINGS,
    sensitivity: 1,
    master: 0.8,
    music: 0.5,
    sfx: 1,
    guiScale: 0,
    name: `Player${Math.floor(Math.random() * 900 + 100)}`,
    server: defaultServerUrl(),
    viewBobbing: true,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return defaults;
}

function saveSettings(s: ClientSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function textureCanvas(name: string): HTMLCanvasElement | null {
  const px = buildAtlas().pixels.get(name);
  if (!px) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(16, 16);
  img.data.set(px);
  ctx.putImageData(img, 0, 0);
  return c;
}

async function main() {
  await loadPixelFont();
  const settings = loadSettings();
  const sound = new SoundEngine();
  sound.setVolumes({ master: settings.master, music: settings.music, sfx: settings.sfx });
  window.addEventListener('pointerdown', () => sound.unlock(), { once: false });
  window.addEventListener('keydown', () => sound.unlock(), { once: true });
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const dirt = textureCanvas('dirt')?.toDataURL() ?? null;
  const stone = textureCanvas('stone');

  let game: ClientGame | null = null;
  const ui: UI = new UI(settings, {
    play: async (name, server) => {
      sound.unlock();
      ui.showMessage('Connecting to the server...', server, dirt);
      if (game) game.dispose();
      game = new ClientGame(canvas, ui, settings, sound);
      (window as unknown as { game: ClientGame }).game = game;
      game.onExit = (reason) => {
        ui.showHud(false);
        ui.showMessage('Disconnected', reason, dirt, () => ui.showTitle(dirt, stone));
        sound.stopMusic();
      };
      try {
        await game.connect(server, name);
      } catch (e) {
        ui.showMessage('Failed to connect to the server', (e as Error).message, dirt, () => ui.showTitle(dirt, stone));
      }
    },
    resume: () => game?.resume(),
    disconnect: () => {
      game?.stop('Disconnected');
      ui.showHud(false);
      ui.showTitle(dirt, stone);
    },
    respawn: () => game?.respawn(),
    settingsChanged: (s) => {
      saveSettings(s);
      game?.applySettings(s);
      sound.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    },
    click: (w, slot, button, shift) => {
      game?.conn.send({ t: 'click', w, slot, button, shift });
      if (shift) sound.play('click', { volume: 0.2 });
    },
    drag: (w, slots, button) => game?.conn.send({ t: 'drag', w, slots, button }),
    closeWindow: () => game?.closeScreen(),
    creativeSet: (slot, item) => game?.conn.send({ t: 'creative', slot, item }),
    chat: (text) => game?.conn.send({ t: 'chat', text }),
    uiSound: () => sound.play('click', { volume: 0.5 }),
  });
  ui.showTitle(dirt, stone);

  // Auto-join for automated testing: ?autojoin=Name
  const params = new URLSearchParams(location.search);
  const auto = params.get('autojoin');
  if (auto) {
    settings.name = auto;
    const srv = params.get('server') ?? settings.server;
    setTimeout(() => (ui as unknown as { handlers: { play: (n: string, s: string) => void } }).handlers.play(auto, srv), 50);
  }
}

main();
