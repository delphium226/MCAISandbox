/**
 * A village that grows, checked offline (runs/2026-10-15/s30/spec_grow.md 7 and its check's L1; no server). Copies of
 * villages.json are loaded into a real MineflayerWorld on a scratch folder (no bots, RCON stubbed, console.log muted, the
 * clock frozen) with MC_GROW=1 and the workshop's families off.
 * (a) Decisions: for every complete village and M members in {3, 25}, isDwelling per structure, H (housesOf), n, the picks
 *     (pickHouses on a copy) and padFor. Minevale44 must give H 2; M 3: n 1 and S 18; M 25: n 4 and S 23.
 * (b) A dry layout of the M 25 picks at --site X,Y,Z (Minevale44's default -1705,65,22: room23.py's -1716..-1694, 11..33) on
 *     a copy, posted by 'grow' in neighbourhood mode: no storage, mine, farm, stations, seeds, pickaxe or plot part tasks;
 *     v.unplaced and v.unavailable unchanged; the record with streets, lamps >= 2, signs = n and grow 1; every Build and log
 *     task behind the prepare; every new id at least `from` (the registry's next id before the call) and every old one below
 *     it; with the village complete and growth active, isGrowTask admits exactly the new open tasks; a second call refused
 *     while the first layout's builds are open. The material check is skipped (no agents: materialsNear is null).
 * (c) The sweep (L1), with fake agents as choice_golden.mts's: Mayor and Worker1-2 idle at +0 and, every queued action done,
 *     at +61 s, when the grow chore (lay_out_houses) must go to the Mayor; then with (b)'s layout active and k growth tasks
 *     claimable, Mayor + Worker1..k+2 and Mayor + Worker1..k idle: the sweep asks no menu of the first k workers in its
 *     order, asks the next worker (or the Mayor when none is left) first, and never holds the Mayor back.
 * Usage: node_modules/.bin/tsx scripts/checks/grow_check.mts [villages.json ...] [--village NAME] [--site X,Y,Z]
 * (default mc/testserver/villages.json, which changes during runs: pass a frozen copy to compare runs). Exits 1 on a FAIL.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const argv = process.argv.slice(2);
const opt = (k: string) => {
  const i = argv.indexOf(k);
  if (i < 0) return undefined;
  const val = argv[i + 1];
  argv.splice(i, 2);
  return val;
};
const ONLY = opt('--village');
const SITE = opt('--site');
const sources = argv.length ? argv : ['mc/testserver/villages.json'];

// (read when the world's modules load: set first)
process.env.MC_GROW = '1';
process.env.MC_CHOOSE = 'fixed';
process.env.MC_CHOICE_INSTANCES = '';
process.env.MC_CHOICE_FAMILIES = '';
process.env.MC_TIME_SCALE = '1';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'grow-check-'));
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'choices.jsonl');
const NOW = Date.parse('2026-10-15T12:00:00Z');
let clock = NOW;
Date.now = () => clock;

const quiet = { log: console.log, warn: console.warn, info: console.info, error: console.error };
const mute = () => { console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const unmute = () => Object.assign(console, quiet);
const say = (s: string) => quiet.log(s);
let fails = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) fails++;
  say(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

// The interfaces of spec 2.1-2.3 (grow.ts, postLayout's opts), written by the core implementer: say what is missing
let G: Any, L: Any, MW: Any, SP: Any;
try {
  G = await import('../../server/src/grow');
  L = await import('../../server/src/layout');
  SP = await import('../../server/src/streetPlan');
  MW = (await import('../../server/src/mineflayer/mcWorld')).MineflayerWorld;
} catch (e) {
  say(`grow_check: cannot load the code under test: ${String((e as Error)?.message ?? e).split('\n')[0]}`);
  process.exit(3);
}
const missing = ['GROW', 'isDwelling', 'housesOf', 'growing', 'isGrowTask', 'pickHouses', 'padFor'].filter((k) => !(k in G));
if (missing.length) {
  say(`grow_check: server/src/grow.ts lacks ${missing.join(', ')} (spec 2.1)`);
  process.exit(3);
}
say(`GROW ${JSON.stringify(G.GROW)}`);

const num = (id: string) => Number(String(id).replace(/\D/g, ''));
const LOG_TASK = (t: Any) => /^Gather \d+ (\w+_log|logs)\b/.test(t.title) || /collect block=(\w+_log|logs)\b/.test(t.detail ?? '');
const FIRST_ONLY = [/^Set up the village storage/, /^Dig the village mine/, /^Plant the farm/, /^Make \d+ stone_pickaxe/, /wheat_seeds/, /^Prepare the village plot, part /];

function world(src: string): Any {
  const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
  fs.copyFileSync(src, path.join(dir, 'villages.json'));
  mute();
  try {
    const w = new MW('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as Any;
    // (nothing written: the copy is the input)
    w.villages.save = () => {};
    w.atlas.sightings = () => [];
    w.atlas.animalSightings = () => [];
    w.atlas.known = () => 1;
    return w;
  } finally {
    unmute();
  }
}

/** Fake members (choice_golden.mts's shape): enqueue records the call; idle while none of its own actions waits or runs.
 *  `brain` gives each its brain (default: a worker's takes board tasks, as TaskBrain's claimsTasks; the mayor's none). */
