/**
 * The village simulator v0 (#74; spec runs/2026-10-20/s41/spec_sim_v1.md as its check check_sim_v1.md left it): the real
 * decision code (menus, the fixed chooser, keeps and targets, initiatives, the appetite, the merchant, the library's
 * activities) runs unchanged in a real MineflayerWorld on a checkpoint's record, against a modelled world (skills.mts: the
 * skills' effects and messages, crops, eggs) on a virtual clock. menu_probe.mts's harness plus: Date.now replaced before the
 * world's modules load; the world's own tick() every STEP seconds (the 30 s sweep, the 5 s appetite, endChoices) and
 * endChoices after every action's end; fakes whose `current` and `queue` follow the modelled actions; RCON answered as Paper
 * would (the merchant's checks). Durations are drawn from a reference run's choice log (per-step times when it has them,
 * else single-skill chores' minutes), at the reference's time scale.
 * Off in v0: growth and housing, public works, needs works, the mine and iron, explore, farm starts and pens (their skills
 * are done with no effect and counted). Houses are the main long-term sink a day-scale run misses.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/sim/village_sim.mts [--series SPEC.json --run NAME] [--checkpoint DIR]
 *   [--minutes N] [--scale S] [--random-tick R] [--env K=V,...] [--stock item:N,...] [--calib REF.choices.jsonl]
 *   [--step SEC] [--seed N] [--out DIR] [--log]
 * Writes OUT/sim.choices.jsonl (the choice log, as a real run's) and OUT/sim.report.json; prints the report.
 * Compare with a real run: scripts/sim/sim_report.mts REF.choices.jsonl OUT/sim.choices.jsonl.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workerName } from '../../server/src/agentNames';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Counts = Record<string, number>;

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
const SERIES = opt('--series'), RUN = opt('--run');
let checkpoint = opt('--checkpoint');
let minutes = Number(opt('--minutes') ?? NaN);
let scale = Number(opt('--scale') ?? NaN);
let randomTick = Number(opt('--random-tick') ?? NaN);
const envArg = opt('--env') ?? '';
let stockArg = opt('--stock') ?? '';
const CALIB = opt('--calib');
const STEP = Number(opt('--step') ?? 5) * 1000;
const SEED = Number(opt('--seed') ?? 1);
const OUT = opt('--out') ?? fs.mkdtempSync(path.join(os.tmpdir(), 'village-sim-'));
const LOG = flag('--log');
/** The merchant's buy rule before 0a377e6 (F259): every sold item counts as used (the first experiment's "off" arm). */
const BUY_ALL = flag('--buy-all');
/** Offers the merchant also buys, "item:n[:stock]" (an experiment: what the village grows and nothing uses). */
const EXTRA_BUYS = (opt('--merchant-buys') ?? '').split(',').filter(Boolean);
let workers = 24;
const env: Record<string, string> = {};
if (SERIES) {
  // A run_series spec's run: its checkpoint, server settings, after minutes, stock and the fast defaults (run_series.py)
  const spec = JSON.parse(fs.readFileSync(SERIES, 'utf8'));
  const run = (spec.runs ?? []).find((r: Any) => !RUN || r.name === RUN) ?? spec.runs?.[0];
  if (!run) throw new Error(`no run ${RUN} in ${SERIES}`);
  workers = run.workers ?? spec.workers ?? 24;
  const fast = run.fast ?? spec.fast ?? true;
  Object.assign(env, fast ? { MC_HASTE: '5', MC_RANDOM_TICK: '30' } : {}, spec.server_env ?? {}, run.server_env ?? {});
  const ts = run.time_scale ?? spec.time_scale ?? (fast ? (workers < 12 ? 3 : 2) : 2);
  env.MC_TIME_SCALE ??= String(ts);
  checkpoint ??= run.checkpoint ? path.join('mc/testcheckpoints', run.checkpoint) : undefined;
  const args = String(run.args ?? '');
  const after = /--after (\d+(?:\.\d+)?)/.exec(args);
  if (after && !Number.isFinite(minutes)) minutes = Number(after[1]);
  const stock = /--stock (\S+)/.exec(args);
  if (stock && !stockArg) stockArg = stock[1];
}
for (const kv of envArg.split(',').filter(Boolean)) {
  const [k, ...rest] = kv.split('=');
  env[k] = rest.join('=');
}
if (Number.isFinite(scale)) env.MC_TIME_SCALE = String(scale);
if (Number.isFinite(randomTick)) env.MC_RANDOM_TICK = String(randomTick);
scale = Number(env.MC_TIME_SCALE ?? 1);
randomTick = Number(env.MC_RANDOM_TICK ?? 3);
if (!Number.isFinite(minutes)) minutes = 30;
checkpoint ??= 'mc/testcheckpoints/mv3_grown25';

// (read when the world's modules load: set first; v0's switches over the run's own)
fs.mkdirSync(OUT, { recursive: true });
const CHOICE_LOG = path.resolve(OUT, 'sim.choices.jsonl');
fs.rmSync(CHOICE_LOG, { force: true });
// (s42: the run's own growth, public works, housing, needs works and votes (predicted: code) unless --v0, which switches
// them off as v0 first ran; the members' brains take board tasks as a staged run's scripted workers do)
const V0 = flag('--v0');
Object.assign(process.env, env, { MC_CHOOSE: 'fixed', MC_MODEL_RECORD: '0', MCAI_CHOICE_LOG: CHOICE_LOG },
  V0 ? { MC_VOTE: 'off', MC_GROW: '0', MC_PROJECTS: 'off', MC_HOUSING: 'off', MC_NEED_WORKS: 'off' } : { MC_VOTE: process.env.MC_VOTE === 'model' ? 'predicted' : (process.env.MC_VOTE ?? 'predicted') });
