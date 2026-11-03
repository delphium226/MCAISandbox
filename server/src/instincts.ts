/**
 * Instincts (#205, G1, MC_INSTINCTS=on): each member keeps up to 5 short rules learned from its own outcomes, "When
 * <situation>, <do>; avoid <what>", each with a confidence (1.0 learned, 0.5 borrowed; +0.25 when an outcome agrees,
 * -0.25 when one contradicts it, dropped at 0; an instinct no outcome graded for 2 village days fades by 0.25).
 * Spec: runs/2026-11-02/instincts/spec.md (build session 1: the store, evidence, grading, `xw` and the place layer).
 *
 * World-free, beside memory.ts and customs.ts. Code finds the lessons, each from evidence it can spell out exactly:
 *   E1  the same member fails the same option key twice within 30 village minutes with the same message class: avoid
 *       that key;
 *   E2  three walk stalls (`[stuck]` lines with moved < 4 blocks or most ticks in water) within 12 blocks of each
 *       other within 10 village minutes: avoid the area, for targets whose straight line from home passes through it;
 *   E4  a success at the same kind or item by another key after an E1 lesson fills its "instead".
 * They act through code: a weight `xw` (0.5-1.3) on matching chore options (the fixed pick reads it) and a place layer
 * that makes collect and sand-trip target picks pass over an avoided area, falling back to it when nothing else is in
 * range. `[instinct]` lines log every learn, confirm, contradict, fade, drop, replace and act.
 * Stored in `instincts.json` beside villages.json, debounced, renamed into place, flushed at exit (memory.ts' pattern).
 *
 * Build session 2 (spec 1.2, 2.1, 4): with the night's reflection running (society.ts sets the rider), a new E1 lesson waits
 * for the night, whose call picks one and may word it (<= 22 words naming its item or kind; else the template); a night
 * that names none keeps the one with the most evidence. Members pass instincts on (MC_INSTINCT_SHARE): working side by
 * side on the same kind or item, depositing at the storage together, and at the dusk gathering; only one held at 0.75 or
 * more passes, the copy starts at 0.5 with the same lineage and one generation more (`borrows`, `echo` lines). In model
 * mode the chooser shows the member's instincts as a section and tags matching options (choose.ts).
 *
 * Settings (read once): MC_INSTINCTS on (default) | off: none of it, and no file written. MC_INSTINCT_SHARE on (default) |
 * off: no spread.
 */
import fs from 'node:fs';
import path from 'node:path';
import { clockOf } from './memory';
import { rawSetting } from './settings';

const OFF = /^(off|0|false|no)$/i;
export const INSTINCTS = {
  on: !OFF.test(rawSetting('MC_INSTINCTS') ?? 'on'),
  /** MC_INSTINCT_SHARE (session 2): the spread channels of spec 4.1. */
  share: !OFF.test(rawSetting('MC_INSTINCT_SHARE') ?? 'on'),
};
/** Test hooks. */
export function setInstinctsOn(on: boolean): void { INSTINCTS.on = on; }
export function setInstinctShare(on: boolean): void { INSTINCTS.share = on; }
/** Whether a village's night reflection words its members' new instincts (society.ts sets it: memory, clock and reflect
 *  on, a model chooser); otherwise code promotes a candidate at once, worded by its template. */
let rider: (village: string) => boolean = () => false;
export function setInstinctRider(f: (village: string) => boolean): void { rider = f; }

/** The spec's constants (section 5: kept in code). */
export const CAP = 5, LEARNED = 1, BORROWED = 0.5, STEP = 0.25, FADE_DAYS = 2, XW_MIN = 0.5, XW_MAX = 1.3, MAX_WORDS = 22;
/** Sharing (4.1): the least a giver holds an instinct at to pass it; the storage meeting's reach (blocks) and window (s);
 *  the night's list of candidates; how long a candidate waits for a night (village days). */
export const SHARE_MIN = 0.75, HUT_NEAR = 8, HUT_SECS = 20, NIGHT_LIST = 3, PENDING_DAYS = 2;
/** E1's and E2's windows (village minutes), E2's count and reach (blocks), an area's scope radius and merge distance. */
const FAIL_WINDOW = 30, STALL_WINDOW = 10, STALL_N = 3, STALL_NEAR = 12, AREA_R = 6, AREA_MAX_R = 12, MERGE = 8;
/** #210: the same failure confirms an instinct once per CONFIRM_WINDOW village minutes (a loop confirms once); no area
 *  within HOME_NEAR blocks of home (the storage) or KEEP_NEAR of a village structure (a walk stall there is the walk's
 *  fault, never the place's). */
const CONFIRM_WINDOW = 10, HOME_NEAR = 10, KEEP_NEAR = 4;

const scale = () => Math.max(0.1, Number(rawSetting('MC_TIME_SCALE') ?? 1) || 1);
/** Village minutes as wall-clock ms. */
const vmin = (m: number) => (m * 60000) / scale();
const dayMs = () => vmin(Number(rawSetting('MC_DAY_MIN') ?? 20) || 20);

