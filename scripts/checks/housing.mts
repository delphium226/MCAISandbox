/**
 * N.2 housing offline (s37, spec runs/2026-10-18/s37/spec_batch_n2.md H), on a checkpoint's village record loaded into a
 * real MineflayerWorld (menu_probe.mts's harness, cut down: the clock frozen, RCON stubbed and recorded, console muted,
 * save() counted, members are fakes Mayor + 24 workers (the pool's names) whose workers take board tasks). MC_HOUSING=on, growth on, votes
 * and public works off unless said. Checks: standing houses given to the houseless (H2) with their signs; the street
 * option only on houseless menus (H3) and the fixed sweep taking it (request, lay_out_houses queued on the asker); owners
 * given to a fabricated neighbourhood's Build tasks, the asker first (H5); the owner's hold in mayClaim (H7: refused while
 * the owner is idle, given once it is busy or after 3 min); built and failed houses (H6); the vote's housing option (H9).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/housing.mts [CHECKPOINT_DIR] (default mc/testcheckpoints/mv3_base25)
 */
import fs from 'node:fs';
import { workerName } from '../../server/src/agentNames';
import os from 'node:os';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const input = process.argv[2] ?? 'mc/testcheckpoints/mv3_base25';
const villagesFile = fs.statSync(input).isDirectory() ? path.join(input, 'villages.json') : input;
const cpFile = path.join(path.dirname(villagesFile), 'checkpoint.json');

process.env.MC_HOUSING = 'on';
process.env.MC_CHOICE_FAMILIES ??= 'make,gather,works,light,catalog,furnish,initiatives';
process.env.MC_CHOOSE = 'fixed';
process.env.MCAI_TEMPERAMENT ??= 'on';
process.env.MC_VOTE = 'off';
process.env.MC_PROJECTS = 'off';
delete process.env.MC_GROW;
process.env.MC_TIME_SCALE = '1';
process.env.MC_MODEL_RECORD = '0';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'housing-'));
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');

const cpTime = fs.existsSync(cpFile) ? Date.parse(String(JSON.parse(fs.readFileSync(cpFile, 'utf8')).time ?? '').replace(' ', 'T')) : NaN;
let clock = Number.isFinite(cpTime) ? cpTime : fs.statSync(villagesFile).mtimeMs;
Date.now = () => clock;

const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const errors: string[] = [];
const lines: string[] = [];
const mute = () => {
  console.log = (...a: unknown[]) => {
    const s = a.map(String).join(' ');
    if (/^\[(home|grow|work)\]/.test(s)) lines.push(s.slice(0, 300));
  };
  console.warn = () => {};
  console.info = () => {};
  console.error = (...a: unknown[]) => {
    const s = a.map(String).join(' ');
    if (/^\[vanilla\] block lists from/.test(s)) return;
    errors.push(a.map((x) => (x instanceof Error ? x.stack ?? x.message : String(x))).join(' ').slice(0, 400));
  };
};
const unmute = () => Object.assign(console, quiet);
const say = (s: string) => quiet.log(s);
let fails = 0;
const ok = (c: unknown, what: string) => {
  if (!c) fails++;
  say(`${c ? 'ok  ' : 'FAIL'} ${what}`);
};

mute();
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const { isDwelling } = await import('../../server/src/grow');
unmute();

const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
fs.copyFileSync(villagesFile, path.join(dir, 'villages.json'));
const data = JSON.parse(fs.readFileSync(villagesFile, 'utf8')) as { villages: Any[] };
const base = data.villages.find((x) => x.complete) ?? data.villages[0];
mute();
const rcon: string[] = [];
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async (c: string) => { rcon.push(c); return ''; } } as never, dir) as Any;
unmute();
const reg = w.villages as Any;
reg.save = () => {};
if (w.atlas) w.atlas.save = () => {};
const v = reg.get(base.name);

