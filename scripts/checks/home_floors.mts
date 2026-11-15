/**
 * MC_HOME_FLOORS checked on a saved village (the user's 11-15: "some of the houses being built don't have floors"): a
 * checkpoint loaded into a real MineflayerWorld (no server, seconds), and for every owned dwelling its decorParts' bare
 * floor cells (bareFloorCells: the inside cells whose floor layer the design leaves to the ground):
 * - inside the structure's box, as many as its design's inside "_" floor cells, none for a design with a floor;
 * - with the checkpoint's saved world (its region files, scripts/checks/region_blocks.py), each bare cell read at the
 *   structure's y is ground (grass, dirt, path, cobblestone...), never a placed block: the floor chore covers exactly the
 *   grass inside (this is where the rotation of a placed home would go wrong);
 * - the floor's cost (floorCost) paid by the checkpoint's storage;
 * then prints each owned house: its kind, bare cells, the floor's cost and its decoration slots (MC_DECOR_MORE's count).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/home_floors.mts [CHECKPOINT_DIR]   (default
 *        mc/testcheckpoints/rt_base: 11 generated homes drawn with floor none)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const cpDir = process.argv[2] ?? 'mc/testcheckpoints/rt_base';
const villagesFile = path.join(cpDir, 'villages.json');
if (!fs.existsSync(villagesFile)) {
  console.log(`SKIP home_floors: ${villagesFile} is not here`);
  process.exit(0);
}
process.env.MC_GROW = '0';
process.env.MC_MODEL_RECORD = '0';
process.env.MC_HOUSE_DECOR ??= 'on';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'home-floors-'));
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
const { floorCost, homeWood } = await import('../../server/src/mineflayer/mcHome');
const { storageContents } = await import('../../server/src/mineflayer/mcStorage');
const { HOME_FLOORS } = await import('../../server/src/houseStyle');
const { isDwelling } = await import('../../server/src/grow');
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
const parts: Any[] = w.decorParts(v);
const store = storageContents(v);

// The saved world's blocks at the bare cells (region_blocks.py), when the checkpoint has its world
const owned = v.structures.filter((s: Any) => s.owner && isDwelling(s.kind));
const cells: Array<[number, number, number]> = [];
for (const st of owned) for (const c of parts.find((P) => P.structure.id === st.id)?.bare ?? []) cells.push([c.x, st.y, c.z]);
let blocks: Record<string, string> | null = null;
const worldDir = path.join(cpDir, 'world');
if (cells.length && fs.existsSync(worldDir)) {
  const py = `import sys, json\nsys.path.insert(0, 'scripts/checks')\nimport region_blocks as R\nW = R.World(sys.argv[1])\nprint(json.dumps({f'{x},{y},{z}': W.block(x, y, z) for x, y, z in json.load(sys.stdin)}))`;
  const r = spawnSync('python', ['-c', py, worldDir], { input: JSON.stringify(cells), encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status === 0) blocks = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}');
  else quiet.log(`(no world read: ${(r.stderr || '').trim().split('\n').pop()})`);
}
const GROUND = /^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mycelium|dirt_path|farmland|cobblestone|gravel|sand|red_sand|moss_block|mud)$/;

const lines: string[] = [];
let bareHomes = 0, ground = 0, placed = 0;
for (const st of owned) {
  const P = parts.find((q) => q.structure.id === st.id);
  const d = v.designs[st.kind];
  const bare: Array<{ x: number; z: number }> = P?.bare ?? [];
  // (the design's own inside "_" floor cells: layer 1 "." with "_" under it, off the outside flood)
  const l0 = d?.layers?.[0] ?? [], l1 = d?.layers?.[1] ?? [];
  let want = 0;
  if (d) {
    const open = (i: number, j: number) => l1[j]?.[i] === '.' || l1[j]?.[i] === '_';
    const seen = new Set<string>(), q: Array<[number, number]> = [];
    for (let j = 0; j < d.depth; j++) for (let i = 0; i < d.width; i++) if ((i === 0 || j === 0 || i === d.width - 1 || j === d.depth - 1) && open(i, j)) q.push([i, j]);
    while (q.length) {
      const [i, j] = q.pop()!;
      if (i < 0 || j < 0 || i >= d.width || j >= d.depth || !open(i, j) || seen.has(`${i},${j}`)) continue;
      seen.add(`${i},${j}`);
      q.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
    }
    for (let j = 0; j < d.depth; j++) for (let i = 0; i < d.width; i++) if (l1[j][i] === '.' && l0[j][i] === '_' && !seen.has(`${i},${j}`)) want++;
  }
  if (HOME_FLOORS) ok(bare.length === want, `${st.id} ${st.kind}: ${bare.length} bare cells, its design leaves ${want} inside`);
  else ok(!bare.length, `${st.id} ${st.kind}: bare cells with MC_HOME_FLOORS off`);
  for (const c of bare) ok(c.x >= st.x1 && c.x <= st.x2 && c.z >= st.z1 && c.z <= st.z2, `${st.id}: bare cell ${c.x},${c.z} outside its box`);
  let g = 0, p = 0;
  if (blocks) for (const c of bare) {
    const b = blocks[`${c.x},${st.y},${c.z}`] ?? '';
    if (GROUND.test(b)) g++;
    else p++;
  }
  ground += g;
  placed += p;
  if (blocks) ok(!p, `${st.id} ${st.kind}: ${p} of ${bare.length} bare cells hold a placed block at y ${st.y}`);
  const cost = bare.length && P ? floorCost(bare.length, homeWood(P), store) : null;
  if (bare.length) {
    bareHomes++;
    ok(cost && !('short' in cost), `${st.id}: storage cannot pay its floor (${cost && 'short' in cost ? cost.short : ''})`);
  }
  const costText = !cost ? '-' : 'short' in cost ? `short: ${cost.short}` : `${Object.entries(cost.take).map(([k, n]) => `${n} ${k}`).join(', ')} -> ${cost.block}`;
  lines.push(`  ${st.id} ${String(st.owner).padEnd(6)} ${String(st.kind).padEnd(24)} bare ${String(bare.length).padStart(2)}${blocks ? ` (ground ${g})` : ''}  floor ${costText}  decoration slots ${P?.slots?.length ?? 0}`);
}
console.log(lines.join('\n'));
console.log(`${owned.length} owned homes, ${bareHomes} with a bare floor${blocks ? `; the saved world: ${ground} bare cells on ground, ${placed} on a placed block` : ' (no saved world read)'} (MC_HOME_FLOORS ${HOME_FLOORS ? 'on' : 'off'})`);
console.log(failures ? `FAIL home_floors: ${failures} of ${checks} checks failed` : `PASS home_floors: ${checks} checks`);
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
