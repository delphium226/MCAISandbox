/**
 * Members' memory (G1, PLAN E.2, #26): what each member of a village keeps across hours and agent-server restarts, and what
 * of it reaches its decisions. World-free: the world reports chore ends, spawns and intents; the chooser asks for the
 * memory section of its prompt and hands back what the model chose to remember. Spec: runs/2026-10-21/g1-memory/spec.md.
 *
 * Code keeps the facts (each chore end, the per-kind table, a line per finished day); the model keeps its notes (one per
 * decision at most, `remember`, replacing an old one by id when full) and its intention for the day (at dawn, or from the
 * night's reflection). Stored in `social.json` beside villages.json, debounced, renamed into place, flushed at exit.
 *
 * Settings (read once):
 *   MC_MEMORY        off (default) | on: the store's writes beyond the intent, the prompt sections, the tool's fields
 *   MC_CLOCK         off (default) | on: the village day (society.ts), dawn intentions, day lines, the night's reflection
 *   MC_REFLECT       on (default) | off: the night's reflection call (with the clock on)
 *   MC_DAY_MIN       20: the village day in minutes (divided by MC_TIME_SCALE)
 *   MC_MEMORY_CARRY  off (default) | on: a spawn with reset keeps the member's memory (a carry-over across runs)
 *   MC_MEMORY_CHARS  2000: the cap on the chooser's memory section (~500 tokens)
 *   MC_MEMORY_NOTES  8: live notes per member
 *   MC_MEMORY_QUALITY off (default) | on (G2, #86): near-duplicate notes merge into the older, notes the world rules out
 *                    are refused (and the member told once), the night's `keep`
 *   MCAI_ACTS_LOG    the ledger's file; else beside MCAI_CHOICE_LOG (X.choices.jsonl -> X.acts.jsonl), else runs/acts-<date>.jsonl
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME_POOL } from './agentNames';
import { rawSetting } from './settings';

const on = (v: string | undefined, dflt = false) => (v === undefined || v === '' ? dflt : /^(on|1|true|yes)$/i.test(v));

export const MEMORY = {
  on: on(rawSetting('MC_MEMORY')),
  clock: on(rawSetting('MC_MEMORY')) && on(rawSetting('MC_CLOCK')),
  reflect: on(rawSetting('MC_REFLECT'), true),
  dayMs: (Number(rawSetting('MC_DAY_MIN') ?? 20) * 60000) / Math.max(0.1, Number(rawSetting('MC_TIME_SCALE') ?? 1) || 1),
  carry: on(rawSetting('MC_MEMORY_CARRY')),
  chars: Number(rawSetting('MC_MEMORY_CHARS') ?? 2000),
  notes: Number(rawSetting('MC_MEMORY_NOTES') ?? 8),
  quality: on(rawSetting('MC_MEMORY')) && on(rawSetting('MC_MEMORY_QUALITY')),
};

/** Whether the village's day line may be shown (G2: not under MCAI_SOCIAL=off, where others' activity is left out; set by
 *  social.ts, which memory.ts cannot import). */
let villageLine = () => true;
export function setVillageLineShown(fn: () => boolean): void {
  villageLine = fn;
}
export const villageLineShown = () => villageLine();

/** Other members' names left out of a member's remembered text (G2, MCAI_SOCIAL=off: a skill's failure message named a
 *  member in E1b4's "Your last chores"; set by social.ts). */
let scrubber: ((village: string, agent: string, text: string) => string) | null = null;
export function setScrubber(fn: ((village: string, agent: string, text: string) => string) | null): void {
  scrubber = fn;
}
export const scrub = (village: string, agent: string, text: string) => (scrubber ? scrubber(village, agent, text) : text);

/** Test hook: set the settings (memory_unit.mts). */
export function setMemorySettings(s: Partial<typeof MEMORY>): void {
  Object.assign(MEMORY, s);
  if (s.on === false) MEMORY.clock = false;
}

// ---------------------------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------------------------

