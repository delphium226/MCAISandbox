/**
 * The chore picker against a golden dump (A.2's no-behaviour-change check, spec runs/2026-10-12/spec_a2.md 4.2-4.4; no
 * server). Frozen copies of villages.json (runs/2026-10-12/golden_inputs/, checked against its SHA256SUMS) are loaded
 * into a real MineflayerWorld on a scratch folder, one world a fixture, with the clock frozen at 2026-10-12T12:00:00Z,
 * RCON stubbed (commands recorded), console.log muted and the registry's save() counted, never written. Each complete
 * village is a base; each base gets 16 variants (0 as recorded, 1-3 set profiles, 4-15 seeded: annex, farm slots and
 * pens, storage, the mine's iron, the explore ring, the wheat field; variant 15 is not complete), and each variant runs
 * with three idle sets ({Worker1}, {Mayor, Worker1-2}, {Mayor, Worker1-24}). The agents are fakes (enqueue records the
 * call; idle while none of its own actions is queued or running) sharing a fake bot.world whose columns hold the
 * variant's crops (stateAt's column shape, mcUtil.ts); the atlas's sightings, animalSightings and known are replaced by
 * seeded functions of the variant (a snapshot input with a sibling X.atlas.json uses the real atlas on its chunks and
 * animals for variant 0).
 * Per fixture: S1 a sweep (farmCheckAt = 0, then farmChores()); every queued action done, endChoices(), the clock 31 s on,
 * S2; half the queued actions failed ('x failed') and the rest done, endChoices(), 11 s on, S3 (farmCheckAt is set to 0
 * before every sweep, so each one runs). Recorded after each sweep: the enqueue calls, the chores (agent -> key), the
 * [choice] records as (agent, key, kind, what) and the [choice-end] records' (agent, ok, cut, message), the notes, the
 * RCON commands, slotSkip and cakeAt, and the village record normalised as spec 4.4 (explore done = 8 points visited,
 * the explore note dropped; annex.tries, annex.penBy and mine.ironTries as effective values), as a readable view of the
 * chore fields plus a hash per top-level key.
 * `check` also runs the purity check (4.3) once the world has choices(): 1,000 choices() calls a fixture after S1, round
 * robin over its agents, must change nothing. `instances` (4.4, needs A.2's world) runs the fixtures with
 * MC_CHOICE_INSTANCES=explore,start and checks invariants instead of the sequence.
 * S.9 (runs/2026-10-14/spec_s9.md 8.1): `dump` and `check` run with MC_CHOICE_FAMILIES empty (no workshop option or
 * reason, so the golden of the commit before stays the reference), `instances` with make,gather,works on: its fixtures
 * also get workshop storage, a hut with stations where none, a works plot beside a ready annex (0-3 furnaces recorded,
 * each furnace's block in the land) and sand unavailable in a quarter, from a second generator; and the workshop's
 * invariants are checked per sweep (crafting makes at most MAKE_PARALLEL, one make a furnace and only recorded ones, the
 * earmarks within the spare storage, none left once every chore ended, makes only below target, gathering within its
 * need and limits, works furnaces only on a ready plot, one option a good and a material a menu).
 * B.4 (runs/2026-10-15/spec_b4.md 7.1): `instances` also runs the light family: its fixtures get a torch stock (0, 8 or 40,
 * from a third generator) and a light record (absent, half the spots done, or all done with some never), and the menus and
 * sweeps are checked for lighting (at most one option a part, none for a part with nothing unlit, each trip's torches
 * within min(unlit, LIGHT_MIN_TRIP)..min(unlit, LIGHT_TRIP) and a menu's within the spare torches, a light chore's earmark
 * its own torches, none left and no lightCarried once every chore ended; S.9's make check against makeTarget); the purity
 * snapshot holds lightBack and lightCarried (v.lights is in the registry).
 * Usage: node_modules/.bin/tsx scripts/checks/choice_golden.mts dump|check|instances GOLDEN.json [villages.json ...]
 * (BASES_MAX=30, PURITY_N=1000, ONLY=<substring of a fixture key>, VERBOSE=1)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [mode, golden, ...files] = process.argv.slice(2);
if (!/^(dump|check|instances)$/.test(mode ?? '') || !golden) {
  console.log('usage: choice_golden.mts dump|check|instances GOLDEN.json [villages.json ...]');
  process.exit(2);
}
// (read when the world's modules load: set first)
process.env.MC_CHOOSE = 'fixed';
process.env.MC_CHOICE_INSTANCES = mode === 'instances' ? 'explore,start' : '';
// (S.9's families off for the golden, on for the instances' invariants, D3)
process.env.MC_CHOICE_FAMILIES = mode === 'instances' ? 'make,gather,works,light' : '';
process.env.MC_TIME_SCALE = '1';
// (A.3p: temperaments on by default since s33; the golden is of the picker without them, so off unless set, as
// instances mode may with MCAI_TEMPERAMENT=on)
process.env.MCAI_TEMPERAMENT ??= 'off';
// (spec_vote1: the style vote off, so growth picks as before; the vote has its own checks)
process.env.MC_VOTE = 'off';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'choice-golden-'));
const CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
process.env.MCAI_CHOICE_LOG = CHOICE_LOG;

const NOW = Date.parse('2026-10-12T12:00:00Z');
const MIN = 60000;
let clock = NOW;
Date.now = () => clock;
// (the code under test must not draw random numbers: a seeded stand-in, its calls counted and reported)
let randomCalls = 0;
let randomState = 1;
Math.random = () => {
  randomCalls++;
  randomState = (Math.imul(randomState, 1103515245) + 12345) >>> 0;
  return randomState / 4294967296;
};

const BASES_MAX = Number(process.env.BASES_MAX ?? 30);
// (instances mode runs the purity check too, with the workshop's families on, on fewer calls)
const PURITY_N = Number(process.env.PURITY_N ?? (mode === 'instances' ? 200 : 1000));
const ONLY = process.env.ONLY ?? '';
const VERBOSE = !!process.env.VERBOSE;
const VARIANTS = 16;
const IDLE_SETS: Array<[string, string[]]> = [
  ['w1', ['Worker1']],
  ['w2m', ['Mayor', 'Worker1', 'Worker2']],
  ['w24m', ['Mayor', ...Array.from({ length: 24 }, (_, i) => `Worker${i + 1}`)]],
];

const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const errors: string[] = [];
function mute() {
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.error = (...a: unknown[]) => errors.push(a.map(String).join(' ').slice(0, 300));
}
function unmute() {
  Object.assign(console, quiet);
}
const say = (s: string) => quiet.log(s);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const { SLOT_ORDER, PEN_ORDER, slotPlan, annexSlots, penPlan, SLOT_KINDS, worksFurnaces } = await import('../../server/src/farmSlots');
const { FARM_TRIP_RANGE } = await import('../../server/src/village');
const { collectFilter } = await import('../../server/src/mineflayer/mcSurvival');
const { storageContents } = await import('../../server/src/mineflayer/mcStorage');
const W9 = await import('../../server/src/mineflayer/mcWorkshop');
// (A.2's chooser, once it exists: instances mode compares its menus with single keys and with instances)
let CHOOSE: { instances: Set<string> } | null = null;
// (A.3p: the fixed pick, which weighs temperaments when MCAI_TEMPERAMENT is on; the lowest rank otherwise)
let FIXED_PICK: ((menu: Any) => Any) | null = null;
try {
  const C = (await import(new URL('../../server/src/choose.ts', import.meta.url).href)) as Any;
  CHOOSE = C.CHOOSE ?? null;
  FIXED_PICK = C.fixedPick ?? null;
} catch {
  CHOOSE = null;
}

// ---- inputs ----------------------------------------------------------------------------------------------------------

const INPUT_DIR = 'runs/2026-10-12/golden_inputs';
const sources = (files.length ? files : ['villages_main.json', 'villages_test.json'].map((f) => path.join(INPUT_DIR, f)).filter((f) => fs.existsSync(f)))
  .filter((f) => !f.endsWith('.atlas.json'))
  .map((f) => f.replace(/\\/g, '/'));
if (!sources.length) {
  say(`no inputs: copy villages.json into ${INPUT_DIR} first`);
  process.exit(2);
}
const sha256 = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const inputs: Array<{ path: string; sha256: string }> = [];
for (const src of sources) {
  const h = sha256(src);
  // (a copy listed in its folder's SHA256SUMS must still match it)
  const sums = path.join(path.dirname(src), 'SHA256SUMS');
  if (fs.existsSync(sums)) {
    const line = fs.readFileSync(sums, 'utf8').split(/\r?\n/).map((l) => /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l.trim())).find((m) => m && path.basename(m[2]) === path.basename(src));
    if (line && line[1] !== h) {
      say(`REFUSED: ${src} has sha256 ${h}, SHA256SUMS says ${line[1]}`);
      process.exit(2);
    }
    if (!line) say(`note: ${src} is not listed in ${sums}`);
  }
  inputs.push({ path: src, sha256: h });
}
say(`inputs: ${inputs.map((i) => `${i.path} (${i.sha256.slice(0, 12)})`).join(', ')}`);

// ---- seeded numbers --------------------------------------------------------------------------------------------------

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function rng(seed: string) {
  let a = fnv(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)], chance: (p: number) => next() < p };
}
const hash = (x: unknown) => crypto.createHash('sha1').update(JSON.stringify(x) ?? 'undefined').digest('hex').slice(0, 16);

// ---- variants --------------------------------------------------------------------------------------------------------

/** The land a variant's agents see: crop states by "x,y,z", unloaded chunks by "cx,cz", sightings, eggs in pens. */
interface Land {
  crops: Map<string, number>;
  unloaded: Set<string>;
  plants: Array<{ kind: string; x: number; y: number; z: number; n: number }>;
  animals: Array<{ kind: string; x: number; y: number; z: number; t: number }>;
  eggs: Array<{ x: number; y: number; z: number }>;
  knownSeed: string;
  /** Snapshot atlas (variant 0 of a snapshot input): the real atlas runs on these. */
  atlas?: { chunks: Any[]; animals: Any[]; t?: number };
  home: { x: number; y: number; z: number };
}

