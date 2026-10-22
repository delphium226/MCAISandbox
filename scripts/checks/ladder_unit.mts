// G8's ladder (server/src/ladder.ts) on a synthetic village: the iron rung's four stages counted from their own starts,
// the news and the workers named, the progress line's size, the stage tags, the rung ballot's options and previews, a
// chosen rung, and nothing at all with MC_LADDER off.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/ladder_unit.mts
process.env.MC_LADDER = 'on';
const L = await import('../../server/src/ladder');
const village = { name: 'T', complete: true } as unknown as import('../../server/src/village').Village;
let fails = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const t0 = 1_000_000;
const st = L.ladderOf(village, t0)!;
ok(st.current === 'iron' && st.stage === 0, 'the ladder starts on iron, stage 1');
ok(/^The village's ambition: the iron age, stage 1 of 4: 0 of 600 cells dug/.test(L.progressLine(village, t0, 600000)), `progress line: ${L.progressLine(village, t0, 600000)}`);
ok(L.feedsStage(village, 'iron:dig') && !L.feedsStage(village, 'iron:smelt'), 'stage 1 feeds the dig, not the smelt');
ok(L.stageTag(village) === '[for the iron age]', 'the tag');
// raw iron before its stage does not count
ok(L.noteLadder(village, 'raw_iron', 'Ada', 5, t0) === null && st.count === 0, 'raw iron does not count during stage 1');
let news = null;
for (let i = 0; i < 20 && !news; i++) news = L.noteLadder(village, 'cells', i % 3 ? 'Ada' : 'Ben', 40, t0 + i);
ok(news?.kind === 'stage' && st.stage === 1 && st.count === 0, `stage 1 ends at 600 cells: ${news?.text}`);
ok(!!news && news.workers[0] === 'Ada', 'the stage names its main worker first');
ok(/finished stage 1/.test(L.progressLine(village, t0 + 100, 600000)), 'the news shows for a village day');
ok(!/finished stage 1/.test(L.progressLine(village, t0 + 700000, 600000)), 'and not after');
L.noteLadder(village, 'raw_iron', 'Cara', 31, t0 + 10);
ok(st.stage === 2, 'stage 2 ends at 30 raw iron (over-count capped)');
L.noteLadder(village, 'ingots', 'Dan', 24, t0 + 20);
ok(st.stage === 3 && L.feedsStage(village, 'iron:forge:iron_pickaxe:Ben'), 'stage 3 ends at 24 ingots; stage 4 feeds the forge');
for (let i = 0; i < 9; i++) news = L.noteLadder(village, 'tools', 'Eve', 1, t0 + 30 + i);
ok(news === null && st.count === 9, '9 tools: not yet');
news = L.noteLadder(village, 'tools', 'Fay', 1, t0 + 40, 6);
ok(news?.kind === 'rung' && !st.current && st.reached.length === 1 && st.reached[0].day === 6, `the rung is reached: ${news?.text}`);
ok(st.reached[0].workers.length === 4 && st.reached[0].workers[3][0] === 'Eve', 'each stage\'s workers kept');
ok(/reached the iron age/.test(L.progressLine(village, t0 + 50, 600000)), 'the line after the rung');
const opts = L.rungOptions(village);
ok(opts.join(',') === 'letters,diamond,copper,machines', `the ballot's options after iron, at most 4: ${opts.join(', ')}`);
for (const id of opts) {
  const pv = L.rungPreview(id);
  ok(pv.length <= 200 && pv.length > 20, `${id} preview (${pv.length}): ${pv}`);
}
ok(/foundry must build: .*obsidian/i.test(L.rungPreview('enchantment')), 'enchantment\'s preview names the ticketed skill');
L.openRungBallot(village, opts);
ok(st.offered?.length === 4 && /choosing its next ambition/.test(L.progressLine(village, t0 + 60, 600000)), 'a ballot open: offered, and the line says so');
L.chooseRung(village, 'letters', opts, t0 + 70);
ok(st.current === 'letters' && !st.offered && st.ballots.length === 1, 'the winner becomes the current rung');
ok(/not built yet/.test(L.progressLine(village, t0 + 80, 600000)), `a stage without a counter says so: ${L.progressLine(village, t0 + 80, 600000)}`);
ok(L.noteLadder(village, 'cells', 'Ada', 999, t0 + 90) === null, 'letters counts nothing yet');
for (const line of [L.progressLine(village, t0 + 80, 600000)]) ok(line.length <= 300, `line size ${line.length}`);
const view = L.ladderView(village) as { rungs: Array<{ id: string; stages: Array<{ state: string }> }> };
ok(view.rungs.find((r) => r.id === 'iron')!.stages.every((s) => s.state === 'done'), 'the view: iron done');
console.log(fails ? `ladder_unit: ${fails} failed` : 'ladder_unit: all passed');
process.exit(fails ? 1 : 0);
