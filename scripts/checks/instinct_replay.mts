/**
 * The instincts' replay check (#205, spec runs/2026-11-02/instincts/spec.md 6.2; no server, no world): feeds a run log's
 * `[choice]`, `[choice-end]`, `[stuck]` and (#220) `[death]` lines to instincts.ts in order and prints the `[instinct]` lines that form,
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
 *   4. (session 2) with MC_INSTINCT_SHARE on: members pass instincts side by side, every copy at 0.5 with a generation,
 *      a giver and a learned lineage, and Kai and Jonah still hold the river area. It prints the passes and lineages.
 * On train 20's I1 log (runs/2026-11-04/testagents-w4-174352.log, #220; 1x, so MC_TIME_SCALE=1): no lesson from the night
 * band ("inside the band now") or the hunt's health floor (it taught 21 and 2), and the deaths away from home teach
 * place lessons (E5): the amethyst stair's (Milo, Wren, Finn, Rosa) for `activity:lib:amethyst`, which weigh the
 * amethyst option at the geode below 1 and not one elsewhere.
 * On train 21's I1 log (runs/2026-11-04/testagents-w4-211309.log, #222; 1x): Quinn's drowning keeps its cause ("drowned"),
 * his death walking home at night during "rest at home" is keyed on no chore ("walking out"), and Uma's deaths 20 and 45
 * blocks from home teach nothing.
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
const isT20 = file.replace(/\\/g, '/').endsWith('testagents-w4-174352.log');
const isT21 = file.replace(/\\/g, '/').endsWith('testagents-w4-211309.log');
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

interface Learned { agent: string; id: string; line: number; stallNo: number; spotNo: number; text: string; how?: string }
function replay(on: boolean, share = false) {
  I.setInstinctsOn(on);
  I.setInstinctShare(share);
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
    } else if (l.startsWith('[death] ')) {
      // (#220, E5: '[death] Finn fall at -1555,18,0 ("Finn fell from a high place")'; the phase from the [danger] line after)
      const m = /^\[death\] (\S+) (\S+) at (-?\d+),-?\d+,(-?\d+)(?: \("(.*)"\))?/.exec(l);
      if (!m) continue;
      const [, agent, cause, x, z, text] = m;
      const danger = lines.slice(k + 1, k + 8).find((q) => q.startsWith('[danger] ') && q.includes(` ${agent} died `));
      now += 1000;
      const i = I.noteDeathLesson({ village: villageOf.get(agent), agent, cause: text ? text.replace(new RegExp(`^${agent} `), '') : cause, x: Number(x), z: Number(z),
        night: / at night\b/.test(danger ?? ''), home, now });
      if (i) learned.push({ agent, id: i.id, line: lineNo, stallNo: 0, spotNo: 0, text: i.text, how: 'E5' });
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
  console.log(e.how === 'E5' ? `learned from a death: ${e.agent} ${e.id} at line ${e.line}: "${e.text}"`
    : `learned: ${e.agent} ${e.id} at line ${e.line}, at the member's stall no. ${e.stallNo} (no. ${e.spotNo} within 12 blocks): "${e.text}"`);

// Bug candidates (4.2): one area learned independently by 3 or more members (areas within 8 blocks; walk stalls, not deaths)
const areas = I.allInstincts().flatMap((m) => m.instincts.filter((i) => i.trigger.area && i.how !== 'E5').map((i) => ({ agent: m.agent, a: i.trigger.area! })));
const groups: Array<typeof areas> = [];
for (const x of areas) {
  const g = groups.find((q) => Math.hypot(q[0].a.x - x.a.x, q[0].a.z - x.a.z) <= 8);
  if (g) g.push(x);
  else groups.push([x]);
}
for (const g of groups)
  console.log(`area ${Math.round(g[0].a.x)},${Math.round(g[0].a.z)}: learned by ${g.length} member(s) (${g.map((x) => x.agent).join(', ')})${g.length >= 3 ? ': a bug candidate' : ''}`);

// What the place layer would have done with every stalled walk's goal, after each member's instinct formed
for (const e of r.learned.filter((q) => q.how !== 'E5')) {
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
}

if (isT20) {
  const learns = r.out.filter((l) => / learns i\d+ /.test(l));
  const band = learns.filter((l) => /band now|again by day/.test(l));
  const health = learns.filter((l) => /starts above/.test(l));
  check(band.length === 0, `no lesson from the night band (${band.length}; 21 before #220)`);
  check(health.length === 0, `no lesson from the hunt's health floor (${health.length}; 2 before #220)`);
  const e5 = r.learned.filter((q) => q.how === 'E5');
  const stair = ['Milo', 'Wren', 'Finn', 'Rosa'];
  for (const who of stair) {
    const i = I.instinctsOf('P1', who).find((q) => q.how === 'E5');
    check(!!i && i.trigger.keys.includes('activity:lib:amethyst') && Math.hypot(i.trigger.area!.x + 1557, i.trigger.area!.z - 0) <= 6,
      `${who} learns from the amethyst stair death: ${i ? `"${i.text}"` : 'nothing'}`);
    const w = I.weightFor('P1', who, { id: 'activity:lib:amethyst', key: 'activity:lib:amethyst', kind: 'activity', at: { x: -1557, z: 2 } });
    const elsewhere = I.weightFor('P1', who, { id: 'activity:lib:amethyst', key: 'activity:lib:amethyst', kind: 'activity', at: { x: -1700, z: 120 } });
    check(w !== undefined && w < 1 && elsewhere === undefined, `${who}: the amethyst option at the geode weighs ${w}, one elsewhere ${elsewhere}`);
  }
  check(e5.length >= 6, `the deaths away from home teach place lessons (${e5.length} of the log's 8 deaths)`);
  console.log(failed ? `instinct_replay (train 20): ${failed} FAILED` : 'instinct_replay (train 20): all checks passed');
}

if (isT21) {
  const q = I.instinctsOf('P1', 'Quinn').filter((i) => i.how === 'E5');
  const sand = q.find((i) => Math.hypot(i.trigger.area!.x + 1814, i.trigger.area!.z - 9) <= 6);
  check(!!sand && /: drowned\.$/.test(sand.text) && I.words(sand.text) <= I.MAX_WORDS, `Quinn's drowning keeps its cause: ${sand ? `"${sand.text}"` : 'nothing'}`);
  const rest = q.find((i) => Math.hypot(i.trigger.area!.x + 1615, i.trigger.area!.z - 137) <= 6);
  check(!!rest && rest.trigger.keys.length === 0 && /^When walking out,/.test(rest.text) && /Creeper\.$/.test(rest.text),
    `Quinn's death on the way home is keyed on no chore: ${rest ? `"${rest.text}" keys [${rest.trigger.keys}]` : 'nothing'}`);
  const uma = I.instinctsOf('P1', 'Uma').filter((i) => i.how === 'E5');
  check(uma.length === 0 && r.out.filter((l) => /Uma learns nothing from its death .*: at home/.test(l)).length === 2, `Uma's deaths inside the village teach nothing (${uma.length} lessons)`);
  console.log(failed ? `instinct_replay (train 21): ${failed} FAILED` : 'instinct_replay (train 21): all checks passed');
}

// Session 2: the same log with sharing on (MC_INSTINCT_SHARE): the side-by-side and dusk passes that would have happened
// (a log carries no deposit positions: the storage channel is the unit check's)
const sh = replay(true, true);
const borrows = sh.out.filter((l) => / borrows i\d+ from /.test(l));
const echoes = sh.out.filter((l) => / echo i\d+: /.test(l));
const by = new Map<string, number>();
for (const l of borrows) {
  const via = /\((side by side|dusk|storage);/.exec(l)?.[1] ?? '?';
  by.set(via, (by.get(via) ?? 0) + 1);
}
console.log(`sharing on: ${borrows.length} borrows (${[...by].map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}), ${echoes.length} echoes; areas learned from own stalls ${sh.learned.length} (sharing off: ${r.learned.length})`);
if (!quiet) for (const l of [...borrows, ...echoes]) console.log(l);
const lin = I.lineages('P1');
for (const l of lin.filter((q) => q.holders.length > 1)) console.log(`lineage ${l.lineage}: ${l.holders.map((h) => `${h.agent} ${h.conf.toFixed(2)} gen ${h.gen}`).join(', ')}`);
if (isRun6) {
  const copies = I.allInstincts('P1').flatMap((m) => m.instincts.filter((i) => i.source === 'borrowed').map((i) => ({ agent: m.agent, i })));
  check(borrows.length > 0, `sharing on: members pass instincts side by side (${borrows.length} borrows)`);
  check(copies.every(({ i }) => i.gen >= 1 && !!i.from && lin.some((l) => l.lineage === i.lineage && l.holders.some((h) => h.source === 'learned'))),
    'every copy has a generation, a giver, and a lineage some member learned');
  check(borrows.every((l) => / 0\.50\) "/.test(l)), 'every copy starts at 0.5');
  check(['Kai', 'Jonah'].every((w) => I.instinctsOf('P1', w).some((i) => i.trigger.area && Math.hypot(i.trigger.area.x + 1496, i.trigger.area.z - 63) <= 8)),
    'Kai and Jonah still hold the river area with sharing on');
  console.log(failed ? `instinct_replay: ${failed} FAILED` : 'instinct_replay: all checks passed');
}
process.exit(failed ? 1 : 0);
