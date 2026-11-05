/**
 * The workshop (S.9): what a complete village's idle members make into storage once the buildings stand, what they gather
 * for it, and the works plot's furnaces. World-free data and bookkeeping shared by the world's menu (mcWorld.ts: the make,
 * gather and works families; B.4's light), the skills (mcBuild.ts make, prepare_works, place_works_furnace,
 * put_up_torches) and the offline checks (scripts/checks/workshop_check.mts, choice_golden.mts, light_check.mts). Code does the arithmetic (targets, batches, bills, earmarks);
 * the model, in model mode, only chooses among what code found feasible (lesson 1).
 */
import type minecraftData from 'minecraft-data';
import type { Counts, MaterialPlan } from './mcMaterials';
import { rawSetting } from '../settings';
import { STRING } from '../supply';

type Registry = ReturnType<typeof minecraftData>;

/**
 * A good the workshop keeps in stock: `target` in storage, made `batch` at a time in whole `unit`s (a recipe's output: 4
 * torches a craft, 16 panes); `words` name it in menus ("Make stone pickaxes"), `forWhat` says what it is for (lesson 127).
 * `variant`: one wood kind's slabs (and planks) make it, so its bill depends on the stock (makeBill, the check's H2).
 */
export interface MakeGood { item: string; target: number; batch: number; unit: number; words: string; forWhat: string; variant?: 'slabs';
  /** s30's food step: food for the appetite (its target follows the members, 0 where the village keeps no appetite), and the
   *  items of MAKE_NEVER it may take (beyond the keeps the world applies: the cake's, a breeding's, a farm start's). */
  food?: true; allow?: string[];
  /** X.1's catalogue: a good of one wood kind (birch doors), planned only from that kind's logs and planks (a plan from
   *  "any logs" took oak logs for birch planks and the craft failed, the critique's 2). */
  wood?: string;
  /** s44's innovation: a pumpkin carved with shears (no recipe in the data): its inputs the pumpkins, shears in storage;
   *  the make carves by command. */
  carve?: true;
  /** G8's rung goods (#21): made for the ladder's current rung, targets from its stages (the world's makeTarget), never a
   *  merchant order. */
  rung?: 'letters';
  /** Survival (c)'s arms (MC_ARMS, mob modes only): targets from the members (the world's makeTarget), 0 elsewhere. */
  arms?: true }

/**
 * #21 (MC_LETTERS): the age of letters' goods, while letters is the current rung (spec 9 S4): books for the library (cane
 * made into paper at the table in the same make), bookshelves for its 4 shelf cells and the lectern's, the lectern. Their
 * targets are the world's; the wood goods take the village's catalogue wood, the lectern its slabs as the barrel does
 * (the planner took cherry slabs otherwise, spec 1.3).
 */
export const LETTERS_GOODS: MakeGood[] = [
  { item: 'book', target: 0, batch: 4, unit: 1, words: 'books', forWhat: 'books for the library\'s shelves and lectern (the age of letters)', allow: ['sugar_cane'], rung: 'letters' },
  { item: 'bookshelf', target: 0, batch: 1, unit: 1, words: 'bookshelves', forWhat: 'shelves for the library (the age of letters)', rung: 'letters' },
  { item: 'lectern', target: 0, batch: 1, unit: 1, words: 'a lectern', forWhat: 'the library\'s lectern (the age of letters)', variant: 'slabs', rung: 'letters' },
];

