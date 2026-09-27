/**
 * Building skills for agents in real Minecraft, with the sandbox's names, arguments, checks and village records:
 * find_site, prepare_site (fell trees, cut and fill to one level), build_design, build_box and build (hut, house,
 * platform, wall).
 *
 * Creative agents build with server commands (/setblock and /fill over RCON, which need no operator rights for the
 * bots), paced by memory.buildSpeed like the sandbox (1 is about 10 blocks a second), while the bot stands by the site
 * and looks at what it builds. Survival building (placing carried blocks one by one) is not implemented yet.
 */
import { Vec3 } from 'vec3';
import type { Area, Design, Reservation } from '../village';
import { areaText, overlaps } from '../village';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { at, checkAbort, goals, num, sleep, standableY, str, walk } from './mcUtil';

type Pos = [number, number, number];

interface Target {
  x: number;
  y: number;
  z: number;
  /** A block id ('air' to clear), optionally with states: "oak_stairs[facing=east]". */
  block: string;
  /** Outward direction for doors. */
  facing?: [number, number];
}

interface Built extends Area {
  y: number;
  kind: string;
}

interface Plot extends Area {
  y: number;
}

const MAX_BUILD_BLOCKS = 2000;
const baseName = (b: string) => b.replace(/^minecraft:/, '').replace(/\[.*$/, '');

/** Plants, trees and snow: not ground. */
const NON_GROUND = /leaves|_log$|_wood$|_stem$|grass$|fern|flower|dandelion|poppy|tulip|orchid|allium|bluet|daisy|lilac|peony|rose_bush|sunflower|bush|sapling|^snow$|vine|mushroom|sugar_cane|bamboo|cactus|azalea|dripleaf|moss_carpet|leaf_litter|petals|cobweb/;
/** Ground as nature makes it (find_site counts anything else as built on). */
const NATURAL_GROUND = /^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|mud|sand|red_sand|gravel|stone|deepslate|tuff|granite|diorite|andesite|calcite|snow_block|clay|moss_block|sandstone|red_sandstone|terracotta|.*_terracotta|packed_ice|ice)$/;
/** Blocks that occur in the wild: preparing a site may remove these, never anything built. */
const NATURAL = /^(stone|deepslate|tuff|granite|diorite|andesite|calcite|grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|mud|bedrock|water|lava|sand|red_sand|gravel|sandstone|red_sandstone|snow_block|snow|ice|packed_ice|clay|terracotta|.*_terracotta|moss_block|moss_carpet|mossy_cobblestone|cactus|sugar_cane|bamboo|dead_bush|short_grass|tall_grass|short_dry_grass|tall_dry_grass|fern|large_fern|bush|firefly_bush|leaf_litter|pumpkin|melon|vine|cobweb|.*_mushroom|.*_mushroom_block|mushroom_stem|dandelion|poppy|.*_tulip|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|lilac|peony|rose_bush|sunflower|pink_petals|wildflowers)$|_ore$|_log$|_wood$|_leaves$|_sapling$/;
const isLog = (n: string) => /_log$|_wood$|_stem$/.test(n);
const isLeaves = (n: string) => n.endsWith('_leaves');
const FACES: Pos[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// ---------------------------------------------------------------------------------------------
// Looking at the terrain
// ---------------------------------------------------------------------------------------------

interface Surface { y: number; block: string; liquid: boolean; trees: number }

function blockName(a: BotAgent, x: number, y: number, z: number): string | null {
  return a.bot.blockAt(new Vec3(x, y, z))?.name ?? null;
}

const LIQUID = /^(water|lava|bubble_column)$/;

/** The top of a column as a builder sees it: liquid, or the first solid non-plant block, plus tree blocks above it. */
function surfaceAt(a: BotAgent, x: number, z: number, yHint: number): Surface | null {
  const v = new Vec3(x, 0, z);
  let trees = 0;
  for (let y = yHint + 32; y > yHint - 48; y--) {
    const b = a.bot.blockAt(v.set(x, y, z));
    if (!b) return null; // not loaded
    if (b.name === 'air' || b.name === 'cave_air') continue;
    if (LIQUID.test(b.name) || b.getProperties?.().waterlogged === true && b.boundingBox === 'empty') return { y, block: b.name, liquid: true, trees };
    if (isLog(b.name) || isLeaves(b.name)) trees++;
    if (b.boundingBox === 'block' && !NON_GROUND.test(b.name)) return { y, block: b.name, liquid: false, trees };
  }
  return null;
}

/** The whole tree around a log or leaf block: its connected logs and the leaves around them (tree felling). */
function treeAt(a: BotAgent, x: number, y: number, z: number): Pos[] {
  const k = (p: Pos) => `${p[0]},${p[1]},${p[2]}`;
  const name = (p: Pos) => blockName(a, p[0], p[1], p[2]) ?? '';
  let start: Pos | null = isLog(name([x, y, z])) ? [x, y, z] : null;
  if (!start && isLeaves(name([x, y, z]))) {
    // Leaves are at most a few blocks from their trunk: search through them for a log
    const seen = new Set([k([x, y, z])]);
    let frontier: Pos[] = [[x, y, z]];
    for (let depth = 0; depth < 6 && frontier.length && !start; depth++) {
      const next: Pos[] = [];
      for (const p of frontier)
        for (const d of FACES) {
          const q: Pos = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
          if (seen.has(k(q))) continue;
          seen.add(k(q));
          const n = name(q);
          if (isLog(n)) {
            start = q;
            break;
          }
          if (isLeaves(n)) next.push(q);
        }
      frontier = next;
    }
  }
  if (!start) return [];
  const logs: Pos[] = [start];
  const seen = new Set([k(start)]);
  for (let i = 0; i < logs.length && logs.length < 300; i++)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const q: Pos = [logs[i][0] + dx, logs[i][1] + dy, logs[i][2] + dz];
          if (seen.has(k(q)) || Math.abs(q[0] - start[0]) > 8 || Math.abs(q[2] - start[2]) > 8) continue;
          seen.add(k(q));
          if (isLog(name(q))) logs.push(q);
        }
  const leaves: Pos[] = [];
  let frontier = logs;
  for (let depth = 0; depth < 6 && frontier.length && leaves.length < 2000; depth++) {
    const next: Pos[] = [];
    for (const p of frontier)
      for (const d of FACES) {
        const q: Pos = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
        if (seen.has(k(q))) continue;
        seen.add(k(q));
        if (isLeaves(name(q))) next.push(q);
      }
    leaves.push(...next);
    frontier = next;
  }
  return [...logs, ...leaves];
}

