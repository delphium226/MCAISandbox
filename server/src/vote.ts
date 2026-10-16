/**
 * Votes (the village's first: the next neighbourhood's house style; spec runs/2026-10-16/s33/spec_vote1.md). World-free:
 * the world prepares the options and the voters' facts and applies the winner (mcWorld.ts); this module holds the
 * ballot's prompt and call (one model call a member, never throws), the temperament-predicted ballot (code's, logged
 * beside the real one, never shown), and the tally.
 *
 * Settings (read once, when the module loads):
 *   MC_VOTE              model (gpt-oss casts each ballot), predicted (each ballot is the temperament's prediction: free,
 *                        for staged runs), off (no votes: growth as before). Unset: per village, model when its members
 *                        choose their chores by model, else predicted.
 *   MC_VOTE_MAX_MS       a vote is tallied after this long at most (default 4 min); MC_BALLOT_FALLBACK_MS a ballot's cut-off
 *   MC_BALLOTS_PARALLEL  ballots of one vote at once (default 2)
 */
import { fnv1a, mulberry32, parseChoice, shuffled } from './choose';
import { CallWithdrawn, callModel, type ModelSpec } from './modelCall';
import { usage, isCloudModel, type ReasoningLevel } from './modelUsage';
import type { Temperament } from './temperament';
import type { ChoiceOption, ToolDef } from './world';

export type VoteMode = 'model' | 'predicted' | 'off';
const rawVote = (process.env.MC_VOTE ?? '').trim().toLowerCase();
/** The setting, if given; else the world decides per village (model when its members choose chores by model, the
 *  critique's M3: the chore mode is per agent, memory.choose). */
export const VOTE_SETTING: VoteMode | null = rawVote === 'model' || rawVote === 'predicted' || rawVote === 'off' ? rawVote : null;
/** Ballots of one vote at once (the gate's low class has 2 of the 3 cloud slots at most: the critique's M2). */
export const BALLOTS_PARALLEL = Number(process.env.MC_BALLOTS_PARALLEL ?? 2);
/** A vote is tallied once every ballot is in or after this long (abstentions for the rest). */
export const VOTE_MAX_MS = Number(process.env.MC_VOTE_MAX_MS ?? 4 * 60000);
/** A ballot's call is cut off this long after its send. */
const BALLOT_FALLBACK_MS = Number(process.env.MC_BALLOT_FALLBACK_MS ?? 30000);

/** One option on a ballot. The features are code's, for the predicted ballot (never shown). */
export interface VoteOption {
  id: string;
  name: string;
  /** One line, <= 200 chars. */
  facts: string;
  /** The status quo (the village's current style). */
  current: boolean;
  /** Never built in this village. */
  novel: boolean;
  /** Mean units a house (the cost). */
  units: number;
  /** Mean house volume (width x depth x height): the grandeur. */
  volume: number;
}

export interface Ballot {
  agent: string;
  choice: string | null;
  reason: string;
  /** Why no choice: timeout, invalid, budget, withdrawn, error, late. */
  why?: string;
  predicted: string | null;
  /** 1-based position of the choice as shown; the order shown (option ids). */
  position?: number;
  shown: string[];
  source: 'model' | 'predicted';
  promptTokens?: number;
  outputTokens?: number;
  ms?: number;
}

export interface VoteRecord {
  id: string;
  topic: 'style';
  /** The neighbourhood it decides (growth's next layout number). */
  k: number;
  at: number;
  mode: VoteMode;
  options: Array<{ id: string; name: string; facts: string }>;
  ballots: Ballot[];
  tally: Record<string, number>;
  winner: string;
  tie?: string[];
  closedAt?: number;
}

// ---------------------------------------------------------------------------------------------
// The style options (the first topic): one biome's small houses
// ---------------------------------------------------------------------------------------------

/** Each house style's name and look, in words (the designs are re-wooded to the village's wood). */
export const STYLE_LOOK: Record<string, { name: string; look: string }> = {
  plains: { name: 'Plains cottages', look: 'cottages with cobblestone footings, plank walls on log frames and pitched wooden roofs' },
  savanna: { name: 'Savanna houses', look: 'airy wooden houses on log frames with low roofs and wide windows' },
  snowy: { name: 'Snowy cabins', look: 'snug wooden cabins with steep roofs' },
  desert: { name: 'Desert houses', look: 'sandstone cubes with flat roofs' },
  taiga: { name: 'Taiga houses', look: 'stone and log houses with steep roofs' },
};

/** One house of a style, measured by the world (its bill's units, its size, what gathering its bill asks). */
export interface StyleHouse { name: string; units: number; volume: number; gather: Record<string, number> }

