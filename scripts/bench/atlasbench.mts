// Cost of summarising a chunk for the village atlas (plan step 2.1), on real chunks: a bot joins the Paper server,
// waits for its chunks, then summarises each loaded chunk with block state ids read straight from the column (and,
// for comparison, with bot.blockAt as find_site's surfaceAt does). No agent server needed; the name must be
// whitelisted and not in use. Run: node_modules/.bin/tsx scripts/bench/atlasbench.mts [name]
import mineflayer from 'mineflayer';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';

const name = process.argv[2] ?? 'Gus';
const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565, username: name, version: '26.1', auth: 'offline' });
const reg = minecraftData('26.1');

// One category per block state: 0 air/passable, 1 log, 2 leaves, 3 liquid, 4 ground
const LOG = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/;
const cat = new Uint8Array(reg.blocksArray.reduce((m, b) => Math.max(m, b.maxStateId + 1), 0));
const logKind = new Uint8Array(cat.length);
const kinds: string[] = [];
for (const b of reg.blocksArray) {
  const m = LOG.exec(b.name);
  let c = 0;
  if (m) {
    c = 1;
    if (!kinds.includes(m[1])) kinds.push(m[1]);
  } else if (b.name.endsWith('_leaves')) c = 2;
  else if (/^(water|lava|bubble_column|seagrass|tall_seagrass|kelp|kelp_plant)$/.test(b.name)) c = 3;
  else if (b.boundingBox === 'block' && !/_wood$|_stem$|cactus|bamboo|mushroom_block/.test(b.name)) c = 4;
  for (let s = b.minStateId; s <= b.maxStateId; s++) {
    cat[s] = c;
    if (m) logKind[s] = kinds.indexOf(m[1]);
  }
}

interface Col { minY: number; worldHeight: number; sections: Array<{ solidBlockCount: number } | null>; getBlockStateId(p: { x: number; y: number; z: number }): number }

function summarise(col: Col) {
  let top = -1;
  for (let i = col.sections.length - 1; i >= 0; i--) if (col.sections[i] && col.sections[i]!.solidBlockCount > 0) { top = i; break; }
  const heights: number[] = [];
  let water = 0, logs = 0, lowLogs = 0, reads = 0;
  const logYs: number[] = [];
  const p = { x: 0, y: 0, z: 0 };
  const yTop = col.minY + top * 16 + 15, yBottom = Math.max(col.minY, yTop - 120);
  for (p.z = 0; p.z < 16; p.z++)
    for (p.x = 0; p.x < 16; p.x++) {
      logYs.length = 0;
      for (p.y = yTop; p.y >= yBottom; p.y--) {
        reads++;
        const c = cat[col.getBlockStateId(p)];
        if (c === 0 || c === 2) continue;
        if (c === 1) { logYs.push(p.y); continue; }
        if (c === 3) water++;
        else heights.push(p.y);
        for (const y of logYs) { logs++; if (y - p.y <= 5) lowLogs++; }
        break;
      }
    }
  return { heights: heights.length, water, logs, lowLogs, reads };
}

/** find_site's way: bot.blockAt per block (a Block object each). */
function surfaceWay(cx: number, cz: number, yHint: number) {
  const v = new Vec3(0, 0, 0);
  let n = 0;
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++)
      for (let y = yHint + 32; y > yHint - 48; y--) {
        const b = bot.blockAt(v.set(cx * 16 + x, y, cz * 16 + z));
        if (!b) break;
        if (b.name === 'air' || b.name === 'cave_air') continue;
        n++;
        if (b.boundingBox === 'block' && !/leaves|_log$/.test(b.name)) break;
      }
  return n;
}

bot.once('spawn', async () => {
  await bot.waitForChunksToLoad();
  const p = bot.entity.position;
  const cx0 = Math.floor(p.x / 16), cz0 = Math.floor(p.z / 16);
  const world = bot.world as unknown as { getColumn(x: number, z: number): Col | null };
  const times: number[] = [], old: number[] = [];
  let reads = 0, logs = 0, lowLogs = 0, water = 0, chunks = 0;
  for (let round = 0; round < 3; round++) // the first round warms the JIT
    for (let dz = -8; dz <= 8; dz++)
      for (let dx = -8; dx <= 8; dx++) {
        const col = world.getColumn(cx0 + dx, cz0 + dz);
        if (!col) continue;
        const t = performance.now();
        const s = summarise(col);
        const dt = performance.now() - t;
        if (round === 2) {
          times.push(dt);
          reads += s.reads; logs += s.logs; lowLogs += s.lowLogs; water += s.water; chunks++;
          if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) {
            const t2 = performance.now();
            surfaceWay(cx0 + dx, cz0 + dz, Math.floor(p.y));
            old.push(performance.now() - t2);
          }
        }
      }
  times.sort((a, b) => a - b);
  const q = (f: number) => times[Math.min(times.length - 1, Math.floor(f * times.length))].toFixed(3);
  console.log(`at ${p.floored()}: ${chunks} chunks, per chunk ms: median ${q(0.5)}, p90 ${q(0.9)}, p99 ${q(0.99)}, max ${q(1)}; ${Math.round(reads / chunks)} reads a chunk`);
  console.log(`logs ${logs} (low ${lowLogs}), water columns ${water}; bot.blockAt way for 9 chunks: ${old.map((t) => t.toFixed(1)).join(', ')} ms`);
  bot.quit();
});
bot.on('kicked', (r) => { console.log('kicked', r); process.exit(1); });
bot.on('error', (e) => { console.log('error', e.message); process.exit(1); });
