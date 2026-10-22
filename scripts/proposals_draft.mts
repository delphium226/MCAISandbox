/**
 * G5 offline: proposals drawn from real runs (spec runs/2026-10-21/g5-proposals/spec.md 8). Two sources:
 *  - the members' own nights: a run's reflection prompts (acts.jsonl, `reflect` records, the full prompt as sent) asked
 *    again with the reflection's tool plus proposals.ts' `propose` field and line, through the real model (gpt-oss, the
 *    members' model, kind `reflect`): what members propose in their words, with the night's evidence in front of them;
 *  - code: failures that recur in the decision log (choice-end records with the same message, 3+ times) as `fix` drafts.
 * Each is checked by proposals.ts (checkProposal, duplicates, code's own answers) and kept in OUT/proposals.json.
 *
 * Usage: node_modules/.bin/tsx scripts/proposals_draft.mts RUN [RUN ...] [--nights N] [--out DIR] [--dry]
 *   RUN: a run's path without extension (RUN.acts.jsonl, RUN.choices.jsonl), e.g. runs/2026-10-21/g1-memory/g1run/G1a
 *   --nights N  nights asked in all (default 40): half "reason nights" (the day shows a failure, a refusal or a "lack"
 *               word; one per member first), half drawn at random (seeded) from the rest; each asked SAMPLES times
 *   --out DIR   default runs/2026-10-21/g5-proposals; --dry: no model calls (a fake reply that proposes on every 3rd night)
 *   --reuse     ask the nights kept in DIR/draft_picked.json again (with MC_MODEL_REPLAY: the same replies, re-parsed)
 * Env: MODEL (default ollama:gpt-oss:120b-cloud), CONC (2), SAMPLES (2: each night asked twice, lesson 20).
 * Reports the field's fill rate (replies carrying any proposal-like key) and parse rate, by night type (the spec check's B1).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ToolDef } from '../server/src/world';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const runs = args.filter((a, i) => !a.startsWith('--') && !['--nights', '--out'].includes(args[i - 1]));
const NIGHTS = Number(opt('--nights', '40'));
const OUT = opt('--out', 'runs/2026-10-21/g5-proposals');
const DRY = args.includes('--dry');
if (!runs.length) {
  console.error('usage: proposals_draft.mts RUN [RUN ...] [--nights N] [--out DIR] [--dry]');
  process.exit(2);
}
const P = await import('../server/src/proposals');
const { offlineCtx } = await import('./proposals_ctx.mts');
const { callModel, parseSpec } = await import('../server/src/modelCall');
const spec = parseSpec(process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud')!;
const CONC = Math.max(1, Number(process.env.CONC) || 2);
const ctx = await offlineCtx();
fs.mkdirSync(OUT, { recursive: true });
P.initProposals(OUT);

type Rec = Record<string, any>;
const read = (f: string): Rec[] => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** The reflection's tool as society.ts builds it (its replaces enum left open: the ids are in the prompt). */
const REFLECT: ToolDef = {
  name: 'reflect', description: 'Keep up to 2 notes and set your intention for tomorrow.',
  input_schema: {
    type: 'object',
    properties: {
      notes: { type: 'array', maxItems: 2, description: 'Notes to keep (may be empty).', items: { type: 'object', properties: { text: { type: 'string', maxLength: 160 }, replaces: { type: 'string' } }, required: ['text'] } },
      intention: { type: 'string', maxLength: 200, description: 'What you mean to do tomorrow and why, one sentence.' },
      focus: { type: 'string', description: 'The kind of work you mean to do most tomorrow.' },
    },
    required: ['notes', 'intention', 'focus'],
  },
};
const LACK = /\bfailed\b|refused|\bno (free|site|room|[a-z]+ (in|left))\b|kept failing|\bshort of\b|\bcannot\b|\bcan't\b/i;

