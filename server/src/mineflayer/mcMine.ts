/**
 * The village mine (plan step V.5): stairs from inside the mining hut down to stone, then a main tunnel with branches
 * at one level. The village's stone and cobblestone come from it, instead of pits dug around the plot (a trap by water,
 * F75) and tunnels under it (F76's andesite). The mine digs only its own planned cells, only natural blocks, and stops a
 * stair or a branch at water, lava, a cave or anything built.
 */
import { Vec3 } from 'vec3';
import type { Area, IronLevel, Mine, MineLeg, Village } from '../village';
import { MINE_BRANCH, MINE_STEP, fromOrder, upgradeMine, villageHome } from '../village';
import { MINING_HUT } from '../huts';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { makePickaxe, mineBlock } from './mcSurvival';
import { checkAbort, num, reach, wetAt } from './mcUtil';
// What the mine may dig (the ground under a village, never logs or anything built), the stone the stairs end on and the
// tunnels are dug in (plus ores), and blocks that fall into a hole dug under them; water as collect sees it (wetAt)
import { FALLING, MINE_DIGGABLE as DIGGABLE, MINE_STONE as STONE } from './mcBlocks';

/** A chunk not loaded: try again later (not a reason to end the mine). */
const UNLOADED = 'not loaded';

/** Main tunnel columns between branches, each branch's length (village.ts, for the record), and the cells of one stretch (main, left, right). */
const MAIN_STEP = MINE_STEP, BRANCH = MINE_BRANCH, PER = MAIN_STEP + 2 * BRANCH;
/** Main tunnels at most per level: the first and the turns made from those that ended (V.5b); and tunnel cells dug at most. */
const MAX_LEGS = 12, MAX_CELLS = 40 * PER;
/** Levels at most, and steps down from one to the next at least (three solid layers between their tunnels) and at most. */
const MAX_LEVELS = 3, DOWN_STEPS = 6, DOWN_MAX = 10;

/** Cell k (0-based) of a main tunnel and its branches, in digging order, with the cell to stand on and its branch (for
 *  skipping): the iron level's tunnels, and the check of the cobblestone mine's per-part record against it. */
export function tunnelCell(l: MineLeg, k: number): { x: number; z: number; from: { x: number; z: number }; branch: number } {
  const [dx, dz] = l.dir;
  // Where the main tunnel starts: the bottom of the stairs, or the junction it turned at
  const sx = l.x, sz = l.z;
  const per = PER;
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
 * What one miner digs at a time in the cobblestone mine (S.2): a tunnel's main cells, or one of its branches by id (3s + 1
 * the left and 3s + 2 the right branch at junction s + 1, main cell 3(s + 1)), dug from the junction outward.
 */
type Unit = 'main' | number;

/** A tunnel's main cells done, and a branch's cells done (from the in-order counter on the iron level's and older records). */
const mainOf = (l: MineLeg) => (l.br ? (l.main ?? 0) : fromOrder(l.dug).main);
const brOf = (l: MineLeg, b: number) => (l.br ? l.br[b] : fromOrder(l.dug).br[b]) ?? 0;
/** Whether a branch is finished: dug its full length, or cut short. */
const branchDone = (l: MineLeg, b: number) => brOf(l, b) >= BRANCH || l.ended.includes(b);
/** Whether a tunnel's first stretch is done: its first junction, and both branches there. */
const stretch0Done = (l: MineLeg) => mainOf(l) >= MAIN_STEP && branchDone(l, 1) && branchDone(l, 2);

/** A tunnel's branches at the junctions it has dug that are not finished: what helpers dig (S.2). */
function openBranches(l: MineLeg): number[] {
  const out: number[] = [];
  for (let s = 0; s < Math.floor(mainOf(l) / MAIN_STEP); s++) for (const b of [3 * s + 1, 3 * s + 2]) if (!branchDone(l, b)) out.push(b);
  return out;
}

/** Cell n of a unit (1-based; 0 is where it starts: the tunnel's start, or the branch's junction). Same geometry as tunnelCell. */
function cellAt(l: MineLeg, u: Unit, n: number): { x: number; z: number } {
  const [dx, dz] = l.dir;
  if (u === 'main') return { x: l.x + dx * n, z: l.z + dz * n };
  const k = MAIN_STEP * (Math.floor(u / 3) + 1);
  const [bx, bz] = u % 3 === 1 ? [dz, -dx] : [-dz, dx];
  return { x: l.x + dx * k + bx * n, z: l.z + dz * k + bz * n };
}

/** A unit's next cell, the cell it is dug from, and its number in the unit. */
function unitCell(l: MineLeg, u: Unit): { x: number; z: number; from: { x: number; z: number }; n: number } {
  const n = (u === 'main' ? mainOf(l) : brOf(l, u)) + 1;
  return { ...cellAt(l, u, n), from: cellAt(l, u, n - 1), n };
}

/** A unit's next cell done (dug, or found open); `dug` is then the tunnel's cells in all, for display only. */
function advance(l: MineLeg, u: Unit) {
  if (!l.br) Object.assign(l, fromOrder(l.dug));
  if (u === 'main') l.main = mainOf(l) + 1;
  else l.br![u] = brOf(l, u) + 1;
  l.dug = (l.main ?? 0) + Object.values(l.br!).reduce((s, n) => s + n, 0);
}

/** The cells a tunnel has dug or passed: its main cells, and each dug junction's branches as far as they go. */
export function legCells(l: MineLeg): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  const mn = mainOf(l);
  for (let i = 1; i <= mn; i++) out.push(cellAt(l, 'main', i));
  for (let s = 0; s < Math.floor(mn / MAIN_STEP); s++)
    for (const b of [3 * s + 1, 3 * s + 2]) for (let j = 1; j <= Math.min(BRANCH, brOf(l, b)); j++) out.push(cellAt(l, b, j));
  return out;
}

/**
 * The cells a tunnel may still dig soon (the iron stairs keep off them): the rest of its open branches, which helpers dig
 * on a tunnel that ended too; and with `going`, its next two stretches (main cells and their junctions' branches).
 */
function legAhead(l: MineLeg, going: boolean): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const b of openBranches(l)) for (let j = brOf(l, b) + 1; j <= BRANCH; j++) out.push(cellAt(l, b, j));
  const mn = mainOf(l);
  for (let i = mn + 1; going && i <= mn + 2 * MAIN_STEP; i++) {
    out.push(cellAt(l, 'main', i));
    if (i % MAIN_STEP === 0) for (const b of [i - 2, i - 1]) for (let j = 1; j <= BRANCH; j++) out.push(cellAt(l, b, j));
  }
  return out;
}

/**
 * Why a cell may not be dug (null if it may; UNLOADED if its chunk is not loaded): beyond the village's range; any
 * village's plot and its margin down to 4 below its level (not for the stairs: they start inside the mining hut on the
 * plot), or a building and a block around it (the mining hut excepted); another village's mine; the stairs and the
 * cells beside them (for tunnels); open air beside it under the sky (not for the first stairs); anything not natural ground; water or lava next to it; and, with `ceiling`, no solid ceiling over it
 * (a tunnel coming out on a hillside, or sand and gravel that would fall in: suffocation hurts even here).
 */
