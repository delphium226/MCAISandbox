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
 *
 * M2 (#145): the full palette as the village can make it (fullBlock): stone bricks and plain stone (for the andesite)
 * from cobblestone smelted in the kiln (kiln.ts, MC_KILN), tuff bricks as stone bricks, the deepslate roof in the village
 * wood until there is a source of cobbled deepslate, and stained panes (MC_GLAZING) in the colours the flowers near the
 * village give (Monument.colours), plain panes without. With the kiln the yard holds made goods too (stone, bricks,
 * glass), and the stage's wants and a job's cover are a materials plan of its bill against the yard (stageWantsPlanned,
 * jobReady).
 */
import { GOTHIC_PRESETS, generateCathedral, gothicItem, type Cathedral, type GothicJob } from './gothicGen';
import { rawSetting } from './settings';
import { placeOutward } from './outward';
import { villageHome, type Area, type Monument, type Village } from './village';
import { KILN, kilnHolds } from './kiln';

export { KILN };
export const MONUMENT = {
  on: /^(on|1|true|yes)$/i.test(rawSetting('MC_MONUMENT') ?? 'off'),
  preset: rawSetting('MC_MONUMENT_PRESET') || 'notre_dame',
  scale: Math.max(0.05, Math.min(1, Number(rawSetting('MC_MONUMENT_SCALE') ?? 0.5) || 0.5)),
  share: Math.max(0.1, Math.min(1, Number(rawSetting('MC_MONUMENT_SHARE') ?? 0.6) || 0.6)),
  palette: (/^full$/i.test(rawSetting('MC_MONUMENT_PALETTE') ?? 'today') ? 'full' : 'today') as 'today' | 'full',
  /** M2 (#145, MC_GLAZING): stained panes from the flowers' dyes, and sand smelted into glass in the kiln. */
  glazing: /^(on|1|true|yes)$/i.test(rawSetting('MC_GLAZING') ?? 'off'),
};

/** The dye each flower makes (the jar's recipes), and the generator's three glass colours with what may stand in. */
export const FLOWER_DYE: Record<string, string> = {
  cornflower: 'blue', blue_orchid: 'light_blue', poppy: 'red', red_tulip: 'red', rose_bush: 'red', dandelion: 'yellow', sunflower: 'yellow',
  wildflowers: 'yellow', orange_tulip: 'orange', pink_tulip: 'pink', peony: 'pink', pink_petals: 'pink', allium: 'magenta', lilac: 'magenta',
  azure_bluet: 'light_gray', oxeye_daisy: 'light_gray', white_tulip: 'light_gray', lily_of_the_valley: 'white',
};
const STAND_INS: Record<string, string[]> = { blue: ['blue', 'light_blue', 'magenta'], red: ['red', 'orange', 'pink', 'magenta'], yellow: ['yellow', 'orange', 'white'] };

/** The flower picked for each dye colour (MC_GLAZING): the one counted most near the village. */
export function dyeFlowers(counts: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [f, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) if (FLOWER_DYE[f] && n > 0) out[FLOWER_DYE[f]] ??= f;
  return out;
}

/** The glass colours (MC_GLAZING) from the flowers counted near the village: each colour, or the nearest the flowers give
 *  (at least `min` of them), else none (plain panes). */
export function glassColours(counts: Record<string, number>, min = 6): Record<string, string> {
  const have: Record<string, number> = {};
  for (const [f, n] of Object.entries(counts)) if (FLOWER_DYE[f]) have[FLOWER_DYE[f]] = (have[FLOWER_DYE[f]] ?? 0) + n;
  const out: Record<string, string> = {};
  for (const [c, list] of Object.entries(STAND_INS)) {
    const pick = list.find((d) => (have[d] ?? 0) >= min);
    if (pick) out[c] = pick;
  }
  return out;
}

/** The full palette as the village can make it (M2): see the header. */
export function fullBlock(block: string, wood: string, colours: Record<string, string> = {}): string {
  const m = /^([^[]+)(\[.*\])?$/.exec(block)!;
  const name = m[1], st = m[2] ?? '';
  if (name === 'polished_andesite') return 'stone';
  if (name === 'tuff_bricks') return 'stone_bricks';
  if (name === 'deepslate_tile_stairs') return `${wood}_stairs${st}`;
  if (name === 'deepslate_tile_slab') return `${wood}_slab${st}`;
  if (name === 'deepslate_tiles') return `${wood}_planks`;
  const glass = /^(\w+?)_stained_glass_pane$/.exec(name);
  if (glass) return MONUMENT.glazing && colours[glass[1]] ? `${colours[glass[1]]}_stained_glass_pane${st}` : `glass_pane${st}`;
  return block;
}

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
  const key = `${m.preset}|${m.scale}|${m.palette}|${m.wood}|${JSON.stringify(m.colours ?? {})}`;
  let c = plans.get(key);
  if (c) return c;
  c = generateCathedral(GOTHIC_PRESETS[m.preset] ?? GOTHIC_PRESETS.notre_dame, m.scale);
  {
    const wood = m.wood || 'oak';
    const pal: Record<string, string> = {};
    for (const [ch, b] of Object.entries(c.design.palette)) pal[ch] = m.palette === 'today' ? todayBlock(b, wood) : fullBlock(b, wood, m.colours);
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

/** M2 (#145, MC_KILN): the plan of a bill against what is had (mcMaterials' Materials.plan, its parts the code reads). */
export type PlanOf = (bill: Record<string, number>, have: Record<string, number>) => {
  gather: Record<string, number>; fromStock: Record<string, number>; steps: Array<{ do: 'craft' | 'smelt'; item: string; runs: number; input?: string }>; fuel: { smelts: number };
};
/** The open jobs' bills together (the current stage's still to build). */
export function stageBill(m: Monument, ahead = 0): Record<string, number> {
  const c = monumentPlan(m), bill: Record<string, number> = {}, st = currentStage(m);
  // (`ahead`: the next stages' jobs too, MC_KILN: the quarry and the kiln work ahead while a stage waits on its smelting;
  // M2's live check left 17 members idle with the stage's cobblestone in and its bricks still cooking)
  const jobs = ahead ? c.jobs.map((j, i) => (st && j.stage >= st && j.stage <= st + ahead && !m.done.includes(i) ? i : -1)).filter((i) => i >= 0) : openJobs(m);
  for (const i of jobs) for (const [n, q] of Object.entries(c.jobs[i].bill)) bill[n] = (bill[n] ?? 0) + q;
  return bill;
}
/** The stages ahead the yard's wants and the kiln work for (MC_KILN). */
export const AHEAD = 1;
/** A plan's raw item as the yard names it (logs as the monument's wood, "any:" dropped). */
export const rawName = (m: Monument, n: string) => (n === 'any:logs' ? `${m.wood}_log` : n.replace(/^any:/, ''));
/** The yard and what the kiln's furnaces hold (as their outputs). */
function hadWithKiln(m: Monument): Record<string, number> {
  const have: Record<string, number> = { ...m.yard };
  for (const [n, q] of Object.entries(kilnHolds(m.kiln))) have[n] = (have[n] ?? 0) + q;
  return have;
}

/** What the current stage still wants gathered (MC_KILN): its open jobs' plan against the yard and the kiln's load. */
export function stageWantsPlanned(m: Monument, plan: PlanOf): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [n, q] of Object.entries(plan(stageBill(m, AHEAD), hadWithKiln(m)).gather)) {
    if (q <= 0) continue;
    // (a dye's flower as the one that grows near the village: the plan may pick another of its colour, a rose bush for
    // poppies; once one is in the yard the plan takes it)
    const raw = FLOWER_DYE[n] && m.flowers?.[FLOWER_DYE[n]] ? m.flowers[FLOWER_DYE[n]] : rawName(m, n);
    out[raw] = (out[raw] ?? 0) + Math.ceil(q);
  }
  return out;
}

/** What the current stage wants smelted by the kiln, by input, that the yard holds now (its plan against the yard and the
 *  kiln's load: the smelts still to do, at most what the yard has of each input). */
export function kilnWants(m: Monument, plan: PlanOf): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of plan(stageBill(m, AHEAD), hadWithKiln(m)).steps) {
    if (s.do !== 'smelt' || !s.input) continue;
    const input = rawName(m, s.input);
    if (input !== 'cobblestone' && input !== 'sand') continue;
    const n = Math.min(s.runs, Math.floor(m.yard[input] ?? 0) - (out[input] ?? 0));
    if (n > 0) out[input] = (out[input] ?? 0) + n;
  }
  return out;
}