export interface Intent {
  kind: string;
  what: string;
  why: string;
  since: number;
  source: string;
}
export interface Note {
  id: string;
  t: number;
  day: number;
  text: string;
  /** Times shown in a prompt. */
  shown: number;
  by: 'decision' | 'night';
  /** The note that replaced it (never shown again). */
  replaced?: string;
  /** #86: near-duplicates merged into it (its text and time are the latest's). */
  merged?: number;
}
export interface LogEntry {
  t: number;
  day: number;
  kind: string;
  option: string;
  name: string;
  ok: boolean;
  productive: boolean;
  cut: boolean;
  minutes: number;
  line: string;
  /** Importance by code: failure 6, first success of a kind 7, productive 3, nothing gained 2, cut 1. */
  imp: number;
  /** The failure's message, cut. */
  msg?: string;
}
export interface KindRow {
  n: number;
  ok: number;
  productive: number;
  minutes: number;
  first: number;
  last: number;
}
export interface Roster {
  role: string;
  brain: string | null;
  gamemode?: string;
  memory: Record<string, unknown>;
  at: number;
}
export interface DayLine {
  day: number;
  line: string;
}
export interface Intention {
  day: number;
  text: string;
  at: number;
  by: 'dawn' | 'night';
  /** The kind of work it means to do most (one of FOCUS), so code can tell whether it kept to it. */
  focus?: string;
}
export interface AgentMemory {
  name: string;
  village: string;
  roster?: Roster;
  intent?: Intent;
  intents: Intent[];
  today?: Intention;
  yesterday?: Intention;
  notes: Note[];
  nextNote: number;
  /** Notes added on a day (the per-day cap). */
  added: { day: number; n: number };
  log: LogEntry[];
  days: DayLine[];
  kinds: Record<string, KindRow>;
  /** The last day whose line (and reflection) is done. */
  nightDone: number;
  /** G2-G4's places (social.ts), empty in G1. */
  social: Record<string, unknown>;
  /** #86: why the last note it wanted kept was refused, told once in its next memory section. */
  refused?: string;
  /** G5 (#90): the answers to its proposals and those it backed, pinned (the last 3), never evicted like notes. */
  answers?: Array<{ id: string; line: string; at: number }>;
}
export interface VillageMemory {
  name: string;
  run: string;
  epoch: number;
  dayMs: number;
  days: DayLine[];
  nightDone: number;
  phase?: string;
  /** G3-G4's places (chronicle, rules, lore, ballots), empty in G1. */
  social: Record<string, unknown>;
}
interface Store {
  version: 1;
  villages: Record<string, VillageMemory>;
  agents: Record<string, AgentMemory>;
}

const LOG_MAX = 60, DAYS_MAX = 24, INTENTS_MAX = 10, NOTE_CHARS = 140, NOTES_PER_DAY = 3;
/** A note older than this many village days (or 40 minutes without the clock) is shown as possibly out of date. */
const NOTE_OLD_DAYS = 2;
/** The kinds in words (temperament.ts' KIND_PHRASE, copied: importing it here would close a cycle through choose.ts). */
export const KIND_WORDS: Record<string, string> = {
  farm: 'harvesting', slot: 'harvesting', start: 'starting farms', annex: 'preparing the annex', pen: 'leading animals',
  penwork: 'tending pens', cake: 'baking', iron: 'digging for iron', explore: 'exploring', works: 'setting up the works',
  make: 'making goods', gather: 'gathering', light: 'lighting', furnish: 'furnishing', initiate: 'own projects',
  help: "helping others' projects", activity: 'new crafts', grow: 'laying out houses', eat: 'eating', tidy: 'tidying',
  own: 'own goods', innovate: 'innovating', task: 'board tasks',
};
const words = (k: string) => KIND_WORDS[k] ?? k;
/** The kinds of work an intention can focus on (the menu's kinds in words, each once; eating and tidying left out). */
export const FOCUS: string[] = [...new Set(Object.entries(KIND_WORDS).filter(([k]) => k !== 'eat' && k !== 'tidy' && k !== 'task').map(([, w]) => w))];
/** A chore kind's focus word. */
export const focusOf = (kind: string) => words(kind);
/** Words that point a free-text focus at a kind (gpt-oss ignores the enum: "animal care", "building", "beauty"). */
const FOCUS_HINTS: Array<[RegExp, string]> = [
  [/pen|animal|egg|chicken|cow|milk|breed/, 'tending pens'], [/harvest|farm|crop|wheat|pumpkin|field/, 'harvesting'],
  [/light|torch|lamp/, 'lighting'], [/furnish|furniture|decor|interior/, 'furnishing'], [/explor|scout|map/, 'exploring'],
  [/help|assist|support|others/, "helping others' projects"], [/own project|build|construct|statue|gazebo|well|bench|signpost|woodshed|market|beaut/, 'own projects'],
  [/innovat|experiment|research|invent|pledge/, 'innovating'], [/new craft|fish|activit/, 'new crafts'], [/gather|log|wood|collect|mine|stone/, 'gathering'],
  [/sell|trade|own (goods|stock|chest)|merchant|barter/, 'own goods'], [/make|craft|tool|goods|charcoal|glass|food|cook|bake/, 'making goods'],
  [/iron/, 'digging for iron'], [/house|street|neighbourhood/, 'laying out houses'],
];
/** A focus as the model wrote it, as one of FOCUS (exact, then the first hint that matches), or undefined. */
export function normaliseFocus(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const f = raw.trim().toLowerCase();
  if (!f) return undefined;
  if (FOCUS.includes(f)) return f;
  return FOCUS_HINTS.find(([re]) => re.test(f))?.[1];
}

// ---------------------------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------------------------

let store: Store = { version: 1, villages: {}, agents: {} };
let file: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
/** Villages whose run began in this process (a spawn with reset begins one only once). */
const begun = new Set<string>();

const key = (village: string, agent: string) => `${village.toLowerCase()}|${agent.toLowerCase()}`;

