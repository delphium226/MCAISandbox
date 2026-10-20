/**
 * The village simulator's modelled world (spec runs/2026-10-20/s41/spec_sim_v1.md, its check check_sim_v1.md): per skill an
 * effect model that writes the same village records and returns the same done or failure message as the real skill (the
 * world's end path parses them: depositedOf, depositedItems, choreProductive's YIELD), a crop store the chore scanners read
 * through the fake bots' columns (registry state ids, advanced by random ticks), and eggs laid in the chicken pens as item
 * entities. Storage changes are arithmetic on `chest.items` (the real skills re-read the chest windows instead).
 * Unknown skills are done with no effect and counted (the report's fidelity gaps).
 */
import { noteFood, chooseMeal, storeForMeals, releaseMeal, FOOD_POINTS, APPETITE } from '../../server/src/appetite';
import { wheatKeep } from '../../server/src/mineflayer/mcBuild';
import { SLOT_KINDS, penPlan } from '../../server/src/farmSlots';
import { holdsDelete, holdKey, makeHolds } from '../../server/src/mineflayer/mcWorkshop';
import { OFFERS } from '../../server/src/merchant';
import { designBill, inWood } from '../../server/src/mineflayer/mcMaterials';
import { storageContents } from '../../server/src/mineflayer/mcStorage';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
export type Counts = Record<string, number>;
export interface Outcome { ok: boolean; message: string; code?: string }

/** A seeded random source (mulberry32). */
export function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const list = (c: Counts) => Object.entries(c).filter(([, q]) => q > 0).map(([n, q]) => `${q} ${n}`).join(', ');
const add = (c: Counts, n: string, q: number) => {
  c[n] = (c[n] ?? 0) + q;
  if (c[n] <= 0) delete c[n];
};

// ---- storage ------------------------------------------------------------------------------------------------------------

/** The chest an item goes into: its group's (logs, cobblestone, sand, planks, glass), else the first misc, else the first. */
function chestFor(v: Any, item: string): Any {
  const cs = v.storage?.chests ?? [];
  const g = /_log$/.test(item) ? 'logs' : /_planks$/.test(item) ? 'planks' : item === 'cobblestone' ? 'cobblestone' : /^(red_)?sand$/.test(item) ? 'sand' : /^glass/.test(item) ? 'glass' : 'misc';
  return cs.find((c: Any) => c.group === g) ?? cs.find((c: Any) => c.group === 'misc') ?? cs[0];
}
export function put(v: Any, item: string, q: number) {
  if (q <= 0) return;
  const c = chestFor(v, item);
  if (c) c.items[item] = (c.items[item] ?? 0) + q;
}
/** Takes up to q of an item from the chests; returns what it took. */
export function take(v: Any, item: string, q: number): number {
  let got = 0;
  for (const c of v.storage?.chests ?? []) {
    const have = c.items[item] ?? 0;
    const t = Math.min(have, q - got);
    if (t <= 0) continue;
    c.items[item] = have - t;
    if (!c.items[item]) delete c.items[item];
    got += t;
    if (got >= q) break;
  }
  return got;
}

// ---- the crop store ----------------------------------------------------------------------------------------------------

interface Plant { x: number; y: number; z: number; block: string; max: number }
/**
 * Block states by cell for the crops the scanners read (stateAt through the fakes' getColumn). Growth by random ticks: a
 * block gets R x 20 x timeScale / 4096 a second (R = MC_RANDOM_TICK); a crop or stem ages one step with chance G (~1/6 on
 * hydrated rows: 7 steps in ~2.4 min at R 30, 2x, the RUNBOOK's first harvest); a ripe stem sets a fruit on an empty fruit
 * cell of its slot with chance G/2; cane grows a block every 16 random ticks, at most 3 tall.
 */
