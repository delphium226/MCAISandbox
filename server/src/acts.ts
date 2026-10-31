/**
 * Members' acts (G2, PLAN E.5, #29): requests, offers, accepts, declines, releases and reports carried by a decision's
 * reply (choose.ts), one validator for all of them, the inbox each member's next prompt shows, commitments closed by code
 * from world evidence (the promiser's chore ends), and lines said aloud to members near. World-free: the world tells it
 * what each member chose and how its chores ended, where members stand, which items and projects are on offer, and how to
 * show a line in the game; it answers with tags for the menu and the inbox's text. Spec: runs/2026-10-21/g2-social/spec.md
 * sections 3-4 and v2's changes.
 *
 * What an act may be about is what a chore end can settle (the user's, 10-21): an item into the village storage that a
 * gather or make option names (its option id, `gather:logs`, `make:torch`), or a step on an open project (`help:<id>`).
 * A promise is one chore of it: one gather trip, one make batch, one step.
 *
 * Settings (read once):
 *   MC_ACTS          off (default) | on: the act and say fields, the inbox, promises; needs MCAI_SOCIAL on, noblock or
 *                    countsonly (refused at start under off, ignored under legacy)
 *   MC_ACTS_EVERY    3: a member is offered an act at most once in this many model decisions
 *   MC_PROMISE_MIN   15: minutes a promise is due in (divided by MC_TIME_SCALE)
 */
import { limited } from './llmLimits';
import type { Commitment } from './social';
import { SOCIAL, memberSocial, noteHeard, noteKept, setActsOn } from './social';
import { MEMORY, addNoteCheck, clockOf, contentWords, logAct, membersOf, touchMemory, villageSocialOf } from './memory';
import { noteFact, think } from './character';
import { ESTEEM_ON, noteKeptTo } from './esteem';
import { rawSetting } from './settings';

const scale = Math.max(0.1, Number(rawSetting('MC_TIME_SCALE') ?? 1) || 1);
const wantActs = /^(on|1|true|yes)$/i.test(rawSetting('MC_ACTS') ?? '');
if (wantActs && SOCIAL.mode === 'off') throw new Error('MC_ACTS=on with MCAI_SOCIAL=off: acts are social perception; run arm (b2) with MC_ACTS=off');
if (wantActs && SOCIAL.mode === 'legacy') console.warn('[acts] MC_ACTS=on is ignored under MCAI_SOCIAL=legacy (set on, noblock or countsonly)');

export const ACTS = {
  on: wantActs && SOCIAL.mode !== 'legacy' && SOCIAL.mode !== 'off',
  every: Math.max(1, limited(rawSetting('MC_ACTS_EVERY'), 3, 1)),
  dueMs: (Number(rawSetting('MC_PROMISE_MIN') ?? 15) * 60000) / scale,
  /** Requests answered or not within this are closed (expired). */
  requestMs: (30 * 60000) / scale,
  /** Inbox items (reports, offers, lines heard) are shown for this long. */
  itemMs: (15 * 60000) / scale,
  /** A village day for the budget when there is no clock. */
  dayMs: (20 * 60000) / scale,
  budget: { request: 3, offer: 3, report: 2, release: 1 } as Record<string, number>,
  inbox: 4,
};
setActsOn(() => ACTS.on);

/**
 * #107 (the user's choices 10-23; all off): news and questions beside the acts, then council deliberation (council.ts).
 *   MC_NEWS          a `news` field: what a member saw, delivered to members within 16 blocks whether or not the pick ran,
 *                    in its own section; heard news passed on once, attributed ("Ada says ..."), unchecked (code tags it
 *                    checked, refuted or unchecked for the measures only)
 *   MC_QUESTIONS     a `question` field (and `question_to`): starts the addressee's answer call (the world's answerer), one
 *                    answerer for "anyone" chosen by code; an answer cannot ask or tell (depth 1); answers kept a village day
 *   MC_TALK_HOLDOUT  0.5 (on): a random half of news items and answers withheld per message, the would-be hearers logged
 *   MC_ACT_FIXES     on: bare tool words ("axe") map to a make option of that tool; a fixed or repeat pick of an option an
 *                    unpriced request asks for accepts it too
 */
const flag = (k: string) => /^(on|1|true|yes)$/i.test(rawSetting(k) ?? '');
const holdout = (rawSetting('MC_TALK_HOLDOUT') ?? '').trim();
export const TALK = {
  news: ACTS.on && flag('MC_NEWS'),
  questions: ACTS.on && flag('MC_QUESTIONS'),
  holdout: /^on$/i.test(holdout) ? 0.5 : Math.min(1, Math.max(0, Number(holdout) || 0)),
  fixes: ACTS.on && flag('MC_ACT_FIXES'),
  budget: { news: 4, question: 3 } as Record<string, number>,
  /** News is shown this long; answers a village day. */
  newsMs: ACTS.itemMs,
  answerMs: ACTS.dayMs,
  /** Lines a section shows. */
  show: 3,
};

/** Test hook. */
export function setActsSettings(s: Partial<typeof ACTS>): void {
  Object.assign(ACTS, s);
}
/** Test hook (#107). */
export function setTalkSettings(s: Partial<typeof TALK>): void {
  Object.assign(TALK, s);
}

export const ACT_TYPES = ['request', 'offer', 'accept', 'decline', 'release', 'report'] as const;
export type ActType = (typeof ACT_TYPES)[number];

/** What an act is about: an item option or a project. */
export interface What {
  kind: 'item' | 'project';
  /** The option id that settles it: gather:logs, make:torch, help:<project>. */
  option: string;
  /** In words, for prompts. */
  words: string;
  /** A project's owner. */
  owner?: string;
}

export interface Request {
  id: string;
  from: string;
  /** A member, or 'anyone' (the notice board). */
  to: string;
  what: What;
  made: number;
  state: 'open' | 'accepted' | 'expired' | 'moot';
  by?: string;
  declined?: string[];
  /** #108 (MC_PAY): emeralds offered for the delivery (a wage: per step, `steps` of them), held in pay.ts' contract. */
  price?: number;
  steps?: number;
  contract?: string;
  /** The test's bounty (MC_PAY_BOUNTY): the village pays, the goods go to storage. */
  bounty?: boolean;
}

/**
 * #108's pay hooks (MC_PAY; pay.ts and the world set them, acts.ts holds no money): a priced request's escrow, the pay act,
 * a priced promise taken, ended and closed. Unset, nothing here changes.
 */
export interface PayHooks {
  /** A request that passed every other check: hold its price (or draw the test's bounty); a refusal, the contract and
   *  price, or undefined for an unpriced request. */
  request(village: string, agent: string, r: Request, f: ActFields, now: number): string | { contract: string; price: number; steps: number; bounty?: boolean } | undefined;
  /** The pay act: the report for the payer (`ok`), or a refusal. */
  pay(village: string, agent: string, f: ActFields, now: number): { ok: boolean; text: string };
  /** A priced request taken up by a promise. */
  taken(village: string, r: Request, c: { id: string; from: string }, now: number): void;
  /** A priced promise's chore ended ok and productive: kept now (a wage's step, a bounty), delivering (the goods follow),
   *  or open (it put none of the goods: no evidence yet). */
  ended(village: string, r: Request, c: { id: string; from: string; to: string }, e: { option: string; chore: string }, now: number): 'kept' | 'delivering' | 'open';
  /** A priced request or promise closed otherwise (expired, moot, broken, released): its escrow refunded. */
  closed(village: string, r: Request, how: string, now: number): void;
  /** The acts paragraph's payment lines for the member (prices, the guide, its emeralds). */
  help(village: string, agent: string, now: number): string;
  /** Whether a fixed pick may accept this priced request (at or above the price guide). */
  acceptable(village: string, agent: string, r: Request, now: number): boolean;
}
let payHooks: PayHooks | null = null;
export function setPayHooks(h: PayHooks | null): void {
  payHooks = h;
}
const paying = () => !!payHooks;
/** Whether payments are on (the choose tool's schema adds the pay fields). */
export const payingOn = paying;

