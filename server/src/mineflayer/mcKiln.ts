/**
 * The cathedral's kiln in the world (M2, #145; MC_KILN, off; kiln.ts has its arithmetic). Two chores:
 * - build_kiln (once): a strip beside the village for k furnaces (kilnSize from the whole cathedral's smelts), chosen as
 *   the quarry's pit is (near the storage hut, off everything kept), recorded as a structure "kiln", prepared level, and
 *   its furnaces made at the hut's table from the yard's cobblestone and set in their cells by placeStation (lessons 29,
 *   33, 44);
 * - tend_kiln (a lane: every second furnace): at the storage hut, the yard's input the stage wants smelted (cobblestone,
 *   with MC_GLAZING sand) and fuel for it (spare coal or charcoal first, else planks sawn from the yard's logs); at the
 *   kiln, each furnace of the lane opened, its output taken and more loaded with fuel for it, never waited on; back at the
 *   hut, stone the stage wants as bricks crafted into stone bricks; everything deposited. The yard's ledger moves with
 *   each step (kiln.ts' header), and the furnaces' loads are kept in the record.
 */
import { Vec3 } from 'vec3';
import type { Village } from '../village';
import { VILLAGE_RANGE, areaText } from '../village';
import { KILN, KILN_SMELTS, SLOT, cookedBy, loadView, type KilnFurnace, kilnLine, kilnSize, kilnStrip, laneFurnaces, loadFurnace, newKiln, spreadLoad, unloadFurnace } from '../kiln';
import { searchQuarry } from '../quarry';
import { MONUMENT, kilnWants, monumentPlan, siteTaken, stageBill, AHEAD, type PlanOf } from '../monument';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { mineAreas } from './mcMine';
import { timeScale } from './mcRules';
import { STORAGE_SKILLS, storageContents, withdrawItems } from './mcStorage';
import { SURVIVAL_SKILLS, placeStation } from './mcSurvival';
import { prepareSite, surfaceAt, withScanTurn } from './mcBuild';
import { abortable, countItem, itemId, num, reach } from './mcUtil';

/** Masons at once (each its lane of furnaces), and the most input one trip carries. */
export const KILN_LANES = 2;
const TRIP_LOAD = 256;
/** Coal and charcoal storage keeps for torches and other smelts (the kiln takes only what is beyond). */
const KEEP_COAL = 16;
/** Villages whose kiln is being built (one builder at a time). */
const building = new Set<string>();

/** The plan of a bill against what is had, as the yard's arithmetic wants it (Materials.plan). */
export const planOf = (w: { materials: { plan: PlanOf } }): PlanOf => (bill, have) => w.materials.plan(bill, have);

/** Whether a village's cathedral uses its kiln now (the flag, a prepared site, and something the yard can smelt). */
export function kilnOn(v: Village | undefined): boolean {
  const m = v?.monument;
  return KILN.on && MONUMENT.on && !!m?.site?.prepared && m.state === 'building';
}

