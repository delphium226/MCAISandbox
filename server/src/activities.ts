/**
 * Activity specs (X.1, runs/2026-10-16/s34/spec_x1_v2.md section A): the menu's make, gather and furnish options written
 * as data, the validator every spec passes, and the workshop's catalogue built from the game's recipes. World-free: it
 * reads the registry, Materials' plans and the workshop's tables, never the world (mcWorld.ts builds its options from
 * these specs and runs their steps). The same format will carry the specs members author later (X.2), so the validator
 * is strict: known skills and arguments only, no coordinates (places come from code), nothing a peaceful world lacks.
 */
import type minecraftData from 'minecraft-data';
import { UNOBTAINABLE, WOODS, woodPart, type Counts, type Materials } from './mineflayer/mcMaterials';
import { GATHER_ALSO, GATHER_KINDS, MAKE_NEVER, type MakeGood, type Material } from './mineflayer/mcWorkshop';

type Registry = ReturnType<typeof minecraftData>;

export type GoodClass = 'tool' | 'light' | 'station' | 'decor' | 'block' | 'food' | 'material';

export interface StepSpec { skill: string; args: Record<string, string | number | boolean> }

export interface ActivitySpec {
  /** 'make:birch_door', 'gather:sand', 'furnish'. */
  id: string;
  kind: 'make' | 'gather' | 'furnish';
  /** Menu words, at most 60 characters ("Make birch doors"). */
  name: string;
  /** keep: the workshop's own goods and built-in chores; food: FOOD_GOODS; catalog: the reserve from the recipes; decor:
   *  an item only the houses' furniture wants; library: authored (X.2). */
  source: 'keep' | 'food' | 'catalog' | 'decor' | 'library';
  class?: GoodClass;
  /** The skills run in order; the world fills each instance's count (and a furnish chore's part). */
  steps: StepSpec[];
  /** What it is for, at most 160 characters (lesson 127). */
  effect: string;
  /** The YIELD key a run is judged by ('make', 'deposited', 'furnish'): by what it changed, not the stock (lesson 138). */
  success: { yield: string };
  /** Make specs: the workshop good. */
  good?: MakeGood;
  /** Make specs whose good is one wood kind's: planned only from that kind's logs and planks. */
  wood?: string;
}

/** Skills a spec may run, with the arguments each takes and their types (a chore's `chore: true` is the runner's). */
export const CHORE_SKILLS: Record<string, Record<string, 'string' | 'number' | 'boolean'>> = {
  make: { item: 'string', count: 'number', furnace: 'number' },
  collect: { block: 'string', count: 'number' },
  deposit: { item: 'string', also: 'string' },
  furnish: { part: 'string', count: 'number' },
};

const KINDS = new Set(['make', 'gather', 'furnish']);
const SOURCES = new Set(['keep', 'food', 'catalog', 'decor', 'library']);
const CLASSES = new Set(['tool', 'light', 'station', 'decor', 'block', 'food', 'material']);
const ID = /^[a-z_]+(:[a-z0-9_]+)?$/;
/** Names collect and deposit take for a group of items. */
const GROUP_WORDS = new Set(['logs', 'planks', 'all']);

/**
 * What is wrong with a spec (empty: valid). Pure and never throws (the catalogue is built inside the menu path, lesson
 * 104): an exception becomes one error. `ctx.ids`: the ids already taken (a duplicate is an error; not added to).
 */
export function validateSpec(s: ActivitySpec, ctx: { registry: Registry; ids?: Set<string> }): string[] {
  try {
    return check(s, ctx);
  } catch (e) {
    return [`the validator failed: ${(e as Error).message}`];
  }
}

