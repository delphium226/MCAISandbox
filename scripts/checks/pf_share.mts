/**
 * The pathfinder's shared search allowance checked offline (E.1; no server): the patched A* (patches/
 * mineflayer-pathfinder+2.4.5.patch) on a stub world, a flat 160x160 floor with brick walls, the walks' movement rules
 * (no parkour, no digging, no scaffolding). Searches are called as the pathfinder's tick calls them: a timer every
 * 50 / scale ms catching up with two ticks when it fires late, as Mineflayer's physics does. Checks:
 *   1. one search alone, at 1x and at 2x, gets its full tickTimeout every tick (15 and 7.5 ms), never refused or cut;
 *   2. two and three searches whose demand fits the allowance (2 x 8 ms, 3 x 5 ms a 50 ms tick) get theirs in full, and
 *      so do up to three at the real budgets (15 ms a tick at 1x, 7.5 at 2x: never cut, MC_PF_FREE_SEARCHES); four at the
 *      real budgets share the allowance evenly and use most of it;
 *   3. 25 searches continued on their own 50 ms timers (staggered, as each bot's physics tick is), every call
 *      compute(true): the compute time inside a 50 ms stretch of wall time is at most the larger of the allowance and
 *      three full ticks (up to three searches are never cut) + 1 ms in all but 0.1% of stretches (the OS or the collector
 *      can stop a call midway; never over twice that); every search
 *      is served about as often as the others and again within a few windows (no starvation by creation order) and
 *      finds its path; each path is the one the search finds unthrottled, node for node; the same at MC_TIME_SCALE 2
 *      (the same allowance, ticks every 25 ms of 7.5 ms each);
 *   (DEBUG=1 prints the fullest window's calls: start in it, search, ms, +nodes expanded)
 *   4. compute() without the flag (the rescue's search) ignores the allowance and is not charged, and times out on the
 *      wall clock at its timeout; so does a shared search never held back;
 *   5. first slices (compute('first'), getPathTo's) are charged but never refused or cut, and continued searches then
 *      yield;
 *   6. a held-back search gets the time it was held back off its timeout, up to a wall cap of 3x the timeout;
 *   7. a dropped search is forgotten (AStar.forget: the queue and the demand shrink), and a finished one leaves the queue.
 * Usage: node_modules/.bin/tsx scripts/checks/pf_share.mts   (MC_PF_TICK_MS= to try another allowance)
 */
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

/* eslint-disable @typescript-eslint/no-explicit-any */
const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const reg = require('prismarine-registry')('26.1');
const Block = require('prismarine-block')(reg);
const AStar = require('mineflayer-pathfinder/lib/astar');
const Movements = require('mineflayer-pathfinder/lib/movements');
const Move = require('mineflayer-pathfinder/lib/move');
const { goals } = require('mineflayer-pathfinder');

const say = console.log;
let failures = 0;
let checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    say(`FAIL ${what}`);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TICK_MS = Number(process.env.MC_PF_TICK_MS ?? 20);

