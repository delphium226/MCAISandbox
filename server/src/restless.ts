/**
 * Restlessness (the wants spec 4 with 9.2.7; MC_RESTLESS, on): a gauge per member, 0-10, that rises while it idles with
 * nothing feasible (+1 each 5 minutes, scaled by curiosity 0.7-1.4), with chores that gave nothing anyone uses and with
 * the same chore failing twice, and falls with a productive chore (-1), a step on its pursuit (-2) and each night
 * (halved). Repetition is not punished (spec 0.6): only pointless repetition is tagged, by the world. At 4+ the prompt
 * says so; at 7+, or with an empty menu, the member gets an outlet call (kind `outlet`, at most one each 5 village
 * minutes, against the budget): explore further, ask for what blocks it, help another's work, propose a want, rest at the
 * green. World-free: the world (mcWorld.ts) builds the outlets and runs the pick.
 */
import type { ToolDef } from './world';
import type { Temperament } from './temperament';
import { clockOf, socialOf, touchMemory } from './memory';
import { rawSetting } from './settings';

const SCALE = Math.max(0.1, Number(rawSetting('MC_TIME_SCALE') ?? 1) || 1);
/** Five village minutes, in wall time. */
export const FIVE_MIN = 5 * 60000 / SCALE;
/** The prompt line from here up. */
export const RESTLESS_LINE = 4;
/** An outlet call from here up (or with an empty menu). */
export const RESTLESS_CALL = 7;
/** Asks and proposals from outlets a member-day (spec 9.2.7). */
export const OUTLET_CAP = 2;

export interface RestState {
  g: number;
  day?: number;
  /** The last failed option and how often in a row. */
  failed?: string;
  failN?: number;
  lastOutletAt?: number;
  asks?: { day: number; n: number };
  props?: { day: number; n: number };
  /** Outlet picks by kind (the panel and wants_use.py read the acts ledger; this is a quick count). */
  picks?: Record<string, number>;
  /** Options done today (pointless repetition's count). */
  today?: { day: number; n: Record<string, number> };
}

export function restOf(village: string, agent: string): RestState {
  const s = socialOf(village, agent) as { restless?: RestState };
  return (s.restless ??= { g: 0 });
}

/** Curiosity's scale on the rise, 0.7..1.4 (A.3p's traits run -1..1). */
export const curiosityScale = (t: Temperament) => Math.max(0.7, Math.min(1.4, 1.05 + 0.35 * (t.curiosity ?? 0)));

const clamp = (g: number) => Math.max(0, Math.min(10, Math.round(g * 100) / 100));

/** Each night halves it (the first call on a new day). */
function dayTurn(village: string, s: RestState, now: number): void {
  const day = clockOf(village, now)?.day;
  if (day === undefined) return;
  if (s.day !== undefined && day > s.day) s.g = clamp(s.g / 2 ** Math.min(4, day - s.day));
  s.day = day;
}

/** Idle with nothing feasible for `ms` (the sweep's none path, the time since the member's last such sweep). */
export function noteIdle(village: string, agent: string, ms: number, t: Temperament, now: number): number {
  const s = restOf(village, agent);
  dayTurn(village, s, now);
  s.g = clamp(s.g + (Math.max(0, Math.min(ms, 120000)) / FIVE_MIN) * curiosityScale(t));
  touchMemory();
  return s.g;
}

/** A chore's end: productive -1, a pursuit step -2 more; done for nothing (or for a good nothing uses) +1; the same option
 *  failing twice in a row +1. */
export function noteEnd(village: string, agent: string, e: { option: string; ok: boolean; productive: boolean; unused: boolean; stepped: boolean; cut: boolean }, t: Temperament, now: number): number {
  const s = restOf(village, agent);
  dayTurn(village, s, now);
  if (e.cut) return s.g;
  if (e.ok) {
    const day = s.day ?? 0;
    if (!s.today || s.today.day !== day) s.today = { day, n: {} };
    s.today.n[e.option] = (s.today.n[e.option] ?? 0) + 1;
  }
  let d = 0;
  if (e.ok && e.productive && !e.unused) d -= 1;
  if (e.stepped) d -= 2;
  if (e.ok && (!e.productive || e.unused)) d += 1 * curiosityScale(t);
  if (!e.ok) {
    s.failN = s.failed === e.option ? (s.failN ?? 1) + 1 : 1;
    s.failed = e.option;
    if (s.failN === 2) d += 1 * curiosityScale(t);
  } else s.failed = undefined;
  s.g = clamp(s.g + d);
  touchMemory();
  return s.g;
}

/** How often the member did an option today. */
export function doneToday(village: string, agent: string, option: string, now: number): number {
  const s = restOf(village, agent);
  const day = clockOf(village, now)?.day ?? 0;
  return s.today?.day === day ? s.today.n[option] ?? 0 : 0;
}

/** The prompt's line at RESTLESS_LINE and up. */
export function restlessLine(village: string, agent: string, hasPursuit: boolean): string {
  const g = restOf(village, agent).g;
  if (g < RESTLESS_LINE) return '';
  return `You are restless (${Math.round(g)} of 10): nothing you did lately ${hasPursuit ? 'moved your own project' : 'came to much'}. Look for something that matters to you.`;
}

