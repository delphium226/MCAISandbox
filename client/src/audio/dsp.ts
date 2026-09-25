/**
 * Pure-math DSP helpers used to synthesise every sound in the game.
 *
 * Nothing in here touches the Web Audio API, so all generators can run in Node
 * (see the sanity script) as well as in the browser. Buffers are mono
 * Float32Arrays at an arbitrary sample rate.
 */

export type Rng = () => number;

/** Small, fast, seedable PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit hash of a string (FNV-1a), used to seed per-sound RNGs. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function rand(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}
/** Log-uniform random value, good for frequencies. */
export function logRand(rng: Rng, lo: number, hi: number): number {
  return lo * Math.pow(hi / lo, rng());
}
export function irand(rng: Rng, lo: number, hiInclusive: number): number {
  return lo + Math.floor(rng() * (hiInclusive - lo + 1));
}
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length] as T;
}
/** Pick from `items` using matching `weights`. */
export function weighted<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i] ?? 0;
    if (r <= 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}
export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function alloc(sr: number, dur: number): Float32Array {
  return new Float32Array(Math.max(1, Math.ceil(sr * dur)));
}

export function whiteNoise(n: number, rng: Rng): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Brown-ish (integrated, leaky) noise, normalised to roughly +-1. */
export function brownNoise(n: number, rng: Rng): Float32Array {
  const out = new Float32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    v = v * 0.996 + (rng() * 2 - 1) * 0.06;
    out[i] = v;
  }
  return normalize(out, 1);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type FilterType = 'lp' | 'hp' | 'bp' | 'notch' | 'peak';

/** RBJ-cookbook biquad. 'bp' has 0 dB peak gain. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(private readonly sr: number, type?: FilterType, f?: number, q?: number, gainDb?: number) {
    if (type !== undefined && f !== undefined) this.set(type, f, q ?? Math.SQRT1_2, gainDb ?? 0);
  }

  set(type: FilterType, freq: number, q: number, gainDb = 0): this {
    const f = clamp(freq, 10, this.sr * 0.49);
    const w = (TAU * f) / this.sr;
    const cs = Math.cos(w);
    const sn = Math.sin(w);
    const alpha = sn / (2 * Math.max(0.05, q));
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (type) {
      case 'lp':
        b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
        break;
      case 'hp':
        b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
        break;
      case 'bp':
        b0 = alpha; b1 = 0; b2 = -alpha;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
        break;
      case 'notch':
        b0 = 1; b1 = -2 * cs; b2 = 1;
        a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
        break;
      case 'peak': {
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
        break;
      }
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }

  tick(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }

  run(buf: Float32Array, from = 0, to = buf.length): Float32Array {
    for (let i = from; i < to; i++) buf[i] = this.tick(buf[i] as number);
    return buf;
  }
}

/** Static filter applied in place. */
export function filter(buf: Float32Array, sr: number, type: FilterType, f: number, q = Math.SQRT1_2, gainDb = 0): Float32Array {
  return new Biquad(sr, type, f, q, gainDb).run(buf);
}

/** Time-varying filter applied in place. `f` and `q` are functions of time in seconds. */
export function sweep(
  buf: Float32Array,
  sr: number,
  type: FilterType,
  f: (t: number) => number,
  q: number | ((t: number) => number) = Math.SQRT1_2,
  step = 32,
): Float32Array {
  const bq = new Biquad(sr);
  for (let i = 0; i < buf.length; i += step) {
    const t = i / sr;
    bq.set(type, f(t), typeof q === 'number' ? q : q(t));
    bq.run(buf, i, Math.min(buf.length, i + step));
  }
  return buf;
}

/** One-pole lowpass in place (gentle 6 dB/oct tilt). */
export function onePoleLP(buf: Float32Array, sr: number, f: number): Float32Array {
  const a = Math.exp((-TAU * f) / sr);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y = (1 - a) * (buf[i] as number) + a * y;
    buf[i] = y;
  }
  return buf;
}