export interface Area {
  x: number;
  z: number;
  r: number;
  /** Home when it was learned: a target is in scope when the straight line from here to it passes within r. */
  from?: { x: number; z: number };
}
export interface Trigger {
  /** Option keys with any trailing instance number dropped (normKey). */
  keys: string[];
  kinds: string[];
  /** The item a gather or start names ('sand'); an area instinct's place layer only acts on that item's targets. */
  item?: string;
  area?: Area;
}
export interface Instinct {
  id: string;
  /** Its origin member and trigger: borrowed copies keep it (session 2's spread measures). */
  lineage: string;
  gen: number;
  kind: 'avoid' | 'prefer';
  how: 'E1' | 'E2';
  trigger: Trigger;
  /** E1's failure message class: a later failure of the same class confirms, a success contradicts. */
  cls?: string;
  /** E4: the key that worked for the same need after the failures. */
  instead?: string;
  /** The avoided chore and E4's instead in words (the menu's), for the template. */
  what?: string;
  insteadWhat?: string;
  /** The night's reflection worded it: E4 leaves its text alone. */
  worded?: boolean;
  /** The kind of the chore that taught it: side by side, it passes to a member on a chore of that kind. */
  ofKind?: string;
  text: string;
  conf: number;
  source: 'learned' | 'borrowed';
  from?: string;
  at: number;
  /** Last graded (or faded): the untested fade counts from here; ties in replacement go to the least recent. */
  graded: number;
  /** #210: the last confirmation by a failure, and which (one per CONFIRM_WINDOW from the same failure). */
  confirmed?: { by: string; t: number };
  evidence: string[];
}
interface Candidate {
  /** Its id in the night's list ('c12'), while it waits for the reflection. */
  cid?: string;
  kind: 'avoid';
  how: 'E1' | 'E2';
  trigger: Trigger;
  cls?: string;
  ofKind?: string;
  what?: string;
  worded?: boolean;
  evidence: string[];
  count: number;
  at: number;
  text: string;
  /** For the template: the stall cluster had water under it. */
  wet?: boolean;
}
interface MemberState {
  instincts: Instinct[];
  /** Candidates waiting for a free slot or the next day (kept 1 day). */
  waiting: Candidate[];
  /** Candidates waiting for the night's reflection to pick and word one (the rider on; at most PENDING_DAYS). */
  pending?: Candidate[];
  fails: Array<{ key: string; cls: string; t: number; ref: string }>;
  stalls: Array<{ x: number; z: number; t: number; ref: string; wet: boolean }>;
  /** The village day of the last instinct learned (one a day). */
  learnDay: number;
}
interface Store {
  version: 1;
  seq: number;
  /** A village's first sight: the day count without the clock. */
  epochs: Record<string, number>;
  members: Record<string, MemberState>;
}

let store: Store = { version: 1, seq: 0, epochs: {}, members: {} };
let file: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
let exitHooked = false;
let sink: (line: string) => void = (l) => console.log(l);
/** Tests and the replay check: where `[instinct]` lines go. */
export function setInstinctLog(f: (line: string) => void): void { sink = f; }

const mkey = (village: string, agent: string) => `${village.toLowerCase()}|${agent.toLowerCase()}`;

/** Load the store of a world's folder (the agent server's data dir); called once by the world. */
export function initInstincts(dataDir: string | null): void {
  store = { version: 1, seq: 0, epochs: {}, members: {} };
  chores.clear();
  current.clear();
  past.clear();
  met.clear();
  deposits.clear();
  file = INSTINCTS.on && dataDir ? path.join(dataDir, 'instincts.json') : null;
  if (file && fs.existsSync(file)) {
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Store;
      if (s && s.version === 1) store = { version: 1, seq: s.seq ?? 0, epochs: s.epochs ?? {}, members: s.members ?? {} };
    } catch (e) {
      console.error(`[instinct] cannot read ${file}: ${(e as Error).message}; starting empty (the file is left as it is)`);
      file = `${file}.new`;
    }
  }
  if (file && !exitHooked) {
    exitHooked = true;
    process.on('exit', () => flushInstincts());
  }
}

/** The store as JSON, and back (tests, the API). */
export const serialiseInstincts = (): string => JSON.stringify(store);
export function loadInstincts(json: string): void { store = JSON.parse(json) as Store; }

/** A run begins (a spawn with reset, as character.json and G1's memory, #212): the village's members, its epoch and the
 *  chores and meetings in memory are dropped, so a run never starts with the last run's lessons. Returns the members
 *  dropped. */
export function instinctsRunBegin(village: string): number {
  const v = village.toLowerCase();
  const mine = (k: string) => k.split('|')[0] === v;
  const keys = Object.keys(store.members).filter(mine);
  for (const k of keys) delete store.members[k];
  delete store.epochs[v];
  for (const m of [chores, past]) for (const [id, c] of m) if (c.village.toLowerCase() === v) m.delete(id);
  for (const [a, c] of current) if (c.village.toLowerCase() === v) current.delete(a);
  for (const k of met.keys()) if (mine(k)) met.delete(k);
  deposits.delete(village);
  if (keys.length) log(village, `run begins: ${keys.length} members' instincts of the last run dropped`);
  save();
  return keys.length;
}

function save(): void {
  dirty = true;
  if (!file || timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushInstincts();
  }, 500);
}

/** Write any change now, synchronously (a temporary file renamed over the store; in place if a reader holds it). */
export function flushInstincts(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!dirty || !file) return;
  dirty = false;
  const data = JSON.stringify(store);
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
    console.error(`[instinct] cannot write ${file}: ${(e as Error).message}`);
  }
}

function member(village: string, agent: string): MemberState {
  const k = mkey(village, agent);
  return (store.members[k] ??= { instincts: [], waiting: [], fails: [], stalls: [], learnDay: 0 });
}

/** The village day (1-based): the clock's when it runs, else a day of MC_DAY_MIN from the village's first sight. */
export function dayOf(village: string, now: number): number {
  const c = clockOf(village, now);
  if (c) return c.day;
  const e = (store.epochs[village.toLowerCase()] ??= now);
  return Math.floor(Math.max(0, now - e) / dayMs()) + 1;
}

// ---------------------------------------------------------------------------------------------
// Words: keys, items, message classes, the template
// ---------------------------------------------------------------------------------------------

/** An option key or id without its trailing instance number ('monument:gather:sand:1' -> 'monument:gather:sand'); a
 *  two-part key keeps it ('explore:6' is a direction, not an instance). */