/** Whether a job can be built from the yard (MC_KILN): nothing to gather and nothing to smelt (the kiln's work), its
 *  crafts (bricks, stairs, walls, panes from what is made) done at the build. */
export function jobReady(m: Monument, index: number, plan: PlanOf): boolean {
  const p = plan(monumentPlan(m).jobs[index].bill, m.yard);
  return !Object.values(p.gather).some((q) => q > 0) && !p.fuel.smelts;
}

/** A job built (MC_KILN): what its plan took from the yard taken out of it, the job marked done. */
export function jobBuiltPlanned(m: Monument, index: number, plan: PlanOf, now: number): void {
  if (m.done.includes(index)) return;
  const took = plan(monumentPlan(m).jobs[index].bill, m.yard).fromStock;
  jobBuilt(m, index, Object.fromEntries(Object.entries(took).map(([n, q]) => [rawName(m, n), q])), now);
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

/** The site search's hub (the meeting point's pad, else the storage hut, else the village's home) and home level. */
export function siteHub(v: Village, fallbackY: number): { hub: { x: number; z: number } | null; home: number } {
  const lay0 = v.layouts?.[0];
  const hubPad = lay0?.pads?.find((q) => /meeting/.test(q.what)) ?? lay0?.pads?.[0];
  const hut = v.storageHut;
  const hub = hubPad ? { x: Math.round((hubPad.x1 + hubPad.x2) / 2), z: Math.round((hubPad.z1 + hubPad.z2) / 2) }
    : hut ? { x: Math.round((hut.x1 + hut.x2) / 2), z: Math.round((hut.z1 + hut.z2) / 2) } : villageHome(v);
  return { hub: hub ? { x: hub.x, z: hub.z } : null, home: lay0?.y ?? v.plots[0]?.y ?? fallbackY };
}

/**
 * The cathedral's site (pure; monument_site's search, and the offline check's on a checkpoint's ground): outward.ts'
 * placement of the footprint, its door (the west portal) toward the hub, off everything `takenAt` names, on a grid of
 * every f-th column (a coarse cell is taken if any of its columns is, its ground the highest of them, none if any is
 * water or unread). Each grid of `grids` in turn until one places it: a coarse grid is ~5x faster on the one event loop
 * (lesson 16) but stricter at its edges, so a tight spot falls back to the finer.
 */
export function searchSite(m: Monument, input: {
  hub: { x: number; z: number }; home: number; range: number;
  ground: (x: number, z: number) => number | null; takenAt: (x: number, z: number) => boolean; grids: number[];
}): { site: NonNullable<Monument['site']>; cost: number; f: number } | { why: string } {
  const plan = monumentPlan(m).design;
  const M0 = Math.min(input.range, 72 + Math.ceil(Math.max(plan.width, plan.depth) / 2));
  const zc = Math.floor((plan.depth - 1) / 2);
  let why = '';
  // (24 further out when nothing fits nearer: Chartres at 1:4, 33x21, found no ground within 89 of iron_age_g1's G1 and
  // its site was never chosen; within 113 it was)
  for (const M of [...new Set([M0, Math.min(input.range, M0 + 24)])])
  for (const f of input.grids) {
    const ax1 = input.hub.x - M, az1 = input.hub.z - M, N = Math.floor((2 * M + 1) / f);
    const g = new Map<string, number | null>(), t = new Set<string>();
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        let top: number | null = -Infinity;
        let taken = false;
        for (let dx = 0; dx < f; dx++)
          for (let dz = 0; dz < f; dz++) {
            const x = ax1 + i * f + dx, z = az1 + j * f + dz;
            if (input.takenAt(x, z)) taken = true;
            const h: number | null = top === null ? null : input.ground(x, z);
            top = top === null || h === null ? null : Math.max(top, h);
          }
        g.set(`${i},${j}`, top);
        if (taken) t.add(`${i},${j}`);
      }
    const placed = placeOutward({
      area: { x1: 0, z1: 0, x2: N - 1, z2: N - 1 },
      ground: (i, j) => g.get(`${i},${j}`) ?? null,
      taken: (i, j) => t.has(`${i},${j}`),
      hub: { x: Math.floor((input.hub.x - ax1) / f), z: Math.floor((input.hub.z - az1) / f) },
      home: input.home, pads: [],
      items: [{ name: 'cathedral', width: Math.ceil(plan.width / f), depth: Math.ceil(plan.depth / f), door: [0, Math.floor(zc / f)], out: [-1, 0] }],
    })[0];
    if (!placed || 'why' in placed) {
      why = `no free ground for the cathedral (${plan.width}x${plan.depth}) within ${M} of the village (grids ${input.grids.join(', ')})`;
      continue;
    }
    const x1 = ax1 + placed.x1 * f, z1 = az1 + placed.z1 * f;
    const { w, d } = siteSize(m, placed.rotate);
    return { site: { x1, z1, x2: x1 + w - 1, z2: z1 + d - 1, y: placed.y, rotate: placed.rotate }, cost: placed.cost, f };
  }
  return { why };
}

