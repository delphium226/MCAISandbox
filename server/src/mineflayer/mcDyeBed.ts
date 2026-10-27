/**
 * The monument's dyes in the world (#162, chain B; MC_DYE_BED, off; dyeBed.ts has its arithmetic). One chore, make_dye
 * (the dyer's): n of a dye for the cathedral's windows, made from what the village has. Its plan against storage (the
 * world's Materials: dyes from flowers, lapis, bone meal and mixes) says what is short; bone meal comes from the dye
 * bed's composter (storage's spare seeds and wheat put in by command, the chance a level by code: compost()), tall
 * flowers from the bed (bone meal used on each flower drops a copy: charged by command, the flower's block checked there,
 * lesson 29), other flowers from collect; then the plan's crafts at the hut's table, mixes after what they take. The bed
 * (a row of tall flowers the dyer brings and a composter at its end, beside the storage hut, chosen as the kiln's strip
 * is) is built by the first make_dye that needs it. The chore's deposit puts the dye in the yard (mcWorld credits it).
 */
import { Vec3 } from 'vec3';
import type { Monument, Village, StationName } from '../village';
import { VILLAGE_RANGE, areaText } from '../village';
import { DYE_BED, DYE_MIN, TALL_FLOWERS, bedKinds, dyeSteps, dyeYields, bedLine, bedStrip, compost, compostable, newBed, type DyeBed } from '../dyeBed';
import { searchQuarry } from '../quarry';
import { monumentNoun, siteTaken } from '../monument';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { mineAreas } from './mcMine';
import { storageContents, withdrawItems } from './mcStorage';
import { SURVIVAL_SKILLS, placeStation } from './mcSurvival';
import { prepareSite, surfaceAt, withScanTurn } from './mcBuild';
import { num, reach, str } from './mcUtil';

type MonumentT2 = Monument & { dyeBed?: DyeBed; dyeBedBackoff?: number };
/** Villages whose bed is being built (one builder at a time). */
const building = new Set<string>();
/** Whether another member is building the village's bed now (the menu leaves the dyes off meanwhile: T2a's 10 dye
 *  chores ended at once on it). */
export const bedBuilding = (v: Village) => building.has(v.name);
/** Minutes a village goes without trying a bed again after none fitted. */
const BED_BACKOFF_MIN = 10;

/** Whether a village's cathedral makes its dyes (the flag and a cathedral under way). */
export function dyeBedOn(v: Village | undefined): boolean {
  return DYE_BED.on && !!v?.monument && v.monument.state === 'building';
}

const passed = async (a: BotAgent, cmd: string) => /passed/i.test(await a.world.rcon.command(cmd).catch(() => ''));

/** The bed built if it is not: its strip chosen and prepared, its flowers (from storage, else picked) set by command on
 *  grass, its composter made and placed. */
