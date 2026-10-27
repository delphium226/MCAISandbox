/**
 * #133 offline (no server): a member in the rock under the storage hut, as train 7's six were (10-27: left ~50 blocks
 * down by a failed amethyst trip, its walk to the hut dug straight toward it and stopped under the floor). A stub world,
 * the real A* and movement rules with the walks' settings (dig natural blocks only, no breaking or placing on village
 * ground, no dirt to pillar with): a village plot 61x61 at y 64 (kept from y 60 up, 2 blocks of margin) with a closed
 * hut in the middle (cobblestone floor, plank walls, a door gap); the bot stands in a pocket at y 54 under the hut.
 * Checks:
 * A walk is simulated as it goes: search (2 s each, unthrottled; a live walk gets at most 15 ms of every 50 ms tick for
 * 15 s, shared by 25 bots), follow the path found (its digs done in the stub world), search again from its end.
 *   1. the trap: six searches from the pocket to the hut's aisle never reach it, and the walk ends under the hut, short
 *      of the floor (train 7's stopped at y 54-58);
 *   2. the way out (mcUtil's outFromUnder): openGroundNear picks open ground off the plot and back from it, the bot counts
 *      as under ground in the pocket (covered) and as out there, and a walk there gets out;
 *   3. from there a walk to the hut's aisle finds its path over the surface, through the door.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/under_hut.mts
 */
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { climbGoal, covered, openGroundNear } from '../../server/src/mineflayer/mcUtil.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const require = createRequire(import.meta.url);
const { Vec3 } = require('vec3');
const reg = require('prismarine-registry')('26.1');
const Block = require('prismarine-block')(reg);
const AStar = require('mineflayer-pathfinder/lib/astar');
const Movements = require('mineflayer-pathfinder/lib/movements');
const Move = require('mineflayer-pathfinder/lib/move');
const { goals } = require('mineflayer-pathfinder');

const say = console.log;
let failures = 0, checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  say(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) failures++;
}

// --- The stub world: stone to y 60, dirt to 63, grass at 64, air over; nothing outside 0..127 or y -10..319
const SIZE = 128;
const PLOT = { x1: 30, z1: 30, x2: 90, z2: 90, y: 64 };
const HUT = { x1: 56, z1: 56, x2: 62, z2: 64, y: 64 };
const DOOR = { x: 59, z: 64 };
const POCKET = [...Array(8).keys()].map((i) => ({ x: 59 + i, z: 60 }));
// (and a cell 45 blocks down, as a failed amethyst trip leaves a member)
const DEEP = { x: 57, z: 58 };
// What protectedGround gives for them (botAgent.ts): the plot and its margin from 4 under its level, the hut and a block
// round it from a block under its floor
const boxes = [
  { x1: PLOT.x1 - 2, z1: PLOT.z1 - 2, x2: PLOT.x2 + 2, z2: PLOT.z2 + 2, y: PLOT.y - 4 },
  { x1: HUT.x1 - 1, z1: HUT.z1 - 1, x2: HUT.x2 + 1, z2: HUT.z2 + 1, y: HUT.y - 1 },
];
const inside = (q: any, x: number, y: number, z: number) => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2 && y >= q.y && (q.y2 === undefined || y <= q.y2);
function nameAt(x: number, y: number, z: number): string | null {
  if (x < 0 || z < 0 || x >= SIZE || z >= SIZE || y < -10 || y > 319) return null;
  const inHut = x >= HUT.x1 && x <= HUT.x2 && z >= HUT.z1 && z <= HUT.z2;
  if (inHut && y === HUT.y) return 'cobblestone';
  if (inHut && y >= 65 && y <= 67 && (x === HUT.x1 || x === HUT.x2 || z === HUT.z1 || z === HUT.z2) && !(x === DOOR.x && z === DOOR.z && y <= 66)) return 'oak_planks';
  if (inHut && y === 68) return 'oak_planks';
  if ((y === 54 || y === 55) && POCKET.some((p) => p.x === x && p.z === z)) return 'air';
  if ((y === 20 || y === 21) && x === DEEP.x && z === DEEP.z) return 'air';
  if (y <= 60) return 'stone';
  if (y <= 63) return 'dirt';
  if (y === 64) return 'grass_block';
  return 'air';
}
const ids: Record<string, number> = {};
for (const n of ['air', 'grass_block', 'stone', 'dirt', 'cobblestone', 'oak_planks']) ids[n] = reg.blocksByName[n].defaultState ?? reg.blocksByName[n].minStateId;
const blocks = new Map<string, any>();
function blockAt(pos: any) {
  const x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
  const k = `${x},${y},${z}`;
  let b = blocks.get(k);
  if (b === undefined) {
    const n = nameAt(x, y, z);
    b = n === null ? null : Block.fromStateId(ids[n], 0);
    if (b) b.position = new Vec3(x, y, z);
    blocks.set(k, b);
  }
  return b;
}
const start = new Vec3(59, 54, 60);
const bot: any = {
  version: '26.1', registry: reg, blockAt, entities: {}, game: { minY: -64, height: 384 },
  entity: { position: start.offset(0.5, 0, 0.5), onGround: true, effects: {} },
  inventory: { slots: [], items: () => [] },
  // (a stone pickaxe, as members carry: bare hands make every stone dig cost five times as much)
  pathfinder: { bestHarvestTool: () => ({ type: reg.itemsByName.stone_pickaxe.id }) },
};
// The walks' rules (botAgent.moves): natural blocks only, nothing broken or placed on village ground
const moves = new Movements(bot);
moves.allowParkour = false;
moves.canDig = true;
moves.scafoldingBlocks = [];
const natural = new Set(['stone', 'dirt', 'grass_block'].map((n) => reg.blocksByName[n].id));
moves.blocksCantBreak = new Set(reg.blocksArray.filter((b: any) => !natural.has(b.id)).map((b: any) => b.id));
moves.exclusionAreasBreak = [(b: any) => (b.position && boxes.some((q) => inside(q, b.position.x, b.position.y, b.position.z)) ? 100 : 0)];
moves.exclusionAreasPlace = [(b: any) => (b.position && boxes.some((q) => inside(q, b.position.x, b.position.y + 0, b.position.z)) ? 1000 : 0)];