interface InboxItem {
  t: number;
  text: string;
  /** Lower first. */
  prio: number;
  kind: 'report' | 'offer' | 'said' | 'heard' | 'refused' | 'declined';
}

interface ActsState {
  next: number;
  requests: Request[];
  commitments: Array<Commitment & { what: Commitment['what'] & { words: string }; running?: string; request?: string; delivering?: number }>;
  inbox: Record<string, InboxItem[]>;
  /** Acts used per member, day and type. */
  used: Record<string, number>;
  /** The loop guard: act signature -> when. */
  recent: Record<string, number>;
  /** Commitment ids each member has heard reported (or was party to). */
  heard: Record<string, string[]>;
  /** Model decisions since each member's last offered-and-used act. */
  since: Record<string, number>;
  /** Fabrications: refused false claims, per member. */
  false: Record<string, number>;
  /** #107: news each member heard, the questions asked, and the answers each asker got. */
  news?: Record<string, NewsItem[]>;
  questions?: Question[];
  answers?: Record<string, AnswerItem[]>;
}

/** A news item as a hearer holds it: who told it, who first said it (a retelling's source), the tag code gave it. */
export interface NewsItem { id: string; t: number; from: string; origin: string; text: string; tag: NewsTag; retold?: boolean }
export type NewsTag = 'checked' | 'refuted' | 'unchecked';
export interface Question { id: string; from: string; to: string; anyone?: boolean; text: string; t: number; state: 'asking' | 'answered' | 'failed' | 'withheld'; answer?: string; answeredAt?: number }
export interface AnswerItem { id: string; t: number; from: string; question: string; text: string; tag: NewsTag }

function state(village: string): ActsState {
  const s = villageSocialOf(village) as { acts?: ActsState };
  return (s.acts ??= { next: 1, requests: [], commitments: [], inbox: {}, used: {}, recent: {}, heard: {}, since: {}, false: {} });
}

/** The ledger as it stands (tests, the panel). */
export function actsState(village: string): ActsState {
  return state(village);
}

const dayOf = (village: string, now: number) => clockOf(village, now)?.day ?? Math.floor(now / ACTS.dayMs);
const minsIn = (ms: number) => Math.max(0, Math.round(ms / 60000));
const ago = (ms: number) => (minsIn(ms) < 1 ? 'just now' : `${minsIn(ms)} min ago`);

function push(st: ActsState, to: string, item: Omit<InboxItem, 'prio'> & { prio?: number }) {
  const list = (st.inbox[to] ??= []);
  // (one refusal notice at a time: a new one replaces the old, the spec check's H6)
  if (item.kind === 'refused') for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === 'refused') list.splice(i, 1);
  list.push({ prio: PRIO[item.kind], ...item });
  if (list.length > 12) list.splice(0, list.length - 12);
}
const PRIO: Record<InboxItem['kind'], number> = { report: 2, declined: 2, offer: 3, refused: 4, heard: 5, said: 6 };

/** A report into a member's inbox from elsewhere (G5: a proposal's verdict), shown for ACTS.itemMs. */
export function tellMember(village: string, to: string, text: string, now = Date.now()): void {
  if (!ACTS.on) return;
  push(state(village), to, { t: now, kind: 'report', text });
  touchMemory();
}

/** Acts of the member refused since `t` (the refusal notices it was given): G5's reason to propose at night. */
export function refusedSince(village: string, agent: string, t: number): number {
  if (!ACTS.on) return 0;
  return (state(village).inbox[agent] ?? []).filter((i) => i.kind === 'refused' && i.t >= t).length;
}

// ---------------------------------------------------------------------------------------------
// What the world tells
// ---------------------------------------------------------------------------------------------

/** The village's items and projects on offer now, members' places, and the claims the world can check. */
export interface ActsWorld {
  /** Items a request may name: every good the village can make and every gather material, option id -> words. */
  items: Map<string, string>;
  /** Item options seen on any member's menu in the last 10 minutes (a promise of one off them all is moot); default items. */
  offered?: Set<string>;
  /** Open projects: option id (help:<id>) -> words and owner. */
  projects: Map<string, { words: string; owner: string }>;
  /** Members present and where they stand. */
  at: Map<string, { x: number; z: number }>;
  /** The world's check of a claim (WorldAdapter.verifyClaim): true, false, or a reason it is false. */
  verify?: (claim: { type: 'stock'; option: string }) => true | string;
  /** #107: code's tag on a news line or an answer (a shortage storage shows, or does not), for the measures only. */
  checkNews?: (text: string) => NewsTag;
  /** #107: who answers a question to anyone (the most practised member near the asker), or undefined. */
  answerer?: (asker: string, text: string) => string | undefined;
}

let speaker: ((village: string, agent: string, text: string) => void) | null = null;
/** How a line said aloud shows in the game (the world: tellraw, never bot chat, so no brain wakes on it). */
export function setSpeaker(fn: (village: string, agent: string, text: string) => void): void {
  speaker = fn;
}

/** MC_ACT_HINTS=on (#114, All1: 75 requests for axes nobody makes): a refused request is told what is close to it on offer,
 *  and that a tool nobody makes is not made here. */
const ACT_HINTS = /^(on|1|true|yes)$/i.test(rawSetting('MC_ACT_HINTS') ?? '');
const NOT_MADE = /\b(axe|sword|shovel|hoe|pickaxe|helmet|chestplate|boots|leggings|bow)s?\b/;
export function notOnOffer(w: Pick<ActsWorld, 'items'>, asked: string): string {
  const words = (t: string) => t.toLowerCase().replace(/[_:]/g, ' ').split(/[^a-z]+/).filter((x) => x.length > 2).map((x) => x.replace(/e?s$/, ''));
  const want = new Set(words(asked));
  const items = [...new Set(w.items.values())];
  const close = items.map((x) => ({ x, n: words(x).filter((t) => want.has(t)).length })).filter((q) => q.n > 0).sort((p, q) => q.n - p.n).map((q) => q.x);
  const tool = NOT_MADE.exec(asked.toLowerCase())?.[1];
  const madeTool = tool && items.some((x) => new RegExp(`\\b${tool}`).test(x));
  const list = (close.length ? close : items).slice(0, 5);
  return `${tool && !madeTool ? `; nobody makes ${tool}s here` : ''}${list.length ? `; you may ask for ${close.length ? 'e.g.' : 'items such as'} ${list.join(', ')}` : ''}`;
}

const near = (w: ActsWorld, a: string, range: number) => {
  const p = w.at.get(a);
  if (!p) return [] as string[];
  return [...w.at.entries()].filter(([n, q]) => n !== a && Math.hypot(q.x - p.x, q.z - p.z) <= range).map(([n]) => n);
};

// ---------------------------------------------------------------------------------------------
// The prompt: tags, the inbox, the acts on offer
// ---------------------------------------------------------------------------------------------

/** The menu's tags: an option answering a request to the member, an option keeping its promise. Option id -> tag. */
export function tags(village: string, agent: string, now: number): Map<string, string> {
  const out = new Map<string, string>();
  if (!ACTS.on) return out;
  const st = state(village);
  for (const c of st.commitments) if (c.state === 'open' && c.from === agent && !out.has(c.what.option ?? '')) {
    const left = c.due - now;
    out.set(c.what.option ?? '', `[your promise to ${c.to}, ${left > 0 ? `due in ${Math.max(1, minsIn(left))} min` : 'due now'}]`);
  }
  // (#108: a priced request's tag wins over an unpriced one on the same option)
  if (paying()) for (const r of st.requests) if (r.state === 'open' && r.price && r.from !== agent && !(r.declined ?? []).includes(agent) && (r.to === agent || r.to === 'anyone') && !out.has(r.what.option))
    out.set(r.what.option, `[${r.bounty ? 'the village' : r.from} pays ${r.price} emerald${r.price === 1 ? '' : 's'}${r.steps && r.steps > 1 ? ' a step' : ''}]`);
  for (const r of st.requests) if (r.state === 'open' && r.from !== agent && !(r.declined ?? []).includes(agent) && (r.to === agent || r.to === 'anyone') && !out.has(r.what.option))
    out.set(r.what.option, r.to === agent ? `[${r.from} asked you]` : `[${r.from} asked anyone]`);
  return out;
}

