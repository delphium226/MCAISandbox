/**
 * wordsbench (#164, MC_RULE_WORDS): train 7's own ballots asked again with and without the words-only line on their norms.
 * Each case is a recorded ballot prompt (acts ledger, type ballot) whose items include a norm; the "words" condition adds
 * council.ts' line after each norm's text, as ballotPrompt writes it ("(words only: ...)" before "; proposed by"). Measures:
 * yes share on norms and on typed laws per condition, valid ballots. Train 7 voted yes on 94-98% of norms with no stake shown.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/wordsbench.mts [ACTS.jsonl ...]   (env N: samples a case and
 *   condition, default 10; CASES: recorded ballots a meeting, default 2; CONC 3; MODEL; DRY=1). Default ledgers: train 7's
 *   A and B. Writes runs/2026-10-27/i164/wordsbench-<timestamp>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.MC_RULES = 'on';
process.env.MC_RULE_WORDS = 'on';
const rules = await import('../../server/src/rules');
const { callModel, parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');

const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL)!;
const N = Number(process.env.N ?? 10), CASES = Number(process.env.CASES ?? 2), CONC = Math.max(1, Number(process.env.CONC) || 3), DRY = !!process.env.DRY;
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['A', 'B'].map((r) => path.join(ROOT, `runs/2026-10-27/train7/T/${r}.acts.jsonl`));
// (council.ts' SYSTEM, word for word)
const SYSTEM = 'You are a member of a Minecraft village. At dusk the village votes in secret on rules members proposed. '
  + 'Your ballot is never shown to anyone; only the totals are. Vote as you judge best for yourself and the village. Call `vote` once.';
const LINE = rules.wordsOnly('norm');

interface Case { file: string; day: number; agent: string; prompt: string; types: Record<string, string> }
const cases: Case[] = [];
for (const f of files) {
  const acts = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
  const types: Record<string, string> = {};
  for (const a of acts) if (a.type === 'law' && a.id && !a.op) types[a.id] = a.rule;
  const byDay = new Map<number, Record<string, any>[]>();
  for (const a of acts) if (a.type === 'ballot' && typeof a.prompt === 'string' && Object.keys(a.votes ?? {}).some((k) => types[k] === 'norm')) byDay.set(a.day, [...(byDay.get(a.day) ?? []), a]);
  for (const [day, bs] of byDay) for (const b of bs.slice(0, CASES)) cases.push({ file: path.basename(f), day, agent: b.agent, prompt: b.prompt, types });
}

/** The words condition: the line after each norm item's text, where ballotPrompt puts code's preview. */
function withWords(c: Case): string {
  return c.prompt.split('\n').map((l) => {
    const m = /^- \[(l\d+)\] (.*?); proposed by/.exec(l);
    return m && c.types[m[1]] === 'norm' ? l.replace('; proposed by', ` (${LINE}); proposed by`) : l;
  }).join('\n');
}

function tools(prompt: string) {
  const ids = [...prompt.matchAll(/^- \[([^\]]+)\]/gm)].map((m) => m[1]);
  return [{
    name: 'vote', description: 'Cast your secret ballot: for each item, a reason first, then your vote.',
    input_schema: { type: 'object', properties: { votes: { type: 'array', maxItems: ids.length, items: { type: 'object', properties: { item: { type: 'string', enum: ids }, reason: { type: 'string', maxLength: 160 }, vote: { type: 'string', enum: ['yes', 'no', 'abstain', '0%', '10%', '20%', '30%', '40%', '50%'] } }, required: ['item', 'vote'] } } }, required: ['votes'] },
  }];
}

function votesOf(input: unknown): Record<string, string> {
  let o = input as any;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return {}; } }
  let vs = o?.votes;
  if (typeof vs === 'string') { try { vs = JSON.parse(vs); } catch { return {}; } }
  const out: Record<string, string> = {};
  for (const v of Array.isArray(vs) ? vs : []) if (v?.item) out[String(v.item)] = String(v.vote ?? '').toLowerCase();
  return out;
}

const jobs = cases.flatMap((c) => (['plain', 'words'] as const).flatMap((cond) => Array.from({ length: N }, (_, i) => ({ c, cond, i }))));
console.log(`${cases.length} recorded ballots with norms; ${jobs.length} calls (${MODEL})`);
if (DRY) { console.log(withWords(cases[0]).slice(0, 1500)); process.exit(0); }
const tally: Record<string, { norm: Record<string, number>; typed: Record<string, number>; valid: number; n: number }> = {};
const rows: unknown[] = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { c, cond, i } = jobs[next++];
    const user = cond === 'words' ? withWords(c) : c.prompt;
    const t = (tally[cond] ??= { norm: {}, typed: {}, valid: 0, n: 0 });
    t.n++;
    try {
      const r = await callModel({ spec, system: SYSTEM, user, tools: tools(user), level: REASONING.ballot ?? 'low', agent: `${c.agent}${i}`, kind: 'ballot', priority: 'ballot' });
      const call = r.reply.calls.find((x) => x.name === 'vote') ?? r.reply.calls[0];
      const v = votesOf(call?.input);
      const items = Object.keys(c.types).filter((id) => user.includes(`[${id}]`));
      if (items.every((id) => v[id])) t.valid++;
      for (const id of items) if (v[id]) { const k = c.types[id] === 'norm' ? t.norm : t.typed; k[v[id]] = (k[v[id]] ?? 0) + 1; }
      rows.push({ case: `${c.file}:d${c.day}:${c.agent}`, cond, votes: v });
    } catch (e) {
      rows.push({ case: `${c.file}:d${c.day}:${c.agent}`, cond, error: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
const share = (x: Record<string, number>) => `${Math.round(100 * (x.yes ?? 0) / Math.max(1, (x.yes ?? 0) + (x.no ?? 0)))}% yes of ${(x.yes ?? 0) + (x.no ?? 0)}`;
for (const [cond, t] of Object.entries(tally)) console.log(`${cond}: norms ${share(t.norm)}; typed ${share(t.typed)}; valid ${t.valid}/${t.n}`);
const out = path.join(ROOT, 'runs/2026-10-27/i164', `wordsbench-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ model: MODEL, n: N, cases: cases.map((c) => `${c.file}:d${c.day}:${c.agent}`), tally, rows }, null, 1));
console.log(`wrote ${out}`);
