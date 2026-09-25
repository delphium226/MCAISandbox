/**
 * Procedural sound-effect recipes. Every generator is pure math (see dsp.ts)
 * and returns a mono Float32Array normalised to a safe peak.
 *
 * Each named sound renders several variants with different random seeds and
 * parameters; the engine picks one at random and adds a little pitch jitter,
 * so repeated sounds never sound identical (just like Minecraft's 4-6 sample
 * variants per sound event).
 */

import {
  type Rng,
  addBubble,
  addCrunch,
  addMode,
  addNoiseBurst,
  addTone,
  adEnv,
  alloc,
  applyEnv,
  bell,
  brownNoise,
  curve,
  fadeIn,
  fadeOut,
  filter,
  formantPath,
  logRand,
  mixInto,
  normalize,
  onePoleHP,
  onePoleLP,
  pluck,
  rand,
  irand,
  saturate,
  SmoothRandom,
  sweep,
  trimTail,
  voice,
  whiteNoise,
  TAU,
} from './dsp';

export type Gen = (sr: number, rng: Rng, variant: number) => Float32Array;

export interface SfxDef {
  gen: Gen;
  /** Number of pre-rendered variants. */
  variants: number;
  /** Base playback gain (buffers are peak-normalised, so this sets loudness). */
  gain: number;
  /** Random +- playback-rate variation applied on every play. */
  pitchVar: number;
  /** Send level into the shared reverb (0..1). */
  reverb?: number;
  /** Max audible distance for positional playback (blocks). */
  maxDist?: number;
  /** Optional cap on render sample rate (low-frequency sounds can use less). */
  rate?: number;
  /** Loop the buffer (ambient beds). */
  loop?: boolean;
  /** Higher = more important when voices must be stolen. */
  priority?: number;
}

export const MATERIALS = ['stone', 'wood', 'gravel', 'grass', 'sand', 'glass', 'cloth', 'snow', 'metal'] as const;
export type Material = (typeof MATERIALS)[number];
export const MOBS = ['pig', 'cow', 'sheep', 'chicken', 'zombie', 'skeleton', 'creeper', 'spider'] as const;
export type Mob = (typeof MOBS)[number];

type Kind = 'break' | 'dig' | 'step' | 'place';

const PEAK = 0.9;