/** The member's inbox (at most ACTS.inbox lines by priority): requests to it, its promises, then reports, offers, lines heard. */
export function inbox(village: string, agent: string, now: number): string[] {
  if (!ACTS.on) return [];
  const st = state(village);
  const lines: Array<{ prio: number; t: number; text: string }> = [];
  for (const r of st.requests) if (r.state === 'open' && r.from !== agent && !(r.declined ?? []).includes(agent) && (r.to === agent || r.to === 'anyone'))
    lines.push(r.price && paying()
      // (#108: priced requests above lines heard; the price and where the goods go)
      ? { prio: r.to === agent ? 0 : 2, t: r.made, text: `${r.bounty ? `The village (for ${r.from})` : r.from} pays ${r.price} emerald${r.price === 1 ? '' : 's'}${r.steps && r.steps > 1 ? ` a step (${r.steps} steps)` : ''} ${r.to === agent ? 'you' : 'anyone'} to ${r.what.words}${r.what.kind === 'item' && !r.bounty ? `, into ${r.from}'s own chest` : ''} (${r.id}, ${ago(now - r.made)})` }
      : { prio: r.to === agent ? 0 : 7, t: r.made, text: `${r.from} asks ${r.to === agent ? 'you' : 'anyone'}: ${r.what.words} (${r.id}, ${ago(now - r.made)})` });
  for (const c of st.commitments) if (c.state === 'open' && c.from === agent)
    lines.push({ prio: 1, t: c.made, text: `You promised ${c.to}: ${c.what.words}, ${c.due > now ? `due in ${Math.max(1, minsIn(c.due - now))} min` : 'due now'} (${c.id})` });
  for (const i of st.inbox[agent] ?? []) if (now - i.t < ACTS.itemMs) lines.push({ prio: i.prio, t: i.t, text: `${i.text} (${ago(now - i.t)})` });
  return lines.sort((x, y) => x.prio - y.prio || y.t - x.t).slice(0, ACTS.inbox).map((l) => l.text);
}

/** Whether the member may add an act (and a line) to this decision: once in ACTS.every model decisions. */
export function mayAct(village: string, agent: string): boolean {
  return ACTS.on && (state(village).since[agent] ?? ACTS.every) >= ACTS.every - 1;
}

/** The acts paragraph of the prompt, or '' when none is offered. */
export function actsHelp(village: string, agent: string, now: number, w: ActsWorld): string {
  if (!mayAct(village, agent)) return '';
  const st = state(village);
  const d = dayOf(village, now);
  const left = (t: string) => Math.max(0, ACTS.budget[t] - (st.used[`${agent}|${d}|${t}`] ?? 0));
  // (the items on menus lately first; a request may name any other good or material too)
  const lately = [...w.items.entries()].filter(([o]) => !w.offered || w.offered.has(o)).map(([, x]) => x);
  const items = [...new Set([...lately, ...w.items.values()])].slice(0, 14);
  const nearBy = near(w, agent, 32).slice(0, 6);
  return [
    'You may add one act to this choice when another member could help you or you could help one: request (ask a member, or anyone, for an item put into storage or for help on a project), '
    + 'offer (promise a member the item or project of the option you choose), accept or decline (a request to you, by its id; choosing the option a request asks for accepts it), '
    + 'release (one promise of yours, by its id), report (tell those near you that a member kept or broke a promise you know of: act_to the member, act_claim kept or broke).',
    `Items (any good the village can make or a raw material; a request makes it wanted): ${items.join(', ') || 'none now'}${w.items.size > items.length ? ', ...' : ''}.${w.projects.size ? ` Projects: ${[...w.projects.entries()].slice(0, 4).map(([o, p]) => `${p.words} (${p.owner}, ${o})`).join('; ')}.` : ''}`,
    `Members near you: ${nearBy.join(', ') || 'nobody'}. Left today: ${left('request')} requests, ${left('offer')} offers, ${left('report')} reports.`,
    'You may also say one short line aloud to those near you (`say`), about your choice or your act.',
    ...(paying() ? [payHooks!.help(village, agent, now)].filter(Boolean) : []),
    // (#107: news and questions, each with its own budget)
    talkHelpText(Math.max(0, TALK.budget.news - (st.used[`${agent}|${d}|news`] ?? 0)), Math.max(0, TALK.budget.question - (st.used[`${agent}|${d}|question`] ?? 0))),
  ].filter(Boolean).join(' ');
}

/** #107: the acts paragraph's news and question lines (talkbench's second wording: concrete cases to tell and to ask; the
 *  first, "you may pass on news ... a shortage, a failure", drew news in 1-3% of replies and no question). */
export function talkHelpText(newsLeft: number, questionsLeft: number): string {
  return [
    TALK.news ? `News (\`news\`): when you know something those near you may not (the storage short of food or a material, a chore that keeps failing and why, where you saw ore, animals or trees, what a member did), tell it in one short line; it reaches them even if your choice is taken. News you heard may be passed on once: say who said it. News left today: ${newsLeft}.` : '',
    TALK.questions ? `Questions (\`question\`, with \`question_to\`: a member, or anyone): when you need to know something another member may know (where to find a material, why a chore fails, what someone needs), ask it; the answer reaches you within minutes. Questions left today: ${questionsLeft}.` : '',
  ].filter(Boolean).join(' ');
}

/** #107: the member's news section (the newest TALK.show items heard within TALK.newsMs), apart from the inbox. */
export function newsLines(village: string, agent: string, now: number): string[] {
  if (!TALK.news) return [];
  return (state(village).news?.[agent] ?? []).filter((n) => now - n.t < TALK.newsMs).sort((x, y) => y.t - x.t).slice(0, TALK.show)
    .map((n) => `${n.from === n.origin ? `${n.from} says` : `${n.from} says ${n.origin} said`}: "${n.text}" (${ago(now - n.t)})`);
}

/**
 * M3 (MC_MONUMENT_NEWS with MC_NEWS): a news item code knows to be true (the cathedral's start, a stage's end), told by
 * `from` to every hearer named, tagged checked and logged like a member's; it may be retold once like any news.
 */
export function codeNews(village: string, from: string, text: string, hearers: string[], now: number): void {
  if (!TALK.news) return;
  const st = state(village);
  const id = `n${st.next++}`;
  const to = hearers.filter((h) => h !== from);
  for (const h of to) {
    const list = ((st.news ??= {})[h] ??= []);
    list.push({ id, t: now, from, origin: from, text, tag: 'checked' });
    if (list.length > 12) list.splice(0, list.length - 12);
  }
  logAct({ type: 'news', village, agent: from, id, text, tag: 'checked', origin: from, hearers: to, by: 'code' });
}

/** #107: the answers to the member's questions (kept a village day), newest first. */
export function answerLines(village: string, agent: string, now: number): string[] {
  if (!TALK.questions) return [];
  return (state(village).answers?.[agent] ?? []).filter((a) => now - a.t < TALK.answerMs).sort((x, y) => y.t - x.t).slice(0, TALK.show)
    .map((a) => `${a.from} answered your question "${a.question.length > 60 ? `${a.question.slice(0, 57)}...` : a.question}": "${a.text}" (${ago(now - a.t)})`);
}

// ---------------------------------------------------------------------------------------------
// The reply: parse, validate, apply
// ---------------------------------------------------------------------------------------------

export interface ActFields {
  act?: string;
  act_to?: string;
  act_item?: string;
  act_project?: string;
  act_ref?: string;
  act_claim?: string;
  /** #108 (MC_PAY): a request's price (a wage's per step), a wage's steps, the pay act's amount. */
  act_price?: string;
  act_steps?: string;
  act_amount?: string;
  say?: string;
  /** #107 (MC_NEWS, MC_QUESTIONS): a news line; a question and whom it is for. */
  news?: string;
  question?: string;
  question_to?: string;
}

/** The act fields of a choose call's input: flat, or an `act` object or JSON string (gpt-oss nests and ignores enums). */
export function actFields(input: unknown): ActFields {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);
  let act: unknown = o.act;
  if (typeof act === 'string' && act.trim().startsWith('{')) {
    try { act = JSON.parse(act); } catch { /* left as text */ }
  }
  const out: ActFields = {};
  if (act && typeof act === 'object') {
    const a = act as Record<string, unknown>;
    out.act = str(a.type ?? a.act ?? a.kind);
    out.act_to = str(a.to ?? a.act_to ?? a.member ?? a.about);
    out.act_item = str(a.item ?? a.act_item);
    out.act_project = str(a.project ?? a.act_project);
    out.act_ref = str(a.ref ?? a.id ?? a.act_ref);
    out.act_claim = str(a.claim ?? a.act_claim);
  } else out.act = str(act);
  for (const k of ['act_to', 'act_item', 'act_project', 'act_ref', 'act_claim'] as const) out[k] ??= str(o[k]);
  // (#108: the payment fields, read only while payments are on, so the log's fields are as before with MC_PAY off)
  if (paying()) {
    const a = (act && typeof act === 'object' ? act : {}) as Record<string, unknown>;
    out.act_price = str(a.price ?? a.cost ?? a.act_price ?? o.act_price ?? o.price ?? o.cost);
    out.act_steps = str(a.steps ?? a.act_steps ?? o.act_steps ?? o.steps);
    out.act_amount = str(a.amount ?? a.count ?? a.act_amount ?? o.act_amount ?? o.amount ?? o.count);
  }
  const say = str(o.say);
  if (say) out.say = say.replace(/\s+/g, ' ').slice(0, 120);
  // (#107: read only while their flags are on, so the log's fields are as before with them off)
  const line = (v: unknown) => str(v)?.replace(/\s+/g, ' ').slice(0, 160);
  if (TALK.news) out.news = line(o.news);
  if (TALK.questions) {
    out.question = line(o.question);
    out.question_to = str(o.question_to ?? o.ask_to ?? o.question_for);
  }
  for (const k of Object.keys(out) as Array<keyof ActFields>) if (out[k] === undefined) delete out[k];
  return out;
}

