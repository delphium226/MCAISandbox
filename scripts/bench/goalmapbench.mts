/**
 * goalmapbench (the start screen, spec runs/2026-10-30/startscreen/spec.md 9.3 with 12.3.2): the goal mapping on its real
 * prompt and catalogue (server/src/goalMap.ts) through the real callModel, N samples a text, scored against labels written
 * blind by another agent (ITEMS and LABELS files: {id, group, text, inPlay} and {id: {measure: [...], pursuits: [...],
 * nolever, partial}}). Scores: measure right; no-lever goals with their words in unmatched and no stretched lever;
 * template precision (picked templates inside the label's acceptable set); valid after code's check; the same measure in
 * most samples. Also the takes (9.4): one village goal x the 24 workers' personas, each take mapped: distinct measures for a
 * broad goal, the share keeping the goal's measure for a narrow one.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/goalmapbench.mts ITEMS LABELS OUT_DIR [--samples 4] [--no-takes]
 *   PEEK=1 prints each raw answer.
 */
import fs from 'node:fs';
import path from 'node:path';

const [itemsFile, labelsFile, outDir] = process.argv.slice(2);
const N = Number(process.argv[process.argv.indexOf('--samples') + 1]) || (process.argv.includes('--samples') ? 4 : 4);
const PEEK = process.env.PEEK === '1';
const { callModel, parseSpec, label } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');
const { CHOOSE } = await import('../../server/src/choose');
const M = await import('../../server/src/goalMap');
const { personaOf } = await import('../../server/src/temperament');
const { workerName } = await import('../../server/src/agentNames');
import type { Goal } from '../../server/src/goals';

const spec = parseSpec(CHOOSE.model)!;
const ALL: Goal[] = ['wealth', 'invention', 'mastery', 'standing', 'home', 'beauty'];
const IN_PLAY: Record<string, Goal[]> = { all: ALL, no_own: ALL.filter((g) => g !== 'wealth'), no_innovate: ALL.filter((g) => g !== 'invention') };
const items = JSON.parse(fs.readFileSync(itemsFile, 'utf8')) as Array<{ id: number; group: string; text: string; inPlay: string }>;
const labels = JSON.parse(fs.readFileSync(labelsFile, 'utf8')) as Record<string, { measure: string[]; pursuits: string[]; nolever: boolean; partial: boolean }>;
fs.mkdirSync(outDir, { recursive: true });

async function mapOnce(text: string, inPlay: Goal[], agent = 'bench') {
  const pr = M.mapPrompt(text, inPlay);
  const r = await callModel({ spec, system: pr.system, user: pr.user, tools: pr.tools, level: REASONING.goal_map, agent, kind: 'goal_map', priority: 'human' });
  const c = r.reply.calls.find((x) => x.name === 'map_goal') ?? r.reply.calls[0];
  if (PEEK) console.log(`  PEEK "${text}": ${JSON.stringify(c?.input ?? r.reply.text.slice(0, 200))}`);
  return M.checkMapping(text, c?.input, inPlay, label(spec));
}

async function pool<T>(jobs: Array<() => Promise<T>>, n = 3): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < jobs.length) {
      const k = i++;
      out[k] = await jobs[k]();
    }
  }));
  return out;
}