/** Load the store of a world's folder (the agent server's data dir); called once by the world. */
export function initMemory(dataDir: string | null): void {
  file = dataDir ? path.join(dataDir, 'social.json') : null;
  store = { version: 1, villages: {}, agents: {} };
  begun.clear();
  if (file && fs.existsSync(file)) {
    try {
      const s = JSON.parse(fs.readFileSync(file, 'utf8')) as Store;
      if (s && s.version === 1) store = { version: 1, villages: s.villages ?? {}, agents: s.agents ?? {} };
    } catch (e) {
      console.error(`[memory] cannot read ${file}: ${(e as Error).message}; starting empty (the file is left as it is)`);
      file = `${file}.new`;
    }
  }
  if (!exitHooked) {
    exitHooked = true;
    process.on('exit', () => flushMemory());
  }
}
let exitHooked = false;

/** The store as JSON (tests: a round trip). */
export function serialiseMemory(): string {
  return JSON.stringify(store);
}
/** Replace the store from JSON (tests). */
export function loadMemory(json: string): void {
  store = JSON.parse(json) as Store;
}

function save(): void {
  dirty = true;
  if (!file || timer) return;
  timer = setTimeout(() => {
    timer = null;
    flushMemory();
  }, 500);
}

/** Write any change now, synchronously (a temporary file renamed over the store; in place if a reader holds it). */
export function flushMemory(): void {
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
    console.error(`[memory] saving ${file} failed: ${(e as Error).message}`);
  }
}

export function villageMemory(village: string): VillageMemory | undefined {
  return store.villages[village.toLowerCase()];
}

export function agentMemory(village: string, agent: string): AgentMemory | undefined {
  return store.agents[key(village, agent)];
}

/** Every member's memory in a village. */
export function membersOf(village: string): AgentMemory[] {
  const v = village.toLowerCase();
  return Object.values(store.agents).filter((m) => m.village.toLowerCase() === v);
}

function ensureVillage(village: string, now: number): VillageMemory {
  const k = village.toLowerCase();
  return (store.villages[k] ??= { name: village, run: `${village}@${now}`, epoch: now, dayMs: MEMORY.dayMs, days: [], nightDone: 0, social: {} });
}

function ensureAgent(village: string, agent: string): AgentMemory {
  const k = key(village, agent);
  return (store.agents[k] ??= {
    name: agent, village, intents: [], notes: [], nextNote: 1, added: { day: 0, n: 0 }, log: [], days: [], kinds: {}, nightDone: 0, social: {},
  });
}

/** G5 (#90): an answer to a proposal, pinned in the member's memory (the last 3; once per proposal). False when it was
 *  there already. */
export function noteAnswer(village: string, agent: string, id: string, line: string, now = Date.now()): boolean {
  const a = ensureAgent(village, agent);
  const list = (a.answers ??= []);
  if (list.some((x) => x.id === id)) return false;
  list.push({ id, line: line.slice(0, 220), at: now });
  if (list.length > 3) list.splice(0, list.length - 3);
  logAct({ type: 'answer', village, agent, id, line });
  save();
  return true;
}
/** Whether the member has been told a proposal's answer. */
export const toldAnswer = (village: string, agent: string, id: string) => !!agentMemory(village, agent)?.answers?.some((x) => x.id === id);

/** G2: a member's social places (social.ts' MemberSocial), created on first use; touchMemory() after a change. */
export function socialOf(village: string, agent: string): Record<string, unknown> {
  return ensureAgent(village, agent).social;
}
/** G2: a village's social places (social.ts' VillageSocial). */
export function villageSocialOf(village: string, now = Date.now()): Record<string, unknown> {
  return ensureVillage(village, now).social;
}
/** A change made through socialOf or villageSocialOf, to be saved. */
export function touchMemory(): void {
  save();
}

// ---------------------------------------------------------------------------------------------
// The clock's arithmetic (the phases' hooks are society.ts')
// ---------------------------------------------------------------------------------------------

export type Phase = 'dawn' | 'day' | 'dusk' | 'night';
/** The windows of a day, as fractions: dawn [0, 0.1), day [0.1, 0.75), dusk [0.75, 0.85), night [0.85, 1). */
export const WINDOWS: Record<Phase, [number, number]> = { dawn: [0, 0.1], day: [0.1, 0.75], dusk: [0.75, 0.85], night: [0.85, 1] };

/** FNV-1a, 32 bits (choose.ts' own, copied for the same cycle's reason). */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The village's day (1-based), its phase and the fraction of the day gone; null without a clock. */
export function clockOf(village: string, now: number): { day: number; phase: Phase; frac: number; dayStart: number; dayMs: number } | null {
  const v = villageMemory(village);
  if (!MEMORY.clock || !v) return null;
  const t = Math.max(0, now - v.epoch);
  const day = Math.floor(t / v.dayMs) + 1;
  const frac = (t % v.dayMs) / v.dayMs;
  const phase = (Object.keys(WINDOWS) as Phase[]).find((p) => frac >= WINDOWS[p][0] && frac < WINDOWS[p][1]) ?? 'night';
  return { day, phase, frac, dayStart: v.epoch + (day - 1) * v.dayMs, dayMs: v.dayMs };
}

