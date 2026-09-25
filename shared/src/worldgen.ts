import { B, makeState } from './blocks';
import { Biome, BIOMES } from './biomes';
import { Chunk } from './chunk';
import { SEA_LEVEL, WORLD_HEIGHT } from './constants';
import { hash2, hash3, mulberry32, SimplexNoise } from './noise';

const MARGIN = 3; // tree radius margin
const GRID = 16 + MARGIN * 2;

interface ColumnInfo {
  height: number;
  biome: number;
  /** 0..1 how mountainous */
  mountain: number;
  river: number;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Deterministic terrain generator. Given the same seed it produces identical chunks on any machine,
 * so chunks never need to be stored unless modified.
 */
export class WorldGenerator {
  readonly seed: number;
  private continental: SimplexNoise;
  private erosion: SimplexNoise;
  private peaks: SimplexNoise;
  private detail: SimplexNoise;
  private temp: SimplexNoise;
  private humid: SimplexNoise;
  private cave1: SimplexNoise;
  private cave2: SimplexNoise;
  private cheese: SimplexNoise;
  private riverN: SimplexNoise;
  private misc: SimplexNoise;

  constructor(seed: number) {
    this.seed = seed | 0;
    let s = this.seed;
    const next = () => (s = (Math.imul(s, 1664525) + 1013904223) | 0);
    this.continental = new SimplexNoise(next());
    this.erosion = new SimplexNoise(next());
    this.peaks = new SimplexNoise(next());
    this.detail = new SimplexNoise(next());
    this.temp = new SimplexNoise(next());
    this.humid = new SimplexNoise(next());
    this.cave1 = new SimplexNoise(next());
    this.cave2 = new SimplexNoise(next());
    this.cheese = new SimplexNoise(next());
    this.riverN = new SimplexNoise(next());
    this.misc = new SimplexNoise(next());
  }

  /** Terrain column info at world x,z (independent of chunks). */
  column(x: number, z: number): ColumnInfo {
    const c = this.continental.fbm2(x / 900, z / 900, 4) * 1.25 + 0.08;
    const e = this.erosion.fbm2(x / 420, z / 420, 3);
    const pk = this.peaks.ridged2(x / 420, z / 420, 3) * 0.8 + (this.peaks.fbm2(x / 160 + 31, z / 160, 2) * 0.5 + 0.5) * 0.2;
    const d = this.detail.fbm2(x / 55, z / 55, 4);
    const t = this.temp.fbm2(x / 1100, z / 1100, 3) + this.detail.noise2(x / 30, z / 30) * 0.03;
    const h = this.humid.fbm2(x / 900, z / 900, 3);

    // Rivers carve along a zero-crossing of low frequency noise.
    const rv = Math.abs(this.riverN.fbm2(x / 520, z / 520, 3));
    const river = 1 - smooth(0.0, 0.035, rv);
    const valley = 1 - smooth(0.0, 0.16, rv);

    // Base height from continentalness
    let base: number;
    if (c < -0.5) base = lerp(28, 40, smooth(-0.9, -0.5, c));
    else if (c < -0.18) base = lerp(40, 55, smooth(-0.5, -0.18, c));
    else if (c < -0.05) base = lerp(55, 63.5, smooth(-0.18, -0.05, c));
    else base = lerp(64, 74, smooth(-0.05, 0.6, c));

    const inland = smooth(-0.02, 0.25, c);
    const mountainMask = smooth(0.05, 0.45, e * -1 + 0.2) * inland;
    const mountain = mountainMask * smooth(0.4, 0.85, pk);
    const hills = (d * 0.5 + 0.5) * lerp(4, 16, smooth(-0.4, 0.6, -e)) * inland;
    let height = base + hills * 0.6 + d * 3 * (1 - inland * 0.3);
    height += mountain * 72 * (0.55 + 0.45 * pk);
    // Carve rivers on land (not mountains)
    if (height > SEA_LEVEL - 2 && valley > 0) {
      const target = SEA_LEVEL - 3 - river * 2;
      const t = Math.max(river, valley * valley * 0.85);
      height = lerp(height, target, t * (1 - smooth(0.2, 0.6, mountain)));
    }

    const hInt = Math.floor(height);
    let biome: number;
    const temperature = t;
    if (hInt < SEA_LEVEL - 12) biome = c < -0.5 ? Biome.DeepOcean : Biome.Ocean;
    else if (hInt < SEA_LEVEL - 1) biome = river > 0.5 && c > -0.1 ? (temperature < -0.35 ? Biome.SnowyPlains : Biome.Plains) : Biome.Ocean;
    else if (hInt <= SEA_LEVEL + 1 && mountain < 0.1 && river < 0.3) biome = temperature < -0.35 ? Biome.SnowyPlains : temperature > 0.35 ? Biome.Desert : Biome.Beach;
    else if (mountain > 0.35 || hInt > 115) biome = hInt > 120 || temperature < -0.2 ? Biome.SnowyPeaks : Biome.Mountains;
    else if (temperature < -0.35) biome = h > 0 ? Biome.SnowyTaiga : Biome.SnowyPlains;
    else if (temperature < -0.12) biome = Biome.Taiga;
    else if (temperature > 0.35) biome = h < 0.1 ? Biome.Desert : Biome.Savanna;
    else if (h > 0.35 && temperature > 0.1) biome = Biome.Swamp;
    else if (h > 0.05) biome = temperature > 0.05 ? Biome.Forest : Biome.BirchForest;
    else if (h < -0.35) biome = Biome.Meadow;
    else biome = Biome.Plains;
    // Swamps sink smoothly towards sea level (no cliffs at biome borders)
    const swampiness = smooth(0.25, 0.5, h) * smooth(0.0, 0.25, temperature) * (1 - smooth(0.05, 0.3, mountain));
    if (swampiness > 0) height = lerp(height, Math.min(height, SEA_LEVEL + 1 + d * 1.5), swampiness);
    return { height: Math.floor(height), biome, mountain, river };
  }

