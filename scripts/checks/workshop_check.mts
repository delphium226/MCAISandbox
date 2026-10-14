/**
 * S.9's workshop checked offline (runs/2026-10-14/spec_s9.md 8.3; no server, ~a few seconds):
 * 1. plans: every good (mcWorkshop.ts MAKE_GOODS) at its batch and its unit, the barrel and composter at oak, birch and
 *    spruce and with oak slabs in a birch stock, planned within 33 ms, with no problems and only raw, easy materials to
 *    gather (mcMaterials' EASY_GATHER); makeBill never calls a bill feasible that still has something to gather;
 * 2. the jar's arithmetic: each good's batch expanded by hand from data/minecraft/recipe/*.json (tags resolved, one wood
 *    kind, whole crafts and smelts, leftovers reused, planks burnt as fuel 1.5 smelts each) against plan() and against the
 *    spec's table 4.4 (raw inputs and smelts from nothing);
 * 3. D13, the planner's fuel fix: every design in mc/server/villages.json and every good's batch planned with the old
 *    fuel rule and the new one against several stocks; only plans that take coal or charcoal as an ingredient from a
 *    stock holding it may change (printed);
 * 4. gathering on a real MineflayerWorld (a copy of Minevale3 from the golden inputs, fake agents, the mine's faces
 *    stubbed at 2 with none held): from nothing and from the four after-phase storages of runs/2026-10-14/count, the
 *    workshop's gathering options are taken by idle members, each trip deposited and the menus asked again, until none is
 *    offered: every `want` must reach 0, from nothing within sand 3, logs 7 and cobblestone 4 trips (with the works plot
 *    ready, its furnaces' cobblestone too); no sand with sand unavailable; logs stop at the hourly cap; a queued make
 *    lowers nothing's need (its inputs are not wanted again, the check's M1); trips and agent-minutes at the count's
 *    rates printed;
 * 5. worksFurnaces on a works plot of each side: three cells in the first slot, a free column between them, each with its
 *    stand cell on the slot's end row facing the plot and facing it, nothing on the second slot.
 * Exits non-zero on any failure.
 * Usage: node_modules/.bin/tsx scripts/checks/workshop_check.mts   (VERBOSE=1: every plan and trip)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const VERBOSE = !!process.env.VERBOSE;
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'workshop-check-'));
// (read when the world's modules load: set first; the families on, fixed choosing, single keys as in a run)
process.env.MC_CHOOSE = 'fixed';
process.env.MC_CHOICE_FAMILIES = 'make,gather,works';
process.env.MC_CHOICE_INSTANCES = 'explore,start';
process.env.MC_TIME_SCALE = '1';
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
const NOW = Date.parse('2026-10-14T12:00:00Z');
const MIN = 60000;
let clock = NOW;
Date.now = () => clock;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const minecraftData = (await import('minecraft-data')).default;
const { Materials, designBill, hardToGather } = await import('../../server/src/mineflayer/mcMaterials');
type Counts = Record<string, number>;
const W9 = await import('../../server/src/mineflayer/mcWorkshop');
const { annexCandidates, annexSlots, slotCell, FACING_PLOT, worksFurnaces } = await import('../../server/src/farmSlots');
const { hasJar, itemTag, readJson, vanillaJar } = await import('../../server/src/vanillaData');
const { storageContents } = await import('../../server/src/mineflayer/mcStorage');

const reg = minecraftData('26.1');
const m = new Materials(reg);
const plan = (b: Counts, h: Counts) => m.plan(b, h);
let failures = 0, checks = 0;
const quiet = { log: console.log, warn: console.warn, info: console.info };
const say = (s: string) => quiet.log(s);
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    say(`FAIL ${what}`);
  }
};
const mute = () => { console.log = () => {}; console.warn = () => {}; console.info = () => {}; };
const unmute = () => Object.assign(console, quiet);
const fmt = (c: Counts) => Object.entries(c).filter(([, q]) => q).sort().map(([n, q]) => `${n}:${q}`).join(',') || '-';
const GOODS = W9.MAKE_GOODS;

// ---- 1. plans ---------------------------------------------------------------------------------------------------------
say('== 1. plans');
{
  // (one warm-up: the first plan builds the option tables)
  plan({ torch: 1 }, {});
  const cases: Array<{ label: string; good: (typeof GOODS)[number]; count: number; stock: Counts; wood: string; kind?: string }> = [];
  for (const g of GOODS) {
    if (g.variant) {
      for (const wood of ['oak', 'birch', 'spruce']) for (const count of new Set([g.batch, g.unit])) cases.push({ label: `${g.item} x${count} (${wood})`, good: g, count, stock: {}, wood, kind: wood });
      // (oak slabs in a birch stock: the composter takes the stocked slabs, the barrel birch planks, the check's H2)
      cases.push({ label: `${g.item} x${g.batch} (birch, 7 oak slabs stocked)`, good: g, count: g.batch, stock: { oak_slab: 7, birch_log: 20 }, wood: 'birch', kind: g.item === 'composter' ? 'oak' : 'birch' });
    } else for (const count of new Set([g.batch, g.unit])) cases.push({ label: `${g.item} x${count}`, good: g, count, stock: {}, wood: 'oak' });
  }
  for (const c of cases) {
    const b = W9.makeBill(reg, plan, c.good, c.count, c.stock, c.wood);
    ok(b, `${c.label}: a bill`);
    if (!b) continue;
    const t0 = performance.now();
    const p = plan(b.bill, c.stock);
    const ms = performance.now() - t0;
    ok(ms <= 33, `${c.label}: planned in ${ms.toFixed(1)} ms (33 at most)`);
    ok(!p.problems.length, `${c.label}: no problems (${p.problems.join('; ')})`);
    ok(!hardToGather(p.gather).length, `${c.label}: only easy raw materials to gather (${fmt(p.gather)})`);
    ok(!(b.feasible && Object.keys(p.gather).length), `${c.label}: feasible with something to gather (${fmt(p.gather)})`);
    if (c.kind) ok(b.craft?.wood === c.kind, `${c.label}: made of ${c.kind} (got ${b.craft?.wood})`);
    // (with every raw material stocked the bill is feasible)
    const rich = { cobblestone: 200, sand: 64, [`${c.wood}_log`]: 64, ...c.stock };
    const br = W9.makeBill(reg, plan, c.good, c.count, rich, c.wood);
    ok(br?.feasible, `${c.label}: feasible from a stocked storage`);
    if (br?.feasible) ok(!Object.keys(plan(br.bill, rich).gather).length, `${c.label}: feasible means nothing to gather`);
    if (VERBOSE) say(`  ${c.label.padEnd(44)} ${fmt(b.bill)} -> gather ${fmt(p.gather)}, smelts ${p.fuel.smelts}, ${ms.toFixed(1)} ms`);
  }
  say(`  ${cases.length} bills planned`);
}

// ---- 2. the jar's arithmetic ------------------------------------------------------------------------------------------
say('== 2. the jar\'s recipes against plan() and the spec\'s table');
/** The spec's table 4.4: raw inputs and smelts of one batch from nothing (logs of the village's kind). */
const TABLE: Record<string, { raw: Counts; smelts: number }> = {
  stone_pickaxe: { raw: { cobblestone: 12, logs: 1 }, smelts: 0 }, stone_hoe: { raw: { cobblestone: 4, logs: 1 }, smelts: 0 },
  wooden_sword: { raw: { logs: 2 }, smelts: 0 }, charcoal: { raw: { logs: 10 }, smelts: 8 }, torch: { raw: { logs: 6 }, smelts: 4 },
  glass: { raw: { sand: 8, logs: 2 }, smelts: 8 }, glass_pane: { raw: { sand: 6, logs: 1 }, smelts: 6 }, glass_bottle: { raw: { sand: 3, logs: 1 }, smelts: 3 },
  barrel: { raw: { logs: 3 }, smelts: 0 }, smooth_stone: { raw: { cobblestone: 8, logs: 3 }, smelts: 16 }, stone_bricks: { raw: { cobblestone: 16, logs: 3 }, smelts: 16 },
  composter: { raw: { logs: 2 }, smelts: 0 }, ladder: { raw: { logs: 2 }, smelts: 0 },
};
const JAR = vanillaJar();
if (!hasJar(JAR)) say(`  no jar at ${JAR}: the hand expansion is skipped (the table is still checked)`);
/** Raw materials, by the planner's gathering names folded: any log, cobblestone, sand. */
const RAW = (n: string) => /_log$/.test(n) || n === 'cobblestone' || n === 'sand';
/** One recipe from the jar for `item`, ingredients resolved to one item each for the wood kind (tags, alternatives). */
function jarRecipe(item: string, kind: string): { smelt: boolean; ins: Counts; out: number } | null {
  let r: Any;
  try {
    r = readJson(`data/minecraft/recipe/${item}.json`, JAR);
  } catch {
    return null;
  }
  const strip = (s: string) => s.replace(/^minecraft:/, '');
  const pick = (ing: unknown): string => {
    const opts: string[] = Array.isArray(ing) ? ing.map((x) => String(x)) : [String(ing)];
    const names = opts.flatMap((o) => (o.startsWith('#') ? [...itemTag(strip(o.slice(1)), JAR)].map(strip) : [strip(o)]));
    // (the village's kind first, then the everyday choice: cobblestone, charcoal from logs when nothing is stocked, sand)
    return names.find((n) => n === `${kind}_log` || n === `${kind}_planks` || n === `${kind}_slab`) ?? names.find((n) => n === 'cobblestone') ?? names.find((n) => n === 'charcoal') ?? names.find((n) => n === 'sand') ?? names[0];
  };
  const out = r.result?.count ?? 1;
  if (r.type === 'minecraft:smelting') return { smelt: true, ins: { [pick(r.ingredient)]: 1 }, out };
  const ins: Counts = {};
  if (r.type === 'minecraft:crafting_shaped') for (const row of r.pattern as string[]) for (const ch of row) { if (ch !== ' ') { const n = pick(r.key[ch]); ins[n] = (ins[n] ?? 0) + 1; } }
  else if (r.type === 'minecraft:crafting_shapeless') for (const ing of r.ingredients) { const n = pick(ing); ins[n] = (ins[n] ?? 0) + 1; }
  else return null;
  return { smelt: false, ins, out };
}
/** A bill expanded by hand: demand gathered per item in recipe-depth order (whole runs, leftovers kept), then the fuel's
 *  planks (1.5 smelts each) added and expanded again, as a player would work it out. */
