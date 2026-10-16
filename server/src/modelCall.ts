/**
 * Every model call (phase E, E.0): the providers (Ollama, local or cloud, and Anthropic), what their replies are made
 * into, the usage ledger's accounting (modelUsage.ts), and the call gate that keeps cloud calls within the account's
 * parallel slots. World-free: brains call it with a prompt; it imports only the world's types, the ledger and the
 * Anthropic SDK.
 *
 * Settings (read once, when the module loads):
 *   MC_OLLAMA_URL       default http://localhost:11434
 *   MC_OLLAMA_ROUTES    models served by other Ollama instances, "model=url,model=url" (see scripts/ollama_exec.py)
 *   MC_OLLAMA_CTX       context length of local models, default 8192
 *   MC_OLLAMA_TIMEOUT   seconds one Ollama call may take once sent, default 300
 *   MC_CALL_SLOTS       calls in flight per gate key, default "ollama-cloud=3,anthropic=4" (Ollama Cloud Pro runs 3 at
 *                       once and queues a few more, A.0b); 0 lets a key through ungated. The gate is per process: the test
 *                       world's agent server beside the main one, or parallel staged runs, on one account can put twice
 *                       as many calls in flight (give each its share then).
 *
 * The gate: Ollama's cloud models share the key "ollama-cloud" and Claude has "anthropic"; local models are never gated
 * (each pinned server has its own OLLAMA_NUM_PARALLEL). A call waits for a slot before it is sent (so the Ollama timeout
 * runs from the send), in priority order (PRIORITIES), first come first served within one. The low classes (ballots,
 * reflections, the chronicle) share at most all slots but one, so one is always left for human replies, plans and
 * designs, executor turns and decisions. A call still waiting after its maxWaitMs is withdrawn unsent (CallWithdrawn,
 * billed nothing); one sent with a fallbackMs is cut off at that time from the send (CallFallback), its caller then runs
 * its fixed order. The budget is checked once a slot is taken (a refused call gives it back at once).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { ToolDef } from './world';
import { usage, isCloudModel, thinkFor, type CallKind, type ReasoningLevel } from './modelUsage';

export const OLLAMA_URL = process.env.MC_OLLAMA_URL ?? 'http://localhost:11434';
/** Models served by another Ollama instance: MC_OLLAMA_ROUTES="model=url,model=url". */
export const OLLAMA_ROUTES = new Map(
  (process.env.MC_OLLAMA_ROUTES ?? '').split(',').map((r) => r.trim()).filter((r) => r.includes('='))
    .map((r) => [r.slice(0, r.indexOf('=')).trim(), r.slice(r.indexOf('=') + 1).trim().replace(/\/$/, '')] as [string, string]),
);
const ollamaUrl = (model: string) => OLLAMA_ROUTES.get(model) ?? OLLAMA_URL;
export const OLLAMA_CTX = Number(process.env.MC_OLLAMA_CTX ?? 8192);
/** How long one local model call may take (MC_OLLAMA_TIMEOUT, seconds): a 27B planner can queue behind another agent's call. */
const OLLAMA_TIMEOUT_MS = Number(process.env.MC_OLLAMA_TIMEOUT ?? 300) * 1000;

// ---------------------------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------------------------

export interface ModelSpec { provider: 'ollama' | 'anthropic'; model: string }
export interface ToolCall { name: string; input: Record<string, unknown> }
export interface Reply { calls: ToolCall[]; text: string; promptTokens?: number; outputTokens?: number; loadMs?: number; thinking?: string }

export function parseSpec(s: string | undefined): ModelSpec | null {
  if (!s || s === 'none') return null;
  const i = s.indexOf(':');
  const head = i > 0 ? s.slice(0, i) : '';
  if (head === 'ollama' || head === 'anthropic') return { provider: head, model: s.slice(i + 1) };
  return { provider: s.startsWith('claude-') ? 'anthropic' : 'ollama', model: s };
}

