/**
 * The monument's quarry in the world (M2, #145; MC_QUARRY, off; quarry.ts has the pit's geometry): a cobblestone trip
 * for the cathedral's yard (collect with the member's `monumentGather` set to cobblestone) digs the pit beside its pad
 * instead of the village mine. The first such trip chooses the pit's site; each trip then digs rows of the shallowest
 * open layer, one member a row, by hand (Paper times digs by the wall clock: lesson 40), standing on the step or in the
 * cell it dug last. Only the pit's own cells, only natural ground (and trees on it); a row stops before water, lava, a
 * cave or a built block. The pit's ground is a structure record ("quarry", down to its floor), so collect's filter, the
 * site searches and layouts keep off it (lesson 30). Topsoil past what scaffolding wants is dropped in the pit.
 */
import { Vec3 } from 'vec3';
import type { Village } from '../village';
import { VILLAGE_RANGE, areaText } from '../village';
import { QUARRY, cellsLeft, newQuarry, openRows, pitDone, pitSize, quarryLine, rowCell, rowLength, searchQuarry, soilDepth, type Quarry } from '../quarry';
import { MONUMENT, monumentPlan, siteTaken } from '../monument';
import type { BotAgent } from './botAgent';
import { MINE_DIGGABLE, MINE_STONE } from './mcBlocks';
import { mineAreas } from './mcMine';
import { makePickaxe, mineBlock, pickUpDrops } from './mcSurvival';
import { surfaceAt, withScanTurn } from './mcBuild';
import { ContentionError, checkAbort, countItem, itemId, reach, sleep } from './mcUtil';

/** Rows held by their diggers ("village:k,v" -> who, until): one member a row. */
const held = new Map<string, { by: string; until: number }>();
/** Villages whose quarry site is being chosen (one at a time). */
const choosing = new Set<string>();
/** How long one trip digs at most, and a row's hold. */
const TRIP_MS = 6 * 60000, HOLD_MS = 3 * 60000;
/** What a quarry may dig: the mine's natural ground plus a tree standing on the pit. */
const DIGGABLE = (name: string) => MINE_DIGGABLE.has(name) || /_(log|leaves)$|^(vine|snow|moss_carpet|.*_mushroom)$/.test(name);
/** Topsoil kept for the pathfinder's scaffolding; the rest is dropped in the pit. */
const KEEP_DIRT = 16;

/** Whether a village's cathedral trip for an item digs the quarry. */
export function quarryFeeds(v: Village | undefined, item: string): boolean {
  const m = v?.monument;
  // (#165: a dug-out pit is followed by a new one while the monument still wants cobblestone: Cologne 1:3's 27x27 pit gave
  // 2,395 of the ~5,000 it was sized for, 25 rows cut by caves and water, and the towers waited 19 minutes on the mine)
  // (MC_CIVIC: never for a civic building: a pit sized from its small bill dug only soil, 400 dirt and no stone, in the
  // staged run; its cobblestone comes from storage and the village mine)
  return QUARRY.on && MONUMENT.on && item === 'cobblestone' && !!m?.site?.prepared && (m as { type?: string }).type !== 'civic' && (m.quarryBackoff ?? 0) <= Date.now();
}

/** The cobblestone the cathedral still wants in all (the whole plan's raw bill less its yard): the pit's size. */
function cobbleWanted(a: BotAgent, v: Village): number {
  const m = v.monument!;
  const raw = a.world.monumentRaw(m, monumentPlan(m).bill);
  const built = monumentPlan(m).jobs.filter((_, i) => m.done.includes(i)).reduce((t, j) => t + (a.world.monumentRaw(m, j.bill).cobblestone ?? 0), 0);
  return Math.max(0, (raw.cobblestone ?? 0) - built - (m.yard.cobblestone ?? 0));
}

