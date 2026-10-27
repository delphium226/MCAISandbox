/**
 * G3's rules and council (rules.ts, council.ts, #30), offline: bands, laws read from words and from typed fields, refusals
 * out of band, backing, the agenda's caps (2 backers net, 3 items, a quarter a proposer), the ballot prompt (no member
 * named, yes and no shuffled), ballots parsed in gpt-oss's shapes, the count (quorum, 60%, a tie fails), a whole dusk on a
 * fake clock with scripted ballots, enacting and superseding, the quota and floor predicates with the takes ledger, the
 * rules line and the council's line (totals only), and the night's laws with the touch rule.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/rules_unit.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-unit-'));
process.env.MC_MEMORY = 'on';
process.env.MC_CLOCK = 'on';
process.env.MC_DAY_MIN = '20';
process.env.MC_RULES = 'on';
process.env.MC_COUNCIL = 'on';
process.env.MC_CHOOSE = 'scripted';
process.env.MCAI_ACTS_LOG = path.join(dir, 'acts.jsonl');

const mem = await import('../../server/src/memory');
const rules = await import('../../server/src/rules');
const council = await import('../../server/src/council');
const soc = await import('../../server/src/society');

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL ${what}`);
  }
};

// Bands and reading
ok(rules.validate('quota', { class: 'logs', n: 8 }) === null && rules.validate('quota', { class: 'food', n: 8 })?.includes('never food') && rules.validate('quota', { class: 'logs', n: 99 })?.includes('1 to 64'), 'quota bands');
ok(rules.validate('levy', { rate: 25 })?.includes('steps of 10') && /must name a place/.test(rules.validate('zone', { use: 'nobuild', area: 'the moon' }) ?? ''), 'levy and zone');
// Zones: read from words, the place found on the village, the boxes and the conflict by use
const zr = rules.readZone('No new buildings may be built on the north green, so we keep space for festivals.');
ok(zr?.use === 'nobuild' && zr.area === 'north green', `a zone read (${JSON.stringify(zr)})`);
ok(rules.readZone('The fields are kept for farming only.')?.use === 'farms' && rules.readZone('Keep the storage hut clear.')?.area === 'storage hut', 'farms only; keep clear');
ok(rules.readLaw({ what: 'Nothing is built on Oak Row.' }).type === 'zone', 'readLaw takes zones');
const fakeV = { name: 'Testvale', layouts: [{ x1: 0, z1: 0, x2: 40, z2: 40, buildings: [], green: { x1: 10, z1: 10, x2: 20, z2: 20 } }, { x1: 100, z1: 0, x2: 130, z2: 30, buildings: [], name: 'Oak Row', grow: 1 }, { x1: 60, z1: 60, x2: 70, z2: 70, buildings: [], field: true }], storageHut: { x1: 2, z1: 2, x2: 8, z2: 8, spots: [] } } as never;
ok(rules.placeArea(fakeV, 'north green')?.name === 'the green' && rules.placeArea(fakeV, 'oak row')?.box.x1 === 100 && rules.placeArea(fakeV, 'the farms')?.name === 'the fields' && rules.placeArea(fakeV, 'the moon') === null, 'places found');
rules.setZoneVillages((n) => (n === 'Testvale' ? fakeV : undefined));
const r1 = rules.readLaw({ what: 'Each member takes at most 8 logs a day from storage' });
ok(r1.type === 'quota' && r1.params.class === 'logs' && r1.params.n === 8, `a quota read from words (${JSON.stringify(r1)})`);
const r2 = rules.readLaw({ what: 'Storage should always keep at least 32 bread.' });
ok(r2.type === 'floor' && r2.params.item === 'bread' && r2.params.n === 32, `a floor (${JSON.stringify(r2)})`);
const r3 = rules.readLaw({ what: 'A levy of 20% on every share' });
ok(r3.type === 'levy' && r3.params.rate === 20, 'a levy');
const r4 = rules.readLaw({ what: 'Every member tends pens once a day' });
ok(r4.type === 'duty' && r4.params.kind === 'penwork', `a duty (${JSON.stringify(r4)})`);
ok(rules.readLaw({ what: 'Be kind to each other always' }).type === 'norm', 'a custom in words is a norm');
ok(rules.readLaw({ what: 'x', rule: { type: 'floor', params: { item: 'torch', n: 16 } } }).params.item === 'torch', 'typed fields');

mem.initMemory(dir);
const V = 'Testvale';
const T0 = 1_950_000_000_000;
const MIN = 60000;
const names = ['Ada', 'Ben', 'Clara', 'Dev', 'Elena', 'Finn'];
for (const n of names) mem.noteSpawn(V, n, { role: 'worker', brain: 'tiered', memory: {}, reset: true }, T0);
const epoch = mem.villageMemory(V)!.epoch;
const at = (day: number, frac: number) => epoch + ((day - 1) + frac) * 20 * MIN;

// Laws, backing, the agenda
const bad = rules.addLaw(V, 'Ada', { what: 'Each member takes at most 99 logs a day' }, at(1, 0.9));
ok(bad.status === 'refused' && bad.refused?.includes('1 to 64'), 'an out-of-band law refused with the reason');
const l1 = rules.addLaw(V, 'Ada', { what: 'Each member takes at most 8 logs a day from storage', why: 'logs run short' }, at(1, 0.9));
ok(l1.status === 'open' && l1.text === 'each member takes at most 8 logs a day from storage', 'a law with code\'s text');
ok(!rules.backLaw(V, l1.id, 'Ada'), 'never one\'s own');
rules.backLaw(V, l1.id, 'Ben');
ok(council.agenda(V, 2).length === 0, 'one backer: not on the agenda');
rules.backLaw(V, l1.id, 'Clara');
ok(!rules.backLaw(V, l1.id, 'Clara'), 'once a member');
// (the user's, 10-23: one open law a member; the same rule again joins the open one as a backing)
const held = rules.addLaw(V, 'Ada', { what: 'Storage keeps at least 16 torches' }, at(1, 0.92));
ok(held.status === 'refused' && held.id === l1.id && /still waiting/.test(held.refused ?? ''), `a second open law of Ada's held (${held.refused})`);
const l2 = rules.addLaw(V, 'Elena', { what: 'Storage keeps at least 16 torches' }, at(1, 0.92));
rules.backLaw(V, l2.id, 'Ben');
const l3 = rules.addLaw(V, 'Ben', { what: 'Every member tends pens once a day' }, at(1, 0.93));
for (const n of ['Ada', 'Clara', 'Dev']) rules.backLaw(V, l3.id, n);
const j = rules.addLaw(V, 'Finn', { what: 'Each villager may take up to 12 birch logs from storage per day.' }, at(1, 0.94));
ok(j.id === l1.id && l1.backers.includes('Finn') && l1.joined?.includes('Finn') && rules.laws(V).filter((l) => l.status === 'open').length === 3, `the same rule joins the open one (${j.id}, ${l1.backers})`);
const ag = council.agenda(V, 2);
ok(ag.length === 2 && ag[0].id === l1.id && ag.some((l) => l.id === l3.id) && !ag.some((l) => l.id === l2.id), `ranked by backing; one backer not enough (${ag.map((l) => l.id)})`);
rules.backLaw(V, l2.id, 'Dev');

// The ballot prompt and parsing
const bp = council.ballotPrompt(V, 'Dev', ag, '', at(2, 0.8));
ok(!names.some((n) => n !== 'Dev' && new RegExp(`\\b${n}\\b`).test(bp.user)) && bp.user.includes('proposed by a member'), 'no member named on a ballot');
const pb = council.parseBallot({ votes: [{ item: l3.id, reason: 'x', vote: 'Yes' }, { id: l1.id, choice: 'against' }] }, ag);
ok(pb[l3.id] === 'yes' && pb[l1.id] === 'no', `ballots read (${JSON.stringify(pb)})`);
ok(council.parseBallot(JSON.stringify({ votes: { [l1.id]: 'abstain' } }), ag)[l1.id] === 'abstain', 'a stringified, keyed ballot');

// The count
const cast = { a: { x: 'yes' }, b: { x: 'yes' }, c: { x: 'yes' }, d: { x: 'no' }, e: { x: 'no' } } as Record<string, Record<string, 'yes' | 'no' | 'abstain'>>;
ok(council.count(cast, 'x', 6).passed && council.count(cast, 'x', 6).yes === 3, '3 to 2: 60%, passes');
ok(!council.count({ a: { x: 'yes' }, b: { x: 'no' } }, 'x', 4).passed, 'a tie fails');
ok(!council.count({ a: { x: 'yes' }, b: { x: 'yes' } }, 'x', 6).passed, 'no quorum fails');

// A whole day 2 on the clock: agenda at dawn, scripted ballots at dusk, the count at mid-night
const members = names.map((name) => ({ name, persona: '' }));
council.councilTick(V, members, at(2, 0.05));
ok(council.meeting(V, 2)?.items.length === 3, 'the agenda set at dawn (l2 backed twice since)');
ok(council.councilLine(V, at(2, 0.3)).startsWith("Tonight's ballot:"), 'the dawn line');
for (const f of [0.76, 0.8, 0.84, 0.88, 0.9]) council.councilTick(V, members, at(2, f));
await new Promise((r) => setTimeout(r, 20));
council.councilTick(V, members, at(2, 0.93));
const m2 = council.meeting(V, 2)!;
ok(m2.tallied && Object.keys(m2.cast).length === names.length, `every member cast, tallied (${Object.keys(m2.cast).length})`);
const passed = Object.entries(m2.result ?? {}).filter(([, r]) => r.passed).map(([id]) => id);
ok(rules.rulesInForce(V).length === passed.length, `passed laws in force (${passed})`);
const line = council.councilLine(V, at(3, 0.2));
ok(line.includes('At the last vote:') && !names.some((n) => line.includes(n)), `totals only (${line})`);

// Enforcement
const quota = rules.enact(V, { ...l1, status: 'passed' }, { yes: 4, no: 1, abstain: 0 }, at(3, 0.1));
ok(rules.breaks(V, 'Finn', { birch_log: 6 }, {}, at(3, 0.2)) === null, 'within the quota');
rules.noteTakes(V, 'Finn', { birch_log: 6 }, at(3, 0.2));
ok(rules.breaks(V, 'Finn', { birch_planks: 4 }, {}, at(3, 0.3))?.startsWith('the quota:'), 'over the quota (planks count as logs)');
ok(rules.breaks(V, 'Finn', { birch_planks: 4 }, {}, at(4, 0.3)) === null, 'a new day');
rules.enact(V, { ...l2, status: 'passed' }, { yes: 4, no: 1, abstain: 0 }, at(3, 0.1));
ok(rules.breaks(V, 'Ada', { torch: 8 }, { torch: 20 }, at(3, 0.3))?.startsWith('the floor:') && rules.breaks(V, 'Ada', { torch: 4 }, { torch: 20 }, at(3, 0.3)) === null, 'the floor');
const q2 = rules.enact(V, { ...l1, id: 'l9', params: { class: 'logs', n: 20 }, text: 'each member takes at most 20 logs a day from storage', status: 'passed' }, { yes: 5, no: 0, abstain: 0 }, at(3, 0.4));
ok(quota.supersededBy === q2.id && rules.rulesInForce(V).filter((r) => r.type === 'quota').length === 1, 'a new quota supersedes the old');
ok(rules.rulesLine(V).startsWith('Village rules:') && rules.rulesLine(V).includes('20 logs'), 'the rules line');

// The night's laws and the touch rule
mem.noteEnd(V, 'Elena', { kind: 'make', option: 'make:torch', name: 'Make torches', ok: true, productive: true, cut: false, minutes: 1, line: 'Make torches: done, 1 min', message: '' }, at(3, 0.5));
const l4 = rules.addLaw(V, 'Dev', { what: 'Storage keeps at least 8 torch' }, at(3, 0.86));
const d1 = soc.applyLaws(V, 'Finn', { back_laws: [{ id: l4.id }] }, 3, at(3, 0.9));
const d2 = soc.applyLaws(V, 'Elena', { back_laws: [l4.id], law: { what: 'Every member lights the village once a day' } }, 3, at(3, 0.9));
ok(!d1.length && d2.includes(`backed ${l4.id}`) && d2.some((x) => x.startsWith('law l')), `backing counts where the day touched it; a law proposed (${d1} | ${d2})`);

// The levy: its rate, the line, the decision's share field and its answer
ok(rules.levyRate(V) === undefined, 'no levy by default');
rules.setRulesSettings({ levy: 0.2 });
ok(rules.levyRate(V) === 0.2 && rules.rulesLine(V).includes('members leave 20% of their share'), "MC_LEVY's levy in the line");
rules.enact(V, { id: 'lv', by: 'Ada', at: 0, day: 3, type: 'levy', params: { rate: 30 }, text: 'members leave 30% of their share in the village storage', what: '', why: '', backers: [], opposers: [], status: 'passed' } as never, { yes: 4, no: 2, abstain: 0 }, at(4, 0.1));
ok(rules.levyRate(V) === 0.3 && !rules.rulesLine(V).includes('20%'), 'a voted levy replaces it');
rules.setRulesSettings({ levy: undefined });
const { buildPrompt, choose } = await import('../../server/src/choose');
const opt = { id: 'make:x', kind: 'make', key: 'make:x', name: 'Make x', facts: '', effect: '', rank: 1, holds: [] } as never;
const share = { total: 10, levy: 3, answers: [{ id: 'all' as const, text: 'Leave all 10' }, { id: 'none' as const, text: 'Keep all 10' }, { id: 'levy' as const, text: 'Leave 3 of 10' }] };
const menu = { agent: 'Ada', village: V, t: 0, options: [opt, { ...(opt as object), id: 'make:y', key: 'make:y', name: 'Make y' }], guarded: [], reasons: {}, ctx: { persona: '', village: '', others: '', outcomes: [], share } } as never;
const pp = buildPrompt(menu, (menu as { options: never[] }).options);
ok(pp.user.includes('your share of them is 10') && !/levy|rule/i.test(pp.user.split('your share')[1].split('\n')[0]) && JSON.stringify(pp.tools).includes('Leave 3 of 10'), 'the share asked by amounts only');
const fake = (async () => ({ reply: { calls: [{ name: 'choose', input: { reason: 'r', choice: 'Make x', share: 'Leave 3 of 10' } }], text: '' }, ms: 1, waitMs: 0 })) as never;
const res = await choose({ agent: 'Ada', spec: { provider: 'ollama', model: 'm' } as never, level: 'low', menu, seed: 's', call: fake });
ok(res.id === 'make:x' && res.share === 'levy', `the answer read (${res.share})`);

// A zone voted: the green kept free of building; the fields kept for farms
const zl = rules.addLaw(V, 'Grace', { what: 'Nothing new is built on the green' }, at(5, 0.02));
ok(zl.status === 'open' && zl.params.place === 'the green' && zl.params.x1 === 10 && zl.text === 'nothing new is built on the green', `a zone law found its place (${zl.text})`);
ok(rules.addLaw(V, 'Hugo', { what: 'No houses on the moon' }, at(5, 0.02)).status === 'refused', 'an unknown place refused');
rules.enact(V, { ...zl, status: 'passed' }, { yes: 5, no: 0, abstain: 0 }, at(5, 0.03));
ok(/the zone rule/.test(rules.zoneConflict(V, { x1: 15, z1: 15, x2: 25, z2: 25 }, 'build') ?? '') && rules.zoneConflict(V, { x1: 21, z1: 21, x2: 25, z2: 25 }, 'build') === null, 'building on the green refused, beside it allowed');
ok(!!rules.zoneConflict(V, { x1: 15, z1: 15, x2: 16, z2: 16 }, 'farm'), 'kept free: no farm either');
const fl = rules.addLaw(V, 'Iris', { what: 'The fields are kept for farming.' }, at(5, 0.04));
rules.enact(V, { ...fl, status: 'passed' }, { yes: 5, no: 0, abstain: 0 }, at(5, 0.05));
ok(!!rules.zoneConflict(V, { x1: 65, z1: 65, x2: 66, z2: 66 }, 'build') && rules.zoneConflict(V, { x1: 65, z1: 65, x2: 66, z2: 66 }, 'farm') === null, 'kept for farms: farms allowed, building not');

// Long1's shapes (F2xx): the law under its own key, fields only, a sentence, nothing
ok(rules.lawFrom({ dailyToolQuota: 'Each member may take up to 3 tools from storage per day.' })?.what.startsWith('Each member may take up to 3'), 'a law under its own key');
ok(/at least 20 charcoal/.test(rules.lawFrom({ charcoal_minimum: { item: 'charcoal', minimum: 20, reason: 'r' } })?.what ?? ''), 'a law in fields');
ok(rules.lawFrom({ 'each member puts at least 2 birch logs into storage each day': null })?.what.startsWith('each member puts') && rules.lawFrom({ 'storage keeps at least 5 coal': true })?.what === 'storage keeps at least 5 coal', 'the sentence as the key');
ok(rules.lawFrom({ 'each member does a kind of work once a day': true }) === null, "the prompt's template echoed is none");
ok(rules.lawFrom('Every villager must light one spot a day.')?.what.startsWith('Every') && rules.lawFrom(null) === null && rules.lawFrom({}) === null && rules.lawFrom('none') === null, 'a sentence; none');
const rc = rules.readLaw({ what: 'Each villager must deposit at least one stack of any type of logs into the communal storage every day.' });
ok(rc.type === 'contribute' && rc.params.class === 'logs' && rc.params.n === 64, `a contribution (${JSON.stringify(rc)})`);
ok(rules.readLaw({ what: 'Each villager must add at least one item to the communal storage before nightfall.' }).params.class === 'goods', 'any goods');
ok(rules.readLaw({ what: 'Each villager may take no more than 2 meals from storage per day.' }).params.class === 'food' && !!rules.validate('quota', { class: 'food', n: 2 }), 'a meal quota read, refused');

// The contribution: puts by member-day, the options that put the class tagged until met, the day judged
const cr = rules.enact(V, { id: 'l50', by: 'Ada', at: 0, day: 4, type: 'contribute', params: { class: 'torches', n: 2 }, text: rules.ruleText('contribute', { class: 'torches', n: 2 }), what: '', why: '', backers: [], opposers: [], status: 'passed' } as never, { yes: 5, no: 1, abstain: 0 }, at(5, 0.05));
ok(cr.text === 'each member puts at least 2 torches a day into storage', cr.text);
ok(rules.contributeTag(V, 'Ben', 'make:torch', at(5, 0.1)) === null, 'no tag before the option is known to put torches');
rules.notePuts(V, 'Ada', 'make:torch', { torch: 1 }, at(5, 0.1));
ok(rules.contributeTag(V, 'Ben', 'make:torch', at(5, 0.2))?.includes('2 torches') && rules.contributeTag(V, 'Ben', 'gather:sand', at(5, 0.2)) === null, 'the option that put torches tagged');
rules.notePuts(V, 'Ben', 'make:torch', { torch: 3 }, at(5, 0.3));
ok(rules.contributeTag(V, 'Ben', 'make:torch', at(5, 0.4)) === null, 'met: no tag');
const before = fs.readFileSync(path.join(dir, 'acts.jsonl'), 'utf8').length;
rules.judgeDays(V, ['Ada', 'Ben'], at(6, 0.1));
const judged = fs.readFileSync(path.join(dir, 'acts.jsonl'), 'utf8').slice(before).split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.op === 'day' && r.rule === cr.id);
ok(judged.length === 2 && judged.find((r) => r.agent === 'Ben')?.met === true && judged.find((r) => r.agent === 'Ada')?.met === false, `day 5 judged (${JSON.stringify(judged.map((r) => [r.agent, r.met]))})`);

// The adversarial check's probes (10-23): no zone in a purpose clause or a path; numbers far apart do not join; a rule in
// force is not put up again; a law's "none" is an abstention; many classes are a list
ok(rules.readLaw({ what: 'Each member takes at most 6 logs a day from storage so nothing is built in a rush.' }).type === 'quota', 'a purpose clause is no zone');
ok(rules.readLaw({ what: 'Each villager must deposit at least 2 torches into storage each day so nothing is built in the dark.' }).type === 'contribute', 'nor here');
ok(rules.placeArea(fakeV, 'path to the mine') === null && rules.placeArea(fakeV, 'storage hut')?.name === 'the storage hut', 'the whole phrase must be the place');
const q3 = rules.addLaw(V, 'Jonah', { what: 'Each member may take up to 3 torches from storage per day.' }, at(5, 0.06));
const q30 = rules.addLaw(V, 'Kai', { what: 'Each member may take up to 30 torches from storage per day.' }, at(5, 0.06));
const q4 = rules.addLaw(V, 'Lena', { what: 'Each member may take up to 4 torches from storage per day.' }, at(5, 0.06));
ok(q30.id !== q3.id && q4.id === q3.id && !q3.backers.includes('Kai'), `3 and 30 stay apart, 4 joins 3 (${q3.id} ${q30.id} ${q4.id})`);
const again = rules.addLaw(V, 'Mia', { what: 'Each member puts at least 2 torches into storage each day' }, at(5, 0.07));
ok(again.status === 'refused' && /already a village rule/.test(again.refused ?? ''), `a rule in force not put up again (${again.refused})`);
ok(council.parseBallot({ votes: [{ item: l1.id, vote: 'none' }] }, [l1])[l1.id] === 'abstain', "a law's none is an abstention");
// (rulebench's shapes: no item on a one-item ballot, a [id, vote] pair, "reason; Yes", and items in the shown order)
ok(council.parseBallot({ votes: [{ reason: 'r', vote: 'yes' }] }, [l1])[l1.id] === 'yes' && council.parseBallot({ votes: [[l1.id, 'no']] }, [l1])[l1.id] === 'no' && council.parseBallot({ votes: ['Limit logs; Yes'] }, [l1])[l1.id] === 'yes', 'ballots without the item');
const two = council.parseBallot({ votes: [{ vote: 'no' }, { vote: 'yes' }] }, [l1, l3], {}, [l3.id, l1.id]);
ok(two[l3.id] === 'no' && two[l1.id] === 'yes', `in the order shown (${JSON.stringify(two)})`);
const three = council.parseBallot({ votes: [`${l3.id}: Keeps pens tended; yes`, `${l1.id}: Too strict; no`] }, [l1, l3]);
ok(three[l3.id] === 'yes' && three[l1.id] === 'no' && council.parseBallot({ votes: ['Bread stock helps, so yes.'] }, [l1])[l1.id] === 'yes' && council.parseBallot({ votes: [{ decision: 'no' }] }, [l1])[l1.id] === 'no', 'sentences with the item first, "so yes", a decision key');
ok(rules.readLaw({ what: 'Each villager must place at least one log or torch into the communal storage each day.' }).params.class === 'logs+torches', 'logs or torches: a list');
ok(rules.lawFrom('No new buildings on the green.')?.what === 'No new buildings on the green.' && rules.lawFrom({ 'No new law tonight, things are fine': true }) === null, 'a sentence starting No; a key saying none');
ok(rules.lawFrom({ law_name: 'Torch rule', law_text: 'Each member puts at least 2 torches into storage a day.' })?.what.startsWith('Each member'), 'the longest sentence, not the title');

// The need vote (#1): a need ignored for a day goes on the ballot with its answering chores; the winner weighs 1.5x
council.setCouncilSettings({ needVote: true });
council.noteNeedStatus(V, 'light', 'ignored', '9 unlit spots in 3 buildings', at(6, 0.5));
for (let i = 0; i < 3; i++) council.noteNeedOffer(V, 'light', { id: 'light:1', name: 'Light the houses' });
council.noteNeedOffer(V, 'light', { id: 'make:torch', name: 'Make torches' });
council.councilTick(V, members, at(7, 0.6));
const m7 = council.meeting(V, 7)!;
ok(m7.items.includes('need:light') && m7.needs?.['need:light'].options.map((o) => o.name).join('|') === 'Light the houses|Make torches', `the need item on the agenda (${m7.items})`);
const nb = council.ballotPrompt(V, 'Ada', [], '', at(7, 0.8), m7.needs);
ok(/\[need:light\][^\n]*A: Light the houses; B: Make torches; or none/.test(nb.user) && JSON.stringify(nb.tools).includes('"none"') && !JSON.stringify(nb.tools).includes('"yes"'), 'the need item on the ballot');
ok(council.parseBallot({ votes: [{ item: 'need:light', vote: 'B: Make torches' }] }, [], m7.needs)['need:light'] === 'B' && council.parseBallot({ votes: [{ item: 'need:light', vote: 'none' }] }, [], m7.needs)['need:light'] === 'none', 'need choices read');
ok(council.countNeed({ a: { x: 'A' }, b: { x: 'A' }, c: { x: 'B' } }, 'x', ['A', 'B'], 4).winner === 'A' && council.countNeed({ a: { x: 'A' }, b: { x: 'B' } }, 'x', ['A', 'B'], 4).winner === undefined, 'plurality; a tie chooses none');
for (const f of [0.76, 0.8, 0.84, 0.88, 0.9]) council.councilTick(V, members, at(7, f));
await new Promise((r) => setTimeout(r, 20));
council.councilTick(V, members, at(7, 0.93));
ok(council.meeting(V, 7)?.result?.['need:light']?.winner === 'Light the houses', `the need vote counted (${JSON.stringify(council.meeting(V, 7)?.result?.['need:light'])})`);
ok(council.needBoost(V, 'light:3', at(8, 0.3)).w === 1.5 && council.needBoost(V, 'make:torch', at(8, 0.3)).w === 1 && council.needBoost(V, 'light:3', at(10, 0.3)).w === 1, 'the winner weighs 1.5x on days 8-9 only');
ok(/"Light the houses" won/.test(council.councilLine(V, at(8, 0.2))), `the result line (${council.councilLine(V, at(8, 0.2))})`);
council.setCouncilSettings({ needVote: false });

// Experiment 2 (#33): the levy item (the lower median, influencers out), the imposed arm at the same moment, the dawn line
ok(council.countLevy({ a: { 'levy:rate': '10' }, b: { 'levy:rate': '30' }, c: { 'levy:rate': '20' }, d: { 'levy:rate': '40' } }, 6).rate === 20 && council.countLevy({ a: { 'levy:rate': '10' } }, 6).rate === null, 'the lower median; quorum');
council.setCouncilSettings({ influencers: 'pro', influencerNames: ['Ben'] });
ok(/levy .* should be higher/.test(council.withInfluence('Ben', 'You are Ben.')) && council.withInfluence('Ada', 'You are Ada.') === 'You are Ada.', 'an influencer\'s line, nobody else\'s');
council.setCouncilSettings({ levyVoteDay: 9 });
council.councilTick(V, members, at(9, 0.05));
ok(council.meeting(V, 9)?.items.includes('levy:rate') && council.meeting(V, 9)?.levy === true, 'the levy item on its day');
const lp = council.ballotPrompt(V, 'Ada', [], '', at(9, 0.8), {}, true);
ok(/\[levy:rate\] The levy on members' shares \(now \d+%\)[^\n]*0%, 10%, 20%, 30%, 40%, 50%/.test(lp.user) && JSON.stringify(lp.tools).includes('"30%"'), 'the levy on the ballot, rates in order');
ok(council.parseBallot({ votes: [{ vote: '30 percent' }] }, [], {}, lp.order, true)['levy:rate'] === '30', 'a rate read');
for (const f of [0.76, 0.8, 0.84, 0.88, 0.9]) council.councilTick(V, members, at(9, f));
await new Promise((r) => setTimeout(r, 20));
council.councilTick(V, members, at(9, 0.93));
const m9 = council.meeting(V, 9)!;
ok(!('levy:rate' in (m9.cast.Ben ?? {})) && /^\d+%$/.test(String(m9.result?.['levy:rate']?.winner)), `influencers cast no levy ballot; a rate set (${JSON.stringify(m9.result?.['levy:rate'])})`);
ok(new RegExp(`From today the levy is ${String(m9.result?.['levy:rate']?.winner).replace('%', '')}%, as the village voted last night`).test(council.councilLine(V, at(10, 0.2))) && rules.levyRate(V) === Number(String(m9.result?.['levy:rate']?.winner).replace('%', '')) / 100, `the dawn line; the levy in force (${council.councilLine(V, at(10, 0.2))})`);
council.setCouncilSettings({ levyVoteDay: 0, levySet: { day: 11, rate: 30 } });
council.councilTick(V, members, at(11, 0.6));
ok(rules.levyRate(V) !== 0.3, 'not before the count\'s moment');
council.councilTick(V, members, at(11, 0.93));
ok(rules.levyRate(V) === 0.3 && /From today the levy is 30%\.( |$)/.test(council.councilLine(V, at(12, 0.2))), `the imposed arm: set at the same moment, the same words without the vote (${council.councilLine(V, at(12, 0.2))})`);
council.setCouncilSettings({ levySet: null, influencers: '' });

// #164's repeal (MC_RULE_RESULTS): read by id or words, the rule found in force, its result on the ballot, ended on passing
ok(rules.readLaw({ what: 'Repeal [rl50]: nobody meets it' }).type === 'norm', 'no repeal with the flag off');
rules.setRulesSettings({ results: true });
const rp = rules.readLaw({ what: 'Repeal [rl50]: nobody meets it' });
ok(rp.type === 'repeal' && rp.params.of === 'rl50', `a repeal by id (${JSON.stringify(rp)})`);
ok(rules.readLaw({ what: 'End each day by depositing 2 torches into storage' }).type !== 'repeal', '"end each day" is no repeal');
ok(rules.ruleResults(V, at(13, 0.2)).some((x) => x.startsWith('[rl50] each member puts')), `results carry ids (${rules.ruleResults(V, at(13, 0.2))})`);
ok(rules.addLaw(V, 'Nora', { what: 'Repeal rl99' }, at(13, 0.3)).status === 'refused', 'a repeal of no rule in force refused');
const rw = rules.addLaw(V, 'Omar', { what: 'Drop the rule that each member puts torches into storage' }, at(13, 0.3));
ok(rw.status === 'open' && rw.params.of === 'rl50' && rw.text.startsWith('repeal the rule [rl50]'), `a repeal in words finds its rule (${rw.text} ${rw.refused ?? ''})`);
ok(/its result so far: met by/.test(rules.preview(V, 'repeal', rw.params, at(13, 0.3))), `its result on the ballot (${rules.preview(V, 'repeal', rw.params, at(13, 0.3))})`);
const rbp = council.ballotPrompt(V, 'Ada', [rw], '', at(13, 0.8));
ok(rbp.user.includes('[rl50] each member puts') && rbp.user.includes('its result so far'), 'the ballot shows rules with ids and the repeal\'s result');
mem.noteEnd(V, 'Pia', { kind: 'make', option: 'make:torch', name: 'Make torches', ok: true, productive: true, cut: false, minutes: 1, line: 'Make torches: done, 1 min', message: '' }, at(13, 0.5));
ok(soc.applyLaws(V, 'Pia', { back_laws: [rw.id] }, 13, at(13, 0.9)).includes(`backed ${rw.id}`), 'a repeal backed where its rule touched the day');
ok(soc.lawLines(['x'], []).includes('repeal of a rule in force'), 'the night invites a repeal');
const ended = rules.enact(V, { ...rw, status: 'passed' }, { yes: 5, no: 1, abstain: 0 }, at(13, 0.93));
ok(ended.id === 'rl50' && ended.supersededBy === `r${rw.id}` && !rules.rulesInForce(V).some((r) => r.id === 'rl50') && !rules.rulesInForce(V).some((r) => r.type === 'repeal'), 'repealed: out of force, nothing in its place');
const b2 = fs.readFileSync(path.join(dir, 'acts.jsonl'), 'utf8').length;
rules.judgeDays(V, ['Ada', 'Ben'], at(15, 0.1));
const after = fs.readFileSync(path.join(dir, 'acts.jsonl'), 'utf8').slice(b2).split('\n').filter(Boolean).map((l) => JSON.parse(l));
ok(after.some((r) => r.rule === cr.id && r.day === 13) && !after.some((r) => r.rule === cr.id && r.day === 14), `judged on day 13, not after its repeal (${after.filter((r) => r.rule === cr.id).map((r) => r.day)})`);
ok(fs.readFileSync(path.join(dir, 'acts.jsonl'), 'utf8').includes('"op":"repealed","id":"rl50"'), 'the repeal in the ledger');
rules.setRulesSettings({ results: false });

console.log(`rules_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
