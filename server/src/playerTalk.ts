/**
 * G7, talking with the village (#35-#40; spec runs/2026-10-30/g7/spec.md): a person's line to the Mayor or a member
 * becomes a request, remembered in a ledger, answered in one line, and built, promised or refused with a reason.
 * World-free: the ledger and its file, the talk call's prompt and tool, its parse, place words and the answer line. The
 * world (mcWorld.ts) routes the line here, makes the call, places and checks a build, posts it as a public work and
 * closes requests from what happens.
 *
 * Settings (read once):
 *   MC_TALK   on (default) | off: the talk pipeline; off, a person's line wakes the tiered brain's chat turn as before
 *   MC_TALK_PASS  on (default) | off: a member's refusal for want of a chore passed to a member who has one
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ToolDef } from './world';
import { rawSetting } from './settings';
import { offerLine, type DesignOffer } from './talkDesign';

export const PLAYER_TALK = {
  on: !/^(off|0|false|no)$/i.test(rawSetting('MC_TALK') ?? 'on'),
  /** MC_TALK_PASS: a member's refusal for want of a chore passed to a member whose list has one (talk-pass-on.md). */
  pass: !/^(off|0|false|no)$/i.test(rawSetting('MC_TALK_PASS') ?? 'on'),
  /** Lines from one person to one agent within this are joined into one call. */
  gapMs: 20000,
  /** A promise is due in this long (divided by MC_TIME_SCALE); broken past twice that. */
  promiseMs: (15 * 60000) / Math.max(0.1, Number(rawSetting('MC_TIME_SCALE') ?? 1) || 1),
};

export type TalkKind = 'chat' | 'build' | 'promise' | 'forward' | 'refuse';
export type ReqStatus = 'heard' | 'chat' | 'queued' | 'under_way' | 'done' | 'failed' | 'refused' | 'promised' | 'kept' | 'broken' | 'unanswered';

export interface Place {
  /** The person's words. */
  words: string;
  kind: 'here' | 'water' | 'forest' | 'building' | 'dir';
  word?: string;
  dir?: 'north' | 'south' | 'east' | 'west';
}

export interface PlayerRequest {
  id: string;
  village: string;
  from: string;
  /** The agent spoken to (a member's forward goes on to the Mayor: `to` is then the Mayor, `via` the member). */
  to: string;
  via?: string;
  text: string;
  at: number;
  /** Where the person stood when they spoke (for "here"). */
  pos?: { x: number; y: number; z: number };
  kind?: TalkKind;
  status: ReqStatus;
  say?: string;
  /** The line said back (the model's words and code's facts). */
  answer?: string;
  reason?: string;
  /** A build: the public work's piece (or `houses`, or `civic:ID` for a pre-designed building, MC_TALK_DESIGNS) and its
   *  words. */
  piece?: string;
  what?: string;
  /** MC_TALK_DESIGNS: the architect is drawing it (no piece yet), and the pre-designed building the Mayor named nearest. */
  drawing?: boolean;
  nearest?: string;
  place?: Place & { x?: number; z?: number; note?: string };
  eta?: number;
  /** A build's units of work (the quarter's), and the layout number it was laid out as. */
  units?: number;
  layout?: number;
  /** A promise: the chore option, its name, when it is due, and when code last started its chore. */
  ran?: number;
  option?: string;
  optionName?: string;
  due?: number;
  /** When it was laid out (a build), finished, failed or closed. */
  started?: number;
  closed?: number;
  outcome?: string;
}

export interface Person { village: string; name: string; first: number; last: number; lines: number; asks: number; done: number; refused: number }

interface Store { version: 1; next: number; requests: PlayerRequest[]; people: Person[] }
let store: Store = { version: 1, next: 1, requests: [], people: [] };
let file: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let hooked = false;

/** Load the ledger of a world's folder (null: memory only). */
export function initTalk(dataDir: string | null, name = 'talk.json'): void {
  file = dataDir ? path.join(dataDir, name) : null;
  store = { version: 1, next: 1, requests: [], people: [] };
  if (file && fs.existsSync(file)) {
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Store;
      if (s?.version === 1) store = { version: 1, next: s.next ?? 1, requests: s.requests ?? [], people: s.people ?? [] };
    } catch (e) {
      console.error(`[talk] cannot read ${file}: ${(e as Error).message}; starting empty (the file is left as it is)`);
      file = `${file}.new`;
    }
  }
  if (!hooked) {
    hooked = true;
    process.on('exit', () => flushTalk());
  }
}

function save(): void {
  dirty = true;
  if (!file || timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushTalk();
  }, 500);
}