export class CropStore {
  cells = new Map<string, number>();
  plants: Plant[] = [];
  /** Fruit cells by slot key, and that slot's stems. */
  fruits: Array<{ cells: Array<[number, number]>; y: number; fruit: string; stems: Plant[] }> = [];
  canes: Array<{ x: number; y: number; z: number; h: number; age: number }> = [];
  constructor(private reg: Any, private rng: () => number, private ticksPerSec: number, private G = 1 / 6) {}
  key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  id(block: string, age = 0): number {
    const b = this.reg.blocksByName[block];
    return b ? b.minStateId + age : 0;
  }
  get(x: number, y: number, z: number): number {
    return this.cells.get(this.key(x, y, z)) ?? 0;
  }
  set(x: number, y: number, z: number, block: string | null, age = 0) {
    if (!block) this.cells.delete(this.key(x, y, z));
    else this.cells.set(this.key(x, y, z), this.id(block, age));
  }
  age(x: number, y: number, z: number, block: string): number {
    const b = this.reg.blocksByName[block];
    const s = this.get(x, y, z);
    return b && s >= b.minStateId && s <= b.maxStateId ? s - b.minStateId : -1;
  }
  plant(x: number, y: number, z: number, block: string, max: number, age = 0) {
    this.plants.push({ x, y, z, block, max });
    this.set(x, y, z, block, age);
  }
  /** The record's farms and slots, at random ages (a resumed world's state is not in the checkpoint). */
  seed(v: Any) {
    for (const lay of v.layouts ?? []) {
      const farm = lay.farm;
      const plot = farm && v.plots.find((p: Any) => farm.x1 >= p.x1 && farm.x2 <= p.x2 && farm.z1 >= p.z1 && farm.z2 <= p.z2);
      if (farm?.planted && plot) for (const [x, z] of (farm.sow ?? []).slice(0, farm.planted)) this.plant(x, plot.y + 1, z, 'wheat', 7, Math.floor(this.rng() * 8));
      for (const slot of lay.slots ?? []) {
        const spec = slot.kind ? SLOT_KINDS[slot.kind] : undefined;
        const sp = v.plots.find((p: Any) => slot.x1 >= p.x1 && slot.x2 <= p.x2 && slot.z1 >= p.z1 && slot.z2 <= p.z2);
        if (!spec || !slot.planted || !sp) continue;
        const y = sp.y + 1;
        if (spec.ripe !== undefined) for (const [x, z] of slot.cells ?? []) this.plant(x, y, z, spec.block, spec.ripe, Math.floor(this.rng() * (spec.ripe + 1)));
        else if (spec.fruit) {
          const stems: Plant[] = [];
          for (const [x, z] of slot.cells ?? []) {
            this.plant(x, y, z, spec.block, 7, 7);
            stems.push(this.plants[this.plants.length - 1]);
          }
          const cells = (slot.fruit ?? []) as Array<[number, number]>;
          for (const [x, z] of cells) if (this.rng() < 0.2) this.set(x, y, z, spec.fruit);
          this.fruits.push({ cells, y, fruit: spec.fruit, stems });
        } else
          for (const [x, z] of slot.cells ?? []) {
            const h = 1 + Math.floor(this.rng() * 3);
            this.canes.push({ x, y, z, h, age: 0 });
            for (let k = 0; k < 3; k++) this.set(x, y + k, z, k < h ? 'sugar_cane' : null);
          }
      }
    }
  }
  /** Random ticks over dt seconds. */
  grow(dt: number) {
    const lam = this.ticksPerSec * dt;
    const p = 1 - Math.exp(-lam * this.G);
    for (const q of this.plants) {
      const a = this.age(q.x, q.y, q.z, q.block);
      if (a < 0 || a >= q.max) continue;
      if (this.rng() < p) this.set(q.x, q.y, q.z, q.block, a + 1);
    }
    const pf = 1 - Math.exp((-lam * this.G) / 2);
    for (const f of this.fruits)
      for (const s of f.stems) {
        if (this.age(s.x, s.y, s.z, s.block) < 7 || this.rng() >= pf) continue;
        const free = f.cells.filter(([x, z]) => !this.get(x, f.y, z) && Math.abs(x - s.x) + Math.abs(z - s.z) <= 2);
        if (free.length) {
          const [x, z] = free[Math.floor(this.rng() * free.length)];
          this.set(x, f.y, z, f.fruit);
        }
      }
    for (const c of this.canes) {
      if (c.h >= 3) continue;
      c.age += lam;
      while (c.age >= 16 && c.h < 3) {
        c.age -= 16;
        this.set(c.x, c.y + c.h, c.z, 'sugar_cane');
        c.h++;
      }
    }
  }
}