// ---------------------------------------------------------------------------------------------
// Doing the work: commands, paced, with village reservations
// ---------------------------------------------------------------------------------------------

interface Job {
  targets: Target[];
  /** Ground reserved in the village while working (checked for conflicts first). */
  claim?: { area: Area; purpose: string; avoidStructures: boolean };
  /** Where to stand: the area worked on. */
  area: Area;
  y: number;
}

/** Whether a block is already what a target wants (by id; states such as door facing are not compared). */
function alreadyThere(a: BotAgent, t: Target): boolean {
  const cur = blockName(a, t.x, t.y, t.z);
  if (cur === null) return false;
  if (t.block === 'air') return cur === 'air' || cur === 'cave_air' || LIQUID.test(cur);
  return cur === baseName(t.block);
}

const DIR_NAMES: Record<string, string> = { '1,0': 'east', '-1,0': 'west', '0,1': 'south', '0,-1': 'north' };

/**
 * Run a job: reserve its ground, stand by it, then clear (top-down) and place (bottom-up) with /fill and /setblock,
 * merging vertical runs of the same block. Returns the summary ("placed N blocks, cleared M; skipped ...").
 */
async function runJob(a: BotAgent, job: Job, signal: AbortSignal, felled = 0): Promise<string> {
  if (a.gamemode !== 'creative' && a.memory.buildMode !== 'commands')
    throw new Error('building in survival mode is not supported yet in real Minecraft; it works in creative mode');
  const v = a.village();
  const reg = a.world.villages;
  let reservation: Reservation | undefined;
  if (job.claim && v) {
    const why = reg.conflict(v, job.claim.area, a.name, job.claim.avoidStructures);
    if (why) throw new Error(`cannot work at ${areaText(job.claim.area)}: ${why}; pick another spot (find_site avoids taken ground)`);
    reservation = reg.reserve(v, job.claim.area, a.name, job.claim.purpose);
  }
  try {
    // Stand just south of the site (out of the way of the blocks), where it can be seen
    const cx = Math.floor((job.area.x1 + job.area.x2) / 2), sz = job.area.z2 + 3;
    const sy = standableY(a, cx, job.y + 1, sz);
    const p = a.bot.entity.position;
    if (Math.hypot(p.x - cx, p.z - sz) > 6)
      await walk(a, sy !== null ? new goals.GoalNear(cx, sy, sz, 2) : new goals.GoalNearXZ(cx, sz, 2), `the site at ${cx},${sz}`, signal, 90000).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
      });
    // What is left to do, and in what order: clearing top-down, then placing bottom-up
    const todo = job.targets.filter((t) => !alreadyThere(a, t));
    const clear = todo.filter((t) => t.block === 'air').sort((u, w) => w.y - u.y);
    const place = todo.filter((t) => t.block !== 'air').sort((u, w) => u.y - w.y || u.x - w.x || u.z - w.z);
    // Merge vertical runs of one block in one column into a single /fill
    type Cmd = { cmd: string; n: number; pos: Pos; clear: boolean };
    const cmds: Cmd[] = [];
    const columns = (list: Target[], clearing: boolean) => {
      const byCol = new Map<string, Target[]>();
      for (const t of list) {
        if (/_door$/.test(baseName(t.block))) {
          const f = DIR_NAMES[`${t.facing?.[0] ?? 0},${t.facing?.[1] ?? 1}`] ?? 'south';
          cmds.push({ cmd: `setblock ${t.x} ${t.y} ${t.z} ${baseName(t.block)}[facing=${f},half=lower]`, n: 1, pos: [t.x, t.y, t.z], clear: false });
          cmds.push({ cmd: `setblock ${t.x} ${t.y + 1} ${t.z} ${baseName(t.block)}[facing=${f},half=upper]`, n: 0, pos: [t.x, t.y + 1, t.z], clear: false });
          continue;
        }
        const k = `${t.x},${t.z},${t.block}`;
        if (!byCol.has(k)) byCol.set(k, []);
        byCol.get(k)!.push(t);
      }
      const runs: Array<{ x: number; z: number; y1: number; y2: number; block: string }> = [];
      for (const ts of byCol.values()) {
        const ys = ts.map((t) => t.y).sort((m, n) => m - n);
        let y1 = ys[0], y2 = ys[0];
        for (const y of ys.slice(1)) {
          if (y === y2 + 1) y2 = y;
          else runs.push({ x: ts[0].x, z: ts[0].z, y1, y2, block: ts[0].block }), (y1 = y2 = y);
        }
        runs.push({ x: ts[0].x, z: ts[0].z, y1, y2, block: ts[0].block });
      }
      runs.sort((u, w) => (clearing ? w.y2 - u.y2 : u.y1 - w.y1));
      for (const r of runs)
        cmds.push({
          cmd: r.y1 === r.y2 ? `setblock ${r.x} ${r.y1} ${r.z} ${r.block}` : `fill ${r.x} ${r.y1} ${r.z} ${r.x} ${r.y2} ${r.z} ${r.block}`,
          n: r.y2 - r.y1 + 1, pos: [r.x, r.y1, r.z], clear: clearing,
        });
    };
    columns(clear, true);
    columns(place, false);
    // Pace: memory.buildSpeed x 10 blocks a second, like the sandbox
    const speed = Math.max(0.25, Math.min(20, Number(a.memory.buildSpeed) || 1));
    let placed = 0, cleared = 0, budget = 0;
    const skipped = new Map<string, number>();
    let lastRenew = Date.now();
    for (const c of cmds) {
      checkAbort(signal);
      if (budget <= 0) {
        await sleep(100, signal);
        budget += speed;
      }
      budget -= c.n;
      a.bot.lookAt(new Vec3(c.pos[0] + 0.5, c.pos[1] + 0.5, c.pos[2] + 0.5)).catch(() => {});
      const out = await a.world.rcon.command(c.cmd);
      if (/^(Changed the block|Successfully filled)/i.test(out)) {
        if (c.clear) cleared += c.n;
        else placed += c.n;
      } else if (!/Could not set the block|No blocks were filled/i.test(out)) {
        const why = /not loaded/i.test(out) ? 'in unloaded chunks' : `rejected (${out.slice(0, 60)})`;
        skipped.set(why, (skipped.get(why) ?? 0) + c.n);
      }
      if (reservation && Date.now() - lastRenew > 30000) {
        reg.renew(reservation);
        lastRenew = Date.now();
      }
    }
    // The client hears about the changes a moment later
    await sleep(300, signal);
    const sk = [...skipped].map(([why, n]) => `${n} ${why}`).join(', ');
    return `placed ${placed} blocks, cleared ${cleared}${felled ? ` (${felled} trees felled)` : ''}${sk ? `; skipped ${sk}` : ''}`;
  } finally {
    if (reservation && v) reg.release(v, reservation.id);
  }
}

