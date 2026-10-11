/**
 * Model usage (phase A, A.0): every model call's tokens, time and outcome, per model, agent and kind, the cost from a
 * price list, and an hourly budget on cloud tokens. Every role runs on a cloud model by default since A.0, so a long
 * run spends real credits; the budget pauses cloud calls (code-posted work goes on) instead of letting a loop spend.
 *
 * Settings (read once, when the module loads):
 *   MC_TOKEN_PRICES       "model=in/out,..." in $ per million tokens, default "gpt-oss:120b-cloud=0.15/0.60"
 *   MC_TOKEN_BUDGET_HOUR  cloud tokens (prompt + output) an hour; 0, off, none or empty: no budget. Unset (E.0): the larger
 *                         of 2,000,000 and MC_TOKEN_BUDGET_AGENT_HOUR (default 150,000) times the agents in the world (at
 *                         least MC_TOKEN_BUDGET_AGENTS, default 1)
 *   MC_TOKEN_WINDOW_MS    the budget's window, default an hour (tests only)
 *   MC_REASONING          reasoning level per call kind, e.g. "exec=medium,plan=low,design=medium" (the default, from the A.0 benches)
 *   MC_SPEND_CAP_USD      "month=30,programme=60" (a bare number: the month's): cloud calls stop at that spend, read from the
 *                         spend ledger the agent server keeps (runs/spend); unset: no cap
 *   MC_SPEND_PROGRAMME_START  the date the programme's spend counts from (default: everything recorded)
 *
 * Shares and degrading (E.0): with two or more agents, one that spends twice its fair share of the hourly budget is
 * refused on its own (exempt names are not); as the whole budget nears, kinds of calls stop in order (allows()): the
 * chronicle at 70%, reflections at 80%, acts at 90%, decisions at 100%, each back on below 80% of its threshold.
 *
 * The module imports nothing from the project and starts no timers: the budget is evaluated when it is asked about. The
 * spend ledger's file is written by a sink the agent server sets, and its totals are read back by the server (seedSpend).
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

/** 'withdrawn': queued at the call gate too long and never sent (billed nothing); 'fallback': sent, cut off by its caller's timer. */
export type Outcome = 'ok' | 'error' | 'refused' | 'withdrawn' | 'fallback';
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
  withdrawn: number;
  fallback: number;
}
export interface BudgetState {
  tokensPerHour: number | null; // null = off
  windowMs: number;
  usedInWindow: number; // cloud prompt + output tokens of 'ok' records in the window
  blocked: boolean;
  retryAt: number | null; // when blocked: when usedInWindow will drop below RESUME_FRACTION * limit
  episode: number; // id of the current or last blocked episode (0 = never blocked)
  /** The agents the limit and the shares are counted for, and the agents refused over their share now. */
  agents: number;
  overShare: string[];
  /** The degrade level now (0: everything allowed; DEGRADE_ORDER[0..level-1] are off) and its transitions. */
  degradeLevel: number;
  degradations: Array<{ at: number; level: number; what: string; off: boolean; used: number; limit: number }>;
}
export interface SpendState {
  /** $ this month (local time) and since the programme started, every process's ledger files together. */
  month: number;
  programme: number;
  caps: { month?: number; programme?: number };
  /** When the files were last read (0: never; only this process's calls are counted then). */
  seededAt: number;
}
export interface UsageSummary {
  since: number; // ledger start (server start)
  now: number;
  total: UsageTotals; // since start
  lastHour: UsageTotals; // trailing hour, always global
  budget: BudgetState; // always global
  byModel: Record<string, UsageTotals>;
  unpriced: string[]; // cloud models seen with no price
  spend: SpendState;
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

/**
 * A call refused by the budget. `scope`: the hourly budget ('global'), an agent's share of it ('agent'), or the spending
 * cap ('spend'); episodes are counted per scope (a brain tells the agent once per scope and episode).
 */
export class BudgetExceeded extends Error {
  readonly budget = true;
  constructor(readonly used: number, readonly limit: number, readonly retryAt: number, readonly episode: number, readonly scope: 'global' | 'agent' | 'spend' = 'global', message?: string) {
    super(message ?? `hourly token budget spent: ${num(used)} of ${num(limit)} cloud tokens in the last hour (MC_TOKEN_BUDGET_HOUR); model calls resume at ${hhmm(retryAt)}`);
    this.name = 'BudgetExceeded';
  }
}

/** The spending cap (MC_SPEND_CAP_USD) is reached: cloud calls stop until the month turns (or for good, the programme's). */
export class SpendCapReached extends BudgetExceeded {
  constructor(used: number, limit: number, retryAt: number, episode: number, which: 'month' | 'programme') {
    super(used, limit, retryAt, episode, 'spend', `the ${which}'s spending cap is reached: $${used.toFixed(2)} of $${limit.toFixed(2)} (MC_SPEND_CAP_USD); cloud model calls ${which === 'month' ? `resume when the month turns` : 'stay off until the cap is raised'}`);
    this.name = 'SpendCapReached';
  }
}

/** What the degrade levels turn off, in order (allows()). */
export const DEGRADE_ORDER = ['chronicle', 'reflection', 'acts', 'decisions'] as const;
export type DegradeClass = (typeof DEGRADE_ORDER)[number];
/** The share of the hourly budget at which each goes off. */
const DEGRADE_AT = [0.7, 0.8, 0.9, 1.0];

/** "month=30,programme=60" or a bare number (the month's); null when unset or unreadable (one warning). */
export function parseSpendCap(s: string | undefined): { month?: number; programme?: number } | null {
  if (s === undefined || !s.trim()) return null;
  const out: { month?: number; programme?: number } = {};
  for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
    const i = part.indexOf('=');
    const [k, v] = i < 0 ? ['month', part] : [part.slice(0, i).trim(), part.slice(i + 1).trim()];
    const n = Number(v);
    if ((k === 'month' || k === 'programme') && Number.isFinite(n) && n >= 0) out[k] = n;
    else warnOnce(`spend:${s}`, `[usage] MC_SPEND_CAP_USD="${s}": ignored "${part}" (expected month=N, programme=N or a bare number)`);
  }
  return out.month === undefined && out.programme === undefined ? null : out;
}