export function flushTalk(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!dirty || !file) return;
  dirty = false;
  const data = JSON.stringify(store, null, 1);
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, data);
    try {
      fs.renameSync(tmp, file);
    } catch {
      fs.writeFileSync(file, data);
      fs.rmSync(tmp, { force: true });
    }
  } catch (e) {
    console.error(`[talk] saving ${file} failed: ${(e as Error).message}`);
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const requestsOf = (village?: string) => store.requests.filter((r) => !village || same(r.village, village));
export const requestById = (id: string) => store.requests.find((r) => r.id === id);
export const peopleOf = (village?: string) => store.people.filter((p) => !village || same(p.village, village));

/** A person's line to an agent: a new request in the ledger (status heard), the person's record counted. */
export function addRequest(r: Pick<PlayerRequest, 'village' | 'from' | 'to' | 'text' | 'at'> & { pos?: PlayerRequest['pos'] }): PlayerRequest {
  const req: PlayerRequest = { id: `r${store.next++}`, village: r.village, from: r.from, to: r.to, text: r.text.slice(0, 300), at: r.at, status: 'heard', ...(r.pos ? { pos: r.pos } : {}) };
  store.requests.push(req);
  // (the ledger keeps the last 500)
  if (store.requests.length > 500) store.requests.splice(0, store.requests.length - 500);
  let p = store.people.find((x) => same(x.village, r.village) && same(x.name, r.from));
  if (!p) store.people.push((p = { village: r.village, name: r.from, first: r.at, last: r.at, lines: 0, asks: 0, done: 0, refused: 0 }));
  p.last = r.at;
  p.lines++;
  save();
  return req;
}

/** A request's change; a build or promise counted on its person once (asked, done, refused). */
export function updateRequest(id: string, patch: Partial<PlayerRequest>): PlayerRequest | undefined {
  const r = requestById(id);
  if (!r) return undefined;
  const before = r.status;
  Object.assign(r, patch);
  const p = store.people.find((x) => same(x.village, r.village) && same(x.name, r.from));
  if (p && before !== r.status) {
    if (before === 'heard' && (r.kind === 'build' || r.kind === 'promise' || r.kind === 'forward')) p.asks++;
    if (r.status === 'refused') p.refused++;
    if (r.status === 'done' || r.status === 'kept') p.done++;
  }
  save();
  return r;
}

/** Requests still to be settled: a build queued or under way, a promise open. */
export const openRequests = (village: string) => requestsOf(village).filter((r) => r.status === 'queued' || r.status === 'under_way' || r.status === 'promised');

const ago = (ms: number) => (ms < 90000 ? 'just now' : ms < 90 * 60000 ? `${Math.round(ms / 60000)} min ago` : `${Math.round(ms / 3600000)} h ago`);

const STATUS_WORDS: Record<ReqStatus, string> = {
  heard: 'not answered yet', chat: 'talk', queued: 'accepted, waiting its turn', under_way: 'being built', done: 'done', failed: 'failed',
  refused: 'refused', promised: 'promised', kept: 'promise kept', broken: 'promise not kept', unanswered: 'not answered',
};

/** What a person said to this village before and how it went (the talk prompt's memory), newest last. `state`: the
 *  world's words for a request's state now (#179: "under_way" for houses meant only "asked growth"), else the ledger's. */
export function historyLines(village: string, from: string, now: number, n = 5, except?: string, state?: (r: PlayerRequest) => string | undefined): string[] {
  return requestsOf(village).filter((r) => same(r.from, from) && r.id !== except).slice(-n).map((r) =>
    `${ago(now - r.at)} to ${r.to}${r.via ? ` (via ${r.via})` : ''}: "${r.text.slice(0, 100)}" -> ${state?.(r) ?? STATUS_WORDS[r.status]}${r.what ? ` (${r.what}${r.place?.words ? ` ${r.place.words}` : ''})` : ''}${r.optionName ? ` (${r.optionName})` : ''}${r.reason ? `: ${r.reason.slice(0, 80)}` : ''}`);
}

// ---- status facts (#179) ----------------------------------------------------------------------------------------------

/** What the world shows of a request now (the world fills it in): its state in words, where, and how far along. */
export interface ReqProgress { state: string; where?: string; done?: number; of?: number }

/** One request's fact line: what it is, its state, where and how far along; no more than `progress` shows. */
export function statusFact(r: PlayerRequest, now: number, progress: ReqProgress): string {
  const what = r.what ?? r.optionName ?? (r.piece === 'houses' ? 'houses' : r.piece ? workWords(r.piece) : 'a request');
  return `${r.id}, ${what} (asked ${ago(now - r.at)}): ${progress.state}${progress.of ? `, ${progress.done ?? 0} of ${progress.of} built` : ''}${progress.where ? `; ${progress.where}` : ''}`;
}

/**
 * #179: a person's builds and promises, open ones and those closed within the last hour (newest `n`), as facts from the
 * ledger and the world (`progress`): the talk prompt's "their requests now" and a status answer's facts.
 */
export function statusLines(village: string, from: string, now: number, progress: (r: PlayerRequest) => ReqProgress, n = 3): string[] {
  return statusRequests(village, from, now).slice(-n).map((r) => statusFact(r, now, progress(r)));
}
const statusRequests = (village: string, from: string, now: number) =>
  requestsOf(village).filter((r) => same(r.from, from) && (r.kind === 'build' || r.kind === 'promise') && (!r.closed || now - r.closed < 60 * 60000));

const HOUSE_WORDS = /\b(house|houses|home|homes|street|cottage|place to live)\b/i;
const QUIET_WORDS = new Set(['what', 'where', 'when', 'happened', 'with', 'about', 'coming', 'along', 'going', 'done', 'ready', 'finished', 'built', 'yet', 'status', 'progress', 'news', 'the', 'my', 'our', 'your', 'how', 'is', 'are', 'was', 'it', 'that', 'this', 'did', 'will', 'any', 'asked', 'for', 'you', 'please', 'mayor']);
/**
 * #183: the request a status question asks about, as its fact line: the one its words name (house words for a street of
 * houses, else the most words shared with what was asked), else the newest build, else the newest request. Train 14's D
 * answered "where is my house?" with a torch promise's fact: it took the latest request. Null when there is none.
 */
export function statusFor(village: string, from: string, now: number, progress: (r: PlayerRequest) => ReqProgress, question: string): string | null {
  const rs = statusRequests(village, from, now);
  if (!rs.length) return null;
  const words = new Set((question.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 3 && !QUIET_WORDS.has(w)).map((w) => w.replace(/e?s$/, '')));
  const score = (r: PlayerRequest) => {
    const about = `${r.what ?? ''} ${r.optionName ?? ''} ${r.piece ? workWords(r.piece) : ''} ${r.text}`;
    const house = HOUSE_WORDS.test(question) && (r.piece === 'houses' || HOUSE_WORDS.test(`${r.what ?? ''} ${r.text}`)) ? 10 : 0;
    const shared = new Set((about.toLowerCase().match(/[a-z]+/g) ?? []).map((w) => w.replace(/e?s$/, '')).filter((w) => words.has(w))).size;
    return house + shared;
  };
  // (the newest wins a tie: requests are kept oldest first)
  let best = rs.at(-1)!, top = 0;
  for (const r of rs) {
    const sc = score(r);
    if (sc >= top && sc > 0) [best, top] = [r, sc];
  }
  if (!top) best = rs.filter((r) => r.kind === 'build').at(-1) ?? best;
  return statusFact(best, now, progress(best));
}

/**
 * #198: a question about the person's own request ("where is my house?", "how is the house I asked for coming along?")
 * when the ledger holds none it can be about: the line to say instead of the model's (train 16's Mayor answered "your
 * house is all set and ready for you to move in" to a person who had asked for no house). A house question with no house
 * among their requests, or any such question with no request at all; null when statusFor has a request to answer from.
 */
export function noRequestLine(village: string, from: string, now: number, question: string): string | null {
  if (!/\b(my|mine|i (?:asked|wanted|requested)|you promised)\b/i.test(question)) return null;
  const rs = statusRequests(village, from, now);
  const house = HOUSE_WORDS.test(question);
  if (house && !rs.some((r) => r.piece === 'houses' || HOUSE_WORDS.test(`${r.what ?? ''} ${r.text}`)))
    return `I have no house request from you on record${rs.length ? ` (only ${rs.at(-1)!.what ?? rs.at(-1)!.optionName ?? 'another request'})` : ''}; ask me for one and I will put it to the village.`;
  if (!rs.length) return 'I have no request from you on record just now; ask me and I will put it to the village.';
  return null;
}

/** A line asking how a request goes ("where?", "what happened to the house", "is it done yet"). */
export function isStatusQuestion(text: string): boolean {
  return /(what happened|^\s*where\b|\bwhere (is|are|'s|did|will|was)\b|how long|when will|\b(done|ready|finished|built) yet\b|\bis it (done|ready|finished|built)|\bhow('s| is| are) (the|my|our|it)\b|\bstatus\b|\bprogress\b|any news)/i.test(text);
}

/** A member's open promises to people (its choice prompt), and the option each tags. */
export function promiseLines(village: string, agent: string, now: number): string[] {
  return requestsOf(village).filter((r) => r.status === 'promised' && same(r.to, agent)).map((r) =>
    `You promised ${r.from} (a person): ${r.optionName ?? r.option}, ${r.due && r.due > now ? `due in ${Math.max(1, Math.round((r.due - now) / 60000))} min` : 'due now'} ("${r.text.slice(0, 80)}")`);
}
export function promiseTags(village: string, agent: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of requestsOf(village)) if (r.status === 'promised' && same(r.to, agent) && r.option) out.set(r.option, `[your promise to ${r.from}]`);
  return out;
}

