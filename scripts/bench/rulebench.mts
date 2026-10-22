/**
 * rulebench (G3, #30): the council's secret ballot (council.ts ballotPrompt, parseBallot) asked of the real model. Cases:
 * ballots of 1-3 laws of each type (quota, floor, duty, levy, norm), with and without rules already in force, each asked N
 * times with a different member (the yes/no order and the items' order are seeded per member). Measures: valid ballots
 * (every item answered), the yes share by type, abstentions, and whether the first-listed of yes/no is chosen more than
 * the second (position bias, E.6's exit: under 1.5x).
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/rulebench.mts   (env N: samples a case, default 10; CONC 2;
 *   MODEL; DRY=1). Writes runs/2026-10-21/g3-rules/bench/ballotbench-<timestamp>.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rulebench-'));
process.env.MC_MEMORY = 'on';
process.env.MC_CLOCK = 'on';
process.env.MC_RULES = 'on';
process.env.MC_COUNCIL = 'on';
process.env.MCAI_ACTS_LOG = path.join(dir, 'acts.jsonl');
const mem = await import('../../server/src/memory');
const rules = await import('../../server/src/rules');
const council = await import('../../server/src/council');
const { callModel, parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');

const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL)!;
const N = Number(process.env.N ?? 10), CONC = Math.max(1, Number(process.env.CONC) || 2), DRY = !!process.env.DRY;
const NAMES = ['Ada', 'Ben', 'Clara', 'Dev', 'Elena', 'Finn', 'Grace', 'Hugo', 'Iris', 'Jonah', 'Kai', 'Lena'];
const V = 'Bench';
mem.initMemory(null);
for (const n of NAMES) mem.noteSpawn(V, n, { role: 'worker', brain: 'tiered', memory: {}, reset: true }, 1);

const L = (by: string, what: string) => {
  const l = rules.addLaw(V, by, { what }, 2);
  for (const b of NAMES.filter((x) => x !== by).slice(0, 3)) rules.backLaw(V, l.id, b);
  return l;
};
const cases = [
  { name: 'quota', items: [L('Ada', 'Each member takes at most 8 logs a day from storage')] },
  { name: 'floor', items: [L('Ben', 'Storage keeps at least 32 bread')] },
  { name: 'duty', items: [L('Clara', 'Every member tends pens once a day')] },
  { name: 'levy', items: [L('Dev', 'A levy of 20% on every share')] },
  { name: 'norm', items: [L('Elena', 'Members greet each other at the storage hut')] },
  { name: 'three', items: [L('Finn', 'Each member takes at most 4 torches a day from storage'), L('Grace', 'Storage keeps at least 16 torch'), L('Hugo', 'Every member lights the village once a day')] },
];

async function pool<T>(jobs: Array<() => Promise<T>>): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < jobs.length) {
      const k = i++;
      out[k] = await jobs[k]();
    }
  }));
  return out;
}

const jobs = cases.flatMap((c) => Array.from({ length: N }, (_, s) => async () => {
  const agent = NAMES[s % NAMES.length];
  const p = council.ballotPrompt(V, agent, c.items, '', 3);
  const firstWord = /then (yes|no) or/.exec(p.user)?.[1];
  if (DRY) return { case: c.name, agent, dry: true, chars: p.user.length };
  try {
    const r = await callModel({ spec, system: p.system, user: p.user, tools: p.tools as never, level: REASONING.ballot, agent, kind: 'ballot', priority: 'ballot', maxWaitMs: 120000, fallbackMs: 120000 });
    const call = r.reply.calls.find((x) => x.name === 'vote') ?? r.reply.calls[0];
    const votes = council.parseBallot(call?.input ?? r.reply.text.slice(r.reply.text.indexOf('{'), r.reply.text.lastIndexOf('}') + 1), c.items);
    return { case: c.name, agent, votes, valid: c.items.every((l) => votes[l.id]), firstWord, raw: JSON.stringify(call?.input ?? r.reply.text).slice(0, 400) };
  } catch (e) {
    return { case: c.name, agent, error: String((e as Error).message).slice(0, 160) };
  }
}));
const res = await pool(jobs);
const valid = res.filter((x) => (x as { valid?: boolean }).valid).length;
const by: Record<string, { yes: number; no: number; abstain: number }> = {};
let first = 0, decided = 0;
for (const x of res as Array<{ case: string; votes?: Record<string, string>; firstWord?: string }>) {
  for (const v of Object.values(x.votes ?? {})) {
    (by[x.case] ??= { yes: 0, no: 0, abstain: 0 })[v as 'yes']++;
    if (v === 'yes' || v === 'no') {
      decided++;
      if (v === x.firstWord) first++;
    }
  }
}
const summary = { calls: res.length, valid: `${valid}/${res.length}`, byCase: by, firstListedShare: decided ? Math.round((first / decided) * 100) / 100 : null };
console.log(JSON.stringify(summary));
const out = path.join(ROOT, 'runs/2026-10-21/g3-rules/bench', `rulebench-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ model: MODEL, summary, res }, null, 1));
console.log(`written ${out}`);
process.exit(0);