// ---- eggs ---------------------------------------------------------------------------------------------------------------

/** Eggs laid in the chicken pens as item entities in the shared view (facts.eggs looks for items in a pen's inner area):
 *  a chicken lays every 5-10 game minutes. */
export class Eggs {
  n = 0;
  constructor(private entities: Record<string, Any>, private rng: () => number, private scale: number) {}
  pens(v: Any): Array<{ slot: Any; j: number; plot: Any }> {
    const lay0 = v.layouts?.[0];
    const plot = v.plots.find((p: Any) => p.annex);
    return (lay0?.slots ?? []).map((slot: Any, i: number) => ({ slot, j: i + 1, plot })).filter((p: Any) => p.plot && p.slot.kind === 'chicken' && p.slot.pen?.built);
  }
  lay(v: Any, dt: number) {
    for (const { slot, j, plot } of this.pens(v)) {
      const hens = slot.pen.animals ?? 0;
      const rate = (hens * this.scale) / 450;
      if (this.rng() >= 1 - Math.exp(-rate * dt)) continue;
      const P = penPlan(slot, slot.face ?? 'n');
      const x = P.inner.x1 + this.rng() * (P.inner.x2 - P.inner.x1 + 1), z = P.inner.z1 + this.rng() * (P.inner.z2 - P.inner.z1 + 1);
      this.entities[`egg${++this.n}`] = { name: 'item', pen: j, position: { x, y: plot.y + 1, z } };
    }
  }
  collect(j: number): number {
    let n = 0;
    for (const [k, e] of Object.entries(this.entities))
      if (e.name === 'item' && e.pen === j) {
        delete this.entities[k];
        n++;
      }
    return n;
  }
}

// ---- the effect models ------------------------------------------------------------------------------------------------

export interface Ctx {
  w: Any;
  v: Any;
  name: string;
  /** What the member carries (the sim's own inventory). */
  carry: Counts;
  crops: CropStore;
  eggs: Eggs;
  rng: () => number;
  now: number;
  /** What the reference's greens kept of their felled trees (prepare_green's yield). */
  greenKept?: Counts[];
  /** The reference's gathering loads, asked and deposited, by material. */
  tripLoads?: Record<string, Array<{ asked: number; got: number }>>;
}

const areaText = (a: Any) => `x ${a.x1}..${a.x2}, z ${a.z1}..${a.z2}`;
const TOOLS = /_(pickaxe|axe|shovel|hoe|sword)$|^(fishing_rod|shears|bucket|flint_and_steel)$/;

function deposit(args: Any, c: Ctx): Outcome {
  const names = [String(args.item ?? 'all'), ...String(args.also ?? '').split(',').filter(Boolean)];
  const out: Counts = {};
  const match = (n: string) => names.some((m) => m === 'all' ? !TOOLS.test(n) : m === n || (m === 'logs' && /_log$/.test(n)));
  for (const [n, q] of Object.entries(c.carry)) {
    if (!match(n) || q <= 0) continue;
    const t = args.count !== undefined && names.length === 1 && names[0] === n ? Math.min(q, Number(args.count)) : q;
    put(c.v, n, t);
    add(c.carry, n, -t);
    out[n] = t;
  }
  if (!Object.keys(out).length) {
    if (args.ifAny) return { ok: true, message: 'deposited 0 (nothing to put back)' };
    return { ok: false, message: `not carrying ${names[0]} (carrying ${list(c.carry) || 'nothing'})` };
  }
  return { ok: true, message: `deposited ${list(out)}. Storage now holds (simulated)` };
}

