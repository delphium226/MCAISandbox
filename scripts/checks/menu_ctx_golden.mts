/**
 * Every member's model-mode chore menu and prompt context on a checkpoint, as text, against a dump made before a change
 * (G2, #27; the spec check's M4): choice_golden runs fixed mode with no families and prompt_golden rebuilds prompts from
 * the logged context, so neither sees what choiceContext, option names, facts and effects say. This one loads the record
 * into a real MineflayerWorld (menu_probe.mts' harness: clock frozen at the checkpoint's time, RCON stubbed, fake members
 * at the first chest, all idle) in model mode with the default families, and writes per member its context and every
 * option (id, kind, key, name, facts, effect, need, weights), plus the chooser's full prompt (buildPrompt, shuffled by a
 * fixed seed) with memory off.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/menu_ctx_golden.mts dump OUT.json [CHECKPOINT_DIR]
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/menu_ctx_golden.mts check OUT.json [CHECKPOINT_DIR]
 *   MCAI_SOCIAL=off node node_modules/tsx/dist/cli.mjs scripts/checks/menu_ctx_golden.mts audit - [CHECKPOINT_DIR]
 * (audit, G2: under the shell's MCAI_SOCIAL, every member's option names are unique, and under off no prompt or tool names
 * another member or carries the others' line; "the Mayor" is a role word and allowed)
 * (default checkpoint mc/testcheckpoints/mv3_grown25; check exits 1 on any difference, printing the first few; skipped
 * when the dump or the checkpoint is missing)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workerName } from '../../server/src/agentNames';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const [mode, out, cpDir = 'mc/testcheckpoints/mv3_grown25'] = process.argv.slice(2);
if ((mode !== 'dump' && mode !== 'check' && mode !== 'audit') || !out) {
  console.log('usage: menu_ctx_golden.mts dump|check|audit OUT.json [CHECKPOINT_DIR]');
  process.exit(2);
}
const villagesFile = path.join(cpDir, 'villages.json');
if (!fs.existsSync(villagesFile) || (mode === 'check' && !fs.existsSync(out))) {
  console.log(`SKIP menu_ctx_golden: ${!fs.existsSync(villagesFile) ? villagesFile : out} is not here`);
  process.exit(0);
}

// (read when the modules load: set first; every G2 setting at its default)
process.env.MC_CHOOSE = 'model';
process.env.MC_VOTE = 'off';
process.env.MC_PROJECTS = 'off';
process.env.MC_GROW = '0';
process.env.MC_TIME_SCALE = '1';
process.env.MC_MODEL_RECORD = '0';
process.env.MC_MEMORY = 'off';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-ctx-'));
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
process.env.MCAI_ACTS_LOG = path.join(SCRATCH, 'acts.jsonl');

const cpFile = path.join(cpDir, 'checkpoint.json');
const cpTime = fs.existsSync(cpFile) ? Date.parse(String(JSON.parse(fs.readFileSync(cpFile, 'utf8')).time ?? '').replace(' ', 'T')) : NaN;
const clock = Number.isFinite(cpTime) ? cpTime : fs.statSync(villagesFile).mtimeMs;
Date.now = () => clock;

const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const mute = () => {
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.error = () => {};
};
const unmute = () => Object.assign(console, quiet);

mute();
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const { buildPrompt, shuffled } = await import('../../server/src/choose');
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
    name, role: memory.villageRole, memory, world: w,
    village: () => reg.get(memory.village),
    idle: () => !own.some((s) => s.state === 'queued' || s.state === 'running'),
    enqueue: (type: string, args: Record<string, unknown>) => {
      const s = { id: own.length + 1, type, args, state: 'queued', agent: name };
      own.push(s);
      return s;
    },
    bot: { entity: { position: { x: home.x + 0.5, y: home.y, z: home.z + 0.5 } }, entities: {}, inventory: { items: () => [] }, world: { getColumn }, game: { minY: -64 } },
  };
  agents.push(a);
  w.agents.set(name.toLowerCase(), a);
}

const dumpOf: Record<string, Any> = {};
/** Every idle member's menu, context and prompt, under `tag`. */
function pass(tag: string) {
mute();
for (const a of agents) {
  if (!a.idle()) continue;
  let menu: Any = null;
  try {
    menu = w.choices(a);
  } catch (e) {
    menu = { error: String((e as Error)?.message ?? e) };
  }
  if (!menu || menu.error) {
    dumpOf[`${tag}|${a.name}`] = menu;
    continue;
  }
  const opts = (menu.options ?? []).map((o: Any) => ({
    id: o.id, kind: o.kind, key: o.key, name: o.name, facts: o.facts, effect: o.effect, need: o.need, rank: o.rank, lp: o.lp, tw: o.tw, nw: o.nw, ww: o.ww, gw: o.gw,
  }));
  const p = buildPrompt(menu, shuffled(menu.options, `golden|${a.name}`));
  dumpOf[`${tag}|${a.name}`] = { ctx: menu.ctx, options: opts, guarded: menu.guarded, reasons: menu.reasons, system: p.system, user: p.user, tools: p.tools };
}
unmute();
}
pass('1');
// Pass 2: two members start chores (Ada her own project, Ben the first make), so help options, the others' line and
// "on it" facts show in everyone else's menus
mute();
for (const [who, kind] of [['Ada', 'initiate'], ['Ben', 'make']] as const) {
  const a = agents.find((x) => x.name === who);
  const menu = a ? w.choices(a) : null;
  const o = menu?.options?.find((x: Any) => x.kind === kind);
  if (a && o) w.runChoice(a, o.id, { source: 'fixed', reason: 'golden', menu });
}
unmute();
pass('2');