interface Variant {
  v: Any;
  land: Land;
  profile: string;
}

const AIR = 0;

function stateOf(reg: Any, block: string, offset: number) {
  const b = reg.blocksByName[block];
  return b ? Math.min(b.maxStateId, b.minStateId + offset) : AIR;
}

function makeVariant(reg: Any, base: Any, i: number, seed: string, atlasFile: Any): Variant | null {
  const v = JSON.parse(JSON.stringify(base));
  const R = rng(`${seed}#${i}`);
  const plot0 = v.plots.find((p: Any) => !p.annex);
  if (!plot0) return null;
  const land: Land = { crops: new Map(), unloaded: new Set(), plants: [], animals: [], eggs: [], knownSeed: `${seed}#${i}`, home: { x: 0, y: plot0.y + 1, z: 0 } };
  const chest0 = v.storage?.chests?.[0];
  const lay0 = v.layouts?.[0] ?? plot0;
  land.home = chest0 ? { x: chest0.x, y: chest0.y, z: chest0.z } : { x: Math.floor((lay0.x1 + lay0.x2) / 2), y: plot0.y + 1, z: Math.floor((lay0.z1 + lay0.z2) / 2) };
  const ago = (m: number) => NOW - m * MIN;
  const set = (x: number, y: number, z: number, st: number) => land.crops.set(`${x},${y},${z}`, st);

  // Crops as recorded (variant 0, and the fields a profile leaves alone): every planted cell ripe
  const ripenRecorded = () => {
    for (const lay of v.layouts ?? []) {
      const plot = v.plots.find((p: Any) => lay.farm && lay.farm.x1 >= p.x1 && lay.farm.x2 <= p.x2 && lay.farm.z1 >= p.z1 && lay.farm.z2 <= p.z2);
      if (lay.farm?.planted && plot) for (const [x, z] of lay.farm.sow) set(x, plot.y + 1, z, stateOf(reg, 'wheat', 7));
      for (const s of lay.slots ?? []) {
        const spec = s.kind ? SLOT_KINDS[s.kind] : undefined;
        const p = v.plots.find((q: Any) => s.x1 >= q.x1 && s.x2 <= q.x2 && s.z1 >= q.z1 && s.z2 <= q.z2);
        if (!spec || !s.planted || !p) continue;
        const y = p.y + 1;
        if (spec.ripe !== undefined) for (const [x, z] of s.cells ?? []) set(x, y, z, stateOf(reg, spec.block, spec.ripe));
        else if (spec.fruit) for (const [x, z] of s.fruit ?? []) set(x, y, z, stateOf(reg, spec.fruit, 0));
        else for (const [x, z] of s.cells ?? []) set(x, y + 1, z, stateOf(reg, 'sugar_cane', 0));
      }
    }
  };

  const seedSightings = () => {
    const home = land.home;
    for (const kind of SLOT_ORDER)
      for (let k = R.pick([0, 0, 1, 2]); k > 0; k--) {
        const d = R.pick([25, 60, 110, 150, 175, 230]) + Math.floor(R.next() * 5), t = R.next() * 2 * Math.PI;
        land.plants.push({ kind, x: Math.round(home.x + d * Math.cos(t)), y: plot0.y + R.pick([-20, -2, 0, 1, 3]), z: Math.round(home.z + d * Math.sin(t)), n: R.pick([1, 2, 3, 5]) });
      }
    // (one on the plot itself now and then: collect's filter turns it down)
    if (R.chance(0.15)) land.plants.push({ kind: R.pick(SLOT_ORDER), x: Math.floor((plot0.x1 + plot0.x2) / 2), y: plot0.y + 1, z: Math.floor((plot0.z1 + plot0.z2) / 2), n: 3 });
  };
  const seedAnimals = (centre: { x: number; z: number }, y: number) => {
    for (const kind of PEN_ORDER)
      for (let k = R.pick([0, 1, 2, 3]); k > 0; k--) {
        const d = R.pick([8, 30, 60, 90, 110]), t = R.next() * 2 * Math.PI;
        land.animals.push({ kind, x: centre.x + d * Math.cos(t), y: y + R.pick([-6, -3, 0, 2, 6, 9]), z: centre.z + d * Math.sin(t), t: ago(R.pick([1, 10, 25, 40])) });
      }
    if (R.chance(0.15)) land.animals.push({ kind: R.pick(PEN_ORDER), x: (plot0.x1 + plot0.x2) / 2, y, z: (plot0.z1 + plot0.z2) / 2, t: ago(2) });
  };

  if (i === 0) {
    ripenRecorded();
    if (atlasFile) land.atlas = atlasFile;
    else {
      seedSightings();
      const ax = v.layouts?.[0]?.annex;
      seedAnimals(ax ? { x: (ax.x1 + ax.x2) / 2, z: (ax.z1 + ax.z2) / 2 } : land.home, (ax?.y ?? plot0.y) + 1);
    }
    return { v, land, profile: 'as recorded' };
  }

  const profile = i === 1 ? 'fresh' : i === 2 ? 'pens' : i === 3 ? 'late' : i === 15 ? 'incomplete' : 'seeded';
  if (profile === 'incomplete') v.complete = false;
  // ---- ground: layout 0, and the fields (the wheat field and two farm slots) in its plot or in a plot added beside it
  v.layouts ??= [];
  if (!v.layouts[0]) v.layouts[0] = { x1: plot0.x1, z1: plot0.z1, x2: plot0.x2, z2: plot0.z2, buildings: [] };
  const lay = v.layouts[0];
  const plotSlots0 = (lay.slots ?? []).filter((s: Any) => !s.annex);
  let fieldPlot = plot0;
  let fx = plot0.x1 + 1;
  const fz0 = () => fieldPlot.z1 + 1;
  if (!lay.farm || plotSlots0.length < 2) {
    if (plot0.x2 - plot0.x1 + 1 < 19 || plot0.z2 - plot0.z1 + 1 < 9) {
      fieldPlot = { id: 'golden-fields', x1: plot0.x1, z1: plot0.z2 + 4, x2: plot0.x1 + 18, z2: plot0.z2 + 12, y: plot0.y, preparedBy: 'golden' };
      v.plots.push(fieldPlot);
      fx = fieldPlot.x1 + 1;
    }
  }
  const spot = (x: number) => ({ x1: x, z1: fz0(), x2: x + 4, z2: fz0() + 6, water: { x1: x + 2, x2: x + 2, z1: fz0(), z2: fz0() + 6 }, sow: [] as Array<[number, number]> });
  const plotOf = (a: Any) => v.plots.find((p: Any) => a.x1 >= p.x1 && a.x2 <= p.x2 && a.z1 >= p.z1 && a.z2 <= p.z2);
  // The wheat field
  if (!lay.farm) {
    const f = spot(fx);
    f.sow = slotPlan(f, 'carrots').cells;
    lay.farm = f;
  }
  const farm = lay.farm;
  farm.planted = profile === 'fresh' || profile === 'late' ? farm.sow.length : R.pick([0, farm.sow.length, farm.sow.length]);
  delete farm.lastHarvest;
  const fh = profile === 'fresh' ? undefined : R.pick([undefined, undefined, { at: ago(1), ok: false, why: 'nothing ripe' }, { at: ago(5), ok: false, why: 'x' }, { at: ago(15), ok: false, why: 'x' }, { at: ago(3), ok: true }]);
  if (fh) farm.lastHarvest = fh;
  const fplot = plotOf(farm);
  const wheatRipe = profile === 'fresh' ? 'ripe' : R.pick(['ripe', 'most', 'half', 'none']);
  if (fplot && farm.planted)
    farm.sow.forEach(([x, z]: [number, number], n: number) => {
      const ripe = wheatRipe === 'ripe' || (wheatRipe === 'most' && n < 13) || (wheatRipe === 'half' && n % 2 === 0);
      set(x, fplot.y + 1, z, stateOf(reg, 'wheat', ripe ? 7 : 2));
    });
  if (R.chance(0.1) && farm.sow.length) land.unloaded.add(`${farm.sow[0][0] >> 4},${farm.sow[0][1] >> 4}`);

  // Two farm slots on the plot
  const plotSlots: Any[] = plotSlots0.length >= 2 ? plotSlots0.slice(0, 2) : [spot(fx + 6), spot(fx + 12)];
  const slotState = (k: number) => (profile === 'fresh' ? 'free' : profile === 'late' ? 'planted' : profile === 'pens' ? (k ? 'free' : 'planted') : R.pick(['free', 'free', 'planted', 'laying', 'tried']));
  const slots: Any[] = plotSlots.map((g: Any, k: number) => {
    const s: Any = { x1: g.x1, z1: g.z1, x2: g.x2, z2: g.z2, water: g.water, sow: g.sow ?? [] };
    const st = slotState(k);
    const sp = plotOf(s);
    if (st === 'tried') {
      s.tries = R.pick([1, 2, 3]);
      s.lastTry = { at: ago(R.pick([5, 30, 70])), kind: R.pick(SLOT_ORDER), why: 'x' };
    }
    if (st === 'planted' || st === 'laying') {
      const kind = profile === 'late' ? SLOT_ORDER[k] : R.pick(SLOT_ORDER);
      const plan = slotPlan(s, kind);
      s.kind = kind;
      s.cells = plan.cells;
      if (plan.fruit.length && SLOT_KINDS[kind].fruit) s.fruit = plan.fruit;
      if (st === 'laying') {
        s.laying = true;
        if (R.chance(0.5)) s.planted = plan.cells.length;
      } else s.planted = plan.cells.length;
      if (s.planted && R.chance(0.3)) s.lastHarvest = R.pick([{ at: ago(1), ok: false, why: 'nothing ripe' }, { at: ago(5), ok: false, why: 'x' }, { at: ago(20), ok: true }]);
      const spec = SLOT_KINDS[kind];
      const ripe = profile === 'late' ? 'ripe' : R.pick(['ripe', 'few', 'none']);
      if (sp && s.planted) {
        const y = sp.y + 1;
        if (spec.ripe !== undefined) s.cells.forEach(([x, z]: [number, number], n: number) => set(x, y, z, stateOf(reg, spec.block, ripe === 'ripe' || (ripe === 'few' && n < 3) ? spec.ripe! : 1)));
        else if (spec.fruit) (s.fruit ?? []).slice(0, ripe === 'ripe' ? 6 : ripe === 'few' ? 1 : 0).forEach(([x, z]: [number, number]) => set(x, y, z, stateOf(reg, spec.fruit!, 0)));
        else s.cells.slice(0, ripe === 'ripe' ? 8 : ripe === 'few' ? 1 : 0).forEach(([x, z]: [number, number]) => set(x, y + 1, z, stateOf(reg, 'sugar_cane', 0)));
      }
    }
    return s;
  });

  // ---- the annex: none, being prepared (tries and their back-off) or ready with its two pen slots
  const annexState = profile === 'fresh' ? 'none' : profile === 'pens' || profile === 'late' ? 'ready' : R.pick(['none', 'none', 'preparing', 'ready', 'ready', 'ready']);
  v.plots = v.plots.filter((p: Any) => !p.annex);
  const oldAx = lay.annex;
  const area = oldAx ? { x1: oldAx.x1, z1: oldAx.z1, x2: oldAx.x2, z2: oldAx.z2, side: oldAx.side ?? 'n' } : { x1: plot0.x1, x2: plot0.x1 + 12, z1: plot0.z1 - 3 - 8, z2: plot0.z1 - 3, side: 'n' };
  const axY = oldAx?.y ?? plot0.y;
  delete lay.annex;
  if (annexState === 'preparing') {
    lay.annex = { ...area, y: axY, state: 'preparing' };
    const t = R.pick([0, 1, 2, 3]);
    if (t) lay.annex.tries = t;
    lay.annex.lastTry = { at: ago(R.pick([5, 30, 70])), why: 'x' };
  }
  if (annexState === 'ready') {
    lay.annex = { ...area, y: axY, state: 'ready' };
    if (profile === 'late') {
      lay.annex.tries = 2;
      lay.annex.lastTry = { at: ago(70), why: 'x' };
    }
    if (profile === 'seeded' && R.chance(0.4)) {
      lay.annex.penBy = {};
      for (const kind of PEN_ORDER) if (R.chance(0.6)) lay.annex.penBy[kind] = { tries: R.pick([1, 2, 3]), at: ago(R.pick([5, 30, 70])), why: 'x' };
    }
    v.plots.push({ id: 'golden-annex', x1: area.x1, z1: area.z1, x2: area.x2, z2: area.z2, y: axY, preparedBy: 'golden', annex: true });
    const oldPens = (lay.slots ?? []).filter((s: Any) => s.annex);
    const geo: Any[] = oldPens.length >= 2 ? oldPens.slice(0, 2) : annexSlots(area as Any);
    geo.forEach((g: Any, k: number) => {
      const s: Any = { x1: g.x1, z1: g.z1, x2: g.x2, z2: g.z2, water: g.water, sow: [], annex: true, face: g.face ?? 's' };
      const kind = profile === 'pens' ? (k ? 'cow' : 'chicken') : profile === 'late' ? (k ? 'cow' : 'chicken') : R.pick(['free', 'chicken', 'cow', 'chicken']);
      if (kind !== 'free') {
        const P = penPlan(s, s.face);
        s.kind = kind;
        const workAt: Record<string, number> = {};
        if (profile === 'seeded') for (const w of ['eggs', 'milk', 'breed']) { const m = R.pick([undefined, 0.5, 3, 10]); if (m !== undefined) workAt[w] = ago(m); }
        s.pen = { gate: P.gate, facing: P.facing, built: profile !== 'seeded' || R.chance(0.85), animals: profile === 'pens' ? 3 : profile === 'late' ? 2 : R.pick([0, 1, 2, 3, 5]), workAt };
        if (profile === 'seeded' && R.chance(0.1)) s.laying = true;
        if (kind === 'chicken' && (profile === 'pens' || (profile === 'seeded' && R.chance(0.5)))) land.eggs.push({ x: P.inner.x1 + 0.5, y: axY + 1, z: P.inner.z1 + 0.5 });
      }
      slots.push(s);
    });
  }
  lay.slots = slots;

  // ---- storage: one chest holding the variant's items (any others emptied)
  const items: Record<string, number> = {};
  const put = (n: string, q: number) => { if (q) items[n] = q; };
  if (profile === 'pens') {
    put('wheat', 20); put('wheat_seeds', 10); put('bucket', 2); put('milk_bucket', 1); put('egg', 1); put('sugar_cane', 2);
  } else if (profile === 'fresh') {
    put('wheat_seeds', 4);
  } else {
    put('raw_iron', R.pick([0, 3, 6]));
    put('wheat', R.pick([0, 5, 20]));
    put('bucket', R.pick([0, 1, 2, 3]));
    put('milk_bucket', R.pick([0, 1, 2, 3]));
    put('egg', R.pick([0, 1, 2]));
    put('sugar_cane', R.pick([0, 2, 4]));
    put('cake', R.pick([0, 1, 2]));
    put('wheat_seeds', R.pick([0, 4, 10]));
  }
  if (!v.storage?.chests?.length) v.storage = { chests: [{ x: land.home.x, y: land.home.y, z: land.home.z, items: {} }], updated: NOW };
  for (const c of v.storage.chests) c.items = {};
  v.storage.chests[0].items = items;

  // ---- the mine's iron
  if (R.chance(0.75) || profile === 'late') {
    v.mine ??= { hut: { x1: plot0.x2 + 3, z1: plot0.z1, x2: plot0.x2 + 7, z2: plot0.z1 + 4 }, top: { x: plot0.x2 + 5, z: plot0.z1 + 2 }, dir: [1, 0], steps: 12, dug: 0, ended: [], got: {} };
    v.mine.level ??= plot0.y - 12;
    delete v.mine.ironTries;
    delete v.mine.ironLastTry;
    delete v.mine.iron;
    v.mine.ironMade = profile === 'late' ? ['iron_pickaxe', 'bucket'] : R.pick([[], [], ['iron_pickaxe'], ['iron_pickaxe', 'bucket']]);
    const tries = profile === 'seeded' ? R.pick([undefined, { dig: 1 }, { dig: 3 }, { iron_pickaxe: 2 }, { bucket: 3 }]) : undefined;
    if (tries) {
      v.mine.ironTries = tries;
      v.mine.ironLastTry = { at: ago(R.pick([5, 30, 70])), stage: R.pick(['dig', 'iron_pickaxe', 'bucket']), why: 'x' };
    }
    if (R.chance(0.3)) v.mine.iron = { x: v.mine.top.x, z: v.mine.top.z, y: v.mine.level, dir: [1, 0], steps: 0, legs: [], dug: 0, got: {}, ...(R.chance(0.5) ? { finished: 'no more iron' } : {}) };
  } else if (v.mine) delete v.mine.level;

  // ---- the explore ring
  delete v.explore;
  const ex = profile === 'fresh' ? 'absent' : profile === 'late' ? 'all' : R.pick(['absent', 'some', 'some', 'all', 'done']);
  if (ex !== 'absent') {
    const order = [0, 1, 2, 3, 4, 5, 6, 7].sort((a, b) => fnv(`${seed}#${i}|${a}`) - fnv(`${seed}#${i}|${b}`));
    const visited = ex === 'all' ? order : order.filter(() => R.chance(0.4));
    v.explore = { visited };
    if (ex === 'done') v.explore.done = true;
    if (visited.length) v.explore.last = `Worker1 to ${land.home.x},${land.home.z}`;
  }

  // ---- sightings
  seedSightings();
  const ax = lay.annex;
  seedAnimals(ax ? { x: (ax.x1 + ax.x2) / 2, z: (ax.z1 + ax.z2) / 2 } : land.home, (ax?.y ?? plot0.y) + 1);
  if (profile === 'pens') land.animals.push({ kind: 'chicken', x: area.x1 - 10, y: axY + 1, z: area.z1 - 10, t: ago(2) }, { kind: 'cow', x: area.x2 + 12, y: axY + 1, z: area.z1, t: ago(2) });
  if (profile === 'fresh') land.plants.push({ kind: 'pumpkin', x: land.home.x + 70, y: plot0.y + 1, z: land.home.z, n: 1 }, { kind: 'sugar_cane', x: land.home.x, y: plot0.y, z: land.home.z + 90, n: 3 });
  // (a failed sighting on a slot, now and then: the start skips it)
  for (const s of slots) if (!s.annex && R.chance(0.15) && land.plants.length) { const p = R.pick(land.plants); s.bad = [`${p.kind}@${p.x},${p.z}`]; }
  return { v, land, profile };
}

