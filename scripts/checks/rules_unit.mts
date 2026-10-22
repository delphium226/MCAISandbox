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
ok(rules.validate('levy', { rate: 25 })?.includes('steps of 10') && rules.validate('zone', {}) === 'zones are not built yet', 'levy and zone');
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
const l2 = rules.addLaw(V, 'Ada', { what: 'Storage keeps at least 16 torches' }, at(1, 0.92));
rules.backLaw(V, l2.id, 'Ben');
rules.backLaw(V, l2.id, 'Dev');
const l3 = rules.addLaw(V, 'Ben', { what: 'Every member tends pens once a day' }, at(1, 0.93));
for (const n of ['Ada', 'Clara', 'Dev']) rules.backLaw(V, l3.id, n);
const ag = council.agenda(V, 2);
ok(ag.length === 2 && ag[0].id === l3.id && ag.some((l) => l.id === l1.id) && !ag.some((l) => l.id === l2.id), `ranked by backing; one of Ada's (a quarter) (${ag.map((l) => l.id)})`);

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
ok(council.meeting(V, 2)?.items.length === 2, 'the agenda set at dawn');
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

console.log(`rules_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
