/**
 * The cathedral's furnishing in the world (#162, tier 2's chains C-E; MC_FURNISH_*, off; furnish.ts has the recipes).
 * One chore, make_furnishing (the smith's or the weaver's): n of a furnishing piece for the yard, from what the village
 * has. Its makings from storage first; what storage lacks comes from where the game gives it: wool sheared from the
 * village's sheep (the dye for coloured wool made as the dyer makes it), honeycomb from bee nests, string and the bell
 * bought from the merchant (its emeralds raised by selling the village's spare goods when storage holds too few). Then
 * the crafts at the table in order; the chore's deposit puts the piece in the yard (mcWorld credits it).
 */
import type { Village } from '../village';
import { BELL_EMERALDS, furnishPlan } from '../furnish';
import { HOUSE_DECOR, isDecorItem } from '../houseDecor';
import { BUYS, MERCHANT_ON, OFFERS } from '../merchant';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { storageContents, withdrawItems } from './mcStorage';
import { SURVIVAL_SKILLS } from './mcSurvival';
import { ANIMAL_SKILLS } from './mcAnimals';
import { DYE_SKILLS } from './mcDyeBed';
import { FOUNDRY as TRADE } from './foundry/trade';
import { FOUNDRY as HONEY } from './foundry/honeycomb';
import { FOUNDRY as WOOL } from './foundry/wool';
import { num, str } from './mcUtil';

/** What storage holds beyond the monument's yard (the yard's goods are the cathedral's). */
function spare(v: Village): Record<string, number> {
  const out = { ...storageContents(v) };
  for (const [k, q] of Object.entries(v.monument?.yard ?? {})) if (out[k] !== undefined) out[k] = Math.max(0, out[k] - q);
  return out;
}

/** What the member carries of an item, on the server (lesson 4). */
const has = async (a: BotAgent, item: string) => (await a.world.rcon.count(a.name, item)) ?? 0;

/** Storage's spare goods the merchant buys, sold until the member carries `emeralds` (the bell's price): the good held
 *  most above a stack first, at most the offer's stock left. */
async function raiseEmeralds(a: BotAgent, v: Village, emeralds: number, signal: AbortSignal, notes: string[]): Promise<void> {
  for (let round = 0; round < 6; round++) {
    const short = emeralds - (await has(a, 'emerald'));
    if (short <= 0) return;
    const store = spare(v), m = v.merchant!;
    const pick = BUYS.map((o) => ({ o, i: OFFERS.indexOf(o) }))
      .map(({ o, i }) => ({ o, times: Math.min(o.stock - (m.uses[i] ?? 0), Math.ceil(short / o.emeralds), Math.floor(Math.max(0, (store[o.item] ?? 0) - 64) / o.n)) }))
      .filter((x) => x.times >= 1).sort((x, y) => (store[y.o.item] ?? 0) - (store[x.o.item] ?? 0))[0];
    if (!pick) return;
    await withdrawItems(a, v, { [pick.o.item]: pick.o.n * pick.times }, signal);
    const times = Math.min(pick.times, Math.floor((await has(a, pick.o.item)) / pick.o.n));
    if (times < 1) return;
    await TRADE.skill.run(a, { item: pick.o.item, dir: 'sell', times }, signal);
    notes.push(`sold ${pick.o.n * times} ${pick.o.item} for ${pick.o.emeralds * times} emeralds`);
  }
}

/** Shears in hand (from storage, else made from 2 iron ingots). */
async function shears(a: BotAgent, v: Village, signal: AbortSignal): Promise<void> {
  if (await has(a, 'shears')) return;
  await withdrawItems(a, v, { shears: 1 }, signal);
  if (await has(a, 'shears')) return;
  await withdrawItems(a, v, { iron_ingot: 2 }, signal);
  await SURVIVAL_SKILLS.craft.run(a, { item: 'shears', count: 1 }, signal);
}

