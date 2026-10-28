/**
 * #164 steps 3-5, offline (rules.ts, customs.ts, society.ts, council.ts, streetPlan.ts): claim and report laws read from
 * train 7's own norms (MC_RULE_TYPES), stock classes, a claim posted, held against others and lapsing, the waits and
 * blocked trips counted into the claim's result line, a report pended, posted, cited and skipped, the board's signs, the
 * board's cells by the storage hut, the night's custom field, and the scripted council (MC_COUNCIL_SCRIPTED under the fixed
 * chooser): the new laws proposed and backed.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/rules164_unit.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules164-unit-'));
process.env.MC_MEMORY = 'on';
process.env.MC_CLOCK = 'on';
process.env.MC_DAY_MIN = '20';
process.env.MC_RULES = 'on';
process.env.MC_COUNCIL = 'on';
process.env.MC_CHOOSE = 'fixed';
process.env.MC_COUNCIL_SCRIPTED = 'on';
process.env.MC_RULE_TYPES = 'claim,report,stock';
process.env.MC_RULE_RESULTS = 'on';
process.env.MC_CUSTOMS = 'on';
process.env.MCAI_ACTS_LOG = path.join(dir, 'acts.jsonl');

const mem = await import('../../server/src/memory');
const rules = await import('../../server/src/rules');
const council = await import('../../server/src/council');
const soc = await import('../../server/src/society');
const sp = await import('../../server/src/streetPlan');

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL ${what}`);
  }
};

// Reading: train 7's claim and report norms (norm_classes.txt), the kept plot (Q3), and what stays a norm
const read = (what: string) => rules.readLaw({ what });
const claims: Array<[string, string]> = [
  ['Members must post a claim on the iron schedule board and wait for clearance before digging for iron to prevent collisions.', 'iron'],
  ['When a member begins digging a shared mine level, they must post a brief notice in the common board.', 'iron'],
  ['Members must announce when they begin digging a resource level to prevent blocking others.', 'iron'],
  ['Members must post their intended iron-dig level on the communal board before starting, and wait for confirmation.', 'iron'],
  ['Each member must reserve a 9x9 personal farm plot within 24 blocks of their house, kept free from other construction.', 'farm_site'],
  ['Each member must maintain a clear 9x9 plot within 24 blocks of their house for personal farming to ensure space.', 'farm_site'],
  ['Members must reserve a farm plot on the communal farm board before planting to prevent overlapping crops.', 'farm_site'],
  ['Members must post a brief claim on the farm layout board before attempting to lay out a new 9x9 farm, to avoid clashes.', 'farm_site'],
];
for (const [w, work] of claims) {
  const r = read(w);
  ok(r.type === 'claim' && r.params.work === work && r.params.min === 10, `claim ${work}: ${w.slice(0, 60)} (${JSON.stringify(r)})`);
}
ok(read('Members post a claim on the board before digging on the iron level, held 6 minutes.').params.min === 6, 'a claim\'s minutes');
ok(read('Members post a claim before digging iron, held 40 minutes.').params.min === 15, 'minutes kept in the band');
const reports = [
  'When a member discovers a new resource node (e.g., sugar cane, iron), they must post its coordinates on the common board.',
  'Members must report any dead-end or blocked tunnel they discover to the common board so others can avoid wasted trips.',
  'Members must record the amount of ore collected on the board after each mining shift.',
];
for (const w of reports) ok(read(w).type === 'report', `report: ${w.slice(0, 60)} (${read(w).type})`);
for (const w of ['Members must record any birch logs taken from storage on the board to track usage and prevent shortages.',
  'Each member must record their intended building footprint in the shared plan before starting construction.',
  'Each member must keep a personal chest containing at least 5 food items at all times.'])
  ok(read(w).type !== 'claim' && read(w).type !== 'report', `not a claim or report: ${w.slice(0, 60)} (${read(w).type})`);
// Stock classes
const st1 = read('Members must keep at least one empty bucket in village storage each day for milking.');
ok(st1.type === 'floor' && st1.params.class === 'bucket' && st1.params.n === 1, `a bucket floor (${JSON.stringify(st1)})`);
const st2 = read('Members must deposit at least 4 seeds into storage each day.');
ok(st2.type === 'contribute' && st2.params.class === 'seeds' && st2.params.n === 4, `a seeds contribution (${JSON.stringify(st2)})`);
const st3 = read('Each member deposits at least 2 ore into storage each day.');
ok(st3.type === 'contribute' && st3.params.class === 'ore', `an ore contribution (${JSON.stringify(st3)})`);
ok(rules.validate('contribute', { class: 'fuel', n: 3 }) === null && rules.validate('floor', { class: 'seeds', n: 5 }) === null, 'stock classes in band');
ok(rules.inClass('wheat_seeds', 'seeds') && rules.inClass('raw_iron', 'ore') && rules.inClass('charcoal', 'fuel') && rules.inClass('bucket', 'bucket') && !rules.inClass('bread', 'seeds'), 'items in stock classes');
ok(rules.validate('claim', { work: 'iron', min: 2 })?.includes('3 to 15') && rules.validate('claim', { work: 'moon', min: 5 }) !== null, 'claim bands');

// A village on a fake clock
mem.initMemory(dir);
const V = 'Claimvale';
const T0 = 1_950_000_000_000;
const MIN = 60000;
const names = ['Ada', 'Ben', 'Clara', 'Dev', 'Elena', 'Finn'];
for (const n of names) mem.noteSpawn(V, n, { role: 'worker', brain: 'tiered', memory: {}, reset: true }, T0);
const epoch = mem.villageMemory(V)!.epoch;
const at = (day: number, frac: number) => epoch + ((day - 1) + frac) * 20 * MIN;

// No rule: nothing posted, nothing held; a blocked trip still counted (the before)
ok(rules.postClaim(V, 'iron', 'iron', 'Ada', 'iron level', at(1, 0.2)) === undefined && rules.claimHeld(V, 'iron', 'iron', 'Ben', at(1, 0.2)) === undefined, 'no claim without the rule');
rules.noteBlocked(V, 'Ben', 'iron', 'iron:dig', 'another worker is digging the iron level', at(1, 0.3));
rules.noteBlocked(V, 'Ben', 'iron', 'iron:dig', 'another worker is digging the iron level', at(2, 0.3));
// The claim rule passes (as the council would: a law, then enact)
const lc = rules.addLaw(V, 'Ada', { what: claims[0][0] }, at(2, 0.5));
ok(lc.status === 'open' && lc.type === 'claim' && /posts a claim on the board/.test(lc.text), `the claim law (${lc.text})`);
const rc = rules.enact(V, lc, { yes: 4, no: 1, abstain: 0 }, at(2, 0.7));
ok(!!rules.claimRule(V, 'iron') && !rules.claimRule(V, 'green'), 'the claim rule in force on its work only');
const c = rules.postClaim(V, 'iron', 'iron', 'Ada', 'iron level', at(3, 0.1));
ok(c?.by === 'Ada' && c.until === at(3, 0.1) + 10 * MIN, 'a claim posted for the rule\'s minutes');
ok(rules.claimHeld(V, 'iron', 'iron', 'Ben', at(3, 0.2))?.by === 'Ada' && !rules.claimHeld(V, 'iron', 'iron', 'Ada', at(3, 0.2)), 'held against others, not its poster');
ok(!rules.claimHeld(V, 'iron', 'iron', 'Ben', at(3, 0.1) + 11 * MIN), 'a claim lapses after its minutes');
rules.postClaim(V, 'iron', 'iron', 'Ada', 'iron level', at(3, 0.15));
ok(rules.liveClaims(V, at(3, 0.16)).length === 1, 'a claim renewed, not doubled');
rules.noteClaimWait(V, 'Ben', 'iron:dig', c!, at(3, 0.2));
rules.noteClaimWait(V, 'Ben', 'iron:dig', c!, at(3, 0.21));
rules.noteBlocked(V, 'Clara', 'iron', 'iron:dig', 'another worker is digging the iron level', at(4, 0.3));
const res = rules.ruleResult(V, rc, at(5, 0.1));
ok(/^1 blocked trips since \(2 in the 2 days before\); 1 menus waited on a claim$/.test(res), `the claim's result line (${res})`);
const sg = rules.boardSigns(V, at(3, 0.2));
ok(sg.length === 1 && sg[0][0] === 'CLAIM' && sg[0][2] === 'by Ada' && sg[0].every((x) => x.length <= 15), `the board's claim sign (${JSON.stringify(sg)})`);

// Reports: no rule, nothing pended; then pended, posted, cited, skipped
rules.pendReport(V, 'Ben', 'gather:sugar_cane', 'sugar cane 40 blocks east of the storage hut', at(3, 0.3));
ok(!rules.pendingReport(V, 'Ben', at(3, 0.3)), 'no report without the rule');
const lr = rules.addLaw(V, 'Ben', { what: reports[0] }, at(3, 0.5));
const rr = rules.enact(V, lr, { yes: 4, no: 0, abstain: 1 }, at(3, 0.7));
ok(lr.type === 'report' && !!rules.reportRule(V), 'the report rule in force');
rules.pendReport(V, 'Ben', 'gather:sugar_cane', 'sugar cane 40 blocks east of the storage hut', at(4, 0.2));
ok(rules.pendingReport(V, 'Ben', at(4, 0.25))?.text.startsWith('sugar cane'), 'a find waits for its choice');
const p = rules.postReport(V, 'Ben', at(4, 0.25));
ok(p?.by === 'Ben' && !rules.pendingReport(V, 'Ben', at(4, 0.26)), 'posted');
ok(rules.reportFor(V, 'Clara', 'gather:sugar_cane', at(4, 0.3))?.id === p?.id && !rules.reportFor(V, 'Ben', 'gather:sugar_cane', at(4, 0.3)) && !rules.reportFor(V, 'Clara', 'gather:sand', at(4, 0.3)), 'a fact on others\' options of the same work only');
ok(!rules.reportFor(V, 'Clara', 'gather:sugar_cane', at(4, 0.25) + 31 * MIN), 'a report leaves the board after 30 minutes');
rules.noteReportUsed(V, 'Clara', p!, 'gather:sugar_cane', at(4, 0.3));
rules.pendReport(V, 'Dev', 'iron:dig', 'iron dig failed: the stairs are blocked', at(4, 0.4));
rules.skipReport(V, 'Dev', at(4, 0.45));
rules.pendReport(V, 'Elena', 'gather:sand', 'sand 20 blocks north of the storage hut', at(4, 0.5));
ok(!rules.pendingReport(V, 'Elena', at(4, 0.5) + 11 * MIN), 'an unanswered find lapses after 10 minutes');
const rres = rules.ruleResult(V, rr, at(5, 0.1));
ok(rres === '1 of 3 finds posted since; 1 trips used a report', `the report's result line (${rres})`);
const sg2 = rules.boardSigns(V, at(4, 0.3));
ok(sg2.some((s) => s[0] === 'Ben:') && sg2.every((s) => s.length <= 4 && s.every((x) => x.length <= 15)), `the board's report sign (${JSON.stringify(sg2)})`);
// (the acts ledger: rules_use.py's fields)
const acts = fs.readFileSync(process.env.MCAI_ACTS_LOG!, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
ok(acts.filter((x) => x.type === 'claim' && x.op === 'blocked').length === 3 && acts.some((x) => x.type === 'claim' && x.op === 'waited'), 'claims in the ledger');
ok(acts.some((x) => x.type === 'report' && x.report === 'posted') && acts.filter((x) => x.type === 'report' && x.report === 'skipped').length === 2, 'reports posted and skipped in the ledger');

// The board's cells: two out from the hut's sides, facing away
const cells = sp.boardCells({ x1: 0, z1: 0, x2: 6, z2: 6 });
ok(cells[0].x === 3 && cells[0].z === 8 && cells[0].rot === 0 && cells.some((q) => q.z === -2 && q.rot === 8) && cells.some((q) => q.x === 8 && q.rot === 12) && cells.some((q) => q.x === -2 && q.rot === 4), 'the board\'s cells by the hut');
ok(cells.every((q) => !(q.x >= 0 && q.x <= 6 && q.z >= 0 && q.z <= 6)), 'never inside the hut');

// The night's custom field
const t = soc.reflectTools({ live: [], people: [], openLaws: [], propose: null, custom: true });
ok(!!(t[0].input_schema as { properties: Record<string, unknown> }).properties.custom, 'the custom field in the night tool');
ok(/plant a flower by your door/i.test(soc.customLine()), 'the night\'s custom line names the customs');
ok(soc.applyCustom(V, 'Finn', { custom: "Let's all set a flower on the green's custom stone each day." }, at(4, 0.9))[0] === 'custom green_stone', 'a custom started from the night');
ok(/refused/.test(soc.applyCustom(V, 'Finn', { custom: 'We should sing songs at the well every morning.' }, at(4, 0.9))[0] ?? ''), 'a custom code cannot keep refused');

// The scripted council (F1): fixed chooser, the new laws on night 1, ballots predicted
ok(council.councilScripted(), 'MC_COUNCIL_SCRIPTED under the fixed chooser');
const V2 = 'Scriptvale';
const many = Array.from({ length: 24 }, (_, i) => `M${i + 1}`);
for (const n of many) mem.noteSpawn(V2, n, { role: 'worker', brain: 'tiered', memory: {}, reset: true }, T0);
const at2 = (day: number, frac: number) => mem.villageMemory(V2)!.epoch + ((day - 1) + frac) * 20 * MIN;
for (const n of many) soc.scriptedLaw(V2, n, 1, at2(1, 0.9));
const types = new Set(rules.laws(V2).filter((l) => l.status === 'open').map((l) => l.type));
ok(types.has('claim') && types.has('report') && types.has('contribute'), `the scripted laws' types (${[...types]})`);
ok(rules.laws(V2).some((l) => l.type === 'norm' && /custom stone/.test(l.text)), 'a scripted norm naming a custom');
ok(rules.laws(V2).filter((l) => l.status === 'open').some((l) => l.backers.length >= 2), 'the same law joined: backed enough for the agenda');

console.log(`${fail ? 'FAIL' : 'PASS'}: ${pass} checks, ${fail} failures`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
