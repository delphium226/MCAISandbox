// #231 (train 24, F359): why hunts rarely went out. All 24 calls-off came on a resume after reflex fights 51-182 blocks
// out; the hunt's 30 s heal gained no health in 8 of 10 (food 15-17: vanilla heals only at 18 or more) and 23 of 24
// calls-off reached the hut no better, because the heal and the call-off's "eat and heal" ate only carried food and members
// carry none. Now the heal, the call-off and the reflex's "ran to the storage hut to recover" eat to the bar's 18, from
// storage when nothing is carried (topUpMeal picks the meal). Fails on the code before it.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/fixes_231_heal.mts
process.env.MC_WORLD_MODE ??= 'hostile';
const C = await import('../../server/src/mineflayer/mcCombat');
let fails = 0;
const ok = (cond: unknown, what: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) fails++;
};
const sec = async (name: string, f: () => Promise<void> | void) => {
  try { await f(); } catch (e) { ok(false, `${name}: ${(e as Error).message}`); }
};

await sec('the meal', () => {
  const store = { bread: 224, pumpkin_pie: 7, cooked_cod: 14 };
  // (Hugo: health 11, food 17, carrying nothing: the old heal ate nothing)
  const m1 = C.topUpMeal(store, 17, 11);
  ok(m1 && m1.n === 1, `food 17, health 11: one bite from storage (${JSON.stringify(m1)})`);
  // (Clara at 14 health, food 15: packBite alone eats only under 14 health)
  ok(C.topUpMeal(store, 15, 14) !== null, 'food 15, health 14: a meal (the hunt needs above 14)');
  const m2 = C.topUpMeal({ bread: 224 }, 12, 6);
  ok(m2?.item === 'bread' && m2.n === 2, `food 12: two bread to reach 18 (${JSON.stringify(m2)})`);
  ok(C.topUpMeal({ bread: 1 }, 4, 6)?.n === 1, 'never more than the store holds');
  ok(C.topUpMeal(store, 18, 9) === null, 'at food 18 health comes back by itself: no meal');
  ok(C.topUpMeal(store, 15, 20) === null, 'full health: no meal');
  ok(C.topUpMeal({ wheat_seeds: 30, cake: 1 }, 15, 9) === null, 'nothing to eat in the store: none');
  ok(C.REGEN_FOOD === 18, "vanilla's regeneration mark");
});

console.log(fails ? `FAIL ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
