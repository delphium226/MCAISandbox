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
 *
 * #153 (MC_MONUMENT_TYPE=castle; cathedral by default): the monument is a castle drawn by castleGen.ts instead (Conwy
 * first), on the same record, pad, yard, quarry, kiln and jobs; its stages are the castle's (the plan's stageNames), its
 * iron-bar portcullis is made of the village wood's fence until the kiln smelts iron, and the architect (M3) is the
 * cathedral's only, so code sets the castle's preset and scale.
 *
 * #162 (MC_MONUMENT_DETAIL, tier 2's chain A): a cathedral begun with it keeps `detail` on its record and is drawn with
 * gothicGen's detail palette (no furnishing stage yet: its lanterns, bell, candles and banners come with their chains);
 * fullBlock keeps the polished stones and chiselled bricks, and a job waits until the carver has cut its pieces
 * (cutter.ts: the build cuts nothing).
 */
import { COPPER, GOTHIC_PRESETS, generateCathedral, gothicCost, gothicItem, type Cathedral, type GothicJob } from './gothicGen';
import { CASTLE_PRESETS, generateCastle } from './castleGen';
import { rawSetting } from './settings';
import { placeOutward } from './outward';
import { villageHome, type Area, type Monument, type Village } from './village';
import { KILN, kilnHolds } from './kiln';
import { CUTTER, needsCutting, type CutStep, type CutterRecord } from './cutter';
import type { DyeBed } from './dyeBed';
import { FURNISH_STAGE, furnishKindOf, furnishKinds, furnishOn, furnishTrade, type FurnishKind } from './furnish';

export { KILN };
export const MONUMENT = {
  on: /^(on|1|true|yes)$/i.test(rawSetting('MC_MONUMENT') ?? 'on'),
  preset: rawSetting('MC_MONUMENT_PRESET') || 'notre_dame',
  // (1:3 by default since 10-27, the user's: monuments stay at 1:3 from now on)
  scale: Math.max(0.05, Math.min(1, Number(rawSetting('MC_MONUMENT_SCALE') ?? 1 / 3) || 1 / 3)),
  share: Math.max(0.1, Math.min(1, Number(rawSetting('MC_MONUMENT_SHARE') ?? 0.6) || 0.6)),
  palette: (/^full$/i.test(rawSetting('MC_MONUMENT_PALETTE') ?? 'full') ? 'full' : 'today') as 'today' | 'full',
  /** M2 (#145, MC_GLAZING): stained panes from the flowers' dyes, and sand smelted into glass in the kiln. */
  glazing: /^(on|1|true|yes)$/i.test(rawSetting('MC_GLAZING') ?? 'on'),
  /** #153: the monument's type: the cathedral or the castle (castleGen.ts). */
  type: (/^castle$/i.test(rawSetting('MC_MONUMENT_TYPE') ?? 'cathedral') ? 'castle' : 'cathedral') as MonumentType,
};
export type MonumentType = 'cathedral' | 'castle';
/** #153: a monument's type (records from before it are cathedrals). */
export const monumentType = (m: Monument): MonumentType => (m as MonumentM3).type ?? 'cathedral';
/** The monument's noun in lines ("the castle's site"). */
export const monumentNoun = (m: Monument) => monumentType(m);
/** The presets of a type. */
export const presetsOf = (t: MonumentType): Record<string, unknown> => (t === 'castle' ? CASTLE_PRESETS : GOTHIC_PRESETS);

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

/** The full palette as the village can make it (M2): see the header. `detail` (#162): the detail palette's stones kept,
 *  a window's colour kept when the glazing's colours hold it, else plain. */
