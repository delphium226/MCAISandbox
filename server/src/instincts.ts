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
 * Settings (read once): MC_INSTINCTS on (default) | off: none of it, and no file written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { clockOf } from './memory';
import { rawSetting } from './settings';

export const INSTINCTS = { on: !/^(off|0|false|no)$/i.test(rawSetting('MC_INSTINCTS') ?? 'on') };
/** Test hook. */
export function setInstinctsOn(on: boolean): void { INSTINCTS.on = on; }

/** The spec's constants (section 5: kept in code). */
export const CAP = 5, LEARNED = 1, BORROWED = 0.5, STEP = 0.25, FADE_DAYS = 2, XW_MIN = 0.5, XW_MAX = 1.3, MAX_WORDS = 22;
/** E1's and E2's windows (village minutes), E2's count and reach (blocks), an area's scope radius and merge distance. */
const FAIL_WINDOW = 30, STALL_WINDOW = 10, STALL_N = 3, STALL_NEAR = 12, AREA_R = 6, AREA_MAX_R = 12, MERGE = 8;

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
  text: string;
  conf: number;
  source: 'learned' | 'borrowed';
  from?: string;
  at: number;
  /** Last graded (or faded): the untested fade counts from here; ties in replacement go to the least recent. */
  graded: number;
  evidence: string[];
}
interface Candidate {
  kind: 'avoid';
  how: 'E1' | 'E2';
  trigger: Trigger;
  cls?: string;
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
  const m = /(?:^|:)(?:gather|start|collect|make):([a-z_]+)/.exec(key) ?? (what ? /\bgather (?:\d+ )?([a-z_]+)/.exec(what) : null);
  return m?.[1];
}
/** A failure message's class: numbers and coordinates out, the first 8 words. */
export const msgClass = (m: string): string => m.toLowerCase().replace(/-?\d+(\.\d+)?/g, '#').replace(/[^a-z#' ]+/g, ' ')
  .split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
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
export function template(c: { how: 'E1' | 'E2'; trigger: Trigger; cls?: string; instead?: string; count: number; wet?: boolean }): string {
  const t = c.trigger;
  const doing = t.item ? `gathering ${t.item.replace(/_/g, ' ')}` : c.how === 'E2' ? 'walking out' : 'choosing your next chore';
  if (c.how === 'E2' && t.area) {
    const where = t.area.from ? `${compass(t.area.from, t.area)} ` : '';
    return fit(`When ${doing}, keep to the village's side; avoid the ${c.wet ? 'water' : 'spot'} ${where}at ${Math.round(t.area.x)},${Math.round(t.area.z)} (stuck ${c.count} times).`);
  }
  const what = t.keys[0] ?? t.kinds[0] ?? 'it';
  const instead = c.instead ? `do ${c.instead} instead` : 'pick another';
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
function grade(st: MemberState, village: string, agent: string, i: Instinct, sign: 1 | -1, why: string, now: number): void {
  i.conf = Math.min(LEARNED, i.conf + sign * STEP);
  i.graded = now;
  log(village, `${agent} ${sign > 0 ? 'confirms' : 'contradicts'} ${i.id} (${why}; ${pct(i.conf)})`);
  if (i.conf <= 1e-9) drop(st, village, agent, i, 'contradicted');
  save();
}

/** A candidate becomes an instinct (3.2): a duplicate confirms the one held, one a day, the cap of 5 replacing the
 *  least sure below 1.0, else it waits (a day at most). */
function promote(st: MemberState, village: string, agent: string, c: Candidate, now: number): Instinct | null {
  const dup = st.instincts.find((i) => sameTrigger(i.trigger, c.trigger));
  if (dup) {
    if (dup.conf < LEARNED) grade(st, village, agent, dup, 1, `learned again: ${c.evidence.at(-1) ?? ''}`, now);
    else dup.graded = now;
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
    id, lineage: `${agent}:${id}`, gen: 0, kind: c.kind, how: c.how, trigger: c.trigger, cls: c.cls, text: c.text,
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
  if (st.waiting.length && st.learnDay !== dayOf(village, now)) promote(st, village, agent, st.waiting[0], now);
}

// ---------------------------------------------------------------------------------------------
// Evidence from the world: chores (mcChoiceLog) and walk stalls (mcUtil)
// ---------------------------------------------------------------------------------------------

interface Chore { id: string; village: string; agent: string; key: string; kind: string; item?: string; t: number; graded: Set<string>; stalls: Map<string, number>; touched: Set<string> }
/** Chores by decision id, and each member's current one (its stalls and place picks count against it). */
const chores = new Map<string, Chore>();
const current = new Map<string, Chore>();

/** A `[choice]` record: the member's current chore. */
export function noteChoice(rec: { id: string; agent: string; village: string; key: string; kind: string; what?: string; t?: number }): void {
  if (!INSTINCTS.on || !rec.agent || !rec.village) return;
  const c: Chore = { id: rec.id, village: rec.village, agent: rec.agent, key: rec.key, kind: rec.kind, item: itemOf(rec.key, rec.what), t: rec.t ?? Date.now(), graded: new Set(), stalls: new Map(), touched: new Set() };
  chores.set(rec.id, c);
  current.set(rec.agent.toLowerCase(), c);
  if (chores.size > 2000) chores.delete(chores.keys().next().value!);
}

/** A `[choice-end]` record: E1's failures, E4's successes and the grading of instincts in the chore's scope. Cut
 *  chores and contention (another agent's work in the way) are not evidence. */
export function noteChoiceEnd(rec: { id: string; ok: boolean; message: string; tEnd?: number; cut?: boolean; contention?: string }): void {
  if (!INSTINCTS.on) return;
  const c = chores.get(rec.id);
  if (!c) return;
  chores.delete(rec.id);
  if (current.get(c.agent.toLowerCase()) === c) current.delete(c.agent.toLowerCase());
  if (rec.cut || rec.contention) return;
  const now = rec.tEnd ?? Date.now();
  const st = member(c.village, c.agent);
  sweep(st, c.village, c.agent, now);
  const key = normKey(c.key), cls = msgClass(rec.message);
  // Grading (3.1): one grade per instinct per chore
  for (const i of [...st.instincts]) {
    if (c.graded.has(i.id)) continue;
    let sign: 1 | -1 | 0 = 0;
    if (i.trigger.area) {
      // (the place layer fell back to an avoided target in this chore: its outcome grades the area)
      if (c.touched.has(i.id)) sign = rec.ok ? -1 : 1;
    } else if (i.instead && normKey(i.instead) === key) sign = rec.ok ? 1 : cls === i.cls ? -1 : 0;
    else if (i.trigger.keys.includes(key) || i.trigger.kinds.includes(c.kind)) sign = rec.ok ? -1 : cls === i.cls ? 1 : 0;
    if (!sign) continue;
    c.graded.add(i.id);
    grade(st, c.village, c.agent, i, sign, `${c.id} ${rec.ok ? 'ok' : 'failed'}`, now);
  }
  if (rec.ok) {
    // E4: a success at the same need by another key fills a recent E1 lesson's "instead"
    for (const i of st.instincts) {
      if (i.how !== 'E1' || i.instead || i.trigger.keys.includes(key) || now - i.at > vmin(FAIL_WINDOW)) continue;
      if ((i.trigger.item && i.trigger.item === c.item) || (!i.trigger.item && i.trigger.kinds.includes(c.kind))) {
        i.instead = key;
        i.text = template({ how: i.how, trigger: i.trigger, cls: i.cls, instead: key, count: 2 });
        log(c.village, `${c.agent} fills ${i.id}'s instead: ${key} (${c.id})`);
        save();
      }
    }
    return;
  }
  // E1: the same key failed twice within 30 village minutes with the same message class
  st.fails = st.fails.filter((f) => now - f.t <= vmin(FAIL_WINDOW));
  const ref = `${c.id} "${rec.message.slice(0, 60)}"`;
  const same = st.fails.filter((f) => f.key === key && f.cls === cls);
  st.fails.push({ key, cls, t: now, ref: c.id });
  if (st.fails.length > 40) st.fails.splice(0, st.fails.length - 40);
  if (same.length + 1 < 2) return;
  const trigger: Trigger = { keys: [key], kinds: [], item: c.item };
  const cand: Candidate = { kind: 'avoid', how: 'E1', trigger, cls, evidence: [...same.map((f) => f.ref), ref], count: same.length + 1, at: now, text: '' };
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
export function noteStall(line: string, opts: { village?: string; home?: { x: number; z: number } | null; now?: number } = {}): Instinct | null {
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
        grade(st, village, s.agent, held, 1, `${n} stalls in it during ${chore.id}`, now);
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
  const r = Math.min(AREA_MAX_R, Math.max(AREA_R, ...near.map((q) => Math.hypot(q.x - cx, q.z - cz) + 2)));
  const area: Area = { x: Math.round(cx * 10) / 10, z: Math.round(cz * 10) / 10, r: Math.round(r * 10) / 10, ...(opts.home ? { from: { x: opts.home.x, z: opts.home.z } } : {}) };
  const trigger: Trigger = { keys: chore ? [normKey(chore.key)] : [], kinds: [], item: chore?.item, area };
  const cand: Candidate = { kind: 'avoid', how: 'E2', trigger, evidence: near.map((q) => q.ref), count: near.length, at: now, text: '', wet: near.filter((q) => q.wet).length * 2 > near.length };
  cand.text = template(cand);
  const i = promote(st, village, s.agent, cand, now);
  // (the stalls that taught it are used: the next ones grade it)
  if (i) st.stalls = st.stalls.filter((q) => !near.includes(q));
  return i;
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

/** Sets `xw` on a menu's options (the world calls it where it builds the menu). */
export function applyInstincts(menu: { agent: string; village: string; options: Array<{ id: string; key: string; kind: string; at?: { x: number; z: number }; xw?: number }> }): void {
  if (!INSTINCTS.on) return;
  for (const o of menu.options) {
    const w = weightFor(menu.village, menu.agent, o);
    if (w !== undefined) o.xw = w;
  }
}

/** The fixed pick changed by an instinct: what would have been chosen, and what was. */
export function noteAct(village: string, agent: string, without: string, withIt: string): void {
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
