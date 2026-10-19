/**
 * What the chore menu offers and what the fixed chooser picks, offline (no server), on a test checkpoint's village record
 * (lesson 140: see a new chore family work on its real path before a live run). First target: s35's initiatives
 * (`initiate`, `help`). The record is loaded into a real MineflayerWorld on a scratch copy (choice_golden.mts's harness,
 * cut down): the clock frozen at the checkpoint's time, RCON stubbed, console muted, save() counted, never written; the
 * members are fakes (Mayor and 24 workers, the pool's names) whose enqueue records the call and that are idle while none of their actions is
 * queued or running, sharing a bot.world of air.
 * Part 1: every member's menu (choices()) as one line: the kinds in rank order with counts, the fixed pick, the reasons for
 * absent kinds. Part 2: N sweeps (farmCheckAt = 0, farmChores(); every queued action done, a deposit's load credited to
 * the first chest so the next step sees it; endChoices(); the clock 31 s on), with the picks by kind and the village's
 * initiatives after each. A build step is judged in initiativeTick by the structure standing (lesson 138), which never
 * happens offline: states are reported as they are.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/menu_probe.mts [CHECKPOINT_DIR | villages.json]
 *   [--families LIST] [--sweeps N] [--idle all|N] [--no-credit] [--stand] [--verbose]
 * (--idle N: Mayor and the first N-1 workers idle, the rest busy; --stand: a done build_design records its structure, as
 * the skill does, so initiativeTick's 'built' path runs)
 * (default mc/testcheckpoints/mv3_base25; a dir's villages.json and, when present, atlas.json)
 */
import fs from 'node:fs';
import { workerName } from '../../server/src/agentNames';
import os from 'node:os';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// ---- arguments -------------------------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const flag = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return false;
  argv.splice(i, 1);
  return true;
};
const FAMILIES = opt('--families') ?? 'make,gather,works,light,catalog,furnish,initiatives';
const SWEEPS = Number(opt('--sweeps') ?? 6);
const IDLE = opt('--idle') ?? 'all';
const CREDIT = !flag('--no-credit');
const VERBOSE = flag('--verbose');
const STAND = flag('--stand');
const input = argv[0] ?? 'mc/testcheckpoints/mv3_base25';
let villagesFile = input, atlasFile: string | null = null, cpFile: string | null = null;
if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
  villagesFile = path.join(input, 'villages.json');
  if (fs.existsSync(path.join(input, 'atlas.json'))) atlasFile = path.join(input, 'atlas.json');
  if (fs.existsSync(path.join(input, 'checkpoint.json'))) cpFile = path.join(input, 'checkpoint.json');
}
if (!fs.existsSync(villagesFile)) {
  console.log(`no ${villagesFile}`);
  process.exit(2);
}

// (read when the world's modules load: set first)
process.env.MC_CHOICE_FAMILIES = FAMILIES;
process.env.MC_CHOOSE = 'fixed';
process.env.MCAI_TEMPERAMENT ??= 'on';
process.env.MC_VOTE = 'off';
process.env.MC_PROJECTS = 'off';
process.env.MC_GROW = '0';
process.env.MC_TIME_SCALE = '1';
process.env.MC_MODEL_RECORD = '0';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-probe-'));
const CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
process.env.MCAI_CHOICE_LOG = CHOICE_LOG;

// The clock frozen at the checkpoint's time (else the record's file time)
const cpTime = cpFile ? Date.parse(String(JSON.parse(fs.readFileSync(cpFile, 'utf8')).time ?? '').replace(' ', 'T')) : NaN;
let clock = Number.isFinite(cpTime) ? cpTime : fs.statSync(villagesFile).mtimeMs;
const T0 = clock;
Date.now = () => clock;

const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const errors: string[] = [];
const lines: string[] = [];
function mute() {
  console.log = (...a: unknown[]) => {
    const s = a.map(String).join(' ');
    if (/^\[(initiative|choice-none|temper|need)\]/.test(s)) lines.push(s.slice(0, 300));
  };
  console.warn = () => {};
  console.info = () => {};
  console.error = (...a: unknown[]) => {
    const s = a.map(String).join(' ');
    // (the vanilla data's loading line goes to stderr: not an error)
    if (/^\[vanilla\] block lists from/.test(s)) return;
    errors.push(a.map((x) => (x instanceof Error ? x.stack ?? x.message : String(x))).join(' ').slice(0, 400));
  };
}
function unmute() {
  Object.assign(console, quiet);
}
const say = (s: string) => quiet.log(s);