function check(s: ActivitySpec, ctx: { registry: Registry; ids?: Set<string> }): string[] {
  const errs: string[] = [];
  const reg = ctx.registry;
  if (!s || typeof s !== 'object') return ['not an object'];
  if (typeof s.id !== 'string' || !ID.test(s.id)) errs.push(`id "${s.id}" is not like make:oak_door`);
  else if (ctx.ids?.has(s.id)) errs.push(`id ${s.id} is taken`);
  if (!KINDS.has(s.kind)) errs.push(`kind "${s.kind}" is unknown`);
  if (!SOURCES.has(s.source)) errs.push(`source "${s.source}" is unknown`);
  if (s.class !== undefined && !CLASSES.has(s.class)) errs.push(`class "${s.class}" is unknown`);
  if (typeof s.name !== 'string' || !s.name.length || s.name.length > 60) errs.push('name must be 1-60 characters');
  if (typeof s.effect !== 'string' || !s.effect.length || s.effect.length > 160) errs.push('effect must be 1-160 characters');
  if (!s.success || typeof s.success.yield !== 'string' || !s.success.yield) errs.push('success.yield is missing');
  const strict = s.source === 'catalog' || s.source === 'decor';
  // Items a spec names: in the registry, obtainable here, and (for generated goods) not kept for pens, food and iron
  const item = (n: string, what: string, groups = false) => {
    if (groups && GROUP_WORDS.has(n)) return;
    if (!reg.itemsByName[n] && !(what === 'block' && reg.blocksByName[n])) errs.push(`${what} ${n} does not exist`);
    else if (UNOBTAINABLE[n]) errs.push(`${what} ${n}: ${UNOBTAINABLE[n]}`);
    else if (strict && MAKE_NEVER.has(n)) errs.push(`${what} ${n} is kept for pens, food or iron, never made into goods`);
  };
  if (!Array.isArray(s.steps) || !s.steps.length) errs.push('no steps');
  for (const [i, st] of (Array.isArray(s.steps) ? s.steps : []).entries()) {
    const allowed = st && CHORE_SKILLS[st.skill];
    if (!allowed) { errs.push(`step ${i + 1}: skill "${st?.skill}" is not a chore skill`); continue; }
    for (const [k, v] of Object.entries(st.args ?? {})) {
      const type = allowed[k];
      if (!type) {
        errs.push(/^[xyz]$/.test(k) ? `step ${i + 1}: no coordinates in a spec (places come from code)` : `step ${i + 1}: ${st.skill} takes no ${k}`);
        continue;
      }
      if (typeof v !== type) { errs.push(`step ${i + 1}: ${k} must be a ${type}`); continue; }
      if (type === 'number') {
        const [lo, hi] = k === 'furnace' ? [0, 3] : [1, 64];
        if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) errs.push(`step ${i + 1}: ${k} ${v} is not a whole number in ${lo}..${hi}`);
      }
      if (type === 'string' && !(v as string).length) errs.push(`step ${i + 1}: ${k} is empty`);
    }
    const a = st.args ?? {};
    if (st.skill === 'make' && typeof a.item === 'string') item(a.item, 'item');
    if (st.skill === 'make' && a.item === undefined) errs.push(`step ${i + 1}: make needs an item`);
    if (st.skill === 'collect' && typeof a.block === 'string') item(a.block, 'block', true);
    if (st.skill === 'deposit' && typeof a.item === 'string') item(a.item, 'item', true);
    if (st.skill === 'deposit' && typeof a.also === 'string') for (const n of a.also.split(',')) item(n, 'item');
  }
  if (s.kind === 'make') {
    const g = s.good;
    if (!g) errs.push('a make spec needs its good');
    else {
      const made = s.steps?.find((st) => st?.skill === 'make')?.args?.item;
      if (made !== g.item) errs.push(`the make step's item ${made} is not the good's ${g.item}`);
      const whole = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
      if (!whole(g.unit) || g.unit < 1) errs.push(`unit ${g.unit} is not a whole number >= 1`);
      else {
        if (!whole(g.batch) || g.batch < g.unit || g.batch % g.unit) errs.push(`batch ${g.batch} is not a multiple of the unit ${g.unit}`);
        // (food targets follow the members: 0 here, the world's makeTarget sets them)
        if (!g.food && (!whole(g.target) || g.target < g.unit)) errs.push(`target ${g.target} is below the unit ${g.unit}`);
      }
      if (!g.words) errs.push('the good has no words');
    }
  }
  if (s.wood !== undefined) {
    if (!WOODS.includes(s.wood)) errs.push(`wood ${s.wood} is unknown`);
    else if (s.good && woodPart(s.good.item)?.kind !== s.wood) errs.push(`${s.good.item} is not ${s.wood} wood`);
  }
  return errs;
}