function withdraw(args: Any, c: Ctx): Outcome {
  const item = String(args.item), want = Number(args.count ?? 64);
  const got = take(c.v, item, want);
  if (!got) return { ok: false, message: `storage has no ${item}; it holds ${Object.keys(storageContents(c.v)).length} kinds of item` };
  add(c.carry, item, got);
  return { ok: true, message: `withdrew ${got} ${item}${got < want ? `; storage had only ${got} of the ${want} asked for` : ''}` };
}

/** A stone pickaxe's 132 uses, one a block mined (pooled as the rods: a worn one is replaced from storage). */
export const PICK_USES = 132;
let pickWear = 0;
function collect(args: Any, c: Ctx): Outcome {
  const block = String(args.block), want = Number(args.count ?? 1);
  // (a trip comes back short now and then: S.9's "only found" partials)
  const item = block === 'logs' ? `${c.v.catalogWood ?? c.v.wood ?? 'oak'}_log` : block === 'stone' ? 'cobblestone' : block;
  const mat = /_log$|^logs$/.test(item) ? 'logs' : item;
  const r = c.rng();
  // (a reference load for the material scaled to what was asked: whole trees bring more than asked; else a short trip now and then)
  const ref = c.tripLoads?.[mat];
  const pick = ref?.length ? ref[Math.floor(c.rng() * ref.length)] : null;
  const got = r < 0.04 ? 0 : pick ? Math.max(1, Math.round((want * pick.got) / pick.asked)) : r < 0.12 ? Math.max(1, Math.floor(want * (0.3 + 0.5 * c.rng()))) : want;
  if (!got) return { ok: false, message: `could not reach ${block}: no path (simulated)` };
  if (item === 'cobblestone')
    for (pickWear += got; pickWear >= PICK_USES; pickWear -= PICK_USES) take(c.v, 'stone_pickaxe', 1);
  add(c.carry, item, got);
  if (got < want && !pick) return { ok: false, message: `only found ${got} ${block}; none left within reach (simulated)` };
  return { ok: true, message: `collected ${got} ${block}` };
}

function harvestFarm(args: Any, c: Ctx): Outcome {
  const v = c.v, k = Number(args.layout), farm = v.layouts?.[k - 1]?.farm;
  if (!farm) return { ok: false, message: `harvest_farm: layout ${k} has no farm` };
  const plot = v.plots.find((p: Any) => farm.x1 >= p.x1 && farm.x2 <= p.x2 && farm.z1 >= p.z1 && farm.z2 <= p.z2);
  if (!plot) return { ok: false, message: `harvest_farm: layout ${k}'s farm is not on a prepared plot` };
  const y = plot.y + 1;
  const ripe = (farm.sow ?? []).filter(([x, z]: [number, number]) => c.crops.age(x, y, z, 'wheat') === 7);
  if (!ripe.length) {
    farm.lastHarvest = { at: c.now, ok: false, why: 'nothing ripe' };
    return { ok: true, message: `nothing ripe on the farm at ${areaText(farm)}` };
  }
  const wheat = ripe.length;
  let seeds = 0;
  for (let i = 0; i < wheat; i++) seeds += 1 + Math.floor(c.rng() * 4) - (c.rng() < 0.5 ? 1 : 0) + 1;
  for (const [x, z] of ripe) c.crops.set(x, y, z, 'wheat', 0);
  const charged = Math.min(seeds, wheat);
  const store = storageContents(v);
  const keep = Math.max(0, wheatKeep(v) - (store.wheat ?? 0));
  const bread = Math.max(0, Math.floor((wheat - keep) / 3));
  noteFood(v, 'made', { wheat, wheat_seeds: seeds - charged });
  if (bread) noteFood(v, 'made', { bread });
  put(v, 'wheat', wheat - bread * 3);
  put(v, 'wheat_seeds', seeds - charged);
  put(v, 'bread', bread);
  farm.harvests = (farm.harvests ?? 0) + 1;
  farm.bread = (farm.bread ?? 0) + bread;
  farm.lastHarvest = { at: c.now, ok: true };
  return { ok: true, message: `harvested ${wheat} ripe wheat at ${areaText(farm)} (${wheat} wheat, ${seeds} seeds), sowed ${charged} again, baked ${bread} bread into the village storage` };
}