mute();
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const { fixedPick } = (await import(new URL('../../server/src/choose.ts', import.meta.url).href)) as Any;
const { SMALL_WORKS, smallWorkSpots } = await import('../../server/src/smallWorks');
unmute();

// ---- the world ---------------------------------------------------------------------------------------------------------

const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
fs.copyFileSync(villagesFile, path.join(dir, 'villages.json'));
if (atlasFile) fs.copyFileSync(atlasFile, path.join(dir, 'atlas.json'));
const data = JSON.parse(fs.readFileSync(villagesFile, 'utf8')) as { villages: Any[] };
const base = data.villages.find((x) => x.complete) ?? data.villages[0];
if (!base) {
  say('no village in the record');
  process.exit(2);
}

mute();
const rconCmds: string[] = [];
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async (c: string) => { rconCmds.push(c); return ''; } } as never, dir) as Any;
unmute();
const reg = w.villages as Any;
let saves = 0;
reg.save = () => { saves++; };
if (w.atlas) w.atlas.save = () => {};
const notes: string[] = [];
const note = reg.note.bind(reg);
reg.note = (v: Any, text: string) => { notes.push(text); note(v, text); };
const v = reg.get(base.name);
if (!v) {
  say(`village ${base.name} not loaded`);
  process.exit(2);
}

// The members: fakes sharing a view of air at the first chest
const chest0 = v.storage?.chests?.[0];
const plot0 = v.plots.find((p: Any) => !p.annex);
const home = chest0 ? { x: chest0.x, y: chest0.y, z: chest0.z } : { x: Math.floor((plot0.x1 + plot0.x2) / 2), y: plot0.y + 1, z: Math.floor((plot0.z1 + plot0.z2) / 2) };
const sections = new Array(24).fill(null);
const getColumn = () => ({ minY: -64, sections, getBlockStateId: () => 0 });
const statuses: Any[] = [];
let nextId = 1;
// (#11, s38: the pool's first names, as the checkpoints are saved since then)
const NAMES = ['Mayor', ...Array.from({ length: 24 }, (_, i) => workerName(i + 1))];
const nIdle = IDLE === 'all' ? NAMES.length : Math.max(0, Math.min(NAMES.length, Number(IDLE)));
const agents: Any[] = [];
for (const [n, name] of NAMES.entries()) {
  const own: Any[] = [];
  const memory = { village: v.name, villageRole: name === 'Mayor' ? 'mayor' : 'worker' };
  const busy = n >= nIdle;
  const a: Any = {
    name, role: memory.villageRole, memory, world: w,
    village: () => reg.get(memory.village),
    idle: () => !busy && !own.some((s) => s.state === 'queued' || s.state === 'running'),
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

// Picks as they run (the fixed sweep calls this.runChoice)
const picks: Array<{ sweep: number; agent: string; id: string; kind: string; ok: boolean }> = [];
let sweepNo = 0;
const run = w.runChoice.bind(w);
w.runChoice = (a: Any, id: string, meta: Any) => {
  const r = run(a, id, meta);
  const kind = meta?.menu?.options?.find((o: Any) => o.id === id)?.kind ?? id.split(':')[0];
  picks.push({ sweep: sweepNo, agent: a.name, id, kind, ok: !!r?.ok });
  return r;
};

const countKinds = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const k of xs) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].map(([k, n]) => `${k} ${n}`).join(', ');
};

// ---- part 1: the menus --------------------------------------------------------------------------------------------------

