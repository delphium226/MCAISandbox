/**
 * Model usage (phase A, A.0): every model call's tokens, time and outcome, per model, agent and kind, the cost from a
 * price list, and an hourly budget on cloud tokens. Every role runs on a cloud model by default since A.0, so a long
 * run spends real credits; the budget pauses cloud calls (code-posted work goes on) instead of letting a loop spend.
 *
 * Settings (read once, when the module loads):
 *   MC_TOKEN_PRICES       "model=in/out,..." in $ per million tokens, default "gpt-oss:120b-cloud=0.15/0.60"
 *   MC_TOKEN_BUDGET_HOUR  cloud tokens (prompt + output) an hour, default 2,000,000; 0, off, none or empty: no budget
 *   MC_TOKEN_WINDOW_MS    the budget's window, default an hour (tests only)
 *   MC_REASONING          reasoning level per call kind, e.g. "exec=medium,plan=low,design=medium" (the default, from the A.0 benches)
 *
 * The module imports nothing from the project and starts no timers: the budget is evaluated when it is asked about.
 */

export const CALL_KINDS = ['exec', 'plan', 'design'] as const; // A.2 adds 'choose'
export type CallKind = (typeof CALL_KINDS)[number];
export type ReasoningLevel = 'low' | 'medium' | 'high';
export type Reasoning = Record<CallKind, ReasoningLevel>;

const LEVELS: readonly string[] = ['low', 'medium', 'high'];

export const DEFAULT_REASONING: Reasoning = { exec: 'medium', plan: 'low', design: 'medium' };

/** Warnings printed once per distinct text (a bad setting would otherwise repeat on every call). */
const warned = new Set<string>();
function warnOnce(key: string, text: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(text);
}

/**
 * "exec=low,plan=medium" or {exec:'low'}; missing keys from base; unknown keys or levels are ignored with one warning per
 * distinct input; null, undefined or '' give base without a warning.
 */
export function parseReasoning(s: unknown, base: Reasoning = DEFAULT_REASONING): Reasoning {
  const out: Reasoning = { ...base };
  if (s === null || s === undefined || s === '') return out;
  let entries: Array<[string, unknown]>;
  if (typeof s === 'string') entries = s.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return i < 0 ? [p, undefined] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  });
  else if (typeof s === 'object' && !Array.isArray(s)) entries = Object.entries(s as Record<string, unknown>);
  else entries = [['', s]];
  const bad: string[] = [];
  for (const [k, v] of entries) {
    const level = typeof v === 'string' ? v.toLowerCase() : '';
    if ((CALL_KINDS as readonly string[]).includes(k) && LEVELS.includes(level)) out[k as CallKind] = level as ReasoningLevel;
    else bad.push(`${k || '?'}=${String(v)}`);
  }
  if (bad.length) warnOnce(`reasoning:${JSON.stringify(s)}`, `[usage] reasoning setting ${JSON.stringify(s)}: ignored ${bad.join(', ')} (kinds ${CALL_KINDS.join(', ')}; levels ${LEVELS.join(', ')})`);
  return out;
}

export const REASONING: Reasoning = parseReasoning(process.env.MC_REASONING);

const bare = (model: string) => model.replace(/^(ollama|anthropic):/, '');

/** gpt-oss takes a reasoning level; Ollama ignores think:false for it (it reasons anyway, at medium). */
export function isReasoningModel(model: string): boolean {
  return /^gpt-oss/.test(bare(model));
}

/** Billed per token: Ollama Cloud models and Claude. */
export function isCloudModel(model: string): boolean {
  const m = bare(model);
  return /[-:]cloud$/.test(m) || /^claude-/.test(m);
}

/** Ollama's `think` field for a model: the level for gpt-oss, false for the rest. */
export function thinkFor(model: string, level: ReasoningLevel): false | ReasoningLevel {
  return isReasoningModel(model) ? level : false;
}

export interface Price { input: number; output: number } // $ per million tokens

