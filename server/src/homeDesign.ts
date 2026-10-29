/**
 * Members design their own houses (#174; spec runs/2026-10-29/homedesign/spec.md, the user's answers in DECISIONS
 * 10-29). World-free, as vote.ts: the world gives a member's facts and the options code found buildable (houseStyle.ts
 * homeOptions), this module holds the prompt, the `design_house` tool, the call (one a member, never throws) and the
 * reply's reading. The picks become a house in houseStyle.ts (fitChoice, chosenHomes); any failure is today's character
 * draw.
 *
 * Settings (read once, when the module loads):
 *   MC_HOME_DESIGN           model (each member's own house from its own call) or character (today's draw; the default)
 *   MC_HOME_DESIGN_WAIT_MS   a street waits this long at most for its members' calls (default 240000), then draws by
 *                            character for the rest
 *   MC_HOME_DESIGN_PARALLEL  a street's calls at once (default 2)
 *   MC_HOME_DESIGN_HOLDOUT   the share of members (by name) kept on the character draw while the flag is model (default 0;
 *                            0.5 for the test train's split)
 */
import { fnv1a, shuffled } from './choose';
import { CallWithdrawn, callModel, type ModelSpec, type Reply } from './modelCall';
import { usage, isCloudModel, type ReasoningLevel } from './modelUsage';
import { FAMILY, HOME_FEATURES, HOME_SIZES, growWalls, type HomeChoice, type HomeFeature, type HomeOptions } from './houseStyle';
import type { ToolDef } from './world';
import { goalFromValues, temperamentWords, valuesLine } from './character';
import { rawSetting } from './settings';

export const HOME_DESIGN = {
  mode: (/^model$/i.test((rawSetting('MC_HOME_DESIGN') ?? 'character').trim()) ? 'model' : 'character') as 'model' | 'character',
  waitMs: Number(rawSetting('MC_HOME_DESIGN_WAIT_MS') ?? 240000),
  parallel: Math.max(1, Number(rawSetting('MC_HOME_DESIGN_PARALLEL') ?? 2)),
  holdout: Number(rawSetting('MC_HOME_DESIGN_HOLDOUT') ?? 0),
};
/** A design call is cut off this long after its send. */
const DESIGN_FALLBACK_MS = 60000;

/** Whether a member is kept on the character draw (the holdout, by a seeded hash of its name). */
export const inHoldout = (member: string) => HOME_DESIGN.holdout > 0 && fnv1a(`${member.trim().toLowerCase()}|homedesign`) / 4294967296 < HOME_DESIGN.holdout;

const GOAL_WORDS: Record<string, string> = { invention: 'inventing new things', beauty: 'making things beautiful', mastery: 'mastering a craft', home: 'a good home', wealth: 'wealth', standing: 'standing among your neighbours' };
/** The character line: the traits, values and life goal character.ts gives the name (what memberStyle reads, whatever
 *  the character flags say). */
export function characterOf(name: string): string {
  const goal = goalFromValues(name);
  return `You are ${temperamentWords(name)}; your life goal is ${GOAL_WORDS[goal] ?? goal}. ${valuesLine(name)}`;
}

/** What the prompt shows a member (the world fills it). */
export interface DesignContext {
  /** The persona line ('' when none). */
  persona: string;
  /** The character the house draw reads (characterOf): traits, values and life goal. */
  character: string;
  /** The member's own record, one line. */
  self: string;
  /** The street's family key (houseStyle FAMILY) and wood. */
  family: string;
  wood?: string;
  /** Each house already chosen or standing in the street, one line each (owner, words, reason). */
  street: string[];
  /** The village's own houses at a glance, one line. */
  village: string;
  options: HomeOptions;
  /** The house budget, and the larger one while the street's larger house is free (`by` when someone holds it). */
  budget: number;
  larger: { budget: number; by?: string };
  /** The member's own stake: when it moves in, and who would wait for a dearer house. */
  stake: string[];
}

const NAMES: Record<string, string> = { planks: 'planks', cobblestone: 'cobblestone', sandstone: 'sandstone', stone_bricks: 'stone bricks', logs: 'logs', none: 'none' };
const word = (s: string) => NAMES[s] ?? s.replace(/_/g, ' ');

