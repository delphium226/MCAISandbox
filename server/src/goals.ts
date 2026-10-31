/**
 * Life goals (#79; spec runs/2026-10-21/s44/spec_life_goals.md with its check's revisions; the user's choices 10-21): a goal
 * per member drawn from its temperament once the village is complete and fixed for life: wealth, invention, mastery,
 * standing, home, beauty (art, creativity, the look of the village: the user's addition). Code measures progress (shown on
 * the menu and in the model prompt) and weights the options that serve the goal (gw, beside tw, nw and ww; exempt from the
 * fixed pick's rank decay; the weights' product capped). World-free: the world (mcWorld.ts) keeps the counters at chore
 * ends and applies the weights; the simulator runs it.
 */
import fs from 'node:fs';
import { price, boardOf, baseValue } from './barter';
import { fnv1a } from './choose';
import { OWN } from './own';
import { SMALL_WORKS } from './smallWorks';
import { INNOVATE, techOf } from './tech';
import type { Temperament } from './temperament';
import type { ChoiceOption } from './world';
import type { Village } from './village';
import { rawSetting } from './settings';

type Counts = Record<string, number>;

/** On unless MC_GOALS=off (on by default since 10-30, the user's). */
export const GOALS_ON = /^(on|1|true)$/i.test(rawSetting('MC_GOALS') ?? 'on');
/** The start screen (spec runs/2026-10-30/startscreen/spec.md 7): a typed goal's text in the lines (MC_GOAL_TEXT) and as a
 *  kept memory line (MC_GOAL_PIN); both on unless set off. */
export const GOAL_TEXT = !/^(off|0|false|no)$/i.test(rawSetting('MC_GOAL_TEXT') ?? 'on');
export const GOAL_PIN = !/^(off|0|false|no)$/i.test(rawSetting('MC_GOAL_PIN') ?? 'on');

export const GOALS = ['wealth', 'invention', 'mastery', 'standing', 'home', 'beauty'] as const;
export type Goal = (typeof GOALS)[number];

/** Each goal's affinity over the traits (spec 1). */
const AFFINITY: Record<Goal, Partial<Temperament>> = {
  wealth: { care: -0.4, sociability: -0.3, diligence: 0.3 },
  invention: { curiosity: 1 },
  mastery: { diligence: 0.7, curiosity: -0.3 },
  standing: { sociability: 0.6, care: 0.4 },
  home: { care: 0.5, curiosity: -0.3, sociability: -0.2 },
  beauty: { pride: 1 },
};

/** The goal's weight (the user's: 1.6, as "you enjoy this"), times up to 1.25 for a member behind on it. */
export const GOAL_WEIGHT = 1.6;

/** The small works that count toward beauty, and the rest toward standing (the check's 6: every initiative is a small work). */
export const BEAUTY_WORKS = new Set(['statue', 'gazebo', 'lamp_posts', 'bench', 'front_bed', 'flower_ring', 'sapling']);
export const STANDING_WORKS = new Set(SMALL_WORKS.map((k) => k.kind).filter((k) => !BEAUTY_WORKS.has(k)));
/** Goods made for the look of the village. */
export const DECOR_GOODS = new Set(['lantern', 'jack_o_lantern']);

/**
 * A typed goal (the start screen, spec 2.2 as revised in 12.2.4-5): the text shown verbatim, the measure it maps to (one of
 * the six, or null: words only), up to 3 pursuit templates (pursuits.ts, first preferred) and the words with no lever.
 */
export interface GoalSpec {
  text: string;
  measure: Goal | null;
  pursuits: string[];
  unmatched: string[];
  by: 'user' | 'take';
  mappedBy?: 'model' | 'user';
  model?: string;
}
/** The run's goal plan (MC_GOAL_PLAN): the typed goals by member, kept on each village apart from the drawable record. */
export interface GoalPlan { mode: 'village' | 'member'; hash: string; village?: string; specs: Record<string, GoalSpec> }

/** The longest goal text a member is shown (spec 12.2.6). */
export const GOAL_TEXT_MAX = 120;
/** A text cut to `n` characters at a word, never mid-word. */
export function clip(text: string, n = GOAL_TEXT_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n + 1).replace(/\s+\S*$/, '');
  return (cut || t.slice(0, n)).replace(/[,;:.\s]+$/, '');
}

