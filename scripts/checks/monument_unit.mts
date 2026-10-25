/**
 * The monument (M1, #144; MC_MONUMENT) checked offline on a checkpoint (choice_holds.mts' harness: a real MineflayerWorld
 * on a scratch copy, the clock frozen, RCON stubbed, 25 fake members at the first chest, all idle; no server):
 * - the trigger: no monument before the iron age; with the iron rung set by hand, the farm tick's monumentTick begins
 *   one (Notre-Dame at the scale asked, state "site"), once;
 * - the site: a "site" option on the menus, held by one key;
 * - the yard: with the site set by hand, each stage's bill is offered as gathering trips (cobblestone, logs, sand) and no
 *   job until the yard covers it; a job the yard covers is offered; makeSpare keeps the yard from other chores; a job
 *   built takes its raw bill from the yard; stage 1's jobs built open stage 2 (its time kept) and its own wants;
 * - the jobs' cells: every job's targets are its blocks, inside the site's footprint as turned (0 and 90), at the
 *   pad's level and above;
 * - the share: on every member's menu the monument's options are at most 60% (one at least);
 * - with the flag off (run as a child) a monument record offers nothing.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/monument_unit.mts [CHECKPOINT_DIR]   (default mc/testcheckpoints/im2_mine)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerName } from '../../server/src/agentNames';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const cpDir = process.argv[2] ?? 'mc/testcheckpoints/im2_mine';
const villagesFile = path.join(cpDir, 'villages.json');
if (!fs.existsSync(villagesFile)) {
  console.log(`SKIP monument_unit: ${villagesFile} is not here`);
  process.exit(0);
}
const OFF = process.env.MONUMENT_CHILD === 'off';
process.env.MC_CHOOSE = 'model';
process.env.MC_VOTE = 'off';
process.env.MC_GROW = '0';
process.env.MC_TIME_SCALE = '1';
process.env.MC_MODEL_RECORD = '0';
process.env.MC_MEMORY = 'off';
process.env.MC_LADDER = 'on';
process.env.MC_IRON_AGE = 'on';
process.env.MC_MONUMENT = OFF ? 'off' : 'on';
process.env.MC_MONUMENT_SCALE = '0.25';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'monument-'));
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
process.env.MCAI_ACTS_LOG = path.join(SCRATCH, 'acts.jsonl');
const clock = fs.statSync(villagesFile).mtimeMs;
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
const mon = await import('../../server/src/monument');
const { turnState } = await import('../../server/src/designs');
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
const plot0 = v.plots.find((p: Any) => !p.annex);
const home = chest0 ? { x: chest0.x, y: chest0.y, z: chest0.z } : { x: Math.floor((plot0.x1 + plot0.x2) / 2), y: plot0.y + 1, z: Math.floor((plot0.z1 + plot0.z2) / 2) };
const sections = new Array(24).fill(null);
const getColumn = () => ({ minY: -64, sections, getBlockStateId: () => 0 });
const NAMES = ['Mayor', ...Array.from({ length: 24 }, (_, i) => workerName(i + 1))];
const agents: Any[] = [];
for (const name of NAMES) {
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
w.chooser = { submit: () => {}, cancel: () => {} };
const menuOf = (a: Any) => { mute(); const m = w.choices(a); unmute(); return m; };
const menu = (a: Any) => { mute(); const m = w.choices(a); unmute(); return (m?.options ?? []) as Any[]; };
const monOpts = (a: Any) => menu(a).filter((o) => o.kind === 'monument');

if (OFF) {
  v.ladder = { ...(v.ladder ?? { current: 'letters', stage: 0, stageStart: clock, count: 0, work: {}, ballots: [] }), reached: [{ rung: 'iron', t: clock }] };
  v.monument = mon.newMonument('oak', clock);
  ok(agents.every((a) => !monOpts(a).length), 'flag off: a monument record offers options');
  quiet.log(failures ? `FAIL (off): ${failures} of ${checks}` : `PASS (off): ${checks} checks`);
  process.exit(failures ? 1 : 0);
}

// 1. The trigger
delete v.monument;
v.ladder = { ...(v.ladder ?? { current: 'iron', stage: 0, stageStart: clock, count: 0, work: {}, ballots: [] }), reached: (v.ladder?.reached ?? []).filter((r: Any) => r.rung !== 'iron') };
mute(); w.monumentTick(v); unmute();
ok(!v.monument, 'a monument before the iron age');
v.ladder.reached.push({ rung: 'iron', t: clock });
mute(); w.monumentTick(v); unmute();
const m = v.monument;
ok(m && m.preset === 'notre_dame' && m.scale === 4 && m.state === 'site', `the trigger: ${JSON.stringify(m)?.slice(0, 120)}`);
const first = m;
mute(); w.monumentTick(v); unmute();
ok(v.monument === first, 'a second monument begun');
const plan = mon.monumentPlan(m);
quiet.log(`plan: ${plan.design.width}x${plan.depth ?? plan.design.depth}x${plan.design.height}, ${plan.design.blocks} blocks, ${plan.jobs.length} jobs; bill ${Object.entries(plan.bill).map(([n, q]) => `${q} ${n}`).join(', ')}`);
ok(Object.keys(plan.bill).every((n) => /^(cobblestone(_stairs|_slab|_wall)?|[a-z_]+_(stairs|slab|planks)|glass_pane)$/.test(n)), `today's palette has ${Object.keys(plan.bill).join(', ')}`);

// 2. The site option
const siteOn = agents.filter((a) => monOpts(a).some((o) => o.id === 'monument:site'));
ok(siteOn.length >= 20, `the site option on ${siteOn.length} of 25 menus`);

// 3. The yard and the jobs
const sx = home.x + 40, sz = home.z;
const { w: fw, d: fd } = mon.siteSize(m, 0);
m.site = { x1: sx, z1: sz, x2: sx + fw - 1, z2: sz + fd - 1, y: home.y - 1, rotate: 0, prepared: true };
m.state = 'building';
const raw = (b: Record<string, number>) => w.monumentRaw(m, b);
const wants1 = mon.stageWants(m, raw);
quiet.log(`stage 1 wants ${Object.entries(wants1).map(([n, q]) => `${q} ${n}`).join(', ')}; jobs ${mon.openJobs(m).join(',')}`);
ok(mon.currentStage(m) === 1 && wants1.cobblestone > 0, 'stage 1 wants cobblestone');
const probe = agents.find((a) => menuOf(a)) ?? agents[1];
let opts = monOpts(probe);
ok(opts.some((o) => o.id === 'monument:gather:cobblestone'), `a cobblestone trip on the menu: ${opts.map((o) => o.id).join(', ')}`);
ok(!opts.some((o) => /^monument:job:/.test(o.id)), 'a job offered with an empty yard');
const spare0 = w.makeSpare(v, '').cobblestone ?? 0;
const j0 = mon.openJobs(m)[0];
const need0 = raw(plan.jobs[j0].bill);
for (const [n, q] of Object.entries(need0)) m.yard[n] = Math.ceil(q as number);
const spare1 = w.makeSpare(v, '').cobblestone ?? 0;
ok(spare0 === 0 || spare1 <= Math.max(0, spare0 - (m.yard.cobblestone ?? 0)) + 1, `makeSpare keeps the yard: ${spare0} -> ${spare1} with ${m.yard.cobblestone} in the yard`);
opts = monOpts(probe);
ok(opts.some((o) => o.id === `monument:job:${j0}`), `job ${j0} offered once the yard covers it: ${opts.map((o) => o.id).join(', ')}`);
ok(mon.stageWants(m, raw).cobblestone === wants1.cobblestone - m.yard.cobblestone || !mon.stageWants(m, raw).cobblestone, 'the wants less the yard');
mon.jobBuilt(m, j0, need0, clock);
ok(!m.yard.cobblestone, `the yard after the job: ${JSON.stringify(m.yard)}`);
for (const i of mon.openJobs(m)) mon.jobBuilt(m, i, {}, clock + 1);
ok(mon.currentStage(m) === 2 && m.stages[0]?.ended !== undefined, `stage 2 after stage 1's jobs (stage ${mon.currentStage(m)}, ${JSON.stringify(m.stages)})`);
const wants2 = mon.stageWants(m, raw);
ok(Object.keys(wants2).length > 0, `stage 2 wants ${JSON.stringify(wants2)}`);

// 4. The jobs' cells, at 0 and 90
for (const rot of [0, 90]) {
  const s = mon.siteSize(m, rot);
  m.site = { x1: sx, z1: sz, x2: sx + s.w - 1, z2: sz + s.d - 1, y: home.y - 1, rotate: rot, prepared: true };
  let bad = 0, total = 0;
  plan.jobs.forEach((j: Any, i: number) => {
    const t = mon.jobTargets(m, i, turnState);
    total += t.length;
    if (t.length !== j.blocks) bad++;
    if (t.some((c: Any) => c.x < m.site.x1 || c.x > m.site.x2 || c.z < m.site.z1 || c.z > m.site.z2 || c.y < m.site.y)) bad++;
  });
  ok(!bad && total === plan.design.blocks, `rotate ${rot}: ${bad} jobs off their cells or the footprint (${total} of ${plan.design.blocks})`);
}
m.site.rotate = 0;

// 5. The share, on every menu
let over = 0, seen = 0;
for (const a of agents) {
  const o = menu(a);
  const k = o.filter((x) => x.kind === 'monument').length;
  if (k) seen++;
  if (k > Math.max(1, Math.floor(0.6 * o.length))) over++;
}
ok(seen > 0 && !over, `the share: ${over} menus over 60% (${seen} with the monument)`);
ok(mon.capShare([{ rank: 1, k: 1 }, { rank: 2, k: 1 }, { rank: 3, k: 1 }, { rank: 4, k: 0 }, { rank: 5, k: 0 }] as Any[], (o: Any) => o.k === 1, 0.6).length === 0
  && mon.capShare([{ rank: 1, k: 1 }, { rank: 2, k: 1 }, { rank: 3, k: 1 }, { rank: 4, k: 0 }] as Any[], (o: Any) => o.k === 1, 0.6).length === 1, 'capShare');

// 6. The flag off, as a child
const self = fileURLToPath(import.meta.url);
let offOk = true;
try {
  execFileSync(process.execPath, [...process.execArgv, self, cpDir], { env: { ...process.env, MONUMENT_CHILD: 'off' }, stdio: 'pipe' });
} catch (e) {
  offOk = false;
  quiet.log(String((e as Any).stdout ?? e).slice(0, 400));
}
ok(offOk, 'the flag-off child failed');
quiet.log(failures ? `FAIL monument_unit: ${failures} of ${checks} checks` : `PASS: ${checks} checks, 0 failures`);
process.exit(failures ? 1 : 0);
