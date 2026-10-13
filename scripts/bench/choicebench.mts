/**
 * choicebench (A.2, spec section 10): the chooser on recorded and hand-made menus, through choose() and the real callModel
 * (the gate, the usage ledger and the text-reply parse as in a run), N samples a case with a different shuffle each.
 * Reports valid %, position bias against chance per menu size (overall and on the equal-option cases), the modal-choice
 * share per case, sensible % on the labelled cases, latency and tokens, and the failures by why.
 *
 * Usage: node_modules/.bin/tsx scripts/bench/choicebench.mts [FILE ...]
 *   FILE: a decision log (.jsonl: every `choice` record with 2+ full options, deduplicated by option ids and context) or a
 *   cases file (.json, scripts/bench/choicebench_cases.json: labelled {name, menu, good, why} and {name, equal: true, menu}).
 *   No FILE: runs/2026-10-12/A2f.choices.jsonl and the cases file.
 * Env: MODEL (default ollama:gpt-oss:120b-cloud), THINK=low|medium|high (default the brain's REASONING.choose), N (samples a
 *   case, default 10), CONC (decisions at once, default 2, the chooser's own parallel), ONLY (a regex on case names),
 *   OLLAMA_URL (another Ollama server), PEEK=1 (each raw reply and reason; wraps callModel to see the reply),
 *   DRY=1 (no network: a fake call that always takes the first option shown), DRY=random (a random one),
 *   DRY=noisy (random, one reply in ten not an option), TRIM=0 (recorded menus untrimmed; by default they get the model
 *   mode's trimMenu, as decide() shows them).
 * Writes a JSON summary to runs/2026-10-12/bench/choicebench-<timestamp>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChoiceContext, ChoiceMenu, ChoiceOption } from '../../server/src/world';
import type { CallRequest, Reply } from '../../server/src/modelCall';
import type { ChooseResult } from '../../server/src/choose';
import { percentile } from './benchUtil.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// (before the model modules load: modelCall reads MC_OLLAMA_URL once)
if (process.env.OLLAMA_URL) {
  process.env.MC_OLLAMA_URL = process.env.OLLAMA_URL.replace(/\/$/, '');
  delete process.env.MC_OLLAMA_ROUTES;
}
const { choose, trimMenu } = await import('../../server/src/choose');
const { callModel, parseSpec, label } = await import('../../server/src/modelCall');
const { usage, REASONING } = await import('../../server/src/modelUsage');

const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL);
if (!spec) throw new Error(`MODEL=${MODEL} is not <provider>:<model>`);
const THINK = process.env.THINK?.trim().toLowerCase();
const LEVEL = THINK === 'low' || THINK === 'medium' || THINK === 'high' ? THINK : REASONING.choose;
if (THINK && THINK !== LEVEL) console.error(`[choicebench] THINK=${THINK} not understood (low, medium or high): using ${LEVEL}`);
const N = Number(process.env.N) || 10;
const CONC = Math.max(1, Number(process.env.CONC) || 2);
const DRY = (process.env.DRY ?? '').toLowerCase();
const PEEK = !!process.env.PEEK;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
const TRIM = process.env.TRIM !== '0';
const AGENT = 'choicebench';
const ALPHA = 0.01;

// ---------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------

interface Case {
  name: string;
  source: 'log' | 'labelled' | 'equal' | 'case';
  menu: ChoiceMenu;
  good?: string[];
  why?: string;
}

const EMPTY_CTX: ChoiceContext = { persona: '', village: '', others: '', outcomes: [] };

function option(o: any, i: number): ChoiceOption {
  return {
    id: String(o.id), kind: o.kind, key: String(o.key ?? o.id), holds: Array.isArray(o.holds) ? o.holds : [],
    excludes: Array.isArray(o.excludes) ? o.excludes : [], name: String(o.name), facts: String(o.facts ?? ''),
    effect: String(o.effect ?? ''), rank: Number.isFinite(o.rank) ? o.rank : i, ...(o.lp !== undefined ? { lp: o.lp } : {}),
  };
}
const ctxOf = (c: any): ChoiceContext => ({ ...EMPTY_CTX, ...(c ?? {}), outcomes: Array.isArray(c?.outcomes) ? c.outcomes : [] });
const fullOption = (o: unknown) => !!o && typeof o === 'object' && typeof (o as any).id === 'string' && typeof (o as any).name === 'string';

function fromLog(file: string, skipped: Record<string, number>): Case[] {
  const out: Case[] = [];
  const seen = new Set<string>();
  const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let r: any;
    try {
      r = JSON.parse(line);
    } catch {
      skipped['bad json'] = (skipped['bad json'] ?? 0) + 1;
      continue;
    }
    if (!(r.type === 'choice' || (!r.type && r.agent))) continue;
    const opts: unknown[] = Array.isArray(r.options) ? r.options : [];
    if (opts.length < 2) {
      skipped['under 2 options'] = (skipped['under 2 options'] ?? 0) + 1;
      continue;
    }
    if (!opts.every(fullOption)) {
      skipped['ids only'] = (skipped['ids only'] ?? 0) + 1;
      continue;
    }
    const ctx = ctxOf(r.ctx);
    const key = `${opts.map((o: any) => o.id).sort().join(',')}|${JSON.stringify(ctx)}`;
    if (seen.has(key)) {
      skipped.duplicate = (skipped.duplicate ?? 0) + 1;
      continue;
    }
    seen.add(key);
    let options = opts.map(option);
    if (TRIM) options = trimMenu(options);
    if (options.length < 2) continue;
    out.push({
      name: `${r.village}/${r.agent}/${r.id}`, source: 'log',
      menu: { agent: r.agent ?? AGENT, village: r.village ?? '', t: r.t ?? 0, options, guarded: [], reasons: {}, ctx },
    });
  }
  return out;
}

function fromCases(file: string): Case[] {
  const d = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const list: any[] = Array.isArray(d) ? d : d.cases;
  return list.map((c) => {
    const options = (c.menu?.options ?? c.options ?? []).map(option);
    const ids = new Set(options.map((o: ChoiceOption) => o.id));
    const names = new Set(options.map((o: ChoiceOption) => o.name));
    if (ids.size !== options.length || names.size !== options.length) throw new Error(`case "${c.name}": option ids and names must be unique`);
    for (const g of c.good ?? []) if (!ids.has(g)) throw new Error(`case "${c.name}": good id ${g} is not an option`);
    if (options.length < 2) throw new Error(`case "${c.name}": fewer than 2 options`);
    return {
      name: String(c.name), source: c.equal ? 'equal' : c.good?.length ? 'labelled' : 'case', good: c.good, why: c.why,
      menu: { agent: AGENT, village: 'choicebench', t: 0, options, guarded: [], reasons: {}, ctx: ctxOf(c.menu?.ctx ?? c.ctx) },
    } as Case;
  });
}

const files = process.argv.slice(2).length ? process.argv.slice(2)
  : ['runs/2026-10-12/A2f.choices.jsonl', 'scripts/bench/choicebench_cases.json'];
const cases: Case[] = [];
const skipped: Record<string, number> = {};
for (const f of files) {
  const p = path.resolve(ROOT, f);
  if (!fs.existsSync(p)) {
    console.error(`[choicebench] ${f}: not found, skipped`);
    continue;
  }
  const got = p.endsWith('.jsonl') ? fromLog(p, skipped) : fromCases(p);
  console.log(`${f}: ${got.length} case${got.length === 1 ? '' : 's'}`);
  cases.push(...got);
}
if (Object.keys(skipped).length) console.log(`log records skipped: ${Object.entries(skipped).map(([k, n]) => `${n} ${k}`).join(', ')}`);
const run = cases.filter((c) => !ONLY || ONLY.test(c.name));
if (!run.length) {
  console.error('[choicebench] no cases');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// The calls
// ---------------------------------------------------------------------------------------------

type CallFn = (req: CallRequest) => Promise<{ reply: Reply; ms: number; waitMs: number }>;

/** DRY: no network; the shown order is the choose tool's enum. */
const dryCall: CallFn = async (req) => {
  const shown: string[] = (req.tools[0]?.input_schema as any)?.properties?.choice?.enum ?? [];
  const pick = DRY === 'random' || DRY === 'noisy' ? shown[Math.floor(Math.random() * shown.length)] : shown[0];
  const promptTokens = Math.round((req.system.length + req.user.length + JSON.stringify(req.tools).length) / 4);
  if (DRY === 'noisy' && Math.random() < 0.1) return { reply: { calls: [], text: 'I would rather rest.', promptTokens, outputTokens: 8 }, ms: 1, waitMs: 0 };
  return { reply: { calls: [{ name: 'choose', input: { reason: `dry (${DRY})`, choice: pick } }], text: '', promptTokens, outputTokens: 30 }, ms: 1, waitMs: 0 };
};