/** An agent's own moment inside a window (a fraction of the day), so 25 members do not all act at its start. */
export function offsetIn(agent: string, phase: Phase): number {
  const [a, b] = WINDOWS[phase];
  // (the first 80% of the window, leaving its end for stragglers)
  return a + ((fnv(`${agent.toLowerCase()}|${phase}`) % 1000) / 1000) * (b - a) * 0.8;
}

/** The day an entry made now belongs to (0 without a clock). */
function dayNow(village: string, now: number): number {
  return clockOf(village, now)?.day ?? 0;
}

// ---------------------------------------------------------------------------------------------
// The ledger (acts.jsonl)
// ---------------------------------------------------------------------------------------------

const ROOT = rawSetting('MCAI_ROOT') ? path.resolve(rawSetting('MCAI_ROOT')!) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let actsWarned = false;

export function actsFile(): string {
  if (rawSetting('MCAI_ACTS_LOG')) return path.resolve(rawSetting('MCAI_ACTS_LOG')!);
  const c = rawSetting('MCAI_CHOICE_LOG');
  if (c) return path.resolve(c.replace(/(\.choices)?\.jsonl$/, '') + '.acts.jsonl');
  const d = new Date();
  return path.join(ROOT, 'runs', `acts-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.jsonl`);
}

/** One record into the ledger (never throws). */
export function logAct(rec: Record<string, unknown>): void {
  try {
    const f = actsFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify({ t: Date.now(), ...rec }) + '\n');
  } catch (e) {
    if (!actsWarned) console.error(`[memory] cannot write the acts ledger: ${(e as Error).message}`);
    actsWarned = true;
  }
}

// ---------------------------------------------------------------------------------------------
// What the world reports
// ---------------------------------------------------------------------------------------------


/**
 * A member spawned. Always: its roster (for respawn_agents.py). With memory on: a spawn with reset begins the village's run
 * once in this process (a new run id, the clock from now, the village's day lines cleared) and empties the member's memory
 * (unless MC_MEMORY_CARRY); a spawn without reset keeps both (the respawn path).
 */
export function noteSpawn(village: string, agent: string, o: { role: string; brain: string | null; gamemode?: string; memory: Record<string, unknown>; reset: boolean }, now = Date.now()): void {
  // (the spawn request's memory as given, the Mayor's starting plan too; JSON only)
  let m: Record<string, unknown> = {};
  try {
    m = JSON.parse(JSON.stringify(o.memory ?? {})) as Record<string, unknown>;
  } catch {
    m = {};
  }
  if (MEMORY.on && o.reset) {
    const vk = village.toLowerCase();
    if (!begun.has(vk)) {
      begun.add(vk);
      const old = store.villages[vk];
      store.villages[vk] = { name: village, run: `${village}@${now}`, epoch: now, dayMs: MEMORY.dayMs, days: [], nightDone: 0, social: {} };
      logAct({ type: 'run', village, run: store.villages[vk].run, ...(old ? { previous: old.run } : {}) });
      console.log(`[memory] ${village}: a new run begins (${store.villages[vk].run})`);
    }
    const old = agentMemory(village, agent);
    if (old && !MEMORY.carry) {
      logAct({ type: 'memory-cleared', village, agent, notes: old.notes.length, log: old.log.length, days: old.days.length });
      delete store.agents[key(village, agent)];
    }
  } else if (MEMORY.on) {
    ensureVillage(village, now);
    begun.add(village.toLowerCase());
    const a = agentMemory(village, agent);
    logAct({ type: 'respawn', village, agent, notes: a?.notes.filter((n) => !n.replaced).length ?? 0, log: a?.log.length ?? 0, days: a?.days.length ?? 0 });
  }
  const a = ensureAgent(village, agent);
  a.roster = { role: o.role, brain: o.brain, ...(o.gamemode ? { gamemode: o.gamemode } : {}), memory: m, at: now };
  save();
}

/** What a member is doing now and why, into its memory (memory on; the world keeps it on the agent always). */
export function noteIntent(village: string, agent: string, intent: Intent): void {
  if (!MEMORY.on) return;
  const a = ensureAgent(village, agent);
  a.intent = intent;
  a.intents.push(intent);
  if (a.intents.length > INTENTS_MAX) a.intents.splice(0, a.intents.length - INTENTS_MAX);
  save();
}