say(`menu_probe: ${villagesFile}${atlasFile ? ' (+ atlas)' : ''}; village ${v.name} (complete ${!!v.complete}, ${v.structures.length} structures, hut ${!!v.storageHut}); families ${FAMILIES}; temperament ${process.env.MCAI_TEMPERAMENT}; ${nIdle} of ${NAMES.length} members idle; clock ${new Date(T0).toISOString()}`);
say(`initiatives in the record: ${(v.initiatives ?? []).length}`);
/** Free spots for each small work now (smallWorkSpots on the world's blocked areas, uncapped). */
function room(): string {
  try {
    const wood = w.catalogWoodOf(v);
    const { blocked, plots } = w.smallBlocked(v);
    return SMALL_WORKS.map((k: Any) => {
      const d = k.make(wood);
      return `${k.kind} ${smallWorkSpots({ plots, blocked }, d.width, d.depth).length}`;
    }).join(', ');
  } catch (e) {
    return `(failed: ${(e as Error).message})`;
  }
}
say(`room for small works (spots): ${room()}`);
say('\n== Part 1: menus');
const menuStats = { initiate: 0, help: 0, none: 0, picks: [] as string[], reasons: new Map<string, number>() };
mute();
const menus: Array<{ name: string; menu: Any; pick: Any }> = [];
for (const a of agents) {
  let menu: Any = null;
  try {
    menu = w.choices(a);
  } catch (e) {
    errors.push(`choices(${a.name}) threw: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`);
  }
  menus.push({ name: a.name, menu, pick: menu ? fixedPick(menu) : undefined });
}
unmute();
for (const { name, menu, pick } of menus) {
  if (!menu) {
    say(`  ${name.padEnd(8)} no menu (not an idle member)`);
    menuStats.none++;
    continue;
  }
  const opts = [...(menu.options ?? [])].sort((p: Any, q: Any) => p.rank - q.rank);
  const kinds = countKinds(opts.map((o: Any) => o.kind));
  const hasI = opts.some((o: Any) => o.kind === 'initiate'), hasH = opts.some((o: Any) => o.kind === 'help');
  if (hasI) menuStats.initiate++;
  if (hasH) menuStats.help++;
  if (pick) menuStats.picks.push(pick.kind);
  const reasons = Object.entries(menu.reasons ?? {}).map(([k, why]) => `${k}: ${why}`);
  for (const r of reasons) menuStats.reasons.set(r, (menuStats.reasons.get(r) ?? 0) + 1);
  say(`  ${name.padEnd(8)} [${kinds || 'empty'}] I${hasI ? '+' : '-'} H${hasH ? '+' : '-'} pick ${pick ? `${pick.kind} ${pick.id}${pick.tw !== undefined ? ` (tw ${pick.tw})` : ''}` : 'none'}${VERBOSE ? `; absent: ${reasons.join('; ')}` : `; initiate/help: ${menu.reasons?.initiate ?? (hasI ? 'offered' : '-')} / ${menu.reasons?.help ?? (hasH ? 'offered' : '-')}`}`);
  if (VERBOSE) for (const o of opts.filter((o: Any) => o.kind === 'initiate' || o.kind === 'help')) say(`      ${o.id} rank ${o.rank} tw ${o.tw ?? '-'}: ${o.name} | ${o.facts}`);
}
say(`menus: ${menus.length - menuStats.none} members with a menu; with initiate ${menuStats.initiate}, with help ${menuStats.help}; fixed picks by kind: ${countKinds(menuStats.picks) || 'none'}`);
say(`absent kinds' reasons: ${[...menuStats.reasons.entries()].sort((p, q) => q[1] - p[1]).map(([r, n]) => `${r} (${n})`).join('; ') || 'none'}`);
const sample = menus.find((m) => m.menu?.options?.some((o: Any) => o.kind === 'initiate'));
if (sample) for (const o of sample.menu.options.filter((o: Any) => o.kind === 'initiate').slice(0, 2)) say(`  e.g. ${sample.name}: ${o.id} "${o.name}" | ${o.facts} | ${o.effect}`);

// ---- part 2: the sweeps --------------------------------------------------------------------------------------------------