function byHand(bill: Counts, kind: string): { raw: Counts; smelts: number } | null {
  const expand = (b: Counts) => {
    const recipes = new Map<string, ReturnType<typeof jarRecipe>>();
    const depth = new Map<string, number>();
    const visit = (n: string, d: number) => {
      if (RAW(n)) return;
      if (!recipes.has(n)) recipes.set(n, jarRecipe(n, kind));
      const r = recipes.get(n);
      if (!r) throw new Error(`no recipe for ${n}`);
      depth.set(n, Math.max(depth.get(n) ?? 0, d));
      for (const i of Object.keys(r.ins)) visit(i, d + 1);
    };
    for (const n of Object.keys(b)) visit(n, 0);
    const want: Counts = { ...b }, raw: Counts = {};
    let smelts = 0;
    for (const n of [...depth.keys()].sort((x, y) => depth.get(x)! - depth.get(y)!)) {
      const r = recipes.get(n)!, q = want[n] ?? 0;
      if (!q) continue;
      const runs = Math.ceil(q / r.out);
      if (r.smelt) smelts += runs;
      for (const [i, k] of Object.entries(r.ins)) want[i] = (want[i] ?? 0) + k * runs;
    }
    for (const [n, q] of Object.entries(want)) if (RAW(n)) raw[n] = q;
    return { raw, smelts };
  };
  try {
    const first = expand(bill);
    const planks = Math.ceil(first.smelts / 1.5);
    if (!planks) return first;
    const again = expand({ ...bill, [`${kind}_planks`]: (bill[`${kind}_planks`] ?? 0) + planks });
    return { raw: again.raw, smelts: first.smelts };
  } catch (e) {
    say(`  ${Object.keys(bill).join('+')}: ${(e as Error).message}`);
    return null;
  }
}
const fold = (c: Counts, kind: string) => {
  const out: Counts = {};
  for (const [n, q] of Object.entries(c)) {
    const k = n === 'any:logs' || n === `${kind}_log` || /_log$/.test(n) ? 'logs' : n.replace(/^any:/, '');
    out[k] = (out[k] ?? 0) + q;
  }
  return out;
};
{
  const kind = 'birch';
  for (const g of GOODS) {
    const b = W9.makeBill(reg, plan, g, g.batch, {}, kind)!;
    const p = plan(b.bill, {});
    const mine = fold(p.gather, kind);
    const t = TABLE[g.item];
    ok(t, `${g.item}: in the spec's table`);
    if (t) ok(fmt(mine) === fmt(t.raw) && p.fuel.smelts === t.smelts, `${g.item} x${g.batch}: plan ${fmt(mine)} smelts ${p.fuel.smelts}, the spec's table ${fmt(t.raw)} smelts ${t.smelts}`);
    if (!hasJar(JAR)) continue;
    const h = byHand(b.bill, kind);
    if (!h) {
      ok(false, `${g.item}: expanded by hand from the jar`);
      continue;
    }
    const hand = fold(h.raw, kind);
    const same = fmt(hand) === fmt(mine) && h.smelts === p.fuel.smelts;
    // (a difference is a failure unless named here with its reason)
    const REASONS: Record<string, string> = {};
    ok(same || REASONS[g.item], `${g.item} x${g.batch}: by hand from the jar ${fmt(hand)} smelts ${h.smelts}, plan ${fmt(mine)} smelts ${p.fuel.smelts}`);
    if (VERBOSE || !same) say(`  ${g.item.padEnd(14)} x${String(g.batch).padEnd(3)} jar ${fmt(hand).padEnd(28)} smelts ${String(h.smelts).padEnd(3)} plan ${fmt(mine).padEnd(28)} smelts ${p.fuel.smelts}${same ? '' : `  DIFFERS${REASONS[g.item] ? `: ${REASONS[g.item]}` : ''}`}`);
  }
  say(`  ${GOODS.length} goods against the table${hasJar(JAR) ? ' and the jar' : ''}`);
}

