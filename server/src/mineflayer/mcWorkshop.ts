/**
 * The workshop (S.9): what a complete village's idle members make into storage once the buildings stand, what they gather
 * for it, and the works plot's furnaces. World-free data and bookkeeping shared by the world's menu (mcWorld.ts: the make,
 * gather and works families), the skills (mcBuild.ts make, prepare_works, place_works_furnace) and the offline checks
 * (scripts/checks/workshop_check.mts, choice_golden.mts). Code does the arithmetic (targets, batches, bills, earmarks);
 * the model, in model mode, only chooses among what code found feasible (lesson 1).
 */
import type minecraftData from 'minecraft-data';
import type { Counts, MaterialPlan } from './mcMaterials';

type Registry = ReturnType<typeof minecraftData>;

/**
 * A good the workshop keeps in stock: `target` in storage, made `batch` at a time in whole `unit`s (a recipe's output: 4
 * torches a craft, 16 panes); `words` name it in menus ("Make stone pickaxes"), `forWhat` says what it is for (lesson 127).
 * `variant`: one wood kind's slabs (and planks) make it, so its bill depends on the stock (makeBill, the check's H2).
 */
export interface MakeGood { item: string; target: number; batch: number; unit: number; words: string; forWhat: string; variant?: 'slabs' }

/** The goods, in this order on ties (spec 4.4; mud bricks, chests and the stone axe, shovel and sword cut, D11). */
export const MAKE_GOODS: MakeGood[] = [
  { item: 'stone_pickaxe', target: 4, batch: 4, unit: 1, words: 'stone pickaxes', forWhat: 'a miner without a pickaxe takes a stone one from storage instead of the village\'s cobblestone' },
  { item: 'stone_hoe', target: 2, batch: 2, unit: 1, words: 'stone hoes', forWhat: 'a farm start or the field\'s tilling takes a hoe from storage instead of making one' },
  { item: 'wooden_sword', target: 2, batch: 2, unit: 1, words: 'wooden swords', forWhat: 'a sword is what takes string from cobwebs (the string trip comes later)' },
  { item: 'charcoal', target: 8, batch: 8, unit: 1, words: 'charcoal', forWhat: 'furnace fuel, 8 smelts each (planks burn otherwise), and torches' },
  { item: 'torch', target: 32, batch: 16, unit: 4, words: 'torches', forWhat: 'light for the mine and the houses later; the street lamps are lit already' },
  { item: 'glass', target: 16, batch: 8, unit: 1, words: 'glass', forWhat: 'windows for later buildings' },
  { item: 'glass_pane', target: 16, batch: 16, unit: 16, words: 'glass panes', forWhat: 'windows for later buildings' },
  { item: 'glass_bottle', target: 3, batch: 3, unit: 3, words: 'glass bottles', forWhat: 'filled with water, it turns dirt into mud (later)' },
  { item: 'barrel', target: 2, batch: 1, unit: 1, words: 'barrels', forWhat: 'a storage block for the works plot; nothing places it yet', variant: 'slabs' },
  { item: 'smooth_stone', target: 8, batch: 8, unit: 1, words: 'smooth stone', forWhat: '3 make a blast furnace for ores (S.11)' },
  { item: 'stone_bricks', target: 32, batch: 16, unit: 4, words: 'stone bricks', forWhat: 'a stone brick stock for later buildings and the works' },
  { item: 'composter', target: 1, batch: 1, unit: 1, words: 'composters', forWhat: 'turns crops into bone meal (white dye, growth) once placed (later)', variant: 'slabs' },
  { item: 'ladder', target: 12, batch: 6, unit: 3, words: 'ladders', forWhat: 'ladders for the deep mine (later)' },
];

/**
 * Kept back from make (spec 4.5): cobblestone for a furnace's 8 and two miners' pickaxes made on the spot, coal for the
 * iron tools' smelting; logs (the village's kind) are 10 for each annex pen slot without a built pen plus 4 (a pen ring is
 * 10 logs charged from storage, a new storage chest 3, a hoe on the spot), computed per village by the world (logsKeep).
 */
export const MAKE_KEEP = { cobblestone: 14, coal: 2, logsBase: 4, logsPerPen: 10 };