// Fakes: idle unless they hold a queued or running action or are set busy; workers take board tasks
const chest0 = v.storage?.chests?.[0];
const plot0 = v.plots.find((p: Any) => !p.annex);
const home = chest0 ? { x: chest0.x, y: chest0.y, z: chest0.z } : { x: Math.floor((plot0.x1 + plot0.x2) / 2), y: plot0.y + 1, z: Math.floor((plot0.z1 + plot0.z2) / 2) };
const sections = new Array(24).fill(null);
const getColumn = () => ({ minY: -64, sections, getBlockStateId: () => 0 });
// (#11, s38: the pool's first names, as the checkpoints are saved since then)
const NAMES = ['Mayor', ...Array.from({ length: 24 }, (_, i) => workerName(i + 1))];
const busy = new Set<string>();
const queued: Any[] = [];
let nextId = 1;
const byName = new Map<string, Any>();
for (const name of NAMES) {
  const own: Any[] = [];
  const memory = { village: v.name, villageRole: name === 'Mayor' ? 'mayor' : 'worker' };
  const a: Any = {
    name, role: memory.villageRole, memory, world: w,
    village: () => reg.get(memory.village),
    idle: () => !busy.has(name) && !own.some((s) => s.state === 'queued' || s.state === 'running'),
    enqueue: (type: string, args: Record<string, unknown>) => {
      const s = { id: nextId++, type, args, state: 'queued', agent: name };
      own.push(s);
      queued.push(s);
      return s;
    },
    brain: { claimsTasks: () => memory.villageRole !== 'mayor' },
    bot: { entity: { position: { x: home.x + 0.5, y: home.y, z: home.z + 0.5 } }, entities: {}, inventory: { items: () => [] }, world: { getColumn }, game: { minY: -64 } },
  };
  w.agents.set(name.toLowerCase(), a);
  byName.set(name, a);
}

say(`housing: ${villagesFile}; village ${v.name}, ${v.structures.filter((s: Any) => isDwelling(s.kind)).length} houses, ${NAMES.length} members`);

