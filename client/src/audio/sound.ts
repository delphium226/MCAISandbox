/**
 * SoundEngine – fully procedural game audio (Web Audio API, no sample files).
 *
 * Graph:
 *   voice src -> gain -> [panner] -> sfxBus(vol) -> sfxMuffle(lowpass) ----------------> master -> limiter -> out
 *                               \-> send -> sfxWet(vol) -> sfxWetMuffle -> reverb --/
 *   music piano/pad -> musicBus(vol) ---------------------------------------------------> master
 *                   \-> musicWet(vol) -> reverb
 *
 * Buffers are synthesised lazily from pure-math recipes (sfx.ts) and cached;
 * a background warm-up renders the rest in small time slices after unlock().
 */

import { mulberry32, rand, type Rng } from './dsp';
import { SFX, SOUND_NAMES, WARM_PRIORITY, variantSeed, type SfxDef } from './sfx';
import { MusicPlayer } from './music';

export { SOUND_NAMES } from './sfx';

export interface PlayOpts {
  x?: number;
  y?: number;
  z?: number;
  volume?: number;
  pitch?: number;
}

interface Voice {
  src: AudioBufferSourceNode;
  nodes: AudioNode[];
  name: string;
  priority: number;
  started: number;
  ended: boolean;
}

const MAX_VOICES = 32;
const DEFAULT_MAX_DIST = 32;
const PANNING_MODEL: PanningModelType = 'equalpower';

type AudioCtor = new (opts?: AudioContextOptions) => AudioContext;