// --- The stub world: grass at y 63 over stone, air above; brick walls 3 high (seeded); nothing outside 0..159
const SIZE = 160;
let seed = 1793578865;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const wall = new Set<string>();
for (let i = 0; i < 260; i++) {
  const x = 8 + Math.floor(rand() * (SIZE - 16)), z = 8 + Math.floor(rand() * (SIZE - 16));
  const along = rand() < 0.5, len = 4 + Math.floor(rand() * 14);
  for (let k = 0; k < len; k++) wall.add(along ? `${x + k},${z}` : `${x},${z + k}`);
}
const ids: Record<string, number> = {};
for (const n of ['air', 'grass_block', 'stone', 'bricks']) ids[n] = reg.blocksByName[n].defaultState ?? reg.blocksByName[n].minStateId;
function nameAt(x: number, y: number, z: number): string | null {
  if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || y < 58 || y > 80) return null;
  if (y < 63) return 'stone';
  if (y === 63) return 'grass_block';
  if (y <= 66 && wall.has(`${x},${z}`)) return 'bricks';
  return 'air';
}
// (one Block a cell, kept: Movements writes its own fields onto what it gets, the same for a cell every time; a new one
// on every read made garbage enough for collector pauses of several ms inside one expansion)
const blocks = new Map<string, any>();
function blockAt(pos: any) {
  const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
  const k = `${x},${y},${z}`;
  let b = blocks.get(k);
  if (b === undefined) {
    const n = nameAt(x, y, z);
    b = n === null ? null : Block.fromStateId(ids[n], 0);
    if (b) b.position = new Vec3(x, y, z);
    blocks.set(k, b);
  }
  return b;
}
const bot: any = {
  version: '26.1', registry: reg, blockAt, entities: {}, game: { minY: -64, height: 384 },
  entity: { position: new Vec3(0, 64, 0), onGround: true },
  inventory: { slots: [], items: () => [] },
  pathfinder: { bestHarvestTool: () => null },
};
const moves = new Movements(bot);
moves.allowParkour = false;
moves.canDig = false;
moves.scafoldingBlocks = [];
moves.allowSprinting = true;

// 25 searches across the floor, west to east, a different row each
const N = 25;
function searchSpec(i: number) {
  const z0 = 3 + i * 6, z1 = SIZE - 4 - ((i * 37) % (SIZE - 8));
  const free = (x: number, z: number) => !wall.has(`${x},${z}`);
  let x0 = 2; while (!free(x0, z0)) x0++;
  let x1 = SIZE - 3; while (!free(x1, z1)) x1--;
  return { start: new Move(x0, 64, z0, 0, 0), goal: new goals.GoalNear(x1, 64, z1, 1) };
}
// a search that never ends on its own: the goal hangs in the air over the floor, so the whole floor is searched
function longSpec(i: number) {
  return { start: searchSpec(i).start, goal: new goals.GoalBlock(SIZE / 2, 75, SIZE / 2) };
}
const pathKey = (p: any[]) => p.map((n) => `${n.x},${n.y},${n.z}`).join(' ');

// --- Unthrottled baseline: each search in one call
const base: { status: string; key: string; ms: number; nodes: number }[] = [];
for (let i = 0; i < N; i++) {
  const { start, goal } = searchSpec(i);
  const a = new AStar(start, moves, goal, 1e9, 1e9);
  const t = performance.now();
  const r = a.compute();
  base.push({ status: r.status, key: pathKey(r.path), ms: performance.now() - t, nodes: r.visitedNodes });
}
const baseMs = base.reduce((s, b) => s + b.ms, 0);
say(`baseline: ${base.filter((b) => b.status === 'success').length}/${N} found, ${baseMs.toFixed(0)} ms of search in all `
  + `(${Math.min(...base.map((b) => b.ms)).toFixed(1)}-${Math.max(...base.map((b) => b.ms)).toFixed(1)} ms, `
  + `${Math.min(...base.map((b) => b.nodes))}-${Math.max(...base.map((b) => b.nodes))} nodes a search)`);
ok(base.every((b) => b.status === 'success'), 'every baseline search finds its goal');
{
  const { start, goal } = longSpec(0);
  const a = new AStar(start, moves, goal, 1e9, 1e9);
  const t = performance.now();
  const r = a.compute();
  say(`the long search: ${r.status} after ${(performance.now() - t).toFixed(0)} ms, ${r.visitedNodes} nodes`);
  ok(r.status === 'noPath' && performance.now() - t > 150, 'the long search runs over 150 ms unthrottled');
}

/**
 * Calls `onTick` as Mineflayer's physics does: a timer every 50 / scale ms, with as many ticks as the time since the last
 * one holds (two when the timer fires late; Windows timers fire on ~15.6 ms steps). Ends when onTick returns true or after
 * `ms` of wall time.
 */
