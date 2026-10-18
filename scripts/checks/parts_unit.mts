/**
 * MC_PARTS's pure parts (server/src/mineflayer/mcStorage.ts, spec runs/2026-10-18/s37/spec_batch_n2.md S1-S5) checked
 * offline, no bot: groupOf with the parts group (stairs, slabs, walls, doors, signs, ladders to parts; furniture and
 * stations to misc; materials unchanged), the misc/parts overflow choice (a new chest while two spots are free, else the
 * chest with most room, a free chest last), partBurn's values (nether woods not fuel), fuelParts' pick, and the storage
 * gauge's slots from a record (chestSlots, storageSlots). Sets MC_PARTS=on itself. Exits non-zero on any failure.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/parts_unit.mts
 */
process.env.MC_PARTS = 'on';
const { PARTS_ON, groupOf, overflowChest, partBurn, fuelParts, chestSlots, storageSlots } = await import('../../server/src/mineflayer/mcStorage');

let failures = 0, checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    process.stdout.write(`FAIL ${what}\n`);
  }
}

ok(PARTS_ON, 'MC_PARTS=on read');
// groupOf
for (const n of ['oak_stairs', 'sandstone_stairs', 'stone_brick_slab', 'cobblestone_wall', 'oak_door', 'iron_door', 'spruce_trapdoor', 'oak_fence', 'oak_fence_gate', 'stone_button', 'oak_pressure_plate', 'oak_sign', 'oak_hanging_sign', 'ladder', 'nether_brick_fence'])
  ok(groupOf(n) === 'parts', `${n}: parts`);
for (const n of ['barrel', 'composter', 'crafting_table', 'furnace', 'grindstone', 'smoker', 'torch', 'wheat_seeds', 'stone_pickaxe', 'lantern', 'white_wool'])
  ok(groupOf(n) === 'misc', `${n}: misc`);
ok(groupOf('oak_log') === 'logs' && groupOf('oak_planks') === 'planks' && groupOf('cobblestone') === 'cobblestone' && groupOf('sandstone') === 'sand' && groupOf('glass_pane') === 'glass' && groupOf('white_terracotta') === 'terracotta', 'materials keep their groups');

// overflowChest
const slots = (c: { items: Record<string, number> }) => chestSlots(c);
const full = (g: string) => ({ group: g, items: Object.fromEntries(Array.from({ length: 27 }, (_, i) => [`item${i}`, 1])) });
const logs = { group: 'logs', items: { oak_log: 64 * 4 } };       // 4 slots
const cobble = { group: 'cobblestone', items: { cobblestone: 64 * 10 } };  // 10 slots
const free = { items: {} as Record<string, number> };
ok(overflowChest([full('misc'), logs], 2, slots) === 'new', 'two spots free: a new chest');
ok(overflowChest([full('misc'), logs, free], 1, slots) === 'new', 'a spot and a free chest: a new or free chest');
ok(overflowChest([full('misc'), cobble, logs], 1, slots) === logs, 'one spot free: the chest with most room');
ok(overflowChest([full('misc'), cobble, logs], 0, slots) === logs, 'no spot free: the chest with most room');
ok(overflowChest([full('misc'), full('logs'), free], 0, slots) === free, 'only a free chest has room: it, last');
ok(overflowChest([full('misc'), full('logs')], 1, slots) === null, 'no chest with room and one spot: none');

// partBurn
ok(partBurn('oak_stairs') === 1.5 && partBurn('oak_slab') === 0.75 && partBurn('oak_door') === 1 && partBurn('birch_sign') === 1 && partBurn('oak_button') === 0.5, 'burn values: stairs 1.5, slab 0.75, door 1, sign 1, button 0.5');
ok(partBurn('dark_oak_fence_gate') === 1.5 && partBurn('pale_oak_trapdoor') === 1.5 && partBurn('cherry_hanging_sign') === 4 && partBurn('ladder') === 1.5 && partBurn('bamboo_mosaic_slab') === 0.75, 'gates, trapdoors, hanging signs, ladders, bamboo mosaic');
ok(partBurn('crimson_stairs') === 0 && partBurn('warped_slab') === 0 && partBurn('stone_brick_stairs') === 0 && partBurn('iron_door') === 0 && partBurn('oak_planks') === 0, 'nether woods, stone, iron, planks: not parts fuel');

// fuelParts
const p1 = fuelParts({ oak_stairs: 10, oak_slab: 3 }, 8);
ok(p1.take.oak_stairs === 6 && !p1.take.oak_slab && p1.smelts === 9, 'the most plentiful first, whole items to cover');
const p2 = fuelParts({ oak_stairs: 2, oak_slab: 3, crimson_slab: 9 }, 8);
ok(p2.take.oak_slab === 3 && p2.take.oak_stairs === 2 && !p2.take.crimson_slab && p2.smelts === 5.25, 'not enough: all there is, never nether wood');
ok(Object.keys(fuelParts({ oak_stairs: 5 }, 0).take).length === 0 && Object.keys(fuelParts({}, 8).take).length === 0, 'nothing to smelt or nothing spare: nothing');

// chestSlots, storageSlots
ok(chestSlots({ items: { oak_log: 65, egg: 17, oak_sign: 16, stone_pickaxe: 2, air: 0 } }) === 2 + 2 + 1 + 2, 'real stack sizes: logs 64, eggs 16, signs 16, tools 1');
const v = {
  storageHut: { x1: 0, z1: 0, x2: 6, z2: 8, spots: Array.from({ length: 9 }, (_, i) => ({ x: i, z: 0 })) },
  storage: { chests: [{ x: 0, y: 64, z: 0, items: { oak_log: 128 } }, { x: 1, y: 64, z: 0, items: { wheat_seeds: 185 } }], updated: 0 },
} as unknown as Parameters<typeof storageSlots>[0];
const s = storageSlots(v);
ok(s.used === 2 + 3 && s.cap === 243 && s.chests === 2 && s.spots === 9, 'a hut: 27 a spot, slots from the record');
const loose = storageSlots({ storage: v.storage } as unknown as Parameters<typeof storageSlots>[0]);
ok(loose.cap === 54 && loose.spots === 2 && loose.used === 5, 'no hut: 27 a chest');
ok(storageSlots({} as unknown as Parameters<typeof storageSlots>[0]).cap === 0, 'no storage: nothing');

process.stdout.write(`${failures ? 'FAIL' : 'OK'} parts_unit: ${checks - failures} of ${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
