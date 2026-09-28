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
/** A village storage chest and what it held when last opened. */
export interface StorageChest {
  x: number;
  y: number;
  z: number;
  items: Record<string, number>;
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
  /** A prerequisite whose failure does not block what waits for it (gathering: the build checks its materials itself). */
  soft?: boolean;
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
  /** Shared storage (real Minecraft's village economy): chests and their contents as last seen. */
  storage?: { chests: StorageChest[]; updated: number };
  /** The wood kind the village gathers and builds in (the commonest near its first site; real Minecraft). */
  wood?: string;
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

  /**
   * Gather tasks ("collect block=X count=N, then deposit") the storage already covers are marked done: when the storage
   * holds as much of X as every gather task for the buildings not yet built asks for, done ones included (what they
   * brought is in the storage too). prepare_site keeps the logs of the trees it fells: 287 jungle logs sat in the
   * storage while four workers went on gathering jungle logs.
   */
  private coveredByStock(v: Village) {
    const chests = v.storage?.chests ?? [];
    if (!chests.length) return;
    const stock = (item: string) => chests.reduce((s, c) => s + Object.entries(c.items)
      .filter(([n]) => (item === 'logs' ? /_log$/.test(n) : n === item)).reduce((t, [, q]) => t + q, 0), 0);
    const gather = (t: Task) => {
      const m = /^collect block=(\S+) count=(\d+), then deposit/.exec(t.detail);
      const label = / for (.+?)( \(\d+\/\d+\))?$/.exec(t.title)?.[1];
      return m && label ? { item: m[1], n: Number(m[2]), label } : null;
    };
    const unbuilt = new Set(v.tasks.filter((t) => /^Build /.test(t.title) && t.status !== 'done').map((t) => t.title.slice(6)));
    let changed = false;
    for (const t of v.tasks) {
      const g = t.status === 'open' ? gather(t) : null;
      if (!g || !unbuilt.has(g.label)) continue;
      const wanted = v.tasks.map(gather).filter((x) => x && x.item === g.item && unbuilt.has(x.label)).reduce((s, x) => s + x!.n, 0);
      const have = stock(g.item);
      if (have < wanted) continue;
      t.status = 'done';
      t.result = `the storage already holds enough ${g.item} (${have}, for ${wanted} wanted by the buildings still to build)`;
      t.updated = Date.now();
      this.note(v, `${t.id} "${t.title}" was not needed: ${t.result}`);
      changed = true;
    }
    if (changed) this.save();
  }

  /** Open tasks whose prerequisites are done (and whose designs have been drawn). */
  claimable(v: Village): Task[] {
    this.coveredByStock(v);
    const finished = (id: string) => {
      const p = this.task(v, id);
      return p?.status === 'done' || (p?.status === 'failed' && !!p.soft);
    };
    return v.tasks.filter((t) => t.status === 'open' && t.after.every(finished) && !this.missingDesigns(v, t).length);
  }

  /**
   * Designs a building task names that are not in the library yet ('using the "cottage" design', 'build_design
   * meeting_hall'). Such a task waits until the design is drawn: claimed early, a worker finds no design and flounders.
   */
  missingDesigns(v: Village, t: Task): string[] {
    const text = `${t.title} ${t.detail}`;
    if (/^\s*design\b/i.test(t.title) || !/build/i.test(text) || !/design/i.test(text)) return [];
    const names = new Set<string>();
    for (const m of text.matchAll(/"([^"]{2,32})"/g)) names.add(m[1].trim().toLowerCase());
    // build_design cottage (a bare name), not build_design design=... (an argument name)
    for (const m of text.matchAll(/build_design\s+([a-z0-9_]+)\b(?!\s*=)/gi)) names.add(m[1].toLowerCase());
    const lib = Object.keys(v.designs);
    return [...names].filter((n) => /^[a-z0-9_ -]+$/.test(n) && !lib.includes(n) && !lib.includes(n.replace(/ /g, '_')) && !lib.includes(n.replace(/_/g, ' ')));
  }

