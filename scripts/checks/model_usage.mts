/**
 * The model-usage ledger checked offline (phase A, A.0; no server): reasoning and price settings, cloud detection, window
 * sums, the hourly budget's hysteresis, episodes and retry time, refusals, reports (agent filter, partial logs) and
 * costs, with an injected clock; and E.0's parts: withdrawn and fallback outcomes, the limit following the agent count, an
 * agent's share, the degrade levels, and the spend ledger (sink, seeding without double counts, the month, the caps).
 * Exits non-zero on any failure.
 * Usage: node_modules/.bin/tsx scripts/checks/model_usage.mts
 */
import {
  BudgetExceeded, DEFAULT_REASONING, RESUME_FRACTION, SpendCapReached, UsageLedger, isCloudModel, parseBudget, parsePrices, parseReasoning, parseSpendCap, thinkFor,
} from '../../server/src/modelUsage';

let failures = 0;
let checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${what}`);
  }
}
const eq = (a: unknown, b: unknown, what: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

// Warnings and log lines are counted, not printed
const warns: string[] = [];
const logs: string[] = [];
const origWarn = console.warn, origLog = console.log;
console.warn = (...a: unknown[]) => void warns.push(a.join(' '));
const quietLog = (...a: unknown[]) => void logs.push(a.join(' '));

// --- parseReasoning
eq(parseReasoning('exec=high,plan=low'), { exec: 'high', plan: 'low', design: 'medium' }, 'reasoning from a string');
eq(parseReasoning({ design: 'high' }), { ...DEFAULT_REASONING, design: 'high' }, 'reasoning from an object');
eq(parseReasoning(undefined), DEFAULT_REASONING, 'reasoning unset');
eq(parseReasoning(''), DEFAULT_REASONING, 'reasoning empty');
eq(parseReasoning(null, { exec: 'high', plan: 'high', design: 'high' }), { exec: 'high', plan: 'high', design: 'high' }, 'reasoning null keeps the base');
ok(warns.length === 0, 'no warning for good or empty reasoning settings');
eq(parseReasoning('exec=extreme,plan=low'), { ...DEFAULT_REASONING, plan: 'low' }, 'a bad level is ignored');
eq(warns.length, 1, 'one warning for a bad level');
parseReasoning('exec=extreme,plan=low');
eq(warns.length, 1, 'the same bad input warns once');
eq(parseReasoning('choose=low,exec=Medium'), { ...DEFAULT_REASONING, exec: 'medium' }, 'an unknown key is ignored, levels any case');
eq(warns.length, 2, 'a second distinct bad input warns again');
parseReasoning({ choose: 'low' });
parseReasoning({ choose: 'low' });
eq(warns.length, 3, 'a bad object input warns once');

// --- parsePrices
{
  warns.length = 0;
  const p = parsePrices('weird=name:1b-cloud=1/2, gpt-oss:120b-cloud=0.15/0.60,bad,also=1');
  eq(p.get('weird=name:1b-cloud'), { input: 1, output: 2 }, "a '=' inside the model name");
  eq(p.get('gpt-oss:120b-cloud'), { input: 0.15, output: 0.6 }, 'a normal price');
  eq(p.size, 2, 'bad entries skipped');
  eq(warns.length, 2, 'one warning per bad entry');
  parsePrices('bad');
  eq(warns.length, 2, 'a bad entry warns once');
}

// --- thinkFor and isCloudModel
const models: Array<[string, boolean, boolean]> = [
  // model, cloud, reasoning
  ['gpt-oss:120b-cloud', true, true],
  ['ollama:gpt-oss:120b-cloud', true, true],
  ['qwen3:30b-instruct', false, false],
  ['kimi-k2:1t-cloud', true, false],
  ['claude-opus-5-5', true, false],
  ['anthropic:claude-opus-5-5', true, false],
  ['gpt-oss:120b', false, true],
];
for (const [m, cloud, reasoning] of models) {
  eq(isCloudModel(m), cloud, `isCloudModel(${m})`);
  eq(thinkFor(m, 'low'), reasoning ? 'low' : false, `thinkFor(${m})`);
}

// --- parseBudget
{
  warns.length = 0;
  eq(parseBudget(undefined), 2_000_000, 'budget unset');
  eq(parseBudget('0'), null, 'budget 0');
  eq(parseBudget('off'), null, 'budget off');
  eq(parseBudget('NONE'), null, 'budget NONE');
  eq(parseBudget(''), null, 'budget empty');
  eq(parseBudget('  '), null, 'budget blank');
  eq(parseBudget('50000'), 50000, 'budget a number');
  eq(warns.length, 0, 'no warning for good budgets');
  eq(parseBudget('abc'), 2_000_000, 'budget abc');
  eq(parseBudget('-5'), 2_000_000, 'budget negative');
  eq(warns.length, 2, 'one warning each for abc and -5');
  eq(new UsageLedger({ budgetPerHour: null }).summary().budget.tokensPerHour, null, 'ledger with the budget off');
  eq(new UsageLedger().summary().budget.tokensPerHour, 2_000_000, 'ledger default budget');
  eq(new UsageLedger({ budgetPerHour: 0 }).summary().budget.tokensPerHour, null, 'ledger budget 0 is off');
}

// --- window sums, hysteresis, episodes, retryAt
console.log = quietLog;
{
  let t = 1_000_000;
  const now = () => t;
  const L = new UsageLedger({ budgetPerHour: 1000, windowMs: 60000, now });
  const cloud = 'gpt-oss:120b-cloud', local = 'qwen3:30b-instruct';
  L.record({ model: cloud, agent: 'Mayor', kind: 'plan', promptTokens: 300, outputTokens: 100, ms: 10 }); // 400 at t0
  t += 10000;
  L.record({ model: local, agent: 'Worker1', kind: 'exec', promptTokens: 5000, outputTokens: 500, ms: 10 }); // local: not counted
  L.record({ model: `ollama:${cloud}`, agent: 'Worker1', kind: 'exec', promptTokens: 200, outputTokens: 100, ms: 10 }); // 700 at t0+10s
  eq(L.summary().budget.usedInWindow, 700, 'window counts cloud ok tokens only');
  eq(L.summary().lastHour.calls, 3, 'lastHour counts every call');
  eq(L.summary().lastHour.promptTokens, 5500, 'lastHour includes local tokens');
  ok(L.blocked(cloud) === null, 'not blocked under the limit');
  t += 10000;
  L.record({ model: cloud, agent: 'Worker2', kind: 'design', promptTokens: 250, outputTokens: 50, ms: 10 }); // 300 at t0+20s -> 1000
  let b = L.summary().budget;
  ok(b.blocked, 'blocked at the limit');
  eq(b.episode, 1, 'episode 1');
  // Below 800 when the first record (400) leaves the window: at t0 + 60s
  eq(b.retryAt, 1_000_000 + 60000, 'retryAt when the window drops below 80%');
  eq(logs.filter((l) => l.includes('hourly budget reached')).length, 1, 'one "budget reached" line');
  ok(L.blocked(local) === null, 'local models are never blocked');
  const e = L.blocked(cloud);
  ok(e instanceof BudgetExceeded && e.budget && e.used === 1000 && e.limit === 1000 && e.episode === 1, 'blocked() gives a BudgetExceeded');
  ok(/hourly token budget spent: 1,000 of 1,000 cloud tokens in the last hour \(MC_TOKEN_BUDGET_HOUR\); model calls resume at \d\d:\d\d/.test(e?.message ?? ''), `the message: ${e?.message}`);
  // check: throws for cloud and records a refusal; passes for local
  let threw = false;
  try { L.check(cloud, 'Worker1', 'exec'); } catch (err) { threw = err instanceof BudgetExceeded; }
  ok(threw, 'check throws for a cloud model while blocked');
  let localThrew = false;
  try { L.check(local, 'Worker1', 'exec'); } catch { localThrew = true; }
  ok(!localThrew, 'check passes a local model');
  eq(L.report().total.refused, 1, 'the refusal is recorded');
  eq(L.report().byAgent.Worker1.refused, 1, 'the refusal is on the agent');
  // The first 400 leaves the window: 600, below 80% (the 90% case is on a fresh ledger below)
  t = 1_000_000 + 60001;
  b = L.summary().budget;
  ok(!b.blocked, 'free below 80%');
  eq(logs.filter((l) => l.includes('budget free again')).length, 1, 'one "free again" line');
  // Hysteresis on a fresh ledger: 1000 -> blocked, 900 -> still blocked, 790 -> free; a new episode only on a new crossing
  t = 5_000_000;
  const H = new UsageLedger({ budgetPerHour: 1000, windowMs: 60000, now });
  H.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 100, outputTokens: 0, ms: 1 });
  t += 1000;
  H.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 10, outputTokens: 0, ms: 1 });
  t += 1000;
  H.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 890, outputTokens: 0, ms: 1 }); // 1000
  ok(H.summary().budget.blocked, 'H blocked at 1000');
  t = 5_000_000 + 60000; // the 100 leaves: 900 (90%)
  eq(H.summary().budget.usedInWindow, 900, 'H at 90%');
  ok(H.summary().budget.blocked, 'still blocked at 90%');
  H.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 100, outputTokens: 0, ms: 1 }); // 1000 again, same episode
  eq(H.summary().budget.episode, 1, 'no new episode while still blocked');
  t = 5_000_000 + 62000; // the 10 and the 890 leave: 100
  ok(!H.summary().budget.blocked, 'free below 80%');
  eq(H.summary().budget.retryAt, null, 'no retryAt when free');
  H.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 950, outputTokens: 0, ms: 1 }); // 1050
  eq(H.summary().budget.episode, 2, 'a new crossing is episode 2');
  ok(H.summary().budget.retryAt !== null && H.summary().budget.retryAt! > t, 'retryAt in the future');
  // setBudget re-evaluates
  H.setBudget(null);
  ok(!H.summary().budget.blocked && H.summary().budget.tokensPerHour === null, 'setBudget(null) frees');
  ok(H.blocked(cloud) === null, 'an off budget blocks nothing');
  H.setBudget(500, 30000);
  ok(H.summary().budget.blocked && H.summary().budget.windowMs === 30000, 'setBudget below the window blocks');
  eq(H.summary().budget.episode, 3, 'setBudget starts episode 3');
  ok(RESUME_FRACTION === 0.8, 'RESUME_FRACTION');
}

// --- reports, partial logs, costs
{
  let t = 10_000_000;
  const now = () => t;
  const R = new UsageLedger({ budgetPerHour: null, now, prices: 'gpt-oss:120b-cloud=1/2', retainMs: 50000 });
  R.record({ model: 'gpt-oss:120b-cloud', agent: 'Mayor', kind: 'plan', promptTokens: 1_000_000, outputTokens: 500_000, ms: 1 });
  R.record({ model: 'kimi-k2:1t-cloud', agent: 'Worker1', kind: 'exec', promptTokens: 1000, outputTokens: 10, ms: 1 });
  R.record({ model: 'qwen3:30b-instruct', agent: 'Worker2', kind: 'exec', promptTokens: 3000, outputTokens: 30, ms: 1 });
  R.error('gpt-oss:120b-cloud', 'Worker1', 'plan', 5);
  let r = R.report();
  eq(r.total.cost, 2, 'cost: 1M in at $1 + 0.5M out at $2');
  eq(r.byModel['kimi-k2:1t-cloud'].cost, 0, 'an unpriced cloud model adds 0');
  eq(r.unpriced, ['kimi-k2:1t-cloud'], 'and lands in unpriced');
  eq(r.byModel['qwen3:30b-instruct'].cost, 0, 'a local model costs 0');
  ok(!r.unpriced.includes('qwen3:30b-instruct'), 'a local model is never unpriced');
  eq(r.total.calls, 3, 'calls count ok outcomes only');
  eq(r.total.errors, 1, 'errors counted');
  eq(r.total.maxPromptTokens, 1_000_000, 'maxPromptTokens');
  eq(r.partial, false, 'a report without since is not partial');
  r = R.report({ agents: ['Worker1', 'Worker2'] });
  eq(Object.keys(r.byAgent).sort(), ['Worker1', 'Worker2'], 'the agents filter');
  eq(r.total.calls, 2, 'filtered total');
  eq(Object.keys(r.byModel).sort(), ['gpt-oss:120b-cloud', 'kimi-k2:1t-cloud', 'qwen3:30b-instruct'], 'filtered models (with the error)');
  eq(r.byModel['gpt-oss:120b-cloud'].calls, 0, 'the Mayor\'s gpt-oss call is not in the filtered report');
  eq(r.byKind.exec.calls, 2, 'filtered kinds');
  eq(r.byAgentKind.Worker1.plan.errors, 1, 'byAgentKind');
  eq(r.lastHour.calls, 3, 'lastHour stays global in a filtered report');
  eq(r.budget.tokensPerHour, null, 'budget stays global');
  const empty = R.report({ agents: ['Nobody'] });
  eq(empty.total.cost, 0, 'an empty set costs 0');
  eq(empty.unpriced, [], 'an empty set has nothing unpriced');
  // since: from the log
  t += 10000;
  R.record({ model: 'gpt-oss:120b-cloud', agent: 'Worker1', kind: 'design', promptTokens: 100, outputTokens: 100, ms: 1 });
  r = R.report({ since: t, agents: ['Worker1'] });
  eq(r.total.calls, 1, 'since: only later records');
  eq(r.byAgentKind.Worker1.design.calls, 1, 'since: byAgentKind');
  eq(r.partial, false, 'since after the ledger start and nothing pruned: complete');
  eq(R.report({ since: 1 }).partial, true, 'since before the ledger start: partial');
  // A prune: retainMs 50 s, so the first records (at 10,000,000) go when one is written after 10,050,000
  t = 10_000_000 + 55000;
  R.record({ model: 'qwen3:30b-instruct', agent: 'Worker2', kind: 'exec', promptTokens: 1, outputTokens: 1, ms: 1 });
  eq(R.report({ since: 10_000_000 }).partial, true, 'since at a pruned record: partial');
  eq(R.report({ since: 10_000_000 + 10000 }).partial, false, 'since after the pruned records: complete');
  eq(R.report({ since: 10_000_000 }).total.calls, 2, 'pruned records are gone from the log');
  eq(R.report().total.calls, 5, 'but stay in the totals since start');
  // maxRecords
  const M = new UsageLedger({ budgetPerHour: null, now, maxRecords: 3 });
  for (let i = 0; i < 5; i++) { t += 1; M.record({ model: 'qwen3:30b-instruct', agent: 'A', kind: 'exec', promptTokens: 1, outputTokens: 0, ms: 1 }); }
  eq(M.report({ since: 0 }).total.calls, 3, 'maxRecords keeps the newest');
  eq(M.report({ since: t - 2 }).partial, false, 'since after the pruned ones: complete');
  eq(M.report({ since: t - 3 }).partial, true, 'since at the newest pruned: partial');
  // cost()
  eq(R.cost('qwen3:30b-instruct', 100, 100), 0, 'cost of a local call');
  eq(R.cost('kimi-k2:1t-cloud', 100, 100), null, 'cost of an unpriced cloud call');
  eq(R.cost('ollama:gpt-oss:120b-cloud', 1e6, 0), 1, 'cost with the provider prefix');
}

// --- E.0: withdrawn and fallback outcomes (billed nothing, counted apart)
{
  let t = 20_000_000;
  const now = () => t;
  const W = new UsageLedger({ budgetPerHour: null, now, prices: 'gpt-oss:120b-cloud=1/2' });
  W.error('gpt-oss:120b-cloud', 'A', 'exec', 0, 'withdrawn');
  W.error('gpt-oss:120b-cloud', 'A', 'exec', 20000, 'fallback');
  W.error('gpt-oss:120b-cloud', 'A', 'exec', 5);
  const r = W.report();
  eq([r.total.withdrawn, r.total.fallback, r.total.errors, r.total.calls, r.total.cost], [1, 1, 1, 0, 0], 'withdrawn, fallback and errors counted apart, nothing billed');
  eq(r.byAgent.A.withdrawn, 1, 'withdrawn by agent');
}

// --- E.0: the limit follows the agents (budget unset), never below the old default
{
  const A = new UsageLedger({ perAgent: 150_000 });
  eq(A.summary().budget.tokensPerHour, 2_000_000, 'auto limit with no agents: the default');
  A.setAgents(3);
  eq(A.summary().budget.tokensPerHour, 2_000_000, 'auto limit at 3 agents: still the default');
  A.setAgents(25);
  eq(A.summary().budget.tokensPerHour, 3_750_000, 'auto limit at 25 agents: 150k each');
  eq(A.summary().budget.agents, 25, 'agents counted');
  const F = new UsageLedger({ perAgent: 150_000, agentFloor: 20 });
  eq(F.summary().budget.tokensPerHour, 3_000_000, 'the agent floor (MC_TOKEN_BUDGET_AGENTS) while agents spawn');
  const X = new UsageLedger({ budgetPerHour: 50_000, perAgent: 150_000 });
  X.setAgents(25);
  eq(X.summary().budget.tokensPerHour, 50_000, 'MC_TOKEN_BUDGET_HOUR stays absolute');
  A.setBudget(1000);
  A.setAgents(30);
  eq(A.summary().budget.tokensPerHour, 1000, 'setBudget turns the agent scaling off');
}

// --- E.0: an agent's share (2x fair), its hysteresis, the exemption, and scopes
{
  let t = 30_000_000;
  const now = () => t;
  const cloud = 'gpt-oss:120b-cloud';
  const S = new UsageLedger({ budgetPerHour: 10_000, windowMs: 60000, now });
  S.setAgents(4); // fair 2,500; refused at 5,000
  S.record({ model: cloud, agent: 'W1', kind: 'exec', promptTokens: 4000, outputTokens: 0, ms: 1 });
  ok(S.blocked(cloud, 'W1') === null, 'under its share');
  t += 1000;
  S.record({ model: cloud, agent: 'W1', kind: 'exec', promptTokens: 1000, outputTokens: 0, ms: 1 }); // 5,000
  const e = S.blocked(cloud, 'W1');
  ok(e instanceof BudgetExceeded && e.scope === 'agent' && e.limit === 5000 && e.episode === 1, `over its share: scope agent, limit 5,000 (${e?.scope}, ${e?.limit})`);
  ok(/W1's share of the hourly token budget is spent/.test(e?.message ?? ''), `the share's message: ${e?.message}`);
  ok(S.blocked(cloud) === null, 'the global budget is not blocked');
  ok(S.blocked(cloud, 'W2') === null, 'another agent is not refused');
  eq(S.summary().budget.overShare, ['W1'], 'overShare lists it');
  eq(S.summary().budget.episode, 0, 'no global episode');
  eq(e?.retryAt, 30_000_000 + 60000, 'retryAt: when the first 4,000 leave (1,000 < 0.8 x 5,000)');
  let threw: unknown = null;
  try { S.check(cloud, 'W1', 'plan'); } catch (err) { threw = err; }
  ok(threw instanceof BudgetExceeded && (threw as BudgetExceeded).scope === 'agent', 'check refuses it');
  eq(S.report().byAgent.W1.refused, 1, 'and records the refusal');
  // 4,100 (82% of the share): still refused; the 4,000 gone: 1,000 free
  t = 30_000_000 + 59_000;
  S.record({ model: cloud, agent: 'W1', kind: 'exec', promptTokens: 0, outputTokens: 0, ms: 1 });
  ok(S.blocked(cloud, 'W1') !== null, 'still refused above 80% of its share');
  t = 30_000_000 + 60_001;
  ok(S.blocked(cloud, 'W1') === null, 'free below 80% of its share');
  // a new crossing is episode 2 of the share scope
  S.record({ model: cloud, agent: 'W1', kind: 'exec', promptTokens: 4500, outputTokens: 0, ms: 1 });
  eq(S.blocked(cloud, 'W1')?.episode, 2, 'a new crossing is share episode 2');
  // exempt
  S.exempt(['W1']);
  ok(S.blocked(cloud, 'W1') === null, 'an exempt agent is never refused over its share');
  S.exempt([]);
  ok(S.blocked(cloud, 'W1') !== null, 'refused again once no longer exempt');
  // mayors (set with the agent count) are never refused over a share either
  S.setAgents(4, ['W1']);
  ok(S.blocked(cloud, 'W1') === null, 'a mayor is never refused over its share');
  // one agent: no shares
  S.setAgents(1);
  ok(S.blocked(cloud, 'W1') === null, 'one agent: no share refusals');
  ok(S.blocked('qwen3:30b-instruct', 'W1') === null, 'local models: never');
}

