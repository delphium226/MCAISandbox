// F218: does a walk that the pathfinder ends at once count as arrived? `atGoal` (mcUtil.ts) against the old test (the
// floored feet and the raw position only), with the pathfinder's own GoalNear, on Minevale43's case: Worker2 on a street's
// dirt_path (top at 64.9375) at -1657,64,15, the hut's furnace at -1657,65,8, holdVillageFurnace's range 7.
// Run: node_modules/.bin/tsx scripts/checks/at_goal.mts
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { atGoal } from '../../server/src/mineflayer/mcUtil';

const { goals } = pathfinderPkg;
type Box = 'block' | 'empty';
const fakeBot = (x: number, y: number, z: number, onGround: boolean, boxes: Record<string, Box>) => ({
  entity: { position: new Vec3(x, y, z), onGround },
  blockAt: (p: Vec3) => ({ boundingBox: boxes[`${p.x},${p.y},${p.z}`] ?? 'empty' }),
}) as unknown as Parameters<typeof atGoal>[0];
const oldTest = (bot: ReturnType<typeof fakeBot>, goal: InstanceType<typeof goals.Goal>) =>
  [bot.entity.position.floored(), bot.entity.position].some((p) => goal.isEnd(p as never));

const furnace = new goals.GoalNear(-1656.5, 65, 8.5, 7);
const cases: Array<[string, ReturnType<typeof fakeBot>, InstanceType<typeof goals.Goal>, boolean]> = [
  // the run's case: the pathfinder starts from y 65 and accepts it (dz 7); the bot stands on the dirt_path's 15/16
  ['dirt_path, 7 south (F218)', fakeBot(-1656.5, 64.9375, 15.5, true, { '-1657,64,15': 'block' }), furnace, true],
  ['full block, 7 south', fakeBot(-1656.5, 65, 15.5, true, { '-1657,64,15': 'block' }), furnace, true],
  ['dirt_path, 8 south', fakeBot(-1656.5, 64.9375, 16.5, true, { '-1657,64,16': 'block' }), furnace, false],
  // in the air above a partial block: the pathfinder takes no offset either
  ['dirt_path, airborne', fakeBot(-1656.5, 64.9375, 15.5, false, { '-1657,64,15': 'block' }), furnace, false],
  // a slab-height floor whose cell reads empty (water's box): no offset
  ['empty-box cell', fakeBot(-1656.5, 64.5, 15.5, true, {}), furnace, false],
  ['farmland, range 1.8 beside', fakeBot(-1656.5, 64.9375, 9.5, true, { '-1657,64,9': 'block' }), new goals.GoalNear(-1656.5, 65, 8.5, 1.8), true],
];
let bad = 0;
for (const [name, bot, goal, want] of cases) {
  const got = atGoal(bot, goal);
  const old = oldTest(bot, goal);
  if (got !== want) bad++;
  console.log(`${got === want ? 'ok  ' : 'FAIL'} ${name}: atGoal ${got} (want ${want}), old test ${old}`);
}
console.log(bad ? `${bad} of ${cases.length} FAILED` : `all ${cases.length} passed`);
process.exit(bad ? 1 : 0);
