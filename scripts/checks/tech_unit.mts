/**
 * Innovation's research points, offline (s44, #78, spec runs/2026-10-21/s44/spec_innovation_v2.md): each entry's complexity
 * from the real recipe data (26.1) and its need; an attempt's points (curiosity, repeats, the demand boost); the unlock at
 * the need and only on an attempt; credit and the pledges split by attempt share (a pledger's own pledge back when it alone
 * researched); pledge points capped; prerequisites gating candidates; a v1 record taking v2's fields; settling an entry
 * already unlocked does nothing.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/tech_unit.mts
 */
import minecraftData from 'minecraft-data';
import { Materials } from '../../server/src/mineflayer/mcMaterials';
import { LIBRARY, ROYALTY, TENTHS, addPledge, payRoyalties, royaltyGood, attemptPoints, boostOf, candidates, complexity, needOf, pointsIn, settleAttempt, techOf } from '../../server/src/tech';
import type { Village } from '../../server/src/village';

const m = new Materials(minecraftData('26.1') as never);
const plan = (b: Record<string, number>) => m.plan(b);
let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};
const E = (id: string) => LIBRARY.find((e) => e.id === id)!;
const village = () => ({ name: 'T', plots: [], homes: {} }) as unknown as Village;

// Complexity: the spec's table (steps beyond the basics, raw inputs, a furnace, hard inputs)
const want: Record<string, number> = { hay: 1.5, pies: 3.5, lantern: 6.5, armor_stand: 5.5, shears: 5.5, jack_o_lantern: 2.5 };
for (const [id, c] of Object.entries(want)) ok(complexity(E(id), plan) === c, `${id}: complexity ${complexity(E(id), plan)} (want ${c})`);
for (const e of LIBRARY) console.log(`  ${e.id}: complexity ${complexity(e, plan)}, need ${needOf(village(), e, plan) / TENTHS} points`);

// Points per attempt
ok(attemptPoints(true, 0, 0, 1) === 80 && attemptPoints(false, 0, 0, 1) === 20, 'attempt points 8 / 2');
ok(attemptPoints(true, 1, 0, 1) === 120 && attemptPoints(true, -1, 0, 1) === 40, 'curiosity 1.5x / 0.5x');
ok(attemptPoints(true, 0, 9, 1) === 120, 'repeats at most 1.5x');
ok(boostOf(1) === 1 && boostOf(3) === 1.5 && boostOf(20) === 2, 'boost 1..2');

