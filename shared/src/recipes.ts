import { ItemStack, itemId, ITEMS_BY_NAME, itemDef } from './items';
import { WOOL_COLORS } from './blocks';

/** Ingredient: item name or tag starting with '#'. */
type Ingredient = string;

export interface ShapedRecipe {
  kind: 'shaped';
  pattern: string[];
  key: Record<string, Ingredient>;
  result: { item: string; count: number };
}
export interface ShapelessRecipe {
  kind: 'shapeless';
  ingredients: Ingredient[];
  result: { item: string; count: number };
}
export type Recipe = ShapedRecipe | ShapelessRecipe;

export const TAGS: Record<string, string[]> = {
  planks: ['oak_planks', 'birch_planks', 'spruce_planks'],
  logs: ['oak_log', 'birch_log', 'spruce_log'],
  wool: ['white_wool', ...WOOL_COLORS.map(([k]) => `${k}_wool`)],
  coals: ['coal', 'charcoal'],
  stone_tool_materials: ['cobblestone'],
};

const tagIds = new Map<string, Set<number>>();
function matches(ing: Ingredient, id: number): boolean {
  if (ing.startsWith('#')) {
    let set = tagIds.get(ing);
    if (!set) {
      set = new Set((TAGS[ing.slice(1)] ?? []).map(itemId));
      tagIds.set(ing, set);
    }
    return set.has(id);
  }
  const it = ITEMS_BY_NAME.get(ing);
  return !!it && it.id === id;
}

export const RECIPES: Recipe[] = [];
const shaped = (pattern: string[], key: Record<string, Ingredient>, item: string, count = 1) =>
  RECIPES.push({ kind: 'shaped', pattern, key, result: { item, count } });
const shapeless = (ingredients: Ingredient[], item: string, count = 1) =>
  RECIPES.push({ kind: 'shapeless', ingredients, result: { item, count } });

// Wood
shapeless(['oak_log'], 'oak_planks', 4);
shapeless(['birch_log'], 'birch_planks', 4);
shapeless(['spruce_log'], 'spruce_planks', 4);
shaped(['#', '#'], { '#': '#planks' }, 'stick', 4);
shaped(['##', '##'], { '#': '#planks' }, 'crafting_table');
shaped(['###', '# #', '###'], { '#': '#planks' }, 'chest');
shaped(['###', '# #', '###'], { '#': 'cobblestone' }, 'furnace');
shaped(['C', 'S'], { C: '#coals', S: 'stick' }, 'torch', 4);
shaped(['S S', 'SSS', 'S S'], { S: 'stick' }, 'ladder', 3);
shaped(['##', '##', '##'], { '#': '#planks' }, 'oak_door', 3);
shaped(['###'], { '#': 'oak_planks' }, 'oak_slab', 6);
shaped(['#  ', '## ', '###'], { '#': '#planks' }, 'oak_stairs', 4);
shaped(['#  ', '## ', '###'], { '#': 'cobblestone' }, 'cobblestone_stairs', 4);
shaped(['#  ', '## ', '###'], { '#': 'stone_bricks' }, 'stone_brick_stairs', 4);
shaped(['###'], { '#': 'cobblestone' }, 'cobblestone_slab', 6);
shaped(['###'], { '#': 'smooth_stone' }, 'stone_slab', 6);
shaped(['# #', ' # '], { '#': '#planks' }, 'bowl', 4);
shaped(['###', 'BBB', '###'], { '#': '#planks', B: 'book' }, 'bookshelf');
shaped(['WWW', '###'], { W: '#wool', '#': '#planks' }, 'bed');

// Stone & building
shaped(['##', '##'], { '#': 'stone' }, 'stone_bricks', 4);
shaped(['##', '##'], { '#': 'sand' }, 'sandstone');
shaped(['##', '##'], { '#': 'brick' }, 'bricks');
shaped(['##', '##'], { '#': 'clay_ball' }, 'clay');
shaped(['##', '##'], { '#': 'snowball' }, 'snow_block');
shaped(['##', '##'], { '#': 'glowstone_dust' }, 'glowstone');
shaped(['##', '##'], { '#': 'string' }, 'white_wool');
shapeless(['cobblestone', 'moss_block'], 'mossy_cobblestone');
shapeless(['stone_bricks', 'moss_block'], 'mossy_stone_bricks');
shaped(['###', '###', '###'], { '#': 'iron_ingot' }, 'iron_block');
shaped(['###', '###', '###'], { '#': 'gold_ingot' }, 'gold_block');
shaped(['###', '###', '###'], { '#': 'diamond' }, 'diamond_block');
shaped(['###', '###', '###'], { '#': 'coal' }, 'coal_block');
shapeless(['iron_block'], 'iron_ingot', 9);
shapeless(['gold_block'], 'gold_ingot', 9);
shapeless(['diamond_block'], 'diamond', 9);
shapeless(['coal_block'], 'coal', 9);
shaped(['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' }, 'tnt');
shaped(['P', 'T'], { P: 'pumpkin', T: 'torch' }, 'jack_o_lantern');
shaped(['III', 'ITI', 'III'], { I: 'iron_ingot', T: 'torch' }, 'lantern');