// ---- place words (#37) ------------------------------------------------------------------------------------------------

const DIRS = ['north', 'south', 'east', 'west'] as const;

/**
 * Where a request asks for its building, by its words: here / near me, by the water, by the trees, next to a building,
 * a side of the village. Null: no place words.
 */
export function placeOf(text: string): Place | null {
  const t = text.toLowerCase();
  const m = (re: RegExp) => re.exec(t);
  let x: RegExpExecArray | null;
  if ((x = m(/\b(right here|over here|here|near me|next to me|where i (?:am|stand))\b/))) return { words: x[0], kind: 'here' };
  if ((x = m(/\b(?:by|near|next to|beside|along|on|at) the (river|water|lake|sea|shore|beach|pond|coast)\b/)) || (x = m(/\b(riverside|lakeside|waterfront|seaside)\b/))) return { words: x[0], kind: 'water' };
  if ((x = m(/\b(?:by|near|next to|beside|in|at) the (forest|woods|trees|wood)\b/))) return { words: x[0], kind: 'forest' };
  if ((x = m(/\b(north|south|east|west)(?:ern)? (?:side|end|edge)?\s*(?:of (?:the )?(?:village|town))?\b/)) && /\b(of|side|end|edge)\b/.test(x[0])) return { words: x[0].trim(), kind: 'dir', dir: x[1] as Place['dir'] };
  if ((x = m(/\b(?:next to|near|by|beside|behind|opposite) (?:the|our|my) ([a-z]+(?: [a-z]+)?)\b/))) {
    const word = x[1].replace(/\s+(please|now|too)$/, '');
    if (!/^(village|town|mayor)$/.test(word)) return { words: x[0].replace(/\s+(please|now|too)$/, ''), kind: 'building', word };
  }
  return null;
}

/** A line without its place words ("a post office near the market" -> "a post office"): what is asked for, not where
 *  (MC_TALK_DESIGNS' shortlist would take the market for a market hall). */
export function withoutPlace(text: string): string {
  const pl = placeOf(text);
  const i = pl ? text.toLowerCase().indexOf(pl.words) : -1;
  return i < 0 ? text : `${text.slice(0, i)}${text.slice(i + pl!.words.length)}`.replace(/\s{2,}/g, ' ').trim();
}

/** The point a direction names: `dist` blocks from home that way (north is -z). */
export function dirPoint(home: { x: number; z: number }, dir: NonNullable<Place['dir']>, dist = 40): { x: number; z: number } {
  const [dx, dz] = dir === 'north' ? [0, -1] : dir === 'south' ? [0, 1] : dir === 'east' ? [1, 0] : [-1, 0];
  return { x: Math.round(home.x + dx * dist), z: Math.round(home.z + dz * dist) };
}