if (mode === 'audit') {
  const bad: string[] = [];
  const off = (process.env.MCAI_SOCIAL ?? '').toLowerCase() === 'off';
  for (const [k, m] of Object.entries(dumpOf)) {
    if (!m?.options) continue;
    const names = m.options.map((o: Any) => o.name);
    if (new Set(names).size !== names.length) bad.push(`${k}: option names repeat: ${names.join(' | ')}`);
    if (!off) continue;
    const self = k.split('|')[1];
    const text = `${m.system}\n${m.user}\n${JSON.stringify(m.tools)}`.replace(/\bthe Mayor\b/gi, '');
    for (const n of NAMES) if (n !== self && new RegExp(`\\b${n}\\b`).test(text)) bad.push(`${k}: names ${n}`);
    if (/Others now|What the others are doing|on it:|helping:/.test(text)) bad.push(`${k}: shows others' activity`);
  }
  for (const b of bad.slice(0, 10)) console.log(`  ${b}`);
  console.log(`menu_ctx_golden audit (MCAI_SOCIAL=${process.env.MCAI_SOCIAL ?? 'legacy'}): ${bad.length ? `FAIL, ${bad.length} problems` : `OK, ${Object.keys(dumpOf).length} menus`}`);
  process.exit(bad.length ? 1 : 0);
}
if (mode === 'dump') {
  fs.writeFileSync(out, JSON.stringify(dumpOf, null, 1));
  const n = Object.values(dumpOf).filter((m: Any) => m?.options).length;
  console.log(`menu_ctx_golden: dumped ${n} members' menus (${Object.values(dumpOf).reduce((s: number, m: Any) => s + (m?.options?.length ?? 0), 0)} options) to ${out}`);
  process.exit(0);
}
const want = JSON.parse(fs.readFileSync(out, 'utf8')) as Record<string, Any>;
const diffs: string[] = [];
const cmp = (a: unknown, b: unknown, where: string) => {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa === sb) return;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) cmp((a as Any)[k], (b as Any)[k], `${where}.${k}`);
    return;
  }
  diffs.push(`${where}: ${String(sb).slice(0, 160)} -> ${String(sa).slice(0, 160)}`);
};
for (const name of new Set([...Object.keys(want), ...Object.keys(dumpOf)])) cmp(dumpOf[name], want[name], name);
if (diffs.length) {
  for (const d of diffs.slice(0, 12)) console.log(`  ${d}`);
  console.log(`menu_ctx_golden: FAIL, ${diffs.length} differences against ${out}`);
  process.exit(1);
}
console.log(`menu_ctx_golden: OK, ${Object.keys(want).length} members' menus, contexts and prompts identical to ${out}`);