interface Sample {
  case: string;
  i: number;
  seed: string;
  n: number;
  id: string | null;
  /** 1-based position of the chosen option as shown. */
  position: number | null;
  why?: string;
  reason: string;
  shown: string[];
  latencyMs: number;
  waitMs: number;
  promptTokens: number;
  outputTokens: number;
  raw?: string;
}

async function sample(c: Case, i: number): Promise<Sample> {
  const seed = `${c.name}#${i}`;
  let raw: string | undefined;
  // (PEEK: a pass-through wrapper only to see the reply; without PEEK choose() calls callModel itself)
  const call: CallFn | undefined = DRY ? dryCall : PEEK ? async (req) => {
    const r = await callModel(req);
    raw = r.reply.calls.length ? JSON.stringify(r.reply.calls) : JSON.stringify(r.reply.text);
    return r;
  } : undefined;
  const r: ChooseResult = await choose({ agent: AGENT, spec: spec!, level: LEVEL, menu: c.menu, seed, ...(call ? { call } : {}) });
  const pos = r.id ? r.shown.indexOf(r.id) : -1;
  return {
    case: c.name, i, seed, n: c.menu.options.length, id: r.id, position: pos >= 0 ? pos + 1 : null, why: r.why, reason: r.reason,
    shown: r.shown, latencyMs: r.latencyMs, waitMs: r.waitMs, promptTokens: r.promptTokens, outputTokens: r.outputTokens, raw,
  };
}