function harvestSlot(args: Any, c: Ctx): Outcome {
  const v = c.v, k = Number(args.layout), j = Number(args.slot);
  const slot = v.layouts?.[k - 1]?.slots?.[j - 1];
  const spec = slot?.kind ? SLOT_KINDS[slot.kind] : undefined;
  if (!slot || !spec || !slot.planted) return { ok: false, message: `harvest_slot: farm slot ${j} holds no farm yet` };
  const plot = v.plots.find((p: Any) => slot.x1 >= p.x1 && slot.x2 <= p.x2 && slot.z1 >= p.z1 && slot.z2 <= p.z2);
  const y = (plot?.y ?? 64) + 1;
  const got: Counts = {};
  let taken = 0;
  if (spec.ripe !== undefined) {
    for (const [x, z] of slot.cells ?? []) {
      if (c.crops.age(x, y, z, spec.block) !== spec.ripe) continue;
      taken++;
      c.crops.set(x, y, z, spec.block, 0);
      if (slot.kind === 'beetroots') {
        add(got, 'beetroot', 1);
        add(got, 'beetroot_seeds', Math.floor(c.rng() * 4));
      } else add(got, spec.take, 2 + Math.floor(c.rng() * 4) - 1);
    }
  } else if (spec.fruit) {
    for (const [x, z] of slot.fruit ?? []) {
      if (c.crops.get(x, y, z) !== c.crops.id(spec.fruit)) continue;
      taken++;
      c.crops.set(x, y, z, null);
      add(got, spec.take, spec.fruit === 'melon' ? 3 + Math.floor(c.rng() * 5) : 1);
    }
  } else
    for (const cane of c.crops.canes.filter((q) => (slot.cells ?? []).some(([x, z]: [number, number]) => x === q.x && z === q.z))) {
      const n = cane.h - 1;
      if (n <= 0) continue;
      taken += n;
      for (let h = 1; h < cane.h; h++) c.crops.set(cane.x, cane.y + h, cane.z, null);
      cane.h = 1;
      cane.age = 0;
      add(got, 'sugar_cane', n);
    }
  if (!taken) {
    slot.lastHarvest = { at: c.now, ok: false, why: 'nothing ripe' };
    return { ok: true, message: `nothing ripe on the ${slot.kind} farm at ${areaText(slot)}` };
  }
  noteFood(v, 'made', got);
  for (const [n, q] of Object.entries(got)) put(v, n, q);
  slot.harvests = (slot.harvests ?? 0) + 1;
  slot.lastHarvest = { at: c.now, ok: true };
  return { ok: true, message: `harvested ${taken} ${slot.kind} at ${areaText(slot)} into the village storage` };
}

function eatMeal(_args: Any, c: Ctx): Outcome {
  const v = c.v, e = v.food?.members?.[c.name];
  try {
    if (!e) return { ok: false, message: 'eat_meal: the village keeps no appetite for you' };
    const meal = chooseMeal(e.level, storeForMeals(v.name, storageContents(v), c.name));
    if (!meal) return { ok: false, message: 'eat_meal: nothing to eat in the village storage (other members took it)', code: 'taken' };
    const took = take(v, meal.item, meal.n);
    if (!took) return { ok: false, message: 'eat_meal: nothing to eat in the village storage (other members took it)', code: 'taken' };
    const before = e.level;
    e.level = Math.min(APPETITE.cap, e.level + took * (FOOD_POINTS[meal.item] ?? 0));
    e.meals = (e.meals ?? 0) + 1;
    e.lastMeal = { at: c.now, item: meal.item, n: took };
    v.food.eaten[meal.item] = (v.food.eaten[meal.item] ?? 0) + took;
    v.food.meals = (v.food.meals ?? 0) + 1;
    return { ok: true, message: `ate ${took} ${meal.item} from the village storage (appetite ${Math.round(before)} -> ${Math.round(e.level)} of 20)` };
  } finally {
    releaseMeal(v.name, c.name);
  }
}