/** build_kiln: the kiln's strip chosen, prepared and its furnaces set (see the header). */
async function buildKiln(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const m = v?.monument;
  if (!v || !m?.site?.prepared) throw new Error('build_kiln: the cathedral has no prepared site');
  if (m.kiln?.state === 'ready') return `the cathedral's kiln at ${areaText(m.kiln)} is ready`;
  if (building.has(v.name)) throw new Error('build_kiln: the kiln is being built by another member');
  building.add(v.name);
  const reg = a.world.villages;
  try {
    if (!m.kiln) {
      const smelts = a.world.materials.plan(monumentPlan(m).bill, {}).fuel.smelts;
      const k = kilnSize(smelts);
      const { w, d } = kilnStrip(k);
      const s = m.site, hut = v.storageHut;
      const hutAt = hut ? { x: Math.round((hut.x1 + hut.x2) / 2), z: Math.round((hut.z1 + hut.z2) / 2) } : { x: s.x1, z: s.z1 };
      const takenAt = siteTaken(v, [...reg.villages.values()].filter((o) => o !== v), v.mine ? mineAreas(v.mine) : [], Date.now(), a.name);
      const found = await withScanTurn(signal, () => searchQuarry({
        side: w, depthSide: d, center: hutAt, hut: hutAt, range: Math.min(VILLAGE_RANGE - 8, 64),
        ground: (x, z) => {
          const c = surfaceAt(a, x, z, s.y);
          return !c || c.liquid || c.block === 'air' ? null : { y: c.y, trees: c.trees };
        },
        takenAt,
      }));
      if (!found) {
        m.kilnBackoff = Date.now() + 10 * 60000;
        reg.save();
        throw new Error(`build_kiln: no level ground for a ${w}x${d} kiln near the storage hut`);
      }
      m.kiln = newKiln(found.area, found.y, k, a.name, Date.now());
      const id = reg.id('s');
      v.structures.push({ id, ...found.area, y: found.y, kind: 'kiln', builtBy: a.name });
      m.kiln.structure = id;
      reg.save();
      console.log(`[kiln] ${v.name}: ${a.name} chose the kiln's strip at ${areaText(found.area)} y=${found.y} for ${k} furnaces (${smelts} smelts in the cathedral)`);
    }
    const kl = m.kiln;
    const w = kl.x2 - kl.x1 + 1, dd = kl.z2 - kl.z1 + 1;
    await prepareSite(a, { x: kl.x1 + Math.floor(w / 2), z: kl.z1 + Math.floor(dd / 2), width: w, depth: dd, y: kl.y, margin: 1, works: true }, signal);
    // The furnaces: made at the hut's table from cobblestone withdrawn (the yard's first), carried, set in their cells
    const missing = [];
    for (const f of kl.furnaces)
      if (!/passed/i.test(await a.world.rcon.command(`execute if block ${f.x} ${f.y} ${f.z} minecraft:furnace`).catch(() => ''))) missing.push(f);
    if (missing.length) {
      const fid = itemId(a, 'furnace')!;
      const want = Math.max(0, missing.length - countItem(a, fid));
      if (want) {
        await withdrawItems(a, v, { cobblestone: 8 * want }, signal);
        await SURVIVAL_SKILLS.craft.run(a, { item: 'furnace', count: want }, signal);
        m.yard.cobblestone = Math.max(0, (m.yard.cobblestone ?? 0) - 8 * want);
        if (!m.yard.cobblestone) delete m.yard.cobblestone;
      }
      for (const [i, f] of kl.furnaces.entries()) {
        if (!missing.includes(f)) continue;
        await placeStation(a, 'furnace', signal, `the cathedral's kiln (${i + 1})`, 0, false, {
          pos: { x: f.x, y: f.y, z: f.z }, facing: 'north', lockKey: `${v.name}:kiln:${i}`,
          record: () => undefined,
        });
      }
    }
    kl.state = 'ready';
    reg.save();
    reg.note(v, `${a.name} built the cathedral's kiln: ${kl.furnaces.length} furnaces at ${areaText(kl)}`);
    console.log(`[kiln] ${v.name}: ${a.name} built the kiln (${kilnLine(kl, Date.now(), timeScale())})`);
    return `built the cathedral's kiln at ${areaText(kl)}: ${kl.furnaces.length} furnaces`;
  } finally {
    building.delete(v.name);
  }
}

/** The fuel a load of `smelts` takes: spare coal and charcoal first, else planks (sawn from logs). */
function fuelFor(v: Village, smelts: number): { coal: string | null; coalN: number; planks: number } {
  const stock = storageContents(v);
  const coalKind = (stock.coal ?? 0) - KEEP_COAL >= (stock.charcoal ?? 0) - KEEP_COAL ? 'coal' : 'charcoal';
  const spare = Math.max(0, (stock[coalKind] ?? 0) - KEEP_COAL);
  const coalN = Math.min(spare, Math.ceil(smelts / 8));
  const planks = Math.ceil(Math.max(0, smelts - coalN * 8) / 1.5);
  return { coal: coalN ? coalKind : null, coalN, planks };
}