/** The pit's site, chosen once (near the storage hut, beside the pad, off everything the village keeps). */
async function chooseQuarry(a: BotAgent, v: Village, signal: AbortSignal): Promise<Quarry | null> {
  const m = v.monument!;
  if (choosing.has(v.name)) return null;
  choosing.add(v.name);
  try {
    const reg = a.world.villages;
    const s = m.site!, hut = v.storageHut;
    // The topsoil round the pad (its layers above the first stone, read down a ring of columns 6 out): the pit is sized
    // for its stone
    const soilCols: number[] = [];
    for (const [x, z] of [[s.x1 - 6, s.z1 - 6], [s.x2 + 6, s.z1 - 6], [s.x1 - 6, s.z2 + 6], [s.x2 + 6, s.z2 + 6], [Math.round((s.x1 + s.x2) / 2), s.z1 - 6], [Math.round((s.x1 + s.x2) / 2), s.z2 + 6], [s.x1 - 6, Math.round((s.z1 + s.z2) / 2)], [s.x2 + 6, Math.round((s.z1 + s.z2) / 2)]]) {
      const top = surfaceAt(a, x, z, s.y);
      if (!top || top.liquid || top.block === 'air') continue;
      let n = 0;
      while (n < 12 && !MINE_STONE.has(nameAt(a, x, top.y - n, z) ?? 'stone')) n++;
      soilCols.push(n);
    }
    const soil = soilDepth(soilCols);
    const { side, depth } = pitSize(cobbleWanted(a, v), soil);
    const center = { x: Math.round((s.x1 + s.x2) / 2), z: Math.round((s.z1 + s.z2) / 2) };
    const hutAt = hut ? { x: Math.round((hut.x1 + hut.x2) / 2), z: Math.round((hut.z1 + hut.z2) / 2) } : center;
    const takenAt = siteTaken(v, [...reg.villages.values()].filter((o) => o !== v), v.mine ? mineAreas(v.mine) : [], Date.now(), a.name);
    const found = await withScanTurn(signal, () => {
      const py = s.y;
      return searchQuarry({
        side, center: { x: Math.round((center.x + hutAt.x) / 2), z: Math.round((center.z + hutAt.z) / 2) }, hut: hutAt,
        range: Math.min(VILLAGE_RANGE - 8, Math.round(Math.hypot(center.x - hutAt.x, center.z - hutAt.z) / 2) + side + 24),
        ground: (x, z) => {
          const c = surfaceAt(a, x, z, py);
          return !c || c.liquid || c.block === 'air' ? null : { y: c.y, trees: c.trees };
        },
        takenAt,
      });
    });
    if (!found) {
      m.quarryBackoff = Date.now() + 10 * 60000;
      reg.save();
      console.log(`[quarry] ${v.name}: no site for a ${side}x${side} pit near the cathedral (backing off 10 min)`);
      return null;
    }
    const q = newQuarry(found.area, found.y, depth, found.side, a.name, Date.now(), soil);
    if (m.quarry) (m.quarriesDone ??= []).push(m.quarry);
    const id = reg.id('s');
    // (its ground down to the floor: collect's filter keeps off a structure from its y up)
    v.structures.push({ id, ...found.area, y: found.y - depth, kind: 'quarry', builtBy: a.name });
    q.structure = id;
    m.quarry = q;
    reg.save();
    reg.note(v, `${a.name} marked out the cathedral's quarry at ${areaText(found.area)} (${side} a side, ${depth} deep)`);
    console.log(`[quarry] ${v.name}: ${a.name} chose the pit at ${areaText(found.area)} y=${found.y} side=${found.side} (${side}x${side}x${depth}, ~${cellsLeft(q)} cells, soil ~${soil} deep, cost ${Math.round(found.cost)})`);
    return q;
  } finally {
    choosing.delete(v.name);
  }
}

/** The bot's view of a block's name (null: not loaded). */
const nameAt = (a: BotAgent, x: number, y: number, z: number) => {
  const b = a.bot.blockAt(new Vec3(x, y, z));
  return b ? b.name : null;
};
const LIQUID = /^(water|lava|bubble_column)$/;