// ---- the nights
interface Night { run: string; village: string; agent: string; day: number; system: string; prompt: string; score: number }
const nights: Night[] = [];
for (const run of runs) {
  for (const r of read(`${run}.acts.jsonl`)) {
    if (r.type !== 'reflect' || !r.prompt || !r.system) continue;
    nights.push({ run: path.basename(run), village: r.village, agent: r.agent, day: r.day, system: r.system, prompt: r.prompt, score: (LACK.test(r.prompt.split('Your record')[0]) ? 2 : 0) + (r.day >= 2 ? 1 : 0) });
  }
}
// (reason nights, one per member and run first; then random nights, seeded, from the rest)
const SAMPLES = Math.max(1, Number(process.env.SAMPLES ?? 2));
const reasons = nights.filter((n) => n.score >= 2).sort((a, b) => a.day - b.day);
const half = Math.ceil(NIGHTS / 2);
const picked: Night[] = [];
const seen = new Set<string>();
for (const n of reasons) if (picked.length < half && !seen.has(`${n.run}|${n.agent}`)) { seen.add(`${n.run}|${n.agent}`); picked.push(n); }
for (const n of reasons) if (picked.length < half && !picked.includes(n)) picked.push(n);
const rest = nights.filter((n) => !picked.includes(n));
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
while (picked.length < NIGHTS && rest.length) picked.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0]);
// (the nights asked are kept, so a later parse can replay the same calls: MC_MODEL_REPLAY with the run's model-call record)
const pickedFile = path.join(OUT, 'draft_picked.json');
if (args.includes('--reuse') && fs.existsSync(pickedFile)) picked.splice(0, picked.length, ...(JSON.parse(fs.readFileSync(pickedFile, 'utf8')) as Night[]));
else fs.writeFileSync(pickedFile, JSON.stringify(picked));
const jobs = picked.flatMap((n) => Array.from({ length: SAMPLES }, (_, s) => ({ ...n, sample: s, type: n.score >= 2 ? 'reason' : 'random' })));
console.log(`[draft] ${nights.length} nights in ${runs.length} run(s) (${reasons.length} reason nights); asking ${picked.length} nights x ${SAMPLES} (${picked.filter((n) => n.score >= 2).length} reason nights)`);

// ---- the runs' failures (the check's context)
const shapeOf = (m: string) => m.replace(/-?\d+(\.\d+)?/g, 'N').replace(/\s+/g, ' ').slice(0, 90);
const fails = new Map<string, { name: string; message: string; n: number }>();
for (const run of runs) {
  const recs = read(`${run}.choices.jsonl`);
  const choice = new Map(recs.filter((r) => r.type === 'choice').map((r) => [r.id, r]));
  for (const e of recs) {
    if (e.type !== 'choice-end' || e.ok || e.cut || e.code) continue;
    const c = choice.get(e.id);
    if (!c) continue;
    const name = c.options?.find((o: Rec) => o.id === c.chosen)?.name ?? c.what;
    const k = `${name}|${shapeOf(String(e.message ?? ''))}`;
    const f = fails.get(k) ?? { name, message: String(e.message ?? ''), n: 0 };
    f.n++;
    fails.set(k, f);
  }
}
ctx.failures = [...fails.values()].filter((f) => f.n >= 2);
console.log(`[draft] failures seen 2+ times in the runs: ${ctx.failures.map((f) => `${f.name} x${f.n}`).join('; ') || 'none'}`);