// ---- 3. D13, the fuel fix ---------------------------------------------------------------------------------------------
say('== 3. the planner\'s fuel fix (D13)');
{
  const propagate = (b: Counts, h: Counts) => (m as Any).propagate(b, h);
  /** plan() before D13: the fuel's coal and charcoal counted from the stock whatever the plan took of them. */
  const oldPlan = (bill: Counts, have: Counts) => {
    const first = propagate(bill, have);
    const smelts = first.smelts;
    const coal = Math.min((have.coal ?? 0) + (have.charcoal ?? 0), Math.ceil(smelts / 8));
    const planks = Math.ceil(Math.max(0, smelts - coal * 8) / 1.5);
    const result = planks ? propagate({ ...bill, 'any:planks': (bill['any:planks'] ?? 0) + planks }, have) : first;
    return { gather: result.gather as Counts, fuel: { smelts, coal, planks }, fromStock: result.fromStock as Counts };
  };
  const bills: Array<[string, Counts]> = [];
  const file = 'mc/server/villages.json';
  if (fs.existsSync(file)) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const vs: Any[] = Array.isArray(data) ? data : Object.values(data.villages ?? data);
    for (const v of vs) for (const d of Object.values(v.designs ?? {}) as Any[]) bills.push([`${v.name}/${d.name}`, designBill(d)]);
  } else say(`  no ${file}: designs skipped`);
  for (const g of GOODS) bills.push([`good ${g.item}`, W9.makeBill(reg, plan, g, g.batch, {}, 'birch')!.bill]);
  const finals = fs.existsSync('runs/2026-10-14/count/storage_final.json') ? JSON.parse(fs.readFileSync('runs/2026-10-14/count/storage_final.json', 'utf8')) : {};
  const stocks: Array<[string, Counts]> = [['nothing', {}], ['4 coal', { coal: 4 }], ['8 charcoal, 20 birch logs', { charcoal: 8, birch_log: 20 }], ['2 charcoal, 20 birch logs (M4)', { charcoal: 2, birch_log: 20 }], ['2 coal, 2 charcoal', { coal: 2, charcoal: 2, oak_log: 30, cobblestone: 64, sand: 16 }], ...Object.entries(finals) as Array<[string, Counts]>];
  let n = 0, changed = 0;
  for (const [label, bill] of bills)
    for (const [sl, have] of stocks) {
      n++;
      const a = oldPlan(bill, have), b = m.plan(bill, have);
      const diff = fmt(a.gather) !== fmt(b.gather) || JSON.stringify(a.fuel) !== JSON.stringify(b.fuel);
      if (!diff) continue;
      changed++;
      const took = (b.fromStock.coal ?? 0) + (b.fromStock.charcoal ?? 0);
      ok(took > 0 && (have.coal ?? 0) + (have.charcoal ?? 0) > 0, `${label} with ${sl}: the plan changed without taking stocked coal or charcoal as an ingredient`);
      if (changed <= 30) say(`  changed: ${label} with ${sl}: gather ${fmt(a.gather)} -> ${fmt(b.gather)}, fuel coal ${a.fuel.coal} planks ${a.fuel.planks} -> coal ${b.fuel.coal} planks ${b.fuel.planks} (took ${took} coal/charcoal as an ingredient)`);
    }
  say(`  ${bills.length} bills x ${stocks.length} stocks: ${n} plans, ${changed} changed (each takes stocked coal or charcoal as an ingredient)`);
}