/** Why a cell must not be dug (a reason, so the row is cut there), or '' to dig, or 'open' when there is nothing to dig. */
function cellRule(a: BotAgent, q: Quarry, x: number, y: number, z: number): string {
  const n = nameAt(a, x, y, z);
  if (n === null) return 'not loaded';
  if (LIQUID.test(n)) return `${n} in the cell`;
  // (air and every plant with no collision box: wildflowers on the pit's top were taken for built, M2's live check)
  if (a.bot.blockAt(new Vec3(x, y, z))?.boundingBox === 'empty') return 'open';
  // (water or lava beside it, above it or under it would run into the pit)
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
    const m = nameAt(a, x + dx, y + dy, z + dz);
    if (m && LIQUID.test(m)) return `${m} beside it`;
  }
  // (a cave under the floor: the digger would drop into it; the pit's last layer has none below it to dig)
  const below = nameAt(a, x, y - 1, z);
  if (below && /^(air|cave_air)$/.test(below) && y - 1 > q.y - q.depth) return 'a cave under it';
  if (!DIGGABLE(n)) return `${n} (built or not natural)`;
  return '';
}

/**
 * A cobblestone trip in the quarry: rows of the shallowest open layer until `want` more cobblestone is held, the trip's
 * time is up (`tripMs`: a bulk trip's own, #163) or no row is open. Returns what it got and why it stopped; throws ContentionError when every open row is
 * held by other diggers.
 */