function done(buf: Float32Array, sr: number, hp = 25): Float32Array {
  onePoleHP(buf, sr, hp); // remove DC / sub rumble that would waste headroom
  fadeOut(buf, sr, 0.004);
  return normalize(trimTail(buf, sr), PEAK);
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** Low "body" thump: exponentially falling sine + lowpassed noise. */
function thump(out: Float32Array, sr: number, rng: Rng, at: number, f0: number, f1: number, tau: number, amp: number): void {
  addTone(
    out, sr, at, tau * 7,
    (t) => f1 + (f0 - f1) * Math.exp(-t / (tau * 0.6)),
    (t) => amp * adEnv(t, 0.002, tau),
  );
  addNoiseBurst(out, sr, rng, at, { tau: tau * 0.5, amp: amp * 0.6, type: 'lp', f: f0 * 4, q: 0.7 });
}

/** Wooden knock: impulse-excited damped modes + hollow resonance. */
function knock(out: Float32Array, sr: number, rng: Rng, at: number, f0: number, amp: number, damp = 1): void {
  const ratios = [1, rand(rng, 1.7, 2.1), rand(rng, 2.6, 3.1), rand(rng, 3.9, 4.5), rand(rng, 5.3, 6.2)];
  const taus = [0.07, 0.045, 0.03, 0.02, 0.013];
  const amps = [1, 0.7, 0.45, 0.3, 0.2];
  for (let k = 0; k < ratios.length; k++) {
    addMode(out, sr, at, f0 * (ratios[k] as number), amp * (amps[k] as number) * rand(rng, 0.7, 1.1), (taus[k] as number) * damp, rng() * TAU);
  }
  // hollow cavity resonance + contact click
  addNoiseBurst(out, sr, rng, at, { tau: 0.012 * damp, amp: amp * 0.8, type: 'bp', f: f0 * rand(rng, 1.3, 1.7), q: 5 });
  addNoiseBurst(out, sr, rng, at, { tau: 0.0025, amp: amp * 0.5, type: 'hp', f: 1500, q: 0.7 });
}

/** Continuous shaped hiss (sand, water, fuses). */
function hiss(out: Float32Array, sr: number, rng: Rng, at: number, dur: number, fc: number, q: number, env: (t: number) => number, amp: number, grit = 0.4): void {
  const n = Math.ceil(dur * sr);
  const g = whiteNoise(n, rng);
  filter(g, sr, 'bp', fc, q);
  const sm = new SmoothRandom(rng, sr, 60);
  for (let i = 0; i < n; i++) g[i] = (g[i] as number) * env(i / sr) * (1 - grit + grit * Math.abs(sm.next()) * 1.6);
  mixInto(out, g, sr, at, amp);
}

/** Friction creak (door hinges, chests): jittered impulse train through wooden body resonances. */
function creak(out: Float32Array, sr: number, rng: Rng, at: number, dur: number, rate: (t: number) => number, fBody: number, amp: number): void {
  const n = Math.ceil(dur * sr);
  const exc = new Float32Array(n);
  let next = 0;
  while (next < dur) {
    const i = Math.floor(next * sr);
    const env = bell(next, dur, 0.15, 0.3);
    exc[i] = (exc[i] as number) + env * rand(rng, 0.5, 1) * (rng() < 0.5 ? 1 : -1);
    next += (1 / Math.max(5, rate(next))) * rand(rng, 0.85, 1.15);
  }
  const body = new Float32Array(n);
  const modes = [1, 2.05, 3.3, 5.1];
  const gains = [1, 0.8, 0.5, 0.3];
  for (let k = 0; k < modes.length; k++) {
    const b = exc.slice();
    filter(b, sr, 'bp', fBody * (modes[k] as number) * rand(rng, 0.95, 1.05), 12);
    for (let i = 0; i < n; i++) body[i] = (body[i] as number) + (b[i] as number) * (gains[k] as number);
  }
  mixInto(out, body, sr, at, amp);
}

/** Rattling clicks (skeleton bones). */
function rattle(out: Float32Array, sr: number, rng: Rng, at: number, dur: number, count: number, amp: number, bounce = false): void {
  let t = 0;
  for (let k = 0; k < count; k++) {
    if (bounce) {
      // falling bones: intervals shrink like a bouncing object
      t += Math.max(0.012, (dur / count) * 2 * Math.pow(1 - k / count, 1.3) * rand(rng, 0.5, 1.4));
    } else {
      t = dur * Math.pow(rng(), 1.2);
    }
    if (t > dur) break;
    const a = amp * rand(rng, 0.35, 1) * (bounce ? Math.pow(1 - k / count, 0.7) : 1);
    const f = logRand(rng, 1100, 3400);
    addMode(out, sr, at + t, f, a, rand(rng, 0.006, 0.018));
    addMode(out, sr, at + t, f * rand(rng, 1.6, 2.4), a * 0.5, rand(rng, 0.004, 0.01));
    if (rng() < 0.4) addMode(out, sr, at + t, logRand(rng, 450, 900), a * 0.6, rand(rng, 0.01, 0.025));
    addNoiseBurst(out, sr, rng, at + t, { tau: 0.0015, amp: a * 0.5, type: 'hp', f: 2000 });
  }
}

/** Raspy chitter (spiders, creepers): noise gated by a fast pulse train. */
function chitter(out: Float32Array, sr: number, rng: Rng, at: number, dur: number, rateHz: (t: number) => number, fc: number, amp: number): void {
  let t = 0;
  while (t < dur) {
    const a = amp * bell(t, dur, 0.1, 0.4) * rand(rng, 0.5, 1);
    addNoiseBurst(out, sr, rng, at + t, { tau: 0.0035, amp: a, type: 'bp', f: fc * rand(rng, 0.8, 1.25), q: 2.5 });
    addMode(out, sr, at + t, fc * rand(rng, 0.9, 1.1), a * 0.35, 0.004);
    t += (1 / Math.max(5, rateHz(t))) * rand(rng, 0.8, 1.2);
  }
}

// ---------------------------------------------------------------------------
// Block materials
// ---------------------------------------------------------------------------

function matStone(sr: number, rng: Rng, kind: Kind): Float32Array {
  const shift = rand(rng, 0.85, 1.2);
  const cfg = {
    break: { span: 0.22, grains: 22, thumpAmp: 0.9, dur: 0.45 },
    dig: { span: 0.08, grains: 9, thumpAmp: 0.6, dur: 0.18 },
    step: { span: 0.06, grains: 6, thumpAmp: 0.45, dur: 0.14 },
    place: { span: 0.1, grains: 10, thumpAmp: 1.0, dur: 0.22 },
  }[kind];
  const out = alloc(sr, cfg.dur);
  addCrunch(out, sr, rng, 0, { span: cfg.span, grains: cfg.grains, fLo: 500 * shift, fHi: 3200 * shift, q: [0.9, 2.5], len: [0.004, 0.022], decay: 0.45 });
  addCrunch(out, sr, rng, 0, { span: cfg.span * 0.7, grains: Math.ceil(cfg.grains / 3), fLo: 3500, fHi: 7500, q: [1, 2], len: [0.002, 0.008], gain: 0.35 });
  addNoiseBurst(out, sr, rng, 0, { tau: 0.025, amp: cfg.thumpAmp, type: 'lp', f: 380 * shift, q: 1.2, type2: 'hp', f2: 90 });
  if (kind === 'break') addCrunch(out, sr, rng, 0.05, { span: 0.2, grains: 10, fLo: 300, fHi: 1400, q: [1, 2], len: [0.006, 0.02], gain: 0.5 });
  return done(out, sr, 60);
}

function matGravel(sr: number, rng: Rng, kind: Kind): Float32Array {
  const shift = rand(rng, 0.85, 1.15);
  const cfg = {
    break: { span: 0.3, grains: 50, dur: 0.45, thump: 0.5 },
    dig: { span: 0.12, grains: 18, dur: 0.2, thump: 0.35 },
    step: { span: 0.12, grains: 16, dur: 0.18, thump: 0.25 },
    place: { span: 0.14, grains: 20, dur: 0.22, thump: 0.6 },
  }[kind];
  const out = alloc(sr, cfg.dur);
  addCrunch(out, sr, rng, 0, { span: cfg.span, grains: cfg.grains, fLo: 250 * shift, fHi: 1800 * shift, q: [1, 3], len: [0.003, 0.014], decay: 0.55, skew: 1.2 });
  addCrunch(out, sr, rng, 0, { span: cfg.span, grains: Math.ceil(cfg.grains / 3), fLo: 1800, fHi: 4500, q: [1, 2], len: [0.002, 0.006], decay: 0.5, gain: 0.35 });
  addNoiseBurst(out, sr, rng, 0, { tau: 0.03, amp: cfg.thump, type: 'lp', f: 300, q: 0.8 });
  return done(out, sr, 60);
}

function matGrass(sr: number, rng: Rng, kind: Kind): Float32Array {
  const shift = rand(rng, 0.85, 1.2);
  const cfg = {
    break: { span: 0.28, grains: 45, dur: 0.42 },
    dig: { span: 0.12, grains: 16, dur: 0.2 },
    step: { span: 0.12, grains: 14, dur: 0.18 },
    place: { span: 0.14, grains: 18, dur: 0.22 },
  }[kind];
  const out = alloc(sr, cfg.dur);
  // leafy rustle crunch: bright, fairly broadband grains
  addCrunch(out, sr, rng, 0, { span: cfg.span, grains: cfg.grains, fLo: 1300 * shift, fHi: 7000 * shift, q: [0.7, 1.8], len: [0.004, 0.022], decay: 0.6, skew: 1.1 });
  addCrunch(out, sr, rng, 0, { span: cfg.span * 0.8, grains: Math.ceil(cfg.grains / 4), fLo: 400, fHi: 1200, q: [0.8, 1.5], len: [0.006, 0.02], gain: 0.5 });
  if (kind === 'place' || kind === 'break') addNoiseBurst(out, sr, rng, 0, { tau: 0.02, amp: 0.35, type: 'lp', f: 350 });
  return done(out, sr, 200);
}

function matSand(sr: number, rng: Rng, kind: Kind): Float32Array {
  const fc = rand(rng, 2600, 4200);
  const cfg = {
    break: { dur: 0.36, att: 0.02, tau: 0.09, grains: 14 },
    dig: { dur: 0.16, att: 0.01, tau: 0.04, grains: 5 },
    step: { dur: 0.17, att: 0.015, tau: 0.045, grains: 4 },
    place: { dur: 0.2, att: 0.01, tau: 0.05, grains: 6 },
  }[kind];
  const out = alloc(sr, cfg.dur + 0.05);
  hiss(out, sr, rng, 0, cfg.dur, fc, 0.6, (t) => adEnv(t, cfg.att, cfg.tau), 1, 0.55);
  addCrunch(out, sr, rng, 0, { span: cfg.dur * 0.6, grains: cfg.grains, fLo: 1200, fHi: 4000, q: [0.8, 1.5], len: [0.004, 0.012], gain: 0.25 });
  onePoleLP(out, sr, 7000);
  return done(out, sr, 300);
}

function matSnow(sr: number, rng: Rng, kind: Kind): Float32Array {
  const cfg = {
    break: { span: 0.22, grains: 30, dur: 0.34, squeak: 0.25 },
    dig: { span: 0.1, grains: 12, dur: 0.18, squeak: 0.15 },
    step: { span: 0.1, grains: 12, dur: 0.18, squeak: 0.2 },
    place: { span: 0.12, grains: 14, dur: 0.2, squeak: 0.1 },
  }[kind];
  const out = alloc(sr, cfg.dur);
  // compressive "crump" crunch – dense narrow grains in the low-mids
  addCrunch(out, sr, rng, 0, { span: cfg.span, grains: cfg.grains, fLo: 600, fHi: 2600, q: [1.5, 4], len: [0.002, 0.01], decay: 0.7, skew: 1 });
  const f = rand(rng, 1000, 1500);
  const sq = new SmoothRandom(rng, sr, 90);
  addTone(out, sr, rand(rng, 0.01, 0.04), 0.07, (t) => f * (1 + 0.08 * sq.next() + t * 2), (t) => cfg.squeak * bell(t, 0.07, 0.2, 0.5), 'tri');
  addNoiseBurst(out, sr, rng, 0, { tau: 0.03, amp: 0.25, type: 'lp', f: 500 });
  onePoleLP(out, sr, 5500);
  return done(out, sr, 120);
}

function matCloth(sr: number, rng: Rng, kind: Kind): Float32Array {
  const cfg = {
    break: { dur: 0.3, n: 3, tau: 0.05 },
    dig: { dur: 0.14, n: 1, tau: 0.04 },
    step: { dur: 0.13, n: 1, tau: 0.035 },
    place: { dur: 0.15, n: 1, tau: 0.045 },
  }[kind];
  const out = alloc(sr, cfg.dur);
  for (let k = 0; k < cfg.n; k++) {
    const at = k === 0 ? 0 : rand(rng, 0.03, 0.12);
    const amp = k === 0 ? 1 : rand(rng, 0.3, 0.6);
    addNoiseBurst(out, sr, rng, at, { attack: 0.006, tau: cfg.tau, amp, type: 'lp', f: rand(rng, 450, 800), q: 0.7, type2: 'lp', f2: 1200 });
    // soft fibrous rustle
    addNoiseBurst(out, sr, rng, at, { attack: 0.004, tau: cfg.tau * 0.6, amp: amp * 0.12, type: 'bp', f: rand(rng, 1500, 2500), q: 0.8 });
  }
  return done(out, sr, 70);
}

function matWood(sr: number, rng: Rng, kind: Kind): Float32Array {
  const out = alloc(sr, kind === 'break' ? 0.5 : 0.25);
  const f0 = rand(rng, 170, 260);
  switch (kind) {
    case 'break':
      knock(out, sr, rng, 0, f0, 1, 1.1);
      knock(out, sr, rng, rand(rng, 0.05, 0.09), f0 * rand(rng, 0.85, 1.15), 0.55, 0.9);
      addCrunch(out, sr, rng, 0.01, { span: 0.22, grains: 14, fLo: 800, fHi: 3500, q: [1.2, 3], len: [0.003, 0.012], gain: 0.55 });
      break;
    case 'dig':
      knock(out, sr, rng, 0, f0 * rand(rng, 0.95, 1.15), 1, 0.8);
      addCrunch(out, sr, rng, 0.004, { span: 0.05, grains: 4, fLo: 1200, fHi: 3500, q: [1.2, 3], len: [0.002, 0.008], gain: 0.3 });
      break;
    case 'step':
      knock(out, sr, rng, 0, f0 * rand(rng, 1.0, 1.25), 1, 0.6);
      onePoleLP(out, sr, 2200);
      break;
    case 'place':
      knock(out, sr, rng, 0, f0 * rand(rng, 0.7, 0.85), 1, 1.2);
      thump(out, sr, rng, 0, 150, 80, 0.03, 0.4);
      break;
  }
  return done(out, sr, 50);
}

function matGlass(sr: number, rng: Rng, kind: Kind): Float32Array {
  if (kind === 'break') {
    const out = alloc(sr, 1.0);
    // initial crack
    addNoiseBurst(out, sr, rng, 0, { tau: 0.012, amp: 1, type: 'hp', f: 1200 });
    addNoiseBurst(out, sr, rng, 0, { tau: 0.02, amp: 0.4, type: 'lp', f: 600 });
    // shards: many bright, short, inharmonic tinkles, denser at the start
    const shards = irand(rng, 55, 80);
    for (let k = 0; k < shards; k++) {
      const t = 0.004 + 0.65 * Math.pow(rng(), 2.2);
      const f = logRand(rng, 2200, 9500);
      const a = rand(rng, 0.08, 0.3) * Math.exp(-t / 0.3);
      const tau = rand(rng, 0.015, 0.09);
      addMode(out, sr, t, f, a, tau, rng() * TAU);
      addMode(out, sr, t, f * rand(rng, 1.4, 2.7), a * 0.4, tau * 0.6, rng() * TAU);
    }
    addCrunch(out, sr, rng, 0.005, { span: 0.4, grains: 30, fLo: 3000, fHi: 9000, q: [1, 3], len: [0.002, 0.01], decay: 0.35, gain: 0.5 });
    return done(out, sr, 200);
  }
  // Minecraft uses stone-like sounds for glass steps/placing; add a glassy tink.
  const out = alloc(sr, 0.2);
  const span = kind === 'step' ? 0.05 : 0.07;
  addCrunch(out, sr, rng, 0, { span, grains: 7, fLo: 900, fHi: 4500, q: [1.2, 3], len: [0.003, 0.012], decay: 0.5 });
  addNoiseBurst(out, sr, rng, 0, { tau: 0.018, amp: 0.6, type: 'lp', f: 500 });
  addMode(out, sr, 0.002, logRand(rng, 2500, 4500), kind === 'step' ? 0.08 : 0.2, 0.04);
  return done(out, sr, 80);
}

function matMetal(sr: number, rng: Rng, kind: Kind): Float32Array {
  const cfg = {
    break: { tau: 0.55, dur: 1.4, amp: 1, hits: 2 },
    dig: { tau: 0.16, dur: 0.5, amp: 0.8, hits: 1 },
    step: { tau: 0.06, dur: 0.25, amp: 0.6, hits: 1 },
    place: { tau: 0.25, dur: 0.7, amp: 1, hits: 1 },
  }[kind];
  const out = alloc(sr, cfg.dur);
  const f0 = rand(rng, 320, 620);
  // free-bar-like inharmonic series with slight detuned pairs for shimmer
  const ratios = [1, 2.756, 5.404, 8.933, rand(rng, 1.45, 1.6), rand(rng, 3.6, 4.1)];
  const amps = [1, 0.6, 0.35, 0.18, 0.4, 0.3];
  for (let h = 0; h < cfg.hits; h++) {
    const at = h === 0 ? 0 : rand(rng, 0.07, 0.12);
    const ha = h === 0 ? cfg.amp : cfg.amp * 0.55;
    for (let k = 0; k < ratios.length; k++) {
      const f = f0 * (ratios[k] as number) * (h === 0 ? 1 : rand(rng, 0.98, 1.02));
      const tau = cfg.tau / (1 + k * 0.35);
      addMode(out, sr, at, f, ha * (amps[k] as number), tau, rng() * TAU);
      addMode(out, sr, at, f * 1.004, ha * (amps[k] as number) * 0.5, tau * 0.9, rng() * TAU);
    }
    addNoiseBurst(out, sr, rng, at, { tau: 0.004, amp: ha * 0.7, type: 'bp', f: 3000, q: 0.8 });
    addNoiseBurst(out, sr, rng, at, { tau: 0.015, amp: ha * 0.5, type: 'lp', f: 400 });
  }
  if (kind === 'step') onePoleLP(out, sr, 3000);
  return done(out, sr, 80);
}

const MAT_GEN: Record<Material, (sr: number, rng: Rng, kind: Kind) => Float32Array> = {
  stone: matStone,
  wood: matWood,
  gravel: matGravel,
  grass: matGrass,
  sand: matSand,
  glass: matGlass,
  cloth: matCloth,
  snow: matSnow,
  metal: matMetal,
};

// ---------------------------------------------------------------------------
// General SFX
// ---------------------------------------------------------------------------

const genPop: Gen = (sr, rng) => {
  const out = alloc(sr, 0.12);
  const f0 = rand(rng, 420, 560);
  // lip-pop / bubble: fast upward chirp with quick decay
  addTone(out, sr, 0, 0.1, (t) => f0 * (1 + 1.1 * (1 - Math.exp(-t / 0.012))), (t) => adEnv(t, 0.001, 0.022));
  addTone(out, sr, 0, 0.05, (t) => 2 * f0 * (1 + 1.1 * (1 - Math.exp(-t / 0.012))), (t) => 0.15 * adEnv(t, 0.001, 0.01));
  addNoiseBurst(out, sr, rng, 0, { tau: 0.0015, amp: 0.25, type: 'bp', f: 2000, q: 1 });
  return done(out, sr, 100);
};

const genClick: Gen = (sr, rng) => {
  const out = alloc(sr, 0.06);
  addNoiseBurst(out, sr, rng, 0, { tau: 0.0025, amp: 1, type: 'bp', f: rand(rng, 2800, 3400), q: 1.2 });
  addMode(out, sr, 0, rand(rng, 1700, 1900), 0.5, 0.006);
  addMode(out, sr, 0.0005, 650, 0.3, 0.008);
  return done(out, sr, 200);
};

const genPlayerHurt: Gen = (sr, rng) => {
  const base = rand(rng, 120, 145);
  const dur = 0.3;
  const out = voice(sr, rng, {
    dur,
    f0: (t) => base * (1 + 0.18 * Math.exp(-t / 0.03)) * (1 - 0.2 * (t / dur)),
    amp: (t) => (t < 0.008 ? t / 0.008 : t < 0.07 ? 1 : Math.exp(-(t - 0.07) / 0.06)),
    formants: formantPath([
      [0, [500, 900, 2400]],
      [0.05, [420, 820, 2300]],
      [0.16, [330, 720, 2250]],
    ]),
    bw: [80, 110, 160],
    fgain: [1, 0.55, 0.2],
    breath: 0.12,
    jitter: 0.02,
    tilt: 2000,
    direct: 0.15,
  });
  const res = alloc(sr, dur + 0.05);
  mixInto(res, out, sr, 0, 1);
  // aspirated onset and a faint trailing "f"
  addNoiseBurst(res, sr, rng, 0, { tau: 0.012, amp: 0.25, type: 'bp', f: 1100, q: 1.2 });
  hiss(res, sr, rng, 0.15, 0.12, 3500, 0.7, (t) => bell(t, 0.12, 0.3, 0.6), 0.06, 0.2);
  saturate(normalize(res, 1), 1.5);
  return done(res, sr, 60);
};

const genHit: Gen = (sr, rng) => {
  const out = alloc(sr, 0.25);
  thump(out, sr, rng, 0, rand(rng, 130, 170), 55, 0.05, 1);
  addNoiseBurst(out, sr, rng, 0, { tau: 0.012, amp: 0.7, type: 'lp', f: 1600 });
  addNoiseBurst(out, sr, rng, 0, { tau: 0.025, amp: 0.4, type: 'bp', f: rand(rng, 350, 500), q: 1.5 });
  saturate(normalize(out, 1), 1.8);
  return done(out, sr, 40);
};

const genHitCrit: Gen = (sr, rng) => {
  const out = alloc(sr, 0.4);
  thump(out, sr, rng, 0, rand(rng, 150, 190), 60, 0.05, 0.9);
  addNoiseBurst(out, sr, rng, 0, { tau: 0.01, amp: 1, type: 'hp', f: 2000 });
  addCrunch(out, sr, rng, 0.003, { span: 0.08, grains: 12, fLo: 1500, fHi: 6000, q: [1, 3], len: [0.002, 0.008], gain: 0.6 });
  const f = rand(rng, 2200, 2800);
  addMode(out, sr, 0.004, f, 0.25, 0.08);
  addMode(out, sr, 0.004, f * 1.58, 0.18, 0.06);
  addMode(out, sr, 0.004, f * 2.4, 0.12, 0.04);
  saturate(normalize(out, 1), 1.6);
  return done(out, sr, 40);
};

const genExplode: Gen = (sr, rng) => {
  const dur = 3.2;
  const out = alloc(sr, dur);
  const n = out.length;
  // body: white+brown noise through a lowpass that closes quickly, long tail
  const body = whiteNoise(n, rng);
  const brown = brownNoise(n, rng);
  for (let i = 0; i < n; i++) body[i] = (body[i] as number) * 0.5 + (brown[i] as number) * 0.9;
  const fStart = rand(rng, 3000, 5000);
  sweep(body, sr, 'lp', (t) => 120 + fStart * Math.exp(-t / 0.13), 0.9, 64);
  applyEnv(body, sr, (t) => (t < 0.004 ? t / 0.004 : 0.7 * Math.exp(-t / 0.35) + 0.3 * Math.exp(-t / 1.1)));
  mixInto(out, body, sr, 0, 1);
  // sub-bass drop
  addTone(out, sr, 0, 2.5, (t) => 28 + 55 * Math.exp(-t / 0.18), (t) => 0.9 * adEnv(t, 0.004, 0.45));
  // initial crack
  addNoiseBurst(out, sr, rng, 0, { tau: 0.015, amp: 0.9, type: 'hp', f: 500 });
  // debris crackle & rumble grains
  addCrunch(out, sr, rng, 0.02, { span: 1.6, grains: 60, fLo: 300, fHi: 3500, q: [0.8, 2.5], len: [0.005, 0.03], decay: 0.35, skew: 1.6, gain: 0.35 });
  normalize(out, 1);
  saturate(out, 2.2);
  fadeOut(out, sr, 0.4);
  return done(out, sr, 20);
};

const genFuse: Gen = (sr, rng) => {
  const dur = 1.6;
  const out = alloc(sr, dur);
  hiss(out, sr, rng, 0, dur, rand(rng, 3000, 4200), 0.7, (t) => bell(t, dur, 0.03, 0.12), 1, 0.7);
  // sparks
  const sparks = irand(rng, 25, 45);
  for (let k = 0; k < sparks; k++) {
    addNoiseBurst(out, sr, rng, rand(rng, 0.02, dur - 0.1), { tau: rand(rng, 0.001, 0.004), amp: rand(rng, 0.3, 1.2), type: 'hp', f: 2500 });
  }
  onePoleHP(out, sr, 700);
  return done(out, sr, 200);
};

const genCreeperHiss: Gen = (sr, rng) => {
  const dur = 1.5;
  const out = alloc(sr, dur);
  const n = out.length;
  const g = whiteNoise(n, rng);
  const fEnd = rand(rng, 5000, 6500);
  sweep(g, sr, 'bp', (t) => 3200 + (fEnd - 3200) * Math.min(1, t / 0.8), 1.1, 64);
  const sm = new SmoothRandom(rng, sr, 12);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    g[i] = (g[i] as number) * Math.min(1, t / 0.3) * (t > dur - 0.2 ? (dur - t) / 0.2 : 1) * (0.85 + 0.15 * sm.next());
  }
  mixInto(out, g, sr, 0, 1);
  // breathy "sss" layer
  hiss(out, sr, rng, 0, dur, 7500, 1.5, (t) => bell(t, dur, 0.3, 0.15), 0.5, 0.2);
  return done(out, sr, 800);
};