export const normKey = (k: string): string => {
  const m = /^(.+:.+):\d+$/.exec(k);
  return m ? m[1] : k;
};
/** The item a key or menu text names: 'monument:gather:sand:1' -> 'sand', 'start:pumpkin' -> 'pumpkin'. */
export function itemOf(key: string, what?: string): string | undefined {
  // (#206's sand trips, 'monument:sandtrip:2', name their item only in words)
  if (/(?:^|:)sandtrip(?::|$)/.test(key)) return 'sand';
  const m = /(?:^|:)(?:gather|start|collect|make):([a-z_]+)/.exec(key) ?? (what ? /\bgather (?:\d+ )?([a-z_]+)/.exec(what) : null);
  return m?.[1];
}
/** A failure message's class: numbers and coordinates out, the first 8 words. */
export const msgClass = (m: string): string => m.toLowerCase().replace(/-?\d+(\.\d+)?/g, '#').replace(/[^a-z#' ]+/g, ' ')
  .split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
/**
 * #210: a failure the walk caused (a stall, no path, a timeout on the way, a rescue), not the chore: it neither teaches
 * nor grades a chore lesson (Xavier's 17 "stuck at ... on the way to your own door" taught "avoid eat"). A gather that
 * tried several targets and reached none is the item's failure, and still counts.
 */
export const walkFailure = (m: string): boolean =>
  /\bstuck at\b|\bno path to\b|\btimed out at\b|\bcould not get to\b|\bteleported to\b|\bwalks? kept stalling\b|\bshort of your own door\b/i.test(m) &&
  !/^could not reach [a-z_]+: \d+ tried/i.test(m);
export const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
/** The direction from one point to another, in the world's terms (+x east, +z south). */
function compass(from: { x: number; z: number }, to: { x: number; z: number }): string {
  const a = Math.atan2(to.z - from.z, to.x - from.x);
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}
/** Cut a line to MAX_WORDS, dropping the parenthesis first. */
function fit(s: string): string {
  if (words(s) <= MAX_WORDS) return s;
  const bare = s.replace(/ \([^)]*\)\.?$/, '.');
  return words(bare) <= MAX_WORDS ? bare : `${bare.split(/\s+/).slice(0, MAX_WORDS).join(' ').replace(/[,;.]$/, '')}.`;
}
/** The template's wording of a candidate or instinct (code's, until session 2's reflection rider words some). */
export function template(c: { how: 'E1' | 'E2'; trigger: Trigger; cls?: string; instead?: string; count: number; wet?: boolean; what?: string; insteadWhat?: string }): string {
  const t = c.trigger;
  // (the verb by the key: 'make:torch' is made, not gathered)
  const verb = /(?:^|:)make:/.test(t.keys[0] ?? '') ? 'making' : /(?:^|:)start:/.test(t.keys[0] ?? '') ? 'starting' : 'gathering';
  const doing = t.item ? `${verb} ${t.item.replace(/_/g, ' ')}` : c.how === 'E2' ? 'walking out' : 'choosing your next chore';
  if (c.how === 'E2' && t.area) {
    const where = t.area.from ? `${compass(t.area.from, t.area)} ` : '';
    return fit(`When ${doing}, keep to the village's side; avoid the ${c.wet ? 'water' : 'spot'} ${where}at ${Math.round(t.area.x)},${Math.round(t.area.z)} (stuck ${c.count} times).`);
  }
  // (the chore in the menu's words where the record had them: the model reads options by name, not by key)
  const what = c.what?.trim() || (t.keys[0] ?? t.kinds[0] ?? 'it');
  const instead = c.instead ? `${c.insteadWhat?.trim() || `do ${c.instead}`} instead` : 'pick another';
  return fit(`When ${doing}, ${instead}; avoid ${what} (failed ${c.count} times: ${(c.cls ?? '').split(' ').slice(0, 5).join(' ')}).`);
}

// ---------------------------------------------------------------------------------------------
// Geometry: an area's scope
// ---------------------------------------------------------------------------------------------

/** Distance from point p to the segment a-b. */
function segDist(p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const u = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + u * dx), p.z - (a.z + u * dz));
}
/** Whether a target is in an area's scope: the straight line from the area's home to it passes within r of the area
 *  (#202's waterCrossed geometry), or, with no home, the target lies within r. */
export function inScope(area: Area, x: number, z: number): boolean {
  return area.from ? segDist(area, area.from, { x, z }) <= area.r : Math.hypot(x - area.x, z - area.z) <= area.r;
}
const sameTrigger = (a: Trigger, b: Trigger): boolean => a.area && b.area
  ? Math.hypot(a.area.x - b.area.x, a.area.z - b.area.z) <= MERGE && (a.item ?? '') === (b.item ?? '')
  : !a.area && !b.area && a.keys.join() === b.keys.join() && a.kinds.join() === b.kinds.join() && (a.item ?? '') === (b.item ?? '');

// ---------------------------------------------------------------------------------------------
// Learning, grading, fading
// ---------------------------------------------------------------------------------------------

const log = (village: string, s: string) => sink(`[instinct] ${village}: ${s}`);
const pct = (n: number) => n.toFixed(2);

function drop(st: MemberState, village: string, agent: string, i: Instinct, why: string): void {
  st.instincts = st.instincts.filter((q) => q !== i);
  log(village, `${agent} drops ${i.id} (${why})`);
}

/** Grade an instinct (+1 confirms, -1 contradicts): one step, capped at 1.0, dropped at 0. */
function grade(st: MemberState, village: string, agent: string, i: Instinct, sign: 1 | -1, why: string, now: number, failure?: string): void {
  // (#210: Xavier's i36 was confirmed 5 times by one loop: the same failure (`failure`, its key and class, or 'stall')
  // within CONFIRM_WINDOW of the last confirmation by it only keeps the instinct from the untested fade)
  if (sign > 0 && failure !== undefined) {
    const last = i.confirmed;
    if (last && last.by === failure && now - last.t < vmin(CONFIRM_WINDOW)) {
      i.graded = now;
      return;
    }
    i.confirmed = { by: failure, t: now };
  }
  i.conf = Math.min(LEARNED, i.conf + sign * STEP);
  i.graded = now;
  log(village, `${agent} ${sign > 0 ? 'confirms' : 'contradicts'} ${i.id} (${why}; ${pct(i.conf)})`);
  if (i.conf <= 1e-9) drop(st, village, agent, i, 'contradicted');
  save();
}

/** A candidate becomes an instinct (3.2): a duplicate confirms the one held, one a day, the cap of 5 replacing the
 *  least sure below 1.0, else it waits (a day at most). With the night's reflection running (the rider, 1.2), a new
 *  lesson waits for the night instead (`direct`: the night's own pick, a waiting one it picked earlier, or a place lesson). */
