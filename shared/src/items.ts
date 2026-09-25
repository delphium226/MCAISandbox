import { BLOCKS, BlockDef, ToolType } from './blocks';

/**
 * Item registry. Ids 0..255 are block items (same id as the block), 256+ are pure items.
 */
export interface ToolInfo {
  type: ToolType;
  tier: number; // 1 wood, 2 stone, 3 iron, 4 diamond, (gold = 1 tier but fast)
  speed: number;
  durability: number;
  damage: number;
}

export interface FoodInfo {
  hunger: number;
  saturation: number;
}

export interface ArmorInfo {
  slot: 0 | 1 | 2 | 3; // helmet, chestplate, leggings, boots
  defense: number;
  durability: number;
}

export interface ItemDef {
  id: number;
  name: string;
  displayName: string;
  stackSize: number;
  block?: BlockDef;
  /** Block placed when using this item (e.g. seeds -> wheat). */
  places?: string;
  tool?: ToolInfo;
  food?: FoodInfo;
  armor?: ArmorInfo;
  /** Burn time in ticks when used as furnace fuel. */
  fuel?: number;
  /** Texture key for the 2D icon (items) — blocks render as 3D icons. */
  icon: string;
  /** Render as flat sprite even though it is a block item (torches, plants). */
  flatIcon?: boolean;
}

const items: ItemDef[] = [];
export const ITEMS_BY_NAME = new Map<string, ItemDef>();

function add(def: ItemDef) {
  items[def.id] = def;
  ITEMS_BY_NAME.set(def.name, def);
}

// Block items
const FLAT_BLOCK_SHAPES = new Set(['cross', 'torch', 'crop', 'ladder', 'door']);
for (const b of BLOCKS) {
  if (b.id === 0 || b.name.startsWith('unknown_')) continue;
  const flat = FLAT_BLOCK_SHAPES.has(b.shape);
  add({
    id: b.id,
    name: b.name,
    displayName: b.displayName,
    stackSize: b.stackSize,
    block: b,
    icon: flat ? (b.shape === 'crop' ? 'wheat_stage7' : b.shape === 'door' ? 'oak_door_item' : b.textures.side) : b.name,
    flatIcon: flat,
    fuel: b.flammable && b.shape === 'cube' ? 300 : undefined,
  });
}

let nextId = 256;
function item(name: string, displayName: string, extra: Partial<ItemDef> = {}): ItemDef {
  const def: ItemDef = { id: nextId++, name, displayName, stackSize: 64, icon: name, ...extra };
  add(def);
  return def;
}

item('stick', 'Stick', { fuel: 100 });
item('coal', 'Coal', { fuel: 1600 });
item('charcoal', 'Charcoal', { fuel: 1600 });
item('iron_ingot', 'Iron Ingot');
item('gold_ingot', 'Gold Ingot');
item('diamond', 'Diamond');
item('emerald', 'Emerald');
item('lapis_lazuli', 'Lapis Lazuli');
item('redstone', 'Redstone Dust');
item('flint', 'Flint');
item('clay_ball', 'Clay Ball');
item('brick', 'Brick');
item('glowstone_dust', 'Glowstone Dust');
item('snowball', 'Snowball', { stackSize: 16 });
item('book', 'Book');
item('paper', 'Paper');
item('sugar', 'Sugar');
item('bone', 'Bone');
item('bone_meal', 'Bone Meal');
item('string', 'String');
item('feather', 'Feather');
item('gunpowder', 'Gunpowder');
item('leather', 'Leather');
item('arrow', 'Arrow');
item('bow', 'Bow', { stackSize: 1, tool: { type: 'none', tier: 0, speed: 1, durability: 384, damage: 1 } });
item('bowl', 'Bowl', { fuel: 100 });
item('bucket', 'Bucket', { stackSize: 16 });
item('water_bucket', 'Water Bucket', { stackSize: 1 });
item('lava_bucket', 'Lava Bucket', { stackSize: 1, fuel: 20000 });
item('flint_and_steel', 'Flint and Steel', { stackSize: 1, tool: { type: 'none', tier: 0, speed: 1, durability: 64, damage: 1 } });
item('shears', 'Shears', { stackSize: 1, tool: { type: 'shears', tier: 2, speed: 5, durability: 238, damage: 1 } });
item('wheat_seeds', 'Wheat Seeds', { places: 'wheat' });
item('wheat', 'Wheat');
item('bread', 'Bread', { food: { hunger: 5, saturation: 6 } });
item('apple', 'Apple', { food: { hunger: 4, saturation: 2.4 } });
item('golden_apple', 'Golden Apple', { food: { hunger: 4, saturation: 9.6 } });
item('melon_slice', 'Melon Slice', { food: { hunger: 2, saturation: 1.2 } });
item('porkchop', 'Raw Porkchop', { food: { hunger: 3, saturation: 1.8 } });
item('cooked_porkchop', 'Cooked Porkchop', { food: { hunger: 8, saturation: 12.8 } });
item('beef', 'Raw Beef', { food: { hunger: 3, saturation: 1.8 } });
item('cooked_beef', 'Steak', { food: { hunger: 8, saturation: 12.8 } });
item('chicken', 'Raw Chicken', { food: { hunger: 2, saturation: 1.2 } });
item('cooked_chicken', 'Cooked Chicken', { food: { hunger: 6, saturation: 7.2 } });
item('mutton', 'Raw Mutton', { food: { hunger: 2, saturation: 1.2 } });
item('cooked_mutton', 'Cooked Mutton', { food: { hunger: 6, saturation: 9.6 } });
item('rotten_flesh', 'Rotten Flesh', { food: { hunger: 4, saturation: 0.8 } });
item('mushroom_stew', 'Mushroom Stew', { stackSize: 1, food: { hunger: 6, saturation: 7.2 } });
item('egg', 'Egg', { stackSize: 16 });