const genBow: Gen = (sr, rng) => {
  const out = alloc(sr, 0.55);
  const f = rand(rng, 160, 230);
  // twang: bending harmonic string
  for (let h = 1; h <= 6; h++) {
    addTone(
      out, sr, 0, 0.45,
      (t) => h * f * (1 + 0.25 * Math.exp(-t / 0.025)),
      (t) => (0.8 / h) * adEnv(t, 0.002, 0.12 / Math.sqrt(h)),
      'sine',
      rng(),
    );
  }
  mixInto(out, pluck(sr, rng, f * 2, 0.3, 0.99, 0.7), sr, 0, 0.3);
  // whoosh
  const w = whiteNoise(Math.ceil(0.35 * sr), rng);
  sweep(w, sr, 'bp', (t) => 700 + 2500 * Math.sin(Math.PI * Math.min(1, t / 0.3)), 1.2);
  applyEnv(w, sr, (t) => bell(t, 0.35, 0.3, 0.6));
  mixInto(out, w, sr, 0.01, 0.45);
  return done(out, sr, 80);
};

const genThrow: Gen = (sr, rng) => {
  const dur = rand(rng, 0.25, 0.35);
  const out = alloc(sr, dur);
  const g = whiteNoise(out.length, rng);
  const fPeak = rand(rng, 1200, 2000);
  sweep(g, sr, 'bp', (t) => 450 + fPeak * Math.sin(Math.PI * Math.min(1, t / dur)), 1.4);
  applyEnv(g, sr, (t) => bell(t, dur, 0.4, 0.6));
  mixInto(out, g, sr, 0, 1);
  return done(out, sr, 150);
};