export function fullBlock(block: string, wood: string, colours: Record<string, string> = {}, detail = false, deep = false): string {
  const m = /^([^[]+)(\[.*\])?$/.exec(block)!;
  const name = m[1], st = m[2] ?? '';
  if (detail) {
    const pane = /^(\w+?)_stained_glass_pane$/.exec(name);
    if (pane) return MONUMENT.glazing && Object.values(colours).includes(pane[1]) ? block : `glass_pane${st}`;
  }
  if (name === 'polished_andesite' && !detail) return 'stone';
  // (#162 tier 3, MC_DEEP_STONE: the deep level's tuff and deepslate kept; standIns put the wood and bricks back when short)
  if (deep && (name === 'tuff_bricks' || DEEP_BLOCKS.includes(name))) return block;
  if (name === 'tuff_bricks') return 'stone_bricks';
  if (name === 'deepslate_tile_stairs') return `${wood}_stairs${st}`;
  if (name === 'deepslate_tile_slab') return `${wood}_slab${st}`;
  if (name === 'deepslate_tiles') return `${wood}_planks`;
  if (name === 'iron_bars') return `${wood}_fence`;
  const glass = /^(\w+?)_stained_glass_pane$/.exec(name);
  if (glass) return MONUMENT.glazing && colours[glass[1]] ? `${colours[glass[1]]}_stained_glass_pane${st}` : `glass_pane${st}`;
  return block;
}

/** MC_DEEP_STONE (#162 tier 3, chain A): kept on a monument begun with it and the detail palette (`deep`). */
export const DEEP_STONE_ON = /^(on|1|true|yes)$/i.test(rawSetting('MC_DEEP_STONE') ?? 'on');
/** The roof's deepslate blocks (cut from cobbled deepslate) and the plinth's (from tuff). */
export const DEEP_BLOCKS = ['deepslate_tiles', 'deepslate_tile_stairs', 'deepslate_tile_slab'];
/** What a deep stone stands in as when the village is short (today's: the village wood, stone bricks). */
export function deepStandIn(block: string, wood: string): string {
  return block === 'tuff_bricks' ? 'stone_bricks' : block === 'deepslate_tiles' ? `${wood}_planks` : block === 'deepslate_tile_stairs' ? `${wood}_stairs` : `${wood}_slab`;
}

/** MC_COPPER_ROOF (#162 tier 3, chain B; off): a detail cathedral's high roof in cut copper once the village has reached
 *  the copper rung (`test`: the rung counted reached, for staged runs). Before it the roof is deepslate (chain A) or wood;
 *  a roof already built so is re-roofed in copper (copperOn's `reroof` jobs). */
export const COPPER_ROOF = (() => {
  const v = (rawSetting('MC_COPPER_ROOF') ?? 'off').toLowerCase();
  return { on: /^(on|1|true|yes|test)$/.test(v), test: v === 'test' };
})();
/** MC_GEODE (#162 tier 3, chain C; off): a detail cathedral begun with it has the geode's accents (gothicGen's `accents`:
 *  calcite round the west portals and across the west front, amethyst at the roses' hubs and on the altar), from a geode
 *  the gem cutter works from a sealed tunnel (mcGemCutter.ts); short after a wait, tier 2's blocks stand in. */
export const GEODE_ON = /^(on|1|true|yes)$/i.test(rawSetting('MC_GEODE') ?? 'off');
/** The accents' blocks and what each stands in as (tier 2's, with chains of their own). */
export const GEM_STAND: Record<string, string> = { calcite: 'polished_diorite', amethyst_block: 'chiseled_stone_bricks' };

/** The dyes' stand-in (MC_DYE_BED; test train 7 stalled at stage 7 on purple and red): a window colour whose dye chores
 *  failed DYE_FAILS times, or that was wanted DYE_WAIT_MIN minutes, stands in as plain glass, from the first job the
 *  yard's panes, stained glass and dye no longer cover (a dye makes 8 stained glass, 6 of those 16 panes). */
export const DYE_FAILS = 4, DYE_WAIT_MIN = 30;
export function dyeStandIn(m: Monument, dye: string): number {
  const c = dye.replace(/_dye$/, ''), pane = `${c}_stained_glass_pane`, block = `${c}_stained_glass`, y = m.yard;
  const glass = (y[block] ?? 0) + 8 * (y[dye] ?? 0);
  const from = Math.min(standInFrom(m, pane, (y[pane] ?? 0) + Math.floor(glass * 16 / 6)), standInFrom(m, block, glass));
  const r = m3(m);
  Object.assign(r.standIns ??= {}, { [pane]: 'glass_pane', [block]: 'glass' });
  Object.assign(r.standInFrom ??= {}, { [pane]: from, [block]: from });
  return from;
}
/** A furnishing kind left out (its chores failed FURNISH_FAILS times: no iron for ingots or shears): not drawn, and
 *  recorded for the re-furnish. */
export function furnishLeaveOut(m: Monument, kind: FurnishKind, now = Date.now()): void {
  const r = m3(m);
  if (!r.furnish?.[kind]) return;
  // (a re-furnish job of the kind not yet built goes with it; D4's banners came back and failed again on their sticks)
  if (r.refurnish?.includes(kind)) {
    const c = monumentPlan(m), i = c.jobs.findIndex((j) => j.refurnish === kind);
    if (i < 0 || !m.done.includes(i)) r.refurnish = r.refurnish.filter((k) => k !== kind);
  }
  r.furnish[kind] = false;
  if (!(r.leftOut ??= []).includes(kind)) r.leftOut.push(kind);
  (r.leftAt ??= {})[kind] = now;
}
/** Minutes a kind left out waits before it may come back (no bouncing in and out while its chores still fail). */
export const REFURNISH_WAIT_MIN = 20;
/** What a left-out kind's pieces are, by item (the furnishing as drawn with it). */
export function leftOutItems(m: Monument, kind: FurnishKind, now = Date.now()): Record<string, number> {
  const r = m3(m);
  if (!r.furnish || now - (r.leftAt?.[kind] ?? 0) < REFURNISH_WAIT_MIN * 60000) return {};
  const c = monumentPlan({ ...m, furnish: { ...r.furnish, [kind]: true }, refurnish: [] } as Monument), fs = c.stageNames.indexOf(FURNISH_STAGE) + 1;
  const out: Record<string, number> = {};
  for (const j of c.jobs) if (j.stage === fs && j.reroof === undefined && j.refurnish === undefined)
    for (const [k, q] of Object.entries(j.bill)) if (furnishKindOf(k) === kind) out[k] = (out[k] ?? 0) + q;
  return out;
}
/** The user's 10-28: a kind left out comes back once its makings are in: drawn again, and when the furnishing's job
 *  already stands its cells of that kind come as a job of their own (the re-furnish; a finished cathedral's furnishing
 *  goes on). Returns that job's cells (0 when the kind just comes back into the furnishing's own job). */
export function refurnishOn(m: Monument, kind: FurnishKind): number {
  const r = m3(m);
  if (!r.furnish || r.furnish[kind] || !r.leftOut?.includes(kind)) return 0;
  const fs = furnishStage(m), before = monumentPlan(m);
  const stood = before.jobs.some((j, i) => j.stage === fs && j.reroof === undefined && j.refurnish === undefined && m.done.includes(i));
  r.furnish[kind] = true;
  r.leftOut = r.leftOut.filter((k) => k !== kind);
  if (!stood) return 0;
  if (!(r.refurnish ??= []).includes(kind)) r.refurnish.push(kind);
  return monumentPlan(m).jobs.find((j) => j.refurnish === kind)?.cells?.length ?? 0;
}

/** Whether a dye's colour stands in already. */
export const dyeStood = (m: Monument, dye: string) => !!m3(m).standIns?.[`${dye.replace(/_dye$/, '')}_stained_glass_pane`];

/** The copper roof's blocks. */
export const COPPER_BLOCKS = [COPPER.tile, COPPER.tileStair, COPPER.tileSlab];
/** A copper roof's block as the generator draws it without copper (deepslate, its states kept). */
export const copperOff = (block: string) => block.replace(/^cut_copper(_stairs|_slab)?\b/, (_, k: string | undefined) => (k === '_stairs' ? 'deepslate_tile_stairs' : k === '_slab' ? 'deepslate_tile_slab' : 'deepslate_tiles'));
/** Whether the village has reached the copper rung (MC_COPPER_ROOF=test: always). */
export const copperReached = (v: Village) => COPPER_ROOF.test || !!v.ladder?.reached?.some((r) => r.rung === 'copper');
/** The rung reached (#162 tier 3, chain B): the monument drawn with its copper roof from now on; the jobs already built with
 *  copper cells (in deepslate or wood) listed for the re-roof, whose jobs come after the plan's (a stage 5 or 8 job each,
 *  the cells only), and a finished monument building again until they stand. Returns the re-roof's cells. */
export function copperOn(m: Monument): number {
  const r = m3(m);
  if (r.copper || !r.detail || monumentType(m) !== 'cathedral') return 0;
  r.copper = true;
  r.reroof = [];
  const c = monumentPlan(m);
  r.reroof = c.jobs.map((_, i) => (m.done.includes(i) && c.copperCells.get(i)?.length ? i : -1)).filter((i) => i >= 0);
  const n = r.reroof.reduce((t, i) => t + (c.copperCells.get(i)?.length ?? 0), 0);
  if (r.reroof.length && m.state === 'built') m.state = 'building';
  return n;
}

/** A copper roof block's stand-in when the village is short of copper: the roof's old block (deepslate or its stand-in). */
export function copperStandIn(m: Monument, block: string): string {
  const r = m3(m);
  return gothicItem(standIn(fullBlock(copperOff(block), m.wood || 'oak', m.colours, !!r.detail, !!r.detail && !!r.deep), r.standIns ?? {}));
}
/** The first job (by index, the jobs not built) whose copper `held` no longer covers (cut copper first, then 4 pieces a
 *  copper block, 9 ingots or raw copper a block; a slab half a piece): the old roof stands in from there. */
export function copperFrom(m: Monument, held: Record<string, number>): number {
  const c = monumentPlan(m);
  const left: Record<string, number> = Object.fromEntries(COPPER_BLOCKS.map((b) => [b, held[b] ?? 0]));
  let units = 4 * ((held.copper_block ?? 0) + Math.floor(((held.copper_ingot ?? 0) + (held.raw_copper ?? 0)) / 9));
  for (let i = 0; i < c.jobs.length; i++) {
    if (m.done.includes(i)) continue;
    for (const b of COPPER_BLOCKS) {
      const need = c.jobs[i].bill[b] ?? 0, own = Math.min(need, left[b]);
      left[b] -= own;
      units -= (need - own) * (b === COPPER.tileSlab ? 0.5 : 1);
    }
    if (units < 0) return i;
  }
  return c.jobs.length;
}

/** A re-roof job's old blocks, by item (what its cells held before: the re-roofed job's palette); {} for any other job. */
export function reroofReturns(m: Monument, index: number): Record<string, number> {
  const c = monumentPlan(m), j = c.jobs[index], out: Record<string, number> = {};
  if (j?.reroof === undefined || !j.cells) return out;
  const pal = c.jobs[j.reroof].palette ?? c.design.palette;
  for (const k of j.cells) {
    const [x, y, z] = k.split(',').map(Number);
    const [item, n] = gothicCost(pal[c.design.layers[y][z][x]]);
    out[item] = (out[item] ?? 0) + n;
  }
  return out;
}

/** A block with its stand-in, if it has one (its states kept). */
export function standIn(block: string, standIns: Record<string, string>): string {
  const m = /^([^[]+)(\[.*\])?$/.exec(block)!;
  return standIns[m[1]] ? `${standIns[m[1]]}${m[2] ?? ''}` : block;
}

/** #162: the stand-in for a quarried stone the stage has waited on too long: the polished form of the stone storage holds
 *  most of beyond the yard's (at least what is still wanted), else plain stone (M2's stand-in). */
export function stoneStandIn(item: string, want: number, free: Record<string, number>): string {
  const best = ['granite', 'diorite', 'andesite'].filter((s) => s !== item && (free[s] ?? 0) >= want).sort((a, b) => (free[b] ?? 0) - (free[a] ?? 0))[0];
  return best ? `polished_${best}` : 'stone';
}

/** Whether the village has reached the iron rung (the ladder's record). */
export const ironReached = (v: Village) => !!v.ladder?.reached?.some((r) => r.rung === 'iron');

/** A new monument record (the trigger's; the site is chosen by the first member who takes it). */
export function newMonument(wood: string, now: number, type: MonumentType = MONUMENT.type): Monument {
  // (#153: MC_MONUMENT_PRESET names a preset of the type, else its first: Notre-Dame, Conwy)
  const preset = presetsOf(type)[MONUMENT.preset] ? MONUMENT.preset : type === 'castle' ? 'conwy' : 'notre_dame';
  const m: MonumentM3 = { preset, scale: Math.round(1 / MONUMENT.scale), palette: MONUMENT.palette, wood, at: now, state: 'site', done: [], yard: {}, stages: [] };
  if (type === 'castle') m.type = type;
  // (#162: kept on the record, so a cathedral begun with the detail palette is drawn with it whatever the flag says later)
  else if (CUTTER.on && MONUMENT.palette === 'full') {
    m.detail = true;
    if (furnishOn()) m.furnish = furnishKinds();
    if (DEEP_STONE_ON) m.deep = true;
    if (GEODE_ON) m.accents = true;
  }
  return m;
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
  // (#153: the castle's portcullis in the village wood: iron bars want raw iron smelted, which the kiln does not do)
  if (name === 'iron_bars') return `${wood}_fence`;
  if (/_stained_glass_pane$/.test(name)) return 'glass_pane';
  return block;
}

/** A monument's plan: the generator's cathedral or castle with its stages' names. A re-roof job (chain B) names the job
 *  it re-roofs and its cells ("x,y,z" in the grid); `copperCells`: each job's copper cells. */
export type MonumentPlan = Omit<Cathedral, 'jobs'> & {
  stageNames: readonly string[];
  jobs: Array<GothicJob & { palette?: Record<string, string>; reroof?: number; refurnish?: FurnishKind; cells?: string[] }>;
  copperCells: Map<number, string[]>;
};
const plans = new Map<string, MonumentPlan>();
/** The monument's cathedral or castle (generated once per type, preset, scale, palette and wood: ~50 ms at 1:2), its
 *  palette applied. */
export function monumentPlan(m: Monument): MonumentPlan {
  const type = monumentType(m);
  const detail = !!(m as MonumentM3).detail, deep = detail && !!(m as MonumentM3).deep;
  const standIns = (m as MonumentM3).standIns ?? {}, from = (m as MonumentM3).standInFrom ?? {}, fk = detail ? (m as MonumentM3).furnish : undefined;
  // (#162 tier 3, chain B: the copper roof once the rung is reached; the jobs built before it keep their roof's old blocks)
  const copper = detail && type === 'cathedral' && !!m3(m).copper, reroof = copper ? m3(m).reroof ?? [] : [];
  const accents = detail && type === 'cathedral' && !!m3(m).accents;
  const refurnish = fk ? m3(m).refurnish ?? [] : [];
  const key = `${type}|${m.preset}|${m.scale}|${m.palette}|${m.wood}|${JSON.stringify(m.colours ?? {})}|${detail}|${JSON.stringify(standIns)}|${JSON.stringify(from)}|${JSON.stringify(fk ?? null)}|${deep}|${copper}|${reroof.join(',')}|${accents}|${refurnish.join(',')}`;
  let c = plans.get(key);
  if (c) return c;
  const gen: Cathedral = type === 'castle' ? generateCastle(CASTLE_PRESETS[m.preset] ?? CASTLE_PRESETS.conwy, m.scale)
    : generateCathedral(GOTHIC_PRESETS[m.preset] ?? GOTHIC_PRESETS.notre_dame, m.scale, { detail, furnish: !!fk, ...(fk ? { furnishKinds: fk } : {}), ...(copper ? { copperRoof: true } : {}), ...(accents ? { accents: true } : {}) });
  {
    const wood = m.wood || 'oak';
    const pal: Record<string, string> = {}, pal0: Record<string, string> = {};
    // (the copper characters as the roof stood before the rung: deepslate or its stand-in)
    const old: Record<string, string> = {}, old0: Record<string, string> = {};
    for (const [ch, b] of Object.entries(gen.design.palette)) {
      pal0[ch] = m.palette === 'today' ? todayBlock(b, wood) : fullBlock(b, wood, m.colours, detail, deep);
      pal[ch] = standIn(pal0[ch], standIns);
      if (COPPER_BLOCKS.includes(gothicItem(b))) {
        old0[ch] = fullBlock(copperOff(b), wood, m.colours, detail, deep);
        old[ch] = standIn(old0[ch], standIns);
      }
    }
    const copperCells = new Map<number, string[]>();
    if (copper) gen.design.layers.forEach((layer, y) => layer.forEach((row, z) => {
      for (let x = 0; x < row.length; x++) {
        if (!old[row[x]]) continue;
        const i = gen.cellJob.get(`${x},${y},${z}`) ?? 0;
        (copperCells.get(i) ?? copperCells.set(i, []).get(i)!).push(`${x},${y},${z}`);
      }
    }));
    const fromOf = (b: string, i: number) => (from[b.replace(/\[.*$/, '')] ?? 0) > i;
    // (#165: a stand-in from its job on; the jobs before it keep the block, as far as the yard's own stone went)
    const palOf = (i: number) => {
      const re = reroof.includes(i);
      if (!Object.keys(from).length && !re) return pal;
      const out: Record<string, string> = {};
      for (const ch of Object.keys(pal)) out[ch] = re && old[ch] ? (fromOf(old0[ch], i) ? old0[ch] : old[ch]) : fromOf(pal0[ch], i) ? pal0[ch] : pal[ch];
      return out;
    };
    c = { ...gen, stageNames: gen.stageNames, copperCells };
    const swap = (cells: Array<[string, number]>) => {
      const out: Record<string, number> = {};
      for (const [b, q] of cells) {
        const [item, n] = gothicCost(b);
        out[item] = (out[item] ?? 0) + q * n;
      }
      return out;
    };
    // (bills again from the swapped palette: each job's cells by its character)
    const charCount = (j: GothicJob | null) => {
      const n = new Map<string, number>();
      const pals = c!.jobs.map((_, i) => palOf(i));
      c!.design.layers.forEach((layer, y) => layer.forEach((row, z) => {
        for (let x = 0; x < row.length; x++) {
          const ch = row[x];
          if (ch === '.') continue;
          if (j && !(c!.cellJob.get(`${x},${y},${z}`) === c!.jobs.indexOf(j))) continue;
          const b = pals[c!.cellJob.get(`${x},${y},${z}`) ?? 0]?.[ch] ?? pal[ch];
          n.set(b, (n.get(b) ?? 0) + 1);
        }
      }));
      return [...n];
    };
    const design = { ...c.design, palette: pal };
    const jobs: MonumentPlan['jobs'] = c.jobs.map((j, i) => ({ ...j, bill: swap(charCount(j)), ...(Object.keys(from).length || reroof.includes(i) ? { palette: palOf(i) } : {}) }));
    // (the re-roof: each listed job's copper cells again, in copper, as a job of its stage after the plan's own)
    for (const r of reroof) {
      const cells = copperCells.get(r) ?? [];
      if (!cells.length) continue;
      const pts = cells.map((k) => k.split(',').map(Number));
      const n = new Map<string, number>();
      for (const [x, y, z] of pts) n.set(pal[gen.design.layers[y][z][x]], (n.get(pal[gen.design.layers[y][z][x]]) ?? 0) + 1);
      jobs.push({
        stage: c.jobs[r].stage, index: jobs.length, blocks: cells.length, bill: swap([...n]), reroof: r, cells,
        x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
        y1: Math.max(...pts.map((p) => p[1])), z0: Math.min(...pts.map((p) => p[2])), z1: Math.max(...pts.map((p) => p[2])),
      });
    }
    // (the re-furnish: a kind brought back after the furnishing's job stood, its cells in the built furnishing jobs as a
    // job of the furnishing stage after the plan's own)
    const fsNo = c.stageNames.indexOf(FURNISH_STAGE) + 1;
    for (const kind of refurnish) {
      const cells: string[] = [];
      gen.design.layers.forEach((layer, y) => layer.forEach((row, z) => {
        for (let x = 0; x < row.length; x++) {
          const ch = row[x], i = gen.cellJob.get(`${x},${y},${z}`) ?? -1;
          if (ch === '.' || gen.jobs[i]?.stage !== fsNo || !m.done.includes(i)) continue;
          if (furnishKindOf(gothicItem(pal[ch])) === kind) cells.push(`${x},${y},${z}`);
        }
      }));
      if (!cells.length) continue;
      const pts = cells.map((k) => k.split(',').map(Number));
      const n = new Map<string, number>();
      for (const [x, y, z] of pts) n.set(pal[gen.design.layers[y][z][x]], (n.get(pal[gen.design.layers[y][z][x]]) ?? 0) + 1);
      jobs.push({
        stage: fsNo, index: jobs.length, blocks: cells.length, bill: swap([...n]), refurnish: kind, cells,
        x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])),
        y1: Math.max(...pts.map((p) => p[1])), z0: Math.min(...pts.map((p) => p[2])), z1: Math.max(...pts.map((p) => p[2])),
      });
    }
    c = { ...c, design, jobs, bill: swap(charCount(null)) };
  }
  plans.set(key, c);
  return c;
}