/** A point pulled toward home to within `reach` blocks of it. */
export function clampTo(home: { x: number; z: number }, p: { x: number; z: number }, reach: number): { x: number; z: number; clamped: boolean } {
  const d = Math.hypot(p.x - home.x, p.z - home.z);
  if (d <= reach) return { ...p, clamped: false };
  const k = reach / d;
  return { x: Math.round(home.x + (p.x - home.x) * k), z: Math.round(home.z + (p.z - home.z) * k), clamped: true };
}

/** "east, ~40 blocks" from home. */
export function bearing(home: { x: number; z: number }, p: { x: number; z: number }): string {
  const dx = p.x - home.x, dz = p.z - home.z, d = Math.round(Math.hypot(dx, dz));
  if (d < 12) return 'in the village';
  const ns = dz < -0.4 * d ? 'north' : dz > 0.4 * d ? 'south' : '';
  const ew = dx > 0.4 * d ? 'east' : dx < -0.4 * d ? 'west' : '';
  return `${ns}${ns && ew ? '-' : ''}${ew} of the village, ~${Math.round(d / 5) * 5} blocks`;
}

// ---- the works a Mayor may build (#38) --------------------------------------------------------------------------------

/** A piece's words: "plains_fletcher_house_1" -> "fletcher house". */
export const workWords = (piece: string) => piece.replace(/@.*$/, '').replace(/^(plains|desert|savanna|taiga|snowy|asked)_/, '').replace(/_r?\d+$/, '').replace(/_/g, ' ');

export interface WorkOffer { id: string; words: string; biome: string; units: number; gather: Record<string, number> }

/**
 * The works to offer: one per kind of building (its words), the village's biome first, then the smallest; at most `cap`.
 */
export function offerWorks(pool: WorkOffer[], biome: string | undefined, cap = 24): WorkOffer[] {
  const sorted = [...pool].sort((a, b) => Number(b.biome === biome) - Number(a.biome === biome) || a.units - b.units);
  const seen = new Set<string>(), out: WorkOffer[] = [];
  for (const w of sorted) {
    if (seen.has(w.words)) continue;
    seen.add(w.words);
    out.push(w);
    if (out.length >= cap) break;
  }
  return out;
}

/** The offer a model's `work` names: its id, else its words, else one whose words hold the asked word. */
export function matchWork(offers: WorkOffer[], asked: string): WorkOffer | undefined {
  const a = asked.trim().toLowerCase().replace(/^(a|an|the)\s+/, '');
  if (!a) return undefined;
  return offers.find((w) => w.id.toLowerCase() === a) ?? offers.find((w) => w.words === a) ?? offers.find((w) => a.split(/\s+/).some((x) => x.length > 3 && w.words.split(' ').includes(x)));
}

/**
 * Minutes a build of `units` takes: the village's own pace when known, else 0.45 min a unit over the builders (staged
 * public works took ~0.015 min a unit with 25 members at 3x and stock in hand; x3 for real time, x~4 for gathering);
 * rounded to 5.
 */
export function etaMinutes(units: number, builders: number, minPerUnit?: number, scale = 1): number {
  const per = minPerUnit && Number.isFinite(minPerUnit) && minPerUnit > 0 ? minPerUnit : 0.45 / Math.max(1, builders);
  return Math.max(5, Math.round((units * per) / Math.max(0.1, scale) / 5) * 5);
}

/** The two largest gathers of a bill in words ("~60 logs and 40 cobblestone"). */
export function billWords(gather: Record<string, number>): string {
  const top = Object.entries(gather).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).slice(0, 2);
  return top.map(([k, q]) => `${q} ${k.replace(/_/g, ' ')}`).join(' and ');
}

// ---- the talk call ----------------------------------------------------------------------------------------------------

const MAYOR_SYSTEM = `You are the Mayor of a Minecraft village whose members are run by language models. A person, a human player, has spoken to you. Answer them once with the respond tool.
- kind=build when they ask the village to build something: work = the id of one work from the list of works we can build that fits what they asked, or "houses" for houses to live in. If nothing on the list fits, use kind=refuse and say in reason what we cannot build and what from the list we could.
- kind=refuse for what the village cannot do (things not on the list, items or creatures it cannot get, fighting, anything outside this game); reason says why in one plain sentence.
- kind=chat for greetings, questions and talk that asks nothing to be built: say answers from what you know of the village.
- A line a member passes on to you is the person's request to you: answer what they asked as if they had said it to you.
- About the person's requests (what happened, where, when), say only what "Their requests now" shows: if it says a request is not started, do not say it is being built; give no place it does not give. Code adds the facts after your line.
- place: copy the person's own words for where it should go ("by the river", "here", "next to the hall"), or leave it empty. Code finds the spot.
- say: one short friendly line in your own voice. Do not give times, distances or coordinates: code adds them.`;

const MEMBER_SYSTEM = `You are a member of a Minecraft village whose members are run by language models. A person, a human player, has spoken to you. Answer them once with the respond tool.
- kind=promise when they ask or tell you to do something you can do yourself, looking after yourself included (eating, resting): option = the id of one chore from your list that does it (gathering, making, fishing...). You will do it next.
- kind=forward only when they ask for a building or for the village to build something: you pass it to the Mayor, who decides. A meeting, a question or a chore is not forwarded.
- kind=refuse when nothing on your list does it, or it is outside this game; reason says why in one plain sentence.
- kind=chat for greetings, questions and talk that asks for nothing: say answers from what you know.
- About the person's requests (what happened, where, when), say only what "Their requests now" shows. Code adds the facts after your line.
- say: one short friendly line in your own voice. Do not give times or coordinates: code adds them.`;