/** Add a finished building to the agent's village, if it has one. */
function recordStructure(a: BotAgent, b: Built | null): string {
  const v = a.village();
  if (!v || !b) return '';
  const reg = a.world.villages;
  v.structures.push({ ...b, id: reg.id('s'), builtBy: a.name });
  reg.note(v, `${a.name} built a ${b.kind} at ${areaText(b)}`);
  return `${b.kind} recorded in village ${v.name} at ${areaText(b)}`;
}

function placeableBlock(a: BotAgent, name: string, what: string): string {
  if (!a.world.isPlaceable(baseName(name))) throw new Error(`${what} '${name}' is not a placeable block (try oak_planks, cobblestone, stone_bricks, glass)`);
  return name;
}

const int = (args: Record<string, unknown>, k: string) => Math.floor(num(args[k], k));
const size = (args: Record<string, unknown>, k: string, def: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.floor(args[k] !== undefined ? num(args[k], k) : def)));

// ---------------------------------------------------------------------------------------------
// find_site
// ---------------------------------------------------------------------------------------------

function searchSite(a: BotAgent, args: Record<string, unknown>, sz: number, cache: Map<string, Surface | null>): { done: string } | { fail: string } {
  const radius = Math.max(32, Math.min(64, args.radius !== undefined ? int(args, 'radius') : 48));
  const maxSlope = args.max_slope !== undefined ? num(args.max_slope, 'max_slope') : 2;
  const p = a.bot.entity.position;
  const ox = args.x !== undefined ? int(args, 'x') : Math.floor(p.x);
  const oz = args.z !== undefined ? int(args, 'z') : Math.floor(p.z);
  const col = (x: number, z: number) => {
    const k = `${x},${z}`;
    if (!cache.has(k)) cache.set(k, surfaceAt(a, x, z, Math.floor(p.y)));
    return cache.get(k)!;
  };
  const half = Math.floor(sz / 2);
  // In a village, stay off buildings (with a walkway around them) and ground other agents have reserved
  const v = a.village();
  const now = Date.now();
  const taken: Area[] = v
    ? [...v.structures.map((st) => ({ x1: st.x1 - 2, z1: st.z1 - 2, x2: st.x2 + 2, z2: st.z2 + 2 })), ...v.reservations.filter((r) => r.by !== a.name && r.until > now)]
    : [];
  let best: { x: number; z: number; y: number; range: number; trees: number; score: number } | null = null;
  let wet = 0, unloaded = 0, steep = 0, occupied = 0;
  for (let cx = ox - radius; cx <= ox + radius; cx += 2)
    next: for (let cz = oz - radius; cz <= oz + radius; cz += 2) {
      const dist = Math.hypot(cx - ox, cz - oz);
      if (dist > radius) continue;
      const fp = { x1: cx - half, z1: cz - half, x2: cx - half + sz - 1, z2: cz - half + sz - 1 };
      if (taken.some((t) => overlaps(fp, t))) {
        occupied++;
        continue;
      }
      let lo = 1e9, hi = -1e9, trees = 0, built = 0;
      const ys: number[] = [];
      for (let x = fp.x1; x <= fp.x2; x++)
        for (let z = fp.z1; z <= fp.z2; z++) {
          const c = col(x, z);
          if (!c) {
            unloaded++;
            continue next;
          }
          if (c.liquid) {
            wet++;
            continue next;
          }
          lo = Math.min(lo, c.y);
          hi = Math.max(hi, c.y);
          if (hi - lo > maxSlope) {
            steep++;
            continue next;
          }
          trees += c.trees;
          if (!NATURAL_GROUND.test(c.block)) built++;
          ys.push(c.y);
        }
      // Level ground matters most, then staying off existing builds, then fewer trees, then distance
      const score = (hi - lo) * 6 + built * 3 + trees * 0.3 + dist * 0.1;
      if (!best || score < best.score) {
        ys.sort((m, n) => m - n);
        best = { x: cx, z: cz, y: ys[ys.length >> 1], range: hi - lo, trees, score };
      }
    }
  if (!best) {
    const why = [wet && `${wet} over water`, steep && `${steep} too steep`, occupied && `${occupied} taken by buildings or other agents`, unloaded && `${unloaded} not loaded yet`].filter(Boolean).join(', ');
    return { fail: `no dry, flat ${sz}x${sz} site within ${radius} blocks (candidates rejected: ${why}); explore in another direction and try again, or use a smaller size or larger max_slope` };
  }
  a.memory.lastSite = { x: best.x, y: best.y, z: best.z, size: sz };
  const b = best;
  if (v && a.memory.villageRole === 'mayor') a.world.villages.note(v, `${a.name} found a ${sz}x${sz} site centred at x=${b.x} z=${b.z} (ground y=${b.y})`);
  const plots = ((v ? v.plots : (a.memory.plots as Plot[] | undefined)) ?? []) as Plot[];
  const onPlot = plots.some((q) => q.y === b.y && b.x - half >= q.x1 && b.x - half + sz - 1 <= q.x2 && b.z - half >= q.z1 && b.z - half + sz - 1 <= q.z2);
  const ready = onPlot && b.range === 0 && b.trees === 0 ? ' It is on a prepared plot and already level and clear: build there directly, no prepare_site needed.' : '';
  return { done: `site found: centre x=${b.x} z=${b.z}, ground y=${b.y}, ${sz}x${sz}, height range ${b.range}, ${b.trees} tree blocks to clear, ${Math.round(Math.hypot(b.x - ox, b.z - oz))} blocks away.${ready}` };
}