// ---------------------------------------------------------------------------------------------
// Built-in specs: the workshop's goods, gathering, furnishing
// ---------------------------------------------------------------------------------------------

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/** A workshop good as a spec (the good's fields as given). */
function makeSpec(good: MakeGood, source: ActivitySpec['source'], cls?: GoodClass, wood?: string): ActivitySpec {
  return {
    id: `make:${good.item}`, kind: 'make', name: cut(`Make ${good.words}`, 60), source, ...(cls ? { class: cls } : {}),
    steps: [{ skill: 'make', args: { item: good.item } }], effect: cut(good.forWhat, 160), success: { yield: 'make' }, good,
    ...(wood ? { wood } : {}),
  };
}

/** The workshop's gathering (sand, logs, cobblestone), collect then deposit; logs in the village's kind when it has one. */
export function gatherSpecs(wood?: string): ActivitySpec[] {
  return (Object.keys(GATHER_KINDS) as Material[]).map((m): ActivitySpec => {
    const k = GATHER_KINDS[m];
    return {
      id: `gather:${m}`, kind: 'gather', name: k.words, source: 'keep', class: 'material',
      steps: [{ skill: 'collect', args: { block: k.block(wood) } }, { skill: 'deposit', args: { item: k.deposit(wood), also: GATHER_ALSO } }],
      effect: cut(k.forWhat, 160), success: { yield: 'deposited' },
    };
  });
}

/** Furnishing the houses: one spec, its part (a building) and count filled per instance. */
export const furnishSpec: ActivitySpec = {
  id: 'furnish', kind: 'furnish', name: 'Furnish the houses', source: 'keep',
  steps: [{ skill: 'furnish', args: {} }],
  effect: 'chairs, tables and stations from storage into the village\'s houses',
  success: { yield: 'furnish' },
};

// ---------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------

/** Wood goods, of the pinned kind only (no boats, shelves or hanging signs): the part and its class. */
const WOOD_GOODS: Array<[string, GoodClass]> = [
  ['door', 'decor'], ['trapdoor', 'decor'], ['fence', 'decor'], ['fence_gate', 'decor'], ['sign', 'decor'], ['button', 'decor'],
  ['pressure_plate', 'decor'], ['stairs', 'block'], ['slab', 'block'],
];

/**
 * The other candidates, by class. Stone tools are the keeps' (pickaxe, hoe) or D11's cuts (axe, shovel, sword), as is the
 * chest (a carried chest becomes a storage chest). The sandstone family is listed but GATHER marks sandstone gathered, so
 * it falls to the gather rule (sand alone does not make it). Smoker and campfire fall to it too while Materials plans
 * them from stripped stems (an exact recipe variant ties with any logs and comes first), the campfire from coal as well.
 * Stone buttons, pressure plates and the chiseled and cracked stone bricks are beyond the spec's list: cobblestone only.
 */
const CANDIDATES: Array<[string, GoodClass]> = [
  ['wooden_pickaxe', 'tool'], ['wooden_axe', 'tool'], ['wooden_shovel', 'tool'], ['wooden_hoe', 'tool'],
  ['crafting_table', 'station'], ['furnace', 'station'], ['smoker', 'station'], ['grindstone', 'station'],
  ['campfire', 'light'],
  ['stone_button', 'decor'], ['stone_pressure_plate', 'decor'],
  ['stone', 'block'], ['stone_slab', 'block'], ['stone_stairs', 'block'], ['smooth_stone_slab', 'block'],
  ['cobblestone_stairs', 'block'], ['cobblestone_slab', 'block'], ['cobblestone_wall', 'block'],
  ['stone_brick_stairs', 'block'], ['stone_brick_slab', 'block'], ['stone_brick_wall', 'block'],
  ['chiseled_stone_bricks', 'block'], ['cracked_stone_bricks', 'block'],
  ['sandstone', 'block'], ['cut_sandstone', 'block'], ['smooth_sandstone', 'block'], ['sandstone_stairs', 'block'],
  ['sandstone_slab', 'block'], ['sandstone_wall', 'block'],
];