// ---- 4. gathering on a real world -------------------------------------------------------------------------------------
say('== 4. gathering until nothing is wanted');
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');
const BASE_FILE = 'runs/2026-10-12/golden_inputs/villages_main.json';
const BASE = JSON.parse(fs.readFileSync(BASE_FILE, 'utf8')).villages.find((v: Any) => v.name === 'Minevale3');
/** The count's rates at 1x (runs/2026-10-14/count_s9.md): items an agent-minute. */
const RATES: Record<string, number> = { sand: 5.5, logs: 5, cobblestone: 18.7 };
const LIMITS: Record<string, number> = { sand: 3, logs: 7, cobblestone: 4 };

interface Sim { fallbacks: string[]; furnaces: number; trips: Record<string, number>; amount: Record<string, number>; want: Record<string, Any>; reason?: string; offeredSand: number; logsHour: number; maxLogsTrip: number }

/** A world holding one village (Minevale3 with `store` in its first chest, the rest emptied), `members` fake idle agents. */
function world(store: Counts, opts: { works?: boolean; noSand?: boolean } = {}) {
  const v = JSON.parse(JSON.stringify(BASE));
  v.name = 'S9Check';
  v.complete = true;
  for (const c of v.storage.chests) c.items = {};
  v.storage.chests[0].items = { ...store };
  if (opts.noSand) v.unavailable = ['sand'];
  const plot0 = v.plots.find((p: Any) => !p.annex);
  if (opts.works) {
    const lay = v.layouts[0];
    const ax = { x1: plot0.x1, x2: plot0.x1 + 12, z1: plot0.z1 - 11, z2: plot0.z1 - 3, side: 'n', y: plot0.y, state: 'ready' };
    lay.annex = ax;
    lay.works = { x1: ax.x2 + 3, x2: ax.x2 + 15, z1: ax.z1, z2: ax.z2, side: 'n', y: plot0.y, state: 'ready' };
  }
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
  fs.writeFileSync(path.join(dir, 'villages.json'), JSON.stringify({ villages: [v] }));
  mute();
  const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
  unmute();
  w.villages.save = () => {};
  const vv = w.villages.get(v.name);
  w.atlas.sightings = () => [];
  w.atlas.animalSightings = () => [];
  w.atlas.known = () => 1;
  w.faces = () => ({ faces: 2, free: 2, held: 0, tunnels: 2, branches: 0, turns: 0, down: 0 });
  const home = v.storage.chests[0];
  const sections = new Array(24).fill(null);
  const getColumn = () => ({ minY: -64, sections, getBlockStateId: () => 0 });
  const agents: Any[] = [];
  for (let i = 1; i <= 8; i++) {
    const name = `Worker${i}`, own: Any[] = [];
    const memory = { village: v.name, villageRole: 'worker' };
    const a: Any = {
      name, role: 'worker', memory, world: w, village: () => w.villages.get(memory.village), own,
      idle: () => !own.some((s) => s.state === 'queued' || s.state === 'running'),
      enqueue: (type: string, args: Record<string, unknown>) => { const s = { id: own.length + 1, type, args, state: 'queued' }; own.push(s); return s; },
      bot: { entity: { position: { x: home.x + 0.5, y: home.y, z: home.z + 0.5 } }, entities: {}, inventory: { items: () => [] }, world: { getColumn }, game: { minY: -64 } },
    };
    agents.push(a);
    w.agents.set(name.toLowerCase(), a);
  }
  return { w, v: vv, agents };
}

