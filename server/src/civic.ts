/**
 * The civic tier (MC_CIVIC, on): real buildings a village raises between its houses and its monument, one at a time as
 * it grows: guildhalls, market halls, tithe barns, mills, inns and almshouses (timberGen.ts), lighthouses and clock
 * towers (towerGen.ts), and the stone kinds gothicGen.ts and castleGen.ts may offer through the same interface (parish
 * churches, chapels, bell towers, gates, tower houses: a `CIVIC_SOURCE` export of theirs is picked up, see SOURCES).
 *
 * A civic building is a monument record of type 'civic' (monument.ts): the same site search and pad, yard, kiln, quarry,
 * lodge and build jobs charged to storage, its jobs smaller (150-450 blocks). When it stands it is moved to the village's
 * `civics` list and the next one may begin; the kiln, lodge and quarries pass to the next record, whatever it is.
 *
 * Rules (code's; lesson 1): a civic building begins once the village is complete and no monument record is open; the
 * timber kinds from the start, the stone kinds once the village has its mine or the iron rung (the ladder of ages: timber
 * first, stone later); each building once per village; each drawn at the largest scale (1:1, 1:2, 1:3 or 1:4) whose
 * blocks are within MC_CIVIC_BLOCKS (2,000: about an hour for ~25 members, the report's measure). With the tier on, the
 * iron age's monument waits for the civic building under way and for MC_CIVIC_FIRST (1) to stand; with it off nothing
 * here runs and the monument is as before. Which building comes next is the mayor's model's choice from a short list
 * (CIVIC_LIST, 6: kinds not yet built first, at most two of a kind), code's when the model fails (MC_CIVIC_CHOOSE=code:
 * always).
 */
import type { Cathedral } from './gothicGen';
import * as gothic from './gothicGen';
import * as castle from './castleGen';
import { rawSetting } from './settings';
import { TIMBER_PRESETS, generateTimber, type TimberPreset } from './timberGen';
import { TOWER_PRESETS, generateTower } from './towerGen';
import type { Village } from './village';

export const CIVIC = {
  on: /^(on|1|true|yes)$/i.test(rawSetting('MC_CIVIC') ?? 'on'),
  /** The most blocks a civic building is drawn with (the scale is the largest that keeps under it). */
  blocks: Math.max(200, Number(rawSetting('MC_CIVIC_BLOCKS') ?? 2000) || 2000),
  /** Civic buildings standing before the iron age's monument may begin. */
  first: Math.max(0, Math.floor(Number(rawSetting('MC_CIVIC_FIRST') ?? 1) || 0)),
  /** Who chooses: the mayor's model (code when it fails), or code. */
  choose: (/^code$/i.test(rawSetting('MC_CIVIC_CHOOSE') ?? 'model') ? 'code' : 'model') as 'model' | 'code',
  /** Minutes (game time: divided by MC_TIME_SCALE) between one civic building standing and the next one's choice. */
  gap: Math.max(0, Number(rawSetting('MC_CIVIC_GAP') ?? 5) || 0),
};
/** Test hook. */
export function setCivic(s: Partial<typeof CIVIC>): void { Object.assign(CIVIC, s); }

/** The options on the chooser's list, and the scales tried (1:N). */
export const CIVIC_LIST = 6;
export const CIVIC_SCALES = [1, 2, 3, 4];
/** What a civic building leaves in storage of each item when it claims storage's stock for its yard. */
export const CIVIC_KEEP = 32;
/** A civic site that failed this often is given up and another building chosen. */
export const CIVIC_SITE_FAILS = 3;

/** One building a source can draw. `age`: timber (from the start) or stone (once the village has its mine or iron). */
export interface CivicEntry {
  id: string;
  title: string;
  /** Its kind in lines ("guildhall", "lighthouse"). */
  kind: string;
  age: 'timber' | 'stone';
  description: string;
  place: string;
  built: string;
}
/** A generator's civic buildings (timberGen's, towerGen's; gothicGen and castleGen may export one as CIVIC_SOURCE). */
export interface CivicSource {
  family: string;
  entries: CivicEntry[];
  draw(id: string, scale: number): Cathedral;
}

const TIMBERISH = new Set(['timber', 'boarded', 'open']);
const timberAge = (p: TimberPreset): 'timber' | 'stone' =>
  TIMBERISH.has(p.ground) && (!p.upper || TIMBERISH.has(p.upper)) && !p.buttresses && p.form !== 'towermill' && p.form !== 'wheel' ? 'timber' : 'stone';

export const TIMBER_SOURCE: CivicSource = {
  family: 'timber',
  entries: Object.values(TIMBER_PRESETS).map((p) => ({ id: p.name, title: p.title, kind: p.kind.replace(/_/g, ' '), age: timberAge(p), description: p.description, place: p.place, built: p.built })),
  draw: (id, scale) => generateTimber(TIMBER_PRESETS[id], scale),
};
export const TOWER_SOURCE: CivicSource = {
  family: 'tower',
  entries: Object.values(TOWER_PRESETS).map((p) => ({ id: p.name, title: p.title, kind: p.kind.replace(/_/g, ' '), age: 'stone', description: p.description, place: p.place, built: p.built })),
  draw: (id, scale) => generateTower(TOWER_PRESETS[id], scale),
};

