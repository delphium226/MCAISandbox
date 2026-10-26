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
 *   MC_CHOICE_FAMILIES    goal-2 families switched on, default "make,gather,works,light,catalog,furnish,initiatives,activities" (S.9, B.4; X.1's catalogue and furniture since s34; N.0's initiatives since s37; the library's activities since s42); empty: none
 *   MC_CHOOSE_PARALLEL    decisions in flight process-wide, default 2 (one below the gate's 3 cloud slots)
 *   MC_CHOOSE_QUEUE_MS    a decision not started within this gets the fixed pick ('queue'), default 30000
 *   MC_CHOOSE_WAIT_MS     the call's wait for a gate slot before it is withdrawn, default 15000
 *   MC_CHOOSE_FALLBACK_MS the call is cut off this long after the send ('timeout'), default 20000
 *   MC_CHOOSE_MIN_GAP_MS  an agent's model decisions at least this far apart (else 'repeat' or 'rate'), default 90000
 *   MC_CHOOSE_HOURLY      model decisions an agent may make an hour, default 30
 *   MC_CHOOSE_MODEL       the model (else MC_EXEC_MODEL, else gpt-oss:120b-cloud); memory.chooseModel per agent
 */
import { LLM_LIMITS, cloudSlots, limited } from './llmLimits';
import { IRON_AGE } from './ladderFlags';
/** MC_BAN_SCOPE=member: bans are the failing member's own, short (BAN_MEMBER_MS), never village-wide (F304). */
/** MC_CHOOSE_BACKUP=on: the model names a second option, run when its first is taken by the time the pick runs, before a
 *  re-ask (All1, F304: 299 fixed picks for a taken pick and 475 re-asks with every member on the model). */
export const CHOOSE_BACKUP = /^(on|1|true|yes)$/i.test(rawSetting('MC_CHOOSE_BACKUP') ?? '');
export const BAN_MEMBER = /^member$/i.test(rawSetting('MC_BAN_SCOPE') ?? '');
const BAN_MEMBER_MS = 20 * 60000 / Math.max(0.1, Number(rawSetting('MC_TIME_SCALE') ?? 1) || 1);
/** MC_WORK_BLOCKS: model decisions paced through the hour (modelCallsLastHour), at most PACE_BURST at a time. */
const PACED = LLM_LIMITS && /^(on|1|true|yes)$/i.test(rawSetting('MC_WORK_BLOCKS') ?? '');
const PACE_BURST = 3;
import type { ChoiceKind, ChoiceMenu, ChoiceOption, FallbackWhy, ToolDef } from './world';
import { callModel, CallFallback, CallWithdrawn, type ModelSpec, type Reply } from './modelCall';
import { usage, BudgetExceeded, isCloudModel, type ReasoningLevel } from './modelUsage';
import { FOCUS, MEMORY, applyWrites, clockOf, lastLines, logAct, recall, type Recall } from './memory';
import { TALK, actFields, payingOn, type ActFields } from './acts';
import { capFloor, characterAny } from './character';
import { PROMPT_SELF, basicTag } from './promptSelf';
import { onSetting, rawSetting } from './settings';

export const MENU_MAX = 8, PER_KIND_MAX = 2;

export const CHOOSE = {
  mode: (rawSetting('MC_CHOOSE') ?? 'fixed') as 'fixed' | 'model' | 'scripted',
  instances: new Set((rawSetting('MC_CHOICE_INSTANCES') ?? 'explore,start').split(',').map((s) => s.trim()).filter(Boolean)),
  /** Goal-2 families switched on (S.9: make, gather, works; B.4: light); empty: none (the golden check, A.8's baselines). */
  families: new Set((rawSetting('MC_CHOICE_FAMILIES') ?? 'make,gather,works,light,catalog,furnish,initiatives,activities').split(',').map((s) => s.trim()).filter(Boolean)),
  /** 2, one below the gate's 3 cloud slots (modelCall.ts:199), so a human reply, a plan or an executor turn always
   *  finds a slot free of decisions (C11). */
  // (MC_LLM_LIMITS=off: every cloud slot, no give-up in the queue or at the gate; each setting still wins where set)
  parallel: limited(rawSetting('MC_CHOOSE_PARALLEL'), 2, cloudSlots()),
  queueMs: limited(rawSetting('MC_CHOOSE_QUEUE_MS'), 30000, Infinity),
  waitMs: limited(rawSetting('MC_CHOOSE_WAIT_MS'), 15000, Infinity),
  fallbackMs: Number(rawSetting('MC_CHOOSE_FALLBACK_MS') ?? 20000),
  minGapMs: limited(rawSetting('MC_CHOOSE_MIN_GAP_MS'), 90000, 0),
  perHour: limited(rawSetting('MC_CHOOSE_HOURLY'), 30, Infinity),
  model: rawSetting('MC_CHOOSE_MODEL') ?? rawSetting('MC_EXEC_MODEL') ?? 'ollama:gpt-oss:120b-cloud',
};
// (#115: who picks, changed during a run: read at each use)
onSetting('MC_CHOOSE', (v) => {
  CHOOSE.mode = (v || 'fixed') as typeof CHOOSE.mode;
});

// ---------------------------------------------------------------------------------------------
// The menu as the model sees it
// ---------------------------------------------------------------------------------------------

const byRank = (a: ChoiceOption, b: ChoiceOption) => a.rank - b.rank;

/**
 * Model-mode trim: per kind the first PER_KIND_MAX by rank; then, over MENU_MAX, each kind's best first (by lp desc then
 * rank asc), the rest of the room by lp desc then rank asc. A plain lp cut hid every workshop option (ranks 850+) behind
 * 8 older options at the same lp (S.9's review, lens 2 M1).
 */
export function trimMenu(options: ChoiceOption[], ambition = PROMPT_SELF): ChoiceOption[] {
  // (G2: an option answering a request or keeping a promise keeps its place, beyond the per-kind limit; MC_HOME_BASICS:
  // so does a basic need of the member's own house)
  // (#117, MC_PROMPT_SELF: and one option for the village's ambition, its best by weight, unless a pinned one feeds it)
  const amb = ambition && !options.some((o) => (o.social || o.basic) && o.vw)
    ? options.filter((o) => o.vw && !o.social && !o.basic).sort((a, b) => (b.lp ?? 1) * weights(b) - (a.lp ?? 1) * weights(a) || byRank(a, b))[0] : undefined;
  const pinned = options.filter((o) => o.social || o.basic || o === amb);
  if (pinned.length) {
    const rest = trimMenu(options.filter((o) => !pinned.includes(o)), false);
    return [...pinned.slice(0, MENU_MAX), ...rest.slice(0, Math.max(0, MENU_MAX - pinned.length))].sort(byRank);
  }
  const perKind = new Map<string, number>();
  const kept: ChoiceOption[] = [];
  // (N.1: within a kind, a need's weight first, then rank; without needs the rank order as before)
  // (#79: and a life goal's)
  for (const o of [...options].sort((a, b) => (b.nw ?? 1) * (b.gw ?? 1) - (a.nw ?? 1) * (a.gw ?? 1) || byRank(a, b))) {
    const n = perKind.get(o.kind) ?? 0;
    if (n >= PER_KIND_MAX) continue;
    perKind.set(o.kind, n + 1);
    kept.push(o);
  }
  if (kept.length <= MENU_MAX) return kept;
  // (a missing lp or tw counts as the neutral weight, 1; A.3p: a kind its agent dislikes, tw below DISLIKED, gets no
  // reserved place and competes for the rest of the room)
  const w = (o: ChoiceOption) => (o.lp ?? 1) * weights(o);
  const order = [...kept].sort((a, b) => w(b) - w(a) || a.rank - b.rank);
  const seen = new Set<string>();
  // (#79: a goal's option keeps its place though its kind is disliked)
  const firsts = order.filter((o) => (o.tw ?? 1) * (o.gw ?? 1) >= DISLIKED && !seen.has(o.kind) && seen.add(o.kind));
  const best = [...firsts, ...order.filter((o) => !firsts.includes(o))].slice(0, MENU_MAX);
  return best.sort(byRank);
}

/** MC_HOME_BASICS: the menu's basic need of the member's own house (the lowest rank of them), unless a meal comes first. */
export function basicOf(menu: ChoiceMenu): ChoiceOption | undefined {
  if (menu.options.some((o) => o.kind === 'eat')) return undefined;
  return menu.options.filter((o) => o.basic).sort(byRank)[0];
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

/** Whether an option carries any weight (tw, nw, ww or gw): the fixed pick reads the weights only then. */
export const weighted = (o: ChoiceOption) => o.tw !== undefined || o.nw !== undefined || o.ww !== undefined || o.gw !== undefined || o.iw !== undefined || o.sw !== undefined || o.cf !== undefined || o.vw !== undefined || o.rw !== undefined;
/** #79: the cap on an option's weights' product (temperament's top, 2.5 squared), applied when a life goal weighs on it. */
export const WEIGHT_CAP = 6.25;
/** An option's weights' product (tw x nw x ww x gw; capped where a goal weighs, so goals off leave it as it was). */
export const weights = (o: ChoiceOption) => {
  const p = (o.tw ?? 1) * (o.nw ?? 1) * (o.ww ?? 1) * (o.gw ?? 1) * (o.iw ?? 1) * (o.sw ?? 1) * (o.cf ?? 1) * (o.vw ?? 1) * (o.rw ?? 1);
  // (character v2's B1: with any layer on, every product capped at 6.25 and floored at 0.16)
  if (characterAny()) return capFloor(p);
  return o.gw !== undefined ? Math.min(WEIGHT_CAP, p) : p;
};

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
  if (!best || best.kind === 'eat') return best;
  // (MC_HOME_BASICS: a basic need of the member's own house next, before any weight: a goal's option escaped the decay)
  const basic = basicOf(menu);
  if (basic) return basic;
  if (!menu.options.some(weighted)) return best;
  const place = new Map<string, number>();
  for (const o of [...menu.options].sort(byRank)) if (!place.has(o.kind)) place.set(o.kind, place.size);
  // (N.1: a need's weight beside the temperament's)
  // (#69: the member's own wants beside both)
  // (#79, the user's: a life goal's options exempt from the decay)
  const score = (o: ChoiceOption) => weights(o) * KIND_DECAY ** (o.gw !== undefined ? 0 : place.get(o.kind) ?? 0);
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
/** G1: added when a memory section is shown. */
const SYSTEM_MEMORY = ' Use what you remember where it bears on the choice.';

/** G1 (MC_MEMORY=on): the memory section (with whether this is the member's dawn decision) and the last chores from the
 *  stored log, used when the statistics are empty (a restart). */
export interface PromptMemory {
  recall: Recall | null;
  outcomes?: string[];
}

/**
 * A.3p's tag on an option line, from its temperament weight. None on `grow` (N.2's street): its weight is forced to the
 * scale's top for every houseless member, not the member's temperament.
 */
const tag = (o: ChoiceOption) => (o.tw === undefined || o.kind === 'grow' ? '' : o.tw >= ENJOYED ? ' [you enjoy this]' : o.tw <= DULL ? ' [you find this dull]' : '')
  + (o.gw !== undefined ? ' [toward your goal]' : '') + (o.basic ? ` ${o.basicNeed ? basicTag(o.basicNeed) : '[a basic need: your own house]'}` : '') + (o.social ? ` ${o.social}` : '') + (o.mark ? ` ${o.mark}` : '') + (o.ruleTag ? ` ${o.ruleTag}` : '') + (o.ladderTag ? ` ${o.ladderTag}` : '') + (o.tradeTag ? ` ${o.tradeTag}` : '');

/** A context line with its label, unless the world wrote the label already. */
const labelled = (label: string, text: string) => (text.toLowerCase().startsWith(label.toLowerCase()) ? text : `${label}: ${text}`);

/** The prompt of section 5.2: the options in the order given (shuffled by the caller), named, never numbered (D7). */
export function buildPrompt(menu: ChoiceMenu, shown: ChoiceOption[], mem?: PromptMemory): { system: string; user: string; tools: ToolDef[] } {
  const ctx = menu.ctx;
  const rc = mem?.recall ?? null;
  const lines: string[] = [];
  if (ctx.persona?.trim()) lines.push(ctx.persona.trim());
  if (ctx.character?.trim()) lines.push(ctx.character.trim());
  // (#117, MC_PROMPT_SELF: the member's own state and unmet basic needs)
  if (ctx.self?.trim()) lines.push(ctx.self.trim());
  if (ctx.pattern?.trim()) lines.push(ctx.pattern.trim());
  if (ctx.role?.trim()) lines.push(ctx.role.trim());
  if (ctx.skill?.trim()) lines.push(ctx.skill.trim());
  if (ctx.village?.trim()) lines.push(labelled('Village', ctx.village.trim()));
  if (ctx.rules?.trim()) lines.push(ctx.rules.trim());
  if (ctx.others?.trim()) lines.push(labelled('Others now', ctx.others.trim()));
  if (ctx.social?.trim()) lines.push(ctx.social.trim());
  if (ctx.needs?.length) lines.push(`Village needs: ${ctx.needs.join('; ')}`);
  if (ctx.scarcity?.trim()) lines.push(ctx.scarcity.trim());
  if (ctx.wants?.trim()) lines.push(ctx.wants.trim());
  if (ctx.goal?.trim()) lines.push(ctx.goal.trim());
  if (ctx.ladder?.trim()) lines.push(ctx.ladder.trim());
  // (M3, MC_MONUMENT_NEWS: the cathedral's progress, its news and the member's trade)
  if (ctx.monument?.trim()) lines.push(ctx.monument.trim());
  const outcomes = ctx.outcomes?.length ? ctx.outcomes : mem?.outcomes ?? [];
  lines.push(`Your last chores: ${outcomes.length ? outcomes.join(' | ') : 'none yet'}`);
  if (rc) lines.push(rc.text);
  if (ctx.share) lines.push(`Your last chores brought new goods into the village storage; your share of them is ${ctx.share.total}. Say in \`share\` how much of it you leave in the village storage: ${ctx.share.answers.map((a) => `"${a.text}"`).join(', ')}.`);
  if (ctx.inbox?.length) lines.push(`Your inbox:\n${ctx.inbox.map((l) => `- ${l}`).join('\n')}`);
  // (#107: news heard and answers to the member's questions, each its own section beside the inbox)
  if (ctx.news?.length) lines.push(`News you heard:\n${ctx.news.map((l) => `- ${l}`).join('\n')}`);
  if (ctx.answers?.length) lines.push(`Answers to your questions:\n${ctx.answers.map((l) => `- ${l}`).join('\n')}`);
  if (ctx.acts?.trim()) lines.push(ctx.acts.trim());
  if (rc?.dawn) lines.push(`This is your first choice of village day ${rc.day}: set your intention for today in \`intention\`, and in \`focus\` the kind of work you mean to do most: one of ${FOCUS.join(', ')}.`);
  lines.push('Options (in no particular order):');
  for (const o of shown) {
    const facts = o.facts?.trim();
    const effect = o.effect?.trim();
    lines.push(`- ${o.name}${facts ? `: ${facts}` : ''}${effect ? ` (expected: ${effect})` : ''}${o.need ? ` [${o.need}]` : ''}${tag(o)}`);
  }
  lines.push((mem ? 'Call choose with your reason and the exact name of one option; add `remember` only when something is worth keeping for later.' : 'Call choose with your reason and the exact name of one option.')
    + (ctx.acts?.trim() ? ' Add an act or a line to say when it serves you, another member or the village.' : ''));
  const tools: ToolDef[] = [{
    name: 'choose',
    description: 'Choose your next chore: a one-sentence reason first, then the exact name of one option.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', maxLength: 200, description: 'Why, in one sentence.' },
        choice: { type: 'string', enum: shown.map((o) => o.name), description: 'The exact name of one option.' },
        ...(CHOOSE_BACKUP && shown.length > 1 ? { backup: { type: 'string', enum: shown.map((o) => o.name), description: 'Optional: the exact name of a second option, taken if another member has taken your first by then.' } } : {}),
        // (G1: what the model keeps, read from the same call)
        ...(mem ? {
          remember: { type: 'string', maxLength: 160, description: 'Optional: one thing worth remembering on later days (a lesson, a plan, something about the village or a member), in your own words; leave out what this prompt already shows.' },
          ...(rc?.liveIds.length ? { replaces: { type: 'string', enum: rc.liveIds, description: `Optional: the id of the note your new note replaces${rc.full ? ' (your notes are full: give one)' : ''}.` } } : {}),
          ...(rc?.dawn ? {
            intention: { type: 'string', maxLength: 200, description: 'What you mean to do today and why, one sentence.' },
            focus: { type: 'string', enum: FOCUS, description: 'The kind of work you mean to do most today.' },
          } : {}),
        } : {}),
        // (G3: the pending share's answer, amounts only)
        ...(ctx.share ? { share: { type: 'string', enum: ctx.share.answers.map((a) => a.text), description: 'How much of your share you leave in the village storage.' } } : {}),
        // (G2, MC_ACTS: one act and one line, flat fields: gpt-oss nests objects and ignores enums, the spec check's H6)
        ...(ctx.acts?.trim() ? {
          act: { type: 'string', enum: ['none', 'request', 'offer', 'accept', 'decline', 'release', 'report', ...(payingOn() ? ['pay'] : [])], description: 'Optional: one act (none by default).' },
          act_to: { type: 'string', description: 'The member the act is for or about, or "anyone" for a request.' },
          act_item: { type: 'string', description: 'For a request or an offer: an item from the list.' },
          act_project: { type: 'string', description: 'For a request or an offer: a project from the list.' },
          act_ref: { type: 'string', description: 'For accept, decline, release or report: the id (r3, c2).' },
          act_claim: { type: 'string', enum: ['kept', 'broke'], description: 'For a report.' },
          // (#108, MC_PAY: a request's price, a wage's steps, the pay act's amount)
          ...(payingOn() ? {
            act_price: { type: 'integer', description: 'Optional, for a request: emeralds from your own chest you pay for it (per step on a project).' },
            act_steps: { type: 'integer', description: 'For a priced request on a project: the steps you pay for (1-4).' },
            act_amount: { type: 'integer', description: 'For pay: how many emeralds (or of act_item) to give.' },
          } : {}),
          say: { type: 'string', maxLength: 120, description: 'Optional: one short line said aloud to those near you.' },
          // (#107, MC_NEWS and MC_QUESTIONS)
          ...(TALK.news ? { news: { type: 'string', maxLength: 160, description: 'Optional: one short line of news for those near you: something you saw or heard they may not know.' } } : {}),
          ...(TALK.questions ? {
            question: { type: 'string', maxLength: 160, description: 'Optional: something you want to know that another member may know (where to find a material, why a chore fails, what they need); they answer from what they know.' },
            question_to: { type: 'string', description: 'For a question: the member you ask, or "anyone".' },
          } : {}),
        } : {}),
      },
      required: rc?.dawn ? ['reason', 'choice', 'intention', 'focus'] : ['reason', 'choice'],
    },
  }];
  return { system: (ctx.persona?.trim() ? SYSTEM + SYSTEM_PERSONA : SYSTEM) + (rc ? SYSTEM_MEMORY : ''), user: lines.join('\n'), tools };
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
  // (a name copied with the line's trailing tags, "[Ada asked you]": the tags cut off; the spec check's L1)
  if (/\]\s*$/.test(choice)) {
    const bare = choice.replace(/(\s*\[[^\]]*\])+\s*$/, '');
    const hit = shown.find((o) => o.name === bare);
    if (hit) return hit;
  }
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

