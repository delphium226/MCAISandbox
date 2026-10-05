/**
 * The Minecraft adapter's block and item lists (V2.5): built from vanilla's tags in the local server jar
 * (vanillaData.ts), plus a few names vanilla has no tag for. Built once per process on first use, all in one pass;
 * when the jar is missing or any tag cannot be read, every list falls back to the hand-written rules in HAND (the
 * lists as they stood before V2.5), and one `[vanilla]` line says which. `scripts/checks/vanilla_tags.mts` compares the
 * two.
 */
import { hasJar, tag, vanillaJar, type TagKind } from '../vanillaData';

/**
 * A list: the union of `tags` (of the list's kind; "fluid:water" reads a fluid tag as block names), the lists named in
 * `use` and `extras`, minus `exclude`.
 */
export interface BlockDef {
  id: string;
  kind: 'block' | 'item';
  tags?: string[];
  use?: string[];
  extras?: string[];
  exclude?: string[];
}

const ORES = ['coal_ores', 'iron_ores', 'copper_ores', 'gold_ores', 'redstone_ores', 'lapis_ores', 'diamond_ores', 'emerald_ores'];

export const DEFS: BlockDef[] = [
  // Shared parts (no consumer of their own)
  // Natural ground: soil, stone, sand, terracotta, ice
  {
    id: 'GROUND', kind: 'block',
    tags: ['substrate_overworld', 'base_stone_overworld', 'sand', 'terracotta', 'ice'],
    extras: ['gravel', 'suspicious_gravel', 'calcite', 'clay', 'snow_block', 'sandstone', 'red_sandstone'],
  },
  // Fluids and blocks that are always full of water (no waterlogged property)
  { id: 'WATERY', kind: 'block', tags: ['fluid:water', 'fluid:lava'], extras: ['bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass'] },
  // Blocks that fall when what is under them is dug (vanilla has no gravity tag)
  { id: 'FALLS', kind: 'block', tags: ['sand', 'concrete_powder'], extras: ['gravel', 'suspicious_gravel', 'pointed_dripstone'] },

  // mcBuild: find_site counts a column top (solid, not NON_GROUND) that is not this as built
  { id: 'NATURAL_GROUND', kind: 'block', use: ['GROUND'] },
  // mcBuild: prepare_site clears columns of only these; build calls anything else an existing structure
  {
    id: 'NATURAL', kind: 'block',
    use: ['GROUND', 'WATERY'],
    tags: [...ORES, 'overworld_natural_logs', 'leaves', 'saplings', 'flowers', 'replaceable_by_mushrooms', 'cave_vines', 'corals', 'wall_corals', 'coral_blocks'],
    extras: [
      'bedrock', 'snow', 'powder_snow', 'nether_quartz_ore', 'mossy_cobblestone', 'moss_carpet', 'cactus', 'sugar_cane', 'bamboo', 'bamboo_sapling',
      'cocoa', 'bee_nest', 'sweet_berry_bush', 'pumpkin', 'melon', 'cobweb', 'mushroom_stem', 'sea_pickle', 'lily_pad',
      'big_dripleaf', 'big_dripleaf_stem', 'small_dripleaf', 'spore_blossom', 'pointed_dripstone', 'dripstone_block',
      'mangrove_roots', 'muddy_mangrove_roots', 'resin_clump', 'creaking_heart', 'pale_hanging_moss', 'amethyst_cluster',
    ],
    exclude: ['air', 'cave_air', 'void_air', 'fire', 'soul_fire', 'light', 'structure_void', 'nether_sprouts', 'crimson_roots', 'warped_roots', 'wither_rose', 'chorus_flower'],
  },
  // mcBuild: find_site's surface read takes a column topped by one of these as water
  { id: 'LIQUID', kind: 'block', use: ['WATERY'] },
  // mcBuild: solid blocks the surface read passes over (trees and plants, not ground)
  {
    id: 'NON_GROUND', kind: 'block',
    tags: ['overworld_natural_logs', 'leaves'],
    extras: ['mushroom_stem', 'cactus', 'bamboo', 'moss_carpet', 'pale_moss_carpet', 'brown_mushroom_block', 'red_mushroom_block', 'big_dripleaf', 'azalea', 'flowering_azalea', 'cocoa', 'bee_nest', 'pumpkin', 'melon', 'mangrove_roots',
      'dripstone_block', 'pointed_dripstone', 'amethyst_cluster', 'creaking_heart'],
  },
  // mcBuild's isLog: the surface read's tree count, treeAt and prepare_site's felling
  { id: 'BUILD_ISLOG', kind: 'block', tags: ['overworld_natural_logs'], extras: ['mushroom_stem'] },
  // botAgent: walks may dig only these (blocksCantBreak is the rest)
  {
    id: 'WALK_DIG', kind: 'block',
    tags: ['substrate_overworld', 'base_stone_overworld', 'sand', 'snow', 'leaves', ...ORES],
    extras: ['gravel', 'clay', 'calcite', 'netherrack', 'nether_quartz_ore', 'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush'],
  },
  // mcUtil: tables().wet (and not open); waterlogged states with an empty box are added by state
  { id: 'WET', kind: 'block', use: ['WATERY'] },
  // mcUtil and mcMine: water above a stack of these comes down; a ceiling of these is no ceiling
  { id: 'FALLING', kind: 'block', use: ['FALLS'] },
  // mcStorage: deposit "all" keeps these back
  {
    id: 'JUNK', kind: 'item',
    tags: ['saplings', 'leaves', 'flowers', 'eggs', 'chicken_food', 'dirt'],
    extras: ['leaf_litter', 'cocoa_beans', 'apple', 'sweet_berries', 'bush', 'gravel', 'flint', 'stick', 'feather', 'bone', 'string', 'rotten_flesh', 'dead_bush', 'short_grass', 'firefly_bush'],
  },
  // mcStorage: deposit "all" keeps tools
  { id: 'TOOL', kind: 'item', tags: ['pickaxes', 'axes', 'shovels', 'hoes', 'swords'], extras: ['shears', 'flint_and_steel', 'fishing_rod', 'bucket', 'water_bucket'] },
  // mcSurvival: a fallen tree lies on these
  { id: 'WILD_GROUND', kind: 'block', use: ['GROUND'] },
  // mcSurvival (felling, collect) and mcBuild (find_site's wood, the preparer's logs): tree logs
  { id: 'TREE_LOG', kind: 'block', tags: ['overworld_natural_logs'] },
  // mcMine: the mine digs only these
  {
    id: 'MINE_DIGGABLE', kind: 'block',
    use: ['GROUND'],
    tags: [...ORES],
    extras: ['nether_quartz_ore', 'dripstone_block', 'pointed_dripstone', 'short_grass', 'tall_grass', 'fern'],
    exclude: ['ice', 'packed_ice', 'blue_ice', 'frosted_ice', 'snow_block'],
  },
  // mcMine: the stairs end in, and the tunnels need, these
  { id: 'MINE_STONE', kind: 'block', tags: ['base_stone_overworld', ...ORES], extras: ['calcite', 'nether_quartz_ore'] },
  // mcRescue: the stuck rescue climbs through only these
  {
    id: 'RESCUE_DIGGABLE', kind: 'block',
    use: ['GROUND'],
    tags: ['snow', 'leaves', ...ORES],
    extras: ['netherrack', 'nether_quartz_ore'],
    exclude: ['ice', 'packed_ice', 'blue_ice', 'frosted_ice'],
  },
  // mcAtlas: tree cells and wood kinds, canopy, water (lava is tested first) and the solid blocks that are not ground
  { id: 'ATLAS_LOG', kind: 'block', tags: ['overworld_natural_logs'] },
  { id: 'ATLAS_LEAF', kind: 'block', tags: ['leaves'], extras: ['brown_mushroom_block', 'red_mushroom_block'] },
  { id: 'ATLAS_WATER', kind: 'block', use: ['WATERY'], exclude: ['lava'] },
  { id: 'ATLAS_SKIP', kind: 'block', use: ['NON_GROUND'] },
];