function make(args: Any, c: Ctx): Outcome {
  const v = c.v, w = c.w, item = String(args.item);
  const hk = holdKey(v.name, c.name);
  // (the earmark is this member's own; the skill releases it once it has withdrawn)
  const mine = makeHolds.get(hk);
  holdsDelete(hk);
  const good = w.goodsFor(v).find((g: Any) => g.item === item);
  if (!good) return { ok: false, message: `make: ${item} is not a good the workshop keeps now`, code: 'gone' };
  const inputs: Counts = mine ?? {};
  for (const [n, q] of Object.entries(inputs))
    if ((storageContents(v)[n] ?? 0) < q) return { ok: false, message: `make: another agent took the ${n} (got ${storageContents(v)[n] ?? 0} of ${q}); what was withdrawn went back`, code: 'taken' };
  for (const [n, q] of Object.entries(inputs)) take(v, n, q);
  const count = Number(args.count);
  if (good.food) noteFood(v, 'made', { [item]: count });
  put(v, item, count);
  return { ok: true, message: `made ${count} ${item} (simulated); put into storage: ${count} ${item}` };
}

function putUpTorches(args: Any, c: Ctx): Outcome {
  const v = c.v, part = String(args.part);
  holdsDelete(holdKey(v.name, c.name));
  const P = c.w.lightParts(v).find((q: Any) => q.part === part);
  if (!P) return { ok: false, message: `put_up_torches: the village has no part ${part} to light` };
  const r = (v.lights ??= {})[part] ?? { done: [] };
  const open = P.spots.map((q: Any) => `${q.x},${q.y},${q.z}`).filter((k: string) => !r.done.includes(k) && !r.never?.includes(k));
  if (!open.length) return { ok: false, message: `put_up_torches: nothing unlit in the ${P.label} (another lighter was first)`, code: 'taken' };
  const n = take(v, 'torch', Math.min(Number(args.count), open.length));
  if (!n) return { ok: false, message: 'put_up_torches: no torches in storage (another agent took them)', code: 'taken' };
  r.done = [...r.done, ...open.slice(0, n)];
  r.at = c.now;
  r.by = c.name;
  v.lights[part] = r;
  return { ok: true, message: `lit ${n} torch spot${n === 1 ? '' : 's'} in the ${P.label} (${r.done.length} of ${P.spots.length} lit)` };
}

function furnish(args: Any, c: Ctx): Outcome {
  const v = c.v, part = String(args.part);
  holdsDelete(holdKey(v.name, c.name));
  const P = c.w.decorParts(v).find((q: Any) => q.part === part);
  if (!P) return { ok: false, message: `furnish: the village has no building ${part} to furnish` };
  if (!P.open.length) return { ok: false, message: `furnish: nothing open in the ${P.label} (another furnisher was first)`, code: 'taken' };
  const r = (v.decor ??= {})[part] ?? { done: [] };
  let fitted = 0;
  for (const q of P.open.slice(0, Number(args.count))) {
    const store = storageContents(v);
    if (!(store[q.item] > 0) || (q.also && !(store[q.also.item] > 0))) continue;
    take(v, q.item, 1);
    if (q.also) take(v, q.also.item, 1);
    r.done.push(`${q.x},${q.y},${q.z}`);
    fitted++;
  }
  r.at = c.now;
  r.by = c.name;
  v.decor[part] = r;
  const standing = P.spots.filter((q: Any) => r.done.includes(`${q.x},${q.y},${q.z}`)).length;
  return { ok: true, message: `furnished ${fitted} of ${Math.min(P.open.length, Number(args.count))} spots in the ${P.label} (${standing} of ${P.spots.length} in place${fitted ? '' : '; no progress'})` };
}