/** One-pole highpass in place (DC blocker style). */
export function onePoleHP(buf: Float32Array, sr: number, f: number): Float32Array {
  const a = Math.exp((-TAU * f) / sr);
  let y = 0;
  let px = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i] as number;
    y = a * (y + x - px);
    px = x;
    buf[i] = y;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Envelopes / utilities
// ---------------------------------------------------------------------------

/** Multiply buffer by env(t) in place. */
export function applyEnv(buf: Float32Array, sr: number, env: (t: number) => number): Float32Array {
  for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] as number) * env(i / sr);
  return buf;
}

/** Attack (linear) + exponential decay envelope value. */
export function adEnv(t: number, attack: number, tau: number): number {
  if (t < 0) return 0;
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / tau);
}

/** Smooth bell window over [0, dur] (raised cosine with separate attack/release fractions). */
export function bell(t: number, dur: number, attackFrac = 0.3, releaseFrac = 0.5): number {
  if (t <= 0 || t >= dur) return 0;
  const a = dur * attackFrac;
  const r = dur * releaseFrac;
  if (t < a) return 0.5 - 0.5 * Math.cos((Math.PI * t) / a);
  if (t > dur - r) return 0.5 - 0.5 * Math.cos((Math.PI * (dur - t)) / r);
  return 1;
}

export function peak(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i] as number);
    if (v > p) p = v;
  }
  return p;
}

/** Scale so the absolute peak equals `target`. Replaces non-finite samples with 0. */
export function normalize(buf: Float32Array, target = 0.95): Float32Array {
  for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i] as number)) buf[i] = 0;
  const p = peak(buf);
  if (p < 1e-9) return buf;
  const g = target / p;
  for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] as number) * g;
  return buf;
}

export function fadeIn(buf: Float32Array, sr: number, sec: number): Float32Array {
  const n = Math.min(buf.length, Math.floor(sr * sec));
  for (let i = 0; i < n; i++) buf[i] = (buf[i] as number) * (i / n);
  return buf;
}

export function fadeOut(buf: Float32Array, sr: number, sec: number): Float32Array {
  const n = Math.min(buf.length, Math.floor(sr * sec));
  const s = buf.length - n;
  for (let i = 0; i < n; i++) buf[s + i] = (buf[s + i] as number) * (1 - i / n);
  return buf;
}

/** Soft saturation in place. */
export function saturate(buf: Float32Array, drive: number): Float32Array {
  const norm = 1 / Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh((buf[i] as number) * drive) * norm;
  return buf;
}

/** Add `src * gain` into `out` starting at time `at` seconds. */
export function mixInto(out: Float32Array, src: Float32Array, sr: number, at: number, gain = 1): void {
  const off = Math.floor(at * sr);
  const n = Math.min(src.length, out.length - off);
  for (let i = Math.max(0, -off); i < n; i++) out[off + i] = (out[off + i] as number) + (src[i] as number) * gain;
}

/** Trim trailing near-silence (keeps a short tail) to save memory. */
export function trimTail(buf: Float32Array, sr: number, threshold = 0.0005): Float32Array {
  let end = buf.length;
  while (end > 1 && Math.abs(buf[end - 1] as number) < threshold) end--;
  end = Math.min(buf.length, end + Math.floor(sr * 0.01));
  return end < buf.length ? buf.slice(0, end) : buf;
}