process.env.MCAI_TEMPERAMENT ??= 'on';

const villagesFile = path.join(checkpoint, 'villages.json');
const atlasFile = path.join(checkpoint, 'atlas.json');
/** The checkpoint's land (scripts/sim/land.py): where layouts and greens fit; without it they are placed by geometry. */
const landFile = path.join(checkpoint, 'land.json');
const land = fs.existsSync(landFile) ? JSON.parse(fs.readFileSync(landFile, 'utf8')) : undefined;
const cpFile = path.join(checkpoint, 'checkpoint.json');
if (!fs.existsSync(villagesFile)) {
  console.log(`no ${villagesFile}`);
  process.exit(2);
}

// The clock: a day after the checkpoint (a resumed run's records are old), as fixed numbers for a reproducible run
const cpTime = fs.existsSync(cpFile) ? Date.parse(String(JSON.parse(fs.readFileSync(cpFile, 'utf8')).time ?? '').replace(' ', 'T')) : NaN;
let clock = (Number.isFinite(cpTime) ? cpTime : fs.statSync(villagesFile).mtimeMs) + 24 * 3600000;
clock = Math.floor(clock / 1000) * 1000;
const T0 = clock;
const realNow = Date.now.bind(Date);
Date.now = () => clock;

// ---- console capture ----------------------------------------------------------------------------------------------------

const orig = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const say = (s: string) => orig.log(s);
const logLines: string[] = [];
const keep: Array<{ t: number; s: string }> = [];
const errors: string[] = [];
const stamp = () => `+${((clock - T0) / 60000).toFixed(2)}m`;
console.log = (...a: unknown[]) => {
  const s = a.map(String).join(' ');
  if (LOG) logLines.push(`${stamp()} ${s.slice(0, 400)}`);
  if (/^\[(choice-none|merchant|initiative|food|activity|needwork|light|work|grow|vote|own)\]/.test(s)) keep.push({ t: clock, s: s.slice(0, 2000) });
};
console.warn = () => {};
console.info = () => {};
console.error = (...a: unknown[]) => {
  const s = a.map((x) => (x instanceof Error ? x.stack ?? x.message : String(x))).join(' ');
  if (/^\[vanilla\] block lists from/.test(s)) return;
  errors.push(`${stamp()} ${s.slice(0, 400)}`);
};

const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const { Vec3 } = await import('vec3');
const S = await import('./skills.mts');
const { TaskBrain } = await import('../../server/src/taskBrain');
const { CHOOSE } = (await import(new URL('../../server/src/choose.ts', import.meta.url).href)) as Any;
const { storageContents, noteFlow } = await import('../../server/src/mineflayer/mcStorage');
const { designBill } = await import('../../server/src/mineflayer/mcMaterials');

// ---- the world ---------------------------------------------------------------------------------------------------------

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'village-sim-w-'));
fs.copyFileSync(villagesFile, path.join(SCRATCH, 'villages.json'));
if (fs.existsSync(atlasFile)) fs.copyFileSync(atlasFile, path.join(SCRATCH, 'atlas.json'));
const data = JSON.parse(fs.readFileSync(villagesFile, 'utf8')) as { villages: Any[] };
const base = data.villages.find((x) => x.complete) ?? data.villages[0];

// RCON as Paper answers it (the merchant's checks, the signpost's text); everything else empty
let merchantUp = false;
const rconCounts = new Map<string, number>();
const rcon = {
  command: async (c: string) => {
    const head = c.split(' ').slice(0, 2).join(' ');
    rconCounts.set(head, (rconCounts.get(head) ?? 0) + 1);
    if (/^execute if loaded/.test(c)) return 'Test passed.';
    if (/^execute if entity/.test(c)) return merchantUp ? 'Test passed, count: 1' : 'Test failed';
    if (/^summon /.test(c)) {
      merchantUp = true;
      return 'Summoned new Villager';
    }
    if (/^data merge block/.test(c)) return 'Modified block data of 1 block';
    return '';
  },
};
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', rcon as never, SCRATCH) as Any;
const reg = w.villages as Any;
// (a checkpoint's villages.json carries no nextId: the test world's file does, and reset_site merges into it. From 1, new
// tasks took the record's old ids, and a gather's "after the prepare" named a task long done)
{
  let max = 0;
  for (const m of fs.readFileSync(villagesFile, 'utf8').matchAll(/"id": "[a-z]+(\d+)"/g)) max = Math.max(max, Number(m[1]));
  if ((reg.nextId ?? 0) <= max) reg.nextId = max + 1;
}
let saves = 0;
reg.save = () => {
  saves++;
};
if (w.atlas) w.atlas.save = () => {};
if (EXTRA_BUYS.length) {
  const { OFFERS } = await import('../../server/src/merchant');
  for (const o of EXTRA_BUYS) {
    const [item, n, stock] = o.split(':');
    OFFERS.push({ item, n: Number(n), emeralds: 1, stock: Number(stock ?? 8), dir: 'buys' });
  }
}
if (BUY_ALL) {
  const { SOLD } = await import('../../server/src/merchant');
  w.merchantUses = () => new Set(SOLD);
}
const v = reg.get(base.name);
if (!v) {
  say(`village ${base.name} not loaded`);
  process.exit(2);
}
// The run's stock (stage_village.py --stock: deposited into storage once the after phase starts)
for (const kv of stockArg.split(',').filter(Boolean)) {
  const [item, q] = kv.split(':');
  S.put(v, item, Number(q));
}
const store0 = storageContents(v);
/** The last task number of the record (the sim's own tasks come after it). */
const T0_TASK = Math.max(0, ...v.tasks.map((t: Any) => Number(/\d+/.exec(t.id)?.[0] ?? 0)));