const itemOf = (v: Any, mat: string) => (mat === 'logs' ? `${v.wood ?? 'oak'}_log` : mat);

/** Idle members take every gathering option offered, each trip lands, until a round offers none and none is going. */
function simulate(store: Counts, opts: { works?: boolean; noSand?: boolean; logsDone?: number } = {}): Sim {
  const { w, v, agents } = world(store, opts);
  if (opts.logsDone) w.gatherLog.set(v.name, [{ at: clock, n: opts.logsDone }]);
  const sim: Sim = { fallbacks: [], furnaces: 0, trips: { sand: 0, logs: 0, cobblestone: 0 }, amount: { sand: 0, logs: 0, cobblestone: 0 }, want: {}, offeredSand: 0, logsHour: opts.logsDone ?? 0, maxLogsTrip: 0 };
  mute();
  try {
    for (let round = 0; round < 40; round++) {
      clock += MIN;
      let took = 0;
      for (const a of agents) {
        const menu = w.choices(a);
        // (gathering, and with a works plot its furnaces as the sweep would take them first: their rank is lower)
        const o = [...(menu?.options ?? [])].sort((p: Any, q: Any) => p.rank - q.rank).find((x: Any) => x.kind === 'gather' || x.id.startsWith('works:furnace:'));
        if (!o) continue;
        if (o.id === 'gather:sand') sim.offeredSand++;
        const r = w.runChoice(a, o.id, { source: 'fixed', reason: 'workshop_check' });
        if (r.ok) took++;
        // (a pick no longer in the fresh menu falls back to the fixed order: another chore, finished below unlanded)
        const keyed = o.id.startsWith('works:furnace:') ? r.key === `worksfurnace:${o.id.split(':')[2]}` : String(r.key).startsWith(`${o.id}:`);
        if (r.ok && !keyed) sim.fallbacks.push(`${o.id} -> ${r.key}`);
      }
      // Every trip lands: its load deposited, its collect and deposit done
      let going = 0;
      for (const c of w.chores.values() as Iterable<Any>) {
        const g = c.choice?.gather;
        if (!g || !c.status.some((q: Any) => q.state === 'queued' || q.state === 'running')) continue;
        going++;
        const item = itemOf(v, g.material);
        const items = v.storage.chests[0].items;
        items[item] = (items[item] ?? 0) + g.n;
        sim.trips[g.material]++;
        sim.amount[g.material] += g.n;
        if (g.material === 'logs') {
          sim.logsHour += g.n;
          sim.maxLogsTrip = Math.max(sim.maxLogsTrip, g.n);
        }
        Object.assign(c.status[0], { state: 'done', message: `collected ${g.n} ${item}` });
        Object.assign(c.status[1], { state: 'done', message: `deposited ${g.n} ${item} (${item} chest). Storage now holds ${items[item]} ${item}` });
      }
      // A furnace placement stands: recorded on the works plot, its 8 cobblestone taken from storage
      for (const c of w.chores.values() as Iterable<Any>) {
        const k = /^worksfurnace:(\d+)$/.exec(c.key)?.[1];
        if (!k || !c.status.some((q: Any) => q.state === 'queued' || q.state === 'running')) continue;
        const wk = v.layouts[0].works;
        const cell = worksFurnaces(wk)[Number(k) - 1];
        (wk.furnaces ??= [])[Number(k) - 1] = { x: cell.x, y: wk.y + 1, z: cell.z, by: c.agent, at: clock };
        for (let i = 0; i < wk.furnaces.length; i++) wk.furnaces[i] ??= null;
        v.storage.chests[0].items.cobblestone -= 8;
        sim.furnaces++;
      }
      // (any other chore, a fallback's, just ends)
      for (const c of w.chores.values() as Iterable<Any>) for (const q of c.status) if (q.state === 'queued' || q.state === 'running') Object.assign(q, { state: 'done', message: `${q.type} done` });
      w.endChoices();
      // (the sweep's own drop of finished chores: their keys cooled 10 s, the agents free again)
      w.choreKeys(v);
      if (!took && !going) break;
    }
    clock += MIN;
    sim.want = w.gatherWanted(v);
    const menu = w.choices(agents[0]);
    sim.reason = menu?.reasons?.gather;
  } finally {
    unmute();
  }
  return sim;
}