/** The ground the cathedral keeps off (lesson 30): the village's buildings, plots and layouts (3 round), its fields and
 *  mine (2), other members' claims, and other villages' ground (5). */
export function siteTaken(v: Village, others: Village[], mineBoxes: Area[], now: number, by: string): (x: number, z: number) => boolean {
  const ins = (q: Area, x: number, z: number, n = 0) => x >= q.x1 - n && x <= q.x2 + n && z >= q.z1 - n && z <= q.z2 + n;
  const claims = v.reservations.filter((r) => r.until > now && r.by !== by);
  const fields = (v.layouts ?? []).flatMap((l) => [...(l.farm ? [l.farm] : []), ...(l.slots ?? [])]);
  return (x, z) => v.structures.some((q) => ins(q, x, z, 3)) || v.plots.some((q) => ins(q, x, z, 3))
    || (v.layouts ?? []).some((q) => ins(q, x, z, 3)) || fields.some((q) => ins(q, x, z, 2)) || mineBoxes.some((b) => ins(b, x, z, 2))
    || claims.some((q) => ins(q, x, z))
    || others.some((o) => o.plots.some((q) => ins(q, x, z, 5)) || (o.layouts ?? []).some((q) => ins(q, x, z, 5)) || o.structures.some((q) => ins(q, x, z, 5)));
}