export const label = (s: ModelSpec) => `${s.provider}:${s.model}`;

let anthropic: Anthropic | null = null;

/** The level reaches Ollama's reasoning models only (thinkFor); Claude keeps its own low effort. */
async function complete(spec: ModelSpec, system: string, user: string, tools: ToolDef[], level: ReasoningLevel, signal?: AbortSignal): Promise<Reply> {
  return spec.provider === 'ollama' ? completeOllama(spec.model, system, user, tools, level, signal) : completeAnthropic(spec.model, system, user, tools, signal);
}

/** Cloud models seen replying without eval_count (warned once each). */
const noEvalCount = new Set<string>();

async function completeOllama(model: string, system: string, user: string, tools: ToolDef[], level: ReasoningLevel, signal?: AbortSignal): Promise<Reply> {
  // (the timeout from here: the call is being sent, not waiting at the gate)
  const timeout = AbortSignal.timeout(OLLAMA_TIMEOUT_MS);
  const res = await fetch(`${ollamaUrl(model)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      // (gpt-oss ignores think:false and reasons at medium: it is given a level per call kind instead)
      think: thinkFor(model, level),
      // A model on its own pinned server stays loaded: reloaded after an idle unload, it once came back partly in
      // system RAM (a planner call then took over 3 minutes); the shared app unloads after 30 minutes as before
      keep_alive: OLLAMA_ROUTES.has(model) ? -1 : '30m',
      options: { num_ctx: OLLAMA_CTX, temperature: 0.4 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    }),
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    message?: { content?: string; thinking?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
    prompt_eval_count?: number;
    eval_count?: number;
    load_duration?: number;
  };
  // Ollama silently drops the start of prompts that overflow a local model's context window (the cloud ignores num_ctx)
  if (!isCloudModel(model) && (data.prompt_eval_count ?? 0) > OLLAMA_CTX * 0.9) console.warn(`[tiered] ${model}: prompt used ${data.prompt_eval_count}/${OLLAMA_CTX} tokens; raise MC_OLLAMA_CTX`);
  if (isCloudModel(model) && data.eval_count === undefined && !noEvalCount.has(model)) {
    noEvalCount.add(model);
    console.warn(`[tiered] ${model}: the reply carries no eval_count; output tokens and the budget undercount`);
  }
  const text = data.message?.content ?? '';
  const calls: ToolCall[] = (data.message?.tool_calls ?? []).map((c) => ({ name: c.function.name, input: toArgs(c.function.arguments) }));
  return {
    calls: calls.length ? calls : callsFromText(text), text, promptTokens: data.prompt_eval_count, outputTokens: data.eval_count,
    loadMs: (data.load_duration ?? 0) / 1e6, thinking: data.message?.thinking,
  };
}

async function completeAnthropic(model: string, system: string, user: string, tools: ToolDef[], signal?: AbortSignal): Promise<Reply> {
  anthropic ??= new Anthropic();
  const response = await anthropic.beta.messages.create({
    model,
    max_tokens: 4000,
    // Refusal fallback applies to the models that ship safety classifiers; effort is not supported on Haiku 4.5.
    ...(/^claude-(opus-5|fable)/.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    ...(/^claude-(opus|sonnet-5|fable)/.test(model) ? { output_config: { effort: 'low' as const } } : {}),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools: tools as Anthropic.Beta.BetaTool[],
    messages: [{ role: 'user', content: user }],
  }, signal ? { signal } : undefined);
  const u = response.usage;
  const promptTokens = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  if (response.stop_reason === 'refusal') return { calls: [], text: '(request declined)', promptTokens, outputTokens: u.output_tokens };
  const calls: ToolCall[] = [];
  let text = '';
  for (const b of response.content) {
    if (b.type === 'tool_use') calls.push({ name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
    else if (b.type === 'text') text += b.text;
  }
  return { calls, text, promptTokens, outputTokens: u.output_tokens };
}

/**
 * Failures worth trying again soon (rate limits, server errors, a connection lost, a call the gate withdrew unsent): a
 * task is handed back rather than given up. Timeouts are not: a call that ran 300 s will likely run that long again.
 */
export function isTransient(err: unknown): boolean {
  if (err instanceof CallWithdrawn) return true;
  const msg = String((err as Error)?.message ?? err);
  return /^Ollama (429|5\d\d)\b/.test(msg) || ((err as Error)?.name === 'TypeError' && /fetch failed/i.test(msg))
    || [429, 500, 502, 503, 504, 529].includes((err as { status?: number })?.status ?? 0);
}

function toArgs(a: unknown): Record<string, unknown> {
  if (typeof a === 'string') {
    try { return JSON.parse(a) as Record<string, unknown>; } catch { return {}; }
  }
  return (a ?? {}) as Record<string, unknown>;
}

/** Smaller local models sometimes write tool calls as JSON text instead of using the tool-call channel. */
function callsFromText(text: string): ToolCall[] {
  const body = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const start = body.search(/[[{]/);
  if (start < 0) return [];
  try {
    const parsed = JSON.parse(body.slice(start).trim()) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string')
      .map((c) => ({ name: String(c.name), input: toArgs(c.arguments ?? c.parameters ?? c.input) }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// The call gate
// ---------------------------------------------------------------------------------------------

/**
 * Who goes first at the gate: a human's reply, then plans and designs, an executor turn after a failure, a decision, an
 * executor turn, and the low classes (which never take the last slot).
 */
export const PRIORITIES = ['human', 'plan', 'exec_fail', 'decision', 'exec', 'ballot', 'reflection', 'chronicle'] as const;
export type CallPriority = (typeof PRIORITIES)[number];
const LOW = new Set<CallPriority>(['ballot', 'reflection', 'chronicle']);
/** How long a call may wait for a slot before it is withdrawn unsent. */
export const MAX_WAIT_MS: Record<CallPriority, number> = { human: 60000, plan: 120000, exec_fail: 60000, decision: 60000, exec: 60000, ballot: 120000, reflection: 300000, chronicle: 300000 };

/** A call that waited longer than its maxWaitMs for a slot: never sent, billed nothing. */
export class CallWithdrawn extends Error {
  constructor(readonly key: string, readonly waitedMs: number, why = `waited ${Math.round(waitedMs / 1000)} s for a free model slot (${key})`) {
    super(`withdrawn unsent: ${why}`);
    this.name = 'CallWithdrawn';
  }
}

/** A call cut off at its fallbackMs from the send: its caller runs its fixed order. */
export class CallFallback extends Error {
  constructor(readonly afterMs: number) {
    super(`no reply within ${Math.round(afterMs / 1000)} s of sending: the fallback runs`);
    this.name = 'CallFallback';
  }
}

/** "ollama-cloud=3,anthropic=4": slots per key; bad entries are skipped. */
export function parseSlots(s: string | undefined): Map<string, number> {
  const out = new Map<string, number>([['ollama-cloud', 3], ['anthropic', 4]]);
  for (const part of (s ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
    const i = part.lastIndexOf('=');
    const n = Number(part.slice(i + 1));
    if (i > 0 && Number.isFinite(n) && n >= 0) out.set(part.slice(0, i).trim(), Math.floor(n));
    else console.warn(`[gate] MC_CALL_SLOTS: skipped "${part}" (expected key=N)`);
  }
  return out;
}

/** The gate key of a model: by provider, then cloud or not (a claude- model is cloud too, but Anthropic's own); null: ungated. */
export function gateKey(spec: ModelSpec): string | null {
  if (spec.provider === 'anthropic') return 'anthropic';
  return isCloudModel(spec.model) ? 'ollama-cloud' : null;
}

interface Waiter { priority: CallPriority; rank: number; seq: number; since: number; go: () => void }
interface KeyState { inFlight: number; low: number; queue: Waiter[]; maxInFlight: number; maxQueue: number; maxLow: number }
interface ClassStats { calls: number; waits: number[]; withdrawn: number; fallback: number }

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
};

export class CallGate {
  private keys = new Map<string, KeyState>();
  private seq = 0;
  /** Since start (waits: the latest 1,000 of each class), and since the last stats line. */
  private total = new Map<CallPriority, ClassStats>();
  private recent = new Map<CallPriority, ClassStats>();
  private recentKeys = new Map<string, { maxInFlight: number; maxQueue: number }>();

  constructor(private slots: Map<string, number>, private now: () => number = Date.now) {}

  private state(key: string): KeyState {
    let k = this.keys.get(key);
    if (!k) this.keys.set(key, (k = { inFlight: 0, low: 0, queue: [], maxInFlight: 0, maxQueue: 0, maxLow: 0 }));
    return k;
  }

  private stat(cls: CallPriority, f: (s: ClassStats) => void) {
    for (const m of [this.total, this.recent]) {
      let s = m.get(cls);
      if (!s) m.set(cls, (s = { calls: 0, waits: [], withdrawn: 0, fallback: 0 }));
      f(s);
      if (s.waits.length > 1000) s.waits.shift();
    }
  }

  /** How many calls of this key may be in flight; 0 (or a key without slots set): ungated. */
  slotsFor(key: string): number {
    return this.slots.get(key) ?? 0;
  }

  /**
   * A slot for one call: resolves with its release (call it exactly once, in a finally) and how long it waited; rejects
   * with CallWithdrawn after maxWaitMs or when `signal` aborts first. Ungated keys resolve at once.
   */
  acquire(key: string | null, priority: CallPriority, maxWaitMs: number, signal?: AbortSignal): Promise<{ release: () => void; waitMs: number }> {
    const n = key ? this.slotsFor(key) : 0;
    if (!key || n <= 0) return Promise.resolve({ release: () => {}, waitMs: 0 });
    const k = this.state(key);
    const since = this.now();
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const low = LOW.has(priority);
      const w: Waiter = {
        priority, rank: PRIORITIES.indexOf(priority), seq: ++this.seq, since,
        go: () => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          k.inFlight++;
          if (low) k.low++;
          k.maxInFlight = Math.max(k.maxInFlight, k.inFlight);
          k.maxLow = Math.max(k.maxLow, k.low);
          const r = this.recentKeys.get(key) ?? { maxInFlight: 0, maxQueue: 0 };
          r.maxInFlight = Math.max(r.maxInFlight, k.inFlight);
          this.recentKeys.set(key, r);
          const waitMs = this.now() - since;
          this.stat(priority, (s) => { s.calls++; s.waits.push(waitMs); });
          let released = false;
          resolve({
            waitMs,
            release: () => {
              if (released) return;
              released = true;
              k.inFlight--;
              if (low) k.low--;
              this.pump(key);
            },
          });
        },
      };
      const leave = (why?: string) => {
        const i = k.queue.indexOf(w);
        if (i < 0) return;
        k.queue.splice(i, 1);
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.stat(priority, (s) => s.withdrawn++);
        reject(new CallWithdrawn(key, this.now() - since, why));
      };
      const onAbort = () => leave('its caller stopped waiting');
      // In order: by priority, then by arrival
      let i = k.queue.findIndex((q) => q.rank > w.rank);
      if (i < 0) i = k.queue.length;
      k.queue.splice(i, 0, w);
      this.pump(key);
      if (k.queue.includes(w)) {
        k.maxQueue = Math.max(k.maxQueue, k.queue.length);
        const r = this.recentKeys.get(key) ?? { maxInFlight: 0, maxQueue: 0 };
        r.maxQueue = Math.max(r.maxQueue, k.queue.length);
        this.recentKeys.set(key, r);
        timer = setTimeout(() => leave(), Math.max(0, maxWaitMs));
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /** Start every waiter a slot is free for, in queue order; a low class waiting at its cap holds no one behind it. */
  private pump(key: string) {
    const k = this.state(key), n = this.slotsFor(key);
    for (let i = 0; i < k.queue.length && k.inFlight < n; ) {
      const w = k.queue[i];
      if (LOW.has(w.priority) && k.low >= n - 1) {
        i++;
        continue;
      }
      k.queue.splice(i, 1);
      w.go();
    }
  }

  /** A call of this class was cut off by its fallback timer. */
  fellBack(priority: CallPriority) {
    this.stat(priority, (s) => s.fallback++);
  }

  /** Per class: calls given a slot, their wait (p50, p90, max, ms), withdrawn and fallback; per key: slots and the peaks. */
  stats(recent = false) {
    const src = recent ? this.recent : this.total;
    const classes = Object.fromEntries([...src].map(([c, s]) => [c, { calls: s.calls, p50: pct(s.waits, 0.5), p90: pct(s.waits, 0.9), max: s.waits.length ? Math.max(...s.waits) : 0, withdrawn: s.withdrawn, fallback: s.fallback }]));
    const keys = Object.fromEntries([...this.keys].map(([key, k]) => [key, {
      slots: this.slotsFor(key), inFlight: k.inFlight, queued: k.queue.length,
      maxInFlight: recent ? this.recentKeys.get(key)?.maxInFlight ?? 0 : k.maxInFlight,
      maxQueue: recent ? this.recentKeys.get(key)?.maxQueue ?? 0 : k.maxQueue,
      ...(recent ? {} : { maxLow: k.maxLow }),
    }]));
    return { classes, keys };
  }

  /** The `[gate]` line for the time since the last one (and starts the next); null when no call came to the gate. */
  line(): string | null {
    const s = this.stats(true);
    this.recent.clear();
    this.recentKeys.clear();
    const cls = Object.entries(s.classes);
    if (!cls.length) return null;
    const keys = Object.entries(s.keys).filter(([, k]) => k.maxInFlight || k.maxQueue).map(([key, k]) => `${key} in flight max ${k.maxInFlight}/${k.slots}, queue max ${k.maxQueue}`);
    return `${cls.map(([c, x]) => `${c} ${x.calls} wait p50 ${x.p50} p90 ${x.p90} max ${x.max} ms${x.withdrawn ? `, ${x.withdrawn} withdrawn` : ''}${x.fallback ? `, ${x.fallback} fallback` : ''}`).join('; ')}${keys.length ? ` | ${keys.join('; ')}` : ''}`;
  }
}

export const gate = new CallGate(parseSlots(process.env.MC_CALL_SLOTS));

// ---------------------------------------------------------------------------------------------
// Recording and replay
// ---------------------------------------------------------------------------------------------

/**
 * Every successful call is recorded (MC_MODEL_RECORD: a file, or 0 for none; default runs/model-calls/<date>-<pid>.jsonl
 * under MCAI_ROOT or the working directory): a line per call with the agent, kind, model, the call's number for that agent
 * and kind, the prompt's hash, the user prompt and the reply; each system prompt once, by its hash. A recorded run can be
 * replayed (MC_MODEL_REPLAY: the recording's file, several comma-separated): a call is answered from it at once, with no
 * slot, tokens or cost, so a fix can be checked against a model-driven run's own decisions without the models.
 * MC_MODEL_REPLAY_MODE: sequence (default; the Nth call of an agent and kind gets the Nth reply recorded for it, whether or
 * not the prompt is the same: prompts carry positions and times that differ from run to run) or exact (only a prompt
 * recorded word for word, in recorded order). A call with nothing to replay goes to the model. Each replay is logged
 * ([replay] ... prompt same / differs), so where the run left the recording shows in the log.
 */
const RECORD_FILE = ((): string | null => {
  const v = process.env.MC_MODEL_RECORD;
  if (v === '0' || v === 'off') return null;
  if (v) return v;
  const day = new Date().toISOString().slice(0, 10);
  return path.join(process.env.MCAI_ROOT ?? process.cwd(), 'runs', 'model-calls', `${day}-${process.pid}.jsonl`);
})();
const recordedSystems = new Set<string>();
/** Calls so far per agent and kind (recorded or replayed), for the sequence key. */
const callNumbers = new Map<string, number>();
const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

interface Recorded { agent: string; kind: string; model: string; n: number; hash: string; reply: Reply; ms: number }

const REPLAY_MODE = process.env.MC_MODEL_REPLAY_MODE === 'exact' ? 'exact' : 'sequence';
const replay = ((): { bySeq: Map<string, Recorded>; byHash: Map<string, Recorded[]> } | null => {
  const files = (process.env.MC_MODEL_REPLAY ?? '').split(',').map((f) => f.trim()).filter(Boolean);
  if (!files.length) return null;
  const bySeq = new Map<string, Recorded>(), byHash = new Map<string, Recorded[]>();
  let n = 0;
  for (const f of files) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as Recorded & { type?: string };
      if (r.type === 'system') continue;
      bySeq.set(`${r.agent}|${r.kind}|${r.n}`, r);
      byHash.set(r.hash, [...(byHash.get(r.hash) ?? []), r]);
      n++;
    }
  }
  console.log(`[replay] ${n} recorded calls from ${files.join(', ')} (${REPLAY_MODE} mode)`);
  return { bySeq, byHash };
})();
if (RECORD_FILE) {
  try {
    fs.mkdirSync(path.dirname(RECORD_FILE), { recursive: true });
  } catch { /* the first append reports it */ }
}

function promptHash(req: CallRequest): { key: string; sys: string } {
  const sys = hash(req.system);
  return { key: hash(`${req.spec.provider}:${req.spec.model}\n${sys}\n${req.user}\n${req.tools.map((t) => t.name).join(',')}`), sys };
}

/** The recorded reply for this call, if replaying and one fits. */
function replayed(req: CallRequest, n: number, key: string): Recorded | null {
  if (!replay) return null;
  if (REPLAY_MODE === 'exact') {
    const list = replay.byHash.get(key);
    return list?.length ? list.shift()! : null;
  }
  return replay.bySeq.get(`${req.agent}|${req.kind}|${n}`) ?? null;
}

function record(req: CallRequest, n: number, key: string, sys: string, reply: Reply, ms: number) {
  if (!RECORD_FILE) return;
  try {
    let out = '';
    if (!recordedSystems.has(sys)) {
      recordedSystems.add(sys);
      out += `${JSON.stringify({ type: 'system', hash: sys, system: req.system })}\n`;
    }
    out += `${JSON.stringify({ at: Date.now(), agent: req.agent, kind: req.kind, model: label(req.spec), level: req.level, n, hash: key, system: sys, user: req.user, reply, ms })}\n`;
    fs.appendFileSync(RECORD_FILE, out);
  } catch (err) {
    console.warn(`[record] ${RECORD_FILE}: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// One call
// ---------------------------------------------------------------------------------------------

export interface CallRequest {
  spec: ModelSpec;
  system: string;
  user: string;
  tools: ToolDef[];
  level: ReasoningLevel;
  /** Who and what for (the usage ledger), and its place at the gate. */
  agent: string;
  kind: CallKind;
  priority: CallPriority;
  /** Withdrawn unsent after this long at the gate (default MAX_WAIT_MS by priority). */
  maxWaitMs?: number;
  /** Cut off this long after the send (CallFallback); none by default. */
  fallbackMs?: number;
  /** The caller gives up: a waiting call is withdrawn, a sent one aborted. */
  signal?: AbortSignal;
  /** Called when the call leaves the gate and is sent (a brain shows "waiting for a model slot" until then). */
  onSend?: () => void;
}

/** Cloud prompts warned about as too long for a local fallback, by agent and kind (once each). */
const ctxWarned = new Set<string>();

/**
 * One model call: through the gate, checked against the budget, timed from the send and counted in the usage ledger.
 * `ms` is the call's own time (not the wait), `waitMs` the time at the gate. Throws BudgetExceeded (refused, recorded),
 * CallWithdrawn (recorded as withdrawn), CallFallback, or the provider's error (recorded as an error; as withdrawn when the
 * caller's own signal aborted the send).
 */
export async function callModel(req: CallRequest): Promise<{ reply: Reply; ms: number; waitMs: number }> {
  const { spec, agent, kind } = req;
  const seqKey = `${agent}|${kind}`;
  const callNo = (callNumbers.get(seqKey) ?? 0) + 1;
  callNumbers.set(seqKey, callNo);
  const { key, sys } = promptHash(req);
  const hit = replayed(req, callNo, key);
  if (hit) {
    console.log(`[replay] ${agent} ${kind} #${callNo}: replayed (prompt ${hit.hash === key ? 'same' : 'differs'})`);
    req.onSend?.();
    return { reply: hit.reply, ms: 0, waitMs: 0 };
  }
  if (replay) console.log(`[replay] ${agent} ${kind} #${callNo}: nothing recorded; calling ${label(spec)}`);
  // A refusal comes at once, holding no slot (and once more after the wait: the budget may trip meanwhile)
  if (usage.blocked(spec.model, agent)) usage.check(spec.model, agent, kind);
  let slot: { release: () => void; waitMs: number };
  try {
    slot = await gate.acquire(gateKey(spec), req.priority, req.maxWaitMs ?? MAX_WAIT_MS[req.priority], req.signal);
  } catch (err) {
    if (err instanceof CallWithdrawn) usage.error(spec.model, agent, kind, 0, 'withdrawn');
    throw err;
  }
  try {
    usage.check(spec.model, agent, kind);
    req.onSend?.();
    const fallback = req.fallbackMs && req.fallbackMs > 0 ? new AbortController() : null;
    const timer = fallback ? setTimeout(() => fallback.abort(), req.fallbackMs) : undefined;
    const signal = fallback && req.signal ? AbortSignal.any([fallback.signal, req.signal]) : fallback?.signal ?? req.signal;
    const t0 = Date.now();
    let reply: Reply;
    try {
      reply = await complete(spec, req.system, req.user, req.tools, req.level, signal);
    } catch (err) {
      const ms = Date.now() - t0;
      if (fallback?.signal.aborted) {
        usage.error(spec.model, agent, kind, ms, 'fallback');
        gate.fellBack(req.priority);
        throw new CallFallback(req.fallbackMs!);
      }
      // (aborted by its own caller, e.g. a decision dropped while its call ran: withdrawn, not a model error)
      usage.error(spec.model, agent, kind, ms, req.signal?.aborted ? 'withdrawn' : 'error');
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const ms = Date.now() - t0;
    usage.record({ model: spec.model, agent, kind, promptTokens: reply.promptTokens ?? 0, outputTokens: reply.outputTokens ?? 0, ms });
    record(req, callNo, key, sys, reply, ms);
    // The cloud reads a long prompt whole, but a local fallback would cut its start off at num_ctx
    const n = reply.promptTokens ?? 0;
    if (isCloudModel(spec.model) && n > OLLAMA_CTX && !ctxWarned.has(`${agent}|${kind}`)) {
      ctxWarned.add(`${agent}|${kind}`);
      console.warn(`[tiered] ${agent} ${kind}: ${n}-token prompt on ${spec.model}, over the ${OLLAMA_CTX} a local fallback holds (lesson 32)`);
    }
    return { reply, ms, waitMs: slot.waitMs };
  } finally {
    slot.release();
  }
}