async function findSite(a: BotAgent, args: Record<string, unknown>): Promise<string> {
  const sz = Math.max(3, Math.min(40, args.size !== undefined ? int(args, 'size') : 9));
  const cache = new Map<string, Surface | null>();
  const r = searchSite(a, args, sz, cache);
  if ('done' in r) return r.done;
  // Nothing that big: say what does fit, so the planner can scale the project instead of searching in circles
  if (sz > 9)
    for (let s = sz - 4; s >= Math.max(9, Math.floor(sz / 2)); s -= 4) {
      const alt = searchSite(a, args, s, cache);
      if ('done' in alt)
        throw new Error(`${r.fail.split(';')[0]}. The largest nearby is smaller: ${alt.done.replace(/^site found: /, '')} It is saved as the last site, so prepare_site defaults to it; plan the project to fit, or explore further`);
    }
  throw new Error(r.fail);
}

// ---------------------------------------------------------------------------------------------
// prepare_site
// ---------------------------------------------------------------------------------------------

async function prepareSite(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const p = a.bot.entity.position;
  const last = a.memory.lastSite as { x: number; z: number } | undefined;
  const cx = args.x !== undefined ? int(args, 'x') : last?.x ?? Math.floor(p.x);
  const cz = args.z !== undefined ? int(args, 'z') : last?.z ?? Math.floor(p.z);
  const w = size(args, 'width', 9, 3, 32), d = size(args, 'depth', 9, 3, 32), m = size(args, 'margin', 2, 0, 4);
  const x0 = cx - Math.floor(w / 2), z0 = cz - Math.floor(d / 2), x1 = x0 + w - 1, z1 = z0 + d - 1;
  const surf = new Map<string, Surface>();
  for (let x = x0 - m; x <= x1 + m; x++)
    for (let z = z0 - m; z <= z1 + m; z++) {
      const c = surfaceAt(a, x, z, Math.floor(p.y));
      if (!c) throw new Error(`part of the area is not loaded; walk closer to x=${cx} z=${cz} first`);
      surf.set(`${x},${z}`, c);
    }
  // Level: the most common ground height on the plot itself (least digging and filling), unless given
  let y = args.y !== undefined ? int(args, 'y') : NaN;
  if (Number.isNaN(y)) {
    const counts = new Map<number, number>();
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const c = surf.get(`${x},${z}`)!;
        if (!c.liquid) counts.set(c.y, (counts.get(c.y) ?? 0) + 1);
      }
    if (!counts.size) throw new Error('the area is all water; use find_site to choose dry land');
    y = [...counts].sort((u, v) => v[1] - u[1] || u[0] - v[0])[0][0];
  }
  const targets: Target[] = [];
  const seen = new Set<string>();
  const add = (x: number, yy: number, z: number, block: string) => {
    const k = `${x},${yy},${z}`;
    if (!seen.has(k)) seen.add(k), targets.push({ x, y: yy, z, block });
  };
  let columns = 0, protectedCols = 0, felled = 0;
  const treeLogs = new Set<string>();
  for (let x = x0 - m; x <= x1 + m; x++)
    next: for (let z = z0 - m; z <= z1 + m; z++) {
      // Everything above the level goes, but columns with anything built in them are left alone
      const cut: number[] = [];
      for (let yy = y + 1; yy <= y + 32; yy++) {
        const n = blockName(a, x, yy, z) ?? 'air';
        if (n === 'air' || n === 'cave_air') continue;
        if (!NATURAL.test(n)) {
          protectedCols++;
          continue next;
        }
        cut.push(yy);
      }
      columns++;
      for (const yy of cut) {
        const n = blockName(a, x, yy, z)!;
        // Trees touching the plot are felled whole, so no canopy is left floating
        if ((isLog(n) || isLeaves(n)) && !treeLogs.has(`${x},${yy},${z}`)) {
          const tree = treeAt(a, x, yy, z);
          if (tree.length) felled++;
          for (const [tx, ty, tz] of tree) {
            treeLogs.add(`${tx},${ty},${tz}`);
            add(tx, ty, tz, 'air');
          }
        }
        add(x, yy, z, 'air');
      }
      // Fill low ground and shallow water up to the level
      const c = surf.get(`${x},${z}`)!;
      let g = c.y;
      if (c.liquid) {
        const box = (yy: number) => a.bot.blockAt(new Vec3(x, yy, z))?.boundingBox;
        while (g > y - 10 && box(g) !== 'block') g--;
      }
      if (y - g > 8) throw new Error(`the ground at ${x},${z} is ${y - g} blocks below the level (deep water or a ravine); choose a flatter site with find_site`);
      for (let yy = g + 1; yy < y; yy++) add(x, yy, z, 'dirt');
      const top = blockName(a, x, y, z) ?? 'air';
      const solidTop = a.bot.blockAt(new Vec3(x, y, z))?.boundingBox === 'block';
      if (top !== 'grass_block' && (g < y || top === 'dirt' || !solidTop)) add(x, y, z, 'grass_block');
    }
  if (!columns) throw new Error('the whole area is covered by existing buildings; use find_site to choose another spot');
  if (targets.length > 12000) throw new Error(`too much work (${targets.length} blocks, max 12000); prepare a smaller area`);
  const plot: Plot = { x1: x0, z1: z0, x2: x1, z2: z1, y };
  const summary = await runJob(a, {
    targets, area: plot, y,
    claim: { area: { x1: x0 - m, z1: z0 - m, x2: x1 + m, z2: z1 + m }, purpose: 'prepare a plot', avoidStructures: false },
  }, signal, felled);
  const same = (q: Plot) => q.x1 === plot.x1 && q.z1 === plot.z1 && q.x2 === plot.x2 && q.z2 === plot.z2;
  const v = a.village();
  if (v) {
    const reg = a.world.villages;
    v.plots = v.plots.filter((q) => !same(q));
    v.plots.push({ ...plot, id: reg.id('plot'), preparedBy: a.name });
    reg.note(v, `${a.name} prepared a plot at ${areaText(plot)}`);
  } else a.memory.plots = [...((a.memory.plots as Plot[] | undefined) ?? []).filter((q) => !same(q)), plot].slice(-20);
  return `plot ready: ${w}x${d} centred at x=${cx} z=${cz}, level ground at y=${y} (x ${x0}..${x1}, z ${z0}..${z1}, plus a ${m}-block margin)${protectedCols ? `; left ${protectedCols} columns with existing buildings untouched` : ''}; ${summary}`;
}