/** A family in words ("oak planks walls on a cobblestone base, gable roofs, a log frame, glass panes"). */
export function familyWords(key: string, wood?: string): string {
  const f = FAMILY[key] ?? FAMILY.plains;
  const w = (wood ?? f.wood).replace(/_/g, ' ');
  const walls = f.walls === 'planks' ? `${w} planks` : word(f.walls);
  return `${walls} walls${f.base === 'none' ? '' : ` on a ${word(f.base)} base`}, ${f.roof} roofs of ${f.roof_material === 'planks' ? `${w} planks` : word(f.roof_material)}, ${f.frame === 'none' ? 'no frame' : `a ${word(f.frame).replace(/s$/, '')} frame`}, ${f.windows === 'open' ? 'open windows' : `glass ${f.windows}`}`;
}

/** Each field's values in words, for the street's family. */
function valueWords(field: string, value: string | number | boolean, family: string): string {
  const f = FAMILY[family] ?? FAMILY.plains;
  const dims = (k: keyof typeof HOME_SIZES) => growWalls(HOME_SIZES[k][0], HOME_SIZES[k][1]).join('x');
  switch (field) {
    case 'size': return `${value} (${dims(value as keyof typeof HOME_SIZES)})`;
    case 'shape': return value === 'rect' ? 'rect (a plain rectangle)' : value === 'L' ? 'L (a wing at one end)' : 'T (a wing in the middle)';
    case 'storeys': return value === 2 ? '2 (two storeys)' : '1';
    case 'roof': return value === 'street' ? `street (${f.roof}, as the street)` : `other (${f.roof === 'gable' ? 'hip' : f.roof === 'flat' ? 'hip' : 'gable'})`;
    case 'walls': return value === 'street' ? `street (${word(f.walls)})` : `contrast (${f.walls === 'planks' ? 'cobblestone, mined' : 'planks'})`;
    case 'base': return value === 'street' ? `street (${f.base === 'none' ? 'no base' : word(f.base)})` : 'cobblestone (mined)';
    case 'frame': return value === 'street' ? `street (${f.frame === 'none' ? 'none' : 'log posts'})` : value === 'timber' ? 'timber (log posts and beams; needs a large house, cost beyond it)' : 'none';
    case 'windows': return value === 'rhythm' ? 'rhythm (every other cell)' : value === 'wide' ? 'wide (two-wide windows)' : 'single (one a wall)';
    case 'door': return `${value}`;
    default: return value ? 'yes' : 'no';
  }
}

const FIELD_HELP: Record<string, string> = {
  size: 'size (a rect house; an L or T is 7 or 9 wide, 9 only with a porch and a wide or large size)',
  shape: 'shape', storeys: 'storeys', roof: 'roof', walls: 'walls', base: 'base', frame: 'frame', windows: 'windows',
  door: 'door (where on the front wall; rect only)', porch: 'porch (a roofed porch before the door)',
  chimney: 'chimney (a cobblestone chimney on a side wall)', shutters: 'shutters (wooden shutters beside the windows)',
};

const SYSTEM = 'You are a member of a Minecraft village choosing the design of your own house, which the village will build for you in '
  + 'your street. The options are the ones the builders can make here; costs are in units the village gathers before the house '
  + 'goes up. Call `design_house` once: a one-sentence reason, one value for each field, '
  + 'and your wanted features ranked (if the house is over budget the builders drop the least wanted first). Never invent an option.';