function promote(st: MemberState, village: string, agent: string, c: Candidate, now: number, direct = false): Instinct | null {
  const dup = st.instincts.find((i) => sameTrigger(i.trigger, c.trigger));
  if (dup) {
    if (dup.conf < LEARNED) grade(st, village, agent, dup, 1, `learned again: ${c.evidence.at(-1) ?? ''}`, now, c.how === 'E2' ? 'stall' : `${c.trigger.keys[0]} ${c.cls}`);
    else dup.graded = now;
    return null;
  }
  if (!direct && rider(village)) {
    const pend = (st.pending ??= []);
    const same = pend.find((w) => sameTrigger(w.trigger, c.trigger));
    if (same) {
      // (more evidence for a lesson already waiting: the night sees the larger count)
      if (c.count > same.count) Object.assign(same, { count: c.count, evidence: c.evidence, text: c.text, wet: c.wet });
    } else {
      pend.push({ ...c, cid: `c${++store.seq}` });
      log(village, `${agent} keeps a candidate for the night's reflection (${pend.at(-1)!.cid}): "${c.text}"`);
    }
    save();
    return null;
  }
  const day = dayOf(village, now);
  const wait = (why: string) => {
    if (!st.waiting.some((w) => sameTrigger(w.trigger, c.trigger))) {
      st.waiting.push(c);
      log(village, `${agent} keeps a candidate waiting (${why}): "${c.text}"`);
    }
    return null;
  };
  if (st.learnDay === day) return wait('one new instinct a day');
  let victim: Instinct | undefined;
  if (st.instincts.length >= CAP) {
    victim = st.instincts.filter((i) => i.conf < LEARNED).sort((a, b) => a.conf - b.conf || a.graded - b.graded)[0];
    if (!victim) return wait('5 held, all at 1.0');
  }
  const id = `i${++store.seq}`;
  const i: Instinct = {
    id, lineage: `${agent}:${id}`, gen: 0, kind: c.kind, how: c.how, trigger: c.trigger, cls: c.cls, ...(c.ofKind ? { ofKind: c.ofKind } : {}), ...(c.what ? { what: c.what } : {}), ...(c.worded ? { worded: true } : {}), text: c.text,
    conf: LEARNED, source: 'learned', at: now, graded: now, evidence: c.evidence.slice(-6),
  };
  if (victim) {
    st.instincts = st.instincts.filter((q) => q !== victim);
    log(village, `${agent} replaces ${victim.id} (${pct(victim.conf)}) with ${id}`);
  }
  st.instincts.push(i);
  st.waiting = st.waiting.filter((w) => w !== c);
  st.learnDay = day;
  log(village, `${agent} learns ${id} "${i.text}" (${c.how}, ${c.evidence.join(', ')})`);
  save();
  return i;
}

/** The member's housekeeping before any event: the untested fade, waiting candidates' expiry and promotion. */
function sweep(st: MemberState, village: string, agent: string, now: number): void {
  const fade = FADE_DAYS * dayMs();
  for (const i of [...st.instincts]) {
    if (now - i.graded < fade) continue;
    i.conf -= STEP;
    i.graded = now;
    log(village, `${agent} fades ${i.id} (untested for ${FADE_DAYS} days; ${pct(Math.max(0, i.conf))})`);
    if (i.conf <= 1e-9) drop(st, village, agent, i, 'faded');
    save();
  }
  st.waiting = st.waiting.filter((c) => now - c.at < dayMs());
  if (st.waiting.length && st.learnDay !== dayOf(village, now)) promote(st, village, agent, st.waiting[0], now, true);
  // (a lesson no night picked in PENDING_DAYS goes: if its evidence repeats, it comes back)
  if (st.pending?.length) {
    const old = st.pending.filter((c) => now - c.at >= PENDING_DAYS * dayMs());
    for (const c of old) log(village, `${agent} lets ${c.cid} go (no night picked it in ${PENDING_DAYS} days)`);
    if (old.length) st.pending = st.pending.filter((c) => !old.includes(c));
  }
}

// ---------------------------------------------------------------------------------------------
// Evidence from the world: chores (mcChoiceLog) and walk stalls (mcUtil)
// ---------------------------------------------------------------------------------------------

interface Chore { id: string; village: string; agent: string; key: string; kind: string; opt?: string; what?: string; item?: string; t: number; graded: Set<string>; stalls: Map<string, number>; touched: Set<string> }
/** Chores by decision id, and each member's current one (its stalls and place picks count against it); ended ones kept a
 *  while for the side-by-side channel (a chore end's `with` names chores that may have ended before it). */
const chores = new Map<string, Chore>();
const current = new Map<string, Chore>();
const past = new Map<string, Chore>();

/** A `[choice]` record: the member's current chore. */
export function noteChoice(rec: { id: string; agent: string; village: string; key: string; kind: string; what?: string; chosen?: string; t?: number }): void {
  if (!INSTINCTS.on || !rec.agent || !rec.village) return;
  // (the lesson's key is the option's id where the record has it: a key may be a member's own exclusion key, 'own:lena'
  // for every own chore of hers, and a lesson on it would weigh them all)
  const c: Chore = { id: rec.id, village: rec.village, agent: rec.agent, key: rec.chosen || rec.key, kind: rec.kind, opt: rec.chosen, what: rec.what, item: (rec.chosen && itemOf(rec.chosen)) || itemOf(rec.key, rec.what), t: rec.t ?? Date.now(), graded: new Set(), stalls: new Map(), touched: new Set() };
  chores.set(rec.id, c);
  current.set(rec.agent.toLowerCase(), c);
  if (chores.size > 2000) chores.delete(chores.keys().next().value!);
}

/** A `[choice-end]` record: E1's failures, E4's successes and the grading of instincts in the chore's scope. Cut
 *  chores and contention (another agent's work in the way) are not evidence. Then the side-by-side and dusk channels
 *  (MC_INSTINCT_SHARE) with the chores that overlapped it (`yield.with`). */
export function noteChoiceEnd(rec: { id: string; ok: boolean; message: string; tEnd?: number; cut?: boolean; contention?: string; yield?: { with?: string[] } }): void {
  if (!INSTINCTS.on) return;
  const c = chores.get(rec.id);
  if (!c) return;
  chores.delete(rec.id);
  past.set(rec.id, c);
  if (past.size > 500) past.delete(past.keys().next().value!);
  if (current.get(c.agent.toLowerCase()) === c) current.delete(c.agent.toLowerCase());
  if (rec.cut) return;
  const now = rec.tEnd ?? Date.now();
  if (!rec.contention) learnAtEnd(c, rec, now);
  if (INSTINCTS.share) shareAtEnd(c, rec.ok, rec.yield?.with ?? [], now);
}

