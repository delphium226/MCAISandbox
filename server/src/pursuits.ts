/**
 * Pursuits (the wants spec, runs/2026-10-30/wants/spec.md 2 with its section 9; the user's choices 9.7): a member's own
 * lasting objective, its life goal made concrete. Code draws four candidates at night from the member's goal, skill,
 * temperament, notes and the member it admires; the model picks one in its own short call (kind `pursuit`) or describes
 * its own (matched by code to a template, else sent on as a proposal); code measures progress from counters kept at chore
 * ends and marks the options that advance the next step (pmw, "[your project]", replacing the goal's gw). World-free: the
 * world (mcWorld.ts) keeps the counters, supplies the facts and applies the weights; society.ts calls the night.
 *
 * The per-member split (spec 6.4, 9.4): MC_WANTS_HOLDOUT of the members (by a hash of the name; MC_WANTS_FLIP reverses it
 * on the second world) are off: no lines, tags, created options or outlet calls; they keep a shadow pursuit, chosen and
 * measured by code and never shown, so persistence and step-taking compare across arms. MC_WANTS=menu (the village-wide
 * pair's third arm) keeps the created options and outlets and drops the lines, tags and weights.
 */
import type { ChoiceOption, ToolDef } from './world';
import type { Temperament } from './temperament';
import { BEAUTY_WORKS, DECOR_GOODS, STANDING_WORKS, type OptionFacts } from './goals';
import { callModel, parseSpec, type ModelSpec } from './modelCall';
import { usage, isCloudModel, REASONING } from './modelUsage';
import { fnv1a, shuffled, CHOOSE } from './choose';
import { agentMemory, clockOf, liveNotes, logAct, socialOf, touchMemory } from './memory';
import { rawSetting } from './settings';

const on = (name: string) => !/^(off|0|false|no)$/i.test(rawSetting(name) ?? 'on');

/** The wants spec's flags, every one on by default (the user's rule since 10-30). */
export const WANTS = {
  pursuits: on('MC_PURSUITS'),
  esteem: on('MC_ESTEEM'),
  rivals: on('MC_ESTEEM_RIVALS'),
  titles: on('MC_TITLES'),
  restless: on('MC_RESTLESS'),
  /** Survey rings round the village (1: today's ring at FARM_TRIP_RANGE; 2 adds 8 points at twice it). */
  rings: Math.max(1, Math.min(3, Math.round(Number(rawSetting('MC_EXPLORE_RINGS') ?? 2) || 2))),
  /** The share of members (by a hash of the name) with every want off. */
  holdout: Math.max(0, Math.min(1, Number(rawSetting('MC_WANTS_HOLDOUT') ?? 0) || 0)),
  flip: /^(on|1|true|yes)$/i.test(rawSetting('MC_WANTS_FLIP') ?? ''),
  /** on: lines, tags, weights, created options and outlets; menu: created options and outlets only. */
  mode: (/^menu$/i.test(rawSetting('MC_WANTS') ?? 'on') ? 'menu' : 'on') as 'on' | 'menu',
};
/** Tests and the simulator. */
export function setWants(s: Partial<typeof WANTS>): void {
  Object.assign(WANTS, s);
}

/** Whether the member is in the on arm of the split (everyone with no holdout). */
export function wantsArm(agent: string): 'on' | 'off' {
  if (WANTS.holdout <= 0) return 'on';
  const off = fnv1a(`wants|${agent.toLowerCase()}`) / 2 ** 32 < WANTS.holdout;
  return off !== WANTS.flip ? 'off' : 'on';
}
/** The member's wants are shown to it (lines, tags, weights). */
export const wantsShown = (agent: string) => wantsArm(agent) === 'on' && WANTS.mode === 'on';
/** The member gets the created options and outlets (on and menu-only). */
export const wantsMade = (agent: string) => wantsArm(agent) === 'on';

// ---------------------------------------------------------------------------------------------
// Product families
// ---------------------------------------------------------------------------------------------

const WOODS = 'oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped';
const STONES = 'chiseled|cracked|mossy|smooth|polished|cut';
/** An option id's product family (spec 9.1: wood and stone variants and numbers merged; wants_use.py and step0.py mirror
 *  it): make:birch_fence and make:oak_fence are one, help:i62 and help:i11 one, slot:1:1 and slot:29:1 one. */
