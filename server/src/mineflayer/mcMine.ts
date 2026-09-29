/**
 * The village mine (plan step V.5): stairs from inside the mining hut down to stone, then a main tunnel with branches
 * at one level. The village's stone and cobblestone come from it, instead of pits dug around the plot (a trap by water,
 * F75) and tunnels under it (F76's andesite). The mine digs only its own planned cells, only natural blocks, and stops a
 * stair or a branch at water, lava, a cave or anything built.
 */
import { Vec3 } from 'vec3';
import type { Area, Mine, Village } from '../village';
import { villageHome } from '../village';
import { MINING_HUT } from '../huts';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { makePickaxe, mineBlock } from './mcSurvival';
import { checkAbort, num, reach } from './mcUtil';

/** What the mine may dig: the ground under a village, never logs or anything built. */
const DIGGABLE = /^(stone|deepslate|tuff|granite|diorite|andesite|calcite|dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|mud|gravel|sand|red_sand|clay|sandstone|red_sandstone|terracotta|.*_terracotta|dripstone_block|pointed_dripstone|moss_block|.*_ore|short_grass|tall_grass|fern)$/;
/** The stairs end on this (plus ores): the tunnels are dug in stone. */
const STONE = /^(stone|deepslate|tuff|granite|diorite|andesite|calcite)$|_ore$/;
const LIQUID = /^(water|lava|bubble_column)$/;
/** Blocks that fall into a hole dug under them. */
const FALLING = /^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel|.*_concrete_powder|pointed_dripstone)$/;
/** A chunk not loaded: try again later (not a reason to end the mine). */
const UNLOADED = 'not loaded';

/** Main tunnel columns between branches, and each branch's length. */
const MAIN_STEP = 3, BRANCH = 12;

/** Cell k (0-based) of the tunnels, in digging order, with the cell to stand on and its branch (for skipping). */
function tunnelCell(m: Mine, k: number): { x: number; z: number; from: { x: number; z: number }; branch: number } {
  const [dx, dz] = m.dir;
  // The last step of the stairs, where the main tunnel starts
  const sx = m.top.x + dx * (m.steps - 1), sz = m.top.z + dz * (m.steps - 1);
  const per = MAIN_STEP + 2 * BRANCH;
  const seg = Math.floor(k / per), r = k % per;
  const main = (i: number) => ({ x: sx + dx * i, z: sz + dz * i });
  const base = main(MAIN_STEP * (seg + 1));
  if (r < MAIN_STEP) {
    const i = MAIN_STEP * seg + r + 1;
    return { ...main(i), from: main(i - 1), branch: 3 * seg };
  }
  // Left, then right of the main tunnel
  const left = r < MAIN_STEP + BRANCH;
  const j = left ? r - MAIN_STEP + 1 : r - MAIN_STEP - BRANCH + 1;
  const [bx, bz] = left ? [dz, -dx] : [-dz, dx];
  const cell = (n: number) => ({ x: base.x + bx * n, z: base.z + bz * n });
  return { ...cell(j), from: cell(j - 1), branch: 3 * seg + (left ? 1 : 2) };
}

/**
 * Why a cell may not be dug (null if it may; UNLOADED if its chunk is not loaded): beyond the village's range; any
 * village's plot and its margin down to 4 below its level (not for the stairs: they start inside the mining hut on the
 * plot), or a building and a block around it (the mining hut excepted); anything not natural ground; water or lava next to it; and, with `ceiling`, no solid ceiling over it
 * (a tunnel coming out on a hillside, or sand and gravel that would fall in: suffocation hurts even here).
 */
function unsafe(a: BotAgent, v: Village, m: Mine, p: Vec3, ceiling: boolean, stairs = false): string | null {
  const b = a.bot.blockAt(p);
  if (!b) return UNLOADED;
  const where = `${p.x},${p.y},${p.z}`;
  const home = villageHome(v);
  if (home && Math.hypot(p.x - home.x, p.z - home.z) > 90) return `${where} is at the edge of the village's range`;
  for (const o of a.world.villages.villages.values()) {
    if (!stairs && o.plots.some((q) => p.x >= q.x1 - 2 && p.x <= q.x2 + 2 && p.z >= q.z1 - 2 && p.z <= q.z2 + 2 && p.y >= q.y - 4)) return `${where} is under ${o.name}'s plot`;
    const built = o.structures.find((s) => !(s.kind === MINING_HUT && s.x1 === m.hut.x1 && s.z1 === m.hut.z1) && p.x >= s.x1 - 1 && p.x <= s.x2 + 1 && p.z >= s.z1 - 1 && p.z <= s.z2 + 1 && p.y >= s.y - 2);
    if (built) return `${where} is at ${o.name}'s ${built.kind}`;
  }
  if (LIQUID.test(b.name)) return `${b.name} at ${where}`;
  if (b.boundingBox !== 'empty' && !DIGGABLE.test(b.name)) return `${b.name} at ${where} (not natural ground)`;
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
    const n = a.bot.blockAt(p.offset(d[0], d[1], d[2]));
    if (n && LIQUID.test(n.name)) return `${n.name} next to ${where}`;
  }
  if (ceiling) {
    const up = a.bot.blockAt(p.offset(0, 1, 0));
    if (!up) return UNLOADED;
    if (up.boundingBox !== 'block' || FALLING.test(up.name)) return `${up.name} over ${where} (no solid ceiling)`;
  }
  return null;
}