/** "m=0.15/0.60,m2=1/2": split on ',', then on the last '=' (model names hold ':' and may hold '='); bad entries skipped. */
export function parsePrices(s: string): Map<string, Price> {
  const out = new Map<string, Price>();
  for (const entry of s.split(',').map((e) => e.trim()).filter(Boolean)) {
    const i = entry.lastIndexOf('=');
    const name = i > 0 ? bare(entry.slice(0, i).trim()) : '';
    const [inp, outp, ...rest] = i > 0 ? entry.slice(i + 1).split('/').map((x) => Number(x.trim())) : [];
    if (!name || rest.length || !(inp >= 0) || !(outp >= 0)) {
      warnOnce(`price:${entry}`, `[usage] MC_TOKEN_PRICES: skipped "${entry}" (expected model=input/output in $ per million tokens)`);
      continue;
    }
    out.set(name, { input: inp, output: outp });
  }
  return out;
}

const DEFAULT_PRICES = 'gpt-oss:120b-cloud=0.15/0.60';
const DEFAULT_BUDGET = 2_000_000;
const HOUR = 3600000;

/** MC_TOKEN_BUDGET_HOUR: unset 2,000,000; 0, off, none or empty: off (null); anything else unreadable: a warning and 2,000,000. */
export function parseBudget(s: string | undefined): number | null {
  if (s === undefined) return DEFAULT_BUDGET;
  const t = s.trim();
  if (!t || /^(off|none)$/i.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) {
    warnOnce(`budget:${s}`, `[usage] MC_TOKEN_BUDGET_HOUR="${s}" is not a number of tokens; using ${DEFAULT_BUDGET.toLocaleString('en-US')}`);
    return DEFAULT_BUDGET;
  }
  return n === 0 ? null : n;
}

export type Outcome = 'ok' | 'error' | 'refused';
export interface CallRecord { at: number; model: string; agent: string; kind: CallKind; promptTokens: number; outputTokens: number; ms: number; outcome: Outcome }
export interface UsageTotals {
  calls: number; // outcome 'ok' only
  promptTokens: number;
  outputTokens: number;
  maxPromptTokens: number;
  maxOutputTokens: number;
  cost: number; // priced calls only; local calls 0; unpriced cloud calls add 0 and their model goes into `unpriced`
  errors: number;
  refused: number;
}
export interface BudgetState {
  tokensPerHour: number | null; // null = off
  windowMs: number;
  usedInWindow: number; // cloud prompt + output tokens of 'ok' records in the window
  blocked: boolean;
  retryAt: number | null; // when blocked: when usedInWindow will drop below RESUME_FRACTION * limit
  episode: number; // id of the current or last blocked episode (0 = never blocked)
}
export interface UsageSummary {
  since: number; // ledger start (server start)
  now: number;
  total: UsageTotals; // since start
  lastHour: UsageTotals; // trailing hour, always global
  budget: BudgetState; // always global
  byModel: Record<string, UsageTotals>;
  unpriced: string[]; // cloud models seen with no price
}
export interface UsageReport extends UsageSummary {
  byAgent: Record<string, UsageTotals>;
  byKind: Record<string, UsageTotals>;
  byAgentKind: Record<string, Record<string, UsageTotals>>;
  prices: Record<string, Price>;
  partial: boolean;
}

/** Once blocked, calls resume when the window holds less than this share of the limit (no flapping at the edge). */
export const RESUME_FRACTION = 0.8;

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const num = (n: number) => Math.round(n).toLocaleString('en-US');
const kTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export class BudgetExceeded extends Error {
  readonly budget = true;
  constructor(readonly used: number, readonly limit: number, readonly retryAt: number, readonly episode: number) {
    super(`hourly token budget spent: ${num(used)} of ${num(limit)} cloud tokens in the last hour (MC_TOKEN_BUDGET_HOUR); model calls resume at ${hhmm(retryAt)}`);
    this.name = 'BudgetExceeded';
  }
}

const emptyTotals = (): UsageTotals => ({ calls: 0, promptTokens: 0, outputTokens: 0, maxPromptTokens: 0, maxOutputTokens: 0, cost: 0, errors: 0, refused: 0 });

function addRecord(t: UsageTotals, r: CallRecord, cost: number) {
  if (r.outcome === 'error') t.errors++;
  else if (r.outcome === 'refused') t.refused++;
  else {
    t.calls++;
    t.promptTokens += r.promptTokens;
    t.outputTokens += r.outputTokens;
    t.maxPromptTokens = Math.max(t.maxPromptTokens, r.promptTokens);
    t.maxOutputTokens = Math.max(t.maxOutputTokens, r.outputTokens);
    t.cost += cost;
  }
}