const genBurp: Gen = (sr, rng) => {
  const base = rand(rng, 85, 110);
  const dur = rand(rng, 0.35, 0.45);
  const out = voice(sr, rng, {
    dur,
    f0: (t) => base * (1.1 - 0.25 * (t / dur)),
    amp: (t) => (t < 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) / (dur * 0.45))),
    formants: formantPath([[0, [550, 1000, 2400]], [dur, [650, 1100, 2400]]]),
    breath: 0.1,
    jitter: 0.05,
    rough: 0.8,
    roughHz: rand(rng, 25, 38),
    tilt: 1500,
    direct: 0.3,
  });
  return done(out, sr, 50);
};

const genEat: Gen = (sr, rng) => {
  const out = alloc(sr, 0.22);
  addCrunch(out, sr, rng, 0, { span: 0.12, grains: 22, fLo: 800, fHi: 4500, q: [1, 3], len: [0.002, 0.012], decay: 0.5 });
  addNoiseBurst(out, sr, rng, 0, { attack: 0.004, tau: 0.03, amp: 0.7, type: 'lp', f: 300 });
  // wet squish
  addNoiseBurst(out, sr, rng, rand(rng, 0.02, 0.05), { tau: 0.03, amp: 0.3, type: 'bp', f: rand(rng, 1200, 1800), q: 4 });
  return done(out, sr, 80);
};

const genDrink: Gen = (sr, rng) => {
  const out = alloc(sr, 0.4);
  const gulps = irand(rng, 2, 3);
  for (let k = 0; k < gulps; k++) {
    const at = k * rand(rng, 0.11, 0.14);
    const f = rand(rng, 180, 280);
    addTone(out, sr, at, 0.1, (t) => f * (1 + 1.2 * Math.min(1, t / 0.05)), (t) => 0.8 * adEnv(t, 0.008, 0.03));
    addNoiseBurst(out, sr, rng, at, { attack: 0.005, tau: 0.025, amp: 0.5, type: 'bp', f: 450, q: 3 });
    addBubble(out, sr, at + 0.03, rand(rng, 500, 800), 0.25, 0.015);
  }
  onePoleLP(out, sr, 3000);
  return done(out, sr, 80);
};

const genBreakTool: Gen = (sr, rng) => {
  const out = alloc(sr, 0.4);
  addNoiseBurst(out, sr, rng, 0, { tau: 0.008, amp: 1, type: 'bp', f: rand(rng, 2000, 3000), q: 0.7 });
  addNoiseBurst(out, sr, rng, rand(rng, 0.02, 0.04), { tau: 0.006, amp: 0.6, type: 'bp', f: rand(rng, 2500, 4000), q: 0.8 });
  addCrunch(out, sr, rng, 0, { span: 0.15, grains: 18, fLo: 1500, fHi: 6000, q: [1, 3], len: [0.002, 0.01], gain: 0.6 });
  addMode(out, sr, 0.003, rand(rng, 2900, 3300), 0.25, 0.05);
  addMode(out, sr, 0.003, rand(rng, 4600, 5200), 0.15, 0.04);
  addNoiseBurst(out, sr, rng, 0, { tau: 0.02, amp: 0.4, type: 'lp', f: 500 });
  return done(out, sr, 100);
};

const genChestOpen: Gen = (sr, rng) => {
  const out = alloc(sr, 0.7);
  const dur = rand(rng, 0.45, 0.55);
  const r0 = rand(rng, 25, 40);
  creak(out, sr, rng, 0.02, dur, (t) => r0 + 70 * (t / dur), rand(rng, 450, 650), 1);
  knock(out, sr, rng, 0, rand(rng, 200, 260), 0.35, 0.6);
  return done(out, sr, 80);
};

const genChestClose: Gen = (sr, rng) => {
  const out = alloc(sr, 0.55);
  const dur = rand(rng, 0.2, 0.28);
  creak(out, sr, rng, 0, dur, (t) => 90 - 50 * (t / dur), rand(rng, 450, 650), 0.6);
  const at = dur + rand(rng, 0.01, 0.03);
  knock(out, sr, rng, at, rand(rng, 120, 160), 1, 1.3);
  thump(out, sr, rng, at, 140, 70, 0.04, 0.6);
  return done(out, sr, 50);
};