async function makeFurnishing(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village(), m = v?.monument;
  const item = str(args.item, 'item');
  // (#141, MC_HOUSE_DECOR: a house decoration's chore (`decor`) makes it into storage, monument or none)
  const decor = HOUSE_DECOR && isDecorItem(item) && !!args.decor;
  if (!v || (!m && !decor)) throw new Error('make_furnishing: the village has no monument');
  const n = Math.max(1, Math.floor(num(args.count ?? 1, 'count')));
  const notes: string[] = [];
  const store = spare(v);
  const wood = `${m?.wood || v.wood || 'oak'}_planks`;
  const plan = furnishPlan(item, n, store);
  // (generic makings as the village holds them: planks of its wood or any, coal or charcoal)
  const takes: Record<string, number> = {};
  for (const [k, q] of Object.entries(plan.takes)) {
    // (no planks in storage: cut from its logs first, 4 a log; D4's banners failed on sticks with 395 logs stored)
    const log = k === 'planks' && !Object.keys(store).some((x) => /_planks$/.test(x) && store[x] >= q)
      ? [wood.replace(/_planks$/, '_log'), ...Object.keys(store).filter((x) => /_log$/.test(x))].find((x) => (store[x] ?? 0) * 4 >= q) : undefined;
    if (log) {
      takes[log] = (takes[log] ?? 0) + Math.ceil(q / 4);
      plan.crafts.unshift({ item: log.replace(/_log$/, '_planks'), makes: Math.ceil(q / 4) * 4 });
      continue;
    }
    const name = k === 'planks' ? ((store[wood] ?? 0) >= q ? wood : Object.keys(store).find((x) => /_planks$/.test(x) && store[x] >= q) ?? wood)
      : k === 'coal' && (store.coal ?? 0) < q ? 'charcoal' : k;
    takes[name] = (takes[name] ?? 0) + q;
  }
  // 1. What storage does not hold, from where the game gives it
  const beyond = (k: string) => Math.max(0, (takes[k] ?? 0) - (store[k] ?? 0));
  if (beyond('white_wool')) {
    await shears(a, v, signal);
    const hut = v.storageHut!;
    const at = WOOL.activity?.place({ village: v, agent: a, hut: { x: Math.round((hut.x1 + hut.x2) / 2), y: v.plots[0]?.y ?? 64, z: Math.round((hut.z1 + hut.z2) / 2) } });
    const said = at && !('why' in at)
      ? await WOOL.skill.run(a, { ...at, count: beyond('white_wool') }, signal)
      : await ANIMAL_SKILLS.shear_sheep.run(a, { count: beyond('white_wool'), radius: 48 }, signal);
    notes.push(String(said).slice(0, 80));
  }
  const colourDye = Object.keys(takes).find((k) => /_dye$/.test(k));
  if (colourDye && beyond(colourDye)) {
    await DYE_SKILLS.make_dye.run(a, { item: colourDye, count: beyond(colourDye) }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      notes.push(`no ${colourDye} made (${e.message.slice(0, 60)})`);
    });
  }
  if (beyond('honeycomb')) {
    await shears(a, v, signal);
    notes.push(String(await HONEY.skill.run(a, { count: Math.min(12, beyond('honeycomb')), radius: 96 }, signal)).slice(0, 80));
  }
  const buy = async (thing: string, emeralds: number, times: number) => {
    if (!MERCHANT_ON || !v.merchant) throw new Error(`make_furnishing: ${thing} is bought from the merchant, and the village has none (a market stall must stand first)`);
    await withdrawItems(a, v, { emerald: Math.max(0, emeralds - (await has(a, 'emerald'))) }, signal);
    await raiseEmeralds(a, v, emeralds, signal, notes);
    if ((await has(a, 'emerald')) < emeralds) throw new Error(`make_furnishing: ${thing} costs ${emeralds} emeralds; storage and the spare goods raised ${await has(a, 'emerald')}`);
    await TRADE.skill.run(a, { item: thing, dir: 'buy', times }, signal);
    notes.push(`bought ${thing} for ${emeralds} emeralds`);
  };
  if (beyond('string')) {
    const times = Math.ceil(beyond('string') / 2);
    await buy('string', times, times);
  }
  if (item === 'bell') {
    if (!beyond('bell')) await withdrawItems(a, v, { bell: n }, signal);
    else await buy('bell', BELL_EMERALDS * n, n);
  } else {
    // 2. The makings from storage (what is not carried), then the crafts in order
    const want: Record<string, number> = {};
    for (const [k, q] of Object.entries(takes)) {
      const short = q - (await has(a, k));
      if (short > 0) want[k] = short;
    }
    if (Object.keys(want).length) await withdrawItems(a, v, want, signal);
    for (const c of plan.crafts) await SURVIVAL_SKILLS.craft.run(a, { item: c.item, count: c.makes }, signal).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
      notes.push(`${c.item} not crafted (${e.message.slice(0, 60)})`);
    });
  }
  const made = await has(a, item);
  const forWhat = decor ? "the village's houses" : 'the monument';
  console.log(`[furnish] ${v.name}: ${a.name} made ${made} ${item} for ${forWhat}${notes.length ? ` (${notes.join('; ')})` : ''}`);
  if (made < 1) throw new Error(`make_furnishing: no ${item} made (${notes.join('; ') || 'short of its makings'})`);
  return `made ${made} ${item} for ${decor ? "the village's houses (into storage)" : "the monument's furnishing"}${notes.length ? ` (${notes.join('; ')})` : ''}`;
}

export const FURNISH_SKILLS: Record<string, McSkill> = {
  make_furnishing: { check: (x) => void str(x.item, 'item'), run: makeFurnishing },
};
