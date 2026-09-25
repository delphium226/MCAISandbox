/**
 * Block registry. A block state in a chunk is a 16-bit value: low 8 bits = block id, high 8 bits = meta.
 * Meta meanings are block specific (log axis, furnace facing, fluid level, crop age, torch attachment...).
 */

export type RenderLayer = 'none' | 'opaque' | 'cutout' | 'translucent';
export type BlockShape =
  | 'none'
  | 'cube'
  | 'cross'
  | 'torch'
  | 'fluid'
  | 'cactus'
  | 'slab'
  | 'farmland'
  | 'crop'
  | 'ladder'
  | 'snow_layer'
  | 'door'
  | 'stairs'
  | 'fence';
export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'hoe' | 'shears' | 'none';
export type SoundGroup = 'stone' | 'wood' | 'gravel' | 'grass' | 'sand' | 'glass' | 'cloth' | 'snow' | 'metal';
export type Tint = 'none' | 'grass' | 'foliage' | 'birch' | 'spruce' | 'water';

export interface BlockTextures {
  top: string;
  bottom: string;
  side: string;
  /** Front face texture for directional blocks (furnace, pumpkin). */
  front?: string;
}

export interface Drop {
  item: string;
  min: number;
  max: number;
  chance?: number;
}

export interface BlockDef {
  id: number;
  name: string;
  displayName: string;
  shape: BlockShape;
  layer: RenderLayer;
  /** Has a collision box. */
  solid: boolean;
  /** Fully occludes neighbouring faces and blocks light. */
  opaque: boolean;
  /** Extra light attenuation for non-opaque blocks (leaves, water). */
  lightFilter: number;
  lightEmission: number;
  textures: BlockTextures;
  /** Seconds to break with bare hands multiplier base (Minecraft "hardness"). -1 = unbreakable. */
  hardness: number;
  tool: ToolType;
  /** Minimum tool tier to get drops: 0 none, 1 wood, 2 stone, 3 iron, 4 diamond */
  minTier: number;
  drops: Drop[] | 'self' | 'none';
  tint: Tint;
  /** 0 none, 1 whole block sways (leaves), 2 top sways (plants) */
  waving: number;
  replaceable: boolean;
  sound: SoundGroup;
  gravity: boolean;
  /** Needs support below (plants, torches) — breaks when support is removed. */
  needsSupport: boolean;
  /** Can be interacted with (right click opens a UI or toggles). */
  interactive: boolean;
  fluid: boolean;
  climbable: boolean;
  /** Mining drops experience / item count for stack in inventory */
  stackSize: number;
  /** Color used for maps / particles fallback [r,g,b] 0..255 */
  mapColor: [number, number, number];
  flammable: boolean;
}

const defs: BlockDef[] = [];
export const BLOCKS_BY_NAME = new Map<string, BlockDef>();

type BlockOpts = Partial<Omit<BlockDef, 'textures' | 'id' | 'name'>> & {
  tex?: string | Partial<BlockTextures> & { all?: string };
};

function reg(id: number, name: string, displayName: string, opts: BlockOpts): BlockDef {
  const t = opts.tex;
  let textures: BlockTextures;
  if (t === undefined) textures = { top: name, bottom: name, side: name };
  else if (typeof t === 'string') textures = { top: t, bottom: t, side: t };
  else {
    const all = t.all ?? name;
    textures = {
      top: t.top ?? all,
      bottom: t.bottom ?? t.top ?? all,
      side: t.side ?? all,
      front: t.front,
    };
  }
  const shape = opts.shape ?? 'cube';
  const layer = opts.layer ?? (shape === 'none' ? 'none' : 'opaque');
  const def: BlockDef = {
    id,
    name,
    displayName,
    shape,
    layer,
    solid: opts.solid ?? (shape === 'cube' || shape === 'cactus' || shape === 'slab' || shape === 'farmland' || shape === 'stairs'),
    opaque: opts.opaque ?? (shape === 'cube' && layer === 'opaque'),
    lightFilter: opts.lightFilter ?? 0,
    lightEmission: opts.lightEmission ?? 0,
    textures,
    hardness: opts.hardness ?? 1,
    tool: opts.tool ?? 'none',
    minTier: opts.minTier ?? 0,
    drops: opts.drops ?? 'self',
    tint: opts.tint ?? 'none',
    waving: opts.waving ?? 0,
    replaceable: opts.replaceable ?? false,
    sound: opts.sound ?? 'stone',
    gravity: opts.gravity ?? false,
    needsSupport: opts.needsSupport ?? false,
    interactive: opts.interactive ?? false,
    fluid: opts.fluid ?? false,
    climbable: opts.climbable ?? false,
    stackSize: opts.stackSize ?? 64,
    mapColor: opts.mapColor ?? [128, 128, 128],
    flammable: opts.flammable ?? false,
  };
  defs[id] = def;
  BLOCKS_BY_NAME.set(name, def);
  return def;
}