function physicsTicks(scale: number, ms: number, onTick: () => boolean): Promise<void> {
  const step = 50 / scale;
  return new Promise((done) => {
    const t0 = performance.now();
    let last = t0, acc = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      acc += now - last;
      last = now;
      while (acc >= step) {
        acc -= step;
        if (onTick() || performance.now() - t0 > ms) {
          clearInterval(timer);
          done();
          return;
        }
      }
    }, step);
  });
}

// --- 1 and 2: searches whose demand fits get their full tickTimeout every tick (full false: a demand over the allowance,
// shared evenly)
async function fits(scale: number, tickTimeouts: number[], full = true) {
  AStar.configureShare({ tickMs: TICK_MS });
  const before = AStar.shareStats();
  const runs = tickTimeouts.map((tt, i) => {
    const { start, goal } = longSpec(i);
    return { a: new AStar(start, moves, goal, 1e9, tt), tt, calls: 0, full: 0, ms: 0, worst: Infinity };
  });
  const t0 = performance.now();
  await physicsTicks(scale, 600, () => {
    for (const r of runs) {
      const s = performance.now();
      const res = r.a.compute(true);
      const e = performance.now() - s;
      if (res.status !== 'partial') continue;
      r.calls++;
      r.ms += e;
      if (!res.refused && e >= r.tt) r.full++;
      r.worst = Math.min(r.worst, e);
    }
    return false;
  });
  const wall = performance.now() - t0;
  const stats = AStar.shareStats();
  const refused = stats.refused - before.refused;
  say(`${runs.length} search${runs.length > 1 ? 'es' : ''} at ${scale}x (tickTimeout ${tickTimeouts.join(', ')} ms, a tick every ${50 / scale} ms): `
    + runs.map((r) => `${r.calls} calls, ${r.full} full, ${(r.ms / r.calls).toFixed(2)} ms a call (least ${r.worst.toFixed(2)}), ${(r.ms / wall * 50).toFixed(1)} ms a 50 ms window`).join('; ')
    + `; ${refused} refused; demand estimated ${stats.demandMs.toFixed(1)} ms of ${stats.allowanceMs}`);
  if (full) {
    ok(refused === 0, `${runs.length} at ${scale}x: none refused (${refused})`);
    runs.forEach((r, i) => ok(r.calls >= 10 && r.full === r.calls, `${runs.length} at ${scale}x: search ${i} got its full ${r.tt} ms on every call (${r.full}/${r.calls})`));
  } else {
    const per = runs.map((r) => r.ms / wall * 50);
    ok(Math.min(...per) >= 0.6 * Math.max(...per), `${runs.length} at ${scale}x over the allowance: shared evenly (${per.map((p) => p.toFixed(1)).join(', ')} ms a window)`);
    const sum = per.reduce((a, b) => a + b, 0);
    ok(sum >= 0.6 * stats.allowanceMs && sum <= stats.allowanceMs + 1, `${runs.length} at ${scale}x over the allowance: most of it used, no more (${sum.toFixed(1)} ms a window)`);
  }
  for (const r of runs) AStar.forget(r.a);
}
await fits(1, [15]);
await fits(2, [7.5]);
await fits(1, [8, 8]);
await fits(1, [5, 5, 5]);
await fits(2, [4, 4]);
// (the real budgets, 15 ms a tick at 1x and 7.5 at 2x: up to three searches at once are never cut, as before the share)
await fits(1, [15, 15]);
await fits(1, [15, 15, 15]);
await fits(2, [7.5, 7.5]);
await fits(2, [7.5, 7.5, 7.5]);
await fits(1, [15, 15, 15, 15], false);
await fits(2, [7.5, 7.5, 7.5, 7.5], false);
await sleep(60);

/**
 * The sums of compute time inside windows of `win` ms: the largest (reached with a window starting at a call's start or
 * ending at a call's end) and the share of those windows over `limit`.
 */