// ---- H2: standing houses to the houseless -------------------------------------------------------------------------------
mute();
w.homeTick(v);
unmute();
const houses = v.structures.filter((s: Any) => isDwelling(s.kind));
const owned = houses.filter((s: Any) => s.owner);
ok(owned.length === Math.min(houses.length, NAMES.length), `H2: ${owned.length} of ${houses.length} standing houses owned (${owned.map((s: Any) => `${s.owner}:${s.id}`).join(', ')})`);
ok(houses.length < 1 || owned[0]?.owner === 'Mayor', 'H2: the Mayor first');
const signed = (v.layouts ?? []).flatMap((l: Any) => l.signs ?? []).filter((s: Any) => /'s$/.test(s.text?.[0] ?? ''));
ok(signed.length >= Math.min(owned.length, 1) || !(v.layouts ?? []).some((l: Any) => l.signs?.length), `H2: ${signed.length} signs name their owner (${signed.map((s: Any) => s.text.join(' ')).join('; ')}); rcon rewrites ${rcon.filter((c) => c.startsWith('data merge block')).length}`);
mute();
w.homeTick(v);
unmute();
ok(v.structures.filter((s: Any) => s.owner).length === owned.length, 'H2: a second tick gives nothing twice');
const homeless = w.homeless(v).map((a: Any) => a.name);
ok(homeless.length === NAMES.length - owned.length, `H1: ${homeless.length} houseless`);

// ---- H3: the street option -----------------------------------------------------------------------------------------------
const menuOf = (name: string) => w.choices(byName.get(name));
const housed = owned[0]?.owner;
if (housed) {
  const m = menuOf(housed);
  ok(m && !m.options.some((o: Any) => o.kind === 'grow') && m.reasons?.grow === 'has a house', `H3: ${housed} (housed) gets no street option (${m?.reasons?.grow})`);
}
const first = homeless[0];
const m1 = menuOf(first);
const street = m1?.options.find((o: Any) => o.id === 'grow:street');
ok(!!street, `H3: ${first} (houseless) is offered "${street?.name}" (rank ${street?.rank}, tw ${street?.tw})`);
ok(!street || street.rank === 1, 'H3: rank 1');

// The sweep takes it: growth's first wait passed (growSeen is set on the first farm tick)
w.farmCheckAt = 0;
mute();
w.farmChores();
unmute();
clock += 61_000;
w.farmCheckAt = 0;
mute();
w.farmChores();
unmute();
const req = v.growth?.request;
const lay = queued.filter((s) => s.type === 'lay_out_houses');
ok(!!req || lay.length > 0, `H3: a street asked for (request ${req ? `by ${req.by}` : 'spent'}), lay_out_houses queued ${lay.length}x${lay[0] ? ` on ${lay[0].agent} (${lay[0].args.houses})` : ''}`);
const asker = req?.by ?? lay[0]?.agent;
ok(!!asker && lay[0]?.agent === asker, `H3/H4: the asker (${asker}) lays it out`);
ok(lay.length <= 1, 'H3: one street at a time');
// (the others' sweep chores done, so a houseless member is idle to read its menu)
for (const s of queued) if (s.type !== 'lay_out_houses') s.state = 'done';
mute();
w.choreKeys(v);
unmute();
clock += 11_000;
const m2 = menuOf(homeless.find((n: string) => n !== asker));
ok(m2 && !m2.options.some((o: Any) => o.kind === 'grow'), `H3: no second street offered while one is under way (${m2?.reasons?.grow})`);

// ---- H5: owners at posting (a fabricated neighbourhood) -----------------------------------------------------------------
for (const s of lay) s.state = 'done';
const design = houses[0]?.kind ?? 'plains_small_house_1';
const xs = [0, 1, 2, 3].map((i) => ({ x: home.x + 200 + 12 * i, z: home.z + 200 }));
const made = reg.post(v, xs.map((p) => ({ title: `Build ${design}`, detail: `build_design "${design}" x=${p.x} z=${p.z} (test)` })), 'grow', 100);
const g = (v.growth ??= { past: [] });
g.request ??= { by: asker, at: clock };
g.active = { k: (g.past?.length ?? 0) + 1, layout: (v.layouts ?? []).length, from: Number(/\d+/.exec(made[0].id)![0]), at: clock, by: asker, plot: { x1: xs[0].x - 5, z1: xs[0].z - 5, x2: xs[3].x + 5, z2: xs[0].z + 5 }, houses: xs.map(() => design), builds: made.map((t: Any) => t.id), members: NAMES.length, before: houses.length, changed: clock, sig: '' };
mute();
w.homeTick(v);
unmute();
ok(made[0].owner === asker, `H5: the asker owns the first house (${made.map((t: Any) => `${t.id}:${t.owner}`).join(', ')})`);
ok(new Set(made.map((t: Any) => t.owner)).size === 4 && made.every((t: Any) => t.owner), 'H5: four different owners');
ok(!v.growth.request, 'H5: the request spent');
ok(w.homeless(v).length === homeless.length - 4, `H5: houseless now ${w.homeless(v).length}`);

// ---- H7: the owner's hold -------------------------------------------------------------------------------------------------
const t0 = made[1];
const owner = byName.get(t0.owner);
const other = byName.get(w.homeless(v).map((a: Any) => a.name).find((n: string) => n !== 'Mayor') ?? workerName(24));
ok(w.mayClaim(owner, t0) === true, `H7: the owner ${owner.name} may claim its house`);
ok(w.mayClaim(other, t0) === false, `H7: ${other.name} is refused while ${owner.name} is idle`);
busy.add(owner.name);
ok(w.mayClaim(other, t0) === true, `H7: ${other.name} may claim it while the owner is busy`);
busy.delete(owner.name);
clock += 3 * 60_000 + 1;
ok(w.mayClaim(other, t0) === true, `H7: ${other.name} may claim it after 3 min`);

// ---- H6: built and failed ------------------------------------------------------------------------------------------------
made[0].status = 'done';
v.structures.push({ id: 'stest', x1: xs[0].x - 3, z1: xs[0].z - 3, x2: xs[0].x + 3, z2: xs[0].z + 3, y: home.y, kind: design, builtBy: asker });
made[2].status = 'failed';
const failedOwner = made[2].owner;
mute();
w.homeTick(v);
unmute();
ok(v.structures.find((s: Any) => s.id === 'stest')?.owner === asker, `H6: ${asker}'s house stands and is marked`);
ok(!made[2].owner && w.homeless(v).some((a: Any) => a.name === failedOwner), `H6: ${failedOwner}'s failed house frees it`);

// ---- H9: the vote's housing option -----------------------------------------------------------------------------------------
let opts: Any[] = [];
mute();
try {
  opts = w.projectOptions(v);
} catch (e) {
  errors.push(`projectOptions: ${(e as Error).message}`);
}
unmute();
ok(opts.some((o) => o.id === 'houses'), `H9: the work vote offers a street of houses (${opts.map((o) => o.id).join(', ')})`);

say(`log lines: ${lines.length}`);
for (const l of lines.slice(0, 14)) say(`  | ${l}`);
say(`console.error lines: ${errors.length}${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
if (errors.length) fails++;
say(fails ? `FAIL housing (${fails})` : 'PASS housing');
fs.rmSync(SCRATCH, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