/**
 * Instances mode's S.9 additions to a variant (spec 8.1 item 4), from their own generator so the rest of the variant is
 * as in the golden: workshop storage (cobblestone, the village's logs, sand, coal, oak slabs, charcoal, glass, stone
 * pickaxes), a 7x9 hut with station records where the village has none, a works plot beside a ready annex (absent,
 * preparing or ready with 0-3 furnaces recorded, each furnace's block written into the land: the fakes read AIR
 * otherwise, the check's M7) and sand unavailable in a quarter of them.
 */
function seedWorkshop(reg: Any, variant: Variant, key: string) {
  const { v, land } = variant;
  const R = rng(`${key}:s9`);
  const ago = (m: number) => NOW - m * MIN;
  const plot0 = v.plots.find((p: Any) => !p.annex && !p.works);
  const wood = v.wood ?? 'oak';
  const items = v.storage?.chests?.[0]?.items;
  if (items) {
    const put = (n: string, q: number) => { if (q) items[n] = (items[n] ?? 0) + q; };
    put('cobblestone', R.pick([0, 20, 200]));
    put(`${wood}_log`, R.pick([0, 12, 60]));
    put('sand', R.pick([0, 6, 30]));
    put('coal', R.pick([0, 4]));
    put('oak_slab', R.pick([0, 7, 14]));
    put('charcoal', R.pick([0, 8]));
    put('glass', R.pick([0, 3]));
    put('stone_pickaxe', R.pick([0, 1, 4]));
  }
  if (!v.storageHut && plot0) {
    const x1 = plot0.x1 + 1, z1 = plot0.z1 + 1;
    v.storageHut = { x1, z1, x2: x1 + 6, z2: z1 + 8, spots: [] };
    const y = plot0.y + 1;
    v.stations = { crafting_table: { x: x1 + 2, y, z: z1 + 4, by: 'golden', at: ago(60) }, furnace: { x: x1 + 4, y, z: z1 + 4, by: 'golden', at: ago(60) } };
  }
  if (R.chance(0.25)) v.unavailable = [...new Set([...(v.unavailable ?? []), 'sand'])];
  // (B.4's torch stock, from its own generator so S.9's seeding stays as it was)
  if (items) {
    const t = rng(`${key}:b4`).pick([0, 8, 40]);
    if (t) items.torch = (items.torch ?? 0) + t;
  }
  const lay = v.layouts?.[0];
  const ax = lay?.annex;
  if (!ax || ax.state !== 'ready') return;
  const state = R.pick(['absent', 'absent', 'preparing', 'ready', 'ready', 'ready']);
  if (state === 'absent') return;
  // (beside the annex along the plot's edge, the annex's geometry and side)
  const along = ax.side === 'n' || ax.side === 's';
  const area = along ? { x1: ax.x2 + 3, x2: ax.x2 + 15, z1: ax.z1, z2: ax.z2 } : { x1: ax.x1, x2: ax.x2, z1: ax.z2 + 3, z2: ax.z2 + 15 };
  lay.works = { ...area, y: ax.y, side: ax.side, state };
  if (state === 'preparing') {
    const t = R.pick([0, 1, 2, 3]);
    if (t) lay.works.tries = t;
    lay.works.lastTry = { at: ago(R.pick([5, 30, 70])), why: 'x' };
    return;
  }
  v.plots.push({ id: 'golden-works', ...area, y: ax.y, preparedBy: 'golden', works: true });
  const n = R.pick([0, 1, 2, 3]);
  const ks = [1, 2, 3].sort(() => R.next() - 0.5).slice(0, n);
  const cells = worksFurnaces(lay.works);
  const furnaces: Any[] = [null, null, null];
  for (const k of ks) {
    const c = cells[k - 1];
    furnaces[k - 1] = { x: c.x, y: ax.y + 1, z: c.z, by: 'golden', at: ago(20) };
    land.crops.set(`${c.x},${ax.y + 1},${c.z}`, stateOf(reg, 'furnace', 0));
  }
  while (furnaces.length && !furnaces[furnaces.length - 1]) furnaces.pop();
  if (furnaces.length) lay.works.furnaces = furnaces;
}