export function familyOf(id: string): string {
  return id.toLowerCase().replace(new RegExp(`\\b(${WOODS})_`, 'g'), '').replace(new RegExp(`\\b(${STONES})_`, 'g'), '')
    .replace(/:s?i?\d+(:\d+)?/g, ':').replace(/\d+/g, '').replace(/:+/g, ':').replace(/:+$/, '');
}
const FOOD_FAMILIES = /^(make:(bread|cooked_\w+|cake|pumpkin_pie|baked_potato|mushroom_stew)|farm|slot|penwork(:\w+)?|activity:lib:fish|own:farm:\w+)$/;
/** Families a craft or supply pursuit may name: goods made, harvests, fishing; not meals, rest or own basics. */
export const pursuableFamily = (f: string) => /^(make:|activity:lib:|farm$|slot$|penwork|iron:)/.test(f) && !/^make:(stick|planks|.*_planks)$/.test(f);
const famWords = (f: string) => f.replace(/^make:/, '').replace(/^activity:lib:/, '').replace(/^penwork:?/, 'pen ').replace(/^iron:/, 'iron ').replace(/_/g, ' ').trim() || f;

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

export const TEMPLATES = ['craft', 'supply', 'works', 'light', 'explore', 'house', 'garden', 'research', 'wealth', 'standing'] as const;
export type Template = (typeof TEMPLATES)[number];

/** A member's counters, kept at its chore ends (pursuits' own, whatever MC_GOALS says). */
export interface WantCounts { fam: Record<string, number>; lights: number; furnished: number; furnishedOwn: number; helps: number; explored: number }

/** What the world tells the night and the sweep about a member (mcWorld.ts' wantsFacts). */
export interface WantsFacts {
  goal?: string;
  t: Temperament;
  /** Live note texts and the day's intention. */
  notes: string[];
  /** Its own built initiatives by kind. */
  built: Record<string, number>;
  emeralds: number;
  /** Innovation entries still locked (ids), with words. */
  inventions: Array<{ id: string; name: string }>;
  /** Survey points still unvisited on the rings in play. */
  ringLeft: number;
  /** The admired member and its pursuit (esteem.ts), for the copied candidate. */
  admired?: { name: string; pursuit?: { template: Template; param?: string } };
  own: boolean;
}

/** One pursuit. */
export interface Pursuit {
  template: Template;
  param?: string;
  label: string;
  target: number;
  /** The measure when it began: progress is measure - base. */
  base: number;
  value: number;
  day: number;
  at: number;
  lastProgressAt: number;
  lastProgressDay: number;
  /** The last chore that took a step, and how many steps came after 15+ minutes of other work. */
  lastStepAt?: number;
  steps: number;
  resumed: number;
  milestone: number;
  state: 'active' | 'done' | 'dropped' | 'stalled';
  ended?: number;
  source: string;
  why?: string;
  /** An off-member's: chosen and measured by code, never shown. */
  shadow?: boolean;
}
export interface WantsState {
  counts: WantCounts;
  pursuit?: Pursuit;
  done: Pursuit[];
  /** Families on its menus lately (the live paths), by the day last seen. */
  seen: Record<string, number>;
  /** The night it was last asked, and an unmatched wish told at dawn. */
  asked?: number;
  told?: string;
}

/** The member's wants state, in its memory's social places (saved with memory.json). */
export function wantsOf(village: string, agent: string): WantsState {
  const s = socialOf(village, agent) as { wants?: WantsState };
  return (s.wants ??= { counts: { fam: {}, lights: 0, furnished: 0, furnishedOwn: 0, helps: 0, explored: 0 }, done: [], seen: {} });
}

interface TemplateDef {
  /** The label the member sees, with its target. */
  label: (param: string | undefined, target: number) => string;
  /** The measure now. */
  measure: (c: WantCounts, f: WantsFacts, param?: string) => number;
  /** The target over the base. */
  target: (f: WantsFacts, param?: string) => number;
  /** Whether an option takes a step. */
  advances: (o: ChoiceOption, of: OptionFacts, param?: string) => boolean;
  /** The next step, in words. */
  next: (param?: string) => string;
}

const sum = (r: Record<string, number>, keys?: Set<string>) => Object.entries(r).reduce((t, [k, n]) => t + (!keys || keys.has(k) ? n : 0), 0);
const famCount = (c: WantCounts, re: RegExp) => Object.entries(c.fam).reduce((t, [k, n]) => t + (re.test(k) ? n : 0), 0);

