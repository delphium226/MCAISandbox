/**
 * The shared atlas (plan phase 2): what the bots have seen of the world, one summary per chunk, shared by every agent
 * and village and saved to <server>/atlas.json. Each chunk a bot receives is summarised (ground height and flatness,
 * water, logs by kind, surface materials), and a chunk whose blocks changed is summarised again a minute later.
 *
 * Several bots share this process's event loop (F16, F44), so the scan reads block state ids straight from the chunk
 * with a lookup table per state (no Block objects: bot.blockAt costs ~7 ms a chunk, this ~0.1 ms) and the queue is
 * worked off on the world's tick within a time budget.
 */
import fs from 'node:fs';
import path from 'node:path';
import type minecraftData from 'minecraft-data';

export interface ChunkSummary {
  /** Chunk coordinates (block x >> 4, z >> 4). */
  cx: number;
  cz: number;
  /** When it was summarised (ms) and by which bot's view. */
  t: number;
  by: string;
  /** Dry ground: lowest, median and highest surface y; null when the chunk has none (all water). */
  y: [number, number, number] | null;
  /** Dry columns within 1 block of the median height (of 256). */
  flat: number;
  /** Columns whose surface is water, or lava. */
  water: number;
  lava: number;
  /** Log blocks above the ground by wood kind; `low`: those within 5 blocks of the ground under them. */
  logs: Record<string, number>;
  low: Record<string, number>;
  /** The top block of dry columns, by material (sand, stone, dirt...: see MATERIALS). */
  surface: Record<string, number>;
  /** 4x4-block cells, row by row from the north-west corner: mean surface y (null: nothing found), and a letter for
   *  what covers most of the cell (CELL_LETTERS). */
  h: Array<number | null>;
  s: string;
}

/** Surface materials, with the letter a map cell gets when it is mostly that. */
const MATERIALS: Array<[string, RegExp, string]> = [
  ['sand', /^sand$/, 's'],
  ['red_sand', /^red_sand$/, 'r'],
  ['sandstone', /^sandstone$/, 'd'],
  ['red_sandstone', /^red_sandstone$/, 'D'],
  ['stone', /^(stone|andesite|diorite|granite|deepslate|tuff|calcite)$/, 'x'],
  ['gravel', /^gravel$/, 'g'],
  ['clay', /^clay$/, 'c'],
  ['terracotta', /^(.*_)?terracotta$/, 't'],
  ['dirt', /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|mud|moss_block)$/, 'o'],
  ['snow', /^(snow_block|powder_snow|ice|packed_ice|blue_ice)$/, 'n'],
];
/** Map cell letters besides the materials': water, lava, trees, anything else (built or unusual), nothing found. */
export const CELL_LETTERS = { water: '~', lava: '^', trees: 'T', other: 'b', unknown: ' ' };
const OTHER = MATERIALS.length;

const LOG = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/;
// Block categories per state id
const PASS = 0, WOOD = 1, LEAF = 2, WATER = 3, LAVA = 4, GROUND = 5;

const RESCAN_LOADED_MS = 5 * 60_000; // a chunk arriving again is summarised again after this long
const RESCAN_CHANGED_MS = 60_000; // a changed chunk: at most this often
const BUDGET_MS = 3; // per world tick (50 ms)
const SAVE_MS = 30_000;

type Column = {
  minY: number;
  sections: Array<{ solidBlockCount: number } | null | undefined>;
  getBlockStateId(p: { x: number; y: number; z: number }): number;
};

export class Atlas {
  chunks = new Map<string, ChunkSummary>();
  /** Chunks waiting to be summarised, oldest first. */
  private queue = new Map<string, [number, number]>();
  /** Chunks whose blocks changed, and when that was first noticed. */
  private changed = new Map<string, number>();
  private unsaved = false;
  private savedAt = Date.now();
  private cat: Uint8Array;
  private material: Uint8Array;
  private logKind: Uint8Array;
  private kinds: string[] = [];
  private times: number[] = [];
  stats = { scans: 0, maxMs: 0 };

