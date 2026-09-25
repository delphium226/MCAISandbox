import { Slot, Window, range } from '../../shared/src/inventory';
import { ItemStack, itemDef, itemId } from '../../shared/src/items';
import { matchRecipe, smeltResult, fuelValue, SMELT_TIME } from '../../shared/src/recipes';
import type { Player } from './player';
import type { WindowKind } from '../../shared/src/protocol';

export interface FurnaceState {
  kind: 'furnace';
  input: ItemStack | null;
  fuel: ItemStack | null;
  output: ItemStack | null;
  burn: number;
  burnMax: number;
  cook: number;
}
export interface ChestState {
  kind: 'chest';
  items: (ItemStack | null)[];
}
export type BlockEntity = FurnaceState | ChestState;

export interface OpenWindow {
  id: number;
  kind: WindowKind;
  title: string;
  win: Window;
  /** Block position for container windows */
  pos?: [number, number, number];
  props?: () => number[];
  /** Called when closed (return crafting grid items etc.) */
  onClose?: () => void;
}

function arraySlot(arr: (ItemStack | null)[], i: number, section: number, extra: Partial<Slot> = {}): Slot {
  return {
    get: () => arr[i],
    set: (s) => (arr[i] = s && s.count > 0 ? s : null),
    section,
    ...extra,
  };
}

/** Player inventory slots in window order: main (inv 9..35) then hotbar (inv 0..8). */
function inventorySlots(p: Player, section: number): Slot[] {
  const out: Slot[] = [];
  for (let i = 9; i < 36; i++) out.push(arraySlot(p.inventory, i, section));
  for (let i = 0; i < 9; i++) out.push(arraySlot(p.inventory, i, section + 1));
  return out;
}

function craftingSlots(grid: (ItemStack | null)[], w: number, h: number, onCraft: (s: ItemStack) => void): Slot[] {
  const result: Slot = {
    section: 0,
    output: true,
    get: () => {
      const r = matchRecipe(grid, w, h);
      return r ? { id: r.id, count: r.count } : null;
    },
    set: () => {},
    onTake: (s) => {
      for (let i = 0; i < grid.length; i++) {
        const g = grid[i];
        if (!g) continue;
        const def = itemDef(g.id);
        grid[i] = g.count > 1 ? { ...g, count: g.count - 1 } : null;
        // Container items are returned (buckets)
        if (def.name === 'water_bucket' || def.name === 'lava_bucket') grid[i] = { id: itemId('bucket'), count: 1 };
      }
      onCraft(s);
    },
  };
  const slots: Slot[] = [result];
  for (let i = 0; i < w * h; i++) slots.push(arraySlot(grid, i, 1));
  return slots;
}

export function playerWindow(p: Player): OpenWindow {
  const craft = craftingSlots(p.craftGrid, 2, 2, (s) => p.onCrafted(s));
  const armor: Slot[] = [0, 1, 2, 3].map((i) =>
    arraySlot(p.armor, i, 2, { accepts: (s) => itemDef(s.id).armor?.slot === i || (i === 0 && itemDef(s.id).name === 'pumpkin'), maxStack: 1 }),
  );
  const inv = inventorySlots(p, 3); // main = section 3, hotbar = section 4
  const slots = [...craft, ...armor, ...inv];
  const MAIN = range(9, 36), HOT = range(36, 45), ALL = range(9, 45);
  const win = new Window(slots, (i, stack) => {
    if (i === 0) return [...range(36, 45).reverse(), ...range(9, 36).reverse()];
    if (i <= 4) return ALL;
    if (i <= 8) return ALL;
    const a = itemDef(stack.id).armor;
    if (a && !p.armor[a.slot]) return [5 + a.slot];
    if (i < 36) return HOT;
    return MAIN;
  });
  return {
    id: 0,
    kind: 'player',
    title: 'Crafting',
    win,
    onClose: () => {
      for (let i = 0; i < 4; i++) {
        const s = p.craftGrid[i];
        if (s) p.giveOrDrop(s);
        p.craftGrid[i] = null;
      }
    },
  };
}