function learnAtEnd(c: Chore, rec: { ok: boolean; message: string }, now: number): void {
  const st = member(c.village, c.agent);
  sweep(st, c.village, c.agent, now);
  const key = normKey(c.key), cls = msgClass(rec.message);
  const walked = !rec.ok && walkFailure(rec.message);
  // Grading (3.1): one grade per instinct per chore
  for (const i of [...st.instincts]) {
    if (c.graded.has(i.id)) continue;
    let sign: 1 | -1 | 0 = 0;
    // (#210: a walk's failure says nothing of the chore)
    if (walked && !i.trigger.area) continue;
    if (i.trigger.area) {
      // (the place layer fell back to an avoided target in this chore: its outcome grades the area)
      if (c.touched.has(i.id)) sign = rec.ok ? -1 : 1;
    } else if (i.instead && normKey(i.instead) === key) sign = rec.ok ? 1 : cls === i.cls ? -1 : 0;
    else if (i.trigger.keys.includes(key) || i.trigger.kinds.includes(c.kind)) sign = rec.ok ? -1 : cls === i.cls ? 1 : 0;
    if (!sign) continue;
    c.graded.add(i.id);
    grade(st, c.village, c.agent, i, sign, `${c.id} ${rec.ok ? 'ok' : 'failed'}`, now, rec.ok ? undefined : `${key} ${cls}`);
  }
  if (rec.ok) {
    // E4: a success at the same need by another key fills a recent E1 lesson's "instead"
    for (const i of st.instincts) {
      if (i.how !== 'E1' || i.instead || i.trigger.keys.includes(key) || now - i.at > vmin(FAIL_WINDOW)) continue;
      if ((i.trigger.item && i.trigger.item === c.item) || (!i.trigger.item && i.trigger.kinds.includes(c.kind))) {
        i.instead = key;
        i.insteadWhat = c.what;
        if (!i.worded) i.text = template({ how: i.how, trigger: i.trigger, cls: i.cls, instead: key, count: 2, what: i.what, insteadWhat: c.what });
        log(c.village, `${c.agent} fills ${i.id}'s instead: ${key} (${c.id})`);
        save();
      }
    }
    return;
  }
  // E1: the same key failed twice within 30 village minutes with the same message class; never from a walk's failure,
  // which belongs to E2's stalls if anywhere (#210)
  if (walked) return;
  st.fails = st.fails.filter((f) => now - f.t <= vmin(FAIL_WINDOW));
  const ref = `${c.id} "${rec.message.slice(0, 60)}"`;
  const same = st.fails.filter((f) => f.key === key && f.cls === cls);
  st.fails.push({ key, cls, t: now, ref: c.id });
  if (st.fails.length > 40) st.fails.splice(0, st.fails.length - 40);
  if (same.length + 1 < 2) return;
  const trigger: Trigger = { keys: [key], kinds: [], item: c.item };
  const cand: Candidate = { kind: 'avoid', how: 'E1', trigger, cls, ofKind: c.kind, what: c.what, evidence: [...same.map((f) => f.ref), ref], count: same.length + 1, at: now, text: '' };
  cand.text = template(cand);
  promote(st, c.village, c.agent, cand, now);
}

/** A `[stuck]` line, parsed: where the member stood, where it was going, how far it moved and how much in water. */
export interface Stall { agent: string; x: number; z: number; to: { x: number; z: number } | null; moved: number; ticks: number; water: number }
export function parseStuck(line: string): Stall | null {
  const m = /\[stuck\] (\S+) (?:stuck|timed out) at (-?[\d.]+),-?[\d.]+,(-?[\d.]+) -> (.*?) after [\d.]+ s: moved ([\d.]+);.*?ticks (\d+)\/\d+ .*?\bwater (\d+)/.exec(line);
  if (!m) return null;
  // (the walk's end: "on the way to X,Y,Z", else the target's own coordinates, X,Y,Z or X,Z)
  const dest = /on the way to (-?\d+),-?\d+,(-?\d+)/.exec(m[4]) ?? /(-?\d+),-?\d+,(-?\d+)/.exec(m[4]) ?? /(-?\d+),(-?\d+)/.exec(m[4]);
  return { agent: m[1], x: Number(m[2]), z: Number(m[3]), to: dest ? { x: Number(dest[1]), z: Number(dest[2]) } : null, moved: Number(m[5]), ticks: Number(m[6]), water: Number(m[7]) };
}

/** E2 and the area grades: a member's walk stalled (`line` is its `[stuck]` line; `home` the village's storage). */
export function noteStall(line: string, opts: { village?: string; home?: { x: number; z: number } | null; keepOff?: Array<{ x1: number; z1: number; x2: number; z2: number }>; now?: number } = {}): Instinct | null {
  if (!INSTINCTS.on) return null;
  const s = parseStuck(line);
  if (!s) return null;
  const chore = current.get(s.agent.toLowerCase());
  const village = opts.village ?? chore?.village;
  if (!village) return null;
  const now = opts.now ?? Date.now();
  const wet = s.water > s.ticks / 2;
  if (!(s.moved < 4 || wet)) return null;
  const st = member(village, s.agent);
  sweep(st, village, s.agent, now);
  const ref = `${chore?.id ?? 'walk'} @${Math.round(s.x)},${Math.round(s.z)}`;
  // An area held: stalls in it grade it (3 in one chore confirm, once a chore; later ones in the same chore keep it
  // from the untested fade: run 6's Kai stalled 95 more times in the one chore that taught him)
  const held = st.instincts.find((i) => i.trigger.area && Math.hypot(s.x - i.trigger.area.x, s.z - i.trigger.area.z) <= Math.max(i.trigger.area.r, STALL_NEAR));
  if (held) {
    if (chore?.graded.has(held.id)) held.graded = now;
    else if (chore) {
      const n = (chore.stalls.get(held.id) ?? 0) + 1;
      chore.stalls.set(held.id, n);
      if (n >= STALL_N) {
        chore.graded.add(held.id);
        grade(st, village, s.agent, held, 1, `${n} stalls in it during ${chore.id}`, now, 'stall');
      }
    }
    return null;
  }
  st.stalls = st.stalls.filter((q) => now - q.t <= vmin(STALL_WINDOW));
  st.stalls.push({ x: s.x, z: s.z, t: now, ref, wet });
  if (st.stalls.length > 40) st.stalls.splice(0, st.stalls.length - 40);
  const near = st.stalls.filter((q) => Math.hypot(q.x - s.x, q.z - s.z) <= STALL_NEAR);
  if (near.length < STALL_N) return null;
  const cx = near.reduce((a, q) => a + q.x, 0) / near.length, cz = near.reduce((a, q) => a + q.z, 0) / near.length;
  // (#210: never an area at home or on the village's own works: Xavier, stuck in the storage hut, learned to avoid it)
  if (opts.home && Math.hypot(cx - opts.home.x, cz - opts.home.z) <= HOME_NEAR) return null;
  if (opts.keepOff?.some((b) => Math.max(b.x1 - cx, cx - b.x2, b.z1 - cz, cz - b.z2) <= KEEP_NEAR)) return null;
  const r = Math.min(AREA_MAX_R, Math.max(AREA_R, ...near.map((q) => Math.hypot(q.x - cx, q.z - cz) + 2)));
  const area: Area = { x: Math.round(cx * 10) / 10, z: Math.round(cz * 10) / 10, r: Math.round(r * 10) / 10, ...(opts.home ? { from: { x: opts.home.x, z: opts.home.z } } : {}) };
  const trigger: Trigger = { keys: chore ? [normKey(chore.key)] : [], kinds: [], item: chore?.item, area };
  const cand: Candidate = { kind: 'avoid', how: 'E2', trigger, ofKind: chore?.kind, evidence: near.map((q) => q.ref), count: near.length, at: now, text: '', wet: near.filter((q) => q.wet).length * 2 > near.length };
  cand.text = template(cand);
  // (a place lesson is learned at once, the night's reflection or not: it guards the next trips the same day, spec 6.4's
  // prediction; its words are code's geometry, which the night would not improve)
  const i = promote(st, village, s.agent, cand, now, true);
  // (the stalls that taught it are used: the next ones grade it; a lesson waiting for the night keeps counting them)
  if (i) st.stalls = st.stalls.filter((q) => !near.includes(q));
  return i;
}