function collectEggs(args: Any, c: Ctx): Outcome {
  const v = c.v, j = Number(args.slot);
  const pen = v.layouts?.[0]?.slots?.[j - 1]?.pen;
  if (!pen?.built) return { ok: false, message: `collect_eggs: annex slot ${j} holds no chicken pen` };
  const n = c.eggs.collect(j);
  pen.eggsAt = c.now;
  if (!n) return { ok: true, message: `no eggs in the chicken pen on annex slot ${j}` };
  pen.eggs = (pen.eggs ?? 0) + n;
  noteFood(v, 'made', { egg: n });
  put(v, 'egg', n);
  return { ok: true, message: `collected ${n} egg from the chicken pen on annex slot ${j}` };
}

function buildDesign(args: Any, c: Ctx): Outcome {
  const v = c.v, d = v.designs?.[String(args.design)];
  if (!d) return { ok: false, message: `no design called "${args.design}"` };
  const x = Number(args.x), z = Number(args.z);
  const x1 = x - Math.floor(d.width / 2), z1 = z - Math.floor(d.depth / 2);
  const st = { x1, z1, x2: x1 + d.width - 1, z2: z1 + d.depth - 1 };
  const old = v.structures.find((s: Any) => s.kind === d.name && x >= s.x1 && x <= s.x2 && z >= s.z1 && z <= s.z2);
  if (old) return { ok: true, message: `a ${d.name} built by ${old.builtBy} already stands at ${areaText(old)}, so this is already done` };
  // The bill from storage (what the plan takes from stock; any:logs and the like as the planner resolves them)
  const wood = c.w.catalogWoodOf(v);
  const p = c.w.materials.plan(inWood(designBill(d), wood), storageContents(v));
  const short = Object.entries(p.gather ?? {}).filter(([, q]) => (q as number) > 0);
  if (short.length) return { ok: false, message: `ran out of ${short[0][0]} after placing 0 blocks; still needed: ${short.map(([n, q]) => `${q} ${n}`).join(', ')}. Get them, then run the same build again: it continues where it stopped` };
  const used: Counts = {};
  for (const [n, q] of Object.entries(p.fromStock ?? {})) used[n] = take(v, n, q as number);
  const plot = v.plots.find((q: Any) => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2) ?? v.plots.find((q: Any) => q.green);
  v.structures.push({ ...st, y: plot?.y ?? v.plots[0]?.y ?? 64, kind: d.name, id: `sim${v.structures.length + 1}`, builtBy: c.name });
  const placed = Object.values(designBill(d)).reduce((s: number, q) => s + (q as number), 0);
  return { ok: true, message: `${d.name} recorded in village ${v.name} at ${areaText(st)}; placed ${placed} blocks, cleared 0; used ${list(used)}` };
}

function prepareGreen(args: Any, c: Ctx): Outcome {
  const v = c.v, S = Number(args.size ?? 15);
  const east = Math.max(...v.plots.map((p: Any) => p.x2), ...(v.layouts ?? []).map((l: Any) => l.x2 ?? -1e9)) + 8;
  const y = v.plots[0]?.y ?? 64, z0 = v.plots[0]?.z1 ?? 0;
  v.plots.push({ id: `simp${v.plots.length + 1}`, x1: east, z1: z0, x2: east + S - 1, z2: z0 + S - 1, y, preparedBy: c.name, green: String(args.initiative) });
  // (the felled trees' logs go into storage: a reference green's, else 50 of the village's wood)
  const kept = c.greenKept?.length ? c.greenKept[Math.floor(c.rng() * c.greenKept.length)] : { [`${v.catalogWood ?? v.wood ?? 'oak'}_log`]: 50 };
  for (const [n, q] of Object.entries(kept)) put(v, n, q);
  return { ok: true, message: `plot ready: ${S}x${S} at x ${east}..${east + S - 1} (simulated); placed 0 blocks, cleared 0; kept ${list(kept)} from the felled trees` };
}