function unsafe(a: BotAgent, v: Village, m: Mine, p: Vec3, ceiling: boolean, mode: 'stairs' | 'down' | 'tunnel' = 'tunnel', from?: { x: number; z: number }): string | null {
  const stairs = mode === 'stairs';
  const b = a.bot.blockAt(p);
  if (!b) return UNLOADED;
  const where = `${p.x},${p.y},${p.z}`;
  const home = villageHome(v);
  if (home && Math.hypot(p.x - home.x, p.z - home.z) > 90) return `${where} is at the edge of the village's range`;
  for (const o of a.world.villages.villages.values()) {
    if (!stairs && o.plots.some((q) => p.x >= q.x1 - 2 && p.x <= q.x2 + 2 && p.z >= q.z1 - 2 && p.z <= q.z2 + 2 && p.y >= q.y - 4)) return `${where} is under ${o.name}'s plot`;
    const built = o.structures.find((s) => !(s.kind === MINING_HUT && s.x1 === m.hut.x1 && s.z1 === m.hut.z1) && p.x >= s.x1 - 1 && p.x <= s.x2 + 1 && p.z >= s.z1 - 1 && p.z <= s.z2 + 1 && p.y >= s.y - 2);
    if (built) return `${where} is at ${o.name}'s ${built.kind}`;
    // A laid-out plot: like a plot at the level of the prepared plot over it; at any height before it is prepared (its
    // level is not known yet, and levelling it could cut into a tunnel)
    for (const l of stairs ? [] : o.layouts ?? []) {
      if (p.x < l.x1 - 2 || p.x > l.x2 + 2 || p.z < l.z1 - 2 || p.z > l.z2 + 2) continue;
      const over = o.plots.find((q) => q.x1 <= l.x2 && q.x2 >= l.x1 && q.z1 <= l.z2 && q.z2 >= l.z1);
      if (!over || p.y >= over.y - 4) return `${where} is under ${o.name}'s laid-out plot`;
    }
    // Another village's mine: its tunnels are not this one's to cross
    if (o !== v && o.mine && mineAreas(o.mine).some((q) => p.x >= q.x1 && p.x <= q.x2 && p.z >= q.z1 && p.z <= q.z2 && p.y >= q.y && p.y <= q.y2)) return `${where} is at ${o.name}'s mine`;
  }
  // A tunnel (a turned one could pass under them) keeps off the stairs but the bottom step, where the first one starts
  if (mode === 'tunnel' && keptStairs(m).some((s) => Math.abs(s.x - p.x) + Math.abs(s.z - p.z) <= 1 && (s.y1 === undefined || (p.y >= s.y1 - 2 && p.y <= s.y2! + 2)))) return `${where} is at the mine stairs`;
  if (wetAt(a, p)) return `${b.name} at ${where}`;
  if (b.boundingBox !== 'empty' && !DIGGABLE.has(b.name)) return `${b.name} at ${where} (not natural ground)`;
  for (const d of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
    const q = p.offset(d[0], d[1], d[2]);
    if (wetAt(a, q)) return `${a.bot.blockAt(q)?.name} next to ${where}`;
  }
  // Open air beside it under the open sky: the tunnel would come out on a hillside (the floors of StageH19's tunnels
  // turned to grass where they had). Not on the side it is dug from
  for (const [dx, dz] of stairs ? [] : [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (from && p.x + dx === from.x && p.z + dz === from.z) continue;
    const side = p.offset(dx, 0, dz);
    let open = true;
    for (let up = 0; up <= 8 && open; up++) {
      const s = a.bot.blockAt(side.offset(0, up, 0));
      open = !!s && s.boundingBox === 'empty' && !wetAt(a, s.position);
    }
    if (open) return `open air beside ${where} (a hillside)`;
  }
  if (ceiling) {
    const up = a.bot.blockAt(p.offset(0, 1, 0));
    if (!up) return UNLOADED;
    if (up.boundingBox !== 'block' || FALLING.has(up.name)) return `${up.name} over ${where} (no solid ceiling)`;
  }
  return null;
}

/** The columns of the stairs, from the first step (inside the hut) to the bottom one. */
function stairColumns(m: Mine) {
  return Array.from({ length: m.steps }, (_, i) => ({ x: m.top.x + m.dir[0] * i, z: m.top.z + m.dir[1] * i }));
}

/** The columns of the stairs down to a deeper level, from its first step to its last. */
function downColumns(m: Mine, d: { x: number; z: number; steps: number }) {
  return Array.from({ length: d.steps }, (_, i) => ({ x: d.x + m.dir[0] * (i + 1), z: d.z + m.dir[1] * (i + 1) }));
}

/** Stair columns no tunnel may dig in or beside: all but each bottom step a level's first tunnel starts from. */
function keptStairs(m: Mine): Array<{ x: number; z: number; y1?: number; y2?: number }> {
  // (the iron level's stairs, given up ones too, only near their own height: they run sideways under the levels, and
  // kept at every height they ended tunnels far above or below them, the diff review's M2)
  const iron = (d: { x: number; z: number; y: number; dir: [number, number]; steps: number }, last: boolean) =>
    ironColumns({ ...m.iron!, ...d }).slice(0, last ? undefined : -1).map((c, k) => ({ ...c, y1: d.y - (k + 1), y2: d.y - (k + 1) + 2 }));
  return [...stairColumns(m).slice(0, -1), ...(m.down ?? []).flatMap((d) => downColumns(m, d).slice(0, d.level !== undefined ? -1 : undefined)),
    // (finished ones too: their first steps stay open at the level's height, the final review)
    ...(m.iron ? iron(m.iron, m.iron.level === undefined) : []),
    ...(m.iron?.abandoned ?? []).flatMap((d) => iron(d, true))];
}

/** The iron level's stair columns, from its first step to its last (they run in its own direction, 10-08). */
function ironColumns(i: IronLevel) {
  return Array.from({ length: i.steps }, (_, k) => ({ x: i.x + i.dir[0] * (k + 1), z: i.z + i.dir[1] * (k + 1) }));
}

/**
 * A main tunnel's box: its branches and a block around, to the end of the stretch being dug; floor to ceiling. Kept per
 * part (S.2), to the end of the stretch its main tunnel is in: once a junction is dug, the stretch after it (the main
 * tunnel goes on there while helpers dig the junction's branches).
 */
export function legBox(l: MineLeg): Area & { y: number; y2: number } {
  const [dx, dz] = l.dir;
  const len = MAIN_STEP * ((l.br ? Math.floor(mainOf(l) / MAIN_STEP) : Math.floor(l.dug / PER)) + 1) + 1;
  const ends = [
    { x: l.x - dx + dz * (BRANCH + 1), z: l.z - dz - dx * (BRANCH + 1) },
    { x: l.x + dx * len - dz * (BRANCH + 1), z: l.z + dz * len + dx * (BRANCH + 1) },
  ];
  return {
    x1: Math.min(...ends.map((e) => e.x)), z1: Math.min(...ends.map((e) => e.z)),
    x2: Math.max(...ends.map((e) => e.x)), z2: Math.max(...ends.map((e) => e.z)),
    y: l.y - 1, y2: l.y + 2,
  };
}

/**
 * The ground the mine takes up, kept from other digging: the hut and the stairs (from the tunnel floor to the hut's
 * floor), the stairs down to deeper levels, and each main tunnel's reach (its branches and a block around, to the end of the stretch being dug; floor to
 * ceiling, so no shaft is dug into it, while the ground above stays free). One box per tunnel: a box around turned
 * tunnels together would cover far more ground than they do.
 */
export function mineAreas(m: Mine): Array<Area & { y: number; y2: number }> {
  if (m.level === undefined) return [];
  const cols = stairColumns(m);
  const out = [{
    x1: Math.min(m.hut.x1, ...cols.map((c) => c.x - 1)), z1: Math.min(m.hut.z1, ...cols.map((c) => c.z - 1)),
    x2: Math.max(m.hut.x2, ...cols.map((c) => c.x + 1)), z2: Math.max(m.hut.z2, ...cols.map((c) => c.z + 1)),
    y: m.level - 1, y2: m.level + m.steps + 2,
  }];
  for (const d of m.down ?? []) {
    const cols = [{ x: d.x, z: d.z }, ...downColumns(m, d)];
    out.push({
      x1: Math.min(...cols.map((c) => c.x - 1)), z1: Math.min(...cols.map((c) => c.z - 1)),
      x2: Math.max(...cols.map((c) => c.x + 1)), z2: Math.max(...cols.map((c) => c.z + 1)),
      y: d.y - d.steps - 2, y2: d.y + 2,
    });
  }
  for (const l of m.legs ?? []) out.push(legBox(l));
  // The iron level: its stairs (from the step they start beside down to the last) and its tunnels (10-08)
  const i = m.iron;
  for (const d of i?.abandoned ?? []) {
    const cols = [{ x: d.x, z: d.z }, ...ironColumns({ ...i!, ...d })];
    out.push({
      x1: Math.min(...cols.map((c) => c.x - 1)), z1: Math.min(...cols.map((c) => c.z - 1)),
      x2: Math.max(...cols.map((c) => c.x + 1)), z2: Math.max(...cols.map((c) => c.z + 1)),
      y: d.y - d.steps - 2, y2: d.y + 2,
    });
  }
  if (i && i.steps) {
    const cols = [{ x: i.x, z: i.z }, ...ironColumns(i)];
    out.push({
      x1: Math.min(...cols.map((c) => c.x - 1)), z1: Math.min(...cols.map((c) => c.z - 1)),
      x2: Math.max(...cols.map((c) => c.x + 1)), z2: Math.max(...cols.map((c) => c.z + 1)),
      y: i.y - i.steps - 2, y2: i.y + 2,
    });
  }
  for (const l of i?.legs ?? []) out.push(legBox(l));
  return out;
}

/** The six blocks around a cell. */
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];

/**
 * Dig one planned cell (a pickaxe made if stone needs one); records what it gave and the ores it laid open. The drop
 * is left where it fell: the bot steps into the cell next and picks it up (walking to each drop took seconds a block).
 * Whether it dug the block (not when it found it open: another bot's dig, S.2). `errand`: told when the bot leaves for a
 * pickaxe and when it is back (false then: another bot dug the cell meanwhile, and it is passed).
 */
