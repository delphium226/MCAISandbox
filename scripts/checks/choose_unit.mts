/**
 * The chooser (A.2, server/src/choose.ts) checked offline (no server, no model: the call is a fake injected into
 * choose()). Checks: the seeded shuffle (same seed, same order; a permutation; no position favoured over many seeds), the
 * model-mode trim (2 a kind, then 8 by lp and rank), the fixed pick, the prompt and the choose tool (names only, the enum
 * in shown order, reason before choice), the reply's parse (exact, folded, a unique prefix of 12+, near misses refused,
 * text replies), choose() with each outcome of the call (a choice, withdrawn, timeout, budget, error, invalid; a blocked
 * budget refused before any call), the queue (the parallel cap, FIFO, the queue wait passed to the job, expiry giving
 * onExpire, cancel, a throwing job and a throwing onExpire caught, no unhandled rejection), and ChoiceStats (learning
 * progress, the per-id ban and the kind ban rule, explore exempt, the agent cooldown, the model-call rate, the facts).
 * Exits non-zero on any failure.
 * Usage: node_modules/.bin/tsx scripts/checks/choose_unit.mts
 */
import {
  CHOOSE, ChoiceStats, ChooserQueue, MENU_MAX, PER_KIND_MAX, buildPrompt, choose, choreProductive, fixedPick, parseChoice, shuffled, trimMenu,
} from '../../server/src/choose';
import { CallFallback, CallWithdrawn, type CallRequest, type Reply } from '../../server/src/modelCall';
import { BudgetExceeded, usage } from '../../server/src/modelUsage';
import type { ChoiceKind, ChoiceMenu, ChoiceOption } from '../../server/src/world';

