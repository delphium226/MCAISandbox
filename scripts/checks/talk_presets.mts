/**
 * A preset monument a person names (MC_TALK_PRESETS, talkPresets.ts; docs/specs/requested-builds.md). Offline: the name
 * matcher on people's lines, the offers at the monument's scale, the Mayor's prompt, and talkAct's path on a stub world
 * (the Mayor's pick, its refusal and its "design" while a preset matched all queue the preset; talkCivicStart begins an
 * asked monument record of that type and preset at 1:3; built, it leaves the monument's place under its typed id and the
 * request is done); a blue glass pyramid and the Eiffel Tower match no preset; flag off restores the old answers.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/talk_presets.mts
 */
process.env.MC_TIME_SCALE = '1';
const T = await import('../../server/src/talkPresets');
const D = await import('../../server/src/talkDesign');
const P = await import('../../server/src/playerTalk');
const A = await import('../../server/src/askedWork');
const M = await import('../../server/src/monument');
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL ${what}`);
  }
};

ok(A.TALK_PRESETS.on, 'MC_TALK_PRESETS on by default');
ok(Math.round(1 / M.MONUMENT.scale) === 3, 'the monument scale is 1:3');

// ---- the matcher
const named = (s: string) => T.presetsNamed(P.withoutPlace(s))[0];
const CASES: Array<[string, string | undefined]> = [
  ['build salisbury cathedral here', 'cathedral:salisbury'],
  ['Mayor, build Salisbury Cathedral here please', 'cathedral:salisbury'],
  ['build conwy castle', 'castle:conwy'],
  ['a copy of notre dame', 'cathedral:notre_dame'],
  ['could you build Notre-Dame de Paris by the river?', 'cathedral:notre_dame'],
  ['build the white tower', 'castle:white_tower'],
  ['I want the Tower of London', 'castle:white_tower'],
  ['build York Minster', 'cathedral:york'],
  ['westminster abbey next to the hall', 'cathedral:westminster'],
  ["St. Stephen's cathedral in Vienna", 'cathedral:st_stephen'],
  ['Saint Vitus cathedral', 'cathedral:st_vitus'],
  ['build Krak des Chevaliers', 'castle:krak_des_chevaliers'],
  ['a castle like Caernarfon', 'castle:caernarfon'],
  ['Château Gaillard please', 'castle:chateau_gaillard'],
  ['the cathedral of Cologne', 'cathedral:cologne'],
  ['build a blue glass pyramid', undefined],
  ['build the eiffel tower', undefined],
  ['build some wells for water', undefined],
  ['build a house in york', undefined],
  ['a castle tower of red wool', undefined],
  ['build a cathedral', undefined],
  ['build a big castle', undefined],
];
for (const [line, want] of CASES) ok(named(line) === want, `"${line}" -> ${want ?? 'no preset'} (got ${named(line) ?? 'none'})`);
// (the civic presets are the civic shortlist's: Fountains Abbey is a civic entry, not a monument)
ok(!T.presetsNamed('fountains abbey').length && D.shortlist('fountains abbey').some((o) => o.id === 'fountains_abbey'), 'a civic preset stays on the civic shortlist');

// ---- the offers
const sal = T.presetOffer('cathedral:salisbury')!;
ok(sal && sal.scale === 3 && sal.kind === 'cathedral' && sal.title === 'Salisbury Cathedral' && sal.blocks > 1000 && sal.jobs > 5 && sal.stages > 1 && sal.score === T.PRESET_SCORE,
  `Salisbury at 1:3: ${sal?.width}x${sal?.depth}, ${sal?.height} high, ${sal?.blocks} blocks, ${sal?.jobs} parts, ${sal?.stages} stages`);
const conwy = T.presetOffer('castle:conwy')!;
ok(conwy?.kind === 'castle' && conwy.title === 'Conwy Castle' && conwy.blocks > 500, `Conwy at 1:3: ${conwy?.width}x${conwy?.depth}, ${conwy?.blocks} blocks, ${conwy?.jobs} parts`);
ok(T.presetOffer('castle:white_tower')?.title === 'the White Tower of London' && T.presetOffer('cathedral:york')?.title === 'York Minster', 'titles: the White Tower of London, York Minster');
ok(T.presetOffer('cathedral:lavenham_church') === null && T.presetOffer('cathedral:nowhere') === null, 'a civic or unknown preset is no offer');
const line = D.offerLine(sal);
ok(/^- cathedral:salisbury: Salisbury Cathedral, a cathedral \(\d+x\d+, \d+ high, \d+ blocks; the real one at 1:3, built in \d+ parts\)$/.test(line), `the offer line: ${line}`);
ok(T.presetShortlist('build salisbury cathedral here')[0]?.id === 'cathedral:salisbury', 'the shortlist puts it first');

// ---- the Mayor's prompt
const sys = P.talkSystem('mayor', true);
ok(/cathedral or castle on that list is built at 1:3/.test(sys) && /size limits below are for designed works only/.test(sys), 'the prompt: a listed cathedral or castle is taken whatever its size');
ok(/larger than about 30x30x30/.test(sys), 'the prompt: designed works keep the 30x30x30 limit');

// ---- presetPick
const offers = [sal, ...D.shortlist('salisbury cathedral')];
ok(T.presetPick({ kind: 'build', work: 'cathedral:salisbury' }, offers)?.id === 'cathedral:salisbury', 'a pick of the preset');
ok(T.presetPick({ kind: 'build', work: 'Salisbury Cathedral' }, offers)?.id === 'cathedral:salisbury', 'a pick by its title');
// (requestbench 11-14: gpt-oss wrote "conwy", "white_tower" and "cathedral" for the ids)
ok(T.presetPick({ kind: 'build', work: 'cathedral' }, offers)?.id === 'cathedral:salisbury' && T.presetPick({ kind: 'build', work: 'salisbury' }, offers)?.id === 'cathedral:salisbury', 'loose: "cathedral", "salisbury"');
ok(T.presetPick({ kind: 'build', work: 'conwy' }, T.presetShortlist('conwy castle'))?.id === 'castle:conwy' && T.presetPick({ kind: 'build', work: 'white_tower' }, T.presetShortlist('the white tower'))?.id === 'castle:white_tower', 'loose: "conwy", "white_tower"');
ok(T.presetPick({ kind: 'build', work: 'Tower of London' }, T.presetShortlist('the white tower'))?.id === 'castle:white_tower', 'loose: a name of it');
ok(T.presetPick({ kind: 'refuse' }, offers)?.id === 'cathedral:salisbury', 'a refusal while a preset matched: the preset');
ok(T.presetPick({ kind: 'build', work: 'design' }, offers)?.id === 'cathedral:salisbury', '"design" while a preset matched: the preset');
ok(T.presetPick({ kind: 'build', work: offers[1]?.id ?? 'x' }, offers) === undefined, 'a pick of another listed building stands');
ok(T.presetPick({ kind: 'refuse' }, D.shortlist('blue glass pyramid')) === undefined, 'no preset matched: nothing');

// ---- talkAct and talkCivicStart on a stub world
type Bot = { name: string; memory: { villageRole: string } };
const mayor: Bot = { name: 'Mayor', memory: { villageRole: 'mayor' } };
function world(v: Record<string, unknown>) {
  const said: string[] = [];
  const w = Object.create(MineflayerWorld.prototype) as Record<string, any>;
  Object.assign(w, {
    growMembers: () => Array.from({ length: 25 }, (_, i) => ({ name: `M${i}` })), talkSay: (_n: string, l: string) => said.push(l), mayorOf: () => mayor,
    talkPlace: () => null, catalogWoodOf: () => 'spruce', dyeCounts: () => ({}), flowerCounts: () => ({}), makeableColours: () => new Set<string>(),
    materials: { plan: () => ({ fuel: { smelts: 400 } }) }, villages: { save: () => {}, note: () => {}, villages: new Map([[String(v.name).toLowerCase(), v]]) },
    monumentNews: () => {}, civicTick: () => true, monumentAt: new Map([[String(v.name), Infinity]]), talkDesignStart: () => said.push('DESIGN'),
  });
  return { w, said };
}
P.initTalk(null);
let n = 0;
const ask = (text: string, p: Partial<ReturnType<typeof P.parseRespond> & object>) => {
  const v: Record<string, any> = { name: `TP${++n}`, complete: true, storageHut: {}, designs: {}, plots: [], structures: [] };
  const s = world(v);
  const r = P.addRequest({ village: v.name, from: 'Sam', to: 'Mayor', text, at: Date.now(), pos: { x: 0, y: 64, z: 0 } });
  const asks = P.withoutPlace(text);
  const designs = [...T.presetShortlist(asks), ...D.shortlist(asks)];
  s.w.talkAct(v, mayor, r, { kind: 'build', say: 'Gladly!', ...p }, [], [], designs);
  return { ...s, v, r: P.requestById(r.id)! };
};
for (const [text, p, id] of [
  ['build salisbury cathedral here', { work: 'cathedral:salisbury', place: 'here' }, 'cathedral:salisbury'],
  ['build salisbury cathedral here', { kind: 'refuse', say: 'Sorry, too big.', reason: 'A cathedral is too large; we build up to 30x30x30', nearest: 'st_mary_redcliffe' }, 'cathedral:salisbury'],
  ['build conwy castle', { work: 'design', what: 'a castle' }, 'castle:conwy'],
  ['a copy of notre dame', { work: 'cathedral:notre_dame' }, 'cathedral:notre_dame'],
] as Array<[string, Record<string, string>, string]>) {
  const t = ask(text, p);
  ok(t.r.status === 'queued' && t.r.piece === D.civicPiece(id) && (t.r.eta ?? 0) >= 10, `"${text}" (${p.kind ?? 'build'} ${p.work ?? ''}): queued as ${id} (${t.r.status} ${t.r.piece}, ETA ${t.r.eta})`);
  if (process.env.VERBOSE) console.log(t.said[0]);
  if (p.kind === 'refuse') ok(!/sorry|too big/i.test(t.said[0] ?? ''), `an overridden refusal says no sorry: ${t.said[0]}`);
  ok(/at 1:3: \d+x\d+, \d+ high, \d+ blocks in \d+ parts over \d+ stages; about [\d.]+ (min|hours) of work for our 25 members/.test(t.said[0] ?? ''), `the Mayor says its size and ETA: ${t.said[0]}`);
  // (begun when the village is free: an asked monument record of that type and preset at 1:3)
  ok(t.w.talkCivicStart(t.v, t.r, Date.now()) === true, `${id} begins`);
  const m = t.v.monument, want = M.parsePresetId(id)!;
  ok(m && M.monumentType(m) === want.type && m.preset === want.preset && m.scale === 3 && M.m3(m).askedBy === 'Sam' && M.presetIdOf(m) === id && P.requestById(t.r.id)?.status === 'under_way',
    `the record: ${m && M.monumentType(m)} ${m?.preset} 1:${m?.scale}, asked by ${m && M.m3(m).askedBy}`);
  if (id === 'cathedral:salisbury' && p.place) {
    // (built: it leaves the monument's place under its typed id, and the request is done)
    m.state = 'built';
    t.w.monumentTick(t.v);
    const c = (t.v.civics ?? [])[0];
    ok(!t.v.monument && c?.preset === id && c.kind === 'cathedral' && c.blocks === sal.blocks, `built: in civics as ${c?.preset} (${c?.kind}, ${c?.blocks} blocks)`);
    ok(P.requestById(t.r.id)?.status === 'done' && /Salisbury Cathedral is finished/.test(t.said.at(-1) ?? ''), `the request done: ${t.said.at(-1)}`);
  }
}
// (a second Salisbury while one is under way: refused with why)
{
  const t = ask('build salisbury cathedral here', { work: 'cathedral:salisbury' });
  t.w.talkCivicStart(t.v, t.r, Date.now());
  const r2 = P.addRequest({ village: t.v.name, from: 'Ann', to: 'Mayor', text: 'salisbury cathedral please', at: Date.now() });
  t.w.talkAct(t.v, mayor, r2, { kind: 'build', say: 'Yes!', work: 'cathedral:salisbury' }, [], [], T.presetShortlist('salisbury cathedral'));
  ok(P.requestById(r2.id)?.status === 'refused' && /being built already/.test(P.requestById(r2.id)?.reason ?? ''), `a second Salisbury: ${P.requestById(r2.id)?.reason}`);
}
// (the village's own monument, finished, gives its place to an asked record and takes it back after; while it is still
// being built the record waits)
{
  const t = ask('build conwy castle', { work: 'castle:conwy' });
  const own = M.newMonument('spruce', Date.now());
  own.state = 'built';
  own.done = M.monumentPlan(own).jobs.map((_, i) => i);
  const rest = M.monumentPlan(own).jobs.length - 1;
  own.done = own.done.slice(0, rest);
  t.v.monument = own;
  ok(M.monumentHolds(t.v) && t.w.talkCivicStart(t.v, t.r, Date.now()) === false && t.v.monument === own, 'an own monument with a job left: the asked record waits');
  own.done = M.monumentPlan(own).jobs.map((_, i) => i);
  ok(M.ownMonumentDone(t.v) && !M.monumentHolds(t.v), 'the own monument finished: it holds the place no longer');
  ok(t.w.talkCivicStart(t.v, t.r, Date.now()) === true && t.v.monumentDone === own && t.v.monument !== own && M.presetIdOf(t.v.monument) === 'castle:conwy',
    `the asked castle begins beside the finished monument (${t.v.monument && M.presetIdOf(t.v.monument)})`);
  t.v.monument.state = 'built';
  t.w.monumentTick(t.v);
  ok(t.v.monument === own && !t.v.monumentDone && t.v.civics?.at(-1)?.preset === 'castle:conwy' && P.requestById(t.r.id)?.status === 'done',
    'built: the castle in civics, the own monument back in its place');
  // (a second asked record later begins the same way; a person's preset record never counts as the own monument)
  const t2 = P.addRequest({ village: t.v.name, from: 'Ann', to: 'Mayor', text: 'york minster please', at: Date.now() });
  P.updateRequest(t2.id, { kind: 'build', status: 'queued', piece: D.civicPiece('cathedral:york') });
  ok(t.w.talkCivicStart(t.v, P.requestById(t2.id)!, Date.now() + 864e5) === true && t.v.monumentDone === own && M.monumentHolds(t.v), 'a second asked record begins; it holds the place');
  // (set aside with no record in its place, as after a lost record: monumentTick puts it back, no new monument begun)
  delete t.v.monument;
  t.w.monumentTick(t.v);
  ok(t.v.monument === own && !t.v.monumentDone, 'an own monument set aside with nothing in its place is put back');
}
// (the designed way and the refusal stay as they were)
{
  const t = ask('build a blue glass pyramid', { work: 'design', what: 'a blue glass pyramid' });
  ok(t.said[0] === 'DESIGN' && t.r.status !== 'queued', 'a blue glass pyramid goes to the architect');
  const e = ask('build the eiffel tower', { kind: 'refuse', say: 'Sorry.', reason: 'it is larger than 30x30x30' });
  ok(e.r.status === 'refused', 'the Eiffel Tower: refused as before');
}

// ---- flag off
A.setTalkPresets({ on: false });
ok(!T.presetsNamed('build salisbury cathedral here').length && !T.presetShortlist('conwy castle').length, 'off: no preset matched');
ok(!/cathedral or castle on that list/.test(P.talkSystem('mayor', true)), 'off: the old prompt');
{
  const t = ask('build salisbury cathedral here', { kind: 'refuse', say: 'Sorry, too big.', reason: 'A cathedral is too large; we build up to 30x30x30', nearest: 'st_mary_redcliffe' });
  ok(t.r.status === 'refused' && /30x30x30/.test(t.r.reason ?? ''), `off: the old refusal (${t.r.reason})`);
}
A.setTalkPresets({ on: true });

console.log(`talk_presets: ${fail ? 'FAIL' : 'all'} ${pass} of ${pass + fail} passed`);
process.exit(fail ? 1 : 0);