function addTotals(t: UsageTotals, o: UsageTotals) {
  t.calls += o.calls;
  t.promptTokens += o.promptTokens;
  t.outputTokens += o.outputTokens;
  t.maxPromptTokens = Math.max(t.maxPromptTokens, o.maxPromptTokens);
  t.maxOutputTokens = Math.max(t.maxOutputTokens, o.maxOutputTokens);
  t.cost += o.cost;
  t.errors += o.errors;
  t.refused += o.refused;
}

const at = <K>(m: Map<K, UsageTotals>, k: K) => {
  let t = m.get(k);
  if (!t) m.set(k, (t = emptyTotals()));
  return t;
};
const toRecord = (m: Map<string, UsageTotals>) => Object.fromEntries([...m].map(([k, t]) => [k, { ...t }]));

/** The totals a set of records adds up to, with every breakdown a report gives. */
class Sums {
  total = emptyTotals();
  byModel = new Map<string, UsageTotals>();
  byAgent = new Map<string, UsageTotals>();
  byKind = new Map<string, UsageTotals>();
  byAgentKind = new Map<string, Map<string, UsageTotals>>();
  /** Agent x model, so a report filtered by agents can still give its models. */
  byAgentModel = new Map<string, Map<string, UsageTotals>>();
  add(r: CallRecord, cost: number) {
    addRecord(this.total, r, cost);
    addRecord(at(this.byModel, r.model), r, cost);
    addRecord(at(this.byAgent, r.agent), r, cost);
    addRecord(at(this.byKind, r.kind), r, cost);
    if (!this.byAgentKind.has(r.agent)) this.byAgentKind.set(r.agent, new Map());
    addRecord(at(this.byAgentKind.get(r.agent)!, r.kind), r, cost);
    if (!this.byAgentModel.has(r.agent)) this.byAgentModel.set(r.agent, new Map());
    addRecord(at(this.byAgentModel.get(r.agent)!, r.model), r, cost);
  }
  /** The same sums for some agents only. */
  only(agents: string[]): Sums {
    const s = new Sums();
    for (const name of new Set(agents)) {
      const t = this.byAgent.get(name);
      if (!t) continue;
      addTotals(s.total, t);
      s.byAgent.set(name, { ...t });
      const kinds = new Map<string, UsageTotals>();
      for (const [k, kt] of this.byAgentKind.get(name) ?? []) {
        kinds.set(k, { ...kt });
        addTotals(at(s.byKind, k), kt);
      }
      s.byAgentKind.set(name, kinds);
      for (const [m, mt] of this.byAgentModel.get(name) ?? []) addTotals(at(s.byModel, m), mt);
    }
    return s;
  }
}

export class UsageLedger {
  readonly since: number;
  private prices: Map<string, Price>;
  private limit: number | null;
  private windowMs: number;
  private retainMs: number;
  private maxRecords: number;
  private now: () => number;
  private sums = new Sums();
  /** Every record, oldest first (records come in time order: the window sums walk back from the end and stop). */
  private log: CallRecord[] = [];
  private head = 0;
  /** The `at` of the newest record pruned from the log (0 while nothing has been). */
  private prunedThrough = 0;
  private isBlocked = false;
  private episode = 0;
  private lastLine: number;