type Rule = RegExp | ((n: string) => boolean);

/** The hand-written rules the lists replaced (the fallback without the jar), as they stood in each file. */
export const HAND: Record<string, Rule> = {
  NATURAL_GROUND: /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|mud|sand|red_sand|gravel|stone|deepslate|tuff|granite|diorite|andesite|calcite|snow_block|clay|moss_block|sandstone|red_sandstone|terracotta|.*_terracotta|packed_ice|ice)$/,
  NATURAL: /^(stone|deepslate|tuff|granite|diorite|andesite|calcite|grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|mud|bedrock|water|lava|sand|red_sand|gravel|sandstone|red_sandstone|snow_block|snow|ice|packed_ice|clay|terracotta|.*_terracotta|moss_block|moss_carpet|mossy_cobblestone|cactus|sugar_cane|bamboo|cocoa|bee_nest|glow_lichen|hanging_roots|sweet_berry_bush|dead_bush|short_grass|tall_grass|short_dry_grass|tall_dry_grass|fern|large_fern|bush|firefly_bush|leaf_litter|pumpkin|melon|vine|cobweb|.*_mushroom|.*_mushroom_block|mushroom_stem|dandelion|poppy|.*_tulip|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|lilac|peony|rose_bush|sunflower|pink_petals|wildflowers|kelp|kelp_plant|seagrass|tall_seagrass|sea_pickle|lily_pad)$|_ore$|_log$|_wood$|_leaves$|_sapling$/,
  LIQUID: /^(water|lava|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/,
  NON_GROUND: /leaves|_log$|_wood$|_stem$|grass$|fern|flower|dandelion|poppy|tulip|orchid|allium|bluet|daisy|lilac|peony|rose_bush|sunflower|bush|sapling|^snow$|vine|mushroom|sugar_cane|bamboo|cactus|azalea|dripleaf|moss_carpet|leaf_litter|petals|cobweb/,
  BUILD_ISLOG: /_log$|_wood$|_stem$/,
  WALK_DIG: /^(dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|clay|gravel|sand|red_sand|snow|snow_block|stone|deepslate|tuff|andesite|diorite|granite|calcite|netherrack|moss_block|short_grass|tall_grass|fern|large_fern|dead_bush|.*_leaves|.*_ore)$/,
  WET: /^(water|lava|bubble_column|kelp|kelp_plant|seagrass|tall_seagrass)$/,
  FALLING: /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|pointed_dripstone|\w+_concrete_powder)$/,
  JUNK: /_sapling$|_seeds$|_leaves$|_petals$|^(leaf_litter|cocoa_beans|apple|sweet_berries|bush|dirt|coarse_dirt|rooted_dirt|gravel|flint|stick|egg|brown_egg|blue_egg|feather|bone|string|rotten_flesh|poppy|dandelion|cactus_flower|dead_bush|short_grass|wildflowers|.*_tulip|pink_petals|firefly_bush)$/,
  TOOL: /_(pickaxe|axe|shovel|hoe|sword)$|^(shears|flint_and_steel|fishing_rod|bucket|water_bucket)$/,
  WILD_GROUND: /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|mud|sand|red_sand|gravel|stone|deepslate|tuff|granite|diorite|andesite|calcite|snow_block|clay|moss_block|sandstone|red_sandstone|terracotta|.*_terracotta|packed_ice|ice)$/,
  TREE_LOG: (n) => n.endsWith('_log') && !n.startsWith('stripped_'),
  MINE_DIGGABLE: /^(stone|deepslate|tuff|granite|diorite|andesite|calcite|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|gravel|sand|red_sand|clay|sandstone|red_sandstone|terracotta|.*_terracotta|dripstone_block|pointed_dripstone|moss_block|.*_ore|short_grass|tall_grass|fern)$/,
  MINE_STONE: /^(stone|deepslate|tuff|granite|diorite|andesite|calcite)$|_ore$/,
  RESCUE_DIGGABLE: /^(dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|clay|gravel|sand|red_sand|snow|snow_block|stone|deepslate|tuff|andesite|diorite|granite|calcite|sandstone|red_sandstone|terracotta|.*_terracotta|netherrack|moss_block|.*_leaves|.*_ore)$/,
  ATLAS_LOG: /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/,
  ATLAS_LEAF: /_leaves$|mushroom_block$/,
  ATLAS_WATER: /^(water|bubble_column|seagrass|tall_seagrass|kelp|kelp_plant)$/,
  ATLAS_SKIP: /^(snow|cocoa)$|_wood$|_stem$|cactus|bamboo/,
};