const agentMin = (s: Sim) => Object.entries(s.amount).map(([k, q]) => `${k} ${(q / RATES[k]).toFixed(1)}`).join(', ');
const simLine = (s: Sim) => `${s.furnaces ? `${s.furnaces} works furnaces placed; ` : ''}${s.fallbacks.length ? `FALLBACKS ${s.fallbacks.slice(0, 3).join(', ')}; ` : ''}trips ${Object.entries(s.trips).map(([k, n]) => `${k} ${n} (${s.amount[k]})`).join(', ')}; agent-min at 1x: ${agentMin(s)}; want after ${Object.entries(s.want).map(([k, x]: [string, Any]) => `${k} ${x.want}`).join(', ')}; reason "${s.reason ?? '-'}"`;
{
  if (!BASE) {
    ok(false, `Minevale3 in ${BASE_FILE}`);
  } else {
    for (const works of [false, true]) {
      const s = simulate({}, { works });
      say(`  from nothing${works ? ', works plot ready' : ''}: ${simLine(s)}`);
      for (const k of ['sand', 'logs', 'cobblestone']) {
        ok(s.want[k].want === 0, `from nothing${works ? ' (works)' : ''}: ${k} still wanted (${s.want[k].want})`);
        ok(s.trips[k] <= LIMITS[k], `from nothing${works ? ' (works)' : ''}: ${s.trips[k]} ${k} trips (at most ${LIMITS[k]})`);
        ok(s.trips[k] > 0, `from nothing${works ? ' (works)' : ''}: ${k} gathered at all`);
      }
      ok(s.reason === 'nothing wanted', `from nothing${works ? ' (works)' : ''}: the menu's reason at the end is "nothing wanted" (got "${s.reason}")`);
    }
    // A stocked village with its works furnaces still to place wants nothing gathered: their 8 cobblestone each come from
    // the spare stock first
    {
      const { w, v } = world({ cobblestone: 300, sand: 64, birch_log: 120 }, { works: true });
      mute();
      const g = w.gatherWanted(v);
      unmute();
      for (const k of ['sand', 'logs', 'cobblestone']) ok(g[k].want === 0, `stocked (300 cobblestone, 64 sand, 120 logs), works plot ready, no furnace yet: ${k} wanted ${g[k].want} (need ${g[k].need}; for ${g[k].for.join(', ')})`);
    }
    // A queued furnace placement: its 8 cobblestone, earmarked, are not wanted again as a furnace still missing (S.9's
    // review, lens 2 H1's second form)
    {
      const { w, v, agents } = world({ cobblestone: 30 }, { works: true });
      mute();
      let line = '';
      try {
        clock += MIN;
        const before = w.gatherWanted(v).cobblestone.need;
        const o = w.choices(agents[0])?.options.find((x: Any) => x.id.startsWith('works:furnace:'));
        ok(o, 'a furnace placement offered from 30 cobblestone');
        if (o) {
          w.runChoice(agents[0], o.id, { source: 'fixed', reason: 'workshop_check' });
          const after = w.gatherWanted(v).cobblestone.need;
          ok(after <= before, `a queued furnace placement raised cobblestone's need ${before} -> ${after}`);
          line = `${o.id} queued: cobblestone need ${before} -> ${after}`;
          for (const c of w.chores.values() as Iterable<Any>) for (const q of c.status) Object.assign(q, { state: 'failed', message: 'cancelled' });
          w.endChoices();
          w.choreKeys(v);
          ok(!W9.makeHolds.has(W9.holdKey(v.name, agents[0].name)), 'the furnace placement\'s earmark is deleted when it ends');
        }
      } finally {
        unmute();
      }
      if (line) say(`  from 30 cobblestone, works plot ready: ${line}`);
    }
    const finals = fs.existsSync('runs/2026-10-14/count/storage_final.json') ? JSON.parse(fs.readFileSync('runs/2026-10-14/count/storage_final.json', 'utf8')) : {};
    for (const [name, store] of Object.entries(finals) as Array<[string, Counts]>) {
      const s = simulate(store);
      say(`  from ${name}'s storage: ${simLine(s)}`);
      for (const k of ['sand', 'logs', 'cobblestone']) ok(s.want[k].want === 0, `${name}: ${k} still wanted (${s.want[k].want})`);
    }
    // Sand unavailable: never offered
    const ns = simulate({}, { noSand: true });
    say(`  sand unavailable: ${simLine(ns)}`);
    ok(ns.offeredSand === 0 && ns.trips.sand === 0, `sand unavailable: sand offered ${ns.offeredSand} times`);
    // The hourly cap: 90 of 96 logs gathered this hour already
    const cap = simulate({}, { logsDone: W9.GATHER_LOGS_HOUR - 6 });
    say(`  ${W9.GATHER_LOGS_HOUR - 6} logs gathered this hour: ${simLine(cap)}`);
    ok(cap.logsHour <= W9.GATHER_LOGS_HOUR, `the logs cap: ${cap.logsHour} logs in the hour (at most ${W9.GATHER_LOGS_HOUR})`);
    ok(cap.trips.logs >= 1 && cap.maxLogsTrip <= 6, `the logs cap: the last ${6} logs only (trips ${cap.trips.logs}, largest ${cap.maxLogsTrip})`);
    ok(cap.want.logs.want > 0 && cap.reason !== 'nothing wanted', `the logs cap: logs still wanted but not offered (want ${cap.want.logs.want}, reason "${cap.reason}")`);
    // M1: a queued make's good is netted out of its deficit and its inputs earmarked: no material's need rises
    for (const store of [{ cobblestone: 200, birch_log: 60, sand: 6 }, { cobblestone: 40, birch_log: 30, sand: 30, charcoal: 8 }] as Counts[]) {
      const { w, v, agents } = world(store);
      mute();
      let line = '';
      try {
        clock += MIN;
        const before = w.gatherWanted(v);
        const menu = w.choices(agents[0]);
        const o = menu?.options.find((x: Any) => x.kind === 'make');
        ok(o, `M1 (${fmt(store)}): a make offered`);
        if (o) {
          w.runChoice(agents[0], o.id, { source: 'fixed', reason: 'workshop_check' });
          const after = w.gatherWanted(v);
          const held = W9.makeHolds.get(W9.holdKey(v.name, agents[0].name)) ?? {};
          for (const k of ['sand', 'logs', 'cobblestone']) ok(after[k].need <= before[k].need, `M1 (${fmt(store)}): ${o.id} queued raised ${k}'s need ${before[k].need} -> ${after[k].need}`);
          line = `${o.id} queued (earmarked ${fmt(held)}): need ${['sand', 'logs', 'cobblestone'].map((k) => `${k} ${before[k].need} -> ${after[k].need}`).join(', ')}`;
          // (and ended: the earmark goes, the need is as before)
          for (const c of w.chores.values() as Iterable<Any>) for (const q of c.status) Object.assign(q, { state: 'failed', message: 'cancelled' });
          w.endChoices();
          w.choreKeys(v);
          ok(!W9.makeHolds.has(W9.holdKey(v.name, agents[0].name)), `M1 (${fmt(store)}): the earmark is deleted when the make ends`);
        }
      } finally {
        unmute();
      }
      if (line) say(`  M1 from ${fmt(store)}: ${line}`);
    }
  }
}

