/**
 * Generative ambient piano music in the spirit of C418's Minecraft soundtrack
 * (original, algorithmic compositions – no melodies are copied).
 *
 * composePiece() is pure (no Web Audio) and returns a list of note events.
 * MusicPlayer renders piano samples lazily, schedules pieces with long
 * silences between them, and plays them through the shared reverb.
 */

import {
  type Rng,
  clamp,
  irand,
  midiToFreq,
  mulberry32,
  pick,
  rand,
  weighted,
} from './dsp';
import { PIANO_BASE_NOTES, nearestBase, renderPianoNote } from './piano';

export interface NoteEvent {
  /** Seconds from piece start. */
  t: number;
  midi: number;
  /** 0..1 */
  vel: number;
  /** Seconds the note is held (sustain pedal style). */
  dur: number;
  kind: 'piano' | 'pad';
}

export interface Piece {
  events: NoteEvent[];
  duration: number;
  info: string;
}

const MODES: Record<string, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
};

// Scale-degree progressions (0 = tonic). Chosen for calm, open, slightly wistful moods.
const PROG_MAJOR: readonly (readonly number[])[] = [
  [0, 3, 5, 4], [3, 0, 5, 4], [0, 5, 3, 4], [3, 4, 2, 5], [0, 2, 3, 3],
  [5, 3, 0, 4], [0, 3, 0, 4], [3, 5, 0, 0], [0, 4, 5, 3], [0, 0, 3, 3], [3, 3, 0, 5],
];
const PROG_MINOR: readonly (readonly number[])[] = [
  [0, 5, 2, 6], [0, 3, 5, 6], [0, 6, 5, 6], [5, 6, 0, 0], [0, 3, 0, 4], [0, 2, 5, 3], [5, 3, 0, 6],
];

type Style = 'arp' | 'block' | 'sparse';

interface MotifNote {
  /** Beat offset within the 2-bar motif. */
  b: number;
  /** Length in beats. */
  len: number;
  /** Scale degree relative to melody base. */
  deg: number;
}

function degToMidi(scale: readonly number[], base: number, deg: number): number {
  const o = Math.floor(deg / 7);
  const i = ((deg % 7) + 7) % 7;
  return base + 12 * o + (scale[i] as number);
}

function makeMotif(rng: Rng, bpb: number): MotifNote[] {
  const total = bpb * 2;
  const notes: MotifNote[] = [];
  let b = 0;
  let deg = pick(rng, [4, 7, 9, 5, 6]);
  while (b < total - 0.01) {
    let len = weighted(rng, [0.5, 1, 1.5, 2, 3], [0.12, 0.38, 0.12, 0.28, 0.1]);
    if (b + len > total) len = total - b;
    if (b > 0 && rng() < 0.15) {
      b += len;
      continue;
    }
    notes.push({ b, len, deg });
    b += len;
    deg += weighted(rng, [-2, -1, 0, 1, 2, 3, -3, 4, -4], [0.12, 0.28, 0.06, 0.28, 0.12, 0.05, 0.05, 0.02, 0.02]);
    deg = clamp(deg, 2, 11);
  }
  // hold the final note to the end of the motif for a phrase-like breath
  const last = notes[notes.length - 1];
  if (last) last.len = total - last.b;
  return notes;
}

function varyMotif(rng: Rng, m: readonly MotifNote[]): MotifNote[] {
  const out = m.map((n) => ({ ...n }));
  if (rng() < 0.3) {
    const shift = rng() < 0.5 ? -2 : 2;
    for (const n of out) n.deg = clamp(n.deg + shift, 2, 12);
  }
  const changes = irand(rng, 1, 2);
  for (let k = 0; k < changes; k++) {
    const n = out[Math.floor(rng() * out.length)];
    if (n) n.deg = clamp(n.deg + (rng() < 0.5 ? -1 : 1), 2, 12);
  }
  return out;
}

interface Bar {
  start: number;
  dur: number;
  chord: number;
  /** Index of the bar within its chord (0 = chord change). */
  inChord: number;
  sec: number;
}

interface Section {
  prog: readonly number[];
  motif: MotifNote[] | null;
  density: number;
}