// ---- ask
const results: Rec[] = [];
let next = 0;
let tokens = { in: 0, out: 0 };
async function worker() {
  while (next < jobs.length) {
    const n = jobs[next++];
    const user = `${n.prompt}\n\n${P.proposeLine()}`;
    let input: unknown = null;
    try {
      if (DRY) input = next % 3 ? { notes: [], intention: 'x', focus: 'making goods' } : { notes: [], intention: 'x', propose: { kind: 'item', what: 'Make candles for the houses', why: 'the houses are dark' } };
      else {
        const r = await callModel({ spec, system: n.system, user, tools: P.withPropose([REFLECT]), level: 'medium', agent: n.agent, kind: 'reflect', priority: 'reflection' });
        tokens = { in: tokens.in + (r.reply.promptTokens ?? 0), out: tokens.out + (r.reply.outputTokens ?? 0) };
        input = (r.reply.calls.find((c) => c.name === 'reflect') ?? r.reply.calls[0])?.input ?? null;
        if (typeof input === 'string') {
          try { input = JSON.parse(input); } catch { /* left as it is */ }
        }
      }
    } catch (e) {
      results.push({ ...n, error: String((e as Error).message).slice(0, 120) });
      continue;
    }
    const got = P.parsePropose(input);
    const keys = input && typeof input === 'object' ? Object.keys(input as object) : [];
    const filled = keys.some((k) => /propos|suggest/i.test(k) && (input as Record<string, unknown>)[k] && JSON.stringify((input as Record<string, unknown>)[k]).length > 4);
    results.push({ run: n.run, agent: n.agent, day: n.day, type: n.type, sample: n.sample, filled, proposed: !!got, ...(got ? { what: got.what, kind: got.kind } : {}) });
    if (got) {
      const ev = got.evidence.map((ref) => ({ ref, text: ref }));
      const p = P.addProposal({ village: n.village, by: n.agent, kind: got.kind, what: got.what, why: got.why, evidence: ev, day: n.day, run: n.run, source: `${n.run} night ${n.day}` }, ctx);
      if (p) console.log(`[draft] ${n.run} ${n.agent} day ${n.day}: ${p.id} ${p.kind}: ${p.what} -> ${p.check.verdict} (${p.check.reason.slice(0, 90)})`);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()));

// ---- failures that recur (code's fix drafts); also the check's context: a proposal naming one is a fix
const shape = (m: string) => m.replace(/-?\d+(\.\d+)?/g, 'N').replace(/\s+/g, ' ').slice(0, 90);
for (const run of runs) {
  const recs = read(`${run}.choices.jsonl`);
  const choice = new Map(recs.filter((r) => r.type === 'choice').map((r) => [r.id, r]));
  const groups = new Map<string, Array<{ agent: string; name: string; message: string; t: number }>>();
  for (const e of recs) {
    if (e.type !== 'choice-end' || e.ok || e.cut || e.code) continue;
    const c = choice.get(e.id);
    if (!c) continue;
    const k = `${c.kind}|${shape(String(e.message ?? ''))}`;
    const g = groups.get(k) ?? [];
    g.push({ agent: c.agent, name: c.options?.find((o: Rec) => o.id === c.chosen)?.name ?? c.what, message: String(e.message ?? ''), t: e.tEnd });
    groups.set(k, g);
  }
  for (const [, g] of [...groups.entries()].filter(([, g]) => g.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 6)) {
    const who = [...g.reduce((m, x) => m.set(x.agent, (m.get(x.agent) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0][0];
    const p = P.addProposal({
      village: recs.find((r) => r.type === 'choice')?.village ?? '?', by: who, kind: 'fix',
      what: `${g[0].name}: ${g[0].message}`.slice(0, 140), why: `it failed ${g.length} times for ${new Set(g.map((x) => x.agent)).size} members`,
      evidence: g.slice(0, 4).map((x) => ({ ref: `fail:${x.t}`, text: `${x.agent}: ${x.name}: ${x.message.slice(0, 100)}` })), run: path.basename(run), source: `${path.basename(run)} failures`,
    }, ctx);
    if (p) console.log(`[draft] ${path.basename(run)} failures: ${p.id} fix by ${p.by}: ${p.what} (${g.length}x)`);
  }
}
P.flushProposals();
const all = P.allProposals();
const asked = results.filter((r) => !r.error).length;
const by = (k: (p: typeof all[number]) => string) => [...all.reduce((m, p) => m.set(k(p), (m.get(k(p)) ?? 0) + 1), new Map<string, number>()).entries()].map(([x, n]) => `${x} ${n}`).join(', ');
console.log(`[draft] replies ${asked} (${results.filter((r) => r.error).length} errors); proposed on ${results.filter((r) => r.proposed).length} (${Math.round((100 * results.filter((r) => r.proposed).length) / Math.max(1, asked))}%)`);
for (const ty of ['reason', 'random']) {
  const xs = results.filter((r) => !r.error && r.type === ty);
  console.log(`[draft]   ${ty} nights: ${xs.length} replies, field filled ${xs.filter((r) => r.filled).length}, parsed as a proposal ${xs.filter((r) => r.proposed).length}`);
}
console.log(`[draft] ${all.length} proposals: by kind ${by((p) => p.kind)}; by code's check ${by((p) => p.check.verdict)}; by status ${by((p) => p.status)}`);
console.log(`[draft] tokens ${tokens.in} in / ${tokens.out} out, ~$${((tokens.in * 0.15 + tokens.out * 0.6) / 1e6).toFixed(3)}; kept in ${path.join(OUT, 'proposals.json')}`);
fs.writeFileSync(path.join(OUT, 'draft_nights.json'), JSON.stringify(results, null, 1));