/** A goal plan from its JSON (malformed specs dropped, texts clipped, unknown measures as none). */
export function parsePlan(raw: unknown): GoalPlan | null {
  const p = raw as Partial<GoalPlan> | null;
  if (!p || typeof p !== 'object' || !p.specs || typeof p.specs !== 'object') return null;
  const specs: Record<string, GoalSpec> = {};
  for (const [name, x] of Object.entries(p.specs)) {
    if (!x || typeof x.text !== 'string' || !x.text.trim()) continue;
    specs[name] = {
      text: clip(x.text), measure: (GOALS as readonly string[]).includes(x.measure as string) ? (x.measure as Goal) : null,
      pursuits: (Array.isArray(x.pursuits) ? x.pursuits : []).filter((t) => typeof t === 'string').slice(0, 3),
      unmatched: (Array.isArray(x.unmatched) ? x.unmatched : []).filter((t) => typeof t === 'string').map((t) => clip(t, 160)),
      by: x.by === 'take' ? 'take' : 'user', ...(x.mappedBy ? { mappedBy: x.mappedBy } : {}), ...(x.model ? { model: x.model } : {}),
    };
  }
  return { mode: p.mode === 'village' ? 'village' : 'member', hash: String(p.hash ?? ''), ...(p.village ? { village: clip(String(p.village)) } : {}), specs };
}