/** The chosen option as the acts see it. */
export interface Chosen {
  option: string;
  kind: string;
  name: string;
  decisionId?: string;
  /** The chore it started: a promise of this option made now is kept by it. */
  chore?: string;
}

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** An item option by the model's word ("logs", "torch", "gather:logs"), or undefined. */
function itemOf(w: ActsWorld, raw: string | undefined): What | undefined {
  if (!raw) return undefined;
  // (gpt-oss names blocks: "birch_log", "oak logs", "wood")
  if (/(^|_|\s)(logs?|wood)$/i.test(raw.trim()) && w.items.has('gather:logs')) raw = 'gather:logs';
  const f = fold(raw);
  // (#184: an iron tool asked by its name, "shears" against iron:forge:shears, "an iron tool: shears")
  for (const [option, words] of w.items) if (fold(option) === f || fold(words) === f || fold(option.split(':')[1] ?? '') === f || fold(option.split(':').at(-1) ?? '') === f
    || fold(words.replace(/^an iron tool:\s*/, '')) === f || fold(words).replace(/s$/, '') === f.replace(/s$/, ''))
    return { kind: 'item', option, words: `${option.startsWith('make:') ? 'make' : 'gather'} ${words}` };
  // (#107's fix, MC_ACT_FIXES: a bare tool word, "axe" or "an axe", is the best make option of that tool: Long4's 28
  // refused requests for "axe" while make:wooden_axe was on offer)
  const tool = TALK.fixes ? /^(?:an?\s+)?(axe|pickaxe|shovel|hoe|sword|fishing rod)s?$/i.exec(raw.trim())?.[1]?.toLowerCase().replace(' ', '_') : undefined;
  if (tool) {
    const RANK = ['iron', 'stone', 'wooden'];
    const hit = [...w.items.entries()].filter(([o]) => o.startsWith('make:') && new RegExp(`(^|_)${tool}$`).test(o.slice(5)))
      .sort(([p], [q]) => (RANK.indexOf(p.slice(5).split('_')[0]) + 9) % 9 - (RANK.indexOf(q.slice(5).split('_')[0]) + 9) % 9)[0];
    if (hit) return { kind: 'item', option: hit[0], words: `make ${hit[1]}` };
  }
  return undefined;
}
function projectOf(w: ActsWorld, raw: string | undefined): What | undefined {
  if (!raw) return undefined;
  const f = fold(raw);
  for (const [option, p] of w.projects) if (fold(option) === f || fold(option.split(':')[1] ?? '') === f || fold(p.words) === f || f.includes(fold(p.words)))
    return { kind: 'project', option, words: `help with ${p.owner}'s ${p.words}`, owner: p.owner };
  return undefined;
}
/** What the chosen option settles, if it is an item or a project option. */
function whatOfChosen(w: ActsWorld, c: Chosen): What | undefined {
  if (w.items.has(c.option)) return { kind: 'item', option: c.option, words: `${c.option.startsWith('make:') ? 'make' : 'gather'} ${w.items.get(c.option)}` };
  const p = w.projects.get(c.option);
  if (p) return { kind: 'project', option: c.option, words: `help with ${p.owner}'s ${p.words}`, owner: p.owner };
  return undefined;
}

function memberNamed(village: string, raw: string | undefined, self: string): string | undefined {
  if (!raw) return undefined;
  const f = fold(raw);
  if (f === 'anyone' || f === 'everyone' || f === 'all') return 'anyone';
  return membersOf(village).map((m) => m.name).find((n) => fold(n) === f && n !== self);
}

/** Act words gpt-oss writes outside the enum (G2a: "help" twice), as the act they mean. */
const ALIASES: Record<string, ActType> = { help: 'offer', promise: 'offer', give: 'offer', ask: 'request', need: 'request', tell: 'report', gossip: 'report', refuse: 'decline', withdraw: 'release' };

/** The demand members' acts make for an option: its open requests and its open promises (an item a member asked for is
 *  wanted until the request closes, then until the promise that took it up closes: S2's makes failed "at stock" once
 *  accepting closed the request). */
/** The members whose open requests name this option (G8: a forge option is for its asker). */
export function requestersOf(village: string, option: string): string[] {
  if (!ACTS.on) return [];
  return state(village).requests.filter((r) => r.state === 'open' && r.what.option === option).map((r) => r.from);
}

export function openRequests(village: string, option: string): number {
  if (!ACTS.on) return 0;
  const st = state(village);
  return st.requests.filter((r) => r.state === 'open' && r.what.option === option).length
    + st.commitments.filter((c) => c.state === 'open' && c.what.option === option).length;
}

const sig = (agent: string, type: string, to: string, what: string) => `${agent}|${type}|${to}|${what}`;

function commit(st: ActsState, village: string, from: string, to: string, what: What, now: number, how: string, decisionId?: string, chore?: string) {
  const c: ActsState['commitments'][number] = { id: `c${st.next++}`, from, to, what: { kind: what.kind, option: what.option, words: what.words }, made: now, due: now + ACTS.dueMs, state: 'open' as const, ...(chore ? { running: chore } : {}) };
  st.commitments.push(c);
  (st.heard[from] ??= []).push(c.id);
  (st.heard[to] ??= []).push(c.id);
  logAct({ type: 'commitment', op: 'made', village, id: c.id, from, to, option: what.option, words: what.words, how, due: c.due, decisionId });
  return c;
}

/**
 * A decision's acts (spec 4.2's validator in order: shape, budget, loop guard, claims, novelty), and its line said.
 * Accepting is implied by choosing an option a request asks for. A decision whose pick did not run (taken, re-asked:
 * `ran` false; about half of model decisions, G2a) keeps the acts that do not depend on the pick (request, decline,
 * release, report); its offer, accept and line are dropped. Returns what happened, for the log and tests.
 */