/** Every list's names from the jar's tags (throws when a tag cannot be read). */
export function deriveSets(jar = vanillaJar()): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const derive = (d: BlockDef): Set<string> => {
    const had = out.get(d.id);
    if (had) return had;
    const s = new Set<string>();
    for (const id of d.use ?? []) {
      const u = DEFS.find((x) => x.id === id);
      if (!u) throw new Error(`${d.id}: no list ${id}`);
      for (const n of derive(u)) s.add(n);
    }
    for (const t of d.tags ?? []) {
      const [kind, name] = t.includes(':') ? (t.split(':') as [TagKind, string]) : [d.kind as TagKind, t];
      let members: Set<string>;
      try {
        members = tag(kind, name, jar);
      } catch (e) {
        throw new Error(`${kind} tag #${name} (${d.id}): ${(e as Error).message}`);
      }
      // A fluid tag's members are fluids ("flowing_water"); the block is the still one
      for (const n of members) s.add(kind === 'fluid' ? n.replace(/^flowing_/, '') : n);
    }
    for (const n of d.extras ?? []) s.add(n);
    for (const n of d.exclude ?? []) s.delete(n);
    out.set(d.id, s);
    return s;
  };
  for (const d of DEFS) derive(d);
  return out;
}

export type NameSet = { has(name: string): boolean };