function members(w: Any, v: Any, names: string[], brain: (name: string) => Any = (n) => (n === 'Mayor' ? null : { name: 'fake', claimsTasks: () => true })) {
  w.agents.clear();
  w.chores?.clear?.();
  const calls: Array<[string, string, Any]> = [];
  const statuses: Any[] = [];
  const home = v.layouts?.[0] ?? { x1: 0, x2: 0, z1: 0, z2: 0, y: 64 };
  const pos = { x: Math.floor((home.x1 + home.x2) / 2) + 0.5, y: (home.y ?? 64) + 1, z: Math.floor((home.z1 + home.z2) / 2) + 0.5 };
  let id = 1;
  for (const name of names) {
    const own: Any[] = [];
    const memory = { village: v.name, villageRole: name === 'Mayor' ? 'mayor' : 'worker' };
    const a: Any = {
      name, role: memory.villageRole, memory, world: w,
      village: () => w.villages.get(memory.village),
      idle: () => !own.some((s) => s.state === 'queued' || s.state === 'running'),
      enqueue: (type: string, args: Any) => {
        const s = { id: id++, type, args, state: 'queued' };
        own.push(s);
        statuses.push(s);
        calls.push([name, type, args]);
        return s;
      },
      bot: { entity: { position: { ...pos } }, entities: {}, inventory: { items: () => [] }, world: { getColumn: () => null }, game: { minY: -64 } },
      brain: brain(name),
    };
    w.agents.set(name.toLowerCase(), a);
  }
  return { calls, statuses };
}

/** One sweep (farmChores with its 30 s gate opened), the members asked for a menu, in order. */
async function sweep(w: Any): Promise<{ asked: string[]; error?: string }> {
  const asked: string[] = [];
  const menu = w.menu;
  w.menu = function (this: Any, v: Any, a: Any, ...rest: Any[]) {
    asked.push(a.name);
    return menu.call(this, v, a, ...rest);
  };
  w.farmCheckAt = 0;
  let error: string | undefined;
  mute();
  try {
    w.farmChores();
    for (let k = 0; k < 5; k++) await new Promise((r) => setImmediate(r));
  } catch (e) {
    error = String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ');
  } finally {
    unmute();
    w.menu = menu;
  }
  return { asked, error };
}

const done = (w: Any, statuses: Any[]) => {
  for (const s of statuses) if (s.state === 'queued' || s.state === 'running') s.state = 'done';
  mute();
  try {
    w.endChoices?.();
  } finally {
    unmute();
  }
};

