/**
 * The palette refactor's no-behaviour-change check (#172, spec runs/2026-10-28/palette/spec.md), offline: train 8's
 * checkpoint (t7_c_greens_full: village C, 25 members, full 15-greens) loaded into a real MineflayerWorld on a scratch copy
 * (menu_probe.mts's harness: the clock frozen at the checkpoint's time, RCON stubbed, console muted, save() counted), with
 * train 8 R1's settings (the model chooser and every flag it ran with) and its recorded model calls replayed
 * (MC_MODEL_REPLAY, sequence mode: each member's Nth choose call answered by R1's Nth reply for that member). Per sweep
 * (SWEEPS, 31 s apart, every queued action done between them): every member's model-mode menu (each option's fields, the
 * guarded ids, the reasons), its feasible ids (what a pick is checked against), its fixed-mode menu, its prompt
 * (buildPrompt on a seeded shuffle, no memory section); then the sweep's picks (agent, id, source) and the actions queued.
 * `dump` writes them; `check` compares and prints the first differences. With MC_CHOOSE=open (`open`) it instead checks
 * the open palette's invariants: the open menu holds the model menu's feasible options, no option a law refuses, none
 * reserved by another member, every pick on the fresh palette, and the prompt within PROMPT_MAX characters.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/palette_golden.mts dump|check|open GOLDEN.json
 *   [--checkpoint DIR] [--replay CALLS.jsonl] [--sweeps N] [--law] [--env K=V,...] [--save FILE]
 * (default checkpoint mc/testcheckpoints/t7_c_greens_full, replay runs/model-calls/2026-10-28-32228.jsonl: R1's)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workerName } from '../../server/src/agentNames';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const CHECKPOINT = opt('--checkpoint') ?? 'mc/testcheckpoints/t7_c_greens_full';
const REPLAY = opt('--replay') ?? 'runs/model-calls/2026-10-28-32228.jsonl';
const SWEEPS = Number(opt('--sweeps') ?? 6);
/** --env K=V,...: settings over R1's (e.g. MC_APPETITE= for members not held to food work); --save FILE: the open dump. */
const ENV = Object.fromEntries((opt('--env') ?? '').split(',').filter(Boolean).map((kv) => [kv.split('=')[0], kv.split('=').slice(1).join('=')]));
const SAVE = opt('--save');
/** --law: a floor on logs and a quota of no torches enacted first, so the law's verdict runs on most menus. */
const LAW = argv.includes('--law') ? (argv.splice(argv.indexOf('--law'), 1), true) : false;
const [mode, golden] = argv;
if (!/^(dump|check|open)$/.test(mode ?? '') || (mode !== 'open' && !golden)) {
  console.log('usage: palette_golden.mts dump|check|open GOLDEN.json [--checkpoint DIR] [--replay CALLS.jsonl] [--sweeps N]');
  process.exit(2);
}
const villagesFile = path.join(CHECKPOINT, 'villages.json');
for (const f of [villagesFile, REPLAY]) if (!fs.existsSync(f)) {
  console.log(`SKIP palette_golden: no ${f}`);
  process.exit(0);
}
/** The open prompt's ceiling in characters (~5,000 tokens). */
const PROMPT_MAX = 20000;