/** The prompt and tool for one member (the values inside each field shuffled by `seed`, as the ballot shuffles). */
export function buildDesignPrompt(ctx: DesignContext, seed: string): { system: string; user: string; tools: ToolDef[] } {
  const lines: string[] = [];
  if (ctx.persona.trim()) lines.push(ctx.persona.trim());
  if (ctx.character.trim()) lines.push(ctx.character.trim());
  if (ctx.self.trim()) lines.push(ctx.self.trim());
  lines.push(`Your street's style: ${familyWords(ctx.family, ctx.wood)}.`);
  if (ctx.street.length) lines.push('Houses in your street so far:', ...ctx.street.map((s) => `- ${s}`));
  else lines.push('Yours is the first house chosen in this street.');
  if (ctx.village.trim()) lines.push(`The village: ${ctx.village.trim()}`);
  lines.push(`A plain house (small, rect, one storey, the street's look, no extras) is ${ctx.options.base} units. Your budget: ${ctx.budget} units.`
    + (ctx.larger.by ? ` The street's one larger house (${ctx.larger.budget} units) is taken by ${ctx.larger.by}.` : ` The street's one larger house (up to ${ctx.larger.budget} units) is still free: set larger to ask for it; the first to ask gets it.`));
  for (const s of ctx.stake) lines.push(s);
  lines.push('The fields (each value with its units over the plain house, alone; the builders check the whole house):');
  // (a field with one value is not a choice: neither shown nor asked)
  const fields = Object.entries(ctx.options.fields).filter(([, vs]) => vs.length > 1);
  for (const [k, vs] of fields) {
    const shown = shuffled(vs, `${seed}|${k}`);
    lines.push(`- ${FIELD_HELP[k] ?? k}: ${shown.map((v) => `${valueWords(k, v.value, ctx.family)} +${v.units}`).join('; ')}`);
  }
  // (shuffled: told in a fixed order, gpt-oss copied it as its ranking, the pilot bench)
  lines.push(`In priority, list only the features you picked, most wanted first (from: ${shuffled([...HOME_FEATURES], `${seed}|priority`).join(', ')}).`);
  lines.push('Call design_house with your reason, one value for each field, and your priority.');
  const props: Record<string, unknown> = { reason: { type: 'string', maxLength: 200, description: 'Why this house, in one sentence.' } };
  for (const [k, vs] of fields) {
    const values = vs.map((v) => v.value);
    props[k] = typeof values[0] === 'boolean' ? { type: 'boolean', ...(values.length === 1 ? { enum: values } : {}) } : { enum: values };
  }
  props.wing_side = { enum: ['east', 'west'], description: 'An L house: which end the wing is at.' };
  if (!ctx.larger.by) props.larger = { type: 'boolean', description: "Ask for the street's one larger house." };
  props.priority = { type: 'array', items: { enum: [...HOME_FEATURES] }, description: 'The features you picked, most wanted first.' };
  const tools: ToolDef[] = [{
    name: 'design_house',
    description: 'Choose your house: a one-sentence reason first, then one value for each field and your priority.',
    input_schema: { type: 'object', properties: props, required: ['reason', ...fields.map(([k]) => k), 'priority'] },
  }];
  return { system: SYSTEM + (ctx.persona.trim() ? ' Choose as the person described would.' : ''), user: lines.join('\n'), tools };
}

/** The design_house call's input, or a text reply's JSON (a `house` object inside it read too). */
function inputOf(reply: Reply): Record<string, unknown> | null {
  const call = reply?.calls?.find((c) => c.name === 'design_house') ?? reply?.calls?.[0];
  let x: unknown = call?.input;
  if (!x) {
    const t = reply?.text ?? '';
    const body = t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
    // (gpt-oss annotated its JSON with // costs and left trailing commas, staged HDm)
    try { x = JSON.parse(body); } catch { try { x = JSON.parse(body.replace(/\s*\/\/[^\n]*/g, '').replace(/,(\s*[}\]])/g, '$1')); } catch { x = null; } }
  }
  if (typeof x === 'string') try { x = JSON.parse(x); } catch { x = null; }
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  return o.house && typeof o.house === 'object' ? { reason: o.reason, ...(o.house as Record<string, unknown>) } : o;
}