const genDoor: Gen = (sr, rng) => {
  const out = alloc(sr, 0.5);
  const dur = rand(rng, 0.15, 0.25);
  creak(out, sr, rng, 0, dur, (t) => 60 + 40 * Math.sin(Math.PI * t / dur), rand(rng, 400, 600), 0.5);
  knock(out, sr, rng, dur * rand(rng, 0.6, 0.9), rand(rng, 140, 200), 1, 1.1);
  return done(out, sr, 50);
};

function water(out: Float32Array, sr: number, rng: Rng, at: number, dur: number, fill: boolean): void {
  const n = Math.ceil(dur * sr);
  const g = whiteNoise(n, rng);
  const sm = new SmoothRandom(rng, sr, 8);
  sweep(g, sr, 'bp', () => 900 + 500 * sm.next(), 1.8, 64);
  applyEnv(g, sr, (t) => bell(t, dur, 0.15, 0.4));
  mixInto(out, g, sr, at, 0.6);
  const bubbles = irand(rng, 22, 32);
  for (let k = 0; k < bubbles; k++) {
    const t = rand(rng, 0, dur * 0.9);
    const prog = t / dur;
    const f = fill ? lerpF(400, 1400, prog) * rand(rng, 0.7, 1.3) : lerpF(1300, 450, prog) * rand(rng, 0.7, 1.3);
    addBubble(out, sr, at + t, f, rand(rng, 0.1, 0.35) * bell(t, dur, 0.1, 0.5), rand(rng, 0.012, 0.04));
  }
}
function lerpF(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const genBucketFill: Gen = (sr, rng) => {
  const out = alloc(sr, 0.8);
  water(out, sr, rng, 0, rand(rng, 0.6, 0.75), true);
  return done(out, sr, 120);
};

const genBucketEmpty: Gen = (sr, rng) => {
  const out = alloc(sr, 0.9);
  const dur = rand(rng, 0.6, 0.8);
  water(out, sr, rng, 0, dur, false);
  addNoiseBurst(out, sr, rng, dur * 0.2, { attack: 0.01, tau: 0.08, amp: 0.4, type: 'bp', f: 2500, q: 0.8 });
  return done(out, sr, 120);
};

const genFallSmall: Gen = (sr, rng) => {
  const out = alloc(sr, 0.25);
  thump(out, sr, rng, 0, rand(rng, 100, 130), 55, 0.05, 1);
  addCrunch(out, sr, rng, 0, { span: 0.05, grains: 6, fLo: 300, fHi: 1500, q: [1, 2], len: [0.004, 0.012], gain: 0.4 });
  return done(out, sr, 30);
};

const genFallBig: Gen = (sr, rng) => {
  const out = alloc(sr, 0.5);
  thump(out, sr, rng, 0, rand(rng, 85, 105), 40, 0.1, 1);
  addNoiseBurst(out, sr, rng, 0, { tau: 0.07, amp: 0.7, type: 'lp', f: 450 });
  addCrunch(out, sr, rng, 0, { span: 0.12, grains: 16, fLo: 250, fHi: 1400, q: [1, 2.5], len: [0.004, 0.016], gain: 0.5 });
  saturate(normalize(out, 1), 1.8);
  return done(out, sr, 25);
};

const genSplash: Gen = (sr, rng) => {
  const out = alloc(sr, 1.1);
  addNoiseBurst(out, sr, rng, 0, { tau: 0.04, amp: 1, type: 'hp', f: 700 });
  hiss(out, sr, rng, 0, 0.9, rand(rng, 3000, 4500), 0.6, (t) => adEnv(t, 0.02, 0.22), 0.8, 0.6);
  addNoiseBurst(out, sr, rng, 0.005, { attack: 0.01, tau: 0.08, amp: 0.6, type: 'lp', f: 300 });
  const bubbles = irand(rng, 25, 40);
  for (let k = 0; k < bubbles; k++) {
    const t = 0.04 + 0.8 * Math.pow(rng(), 1.5);
    addBubble(out, sr, t, logRand(rng, 500, 2400), rand(rng, 0.05, 0.25) * Math.exp(-t / 0.4), rand(rng, 0.01, 0.035));
  }
  return done(out, sr, 80);
};

const genSwim: Gen = (sr, rng) => {
  const dur = rand(rng, 0.35, 0.5);
  const out = alloc(sr, dur + 0.05);
  const g = whiteNoise(Math.ceil(dur * sr), rng);
  sweep(g, sr, 'bp', (t) => 500 + 900 * Math.sin(Math.PI * Math.min(1, t / dur)), 1.2);
  applyEnv(g, sr, (t) => bell(t, dur, 0.4, 0.6));
  mixInto(out, g, sr, 0, 0.8);
  for (let k = 0; k < 5; k++) addBubble(out, sr, rand(rng, 0.05, dur * 0.8), logRand(rng, 400, 1200), rand(rng, 0.05, 0.15), 0.02);
  onePoleLP(out, sr, 2500);
  return done(out, sr, 100);
};

const genLavaPop: Gen = (sr, rng) => {
  const out = alloc(sr, 0.18);
  const f = rand(rng, 140, 280);
  addTone(out, sr, 0, 0.15, (t) => f * (1 + 1.6 * Math.min(1, t / 0.04)), (t) => adEnv(t, 0.002, 0.03));
  addNoiseBurst(out, sr, rng, 0, { tau: 0.003, amp: 0.45, type: 'hp', f: 2500 });
  addNoiseBurst(out, sr, rng, 0, { tau: 0.02, amp: 0.3, type: 'lp', f: 600 });
  return done(out, sr, 60);
};

const genFireCrackle: Gen = (sr, rng) => {
  const dur = rand(rng, 1.0, 1.4);
  const out = alloc(sr, dur);
  hiss(out, sr, rng, 0, dur, 900, 0.5, (t) => bell(t, dur, 0.2, 0.3), 0.06, 0.6);
  const n = irand(rng, 16, 30);
  for (let k = 0; k < n; k++) {
    const at = rand(rng, 0.02, dur - 0.05);
    const a = Math.pow(rng(), 2) * 0.9 + 0.1;
    addNoiseBurst(out, sr, rng, at, { tau: rand(rng, 0.0006, 0.003), amp: a, type: 'bp', f: logRand(rng, 1500, 7000), q: rand(rng, 0.8, 2) });
    if (rng() < 0.3) addNoiseBurst(out, sr, rng, at + rand(rng, 0.005, 0.02), { tau: 0.001, amp: a * 0.5, type: 'hp', f: 3000 });
  }
  return done(out, sr, 150);
};

function bellTone(out: Float32Array, sr: number, rng: Rng, at: number, f: number, amp: number, len = 1): void {
  const partials = [1, 2.0, 3.0, 4.16, 5.43, 6.8];
  const amps = [1, 0.45, 0.25, 0.18, 0.1, 0.06];
  const taus = [0.55, 0.35, 0.25, 0.15, 0.1, 0.07];
  for (let k = 0; k < partials.length; k++) {
    addMode(out, sr, at, f * (partials[k] as number), amp * (amps[k] as number), (taus[k] as number) * len, rng() * TAU);
  }
}

const genLevelUp: Gen = (sr, rng) => {
  const out = alloc(sr, 1.8);
  const root = rand(rng, 520, 560);
  const steps = [0, 4, 7, 12, 16];
  for (let k = 0; k < steps.length; k++) {
    bellTone(out, sr, rng, k * 0.07, root * Math.pow(2, (steps[k] as number) / 12), 0.5 + 0.1 * k, 1.2);
  }
  // shimmer
  for (let k = 0; k < 10; k++) addMode(out, sr, 0.3 + rng() * 0.4, logRand(rng, 3000, 6000), 0.05, 0.2);
  return done(out, sr, 100);
};

// ---------------------------------------------------------------------------
// Mobs
// ---------------------------------------------------------------------------

const pigIdle: Gen = (sr, rng, v) => {
  const grunts = v % 2 === 0 ? 1 : 2;
  const out = alloc(sr, 0.7);
  let at = 0;
  for (let g = 0; g < grunts; g++) {
    const dur = rand(rng, 0.2, 0.32);
    const base = rand(rng, 150, 200);
    const vo = voice(sr, rng, {
      dur,
      f0: curve([[0, base * 0.9], [dur * 0.3, base * 1.15], [dur, base * 0.75]]),
      amp: (t) => bell(t, dur, 0.15, 0.5),
      formants: formantPath([[0, [350, 1000, 2400]], [dur * 0.4, [520, 1400, 2500]], [dur, [380, 900, 2300]]]),
      bw: [100, 140, 200],
      breath: 0.3,
      jitter: 0.06,
      rough: 0.7,
      roughHz: rand(rng, 28, 45),
      tilt: 1800,
      direct: 0.2,
    });
    mixInto(out, vo, sr, at, 1);
    // nasal snort
    hiss(out, sr, rng, at, dur, 800, 2, (t) => bell(t, dur, 0.1, 0.6) * (0.5 + 0.5 * Math.sin(TAU * 35 * t)), 0.25, 0.3);
    at += dur + rand(rng, 0.04, 0.1);
  }
  return done(out, sr, 80);
};

const pigHurt: Gen = (sr, rng) => {
  const dur = rand(rng, 0.3, 0.4);
  const base = rand(rng, 430, 520);
  const out = voice(sr, rng, {
    dur,
    f0: curve([[0, base], [dur * 0.4, base * 1.4], [dur, base * 1.05]]),
    amp: (t) => bell(t, dur, 0.08, 0.4),
    formants: () => [420, 2200, 3000],
    bw: [120, 200, 300],
    breath: 0.15,
    jitter: 0.04,
    rough: 0.3,
    roughHz: 60,
    tilt: 3500,
  });
  return done(out, sr, 150);
};

const pigDeath: Gen = (sr, rng) => {
  const dur = rand(rng, 0.7, 0.9);
  const base = rand(rng, 480, 560);
  const out = voice(sr, rng, {
    dur,
    f0: curve([[0, base], [dur * 0.2, base * 1.25], [dur, base * 0.55]]),
    amp: (t) => bell(t, dur, 0.05, 0.5),
    formants: formantPath([[0, [420, 2200, 3000]], [dur, [600, 1500, 2600]]]),
    bw: [120, 200, 300],
    breath: 0.15,
    jitter: 0.05,
    vibrato: 0.03,
    vibratoHz: 7,
    rough: 0.3,
    roughHz: 55,
    tilt: 3500,
  });
  return done(out, sr, 150);
};

const cowIdle: Gen = (sr, rng) => {
  const dur = rand(rng, 1.1, 1.45);
  const base = rand(rng, 100, 125);
  const out = voice(sr, rng, {
    dur,
    f0: curve([[0, base * 0.88], [dur * 0.3, base * 1.06], [dur * 0.7, base], [dur, base * 0.82]]),
    amp: (t) => bell(t, dur, 0.12, 0.25) * (t < 0.15 ? 0.5 + 0.5 * (t / 0.15) : 1),
    // "mm" -> "oo" -> "aw" -> "oo"
    formants: formantPath([
      [0, [250, 800, 2200]],
      [0.15, [350, 800, 2300]],
      [dur * 0.5, [680, 1050, 2400]],
      [dur, [400, 800, 2300]],
    ]),
    bw: [80, 110, 170],
    fgain: [1, 0.7, 0.25],
    breath: 0.12,
    jitter: 0.015,
    vibrato: 0.012,
    vibratoHz: 5,
    rough: 0.3,
    roughHz: base / 2,
    tilt: 1600,
    direct: 0.25,
  });
  return done(out, sr, 50);
};

const cowHurt: Gen = (sr, rng) => {
  const dur = rand(rng, 0.45, 0.55);
  const base = rand(rng, 145, 170);
  const out = voice(sr, rng, {
    dur,
    f0: curve([[0, base * 1.1], [dur, base * 0.8]]),
    amp: (t) => bell(t, dur, 0.06, 0.5),
    formants: formantPath([[0, [700, 1100, 2400]], [dur, [450, 850, 2300]]]),
    breath: 0.15,
    jitter: 0.03,
    rough: 0.45,
    roughHz: base / 2,
    tilt: 1800,
    direct: 0.2,
  });
  return done(out, sr, 50);
};

const cowDeath: Gen = (sr, rng) => {
  const dur = rand(rng, 1.4, 1.7);
  const base = rand(rng, 125, 140);
  const out = voice(sr, rng, {
    dur,
    f0: curve([[0, base], [dur * 0.2, base * 1.05], [dur, base * 0.55]]),
    amp: (t) => bell(t, dur, 0.06, 0.6),
    formants: formantPath([[0, [700, 1100, 2400]], [dur * 0.6, [420, 820, 2300]], [dur, [260, 750, 2200]]]),
    breath: 0.15,
    jitter: 0.03,
    vibrato: 0.02,
    vibratoHz: 4.5,
    rough: 0.45,
    roughHz: base / 2,
    tilt: 1600,
    direct: 0.25,
  });
  return done(out, sr, 50);
};

function bleat(sr: number, rng: Rng, dur: number, base: number, fall: number, tremHz: number, tremDepth: number): Float32Array {
  return voice(sr, rng, {
    dur,
    f0: curve([[0, base * 0.95], [0.06, base * 1.05], [dur, base * fall]]),
    amp: (t) => bell(t, dur, 0.06, 0.3),
    // "b" onset (closed) opening to "ae"/"eh"
    formants: formantPath([
      [0, [300, 900, 2400]],
      [0.05, [800, 1700, 2700]],
      [dur * 0.7, [700, 1750, 2650]],
      [dur, [550, 1850, 2600]],
    ]),
    bw: [100, 140, 200],
    fgain: [1, 0.7, 0.35],
    breath: 0.12,
    jitter: 0.03,
    vibrato: 0.035,
    vibratoHz: tremHz,
    tremolo: tremDepth,
    tilt: 3000,
    direct: 0.1,
  });
}

const sheepIdle: Gen = (sr, rng) => done(bleat(sr, rng, rand(rng, 0.6, 0.8), rand(rng, 250, 320), 0.95, rand(rng, 9, 12), 0.6), sr, 100);
const sheepHurt: Gen = (sr, rng) => done(bleat(sr, rng, rand(rng, 0.3, 0.4), rand(rng, 330, 380), 1.0, rand(rng, 13, 15), 0.5), sr, 100);
const sheepDeath: Gen = (sr, rng) => done(bleat(sr, rng, rand(rng, 0.85, 1.0), rand(rng, 300, 340), 0.65, rand(rng, 8, 10), 0.65), sr, 100);

function cluck(sr: number, rng: Rng, dur: number, base: number, peakMul: number): Float32Array {
  return voice(sr, rng, {
    dur,
    f0: curve([[0, base], [dur * 0.35, base * peakMul], [dur, base * 0.9]]),
    amp: (t) => bell(t, dur, 0.15, 0.5),
    formants: () => [850, 1700, 2900],
    bw: [150, 200, 300],
    fgain: [1, 0.8, 0.4],
    breath: 0.2,
    jitter: 0.03,
    rough: 0.2,
    roughHz: 70,
    tilt: 4000,
  });
}

const chickenIdle: Gen = (sr, rng) => {
  const out = alloc(sr, 0.7);
  const n = irand(rng, 2, 3);
  let at = 0;
  for (let k = 0; k < n; k++) {
    const dur = rand(rng, 0.06, 0.1);
    mixInto(out, cluck(sr, rng, dur, rand(rng, 420, 560), rand(rng, 1.2, 1.4)), sr, at, rand(rng, 0.7, 1));
    at += dur + rand(rng, 0.05, 0.1);
  }
  if (rng() < 0.5) mixInto(out, cluck(sr, rng, rand(rng, 0.16, 0.22), rand(rng, 550, 650), 1.25), sr, at, 1);
  return done(out, sr, 200);
};

function squawk(sr: number, rng: Rng, dur: number, fall: number): Float32Array {
  const base = rand(rng, 850, 1000);
  return voice(sr, rng, {
    dur,
    f0: curve([[0, base], [dur * 0.3, base * 1.4], [dur, base * fall]]),
    amp: (t) => bell(t, dur, 0.08, 0.45),
    formants: () => [1000, 2000, 3200],
    bw: [200, 260, 350],
    breath: 0.45,
    jitter: 0.06,
    rough: 0.45,
    roughHz: 85,
    tilt: 5000,
  });
}
const chickenHurt: Gen = (sr, rng) => done(squawk(sr, rng, rand(rng, 0.2, 0.28), 1.05), sr, 250);
const chickenDeath: Gen = (sr, rng) => done(squawk(sr, rng, rand(rng, 0.3, 0.4), 0.7), sr, 250);

function groan(sr: number, rng: Rng, dur: number, base: number, endMul: number, rough: number, vowels: readonly (readonly [number, readonly number[]])[]): Float32Array {
  return voice(sr, rng, {
    dur,
    f0: curve([[0, base * 0.95], [dur * 0.35, base * 1.08], [dur, base * endMul]]),
    amp: (t) => bell(t, dur, Math.min(0.25, 0.1 / dur + 0.05), 0.35),
    formants: formantPath(vowels),
    bw: [90, 120, 180],
    fgain: [1, 0.6, 0.25],
    breath: 0.3,
    jitter: 0.05,
    jitterRate: 18,
    rough,
    roughHz: base * 0.5,
    tilt: 1400,
    direct: 0.3,
  });
}

const zombieIdle: Gen = (sr, rng) => {
  const dur = rand(rng, 1.0, 1.5);
  const g = groan(sr, rng, dur, rand(rng, 72, 92), 0.85, 0.65, [
    [0, [450, 850, 2300]],
    [dur * 0.4, [600, 1050, 2400]],
    [dur, [420, 800, 2300]],
  ]);
  saturate(normalize(g, 1), 1.6);
  return done(g, sr, 40);
};

const zombieHurt: Gen = (sr, rng) => {
  const dur = rand(rng, 0.35, 0.45);
  const g = groan(sr, rng, dur, rand(rng, 110, 130), 0.8, 0.75, [[0, [700, 1150, 2400]], [dur, [550, 950, 2350]]]);
  saturate(normalize(g, 1), 2);
  return done(g, sr, 40);
};

const zombieDeath: Gen = (sr, rng) => {
  const dur = rand(rng, 1.3, 1.6);
  const g = groan(sr, rng, dur, rand(rng, 95, 110), 0.5, 0.8, [
    [0, [650, 1100, 2400]],
    [dur * 0.5, [500, 900, 2300]],
    [dur, [320, 750, 2200]],
  ]);
  saturate(normalize(g, 1), 1.8);
  return done(g, sr, 40);
};

const skeletonIdle: Gen = (sr, rng) => {
  const out = alloc(sr, 0.6);
  rattle(out, sr, rng, 0, rand(rng, 0.35, 0.5), irand(rng, 12, 20), 0.8);
  return done(out, sr, 200);
};

const skeletonHurt: Gen = (sr, rng) => {
  const out = alloc(sr, 0.45);
  // hard double clack then rattle
  for (let k = 0; k < 2; k++) {
    const at = k * rand(rng, 0.03, 0.05);
    addMode(out, sr, at, rand(rng, 700, 1000), 0.9, 0.02);
    addMode(out, sr, at, rand(rng, 1800, 2400), 0.6, 0.012);
    addNoiseBurst(out, sr, rng, at, { tau: 0.004, amp: 0.8, type: 'hp', f: 1500 });
  }
  rattle(out, sr, rng, 0.06, 0.3, irand(rng, 8, 12), 0.6);
  return done(out, sr, 150);
};

const skeletonDeath: Gen = (sr, rng) => {
  const out = alloc(sr, 1.3);
  rattle(out, sr, rng, 0, 1.1, irand(rng, 35, 45), 1, true);
  for (let k = 0; k < 4; k++) addMode(out, sr, rand(rng, 0.05, 0.8), rand(rng, 400, 650), 0.5, 0.03);
  return done(out, sr, 120);
};

const creeperIdle: Gen = (sr, rng) => {
  const out = alloc(sr, 0.55);
  addCrunch(out, sr, rng, 0, { span: 0.4, grains: 22, fLo: 2000, fHi: 6000, q: [0.8, 1.6], len: [0.006, 0.02], decay: 1.2, skew: 1 });
  hiss(out, sr, rng, 0, 0.45, 4000, 0.8, (t) => bell(t, 0.45, 0.4, 0.5), 0.15, 0.5);
  return done(out, sr, 300);
};

function rasp(out: Float32Array, sr: number, rng: Rng, at: number, dur: number, fc: (t: number) => number, pulseHz: number, amp: number): void {
  const n = Math.ceil(dur * sr);
  const g = whiteNoise(n, rng);
  sweep(g, sr, 'bp', fc, 1.2, 64);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const p = 0.5 + 0.5 * Math.sin(TAU * pulseHz * t);
    g[i] = (g[i] as number) * bell(t, dur, 0.08, 0.4) * (0.25 + 0.75 * p * p);
  }
  mixInto(out, g, sr, at, amp);
}

