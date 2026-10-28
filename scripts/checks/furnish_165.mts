/**
 * #165 (Cologne's follow-ups) and #162's chains C-E (the furnishing) checked offline, no server:
 * - the flags read on by default (since 10-28), and a new monument then has its furnishing stage;
 * - furnishPlan: what a lantern, a chain, a banner, a candle, the bell and the altar's chiselled bricks take and craft;
 * - gothicGen's furnishKinds: only the kinds asked for are drawn (lanterns alone: chains and lanterns only), every kind
 *   as before, and no furnishing at all exactly the eight-stage cathedral;
 * - monumentPlan with a record's `furnish`: nine stages; the cathedral counts as built when stages 1-8 stand (jobBuilt),
 *   the furnishing's jobs still open; stageBill never looks ahead into the furnishing; furnishWants;
 * - the stand-in from a job (standInFrom): the jobs the yard's stone covers keep polished andesite, the rest stand in;
 * - the quarry's rows with topsoil: stone rows first, the topsoil's deepest first, the old order without soil.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/furnish_165.mts
 */
const { FURNISH, furnishPlan, furnishWants, furnishItem, bannerStandIn } = await import('../../server/src/furnish');
const { GOTHIC_PRESETS, generateCathedral } = await import('../../server/src/gothicGen');
const { monumentPlan, jobBuilt, currentStage, furnishStage, stageBill, standInFrom, openJobs, newMonument } = await import('../../server/src/monument');
const { newQuarry, openRows } = await import('../../server/src/quarry');

let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 30) console.log(`FAIL ${what}`);
  }
};

// Flags off
ok(FURNISH.lanterns && FURNISH.banners && FURNISH.candles, 'the furnishing flags read on by default (since 10-28)');
ok(!!(newMonument('oak', 0) as { furnish?: unknown }).furnish, 'a new monument has its furnishing with the flags on');

// The recipes
{
  const l = furnishPlan('lantern', 8);
  ok(l.takes.iron_ingot === 8 && l.takes.coal === 2 && l.takes.planks === 2, `8 lanterns take 8 ingots, 2 coal, 2 planks (${JSON.stringify(l.takes)})`);
  ok(l.crafts.map((c) => c.item).join() === 'iron_nugget,stick,torch,lantern' && l.crafts[3].makes === 8, `8 lanterns' crafts in order (${JSON.stringify(l.crafts)})`);
  const lt = furnishPlan('lantern', 4, { torch: 17, iron_nugget: 5 });
  ok(lt.takes.torch === 4 && lt.takes.iron_nugget === 5 && lt.takes.iron_ingot === 3 && !lt.takes.coal, `stored torches and nuggets first (${JSON.stringify(lt.takes)})`);
  const ch = furnishPlan('iron_chain', 6);
  ok(ch.takes.iron_ingot === 6 + 2 && ch.crafts[0].item === 'iron_nugget', `6 chains: 6 ingots and 12 nuggets (2 ingots) (${JSON.stringify(ch.takes)})`);
  const b = furnishPlan('red_banner', 2, { stick: 5 });
  ok(b.takes.white_wool === 12 && b.takes.red_dye === 12 && b.takes.stick === 2 && b.crafts.map((c) => c.item).join() === 'red_wool,red_banner', `2 red banners (${JSON.stringify(b)})`);
  const w = furnishPlan('white_banner', 1);
  ok(w.takes.white_wool === 6 && !Object.keys(w.takes).some((k) => /_dye$/.test(k)), 'a white banner wants no dye');
  const c = furnishPlan('candle', 2);
  ok(c.takes.string === 2 && c.takes.honeycomb === 2, 'candles: string and honeycomb');
  ok(JSON.stringify(furnishPlan('bell', 1)) === JSON.stringify({ takes: { bell: 1 }, crafts: [] }), 'the bell is bought, not crafted');
  const al = furnishPlan('chiseled_stone_bricks', 3);
  ok(al.takes.stone_bricks === 3 && al.crafts[0].makes === 6 && al.crafts[1].makes === 3, `the altar's 3 chiselled bricks (${JSON.stringify(al)})`);
  ok(furnishItem('lantern') && furnishItem('white_banner') && !furnishItem('stone_bricks'), 'furnishItem');
}