// Train 8 R1's settings (runs/2026-10-28/train8/R1.profile.json), read when the world's modules load: set first
const R1: Record<string, string> = {
  MC_NEEDS: 'on', MC_APPETITE: '18', MC_NEED_HOLD_MIN: '2', MC_NEED_FIELD_COOLDOWN_MIN: '5', MC_VILLAGE_RANGE: '144', MC_MEMORY: 'on', MC_CLOCK: 'on',
  MC_MEMORY_QUALITY: 'on', MCAI_SOCIAL: 'on', MCAI_SOCIAL_ROLES: 'show', MC_ACTS: 'on', MC_CONTROLLER: 'on', MC_CHARACTER: 'on', MCAI_TEMPERAMENT: 'on',
  MC_SKILL: 'on', MC_GOALS: 'on', MC_PROPOSALS: 'on', MC_RULES: 'on', MC_COUNCIL: 'on', MC_OWN: 'on', MC_BARTER: 'on', MC_SPECIAL: 'claim', MC_OWN_SALES: 'on',
  MC_OWN_FARM: 'on', MC_MERCHANT: 'on', MC_MERCHANT_ORDERS: 'on', MC_INNOVATE: 'on', MC_WANTED: 'on', MC_WORKS_GROW: 'on', MC_WORKS_REPEAT: 'on', MC_GROW_FARMS: '1',
  MC_NEED_FARMSTEAD: 'on', MC_GARDENS: 'on', MC_QUICK_NEXT: 'on', MC_WORK_BLOCKS: 'on', MC_LADDER: 'on', MC_IRON_AGE: 'on', MC_OWN_TOOLS: 'on', MC_ORE_MINE: 'on',
  MC_NEED_VOTE: 'on', MC_LEVY_VOTE: 'day2', MC_VANILLA_ALL: 'on', MC_WOOD_VARIANTS: 'on', MC_PAY: 'on', MC_ORE_VEIN: 'on', MC_LLM_LIMITS: 'off', MC_GEN_HOMES: 'on',
  MC_CHOOSE: 'model', MC_LETTERS: 'on', MC_HOME_BASICS: 'on', MC_NEWS: 'on', MC_QUESTIONS: 'on', MC_DELIBERATE: 'on', MC_ACT_FIXES: 'on', MC_TALK_HOLDOUT: '0',
  MC_CHOOSE_BACKUP: 'on', MC_BAN_SCOPE: 'member', MC_ACT_HINTS: 'on', MC_PAY_BOUNTY: '0.5', MC_REFLECT: 'on', MC_IRON_STAIRS2: 'off', MC_OPEN_STORAGE: 'on',
  MC_LETTERS_PACE: 'on', MC_PAD_HALO: 'on', MC_GREENS_MORE: 'on', MC_GREENS_MIX: 'on', MC_RULE_TYPES: 'claim,report,stock', MC_RULE_WORDS: 'on',
  MC_RULE_FEASIBLE: 'on', MC_RULE_RESULTS: 'on', MC_LAW_BACKING: 'failures', MC_CUSTOMS: 'on', MC_CUSTOM_FACTS: 'on',
};
Object.assign(process.env, R1, {
  MC_CHOOSE: mode === 'open' ? 'open' : 'model', MC_MODEL_REPLAY: REPLAY, MC_MODEL_RECORD: '0', MC_VOTE: 'off', MC_PROJECTS: 'off', MC_GROW: '0', MC_TIME_SCALE: '1',
}, ENV);
for (const [k, val] of Object.entries(ENV)) if (val === '') delete process.env[k];
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'palette-golden-'));
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
process.env.MCAI_ACTS_LOG = path.join(SCRATCH, 'acts.jsonl');

// (never the network: a call with nothing to replay fails at once, counted; the calls are the recording's only)
process.env.MC_OLLAMA_URL = 'http://127.0.0.1:9';
let unreplayed = 0;
globalThis.fetch = (async () => {
  unreplayed++;
  throw new Error('palette_golden: offline');
}) as typeof fetch;
const cpFile = path.join(CHECKPOINT, 'checkpoint.json');
const cpTime = fs.existsSync(cpFile) ? Date.parse(String(JSON.parse(fs.readFileSync(cpFile, 'utf8')).time ?? '').replace(' ', 'T')) : NaN;
let clock = Number.isFinite(cpTime) ? cpTime : Date.parse('2026-10-28T12:00:00Z');
Date.now = () => clock;

const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const errors: string[] = [];
function mute() {
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.error = (...a: unknown[]) => {
    const s = a.map(String).join(' ');
    if (/^\[vanilla\] block lists from/.test(s)) return;
    errors.push(a.map((x) => (x instanceof Error ? x.stack ?? x.message : String(x))).join(' ').slice(0, 400));
  };
}
const unmute = () => Object.assign(console, quiet);
const say = (s: string) => quiet.log(s);

mute();
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const { buildPrompt, shuffled } = (await import(new URL('../../server/src/choose.ts', import.meta.url).href)) as Any;
const { enact } = await import('../../server/src/rules');
unmute();