/** A chore's end (memory on): into the log and the kind table. */
export function noteEnd(village: string, agent: string, e: { kind: string; option: string; name: string; ok: boolean; productive: boolean; cut: boolean; minutes: number; line: string; message: string }, now = Date.now()): void {
  if (!MEMORY.on) return;
  ensureVillage(village, now);
  const a = ensureAgent(village, agent);
  const row = (a.kinds[e.kind] ??= { n: 0, ok: 0, productive: 0, minutes: 0, first: now, last: now });
  const firstOk = e.ok && row.ok === 0;
  if (!e.cut) {
    row.n++;
    if (e.ok) row.ok++;
    if (e.productive) row.productive++;
    row.minutes += e.minutes;
  }
  row.last = now;
  const imp = e.cut ? 1 : !e.ok ? 6 : firstOk ? 7 : e.productive ? 3 : 2;
  a.log.push({ t: now, day: dayNow(village, now), kind: e.kind, option: e.option, name: e.name, ok: e.ok, productive: e.productive, cut: e.cut, minutes: e.minutes, line: e.line, imp, ...(e.ok ? {} : { msg: e.message.slice(0, 120) }) });
  if (a.log.length > LOG_MAX) {
    // (the lowest importance of the oldest half goes, the oldest of those first)
    const half = a.log.slice(0, Math.floor(LOG_MAX / 2));
    const low = Math.min(...half.map((x) => x.imp));
    a.log.splice(half.findIndex((x) => x.imp === low), 1);
  }
  save();
}

// ---------------------------------------------------------------------------------------------
// The model's writes
// ---------------------------------------------------------------------------------------------

export const liveNotes = (a: AgentMemory | undefined) => (a?.notes ?? []).filter((n) => !n.replaced);

const cleanText = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// (#86, MC_MEMORY_QUALITY) Near-duplicates and false beliefs

const STOP = new Set(('the a an and or but of to in on at for with from by as is are was were be been it its this that these those '
  + 'i me my mine you your we our they them their he she his her will would should could can may might must shall do does did done '
  + 'have has had not no so then than too very more most some any all each every soon now later today tomorrow also just still '
  + 'next first again when while before after into out up down over about what which who how why there here').split(' '));
/** A note's content words: lower case, stop words and short words out, a plural or verb ending cut. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z]+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.add(w.replace(/(ing|ed|es|s)$/, '') || w);
  }
  return out;
}
/** The live note a new text repeats (Jaccard of content words >= 0.5 and 3+ shared, the closest), if any. */
export function nearDuplicate(live: Note[], text: string): Note | undefined {
  const a = contentWords(text);
  let best: Note | undefined, bj = 0;
  for (const n of live) {
    const b = contentWords(n.text);
    const shared = [...a].filter((w) => b.has(w)).length;
    const j = shared / (a.size + b.size - shared || 1);
    if (shared >= 3 && j >= 0.5 && j > bj) {
      best = n;
      bj = j;
    }
  }
  return best;
}
/** What the world rules out, in words a note may use (peaceful survival: no hostile mobs, no damage; the world's rules). */
const RULED_OUT: Array<[RegExp, string]> = [
  [/\b(hostile|mobs?|monsters?|zombies?|creepers?|skeletons?|spiders?|endermen|enderman|witch(es)?|phantoms?)\b/i, 'the world is peaceful: there are no hostile mobs'],
  [/\b(take|taking|took|takes) damage\b|\b(hurt|injur(y|ed|ies)|wounded|starv(e|ing|ation))\b|\b(die|dies|dying|died)\b/i, 'no one takes damage or dies in this world'],
];
/** Other checks a note must pass (acts.ts adds the promise check); each returns why it is refused, or null. */
const checkers: Array<(village: string, agent: string, text: string) => string | null> = [];
export function addNoteCheck(fn: (village: string, agent: string, text: string) => string | null): void {
  checkers.push(fn);
}
/** Why the note is false for this world or village, or null (#86): what the world rules out, a member named who is not one of
 *  the village's (names from the pool only), the added checks. */
export function checkNote(village: string, agent: string, text: string): string | null {
  for (const [re, why] of RULED_OUT) if (re.test(text)) return why;
  const members = new Set(membersOf(village).map((m) => m.name.toLowerCase()));
  for (const n of NAME_POOL) if (new RegExp(`\\b${n}\\b`).test(text) && !members.has(n.toLowerCase())) return `${n} is not a member of ${village}`;
  for (const fn of checkers) {
    const why = fn(village, agent, text);
    if (why) return why;
  }
  return null;
}

/**
 * What the model chose to keep (a decision's or the night's): a note (replacing `replaces` when it names a live note; when
 * the notes are full and it names none, the oldest of the least shown goes), and an intention. Returns what was done.
 */