// ---------------------------------------------------------------------------------------------
// The night's reflection (1.2): it picks one waiting lesson and may word it
// ---------------------------------------------------------------------------------------------

/** The lessons waiting for a member's night, most evidence first (the reflect prompt shows them, society.ts). */
export function nightCandidates(village: string, agent: string): Array<{ id: string; text: string; count: number }> {
  if (!INSTINCTS.on) return [];
  const st = store.members[mkey(village, agent)];
  return [...(st?.pending ?? [])].sort((a, b) => b.count - a.count || a.at - b.at).slice(0, NIGHT_LIST)
    .map((c) => ({ id: c.cid!, text: c.text, count: c.count }));
}

/** The words a candidate's own wording must name one of: its item, the words of its keys and kinds, and for an area
 *  the water or the spot (a wording that names none of them cannot be matched to the lesson by a reader). */
function names(text: string, c: Candidate): boolean {
  const s = text.toLowerCase();
  const t = c.trigger;
  const terms = [t.item?.replace(/_/g, ' '), ...t.kinds, ...t.keys.flatMap((k) => k.split(':')).filter((w) => w.length > 3 && !/^(monument|activity|initiative|choice|lib)$/.test(w)).map((w) => w.replace(/_/g, ' '))];
  if (t.area) terms.push('water', 'river', 'bank', 'stream', 'stuck', 'spot', `${Math.round(t.area.x)}`, `${Math.round(t.area.z)}`);
  return terms.some((w) => !!w && s.includes(w));
}

/** The reply's instinct field, by shape (lesson 158: gpt-oss fills optional fields wrongly): {from, text}, a bare id
 *  ("c3"), or text alone. */
function parseNight(input: unknown): { filled: boolean; from?: string; text?: string } {
  let o = input as Record<string, unknown> | string | null;
  if (typeof o === 'string') {
    try { o = JSON.parse(o) as Record<string, unknown>; } catch { /* (a string, not JSON) */ }
  }
  if (!o || typeof o !== 'object') return { filled: false };
  for (const k of ['arguments', 'parameters', 'input']) if (o[k] && !('instinct' in o)) return parseNight(o[k]);
  const f = o.instinct as unknown;
  if (f === undefined || f === null || f === '') return { filled: false };
  const ID = /^\s*\[?(c\d+)\]?\s*$/i;
  if (typeof f === 'string') return ID.test(f) ? { filled: true, from: ID.exec(f)![1].toLowerCase() } : { filled: true, text: f };
  const r = f as Record<string, unknown>;
  const from = [r.from, r.id, r.candidate].find((x) => typeof x === 'string') as string | undefined;
  const text = [r.text, r.words, r.instinct].find((x) => typeof x === 'string') as string | undefined;
  return { filled: true, from: from && ID.test(from) ? ID.exec(from)![1].toLowerCase() : undefined, text: text?.trim() || undefined };
}

/**
 * The night's pick (society.ts, after the reflect call; `input` null when the call failed or was skipped): the candidate
 * it names, worded by it when the words are <= 22 and name the lesson, else by the template; none named: the one with
 * the most evidence. Promoted at once (the cap and one-a-day still hold); the others wait for later nights. Returns the
 * reflect line's words ('instinct c3 (worded)').
 */
export function nightInstinct(village: string, agent: string, input: unknown, now: number): string[] {
  if (!INSTINCTS.on) return [];
  const st = store.members[mkey(village, agent)];
  if (!st?.pending?.length) return [];
  const list = nightCandidates(village, agent);
  const p = input === null ? { filled: false } : parseNight(input);
  let c = p.from ? st.pending.find((q) => q.cid === p.from && list.some((l) => l.id === q.cid)) : undefined;
  let how = 'worded';
  if (c && !(p.text && words(p.text) <= MAX_WORDS && names(p.text, c))) how = p.text ? 'template: words refused' : 'template';
  if (!c) {
    c = st.pending.find((q) => q.cid === list[0].id)!;
    how = input === null ? 'code: no reply' : p.filled ? 'code: field not matched' : 'code: none named';
  }
  const text = how === 'worded' ? p.text!.replace(/\s+/g, ' ') : c.text;
  st.pending = st.pending.filter((q) => q !== c);
  log(village, `${agent}'s night picks ${c.cid} (${how}${p.filled ? ', field filled' : ''})`);
  const i = promote(st, village, agent, { ...c, text, worded: how === 'worded' }, now, true);
  save();
  return [`instinct ${c.cid} (${i ? how : st.waiting.some((w) => w.cid === c!.cid) ? 'waits' : 'merged'})`];
}

// ---------------------------------------------------------------------------------------------
// Spread between members (4.1; MC_INSTINCT_SHARE): side by side, at the storage, at the dusk gathering
// ---------------------------------------------------------------------------------------------

