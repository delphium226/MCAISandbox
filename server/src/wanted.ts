/**
 * The wanted list (G6, #73, #71; spec runs/2026-10-21/g6-loop/spec.md): every capability a village lacks, ranked by what it
 * would unlock and by the village's own demand, for scripts/foundry_queue.py to turn the top one into a foundry ticket.
 * A capability is one action a peaceful overworld allows (shears on a full bee nest, shearing a sheep), kept as data: the
 * game's data holds no loot table for a nest's honey, so the table below is hand-kept; its value is counted from the
 * recipe graph (Materials.plan, as s41's frontier probe): the items whose only missing raw is one of its yields. Demand comes
 * from the village record: lapsed barter wants, expired merchant orders, needs with no answer, innovation entries short of
 * a yield, research put into a locked entry that runs it. World-free: the world passes the registry, the plan and the
 * skills it has. GET /api/wanted serves it; with MC_WANTED on the API writes wanted.json beside villages.json every 5
 * minutes (with each capability's time in the top 3, #73's persistence), and innovation counts a locked entry whose
 * capability is in the top 3 as demanded (the user's, 10-21).
 */
import { FOOD_POINTS } from './appetite';
import { boardOf } from './barter';
import { goalsOf } from './goals';
import { BUYS, SELLS } from './merchant';
import { LIBRARY, LOCKED_SKILLS, techOf } from './tech';
import type { MaterialPlan } from './mineflayer/mcMaterials';
import { FOOD_GOODS, MAKE_GOODS } from './mineflayer/mcWorkshop';
import type { Village } from './village';

type Counts = Record<string, number>;

/** On with MC_WANTED=on: the API's writer and innovation's demand from the list (the route serves the list either way). */
export const WANTED_ON = /^(on|1|true)$/i.test(process.env.MC_WANTED ?? 'off');

/**
 * have: a skill and a library activity run it; locked: a foundry activity runs it once the village researches its
 * innovation entry (the ticket is done; the village's demand still counts, so research is offered to everyone); skill: a skill exists but no activity runs it; missing: no skill; dead: a
 * peaceful overworld cannot give it; user: killing passive animals (the user's call, foundry-skill-tree.md 3); knowledge:
 * collectable today but missing from the planner's gatherable list (a table fix, not a ticket; s41's probe).
 */
export type CapStatus = 'have' | 'locked' | 'skill' | 'missing' | 'dead' | 'user' | 'knowledge';
/** How it is done: an item used on a block in a state, on an entity, a block collected, mined underground, a kill. */
export type Verb = 'use_on_block' | 'use_on_entity' | 'collect' | 'mine' | 'kill' | 'wait';

export interface Capability {
  id: string;
  /** Menu-like words ("Harvest honeycomb from bee nests"). */
  name: string;
  verb: Verb;
  /** The block or entity it is done to, and the block states it must be in ("honey_level=5"). */
  target: string[];
  state?: string;
  /** The item used (held, or used up). */
  tool?: string;
  /** What it gives. */
  yields: string[];
  /** The skill that does it today, if any (its status: have when a library spec runs it). */
  skill?: string;
  /** Blocks to look for near a village (foundry_queue counts them in the land). */
  find?: string[];
  /** Blocks the action must never break (budding amethyst: it gives nothing and is the geode's regrowth). */
  avoid?: string[];
  /** Fixed statuses, with their reason. */
  dead?: string;
  user?: string;
  knowledge?: string;
  /** The game facts a ticket needs (what happens, what to avoid). */
  facts: string;
}

/**
 * The capabilities (a peaceful overworld's actions the village has no chore for; the probe's gaps, runs/2026-10-20/s41/
 * frontier_probe.txt). Rare biomes' blocks (pale moss, mangrove roots, eyeblossoms) are left out until a village finds one.
 */