const creeperHurt: Gen = (sr, rng) => {
  const dur = rand(rng, 0.25, 0.35);
  const out = alloc(sr, dur + 0.05);
  const f = rand(rng, 1300, 1800);
  rasp(out, sr, rng, 0, dur, () => f, rand(rng, 30, 42), 1);
  addCrunch(out, sr, rng, 0, { span: dur * 0.6, grains: 12, fLo: 800, fHi: 3500, q: [1, 2.5], len: [0.003, 0.012], gain: 0.5 });
  return done(out, sr, 200);
};

const creeperDeath: Gen = (sr, rng) => {
  const dur = rand(rng, 0.75, 0.9);
  const out = alloc(sr, dur + 0.05);
  rasp(out, sr, rng, 0, dur, (t) => 2000 - 1400 * (t / dur), rand(rng, 26, 34), 1);
  hiss(out, sr, rng, 0.1, dur - 0.1, 5000, 1, (t) => bell(t, dur - 0.1, 0.2, 0.6), 0.35, 0.3);
  addCrunch(out, sr, rng, 0, { span: 0.3, grains: 18, fLo: 600, fHi: 3000, q: [1, 2.5], len: [0.004, 0.015], gain: 0.5 });
  return done(out, sr, 150);
};

const spiderIdle: Gen = (sr, rng) => {
  const dur = rand(rng, 0.5, 0.7);
  const out = alloc(sr, dur + 0.05);
  hiss(out, sr, rng, 0, dur, rand(rng, 3500, 4500), 0.9, (t) => bell(t, dur, 0.2, 0.5), 0.45, 0.5);
  const bursts = irand(rng, 2, 3);
  for (let k = 0; k < bursts; k++) {
    const at = rand(rng, 0, dur * 0.6);
    chitter(out, sr, rng, at, rand(rng, 0.08, 0.16), () => rand(rng, 35, 55), rand(rng, 2000, 3200), 0.8);
  }
  return done(out, sr, 300);
};