  /** `columnOf` finds a bot that has the chunk loaded, and its column. */
  constructor(
    reg: ReturnType<typeof minecraftData>,
    private readonly file: string,
    private readonly columnOf: (cx: number, cz: number) => { by: string; column: Column } | null,
  ) {
    const n = reg.blocksArray.reduce((m, b) => Math.max(m, b.maxStateId + 1), 0);
    this.cat = new Uint8Array(n);
    this.material = new Uint8Array(n);
    this.logKind = new Uint8Array(n);
    for (const b of reg.blocksArray) {
      const log = LOG.exec(b.name);
      let c = PASS, m = OTHER, k = 0;
      if (log) {
        c = WOOD;
        if (!this.kinds.includes(log[1])) this.kinds.push(log[1]);
        k = this.kinds.indexOf(log[1]);
      } else if (/_leaves$|mushroom_block$/.test(b.name)) c = LEAF;
      else if (/^(water|bubble_column|seagrass|tall_seagrass|kelp|kelp_plant)$/.test(b.name)) c = WATER;
      else if (b.name === 'lava') c = LAVA;
      // Solid blocks are ground; plants, snow layers, cocoa pods, cactus and bamboo are passed over as find_site does
      else if (b.boundingBox === 'block' && !/^(snow|cocoa)$|_wood$|_stem$|cactus|bamboo/.test(b.name)) {
        c = GROUND;
        const i = MATERIALS.findIndex(([, re]) => re.test(b.name));
        m = i < 0 ? OTHER : i;
      }
      for (let s = b.minStateId; s <= b.maxStateId; s++) {
        this.cat[s] = c;
        this.material[s] = m;
        this.logKind[s] = k;
      }
    }
    this.load();
  }

  /** A bot received a chunk: summarise it unless it was summarised lately. */
  loaded(cx: number, cz: number) {
    const k = `${cx},${cz}`;
    const had = this.chunks.get(k);
    if (!had || Date.now() - had.t > RESCAN_LOADED_MS) this.queue.set(k, [cx, cz]);
  }

  /** A block changed at x, z: its chunk is summarised again (at most once a minute). */
  touched(x: number, z: number) {
    const k = `${x >> 4},${z >> 4}`;
    if (!this.changed.has(k)) this.changed.set(k, Date.now());
  }

  /** On every world tick: work the queue off within the budget, and save now and then. */
  tick() {
    const now = Date.now();
    for (const [k, since] of this.changed) {
      if (now - since < RESCAN_CHANGED_MS) continue;
      this.changed.delete(k);
      const [cx, cz] = k.split(',').map(Number);
      this.queue.set(k, [cx, cz]);
    }
    const start = performance.now();
    for (const [k, [cx, cz]] of this.queue) {
      if (performance.now() - start > BUDGET_MS) break;
      this.queue.delete(k);
      const found = this.columnOf(cx, cz);
      if (!found) continue; // gone out of view: summarised when a bot gets it again
      const t = performance.now();
      const s = this.summarise(found.column, cx, cz, found.by);
      const dt = performance.now() - t;
      this.stats.scans++;
      this.stats.maxMs = Math.max(this.stats.maxMs, dt);
      this.times.push(dt);
      if (this.times.length > 1000) this.times.shift();
      if (s) {
        this.chunks.set(k, s);
        this.unsaved = true;
      }
    }
    if (this.unsaved && now - this.savedAt > SAVE_MS) this.save();
  }