const jobs = run.flatMap((c) => Array.from({ length: N }, (_, i) => ({ c, i })));
console.log(`\n=== choicebench ${label(spec)} level=${LEVEL}${DRY ? ` DRY=${DRY}` : ''} N=${N} CONC=${CONC}: ${run.length} cases (${['log', 'labelled', 'equal', 'case'].map((s) => `${run.filter((c) => c.source === s).length} ${s}`).join(', ')}), ${jobs.length} decisions, at ${new Date().toISOString()}`);
const results = new Map<string, Sample[]>(run.map((c) => [c.name, []]));
const t0 = Date.now();
let next = 0, done = 0;
await Promise.all(Array.from({ length: Math.min(CONC, jobs.length) }, async () => {
  while (next < jobs.length) {
    const { c, i } = jobs[next++];
    const s = await sample(c, i);
    results.get(c.name)!.push(s);
    done++;
    if (PEEK) {
      const name = c.menu.options.find((o) => o.id === s.id)?.name;
      console.log(`  ${s.id ? 'ok ' : 'BAD'} ${c.name} #${i}: ${s.id ? `${name} (shown ${s.position} of ${s.n})` : s.why} ${(s.latencyMs / 1000).toFixed(1)}s ${s.promptTokens}/${s.outputTokens} tok${s.reason ? ` | ${s.reason}` : ''}${s.raw ? `\n      raw: ${s.raw.slice(0, 400)}` : ''}`);
    } else if (done % 20 === 0) process.stdout.write(`  ${done}/${jobs.length}\n`);
  }
}));
const wallMs = Date.now() - t0;

// ---------------------------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------------------------

/** ln Gamma (Lanczos, g=7). */
function lnGamma(x: number): number {
  const g = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = g[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += g[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The regularized upper incomplete gamma Q(a, x) (series below a+1, continued fraction above). */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 500; n++) {
      ap++;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a)));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.min(1, Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h);
}
const chiSquareP = (stat: number, df: number) => (df > 0 ? gammaQ(df / 2, stat / 2) : 1);

/** Two-sided exact binomial p (the outcomes no more likely than the one seen). */
function binomialP(k: number, n: number, p: number): number {
  const lnC = (m: number) => lnGamma(n + 1) - lnGamma(m + 1) - lnGamma(n - m + 1);
  const pmf = (m: number) => Math.exp(lnC(m) + m * Math.log(p) + (n - m) * Math.log(1 - p));
  const pk = pmf(k);
  let s = 0;
  for (let m = 0; m <= n; m++) {
    const q = pmf(m);
    if (q <= pk * (1 + 1e-7)) s += q;
  }
  return Math.min(1, s);
}

