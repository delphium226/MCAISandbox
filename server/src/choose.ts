/**
 * The chooser (phase A, A.2): an idle member of a complete village chooses its next chore from a menu the world builds
 * (mcWorld.ts: choices(), runChoice()). World-free: it imports only the world's types, the model call and the usage
 * ledger. The world drives every decision from its 30 s sweep (spec D1); this module holds what a decision needs apart
 * from the world: the model-mode trim, the seeded shuffle, the prompt and the `choose` tool, the reply's parse, the call
 * itself (choose(), which never throws), the queue that keeps decisions within their share of the cloud slots, and the
 * outcome statistics the guards read (learning progress, bans, the agent cooldown, the rate of model calls).
 *
 * Settings (read once, when the module loads; CHOOSE):
 *   MC_CHOOSE             fixed (default until A.2's exit) or model
 *   MC_CHOICE_INSTANCES   kinds that run as several instances at once, default "explore,start"; empty: single keys
 *   MC_CHOICE_FAMILIES    goal-2 families switched on, default "make,gather,works,light,catalog,furnish,initiatives" (S.9, B.4; X.1's catalogue and furniture since s34; N.0's initiatives since s37); empty: none
 *   MC_CHOOSE_PARALLEL    decisions in flight process-wide, default 2 (one below the gate's 3 cloud slots)
 *   MC_CHOOSE_QUEUE_MS    a decision not started within this gets the fixed pick ('queue'), default 30000
 *   MC_CHOOSE_WAIT_MS     the call's wait for a gate slot before it is withdrawn, default 15000
 *   MC_CHOOSE_FALLBACK_MS the call is cut off this long after the send ('timeout'), default 20000
 *   MC_CHOOSE_MIN_GAP_MS  an agent's model decisions at least this far apart (else 'repeat' or 'rate'), default 90000
 *   MC_CHOOSE_HOURLY      model decisions an agent may make an hour, default 30
 *   MC_CHOOSE_MODEL       the model (else MC_EXEC_MODEL, else gpt-oss:120b-cloud); memory.chooseModel per agent
 */
import type { ChoiceKind, ChoiceMenu, ChoiceOption, FallbackWhy, ToolDef } from './world';
import { callModel, CallFallback, CallWithdrawn, type ModelSpec, type Reply } from './modelCall';
import { usage, BudgetExceeded, isCloudModel, type ReasoningLevel } from './modelUsage';

export const MENU_MAX = 8, PER_KIND_MAX = 2;

export const CHOOSE = {
  mode: (process.env.MC_CHOOSE ?? 'fixed') as 'fixed' | 'model',
  instances: new Set((process.env.MC_CHOICE_INSTANCES ?? 'explore,start').split(',').map((s) => s.trim()).filter(Boolean)),
  /** Goal-2 families switched on (S.9: make, gather, works; B.4: light); empty: none (the golden check, A.8's baselines). */
  families: new Set((process.env.MC_CHOICE_FAMILIES ?? 'make,gather,works,light,catalog,furnish,initiatives').split(',').map((s) => s.trim()).filter(Boolean)),
  /** 2, one below the gate's 3 cloud slots (modelCall.ts:199), so a human reply, a plan or an executor turn always
   *  finds a slot free of decisions (C11). */
  parallel: Number(process.env.MC_CHOOSE_PARALLEL ?? 2),
  queueMs: Number(process.env.MC_CHOOSE_QUEUE_MS ?? 30000),
  waitMs: Number(process.env.MC_CHOOSE_WAIT_MS ?? 15000),
  fallbackMs: Number(process.env.MC_CHOOSE_FALLBACK_MS ?? 20000),
  minGapMs: Number(process.env.MC_CHOOSE_MIN_GAP_MS ?? 90000),
  perHour: Number(process.env.MC_CHOOSE_HOURLY ?? 30),
  model: process.env.MC_CHOOSE_MODEL ?? process.env.MC_EXEC_MODEL ?? 'ollama:gpt-oss:120b-cloud',
};

// ---------------------------------------------------------------------------------------------
// The menu as the model sees it
// ---------------------------------------------------------------------------------------------

const byRank = (a: ChoiceOption, b: ChoiceOption) => a.rank - b.rank;

/**
 * Model-mode trim: per kind the first PER_KIND_MAX by rank; then, over MENU_MAX, each kind's best first (by lp desc then
 * rank asc), the rest of the room by lp desc then rank asc. A plain lp cut hid every workshop option (ranks 850+) behind
 * 8 older options at the same lp (S.9's review, lens 2 M1).
 */
