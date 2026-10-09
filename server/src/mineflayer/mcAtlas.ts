/**
 * The shared atlas (plan phase 2): what the bots have seen of the world, one summary per chunk, shared by every agent
 * and village and saved to <server>/atlas.json. Each chunk a bot receives is summarised (ground height and flatness,
 * water, logs by kind, surface materials, and ores exposed to air underground: plan step V.6), and a chunk whose blocks
 * changed is summarised again a minute later, so an ore mined out or newly exposed shows then.
 *
 * Several bots share this process's event loop (F16, F44), so the scan reads block state ids straight from the chunk
 * with a lookup table per state (no Block objects: bot.blockAt costs ~7 ms a chunk, this ~0.1 ms) and the queue is
 * worked off on the world's tick within a time budget.
 */
import fs from 'node:fs';
import path from 'node:path';
import type minecraftData from 'minecraft-data';
import { ATLAS_LEAF, ATLAS_LOG, ATLAS_SKIP, ATLAS_WATER, waterloggedEmpty } from './mcBlocks';

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
  /** Ores exposed to air anywhere in the column (cave walls, ravines, cliffs, mine tunnels) by kind, deepslate ores with
   *  the others: how many blocks, the lowest and the highest y (V.6). Missing in summaries from before. */
  ores?: Record<string, [number, number, number]>;
  /** Farmable plants seen from above (PLANT_KINDS): the columns whose first plant is of that kind (for sugar cane the
   *  blocks over each stalk's base instead, F192), and the first such cell (x, y, z). Missing in summaries from before
   *  (opportunistic farming, 10-08). */
  plants?: Record<string, [number, number, number, number]>;
  /** The village whose mine has dug in this chunk (kept through later summaries). */
  mine?: string;
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

/** The ores recorded (deepslate_iron_ore counts as iron; the Nether's are not looked for). */
export const ORE_KINDS = ['coal', 'iron', 'copper', 'gold', 'redstone', 'lapis', 'diamond', 'emerald'];
/** The plants recorded where agents pass (block names: crops by their block, the fruit blocks, not their stems). */
export const PLANT_KINDS = ['sugar_cane', 'pumpkin', 'melon', 'carrots', 'potatoes', 'beetroots', 'sweet_berry_bush', 'cocoa', 'bamboo'];
/** Sugar cane's index in `plant` (1 + its index in PLANT_KINDS). */
const CANE = PLANT_KINDS.indexOf('sugar_cane') + 1;
/** The animals recorded where agents pass (entity names). */
export const ANIMAL_KINDS = new Set(['chicken', 'cow', 'sheep', 'pig', 'rabbit', 'goat', 'horse']);
export interface AnimalSighting {
  kind: string;
  x: number;
  y: number;
  z: number;
  /** When it was last seen there (ms), and by whom. */
  t: number;
  by: string;
}
const ANIMALS_MAX = 1000;
// Block categories per state id
const PASS = 0, WOOD = 1, LEAF = 2, WATER = 3, LAVA = 4, GROUND = 5;

const RESCAN_LOADED_MS = 5 * 60_000; // a chunk arriving again is summarised again after this long
const RESCAN_CHANGED_MS = 60_000; // a changed chunk: at most this often
const BUDGET_MS = 3; // per world tick (50 ms)
const SAVE_MS = 30_000;

/** A section of 16x16x16 blocks (prismarine-chunk): `palette` lists the states it uses (only grows: a state dug out
 *  stays in it), missing when one state fills it (`data.value`) or it stores state ids directly. */
export type Section = { solidBlockCount: number; palette?: number[]; data: { get(i: number): number; value?: number } };
export type Column = {
  minY: number;
  sections: Array<Section | null | undefined>;
  getBlockStateId(p: { x: number; y: number; z: number }): number;
};