export const CAPABILITIES: Capability[] = [
  {
    id: 'honeycomb', name: 'Harvest honeycomb from bee nests', verb: 'use_on_block', target: ['bee_nest', 'beehive'], state: 'honey_level=5', tool: 'shears', yields: ['honeycomb'], find: ['bee_nest', 'beehive'],
    facts: 'shears used on a bee nest or beehive whose honey_level is 5 (full) drop 3 honeycomb and set it to 0; bees refill it by bringing pollen from flowers; the bees come out angry, but a peaceful world takes no damage; a campfire under the nest keeps them calm; nests hang on tree trunks 2-5 blocks up in forests and plains with flowers',
  },
  {
    id: 'honey_bottle', name: 'Bottle honey from bee nests', verb: 'use_on_block', target: ['bee_nest', 'beehive'], state: 'honey_level=5', tool: 'glass_bottle', yields: ['honey_bottle'], find: ['bee_nest', 'beehive'],
    facts: 'a glass bottle used on a bee nest or beehive whose honey_level is 5 becomes a honey bottle and sets it to 0 (the bottle is used up); bees refill it; angry bees do no damage in peaceful',
  },
  {
    id: 'wool', name: 'Shear the sheep', verb: 'use_on_entity', target: ['sheep'], tool: 'shears', yields: ['white_wool'], skill: 'shear_sheep',
    facts: 'shears used on an adult unsheared sheep drop 1-3 wool of its colour; the wool regrows when it eats grass',
  },
  {
    id: 'bone_meal', name: 'Compost crops into bone meal', verb: 'use_on_block', target: ['composter'], tool: 'wheat_seeds', yields: ['bone_meal'], find: ['composter'],
    facts: 'seeds, crops, leaves and saplings put into a composter raise its level with a chance each (seeds 30%); at level 7 it ripens to 8 and gives 1 bone meal when used; houses keep composters as furniture',
  },
  {
    id: 'mud', name: 'Make mud with water bottles', verb: 'use_on_block', target: ['dirt'], tool: 'potion', yields: ['mud'],
    facts: 'a water bottle (a glass bottle filled at water) used on dirt turns it to mud; mud dries to clay above pointed dripstone',
  },
  {
    id: 'amethyst', name: 'Mine amethyst in geodes', verb: 'mine', target: ['amethyst_cluster'], tool: 'stone_pickaxe', yields: ['amethyst_shard'], find: ['amethyst_cluster', 'budding_amethyst'], avoid: ['budding_amethyst'],
    facts: 'a geode is a sealed ball underground (y -58 to 30): an outer shell of smooth basalt, then calcite, then a lining of amethyst blocks with budding amethyst among them, hollow inside; amethyst clusters grow on budding amethyst and a pickaxe breaks one for 4 shards (2 without); budding amethyst gives nothing when broken and is what regrows the clusters, so it is never broken; the walk-and-dig pathfinder does not reach a cluster inside the shell (live, 10-22: collect stopped at the shell)',
  },
  {
    id: 'copper_age', name: 'Let copper weather', verb: 'wait', target: ['copper_block'], yields: ['exposed_copper', 'weathered_copper', 'oxidized_copper'],
    facts: 'placed copper blocks age by random ticks over hours (exposed, weathered, oxidized); honeycomb waxes a stage to keep it',
  },
  { id: 'flowers', name: 'Pick flowers', verb: 'collect', target: ['poppy'], yields: ['poppy', 'dandelion', 'cornflower', 'lily_of_the_valley', 'azure_bluet', 'blue_orchid', 'oxeye_daisy', 'lilac', 'rose_bush', 'peony', 'sunflower', 'allium', 'pitcher_plant'],
    knowledge: 'collect picks flowers today; the planner lists them as ungatherable (a table fix, not a ticket)', facts: '' },
  { id: 'dripstone', name: 'Collect pointed dripstone', verb: 'collect', target: ['pointed_dripstone'], yields: ['pointed_dripstone'], knowledge: 'collect breaks it today (a table fix)', facts: '' },
  { id: 'terracotta', name: 'Collect terracotta', verb: 'collect', target: ['terracotta'], yields: ['terracotta'], knowledge: 'collect digs it in badlands (a table fix)', facts: '' },
  { id: 'green_dye', name: 'Smelt cactus into green dye', verb: 'collect', target: ['cactus'], yields: ['green_dye'], knowledge: 'a smelt the planner misses (a table fix)', facts: '' },
  { id: 'leather', name: 'Kill cows for leather', verb: 'kill', target: ['cow'], yields: ['leather', 'beef'], user: 'killing passive animals is the user\'s call (books, enchanting)', facts: '' },
  { id: 'ink', name: 'Kill squid for ink', verb: 'kill', target: ['squid'], yields: ['ink_sac', 'glow_ink_sac'], user: 'killing passive animals is the user\'s call (the merchant sells ink sacs)', facts: '' },
  { id: 'quartz', name: 'Mine nether quartz', verb: 'mine', target: ['nether_quartz_ore'], yields: ['quartz'], dead: 'Nether only', facts: '' },
  { id: 'blaze_rod', name: 'Get blaze rods', verb: 'kill', target: ['blaze'], yields: ['blaze_rod'], dead: 'Nether only (blazes)', facts: '' },
  { id: 'nether', name: 'Gather Nether blocks', verb: 'mine', target: ['blackstone'], yields: ['blackstone', 'nether_brick', 'soul_soil', 'basalt', 'nether_wart', 'warped_fungus', 'netherite_scrap'], dead: 'Nether only', facts: '' },
  { id: 'prismarine', name: 'Get prismarine shards', verb: 'kill', target: ['guardian'], yields: ['prismarine_shard'], dead: 'dropped by guardians (none in peaceful)', facts: '' },
  { id: 'end', name: 'Gather End blocks', verb: 'mine', target: ['end_stone'], yields: ['end_stone', 'popped_chorus_fruit', 'shulker_shell'], dead: 'the End only', facts: '' },
];