// Tools
const TOOL_MATERIALS: Array<[string, Ingredient]> = [
  ['wooden', '#planks'],
  ['stone', 'cobblestone'],
  ['iron', 'iron_ingot'],
  ['golden', 'gold_ingot'],
  ['diamond', 'diamond'],
];
for (const [mat, ing] of TOOL_MATERIALS) {
  shaped(['###', ' S ', ' S '], { '#': ing, S: 'stick' }, `${mat}_pickaxe`);
  shaped(['##', '#S', ' S'], { '#': ing, S: 'stick' }, `${mat}_axe`);
  shaped(['#', 'S', 'S'], { '#': ing, S: 'stick' }, `${mat}_shovel`);
  shaped(['#', '#', 'S'], { '#': ing, S: 'stick' }, `${mat}_sword`);
  shaped(['##', ' S', ' S'], { '#': ing, S: 'stick' }, `${mat}_hoe`);
}
const ARMOR_MATERIALS: Array<[string, Ingredient]> = [
  ['leather', 'leather'],
  ['iron', 'iron_ingot'],
  ['golden', 'gold_ingot'],
  ['diamond', 'diamond'],
];
for (const [mat, ing] of ARMOR_MATERIALS) {
  shaped(['###', '# #'], { '#': ing }, `${mat}_helmet`);
  shaped(['# #', '###', '###'], { '#': ing }, `${mat}_chestplate`);
  shaped(['###', '# #', '# #'], { '#': ing }, `${mat}_leggings`);
  shaped(['# #', '# #'], { '#': ing }, `${mat}_boots`);
}
shaped([' #', '# '], { '#': 'iron_ingot' }, 'shears');
shaped(['# #', ' # '], { '#': 'iron_ingot' }, 'bucket');
shapeless(['iron_ingot', 'flint'], 'flint_and_steel');
shaped([' #S', '# S', ' #S'], { '#': 'stick', S: 'string' }, 'bow');
shaped(['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' }, 'arrow', 4);

// Food & misc
shaped(['###'], { '#': 'wheat' }, 'bread');
shapeless(['red_mushroom', 'brown_mushroom', 'bowl'], 'mushroom_stew');
shaped(['###', '#A#', '###'], { '#': 'gold_ingot', A: 'apple' }, 'golden_apple');
shapeless(['sugar_cane'], 'sugar');
shaped(['###'], { '#': 'sugar_cane' }, 'paper', 3);
shapeless(['paper', 'paper', 'paper', 'leather'], 'book');
shapeless(['bone'], 'bone_meal', 3);
shapeless(['melon_slice', 'melon_slice', 'melon_slice', 'melon_slice', 'melon_slice', 'melon_slice', 'melon_slice', 'melon_slice', 'melon_slice'], 'melon');

// Validate recipe references at load so typos surface immediately.
for (const r of RECIPES) {
  const ings = r.kind === 'shaped' ? Object.values(r.key) : r.ingredients;
  for (const ing of [...ings, r.result.item]) {
    if (ing.startsWith('#')) continue;
    if (!ITEMS_BY_NAME.has(ing)) throw new Error(`Recipe references unknown item ${ing}`);
  }
}

/**
 * Match a crafting grid (width x height, row-major, null for empty) against all recipes.
 */
export function matchRecipe(grid: (ItemStack | null)[], width: number, height: number): { id: number; count: number } | null {
  // Bounding box of non-empty cells
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const ids: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const s = grid[y * width + x];
      if (s && s.count > 0) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        ids.push(s.id);
      }
    }
  if (maxX < 0) return null;
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const at = (x: number, y: number) => {
    const s = grid[(y + minY) * width + (x + minX)];
    return s && s.count > 0 ? s.id : 0;
  };

  for (const r of RECIPES) {
    if (r.kind === 'shapeless') {
      if (r.ingredients.length !== ids.length) continue;
      const remaining = [...ids];
      let ok = true;
      for (const ing of r.ingredients) {
        const idx = remaining.findIndex((id) => matches(ing, id));
        if (idx < 0) { ok = false; break; }
        remaining.splice(idx, 1);
      }
      if (ok) return { id: itemId(r.result.item), count: r.result.count };
      continue;
    }
    const ph = r.pattern.length;
    const pw = Math.max(...r.pattern.map((row) => row.length));
    if (pw !== bw || ph !== bh) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < ph && ok; y++)
        for (let x = 0; x < pw && ok; x++) {
          const px = mirror ? pw - 1 - x : x;
          const ch = r.pattern[y][px] ?? ' ';
          const id = at(x, y);
          if (ch === ' ') ok = id === 0;
          else ok = id !== 0 && matches(r.key[ch], id);
        }
      if (ok) return { id: itemId(r.result.item), count: r.result.count };
    }
  }
  return null;
}

// ---- Smelting ----------------------------------------------------------------------------------
export const SMELTING: Record<string, string> = {
  iron_ore: 'iron_ingot',
  gold_ore: 'gold_ingot',
  sand: 'glass',
  red_sand: 'glass',
  cobblestone: 'stone',
  stone: 'smooth_stone',
  clay_ball: 'brick',
  clay: 'terracotta',
  oak_log: 'charcoal',
  birch_log: 'charcoal',
  spruce_log: 'charcoal',
  porkchop: 'cooked_porkchop',
  beef: 'cooked_beef',
  chicken: 'cooked_chicken',
  mutton: 'cooked_mutton',
  cactus: 'green_wool',
  diamond_ore: 'diamond',
  coal_ore: 'coal',
  emerald_ore: 'emerald',
  lapis_ore: 'lapis_lazuli',
  redstone_ore: 'redstone',
};
export const SMELT_TIME = 200; // ticks

export function smeltResult(id: number): number | null {
  const name = itemDef(id).name;
  const out = SMELTING[name];
  return out ? itemId(out) : null;
}

export function fuelValue(id: number): number {
  return itemDef(id).fuel ?? 0;
}

/** Recipes that produce a given item (for a recipe book / agent planning). */
export function recipesFor(itemName: string): Recipe[] {
  return RECIPES.filter((r) => r.result.item === itemName);
}
