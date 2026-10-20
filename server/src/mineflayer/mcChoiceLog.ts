/**
 * The decision log (Phase A step A.1, 2026-10-10; no behaviour change): every chore code queues is a `[choice]` record and
 * its end a `[choice-end]` record (outcome, minutes, yield), printed to the log and appended to a JSONL file (`MCAI_CHOICE_LOG`, by default
 * `runs/choices-<date>.jsonl` in the repository). A write that fails is reported once and never thrown. A.2 (2026-10-12) adds the
 * menu each choice was made on, how it was decided (the model, a fixed pick, a fallback and why), and `choice-drop` and
 * `choice-ban` records.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChoiceContext, ChoiceSource, FallbackWhy } from '../world';

const ROOT = process.env.MCAI_ROOT ? path.resolve(process.env.MCAI_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** One option of the menu a choice was made on (A.2). */
export interface ChoiceLogOption {
  id: string;
  kind: string;
  key: string;
  name: string;
  facts: string;
  effect: string;
  rank: number;
  lp?: number;
  /** A.3p: the temperament's weight. */
  tw?: number;
  /** N.1: a village need's weight on it. */
  nw?: number;
  /** 1-based position shown to the model. */
  shown?: number;
}

/** A chore chosen: who, where, what, and the options it was chosen from. */
export interface ChoiceRecord {
  id: string;
  agent: string;
  village: string;
  /** When it was queued (ms since the epoch). */
  t: number;
  key: string;
  what: string;
  kind: string;
  /** The model's reason, or 'fixed order'. */
  reason: string;
  /** The menu the choice was made on ([] only before A.2). */
  options: ChoiceLogOption[];
  chosen?: string;
  source?: ChoiceSource;
  why?: FallbackWhy;
  /** The model's choice only: its 1-based position as shown, and how many were shown. */
  position?: number;
  shownCount?: number;
  /** A fallback after a call: the option ids the model was shown (`options` is the fresh menu the fixed pick came from). */
  shownIds?: string[];
  /** A model's pick no longer feasible when the reply came ('taken'): the id it chose and its reason. */
  modelChose?: string;
  modelReason?: string;
  /** A re-ask (s40): the first decision's id, whose pick was taken meanwhile (its record is a 'reask' drop). */
  reaskOf?: string;
  /** `${decisionId}|${agent}`: the shuffle's seed. */
  seed?: string;
  model?: string;
  latencyMs?: number;
  waitMs?: number;
  queueWaitMs?: number;
  promptTokens?: number;
  outputTokens?: number;
  guarded?: Array<{ id: string; why: string }>;
  /** The prompt's context, logged in fixed mode too (choicebench rebuilds prompts). */
  ctx?: ChoiceContext;
}

/** A chore ended: its outcome, length and yield. */
export interface ChoiceEnd {
  id: string;
  ok: boolean;
  message: string;
  minutes: number;
  /** When the end was seen (ms since the epoch): an end after the run's own end belongs to no run's ledger. */
  tEnd: number;
  /** Cut short rather than failed: its agent removed or stopped (every action then fails as "cancelled", lesson 67). */
  cut: boolean;
  /**
   * What changed while it ran: the village storage's counts (other chores' deposits included: `with` names the chores of
   * the village that overlapped it) and the agent's own inventory as Mineflayer sees it (null with the agent gone); for
   * an explore, how much more of its ring point's land the atlas knows (A.2).
   */
  yield: { storage: Record<string, number>; carried: Record<string, number> | null; with: string[]; known?: number };
  /** A failure's contention code (another agent's work in the way): counted by neither a ban nor a cooldown (A.2). */
  code?: string;
  /** Whether the chore gave what it is for, judged from its own result (A.2's learning progress). */
  productive?: boolean;
}

/** A decision dropped before it ran (A.2): its agent gone, replaced, busy, or nothing left to run. */
export interface ChoiceDrop {
  type: 'choice-drop';
  decisionId: string;
  agent: string;
  village: string;
  t: number;
  why: 'gone' | 'replaced' | 'no body' | 'busy' | 'task' | 'not complete' | 'empty' | 'error' | 'reask';
  queueWaitMs?: number;
  /** A decision dropped after its call (the tokens were billed): the call's numbers, and the model's pick and reason when
   *  its reply chose one. */
  model?: string;
  latencyMs?: number;
  waitMs?: number;
  promptTokens?: number;
  outputTokens?: number;
  modelChose?: string;
  modelReason?: string;
}

/** An option id (or a whole kind) taken off a village's menus after repeated failures (A.2's guard). */
export interface ChoiceBan {
  type: 'choice-ban';
  village: string;
  t: number;
  /** The option id, or the kind's name for a ban of the whole kind. */
  id: string;
  scope: 'id' | 'kind';
  until: number;
  message: string;
}

/** Counts by item name of a list of stacks. */
export function itemCounts(items: { name: string; count: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) out[it.name] = (out[it.name] ?? 0) + it.count;
  return out;
}

/** The changes from one set of counts to another, gains positive and losses negative; unchanged items left out. */
export function countsDelta(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const d = (after[n] ?? 0) - (before[n] ?? 0);
    if (d) out[n] = d;
  }
  return out;
}

let file: string | undefined;
let warned = false;
let seq = 0;

function logFile(): string {
  if (file) return file;
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  file = path.resolve(ROOT, process.env.MCAI_CHOICE_LOG || path.join('runs', `choices-${date}.jsonl`));
  return file;
}

function append(rec: Record<string, unknown>) {
  try {
    const f = logFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify(rec) + '\n');
  } catch (e) {
    if (!warned) console.error(`[choice] cannot write the decision log: ${(e as Error).message}`);
    warned = true;
  }
}

/** A new choice id, unique in this process and readable in the log ("Minevale36#3"). */
export function choiceId(village: string): string {
  return `${village}#${++seq}`;
}

export function logChoice(rec: ChoiceRecord) {
  try {
    // (the console line lists the options by id and leaves the context out: a full one is ~3 KB, A.2)
    const { ctx: _ctx, ...short } = rec;
    void _ctx;
    console.log(`[choice] ${JSON.stringify({ ...short, options: rec.options.map((o) => o.id) })}`);
    append({ type: 'choice', ...rec });
  } catch {
    // (logging must never stop a chore)
  }
}

export function logChoiceEnd(rec: ChoiceEnd) {
  try {
    const r = { ...rec, message: rec.message.slice(0, 200) };
    console.log(`[choice-end] ${JSON.stringify(r)}`);
    append({ type: 'choice-end', ...r });
  } catch {
    // (as above)
  }
}

export function logChoiceDrop(rec: Omit<ChoiceDrop, 'type'>) {
  try {
    const r: ChoiceDrop = { type: 'choice-drop', ...rec };
    console.log(`[choice-drop] ${JSON.stringify(r)}`);
    append({ ...r });
  } catch {
    // (as above)
  }
}

export function logChoiceBan(rec: Omit<ChoiceBan, 'type'>) {
  try {
    const r: ChoiceBan = { type: 'choice-ban', ...rec, message: rec.message.slice(0, 200) };
    const d = new Date(rec.until);
    console.log(`[choice-ban] ${rec.village} ${rec.id}${rec.scope === 'kind' ? ' (the whole kind)' : ''} until ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} (${r.message})`);
    append({ ...r });
  } catch {
    // (as above)
  }
}