/** G1: the memory fields of the reply's choose call (or of a choice written as text). */
export function memoryWrites(reply: Reply): { remember?: string; replaces?: string; intention?: string; focus?: string } {
  const pick = (o: unknown): Record<string, unknown> | null => {
    if (!o || typeof o !== 'object') return null;
    const r = o as Record<string, unknown>;
    if (typeof r.choice === 'string') return r;
    for (const k of ['arguments', 'parameters', 'input']) {
      let inner = r[k];
      if (typeof inner === 'string') {
        try { inner = JSON.parse(inner); } catch { inner = null; }
      }
      const got = inner && inner !== o ? pick(inner) : null;
      if (got) return got;
    }
    return null;
  };
  const calls = reply?.calls ?? [];
  let o = pick((calls.find((c) => c.name === 'choose' && pick(c.input)) ?? calls.find((c) => pick(c.input)))?.input);
  if (!o && !calls.length) {
    const t = reply?.text ?? '';
    try { o = pick(JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))); } catch { o = null; }
  }
  if (!o) return {};
  const str = (k: string) => (typeof o![k] === 'string' && (o![k] as string).trim() ? (o![k] as string).trim() : undefined);
  return { ...(str('remember') ? { remember: str('remember') } : {}), ...(str('replaces') ? { replaces: str('replaces') } : {}), ...(str('intention') ? { intention: str('intention') } : {}), ...(str('focus') ? { focus: str('focus') } : {}) };
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
  /** G2 (MC_ACTS): the reply's act and say fields, from a valid reply. */
  acts?: ActFields;
  /** G3: the share's answer (none, levy or all), from a valid reply whose prompt asked it. */
  share?: 'none' | 'levy' | 'all';
  /** MC_CHOOSE_BACKUP: the second option's id, from a valid reply, when it names one other than the first. */
  backup?: string;
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
export const QUOTA_BACKOFF_MS = Number(rawSetting('MC_CHOOSE_QUOTA_BACKOFF_MS') ?? 5 * 60000);
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
    // (G1: the memory section, read without marking the notes shown until the call is made)
    const mem: PromptMemory | undefined = MEMORY.on ? {
      recall: recall(req.menu.village, req.agent, Date.now(), { lastShown: req.menu.ctx.outcomes?.length || 5, mark: false }),
      outcomes: lastLines(req.menu.village, req.agent, 5),
    } : undefined;
    const p = buildPrompt(req.menu, shown, mem);
    out.prompt = p.user;
    // (the degrade levels are the cloud budget's: a local model is never held by them)
    if ((isCloudModel(req.spec.model) && !usage.allows('decisions')) || usage.blocked(req.spec.model, req.agent)) return { ...out, why: 'budget' };
    if ((quotaUntil.get(req.spec.model) ?? 0) > Date.now()) return { ...out, why: 'budget' };
    if (req.signal?.aborted) return { ...out, why: 'withdrawn' };
    // (shown only once it goes to the model: a refusal or a withdrawal unsent showed nothing to anyone)
    out.shown = shown.map((o) => o.id);
    // (G1: the notes' shown counts, once the prompt goes out)
    if (mem?.recall) recall(req.menu.village, req.agent, Date.now(), { lastShown: req.menu.ctx.outcomes?.length || 5 });
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
    // (G1: what the model kept, from a valid reply only, applied here whether its pick then runs, is taken, re-asked or
    // dropped; the decision into the ledger)
    if (mem) {
      const w = 'invalid' in c ? {} : memoryWrites(r.reply);
      const done = applyWrites(req.menu.village, req.agent, w, 'decision', Date.now(), req.seed);
      const ck = clockOf(req.menu.village, Date.now());
      logAct({
        type: 'decision', village: req.menu.village, agent: req.agent, decisionId: req.seed, ...(ck ? { day: ck.day, phase: ck.phase } : {}),
        system: p.system, prompt: p.user, memory: mem.recall?.shown ?? [], dawn: !!mem.recall?.dawn,
        choice: 'invalid' in c ? null : c.id, reason: 'invalid' in c ? '' : c.reason, ...w, done,
        ms: r.ms, promptTokens: r.reply.promptTokens, outputTokens: r.reply.outputTokens,
      });
    }
    if (!('invalid' in c) && req.menu.ctx.acts?.trim()) {
      const call = r.reply.calls.find((x) => x.name === 'choose') ?? r.reply.calls[0];
      let input: unknown = call?.input;
      if (!call) {
        const t = r.reply.text ?? '';
        try { input = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { input = null; }
      }
      if (input && typeof input === 'object' && !('choice' in (input as object))) {
        for (const k of ['arguments', 'parameters', 'input']) {
          let inner = (input as Record<string, unknown>)[k];
          if (typeof inner === 'string') {
            try { inner = JSON.parse(inner); } catch { inner = null; }
          }
          if (inner && typeof inner === 'object') {
            input = inner;
            break;
          }
        }
      }
      out.acts = actFields(input);
    }
    // (G3: the share's answer, by its text or its first number)
    if (!('invalid' in c) && req.menu.ctx.share) {
      const call = r.reply.calls.find((x) => x.name === 'choose') ?? r.reply.calls[0];
      const raw = String(((call?.input ?? {}) as Record<string, unknown>).share ?? '').trim().toLowerCase();
      const hit = req.menu.ctx.share.answers.find((a) => a.text.toLowerCase() === raw) ?? req.menu.ctx.share.answers.find((a) => raw && a.text.toLowerCase().startsWith(raw.slice(0, 12)));
      if (hit) out.share = hit.id;
    }
    if ('invalid' in c) {
      const raw = r.reply.calls.length ? JSON.stringify(r.reply.calls) : r.reply.text;
      console.log(`[choose] ${req.agent}: invalid reply (${c.invalid}): ${String(raw).replace(/\s+/g, ' ').slice(0, 200)}`);
      return { ...out, why: 'invalid' };
    }
    // (MC_CHOOSE_BACKUP: the second option, by name as the first is matched)
    if (CHOOSE_BACKUP) {
      const call = r.reply.calls.find((x) => x.name === 'choose') ?? r.reply.calls[0];
      const raw = ((call?.input ?? {}) as Record<string, unknown>).backup;
      const b = typeof raw === 'string' && raw.trim() ? match(raw, shown) : null;
      if (b && !('invalid' in b) && b.id !== c.id) out.backup = b.id;
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
    // (an unlimited queue, MC_LLM_LIMITS=off, sets no timer: setTimeout takes Infinity as 1 ms)
    if (this.running.size >= this.parallel && Number.isFinite(this.queueMs)) e.timer = setTimeout(() => this.expire(e), this.queueMs);
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
  // "milked the cows on annex slot 1: 2 milk buckets" (#139: or the goats) | "the storage holds 3 milk buckets already"
  milk_cows: counted(/^milked the (?:cows|goats) on annex slot \d+: (\d+) milk bucket/, /^the storage holds \d+ milk buckets already/),
  // #139: "sheared 3 sheep in the pen on annex slot 2: 6 wool (...)" | "no sheep with wool in the pen on annex slot 2 ..."
  shear_pen: counted(/^sheared \d+ sheep in the pen on annex slot \d+: (\d+) wool/, /^no sheep with wool\b/),
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
  // #21's library: "shelved 2 of 5 pieces in the library (...); 3 to go" | "shelved 0 of 5 ..."
  shelve_library: counted(/^shelved (\d+)/),
};

/** Items a skill's carried gain is judged by when its message gives no count. */
const YIELD_ITEMS: Record<string, RegExp> = {
  harvest_farm: /wheat|seeds/, harvest_slot: /carrot|potato|beetroot|pumpkin|melon|sugar_cane|seeds/, collect_eggs: /egg/, milk_cows: /milk/, shear_pen: /wool/,
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
  if (kind === 'gather' || kind === 'activity') return /^deposited [1-9]/.test(message);
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

  /** #17: the village's ends of a kind that went well (cut and contention left out): how many and the mean minutes. */
  villageKind(village: string, kind: ChoiceKind): { n: number; minutes: number } | null {
    let n = 0, minutes = 0;
    for (const e of this.list(village)) {
      if (e.kind !== kind || !e.ok || e.cut || e.contention) continue;
      n++;
      minutes += e.minutes;
    }
    return n ? { n, minutes: minutes / n } : null;
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
  banned(village: string, kind: ChoiceKind, id: string, now: number, agent?: string): { until: number; scope: 'id' | 'kind' } | null {
    if (kind === 'explore' || kind === 'eat') return null;
    // (MC_BAN_SCOPE=member, All1's F304: a ban is the failing member's alone, two of its own failures of the option within
    // BAN_MEMBER_MS, for BAN_MEMBER_MS; never the village's: one member's dig without a pickaxe kept iron off 851 of 908 menus)
    if (BAN_MEMBER) {
      if (!agent) return null;
      const mine = this.list(village).filter((e) => e.agent === agent && e.kind === kind && e.id === id && !e.ok && !e.cut && !e.contention && e.at > now - BAN_MEMBER_MS && e.at <= now).map((e) => e.at).sort((a, b) => a - b);
      return mine.length >= 2 ? (mine[mine.length - 1] + BAN_MEMBER_MS > now ? { until: mine[mine.length - 1] + BAN_MEMBER_MS, scope: 'id' } : null) : null;
    }
    // (G8, MC_IRON_AGE: dig, smelt and forge are separate works; a miner's failures never ban the smiths, staged I3)
    const perId = kind === 'make' || kind === 'gather' || kind === 'light' || kind === 'furnish' || kind === 'initiate' || kind === 'help' || kind === 'activity' || (IRON_AGE && kind === 'iron');
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
    const c = this.calls.get(agent) ?? [];
    const hour = c.filter((t) => t > now - HOUR && t <= now).length;
    // (MC_WORK_BLOCKS: the hour's calls spread evenly, PACE_BURST in any PACE_BURST / perHour of an hour, so a member at the
    // 30 s floor does not spend its 30 in the first half-hour; read as the cap reached while the window is full. W1/M1, F297:
    // the model's share fell from ~37% to 13-17% once the hourly caps ran out)
    if (PACED) {
      const win = (PACE_BURST * HOUR) / Math.max(1, CHOOSE.perHour);
      if (c.filter((t) => t > now - win && t <= now).length >= PACE_BURST) return Math.max(hour, CHOOSE.perHour);
    }
    return hour;
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