// (MC_TALK_DESIGNS, talkDesign.ts: the pre-designed buildings first, then the works, then a building the architect draws)
const MAYOR_DESIGN_SYSTEM = `You are the Mayor of a Minecraft village whose members are run by language models. A person, a human player, has spoken to you. Answer them once with the respond tool.
- kind=build when they ask the village to build something. work names what we build, the first of these that fits what they asked:
  1. a pre-designed building from "Pre-designed buildings that match their words": its id (a real building, drawn in full);
  2. a work from "Works we can build": its id; or "houses" for houses to live in;
  3. "design" when none of those fits and it is something built of blocks that stands in one place: a building (a bakery, a school) or a small decorative work (a statue or sculpture of an animal, a person or a thing; a fountain, an arch, a pillar, an obelisk, a monument, a gate, a bench, a garden feature). Our architect draws it new, small (up to 11x11 blocks and 12 high). Set what to it in a few words ("a bakery", "a statue of a chicken") and nearest to the id of the listed building closest to it. A statue of a creature is a figure made of blocks: design it, do not refuse it.
- kind=refuse for what cannot be built of blocks in one place in this game (items, tools or food to hand over, live creatures or pets, fighting, magic, anything outside this game, anything as huge as a city, a skyscraper or a giant statue); reason says why in one plain sentence, and nearest names the listed building closest to what they asked.
- A line a member passes on to you is the person's request to you: answer what they asked (build, refuse or chat) as if they had said it to you.
- kind=chat for greetings, questions and talk that asks nothing to be built: say answers from what you know of the village.
- About the person's requests (what happened, where, when), say only what "Their requests now" shows: if it says a request is not started, do not say it is being built; give no place it does not give. Code adds the facts after your line.
- place: copy the person's own words for where it should go ("by the river", "here", "next to the hall"), or leave it empty. Code finds the spot.
- say: one short friendly line in your own voice. Do not give times, distances or coordinates: code adds them.`;

// (#233, F358: asked what its prompt did not show, the model made it up: "no monsters were spotted" after a night of 14
// and a death; asked to eat or rest, it chatted "I'll rest soon" with both on its list; "I don't have a bow" while it
// carried one)
const FACT_RULES = `- Questions (how many, who, where, what you are doing, what is out there): answer only from "What you know now" and the lists in this prompt. If the answer is not there, say plainly you do not know; do not guess, and name no number, place, name or event they do not give.`;
const MEMBER_RULES = `${FACT_RULES} If a chore on your list would find out (exploring that way, say), you may offer it; never offer one that is not on your list.
- Only a promise makes you act: chat, forward and refuse make you do nothing more, so in them never say you are going, coming, on your way, or will do something. When they ask you to do something a chore on your list does (eat, rest at home, keep watch, explore, gather...), promise that chore.
- A question is answered with chat, even about a monster ("should we fight it or keep away?"): give your advice from what you know, and promise nothing they did not ask you to do.
- A refusal's reason must be true by what you know: look at your chores and what you carry first. When they ask you to deal with a monster in or near the village, or for help against monsters, that is the work of "Keep watch tonight" (or the hunt) if it is on your list: promise it rather than refuse. Only when neither is on your list (you carry no weapon, say) refuse and say why; never promise to make a weapon for a fight, as it does not help them now.
- Forward only a building: a call to gather or come somewhere ("meeting at the hut!"), a question or a chore is not passed to the Mayor; answer it yourself with chat.
- You cannot hand items to a person: what you gather goes to the village storage, where they can take it. No chore walks you to a meeting or to the person: if they call you to one, say kindly that you cannot come, not that you will.
- Speak of an item as yours ("my bow", "my sword") only when "You carry" lists it.`;
const MAYOR_RULES = `${FACT_RULES}
- You cannot call a vote: the members vote on the wall's stages and the public works when the village puts them to a ballot. Say so rather than refuse the idea.`;

export const talkSystem = (role: 'mayor' | 'member', designs = false) =>
  (role === 'mayor' ? `${designs ? MAYOR_DESIGN_SYSTEM : MAYOR_SYSTEM}\n${MAYOR_RULES}` : `${MEMBER_SYSTEM}\n${MEMBER_RULES}`);

export function talkTool(role: 'mayor' | 'member', designs = false): ToolDef {
  const kinds = role === 'mayor' ? ['chat', 'build', 'refuse'] : ['chat', 'promise', 'forward', 'refuse'];
  const props: Record<string, unknown> = {
    kind: { type: 'string', enum: kinds },
    say: { type: 'string', description: 'One short line to the person, in your own voice.' },
    reason: { type: 'string', description: 'kind=refuse: why, in one plain sentence.' },
  };
  if (role === 'mayor') {
    props.work = { type: 'string', description: designs ? 'kind=build: the id of a pre-designed building or a work from the lists, "houses", or "design" for a new building or decorative work (a statue, a fountain...) our architect draws.' : 'kind=build: the id of a work from the list, or "houses".' };
    props.place = { type: 'string', description: "kind=build: the person's words for where, or empty." };
    if (designs) {
      props.what = { type: 'string', description: 'work=design: what to draw in a few words ("a bakery", "a statue of a chicken").' };
      props.nearest = { type: 'string', description: 'work=design or kind=refuse: the id of the listed building closest to what they asked.' };
    }
  } else props.option = { type: 'string', description: 'kind=promise: the id of a chore from your list.' };
  return { name: 'respond', description: 'Answer the person: talk, take the request, or refuse it with a reason.', input_schema: { type: 'object', properties: props, required: ['kind', 'say'] } };
}

export interface TalkCtx {
  agent: string;
  role: 'mayor' | 'member';
  village: string;
  /** The persona and character lines the chooser builds. */
  persona: string[];
  from: string;
  lines: string[];
  /** The person's earlier requests (historyLines). */
  history: string[];
  /** The village's state in a few lines. */
  state: string[];
  /** #179: the person's requests now (statusLines), the only facts the answer may give about them. */
  status?: string[];
  works?: WorkOffer[];
  /** MC_TALK_DESIGNS: the pre-designed buildings the person's words name (talkDesign.ts shortlist), and some others when
   *  none (sampler: for the nearest). */
  designs?: DesignOffer[];
  otherDesigns?: DesignOffer[];
  options?: Array<{ id: string; name: string }>;
  /** A member's line forwarded to the Mayor. */
  via?: string;
  /** #233: what the agent knows of its situation now (talkFacts), the only facts it may answer questions from. */
  facts?: string[];
}