/** The verbs foundry_queue.py has a ticket template for (a new skill); a capability with status `skill` takes the
 *  skill-activity template whatever its verb (#91). */
export const TEMPLATES = new Set<Verb>(['use_on_block', 'mine']);

/**
 * Raw items the village gets today (collect, the mine, farms, pens, fishing, the merchant's sales; s41's probe's list),
 * beside the yields of capabilities it has.
 */
const GATHERED = /(_log|_stem|_planks|_leaves|_sapling)$|^any:/;
const GATHERED_SET = new Set(['cobblestone', 'stone', 'sand', 'red_sand', 'sandstone', 'red_sandstone', 'dirt', 'gravel', 'clay_ball', 'clay', 'coal', 'raw_iron', 'raw_copper', 'raw_gold',
  'flint', 'wheat', 'wheat_seeds', 'carrot', 'potato', 'beetroot', 'beetroot_seeds', 'pumpkin', 'pumpkin_seeds', 'melon_slice', 'melon_seeds', 'sugar_cane', 'cocoa_beans',
  'egg', 'milk_bucket', 'cod', 'salmon', 'pufferfish', 'tropical_fish', 'emerald', 'lapis_lazuli', 'redstone', 'diamond', 'kelp', 'seagrass', 'lily_pad', 'vine', 'bamboo',
  'cactus', 'snowball', 'ice', 'feather', 'apple', 'stick', 'granite', 'diorite', 'andesite', 'deepslate', 'cobbled_deepslate', 'tuff', 'calcite', 'moss_block', 'grass_block',
  'podzol', 'sweet_berries', ...SELLS.map((o) => o.item)]);

/** Items a consumer uses (members' meals, the workshop's goods, the merchant's buys, the innovation library's goods): an
 *  unlocked one counts 1 in a capability's value, any other item 0.25. */
const USED = new Set([...Object.keys(FOOD_POINTS), ...MAKE_GOODS.map((g) => g.item), ...FOOD_GOODS.map((g) => g.item), ...BUYS.map((o) => o.item), ...LIBRARY.flatMap((e) => e.goods.map((g) => g.item))]);
const NOT_ITEMS = /spawn_egg|^command_block|structure_|jigsaw|barrier|^light$|debug_stick|knowledge_book|bedrock|petrified/;

/** A capability's value: the items it unlocks (their only missing raws among its yields), the weighted count, and the
 *  simplest of them (fewest recipe steps beyond the basics, nothing else hard to gather: a ticket's research goods). */
export interface Unlocks { items: string[]; used: string[]; value: number; simplest: string[] }

let unlocksCache: { key: string; out: Map<string, Unlocks> } | null = null;