/** Compose one complete piece (~1.5 - 3.5 minutes). */
export function composePiece(rng: Rng): Piece {
  const modeName = weighted(rng, ['major', 'lydian', 'mixolydian', 'dorian', 'aeolian'], [0.33, 0.2, 0.1, 0.15, 0.22]);
  const scale = MODES[modeName] as readonly number[];
  const minor = modeName === 'dorian' || modeName === 'aeolian';
  const tonic = irand(rng, 45, 52); // bass-register tonic, A2..E3
  const style: Style = weighted(rng, ['arp', 'block', 'sparse'] as const, [0.35, 0.35, 0.3]);
  const bpb = rng() < 0.25 ? 3 : 4;
  const bpm = style === 'arp' ? rand(rng, 62, 74) : style === 'block' ? rand(rng, 56, 68) : rand(rng, 48, 60);
  const beat = 60 / bpm;
  const barsPerChord = style === 'sparse' ? 2 : rng() < 0.5 ? 1 : 2;
  const progs = minor ? PROG_MINOR : PROG_MAJOR;
  const progA = pick(rng, progs);
  let progB = pick(rng, progs);
  if (progB === progA) progB = pick(rng, progs);
  const usePad = style === 'sparse' || rng() < 0.35;
  const seventhProb = modeName === 'major' || modeName === 'lydian' ? 0.65 : 0.45;
  const add9Prob = 0.3;
  const melBase = tonic + 12;
  const motifA = makeMotif(rng, bpb);
  const motifB = makeMotif(rng, bpb);
  const arpPatterns4 = [[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 3, 4, 1, 3, 4, 2], [0, 1, 3, 2, 4, 2, 3, 1], [0, 2, 1, 3, 2, 4, 3, 2]];
  const arpPatterns3 = [[0, 1, 2, 3, 2, 1], [0, 2, 3, 4, 3, 2], [0, 1, 3, 2, 4, 3]];
  const arpPattern = bpb === 4 ? pick(rng, arpPatterns4) : pick(rng, arpPatterns3);

  const sections: Section[] = [{ prog: progA, motif: null, density: 0 }];
  sections.push({ prog: progA, motif: motifA, density: 0.85 });
  sections.push({ prog: progA, motif: varyMotif(rng, motifA), density: 0.75 });
  if (rng() < 0.75) sections.push({ prog: progB, motif: rng() < 0.65 ? motifB : null, density: 0.6 });
  if (rng() < 0.6) sections.push({ prog: progA, motif: rng() < 0.5 ? motifA : varyMotif(rng, motifA), density: 0.7 });

  // Build the bar timeline.
  const bars: Bar[] = [];
  let t = 1.5;
  const barDur = bpb * beat;
  sections.forEach((s, si) => {
    for (const chord of s.prog) {
      for (let b = 0; b < barsPerChord; b++) {
        bars.push({ start: t, dur: barDur, chord, inChord: b, sec: si });
        t += barDur;
      }
    }
    // occasional "breath" between sections: an empty bar that lets the pedal ring
    if (si > 0 && rng() < 0.3) t += barDur;
  });

  const events: NoteEvent[] = [];
  const hum = (x: number) => x + rand(rng, -0.012, 0.012);
  const velH = (v: number) => clamp(v * rand(rng, 0.88, 1.12), 0.05, 1);
  const add = (time: number, midi: number, vel: number, dur: number, kind: NoteEvent['kind'] = 'piano') => {
    events.push({ t: Math.max(0, hum(time)), midi: clamp(Math.round(midi), 28, 100), vel: velH(vel), dur, kind });
  };

  const chordInfo = new Map<number, { seventh: boolean; add9: boolean }>();
  const infoFor = (deg: number) => {
    let ci = chordInfo.get(deg);
    if (!ci) {
      ci = { seventh: rng() < seventhProb, add9: rng() < add9Prob };
      chordInfo.set(deg, ci);
    }
    return ci;
  };
  const bassOf = (deg: number) => {
    let m = degToMidi(scale, tonic, deg);
    while (m > 50) m -= 12;
    while (m < 36) m += 12;
    return m;
  };
  const upperOf = (deg: number) => {
    const ci = infoFor(deg);
    const degs = [deg + 2, deg + 4];
    if (ci.seventh) degs.push(deg + 6);
    if (ci.add9) degs.push(deg + 8);
    const ms = new Set<number>();
    for (const d of degs) {
      let m = degToMidi(scale, tonic, d);
      while (m < 55) m += 12;
      while (m > 72) m -= 12;
      ms.add(m);
    }
    return [...ms].sort((a, b) => a - b);
  };
  const chordDegSet = (deg: number) => {
    const ci = infoFor(deg);
    const s = new Set([((deg % 7) + 7) % 7, (deg + 2) % 7, (deg + 4) % 7]);
    if (ci.seventh) s.add((deg + 6) % 7);
    return s;
  };

  // --- accompaniment -------------------------------------------------------
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i] as Bar;
    const chordDur = barsPerChord * barDur;
    const bass = bassOf(bar.chord);
    const upper = upperOf(bar.chord);
    const intro = bar.sec === 0;
    if (usePad && bar.inChord === 0) {
      const padNotes = [bass + 12, ...upper.slice(0, 3)];
      for (const m of padNotes) add(bar.start, m, intro ? 0.35 : 0.5, chordDur + 1.5, 'pad');
    }
    switch (style) {
      case 'arp': {
        const fifth = degToMidi(scale, tonic, bar.chord + 4);
        let f = fifth;
        while (f <= bass) f += 12;
        while (f > bass + 12) f -= 12;
        const set = [bass, f, ...upper].sort((a, b) => a - b);
        const steps = bpb * 2;
        for (let s = 0; s < steps; s++) {
          if (intro && s % 2 === 1 && rng() < 0.5) continue;
          let idx = arpPattern[s % arpPattern.length] as number;
          if (s === 0 && bar.inChord > 0) idx = 1;
          const m = set[Math.min(idx, set.length - 1)] as number;
          const time = bar.start + s * beat * 0.5;
          const vel = s === 0 ? 0.42 : s % 2 === 0 ? 0.3 : 0.24;
          add(time, m, vel, bar.start + bar.dur - time + 1.0);
        }
        break;
      }
      case 'block': {
        if (bar.inChord === 0) {
          add(bar.start, bass, 0.42, chordDur + 1.2);
          if (rng() < 0.5) add(bar.start, bass - 12 >= 31 ? bass - 12 : bass + 12, 0.2, chordDur + 1.2);
          upper.forEach((m, k) => add(bar.start + 0.03 + k * rand(rng, 0.02, 0.05), m, 0.26, chordDur + 0.8));
          if (bpb === 4 && rng() < 0.4) add(bar.start + 2.5 * beat, pick(rng, upper), 0.2, barDur);
        } else if (rng() < 0.6) {
          const at = bar.start + (rng() < 0.5 ? 0 : 2 * beat);
          upper.forEach((m, k) => add(at + k * 0.03, m, 0.18, bar.start + bar.dur - at + 0.8));
        }
        break;
      }
      case 'sparse': {
        if (bar.inChord === 0) {
          add(bar.start, bass, 0.34, chordDur + 2);
          add(bar.start + rand(rng, 0.25, 0.6), bass + 7, 0.2, chordDur + 1.5);
        } else if (rng() < 0.5) {
          add(bar.start + irand(rng, 0, bpb - 1) * beat, pick(rng, upper), 0.2, barDur + 1);
        }
        break;
      }
    }
  }

  // --- melody --------------------------------------------------------------
  const secBars = new Map<number, number[]>();
  bars.forEach((b, i) => {
    const arr = secBars.get(b.sec) ?? [];
    arr.push(i);
    secBars.set(b.sec, arr);
  });
  sections.forEach((s, si) => {
    if (!s.motif) return;
    const idxs = secBars.get(si) ?? [];
    for (let u = 0; u + 1 < idxs.length; u += 2) {
      const unit = u / 2;
      if (rng() > s.density) continue;
      const motif = unit % 2 === 0 ? s.motif : varyMotif(rng, s.motif);
      const b0 = bars[idxs[u] as number] as Bar;
      const b1 = bars[idxs[u + 1] as number] as Bar;
      motif.forEach((n, ni) => {
        const inFirst = n.b < bpb;
        const bar = inFirst ? b0 : b1;
        const beatInBar = inFirst ? n.b : n.b - bpb;
        const strong = beatInBar === 0 || (bpb === 4 && beatInBar === 2);
        let deg = n.deg;
        const isLast = ni === motif.length - 1;
        if (strong || isLast) {
          const cs = chordDegSet(bar.chord);
          for (const off of [0, -1, 1, -2, 2]) {
            const d = deg + off;
            if (cs.has(((d % 7) + 7) % 7)) {
              deg = d;
              break;
            }
          }
        }
        const time = bar.start + beatInBar * beat;
        const vel = strong ? 0.55 : 0.45;
        add(time, degToMidi(scale, melBase, deg), vel, n.len * beat * 1.5 + (isLast ? 1.5 : 0.3));
      });
    }
  });

  // --- outro: resolve to the tonic and let it ring ---------------------------
  const lastBar = bars[bars.length - 1] as Bar;
  const end = lastBar.start + lastBar.dur + beat * 0.5;
  const bass = bassOf(0);
  add(end, bass, 0.4, 8);
  if (bass - 12 >= 31) add(end, bass - 12, 0.22, 8);
  upperOf(0).forEach((m, k) => add(end + 0.12 + k * 0.09, m, 0.26, 7.5));
  if (sections.some((s) => s.motif)) add(end + 0.12 + 4 * 0.09 + beat, degToMidi(scale, melBase, 7), 0.38, 7);
  if (usePad) for (const m of [bass + 12, ...upperOf(0).slice(0, 3)]) add(end, m, 0.4, 7, 'pad');

  events.sort((a, b) => a.t - b.t);
  const duration = end + 10;
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const info = `${noteNames[tonic % 12]} ${modeName}, ${style}, ${Math.round(bpm)} bpm, ${bpb}/4, ${Math.round(duration)}s`;
  return { events, duration, info };
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

