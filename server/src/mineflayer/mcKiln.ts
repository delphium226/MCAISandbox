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
 * With MC_LODGE (#163, lodge.ts) build_kiln chooses the masons' lodge instead, between the pad and the quarry, and sets
 * its table and chests before the furnaces; a monument chore's withdrawals and deposits then go to the lodge's chests
 * (mcStorage.ts' atLodge), so a tend starts and ends there, not at the hut.
 */
import { Vec3 } from 'vec3';
import type { Village } from '../village';
import { VILLAGE_RANGE, areaText } from '../village';
import { KILN, KILN_SMELTS, SLOT, cookedBy, fuelFor, kilnLanes, loadView, type KilnFurnace, kilnLine, kilnSize, kilnStrip, laneFurnaces, loadFurnace, newKiln, spreadLoad, unloadFurnace } from '../kiln';
import { searchQuarry } from '../quarry';
import { MONUMENT, kilnWants, monumentNoun, monumentPlan, siteTaken, stageBill, AHEAD, type PlanOf } from '../monument';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { mineAreas } from './mcMine';
import { timeScale } from './mcRules';
import { STORAGE_SKILLS, lodgeContents, registerLodgeChest, storageContents, withdrawItems } from './mcStorage';
import { SURVIVAL_SKILLS, placeStation } from './mcSurvival';
import { prepareSite, surfaceAt, withScanTurn } from './mcBuild';
import { abortable, countItem, itemId, num, reach } from './mcUtil';
import { Materials } from './mcMaterials';
import { CUTTER } from '../cutter';
import { DYE_BED } from '../dyeBed';
import { LODGE, lodgeLine, lodgeParts, newLodge, searchLodge } from '../lodge';
import type { StationName } from '../village';

/** The most input one trip carries (masons at once: kilnLanes). */
const TRIP_LOAD = 256;
/** Villages whose kiln is being built (one builder at a time). */
const building = new Set<string>();

/** The plan of a bill against what is had, as the yard's arithmetic wants it (Materials.plan); with the stonecutter
 *  (#162, MC_MONUMENT_DETAIL) a plan that cuts the stone pieces rather than crafting them. */
const cutPlans = new WeakMap<object, Materials>();
export const planOf = (w: { materials: { plan: PlanOf }; registry?: ConstructorParameters<typeof Materials>[0] }): PlanOf => {
  if (!CUTTER.on || !w.registry) return (bill, have) => w.materials.plan(bill, have);
  let cut = cutPlans.get(w);
  // (#162's dye bed: the dyes asked for as such, the dyer makes them)
  if (!cut) cutPlans.set(w, (cut = new Materials(w.registry, { cut: true, dyes: DYE_BED.on })));
  return (bill, have) => cut!.plan(bill, have);
};

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
    if (!m.kiln && LODGE.on) {
      const smelts = a.world.materials.plan(monumentPlan(m).bill, {}).fuel.smelts;
      const k = kilnSize(smelts);
      const s = m.site, hut = v.storageHut;
      const hutAt = hut ? { x: Math.round((hut.x1 + hut.x2) / 2), z: Math.round((hut.z1 + hut.z2) / 2) } : { x: s.x1, z: s.z1 };
      const takenAt = siteTaken(v, [...reg.villages.values()].filter((o) => o !== v), v.mine ? mineAreas(v.mine) : [], Date.now(), a.name);
      const ground = (x: number, z: number) => {
        const c = surfaceAt(a, x, z, s.y);
        return !c || c.liquid || c.block === 'air' ? null : { y: c.y, trees: c.trees };
      };
      // #163 (MC_LODGE): the masons' lodge round the kiln, between the pad and the quarry (the hut's ground as before when
      // none is found there)
      const lodge = await withScanTurn(signal, () => searchLodge({ k, pad: s, quarry: m.quarry, hut: hutAt, maxRange: Math.min(VILLAGE_RANGE - 8, 96), ground, takenAt }));
      if (lodge) {
        const parts = lodgeParts(lodge.area, lodge.y, k);
        m.lodge = newLodge(lodge.area, lodge.y, k, a.name, Date.now());
        m.kiln = newKiln(parts.kiln, lodge.y, k, a.name, Date.now());
        const id = reg.id('s');
        v.structures.push({ id, ...lodge.area, y: lodge.y, kind: 'lodge', builtBy: a.name });
        m.kiln.structure = m.lodge.structure = id;
        reg.save();
        reg.note(v, `${a.name} marked out the ${monumentNoun(m)}'s masons' lodge at ${areaText(lodge.area)}, between its pad and its quarry`);
        console.log(`[lodge] ${v.name}: ${a.name} chose the lodge at ${areaText(lodge.area)} y=${lodge.y} for ${k} furnaces (${smelts} smelts; ${Math.round(Math.hypot((lodge.area.x1 + lodge.area.x2) / 2 - lodge.target.x, (lodge.area.z1 + lodge.area.z2) / 2 - lodge.target.z))} from the point between pad and quarry)`);
      } else console.log(`[lodge] ${v.name}: no level ground for a lodge between the pad and the quarry; the kiln goes near the hut`);
    }
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
    // (the lodge's whole strip with it: its table and chests' row)
    const ground = m.lodge ?? kl;
    const w = ground.x2 - ground.x1 + 1, dd = ground.z2 - ground.z1 + 1;
    await prepareSite(a, { x: ground.x1 + Math.floor(w / 2), z: ground.z1 + Math.floor(dd / 2), width: w, depth: dd, y: kl.y, margin: 1, works: true }, signal);
    if (m.lodge && m.lodge.state !== 'ready') await furnishLodge(a, v, signal);
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
        // (to the cell first: placeStation refuses from more than 3 below it, and a lodge on the highest level ground near
        // the pad stood 4-5 above the hut where the furnaces were made, L1)
        await reach(a, new Vec3(f.x + 0.5, f.y, f.z + 0.5), 3, signal);
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

/**
 * The masons' lodge's table and chests (#163): the table set by placeStation (crafted from a log); the chests crafted at
 * it from logs withdrawn (two a chest, the monument's wood first), set in their cells by command (charged: placeStation)
 * and registered as the lodge's storage chests.
 */
async function furnishLodge(a: BotAgent, v: Village, signal: AbortSignal): Promise<void> {
  const m = v.monument!, l = m.lodge!;
  const rcon = a.world.rcon, reg = a.world.villages;
  const isAt = async (c: { x: number; y: number; z: number }, b: string) => /passed/i.test(await rcon.command(`execute if block ${c.x} ${c.y} ${c.z} minecraft:${b}`).catch(() => ''));
  // (each cell walked to first: placeStation refuses from more than 3 below it, and the lodge can stand above the hut, L1)
  const to = (c: { x: number; y: number; z: number }) => reach(a, new Vec3(c.x + 0.5, c.y, c.z + 0.5), 3, signal);
  await to(l.table);
  await placeStation(a, 'crafting_table', signal, `the ${monumentNoun(m)}'s lodge's table`, 0, false, { pos: l.table, lockKey: `${v.name}:lodge:table`, record: () => undefined });
  const missing = [];
  for (const c of l.chests) if (!(await isAt(c, 'chest'))) missing.push(c);
  const chestId = itemId(a, 'chest')!;
  const want = Math.max(0, missing.length - countItem(a, chestId));
  if (want) {
    const store = storageContents(v);
    const log = [`${m.wood || 'oak'}_log`, ...Object.keys(store).filter((n) => /^(?!stripped_).*_log$/.test(n)).sort((p, q) => store[q] - store[p])].find((n) => (store[n] ?? 0) >= 2 * want);
    if (!log) throw new Error(`build_kiln: the lodge's ${want} chests want ${2 * want} logs of one kind and storage holds none so many`);
    const got = ((await withdrawItems(a, v, { [log]: 2 * want }, signal)).got as Record<string, number>)[log] ?? 0;
    await SURVIVAL_SKILLS.craft.run(a, { item: log.replace(/_log$/, '_planks'), count: got * 4 }, signal);
    await to(l.table);
    await SURVIVAL_SKILLS.craft.run(a, { item: 'chest', count: Math.floor(got / 2) }, signal);
  }
  for (const [i, c] of missing.entries()) {
    await to(c);
    await placeStation(a, 'chest' as StationName, signal, `the lodge's chest ${i + 1}`, 0, false, { pos: c, facing: 'north', lockKey: `${v.name}:lodge:${c.x}`, record: () => undefined });
  }
  for (const c of l.chests) if (await isAt(c, 'chest')) registerLodgeChest(v, c);
  l.state = 'ready';
  reg.save();
  reg.note(v, `${a.name} set up the ${monumentNoun(m)}'s masons' lodge: a table and ${l.chests.length} chests for its yard beside the kiln`);
  console.log(`[lodge] ${v.name}: ${a.name} set the lodge's table and chests (${lodgeLine(l)})`);
}

/** tend_kiln: a lane of the kiln loaded and unloaded (see the header). */
async function tendKiln(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const m = v?.monument;
  const kl = m?.kiln;
  if (!v || !m || kl?.state !== 'ready') throw new Error('tend_kiln: the cathedral has no kiln ready');
  const lane = Math.max(1, Math.floor(num(args.lane ?? 1, 'lane')));
  const reg = a.world.villages, plan = planOf(a.world), scale = timeScale();
  const fs = laneFurnaces(kl, lane, kilnLanes(kl));
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
  // (#163, the masons' lodge: the fuel its own chests hold, their planks first (each tend's sawn logs leave some over: L2's
  // lodge held ~1,250 planks while tends walked to the hut for coal and logs); the whole storage's when they hold none)
  const lodgeStock = m.lodge?.state === 'ready' ? lodgeContents(v) : null;
  const lodgeFuel = lodgeStock && Object.entries(lodgeStock).some(([n, q]) => q > 0 && /(_log|_planks|^coal|^charcoal)$/.test(n)) ? lodgeStock : null;
  const planksTaken: Record<string, number> = {};
  let fromPlanks = 0;
  if (lodgeFuel) {
    let need = Math.ceil(((total + held) * 1.15) / 1.5);
    for (const [n, q] of Object.entries(lodgeFuel).filter(([n]) => /_planks$/.test(n)).sort((x, y) => y[1] - x[1])) {
      const k = Math.min(q, need);
      if (k <= 0) break;
      planksTaken[n] = k;
      need -= k;
      fromPlanks += k * 1.5 / 1.15;
    }
  }
  const fuel = fuelFor(lodgeFuel ?? storageContents(v), Math.max(0, Math.ceil(total + held - fromPlanks)), wood);
  if (!(total + held - fromPlanks > 0)) Object.assign(fuel, { coal: null, coalN: 0, planks: 0, logs: {} });
  if (total + held) {
    const got = (await withdrawItems(a, v, { ...load, ...planksTaken, ...(fuel.coal ? { [fuel.coal]: fuel.coalN } : {}), ...fuel.logs }, signal)).got as Record<string, number>;
    for (const input of Object.keys(load)) load[input] = Math.min(load[input], got[input] ?? 0);
    for (const log of Object.keys(fuel.logs)) {
      const n = got[log] ?? 0;
      if (n <= 0) continue;
      await SURVIVAL_SKILLS.craft.run(a, { item: log.replace(/_log$/, '_planks'), count: n * 4 }, signal).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        notes.push(`planks not sawn (${e.message.slice(0, 60)})`);
      });
      m.yard[log] = Math.max(0, (m.yard[log] ?? 0) - n);
      if (!m.yard[log]) delete m.yard[log];
    }
  }
  // 3. At the kiln: each furnace of the lane, its output taken, more loaded with its fuel
  const spread = spreadLoad(view, load).map((p) => ({ ...p, f: real(p.f) }));
  const taken: Record<string, number> = {}, loaded: Record<string, number> = {};
  // Fuel in a furnace's slot to cover what its input still needs: more of the slot's own kind, else what is carried (coal
  // or charcoal first, then planks of any kind, then logs)
  const per = (n?: string) => (n === 'coal' || n === 'charcoal' ? 8 : 1.5);
  let cold = 0;
  const carried = () => a.bot.inventory.items();
  const topUp = async (fw: Awaited<ReturnType<typeof a.bot.openFurnace>>, f: { x: number; y: number; z: number }) => {
    const inp = fw.inputItem();
    if (!inp) return;
    const inSlot = fw.fuelItem();
    // (the item burning counts at its kind's worth: one coal burning was counted as 1 smelt, and a furnace with its coal
    // was reported short of fuel, Kiln152's 14 "no more coal" notes)
    const burning = fw.fuel > 0 ? per(inSlot?.name ?? 'coal') : 0;
    const covered = (inSlot ? inSlot.count * per(inSlot.name) : 0) + burning;
    // (a furnace found cold with input to cook: a real shortfall, counted)
    if (!inSlot && !(fw.fuel > 0)) cold++;
    if (covered >= inp.count) return;
    const it = inSlot ? carried().find((i) => i.type === inSlot.type)
      : carried().find((i) => i.name === 'coal' || i.name === 'charcoal') ?? carried().find((i) => /_planks$/.test(i.name)) ?? carried().find((i) => /_log$/.test(i.name) && !KILN_SMELTS[i.name]);
    if (!it) return void notes.push(inSlot ? `no more ${inSlot.name} to add at ${f.x},${f.y},${f.z} (still burning)` : `no fuel for ${f.x},${f.y},${f.z}`);
    const n = Math.min(countItem(a, it.type), SLOT - (inSlot?.count ?? 0), Math.ceil((inp.count - covered) / per(it.name)));
    if (n > 0) await fw.putFuel(it.type, null, n);
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
    // (not with the stonecutter: the carver cuts the bricks, #162)
    const step = plan(stageBill(m, AHEAD), m.yard).steps.find((s) => s.do === 'craft' && s.item === 'stone_bricks' && !(s as { cut?: true }).cut);
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
  console.log(`[kiln] ${v.name}: ${a.name} tended lane ${lane}: loaded ${list(loaded)}, took ${list(taken)}, crafted ${bricks} stone bricks (${cold ? `${cold} found cold; ` : ''}fuel ${fuel.coal ? `${fuel.coalN} ${fuel.coal}, ` : ''}${fuel.planks} planks)${notes.length ? `; ${notes.join('; ')}` : ''}; ${kilnLine(kl, Date.now(), scale)}`);
  return `tended the cathedral's kiln (lane ${lane}): loaded ${list(loaded)}, took out ${list(taken)}${bricks ? `, crafted ${bricks} stone bricks` : ''}`;
}

/** What a lane can do now: input the stage wants smelted that the yard holds (and room for it), or output ready. */
export function laneWork(v: Village, lane: number, plan: PlanOf, now: number): { load: number; ready: number } {
  const m = v.monument!, kl = m.kiln!;
  const fs = laneFurnaces(kl, lane, kilnLanes(kl));
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