async function ensureBed(a: BotAgent, v: Village, m: MonumentT2, census: Record<string, number>, signal: AbortSignal): Promise<DyeBed> {
  if (m.dyeBed?.state === 'ready') return m.dyeBed;
  if (building.has(v.name)) throw new Error('make_dye: the dye bed is being built by another member');
  building.add(v.name);
  const reg = a.world.villages, rcon = a.world.rcon;
  try {
    if (!m.dyeBed) {
      const kinds = bedKinds(census);
      if (!kinds.length) throw new Error('make_dye: no tall flowers (rose bush, peony, lilac, sunflower) grow near the village for a dye bed');
      const { w, d } = bedStrip(kinds.length);
      const hut = v.storageHut, s = m.site!;
      const hutAt = hut ? { x: Math.round((hut.x1 + hut.x2) / 2), z: Math.round((hut.z1 + hut.z2) / 2) } : { x: s.x1, z: s.z1 };
      const takenAt = siteTaken(v, [...reg.villages.values()].filter((o) => o !== v), v.mine ? mineAreas(v.mine) : [], Date.now(), a.name);
      // (within 64 of the hut, as the kiln, then 96: T2a found none within 48 of iron_age_g1's crowded centre)
      let found: ReturnType<typeof searchQuarry> = null;
      for (const range of [64, 96]) {
        found = await withScanTurn(signal, () => searchQuarry({
          side: w, depthSide: d, center: hutAt, hut: hutAt, range: Math.min(VILLAGE_RANGE - 8, range),
          ground: (x, z) => {
            const c = surfaceAt(a, x, z, s.y);
            return !c || c.liquid || c.block === 'air' ? null : { y: c.y, trees: c.trees };
          },
          takenAt,
        }));
        if (found) break;
      }
      if (!found) {
        m.dyeBedBackoff = Date.now() + BED_BACKOFF_MIN * 60000;
        reg.save();
        throw new Error(`make_dye: no level ground for a ${w}x${d} dye bed within 96 of the storage hut`);
      }
      m.dyeBed = newBed(found.area, found.y, kinds, a.name, Date.now());
      const id = reg.id('s');
      v.structures.push({ id, ...found.area, y: found.y, kind: 'dye_bed', builtBy: a.name });
      m.dyeBed.structure = id;
      reg.save();
      console.log(`[dyebed] ${v.name}: ${a.name} chose the dye bed at ${areaText(found.area)} y=${found.y} for ${kinds.join(', ')}`);
    }
    const bed = m.dyeBed;
    await prepareSite(a, { x: bed.x1 + Math.floor((bed.x2 - bed.x1) / 2), z: bed.z1 + 1, width: bed.x2 - bed.x1 + 1, depth: bed.z2 - bed.z1 + 1, y: bed.y, margin: 1, works: true }, signal);
    // The flowers: each kind from storage, else picked where it grows; set on grass by command, charged
    const want: Record<string, number> = {};
    for (const c of bed.cells) if (!(await passed(a, `execute if block ${c.x} ${bed.y + 1} ${c.z} minecraft:${c.kind}`))) want[c.kind] = (want[c.kind] ?? 0) + 1;
    if (Object.keys(want).length) {
      await withdrawItems(a, v, want, signal);
      for (const [kind, q] of Object.entries(want)) {
        const have = await rcon.count(a.name, kind);
        if (have < q) await SURVIVAL_SKILLS.collect.run(a, { block: kind, count: q - have }, signal).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
        });
      }
      for (const c of bed.cells) {
        if (await passed(a, `execute if block ${c.x} ${bed.y + 1} ${c.z} minecraft:${c.kind}`)) continue;
        const have = await rcon.count(a.name, c.kind);
        if (have < 1 || (await rcon.take(a.name, c.kind, 1, have)) < 1) continue;
        await rcon.command(`setblock ${c.x} ${bed.y} ${c.z} minecraft:grass_block`);
        await rcon.command(`setblock ${c.x} ${bed.y + 2} ${c.z} minecraft:${c.kind}[half=upper]`);
        await rcon.command(`setblock ${c.x} ${bed.y + 1} ${c.z} minecraft:${c.kind}[half=lower]`);
      }
    }
    // The composter: made (from planks' slabs) and set at the row's end
    const k = bed.composter;
    if (!(await passed(a, `execute if block ${k.x} ${k.y} ${k.z} minecraft:composter`))) {
      if (!(await rcon.count(a.name, 'composter'))) await makeItem(a, v, 'composter', 1, signal);
      await placeStation(a, 'composter' as StationName, signal, 'the dye bed\'s composter', 0, false, { pos: k, lockKey: `${v.name}:dyebed:composter`, record: () => undefined });
    }
    const planted = [];
    for (const c of bed.cells) if (await passed(a, `execute if block ${c.x} ${bed.y + 1} ${c.z} minecraft:${c.kind}`)) planted.push(c.kind);
    if (!planted.length) throw new Error('make_dye: the dye bed has no flowers yet (none in storage, none picked)');
    bed.state = 'ready';
    reg.save();
    reg.note(v, `${a.name} planted a dye bed of ${planted.join(', ')} for the ${monumentNoun(m)}'s glass`);
    console.log(`[dyebed] ${v.name}: ${a.name} built the dye bed (${bedLine(bed)})`);
    return bed;
  } finally {
    building.delete(v.name);
  }
}

/** n of an item made from storage: its plan's stock withdrawn and its crafts done in order (ingredients first). */
async function makeItem(a: BotAgent, v: Village, item: string, n: number, signal: AbortSignal): Promise<void> {
  const p = a.world.materials.plan({ [item]: n }, storageContents(v));
  const raw = Object.fromEntries(Object.entries(p.fromStock).filter(([k]) => !k.startsWith('any:')));
  if (Object.keys(raw).length) await withdrawItems(a, v, raw, signal);
  for (const st of p.steps) {
    if (st.do !== 'craft') continue;
    await SURVIVAL_SKILLS.craft.run(a, { item: st.item === 'any:planks' ? 'planks' : st.item, count: st.makes }, signal);
  }
}

