import { ItemStack, itemDef, sameItem, stackSizeOf } from './items';

/**
 * A slot inside an open window. Windows are built from slot references so the same
 * click logic works for the player inventory, crafting tables, furnaces and chests.
 */
export interface Slot {
  get(): ItemStack | null;
  set(s: ItemStack | null): void;
  /** Whether this stack may be placed here. */
  accepts?(s: ItemStack): boolean;
  /** Output slots cannot receive items; taking triggers onTake. */
  output?: boolean;
  onTake?(taken: ItemStack): void;
  maxStack?: number;
  /** Section index used for shift-click routing. */
  section: number;
}

export interface ShiftRoute {
  /** For a click in section s, list of sections to try (in order). */
  (slotIndex: number, stack: ItemStack): number[][];
}

export class Window {
  cursor: ItemStack | null = null;
  constructor(
    public slots: Slot[],
    /** Returns candidate slot index ranges for shift-clicking the given slot. */
    public shiftTargets: (slot: number, stack: ItemStack) => number[],
    public onChange: () => void = () => {},
  ) {}

  snapshot(): (ItemStack | null)[] {
    return this.slots.map((s) => {
      const v = s.get();
      return v && v.count > 0 ? { ...v } : null;
    });
  }

  private maxFor(slot: Slot, s: ItemStack) {
    return Math.min(slot.maxStack ?? 64, stackSizeOf(s.id));
  }

  /** Insert a stack into the given slot indices, merging first then filling empty. Returns remainder. */
  insert(stack: ItemStack, targets: number[]): ItemStack | null {
    let rem: ItemStack | null = { ...stack };
    // merge
    for (const i of targets) {
      if (!rem) break;
      const slot = this.slots[i];
      if (slot.output || (slot.accepts && !slot.accepts(rem))) continue;
      const cur = slot.get();
      if (cur && sameItem(cur, rem)) {
        const space = this.maxFor(slot, rem) - cur.count;
        if (space > 0) {
          const n = Math.min(space, rem.count);
          slot.set({ ...cur, count: cur.count + n });
          rem.count -= n;
          if (rem.count <= 0) rem = null;
        }
      }
    }
    for (const i of targets) {
      if (!rem) break;
      const slot = this.slots[i];
      if (slot.output || (slot.accepts && !slot.accepts(rem))) continue;
      if (!slot.get()) {
        const n = Math.min(this.maxFor(slot, rem), rem.count);
        slot.set({ ...rem, count: n });
        rem.count -= n;
        if (rem.count <= 0) rem = null;
      }
    }
    return rem;
  }

  /** Handle a click. button 0 = left, 1 = right. Returns true if something changed. */
  click(index: number, button: number, shift: boolean): boolean {
    const slot = this.slots[index];
    if (!slot) {
      return false;
    }
    const cur = slot.get();

    if (slot.output) {
      if (!cur) return false;
      if (shift) {
        // Craft repeatedly until inputs run out or inventory is full
        let crafted = 0;
        for (let guard = 0; guard < 64; guard++) {
          const out = slot.get();
          if (!out || (crafted > 0 && !sameItem(out, cur))) break;
          const targets = this.shiftTargets(index, out);
          // Check it fits entirely
          if (!this.fits(out, targets)) break;
          this.insert(out, targets);
          slot.onTake?.(out);
          crafted++;
        }
        this.onChange();
        return crafted > 0;
      }
      if (this.cursor) {
        if (!sameItem(this.cursor, cur) || this.cursor.count + cur.count > stackSizeOf(cur.id)) return false;
        this.cursor = { ...this.cursor, count: this.cursor.count + cur.count };
      } else this.cursor = { ...cur };
      slot.onTake?.(cur);
      this.onChange();
      return true;
    }

    if (shift) {
      if (!cur) return false;
      const rem = this.insert(cur, this.shiftTargets(index, cur));
      slot.set(rem);
      this.onChange();
      return true;
    }

    const cursor = this.cursor;
    if (button === 0) {
      if (!cursor) {
        if (!cur) return false;
        this.cursor = cur;
        slot.set(null);
      } else if (!cur) {
        if (slot.accepts && !slot.accepts(cursor)) return false;
        const n = Math.min(this.maxFor(slot, cursor), cursor.count);
        slot.set({ ...cursor, count: n });
        this.cursor = cursor.count - n > 0 ? { ...cursor, count: cursor.count - n } : null;
      } else if (sameItem(cur, cursor)) {
        const space = this.maxFor(slot, cur) - cur.count;
        const n = Math.min(space, cursor.count);
        if (n <= 0) return false;
        slot.set({ ...cur, count: cur.count + n });
        this.cursor = cursor.count - n > 0 ? { ...cursor, count: cursor.count - n } : null;
      } else {
        if (slot.accepts && !slot.accepts(cursor)) return false;
        if (cursor.count > this.maxFor(slot, cursor)) return false;
        slot.set(cursor);
        this.cursor = cur;
      }
    } else {
      if (!cursor) {
        if (!cur) return false;
        const half = Math.ceil(cur.count / 2);
        this.cursor = { ...cur, count: half };
        slot.set(cur.count - half > 0 ? { ...cur, count: cur.count - half } : null);
      } else if (!cur || sameItem(cur, cursor)) {
        if (slot.accepts && !slot.accepts(cursor)) return false;
        const have = cur ? cur.count : 0;
        if (have >= this.maxFor(slot, cursor)) return false;
        slot.set({ ...cursor, count: have + 1 });
        this.cursor = cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null;
      } else {
        if (slot.accepts && !slot.accepts(cursor)) return false;
        if (cursor.count > this.maxFor(slot, cursor)) return false;
        slot.set(cursor);
        this.cursor = cur;
      }
    }
    this.onChange();
    return true;
  }