/** D5 worked out independently of padFor (as runs/2026-10-15/s30/scratch/grow_lamps.mts): n, n - 1, ... houses, sizes 17-29. */
function padRule(designs: Any[]): { size: number; n: number } | null {
  for (let n = designs.length; n >= 1; n--) {
    for (let size = 17; size <= 29; size++) {
      const items = designs.slice(0, n).map((d) => ({ name: d.name, width: d.width, depth: d.depth, ...SP.doorOf(d) }));
      const s = SP.planStreets(0, 0, size, null, items);
      if (!s.unplaced.length && SP.placeLamps(s).length >= 2) return { size, n };
    }
  }
  return null;
}

/** pickHouses and padFor for n houses, on a copy of the village (pickHouses adds library designs to v.designs). */
function decide(w: Any, v: Any, n: number) {
  const lib = w.vanillaLibrary?.(v.vanillaBiome ?? 'plains')?.houses ?? null;
  const copy = structuredClone(v);
  const picks: string[] | null = G.pickHouses(copy, n, lib);
  const pad = picks?.length ? G.padFor(picks.map((p) => copy.designs[p])) : null;
  return { picks, pad, copy, lib };
}

for (const src of sources) {
  say(`== ${src}`);
  const w0 = world(src);
  const villages = ([...w0.villages.villages.values()] as Any[]).filter((v) => v.complete && (!ONLY || v.name.toLowerCase() === ONLY.toLowerCase()));
  if (!villages.length) say('  no complete village');
  for (const v0 of villages) {
    // ---- (a) the decision
    say(`-- ${v0.name} (plan ${v0.plan ?? 'rows'}, biome ${v0.vanillaBiome ?? '-'})`);
    const kinds = (v0.structures ?? []).filter((s: Any) => s.kind !== 'storage').map((s: Any) => `${s.kind} ${G.isDwelling(s.kind) ? 'yes' : 'no'}`);
    const H = G.housesOf(v0);
    say(`  dwellings: ${kinds.join(', ') || 'no structures'}; H ${H}`);
    const byM: Record<number, Any> = {};
    for (const M of [3, 25]) {
      const n = Math.min(G.GROW.batch, M - H);
      if (n <= 0) {
        say(`  M ${M}: enough houses`);
        continue;
      }
      const d = decide(w0, v0, n);
      byM[M] = { n, ...d };
      say(`  M ${M}: n ${n}, picks ${d.picks ? d.picks.join(', ') || 'none' : 'null'} (library ${d.lib ? d.lib.length : 'none'}), pad ${d.pad ? `${d.pad.size} for ${d.pad.n}` : 'null'}`);
    }
    // padFor against D5's rule worked out here: the smallest size 17-29 where the cross street places all n and lamps >= 2
    for (const [M, d] of Object.entries(byM)) {
      if (!d.picks?.length) continue;
      const want = padRule(d.picks.map((p: string) => d.copy.designs[p]));
      check(JSON.stringify(want) === JSON.stringify(d.pad ? { size: d.pad.size, n: d.pad.n } : null), `M ${M}: padFor ${d.pad ? `${d.pad.size} for ${d.pad.n}` : 'null'} = D5's rule ${want ? `${want.size} for ${want.n}` : 'null'}`);
    }
    if (v0.name === 'Minevale44') {
      check(H === 2, `Minevale44 H ${H} (want 2)`);
      check(byM[3]?.n === 1 && byM[3]?.pad?.size === 18, `Minevale44 M 3: n ${byM[3]?.n}, S ${byM[3]?.pad?.size} (want 1, 18)`);
      // (the spec's 23 came from a scratch that tried 17-21, 23 and 25: 22 is checked by the rule above)
      check(byM[25]?.n === 4 && byM[25]?.pad?.n === 4 && byM[25]?.pad?.size <= 23, `Minevale44 M 25: n ${byM[25]?.n}, S ${byM[25]?.pad?.size} for ${byM[25]?.pad?.n} (want 4, at most 23 for 4; the spec says 23)`);
    }

    // ---- (b) a dry layout of the M 25 batch (or the largest there is)
    const at = SITE ?? (v0.name === 'Minevale44' ? '-1705,65,22' : undefined);
    const big = byM[25] ?? byM[3];
    if (!at || !big?.pad) {
      say(`  dry layout: skipped (${!at ? 'no --site for this village' : 'no picks or pad'})`);
      continue;
    }
    const [sx, sy, sz] = at.split(',').map(Number);
    const w = world(src);
    const reg = w.villages;
    const v = reg.get(v0.name);
    const picks: string[] = big.picks.slice(0, big.pad.n);
    for (const p of picks) if (!v.designs[p]) v.designs[p] = structuredClone(big.copy.designs[p]);
    const before = { unplaced: JSON.stringify(v.unplaced ?? null), unavailable: JSON.stringify(v.unavailable ?? null), ids: new Set(v.tasks.map((t: Any) => t.id)), layouts: (v.layouts ?? []).length };
    // (the record's index: 1, or one past the growth layouts a village already ended, G3's own)
    const kWant = (v.growth?.past?.length ?? 0) + 1;
    const from = reg.nextId as number;
    const site = { x: sx, y: sy, z: sz, size: big.pad.size, biome: v.vanillaBiome ?? 'plains' };
    let r: string;
    mute();
    try {
      r = L.postLayout(w, v, 'Worker1', site, picks, true, undefined, { poster: 'grow', neighbourhood: true });
    } catch (e) {
      r = `threw ${String((e as Error)?.stack ?? e).split('\n').slice(0, 2).join(' | ')}`;
    } finally {
      unmute();
    }
    say(`  dry layout of ${picks.join(', ')} on ${big.pad.size}x${big.pad.size} at ${at}: ${String(r).slice(0, 200)}`);
    const fresh = v.tasks.filter((t: Any) => !before.ids.has(t.id));
    check(!/^plan_layout|^threw/.test(String(r)) && fresh.length > 0, `posted ${fresh.length} tasks (spec 5: ~33-37 for 4 houses)`);
    for (const t of fresh) say(`    ${t.id} ${t.postedBy} ${t.soft ? 'soft ' : ''}after [${(t.after ?? []).join(',')}] ${t.title}`);
    const firstOnly = fresh.filter((t: Any) => FIRST_ONLY.some((re) => re.test(t.title)) || t.title === 'Set up the village stations');
    check(!firstOnly.length, `no first-layout tasks${firstOnly.length ? `: ${firstOnly.map((t: Any) => t.title).join('; ')}` : ''}`);
    check(fresh.every((t: Any) => t.postedBy === 'grow'), `every new task posted by 'grow'`);
    check(JSON.stringify(v.unplaced ?? null) === before.unplaced && JSON.stringify(v.unavailable ?? null) === before.unavailable, 'v.unplaced and v.unavailable unchanged');
    const rec = (v.layouts ?? [])[(v.layouts ?? []).length - 1] ?? {};
    check((v.layouts ?? []).length === before.layouts + 1, `one layout record added (${before.layouts} -> ${(v.layouts ?? []).length})`);
    check((rec.streets ?? []).length > 0 && (rec.lamps ?? []).length >= 2 && (rec.signs ?? []).length === picks.length && rec.grow === kWant,
      `record: streets ${(rec.streets ?? []).length}, lamps ${(rec.lamps ?? []).length} (>= 2), signs ${(rec.signs ?? []).length} (${picks.length}), grow ${rec.grow} (${kWant})`);
    const prep = fresh.find((t: Any) => /^Prepare the village plot/.test(t.title));
    const byId = new Map(v.tasks.map((t: Any) => [t.id, t]));
    const behind = (t: Any, goal: string, seen = new Set<string>()): boolean =>
      (t.after ?? []).some((i: string) => i === goal || (!seen.has(i) && seen.add(i) && byId.has(i) && behind(byId.get(i), goal, seen)));
    const builds = fresh.filter((t: Any) => /^Build /.test(t.title));
    const logs = fresh.filter(LOG_TASK);
    check(!!prep, `a prepare task${prep ? ` (${prep.id} ${prep.title})` : ''}`);
    check(builds.length === picks.length && !!prep && builds.every((t: Any) => behind(t, prep.id)), `${builds.length} builds (${picks.length}), all behind the prepare`);
    check(!!prep && logs.every((t: Any) => behind(t, prep.id)), `${logs.length} log tasks, all behind the prepare${logs.filter((t: Any) => !prep || !behind(t, prep.id)).map((t: Any) => ` (not ${t.id})`).join('')}`);
    check(fresh.every((t: Any) => num(t.id) >= from) && [...before.ids].every((i) => num(i as string) < from), `every new id >= ${from} and every old one below`);
    // The claim gate's predicate, with the village complete and the layout active
    v.complete = true;
    v.growth = {
      active: { k: 1, layout: (v.layouts ?? []).length, from, at: clock, by: 'Worker1', plot: { x1: rec.x1, z1: rec.z1, x2: rec.x2, z2: rec.z2 }, houses: picks,
                builds: builds.map((t: Any) => t.id), members: 25, before: G.housesOf(v), changed: clock, sig: '' },
      past: [],
    };
    const open = v.tasks.filter((t: Any) => t.status === 'open');
    const admitted = open.filter((t: Any) => G.isGrowTask(v, t)).map((t: Any) => t.id).sort();
    const want = fresh.filter((t: Any) => t.status === 'open').map((t: Any) => t.id).sort();
    check(G.growing(v) && JSON.stringify(admitted) === JSON.stringify(want), `growing, isGrowTask admits exactly the ${want.length} new open tasks (admitted ${admitted.length} of ${open.length} open)`);
    const claimable = reg.claimable(v) as Any[];
    check(claimable.every((t) => fresh.includes(t)), `claimable now: ${claimable.length}, all new (${claimable.map((t) => t.id).join(',')})`);
    // A second layout while the first one's builds are open
    const n0 = v.tasks.length;
    let r2: string;
    mute();
    try {
      r2 = L.postLayout(w, v, 'Worker1', { ...site, x: sx + 40 }, picks, true, undefined, { poster: 'grow', neighbourhood: true });
    } catch (e) {
      r2 = `threw ${String((e as Error)?.message ?? e)}`;
    } finally {
      unmute();
    }
    check(/^plan_layout/.test(String(r2)) && v.tasks.length === n0, `a second call refused: ${String(r2).slice(0, 140)}`);

    // ---- (c) the sweep (L1): the grow chore to the Mayor at +61 s; k workers held back while growing
    const w1 = world(src);
    const v1 = w1.villages.get(v0.name);
    delete v1.growth;
    clock = NOW;
    // (one member more than the houses standing, at least the Mayor and two workers: G3 has 3 houses)
    const crew = ['Mayor', ...Array.from({ length: Math.max(2, H) }, (_, i) => `Worker${i + 1}`)];
    const m1 = members(w1, v1, crew);
    const s0 = await sweep(w1);
    const mayor0 = ([...w1.chores.values()] as Any[]).find((c) => c.agent === 'Mayor');
    say(`  sweep +0 s: asked ${s0.asked.join(', ') || 'nobody'}; chores ${([...w1.chores.values()] as Any[]).map((c) => `${c.agent}:${c.key}`).join(', ') || 'none'}${s0.error ? `; threw ${s0.error}` : ''}`);
    say(`  (M1: the Mayor ${mayor0 ? `took ${mayor0.key} at +0` : 'was left out at +0'})`);
    check(!s0.error && !([...w1.chores.values()] as Any[]).some((c) => /^grow/.test(c.key)), 'no grow chore inside the first 60 s');
    done(w1, m1.statuses);
    clock = NOW + 61000;
    const s1 = await sweep(w1);
    const grow = ([...w1.chores.values()] as Any[]).find((c) => /^grow/.test(c.key));
    const call = m1.calls.find(([, type]) => type === 'lay_out_houses');
    say(`  sweep +61 s: asked ${s1.asked.join(', ') || 'nobody'}; chores ${([...w1.chores.values()] as Any[]).map((c) => `${c.agent}:${c.key}`).join(', ') || 'none'}${s1.error ? `; threw ${s1.error}` : ''}`);
    check(!s1.error && grow?.agent === 'Mayor' && call?.[0] === 'Mayor', `+61 s: the grow chore to the Mayor (${grow ? `${grow.agent}:${grow.key}` : 'none'}; lay_out_houses ${call ? `by ${call[0]} ${JSON.stringify(call[2])}` : 'not queued'})`);
    if (v0.name === 'Minevale44' && call) {
      // (a list or a comma-separated string, as postLayout takes either)
      const hs = Array.isArray(call[2].houses) ? call[2].houses : String(call[2].houses ?? '').split(',').filter(Boolean);
      check(hs.length === 1 && Number(call[2].size) === 18, `lay_out_houses houses ${JSON.stringify(call[2].houses)} size ${call[2].size} (want 1 house, 18)`);
    }

    // While growing: (b)'s layout active, k growth tasks claimable
    const k = claimable.filter((t) => G.isGrowTask(v, t)).length;
    for (const extra of [2, 0]) {
      const names = ['Mayor', ...Array.from({ length: k + extra }, (_, i) => `Worker${i + 1}`)];
      if (names.length > 25) {
        say(`  growing, ${names.length} members: skipped (more than 25)`);
        continue;
      }
      clock = NOW + 120000;
      w.chores?.clear?.();
      members(w, v, names);
      mute();
      const order: string[] = (w.idleMembers(v, clock) as Any[]).map((a) => a.name);
      unmute();
      const workers = order.filter((n) => n !== 'Mayor');
      const s = await sweep(w);
      const held = workers.slice(0, k);
      const firstWant = workers[k] ?? 'Mayor';
      say(`  growing, k ${k}, idle ${order.length}: asked ${s.asked.join(', ') || 'nobody'}${s.error ? `; threw ${s.error}` : ''}`);
      check(!s.error && !s.asked.some((n) => held.includes(n)) && s.asked[0] === firstWant,
        `the first ${k} workers held back, ${firstWant} asked first${s.asked.some((n) => held.includes(n)) ? ` (asked held ${s.asked.filter((n) => held.includes(n)).join(', ')})` : ''}`);
      if (extra === 0) check(s.asked.includes('Mayor'), 'the Mayor not held back');
    }
    clock = NOW;

    // ---- (d) the review's fixes (s30's fixer), each on a fresh copy with (b)'s layout posted and active
    const lay = (wood0 = false) => {
      const wd = world(src);
      const vd = wd.villages.get(v0.name);
      for (const p of picks) if (!vd.designs[p]) vd.designs[p] = structuredClone(big.copy.designs[p]);
      let asked = 0;
      // (lens 2 M1: the material check sees no standing tree near the site, everything else in full)
      if (wood0) wd.materialsNear = (_by: string, amount: Record<string, number>) => (asked++, Object.fromEntries(Object.keys(amount).map((b) => [b, /(^|_)logs?$/.test(b) ? 0 : amount[b]])));
      const ids = new Set(vd.tasks.map((t: Any) => t.id));
      const fromD = wd.villages.nextId as number;
      let out: string;
      mute();
      try {
        out = L.postLayout(wd, vd, 'Worker1', site, picks, true, undefined, { poster: 'grow', neighbourhood: true });
      } finally {
        unmute();
      }
      const freshD = vd.tasks.filter((t: Any) => !ids.has(t.id));
      const recD = vd.layouts[vd.layouts.length - 1];
      vd.complete = true;
      vd.growth = {
        active: { k: 1, layout: vd.layouts.length, from: fromD, at: clock, by: 'Worker1', plot: { x1: recD.x1, z1: recD.z1, x2: recD.x2, z2: recD.z2 }, houses: picks,
                  builds: freshD.filter((t: Any) => /^Build /.test(t.title)).map((t: Any) => t.id), members: 25, before: G.housesOf(vd), changed: clock, sig: '' },
        past: [],
      };
      return { wd, vd, out, fresh: freshD, asked: () => asked };
    };
    const ended = (wd: Any, vd: Any, at: number) => {
      mute();
      try {
        wd.growEnd(vd, at);
      } finally {
        unmute();
      }
    };
    {
      const d = lay(true);
      check(/^Laid out/.test(d.out) && d.asked() === 0, `M1: a neighbourhood skips the material check (asked ${d.asked()}x, want 0: its houses were built here before): ${d.out.slice(0, 90)}`);
    }
    {
      // L-3/M2: an idle holder whose brain does not hold the task gives it back on the 4th check; one spawned again since its
      // claim at once; one whose brain holds it keeps it
      const d = lay();
      members(d.wd, d.vd, ['Mayor', 'Worker1', 'Worker2', 'Worker3'], (n) => (n === 'Mayor' ? null : { claimsTasks: () => true, holdsTask: () => n === 'Worker2' }));
      const [t1, t2, t3] = d.fresh.filter((t: Any) => t.status === 'open');
      for (const [t, by] of [[t1, 'Worker1'], [t2, 'Worker2'], [t3, 'Worker3']] as Array<[Any, string]>) Object.assign(t, { status: 'claimed', claimedBy: by, claimedAt: clock - 1000 });
      d.wd.spawnedAt.set('worker3', clock);
      for (let i = 0; i < 3; i++) ended(d.wd, d.vd, clock + i * 30000);
      const after3 = [t1.status, t2.status, t3.status].join(',');
      ended(d.wd, d.vd, clock + 90000);
      check(after3 === 'claimed,claimed,open' && t1.status === 'open' && t2.status === 'claimed',
        `orphaned claims: after 3 checks ${after3} (want claimed,claimed,open), after 4 ${t1.status},${t2.status},${t3.status} (want open,claimed,open)`);
    }
    {
      // L-1: with every house built, gathering an open task waits for stays; the rest is closed
      const d = lay();
      members(d.wd, d.vd, ['Mayor', 'Worker1']);
      for (const t of d.fresh) if (/^(Build |Prepare )/.test(t.title)) t.status = 'done';
      const lamps = d.fresh.find((t: Any) => /^Light the streets/.test(t.title));
      const [g1, g2] = d.wd.villages.post(d.vd, [1, 2].map(() => ({ title: 'Gather 4 coal for the street lamps', detail: 'collect block=coal count=4, then deposit all', soft: true, after: [] })), 'Worker1', 20);
      lamps.after = [...lamps.after, g1.id];
      ended(d.wd, d.vd, clock);
      const houseGather = d.fresh.filter((t: Any) => /^collect block=/.test(t.detail) && t.status === 'open');
      check(g1.status === 'open' && g2.status === 'done' && !houseGather.length, `L-1: the lamps' gathering ${g1.status} (open), another ${g2.status} (done), the houses' gathering open ${houseGather.length} (0)`);
    }
    {
      // L7: a failed house's own gathering is closed at once
      const d = lay();
      members(d.wd, d.vd, ['Mayor', 'Worker1']);
      const b = d.fresh.find((t: Any) => /^Build /.test(t.title));
      b.status = 'failed';
      const gat = b.after.map((id: string) => d.vd.tasks.find((t: Any) => t.id === id)).filter((t: Any) => t && /^collect block=/.test(t.detail) && t.soft);
      // (its own, and what another open task waits for too: the windows' sand, which stays)
      const shared = (t: Any) => d.vd.tasks.some((o: Any) => o !== b && o.status === 'open' && o.after.includes(t.id));
      const own = gat.filter((t: Any) => !shared(t)), kept = gat.filter(shared);
      ended(d.wd, d.vd, clock);
      check(own.length > 0 && own.every((t: Any) => t.status === 'done') && kept.every((t: Any) => t.status === 'open'),
        `L7: the failed house's own ${own.length} gather tasks closed (${own.map((t: Any) => t.status).join(',')}), ${kept.length} shared kept (${kept.map((t: Any) => t.status).join(',')})`);
    }
    {
      // lens 3 L1/L2: every house built, the lamps and signs left with no worker able to claim: ended as built after 10 min
      const d = lay();
      members(d.wd, d.vd, ['Mayor', 'Worker1'], () => null);
      for (const t of d.fresh) if (!/^(Light the streets|Put up the sign)/.test(t.title)) t.status = 'done';
      ended(d.wd, d.vd, clock);
      ended(d.wd, d.vd, clock + 10 * 60000 + 1);
      const p = d.vd.growth.past[0];
      check(!d.vd.growth.active && p?.why === 'built' && (p?.left ?? 0) > 0 && !d.vd.growth.fails, `lens 3 L2: ended ${p?.why} with ${p?.left} left open, fails ${d.vd.growth.fails ?? 0} (want built, > 0, 0)`);
    }
    {
      // lens 3 M1: with growth off, an inherited neighbourhood still ends
      const d = lay();
      members(d.wd, d.vd, ['Mayor', 'Worker1']);
      for (const t of d.fresh) t.status = 'done';
      d.wd.growSeen.set(d.vd.name, clock - 61000);
      G.GROW.on = false;
      mute();
      try {
        d.wd.growTick(d.vd);
      } finally {
        unmute();
        G.GROW.on = true;
      }
      check(!d.vd.growth.active && d.vd.growth.past.length === 1, `lens 3 M1: growth off, the neighbourhood ended (${d.vd.growth.active ? 'still active' : `past ${d.vd.growth.past.length}`})`);
    }
    {
      // L-2: no pickaxe supply in a complete village
      const d = lay();
      members(d.wd, d.vd, ['Mayor', 'Worker1', 'Worker2', 'Worker3']);
      d.vd.tasks = d.vd.tasks.filter((t: Any) => !/stone_pickaxe|for stone pickaxes/.test(t.title));
      const n0 = d.vd.tasks.length;
      mute();
      try {
        d.wd.pickaxeSupply(d.vd, { oak_log: 20, cobblestone: 200 }, 'oak');
      } finally {
        unmute();
      }
      check(d.vd.tasks.length === n0, `L-2: no pickaxe supply posted in a complete village (${d.vd.tasks.length - n0} posted; mine level ${d.vd.mine?.level ?? 'none'})`);
    }
    {
      // L-6: no grow chore when no worker takes board tasks
      const wn = world(src);
      const vn = wn.villages.get(v0.name);
      delete vn.growth;
      clock = NOW;
      const mn = members(wn, vn, crew, () => null);
      await sweep(wn);
      done(wn, mn.statuses);
      clock = NOW + 61000;
      await sweep(wn);
      check(!([...wn.chores.values()] as Any[]).some((c) => /^grow/.test(c.key)), 'L-6: no grow chore with no worker able to claim');
      clock = NOW;
    }
  }
}
fs.rmSync(SCRATCH, { recursive: true, force: true });
say(`grow_check: ${fails} failures`);
process.exit(fails ? 1 : 0);