/** Bone meal from the composter: storage's spare seeds and crops put in (by command) until `n` are made or they run out. */
async function makeBoneMeal(a: BotAgent, v: Village, bed: DyeBed, n: number, signal: AbortSignal): Promise<number> {
  const rcon = a.world.rcon;
  const spare = compostable(storageContents(v));
  // (about 7 / 0.3 seeds a bone meal, a fifth over for the chance)
  const want: Record<string, number> = {};
  let need = n * 7 * 1.2;
  for (const [item, q] of Object.entries(spare).sort((x, y) => (y[0] === 'wheat_seeds' ? 1 : 0) - (x[0] === 'wheat_seeds' ? 1 : 0))) {
    if (need <= 0) break;
    const chance = item.endsWith('_seeds') ? 0.3 : 0.65;
    const t = Math.min(q, 192, Math.ceil(need / chance));
    want[item] = t;
    need -= t * chance;
  }
  if (!Object.keys(want).length) return 0;
  await withdrawItems(a, v, want, signal);
  await reach(a, new Vec3(bed.composter.x + 0.5, bed.composter.y, bed.composter.z + 0.5), 2.5, signal, 60000);
  if (!(await passed(a, `execute if block ${bed.composter.x} ${bed.composter.y} ${bed.composter.z} minecraft:composter`))) throw new Error('make_dye: the dye bed has no composter');
  const carried: Record<string, number> = {};
  for (const item of Object.keys(want)) carried[item] = await rcon.count(a.name, item);
  // (put in one at a time until n are made, as a player would: the ledger's level carries over between visits)
  let made = 0;
  const used: Record<string, number> = {};
  for (const [item, q] of Object.entries(carried)) {
    for (let i = 0; i < q && made < n; i++) {
      const r = compost(bed, { [item]: 1 });
      used[item] = (used[item] ?? 0) + 1;
      made += r.boneMeal;
    }
  }
  for (const [item, q] of Object.entries(used)) await rcon.take(a.name, item, q, carried[item]);
  if (made) await rcon.give(a.name, 'bone_meal', made);
  bed.made.bone_meal = (bed.made.bone_meal ?? 0) + made;
  a.world.villages.save();
  console.log(`[dyebed] ${v.name}: ${a.name} composted ${Object.entries(used).map(([k, q]) => `${q} ${k}`).join(', ')} into ${made} bone meal (level ${bed.level}/7)`);
  return made;
}

/** Tall flowers from the bed: bone meal used on each flower of a kind, a copy for each (the flower checked there). */
async function tendBed(a: BotAgent, v: Village, bed: DyeBed, want: Record<string, number>, signal: AbortSignal): Promise<Record<string, number>> {
  const rcon = a.world.rcon;
  const got: Record<string, number> = {};
  for (const [kind, q] of Object.entries(want)) {
    const cells = bed.cells.filter((c) => c.kind === kind);
    if (!cells.length) continue;
    for (let i = 0; (got[kind] ?? 0) < q && i < q * 2; i++) {
      if (signal.aborted) throw new Error('cancelled');
      const c = cells[i % cells.length];
      await reach(a, new Vec3(c.x + 0.5, bed.y + 1, c.z + 0.5), 3, signal, 60000);
      if (!(await passed(a, `execute if block ${c.x} ${bed.y + 1} ${c.z} minecraft:${kind}`))) continue;
      const bm = await rcon.count(a.name, 'bone_meal');
      if (bm < 1) return got;
      if ((await rcon.take(a.name, 'bone_meal', 1, bm)) < 1) return got;
      await rcon.give(a.name, kind, 1);
      got[kind] = (got[kind] ?? 0) + 1;
    }
  }
  bed.tends++;
  for (const [k, q] of Object.entries(got)) bed.made[k] = (bed.made[k] ?? 0) + q;
  a.world.villages.save();
  return got;
}