const DEFS: Record<Template, TemplateDef> = {
  craft: {
    label: (p, n) => `the village's best at ${famWords(p ?? '')}: ${n} more`,
    measure: (c, _f, p) => c.fam[p ?? ''] ?? 0,
    target: () => 12,
    advances: (o, _f, p) => !!p && familyOf(o.id) === p,
    next: (p) => famWords(p ?? ''),
  },
  supply: {
    label: (p, n) => `keep the village in ${famWords(p ?? '')}: ${n} more`,
    measure: (c, _f, p) => c.fam[p ?? ''] ?? 0,
    target: () => 10,
    advances: (o, _f, p) => !!p && familyOf(o.id) === p,
    next: (p) => famWords(p ?? ''),
  },
  works: {
    label: (_p, n) => `build ${n} public work${n === 1 ? '' : 's'} of your own`,
    measure: (_c, f) => sum(f.built),
    target: () => 2,
    advances: (o, f) => o.kind === 'initiate' || (o.kind === 'help' && !!f.mine),
    next: () => 'start a work of your own, or carry on with yours',
  },
  light: {
    label: (_p, n) => `light the village: ${n} lights`,
    measure: (c) => c.lights,
    target: () => 24,
    advances: (o) => o.kind === 'light' || o.id === 'make:torch' || o.id === 'make:lantern',
    next: () => 'light unlit spots (torches)',
  },
  explore: {
    label: (_p, n) => `map the land beyond the village: ${n} far points`,
    measure: (c) => c.explored,
    target: (f) => Math.max(1, Math.min(4, f.ringLeft)),
    advances: (o) => o.kind === 'explore',
    next: () => 'explore a far point',
  },
  house: {
    label: (_p, n) => `the finest house: ${n} more things in it`,
    measure: (c) => c.furnishedOwn + famCount(c, /^own:(decor|basics|shear|chest|farm)/),
    target: () => 6,
    advances: (o, f) => (o.kind === 'furnish' && /your own house/.test(o.name)) || (o.kind === 'own' && ['chest', 'farm', 'basics', 'shear', 'decor'].includes(f.own ?? '')),
    next: () => 'furnish or decorate your own house',
  },
  garden: {
    label: (_p, n) => `make the village beautiful: ${n} works and touches`,
    measure: (c, f) => sum(f.built, BEAUTY_WORKS) * 2 + famCount(c, /^own:decor|^make:(lantern|jack_o_lantern)$/),
    target: () => 5,
    advances: (o, f) => (o.kind === 'initiate' && !!f.work && BEAUTY_WORKS.has(f.work)) || (o.kind === 'help' && !!f.helpKind && BEAUTY_WORKS.has(f.helpKind))
      || (o.kind === 'own' && f.own === 'decor') || (o.kind === 'make' && !!f.good && DECOR_GOODS.has(f.good)),
    next: () => 'a beautiful work (a flower bed, a statue, a bench) or decoration',
  },
  research: {
    label: (p, n) => `unlock ${p ?? 'an invention'}: ${n} experiments`,
    measure: (c, _f, p) => c.fam[`innovate:${p ?? ''}`] ?? 0,
    target: () => 4,
    advances: (o, f, p) => o.id === `innovate:${p}` || (o.kind === 'own' && f.own === 'pledge'),
    next: (p) => `experiment with ${p}`,
  },
  wealth: {
    label: (_p, n) => `riches of your own: ${n} more emeralds`,
    measure: (_c, f) => f.emeralds,
    target: () => 10,
    advances: (o, f) => (o.kind === 'own' && !['pledge', 'basics', 'shear', 'decor'].includes(f.own ?? '')) || o.id === 'activity:lib:sell',
    next: () => 'sell goods of your own or work your own farm',
  },
  standing: {
    label: (_p, n) => `the one everyone counts on: ${n} helps on others' projects`,
    measure: (c, f) => c.helps + 2 * sum(f.built, STANDING_WORKS),
    target: () => 6,
    advances: (o, f) => (o.kind === 'help' && !f.mine) || (o.kind === 'initiate' && !!f.work && STANDING_WORKS.has(f.work)),
    next: () => "help another member's project",
  },
};

/** Whether an option takes the pursuit's next step. */
export function advances(p: Pick<Pursuit, 'template' | 'param'>, o: ChoiceOption, f: OptionFacts): boolean {
  return o.kind !== 'eat' && o.kind !== 'rest' && DEFS[p.template].advances(o, f, p.param);
}
export const nextStep = (p: Pick<Pursuit, 'template' | 'param'>) => DEFS[p.template].next(p.param);