const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
for (const f of ['villages.json', 'atlas.json', 'social.json', 'proposals.json']) if (fs.existsSync(path.join(CHECKPOINT, f))) fs.copyFileSync(path.join(CHECKPOINT, f), path.join(dir, f));
const data = JSON.parse(fs.readFileSync(villagesFile, 'utf8')) as { villages: Any[] };
const base = data.villages.find((x) => x.complete) ?? data.villages[0];
mute();
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
unmute();
const reg = w.villages as Any;
reg.save = () => {};
if (w.atlas) w.atlas.save = () => {};
const v = reg.get(base.name);
if (!v) {
  say(`village ${base.name} not loaded`);
  process.exit(2);
}

if (LAW) for (const [i, l] of [{ type: 'floor', params: { class: 'logs', n: 100000 }, text: 'the storage keeps 100000 logs' }, { type: 'quota', params: { class: 'torches', n: 0 }, text: 'no member takes torches' }].entries())
  enact(v.name, { id: `g${i}`, by: 'Mayor', at: clock, day: 1, what: '', why: '', backers: [], opposers: [], status: 'passed', ...l } as Any, { yes: 25, no: 0, abstain: 0 }, clock);
const chest0 = v.storage?.chests?.[0];
const plot0 = v.plots.find((p: Any) => !p.annex);
const home = chest0 ? { x: chest0.x, y: chest0.y, z: chest0.z } : { x: Math.floor((plot0.x1 + plot0.x2) / 2), y: plot0.y + 1, z: Math.floor((plot0.z1 + plot0.z2) / 2) };
const sections = new Array(24).fill(null);
const getColumn = () => ({ minY: -64, sections, getBlockStateId: () => 0 });
const statuses: Any[] = [];
let nextId = 1;
const NAMES = ['Mayor', ...Array.from({ length: 24 }, (_, i) => workerName(i + 1))];
const agents: Any[] = [];
for (const name of NAMES) {
  const own: Any[] = [];
  const memory = { village: v.name, villageRole: name === 'Mayor' ? 'mayor' : 'worker' };
  const a: Any = {
    name, role: memory.villageRole, memory, world: w,
    village: () => reg.get(memory.village),
    idle: () => !own.some((s) => s.state === 'queued' || s.state === 'running'),
    enqueue: (type: string, args: Record<string, unknown>) => {
      const s = { id: nextId++, type, args, state: 'queued', agent: name };
      own.push(s);
      statuses.push(s);
      return s;
    },
    bot: { entity: { position: { x: home.x + 0.5, y: home.y, z: home.z + 0.5 } }, entities: {}, inventory: { items: () => [] }, world: { getColumn }, game: { minY: -64 } },
  };
  agents.push(a);
  w.agents.set(name.toLowerCase(), a);
}

const picks: Any[] = [];
const run = w.runChoice.bind(w);
w.runChoice = (a: Any, id: string, meta: Any) => {
  const r = run(a, id, meta);
  picks.push({ agent: a.name, id, source: meta?.source ?? '', ok: !!r?.ok });
  return r;
};
const runPick = w.runPick.bind(w);
w.runPick = (a: Any, id: string | null, meta: Any, reask: Any, backup: Any) => {
  const r = runPick(a, id, meta, reask, backup);
  if (meta?.source === 'model' || meta?.source === 'fallback') picks.push({ agent: a.name, id, source: meta?.source ?? '', ok: !!r?.ok, key: r?.key ?? r?.why });
  return r;
};

/** An option as compared: every field but the run data, keys sorted. */
const norm = (o: Any) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/** The palette's verdicts over every model-mode menu built (printed, not compared: the golden before #172 has none). */
const dropCounts: Record<string, number> = {};
function menusNow(): Any {
  const out: Any = {};
  for (const a of agents) {
    if (!w.isIdleMember(v, a, clock)) {
      out[a.name] = null;
      continue;
    }
    const busy = w.heldKeys(v, clock, 'sweep');
    const facts = w.makeFacts(v, clock, a);
    const m = w.menu(v, a, busy, true, facts);
    const f = w.menu(v, a, busy, false, w.makeFacts(v, clock, a));
    for (const d of m.dropped ?? []) dropCounts[d.by] = (dropCounts[d.by] ?? 0) + 1;
    const shown = shuffled(m.menu.options, `golden|${a.name}`);
    const p = buildPrompt(m.menu, shown);
    out[a.name] = {
      options: m.menu.options.map(norm), guarded: m.menu.guarded, reasons: m.menu.reasons, feasible: m.feasible.map((o: Any) => o.id),
      fixed: f.menu.options.map((o: Any) => `${o.id}@${o.rank}`), prompt: p.user, promptSha: sha(p.system + p.user + JSON.stringify(p.tools)),
      // (openbench.mts sends these as recorded; not compared: the golden before #172 has neither)
      ...(SAVE ? { system: p.system, tools: p.tools } : {}),
      ...(mode === 'open' ? { open: !!m.menu.open, takes: m.menu.options.filter((o: Any) => o.takes).length } : {}),
    };
  }
  return out;
}