export async function quarryFor(a: BotAgent, v: Village, want: number, have: () => number, signal: AbortSignal, tripMs = TRIP_MS): Promise<{ got: number; why: string }> {
  const m = v.monument!;
  const reg = a.world.villages;
  const q = m.quarry && m.quarry.state !== 'done' ? m.quarry : await chooseQuarry(a, v, signal);
  if (!q) throw new Error('the cathedral\'s quarry has no site yet; collect again (the village mine gives meanwhile)');
  const start = have(), t0 = Date.now();
  let dug = 0, rows = 0, why = '';
  const mine = (k: number, v2: number) => `${v.name}:${k},${v2}`;
  const letGo = () => { for (const [k, h] of held) if (h.by === a.name) held.delete(k); };
  letGo();
  const tally = (item: string, n: number) => { q.got[item] = (q.got[item] ?? 0) + n; };
  // Topsoil past the scaffolding's keep and gravel dropped in the pit (nothing uses them; the inventory fills)
  const dropJunk = async () => {
    for (const junk of ['dirt', 'gravel', 'coarse_dirt', 'rooted_dirt']) {
      const id = itemId(a, junk);
      if (id === undefined) continue;
      const n = countItem(a, id) - (junk === 'dirt' ? KEEP_DIRT : 0);
      if (n > 0) await a.bot.toss(id, null, n).catch(() => undefined);
    }
  };
  try {
    while (have() - start < want) {
      checkAbort(signal);
      if (Date.now() - t0 > tripMs) { why = 'the trip\'s time is up'; break; }
      const now = Date.now();
      const busy = new Set([...held].filter(([k, h]) => k.startsWith(`${v.name}:`) && h.by !== a.name && h.until > now).map(([k]) => k.slice(v.name.length + 1)));
      const open = openRows(q, busy);
      if (!open.length) {
        if (pitDone(q)) {
          q.state = 'done';
          reg.save();
          reg.note(v, `The cathedral's quarry is dug out (${q.dug} cells)`);
          why = 'the quarry is dug out';
          break;
        }
        if (have() - start > 0) { why = 'every open row is held'; break; }
        throw new ContentionError(`every open row of the cathedral's quarry is being dug by others (${busy.size}); collect again soon`, 'busy', `quarry:${v.name}`);
      }
      const { k, v: row } = open[0];
      held.set(mine(k, row), { by: a.name, until: now + HOLD_MS });
      rows++;
      const key = `${k},${row}`;
      const len = rowLength(q, k, row);
      for (let i = q.rows[key] ?? 0; i < len && have() - start < want; i = q.rows[key] ?? 0) {
        checkAbort(signal);
        held.set(mine(k, row), { by: a.name, until: Date.now() + HOLD_MS });
        const c = rowCell(q, k, row, i);
        const rule = cellRule(a, q, c.x, c.y, c.z);
        if (rule === 'not loaded') {
          // (walk nearer: the chunk loads)
          await reach(a, new Vec3(c.stand.x + 0.5, c.stand.y, c.stand.z + 0.5), 8, signal, 60000);
          if (cellRule(a, q, c.x, c.y, c.z) === 'not loaded') { why = 'its chunk is not loaded'; break; }
          continue;
        }
        if (rule === 'open') {
          q.rows[key] = i + 1;
          q.open++;
          continue;
        }
        if (rule) {
          q.cut[key] = i;
          reg.save();
          console.log(`[quarry] ${v.name}: ${a.name} cut row ${key} at ${i} of ${len} (${rule} at ${c.x},${c.y},${c.z})`);
          break;
        }
        // To the stand (canDig off inside the pit: only its planned cells are dug), then the dig
        const stand = new Vec3(c.stand.x + 0.5, c.stand.y, c.stand.z + 0.5);
        const mv = a.moves();
        const saved = { canDig: mv.canDig, allow1by1towers: mv.allow1by1towers };
        const inPit = a.bot.entity.position.y < q.y + 0.5;
        if (inPit) Object.assign(mv, { canDig: false, allow1by1towers: false });
        const p = new Vec3(c.x, c.y, c.z);
        let walkWhy = '';
        try {
          await reach(a, stand, 1.2, signal, 45000);
        } catch (e) {
          if ((e as Error).message === 'cancelled') throw e;
          walkWhy = (e as Error).message;
        } finally {
          if (inPit) Object.assign(mv, saved);
        }
        // (no way onto the stand: the ordinary walk, free to dig natural ground, to within reach of the cell; M2's live
        // check cut a top row at its second cell for a stand a block off the outside ground)
        if (walkWhy) await reach(a, stand, 2, signal, 45000).then(() => { walkWhy = ''; }, (e: Error) => {
          if (e.message === 'cancelled') throw e;
          walkWhy = e.message;
        });
        const eye = a.bot.entity.position.offset(0, 1.62, 0);
        if (eye.distanceTo(p.offset(0.5, 0.5, 0.5)) > 4.5) {
          // (no way to it: the row ends there, so no trip comes back to it)
          q.cut[key] = i;
          console.log(`[quarry] ${v.name}: ${a.name} cut row ${key} at ${i} of ${len} (could not get to ${c.stand.x},${c.stand.y},${c.stand.z}: ${(walkWhy || 'out of reach').slice(0, 80)})`);
          break;
        }
        const name = nameAt(a, c.x, c.y, c.z)!;
        let said: string;
        try {
          said = await mineBlock(a, p, signal, false, 20000, false);
        } catch (e) {
          const msg = (e as Error).message;
          if (!/^needs \w+_pickaxe/.test(msg)) throw e;
          await makePickaxe(a, signal);
          await reach(a, stand, 1.2, signal, 45000);
          said = await mineBlock(a, p, signal, false, 20000, false);
        }
        if (/^nothing to mine/.test(said)) q.open++;
        else {
          dug++;
          q.dug++;
          tally(name === 'stone' ? 'cobblestone' : name === 'grass_block' ? 'dirt' : /_ore$/.test(name) ? name.replace(/^deepslate_/, '').replace(/_ore$/, '') : name, 1);
        }
        q.rows[key] = i + 1;
      }
      held.delete(mine(k, row));
      if (why) break;
      // (a bulk trip's topsoil, #163: dropped between rows once the inventory runs low on room)
      if (a.bot.inventory.emptySlotCount() < 6) await dropJunk();
    }
    // The drops of the last cells (it stands beside the last one dug)
    const last = a.bot.entity.position.floored();
    await pickUpDrops(a, last.offset(1, 0, 0), signal).catch(() => undefined);
    await sleep(300, signal);
    await dropJunk();
    return { got: have() - start, why: why || 'done' };
  } finally {
    letGo();
    reg.save();
    console.log(`[quarry] ${a.name} trip: dug ${dug} in ${rows} row${rows === 1 ? '' : 's'} in ${((Date.now() - t0) / 60000).toFixed(1)} min; got ${have() - start} cobblestone (${why || 'done'}); ${quarryLine(q)}`);
  }
}