// ---- fixtures --------------------------------------------------------------------------------------------------------

interface Sweep {
  error?: string;
  calls: Array<[string, string, unknown]>;
  chores: Array<[string, string]>;
  choices: Array<[string, string, string, string]>;
  ends: Array<[string, boolean, boolean, string]>;
  notes: string[];
  rcon: string[];
  slotSkip: Array<[string, number]>;
  cakeAt: Array<[string, number]>;
  view: unknown;
  hashes: Record<string, string>;
}

/** The village record as compared (spec 4.4): explore's done as "8 points visited", the explore note dropped, and the
 *  three forgiveness fields as their effective values. */
function normalise(v: Any, now: number): Any {
  const n = JSON.parse(JSON.stringify(v));
  if (n.explore) {
    const done = !!n.explore.done || (n.explore.visited?.length ?? 0) >= 8;
    if (done) n.explore.done = true;
    else delete n.explore.done;
    if (!n.explore.visited?.length && !done && n.explore.last === undefined) delete n.explore;
  }
  n.log = (n.log ?? []).filter((l: string) => l !== 'explored all round the village');
  const ax = n.layouts?.[0]?.annex;
  if (ax?.tries && ax.lastTry && now - ax.lastTry.at > 60 * MIN) ax.tries = 0;
  if (ax?.penBy) for (const [k, by] of Object.entries(ax.penBy as Record<string, { at: number }>)) if (now - by.at > 60 * MIN) delete ax.penBy[k];
  const m = n.mine;
  if (m?.ironTries && m.ironLastTry && now - m.ironLastTry.at > 60 * MIN) m.ironTries = {};
  return n;
}

function view(n: Any) {
  return {
    complete: !!n.complete,
    explore: n.explore ?? null,
    layouts: (n.layouts ?? []).map((l: Any) => ({ farm: l.farm ? { planted: l.farm.planted, lastHarvest: l.farm.lastHarvest, harvests: l.farm.harvests } : null, slots: l.slots ?? null, annex: l.annex ?? null })),
    mine: n.mine ? { level: n.mine.level, ironMade: n.mine.ironMade, ironTries: n.mine.ironTries, ironLastTry: n.mine.ironLastTry, finished: n.mine.iron?.finished } : null,
    storage: (n.storage?.chests ?? []).map((c: Any) => c.items),
  };
}

interface Fixture {
  key: string;
  src: string;
  base: string;
  variant: number;
  idle: string;
}