/** Every source: the two here, and gothicGen's and castleGen's CIVIC_SOURCE when they export one (the stone kinds). */
export const SOURCES: CivicSource[] = [TIMBER_SOURCE, TOWER_SOURCE,
  ...[(gothic as unknown as { CIVIC_SOURCE?: CivicSource }).CIVIC_SOURCE, (castle as unknown as { CIVIC_SOURCE?: CivicSource }).CIVIC_SOURCE].filter((s): s is CivicSource => !!s)];

/** Every entry by id, with its source. */
export function civicEntries(): Array<CivicEntry & { source: CivicSource }> {
  return SOURCES.flatMap((s) => s.entries.map((e) => ({ ...e, source: s })));
}
export const civicEntry = (id: string) => civicEntries().find((e) => e.id === id);

const drawn = new Map<string, Cathedral>();
/** A civic building drawn at 1:scale (cached). */
export function drawCivic(id: string, scale: number): Cathedral {
  const k = `${id}|${scale}`;
  let c = drawn.get(k);
  if (!c) {
    const e = civicEntry(id);
    if (!e) throw new Error(`civic: no building ${id}`);
    c = e.source.draw(id, scale);
    drawn.set(k, c);
  }
  return c;
}

/** The scale (N for 1:N) a building is drawn at: the largest building under the block budget (else the smallest tried). */
export function civicScale(id: string, budget = CIVIC.blocks): number {
  for (const n of CIVIC_SCALES) if (drawCivic(id, n).design.blocks <= budget) return n;
  return CIVIC_SCALES[CIVIC_SCALES.length - 1];
}

/** A civic building that stood (the village's `civics` list). */
export interface CivicBuilt {
  preset: string; kind: string; scale: number; at: number; built?: number; site?: { x1: number; z1: number; x2: number; z2: number; y: number }; blocks: number; by?: string;
  /** Why it was given up (its site found no ground), absent when it stands. */
  skipped?: string;
  /** The kiln, lodge and quarries it leaves the next record (taken by civicKit). */
  kit?: Record<string, unknown>;
}
export type VillageCivic = Village & { civics?: CivicBuilt[] };
export const civicsOf = (v: Village): CivicBuilt[] => (v as VillageCivic).civics ?? [];
/** Civic buildings standing (not given up). */
export const civicsStanding = (v: Village) => civicsOf(v).filter((c) => !c.skipped).length;

/** The ages open to the village: timber always, stone with its mine or the iron rung. */
export function civicAges(v: Village, ironReached: boolean): Array<'timber' | 'stone'> {
  return ironReached || !!v.mine ? ['timber', 'stone'] : ['timber'];
}

export interface CivicOption { id: string; title: string; kind: string; age: 'timber' | 'stone'; scale: number; width: number; depth: number; height: number; blocks: number; jobs: number; line: string }

/**
 * The short list (pure but for the drawing's cache): the entries of the open ages not built or given up here, and not
 * any other village's most recent civic building (planning's DECISIONS a39e559: the Mayor took Pembridge first in all
 * three staged runs), each at its scale, the kinds the village has not built first, at most two of a kind, CIVIC_LIST in
 * all; the order within a rank is the village's own (a hash of its name and the count built), so villages differ.
 */
export function civicOptions(v: Village, ironReached: boolean, n = CIVIC_LIST, others: Village[] = []): CivicOption[] {
  const ages = civicAges(v, ironReached), had = civicsOf(v);
  const done = new Set(had.map((c) => c.preset)), kinds = new Set(had.filter((c) => !c.skipped).map((c) => c.kind));
  for (const o of others) {
    if (o === v) continue;
    const last = civicsOf(o).filter((c) => !c.skipped).at(-1);
    if (last) done.add(last.preset);
  }
  const seed = `${v.name}|${had.length}`;
  const hash = (s: string) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  const pool = civicEntries().filter((e) => ages.includes(e.age) && !done.has(e.id))
    .sort((a, b) => Number(kinds.has(a.kind)) - Number(kinds.has(b.kind)) || hash(`${seed}|${a.id}`) - hash(`${seed}|${b.id}`));
  const out: CivicOption[] = [], perKind = new Map<string, number>();
  for (const e of pool) {
    if (out.length >= n) break;
    if ((perKind.get(e.kind) ?? 0) >= 2) continue;
    const scale = civicScale(e.id), c = drawCivic(e.id, scale);
    // (a footprint wider than the monument's search can place near the village is left out)
    if (Math.max(c.design.width, c.design.depth) > 72) continue;
    perKind.set(e.kind, (perKind.get(e.kind) ?? 0) + 1);
    const d = c.design;
    out.push({
      id: e.id, title: e.title, kind: e.kind, age: e.age, scale, width: d.width, depth: d.depth, height: d.height, blocks: d.blocks, jobs: c.jobs.length,
      line: `- ${e.id}: ${e.title} (${e.place}, ${e.built}), ${aKind(e.kind)}: ${e.description}. At 1:${scale}: ${d.width}x${d.depth}, ${d.height} high, ${d.blocks} blocks in ${c.jobs.length} parts; ${e.age === 'timber' ? 'timber (logs and planks)' : 'stone (cobblestone, stone bricks, glass)'}.`,
    });
  }
  return out;
}