/** A fishing rod's wear: 64 uses, one a catch (rods are pooled in storage: the wear follows whichever is taken, v0). */
export const ROD_USES = 64;
let rodWear = 0;
function fish(args: Any, c: Ctx): Outcome {
  if (!(c.carry.fishing_rod > 0)) return { ok: false, message: 'no fishing rod: withdraw one from storage, or craft one from 3 sticks and 2 string (string comes from cobwebs)' };
  const want = Math.min(8, Number(args.count ?? 8));
  const got: Counts = {};
  let fishN = 0, other = 0;
  let broke = false;
  for (let i = 0; i < want; i++) {
    if (++rodWear >= ROD_USES) {
      rodWear = 0;
      broke = true;
      break;
    }
    const r = c.rng();
    if (r < 0.1) {
      add(got, ['leather_boots', 'stick', 'bowl', 'lily_pad', 'ink_sac'][Math.floor(c.rng() * 5)], 1);
      other++;
      continue;
    }
    fishN++;
    const f = c.rng();
    add(got, f < 0.6 ? 'cod' : f < 0.85 ? 'salmon' : f < 0.98 ? 'pufferfish' : 'tropical_fish', 1);
  }
  for (const [n, q] of Object.entries(got)) add(c.carry, n, q);
  if (broke) {
    add(c.carry, 'fishing_rod', -1);
    return { ok: false, message: `the fishing rod broke at the water after ${fishN + other + 1} casts: withdraw another from storage or craft another from 3 sticks and 2 string` };
  }
  return { ok: true, message: `caught ${fishN} fish (${got.cod ?? 0} cod, ${got.salmon ?? 0} salmon, ${got.pufferfish ?? 0} pufferfish, ${got.tropical_fish ?? 0} tropical fish) and ${other} other items in ${want + 2} casts (simulated)` };
}

function trade(args: Any, c: Ctx): Outcome {
  const v = c.v, item = String(args.item), times = Number(args.times ?? 1);
  if (!v.merchant) return { ok: false, message: 'no merchant in this village: a market stall must stand first' };
  const dir = args.dir === 'sell' ? 'buys' : 'sells';
  const index = OFFERS.findIndex((o) => o.item === item && o.dir === dir);
  const o = OFFERS[index];
  if (!o) return { ok: false, message: `the merchant does not ${args.dir} ${item}` };
  const left = o.stock - (v.merchant.uses[index] ?? 0);
  if (left < times) return { ok: false, message: `the merchant has only ${left} left of that offer until its restock` };
  const input = dir === 'buys' ? item : 'emerald', need = dir === 'buys' ? o.n * times : o.emeralds * times;
  if ((c.carry[input] ?? 0) < need) return { ok: false, message: `has ${c.carry[input] ?? 0} ${input}, the trade takes ${need}: withdraw more from storage` };
  add(c.carry, input, -need);
  add(c.carry, dir === 'buys' ? 'emerald' : item, dir === 'buys' ? o.emeralds * times : o.n * times);
  void c.w.merchantTraded(v, index, times, c.name);
  return { ok: true, message: `traded with the merchant: ${dir === 'buys' ? 'sold' : 'bought'} ${o.n * times} ${item} for ${o.emeralds * times} emerald (stock left ${left - times})` };
}

export const MODELS: Record<string, (args: Any, c: Ctx) => Outcome> = {
  deposit, withdraw, collect, harvest_farm: harvestFarm, harvest_slot: harvestSlot, eat_meal: eatMeal, make,
  put_up_torches: putUpTorches, furnish, collect_eggs: collectEggs, build_design: buildDesign, prepare_green: prepareGreen, fish, trade,
};