function windowSums(spans: { s: number; e: number }[], win: number, limit: number) {
  const sorted = [...spans].sort((a, b) => a.s - b.s);
  let best = 0, over = 0;
  const overlap = (w0: number) => {
    let sum = 0;
    for (const sp of sorted) {
      if (sp.s >= w0 + win) break;
      sum += Math.max(0, Math.min(sp.e, w0 + win) - Math.max(sp.s, w0));
    }
    return sum;
  };
  for (const sp of sorted) {
    for (const sum of [overlap(sp.s), overlap(sp.e - win)]) {
      best = Math.max(best, sum);
      if (sum > limit) over++;
    }
  }
  return { best, over: over / (2 * sorted.length) };
}

// --- 3: 25 searches continued tick by tick, each on its own timer
async function shared(scale: number) {
  const allowance = AStar.configureShare({ tickMs: TICK_MS });
  const tick = 50 / scale;
  const before = AStar.shareStats();
  // (each call: start, end, the search, nodes expanded)
  const spans: { s: number; e: number; i: number; n: number }[] = [];
  const runs = Array.from({ length: N }, (_, i) => {
    const { start, goal } = searchSpec(i);
    return { a: new AStar(start, moves, goal, 15000, 15 / scale), result: null as any, lastServed: 0, worstGap: 0, calls: 0, served: 0, early: 0, slices: 0 };
  });
  const t0 = performance.now();
  for (const r of runs) r.lastServed = t0;
  await new Promise<void>((done) => {
    let left = N;
    runs.forEach((r, i) => {
      // (staggered starts: bots' physics timers are not in step)
      setTimeout(() => {
        const timer = setInterval(() => {
          const closed = r.a.closedDataSet.size;
          const s = performance.now();
          const res = r.a.compute(true);
          const e = performance.now();
          spans.push({ s, e, i, n: r.a.closedDataSet.size - closed });
          r.calls++;
          if (r.a.closedDataSet.size > closed || res.status !== 'partial') {
            r.served++;
            if (s - t0 >= 100 && e - t0 < 1100) { r.early += e - s; r.slices++; }
            r.worstGap = Math.max(r.worstGap, s - r.lastServed);
            r.lastServed = e;
          }
          if (res.status !== 'partial') {
            r.result = res;
            clearInterval(timer);
            if (--left === 0) done();
          }
        }, tick);
      }, (i * 7) % tick);
    });
  });
  const wall = performance.now() - t0;
  const stats = AStar.shareStats();
  // (up to three searches asking at once are never cut: while only that many are left, a window may hold three full
  // ticks of search)
  const bound = Math.max(allowance, 3 * 15);
  const { best: worst, over } = windowSums(spans, 50, bound + 1);
  if (process.env.DEBUG) {
    // the fullest window from a call's start: each call as start in it : search : ms (+ nodes expanded)
    const inWin = (w0: number) => spans.filter((q) => q.e > w0 && q.s < w0 + 50);
    const sumAt = (w0: number) => inWin(w0).reduce((t, q) => t + Math.min(q.e, w0 + 50) - Math.max(q.s, w0), 0);
    const w0 = spans.reduce((b, sp) => (sumAt(sp.s) > sumAt(b) ? sp.s : b), spans[0].s);
    say(`  fullest window ${sumAt(w0).toFixed(2)} ms: ${inWin(w0).map((q) => `${(q.s - w0).toFixed(1)}:${q.i}:${(q.e - q.s).toFixed(2)}${q.n ? `+${q.n}` : ''}`).join(' ')}`);
  }
  const compute = spans.reduce((s, sp) => s + sp.e - sp.s, 0);
  const gaps = runs.map((r) => r.worstGap);
  say(`25 searches at ${scale}x: allowance ${allowance.toFixed(1)} ms a 50 ms window; ${spans.length} calls (${stats.served - before.served} served, `
    + `${stats.refused - before.refused} refused), ${compute.toFixed(0)} ms of search in ${(wall / 1000).toFixed(1)} s `
    + `(${(compute / wall * 50).toFixed(1)} ms a window on average); the fullest 50 ms window ${worst.toFixed(2)} ms, ${(over * 100).toFixed(3)}% of windows over ${bound + 1} ms; `
    + `longest wait for a slice ${Math.max(...gaps).toFixed(0)} ms (median ${[...gaps].sort((a, b) => a - b)[Math.floor(N / 2)].toFixed(0)})`);
  // The share holds a window to the allowance and one expansion. Wall time also counts the moments the OS gives the CPU
  // to another process or the collector pauses inside a call: on a busy machine a window now and then is a few ms over
  // (15.5 ms once at 2x, one window in thousands), so the rule is "almost never over, never far over"
  ok(over <= 0.001, `scale ${scale}: at most 0.1% of 50 ms windows above ${bound} + 1 ms (got ${(over * 100).toFixed(3)}%)`);
  ok(worst <= 2 * bound, `scale ${scale}: no 50 ms window above twice the bound (got ${worst.toFixed(2)})`);
  // Fair, whatever a search's place in the order: in the second after all 25 started each was served about as often
  // (a slice's length varies: an expansion or a window with room to spare), and none waited long for a slice (25 slices
  // of ~1.5 ms take two windows of 20 ms; Windows timers fire every ~15.6 ms)
  const slices = runs.map((r) => r.slices), early = runs.map((r) => r.early);
  say(`  in the second after all started: ${Math.min(...slices)}-${Math.max(...slices)} slices a search `
    + `(the first 5 created ${slices.slice(0, 5).join(' ')}, the last 5 ${slices.slice(-5).join(' ')}), `
    + `${Math.min(...early).toFixed(1)}-${Math.max(...early).toFixed(1)} ms of search`);
  ok(Math.min(...slices) >= Math.max(...slices) / 2, `scale ${scale}: every search served at least half as often as the most served (${Math.min(...slices)}-${Math.max(...slices)})`);
  ok(Math.max(...gaps) <= 10 * 50, `scale ${scale}: every search served within 10 windows (worst ${Math.max(...gaps).toFixed(0)} ms)`);
  runs.forEach((r, i) => {
    ok(r.result?.status === 'success', `scale ${scale}: search ${i} found its goal (${r.result?.status})`);
    ok(r.result && pathKey(r.result.path) === base[i].key, `scale ${scale}: search ${i}'s path is the unthrottled one`);
  });
  // (the slower search is the price: wall time against the work at the allowance's rate)
  ok(wall >= baseMs / allowance * 50 * 0.5, `scale ${scale}: the searches were spread over the windows`);
  ok(stats.owed === 0 && stats.searches === 0, `scale ${scale}: finished searches leave the queue and the demand (${stats.owed} queued, ${stats.searches} asking)`);
}
await shared(1);
await shared(2);