/** A kind with its article ("an almshouse", "a mill"). */
export const aKind = (kind: string) => `${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind}`;

/** Code's pick: the first option (the kinds not built yet come first). */
export const codePick = (options: CivicOption[]) => options[0];

export const CIVIC_SYSTEM = 'You are the mayor. The village has built its houses and now raises its public buildings, one at a time, before its '
  + 'great monument after the iron age. Choose the next one from the list: what the village would use and be proud of. Code draws every block '
  + 'from your choice. Call `choose_civic` once.';
export const CIVIC_TOOL = {
  name: 'choose_civic',
  description: 'Choose the village\'s next public building from the list, with a one-sentence reason.',
  input_schema: {
    type: 'object',
    properties: {
      building: { type: 'string', description: 'The id of one building on the list.' },
      reason: { type: 'string', description: 'One sentence: why the village builds this one now.' },
    },
    required: ['building', 'reason'],
  },
};

export interface CivicFacts { village: string; members: number; wood: string; houses: number; built: string[]; options: CivicOption[] }
export function civicPrompt(f: CivicFacts): string {
  return [
    `The village ${f.village} (${f.members} members, ${f.houses} houses, building in ${f.wood} wood) chooses its next public building. Members fell the logs, quarry the stone and smelt the glass; a bigger building takes longer.`,
    f.built.length ? `It has built: ${f.built.join(', ')}.` : 'It has no public building yet.',
    'The buildings it can raise now (real ones, drawn from their measures at the scale given):',
    ...f.options.map((o) => o.line),
  ].join('\n');
}

/** The model's call checked: the option, or the problem to send back. */
export function checkCivic(input: Record<string, unknown> | undefined, options: CivicOption[]): { pick: CivicOption; reason: string } | { problem: string } {
  const id = String(input?.building ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const pick = options.find((o) => o.id === id) ?? options.find((o) => o.title.toLowerCase() === String(input?.building ?? '').trim().toLowerCase());
  if (!pick) return { problem: `building must be one of ${options.map((o) => o.id).join(', ')} (got "${String(input?.building ?? '')}")` };
  return { pick, reason: String(input?.reason ?? '').trim().slice(0, 240) };
}

/** Whether the monument (the iron age's) may begin: always with the tier off; with it on once none is under way and
 *  MC_CIVIC_FIRST stand, or no civic building is left to choose. */
export function monumentMayBegin(v: Village, ironReached: boolean, others: Village[] = []): boolean {
  if (!CIVIC.on) return true;
  return civicsStanding(v) >= CIVIC.first || !civicOptions(v, ironReached, 1, others).length;
}

/** The civic record leaves the monument's place (MC_CIVIC): built, or given up when its site failed; listed in the
 *  village's `civics` with the kiln, lodge and quarries for the next record. Returns the entry. */
export function civicDone(v: Village, now: number): CivicBuilt {
  const m = v.monument! as Village['monument'] & { arch?: { by: string } };
  const e = civicEntry(m.preset);
  const c: CivicBuilt = {
    preset: m.preset, kind: e?.kind ?? 'building', scale: m.scale, at: m.at, blocks: drawCivic(m.preset, m.scale).design.blocks,
    ...(m.built ? { built: m.built } : { built: now }), ...(m.site ? { site: { x1: m.site.x1, z1: m.site.z1, x2: m.site.x2, z2: m.site.z2, y: m.site.y } } : {}),
    ...(m.arch?.by ? { by: m.arch.by } : {}),
    ...(m.state !== 'built' ? { skipped: `its site found no ground (${m.fails ?? 0} tries)` } : {}),
  };
  const kit: Record<string, unknown> = {};
  for (const k of ['kiln', 'lodge', 'quarry', 'quarriesDone'] as const) if (m[k]) kit[k] = m[k];
  if (Object.keys(kit).length) c.kit = kit;
  ((v as VillageCivic).civics ??= []).push(c);
  delete v.monument;
  return c;
}

/** The kiln, lodge and quarries the last civic building left, for a new record (taken once). */
export function civicKit(v: Village): Record<string, unknown> {
  const last = [...civicsOf(v)].reverse().find((c) => c.kit);
  if (!last) return {};
  const kit = last.kit!;
  delete last.kit;
  return kit;
}

/** The village's civic buildings for logs. */
export function civicLine(v: Village): string {
  const cs = civicsOf(v);
  return cs.length ? `civic: ${cs.map((c) => `${c.preset} 1:${c.scale}${c.skipped ? ' (given up)' : c.built ? ` in ${Math.round(((c.built ?? c.at) - c.at) / 60000)} min` : ''}`).join(', ')}` : 'civic: none';
}