export function applyWrites(village: string, agent: string, w: { remember?: unknown; replaces?: unknown; intention?: unknown; focus?: unknown }, by: 'decision' | 'night', now = Date.now(), ref?: string): string[] {
  if (!MEMORY.on) return [];
  const a = ensureAgent(village, agent);
  const day = dayNow(village, now);
  const done: string[] = [];
  // (an id the model wrote before its note, "n3: ...", copied from the prompt's list: left out)
  const text = cleanText(typeof w.remember === 'string' ? w.remember.replace(/^\s*\[?n\d+\]?[:,.]?\s*/i, '') : w.remember, NOTE_CHARS);
  if (text) {
    const live = liveNotes(a);
    if (a.added.day !== day) a.added = { day, n: 0 };
    const refused = MEMORY.quality ? checkNote(village, agent, text) : null;
    const dup = MEMORY.quality && !refused ? nearDuplicate(live, text) : undefined;
    if (refused) {
      a.refused = refused;
      logAct({ type: 'memory', op: 'refused', why: refused, village, agent, text, by, ref });
      done.push('refused');
    } else if (dup) {
      // (#86: into the older note, which keeps its id and takes the newer text and time; not counted toward the day's cap)
      logAct({ type: 'memory', op: 'merge', village, agent, id: dup.id, was: dup.text, text, by, ref });
      dup.text = text;
      dup.t = now;
      dup.day = day;
      dup.merged = (dup.merged ?? 0) + 1;
      done.push(`merge ${dup.id}`);
    } else if (by === 'decision' && a.added.n >= NOTES_PER_DAY) {
      logAct({ type: 'memory', op: 'dropped', why: 'per-day cap', village, agent, text, ref });
      done.push('dropped');
    } else if (live.some((n) => n.text.toLowerCase() === text.toLowerCase())) {
      logAct({ type: 'memory', op: 'dropped', why: 'same as a note', village, agent, text, ref });
      done.push('dropped');
    } else {
      const id = `n${a.nextNote++}`;
      const want = typeof w.replaces === 'string' ? w.replaces.trim() : '';
      const rep = want ? live.find((n) => n.id === want) : undefined;
      let out = rep;
      if (!out && live.length >= MEMORY.notes) {
        // (the oldest: every live note is shown at every decision, so "least shown" would pick the newest; the review's S3)
        out = [...live].sort((x, y) => x.t - y.t)[0];
        logAct({ type: 'memory', op: 'evict', village, agent, id: out.id, text: out.text, by: id, ref });
        done.push(`evict ${out.id}`);
      }
      if (out) out.replaced = id;
      a.notes.push({ id, t: now, day, text, shown: 0, by });
      a.added.n++;
      logAct({ type: 'memory', op: rep ? 'replace' : 'add', village, agent, id, text, ...(rep ? { replaces: rep.id } : {}), by, ref });
      done.push(rep ? `replace ${rep.id}` : 'add');
      // (replaced notes kept, but not for ever: the 40 newest replaced)
      const gone = a.notes.filter((n) => n.replaced);
      if (gone.length > 40) a.notes = a.notes.filter((n) => !n.replaced || gone.indexOf(n) >= gone.length - 40);
    }
  }
  const intention = cleanText(w.intention, 200);
  if (intention && MEMORY.clock) {
    const c = clockOf(village, now);
    // (the night's is for tomorrow)
    const forDay = by === 'night' ? (c?.day ?? 0) + 1 : c?.day ?? 0;
    if (a.today && a.today.day < forDay) a.yesterday = a.today;
    const focus = normaliseFocus(w.focus) ?? normaliseFocus(intention);
    a.today = { day: forDay, text: intention, at: now, by: by === 'night' ? 'night' : 'dawn', ...(focus ? { focus } : {}) };
    logAct({ type: 'intention', village, agent, day: forDay, text: intention, ...(focus ? { focus } : {}), ...(typeof w.focus === 'string' ? { focusText: w.focus } : {}), by, ref });
    done.push('intention');
  }
  if (done.length) save();
  return done;
}

// ---------------------------------------------------------------------------------------------
// Recall: the prompt's memory section
// ---------------------------------------------------------------------------------------------

const ago = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : `${Math.round(m / 6) / 10} h ago`;
};

/** The kind table as a line: the top 4 kinds by count. */
export function recordLine(a: AgentMemory): string {
  const rows = Object.entries(a.kinds).filter(([k, r]) => r.n > 0 && k !== 'eat' && k !== 'tidy').sort((x, y) => y[1].n - x[1].n).slice(0, 4);
  return rows.map(([k, r]) => `${words(k)} ${r.n} (${r.productive} gave something${r.n ? `, ${Math.round((r.minutes / r.n) * 10) / 10} min each` : ''})`).join(', ');
}

/** Whether the agent's next model decision is its dawn decision (the clock on, no intention for today yet, past its offset). */
export function isDawnDecision(village: string, agent: string, now: number): boolean {
  const c = clockOf(village, now);
  if (!c) return false;
  const a = agentMemory(village, agent);
  if (a?.today && a.today.day >= c.day) return false;
  return c.frac >= offsetIn(agent, 'dawn');
}

export interface Recall {
  text: string;
  /** The items shown: note ids, 'intention', 'record', 'day:N', 'log:t', 'village'. */
  shown: string[];
  liveIds: string[];
  full: boolean;
  dawn: boolean;
  day: number;
}