/** The names of the monument's stages (index 0 = stage 1). */
export const stageNames = (m: Monument): readonly string[] => monumentPlan(m).stageNames;

/** #165: the first job (by index, the jobs not built in order) whose `block` the yard's `have` no longer covers: a
 *  stand-in for it applies from there on (monumentPlan's standInFrom). */
export function standInFrom(m: Monument, block: string, have: number): number {
  const c = monumentPlan(m);
  let left = have;
  for (let i = 0; i < c.jobs.length; i++) {
    if (m.done.includes(i)) continue;
    left -= c.jobs[i].bill[block] ?? 0;
    if (left < 0) return i;
  }
  return c.jobs.length;
}

/** #162 C-E: the furnishing stage's number (0: none drawn). */
export function furnishStage(m: Monument): number {
  return (m as MonumentM3).furnish ? monumentPlan(m).stageNames.indexOf(FURNISH_STAGE) + 1 : 0;
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
  // (#162 C-E: never the furnishing stage ahead: its pieces are made by their own chores, after the cathedral stands)
  const fs = furnishStage(m);
  const jobs = ahead ? c.jobs.map((j, i) => (st && j.stage >= st && j.stage <= st + ahead && (j.stage === st || j.stage !== fs) && !m.done.includes(i) ? i : -1)).filter((i) => i >= 0) : openJobs(m);
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
    // (#162 tier 3, chain B: raw copper for the copper roof's ingots)
    if (input !== 'cobblestone' && input !== 'sand' && input !== 'raw_copper') continue;
    const n = Math.min(s.runs, Math.floor(m.yard[input] ?? 0) - (out[input] ?? 0));
    if (n > 0) out[input] = (out[input] ?? 0) + n;
  }
  return out;
}