// --- 4: compute() without the flag is neither held back nor charged, and times out on the wall clock
{
  await sleep(60);
  AStar.configureShare({ tickMs: TICK_MS, free: 0 });
  const { start, goal } = searchSpec(N - 1);
  const hogs = Array.from({ length: 6 }, (_, i) => new AStar(longSpec(i).start, moves, longSpec(i).goal, 15000, 15));
  for (const h of hogs) h.compute(true); // the window's allowance spent (the first fits, the rest share what is left)
  const spent = AStar.shareStats();
  const a = new AStar(start, moves, goal, 15000, 5);
  const r = a.compute();
  const after = AStar.shareStats();
  say(`unshared: the window held ${spent.usedMs.toFixed(1)} of ${spent.allowanceMs} ms; compute() then expanded ${a.closedDataSet.size} nodes (${r.status})`);
  ok(spent.usedMs >= spent.allowanceMs - 1, 'the hogs spent the window');
  ok(a.closedDataSet.size > 0, 'compute() expands nodes with the window spent');
  ok(after.calls === spent.calls && Math.abs(after.usedMs - spent.usedMs) < 1e-9, 'compute() is not charged to the window');
  const refusedBefore = after.refused;
  const b = new AStar(start, moves, goal, 15000, 5);
  const rb = b.compute(true);
  ok(b.closedDataSet.size === 0 && rb.status === 'partial' && rb.refused === true && AStar.shareStats().refused === refusedBefore + 1,
    `compute(true) with the window spent returns partial unexpanded and marked refused (${b.closedDataSet.size} nodes, ${rb.status})`);
  ok(Array.isArray(rb.path) && rb.path === rb.path, 'a refused call still gives a path (the best so far, built once when read)');
  rb.path = ['x'];
  ok(rb.path.length === 1, "a refused call's path can be replaced (index.js assigns the post-processed path)");
  for (const h of [...hogs, b]) AStar.forget(h);

  await sleep(60);
  const { start: ls, goal: lg } = longSpec(0);
  const u = new AStar(ls, moves, lg, 30, 5);
  const tu: number[] = [];
  let ru: any;
  do {
    ru = u.compute();
    tu.push(performance.now() - u.startTime);
    await sleep(10);
  } while (ru.status === 'partial');
  say(`unshared, timeout 30 ms: ${ru.status} at ${tu[tu.length - 1].toFixed(1)} ms of wall time (${tu.length} calls, ${u.closedDataSet.size} nodes)`);
  // (3 calls of 5 ms are 15 ms of search: the timeout came from the wall clock)
  ok(ru.status === 'timeout' && tu.length * 5 < 30 && tu[tu.length - 1] >= 30 && tu[tu.length - 1] < 30 + 5 + 25, 'an unshared search times out on the wall clock at its timeout');
  ok(AStar.shareStats().calls === 0, 'an unshared search is not charged');
  const w = new AStar(ls, moves, lg, 30, 5);
  let rw: any, tw = 0;
  do {
    rw = w.compute(true);
    tw = performance.now() - w.startTime;
    await sleep(10);
  } while (rw.status === 'partial');
  say(`shared and alone, timeout 30 ms: ${rw.status} at ${tw.toFixed(1)} ms of wall time, held back ${w.heldMs.toFixed(1)} ms`);
  ok(rw.status === 'timeout' && w.heldMs === 0 && tw >= 30 && tw < 30 + 5 + 25, 'a shared search never held back times out on the wall clock at its timeout');
}