const dumpOut: Any = { checkpoint: CHECKPOINT, replay: REPLAY, sweeps: [] as Any[] };
for (let k = 1; k <= SWEEPS; k++) {
  mute();
  let menus: Any = {};
  try {
    menus = menusNow();
  } catch (e) {
    errors.push(`menus threw: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 4).join(' | ')}`);
  }
  const p0 = picks.length, s0 = statuses.length;
  w.farmCheckAt = 0;
  try {
    w.farmChores();
  } catch (e) {
    errors.push(`farmChores threw: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`);
  }
  // (every decision in flight answered before the next step: the replay answers at once, a few turns of the loop each)
  // (twice, with a short real wait between: a call's gate and the deliberation may wait on a timer)
  for (let round = 0; round < 3; round++) {
    for (let j = 0; j < 400 && (j < 20 || w.pending.size || w.chooser.inFlight || agents.some((a) => w.chooser.pending(a.name))); j++) await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 30));
  }
  unmute();
  dumpOut.sweeps.push({ menus, picks: picks.slice(p0), actions: statuses.slice(s0).map((s) => `${s.agent} ${s.type} ${JSON.stringify(s.args)}`) });
  for (const s of statuses) if (s.state === 'queued' || s.state === 'running') Object.assign(s, { state: 'done', message: `${s.type} done` });
  mute();
  try {
    w.endChoices();
  } catch (e) {
    errors.push(`endChoices threw: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`);
  }
  unmute();
  clock += 31000;
}
fs.rmSync(SCRATCH, { recursive: true, force: true });
const verdicts = Object.entries(dropCounts).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';

const nMenus = dumpOut.sweeps.reduce((t: number, s: Any) => t + Object.values(s.menus).filter(Boolean).length, 0);
const nPicks = dumpOut.sweeps.reduce((t: number, s: Any) => t + s.picks.length, 0);
const bySource = (src: string) => dumpOut.sweeps.reduce((t: number, s: Any) => t + s.picks.filter((p: Any) => p.source === src).length, 0);
say(`palette_golden ${mode}: ${CHECKPOINT}, village ${v.name}, ${SWEEPS} sweeps; ${nMenus} menus, ${nPicks} picks (model ${bySource('model')}, fallback ${bySource('fallback')}, fixed ${bySource('fixed')}); palette verdicts ${verdicts}; unreplayed calls ${unreplayed}; console.error ${errors.length}`);
for (const e of [...new Set(errors.map((e) => e.split('\n')[0]))].slice(0, 5)) say(`  ERROR ${e.slice(0, 300)}`);

if (mode === 'dump') {
  fs.writeFileSync(golden, JSON.stringify(dumpOut));
  if (SAVE) fs.writeFileSync(SAVE, JSON.stringify(dumpOut));
  say(`wrote ${golden}`);
  process.exit(errors.length ? 1 : 0);
}