/** make_dye: n of a dye made for the monument (see the header); the chore's deposit takes it to the yard. */
async function makeDye(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  const m = v?.monument as MonumentT2 | undefined;
  // (#162 D: also once the cathedral stands, for the furnishing's coloured banners)
  if (!v || !m || !(dyeBedOn(v) || DYE_BED.on && m.state === 'built')) throw new Error('make_dye: the village has no monument wanting dyes (or MC_DYE_BED is off)');
  const item = str(args.item, 'item');
  if (!/_dye$/.test(item)) throw new Error(`make_dye: ${item} is not a dye`);
  const n = Math.max(1, Math.floor(num(args.count ?? 1, 'count')));
  const census = a.world.dyeCounts(v, a);
  const notes: string[] = [];
  // 1. The dye's plan (dyeSteps: lapis, bone meal and the flowers to be had; mixes): what it takes beyond the stock is
  // made first: bone meal at the composter, tall flowers from the bed, other flowers picked where they grow
  // (storage less what the yard holds: T2c's dyers took the yard's red dye for their orange and purple, and the glass job
  // then found none)
  const free = () => {
    const out = { ...storageContents(v) };
    for (const [k, q] of Object.entries(m.yard)) if (out[k] !== undefined) out[k] = Math.max(0, out[k] - q);
    return out;
  };
  const real = () => sum(free(), countsCarried(a));
  // (no bed while one failed to fit lately: then the tall flowers are picked where they grow, as the others, and bone meal
  // is only what storage holds)
  const bedUp = m.dyeBed?.state === 'ready' || (!args.noBed && (m.dyeBedBackoff ?? 0) <= Date.now());
  const bedFlowers = bedUp ? m.dyeBed?.cells.map((c) => c.kind) ?? bedKinds(census) : [];
  const wild = Object.keys(census).filter((k) => (census[k] ?? 0) >= (TALL_FLOWERS.includes(k) ? 1 : DYE_MIN) && !bedFlowers.includes(k));
  const renew = new Set([...(bedUp ? ['bone_meal'] : []), ...bedFlowers, ...wild]);
  let have = real();
  const plan = dyeSteps(dyeYields(a.world.registry), item, n, have, renew);
  if (!plan) throw new Error(`make_dye: ${item} cannot be made here (no flower, lapis, bone meal or mix for it; lapis comes from the mine, ink sacs from the merchant)`);
  const beyond = (k: string) => Math.max(0, (plan.takes[k] ?? 0) - (have[k] ?? 0));
  const tall: Record<string, number> = {};
  for (const k of new Set(bedFlowers)) if (beyond(k)) tall[k] = beyond(k);
  const bmNeed = beyond('bone_meal') + Object.values(tall).reduce((t, q) => t + q, 0);
  if (bmNeed) {
    let bed: DyeBed;
    try {
      bed = await ensureBed(a, v, m, census, signal);
    } catch (e) {
      // (none fits: this chore goes on without a bed, the tall flowers picked where they grow)
      if (/no level ground/.test((e as Error).message) && !args.noBed) return makeDye(a, { ...args, noBed: true }, signal);
      throw e;
    }
    const bmHave = await a.world.rcon.count(a.name, 'bone_meal');
    if (bmNeed > bmHave) {
      await withdrawItems(a, v, { bone_meal: bmNeed - bmHave }, signal);
      const still = bmNeed - (await a.world.rcon.count(a.name, 'bone_meal'));
      if (still > 0 && !(await makeBoneMeal(a, v, bed, still, signal))) notes.push('no seeds or crops to spare for the composter');
    }
    if (Object.keys(tall).length) {
      const got = await tendBed(a, v, bed, tall, signal);
      notes.push(`the bed gave ${Object.entries(got).map(([k, q]) => `${q} ${k}`).join(', ') || 'nothing'}`);
    }
  }
  for (const k of wild) if (beyond(k)) await SURVIVAL_SKILLS.collect.run(a, { block: k, count: beyond(k) }, signal);
  // 2. The base items from storage (what is not carried), then the crafts in order, mixes after what they take
  have = real();
  const carried = countsCarried(a);
  const fromStore: Record<string, number> = {};
  for (const [k, q] of Object.entries(plan.takes)) if (q - (carried[k] ?? 0) > 0) fromStore[k] = q - (carried[k] ?? 0);
  if (Object.keys(fromStore).length) await withdrawItems(a, v, fromStore, signal);
  for (const c of plan.crafts) await SURVIVAL_SKILLS.craft.run(a, { item: c.item, count: c.makes }, signal).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
    notes.push(`${c.item} not crafted (${e.message.slice(0, 60)})`);
  });
  const made = await a.world.rcon.count(a.name, item);
  console.log(`[dyebed] ${v.name}: ${a.name} made ${made} ${item} for the monument${notes.length ? ` (${notes.join('; ')})` : ''}${m.dyeBed ? `; ${bedLine(m.dyeBed)}` : ''}`);
  if (made < 1) throw new Error(`make_dye: no ${item} made (${notes.join('; ') || 'short of its makings'})`);
  return `made ${made} ${item} for the monument's glass${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

/** Two counts added. */
const sum = (x: Record<string, number>, y: Record<string, number>) => {
  const out = { ...x };
  for (const [k, q] of Object.entries(y)) out[k] = (out[k] ?? 0) + q;
  return out;
};

/** What the member carries, by name. */
function countsCarried(a: BotAgent): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of a.bot.inventory.items()) out[it.name] = (out[it.name] ?? 0) + it.count;
  return out;
}

export const DYE_SKILLS: Record<string, McSkill> = {
  make_dye: { check: (x) => void str(x.item, 'item'), run: makeDye },
};