function loadPlan(file: string): GoalPlan | null {
  if (!file) return null;
  try {
    const plan = parsePlan(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (plan) console.log(`[goal] plan: ${Object.keys(plan.specs).length} members typed (${plan.mode}), ${Object.values(plan.specs).reduce((n, s) => n + s.unmatched.length, 0)} unmatched words, from ${file}`);
    return plan;
  } catch (e) {
    console.log(`[goal] plan ${file} not read (${(e as Error).message}): every goal drawn`);
    return null;
  }
}
let PLAN: GoalPlan | null = loadPlan(rawSetting('MC_GOAL_PLAN') ?? '');
/** The run's plan (checks set one by hand). */
export const goalPlan = () => PLAN;
export function setGoalPlan(p: GoalPlan | null): void {
  PLAN = p;
}

/**
 * The village's plan: the run's, put on the village when it differs (a fresh village, a checkpoint of another run); a
 * checkpoint's plan cleared in a run without one (logged). Kept on `v.goalPlan`, outside the record ensureGoals may delete
 * (the check's 12.1.1). `fresh` is called once when a plan is put on.
 */
export function goalPlanOf(v: Village, fresh?: (p: GoalPlan) => void): GoalPlan | undefined {
  const x = v as Village & { goalPlan?: GoalPlan };
  if (PLAN && x.goalPlan?.hash !== PLAN.hash) {
    x.goalPlan = PLAN;
    console.log(`[goal] ${v.name}: plan ${PLAN.hash || '(no hash)'} applied: ${Object.entries(PLAN.specs).map(([m, s]) => `${m} "${s.text.slice(0, 40)}" ${s.measure ?? 'words only'}`).join('; ')}`);
    fresh?.(PLAN);
  } else if (!PLAN && x.goalPlan) {
    console.log(`[goal] ${v.name}: the checkpoint's goal plan ${x.goalPlan.hash} cleared (this run has none: goals drawn)`);
    delete x.goalPlan;
  }
  return x.goalPlan;
}

/** A member's typed goal, if the run has one for it. */
export const specOf = (v: Village, name: string): GoalSpec | undefined => (GOALS_ON ? goalPlanOf(v)?.specs[name] : undefined);

/** A member's counters, kept at its chore ends. */
export interface GoalStats { done: Counts; lights: number; furnished: number; furnishedOwn: number; helps: number }
/** The record: each member's goal, the members the draw was over. */
export interface Goals { of: Record<string, Goal>; drawnFor: number; at: number; stats: Record<string, GoalStats> }

export function goalsOf(v: Village): Goals | undefined {
  return (v as Village & { goals?: Goals }).goals;
}

const score = (g: Goal, t: Temperament) => Object.entries(AFFINITY[g]).reduce((s, [k, w]) => s + (w ?? 0) * (t[k as keyof Temperament] ?? 0), 0);
/** Ties by a hash of name and goal (zero vectors past the 24 drawn: the check's 4). */
const tie = (name: string, g: Goal) => fnv1a(`${name}|${g}`) / 2 ** 32 / 1000;

/** The goals in play: wealth only with own stock (MC_OWN; the check's 12), invention only with innovation (MC_INNOVATE);
 *  MC_GOALS_ONLY narrows them (experiments). */
export function goalsInPlay(): Goal[] {
  const only = (rawSetting('MC_GOALS_ONLY') ?? '').split(/[,;+]/).filter(Boolean);
  return GOALS.filter((g) => (g !== 'wealth' || OWN.on) && (g !== 'invention' || INNOVATE) && (!only.length || only.includes(g)));
}

/**
 * The draw (pure, deterministic): each goal its best free member first (every goal present), then the best remaining
 * (member, goal) pairs, each goal capped at ceil(n / goals) + 1.
 */
export function drawGoals(members: Array<{ name: string; t: Temperament }>, goals: Goal[] = goalsInPlay()): Record<string, Goal> {
  const out: Record<string, Goal> = {};
  if (!goals.length) return out;
  const cap = Math.ceil(members.length / goals.length) + 1;
  const count = new Map<Goal, number>();
  const pairs = members.flatMap((m) => goals.map((g) => ({ m: m.name, g, s: score(g, m.t) + tie(m.name, g) }))).sort((a, b) => b.s - a.s || (a.m < b.m ? -1 : 1));
  for (const g of goals) {
    const p = pairs.find((x) => x.g === g && !out[x.m]);
    if (!p) continue;
    out[p.m] = g;
    count.set(g, 1);
  }
  for (const p of pairs) {
    if (out[p.m] || (count.get(p.g) ?? 0) >= cap) continue;
    out[p.m] = p.g;
    count.set(p.g, (count.get(p.g) ?? 0) + 1);
  }
  return out;
}

/** A late arrival's goal: its best among the goals with room under the cap, else its best. */
export function lateGoal(name: string, t: Temperament, of: Record<string, Goal>, goals: Goal[] = goalsInPlay()): Goal {
  const n = Object.keys(of).length + 1, cap = Math.ceil(n / goals.length) + 1;
  const held = (g: Goal) => Object.values(of).filter((x) => x === g).length;
  const ranked = [...goals].sort((a, b) => score(b, t) + tie(name, b) - (score(a, t) + tie(name, a)));
  return ranked.find((g) => held(g) < cap) ?? ranked[0];
}

/**
 * The village's goals, drawn on first use over `members` (the world calls it once the village is complete), a member
 * missing from the record given one by the late rule. A record drawn for members none of whom are present (a checkpoint of
 * another run) is drawn again, and so is one drawn over fewer members than are here before any counter was kept (a resume:
 * the first menu came while the rest were still spawning).
 */
export function ensureGoals(v: Village, members: Array<{ name: string; t: Temperament }>, now: number): Goals {
  const x = v as Village & { goals?: Goals };
  // (the start screen: members with a typed goal are never drawn; the draw and its redraw rules are over the rest)
  const spec = goalPlanOf(v)?.specs ?? {};
  const free = members.filter((m) => !spec[m.name]);
  if (x.goals && ((free.length && !free.some((m) => x.goals!.of[m.name])) || (free.length > x.goals.drawnFor && !Object.keys(x.goals.stats).length))) delete x.goals;
  if (!x.goals) x.goals = { of: drawGoals(free), drawnFor: free.length, at: now, stats: {} };
  for (const m of members) {
    const s = spec[m.name];
    if (s?.measure) x.goals.of[m.name] = s.measure;
    else if (s) delete x.goals.of[m.name];
  }
  for (const m of free) if (!x.goals.of[m.name]) x.goals.of[m.name] = lateGoal(m.name, m.t, x.goals.of);
  return x.goals;
}

export function statsOf(v: Village, name: string): GoalStats {
  const g = goalsOf(v)!;
  return (g.stats[name] ??= { done: {}, lights: 0, furnished: 0, furnishedOwn: 0, helps: 0 });
}

/** The craft a chore end counts toward (mastery): a make's good, an activity, harvesting. */
export const craftOf = (kind: string, option: string): string | undefined =>
  kind === 'make' || kind === 'activity' ? option : kind === 'slot' || kind === 'farm' ? 'harvest' : undefined;

/** A chore's end into the member's counters (an ended chore that did its work): its craft, lights, furnishings, help. */
export function noteEnd(v: Village, name: string, kind: string, option: string, optName: string, message: string): void {
  if (!goalsOf(v)) return;
  const s = statsOf(v, name);
  const craft = craftOf(kind, option);
  if (craft) s.done[craft] = (s.done[craft] ?? 0) + 1;
  if (kind === 'light') s.lights += Number(/\blit (\d+)/.exec(message)?.[1] ?? 0);
  if (kind === 'furnish') {
    const n = Number(/\bfurnished (\d+)/.exec(message)?.[1] ?? 0);
    s.furnished += n;
    if (/your own house/.test(optName)) s.furnishedOwn += n;
  }
  // (help on others' projects only: "Continue your ..." is the member's own)
  if (kind === 'help' && /^Help /.test(optName)) s.helps++;
}

/** Mastery's craft: the member's most-done craft once it has done it 5 times. */
export function topCraft(s: GoalStats | undefined): string | undefined {
  const best = Object.entries(s?.done ?? {}).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 5 ? best[0] : undefined;
}

/** The goal as the persona names it: a typed goal's text in quotes (MC_GOAL_TEXT), else the goal word. */
export function goalName(v: Village, name: string): string | undefined {
  const s = GOAL_TEXT ? specOf(v, name) : undefined;
  return s ? `"${s.text}"` : goalsOf(v)?.of[name];
}

const words = (s: string) => s.replace(/^(make|activity):/, '').replace(/_/g, ' ');

/** A member's progress toward its goal: a number (for the score) and the menu's line. */
export function progress(v: Village, name: string, goal: Goal): { value: number; text: string } {
  const g = goalsOf(v);
  const s = g?.stats[name];
  switch (goal) {
    case 'wealth': {
      const own = v.homes?.[name]?.chest?.items ?? {};
      const b = boardOf(v);
      // (#185: the emerald is the money, worth its base value whatever the board's offers did to its factor)
      const worth = Math.round(Object.entries(own).reduce((t, [k, q]) => t + (k === 'emerald' ? baseValue(k) : price(b, k)) * q, 0));
      return { value: worth, text: `${own.emerald ?? 0} emeralds; your own chest worth ${worth}` };
    }
    case 'invention': {
      const t = techOf(v);
      const credit = (t.credit[name] ?? []).length;
      const pts = Math.round(Object.values(t.points).reduce((x, p) => x + (p[name] ?? 0), 0) / 10);
      return { value: credit * 20 + pts, text: `${credit} invention${credit === 1 ? '' : 's'} credited to you; ${pts} research points given` };
    }
    case 'mastery': {
      const c = topCraft(s);
      if (!c) return { value: 0, text: 'no craft of your own yet (do one 5 times)' };
      const mine = s!.done[c], all = Object.values(g!.stats).reduce((t, q) => t + (q.done[c] ?? 0), 0);
      const share = all ? mine / all : 0;
      return { value: share * Math.min(1, mine / 20), text: `you did ${Math.round(share * 100)}% of the village's ${words(c)} (${mine} times)` };
    }
    case 'standing': {
      const built = (v.initiatives ?? []).filter((i) => i.by === name && i.state === 'built' && STANDING_WORKS.has(i.kind)).length;
      const helps = s?.helps ?? 0;
      return { value: helps + 3 * built, text: `${helps} help${helps === 1 ? '' : 's'} on others' projects; ${built} public work${built === 1 ? '' : 's'} of yours stand` };
    }
    case 'home': {
      const own = v.homes?.[name];
      const farm = (v.layouts ?? []).some((l) => l.owner === name);
      const n = s?.furnishedOwn ?? 0;
      return { value: n + (own?.chest ? 3 : 0) + (farm ? 5 : 0), text: `your house: ${n} spots furnished${OWN.on ? `, ${own?.chest ? 'a chest of your own' : 'no chest of your own'}, ${farm ? 'a farm of your own' : 'no farm of your own'}` : ''}` };
    }
    case 'beauty': {
      const built = (v.initiatives ?? []).filter((i) => i.by === name && i.state === 'built' && BEAUTY_WORKS.has(i.kind)).length;
      const lights = s?.lights ?? 0, furn = s?.furnished ?? 0;
      return { value: 10 * built + lights / 4 + furn / 2, text: `${built} work${built === 1 ? '' : 's'} of yours stand; ${lights} lights you put up; ${furn} spots you furnished` };
    }
  }
}

/** The member's score at its goal, 0..1 against the best member at the same goal (0 when the best has none). */
export function goalScore(v: Village, name: string): number {
  const g = goalsOf(v);
  const goal = g?.of[name];
  if (!g || !goal) return 0;
  const mine = progress(v, name, goal).value;
  const best = Math.max(0, ...Object.entries(g.of).filter(([, x]) => x === goal).map(([m]) => progress(v, m, goal).value));
  return best > 0 ? mine / best : 0;
}

/** What the world knows of an option for the goals: its run data's kind-specific facts. */
export interface OptionFacts { work?: string; helpKind?: string; mine?: boolean; good?: string; own?: string }

/** Whether an option serves a goal (spec 3, with the check's 6, 7 and 11). `craft`: the member's mastery craft. */
export function serves(goal: Goal, o: ChoiceOption, f: OptionFacts, craft?: string): boolean {
  switch (goal) {
    case 'wealth':
      // (MC_HOME_BASICS' basics and shearing for the bed, and #141's decorating, are the home's, not wealth)
      return (o.kind === 'own' && f.own !== 'pledge' && f.own !== 'basics' && f.own !== 'shear' && f.own !== 'decor') || o.kind === 'slot' || o.kind === 'penwork';
    case 'invention':
      return o.kind === 'innovate' || (o.kind === 'own' && f.own === 'pledge') || o.kind === 'activity';
    case 'mastery':
      return !!craft && craftOf(o.kind, o.id) === craft;
    case 'standing':
      return (o.kind === 'help' && !f.mine) || (o.kind === 'initiate' && !!f.work && STANDING_WORKS.has(f.work));
    case 'home':
      return (o.kind === 'furnish' && /your own house/.test(o.name)) || (o.kind === 'own' && (f.own === 'chest' || f.own === 'farm' || f.own === 'basics' || f.own === 'shear' || f.own === 'decor'));
    case 'beauty':
      return o.kind === 'light' || o.kind === 'furnish' || (o.kind === 'own' && f.own === 'decor') || (o.kind === 'initiate' && !!f.work && BEAUTY_WORKS.has(f.work))
        || (o.kind === 'help' && !!f.helpKind && BEAUTY_WORKS.has(f.helpKind)) || (o.kind === 'make' && !!f.good && DECOR_GOODS.has(f.good));
  }
}

/** The goal's weight for a member at `score`: 1.6 x (1 + 0.25 x (1 - score)), to 2 decimals. */
export const goalWeight = (score: number) => Math.round(GOAL_WEIGHT * (1 + 0.25 * (1 - Math.max(0, Math.min(1, score)))) * 100) / 100;

/** #117 (MC_PROMPT_SELF): what each goal means, in the terms serves() and progress() count it ("standing maybe wants to
 *  stand?", All1). */
export const GOAL_MEANING: Record<Goal, string> = {
  wealth: 'wealth is riches of your own: emeralds and goods in your own chest; it grows with the harvests of your own farm and pens and your share of what you bring in.',
  invention: 'invention is new things for the village: it grows with each experiment you make, each pledge toward a new good and each new activity you take up.',
  mastery: 'mastery is being the best at one craft: the craft you have done most (5 times makes it yours); it grows each time you do it again and with your share of all the village does of it.',
  standing: "standing is the respect you earn by doing for others: it grows with each help you give on another member's project and each public work of yours (a well, a market stall, a woodshed, a signpost) that gets built.",
  home: 'home is a house that is truly yours: it grows as you furnish it and give it a bed, a table, a chest and a farm of your own.',
  beauty: 'beauty is the look of the village: it grows with each light you put up, each spot you furnish and each beautiful work of yours (a statue, a gazebo, lamp posts, a bench, a flower bed or ring, a young tree) that gets built.',
};

/** The goal's line for the menu and the prompt ("Your life goal: beauty (3 works of yours stand, ...)."); with `meaning`
 *  (#117) the goal's sentence after it. */
export function goalLine(v: Village, name: string, meaning = false): string {
  const goal = goalsOf(v)?.of[name];
  // (a typed goal: its text, with the measure's progress when it has one; the text is its own meaning)
  const s = GOAL_TEXT ? specOf(v, name) : undefined;
  if (s) return `Your life goal: "${s.text}"${goal ? ` (${progress(v, name, goal).text})` : ''}.`;
  return goal ? `Your life goal: ${goal} (${progress(v, name, goal).text}).${meaning ? ` Your goal: ${GOAL_MEANING[goal]}` : ''}` : '';
}