export function trimMenu(options: ChoiceOption[]): ChoiceOption[] {
  const perKind = new Map<string, number>();
  const kept: ChoiceOption[] = [];
  // (N.1: within a kind, a need's weight first, then rank; without needs the rank order as before)
  for (const o of [...options].sort((a, b) => (b.nw ?? 1) - (a.nw ?? 1) || byRank(a, b))) {
    const n = perKind.get(o.kind) ?? 0;
    if (n >= PER_KIND_MAX) continue;
    perKind.set(o.kind, n + 1);
    kept.push(o);
  }
  if (kept.length <= MENU_MAX) return kept;
  // (a missing lp or tw counts as the neutral weight, 1; A.3p: a kind its agent dislikes, tw below DISLIKED, gets no
  // reserved place and competes for the rest of the room)
  const w = (o: ChoiceOption) => (o.lp ?? 1) * (o.tw ?? 1) * (o.nw ?? 1);
  const order = [...kept].sort((a, b) => w(b) - w(a) || a.rank - b.rank);
  const seen = new Set<string>();
  const firsts = order.filter((o) => (o.tw ?? 1) >= DISLIKED && !seen.has(o.kind) && seen.add(o.kind));
  const best = [...firsts, ...order.filter((o) => !firsts.includes(o))].slice(0, MENU_MAX);
  return best.sort(byRank);
}

/** FNV-1a, 32 bits. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded PRNG giving floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates with a seeded PRNG (mulberry32 of FNV-1a(seed)): the same seed gives the same order. */
export function shuffled<T>(xs: T[], seed: string): T[] {
  const out = [...xs];
  const rnd = mulberry32(fnv1a(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A.3p: how much each later kind (in rank order) counts against a temperament's weight in the fixed pick. */
export const KIND_DECAY = 0.85;
/** A.3p: a kind below this weight gets no reserved place in the trim. */
export const DISLIKED = 0.7;
/** A.3p: the prompt's tags: at or above ENJOYED "you enjoy this", at or below DULL "you find this dull". */
const ENJOYED = 1.6, DULL = 0.63;

/**
 * The lowest rank (the first of equals). A.3p, when the options carry temperament weights: a meal of lowest rank first,
 * else the best of tw x KIND_DECAY^(its kind's place among the menu's kinds in rank order), ties by rank; all weights 1
 * gives the lowest rank again.
 */
export function fixedPick(menu: ChoiceMenu): ChoiceOption | undefined {
  let best: ChoiceOption | undefined;
  for (const o of menu.options) if (!best || o.rank < best.rank) best = o;
  if (!best || best.kind === 'eat' || !menu.options.some((o) => o.tw !== undefined || o.nw !== undefined)) return best;
  const place = new Map<string, number>();
  for (const o of [...menu.options].sort(byRank)) if (!place.has(o.kind)) place.set(o.kind, place.size);
  // (N.1: a need's weight beside the temperament's)
  const score = (o: ChoiceOption) => (o.tw ?? 1) * (o.nw ?? 1) * KIND_DECAY ** (place.get(o.kind) ?? 0);
  for (const o of menu.options) {
    const d = score(o) - score(best);
    if (d > 1e-9 || (Math.abs(d) <= 1e-9 && o.rank < best.rank)) best = o;
  }
  return best;
}

const SYSTEM = 'You are a member of a Minecraft village. The village is built; now you choose your next chore yourself. '
  + 'Read the options and their facts, think briefly about what helps the village most and what you do well, and call '
  + '`choose` with a short reason (one sentence) and the exact name of one option. Never invent an option.';
/** A.3p: added when a persona line is shown. */
const SYSTEM_PERSONA = ' Choose as the person described would.';

/** A.3p's tag on an option line, from its temperament weight. */
const tag = (o: ChoiceOption) => (o.tw === undefined ? '' : o.tw >= ENJOYED ? ' [you enjoy this]' : o.tw <= DULL ? ' [you find this dull]' : '');

/** A context line with its label, unless the world wrote the label already. */
const labelled = (label: string, text: string) => (text.toLowerCase().startsWith(label.toLowerCase()) ? text : `${label}: ${text}`);

/** The prompt of section 5.2: the options in the order given (shuffled by the caller), named, never numbered (D7). */
export function buildPrompt(menu: ChoiceMenu, shown: ChoiceOption[]): { system: string; user: string; tools: ToolDef[] } {
  const ctx = menu.ctx;
  const lines: string[] = [];
  if (ctx.persona?.trim()) lines.push(ctx.persona.trim());
  if (ctx.pattern?.trim()) lines.push(ctx.pattern.trim());
  if (ctx.village?.trim()) lines.push(labelled('Village', ctx.village.trim()));
  if (ctx.others?.trim()) lines.push(labelled('Others now', ctx.others.trim()));
  if (ctx.needs?.length) lines.push(`Village needs: ${ctx.needs.join('; ')}`);
  lines.push(`Your last chores: ${ctx.outcomes?.length ? ctx.outcomes.join(' | ') : 'none yet'}`);
  lines.push('Options (in no particular order):');
  for (const o of shown) {
    const facts = o.facts?.trim();
    const effect = o.effect?.trim();
    lines.push(`- ${o.name}${facts ? `: ${facts}` : ''}${effect ? ` (expected: ${effect})` : ''}${o.need ? ` [${o.need}]` : ''}${tag(o)}`);
  }
  lines.push('Call choose with your reason and the exact name of one option.');
  const tools: ToolDef[] = [{
    name: 'choose',
    description: 'Choose your next chore: a one-sentence reason first, then the exact name of one option.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', maxLength: 200, description: 'Why, in one sentence.' },
        choice: { type: 'string', enum: shown.map((o) => o.name), description: 'The exact name of one option.' },
      },
      required: ['reason', 'choice'],
    },
  }];
  return { system: ctx.persona?.trim() ? SYSTEM + SYSTEM_PERSONA : SYSTEM, user: lines.join('\n'), tools };
}

