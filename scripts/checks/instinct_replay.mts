/**
 * The instincts' replay check (#205, spec runs/2026-11-02/instincts/spec.md 6.2; no server, no world): feeds a run log's
 * `[choice]`, `[choice-end]` and `[stuck]` lines to instincts.ts in order and prints the `[instinct]` lines that form,
 * at which log line and at which of the member's stalls, and what the place layer would have done with the stalled
 * walks' targets.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/instinct_replay.mts [LOG] [--home X,Z] [--quiet]
 *
 * LOG defaults to run 6 of #202 (runs/2026-11-02/testagents-154746.log, #204's case: Kai and Jonah swam in the river
 * east of P1 with their sand loads, 78-81 stalls each). On that log it checks:
 *   1. Kai and Jonah each learn an area instinct (E2) near -1496,63 by their 3rd stall within 12 blocks of it (stalls
 *      count when the member moved under 4 blocks or most of the walk's ticks were in water). Kai's chore (P1#137) never
 *      ended, so only the stalls can teach it;
 *   2. the place layer would pass over their east-bank sand (-1491,67 and -1492,68, the targets of their first stalls)
 *      for `collect:sand` and `trip:sand`, and not the village-side goals they were walking home to (-1555,43,
 *      -1608,63);
 *   3. an option with no place gets no weight from an area instinct (`xw` undefined), and the flag off forms nothing.
 * Home (the area's `from`) is the storage hut, read from the log's "teleported to the storage hut at X,Y,Z" unless given.
 * Any other log: prints what forms and checks nothing. Exit 1 on a failed check.
 */
import fs from 'node:fs';

process.env.MC_INSTINCTS = 'on';
// (run 6 ran at 2x: the windows are village minutes)
process.env.MC_TIME_SCALE ??= '2';
const I = await import('../../server/src/instincts.ts');

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const hi = args.indexOf('--home');
const RUN6 = 'runs/2026-11-02/testagents-154746.log';
const file = args.find((a, k) => !a.startsWith('--') && args[k - 1] !== '--home') ?? RUN6;
const isRun6 = file.replace(/\\/g, '/').endsWith('testagents-154746.log');
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

let home: { x: number; z: number } | null = null;
if (hi >= 0) {
  const [x, z] = args[hi + 1].split(',').map(Number);
  home = { x, z };
} else {
  for (const l of lines) {
    const m = /teleported to the storage hut at (-?\d+),-?\d+,(-?\d+)/.exec(l);
    if (m) { home = { x: Number(m[1]), z: Number(m[2]) }; break; }
  }
}

let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

interface Learned { agent: string; id: string; line: number; stallNo: number; spotNo: number; text: string }
function replay(on: boolean) {
  I.setInstinctsOn(on);
  I.initInstincts(null);
  const out: string[] = [];
  let lineNo = 0;
  I.setInstinctLog((l) => out.push(`${String(lineNo).padStart(5)}: ${l}`));
  let now = 0;
  const villageOf = new Map<string, string>();
  const stalls = new Map<string, Array<{ x: number; z: number }>>();
  const learned: Learned[] = [];
  const targets: Array<{ agent: string; line: number; to: { x: number; z: number } }> = [];
  for (const [k, l] of lines.entries()) {
    lineNo = k + 1;
    if (l.startsWith('[choice] ')) {
      const r = JSON.parse(l.slice(9));
      now = Math.max(now, r.t ?? 0);
      villageOf.set(r.agent, r.village);
      I.noteChoice(r);
    } else if (l.startsWith('[choice-end] ')) {
      const r = JSON.parse(l.slice(13));
      now = Math.max(now, r.tEnd ?? 0);
      I.noteChoiceEnd({ ...r, contention: r.code });
    } else if (l.startsWith('[stuck] ')) {
      const s = I.parseStuck(l);
      if (!s) continue;
      if (s.to) targets.push({ agent: s.agent, line: lineNo, to: s.to });
      const counted = s.moved < 4 || s.water > s.ticks / 2;
      const mine = stalls.get(s.agent) ?? [];
      if (counted) mine.push({ x: s.x, z: s.z });
      stalls.set(s.agent, mine);
      // (stall lines carry no time: the last record's, plus a second a line so the order holds)
      now += 1000;
      const i = I.noteStall(l, { village: villageOf.get(s.agent), home, now });
      if (i) learned.push({ agent: s.agent, id: i.id, line: lineNo, stallNo: mine.length, spotNo: mine.filter((q) => Math.hypot(q.x - s.x, q.z - s.z) <= 12).length, text: i.text });
    }
  }
  return { out, learned, targets };
}

