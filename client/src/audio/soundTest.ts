/**
 * Sound audition page (open /sound-test.html with `npm run dev:client`).
 * Lists a button for every sound so a human can check the synthesis by ear.
 */

import { SoundEngine } from './sound';
import { MATERIALS, MOBS, SOUND_NAMES } from './sfx';

const engine = new SoundEngine();
engine.setListener(0, 0, 0, 0, 0);

const state = {
  volume: 1,
  pitch: 1,
  pos: 'center' as keyof typeof POSITIONS,
};

const POSITIONS = {
  center: null,
  front: [0, 0, -5],
  left: [-6, 0, 0],
  right: [6, 0, 0],
  behind: [0, 0, 6],
  above: [0, 6, -1],
  far: [0, 0, -24],
} as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
}

function play(name: string): void {
  engine.unlock();
  const p = POSITIONS[state.pos];
  engine.play(name, p ? { x: p[0], y: p[1], z: p[2], volume: state.volume, pitch: state.pitch } : { volume: state.volume, pitch: state.pitch });
}

function soundButton(name: string, label = name): HTMLButtonElement {
  const b = el('button', { textContent: label, title: name });
  b.addEventListener('click', () => play(name));
  return b;
}

function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void): HTMLLabelElement {
  const out = el('span', { textContent: value.toFixed(2) });
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = v.toFixed(2);
    onInput(v);
  });
  return el('label', { className: 'slider' }, label + ' ', input, ' ', out);
}

function section(title: string, ...content: Node[]): HTMLElement {
  return el('section', {}, el('h2', { textContent: title }), ...content);
}

const root = document.getElementById('app') ?? document.body;

// --- controls ---------------------------------------------------------------
const posSelect = el('select');
for (const k of Object.keys(POSITIONS)) posSelect.append(el('option', { value: k, textContent: k }));
posSelect.addEventListener('change', () => {
  state.pos = posSelect.value as keyof typeof POSITIONS;
});

const underwater = el('input', { type: 'checkbox' });
underwater.addEventListener('change', () => {
  engine.unlock();
  engine.setUnderwater(underwater.checked);
});

const status = el('div', { className: 'status', textContent: 'Click anything to unlock audio.' });

const musicStart = el('button', { textContent: 'startMusic() (20-40s delay)' });
musicStart.addEventListener('click', () => {
  engine.unlock();
  engine.startMusic();
});
const musicNow = el('button', { textContent: 'Play a piece now' });
musicNow.addEventListener('click', () => {
  engine.unlock();
  engine.playMusicNow();
});
const musicStop = el('button', { textContent: 'stopMusic()' });
musicStop.addEventListener('click', () => engine.stopMusic());

let caveSim: ReturnType<typeof setInterval> | null = null;
const caveBtn = el('button', { textContent: 'Simulate deep dark cave (updateAmbience)' });
caveBtn.addEventListener('click', () => {
  engine.unlock();
  if (caveSim) {
    clearInterval(caveSim);
    caveSim = null;
    caveBtn.textContent = 'Simulate deep dark cave (updateAmbience)';
    return;
  }
  caveBtn.textContent = 'Stop cave simulation';
  caveSim = setInterval(() => engine.updateAmbience({ depthBelowSurface: 40, skyLight: 0, inWater: false }), 250);
});

let stepTimer: ReturnType<typeof setInterval> | null = null;
function walk(material: string): void {
  engine.unlock();
  if (stepTimer) clearInterval(stepTimer);
  let n = 0;
  stepTimer = setInterval(() => {
    play(`step_${material}`);
    if (++n >= 8 && stepTimer) {
      clearInterval(stepTimer);
      stepTimer = null;
    }
  }, 380);
}

function mine(material: string): void {
  engine.unlock();
  let n = 0;
  const timer = setInterval(() => {
    if (n < 5) play(`dig_${material}`);
    else {
      play(`break_${material}`);
      clearInterval(timer);
    }
    n++;
  }, 250);
}

root.append(
  el('h1', { textContent: 'Procedural Sound Test' }),
  el('p', { textContent: 'Every sound below is synthesised at runtime with the Web Audio API. Listener sits at the origin facing -Z.' }),
  section(
    'Mix & playback',
    slider('master', 0, 1, 0.01, 1, (v) => engine.setVolumes({ master: v })),
    slider('music', 0, 1, 0.01, 1, (v) => engine.setVolumes({ music: v })),
    slider('sfx', 0, 1, 0.01, 1, (v) => engine.setVolumes({ sfx: v })),
    el('br'),
    slider('play volume', 0, 2, 0.01, 1, (v) => (state.volume = v)),
    slider('play pitch', 0.5, 2, 0.01, 1, (v) => (state.pitch = v)),
    el('label', {}, 'position ', posSelect),
    el('label', {}, ' underwater ', underwater),
  ),
  section('Music & ambience', musicStart, musicNow, musicStop, caveBtn, soundButton('ambient_cave'), soundButton('water_ambient', 'water_ambient (one-shot of loop)')),
);

// Block materials grid
const table = el('table');
const head = el('tr', {}, el('th', { textContent: 'material' }));
for (const k of ['break', 'place', 'dig', 'step', 'walk x8', 'mine']) head.append(el('th', { textContent: k }));
table.append(head);
for (const m of MATERIALS) {
  const row = el('tr', {}, el('td', { textContent: m }));
  for (const k of ['break', 'place', 'dig', 'step']) row.append(el('td', {}, soundButton(`${k}_${m}`, k)));
  const w = el('button', { textContent: 'walk' });
  w.addEventListener('click', () => walk(m));
  const mi = el('button', { textContent: 'mine' });
  mi.addEventListener('click', () => mine(m));
  row.append(el('td', {}, w), el('td', {}, mi));
  table.append(row);
}
root.append(section('Blocks', table));

// Mobs grid
const mobTable = el('table');
for (const m of MOBS) {
  mobTable.append(el('tr', {}, el('td', { textContent: m }), el('td', {}, soundButton(m, 'idle')), el('td', {}, soundButton(`${m}_hurt`, 'hurt')), el('td', {}, soundButton(`${m}_death`, 'death'))));
}
root.append(section('Mobs', mobTable));

// Everything else
const covered = new Set<string>(['ambient_cave', 'water_ambient']);
for (const m of MATERIALS) for (const k of ['break', 'place', 'dig', 'step']) covered.add(`${k}_${m}`);
for (const m of MOBS) for (const s of ['', '_hurt', '_death']) covered.add(`${m}${s}`);
const misc = el('div', { className: 'grid' });
for (const n of SOUND_NAMES) if (!covered.has(n)) misc.append(soundButton(n));
const unknown = el('button', { textContent: 'unknown name (console.debug once)' });
unknown.addEventListener('click', () => play('does_not_exist'));
misc.append(unknown);
root.append(section('General', misc));

const tntBtn = el('button', { textContent: 'TNT sequence (fuse -> explode)' });
tntBtn.addEventListener('click', () => {
  play('fuse');
  setTimeout(() => play('explode'), 1500);
});
root.append(section('Sequences', tntBtn));

root.append(status);
setInterval(() => {
  status.textContent = `music: ${engine.musicStatus()} | voices: ${engine.activeVoices} | cached sfx buffers: ${engine.cachedBuffers}`;
}, 500);

document.addEventListener('pointerdown', () => engine.unlock(), { once: true });
