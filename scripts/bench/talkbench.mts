/**
 * talkbench (#107): the chooser on Long4's real model decisions, through choose() and the real callModel, with MC_NEWS and
 * MC_QUESTIONS on (the tool carries `news`, `question` and `question_to`; the acts paragraph offers them):
 *   - told: decisions with a food option on the menu, as recorded and with a told shortage in the news section ("Rosa
 *     says: ...storage has no food left..."): does the told shortage move the choice toward food?
 *   - use: on every reply, how often the model writes news or a question, and what about (samples printed).
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/talkbench.mts [CHOICES_JSONL]
 *   (default runs/2026-10-23/long-run-w4-4/long/Long4.choices.jsonl)
 * Env: MODEL (default ollama:gpt-oss:120b-cloud), N (samples a case, default 5), CASES (default 40), CONC (default 3),
 *   DRY=1 (no network).
 * Writes runs/2026-10-24/g2-talk-pay/talkbench-<timestamp>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChoiceMenu, ChoiceOption } from '../../server/src/world';
import type { CallRequest, Reply } from '../../server/src/modelCall';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
Object.assign(process.env, { MCAI_SOCIAL: process.env.MCAI_SOCIAL ?? 'on', MC_ACTS: 'on', MC_NEWS: 'on', MC_QUESTIONS: 'on' });
const { choose, trimMenu } = await import('../../server/src/choose');
const { parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');
const acts = await import('../../server/src/acts');

const FILE = path.resolve(ROOT, process.argv[2] ?? 'runs/2026-10-23/long-run-w4-4/long/Long4.choices.jsonl');
const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL)!;
const N = Number(process.env.N) || 5;
const CASES = Number(process.env.CASES) || 40;
const CONC = Math.max(1, Number(process.env.CONC) || 3);
const DRY = !!process.env.DRY;
if (!acts.TALK.news || !acts.TALK.questions) throw new Error('MC_NEWS and MC_QUESTIONS did not take (MC_ACTS needs MCAI_SOCIAL on)');

const FOOD = (o: ChoiceOption) => /^make:(cooked_|bread|baked_potato|pumpkin_pie|mushroom_stew)|^(harvest|start):|^own:farm/.test(o.id) || /\b(fish|bread|cod|salmon|harvest|wheat farm)\b/i.test(o.name);
const opt = (o: any, i: number): ChoiceOption => ({
  id: String(o.id), kind: o.kind, key: String(o.key ?? o.id), holds: o.holds ?? [], excludes: o.excludes ?? [], name: String(o.name), facts: String(o.facts ?? ''),
  effect: String(o.effect ?? ''), rank: Number.isFinite(o.rank) ? o.rank : i, ...(o.lp !== undefined ? { lp: o.lp } : {}), ...(o.social ? { social: o.social } : {}),
});
// (the acts paragraph as MC_NEWS and MC_QUESTIONS add to it)
// (VARIANT=2: the wording tried after the first bench, a concrete prompt to tell and to ask)
const TALK_HELP = process.env.VARIANT === '2' ? acts.talkHelpText(4, 3) : 'You may pass on news (`news`): one short line about something you saw or heard that those near you may not know (a shortage, a failure, a place, what a member did); it reaches them whether or not your choice is taken. News you heard may be passed on once: say who said it. Left today: 4. '
  + 'You may ask a question (`question`, and `question_to`: a member, or anyone): the member answers from what they know, and the answer reaches you in a few minutes. Left today: 3.';

const recs: any[] = fs.readFileSync(FILE, 'utf-8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === 'choice' && r.source === 'model' && Array.isArray(r.options) && r.ctx?.acts);
const pool0 = recs.map((r) => ({ r, options: trimMenu(r.options.map(opt)) })).filter((x) => x.options.length >= 2 && x.options.some(FOOD) && !x.options.every(FOOD));
const step = Math.max(1, Math.floor(pool0.length / CASES));
const cases = pool0.filter((_, i) => i % step === 0).slice(0, CASES).map(({ r, options }) => {
  const teller = ['Rosa', 'Sam', 'Nora', 'Tess'].find((n) => n !== r.agent)!;
  const ctx = { ...r.ctx, acts: `${r.ctx.acts} ${TALK_HELP}` };
  const menu = (c: any): ChoiceMenu => ({ agent: r.agent, village: r.village, t: Number(r.t) || 0, options, guarded: [], reasons: {}, ctx: c });
  return {
    name: `${r.village}/${r.agent}/${r.id}`, food: options.filter(FOOD).map((o) => o.id), hungry: /hungry/.test(JSON.stringify(r.ctx.needs ?? '')),
    plain: menu(ctx),
    told: menu({ ...ctx, news: [`${teller} says: "The storage has no food left and most of us are hungry; someone should cook or fish." (just now)`] }),
  };
});
console.log(`${path.basename(FILE)}: ${recs.length} model decisions with acts; ${pool0.length} with a food option among others; ${cases.length} cases, N ${N}, ${DRY ? 'DRY' : MODEL}`);

const dry = async (req: CallRequest): Promise<{ reply: Reply; ms: number; waitMs: number }> => {
  const shown: string[] = (req.tools[0]?.input_schema as any)?.properties?.choice?.enum ?? [];
  return { reply: { calls: [{ name: 'choose', input: { reason: 'dry', choice: shown[0] } }], text: '', promptTokens: 1, outputTokens: 1 }, ms: 1, waitMs: 0 };
};
type Row = { case: string; arm: string; i: number; id: string | null; food: boolean; hungry: boolean; news?: string; question?: string; question_to?: string; reason: string; tokens: number };
const jobs: Array<() => Promise<Row>> = [];
for (const c of cases) for (const arm of ['plain', 'told'] as const) for (let i = 0; i < N; i++) jobs.push(async () => {
  const r = await choose({ agent: 'talkbench', spec, level: REASONING.choose, menu: c[arm], seed: `${c.name}|${i}`, ...(DRY ? { call: dry } : {}) });
  return { case: c.name, arm, i, id: r.id, food: !!r.id && c.food.includes(r.id), hungry: c.hungry, news: r.acts?.news, question: r.acts?.question, question_to: r.acts?.question_to, reason: r.reason, tokens: r.promptTokens + r.outputTokens };
});
const t0 = Date.now();
const rows: Row[] = new Array(jobs.length);
let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (next < jobs.length) {
    const i = next++;
    rows[i] = await jobs[i]();
  }
}));

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
console.log('\nfood chosen (valid replies):');
for (const h of [null, true, false]) {
  const line = (['plain', 'told'] as const).map((arm) => {
    const rs = rows.filter((r) => r.arm === arm && r.id && (h === null || r.hungry === h));
    return `${arm} ${pct(rs.filter((r) => r.food).length, rs.length)} (${rs.filter((r) => r.food).length}/${rs.length})`;
  }).join(', ');
  console.log(`  ${h === null ? 'all' : h ? 'hunger in the needs line' : 'no hunger line'}: ${line}`);
}
let up = 0, down = 0;
for (const c of cases) {
  const f = (arm: string) => rows.filter((r) => r.case === c.name && r.arm === arm && r.food).length;
  if (f('told') > f('plain')) up++;
  else if (f('told') < f('plain')) down++;
}
console.log(`  by case: told higher in ${up}, lower in ${down}, equal in ${cases.length - up - down} of ${cases.length}`);
for (const arm of ['plain', 'told']) {
  const rs = rows.filter((r) => r.arm === arm);
  const nw = rs.filter((r) => r.news), q = rs.filter((r) => r.question);
  console.log(`\n${arm}: news in ${pct(nw.length, rs.length)} (${nw.length}/${rs.length}), questions in ${pct(q.length, rs.length)} (${q.length}); to anyone ${q.filter((r) => /anyone/i.test(r.question_to ?? '')).length}`);
  for (const r of nw.slice(0, 6)) console.log(`  news: ${r.news}`);
  for (const r of q.slice(0, 5)) console.log(`  question to ${r.question_to}: ${r.question}`);
}
const tokens = rows.reduce((t, r) => t + r.tokens, 0);
console.log(`\n${rows.length} calls, ${(tokens / 1000).toFixed(0)}k tokens, ${((Date.now() - t0) / 60000).toFixed(1)} min, invalid ${rows.filter((r) => !r.id).length}`);
const out = path.join(ROOT, 'runs/2026-10-24/g2-talk-pay', `talkbench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ file: FILE, model: MODEL, N, rows }, null, 1));
console.log(`wrote ${path.relative(ROOT, out)}`);
process.exit(0);