// The generator's kinds
const P = GOTHIC_PRESETS.notre_dame;
const items = (c: ReturnType<typeof generateCathedral>, stage: number) => {
  const out = new Set<string>();
  for (const j of c.jobs) if (j.stage === stage) for (const k of Object.keys(j.bill)) out.add(k);
  return out;
};
{
  const all = generateCathedral(P, 3, { detail: true });
  const none = generateCathedral(P, 3, { detail: true, furnish: false });
  const eight = generateCathedral(P, 3, { detail: true, furnish: true, furnishKinds: {} });
  const lan = generateCathedral(P, 3, { detail: true, furnish: true, furnishKinds: { lanterns: true } });
  const every = generateCathedral(P, 3, { detail: true, furnish: true, furnishKinds: { lanterns: true, banners: true, candles: true, bell: true } });
  ok(all.stageNames.length === 9 && none.stageNames.length === 8, 'nine stages with the furnishing, eight without');
  ok(JSON.stringify(every.bill) === JSON.stringify(all.bill) && every.design.blocks === all.design.blocks, 'every kind: the same cathedral as no kinds given');
  ok([...items(lan, 9)].every((k) => k === 'lantern' || k === 'iron_chain') && items(lan, 9).has('lantern'), `lanterns alone: ${[...items(lan, 9)]}`);
  ok(eight.design.blocks === none.design.blocks, 'no kinds: no furnishing cells');
  ok(lan.design.blocks - none.design.blocks === (lan.bill.lantern ?? 0) + (lan.bill.iron_chain ?? 0), 'lanterns alone add only their cells');
  console.log(`Notre-Dame 1:3 furnishing: ${[...items(all, 9)].map((k) => `${k} ${all.jobs.filter((j) => j.stage === 9).reduce((t, j) => t + (j.bill[k] ?? 0), 0)}`).join(', ')}`);
}

// monumentPlan, completion, stageBill
{
  const m = { preset: 'notre_dame', scale: 3, palette: 'full', wood: 'oak', at: 0, state: 'building', done: [], yard: {}, stages: [], detail: true,
    furnish: { lanterns: true, banners: true, candles: true, bell: true }, site: { x1: 0, z1: 0, x2: 60, z2: 40, y: 64, rotate: 0, prepared: true } } as unknown as Parameters<typeof monumentPlan>[0];
  const c = monumentPlan(m);
  ok(c.stageNames.length === 9 && furnishStage(m) === 9, 'the record\'s furnishing: nine stages');
  const plain = monumentPlan({ ...m, furnish: undefined } as typeof m);
  ok(plain.stageNames.length === 8 && furnishStage({ ...m, furnish: undefined } as typeof m) === 0, 'no record furnishing: eight stages, as before');
  // (at stage 8 the bill ahead leaves the furnishing out)
  for (let i = 0; i < c.jobs.length; i++) if (c.jobs[i].stage < 8) jobBuilt(m, i, {}, 1);
  ok(currentStage(m) === 8 && m.state === 'building', 'stage 8 under way');
  const ahead = stageBill(m, 1);
  ok(!Object.keys(ahead).some((k) => furnishItem(k)), `stageBill at stage 8 looks not into the furnishing (${Object.keys(ahead).filter((k) => furnishItem(k))})`);
  for (let i = 0; i < c.jobs.length; i++) if (c.jobs[i].stage === 8) jobBuilt(m, i, {}, 2);
  ok(m.state === 'built' && m.built === 2 && currentStage(m) === 9, `built when stages 1-8 stand, the furnishing open (${m.state}, stage ${currentStage(m)})`);
  const open = openJobs(m);
  ok(open.length > 0 && open.every((i) => c.jobs[i].stage === 9), 'the furnishing\'s jobs open');
  const wants = furnishWants(open.map((i) => c.jobs[i].bill), { lantern: 2 });
  ok(wants.lantern === (c.bill.lantern ?? 0) - 2 && (wants.bell ?? 0) === (c.bill.bell ?? 0), `furnishWants less the yard (${JSON.stringify(wants)})`);
  // (a coloured banner not made stands in as white: the job then wants only white banners)
  const colour = Object.keys(c.bill).find((k) => /_banner$/.test(k) && k !== 'white_banner')!;
  const sb = bannerStandIn(colour)!;
  ok(sb && sb.block === colour.replace(/_banner$/, '_wall_banner') && sb.as === 'white_wall_banner' && !bannerStandIn('white_banner') && !bannerStandIn('lantern'), `bannerStandIn(${colour})`);
  const ms = { ...m, standIns: { [sb.block]: sb.as } } as typeof m;
  const cs = monumentPlan(ms);
  ok(!cs.bill[colour] && cs.bill.white_banner === (c.bill.white_banner ?? 0) + (c.bill[colour] ?? 0) && cs.design.blocks === c.design.blocks, `the ${colour}s stand in white (${cs.bill.white_banner})`);
  ok(!Object.keys(furnishWants(openJobs(ms).map((i) => cs.jobs[i].bill), { white_banner: cs.bill.white_banner, lantern: 99, iron_chain: 99, bell: 1, candle: 99, chiseled_stone_bricks: 9 })).length, 'with white banners in the yard nothing more is wanted');
  for (const i of open) jobBuilt(m, i, {}, 3);
  ok(m.state === 'built' && m.built === 2 && currentStage(m) === 0, 'the furnishing done: still built, at its first time');
}