// --- 5: first slices are charged, never refused or cut; continued searches then yield
{
  await sleep(60);
  AStar.configureShare({ tickMs: TICK_MS, free: 0 });
  // (three of 12 ms: all inside one window, together over the allowance)
  const firsts = Array.from({ length: 3 }, (_, i) => new AStar(longSpec(i).start, moves, longSpec(i).goal, 15000, 12));
  const before = AStar.shareStats();
  const ms = firsts.map((f) => {
    const s = performance.now();
    const r = f.compute('first');
    return { ms: performance.now() - s, refused: r.refused === true, status: r.status };
  });
  const after = AStar.shareStats();
  say(`first slices: ${ms.map((m) => m.ms.toFixed(1)).join(' ')} ms; charged ${(after.usedMs - before.usedMs).toFixed(1)} ms in ${after.calls - before.calls} calls, ${after.firsts - before.firsts} counted as first slices`);
  ok(ms.every((m) => !m.refused && m.status === 'partial' && m.ms >= 12), 'every first slice ran its full tickTimeout, the window spent or not');
  ok(after.calls - before.calls === 3 && after.firsts - before.firsts === 3 && after.usedMs - before.usedMs >= 3 * 12, 'first slices are charged to the window');
  const r = firsts[0].compute(true);
  ok(r.refused === true, `a continued search right after a burst of first slices yields (${r.refused ? 'refused' : 'served'})`);
  for (const f of firsts) AStar.forget(f);
}