/** The message a done action leaves; a deposit's names what its collect brought (depositedOf reads "deposited N item"). */
const lastCollect = new Map<string, { block: string; count: number }>();
function finish(s: Any) {
  if (s.type === 'collect') {
    const block = String(s.args?.block ?? 'logs');
    const count = Number(s.args?.count ?? 1);
    lastCollect.set(s.agent, { block, count });
    return `collected ${count} ${block}`;
  }
  if (s.type === 'deposit') {
    const c = lastCollect.get(s.agent);
    lastCollect.delete(s.agent);
    const item = String(s.args?.item ?? '');
    const name = c && /_log$/.test(c.block) ? c.block : item === 'logs' ? `${v.wood ?? v.catalogWood ?? 'oak'}_log` : item || 'cobblestone';
    const n = c?.count ?? 8;
    if (CREDIT && chest0) {
      chest0.items[name] = (chest0.items[name] ?? 0) + n;
      credited[name] = (credited[name] ?? 0) + n;
    }
    return `deposited ${n} ${name} (storage now holds more)`;
  }
  if (s.type === 'build_design' && STAND) {
    const d = v.designs?.[String(s.args?.design)];
    const x = Number(s.args?.x), z = Number(s.args?.z);
    if (d && Number.isFinite(x) && Number.isFinite(z)) {
      const x1 = x - Math.floor(d.width / 2), z1 = z - Math.floor(d.depth / 2);
      v.structures.push({ id: `probe${nextId++}`, kind: d.name, x1, z1, x2: x1 + d.width - 1, z2: z1 + d.depth - 1, y: home.y, builtBy: s.agent });
      stood++;
    }
  }
  // (a green, s36: recorded east of everything the village holds, as prepare_green would record its plot)
  if (s.type === 'prepare_green' && STAND) {
    const S = Number(s.args?.size ?? 15);
    const east = Math.max(...v.plots.map((p: Any) => p.x2), ...(v.layouts ?? []).map((l: Any) => l.x2), ...v.plots.filter((p: Any) => p.green).map((p: Any) => p.x2)) + 8;
    v.plots.push({ id: `probe${nextId++}`, x1: east, z1: home.z - Math.floor(S / 2), x2: east + S - 1, z2: home.z - Math.floor(S / 2) + S - 1, y: home.y, preparedBy: s.agent, green: String(s.args?.initiative) });
    greens++;
  }
  return `${s.type} done`;
}
let stood = 0, greens = 0;
const credited: Record<string, number> = {};
const errsAt = () => errors.length;
const actionTypes: string[] = [];

say(`\n== Part 2: ${SWEEPS} sweeps (31 s apart; every queued action done between them${CREDIT ? ", deposits credited to the first chest" : ''})`);
for (let k = 1; k <= SWEEPS; k++) {
  sweepNo = k;
  const e0 = errsAt(), l0 = lines.length, p0 = picks.length, s0 = statuses.length;
  w.farmCheckAt = 0;
  mute();
  try {
    w.farmChores();
  } catch (e) {
    errors.push(`farmChores threw: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`);
  }
  for (let j = 0; j < 5; j++) await new Promise((r) => setImmediate(r));
  unmute();
  const ps = picks.slice(p0);
  for (const s of statuses.slice(s0)) actionTypes.push(s.type);
  say(`S${k} (+${Math.round((clock - T0) / 1000)} s): ${ps.length} picks (${countKinds(ps.map((p) => p.kind)) || 'none'})${ps.some((p) => !p.ok) ? `, ${ps.filter((p) => !p.ok).length} refused` : ''}; ${statuses.length - s0} actions queued`);
  for (const p of ps.filter((p) => p.kind === 'initiate' || p.kind === 'help')) say(`    ${p.agent} ${p.id}${p.ok ? '' : ' (refused)'}`);
  for (const it of v.initiatives ?? []) say(`    ${it.id} by ${it.by} ${it.kind} ${it.state} crew ${it.crew.length} [${it.crew.join(',')}] steps ${it.steps.length}${it.steps.length ? ` (last: ${it.steps[it.steps.length - 1].agent} ${it.steps[it.steps.length - 1].what})` : ''}${it.backoff && it.backoff > clock ? ' backing off' : ''}${it.fails ? ` fails ${it.fails}` : ''}`);
  // The members still idle after the sweep: what their menus say of initiate and help now (choices() is pure)
  mute();
  const after = agents.map((a) => {
    try {
      return w.choices(a);
    } catch {
      return null;
    }
  }).filter(Boolean);
  unmute();
  if (after.length) {
    const tally = (k: string) => countKinds(after.map((m: Any) => (m.options.some((o: Any) => o.kind === k) ? 'offered' : m.reasons?.[k] ?? 'absent')));
    say(`    left idle ${after.length}: initiate [${tally('initiate')}], help [${tally('help')}]`);
  }
  if (VERBOSE) say(`    room: ${room()}`);
  if (VERBOSE) for (const l of lines.slice(l0)) say(`    | ${l}`);
  else for (const l of lines.slice(l0).filter((l) => /could not|failed|lapsed|built|choice-none/.test(l))) say(`    | ${l}`);
  for (const e of errors.slice(e0)) say(`    ERROR ${e.split('\n')[0]}`);
  // Every queued action done; the chores ended; 31 s on
  for (const s of statuses) if (s.state === 'queued' || s.state === 'running') Object.assign(s, { state: 'done', message: finish(s) });
  mute();
  try {
    w.endChoices();
  } catch (e) {
    errors.push(`endChoices threw: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`);
  }
  unmute();
  clock += 31000;
}

