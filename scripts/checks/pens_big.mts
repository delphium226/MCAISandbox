/**
 * #229 (MC_PENS_BIG) checked offline: the doubled shapes and the enlargement (farmSlots.ts), then the pens' menus on a
 * checkpoint (policy_options.mts' harness: a real MineflayerWorld on a scratch copy, clock frozen, RCON stubbed, fake
 * members idle at the first chest; ~10 s):
 *   A. every doubled shape's inside is at least twice its base's, its caps twice; every pen set fits the 25x18 annex;
 *   B. w203_n9's pens (two 3x5s and two 3x3s on a 25x13 annex) enlarge where they stand to twice their inside, inside
 *      the annex, gates where they were, no two overlapping;
 *   C. the menu: a built 3x5 chicken pen is offered its enlargement; breeding below the cap ranks above the wall (300s);
 *      a chicken pen of 2 with eggs stored is offered hatching; an emptied one (0) is offered hatching and no other pen
 *      work; a restocking pen of 6 is not plucked, nor one below half its cap; chickens seen are led into a pen of 3
 *      again; seeds are gathered when the pen is short of them;
 *   D. flag off (a child run): none of these: no enlargement, no hatching, breeding at 500+, no lead-in at 3.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/pens_big.mts [CHECKPOINT_DIR]   (default mc/testcheckpoints/w203_n9)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workerName } from '../../server/src/agentNames';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const cpDir = process.argv[2] ?? 'mc/testcheckpoints/w203_n9';
const villagesFile = path.join(cpDir, 'villages.json');
const OFF = process.env.PENS_CHILD === 'off';
process.env.MC_WORLD_MODE = 'hostile';
process.env.MC_CHOOSE = 'model';
process.env.MC_VOTE = 'off';
process.env.MC_GROW = '0';
process.env.MC_TIME_SCALE = '1';
process.env.MC_MODEL_RECORD = '0';
process.env.MC_MEMORY = 'off';
process.env.MC_BOWS = 'on';
process.env.MC_PEN_VARIETY = 'on';
process.env.MC_PENS_BIG = OFF ? 'off' : 'on';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'pens-big-'));
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
process.env.MCAI_ACTS_LOG = path.join(SCRATCH, 'acts.jsonl');

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

const F = await import('../../server/src/farmSlots');

// A: the shapes
if (!OFF) {
  for (const [n, sh] of Object.entries(F.PEN_SHAPES)) {
    const big = F.PEN_SHAPES_BIG[n];
    const a0 = F.penShapeArea(sh), a1 = F.penShapeArea(big);
    ok(a1 >= 2 * a0 && a1 <= 2.2 * a0, `A: ${n}'s inside ${a0} -> ${a1} (twice, within 10%)`);
    ok(big.w === sh.w || n === 'large', `A: ${n} keeps its width (${sh.w} -> ${big.w})`);
    for (const k of ['chicken', 'sheep', 'cow', 'pig']) {
      const c0 = F.penCap(k, { shape: sh }), c1 = F.penCap(k, { shape: big });
      ok(c1 >= 2 * c0 - 1, `A: ${n} ${k} cap ${c0} -> ${c1}`);
    }
  }
  for (const set of F.PEN_SETS) {
    const shapes = set.map((n) => F.PEN_SHAPES_BIG[n]);
    ok(shapes.reduce((s, q) => s + q.w, 0) + shapes.length - 1 + 2 <= F.ANNEX_BIG[0], `A: ${set} fits the big annex's length`);
    ok(Math.max(...shapes.map((q) => q.l)) + 2 <= F.ANNEX_BIG[1], `A: ${set} fits the big annex's depth`);
    for (const side of ['n', 's', 'e', 'w'] as const) {
      const plot = { x1: 0, z1: 0, x2: 39, z2: 39 };
      const r = F.annexCandidates(plot, F.ANNEX_BIG).find((c) => c.side === side)!;
      const slots = F.variedAnnexSlots(r, shapes);
      ok(slots.every((s) => s.x1 >= r.x1 && s.x2 <= r.x2 && s.z1 >= r.z1 && s.z2 <= r.z2), `A: ${set} on side ${side} inside the annex`);
      ok(slots.every((s) => F.penShapePlan(s, s.face, s.shape).area === F.penShapeArea(s.shape)), `A: ${set} on side ${side}: planned areas`);
    }
  }
  ok(F.restockLine('chicken') === 4 && F.restockLine('sheep') === 2, 'A: restock lines chicken 4, others 2');
}

if (!fs.existsSync(villagesFile)) {
  quiet.log(`SKIP pens_big's menus: ${villagesFile} is not here`);
  quiet.log(`${failures ? 'FAIL' : 'PASS'}: ${checks} checks, ${failures} failures`);
  process.exit(failures ? 1 : 0);
}
const data = JSON.parse(fs.readFileSync(villagesFile, 'utf8')) as { villages: Any[] };
const base = data.villages.find((x) => x.complete && x.layouts?.[0]?.annex?.state === 'ready') ?? data.villages[0];

// B: the enlargement on the checkpoint's annex
if (!OFF) {
  const lay = base.layouts[0], ax = lay.annex;
  const pens = lay.slots.filter((s: Any) => s.annex);
  const grown = pens.map((s: Any) => ({ s, g: F.enlargedSlot(s, ax) }));
  for (const { s, g } of grown) {
    const a0 = F.penShapeArea(s.shape), want = 2 * F.baseArea(s);
    ok(g && F.penShapeArea(g.shape) >= want, `B: the ${s.shape.name} pen at ${s.x1},${s.z1}: ${a0} -> ${g ? F.penShapeArea(g.shape) : 'no room'} (want ${want})`);
    if (!g) continue;
    ok(g.x1 >= ax.x1 && g.x2 <= ax.x2 && g.z1 >= ax.z1 && g.z2 <= ax.z2, `B: the ${s.shape.name} pen at ${s.x1},${s.z1} stays inside the annex`);
    const P0 = F.penPlan(s, s.face), P1 = F.penPlan({ ...s, ...g }, s.face);
    ok(P0.gate[0] === P1.gate[0] && P0.gate[1] === P1.gate[1], `B: the ${s.shape.name} pen at ${s.x1},${s.z1} keeps its gate`);
    ok(P0.boxes.every((b) => P1.boxes.some((q) => q.x1 <= b.x1 && q.x2 >= b.x2 && q.z1 <= b.z1 && q.z2 >= b.z2)), `B: the ${s.shape.name} pen's old inside is inside the new one`);
    ok(!F.enlargedSlot({ ...s, ...g }, ax), `B: an enlarged pen is not enlarged again`);
  }
  const rects = grown.map(({ s, g }: Any) => g ?? s);
  let overlap = 0;
  for (let i = 0; i < rects.length; i++) for (let k = i + 1; k < rects.length; k++) {
    const p = rects[i], q = rects[k];
    if (p.x1 <= q.x2 && q.x1 <= p.x2 && p.z1 <= q.z2 && q.z1 <= p.z2) overlap++;
  }
  ok(!overlap, `B: enlarged pens overlap (${overlap})`);
  quiet.log(`  B: ${base.name}'s pens ${grown.map(({ s, g }: Any) => `${F.penWords(s)} -> ${g ? F.penWords({ shape: g.shape }) : '-'}`).join(', ')}`);
}

// C: the menus
const cpFile = path.join(cpDir, 'checkpoint.json');
const cpTime = fs.existsSync(cpFile) ? Date.parse(String(JSON.parse(fs.readFileSync(cpFile, 'utf8')).time ?? '').replace(' ', 'T')) : NaN;
let clock = Number.isFinite(cpTime) ? cpTime : fs.statSync(villagesFile).mtimeMs;
Date.now = () => clock;
mute();
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
unmute();
const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
fs.copyFileSync(villagesFile, path.join(dir, 'villages.json'));
if (fs.existsSync(path.join(cpDir, 'atlas.json'))) fs.copyFileSync(path.join(cpDir, 'atlas.json'), path.join(dir, 'atlas.json'));
mute();
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
unmute();
const reg = w.villages as Any;
reg.save = () => {};
if (w.atlas) w.atlas.save = () => {};
const v = reg.get(base.name);
const chest0 = v.storage.chests[0];
const home = { x: chest0.x, y: chest0.y, z: chest0.z };
const sections = new Array(24).fill(null);
const getColumn = () => ({ minY: -64, sections, getBlockStateId: () => 0 });
const agents: Any[] = [];
for (const name of ['Mayor', ...Array.from({ length: 6 }, (_, i) => workerName(i + 1))]) {
  const memory = { village: v.name, villageRole: name === 'Mayor' ? 'mayor' : 'worker' };
  const own: Any[] = [];
  const a: Any = {
    name, role: memory.villageRole, memory, world: w, village: () => reg.get(memory.village),
    idle: () => !own.some((s) => s.state === 'queued' || s.state === 'running'),
    enqueue: (type: string, args: Record<string, unknown>) => { const s = { id: own.length + 1, type, args, state: 'queued', agent: name }; own.push(s); return s; },
    bot: { entity: { position: { x: home.x + 0.5, y: home.y, z: home.z + 0.5 } }, entities: {}, inventory: { items: () => [] }, world: { getColumn }, game: { minY: -64 }, health: 20, time: { timeOfDay: 2000 } },
  };
  agents.push(a);
  w.agents.set(name.toLowerCase(), a);
}
const slots = v.layouts[0].slots;
const jc = slots.findIndex((s: Any) => s.annex && s.kind === 'chicken') + 1;
const chick = slots[jc - 1];
const ax = v.layouts[0].annex;
// (chickens seen near the annex, for the lead-in)
w.atlas.animalSightings = (kind: string) => (kind === 'chicken' ? [{ x: ax.x1 - 6, y: ax.y + 1, z: ax.z1 + 4 }] : []);
const stockWith = (extra: Record<string, number>) => {
  for (const c of v.storage.chests) c.items = {};
  chest0.items = { cobblestone: 64, [`${v.wood ?? 'birch'}_log`]: 40, stick: 16, wheat_seeds: 40, wheat: 20, flint: 6, feather: 0, arrow: 0, ...extra };
};
// (every feasible option, not the shortlist a menu shows: which of them it shows depends on temperaments)
const feasible = (a: Any) => (w.isIdleMember(v, a, Date.now()) ? w.menu(v, a, w.heldKeys(v, Date.now(), 'sweep'), true, w.sweepFacts(v, Date.now(), a)).feasible : []);
const menus = () => { mute(); clock += 20 * 60000; const r = (w.factsCache.clear(), agents).map(feasible); unmute(); return r.flat(); };
const has = (ms: Any[], id: string) => ms.find((o: Any) => o.id === id);
const setPen = (n: number, extra: Any = {}) => {
  chick.pen.animals = n;
  delete chick.pen.restocking;
  chick.pen.workAt = {};
  Object.assign(chick.pen, extra);
};

stockWith({});
setPen(6);
const C1 = menus();
const enl = has(C1, `penwork:${jc}:enlarge`), breed = has(C1, `penwork:${jc}:breed`);
const cap = F.penCap('chicken', chick);
if (OFF) {
  ok(!enl, 'flag off: an enlargement offered');
  ok(!breed || breed.rank >= 500, `flag off: breeding ranked ${breed?.rank}`);
} else {
  ok(enl, `C: the 3x5 chicken pen (6 of ${cap}) is not offered its enlargement`);
}
// (enlarged: the cap doubles; plucking keeps half)
if (!OFF) {
  Object.assign(chick, F.enlargedSlot(chick, ax));
  const cap2 = F.penCap('chicken', chick);
  ok(cap2 >= 2 * cap, `C: enlarged, the chicken cap ${cap} -> ${cap2}`);
  setPen(cap);
  const br = has(menus(), `penwork:${jc}:breed`);
  ok(br && br.rank < 400, `C: breeding ${cap} of ${cap2} ranked ${br?.rank} (not above the wall's 400)`);
  setPen(cap, { youngUntil: clock + 60 * 60000 });
  ok(!has(menus(), `penwork:${jc}:breed`), 'C: breeding offered while the young in the pen grow up');
  delete chick.pen.youngUntil;
  setPen(Math.ceil(cap2 / 2) - 1);
  ok(!has(menus(), `penwork:${jc}:feathers`), `C: feathers plucked from a pen below half its cap (${chick.pen.animals} of ${cap2})`);
  setPen(cap2 - 1, { restocking: true });
  ok(!has(menus(), `penwork:${jc}:feathers`), 'C: feathers plucked from a pen still restocking');
  setPen(cap2 - 1);
  ok(has(menus(), `penwork:${jc}:feathers`), `C: no feathers from a full pen not restocking (${cap2 - 1} of ${cap2})`);
  setPen(Math.ceil(cap2 / 2) - 1);
  stockWith({ wheat_seeds: 0 });
  ok(has(menus(), 'penfeed'), 'C: no seeds gathered for a chicken pen short of them');
}
// (a pen of 2 with eggs stored; an emptied one)
stockWith({ egg: 12 });
setPen(2);
const C2 = menus();
if (OFF) ok(!has(C2, `penwork:${jc}:hatch`), 'flag off: hatching offered');
else ok(has(C2, `penwork:${jc}:hatch`), 'C: a chicken pen of 2 with 12 eggs stored is not offered hatching');
setPen(0);
const C3 = menus();
if (OFF) ok(!C3.some((o: Any) => o.id.startsWith(`penwork:${jc}:`)), 'flag off: work offered at an empty pen');
else {
  ok(has(C3, `penwork:${jc}:hatch`), 'C: an emptied chicken pen is not offered hatching');
  ok(!C3.some((o: Any) => o.id.startsWith(`penwork:${jc}:`) && !o.id.endsWith(':hatch')), `C: other work at an empty pen (${C3.filter((o: Any) => o.id.startsWith(`penwork:${jc}:`)).map((o: Any) => o.id)})`);
}
// (3 chickens: led in again)
setPen(3);
const C4 = menus();
const lead = has(C4, 'pen:chicken');
if (OFF) ok(!lead, 'flag off: chickens led into a pen of 3');
else ok(lead && lead.rank < 400 && /again/.test(lead.name), `C: chickens seen not led into the pen of 3 again (${lead ? `${lead.name}, rank ${lead.rank}` : 'none'})`);

quiet.log(`  ${OFF ? 'flag off' : 'flag on'}: enlarge ${enl ? `rank ${enl.rank}` : 'none'}; breed ${breed ? `rank ${breed.rank}` : 'none'}; lead-in at 3 ${lead ? `rank ${lead.rank}` : 'none'}`);
if (!OFF) {
  const out = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/checks/pens_big.mts', cpDir], { env: { ...process.env, PENS_CHILD: 'off' }, encoding: 'utf8' });
  const tail = out.trim().split('\n');
  quiet.log(tail.slice(-2).join('\n'));
  ok(/PASS/.test(tail[tail.length - 1]), 'the flag-off run failed');
}
quiet.log(`${failures ? 'FAIL' : 'PASS'}: ${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
