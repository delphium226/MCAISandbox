/**
 * The monument's M3 (#146) checked offline on a checkpoint (monument_unit.mts' harness: a real MineflayerWorld on a
 * scratch copy, the clock frozen, RCON stubbed, 25 fake members at the first chest, all idle; no server or model):
 * - the architect (MC_MONUMENT_ARCHITECT): the trigger asks the architect once (replayed from a made-up recording: a pick
 *   sent back for its scale, then a good one) and the record carries its preset, scale, dedication and why; the checks of
 *   a pick (presets, scales, colours on offer only, plain left out);
 * - the trades (MC_MONUMENT_ROLES): an item's, a job's (glass, wood and stone jobs in the full palette) and a step's trade;
 *   a trade taken at 2 credited chores, kept through a few others, changed at 3 more among the last 8; the per-stage
 *   counts; on the menu the member's own-trade options weigh 1.5 and carry the tag, nobody else's do;
 * - the news and memory (MC_MONUMENT_NEWS): the progress line in each member's prompt context (stage, parts, its trade),
 *   a stage's news in the village log, the chronicle and every member's news (MC_NEWS), the member's part in what it
 *   remembers;
 * - with the M3 flags off (run as a child): no weight, tag or progress line, and the trigger uses the settings' preset.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/monument_m3.mts [CHECKPOINT_DIR]   (default mc/testcheckpoints/im2_mine)
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
  console.log(`SKIP monument_m3: ${villagesFile} is not here`);
  process.exit(0);
}
const OFF = process.env.M3_CHILD === 'off';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'monument-m3-'));
process.env.MC_CHOOSE = 'model';
process.env.MC_VOTE = 'off';
process.env.MC_GROW = '0';
process.env.MC_TIME_SCALE = '1';
process.env.MC_MODEL_RECORD = '0';
process.env.MC_MEMORY = OFF ? 'off' : 'on';
process.env.MC_CLOCK = OFF ? 'off' : 'on';
process.env.MCAI_SOCIAL = OFF ? 'legacy' : 'on';
process.env.MC_ACTS = OFF ? 'off' : 'on';
process.env.MC_NEWS = OFF ? 'off' : 'on';
process.env.MC_LADDER = 'on';
process.env.MC_IRON_AGE = 'on';
process.env.MC_MONUMENT = 'on';
process.env.MC_MONUMENT_SCALE = '0.25';
process.env.MC_MONUMENT_PALETTE = 'full';
process.env.MC_GLAZING = 'on';
process.env.MC_MONUMENT_ROLES = OFF ? 'off' : 'on';
process.env.MC_MONUMENT_NEWS = OFF ? 'off' : 'on';
process.env.MC_MONUMENT_ARCHITECT = OFF ? 'off' : 'on';
process.env.MC_MONUMENT_SCALES = '0.25,0.5';
// (the architect's two replies: the first sent back for its scale and a colour, the second taken)
const replay = path.join(SCRATCH, 'replay.jsonl');
const reply = (input: Record<string, unknown>) => ({ text: '', calls: [{ name: 'plan_cathedral', input }], promptTokens: 0, outputTokens: 0 });
fs.writeFileSync(replay, [
  { agent: 'Mayor', kind: 'design', n: 1, hash: 'a', reply: reply({ reason: 'big', preset: 'salisbury', scale: 3, glass: { yellow: 'mauve' } }) },
  { agent: 'Mayor', kind: 'design', n: 2, hash: 'b', reply: reply({ reason: 'A spire to be seen from the fields.', preset: 'salisbury', scale: 4, glass: { red: 'plain' }, dedication: 'Saint Ada!' }) },
].map((r) => JSON.stringify(r)).join('\n'));
if (!OFF) process.env.MC_MODEL_REPLAY = replay;
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
process.env.MCAI_ACTS_LOG = path.join(SCRATCH, 'acts.jsonl');
const clock = fs.statSync(villagesFile).mtimeMs;
Date.now = () => clock;

const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const lines: string[] = [];
const mute = () => { console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); }; console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
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
const memory = await import('../../server/src/memory');
const acts = await import('../../server/src/acts');
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
  const mem = { village: v.name, villageRole: name === 'Mayor' ? 'mayor' : 'worker' };
  const own: Any[] = [];
  const a: Any = {
    name, role: mem.villageRole, memory: mem, world: w, village: () => reg.get(mem.village),
    idle: () => !own.some((s) => s.state === 'queued' || s.state === 'running'),
    enqueue: (type: string, args: Record<string, unknown>) => { const s = { id: own.length + 1, type, args, state: 'queued', agent: name }; own.push(s); return s; },
    bot: { entity: { position: { x: home.x + 0.5, y: home.y, z: home.z + 0.5 } }, entities: {}, inventory: { items: () => [] }, world: { getColumn }, game: { minY: -64 } },
  };
  agents.push(a);
  w.agents.set(name.toLowerCase(), a);
}
w.chooser = { submit: () => {}, cancel: () => {} };
// (no flowers counted near the village: a fixed census, so the colours on offer are known)
w.flowerCounts = () => ({ dandelion: 30, wildflowers: 9, poppy: 4, cornflower: 7 });
const menuOf = (a: Any) => { mute(); const m = w.choices(a); unmute(); return m; };
const monOpts = (a: Any) => ((menuOf(a)?.options ?? []) as Any[]).filter((o) => o.kind === 'monument');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

// 1. The trigger: the architect's pick (or, flags off, the settings' preset)
delete v.monument;
v.ladder = { ...(v.ladder ?? { current: 'letters', stage: 0, stageStart: clock, count: 0, work: {}, ballots: [] }), reached: [...(v.ladder?.reached ?? []).filter((r: Any) => r.rung !== 'iron'), { rung: 'iron', t: clock }] };
mute(); w.monumentTick(v); unmute();
if (OFF) {
  ok(v.monument?.preset === 'notre_dame' && v.monument.scale === 4 && !v.monument.arch && !v.monument.name, `flags off: the settings' preset at once: ${JSON.stringify(v.monument)?.slice(0, 160)}`);
} else {
  ok(!v.monument, 'the record made before the architect answered');
  mute(); await settle(); w.monumentTick(v); unmute();
  const m0 = v.monument;
  ok(m0?.preset === 'salisbury' && m0.scale === 4 && m0.name === 'Saint Ada' && m0.arch?.by === 'Mayor' && /spire/.test(m0.arch?.reason ?? ''), `the architect's pick: ${JSON.stringify({ preset: m0?.preset, scale: m0?.scale, name: m0?.name, arch: m0?.arch })}`);
  ok(lines.some((l) => /\[architect\].*sent back: scale must be one of 4, 2.*glass yellow: "mauve"/.test(l)), 'the first pick sent back for its scale and a colour not on offer');
  ok(JSON.stringify(m0?.colours ?? {}) === '{}' && m0?.flowers?.yellow === 'dandelion', `colours: plain left out, flowers kept: ${JSON.stringify(m0?.colours)} ${JSON.stringify(m0?.flowers)}`);
  ok(v.log.some((l: string) => /begins its cathedral \(Salisbury at 1:4, dedicated to Saint Ada\)/.test(l)), `the start in the village log: ${v.log.slice(-1)}`);
}
// (the pick's checks, pure)
{
  const facts = { village: 'V', members: 25, wood: 'oak', dyes: { yellow: 39, blue: 7 }, options: [{ preset: 'chartres', scale: 4, width: 1, depth: 1, height: 1, blocks: 1, jobs: 1 }, { preset: 'chartres', scale: 2, width: 1, depth: 1, height: 1, blocks: 1, jobs: 1 }] };
  const r1 = mon.checkArchitect({ preset: 'Notre Dame', scale: '1:2', glass: { blue: 'blue', red: 'plain', yellow: 'yellow' }, reason: 'x' }, facts) as Any;
  ok(r1.pick?.preset === 'notre_dame' && r1.pick.scale === 2 && JSON.stringify(r1.pick.colours) === '{"blue":"blue","yellow":"yellow"}', `a good pick: ${JSON.stringify(r1)}`);
  const r2 = mon.checkArchitect({ preset: 'york', scale: 0.5, glass: { red: 'red' } }, facts) as Any;
  ok(r2.problems?.length === 2 && /york/.test(r2.problems[0]) && /red/.test(r2.problems[1]), `york refused, 0.5 read as 1:2, red not on offer: ${JSON.stringify(r2)}`);
  const r3 = mon.checkArchitect({ preset: 'chartres', scale: 4, glass: { red: 'red' } }, facts) as Any;
  ok(r3.problems?.length === 1 && /red/.test(r3.problems[0]), `a colour not on offer refused: ${JSON.stringify(r3)}`);
  ok(/The scale is set: 1:4/.test(mon.architectPrompt({ ...facts, options: [facts.options[0]] })) && /dye colours.*yellow \(39\)/.test(mon.architectPrompt(facts)), 'the prompt: a set scale, the dyes on offer');
}

const m = v.monument;
const sx = home.x + 40, sz = home.z;
const { w: fw, d: fd } = mon.siteSize(m, 0);
m.site = { x1: sx, z1: sz, x2: sx + fw - 1, z2: sz + fd - 1, y: home.y - 1, rotate: 0, prepared: true };
m.state = 'building';
const plan = mon.monumentPlan(m);

// 2. The trades
const jobTrades = plan.jobs.map((_: Any, i: number) => mon.tradeOfJob(m, i));
ok(['mason', 'carpenter', 'glazier'].every((t) => jobTrades.includes(t)), `glass, wood and stone jobs: ${jobTrades.join(',')}`);
ok(mon.tradeOfItem('cobblestone') === 'quarryman' && mon.tradeOfItem('spruce_log') === 'carpenter' && mon.tradeOfItem('sand') === 'glazier' && mon.tradeOfItem('dandelion') === 'glazier', 'items\' trades');
ok(mon.tradeOfStep(m, { step: 'kiln' }) === 'mason' && mon.tradeOfStep(m, { step: 'site' }) === 'quarryman', 'steps\' trades');
{
  const t = { ...m, trades: {} } as Any;
  ok(!mon.noteTrade(t, 'X', 'mason', clock), 'a trade taken at 1 chore');
  ok(mon.noteTrade(t, 'X', 'mason', clock)?.took === 'mason', 'a trade not taken at 2');
  for (const tr of ['carpenter', 'carpenter', 'mason', 'carpenter', 'carpenter']) mon.noteTrade(t, 'X', tr as Any, clock);
  ok(mon.tradeOf(t, 'X') === 'mason', `kept through a few others: ${JSON.stringify(t.trades.X)}`);
  const ch0 = mon.noteTrade(t, 'X', 'carpenter', clock), ch = mon.noteTrade(t, 'X', 'carpenter', clock);
  ok(!ch0 && ch?.took === 'carpenter' && ch.from === 'mason', `changed at 3 more among the last 8 (5 against 3 kept it, 6 against 2 changed it): ${JSON.stringify(t.trades.X.recent)}`);
  ok(t.trades.X.stages['1'].mason === 3 && t.trades.X.stages['1'].carpenter === 6, `per stage: ${JSON.stringify(t.trades.X.stages)}`);
}
if (!OFF) {
  // (members credited through the world's own path: Ada a quarryman, Ben a carpenter)
  const ada = agents[1], ben = agents[2];
  mute();
  w.creditTrade(v, ada.name, 'quarryman', { item: 'cobblestone', n: 64 });
  w.creditTrade(v, ada.name, 'quarryman', { item: 'cobblestone', n: 64 });
  w.creditTrade(v, ben.name, 'carpenter', { item: 'spruce_log', n: 32 });
  w.creditTrade(v, ben.name, 'carpenter', { built: true });
  unmute();
  ok(mon.tradeOf(m, ada.name) === 'quarryman' && mon.tradeOf(m, ben.name) === 'carpenter', 'trades taken through creditTrade');
  ok(lines.some((l) => /\[trade\].*Ada takes the trade of quarryman in stage 1/.test(l)), 'the trade logged');
  const opts = monOpts(ada);
  const cob = opts.filter((o) => /gather:cobblestone/.test(o.id)), rest = opts.filter((o) => !/gather:cobblestone/.test(o.id));
  ok(cob.length && cob.every((o) => o.rw === mon.TRADE_WEIGHT && o.tradeTag === '[your trade: quarryman]') && rest.every((o) => o.rw === undefined), `Ada's menu: ${opts.map((o) => `${o.id}${o.rw ? '*' : ''}`).join(', ')}`);
  ok(monOpts(agents[3]).every((o) => o.rw === undefined), 'a member without a trade gets no weight');

  // 3. The progress line, the news, the memory
  const ctx = menuOf(ada)?.ctx;
  ok(/^The village's monument: the cathedral of Saint Ada \(Salisbury at 1:4\): stage 1 of 8, pad and floor: 0 of \d+ parts built/.test(ctx?.monument ?? '') && /You are its quarryman/.test(ctx.monument), `Ada's line: ${ctx?.monument}`);
  for (const i of mon.openJobs(m)) mon.jobBuilt(m, i, {}, clock);
  mute(); w.monumentNews(v, 'The cathedral of Saint Ada\'s pad and floor is done; its aisle walls and west-front base begins (stage 1 of 8 finished by Ben)', ben.name); unmute();
  ok(v.log.at(-1)?.includes('pad and floor is done'), `the village log: ${v.log.at(-1)}`);
  const vm = memory.villageMemory(v.name);
  ok(!vm || JSON.stringify(vm.social.chronicle ?? []).includes('pad and floor is done'), `the chronicle: ${JSON.stringify(vm?.social.chronicle)?.slice(0, 200)}`);
  const heard = acts.newsLines(v.name, ada.name, clock);
  ok(heard.some((l) => /Ben says: .*pad and floor is done/.test(l)) && !acts.newsLines(v.name, ben.name, clock).some((l) => /pad and floor/.test(l)), `Ada's news: ${heard.join(' | ')}`);
  const line2 = menuOf(ada)?.ctx?.monument ?? '';
  ok(/stage 2 of 8, aisle walls/.test(line2) && /pad and floor is done/.test(line2), `the line after the stage: ${line2}`);
  ok(/Your part in the cathedral of Saint Ada: its quarryman since stage 1; 2 chores \(2 as quarryman\), brought 128 cobblestone/.test(mon.partLine(m, ada.name)), `Ada's part: ${mon.partLine(m, ada.name)}`);
  ok(/1 part built/.test(mon.partLine(m, ben.name)), `Ben's part: ${mon.partLine(m, ben.name)}`);
  memory.noteSpawn(v.name, ada.name, { role: 'worker', brain: null, memory: {}, reset: false }, clock);
  const rc = memory.recall(v.name, ada.name, clock, { mark: false });
  ok(rc?.text.includes('Your part in the cathedral of Saint Ada'), `Ada remembers her part: ${rc?.text.slice(0, 400)}`);
} else {
  for (const a of agents.slice(1, 3)) mon.noteTrade(m, a.name, 'quarryman', clock), mon.noteTrade(m, a.name, 'quarryman', clock);
  const all = agents.flatMap((a) => (menuOf(a)?.options ?? []) as Any[]);
  ok(all.every((o) => o.rw === undefined && !o.tradeTag), 'flags off: an option weighted by trade');
  ok(agents.every((a) => !menuOf(a)?.ctx?.monument), 'flags off: a progress line');
}

if (!OFF) {
  const self = fileURLToPath(import.meta.url);
  let offOk = true;
  try {
    const out = execFileSync(process.execPath, [...process.execArgv, self, cpDir], { env: { ...process.env, M3_CHILD: 'off', MC_MODEL_REPLAY: '' }, stdio: 'pipe' });
    quiet.log(String(out).trim());
  } catch (e) {
    offOk = false;
    quiet.log(String((e as Any).stdout ?? e).slice(0, 600));
  }
  ok(offOk, 'the flags-off child failed');
}
quiet.log(failures ? `FAIL monument_m3${OFF ? ' (off)' : ''}: ${failures} of ${checks} checks` : `PASS${OFF ? ' (off)' : ''}: ${checks} checks, 0 failures`);
process.exit(failures ? 1 : 0);
