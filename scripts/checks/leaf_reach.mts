// leafInReach (the sapling trip's leaves, #46, F287) on a model birch: grass at y 0, a trunk at 0,1..6,0, leaves in
// layers y 4-5 (radius 2) and 6-7 (radius 1). Low outer leaves are in reach from the ground; the crown is not.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/leaf_reach.mts
import { Vec3 } from 'vec3';
import { leafInReach } from '../../server/src/mineflayer/mcSurvival';

const world = new Map<string, string>();
for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) world.set(`${x},0,${z}`, 'grass_block');
for (let y = 1; y <= 6; y++) world.set(`0,${y},0`, 'birch_log');
for (const [y, r] of [[4, 2], [5, 2], [6, 1], [7, 1]] as const)
  for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) if (!world.has(`${x},${y},${z}`)) world.set(`${x},${y},${z}`, 'birch_leaves');
const bot = { blockAt: (p: Vec3) => {
  if (Math.abs(p.x) > 8 || Math.abs(p.z) > 8 || p.y < -2 || p.y > 20) return null;
  const name = world.get(`${p.x},${p.y},${p.z}`) ?? 'air';
  return { name, boundingBox: name === 'air' ? 'empty' : 'block' };
} };
const a = { bot } as never;
let fails = 0;
const expect = (x: number, y: number, z: number, want: boolean) => {
  const got = leafInReach(a, new Vec3(x, y, z));
  if (got !== want) fails++;
  console.log(`${got === want ? 'ok  ' : 'FAIL'} leaf ${x},${y},${z}: ${got ? 'in reach' : 'out of reach'} (want ${want ? 'in' : 'out of'} reach)`);
};
expect(2, 4, 0, true);
expect(2, 5, 2, true);
expect(1, 4, 1, true);
expect(1, 7, 0, false);
expect(0, 7, 0, false);
// the same tree on a 3-high stump of stone: everything is 3 higher than the ground can reach
for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) world.delete(`${x},0,${z}`);
for (const [k, v] of [...world]) if (v !== 'grass_block') { world.delete(k); const [x, y, z] = k.split(',').map(Number); world.set(`${x},${y + 4},${z}`, v); }
for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) world.set(`${x},0,${z}`, 'grass_block');
expect(2, 8, 0, false);
console.log(fails ? `leaf_reach: ${fails} failed` : 'leaf_reach: all passed');
process.exit(fails ? 1 : 0);