  constructor(opts: { prices?: string; budgetPerHour?: number | null; windowMs?: number; retainMs?: number; maxRecords?: number; now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    this.since = this.now();
    this.lastLine = this.since;
    this.prices = parsePrices(opts.prices ?? DEFAULT_PRICES);
    this.limit = opts.budgetPerHour === undefined ? DEFAULT_BUDGET : opts.budgetPerHour && opts.budgetPerHour > 0 ? opts.budgetPerHour : null;
    this.windowMs = opts.windowMs && opts.windowMs > 0 ? opts.windowMs : HOUR;
    this.retainMs = opts.retainMs ?? 24 * HOUR;
    this.maxRecords = opts.maxRecords ?? 100_000;
  }

  /** Pure test (no record): null for local models, an off budget, or not blocked. */
  blocked(model: string): BudgetExceeded | null {
    if (!isCloudModel(model) || this.limit === null) return null;
    this.evaluate();
    if (!this.isBlocked) return null;
    return new BudgetExceeded(this.windowSum(this.windowMs), this.limit, this.retryAt() ?? this.now() + this.windowMs, this.episode);
  }

  /** Throws (and records a refusal) when the budget refuses this call; local models always pass. */
  check(model: string, agent: string, kind: CallKind): void {
    const b = this.blocked(model);
    if (!b) return;
    this.push({ at: this.now(), model: bare(model), agent, kind, promptTokens: 0, outputTokens: 0, ms: 0, outcome: 'refused' });
    throw b;
  }

  record(r: { model: string; agent: string; kind: CallKind; promptTokens: number; outputTokens: number; ms: number; at?: number }): void {
    this.push({ at: r.at ?? this.now(), model: bare(r.model), agent: r.agent, kind: r.kind, promptTokens: r.promptTokens || 0, outputTokens: r.outputTokens || 0, ms: r.ms, outcome: 'ok' });
    // (a transition is logged as it happens, not at the next poll)
    this.evaluate();
    const now = this.now();
    if (now - this.lastLine >= 15 * 60000) {
      this.lastLine = now;
      const t = this.sums.total, h = this.trailing(HOUR);
      console.log(`[usage] since start: ${kTok(t.promptTokens)} in / ${kTok(t.outputTokens)} out, ${t.calls} calls | last hour: ${kTok(h.promptTokens)} in / ${kTok(h.outputTokens)} out, ${h.calls} calls | ~$${t.cost.toFixed(2)}`);
    }
  }

  /** A failed call: no tokens are known, so costs are a lower bound. */
  error(model: string, agent: string, kind: CallKind, ms = 0): void {
    this.push({ at: this.now(), model: bare(model), agent, kind, promptTokens: 0, outputTokens: 0, ms, outcome: 'error' });
  }

  /** $ for a call: 0 for local models, null for a cloud model with no price. */
  cost(model: string, promptTokens: number, outputTokens: number): number | null {
    const m = bare(model);
    if (!isCloudModel(m)) return 0;
    const p = this.prices.get(m);
    return p ? (promptTokens * p.input + outputTokens * p.output) / 1e6 : null;
  }

  /** Change the budget at run time (tests: POST /api/usage/budget); 0 or null turns it off. */
  setBudget(tokensPerHour: number | null, windowMs?: number): void {
    this.limit = tokensPerHour && tokensPerHour > 0 ? tokensPerHour : null;
    if (windowMs && windowMs > 0) this.windowMs = windowMs;
    this.evaluate();
  }

  summary(): UsageSummary {
    this.evaluate();
    return {
      since: this.since,
      now: this.now(),
      total: { ...this.sums.total },
      lastHour: this.trailing(HOUR),
      budget: this.budgetState(),
      byModel: toRecord(this.sums.byModel),
      unpriced: this.unpriced(this.sums.byModel),
    };
  }

  /** Without `since`, from the totals kept since start; with it, summed from the log (partial if the log is shorter). */
  report(opts: { since?: number; agents?: string[] } = {}): UsageReport {
    this.evaluate();
    let s: Sums;
    let partial = false;
    if (opts.since === undefined) s = opts.agents ? this.sums.only(opts.agents) : this.sums;
    else {
      const since = opts.since;
      const who = opts.agents ? new Set(opts.agents) : null;
      s = new Sums();
      for (let i = this.head; i < this.log.length; i++) {
        const r = this.log[i];
        if (r.at >= since && (!who || who.has(r.agent))) s.add(r, this.costOf(r));
      }
      partial = since < this.since || (this.prunedThrough > 0 && since <= this.prunedThrough);
    }
    const byAgentKind: Record<string, Record<string, UsageTotals>> = {};
    for (const [agent, kinds] of s.byAgentKind) byAgentKind[agent] = toRecord(kinds);
    return {
      since: this.since,
      now: this.now(),
      total: { ...s.total },
      lastHour: this.trailing(HOUR),
      budget: this.budgetState(),
      byModel: toRecord(s.byModel),
      unpriced: this.unpriced(s.byModel),
      byAgent: toRecord(s.byAgent),
      byKind: toRecord(s.byKind),
      byAgentKind,
      prices: Object.fromEntries([...this.prices].map(([m, p]) => [m, { ...p }])),
      partial,
    };
  }

  private costOf(r: CallRecord): number {
    return r.outcome === 'ok' ? this.cost(r.model, r.promptTokens, r.outputTokens) ?? 0 : 0;
  }

  private unpriced(byModel: Map<string, UsageTotals>): string[] {
    return [...byModel].filter(([m, t]) => t.calls > 0 && this.cost(m, 1, 1) === null).map(([m]) => m).sort();
  }

  private push(r: CallRecord) {
    this.sums.add(r, this.costOf(r));
    this.log.push(r);
    const cutoff = this.now() - this.retainMs;
    while (this.head < this.log.length && (this.log.length - this.head > this.maxRecords || this.log[this.head].at < cutoff)) {
      this.prunedThrough = Math.max(this.prunedThrough, this.log[this.head].at);
      this.head++;
    }
    // (compacted now and then rather than shifted on every write)
    if (this.head > 1000 && this.head * 2 > this.log.length) {
      this.log = this.log.slice(this.head);
      this.head = 0;
    }
  }

  /** Every record of the trailing window, all outcomes, all models. */
  private trailing(ms: number): UsageTotals {
    const t = emptyTotals();
    const from = this.now() - ms;
    for (let i = this.log.length - 1; i >= this.head && this.log[i].at > from; i--) addRecord(t, this.log[i], this.costOf(this.log[i]));
    return t;
  }

  /** Cloud tokens of successful calls in the trailing window: what the budget counts. */
  private windowSum(ms: number): number {
    let n = 0;
    const from = this.now() - ms;
    for (let i = this.log.length - 1; i >= this.head && this.log[i].at > from; i--) {
      const r = this.log[i];
      if (r.outcome === 'ok' && isCloudModel(r.model)) n += r.promptTokens + r.outputTokens;
    }
    return n;
  }

  /** When the window will hold less than RESUME_FRACTION of the limit, as its oldest records leave it. */
  private retryAt(): number | null {
    if (this.limit === null) return null;
    const from = this.now() - this.windowMs;
    let i = this.log.length - 1;
    while (i >= this.head && this.log[i].at > from) i--;
    let sum = this.windowSum(this.windowMs);
    for (let k = i + 1; k < this.log.length; k++) {
      const r = this.log[k];
      if (r.outcome !== 'ok' || !isCloudModel(r.model)) continue;
      sum -= r.promptTokens + r.outputTokens;
      if (sum < RESUME_FRACTION * this.limit) return r.at + this.windowMs;
    }
    return null;
  }

  /** Enter or leave a blocked episode (hysteresis: blocked at the limit, free again below RESUME_FRACTION of it). */
  private evaluate() {
    if (this.limit === null) {
      if (this.isBlocked) {
        this.isBlocked = false;
        console.log('[usage] budget free again (the budget is off)');
      }
      return;
    }
    const used = this.windowSum(this.windowMs);
    if (!this.isBlocked && used >= this.limit) {
      this.isBlocked = true;
      this.episode++;
      const retry = this.retryAt();
      console.log(`[usage] hourly budget reached: ${num(used)} of ${num(this.limit)} cloud tokens; model calls resume at ${retry ? hhmm(retry) : '?'}`);
    } else if (this.isBlocked && used < RESUME_FRACTION * this.limit) {
      this.isBlocked = false;
      console.log('[usage] budget free again');
    }
  }

  private budgetState(): BudgetState {
    return {
      tokensPerHour: this.limit,
      windowMs: this.windowMs,
      usedInWindow: this.windowSum(this.windowMs),
      blocked: this.isBlocked,
      retryAt: this.isBlocked ? this.retryAt() : null,
      episode: this.episode,
    };
  }
}

export const usage = new UsageLedger({
  prices: process.env.MC_TOKEN_PRICES ?? DEFAULT_PRICES,
  budgetPerHour: parseBudget(process.env.MC_TOKEN_BUDGET_HOUR),
  windowMs: Number(process.env.MC_TOKEN_WINDOW_MS) || HOUR,
});
