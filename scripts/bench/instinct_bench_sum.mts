/**
 * #205: reads a choicebench summary over instinct_cases.mts' pairs and puts the two arms side by side: valid replies, how
 * often the avoided option was picked, how often each case's modal pick in the off arm was kept in the on arm (the other
 * choices undisturbed), and prompt tokens.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/bench/instinct_bench_sum.mts CASES.json SUMMARY.json
 */
import fs from 'node:fs';

const [casesFile, sumFile] = process.argv.slice(2);
if (!casesFile || !sumFile) throw new Error('usage: instinct_bench_sum.mts CASES.json SUMMARY.json');
const cases: Array<{ name: string; avoid: string[] }> = JSON.parse(fs.readFileSync(casesFile, 'utf8')).cases;
const sum = JSON.parse(fs.readFileSync(sumFile, 'utf8'));
const avoidOf = new Map(cases.map((c) => [c.name, new Set(c.avoid)]));
const samples: Array<{ case: string; id: string | null; promptTokens: number }> = sum.samples;
const arm = (a: 'off' | 'on') => samples.filter((s) => s.case.endsWith(`|${a}`));
const line = (a: 'off' | 'on') => {
  const ss = arm(a);
  const valid = ss.filter((s) => s.id);
  const avoided = valid.filter((s) => avoidOf.get(s.case)?.has(s.id!));
  const tok = ss.reduce((t, s) => t + (s.promptTokens || 0), 0) / Math.max(1, ss.length);
  return { n: ss.length, valid: valid.length, avoided: avoided.length, tok };
};
const off = line('off'), on = line('on');
const pct = (x: number, n: number) => (n ? `${Math.round((100 * x) / n)}%` : '-');
console.log(`arm  samples  valid        avoided picked   prompt tokens`);
for (const [k, r] of [['off', off], ['on', on]] as const) console.log(`${k.padEnd(4)} ${String(r.n).padEnd(8)} ${`${r.valid} (${pct(r.valid, r.n)})`.padEnd(12)} ${`${r.avoided} (${pct(r.avoided, r.valid)})`.padEnd(16)} ${Math.round(r.tok)}`);
// (per case: the avoided share in each arm, and the off arm's modal pick among the other options against the on arm's)
let keptModal = 0, withModal = 0;
for (const c of cases.filter((q) => q.name.endsWith('|off'))) {
  const base = c.name.slice(0, -4);
  const pick = (a: string) => samples.filter((s) => s.case === `${base}|${a}` && s.id);
  const av = avoidOf.get(c.name)!;
  const modal = (xs: Array<{ id: string | null }>) => {
    const m = new Map<string, number>();
    for (const s of xs) if (!av.has(s.id!)) m.set(s.id!, (m.get(s.id!) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const mo = modal(pick('off')), mn = modal(pick('on'));
  if (mo) { withModal++; if (mo === mn) keptModal++; }
  console.log(`  ${base}: avoided ${pick('off').filter((s) => av.has(s.id!)).length}/${pick('off').length} off, ${pick('on').filter((s) => av.has(s.id!)).length}/${pick('on').length} on; other modal ${mo ?? '-'} -> ${mn ?? '-'}`);
}
console.log(`the off arm's modal pick among the other options kept in the on arm: ${keptModal} of ${withModal} cases`);
