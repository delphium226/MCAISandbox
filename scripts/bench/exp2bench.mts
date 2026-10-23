/**
 * exp2bench (G3, #33, Experiment 2's vignette part; the user's choice 10-23): does a member leave more of its share when
 * the levy was voted than when it was imposed? A run's own decision prompts that asked for a share (G3m1: an imposed 20%
 * levy) are asked again, each in three conditions differing in one sentence after the rules line, the live arms' words
 * (council.ts councilLine):
 *   base     as recorded;
 *   voted    "From today the levy is R%, as the village voted last night."
 *   imposed  "From today the levy is R%."
 * Paired: the same prompt, the same samples a condition. Measures: P(pay) (levy or all) and P(all) by condition, the
 * paired difference voted - imposed over prompts with a sign test and a bootstrap interval, valid answers.
 * The tool is rebuilt from the prompt (reason, choice, share; the run's optional memory and act fields left out).
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/exp2bench.mts MODEL_CALLS.jsonl
 * Env: N (samples a prompt and condition, default 2), PROMPTS (default 60), CONC (3), MODEL, DRY=1.
 * Writes runs/2026-10-23/g3-rules/bench/exp2bench-<timestamp>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDef } from '../../server/src/world';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { callModel, parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');

const FILE = process.argv[2];
if (!FILE) throw new Error('usage: exp2bench.mts MODEL_CALLS.jsonl');
const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL)!;
const N = Number(process.env.N ?? 2), PROMPTS = Number(process.env.PROMPTS ?? 60), CONC = Math.max(1, Number(process.env.CONC) || 3), DRY = !!process.env.DRY;

const recs = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const systems = new Map(recs.filter((r) => r.type === 'system').map((r) => [r.hash, r.system]));
const SHARE = /Say in `share` how much of it you leave in the village storage: (.+)\.\s*$/m;
const all = recs.filter((r) => r.user && SHARE.test(r.user) && /Village rules:[^\n]*levy|members leave \d+% of their share/.test(r.user));
const step = Math.max(1, Math.floor(all.length / PROMPTS));
const picked = all.filter((_, i) => i % step === 0).slice(0, PROMPTS);

// (STAKE=S: the share rewritten to S items, the levy's amount by the run's rate, to see whether a bigger share is kept)
const STAKE = Number(process.env.STAKE) || 0;
function restake(user: string): string {
  if (!STAKE) return user;
  const rate = Number(/members leave (\d+)% of their share/.exec(user)?.[1] ?? 20) / 100;
  const l = Math.min(STAKE, Math.max(1, Math.round(STAKE * rate)));
  return user.replace(/your share of them is \d+\./, `your share of them is ${STAKE}.`)
    .replace(/"Keep all \d+"/, `"Keep all ${STAKE}"`).replace(/"Leave all \d+"/, `"Leave all ${STAKE}"`).replace(/"Leave \d+ of \d+"/, `"Leave ${l} of ${STAKE}"`);
}

function rebuild(raw: string, cond: string): { user: string; tools: ToolDef[]; answers: Array<{ text: string; id: string }> } {
  const user = restake(raw);
  const texts = [...(SHARE.exec(user)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  // (each answer's kind from its words: keep all / leave L of S / leave all)
  const answers = texts.map((t) => ({ text: t, id: /^keep|none/i.test(t) ? 'none' : /\ball\b/i.test(t) && /^leave/i.test(t) ? 'all' : 'levy' }));
  const names = [...user.split('Options (in no particular order):')[1]?.matchAll(/^- ([^:(\n]+?)(?::| \(|$)/gm) ?? []].map((m) => m[1].trim());
  const rate = /members leave (\d+)% of their share/.exec(user)?.[1] ?? '20';
  const line = cond === 'voted' ? ` From today the levy is ${rate}%, as the village voted last night.` : cond === 'imposed' ? ` From today the levy is ${rate}%.` : '';
  const u = cond === 'base' ? user : user.replace(/(Village rules:[^\n]*?\.)(?=\s|$)/, `$1${line}`);
  const tools: ToolDef[] = [{
    name: 'choose',
    description: 'Choose your next chore: a one-sentence reason first, then the exact name of one option.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', maxLength: 200, description: 'Why, in one sentence.' },
        choice: { type: 'string', enum: names, description: 'The exact name of one option.' },
        share: { type: 'string', enum: texts, description: 'How much of your share you leave in the village storage.' },
      },
      required: ['reason', 'choice'],
    },
  }];
  return { user: u, tools, answers };
}

interface Row { prompt: number; cond: string; k: number; answer?: string; error?: string }
const CONDS = ['base', 'voted', 'imposed'];
const jobs: Array<() => Promise<Row>> = [];
picked.forEach((r, pi) => {
  for (const cond of CONDS) for (let k = 0; k < N; k++) jobs.push(async () => {
    const b = rebuild(r.user, cond);
    if (cond !== 'base' && b.user === restake(r.user)) return { prompt: pi, cond, k, error: 'no rules line' };
    if (DRY) return { prompt: pi, cond, k };
    try {
      const res = await callModel({ spec, system: systems.get(r.system) ?? '', user: b.user, tools: b.tools, level: REASONING.exec, agent: `${r.agent}#${cond}${k}`, kind: 'exec', priority: 'decision' } as never);
      const c = res.reply.calls.find((x) => x.name === 'choose') ?? res.reply.calls[0];
      let inp = c?.input as unknown;
      if (typeof inp === 'string') try { inp = JSON.parse(inp); } catch { inp = {}; }
      const raw = String(((inp ?? {}) as Record<string, unknown>).share ?? '').trim().toLowerCase();
      const hit = b.answers.find((a) => a.text.toLowerCase() === raw) ?? b.answers.find((a) => raw && a.text.toLowerCase().startsWith(raw.slice(0, 12)));
      return { prompt: pi, cond, k, answer: hit?.id ?? (raw ? 'invalid' : 'missing') };
    } catch (e) {
      return { prompt: pi, cond, k, error: String((e as Error)?.message ?? e).slice(0, 120) };
    }
  });
});
console.log(`exp2bench: ${picked.length} prompts (of ${all.length} with a share) x ${CONDS.length} conditions x ${N} = ${jobs.length} calls${DRY ? ' (dry)' : ''}`);
const rows: Row[] = new Array(jobs.length);
let next = 0, done = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (next < jobs.length) {
    const i = next++;
    rows[i] = await jobs[i]();
    if (++done % 30 === 0) console.log(`  ${done}/${jobs.length}`);
  }
}));

const paid = (r: Row) => r.answer === 'levy' || r.answer === 'all';
const ok = (r: Row) => r.answer === 'levy' || r.answer === 'all' || r.answer === 'none';
const summary: Record<string, unknown> = {};
for (const c of CONDS) {
  const rs = rows.filter((r) => r.cond === c);
  const v = rs.filter(ok);
  summary[c] = { n: rs.length, valid: v.length, pay: v.length ? Math.round((v.filter(paid).length / v.length) * 1000) / 1000 : null, all: v.length ? Math.round((v.filter((r) => r.answer === 'all').length / v.length) * 1000) / 1000 : null, errors: rs.filter((r) => r.error).length };
}
// (paired over prompts: each prompt's P(pay) voted minus imposed)
const diffs: number[] = [];
for (let pi = 0; pi < picked.length; pi++) {
  const p = (c: string) => { const x = rows.filter((r) => r.prompt === pi && r.cond === c && ok(r)); return x.length ? x.filter(paid).length / x.length : NaN; };
  const d = p('voted') - p('imposed');
  if (Number.isFinite(d)) diffs.push(d);
}
const mean = diffs.reduce((s, x) => s + x, 0) / Math.max(1, diffs.length);
const pos = diffs.filter((d) => d > 0).length, neg = diffs.filter((d) => d < 0).length;
// (sign test, one-sided: P(at least `pos` of pos+neg) under p = 1/2)
const binom = (n: number, k: number) => { let c = 1; for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1); return c; };
let pSign = 0;
for (let k = pos; k <= pos + neg; k++) pSign += binom(pos + neg, k) / 2 ** (pos + neg);
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const boots = Array.from({ length: 5000 }, () => { let s = 0; for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(rnd() * diffs.length)]; return s / Math.max(1, diffs.length); }).sort((a, b) => a - b);
summary.paired = { prompts: diffs.length, meanDiff: Math.round(mean * 1000) / 1000, ci95: [Math.round(boots[125] * 1000) / 1000, Math.round(boots[4874] * 1000) / 1000], votedHigher: pos, imposedHigher: neg, signTestP: Math.round(pSign * 1000) / 1000 };
console.log(JSON.stringify(summary));
const out = path.join(ROOT, 'runs/2026-10-23/g3-rules/bench', `exp2bench-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ model: MODEL, file: FILE, N, prompts: picked.map((r) => ({ agent: r.agent, at: r.at })), summary, rows }, null, 1));
console.log(`wrote ${out}`);
process.exit(0);