// ---------------------------------------------------------------------------------------------
// Candidates (code proposes)
// ---------------------------------------------------------------------------------------------

export interface Candidate { template: Template; param?: string; label: string; target: number; source: string }

/** Note and intention words that name a template (spec 2.2's memory source). */
const NOTE_WORDS: Array<[RegExp, Template]> = [
  [/\b(house|home|furnish\w*|bed|decorat\w*)\b/i, 'house'],
  [/\b(light\w*|torch\w*|lantern\w*|dark)\b/i, 'light'],
  [/\b(explor\w*|map|scout\w*|far|beyond)\b/i, 'explore'],
  [/\b(garden|flower\w*|beaut\w*|statue|bench)\b/i, 'garden'],
  [/\b(well|fountain|build\w*|work of my own|project)\b/i, 'works'],
  [/\b(bread|food|feed|fish\w*|harvest\w*|crop\w*)\b/i, 'supply'],
  [/\b(research|invent\w*|experiment\w*|unlock)\b/i, 'research'],
  [/\b(emerald\w*|trade|sell\w*|rich\w*|wealth)\b/i, 'wealth'],
  [/\b(help\w*|others'?|neighbou?r\w*)\b/i, 'standing'],
];
const GOAL_TEMPLATES: Record<string, Template[]> = {
  mastery: ['craft'], beauty: ['garden', 'light'], home: ['house'], standing: ['standing', 'works'], wealth: ['wealth'], invention: ['research'],
};

/** The member's top family by its own counters (its skill), among pursuable ones. */
export function topFamily(c: WantCounts, seen?: Record<string, number>): string | undefined {
  return Object.entries(c.fam).filter(([f]) => pursuableFamily(f) && (!seen || seen[f] !== undefined)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
}

/** Whether a candidate has a live path: an option advancing it was on the member's menus in the last 2 days. */
function live(s: WantsState, t: Template, param: string | undefined, f: WantsFacts, day: number): boolean {
  if (t === 'explore') return f.ringLeft > 0;
  if (t === 'wealth') return f.own;
  if (t === 'research') return !!param && f.inventions.some((e) => e.id === param);
  if (t === 'works' || t === 'garden' || t === 'standing') return Object.entries(s.seen).some(([k, d]) => d >= day - 2 && (k.startsWith('initiate') || k.startsWith('help')));
  if (t === 'light') return Object.entries(s.seen).some(([k, d]) => d >= day - 2 && (k.startsWith('light') || k === 'make:torch'));
  if (t === 'house') return Object.entries(s.seen).some(([k, d]) => d >= day - 2 && (k.startsWith('furnish') || /^own:(decor|basics|chest|farm|shear)/.test(k)));
  return !!param && (s.seen[param] ?? -99) >= day - 2;
}

/** Make a candidate for a template (its parameter chosen for the member), or null without a live path. */
function candidate(s: WantsState, t: Template, f: WantsFacts, day: number, source: string, param?: string): Candidate | null {
  let p = param;
  if ((t === 'craft') && !p) p = topFamily(s.counts, s.seen) ?? Object.keys(s.seen).filter(pursuableFamily).filter((k) => s.seen[k] >= day - 2).sort()[0];
  if (t === 'supply' && !p) p = Object.keys(s.seen).filter((k) => FOOD_FAMILIES.test(k) && s.seen[k] >= day - 2).sort((a, b) => (s.counts.fam[b] ?? 0) - (s.counts.fam[a] ?? 0) || (a < b ? -1 : 1))[0];
  if (t === 'research' && !p) p = f.inventions[0]?.id;
  if ((t === 'craft' || t === 'supply' || t === 'research') && !p) return null;
  if (!live(s, t, p, f, day)) return null;
  const target = DEFS[t].target(f, p);
  return { template: t, ...(p ? { param: p } : {}), label: DEFS[t].label(p, target), target, source };
}

/**
 * The night's four candidates (spec 2.2, 9.2): from the life goal, the member's skill (its most-made family), its
 * temperament (curiosity: explore, research; care: supply; diligence: craft; sociability: standing, works; pride: works,
 * garden), its notes, and the member it admires; filled from the rest by a seeded order. Never the active one (that is
 * "keep").
 */
export function candidates(s: WantsState, f: WantsFacts, day: number, seed: string): Candidate[] {
  const out: Candidate[] = [];
  const has = (t: Template, p?: string) => out.some((c) => c.template === t && c.param === p) || (s.pursuit?.state === 'active' && s.pursuit.template === t && s.pursuit.param === p);
  const push = (c: Candidate | null) => {
    if (c && out.length < 4 && !has(c.template, c.param)) out.push(c);
  };
  if (f.admired?.pursuit) push(candidate(s, f.admired.pursuit.template, f, day, `like ${f.admired.name}'s`, f.admired.pursuit.param));
  for (const t of GOAL_TEMPLATES[f.goal ?? ''] ?? []) push(candidate(s, t, f, day, 'your life goal'));
  const top = topFamily(s.counts, s.seen);
  if (top) push(candidate(s, FOOD_FAMILIES.test(top) ? 'supply' : 'craft', f, day, 'what you do most', top));
  const text = f.notes.join(' ');
  for (const [re, t] of NOTE_WORDS) if (re.test(text)) push(candidate(s, t, f, day, 'your notes'));
  const traits: Array<[number, Template[]]> = [
    [f.t.curiosity ?? 0, ['explore', 'research']], [f.t.care ?? 0, ['supply']], [f.t.diligence ?? 0, ['craft']],
    [f.t.sociability ?? 0, ['standing', 'works']], [f.t.pride ?? 0, ['works', 'garden']],
  ];
  for (const [w, ts] of traits.sort((a, b) => b[0] - a[0])) if (w > 0.2) for (const t of ts) push(candidate(s, t, f, day, 'your nature'));
  const rest = [...TEMPLATES].sort((a, b) => fnv1a(`${seed}|${a}`) - fnv1a(`${seed}|${b}`));
  for (const t of rest) push(candidate(s, t, f, day, 'something new'));
  return out;
}

/** Keywords of a member's own words for a pursuit, to a template (spec 2.2's pursuit_text), else null. */
export function matchOwn(text: string, s: WantsState, f: WantsFacts, day: number): Candidate | null {
  const t = text.toLowerCase();
  // (a family named: "the best baker" -> bread, "make lanterns" -> lantern)
  const fams = Object.keys(s.seen).filter(pursuableFamily);
  const named = fams.find((k) => t.includes(famWords(k)) || (k === 'make:bread' && /\bbak(er|e|ing)\b/.test(t)));
  if (named) return candidate(s, FOOD_FAMILIES.test(named) ? 'supply' : 'craft', f, day, 'your own words', named);
  for (const [re, tp] of NOTE_WORDS) if (re.test(t)) {
    const c = candidate(s, tp, f, day, 'your own words');
    if (c) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Progress (code measures)
// ---------------------------------------------------------------------------------------------

/** A chore's end into the member's counters; returns whether it took the pursuit's step. */
export function noteEnd(village: string, agent: string, e: { kind: string; option: string; name: string; message: string; ok: boolean; productive: boolean; facts: OptionFacts }, now: number, otherWorkGapMs: number): boolean {
  const s = wantsOf(village, agent);
  if (!e.ok) return false;
  const c = s.counts;
  const fam = familyOf(e.option);
  if (e.productive || e.kind === 'innovate' || e.kind === 'own') c.fam[fam] = (c.fam[fam] ?? 0) + 1;
  if (e.kind === 'light') c.lights += Number(/\blit (\d+)/.exec(e.message)?.[1] ?? 0);
  if (e.kind === 'furnish') {
    const n = Number(/\bfurnished (\d+)/.exec(e.message)?.[1] ?? 0);
    c.furnished += n;
    if (/your own house/.test(e.name)) c.furnishedOwn += n;
  }
  if (e.kind === 'help' && /^Help /.test(e.name)) c.helps++;
  if (e.kind === 'explore' && /^explore:(\d+)$/.test(e.option) && Number(e.option.split(':')[1]) >= 8) c.explored++;
  const p = s.pursuit;
  let step = false;
  if (p?.state === 'active' && advances(p, { id: e.option, kind: e.kind as ChoiceOption['kind'], name: e.name } as ChoiceOption, e.facts)) {
    step = true;
    p.steps++;
    if (p.lastStepAt !== undefined && now - p.lastStepAt >= otherWorkGapMs) p.resumed++;
    p.lastStepAt = now;
  }
  touchMemory();
  return step;
}

export interface ProgressNews { agent: string; pursuit: Pursuit; milestone: number }

/** The pursuit's measure brought up to date; a milestone (25/50/75/100%) returned once, the pursuit done at 100%, stalled
 *  after 2 village days without progress. */
export function update(village: string, agent: string, f: WantsFacts, now: number): ProgressNews | null {
  const s = wantsOf(village, agent);
  const p = s.pursuit;
  if (!p || p.state !== 'active') return null;
  const day = clockOf(village, now)?.day ?? p.day;
  const m = DEFS[p.template].measure(s.counts, f, p.param);
  if (m > p.value) {
    p.value = m;
    p.lastProgressAt = now;
    p.lastProgressDay = day;
  }
  const frac = p.target ? (p.value - p.base) / p.target : 0;
  const ms = frac >= 1 ? 4 : Math.floor(frac * 4);
  let out: ProgressNews | null = null;
  if (ms > p.milestone) {
    p.milestone = ms;
    out = { agent, pursuit: p, milestone: ms };
    logAct({ type: 'pursuit-progress', village, agent, template: p.template, param: p.param, value: p.value - p.base, target: p.target, milestone: ms * 25, shadow: !!p.shadow, day });
  }
  if (frac >= 1) end(village, agent, 'done', now, day);
  else if (day - p.lastProgressDay >= 2) end(village, agent, 'stalled', now, day);
  touchMemory();
  return out;
}

function end(village: string, agent: string, state: 'done' | 'dropped' | 'stalled', now: number, day: number, why?: string): void {
  const s = wantsOf(village, agent);
  const p = s.pursuit;
  if (!p) return;
  p.state = state;
  p.ended = now;
  s.done = [...s.done, p].slice(-8);
  s.pursuit = undefined;
  logAct({ type: 'pursuit-end', village, agent, template: p.template, param: p.param, state, value: p.value - p.base, target: p.target, days: day - p.day, steps: p.steps, resumed: p.resumed, shadow: !!p.shadow, ...(why ? { why } : {}), day });
  console.log(`[pursuit] ${village}: ${agent}'s ${p.shadow ? 'shadow ' : ''}pursuit ${p.template}${p.param ? ` (${p.param})` : ''} ${state} after ${day - p.day} day(s), ${p.value - p.base} of ${p.target}`);
}

function begin(village: string, agent: string, c: Candidate, f: WantsFacts, now: number, day: number, shadow: boolean, why?: string): Pursuit {
  const s = wantsOf(village, agent);
  const base = DEFS[c.template].measure(s.counts, f, c.param);
  const p: Pursuit = {
    template: c.template, ...(c.param ? { param: c.param } : {}), label: c.label, target: c.target, base, value: base, day, at: now,
    lastProgressAt: now, lastProgressDay: day, steps: 0, resumed: 0, milestone: 0, state: 'active', source: c.source, ...(why ? { why: why.slice(0, 200) } : {}), ...(shadow ? { shadow: true } : {}),
  };
  s.pursuit = p;
  touchMemory();
  return p;
}

/** The prompt's pursuit line (spec 2.3): "Your project (day 3 of it): ...: 9 of 14; next: ...". */
export function pursuitLine(village: string, agent: string, now: number): string {
  const p = wantsOf(village, agent).pursuit;
  if (!p || p.state !== 'active' || p.shadow) return '';
  const day = clockOf(village, now)?.day ?? p.day;
  return `Your own project (day ${day - p.day + 1} of it): ${p.label}; ${Math.min(p.target, p.value - p.base)} of ${p.target} so far; next: ${nextStep(p)}.`;
}
/** Done pursuits, for the identity line and esteem ("made the finest house, day 4"). */
export const donePursuits = (village: string, agent: string) => wantsOf(village, agent).done.filter((p) => p.state === 'done');

/** The menu's families into the member's live paths (the world calls it with each built menu's feasible options). */
export function noteMenu(village: string, agent: string, feasible: ChoiceOption[], now: number): void {
  const day = clockOf(village, now)?.day;
  if (day === undefined) return;
  const s = wantsOf(village, agent);
  let changed = false;
  for (const o of feasible) {
    const f = familyOf(o.id);
    if (s.seen[f] !== day) {
      s.seen[f] = day;
      changed = true;
    }
  }
  if (changed) touchMemory();
}

// ---------------------------------------------------------------------------------------------
// The night (the model decides)
// ---------------------------------------------------------------------------------------------

/** What the world gives the night: the member's facts and a proposal for an unmatched want. */
export interface PursuitHooks {
  facts: (village: string, agent: string) => WantsFacts | null;
  propose: (village: string, agent: string, what: string, why: string, day: number) => string | null;
  tell: (village: string, agent: string, text: string) => void;
}
let hooks: PursuitHooks | null = null;
export function setPursuitHooks(h: PursuitHooks | null): void {
  hooks = h;
}
/** Injected in tests. */
let call: typeof callModel = callModel;
export function setPursuitCall(fn: typeof callModel): void {
  call = fn;
}

/** Whether tonight needs a pursuit choice: none yet, the last one ended. */
export const needsChoice = (s: WantsState) => !s.pursuit || s.pursuit.state !== 'active';

const PURSUIT_SYSTEM = 'You are a member of a Minecraft village. Night has come. Choose the project of your own you will pursue over the '
  + 'next days: something you want for yourself, beyond the day\'s chores. Call `pursue` once.';

/** The night's pursuit prompt (pure: the bench rebuilds it). */
export function pursuitPrompt(persona: string, goalLine: string, s: WantsState, cands: Candidate[], day: number): { system: string; user: string; tools: ToolDef[] } {
  const lines: string[] = [];
  if (persona.trim()) lines.push(persona.trim());
  if (goalLine.trim()) lines.push(goalLine.trim());
  const last = s.done[s.done.length - 1];
  if (last) lines.push(`Your last project: ${last.label} (${last.state === 'done' ? 'done' : last.state === 'stalled' ? 'it stalled: nothing moved it for two days' : 'dropped'}, day ${last.day} to ${day}).`);
  if (s.told) lines.push(s.told);
  const top = Object.entries(s.counts.fam).filter(([f]) => pursuableFamily(f)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, n]) => `${famWords(f)} ${n}`);
  if (top.length) lines.push(`What you have done most: ${top.join(', ')}.`);
  lines.push('Projects you could take up (code measures each and marks the chores that move it on your menu):');
  for (const c of cands) lines.push(`- ${capital(c.label)} (${c.source})`);
  lines.push('Or describe in `own` a project of your own in a few words, if none of these is what you want; the village will hear of a wish it cannot meet yet.');
  const names = cands.map((c) => capital(c.label));
  const tools: ToolDef[] = [{
    name: 'pursue',
    description: 'Choose your project for the next days.',
    input_schema: {
      type: 'object',
      properties: {
        why: { type: 'string', maxLength: 200, description: 'Why, in one sentence.' },
        pursuit: { type: 'string', enum: [...names, 'own'], description: 'The project you choose, exactly as written, or "own" to describe your own.' },
        own: { type: 'string', maxLength: 120, description: 'With "own": your project in a few words.' },
      },
      required: ['why', 'pursuit'],
    },
  }];
  return { system: PURSUIT_SYSTEM, user: lines.join('\n'), tools };
}
const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** The reply's pick: a candidate's index, or own words. */
export function parsePursuit(input: unknown, cands: Candidate[]): { pick?: number; own?: string; why: string } | null {
  let o = input as Record<string, unknown> | string | null;
  if (typeof o === 'string') {
    try { o = JSON.parse(o) as Record<string, unknown>; } catch { return null; }
  }
  if (!o || typeof o !== 'object') return null;
  for (const k of ['arguments', 'parameters', 'input']) if (o[k] && typeof o[k] === 'object' && !('pursuit' in o)) o = o[k] as Record<string, unknown>;
  const why = typeof o.why === 'string' ? o.why.trim().slice(0, 200) : '';
  const raw = typeof o.pursuit === 'string' ? o.pursuit.trim() : '';
  const own = typeof o.own === 'string' ? o.own.trim().slice(0, 120) : '';
  const fold = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const i = cands.findIndex((c) => fold(c.label) === fold(raw) || (fold(raw).length >= 12 && fold(c.label).startsWith(fold(raw))));
  if (i >= 0) return { pick: i, why };
  if (own || /^own$/i.test(raw)) return { own: own || raw, why };
  if (raw.length > 3) return { own: raw, why };
  return null;
}

const asking = new Set<string>();

/**
 * The night's pursuit for one member (society.ts, after its reflection): only on nights that need one (none, done,
 * stalled). An on-member asks the model; an off-member (the split's holdout) gets a shadow pursuit, the first candidate,
 * by code. Never throws.
 */
export async function pursuitNight(village: string, m: { name: string; persona: string; model?: string }, day: number, now: number, goalLine = ''): Promise<void> {
  if (!WANTS.pursuits || !hooks) return;
  const k = `${village}|${m.name}`;
  if (asking.has(k)) return;
  const s = wantsOf(village, m.name);
  if (!needsChoice(s) || s.asked === day) return;
  const f = hooks.facts(village, m.name);
  if (!f) return;
  s.asked = day;
  const drawn = candidates(s, f, day, `${m.name}|${day}`);
  if (!drawn.length) return;
  // (shown in a seeded order, as the chooser shows its options: the bench's first 10 replies all took the first)
  const cands = wantsMade(m.name) && CHOOSE.mode === 'model' ? shuffled(drawn, `pursuit|${m.name}|${day}`) : drawn;
  if (!wantsMade(m.name) || CHOOSE.mode !== 'model') {
    const p = begin(village, m.name, cands[0], f, now, day, !wantsMade(m.name));
    logAct({ type: 'pursuit-chosen', village, agent: m.name, day, candidates: cands, pick: 0, by: 'code', shadow: !!p.shadow, template: p.template, param: p.param });
    return;
  }
  const spec: ModelSpec | null = parseSpec(m.model ?? CHOOSE.model);
  if (!spec) return;
  if ((isCloudModel(spec.model) && !usage.allows('decisions')) || usage.blocked(spec.model, m.name)) return;
  asking.add(k);
  const pr = pursuitPrompt(m.persona, goalLine || (f.goal ? `Your life goal: ${f.goal}.` : ''), s, cands, day);
  s.told = undefined;
  try {
    const r = await call({ spec, system: pr.system, user: pr.user, tools: pr.tools, level: REASONING.pursuit, agent: m.name, kind: 'pursuit', priority: 'reflection' });
    const c = r.reply.calls.find((x) => x.name === 'pursue') ?? r.reply.calls[0];
    const got = parsePursuit(c ? c.input : r.reply.text.slice(r.reply.text.indexOf('{'), r.reply.text.lastIndexOf('}') + 1), cands);
    let chosen: Candidate | null = got?.pick !== undefined ? cands[got.pick] : null;
    let proposal: string | null = null;
    if (!chosen && got?.own) {
      chosen = matchOwn(got.own, s, f, day);
      if (!chosen) {
        proposal = hooks.propose(village, m.name, got.own, got.why || 'my own project', day);
        s.told = `Nobody here can do "${got.own}" yet; your wish is passed on to those who decide what the village learns next${proposal ? ` (${proposal})` : ''}. Choose from what you can do meanwhile.`;
        hooks.tell(village, m.name, s.told);
      }
    }
    // (an unreadable reply or an unmatched wish: the first candidate meanwhile, so the member has a project tomorrow)
    const p = begin(village, m.name, chosen ?? cands[0], f, now, day, false, got?.why);
    logAct({
      type: 'pursuit-chosen', village, agent: m.name, day, candidates: cands, pick: got?.pick ?? null, own: got?.own, matched: !!chosen, proposal, by: 'model',
      template: p.template, param: p.param, why: got?.why, system: pr.system, prompt: pr.user, ms: r.ms, promptTokens: r.reply.promptTokens, outputTokens: r.reply.outputTokens,
    });
    console.log(`[pursuit] ${village}: ${m.name} day ${day}: ${p.label} (${chosen ? chosen.source : got?.own ? `own words "${got.own}" unmatched, the first meanwhile` : 'unreadable reply, the first'})`);
  } catch (e) {
    logAct({ type: 'pursuit-chosen', village, agent: m.name, day, error: String((e as Error)?.message ?? e).slice(0, 200) });
    console.log(`[pursuit] ${village}: ${m.name} day ${day}: the call failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
  } finally {
    asking.delete(k);
  }
}

/** Drop the active pursuit (tests, the panel). */
export function dropPursuit(village: string, agent: string, now: number, why?: string): void {
  end(village, agent, 'dropped', now, clockOf(village, now)?.day ?? 0, why);
}
/** Start one directly (tests, the scripted controller). */
export function startPursuit(village: string, agent: string, c: Candidate, f: WantsFacts, now: number, shadow = false): Pursuit {
  return begin(village, agent, c, f, now, clockOf(village, now)?.day ?? 0, shadow);
}
/** Live notes and the day's intention, for the facts. */
export function noteTexts(village: string, agent: string): string[] {
  const a = agentMemory(village, agent);
  if (!a) return [];
  return [...liveNotes(a).map((n) => n.text), ...(a.today?.text ? [a.today.text] : [])];
}
