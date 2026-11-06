// #238 (train 25, F362): the appetite ate at food 14 and stopped below 18, so vanilla never healed between meals: members
// spent 19-21% of the run at health 14 or less, 99% of it at food 14-17 (Dev at health 1 for 16 minutes at food 14-15).
// Now, with real hunger, a hurt member below food 18 is peckish and its meal reaches 18 (#231's topUpMeal), while storage
// keeps HURT_KEEP points for each member after it. Fails on the code before it.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/fixes_238.mts
process.env.MC_WORLD_MODE ??= 'hostile';
const A = await import('../../server/src/appetite');
const C = await import('../../server/src/mineflayer/mcCombat');
const B = await import('../../server/src/mineflayer/mcSurvivalB');
let fails = 0;
const ok = (cond: unknown, what: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) fails++;
};
const sec = async (name: string, f: () => Promise<void> | void) => {
  try { await f(); } catch (e) { ok(false, `${name}: ${(e as Error).message}`); }
};
const pts = (m: { item: string; n: number } | null) => (m ? m.n * A.FOOD_POINTS[m.item] : 0);

// (train 25's storage: ~230 bread, 7 pies, 14-29 cod, 8-10 salmon; 12 members and the Mayor)
const store = { bread: 224, pumpkin_pie: 7, cooked_cod: 14, cooked_salmon: 8 };
const village = { food: { members: Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`m${i}`, {}])) } };
// (the old code has no hurtKeep: 13 x 16, so its sections fail on what they check rather than at the import)
const keep = typeof A.hurtKeep === 'function' ? A.hurtKeep(village) : 13 * 16;

await sec('the state', () => {
  ok(A.stateOf(16, 1) === 'peckish', 'Dev: health 1, food 16: peckish (eats to 18, where health comes back)');
  ok(A.stateOf(17, 19) === 'peckish', 'health 19, food 17: peckish');
  ok(A.stateOf(16, 20) === 'fed' && A.stateOf(16) === 'fed', 'full health, or no health known: fed at 16 as before');
  ok(A.stateOf(18, 5) === 'fed', 'food 18: vanilla heals by itself: fed');
  ok(A.stateOf(14, 20) === 'peckish' && A.stateOf(5, 20) === 'hungry', 'the appetite\'s own levels unchanged');
});

await sec('the meal', () => {
  ok(keep === 13 * A.HURT_KEEP, `storage keeps ${keep} points for 13 members`);
  for (const level of [15, 16, 17]) {
    const m = A.chooseMeal(level, store, { health: 6, keep });
    ok(m && level + pts(m) >= A.REGEN_FOOD, `hurt at food ${level}: a meal to 18+ (${JSON.stringify(m)})`);
  }
  // (food 12 hurt: the appetite's meal stops at 17; the hurt one goes to 18)
  const m12 = A.chooseMeal(12, { bread: 224 }, { health: 6, keep });
  ok(m12?.item === 'bread' && 12 + pts(m12) >= 18, `food 12, hurt: bread to 18+ (${JSON.stringify(m12)}; unhurt ${JSON.stringify(A.chooseMeal(12, { bread: 224 }))})`);
  ok(A.chooseMeal(16, store, { health: 3, keep }) !== null, 'hurt at 16: a meal');
  const m14 = A.chooseMeal(14, store, { health: 9, keep });
  ok(m14 && 14 + pts(m14) >= 18, `peckish and hurt at 14: to 18+ (${JSON.stringify(m14)})`);
  ok(A.chooseMeal(15, { cake: 2, wheat_seeds: 40, carrot: 8 }, { health: 5, keep: 0 }) === null, 'no cake and no planting stock for a hurt top-up');
});

await sec('storage is not drained', () => {
  // (30 bread = 150 points, under 13 members x HURT_KEEP: the hurt-only meal waits; the appetite's own still eats)
  const low = { bread: 30 };
  ok(A.chooseMeal(16, low, { health: 4, keep }) === null, 'hurt at 16 with 30 bread for 13 members: no top-up');
  const own = A.chooseMeal(12, low, { health: 4, keep });
  ok(own?.item === 'bread' && own.n === 1, `hurt at 12 with little food: the appetite's own meal only (${JSON.stringify(own)})`);
  ok(A.chooseMeal(16, { bread: 45 }, { health: 4, keep }) !== null && A.chooseMeal(16, { bread: 42 }, { health: 4, keep }) === null,
    'the top-up eats while 208 points stay after it, not below');
  // (a member at health 1 eats 1 bread a meal: 15 -> 20; Dev's 19 missing health costs vanilla ~28 food, about 6 meals)
  let s = { bread: 60 }, meals = 0;
  for (let level = 15; meals < 50; meals++) {
    const m = A.chooseMeal(level, s, { health: 1, keep });
    if (!m) break;
    s = { bread: s.bread - m.n };
    level = 15;
  }
  ok(s.bread * 5 >= keep && s.bread * 5 < keep + 10, `repeated top-ups stop at the reserve (${s.bread} bread left after ${meals} meals)`);
});

await sec('the helpers are shared', () => {
  ok(C.topUpMeal === A.topUpMeal && C.REGEN_FOOD === A.REGEN_FOOD && B.packBite === A.packBite, "mcCombat's and mcSurvivalB's are the appetite's");
});

console.log(fails ? `FAIL ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