// ---------------------------------------------------------------------------------------------
// The reply
// ---------------------------------------------------------------------------------------------

/** Case, spaces and punctuation folded away. */
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The choice and reason from a call's input: the choose tool's own, or a call wrapping its arguments. */
function fromInput(input: unknown): { choice: string; reason: string } | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  if (typeof o.choice === 'string') return { choice: o.choice, reason: typeof o.reason === 'string' ? o.reason : '' };
  for (const k of ['arguments', 'parameters', 'input']) {
    let inner = o[k];
    if (typeof inner === 'string') {
      try { inner = JSON.parse(inner); } catch { inner = null; }
    }
    const r = inner && inner !== input ? fromInput(inner) : null;
    if (r) return r;
  }
  return null;
}

/**
 * A choice written as text (callModel turns `{"name": "choose", "arguments": ...}` text into a call already): a JSON
 * object with a `choice` field, or the bare name of an option.
 */
function fromText(text: string): { choice: string; reason: string } | null {
  const body = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const start = body.indexOf('{');
  if (start >= 0) {
    const end = body.lastIndexOf('}');
    try {
      const r = fromInput(JSON.parse(body.slice(start, end + 1)));
      if (r) return r;
    } catch {
      // not JSON: the bare name below
    }
  }
  const t = text.trim();
  return t && t.length <= 120 ? { choice: t, reason: '' } : null;
}

/** Exact name, else case/space/punctuation-folded exact, else a unique prefix of >= 12 chars (folded). */
function match(choice: string, shown: ChoiceOption[]): ChoiceOption | { invalid: string } {
  const exact = shown.find((o) => o.name === choice);
  if (exact) return exact;
  const f = fold(choice);
  if (!f) return { invalid: 'an empty choice' };
  const folded = shown.filter((o) => fold(o.name) === f);
  if (folded.length === 1) return folded[0];
  if (folded.length > 1) return { invalid: `"${choice}" matches ${folded.length} options` };
  // (the whole option line copied, "name: facts (expected: effect)": 8 of 330 choicebench replies, s28; the longest name
  // that the line begins with, followed by its colon)
  const line = shown.filter((o) => choice.startsWith(`${o.name}:`)).sort((a, b) => b.name.length - a.name.length);
  if (line.length) return line[0];
  if (f.length >= 12) {
    const pre = shown.filter((o) => fold(o.name).startsWith(f));
    if (pre.length === 1) return pre[0];
    if (pre.length > 1) return { invalid: `"${choice}" begins ${pre.length} options` };
  }
  return { invalid: `"${choice.slice(0, 80)}" is not an option` };
}

/**
 * Exact name, else case/space/punctuation-folded exact, else a unique prefix of >= 12 chars; text replies through
 * modelCall's callsFromText already (choose() goes through callModel, which applies it). The choose call is read first,
 * then any call carrying a choice, then the text. The reason is cut to 200 characters.
 */
