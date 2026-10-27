// MC_GEODE_GUARD's costs (mcGeode.ts, #133's geode case): a path never digs a geode's shell, never steps over its lining
// or into its buds, and a bot already inside walks out. Offline: node node_modules/tsx/dist/cli.mjs scripts/checks/geode_guard.mts
import { GEODE_COST, geodeBreakCost, geodeStepCost, stateIds } from '../../server/src/mineflayer/mcGeode.ts';

let bad = 0;
const ok = (cond: boolean, what: string) => { if (!cond) { bad++; console.log(`FAIL ${what}`); } };
for (const n of ['smooth_basalt', 'calcite', 'amethyst_block', 'budding_amethyst']) ok(geodeBreakCost(n) === GEODE_COST, `break ${n}`);
for (const n of ['stone', 'deepslate', 'dirt', 'amethyst_cluster', undefined]) ok(geodeBreakCost(n) === 0, `break ${n} free`);
ok(geodeStepCost('air', 'amethyst_block', false) === GEODE_COST, 'step over lining');
ok(geodeStepCost('air', 'budding_amethyst', false) === GEODE_COST, 'step over budding');
ok(geodeStepCost('large_amethyst_bud', 'calcite', false) === GEODE_COST, 'step into a bud');
ok(geodeStepCost('air', 'amethyst_block', true) === 0, 'inside: walks out');
ok(geodeStepCost('air', 'calcite', false) === GEODE_COST, 'step over bare calcite (a gap in the lining)');
ok(geodeStepCost('air', 'stone', false) === 0 && geodeStepCost('stone', 'deepslate', false) === 0, 'stone floor free');
const ids = stateIds({ blocksByName: { amethyst_block: { minStateId: 5, maxStateId: 5 }, x: { minStateId: 7, maxStateId: 9 } } }, ['amethyst_block', 'x', 'missing']);
ok(ids.size === 4 && ids.get(8) === 'x', 'state ids');
console.log(bad ? `geode_guard: ${bad} failed` : 'geode_guard: ok');
process.exit(bad ? 1 : 0);
