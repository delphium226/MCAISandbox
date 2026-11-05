/**
 * #225 (MC_BOWS_FIRST) checked offline on a checkpoint (policy_options.mts' harness: a real MineflayerWorld on a scratch
 * copy, clock frozen, RCON stubbed, fake members idle at the first chest; hostile mode, so bows are on; ~10 s):
 *   A. flintShort: the flint 64 arrows want beyond storage's (one flint makes 4);
 *   B. storage with string, sticks and feathers but no flint or arrows: the menu offers the flint trip and making bows,
 *      both ranked above every wall job (a wall cell or its stone 400/405, 150/155 urgent, weight 2): rank below 150 and
 *      weight above 2;
 *   C. with flint stored, making arrows likewise;
 *   D. arrows seen lying near a spot the village shot from: the sweep is offered; none lying, none offered;
 *   E. flag off (a child run): no flint trip, no sweep, and bows ranked as any workshop good (900+), as before #225.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/bows_first.mts [CHECKPOINT_DIR]   (default mc/testcheckpoints/w203_n9)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workerName } from '../../server/src/agentNames';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const cpDir = process.argv[2] ?? 'mc/testcheckpoints/w203_n9';
const villagesFile = path.join(cpDir, 'villages.json');
if (!fs.existsSync(villagesFile)) {
  console.log(`SKIP bows_first: ${villagesFile} is not here`);
  process.exit(0);
}
const OFF = process.env.BOWS_CHILD === 'off';
process.env.MC_WORLD_MODE = 'hostile';
process.env.MC_CHOOSE = 'model';
process.env.MC_VOTE = 'off';
process.env.MC_GROW = '0';
process.env.MC_TIME_SCALE = '1';
process.env.MC_MODEL_RECORD = '0';
process.env.MC_MEMORY = 'off';
process.env.MC_BOWS = 'on';
process.env.MC_BOWS_FIRST = OFF ? 'off' : 'on';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'bows-first-'));
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
process.env.MCAI_ACTS_LOG = path.join(SCRATCH, 'acts.jsonl');
const cpFile = path.join(cpDir, 'checkpoint.json');
const cpTime = fs.existsSync(cpFile) ? Date.parse(String(JSON.parse(fs.readFileSync(cpFile, 'utf8')).time ?? '').replace(' ', 'T')) : NaN;
const clock = Number.isFinite(cpTime) ? cpTime : fs.statSync(villagesFile).mtimeMs;
Date.now = () => clock;

const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const mute = () => { console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const unmute = () => Object.assign(console, quiet);
let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 30) quiet.log(`FAIL ${what}`);
  }
};

mute();
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const F = await import('../../server/src/mineflayer/mcFlint');
unmute();

// A: the flint wanted
ok(F.flintShort({}) === 16, `A: no arrows, no flint: ${F.flintShort({})} flint wanted (16)`);
ok(F.flintShort({ arrow: 64 }) === 0, 'A: 64 arrows: none wanted');
ok(F.flintShort({ arrow: 60, flint: 1 }) === 0 && F.flintShort({ arrow: 40, flint: 2 }, 1) === 3, 'A: stored and coming flint counted');

const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
fs.copyFileSync(villagesFile, path.join(dir, 'villages.json'));
if (fs.existsSync(path.join(cpDir, 'atlas.json'))) fs.copyFileSync(path.join(cpDir, 'atlas.json'), path.join(dir, 'atlas.json'));
const data = JSON.parse(fs.readFileSync(villagesFile, 'utf8')) as { villages: Any[] };
const base = data.villages.find((x) => x.complete) ?? data.villages[0];
mute();
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
unmute();
const reg = w.villages as Any;
reg.save = () => {};
if (w.atlas) w.atlas.save = () => {};
const v = reg.get(base.name);
const chest0 = v.storage?.chests?.[0];
const home = { x: chest0.x, y: chest0.y, z: chest0.z };
const sections = new Array(24).fill(null);
const getColumn = () => ({ minY: -64, sections, getBlockStateId: () => 0 });
const agents: Any[] = [];
for (const name of ['Mayor', ...Array.from({ length: 6 }, (_, i) => workerName(i + 1))]) {
  const memory = { village: v.name, villageRole: name === 'Mayor' ? 'mayor' : 'worker' };
  const own: Any[] = [];
  const a: Any = {
    name, role: memory.villageRole, memory, world: w, village: () => reg.get(memory.village),
    idle: () => !own.some((s) => s.state === 'queued' || s.state === 'running'),
    enqueue: (type: string, args: Record<string, unknown>) => { const s = { id: own.length + 1, type, args, state: 'queued', agent: name }; own.push(s); return s; },
    bot: { entity: { position: { x: home.x + 0.5, y: home.y, z: home.z + 0.5 } }, entities: {}, inventory: { items: () => [{ name: 'stone_sword', count: 1 }] }, world: { getColumn }, game: { minY: -64 }, health: 20, time: { timeOfDay: 2000 } },
  };
  agents.push(a);
  w.agents.set(name.toLowerCase(), a);
}
const keep: Record<string, number> = { cobblestone: 64, oak_log: 32, [`${v.wood ?? 'oak'}_log`]: 32, stick: 32, string: 6, feather: 8, wheat_seeds: 20 };
const stockWith = (extra: Record<string, number>) => {
  for (const c of v.storage.chests) c.items = {};
  chest0.items = { ...keep, ...extra };
};
// (every feasible option, not the shortlist a menu shows: which of them it shows depends on temperaments)
const feasible = (a: Any) => (w.isIdleMember(v, a, Date.now()) ? w.menu(v, a, w.heldKeys(v, Date.now(), 'sweep'), true, w.sweepFacts(v, Date.now(), a)).feasible : []);
const menus = () => { mute(); const r = (w.factsCache.clear(), agents).map(feasible); unmute(); return r; };
const find = (ms: Any[][], id: string) => ms.flat().find((o: Any) => o.id === id);
const above = (o: Any) => !!o && o.rank < 150 && (o.nw ?? 1) > 2;

// B: no flint, no arrows, no bows
stockWith({});
const B = menus();
const flint = find(B, 'flint'), bow = find(B, 'make:bow');
if (OFF) {
  ok(!flint, 'flag off: a flint trip offered');
  ok(!bow || bow.rank >= 900, `flag off: bows ranked ${bow?.rank} (900+ as a workshop good)`);
} else {
  ok(above(flint), `B: the flint trip ${flint ? `ranked ${flint.rank}, weight ${flint.nw}` : 'not offered'}: not above the wall's 150 and weight 2`);
  ok(above(bow), `B: making bows ${bow ? `ranked ${bow.rank}, weight ${bow.nw}` : 'not offered'}: not above the wall`);
  ok(/flint/.test(flint?.facts ?? '') && /gravel/.test(flint?.facts ?? ''), 'B: the flint trip\'s facts name flint and gravel');
}
// C: flint stored: arrows made, ranked above the wall
stockWith({ flint: 8, bow: 4 });
const C = menus();
const arrow = find(C, 'make:arrow');
if (!OFF) {
  ok(above(arrow), `C: making arrows ${arrow ? `ranked ${arrow.rank}, weight ${arrow.nw}` : 'not offered'}: not above the wall`);
  ok(find(C, 'flint'), 'C: 8 flint stored (32 arrows) and no arrows: no flint trip offered for the other 32');
} else ok(!arrow || arrow.rank >= 900, `flag off: arrows ranked ${arrow?.rank}`);
// (8 flint covers 32 of the 64: the trip is for the other 8)
stockWith({ flint: 8, bow: 4 });
if (!OFF) ok(F.flintShort({ flint: 8 }) === 8, 'C: 8 flint short with 8 stored');

// D: the sweep: arrows lying near a spot shot from
stockWith({ flint: 20, bow: 4, arrow: 10 });
F.noteShot(v.name, { x: home.x + 10, y: home.y, z: home.z + 4 });
const D0 = menus();
ok(!find(D0, 'arrows'), 'D: a sweep offered with no arrows seen lying');
agents[1].bot.entities = Object.fromEntries([1, 2, 3].map((i) => [100 + i, { id: 100 + i, name: 'arrow', position: { x: home.x + 10 + i, y: home.y, z: home.z + 5 }, velocity: { x: 0, y: 0, z: 0 } }]));
const D1 = menus();
const sweep = find(D1, 'arrows');
if (OFF) ok(!sweep, 'flag off: a sweep offered');
else ok(above(sweep) && /3 arrows/.test(sweep.facts), `D: the sweep ${sweep ? `ranked ${sweep.rank}: ${sweep.facts}` : 'not offered'} with 3 arrows lying`);

quiet.log(`  ${OFF ? 'flag off' : 'flag on'}: flint trip ${flint ? `rank ${flint.rank} nw ${flint.nw}` : 'none'}; bows ${bow ? `rank ${bow.rank} nw ${bow.nw ?? 1}` : 'none'}; arrows ${arrow ? `rank ${arrow.rank} nw ${arrow.nw ?? 1}` : 'none'}; sweep ${sweep ? `rank ${sweep.rank}` : 'none'}`);
if (!OFF) {
  const out = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/checks/bows_first.mts', cpDir], { env: { ...process.env, BOWS_CHILD: 'off' }, encoding: 'utf8' });
  const tail = out.trim().split('\n');
  quiet.log(tail.slice(-2).join('\n'));
  ok(/PASS/.test(tail[tail.length - 1]), 'the flag-off run failed');
}
quiet.log(`${failures ? 'FAIL' : 'PASS'}: ${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
