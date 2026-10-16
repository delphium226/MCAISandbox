/**
 * ballotbench (the first vote, spec runs/2026-10-16/s33/spec_vote1.md 5.2): the style ballot on the real prompt for
 * Mayor + Worker1-24, through castBallot() and the real callModel, N shuffles a voter. The options are measured from the
 * vanilla libraries by a real MineflayerWorld loaded on a copy of a villages.json (no bots), so their facts are the ones a
 * run shows. Reports the valid share, the chosen position as shown against chance (order bias), agreement with each
 * voter's temperament-predicted ballot, each voter's same choice across its shuffles, the spread of choices, and latency
 * and tokens. With MCAI_TEMPERAMENT=identical (no persona lines) it is the control.
 *
 * Usage: node_modules/.bin/tsx scripts/bench/ballotbench.mts
 * Env: MODEL (default ollama:gpt-oss:120b-cloud), THINK (default REASONING.ballot), N (shuffles a voter, default 3),
 *   CONC (ballots at once, default 3), STYLES (default plains,savanna,snowy,desert: the first is the current style),
 *   BUILT (neighbourhoods built of the current style, default 1), VOTERS (a regex on names, default all 25),
 *   VILLAGES (default mc/testserver/villages.json), PEEK=1 (each ballot's reason), DRY=1 (no network: the first shown).
 * Writes a JSON summary to runs/<date>/bench/ballotbench-<timestamp>.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.MC_TIME_SCALE = '1';
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'ballotbench-'));
process.env.MCAI_CHOICE_LOG = path.join(SCRATCH, 'c.jsonl');
const { castBallot, predictedChoice, styleOption } = await import('../../server/src/vote');
const { temperament, personaOf, TEMPERAMENT_MODE } = await import('../../server/src/temperament');
const { parseSpec, label } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');

const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL);
if (!spec) throw new Error(`MODEL=${MODEL} is not <provider>:<model>`);
const level = (process.env.THINK?.trim().toLowerCase() || REASONING.ballot) as 'low' | 'medium' | 'high';
const N = Number(process.env.N ?? 3), CONC = Number(process.env.CONC ?? 3);
const STYLES = (process.env.STYLES ?? 'plains,savanna,snowy,desert').split(',').map((s) => s.trim()).filter(Boolean);
const BUILT = Number(process.env.BUILT ?? 1);
const VOTERS = new RegExp(process.env.VOTERS ?? '.');

// The options, measured by a world on a copy (console quiet while it loads the jar's pieces)
const dir = fs.mkdtempSync(path.join(SCRATCH, 'w-'));
fs.copyFileSync(path.join(ROOT, process.env.VILLAGES ?? 'mc/testserver/villages.json'), path.join(dir, 'villages.json'));
const quiet = { log: console.log, warn: console.warn };
console.log = () => {};
console.warn = () => {};
const w = new MineflayerWorld('127.0.0.1', 0, '26.1', { command: async () => '' } as never, dir) as unknown as { styleHouses(b: string): Array<{ name: string; units: number; volume: number; gather: Record<string, number> }> };
const options = STYLES.map((b, i) => styleOption(b, w.styleHouses(b), i === 0 ? BUILT : 0, i === 0)).filter((o) => o.facts);
Object.assign(console, quiet);
for (const o of options) console.log(`option ${o.name}: ${o.facts} [units ${o.units}, volume ${o.volume}]`);

const names = ['Mayor', ...Array.from({ length: 24 }, (_, i) => `Worker${i + 1}`)].filter((n) => VOTERS.test(n));
const village = `Minevale: 14 houses for 25 members; neighbourhoods built: ${BUILT} of ${options[0].name.toLowerCase()}`;
const dry = process.env.DRY === '1';
const fake = async (req: { tools: Array<{ input_schema: { properties: { choice: { enum: string[] } } } }> }) =>
  ({ ms: 1, waitMs: 0, reply: { text: '', calls: [{ name: 'vote', input: { reason: 'dry', choice: req.tools[0].input_schema.properties.choice.enum[0] } }], promptTokens: 0, outputTokens: 0 } });

interface Row { agent: string; s: number; choice: string | null; predicted: string | null; position?: number; shown: number; why?: string; reason: string; ms?: number; pt?: number; ot?: number }
const rows: Row[] = [];
const jobs: Array<() => Promise<void>> = [];
for (const agent of names) for (let s = 0; s < N; s++) jobs.push(async () => {
  const predicted = predictedChoice(temperament(agent, 'on'), options);
  const b = await castBallot({
    voteId: `bench${s}`, agent, spec, level, options, predicted,
    ctx: { persona: personaOf(agent), pattern: '', self: '', village },
    ...(dry ? { call: fake as never } : {}),
  });
  rows.push({ agent, s, choice: b.choice, predicted, position: b.position, shown: b.shown.length, why: b.why, reason: b.reason, ms: b.ms, pt: b.promptTokens, ot: b.outputTokens });
  if (process.env.PEEK) console.log(`${agent} #${s}: ${b.choice ?? `(${b.why})`} [predicted ${predicted}] ${b.reason}`);
});
let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (next < jobs.length) await jobs[next++](); }));

const valid = rows.filter((r) => r.choice);
const pos: Record<number, number> = {};
for (const r of valid) if (r.position) pos[r.position] = (pos[r.position] ?? 0) + 1;
const agree = valid.filter((r) => r.choice === r.predicted).length;
const byAgent = new Map<string, Row[]>();
for (const r of valid) byAgent.set(r.agent, [...(byAgent.get(r.agent) ?? []), r]);
const consistent = [...byAgent.values()].filter((rs) => rs.length >= 2 && rs.every((r) => r.choice === rs[0].choice)).length;
const spreadOf: Record<string, number> = {};
for (const r of valid) spreadOf[r.choice!] = (spreadOf[r.choice!] ?? 0) + 1;
const predSpread: Record<string, number> = {};
for (const n of names) {
  const p = predictedChoice(temperament(n, 'on'), options) ?? '-';
  predSpread[p] = (predSpread[p] ?? 0) + 1;
}
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
console.log(`\nballotbench ${label(spec)} think ${level}, temperaments ${TEMPERAMENT_MODE}, ${names.length} voters x ${N}, ${options.length} options`);
console.log(`valid ${valid.length} of ${rows.length} (${pct(valid.length, rows.length)}); failures ${JSON.stringify(rows.filter((r) => !r.choice).reduce((m: Record<string, number>, r) => ((m[r.why ?? '?'] = (m[r.why ?? '?'] ?? 0) + 1), m), {}))}`);
console.log(`position as shown: ${Object.entries(pos).sort().map(([p, n]) => `${p}: ${n} (${pct(n, valid.length)})`).join(', ')}; chance ${pct(1, options.length)} each`);
console.log(`choices: ${JSON.stringify(spreadOf)}; predicted (one a voter): ${JSON.stringify(predSpread)}`);
console.log(`agreement with the predicted ballot: ${agree} of ${valid.length} (${pct(agree, valid.length)}); voters with the same choice in all shuffles: ${consistent} of ${byAgent.size}`);
const ms = valid.map((r) => r.ms ?? 0).sort((a, b) => a - b);
console.log(`latency p50 ${ms[Math.floor(ms.length / 2)] ?? 0} ms, p90 ${ms[Math.floor(ms.length * 0.9)] ?? 0} ms; tokens ${valid.reduce((s, r) => s + (r.pt ?? 0), 0)} in / ${valid.reduce((s, r) => s + (r.ot ?? 0), 0)} out`);
const out = path.join(ROOT, 'runs', new Date().toISOString().slice(0, 10), 'bench');
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, `ballotbench-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({ model: MODEL, level, temperaments: TEMPERAMENT_MODE, options, rows }, null, 1));
console.log(`written ${path.relative(ROOT, file)}`);