/** Never an input of a make (pens, breeding, milking, the cake, bread and the iron age use them; no good's bill does). */
export const MAKE_NEVER: ReadonlySet<string> = new Set(['wheat', 'wheat_seeds', 'raw_iron', 'iron_ingot', 'bucket', 'milk_bucket', 'egg', 'brown_egg', 'blue_egg', 'sugar', 'sugar_cane', 'cake', 'bread']);

/** Crafting makes going at once in a village (they share the hut's table and its aisle; smelting makes go by furnace). */
export const MAKE_PARALLEL = Number(process.env.MC_MAKE_PARALLEL ?? 4);

/** What gathering for the workshop brings in (spec 4.8; no coal: the cobblestone mine is stone only, D9). */
export type Material = 'sand' | 'logs' | 'cobblestone';

/**
 * Per material: how many may gather it at once ('faces': as many as the mine has free faces, S.2's gate), the most one
 * trip brings, collect's block and deposit's item (`wood`: the village's kind), what it is for (the facts), and the menu
 * name (`words`, the whole option name, as the spec's section 4.8 gives it).
 */
export const GATHER_KINDS: Record<Material, { atOnce: number | 'faces'; trip: number; block: (wood?: string) => string; deposit: (wood?: string) => string; forWhat: string; words: string }> = {
  // (open shore sand only, lesson 69)
  sand: { atOnce: 2, trip: 16, block: () => 'sand', deposit: () => 'sand', forWhat: 'glass for windows, panes and bottles', words: 'Gather sand for the workshop' },
  // (whole trees off every village's ground, leafless logs passed over: lessons 30, 47)
  logs: { atOnce: 3, trip: 12, block: (wood) => (wood ? `${wood}_log` : 'logs'), deposit: () => 'logs', forWhat: 'charcoal, torches, the furnaces\' fuel and the pens\' fences', words: 'Fell trees for the workshop' },
  // (in the village mine, one miner a unit)
  cobblestone: { atOnce: 'faces', trip: 32, block: () => 'cobblestone', deposit: () => 'cobblestone', forWhat: 'stone tools, stone bricks, smooth stone and the works furnaces', words: 'Mine cobblestone for the workshop' },
};

/** What a gathering trip deposits by name beside its material, when it picked some up by the way (lesson 112: the mine's
 *  coal and raw iron; S.9's review, lens 4 L3). */
export const GATHER_ALSO = 'coal,raw_iron';

/** Logs gathering for the workshop may bring a village in an hour (counted with what is on the way). */
export const GATHER_LOGS_HOUR = Number(process.env.MC_GATHER_LOGS_HOUR ?? 96);

/** Furnaces on the works plot (k 1-3; k 0 is the storage hut's). */
export const WORKS_FURNACES = 3;
/** The works plot's farthest cell from the hut's crafting table: a craft after a smelt there still finds the hut's table
 *  (villageStation looks 64 blocks, the check's L6). */
export const WORKS_TABLE_RANGE = 48;

// ---------------------------------------------------------------------------------------------
// Earmarks, leftovers, the works plot under way
// ---------------------------------------------------------------------------------------------

const holds = new Map<string, Counts>();
let holdsVer = 0;

/**
 * Earmarks (D6), "village|agent" -> what a queued make or furnace placement will withdraw: storage changes only when it
 * withdraws, 0.3-3 min after the queueing (lesson 111), so other agents' plans leave these out until then.
 */
export const makeHolds: ReadonlyMap<string, Counts> = holds;

export function holdsSet(key: string, c: Counts): void {
  holds.set(key, { ...c });
  holdsVer++;
}

export function holdsDelete(key: string): void {
  if (holds.delete(key)) holdsVer++;
}

/**
 * A skill's own end of its earmark: deleted only while it is still `mine`, the entry the skill read at its start (makeHolds
 * .get). A stopped make's finally can run after the agent's next chore set its own under the same key (S.9's review, lens
 * 1 L1, lens 2 L5); the world's endChoice deletes by key, before any next chore is set.
 */
export function holdsRelease(key: string, mine: Counts | undefined): void {
  if (mine && holds.get(key) === mine) holdsDelete(key);
}

