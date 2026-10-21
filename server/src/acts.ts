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
import type { Commitment } from './social';
import { SOCIAL, memberSocial, noteHeard, noteKept, setActsOn } from './social';
import { MEMORY, addNoteCheck, clockOf, contentWords, logAct, membersOf, touchMemory, villageSocialOf } from './memory';

const scale = Math.max(0.1, Number(process.env.MC_TIME_SCALE ?? 1) || 1);
const wantActs = /^(on|1|true|yes)$/i.test(process.env.MC_ACTS ?? '');
if (wantActs && SOCIAL.mode === 'off') throw new Error('MC_ACTS=on with MCAI_SOCIAL=off: acts are social perception; run arm (b2) with MC_ACTS=off');
if (wantActs && SOCIAL.mode === 'legacy') console.warn('[acts] MC_ACTS=on is ignored under MCAI_SOCIAL=legacy (set on, noblock or countsonly)');

export const ACTS = {
  on: wantActs && SOCIAL.mode !== 'legacy' && SOCIAL.mode !== 'off',
  every: Math.max(1, Number(process.env.MC_ACTS_EVERY ?? 3)),
  dueMs: (Number(process.env.MC_PROMISE_MIN ?? 15) * 60000) / scale,
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

/** Test hook. */
export function setActsSettings(s: Partial<typeof ACTS>): void {
  Object.assign(ACTS, s);
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
}

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
  commitments: Array<Commitment & { what: Commitment['what'] & { words: string }; running?: string }>;
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
}

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

// ---------------------------------------------------------------------------------------------
// What the world tells
// ---------------------------------------------------------------------------------------------

/** The village's items and projects on offer now, members' places, and the claims the world can check. */
export interface ActsWorld {
  /** Item options seen on any member's menu in the last 10 minutes: option id -> words ("logs", "torches"). */
  items: Map<string, string>;
  /** Open projects: option id (help:<id>) -> words and owner. */
  projects: Map<string, { words: string; owner: string }>;
  /** Members present and where they stand. */
  at: Map<string, { x: number; z: number }>;
  /** The world's check of a claim (WorldAdapter.verifyClaim): true, false, or a reason it is false. */
  verify?: (claim: { type: 'stock'; option: string }) => true | string;
}

let speaker: ((village: string, agent: string, text: string) => void) | null = null;
/** How a line said aloud shows in the game (the world: tellraw, never bot chat, so no brain wakes on it). */
export function setSpeaker(fn: (village: string, agent: string, text: string) => void): void {
  speaker = fn;
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
    lines.push({ prio: r.to === agent ? 0 : 7, t: r.made, text: `${r.from} asks ${r.to === agent ? 'you' : 'anyone'}: ${r.what.words} (${r.id}, ${ago(now - r.made)})` });
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
  const items = [...new Set(w.items.values())].slice(0, 12);
  const nearBy = near(w, agent, 32).slice(0, 6);
  return [
    'You may add one act to this choice when another member could help you or you could help one: request (ask a member, or anyone, for an item put into storage or for help on a project), '
    + 'offer (promise a member the item or project of the option you choose), accept or decline (a request to you, by its id; choosing the option a request asks for accepts it), '
    + 'release (one promise of yours, by its id), report (tell those near you that a member kept or broke a promise you know of: act_to the member, act_claim kept or broke).',
    `Items: ${items.join(', ') || 'none now'}.${w.projects.size ? ` Projects: ${[...w.projects.entries()].slice(0, 4).map(([o, p]) => `${p.words} (${p.owner}, ${o})`).join('; ')}.` : ''}`,
    `Members near you: ${nearBy.join(', ') || 'nobody'}. Left today: ${left('request')} requests, ${left('offer')} offers, ${left('report')} reports.`,
    'You may also say one short line aloud to those near you (`say`), about your choice or your act.',
  ].join(' ');
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
  say?: string;
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
  const say = str(o.say);
  if (say) out.say = say.replace(/\s+/g, ' ').slice(0, 120);
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
  const f = fold(raw);
  for (const [option, words] of w.items) if (fold(option) === f || fold(words) === f || fold(option.split(':')[1] ?? '') === f || fold(words).replace(/s$/, '') === f.replace(/s$/, ''))
    return { kind: 'item', option, words: `${option.startsWith('make:') ? 'make' : 'gather'} ${words}` };
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

const sig = (agent: string, type: string, to: string, what: string) => `${agent}|${type}|${to}|${what}`;

function commit(st: ActsState, village: string, from: string, to: string, what: What, now: number, how: string, decisionId?: string, chore?: string) {
  const c = { id: `c${st.next++}`, from, to, what: { kind: what.kind, option: what.option, words: what.words }, made: now, due: now + ACTS.dueMs, state: 'open' as const, ...(chore ? { running: chore } : {}) };
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
      r.state = 'accepted';
      r.by = agent;
      const c = commit(st, village, agent, r.from, mine, now, `accepted ${r.id}`, chosen.decisionId, chosen.chore);
      logAct({ type: 'act', village, agent, act: 'accept', ref: r.id, implied: true, verdict: 'ok', decisionId: chosen.decisionId });
      push(st, r.from, { t: now, kind: 'report', text: `${agent} took up your request: ${r.what.words} (${c.id})` });
      done.push(`accept ${r.id}`);
    }
  }

  let act = fields.act?.toLowerCase().trim();
  if (act && !(ACT_TYPES as readonly string[]).includes(act)) act = (ACT_TYPES as readonly string[]).find((t) => act!.startsWith(t)) ?? act;
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
    } else if (!(ACT_TYPES as readonly string[]).includes(act)) refuse(`"${act}" is not an act`, false);
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
        else if (!what) refuse(`"${fields.act_item ?? fields.act_project ?? ''}" is not an item or project on offer now`, false);
        else if (looped(key)) refuse('you made the same request within the hour');
        else {
          const v = what.kind === 'item' && w.verify ? w.verify({ type: 'stock', option: what.option }) : true;
          if (v !== true) refuse(v);
          else {
            const r: Request = { id: `r${st.next++}`, from: agent, to, what, made: now, state: 'open' };
            st.requests.push(r);
            ok('request', key, { id: r.id, to, option: what.option, words: what.words });
          }
        }
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
// Commitments closed by code
// ---------------------------------------------------------------------------------------------

function close(st: ActsState, village: string, c: ActsState['commitments'][number], s: 'kept' | 'broken' | 'released' | 'moot', now: number, evidence: string) {
  c.state = s;
  c.closedAt = now;
  c.evidence = evidence;
  logAct({ type: 'commitment', op: s, village, id: c.id, from: c.from, to: c.to, option: c.what.option, evidence, late: s === 'kept' && now > c.due });
  if (s === 'kept' || s === 'broken') {
    noteKept(village, c.to, c.from, s === 'kept');
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
  for (const c of st.commitments) {
    if (c.state !== 'open' || c.from !== agent || c.what.option !== e.option) continue;
    // (the chore that was running when the promise was made keeps it too: an offer of the option just chosen)
    const its = c.running === e.chore;
    if (its) delete c.running;
    changed = true;
    if (e.ok && e.productive && !e.cut && (its || e.started >= c.made - 1000)) close(st, village, c, 'kept', now, `chore ${e.chore} done`);
  }
  if (changed) touchMemory();
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
    const gone = c.what.kind === 'project' ? !w.projects.has(c.what.option ?? '') : !w.items.has(c.what.option ?? '');
    if (gone) {
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