const spiderHurt: Gen = (sr, rng) => {
  const dur = rand(rng, 0.28, 0.36);
  const out = alloc(sr, dur + 0.05);
  hiss(out, sr, rng, 0, dur, 3800, 0.8, (t) => adEnv(t, 0.01, 0.08), 0.7, 0.3);
  chitter(out, sr, rng, 0, dur * 0.8, () => 60, rand(rng, 2200, 3200), 1);
  return done(out, sr, 300);
};

const spiderDeath: Gen = (sr, rng) => {
  const dur = rand(rng, 0.8, 1.0);
  const out = alloc(sr, dur + 0.05);
  const g = whiteNoise(Math.ceil(dur * sr), rng);
  sweep(g, sr, 'bp', (t) => 4500 - 2800 * (t / dur), 1, 64);
  applyEnv(g, sr, (t) => bell(t, dur, 0.05, 0.6));
  mixInto(out, g, sr, 0, 0.6);
  chitter(out, sr, rng, 0, dur * 0.9, (t) => 60 - 45 * (t / dur), rand(rng, 1800, 2600), 1);
  return done(out, sr, 250);
};

// ---------------------------------------------------------------------------
// Ambience
// ---------------------------------------------------------------------------

const genCave: Gen = (sr, rng, v) => {
  const dur = rand(rng, 5.5, 8);
  const out = alloc(sr, dur);
  const n = out.length;
  const attackFrac = rand(rng, 0.25, 0.4);
  const env = (t: number) => bell(t, dur, attackFrac, 0.5);
  switch (v % 4) {
    case 0: {
      // low drifting drone cluster
      const f = rand(rng, 48, 70);
      const drift = rand(rng, 0.9, 0.97);
      for (const [mul, a] of [[1, 1], [1.5, 0.5], [1.007, 0.8], [2.01, 0.25]] as const) {
        addTone(out, sr, 0, dur, (t) => f * mul * lerpF(1, drift, t / dur), (t) => a * env(t), 'sine', rng());
      }
      const r = brownNoise(n, rng);
      filter(r, sr, 'lp', 250, 0.7);
      for (let i = 0; i < n; i++) out[i] = (out[i] as number) + (r[i] as number) * 0.4 * env(i / sr);
      break;
    }
    case 1: {
      // distant whoosh / wind through tunnels
      const g = whiteNoise(n, rng);
      const f0 = rand(rng, 900, 1500);
      const f1 = rand(rng, 200, 400);
      sweep(g, sr, 'bp', (t) => f1 + (f0 - f1) * Math.pow(1 - t / dur, 2), 3.5, 128);
      applyEnv(g, sr, env);
      mixInto(out, g, sr, 0, 1);
      const r = brownNoise(n, rng);
      filter(r, sr, 'lp', 120);
      for (let i = 0; i < n; i++) out[i] = (out[i] as number) + (r[i] as number) * 0.5 * env(i / sr);
      break;
    }
    case 2: {
      // eerie beating tones gliding down
      const f = rand(rng, 260, 420);
      const glide = rand(rng, 0.7, 0.85);
      const sm = new SmoothRandom(rng, sr, 3);
      addTone(out, sr, 0, dur, (t) => f * lerpF(1, glide, t / dur) * (1 + 0.004 * Math.sin(TAU * 4 * t)), (t) => 0.6 * env(t), 'sine', 0);
      addTone(out, sr, 0, dur, (t) => f * 1.045 * lerpF(1, glide, t / dur), (t) => 0.4 * env(t) * (0.6 + 0.4 * sm.next()), 'tri', 0.3);
      addTone(out, sr, 0, dur, (t) => f * 0.5 * lerpF(1, glide, t / dur), (t) => 0.5 * env(t), 'sine', 0.6);
      const w = whiteNoise(n, rng);
      filter(w, sr, 'bp', f * 3, 6);
      for (let i = 0; i < n; i++) out[i] = (out[i] as number) + (w[i] as number) * 0.4 * env(i / sr);
      break;
    }
    default: {
      // deep rumble with distant creaks
      const r = brownNoise(n, rng);
      filter(r, sr, 'lp', 160);
      for (let i = 0; i < n; i++) out[i] = (r[i] as number) * env(i / sr);
      const creaks = irand(rng, 2, 4);
      for (let k = 0; k < creaks; k++) {
        const at = rand(rng, 0.5, dur - 1.5);
        const cd = rand(rng, 0.4, 0.9);
        const r0 = rand(rng, 15, 30);
        creak(out, sr, rng, at, cd, (t) => r0 + 25 * t, rand(rng, 150, 300), 0.35);
      }
      break;
    }
  }
  fadeIn(out, sr, 0.05);
  fadeOut(out, sr, 0.3);
  return normalize(out, PEAK);
};