interface SizeBias {
  size: number;
  decisions: number;
  counts: number[];
  expected: number;
  test: 'chi-square' | 'binomial';
  /** chi-square: the test's p; binomial: the smallest per-position p (judged against ALPHA / size). */
  p: number;
  chi2?: number;
  significant: boolean;
  /** Judged: the expected count is at least 10 (spec 10); otherwise reported only. */
  judged: boolean;
  maxRatio: number;
}

function positionBias(samples: Sample[]) {
  const bySize = new Map<number, number[]>();
  for (const s of samples) {
    if (!s.position) continue;
    const counts = bySize.get(s.n) ?? Array(s.n).fill(0);
    counts[s.position - 1]++;
    bySize.set(s.n, counts);
  }
  const sizes: SizeBias[] = [];
  let chi2All = 0, dfAll = 0;
  for (const [size, counts] of [...bySize].sort((a, b) => a[0] - b[0])) {
    const total = counts.reduce((a, b) => a + b, 0);
    const expected = total / size;
    const maxRatio = expected > 0 ? Math.max(...counts.map((c) => c / expected)) : 0;
    if (expected >= 10) {
      const chi2 = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
      const p = chiSquareP(chi2, size - 1);
      chi2All += chi2;
      dfAll += size - 1;
      sizes.push({ size, decisions: total, counts, expected, test: 'chi-square', p, chi2, significant: p < ALPHA, judged: true, maxRatio });
    } else {
      const p = Math.min(...counts.map((c) => binomialP(c, total, 1 / size)));
      // (Bonferroni over the positions; low counts: reported, not judged)
      sizes.push({ size, decisions: total, counts, expected, test: 'binomial', p, significant: p < ALPHA / size, judged: false, maxRatio });
    }
  }
  const combinedP = dfAll ? chiSquareP(chi2All, dfAll) : null;
  // The panel's figure: first shown chosen against its chance (sum of 1/n)
  const firsts = samples.filter((s) => s.position === 1).length;
  const firstChance = samples.filter((s) => s.position).reduce((a, s) => a + 1 / s.n, 0);
  const valid = samples.filter((s) => s.position).length;
  return {
    sizes, combined: combinedP === null ? null : { chi2: chi2All, df: dfAll, p: combinedP, significant: combinedP < ALPHA },
    significant: sizes.some((s) => s.judged && s.significant) || (combinedP !== null && combinedP < ALPHA),
    maxRatio: Math.max(0, ...sizes.filter((s) => s.judged).map((s) => s.maxRatio)),
    maxRatioAll: Math.max(0, ...sizes.map((s) => s.maxRatio)),
    first: { share: valid ? firsts / valid : 0, chance: valid ? firstChance / valid : 0 },
  };
}

const all = [...results.values()].flat();
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
const valid = all.filter((s) => s.id);
// (sent: the call reached the model; a refusal or a withdrawal at the gate shows nothing)
const sent = all.filter((s) => s.shown.length && s.why !== 'withdrawn' && s.why !== 'budget');
const answered = all.filter((s) => s.id || s.why === 'invalid');
const why: Record<string, number> = {};
for (const s of all) if (!s.id) why[s.why ?? '?'] = (why[s.why ?? '?'] ?? 0) + 1;
const equal = all.filter((s) => run.find((c) => c.name === s.case)?.source === 'equal');
const labelled = run.filter((c) => c.source === 'labelled');
const labelledSamples = all.filter((s) => labelled.some((c) => c.name === s.case));
const sensible = labelledSamples.filter((s) => s.id && labelled.find((c) => c.name === s.case)!.good!.includes(s.id)).length;
const lat = sent.map((s) => s.latencyMs), wait = sent.map((s) => s.waitMs);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const promptMean = mean(answered.map((s) => s.promptTokens)), outMean = mean(answered.map((s) => s.outputTokens));
const biasAll = positionBias(all), biasEqual = positionBias(equal);