// --- the mapping
type Row = { id: number; group: string; text: string; inPlay: string; sample: number; measure: string | null; pursuits: string[]; unmatched: string[]; valid: boolean; warnings: string[]; error?: string };
const jobs = items.flatMap((it) => Array.from({ length: N }, (_, s) => async (): Promise<Row> => {
  try {
    const m = await mapOnce(it.text, IN_PLAY[it.inPlay] ?? ALL);
    return { ...it, sample: s, measure: m.spec.measure, pursuits: m.spec.pursuits, unmatched: m.spec.unmatched, valid: m.valid, warnings: m.warnings };
  } catch (e) {
    return { ...it, sample: s, measure: null, pursuits: [], unmatched: [], valid: false, warnings: [], error: (e as Error).message.slice(0, 120) };
  }
}));
const t0 = Date.now();
const rows = await pool(jobs);
fs.writeFileSync(path.join(outDir, 'answers.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}% (${a}/${b})` : '-');
const measureOk = (r: Row) => (labels[r.id].measure ?? []).includes(r.measure ?? 'none');
const stretched = (r: Row) => r.pursuits.filter((p) => !(labels[r.id].pursuits ?? []).includes(p));
const withMeasure = rows.filter((r) => labels[r.id] && !labels[r.id].nolever && !(labels[r.id].measure.length === 1 && labels[r.id].measure[0] === 'none'));
const noLever = rows.filter((r) => labels[r.id]?.nolever);
const noLeverOk = noLever.filter((r) => r.unmatched.length > 0 && (r.measure === null || measureOk(r)) && !stretched(r).length);
const picked = rows.flatMap((r) => r.pursuits.map((p) => ({ r, p })));
const precise = picked.filter(({ r, p }) => (labels[r.id]?.pursuits ?? []).includes(p));
const byItem = items.map((it) => {
  const rs = rows.filter((r) => r.id === it.id);
  const counts: Record<string, number> = {};
  for (const r of rs) counts[r.measure ?? 'none'] = (counts[r.measure ?? 'none'] ?? 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return { ...it, label: labels[it.id], counts, stable: top[1] > rs.length / 2, right: rs.filter(measureOk).length, stretches: [...new Set(rs.flatMap(stretched))], unmatched: rs.filter((r) => r.unmatched.length).length, n: rs.length };
});
const lines = [
  `goalmapbench: ${items.length} texts x ${N} samples = ${rows.length} calls, ${label(spec)}, reasoning ${REASONING.goal_map}, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  `measure right (texts with a measure): ${pct(withMeasure.filter(measureOk).length, withMeasure.length)}   [prediction >= 85%]`,
  `no-lever goals: words in unmatched, no stretched lever: ${pct(noLeverOk.length, noLever.length)}   [>= 90%]`,
  `template precision (picked inside the acceptable set): ${pct(precise.length, picked.length)}`,
  `valid after code's check: ${pct(rows.filter((r) => r.valid && !r.error).length, rows.length)}   [>= 98%]`,
  `same measure in most samples: ${pct(byItem.filter((b) => b.stable).length, byItem.length)}   [>= 90%]`,
  `errors: ${rows.filter((r) => r.error).length}`,
  '',
  'id group    in-play     measures (label)                         right  unmatched  stretched templates   text',
  ...byItem.map((b) => `${String(b.id).padStart(2)} ${b.group.padEnd(8)} ${b.inPlay.padEnd(11)} ${Object.entries(b.counts).map(([k, v]) => `${k}:${v}`).join(' ').padEnd(22)} (${(b.label?.measure ?? []).join('|')})`.padEnd(70) + ` ${b.right}/${b.n}   ${b.unmatched}/${b.n}      ${b.stretches.join(',').padEnd(20)}  ${b.text}`),
];

// --- the takes (9.4)
if (!process.argv.includes('--no-takes')) {
  const workers = Array.from({ length: 24 }, (_, i) => workerName(i + 1));
  for (const [goal, kind] of [['make the village great', 'broad'], ['get rich', 'narrow']] as const) {
    const takes = await pool(workers.map((w) => async () => {
      const pr = M.takePrompt(goal, `You are ${w}, ${personaOf(w).replace(/^You are\s*/i, '').replace(/\.$/, '')}.`);
      try {
        const r = await callModel({ spec, system: pr.system, user: pr.user, tools: pr.tools, level: REASONING.goal_take, agent: w, kind: 'goal_take', priority: 'human' });
        const c = r.reply.calls.find((x) => x.name === 'take') ?? r.reply.calls[0];
        return M.checkTake(c?.input, r.reply.text);
      } catch {
        return '';
      }
    }));
    const maps = await pool(takes.map((t, i) => async () => (t ? (await mapOnce(t, ALL, workers[i])).spec.measure : null)));
    const counts: Record<string, number> = {};
    for (const m of maps) counts[m ?? 'none'] = (counts[m ?? 'none'] ?? 0) + 1;
    const distinctTexts = new Set(takes.filter(Boolean).map((t) => t.toLowerCase())).size;
    lines.push('', `takes for "${goal}" (${kind}): ${takes.filter(Boolean).length}/24 drafted, ${distinctTexts} distinct texts; their measures ${JSON.stringify(counts)}; ` +
      (kind === 'broad' ? `distinct measures ${Object.keys(counts).filter((k) => k !== 'none').length} [prediction >= 3]` : `kept wealth ${pct(counts.wealth ?? 0, 24)} [>= 80%]`));
    for (let i = 0; i < 24; i += 4) lines.push(`  ${workers.slice(i, i + 4).map((w, j) => `${w}: ${takes[i + j]} [${maps[i + j] ?? 'none'}]`).join('\n  ')}`);
    fs.writeFileSync(path.join(outDir, `takes-${kind}.json`), JSON.stringify(workers.map((w, i) => ({ w, take: takes[i], measure: maps[i] })), null, 1));
  }
}
fs.writeFileSync(path.join(outDir, 'summary.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
