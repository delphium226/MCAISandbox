import { BLOCKS, BlockDef, Drop } from './blocks';
import { ItemStack, itemDef, ITEMS_BY_NAME } from './items';

export function canHarvest(block: BlockDef, tool: ItemStack | null): boolean {
  if (block.minTier === 0) return true;
  const t = tool ? itemDef(tool.id).tool : undefined;
  return !!t && t.type === block.tool && t.tier >= block.minTier;
}

/** Ticks needed to break a block (Minecraft formula). Infinity if unbreakable. */
export function breakTicks(state: number, tool: ItemStack | null, opts: { inWater?: boolean; onGround?: boolean; creative?: boolean } = {}): number {
  const block = BLOCKS[state & 0xff];
  if (opts.creative) return block.hardness < 0 ? Infinity : 0;
  if (block.hardness < 0) return Infinity;
  if (block.hardness === 0) return 0;
  const t = tool ? itemDef(tool.id).tool : undefined;
  let speed = 1;
  if (t && (t.type === block.tool || (t.type === 'sword' && block.name.includes('leaves')) || (t.type === 'shears' && (block.name.includes('leaves') || block.name.includes('wool'))))) speed = t.speed;
  if (t && t.type === 'sword' && block.name === 'cobweb') speed = 15;
  if (opts.inWater) speed /= 5;
  if (opts.onGround === false) speed /= 5;
  const harvest = canHarvest(block, tool);
  const dmg = speed / block.hardness / (harvest ? 30 : 100);
  if (dmg >= 1) return 0;
  return Math.ceil(1 / dmg);
}

/** Items dropped when breaking a block with a tool. */
export function blockDrops(state: number, tool: ItemStack | null, rand: () => number = Math.random): ItemStack[] {
  const block = BLOCKS[state & 0xff];
  if (!canHarvest(block, tool)) return [];
  const t = tool ? itemDef(tool.id).tool : undefined;
  if (block.name.endsWith('leaves') && t?.type === 'shears') return [{ id: block.id, count: 1 }];
  if ((block.name === 'short_grass' || block.name === 'fern') && t?.type === 'shears') return [{ id: block.id, count: 1 }];
  if (block.name === 'wheat') {
    const age = state >> 8;
    const seeds = ITEMS_BY_NAME.get('wheat_seeds')!.id;
    if (age >= 7) return [{ id: ITEMS_BY_NAME.get('wheat')!.id, count: 1 }, { id: seeds, count: 1 + Math.floor(rand() * 3) }];
    return [{ id: seeds, count: 1 }];
  }
  if (block.name === 'stone_slab' || block.name === 'oak_slab' || block.name === 'cobblestone_slab') return [{ id: block.id, count: 1 }];
  if (block.drops === 'none') return [];
  if (block.drops === 'self') return [{ id: block.id, count: 1 }];
  const out: ItemStack[] = [];
  for (const d of block.drops as Drop[]) {
    if (d.chance !== undefined && rand() >= d.chance) continue;
    const count = d.min + Math.floor(rand() * (d.max - d.min + 1));
    if (count > 0) out.push({ id: ITEMS_BY_NAME.get(d.item)!.id, count });
  }
  return out;
}