export function parseChoice(reply: Reply, shown: ChoiceOption[]): { id: string; reason: string } | { invalid: string } {
  const calls = reply?.calls ?? [];
  const call = calls.find((c) => c.name === 'choose' && fromInput(c.input)) ?? calls.find((c) => fromInput(c.input));
  const got = (call ? fromInput(call.input) : null) ?? (calls.length ? null : fromText(reply?.text ?? ''));
  if (!got) return { invalid: calls.length ? `no choice in the ${calls.map((c) => c.name).join(', ')} call` : 'no choose call' };
  const m = match(got.choice, shown);
  if ('invalid' in m) return m;
  return { id: m.id, reason: got.reason.trim().replace(/\s+/g, ' ').slice(0, 200) };
}

// ---------------------------------------------------------------------------------------------
// One decision
// ---------------------------------------------------------------------------------------------

export interface ChooseRequest {
  agent: string;
  spec: ModelSpec;
  level: ReasoningLevel;
  menu: ChoiceMenu;
  /** The decision id (minted by decide(), C21); the shuffle's seed is `${seed}|${agent}`. */
  seed: string;
  signal?: AbortSignal;
  /** Injected in tests; callModel by default. choicebench uses the default (C19). */
  call?: typeof callModel;
}
export interface ChooseResult {
  id: string | null;
  why?: FallbackWhy;
  reason: string;
  shown: string[];
  prompt: string;
  latencyMs: number;
  waitMs: number;
  promptTokens: number;
  outputTokens: number;
}

/** The fallback reason of a failed call (spec 5.1 step 8). */
function whyOf(err: unknown, signal?: AbortSignal): FallbackWhy {
  if (err instanceof CallWithdrawn || signal?.aborted) return 'withdrawn';
  if (err instanceof CallFallback) return 'timeout';
  if (err instanceof BudgetExceeded || (err as { budget?: unknown })?.budget === true) return 'budget';
  if (overQuota(err)) return 'budget';
  return 'error';
}

/** How long decisions leave a model alone after the provider refused for its quota (Ollama 429). */
export const QUOTA_BACKOFF_MS = Number(process.env.MC_CHOOSE_QUOTA_BACKOFF_MS ?? 5 * 60000);
/** Until when each model is left alone (s28: with the account's session limit reached every decision called again at
 *  once and came back 429; the next ones now take the fixed pick without a call). */
const quotaUntil = new Map<string, number>();
function overQuota(err: unknown): boolean {
  return /^Ollama 429\b/.test(String((err as Error)?.message ?? '')) || (err as { status?: number })?.status === 429;
}
/** Forget the back-offs (tests). */
export function clearQuotaBackoff(): void {
  quotaUntil.clear();
}

/**
 * One decision: never throws; id null with why on any failure (budget, withdrawn, timeout, invalid, error). The options
 * are shown shuffled by `${seed}|${agent}`; the budget is checked again here (the world checked it before queueing) and a
 * refusal comes at once, holding no slot. A failure's reason is '' (the world logs 'fixed order' for the pick it runs).
 */
