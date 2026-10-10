/**
 * The decision log (Phase A step A.1, 2026-10-10; no behaviour change): every chore code queues is a `[choice]` record and
 * its end a `[choice-end]` record (outcome, minutes, yield), printed to the log and appended to a JSONL file (`MCAI_CHOICE_LOG`, by default
 * `runs/choices-<date>.jsonl` in the repository). A write that fails is reported once and never thrown.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

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
  reason: string;
  options: string[];
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
   * the village that overlapped it) and the agent's own inventory as Mineflayer sees it (null with the agent gone).
   */
  yield: { storage: Record<string, number>; carried: Record<string, number> | null; with: string[] };
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
    console.log(`[choice] ${JSON.stringify(rec)}`);
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