/** Whether a job can be built from the yard (MC_KILN): nothing to gather and nothing to smelt (the kiln's work), its
 *  crafts (bricks, stairs, walls, panes from what is made) done at the build. */
export function jobReady(m: Monument, index: number, plan: PlanOf): boolean {
  const p = plan(monumentPlan(m).jobs[index].bill, m.yard);
  // (#162: with the detail palette the carver cuts its pieces first)
  return !Object.values(p.gather).some((q) => q > 0) && !p.fuel.smelts && !((m as MonumentM3).detail && needsCutting(p.steps as CutStep[]));
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
  // (#162 C-E: built once only the furnishing is left; its jobs come after and never hold the cathedral)
  const cur = currentStage(m);
  if (m.state !== 'built' && (!cur || cur === furnishStage(m))) {
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
  // (a re-roof job: its cells only, over the roof's old blocks)
  if (j.cells) {
    for (const k of j.cells) {
      const [x, y, z] = k.split(',').map(Number);
      out.push({ ...worldCell(m, x, y, z), block: turn(d.palette[d.layers[y][z][x]], rot) });
    }
    return out.sort((p, q) => p.y - q.y);
  }
  for (let y = j.y0; y <= j.y1; y++)
    for (let z = j.z0; z <= j.z1; z++)
      for (let x = j.x0; x <= j.x1; x++) {
        const ch = d.layers[y][z][x];
        if (ch === '.' || c.cellJob.get(`${x},${y},${z}`) !== index) continue;
        out.push({ ...worldCell(m, x, y, z), block: turn((j.palette ?? d.palette)[ch], rot) });
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
  return `${m.preset} 1:${m.scale} ${m.state}${st ? `, stage ${st}` : ''}: ${m.done.length} of ${c.jobs.length} jobs, ${c.jobs.filter((j, i) => m.done.includes(i) && j.reroof === undefined && j.refurnish === undefined).reduce((t, j) => t + j.blocks, 0)} of ${c.design.blocks} blocks; yard ${yard}`;
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

// ---------------------------------------------------------------------------------------------
// M3 (#146): the trades, the progress in news and memory, the architect's parameters
// ---------------------------------------------------------------------------------------------

/** M3's flags (each off): the trades (MC_MONUMENT_ROLES), the progress line and news (MC_MONUMENT_NEWS), the architect's
 *  pick at the trigger (MC_MONUMENT_ARCHITECT) and the scales it may pick from (MC_MONUMENT_SCALES; empty: the one set). */
const flagOn = (name: string, def = 'off') => /^(on|1|true|yes)$/i.test(rawSetting(name) ?? def);
export const M3 = {
  roles: flagOn('MC_MONUMENT_ROLES', 'on'),
  news: flagOn('MC_MONUMENT_NEWS', 'on'),
  architect: flagOn('MC_MONUMENT_ARCHITECT'),
  /** As N for 1:N, largest N (smallest cathedral) first. */
  scales: (() => {
    const list = (rawSetting('MC_MONUMENT_SCALES') ?? '').split(',').map((s) => Number(s.trim())).filter((s) => s >= 0.05 && s <= 1);
    return [...new Set((list.length ? list : [MONUMENT.scale]).map((s) => Math.round(1 / s)))].sort((a, b) => b - a);
  })(),
};
/** Test hook. */
export function setM3(s: Partial<typeof M3>): void {
  Object.assign(M3, s);
}

export const TRADES = ['quarryman', 'mason', 'glazier', 'carpenter', 'carver', 'dyer', 'smith', 'weaver'] as const;
export type Trade = (typeof TRADES)[number];
/** What each trade does for the cathedral, in the prompt's words. */
export const TRADE_WORK: Record<Trade, string> = {
  quarryman: 'its stone dug and its site levelled', mason: 'its kiln and its stonework', glazier: 'its sand, dye flowers and glass', carpenter: 'its logs, roof and fuel',
  carver: 'its stone cut at the stonecutter: capitals, arches, tracery and polished stone',
  dyer: 'its dyes: flowers, lapis and bone meal, the dye bed, the mixes',
  smith: 'its furnishing in iron and wax: lanterns, chains, candles and the bell',
  weaver: 'its banners: wool sheared, dyed and woven',
};
/** M3: the weight an option of the member's own trade carries (and its tag says so). */
export const TRADE_WEIGHT = 1.5;

/** A member's trade record (code's, kept on the monument record in villages.json, so it carries across restarts). */
export interface TradeRecord {
  trade?: Trade;
  /** When it took the trade, and in which stage. */
  since?: number;
  sinceStage?: number;
  /** Credited monument chores by trade, the last 8 (oldest first), and by stage (the role measure). */
  n: Partial<Record<Trade, number>>;
  recent: Trade[];
  stages: Record<string, Partial<Record<Trade, number>>>;
  /** Parts built and items brought, for its memory line. */
  built?: number;
  brought?: Record<string, number>;
}
/** M3's places on the monument record (village.ts' Monument is M1-M2's; these ride along in the same JSON). */
export type MonumentM3 = Monument & {
  /** #153: a castle (absent: a cathedral). */
  type?: MonumentType;
  /** #162: drawn with the detail palette, its stone cut at the stonecutter. */
  detail?: boolean;
  /** #162 tier 3 (MC_DEEP_STONE): its deepslate roof and tuff plinth kept, from the iron mine's deep level. */
  deep?: boolean;
  /** #162 tier 3, chain B (MC_COPPER_ROOF): its high roof drawn in copper, since the village reached the copper rung; the
   *  jobs built before then, re-roofed in copper by the plan's re-roof jobs. */
  copper?: boolean;
  reroof?: number[];
  /** The furnishing kinds left out for want of their makings (FURNISH_FAILS chores failed), and those brought back after
   *  the furnishing's job stood (each a job of its cells after the plan's, as the re-roof; the user's 10-28). */
  leftOut?: FurnishKind[];
  refurnish?: FurnishKind[];
  /** When each kind was last left out (it may come back REFURNISH_WAIT_MIN after). */
  leftAt?: Partial<Record<FurnishKind, number>>;
  /** #162 tier 3, chain C (MC_GEODE): drawn with the geode's accents (calcite, amethyst). */
  accents?: boolean;
  /** #162: its stonecutter (mcCutter.ts) and dye bed (mcDyeBed.ts). */
  cutter?: CutterRecord;
  dyeBed?: DyeBed;
  /** #162: blocks standing in for others the village could not get (polished_andesite -> polished_granite), by name. */
  standIns?: Record<string, string>;
  /** #165: the job a stand-in applies from (by index; jobs before it keep the block the yard's own stone covers). */
  standInFrom?: Record<string, number>;
  /** #162 C-E: the furnishing kinds drawn (kept on the record as `detail` is), absent: no furnishing stage. */
  furnish?: { lanterns: boolean; banners: boolean; candles: boolean; bell: boolean };
  trades?: Record<string, TradeRecord>;
  /** MC_MONUMENT_NEWS: the latest news (shown for a village day). */
  news?: { t: number; text: string };
  /** MC_MONUMENT_ARCHITECT: the dedication, and who chose and why (or why code chose). */
  name?: string;
  arch?: { by: string; reason: string; fallback?: string };
};
export const m3 = (m: Monument) => m as MonumentM3;

const WOODS = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_/;
/** The trade a gathered item feeds. */
export function tradeOfItem(item: string): Trade {
  if (/_log$/.test(item) || WOODS.test(item)) return 'carpenter';
  if (/^(red_)?sand$/.test(item) || FLOWER_DYE[item]) return 'glazier';
  if (/_dye$/.test(item)) return 'dyer';
  return 'quarryman';
}
/** The trade a job belongs to: its bill's most blocks of glass, wood or stone. */
export function tradeOfJob(m: Monument, index: number): Trade {
  const bill = monumentPlan(m).jobs[index]?.bill ?? {};
  const by: Record<string, number> = { mason: 0, carpenter: 0, glazier: 0 };
  for (const [n, q] of Object.entries(bill)) by[/glass/.test(n) ? 'glazier' : WOODS.test(n) ? 'carpenter' : 'mason'] += q;
  return Object.entries(by).sort((a, b) => b[1] - a[1])[0][0] as Trade;
}
/** The trade of a monument option's step. */
export function tradeOfStep(m: Monument, step: { step: string; item?: string; job?: number }): Trade {
  if (step.step === 'site') return 'quarryman';
  if (step.step === 'kiln') return 'mason';
  if (step.step === 'cut') return 'carver';
  if (step.step === 'dye') return 'dyer';
  if (step.step === 'furnish') return furnishTrade(step.item ?? '');
  if (step.step === 'job' && step.job !== undefined) return tradeOfJob(m, step.job);
  return tradeOfItem(step.item ?? '');
}

/** The member's trade, if it holds one. */
export function tradeOf(m: Monument, member: string): Trade | undefined {
  return m3(m).trades?.[member]?.trade;
}

/**
 * A credited monument chore of a trade (MC_MONUMENT_ROLES): counted, and the member's trade taken or changed. The first
 * trade to reach 2 credited chores is taken; a held trade changes only when another has 3 more among the last 8 (so a
 * mason who fetches a few logs between stages stays a mason). Returns the change, if any.
 */
export function noteTrade(m: Monument, member: string, trade: Trade, now: number, what?: { built?: boolean; item?: string; n?: number }): { took: Trade; from?: Trade } | null {
  const rec = ((m3(m).trades ??= {})[member] ??= { n: {}, recent: [], stages: {} });
  const st = String(currentStage(m) || 'built');
  rec.n[trade] = (rec.n[trade] ?? 0) + 1;
  rec.recent = [...rec.recent, trade].slice(-8);
  const s = (rec.stages[st] ??= {});
  s[trade] = (s[trade] ?? 0) + 1;
  if (what?.built) rec.built = (rec.built ?? 0) + 1;
  if (what?.item && what.n) (rec.brought ??= {})[what.item] = (rec.brought[what.item] ?? 0) + what.n;
  const count = (t: Trade) => rec.recent.filter((x) => x === t).length;
  if (!rec.trade) {
    if ((rec.n[trade] ?? 0) < 2) return null;
  } else if (rec.trade === trade || count(trade) < count(rec.trade) + 3) return null;
  const from = rec.trade;
  rec.trade = trade;
  rec.since = now;
  rec.sinceStage = currentStage(m) || undefined;
  return { took: trade, ...(from ? { from } : {}) };
}

/** The monument's name for lines: its dedication, else "the cathedral" (or "the castle", #153). */
export const cathedralName = (m: Monument) => (m3(m).name ? `the ${monumentNoun(m)} of ${m3(m).name}` : `the ${monumentNoun(m)}`);
const PRESET_WORDS: Record<string, string> = { notre_dame: 'Notre-Dame', salisbury: 'Salisbury', chartres: 'Chartres', conwy: 'Conwy', white_tower: 'the White Tower' };
export const presetWords = (p: string) => PRESET_WORDS[p] ?? p;

/** The current stage's parts: built and in all. */
export function stageParts(m: Monument): { stage: number; built: number; of: number } {
  const c = monumentPlan(m), st = currentStage(m);
  const jobs = c.jobs.map((j, i) => ({ j, i })).filter((x) => x.j.stage === st);
  return { stage: st, built: jobs.filter((x) => m.done.includes(x.i)).length, of: jobs.length };
}

/** MC_MONUMENT_NEWS: the progress line in every member's prompt ("stage 2 of 8, aisle walls ...: 3 of 5 parts built"),
 *  with its latest news for a village day and, under MC_MONUMENT_ROLES, the member's trade. */
export function progressLine(m: Monument, now: number, dayMs: number, member?: string): string {
  const c = monumentPlan(m), n = m3(m);
  const blocks = c.jobs.filter((j, i) => m.done.includes(i) && j.reroof === undefined && j.refurnish === undefined).reduce((t, j) => t + j.blocks, 0);
  const head = `The village's monument: ${cathedralName(m)} (${presetWords(m.preset)} at 1:${m.scale})`;
  let what: string;
  if (m.state === 'built') {
    const fs = furnishStage(m), p = fs && currentStage(m) === fs ? stageParts(m) : null;
    what = p ? `finished; its furnishing goes on: ${p.built} of ${p.of} parts` : `finished, ${c.design.blocks} blocks`;
  }
  else if (m.state === 'site') what = 'its site is being chosen and levelled';
  else {
    const p = stageParts(m);
    what = `stage ${p.stage} of ${c.stageNames.length}, ${c.stageNames[p.stage - 1]}: ${p.built} of ${p.of} parts built (${blocks} of ${c.design.blocks} blocks in all)`;
  }
  const news = n.news && now - n.news.t < dayMs ? ` ${n.news.text}.` : '';
  const t = member && M3.roles ? tradeOf(m, member) : undefined;
  const trade = t ? ` You are its ${t} (${TRADE_WORK[t]}).` : '';
  return `${head}: ${what}.${news}${trade}`.slice(0, 360);
}

/** MC_MONUMENT_NEWS: a member's own part in the cathedral, for what it remembers ('' when it has none). */
export function partLine(m: Monument, member: string): string {
  const rec = m3(m).trades?.[member];
  const total = rec ? Object.values(rec.n).reduce((t, q) => t + (q ?? 0), 0) : 0;
  if (!rec || !total) return '';
  const trade = rec.trade ? `its ${rec.trade} since stage ${rec.sinceStage ?? 1}; ` : '';
  const by = Object.entries(rec.n).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([t, q]) => `${q} as ${t}`).join(', ');
  const brought = Object.entries(rec.brought ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([i, q]) => `${q} ${i}`).join(', ');
  return `Your part in ${cathedralName(m)}: ${trade}${total} chore${total === 1 ? '' : 's'} (${by})${rec.built ? `, ${rec.built} part${rec.built === 1 ? '' : 's'} built` : ''}${brought ? `, brought ${brought}` : ''}.`;
}

// The architect (MC_MONUMENT_ARCHITECT): parameters only; code draws every block (lesson 1)

/** The glass roles the generator draws (its blue, red and yellow panes). */
export const GLASS_ROLES = ['blue', 'red', 'yellow'] as const;

export interface ArchitectFacts {
  village: string;
  members: number;
  wood: string;
  /** Dye colours the flowers near the village give at least 6 of, with counts (MC_GLAZING with the full palette); null:
   *  plain panes this time. */
  dyes: Record<string, number> | null;
  /** Each preset at each allowed scale: footprint, height, blocks, parts. */
  options: Array<{ preset: string; scale: number; width: number; depth: number; height: number; blocks: number; jobs: number }>;
}

/** Each preset drawn at each allowed scale (~50 ms each at 1:2), for the architect's facts. */
export function architectOptions(scales = M3.scales): ArchitectFacts['options'] {
  const out: ArchitectFacts['options'] = [];
  for (const preset of Object.keys(GOTHIC_PRESETS))
    for (const scale of scales) {
      const c = generateCathedral(GOTHIC_PRESETS[preset], scale);
      out.push({ preset, scale, width: c.design.width, depth: c.design.depth, height: c.design.height, blocks: c.design.blocks, jobs: c.jobs.length });
    }
  return out;
}

/** The dye colours on offer (at least `min` flowers of the colour near the village), with their counts. */
export function dyesOnOffer(counts: Record<string, number>, min = 6): Record<string, number> {
  const have: Record<string, number> = {};
  for (const [f, n] of Object.entries(counts)) if (FLOWER_DYE[f]) have[FLOWER_DYE[f]] = (have[FLOWER_DYE[f]] ?? 0) + n;
  return Object.fromEntries(Object.entries(have).filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]));
}