/** Who passed what to whom, by channel, once a village day (pair and channel) once something passed or echoed. */
const met = new Map<string, number>();
/** Recent deposits by village (the storage meeting). */
const deposits = new Map<string, Array<{ agent: string; x: number; z: number; t: number }>>();

/** Whether an instinct bears on a chore: its key, kind or item, or the kind of chore that taught it. */
const bears = (i: Instinct, c: Pick<Chore, 'key' | 'kind' | 'item'>) => i.trigger.keys.includes(normKey(c.key)) || i.trigger.kinds.includes(c.kind) || (!!i.trigger.item && i.trigger.item === c.item) || (!!i.ofKind && i.ofKind === c.kind);

/** The instinct a member would pass on: held at SHARE_MIN or more (learned, or borrowed and confirmed by its own
 *  outcomes), the surest first, then the most recently graded. */
function best(village: string, agent: string, filter: (i: Instinct) => boolean = () => true): Instinct | undefined {
  return instinctsOf(village, agent).filter((i) => i.conf >= SHARE_MIN - 1e-9 && filter(i)).sort((a, b) => b.conf - a.conf || b.graded - a.graded)[0];
}

/** A copy of the giver's instinct into the receiver's (a free slot, or over one below 0.5); one with the same trigger
 *  held is an echo. Returns whether anything passed or echoed (the channel's once-a-day mark). */
function borrow(village: string, giver: string, receiver: string, i: Instinct, via: string, now: number): boolean {
  const st = member(village, receiver);
  sweep(st, village, receiver, now);
  const dup = st.instincts.find((q) => sameTrigger(q.trigger, i.trigger));
  if (dup) {
    log(village, `${receiver} echo ${dup.id}: ${giver} offers ${i.id} (${via}; ${i.lineage}, held ${pct(dup.conf)})`);
    return true;
  }
  let victim: Instinct | undefined;
  if (st.instincts.length >= CAP) {
    victim = st.instincts.filter((q) => q.conf < BORROWED).sort((a, b) => a.conf - b.conf || a.graded - b.graded)[0];
    if (!victim) return false;
  }
  const id = `i${++store.seq}`;
  const copy: Instinct = {
    ...i, id, gen: i.gen + 1, trigger: JSON.parse(JSON.stringify(i.trigger)) as Trigger, conf: BORROWED, source: 'borrowed',
    from: giver, at: now, graded: now, evidence: [`from ${giver} (${via})`],
  };
  if (victim) {
    st.instincts = st.instincts.filter((q) => q !== victim);
    log(village, `${receiver} replaces ${victim.id} (${pct(victim.conf)}) with ${id}`);
  }
  st.instincts.push(copy);
  log(village, `${receiver} borrows ${id} from ${giver} (${via}; ${i.lineage} gen ${copy.gen}, ${pct(BORROWED)}) "${copy.text}"`);
  save();
  return true;
}

/** One pass from a giver to a receiver on a channel, once a village day for the pair. */
function pass(village: string, giver: string, receiver: string, via: string, now: number, filter?: (i: Instinct) => boolean): void {
  if (giver.toLowerCase() === receiver.toLowerCase()) return;
  const k = `${village.toLowerCase()}|${giver.toLowerCase()}|${receiver.toLowerCase()}|${via}`;
  const day = dayOf(village, now);
  if (met.get(k) === day) return;
  const i = best(village, giver, filter);
  if (i && borrow(village, giver, receiver, i, via, now)) met.set(k, day);
}

/** A chore's end: the chores that overlapped it in the village (`with`). The dusk gathering: each offers its best to
 *  each other one there. Side by side (the same kind or item): each passes one bearing on the other's chore. */
function shareAtEnd(c: Chore, ok: boolean, withIds: string[], now: number): void {
  for (const id of withIds) {
    const o = chores.get(id) ?? past.get(id);
    if (!o || o.village !== c.village || o.agent.toLowerCase() === c.agent.toLowerCase()) continue;
    if (c.opt === 'custom:dusk_gathering' && o.opt === c.opt) {
      if (!ok) continue;
      pass(c.village, c.agent, o.agent, 'dusk', now);
      pass(c.village, o.agent, c.agent, 'dusk', now);
    } else if (o.kind === c.kind || (!!c.item && o.item === c.item)) {
      pass(c.village, c.agent, o.agent, 'side by side', now, (i) => bears(i, o));
      pass(c.village, o.agent, c.agent, 'side by side', now, (i) => bears(i, c));
    }
  }
}

/** A deposit into the village storage (mcStorage's deposit): two members depositing within HUT_NEAR blocks and
 *  HUT_SECS of each other pass their best on (once a pair a village day). */
export function noteDeposit(village: string | undefined, agent: string, x: number, z: number, now = Date.now()): void {
  if (!INSTINCTS.on || !INSTINCTS.share || !village) return;
  const list = (deposits.get(village) ?? []).filter((d) => now - d.t <= (HUT_SECS * 1000) / scale() && d.agent !== agent);
  for (const d of list) {
    if (Math.hypot(d.x - x, d.z - z) > HUT_NEAR) continue;
    pass(village, agent, d.agent, 'storage', now);
    pass(village, d.agent, agent, 'storage', now);
  }
  list.push({ agent, x, z, t: now });
  deposits.set(village, list.slice(-50));
}

/** The lineages of one village (or all): each with its origin, text and current holders (the API, the panel, the
 *  simulator's spread counts). */
export function lineages(village?: string): Array<{ lineage: string; text: string; how: string; holders: Array<{ agent: string; id: string; conf: number; gen: number; source: string; from?: string }> }> {
  const out = new Map<string, { lineage: string; text: string; how: string; holders: Array<{ agent: string; id: string; conf: number; gen: number; source: string; from?: string }> }>();
  for (const m of allInstincts(village)) {
    for (const i of m.instincts) {
      const l = out.get(i.lineage) ?? { lineage: i.lineage, text: i.text, how: i.how, holders: [] };
      l.holders.push({ agent: m.agent, id: i.id, conf: i.conf, gen: i.gen, source: i.source, ...(i.from ? { from: i.from } : {}) });
      out.set(i.lineage, l);
    }
  }
  return [...out.values()].sort((a, b) => b.holders.length - a.holders.length);
}

