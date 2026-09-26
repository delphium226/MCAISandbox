/**
 * Shared village state for agents building together: prepared plots, finished structures, a library of building
 * designs, a task board, and short-lived reservations that stop two agents from working the same ground.
 * Everything is saved to <world>/villages.json on every change (changes are rare), so it survives restarts.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface Area {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}
export interface Plot extends Area {
  id: string;
  y: number;
  preparedBy: string;
}
export interface Structure extends Area {
  id: string;
  y: number;
  kind: string;
  builtBy: string;
}
export interface Reservation extends Area {
  id: string;
  by: string;
  purpose: string;
  until: number;
}
/** A building drawn as layers (bottom-up) of rows (north to south) of palette characters (west to east). */
export interface Design {
  name: string;
  description: string;
  palette: Record<string, string>;
  layers: string[][];
  width: number;
  depth: number;
  height: number;
  blocks: number;
  by: string;
}
export interface Task {
  id: string;
  title: string;
  detail: string;
  status: 'open' | 'claimed' | 'done' | 'failed';
  postedBy: string;
  /** Tasks that must be done first. */
  after: string[];
  claimedBy?: string;
  /** How many times a claim was given up; a task given up twice is marked failed. */
  tries: number;
  result?: string;
  updated: number;
}
export interface Village {
  name: string;
  objective: string;
  mayor?: string;
  complete?: boolean;
  plots: Plot[];
  structures: Structure[];
  designs: Record<string, Design>;
  tasks: Task[];
  reservations: Reservation[];
  log: string[];
}

const RESERVATION_MS = 3 * 60 * 1000;

export const overlaps = (a: Area, b: Area, margin = 0) =>
  a.x1 - margin <= b.x2 && a.x2 + margin >= b.x1 && a.z1 - margin <= b.z2 && a.z2 + margin >= b.z1;
export const areaText = (a: Area) => `x ${a.x1}..${a.x2}, z ${a.z1}..${a.z2}`;

export class VillageRegistry {
  villages = new Map<string, Village>();
  private nextId = 1;