const genWaterAmbient: Gen = (sr, rng) => {
  const dur = 8;
  const xf = 0.6;
  const tmp = alloc(sr, dur + xf);
  const n = tmp.length;
  const r = brownNoise(n, rng);
  filter(r, sr, 'lp', 450, 0.8);
  const sm = new SmoothRandom(rng, sr, 0.7);
  for (let i = 0; i < n; i++) tmp[i] = (r[i] as number) * (0.7 + 0.3 * sm.next());
  const bubbles = irand(rng, 20, 30);
  for (let k = 0; k < bubbles; k++) addBubble(tmp, sr, rand(rng, 0, dur), logRand(rng, 300, 1400), rand(rng, 0.03, 0.12), rand(rng, 0.015, 0.04));
  // crossfade the tail into the head so the loop is seamless
  const out = alloc(sr, dur);
  const nx = Math.floor(xf * sr);
  for (let i = 0; i < out.length; i++) out[i] = tmp[i] as number;
  for (let i = 0; i < nx; i++) {
    const a = i / nx;
    out[i] = (tmp[i] as number) * a + (tmp[out.length + i] as number) * (1 - a);
  }
  return normalize(out, PEAK);
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

function def(gen: Gen, gain: number, o: Partial<Omit<SfxDef, 'gen' | 'gain'>> = {}): SfxDef {
  return { gen, gain, variants: o.variants ?? 4, pitchVar: o.pitchVar ?? 0.06, ...o };
}

function buildRegistry(): Record<string, SfxDef> {
  const r: Record<string, SfxDef> = {};
  for (const m of MATERIALS) {
    const g = MAT_GEN[m];
    r[`break_${m}`] = def((sr, rng) => g(sr, rng, 'break'), 0.85, { pitchVar: 0.08, priority: 2 });
    r[`place_${m}`] = def((sr, rng) => g(sr, rng, 'place'), 0.8, { pitchVar: 0.08, priority: 2 });
    r[`dig_${m}`] = def((sr, rng) => g(sr, rng, 'dig'), 0.45, { pitchVar: 0.1, priority: 1 });
    r[`step_${m}`] = def((sr, rng) => g(sr, rng, 'step'), 0.3, { pitchVar: 0.1, variants: 6, priority: 0 });
  }
  // glass break is a big sound – give it a little room
  (r['break_glass'] as SfxDef).reverb = 0.15;
  (r['break_metal'] as SfxDef).reverb = 0.12;

  Object.assign(r, {
    pop: def(genPop, 0.5, { pitchVar: 0.02, priority: 1 }),
    click: def(genClick, 0.5, { variants: 2, pitchVar: 0.02, priority: 3 }),
    player_hurt: def(genPlayerHurt, 0.9, { variants: 3, pitchVar: 0.05, priority: 4 }),
    hit: def(genHit, 0.8, { priority: 3 }),
    hit_crit: def(genHitCrit, 0.85, { priority: 3 }),
    explode: def(genExplode, 1.0, { variants: 4, pitchVar: 0.08, reverb: 0.35, maxDist: 64, priority: 5 }),
    fuse: def(genFuse, 0.7, { variants: 2, pitchVar: 0.03, priority: 4 }),
    creeper_hiss: def(genCreeperHiss, 0.7, { variants: 2, pitchVar: 0.03, priority: 4 }),
    bow: def(genBow, 0.6, { priority: 2 }),
    throw: def(genThrow, 0.45, { priority: 1 }),
    burp: def(genBurp, 0.55, { variants: 3 }),
    eat: def(genEat, 0.5, { pitchVar: 0.12 }),
    drink: def(genDrink, 0.5, { variants: 3 }),
    break_tool: def(genBreakTool, 0.8, { variants: 3, priority: 3 }),
    chest_open: def(genChestOpen, 0.55, { variants: 3, reverb: 0.08, priority: 2 }),
    chest_close: def(genChestClose, 0.55, { variants: 3, reverb: 0.08, priority: 2 }),
    bucket_fill: def(genBucketFill, 0.6, { variants: 3 }),
    bucket_empty: def(genBucketEmpty, 0.6, { variants: 3 }),
    fall_small: def(genFallSmall, 0.6, { variants: 3, priority: 2 }),
    fall_big: def(genFallBig, 0.8, { variants: 3, priority: 3 }),
    splash: def(genSplash, 0.6, { variants: 3, priority: 2 }),
    swim: def(genSwim, 0.3, { priority: 0 }),
    lava_pop: def(genLavaPop, 0.45, { pitchVar: 0.15 }),
    fire_crackle: def(genFireCrackle, 0.4, { variants: 3 }),
    levelup: def(genLevelUp, 0.6, { variants: 1, pitchVar: 0, reverb: 0.2, priority: 4 }),
    door: def(genDoor, 0.6, { variants: 3, priority: 2 }),
    ambient_cave: def(genCave, 0.55, { variants: 8, pitchVar: 0.05, reverb: 0.55, maxDist: 48, rate: 16000, priority: 1 }),
    water_ambient: def(genWaterAmbient, 0.35, { variants: 1, pitchVar: 0, rate: 16000, loop: true, priority: 5 }),
  });

  const mobGens: Record<Mob, [Gen, Gen, Gen]> = {
    pig: [pigIdle, pigHurt, pigDeath],
    cow: [cowIdle, cowHurt, cowDeath],
    sheep: [sheepIdle, sheepHurt, sheepDeath],
    chicken: [chickenIdle, chickenHurt, chickenDeath],
    zombie: [zombieIdle, zombieHurt, zombieDeath],
    skeleton: [skeletonIdle, skeletonHurt, skeletonDeath],
    creeper: [creeperIdle, creeperHurt, creeperDeath],
    spider: [spiderIdle, spiderHurt, spiderDeath],
  };
  for (const m of MOBS) {
    const [idle, hurt, death] = mobGens[m];
    const idleGain = m === 'creeper' ? 0.25 : 0.6;
    r[m] = def(idle, idleGain, { variants: 4, pitchVar: 0.08, priority: 1 });
    r[`${m}_hurt`] = def(hurt, 0.75, { variants: 3, pitchVar: 0.08, priority: 3 });
    r[`${m}_death`] = def(death, 0.75, { variants: 2, pitchVar: 0.06, priority: 3 });
  }
  return r;
}

export const SFX: Readonly<Record<string, SfxDef>> = buildRegistry();
export const SOUND_NAMES: readonly string[] = Object.keys(SFX);

/** Names rendered first during background warm-up (most frequently used). */
export const WARM_PRIORITY: readonly string[] = [
  'click', 'pop',
  ...MATERIALS.flatMap((m) => [`step_${m}`, `dig_${m}`, `break_${m}`, `place_${m}`]),
  'hit', 'player_hurt', 'fall_small', 'swim', 'splash',
];

/** Deterministic seed for (name, variant). */
export function variantSeed(name: string, variant: number): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0;
}