// ---- the modelled world: crops, eggs, the members ----------------------------------------------------------------------

const rng = S.rngOf(SEED);
/** A crop's growth chance per random tick (SIM_CROP_G, 0.25: Stg2's 13 wheat harvests in 30 min; 1/6 gave 9). */
const CROP_G = Number(process.env.SIM_CROP_G ?? 0.25);
const crops = new S.CropStore(w.registry, S.rngOf(SEED + 1), (randomTick * 20 * scale) / 4096, CROP_G);
crops.seed(v);
const entities: Record<string, Any> = {};
const eggs = new S.Eggs(entities, S.rngOf(SEED + 2), scale);
const column = (cx: number, cz: number) => ({
  minY: -64,
  sections: { length: 24 },
  getBlockStateId: (p: { x: number; y: number; z: number }) => crops.get(cx * 16 + p.x, p.y, cz * 16 + p.z),
});
const chest0 = v.storage?.chests?.[0];
const plot0 = v.plots.find((p: Any) => !p.annex);
const home = chest0 ? { x: chest0.x, y: chest0.y, z: chest0.z } : { x: Math.floor((plot0.x1 + plot0.x2) / 2), y: plot0.y + 1, z: Math.floor((plot0.z1 + plot0.z2) / 2) };

let nextId = 1;
/** The board's state when it was last refreshed before a brain (SimAgent.tick). */
let boardSig = -1;
const unknown = new Map<string, number>();
let fromRef = 0;
const boardRun = new Map<string, number>();
const actionsRun = new Map<string, number>();
const carries = new Map<string, Counts>();
class SimAgent {
  queue: Any[] = [];
  current: { status: Any; endAt: number } | null = null;
  history: Any[] = [];
  events: Any[] = [];
  brain: Any = null;
  role: string;
  memory: Record<string, unknown>;
  bot: Any;
  world = w;
  /** Its last action left it out at the village's edge (AWAY): the next one's minutes are drawn from such samples. */
  away = false;
  constructor(readonly name: string) {
    this.role = name === 'Mayor' ? 'mayor' : 'worker';
    this.memory = { village: v.name, villageRole: this.role };
    this.bot = {
      entity: { position: new Vec3(home.x + 0.5, home.y, home.z + 0.5) },
      entities,
      // (what the member carries, as items: the board's gathering counts it, and the chores' yields)
      inventory: { items: () => Object.entries(carries.get(name) ?? {}).filter(([, q]) => q > 0).map(([n, q]) => ({ name: n, count: q })) },
      world: { getColumn: column },
      game: { minY: -64 },
    };
  }
  village() {
    return reg.get(this.memory.village);
  }
  idle() {
    return !this.current && this.queue.length === 0;
  }
  enqueue(type: string, args: Record<string, unknown>) {
    const s = { id: nextId++, type, args, state: 'queued' };
    this.queue.push(s);
    return s;
  }
  tick() {
    // (the board refreshed before each brain looks: real 50 ms ticks interleave the board's refresh with the brains', so a
    // gather a finished prepare's felled logs cover is closed before anyone claims it; at 5 s every brain looked first)
    if (this.brain) {
      // (only when a task changed state since the last: refreshBoard reads the whole board)
      let sig = v.tasks.length;
      for (const t of v.tasks) if (t.status !== 'open') sig += t.status === 'done' ? 1e6 : 1e3;
      if (sig !== boardSig) {
        boardSig = sig;
        reg.refreshBoard(v);
      }
    }
    this.brain?.tick?.(this);
  }
  pushEvent(type: string, text: string, data?: Any) {
    try {
      this.brain?.onEvent?.(this, { type, text, data, t: clock });
    } catch (e) {
      errors.push(`${stamp()} ${this.name}'s brain threw on ${type}: ${(e as Error).message}`);
    }
  }
  observe() {
    return { inventory: { ...carries.get(this.name) } };
  }
  stop() {
    for (const q of [...(this.current ? [this.current.status] : []), ...this.queue]) Object.assign(q, { state: 'failed', message: 'cancelled', endedAt: clock });
    this.current = null;
    this.queue = [];
  }
  quit() {}
}
const NAMES = ['Mayor', ...Array.from({ length: workers }, (_, i) => workerName(i + 1))];
const agents = NAMES.map((n) => new SimAgent(n));
for (const a of agents) {
  w.agents.set(a.name.toLowerCase(), a);
  carries.set(a.name, {});
  if (!V0) a.brain = new TaskBrain();
}

// ---- durations: a reference run's chores ---------------------------------------------------------------------------------

/** Minutes by skill key ("make:charcoal", "collect", "eat_meal"...), from the reference's choice log. */
const samples = new Map<string, Array<{ m: number; ok: boolean; message: string; n?: number; away?: boolean }>>();
/** Whether the member's last action left it out at the village's edge (a build, a site, a house it lit or furnished) or by
 *  storage and the works (s43: Lng1's late eats and harvests took half Stg2's mean: idle members stood by storage). */