// --- E.0: degrade levels and their hysteresis
{
  let t = 40_000_000;
  const now = () => t;
  const cloud = 'gpt-oss:120b-cloud';
  const D = new UsageLedger({ budgetPerHour: 1000, windowMs: 60000, now });
  const all = () => ['chronicle', 'reflection', 'acts', 'decisions'].map((c) => D.allows(c as never));
  eq(all(), [true, true, true, true], 'everything allowed at 0');
  D.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 700, outputTokens: 0, ms: 1 });
  eq(all(), [false, true, true, true], '70%: the chronicle off');
  t += 1000;
  D.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 100, outputTokens: 0, ms: 1 });
  eq(all(), [false, false, true, true], '80%: reflections off');
  t += 1000;
  D.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 100, outputTokens: 0, ms: 1 });
  eq(all(), [false, false, false, true], '90%: acts off');
  t += 1000;
  D.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 100, outputTokens: 0, ms: 1 });
  eq(all(), [false, false, false, false], '100%: decisions off');
  eq(D.summary().budget.degradeLevel, 4, 'level 4');
  // The 700 leaves: 300 (30%): below 0.8 x 70% = 56%, so everything back on
  t = 40_000_000 + 60_001;
  eq(all(), [true, true, true, true], 'all back on at 30%');
  const dg = D.summary().budget.degradations;
  eq(dg.map((x) => [x.level, x.off]), [[1, true], [2, true], [3, true], [4, true], [0, false]], 'every transition kept');
  ok(logs.some((l) => l.includes('[usage] degrade 1: chronicle off at 700 of 1,000')), 'the degrade line');
  // hysteresis: at 65% after the chronicle went off at 70%, it stays off (back on below 56%)
  t = 41_000_000;
  const H = new UsageLedger({ budgetPerHour: 1000, windowMs: 60000, now });
  H.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 100, outputTokens: 0, ms: 1 });
  t += 1000;
  H.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 600, outputTokens: 0, ms: 1 }); // 70%
  ok(!H.allows('chronicle'), 'chronicle off at 70%');
  t = 41_000_000 + 60_001; // the 100 leaves: 60%
  ok(!H.allows('chronicle'), 'still off at 60% (hysteresis)');
  ok(H.allows('reflection'), 'reflections on');
  const O = new UsageLedger({ budgetPerHour: null, now });
  ok(O.allows('decisions'), 'the budget off allows everything');
}