export class Atlas {
  chunks = new Map<string, ChunkSummary>();
  /** Chunks waiting to be summarised, oldest first. */
  private queue = new Map<string, [number, number]>();
  /** Chunks whose blocks changed, and when that was first noticed. */
  private changed = new Map<string, number>();
  /** Chunks a mine dug in before the atlas had summarised them, by village. */
  private minedBefore = new Map<string, string>();
  private unsaved = false;
  private savedAt = Date.now();
  private cat: Uint8Array;
  private material: Uint8Array;
  private logKind: Uint8Array;
  /** Per state: 1 + its index in ORE_KINDS (0: no ore), and whether it is air (an ore next to air is exposed). */
  private ore: Uint8Array;
  private air: Uint8Array;
  /** Per state: 1 + its index in PLANT_KINDS (0: no plant of a kind recorded). */
  private plant: Uint8Array;
  /** Animals seen, by entity uuid (kept where last seen: in peaceful they never despawn, and stray little). */
  animals = new Map<string, AnimalSighting>();
  /** Animals not tracked where a bot should see them, by uuid: since when. */
  private missing = new Map<string, number>();
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
    this.ore = new Uint8Array(n);
    this.air = new Uint8Array(n);
    this.plant = new Uint8Array(n);
    for (const b of reg.blocksArray) {
      const pk = PLANT_KINDS.indexOf(b.name) + 1;
      if (pk) for (let s = b.minStateId; s <= b.maxStateId; s++) this.plant[s] = pk;
      const ore = /^(?:deepslate_)?(\w+?)_ore$/.exec(b.name);
      const o = ore ? ORE_KINDS.indexOf(ore[1]) + 1 : 0, open = /^(air|cave_air)$/.test(b.name) ? 1 : 0;
      // Tree logs by kind, leaves (and mushroom blocks), lava, water (mcBlocks.ts: ATLAS_*)
      const kind = ATLAS_LOG.has(b.name) ? b.name.replace(/_log$/, '') : null;
      let c = PASS, m = OTHER, k = 0;
      if (kind) {
        c = WOOD;
        if (!this.kinds.includes(kind)) this.kinds.push(kind);
        k = this.kinds.indexOf(kind);
      } else if (ATLAS_LEAF.has(b.name)) c = LEAF;
      else if (b.name === 'lava') c = LAVA;
      else if (ATLAS_WATER.has(b.name)) c = WATER;
      // Solid blocks are ground; plants, cocoa pods, cactus, bamboo and the like are passed over as find_site does
      else if (b.boundingBox === 'block' && !ATLAS_SKIP.has(b.name)) {
        c = GROUND;
        const i = MATERIALS.findIndex(([, re]) => re.test(b.name));
        m = i < 0 ? OTHER : i;
      }
      // Waterlogged states of blocks with an empty box (coral fans, glow lichen under water) are water, as find_site's
      // surface read takes them
      const logged = c === PASS ? waterloggedEmpty(b) : null;
      for (let s = b.minStateId; s <= b.maxStateId; s++) {
        this.cat[s] = logged?.(s) ? WATER : c;
        this.material[s] = m;
        this.logKind[s] = k;
        this.ore[s] = o;
        this.air[s] = open;
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

  /** A village's mine dug at x, z: its chunk is marked as that mine's (its ores come with the next summary). */
  mined(x: number, z: number, village: string) {
    const k = `${x >> 4},${z >> 4}`;
    const s = this.chunks.get(k);
    if (!s) this.minedBefore.set(k, village); // dug before its first summary: marked when it comes
    else if (s.mine !== village) {
      s.mine = village;
      this.unsaved = true;
    }
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
        // What no scan sees: whose mine dug here
        const had = this.chunks.get(k)?.mine ?? this.minedBefore.get(k);
        if (had) s.mine = had;
        this.minedBefore.delete(k);
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
    const { cat, material, logKind, plant } = this;
    const plantN = new Uint32Array(PLANT_KINDS.length + 1), plantAt = new Int32Array(3 * (PLANT_KINDS.length + 1));
    const yTop = col.minY + top * 16 + 15, yBottom = Math.max(col.minY, yTop - 160);
    const dry = new Int16Array(256);
    let nDry = 0, water = 0, lava = 0;
    const logs = new Uint32Array(this.kinds.length), low = new Uint32Array(this.kinds.length);
    const surface = new Uint32Array(OTHER + 1);
    // Per 4x4 cell: height sum and count, and votes for what covers it
    const hSum = new Float64Array(16), hN = new Uint8Array(16), votes = new Uint8Array(16 * (OTHER + 4));
    const V_WATER = OTHER + 1, V_LAVA = OTHER + 2, V_TREES = OTHER + 3, W = OTHER + 4;
    const logYs: number[] = [], logKs: number[] = [];
    const p = { x: 0, y: 0, z: 0 }, q = { x: 0, y: 0, z: 0 };
    for (p.z = 0; p.z < 16; p.z++)
      for (p.x = 0; p.x < 16; p.x++) {
        const cell = (p.z >> 2) * 4 + (p.x >> 2);
        logYs.length = logKs.length = 0;
        let canopy = false, planted = false;
        for (p.y = yTop; p.y >= yBottom; p.y--) {
          const id = col.getBlockStateId(p);
          const c = cat[id];
          // The first farmable plant on the way down (passed over as find_site does: cocoa under the canopy too)
          if (!planted && plant[id]) {
            planted = true;
            const k = plant[id];
            if (k === CANE) {
              // Cane counts the blocks a cut takes, those over the stalk's base (collect never takes a base): a 1-high stalk
              // gives nothing and is not recorded (F192)
              let n = 0;
              for (q.x = p.x, q.z = p.z, q.y = p.y - 1; q.y >= yBottom && plant[col.getBlockStateId(q)] === CANE; q.y--) n++;
              if (n) {
                if (!plantN[k]) plantAt.set([cx * 16 + p.x, p.y, cz * 16 + p.z], k * 3);
                plantN[k] += n;
              }
            } else if (!plantN[k]++) plantAt.set([cx * 16 + p.x, p.y, cz * 16 + p.z], k * 3);
          }
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
    const plants: Record<string, [number, number, number, number]> = {};
    for (let k = 1; k <= PLANT_KINDS.length; k++) if (plantN[k]) plants[PLANT_KINDS[k - 1]] = [plantN[k], plantAt[k * 3], plantAt[k * 3 + 1], plantAt[k * 3 + 2]];
    return {
      cx, cz, t: Date.now(), by, y, flat, water, lava,
      logs: named(logs, this.kinds), low: named(low, this.kinds),
      surface: named(surface, [...MATERIALS.map((m) => m[0]), 'other']),
      h, s, ores: this.exposedOres(col, top),
      // (always, empty too: "scanned, none" differs from a summary from before plants were recorded, the review's L2)
      plants,
    };
  }

  /**
   * Ores exposed to air in a column, read section by section from the bottom to the highest non-empty one; a section
   * whose palette holds no ore is passed over. About 0.25 ms a chunk (synthetic 26.1 chunks, ground at y 70), on top of
   * the surface's 0.1. Only faces inside the chunk count (the next column may not be loaded), so an ore on the chunk's
   * edge exposed only across it is left out.
   */
  private exposedOres(col: Column, top: number): Record<string, [number, number, number]> {
    const { ore, air } = this;
    const N = ORE_KINDS.length + 1;
    const n = new Uint32Array(N), lo = new Int16Array(N).fill(32767), hi = new Int16Array(N).fill(-32768);
    const q = { x: 0, y: 0, z: 0 };
    const open = (x: number, y: number, z: number) => {
      if (x < 0 || x > 15 || z < 0 || z > 15 || y < col.minY) return 0;
      q.x = x;
      q.y = y;
      q.z = z;
      return air[col.getBlockStateId(q)];
    };
    for (let i = 0; i <= top; i++) {
      const sec = col.sections[i];
      if (!sec || !sec.solidBlockCount) continue;
      // One state fills it (never an ore worth a loop), or its palette names no ore
      if (sec.palette ? !sec.palette.some((s) => ore[s]) : sec.data.value !== undefined) continue;
      const y0 = col.minY + i * 16;
      for (let j = 0; j < 4096; j++) {
        const k = ore[sec.data.get(j)];
        if (!k) continue;
        const x = j & 15, z = (j >> 4) & 15, y = y0 + (j >> 8);
        if (!(open(x + 1, y, z) || open(x - 1, y, z) || open(x, y, z + 1) || open(x, y, z - 1) || open(x, y + 1, z) || open(x, y - 1, z))) continue;
        n[k]++;
        if (y < lo[k]) lo[k] = y;
        if (y > hi[k]) hi[k] = y;
      }
    }
    const out: Record<string, [number, number, number]> = {};
    for (let k = 1; k < N; k++) if (n[k]) out[ORE_KINDS[k - 1]] = [n[k], lo[k], hi[k]];
    return out;
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

  /** Chunks waiting to be summarised (a scout waits for them before it reports, step 2.4). */
  get pending() {
    return this.queue.size;
  }

  /** The share of chunk columns within `radius` blocks of x, z that have a summary. */
  known(x: number, z: number, radius: number): number {
    const r = Math.ceil(radius / 16), cx0 = x >> 4, cz0 = z >> 4;
    let all = 0, have = 0;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.hypot(dx * 16, dz * 16) > radius) continue;
        all++;
        if (this.chunks.has(`${cx0 + dx},${cz0 + dz}`)) have++;
      }
    return all ? have / all : 1;
  }

  /**
   * Animals a bot can see (opportunistic farming, 10-08): every tracked animal of ANIMAL_KINDS written where it is now;
   * one recorded within 32 blocks of the bot that the bot no longer tracks (the server tracks animals to 96) is gone.
   */
  seen(by: string, at: { x: number; y: number; z: number }, entities: Iterable<{ uuid?: string; name?: string; position: { x: number; y: number; z: number } }>) {
    const now = Date.now(), here = new Set<string>();
    for (const e of entities) {
      if (!e.uuid || !e.name || !ANIMAL_KINDS.has(e.name)) continue;
      here.add(e.uuid);
      this.missing.delete(e.uuid);
      const x = Math.floor(e.position.x), y = Math.floor(e.position.y), z = Math.floor(e.position.z);
      const had = this.animals.get(e.uuid);
      // (saved only when something changed much: not the 2 MB file every 30 s for animals wandering about, the reviews)
      if (!had || Math.hypot(had.x - x, had.z - z) > 8) this.unsaved = true;
      this.animals.set(e.uuid, { kind: e.name, x, y, z, t: now, by });
    }
    // Missing for over 10 s where a bot should see it (a bot just spawned or teleported tracks nothing for a moment, the
    // reviews; by time, not passes: two bots in one round would count twice)
    for (const [id, s] of this.animals)
      if (!here.has(id) && Math.hypot(s.x - at.x, s.z - at.z) <= 32 && Math.abs(s.y - at.y) <= 32) {
        const since = this.missing.get(id) ?? now;
        this.missing.set(id, since);
        if (now - since <= 10000) continue;
        this.animals.delete(id);
        this.missing.delete(id);
        this.unsaved = true;
      }
    for (const [id, since] of this.missing) if (now - since > 10 * 60000 || !this.animals.has(id)) this.missing.delete(id);
    if (this.animals.size > ANIMALS_MAX)
      for (const [id] of [...this.animals].sort((a, b) => a[1].t - b[1].t).slice(0, this.animals.size - ANIMALS_MAX)) this.animals.delete(id);
  }

  /** Plant sightings of a kind within `radius` blocks of x, z, nearest first: [x, y, z, columns in that chunk (cane: blocks over the stalks' bases)]. */
  sightings(kind: string, x: number, z: number, radius: number): Array<[number, number, number, number]> {
    const out: Array<[number, number, number, number]> = [];
    for (const s of this.near(x, z, radius)) {
      const p = s.plants?.[kind];
      if (p && Math.hypot(p[1] - x, p[3] - z) <= radius) out.push([p[1], p[2], p[3], p[0]]);
    }
    return out.sort((a, b) => Math.hypot(a[0] - x, a[2] - z) - Math.hypot(b[0] - x, b[2] - z));
  }

  /**
   * Animals of a kind seen within `radius` of x, z in the last `maxAge` ms, nearest first, except where `skip` says
   * (a village's ground and its pens: penned chickens are seen too, the pen design's review H3).
   */
  animalSightings(kind: string, x: number, z: number, radius: number, maxAge: number, skip?: (x: number, z: number) => boolean): Array<AnimalSighting & { id: string }> {
    const now = Date.now();
    const out: Array<AnimalSighting & { id: string }> = [];
    for (const [id, s] of this.animals)
      if (s.kind === kind && now - s.t <= maxAge && Math.hypot(s.x - x, s.z - z) <= radius && !skip?.(Math.floor(s.x), Math.floor(s.z))) out.push({ ...s, id });
    return out.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  }

  /** How the atlas is doing: chunks known and waiting, and the cost of a summary (ms). */
  status() {
    const t = [...this.times].sort((a, b) => a - b);
    const q = (f: number) => (t.length ? Math.round(t[Math.min(t.length - 1, Math.floor(f * t.length))] * 1000) / 1000 : 0);
    return { chunks: this.chunks.size, queued: this.queue.size, changed: this.changed.size, scans: this.stats.scans, ms: { median: q(0.5), p99: q(0.99), max: Math.round(this.stats.maxMs * 1000) / 1000 } };
  }

  save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify({ version: 1, chunks: [...this.chunks.values()], animals: Object.fromEntries(this.animals) }));
      this.unsaved = false;
      this.savedAt = Date.now();
    } catch (e) {
      console.error(`[atlas] could not save ${this.file}: ${(e as Error).message}`);
    }
  }

  private load() {
    if (!fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { chunks?: ChunkSummary[]; animals?: Record<string, AnimalSighting> };
      for (const s of data.chunks ?? []) this.chunks.set(`${s.cx},${s.cz}`, s);
      for (const [id, s] of Object.entries(data.animals ?? {})) this.animals.set(id, s);
      console.log(`[atlas] ${this.chunks.size} chunks from ${path.basename(this.file)}`);
    } catch (e) {
      console.error(`[atlas] could not read ${this.file}: ${(e as Error).message}; starting empty`);
    }
  }
}
