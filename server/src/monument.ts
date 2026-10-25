/**
 * The monument (M1, #144; MC_MONUMENT, off): once a village completes the iron age, it builds a Gothic cathedral drawn by
 * gothicGen.ts (no vote: the user's, 10-25), stage by stage, on a pad of its own at the village's edge. World-free: the
 * record's arithmetic, the jobs' cells in the world, today's palette and the menu's share; mcWorld.ts drives it (the
 * trigger, the menu's options, crediting the yard) and mcBuild.ts runs its two skills (monument_site, build_monument).
 *
 * The yard is a ledger over the village storage (`Monument.yard`): what members gathered for the current stage, held
 * for the monument (makeSpare keeps it from other chores, the bulk cap does not count it) and spent as its jobs are
 * built. Gathering stops at the stage's bill; the next stage's gathering opens when its jobs do.
 *
 * Settings: MC_MONUMENT (on/off), MC_MONUMENT_PRESET (notre_dame), MC_MONUMENT_SCALE (0.5: 1:2; 0.25: 1:4),
 * MC_MONUMENT_SHARE (0.6: monument options at most this share of a menu), MC_MONUMENT_PALETTE (today: cobblestone, the
 * village wood's roof and plain panes, what today's skills gather; full: the generator's stone bricks, tuff, deepslate
 * and stained glass, for M2's chains).
 */
import { GOTHIC_PRESETS, generateCathedral, gothicItem, type Cathedral, type GothicJob } from './gothicGen';
import { rawSetting } from './settings';
import type { Monument, Village } from './village';

export const MONUMENT = {
  on: /^(on|1|true|yes)$/i.test(rawSetting('MC_MONUMENT') ?? 'off'),
  preset: rawSetting('MC_MONUMENT_PRESET') || 'notre_dame',
  scale: Math.max(0.05, Math.min(1, Number(rawSetting('MC_MONUMENT_SCALE') ?? 0.5) || 0.5)),
  share: Math.max(0.1, Math.min(1, Number(rawSetting('MC_MONUMENT_SHARE') ?? 0.6) || 0.6)),
  palette: (/^full$/i.test(rawSetting('MC_MONUMENT_PALETTE') ?? 'today') ? 'full' : 'today') as 'today' | 'full',
};

/** Whether the village has reached the iron rung (the ladder's record). */
export const ironReached = (v: Village) => !!v.ladder?.reached?.some((r) => r.rung === 'iron');

/** A new monument record (the trigger's; the site is chosen by the first member who takes it). */
export function newMonument(wood: string, now: number): Monument {
  const preset = GOTHIC_PRESETS[MONUMENT.preset] ? MONUMENT.preset : 'notre_dame';
  return { preset, scale: Math.round(1 / MONUMENT.scale), palette: MONUMENT.palette, wood, at: now, state: 'site', done: [], yard: {}, stages: [] };
}

/** Today's palette (MC_MONUMENT_PALETTE=today): the generator's blocks as today's skills can gather and make them. */
export function todayBlock(block: string, wood: string): string {
  const m = /^([^[]+)(\[.*\])?$/.exec(block)!;
  const name = m[1], st = m[2] ?? '';
  if (/^(stone_bricks|tuff_bricks|polished_andesite)$/.test(name)) return 'cobblestone';
  if (name === 'stone_brick_stairs') return `cobblestone_stairs${st}`;
  if (name === 'stone_brick_slab') return `cobblestone_slab${st}`;
  if (name === 'stone_brick_wall') return 'cobblestone_wall';
  if (name === 'deepslate_tile_stairs') return `${wood}_stairs${st}`;
  if (name === 'deepslate_tile_slab') return `${wood}_slab${st}`;
  if (name === 'deepslate_tiles') return `${wood}_planks`;
  if (/_stained_glass_pane$/.test(name)) return 'glass_pane';
  return block;
}

const plans = new Map<string, Cathedral>();
/** The monument's cathedral (generated once per preset, scale, palette and wood: ~50 ms at 1:2), its palette applied. */
export function monumentPlan(m: Monument): Cathedral {
  const key = `${m.preset}|${m.scale}|${m.palette}|${m.wood}`;
  let c = plans.get(key);
  if (c) return c;
  c = generateCathedral(GOTHIC_PRESETS[m.preset] ?? GOTHIC_PRESETS.notre_dame, m.scale);
  if (m.palette === 'today') {
    const wood = m.wood || 'oak';
    const pal: Record<string, string> = {};
    for (const [ch, b] of Object.entries(c.design.palette)) pal[ch] = todayBlock(b, wood);
    const swap = (cells: Array<[string, number]>) => {
      const out: Record<string, number> = {};
      for (const [b, q] of cells) out[gothicItem(b)] = (out[gothicItem(b)] ?? 0) + q;
      return out;
    };
    // (bills again from the swapped palette: each job's cells by its character)
    const charCount = (j: GothicJob | null) => {
      const n = new Map<string, number>();
      c!.design.layers.forEach((layer, y) => layer.forEach((row, z) => {
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          if (ch === '.') continue;
          if (j && !(c!.cellJob.get(`${x},${y},${z}`) === c!.jobs.indexOf(j))) continue;
          n.set(pal[ch], (n.get(pal[ch]) ?? 0) + 1);
        }
      }));
      return [...n];
    };
    const design = { ...c.design, palette: pal };
    const jobs = c.jobs.map((j) => ({ ...j, bill: swap(charCount(j)) }));
    c = { ...c, design, jobs, bill: swap(charCount(null)) };
  }
  plans.set(key, c);
  return c;
}