export const ARCHITECT_SYSTEM = 'You are the village architect. The village has finished its iron age and now raises a Gothic cathedral as its '
  + 'monument, over many sessions. You choose its parameters: which cathedral to model, the scale and the colours of its stained glass, and '
  + 'you may dedicate it. Code draws every block from your choice; you never draw. Call `plan_cathedral` once.';

export const ARCHITECT_TOOL = {
  name: 'plan_cathedral',
  description: 'Choose the cathedral the village builds: a preset, a scale from those offered, a dye colour for each glass role (or "plain"), an optional dedication and a one-sentence reason.',
  input_schema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'One sentence: why this cathedral suits the village.' },
      preset: { type: 'string', enum: Object.keys(GOTHIC_PRESETS) },
      scale: { type: 'number', description: 'N for 1:N, one of those offered.' },
      glass: { type: 'object', description: 'For each glass role (blue, red, yellow), a dye colour on offer or "plain".', properties: Object.fromEntries(GLASS_ROLES.map((r) => [r, { type: 'string' }])) },
      dedication: { type: 'string', description: 'Optional: a short name it is dedicated to (a saint, a founder, a virtue), up to 30 characters.' },
    },
    required: ['reason', 'preset', 'scale'],
  },
};

/** The architect's prompt. */
export function architectPrompt(f: ArchitectFacts): string {
  const scales = [...new Set(f.options.map((o) => o.scale))];
  return [
    `The village ${f.village} (${f.members} members, building in ${f.wood} wood) begins its cathedral. Members quarry the stone, smelt it into bricks in a kiln, cut the roof from logs and make the glass; a bigger cathedral takes many more sessions.`,
    'The cathedrals (footprint, height, blocks, parts of 300-800 blocks):',
    ...Object.keys(GOTHIC_PRESETS).map((p) => `- ${p}: ${GOTHIC_PRESETS[p].description}. ${f.options.filter((o) => o.preset === p).map((o) => `At 1:${o.scale}: ${o.width}x${o.depth}, ${o.height} high, ${o.blocks} blocks in ${o.jobs} parts.`).join(' ')}`),
    scales.length > 1 ? `Scales offered: ${scales.map((s) => `1:${s}`).join(', ')}.` : `The scale is set: 1:${scales[0]} (give scale ${scales[0]}).`,
    f.dyes && Object.keys(f.dyes).length
      ? `Stained glass: the windows have three glass roles (blue, red and yellow in the real cathedrals). The flowers near the village give these dye colours (flowers counted): ${Object.entries(f.dyes).map(([c, n]) => `${c} (${n})`).join(', ')}. Give each role one of these colours or "plain".`
      : 'Stained glass: no dye flowers grow near the village in number, so the windows are plain glass (give "plain" for each role).',
  ].join('\n');
}