/** tend_kiln: a lane of the kiln loaded and unloaded (see the header). */
async function tendKiln(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const m = v?.monument;
  const kl = m?.kiln;
  if (!v || !m || kl?.state !== 'ready') throw new Error('tend_kiln: the cathedral has no kiln ready');
  const lane = Math.max(1, Math.floor(num(args.lane ?? 1, 'lane')));
  const reg = a.world.villages, plan = planOf(a.world), scale = timeScale();
  const fs = laneFurnaces(kl, lane, KILN_LANES);
  // (the load spread over the furnaces as they will be once their done output is out: loadView)
  const view = loadView(fs, Date.now(), scale);
  const real = (g: KilnFurnace) => fs[view.indexOf(g)];
  const notes: string[] = [];
  const wood = m.wood || 'oak';
  // 1. What to load: the stage's smelts the yard holds, within the lane's room and a trip's load
  const wants = kilnWants(m, plan);
  const load: Record<string, number> = {};
  let total = 0;
  for (const [input, q] of Object.entries(wants)) {
    const room = spreadLoad(view, { ...load, [input]: q }).filter((p) => p.input === input).reduce((t, p) => t + p.n, 0);
    const n = Math.min(q, room, TRIP_LOAD - total);
    if (n > 0) { load[input] = n; total += n; }
  }
  // 2. The input and its fuel from storage (planks from the yard's logs, sawn at the hut's table): fuel for the load and
  // for what the lane's furnaces hold (one whose fire went out is refuelled: M2's live check left 64 cobblestone in a
  // furnace with no fuel, and the record counted it smelted)
  const held = fs.reduce((t, f) => t + f.n, 0);
  const fuel = fuelFor(v, total + held);
  if (total + held) {
    const logs = Math.ceil(fuel.planks / 4);
    const got = (await withdrawItems(a, v, { ...load, ...(fuel.coal ? { [fuel.coal]: fuel.coalN } : {}), ...(logs ? { [`${wood}_log`]: logs } : {}) }, signal)).got as Record<string, number>;
    for (const input of Object.keys(load)) load[input] = Math.min(load[input], got[input] ?? 0);
    if (logs && (got[`${wood}_log`] ?? 0) > 0) {
      await SURVIVAL_SKILLS.craft.run(a, { item: `${wood}_planks`, count: (got[`${wood}_log`] ?? 0) * 4 }, signal).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        notes.push(`planks not sawn (${e.message.slice(0, 60)})`);
      });
      m.yard[`${wood}_log`] = Math.max(0, (m.yard[`${wood}_log`] ?? 0) - (got[`${wood}_log`] ?? 0));
      if (!m.yard[`${wood}_log`]) delete m.yard[`${wood}_log`];
    }
  }
  // 3. At the kiln: each furnace of the lane, its output taken, more loaded with its fuel
  const spread = spreadLoad(view, load).map((p) => ({ ...p, f: real(p.f) }));
  const taken: Record<string, number> = {}, loaded: Record<string, number> = {};
  const coalId = fuel.coal ? itemId(a, fuel.coal)! : undefined;
  const plankId = itemId(a, `${wood}_planks`)!;
  // Fuel in a furnace's slot to cover what its input still needs (the slot's own kind, else coal, else planks)
  const topUp = async (fw: Awaited<ReturnType<typeof a.bot.openFurnace>>, f: { x: number; y: number; z: number }) => {
    const inp = fw.inputItem();
    if (!inp) return;
    const inSlot = fw.fuelItem();
    const per = (n?: string) => (n === 'coal' || n === 'charcoal' ? 8 : n && /_log$/.test(n) ? 1.5 : 1.5);
    const covered = (inSlot ? inSlot.count * per(inSlot.name) : 0) + (fw.fuel > 0 ? 1 : 0);
    if (covered >= inp.count) return;
    const useCoal = coalId !== undefined && countItem(a, coalId) > 0 && (!inSlot || inSlot.name === fuel.coal);
    const fid = useCoal ? coalId! : plankId;
    if (inSlot && inSlot.type !== fid) return void notes.push(`fuel of another kind in ${f.x},${f.y},${f.z}`);
    const n = Math.min(countItem(a, fid), SLOT - (inSlot?.count ?? 0), Math.ceil((inp.count - covered) / (useCoal ? 8 : 1.5)));
    if (n > 0) await fw.putFuel(fid, null, n);
    else notes.push(`no fuel for ${f.x},${f.y},${f.z}`);
  };
  // (every furnace of the lane opened: the record is set to what each really holds, lesson 29)
  for (const f of fs) {
    const mine = spread.filter((p) => p.f === f);
    const pos = new Vec3(f.x, f.y, f.z);
    await reach(a, pos.offset(0.5, 0, 0.5), 2.5, signal, 60000);
    const block = a.bot.blockAt(pos);
    if (block?.name !== 'furnace') { notes.push(`no furnace at ${f.x},${f.y},${f.z}`); continue; }
    const fw = await abortable(a.bot.openFurnace(block), signal);
    try {
      const out = fw.outputItem();
      if (out) {
        const t = await fw.takeOutput();
        const n = t?.count ?? out.count;
        taken[out.name] = (taken[out.name] ?? 0) + n;
        unloadFurnace(f, n);
      }
      // (what the furnace really holds: the record follows it, lesson 29; what it lost is the yard's again to want)
      const inp = fw.inputItem();
      unloadFurnace(f, f.n);
      if (inp && KILN_SMELTS[inp.name]) loadFurnace(f, inp.name, inp.count, Date.now(), scale);
      for (const p of mine) {
        const id = itemId(a, p.input)!;
        const n = Math.min(p.n, countItem(a, id));
        if (n <= 0) continue;
        if (fw.inputItem() && fw.inputItem()!.name !== p.input) { notes.push(`${f.x},${f.y},${f.z} still on ${fw.inputItem()!.name}`); continue; }
        await fw.putInput(id, null, n);
        loadFurnace(f, p.input, n, Date.now(), scale);
        loaded[p.input] = (loaded[p.input] ?? 0) + n;
        m.yard[p.input] = Math.max(0, (m.yard[p.input] ?? 0) - n);
        if (!m.yard[p.input]) delete m.yard[p.input];
      }
      await topUp(fw, f);
    } finally {
      fw.close();
    }
  }
  for (const [n, q] of Object.entries(taken)) {
    m.yard[n] = (m.yard[n] ?? 0) + q;
    kl.made[n] = (kl.made[n] ?? 0) + q;
  }
  kl.tends++;
  reg.save();
  // 4. Back at the hut: stone the stage wants as bricks crafted, then everything deposited
  let bricks = 0;
  const stoneHeld = countItem(a, itemId(a, 'stone')!);
  if (stoneHeld >= 4) {
    const step = plan(stageBill(m, AHEAD), m.yard).steps.find((s) => s.do === 'craft' && s.item === 'stone_bricks');
    const want = Math.min(Math.floor(stoneHeld / 4) * 4, (step?.runs ?? 0) * 4);
    if (want > 0) {
      await SURVIVAL_SKILLS.craft.run(a, { item: 'stone_bricks', count: want }, signal).then(() => {
        bricks = want;
        m.yard.stone = Math.max(0, (m.yard.stone ?? 0) - want);
        if (!m.yard.stone) delete m.yard.stone;
        m.yard.stone_bricks = (m.yard.stone_bricks ?? 0) + want;
        kl.made.stone_bricks = (kl.made.stone_bricks ?? 0) + want;
        reg.save();
      }).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        notes.push(`bricks not crafted (${e.message.slice(0, 60)})`);
      });
    }
  }
  // (the deposit keeps the stone for the cathedral: the bulk cap leaves it, mcStorage.ts spoilSurplus)
  const was = a.memory.monumentGather;
  a.memory.monumentGather = 'stone';
  try {
    // (nothing to put in after a tend that only refuelled: not a failure)
    await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch((e: Error) => {
      if (!/^not carrying anything/.test(e.message)) throw e;
    });
  } finally {
    if (was === undefined) delete a.memory.monumentGather;
    else a.memory.monumentGather = was;
  }
  const list = (c: Record<string, number>) => Object.entries(c).map(([n, q]) => `${q} ${n}`).join(', ') || 'nothing';
  console.log(`[kiln] ${v.name}: ${a.name} tended lane ${lane}: loaded ${list(loaded)}, took ${list(taken)}, crafted ${bricks} stone bricks (fuel ${fuel.coal ? `${fuel.coalN} ${fuel.coal}, ` : ''}${fuel.planks} planks)${notes.length ? `; ${notes.join('; ')}` : ''}; ${kilnLine(kl, Date.now(), scale)}`);
  return `tended the cathedral's kiln (lane ${lane}): loaded ${list(loaded)}, took out ${list(taken)}${bricks ? `, crafted ${bricks} stone bricks` : ''}`;
}

/** What a lane can do now: input the stage wants smelted that the yard holds (and room for it), or output ready. */
export function laneWork(v: Village, lane: number, plan: PlanOf, now: number): { load: number; ready: number } {
  const m = v.monument!, kl = m.kiln!;
  const fs = laneFurnaces(kl, lane, KILN_LANES);
  const wants = kilnWants(m, plan);
  const load = spreadLoad(loadView(fs, now, timeScale()), wants).reduce((t, p) => t + p.n, 0);
  const ready = fs.reduce((t, f) => t + cookedBy(f, now, timeScale()), 0);
  return { load, ready };
}

/** The kiln's input names (for the menu's words). */
export const KILN_INPUTS = Object.keys(KILN_SMELTS);

export const KILN_SKILLS: Record<string, McSkill> = {
  build_kiln: { run: buildKiln },
  tend_kiln: { check: (x) => void num(x.lane ?? 1, 'lane'), run: tendKiln },
};
