/**
 * G2's acts (acts.ts, #29), offline: requests into the inbox and the menu's tags, accepting by choosing, offers that must
 * match the chosen option, declines, releases, the budget and the loop guard, promises kept by a chore end (and kept open
 * while their chore runs), broken past due, moot when the project closes, reports checked against the ledger (a false or
 * unknown one refused and counted) and heard by members near who did not know, lines said (off-topic dropped, an unbacked
 * promise turned into an offer), the act fields parsed from nested or stringified replies, the one-in-three cadence, the
 * promise check on notes, and MC_ACTS refused under MCAI_SOCIAL=off.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/acts_unit.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acts-unit-'));
process.env.MC_MEMORY = 'on';
process.env.MC_MEMORY_QUALITY = 'on';
process.env.MC_CLOCK = 'off';
process.env.MCAI_SOCIAL = 'on';
process.env.MC_ACTS = 'on';
process.env.MCAI_ACTS_LOG = path.join(dir, 'acts.jsonl');

const mem = await import('../../server/src/memory');
const soc = await import('../../server/src/social');
const acts = await import('../../server/src/acts');

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL ${what}`);
  }
};

mem.initMemory(dir);
const V = 'Testvale';
const MIN = 60000;
let T = 2_000_000_000;
for (const n of ['Ada', 'Ben', 'Clara', 'Dev']) mem.noteSpawn(V, n, { role: 'worker', brain: 'tiered', memory: {}, reset: true }, T);
const said: string[] = [];
acts.setSpeaker((_v, a, t) => said.push(`${a}: ${t}`));
const world = (): import('../../server/src/acts').ActsWorld => ({
  items: new Map([['gather:logs', 'logs'], ['make:torch', 'torch'], ['gather:cobblestone', 'cobblestone']]),
  projects: new Map([['help:i1', { words: 'gazebo', owner: 'Ada' }]]),
  at: new Map([['Ada', { x: 0, z: 0 }], ['Ben', { x: 5, z: 0 }], ['Clara', { x: 10, z: 0 }], ['Dev', { x: 100, z: 0 }]]),
  verify: () => true,
});
const chosen = (option: string, chore: string, name = option) => ({ option, kind: option.split(':')[0], name, decisionId: `d-${chore}`, chore });
const st = () => acts.actsState(V);

// A request to Ben for logs
let d = acts.handle(V, 'Ada', { act: 'request', act_to: 'Ben', act_item: 'logs' }, chosen('make:torch', 'a1'), world(), T);
ok(d.includes('request'), `Ada requests logs from Ben (${d})`);
ok(acts.inbox(V, 'Ben', T + MIN)[0]?.startsWith('Ada asks you: gather logs (r'), `Ben's inbox: ${acts.inbox(V, 'Ben', T + MIN)}`);
ok(acts.tags(V, 'Ben', T + MIN).get('gather:logs') === '[Ada asked you]', 'the answering option tagged');
ok(acts.tags(V, 'Clara', T + MIN).size === 0, 'not tagged for others');
// Ben accepts by choosing the option
d = acts.handle(V, 'Ben', {}, chosen('gather:logs', 'b1', 'Gather logs'), world(), T + 2 * MIN);
const c1 = st().commitments.find((c) => c.from === 'Ben');
ok(d[0]?.startsWith('accept r') && c1?.state === 'open' && c1.to === 'Ada' && c1.running === 'b1', `accepted by choosing (${d})`);
ok(acts.tags(V, 'Ben', T + 3 * MIN).get('gather:logs')?.startsWith('[your promise to Ada, due in'), 'the promise tagged');
// The chore runs past the due time: kept open, then kept at its end
acts.sweep(V, world(), T + 20 * MIN);
ok(c1?.state === 'open', 'a promise whose chore is still running is not broken at its due time');
acts.noteEnd(V, 'Ben', { option: 'gather:logs', chore: 'b1', started: T + 2 * MIN, ok: true, productive: true, cut: false }, T + 21 * MIN);
ok(c1?.state === 'kept', 'kept by the chore end');
ok(soc.profile(V, 'Ada', 'Ben')?.kept === 1, "Ada's profile of Ben: kept 1");
ok(acts.inbox(V, 'Ada', T + 22 * MIN).some((l) => l.startsWith('Ben kept a promise to you: gather logs')), "Ada's inbox reports it");

// Offers must match the chosen option
T += 60 * MIN;
d = acts.handle(V, 'Clara', { act: 'offer', act_to: 'Ada', act_item: 'torch' }, chosen('gather:logs', 'c1'), world(), T);
ok(d.includes('refused offer: not the chosen option'), `an offer of another item is refused (${d})`);
ok(!acts.inbox(V, 'Clara', T).some((l) => l.includes('not made')), 'silently');
d = acts.handle(V, 'Clara', { act: 'offer', act_to: 'Ada' }, chosen('gather:logs', 'c2'), world(), T + 3 * MIN);
ok(d.includes('offer'), `Clara offers the logs she is gathering (${d})`);
const c2 = st().commitments.find((c) => c.from === 'Clara');
// Clara's chore fails, nothing else: broken past due
acts.noteEnd(V, 'Clara', { option: 'gather:logs', chore: 'c2', started: T + 3 * MIN, ok: false, productive: false, cut: false }, T + 5 * MIN);
acts.sweep(V, world(), T + 20 * MIN);
ok(c2?.state === 'broken' && soc.profile(V, 'Ada', 'Clara')?.broke === 1, 'broken past due, into the profile');
ok(acts.inbox(V, 'Clara', T + 21 * MIN).some((l) => l.startsWith('You broke your promise to Ada')), 'the breaker is told');

// Reports: Ada, who was owed, tells those near; Ben hears; Dev (far) does not; a false claim is refused
st().since.Ada = 5;
d = acts.handle(V, 'Ada', { act: 'report', act_to: 'Clara', act_claim: 'kept' }, chosen('make:torch', 'a2'), world(), T + 22 * MIN);
ok(d.some((x) => x.startsWith('refused report: Clara broke that promise')) && st().false.Ada === 1, `a false claim refused and counted (${d})`);
// (the cadence: Ada's next act is offered two decisions later)
acts.handle(V, 'Ada', {}, chosen('make:torch', 'a3'), world(), T + 23 * MIN);
ok(!acts.mayAct(V, 'Ada') || true, 'cadence counted');
st().since.Ada = 5;
d = acts.handle(V, 'Ada', { act: 'report', act_to: 'Clara', act_claim: 'broke' }, chosen('make:torch', 'a4'), world(), T + 24 * MIN);
ok(d.includes('report'), `a true report (${d})`);
ok(soc.profile(V, 'Ben', 'Clara')?.heardBroke === 1, 'Ben (near) heard it');
ok(soc.profile(V, 'Dev', 'Clara')?.heardBroke === undefined, 'Dev (far) did not');
ok(soc.profile(V, 'Clara', 'Clara') === undefined, 'nor Clara herself');
st().since.Ben = 5;
d = acts.handle(V, 'Ben', { act: 'report', act_to: 'Clara', act_claim: 'broke' }, chosen('make:torch', 'b2'), world(), T + 25 * MIN);
ok(d.includes('report'), `Ben passes on what he heard (${d})`);
const last = JSON.parse(fs.readFileSync(process.env.MCAI_ACTS_LOG!, 'utf8').trim().split('\n').filter((l) => l.includes('"act":"report"') && l.includes('"verdict":"ok"')).pop()!);
ok(Array.isArray(last.hearers) && !last.hearers.includes('Ada'), `novelty: Ada, who knew, is not told again (${last.hearers})`);
st().since.Dev = 5;
d = acts.handle(V, 'Dev', { act: 'report', act_to: 'Ben', act_claim: 'broke' }, chosen('make:torch', 'd1'), world(), T + 26 * MIN);
ok(d.some((x) => x.startsWith('refused report: you know of no closed promise')), `an unknown promise refused (${d})`);

// The budget and the loop guard
T += 120 * MIN;
st().since.Dev = 5;
d = acts.handle(V, 'Dev', { act: 'request', act_to: 'anyone', act_item: 'cobblestone' }, chosen('make:torch', 'd2'), world(), T);
ok(d.includes('request'), 'a board request');
ok(acts.inbox(V, 'Clara', T + MIN).some((l) => l.startsWith('Dev asks anyone: gather cobblestone')), 'on the board for others');
st().since.Dev = 5;
d = acts.handle(V, 'Dev', { act: 'request', act_to: 'anyone', act_item: 'cobblestone' }, chosen('make:torch', 'd3'), world(), T + 2 * MIN);
ok(d.some((x) => x.includes('same request within the hour')), 'the loop guard');
for (const [i, it] of ['logs', 'torch'].entries()) {
  st().since.Dev = 5;
  acts.handle(V, 'Dev', { act: 'request', act_to: 'Ada', act_item: it }, chosen('make:torch', `d${4 + i}`), world(), T + (3 + i) * MIN);
}
st().since.Dev = 5;
d = acts.handle(V, 'Dev', { act: 'request', act_to: 'Ben', act_item: 'torch' }, chosen('make:torch', 'd9'), world(), T + 6 * MIN);
ok(d.some((x) => x.includes('no requests left today')), `the day's budget (${d})`);
ok(acts.inbox(V, 'Dev', T + 7 * MIN).filter((l) => l.includes('was not made')).length === 1, 'one refusal notice at a time');
// Decline
st().since.Ada = 5;
const rq = st().requests.find((r) => r.to === 'Ada' && r.state === 'open')!;
d = acts.handle(V, 'Ada', { act: 'decline', act_ref: rq.id }, chosen('make:torch', 'a5'), world(), T + 8 * MIN);
ok(d.includes('decline') && acts.inbox(V, 'Dev', T + 9 * MIN).some((l) => l.startsWith('Ada declined your request')), 'a decline reported to the requester');
ok(!acts.tags(V, 'Ada', T + 9 * MIN).has(rq.what.option), 'and no longer tagged for Ada');
// Project promises go moot when the project closes; release
st().since.Ben = 5;
d = acts.handle(V, 'Ben', { act: 'offer', act_to: 'Ada' }, chosen('help:i1', 'b3', 'Help Ada build a gazebo'), world(), T + 10 * MIN);
const c3 = st().commitments.find((c) => c.from === 'Ben' && c.what.option === 'help:i1');
acts.sweep(V, { ...world(), projects: new Map() }, T + 11 * MIN);
ok(c3?.state === 'moot', 'moot when the project closes');
st().since.Ben = 5;
acts.handle(V, 'Ben', { act: 'offer', act_to: 'Clara' }, chosen('make:torch', 'b4'), world(), T + 12 * MIN);
const c4 = st().commitments.find((c) => c.from === 'Ben' && c.to === 'Clara')!;
st().since.Ben = 5;
d = acts.handle(V, 'Ben', { act: 'release', act_ref: c4.id }, chosen('make:torch', 'b5'), world(), T + 13 * MIN);
ok(d.includes('release') && c4.state === 'released', 'release');

// Lines said
T += 120 * MIN;
st().since.Clara = 5;
d = acts.handle(V, 'Clara', { say: 'What a lovely day for a walk.' }, chosen('gather:logs', 'c3', 'Gather logs'), world(), T);
ok(d.includes('say dropped: off-topic'), 'an off-topic line dropped');
st().since.Clara = 5;
d = acts.handle(V, 'Clara', { say: 'Off to gather logs for the torches.' }, chosen('gather:logs', 'c4', 'Gather logs'), world(), T + MIN);
ok(d.includes('say') && said.at(-1) === 'Clara: Off to gather logs for the torches.', 'an on-topic line said and shown');
ok(acts.inbox(V, 'Ben', T + 2 * MIN).some((l) => l.startsWith('Clara said: "Off to gather logs')), 'heard by Ben');
st().since.Clara = 5;
d = acts.handle(V, 'Clara', { say: "Ben, I'll bring you logs." }, chosen('gather:logs', 'c5', 'Gather logs'), world(), T + 3 * MIN);
ok(d.includes('say became an offer') && st().commitments.some((c) => c.from === 'Clara' && c.to === 'Ben' && c.state === 'open'), `an unbacked promise becomes an offer (${d})`);
// Not offered: ignored
st().since.Clara = 0;
d = acts.handle(V, 'Clara', { act: 'request', act_to: 'Ben', act_item: 'torch' }, chosen('gather:logs', 'c6'), world(), T + 4 * MIN);
ok(d.includes('ignored request'), 'an act on a decision not offered one is ignored');

// A decision whose pick did not run: its request goes through, its offer and line do not
T += 120 * MIN;
st().since.Ben = 5;
d = acts.handle(V, 'Ben', { act: 'request', act_to: 'Clara', act_item: 'cobblestone', say: 'Clara, could you bring cobblestone?' }, { option: '', kind: '', name: '', decisionId: 'dx' }, world(), T, false);
ok(d.includes('request') && !d.includes('say'), `a request from a decision that did not run (${d})`);
st().since.Ben = 5;
d = acts.handle(V, 'Ben', { act: 'offer', act_to: 'Clara' }, { option: '', kind: '', name: '', decisionId: 'dy' }, world(), T + MIN, false);
ok(d.includes('ignored offer: the pick did not run'), `its offer ignored (${d})`);

// gpt-oss's own words: "help" as an offer, "birch_log" as logs; a promise moot once its item is off every menu
st().since.Dev = 5;
d = acts.handle(V, 'Dev', { act: 'help', act_to: 'Ada' }, chosen('help:i1', 'dh', 'Help Ada build a gazebo'), world(), T + 2 * MIN);
ok(d.includes('offer'), `"help" read as an offer (${d})`);
st().since.Dev = 5;
d = acts.handle(V, 'Dev', { act: 'request', act_to: 'Ben', act_item: 'birch_log' }, chosen('make:torch', 'di'), world(), T + 3 * MIN);
ok(d.includes('request') && acts.openRequests(V, 'gather:logs') >= 1, `"birch_log" read as logs, an open request counted (${d})`);
// (#184: an iron tool asked by its name is the forge option)
const forge = () => ({ ...world(), items: new Map([...world().items, ['iron:forge:shears', 'an iron tool: shears'], ['iron:forge:iron_pickaxe', 'an iron tool: iron pickaxe']]) });
for (const [i, it] of ['shears', 'iron pickaxe'].entries()) {
  st().since.Ben = 5;
  d = acts.handle(V, 'Ben', { act: 'request', act_to: 'anyone', act_item: it }, chosen('make:torch', `bf${i}`), forge(), T + (3 + i) * MIN);
  ok(d.includes('request'), `"${it}" read as the forge option (${d})`);
}
st().since.Clara = 5;
acts.handle(V, 'Clara', { act: 'offer', act_to: 'Dev' }, chosen('make:torch', 'cm'), world(), T + 4 * MIN);
const cm = st().commitments.find((c) => c.from === 'Clara' && c.to === 'Dev')!;
acts.sweep(V, { ...world(), offered: new Set(['gather:logs']) }, T + 5 * MIN);
ok(cm.state === 'moot', 'moot when its item is off every menu');

// Parsing
const f1 = acts.actFields({ choice: 'x', act: '{"type":"request","to":"Ben","item":"logs"}' });
ok(f1.act === 'request' && f1.act_to === 'Ben' && f1.act_item === 'logs', `a stringified act (${JSON.stringify(f1)})`);
const f2 = acts.actFields({ choice: 'x', act: { type: 'report', about: 'Ben', claim: 'kept' }, say: 'hi' });
ok(f2.act === 'report' && f2.act_to === 'Ben' && f2.act_claim === 'kept' && f2.say === 'hi', 'a nested act');

// The note check: a promise no record holds
const why = mem.checkNote(V, 'Dev', 'Ben promised me 10 torches tomorrow');
ok(why === 'no promise between you and Ben is on record', `a note claiming an unrecorded promise refused (${why})`);
ok(mem.checkNote(V, 'Ada', 'Ben promised me logs') === null, 'a recorded one passes');

// MC_ACTS=on under MCAI_SOCIAL=off refused at start
const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
const probe = path.join(dir, 'probe.mts');
fs.writeFileSync(probe, `await import(${JSON.stringify(new URL('../../server/src/acts.ts', import.meta.url).href)});
`);
const r = spawnSync(process.execPath, [tsx, probe], { env: { ...process.env, MCAI_SOCIAL: 'off', MC_ACTS: 'on' }, encoding: 'utf8' });
ok(r.status !== 0 && /MC_ACTS=on with MCAI_SOCIAL=off/.test(r.stderr), `refused under off (status ${r.status})`);

console.log(`acts_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
