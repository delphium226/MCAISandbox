/**
 * #97 (MC_CHOICE_HOLDS) checked offline on a checkpoint (menu_ctx_golden.mts' harness: a real MineflayerWorld on a scratch
 * copy, the clock frozen, RCON stubbed, 25 fake members at the first chest, all idle; no server, ~10 s).
 * The chooser's queue is stubbed so a submitted decision stays in flight (submitDecision's own code takes its holds). Then:
 * every key a pending decision's menu holds is on no other member's menu; a member's own holds never leave its own menu
 * (choices() of a pending member is null, so its fresh menu is read with the decision taken out of the record, as runPick
 * sees it); with INITIATIVES_MAX pending decisions shown a project of their own, no other member is offered one; once the
 * decisions are dropped, every menu is as it was before them; with the flag off nothing changes (run as a child).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/choice_holds.mts [CHECKPOINT_DIR]   (default mc/testcheckpoints/mv3_base25)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workerName } from '../../server/src/agentNames';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const cpDir = process.argv[2] ?? 'mc/testcheckpoints/mv3_base25';
const villagesFile = path.join(cpDir, 'villages.json');
if (!fs.existsSync(villagesFile)) {
  console.log(`SKIP choice_holds: ${villagesFile} is not here`);
  process.exit(0);
}
const OFF = process.env.CHOICE_HOLDS_CHILD === 'off';
process.env.MC_CHOOSE = 'model';
process.env.MC_VOTE = 'off';
process.env.MC_GROW = '0';
process.env.MC_TIME_SCALE = '1';
process.env.MC_MODEL_RECORD = '0';
process.env.MC_MEMORY = 'off';
process.env.MC_CHOICE_HOLDS = OFF ? 'off' : 'on';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'choice-holds-'));
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
const { parseSpec } = await import('../../server/src/modelCall');
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
// (the queue never runs a decision: each stays pending)
w.chooser = { submit: () => {}, cancel: () => {} };
const spec = parseSpec('ollama:gpt-oss:120b-cloud');

mute();
const menus = () => new Map(agents.map((a) => [a.name, (w.choices(a)?.options ?? []).map((o: Any) => o.id).sort().join(',')]));
const before = menus();
const pend = (a: Any) => {
  const m = w.choices(a);
  if (!m || m.options.length < 2) return null;
  w.submitDecision(v, a, m, { decisionId: `t-${a.name}`, spec });
  return m;
};
// 1. Three members' decisions in flight, one after another (as a sweep submits them)
const first = agents.slice(1, 4).map((a) => ({ a, m: pend(a) })).filter((x) => x.m);
unmute();
ok(first.length >= 2, `only ${first.length} decisions submitted`);
mute();
const keyOf = (o: Any) => [o.key, ...(o.holds ?? [])];
for (const { a, m } of first) {
  const p = w.pending.get(a.name.toLowerCase());
  unmute();
  ok(OFF ? !p?.holds : p?.holds?.length, `${a.name}: holds ${OFF ? 'taken with the flag off' : 'not taken'}`);
  mute();
  for (const b of agents) {
    if (b === a || w.pending.has(b.name.toLowerCase())) continue;
    const got = w.choices(b);
    if (!got) continue;
    const keys = new Set(got.options.flatMap(keyOf));
    // (a member's own keys, "initiate:ada", are never on another's menu anyway; multi-instance options get another key)
    const clash = m.options.filter((o: Any) => keys.has(o.key));
    unmute();
    if (OFF) { mute(); continue; }
    ok(!clash.length, `${b.name}'s menu offers ${clash.map((o: Any) => o.id).join(', ')} held by ${a.name}'s pending decision`);
    mute();
  }
}
// (what the holds cost the others: their menus' sizes now against before)
const sizesNow = agents.filter((b) => !w.pending.has(b.name.toLowerCase())).map((b) => w.choices(b)?.options.length ?? 0);
const sizesBefore = agents.filter((b) => !w.pending.has(b.name.toLowerCase())).map((b) => (before.get(b.name) ? before.get(b.name)!.split(',').length : 0));
const mean = (xs: number[]) => (xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length)).toFixed(1);
const cost = `the others' menus ${mean(sizesBefore)} -> ${mean(sizesNow)} options, ${sizesNow.filter((n) => !n).length} empty`;
// 2. A pending member's own menu (as runPick reads it, its decision out of the record) still holds its own options
for (const { a, m } of first) {
  const id = a.name.toLowerCase();
  const p = w.pending.get(id);
  w.pending.delete(id);
  const mine = new Set((w.choices(a)?.options ?? []).map((o: Any) => o.id));
  w.pending.set(id, p);
  const lost = m.options.filter((o: Any) => !mine.has(o.id));
  unmute();
  ok(!lost.length, `${a.name}'s own options left its menu: ${lost.map((o: Any) => o.id).join(', ')}`);
  mute();
}
// 3. The projects' cap: decisions shown a project of their own fill it
for (const { a } of first) w.dropDecision(w.pending.get(a.name.toLowerCase()), 'busy');
const initiators: Any[] = [];
for (const a of agents.slice(1)) {
  if (initiators.length >= 3) break;
  const m = w.choices(a);
  if (m?.options.some((o: Any) => o.kind === 'initiate') && m.options.length >= 2) {
    w.submitDecision(v, a, m, { decisionId: `i-${a.name}`, spec });
    initiators.push(a);
  }
}
const offered = agents.filter((b) => !w.pending.has(b.name.toLowerCase())).filter((b) => (w.choices(b)?.options ?? []).some((o: Any) => o.kind === 'initiate')).length;
const openNow = (v.initiatives ?? []).filter((i: Any) => i.state === 'open').length;
unmute();
if (initiators.length + openNow >= 3) ok(OFF ? offered > 0 : offered === 0, `${offered} members offered a project of their own with ${initiators.length} pending and ${openNow} open`);
else quiet.log(`  (the cap not reached: ${initiators.length} pending initiators, ${openNow} open)`);
mute();
// 4. Every decision dropped: the menus as before
for (const a of initiators) w.dropDecision(w.pending.get(a.name.toLowerCase()), 'busy');
const after = menus();
unmute();
ok(w.pending.size === 0, `${w.pending.size} decisions left pending`);
ok([...before].every(([k, s]) => after.get(k) === s), 'the menus differ after every hold was released');
const shown = [...before.values()].filter(Boolean).length;
quiet.log(`  ${OFF ? 'flag off' : 'flag on'}: ${first.length} decisions in flight, ${cost}; ${initiators.length} shown a project; ${offered} others offered a project then; ${shown} members with a menu`);

if (!OFF) {
  const out = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/checks/choice_holds.mts', cpDir], { env: { ...process.env, CHOICE_HOLDS_CHILD: 'off', MC_CHOICE_HOLDS: 'off' }, encoding: 'utf8' });
  const tail = out.trim().split('\n');
  quiet.log(tail.slice(-2).join('\n'));
  ok(/PASS/.test(tail[tail.length - 1]), 'the flag-off run failed');
}
quiet.log(`${failures ? 'FAIL' : 'PASS'}: ${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