/** The chooser's and the planner's section (2.1, 2.3): the member's instincts, surest first; '' with none. */
export function instinctSection(village: string, agent: string): string {
  if (!INSTINCTS.on) return '';
  const held = [...instinctsOf(village, agent)].filter((i) => i.conf > 0).sort((a, b) => b.conf - a.conf).slice(0, CAP);
  return held.length ? `Your instincts (lessons from your own work; the number is how sure you are):\n${held.map((i) => `- (${pct(i.conf)}) ${i.text}`).join('\n')}` : '';
}

// ---------------------------------------------------------------------------------------------
// Where they act: the chore menu's weight and the place layer
// ---------------------------------------------------------------------------------------------

/** The instincts a member holds (the API, the panel and checks). */
export function instinctsOf(village: string, agent: string): Instinct[] {
  return store.members[mkey(village, agent)]?.instincts ?? [];
}
/** Every member's, for one village or all (`GET /api/instincts`, session 2). */
export function allInstincts(village?: string): Array<{ village: string; agent: string; instincts: Instinct[] }> {
  return Object.entries(store.members).filter(([k]) => !village || k.startsWith(`${village.toLowerCase()}|`))
    .map(([k, m]) => ({ village: k.split('|')[0], agent: k.split('|')[1], instincts: m.instincts }));
}

/** The option's instinct weight `xw` (2.1): 1 - 0.5c for each matching avoid, 1 + 0.3c for a matching instead, their
 *  product within 0.5-1.3; undefined when none matches (so the option stays unweighted). */
export function weightFor(village: string, agent: string, o: { id: string; key: string; kind: string; at?: { x: number; z: number } }): number | undefined {
  if (!INSTINCTS.on) return undefined;
  const held = instinctsOf(village, agent);
  if (!held.length) return undefined;
  const keys = new Set([normKey(o.key), normKey(o.id)]);
  let w = 1, hit = false;
  for (const i of held) {
    const t = i.trigger;
    const byKey = t.keys.some((k) => keys.has(k)) || t.kinds.includes(o.kind);
    // (an area matches an option with a place in its scope; one without `at` only through the place layer)
    const match = t.area ? (!t.keys.length || byKey) && !!o.at && inScope(t.area, o.at.x, o.at.z) : byKey;
    if (match && i.kind === 'avoid') { w *= 1 - 0.5 * i.conf; hit = true; }
    if (i.instead && keys.has(normKey(i.instead))) { w *= 1 + 0.3 * i.conf; hit = true; }
  }
  return hit ? Math.min(XW_MAX, Math.max(XW_MIN, w)) : undefined;
}

/** Sets `xw` on a menu's options and the instincts section in its context (the world calls it where it builds the
 *  menu; the model mode shows both, the fixed pick reads `xw`). */
export function applyInstincts(menu: { agent: string; village: string; options: Array<{ id: string; key: string; kind: string; at?: { x: number; z: number }; xw?: number }>; ctx?: { instincts?: string } }): void {
  if (!INSTINCTS.on) return;
  for (const o of menu.options) {
    const w = weightFor(menu.village, menu.agent, o);
    if (w !== undefined) o.xw = w;
  }
  const s = instinctSection(menu.village, menu.agent);
  if (s && menu.ctx) menu.ctx.instincts = s;
}

/** The fixed pick changed by an instinct: what would have been chosen, and what was. */
const actLast = new Map<string, number>();
export function noteAct(village: string, agent: string, without: string, withIt: string): void {
  // (once for the same change within a few seconds: a sweep may build a member's menu twice)
  const k = `${village}|${agent}|${without}|${withIt}`, t = Date.now();
  if (t - (actLast.get(k) ?? -Infinity) < 5000) return;
  actLast.set(k, t);
  if (actLast.size > 500) actLast.delete(actLast.keys().next().value!);
  log(village, `${agent} act: picks ${withIt}, not ${without} (the fixed pick's instinct weight)`);
}

/** The area instinct a target falls under for a purpose ('collect:sand', 'trip:sand', 'walk'), or null. An area
 *  learned in a chore naming an item acts only on that item's targets. */
export function avoidedFor(village: string | undefined, agent: string, purpose: string, x: number, z: number): Instinct | null {
  if (!INSTINCTS.on || !village) return null;
  const item = /:([a-z_]+)$/.exec(purpose)?.[1];
  for (const i of instinctsOf(village, agent)) {
    const a = i.trigger.area;
    if (!a || i.kind !== 'avoid' || (i.trigger.item && item && i.trigger.item !== item)) continue;
    if (inScope(a, x, z)) return i;
  }
  return null;
}

/**
 * The place layer for one target search (2.2): `avoid(x, z)` says whether to pass a target over; `used(x, z)` records
 * that the search fell back to an avoided target (nothing else in range), so the chore's outcome grades the instinct.
 * Null when the member holds no area instinct for the purpose: the search runs exactly as before.
 */
const actSeen = new Map<string, number>();
export function placeLayer(village: string | undefined, agent: string, purpose: string): { avoid: (x: number, z: number) => boolean; used: (x: number, z: number) => void } | null {
  if (!INSTINCTS.on || !village || !instinctsOf(village, agent).some((i) => i.trigger.area)) return null;
  const chore = current.get(agent.toLowerCase());
  let passed = 0, logged = false, fell = false;
  return {
    avoid: (x, z) => {
      const i = avoidedFor(village, agent, purpose, x, z);
      if (!i) return false;
      passed++;
      // (once a search, and once in 5 minutes for the same member, purpose and instinct: menus are rebuilt every sweep)
      const k = `${village}|${agent}|${purpose}|${i.id}`, t = Date.now();
      if (!logged && t - (actSeen.get(k) ?? 0) >= 5 * 60000) {
        actSeen.set(k, t);
        log(village, `${agent} act: passes over ${purpose} at ${Math.round(x)},${Math.round(z)} (${i.id}, ${pct(i.conf)})`);
      }
      logged = true;
      return true;
    },
    used: (x, z) => {
      const i = avoidedFor(village, agent, purpose, x, z);
      if (!i) return;
      chore?.touched.add(i.id);
      if (fell) return;
      fell = true;
      log(village, `${agent} act: falls back to ${purpose} at ${Math.round(x)},${Math.round(z)} (${i.id}: nothing else in range${passed ? `, ${passed} passed over` : ''})`);
    },
  };
}