  /** Post tasks; `after` may name existing task ids or earlier tasks in the same batch by 0-based index. */
  /** Post tasks (at most `max` at once: a guard against models flooding the board; code posting a layout lifts it). */
  post(v: Village, tasks: Array<{ title: string; detail?: string; after?: Array<string | number>; soft?: boolean }>, by: string, max = 8): Task[] {
    const made: Task[] = [];
    for (const t of tasks.slice(0, max)) {
      const after = (t.after ?? []).map((a) => (typeof a === 'number' ? made[a]?.id : String(a))).filter((id): id is string => !!id && !!(this.task(v, id) ?? made.find((m) => m.id === id)));
      const task: Task = { id: this.id('t'), title: String(t.title).slice(0, 120), detail: String(t.detail ?? '').slice(0, 400), status: 'open', postedBy: by, after, tries: 0, updated: Date.now(), ...(t.soft ? { soft: true } : {}) };
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

  /** Mark a claimed task failed at once (its work cannot be done here). */
  fail(v: Village, id: string, by: string, why: string) {
    const t = this.task(v, id);
    if (!t || t.claimedBy !== by || t.status !== 'claimed') return;
    t.status = 'failed';
    t.result = why.slice(0, 300);
    t.updated = Date.now();
    this.note(v, `${by} could not do ${t.id} "${t.title}": ${why.slice(0, 100)}`);
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
    if (v.wood) lines.push(`Wood: the village gathers and builds in ${v.wood} (designs in other woods are built in it)`);
    if (v.plots.length) lines.push('Prepared plots (level ground; build inside them):', ...v.plots.map((p) => `- ${p.id}: ${areaText(p)}, ground y=${p.y}, by ${p.preparedBy}`));
    if (v.structures.length) lines.push('Buildings (do not overlap them):', ...v.structures.map((s) => `- ${s.kind} at ${areaText(s)} by ${s.builtBy}`));
    const designs = Object.values(v.designs);
    if (designs.length) lines.push('Design library (build with build_design):', ...designs.map((d) => `- "${d.name}": ${d.width}x${d.depth}, ${d.height} high, ${d.description}`));
    if (v.tasks.length) {
      const shown = [...v.tasks.filter((t) => t.status !== 'done'), ...v.tasks.filter((t) => t.status === 'done').slice(-6)];
      lines.push('Task board:', ...shown.map((t) => {
        const who = t.claimedBy ? ` by ${t.claimedBy}` : '';
        const missing = t.status === 'open' ? this.missingDesigns(v, t) : [];
        const after = (t.after.length && t.status === 'open' ? ` (after ${t.after.join(', ')})` : '') + (missing.length ? ` (waiting for the design ${missing.map((n) => `"${n}"`).join(', ')} to be drawn)` : '');
        const result = t.result && t.status !== 'open' ? ` -> ${t.result.slice(0, 120)}` : '';
        return `- ${t.id} [${t.status}${who}] ${t.title}${after}${t.status === 'done' ? '' : `: ${t.detail}`}${result}`;
      }));
    }
    if (v.storage?.chests.length) {
      const sum: Record<string, number> = {};
      for (const c of v.storage.chests) for (const [n, q] of Object.entries(c.items)) sum[n] = (sum[n] ?? 0) + q;
      const items = Object.entries(sum).filter(([, q]) => q > 0).sort((x, y) => y[1] - x[1]);
      const where = v.storage.chests.map((c) => `${c.x},${c.y},${c.z}`).join('; ');
      lines.push(`Village storage (deposit / withdraw; chest${v.storage.chests.length > 1 ? 's' : ''} at ${where}): ${items.length ? items.slice(0, 24).map(([n, q]) => `${q} ${n}`).join(', ') : 'empty'}`);
    }
    if (v.log.length) lines.push('Recent village events:', ...v.log.slice(-6).map((l) => `- ${l}`));
    const now = Date.now();
    const res = v.reservations.filter((r) => r.until > now && r.by !== forAgent);
    if (res.length) lines.push('Ground others are working on:', ...res.map((r) => `- ${r.by}: ${areaText(r)} (${r.purpose})`));
    return lines.join('\n');
  }
}

/** A building to lay out: its design name and footprint. */
export interface Footprint {
  name: string;
  width: number;
  depth: number;
}

export interface Layout {
  /** The plot to prepare (buildings, streets and a margin), and its centre and size for prepare_site. */
  plot: Area;
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Each building's footprint and its centre (x, z as build_design takes them), in build order. */
  places: Array<Footprint & Area & { x: number; z: number }>;
}

/**
 * Pack buildings into rows on one plot centred at (cx, cz), with `street` blocks between buildings and rows and a
 * margin round the edge; the column count that gives the squarest plot wins. Code does this, not the mayor: models
 * placed buildings overlapping or sticking out of the plot.
 */
export function layoutBuildings(cx: number, cz: number, items: Footprint[], street = 3, margin = 2): Layout {
  const sorted = [...items].sort((a, b) => b.width * b.depth - a.width * a.depth);
  let best: { rows: Footprint[][]; rowWidth: number[]; rowDepth: number[]; W: number; D: number; score: number } | null = null;
  for (let cols = 1; cols <= Math.max(1, sorted.length); cols++) {
    const rows: Footprint[][] = [];
    for (let i = 0; i < sorted.length; i += cols) rows.push(sorted.slice(i, i + cols));
    const rowWidth = rows.map((r) => r.reduce((s, f) => s + f.width, 0) + street * (r.length - 1));
    const rowDepth = rows.map((r) => Math.max(...r.map((f) => f.depth)));
    const W = Math.max(...rowWidth) + 2 * margin;
    const D = rowDepth.reduce((s, d) => s + d, 0) + street * (rows.length - 1) + 2 * margin;
    const score = Math.max(W, D) * 1000 + W * D;
    if (!best || score < best.score) best = { rows, rowWidth, rowDepth, W, D, score };
  }
  const { rows, rowWidth, rowDepth, W, D } = best!;
  const x0 = cx - Math.floor(W / 2), z0 = cz - Math.floor(D / 2);
  const inner = W - 2 * margin;
  const places: Layout['places'] = [];
  let z = z0 + margin;
  rows.forEach((row, i) => {
    // Rows are centred across the plot; each building is centred in its row's depth
    let x = x0 + margin + Math.floor((inner - rowWidth[i]) / 2);
    for (const f of row) {
      const z1 = z + Math.floor((rowDepth[i] - f.depth) / 2);
      const area = { x1: x, z1, x2: x + f.width - 1, z2: z1 + f.depth - 1 };
      places.push({ ...f, ...area, x: x + Math.floor(f.width / 2), z: z1 + Math.floor(f.depth / 2) });
      x += f.width + street;
    }
    z += rowDepth[i] + street;
  });
  return { plot: { x1: x0, z1: z0, x2: x0 + W - 1, z2: z0 + D - 1 }, x: cx, z: cz, width: W, depth: D, places };
}