/**
 * The memory section of a decision's prompt (spec 2.1), capped by code at `cap` characters: the intention, the live notes
 * (newest first), the record by kind, the last two day lines, earlier-today failures and firsts beyond the last chores, and
 * the village's last day line; lines dropped from the bottom up. `lastShown`: the number of end lines the prompt already
 * shows (its last chores). Marks the notes shown (their `shown` count). null when off or nothing is remembered yet.
 */
export function recall(village: string, agent: string, now: number, o: { cap?: number; lastShown?: number; earlierToday?: boolean; mark?: boolean } = {}): Recall | null {
  if (!MEMORY.on) return null;
  const a = agentMemory(village, agent);
  const v = villageMemory(village);
  const c = clockOf(village, now);
  const dawn = isDawnDecision(village, agent, now);
  const live = liveNotes(a).sort((x, y) => y.t - x.t);
  const lines: Array<{ text: string; items: string[]; keep?: boolean }> = [];
  if (c && a?.today && a.today.day === c.day) lines.push({ text: `- Your intention today${a.today.by === 'night' ? ' (set last night)' : ''}: ${a.today.text}`, items: ['intention'], keep: true });
  else if (c && a?.today) lines.push({ text: `- Your last intention (day ${a.today.day}): ${a.today.text}`, items: ['intention'], keep: true });
  if (live.length) {
    const old = (n: Note) => (c ? c.day - n.day >= NOTE_OLD_DAYS : now - n.t > 40 * 60000);
    const stamp = (n: Note) => `${c ? `day ${n.day}, ${ago(now - n.t)}` : ago(now - n.t)}${old(n) ? ', old: may be out of date' : ''}`;
    lines.push({ text: `- Your notes${live.length >= MEMORY.notes ? ` (full: a new one must replace one, give its id)` : ''}: ${live.map((n) => `[${n.id}, ${stamp(n)}] ${n.text}`).join(' ')}`, items: live.map((n) => n.id), keep: true });
  }
  if (a) {
    const rec = recordLine(a);
    if (rec) lines.push({ text: `- Your record${c ? ` over ${c.day} day${c.day === 1 ? '' : 's'}` : ''}: ${rec}.`, items: ['record'] });
    const days = a.days.slice(-2);
    if (days.length) lines.push({ text: `- Earlier: ${days.map((d) => d.line).join(' ')}`, items: days.map((d) => `day:${d.day}`) });
    if (o.earlierToday !== false) {
      const skip = o.lastShown ?? 5;
      const older = a.log.filter((e) => !e.cut).slice(0, Math.max(0, a.log.filter((e) => !e.cut).length - skip));
      const today = c ? older.filter((e) => e.day === c.day) : older.filter((e) => now - e.t < 60 * 60000);
      const notable = today.filter((e) => e.imp >= 6).slice(-2);
      if (notable.length) lines.push({ text: `- Earlier ${c ? 'today' : 'this hour'}: ${notable.map((e) => `"${e.name}": ${e.ok ? 'done (your first of its kind)' : `failed${e.msg ? ` (${e.msg.slice(0, 60)})` : ''}`}, ${ago(now - e.t)}`).join('; ')}.`, items: notable.map((e) => `log:${e.t}`) });
    }
  }
  if (v?.days.length && villageLine()) lines.push({ text: `- The village: ${v.days[v.days.length - 1].line}`, items: ['village'] });
  for (const x of a?.answers ?? []) lines.push({ text: `- ${x.line}`, items: [`answer:${x.id}`], keep: true });
  // (M3, MC_MONUMENT_NEWS: the member's own part in the village's project, kept by code on the project's record)
  for (const t of projectLines?.(village, agent, now) ?? []) lines.push({ text: `- ${t}`, items: ['project'], keep: true });
  if (MEMORY.quality && a?.refused) lines.push({ text: `- A note you wanted to keep was not kept: ${a.refused}.`, items: ['refused'], keep: true });
  // (a member with nothing remembered yet still gets the head on its first choice of a day, so the intention is asked)
  if (!lines.length && !dawn) return null;
  const head = c ? `What you remember (village day ${c.day}, ${c.phase}; a day is ${Math.round(c.dayMs / 60000)} minutes):` : 'What you remember:';
  const cap = o.cap ?? MEMORY.chars;
  let out = [head, ...lines.map((l) => l.text)];
  let kept = [...lines];
  while (out.join('\n').length > cap && kept.some((l) => !l.keep)) {
    const i = kept.map((l) => !l.keep).lastIndexOf(true);
    kept = kept.filter((_, j) => j !== i);
    out = [head, ...kept.map((l) => l.text)];
  }
  let text = scrub(village, agent, out.join('\n'));
  if (text.length > cap) text = `${text.slice(0, cap - 3)}...`;
  if (o.mark !== false && a) {
    for (const n of live) if (kept.some((l) => l.items.includes(n.id))) n.shown++;
    if (kept.some((l) => l.items.includes('refused'))) delete a.refused;
    save();
  }
  return { text, shown: kept.flatMap((l) => l.items), liveIds: live.map((n) => n.id), full: live.length >= MEMORY.notes, dawn, day: c?.day ?? 0 };
}