/** The goods, in this order on ties (spec 4.4; mud bricks, chests and the stone axe, shovel and sword cut, D11). */
export const MAKE_GOODS: MakeGood[] = [
  { item: 'stone_pickaxe', target: 4, batch: 4, unit: 1, words: 'stone pickaxes', forWhat: 'a miner without a pickaxe takes a stone one from storage instead of the village\'s cobblestone' },
  { item: 'stone_hoe', target: 2, batch: 2, unit: 1, words: 'stone hoes', forWhat: 'a farm start or the field\'s tilling takes a hoe from storage instead of making one' },
  { item: 'wooden_sword', target: 2, batch: 2, unit: 1, words: 'wooden swords', forWhat: STRING ? 'a sword is what takes string from cobwebs on the string trip' : 'a sword is what takes string from cobwebs (the string trip comes later)' },
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
 * Survival stage (c) (spec runs/2026-10-31/survival/spec_c.md 5): swords and armour, made only in a world with monsters
 * (MC_WORLD_MODE=hostile or normal, MC_ARMS; the world adds them to a village's goods and sets the targets: the stone
 * sword half the members, the rest as here). Iron goods may take iron ingots, which make keeps back otherwise.
 */
const NIGHT_FACT = 'zombies and skeletons come at night on unlit ground: a member with a sword fights back, one without runs to the storage hut';
export const ARMS_GOODS: MakeGood[] = [
  { item: 'stone_sword', target: 0, batch: 2, unit: 1, words: 'stone swords', forWhat: `${NIGHT_FACT}; members take one from storage at dusk`, arms: true },
  { item: 'iron_sword', target: 2, batch: 1, unit: 1, words: 'iron swords', forWhat: `${NIGHT_FACT}; an iron sword kills a zombie in 3 hits, a stone one in 4`, allow: ['iron_ingot'], arms: true },
  { item: 'leather_chestplate', target: 2, batch: 1, unit: 1, words: 'leather tunics', forWhat: 'armour takes hits for its wearer; members put it on at dusk', arms: true },
  { item: 'iron_helmet', target: 1, batch: 1, unit: 1, words: 'iron helmets', forWhat: 'armour takes hits for its wearer; members put it on at dusk', allow: ['iron_ingot'], arms: true },
  { item: 'iron_chestplate', target: 1, batch: 1, unit: 1, words: 'iron chestplates', forWhat: 'armour takes hits for its wearer (iron the most); members put it on at dusk', allow: ['iron_ingot'], arms: true },
];

/**
 * #178 (MC_STRING): fishing rods from the string trip's string, beside MAKE_GOODS (whose goods take only easy materials:
 * this one is made only while storage holds the string; the world adds it to a village's goods).
 */
export const ROD_GOOD: MakeGood = { item: 'fishing_rod', target: 3, batch: 1, unit: 1, words: 'fishing rods', forWhat: 'a fishing trip takes a rod from storage (two string from cobwebs and three sticks); rods wear out' };

/** #217 step 6 (MC_BOWS): bows and arrows for the watch and the hunt, made only while storage holds their string, flint and feathers. */
export const BOW_GOODS: MakeGood[] = [
  { item: 'bow', target: 4, batch: 1, unit: 1, words: 'bows', forWhat: 'the night watch and the hunt shoot monsters from range with them, creepers too (three string from the hunt\'s spiders, three sticks)', arms: true },
  { item: 'arrow', target: 64, batch: 4, unit: 4, words: 'arrows', forWhat: 'a watcher or hunter takes 16 with a bow (flint, a stick and a feather make 4; feathers from the chicken pen)', arms: true },
];

/** Survival (d) spec 4 (MC_HUNT): goods of the hunt's drops, made only while storage holds them (the world adds them). */
export const HUNT_GOODS: MakeGood[] = [
  { ...ROD_GOOD, forWhat: 'a fishing trip takes a rod from storage (two string, from the spiders the night hunt kills, and three sticks); rods wear out' },
  { item: 'bone_meal', target: 6, batch: 6, unit: 3, words: 'bone meal', forWhat: 'from the bones the night hunt brings in: the dye bed grows its flowers with it, and it makes white dye' },
];

/**
 * Food goods (s30's food step, D13): made only in a village with an appetite (the world's makeTarget: bread two a member,
 * pies one for two; 0 otherwise), so the workshop's goods, menus and checks stay as they were without it. Kept apart from
 * MAKE_GOODS for that reason (the spec added them to it). A pie takes a plain egg only (the jar's recipe; the check's L6).
 */
export const FOOD_GOODS: MakeGood[] = [
  { item: 'bread', target: 0, batch: 4, unit: 1, words: 'bread', forWhat: 'food for members: a bread is 5 of the 20 a member eats; at 6 they stop other work', food: true, allow: ['wheat'] },
  { item: 'pumpkin_pie', target: 0, batch: 2, unit: 1, words: 'pumpkin pies', forWhat: 'food for members: a pie is 8 of the 20 a member eats; at 6 they stop other work', food: true, allow: ['pumpkin', 'sugar', 'sugar_cane', 'egg'] },
  // (s41: the fishing activity's catch, smoked or cooked in a furnace; targets as the pie's, one for two members)
  { item: 'cooked_cod', target: 0, batch: 8, unit: 1, words: 'cooked cod', forWhat: 'food for members: a cooked cod is 5 of the 20 a member eats, from the fishing catch', food: true },
  { item: 'cooked_salmon', target: 0, batch: 8, unit: 1, words: 'cooked salmon', forWhat: 'food for members: a cooked salmon is 6 of the 20 a member eats, from the fishing catch', food: true },
];

/**
 * Kept back from make (spec 4.5): cobblestone for a furnace's 8 and two miners' pickaxes made on the spot, coal for the
 * iron tools' smelting; logs (the village's kind) are 10 for each annex pen slot without a built pen plus 4 (a pen ring is
 * 10 logs charged from storage, a new storage chest 3, a hoe on the spot), computed per village by the world (logsKeep).
 */
export const MAKE_KEEP = { cobblestone: 14, coal: 2, logsBase: 4, logsPerPen: 10 };

/** Never an input of a make (pens, breeding, milking, the cake, bread and the iron age use them; no good's bill does), but
 *  a food good's `allow` (s30). */
export const MAKE_NEVER: ReadonlySet<string> = new Set(['wheat', 'wheat_seeds', 'raw_iron', 'iron_ingot', 'bucket', 'milk_bucket', 'egg', 'brown_egg', 'blue_egg', 'sugar', 'sugar_cane', 'cake', 'bread']);

/** Crafting makes going at once in a village (they share the hut's table and its aisle; smelting makes go by furnace). */
export const MAKE_PARALLEL = Number(rawSetting('MC_MAKE_PARALLEL') ?? 4);

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
 *  coal and raw iron; S.9's review, lens 4 L3; B.4: a torch picked up where its wall was dug). */
export const GATHER_ALSO = 'coal,raw_iron,torch';

/** Logs gathering for the workshop may bring a village in an hour (counted with what is on the way). */
export const GATHER_LOGS_HOUR = Number(rawSetting('MC_GATHER_LOGS_HOUR') ?? 96);

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

// ---------------------------------------------------------------------------------------------
// Lighting (B.4): torches from storage into the buildings and the mine
// ---------------------------------------------------------------------------------------------

/**
 * A light chore's torches at most and at least (a part with fewer unlit spots takes them all), the unlit spots a mine part
 * still growing waits for (one torch a chore is not worth the trip; a finished part takes its last), the torches make keeps
 * on top of the demand, and the demand counted at most (D7: make's target is max(32, min(64, demand) + 8)).
 */
export const LIGHT_TRIP = 16, LIGHT_MIN_TRIP = 4, MINE_LIGHT_MIN = 2, TORCH_RESERVE = 8, TORCH_DEMAND_CAP = 64;

/** Torches a light chore has withdrawn and not yet placed or put back, "village|agent" (D7, L2): the skill sets and
 *  deletes it; the demand counts them as placed, so make does not make them again while they are carried. */
export const lightCarried = new Map<string, number>();

// ---------------------------------------------------------------------------------------------
// Furnishing (X.1): furniture from storage into the village's buildings
// ---------------------------------------------------------------------------------------------

/** A furnish chore's spots at most, and at least where a building has more open (one piece a trip is not worth it). */
export const FURNISH_TRIP = 6, FURNISH_MIN_TRIP = 2;

/** Furniture a furnish chore has withdrawn and not yet placed or put back, "village|agent" (as lightCarried): the demand
 *  counts it as placed, so make does not make it again while it is carried. */
export const decorCarried = new Map<string, Counts>();

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
  const own = (n: string) => n === `${kind}_planks` || n === `${kind}_slab`;
  // (the wood in one kind, beside other ingredients that are no wood: the lectern's bookshelf, #21)
  return recipes(registry, item).find((r) => {
    const names = Object.keys(r.ins);
    return names.some(own) && names.every((n) => own(n) || !/_(planks|slab|log|wood)$/.test(n));
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