let logOffset = 0;
function newLogRecords(): Any[] {
  let data = '';
  try {
    const buf = fs.readFileSync(CHOICE_LOG);
    data = buf.subarray(logOffset).toString('utf8');
    logOffset = buf.length;
  } catch {
    return [];
  }
  return data.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Instances mode's findings, by fixture. */
const invariantFails: string[] = [];
const extras: Record<string, Record<string, number>> = {};

async function runFixture(dir: string, fx: Fixture, variant: Variant, opts: { purity: boolean; instances: boolean }): Promise<{ sweeps: Sweep[]; purity?: string }> {
  clock = NOW;
  randomState = fnv(fx.key);
  const rconCmds: string[] = [];
  // (S.9's earmarks, leftovers and works under way are module state: each fixture starts without the last one's; with the
  // families off they stay empty)
  for (const k of [...W9.makeHolds.keys()]) W9.holdsDelete(k);
  W9.makeLeft.clear();
  W9.worksBusy.clear();
  W9.lightCarried.clear();
  const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async (c: string) => { rconCmds.push(c); return ''; } } as never, dir) as Any;
  const reg = w.villages as Any;
  let saves = 0;
  reg.save = () => { saves++; };
  const notes: string[] = [];
  const note = reg.note.bind(reg);
  reg.note = (v: Any, text: string) => { notes.push(`${v.name}: ${text}`); note(v, text); };
  // The variant in place of its base
  const v = variant.v;
  reg.villages.set(v.name.toLowerCase(), v);
  const land = variant.land;

  // The atlas
  if (land.atlas) {
    for (const s of land.atlas.chunks ?? []) w.atlas.chunks.set(`${s.cx},${s.cz}`, s);
    const shift = land.atlas.t ? NOW - land.atlas.t : 0;
    for (const s of land.atlas.animals ?? []) w.atlas.animals.set(s.id ?? `${s.kind}-${s.x},${s.z}`, { ...s, t: s.t + shift });
  } else {
    w.atlas.sightings = (kind: string, x: number, z: number, radius: number) =>
      land.plants.filter((p) => p.kind === kind && Math.hypot(p.x - x, p.z - z) <= radius).map((p) => [p.x, p.y, p.z, p.n])
        .sort((a, b) => Math.hypot(a[0] - x, a[2] - z) - Math.hypot(b[0] - x, b[2] - z));
    w.atlas.animalSightings = (kind: string, x: number, z: number, radius: number, maxAge: number, skip?: (x: number, z: number) => boolean) =>
      land.animals.map((s, k) => ({ ...s, id: `golden-${k}` }))
        .filter((s) => s.kind === kind && clock - s.t <= maxAge && Math.hypot(s.x - x, s.z - z) <= radius && !skip?.(Math.floor(s.x), Math.floor(s.z)))
        .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    w.atlas.known = (x: number, z: number, r: number) => (fnv(`${land.knownSeed}|${x >> 4},${z >> 4}|${r}`) % 21) / 20;
  }

  // The agents: fakes sharing one view of the land
  const sections = new Array(24).fill(null);
  const getColumn = (cx: number, cz: number) => land.unloaded.has(`${cx},${cz}`) ? null
    : { minY: -64, sections, getBlockStateId: (p: { x: number; y: number; z: number }) => land.crops.get(`${cx * 16 + p.x},${p.y},${cz * 16 + p.z}`) ?? AIR };
  const entities: Record<string, Any> = {};
  land.eggs.forEach((e, k) => { entities[`egg${k}`] = { name: 'item', position: { ...e } }; });
  const calls: Array<[string, string, unknown]> = [];
  const statuses: Any[] = [];
  let nextId = 1;
  const names = IDLE_SETS.find(([k]) => k === fx.idle)![1];
  const agents: Any[] = [];
  for (const name of names) {
    const own: Any[] = [];
    const memory = { village: v.name, villageRole: name === 'Mayor' ? 'mayor' : 'worker' };
    const a: Any = {
      name, role: memory.villageRole, memory, world: w,
      village: () => reg.get(memory.village),
      idle: () => !own.some((s) => s.state === 'queued' || s.state === 'running'),
      enqueue: (type: string, args: Record<string, unknown>) => {
        const s = { id: nextId++, type, args, state: 'queued' };
        own.push(s);
        statuses.push(s);
        calls.push([name, type, args]);
        return s;
      },
      bot: { entity: { position: { x: land.home.x + 0.5, y: land.home.y, z: land.home.z + 0.5 } }, entities, inventory: { items: () => [] }, world: { getColumn }, game: { minY: -64 } },
    };
    agents.push(a);
    w.agents.set(name.toLowerCase(), a);
  }

  // Instances mode: each pick checked against the menu at that moment
  const pickLog: Array<{ agent: string; id: string; kind: string }> = [];
  if (opts.instances) {
    const run = w.runChoice.bind(w);
    w.runChoice = (a: Any, id: string, meta: Any) => {
      const menu = w.choices(a);
      const opts1 = (menu?.options ?? []) as Any[];
      checkMenuS9(fx, w, v, a.name, opts1);
      checkMenuLight(fx, w, v, a.name, opts1);
      const lowest = menu && FIXED_PICK ? FIXED_PICK(menu) : [...opts1].sort((p, q) => p.rank - q.rank)[0];
      if (!opts1.some((o) => o.id === id)) invariantFails.push(`${fx.key}: ${a.name} ran ${id}, not in its fresh menu (${opts1.map((o) => o.id).join(', ')})`);
      else if (lowest && lowest.id !== id) invariantFails.push(`${fx.key}: ${a.name} ran ${id}, but its menu's fixed pick is ${lowest.id}`);
      // Options beyond single keys: only a second or later explore or start
      if (CHOOSE) {
        const inst = [...CHOOSE.instances];
        CHOOSE.instances.clear();
        const single = new Set(((w.choices(a)?.options ?? []) as Any[]).map((o) => o.id));
        for (const k of inst) CHOOSE.instances.add(k);
        for (const o of opts1) if (!single.has(o.id) && o.kind !== 'explore' && o.kind !== 'start') invariantFails.push(`${fx.key}: ${a.name}'s menu has ${o.id} (${o.kind}) only with instances`);
        const extra = opts1.filter((o) => !single.has(o.id));
        if (extra.length) for (const o of extra) ((extras[fx.key] ??= {})[o.kind] = (extras[fx.key][o.kind] ?? 0) + 1);
      }
      // The registry writes this option makes (spec 1.3): the log always; a pen's workAt; the explore ring
      const before = JSON.parse(JSON.stringify(v));
      const r = run(a, id, meta);
      const kind = id.split(':')[0];
      const allowed = [/^log(\.|$)/, ...(kind === 'penwork' ? [/^layouts\.0\.slots\.\d+\.pen\.workAt(\.|$)/] : []), ...(kind === 'explore' ? [/^explore(\.|$)/] : [])];
      for (const p of changedPaths(before, JSON.parse(JSON.stringify(v)))) if (!allowed.some((re) => re.test(p))) invariantFails.push(`${fx.key}: running ${id} wrote ${p}`);
      pickLog.push({ agent: a.name, id, kind });
      return r;
    };
  }

  // Instances mode: B.4's light record (absent, half the spots done, or all done with some never), from the parts as the
  // world sees them (lightParts is pure)
  if (opts.instances && typeof w.lightParts === 'function') {
    mute();
    try {
      seedLights(w, v, fx.key);
    } finally {
      unmute();
    }
  }
  const sweeps: Sweep[] = [];
  let purity: string | undefined;
  let rconAt = 0, callsAt = 0, notesAt = 0;
  const idOwner = new Map<string, string>();
  const sweep = async () => {
    w.farmCheckAt = 0;
    let error: string | undefined;
    mute();
    try {
      w.farmChores();
    } catch (e) {
      error = String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ');
    }
    // (the restart repair's RCON commands run in an async loop)
    for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));
    unmute();
    const recs = newLogRecords();
    for (const r of recs) if (r.type === 'choice') idOwner.set(r.id, r.agent);
    const now = clock;
    const n = normalise(v, now);
    const s: Sweep = {
      ...(error ? { error } : {}),
      calls: calls.slice(callsAt),
      chores: ([...w.chores.values()] as Any[]).map((c) => [c.agent, c.key] as [string, string]).sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0)),
      choices: recs.filter((r) => r.type === 'choice').map((r) => [r.agent, r.key, r.kind, r.what]),
      ends: recs.filter((r) => r.type === 'choice-end').map((r) => [idOwner.get(r.id) ?? '?', r.ok, r.cut, r.message]),
      notes: notes.slice(notesAt).filter((l) => !l.endsWith(': explored all round the village')),
      rcon: rconCmds.slice(rconAt),
      slotSkip: ([...w.slotSkip.entries()] as Array<[string, number]>).sort(),
      cakeAt: ([...w.cakeAt.entries()] as Array<[string, number]>).sort(),
      view: view(n),
      hashes: Object.fromEntries(Object.keys(n).sort().map((k) => [k, hash(n[k])])),
    };
    callsAt = calls.length;
    rconAt = rconCmds.length;
    notesAt = notes.length;
    sweeps.push(s);
    if (opts.instances) {
      checkInstances(fx, w, v);
      mute();
      try {
        checkS9(fx, w, v);
      } catch (e) {
        invariantFails.push(`${fx.key}: the S.9 check threw: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`);
      } finally {
        unmute();
      }
    }
  };
  const endTick = () => {
    mute();
    try {
      w.endChoices?.();
    } finally {
      unmute();
    }
  };

  await sweep();
  if (opts.purity && typeof w.choices === 'function') {
    const snap = () => JSON.stringify([[...reg.villages.values()], ([...w.chores.entries()] as Any[]).map(([k, c]) => [k, c.key, c.status.map((q: Any) => q.state)]),
      [...w.cooling.entries()], [...w.slotSkip.entries()], [...w.cakeAt.entries()], saves, rconCmds.length, calls.length, notes.length, statuses.length,
      // (S.9's state, spec 8.1 item 3)
      [[...W9.makeHolds.entries()], W9.holdsVersion(), [...W9.makeLeft.entries()], [...W9.worksBusy], [...w.makeBack.entries()], [...w.gatherBack.entries()],
        [...w.gatherLog.entries()], [...w.worksBack.entries()],
        // (B.4's back-off and carried torches; the lightParts cache is left out, spec 7.1 L6)
        [...(w.lightBack?.entries() ?? [])], [...W9.lightCarried.entries()]]]);
    const before = snap();
    mute();
    try {
      for (let k = 0; k < PURITY_N; k++) w.choices(agents[k % agents.length]);
    } catch (e) {
      purity = `choices() threw: ${(e as Error).message}`;
    }
    for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));
    unmute();
    newLogRecords();
    const after = snap();
    if (!purity && after !== before) purity = `${PURITY_N} choices() calls changed the state (${['registry', 'chores', 'cooling', 'slotSkip', 'cakeAt', 'saves', 'rcon', 'enqueues', 'notes', 'statuses', 'workshop'].filter((_, k) => JSON.stringify(JSON.parse(before)[k]) !== JSON.stringify(JSON.parse(after)[k])).join(', ')})`;
    if (!purity && rconCmds.length !== rconAt) purity = 'choices() sent RCON commands';
  }
  // Every queued action done; 31 s on
  for (const s of statuses) if (s.state === 'queued' || s.state === 'running') Object.assign(s, { state: 'done', message: `${s.type} done` });
  endTick();
  clock += 31000;
  await sweep();
  // Half the queued actions failed, the rest done; 11 s on
  let k = 0;
  for (const s of statuses)
    if (s.state === 'queued' || s.state === 'running') Object.assign(s, k++ % 2 === 0 ? { state: 'failed', message: 'x failed' } : { state: 'done', message: `${s.type} done` });
  endTick();
  clock += 11000;
  await sweep();
  // Instances mode: every chore ended at last, no earmark or incoming is left (S.9, spec 8.1 item 5d)
  if (opts.instances) {
    for (const s of statuses) if (s.state === 'queued' || s.state === 'running') Object.assign(s, { state: 'done', message: `${s.type} done` });
    endTick();
    const left = [...W9.makeHolds.keys()].filter((k) => k.startsWith(`${v.name}|`));
    if (left.length) invariantFails.push(`${fx.key}: earmarks left once every chore ended: ${left.join(', ')}`);
    const carried = [...W9.lightCarried.keys()].filter((k) => k.startsWith(`${v.name}|`));
    if (carried.length) invariantFails.push(`${fx.key}: lightCarried left once every chore ended: ${carried.join(', ')}`);
    mute();
    try {
      const g = w.gatherWanted(v);
      const inc = Object.entries(g).filter(([, x]: [string, Any]) => x.incoming).map(([m]) => m);
      if (inc.length) invariantFails.push(`${fx.key}: incoming left once every chore ended: ${inc.join(', ')}`);
    } finally {
      unmute();
    }
  }
  void pickLog;
  return { sweeps, purity };
}