/** "2026-10": the month a time falls in, local time. */
export const monthKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const emptyTotals = (): UsageTotals => ({ calls: 0, promptTokens: 0, outputTokens: 0, maxPromptTokens: 0, maxOutputTokens: 0, cost: 0, errors: 0, refused: 0, withdrawn: 0, fallback: 0 });

function addRecord(t: UsageTotals, r: CallRecord, cost: number) {
  if (r.outcome === 'error') t.errors++;
  else if (r.outcome === 'refused') t.refused++;
  else if (r.outcome === 'withdrawn') t.withdrawn++;
  else if (r.outcome === 'fallback') t.fallback++;
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
  t.withdrawn += o.withdrawn;
  t.fallback += o.fallback;
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
  /** The limit follows the agent count (MC_TOKEN_BUDGET_HOUR unset): the larger of the default and perAgent x agents. */
  private auto: boolean;
  private perAgent: number;
  private agentFloor: number;
  private agents = 0;
  private exempted = new Set<string>();
  private mayors = new Set<string>();
  /** Agents refused over their share now, with their episode (counted apart from the global one's). */
  private overShare = new Map<string, number>();
  private shareEpisode = 0;
  private degradeLevel = 0;
  private degradations: BudgetState['degradations'] = [];
  /** The spend ledger: its sink (the agent server's file), the files' totals as last read, and this process's priced calls since. */
  private sink: ((r: CallRecord, usd: number) => void) | null = null;
  private caps: { month?: number; programme?: number } | null;
  private programmeStart: number;
  private seed = { cutoff: 0, monthKey: '', month: 0, programme: 0, at: 0 };
  private sinceSeed: Array<{ at: number; usd: number }> = [];
  private capBlocked: 'month' | 'programme' | null = null;
  private capEpisode = 0;

  constructor(opts: {
    prices?: string; budgetPerHour?: number | null; windowMs?: number; retainMs?: number; maxRecords?: number; now?: () => number;
    perAgent?: number; agentFloor?: number; spendCap?: { month?: number; programme?: number } | null; programmeStart?: number;
  } = {}) {
    this.now = opts.now ?? Date.now;
    this.since = this.now();
    this.lastLine = this.since;
    this.prices = parsePrices(opts.prices ?? DEFAULT_PRICES);
    this.auto = opts.budgetPerHour === undefined;
    this.perAgent = opts.perAgent ?? PER_AGENT;
    this.agentFloor = opts.agentFloor ?? 1;
    this.limit = this.auto ? this.autoLimit() : opts.budgetPerHour && opts.budgetPerHour > 0 ? opts.budgetPerHour : null;
    this.windowMs = opts.windowMs && opts.windowMs > 0 ? opts.windowMs : HOUR;
    this.retainMs = opts.retainMs ?? 24 * HOUR;
    this.maxRecords = opts.maxRecords ?? 100_000;
    this.caps = opts.spendCap ?? null;
    this.programmeStart = opts.programmeStart ?? 0;
  }

  private autoLimit(): number {
    return Math.max(DEFAULT_BUDGET, this.perAgent * Math.max(this.agents, this.agentFloor));
  }

  /**
   * The agents in the world (spawns and removals): the shares, and the limit when it follows them. Mayors are never
   * refused over a share (they make most of a village's planner and design calls; the spec's recommendation).
   */
  setAgents(n: number, mayors: string[] = []): void {
    this.agents = Math.max(0, Math.floor(n));
    this.mayors = new Set(mayors);
    for (const m of this.mayors) this.overShare.delete(m);
    if (this.auto) this.limit = this.autoLimit();
    this.evaluate();
  }

  /** Agents never refused over their share (seeded agents, influencers); the global budget still applies to them. */
  exempt(names: string[]): void {
    this.exempted = new Set(names);
    for (const n of this.exempted) this.overShare.delete(n);
  }

  /** Whether the degrade level lets this kind of call through (everything while the budget is off). */
  allows(cls: DegradeClass): boolean {
    this.evaluate();
    return DEGRADE_ORDER.indexOf(cls) >= this.degradeLevel;
  }

  /**
   * Pure test (no record): null for local models, or nothing refusing the call. With `agent`, its share of the budget is
   * judged too; the spending cap applies even with the budget off.
   */
  blocked(model: string, agent?: string): BudgetExceeded | null {
    if (!isCloudModel(model)) return null;
    const cap = this.capRefusal();
    if (cap) return cap;
    if (this.limit === null) return null;
    this.evaluate();
    if (this.isBlocked) return new BudgetExceeded(this.windowSum(this.windowMs), this.limit, this.retryAt() ?? this.now() + this.windowMs, this.episode);
    return agent ? this.shareRefusal(agent) : null;
  }

  /** Throws (and records a refusal) when the budget refuses this call; local models always pass. */
  check(model: string, agent: string, kind: CallKind): void {
    const b = this.blocked(model, agent);
    if (!b) return;
    this.push({ at: this.now(), model: bare(model), agent, kind, promptTokens: 0, outputTokens: 0, ms: 0, outcome: 'refused' });
    throw b;
  }

  record(r: { model: string; agent: string; kind: CallKind; promptTokens: number; outputTokens: number; ms: number; at?: number }): void {
    this.push({ at: r.at ?? this.now(), model: bare(r.model), agent: r.agent, kind: r.kind, promptTokens: r.promptTokens || 0, outputTokens: r.outputTokens || 0, ms: r.ms, outcome: 'ok' });
    // (a transition is logged as it happens, not at the next poll)
    this.evaluate();
    if (this.limit !== null && isCloudModel(r.model)) this.shareRefusal(r.agent);
    const now = this.now();
    if (now - this.lastLine >= 15 * 60000) {
      this.lastLine = now;
      const t = this.sums.total, h = this.trailing(HOUR);
      console.log(`[usage] since start: ${kTok(t.promptTokens)} in / ${kTok(t.outputTokens)} out, ${t.calls} calls | last hour: ${kTok(h.promptTokens)} in / ${kTok(h.outputTokens)} out, ${h.calls} calls | ~$${t.cost.toFixed(2)}`);
    }
  }

  /**
   * A failed call: no tokens are known, so costs are a lower bound. `outcome`: 'withdrawn' for a call the gate never sent
   * (billed nothing), 'fallback' for one its caller's timer cut off.
   */
  error(model: string, agent: string, kind: CallKind, ms = 0, outcome: 'error' | 'withdrawn' | 'fallback' = 'error'): void {
    this.push({ at: this.now(), model: bare(model), agent, kind, promptTokens: 0, outputTokens: 0, ms, outcome });
  }

  /** The spend ledger's writer: every record, all outcomes, with its $ (the agent server appends it to a file). */
  setSink(fn: ((r: CallRecord, usd: number) => void) | null): void {
    this.sink = fn;
  }

  /**
   * The ledger files' totals, read by the agent server: what was spent this month and in the programme by calls before
   * `cutoff` (every process's). This process's calls from the cutoff on are added from memory, so nothing counts twice.
   */
  seedSpend(s: { cutoff: number; monthKey: string; month: number; programme: number }): void {
    this.seed = { ...s, at: this.now() };
    this.sinceSeed = this.sinceSeed.filter((r) => r.at >= s.cutoff);
  }

  /** $ spent this month and in the programme, with the caps. */
  spend(): SpendState {
    const now = this.now(), key = monthKey(now);
    let month = this.seed.monthKey === key ? this.seed.month : 0, programme = this.seed.programme;
    for (const r of this.sinceSeed) {
      if (monthKey(r.at) === key) month += r.usd;
      if (r.at >= this.programmeStart) programme += r.usd;
    }
    return { month, programme, caps: { ...(this.caps ?? {}) }, seededAt: this.seed.at };
  }

  /** The spending cap's refusal, if reached (logged once a crossing; no hysteresis: a cap is a cap). */
  private capRefusal(): BudgetExceeded | null {
    if (!this.caps) return null;
    const s = this.spend();
    const which = this.caps.month !== undefined && s.month >= this.caps.month ? 'month' : this.caps.programme !== undefined && s.programme >= this.caps.programme ? 'programme' : null;
    if (which !== this.capBlocked) {
      this.capBlocked = which;
      if (which) {
        this.capEpisode++;
        console.log(`[usage] spending cap reached: $${(which === 'month' ? s.month : s.programme).toFixed(2)} of $${this.caps[which]!.toFixed(2)} this ${which} (MC_SPEND_CAP_USD); cloud model calls stop`);
      } else console.log('[usage] spending cap free again');
    }
    if (!which) return null;
    const d = new Date(this.now());
    const next = which === 'month' ? new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() : this.now() + HOUR;
    return new SpendCapReached(which === 'month' ? s.month : s.programme, this.caps[which]!, next, this.capEpisode, which);
  }

  /**
   * An agent's share: with two or more agents, one over twice its fair share of the limit is refused until it is back
   * under RESUME_FRACTION of that (transitions logged as they happen); exempt agents never.
   */
  private shareRefusal(agent: string): BudgetExceeded | null {
    const n = this.agents;
    if (this.limit === null || n < 2 || this.exempted.has(agent) || this.mayors.has(agent)) {
      this.overShare.delete(agent);
      return null;
    }
    const share = (2 * this.limit) / n;
    const used = this.windowSum(this.windowMs, agent);
    let ep = this.overShare.get(agent);
    if (ep === undefined && used >= share) {
      ep = ++this.shareEpisode;
      this.overShare.set(agent, ep);
      console.log(`[usage] ${agent} is over its share: ${num(used)} of ${num(share)} cloud tokens in the last hour (twice a fair share among ${n} agents); its model calls pause`);
    } else if (ep !== undefined && used < RESUME_FRACTION * share) {
      this.overShare.delete(agent);
      console.log(`[usage] ${agent} is back under its share`);
      ep = undefined;
    }
    if (ep === undefined) return null;
    const retry = this.retryAt(share, agent) ?? this.now() + this.windowMs;
    return new BudgetExceeded(used, share, retry, ep, 'agent', `${agent}'s share of the hourly token budget is spent: ${num(used)} of ${num(share)} cloud tokens in the last hour (twice a fair share among ${n} agents, MC_TOKEN_BUDGET_HOUR); its model calls resume at ${hhmm(retry)}`);
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
    this.auto = false;
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
      spend: this.spend(),
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
      spend: this.spend(),
    };
  }

  private costOf(r: CallRecord): number {
    return r.outcome === 'ok' ? this.cost(r.model, r.promptTokens, r.outputTokens) ?? 0 : 0;
  }

  private unpriced(byModel: Map<string, UsageTotals>): string[] {
    return [...byModel].filter(([m, t]) => t.calls > 0 && this.cost(m, 1, 1) === null).map(([m]) => m).sort();
  }

  private push(r: CallRecord) {
    const usd = this.costOf(r);
    this.sums.add(r, usd);
    this.log.push(r);
    if (usd > 0) this.sinceSeed.push({ at: r.at, usd });
    try {
      this.sink?.(r, usd);
    } catch (e) {
      warnOnce(`sink:${(e as Error).message}`, `[usage] the spend ledger could not be written: ${(e as Error).message}`);
    }
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

  /** Cloud tokens of successful calls in the trailing window (one agent's with `agent`): what the budget counts. */
  private windowSum(ms: number, agent?: string): number {
    let n = 0;
    const from = this.now() - ms;
    for (let i = this.log.length - 1; i >= this.head && this.log[i].at > from; i--) {
      const r = this.log[i];
      if (r.outcome === 'ok' && isCloudModel(r.model) && (agent === undefined || r.agent === agent)) n += r.promptTokens + r.outputTokens;
    }
    return n;
  }

  /** When the window will hold less than RESUME_FRACTION of the limit (an agent's share), as its oldest records leave it. */
  private retryAt(limit = this.limit, agent?: string): number | null {
    if (limit === null) return null;
    const from = this.now() - this.windowMs;
    let i = this.log.length - 1;
    while (i >= this.head && this.log[i].at > from) i--;
    let sum = this.windowSum(this.windowMs, agent);
    for (let k = i + 1; k < this.log.length; k++) {
      const r = this.log[k];
      if (r.outcome !== 'ok' || !isCloudModel(r.model) || (agent !== undefined && r.agent !== agent)) continue;
      sum -= r.promptTokens + r.outputTokens;
      if (sum < RESUME_FRACTION * limit) return r.at + this.windowMs;
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
      this.overShare.clear();
      this.degrade(0, 0);
      return;
    }
    const used = this.windowSum(this.windowMs);
    this.degrade(used, this.limit);
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

  /**
   * The degrade level for this use of the limit: up past each DEGRADE_AT threshold, down below RESUME_FRACTION of it;
   * each transition logged and kept (summary().budget.degradations, a run's validity reads it). Limit 0: the budget is off.
   */
  private degrade(used: number, limit: number) {
    const f = limit > 0 ? used / limit : 0;
    let level = this.degradeLevel;
    while (level < DEGRADE_AT.length && f >= DEGRADE_AT[level]) level++;
    while (level > 0 && f < RESUME_FRACTION * DEGRADE_AT[level - 1]) level--;
    if (level === this.degradeLevel) return;
    const up = level > this.degradeLevel;
    const what = (up ? DEGRADE_ORDER.slice(this.degradeLevel, level) : DEGRADE_ORDER.slice(level, this.degradeLevel)).join(', ');
    this.degradeLevel = level;
    this.degradations.push({ at: this.now(), level, what, off: up, used, limit });
    if (this.degradations.length > 50) this.degradations.shift();
    console.log(`[usage] degrade ${level}: ${what} ${up ? 'off' : 'back on'} at ${num(used)} of ${num(limit)}`);
  }

  private budgetState(): BudgetState {
    return {
      tokensPerHour: this.limit,
      windowMs: this.windowMs,
      usedInWindow: this.windowSum(this.windowMs),
      blocked: this.isBlocked,
      retryAt: this.isBlocked ? this.retryAt() : null,
      episode: this.episode,
      agents: this.agents,
      overShare: [...this.overShare.keys()],
      degradeLevel: this.degradeLevel,
      degradations: this.degradations.map((d) => ({ ...d })),
    };
  }
}

/** The per-agent part of the default limit (MC_TOKEN_BUDGET_AGENT_HOUR). */
const PER_AGENT = (() => {
  const n = Number(process.env.MC_TOKEN_BUDGET_AGENT_HOUR ?? 150_000);
  return Number.isFinite(n) && n > 0 ? n : 150_000;
})();

export const usage = new UsageLedger({
  prices: process.env.MC_TOKEN_PRICES ?? DEFAULT_PRICES,
  // (unset: the limit follows the agents, never below the old default)
  budgetPerHour: process.env.MC_TOKEN_BUDGET_HOUR === undefined ? undefined : parseBudget(process.env.MC_TOKEN_BUDGET_HOUR),
  windowMs: Number(process.env.MC_TOKEN_WINDOW_MS) || HOUR,
  agentFloor: Math.max(1, Number(process.env.MC_TOKEN_BUDGET_AGENTS) || 1),
  spendCap: parseSpendCap(process.env.MC_SPEND_CAP_USD),
  programmeStart: process.env.MC_SPEND_PROGRAMME_START ? Date.parse(process.env.MC_SPEND_PROGRAMME_START) || 0 : 0,
});
