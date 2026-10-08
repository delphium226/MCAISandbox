/**
 * The skills agents can call, as tool definitions shared by the LLM brains. Every world implements these skills with
 * the same names and arguments (WorldAdapter.skills lists the ones it has), so prompts and tools do not change between
 * worlds.
 */
import type { ToolDef } from './world';

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  properties: props,
  required,
  additionalProperties: false,
});
const n = { type: 'number' };
const s = { type: 'string' };

/** One tool per game skill. Tool calls are queued in order as the agent's next actions. */
export const TOOLS: ToolDef[] = [
  { name: 'move_to', description: 'Walk to a block position using pathfinding.', input_schema: obj({ x: n, y: n, z: n, range: n }, ['x', 'y', 'z']) },
  { name: 'collect', description: "Find and mine blocks of a type until `count` items are gathered. block examples: 'logs', 'stone', 'coal_ore', 'iron_ore', 'sand', 'dirt'.", input_schema: obj({ block: s, count: n }, ['block', 'count']) },
  { name: 'mine', description: 'Mine the single block at x,y,z.', input_schema: obj({ x: n, y: n, z: n }, ['x', 'y', 'z']) },
  { name: 'place', description: 'Place a block item from the inventory at x,y,z.', input_schema: obj({ item: s, x: n, y: n, z: n }, ['item', 'x', 'y', 'z']) },
  { name: 'craft', description: 'Craft an item from inventory ingredients (uses a nearby crafting table for 3x3 recipes, placing one if carried). Missing planks and sticks are made automatically from carried logs. Use exact item ids like oak_planks, stick, crafting_table, wooden_pickaxe, stone_pickaxe, furnace, torch, bread.', input_schema: obj({ item: s, count: n }, ['item']) },
  { name: 'smelt', description: 'Smelt items in a furnace (e.g. iron_ore, raw food, sand).', input_schema: obj({ item: s, count: n }, ['item']) },
  { name: 'attack', description: 'Fight an entity by id or kind (zombie, pig, ...).', input_schema: obj({ id: n, kind: s }) },
  { name: 'follow', description: 'Follow a player for some seconds.', input_schema: obj({ player: s, distance: n, seconds: n }, ['player']) },
  { name: 'give', description: 'Walk to a player and give them items (trading, helping).', input_schema: obj({ player: s, item: s, count: n }, ['player', 'item']) },
  { name: 'deposit', description: "Put items in the village storage chest (walks there). item: an item id, 'logs' or 'planks' for any kind, or 'all' (the default: everything except tools). count: how many (default all of them). The village's first chest: carry one (craft chest, 8 planks) and deposit puts it down near you, outside the plots; when storage is full, a carried chest is put down beside the others.", input_schema: obj({ item: s, count: n }) },
  { name: 'dig_mine', description: 'Dig the village mine: the stairs from inside the mining hut down to stone (then collect cobblestone digs its tunnels). max_depth: how far down at most (default 24).', input_schema: obj({ max_depth: n }) },
  { name: 'withdraw', description: "Take items from the village storage chest (walks there). item: an item id, or 'logs' / 'planks' for any kind; count defaults to 64.", input_schema: obj({ item: s, count: n }, ['item']) },
  { name: 'chat', description: 'Say something out loud. Only players within ~48 blocks hear it.', input_schema: obj({ message: s }, ['message']) },
  { name: 'eat', description: 'Eat food from the inventory.', input_schema: obj({ item: s }) },
  { name: 'explore', description: 'Walk some distance in a direction to find new resources.', input_schema: obj({ direction: { type: 'string', enum: ['north', 'south', 'east', 'west'] }, distance: n }) },
  { name: 'scout', description: 'Walk toward x,z to bring the land around it into the village map (scouting tasks; it reports how far it got).', input_schema: obj({ x: n, z: n }, ['x', 'z']) },
  { name: 'wait', description: 'Idle for a number of seconds.', input_schema: obj({ seconds: n }, ['seconds']) },
  { name: 'find_site', description: 'Find a dry, flat, open area to build on (no water, few trees, not on existing builds) and report its centre x,z. Then prepare_site there, then build. size: plot side (a 7x7 house needs about 11). When nothing that big is in view it looks farther out (in Minecraft it walks a little way); if that fails it reports the largest site that fits.', input_schema: obj({ size: n, radius: n, x: n, z: n }) },
  { name: 'prepare_site', description: 'Prepare a building plot before building: fells every tree touching it (whole trees), levels the ground by cutting and filling, and leaves a margin to walk around. Never demolishes buildings. Defaults to the last find_site result. To extend a plot later, prepare the neighbouring area with the same y.', input_schema: obj({ x: n, z: n, width: n, depth: n, margin: n, y: n }) },
  { name: 'get_item', description: 'Creative mode only: take any item from the creative inventory.', input_schema: obj({ item: s, count: n }, ['item']) },
  {
    name: 'build',
    description: "Build a whole structure centred on x,z on prepared ground (run prepare_site first; build refuses sloped or cluttered ground and never overlaps existing buildings). Creative mode supplies the blocks; in survival carry them. structure: 'hut' (5x5), 'house' (7x7, door and windows), 'platform' (floor only) or 'wall' (a straight line starting at x,z and running `length` blocks toward `direction`, e.g. a north edge runs east). Optional: material (walls), roof, floor, width, depth, height, door side, length and direction for walls.",
    input_schema: obj({
      structure: { type: 'string', enum: ['hut', 'house', 'platform', 'wall'] },
      x: n, z: n, material: s, roof: s, floor: s, width: n, depth: n, height: n,
      door: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
      length: n, direction: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
    }, ['structure']),
  },
  { name: 'build_design', description: 'Build a design from the village design library (see the village summary), centred on x,z on prepared, level ground. rotate turns it clockwise (0, 90, 180, 270), e.g. to face a door toward the street.', input_schema: obj({ design: s, x: n, z: n, rotate: n }, ['design', 'x', 'z']) },
  { name: 'build_box', description: "Fill the box between two corners with a block (hollow: only the shell, inside cleared), or clear it with block 'air'. For custom shapes: towers, pillars, bridges, extensions. label names it in the village record.", input_schema: obj({ x1: n, y1: n, z1: n, x2: n, y2: n, z2: n, block: s, hollow: { type: 'boolean' }, label: s }, ['x1', 'y1', 'z1', 'x2', 'y2', 'z2', 'block']) },
  { name: 'light_streets', description: 'Put up the street lamps of a village layout (a code-posted task: the posts and torches are made from the village storage).', input_schema: obj({ layout: n }, ['layout']) },
  { name: 'put_up_signs', description: 'Put up the name signs beside the doors of a village layout (a code-posted task: the signs are made from the village storage).', input_schema: obj({ layout: n }, ['layout']) },
];