// ---------------------------------------------------------------------------------------------
// build_design, build_box, build
// ---------------------------------------------------------------------------------------------

/**
 * Ground level for a building footprint, or throws why the site is not ready: unloaded, water, not level, trees or
 * rocks in the way (prepare it), or another building (go elsewhere).
 */
function readySite(a: BotAgent, area: Area, height: number, what: string): number {
  const w = area.x2 - area.x1 + 1, d = area.z2 - area.z1 + 1;
  const cx = area.x1 + Math.floor(w / 2), cz = area.z1 + Math.floor(d / 2);
  const prep = `run prepare_site x=${cx} z=${cz} width=${w + 2} depth=${d + 2} first`;
  const there = a.village()?.structures.find((st) => overlaps(area, st));
  if (there) {
    const same = there.kind === what.replace(/"/g, '') ? ' (the same design: if building it here was your task, it is already done)' : '';
    throw new Error(`a ${there.kind} built by ${there.builtBy} already stands at ${areaText(there)}${same}; otherwise pick a free spot on the plot`);
  }
  const py = Math.floor(a.bot.entity.position.y);
  const heights: number[] = [];
  let wet = 0;
  for (let x = area.x1; x <= area.x2; x++)
    for (let z = area.z1; z <= area.z2; z++) {
      const c = surfaceAt(a, x, z, py);
      if (!c) throw new Error(`the site is not loaded; walk closer to x=${cx} z=${cz}`);
      if (c.liquid) wet++;
      heights.push(c.y);
    }
  if (wet) throw new Error(`the ${w}x${d} site at x=${cx} z=${cz} has ${wet} columns of water or lava; use find_site to pick a dry spot`);
  heights.sort((m, n) => m - n);
  // A block-deep dip is fine: the building's floor layer fills it
  if (heights[heights.length - 1] - heights[0] > 1) throw new Error(`the ground is not level here (heights ${heights[0]}..${heights[heights.length - 1]}); ${prep}`);
  const y0 = heights[heights.length - 1];
  let blocked = 0, built = '';
  for (let x = area.x1; x <= area.x2; x++)
    for (let z = area.z1; z <= area.z2; z++)
      for (let y = y0 + 1; y < y0 + height; y++) {
        const b = a.bot.blockAt(new Vec3(x, y, z));
        if (!b || b.name === 'air' || b.boundingBox === 'empty') continue;
        blocked++;
        if (!NATURAL.test(b.name)) built ||= `${b.name} at ${x},${y},${z}`;
      }
  if (built) throw new Error(`the site overlaps an existing structure (${built}); choose another site with find_site`);
  if (blocked) throw new Error(`${blocked} blocks (trees or rocks) stand where the ${what} would go; ${prep}`);
  return y0;
}

async function buildDesign(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const name = str(args.design, 'design').toLowerCase();
  const lib = a.village()?.designs ?? (a.memory.designs as Record<string, Design> | undefined) ?? {};
  const d = lib[name];
  if (!d) {
    const names = Object.keys(lib);
    throw new Error(`no design called "${name}"; ${names.length ? `available: ${names.map((n) => `"${n}"`).join(', ')}` : 'create one with design_building first'}`);
  }
  const rot = (((Math.round(Number(args.rotate ?? 0) / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  const W = rot % 2 ? d.depth : d.width, D = rot % 2 ? d.width : d.depth;
  const p = a.bot.entity.position;
  const cx = args.x !== undefined ? int(args, 'x') : Math.floor(p.x);
  const cz = args.z !== undefined ? int(args, 'z') : Math.floor(p.z);
  const area = { x1: cx - Math.floor(W / 2), z1: cz - Math.floor(D / 2), x2: cx - Math.floor(W / 2) + W - 1, z2: cz - Math.floor(D / 2) + D - 1 };
  // Asked to build what already stands there (e.g. a task someone else finished): that is done, not a failure
  const same = a.village()?.structures.find((st) => st.kind === d.name && overlaps(area, st));
  if (same) return `a ${d.name} built by ${same.builtBy} already stands at ${areaText(same)}, so this is already done`;
  const y0 = readySite(a, area, d.height, `"${d.name}"`);
  // Design column i (west to east) and row j (north to south), turned clockwise rot times
  const turn = (i: number, j: number): [number, number] => {
    let [u, v, w, h] = [i, j, d.width, d.depth];
    for (let r = 0; r < rot; r++) [u, v, w, h] = [h - 1 - v, u, h, w];
    return [u, v];
  };
  const targets: Target[] = [];
  const doors: Array<[number, number, [number, number]]> = [];
  d.layers.forEach((layer, li) =>
    layer.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '_') continue;
        const block = ch === '.' ? 'air' : d.palette[ch];
        const [ox, oz] = turn(i, j);
        const x = area.x1 + ox, z = area.z1 + oz;
        let facing: [number, number] | undefined;
        if (/_door$/.test(baseName(block))) {
          facing = ox === 0 ? [-1, 0] : ox === W - 1 ? [1, 0] : oz === 0 ? [0, -1] : [0, 1];
          // A door is placed whole from its lower half; the layer above it stays as the design says
          if (targets.some((t) => t.x === x && t.z === z && t.y === y0 + li - 1 && /_door$/.test(baseName(t.block)))) continue;
          if (li === 1) doors.push([x, z, facing]);
        }
        targets.push({ x, y: y0 + li, z, block, facing });
      }
    }),
  );
  // The upper half of each door is part of the door: do not clear or overwrite it
  const doorTops = new Set(targets.filter((t) => /_door$/.test(baseName(t.block))).map((t) => `${t.x},${t.y + 1},${t.z}`));
  const work = targets.filter((t) => !doorTops.has(`${t.x},${t.y},${t.z}`));
  // Keep the way out clear in front of each outside door
  for (const [x, z, [fx, fz]] of doors)
    for (let i = 1; i <= 2; i++) {
      const wx = x + fx * i, wz = z + fz * i;
      if (a.bot.blockAt(new Vec3(wx, y0, wz))?.boundingBox !== 'block') work.push({ x: wx, y: y0, z: wz, block: 'dirt' });
      for (let y = y0 + 1; y <= y0 + 3; y++) work.push({ x: wx, y, z: wz, block: 'air' });
    }
  if (work.length > 60000) throw new Error(`too big (${work.length} blocks, max 60000)`);
  const summary = await runJob(a, {
    targets: work, area, y: y0,
    claim: { area: { x1: area.x1 - 1, z1: area.z1 - 1, x2: area.x2 + 1, z2: area.z2 + 1 }, purpose: `build a ${d.name}`, avoidStructures: true },
  }, signal);
  const rec = recordStructure(a, { ...area, y: y0, kind: d.name });
  return rec ? `${rec}; ${summary}` : summary;
}

async function buildBox(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const block = str(args.block, 'block');
  if (block !== 'air') placeableBlock(a, block, 'block');
  const [x1, x2] = [Math.min(int(args, 'x1'), int(args, 'x2')), Math.max(int(args, 'x1'), int(args, 'x2'))];
  const [y1, y2] = [Math.min(int(args, 'y1'), int(args, 'y2')), Math.max(int(args, 'y1'), int(args, 'y2'))];
  const [z1, z2] = [Math.min(int(args, 'z1'), int(args, 'z2')), Math.max(int(args, 'z1'), int(args, 'z2'))];
  if ((x2 - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1) > MAX_BUILD_BLOCKS) throw new Error(`box too big (max ${MAX_BUILD_BLOCKS} blocks)`);
  const hollow = !!args.hollow;
  const targets: Target[] = [];
  for (let x = x1; x <= x2; x++)
    for (let y = y1; y <= y2; y++)
      for (let z = z1; z <= z2; z++) {
        const shell = x === x1 || x === x2 || y === y1 || y === y2 || z === z1 || z === z2;
        targets.push({ x, y, z, block: hollow && !shell ? 'air' : block });
      }
  const area = { x1, z1, x2, z2 };
  const summary = await runJob(a, { targets, area, y: y1, claim: { area, purpose: `build_box ${block}`, avoidStructures: false } }, signal);
  const placedSome = !/^placed 0 /.test(summary);
  const rec = block !== 'air' && placedSome ? recordStructure(a, { ...area, y: y1, kind: typeof args.label === 'string' && args.label ? args.label : `${block} box` }) : '';
  return rec ? `${rec}; ${summary}` : summary;
}

const STRUCTURES = ['hut', 'house', 'platform', 'wall'];
const SIDES: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

/** The y of the highest ground block (ignoring trees and plants) in a column. */
function groundY(a: BotAgent, x: number, z: number, y0: number): number {
  return surfaceAt(a, x, z, y0)?.y ?? y0 - 1;
}

async function buildStructure(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const kind = str(args.structure, 'structure');
  if (!STRUCTURES.includes(kind)) throw new Error(`unknown structure ${kind}. Options: ${STRUCTURES.join(', ')}`);
  const material = placeableBlock(a, typeof args.material === 'string' ? args.material : 'oak_planks', 'material');
  const roof = placeableBlock(a, typeof args.roof === 'string' ? args.roof : material, 'roof');
  const floor = placeableBlock(a, typeof args.floor === 'string' ? args.floor : kind === 'platform' ? material : 'cobblestone', 'floor');
  const p = a.bot.entity.position;
  const py = Math.floor(p.y);
  const cx = args.x !== undefined ? int(args, 'x') : Math.floor(p.x) + 6;
  const cz = args.z !== undefined ? int(args, 'z') : Math.floor(p.z);
  const targets: Target[] = [];
  const add = (x: number, y: number, z: number, block: string, facing?: [number, number]) => targets.push({ x, y, z, block, facing });

  if (kind === 'wall') {
    const [dx, dz] = SIDES[String(args.direction ?? 'east')] ?? SIDES.east;
    const len = size(args, 'length', 8, 1, 32), h = size(args, 'height', 3, 1, 5);
    for (let i = 0; i < len; i++) {
      const x = cx + dx * i, z = cz + dz * i;
      const g = groundY(a, x, z, py);
      for (let y = g + 1; y <= g + h; y++) add(x, y, z, material);
    }
    const area = { x1: Math.min(cx, cx + dx * (len - 1)), z1: Math.min(cz, cz + dz * (len - 1)), x2: Math.max(cx, cx + dx * (len - 1)), z2: Math.max(cz, cz + dz * (len - 1)) };
    const y = groundY(a, cx, cz, py);
    const summary = await runJob(a, { targets, area, y, claim: { area, purpose: 'build a wall', avoidStructures: true } }, signal);
    const rec = recordStructure(a, { ...area, y, kind: 'wall' });
    return rec ? `${rec}; ${summary}` : summary;
  }

  const w = size(args, 'width', kind === 'house' ? 7 : 5, 3, 11), d = size(args, 'depth', kind === 'house' ? 7 : 5, 3, 11);
  const h = kind === 'platform' ? 0 : size(args, 'height', kind === 'house' ? 4 : 3, 2, 5);
  const x0 = cx - Math.floor(w / 2), z0 = cz - Math.floor(d / 2);
  const x1 = x0 + w - 1, z1 = z0 + d - 1;
  let wet = 0;
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (surfaceAt(a, x, z, py)?.liquid) wet++;
  if (wet) throw new Error(`the ${w}x${d} site at x=${cx} z=${cz} has ${wet} columns of water or lava; use find_site (size ${Math.max(w, d) + 2}) to pick a dry spot`);
  // Floor level: the median ground height over the footprint, so a sloped site is partly dug in, partly raised
  const ground = new Map<string, number>();
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) ground.set(`${x},${z}`, groundY(a, x, z, py));
  const heights = [...ground.values()].sort((m, n) => m - n);
  const level = heights[heights.length - 1] - heights[0] <= 1 && kind !== 'platform' ? heights[heights.length - 1] : heights[heights.length >> 1];
  const y0 = args.y !== undefined ? int(args, 'y') : level;
  // Houses and huts go on prepared ground: level, with nothing standing where the building will be
  if (kind !== 'platform') {
    const prep = `run prepare_site x=${cx} z=${cz} width=${w + 2} depth=${d + 2} first`;
    if (heights[heights.length - 1] - heights[0] > 1) throw new Error(`the ground is not level here (heights ${heights[0]}..${heights[heights.length - 1]}); ${prep}`);
    let blocked = 0, built = '';
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++)
        for (let y = y0 + 1; y <= y0 + h + 1; y++) {
          const b = a.bot.blockAt(new Vec3(x, y, z));
          if (!b || b.name === 'air' || b.boundingBox === 'empty') continue;
          blocked++;
          if (!NATURAL.test(b.name)) built ||= `${b.name} at ${x},${y},${z}`;
        }
    if (built) throw new Error(`the site overlaps an existing structure (${built}); choose another site with find_site`);
    if (blocked) throw new Error(`${blocked} blocks (trees or rocks) stand where the ${kind} would go; ${prep}`);
  }
  // Door on the side facing the agent unless told otherwise
  const side = typeof args.door === 'string' && SIDES[args.door] ? args.door
    : Math.abs(p.x - cx) > Math.abs(p.z - cz) ? (p.x > cx ? 'east' : 'west') : p.z > cz ? 'south' : 'north';
  const [sdx, sdz] = SIDES[side];
  const doorX = sdx ? (sdx > 0 ? x1 : x0) : cx, doorZ = sdz ? (sdz > 0 ? z1 : z0) : cz;
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      for (let y = ground.get(`${x},${z}`)! + 1; y < y0; y++) add(x, y, z, floor); // raise low ground to the floor
      add(x, y0, z, floor);
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      for (let y = y0 + 1; y <= y0 + h + 2; y++) {
        const rel = y - y0;
        if (kind === 'platform' || rel > h + 1) add(x, y, z, 'air');
        else if (rel === h + 1) add(x, y, z, roof);
        else if (!edge) add(x, y, z, 'air');
        else if (x === doorX && z === doorZ && rel <= 2) {
          if (rel === 1) add(x, y, z, 'oak_door', [sdx, sdz]); // the upper half comes with it
        } else {
          const corner = (x === x0 || x === x1) && (z === z0 || z === z1);
          const mid = x === x0 || x === x1 ? z === cz : x === cx;
          add(x, y, z, !corner && mid && rel === 2 && w >= 5 && d >= 5 ? 'glass' : material);
        }
      }
    }
  // Keep the way out clear: two blocks of walkway in front of the door, with ground under them
  if (kind !== 'platform')
    for (let i = 1; i <= 2; i++) {
      const x = doorX + sdx * i, z = doorZ + sdz * i;
      if (a.bot.blockAt(new Vec3(x, y0, z))?.boundingBox !== 'block') add(x, y0, z, floor);
      for (let y = y0 + 1; y <= y0 + 3; y++) add(x, y, z, 'air');
    }
  if (targets.length > MAX_BUILD_BLOCKS) throw new Error(`too big (${targets.length} blocks, max ${MAX_BUILD_BLOCKS})`);
  const area = { x1: x0, z1: z0, x2: x1, z2: z1 };
  const summary = await runJob(a, { targets, area, y: y0, claim: { area: { x1: x0 - 1, z1: z0 - 1, x2: x1 + 1, z2: z1 + 1 }, purpose: `build a ${kind}`, avoidStructures: true } }, signal);
  const rec = recordStructure(a, { ...area, y: y0, kind });
  return rec ? `${rec}; ${summary}` : summary;
}

const box = (x: Record<string, unknown>) => ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].forEach((k) => num(x[k], k));

export const BUILD_SKILLS: Record<string, McSkill> = {
  find_site: { run: (a, args) => findSite(a, args) },
  prepare_site: { run: prepareSite },
  build_design: { check: (x) => (str(x.design, 'design'), num(x.x, 'x'), num(x.z, 'z')), run: buildDesign },
  build_box: { check: (x) => (box(x), str(x.block, 'block')), run: buildBox },
  build: { check: (x) => void str(x.structure, 'structure'), run: buildStructure },
};