/** M3 (MC_MONUMENT_NEWS): code's lines on a long project the member remembers (set by the world; none by default). */
let projectLines: ((village: string, agent: string, now: number) => string[]) | null = null;
export function setProjectLines(fn: ((village: string, agent: string, now: number) => string[]) | null): void {
  projectLines = fn;
}

/** The last n end lines (the chooser's "Your last chores" after a restart emptied the statistics). */
export function lastLines(village: string, agent: string, n: number): string[] {
  return (agentMemory(village, agent)?.log ?? []).slice(-n).map((e) => scrub(village, agent, e.line));
}

// ---------------------------------------------------------------------------------------------
// Day lines (the night's, by code)
// ---------------------------------------------------------------------------------------------

/** The agent's line for a finished day, from its log ('' when it did nothing that day). */
export function agentDayLine(a: AgentMemory, day: number): string {
  const es = a.log.filter((e) => e.day === day && !e.cut);
  if (!es.length) return '';
  const by = new Map<string, number>();
  for (const e of es) by.set(words(e.kind), (by.get(words(e.kind)) ?? 0) + 1);
  const fails = new Map<string, { n: number; msg: string }>();
  for (const e of es.filter((x) => !x.ok)) fails.set(e.name, { n: (fails.get(e.name)?.n ?? 0) + 1, msg: e.msg ?? '' });
  const firsts = es.filter((e) => e.imp === 7).map((e) => e.name);
  return [`Day ${day}: ${es.length} chore${es.length === 1 ? '' : 's'}: ${[...by.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`,
    ...(fails.size ? [`failed: ${[...fails.entries()].slice(0, 3).map(([nm, f]) => `${nm}${f.n > 1 ? ` x${f.n}` : ''}${f.msg ? ` (${f.msg.slice(0, 50)})` : ''}`).join('; ')}`] : []),
    ...(firsts.length ? [`first: ${firsts.slice(0, 3).join(', ')}`] : [])].join('; ') + '.';
}

/** The village's line for a finished day, from every member's log. */
export function villageDayLine(village: string, day: number): string {
  const es = membersOf(village).flatMap((a) => a.log.filter((e) => e.day === day && !e.cut).map((e) => ({ ...e, who: a.name })));
  if (!es.length) return '';
  const by = new Map<string, number>();
  for (const e of es) by.set(words(e.kind), (by.get(words(e.kind)) ?? 0) + 1);
  const top = [...by.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3);
  const made = es.filter((e) => e.ok && (e.kind === 'initiate' || e.kind === 'help' || e.kind === 'activity' || e.kind === 'innovate') && /build it|^Start building|^Experiment|^Research/i.test(e.name)).slice(-3);
  const failing = new Map<string, number>();
  for (const e of es.filter((x) => !x.ok)) failing.set(e.name, (failing.get(e.name) ?? 0) + 1);
  const bad = [...failing.entries()].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1]).slice(0, 2);
  return [`Day ${day}: ${es.length} chores by ${new Set(es.map((e) => e.who)).size} members, most ${top.map(([k, n]) => `${k} (${n})`).join(', ')}`,
    ...(made.length ? [`done: ${made.map((e) => `${e.name} (${e.who})`).join(', ')}`] : []),
    ...(bad.length ? [`kept failing: ${bad.map(([nm, n]) => `${nm} x${n}`).join(', ')}`] : [])].join('; ') + '.';
}

/** Write the agent's line for every finished day not done yet; true when a line was added. */
export function closeAgentDays(village: string, agent: string, upTo: number): boolean {
  const a = agentMemory(village, agent);
  if (!a || a.nightDone >= upTo) return false;
  let added = false;
  for (let d = Math.max(1, a.nightDone + 1); d <= upTo; d++) {
    const line = agentDayLine(a, d);
    if (line) {
      a.days.push({ day: d, line });
      added = true;
      logAct({ type: 'day', village, agent, day: d, line });
    }
  }
  if (a.days.length > DAYS_MAX) a.days.splice(0, a.days.length - DAYS_MAX);
  a.nightDone = upTo;
  save();
  return added;
}

export function closeVillageDays(village: string, upTo: number): void {
  const v = villageMemory(village);
  if (!v || v.nightDone >= upTo) return;
  for (let d = Math.max(1, v.nightDone + 1); d <= upTo; d++) {
    const line = villageDayLine(village, d);
    if (line) {
      v.days.push({ day: d, line });
      logAct({ type: 'day', village, day: d, line });
    }
  }
  if (v.days.length > DAYS_MAX) v.days.splice(0, v.days.length - DAYS_MAX);
  v.nightDone = upTo;
  save();
}

/** The roster of a village's members (respawn_agents.py). */
export function rosterOf(village: string): Array<{ name: string } & Roster> {
  return membersOf(village).filter((a) => a.roster).map((a) => ({ name: a.name, ...a.roster! }));
}