interface MusicVoice {
  gain: GainNode;
  stopAt: number;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

const MAX_MUSIC_VOICES = 28;
const LOOKAHEAD = 1.5;

export class MusicPlayer {
  private readonly piano = new Map<number, AudioBuffer>();
  private readonly voices = new Set<MusicVoice>();
  private readonly rng: Rng;
  private readonly pianoRate: number;
  private readonly renderRng: Rng;
  private active = false;
  private piece: Piece | null = null;
  private pieceStart = 0;
  private evIdx = 0;
  private schedTimer: ReturnType<typeof setInterval> | null = null;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private nextPieceAt = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly dry: AudioNode,
    private readonly wet: AudioNode,
    seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
  ) {
    this.rng = mulberry32(seed);
    this.renderRng = mulberry32(seed ^ 0x5bd1e995);
    this.pianoRate = Math.min(ctx.sampleRate, 32000);
  }

  get playing(): boolean {
    return this.active;
  }

  /** Human-readable status for debugging UIs. */
  status(): string {
    if (!this.active) return 'stopped';
    if (this.piece) {
      const el = this.ctx.currentTime - this.pieceStart;
      return `playing ${Math.max(0, el).toFixed(0)}/${this.piece.duration.toFixed(0)}s: ${this.piece.info}`;
    }
    return `waiting ${Math.max(0, (this.nextPieceAt - performance.now()) / 1000).toFixed(0)}s for next piece`;
  }