// The stand-in from a job
{
  const m = { preset: 'cologne', scale: 3, palette: 'full', wood: 'oak', at: 0, state: 'building', done: [], yard: {}, stages: [], detail: true } as unknown as Parameters<typeof monumentPlan>[0];
  const c = monumentPlan(m);
  const pa = c.jobs.map((j) => j.bill.polished_andesite ?? 0);
  const total = pa.reduce((t, q) => t + q, 0);
  const first = pa.findIndex((q) => q > 0);
  ok(total > 0 && first >= 0, `Cologne 1:3 detail wants polished andesite (${total})`);
  const have = pa[first] + 1;
  const from = standInFrom(m, 'polished_andesite', have);
  ok(from > first && pa.slice(0, from).reduce((t, q) => t + q, 0) <= have, `the stand-in from job ${from} (the yard's ${have} cover the jobs before it)`);
  ok(standInFrom(m, 'polished_andesite', 0) === first, 'nothing in the yard: from the first job that wants it');
  ok(standInFrom(m, 'polished_andesite', total) === c.jobs.length, 'the yard covers it all: no job stands in');
  const s = { ...m, standIns: { polished_andesite: 'stone' }, standInFrom: { polished_andesite: from } } as typeof m;
  const cs = monumentPlan(s);
  ok(cs.jobs.slice(0, from).every((j, i) => (j.bill.polished_andesite ?? 0) === pa[i]), 'the jobs before keep polished andesite');
  ok(cs.jobs.slice(from).every((j) => !j.bill.polished_andesite), 'the jobs from it on stand in');
  ok(cs.design.blocks === c.design.blocks, 'the same cells');
  const whole = monumentPlan({ ...m, standIns: { polished_andesite: 'stone' } } as typeof m);
  ok(!whole.bill.polished_andesite, 'a stand-in without a job stands in everywhere (as before)');
  ok(JSON.stringify(monumentPlan({ ...m } as typeof m).bill) === JSON.stringify(c.bill), 'no stand-in: the plan as before');
}

// The quarry's rows with topsoil
{
  const q = newQuarry({ x1: 0, z1: 0, x2: 11, z2: 11 }, 70, 10, 'w', 'x', 0, 3);
  ok(q.soil === 3, 'the quarry keeps its topsoil depth');
  q.rows['0,0'] = 12;
  let r = openRows(q, new Set());
  ok(r[0].k === 1 && r[0].v === 0, `the topsoil's deepest row first (${JSON.stringify(r[0])})`);
  q.rows['1,0'] = 11;
  q.rows['2,0'] = 10;
  r = openRows(q, new Set());
  ok(r[0].k === 3 && r[0].v === 0, `then the first stone row (${JSON.stringify(r[0])})`);
  r = openRows(q, new Set(['3,0']));
  ok(r[0].k === 2 || r[0].k === 0, 'a held stone row: the topsoil next');
  const q0 = newQuarry({ x1: 0, z1: 0, x2: 11, z2: 11 }, 70, 10, 'w', 'x', 0);
  q0.rows['0,0'] = 12;
  ok(q0.soil === undefined && openRows(q0, new Set())[0].k === 0, 'no topsoil recorded: shallowest first, as before');
}

console.log(`${failures ? 'FAILED' : 'ok'}: ${checks - failures} of ${checks} checks passed`);
process.exit(failures ? 1 : 0);