/** Never in the catalogue, whatever asks for it (D11's cuts; a chest becomes a storage chest when carried). */
const NEVER = new Set(['chest', 'stone_axe', 'stone_shovel', 'stone_sword']);

const CLASS_ORDER: GoodClass[] = ['tool', 'station', 'light', 'decor', 'block', 'material', 'food'];

/** A reserve's target by class: blocks 16, stairs, slabs and walls 8, decor 4, a station and a tool 1, lights 2. */
function reserve(item: string, cls: GoodClass): number {
  if (cls === 'block') return /_(stairs|slab|wall)$/.test(item) ? 8 : 16;
  return ({ decor: 4, station: 1, tool: 1, light: 2 } as Record<string, number>)[cls] ?? 4;
}

const FOR_WHAT: Record<GoodClass, string> = {
  tool: 'tools for members', station: 'a station for the houses', light: 'light for the houses later', decor: 'furniture for the houses later',
  block: 'a stock for building later', material: 'a stock for building later', food: 'food for members',
};

/** What gathering chores bring in: a catalogue good's plan may ask for nothing else. */
const gatherable = (n: string, wood: string) => n === 'any:logs' || n === `${wood}_log` || n === 'any:cobblestone' || n === 'cobblestone' || n === 'sand';

/** An item's name in menus, plural: -s, -es after s, x, ch or sh; mass nouns (glass, stone, charcoal) and plurals as they are. */
export function goodWords(item: string): string {
  const w = item.replace(/_/g, ' ');
  if (/(^| )(glass|stone|cobblestone|sandstone|charcoal|stairs|bricks)$/.test(w)) return w;
  return /(s|x|ch|sh)$/.test(w) ? `${w}es` : `${w}s`;
}

const roundUp = (n: number, unit: number) => Math.ceil(n / unit) * unit;

/** The class an item asked for by the houses' furniture falls in, when it is no candidate. */
function classOf(item: string): GoodClass {
  if (/_(pickaxe|axe|shovel|hoe|sword)$/.test(item)) return 'tool';
  if (/(torch|lantern|campfire|candle)$/.test(item)) return 'light';
  if (/_(stairs|slab|wall|planks)$/.test(item) || /^(stone|glass|stone_bricks|smooth_stone)$/.test(item)) return 'block';
  return 'decor';
}

const cache = new WeakMap<Materials, Map<string, { specs: ActivitySpec[]; dropped: Array<{ id: string; why: string }> }>>();

/**
 * The menu's make goods for a village: the keeps (MAKE_GOODS) and food (FOOD_GOODS) first, as given, then the catalogue
 * by class (tool, station, light, decor, block) and name. A catalogue good is kept only when one unit plans with no
 * problems, gathers nothing but logs (the pinned kind's or any), cobblestone and sand, and takes no MAKE_NEVER item on
 * the way. `decorDemand` (items the open furniture spots want, by count) raises a good's target to the demand plus its
 * reserve; an item no list has gets its own spec (source 'decor', target the demand). Targets are whole units; a batch
 * is up to 4 units. Invalid specs go to `dropped`, never thrown. Cached per (materials, wood, demand, keeps): callers
 * must not change the specs returned.
 */