  /** Start the generative music loop. First piece begins after `firstDelay` seconds (default 20-40s). */
  start(firstDelay?: number): void {
    if (this.active) return;
    this.active = true;
    this.renderInBackground();
    this.schedTimer = setInterval(() => this.tick(), 250);
    this.queueNext(firstDelay ?? rand(this.rng, 20, 40));
  }

  /** Begin a new piece right away (for testing). */
  playNow(): void {
    if (!this.active) this.start(0);
    else this.queueNext(0);
  }

  stop(): void {
    this.active = false;
    if (this.schedTimer !== null) clearInterval(this.schedTimer);
    if (this.nextTimer !== null) clearTimeout(this.nextTimer);
    if (this.renderTimer !== null) clearTimeout(this.renderTimer);
    this.schedTimer = this.nextTimer = this.renderTimer = null;
    this.piece = null;
    const now = this.ctx.currentTime;
    for (const v of this.voices) this.fadeVoice(v, now, 1.5);
  }

  private queueNext(delaySec: number): void {
    if (this.nextTimer !== null) clearTimeout(this.nextTimer);
    this.nextPieceAt = performance.now() + delaySec * 1000;
    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      if (!this.active) return;
      this.piece = composePiece(this.rng);
      this.pieceStart = this.ctx.currentTime + 0.3;
      this.evIdx = 0;
      this.tick();
    }, delaySec * 1000);
  }

  private tick(): void {
    const piece = this.piece;
    if (!this.active || !piece) return;
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD;
    while (this.evIdx < piece.events.length) {
      const ev = piece.events[this.evIdx] as NoteEvent;
      const when = this.pieceStart + ev.t;
      if (when > horizon) break;
      this.evIdx++;
      if (when < now - 0.05) continue; // tab was throttled; drop stale notes
      this.playEvent(ev, Math.max(now, when));
    }
    if (this.evIdx >= piece.events.length && now > this.pieceStart + piece.duration) {
      this.piece = null;
      // Minecraft-like long silence between pieces.
      this.queueNext(rand(this.rng, 120, 300));
    }
  }

  private ensurePiano(base: number): AudioBuffer {
    let b = this.piano.get(base);
    if (!b) {
      const data = renderPianoNote(this.pianoRate, this.renderRng, base);
      b = this.ctx.createBuffer(1, data.length, this.pianoRate);
      b.getChannelData(0).set(data);
      this.piano.set(base, b);
    }
    return b;
  }

  /** Render piano samples a few at a time so we never block the main thread for long. */
  private renderInBackground(): void {
    const todo = PIANO_BASE_NOTES.filter((m) => !this.piano.has(m));
    const step = () => {
      this.renderTimer = null;
      const m = todo.shift();
      if (m === undefined || !this.active) return;
      this.ensurePiano(m);
      this.renderTimer = setTimeout(step, 40);
    };
    this.renderTimer = setTimeout(step, 100);
  }

  private playEvent(ev: NoteEvent, when: number): void {
    if (this.voices.size >= MAX_MUSIC_VOICES) {
      let oldest: MusicVoice | null = null;
      for (const v of this.voices) if (!oldest || v.stopAt < oldest.stopAt) oldest = v;
      if (oldest) this.fadeVoice(oldest, this.ctx.currentTime, 0.3);
    }
    if (ev.kind === 'piano') this.playPiano(ev, when);
    else this.playPad(ev, when);
  }

  private connectOut(node: AudioNode, midi: number, wetAmt: number): AudioNode[] {
    const nodes: AudioNode[] = [];
    let last: AudioNode = node;
    if (typeof this.ctx.createStereoPanner === 'function') {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp((midi - 62) / 40, -0.5, 0.5);
      node.connect(p);
      nodes.push(p);
      last = p;
    }
    last.connect(this.dry);
    const s = this.ctx.createGain();
    s.gain.value = wetAmt;
    last.connect(s);
    s.connect(this.wet);
    nodes.push(s);
    return nodes;
  }

  private playPiano(ev: NoteEvent, when: number): void {
    const base = nearestBase(ev.midi);
    const buf = this.ensurePiano(base);
    const rate = Math.pow(2, (ev.midi - base) / 12);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    const level = 0.12 + ev.vel * ev.vel * 0.9;
    g.gain.value = level;
    src.connect(g);
    const nodes = [src, g, ...this.connectOut(g, ev.midi, 0.55)];
    const natural = buf.duration / rate;
    const releaseAt = when + Math.min(ev.dur, natural);
    const stopAt = Math.min(when + natural, releaseAt + 1.2);
    if (releaseAt < when + natural - 0.05) {
      g.gain.setValueAtTime(level, releaseAt);
      g.gain.setTargetAtTime(0, releaseAt, 0.25);
    }
    const v: MusicVoice = { gain: g, stopAt, sources: [src], nodes };
    src.onended = () => this.cleanup(v);
    src.start(when);
    src.stop(stopAt);
    this.voices.add(v);
  }

  private playPad(ev: NoteEvent, when: number): void {
    const f = midiToFreq(ev.midi);
    const o1 = this.ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = f;
    const o2 = this.ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f;
    o2.detune.value = rand(this.rng, -8, 8);
    const o3 = this.ctx.createOscillator();
    o3.type = 'sine';
    o3.frequency.value = f * 2;
    o3.detune.value = rand(this.rng, -5, 5);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.Q.value = 0.4;
    const o3g = this.ctx.createGain();
    o3g.gain.value = 0.15;
    const g = this.ctx.createGain();
    const peak = 0.035 * ev.vel;
    const attack = Math.min(2.5, ev.dur * 0.4);
    const release = 3;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.setValueAtTime(peak, when + ev.dur);
    g.gain.linearRampToValueAtTime(0, when + ev.dur + release);
    o1.connect(lp);
    o2.connect(lp);
    o3.connect(o3g);
    o3g.connect(lp);
    lp.connect(g);
    const stopAt = when + ev.dur + release + 0.1;
    const nodes: AudioNode[] = [o1, o2, o3, o3g, lp, g, ...this.connectOut(g, ev.midi, 0.7)];
    const v: MusicVoice = { gain: g, stopAt, sources: [o1, o2, o3], nodes };
    o1.onended = () => this.cleanup(v);
    for (const o of [o1, o2, o3]) {
      o.start(when);
      o.stop(stopAt);
    }
    this.voices.add(v);
  }

  private fadeVoice(v: MusicVoice, now: number, sec: number): void {
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.linearRampToValueAtTime(0, now + sec);
      for (const s of v.sources) s.stop(now + sec + 0.05);
      v.stopAt = now + sec;
    } catch {
      this.cleanup(v);
    }
  }

  private cleanup(v: MusicVoice): void {
    if (!this.voices.delete(v)) return;
    for (const n of v.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }
}