export function handle(village: string, agent: string, fields: ActFields, chosen: Chosen, w: ActsWorld, now: number, ran = true): string[] {
  if (!ACTS.on) return [];
  const st = state(village);
  const done: string[] = [];
  const offered = mayAct(village, agent);
  st.since[agent] = (st.since[agent] ?? ACTS.every) + 1;
  const d = dayOf(village, now);
  const mine = ran ? whatOfChosen(w, chosen) : undefined;

  // (accepting by choosing: a direct request first, else the board's oldest)
  if (mine) {
    const r = st.requests.find((q) => q.state === 'open' && q.to === agent && q.from !== agent && q.what.option === mine.option)
      ?? st.requests.find((q) => q.state === 'open' && q.to === 'anyone' && q.from !== agent && q.what.option === mine.option && !(q.declined ?? []).includes(agent));
    if (r && !st.commitments.some((c) => c.state === 'open' && c.from === agent && c.what.option === mine.option)) {
      // (#108: a wage stays open for more helpers until its steps are paid)
      const wage = paying() && !!r.contract && r.what.kind === 'project';
      if (!wage) {
        r.state = 'accepted';
        r.by = agent;
      }
      noteFact(village, r.from, agent, 'accepted');
      const c = commit(st, village, agent, r.from, mine, now, `accepted ${r.id}`, chosen.decisionId, chosen.chore);
      if (paying() && r.contract) {
        c.request = r.id;
        payHooks!.taken(village, r, c, now);
      }
      logAct({ type: 'act', village, agent, act: 'accept', ref: r.id, implied: true, verdict: 'ok', decisionId: chosen.decisionId });
      push(st, r.from, { t: now, kind: 'report', text: `${agent} took up your request: ${r.what.words} (${c.id})` });
      done.push(`accept ${r.id}`);
    }
  }

  let act = fields.act?.toLowerCase().trim();
  // (#108: pay, and give with a member and an amount, is the pay act while payments are on)
  if (paying() && act && (/^pay/.test(act) || (/^(give|gift|tip)/.test(act) && fields.act_to && fields.act_amount))) act = 'pay';
  if (act && !(ACT_TYPES as readonly string[]).includes(act) && act !== 'pay') act = (ACT_TYPES as readonly string[]).find((t) => act!.startsWith(t)) ?? ALIASES[act] ?? act;
  const refuse = (why: string, tell = true, fabricated = false) => {
    logAct({ type: 'act', village, agent, act, ...fields, verdict: 'refused', why, decisionId: chosen.decisionId });
    if (tell) push(st, agent, { t: now, kind: 'refused', text: `Your ${act} was not made: ${why}` });
    if (fabricated) st.false[agent] = (st.false[agent] ?? 0) + 1;
    done.push(`refused ${act}: ${why}`);
  };
  if (act && act !== 'none' && act !== 'accept') {
    if (!offered) {
      logAct({ type: 'act', village, agent, act, ...fields, verdict: 'ignored', why: 'not offered this decision', decisionId: chosen.decisionId });
      done.push(`ignored ${act}`);
    } else if (!(ACT_TYPES as readonly string[]).includes(act) && !(act === 'pay' && paying())) refuse(`"${act}" is not an act`, false);
    else if ((ACTS.budget[act] ?? Infinity) <= (st.used[`${agent}|${d}|${act}`] ?? 0)) refuse(`no ${act}s left today`);
    else {
      const to = memberNamed(village, fields.act_to, agent);
      const ok = (type: string, key: string, extra: Record<string, unknown>) => {
        st.used[`${agent}|${d}|${type}`] = (st.used[`${agent}|${d}|${type}`] ?? 0) + 1;
        st.recent[key] = now;
        st.since[agent] = 0;
        logAct({ type: 'act', village, agent, act: type, verdict: 'ok', decisionId: chosen.decisionId, ...extra });
        done.push(type);
      };
      const looped = (key: string) => now - (st.recent[key] ?? -Infinity) < 60 * 60000 / scale;
      if (act === 'request') {
        const what = projectOf(w, fields.act_project) ?? itemOf(w, fields.act_item) ?? projectOf(w, fields.act_item) ?? itemOf(w, fields.act_project);
        const key = what ? sig(agent, 'request', to ?? '', what.option) : '';
        if (!to) refuse(fields.act_to ? `${fields.act_to} is not a member here` : 'a request needs act_to: a member or anyone', false);
        else if (!what) refuse(`"${fields.act_item ?? fields.act_project ?? ''}" is not an item or project on offer now${ACT_HINTS ? notOnOffer(w, String(fields.act_item ?? fields.act_project ?? '')) : ''}`, false);
        else if (looped(key)) refuse('you made the same request within the hour');
        else {
          const v = what.kind === 'item' && w.verify ? w.verify({ type: 'stock', option: what.option }) : true;
          if (v !== true) refuse(v);
          else {
            const r: Request = { id: `r${st.next++}`, from: agent, to, what, made: now, state: 'open' };
            // (#108: a price held last, after every other check, so a refusal holds nothing)
            const priced = paying() ? payHooks!.request(village, agent, r, fields, now) : undefined;
            if (typeof priced === 'string') refuse(priced);
            else {
              if (priced) Object.assign(r, { contract: priced.contract, price: priced.price, ...(priced.steps > 1 ? { steps: priced.steps } : {}), ...(priced.bounty ? { bounty: true } : {}) });
              st.requests.push(r);
              ok('request', key, { id: r.id, to, option: what.option, words: what.words, ...(r.price ? { price: r.price, steps: r.steps ?? 1, contract: r.contract } : {}) });
            }
          }
        }
      } else if (act === 'pay') {
        const p = payHooks!.pay(village, agent, fields, now);
        if (!p.ok) refuse(p.text);
        else ok('pay', sig(agent, 'pay', fields.act_to ?? '', String(now)), { to: fields.act_to, item: fields.act_item ?? 'emerald', amount: fields.act_amount, text: p.text });
      } else if (act === 'offer' && !ran) {
        logAct({ type: 'act', village, agent, act, ...fields, verdict: 'ignored', why: 'the pick did not run', decisionId: chosen.decisionId });
        done.push('ignored offer: the pick did not run');
      } else if (act === 'offer') {
        const what = mine;
        const named = projectOf(w, fields.act_project) ?? itemOf(w, fields.act_item);
        if (!to || to === 'anyone') refuse('an offer needs act_to: a member', false);
        else if (!what) refuse('an offer must be for the item or project of the option you chose', false);
        else if (named && named.option !== what.option) {
          logAct({ type: 'act', village, agent, act, ...fields, verdict: 'refused', why: 'not the chosen option', decisionId: chosen.decisionId });
          done.push('refused offer: not the chosen option');
        } else if (looped(sig(agent, 'offer', to, what.option))) refuse('you made the same offer within the hour');
        else {
          const c = commit(st, village, agent, to, what, now, 'offered', chosen.decisionId, chosen.chore);
          push(st, to, { t: now, kind: 'offer', text: `${agent} promised you: ${what.words}, due in ${minsIn(ACTS.dueMs)} min (${c.id})` });
          ok('offer', sig(agent, 'offer', to, what.option), { id: c.id, to, option: what.option });
        }
      } else if (act === 'decline') {
        const r = st.requests.find((q) => q.id === fields.act_ref && q.state === 'open' && (q.to === agent || q.to === 'anyone') && q.from !== agent);
        if (!r) refuse(`no open request ${fields.act_ref ?? ''} to you`, false);
        else {
          (r.declined ??= []).push(agent);
          noteFact(village, r.from, agent, 'refused');
          think(village, r.from, 'refused', `${agent} declined your request`, now);
          if (r.to === agent) push(st, r.from, { t: now, kind: 'declined', text: `${agent} declined your request: ${r.what.words}` });
          ok('decline', sig(agent, 'decline', r.id, ''), { ref: r.id });
        }
      } else if (act === 'release') {
        const c = st.commitments.find((x) => x.id === fields.act_ref && x.state === 'open' && x.from === agent);
        if (!c) refuse(`no open promise ${fields.act_ref ?? ''} of yours`, false);
        else {
          close(st, village, c, 'released', now, 'released by its promiser');
          ok('release', sig(agent, 'release', c.id, ''), { ref: c.id });
        }
      } else if (act === 'report') {
        const claim = /kept/i.test(fields.act_claim ?? '') ? 'kept' : /brok|break/i.test(fields.act_claim ?? '') ? 'broken' : undefined;
        const known = st.heard[agent] ?? [];
        const about = to && to !== 'anyone' ? to : undefined;
        const cands = st.commitments.filter((c) => known.includes(c.id) && (c.state === 'kept' || c.state === 'broken') && (!about || c.from === about) && (!fields.act_ref || c.id === fields.act_ref));
        if (!about) refuse('a report needs act_to: the member it is about', false);
        else if (!claim) refuse('a report needs act_claim: kept or broke', false);
        else if (!cands.length) refuse(`you know of no closed promise of ${about}'s`, true, true);
        else {
          const c = cands.find((x) => x.state === claim);
          if (!c) refuse(`${about} ${cands[cands.length - 1].state === 'kept' ? 'kept' : 'broke'} that promise`, true, true);
          else if (looped(sig(agent, 'report', about, c.id))) refuse('you reported that within the hour');
          else {
            // (novelty: not those who know already; the one it is about is left out)
            const hearers = near(w, agent, 16).filter((h) => h !== about && !(st.heard[h] ?? []).includes(c.id));
            for (const h of hearers) {
              (st.heard[h] ??= []).push(c.id);
              noteHeard(village, h, about, claim === 'kept');
              push(st, h, { t: now, kind: 'heard', text: `${agent} says ${about} ${claim === 'kept' ? 'kept' : 'broke'} a promise to ${c.to === agent ? agent : c.to}: ${c.what.words} (${c.id})` });
            }
            ok('report', sig(agent, 'report', about, c.id), { about, claim, ref: c.id, hearers });
          }
        }
      }
    }
  }

  // (#107: news and a question do not depend on the pick: kept when it did not run)
  if (TALK.news && fields.news && offered) news(st, village, agent, fields.news, chosen, w, now, done, d);
  if (TALK.questions && fields.question && offered) question(st, village, agent, fields, chosen, w, now, done, d);
  if (fields.say && offered && ran) say(st, village, agent, fields.say, chosen, fields, w, now, done);
  else if (fields.say && offered) logAct({ type: 'say', village, agent, text: fields.say, dropped: 'the pick did not run', decisionId: chosen.decisionId });
  touchMemory();
  return done;
}