if (mode === 'check') {
  const old = JSON.parse(fs.readFileSync(golden, 'utf8'));
  const diffs: string[] = [];
  for (const [i, s] of dumpOut.sweeps.entries()) {
    const o = old.sweeps[i];
    if (!o) {
      diffs.push(`S${i + 1}: not in the golden`);
      continue;
    }
    for (const name of new Set([...Object.keys(s.menus), ...Object.keys(o.menus)])) {
      const a = s.menus[name], b = o.menus[name];
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      if (!a || !b) {
        diffs.push(`S${i + 1} ${name}: menu ${a ? 'now' : 'gone'}`);
        continue;
      }
      for (const key of Object.keys(b)) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        if (key === 'prompt') {
          const la = String(a.prompt).split('\n'), lb = String(b.prompt).split('\n');
          const j = la.findIndex((l, n) => l !== lb[n]);
          diffs.push(`S${i + 1} ${name} prompt line ${j}: now "${(la[j] ?? '').slice(0, 160)}" was "${(lb[j] ?? '').slice(0, 160)}"`);
        } else diffs.push(`S${i + 1} ${name} ${key}: now ${JSON.stringify(a[key]).slice(0, 240)} was ${JSON.stringify(b[key]).slice(0, 240)}`);
      }
    }
    if (JSON.stringify(s.picks) !== JSON.stringify(o.picks)) diffs.push(`S${i + 1} picks: now ${JSON.stringify(s.picks).slice(0, 300)} was ${JSON.stringify(o.picks).slice(0, 300)}`);
    if (JSON.stringify(s.actions) !== JSON.stringify(o.actions)) diffs.push(`S${i + 1} actions differ (${s.actions.length} now, ${o.actions.length} before)`);
  }
  for (const d of diffs.slice(0, 20)) say(`  DIFF ${d}`);
  say(diffs.length ? `FAIL palette_golden: ${diffs.length} differences` : `PASS palette_golden: ${nMenus} menus, ${nPicks} picks identical`);
  process.exit(diffs.length ? 1 : 0);
}

// open: the palette's invariants
if (SAVE) fs.writeFileSync(SAVE, JSON.stringify(dumpOut));
const fails: string[] = [];
let sizes: number[] = [], opts: number[] = [];
for (const [i, s] of dumpOut.sweeps.entries())
  for (const [name, m] of Object.entries(s.menus) as Array<[string, Any]>) {
    if (!m) continue;
    if (!m.open) fails.push(`S${i + 1} ${name}: the menu is not open`);
    sizes.push(m.prompt.length);
    opts.push(m.options.length);
    if (m.prompt.length > PROMPT_MAX) fails.push(`S${i + 1} ${name}: prompt ${m.prompt.length} chars`);
    const ids = new Set(m.options.map((o: Any) => o.id));
    if (m.feasible.some((id: string) => !ids.has(id))) fails.push(`S${i + 1} ${name}: feasible options missing from the open menu`);
    if (m.guarded.some((g: Any) => g.why === 'trimmed')) fails.push(`S${i + 1} ${name}: an option trimmed`);
    if (new Set(m.options.map((o: Any) => o.name)).size !== m.options.length) fails.push(`S${i + 1} ${name}: two options share a name`);
  }
// (an open decision holds nothing, so a pick another member took meanwhile is re-asked or backed up: counted, not failed;
// any other refusal of a model pick fails)
let taken = 0, modelPicks = 0;
for (const [i, s] of dumpOut.sweeps.entries())
  for (const p of s.picks) {
    if (p.source !== 'model') continue;
    modelPicks++;
    if (p.ok) continue;
    if (p.key === 'reask') taken++;
    else fails.push(`S${i + 1} ${p.agent}: a model pick ${p.id} refused (${p.key})`);
  }
// (the menu's own prompts beside, from the model mode's run of the same sweeps when a golden is given)
let menuMedian = 0;
if (golden && fs.existsSync(golden)) {
  const ms = (JSON.parse(fs.readFileSync(golden, 'utf8')).sweeps as Any[]).flatMap((s) => Object.values(s.menus).filter(Boolean).map((m: Any) => m.prompt.length)).sort((a: number, b: number) => a - b);
  menuMedian = ms[Math.floor(ms.length / 2)] ?? 0;
}
sizes = sizes.sort((a, b) => a - b);
opts = opts.sort((a, b) => a - b);
const q = (xs: number[], f: number) => xs[Math.min(xs.length - 1, Math.floor(f * xs.length))] ?? 0;
say(`open menus: options median ${q(opts, 0.5)} (max ${q(opts, 1)}); prompt chars median ${q(sizes, 0.5)}, p90 ${q(sizes, 0.9)}, max ${q(sizes, 1)} (~${Math.round(q(sizes, 0.5) / 4)} tokens median)${menuMedian ? `; the menu's median ${menuMedian}` : ''}; model picks taken meanwhile and re-asked: ${taken} of ${modelPicks}`);
for (const f of fails.slice(0, 15)) say(`  FAIL ${f}`);
say(fails.length || errors.length ? `FAIL palette_golden open: ${fails.length} invariant failures, ${errors.length} errors` : `PASS palette_golden open: ${nMenus} open menus, ${nPicks} picks`);
process.exit(fails.length || errors.length ? 1 : 0);