/** A style option from its houses (pure: the world and the ballot bench both use it). */
export function styleOption(biome: string, houses: StyleHouse[], built: number, current: boolean): VoteOption {
  const n = Math.max(1, houses.length);
  const mean = (f: (h: StyleHouse) => number) => houses.reduce((s, h) => s + f(h), 0) / n;
  const gather: Record<string, number> = {};
  for (const h of houses) for (const [k, q] of Object.entries(h.gather)) gather[k] = (gather[k] ?? 0) + q / n;
  const main = Object.entries(gather).filter(([, q]) => q >= 1).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, q]) => `~${Math.round(q)} ${k.replace(/_/g, ' ')}`).join(', ');
  const look = STYLE_LOOK[biome] ?? { name: `${biome[0].toUpperCase()}${biome.slice(1)} houses`, look: `${biome} houses` };
  const units = Math.round(mean((h) => h.units));
  const facts = `${look.look}; ${houses.length} designs; a house costs ~${units} units${main ? ` (${main})` : ''}; `
    + (built ? `${built} neighbourhood${built === 1 ? '' : 's'} of them here` : 'none built here yet');
  return { id: biome, name: look.name, facts: facts.slice(0, 200), current, novel: !built && !current, units, volume: Math.round(mean((h) => h.volume)) };
}

// ---------------------------------------------------------------------------------------------
// The predicted ballot
// ---------------------------------------------------------------------------------------------

/** -1..1 across the options (all equal: 0). */
function spread(xs: number[]): number[] {
  const lo = Math.min(...xs), hi = Math.max(...xs);
  return xs.map((x) => (hi - lo > 1e-9 ? -1 + (2 * (x - lo)) / (hi - lo) : 0));
}

/**
 * The temperament's ballot (spec 3, after the critique's M1 and L2): curiosity x novelty (+1 never built, -1 the current) +
 * sociability x familiarity (+1 the current, 0 the rest) - diligence x cheapness (the easy-going want the cheap set, the
 * hard-working do not mind the dear one) + pride x grandeur (cheapness and grandeur -1..1 across the options); the best,
 * ties by a draw seeded by `seed` (the voter), else option order. Care has no term.
 */
export function predictedChoice(t: Temperament, options: VoteOption[], seed?: string): string | null {
  if (!options.length) return null;
  const novelty = options.map((o) => (o.current ? -1 : o.novel ? 1 : 0));
  const cheap = spread(options.map((o) => -o.units));
  const grand = spread(options.map((o) => o.volume));
  const familiar = options.map((o) => (o.current ? 1 : 0));
  const u = options.map((_, i) => t.curiosity * novelty[i] - t.diligence * cheap[i] + t.pride * grand[i] + t.sociability * familiar[i]);
  const top = Math.max(...u);
  const best = options.filter((_, i) => u[i] >= top - 1e-9);
  return best.length > 1 && seed ? best[Math.floor(mulberry32(fnv1a(`pred|${seed}`))() * best.length)].id : best[0].id;
}

// ---------------------------------------------------------------------------------------------
// The ballot as the model sees it
// ---------------------------------------------------------------------------------------------

const SYSTEM = 'You are a member of a Minecraft village. The village votes on the style of its next neighbourhood of houses; '
  + 'every member has one vote and the most votes win. Read the options and their facts, think briefly about what you want '
  + 'for the village and for yourself, and call `vote` with a one-sentence reason and the exact name of one option. '
  + 'Never invent an option.';
const SYSTEM_PERSONA = ' Vote as the person described would.';

export interface VoterContext {
  /** The persona line ('' when none). */
  persona: string;
  /** The own-pattern line ('' when none). */
  pattern: string;
  /** The voter's own record here, one line. */
  self: string;
  /** The village at a glance, one line. */
  village: string;
}

export function buildBallot(ctx: VoterContext, shown: VoteOption[]): { system: string; user: string; tools: ToolDef[] } {
  const lines: string[] = [];
  if (ctx.persona.trim()) lines.push(ctx.persona.trim());
  if (ctx.pattern.trim()) lines.push(ctx.pattern.trim());
  if (ctx.self.trim()) lines.push(ctx.self.trim());
  if (ctx.village.trim()) lines.push(`Village: ${ctx.village.trim()}`);
  lines.push('The vote: the style of the next neighbourhood. Options (in no particular order):');
  for (const o of shown) lines.push(`- ${o.name}: ${o.facts}${o.current ? ' (the current style)' : ''}`);
  lines.push('Call vote with your reason and the exact name of one option.');
  const tools: ToolDef[] = [{
    name: 'vote',
    description: 'Cast your vote: a one-sentence reason first, then the exact name of one option.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', maxLength: 200, description: 'Why, in one sentence.' },
        choice: { type: 'string', enum: shown.map((o) => o.name), description: 'The exact name of one option.' },
      },
      required: ['reason', 'choice'],
    },
  }];
  return { system: ctx.persona.trim() ? SYSTEM + SYSTEM_PERSONA : SYSTEM, user: lines.join('\n'), tools };
}

/** parseChoice reads `choose` calls and calls carrying a `choice`: the vote tool carries one. */
const asChoice = (o: VoteOption): ChoiceOption => ({ id: o.id, kind: 'grow', key: o.id, holds: [], excludes: [], name: o.name, facts: o.facts, effect: '', rank: 0 });