  constructor(private file: string) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { nextId: number; villages: Village[] };
      this.nextId = data.nextId ?? 1;
      for (const v of data.villages ?? []) this.villages.set(v.name.toLowerCase(), v);
    } catch {
      /* no villages yet */
    }
  }

  static forWorld(dir: string) {
    return new VillageRegistry(path.join(dir, 'villages.json'));
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify({ nextId: this.nextId, villages: [...this.villages.values()] }, null, 1));
  }

  id(prefix: string) {
    return `${prefix}${this.nextId++}`;
  }

  get(name: unknown): Village | undefined {
    return typeof name === 'string' ? this.villages.get(name.toLowerCase()) : undefined;
  }

  ensure(name: string, objective = ''): Village {
    let v = this.get(name);
    if (!v) {
      v = { name, objective, plots: [], structures: [], designs: {}, tasks: [], reservations: [], log: [] };
      this.villages.set(name.toLowerCase(), v);
    } else if (objective) v.objective = objective;
    this.save();
    return v;
  }

  note(v: Village, text: string) {
    v.log.push(text);
    if (v.log.length > 40) v.log.splice(0, v.log.length - 40);
    this.save();
  }

  /** Why `area` cannot be used by `by` (an existing structure, or ground someone else reserved), or null if it can. */
  conflict(v: Village, area: Area, by: string, avoidStructures = true): string | null {
    const now = Date.now();
    v.reservations = v.reservations.filter((r) => r.until > now);
    if (avoidStructures)
      for (const s of v.structures) if (overlaps(area, s)) return `it overlaps ${s.builtBy}'s ${s.kind} (${areaText(s)})`;
    for (const r of v.reservations)
      if (r.by !== by && overlaps(area, r)) return `${r.by} has reserved ${areaText(r)} to ${r.purpose}`;
    return null;
  }

  reserve(v: Village, area: Area, by: string, purpose: string): Reservation {
    const r: Reservation = { ...area, id: this.id('r'), by, purpose, until: Date.now() + RESERVATION_MS };
    v.reservations.push(r);
    this.save();
    return r;
  }

  /** Keep a reservation alive while work continues (without writing the file every tick). */
  renew(r: Reservation) {
    r.until = Date.now() + RESERVATION_MS;
  }

  release(v: Village, id: string) {
    v.reservations = v.reservations.filter((r) => r.id !== id);
    this.save();
  }

  // --- Task board -----------------------------------------------------------------------------

  task(v: Village, id: unknown): Task | undefined {
    return v.tasks.find((t) => t.id === id);
  }

  /** Open tasks whose prerequisites are done. */
  claimable(v: Village): Task[] {
    return v.tasks.filter((t) => t.status === 'open' && t.after.every((id) => this.task(v, id)?.status === 'done'));
  }

  /** Post tasks; `after` may name existing task ids or earlier tasks in the same batch by 0-based index. */
  post(v: Village, tasks: Array<{ title: string; detail?: string; after?: Array<string | number> }>, by: string): Task[] {
    const made: Task[] = [];
    for (const t of tasks.slice(0, 8)) {
      const after = (t.after ?? []).map((a) => (typeof a === 'number' ? made[a]?.id : String(a))).filter((id): id is string => !!id && !!(this.task(v, id) ?? made.find((m) => m.id === id)));
      const task: Task = { id: this.id('t'), title: String(t.title).slice(0, 120), detail: String(t.detail ?? '').slice(0, 400), status: 'open', postedBy: by, after, tries: 0, updated: Date.now() };
      v.tasks.push(task);
      made.push(task);
    }
    this.note(v, `${by} posted ${made.map((t) => `${t.id} "${t.title}"`).join(', ')}`);
    return made;
  }

  claim(v: Village, id: string, by: string): Task | null {
    const t = this.task(v, id);
    if (!t || !(this.claimable(v).includes(t) || (t.status === 'claimed' && t.claimedBy === by))) return null;
    t.status = 'claimed';
    t.claimedBy = by;
    t.updated = Date.now();
    this.save();
    return t;
  }

  finish(v: Village, id: string, by: string, result: string) {
    const t = this.task(v, id);
    if (!t || t.claimedBy !== by) return;
    t.status = 'done';
    t.result = result.slice(0, 300);
    t.updated = Date.now();
    this.note(v, `${by} finished ${t.id} "${t.title}"`);
  }

  /** Give a claimed task back; the second time it is marked failed so the mayor can rethink it. */
  giveUp(v: Village, id: string, by: string, why: string) {
    const t = this.task(v, id);
    if (!t || t.claimedBy !== by || t.status !== 'claimed') return;
    t.tries++;
    t.status = t.tries >= 2 ? 'failed' : 'open';
    t.claimedBy = t.status === 'failed' ? by : undefined;
    t.result = why.slice(0, 300);
    t.updated = Date.now();
    this.note(v, `${by} gave up ${t.id} "${t.title}"${t.status === 'failed' ? ' (failed)' : ''}: ${why.slice(0, 100)}`);
  }

  /** Close every task that is not finished (the objective is met, or the mayor is starting over). */
  cancelOpen(v: Village, why: string) {
    for (const t of v.tasks)
      if (t.status === 'open' || t.status === 'claimed') {
        t.status = 'failed';
        t.result = `cancelled: ${why}`;
        t.updated = Date.now();
      }
    this.save();
  }

  /** A compact description for prompts. */
  summary(v: Village, forAgent?: string): string {
    const lines = [`Village ${v.name}${v.objective ? `, objective: ${v.objective}` : ''}${v.complete ? ' (declared complete)' : ''}`];
    if (v.plots.length) lines.push('Prepared plots (level ground; build inside them):', ...v.plots.map((p) => `- ${p.id}: ${areaText(p)}, ground y=${p.y}, by ${p.preparedBy}`));
    if (v.structures.length) lines.push('Buildings (do not overlap them):', ...v.structures.map((s) => `- ${s.kind} at ${areaText(s)} by ${s.builtBy}`));
    const designs = Object.values(v.designs);
    if (designs.length) lines.push('Design library (build with build_design):', ...designs.map((d) => `- "${d.name}": ${d.width}x${d.depth}, ${d.height} high, ${d.description}`));
    if (v.tasks.length) {
      const shown = [...v.tasks.filter((t) => t.status !== 'done'), ...v.tasks.filter((t) => t.status === 'done').slice(-6)];
      lines.push('Task board:', ...shown.map((t) => {
        const who = t.claimedBy ? ` by ${t.claimedBy}` : '';
        const after = t.after.length && t.status === 'open' ? ` (after ${t.after.join(', ')})` : '';
        const result = t.result && t.status !== 'open' ? ` -> ${t.result.slice(0, 120)}` : '';
        return `- ${t.id} [${t.status}${who}] ${t.title}${after}${t.status === 'done' ? '' : `: ${t.detail}`}${result}`;
      }));
    }
    if (v.log.length) lines.push('Recent village events:', ...v.log.slice(-6).map((l) => `- ${l}`));
    const now = Date.now();
    const res = v.reservations.filter((r) => r.until > now && r.by !== forAgent);
    if (res.length) lines.push('Ground others are working on:', ...res.map((r) => `- ${r.by}: ${areaText(r)} (${r.purpose})`));
    return lines.join('\n');
  }
}