/** The stage now being built: the lowest with a job not done (0 when every job is done). */
export function currentStage(m: Monument): number {
  const c = monumentPlan(m);
  const done = new Set(m.done);
  return c.jobs.find((j, i) => !done.has(i))?.stage ?? 0;
}

/** The current stage's jobs not done yet, by index into the plan's jobs. */
export function openJobs(m: Monument): number[] {
  const c = monumentPlan(m), st = currentStage(m), done = new Set(m.done);
  return c.jobs.map((j, i) => (j.stage === st && !done.has(i) ? i : -1)).filter((i) => i >= 0);
}

/** What is still wanted for the current stage, from the open jobs' raw bills (`raw`: a bill to gatherable items) less
 *  what the yard holds. */
export function stageWants(m: Monument, raw: (bill: Record<string, number>) => Record<string, number>): Record<string, number> {
  const c = monumentPlan(m);
  const need: Record<string, number> = {};
  for (const i of openJobs(m)) for (const [n, q] of Object.entries(raw(c.jobs[i].bill))) need[n] = (need[n] ?? 0) + q;
  const out: Record<string, number> = {};
  for (const [n, q] of Object.entries(need)) {
    const left = Math.ceil(q - (m.yard[n] ?? 0));
    if (left > 0) out[n] = left;
  }
  return out;
}

/** Whether the yard covers a job's raw bill. */
export function yardCovers(m: Monument, rawBill: Record<string, number>): boolean {
  return Object.entries(rawBill).every(([n, q]) => (m.yard[n] ?? 0) >= Math.ceil(q));
}

/** A job built: its raw bill taken out of the yard, the job marked done, the stages' times kept. */
export function jobBuilt(m: Monument, index: number, rawBill: Record<string, number>, now: number): void {
  if (m.done.includes(index)) return;
  for (const [n, q] of Object.entries(rawBill)) {
    m.yard[n] = Math.max(0, (m.yard[n] ?? 0) - Math.ceil(q));
    if (!m.yard[n]) delete m.yard[n];
  }
  const st = monumentPlan(m).jobs[index].stage;
  m.done.push(index);
  const s = (m.stages[st - 1] ??= {});
  s.began ??= now;
  if (currentStage(m) !== st) s.ended = now;
  if (!currentStage(m)) {
    m.state = 'built';
    m.built = now;
  }
}

/** A grid cell of the cathedral in the world: the site's corner, its turn (as build_design turns a design) and level. */
export function worldCell(m: Monument, x: number, y: number, z: number): { x: number; y: number; z: number } {
  const c = monumentPlan(m), s = m.site!;
  const rot = ((Math.round(s.rotate / 90) % 4) + 4) % 4;
  let [u, v, w, h] = [x, z, c.design.width, c.design.depth];
  for (let r = 0; r < rot; r++) [u, v, w, h] = [h - 1 - v, u, h, w];
  return { x: s.x1 + u, y: s.y + y, z: s.z1 + v };
}

/** A job's cells as world targets, bottom-up; `turn` turns a block's states (designs.ts turnState). */
export function jobTargets(m: Monument, index: number, turn: (block: string, rot: number) => string): Array<{ x: number; y: number; z: number; block: string }> {
  const c = monumentPlan(m), d = c.design, rot = ((Math.round(m.site!.rotate / 90) % 4) + 4) % 4;
  const out: Array<{ x: number; y: number; z: number; block: string }> = [];
  const j = c.jobs[index];
  for (let y = j.y0; y <= j.y1; y++)
    for (let z = j.z0; z <= j.z1; z++)
      for (let x = j.x0; x <= j.x1; x++) {
        const ch = d.layers[y][z][x];
        if (ch === '.' || c.cellJob.get(`${x},${y},${z}`) !== index) continue;
        out.push({ ...worldCell(m, x, y, z), block: turn(d.palette[ch], rot) });
      }
  return out;
}

/** The footprint's size as placed (turned). */
export function siteSize(m: Monument, rotate: number): { w: number; d: number } {
  const d = monumentPlan(m).design;
  return Math.round(rotate / 90) % 2 ? { w: d.depth, d: d.width } : { w: d.width, d: d.depth };
}

/** The menu's share (pure): at most `share` of the options (one at least) may be the monument's; the lowest-ranked of
 *  the rest go. Returns the options taken off. */
export function capShare<T extends { rank: number }>(out: T[], isMon: (o: T) => boolean, share = MONUMENT.share): T[] {
  const mon = out.filter(isMon);
  const max = Math.max(1, Math.floor(share * out.length));
  if (mon.length <= max) return [];
  const drop = mon.sort((a, b) => a.rank - b.rank).slice(max);
  for (const o of drop) out.splice(out.indexOf(o), 1);
  return drop;
}

/** The record's line for logs and the panel: stage, jobs, the yard. */
export function monumentLine(m: Monument): string {
  const c = monumentPlan(m), st = currentStage(m);
  const yard = Object.entries(m.yard).map(([n, q]) => `${q} ${n}`).join(', ') || 'empty';
  return `${m.preset} 1:${m.scale} ${m.state}${st ? `, stage ${st}` : ''}: ${m.done.length} of ${c.jobs.length} jobs, ${c.jobs.filter((_, i) => m.done.includes(i)).reduce((t, j) => t + j.blocks, 0)} of ${c.design.blocks} blocks; yard ${yard}`;
}