function getAudioCtor(): AudioCtor | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function setParam(p: AudioParam | undefined, v: number, ctx: BaseAudioContext, smooth = 0): void {
  if (!p) return;
  if (smooth > 0) p.setTargetAtTime(v, ctx.currentTime, smooth);
  else p.value = v;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private disabled = false;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private sfxWet: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private wetMuffle: BiquadFilterNode | null = null;
  private musicBus: GainNode | null = null;
  private musicWet: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private music: MusicPlayer | null = null;

  private readonly buffers = new Map<string, AudioBuffer[]>();
  private readonly voices: Voice[] = [];
  private readonly warned = new Set<string>();
  private readonly lastVariant = new Map<string, number>();
  private readonly recent = new Map<string, number[]>();
  private readonly rng: Rng = mulberry32((Date.now() ^ 0x2545f491) >>> 0);
  private warmQueue: string[] = [];
  private warmTimer: ReturnType<typeof setTimeout> | null = null;

  private vol = { master: 1, music: 1, sfx: 1 };
  private listener = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private musicWanted = false;
  private underwater = false;
  private waterLoop: { src: AudioBufferSourceNode; gain: GainNode } | null = null;

  // cave "mood" accumulator (Minecraft-style)
  private mood = 0;
  private lastAmbienceT = -1;
  private lastCaveT = -1e9;

  /** Must be called from a user gesture (click/keydown) to create/resume the AudioContext. Safe to call repeatedly. */
  unlock(): void {
    if (this.disabled) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor = getAudioCtor();
    if (!Ctor) {
      this.disabled = true;
      return;
    }
    try {
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.buildGraph(ctx);
      if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
      this.applyVolumes();
      this.applyListener();
      if (this.underwater) this.setUnderwater(true);
      this.startWarmup();
      if (this.musicWanted) this.startMusic();
    } catch (e) {
      console.debug('[audio] Web Audio unavailable:', e);
      this.ctx = null;
      this.disabled = true;
    }
  }

  /** True once an AudioContext exists and is running. */
  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  private buildGraph(ctx: AudioContext): void {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);

    const master = ctx.createGain();
    master.connect(limiter);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(ctx, 2.8);
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.9;
    reverb.connect(reverbOut);
    reverbOut.connect(master);

    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    muffle.Q.value = 0.7;
    muffle.connect(master);
    const sfxBus = ctx.createGain();
    sfxBus.connect(muffle);

    const wetMuffle = ctx.createBiquadFilter();
    wetMuffle.type = 'lowpass';
    wetMuffle.frequency.value = 20000;
    wetMuffle.connect(reverb);
    const sfxWet = ctx.createGain();
    sfxWet.connect(wetMuffle);

    const musicBus = ctx.createGain();
    musicBus.connect(master);
    const musicWet = ctx.createGain();
    musicWet.connect(reverb);

    this.master = master;
    this.reverb = reverb;
    this.muffle = muffle;
    this.wetMuffle = wetMuffle;
    this.sfxBus = sfxBus;
    this.sfxWet = sfxWet;
    this.musicBus = musicBus;
    this.musicWet = musicWet;
  }

  /** Stereo exponentially-decaying noise impulse with frequency-dependent damping. */
  private makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const n = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, n, sr);
    const pre = Math.floor(sr * 0.012);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const r = mulberry32(0x1234 + ch * 777);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        // damping: the one-pole gets darker as the tail decays
        const k = Math.min(0.97, 0.15 + t * 0.45);
        lp = lp * k + (r() * 2 - 1) * (1 - k);
        const bright = (r() * 2 - 1) * Math.exp(-t / 0.18) * 0.35;
        d[i] = (lp * 2.2 + bright) * Math.exp(-t / 0.55) * (i - pre < 64 ? (i - pre) / 64 : 1);
      }
    }
    return buf;
  }

  // -------------------------------------------------------------------------
  // Buffers
  // -------------------------------------------------------------------------

  private renderVariant(name: string, def: SfxDef, idx: number): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const sr = Math.min(ctx.sampleRate, def.rate ?? 48000);
    try {
      const data = def.gen(sr, mulberry32(variantSeed(name, idx)), idx);
      const b = ctx.createBuffer(1, Math.max(1, data.length), sr);
      b.getChannelData(0).set(data);
      return b;
    } catch (e) {
      console.debug(`[audio] failed to render ${name}#${idx}`, e);
      return null;
    }
  }

  /** Get cached variants for `name`, rendering at least one synchronously. */
  private getBuffers(name: string, def: SfxDef): AudioBuffer[] {
    let list = this.buffers.get(name);
    if (!list) {
      list = [];
      this.buffers.set(name, list);
    }
    if (list.length === 0) {
      const b = this.renderVariant(name, def, 0);
      if (b) list.push(b);
      if (def.variants > 1 && !this.warmQueue.includes(name)) this.warmQueue.unshift(name);
      this.kickWarmup();
    }
    return list;
  }

  private startWarmup(): void {
    const rest = SOUND_NAMES.filter((n) => !WARM_PRIORITY.includes(n));
    this.warmQueue = [...WARM_PRIORITY, ...rest];
    this.kickWarmup();
  }

  private kickWarmup(): void {
    if (this.warmTimer !== null || !this.ctx) return;
    this.warmTimer = setTimeout(() => this.warmStep(), 30);
  }

  /** Render pending variants in ~6 ms slices so the game loop never stutters. */
  private warmStep(): void {
    this.warmTimer = null;
    const t0 = now();
    while (this.warmQueue.length > 0 && now() - t0 < 6) {
      const name = this.warmQueue[0] as string;
      const def = SFX[name];
      if (!def) {
        this.warmQueue.shift();
        continue;
      }
      let list = this.buffers.get(name);
      if (!list) {
        list = [];
        this.buffers.set(name, list);
      }
      if (list.length >= def.variants) {
        this.warmQueue.shift();
        continue;
      }
      const b = this.renderVariant(name, def, list.length);
      if (b) list.push(b);
      else this.warmQueue.shift();
    }
    if (this.warmQueue.length > 0) this.warmTimer = setTimeout(() => this.warmStep(), 20);
  }

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------

  /** Play a named sound. Positional if x/y/z are given. */
  play(name: string, opts: PlayOpts = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.sfxWet) return;
    const def = SFX[name];
    if (!def) {
      if (!this.warned.has(name)) {
        this.warned.add(name);
        console.debug(`[audio] unknown sound "${name}"`);
      }
      return;
    }
    try {
      this.playInternal(ctx, name, def, opts);
    } catch (e) {
      console.debug(`[audio] play(${name}) failed`, e);
    }
  }

  private playInternal(ctx: AudioContext, name: string, def: SfxDef, opts: PlayOpts): void {
    const t = ctx.currentTime;
    // De-duplicate bursts (e.g. many identical events in the same frame).
    const rec = (this.recent.get(name) ?? []).filter((x) => t - x < 0.03);
    if (rec.length >= 3) return;
    rec.push(t);
    this.recent.set(name, rec);

    const list = this.getBuffers(name, def);
    if (list.length === 0) return;
    let idx = Math.floor(this.rng() * list.length);
    if (list.length > 1 && idx === this.lastVariant.get(name)) idx = (idx + 1) % list.length;
    this.lastVariant.set(name, idx);
    const buffer = list[idx] as AudioBuffer;

    const priority = def.priority ?? 1;
    if (this.voices.length >= MAX_VOICES && !this.stealVoice(priority)) return;

    const volume = Math.max(0, opts.volume ?? 1);
    const pitch = Math.max(0.05, opts.pitch ?? 1);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = def.loop === true;
    src.playbackRate.value = pitch * (1 + rand(this.rng, -def.pitchVar, def.pitchVar));
    const gain = ctx.createGain();
    gain.gain.value = def.gain * Math.min(volume, 4);
    src.connect(gain);
    const nodes: AudioNode[] = [src, gain];

    let out: AudioNode = gain;
    const positional = opts.x !== undefined && opts.y !== undefined && opts.z !== undefined;
    if (positional) {
      const p = ctx.createPanner();
      p.panningModel = PANNING_MODEL;
      p.distanceModel = 'linear';
      p.refDistance = 1;
      p.maxDistance = (def.maxDist ?? DEFAULT_MAX_DIST) * Math.max(1, volume);
      p.rolloffFactor = 1;
      if (p.positionX) {
        p.positionX.value = opts.x as number;
        p.positionY.value = opts.y as number;
        p.positionZ.value = opts.z as number;
      } else {
        p.setPosition(opts.x as number, opts.y as number, opts.z as number);
      }
      gain.connect(p);
      nodes.push(p);
      out = p;
    }
    out.connect(this.sfxBus as GainNode);
    if (def.reverb && def.reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = def.reverb;
      out.connect(send);
      send.connect(this.sfxWet as GainNode);
      nodes.push(send);
    }

    const voice: Voice = { src, nodes, name, priority, started: t, ended: false };
    src.onended = () => this.releaseVoice(voice);
    this.voices.push(voice);
    src.start();
  }

  /** Free a voice slot for a new sound of the given priority. */
  private stealVoice(priority: number): boolean {
    let victim = -1;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i] as Voice;
      if (v.src.loop) continue;
      if (v.priority > priority) continue;
      if (victim < 0 || v.priority < (this.voices[victim] as Voice).priority) victim = i;
      else if (v.priority === (this.voices[victim] as Voice).priority && v.started < (this.voices[victim] as Voice).started) victim = i;
    }
    if (victim < 0) return false;
    const v = this.voices[victim] as Voice;
    try {
      v.src.stop();
    } catch {
      /* not started */
    }
    this.releaseVoice(v);
    return true;
  }

  private releaseVoice(v: Voice): void {
    if (v.ended) return;
    v.ended = true;
    const i = this.voices.indexOf(v);
    if (i >= 0) this.voices.splice(i, 1);
    for (const n of v.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  // -------------------------------------------------------------------------
  // Listener / mix
  // -------------------------------------------------------------------------

  /** yaw: radians, 0 = looking towards -Z, positive yaw turns towards -X (left). pitch: radians, positive = up. */
  setListener(x: number, y: number, z: number, yaw: number, pitch: number): void {
    const l = this.listener;
    l.x = x; l.y = y; l.z = z; l.yaw = yaw; l.pitch = pitch;
    this.applyListener();
  }

  private applyListener(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { x, y, z, yaw, pitch } = this.listener;
    const cp = Math.cos(pitch);
    const fx = -Math.sin(yaw) * cp;
    const fy = Math.sin(pitch);
    const fz = -Math.cos(yaw) * cp;
    const ux = -Math.sin(yaw) * -Math.sin(pitch);
    const uy = cp;
    const uz = -Math.cos(yaw) * -Math.sin(pitch);
    const L = ctx.listener;
    try {
      if (L.positionX) {
        L.positionX.value = x;
        L.positionY.value = y;
        L.positionZ.value = z;
        L.forwardX.value = fx;
        L.forwardY.value = fy;
        L.forwardZ.value = fz;
        L.upX.value = ux;
        L.upY.value = uy;
        L.upZ.value = uz;
      } else {
        L.setPosition(x, y, z);
        L.setOrientation(fx, fy, fz, ux, uy, uz);
      }
    } catch {
      /* ignore bad values */
    }
  }

  setVolumes(v: { master?: number; music?: number; sfx?: number }): void {
    if (v.master !== undefined) this.vol.master = Math.max(0, v.master);
    if (v.music !== undefined) this.vol.music = Math.max(0, v.music);
    if (v.sfx !== undefined) this.vol.sfx = Math.max(0, v.sfx);
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = 0.03;
    setParam(this.master?.gain, this.vol.master, ctx, s);
    setParam(this.sfxBus?.gain, this.vol.sfx, ctx, s);
    setParam(this.sfxWet?.gain, this.vol.sfx, ctx, s);
    setParam(this.musicBus?.gain, this.vol.music * 0.8, ctx, s);
    setParam(this.musicWet?.gain, this.vol.music * 0.8, ctx, s);
  }

  // -------------------------------------------------------------------------
  // Music
  // -------------------------------------------------------------------------

  /** Start generative background music (first piece after ~20-40 s, then a piece every few minutes). */
  startMusic(): void {
    this.musicWanted = true;
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.musicWet) return;
    if (!this.music) this.music = new MusicPlayer(ctx, this.musicBus, this.musicWet);
    this.music.start();
  }

  stopMusic(): void {
    this.musicWanted = false;
    this.music?.stop();
  }

  /** Debug/test helper: begin a music piece immediately. */
  playMusicNow(): void {
    this.musicWanted = true;
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.musicWet) return;
    if (!this.music) this.music = new MusicPlayer(ctx, this.musicBus, this.musicWet);
    this.music.playNow();
  }

  /** Debug/test helper. */
  musicStatus(): string {
    return this.music?.status() ?? 'stopped';
  }

  // -------------------------------------------------------------------------
  // Environment
  // -------------------------------------------------------------------------

  /** Muffle all sfx (lowpass) when the camera is underwater; also runs the underwater ambience bed. */
  setUnderwater(on: boolean): void {
    const changed = on !== this.underwater;
    this.underwater = on;
    const ctx = this.ctx;
    if (!ctx) return;
    const f = on ? 550 : 20000;
    setParam(this.muffle?.frequency, f, ctx, 0.06);
    setParam(this.wetMuffle?.frequency, f, ctx, 0.06);
    if (changed || (on && !this.waterLoop)) {
      if (on) this.startWaterLoop(ctx);
      else this.stopWaterLoop(ctx);
    }
  }

  private startWaterLoop(ctx: AudioContext): void {
    if (this.waterLoop || !this.master) return;
    const def = SFX['water_ambient'];
    if (!def) return;
    const list = this.getBuffers('water_ambient', def);
    const buffer = list[0];
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(def.gain, ctx.currentTime, 0.3);
    src.connect(gain);
    // bypass the muffle filter: it is already a muffled sound, but follow sfx volume
    gain.connect(this.sfxBus as GainNode);
    src.start();
    this.waterLoop = { src, gain };
  }

  private stopWaterLoop(ctx: AudioContext): void {
    const w = this.waterLoop;
    if (!w) return;
    this.waterLoop = null;
    const t = ctx.currentTime;
    w.gain.gain.cancelScheduledValues(t);
    w.gain.gain.setTargetAtTime(0, t, 0.15);
    try {
      w.src.stop(t + 0.8);
    } catch {
      /* ignore */
    }
    w.src.onended = () => {
      w.src.disconnect();
      w.gain.disconnect();
    };
  }

  /**
   * Cave ambience driver. Call every frame or every second. When the player is
   * deep and in the dark, a "mood" meter fills; when full an eerie cave sound
   * plays somewhere around the listener (at most every ~45 s).
   */
  updateAmbience(info: { depthBelowSurface: number; skyLight: number; inWater: boolean }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const dt = this.lastAmbienceT < 0 ? 0 : Math.min(2, Math.max(0, t - this.lastAmbienceT));
    this.lastAmbienceT = t;
    if (dt === 0) return;
    const dark = info.skyLight < 4 && info.depthBelowSurface > 8 && !info.inWater;
    if (dark) {
      const darkness = 1 - Math.max(0, info.skyLight) / 4;
      const depthF = Math.min(1, 0.35 + (info.depthBelowSurface - 8) / 24);
      this.mood += (dt * darkness * depthF) / 75;
    } else {
      this.mood = Math.max(0, this.mood - dt / 30);
    }
    if (this.mood >= 1 && t - this.lastCaveT > 45) {
      this.mood = 0;
      this.lastCaveT = t;
      const a = this.rng() * Math.PI * 2;
      const d = rand(this.rng, 5, 12);
      const l = this.listener;
      this.play('ambient_cave', {
        x: l.x + Math.cos(a) * d,
        y: l.y + rand(this.rng, -4, 2),
        z: l.z + Math.sin(a) * d,
        volume: rand(this.rng, 0.7, 1),
      });
    }
  }

  /** Number of currently playing sfx voices (debug). */
  get activeVoices(): number {
    return this.voices.length;
  }

  /** Number of rendered sfx buffers (debug). */
  get cachedBuffers(): number {
    let n = 0;
    for (const l of this.buffers.values()) n += l.length;
    return n;
  }
}
