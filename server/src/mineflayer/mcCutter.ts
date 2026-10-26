/**
 * The cathedral's stonecutter in the world (#162, chain A; MC_MONUMENT_DETAIL, off; cutter.ts has its arithmetic). One
 * chore, cut_stone (the carver's): the stonecutter set at the kiln's end the first time (made at the hut's table from an
 * iron ingot and 3 of the yard's stone, placed by placeStation, lessons 29, 33, 44); then at the storage hut a load of
 * the yard's stone and quarried stones the stage's plan wants cut (cutWants, at most CUT_LOAD); at the stonecutter each
 * cut charged by command (counted, cleared, given: the crafts' way, mcSurvival's doCraft, since mineflayer's stonecutter
 * window is not driven); back at the hut everything deposited. The yard's ledger moves with what was really cut.
 */
import { Vec3 } from 'vec3';
import type { Monument, Village, StationName } from '../village';
import { CUTTER, type CutterRecord, applyCuts, cutInputs, cutLine, cutLoad, cutWants, cutterCell, type Cut, type CutStep } from '../cutter';
import { MONUMENT, stageBill, AHEAD } from '../monument';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { kilnOn, planOf } from './mcKiln';
import { STORAGE_SKILLS, withdrawItems } from './mcStorage';
import { SURVIVAL_SKILLS, placeStation } from './mcSurvival';
import { countItem, itemId, reach } from './mcUtil';

type MonumentT2 = Monument & { cutter?: CutterRecord; detail?: boolean };
const t2 = (m: Monument) => m as MonumentT2;

/** Whether a village's cathedral is cut at a stonecutter now (the flag and the kiln's own conditions, a kiln ready). */
export function cutterOn(v: Village | undefined): boolean {
  return CUTTER.on && MONUMENT.palette === 'full' && kilnOn(v) && !!t2(v!.monument!).detail && v!.monument!.kiln?.state === 'ready';
}

/** What the stage wants cut that the yard holds (for the menu: a carver's load ready). */
export function cutWork(v: Village, plan: ReturnType<typeof planOf>): Cut[] {
  const m = v.monument!;
  return cutWants(plan(stageBill(m, AHEAD), m.yard).steps as CutStep[], m.yard);
}

/** The stonecutter set at its cell if it is not there (made from the yard's stone and an iron ingot from storage). */
async function ensureCutter(a: BotAgent, v: Village, m: MonumentT2, signal: AbortSignal): Promise<{ x: number; y: number; z: number }> {
  const cell = cutterCell(m.kiln!);
  const rcon = a.world.rcon;
  if (/passed/i.test(await rcon.command(`execute if block ${cell.x} ${cell.y} ${cell.z} minecraft:stonecutter`).catch(() => ''))) {
    m.cutter ??= { ...cell, at: Date.now(), by: a.name, loads: 0, made: {} };
    return cell;
  }
  if (!countItem(a, itemId(a, 'stonecutter')!)) {
    await withdrawItems(a, v, { iron_ingot: 1, stone: 3 }, signal);
    await SURVIVAL_SKILLS.craft.run(a, { item: 'stonecutter', count: 1 }, signal);
    m.yard.stone = Math.max(0, (m.yard.stone ?? 0) - 3);
    if (!m.yard.stone) delete m.yard.stone;
  }
  // (placeStation sets any station block by name in a given cell; the stonecutter is not one of the hut's two)
  await placeStation(a, 'stonecutter' as StationName, signal, 'the cathedral\'s stonecutter', 0, false, {
    pos: cell, facing: 'north', lockKey: `${v.name}:cutter`, record: () => undefined,
  });
  m.cutter = { ...cell, at: Date.now(), by: a.name, loads: m.cutter?.loads ?? 0, made: m.cutter?.made ?? {} };
  a.world.villages.note(v, `${a.name} set up the cathedral's stonecutter beside its kiln`);
  console.log(`[cutter] ${v.name}: ${a.name} set the stonecutter at ${cell.x},${cell.y},${cell.z}`);
  return cell;
}

/** cut_stone: a load of the yard's stone cut at the stonecutter (see the header). */
async function cutStone(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const m = v?.monument as MonumentT2 | undefined;
  if (!v || !m || !cutterOn(v)) throw new Error('cut_stone: the cathedral has no stonecutter work (no kiln ready, or MC_MONUMENT_DETAIL off)');
  const reg = a.world.villages, rcon = a.world.rcon;
  const cell = await ensureCutter(a, v, m, signal);
  reg.save();
  // 1. The load: what the stage wants cut that the yard holds, from storage
  const plan = planOf(a.world);
  let load = cutLoad(cutWork(v, plan));
  if (!load.length) return 'the cathedral has nothing to cut now (the kiln\'s stone is not out yet)';
  const got = (await withdrawItems(a, v, cutInputs(load), signal)).got as Record<string, number>;
  // (what storage gave: each input's cuts cut down to it, in order)
  const left = { ...got };
  load = load.map((c) => {
    const runs = Math.min(c.runs, Math.max(0, left[c.input] ?? 0));
    left[c.input] = (left[c.input] ?? 0) - runs;
    return { ...c, runs, makes: Math.round((c.makes / c.runs) * runs) };
  }).filter((c) => c.runs > 0);
  // 2. At the stonecutter: each cut charged by command (counted first, so a lost answer is settled, E.1)
  await reach(a, new Vec3(cell.x + 0.5, cell.y, cell.z + 0.5), 2.5, signal, 60000);
  const block = a.bot.blockAt(new Vec3(cell.x, cell.y, cell.z));
  if (block?.name !== 'stonecutter') throw new Error(`cut_stone: no stonecutter at ${cell.x},${cell.y},${cell.z}`);
  const done: Cut[] = [];
  const notes: string[] = [];
  for (const c of load) {
    if (signal.aborted) throw new Error('cancelled');
    const have = await rcon.count(a.name, c.input);
    const runs = Math.min(c.runs, have);
    if (runs <= 0) { notes.push(`no ${c.input} carried`); continue; }
    const took = await rcon.take(a.name, c.input, runs, have);
    if (took <= 0) continue;
    const makes = Math.round((c.makes / c.runs) * took);
    await rcon.give(a.name, c.item, makes);
    done.push({ ...c, runs: took, makes });
  }
  applyCuts(m.yard, done);
  const rec = m.cutter!;
  rec.loads++;
  for (const c of done) rec.made[c.item] = (rec.made[c.item] ?? 0) + c.makes;
  reg.save();
  // 3. Back at the hut: everything deposited (the cathedral's stone kept from the bulk cap, as the kiln's)
  const was = a.memory.monumentGather;
  a.memory.monumentGather = 'stone';
  try {
    await STORAGE_SKILLS.deposit.run(a, { item: 'all' }, signal).catch((e: Error) => {
      if (!/^not carrying anything/.test(e.message)) throw e;
    });
  } finally {
    if (was === undefined) delete a.memory.monumentGather;
    else a.memory.monumentGather = was;
  }
  const line = done.length ? cutLine(done) : 'nothing';
  console.log(`[cutter] ${v.name}: ${a.name} cut ${line}${notes.length ? `; ${notes.join('; ')}` : ''}; ${rec.loads} loads, made ${Object.entries(rec.made).map(([n, q]) => `${q} ${n}`).join(', ')}`);
  return `cut ${line} at the cathedral's stonecutter`;
}

export const CUTTER_SKILLS: Record<string, McSkill> = {
  cut_stone: { run: cutStone },
};