// --- 6: a held-back search gets the time it was held back, up to 3x its timeout on the wall clock
{
  await sleep(60);
  AStar.configureShare({ tickMs: 2, free: 0 }); // 2 ms a window: a search of 15 ms a tick gets 2
  const { start, goal } = longSpec(1);
  // (the gap from the first slice to the first continuation is not held back, so the timeout is long enough for the cap
  // to come first: about 77 ms + 13% of the rest of the wall time stays under 150 ms until 450 ms)
  const timeout = 150;
  const a = new AStar(start, moves, goal, timeout, 15);
  let r: any = a.compute('first'); // (as getPathTo starts a search: the gap to the first continuation is never held back)
  let atTimeout: any = null;
  await physicsTicks(1, 1000, () => {
    r = a.compute(true);
    const wall = performance.now() - a.startTime;
    if (!atTimeout && wall > 1.5 * timeout) atTimeout = { wall, held: a.heldMs, status: r.status };
    return r.status !== 'partial';
  });
  const wall = performance.now() - a.startTime;
  say(`held back (2 ms a window, 15 ms a tick asked, timeout ${timeout} ms): at ${atTimeout?.wall.toFixed(0)} ms of wall time ${atTimeout?.held.toFixed(1)} ms held back, ${atTimeout?.status}; `
    + `${r.status} at ${wall.toFixed(0)} ms of wall time, ${a.heldMs.toFixed(1)} ms held back`);
  ok(atTimeout?.status === 'partial' && atTimeout.wall - atTimeout.held <= timeout, 'a search held back past its timeout on the wall clock goes on');
  ok(atTimeout && atTimeout.held >= 0.6 * (atTimeout.wall - 80), 'the time held back is most of the wall time after the first continuation (the share gave 2 of 15 ms a tick)');
  ok(r.status === 'timeout' && wall >= 3 * timeout - 1 && wall < 3 * timeout + 70, `the wall cap: it times out at 3x its timeout (${wall.toFixed(0)} ms)`);
  const c = new AStar(start, moves, goal, 20, 15);
  await sleep(65);
  const rc = c.compute(true);
  ok(rc.status === 'timeout' && c.closedDataSet.size === 0, `a search 3x its timeout old on the wall clock times out (${rc.status})`);
}

// --- 7: a dropped search is forgotten; a finished one leaves the queue
{
  await sleep(60);
  AStar.configureShare({ tickMs: TICK_MS, free: 0 });
  const ctxs = Array.from({ length: 6 }, (_, i) => new AStar(longSpec(i).start, moves, longSpec(i).goal, 15000, 15));
  for (const c of ctxs) c.compute(true);
  const s1 = AStar.shareStats();
  const queued = ctxs.filter((c) => c.shareLost === 1);
  AStar.forget(queued[0]);
  const s2 = AStar.shareStats();
  say(`forget: ${s1.owed} queued and ${s1.searches} asking (demand ${s1.demandMs.toFixed(0)} ms) -> ${s2.owed} and ${s2.searches} (${s2.demandMs.toFixed(0)} ms)`);
  ok(queued.length >= 2 && s1.owed === queued.length, `the searches over the allowance are queued (${s1.owed})`);
  ok(s2.owed === s1.owed - 1 && s2.searches === s1.searches - 1 && s2.demandMs < s1.demandMs, 'a forgotten search leaves the queue and the demand');
  const done = queued[1];
  done.startTime -= 3 * done.timeout; // past the wall cap: its next call returns 'timeout'
  const rd = done.compute(true);
  const s3 = AStar.shareStats();
  ok(rd.status === 'timeout' && s3.owed === s2.owed - 1 && s3.searches === s2.searches - 1, `a search that timed out leaves the queue and the demand (${rd.status}, ${s2.owed} -> ${s3.owed} queued, ${s2.searches} -> ${s3.searches} asking)`);
  for (const c of ctxs) AStar.forget(c);
  AStar.configureShare({ tickMs: 'off' });
  ok(AStar.shareStats().allowanceMs === Infinity, 'MC_PF_TICK_MS=off turns the share off');
  const longest = base.reduce((m, b, i) => (b.ms > base[m].ms ? i : m), 0);
  const d = new AStar(searchSpec(longest).start, moves, searchSpec(longest).goal, 1e9, 1e9);
  ok(pathKey(d.compute(true).path) === base[longest].key, 'with the share off, compute(true) is the plain search');
}

say(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