/** Bumped by every change of the earmarks (the menu's plans are cached on it). */
export function holdsVersion(): number {
  return holdsVer;
}

export const holdKey = (village: string, agent: string) => `${village}|${agent.toLowerCase()}`;

/** What a stopped make left in an agent's hands, "village|agent": the world has it deposited (spec 4.10). */
export const makeLeft = new Map<string, Counts>();

/** Villages preparing their works plot (as annexBusy). */
export const worksBusy = new Set<string>();

// ---------------------------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------------------------

/** A recipe's ingredients by name and its output count (minecraft-data lists one recipe per variant). */
function recipes(registry: Registry, item: string): Array<{ ins: Counts; out: number }> {
  const it = registry.itemsByName[item];
  const rs = (it && (registry.recipes as Record<number, any[]>)[it.id]) || [];
  return rs.map((r) => {
    const ids: unknown[] = r.inShape ? r.inShape.flat() : (r.ingredients ?? []);
    const ins: Counts = {};
    for (const raw of ids) {
      const id = raw && typeof raw === 'object' ? (raw as { id: number }).id : (raw as number | null | undefined);
      if (id === null || id === undefined || id < 0) continue;
      const n = registry.items[id]?.name;
      if (n) ins[n] = (ins[n] ?? 0) + 1;
    }
    return { ins, out: r.result?.count ?? 1 };
  });
}

/** The variant recipe made of one wood kind only (`oak` takes oak_planks and oak_slab, never dark_oak's). */
function kindRecipe(registry: Registry, item: string, kind: string): { ins: Counts; out: number } | undefined {
  return recipes(registry, item).find((r) => {
    const names = Object.keys(r.ins);
    return names.length > 0 && names.every((n) => n === `${kind}_planks` || n === `${kind}_slab`);
  });
}

const feasibleIn = (plan: (b: Counts, have: Counts) => MaterialPlan, bill: Counts, stock: Counts) => {
  const p = plan(bill, stock);
  return !Object.keys(p.gather).length && !p.problems.length;
};

/**
 * A batch's bill. Plain goods: { [item]: count }, `feasible` when it plans from `stock` with nothing to gather. `variant`
 * goods (barrel, composter): the first wood kind, in the order kinds whose `<kind>_slab` is in `stock` (most first) then
 * `wood`, whose recipe's ingredients times its runs plan with no gather against `stock` (a kind chosen by its slabs alone
 * made an oak barrel gather oak logs in a birch village, the check's H2); with none feasible, the bill in `wood` (for
 * gathering's demand), `feasible` false. `craft`: the final craft (item, count, kind). null: no recipe for the good.
 */
export function makeBill(registry: Registry, plan: (b: Counts, have: Counts) => MaterialPlan, good: MakeGood, count: number, stock: Counts, wood?: string):
  { bill: Counts; craft?: { item: string; count: number; wood: string }; feasible: boolean } | null {
  if (count <= 0) return null;
  if (!good.variant) {
    if (!registry.itemsByName[good.item]) return null;
    const bill = { [good.item]: count };
    return { bill, feasible: feasibleIn(plan, bill, stock) };
  }
  const slabKinds = Object.entries(stock)
    .filter(([n, q]) => q > 0 && n.endsWith('_slab'))
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => n.slice(0, -'_slab'.length));
  const kinds = [...new Set([...slabKinds, ...(wood ? [wood] : [])])];
  const billIn = (kind: string) => {
    const r = kindRecipe(registry, good.item, kind);
    if (!r) return null;
    const runs = Math.ceil(count / r.out);
    const bill: Counts = {};
    for (const [n, q] of Object.entries(r.ins)) bill[n] = q * runs;
    return { bill, craft: { item: good.item, count, wood: kind } };
  };
  for (const kind of kinds) {
    // (non-wood slabs, stone_slab and the like, have no such recipe)
    const b = billIn(kind);
    if (b && feasibleIn(plan, b.bill, stock)) return { ...b, feasible: true };
  }
  const fallback = billIn(wood ?? 'oak');
  return fallback ? { ...fallback, feasible: false } : null;
}