const perCase = run.map((c) => {
  const ss = results.get(c.name)!;
  const counts: Record<string, number> = {};
  for (const s of ss) if (s.id) counts[s.id] = (counts[s.id] ?? 0) + 1;
  const modal = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const v = ss.filter((s) => s.id).length;
  return {
    name: c.name, source: c.source, size: c.menu.options.length, samples: ss.length, valid: v, counts,
    modal: modal ? { id: modal[0], share: modal[1] / Math.max(1, v) } : null,
    sensible: c.good ? ss.filter((s) => s.id && c.good!.includes(s.id)).length : undefined, good: c.good,
  };
});

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const s1 = (ms: number) => (ms / 1000).toFixed(1);
const fmtP = (p: number) => (p < 1e-4 ? p.toExponential(1) : p.toFixed(4));
function printBias(title: string, b: ReturnType<typeof positionBias>) {
  console.log(`${title}: ${b.significant ? 'BIASED' : 'no significant bias'} (alpha ${ALPHA}, judged where expected >= 10); max observed/expected ${b.maxRatio.toFixed(2)} judged, ${b.maxRatioAll.toFixed(2)} all; first shown chosen ${pct(b.first.share, 1)} (chance ${pct(b.first.chance, 1)})`);
  for (const s of b.sizes)
    console.log(`  ${s.size} options: ${s.decisions} decisions, positions ${s.counts.join('/')} (expected ${s.expected.toFixed(1)} each), ${s.test} p=${fmtP(s.p)}${s.chi2 !== undefined ? ` chi2=${s.chi2.toFixed(1)} df=${s.size - 1}` : ''}${s.significant ? ' SIGNIFICANT' : ''}${s.judged ? '' : ' (expected < 10: not judged)'}, max ratio ${s.maxRatio.toFixed(2)}`);
  if (b.combined) console.log(`  combined over judged sizes: chi2=${b.combined.chi2.toFixed(1)} df=${b.combined.df} p=${fmtP(b.combined.p)}`);
}

console.log(`\ncases (modal share; sensible where labelled):`);
for (const c of perCase)
  console.log(`  ${c.source.padEnd(8)} ${c.name.slice(0, 60).padEnd(60)} ${c.size} opts  valid ${c.valid}/${c.samples}  modal ${c.modal ? `${c.modal.id} ${pct(c.modal.share, 1)}` : '-'}${c.sensible !== undefined ? `  sensible ${c.sensible}/${c.samples}` : ''}  ${Object.entries(c.counts).map(([k, n]) => `${k}:${n}`).join(' ')}`);
console.log('');
console.log(`valid: ${valid.length}/${all.length} (${pct(valid.length, all.length)})${Object.keys(why).length ? `; failures: ${Object.entries(why).map(([k, n]) => `${n} ${k}`).join(', ')}` : ''}`);
printBias('position bias, all cases', biasAll);
printBias('position bias, equal-option cases', biasEqual);
console.log(`sensible (labelled, ${labelled.length} cases): ${sensible}/${labelledSamples.length} (${pct(sensible, labelledSamples.length)} of all samples; ${pct(sensible, labelledSamples.filter((s) => s.id).length)} of valid)`);
console.log(`latency p50 ${s1(percentile(lat, 0.5))}s p90 ${s1(percentile(lat, 0.9))}s; gate wait p50 ${s1(percentile(wait, 0.5))}s p90 ${s1(percentile(wait, 0.9))}s; tokens mean ${Math.round(promptMean)} prompt / ${Math.round(outMean)} output; wall ${s1(wallMs)}s`);
const u = usage.report({ agents: [AGENT] });
const t = u.total;
console.log(`usage (${AGENT}, kind choose): ${t.calls} calls ok, ${t.promptTokens} prompt + ${t.outputTokens} output tokens, $${t.cost.toFixed(5)}, ${t.errors} errors, ${t.withdrawn} withdrawn, ${t.fallback} fallback, ${t.refused} refused${DRY ? ' (DRY: the fake call is not in the ledger)' : ''}`);

const outDir = path.join(ROOT, 'runs/2026-10-12/bench');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `choicebench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  at: new Date().toISOString(), model: label(spec), level: LEVEL, dry: DRY || null, n: N, conc: CONC, files, trim: TRIM, skipped,
  metrics: {
    decisions: all.length, valid: valid.length, validPct: all.length ? valid.length / all.length : 0, failures: why,
    positionBias: { all: biasAll, equal: biasEqual },
    sensible: { labelledCases: labelled.length, samples: labelledSamples.length, sensible, pct: labelledSamples.length ? sensible / labelledSamples.length : 0 },
    latencyMs: { p50: percentile(lat, 0.5), p90: percentile(lat, 0.9) }, waitMs: { p50: percentile(wait, 0.5), p90: percentile(wait, 0.9) },
    tokens: { promptMean, outputMean: outMean }, wallMs,
  },
  usage: t, cases: perCase, samples: all,
}, null, 2));
console.log(`summary: ${path.relative(ROOT, outFile)}`);