export function craftingTableWindow(p: Player, id: number, pos: [number, number, number]): OpenWindow {
  const grid: (ItemStack | null)[] = new Array(9).fill(null);
  const craft = craftingSlots(grid, 3, 3, (s) => p.onCrafted(s));
  const inv = inventorySlots(p, 2);
  const slots = [...craft, ...inv];
  const win = new Window(slots, (i) => {
    if (i === 0) return [...range(37, 46).reverse(), ...range(10, 37).reverse()];
    if (i <= 9) return range(10, 46);
    if (i < 37) return range(37, 46);
    return range(10, 37);
  });
  return {
    id,
    kind: 'crafting_table',
    title: 'Crafting',
    win,
    pos,
    onClose: () => {
      for (const s of grid) if (s) p.giveOrDrop(s);
    },
  };
}

export function furnaceWindow(p: Player, id: number, pos: [number, number, number], f: FurnaceState): OpenWindow {
  const slots: Slot[] = [
    { section: 0, get: () => f.input, set: (s) => (f.input = s) },
    { section: 0, get: () => f.fuel, set: (s) => (f.fuel = s), accepts: (s) => fuelValue(s.id) > 0 },
    {
      section: 0,
      output: true,
      get: () => f.output,
      set: (s) => (f.output = s),
      onTake: (taken) => {
        f.output = null;
        // Smelting experience: roughly 0.35 per item, like Minecraft ores/food
        const n = Math.floor(taken.count * 0.35 + Math.random());
        if (n > 0) p.addXp(n);
      },
    },
    ...inventorySlots(p, 1),
  ];
  const win = new Window(slots, (i, stack) => {
    // Minecraft: the output goes hotbar-first (reverse), input/fuel go main-inventory-first
    if (i === 2) return [...range(30, 39).reverse(), ...range(3, 30).reverse()];
    if (i < 2) return range(3, 39);
    if (smeltResult(stack.id) !== null) return [0];
    if (fuelValue(stack.id) > 0) return [1];
    if (i < 30) return range(30, 39);
    return range(3, 30);
  });
  return {
    id,
    kind: 'furnace',
    title: 'Furnace',
    win,
    pos,
    props: () => [f.cook / SMELT_TIME, f.burnMax ? f.burn / f.burnMax : 0],
  };
}

export function chestWindow(p: Player, id: number, pos: [number, number, number], c: ChestState): OpenWindow {
  const slots: Slot[] = [...c.items.map((_, i) => arraySlot(c.items, i, 0)), ...inventorySlots(p, 1)];
  const win = new Window(slots, (i) => {
    if (i < 27) return [...range(54, 63).reverse(), ...range(27, 54).reverse()];
    return range(0, 27);
  });
  return { id, kind: 'chest', title: 'Chest', win, pos };
}

/** Advance a furnace one tick. Returns [changed, litStateChanged]. */
export function tickFurnace(f: FurnaceState): { changed: boolean; lit: boolean } {
  const wasLit = f.burn > 0;
  let changed = false;
  if (f.burn > 0) f.burn--;
  const result = f.input ? smeltResult(f.input.id) : null;
  const canSmelt =
    result !== null && (!f.output || (f.output.id === result && f.output.count < itemDef(result).stackSize));
  if (f.burn <= 0 && canSmelt && f.fuel) {
    const fv = fuelValue(f.fuel.id);
    if (fv > 0) {
      f.burn = f.burnMax = fv;
      const fuelName = itemDef(f.fuel.id).name;
      f.fuel = f.fuel.count > 1 ? { ...f.fuel, count: f.fuel.count - 1 } : fuelName === 'lava_bucket' ? { id: itemId('bucket'), count: 1 } : null;
      changed = true;
    }
  }
  if (f.burn > 0 && canSmelt) {
    f.cook++;
    if (f.cook >= SMELT_TIME) {
      f.cook = 0;
      f.input = f.input!.count > 1 ? { ...f.input!, count: f.input!.count - 1 } : null;
      f.output = f.output ? { ...f.output, count: f.output.count + 1 } : { id: result!, count: 1 };
      changed = true;
    }
  } else if (f.cook > 0) {
    f.cook = Math.max(0, f.cook - 2);
  }
  const isLit = f.burn > 0;
  return { changed: changed || f.burn > 0 || f.cook > 0, lit: wasLit !== isLit };
}