// --- E.0: the spend ledger: the sink, seeding, the month, the caps
{
  let t = new Date(2026, 9, 31, 23, 0).getTime();
  const now = () => t;
  const cloud = 'gpt-oss:120b-cloud';
  const lines: Array<[string, number]> = [];
  const P = new UsageLedger({ budgetPerHour: null, now, prices: 'gpt-oss:120b-cloud=1/1', spendCap: { month: 5, programme: 8 } });
  P.setSink((r, usd) => lines.push([r.outcome, usd]));
  P.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 1_000_000, outputTokens: 0, ms: 1 }); // $1
  P.error(cloud, 'A', 'exec', 0, 'withdrawn');
  try { P.check('qwen3:30b-instruct', 'A', 'exec'); } catch { /* never */ }
  eq(lines, [['ok', 1], ['withdrawn', 0]], 'the sink gets every record with its $');
  eq([P.spend().month, P.spend().programme], [1, 1], 'unseeded: this process only');
  // The files (every process's) said $3.5 this month before the cutoff, $6 in the programme; this process's $1 was before
  // the cutoff, so it is in the files already and not counted twice
  P.seedSpend({ cutoff: t + 1, monthKey: '2026-10', month: 3.5, programme: 6 });
  eq([P.spend().month, P.spend().programme], [3.5, 6], 'seeded: the files only (no double count)');
  t += 60000;
  P.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 1_000_000, outputTokens: 0, ms: 1 }); // +$1 = 4.5
  eq([P.spend().month, P.spend().programme], [4.5, 7], 'after the seed: the files plus this process since');
  ok(P.blocked(cloud) === null, 'under the caps');
  t += 60000;
  P.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 500_000, outputTokens: 0, ms: 1 }); // 5.0
  const c = P.blocked(cloud);
  ok(c instanceof SpendCapReached && c.scope === 'spend', 'the month cap refuses');
  ok(/month's spending cap is reached: \$5\.00 of \$5\.00/.test(c?.message ?? ''), `the cap's message: ${c?.message}`);
  ok(P.blocked('qwen3:30b-instruct') === null, 'local models pass the cap');
  // The month turns: the seed's month is last month's, this process's calls of October drop out of November
  t = new Date(2026, 10, 1, 0, 30).getTime();
  eq(P.spend().month, 0, 'a new month starts at 0');
  eq(P.spend().programme, 7.5, 'the programme goes on');
  ok(P.blocked(cloud) === null, 'the month cap frees in the new month');
  P.record({ model: cloud, agent: 'A', kind: 'exec', promptTokens: 500_000, outputTokens: 0, ms: 1 }); // programme 8
  ok(P.blocked(cloud)?.message.includes("programme's spending cap") ?? false, 'the programme cap refuses');
  eq(parseSpendCap('30'), { month: 30 }, 'a bare number is the month');
  eq(parseSpendCap('month=30, programme=60'), { month: 30, programme: 60 }, 'both caps');
  eq(parseSpendCap(undefined), null, 'unset: no cap');
}

console.log = origLog;
console.warn = origWarn;
console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