// Tools
const TIERS: Array<[string, string, number, number, number, number]> = [
  // key, label, tier, speed, durability, damageBonus
  ['wooden', 'Wooden', 1, 2, 59, 0],
  ['stone', 'Stone', 2, 4, 131, 1],
  ['iron', 'Iron', 3, 6, 250, 2],
  ['golden', 'Golden', 1, 12, 32, 0],
  ['diamond', 'Diamond', 4, 8, 1561, 3],
];
const TOOL_KINDS: Array<[ToolType, string, number]> = [
  ['pickaxe', 'Pickaxe', 2],
  ['axe', 'Axe', 7],
  ['shovel', 'Shovel', 2.5],
  ['sword', 'Sword', 4],
  ['hoe', 'Hoe', 1],
];
for (const [key, label, tier, speed, durability, dmg] of TIERS) {
  for (const [type, kindLabel, baseDamage] of TOOL_KINDS) {
    item(`${key}_${type}`, `${label} ${kindLabel}`, {
      stackSize: 1,
      tool: { type, tier, speed, durability, damage: baseDamage + dmg },
      fuel: key === 'wooden' ? 200 : undefined,
    });
  }
}

// Armor
const ARMOR_MATS: Array<[string, string, number[], number]> = [
  ['leather', 'Leather', [1, 3, 2, 1], 5],
  ['iron', 'Iron', [2, 6, 5, 2], 15],
  ['golden', 'Golden', [2, 5, 3, 1], 7],
  ['diamond', 'Diamond', [3, 8, 6, 3], 33],
];
const ARMOR_PIECES: Array<[string, string, number]> = [
  ['helmet', 'Cap', 11],
  ['chestplate', 'Tunic', 16],
  ['leggings', 'Pants', 15],
  ['boots', 'Boots', 13],
];
for (const [key, label, defense, durMul] of ARMOR_MATS) {
  ARMOR_PIECES.forEach(([piece, leatherLabel, durBase], slot) => {
    const pieceLabel = key === 'leather' ? leatherLabel : piece[0].toUpperCase() + piece.slice(1);
    item(`${key}_${piece}`, `${label} ${pieceLabel}`, {
      stackSize: 1,
      armor: { slot: slot as 0 | 1 | 2 | 3, defense: defense[slot], durability: durBase * durMul },
    });
  });
}

for (let i = 0; i < 65536 && i < nextId; i++) {
  if (!items[i]) items[i] = { id: i, name: `unknown_${i}`, displayName: 'Unknown', stackSize: 64, icon: 'unknown' };
}

export const ITEMS: readonly ItemDef[] = items;
export const ITEM_COUNT = nextId;

export function itemId(name: string): number {
  const it = ITEMS_BY_NAME.get(name);
  if (!it) throw new Error(`Unknown item ${name}`);
  return it.id;
}
export function itemByName(name: string): ItemDef {
  const it = ITEMS_BY_NAME.get(name);
  if (!it) throw new Error(`Unknown item ${name}`);
  return it;
}
export function itemDef(id: number): ItemDef {
  return items[id] ?? items[0];
}

export interface ItemStack {
  id: number;
  count: number;
  /** Damage taken (for tools). */
  damage?: number;
}

export function stackSizeOf(id: number): number {
  return itemDef(id).stackSize;
}

export function sameItem(a: ItemStack | null, b: ItemStack | null): boolean {
  return !!a && !!b && a.id === b.id && (a.damage ?? 0) === (b.damage ?? 0);
}

export function cloneStack(s: ItemStack | null): ItemStack | null {
  return s ? { ...s } : null;
}

/** All item names that should appear in the creative inventory, in a pleasant order. */
export function creativeItems(): number[] {
  const out: number[] = [];
  for (const it of items) {
    if (!it || it.id === 0 || it.name.startsWith('unknown_')) continue;
    if (['lit_furnace', 'wheat', 'farmland', 'water', 'lava', 'bed'].includes(it.name) && it.block) continue;
    out.push(it.id);
  }
  return out;
}