// ---- summary ------------------------------------------------------------------------------------------------------------

const its = (v.initiatives ?? []) as Any[];
const started = its.length;
const joins = its.filter((i) => i.crew.length > 1).length;
const steps = its.reduce((s, i) => s + i.steps.length, 0);
const builds = its.reduce((s, i) => s + i.steps.filter((q: Any) => q.what === 'build').length, 0);
const byState = countKinds(its.map((i) => i.state));
// (N.1: the menus once the sweeps have read the needs: options carrying a need, and the village's view)
let needOpts = 0;
let needView: Any = null;
if (process.env.MC_NEEDS && process.env.MC_NEEDS !== 'off') {
  mute();
  for (const a of agents) {
    try {
      needOpts += (w.choices(a)?.options ?? []).filter((o: Any) => o.need).length;
    } catch {
      // (a busy member has no menu)
    }
  }
  unmute();
  needView = w.needsView?.(v.name) ?? null;
}
say('\n== Summary');
say(`room for small works now (spots): ${room()}`);
say(`picks over ${SWEEPS} sweeps: ${picks.length} (${countKinds(picks.map((p) => p.kind)) || 'none'}); initiate ${picks.filter((p) => p.kind === 'initiate').length}, help ${picks.filter((p) => p.kind === 'help').length}`);
say(`actions queued: ${countKinds(actionTypes) || 'none'}`);
say(`initiatives: ${started} started, ${joins} joined (crew > 1, crew sizes ${its.map((i) => i.crew.length).join('/') || '-'}), ${steps} steps (${builds} build), states: ${byState || 'none'}`);
if (STAND) say(`structures recorded for done builds (--stand): ${stood}; greens recorded: ${greens}`);
if (Object.keys(credited).length) say(`credited to storage: ${Object.entries(credited).map(([n, q]) => `${q} ${n}`).join(', ')}`);
say(`notes: ${notes.length}; saves ${saves}; rcon ${rconCmds.length}`);
const initLines = lines.filter((l) => l.startsWith('[initiative]'));
const couldNot = initLines.filter((l) => /could not/.test(l));
if (couldNot.length) say(`initiative refusals: ${couldNot.length} (first: ${couldNot[0]})`);
// (N.1: the [need] lines, with MC_NEEDS show or on, and the menus' need-weighted options)
const needLines = lines.filter((l) => l.startsWith('[need]'));
if (process.env.MC_NEEDS && process.env.MC_NEEDS !== 'off') {
  say(`needs (MC_NEEDS=${process.env.MC_NEEDS}): ${needLines.length} [need] lines; ${needOpts} option(s) with a need on the menus after the sweeps`);
  for (const l of needLines.slice(0, 12)) say(`  ${l}`);
  for (const [k, n] of Object.entries(needView?.needs ?? {}) as Array<[string, Any]>) say(`  ${k.padEnd(8)} level ${n.level.toFixed(2)} ${n.status}${n.why ? ` (${n.why})` : ''}: ${n.text}`);
}
if (errors.length) {
  say(`console.error lines: ${errors.length}`);
  for (const e of [...new Set(errors.map((e) => e.split('\n').slice(0, 2).join(' | ')))].slice(0, 5)) say(`  ${e.slice(0, 300)}`);
} else say('console.error lines: 0');

fs.rmSync(SCRATCH, { recursive: true, force: true });
const why: string[] = [];
if (!menuStats.initiate) why.push('no member was offered initiate');
if (!started) why.push('no initiative was started over the sweeps');
say(why.length ? `WARN menu_probe: ${why.join('; ')}` : `PASS menu_probe (${menuStats.initiate} offered initiate, ${started} started, ${joins} joined, ${steps} steps)`);
process.exit(0);