// ---- #233: the situation facts --------------------------------------------------------------------------------------

/** What the world knows of an agent's situation when a person speaks to it (all optional: what is missing is not said). */
export interface TalkSituation {
  /** The game's time of day (ticks, 0-24000). */
  tick?: number;
  /** A member's own health (of 20) and appetite state. */
  health?: number;
  hunger?: 'fed' | 'peckish' | 'hungry';
  /** What it carries that matters to a person's asks: weapons, arrows, armour (words). */
  carries?: string[];
  /** The chore it is on now (its name), or null between chores; undefined: not known (the Mayor). */
  doing?: string | null;
  /** Where it is, in words ("in the village", "outside the village, ~130 blocks from its centre"). */
  where?: string;
  /** The village storage's counts (item id -> count). */
  storage?: Record<string, number>;
  /** The explore ring's directions visited and not, and how far out its points are. */
  explored?: string[];
  unexplored?: string[];
  exploreRange?: number;
  /** Danger: whether monsters come at all (a peaceful world: none), last night's record (no record: no night yet). */
  monsters?: boolean;
  lastNight?: { peak48: number; died: string[]; out: number };
  /** Hostiles within 48 and 96 blocks of home at the danger count's last look (about once a minute). */
  near?: { n48: number; n96: number };
  /** Deaths on record (since the agent server started), and members hurt now ("Finn 6/20"). */
  deaths?: number;
  hurt?: string[];
  /** The home band walks every member home at dusk (true: say so). */
  homeAtDusk?: boolean;
}

/** The time of day in words. */
export function timeWords(tick: number): string {
  const t = ((tick % 24000) + 24000) % 24000;
  if (t >= 12541 && t <= 23458) return t >= 22000 ? 'night, near dawn' : 'night';
  if (t >= 11000) return 'dusk (night is coming)';
  return t < 1000 || t >= 23458 ? 'dawn' : t < 6000 ? 'morning' : 'afternoon';
}

/** The storage counts a person asks about, in groups (a count of 0 is said: "no meat" is a fact too). */
const STORE_GROUPS: Array<[string, (id: string) => boolean]> = [
  ['bread', (i) => i === 'bread'],
  ['wheat', (i) => i === 'wheat'],
  ['meat (raw or cooked)', (i) => /^(cooked_)?(beef|porkchop|mutton|chicken|rabbit|cod|salmon)$/.test(i)],
  ['other food (carrots, potatoes, apples, cake...)', (i) => /^(carrot|potato|baked_potato|apple|cake|pumpkin_pie|cookie|melon_slice|beetroot|sweet_berries)$/.test(i)],
  ['logs', (i) => /_(log|stem)$/.test(i)],
  ['planks', (i) => /_planks$/.test(i)],
  ['cobblestone', (i) => i === 'cobblestone'],
  ['stone', (i) => i === 'stone'],
  ['iron (raw and ingots)', (i) => i === 'raw_iron' || i === 'iron_ingot'],
  ['coal and charcoal', (i) => i === 'coal' || i === 'charcoal'],
  ['torches', (i) => i === 'torch'],
  ['arrows', (i) => i === 'arrow'],
  ['flint', (i) => i === 'flint'],
  ['gravel', (i) => i === 'gravel'],
  ['sand', (i) => i === 'sand'],
  ['wool', (i) => /_wool$/.test(i)],
];
export function storageWords(store: Record<string, number>): string {
  return STORE_GROUPS.map(([w, f]) => `${w} ${Object.entries(store).reduce((n, [k, q]) => n + (f(k) ? Math.max(0, Math.floor(q)) : 0), 0)}`).join(', ');
}

/** The situation as fact lines for the talk prompt; the member's own first. */
export function talkFacts(s: TalkSituation, role: 'mayor' | 'member'): string[] {
  const out: string[] = [];
  if (s.tick !== undefined) out.push(`It is ${timeWords(s.tick)}.`);
  if (role === 'member') {
    if (s.health !== undefined) out.push(`Your health: ${Math.round(s.health)} of 20${s.health <= 8 ? ' (badly hurt)' : s.health < 14 ? ' (hurt)' : ''}${s.hunger && s.hunger !== 'fed' ? `; you are ${s.hunger}` : ''}.`);
    if (s.carries) out.push(`You carry: ${s.carries.length ? s.carries.join(', ') : 'no weapon and no armour (you cannot fight)'}.`);
    if (s.doing !== undefined) out.push(s.doing ? `What you are doing now: ${s.doing}.` : 'What you are doing now: nothing (between chores).');
    if (s.where) out.push(`You are ${s.where}.`);
  }
  if (s.storage) out.push(`The village storage holds: ${storageWords(s.storage)}.`);
  if (s.explored || s.unexplored) {
    const r = s.exploreRange ? ` (trips ~${s.exploreRange} blocks out)` : '';
    out.push(`Land explored around the village${r}: ${s.explored?.length ? s.explored.join(', ') : 'none yet'}; not explored: ${s.unexplored?.length ? s.unexplored.join(', ') : 'none'}. What lies there is not in these facts.`);
  }
  if (s.monsters === false) out.push('No monsters come in this world.');
  else if (s.monsters) {
    out.push(s.lastNight ? `Last night: at most ${s.lastNight.peak48} monsters at once within 48 blocks of home; ${s.lastNight.died.length ? `died: ${s.lastNight.died.join(', ')}` : 'no member died'}; ${s.lastNight.out} member${s.lastNight.out === 1 ? '' : 's'} out after dark.`
      // (F361: "no record" was read as "no monsters")
      : 'Last night: not counted (the village began counting monsters after it). You do not know how many monsters came last night or whether anyone was hurt then: if asked, say you do not know.');
    if (s.near) out.push(s.near.n96 ? `Monsters near the village now: ${s.near.n48} within 48 blocks of home, ${s.near.n96} within 96.` : 'Monsters near the village now: none within 96 blocks of home.');
    if (s.deaths !== undefined) out.push(`Member deaths on record: ${s.deaths}.`);
    if (s.homeAtDusk) out.push('At dusk every member walks home on its own (watchers excepted).');
  }
  if (s.hurt) out.push(s.hurt.length ? `Members hurt now: ${s.hurt.join(', ')}.` : 'No member is hurt now.');
  return out;
}