  generate(cx: number, cz: number): Chunk {
    const chunk = new Chunk(cx, cz);
    const blocks = chunk.blocks;
    const bx = cx * 16, bz = cz * 16;
    const cols: ColumnInfo[] = new Array(GRID * GRID);
    for (let z = 0; z < GRID; z++)
      for (let x = 0; x < GRID; x++) cols[z * GRID + x] = this.column(bx + x - MARGIN, bz + z - MARGIN);
    const col = (x: number, z: number) => cols[(z + MARGIN) * GRID + (x + MARGIN)];
    const rand = mulberry32((hash2(this.seed, cx, cz) * 4294967296) >>> 0);
    const set = (x: number, y: number, z: number, v: number) => {
      if (y >= 0 && y < WORLD_HEIGHT) blocks[x | (z << 4) | (y << 8)] = v;
    };
    const get = (x: number, y: number, z: number) => blocks[x | (z << 4) | (y << 8)];

    // ---- Terrain columns ----
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const info = col(x, z);
        const h = info.height;
        const wx = bx + x, wz = bz + z;
        const bio = info.biome;
        chunk.biomes[x | (z << 4)] = bio;
        const slope = Math.max(
          Math.abs(col(x + 1, z).height - col(x - 1, z).height),
          Math.abs(col(x, z + 1).height - col(x, z - 1).height),
        );
        const dirtDepth = 3 + Math.floor(hash2(this.seed + 7, wx, wz) * 2);
        let top = B.grass, filler = B.dirt;
        const underwater = h < SEA_LEVEL;
        if (bio === Biome.Desert) { top = B.sand; filler = B.sand; }
        else if (bio === Biome.Beach) { top = B.sand; filler = B.sand; }
        else if (bio === Biome.Ocean || bio === Biome.DeepOcean) {
          const n = this.misc.noise2(wx / 30, wz / 30);
          top = n > 0.3 ? B.gravel : n < -0.4 ? B.clay : B.sand;
          filler = top === B.clay ? B.clay : B.sand;
          if (bio === Biome.DeepOcean) { top = B.gravel; filler = B.gravel; }
        } else if (bio === Biome.Mountains || bio === Biome.SnowyPeaks) {
          if (slope > 3 || h > 128) { top = B.stone; filler = B.stone; }
          if (bio === Biome.SnowyPeaks && slope <= 5) top = B.snowBlock;
          if (bio === Biome.Mountains && h > 105 && slope <= 3) top = B.grass;
        } else if (underwater) {
          top = info.river > 0.4 ? (this.misc.noise2(wx / 12, wz / 12) > 0.2 ? B.clay : B.sand) : B.dirt;
          filler = B.dirt;
          if (h < SEA_LEVEL - 4) top = B.gravel;
        }
        // Steep slopes expose stone (like Minecraft cliffs), with a thin dirt layer on moderate ones
        if (!underwater && top === B.grass && slope >= 5 + (hash2(this.seed + 3, wx, wz) < 0.5 ? 1 : 0)) { top = B.stone; filler = B.stone; }
        else if (!underwater && top === B.grass && slope >= 4) filler = B.stone;

        for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
          let v: number;
          if (y === 0) v = B.bedrock;
          else if (y < 5 && hash3(this.seed, wx, y, wz) < (5 - y) / 5) v = B.bedrock;
          else if (y < h - dirtDepth) v = B.stone;
          else if (y < h) v = filler;
          else if (y === h) v = top;
          else v = y <= SEA_LEVEL ? B.water : 0;
          if (filler === B.sand && y < h - 1 && y >= h - dirtDepth - 3 && v !== B.bedrock) v = y < h - dirtDepth ? B.sandstone : v;
          if (v) blocks[x | (z << 4) | (y << 8)] = v;
        }
        // Frozen surface water
        const b = BIOMES[bio];
        if (b.snowy && h < SEA_LEVEL) set(x, SEA_LEVEL, z, B.ice);
        // Snowy grass & snow layer
        if (b.snowy && h >= SEA_LEVEL && (top === B.grass || top === B.stone)) {
          if (top === B.grass) set(x, h, z, makeState(B.grass, 1));
          set(x, h + 1, z, B.snow);
        }
      }