function search(from: any, goal: any, ms: number) {
  const a = new AStar(new Move(from.x, from.y, from.z, 0, 0), moves, goal, ms, ms);
  const t = performance.now();
  const r = a.compute();
  const end = r.path[r.path.length - 1];
  return { status: r.status as string, ms: performance.now() - t, nodes: r.visitedNodes as number, path: r.path as any[], end: end ? new Vec3(end.x, end.y, end.z) : null };
}
/**
 * A walk as it goes: search, follow the path found (its digs done in the stub world), and from where it ends search
 * again while it is partial, up to `n` searches of `ms` each. Where it got, and each search's end.
 */
function follow(from: any, goal: any, ms: number, n: number) {
  let at = new Vec3(from.x, from.y, from.z);
  const ends: string[] = [];
  let total = 0, reached = false;
  for (let i = 0; i < n && !reached; i++) {
    const r = search(at, goal, ms);
    total += r.ms;
    for (const node of r.path) for (const b of node.toBreak ?? []) {
      const k = `${b.x},${b.y},${b.z}`, c = Block.fromStateId(ids.air, 0);
      c.position = new Vec3(b.x, b.y, b.z);
      blocks.set(k, c);
    }
    if (r.end) at = r.end;
    ends.push(`${r.status} ${at.x},${at.y},${at.z}`);
    reached = r.status === 'success';
  }
  return { reached, at, ends, ms: total };
}
const aisle = new goals.GoalNear(59, 65, 62, 0.8);

// 1. The trap: six searches of 2 s each, the walk following each partial path
const trap = follow(start, aisle, 2000, 6);
say(`from the pocket ${start.x},${start.y},${start.z} to the hut's aisle: ${trap.ends.join(' | ')}`);
ok(!trap.reached, 'a walk from under the hut never reaches the aisle');
ok(trap.at.x >= HUT.x1 - 1 && trap.at.x <= HUT.x2 + 1 && trap.at.z >= HUT.z1 - 1 && trap.at.z <= HUT.z2 + 1 && trap.at.y < HUT.y,
  'it ends under the hut, short of the floor (as train 7\'s did, at y 54-58)');

// 2. The way out
const a: any = { bot, farmGround: () => [] };
ok(covered(a, start), 'the pocket counts as under ground (covered)');
const t0 = performance.now();
const out = openGroundNear(a, start, aisle.x, aisle.y, aisle.z, boxes);
say(`open ground chosen: ${out ? `${out.x},${out.y},${out.z}` : 'none'} (${(performance.now() - t0).toFixed(0)} ms to choose)`);
ok(!!out && !boxes.some((q) => out.x >= q.x1 - 6 && out.x <= q.x2 + 6 && out.z >= q.z1 - 6 && out.z <= q.z2 + 6), 'it lies off the plot, back from it by the climb');
ok(!!out && out.y === 65 && Math.hypot(out.x - start.x, out.z - start.z) <= 48, 'on the surface, within 48 blocks');
ok(!!out && !covered(a, out), 'there counts as out (open sky)');
const plain = out ? search(start, new goals.GoalNear(out.x, out.y, out.z, 1), 2000) : null;
if (plain) say(`one plain search there: ${plain.status} in ${plain.ms.toFixed(0)} ms, ${plain.nodes} nodes`);
const up = out ? follow(start, climbGoal(out), 2000, 6) : null;
if (up) say(`from the pocket to that open ground: ${up.ends.join(' | ')} (${(up.ms / 1000).toFixed(1)} s of search)`);
ok(up?.reached && up.ends.length === 1 && up.ms < 1000, 'a walk there gets out on its first search, in under a second (the weighted goal)');

// 2b. From 45 blocks down (i133's staged run: a plain search's walk stalled 40 blocks under its exit)
{
  const deep = new Vec3(DEEP.x, 20, DEEP.z);
  const o = openGroundNear(a, deep, aisle.x, aisle.y, aisle.z, boxes);
  const r = o ? follow(deep, climbGoal(o), 2000, 6) : null;
  say(`from 45 down (${deep.x},${deep.y},${deep.z}) to open ground ${o ? `${o.x},${o.y},${o.z}` : 'none'}: ${r ? `${r.ends.join(' | ')} (${(r.ms / 1000).toFixed(1)} s of search)` : '-'}`);
  ok(r?.reached && r.ends.length <= 2, 'from 45 blocks down a walk gets out in two searches at most');
}

// 3. On to the hut over the surface
const on = up?.reached ? follow(up.at, aisle, 2000, 2) : null;
if (on) say(`from there to the hut's aisle: ${on.ends.join(' | ')} (${on.ms.toFixed(0)} ms)`);
ok(on?.reached, 'and from there to the hut\'s aisle, through the door');

say(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
