/**
 * The castle as the monument (#153; MC_MONUMENT_TYPE=castle) checked offline on a checkpoint (monument_unit.mts'
 * harness: a real MineflayerWorld on a scratch copy, the clock frozen, RCON stubbed, 25 fake members at the first chest):
 * - the trigger: with the iron rung set by hand the monument begun is Conwy at the scale asked, type castle, without
 *   asking the architect (MC_MONUMENT_ARCHITECT on: it picks only for the cathedral); a record without a type is still a
 *   cathedral (its plan and its eight stages);
 * - the plan: the castle's stages (6 at 1:2), its bill in today's palette only what today's skills gather and make
 *   (cobblestone and its shapes, the wood's planks, stairs and fence, panes), and in the full palette a materials plan
 *   that gathers only cobblestone, logs and sand;
 * - the menu: the site option names the castle; with the site set, stage 1's gathering, a job once the yard covers it,
 *   the progress line "stage 1 of 6";
 * - the jobs' cells: every job's targets are its blocks inside the footprint as turned (0, 90, 180, 270) at the pad's
 *   level and above; every job built in turn ends the castle (state built);
 * - the site search on flat ground round the hub places the footprint off the village's ground.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/castle_monument.mts [CHECKPOINT_DIR]   (default mc/testcheckpoints/im2_mine)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workerName } from '../../server/src/agentNames';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const cpDir = process.argv[2] ?? 'mc/testcheckpoints/im2_mine';
const villagesFile = path.join(cpDir, 'villages.json');
if (!fs.existsSync(villagesFile)) {
  console.log(`SKIP castle_monument: ${villagesFile} is not here`);
  process.exit(0);
}
process.env.MC_CHOOSE = 'model';
process.env.MC_VOTE = 'off';
process.env.MC_GROW = '0';
process.env.MC_TIME_SCALE = '1';
process.env.MC_MODEL_RECORD = '0';
process.env.MC_MEMORY = 'off';
process.env.MC_LADDER = 'on';
process.env.MC_IRON_AGE = 'on';
process.env.MC_MONUMENT = 'on';
process.env.MC_MONUMENT_TYPE = 'castle';
process.env.MC_MONUMENT_SCALE = '0.5';
process.env.MC_MONUMENT_ARCHITECT = 'on';
process.env.MC_MONUMENT_NEWS = 'on';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'castle-'));
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
// (the monument's flags are on by default since 10-28: these cases are written with them off unless set above)
for (const k of ['MC_MONUMENT', 'MC_QUARRY', 'MC_KILN', 'MC_GLAZING', 'MC_MONUMENT_DETAIL', 'MC_DYE_BED', 'MC_MONUMENT_ROLES', 'MC_MONUMENT_NEWS', 'MC_LODGE', 'MC_DEEP_STONE', 'MC_GEODE_GUARD', 'MC_FURNISH_LANTERNS', 'MC_FURNISH_BANNERS', 'MC_FURNISH_CANDLES']) process.env[k] ??= 'off';
process.env.MC_MONUMENT_PALETTE ??= 'today';
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const mon = await import('../../server/src/monument');
const { GOTHIC_STAGES } = await import('../../server/src/gothicGen');
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
const menu = (a: Any) => { mute(); const m = w.choices(a); unmute(); return (m?.options ?? []) as Any[]; };
const monOpts = (a: Any) => menu(a).filter((o) => o.kind === 'monument');

// 1. The trigger: Conwy, at once (no architect for the castle)
delete v.monument;
v.ladder = { ...(v.ladder ?? { current: 'iron', stage: 0, stageStart: clock, count: 0, work: {}, ballots: [] }), reached: [...(v.ladder?.reached ?? []).filter((r: Any) => r.rung !== 'iron'), { rung: 'iron', t: clock }] };
mute(); w.monumentTick(v); unmute();
const m = v.monument;
ok(m && m.type === 'castle' && m.preset === 'conwy' && m.scale === 2 && m.state === 'site', `the trigger: ${JSON.stringify(m)?.slice(0, 160)}`);
ok(!mon.m3(m ?? {}).arch, 'the architect asked for the castle');
const plan = mon.monumentPlan(m);
quiet.log(`plan: ${plan.design.width}x${plan.design.depth}x${plan.design.height}, ${plan.design.blocks} blocks, ${plan.jobs.length} jobs, stages ${plan.stageNames.join(' / ')}; bill ${Object.entries(plan.bill).map(([n, q]) => `${q} ${n}`).join(', ')}`);
ok(plan.stageNames.length === 6 && plan.stageNames[0] === 'pad and footings' && !plan.stageNames.includes('keep'), `the castle's stages: ${plan.stageNames.join(', ')}`);
ok(Object.keys(plan.bill).every((n) => /^(cobblestone(_stairs|_slab|_wall)?|[a-z_]+_(stairs|slab|planks|fence)|glass_pane)$/.test(n)), `today's palette has ${Object.keys(plan.bill).join(', ')}`);
ok(plan.bill.oak_fence > 0 || Object.keys(plan.bill).some((n) => /_fence$/.test(n)), 'the portcullis as a fence');
const cath = mon.newMonument('oak', clock, 'cathedral');
ok(!('type' in cath) && mon.monumentType(cath) === 'cathedral' && mon.monumentPlan(cath).stageNames === GOTHIC_STAGES, 'a record without a type is a cathedral');

// The full palette: a materials plan of the whole castle that gathers only cobblestone, logs and sand
const full = { ...m, palette: 'full' };
const fullPlan = mon.monumentPlan(full);
const p = w.materials.plan(fullPlan.bill, {});
const gathered = Object.entries(p.gather).filter(([, q]) => (q as number) > 0).map(([n]) => n);
quiet.log(`full palette: bill ${Object.entries(fullPlan.bill).map(([n, q]) => `${q} ${n}`).join(', ')}; gathers ${Object.entries(p.gather).map(([n, q]) => `${q} ${n}`).join(', ')}; ${p.fuel.smelts} smelts`);
ok(gathered.every((n) => /^(cobblestone|any:logs|[a-z_]+_log|sand|any:sand)$/.test(n)), `the full palette gathers ${gathered.join(', ')}`);

// 2. The menu
const siteOn = agents.filter((a) => monOpts(a).some((o) => o.id === 'monument:site' && /castle's site/.test(o.name)));
ok(siteOn.length >= 20, `the castle's site option on ${siteOn.length} of 25 menus`);
const sx = home.x + 40, sz = home.z;
const { w: fw, d: fd } = mon.siteSize(m, 0);
m.site = { x1: sx, z1: sz, x2: sx + fw - 1, z2: sz + fd - 1, y: home.y - 1, rotate: 0, prepared: true };
m.state = 'building';
const raw = (b: Record<string, number>) => w.monumentRaw(m, b);
const probe = agents[1];
let opts = monOpts(probe);
ok(opts.some((o) => o.id === 'monument:gather:cobblestone' && /for the castle \(stage 1: pad and footings\)/.test(o.name)), `a cobblestone trip for the castle: ${opts.map((o) => o.name).join(' | ')}`);
const j0 = mon.openJobs(m)[0];
for (const [n, q] of Object.entries(raw(plan.jobs[j0].bill))) m.yard[n] = Math.ceil(q as number);
opts = monOpts(probe);
ok(opts.some((o) => o.id === `monument:job:${j0}` && /Build part of the castle: its pad and footings/.test(o.name)), `job ${j0} offered: ${opts.map((o) => o.name).join(' | ')}`);
const line = mon.progressLine(m, clock, 20 * 60000);
ok(/^The village's monument: the castle \(Conwy at 1:2\): stage 1 of 6, pad and footings: 0 of \d+ parts built/.test(line), `the progress line: ${line}`);

// 3. The jobs' cells at every turn, then every job built
for (const rot of [0, 90, 180, 270]) {
  const s = mon.siteSize(m, rot);
  m.site = { x1: sx, z1: sz, x2: sx + s.w - 1, z2: sz + s.d - 1, y: home.y - 1, rotate: rot, prepared: true };
  let bad = 0, total = 0;
  const seen = new Set<string>();
  plan.jobs.forEach((j: Any, i: number) => {
    const t = mon.jobTargets(m, i, turnState);
    total += t.length;
    if (t.length !== j.blocks) bad++;
    for (const c of t) seen.add(`${c.x},${c.y},${c.z}`);
    if (t.some((c: Any) => c.x < m.site.x1 || c.x > m.site.x2 || c.z < m.site.z1 || c.z > m.site.z2 || c.y < m.site.y)) bad++;
  });
  ok(!bad && total === plan.design.blocks && seen.size === total, `rotate ${rot}: ${bad} jobs off their cells or the footprint (${total} of ${plan.design.blocks}, ${seen.size} distinct)`);
}
m.site.rotate = 0;
let guard = 0;
while (mon.currentStage(m) && guard++ < 200) for (const i of mon.openJobs(m)) mon.jobBuilt(m, i, {}, clock + guard);
ok(m.state === 'built' && m.done.length === plan.jobs.length && m.stages.length === 6, `every job built: ${m.state}, ${m.done.length} of ${plan.jobs.length}, ${m.stages.length} stages timed`);

// 4. The site search on flat ground round the hub
const { hub } = mon.siteHub(v, home.y);
const taken = mon.siteTaken(v, [], [], clock, 'Mayor');
const fresh = mon.newMonument('oak', clock);
const found = mon.searchSite(fresh, { hub: hub!, home: home.y - 1, range: 144, ground: () => home.y - 1, takenAt: taken, grids: [2, 1] });
ok(!('why' in found), `the site search: ${JSON.stringify(found).slice(0, 160)}`);
if (!('why' in found)) {
  let clash = 0;
  for (let x = found.site.x1; x <= found.site.x2; x++) for (let z = found.site.z1; z <= found.site.z2; z++) if (taken(x, z)) clash++;
  ok(!clash, `the site on ${clash} taken cells`);
  quiet.log(`site: ${JSON.stringify(found.site)} (grid ${found.f})`);
}

quiet.log(failures ? `FAIL castle_monument: ${failures} of ${checks} checks` : `PASS: ${checks} checks, 0 failures`);
process.exit(failures ? 1 : 0);