/**
 * Every capability's unlocks from the recipe graph (pure recipe data: cached by the set of capabilities the village has).
 * `plan` is Materials.plan; `items` every item name in the registry. ~1 s the first time.
 */
export function unlocksOf(items: string[], plan: (bill: Counts) => MaterialPlan, have: Set<string>): Map<string, Unlocks> {
  const key = [...have].sort().join(',');
  if (unlocksCache?.key === key) return unlocksCache.out;
  const haveRaw = (n: string) => GATHERED.test(n) || GATHERED_SET.has(n) || CAPABILITIES.some((c) => have.has(c.id) && c.yields.includes(n));
  const yieldOf = new Map<string, string>();
  for (const c of CAPABILITIES) for (const y of c.yields) if (!yieldOf.has(y)) yieldOf.set(y, c.id);
  const out = new Map<string, Unlocks>(CAPABILITIES.map((c) => [c.id, { items: [], used: [], value: 0, simplest: [] }]));
  const steps = new Map<string, number>();
  for (const n of items) {
    if (NOT_ITEMS.test(n)) continue;
    let p: MaterialPlan;
    try {
      p = plan({ [n]: 1 });
    } catch {
      continue;
    }
    const miss = Object.keys(p.gather).filter((g) => !haveRaw(g));
    if (!miss.length) continue;
    // (one capability's yields only: the items one new action would open)
    const caps = new Set(miss.map((g) => yieldOf.get(g)));
    if (caps.size !== 1) continue;
    const id = [...caps][0];
    if (!id) continue;
    const u = out.get(id)!;
    if (CAPABILITIES.find((c) => c.id === id)!.yields.includes(n)) continue;
    u.items.push(n);
    if (USED.has(n)) u.used.push(n);
    // (simple: crafted in at most 2 steps beyond sticks, planks and charcoal, from the yields, logs and stone alone)
    const easy = Object.keys(p.gather).every((g) => yieldOf.get(g) === id || /(_log|_stem)$|^any:(logs|cobblestone)$|^(cobblestone|stone)$/.test(g));
    const k = p.steps.filter((x) => !/^(stick|charcoal|(any:)?[a-z_]*planks)$/.test(x.item)).length;
    if (easy && k <= 2) steps.set(n, k);
  }
  for (const [id, u] of out) {
    const c = CAPABILITIES.find((x) => x.id === id)!;
    u.value = u.used.length + 0.25 * (u.items.length - u.used.length) + (c.yields.some((y) => USED.has(y)) ? 1 : 0);
    u.simplest = u.items.filter((n) => steps.has(n)).sort((x, y) => Number(USED.has(y)) - Number(USED.has(x)) || steps.get(x)! - steps.get(y)! || x.localeCompare(y)).slice(0, 3);
  }
  unlocksCache = { key, out };
  return out;
}

/** One entry of the list. */
export interface Wanted {
  id: string; name: string; verb: Verb; status: CapStatus; why: string[]; reason?: string;
  value: number; demand: number; rank: number; ticketable: boolean;
  /** The share of the rank from the village's demand (#89: the village asking, not the recipe graph). */
  demandShare: number;
  unlocks: string[]; used: string[]; simplest: string[]; yields: string[]; facts: string; avoid?: string[];
  /** Items members wish for that it opens (#89), most wished first; `activitySkill`: the foundry skill a ticket names. */
  wished: string[]; activitySkill: string; tool?: string; target: string[]; state?: string; find?: string[]; skill?: string;
}

/** What the world (or an offline script) passes in: its skills, the skills a library spec runs, the recipe graph. */
export interface WantedCtx {
  items: string[];
  plan: (bill: Counts) => MaterialPlan;
  skills: Set<string>;
  activitySkills: Set<string>;
  now: number;
  /** G5's proposals of the village (#90; proposals.ts allProposals, passed in: proposals.ts imports this module). */
  proposals?: Array<{ by: string; status: string; target?: { capability?: string }; endorsements?: Array<{ by: string }> }>;
}

/** A capability's status for a village's world (`v`: its innovation record, for a locked activity): fixed reasons first,
 *  then skills and activities. */