  /** Summarise one chunk column. */
  summarise(col: Column, cx: number, cz: number, by: string): ChunkSummary | null {
    let top = -1;
    for (let i = col.sections.length - 1; i >= 0; i--)
      if ((col.sections[i]?.solidBlockCount ?? 0) > 0) {
        top = i;
        break;
      }
    if (top < 0) return null;
    const { cat, material, logKind } = this;
    const yTop = col.minY + top * 16 + 15, yBottom = Math.max(col.minY, yTop - 160);
    const dry = new Int16Array(256);
    let nDry = 0, water = 0, lava = 0;
    const logs = new Uint32Array(this.kinds.length), low = new Uint32Array(this.kinds.length);
    const surface = new Uint32Array(OTHER + 1);
    // Per 4x4 cell: height sum and count, and votes for what covers it
    const hSum = new Float64Array(16), hN = new Uint8Array(16), votes = new Uint8Array(16 * (OTHER + 4));
    const V_WATER = OTHER + 1, V_LAVA = OTHER + 2, V_TREES = OTHER + 3, W = OTHER + 4;
    const logYs: number[] = [], logKs: number[] = [];
    const p = { x: 0, y: 0, z: 0 };
    for (p.z = 0; p.z < 16; p.z++)
      for (p.x = 0; p.x < 16; p.x++) {
        const cell = (p.z >> 2) * 4 + (p.x >> 2);
        logYs.length = logKs.length = 0;
        let canopy = false;
        for (p.y = yTop; p.y >= yBottom; p.y--) {
          const id = col.getBlockStateId(p);
          const c = cat[id];
          if (c === PASS) continue;
          if (c === LEAF) {
            canopy = true;
            continue;
          }
          if (c === WOOD) {
            canopy = true;
            logYs.push(p.y);
            logKs.push(logKind[id]);
            continue;
          }
          hSum[cell] += p.y;
          hN[cell]++;
          if (c === WATER) {
            water++;
            votes[cell * W + V_WATER]++;
          } else if (c === LAVA) {
            lava++;
            votes[cell * W + V_LAVA]++;
          } else {
            dry[nDry++] = p.y;
            surface[material[id]]++;
            votes[cell * W + (canopy ? V_TREES : material[id])]++;
          }
          for (let i = 0; i < logYs.length; i++) {
            logs[logKs[i]]++;
            if (logYs[i] - p.y <= 5) low[logKs[i]]++;
          }
          break;
        }
      }
    let y: ChunkSummary['y'] = null, flat = 0;
    if (nDry) {
      const hs = dry.subarray(0, nDry).sort();
      const med = hs[nDry >> 1];
      y = [hs[0], med, hs[nDry - 1]];
      for (let i = 0; i < nDry; i++) if (Math.abs(hs[i] - med) <= 1) flat++;
    }
    // In vote order: the materials, other, water, lava, trees
    const letters = [...MATERIALS.map((m) => m[2]), CELL_LETTERS.other, CELL_LETTERS.water, CELL_LETTERS.lava, CELL_LETTERS.trees];
    let s = '';
    const h: Array<number | null> = [];
    for (let c = 0; c < 16; c++) {
      h.push(hN[c] ? Math.round(hSum[c] / hN[c]) : null);
      let best = -1, most = 0;
      for (let v = 0; v < W; v++)
        if (votes[c * W + v] > most) {
          most = votes[c * W + v];
          best = v;
        }
      s += best < 0 ? CELL_LETTERS.unknown : letters[best];
    }
    const named = (counts: Uint32Array, names: string[]) => Object.fromEntries(names.map((n, i) => [n, counts[i]] as const).filter(([, q]) => q > 0));
    return {
      cx, cz, t: Date.now(), by, y, flat, water, lava,
      logs: named(logs, this.kinds), low: named(low, this.kinds),
      surface: named(surface, [...MATERIALS.map((m) => m[0]), 'other']),
      h, s,
    };
  }

  /** Summaries of chunks within `radius` blocks of x, z. */
  near(x: number, z: number, radius: number): ChunkSummary[] {
    const r = Math.ceil(radius / 16) + 1, cx0 = x >> 4, cz0 = z >> 4, out: ChunkSummary[] = [];
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const s = this.chunks.get(`${cx0 + dx},${cz0 + dz}`);
        if (s && Math.hypot(dx * 16, dz * 16) <= radius + 16) out.push(s);
      }
    return out;
  }

  /** How the atlas is doing: chunks known and waiting, and the cost of a summary (ms). */
  status() {
    const t = [...this.times].sort((a, b) => a - b);
    const q = (f: number) => (t.length ? Math.round(t[Math.min(t.length - 1, Math.floor(f * t.length))] * 1000) / 1000 : 0);
    return { chunks: this.chunks.size, queued: this.queue.size, changed: this.changed.size, scans: this.stats.scans, ms: { median: q(0.5), p99: q(0.99), max: Math.round(this.stats.maxMs * 1000) / 1000 } };
  }

  save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify({ version: 1, chunks: [...this.chunks.values()] }));
      this.unsaved = false;
      this.savedAt = Date.now();
    } catch (e) {
      console.error(`[atlas] could not save ${this.file}: ${(e as Error).message}`);
    }
  }

  private load() {
    if (!fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { chunks?: ChunkSummary[] };
      for (const s of data.chunks ?? []) this.chunks.set(`${s.cx},${s.cz}`, s);
      console.log(`[atlas] ${this.chunks.size} chunks from ${path.basename(this.file)}`);
    } catch (e) {
      console.error(`[atlas] could not read ${this.file}: ${(e as Error).message}; starting empty`);
    }
  }
}
