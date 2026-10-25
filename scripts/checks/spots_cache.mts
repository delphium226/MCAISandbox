/**
 * #149: the small-work spot search (mcWorld.ts smallWorkSpot, smallWorks.ts gardenSpots / smallWorkSpots) kept with
 * smallBlocked's cached areas, and gardenSpots' tile index (areaIndex). On a checkpoint loaded into a real
 * MineflayerWorld (no server, seconds):
 *   A. gardenSpots with the index gives the plain list's answer (the old code, kept here), on the village's own areas
 *      and doors with every column taken as soil (offline there is no bot to read it), and is timed against it;
 *   B. smallWorkSpot for every menu kind and 25 members, warm (the cache) against cold (the cache cleared before each):
 *      the same spots, and a sweep's time both ways;
 *   C. a change smallBlocked's signature reads (an initiative opened on a found spot) gives fresh spots, not the kept ones.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/spots_cache.mts [CHECKPOINT_DIR]   (default
 * mc/testcheckpoints/iron_age_g1, train 4's pad village grown outward; im2_mine if that is not here)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const cpDir = process.argv[2] ?? (fs.existsSync('mc/testcheckpoints/iron_age_g1/villages.json') ? 'mc/testcheckpoints/iron_age_g1' : 'mc/testcheckpoints/im2_mine');
const villagesFile = path.join(cpDir, 'villages.json');
if (!fs.existsSync(villagesFile)) {
  console.log(`SKIP spots_cache: ${villagesFile} is not here`);
  process.exit(0);
}
process.env.MC_GROW = '0';
process.env.MC_MODEL_RECORD = '0';
process.env.MC_GARDENS = 'on';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'spots-cache-'));
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
process.env.MCAI_ACTS_LOG = path.join(SCRATCH, 'acts.jsonl');
const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const mute = () => { console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const unmute = () => Object.assign(console, quiet);
let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    quiet.log(`FAIL ${what}`);
  }
};

mute();
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const SW = await import('../../server/src/smallWorks');
const { placedDoor } = await import('../../server/src/streetPlan');
unmute();
const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
fs.copyFileSync(villagesFile, path.join(dir, 'villages.json'));
const data = JSON.parse(fs.readFileSync(villagesFile, 'utf8')) as { villages: Any[] };
const base = data.villages.find((x) => x.complete) ?? data.villages[0];
mute();
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
unmute();
w.villages.save = () => {};
const v = w.villages.get(base.name);

// A: the indexed gardenSpots against the plain list (the old code)
const inArea = (a: Any, x: number, z: number) => x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2;
function gardenSpotsPlain(input: Any): Any[] {
  const free = (x: number, z: number, y: number) => !input.hard.some((a: Any) => inArea(a, x, z)) && input.soil(x, z, y);
  const out: Any[] = [];
  const plant = (kind: string, d: Any, x1: number, z1: number, y: number) => {
    const cells: Any[] = [];
    const top = d.layers[1];
    for (let j = 0; j < top.length; j++) for (let i = 0; i < top[j].length; i++) if (top[j][i] === 'F') cells.push({ x: x1 + i, z: z1 + j });
    if (!cells.every((c) => free(c.x, c.z, y))) return;
    const box = { x1: x1 - 1, z1: z1 - 1, x2: x1 + d.width, z2: z1 + d.depth };
    if ((input.structures ?? input.hard).some((a: Any) => a.x1 <= box.x2 && a.x2 >= box.x1 && a.z1 <= box.z2 && a.z2 >= box.z1)) return;
    out.push({ kind, x: x1 + Math.floor(d.width / 2), y, z: z1 + Math.floor(d.depth / 2), cells });
  };
  const bed = SW.smallWorkKind('front_bed')!.make('oak'), ring = SW.smallWorkKind('flower_ring')!.make('oak');
  for (const dr of input.doors) {
    if (Math.abs(dr.ox) + Math.abs(dr.oz) !== 1) continue;
    const px = dr.oz !== 0 ? 1 : 0, pz = dr.ox !== 0 ? 1 : 0;
    const n = out.length;
    find: for (let k = 1; k <= 6; k++) for (let lat = 2; lat <= 6; lat++) for (const side of [-1, 1]) {
      const ax = dr.x + dr.ox * k + px * side * lat, az = dr.z + dr.oz * k + pz * side * lat;
      const bx = ax + dr.ox + px * side, bz = az + dr.oz + pz * side;
      plant('front_bed', bed, Math.min(ax, bx), Math.min(az, bz), dr.y);
      if (out.length > n) break find;
    }
  }
  for (const g of input.greens) plant('flower_ring', ring, g.x - 2, g.z - 2, g.y);
  const corners = [...input.greens.filter((g: Any) => g.x1 !== undefined).map((g: Any) => ({ x1: g.x1, z1: g.z1, x2: g.x2, z2: g.z2, y: g.y })), ...(input.plots ?? [])];
  for (const a of corners) {
    if (a.x2 - a.x1 < 6 || a.z2 - a.z1 < 6) continue;
    for (const [x, z] of [[a.x1 + 2, a.z1 + 2], [a.x2 - 2, a.z1 + 2], [a.x1 + 2, a.z2 - 2], [a.x2 - 2, a.z2 - 2]]) {
      let clear = input.soil(x, z, a.y);
      for (let dx = -2; dx <= 2 && clear; dx++) for (let dz = -2; dz <= 2 && clear; dz++) if (input.hard.some((h: Any) => inArea(h, x + dx, z + dz))) clear = false;
      if (clear) out.push({ kind: 'sapling', x, y: a.y, z, cells: [{ x, z }] });
    }
  }
  return out;
}
mute();
const e = w.smallBlocked(v);
const doors: Any[] = [];
for (const P of w.lightParts(v)) {
  const door = P.kind === 'building' && P.place ? placedDoor(P.place) : null;
  if (door && P.structure) doors.push({ x: door.x, z: door.z, ox: door.ox, oz: door.oz, y: P.structure.y });
}
const greens = v.plots.filter((p: Any) => p.green).map((p: Any) => ({ x: Math.floor((p.x1 + p.x2) / 2), z: Math.floor((p.z1 + p.z2) / 2), y: p.y, x1: p.x1, z1: p.z1, x2: p.x2, z2: p.z2 }));
// (every column soil but a few, so both keep and drop spots by the soil too)
const soil = (x: number, z: number) => (x * 7 + z * 13) % 11 !== 0;
const input = { doors, greens, plots: e.plots, hard: e.hard, structures: e.own, soil };
const time = (f: () => unknown, n: number) => {
  const t = performance.now();
  for (let i = 0; i < n; i++) f();
  return (performance.now() - t) / n;
};
const plainOut = gardenSpotsPlain(input), indexOut = SW.gardenSpots(input);
const tPlain = time(() => gardenSpotsPlain(input), 5), tIndex = time(() => SW.gardenSpots(input), 5);
unmute();
ok(JSON.stringify(plainOut) === JSON.stringify(indexOut), `A: indexed gardenSpots differs (${indexOut.length} spots against ${plainOut.length})`);
ok(plainOut.length > 0, 'A: no garden spot to compare');
quiet.log(`  A: ${doors.length} doors, ${e.hard.length} hard areas, ${e.own.length} footprints: ${indexOut.length} garden spots; plain ${tPlain.toFixed(1)} ms, indexed ${tIndex.toFixed(2)} ms a call`);

// B: smallWorkSpot warm against cold, every menu kind for 25 members
const kinds = SW.menuWorks(v.vanillaBiome).filter((k: Any) => !k.drawn);
const wood = 'birch';
const members = Array.from({ length: 25 }, (_, i) => `M${i}`);
const sweep = (cold: boolean) => {
  const out: string[] = [];
  for (const m of members) for (const k of kinds) {
    if (cold) w.smallBlockedCache.clear();
    out.push(JSON.stringify(w.smallWorkSpot(v, k, wood, m)));
  }
  return out;
};
mute();
const tCold0 = performance.now();
const coldOut = sweep(true);
const tCold = performance.now() - tCold0;
sweep(false);
const tWarm0 = performance.now();
const warmOut = sweep(false);
const tWarm = performance.now() - tWarm0;
unmute();
ok(JSON.stringify(coldOut) === JSON.stringify(warmOut), 'B: cached spots differ from a cold search');
// (offline there is no bot to read the ground between a pad village's pads, so only its gardens are found there)
const pads = v.plots.some((p: Any) => p.pads);
ok(pads || warmOut.some((x) => x !== 'null'), 'B: no spot found for any kind');
quiet.log(`  B: ${kinds.length} kinds x ${members.length} members: cold ${tCold.toFixed(0)} ms a sweep, cached ${tWarm.toFixed(1)} ms; ${warmOut.filter((x) => x !== 'null').length} spots`);

// C: an initiative opened on a found spot: the signature changes and the spot is not offered again
mute();
const k0 = kinds.find((k: Any) => !SW.isGarden(k.kind) && w.smallWorkSpot(v, k, wood, 'M0'));
const sp = k0 ? w.smallWorkSpot(v, k0, wood, 'M0') : null;
unmute();
if (k0 && sp) {
  (v.initiatives ??= []).push({ id: 'ichk', kind: k0.kind, design: '', x: sp.x, y: sp.y, z: sp.z, state: 'open', crew: [], started: Date.now() });
  mute();
  const after = members.map((m) => w.smallWorkSpot(v, k0, wood, m));
  w.smallBlockedCache.clear();
  const fresh = members.map((m) => w.smallWorkSpot(v, k0, wood, m));
  unmute();
  ok(!after.some((q: Any) => q && q.x === sp.x && q.z === sp.z), 'C: the opened initiative\'s spot is still offered');
  ok(JSON.stringify(after) === JSON.stringify(fresh), 'C: spots after the change differ from a cold search');
} else if (pads) quiet.log('  C: skipped (a pad village: no spot offline)');
else ok(false, 'C: no non-garden spot to open an initiative on');

quiet.log(`  ${base.name} (${cpDir})`);
quiet.log(`${failures ? 'FAIL' : 'PASS'}: ${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