export async function choose(req: ChooseRequest): Promise<ChooseResult> {
  const t0 = Date.now();
  const out: ChooseResult = { id: null, reason: '', shown: [], prompt: '', latencyMs: 0, waitMs: 0, promptTokens: 0, outputTokens: 0 };
  try {
    const shown = shuffled(req.menu.options, `${req.seed}|${req.agent}`);
    if (!shown.length) return { ...out, why: 'invalid' };
    const p = buildPrompt(req.menu, shown);
    out.prompt = p.user;
    // (the degrade levels are the cloud budget's: a local model is never held by them)
    if ((isCloudModel(req.spec.model) && !usage.allows('decisions')) || usage.blocked(req.spec.model, req.agent)) return { ...out, why: 'budget' };
    if ((quotaUntil.get(req.spec.model) ?? 0) > Date.now()) return { ...out, why: 'budget' };
    if (req.signal?.aborted) return { ...out, why: 'withdrawn' };
    // (shown only once it goes to the model: a refusal or a withdrawal unsent showed nothing to anyone)
    out.shown = shown.map((o) => o.id);
    let r: Awaited<ReturnType<typeof callModel>>;
    try {
      r = await (req.call ?? callModel)({
        spec: req.spec, system: p.system, user: p.user, tools: p.tools, level: req.level,
        agent: req.agent, kind: 'choose', priority: 'decision',
        maxWaitMs: CHOOSE.waitMs, fallbackMs: CHOOSE.fallbackMs, signal: req.signal,
      });
    } catch (err) {
      const why = whyOf(err, req.signal);
      const elapsed = Date.now() - t0;
      if (overQuota(err) && !((quotaUntil.get(req.spec.model) ?? 0) > Date.now())) {
        quotaUntil.set(req.spec.model, Date.now() + QUOTA_BACKOFF_MS);
        console.log(`[choose] ${req.spec.model} is over its quota (429): decisions take the fixed order for ${Math.round(QUOTA_BACKOFF_MS / 60000)} min`);
      }
      // (withdrawn at the gate or refused by the budget before the send: never sent, nothing shown)
      if (err instanceof CallWithdrawn || why === 'budget') out.shown = [];
      if (err instanceof CallWithdrawn) out.waitMs = err.waitedMs;
      else if (err instanceof CallFallback) {
        out.latencyMs = err.afterMs;
        out.waitMs = Math.max(0, elapsed - err.afterMs);
      } else out.latencyMs = elapsed;
      if (why === 'error') console.log(`[choose] ${req.agent}: the call failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
      return { ...out, why };
    }
    out.latencyMs = r.ms;
    out.waitMs = r.waitMs;
    out.promptTokens = r.reply.promptTokens ?? 0;
    out.outputTokens = r.reply.outputTokens ?? 0;
    const c = parseChoice(r.reply, shown);
    if ('invalid' in c) {
      const raw = r.reply.calls.length ? JSON.stringify(r.reply.calls) : r.reply.text;
      console.log(`[choose] ${req.agent}: invalid reply (${c.invalid}): ${String(raw).replace(/\s+/g, ' ').slice(0, 200)}`);
      return { ...out, why: 'invalid' };
    }
    return { ...out, id: c.id, reason: c.reason };
  } catch (err) {
    // (anything unforeseen: the decision falls back, nothing escapes into the caller's continuation, D9)
    console.log(`[choose] ${req.agent}: ${String((err as Error)?.stack ?? err).slice(0, 300)}`);
    return { ...out, latencyMs: out.latencyMs || Date.now() - t0, why: 'error' };
  }
}

// ---------------------------------------------------------------------------------------------
// The queue of decisions
// ---------------------------------------------------------------------------------------------

interface Entry {
  agent: string;
  job: (queueWaitMs: number) => Promise<void>;
  onExpire: () => void;
  since: number;
  state: 'queued' | 'running';
  timer?: ReturnType<typeof setTimeout>;
}

const errText = (err: unknown) => String((err as Error)?.stack ?? err).slice(0, 300);

/** At most `parallel` decisions in flight process-wide; FIFO; a job not started within queueMs gets why 'queue'.
 *  The job is passed its queue wait (submit to start) in ms; job and onExpire are called inside try/catch (D9). */
export class ChooserQueue {
  private parallel: number;
  private queueMs: number;
  private now: () => number;
  private queue: Entry[] = [];
  private running = new Set<Entry>();

  constructor(opts: { parallel: number; queueMs: number; now?: () => number }) {
    this.parallel = Math.max(1, Math.floor(opts.parallel) || 1);
    this.queueMs = Math.max(0, opts.queueMs);
    this.now = opts.now ?? Date.now;
  }

  /** Queue a decision; it starts at once when a place is free (the job is called before submit returns). */
  submit(agent: string, job: (queueWaitMs: number) => Promise<void>, onExpire: () => void): void {
    const e: Entry = { agent, job, onExpire, since: this.now(), state: 'queued' };
    this.queue.push(e);
    // (a timer only for one that has to wait; pump() also expires by `now`, which tests may drive)
    if (this.running.size >= this.parallel) e.timer = setTimeout(() => this.expire(e), this.queueMs);
    this.pump();
  }

  /** Remove the agent's queued decisions (true if there were any); a running one ends by its own abort. */
  cancel(agent: string): boolean {
    let n = 0;
    for (const e of [...this.queue]) {
      if (e.agent !== agent) continue;
      this.queue.splice(this.queue.indexOf(e), 1);
      if (e.timer) clearTimeout(e.timer);
      n++;
    }
    return n > 0;
  }

  pending(agent: string): 'queued' | 'running' | null {
    for (const e of this.running) if (e.agent === agent) return 'running';
    return this.queue.some((e) => e.agent === agent) ? 'queued' : null;
  }

  get inFlight(): number {
    return this.running.size;
  }

  /** Not started within queueMs: out of the queue, and its onExpire runs (the world's fixed pick, 'queue'). */
  private expire(e: Entry) {
    const i = this.queue.indexOf(e);
    if (i < 0) return;
    this.queue.splice(i, 1);
    if (e.timer) clearTimeout(e.timer);
    try {
      e.onExpire();
    } catch (err) {
      console.log(`[choice-error] ${e.agent}: on expiry: ${errText(err)}`);
    }
  }

  /** Start queued decisions while places are free, oldest first; one past its time expires instead. */
  private pump() {
    while (this.running.size < this.parallel && this.queue.length) {
      const e = this.queue.shift()!;
      if (e.timer) clearTimeout(e.timer);
      const waited = this.now() - e.since;
      if (waited > this.queueMs) {
        this.queue.unshift(e);
        this.expire(e);
        continue;
      }
      e.state = 'running';
      this.running.add(e);
      let p: Promise<void>;
      try {
        p = Promise.resolve(e.job(waited));
      } catch (err) {
        p = Promise.reject(err);
      }
      p.then(() => this.finish(e), (err) => {
        console.log(`[choice-error] ${e.agent}: ${errText(err)}`);
        this.finish(e);
      });
    }
  }

  private finish(e: Entry) {
    try {
      this.running.delete(e);
      this.pump();
    } catch (err) {
      console.log(`[choice-error] ${e.agent}: ${errText(err)}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------

/**
 * Each chore skill's own count from its done message, anchored on the skill's wording (mcBuild.ts): what it is for, not
 * the running totals, storage contents or storage-full notes the message also carries. null: no count in the message.
 */
const counted = (re: RegExp, zero?: RegExp) => (m: string): number | null => {
  const x = re.exec(m);
  return x ? Number(x[1]) : zero?.test(m) ? 0 : null;
};
const YIELD: Record<string, (m: string) => number | null> = {
  // "harvested 14 ripe wheat at ... (14 wheat, 20 seeds), ..." | "nothing ripe on the farm at ..."
  harvest_farm: counted(/^harvested (\d+) ripe wheat\b/, /^nothing ripe\b/),
  // "harvested 6 pumpkin at ..." | "nothing ripe on the pumpkin farm at ..."
  harvest_slot: counted(/^harvested (\d+) [a-z_]+/, /^nothing ripe\b/),
  // "collected 3 egg, 1 brown_egg from the chicken pen on annex slot 2" | "no eggs in the chicken pen on annex slot 2"
  collect_eggs: (m) => {
    const got = /^collected (.+?) from the chicken pen\b/.exec(m);
    if (got) return [...got[1].matchAll(/(?<!\d)(\d+) [a-z_]*egg\b/g)].reduce((s, x) => s + Number(x[1]), 0);
    return /^no eggs in\b/.test(m) ? 0 : null;
  },
  // "milked the cows on annex slot 1: 2 milk buckets" | "the storage holds 3 milk buckets already"
  milk_cows: counted(/^milked the cows on annex slot \d+: (\d+) milk bucket/, /^the storage holds \d+ milk buckets already/),
  // "fed 2 cows wheat in the pen on annex slot 1: 1 young born, 3 in the pen" | "...: no young yet" | "... ready to breed of 1"
  // | "... is full (6 of 6)": only young born count
  breed_pen: (m) => counted(/: (\d+) young born\b/)(m) ?? 0,
  // "iron trip: ...; ..., 10 raw iron and 2 coal in all; brought up 4 raw iron, 1 coal; <deposit's text>": the trip's own
  dig_iron: counted(/\bbrought up (\d+) raw iron\b/),
  // "baked a cake from the village storage (...)"
  bake_cake: (m) => (/^baked a cake\b/.test(m) ? 1 : null),
  // "made a bucket (...); ..."
  make_iron_tool: (m) => (/^made an? [a-z_]+/.test(m) ? 1 : null),
  // S.9's workshop: "made 16 torch (...); put into storage: ..."
  make: counted(/^made (\d+) [a-z_]+/),
  // B.4: "lit 5 torch spots in the library (...)" | "lit 0 torch spots ..." (only skips)
  put_up_torches: counted(/^lit (\d+) torch/),
  // s30's appetite: "ate 1 bread from the village storage (appetite 9 -> 14 of 20)"
  eat_meal: counted(/^ate (\d+) [a-z_]+/),
  // X.1's furnishing: "furnished 3 of 4 spots in the house (...)" | "furnished 0 of 2 ..." (only skips)
  furnish: counted(/^furnished (\d+)/),
};

/** Items a skill's carried gain is judged by when its message gives no count. */
const YIELD_ITEMS: Record<string, RegExp> = {
  harvest_farm: /wheat|seeds/, harvest_slot: /carrot|potato|beetroot|pumpkin|melon|sugar_cane|seeds/, collect_eggs: /egg/, milk_cows: /milk/,
  dig_iron: /raw_iron|iron_ore/,
};

/** Wordings of nothing gained, for skills without a parser above (read on the message before its first note). */
const NOTHING = /nothing ripe|no eggs|adults? ready to breed|pen on annex slot \d+ is full|holds 3 milk buckets already|another worker|no mine|(?<!\d)0 (adults|young|eggs?|raw)\b/i;

/**
 * Whether a chore gave what it is for (spec 7.2, C13), from its own result, never from the storage (other chores'
 * deposits show there): harvests, pen work, the cake and iron by the count in the skill's own done message (YIELD; the
 * agent's carried gain where the message gives none), starts, the annex and pens by success, explore by the ring point's
 * land; S.9's works plot by success and gathering by its deposit (the world passes the deposit's own message, which
 * lands a partial collect's load too). Pure (scripts/checks/choose_unit.mts checks it on the skills' real messages).
 */
export function choreProductive(kind: ChoiceKind | undefined, skill: string, ok: boolean, message: string, carried: Record<string, number> | null, known?: number): boolean {
  if (!ok) return false;
  if (kind === 'explore') return (known ?? 0) >= 0.1;
  if (kind === 'start' || kind === 'annex' || kind === 'pen' || kind === 'cake' || kind === 'works') return true;
  if (kind === 'gather') return /^deposited [1-9]/.test(message);
  const parse = YIELD[skill];
  if (parse) {
    const n = parse(message);
    if (n !== null) return n > 0;
    const re = YIELD_ITEMS[skill];
    if (re && carried) return Object.entries(carried).some(([item, d]) => d > 0 && re.test(item));
    return true;
  }
  const head = message.split(' (')[0];
  return !NOTHING.test(head);
}

export interface ChoiceOutcome {
  village: string; agent: string; kind: ChoiceKind; id: string; ok: boolean; cut: boolean; contention: boolean;
  productive: boolean; minutes: number; at: number; line: string;
}

const MIN = 60000;
const HOUR = 60 * MIN;
/** Ends kept per village (the guards look back an hour or two; the facts a few ends). */
const KEEP = 2000;

/** Outcomes per village, agent, kind and option id since the server started (E.2 persists them). */
export class ChoiceStats {
  private ends = new Map<string, ChoiceOutcome[]>();
  private calls = new Map<string, number[]>();

  record(e: ChoiceOutcome): void {
    let list = this.ends.get(e.village);
    if (!list) this.ends.set(e.village, (list = []));
    list.push({ ...e });
    if (list.length > KEEP) list.splice(0, list.length - KEEP);
  }

  /** One agent's last `n` chore ends in a village, newest last (s34: the panel's Memory tab). */
  agentHistory(village: string, agent: string, n = 30): ChoiceOutcome[] {
    return this.list(village).filter((e) => e.agent === agent).slice(-n);
  }

  private list(village: string): ChoiceOutcome[] {
    return this.ends.get(village) ?? [];
  }

  /** The agent's own ends of a kind, cut and contention ends left out: how many, how many ok, and the mean minutes. */
  agentKind(village: string, agent: string, kind: ChoiceKind): { n: number; ok: number; minutes: number } | null {
    let n = 0, ok = 0, minutes = 0;
    for (const e of this.list(village)) {
      if (e.agent !== agent || e.kind !== kind || e.cut || e.contention) continue;
      n++;
      if (e.ok) ok++;
      minutes += e.minutes;
    }
    return n ? { n, ok, minutes: minutes / n } : null;
  }

  /** The village's last end of a kind (`id`: of that option only; make's and gather's ids are goods and materials). */
  villageLast(village: string, kind: ChoiceKind, id?: string): { at: number; ok: boolean; line: string } | null {
    const list = this.list(village);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === kind && (id === undefined || list[i].id === id)) return { at: list[i].at, ok: list[i].ok, line: list[i].line };
    return null;
  }

  /** A.3p: the kinds of the agent's last n ends (eating and cut ends left out), most first, ties by the latest. */
  kindCounts(village: string, agent: string, n: number): Array<{ kind: ChoiceKind; n: number }> {
    const counts = new Map<ChoiceKind, { n: number; last: number }>();
    const list = this.list(village);
    let seen = 0;
    for (let i = list.length - 1; i >= 0 && seen < n; i--) {
      const e = list[i];
      if (e.agent !== agent || e.kind === 'eat' || e.cut) continue;
      seen++;
      const c = counts.get(e.kind);
      if (c) c.n++;
      else counts.set(e.kind, { n: 1, last: i });
    }
    return [...counts.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last).map(([kind, c]) => ({ kind, n: c.n }));
  }

  /** The agent's last n end lines, oldest first. */
  outcomes(village: string, agent: string, n: number): string[] {
    const out: string[] = [];
    const list = this.list(village);
    for (let i = list.length - 1; i >= 0 && out.length < n; i--) if (list[i].agent === agent) out.push(list[i].line);
    return out.reverse();
  }

  /**
   * LP of section 7.2, 0..1: over the kind's last 6 ends that were neither cut nor contention, |mean(productive, last 3)
   * - mean(productive, the 3 before)|; 0.5 with fewer than 6. An option's weight `lp` is 0.5 + this (0.5..1.5).
   */
  learningProgress(village: string, kind: ChoiceKind): number {
    const o: number[] = [];
    const list = this.list(village);
    for (let i = list.length - 1; i >= 0 && o.length < 6; i--) {
      const e = list[i];
      if (e.kind === kind && !e.cut && !e.contention) o.push(e.productive ? 1 : 0);
    }
    if (o.length < 6) return 0.5;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.abs(mean(o.slice(0, 3)) - mean(o.slice(3, 6)));
  }

  /**
   * Until when this option id is banned (per id, or the whole kind when failures span 2+ ids by 2+ agents), section 7.3:
   * 3 failed ends (not cut, no contention code) within 60 min take it off until 60 min after the third. Explore is exempt
   * (its ring points are one-shot), and so is eating (s30: a peckish member may claim nothing while storage holds food, so a
   * banned or cooling meal left it with neither, the food fix review's M1); make, gather, light and furnish (X.1) are banned per id only (their ids are goods, materials and
   * parts, unrelated to each other, S.9, B.4). null: not banned; `scope` 'kind' when the kind's ban lasts at least as long
   * as the id's.
   */
  banned(village: string, kind: ChoiceKind, id: string, now: number): { until: number; scope: 'id' | 'kind' } | null {
    if (kind === 'explore' || kind === 'eat') return null;
    const perId = kind === 'make' || kind === 'gather' || kind === 'light' || kind === 'furnish' || kind === 'initiate' || kind === 'help';
    const fails = this.list(village).filter((e) => e.kind === kind && !e.ok && !e.cut && !e.contention && e.at > now - 2 * HOUR && e.at <= now);
    let own = 0, whole = 0;
    // Per id: any three of its failures within an hour
    const ats = fails.filter((e) => e.id === id).map((e) => e.at).sort((a, b) => a - b);
    for (let i = 2; i < ats.length; i++) if (ats[i] - ats[i - 2] <= HOUR) own = Math.max(own, ats[i] + HOUR);
    // The whole kind: an hour's failures (3 or more) ending at one of them, spanning 2+ ids by 2+ agents
    const all = perId ? [] : [...fails].sort((a, b) => a.at - b.at);
    for (let i = 2; i < all.length; i++) {
      const w = all.filter((e) => e.at > all[i].at - HOUR && e.at <= all[i].at);
      if (w.length >= 3 && new Set(w.map((e) => e.id)).size >= 2 && new Set(w.map((e) => e.agent)).size >= 2) whole = Math.max(whole, all[i].at + HOUR);
    }
    if (whole > now && whole >= own) return { until: whole, scope: 'kind' };
    return own > now ? { until: own, scope: 'id' } : null;
  }

  /** 5 min after the agent's own failure of the kind (not cut, no contention code); `id`: of that option only (make and
   *  gather, as their bans: one failed barrel kept the agent off every make, S.9's review, lens 2 L3). */
  agentCooling(village: string, agent: string, kind: ChoiceKind, now: number, id?: string): boolean {
    if (kind === 'eat') return false;
    return this.list(village).some((e) => e.agent === agent && e.kind === kind && (id === undefined || e.id === id) && !e.ok && !e.cut && !e.contention && e.at > now - 5 * MIN && e.at <= now);
  }

  /** When the agent's last model decision was made (0: never). */
  lastModelAt(agent: string): number {
    const c = this.calls.get(agent);
    return c?.length ? c[c.length - 1] : 0;
  }

  modelCallsLastHour(agent: string, now: number): number {
    return (this.calls.get(agent) ?? []).filter((t) => t > now - HOUR && t <= now).length;
  }

  /** A model decision made (the rate of section 5.1 steps 2-3 counts these). */
  noteModel(agent: string, at: number): void {
    let c = this.calls.get(agent);
    if (!c) this.calls.set(agent, (c = []));
    c.push(at);
    c.sort((a, b) => a - b);
    while (c.length && c[0] <= at - 2 * HOUR) c.shift();
  }
}