  /** Minecraft-style drag distribution: left = split evenly, right = one each. */
  drag(indices: number[], button: number): boolean {
    const cursor = this.cursor;
    if (!cursor) return false;
    const valid = indices.filter((i) => {
      const s = this.slots[i];
      if (!s || s.output || (s.accepts && !s.accepts(cursor))) return false;
      const c = s.get();
      return !c || (sameItem(c, cursor) && c.count < this.maxFor(s, cursor));
    });
    if (!valid.length) return false;
    let remaining = cursor.count;
    const per = button === 0 ? Math.max(1, Math.floor(cursor.count / valid.length)) : 1;
    for (const i of valid) {
      if (remaining <= 0) break;
      const s = this.slots[i];
      const c = s.get();
      const have = c ? c.count : 0;
      const n = Math.min(per, remaining, this.maxFor(s, cursor) - have);
      if (n <= 0) continue;
      s.set({ ...cursor, count: have + n });
      remaining -= n;
    }
    this.cursor = remaining > 0 ? { ...cursor, count: remaining } : null;
    this.onChange();
    return true;
  }

  fits(stack: ItemStack, targets: number[]): boolean {
    let need = stack.count;
    for (const i of targets) {
      const slot = this.slots[i];
      if (slot.output || (slot.accepts && !slot.accepts(stack))) continue;
      const cur = slot.get();
      if (!cur) need -= this.maxFor(slot, stack);
      else if (sameItem(cur, stack)) need -= this.maxFor(slot, stack) - cur.count;
      if (need <= 0) return true;
    }
    return need <= 0;
  }
}

export const range = (a: number, b: number) => {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
};

/** Stack helpers for plain arrays of slots (e.g. the player's 36-slot inventory). */
export function addToSlots(slots: (ItemStack | null)[], stack: ItemStack, order?: number[]): ItemStack | null {
  const idx = order ?? range(0, slots.length);
  let rem: ItemStack | null = { ...stack };
  const max = stackSizeOf(stack.id);
  for (const i of idx) {
    if (!rem) break;
    const cur = slots[i];
    if (cur && sameItem(cur, rem) && cur.count < max) {
      const n = Math.min(max - cur.count, rem.count);
      slots[i] = { ...cur, count: cur.count + n };
      rem.count -= n;
      if (rem.count <= 0) rem = null;
    }
  }
  for (const i of idx) {
    if (!rem) break;
    if (!slots[i]) {
      const n = Math.min(max, rem.count);
      slots[i] = { ...rem, count: n };
      rem.count -= n;
      if (rem.count <= 0) rem = null;
    }
  }
  return rem;
}

export function countItem(slots: (ItemStack | null)[], id: number): number {
  let n = 0;
  for (const s of slots) if (s && s.id === id) n += s.count;
  return n;
}

export function removeItem(slots: (ItemStack | null)[], id: number, count: number): number {
  let removed = 0;
  for (let i = 0; i < slots.length && removed < count; i++) {
    const s = slots[i];
    if (s && s.id === id) {
      const n = Math.min(s.count, count - removed);
      removed += n;
      slots[i] = s.count - n > 0 ? { ...s, count: s.count - n } : null;
    }
  }
  return removed;
}

export function describeStack(s: ItemStack | null): string {
  return s ? `${s.count}x ${itemDef(s.id).name}` : 'empty';
}