export function talkUser(c: TalkCtx): string {
  return [
    `You are ${c.agent}, ${c.role === 'mayor' ? 'the Mayor' : 'a member'} of the village ${c.village}.`,
    ...c.persona.filter(Boolean),
    c.state.length ? `The village now:\n${c.state.map((l) => `- ${l}`).join('\n')}` : '',
    c.facts?.length ? `What you know now (answer questions only from these facts and the lists here; anything else you do not know):\n${c.facts.map((l) => `- ${l}`).join('\n')}` : '',
    c.history.length ? `What ${c.from} asked before, and how it went:\n${c.history.map((l) => `- ${l}`).join('\n')}` : `You have not spoken with ${c.from} before.`,
    c.status ? `Their requests now (from the village's records; say nothing about them these do not show):\n${c.status.length ? c.status.map((l) => `- ${l}`).join('\n') : '- none open'}` : '',
    c.designs ? (c.designs.length ? `Pre-designed buildings that match their words (id: name, kind, size):\n${c.designs.map(offerLine).join('\n')}`
      : `No pre-designed building matches their words. Some others the village could build (id: name, kind, size):\n${(c.otherDesigns ?? []).map(offerLine).join('\n')}`) : '',
    c.works ? `Works we can build (id: what, size in units of work):\n${c.works.map((w) => `- ${w.id}: ${w.words} (${w.units})`).join('\n')}\n- houses: a street of houses for members${c.designs ? '\n- design: a building or a small decorative work (a statue, a fountain, an arch...) none of the above fits, drawn new by our architect' : ''}` : '',
    c.options ? `Your chores (id: what):\n${c.options.map((o) => `- ${o.id}: ${o.name}`).join('\n')}` : '',
    `${c.via ? `${c.via} passes on what ${c.from} said to them` : `${c.from} says to you`}:\n${c.lines.map((l) => `"${l}"`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}

export interface Respond { kind: TalkKind; say: string; work?: string; option?: string; place?: string; reason?: string; what?: string; nearest?: string }

/** The model's answer: its respond call, else its text as talk; null when there is neither. */
export function parseRespond(reply: { calls?: Array<{ name: string; input: Record<string, unknown> }>; text?: string }, role: 'mayor' | 'member'): Respond | null {
  const c = reply.calls?.find((x) => x.name === 'respond') ?? reply.calls?.[0];
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const clean = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (c?.input) {
    const ok: TalkKind[] = role === 'mayor' ? ['chat', 'build', 'refuse'] : ['chat', 'promise', 'forward', 'refuse'];
    let kind = str(c.input.kind).toLowerCase() as TalkKind;
    if (!ok.includes(kind)) kind = str(c.input.work) && role === 'mayor' ? 'build' : str(c.input.option) && role === 'member' ? 'promise' : str(c.input.reason) ? 'refuse' : 'chat';
    return { kind, say: clean(str(c.input.say)), ...(str(c.input.work) ? { work: str(c.input.work) } : {}), ...(str(c.input.option) ? { option: str(c.input.option) } : {}), ...(str(c.input.place) ? { place: str(c.input.place) } : {}), ...(str(c.input.reason) ? { reason: clean(str(c.input.reason)) } : {}),
      ...(str(c.input.what) ? { what: clean(str(c.input.what)).slice(0, 60) } : {}), ...(str(c.input.nearest) ? { nearest: str(c.input.nearest) } : {}) };
  }
  // (F361: the Mayor's respond call came back as JSON in its text, said word for word as chat)
  const raw = (reply.text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const json = /^(?:```(?:json)?\s*)?(\{[\s\S]*\})\s*(?:```)?$/.exec(raw);
  if (json) {
    try {
      const input = JSON.parse(json[1]) as Record<string, unknown>;
      if (input && typeof input === 'object' && (typeof input.kind === 'string' || typeof input.say === 'string')) return parseRespond({ calls: [{ name: 'respond', input }] }, role);
    } catch {
      /* not JSON: said as it is */
    }
  }
  const text = clean(raw);
  return text ? { kind: 'chat', say: text } : null;
}

/** #236: the line said when the talk call came back empty twice (the person heard nothing before). */
export const emptyReplyLine = (from: string) => `${from}, sorry, I lost my words just now; could you say that again?`;

// ---- MC_TALK_PASS: a request passed to a member who has a chore for it (docs/specs/talk-pass-on.md) ------------------

/** A refusal's reason that says the member has no chore (or no weapon) for it, not a hand-over or the game's limits. */
export const noChoreReason = (reason: string) => /\bno (chore|task|job|weapon)s?\b|\bnot (on|in|among) my (list|chores)\b|\bnothing on my (list|chores)\b|\bnot among the chores\b|\bno chores i can\b/i.test(reason);

// (words for the same thing: a person's word -> words the chores use)
const PASS_SAME: Record<string, string[]> = {
  zombie: ['watch', 'hunt'], skeleton: ['watch', 'hunt'], creeper: ['watch', 'hunt'], spider: ['watch', 'hunt'], monster: ['watch', 'hunt'], mob: ['watch', 'hunt'],
  fight: ['watch', 'hunt'], kill: ['watch', 'hunt'], defend: ['watch'], guard: ['watch'], protect: ['watch'],
  wood: ['log', 'tree', 'fell'], tree: ['log', 'fell'], log: ['tree', 'fell'], timber: ['log', 'tree'],
  stone: ['cobblestone'], cobble: ['cobblestone'], rock: ['cobblestone', 'stone'],
  food: ['eat', 'meal', 'bread'], hungry: ['eat', 'meal'], eat: ['meal'], sleep: ['rest'], hurt: ['rest', 'eat'],
  light: ['torch', 'lamp'], lamp: ['light', 'torch'],
  scout: ['explore'], look: ['explore'], find: ['explore'], wool: ['sheep', 'shear'], egg: ['chicken'],
};
const PASS_QUIET = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'from', 'with', 'your', 'you', 'my', 'me', 'our', 'we', 'us', 'it', 'is', 'are', 'be', 'can', 'could', 'would', 'please', 'some', 'more', 'get', 'go', 'do', 'make', 'build', 'bring', 'fetch', 'need', 'want', 'now', 'again', 'storage', 'village', 'own', 'start', 'take', 'into', 'this', 'that', 'there', 'here', 'right', 'away', 'help', 'just', 'any', 'all', 'new', 'nothing', 'wants', 'some', 'up', 'out', 'about', 'what', 'how', 'who', 'where', 'tell', 'next',
  // (places: "be home before dark" is not a rest, "for the towers" not a tower to build)
  'home', 'hut', 'house', 'edge', 'ground', 'open', 'tower', 'tonight', 'night', 'day']);
const passStem = (w: string) => w.replace(/ies$/, 'y').replace(/(ch|sh|x|ss)es$/, '$1').replace(/([^s])s$/, '$1').replace(/(.{4,})ing$/, '$1');
const passWords = (s: string) => (s.toLowerCase().match(/[a-z]+/g) ?? []).map(passStem).filter((w) => w.length >= 3 && !PASS_QUIET.has(w));

/** How well a chore fits a person's words: the words they share (an option's name and id), a word of PASS_SAME counted
 *  for its chore words. 0: nothing shared. */
export function passScore(text: string, o: { id: string; name: string }): number {
  const asked = new Set<string>();
  for (const w of passWords(text)) {
    asked.add(w);
    for (const x of PASS_SAME[w] ?? []) asked.add(x);
  }
  const have = new Set([...passWords(o.name), ...passWords(o.id.replace(/[:_]/g, ' '))]);
  return [...have].filter((w) => asked.has(w)).length;
}

/** The chores a person's ask may be passed to: not a member's own, a project's or its house's (they serve the member). */
export const passable = (o: { id: string }) => !/^(own|help|initiate|custom|innovate|experiment):/.test(o.id);

/** The best of the other members' chores for a person's words (talk-pass-on.md): the highest score, then the idle member,
 *  then the nearest to the person. Null when no chore shares a word with the ask. */
export function passTarget<T extends { name: string; idle: boolean; dist: number; options: Array<{ id: string; name: string }> }>(text: string, members: T[]): { member: T; option: { id: string; name: string }; score: number } | null {
  let best: { member: T; option: { id: string; name: string }; score: number } | null = null;
  for (const m of members) for (const o of m.options) {
    if (!passable(o)) continue;
    const score = passScore(text, o);
    if (!score) continue;
    const better = !best || score > best.score || (score === best.score && (Number(m.idle) - Number(best.member.idle) || best.member.dist - m.dist) > 0);
    if (better) best = { member: m, option: o, score };
  }
  return best;
}

/** A model's claim that a building stands (or will) at the very place asked. */
// (T1's "right on the spot you requested": the words after the spot go too)
const PLACE_CLAIM = /,?\s*\b(?:right|just|exactly) (?:where you|(?:on|at) the (?:very )?(?:spot|place)(?: you)?|here|there)(?: (?:asked|requested|wanted|marked|said|pointed|stood|chose)(?: (?:for )?(?:it|them))?)?\b/gi;
/** How close code's facts put the building to the place asked: "~N blocks from the place asked", or a range's far end
 *  (#192: a street's nearest house at 10 kept the claim though the house used is not known and four of five stood
 *  further, ~10-95); null when the facts say nothing of it. */
function farthestFromPlace(facts: string): number | null {
  const m = /~(\d+)(?:-(\d+))? blocks from the place asked/.exec(facts);
  if (m) return Number(m[2] ?? m[1]);
  return /near here as there is room|asked here|place asked/.test(facts) ? Infinity : null;
}
/**
 * #183: the model's "right where you asked" / "right here" dropped when code's facts in the same line put the building
 * more than 15 blocks from the place asked, or give no distance yet ("as near here as there is room"): train 14's C said
 * "right where you asked for it" in front of "~30-65 blocks from the place asked".
 */
export function checkPlaceClaim(say: string, facts?: string): string {
  const near = facts ? farthestFromPlace(facts) : null;
  if (near === null || near <= 15 || say.search(PLACE_CLAIM) < 0) return say;
  return say.replace(PLACE_CLAIM, '').replace(/\s+([.!?,])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** The one line said back: the model's words (a place claim the facts do not bear out dropped), then code's facts after a
 *  dash. */
export function answerLine(say: string, facts?: string): string {
  say = checkPlaceClaim(say, facts);
  const s = say.replace(/[\s.!]+$/, '');
  if (!facts) return say.slice(0, 220);
  return `${s ? `${s} - ` : ''}${facts}`.slice(0, 240);
}
