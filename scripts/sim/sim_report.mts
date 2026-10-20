/**
 * Real and simulated runs side by side from their choice logs (the simulator's validation, check_sim_v1.md's finding 12):
 * picks by kind per 10-minute bin, busy (chore minutes) per bin, builds, fish and trades by their end messages, and the
 * choice-none reasons per bin from the agent log (its lines take the time of the last [choice] record before them; the
 * simulator's events log has its own times).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/sim/sim_report.mts NAME=CHOICES.jsonl[,AGENT.log] ... [--members N]
 *   [--minutes N] [--kinds make,gather,initiate,help,activity,light,furnish]
 */
import fs from 'node:fs';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type Counts = Record<string, number>;

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const MEMBERS = Number(opt('--members') ?? 25);
const MINUTES = Number(opt('--minutes') ?? 30);
const KINDS = (opt('--kinds') ?? 'make,gather,initiate,help,activity,light,furnish,eat').split(',');
const BINS = Math.ceil(MINUTES / 10);

interface Run { name: string; picks: Counts[]; busy: number[]; total: Counts; ends: Counts; none: Array<Map<string, number>>; t0: number }

function load(spec: string): Run {
  const [name, files] = spec.includes('=') ? spec.split('=') : [spec, spec];
  const [choices, log] = files.split(',');
  const rows = fs.readFileSync(choices, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const starts = rows.filter((r) => r.type === 'choice');
  const t0 = Math.min(...starts.map((r) => r.t));
  const bin = (t: number) => Math.floor((t - t0) / 600000);
  const picks = Array.from({ length: BINS }, () => ({}) as Counts);
  const total: Counts = {};
  for (const s of starts) {
    const b = bin(s.t);
    if (b >= BINS) continue;
    picks[b][s.kind] = (picks[b][s.kind] ?? 0) + 1;
    total[s.kind] = (total[s.kind] ?? 0) + 1;
  }
  const busy = Array.from({ length: BINS }, () => 0);
  const byId = new Map(starts.map((s) => [s.id, s]));
  const ends: Counts = {};
  const tally = (k: string, n = 1) => (ends[k] = (ends[k] ?? 0) + n);
  for (const e of rows.filter((r) => r.type === 'choice-end')) {
    const s = byId.get(e.id);
    if (!s) continue;
    // (chore time, clipped to the bins)
    let from = s.t;
    const to = Math.min(e.tEnd ?? s.t + e.minutes * 60000, t0 + BINS * 600000);
    while (from < to) {
      const b = bin(from), edge = Math.min(to, t0 + (b + 1) * 600000);
      if (b >= 0 && b < BINS) busy[b] += edge - from;
      from = edge;
    }
    const m = String(e.message ?? '');
    if (!e.ok) tally(`failed ${s.kind}`);
    if (/recorded in village/.test(m)) tally('builds');
    const fish = /deposited ([^.;]*)/.exec(m)?.[1] ?? '';
    for (const [, q, n] of fish.matchAll(/(\d+) (cod|salmon)\b/g)) tally(`deposited ${n}`, Number(q));
    const em = /deposited (\d+) emerald/.exec(m);
    if (em) tally('emeralds from sales', Number(em[1]));
    if (s.kind === 'activity' && /^deposited [1-9]/.test(m) && !/emerald/.test(m) && !/cod|salmon|fish/.test(m)) tally('purchases');
    const lit = /^lit (\d+) torch/.exec(m);
    if (lit) tally('torches lit', Number(lit[1]));
    const ate = /^ate (\d+) (\S+)/.exec(m);
    if (ate) tally(`ate ${ate[2]}`, Number(ate[1]));
  }
  // choice-none reasons per bin: the largest count each "kind: reason" had in a line of that bin
  const none = Array.from({ length: BINS }, () => new Map<string, number>());
  const addNone = (t: number, line: string) => {
    const b = bin(t);
    if (b < 0 || b >= BINS) return;
    const body = /nothing feasible \((.*)\)\s*$/.exec(line)?.[1] ?? '';
    for (const part of body.split(', ')) {
      const m = /^([a-z]+): (.*) (\d+)$/.exec(part);
      if (!m || !KINDS.includes(m[1])) continue;
      const k = `${m[1]}: ${m[2]}`;
      none[b].set(k, Math.max(none[b].get(k) ?? 0, Number(m[3])));
    }
  };
  if (log && fs.existsSync(log)) {
    let t = t0;
    for (const line of fs.readFileSync(log, 'utf8').split('\n')) {
      const sim = /^\+(\d+\.\d+)m (.*)$/.exec(line);
      if (sim) {
        if (sim[2].startsWith('[choice-none]')) addNone(t0 + Number(sim[1]) * 60000, sim[2]);
        continue;
      }
      const c = /^\[choice(?:-end)?\] (\{.*)$/.exec(line);
      if (c) {
        const tt = /"t(?:End)?":(\d{13})/.exec(c[1]);
        if (tt) t = Number(tt[1]);
        continue;
      }
      if (line.startsWith('[choice-none]')) addNone(t, line);
    }
  }
  return { name, picks, busy, total, ends, none, t0 };
}

const runs = argv.map(load);
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const col = 12;
const header = (title: string) => console.log(`\n${pad(title, 26)}${runs.map((r) => pad(r.name, col)).join('')}${runs.length === 2 ? 'diff' : ''}`);
const diff = (a: number, b: number) => (runs.length === 2 ? (a ? `${b - a >= 0 ? '+' : ''}${Math.round((100 * (b - a)) / a)}%` : b ? 'new' : '') : '');
const line = (label: string, vals: number[], fmt = (x: number) => String(Math.round(x * 10) / 10)) => console.log(`${pad(label, 26)}${vals.map((x) => pad(fmt(x), col)).join('')}${diff(vals[0], vals[1] ?? 0)}`);

header('busy % (chore minutes)');
for (let b = 0; b < BINS; b++) line(`  ${b * 10}-${b * 10 + 10} min`, runs.map((r) => (100 * r.busy[b]) / (MEMBERS * 600000)));
line('  all', runs.map((r) => (100 * r.busy.reduce((s, x) => s + x, 0)) / (MEMBERS * BINS * 600000)));
header('picks by kind (all)');
const kinds = [...new Set(runs.flatMap((r) => Object.keys(r.total)))].sort((a, b) => (runs[0].total[b] ?? 0) - (runs[0].total[a] ?? 0));
for (const k of kinds) line(`  ${k}`, runs.map((r) => r.total[k] ?? 0));
header('picks by kind per bin');
for (let b = 0; b < BINS; b++) for (const k of kinds) if (runs.some((r) => r.picks[b][k])) line(`  ${b * 10}-${b * 10 + 10} ${k}`, runs.map((r) => r.picks[b][k] ?? 0));
header('outcomes (end messages)');
for (const k of [...new Set(runs.flatMap((r) => Object.keys(r.ends)))].sort()) line(`  ${k}`, runs.map((r) => r.ends[k] ?? 0));
console.log('\nchoice-none reasons per bin (largest idle count in a line), families ' + KINDS.join(','));
for (let b = 0; b < BINS; b++) {
  const keys = [...new Set(runs.flatMap((r) => [...r.none[b].keys()]))].sort();
  for (const k of keys) line(`  ${b * 10}-${b * 10 + 10} ${k}`, runs.map((r) => r.none[b].get(k) ?? 0));
}