/** Smoothly-varying random signal (sample & glide), values in roughly [-1, 1]. */
export class SmoothRandom {
  private v = 0;
  private target = 0;
  private count = 0;
  private readonly period: number;
  private readonly k: number;
  constructor(private readonly rng: Rng, sr: number, rateHz: number) {
    this.period = Math.max(1, Math.floor(sr / rateHz));
    this.k = 1 - Math.exp(-3 / this.period);
    this.target = rng() * 2 - 1;
    this.v = this.target;
  }
  next(): number {
    if (++this.count >= this.period) {
      this.count = 0;
      this.target = this.rng() * 2 - 1;
    }
    this.v += (this.target - this.v) * this.k;
    return this.v;
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Add an exponentially decaying sinusoid (a resonant "mode") at time `at`. */
export function addMode(out: Float32Array, sr: number, at: number, freq: number, amp: number, tau: number, phase = 0): void {
  if (freq <= 0 || freq >= sr * 0.49) return;
  const start = Math.floor(at * sr);
  const len = Math.min(out.length - start, Math.ceil(tau * 9.2 * sr));
  const w = (TAU * freq) / sr;
  const r = Math.exp(-1 / (tau * sr));
  const c = Math.cos(w) * r;
  const s = Math.sin(w) * r;
  let x = Math.cos(phase) * amp;
  let y = Math.sin(phase) * amp;
  for (let i = Math.max(0, -start); i < len; i++) {
    out[start + i] = (out[start + i] as number) + y;
    const nx = x * c - y * s;
    y = x * s + y * c;
    x = nx;
  }
}

export type Wave = 'sine' | 'tri' | 'saw' | 'square';

/**
 * Add an oscillator with time-varying frequency and amplitude. Uses polyBLEP
 * for saw/square so pitched voices don't alias badly.
 */
export function addTone(
  out: Float32Array,
  sr: number,
  at: number,
  dur: number,
  freq: (t: number) => number,
  amp: (t: number) => number,
  wave: Wave = 'sine',
  phase0 = 0,
): void {
  const start = Math.floor(at * sr);
  const len = Math.min(out.length - start, Math.ceil(dur * sr));
  let ph = phase0;
  for (let i = Math.max(0, -start); i < len; i++) {
    const t = i / sr;
    const f = freq(t);
    const dt = f / sr;
    let v: number;
    switch (wave) {
      case 'sine': v = Math.sin(TAU * ph); break;
      case 'tri': v = 1 - 4 * Math.abs(ph - 0.5); v = -v; break;
      case 'saw': v = 2 * ph - 1 - polyBlep(ph, dt); break;
      case 'square': {
        v = ph < 0.5 ? 1 : -1;
        v += polyBlep(ph, dt);
        v -= polyBlep((ph + 0.5) % 1, dt);
        break;
      }
    }
    out[start + i] = (out[start + i] as number) + v * amp(t);
    ph += dt;
    ph -= Math.floor(ph);
  }
}

export function polyBlep(t: number, dt: number): number {
  if (dt <= 0) return 0;
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

/** Add a filtered noise burst with an attack/decay envelope. */
export function addNoiseBurst(
  out: Float32Array,
  sr: number,
  rng: Rng,
  at: number,
  o: { attack?: number; tau: number; amp: number; type?: FilterType; f?: number; q?: number; type2?: FilterType; f2?: number; q2?: number },
): void {
  const attack = o.attack ?? 0.0008;
  const len = attack + o.tau * 7;
  const g = whiteNoise(Math.ceil(len * sr), rng);
  if (o.type && o.f) filter(g, sr, o.type, o.f, o.q ?? Math.SQRT1_2);
  if (o.type2 && o.f2) filter(g, sr, o.type2, o.f2, o.q2 ?? Math.SQRT1_2);
  applyEnv(g, sr, (t) => adEnv(t, attack, o.tau));
  mixInto(out, g, sr, at, o.amp);
}

export interface CrunchOpts {
  /** Time span over which grain onsets are scattered (s). */
  span: number;
  grains: number;
  fLo: number;
  fHi: number;
  q: [number, number];
  /** Grain length range (s). */
  len: [number, number];
  /** Amplitude decay time constant across the span, as fraction of span. */
  decay?: number;
  /** Onset density skew: >1 concentrates grains near the start. */
  skew?: number;
  gain?: number;
}

/**
 * Granular crunch: many tiny band-passed noise grains. This is the core
 * recipe for Minecraft-like gritty block sounds (stone, gravel, grass, snow).
 */
export function addCrunch(out: Float32Array, sr: number, rng: Rng, at: number, o: CrunchOpts): void {
  const decay = (o.decay ?? 0.5) * o.span;
  const skew = o.skew ?? 1.5;
  const gain = o.gain ?? 1;
  for (let k = 0; k < o.grains; k++) {
    const onset = k === 0 ? 0 : o.span * Math.pow(rng(), skew);
    const len = rand(rng, o.len[0], o.len[1]);
    const n = Math.ceil(len * sr);
    const g = whiteNoise(n, rng);
    const f = logRand(rng, o.fLo, o.fHi);
    const q = rand(rng, o.q[0], o.q[1]);
    // Band-pass boost compensates for the energy lost in narrow bands.
    new Biquad(sr, 'bp', f, q).run(g);
    const tau = len / 3.5;
    const att = Math.min(0.0015, len * 0.1);
    for (let i = 0; i < n; i++) g[i] = (g[i] as number) * adEnv(i / sr, att, tau);
    const amp = gain * Math.exp(-onset / Math.max(1e-4, decay)) * rand(rng, 0.35, 1) * Math.sqrt(q);
    mixInto(out, g, sr, at + onset, amp);
  }
}

/** Band-limited sloshy "bubble" (Minnaert resonance with rising pitch). */
export function addBubble(out: Float32Array, sr: number, at: number, f0: number, amp: number, tau: number, rise = 1.8): void {
  const dur = tau * 6;
  addTone(
    out, sr, at, dur,
    (t) => f0 * (1 + (rise - 1) * Math.min(1, t / (tau * 2))),
    (t) => amp * adEnv(t, 0.002, tau),
  );
}

/** Karplus-Strong plucked string. */
export function pluck(sr: number, rng: Rng, freq: number, dur: number, damping = 0.996, brightness = 0.5): Float32Array {
  const out = alloc(sr, dur);
  const period = Math.max(2, Math.round(sr / freq));
  const line = whiteNoise(period, rng);
  onePoleLP(line, sr, 1000 + brightness * 8000);
  let idx = 0;
  let prev = 0;
  for (let i = 0; i < out.length; i++) {
    const cur = line[idx] as number;
    const next = damping * 0.5 * (cur + prev);
    prev = cur;
    line[idx] = next;
    out[i] = cur;
    idx = (idx + 1) % period;
  }
  return out;
}

export interface VoiceOpts {
  dur: number;
  /** Fundamental frequency contour (Hz). */
  f0: (t: number) => number;
  /** Amplitude envelope. */
  amp: (t: number) => number;
  /** Formant centre frequencies F1..F3 (or more) over time. */
  formants: (t: number) => readonly number[];
  bw?: readonly number[];
  fgain?: readonly number[];
  /** Amount of aspiration noise mixed into the source (0..1). */
  breath?: number;
  /** Random pitch jitter (fraction of f0). */
  jitter?: number;
  jitterRate?: number;
  /** Amplitude roughness modulation depth (0..1) and rate (Hz) – growls, snorts. */
  rough?: number;
  roughHz?: number | ((t: number) => number);
  /** Pitch vibrato depth (fraction) and rate (Hz). */
  vibrato?: number;
  vibratoHz?: number;
  /** Tremolo depth (0..1) at vibratoHz – sheep bleat. */
  tremolo?: number;
  /** Spectral tilt lowpass on source (Hz). */
  tilt?: number;
  /** Amount of raw (lowpassed) source mixed with the formant output. */
  direct?: number;
}

/**
 * Source-filter voice: polyBLEP saw glottal source (+ breath noise) through a
 * bank of parallel band-pass formant filters. Used for grunts, moos, baas...
 */
export function voice(sr: number, rng: Rng, o: VoiceOpts): Float32Array {
  const n = Math.ceil(o.dur * sr);
  const src = new Float32Array(n);
  const jit = new SmoothRandom(rng, sr, o.jitterRate ?? 30);
  const jitter = o.jitter ?? 0.01;
  const breath = o.breath ?? 0.05;
  const rough = o.rough ?? 0;
  const vib = o.vibrato ?? 0;
  const vibHz = o.vibratoHz ?? 5;
  const trem = o.tremolo ?? 0;
  let ph = 0;
  let rph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const vibv = Math.sin(TAU * vibHz * t);
    const f = Math.max(20, o.f0(t) * (1 + jitter * jit.next() + vib * vibv));
    const dt = f / sr;
    let v = 2 * ph - 1 - polyBlep(ph, dt);
    ph += dt;
    ph -= Math.floor(ph);
    v += breath * (rng() * 2 - 1) * 1.5;
    if (rough > 0) {
      const rHz = typeof o.roughHz === 'function' ? o.roughHz(t) : (o.roughHz ?? 30);
      rph += rHz / sr;
      rph -= Math.floor(rph);
      v *= 1 - rough * (0.5 + 0.5 * Math.sin(TAU * rph)) * (0.7 + 0.3 * rng());
    }
    if (trem > 0) v *= 1 - trem * (0.5 + 0.5 * vibv);
    src[i] = v;
  }
  onePoleLP(src, sr, o.tilt ?? 2500);

  const out = new Float32Array(n);
  const first = o.formants(0);
  const nf = first.length;
  const bws = o.bw ?? [90, 120, 170, 220];
  const gains = o.fgain ?? [1, 0.6, 0.3, 0.15];
  const bank: Biquad[] = [];
  for (let k = 0; k < nf; k++) bank.push(new Biquad(sr));
  const step = 64;
  for (let i = 0; i < n; i += step) {
    const fs = o.formants(i / sr);
    for (let k = 0; k < nf; k++) {
      const fk = fs[k] ?? 1000;
      const bw = bws[k] ?? 150;
      (bank[k] as Biquad).set('bp', fk, fk / bw);
    }
    const end = Math.min(n, i + step);
    for (let j = i; j < end; j++) {
      const x = src[j] as number;
      let y = 0;
      for (let k = 0; k < nf; k++) y += (bank[k] as Biquad).tick(x) * (gains[k] ?? 0.1);
      out[j] = y;
    }
  }
  const direct = o.direct ?? 0.05;
  if (direct > 0) {
    onePoleLP(src, sr, 600);
    for (let i = 0; i < n; i++) out[i] = (out[i] as number) + (src[i] as number) * direct;
  }
  for (let i = 0; i < n; i++) out[i] = (out[i] as number) * o.amp(i / sr);
  return out;
}

/** Piecewise-linear interpolation over [t, value] breakpoints. */
export function curve(points: readonly (readonly [number, number])[]): (t: number) => number {
  return (t: number) => {
    const first = points[0];
    if (!first) return 0;
    if (t <= first[0]) return first[1];
    for (let i = 1; i < points.length; i++) {
      const p = points[i] as readonly [number, number];
      const q = points[i - 1] as readonly [number, number];
      if (t <= p[0]) return lerp(q[1], p[1], (t - q[0]) / Math.max(1e-9, p[0] - q[0]));
    }
    return (points[points.length - 1] as readonly [number, number])[1];
  };
}

/** Interpolate between formant sets over breakpoints: [[t, [F1,F2,F3]], ...]. */
export function formantPath(points: readonly (readonly [number, readonly number[]])[]): (t: number) => number[] {
  const nf = points[0]?.[1].length ?? 3;
  const curves: ((t: number) => number)[] = [];
  for (let k = 0; k < nf; k++) curves.push(curve(points.map((p) => [p[0], p[1][k] ?? 1000] as const)));
  return (t: number) => curves.map((c) => c(t));
}