/** Whether an outlet call is due: restless enough or nothing on the menu, and none in the last 5 village minutes. */
export function outletDue(village: string, agent: string, now: number, empty: boolean): boolean {
  const s = restOf(village, agent);
  if (!empty && s.g < RESTLESS_CALL) return false;
  return !s.lastOutletAt || now - s.lastOutletAt >= FIVE_MIN;
}
export function markOutlet(village: string, agent: string, now: number): void {
  restOf(village, agent).lastOutletAt = now;
  touchMemory();
}

/** An ask or a proposal from an outlet, within its cap today (counted when allowed). */
export function capOk(village: string, agent: string, what: 'asks' | 'props', now: number): boolean {
  const s = restOf(village, agent);
  const day = clockOf(village, now)?.day ?? 0;
  const c = s[what];
  if (c && c.day === day && c.n >= OUTLET_CAP) return false;
  s[what] = { day, n: c && c.day === day ? c.n + 1 : 1 };
  touchMemory();
  return true;
}
export function capLeft(village: string, agent: string, what: 'asks' | 'props', now: number): boolean {
  const c = restOf(village, agent)[what];
  return !c || c.day !== (clockOf(village, now)?.day ?? 0) || c.n < OUTLET_CAP;
}

/** Chosen rest (an outlet) lowers it by 1. */
export function noteRest(village: string, agent: string): void {
  const s = restOf(village, agent);
  s.g = clamp(s.g - 1);
  touchMemory();
}

/** One outlet as the model sees it. */
export interface Outlet { id: 'explore' | 'ask' | 'help' | 'propose' | 'rest'; name: string; facts: string; ref?: string }

const OUTLET_SYSTEM = 'You are a member of a Minecraft village. Nothing on your list of chores is possible now, or nothing you did lately came to '
  + 'much. Choose what you do about it: call `outlet` once with a short reason and the exact name of one option.';

/** The outlet call's prompt (pure: the bench rebuilds it). */
export function outletPrompt(o: { persona: string; pursuit: string; wants: string; restless: string; why: string; items: string[] }, outlets: Outlet[]): { system: string; user: string; tools: ToolDef[] } {
  const lines: string[] = [];
  if (o.persona.trim()) lines.push(o.persona.trim());
  if (o.pursuit.trim()) lines.push(o.pursuit.trim());
  if (o.wants.trim()) lines.push(o.wants.trim());
  if (o.restless.trim()) lines.push(o.restless.trim());
  if (o.why.trim()) lines.push(`Why your list is empty: ${o.why.trim()}`);
  lines.push('What you can do:');
  for (const x of outlets) lines.push(`- ${x.name}: ${x.facts}`);
  const has = (id: Outlet['id']) => outlets.some((x) => x.id === id);
  const tools: ToolDef[] = [{
    name: 'outlet',
    description: 'Choose what you do now.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', maxLength: 200, description: 'Why, in one sentence.' },
        choice: { type: 'string', enum: outlets.map((x) => x.name), description: 'The exact name of one option.' },
        // (no enum: gpt-oss names the item it needs whatever the list says, the bench's wool and iron pickaxe; resolveItem matches it)
        ...(has('ask') ? { item: { type: 'string', description: `For an ask: the item you ask for${o.items.length ? ` (the village makes or gathers ${o.items.slice(0, 12).join(', ')} and more)` : ''}.` } } : {}),
        ...(has('propose') ? { what: { type: 'string', maxLength: 140, description: 'For a proposal: what you want the village to be able to do, in a few words.' } } : {}),
      },
      required: ['reason', 'choice'],
    },
  }];
  return { system: OUTLET_SYSTEM, user: lines.join('\n'), tools };
}

/** An asked item to one the village has words for: the same words folded (plurals too), or the one whose words contain the
 *  asked ones ("wool" -> "white wool"); null when none (an ask for what nobody can make: the world folds it into a proposal). */
export function resolveItem(asked: string, items: string[]): string | null {
  const fold = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/s\b/g, '');
  const a = fold(asked);
  if (!a) return null;
  return items.find((i) => fold(i) === a) ?? items.find((i) => new RegExp(`\\b${a}\\b`).test(fold(i))) ?? null;
}

/** The reply's outlet, and its item or words. */
export function parseOutlet(input: unknown, outlets: Outlet[]): { outlet: Outlet; reason: string; item?: string; what?: string } | null {
  let o = input as Record<string, unknown> | string | null;
  if (typeof o === 'string') {
    try { o = JSON.parse(o) as Record<string, unknown>; } catch { return null; }
  }
  if (!o || typeof o !== 'object') return null;
  for (const k of ['arguments', 'parameters', 'input']) if (o[k] && typeof o[k] === 'object' && !('choice' in o)) o = o[k] as Record<string, unknown>;
  const raw = typeof o.choice === 'string' ? o.choice.trim().replace(/(\s*\[[^\]]*\])+\s*$/, '') : '';
  const fold = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hit = outlets.find((x) => fold(x.name) === fold(raw)) ?? outlets.find((x) => raw.length >= 6 && fold(x.name).startsWith(fold(raw)));
  if (!hit) return null;
  const str = (k: string) => (typeof o![k] === 'string' && (o![k] as string).trim() ? (o![k] as string).trim().slice(0, 140) : undefined);
  return { outlet: hit, reason: (str('reason') ?? '').slice(0, 200), ...(str('item') ? { item: str('item') } : {}), ...(str('what') ? { what: str('what') } : {}) };
}