/** The ground the mine takes up (the hut, the stairs and the tunnels' reach), from the tunnel floor up: kept from other digging. */
export function mineArea(m: Mine): (Area & { y: number }) | null {
  if (m.level === undefined || m.stopped) return null;
  const [dx, dz] = m.dir;
  const main = m.steps - 1 + MAIN_STEP * (Math.floor(m.dug / (MAIN_STEP + 2 * BRANCH)) + 1);
  const ends = [
    { x: m.top.x - dx * 2 + dz * (BRANCH + 1), z: m.top.z - dz * 2 - dx * (BRANCH + 1) },
    { x: m.top.x + dx * main - dz * (BRANCH + 1), z: m.top.z + dz * main + dx * (BRANCH + 1) },
  ];
  return {
    x1: Math.min(m.hut.x1, ...ends.map((e) => e.x)), z1: Math.min(m.hut.z1, ...ends.map((e) => e.z)),
    x2: Math.max(m.hut.x2, ...ends.map((e) => e.x)), z2: Math.max(m.hut.z2, ...ends.map((e) => e.z)),
    y: m.level - 1,
  };
}

/**
 * Dig one planned cell (a pickaxe made if stone needs one); records what it gave. The drop is left where it fell: the
 * bot steps into the cell next and picks it up (walking to each drop took seconds a block).
 */
async function digCell(a: BotAgent, m: Mine, p: Vec3, signal: AbortSignal) {
  const b = a.bot.blockAt(p);
  if (!b || b.boundingBox === 'empty') return;
  const name = b.name;
  try {
    await mineBlock(a, p, signal, false, 20000, false);
  } catch (e) {
    const m2 = (e as Error).message;
    if (!/^needs \w+_pickaxe/.test(m2)) throw e;
    // Stone with no pickaxe at all: make one. An ore this pickaxe cannot harvest (copper with a wooden one, StageH18):
    // dug through anyway, its drop lost, rather than the tunnel stopping there
    if (/^needs wooden_pickaxe/.test(m2) && !a.bot.inventory.items().some((it) => it.name.endsWith('_pickaxe'))) {
      await makePickaxe(a, signal);
      await mineBlock(a, p, signal, false, 20000, false);
    } else await mineBlock(a, p, signal, true, 20000, false);
  }
  const drop = name === 'stone' ? 'cobblestone' : name === 'deepslate' ? 'cobbled_deepslate' : name;
  m.got[drop] = (m.got[drop] ?? 0) + 1;
  // Ores seen in the walls (V.6 will put them in the atlas)
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
    const n = a.bot.blockAt(p.offset(d[0], d[1], d[2]));
    if (n && /_ore$/.test(n.name)) m.got[`seen ${n.name}`] = (m.got[`seen ${n.name}`] ?? 0) + 1;
  }
}

/** The floor level of the mining hut (its structure's y), once built. */
function hutFloor(v: Village, m: Mine): number | null {
  const s = v.structures.find((st) => st.kind === MINING_HUT && st.x1 === m.hut.x1 && st.z1 === m.hut.z1);
  return s ? s.y : null;
}

/**
 * dig_mine: the stairs, step by step from inside the mining hut, until they stand on stone at least 5 steps down (below
 * the plot's protected ground) or reach max_depth. Step i stands one block lower than step i-1 and needs three blocks of
 * headroom. Stops short at water, lava, a cave (no floor) or anything built, and says so; cobblestone is then gathered
 * outside as before.
 */