export interface BallotRequest {
  voteId: string;
  agent: string;
  spec: ModelSpec;
  level: ReasoningLevel;
  options: VoteOption[];
  ctx: VoterContext;
  predicted: string | null;
  signal?: AbortSignal;
  /** Withdrawn unsent after this long at the gate (the vote's remaining time). */
  maxWaitMs?: number;
  /** Injected in tests and benches; callModel by default. */
  call?: typeof callModel;
}

/** One member's ballot by the model; never throws (an abstention with `why` on any failure). */
export async function castBallot(req: BallotRequest): Promise<Ballot & { prompt: string }> {
  const shownOpts = shuffled(req.options, `${req.voteId}|${req.agent}`);
  const out: Ballot & { prompt: string } = { agent: req.agent, choice: null, reason: '', predicted: req.predicted, shown: shownOpts.map((o) => o.id), source: 'model', prompt: '' };
  const t0 = Date.now();
  try {
    const p = buildBallot(req.ctx, shownOpts);
    out.prompt = p.user;
    if ((isCloudModel(req.spec.model) && !usage.allows('decisions')) || usage.blocked(req.spec.model, req.agent)) return { ...out, why: 'budget' };
    const r = await (req.call ?? callModel)({
      spec: req.spec, system: p.system, user: p.user, tools: p.tools, level: req.level,
      agent: req.agent, kind: 'ballot', priority: 'ballot', fallbackMs: BALLOT_FALLBACK_MS, signal: req.signal,
      ...(req.maxWaitMs !== undefined ? { maxWaitMs: Math.max(1000, req.maxWaitMs) } : {}),
    });
    out.ms = r.ms;
    out.promptTokens = r.reply.promptTokens ?? 0;
    out.outputTokens = r.reply.outputTokens ?? 0;
    const c = parseChoice(r.reply, shownOpts.map(asChoice));
    if ('invalid' in c) return { ...out, why: 'invalid', reason: c.invalid.slice(0, 120) };
    return { ...out, choice: c.id, reason: c.reason, position: out.shown.indexOf(c.id) + 1 };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    out.ms = Date.now() - t0;
    const why = req.signal?.aborted ? 'late' : err instanceof CallWithdrawn ? 'withdrawn' : /budget/i.test(msg) ? 'budget'
      : /fallback|timed? ?out/i.test(`${(err as Error)?.name ?? ''} ${msg}`) ? 'timeout' : 'error';
    return { ...out, why, reason: msg.slice(0, 120) };
  }
}

/** The predicted ballot cast as a ballot (MC_VOTE=predicted). */
export function predictedBallot(voteId: string, agent: string, options: VoteOption[], predicted: string | null): Ballot {
  const shown = shuffled(options, `${voteId}|${agent}`).map((o) => o.id);
  return { agent, choice: predicted, reason: 'predicted from its temperament', predicted, shown, source: 'predicted', ...(predicted ? { position: shown.indexOf(predicted) + 1 } : { why: 'none' }) };
}

/**
 * Every member's ballot by the model: in a seeded order (the vote id: the tail of a long queue is not the same members
 * every vote, the critique's M2), `parallel` at a time, each given the time left before `deadline` as its wait. Never
 * throws; a ballot not started by the deadline abstains ('late'). Ballots go into `out` as they come (a vote closed early
 * reads what is in).
 */
export async function castAll(voteId: string, reqs: BallotRequest[], parallel: number, deadline: number, out: Ballot[] = []): Promise<Ballot[]> {
  const order = shuffled(reqs, `order|${voteId}`);
  let next = 0;
  const worker = async () => {
    while (next < order.length) {
      const req = order[next++];
      const left = deadline - Date.now();
      if (left <= 0 || req.signal?.aborted) {
        out.push({ agent: req.agent, choice: null, reason: '', why: 'late', predicted: req.predicted, shown: [], source: 'model' });
        continue;
      }
      const { prompt: _prompt, ...b } = await castBallot({ ...req, maxWaitMs: left });
      out.push(b);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));
  return out;
}

// ---------------------------------------------------------------------------------------------
// The tally
// ---------------------------------------------------------------------------------------------

/** Plurality of cast ballots; a tie broken by a seeded draw of the vote id among the tied; no ballot: the current option. */
export function tally(voteId: string, options: VoteOption[], ballots: Ballot[]): { tally: Record<string, number>; winner: string; tie?: string[] } {
  const t: Record<string, number> = Object.fromEntries(options.map((o) => [o.id, 0]));
  for (const b of ballots) if (b.choice && b.choice in t) t[b.choice]++;
  const top = Math.max(...Object.values(t));
  if (top <= 0) return { tally: t, winner: (options.find((o) => o.current) ?? options[0]).id };
  const tied = options.filter((o) => t[o.id] === top).map((o) => o.id);
  if (tied.length === 1) return { tally: t, winner: tied[0] };
  const pick = tied[Math.floor(mulberry32(fnv1a(`tie|${voteId}`))() * tied.length)];
  return { tally: t, winner: pick, tie: tied };
}