/** S.9's counts in instances mode: options seen in menus by kind and by id (works:furnace:k as works:furnace). */
const s9Seen: Record<string, number> = {};
const s9Fixtures = new Set<string>();
const s9Peak: Record<string, number> = {};

/** The goods' targets and the gathering limits (spec 4.4, 4.8). */
const GOODS = new Map(W9.MAKE_GOODS.map((g) => [g.item, g]));

/** The village's S.9 chores under way: makes (item, count, smelts, k) and gathering trips (material, n), with the agent. */
function goingS9(w: Any, v: Any) {
  const make: Array<{ agent: string; item: string; count: number; smelts: boolean; k?: number; holds: string[]; key: string }> = [];
  const gather: Array<{ agent: string; material: string; n: number; key: string }> = [];
  const works: Array<{ agent: string; key: string }> = [];
  for (const c of w.chores.values() as Iterable<Any>) {
    if (c.village !== v.name || !c.status.some((q: Any) => q.state === 'queued' || q.state === 'running')) continue;
    if (c.choice?.make) make.push({ agent: c.agent, ...c.choice.make, holds: c.choice.holds ?? [], key: c.key });
    if (c.choice?.gather) gather.push({ agent: c.agent, ...c.choice.gather, key: c.key });
    if (c.choice?.kind === 'works') works.push({ agent: c.agent, key: c.key });
  }
  return { make, gather, works };
}

/** One menu's S.9 options (spec 8.1 item 5 e-h): makes only below target with a whole batch, one option a good and a
 *  material, no sand where unavailable, gathering within its at-once limit, a works furnace only on a ready plot. */
function checkMenuS9(fx: Fixture, w: Any, v: Any, agent: string, options: Any[]) {
  const s9 = options.filter((o) => o.kind === 'make' || o.kind === 'gather' || o.kind === 'works');
  if (!s9.length) return;
  s9Fixtures.add(fx.key);
  const going = goingS9(w, v);
  const store = storageContents(v);
  const seenIds = new Set<string>();
  let worksFurnace = 0;
  for (const o of s9) {
    const group = o.id.startsWith('works:furnace:') ? 'works:furnace' : o.id;
    s9Seen[`${o.kind}`] = (s9Seen[o.kind] ?? 0) + 1;
    s9Seen[group] = (s9Seen[group] ?? 0) + 1;
    if ((o.kind === 'make' || o.kind === 'gather') && seenIds.has(o.id)) invariantFails.push(`${fx.key}: ${agent}'s menu has ${o.id} twice`);
    seenIds.add(o.id);
    if (o.kind === 'make') {
      const item = o.id.slice('make:'.length), g = GOODS.get(item);
      if (!g) {
        invariantFails.push(`${fx.key}: ${agent}'s menu has ${o.id}, not a good`);
        continue;
      }
      const goingN = going.make.filter((m) => m.item === item).reduce((s, m) => s + m.count, 0);
      // (B.4: the torch's target follows lighting's demand, D7)
      const target = w.makeTarget(v, g);
      const want = target - (store[item] ?? 0) - goingN;
      if (want <= 0) invariantFails.push(`${fx.key}: ${o.id} offered at stock (${store[item] ?? 0} stored, ${goingN} going, target ${target})`);
      const n = Number(/this batch of (\d+)/.exec(o.facts)?.[1] ?? NaN);
      if (!(n > 0 && n <= g.batch && n % g.unit === 0 && n <= Math.ceil(Math.max(0, want) / g.unit) * g.unit))
        invariantFails.push(`${fx.key}: ${o.id}'s batch ${n} is not a whole batch for a want of ${want} (batch ${g.batch}, unit ${g.unit})`);
      const fk = (o.holds ?? []).find((h: string) => h.startsWith('furnace:'));
      if (fk && fk !== 'furnace:0' && !v.layouts?.[0]?.works?.furnaces?.[Number(fk.slice(8)) - 1]) invariantFails.push(`${fx.key}: ${o.id} holds ${fk}, not recorded`);
      if (fk && going.make.some((m) => m.holds.includes(fk))) invariantFails.push(`${fx.key}: ${o.id} offers ${fk}, held by a going make`);
    }
    if (o.kind === 'gather') {
      const m = o.id.slice('gather:'.length);
      if (m === 'sand' && v.unavailable?.includes('sand')) invariantFails.push(`${fx.key}: gather:sand offered with sand unavailable`);
      const spec = (W9.GATHER_KINDS as Any)[m];
      const limit = spec?.atOnce === 'faces' ? w.faces(v).faces : spec?.atOnce;
      const n = going.gather.filter((x) => x.material === m).length;
      if (!spec || n + 1 > limit) invariantFails.push(`${fx.key}: ${o.id} offered with ${n} going (at once ${limit})`);
    }
    if (o.id.startsWith('works:furnace:')) {
      worksFurnace++;
      if (v.layouts?.[0]?.works?.state !== 'ready') invariantFails.push(`${fx.key}: ${o.id} offered before the works plot is ready`);
      if (v.layouts?.[0]?.works?.furnaces?.[Number(o.id.split(':')[2]) - 1]) invariantFails.push(`${fx.key}: ${o.id} offered for a recorded furnace`);
    }
  }
  if (worksFurnace > 1) invariantFails.push(`${fx.key}: ${agent}'s menu has ${worksFurnace} works furnaces`);
}