// ---- 5. the works furnaces' cells -------------------------------------------------------------------------------------
say('== 5. works furnaces on each side');
{
  const plot = { x1: 0, z1: 0, x2: 40, z2: 40 };
  const sides = new Map<string, Any>();
  for (const c of annexCandidates(plot as Any)) if (!sides.has(c.side)) sides.set(c.side, c);
  const inside = (s: Any, x: number, z: number) => x >= s.x1 && x <= s.x2 && z >= s.z1 && z <= s.z2;
  const distPlot = (x: number, z: number) => Math.max(plot.x1 - x, 0, x - plot.x2) + Math.max(plot.z1 - z, 0, z - plot.z2);
  const STEP: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  for (const [side, r] of sides) {
    const f = worksFurnaces(r);
    const [s0, s1] = annexSlots(r);
    ok(f.length === W9.WORKS_FURNACES, `${side}: ${f.length} furnaces`);
    const alongZ = s0.water.x1 === s0.water.x2;
    const fr = (alongZ ? s0.face === 'n' : s0.face === 'w') ? 0 : 6;
    for (const [i, c] of f.entries()) {
      ok(inside(s0, c.x, c.z), `${side} furnace ${i + 1} at ${c.x},${c.z} in the first slot`);
      ok(!inside(s1, c.x, c.z) && !inside(s1, c.stand[0], c.stand[1]), `${side} furnace ${i + 1}: nothing on the second slot`);
      const row = [0, 1, 2, 3, 4].map((col) => slotCell(s0, col, fr));
      ok(row.some(([x, z]) => x === c.stand[0] && z === c.stand[1]), `${side} furnace ${i + 1}: its stand ${c.stand} on the slot's end row`);
      const [dx, dz] = STEP[c.facing];
      ok(c.x + dx === c.stand[0] && c.z + dz === c.stand[1], `${side} furnace ${i + 1}: faces ${c.facing}, toward its stand`);
      ok(distPlot(c.stand[0], c.stand[1]) < distPlot(c.x, c.z), `${side} furnace ${i + 1}: the stand is on the side facing the plot (${FACING_PLOT[side as 's']})`);
      if (i) ok(Math.abs(c.x - f[i - 1].x) + Math.abs(c.z - f[i - 1].z) === 2, `${side} furnaces ${i} and ${i + 1}: one free column between them`);
    }
    if (VERBOSE) say(`  ${side}: ${f.map((c) => `${c.x},${c.z} ${c.facing} (stand ${c.stand})`).join('; ')}`);
  }
  say(`  ${sides.size} sides`);
}

void storageContents;
fs.rmSync(SCRATCH, { recursive: true, force: true });
say(`${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