const plant = (extra: BlockOpts = {}): BlockOpts => ({
  shape: 'cross',
  layer: 'cutout',
  solid: false,
  opaque: false,
  hardness: 0,
  replaceable: false,
  sound: 'grass',
  needsSupport: true,
  waving: 2,
  ...extra,
});

const leaves = (tint: Tint, sapling: string): BlockOpts => ({
  layer: 'cutout',
  opaque: false,
  lightFilter: 1,
  hardness: 0.2,
  tool: 'shears',
  tint,
  waving: 1,
  sound: 'grass',
  flammable: true,
  drops: [
    { item: sapling, min: 1, max: 1, chance: 0.05 },
    { item: 'apple', min: 1, max: 1, chance: tint === 'foliage' ? 0.02 : 0 },
    { item: 'stick', min: 1, max: 2, chance: 0.02 },
  ],
  mapColor: [60, 120, 40],
});

// ---- Registry --------------------------------------------------------------------------------
export const AIR = reg(0, 'air', 'Air', { shape: 'none', layer: 'none', solid: false, opaque: false, hardness: 0, replaceable: true, drops: 'none' });
reg(1, 'stone', 'Stone', { hardness: 1.5, tool: 'pickaxe', minTier: 1, drops: [{ item: 'cobblestone', min: 1, max: 1 }], mapColor: [125, 125, 125] });
reg(2, 'grass_block', 'Grass Block', {
  tex: { top: 'grass_block_top', bottom: 'dirt', side: 'grass_block_side' },
  hardness: 0.6, tool: 'shovel', sound: 'grass', tint: 'grass', drops: [{ item: 'dirt', min: 1, max: 1 }], mapColor: [95, 159, 53],
});
reg(3, 'dirt', 'Dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel', mapColor: [134, 96, 67] });
reg(4, 'cobblestone', 'Cobblestone', { hardness: 2, tool: 'pickaxe', minTier: 1, mapColor: [110, 110, 110] });
reg(5, 'oak_planks', 'Oak Planks', { hardness: 2, tool: 'axe', sound: 'wood', flammable: true, mapColor: [162, 130, 78] });
reg(6, 'bedrock', 'Bedrock', { hardness: -1, drops: 'none', mapColor: [60, 60, 60] });
reg(7, 'water', 'Water', {
  shape: 'fluid', layer: 'translucent', solid: false, opaque: false, fluid: true, lightFilter: 2,
  hardness: -1, drops: 'none', replaceable: true, tint: 'water', tex: { top: 'water_still', side: 'water_flow' }, mapColor: [64, 90, 220],
});
reg(8, 'lava', 'Lava', {
  shape: 'fluid', layer: 'opaque', solid: false, opaque: false, fluid: true, lightEmission: 15,
  hardness: -1, drops: 'none', replaceable: true, tex: { top: 'lava_still', side: 'lava_flow' }, mapColor: [220, 100, 20],
});
reg(9, 'sand', 'Sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true, mapColor: [219, 207, 163] });
reg(10, 'gravel', 'Gravel', {
  hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true,
  drops: [{ item: 'flint', min: 1, max: 1, chance: 0.1 }, { item: 'gravel', min: 1, max: 1, chance: 0.9 }], mapColor: [136, 126, 126],
});
reg(11, 'gold_ore', 'Gold Ore', { hardness: 3, tool: 'pickaxe', minTier: 3, mapColor: [143, 140, 125] });
reg(12, 'iron_ore', 'Iron Ore', { hardness: 3, tool: 'pickaxe', minTier: 2, mapColor: [136, 130, 127] });
reg(13, 'coal_ore', 'Coal Ore', { hardness: 3, tool: 'pickaxe', minTier: 1, drops: [{ item: 'coal', min: 1, max: 1 }], mapColor: [115, 115, 115] });
reg(14, 'oak_log', 'Oak Log', { tex: { top: 'oak_log_top', side: 'oak_log' }, hardness: 2, tool: 'axe', sound: 'wood', flammable: true, mapColor: [109, 85, 50] });
reg(15, 'oak_leaves', 'Oak Leaves', leaves('foliage', 'oak_sapling'));
reg(16, 'glass', 'Glass', { layer: 'cutout', opaque: false, hardness: 0.3, sound: 'glass', drops: 'none', mapColor: [200, 220, 230] });
reg(17, 'sandstone', 'Sandstone', {
  tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' }, hardness: 0.8, tool: 'pickaxe', minTier: 1, mapColor: [216, 203, 155],
});
reg(18, 'short_grass', 'Grass', plant({ tint: 'grass', replaceable: true, drops: [{ item: 'wheat_seeds', min: 1, max: 1, chance: 0.125 }], mapColor: [90, 150, 50] }));
reg(19, 'dandelion', 'Dandelion', plant({ waving: 2, mapColor: [230, 210, 40] }));
reg(20, 'poppy', 'Poppy', plant({ mapColor: [200, 30, 30] }));
reg(21, 'cornflower', 'Cornflower', plant({ mapColor: [70, 100, 220] }));
reg(22, 'diamond_ore', 'Diamond Ore', { hardness: 3, tool: 'pickaxe', minTier: 3, drops: [{ item: 'diamond', min: 1, max: 1 }], mapColor: [129, 140, 143] });
reg(23, 'crafting_table', 'Crafting Table', {
  tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' },
  hardness: 2.5, tool: 'axe', sound: 'wood', interactive: true, flammable: true, mapColor: [140, 100, 60],
});
reg(24, 'furnace', 'Furnace', {
  tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' },
  hardness: 3.5, tool: 'pickaxe', minTier: 1, interactive: true, mapColor: [100, 100, 100],
});
reg(25, 'lit_furnace', 'Furnace', {
  tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front_on' },
  hardness: 3.5, tool: 'pickaxe', minTier: 1, interactive: true, lightEmission: 13, drops: [{ item: 'furnace', min: 1, max: 1 }], mapColor: [100, 100, 100],
});
reg(26, 'chest', 'Chest', {
  tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' },
  hardness: 2.5, tool: 'axe', sound: 'wood', interactive: true, mapColor: [160, 110, 40],
});
reg(27, 'torch', 'Torch', {
  shape: 'torch', layer: 'cutout', solid: false, opaque: false, lightEmission: 14, hardness: 0, sound: 'wood', needsSupport: true, mapColor: [255, 200, 80],
});
reg(28, 'bricks', 'Bricks', { hardness: 2, tool: 'pickaxe', minTier: 1, mapColor: [150, 80, 60] });
reg(29, 'bookshelf', 'Bookshelf', {
  tex: { top: 'oak_planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', sound: 'wood', flammable: true,
  drops: [{ item: 'book', min: 3, max: 3 }], mapColor: [120, 90, 50],
});
reg(30, 'mossy_cobblestone', 'Mossy Cobblestone', { hardness: 2, tool: 'pickaxe', minTier: 1, mapColor: [100, 120, 100] });
reg(31, 'obsidian', 'Obsidian', { hardness: 50, tool: 'pickaxe', minTier: 4, mapColor: [20, 15, 30] });
reg(32, 'snow_block', 'Snow Block', { tex: 'snow', hardness: 0.2, tool: 'shovel', sound: 'snow', drops: [{ item: 'snowball', min: 4, max: 4 }], mapColor: [250, 250, 250] });
reg(33, 'ice', 'Ice', { layer: 'translucent', opaque: false, lightFilter: 2, hardness: 0.5, tool: 'pickaxe', sound: 'glass', drops: 'none', mapColor: [160, 190, 250] });
reg(34, 'clay', 'Clay', { hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: [{ item: 'clay_ball', min: 4, max: 4 }], mapColor: [160, 166, 180] });
reg(35, 'cactus', 'Cactus', {
  shape: 'cactus', layer: 'cutout', opaque: false, tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' },
  hardness: 0.4, sound: 'cloth', needsSupport: true, mapColor: [50, 120, 30],
});
reg(36, 'birch_log', 'Birch Log', { tex: { top: 'birch_log_top', side: 'birch_log' }, hardness: 2, tool: 'axe', sound: 'wood', flammable: true, mapColor: [210, 210, 200] });
reg(37, 'birch_leaves', 'Birch Leaves', leaves('birch', 'birch_sapling'));
reg(38, 'spruce_log', 'Spruce Log', { tex: { top: 'spruce_log_top', side: 'spruce_log' }, hardness: 2, tool: 'axe', sound: 'wood', flammable: true, mapColor: [60, 40, 20] });
reg(39, 'spruce_leaves', 'Spruce Leaves', leaves('spruce', 'spruce_sapling'));
reg(40, 'birch_planks', 'Birch Planks', { hardness: 2, tool: 'axe', sound: 'wood', flammable: true, mapColor: [192, 175, 121] });
reg(41, 'spruce_planks', 'Spruce Planks', { hardness: 2, tool: 'axe', sound: 'wood', flammable: true, mapColor: [114, 84, 48] });
reg(42, 'sugar_cane', 'Sugar Cane', plant({ tint: 'none', waving: 0, mapColor: [140, 190, 100] }));
reg(43, 'dead_bush', 'Dead Bush', plant({ replaceable: true, drops: [{ item: 'stick', min: 0, max: 2 }], mapColor: [120, 90, 40] }));
reg(44, 'white_wool', 'White Wool', { hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: true, mapColor: [233, 236, 236] });
reg(45, 'stone_bricks', 'Stone Bricks', { hardness: 1.5, tool: 'pickaxe', minTier: 1, mapColor: [122, 121, 122] });
reg(46, 'glowstone', 'Glowstone', { hardness: 0.3, sound: 'glass', lightEmission: 15, drops: [{ item: 'glowstone_dust', min: 2, max: 4 }], mapColor: [250, 220, 140] });
reg(47, 'iron_block', 'Block of Iron', { hardness: 5, tool: 'pickaxe', minTier: 2, sound: 'metal', mapColor: [220, 220, 220] });
reg(48, 'gold_block', 'Block of Gold', { hardness: 3, tool: 'pickaxe', minTier: 3, sound: 'metal', mapColor: [250, 210, 60] });
reg(49, 'diamond_block', 'Block of Diamond', { hardness: 5, tool: 'pickaxe', minTier: 3, sound: 'metal', mapColor: [100, 230, 225] });
reg(50, 'tnt', 'TNT', { tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, hardness: 0, sound: 'grass', interactive: true, mapColor: [200, 50, 30] });
reg(51, 'wheat', 'Wheat Crops', {
  shape: 'crop', layer: 'cutout', solid: false, opaque: false, hardness: 0, sound: 'grass', needsSupport: true, waving: 2,
  tex: 'wheat_stage7', drops: [{ item: 'wheat_seeds', min: 1, max: 1 }], mapColor: [200, 180, 70],
});
reg(52, 'farmland', 'Farmland', {
  shape: 'farmland', opaque: false, tex: { top: 'farmland', bottom: 'dirt', side: 'dirt' }, hardness: 0.6, tool: 'shovel', sound: 'gravel',
  drops: [{ item: 'dirt', min: 1, max: 1 }], mapColor: [110, 70, 40],
});
reg(53, 'oak_sapling', 'Oak Sapling', plant({ waving: 2, mapColor: [80, 140, 40] }));
reg(54, 'birch_sapling', 'Birch Sapling', plant({ waving: 2, mapColor: [120, 160, 80] }));
reg(55, 'spruce_sapling', 'Spruce Sapling', plant({ waving: 2, mapColor: [50, 90, 50] }));
reg(56, 'coal_block', 'Block of Coal', { hardness: 5, tool: 'pickaxe', minTier: 1, mapColor: [20, 20, 20] });
reg(57, 'red_mushroom', 'Red Mushroom', plant({ waving: 0, lightEmission: 0, mapColor: [200, 40, 40] }));
reg(58, 'brown_mushroom', 'Brown Mushroom', plant({ waving: 0, lightEmission: 1, mapColor: [150, 110, 80] }));
reg(59, 'pumpkin', 'Pumpkin', {
  tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' }, hardness: 1, tool: 'axe', sound: 'wood', mapColor: [220, 130, 20],
});
reg(60, 'jack_o_lantern', "Jack o'Lantern", {
  tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' }, hardness: 1, tool: 'axe', sound: 'wood', lightEmission: 15, mapColor: [230, 150, 30],
});
reg(61, 'melon', 'Melon', { tex: { top: 'melon_top', side: 'melon_side' }, hardness: 1, tool: 'axe', sound: 'wood', drops: [{ item: 'melon_slice', min: 3, max: 7 }], mapColor: [110, 150, 30] });
reg(62, 'ladder', 'Ladder', { shape: 'ladder', layer: 'cutout', solid: false, opaque: false, hardness: 0.4, tool: 'axe', sound: 'wood', climbable: true, needsSupport: true, mapColor: [150, 120, 70] });
reg(63, 'stone_slab', 'Stone Slab', { shape: 'slab', opaque: false, tex: { top: 'smooth_stone', side: 'smooth_stone_slab_side' }, hardness: 2, tool: 'pickaxe', minTier: 1, mapColor: [160, 160, 160] });
reg(64, 'oak_slab', 'Oak Slab', { shape: 'slab', opaque: false, tex: 'oak_planks', hardness: 2, tool: 'axe', sound: 'wood', mapColor: [162, 130, 78] });
reg(65, 'cobblestone_slab', 'Cobblestone Slab', { shape: 'slab', opaque: false, tex: 'cobblestone', hardness: 2, tool: 'pickaxe', minTier: 1, mapColor: [110, 110, 110] });
reg(66, 'smooth_stone', 'Smooth Stone', { hardness: 2, tool: 'pickaxe', minTier: 1, mapColor: [160, 160, 160] });
reg(67, 'snow', 'Snow', { shape: 'snow_layer', opaque: false, solid: false, hardness: 0.1, tool: 'shovel', sound: 'snow', replaceable: true, drops: [{ item: 'snowball', min: 1, max: 1 }], mapColor: [250, 250, 250] });
reg(68, 'fern', 'Fern', plant({ tint: 'grass', replaceable: true, drops: 'none', mapColor: [80, 130, 50] }));
reg(69, 'lapis_ore', 'Lapis Lazuli Ore', { hardness: 3, tool: 'pickaxe', minTier: 2, drops: [{ item: 'lapis_lazuli', min: 4, max: 8 }], mapColor: [100, 110, 150] });
reg(70, 'redstone_ore', 'Redstone Ore', { hardness: 3, tool: 'pickaxe', minTier: 3, drops: [{ item: 'redstone', min: 4, max: 5 }], mapColor: [140, 100, 100] });
reg(71, 'emerald_ore', 'Emerald Ore', { hardness: 3, tool: 'pickaxe', minTier: 3, drops: [{ item: 'emerald', min: 1, max: 1 }], mapColor: [110, 140, 120] });
reg(72, 'terracotta', 'Terracotta', { hardness: 1.25, tool: 'pickaxe', minTier: 1, mapColor: [152, 94, 67] });
reg(73, 'red_sand', 'Red Sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true, mapColor: [190, 102, 33] });
reg(74, 'bed', 'Bed', {
  shape: 'slab', opaque: false, interactive: true, tex: { top: 'bed_top', bottom: 'oak_planks', side: 'bed_side' },
  hardness: 0.2, sound: 'wood', mapColor: [180, 30, 30],
});
reg(75, 'granite', 'Granite', { hardness: 1.5, tool: 'pickaxe', minTier: 1, mapColor: [150, 105, 85] });
reg(76, 'diorite', 'Diorite', { hardness: 1.5, tool: 'pickaxe', minTier: 1, mapColor: [190, 190, 190] });
reg(77, 'andesite', 'Andesite', { hardness: 1.5, tool: 'pickaxe', minTier: 1, mapColor: [135, 135, 135] });
reg(78, 'moss_block', 'Moss Block', { hardness: 0.1, tool: 'hoe', sound: 'grass', mapColor: [90, 110, 45] });
reg(79, 'mossy_stone_bricks', 'Mossy Stone Bricks', { hardness: 1.5, tool: 'pickaxe', minTier: 1, mapColor: [110, 120, 100] });
reg(81, 'oak_door', 'Oak Door', {
  shape: 'door', layer: 'cutout', solid: true, opaque: false, interactive: true, tex: { top: 'oak_door_top', bottom: 'oak_door_bottom', side: 'oak_door_bottom' },
  hardness: 3, tool: 'axe', sound: 'wood', needsSupport: true, flammable: false, mapColor: [150, 120, 70],
});
reg(82, 'oak_stairs', 'Oak Stairs', { shape: 'stairs', opaque: false, tex: 'oak_planks', hardness: 2, tool: 'axe', sound: 'wood', flammable: true, mapColor: [162, 130, 78] });
reg(83, 'cobblestone_stairs', 'Cobblestone Stairs', { shape: 'stairs', opaque: false, tex: 'cobblestone', hardness: 2, tool: 'pickaxe', minTier: 1, mapColor: [110, 110, 110] });
reg(84, 'stone_brick_stairs', 'Stone Brick Stairs', { shape: 'stairs', opaque: false, tex: 'stone_bricks', hardness: 1.5, tool: 'pickaxe', minTier: 1, mapColor: [122, 121, 122] });
reg(85, 'oak_fence', 'Oak Fence', { shape: 'fence', opaque: false, solid: true, tex: 'oak_planks', hardness: 2, tool: 'axe', sound: 'wood', flammable: true, mapColor: [162, 130, 78] });
reg(86, 'cobblestone_wall', 'Cobblestone Wall', { shape: 'fence', opaque: false, solid: true, tex: 'cobblestone', hardness: 2, tool: 'pickaxe', minTier: 1, mapColor: [110, 110, 110] });
reg(80, 'lantern', 'Lantern', { shape: 'torch', layer: 'cutout', solid: false, opaque: false, lightEmission: 15, hardness: 3.5, tool: 'pickaxe', sound: 'metal', needsSupport: true, mapColor: [250, 200, 100] });

export const WOOL_COLORS: Array<[string, string, [number, number, number]]> = [
  ['orange', 'Orange', [240, 118, 19]],
  ['magenta', 'Magenta', [189, 68, 179]],
  ['light_blue', 'Light Blue', [58, 175, 217]],
  ['yellow', 'Yellow', [248, 198, 39]],
  ['lime', 'Lime', [112, 185, 25]],
  ['pink', 'Pink', [237, 141, 172]],
  ['gray', 'Gray', [62, 68, 71]],
  ['light_gray', 'Light Gray', [142, 142, 134]],
  ['cyan', 'Cyan', [21, 137, 145]],
  ['purple', 'Purple', [121, 42, 172]],
  ['blue', 'Blue', [53, 57, 157]],
  ['brown', 'Brown', [114, 71, 40]],
  ['green', 'Green', [84, 109, 27]],
  ['red', 'Red', [160, 39, 34]],
  ['black', 'Black', [20, 21, 25]],
];
WOOL_COLORS.forEach(([key, label, color], i) => {
  reg(100 + i, `${key}_wool`, `${label} Wool`, { hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: true, mapColor: color });
});
WOOL_COLORS.forEach(([key, label, color], i) => {
  reg(120 + i, `${key}_stained_glass`, `${label} Stained Glass`, {
    layer: 'translucent', opaque: false, hardness: 0.3, sound: 'glass', drops: 'none', mapColor: color,
  });
});

// Fill holes so indexing never returns undefined.
for (let i = 0; i < 256; i++) {
  if (!defs[i]) defs[i] = { ...AIR, id: i, name: `unknown_${i}`, displayName: 'Unknown' };
}

export const BLOCKS: readonly BlockDef[] = defs;

export function blockId(name: string): number {
  const b = BLOCKS_BY_NAME.get(name);
  if (!b) throw new Error(`Unknown block ${name}`);
  return b.id;
}

/** Commonly used ids (resolved once for speed). */
export const B = {
  air: 0,
  stone: blockId('stone'),
  grass: blockId('grass_block'),
  dirt: blockId('dirt'),
  cobblestone: blockId('cobblestone'),
  oakPlanks: blockId('oak_planks'),
  bedrock: blockId('bedrock'),
  water: blockId('water'),
  lava: blockId('lava'),
  sand: blockId('sand'),
  gravel: blockId('gravel'),
  goldOre: blockId('gold_ore'),
  ironOre: blockId('iron_ore'),
  coalOre: blockId('coal_ore'),
  diamondOre: blockId('diamond_ore'),
  lapisOre: blockId('lapis_ore'),
  redstoneOre: blockId('redstone_ore'),
  emeraldOre: blockId('emerald_ore'),
  oakLog: blockId('oak_log'),
  oakLeaves: blockId('oak_leaves'),
  birchLog: blockId('birch_log'),
  birchLeaves: blockId('birch_leaves'),
  spruceLog: blockId('spruce_log'),
  spruceLeaves: blockId('spruce_leaves'),
  glass: blockId('glass'),
  sandstone: blockId('sandstone'),
  shortGrass: blockId('short_grass'),
  fern: blockId('fern'),
  dandelion: blockId('dandelion'),
  poppy: blockId('poppy'),
  cornflower: blockId('cornflower'),
  craftingTable: blockId('crafting_table'),
  furnace: blockId('furnace'),
  litFurnace: blockId('lit_furnace'),
  chest: blockId('chest'),
  torch: blockId('torch'),
  snowBlock: blockId('snow_block'),
  snow: blockId('snow'),
  ice: blockId('ice'),
  clay: blockId('clay'),
  cactus: blockId('cactus'),
  sugarCane: blockId('sugar_cane'),
  deadBush: blockId('dead_bush'),
  wheat: blockId('wheat'),
  farmland: blockId('farmland'),
  oakSapling: blockId('oak_sapling'),
  birchSapling: blockId('birch_sapling'),
  spruceSapling: blockId('spruce_sapling'),
  redMushroom: blockId('red_mushroom'),
  brownMushroom: blockId('brown_mushroom'),
  pumpkin: blockId('pumpkin'),
  melon: blockId('melon'),
  tnt: blockId('tnt'),
  obsidian: blockId('obsidian'),
  mossyCobblestone: blockId('mossy_cobblestone'),
  terracotta: blockId('terracotta'),
  redSand: blockId('red_sand'),
  granite: blockId('granite'),
  diorite: blockId('diorite'),
  andesite: blockId('andesite'),
  bed: blockId('bed'),
  ladder: blockId('ladder'),
  mossBlock: blockId('moss_block'),
} as const;

export const blockOf = (state: number): BlockDef => defs[state & 0xff];
export const idOf = (state: number): number => state & 0xff;
export const metaOf = (state: number): number => state >> 8;
export const makeState = (id: number, meta = 0): number => (id & 0xff) | ((meta & 0xff) << 8);

/** Directional blocks store facing in meta: 0=+X 1=-X 4=+Z 5=-Z (same as Face indices). */
export function isDirectional(id: number): boolean {
  return id === B.furnace || id === B.litFurnace || id === B.chest || id === B.craftingTable || id === blockId('jack_o_lantern') || id === B.pumpkin;
}
export function isLog(id: number): boolean {
  return id === B.oakLog || id === B.birchLog || id === B.spruceLog;
}
export function isLeaves(id: number): boolean {
  return id === B.oakLeaves || id === B.birchLeaves || id === B.spruceLeaves;
}

/** Fluid meta: 0 = source, 1..7 = flowing distance, bit 3 (8) = falling. */
export function fluidHeight(meta: number): number {
  if (meta & 8) return 1;
  const level = meta & 7;
  return level === 0 ? 0.889 : Math.max(0.1, (8 - level) / 9);
}

export function allTextureNames(): string[] {
  const set = new Set<string>();
  for (const b of defs) {
    if (b.shape === 'none') continue;
    set.add(b.textures.top);
    set.add(b.textures.bottom);
    set.add(b.textures.side);
    if (b.textures.front) set.add(b.textures.front);
  }
  // Extra textures referenced by meshing code
  for (let i = 0; i < 8; i++) set.add(`wheat_stage${i}`);
  set.add('grass_block_side_overlay');
  set.add('grass_block_snow');
  set.add('destroy_stage_0');
  for (let i = 0; i < 10; i++) set.add(`destroy_stage_${i}`);
  set.add('torch_fire');
  set.add('oak_door_item');
  return [...set];
}

/**
 * Door geometry. Meta: bits 0-1 facing (0 +X, 1 +Z, 2 -X, 3 -Z), bit 2 open, bit 3 upper half.
 * Returns the panel box in pixels [x0,y0,z0,x1,y1,z1] (0..16).
 */
export function doorPanel(meta: number): [number, number, number, number, number, number] {
  const facing = meta & 3;
  const open = (meta >> 2) & 1;
  const edge = (facing + open) % 4;
  switch (edge) {
    case 0: return [13, 0, 0, 16, 16, 16];
    case 1: return [0, 0, 13, 16, 16, 16];
    case 2: return [0, 0, 0, 3, 16, 16];
    default: return [0, 0, 0, 16, 16, 3];
  }
}

/** Stair geometry in pixels. Meta: bits 0-1 facing (tall side: 0 +X, 1 +Z, 2 -X, 3 -Z), bit 2 upside-down. */
export function stairBoxes(meta: number): Array<[number, number, number, number, number, number]> {
  const f = meta & 3;
  const inv = (meta & 4) !== 0;
  const base: [number, number, number, number, number, number] = inv ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16];
  const y0 = inv ? 0 : 8, y1 = inv ? 8 : 16;
  const step: [number, number, number, number, number, number] =
    f === 0 ? [8, y0, 0, 16, y1, 16] : f === 1 ? [0, y0, 8, 16, y1, 16] : f === 2 ? [0, y0, 0, 8, y1, 16] : [0, y0, 0, 16, y1, 8];
  return [base, step];
}

/** Does a fence/wall at some position connect to a neighbour with this state? */
export function fenceConnects(self: number, neighbour: number): boolean {
  const n = defs[neighbour & 0xff];
  if (n.shape === 'fence') return (self & 0xff) === (neighbour & 0xff) || defs[self & 0xff].name.endsWith('wall') === n.name.endsWith('wall');
  return n.opaque && n.shape === 'cube';
}

/**
 * Fence / wall geometry in pixels for a connection mask (bit0 +X, bit1 +Z, bit2 -X, bit3 -Z).
 * Fences: 4px post with two rails; walls: 8px post with a thick 13px-tall wall.
 */
export function fenceBoxes(state: number, mask: number, collision = false): Array<[number, number, number, number, number, number]> {
  const wall = defs[state & 0xff].name.endsWith('wall');
  const top = collision ? 24 : 16;
  const p0 = wall ? 4 : 6, p1 = wall ? 12 : 10;
  const out: Array<[number, number, number, number, number, number]> = [[p0, 0, p0, p1, top, p1]];
  const rails: Array<[number, number]> = collision ? [[0, 24]] : wall ? [[0, 13]] : [[6, 9], [12, 15]];
  const t0 = wall ? 5 : 7, t1 = wall ? 11 : 9;
  for (const [y0, y1] of rails) {
    if (mask & 1) out.push([p1, y0, t0, 16, y1, t1]);
    if (mask & 2) out.push([t0, y0, p1, t1, y1, 16]);
    if (mask & 4) out.push([0, y0, t0, p0, y1, t1]);
    if (mask & 8) out.push([t0, y0, 0, t1, y1, p0]);
  }
  return out;
}