let failures = 0;
let checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    process.stdout.write(`FAIL ${what}\n`);
  }
}
const eq = (a: unknown, b: unknown, what: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

// The module's own log lines are counted, not printed
const logs: string[] = [];
const origLog = console.log;
console.log = (...a: unknown[]) => void logs.push(a.join(' '));
const say = (s: string) => origLog(s);
let unhandled = 0;
process.on('unhandledRejection', (e) => {
  unhandled++;
  say(`FAIL an unhandled rejection: ${String(e)}`);
});

const opt = (id: string, kind: ChoiceKind, name: string, rank: number, lp?: number): ChoiceOption =>
  ({ id, kind, key: id, holds: [], excludes: [], name, facts: `facts ${rank}`, effect: `effect ${rank}`, rank, ...(lp === undefined ? {} : { lp }) });

const OPTIONS: ChoiceOption[] = [
  opt('farm:0', 'farm', 'Harvest the wheat field', 10),
  opt('start:pumpkin', 'start', 'Start a pumpkin farm', 201),
  opt('annex', 'annex', 'Prepare the annex for animal pens', 300),
  opt('penwork:0:eggs', 'penwork', 'Collect eggs in the chicken pen', 500),
  opt('penwork:1:milk', 'penwork', 'Milk the cows', 511),
  opt('cake', 'cake', 'Bake a cake', 600),
  opt('explore:6', 'explore', 'Explore to the north', 800),
  opt('explore:7', 'explore', 'Explore to the north-east', 801),
  opt('explore:5', 'explore', 'Explore to the north-west', 802),
];
const menu = (options: ChoiceOption[], persona = ''): ChoiceMenu => ({
  agent: 'Worker1', village: 'V', t: 0, options, guarded: [], reasons: {},
  ctx: { persona, village: 'V, complete 12 min ago. Storage: 40 wheat.', others: 'exploring 1 (Worker4), idle 3.', outcomes: ['explore to the north: done, 4.1 min'] },
});

// --- shuffled
{
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  eq(shuffled(xs, 'd1|Worker1'), shuffled(xs, 'd1|Worker1'), 'the same seed gives the same order');
  eq([...shuffled(xs, 'abc')].sort(), xs, 'a shuffle is a permutation');
  eq(xs, [1, 2, 3, 4, 5, 6, 7, 8], 'the input is not changed');
  const orders = new Set(['a', 'b', 'c', 'd', 'e'].map((s) => shuffled(xs, s).join()));
  ok(orders.size >= 4, `different seeds give different orders (${orders.size} of 5)`);
  // No position favoured: each of 4 items first about a quarter of the time over 8,000 seeds
  const first = [0, 0, 0, 0];
  const N = 8000;
  for (let i = 0; i < N; i++) first[shuffled([0, 1, 2, 3], `choice-${i}|Worker${i % 25}`)[0]]++;
  ok(first.every((n) => Math.abs(n / N - 0.25) < 0.02), `first positions near uniform: ${first.join(', ')}`);
  const last = [0, 0, 0];
  for (let i = 0; i < N; i++) last[shuffled([0, 1, 2], `d${i}`)[2]]++;
  ok(last.every((n) => Math.abs(n / N - 1 / 3) < 0.025), `last positions near uniform: ${last.join(', ')}`);
}

// --- trimMenu and fixedPick
{
  eq(PER_KIND_MAX, 2, 'PER_KIND_MAX');
  eq(MENU_MAX, 8, 'MENU_MAX');
  const t = trimMenu([...OPTIONS].reverse());
  eq(t.map((o) => o.id), ['farm:0', 'start:pumpkin', 'annex', 'penwork:0:eggs', 'penwork:1:milk', 'cake', 'explore:6', 'explore:7'], 'two a kind, by rank, in rank order');
  // Over 8 after the per-kind cut: the highest lp kept, ties by rank
  const many = [
    opt('farm:0', 'farm', 'a', 10, 1.0), opt('farm:1', 'farm', 'b', 11, 1.0),
    opt('slot:0:0', 'slot', 'c', 100, 0.5), opt('slot:0:1', 'slot', 'd', 101, 0.5),
    opt('start:cane', 'start', 'e', 200, 1.5), opt('annex', 'annex', 'f', 300, 1.2),
    opt('pen:chicken', 'pen', 'g', 400, 1.0), opt('cake', 'cake', 'h', 600, 0.7),
    opt('iron:dig', 'iron', 'i', 700, 1.0), opt('explore:0', 'explore', 'j', 800, 0.5),
  ];
  const t2 = trimMenu(many);
  eq(t2.map((o) => o.id), ['farm:0', 'farm:1', 'slot:0:0', 'start:cane', 'annex', 'pen:chicken', 'cake', 'iron:dig'], 'over 8: by lp desc then rank, returned in rank order');
  ok(trimMenu([]).length === 0, 'an empty menu stays empty');
  eq(fixedPick(menu([...OPTIONS].reverse()))?.id, 'farm:0', 'the fixed pick is the lowest rank');
  eq(fixedPick(menu([])), undefined, 'no fixed pick from an empty menu');
}

// --- buildPrompt
{
  const shown = shuffled(OPTIONS.slice(0, 5), 's|Worker1');
  const p = buildPrompt(menu(OPTIONS.slice(0, 5)), shown);
  ok(p.system.includes('call `choose`'), 'the system prompt names the tool');
  ok(!p.user.includes('farm:0') && !p.user.includes('penwork:'), 'no option id reaches the prompt (D7)');
  ok(p.user.startsWith('Village: V, complete'), 'no persona line when the persona is empty; the village line labelled');
  ok(p.user.includes('Others now: exploring 1'), 'the others line');
  ok(p.user.includes('Your last chores: explore to the north: done'), 'the outcomes line');
  const optionLines = p.user.split('\n').filter((l) => l.startsWith('- '));
  eq(optionLines.map((l) => l.slice(2, l.indexOf(':'))), shown.map((o) => o.name), 'the options in the shown order, by name');
  ok(optionLines[0].includes(`facts ${shown[0].rank}`) && optionLines[0].includes(`effect ${shown[0].rank}`), 'an option line carries its facts and effect');
  ok(p.user.endsWith('Call choose with your reason and the exact name of one option.'), 'the closing line');
  const schema = p.tools[0].input_schema as { properties: Record<string, { enum?: string[]; maxLength?: number }>; required: string[] };
  eq(p.tools.map((t) => t.name), ['choose'], 'one tool, choose');
  eq(Object.keys(schema.properties), ['reason', 'choice'], 'reason comes before choice');
  eq(schema.properties.choice.enum, shown.map((o) => o.name), 'the enum is the shown names in the shown order');
  eq(schema.properties.reason.maxLength, 200, 'the reason is capped at 200');
  eq(schema.required, ['reason', 'choice'], 'both required');
  const p2 = buildPrompt(menu(OPTIONS.slice(0, 2), 'You are Worker1, a patient farmer.'), OPTIONS.slice(0, 2));
  ok(p2.user.startsWith('You are Worker1, a patient farmer.\nVillage: '), 'the persona line first when set');
  const m3 = menu(OPTIONS.slice(0, 2));
  m3.ctx = { persona: '', village: 'Village: W, complete 2 min ago.', others: 'Others now: idle 2.', outcomes: [] };
  const p3 = buildPrompt(m3, OPTIONS.slice(0, 2));
  ok(p3.user.startsWith('Village: W, complete') && !p3.user.includes('Village: Village') && !p3.user.includes('Others now: Others now'), 'a label the world wrote is not doubled');
  ok(p3.user.includes('Your last chores: none yet'), 'no outcomes yet');
}

// --- parseChoice
{
  const shown = OPTIONS;
  const call = (input: Record<string, unknown>, name = 'choose'): Reply => ({ calls: [{ name, input }], text: '' });
  eq(parseChoice(call({ reason: 'the eggs are due', choice: 'Collect eggs in the chicken pen' }), shown), { id: 'penwork:0:eggs', reason: 'the eggs are due' }, 'an exact name');
  eq(parseChoice(call({ reason: 'x', choice: 'bake a CAKE!' }), shown), { id: 'cake', reason: 'x' }, 'case and punctuation folded');
  eq(parseChoice(call({ reason: 'x', choice: 'Explore to the north east' }), shown), { id: 'explore:7', reason: 'x' }, 'a space for a hyphen');
  eq(parseChoice(call({ reason: 'x', choice: 'Explore to the north' }), shown), { id: 'explore:6', reason: 'x' }, 'an exact name wins over the prefix of others');
  eq(parseChoice(call({ reason: 'x', choice: 'Collect eggs in the' }), shown), { id: 'penwork:0:eggs', reason: 'x' }, 'a unique prefix of 12+ characters');
  ok('invalid' in parseChoice(call({ reason: 'x', choice: 'Milk the co' }), shown), 'a prefix under 12 characters is refused');
  const ex = [opt('explore:7', 'explore', 'Explore to the north-east', 801), opt('explore:5', 'explore', 'Explore to the north-west', 802)];
  ok('invalid' in parseChoice(call({ reason: 'x', choice: 'Explore to the north' }), ex), 'a prefix of two names is refused');
  ok('invalid' in parseChoice(call({ reason: 'x', choice: 'Dig for diamonds' }), shown), 'an invented option is refused');
  ok('invalid' in parseChoice(call({ reason: 'x', choice: 'cake' }), shown), 'an id is not a name');
  ok('invalid' in parseChoice(call({ reason: 'x' }), shown), 'a call without a choice is refused');
  ok('invalid' in parseChoice({ calls: [], text: '' }, shown), 'an empty reply is refused');
  eq(parseChoice(call({ reason: 'x', choice: 'Bake a cake' }, 'choice'), shown), { id: 'cake', reason: 'x' }, 'a call misnamed but carrying a choice');
  eq(parseChoice(call({ arguments: JSON.stringify({ reason: 'x', choice: 'Bake a cake' }) }, 'choose'), shown), { id: 'cake', reason: 'x' }, 'arguments as a JSON string');
  eq(parseChoice(call({ reason: 'r'.repeat(300), choice: 'Bake a cake' }), shown), { id: 'cake', reason: 'r'.repeat(200) }, 'the reason cut to 200');
  eq(parseChoice(call({ choice: 'Bake a cake' }), shown), { id: 'cake', reason: '' }, 'a missing reason is empty');
  // Text replies (callModel turns {"name":..., "arguments":...} text into calls; these come through as text)
  eq(parseChoice({ calls: [], text: '{"reason": "cakes sell", "choice": "Bake a cake"}' }, shown), { id: 'cake', reason: 'cakes sell' }, 'a JSON object as text');
  eq(parseChoice({ calls: [], text: 'Sure:\n```json\n{"name": "choose", "arguments": {"reason": "r", "choice": "Milk the cows"}}\n```' }, shown), { id: 'penwork:1:milk', reason: 'r' }, 'a fenced call as text');
  eq(parseChoice({ calls: [], text: '  Bake a cake.\n' }, shown), { id: 'cake', reason: '' }, 'a bare name as text');
  ok('invalid' in parseChoice({ calls: [], text: 'I think the village needs more food, so harvesting seems wise, but the cake is also nice and the cows need milking soon.' }, shown), 'prose is refused');
}

// --- choose() with a fake call
const SPEC = { provider: 'ollama' as const, model: 'gpt-oss:120b-cloud' };
const reply = (r: Reply, ms = 1200, waitMs = 30) => async () => ({ reply: r, ms, waitMs });
{
  const seen: CallRequest[] = [];
  const m = menu(OPTIONS.slice(0, 4));
  const ac = new AbortController();
  const r = await choose({
    agent: 'Worker1', spec: SPEC, level: 'low', menu: m, seed: 'dec-1', signal: ac.signal,
    call: async (req) => {
      seen.push(req);
      return { reply: { calls: [{ name: 'choose', input: { reason: 'the field is ripe', choice: 'Harvest the wheat field' } }], text: '', promptTokens: 900, outputTokens: 70 }, ms: 2100, waitMs: 40 };
    },
  });
  eq({ id: r.id, why: r.why, reason: r.reason, latencyMs: r.latencyMs, waitMs: r.waitMs, promptTokens: r.promptTokens, outputTokens: r.outputTokens },
    { id: 'farm:0', why: undefined, reason: 'the field is ripe', latencyMs: 2100, waitMs: 40, promptTokens: 900, outputTokens: 70 }, 'a choice');
  eq(r.shown, shuffled(m.options, 'dec-1|Worker1').map((o) => o.id), 'shown in the order of the seed `${seed}|${agent}`');
  eq(seen.length, 1, 'one call');
  const q = seen[0];
  eq({ kind: q.kind, priority: q.priority, level: q.level, agent: q.agent, maxWaitMs: q.maxWaitMs, fallbackMs: q.fallbackMs, signal: q.signal === ac.signal },
    { kind: 'choose', priority: 'decision', level: 'low', agent: 'Worker1', maxWaitMs: CHOOSE.waitMs, fallbackMs: CHOOSE.fallbackMs, signal: true }, 'the call: kind, priority, level, waits and signal');
  eq(q.user, r.prompt, 'the prompt returned is the one sent');
  eq([CHOOSE.waitMs, CHOOSE.fallbackMs, CHOOSE.parallel, CHOOSE.queueMs, CHOOSE.minGapMs, CHOOSE.perHour], [15000, 20000, 2, 30000, 90000, 30], 'the defaults');
  eq(CHOOSE.mode, process.env.MC_CHOOSE ?? 'fixed', 'the mode');

  const fail = async (err: unknown) => (await choose({ agent: 'Worker1', spec: SPEC, level: 'low', menu: m, seed: 'd', call: async () => { throw err; } }));
  const w = await fail(new CallWithdrawn('ollama-cloud', 15000));
  eq([w.id, w.why, w.waitMs, w.shown], [null, 'withdrawn', 15000, []], 'withdrawn at the gate (never sent: nothing shown)');
  const f = await fail(new CallFallback(20000));
  eq([f.id, f.why, f.latencyMs, f.shown.length], [null, 'timeout', 20000, 4], 'cut off by the fallback timer (sent: shown)');
  const b = await fail(new BudgetExceeded(10, 5, Date.now() + 60000, 1));
  eq([b.id, b.why, b.shown], [null, 'budget', []], 'refused by the budget inside the call (nothing shown)');
  const e = await fail(new Error('Ollama 500: boom'));
  eq([e.id, e.why, e.reason], [null, 'error', ''], 'any other error');
  const e2 = await fail('a string thrown');
  eq([e2.id, e2.why], [null, 'error'], 'a non-Error thrown');
  const inv = await choose({ agent: 'Worker1', spec: SPEC, level: 'low', menu: m, seed: 'd', call: reply({ calls: [{ name: 'choose', input: { reason: 'x', choice: 'Fly to the moon' } }], text: '', promptTokens: 5, outputTokens: 6 }) as never });
  eq([inv.id, inv.why, inv.promptTokens], [null, 'invalid', 5], 'an invalid reply (tokens still counted)');
  const syncThrow = await choose({ agent: 'Worker1', spec: SPEC, level: 'low', menu: m, seed: 'd', call: (() => { throw new Error('sync'); }) as never });
  eq([syncThrow.id, syncThrow.why], [null, 'error'], 'a call that throws at once');
  const broken = await choose({ agent: 'Worker1', spec: SPEC, level: 'low', menu: null as unknown as ChoiceMenu, seed: 'd', call: reply({ calls: [], text: '' }) as never });
  eq([broken.id, broken.why], [null, 'error'], 'a broken request never throws');
  const empty = await choose({ agent: 'Worker1', spec: SPEC, level: 'low', menu: menu([]), seed: 'd', call: async () => { throw new Error('never called'); } });
  eq([empty.id, empty.why], [null, 'invalid'], 'an empty menu makes no call');
  const aborted = new AbortController();
  aborted.abort();
  let calledAborted = false;
  const ab = await choose({ agent: 'Worker1', spec: SPEC, level: 'low', menu: m, seed: 'd', signal: aborted.signal, call: async () => { calledAborted = true; throw new Error('x'); } });
  eq([ab.id, ab.why, calledAborted], [null, 'withdrawn', false], 'an aborted decision makes no call');

  // A blocked budget: refused at once, no call made
  usage.setBudget(1000);
  usage.record({ model: 'gpt-oss:120b-cloud', agent: 'Someone', kind: 'exec', promptTokens: 2000, outputTokens: 0, ms: 1 });
  let called = false;
  const t0 = Date.now();
  const bb = await choose({ agent: 'Worker1', spec: SPEC, level: 'low', menu: m, seed: 'd', call: async () => { called = true; return { reply: { calls: [], text: '' }, ms: 0, waitMs: 0 }; } });
  eq([bb.id, bb.why, called, bb.shown], [null, 'budget', false, []], 'a blocked budget gives the fixed pick at once, with no call and nothing shown');
  ok(Date.now() - t0 < 200, 'and nothing waits');
  // A local model is never refused by the budget
  let calledLocal = false;
  await choose({ agent: 'Worker1', spec: { provider: 'ollama', model: 'qwen3:30b-instruct' }, level: 'low', menu: m, seed: 'd', call: async () => { calledLocal = true; return { reply: { calls: [], text: '' }, ms: 0, waitMs: 0 }; } });
  ok(calledLocal, 'a local model is called with the cloud budget spent');
  usage.setBudget(null);
}

// --- ChooserQueue
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
{
  let clock = 1000;
  const q = new ChooserQueue({ parallel: 2, queueMs: 30000, now: () => clock });
  const started: Array<[string, number]> = [];
  const resolvers = new Map<string, () => void>();
  const job = (name: string) => (wait: number) => {
    started.push([name, wait]);
    return new Promise<void>((res) => resolvers.set(name, res));
  };
  const expired: string[] = [];
  for (const n of ['A', 'B', 'C', 'D']) q.submit(n, job(n), () => expired.push(n));
  eq(started.map((s) => s[0]), ['A', 'B'], 'two start at once (parallel 2)');
  eq(q.inFlight, 2, 'two in flight');
  eq([q.pending('A'), q.pending('C'), q.pending('Z')], ['running', 'queued', null], 'pending states');
  clock += 4000;
  resolvers.get('A')!();
  await tick();
  eq(started.map((s) => s[0]), ['A', 'B', 'C'], 'the next starts when one ends, in order');
  eq(started[2][1], 4000, 'the job is passed its queue wait');
  eq(q.pending('A'), null, 'an ended job is no longer pending');
  ok(q.cancel('D') && q.pending('D') === null, 'a queued decision is cancelled');
  ok(!q.cancel('B'), 'a running one is not (it ends by its own abort)');
  resolvers.get('B')!();
  resolvers.get('C')!();
  await tick();
  eq(started.map((s) => s[0]), ['A', 'B', 'C'], 'the cancelled one never starts');
  eq(expired, [], 'nothing expired');
  eq(q.inFlight, 0, 'nothing in flight');

  // Expiry by the clock (checked when a place frees) and by the timer
  const q2 = new ChooserQueue({ parallel: 1, queueMs: 30000, now: () => clock });
  const started2: string[] = [];
  const ex2: string[] = [];
  let free!: () => void;
  q2.submit('A', async () => { started2.push('A'); await new Promise<void>((r) => (free = r)); }, () => ex2.push('A'));
  q2.submit('B', async () => { started2.push('B'); }, () => ex2.push('B'));
  q2.submit('C', async () => { started2.push('C'); }, () => ex2.push('C'));
  clock += 31000;
  q2.submit('D', async () => { started2.push('D'); }, () => ex2.push('D'));
  free();
  await tick();
  eq(ex2, ['B', 'C'], 'jobs past queueMs expire instead of starting');
  eq(started2, ['A', 'D'], 'and the next in time starts');
  const q3 = new ChooserQueue({ parallel: 1, queueMs: 40 });
  const ex3: string[] = [];
  const started3: string[] = [];
  let free3!: () => void;
  q3.submit('A', () => new Promise<void>((r) => (free3 = r)), () => ex3.push('A'));
  q3.submit('B', async () => { started3.push('B'); }, () => ex3.push('B'));
  await tick(120);
  eq([ex3, q3.pending('B')], [['B'], null], 'the timer expires a job not started within queueMs');
  free3();
  await tick();
  eq(started3, [], 'an expired job never runs');

  // Throws are caught: a job that throws at once, one that rejects, an onExpire that throws
  const q4 = new ChooserQueue({ parallel: 1, queueMs: 30000, now: () => clock });
  const ran: string[] = [];
  const before = logs.length;
  q4.submit('A', () => { throw new Error('sync throw'); }, () => {});
  q4.submit('B', async () => { throw new Error('async throw'); }, () => {});
  q4.submit('C', async () => { ran.push('C'); }, () => {});
  await tick();
  await tick();
  eq(ran, ['C'], 'the queue goes on after a throwing job');
  eq(logs.slice(before).filter((l) => l.startsWith('[choice-error]')).length, 2, 'each throw is logged as [choice-error]');
  eq(q4.inFlight, 0, 'nothing left in flight');
  const q5 = new ChooserQueue({ parallel: 1, queueMs: 30000, now: () => clock });
  let free5!: () => void;
  q5.submit('A', () => new Promise<void>((r) => (free5 = r)), () => {});
  q5.submit('B', async () => {}, () => { throw new Error('expire throw'); });
  clock += 31000;
  free5();
  await tick();
  ok(logs.some((l) => l.startsWith('[choice-error] B: on expiry')), 'a throwing onExpire is caught and logged');
  eq(q5.inFlight, 0, 'the queue is empty after it');
}

// --- ChoiceStats
{
  const s = new ChoiceStats();
  const T = Date.UTC(2026, 9, 12, 12);
  const MIN = 60000;
  const end = (o: Partial<Parameters<ChoiceStats['record']>[0]>) => s.record({
    village: 'V', agent: 'Worker1', kind: 'pen', id: 'pen:cow', ok: false, cut: false, contention: false, productive: false, minutes: 1, at: T, line: 'x', ...o,
  });
  // Learning progress
  eq(s.learningProgress('V', 'farm'), 0.5, 'LP with no ends is 0.5');
  for (let i = 0; i < 5; i++) end({ kind: 'farm', id: 'farm:0', ok: true, productive: i >= 3, at: T + i * MIN });
  eq(s.learningProgress('V', 'farm'), 0.5, 'LP with fewer than 6 ends is 0.5');
  end({ kind: 'farm', id: 'farm:0', ok: true, productive: true, at: T + 5 * MIN });
  // last 6, newest first: 1,1,1,0,0,0
  eq(s.learningProgress('V', 'farm'), 1, 'LP from 0,0,0 then 1,1,1');
  end({ kind: 'farm', id: 'farm:0', ok: false, cut: true, at: T + 6 * MIN });
  end({ kind: 'farm', id: 'farm:0', ok: false, contention: true, at: T + 7 * MIN });
  eq(s.learningProgress('V', 'farm'), 1, 'cut and contention ends are left out of LP');
  end({ kind: 'farm', id: 'farm:0', ok: true, productive: false, at: T + 8 * MIN });
  // newest first: 0,1,1 | 1,0,0
  ok(Math.abs(s.learningProgress('V', 'farm') - 1 / 3) < 1e-9, 'LP |2/3 - 1/3|');
  eq(s.learningProgress('W', 'farm'), 0.5, 'LP per village');

  // The agent's record, the village's last, the outcome lines
  eq(s.agentKind('V', 'Worker1', 'farm'), { n: 7, ok: 7, minutes: 1 }, "the agent's own record (cut and contention left out)");
  eq(s.agentKind('V', 'Worker2', 'farm'), null, 'never done');
  eq(s.villageLast('V', 'farm'), { at: T + 8 * MIN, ok: true, line: 'x' }, "the village's last end of a kind");
  eq(s.villageLast('V', 'cake'), null, 'no end of a kind');
  end({ kind: 'cake', id: 'cake', ok: true, at: T + 9 * MIN, line: 'bake a cake: done' });
  end({ kind: 'cake', id: 'cake', ok: true, at: T + 10 * MIN, agent: 'Worker2', line: 'other' });
  eq(s.outcomes('V', 'Worker1', 2), ['x', 'bake a cake: done'], "the agent's last lines, oldest first");

  // The per-id ban: 3 failures of one id within an hour
  const s2 = new ChoiceStats();
  const end2 = (o: Partial<Parameters<ChoiceStats['record']>[0]>) => s2.record({
    village: 'V', agent: 'Worker1', kind: 'pen', id: 'pen:cow', ok: false, cut: false, contention: false, productive: false, minutes: 1, at: T, line: 'x', ...o,
  });
  end2({ at: T });
  end2({ at: T + 10 * MIN });
  eq(s2.banned('V', 'pen', 'pen:cow', T + 11 * MIN), null, 'two failures: no ban');
  end2({ at: T + 20 * MIN, cut: true });
  end2({ at: T + 21 * MIN, contention: true });
  eq(s2.banned('V', 'pen', 'pen:cow', T + 22 * MIN), null, 'cut and contention failures do not count');
  end2({ at: T + 30 * MIN });
  eq(s2.banned('V', 'pen', 'pen:cow', T + 31 * MIN), { until: T + 90 * MIN, scope: 'id' }, 'the third within an hour bans the id until an hour after it');
  eq(s2.banned('V', 'pen', 'pen:cow', T + 89 * MIN), { until: T + 90 * MIN, scope: 'id' }, 'still banned before then');
  eq(s2.banned('V', 'pen', 'pen:cow', T + 90 * MIN), null, 'free again an hour after the third');
  eq(s2.banned('V', 'pen', 'pen:chicken', T + 31 * MIN), null, 'one id failing bans only that id');
  eq(s2.banned('W', 'pen', 'pen:cow', T + 31 * MIN), null, 'a ban is per village');
  // Spread over more than an hour: no ban
  const s3 = new ChoiceStats();
  for (const m of [0, 40, 80]) s3.record({ village: 'V', agent: 'Worker1', kind: 'iron', id: 'iron:dig', ok: false, cut: false, contention: false, productive: false, minutes: 1, at: T + m * MIN, line: 'x' });
  eq(s3.banned('V', 'iron', 'iron:dig', T + 81 * MIN), null, 'three failures over more than an hour do not ban');
  // The kind: 2+ ids by 2+ agents
  const s4 = new ChoiceStats();
  const end4 = (agent: string, id: string, m: number) => s4.record({ village: 'V', agent, kind: 'start', id, ok: false, cut: false, contention: false, productive: false, minutes: 1, at: T + m * MIN, line: 'x' });
  end4('Worker1', 'start:pumpkin', 0);
  end4('Worker1', 'start:melon', 5);
  end4('Worker1', 'start:pumpkin', 10);
  eq(s4.banned('V', 'start', 'start:cane', T + 11 * MIN), null, 'two ids by one agent: the kind is not banned');
  end4('Worker2', 'start:melon', 15);
  eq(s4.banned('V', 'start', 'start:cane', T + 16 * MIN), { until: T + 75 * MIN, scope: 'kind' }, 'two ids by two agents: the whole kind is banned');
  eq(s4.banned('V', 'start', 'start:pumpkin', T + 16 * MIN), { until: T + 75 * MIN, scope: 'kind' }, 'every id of the kind');
  const s5 = new ChoiceStats();
  for (const [a, i, m] of [['Worker1', 'explore:1', 0], ['Worker2', 'explore:2', 1], ['Worker3', 'explore:3', 2], ['Worker1', 'explore:3', 3]] as const)
    s5.record({ village: 'V', agent: a, kind: 'explore', id: i, ok: false, cut: false, contention: false, productive: false, minutes: 1, at: T + m * MIN, line: 'x' });
  eq(s5.banned('V', 'explore', 'explore:3', T + 4 * MIN), null, 'explore is never banned');

  // The agent cooldown
  const s6 = new ChoiceStats();
  s6.record({ village: 'V', agent: 'Worker1', kind: 'annex', id: 'annex', ok: false, cut: false, contention: false, productive: false, minutes: 1, at: T, line: 'x' });
  s6.record({ village: 'V', agent: 'Worker2', kind: 'annex', id: 'annex', ok: false, cut: true, contention: false, productive: false, minutes: 1, at: T, line: 'x' });
  s6.record({ village: 'V', agent: 'Worker3', kind: 'annex', id: 'annex', ok: false, cut: false, contention: true, productive: false, minutes: 1, at: T, line: 'x' });
  ok(s6.agentCooling('V', 'Worker1', 'annex', T + 4 * MIN), 'an own failure cools the kind for the agent');
  ok(!s6.agentCooling('V', 'Worker1', 'annex', T + 5 * MIN), 'for 5 minutes');
  ok(!s6.agentCooling('V', 'Worker1', 'cake', T + MIN), 'only that kind');
  ok(!s6.agentCooling('V', 'Worker4', 'annex', T + MIN), "another agent's failure does not cool it");
  ok(!s6.agentCooling('V', 'Worker2', 'annex', T + MIN) && !s6.agentCooling('V', 'Worker3', 'annex', T + MIN), 'cut and contention failures do not cool');

  // The model-call rate
  const s7 = new ChoiceStats();
  eq(s7.lastModelAt('Worker1'), 0, 'no model decision yet');
  for (let i = 0; i < 5; i++) s7.noteModel('Worker1', T + i * 20 * MIN);
  eq(s7.lastModelAt('Worker1'), T + 80 * MIN, 'the last model decision');
  eq(s7.modelCallsLastHour('Worker1', T + 81 * MIN), 3, 'model decisions in the last hour');
  eq(s7.modelCallsLastHour('Worker2', T), 0, 'per agent');
}

// --- choreProductive on the skills' real done messages (mcBuild.ts), one success and one with nothing gained a skill
{
  const P = (kind: ChoiceKind, skill: string, message: string, carried: Record<string, number> | null = null) => choreProductive(kind, skill, true, message, carried);
  const cases: Array<[ChoiceKind, string, string, boolean, Record<string, number>?]> = [
    ['farm', 'harvest_farm', 'harvested 14 ripe wheat at -1640..-1636, 30..36 (14 wheat, 20 seeds), sowed 14 again, baked 0 bread into the village storage', true],
    ['farm', 'harvest_farm', 'nothing ripe on the farm at -1640..-1636, 30..36', false],
    ['farm', 'harvest_farm', 'harvested 14 ripe wheat at -1640..-1636, 30..36 (14 wheat, 20 seeds), sowed 14 again, baked 4 bread (not deposited: the storage hut is full (all 9 chest spots taken))', true],
    ['slot', 'harvest_slot', 'harvested 6 pumpkin at -1650..-1648, 40..44 into the village storage', true],
    ['slot', 'harvest_slot', 'nothing ripe on the sugar_cane farm at -1650..-1648, 40..44', false],
    ['slot', 'harvest_slot', 'harvested 10 sugar_cane at -1650..-1648, 40..44 (not deposited: storage is full (3 chests): craft a chest (8 planks) and deposit again)', true],
    ['penwork', 'collect_eggs', 'collected 3 egg, 1 brown_egg from the chicken pen on annex slot 2', true],
    ['penwork', 'collect_eggs', 'no eggs in the chicken pen on annex slot 2', false],
    ['penwork', 'milk_cows', 'milked the cows on annex slot 1: 2 milk buckets', true],
    ['penwork', 'milk_cows', 'the storage holds 3 milk buckets already', false],
    ['penwork', 'breed_pen', 'fed 2 chickens wheat_seeds in the pen on annex slot 1: 1 young born, 5 in the pen', true],
    ['penwork', 'breed_pen', 'fed 2 chickens wheat_seeds in the pen on annex slot 1: no young yet', false],
    ['penwork', 'breed_pen', 'fed 2 cows wheat in the pen on annex slot 3: no young yet (at the gate)', false],
    ['penwork', 'breed_pen', 'the cow pen on annex slot 3 has 1 adult ready to breed of 3', false],
    ['penwork', 'breed_pen', 'the chicken pen on annex slot 1 is full (10 of 10)', false],
    ['iron', 'dig_iron', 'iron trip: 4 raw iron carried; stairs 12 steps (level y=18), 60 tunnel cells, 10 raw iron and 4 coal in all; brought up 4 raw iron, 1 coal; deposited 4 raw_iron, 1 coal; storage now holds 20 raw_iron', true],
    ['iron', 'dig_iron', 'iron trip: time up; stairs 12 steps (level y=18), 80 tunnel cells, 5 raw iron and 2 coal in all; brought up 0 raw iron, 3 coal; deposited 3 coal', false],
    ['iron', 'dig_iron', 'iron trip: another worker is digging the iron level; stairs 12 steps (level y=18), 60 tunnel cells, 10 raw iron and 0 coal in all; brought up 0 raw iron, 0 coal; not deposited: storage is full (3 chests)', false],
    ['iron', 'make_iron_tool', 'made a bucket (smelted 3 raw_iron; crafted 1 bucket); deposited 1 bucket', true],
    ['cake', 'bake_cake', 'baked a cake from the village storage (3 milk buckets, 2 sugar, 1 egg, 3 wheat; the buckets back)', true],
  ];
  for (const [kind, skill, msg, want, carried] of cases) eq(P(kind, skill, msg, carried ?? null), want, `${skill}: ${msg.slice(0, 70)}`);
  // A message with no count: the carried gain decides (dig_iron), else success counts
  eq(P('iron', 'dig_iron', 'iron trip: stopped', { raw_iron: 2 }), true, 'dig_iron without a count: carried raw iron');
  eq(P('iron', 'dig_iron', 'iron trip: stopped', { coal: 2 }), false, 'dig_iron without a count: no raw iron carried');
  // The generic list for a skill without a parser: digits anchored, notes after " (" not read
  eq(P('penwork', 'other_skill', 'got 10 raw things'), true, 'generic: "10 raw" is not a zero');
  eq(P('penwork', 'other_skill', 'got 0 raw things'), false, 'generic: "0 raw" is');
  eq(P('penwork', 'other_skill', 'did it (not deposited: storage is full)'), true, 'generic: a storage-full note is not nothing gained');
  eq(choreProductive('farm', 'harvest_farm', false, 'harvested 14 ripe wheat', null), false, 'a failure is never productive');
  eq([choreProductive('explore', 'scout', true, '', null, 0.25), choreProductive('explore', 'scout', true, '', null, 0.05)], [true, false], 'explore by new land');
}

await tick(10);
console.log = origLog;
if (unhandled) failures++;
console.log(`${checks} checks, ${failures} failed`);
process.exit(failures ? 1 : 0);