export function buildCatalog(registry: Registry, materials: Materials, opts: { wood: string; decorDemand: Counts; keep: MakeGood[]; food: MakeGood[] }):
  { specs: ActivitySpec[]; dropped: Array<{ id: string; why: string }> } {
  const demand = Object.entries(opts.decorDemand ?? {}).filter(([, q]) => q > 0).sort(([a], [b]) => a.localeCompare(b));
  const key = JSON.stringify([opts.wood, demand, opts.keep, opts.food]);
  let byKey = cache.get(materials);
  if (!byKey) cache.set(materials, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const out = build(registry, materials, opts.wood, new Map(demand), opts.keep, opts.food);
  if (byKey.size > 64) byKey.clear();
  byKey.set(key, out);
  return out;
}

function build(registry: Registry, materials: Materials, wood: string, demand: Map<string, number>, keep: MakeGood[], food: MakeGood[]) {
  const specs: ActivitySpec[] = [];
  const dropped: Array<{ id: string; why: string }> = [];
  const ids = new Set<string>();
  const add = (s: ActivitySpec) => {
    const errs = validateSpec(s, { registry, ids });
    if (errs.length) { dropped.push({ id: s.id, why: errs.join('; ') }); return; }
    ids.add(s.id);
    specs.push(s);
  };
  const spotsWord = (n: number) => `for the houses' furniture: ${n} spot${n === 1 ? '' : 's'} open`;
  // Keeps and food as given; furniture demand raises a target (on a copy) and says so
  for (const [list, source] of [[keep, 'keep'], [food, 'food']] as const) {
    for (const g of list) {
      const d = demand.get(g.item);
      demand.delete(g.item);
      add(makeSpec(d ? { ...g, target: roundUp(g.target + d, g.unit), forWhat: cut(`${g.forWhat}; ${spotsWord(d)}`, 160) } : g, source));
    }
  }
  // Candidates (the pinned wood's goods, the lists above, then what only the furniture wants), each item once
  const cands = new Map<string, { cls: GoodClass; source: 'catalog' | 'decor' }>();
  for (const [part, cls] of WOOD_GOODS) cands.set(`${wood}_${part}`, { cls, source: 'catalog' });
  for (const [item, cls] of CANDIDATES) if (!cands.has(item)) cands.set(item, { cls, source: 'catalog' });
  for (const item of demand.keys()) if (!cands.has(item)) cands.set(item, { cls: classOf(item), source: 'decor' });
  const made: ActivitySpec[] = [];
  for (const [item, { cls, source }] of cands) {
    const id = `make:${item}`;
    if (ids.has(id)) continue;
    if (NEVER.has(item)) { dropped.push({ id, why: 'never a catalogue good (D11)' }); continue; }
    const kind = woodPart(item)?.kind;
    if (kind && kind !== wood) { dropped.push({ id, why: `${kind} wood, not the village's ${wood}` }); continue; }
    if (!registry.itemsByName[item]) { dropped.push({ id, why: 'no such item' }); continue; }
    const one = materials.plan({ [item]: 1 }, {});
    const step = one.steps.find((st) => st.item === item);
    if (!step) { dropped.push({ id, why: one.problems.length ? one.problems.join('; ') : 'gathered as it is, not made' }); continue; }
    const unit = step.makes;
    const p = materials.plan({ [item]: unit }, {});
    const why = [
      ...p.problems,
      ...Object.keys(p.gather).filter((n) => !gatherable(n, wood)).map((n) => `gathers ${n}`),
      ...p.steps.flatMap((st) => [st.item, st.input ?? '']).filter((n) => MAKE_NEVER.has(n)).map((n) => `takes ${n}`),
    ];
    if (why.length) { dropped.push({ id, why: why.join('; ') }); continue; }
    const d = demand.get(item) ?? 0;
    const target = roundUp(source === 'decor' ? d : d + reserve(item, cls), unit);
    const batch = Math.max(unit, Math.floor(Math.min(target, 4 * unit) / unit) * unit);
    const words = goodWords(item);
    const good: MakeGood = { item, target, batch, unit, words, forWhat: d ? spotsWord(d) : FOR_WHAT[cls], ...(kind ? { wood: kind } : {}) };
    made.push(makeSpec(good, source, cls, kind));
  }
  made.sort((a, b) => CLASS_ORDER.indexOf(a.class!) - CLASS_ORDER.indexOf(b.class!) || a.id.localeCompare(b.id));
  for (const s of made) add(s);
  return { specs, dropped };
}
