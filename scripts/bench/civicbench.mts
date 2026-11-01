/**
 * civicbench (civic variety, 11-01): the mayor's civic choice on the real prompt (civicOptions, civicPrompt, CIVIC_SYSTEM,
 * CIVIC_TOOL, the real callModel and checkCivic) for a fresh village (no civic building yet, timber and stone open), N
 * samples for each of SEEDS village names. Reports each pick, its size rank among the options (0 = the fewest blocks)
 * and the spread of picks across seeds. Trains 15-16 and the staged runs took the smallest 228 times in 261 calls.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/civicbench.mts
 * Env: MODEL (default ollama:gpt-oss:120b-cloud), N (samples a seed, default 10), CONC (calls at once, default 3),
 *   SEEDS (village names, default P1,Elmfield,Riverbend,Meadowford,Stonebrook), IRON=0 (timber only), PEEK=1 (each
 *   reason), MENU=old (the fixed menu before 11-01; else each sample draws its own list, as a run of its own), CHECKPOINT (a villages.json: a seed named there is that village, its site and civics), DRY=1 (print the prompts, no calls), OLDPROMPT=1 (the prompt before MC_CIVIC_VARIETY on the same lists).
 * Writes a JSON summary to runs/<date>/bench/civicbench-<timestamp>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.MC_MODEL_RECORD ??= '0';
const { civicOptions, civicPrompt, checkCivic, setCivic, CIVIC_SYSTEM, CIVIC_TOOL } = await import('../../server/src/civic');
const { setPicks } = await import('../../server/src/shortlist');
const { callModel, parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');

const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL);
if (!spec) throw new Error(`MODEL=${MODEL} is not <provider>:<model>`);
const N = Number(process.env.N ?? 10), CONC = Number(process.env.CONC ?? 3);
const SEEDS = (process.env.SEEDS ?? 'P1,Elmfield,Riverbend,Meadowford,Stonebrook').split(',').map((s) => s.trim()).filter(Boolean);
const IRON = process.env.IRON !== '0';

const savedRaw = process.env.CHECKPOINT ? JSON.parse(fs.readFileSync(process.env.CHECKPOINT, 'utf8')) : [];
const saved = (Array.isArray(savedRaw.villages ?? savedRaw) ? savedRaw.villages ?? savedRaw : Object.values(savedRaw.villages ?? savedRaw)) as Array<{ name: string }>;
type Row = { seed: string; pick: string | null; rank: number; blocks: number; reason: string; offered: string[] };
const rows: Row[] = [];
const jobs: Array<() => Promise<void>> = [];
// (MENU=old: the fixed list and prompt before 11-01, MC_PICK_RANDOM and MC_CIVIC_VARIETY off; else each sample is a run
// of its own: MC_PICK_RANDOM's seed is draw<k>, so the list is drawn again)
const OLD = process.env.MENU === 'old';
setPicks({ random: !OLD });
for (const [i, seed] of SEEDS.entries()) {
  // (a fresh village: the storage chest stands in for its site, as on the test sites; CHECKPOINT: the saved village)
  const v = (saved.find((x) => x.name === seed) ?? { name: seed, plots: Array.from({ length: 25 }), storage: { chests: [{ x: 100 * i, y: 64, z: -50 * i }], updated: 0 } }) as never;
  for (let k = 0; k < N; k++) {
    if (!OLD) setPicks({ seed: `draw${k}` });
    setCivic({ variety: !OLD });
    const options = civicOptions(v, IRON);
    // (OLDPROMPT=1: the lists as now, the prompt before MC_CIVIC_VARIETY, to compare prompts on the same lists)
    if (process.env.OLDPROMPT) setCivic({ variety: false });
    const user = civicPrompt({ village: seed, members: 25, wood: 'birch', houses: 25, built: [], options });
    const sizes = [...options].sort((a, b) => a.blocks - b.blocks).map((o) => o.id);
    if (k === 0 || !OLD) console.log(`${seed}${OLD ? '' : ` draw${k}`}: ${options.map((o) => `${o.id} ${o.blocks}`).join(', ')}`);
    if (process.env.DRY) { if (k === 0) console.log(user); continue; }
    jobs.push(async () => {
      try {
        const { reply } = await callModel({ spec, system: CIVIC_SYSTEM, user, tools: [CIVIC_TOOL], level: REASONING.design, agent: 'Mayor', kind: 'design', priority: 'plan' });
        const call = reply.calls?.find((c) => c.name === CIVIC_TOOL.name);
        const r = call ? checkCivic(call.input as Record<string, unknown>, options) : { problem: 'no call' };
        const pick = 'pick' in r ? r.pick : null;
        rows.push({ seed, pick: pick?.id ?? null, rank: pick ? sizes.indexOf(pick.id) : -1, blocks: pick?.blocks ?? 0, reason: 'pick' in r ? r.reason : r.problem, offered: sizes });
        if (process.env.PEEK) console.log(`  ${seed}: ${pick?.id ?? '-'} (rank ${pick ? sizes.indexOf(pick.id) : '-'}): ${'pick' in r ? r.reason : r.problem}`);
      } catch (e) {
        rows.push({ seed, pick: null, rank: -1, blocks: 0, reason: String((e as Error)?.message ?? e).slice(0, 120), offered: sizes });
      }
    });
  }
}
let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (next < jobs.length) await jobs[next++](); }));
if (process.env.DRY) process.exit(0);

const count = <T,>(xs: T[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>())].sort((a, b) => b[1] - a[1]);
console.log(`\n=== civicbench ${MODEL} N=${N} seeds=${SEEDS.length} iron=${IRON}`);
for (const seed of SEEDS) {
  const rs = rows.filter((r) => r.seed === seed);
  console.log(`${seed}: ${count(rs.map((r) => r.pick ?? '-')).map(([p, c]) => `${p} ${c}`).join(', ')}; smallest ${rs.filter((r) => r.rank === 0).length}/${rs.length}`);
}
const ok = rows.filter((r) => r.pick);
console.log(`all: smallest ${ok.filter((r) => r.rank === 0).length}/${ok.length}, size ranks ${count(ok.map((r) => r.rank)).sort((a, b) => a[0] - b[0]).map(([k, c]) => `${k}:${c}`).join(' ')}, distinct picks ${new Set(ok.map((r) => r.pick)).size}, failed ${rows.length - ok.length}`);
console.log(`picks: ${count(ok.map((r) => r.pick)).map(([p, c]) => `${p} ${c}`).join(', ')}`);
const out = path.join(ROOT, 'runs', new Date().toISOString().slice(0, 10), 'bench');
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, `civicbench-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify({ model: MODEL, n: N, seeds: SEEDS, iron: IRON, menu: OLD ? 'old' : 'drawn', oldPrompt: !!process.env.OLDPROMPT, rows }, null, 1));
console.log(`wrote ${file}`);