// Unlock at the need; shares by attempt points; inventor the top researcher
{
  const v = village();
  const hay = E('hay'), need = needOf(v, hay, plan);
  let r = settleAttempt(v, hay, 'Ada', 0, 1, 0, 1, plan);
  ok(r.ok && !r.unlocked && r.gained === 80, 'Ada: 8 points, not yet');
  ok(addPledge(v, hay, 'Ben', 'emerald', 1, plan) === Math.floor(need / 4), 'a pledge capped at a quarter of the need');
  ok(addPledge(v, hay, 'Cy', 'emerald', 1, plan) === Math.floor(need / 4), 'a second pledge capped the same');
  ok(addPledge(v, hay, 'Dee', 'emerald', 1, plan) === Math.floor(need / 2) - 2 * Math.floor(need / 4), 'pledges at most half the need');
  ok(addPledge(v, hay, 'Eve', 'emerald', 1, plan) === null, 'a pledge refused once the pledges are full');
  ok(pointsIn(v, 'hay') >= need && !techOf(v).unlocked.includes('hay'), 'pledges never cross the need alone');
  r = settleAttempt(v, hay, 'Ben', 0.99, 2, 0, 1, plan);
  ok(r.unlocked && r.inventor === 'Ada', `unlocked on Ben's attempt, Ada the inventor (${r.inventor})`);
  ok((techOf(v).credit.Ada ?? []).includes('hay') && (techOf(v).credit.Ben ?? []).includes('hay'), 'both credited');
  // Ben's pledge goes to Ada only (no share of its own); Cy's and Dee's split 80:20 between Ada and Ben,
  // floored to none each, the rest to Ada
  ok(r.shares.Ada?.emerald === 3 && (r.shares.Ben?.emerald ?? 0) === 0, `shares ${JSON.stringify(r.shares)}`);
  const again = settleAttempt(v, hay, 'Cy', 0, 3, 0, 1, plan);
  ok(!!again.already && techOf(v).unlocked.filter((x) => x === 'hay').length === 1, 'settling an unlocked entry does nothing');
  ok(addPledge(v, hay, 'Cy', 'emerald', 1, plan) === null, 'a pledge to an unlocked entry is refused');
}
// Royalties: by all points (Ada's and Ben's attempts, the pledgers' pledges), to housed holders, fractions kept
{
  const v = village();
  const hay = E('hay');
  settleAttempt(v, hay, 'Ada', 0, 1, 0, 1, plan);
  addPledge(v, hay, 'Cy', 'bread', 2, plan);
  let r;
  for (let i = 0; i < 10 && !(r = settleAttempt(v, hay, 'Ben', 0.99, i, 0, 1, plan)).unlocked; i++);
  const o = techOf(v).owners.hay;
  ok(!!r?.unlocked && o.Ada === 80 && o.Cy > 0 && o.Ben > 0, `owners ${JSON.stringify(o)}`);
  const sum = Object.values(o).reduce((s, q) => s + q, 0);
  let paid = 0;
  for (let k = 0; k < 100; k++) for (const c of Object.values(payRoyalties(v, { hay_block: 1 }, (m) => m !== 'Ben'))) paid += c.hay_block ?? 0;
  const ada = (v.homes as Record<string, { owed: Record<string, number> }>).Ada.owed.hay_block;
  ok(ada === Math.floor((100 * ROYALTY * 80) / sum + 1e-9), `Ada owed ${ada} of 100 hay bales' royalty`);
  ok(!(v.homes as Record<string, unknown>).Ben, 'a holder without a house earns nothing');
  ok(paid <= 100 * ROYALTY, `royalty paid ${paid} within ${100 * ROYALTY}`);
}
ok(!royaltyGood('sugar') && royaltyGood('pumpkin_pie') && !royaltyGood('carved_pumpkin') && royaltyGood('jack_o_lantern') && !royaltyGood('shears') && royaltyGood('lantern'), 'royalties on final goods only');
// Pledge shares only to researchers with a chest: the rest to the pledger
{
  const v = village();
  const hay = E('hay');
  addPledge(v, hay, 'Cy', 'bread', 2, plan);
  let r;
  for (let i = 0; i < 10 && !(r = settleAttempt(v, hay, 'Ada', 0, i, 0, 1, plan, (m) => m !== 'Ada')).unlocked; i++);
  ok(!!r?.unlocked && r.shares.Cy?.bread === 2 && !r.shares.Ada, `a share for a member without a chest goes back (${JSON.stringify(r?.shares)})`);
}
// A pledger who alone researched has its pledge back
{
  const v = village();
  const hay = E('hay');
  addPledge(v, hay, 'Ada', 'bread', 2, plan);
  let r;
  for (let i = 0; i < 10 && !(r = settleAttempt(v, hay, 'Ada', 0, i, 0, 1, plan)).unlocked; i++);
  ok(!!r?.unlocked && r.shares.Ada?.bread === 2, `the lone pledger has its pledge back (${JSON.stringify(r?.shares)})`);
}
// Prerequisites: shears need iron tools made; jack o'lanterns need shears unlocked
{
  const v = village();
  const store = { raw_iron: 4, stick: 8, pumpkin: 8, torch: 8, shears: 1, wheat: 9, egg: 2, sugar_cane: 2, stone_slab: 2 };
  const ids = (made: string[]) => candidates(v, store, {}, {}, 0, made).map((c) => c.e.id);
  ok(!ids([]).includes('shears'), 'no shears before iron tools');
  // (the best 3 only: unlock the others to see the tree's top)
  techOf(v).unlocked.push('hay', 'pies', 'lantern', 'armor_stand');
  ok(ids(['iron_pickaxe']).includes('shears') && !ids(['iron_pickaxe']).includes('jack_o_lantern'), 'shears after iron tools; no jack before shears');
  techOf(v).unlocked.push('shears');
  ok(ids(['iron_pickaxe']).includes('jack_o_lantern'), "jack o'lanterns after shears");
}
// A v1 record takes v2's fields
{
  const v = { ...village(), innovation: { unlocked: [], at: {}, inventor: {}, tries: { 'hay|Ada': 2 }, pledges: {}, failed: { hay: 1e15 } } } as unknown as Village;
  const t = techOf(v);
  ok(!!t.points && !!t.need && !!t.credit && !!t.attempts && !!t.pledgePts, 'v1 record migrated');
  ok(candidates(v, { wheat: 9 }, {}, {}, 0).some((c) => c.e.id === 'hay'), "v1's failed rest no longer hides an entry");
}

console.log(`${fail ? 'FAIL' : 'PASS'} tech_unit (${pass} passed, ${fail} failed)`);
process.exit(fail ? 1 : 0);
