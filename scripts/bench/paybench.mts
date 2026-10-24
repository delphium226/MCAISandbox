/**
 * paybench (#111, spec runs/2026-10-23/payments/spec.md 13.4): the chooser on Long4's real model decisions, through
 * choose() and the real callModel, with payments' prompt added.
 *   - uptake: every decision whose menu carried a request's tag ([Jonah asked you] on its option), as recorded (unpriced)
 *     and priced (the tag and the inbox line as MC_PAY shows a 2-emerald request, the pay paragraph added): is the asked
 *     option chosen more when it pays?
 *   - prices: decisions that offered acts, with the pay paragraph and a price guide: how often a request comes back, with
 *     what act_price, against the guide; wealth-preset members (persona "life goal is wealth") apart.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/paybench.mts [CHOICES_JSONL]
 *   (default runs/2026-10-23/long-run-w4-4/long/Long4.choices.jsonl)
 * Env: MODEL (default ollama:gpt-oss:120b-cloud), N (samples a case, default 5), PRICE (the priced arm's, default 2),
 *   PRICES (decisions sampled for prices, default 40), CONC (default 3), DRY=1 (no network: the first option, no act).
 * Writes runs/2026-10-24/g2-talk-pay/paybench-<timestamp>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChoiceMenu, ChoiceOption } from '../../server/src/world';
import type { CallRequest, Reply } from '../../server/src/modelCall';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
Object.assign(process.env, { MCAI_SOCIAL: process.env.MCAI_SOCIAL ?? 'on', MC_ACTS: 'on', MC_OWN: 'on', MC_PAY: 'on' });
const { choose, trimMenu } = await import('../../server/src/choose');
const { parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');
const acts = await import('../../server/src/acts');
const { guideText } = await import('../../server/src/pay');

const FILE = path.resolve(ROOT, process.argv[2] ?? 'runs/2026-10-23/long-run-w4-4/long/Long4.choices.jsonl');
const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL)!;
const N = Number(process.env.N) || 5;
const PRICE = Number(process.env.PRICE) || 2;
const PRICES = Number(process.env.PRICES) || 40;
const CONC = Math.max(1, Number(process.env.CONC) || 3);
const DRY = !!process.env.DRY;

// (payments on for the schema and the act parse: hooks that are never asked for money here)
acts.setPayHooks({ request: () => undefined, pay: () => ({ ok: false, text: '' }), taken: () => {}, ended: () => 'kept', closed: () => {}, help: () => '', acceptable: () => false });

const PAY_HELP = (emeralds: number, guide: string) => 'A request may carry act_price (whole emeralds from your own chest, 1 to 8): code holds it and pays it when the goods reach your own chest, refunded if not; '
  + 'on a project, act_price is per step and act_steps (1-4) the steps, paid to each helper. '
  + 'pay: give a member emeralds or goods from your own chest now (act_to, act_item, act_amount; say why). '
  + `${guide}You hold ${emeralds} emerald${emeralds === 1 ? '' : 's'}.`;
// (the guide as MC_PAY would show it on a staged village's puts: a trip of logs 12 at 30 points over an emerald's ~30)
const GUIDE = guideText([{ words: 'a trip of logs', n: 2 }, { words: 'a batch of torch', n: 1 }, { words: 'a batch of charcoal', n: 1 }]);

const opt = (o: any, i: number): ChoiceOption => ({
  id: String(o.id), kind: o.kind, key: String(o.key ?? o.id), holds: o.holds ?? [], excludes: o.excludes ?? [], name: String(o.name), facts: String(o.facts ?? ''),
  effect: String(o.effect ?? ''), rank: Number.isFinite(o.rank) ? o.rank : i, ...(o.lp !== undefined ? { lp: o.lp } : {}), ...(o.social ? { social: o.social } : {}),
});

const recs: any[] = fs.readFileSync(FILE, 'utf-8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === 'choice' && r.source === 'model' && Array.isArray(r.options) && r.options.length >= 2 && r.ctx);
const menuOf = (r: any, options: ChoiceOption[], ctx: any): ChoiceMenu => ({ agent: r.agent, village: r.village, t: Number(r.t) || 0, options, guarded: [], reasons: {}, ctx });

// uptake cases: the tagged option kept through the trim
interface Up { name: string; target: string; wealth: boolean; unpriced: ChoiceMenu; priced: ChoiceMenu }
const ups: Up[] = [];
for (const r of recs) {
  const tagged = r.options.find((o: any) => /asked (you|anyone)\]/.test(o.social ?? ''));
  if (!tagged) continue;
  const options = trimMenu(r.options.map(opt));
  if (!options.some((o) => o.id === tagged.id)) continue;
  const from = /^\[(\w+) asked/.exec(tagged.social)![1];
  const priceTag = `[${from} pays ${PRICE} emeralds]`;
  const pricedOpts = options.map((o) => (o.id === tagged.id ? { ...o, social: priceTag } : o));
  const ctx = r.ctx;
  const inbox = (ctx.inbox ?? []).map((l: string) => l.replace(new RegExp(`^${from} asks (you|anyone): (.+?) \\((r\\d+), (.+)\\)$`), (_m, who, words, id, ago) => `${from} pays ${PRICE} emeralds ${who} to ${words}, into ${from}'s own chest (${id}, ${ago})`));
  ups.push({
    name: `${r.village}/${r.agent}/${r.id}`, target: tagged.id, wealth: /life goal is wealth/.test(ctx.persona ?? ''),
    unpriced: menuOf(r, options, ctx),
    priced: menuOf(r, pricedOpts, { ...ctx, inbox, ...(ctx.acts ? { acts: `${ctx.acts} ${PAY_HELP(4, GUIDE)}` } : {}) }),
  });
}

// price cases: decisions that offered acts, spread over the run (every k-th)
const withActs = recs.filter((r) => r.ctx.acts);
const step = Math.max(1, Math.floor(withActs.length / PRICES));
const prices = withActs.filter((_, i) => i % step === 0).slice(0, PRICES).map((r) => ({
  name: `${r.village}/${r.agent}/${r.id}`, wealth: /life goal is wealth/.test(r.ctx.persona ?? ''),
  menu: menuOf(r, trimMenu(r.options.map(opt)), { ...r.ctx, acts: `${r.ctx.acts} ${PAY_HELP(4, GUIDE)}` }),
}));
if (process.env.SHOW) console.log(ups[0].priced.ctx.inbox, ups[0].priced.options.find((o) => o.id === ups[0].target));
console.log(`${path.basename(FILE)}: ${recs.length} model decisions; ${ups.length} uptake cases (${ups.filter((u) => u.wealth).length} wealth), ${prices.length} price cases; N ${N}, price ${PRICE}, ${DRY ? 'DRY' : MODEL}`);

const dry = async (req: CallRequest): Promise<{ reply: Reply; ms: number; waitMs: number }> => {
  const shown: string[] = (req.tools[0]?.input_schema as any)?.properties?.choice?.enum ?? [];
  return { reply: { calls: [{ name: 'choose', input: { reason: 'dry', choice: shown[0] } }], text: '', promptTokens: 1, outputTokens: 1 }, ms: 1, waitMs: 0 };
};
const one = (menu: ChoiceMenu, seed: string) => choose({ agent: 'paybench', spec, level: REASONING.choose, menu, seed, ...(DRY ? { call: dry } : {}) });

async function pool<T>(jobs: Array<() => Promise<T>>): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  }));
  return out;
}

type Row = { case: string; arm: string; wealth: boolean; i: number; id: string | null; hit?: boolean; act?: string; price?: number; item?: string; to?: string; reason: string; tokens: number };
const jobs: Array<() => Promise<Row>> = [];
for (const u of ups) for (const arm of ['unpriced', 'priced'] as const) for (let i = 0; i < N; i++) jobs.push(async () => {
  // (the same seed in both arms: the same shuffle, so only the price differs)
  const r = await one(u[arm], `${u.name}|${i}`);
  return { case: u.name, arm, wealth: u.wealth, i, id: r.id, hit: r.id === u.target, act: r.acts?.act, price: r.acts?.act_price ? Number(r.acts.act_price) : undefined, reason: r.reason, tokens: r.promptTokens + r.outputTokens };
});
for (const c of prices) for (let i = 0; i < Math.max(1, Math.round(N / 2)); i++) jobs.push(async () => {
  const r = await one(c.menu, `${c.name}|price|${i}`);
  const a = r.acts ?? {};
  return { case: c.name, arm: 'price', wealth: c.wealth, i, id: r.id, act: a.act, price: a.act_price !== undefined ? Number(a.act_price) : undefined, item: a.act_item ?? a.act_project, to: a.act_to, reason: r.reason, tokens: r.promptTokens + r.outputTokens };
});
const t0 = Date.now();
const rows = await pool(jobs);

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
console.log('\nuptake of the asked option (valid replies):');
for (const w of [null, true, false]) {
  const line = (['unpriced', 'priced'] as const).map((arm) => {
    const rs = rows.filter((r) => r.arm === arm && r.id && (w === null || r.wealth === w));
    return `${arm} ${pct(rs.filter((r) => r.hit).length, rs.length)} (${rs.filter((r) => r.hit).length}/${rs.length})`;
  }).join(', ');
  console.log(`  ${w === null ? 'all' : w ? 'wealth' : 'others'}: ${line}`);
}
// (by case: does the priced arm win more often than it loses?)
let up = 0, down = 0;
for (const u of ups) {
  const h = (arm: string) => rows.filter((r) => r.case === u.name && r.arm === arm && r.hit).length;
  if (h('priced') > h('unpriced')) up++;
  else if (h('priced') < h('unpriced')) down++;
}
console.log(`  by case: priced higher in ${up}, lower in ${down}, equal in ${ups.length - up - down} of ${ups.length}`);
const pr = rows.filter((r) => r.arm === 'price');
const reqs = pr.filter((r) => /^request/.test(r.act ?? ''));
const priced = reqs.filter((r) => r.price !== undefined);
console.log(`\nprices: ${pr.length} replies, ${reqs.length} requests (${pct(reqs.length, pr.length)}), ${priced.length} priced (${pct(priced.length, reqs.length)} of requests); pays ${pr.filter((r) => r.act === 'pay').length}`);
const hist: Record<string, number> = {};
for (const r of priced) hist[r.price!] = (hist[r.price!] ?? 0) + 1;
console.log(`  prices set: ${Object.entries(hist).map(([p, n]) => `${p}: ${n}`).join(', ') || 'none'}; items: ${[...new Set(priced.map((r) => `${r.item}@${r.price}`))].slice(0, 20).join(', ')}`);
for (const w of [true, false]) {
  const rs = pr.filter((r) => r.wealth === w), q = rs.filter((r) => /^request/.test(r.act ?? '')), p = q.filter((r) => r.price !== undefined);
  console.log(`  ${w ? 'wealth' : 'others'}: ${rs.length} replies, ${q.length} requests, ${p.length} priced, mean price ${p.length ? (p.reduce((t, r) => t + r.price!, 0) / p.length).toFixed(1) : '-'}`);
}
console.log(`  (the guide shown: ${GUIDE.trim()})`);
const tokens = rows.reduce((t, r) => t + r.tokens, 0);
console.log(`\n${rows.length} calls, ${(tokens / 1000).toFixed(0)}k tokens, ${((Date.now() - t0) / 60000).toFixed(1)} min, invalid ${rows.filter((r) => !r.id).length}`);
const out = path.join(ROOT, 'runs/2026-10-24/g2-talk-pay', `paybench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ file: FILE, model: MODEL, N, price: PRICE, rows }, null, 1));
console.log(`wrote ${path.relative(ROOT, out)}`);
process.exit(0);