const PROMISE = /\b(i('|’)?ll|i will|i'm going to|i am going to|i promise|i can bring|let me)\b/i;

/** A line said aloud (spec 3.3, 4.4): about the choice or the act, else dropped; an unbacked promise becomes an offer when
 *  code can read it, else is dropped; delivered to members within 16 blocks and shown in the game. */
function say(st: ActsState, village: string, agent: string, text: string, chosen: Chosen, f: ActFields, w: ActsWorld, now: number, done: string[]) {
  const words = contentWords(text);
  const about = new Set([...contentWords(chosen.name), ...contentWords(chosen.kind), ...contentWords(f.act_item ?? ''), ...contentWords(f.act_project ?? ''), ...contentWords(w.items.get(chosen.option) ?? '')]);
  const names = membersOf(village).map((m) => m.name).filter((n) => n !== agent && new RegExp(`\\b${n}\\b`).test(text));
  const onTopic = [...words].some((x) => about.has(x)) || (!!f.act_to && names.includes(f.act_to));
  if (!onTopic) {
    logAct({ type: 'say', village, agent, text, dropped: 'off-topic', decisionId: chosen.decisionId });
    done.push('say dropped: off-topic');
    return;
  }
  if (PROMISE.test(text) && names.length && (!f.act || f.act === 'none')) {
    const what = whatOfChosen(w, chosen);
    const to = names[0];
    if (what && !st.commitments.some((c) => c.state === 'open' && c.from === agent && c.to === to && c.what.option === what.option)) {
      const c = commit(st, village, agent, to, what, now, 'said', chosen.decisionId, chosen.chore);
      push(st, to, { t: now, kind: 'offer', text: `${agent} promised you: ${what.words}, due in ${minsIn(ACTS.dueMs)} min (${c.id})` });
      done.push('say became an offer');
    } else if (!what) {
      logAct({ type: 'say', village, agent, text, dropped: 'unbacked promise', decisionId: chosen.decisionId });
      done.push('say dropped: unbacked promise');
      return;
    }
  }
  const hearers = near(w, agent, 16);
  for (const h of hearers) push(st, h, { t: now, kind: 'said', text: `${agent} said: "${text}"` });
  logAct({ type: 'say', village, agent, text, hearers, decisionId: chosen.decisionId });
  try {
    speaker?.(village, agent, text);
  } catch {
    // (display only)
  }
  done.push('say');
}

// ---------------------------------------------------------------------------------------------
// #107: news and questions
// ---------------------------------------------------------------------------------------------

/** The holdout's draw for one message, seeded by its id (a replayed run withholds the same ones). */
function withheld(village: string, id: string): boolean {
  if (!TALK.holdout) return false;
  let h = 0x811c9dc5;
  for (const c of `${village}|${id}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
  return h / 2 ** 32 < TALK.holdout;
}

/** The news item a line retells: one the member heard sharing 3+ content words and half the shorter's (TalkOn: with 2,
 *  "the storage is short of glass" retold "... short of torches"). */
function retellOf(st: ActsState, agent: string, words: Set<string>): NewsItem | undefined {
  let best: { n: NewsItem; k: number } | undefined;
  for (const n of st.news?.[agent] ?? []) {
    const theirs = contentWords(n.text);
    const k = [...words].filter((x) => theirs.has(x)).length;
    if (k >= 3 && k >= 0.5 * Math.min(words.size, theirs.size) && (!best || k > best.k)) best = { n, k };
  }
  return best?.n;
}

/**
 * A news line (MC_NEWS): budget and loop guard, then delivered to members within 16 blocks who have not heard it, in their
 * news section, attributed; a retelling of news heard carries its first teller, and news retold once is not passed on
 * again. Code tags it checked, refuted or unchecked (logged; it passes either way, the user's choice 2); the holdout
 * withholds a random share, logging who would have heard it.
 */
function news(st: ActsState, village: string, agent: string, text: string, chosen: Chosen, w: ActsWorld, now: number, done: string[], d: number) {
  const used = `${agent}|${d}|news`;
  const words = contentWords(text);
  const refuse = (why: string) => {
    logAct({ type: 'news', village, agent, text, dropped: why, decisionId: chosen.decisionId });
    done.push(`news dropped: ${why}`);
  };
  if ((st.used[used] ?? 0) >= TALK.budget.news) return refuse('no news left today');
  if (words.size < 2) return refuse('too short to say anything');
  const key = sig(agent, 'news', '', [...words].sort().slice(0, 6).join(','));
  if (now - (st.recent[key] ?? -Infinity) < 60 * 60000 / scale) return refuse('the same news within the hour');
  const of = retellOf(st, agent, words);
  if (of?.retold) return refuse(`passed on once already (${of.origin}'s, through ${of.from})`);
  st.used[used] = (st.used[used] ?? 0) + 1;
  st.recent[key] = now;
  const id = `n${st.next++}`;
  const origin = of ? of.origin : agent;
  const tag: NewsTag = w.checkNews?.(text) ?? 'unchecked';
  // (novelty: not who already holds this news, nor its first teller)
  const known = (h: string) => (st.news?.[h] ?? []).some((n) => n.id === (of?.id ?? id));
  const near16 = near(w, agent, 16).filter((h) => h !== origin && !known(h));
  const out = withheld(village, id);
  if (!out) for (const h of near16) {
    const list = ((st.news ??= {})[h] ??= []);
    list.push({ id: of?.id ?? id, t: now, from: agent, origin, text, tag, ...(of ? { retold: true } : {}) });
    if (list.length > 12) list.splice(0, list.length - 12);
  }
  logAct({ type: 'news', village, agent, id, text, tag, origin, ...(of ? { retellOf: of.id, heardFrom: of.from } : {}), ...(out ? { withheld: near16 } : { hearers: near16 }), decisionId: chosen.decisionId });
  done.push(out ? 'news withheld' : of ? 'news retold' : 'news');
}

/** The world's answer call for a question (MC_QUESTIONS): set once by the world; it calls deliverAnswer or failAnswer. */
let answerHook: ((village: string, q: Question) => void) | null = null;
export function setAnswerer(fn: ((village: string, q: Question) => void) | null): void {
  answerHook = fn;
}

/**
 * A question (MC_QUESTIONS): to a member named, or to anyone (one answerer code picks near the asker); budget and loop
 * guard; it starts the addressee's answer call (the world's hook). The holdout draws for the answer's delivery
 * (deliverAnswer), not here: the answer is still asked, so the would-be answer is known.
 */
function question(st: ActsState, village: string, agent: string, f: ActFields, chosen: Chosen, w: ActsWorld, now: number, done: string[], d: number) {
  const text = f.question!;
  const used = `${agent}|${d}|question`;
  const refuse = (why: string) => {
    logAct({ type: 'question', village, agent, text, to: f.question_to, dropped: why, decisionId: chosen.decisionId });
    push(st, agent, { t: now, kind: 'refused', text: `Your question was not asked: ${why}` });
    done.push(`question dropped: ${why}`);
  };
  if ((st.used[used] ?? 0) >= TALK.budget.question) return refuse('no questions left today');
  const named = memberNamed(village, f.question_to ?? 'anyone', agent);
  if (!named) return refuse(`${f.question_to} is not a member here`);
  const to = named === 'anyone' ? w.answerer?.(agent, text) : named;
  if (!to) return refuse('nobody near you to ask');
  const key = sig(agent, 'question', to, [...contentWords(text)].sort().slice(0, 6).join(','));
  if (now - (st.recent[key] ?? -Infinity) < 60 * 60000 / scale) return refuse(`you asked ${to} that within the hour`);
  st.used[used] = (st.used[used] ?? 0) + 1;
  st.recent[key] = now;
  const q: Question = { id: `q${st.next++}`, from: agent, to, ...(named === 'anyone' ? { anyone: true } : {}), text, t: now, state: 'asking' };
  (st.questions ??= []).push(q);
  if (st.questions.length > 300) st.questions = st.questions.filter((x, i) => x.state === 'asking' || i >= st.questions!.length - 200);
  logAct({ type: 'question', village, agent, id: q.id, to, anyone: named === 'anyone', text, decisionId: chosen.decisionId });
  done.push(`question ${q.id} to ${to}`);
  try {
    if (answerHook) answerHook(village, q);
    else failAnswer(village, q.id, 'no answerer in this world');
  } catch (e) {
    failAnswer(village, q.id, String((e as Error)?.message ?? e).slice(0, 120));
  }
}

/** The answer to a question (the world's answer call): into the asker's answers section unless the holdout withholds it. */
export function deliverAnswer(village: string, id: string, text: string, tag: NewsTag = 'unchecked', now = Date.now(), ms?: number): boolean {
  if (!ACTS.on) return false;
  const st = state(village);
  const q = st.questions?.find((x) => x.id === id && x.state === 'asking');
  if (!q) return false;
  const answer = text.replace(/\s+/g, ' ').trim().slice(0, 240);
  const out = withheld(village, id);
  Object.assign(q, { state: out ? 'withheld' : 'answered', answer, answeredAt: now });
  if (!out) {
    const list = ((st.answers ??= {})[q.from] ??= []);
    list.push({ id, t: now, from: q.to, question: q.text, text: answer, tag });
    if (list.length > 8) list.splice(0, list.length - 8);
  }
  logAct({ type: 'answer', village, id, from: q.to, to: q.from, question: q.text, text: answer, tag, ...(out ? { withheld: true } : {}), ...(ms !== undefined ? { ms } : {}) });
  touchMemory();
  return true;
}

/** A question whose answer call failed (budget, error, the answerer gone): closed, the asker told nothing. */
export function failAnswer(village: string, id: string, why: string): void {
  const q = state(village).questions?.find((x) => x.id === id && x.state === 'asking');
  if (!q) return;
  q.state = 'failed';
  logAct({ type: 'answer', village, id, from: q.to, to: q.from, failed: why });
}

/** The questions open or answered in a village (the panel, the staged check). */
export function questionsOf(village: string): Question[] {
  return state(village).questions ?? [];
}

// ---------------------------------------------------------------------------------------------
// Commitments closed by code
// ---------------------------------------------------------------------------------------------

function close(st: ActsState, village: string, c: ActsState['commitments'][number], s: 'kept' | 'broken' | 'released' | 'moot', now: number, evidence: string) {
  c.state = s;
  c.closedAt = now;
  c.evidence = evidence;
  delete c.delivering;
  logAct({ type: 'commitment', op: s, village, id: c.id, from: c.from, to: c.to, option: c.what.option, evidence, late: s === 'kept' && now > c.due });
  // (#108: a priced promise closed otherwise than kept refunds its contract; a wage's request stays open for others)
  if (paying() && c.request && s !== 'kept') {
    const r = st.requests.find((q) => q.id === c.request);
    if (r?.contract && r.what.kind !== 'project') payHooks!.closed(village, r, `its promise ${c.id} ${s}`, now);
  }
  if (s === 'kept' || s === 'broken') {
    noteKept(village, c.to, c.from, s === 'kept');
    // (the wants spec 3.1, 3.3: esteem, and a favour owed or repaid)
    if (ESTEEM_ON) noteKeptTo(village, c.to, c.from, s === 'kept', now);
    noteFact(village, c.to, c.from, s === 'kept' ? 'kept' : 'broke');
    think(village, c.to, s === 'kept' ? 'kept' : 'broke', `${c.from} ${s === 'kept' ? 'kept' : 'broke'} a promise to you`, now);
    push(st, c.to, { t: now, kind: 'report', text: `${c.from} ${s === 'kept' ? 'kept' : 'broke'} a promise to you: ${c.what.words} (${c.id})` });
    if (s === 'broken') push(st, c.from, { t: now, kind: 'report', text: `You broke your promise to ${c.to}: ${c.what.words}` });
  } else if (s === 'released') push(st, c.to, { t: now, kind: 'report', text: `${c.from} took back a promise to you: ${c.what.words}` });
}

/** A chore of the member has started (its option and chore id): a promise it keeps stays open past its due time until it
 *  ends (the spec check's M1). */
export function noteStart(village: string, agent: string, option: string, chore: string): void {
  if (!ACTS.on) return;
  for (const c of state(village).commitments) if (c.state === 'open' && c.from === agent && c.what.option === option) c.running = chore;
}

/** A chore of the member ended: a promise of one chore of that option, made before the chore started, is kept when the
 *  chore gave what it is for (an item deposited, a project's step done). */
export function noteEnd(village: string, agent: string, e: { option: string; chore: string; started: number; ok: boolean; productive: boolean; cut: boolean }, now: number): void {
  if (!ACTS.on) return;
  const st = state(village);
  let changed = false;
  // (#108: one paid contract a chore: the oldest priced promise of the option; the others wait for the next chore or
  // break past due as today)
  let paidServed = false;
  for (const c of st.commitments) {
    if (c.state !== 'open' || c.from !== agent || c.what.option !== e.option || c.delivering) continue;
    // (the chore that was running when the promise was made keeps it too: an offer of the option just chosen)
    const its = c.running === e.chore;
    if (its) delete c.running;
    changed = true;
    if (!(e.ok && e.productive && !e.cut && (its || e.started >= c.made - 1000))) continue;
    const r = paying() && c.request ? st.requests.find((q) => q.id === c.request && q.contract) : undefined;
    if (!r) close(st, village, c, 'kept', now, `chore ${e.chore} done`);
    else if (!paidServed) {
      paidServed = true;
      const how = payHooks!.ended(village, r, c, e, now);
      if (how === 'kept') close(st, village, c, 'kept', now, `chore ${e.chore} done`);
      else if (how === 'delivering') {
        c.delivering = now;
        push(st, c.to, { t: now, kind: 'report', text: `${c.from} is bringing your ${r.what.words.replace(/^(gather|make) /, '')} (${r.id})` });
      }
    }
  }
  if (changed) touchMemory();
}

/** #108: a priced promise's delivery settled (kept), or short or its payer gone (moot): through close(), so the kept counts,
 *  facts and affinity stay one path. */
export function closeCommitment(village: string, id: string, s: 'kept' | 'moot' | 'broken', evidence: string, now = Date.now()): boolean {
  if (!ACTS.on) return false;
  const st = state(village);
  const c = st.commitments.find((x) => x.id === id && x.state === 'open');
  if (!c) return false;
  close(st, village, c, s, now, evidence);
  touchMemory();
  return true;
}

/** #108: a request closed by its contract (a wage's steps all paid: accepted; its payer gone: moot). */
export function closeRequest(village: string, id: string, s: 'accepted' | 'moot', now = Date.now()): boolean {
  if (!ACTS.on) return false;
  const r = state(village).requests.find((q) => q.id === id && q.state === 'open');
  if (!r) return false;
  r.state = s;
  logAct({ type: 'request', op: s, village, id: r.id, from: r.from, to: r.to, by: 'contract', t: now });
  touchMemory();
  return true;
}

/** #108: whether a request or a promise is still open, for pay.ts' reconciler at load. */
export function actOpen(village: string, request?: string, commitment?: string): boolean {
  const st = state(village);
  return (!!request && st.requests.some((r) => r.id === request && r.state === 'open')) || (!!commitment && st.commitments.some((c) => c.id === commitment && c.state === 'open'));
}

/**
 * #108: a fixed, repeat or only pick of an option a priced request asks for accepts it when the price is at or above the
 * guide (payHooks.acceptable), apart from handle() so the act cadence (`since`) does not move. Unpriced requests are left
 * to handle(), as before. Returns the promise's id, if one was made.
 */
export function impliedAccept(village: string, agent: string, chosen: Chosen, w: ActsWorld, now: number): string | undefined {
  if (!ACTS.on || (!paying() && !TALK.fixes)) return undefined;
  const st = state(village);
  const mine = whatOfChosen(w, chosen);
  if (!mine || st.commitments.some((c) => c.state === 'open' && c.from === agent && c.what.option === mine.option)) return undefined;
  const open = (q: Request) => q.state === 'open' && q.from !== agent && q.what.option === mine.option && (q.to === agent || (q.to === 'anyone' && !(q.declined ?? []).includes(agent)));
  // (a priced request at or above the guide first; with MC_ACT_FIXES an unpriced one too: Long4's cooked cod requests
  // expired while 10 members made cooked cod by fixed and repeat picks. A direct request before the board's.)
  // (the test's bounty taken by a fixed pick as its control arm's unpriced requests are, MC_ACT_FIXES: spec 9's both arms alike)
  const priced = paying() ? st.requests.find((q) => open(q) && !!q.contract && ((TALK.fixes && q.bounty) || payHooks!.acceptable(village, agent, q, now))) : undefined;
  const r = priced ?? (TALK.fixes ? st.requests.filter((q) => open(q) && !q.contract).sort((p, q) => Number(q.to === agent) - Number(p.to === agent))[0] : undefined);
  if (!r) return undefined;
  if (r.what.kind !== 'project' || !r.contract) {
    r.state = 'accepted';
    r.by = agent;
  }
  noteFact(village, r.from, agent, 'accepted');
  const c = commit(st, village, agent, r.from, mine, now, `accepted ${r.id} (a fixed pick)`, chosen.decisionId, chosen.chore);
  if (r.contract) {
    c.request = r.id;
    payHooks!.taken(village, r, c, now);
  }
  logAct({ type: 'act', village, agent, act: 'accept', ref: r.id, implied: true, fixed: true, verdict: 'ok', decisionId: chosen.decisionId });
  push(st, r.from, { t: now, kind: 'report', text: `${agent} took up your request: ${r.what.words} (${c.id})` });
  touchMemory();
  return c.id;
}

/**
 * The sweep (every 30 s): promises past due with no chore of theirs running close as broken; a project that closed makes
 * its promises and requests moot, an item off every menu for 10 minutes too; requests expire.
 */
export function sweep(village: string, w: ActsWorld, now: number): void {
  if (!ACTS.on) return;
  const st = state(village);
  let changed = false;
  for (const c of st.commitments) {
    if (c.state !== 'open') continue;
    const gone = c.what.kind === 'project' ? !w.projects.has(c.what.option ?? '') : !(w.offered ?? new Set(w.items.keys())).has(c.what.option ?? '');
    if (c.delivering) {
      // (#108: the goods are on their way; a delivery that never settles closes moot, its contract refunded)
      if (now - c.delivering > ACTS.dueMs) {
        close(st, village, c, 'moot', now, 'the delivery never arrived');
        changed = true;
      }
    } else if (gone) {
      close(st, village, c, 'moot', now, c.what.kind === 'project' ? 'the project closed' : 'nobody can do it now');
      changed = true;
    } else if (now > c.due && !c.running) {
      close(st, village, c, 'broken', now, 'past due');
      changed = true;
    }
  }
  for (const r of st.requests) {
    if (r.state !== 'open') continue;
    const gone = r.what.kind === 'project' ? !w.projects.has(r.what.option) : !w.items.has(r.what.option);
    if (gone || now - r.made > ACTS.requestMs) {
      r.state = gone ? 'moot' : 'expired';
      logAct({ type: 'request', op: r.state, village, id: r.id, from: r.from, to: r.to });
      // (#108: an untaken priced request, or a wage's unpaid steps, refunded)
      if (paying() && r.contract) payHooks!.closed(village, r, r.state, now);
      changed = true;
    }
  }
  // (old closed entries trimmed: the ledger keeps the last 200 of each)
  if (st.commitments.length > 300) st.commitments = st.commitments.filter((c, i) => c.state === 'open' || i >= st.commitments.length - 200);
  if (st.requests.length > 300) st.requests = st.requests.filter((r, i) => r.state === 'open' || i >= st.requests.length - 200);
  if (changed) touchMemory();
}

/** The member's open promises and the requests to it, for the panel. */
export function socialView(village: string, agent: string, now: number): { inbox: string[]; promises: string[]; requests: string[]; role?: string } {
  const st = state(village);
  return {
    inbox: inbox(village, agent, now),
    promises: st.commitments.filter((c) => c.from === agent || c.to === agent).slice(-8).map((c) => `${c.id} ${c.from} -> ${c.to}: ${c.what.words} (${c.state})`),
    requests: st.requests.filter((r) => r.from === agent || r.to === agent).slice(-6).map((r) => `${r.id} ${r.from} -> ${r.to}: ${r.what.words} (${r.state}${r.by ? ` by ${r.by}` : ''})`),
    role: memberSocial(village, agent).role?.kind,
  };
}

// (#86 with acts: a note claiming a promise between two members that no record holds is refused)
addNoteCheck((village, agent, text) => {
  if (!ACTS.on || !MEMORY.quality) return null;
  if (!/\b(promised|promises|owes|owe me|agreed to|will bring|will give)\b/i.test(text)) return null;
  const st = state(village);
  for (const m of membersOf(village)) {
    if (m.name === agent || !new RegExp(`\\b${m.name}\\b`).test(text)) continue;
    const any = st.commitments.some((c) => (c.from === m.name && c.to === agent) || (c.from === agent && c.to === m.name));
    if (!any) return `no promise between you and ${m.name} is on record`;
  }
  return null;
});
