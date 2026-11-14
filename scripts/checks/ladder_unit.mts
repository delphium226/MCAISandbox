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
// raw iron brought up during stage 1 counts toward stage 2 (every counter from the rung's start), the stage stays 1
ok(L.noteLadder(village, 'raw_iron', 'Ada', 5, t0).length === 0 && st.stage === 0 && st.totals?.raw_iron === 5, 'raw iron during stage 1 is kept for stage 2');
let news: ReturnType<typeof L.noteLadder>[number] | null = null;
for (let i = 0; i < 20 && !news; i++) news = L.noteLadder(village, 'cells', i % 3 ? 'Ada' : 'Ben', 40, t0 + i)[0] ?? null;
ok(news?.kind === 'stage' && st.stage === 1 && st.count === 5, `stage 1 ends at 600 cells, stage 2 starts at the 5 raw iron already up: ${news?.text}`);
ok(!!news && news.workers[0] === 'Ada', 'the stage names its main worker first');
ok(/finished stage 1/.test(L.progressLine(village, t0 + 100, 600000)), 'the news shows for a village day');
ok(!/finished stage 1/.test(L.progressLine(village, t0 + 700000, 600000)), 'and not after');
// ingots and tools done early wait for their stages
L.noteLadder(village, 'ingots', 'Dan', 24, t0 + 5);
for (let i = 0; i < 9; i++) L.noteLadder(village, 'tools', 'Eve', 1, t0 + 6 + i);
ok(st.stage === 1, 'early ingots and tools do not jump stage 2');
const burst = L.noteLadder(village, 'raw_iron', 'Cara', 31, t0 + 10);
ok(burst.length === 2 && st.stage === 3 && st.count === 9, `raw iron ends stage 2, and stage 3's ingots already there end it too (${burst.map((x) => x.stage + 1).join(', ')})`);
ok(L.feedsStage(village, 'iron:forge:iron_pickaxe:Ben'), 'stage 4 feeds the forge');
news = L.noteLadder(village, 'tools', 'Fay', 1, t0 + 40, 6)[0] ?? null;
ok(news?.kind === 'rung' && !st.current && st.reached.length === 1 && st.reached[0].day === 6, `the rung is reached: ${news?.text}`);
ok(st.reached[0].workers.length === 4 && st.reached[0].workers[3][0] === 'Eve', 'each stage\'s workers kept');
ok(/reached the iron age/.test(L.progressLine(village, t0 + 50, 600000)), 'the line after the rung');
const opts = L.rungOptions(village);
// (11-14: only implemented rungs, and only the lowest tier not yet reached: tier 2's letters (MC_LETTERS), copper
// (MC_COPPER_AGE), trade (MC_TRADE_AGE), husbandry and music... in the ballot's order, at most 4, else diamond)
const tier2 = L.RUNG_ORDER.filter((r) => L.RUNG_DEFS[r].tier === 2 && L.rungImplemented(r));
ok(opts.join(',') === (tier2.length ? tier2.slice(0, 4).join(',') : L.DIAMOND_AGE ? 'diamond' : ''), `the ballot's options after iron: implemented, simplest tier first: ${opts.join(', ')}`);
ok(!L.rungImplemented('nether') && L.rungImplemented('enchantment') === (L.ENCHANTMENT_AGE && L.IRON_AGE) && L.rungImplemented('machines') === (L.MACHINES_AGE && L.IRON_AGE), 'the Nether in words is not implemented; enchantment with its flags');
ok(L.rungImplemented('iron') && L.rungImplemented('diamond') === L.DIAMOND_AGE && L.rungImplemented('letters') === L.LETTERS
  && L.rungImplemented('trade') === L.TRADE_AGE && L.rungImplemented('copper') === L.COPPER_AGE, 'iron, letters, trade, copper and diamond implemented with their flags');
{
  // tier 2 reached rung by rung: diamond (tier 3) opens only once every implemented tier-2 rung is reached; diamond reached
  // too: nothing implemented is left, enchantment's words are not offered
  const v2 = { name: 'T2', complete: true } as unknown as import('../../server/src/village').Village;
  const s2 = L.ladderOf(v2, t0)!;
  s2.current = undefined;
  s2.reached = [{ rung: 'iron', t: t0, workers: [] }] as never;
  // (tier 3: diamond, machines, bees and maps, those implemented whose earlier rungs are reached, in the ballot's order)
  const tier3 = () => L.RUNG_ORDER.filter((r) => L.RUNG_DEFS[r].tier === 3 && L.rungImplemented(r) && L.RUNG_DEFS[r].after.every((a) => s2.reached.some((q) => q.rung === a))).slice(0, 4);
  for (const [i, r] of tier2.entries()) {
    s2.reached.push({ rung: r, t: t0, workers: [] } as never);
    const left = tier2.slice(i + 1);
    ok(L.rungOptions(v2).join(',') === (left.length ? left.slice(0, 4).join(',') : tier3().join(',')), `${r} reached: ${left.length ? `${left.join(', ')} still before tier 3` : `tier 3 next: ${tier3().join(', ')}`} (${L.rungOptions(v2).join(', ')})`);
  }
  ok(!L.DIAMOND_AGE || L.rungOptions(v2).includes('diamond'), 'diamond among tier 3');
  for (const r of L.RUNG_ORDER.filter((x) => L.RUNG_DEFS[x].tier === 3)) s2.reached.push({ rung: r, t: t0, workers: [] } as never);
  // (tier 4: the sea after copper, enchantment with MC_IRON_AGE (off here) after letters and diamond)
  const tier4 = L.RUNG_ORDER.filter((r) => L.RUNG_DEFS[r].tier === 4 && L.rungImplemented(r) && L.RUNG_DEFS[r].after.every((a) => s2.reached.some((q) => q.rung === a)));
  ok(L.rungOptions(v2).join(',') === tier4.join(','), `tier 3 reached: tier 4 next (${L.rungOptions(v2).join(', ') || 'none'})`);
  for (const r of L.RUNG_ORDER.filter((x) => L.RUNG_DEFS[x].tier === 4)) s2.reached.push({ rung: r, t: t0, workers: [] } as never);
  ok(L.rungOptions(v2).length === 0, 'every implemented rung reached: no ballot');
}
for (const id of opts) {
  const pv = L.rungPreview(id);
  ok(pv.length <= 200 && pv.length > 20, `${id} preview (${pv.length}): ${pv}`);
}
ok(/foundry must build: .*obsidian/i.test(L.rungPreview('enchantment')), 'enchantment\'s preview names the ticketed skill');
L.openRungBallot(village, opts);
ok(st.offered?.length === opts.length && /choosing its next ambition/.test(L.progressLine(village, t0 + 60, 600000)), 'a ballot open: offered, and the line says so');
L.chooseRung(village, 'machines', opts, t0 + 70);
ok(st.current === 'machines' && !st.offered && st.ballots.length === 1, 'the winner becomes the current rung');
ok(/not built yet/.test(L.progressLine(village, t0 + 80, 600000)), `a stage without a counter says so: ${L.progressLine(village, t0 + 80, 600000)}`);
ok(L.noteLadder(village, 'cells', 'Ada', 999, t0 + 90).length === 0, 'machines counts nothing yet');
for (const line of [L.progressLine(village, t0 + 80, 600000)]) ok(line.length <= 300, `line size ${line.length}`);
const view = L.ladderView(village) as { rungs: Array<{ id: string; stages: Array<{ state: string }> }> };
ok(view.rungs.find((r) => r.id === 'iron')!.stages.every((s) => s.state === 'done'), 'the view: iron done');
console.log(fails ? `ladder_unit: ${fails} failed` : 'ladder_unit: all passed');
process.exit(fails ? 1 : 0);
