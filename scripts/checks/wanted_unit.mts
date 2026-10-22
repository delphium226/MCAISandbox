/**
 * G6's wanted list and locked foundry activities, offline (spec runs/2026-10-21/g6-loop/spec.md): the list from the real
 * recipe data (26.1) and the mv3_grown25 checkpoint's record (flowers first, honeycomb ticketable, the dead, the user's call and
 * the knowledge gaps in their tiers, wool a skill without an activity); demand terms from a lapsed want, an expired order
 * and a need with no answer; a library spec's research block validated, registered as a locked entry, offered as demanded
 * while it is among the wanted top 3, and its activity answering "locked" until the village unlocks it; with
 * MC_INNOVATE off the spec stays out of the library (a child process).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/wanted_unit.mts
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import minecraftData from 'minecraft-data';
import { Materials } from '../../server/src/mineflayer/mcMaterials';
import type { Village } from '../../server/src/village';

const reg = minecraftData('26.1');
// (a library folder with one research spec, for both halves)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-wanted-'));
const spec = {
  id: 'lib:honeycomb', name: 'Harvest honeycomb from bee nests', skill: 'fish', count: { arg: 'count', max: 6 }, needs: { shears: 1 }, gives: [{ item: 'honeycomb' }], keep: 16,
  effect: 'honeycomb for beehives',
  research: { name: 'harvesting honeycomb from bee nests', requires: { shears: 1 }, attempt: { torch: 2 }, minutes: 3, chance: 0.3, complexity: 4, capability: 'honeycomb',
    goods: [{ item: 'beehive', target: 2, batch: 1, unit: 1, words: 'beehives', forWhat: 'beehives from honeycomb', allow: ['honeycomb'] }] },
};
fs.writeFileSync(path.join(dir, 'honeycomb.json'), JSON.stringify(spec));

if (process.argv[2] === '--off') {
  // (the child: MC_INNOVATE off keeps a research spec out of the specs, in `locked`, never dropped)
  const { loadLibrary } = await import('../../server/src/library');
  const { LIBRARY } = await import('../../server/src/tech');
  const lib = loadLibrary(reg, new Set(['fish']), process.argv[3]);
  console.log(JSON.stringify({ specs: lib.specs.length, dropped: lib.dropped.length, locked: lib.locked, entry: LIBRARY.some((e) => e.id === 'honeycomb') }));
  process.exit(0);
}

process.env.MC_INNOVATE = 'on';
process.env.MC_LADDER = 'on';
const { loadLibrary, validateLibrarySpec } = await import('../../server/src/library');
const { LIBRARY, LOCKED_SKILLS, RUNG_SKILLS, WANTED_TOP, candidates, complexity, techOf } = await import('../../server/src/tech');
const { wantedList, topWanted, recordTop, rungNeeds, RUNG_NEEDS, RUNGS } = await import('../../server/src/wanted');
const { locked } = await import('../../server/src/mineflayer/foundry/lock');

const m = new Materials(reg);
const plan = (b: Record<string, number>) => m.plan(b);
let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};
const ctx = { items: reg.itemsArray.map((it) => it.name), plan, skills: new Set(['shear_sheep', 'fish', 'trade']), activitySkills: new Set(['fish', 'trade']), now: Date.now() };

// The list on the checkpoint's record
const rec = JSON.parse(fs.readFileSync('mc/testcheckpoints/mv3_grown25/villages.json', 'utf8')) as { villages: Village[] };
const v0 = rec.villages[0];
const list = wantedList(v0, ctx);
const by = (id: string) => list.find((w) => w.id === id)!;
console.log(`  top: ${list.slice(0, 4).map((w) => `${w.id} ${w.status} ${w.rank}`).join(', ')}`);
// (10-22: flowers are no knowledge gap now; without their activity loaded they are missing, their value the dyes, glass and
// coloured wool they open, first; honeycomb next and ticketable)
ok(list[0].id === 'flowers' && list[0].value > by('honeycomb').value, `flowers first, by what dyes open (got ${list[0].id})`);
ok(by('honeycomb').ticketable && by('honeycomb').status === 'missing', 'honeycomb missing and ticketable');
ok(by('flowers').unlocks.includes('red_dye') && by('flowers').unlocks.includes('yellow_stained_glass') && by('flowers').unlocks.includes('yellow_concrete_powder'), 'flowers open dyes, stained glass and concrete powder');
ok(!list.some((w) => w.id === 'terracotta' || w.id === 'green_dye'), 'terracotta and green dye are gathered and smelted now, no rows');
ok(by('honeycomb').unlocks.length >= 15 && by('honeycomb').simplest.includes('beehive'), 'honeycomb opens the waxed copper and beehives');
ok(by('quartz').status === 'dead' && by('leather').status === 'user' && by('dripstone').status === 'knowledge', 'dead, user and knowledge statuses');
ok(by('wool').status === 'skill' && by('wool').ticketable && by('wool').activitySkill === 'shear_sheep_at', 'wool: a skill without an activity, ticketable as shear_sheep_at (#91)');
ok(by('amethyst').ticketable && by('amethyst').tool === 'stone_pickaxe' && (by('amethyst').avoid ?? []).includes('budding_amethyst'), 'amethyst: ticketable by the mine template, budding amethyst avoided');
ok(list.findIndex((w) => w.status === 'dead') > list.findIndex((w) => w.status === 'knowledge'), 'the dead after the knowledge gaps');
ok(topWanted(list)[0] === 'flowers' && topWanted(list).includes('honeycomb'), 'topWanted');
const h = recordTop(recordTop(undefined, list, 1), list, 2);
ok(h.samples === 2 && h.top.honeycomb.samples === 2 && h.top.honeycomb.first === 1 && h.top.honeycomb.last === 2, 'persistence record');

// Demand terms: a lapsed want for a yield, an expired order for an unlocked item, a need with no answer it serves
{
  const v = structuredClone(v0) as Village & { board?: unknown; merchant?: unknown };
  (v as unknown as { board: unknown }).board = { offers: [{ id: 'o1', by: 'Ada', give: 'bread', giveN: 2, want: 'honeycomb', wantN: 3, at: 0, state: 'lapsed', endAt: ctx.now - 60000 }], factor: {}, n: 1, posted: 1, taken: 0, lapsed: 1, traded: {} };
  (v as unknown as { merchant: unknown }).merchant = { ...((v0 as unknown as { merchant?: object }).merchant ?? {}), orders: [{ item: 'beehive', state: 'expired' }] };
  v.needStates = { light: { level: 0.8, amount: 5, aboveMs: 1e6, lastFallMs: 1e6, offeredSweeps: 0, status: 'no answer' } } as never;
  const w = wantedList(v, ctx).find((x) => x.id === 'honeycomb')!;
  ok(w.why.some((y) => /lapsed barter want/.test(y)) && w.why.some((y) => /merchant order/.test(y)), `want and order demand (${w.why.join(' | ')})`);
  ok(w.demand >= by('honeycomb').demand + 4, `demand rises (${w.demand} vs ${by('honeycomb').demand})`);
}

// #89: life-goal wishes the village cannot answer count for the capability that would (each member once)
{
  const v = structuredClone(v0) as Village & { goals?: unknown };
  (v as unknown as { goals: unknown }).goals = { of: { Ada: 'home', Ben: 'beauty', Clara: 'mastery', Dev: 'wealth' }, drawnFor: 4, at: 0, stats: {} };
  const l = wantedList(v, ctx);
  const wool = l.find((x) => x.id === 'wool')!, am = l.find((x) => x.id === 'amethyst')!;
  ok(wool.why.some((y) => /2 members wish for/.test(y)) && wool.demand === by('wool').demand + 1, `wool: Ada and Ben wish (${wool.why.join(' | ')})`);
  ok(am.demand === by('amethyst').demand + 0.5 && am.why.some((y) => /spyglass/.test(y)), 'amethyst: Clara wishes for a spyglass');
  ok(wool.demandShare > by('wool').demandShare && wool.demandShare <= 1, `demand share rises (${by('wool').demandShare} -> ${wool.demandShare})`);
  // (a wish the member's own chest answers is met; wealth's emeralds come from no missing capability)
  (v as unknown as { goals: { of: Record<string, string> } }).goals.of = { Ada: 'mastery' };
  v.homes = { ...(v.homes ?? {}), Ada: { owed: {}, got: {}, used: {}, chest: { x: 0, y: 0, z: 0, items: { spyglass: 1, compass: 1, clock: 1 } } } as never };
  ok(!wantedList(v, ctx).find((x) => x.id === 'amethyst')!.why.some((y) => /wish/.test(y)), 'a wish its own chest answers is met');
}

// #90: G5's proposals naming a capability: +1 an open one, +2 an accepted one, its proposers and backers counted
{
  const props = [
    { by: 'Ada', status: 'open', target: { capability: 'amethyst' }, endorsements: [{ by: 'Ben' }] },
    { by: 'Clara', status: 'accepted', target: { capability: 'amethyst' }, endorsements: [] },
    { by: 'Dev', status: 'rejected', target: { capability: 'amethyst' }, endorsements: [] },
    { by: 'Elena', status: 'open', target: { capability: 'mud' } },
  ];
  const l = wantedList(v0, { ...ctx, proposals: props });
  const am = l.find((x) => x.id === 'amethyst')!;
  ok(am.demand === by('amethyst').demand + 3 && am.why.some((y) => /3 members proposed or backed it \(2 proposals, 1 accepted\)/.test(y)), `amethyst: an open and an accepted proposal (${am.why.join(' | ')})`);
  ok(l.find((x) => x.id === 'mud')!.demand === by('mud').demand + 1, 'mud: one open proposal');
}

// G8's ladder (MC_LADDER): a rung's needs only while it is chosen (+3) or offered (+1); hand needs shown, never ticketable
{
  ok(!list.some((w) => ['cast_obsidian', 'barter_piglin', 'deep_mine', 'enchant'].includes(w.id)), 'no ladder state: no rung needs on the list');
  const v = structuredClone(v0) as Village & { ladder?: unknown };
  (v as unknown as { ladder: unknown }).ladder = { current: 'enchantment', offered: ['nether'] };
  const l = wantedList(v, ctx);
  const ob = l.find((w) => w.id === 'cast_obsidian'), en = l.find((w) => w.id === 'enchant'), pg = l.find((w) => w.id === 'barter_piglin'), nt = l.find((w) => w.id === 'nether_travel');
  ok(!!ob && ob.status === 'missing' && ob.ticketable && ob.demand >= 3 && ob.ladder?.rung === 'enchantment' && ob.ladder.chosen && ob.why.some((y) => /chosen rung/.test(y)), `the chosen rung's ticket need, +3 (${JSON.stringify(ob && { s: ob.status, d: ob.demand, why: ob.why })})`);
  ok(!!en && en.status === 'hand' && !en.ticketable && /hand build/.test(en.reason ?? ''), 'its hand need shown with why, never ticketable');
  ok(!!pg && pg.demand >= 1 && pg.demand < 3 && pg.ladder?.chosen === false && !pg.ticketable, "an offered rung's need, +1 (no template for use_on_entity yet)");
  ok(!!nt && nt.status === 'hand', "the offered rung's hand need too");
  ok(!l.some((w) => w.id === 'deep_mine'), 'a rung neither chosen nor offered: none of its needs');
  ok(RUNGS.length === 8 && RUNG_NEEDS.iron.length === 0 && RUNG_NEEDS.trade.length === 0, 'eight rungs; iron and trade need nothing');
  const rn = rungNeeds('enchantment', ctx);
  ok(rn.length === 2 && rn.find((n) => n.capability === 'cast_obsidian')?.status === 'missing' && rn.find((n) => n.capability === 'enchant')?.status === 'hand', `rungNeeds with live status (${JSON.stringify(rn.map((n) => [n.capability, n.status]))})`);
  ok(RUNGS.every((r) => RUNG_NEEDS[r].every((n) => !!n.note)), 'every need has a note');
}

// The research spec: valid; broken research blocks named
ok(validateLibrarySpec(spec as never, { registry: reg, skills: new Set(['fish']) }).length === 0, 'a research spec is valid');
const bad = validateLibrarySpec({ ...spec, research: { ...spec.research, goods: [], complexity: 99, requires: { nothing_here: 1 } } } as never, { registry: reg, skills: new Set(['fish']) });
ok(bad.some((e) => /goods/.test(e)) && bad.some((e) => /complexity/.test(e)) && bad.some((e) => /nothing_here/.test(e)), `broken research named (${bad.join('; ')})`);

// Registered as a locked entry by loadLibrary (MC_INNOVATE on)
const lib = loadLibrary(reg, new Set(['fish']), dir);
const e = LIBRARY.find((x) => x.id === 'honeycomb');
ok(lib.specs.length === 1 && !lib.locked.length && !!e && e.activity === 'lib:honeycomb' && LOCKED_SKILLS.get('fish') === e, 'loadLibrary registers the research entry');
ok(!!e && complexity(e, plan) === 4, 'its complexity from the block');
loadLibrary(reg, new Set(['fish']), dir);
ok(LIBRARY.filter((x) => x.id === 'honeycomb').length === 1, 'registering twice adds one entry');

// The candidate: demanded only while the capability is in the wanted top 3
{
  const v = { name: 'T', plots: [], homes: {} } as unknown as Village;
  const store = { shears: 1, torch: 8 };
  const c0 = candidates(v, store, {}, {}, 0).find((c) => c.e.id === 'honeycomb');
  ok(!!c0 && !c0.demand, 'offered, not demanded, without the wanted list');
  WANTED_TOP.set('T', ['honeycomb']);
  const c1 = candidates(v, store, {}, {}, 0).find((c) => c.e.id === 'honeycomb');
  ok(!!c1 && c1.demand && c1.rank >= 4 && c1.why.some((y) => /most wanted/.test(y)), 'demanded while in the wanted top 3');
  ok(!candidates(v, { torch: 8 }, {}, {}, 0).some((c) => c.e.id === 'honeycomb'), 'not offered without shears in storage');
  // (and a want for its give, as for a good's)
  WANTED_TOP.clear();
  const c2 = candidates(v, store, { honeycomb: 2 }, {}, 0).find((c) => c.e.id === 'honeycomb');
  ok(!!c2 && c2.demand && c2.why.some((y) => /honeycomb wanted 2 times/.test(y)), 'a barter want for its give');

  // The lock: place and pick say locked until the village unlocks it, then the adapter answers
  const f = locked({ name: 'fish', skill: {} as never, tool: {} as never, activity: { place: () => ({ x: 1, y: 2, z: 3 }), pick: () => ({ args: {}, needs: {} }) } });
  const pctx = { village: v, agent: {} as never, hut: null };
  ok(/locked/.test(String((f.activity!.place(pctx) as { why?: string }).why)), 'locked before the research');
  ok(/locked/.test(String((f.activity!.pick!({ ...pctx, spare: {}, spec: 'lib:honeycomb' }) as { why?: string }).why)), 'pick locked too');
  techOf(v).unlocked.push('honeycomb');
  ok((f.activity!.place(pctx) as { x?: number }).x === 1, 'open once unlocked');
  const g = locked({ name: 'trade', skill: {} as never, tool: {} as never, activity: { place: () => ({ x: 9 }) } });
  ok((g.activity!.place({ village: { name: 'U', plots: [] } as unknown as Village, agent: {} as never, hut: null }) as { x?: number }).x === 9, 'an unlocked skill passes through');

  // The wanted list: built but locked, then have
  const ctx2 = { ...ctx, activitySkills: new Set(['fish', 'trade', 'harvest_honeycomb']) };
  LOCKED_SKILLS.set('harvest_honeycomb', e!);
  const v2 = structuredClone(v0);
  ok(wantedList(v2, ctx2).find((x) => x.id === 'honeycomb')!.status === 'locked', 'locked while not researched');
  ok(topWanted(wantedList(v2, ctx2)).includes('honeycomb'), 'a locked capability stays in the wanted top');
  techOf(v2).unlocked.push('honeycomb');
  ok(wantedList(v2, ctx2).find((x) => x.id === 'honeycomb')!.status === 'have', 'have once unlocked');
  LOCKED_SKILLS.delete('harvest_honeycomb');
}

// G8's rung lock: a spec's `rung` validated, registered with MC_LADDER on, its activity open only while the rung is
// current or reached
{
  const rdir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcai-rung-'));
  const rspec = { id: 'lib:cast_obsidian', name: 'Cast obsidian from lava', skill: 'trade', gives: [{ item: 'obsidian' }], keep: 16, effect: 'obsidian for the enchantment age', rung: 'enchantment' };
  ok(validateLibrarySpec(rspec as never, { registry: reg, skills: new Set(['trade']) }).length === 0, 'a rung spec is valid');
  ok(validateLibrarySpec({ ...rspec, rung: 'moon' } as never, { registry: reg, skills: new Set(['trade']) }).some((e) => /rung "moon"/.test(e)), 'an unknown rung named');
  ok(validateLibrarySpec({ ...rspec, research: spec.research } as never, { registry: reg, skills: new Set(['trade']) }).some((e) => /not both/.test(e)), 'research and a rung together refused');
  fs.writeFileSync(path.join(rdir, 'cast_obsidian.json'), JSON.stringify(rspec));
  const rl = loadLibrary(reg, new Set(['trade']), rdir);
  ok(rl.specs.length === 1 && RUNG_SKILLS.get('trade') === 'enchantment', 'registered while MC_LADDER is on');
  const g = locked({ name: 'trade', skill: {} as never, tool: {} as never, activity: { place: () => ({ x: 7 }) } });
  const at = (ladder: unknown) => g.activity!.place({ village: { name: 'L', plots: [], ladder } as unknown as Village, agent: {} as never, hut: null }) as { x?: number; why?: string };
  ok(/not reached the enchantment age/.test(String(at(undefined).why)) && /not reached/.test(String(at({ current: 'iron', reached: [] }).why)), 'locked before the rung');
  ok(at({ current: 'enchantment' }).x === 7 && at({ current: 'nether', reached: [{ rung: 'enchantment', t: 1, workers: [] }] }).x === 7, 'open while the rung is current or reached');
  RUNG_SKILLS.delete('trade');
  fs.rmSync(rdir, { recursive: true, force: true });
}

// MC_INNOVATE off: the spec stays out (a child process, the flag read at load)
{
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], '--off', dir], { env: { ...process.env, MC_INNOVATE: 'off' }, encoding: 'utf8' });
  let out: { specs?: number; dropped?: number; locked?: string[]; entry?: boolean } = {};
  try {
    out = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}');
  } catch {
    console.log(r.stdout, r.stderr);
  }
  ok(out.specs === 0 && out.dropped === 0 && out.locked?.[0] === 'lib:honeycomb' && out.entry === false, `MC_INNOVATE off: not loaded, not dropped, no entry (${JSON.stringify(out)})`);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`wanted_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
