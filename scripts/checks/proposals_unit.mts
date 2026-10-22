/**
 * G5's proposals offline (server/src/proposals.ts; spec runs/2026-10-21/g5-proposals/spec.md 10): code's check on hand
 * cases in this world (impossible, the user's call, already possible, costed, a failing chore), reading items from words,
 * duplicates and endorsement, the store's save and load, the night field's parse (aliases, inferred kinds), the triage
 * reply's parse and code's guard on its verdicts, and MC_PROPOSALS off by default.
 *
 *   npx tsx scripts/checks/proposals_unit.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const P = await import('../../server/src/proposals');
const { offlineCtx } = await import('../proposals_ctx.mts');
const ctx = await offlineCtx();

let pass = 0, fail = 0;
const ok = (c: boolean, what: string) => {
  if (c) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};

ok(!P.PROPOSALS_ON, 'MC_PROPOSALS off by default');

// Reading items
const items = (t: string) => P.readItems(t, ctx.items);
ok(items('We need more stone pickaxes').join() === 'stone_pickaxe', `plurals folded (pickaxes: ${items('We need more stone pickaxes')})`);
ok(items('Make beds for every house').join() === 'white_bed', 'a family word (beds: white_bed)');
ok(!items('Light the streets with lanterns').includes('light'), 'a weak word left out when something else is named');
ok(items('build a bee hive').includes('beehive'), 'an alias (bee hive)');

// Code's check: [kind, what, verdict, route?]
const cases: Array<[string, string, string, string?]> = [
  ['item', 'Mine nether quartz for decorations', 'impossible'],
  ['item', 'Brew potions for the village', 'impossible'],
  ['work', 'Build a stone wall around the village to keep monsters out', 'impossible'],
  ['item', 'Get gunpowder for fireworks', 'have'],
  ['activity', 'Go fishing for cod in the lake', 'have'],
  ['work', 'Build a well in the square', 'have'],
  ['item', 'We need more stone pickaxes', 'have'],
  ['item', 'Make an iron pickaxe so I can mine iron', 'have'],
  ['item', 'Craft lanterns to light the streets', 'have'],
  ['activity', 'Grow more pumpkins on the farms', 'have'],
  ['activity', 'Kill cows for leather to make books', 'user'],
  ['rule', 'Make crops grow faster', 'user', 'config'],
  ['item', 'Make beds for every house so members can sleep', 'ok', 'issue'],
  ['item', 'Make candles for the houses', 'ok'],
  ['work', 'Build a lighthouse by the lake', 'ok', 'issue'],
  ['activity', 'Bottle honey from the bee nests', 'ok', 'foundry'],
];
for (const [kind, what, verdict, route] of cases) {
  const r = P.checkProposal({ kind: kind as never, what, why: '' }, ctx);
  ok(r.check.verdict === verdict && (!route || r.check.route === route), `${what}: ${r.check.verdict}/${r.check.route} (want ${verdict}${route ? `/${route}` : ''}): ${r.check.reason}`);
}
// A failing chore is a fix, never answered with itself
const withFails = { ...ctx, failures: [{ name: 'Start a pumpkin farm of your own by your house', message: 'lay_out_field: no free 9x9 site within 24 blocks of the village', n: 7 }] };
const pf = P.checkProposal({ kind: 'activity', what: 'Let me start a pumpkin farm by my own house', why: '' }, withFails);
ok(pf.check.verdict === 'ok' && pf.check.route === 'issue' && pf.target.failure === 'Start a pumpkin farm of your own by your house', `a failing chore is a fix (${pf.check.verdict}: ${pf.check.reason})`);

// The store, duplicates, endorsement
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'propunit-'));
P.initProposals(dir);
const a = P.addProposal({ village: 'V', by: 'Ada', kind: 'item', what: 'Make candles for the houses', why: 'dark' }, ctx)!;
ok(a.status === 'open' && a.id === 'p1', 'a proposal kept open');
const b = P.addProposal({ village: 'V', by: 'Ben', kind: 'item', what: 'We should craft candles', why: '' }, ctx)!;
ok(b.status === 'duplicate' && b.of === 'p1' && P.proposal('p1')!.endorsements.length === 1, 'a duplicate backs the first');
ok(P.addProposal({ village: 'V', by: 'Ada', kind: 'item', what: 'short', why: '' }, ctx) === null, 'too short refused');
const q = P.addProposal({ village: 'V', by: 'Cleo', kind: 'item', what: 'Mine nether quartz please', why: '' }, ctx)!;
ok(q.status === 'answered' && q.verdict?.by === 'code' && q.verdict.decision === 'reject', "code's own answer for the impossible");
ok(!P.endorse('p1', 'Ada'), 'no backing one\'s own');
ok(!P.endorse('p1', 'Ben'), 'no backing twice');
ok(P.endorse('p1', 'Dev') && P.proposal('p1')!.status === 'endorsed', 'two backers: ready for triage');
P.flushProposals();
const saved = P.serialiseProposals();
P.initProposals(dir);
ok(P.serialiseProposals() === saved, 'the store reloads as it was');
fs.rmSync(dir, { recursive: true, force: true });
P.initProposals(null);
P.loadProposals(saved);

// The night's field
ok(P.parsePropose({ propose: { kind: 'item', what: 'Make candles for the houses', why: 'dark' } })?.kind === 'item', 'parse');
ok(P.parsePropose({ proposal: { content: 'Harvest honey from the nests', reason: 'food' } })?.kind === 'activity', 'aliases and an inferred kind');
ok(P.parsePropose(JSON.stringify({ propose: JSON.stringify({ kind: 'work', what: 'Build a bridge over the river', why: '' }) }))?.what === 'Build a bridge over the river', 'arguments as strings');
ok(P.parsePropose({ propose: { remoteFarmPlots: 'Allow players to claim a small farm plot away from their house' } })?.what === 'Allow players to claim a small farm plot away from their house', 'a proposal written as its own key');
ok(P.parsePropose({ propose: { increasePumpkinFarmPlacementRadius: 5, reason: 'no 9x9 area near my house' } })?.what === 'increase pumpkin farm placement radius (5)' && P.parsePropose({ propose: { increasePumpkinFarmPlacementRadius: 5, reason: 'no 9x9 area' } })?.why === 'no 9x9 area', 'a numeric idea, its reason as why');
ok(P.parsePropose({ propose: { birchLogExchange: { description: 'Create a communal birch log stockpile' } } })?.what === 'Create a communal birch log stockpile', 'a nested description');
ok(P.parsePropose({ notes: [], intention: 'x' }) === null && P.parsePropose({ propose: {} }) === null, 'nothing proposed');
const tool = P.withPropose([{ name: 'reflect', description: '', input_schema: { type: 'object', properties: { notes: {} }, required: [] } }])[0];
ok('propose' in (tool.input_schema as { properties: object }).properties, 'withPropose adds the field');
ok(P.inferKind('the own farm keeps failing: no free site') === 'fix' && P.inferKind('build a bridge') === 'work', 'inferKind');

// The triage's reply, and code's guard
const ids = new Set(['p1', 'p3']);
const t = P.parseTriage('```json\n{"verdicts":[{"id":"p1","decision":"accept","reason":"good idea","route":"catalogue","size":"small"},{"id":"p9","decision":"accept","reason":"x"},{"id":"p3","decision":"maybe","reason":"x"}]}\n```', ids);
ok(t.verdicts.size === 1 && t.verdicts.get('p1')?.route === 'catalogue' && t.problems.length === 3, `parseTriage (${t.problems.join('; ')})`);
ok(P.parseTriage('not json', ids).problems[0] === 'the reply is not JSON', 'a reply that is not JSON');
const gq = P.guardVerdict(q, { by: 'triage', at: 0, decision: 'accept', reason: 'sure', route: 'foundry' });
ok(gq.decision === 'defer', 'an impossible one is never accepted');
const rule = P.addProposal({ village: 'V2', by: 'Ada', kind: 'rule', what: 'Make crops grow twice as fast', why: '' }, ctx)!;
ok(P.guardVerdict(rule, { by: 'triage', at: 0, decision: 'accept', reason: 'ok', route: 'config' }).decision === 'defer', "the user's calls wait for the user");
ok(P.guardVerdict(a, { by: 'triage', at: 0, decision: 'accept', reason: 'ok', route: 'foundry' }).route !== 'foundry' || !!a.check.capability?.ticketable, 'the foundry only for a ticketable capability');
ok(P.verdictLine({ ...a, verdict: { by: 'triage', at: 0, decision: 'accept', reason: 'we will add candles' } }).startsWith('Your proposal "Make candles'), 'the member\'s line');

console.log(`${fail ? 'FAIL' : 'OK'} proposals_unit: ${pass} of ${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