export function statusOf(c: Capability, ctx: Pick<WantedCtx, 'skills' | 'activitySkills'>, v?: Village): { status: CapStatus; reason?: string } {
  if (c.dead) return { status: 'dead', reason: c.dead };
  if (c.user) return { status: 'user', reason: c.user };
  if (c.knowledge) return { status: 'knowledge', reason: c.knowledge };
  // (a foundry skill run by a library spec, or the capability's named skill so run; locked until researched)
  const run = [...ctx.activitySkills].find((s) => s === c.skill || s === capSkill(c) || s === activitySkill(c));
  if (run) {
    const e = LOCKED_SKILLS.get(run);
    if (e && !(v && (v as Village & { innovation?: unknown }).innovation && techOf(v).unlocked.includes(e.id))) return { status: 'locked', reason: `the activity is built; research ${e.name} to unlock it` };
    return { status: 'have' };
  }
  if ((c.skill && ctx.skills.has(c.skill)) || ctx.skills.has(capSkill(c))) return { status: 'skill', reason: `the skill ${c.skill ?? capSkill(c)} exists but no activity runs it` };
  return { status: 'missing' };
}

/** The skill name a ticket gives a capability (harvest_honeycomb). */
export const capSkill = (c: Capability) => c.skill ?? `harvest_${c.id}`;
/** The foundry skill whose activity runs it: a new skill's own name, or `<skill>_at` for an existing skill run at the
 *  adapter's place (#91's skill-activity template: shear_sheep_at). */
export const activitySkill = (c: Capability) => (c.skill ? `${c.skill}_at` : capSkill(c));

const HOUR = 60 * 60000;

/**
 * #89: members' wishes from their life goals (MC_GOALS; goals.ts): what a member with each goal wants for its house or
 * the village beyond its needs. A wish is unmet while neither the member's own chest nor the commons holds the item; an
 * unmet wish for an item only a missing capability gives is that member asking for the capability (+0.5 a member, by
 * item). Code keeps them as it keeps the needs; the members' own words come with G5's proposals.
 */
export const WISHES: Record<string, string[]> = {
  home: ['white_bed', 'white_carpet', 'painting', 'flower_pot', 'candle', 'lantern'],
  beauty: ['white_banner', 'painting', 'flower_pot', 'candle', 'poppy', 'lantern'],
  standing: ['white_banner', 'lantern', 'bell'],
  mastery: ['spyglass', 'compass', 'clock'],
  invention: ['spyglass', 'compass', 'clock'],
  wealth: ['emerald', 'gold_ingot'],
};
/** Demand a member's unmet wish adds to the capability that would answer it. */
export const WISH_DEMAND = 0.5;

/** Each member's unmet wishes (item -> the members wishing it), from its goal, its own chest and the commons. */
export function unmetWishes(v: Village, store: Counts): Record<string, string[]> {
  const g = goalsOf(v);
  const out: Record<string, string[]> = {};
  if (!g) return out;
  for (const [m, goal] of Object.entries(g.of ?? {})) {
    const own = v.homes?.[m]?.chest?.items ?? {};
    for (const item of WISHES[goal] ?? []) if (!(own[item] ?? 0) && !(store[item] ?? 0)) (out[item] ??= []).push(m);
  }
  return out;
}
/** Need kinds and the consumers whose goods answer them. */
const NEED_ITEMS: Record<string, RegExp> = {
  light: /(lantern|candle|torch|lamp|glowstone|sea_lantern|froglight)$/,
  furnish: /(_bed|_carpet|_banner|painting|item_frame|flower_pot|candle|lantern)$/,
  housing: /_bed$/,
  food: /./,
};

/**
 * The wanted list for a village (pure but for the recipe cache): every capability, its status, value, demand terms and
 * rank, ranked; `ticketable`: missing or a skill without an activity, with a template for its verb.
 */