    // ---- Stone variants, dirt & gravel blobs, ores ----
    const blob = (ore: number, count: number, size: number, minY: number, maxY: number, replace: (id: number) => boolean) => {
      for (let i = 0; i < count; i++) {
        let x = rand() * 16, y = minY + rand() * (maxY - minY), z = rand() * 16;
        const n = Math.max(1, Math.round(size * (0.5 + rand())));
        for (let j = 0; j < n; j++) {
          const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
          if (ix >= 0 && ix < 16 && iz >= 0 && iz < 16 && iy > 0 && iy < WORLD_HEIGHT && replace(get(ix, iy, iz))) set(ix, iy, iz, ore);
          x += rand() * 2 - 1; y += rand() * 2 - 1; z += rand() * 2 - 1;
        }
      }
    };
    const isStone = (id: number) => id === B.stone;
    blob(B.granite, 3, 30, 5, 90, isStone);
    blob(B.diorite, 3, 30, 5, 90, isStone);
    blob(B.andesite, 3, 30, 5, 90, isStone);
    blob(B.dirt, 3, 25, 5, 100, isStone);
    blob(B.gravel, 3, 25, 5, 100, isStone);
    blob(B.coalOre, 20, 12, 5, 130, isStone);
    blob(B.ironOre, 14, 7, 5, 72, isStone);
    blob(B.goldOre, 3, 7, 5, 34, isStone);
    blob(B.lapisOre, 2, 6, 5, 32, isStone);
    blob(B.redstoneOre, 6, 6, 5, 18, isStone);
    blob(B.diamondOre, 2, 5, 5, 17, isStone);
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const info = col(x, z);
        if (info.biome === Biome.Mountains && rand() < 0.02) {
          const y = 30 + Math.floor(rand() * 60);
          if (get(x, y, z) === B.stone) set(x, y, z, B.emeraldOre);
        }
      }

    // ---- Caves (interpolated 3D noise) ----
    this.carveCaves(chunk, col);

    // ---- Vegetation & trees ----
    this.decorate(chunk, col, rand);

    chunk.recomputeHeightmap();
    return chunk;
  }

  private carveCaves(chunk: Chunk, col: (x: number, z: number) => ColumnInfo) {
    const blocks = chunk.blocks;
    const bx = chunk.cx * 16, bz = chunk.cz * 16;
    // Sample noise on a 4x4x4 lattice and trilinearly interpolate.
    const SX = 5, SY = 33, SZ = 5; // lattice points (0..16 step 4, 0..128 step 4)
    const sp = new Float32Array(SX * SY * SZ);
    const ch = new Float32Array(SX * SY * SZ);
    for (let lz = 0; lz < SZ; lz++)
      for (let ly = 0; ly < SY; ly++)
        for (let lx = 0; lx < SX; lx++) {
          const wx = bx + lx * 4, wy = ly * 4, wz = bz + lz * 4;
          const i = (lz * SY + ly) * SX + lx;
          const a = this.cave1.noise3(wx / 48, wy / 32, wz / 48);
          const b = this.cave2.noise3(wx / 48, wy / 32, wz / 48);
          sp[i] = a * a + b * b; // spaghetti tunnels where both are near zero
          ch[i] = this.cheese.fbm3(wx / 90, wy / 45, wz / 90, 2);
        }
    const sample = (arr: Float32Array, x: number, y: number, z: number) => {
      const fx = x / 4, fy = y / 4, fz = z / 4;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
      const tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const x1 = Math.min(x0 + 1, SX - 1), y1 = Math.min(y0 + 1, SY - 1), z1 = Math.min(z0 + 1, SZ - 1);
      const I = (X: number, Y: number, Z: number) => arr[(Z * SY + Y) * SX + X];
      const c00 = lerp(I(x0, y0, z0), I(x1, y0, z0), tx);
      const c10 = lerp(I(x0, y1, z0), I(x1, y1, z0), tx);
      const c01 = lerp(I(x0, y0, z1), I(x1, y0, z1), tx);
      const c11 = lerp(I(x0, y1, z1), I(x1, y1, z1), tx);
      return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
    };
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const info = col(x, z);
        const surface = info.height;
        const nearWater = surface < SEA_LEVEL + 2;
        const maxY = Math.min(127, nearWater ? surface - 8 : surface + 1);
        for (let y = 1; y <= maxY; y++) {
          const i = x | (z << 4) | (y << 8);
          const id = blocks[i] & 0xff;
          if (id === B.bedrock || id === B.water || id === 0) continue;
          const s = sample(sp, x, y, z);
          const depthFade = y > surface - 4 ? 0.5 : 1; // narrower openings at the surface
          let carve = s < 0.012 * depthFade;
          if (!carve && y < 60) {
            const c = sample(ch, x, y, z);
            carve = c > 0.52 - (60 - y) * 0.002;
          }
          if (carve) {
            blocks[i] = y <= 10 ? B.lava : 0;
            // Grass under a removed block? turn exposed dirt below into grass later (not needed)
          }
        }
      }
    // Any dirt directly below a cave opening at the surface stays dirt; fix floating plants/snow later.
  }

  private decorate(chunk: Chunk, col: (x: number, z: number) => ColumnInfo, rand: () => number) {
    const blocks = chunk.blocks;
    const bx = chunk.cx * 16, bz = chunk.cz * 16;
    const get = (x: number, y: number, z: number) => (y < 0 || y >= WORLD_HEIGHT ? 0 : blocks[x | (z << 4) | (y << 8)]);
    const inChunk = (x: number, z: number) => x >= 0 && x < 16 && z >= 0 && z < 16;
    const place = (x: number, y: number, z: number, v: number, force = false) => {
      if (!inChunk(x, z) || y <= 0 || y >= WORLD_HEIGHT) return;
      const i = x | (z << 4) | (y << 8);
      const cur = blocks[i] & 0xff;
      if (force || cur === 0 || cur === B.shortGrass || cur === B.snow || cur === B.fern) blocks[i] = v;
    };

    // Trees: check every column in the chunk plus margin so trees crossing borders are consistent.
    for (let z = -MARGIN; z < 16 + MARGIN; z++)
      for (let x = -MARGIN; x < 16 + MARGIN; x++) {
        const wx = bx + x, wz = bz + z;
        const info = col(x, z);
        const bio = info.biome;
        let density = 0;
        switch (bio) {
          case Biome.Forest: density = 0.09; break;
          case Biome.BirchForest: density = 0.08; break;
          case Biome.Taiga: density = 0.07; break;
          case Biome.SnowyTaiga: density = 0.05; break;
          case Biome.Plains: density = 0.004; break;
          case Biome.Meadow: density = 0.002; break;
          case Biome.Savanna: density = 0.006; break;
          case Biome.Swamp: density = 0.03; break;
          case Biome.Mountains: density = 0.012; break;
          case Biome.SnowyPlains: density = 0.003; break;
        }
        if (density === 0) continue;
        // Clumping noise makes forests patchy
        const clump = this.misc.noise2(wx / 40, wz / 40) * 0.5 + 0.75;
        const r = hash2(this.seed ^ 0x7ee, wx, wz);
        if (r > density * clump) continue;
        const h = info.height;
        if (h < SEA_LEVEL || h > 150) continue;
        // Must be on grass-ish flat-ish ground
        const slope = Math.abs(col(Math.min(x + 1, 16 + MARGIN - 1), z).height - h) + Math.abs(col(x, Math.min(z + 1, 16 + MARGIN - 1)).height - h);
        if (slope > 2) continue;
        if (inChunk(x, z)) {
          const ground = get(x, h, z) & 0xff;
          if (ground !== B.grass && ground !== B.dirt) continue;
        }
        const tr = hash2(this.seed ^ 0x1234, wx, wz);
        let kind: 'oak' | 'birch' | 'spruce' | 'bigoak' = 'oak';
        if (bio === Biome.BirchForest) kind = tr < 0.8 ? 'birch' : 'oak';
        else if (bio === Biome.Forest) kind = tr < 0.2 ? 'birch' : tr > 0.93 ? 'bigoak' : 'oak';
        else if (bio === Biome.Taiga || bio === Biome.SnowyTaiga || bio === Biome.SnowyPlains || bio === Biome.Mountains) kind = 'spruce';
        const snowy = BIOMES[bio].snowy;
        this.tree(kind, x, h + 1, z, hash2(this.seed ^ 0x55, wx, wz), place, snowy);
        if (inChunk(x, z)) blocks[x | (z << 4) | (h << 8)] = B.dirt;
      }

    // Ground cover
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const info = col(x, z);
        const h = info.height;
        const wx = bx + x, wz = bz + z;
        const ground = get(x, h, z) & 0xff;
        const above = get(x, h + 1, z) & 0xff;
        if (above !== 0) continue;
        if (h < SEA_LEVEL) continue;
        const r = rand();
        const bio = info.biome;
        if (ground === B.grass) {
          const flowerNoise = this.misc.noise2(wx / 18 + 100, wz / 18);
          let grassChance = 0.12;
          if (bio === Biome.Plains || bio === Biome.Meadow) grassChance = 0.35;
          if (bio === Biome.Savanna) grassChance = 0.45;
          if (bio === Biome.Forest || bio === Biome.BirchForest) grassChance = 0.18;
          if (bio === Biome.Taiga) grassChance = 0.12;
          if (r < grassChance) place(x, h + 1, z, bio === Biome.Taiga || bio === Biome.Swamp ? (rand() < 0.5 ? B.fern : B.shortGrass) : B.shortGrass);
          else if (flowerNoise > 0.45 && r < grassChance + (bio === Biome.Meadow ? 0.2 : 0.06)) {
            const f = hash2(this.seed ^ 99, Math.floor(wx / 8), Math.floor(wz / 8));
            place(x, h + 1, z, f < 0.45 ? B.dandelion : f < 0.8 ? B.poppy : B.cornflower);
          } else if (r > 0.9993) place(x, h + 1, z, B.pumpkin);
          else if (bio === Biome.Taiga && r > 0.995) place(x, h + 1, z, rand() < 0.5 ? B.redMushroom : B.brownMushroom);
          else if (bio === Biome.Plains && r > 0.9992) place(x, h + 1, z, B.melon);
        } else if (ground === B.sand) {
          if (bio === Biome.Desert) {
            if (r < 0.006) {
              const ht = 1 + Math.floor(rand() * 3);
              const clear = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([ox, oz]) => !inChunk(x + ox, z + oz) || (get(x + ox, h + 1, z + oz) & 0xff) === 0);
              if (clear) for (let i = 1; i <= ht; i++) place(x, h + i, z, B.cactus);
            } else if (r < 0.012) place(x, h + 1, z, B.deadBush);
          }
        }
        // Sugar cane next to water
        if ((ground === B.grass || ground === B.sand) && h === SEA_LEVEL && r > 0.8) {
          const water = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oz]) => inChunk(x + ox, z + oz) && (get(x + ox, h, z + oz) & 0xff) === B.water);
          if (water) {
            const ht = 1 + Math.floor(rand() * 3);
            for (let i = 1; i <= ht; i++) place(x, h + i, z, B.sugarCane);
          }
        }
      }
    // Seagrass-free oceans; clay handled in surface.
  }

  private tree(
    kind: 'oak' | 'birch' | 'spruce' | 'bigoak',
    x: number, y: number, z: number, r: number,
    place: (x: number, y: number, z: number, v: number, force?: boolean) => void,
    snowy: boolean,
  ) {
    const rnd = mulberry32((r * 1e9) | 0);
    if (kind === 'spruce') {
      const height = 7 + Math.floor(rnd() * 4);
      const log = makeState(B.spruceLog, 0), leaf = B.spruceLeaves;
      let radius = 0;
      const top = y + height;
      for (let ly = top; ly >= y + 2; ly--) {
        for (let dx = -radius; dx <= radius; dx++)
          for (let dz = -radius; dz <= radius; dz++) {
            if (Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 0) continue;
            place(x + dx, ly, z + dz, leaf);
            if (snowy && ly >= top - 1 - 0) place(x + dx, ly + 1, z + dz, B.snow);
          }
        radius = radius >= 2 + (ly < y + 5 ? 1 : 0) ? 1 : radius + 1;
      }
      place(x, top + 1, z, leaf);
      if (snowy) place(x, top + 2, z, B.snow);
      for (let i = 0; i < height; i++) place(x, y + i, z, log, true);
      return;
    }
    const isBirch = kind === 'birch';
    const log = isBirch ? B.birchLog : B.oakLog;
    const leaf = isBirch ? B.birchLeaves : B.oakLeaves;
    const height = (isBirch ? 5 : 4) + Math.floor(rnd() * 3) + (kind === 'bigoak' ? 3 : 0);
    const top = y + height;
    for (let ly = top - 3; ly <= top; ly++) {
      const rr = ly >= top - 1 ? 1 : 2;
      for (let dx = -rr; dx <= rr; dx++)
        for (let dz = -rr; dz <= rr; dz++) {
          const corner = Math.abs(dx) === rr && Math.abs(dz) === rr;
          if (corner && (ly === top || rnd() < 0.5)) continue;
          place(x + dx, ly, z + dz, leaf);
        }
    }
    if (kind === 'bigoak') {
      // Extra canopy blobs for a fuller silhouette
      for (let b = 0; b < 4; b++) {
        const ox = Math.round((rnd() - 0.5) * 2), oz = Math.round((rnd() - 0.5) * 2), oy = top - 2 - Math.floor(rnd() * 3);
        for (let dx = -2; dx <= 2; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -2; dz <= 2; dz++)
              if (dx * dx + dy * dy * 2 + dz * dz <= 5) place(x + ox + dx, oy + dy, z + oz + dz, leaf);
      }
    }
    for (let i = 0; i < height; i++) place(x, y + i, z, log, true);
    void snowy;
  }

  /** Find a safe spawn point near the origin. */
  findSpawn(): { x: number; y: number; z: number } {
    for (let r = 0; r < 2000; r += 16) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        const c = this.column(x, z);
        if (c.height > SEA_LEVEL + 1 && c.height < 100 && c.biome !== Biome.Desert && c.mountain < 0.2) return { x: x + 0.5, y: c.height + 1, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: 100, z: 0.5 };
  }
}
