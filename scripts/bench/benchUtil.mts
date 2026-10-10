/**
 * What the model benches share (A.0): the URL a model is served at, the reasoning level a bench sends, a chat call that
 * never throws, and a tally with latency percentiles.
 * Env: OLLAMA_URL (one server for every model), else MC_OLLAMA_ROUTES as the agent server reads it, else the Ollama app;
 * THINK=false|low|medium|high (unset: the brain's level for the call kind, MC_REASONING); N (samples); PEEK=1.
 */
import { OLLAMA_ROUTES } from '../../server/src/tieredBrain';
import { REASONING, thinkFor, isCloudModel, type CallKind, type ReasoningLevel } from '../../server/src/modelUsage';

const warned = new Set<string>();
function warnOnce(key: string, msg: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(msg);
}

/** OLLAMA_URL (explicit) > MC_OLLAMA_ROUTES route > http://127.0.0.1:11434; one stderr warning per local model with no route. */
export function urlFor(model: string): string {
  if (process.env.OLLAMA_URL) return process.env.OLLAMA_URL.replace(/\/$/, '');
  const route = OLLAMA_ROUTES.get(model);
  if (route) return route;
  // (the app may split a local model across both cards and spill it into system RAM: see ollama_exec.py)
  if (!isCloudModel(model)) warnOnce(`route ${model}`, `[bench] ${model} has no route in MC_OLLAMA_ROUTES: asking the Ollama app at 11434`);
  return 'http://127.0.0.1:11434';
}

export const REPEAT = (fallback: number) => Number(process.env.N) || fallback;

/** THINK=false|low|medium|high. Unset: thinkFor(model, REASONING[kind]). THINK=false: false. A level on a
 *  non-gpt-oss model: false, with one stderr warning. */
export function benchThink(model: string, kind: CallKind): false | ReasoningLevel {
  const t = process.env.THINK?.trim().toLowerCase();
  if (!t) return thinkFor(model, REASONING[kind]);
  if (t === 'false' || t === 'off') return false;
  if (t === 'low' || t === 'medium' || t === 'high') {
    const v = thinkFor(model, t);
    if (v === false) warnOnce(`think ${model}`, `[bench] THINK=${t} not sent to ${model}: only gpt-oss takes a reasoning level`);
    return v;
  }
  warnOnce('think', `[bench] THINK=${t} not understood (false, low, medium or high): using the brain's level`);
  return thinkFor(model, REASONING[kind]);
}

/** The think value as reported: gpt-oss reasons at medium when sent false (Ollama ignores false for it). */
function thinkLabel(model: string, think: false | ReasoningLevel): string {
  return think ? think : thinkFor(model, 'medium') ? 'false (gpt-oss ignores it: medium)' : 'off';
}

export function header(bench: string, model: string, kind: CallKind | CallKind[]): void {
  // (a bench sending several kinds names each one's level when they differ: MC_REASONING can set them apart)
  const kinds = Array.isArray(kind) ? kind : [kind];
  const labels = kinds.map((k) => thinkLabel(model, benchThink(model, k)));
  const think = labels.every((l) => l === labels[0]) ? `think=${labels[0]}` : `think ${kinds.map((k, i) => `${k}=${labels[i]}`).join(' ')}`;
  console.log(`\n=== ${bench} ${model} ${think} url=${urlFor(model)} at ${new Date().toISOString()}`);
}

export interface ChatResult {
  ok: boolean; status: number;          // HTTP status; 0 = network error or timeout
  error?: string; ms: number;
  calls: Array<{ name: string; input: any }>; text: string;
  promptTokens: number; outputTokens: number; thinking?: string;
  /** The think value sent, as header() prints it. */
  think: string;
  /** The reply as Ollama sent it (concurrency.mts PEEK reads eval_count from it), when it parsed. */
  raw?: any;
}

/** Tool arguments as an object: a JSON string is parsed, a bad one becomes {}. */
function args(a: unknown): any {
  if (typeof a !== 'string') return a ?? {};
  try {
    return JSON.parse(a);
  } catch {
    return {};
  }
}

/** Never throws: an HTTP error, d.error, a network error or a timeout comes back as ok:false. */
export async function chat(model: string, system: string, user: string,
  tools: Array<{ name: string; description?: string; input_schema: unknown }>,
  opts: { kind: CallKind; temperature?: number; numPredict?: number; timeoutMs?: number }): Promise<ChatResult> {
  const think = benchThink(model, opts.kind);
  const timeoutMs = opts.timeoutMs ?? 300000;
  const t0 = Date.now();
  const failed = (status: number, error: string, raw?: any): ChatResult =>
    ({ ok: false, status, error, ms: Date.now() - t0, calls: [], text: '', promptTokens: 0, outputTokens: 0, think: thinkLabel(model, think), raw });
  try {
    const res = await fetch(`${urlFor(model)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, think,
        // (models on the pinned servers stay loaded, as the brain keeps them: an idle unload once reloaded into system RAM)
        keep_alive: OLLAMA_ROUTES.has(model) ? -1 : '30m',
        options: { num_ctx: 8192, temperature: opts.temperature ?? 0.4, ...(opts.numPredict ? { num_predict: opts.numPredict } : {}) },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.text();
    let d: any;
    try {
      d = JSON.parse(body);
    } catch {
      return failed(res.status, `HTTP ${res.status}: ${body.slice(0, 200) || 'empty reply'}`);
    }
    if (!res.ok || d?.error) return failed(res.status, `HTTP ${res.status}: ${String(d?.error ?? 'no error text').slice(0, 300)}`, d);
    return {
      ok: true, status: res.status, ms: Date.now() - t0,
      calls: (d.message?.tool_calls ?? []).map((c: any) => ({ name: String(c.function?.name ?? ''), input: args(c.function?.arguments) })),
      text: d.message?.content ?? '',
      promptTokens: d.prompt_eval_count ?? 0, outputTokens: d.eval_count ?? 0,
      thinking: d.message?.thinking || undefined,
      think: thinkLabel(model, think), raw: d,
    };
  } catch (e) {
    const err = e as Error;
    return failed(0, err.name === 'TimeoutError' ? `timed out after ${timeoutMs / 1000} s` : `${err.name}: ${err.message}${(err as any).cause?.code ? ` (${(err as any).cause.code})` : ''}`);
  }
}

/** The p-th percentile (0..1) by nearest rank; 0 for none. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
}

export class Tally {
  private n = 0;
  private good = 0;
  private errors = 0;
  // Latency and tokens of answered calls only: a timeout or refusal would say nothing about the model
  private ms: number[] = [];
  private prompt = 0;
  private out = 0;
  private think = '';

  /** r.ok === false counts as a failure. */
  add(r: ChatResult, ok: boolean): void {
    this.n++;
    this.think ||= r.think;
    if (!r.ok) {
      this.errors++;
      return;
    }
    if (ok) this.good++;
    this.ms.push(r.ms);
    this.prompt += r.promptTokens;
    this.out += r.outputTokens;
  }

  line(label: string): string {
    const k = Math.max(1, this.ms.length);
    const s = (ms: number) => (ms / 1000).toFixed(1);
    return `${label}: ${this.good}/${this.n}, errors ${this.errors}, avg ${s(this.ms.reduce((t, x) => t + x, 0) / k)}s (p50 ${s(percentile(this.ms, 0.5))}, p90 ${s(percentile(this.ms, 0.9))}), ~${Math.round(this.prompt / k)} prompt / ${Math.round(this.out / k)} output tokens (avg), think=${this.think || '?'}`;
  }
}

export const PEEK = !!process.env.PEEK;