let lists: Map<string, NameSet> | null = null;

/** All lists, built on first use: from the jar, or (no jar, or any tag failing) all from HAND. */
function allLists(): Map<string, NameSet> {
  if (lists) return lists;
  const jar = vanillaJar();
  try {
    if (!hasJar(jar)) throw new Error(`no jar at ${jar}`);
    lists = deriveSets(jar);
    console.error(`[vanilla] block lists from ${jar}`);
  } catch (e) {
    lists = new Map(Object.entries(HAND).map(([id, r]) => [id, { has: typeof r === 'function' ? r : (n: string) => r.test(n) }]));
    console.error(`[vanilla] hand block lists: ${(e as Error).message}`);
  }
  return lists;
}

/** One list, resolved on its first test. */
function list(id: string): NameSet {
  if (!HAND[id]) throw new Error(`no hand rule for ${id}`);
  let s: NameSet | undefined;
  return { has: (n) => (s ??= allLists().get(id)!).has(n) };
}

export const NATURAL_GROUND = list('NATURAL_GROUND');
export const NATURAL = list('NATURAL');
export const LIQUID = list('LIQUID');
export const NON_GROUND = list('NON_GROUND');
export const BUILD_ISLOG = list('BUILD_ISLOG');
export const WALK_DIG = list('WALK_DIG');
export const WET = list('WET');
export const FALLING = list('FALLING');
export const JUNK = list('JUNK');
export const TOOL = list('TOOL');
export const WILD_GROUND = list('WILD_GROUND');
export const TREE_LOG = list('TREE_LOG');
export const MINE_DIGGABLE = list('MINE_DIGGABLE');
export const MINE_STONE = list('MINE_STONE');
export const RESCUE_DIGGABLE = list('RESCUE_DIGGABLE');
export const ATLAS_LOG = list('ATLAS_LOG');
export const ATLAS_LEAF = list('ATLAS_LEAF');
export const ATLAS_WATER = list('ATLAS_WATER');
export const ATLAS_SKIP = list('ATLAS_SKIP');

interface StateBlock {
  boundingBox: string;
  minStateId: number;
  states?: Array<{ name: string; num_values: number }>;
}

/**
 * For a block with an empty box and a waterlogged property (coral fans, glow lichen, small dripleaf...), whether a state
 * id of it is waterlogged; null for other blocks. States count through the properties in order, the last fastest, and
 * `waterlogged` lists true first.
 */
export function waterloggedEmpty(b: StateBlock): ((s: number) => boolean) | null {
  if (b.boundingBox !== 'empty' || !b.states) return null;
  const i = b.states.findIndex((p) => p.name === 'waterlogged');
  if (i < 0) return null;
  const stride = b.states.slice(i + 1).reduce((m, p) => m * p.num_values, 1);
  return (s) => Math.floor((s - b.minStateId) / stride) % 2 === 0;
}