const r = replay(true);
if (!quiet) for (const l of r.out) console.log(l);
const ops = new Map<string, number>();
for (const l of r.out) {
  const m = /\[instinct\] \S+: \S+ (\S+)/.exec(l);
  if (m) ops.set(m[1], (ops.get(m[1]) ?? 0) + 1);
}
console.log(`[instinct] lines by op: ${[...ops].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}; home ${home ? `${home.x},${home.z}` : 'unknown'}`);
for (const e of r.learned)
  console.log(`learned: ${e.agent} ${e.id} at line ${e.line}, at the member's stall no. ${e.stallNo} (no. ${e.spotNo} within 12 blocks): "${e.text}"`);

// Bug candidates (4.2): one area learned independently by 3 or more members (areas within 8 blocks)
const areas = I.allInstincts().flatMap((m) => m.instincts.filter((i) => i.trigger.area).map((i) => ({ agent: m.agent, a: i.trigger.area! })));
const groups: Array<typeof areas> = [];
for (const x of areas) {
  const g = groups.find((q) => Math.hypot(q[0].a.x - x.a.x, q[0].a.z - x.a.z) <= 8);
  if (g) g.push(x);
  else groups.push([x]);
}
for (const g of groups)
  console.log(`area ${Math.round(g[0].a.x)},${Math.round(g[0].a.z)}: learned by ${g.length} member(s) (${g.map((x) => x.agent).join(', ')})${g.length >= 3 ? ': a bug candidate' : ''}`);

// What the place layer would have done with every stalled walk's goal, after each member's instinct formed
for (const e of r.learned) {
  const after = r.targets.filter((t) => t.agent.toLowerCase() === e.agent.toLowerCase() && t.line > e.line);
  const shun = after.filter((t) => I.avoidedFor('P1', e.agent, 'collect:sand', t.to.x, t.to.z));
  console.log(`${e.agent}: ${after.length} stalled walks after line ${e.line}, ${shun.length} toward targets in the avoided area`);
}

if (isRun6) {
  for (const who of ['Kai', 'Jonah']) {
    const e = r.learned.find((q) => q.agent === who);
    check(!!e, `${who} learns an area instinct${e ? ` (${e.id}, line ${e.line})` : ''}`);
    if (!e) continue;
    check(e.spotNo <= 3, `${who}'s forms by the 3rd stall at the spot (stall no. ${e.spotNo} there, no. ${e.stallNo} in all)`);
    const a = I.instinctsOf('P1', who).find((i) => i.trigger.area)?.trigger.area;
    check(!!a && Math.hypot(a.x + 1496, a.z - 63) <= 8, `${who}'s area lies near -1496,63 (${a ? `${a.x},${a.z} r ${a.r}` : 'none'})`);
    for (const [x, z] of [[-1491, 67], [-1492, 68]]) {
      check(!!I.avoidedFor('P1', who, 'collect:sand', x, z), `${who}: the place layer passes over east-bank sand at ${x},${z}`);
      check(!!I.avoidedFor('P1', who, 'trip:sand', x, z), `${who}: and a sand trip's spot there`);
    }
    for (const [x, z] of [[-1555, 43], [-1608, 63]])
      check(!I.avoidedFor('P1', who, 'collect:sand', x, z), `${who}: not the village-side ${x},${z}`);
    check(!I.avoidedFor('P1', who, 'collect:oak_log', -1491, 67), `${who}: not a log gather at the same place (the lesson names sand)`);
    check(I.weightFor('P1', who, { id: 'monument:gather:sand', key: 'monument:gather:sand:1', kind: 'monument' }) === undefined,
      `${who}: no xw on a gather without a place (the place layer acts there)`);
  }
  const off = replay(false);
  check(off.out.length === 0 && off.learned.length === 0, 'MC_INSTINCTS=off: no [instinct] line and nothing learned');
  console.log(failed ? `instinct_replay: ${failed} FAILED` : 'instinct_replay: all checks passed');
}
process.exit(failed ? 1 : 0);