/** A value as the enum has it: numbers and booleans from words ("two", "yes"), strings trimmed and lowercased. */
function norm(field: string, raw: unknown): unknown {
  if (raw === undefined || raw === null) return undefined;
  if (field === 'storeys') {
    const s = String(raw).trim().toLowerCase();
    return s === '2' || s === 'two' ? 2 : s === '1' || s === 'one' ? 1 : undefined;
  }
  if (typeof raw === 'boolean') return raw;
  const s = String(raw).trim().toLowerCase();
  if (['porch', 'chimney', 'shutters', 'larger'].includes(field)) return /^(yes|true|y|1)$/.test(s) ? true : /^(no|false|n|0|none)$/.test(s) ? false : undefined;
  if (field === 'shape') return s === 'l' ? 'L' : s === 't' ? 'T' : s === 'rect' || s === 'rectangle' ? 'rect' : undefined;
  if (field === 'door') return s === 'center' ? 'centre' : s;
  if (field === 'wing_side') return s === 'left' ? 'west' : s === 'right' ? 'east' : s;
  if (field === 'frame' && /^(logs?|log posts)$/.test(s)) return 'street';
  return s.replace(/\s*\(.*$/, '');
}

/**
 * The reply read against the offered options: each field's value if offered, else the fallback's (the character draw)
 * if offered, else the field's first (cheapest) value; `partial` names the fields not taken from the reply. Null when
 * the reply has no input or not one offered value.
 */
export function readDesign(reply: Reply, options: HomeOptions, fallback: HomeChoice, largerOffered: boolean): { choice: HomeChoice; reason: string; partial: string[] } | null {
  const o = inputOf(reply);
  if (!o) return null;
  const out = { ...fallback, larger: false, priority: [] as HomeFeature[] } as HomeChoice;
  const partial: string[] = [];
  let got = 0;
  for (const [k, vs] of Object.entries(options.fields)) {
    if (!vs.length) continue;
    const v = norm(k, o[k]);
    const offered = vs.map((x) => x.value);
    if (offered.length === 1) {
      (out as unknown as Record<string, unknown>)[k] = offered[0];
      continue;
    }
    if (v !== undefined && offered.includes(v as never)) {
      (out as unknown as Record<string, unknown>)[k] = v;
      got++;
    } else {
      partial.push(k);
      const fb = (fallback as unknown as Record<string, unknown>)[k];
      (out as unknown as Record<string, unknown>)[k] = offered.includes(fb as never) ? fb : offered[0];
    }
  }
  if (!got) return null;
  const side = norm('wing_side', o.wing_side);
  if (side === 'east' || side === 'west') out.wing_side = side;
  out.larger = largerOffered && norm('larger', o.larger) === true;
  const pr = Array.isArray(o.priority) ? o.priority : typeof o.priority === 'string' ? o.priority.split(/[,;>]+/) : [];
  out.priority = [...new Set(pr.map((p) => String(p).trim().toLowerCase()).filter((p): p is HomeFeature => (HOME_FEATURES as readonly string[]).includes(p)))];
  const reason = typeof o.reason === 'string' ? o.reason.trim().replace(/\s+/g, ' ').slice(0, 200) : '';
  return { choice: out, reason, partial };
}

export interface DesignRequest {
  agent: string;
  spec: ModelSpec;
  level: ReasoningLevel;
  ctx: DesignContext;
  /** The character draw: the fallback for a field the reply leaves out. */
  fallback: HomeChoice;
  /** Shuffles the values shown (the member and the street). */
  seed: string;
  signal?: AbortSignal;
  maxWaitMs?: number;
  /** Injected in checks and benches; callModel by default. */
  call?: typeof callModel;
}
export interface DesignResult {
  agent: string;
  choice: HomeChoice | null;
  reason: string;
  partial: string[];
  /** Why no choice: budget, invalid, timeout, withdrawn, error, late. */
  why?: string;
  prompt: string;
  ms?: number;
  promptTokens?: number;
  outputTokens?: number;
}

/** One member's design by the model; never throws (no choice with `why` on any failure: the caller draws by character). */
export async function castDesign(req: DesignRequest): Promise<DesignResult> {
  const out: DesignResult = { agent: req.agent, choice: null, reason: '', partial: [], prompt: '' };
  const t0 = Date.now();
  try {
    const p = buildDesignPrompt(req.ctx, req.seed);
    out.prompt = p.user;
    if ((isCloudModel(req.spec.model) && !usage.allows('decisions')) || usage.blocked(req.spec.model, req.agent)) return { ...out, why: 'budget' };
    const r = await (req.call ?? callModel)({
      spec: req.spec, system: p.system, user: p.user, tools: p.tools, level: req.level, agent: req.agent, kind: 'home', priority: 'ballot',
      fallbackMs: DESIGN_FALLBACK_MS, signal: req.signal, ...(req.maxWaitMs !== undefined ? { maxWaitMs: Math.max(1000, req.maxWaitMs) } : {}),
    });
    out.ms = r.ms;
    out.promptTokens = r.reply.promptTokens ?? 0;
    out.outputTokens = r.reply.outputTokens ?? 0;
    const got = readDesign(r.reply, req.ctx.options, req.fallback, !req.ctx.larger.by);
    if (!got) return { ...out, why: 'invalid', reason: (r.reply.text ?? '').slice(0, 120) };
    return { ...out, ...got };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    out.ms = Date.now() - t0;
    const why = req.signal?.aborted ? 'late' : err instanceof CallWithdrawn ? 'withdrawn' : /budget/i.test(msg) ? 'budget'
      : /fallback|timed? ?out/i.test(`${(err as Error)?.name ?? ''} ${msg}`) ? 'timeout' : 'error';
    return { ...out, why, reason: msg.slice(0, 120) };
  }
}

/** The memory note at binding (under 140 characters: NOTE_CHARS). */
export function designNote(words: string, reason: string, cuts: string[]): string {
  const cut = cuts.length ? ` (built with ${cuts[0]})` : '';
  const base = `I chose my house: ${words}${cut}`;
  const why = reason.replace(/[.\s]+$/, '');
  const lower = /^I\b/.test(why) ? why : `${why.charAt(0).toLowerCase()}${why.slice(1)}`;
  const full = why ? `${base}, ${/^(because|to|so|for)\b/i.test(why) ? '' : 'because '}${lower}` : base;
  return full.length <= 138 ? full : base.length <= 138 ? base : base.slice(0, 137);
}