export interface ArchitectPick { preset: string; scale: number; colours: Record<string, string>; name?: string; reason: string }

/** The architect's call checked: the problems to send back, or the pick (colours only those on offer, plain left out). */
export function checkArchitect(input: Record<string, unknown> | undefined, f: ArchitectFacts): { pick: ArchitectPick } | { problems: string[] } {
  const problems: string[] = [];
  const preset = String(input?.preset ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/^notre_dame_de_paris$/, 'notre_dame');
  if (!GOTHIC_PRESETS[preset]) problems.push(`preset must be one of ${Object.keys(GOTHIC_PRESETS).join(', ')} (got "${String(input?.preset ?? '')}")`);
  const scales = [...new Set(f.options.map((o) => o.scale))];
  const raw = Number(String(input?.scale ?? '').replace(/^1:/, ''));
  const scale = raw > 0 && raw < 1 ? Math.round(1 / raw) : raw;
  if (!scales.includes(scale)) problems.push(`scale must be one of ${scales.join(', ')} (N for 1:N; got ${String(input?.scale ?? 'none')})`);
  const colours: Record<string, string> = {};
  const glass = (input?.glass && typeof input.glass === 'object' ? input.glass : {}) as Record<string, unknown>;
  for (const r of GLASS_ROLES) {
    const c = String(glass[r] ?? 'plain').trim().toLowerCase().replace(/\s+/g, '_');
    if (c === 'plain' || c === '' || c === 'none') continue;
    if (!f.dyes?.[c]) problems.push(`glass ${r}: "${c}" is not a colour on offer (${f.dyes && Object.keys(f.dyes).length ? Object.keys(f.dyes).join(', ') : 'none'}, or plain)`);
    else colours[r] = c;
  }
  const name = String(input?.dedication ?? '').replace(/[^\p{L}\p{N} '.-]/gu, '').trim().slice(0, 30);
  const reason = String(input?.reason ?? '').trim().slice(0, 240);
  if (problems.length) return { problems };
  return { pick: { preset, scale, colours, ...(name ? { name } : {}), reason } };
}

/** A new monument record from the architect's pick (MC_MONUMENT_ARCHITECT), or from the settings with why code chose. */
export function newMonumentPicked(wood: string, now: number, pick: ArchitectPick | null, by: string, fallback?: string): MonumentM3 {
  const m: MonumentM3 = newMonument(wood, now);
  if (pick) {
    m.preset = pick.preset;
    m.scale = pick.scale;
    if (MONUMENT.glazing && m.palette === 'full') m.colours = pick.colours;
    if (pick.name) m.name = pick.name;
  }
  m.arch = { by, reason: pick?.reason ?? '', ...(fallback ? { fallback } : {}) };
  return m;
}
