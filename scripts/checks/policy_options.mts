/**
 * #122 (MC_POLICY_OPTIONS) checked offline on a checkpoint (menu_ctx_golden.mts' harness: a real MineflayerWorld on a
 * scratch copy, clock frozen, RCON stubbed, 25 fake members idle at the first chest; no server, ~10 s).
 * The checkpoints' menus all hold real work, so the gates are reached by setting the village up: every workshop good
 * stocked to its target (nothing wanted, every make at stock), the families narrowed to make, gather and initiatives,
 * home basics off. Then, flag on:
 *   A. no open project, three pending decisions shown one (heldProjects stubbed to 3): every menu holds only gated
 *      options, gather anyway and another project past the cap, each tagged, none a filler make;
 *   B. the same with a real option on the menu (one project open and not pending: a help step): no gated option, and the
 *      gates' reasons kept ("gather: nothing wanted", "initiate: enough projects open");
 *   C. a material at GATHER_ANYWAY_MAX in storage is not offered anyway, and sand never is (#142);
 * and flag off (a child run): no gated option anywhere, and the reasons as before.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/policy_options.mts [CHECKPOINT_DIR]   (default mc/testcheckpoints/im2_mine)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workerName } from '../../server/src/agentNames';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const cpDir = process.argv[2] ?? 'mc/testcheckpoints/im2_mine';
const villagesFile = path.join(cpDir, 'villages.json');
if (!fs.existsSync(villagesFile)) {
  console.log(`SKIP policy_options: ${villagesFile} is not here`);
  process.exit(0);
}
const OFF = process.env.POLICY_CHILD === 'off';
process.env.MC_CHOOSE = 'model';
process.env.MC_VOTE = 'off';
process.env.MC_GROW = '0';
process.env.MC_TIME_SCALE = '1';
process.env.MC_MODEL_RECORD = '0';
process.env.MC_MEMORY = 'off';
process.env.MC_HOME_BASICS = 'off';
process.env.MC_CHOICE_FAMILIES = 'make,gather,initiatives';
process.env.MC_POLICY_OPTIONS = OFF ? 'off' : 'on';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-options-'));
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
unmute();
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
for (const name of ['Mayor', ...Array.from({ length: 24 }, (_, i) => workerName(i + 1))]) {
  const memory = { village: v.name, villageRole: name === 'Mayor' ? 'mayor' : 'worker' };
  const own: Any[] = [];
  const a: Any = {
    name, role: memory.villageRole, memory, world: w, village: () => reg.get(memory.village),
    idle: () => !own.some((s) => s.state === 'queued' || s.state === 'running'),
    enqueue: (type: string, args: Record<string, unknown>) => { const s = { id: own.length + 1, type, args, state: 'queued', agent: name }; own.push(s); return s; },
    bot: { entity: { position: { x: home.x + 0.5, y: home.y, z: home.z + 0.5 } }, entities: {}, inventory: { items: () => [] }, world: { getColumn }, game: { minY: -64 } },
  };
  agents.push(a);
  w.agents.set(name.toLowerCase(), a);
}

// Every good at its target (nothing wanted, every make at stock), in the first chest; the three materials at the keeps
mute();
const stock: Record<string, number> = { cobblestone: 20, sand: 0 };
for (const g of w.goodsFor(v)) stock[g.item] = Math.max(stock[g.item] ?? 0, w.makeTarget(v, g));
for (const c of v.storage.chests) c.items = {};
chest0.items = stock;
const logs = Object.keys(stock).find((n) => /_log$/.test(n)) ?? `${v.wood ?? 'oak'}_log`;
stock[logs] = Math.max(stock[logs] ?? 0, 20);
v.initiatives = [];
w.heldProjects = () => 3;
const TAG = '[past a village limit]';
// (the village facts are cached per sweep time, and the clock is frozen)
const snap = () => (w.factsCache.clear(), agents).map((a) => { const m = w.choices(a); return { name: a.name, options: m?.options ?? [], reasons: m?.reasons ?? {} }; });
const A = snap();
unmute();

const gatedOf = (o: Any) => o.mark === TAG;
const filler = (o: Any) => o.kind === 'make' && /\blater\b|nothing places it yet|the reserve kept beyond/.test(o.effect);
const withGated = A.filter((m) => m.options.some(gatedOf));
// (#142: sand is never gathered anyway: collect's lake-edge sand sent gatherers into the water)
ok(!A.some((m) => m.options.some((o: Any) => o.id === 'gather:sand' && gatedOf(o))), 'A: sand offered anyway');
if (OFF) {
  ok(!withGated.length, `flag off: ${withGated.length} menus with a gated option`);
} else {
  ok(withGated.length >= 20, `A: only ${withGated.length} of ${A.length} menus got gated options`);
  for (const m of A) {
    const real = m.options.filter((o: Any) => !gatedOf(o) && o.kind !== 'eat');
    ok(!real.length || !m.options.some(gatedOf), `A ${m.name}: gated options beside real ones (${real.map((o: Any) => o.id).join(', ')})`);
    ok(!m.options.some(filler) || !m.options.some(gatedOf), `A ${m.name}: a filler make beside a gated option`);
  }
  const ex = withGated[0];
  if (ex) {
    ok(ex.options.some((o: Any) => o.kind === 'gather') && ex.options.some((o: Any) => o.kind === 'initiate'), `A ${ex.name}: not both gather anyway and another project (${ex.options.map((o: Any) => o.id).join(', ')})`);
    for (const o of ex.options) quiet.log(`    ${o.id} | ${o.name} | ${o.facts.slice(0, 170)}`);
  }
}
const why = (ms: Any[], k: string) => ms.filter((m) => m.reasons[k]).map((m) => m.reasons[k]);
ok(OFF ? why(A, 'gather').every((x: string) => x === 'nothing wanted' || /mine|logs|sand|back|busy|small/.test(x)) : true, 'flag off: gather reasons');
ok(OFF ? why(A, 'initiate').some((x: string) => x === 'enough projects open') : true, 'flag off: no "enough projects open" with the cap full');

// B: a real option on the menu (the cap not full: a project of its own is ordinary work): no gated option, the gather
// gate's reason kept
mute();
w.heldProjects = () => 0;
const B = snap();
unmute();
if (!OFF) {
  const withReal = B.filter((m) => m.options.some((o: Any) => o.kind === 'initiate' && !gatedOf(o)));
  ok(withReal.length >= 20, `B: only ${withReal.length} menus offered an ordinary project`);
  for (const m of withReal) {
    ok(!m.options.some(gatedOf), `B ${m.name}: a gated option beside an ordinary project`);
    ok(!m.options.some((o: Any) => o.kind === 'gather') ? m.reasons.gather === 'nothing wanted' : true, `B ${m.name}: gather's reason ${m.reasons.gather}`);
  }
  quiet.log(`  B: an ordinary project on ${withReal.length} menus, none with a gated option`);
}
w.heldProjects = () => 3;
// C: a material at the cap is not gathered anyway
mute();
chest0.items[logs] = 192;
const C = snap();
unmute();
if (!OFF) ok(!C.some((m) => m.options.some((o: Any) => o.id === 'gather:logs' && gatedOf(o))), 'C: logs at 192 still gathered anyway');
quiet.log(`  ${OFF ? 'flag off' : 'flag on'}: A ${withGated.length} of ${A.length} menus gated; gated kinds ${[...new Set(A.flatMap((m) => m.options.filter(gatedOf).map((o: Any) => o.id)))].join(', ') || 'none'}`);

if (!OFF) {
  const out = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/checks/policy_options.mts', cpDir], { env: { ...process.env, POLICY_CHILD: 'off', MC_POLICY_OPTIONS: 'off' }, encoding: 'utf8' });
  const tail = out.trim().split('\n');
  quiet.log(tail.slice(-2).join('\n'));
  ok(/PASS/.test(tail[tail.length - 1]), 'the flag-off run failed');
}
quiet.log(`${failures ? 'FAIL' : 'PASS'}: ${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