export function wantedList(v: Village, ctx: WantedCtx): Wanted[] {
  // (a locked capability's yields are not the village's yet: its value stays until it is researched)
  const have = new Set(CAPABILITIES.filter((c) => statusOf(c, ctx, v).status === 'have').map((c) => c.id));
  const unlocks = unlocksOf(ctx.items, ctx.plan, have);
  const b = boardOf(v);
  const lapsed: Counts = {};
  for (const o of b.offers) if (o.state === 'lapsed' && (o.endAt ?? 0) > ctx.now - HOUR) lapsed[o.want] = (lapsed[o.want] ?? 0) + 1;
  const orders = (v as Village & { merchant?: { orders?: Array<{ item: string; state: string }> } }).merchant?.orders ?? [];
  const expired: Counts = {};
  for (const o of orders) if (o.state === 'expired') expired[o.item] = (expired[o.item] ?? 0) + 1;
  const states = v.needStates ?? {};
  const tech = (v as Village & { innovation?: unknown }).innovation ? techOf(v) : null;
  const store: Counts = {};
  for (const c of v.storage?.chests ?? []) for (const [k, q] of Object.entries((c as { items?: Counts }).items ?? {})) store[k] = (store[k] ?? 0) + q;
  const held: Counts = { ...store };
  for (const h of Object.values(v.homes ?? {})) for (const [k, q] of Object.entries(h.chest?.items ?? {})) held[k] = (held[k] ?? 0) + q;
  const wishes = unmetWishes(v, store);
  const out: Wanted[] = [];
  for (const c of CAPABILITIES) {
    const { status, reason } = statusOf(c, ctx, v);
    const u = unlocks.get(c.id) ?? { items: [], used: [], value: 0, simplest: [] };
    const why: string[] = [];
    let demand = 0;
    const theirs = new Set([...c.yields, ...u.items]);
    const w = Object.entries(lapsed).filter(([k]) => theirs.has(k));
    if (w.length) {
      const n = w.reduce((s, [, q]) => s + q, 0);
      demand += 2 * n;
      why.push(`${n} lapsed barter want${n === 1 ? '' : 's'} (${w.map(([k]) => k).join(', ')})`);
    }
    const ex = Object.entries(expired).filter(([k]) => theirs.has(k));
    if (ex.length) {
      const n = ex.reduce((s, [, q]) => s + q, 0);
      demand += 2 * n;
      why.push(`${n} merchant order${n === 1 ? '' : 's'} expired unfilled (${ex.map(([k]) => k).join(', ')})`);
    }
    for (const [kind, s] of Object.entries(states)) {
      if (s.status !== 'no answer' || !NEED_ITEMS[kind]) continue;
      const serves = [...theirs].filter((n) => NEED_ITEMS[kind].test(n) && (kind !== 'food' || FOOD_POINTS[n] !== undefined));
      if (serves.length) {
        demand += 3;
        why.push(`the ${kind} need has no answer (${serves.slice(0, 3).join(', ')} would serve it)`);
      }
    }
    if (tech) for (const e of LIBRARY) {
      if (tech.unlocked.includes(e.id)) continue;
      const short = Object.entries(e.requires).filter(([n, q]) => c.yields.includes(n) && (store[n] ?? 0) < q).map(([n]) => n);
      if (short.length) {
        demand += 2;
        why.push(`innovation's ${e.name} needs ${short.join(', ')}`);
      }
      // (research members put into a locked entry that runs this capability: an activity entry's skill)
      if (e.activity && (e.skill === capSkill(c) || e.skill === activitySkill(c))) {
        const pts = Object.values(tech.points[e.id] ?? {}).reduce((s, q) => s + q, 0) / 10;
        if (pts >= 10) {
          demand += Math.floor(pts / 10);
          why.push(`${Math.round(pts)} research points in ${e.name}`);
        }
      }
    }
    // (#89: members whose life goal wishes for an item it opens, each member once)
    const wishers = new Set<string>();
    const wished = Object.entries(wishes).filter(([item]) => theirs.has(item)).sort((x, y) => y[1].length - x[1].length).map(([item]) => item);
    for (const item of wished) for (const m of wishes[item]) wishers.add(m);
    if (wishers.size) {
      demand += WISH_DEMAND * wishers.size;
      why.push(`${wishers.size} member${wishers.size === 1 ? '' : 's'} wish${wishers.size === 1 ? 'es' : ''} for ${wished.join(', ')} (their life goals)`);
    }
    // (#90: members' proposals naming it: +1 an open, endorsed or waiting one, +2 an accepted one; its proposers and
    // backers counted as members asking)
    const props = (ctx.proposals ?? []).filter((p) => p.target?.capability === c.id && ['open', 'endorsed', 'triage', 'deferred', 'accepted'].includes(p.status));
    if (props.length) {
      const askers = new Set(props.flatMap((p) => [p.by, ...(p.endorsements ?? []).map((e) => e.by)]));
      const accepted = props.filter((p) => p.status === 'accepted').length;
      demand += props.length - accepted + 2 * accepted;
      why.push(`${askers.size} member${askers.size === 1 ? '' : 's'} proposed or backed it (${props.length} proposal${props.length === 1 ? '' : 's'}${accepted ? `, ${accepted} accepted` : ''})`);
    }
    // (goods the village holds idle that the unlocked items would use: raw copper for waxed copper; the commons' and the
    // members' own chests, logs and stone aside; +1 a 64 held, at most 3)
    const inputs = new Set<string>();
    for (const n of u.items.slice(0, 40)) {
      try {
        for (const g of Object.keys(ctx.plan({ [n]: 1 }).gather)) if (!c.yields.includes(g) && !GATHERED.test(g) && !/^(cobblestone|stone|dirt|sand|gravel)$/.test(g)) inputs.add(g);
      } catch {
        // (an item the planner cannot plan adds nothing)
      }
    }
    const idle = [...inputs].map((g) => [g, held[g] ?? 0] as const).filter(([, q]) => q >= 64);
    if (idle.length) {
      const n = Math.min(3, idle.reduce((s, [, q]) => s + Math.floor(q / 64), 0));
      demand += n;
      why.push(`${idle.map(([g, q]) => `${q} ${g}`).join(', ')} held idle that its items would use`);
    }
    if (u.items.length) why.unshift(`opens ${u.items.length} item${u.items.length === 1 ? '' : 's'} (${u.used.length} used: ${(u.used.length ? u.used : u.items).slice(0, 5).join(', ')}${(u.used.length || u.items.length) > 5 ? ', ...' : ''})`);
    const rank = Math.round((Math.log2(1 + u.value) + demand) * 100) / 100;
    const demandShare = rank > 0 ? Math.round((demand / (Math.log2(1 + u.value) + demand)) * 100) / 100 : 0;
    const ticketable = status === 'skill' || (status === 'missing' && TEMPLATES.has(c.verb));
    out.push({
      id: c.id, name: c.name, verb: c.verb, status, why, ...(reason ? { reason } : {}), value: Math.round(u.value * 100) / 100, demand, rank, ticketable, demandShare,
      unlocks: u.items, used: u.used, simplest: u.simplest, yields: c.yields, facts: c.facts, ...(c.avoid ? { avoid: c.avoid } : {}), wished, activitySkill: activitySkill(c), ...(c.tool ? { tool: c.tool } : {}), target: c.target, ...(c.state ? { state: c.state } : {}), ...(c.find ? { find: c.find } : {}), skill: capSkill(c),
    });
  }
  // (what the village cannot or should not ticket last, so the top of the list is what a ticket could answer)
  const tier = (w: Wanted) => (w.status === 'missing' || w.status === 'skill' || w.status === 'locked' ? 0 : w.status === 'knowledge' ? 1 : w.status === 'have' ? 3 : 2);
  return out.sort((x, y) => tier(x) - tier(y) || y.rank - x.rank || y.value - x.value);
}

/** The wanted list's top capabilities a ticket could answer (for innovation's demand): ids of the first `n`. */
export function topWanted(list: Wanted[], n = 3): string[] {
  return list.filter((w) => w.status === 'missing' || w.status === 'skill' || w.status === 'locked').slice(0, n).map((w) => w.id);
}

/** wanted.json's persistence record: per capability, when it was first and last in the top 3 and how many samples. */
export interface WantedHistory { samples: number; top: Record<string, { first: number; last: number; samples: number }> }

export function recordTop(h: WantedHistory | undefined, list: Wanted[], now: number): WantedHistory {
  const out: WantedHistory = h ?? { samples: 0, top: {} };
  out.samples++;
  for (const id of topWanted(list)) {
    const t = (out.top[id] ??= { first: now, last: now, samples: 0 });
    t.last = now;
    t.samples++;
  }
  return out;
}