const AWAY = new Set(['build_design', 'prepare_site', 'prepare_green', 'put_up_torches', 'furnish', 'light_streets', 'put_up_signs', 'collect', 'explore']);
let refAway = false;
const addSample = (k: string, m: number, ok = true, message = '', n?: number) => {
  if (!(m > 0)) return;
  if (!samples.has(k)) samples.set(k, []);
  samples.get(k)!.push({ m, ok, message, ...(n ? { n } : {}), away: refAway });
};
/** A make's batch ("make 4 charcoal") and a fishing trip's catch ("caught 1 fish ... and 0 other", "deposited 2 salmon,
 *  4 cod. Storage..."): the sizes a duration grows with (s43: Lng1's late top-ups of 1-2 took half the reference's mean). */
const batchOf = (what: string) => Number(/^make (\d+) /.exec(what)?.[1]) || undefined;
function catchOf(msg: string): number | undefined {
  const c = /caught (\d+) fish .* and (\d+) other/.exec(msg);
  if (c) return Number(c[1]) + Number(c[2]) || undefined;
  const d = /^deposited (.*?)\. Storage/.exec(msg);
  return d ? [...d[1].matchAll(/(\d+) [a-z_]+/g)].reduce((t, q) => t + Number(q[1]), 0) || undefined : undefined;
}
/** What a reference green's clearing kept, by item (prepare_green's "kept 7 birch_log, 47 oak_log from the felled"). */
const greenKept: Counts[] = [];
/** Builds' minutes against blocks placed: a fixed part (the walk, the site) and a part a block, fitted below. */
const buildPairs: Array<[number, number]> = [];
function buildRate(msg: string, m: number) {
  const n = /recorded in village [^;]*; placed (\d+) blocks/.exec(msg)?.[1];
  if (n && Number(n) > 0) buildPairs.push([Number(n), m]);
}
let buildFit: { a: number; b: number; resid: number[] } | null = null;
/** Gathering trips' loads as asked and as deposited, by material (whole trees: "gather 4 logs" deposits 5-19). */
const tripLoads: Record<string, Array<{ asked: number; got: number }>> = {};
function tripOf(what: string, msg: string) {
  const g = /^gather (\d+) (logs|cobblestone|sand)/.exec(what);
  if (!g || !/^deposited/.test(msg)) return;
  const dep = /^deposited ([^.;]*)/.exec(msg)?.[1] ?? '';
  let got = 0;
  for (const [, q, n] of dep.matchAll(/(\d+) ([a-z_]+)/g)) if (g[2] === 'logs' ? /_log$/.test(n) : n === g[2]) got += Number(q);
  if (got > 0) (tripLoads[g[2]] ??= []).push({ asked: Number(g[1]), got });
}
const SINGLE: Record<string, string> = { eat: 'eat_meal', slot: 'harvest_slot', farm: 'harvest_farm', light: 'put_up_torches', furnish: 'furnish' };
let calibFrom = 'built-in medians';
function keptOf(msg: string) {
  // (the log cuts messages at 200 characters: the counts after "kept", whatever follows them)
  const k = /kept ((?:\d+ [a-z_]+(?:, |$| ))+)/.exec(msg)?.[1];
  if (!/^plot ready/.test(msg)) return;
  const c: Counts = {};
  for (const [, q, n] of (k ?? '').matchAll(/(\d+) ([a-z_]+)/g)) c[n] = (c[n] ?? 0) + Number(q);
  if (Object.keys(c).length) greenKept.push(c);
}
if (CALIB && fs.existsSync(CALIB)) {
  const rows = fs.readFileSync(CALIB, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const starts = new Map(rows.filter((r) => r.type === 'choice').map((r) => [r.id, r]));
  let perStep = 0;
  const lastAway = new Map<string, boolean>();
  const ends = rows.filter((r) => r.type === 'choice-end' && starts.has(r.id)).sort((p, q) => starts.get(p.id)!.t - starts.get(q.id)!.t);
  for (const e of ends) {
    const s = starts.get(e.id)!;
    refAway = lastAway.get(s.agent) ?? false;
    // (where this chore leaves the member: its last step, else its kind; a build's end message)
    const steps = Array.isArray(e.steps) ? e.steps : [];
    const before = refAway;
    lastAway.set(s.agent, steps.length ? AWAY.has(steps[steps.length - 1].type) : ['light', 'furnish'].includes(s.kind) || /recorded in village|already stands/.test(String(e.message ?? '')));
    if (e.cut) continue;
    if (steps.some((q: Any) => q.ms)) {
      perStep++;
      if (e.steps.length === 1 && e.steps[0].type === 'build_design' && e.steps[0].ms) buildRate(String(e.message ?? ''), e.steps[0].ms / 60000);
      // (each step from where the step before it left the member, as the sim's members draw theirs)
      refAway = before;
      for (const q of e.steps) {
        if (q.ms) addSample(q.type === 'make' ? `make:${String(s.key).replace(/^make:/, '')}` : q.type, q.ms / 60000, q.state === 'done', q.state === 'done' ? '' : String(e.message ?? ''),
          q.type === 'make' ? batchOf(String(s.what ?? '')) : q.type === 'fish' ? catchOf(String(e.message ?? '')) : undefined);
        refAway = AWAY.has(q.type);
      }
      keptOf(String(e.message ?? ''));
      tripOf(String(s.what ?? ''), String(e.message ?? ''));
      continue;
    }
    const m = e.minutes, msg = String(e.message ?? '');
    keptOf(msg);
    tripOf(String(s.what ?? ''), msg);
    if (s.kind === 'make') addSample(`make:${String(s.key).replace(/^make:/, '')}`, m, !!e.ok, e.ok ? '' : msg, batchOf(String(s.what ?? '')));
    else if (SINGLE[s.kind]) addSample(SINGLE[s.kind], m, !!e.ok, e.ok ? '' : msg);
    else if (/^plot ready/.test(msg)) addSample('prepare_green', m);
    else if (s.kind === 'penwork') addSample(/egg/.test(msg) ? 'collect_eggs' : /milk/.test(msg) ? 'milk_cows' : 'breed_pen', m);
    else if (/recorded in village|already stands/.test(msg)) {
      addSample('build_design', m);
      buildRate(msg, m);
    }
    else if (s.kind === 'activity' && /emerald|traded/.test(msg)) addSample('trade', Math.max(0.03, m - 0.15));
    else if (s.kind === 'activity') addSample('fish', Math.max(0.1, m - 0.25), true, '', catchOf(msg));
    else if (/^deposited/.test(msg) && ['gather', 'help', 'initiate'].includes(s.kind)) addSample('collect', Math.max(0.05, m - 0.1));
  }
  calibFrom = `${path.basename(CALIB)} (${rows.length} rows, ${perStep} chores with per-step times)`;
  // Eggs laid as the reference collected them, a hen a second (the hens: the checkpoint's chicken pens)
  {
    let laid = 0;
    for (const e of rows) if (e.type === 'choice-end') laid += Number(/^collected (\d+) egg/.exec(String(e.message ?? ''))?.[1] ?? 0);
    const ts = rows.filter((r) => r.type === 'choice').map((r) => r.t);
    const secs = ts.length ? (Math.max(...ts) - Math.min(...ts)) / 1000 : 0;
    const hens = eggs.pens(v).reduce((t, q) => t + (q.slot.pen.animals ?? 0), 0);
    if (laid && secs > 600 && hens) {
      eggs.perHen = laid / (hens * secs);
      calibFrom += `; eggs ${(eggs.perHen * 60).toFixed(3)} a hen a minute`;
    }
  }
  // The board's builds (big public works) are not in the choice log: the stage log beside it times them, each from its
  // builder's previous action end (an upper bound): "AFTER 4.7m Dev action_done | build_design finished: ... placed 222 blocks"
  const stage = CALIB.replace(/\.choices\.jsonl$/, '.log');
  if (stage !== CALIB && fs.existsSync(stage)) {
    const last = new Map<string, number>();
    let n = 0;
    for (const line of fs.readFileSync(stage, 'utf8').split('\n')) {
      const m = /^AFTER +([\d.]+)m (\w+) +action_(?:done|failed)/.exec(line);
      if (!m) continue;
      const t = Number(m[1]);
      const b = /build_design finished: \w+ recorded in village [^;]*; placed (\d+) blocks/.exec(line);
      if (b && Number(b[1]) > 100 && last.has(m[2])) {
        buildPairs.push([Number(b[1]), t - last.get(m[2])!]);
        n++;
      }
      last.set(m[2], t);
    }
    calibFrom += `; ${n} big builds from ${path.basename(stage)}`;
  }
}
// (least squares; the residuals are drawn back, so builds keep their spread)
if (buildPairs.length >= 5) {
  const n = buildPairs.length, mx = buildPairs.reduce((t, [x]) => t + x, 0) / n, my = buildPairs.reduce((t, [, y]) => t + y, 0) / n;
  const sxx = buildPairs.reduce((t, [x]) => t + (x - mx) ** 2, 0), sxy = buildPairs.reduce((t, [x, y]) => t + (x - mx) * (y - my), 0);
  const b = sxx > 0 ? Math.max(0, sxy / sxx) : 0, a = Math.max(0.05, my - b * mx);
  buildFit = { a, b, resid: buildPairs.map(([x, y]) => y - (a + b * x)) };
  calibFrom += `; builds ${a.toFixed(2)} + ${(b * 100).toFixed(2)}/100 blocks min (${n} builds)`;
}
const BUILTIN: Record<string, number> = {
  deposit: 0.08, withdraw: 0.05, collect: 0.55, eat_meal: 0.04, harvest_slot: 0.06, harvest_farm: 0.09, put_up_torches: 0.12, furnish: 0.22,
  place_own_chest: 0.5, carry_home: 0.45, eat_own: 0.25,
  collect_eggs: 0.13, milk_cows: 0.13, breed_pen: 0.13, build_design: 0.5, prepare_green: 1.5, fish: 1.8, trade: 0.1, make: 0.12, tidy_storage: 0.12,
};
/** A drawn sample for an action: its minutes, and a reference failure it is to repeat (the skills whose failures come
 *  from physics the models leave out: a make's craft that found an input missing, a harvest that met another worker). */
const FAILS_FROM_REFERENCE = new Set(['make', 'harvest_slot', 'harvest_farm', 'put_up_torches', 'furnish']);
const sizeFits = new Map<string, { a: number; b: number; resid: number[] } | null>();
function sizeFit(key: string): { a: number; b: number; resid: number[] } | null {
  if (sizeFits.has(key)) return sizeFits.get(key)!;
  const xs = (samples.get(key) ?? []).filter((x) => x.ok && x.n);
  let out: { a: number; b: number; resid: number[] } | null = null;
  if (new Set(xs.map((x) => x.n)).size >= 2) {
    const n = xs.length, mx = xs.reduce((t, x) => t + x.n!, 0) / n, my = xs.reduce((t, x) => t + x.m, 0) / n;
    const sxx = xs.reduce((t, x) => t + (x.n! - mx) ** 2, 0), sxy = xs.reduce((t, x) => t + (x.n! - mx) * (x.m - my), 0);
    const b = Math.max(0, sxy / sxx), a = Math.max(0.02, my - b * mx);
    out = { a, b, resid: xs.map((x) => x.m - (a + b * x.n!)) };
  }
  sizeFits.set(key, out);
  return out;
}
function sampleFor(s: Any, away = false): { m: number; fail?: string } {
  // (a build by its blocks: the design's bill at a reference rate per block)
  const d = s.type === 'build_design' && buildFit ? v.designs?.[String(s.args?.design)] : undefined;
  if (d && buildFit) {
    const blocks = Object.values(designBill(d) as Counts).reduce((t, q) => t + q, 0);
    return { m: Math.max(0.05, buildFit.a + buildFit.b * blocks + buildFit.resid[Math.floor(rng() * buildFit.resid.length)]) };
  }
  const key = s.type === 'make' || s.type === 'make_own' ? `make:${s.args.item}` : s.type;
  // (a make's batch and a trip's catch by size: the reference's line through its sizes, its residuals drawn back)
  const size = s.type === 'make' || s.type === 'make_own' ? Number(s.args?.count) : s.type === 'fish' ? Math.min(8, Number(s.args?.count ?? 8)) : NaN;
  // (a trip's time is its casts: the reference's trips all caught ~8, so its minutes a catch, not a line)
  const trips = s.type === 'fish' && size > 0 ? (samples.get(key) ?? []).filter((x) => x.ok && x.n) : [];
  if (trips.length) {
    const x = trips[Math.floor(rng() * trips.length)];
    return { m: Math.max(0.05, (x.m / x.n!) * size) };
  }
  const fit = size > 0 ? sizeFit(key) : null;
  if (fit) return { m: Math.max(0.03, fit.a + fit.b * size + fit.resid[Math.floor(rng() * fit.resid.length)]) };
  const all = samples.get(key) ?? (s.type === 'make' ? [...samples.entries()].filter(([k]) => k.startsWith('make:')).flatMap(([, x]) => x) : undefined);
  // (from where the member stands, when the reference has enough of those)
  const here = all?.filter((x) => !!x.away === away);
  const xs = here && here.length >= 5 ? here : all;
  if (xs?.length) {
    const x = xs[Math.floor(rng() * xs.length)];
    return { m: x.m, ...(!x.ok && x.message && FAILS_FROM_REFERENCE.has(s.type) && x.message !== 'cancelled' ? { fail: x.message } : {}) };
  }
  return { m: (BUILTIN[s.type] ?? 0.2) * Math.exp(0.3 * (rng() - 0.5)) };
}

// ---- the event loop ------------------------------------------------------------------------------------------------------

function start(a: SimAgent) {
  if (a.current || !a.queue.length) return;
  const s = a.queue.shift();
  s.state = 'running';
  s.startedAt = clock;
  s.startedTick = w.ticks;
  const x = sampleFor(s, a.away);
  if (x.fail) s._fail = x.fail;
  a.current = { status: s, endAt: clock + Math.max(500, Math.round(x.m * 60000)) };
}
function finish(a: SimAgent) {
  const s = a.current!.status;
  const model = S.MODELS[s.type];
  a.away = AWAY.has(s.type);
  actionsRun.set(s.type, (actionsRun.get(s.type) ?? 0) + 1);
  // (a board task's action, not a chore's: the task brain's)
  if (!s.args?.chore) boardRun.set(`${s.type}${s.args?.block ? ` ${s.args.block}` : s.args?.item ? ` ${s.args.item}` : ''}`, (boardRun.get(`${s.type}${s.args?.block ? ` ${s.args.block}` : s.args?.item ? ` ${s.args.item}` : ''}`) ?? 0) + 1);
  let out: { ok: boolean; message: string; code?: string };
  if (s._fail) {
    out = { ok: false, message: s._fail, ...(/another agent|other members|being taken/.test(s._fail) ? { code: 'taken' } : {}) };
    fromRef++;
  } else if (!model) {
    unknown.set(s.type, (unknown.get(s.type) ?? 0) + 1);
    out = { ok: true, message: `${s.type} done (not modelled)` };
  } else
    try {
      // (#68: the member's flow, as the real deposit and take feed it: the commons' change around the action)
      const before = storageContents(v);
      out = model(s.args, { w, v, name: a.name, carry: carries.get(a.name)!, crops, eggs, rng, now: clock, greenKept, tripLoads, land });
      const after = storageContents(v), put: Counts = {}, took: Counts = {};
      for (const n of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const d = (after[n] ?? 0) - (before[n] ?? 0);
        if (d > 0) put[n] = d;
        else if (d < 0) took[n] = -d;
      }
      noteFlow(a.name, took, -1);
      noteFlow(a.name, put, 1);
    } catch (e) {
      errors.push(`${stamp()} model ${s.type} threw: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`);
      out = { ok: false, message: `${s.type} failed in the simulator` };
    }
  Object.assign(s, { state: out.ok ? 'done' : 'failed', message: out.message, endedAt: clock, ...(out.code ? { code: out.code } : {}) });
  // (the public works' layouts and sites, as the stage log's lines: where the room runs out)
  if (s.type === 'lay_out_houses' || s.type === 'prepare_site') keep.push({ t: clock, s: `[works] ${a.name} ${s.type} ${out.ok ? 'finished' : 'failed'}: ${out.message.slice(0, 200)}` });
  a.history.push(s);
  if (a.history.length > 100) a.history.shift();
  a.current = null;
  // (as BotAgent.finish: the brain hears its own action's end)
  if (out.ok) a.pushEvent('action_done', `${s.type} finished: ${out.message}`, { action: s.id, type: s.type, args: s.args });
  else a.pushEvent('action_failed', `${s.type} failed: ${out.message}`, { action: s.id, type: s.type, args: s.args, message: out.message, ...(out.code ? { code: out.code } : {}) });
}
const flush = () => new Promise((r) => setImmediate(r));

const END = T0 + minutes * 60000;
let lastTick = T0 - STEP;
let ticks = 0, actionEnds = 0;
const busyMs = new Map<string, number>();
/** Busy minutes by action type (as stage_village's "busy by activity" line). */
const typeMs = new Map<string, number>();
const binMs = Array.from({ length: Math.ceil(minutes / 10) }, () => 0);
const realStart = realNow();
while (clock < END) {
  const nextTick = lastTick + STEP;
  let first: SimAgent | null = null;
  for (const a of agents) if (a.current && (!first || a.current.endAt < first.current!.endAt)) first = a;
  const t = Math.min(nextTick, first?.current?.endAt ?? Infinity, END);
  // Busy time (an action running), by member and 10-minute bin
  for (const a of agents)
    if (a.current) {
      busyMs.set(a.name, (busyMs.get(a.name) ?? 0) + (t - clock));
      typeMs.set(a.current.status.type, (typeMs.get(a.current.status.type) ?? 0) + (t - clock));
      let from = clock;
      while (from < t) {
        const b = Math.floor((from - T0) / 600000), to = Math.min(t, T0 + (b + 1) * 600000);
        if (b < binMs.length) binMs[b] += to - from;
        from = to;
      }
    }
  const dt = (t - clock) / 1000;
  clock = t;
  if (dt > 0) {
    crops.grow(dt);
    eggs.lay(v, dt);
    // (the logs in storage each minute, as the stage log's STOCK lines: builds fail when they run short)
    if (Math.floor((clock - T0) / 60000) > Math.floor((clock - T0 - dt * 1000) / 60000)) {
      const st = storageContents(v);
      keep.push({ t: clock, s: `[stock] ${Object.entries(st).filter(([n]) => /_log$|cobblestone|sand|glass/.test(n)).map(([n, q]) => `${n} ${q}`).join(', ')}` });
    }
  }
  if (clock >= END) break;
  if (first && first.current && first.current.endAt <= clock) {
    finish(first);
    actionEnds++;
    start(first);
    try {
      w.endChoices();
    } catch (e) {
      errors.push(`${stamp()} endChoices threw: ${(e as Error).message}`);
    }
    await flush();
    continue;
  }
  lastTick = clock;
  ticks++;
  try {
    w.tick();
  } catch (e) {
    errors.push(`${stamp()} tick threw: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`);
  }
  await flush();
  for (const a of agents) start(a);
}
const realMs = realNow() - realStart;

// ---- the report ----------------------------------------------------------------------------------------------------------

Object.assign(console, orig);
const store1 = storageContents(v);
const flows: Counts = {};
for (const n of new Set([...Object.keys(store0), ...Object.keys(store1)])) {
  const d = (store1[n] ?? 0) - (store0[n] ?? 0);
  if (d) flows[n] = d;
}
const rows = fs.existsSync(CHOICE_LOG) ? fs.readFileSync(CHOICE_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const picks = rows.filter((r) => r.type === 'choice');
const byKind = (xs: Any[]) => {
  const m: Counts = {};
  for (const x of xs) m[x.kind] = (m[x.kind] ?? 0) + 1;
  return m;
};
const its = (v.initiatives ?? []) as Any[];
const itsNew = its.filter((i) => i.at >= T0);
const report = {
  checkpoint, village: v.name, members: agents.length, minutes, scale, randomTick, seed: SEED, step: STEP / 1000,
  families: [...CHOOSE.families].join(','), buyAll: BUY_ALL, extraBuys: EXTRA_BUYS, merchantOn: process.env.MC_MERCHANT ?? 'on', calib: calibFrom,
  realSeconds: Math.round(realMs / 100) / 10, ticks, actionEnds,
  busy: Math.round((1000 * [...busyMs.values()].reduce((s, x) => s + x, 0)) / (agents.length * minutes * 60000)) / 10,
  busyBins: binMs.map((ms, i) => Math.round((1000 * ms) / (agents.length * Math.min(10, minutes - i * 10) * 60000)) / 10),
  picks: byKind(picks),
  picksBins: binMs.map((_, i) => byKind(picks.filter((p) => Math.floor((p.t - T0) / 600000) === i))),
  actions: Object.fromEntries(actionsRun), boardActions: Object.fromEntries(boardRun), busyByAction: Object.fromEntries([...typeMs].map(([k, ms]) => [k, Math.round(ms / 6000) / 10])), notModelled: Object.fromEntries(unknown),
  initiatives: { started: itsNew.length, built: itsNew.filter((i) => i.state === 'built').length, lapsed: itsNew.filter((i) => i.state === 'lapsed').length, failed: itsNew.filter((i) => i.state === 'failed').length, open: itsNew.filter((i) => i.state === 'open').length, kinds: byKind(itsNew) },
  merchant: v.merchant ? {
    ledger: v.merchant.ledger, emeralds: store1.emerald ?? 0, xp: v.merchant.xp ?? 0,
    orders: (v.merchant.orders ?? []).reduce((c: Counts, o: Any) => ({ ...c, [o.state]: (c[o.state] ?? 0) + 1 }), {}),
    filled: (v.merchant.orders ?? []).filter((o: Any) => o.state === 'filled').map((o: Any) => `${o.n} ${o.item} ${o.emeralds}e`),
  } : null,
  food: v.food ? { made: v.food.made, eaten: v.food.eaten, meals: v.food.meals } : null,
  flows,
  choiceNone: keep.filter((k) => k.s.startsWith('[choice-none]')).map((k) => `+${((k.t - T0) / 60000).toFixed(1)}m ${k.s.replace(/^\[choice-none\] \S+ /, '')}`),
  lightParts: (() => {
    const ps = w.lightParts(v) as Any[];
    return { parts: ps.length, newBuildings: ps.filter((q) => String(q.part).startsWith('sim')).length, structuresNew: v.structures.filter((q: Any) => String(q.id).startsWith('sim')).length, spots: ps.reduce((t, q) => t + q.spots.length, 0), unlit: ps.reduce((t, q) => t + q.unlit, 0) };
  })(),
  // (#68: the members' own stock: chests, what they hold, carried home, still owed, eaten from them)
  own: (() => {
    const hs = Object.values(v.homes ?? {}) as Any[];
    const sum = (f: (h: Any) => Counts) => hs.reduce((t: Counts, h) => { for (const [n, q] of Object.entries(f(h) ?? {})) t[n] = (t[n] ?? 0) + (q as number); return t; }, {});
    return { members: hs.length, chests: hs.filter((h) => h.chest).length, held: sum((h) => h.chest?.items), got: sum((h) => h.got), owed: sum((h) => h.owed), used: sum((h) => h.used) };
  })(),
  failsFromReference: fromRef, errors: errors.length, saves, rcon: Object.fromEntries(rconCounts),
};
fs.writeFileSync(path.join(OUT, 'sim.report.json'), JSON.stringify(report, null, 2));
if (process.env.SIM_TASKS) fs.writeFileSync(path.join(OUT, 'sim.tasks.txt'), v.tasks.filter((t: Any) => Number(/\d+/.exec(t.id)?.[0]) > T0_TASK).map((t: Any) => `${t.id} [${t.status}] ${t.title} after ${t.after.join(',')}${t.result ? ': ' + String(t.result).slice(0, 90) : ''}`).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'sim.events.log'), keep.map((k) => `+${((k.t - T0) / 60000).toFixed(2)}m ${k.s}`).join('\n') + '\n');
if (LOG) fs.writeFileSync(path.join(OUT, 'sim.log'), logLines.join('\n') + '\n');
if (errors.length) fs.writeFileSync(path.join(OUT, 'sim.errors.log'), errors.join('\n') + '\n');
fs.rmSync(SCRATCH, { recursive: true, force: true });

const kv = (c: Counts) => Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ');
say(`village_sim: ${checkpoint} (${v.name}), ${agents.length} members, ${minutes} min at ${scale}x, random ticks ${randomTick}, seed ${SEED}; ${report.realSeconds} s real (${ticks} ticks, ${actionEnds} action ends)`);
say(`  land: ${land ? `${landFile} (${land.n}x${land.n})` : 'none (python scripts/sim/land.py CHECKPOINT): layouts and greens placed by geometry'}`);
say(`  families ${report.families}; merchant ${report.merchantOn}${BUY_ALL ? ' (buys anything: --buy-all)' : ''}${EXTRA_BUYS.length ? ` (also buys ${EXTRA_BUYS.join(', ')})` : ''}; durations from ${calibFrom}`);
say(`  busy ${report.busy}% (bins ${report.busyBins.join(' / ')})`);
say(`  picks: ${kv(report.picks)}`);
for (const [i, b] of report.picksBins.entries()) say(`    ${i * 10}-${i * 10 + 10} min: ${kv(b) || 'none'}`);
say(`  busy by activity (agent-min): ${kv(report.busyByAction)}`);
say(`  board tasks' actions: ${kv(report.boardActions) || 'none'}`);
say(`  actions: ${kv(report.actions)}${unknown.size ? `; NOT MODELLED: ${kv(report.notModelled)}` : ''}`);
say(`  initiatives: ${JSON.stringify(report.initiatives)}`);
say(`  merchant: ${report.merchant ? `ledger ${JSON.stringify(report.merchant.ledger)}, ${report.merchant.emeralds} emeralds in storage, ${report.merchant.xp} traded` : 'none'}`);
if (report.merchant && Object.keys(report.merchant.orders).length) say(`  orders: ${JSON.stringify(report.merchant.orders)}; filled ${report.merchant.filled.join(', ')}`);
if (report.own.members) say(`  own: ${report.own.chests} chests; held ${kv(report.own.held)}; carried home ${kv(report.own.got)}; owed ${kv(report.own.owed)}; eaten from them ${kv(report.own.used)}`);
say(`  food: ${report.food ? `made ${kv(report.food.made)}; eaten ${kv(report.food.eaten)}; ${report.food.meals} meals` : 'none'}`);
say(`  storage flows: ${kv(flows)}`);
say(`  choice-none: ${report.choiceNone.length} lines${report.choiceNone.length ? `; first ${report.choiceNone[0].slice(0, 200)}` : ''}`);
say(`  light parts: ${JSON.stringify(report.lightParts)}`);
say(`  failures repeated from the reference: ${fromRef}`);
say(`  errors ${errors.length}${errors.length ? ` (first: ${errors[0].slice(0, 300)})` : ''}; saves ${saves}`);
say(`  out: ${OUT}`);
// (a failure for check:offline: the world threw, or nobody picked a chore)
const bad = [...(errors.length ? [`${errors.length} errors`] : []), ...(!picks.length ? ['no picks'] : [])];
say(bad.length ? `FAIL village_sim: ${bad.join(', ')}` : `PASS village_sim (${picks.length} picks, busy ${report.busy}%, ${report.realSeconds} s)`);
process.exit(bad.length ? 1 : 0);
