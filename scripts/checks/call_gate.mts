/**
 * The model call gate checked offline (E.0; no agent server): a fake Ollama /api/chat on a local port (a delay per call,
 * an in-flight count, request ids, 503 past 3 running and 6 queued as Ollama Cloud Pro does), and modelCall.ts pointed at
 * it with a model named "x-cloud" (a cloud model to the gate). Checks:
 *   1. the gate on its own: start order by priority then arrival, the low classes never above slots - 1, a low class at
 *      its cap holding no one behind it;
 *   2. 25 calls at once across every class: in flight at the server never above 3, low classes never above 2, no 503,
 *      every call answered though the last waits several times MC_OLLAMA_TIMEOUT at the gate (the timeout runs from the
 *      send), and the request body as completeOllama sends it (model, think, keep_alive, options, messages, tools);
 *   3. withdrawal: calls whose maxWaitMs passes at the gate, or whose signal aborts, never reach the server and are billed
 *      nothing (the ledger's 'withdrawn');
 *   4. fallback: a call cut off at its fallbackMs from the send frees its slot at once ('fallback');
 *   5. a refused call (the budget) gives its slot back.
 * LIVE=1 sends the 25 calls to gpt-oss:120b-cloud through the real Ollama app instead (one-line prompts, a few cents): no
 * rejection, the held slot honoured. Exits non-zero on any failure.
 * Usage: node_modules/.bin/tsx scripts/checks/call_gate.mts   (LIVE=1 for the live run)
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const LIVE = process.env.LIVE === '1';
const DELAY = 400;

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

// --- The fake server: ids come in the user prompt ("id=N class=C")
let active = 0, maxActive = 0, activeLow = 0, maxLow = 0, rejected = 0;
const seen: string[] = [];
const bodies: Record<string, unknown>[] = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw) as { messages: Array<{ content: string }> };
    bodies.push(body);
    const user = body.messages[1]?.content ?? '';
    const id = /id=(\S+)/.exec(user)?.[1] ?? '?';
    const low = /class=(ballot|reflection|chronicle)/.test(user);
    if (active >= 9) {
      rejected++;
      res.writeHead(503).end('server busy');
      return;
    }
    seen.push(id);
    active++;
    if (low) activeLow++;
    maxActive = Math.max(maxActive, active);
    maxLow = Math.max(maxLow, activeLow);
    const delay = Number(/delay=(\d+)/.exec(user)?.[1] ?? DELAY);
    const t = setTimeout(() => {
      active--;
      if (low) activeLow--;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: { content: '', tool_calls: [{ function: { name: 'chat', arguments: { message: `ok ${id}` } } }] }, prompt_eval_count: 10, eval_count: 2 }));
    }, delay);
    res.on('close', () => {
      if (!res.writableEnded) {
        clearTimeout(t);
        active--;
        if (low) activeLow--;
      }
    });
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as AddressInfo).port;

// Settings are read when modelCall loads: set them first
if (!LIVE) process.env.MC_OLLAMA_URL = `http://127.0.0.1:${port}`;
process.env.MC_OLLAMA_TIMEOUT = '2';
process.env.MC_TOKEN_BUDGET_HOUR = 'off';
process.env.MC_CALL_SLOTS = 'ollama-cloud=3';
const { CallGate, CallFallback, CallWithdrawn, PRIORITIES, callModel, gate, parseSpec } = await import('../../server/src/modelCall');
const { usage, BudgetExceeded } = await import('../../server/src/modelUsage');
type Priority = (typeof PRIORITIES)[number];
const LOWS = new Set(['ballot', 'reflection', 'chronicle']);
const quiet = console.log;

// --- 1. The gate alone: order and the held slot
{
  const g = new CallGate(new Map([['k', 3]]));
  const held = await Promise.all([0, 1, 2].map(() => g.acquire('k', 'exec', 60000)));
  const order: string[] = [];
  const releases: Array<() => void> = [];
  const classes: Priority[] = ['chronicle', 'exec', 'ballot', 'human', 'reflection', 'exec_fail', 'plan', 'decision', 'exec', 'chronicle', 'human'];
  const waits = classes.map((c, i) => g.acquire('k', c, 60000).then((s) => {
    order.push(`${c}#${i}`);
    releases.push(s.release);
  }));
  // Free one slot at a time while anything waits; at the end the lows run two at a time
  for (const h of held) {
    h.release();
    await new Promise((r) => setTimeout(r, 5));
  }
  for (let k = 0; k < 30 && order.length < classes.length; k++) {
    const r = releases.shift();
    r?.();
    await new Promise((res) => setTimeout(res, 5));
  }
  for (const r of releases.splice(0)) r();
  await Promise.all(waits);
  const want = classes.map((c, i) => ({ c, i, rank: PRIORITIES.indexOf(c) })).sort((x, y) => x.rank - y.rank || x.i - y.i).map((x) => `${x.c}#${x.i}`);
  eq(order, want, 'start order: by priority, then arrival');
  const s = g.stats();
  ok(s.keys.k.maxLow <= 2, `low classes in flight at most 2 of 3 (${s.keys.k.maxLow})`);
  eq([s.keys.k.inFlight, s.keys.k.queued], [0, 0], 'nothing left held or queued');
  // A low class at its cap holds no one behind it: two lows in flight, a third low and an exec waiting, one slot free
  const g2 = new CallGate(new Map([['k', 3]]));
  const l1 = await g2.acquire('k', 'ballot', 1000), l2 = await g2.acquire('k', 'chronicle', 1000);
  let lowStarted = false, execStarted = false;
  const l3 = g2.acquire('k', 'reflection', 200).then(() => (lowStarted = true), (e) => e);
  const e1 = g2.acquire('k', 'exec', 1000).then((x) => { execStarted = true; return x; });
  await new Promise((r) => setTimeout(r, 20));
  ok(execStarted && !lowStarted, 'the held slot goes to the exec, not a third low');
  ok((await l3) instanceof CallWithdrawn, 'the third low is withdrawn when its wait passes');
  l1.release(); l2.release(); (await e1).release();
  // Ungated keys pass at once
  const u = await g2.acquire(null, 'chronicle', 0);
  eq(u.waitMs, 0, 'ungated: no wait');
}

// --- 2. 25 calls at once through modelCall
const spec = parseSpec(LIVE ? 'ollama:gpt-oss:120b-cloud' : 'ollama:x-cloud')!;
const TOOL = { name: 'chat', description: 'Say something', input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } };
const call = (id: string, priority: Priority, extra: { maxWaitMs?: number; fallbackMs?: number; signal?: AbortSignal; delay?: number } = {}) =>
  callModel({
    spec, system: 'Reply with the chat tool, one word.', user: `id=${id} class=${priority}${extra.delay ? ` delay=${extra.delay}` : ''}`, tools: [TOOL],
    level: 'low', agent: `A${id}`, kind: 'exec', priority, maxWaitMs: extra.maxWaitMs, fallbackMs: extra.fallbackMs, signal: extra.signal,
  });
{
  const t0 = Date.now();
  const classes = Array.from({ length: 25 }, (_, i) => PRIORITIES[(i * 5) % PRIORITIES.length]);
  const sent: string[] = [];
  const results = await Promise.allSettled(classes.map((c, i) => call(`c${i}`, c).then((r) => {
    sent.push(`c${i}`);
    return r;
  })));
  const okd = results.filter((r) => r.status === 'fulfilled').length;
  const errs = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map((r) => String(r.reason?.message ?? r.reason));
  eq(okd, 25, `all 25 answered (${errs.slice(0, 3).join('; ')})`);
  if (!LIVE) {
    ok(maxActive <= 3, `in flight at the server at most 3 (${maxActive})`);
    ok(maxLow <= 2, `low classes in flight at most 2 (${maxLow})`);
    eq(rejected, 0, 'no 503 from the server');
    const took = Date.now() - t0;
    ok(took > 2000 * 1.5, `the last call waited longer than MC_OLLAMA_TIMEOUT at the gate and was answered (${took} ms in all, timeout 2000 ms from the send)`);
    const waits = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof call>>> => r.status === 'fulfilled').map((r) => r.value.waitMs);
    ok(Math.max(...waits) > 2000, `the longest gate wait (${Math.max(...waits)} ms) is over the call timeout`);
    // The body as completeOllama sends it (the extraction moved it unchanged)
    const b = bodies[0] as Record<string, unknown>;
    eq(Object.keys(b), ['model', 'stream', 'think', 'keep_alive', 'options', 'messages', 'tools'], 'body fields in order');
    eq([b.model, b.stream, b.think, b.keep_alive, b.options], ['x-cloud', false, false, '30m', { num_ctx: 8192, temperature: 0.4 }], 'body values');
    eq((b.messages as unknown[]).length, 2, 'system and user messages');
    eq(b.tools, [{ type: 'function', function: { name: 'chat', description: 'Say something', parameters: TOOL.input_schema } }], 'tools in Ollama\'s form');
    const first = results[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof call>>>;
    eq([first.value.reply.calls, first.value.reply.promptTokens, first.value.reply.outputTokens], [[{ name: 'chat', input: { message: 'ok c0' } }], 10, 2], 'the reply parsed');
  }
  const s = gate.stats();
  eq([s.keys['ollama-cloud'].inFlight, s.keys['ollama-cloud'].queued], [0, 0], 'the gate is empty after');
  ok(s.keys['ollama-cloud'].maxInFlight <= 3, 'the gate held at most 3 in flight');
  quiet(`[gate] ${gate.line()}`);
}

if (!LIVE) {
  // --- 3. Withdrawal: by maxWaitMs and by the caller's signal; never sent, billed nothing
  {
    const before = new Set(seen);
    const busy = [0, 1, 2].map((i) => call(`busy${i}`, 'exec', { delay: 800 }));
    await new Promise((r) => setTimeout(r, 50));
    const ac = new AbortController();
    const w1 = call('w1', 'chronicle', { maxWaitMs: 100 }).catch((e) => e);
    const w2 = call('w2', 'exec', { signal: ac.signal }).catch((e) => e);
    setTimeout(() => ac.abort(), 100);
    const [e1, e2] = await Promise.all([w1, w2]);
    await Promise.all(busy);
    ok(e1 instanceof CallWithdrawn && e2 instanceof CallWithdrawn, `both withdrawn (${e1?.message}; ${e2?.message})`);
    ok(!seen.includes('w1') && !seen.includes('w2'), 'withdrawn calls never reached the server');
    eq([...new Set(seen)].filter((x) => !before.has(x)).sort(), ['busy0', 'busy1', 'busy2'], 'only the others did');
    const r = usage.report({ agents: ['Aw1', 'Aw2'] });
    eq([r.total.withdrawn, r.total.calls, r.total.promptTokens], [2, 0, 0], 'recorded as withdrawn, nothing billed');
  }
  // --- 4. Fallback: cut off at fallbackMs from the send, the slot freed at once
  {
    const t0 = Date.now();
    const f = await call('f1', 'decision', { fallbackMs: 200, delay: 1500 }).catch((e) => e);
    ok(f instanceof CallFallback, `a fallback (${f?.message})`);
    ok(Date.now() - t0 < 1000, `cut off near 200 ms (${Date.now() - t0} ms)`);
    eq(usage.report({ agents: ['Af1'] }).total.fallback, 1, 'recorded as fallback');
    eq(gate.stats().keys['ollama-cloud'].inFlight, 0, 'its slot is free');
  }
  // --- 5. A refusal gives the slot back
  {
    usage.setBudget(1);
    usage.record({ model: 'x-cloud', agent: 'Z', kind: 'exec', promptTokens: 5, outputTokens: 0, ms: 1 });
    console.log = () => {};
    const r = await call('r1', 'exec').catch((e) => e);
    console.log = quiet;
    ok(r instanceof BudgetExceeded, 'refused by the budget');
    ok(!seen.includes('r1'), 'never sent');
    eq([gate.stats().keys['ollama-cloud'].inFlight, gate.stats().keys['ollama-cloud'].queued], [0, 0], 'no slot kept');
    usage.setBudget(null);
  }
}

server.close();
console.log(`${checks - failures}/${checks} checks passed${LIVE ? ' (LIVE: gpt-oss:120b-cloud)' : ''}`);
process.exit(failures ? 1 : 0);