/** After each sweep, the village's S.9 chores (spec 8.1 item 5 a-d, f, g). */
function checkS9(fx: Fixture, w: Any, v: Any) {
  const going = goingS9(w, v);
  const lay0 = v.layouts?.[0];
  // (a) crafting makes at most MAKE_PARALLEL
  const crafting = going.make.filter((m) => !m.smelts).length;
  if (crafting > W9.MAKE_PARALLEL) invariantFails.push(`${fx.key}: ${crafting} crafting makes going (at most ${W9.MAKE_PARALLEL})`);
  // (b) a smelting make holds one furnace, a recorded one (k 0 the hut's)
  for (const m of going.make) {
    const fk = m.holds.filter((h) => h.startsWith('furnace:'));
    if (m.smelts !== (fk.length === 1) || fk.length > 1) invariantFails.push(`${fx.key}: ${m.agent}'s make of ${m.item} (smelts ${m.smelts}) holds ${fk.join(', ') || 'no furnace'}`);
    for (const h of fk) {
      const k = Number(h.slice(8));
      if (k >= 1 && !lay0?.works?.furnaces?.[k - 1]) invariantFails.push(`${fx.key}: ${m.agent}'s make holds ${h}, not recorded`);
      if (m.k !== undefined && m.k !== k) invariantFails.push(`${fx.key}: ${m.agent}'s make records furnace ${m.k} but holds ${h}`);
    }
  }
  // (c) the earmarks within the spare storage (store - reserve - keep), nothing of MAKE_NEVER; (d) each earmark a going
  // make's or furnace placement's
  const store = storageContents(v);
  const reserve = w.storageReserve(v);
  const held: Record<string, number> = {};
  for (const [k, c] of W9.makeHolds as Map<string, Record<string, number>>) {
    if (!k.startsWith(`${v.name}|`)) continue;
    const agent = k.slice(v.name.length + 1);
    const c0 = [...w.chores.values()].find((x: Any) => x.village === v.name && x.agent.toLowerCase() === agent && x.status.some((q: Any) => q.state === 'queued' || q.state === 'running'));
    if (!c0 || !(c0.choice?.kind === 'make' || c0.choice?.kind === 'light' || (c0.choice?.kind === 'works' && /^worksfurnace:/.test(c0.key)))) invariantFails.push(`${fx.key}: an earmark for ${agent} with no make, light chore or furnace placement going`);
    // (B.4: a light chore's earmark is its own torches)
    if (c0?.choice?.kind === 'light' && JSON.stringify(c) !== JSON.stringify({ torch: c0.choice.light?.n })) invariantFails.push(`${fx.key}: ${agent}'s light chore (${c0.choice.light?.n} torches) earmarks ${JSON.stringify(c)}`);
    for (const [n, q] of Object.entries(c)) held[n] = (held[n] ?? 0) + q;
  }
  const isLog = (n: string) => /_log$/.test(n);
  // (how much the checks saw: the most earmarks, trips and works-furnace smelts at once in a sweep)
  const most = (k: string, n: number) => (s9Peak[k] = Math.max(s9Peak[k] ?? 0, n));
  most('earmarks', [...W9.makeHolds.keys()].filter((k) => k.startsWith(`${v.name}|`)).length);
  most('gathering trips', going.gather.length);
  most('makes', going.make.length);
  most('smelts on works furnaces', going.make.filter((m) => (m.k ?? 0) >= 1).length);
  for (const [n, q] of Object.entries(held)) {
    if (W9.MAKE_NEVER.has(n)) {
      if (q > 0) invariantFails.push(`${fx.key}: ${q} ${n} earmarked (never a make's input)`);
      continue;
    }
    const keep = n === 'cobblestone' ? W9.MAKE_KEEP.cobblestone : n === 'coal' ? W9.MAKE_KEEP.coal : 0;
    const cap = Math.max(0, (store[n] ?? 0) - (reserve[n] ?? 0) - keep);
    if (q > cap) invariantFails.push(`${fx.key}: ${q} ${n} earmarked, ${cap} spare (store ${store[n] ?? 0}, reserve ${reserve[n] ?? 0}, keep ${keep})`);
  }
  const logsHeld = Object.entries(held).filter(([n]) => isLog(n)).reduce((s, [, q]) => s + q, 0);
  if (logsHeld) {
    const logsSpare = Object.entries(store).filter(([n]) => isLog(n)).reduce((s, [n, q]) => s + Math.max(0, q - (reserve[n] ?? 0)), 0) - w.logsKeep(v);
    if (logsHeld > Math.max(0, logsSpare)) invariantFails.push(`${fx.key}: ${logsHeld} logs earmarked, ${Math.max(0, logsSpare)} spare after the keep of ${w.logsKeep(v)}`);
  }
  // (f) gathering: incoming as the going trips, within the need plus one trip, within the at-once limits
  const want = w.gatherWanted(v);
  for (const m of ['sand', 'logs', 'cobblestone']) {
    const trips = going.gather.filter((x) => x.material === m);
    const n = trips.reduce((s, x) => s + x.n, 0);
    const spec = (W9.GATHER_KINDS as Any)[m];
    if (want[m].incoming !== n) invariantFails.push(`${fx.key}: ${m} incoming ${want[m].incoming}, going trips bring ${n}`);
    if (n > want[m].need + spec.trip) invariantFails.push(`${fx.key}: ${n} ${m} on the way for a need of ${want[m].need}`);
    const limit = spec.atOnce === 'faces' ? w.faces(v).faces : spec.atOnce;
    if (trips.length > limit) invariantFails.push(`${fx.key}: ${trips.length} ${m} trips at once (limit ${limit})`);
    if (m === 'sand' && trips.length && v.unavailable?.includes('sand')) invariantFails.push(`${fx.key}: sand gathered with sand unavailable`);
  }
  // (g) works furnaces placed only on a ready plot, one a k
  for (const c of going.works) if (/^worksfurnace:/.test(c.key) && lay0?.works?.state !== 'ready') invariantFails.push(`${fx.key}: ${c.agent} places ${c.key} before the works plot is ready`);
  // Every idle member's menu now (pure, as the purity check holds)
  for (const a of w.agents.values() as Iterable<Any>) {
    const menu = w.choices(a);
    if (menu) {
      checkMenuS9(fx, w, v, a.name, menu.options ?? []);
      checkMenuLight(fx, w, v, a.name, menu.options ?? []);
    }
  }
  // (B.4) the light chores going: each on a part, the most at once
  const parts = new Map(((w.lightParts?.(v) ?? []) as Any[]).map((P) => [P.part, P]));
  const lighting = ([...w.chores.values()] as Any[]).filter((c) => c.village === v.name && c.choice?.kind === 'light' && c.status.some((q: Any) => q.state === 'queued' || q.state === 'running'));
  most('light chores', lighting.length);
  for (const c of lighting) if (!parts.has(c.choice.light?.part)) invariantFails.push(`${fx.key}: ${c.agent} lights ${c.choice.light?.part}, not a part`);
}

/** B.4's counts in instances mode: light options seen (buildings, mine parts), fixtures with one, records seeded. */
const lightSeen: Record<string, number> = { building: 0, mine: 0 };
const lightFixtures = new Set<string>();
const lightSeeded: Record<string, number> = {};

/** B.4's light record seeded on a fixture's village (spec 7.1): absent, half of each part's spots done, or all done with
 *  a building's last spot never now and then. */
function seedLights(w: Any, v: Any, key: string) {
  const R = rng(`${key}:b4lights`);
  const state = R.pick(['absent', 'absent', 'half', 'done']);
  lightSeeded[state] = (lightSeeded[state] ?? 0) + 1;
  if (state === 'absent') return;
  const parts = w.lightParts(v) as Any[];
  if (!parts.length) return;
  v.lights = {};
  for (const P of parts) {
    const keys: string[] = P.spots.map((s: Any) => `${s.x},${s.y},${s.z}`);
    if (state === 'half') v.lights[P.part] = { done: keys.slice(0, Math.floor(keys.length / 2)), at: NOW - 30 * MIN, by: 'golden' };
    else {
      const never = P.kind === 'building' && keys.length > 1 && R.chance(0.4) ? [keys[keys.length - 1]] : [];
      v.lights[P.part] = { done: keys.filter((k) => !never.includes(k)), ...(never.length ? { never } : {}), at: NOW - 30 * MIN, by: 'golden' };
    }
  }
}

/** One menu's light options (spec 7.1 a, b): one a part, a part with something unlit (2 for a growing mine part), each
 *  trip's torches within the bounds and the menu's within the spare torches, none for a part a going chore holds. */
function checkMenuLight(fx: Fixture, w: Any, v: Any, agent: string, options: Any[]) {
  const ls = options.filter((o) => o.kind === 'light');
  if (!ls.length) return;
  lightFixtures.add(fx.key);
  const parts = new Map(((w.lightParts?.(v) ?? []) as Any[]).map((P) => [P.part, P]));
  const held = new Set(([...w.chores.values()] as Any[]).filter((c) => c.village === v.name && c.status.some((q: Any) => q.state === 'queued' || q.state === 'running')).map((c) => c.key));
  const seen = new Set<string>();
  let sum = 0;
  for (const o of ls) {
    const P = parts.get(String(o.id).slice('light:'.length));
    if (seen.has(o.id)) invariantFails.push(`${fx.key}: ${agent}'s menu has ${o.id} twice`);
    seen.add(o.id);
    if (!P) {
      invariantFails.push(`${fx.key}: ${agent}'s menu has ${o.id}, not a part`);
      continue;
    }
    lightSeen[P.kind] = (lightSeen[P.kind] ?? 0) + 1;
    const min = P.kind === 'mine' && P.growing ? W9.MINE_LIGHT_MIN : 1;
    if (P.unlit < min) invariantFails.push(`${fx.key}: ${o.id} offered with ${P.unlit} unlit (at least ${min})`);
    const n = Number(/takes (\d+) torch/.exec(o.facts)?.[1] ?? NaN);
    if (!(n >= Math.min(P.unlit, W9.LIGHT_MIN_TRIP) && n <= Math.min(P.unlit, W9.LIGHT_TRIP))) invariantFails.push(`${fx.key}: ${o.id} takes ${n} torches for ${P.unlit} unlit`);
    if (o.key !== o.id || !(o.excludes ?? []).includes(`${o.id}=`)) invariantFails.push(`${fx.key}: ${o.id}'s key ${o.key} or excludes ${JSON.stringify(o.excludes)}`);
    if (held.has(o.id)) invariantFails.push(`${fx.key}: ${o.id} offered while a going chore holds it`);
    if (!(o.rank >= 860 && o.rank < 900)) invariantFails.push(`${fx.key}: ${o.id} at rank ${o.rank}`);
    sum += Number.isFinite(n) ? n : 0;
  }
  const spare = w.makeSpare(v, '').torch ?? 0;
  if (sum > spare) invariantFails.push(`${fx.key}: ${agent}'s light options take ${sum} torches, ${spare} spare`);
}

/** Leaf paths that differ between two JSON values ("layouts.0.slots.3.pen.workAt.eggs"). */
function changedPaths(a: Any, b: Any, at = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const out: string[] = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...changedPaths(a[k], b[k], at ? `${at}.${k}` : k));
    return out;
  }
  return [at];
}

/** Instances mode, after each sweep: no two going chores share a key or a held key; slotSkip only for unsighted kinds. */
function checkInstances(fx: Fixture, w: Any, v: Any) {
  const seen = new Map<string, string>();
  for (const c of w.chores.values() as Iterable<Any>) {
    if (c.village !== v.name || !c.status.some((q: Any) => q.state === 'queued' || q.state === 'running')) continue;
    for (const k of [c.key, ...(c.choice?.holds ?? c.holds ?? [])]) {
      if (seen.has(k)) invariantFails.push(`${fx.key}: ${c.agent} and ${seen.get(k)} both hold ${k}`);
      seen.set(k, c.agent);
    }
  }
  // (a skip is written only for a kind with no sighting collect could take: the sightings are the variant's)
  const a = [...w.agents.values()][0];
  const chest = v.storage?.chests[0];
  if (!a || !chest) return;
  const ok = collectFilter(a, FARM_TRIP_RANGE);
  // (sightings on a slot's bad list do not count, as in the picker's own filter, mcWorld.ts nextChore on HEAD)
  const bad = new Set((v.layouts ?? []).flatMap((l: Any) => (l.slots ?? []).flatMap((q: Any) => q.bad ?? [])));
  for (const [k, until] of w.slotSkip as Map<string, number>) {
    if (!k.startsWith(`${v.name}:`) || until <= clock) continue;
    const kind = k.slice(v.name.length + 1);
    const sighted = (w.atlas.sightings(kind, Math.floor(chest.x), Math.floor(chest.z), FARM_TRIP_RANGE) as Array<[number, number, number, number]>)
      .some(([x, y, z, n]) => ok({ x, y, z }) && !bad.has(`${kind}@${x},${z}`) && !bad.has(`${kind}@${x},${y},${z}`) && (kind !== 'sugar_cane' || n >= 2));
    if (sighted) invariantFails.push(`${fx.key}: slotSkip written for ${kind}, which has a sighting in range`);
  }
}