async function digMine(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const m = v?.mine;
  if (!v || !m) throw new Error('your village has no mine laid out (plan_layout lays one out with a new village)');
  if (m.level !== undefined) return `the mine is dug already: stairs ${m.steps} steps down to y=${m.level}; collect cobblestone digs its tunnels`;
  const y0 = hutFloor(v, m);
  if (y0 === null) throw new Error('the mining hut is not built yet: build it first (the stairs start inside it)');
  const max = Math.max(6, Math.min(40, Math.floor(args.max_depth !== undefined ? num(args.max_depth, 'max_depth') : 24)));
  const reg = a.world.villages;
  const stop = (why: string) => {
    m.stopped = why;
    reg.note(v, `${a.name} stopped the mine stairs after ${m.steps} steps: ${why}`);
    reg.save();
    return `the mine stairs stopped after ${m.steps} steps: ${why}; cobblestone is gathered outside the village instead`;
  };
  for (let i = m.steps + 1; i <= max; i++) {
    checkAbort(signal);
    const x = m.top.x + m.dir[0] * (i - 1), z = m.top.z + m.dir[1] * (i - 1);
    const floor = y0 - i;
    // Stand on the step above (the hut's floor for the first) and dig the three cells over this step, top first
    const fx = x - m.dir[0], fz = z - m.dir[1];
    await reach(a, new Vec3(fx + 0.5, floor + 2, fz + 0.5), 1.2, signal, 30000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    // The two cells a tunnel at this level would dig: in stone, or the tunnels give dirt (StageH16: 36 dirt, 10
    // cobblestone from stairs that stopped on the first stone floor)
    const inStone = [1, 2].every((dy) => STONE.test(a.bot.blockAt(new Vec3(x, floor + dy, z))?.name ?? ''));
    for (const dy of [3, 2, 1]) {
      const p = new Vec3(x, floor + dy, z);
      // Outside the hut (from the fourth step) the top cell needs a solid ceiling
      const why = unsafe(a, v, m, p, dy === 3 && i >= 4, true);
      if (why === UNLOADED) throw new Error(`the mine stairs at ${x},${z} are not loaded; move closer and dig_mine again`);
      if (why) return stop(why);
      await digCell(a, m, p, signal);
    }
    // Onto the step: the drops are there
    await reach(a, new Vec3(x + 0.5, floor + 1, z + 0.5), 0.6, signal, 20000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    const under = a.bot.blockAt(new Vec3(x, floor, z));
    if (!under || under.boundingBox !== 'block') return stop(`no floor under step ${i} (a cave or a hole at ${x},${floor},${z})`);
    if (LIQUID.test(under.name)) return stop(`${under.name} under step ${i}`);
    m.steps = i;
    reg.save();
    // Seven steps at least: the tunnels then run 5 or more below the plot, under the ground kept from digging
    if (i >= 7 && STONE.test(under.name) && inStone) {
      m.level = floor + 1;
      reg.note(v, `${a.name} dug the mine stairs ${i} steps down to stone at y=${m.level}`);
      reg.save();
      return `the mine stairs are dug: ${i} steps down to stone at y=${m.level}; collect cobblestone now digs its tunnels${minedText(m)}`;
    }
  }
  // No stone within reach: no tunnels (in dirt they would give none); cobblestone comes from outside
  return stop(`no stone within ${m.steps} steps down`);
}

const minedText = (m: Mine) => {
  const got = Object.entries(m.got).filter(([n, q]) => q > 0 && !n.startsWith('seen ')).map(([n, q]) => `${q} ${n}`).join(', ');
  return got ? `; it gave ${got}` : '';
};

/** Whether a village's mine can give this (cobblestone, from stone), once its stairs reached stone and while it goes on. */
export function mineCanGive(v: Village | undefined, item: string): boolean {
  const m = v?.mine;
  return !!m && m.level !== undefined && !m.stopped && /^(cobblestone|stone)$/.test(item) && m.dug < 40 * (MAIN_STEP + 2 * BRANCH);
}

/**
 * collect in the mine: extend the tunnels cell by cell (two blocks each, standing in the cell before) until `want` more
 * cobblestone are carried or 6 minutes pass. A branch that meets water, lava, a cave, village ground or a hillside
 * (no ceiling) ends there; the main tunnel meeting one ends the mine. Returns how many were collected.
 */
export async function mineFor(a: BotAgent, v: Village, want: number, have: () => number, signal: AbortSignal): Promise<number> {
  const m = v.mine!;
  const reg = a.world.villages;
  const start = have();
  const t0 = Date.now();
  let skipped = 0;
  while (have() - start < want && Date.now() - t0 < 6 * 60000 && skipped < 200) {
    checkAbort(signal);
    const c = tunnelCell(m, m.dug);
    if (m.ended.includes(c.branch)) {
      m.dug++;
      skipped++;
      continue;
    }
    const L = m.level!;
    const cells = [new Vec3(c.x, L + 1, c.z), new Vec3(c.x, L, c.z)];
    await reach(a, new Vec3(c.from.x + 0.5, L, c.from.z + 0.5), 1.2, signal, 60000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    const floor = a.bot.blockAt(new Vec3(c.x, L - 1, c.z));
    const why = cells.map((p, i) => unsafe(a, v, m, p, i === 0)).find(Boolean) ?? (!floor || floor.boundingBox !== 'block' ? `no floor at ${c.x},${L - 1},${c.z}` : null);
    // Not loaded (it walked short): stop here for now, the next collect goes on
    if (why === UNLOADED) break;
    if (why) {
      // The main tunnel ending ends the mine; a branch just ends
      if (c.branch % 3 === 0) {
        m.stopped = `the main tunnel met ${why}`;
        reg.note(v, `the mine's main tunnel ended: ${why}`);
        reg.save();
        break;
      }
      m.ended.push(c.branch);
      reg.save();
      continue;
    }
    for (const p of cells) await digCell(a, m, p, signal);
    // Into the cell: its drops are picked up there, and it is where the next one is dug from
    await reach(a, new Vec3(c.x + 0.5, L, c.z + 0.5), 0.6, signal, 20000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    m.dug++;
    reg.save();
  }
  return have() - start;
}

export const MINE_SKILLS: Record<string, McSkill> = {
  dig_mine: { check: (x) => x.max_depth !== undefined && void num(x.max_depth, 'max_depth'), run: digMine },
};
