/**
 * Pure-math soft "felt" piano note renderer (additive synthesis).
 *
 * Each note is a sum of slightly inharmonic partials (stiff-string
 * inharmonicity), each made of two detuned "strings" so the partials beat
 * gently, with a two-stage (prompt + aftersound) decay that is faster for
 * higher partials, plus a short felt-hammer thump. The result is warm and
 * mellow, fitting the C418-style reverb-drenched ambient piano.
 */

import { type Rng, TAU, midiToFreq, onePoleLP, normalize, whiteNoise, filter, clamp } from './dsp';

export interface PianoNoteOpts {
  /** Brightness 0..1 (felt softness). */
  brightness?: number;
}

export function pianoNoteDuration(midi: number): number {
  return clamp(7.5 - (midi - 30) * 0.075, 2.8, 7.5);
}

export function renderPianoNote(sr: number, rng: Rng, midi: number, o: PianoNoteOpts = {}): Float32Array {
  const f0 = midiToFreq(midi);
  const dur = pianoNoteDuration(midi);
  const n = Math.ceil(dur * sr);
  const out = new Float32Array(n);
  const bright = o.brightness ?? 0.45;
  const B = 0.00012 * Math.pow(2, (midi - 60) / 18); // inharmonicity rises with pitch
  const maxPartials = Math.min(16, Math.floor(Math.min(9000, sr * 0.45) / f0));
  // fundamental T60-ish: long in the bass, shorter in the treble
  const tauSlow = clamp(2.6 - (midi - 40) * 0.035, 0.7, 3.0);
  const tauFast = tauSlow * 0.18;
  const hammerPos = 0.12;

  for (let k = 1; k <= maxPartials; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > sr * 0.45) break;
    const comb = Math.abs(Math.sin(Math.PI * k * hammerPos)) * 0.8 + 0.2;
    const amp = (comb / Math.pow(k, 1.05)) * Math.exp(-(k - 1) * (0.55 - bright * 0.35));
    if (amp < 0.002) continue;
    const decayMul = 1 + (k - 1) * 0.28 + fk / 3000;
    const rs = Math.exp(-1 / ((tauSlow / decayMul) * sr));
    const rf = Math.exp(-1 / ((tauFast / decayMul) * sr));
    const detune = 1 + (0.4 + rng() * 0.8) / 1200; // ~0.4-1.2 cents
    const len = Math.min(n, Math.ceil((tauSlow / decayMul) * 7 * sr));
    // two strings as rotating phasors
    const w1 = (TAU * fk) / sr;
    const w2 = w1 * detune;
    const c1 = Math.cos(w1), s1 = Math.sin(w1);
    const c2 = Math.cos(w2), s2 = Math.sin(w2);
    const p1 = rng() * TAU;
    const p2 = rng() * TAU;
    let x1 = Math.cos(p1), y1 = Math.sin(p1);
    let x2 = Math.cos(p2), y2 = Math.sin(p2);
    let es = amp * 0.45;
    let ef = amp * 0.55;
    for (let i = 0; i < len; i++) {
      out[i] = (out[i] as number) + (y1 + y2) * 0.5 * (es + ef);
      const nx1 = x1 * c1 - y1 * s1;
      y1 = x1 * s1 + y1 * c1;
      x1 = nx1;
      const nx2 = x2 * c2 - y2 * s2;
      y2 = x2 * s2 + y2 * c2;
      x2 = nx2;
      es *= rs;
      ef *= rf;
    }
  }

  // attack ramp (felt hammer is soft, ~4 ms)
  const att = Math.floor(sr * 0.004);
  for (let i = 0; i < att && i < n; i++) out[i] = (out[i] as number) * (i / att);

  // hammer thump
  const hn = Math.floor(sr * 0.04);
  const h = whiteNoise(hn, rng);
  filter(h, sr, 'lp', Math.min(4000, f0 * 4 + 300), 0.7);
  for (let i = 0; i < hn; i++) out[i] = (out[i] as number) + (h[i] as number) * 0.04 * Math.exp(-i / (sr * 0.008));

  onePoleLP(out, sr, 3500 + bright * 5000);
  // tail fade
  const fo = Math.floor(sr * 0.3);
  for (let i = 0; i < fo; i++) out[n - fo + i] = (out[n - fo + i] as number) * (1 - i / fo);
  return normalize(out, 0.5);
}

/** Base notes that get pre-rendered; other pitches are resampled from the nearest one. */
export const PIANO_BASE_NOTES: readonly number[] = (() => {
  const a: number[] = [];
  for (let m = 30; m <= 96; m += 3) a.push(m);
  return a;
})();

export function nearestBase(midi: number): number {
  let best = PIANO_BASE_NOTES[0] as number;
  for (const b of PIANO_BASE_NOTES) if (Math.abs(b - midi) < Math.abs(best - midi)) best = b;
  return best;
}