// ---- main ------------------------------------------------------------------------------------------------------------

if (mode === 'instances' && (typeof (MineflayerWorld.prototype as Any).choices !== 'function' || typeof (MineflayerWorld.prototype as Any).runChoice !== 'function')) {
  say("needs A.2's world (choices/runChoice missing)");
  process.exit(2);
}

const started = process.hrtime.bigint();
const out: { version: number; inputs: typeof inputs; bases: string[]; dropped: string[]; fixtures: Record<string, Sweep[]> } = { version: 1, inputs, bases: [], dropped: [], fixtures: {} };
const purityFails: string[] = [];
let purityRuns = 0;
const reg0 = (await import('minecraft-data')).default('26.1');
for (const src of sources) {
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
  fs.copyFileSync(src, path.join(dir, 'villages.json'));
  const data = JSON.parse(fs.readFileSync(src, 'utf8')) as { villages: Any[] };
  const atlasPath = src.replace(/\.json$/, '.atlas.json');
  const atlasFile = fs.existsSync(atlasPath) ? JSON.parse(fs.readFileSync(atlasPath, 'utf8')) : null;
  const snapshot = !!atlasFile || data.villages.length === 1;
  for (const base of data.villages) {
    // Complete villages (a one-village snapshot's whatever its state)
    if (!base.complete && !snapshot) continue;
    const name = `${src}|${base.name}`;
    if (!base.plots?.some((p: Any) => !p.annex)) {
      out.dropped.push(`${name}: no plot`);
      continue;
    }
    if (out.bases.length >= BASES_MAX) {
      out.dropped.push(`${name}: over BASES_MAX ${BASES_MAX}`);
      continue;
    }
    out.bases.push(name);
    for (let i = 0; i < VARIANTS; i++) {
      for (const [idle] of IDLE_SETS) {
        const key = `${name}|v${i}|${idle}`;
        if (ONLY && !key.includes(ONLY)) continue;
        const variant = makeVariant(reg0, base, i, name, atlasFile);
        if (!variant) continue;
        if (mode === 'instances') seedWorkshop(reg0, variant, key);
        const fx: Fixture = { key, src, base: base.name, variant: i, idle };
        const r = await runFixture(dir, fx, variant, { purity: mode !== 'dump', instances: mode === 'instances' });
        out.fixtures[key] = r.sweeps;
        if (mode !== 'dump' && r.purity !== undefined) purityFails.push(`${key}: ${r.purity}`);
        if (mode !== 'dump') purityRuns++;
      }
    }
  }
}
fs.rmSync(SCRATCH, { recursive: true, force: true });
const secs = Number(process.hrtime.bigint() - started) / 1e9;
const nFix = Object.keys(out.fixtures).length;
const picks = Object.values(out.fixtures).reduce((s, sw) => s + sw.reduce((t, x) => t + x.choices.length, 0), 0);
const byKind: Record<string, number> = {};
for (const sw of Object.values(out.fixtures)) for (const x of sw) for (const c of x.choices) byKind[c[2]] = (byKind[c[2]] ?? 0) + 1;
say(`bases (${out.bases.length}): ${out.bases.map((b) => b.split('|')[1]).join(', ')}`);
if (out.dropped.length) say(`dropped (${out.dropped.length}): ${out.dropped.join('; ')}`);
say(`${nFix} fixtures x 3 sweeps in ${secs.toFixed(1)} s; ${picks} chores picked (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')})`);
const sweepErrors = Object.entries(out.fixtures).flatMap(([k, sw]) => sw.map((x, j) => (x.error ? `${k} S${j + 1}: ${x.error}` : '')).filter(Boolean));
if (sweepErrors.length) say(`sweeps that threw (${sweepErrors.length}; recorded as results): ${sweepErrors.slice(0, 3).join(' || ')}`);
if (errors.length) say(`console.error lines from the code under test: ${errors.length} (first: ${errors[0]})`);
say(randomCalls ? `Math.random called ${randomCalls} times by the code under test (seeded per fixture)` : 'Math.random: not called');

if (mode === 'dump') {
  fs.writeFileSync(golden, JSON.stringify(out));
  say(`golden written: ${golden} (${(fs.statSync(golden).size / 1e6).toFixed(1)} MB)`);
  process.exit(0);
}

if (mode === 'instances') {
  const withExtras = Object.entries(extras);
  say(`instances: ${withExtras.length} fixtures with options beyond single keys${withExtras.length ? ` (${Object.entries(withExtras.reduce((s, [, e]) => { for (const [k, n] of Object.entries(e)) s[k] = (s[k] ?? 0) + n; return s; }, {} as Record<string, number>)).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}`);
  // (S.9: options seen in menus, by kind and id, and the chores picked of each new kind)
  const s9Kinds = ['works', 'make', 'gather'];
  say(`S.9 options in menus (${s9Fixtures.size} fixtures): ${s9Kinds.map((k) => `${k} ${s9Seen[k] ?? 0}`).join(', ')}; by id: ${Object.entries(s9Seen).filter(([k]) => k.includes(':')).sort().map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  say(`S.9 chores picked: ${s9Kinds.map((k) => `${k} ${byKind[k] ?? 0}`).join(', ')}; most at once in a sweep: ${Object.entries(s9Peak).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  say(`B.4 light options in menus (${lightFixtures.size} fixtures): buildings ${lightSeen.building}, mine parts ${lightSeen.mine}; light chores picked ${byKind.light ?? 0}; light records seeded: ${Object.entries(lightSeeded).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  for (const f of invariantFails.slice(0, Number(process.env.FAILS_MAX ?? 40))) say(`FAIL ${f}`);
  // (the broken invariants by what they say, agents, ids and numbers folded)
  const byWhat: Record<string, number> = {};
  for (const f of invariantFails) {
    const w = f.replace(/^[^|]*\|[^|]*\|v\d+\|\w+: /, '').replace(/\b(Worker\d+|Mayor)\b/g, 'A').replace(/-?\d+/g, 'N').replace(/:[a-z_:N]+/g, ':*');
    byWhat[w] = (byWhat[w] ?? 0) + 1;
  }
  for (const [w, n] of Object.entries(byWhat).sort((p, q) => q[1] - p[1]).slice(0, 15)) say(`  broken ${n}x: ${w.slice(0, 200)}`);
  for (const f of purityFails.slice(0, 20)) say(`PURITY FAIL ${f}`);
  say(`purity: ${purityRuns} fixtures x ${PURITY_N} choices() calls, ${purityFails.length} changed state`);
  say(`${nFix} fixtures, ${invariantFails.length} invariants broken`);
  process.exit(invariantFails.length || purityFails.length ? 1 : 0);
}

// check
const want = JSON.parse(fs.readFileSync(golden, 'utf8')) as typeof out;
let failures = 0;
const fail = (s: string) => {
  failures++;
  if (failures <= 40) say(`FAIL ${s}`);
};
if (JSON.stringify(want.inputs) !== JSON.stringify(inputs)) {
  say(`REFUSED: the golden was dumped from other inputs:\n  golden ${JSON.stringify(want.inputs)}\n  now    ${JSON.stringify(inputs)}`);
  process.exit(2);
}
if (JSON.stringify(want.bases) !== JSON.stringify(out.bases)) fail(`bases differ: golden ${want.bases.length}, now ${out.bases.length}`);
let compared = 0;
for (const [key, sw] of Object.entries(want.fixtures)) {
  if (ONLY && !key.includes(ONLY)) continue;
  const got = out.fixtures[key];
  if (!got) {
    fail(`${key}: missing`);
    continue;
  }
  compared++;
  sw.forEach((s, j) => {
    const g = got[j] as Sweep & Record<string, unknown>;
    for (const f of ['error', 'calls', 'chores', 'choices', 'ends', 'notes', 'rcon', 'slotSkip', 'cakeAt', 'view', 'hashes'] as const) {
      const a = JSON.stringify(g?.[f] ?? null), b = JSON.stringify((s as Sweep & Record<string, unknown>)[f] ?? null);
      if (a === b) continue;
      if (f === 'hashes') {
        const keys = [...new Set([...Object.keys(g.hashes ?? {}), ...Object.keys(s.hashes ?? {})])].filter((k) => g.hashes?.[k] !== s.hashes?.[k]);
        fail(`${key} S${j + 1} village record differs in ${keys.join(', ')}`);
      } else fail(`${key} S${j + 1} ${f}:\n  got  ${a.slice(0, VERBOSE ? 4000 : 400)}\n  want ${b.slice(0, VERBOSE ? 4000 : 400)}`);
    }
  });
}
for (const key of Object.keys(out.fixtures)) if (!want.fixtures[key]) fail(`${key}: not in the golden`);
if (failures > 40) say(`... ${failures - 40} more`);
if (purityRuns) {
  if (typeof (MineflayerWorld.prototype as Any).choices !== 'function') say('purity: skipped (no choices yet)');
  else {
    for (const f of purityFails.slice(0, 20)) say(`PURITY FAIL ${f}`);
    say(`purity: ${purityRuns} fixtures x ${PURITY_N} choices() calls, ${purityFails.length} changed state`);
  }
}
say(`${compared} fixtures compared (3 sweeps each), ${failures} differences`);
process.exit(failures || purityFails.length ? 1 : 0);