async function digCell(a: BotAgent, m: Mine, p: Vec3, signal: AbortSignal, stand?: Vec3, opts: { got?: Record<string, number>; strict?: boolean; errand?: (out: boolean) => Promise<boolean> } = {}): Promise<boolean> {
  const b = a.bot.blockAt(p);
  if (!b || b.boundingBox === 'empty') return false;
  const name = b.name;
  // Tunnels and the stairs down: dug standing on their approach (`stand`: the cell before, the step above), or not at
  // all. mineBlock's own walk is free to dig, through ground the mine has not planned (F80), and a bot anywhere within
  // reach would dig through the rock from a parallel branch. The stairs from the hut keep mineBlock's walk: they lie on
  // the plot (kept from digging), and the pathfinder does not always find its way onto the step under the hut's wall
  // (StageM4, M5: it stopped on the ground above, F81)
  const there = () => !stand || (a.bot.entity.position.distanceTo(stand) <= 1.5 && a.bot.entity.position.offset(0, 1.62, 0).distanceTo(p.offset(0.5, 0.5, 0.5)) <= 4.2);
  const away = () => Object.assign(new Error(`could not get to the mine at ${p.x},${p.y},${p.z} (stuck at ${a.bot.entity.position.floored()})`), { away: true, inMine: inMine(a, m) });
  const back = async () => {
    const go = (to: Vec3, range: number) => walkMine(a, to, range, signal, 45000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    // From outside, first to the top of the stairs: one search from a tree 20 blocks off down to the face found no way
    // (Minevale2, after a pickaxe was made outside, F85)
    if (stand && !there() && !inMine(a, m) && m.level !== undefined) await go(new Vec3(m.top.x + 0.5, m.level + m.steps - 1, m.top.z + 0.5), 1.5);
    if (stand && !there()) await go(stand, 1.2);
    if (!there()) throw away();
  };
  await back();
  let forced = false, said = '';
  try {
    said = await mineBlock(a, p, signal, false, 20000, false);
  } catch (e) {
    const m2 = (e as Error).message;
    if (!/^needs \w+_pickaxe/.test(m2)) throw e;
    // (the iron level never digs an iron or coal ore it cannot harvest: its iron would be lost, the design review's M2;
    // gold or emerald a stone pickaxe cannot take is dug through as the cobblestone mine does, the diff review's H2)
    if (opts.strict && KEEP.test(name)) throw Object.assign(new Error(`no pickaxe good enough for the ${name} at ${p.x},${p.y},${p.z} (${m2.slice(0, 80)})`), { tool: true });
    // Stone with no pickaxe at all: make one. An ore this pickaxe cannot harvest (copper with a wooden one, StageH18):
    // dug through anyway, its drop lost, rather than the tunnel stopping there
    // (and none made from down there: the walk for logs is free to dig, the diff review's L1)
    if (opts.strict && !a.bot.inventory.items().some((it) => it.name.endsWith('_pickaxe'))) throw Object.assign(new Error(`no pickaxe left for the iron level at ${p.x},${p.y},${p.z}`), { tool: true });
    if (/^needs wooden_pickaxe/.test(m2) && !a.bot.inventory.items().some((it) => it.name.endsWith('_pickaxe'))) {
      // Not the cell's fault when this fails (logs out of reach): the mine must not end a tunnel for it
      await opts.errand?.(true);
      await makePickaxe(a, signal).catch((e: Error) => {
        throw e.message === 'cancelled' ? e : Object.assign(new Error(`no pickaxe for the mine (${e.message.slice(0, 120)}): withdraw or make one`), { tool: true });
      });
      // Back from wherever making it took the bot, by the mine's own ways
      await back();
      if (opts.errand && !(await opts.errand(false))) return false;
      said = await mineBlock(a, p, signal, false, 20000, false);
    } else {
      said = await mineBlock(a, p, signal, true, 20000, false);
      forced = true;
    }
  }
  if (/^nothing to mine/.test(said)) return false;
  // (a block dug without the tool it needs dropped nothing: counted as lost, not as its drop)
  const drop = forced ? `lost ${name}` : dropOf(name);
  const got = opts.got ?? m.got;
  got[drop] = (got[drop] ?? 0) + 1;
  // Ores this cell laid open in the walls, floor and ceiling, each counted once: not when it touched air before (an
  // earlier cell, a cave). The atlas records every exposed ore by chunk when it summarises the chunk again (V.6)
  const v = a.village();
  if (v) a.world.atlas.mined(p.x, p.z, v.name);
  for (const d of SIDES) {
    const q = p.offset(d[0], d[1], d[2]);
    const n = a.bot.blockAt(q);
    if (!n || !/_ore$/.test(n.name)) continue;
    const before = SIDES.some((e) => (e[0] !== -d[0] || e[1] !== -d[1] || e[2] !== -d[2]) && /^(air|cave_air)$/.test(a.bot.blockAt(q.offset(e[0], e[1], e[2]))?.name ?? ''));
    if (!before) got[`seen ${n.name}`] = (got[`seen ${n.name}`] ?? 0) + 1;
  }
  return true;
}

/** What a dug block gives (an ore its drop: raw iron, coal...; stone cobblestone). */
function dropOf(name: string): string {
  const ore = /^(?:deepslate_)?(\w+)_ore$/.exec(name);
  if (ore) return { iron: 'raw_iron', copper: 'raw_copper', gold: 'raw_gold', lapis: 'lapis_lazuli' }[ore[1]] ?? ore[1];
  return name === 'stone' ? 'cobblestone' : name === 'deepslate' ? 'cobbled_deepslate' : name;
}

/** Whether the bot stands in the iron level (its stairs or tunnels): a stuck bot there is teleported home (10-08). */
export function inIronLevel(a: BotAgent): boolean {
  const i = a.village()?.mine?.iron;
  if (!i || !i.steps) return false;
  const p = a.bot.entity.position.floored();
  const cols = [{ x: i.x, z: i.z }, ...ironColumns(i)];
  const near = cols.some((c) => Math.abs(c.x - p.x) <= 1 && Math.abs(c.z - p.z) <= 1) && p.y < i.y && p.y >= i.y - i.steps - 2;
  const given = (i.abandoned ?? []).some((d) => [{ x: d.x, z: d.z }, ...ironColumns({ ...i, ...d })].some((c) => Math.abs(c.x - p.x) <= 1 && Math.abs(c.z - p.z) <= 1) && p.y < d.y && p.y >= d.y - d.steps - 2);
  return near || given || i.legs.some((l) => { const b = legBox(l); return p.x >= b.x1 && p.x <= b.x2 && p.z >= b.z1 && p.z <= b.z2 && p.y >= b.y && p.y <= b.y2 + 1; });
}

/** Whether the bot stands in the mine: in one of its boxes, between the floor and the ceiling. */
function inMine(a: BotAgent, m: Mine): boolean {
  const p = a.bot.entity.position.floored();
  return mineAreas(m).some((q) => p.x >= q.x1 && p.x <= q.x2 && p.z >= q.z1 && p.z <= q.z2 && p.y >= q.y && p.y <= q.y2 + 1);
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
    const inStone = [1, 2].every((dy) => STONE.has(a.bot.blockAt(new Vec3(x, floor + dy, z))?.name ?? ''));
    for (const dy of [3, 2, 1]) {
      const p = new Vec3(x, floor + dy, z);
      // Outside the hut (from the fourth step) the top cell needs a solid ceiling
      const why = unsafe(a, v, m, p, dy === 3 && i >= 4, 'stairs');
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
    if (wetAt(a, under.position)) return stop(`${under.name} under step ${i}`);
    m.steps = i;
    reg.save();
    // Seven steps at least: the tunnels then run 5 or more below the plot, under the ground kept from digging
    if (i >= 7 && STONE.has(under.name) && inStone) {
      m.level = floor + 1;
      upgradeMine(m);
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

/**
 * Walk within the mine without digging, building or pillaring on the way: the stairs and tunnels are open from the hut
 * down. A path search free to dig cut a shortcut from the hut to the face through ground the mine had not planned
 * (mine check on StageH19, F80); the cells themselves are dug with bot.dig.
 */
async function walkMine(a: BotAgent, pos: Vec3, range: number, signal: AbortSignal, timeoutMs: number) {
  const mv = a.moves();
  const saved = { canDig: mv.canDig, scafoldingBlocks: mv.scafoldingBlocks, allow1by1towers: mv.allow1by1towers };
  Object.assign(mv, { canDig: false, scafoldingBlocks: [], allow1by1towers: false });
  try {
    await reach(a, pos, range, signal, timeoutMs);
  } finally {
    Object.assign(mv, saved);
  }
}

/**
 * The stairs on down to the next level: from the bottom step of the deepest level, on in the stairs' direction, one
 * block down per step with three blocks of headroom, under that level's first tunnel (nothing goes there any more), at
 * least DOWN_STEPS steps (three solid layers between the levels' tunnels) and until the new level's cells are stone.
 * Then the new level's first tunnel starts from the bottom step. Returns '' when the new level is ready, UNLOADED, or
 * why the stairs stopped (a reason like unsafe()'s; that ends the mine).
 */
async function digDown(a: BotAgent, v: Village, m: Mine, signal: AbortSignal, until: number): Promise<string> {
  const reg = a.world.villages;
  m.down ??= [];
  let d = m.down.find((x) => x.level === undefined && !x.stopped);
  if (!d) {
    // From the bottom step of the deepest level: the first stairs' bottom, or the last stairs down's
    const last = m.down[m.down.length - 1];
    const from = last ? downColumns(m, last)[last.steps - 1] : stairColumns(m)[m.steps - 1];
    d = { x: from.x, z: from.z, y: last ? last.level! : m.level!, steps: 0 };
    m.down.push(d);
    reg.note(v, `${a.name} goes on down from the mine's level at y=${d.y}: no tunnel there can go on`);
  }
  const [dx, dz] = m.dir;
  for (let k = d.steps + 1; k <= DOWN_MAX; k++) {
    checkAbort(signal);
    if (Date.now() > until) return TIME_UP;
    const x = d.x + dx * k, z = d.z + dz * k, floor = d.y - 1 - k;
    // Stand on the step above (the level's bottom step for the first) and dig the three cells over this step, top first
    await walkMine(a, new Vec3(x - dx + 0.5, floor + 2, z - dz + 0.5), 1.2, signal, 60000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    const inStone = [1, 2].every((dy) => STONE.has(a.bot.blockAt(new Vec3(x, floor + dy, z))?.name ?? ''));
    for (const dy of [3, 2, 1]) {
      const p = new Vec3(x, floor + dy, z);
      const why = unsafe(a, v, m, p, false, 'down', { x: x - dx, z: z - dz });
      if (why) return stopDown(v, m, d, why);
      // Over the top cell: a solid ceiling, or the tunnel above (open) with its own ceiling, up to that level's
      if (dy === 3) {
        let up = p.y + 1, above = a.bot.blockAt(new Vec3(x, up, z));
        while (above && above.boundingBox === 'empty' && !wetAt(a, above.position) && up < d.y + 2) above = a.bot.blockAt(new Vec3(x, ++up, z));
        if (!above) return UNLOADED;
        if (above.boundingBox !== 'block' || FALLING.has(above.name)) return stopDown(v, m, d, `${above.name} over ${x},${up - 1},${z} (no solid ceiling)`);
      }
      await digCell(a, m, p, signal, new Vec3(x - dx + 0.5, floor + 2, z - dz + 0.5));
    }
    await walkMine(a, new Vec3(x + 0.5, floor + 1, z + 0.5), 0.6, signal, 20000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    const under = a.bot.blockAt(new Vec3(x, floor, z));
    if (!under) return UNLOADED;
    if (under.boundingBox !== 'block' || wetAt(a, under.position)) return stopDown(v, m, d, `no floor under ${x},${floor + 1},${z}`);
    d.steps = k;
    reg.save();
    if (k >= DOWN_STEPS && inStone && STONE.has(under.name)) {
      d.level = floor + 1;
      m.legs!.push({ x, z, y: d.level, dir: [dx, dz], dug: 0, main: 0, br: {}, ended: [] });
      reg.note(v, `${a.name} dug the mine's stairs ${k} steps on down to a new level at y=${d.level}`);
      reg.save();
      return '';
    }
  }
  return stopDown(v, m, d, `no stone within ${DOWN_MAX} steps down`);
}

function stopDown(v: Village, m: Mine, d: { stopped?: string }, why: string): string {
  if (why === UNLOADED) return why;
  d.stopped = short(why);
  return why;
}

/** Whether a village's mine can give this (cobblestone, from stone), once its stairs reached stone and while it goes on. */
export function mineCanGive(v: Village | undefined, item: string): boolean {
  const m = v?.mine;
  return !!m && m.level !== undefined && !m.stopped && /^(cobblestone|stone)$/.test(item) && m.dug < MAX_CELLS;
}

/** Whether the stairs may go on down to a next level, once no tunnel at the deepest level can go on. */
function canGoDown(m: Mine): boolean {
  const downs = m.down ?? [];
  return m.dug < MAX_CELLS && !downs.some((d) => d.stopped) && (downs.some((d) => d.level === undefined) || downs.length < MAX_LEVELS - 1);
}

/**
 * The mine's faces at its deepest level, for the claim gate (S.2): tunnels still going (not one whose holder is on a
 * branch: that bot counts there), branches open at dug junctions, turns to come (untried sides with somewhere to turn now,
 * up to the tunnel limit; read only, nothing is marked tried), and the stairs down when none of those is left. `held`:
 * the bots holding one (and the stairs' digger); `free` the rest. `alive`: whether a bot is still in the world.
 */
export function mineFaces(v: Village, alive: (name: string) => boolean) {
  const out = { faces: 0, free: 0, held: 0, tunnels: 0, branches: 0, turns: 0, down: 0 };
  const m = v.mine;
  if (!m?.legs?.length || !mineCanGive(v, 'cobblestone')) return out;
  const legs = deepest(m);
  const bots = new Set<string>(), onBranch = new Set<string>();
  for (const [k, n] of holders)
    if (k.startsWith(`${v.name}|`) && alive(n)) {
      bots.add(n);
      if (!k.endsWith('|main')) onBranch.add(n);
    }
  let going = 0, sides = 0;
  for (const [i, l] of legs.entries()) {
    const main = holders.get(hkey(v, m.legs.indexOf(l), 'main'));
    if (!l.end) going++;
    if (!l.end && !(main && alive(main) && onBranch.has(main))) out.tunnels++;
    out.branches += openBranches(l).length;
    for (const side of [1, 2] as const) if (!((l.turned ?? 0) & side) && turnFrom(l, side, bottomTurn(l, i))) sides++;
  }
  out.turns = Math.max(0, Math.min(MAX_LEGS - legs.length, sides));
  out.down = going + out.branches + out.turns === 0 && canGoDown(m) ? 1 : 0;
  const down = downHolders.get(v.name);
  out.held = bots.size + (down && alive(down) && !bots.has(down) ? 1 : 0);
  out.faces = out.tunnels + out.branches + out.turns + out.down;
  out.free = Math.max(0, out.faces - out.held);
  return out;
}

const compass = ([dx, dz]: [number, number]) => (dx > 0 ? 'east' : dx < 0 ? 'west' : dz > 0 ? 'south' : 'north');

/**
 * A main tunnel turned left (side 1) or right (2) of another: at its latest junction whose branch on that side ran its
 * full length, so the new tunnel's first stretch is that branch, already dug. The first tunnel may also turn at the
 * bottom of the stairs (its sides are untouched there); a turned one's start lies on the tunnel it turned from. Only
 * reads the record (the iron level's tunnels turn by it too): the caller records the turn.
 */
export function turnFrom(l: MineLeg, side: 1 | 2, first: boolean): MineLeg | null {
  const [dx, dz] = l.dir;
  const dir: [number, number] = side === 1 ? [dz, -dx] : [-dz, dx];
  // Junction s (main cell MAIN_STEP * s) carries branches 3(s - 1) + 1 and + 2: in a tunnel kept in order all done before
  // the main cell that ended it; kept per part (S.2), one may still be under way, not one to turn along yet
  for (let s = Math.floor(mainOf(l) / MAIN_STEP); s >= 1; s--) {
    const b = 3 * (s - 1) + side;
    if (brOf(l, b) >= BRANCH && !l.ended.includes(b)) return { x: l.x + dx * MAIN_STEP * s, z: l.z + dz * MAIN_STEP * s, y: l.y, dir, dug: 0, ended: [] };
  }
  return first ? { x: l.x, z: l.z, y: l.y, dir, dug: 0, ended: [] } : null;
}

/** The deepest level's tunnels (a level is left for the next only when none of its tunnels can go on). */
function deepest(m: Mine): MineLeg[] {
  const y = Math.min(...m.legs!.map((l) => l.y));
  return m.legs!.filter((l) => l.y === y);
}

/**
 * Whether the level's first tunnel (i: its place in deepest()) may also turn at the bottom of the stairs: once it has
 * ended, or for another miner while its first stretch is not done (a second face then rather than a wait, StageM7).
 */
const bottomTurn = (l: MineLeg, i: number) => i === 0 && (!!l.end || !stretch0Done(l));

/**
 * What to dig next at the deepest level (S.2: a unit, a tunnel's main cells or one of its branches): a branch it holds,
 * until done; else its own tunnel (holderNext); else a free tunnel still going, the newest first; else, as a helper, the
 * nearest free branch open at a dug junction of any tunnel there, ended ones too; else a new turn, from the oldest tunnel
 * first (they lie closer to the stairs). 'busy' while what is left is other bots' (a tunnel going, a branch open); null
 * when nothing is left at this level.
 */
function nextLeg(a: BotAgent, v: Village, m: Mine): { leg: MineLeg; unit: Unit } | 'busy' | null {
  const legs = deepest(m);
  const at = (l: MineLeg) => m.legs!.indexOf(l);
  for (const h of heldOf(a, v)) {
    const l = m.legs![h.leg];
    if (l && h.unit !== 'main' && !branchDone(l, h.unit)) return { leg: l, unit: h.unit };
  }
  // The tunnel it holds first (else, once another bot's trip ended, it took that bot's tunnel as well)
  const own = legs.find((l) => !l.end && heldBy(a, v, at(l), 'main') === a.name);
  const ownNext = own && holderNext(a, v, m, own);
  if (ownNext) return ownNext;
  for (let i = legs.length - 1; i >= 0; i--) {
    const l = legs[i];
    if (l.end || heldBy(a, v, at(l), 'main')) continue;
    holdMain(a, v, m, l, `main ${mainOf(l)}`);
    const n = holderNext(a, v, m, l);
    if (n) return n;
  }
  // Every tunnel still going is another bot's: a free branch at a junction it has dug, before a turn (the record alone
  // says the junction is dug: it moves on only past cells the server has open, lesson 80, and a junction this bot's view
  // has not loaded would have left work out and stopped the mine)
  const p = a.bot.entity.position;
  let best: { l: MineLeg; b: number; d: number } | undefined;
  for (const l of legs)
    for (const b of openBranches(l)) {
      if (heldBy(a, v, at(l), b)) continue;
      const c = cellAt(l, b, brOf(l, b));
      const d = Math.abs(c.x + 0.5 - p.x) + Math.abs(c.z + 0.5 - p.z);
      if (!best || d < best.d) best = { l, b, d };
    }
  if (best) {
    const { l, b } = best, j = cellAt(l, b, 0);
    holdBranch(a, v, m, l, b, `at junction ${j.x},${l.y},${j.z} (${brOf(l, b)}/${BRANCH} dug; tunnel ${at(l)} ${l.end ? 'ended' : `held by ${heldBy(a, v, at(l), 'main') ?? 'nobody'}`})`);
    return { leg: l, unit: b };
  }
  // Then it turns off one of them (or off one that ended) at a finished junction, so that two never dig the same cells
  // (StageM4: the second went for cells the first had not dug yet)
  if (legs.length < MAX_LEGS)
    for (const [i, l] of legs.entries())
      for (const side of [1, 2] as const) {
        if ((l.turned ?? 0) & side) continue;
        const t = turnFrom(l, side, bottomTurn(l, i));
        // A tunnel still going may yet finish a junction to turn at; so may one that ended while a branch on that side is
        // still open (helpers dig on there: marked tried now, the side would be lost for good)
        if (!t && (!l.end || openBranches(l).some((b) => b % 3 === side))) continue;
        l.turned = (l.turned ?? 0) | side;
        if (!t) continue;
        m.legs!.push(Object.assign(t, { main: 0, br: {} }));
        a.world.villages.note(v, `${a.name} turned the mine ${compass(t.dir)} at ${t.x},${t.y},${t.z} (${l.end ? `the ${compass(l.dir)} tunnel met ${l.end}` : `the ${compass(l.dir)} tunnel is another miner's`})`);
        holdMain(a, v, m, t, `turned ${compass(t.dir)} off tunnel ${at(l)} at ${t.x},${t.y},${t.z}`);
        return { leg: t, unit: 'main' };
      }
  // Others hold what is left: wait for it (a branch open at a dug junction counts whoever holds it, so that the mine never
  // goes on down or stops while its record still lists work); null when nothing is left at this level
  return legs.some((l) => !l.end || openBranches(l).length) ? 'busy' : null;
}

/** A tunnel's holder leaves its junction's branches to miners waiting for a face and digs on along the main tunnel (S.2;
 *  MC_MINE_LEAVE=0 for comparison runs: the holder then digs main, left, right in order however many wait). */
const LEAVE_BRANCHES = process.env.MC_MINE_LEAVE !== '0';
/** Branches left to waiting miners, said once each. */
const leftNoted = new Set<string>();

/**
 * The next unit of the tunnel a bot holds: a branch open at one of its dug junctions, the oldest first (not one another bot
 * holds; with miners waiting for a face, all are left to them while the main tunnel goes on to the next junction), else
 * the main cells; null, the tunnel let go, once it has ended. With nobody waiting the holder digs main, left, right in
 * order, as before S.2, and goes back for branches left earlier that nobody finished.
 */
function holderNext(a: BotAgent, v: Village, m: Mine, l: MineLeg): { leg: MineLeg; unit: Unit } | null {
  const i = m.legs!.indexOf(l);
  const waiting = LEAVE_BRANCHES && !l.end ? waitingFor(v, a) : 0;
  for (const b of openBranches(l)) {
    if (heldBy(a, v, i, b)) continue;
    if (waiting > 0) {
      if (!leftNoted.has(hkey(v, i, b))) console.log(`[mine] ${a.name} leaves branch ${i}:${b} to a waiting miner (${waiting} waiting)`);
      leftNoted.add(hkey(v, i, b));
      continue;
    }
    holdBranch(a, v, m, l, b, `(its own tunnel; ${brOf(l, b)}/${BRANCH})`);
    return { leg: l, unit: b };
  }
  if (!l.end) return { leg: l, unit: 'main' };
  letGo(a, v, i, 'main', 'the tunnel has ended');
  return null;
}

/**
 * Who digs what right now (S.2): by "village|tunnel|unit", a tunnel by its place in the mine's record (only ever
 * appended); one bot a unit, a miner holding at most its tunnel's main cells and one branch, released when its trip ends.
 * And who digs the stairs down, by village.
 */
const holders = new Map<string, string>(), downHolders = new Map<string, string>();
const hkey = (v: Village, leg: number, u: Unit) => `${v.name}|${leg}|${u}`;
/** The bot holding a unit, while it is in the world (a removed bot never blocks one). */
function heldBy(a: BotAgent, v: Village, leg: number, u: Unit): string | undefined {
  const n = holders.get(hkey(v, leg, u));
  return n && a.world.agents.has(n.toLowerCase()) ? n : undefined;
}
/** What a bot holds in a village. */
function heldOf(a: BotAgent, v: Village): Array<{ leg: number; unit: Unit }> {
  const out: Array<{ leg: number; unit: Unit }> = [];
  for (const [k, n] of holders) {
    if (n !== a.name || !k.startsWith(`${v.name}|`)) continue;
    const [leg, u] = k.slice(v.name.length + 1).split('|');
    out.push({ leg: Number(leg), unit: u === 'main' ? 'main' : Number(u) });
  }
  return out;
}
/** A unit let go: said so with `why` (the caller says it otherwise: finished, ended). */
function letGo(a: BotAgent, v: Village, leg: number, u: Unit, why?: string) {
  if (holders.get(hkey(v, leg, u)) !== a.name) return;
  holders.delete(hkey(v, leg, u));
  const l = v.mine?.legs?.[leg];
  if (why) console.log(`[mine] ${a.name} left ${u === 'main' ? `tunnel ${leg}${l ? ` at main ${mainOf(l)}` : ''}` : `branch ${leg}:${u}${l ? ` at ${brOf(l, u)}/${BRANCH}` : ''}`} (${why})`);
}
/** A tunnel's main cells taken; what it held on other tunnels is let go. */
function holdMain(a: BotAgent, v: Village, m: Mine, l: MineLeg, how: string) {
  const i = m.legs!.indexOf(l);
  for (const h of heldOf(a, v)) if (h.leg !== i) letGo(a, v, h.leg, h.unit, 'it took another tunnel');
  if (holders.get(hkey(v, i, 'main')) !== a.name) console.log(`[mine] ${a.name} takes tunnel ${i} (${how})`);
  holders.set(hkey(v, i, 'main'), a.name);
}
/** A branch taken; another branch it held is let go (a tunnel's holder keeps its main cells). */
function holdBranch(a: BotAgent, v: Village, m: Mine, l: MineLeg, b: number, how: string) {
  const i = m.legs!.indexOf(l);
  for (const h of heldOf(a, v)) if (h.unit !== 'main' && (h.leg !== i || h.unit !== b)) letGo(a, v, h.leg, h.unit, 'it took another branch');
  if (holders.get(hkey(v, i, b)) !== a.name) console.log(`[mine] ${a.name} takes branch ${i}:${b} ${how}`);
  holders.set(hkey(v, i, b), a.name);
}
/** Everything a bot holds in a village let go (its trip ends), and the stairs down if it dug them. */
function release(a: BotAgent, v: Village, why: string) {
  for (const h of heldOf(a, v)) letGo(a, v, h.leg, h.unit, why);
  if (downHolders.get(v.name) === a.name) downHolders.delete(v.name);
}

/** Cells being dug, by "x,y,z" (the floor-level cell), and by whom (S.2): where units share cells (a turned tunnel's
 *  branches cross or run along another tunnel's), one bot at a time. */
const cellLock = new Map<string, string>();
/** Another bot digging a cell, while it is in the world. */
function cellHolder(a: BotAgent, at: string): string | undefined {
  const n = cellLock.get(at);
  return n && n !== a.name && a.world.agents.has(n.toLowerCase()) ? n : undefined;
}

/**
 * Waits for a face, by bot: its village and when it began (S.0's `[mine]` lines: is the mine limited by its faces?; S.2:
 * a tunnel's holder leaves its junction's branches to waiting miners). The start line counts the deepest level's tunnels
 * held by other bots, those still going and the turns still to come as S.0 counted them (sides not yet turned, up to the
 * tunnel limit); then the branches open at dug junctions and how many of them are free, and the turns there is somewhere
 * to make now (mineFaces).
 */
const faceWaits = new Map<string, { v: string; t: number }>();
/** Other bots waiting for a face in a village. */
const waitingFor = (v: Village, a: BotAgent) => [...faceWaits].filter(([n, w]) => n !== a.name && w.v === v.name).length;
function faceWaitStart(a: BotAgent, v: Village, m: Mine, downBy: string | undefined) {
  if (faceWaits.has(a.name)) return;
  faceWaits.set(a.name, { v: v.name, t: Date.now() });
  if (downBy) { console.log(`[mine] ${a.name} waits for the stairs down (dug by ${downBy})`); return; }
  const legs = deepest(m);
  const at = (l: MineLeg) => m.legs!.indexOf(l);
  const held = legs.filter((l) => !l.end && (heldBy(a, v, at(l), 'main') ?? a.name) !== a.name).length;
  const live = legs.filter((l) => !l.end).length;
  const sides = legs.reduce((n, l) => n + ((l.turned ?? 0) & 1 ? 0 : 1) + ((l.turned ?? 0) & 2 ? 0 : 1), 0);
  const open = legs.flatMap((l) => openBranches(l).map((b) => heldBy(a, v, at(l), b)));
  const f = mineFaces(v, (n) => a.world.agents.has(n.toLowerCase()));
  console.log(`[mine] ${a.name} waits for a face (held ${held}, live ${live}, turns ${Math.max(0, Math.min(MAX_LEGS - legs.length, sides))}, branches ${open.filter((h) => !h).length} free of ${open.length}, turnable ${f.turns})`);
}
function faceWaitEnd(a: BotAgent, outcome: string) {
  const w = faceWaits.get(a.name);
  if (w === undefined) return;
  faceWaits.delete(a.name);
  console.log(`[mine] ${a.name} waited ${((Date.now() - w.t) / 1000).toFixed(1)}s: ${outcome}`);
}

/**
 * collect in the mine: extend the tunnels cell by cell (two blocks each, standing in the cell before) until `want` more
 * cobblestone are carried or 6 minutes pass. A branch that meets water, lava, a cave, village ground or a hillside
 * (no ceiling) ends there; a main tunnel meeting one ends, and the next turns left or right at one of its junctions
 * (V.5b). Only when no tunnel can go on does the mine stop. Several miners share a tunnel by its parts (S.2: one digs
 * its main cells, others its branches). Returns how many were collected and, if it stopped short of `want`, why, and
 * `busy` when it stopped because other miners held every face or cell it could dig (E.0: collect's contention code).
 */
export async function mineFor(a: BotAgent, v: Village, want: number, have: () => number, signal: AbortSignal): Promise<{ got: number; why: string; busy: boolean }> {
  release(a, v, 'a new trip');
  const trip: Trip = { dug: 0, passed: 0, units: new Set(), why: '' };
  const t0 = Date.now(), start = have();
  try {
    const r = await mineTrip(a, v, want, have, signal, trip);
    trip.why = r.why;
    return { ...r, busy: !!trip.busy };
  } catch (e) {
    trip.why = (e as Error).message;
    throw e;
  } finally {
    faceWaitEnd(a, 'the trip ended');
    release(a, v, `the trip ended: ${short(trip.why || 'done')}`);
    console.log(`[mine] ${a.name} trip: dug ${trip.dug}, passed ${trip.passed} in ${((Date.now() - t0) / 60000).toFixed(1)} min on ${[...trip.units].join(', ') || 'no tunnel'}; got ${have() - start} cobblestone (${short(trip.why || 'done')})`);
  }
}

/** A trip's tally (S.2), for its line at the end: cells dug and passed, and the units worked on ("tunnel:unit"); `busy`: it gave up waiting for other miners. */
type Trip = { dug: number; passed: number; units: Set<string>; why: string; busy?: boolean };

async function mineTrip(a: BotAgent, v: Village, want: number, have: () => number, signal: AbortSignal, trip: Trip): Promise<{ got: number; why: string }> {
  const m = v.mine!;
  upgradeMine(m);
  const reg = a.world.villages;
  const start = have();
  const t0 = Date.now();
  let skipped = 0, why = '';
  // The unit and cell it worked on last, and whether it stopped for want of a pickaxe (not the cell's fault)
  let last: { leg: MineLeg; unit: Unit; c: ReturnType<typeof unitCell> } | null = null, tool = false, away = false, stuckIn = false;
  let waited = 0, waitedAt = '';
  // The units it dug cells on ("tunnel|unit"): they proved workable
  const dugOn = new Set<string>();
  while (have() - start < want) {
    if (Date.now() - t0 > 6 * 60000) { why = 'the time was up'; break; }
    if (skipped >= 200) { why = 'too many cells passed without digging'; break; }
    checkAbort(signal);
    const next = m.dug < MAX_CELLS ? nextLeg(a, v, m) : null;
    const downBy = downHolders.get(v.name);
    // Other bots hold every face there is, or dig the stairs down: wait for one (up to a minute a trip: a face frees
    // whenever a holder's trip ends, and a worker still waiting after that is better back on the board, S.2)
    if (next === 'busy' || (!next && downBy && downBy !== a.name)) {
      faceWaitStart(a, v, m, next === 'busy' ? undefined : downBy);
      if (m.stopped) { faceWaitEnd(a, 'the mine stopped'); why = m.stopped; break; }
      if (waited >= BUSY_WAIT_MS) { faceWaitEnd(a, 'gave up, the mine is busy'); why = `the mine is busy (${next === 'busy' ? 'its tunnels are being dug' : `${downBy} digs the stairs down`}); collect again later`; away = true; trip.busy = true; break; }
      await new Promise((r) => setTimeout(r, 5000));
      waited += 5000;
      continue;
    }
    faceWaitEnd(a, !next ? 'no tunnel left at this level' : next.unit === 'main' ? 'got a tunnel' : 'got a branch');
    let down = '';
    if (!next && canGoDown(m)) {
      downHolders.set(v.name, a.name);
      // No tunnel at this level can go on: the stairs go on down to the next level (which then has its first tunnel)
      try {
        down = await digDown(a, v, m, signal, t0 + 6 * 60000);
      } catch (e) {
        if ((e as Error).message === 'cancelled') throw e;
        down = (e as Error).message;
        tool = !!(e as { tool?: boolean }).tool;
        away = !!(e as { away?: boolean }).away && !(e as { inMine?: boolean }).inMine;
        if (tool || away) { why = down; break; }
        down = down === UNLOADED ? down : `could not dig the stairs down: ${down}`;
      }
      if (down === TIME_UP) { why = 'the time was up on the stairs down'; break; }
      if (!down) { downFails.delete(v.name); downHolders.delete(v.name); continue; }
      // Not loaded, or a dig that failed: twice in a row ends the stairs down (else every trip would fail on them). Counted
      // per village, not per miner as the tunnels' failures are (S.2): one bot digs the stairs at a time, and miners taking
      // turns would try a blocked step for ever
      if (down === UNLOADED || down.startsWith('could not dig')) {
        const n = (downFails.get(v.name) ?? 0) + 1;
        why = down === UNLOADED ? 'the stairs down to the next level are not loaded' : down;
        if (n < 2) { downFails.set(v.name, n); break; }
        downFails.delete(v.name);
        const d = m.down!.find((x) => x.level === undefined && !x.stopped);
        if (d) d.stopped = short(why);
        down = why;
      }
    }
    if (!next) {
      const end = short(m.legs![m.legs!.length - 1].end ?? '');
      m.stopped = short(`${m.dug >= MAX_CELLS ? `the mine reached its size limit (${m.dug} tunnel cells)`
        : m.legs!.length >= MAX_LEGS ? `${m.legs!.length} main tunnels dug, the last ended at ${end}` : `every tunnel ended; the last met ${end}`}${down ? `; the stairs down stopped: ${down}` : ''}`);
      reg.note(v, `the mine has no tunnel left to dig: ${m.stopped}`);
      reg.save();
      why = m.stopped;
      break;
    }
    const { leg, unit } = next;
    const li = m.legs!.indexOf(leg), name = `${li}:${unit}`;
    const c = unitCell(leg, unit);
    const L = leg.y, at = `${c.x},${L},${c.z}`;
    last = { leg, unit, c };
    trip.units.add(name);
    const cells = [new Vec3(c.x, L + 1, c.z), new Vec3(c.x, L, c.z)];
    const empty = () => cells.every((p) => a.bot.blockAt(p)?.boundingBox === 'empty');
    // Cells open already (a turned tunnel's first stretch is a branch of the one it turned from, and its branches cross or
    // run along other tunnels' branches) are checked like the others but neither walked to nor dug
    let open = empty();
    // One bot a cell (S.2): where units share cells another bot may be digging this one. Waited for (up to 10 s), then read
    // again: dug by the other, it is passed; still held, the unit waits as a miner waits for a face
    let by = open ? undefined : cellHolder(a, at);
    if (by) {
      if (waitedAt !== at) console.log(`[mine] ${a.name} waits for ${at} (${by} digs it)`);
      waitedAt = at;
      for (let k = 0; k < CELL_WAIT_MS / 1000 && by; k++) {
        await new Promise((r) => setTimeout(r, 1000));
        checkAbort(signal);
        open = empty();
        by = open ? undefined : cellHolder(a, at);
      }
      if (by) {
        waited += CELL_WAIT_MS;
        if (waited >= BUSY_WAIT_MS) { why = `the mine is busy (${by} digs ${at}); collect again later`; away = true; trip.busy = true; break; }
        continue;
      }
    }
    // Held from before the walk to the end of the dig (taken after the walk, two bots could both walk to it)
    if (!open) cellLock.set(at, a.name);
    try {
      let walked = '';
      if (!open) await walkMine(a, new Vec3(c.from.x + 0.5, L, c.from.z + 0.5), 1.2, signal, 60000).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        walked = e.message;
      });
      const floor = a.bot.blockAt(new Vec3(c.x, L - 1, c.z));
      const bad = cells.map((p, i) => unsafe(a, v, m, p, i === 0, 'tunnel', c.from)).find(Boolean) ?? (!floor ? UNLOADED : floor.boundingBox !== 'block' ? `no floor at ${c.x},${L - 1},${c.z}` : null)
        // A tunnel through dirt gives no cobblestone (StageH19's hillside: 412 dirt carried for 67 cobblestone, F79)
        ?? (!open && !cells.some((p) => STONE.has(a.bot.blockAt(p)?.name ?? '')) ? `no stone at ${at} (${cells.map((p) => a.bot.blockAt(p)?.name).join(', ')})` : null);
      // Not loaded (it walked short): stop here for now, the next collect goes on
      if (bad === UNLOADED) {
        why = `the mine at ${at} is not loaded`;
        break;
      }
      if (bad) {
        // A main tunnel ending: the next one turns; a branch just ends, never its tunnel
        if (unit === 'main') {
          leg.end = short(bad);
          console.log(`[mine] ${a.name}: tunnel ${li} ends at ${at} (main ${mainOf(leg)}): ${bad}`);
          letGo(a, v, li, 'main');
          reg.note(v, `the mine's ${compass(leg.dir)} tunnel from ${leg.x},${leg.y},${leg.z} ended: ${bad}`);
        } else {
          leg.ended.push(unit);
          console.log(`[mine] ${a.name} ended branch ${name} at ${at} (${brOf(leg, unit)}/${BRANCH}): ${bad}`);
          letGo(a, v, li, unit);
        }
        reg.save();
        continue;
      }
      // Dug here only when this bot dug a block of it: found open (another bot's dig, one that takes no cell lock), or a
      // dig another miner finished first (F82's open item), it is passed, not a failure
      let dugIt = false;
      if (!open) {
        // (the cell's lock is let go while it fetches or makes a pickaxe: the errand can take minutes. Back, a bot that took
        // the cell meanwhile is waited for as before the walk: dug by it, the cell is passed; still held, the trip stops as
        // for a busy mine, counted against no unit)
        const errand = async (out: boolean) => {
          if (out) {
            if (cellLock.get(at) === a.name) cellLock.delete(at);
            return true;
          }
          for (let k = 0; k < CELL_WAIT_MS / 1000 && cellHolder(a, at) && !empty(); k++) {
            await new Promise((r) => setTimeout(r, 1000));
            checkAbort(signal);
          }
          if (empty()) return false;
          const by = cellHolder(a, at);
          if (by) throw Object.assign(new Error(`the mine is busy (${by} digs ${at}); collect again later`), { away: true, busy: true });
          cellLock.set(at, a.name);
          return true;
        };
        try {
          for (const p of cells) if (await digCell(a, m, p, signal, new Vec3(c.from.x + 0.5, L, c.from.z + 0.5), { errand })) dugIt = true;
        } catch (e) {
          if ((e as Error).message === 'cancelled') throw e;
          if (!empty()) {
            why = `could not dig at ${at}: ${(e as Error).message}${walked ? ` (${walked})` : ''}`;
            tool = !!(e as { tool?: boolean }).tool;
            away = !!(e as { away?: boolean }).away;
            if ((e as { busy?: boolean }).busy) trip.busy = true;
            stuckIn = !!(e as { inMine?: boolean }).inMine;
            break;
          }
          if (!dugIt) console.log(`[mine] ${a.name}: ${at} was dug by another miner (passed)`);
        }
      }
      if (!dugIt) {
        skipped++;
        trip.passed++;
      } else {
        // Into the cell: its drops are picked up there, and it is where the next one is dug from
        await walkMine(a, new Vec3(c.x + 0.5, L, c.z + 0.5), 0.6, signal, 20000).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
        });
        m.dug++;
        trip.dug++;
        dugOn.add(`${li}|${unit}`);
        console.log(`[mine] ${a.name} dug ${at} (${name} ${c.n}${unit === 'main' ? '' : `/${BRANCH}`})`);
      }
      advance(leg, unit);
      if (unit !== 'main' && brOf(leg, unit) >= BRANCH) {
        console.log(`[mine] ${a.name} finished branch ${name}`);
        letGo(a, v, li, unit);
      }
      reg.save();
    } finally {
      if (cellLock.get(at) === a.name) cellLock.delete(at);
    }
  }
  const got = have() - start;
  // Failures are counted per miner and unit (S.2: per village, one miner's empty trip and another's on a different tunnel
  // ended the second, and any trip that gave something hid a miner that kept failing). A trip that dug cells breaks this
  // miner's row, and the units it dug on have proved workable, whoever failed on them
  const unitKey = last ? `${v.name}|${m.legs!.indexOf(last.leg)}|${last.unit}` : '';
  const unitName = last ? `${m.legs!.indexOf(last.leg)}:${last.unit}` : '';
  const forget = (map: Map<string, unknown>, also?: (k: string) => boolean) => {
    for (const k of [...map.keys()]) if ((k.startsWith(`${v.name}|`) && k.endsWith(`|${a.name}`)) || also?.(k)) map.delete(k);
  };
  if (trip.dug > 0) for (const map of [emptyTrips, awayAt]) forget(map, (k) => [...dugOn].some((u) => k.startsWith(`${v.name}|${u}|`)));
  // That unit ends where it stopped (a main tunnel: the next one turns; a branch: never its tunnel)
  const endUnit = (end: string) => {
    if (last!.unit === 'main') last!.leg.end ??= short(end);
    else if (!branchDone(last!.leg, last!.unit)) last!.leg.ended.push(last!.unit);
  };
  // Two trips in a row by this miner on one unit with no cell dug (a cell not loaded or not dug, a tunnel in dirt): the
  // unit ends there and the next goes on; else every collect would fail on it, and none may dig outside while the mine
  // still gives. Not for want of a pickaxe, nor once the mine has stopped; and a bot that never got into the mine (stuck on
  // the way: the rescue's business) changes nothing. Cells, not items: passing miners may pick up a digger's drops
  if (away && trip.dug === 0) {
    // ...unless it stood in the mine and could not get on, at the same cell trip after trip: then that unit ends there
    // like any cell not dug (a miner stuck outside, or kept waiting by a busy mine, counts for nothing: it would end every
    // unit in turn)
    const where = last && stuckIn ? `${last.c.x},${last.leg.y},${last.c.z}` : '';
    const key = `${unitKey}|${a.name}`;
    const times = where && awayAt.get(key)?.at === where ? awayAt.get(key)!.n + 1 : 1;
    forget(awayAt);
    if (!last || !where) return { got, why };
    if (times < 3) {
      awayAt.set(key, { at: where, n: times });
      return { got, why };
    }
    forget(awayAt, (q) => q.startsWith(`${unitKey}|`));
    endUnit(`${where}, not reached in three trips (${why})`);
    console.log(`[mine] the mine's ${last.unit === 'main' ? 'tunnel' : 'branch'} ${unitName} ends at ${where}: not reached in three trips by ${a.name}`);
    reg.note(v, `the mine's ${last.unit === 'main' ? 'tunnel' : 'branch'} ends at ${where}: not reached in three trips`);
    reg.save();
    return { got, why };
  }
  forget(awayAt);
  if (trip.dug > 0 || tool || m.stopped || !last) {
    forget(emptyTrips);
    return { got, why };
  }
  const key = `${unitKey}|${a.name}`, times = (emptyTrips.get(key) ?? 0) + 1;
  // (in a row: one unit at a time)
  forget(emptyTrips);
  if (times < 2) {
    emptyTrips.set(key, times);
    console.log(`[mine] ${a.name}: an empty trip on ${unitName} (1 of 2): ${why || 'no cell dug'}`);
    return { got, why };
  }
  forget(emptyTrips, (q) => q.startsWith(`${unitKey}|`));
  const where = `${last.c.x},${last.leg.y},${last.c.z}`, end = short(`${where}, nothing dug in two trips (${why})`);
  endUnit(end);
  console.log(`[mine] the mine's ${last.unit === 'main' ? 'tunnel' : 'branch'} ${unitName} ends at ${where}: nothing dug in two trips by ${a.name}`);
  reg.note(v, `the mine's ${last.unit === 'main' ? 'tunnel' : 'branch'} ends at ${end}`);
  reg.save();
  why += `; that ${last.unit === 'main' ? 'tunnel' : 'branch'} ends there and the next collect digs on elsewhere`;
  return { got, why };
}

/**
 * By "village|tunnel|unit|miner" (S.2): trips into the mine in a row with no cell dug; the cell trips stopped short of
 * (the bot never got there) and how many in a row. Per village: trips that failed on the stairs down.
 */
const emptyTrips = new Map<string, number>(), awayAt = new Map<string, { at: string; n: number }>(), downFails = new Map<string, number>();
/** digDown's answer when the trip's time ran out on the way down (it goes on at the next trip). */
const TIME_UP = 'time up';
/** How long a trip waits for a face in all (S.2: two minutes before; with the claim gate few wait, and a face frees
 *  whenever a holder's trip ends), and for a cell another bot digs before it waits as for a face. */
const BUSY_WAIT_MS = 60000, CELL_WAIT_MS = 10000;

/** Reasons kept in the record and the village summary stay short (the workers' prompts have little room, F78). */
const short = (s: string) => (s.length > 100 ? `${s.slice(0, 97)}...` : s);

/** The iron level's floor (iron peaks at y 12-27 in 26.1, deepslate from about 8 down), the most steps its stairs take,
 *  the highest a level may stop at when the stairs meet water or a cave (iron is still about 1-3 in 100 cells), and its
 *  size: main tunnels and cells. */
const IRON_Y = 18, IRON_MAX_STEPS = 60, IRON_SETTLE_Y = 40, IRON_LEGS = 6, IRON_CELLS = 320;
/** Stairs tried at most (minevale3's ground is full of caves at y 40-45: three met them in VanI3). */
const IRON_TRIES = 5;
/** Deep enough for iron: stairs stopped at or below this make the level there (iron peaks at 12-27). */
const IRON_GOOD_Y = 28;
/** The iron and coal a tunnel keeps from its walls and ceiling. */
const KEEP = /^(?:deepslate_)?(iron|coal)_ore$/;
/** Villages whose iron level a bot is digging now (one at a time). */
const ironBusy = new Set<string>();

/**
 * Where the iron stairs start (the design review's H1): from a cell the deepest level has dug, in a direction whose first 4
 * steps (the ones still at that level's height) come no closer than diagonally to any other cell it has dug or any stair;
 * nearest the bottom of the stairs first (beside it, sideways, when room: that side is then never turned at by the
 * cobblestone mine). With two or three miners the mine turns tunnels off both sides of the bottom step (VanI1), so any
 * dug cell may be the start: a tunnel's or branch's end going on outward. Null when none is clear.
 */
export function ironStart(m: Mine): { x: number; z: number; y: number; dir: [number, number]; side?: 1 | 2 } | null {
  const last = m.down?.filter((d) => d.level !== undefined).at(-1);
  const b = last ? downColumns(m, last)[last.steps - 1] : stairColumns(m)[m.steps - 1];
  const L = last ? last.level! : m.level!;
  if (!b || L === undefined) return null;
  const dug: Array<{ x: number; z: number }> = [...stairColumns(m), ...(m.down ?? []).flatMap((d) => downColumns(m, d))];
  const level: Array<{ x: number; z: number }> = [{ x: b.x, z: b.z }];
  for (const l of (m.legs ?? []).filter((q) => q.y === L)) {
    level.push({ x: l.x, z: l.z }, ...legCells(l));
    // (and what it may still dig: the rest of its open branches, which helpers dig on a tunnel that ended too, S.2, and the
    // next two stretches of a tunnel still going: the stairs must not take their way on)
    dug.push(...legAhead(l, !l.end));
  }
  dug.push(...level);
  // (and any stairs given up before, never started again the same way)
  for (const d of m.iron?.abandoned ?? []) dug.push(...ironColumns({ ...m.iron!, ...d }));
  const tried = (st: { x: number; z: number }, dir: [number, number]) => (m.iron?.abandoned ?? []).some((d) => d.x === st.x && d.z === st.z && d.dir[0] === dir[0] && d.dir[1] === dir[1]);
  // (nor anywhere near where they stopped: the second and third stairs of VanI3 met the first one's cave, 2 blocks over)
  const stops = (m.iron?.abandoned ?? []).map((d) => ({ x: d.x + d.dir[0] * Math.max(1, d.steps), z: d.z + d.dir[1] * Math.max(1, d.steps) }));
  const offStops = (st: { x: number; z: number }, dir: [number, number]) => Array.from({ length: 45 }, (_, k) => ({ x: st.x + dir[0] * (k + 1), z: st.z + dir[1] * (k + 1) }))
    .every((c) => stops.every((q) => Math.hypot(q.x - c.x, q.z - c.z) >= 8));
  const [dx, dz] = m.dir;
  const dirs: Array<[number, number]> = [[dz, -dx], [-dz, dx], [dx, dz], [-dx, -dz]];
  const starts = level.filter((c, n) => level.findIndex((o) => o.x === c.x && o.z === c.z) === n)
    .sort((p, q) => Math.abs(p.x - b.x) + Math.abs(p.z - b.z) - Math.abs(q.x - b.x) - Math.abs(q.z - b.z));
  for (const st of starts)
    for (const [n, dir] of dirs.entries()) {
      if (tried(st, dir) || !offStops(st, dir)) continue;
      const clear = [1, 2, 3, 4].every((k) => {
        const c = { x: st.x + dir[0] * k, z: st.z + dir[1] * k };
        return dug.every((d) => (d.x === st.x && d.z === st.z) || Math.abs(d.x - c.x) + Math.abs(d.z - c.z) >= 2);
      });
      if (clear) return { x: st.x, z: st.z, y: L, dir, ...(st.x === b.x && st.z === b.z && n < 2 ? { side: (n + 1) as 1 | 2 } : {}) };
    }
  return null;
}

/**
 * The iron stairs, step by step (as the stairs down: dug standing on the step above, three cells a step, top first, each
 * checked by unsafe), until a step stands on stone at y 18 or less. Stopped short by water, a cave or anything built: the
 * level is dug at the last step if that is at y 40 or less, else the iron level is finished ("no way down"). Returns ''
 * when the level is ready, TIME_UP, UNLOADED, or why it ended.
 */
async function digIronStairs(a: BotAgent, v: Village, m: Mine, i: IronLevel, signal: AbortSignal, until: number): Promise<string> {
  const reg = a.world.villages;
  const [dx, dz] = i.dir;
  const level = (y: number, x: number, z: number) => {
    i.level = y;
    i.legs.push({ x, z, y, dir: [dx, dz], dug: 0, ended: [] });
    reg.note(v, `${a.name} dug the iron stairs ${i.steps} steps down to the iron level at y=${y}`);
    reg.save();
    return '';
  };
  const settle = (why: string) => {
    if (why === UNLOADED) return why;
    i.stopped = short(why);
    const last = ironColumns(i).at(-1), y = i.y - i.steps;
    // A level where the stairs stopped: at once when deep enough for iron (y 28 or less), else only when no try is left
    // (VanI4 settled at y 39 on its second try and dug 87 cells past 3 iron ores in the whole stretch)
    const tries = (i.abandoned?.length ?? 0) + 1;
    if (last && (y <= IRON_GOOD_Y || (y <= IRON_SETTLE_Y && tries >= IRON_TRIES))) return level(y, last.x, last.z);
    // Above y 40 (caves and aquifers are common at 36-51, VanI2): these stairs are given up as they are and new ones
    // start elsewhere on the level, away from where these stopped, IRON_TRIES in all
    i.abandoned = [...(i.abandoned ?? []), { x: i.x, z: i.z, y: i.y, dir: i.dir, steps: i.steps, why: short(why) }];
    const next = i.abandoned.length < IRON_TRIES ? ironStart(m) : null;
    // (no start left: a level at y 40 or less here after all, the diff review's M3)
    if (!next && last && y <= IRON_SETTLE_Y) {
      i.abandoned.pop();
      return level(y, last.x, last.z);
    }
    if (next) {
      Object.assign(i, { x: next.x, z: next.z, y: next.y, dir: next.dir, steps: 0 });
      delete i.stopped;
      const first = m.legs?.find((l) => next.side && l.x === next.x && l.z === next.z && l.y === next.y);
      if (first && next.side) first.turned = (first.turned ?? 0) | next.side;
      reg.note(v, `the iron stairs stopped at ${i.abandoned.at(-1)!.steps} steps (${why}); new ones start at ${next.x},${next.y},${next.z}, going ${compass(next.dir)}`);
      reg.save();
      return `the stairs met ${why}; new ones start at ${next.x},${next.y},${next.z} next trip`;
    }
    i.finished = short(`no way down: ${why}`);
    reg.note(v, `the iron stairs stopped at ${i.steps} steps: ${why}; no way down`);
    reg.save();
    return why;
  };
  for (let k = i.steps + 1; k <= IRON_MAX_STEPS; k++) {
    checkAbort(signal);
    if (Date.now() > until) return TIME_UP;
    const x = i.x + dx * k, z = i.z + dz * k, floor = i.y - 1 - k;
    const stand = new Vec3(x - dx + 0.5, floor + 2, z - dz + 0.5);
    await walkMine(a, stand, 1.2, signal, 60000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    const inStone = [1, 2].every((dy) => STONE.has(a.bot.blockAt(new Vec3(x, floor + dy, z))?.name ?? ''));
    for (const dy of [3, 2, 1]) {
      const p = new Vec3(x, floor + dy, z);
      const why = unsafe(a, v, m, p, false, 'down', { x: x - dx, z: z - dz });
      if (why) return settle(why);
      if (dy === 3) {
        const up = p.y + 1, above = a.bot.blockAt(new Vec3(x, up, z));
        // (right over it, no climbing: the iron stairs run under untouched rock, an opening over a step is a cave, the
        // diff review's M2)
        if (!above) return UNLOADED;
        if (above.boundingBox !== 'block' || FALLING.has(above.name)) return settle(`${above.name} over ${x},${up - 1},${z} (no solid ceiling)`);
      }
      await digCell(a, m, p, signal, stand, { got: i.got, strict: true });
    }
    await walkMine(a, new Vec3(x + 0.5, floor + 1, z + 0.5), 0.6, signal, 20000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    const under = a.bot.blockAt(new Vec3(x, floor, z));
    if (!under) return UNLOADED;
    if (under.boundingBox !== 'block' || wetAt(a, under.position)) return settle(`no floor under ${x},${floor + 1},${z}`);
    i.steps = k;
    reg.save();
    if (floor + 1 <= IRON_Y && inStone && STONE.has(under.name)) return level(floor + 1, x, z);
  }
  return settle(`no stone at y ${IRON_Y} within ${IRON_MAX_STEPS} steps`);
}

/**
 * The iron and coal around the cell just dug, taken from where the bot stands before stepping in (within reach, no walk):
 * its walls and the ceiling over the upper cell, its floor (each floor ore's hole filled at once with a carried
 * cobblestone, charged: no pit is left, lesson 70), and on along the vein from each ore taken (veins hold 4-9 blocks; VanI5
 * dug 102 cells at y 18 past 3 iron ores in their walls and floors). Each checked as a tunnel cell is (water, lava, air,
 * protected ground; a ceiling over the upper ones), never forced (an ore the pickaxe cannot harvest is left).
 */
async function keepOres(a: BotAgent, v: Village, m: Mine, cells: Vec3[], L: number, got: Record<string, number>, signal: AbortSignal): Promise<number> {
  const found: Array<{ q: Vec3; from: { x: number; z: number }; floor: boolean }> = [];
  const add = (q: Vec3, from: { x: number; z: number }, floor: boolean) => {
    if (q.y < L - 1 || !KEEP.test(a.bot.blockAt(q)?.name ?? '') || found.some((f) => f.q.equals(q)) || cells.some((c) => c.equals(q))) return;
    found.push({ q, from, floor });
  };
  for (const c of cells)
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
      if (dy > 0 && c.y !== L + 1) continue;
      if (dy < 0 && c.y !== L) continue;
      add(c.offset(dx, dy, dz), { x: c.x, z: c.z }, dy < 0);
    }
  const rcon = (cmd: string) => a.world.rcon.command(cmd).catch(() => '');
  let kept = 0;
  for (let n = 0; n < found.length && n < 24; n++) {
    const { q, from, floor } = found[n];
    checkAbort(signal);
    if (a.bot.entity.position.offset(0, 1.62, 0).distanceTo(q.offset(0.5, 0.5, 0.5)) > 4.2) continue;
    if (unsafe(a, v, m, q, !floor && q.y >= L + 1, 'tunnel', from)) continue;
    // (a floor ore only with a cobblestone to fill its hole, and never the cell the bot stands on)
    const feet = a.bot.entity.position.floored();
    if (floor && (feet.offset(0, -1, 0).equals(q) || !a.bot.inventory.items().some((it) => it.name === 'cobblestone'))) continue;
    const name = a.bot.blockAt(q)?.name ?? '';
    try {
      await mineBlock(a, q, signal, false, 0, false);
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      continue;
    }
    // (the charge settled by counting when its answer is lost, E.1: read as none taken it left the hole open)
    if (floor && (await a.world.rcon.take(a.name, 'cobblestone', 1)) === 1) {
      if (/Changed/i.test(await rcon(`setblock ${q.x} ${q.y} ${q.z} minecraft:cobblestone`))) a.bot.world.setBlockStateId(q, a.world.registry.blocksByName.cobblestone.defaultState);
      else await rcon(`give ${a.name} minecraft:cobblestone 1`);
    }
    const drop = dropOf(name);
    got[drop] = (got[drop] ?? 0) + 1;
    got[`kept ${name}`] = (got[`kept ${name}`] ?? 0) + 1;
    kept++;
    // On along the vein (not down out of a floor ore: its hole is filled)
    // (never below the cell's floor: an unfilled hole in the next cell or under the bot ended tunnels, the diff review's M1;
    // and only beside the cell or its approach, where the drop is picked up)
    if (!floor)
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
        const r = q.offset(dx, dy, dz);
        const beside = [...cells.map((c) => ({ x: c.x, z: c.z })), from].some((c) => Math.abs(c.x - r.x) <= 1 && Math.abs(c.z - r.z) <= 1);
        if (r.y >= L && beside) add(r, { x: q.x, z: q.z }, false);
      }
  }
  return kept;
}

/** The iron level's tunnel to dig on: the one still going, else a turn from one that ended (at most IRON_LEGS). */
function nextIronLeg(a: BotAgent, v: Village, i: IronLevel): MineLeg | null {
  const going = i.legs.find((l) => !l.end);
  if (going) return going;
  if (i.legs.length >= IRON_LEGS) return null;
  for (const [n, l] of i.legs.entries())
    for (const side of [1, 2] as const) {
      if ((l.turned ?? 0) & side) continue;
      l.turned = (l.turned ?? 0) | side;
      const t = turnFrom(l, side, n === 0);
      if (!t) continue;
      i.legs.push(t);
      a.world.villages.note(v, `${a.name} turned the iron level ${compass(t.dir)} at ${t.x},${t.y},${t.z}`);
      return t;
    }
  return null;
}

/**
 * One trip to the iron level (the iron age, 10-08; a chore once the village stands, run by dig_iron in mcBuild.ts): down
 * the mine's stairs and the iron stairs (each walk with its own time, the review's M5), the stairs dug on first, then its
 * tunnels cell by cell (the cobblestone mine's pattern and checks) keeping the iron and coal in their walls, until `want`
 * raw iron are carried, the time is up, the inventory is nearly full or the level is finished; then back up to the top
 * of the mine's stairs. Its own record (`mine.iron`): the cobblestone mine never sees it. Returns what happened.
 */
export async function ironTrip(a: BotAgent, v: Village, want: number, signal: AbortSignal, until: number): Promise<string> {
  const m = v.mine;
  if (!m || m.level === undefined) return 'the village has no mine at a level yet';
  upgradeMine(m);
  const reg = a.world.villages;
  if (!m.iron) {
    const s = ironStart(m);
    m.iron = s ? { x: s.x, z: s.z, y: s.y, dir: s.dir, steps: 0, legs: [], dug: 0, got: {} } : { x: 0, z: 0, y: 0, dir: m.dir, steps: 0, legs: [], dug: 0, got: {}, finished: 'no clear way down beside the deepest level' };
    // (the cobblestone mine never turns there: its tunnel would run into the iron stairs)
    const first = m.legs?.find((l) => s && l.x === s.x && l.z === s.z && l.y === s.y);
    if (s?.side && first) first.turned = (first.turned ?? 0) | s.side;
    reg.note(v, s ? `the iron stairs start at ${s.x},${s.y},${s.z} on the mine's deepest level, going ${compass(s.dir)}` : 'no way down to the iron level beside the mine');
    reg.save();
  }
  const i = m.iron;
  if (i.finished) return `the iron level is finished: ${i.finished}`;
  if (ironBusy.has(v.name)) return 'another worker is digging the iron level';
  ironBusy.add(v.name);
  const go = (p: Vec3, range: number, ms: number) => walkMine(a, p, range, signal, ms).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
  });
  const top = new Vec3(m.top.x + 0.5, m.level + m.steps - 1, m.top.z + 0.5);
  const carried = () => a.bot.inventory.items().filter((it) => it.name === 'raw_iron').reduce((n, it) => n + it.count, 0);
  const start = carried();
  let why = '';
  try {
    if (!inMine(a, m)) await go(top, 1.5, 90000);
    await go(new Vec3(i.x + 0.5, i.y, i.z + 0.5), 1.5, 120000);
    if (i.level === undefined) {
      const r = await digIronStairs(a, v, m, i, signal, until);
      if (r === TIME_UP) return (why = 'the time was up on the iron stairs');
      if (r) return (why = r === UNLOADED ? 'the iron stairs are not loaded' : `the iron stairs stopped: ${r}`);
    }
    const bottom = ironColumns(i).at(-1)!;
    await go(new Vec3(bottom.x + 0.5, i.level!, bottom.z + 0.5), 1.5, 120000);
    let kept = 0;
    while (true) {
      checkAbort(signal);
      if (carried() >= want) { why = `carrying ${carried()} raw iron`; break; }
      if (Date.now() > until) { why = 'the time was up'; break; }
      if (a.bot.inventory.emptySlotCount() < 4) { why = 'the inventory is nearly full'; break; }
      if (i.dug >= IRON_CELLS) { i.finished = `${i.dug} tunnel cells dug`; break; }
      const leg = nextIronLeg(a, v, i);
      if (!leg) { i.finished = short(`every tunnel ended; the last met ${i.legs.at(-1)?.end ?? 'nothing'}`); break; }
      const c = tunnelCell(leg, leg.dug);
      if (leg.ended.includes(c.branch)) { leg.dug++; continue; }
      const L = leg.y;
      const cells = [new Vec3(c.x, L + 1, c.z), new Vec3(c.x, L, c.z)];
      const open = cells.every((p) => a.bot.blockAt(p)?.boundingBox === 'empty');
      if (!open) await go(new Vec3(c.from.x + 0.5, L, c.from.z + 0.5), 1.2, 60000);
      const floor = a.bot.blockAt(new Vec3(c.x, L - 1, c.z));
      const bad = cells.map((p, n) => unsafe(a, v, m, p, n === 0, 'tunnel', c.from)).find(Boolean) ?? (!floor ? UNLOADED : floor.boundingBox !== 'block' ? `no floor at ${c.x},${L - 1},${c.z}` : null);
      if (bad === UNLOADED) { why = `the iron level at ${c.x},${L},${c.z} is not loaded`; break; }
      if (bad) {
        if (c.branch % 3 === 0) leg.end = short(bad);
        else leg.ended.push(c.branch);
        reg.save();
        continue;
      }
      if (!open) {
        try {
          for (const p of cells) await digCell(a, m, p, signal, new Vec3(c.from.x + 0.5, L, c.from.z + 0.5), { got: i.got, strict: true });
        } catch (e) {
          if ((e as Error).message === 'cancelled' || (e as { tool?: boolean }).tool) throw e;
          // The same cell failing on two trips ends its branch or tunnel (the diff review's M3: else every trip stops there)
          const at = `${c.x},${L},${c.z}`;
          i.stuckAt = { at, n: i.stuckAt?.at === at ? i.stuckAt.n + 1 : 1 };
          if (i.stuckAt.n >= 2) {
            if (c.branch % 3 === 0) leg.end = short(`${at}: ${(e as Error).message}`);
            else leg.ended.push(c.branch);
            delete i.stuckAt;
          }
          throw e;
        }
        // (from where it stands, before stepping in: the cell's floor is in reach and not underfoot)
        kept += await keepOres(a, v, m, cells, L, i.got, signal);
        // Into the cell's middle: its drops and the ores' (a wall's drop lands about a block off, the diff review's L3)
        await go(new Vec3(c.x + 0.5, L, c.z + 0.5), 0.3, 20000);
        i.dug++;
      }
      leg.dug++;
      reg.save();
    }
    if (i.finished) reg.note(v, `the iron level is finished: ${i.finished}`);
    return `${why || i.finished}; ${kept} ores kept from the walls`;
  } catch (e) {
    if ((e as Error).message === 'cancelled') throw e;
    why = (e as Error).message;
    return `stopped: ${why}`;
  } finally {
    ironBusy.delete(v.name);
    reg.save();
    // Back up to the top of the mine's stairs (not when stopped: the rescue or the next action takes it from there)
    if (!signal.aborted) {
      const b = ironColumns(i).at(-1);
      if (b && i.level !== undefined) await go(new Vec3(i.x + 0.5, i.y, i.z + 0.5), 1.5, 120000).catch(() => undefined);
      await go(top, 1.5, 120000).catch(() => undefined);
    }
    a.world.villages.note(v, `${a.name}'s iron trip: ${carried() - start} raw iron carried up (${why || 'done'})`);
  }
}

// ---------------------------------------------------------------------------------------------
// Torches in the mine (B.4): where they go, pure (the world's light family and scripts/checks/light_check.mts read it)
// ---------------------------------------------------------------------------------------------

/** What a torch in the mine hangs on (D5): the ground the mine digs through; never an ore (a miner takes it, and the torch
 *  drops with it) or a falling block. */
export const MINE_SUPPORT: ReadonlySet<string> = new Set(['stone', 'deepslate', 'tuff', 'granite', 'diorite', 'andesite', 'calcite', 'dirt']);

/** A torch spot of the mine: its part ("mine:stairs", "mine:<leg>", "mine:down:<k>", "mine:iron"), the head-height cell
 *  and the walls it may hang on, left first (facing away from each; `support` the wall's cell). */
export interface MineLightSpot { part: string; x: number; y: number; z: number; sides: Array<{ facing: 'north' | 'south' | 'east' | 'west'; support: [number, number, number] }> }

/** A unit's cells that get a torch, of the `dug` done: 4, 11, 18, ..., one on where it falls on a junction's cell (n % 3
 *  == 0: branches go off its sides; no tunnel, branch or turned tunnel digs a wall at any other n, the check's lattice). */
function torchCells(dug: number): number[] {
  const out: number[] = [];
  for (let n = 4; ; n += 7) {
    const c = n % MAIN_STEP === 0 ? n + 1 : n;
    if (c > dug) return out;
    out.push(c);
  }
}

/** A spot at a head cell of a unit going `dir`: its two walls across the unit, left first. */
function across(part: string, x: number, y: number, z: number, [dx, dz]: [number, number]): MineLightSpot {
  const walls: Array<[number, number]> = [[dz, -dx], [-dz, dx]];
  return { part, x, y, z, sides: walls.map(([wx, wz]) => ({ facing: compass([-wx, -wz]) as MineLightSpot['sides'][number]['facing'], support: [x + wx, y, z + wz] as [number, number, number] })) };
}

/** A tunnel's units with their directions and cells done: the main cells, then each dug junction's branches. */
function legUnits(l: MineLeg): Array<{ u: Unit; dir: [number, number]; dug: number }> {
  const [dx, dz] = l.dir;
  const out: Array<{ u: Unit; dir: [number, number]; dug: number }> = [{ u: 'main', dir: [dx, dz], dug: mainOf(l) }];
  for (let s = 0; s < Math.floor(mainOf(l) / MAIN_STEP); s++)
    for (const b of [3 * s + 1, 3 * s + 2]) out.push({ u: b, dir: b % 3 === 1 ? [dz, -dx] : [-dz, dx], dug: Math.min(BRANCH, brOf(l, b)) });
  return out;
}

/**
 * Every torch spot of the mine (B.4, D5): wall torches at head height, every 7 cells from cell 4 of each unit (the stairs'
 * steps from step 4: steps 1-2 lie under the hut), on either wall across it. One part per cell: a turned tunnel's first
 * stretch is an earlier tunnel's full branch, which owns its cells (M3). Abandoned iron stairs get none.
 */
export function mineLights(m: Mine): MineLightSpot[] {
  const out: MineLightSpot[] = [];
  const steps = (n: number) => { const r: number[] = []; for (let k = 4; k <= n; k += 7) r.push(k); return r; };
  // The stairs: the hut's floor is the level plus the steps less one (the bottom step stands at the level)
  if (m.level !== undefined) {
    const y0 = m.level + m.steps - 1, cols = stairColumns(m);
    for (const n of steps(m.steps)) out.push(across('mine:stairs', cols[n - 1].x, y0 - n + 2, cols[n - 1].z, m.dir));
  }
  for (const [k, d] of (m.down ?? []).entries()) {
    const cols = downColumns(m, d);
    for (const n of steps(d.steps)) out.push(across(`mine:down:${k}`, cols[n - 1].x, d.y - n + 1, cols[n - 1].z, m.dir));
  }
  const owned = new Set<string>();
  const tunnels = (part: string, l: MineLeg) => {
    for (const { u, dir, dug } of legUnits(l))
      for (const n of torchCells(dug)) {
        const c = cellAt(l, u, n);
        if (!owned.has(`${c.x},${l.y},${c.z}`)) out.push(across(part, c.x, l.y + 1, c.z, dir));
      }
  };
  const own = (l: MineLeg) => { for (const c of legCells(l)) owned.add(`${c.x},${l.y},${c.z}`); };
  for (const [k, l] of (m.legs ?? []).entries()) {
    tunnels(`mine:${k}`, l);
    own(l);
  }
  const i = m.iron;
  if (i && i.steps) {
    const cols = ironColumns(i);
    for (const n of steps(i.steps)) out.push(across('mine:iron', cols[n - 1].x, i.y - n + 1, cols[n - 1].z, i.dir));
  }
  for (const l of i?.legs ?? []) {
    tunnels('mine:iron', l);
    own(l);
  }
  return out;
}

/**
 * The mine's faces still going, as head-height cells (B.4): each tunnel's next main cell and its open branches' next
 * cells (while the mine can give), stairs down and iron stairs not at their level yet, the iron level's tunnels not
 * ended. A torch spot within 2 of one waits: a miner works there.
 */
export function mineFacesGoing(m: Mine): Array<{ x: number; y: number; z: number }> {
  const out: Array<{ x: number; y: number; z: number }> = [];
  if (m.level === undefined) return out;
  if (!m.stopped && m.dug < MAX_CELLS)
    for (const l of m.legs ?? []) {
      if (!l.end) { const c = cellAt(l, 'main', mainOf(l) + 1); out.push({ x: c.x, y: l.y + 1, z: c.z }); }
      for (const b of openBranches(l)) { const c = cellAt(l, b, brOf(l, b) + 1); out.push({ x: c.x, y: l.y + 1, z: c.z }); }
    }
  for (const d of m.down ?? []) if (d.level === undefined && !d.stopped) out.push({ x: d.x + m.dir[0] * (d.steps + 1), y: d.y - d.steps, z: d.z + m.dir[1] * (d.steps + 1) });
  const i = m.iron;
  if (i && !i.finished) {
    if (i.level === undefined) out.push({ x: i.x + i.dir[0] * (i.steps + 1), y: i.y - i.steps, z: i.z + i.dir[1] * (i.steps + 1) });
    for (const l of i.legs) if (!l.end) { const c = tunnelCell(l, l.dug); out.push({ x: c.x, y: l.y + 1, z: c.z }); }
  }
  return out;
}

/** Whether a torch spot lies within 2 cells of a face still going (2 across, 2 up or down: the stairs' steps). */
export function nearMineFace(faces: Array<{ x: number; y: number; z: number }>, p: { x: number; y: number; z: number }): boolean {
  return faces.some((f) => Math.abs(f.x - p.x) + Math.abs(f.z - p.z) <= 2 && Math.abs(f.y - p.y) <= 2);
}

/** Whether a part still grows (a tunnel not ended, or with a branch not finished; stairs down or iron stairs without a
 *  level, the iron level not finished): a growing part is lit only with 2 spots waiting (MINE_LIGHT_MIN). */
export function mineGrowing(m: Mine, part: string): boolean {
  if (part === 'mine:stairs') return m.level === undefined && !m.stopped;
  if (part === 'mine:iron') return !!m.iron && !m.iron.finished;
  const down = /^mine:down:(\d+)$/.exec(part);
  if (down) { const d = m.down?.[Number(down[1])]; return !!d && d.level === undefined && !d.stopped; }
  const leg = /^mine:(\d+)$/.exec(part);
  const l = leg ? m.legs?.[Number(leg[1])] : undefined;
  if (!l || m.level === undefined || m.stopped || m.dug >= MAX_CELLS) return false;
  return !l.end || openBranches(l).length > 0;
}

export const MINE_SKILLS: Record<string, McSkill> = {
  dig_mine: { check: (x) => x.max_depth !== undefined && void num(x.max_depth, 'max_depth'), run: digMine },
};
