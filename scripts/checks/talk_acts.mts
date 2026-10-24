/**
 * #107's talk (acts.ts news and questions, council.ts deliberation), offline: with the flags off nothing is parsed or
 * shown; news delivered to members within 16 blocks whether or not the pick ran, in its own section, attributed, tagged;
 * a retelling carries its first teller and is passed on once only; the budget and the loop guard; the holdout withholds
 * and logs the would-be hearers; a question to anyone goes to the world's one answerer, its answer call started once, the
 * answer into the asker's section for a village day (or held out), a failed call closed; the small fixes (a bare "axe" is
 * the make option of an axe; a fixed pick of an option an unpriced request asks for accepts it); and deliberation's shown
 * reasons, both sides, in a later voter's ballot.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/talk_acts.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-acts-'));
const LOG = path.join(dir, 'acts.jsonl');
Object.assign(process.env, { MC_MEMORY: 'on', MC_MEMORY_QUALITY: 'on', MC_CLOCK: 'off', MCAI_SOCIAL: 'on', MC_ACTS: 'on', MCAI_ACTS_LOG: LOG });

const mem = await import('../../server/src/memory');
const acts = await import('../../server/src/acts');
const council = await import('../../server/src/council');

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL ${what}`);
  }
};
const quiet = console.log;
console.log = () => {};
const logged = () => fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf-8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];

mem.initMemory(dir);
acts.setActsSettings({ every: 1 });
const V = 'Talkvale';
const MIN = 60000;
// (at a village day's start with no clock: 20-minute days from the epoch)
let T = 2_000_400_000;
const names = ['Ada', 'Ben', 'Clara', 'Dev', 'Elena'];
for (const n of names) mem.noteSpawn(V, n, { role: 'worker', brain: 'tiered', memory: {}, reset: true }, T);
let tag: 'checked' | 'refuted' | 'unchecked' = 'checked';
const asked: string[] = [];
const world = (): import('../../server/src/acts').ActsWorld => ({
  items: new Map([['gather:logs', 'logs'], ['make:torch', 'torch'], ['make:wooden_axe', 'wooden axes'], ['make:stone_axe', 'stone axes'], ['make:stone_pickaxe', 'stone pickaxes'], ['make:cooked_cod', 'cooked cod']]),
  projects: new Map(),
  // (Ada, Ben, Clara within 16 of each other; Dev 30 from Ada; Elena far)
  at: new Map([['Ada', { x: 0, z: 0 }], ['Ben', { x: 5, z: 0 }], ['Clara', { x: 10, z: 0 }], ['Dev', { x: 30, z: 0 }], ['Elena', { x: 200, z: 0 }]]),
  verify: () => true,
  checkNews: () => tag,
  answerer: (asker) => (asker === 'Ada' ? 'Clara' : 'Ada'),
});
const chosen = (option: string, chore: string) => ({ option, kind: option.split(':')[0], name: option, decisionId: `d-${chore}`, chore });

// flags off: nothing parsed, nothing in the help
ok(acts.actFields({ news: 'storage is out of bread', question: 'where is iron?' }).news === undefined, 'off: news not parsed');
ok(!acts.actsHelp(V, 'Ada', T, world()).includes('`news`'), 'off: no news in the help');
ok(acts.newsLines(V, 'Ben', T).length === 0, 'off: no news section');

acts.setTalkSettings({ news: true, questions: true, fixes: true });
const f = acts.actFields({ news: '  The storage is out   of bread ', question: 'Where is iron?', question_to: 'anyone' });
ok(f.news === 'The storage is out of bread' && f.question === 'Where is iron?' && f.question_to === 'anyone', `on: parsed (${JSON.stringify(f)})`);
const help = acts.actsHelp(V, 'Ada', T, world());
ok(help.includes('`news`') && help.includes('`question`'), 'on: news and questions in the help');

// news, with the pick not run: delivered to Ben and Clara (16 blocks), not Dev or Elena; tagged; attributed
let d = acts.handle(V, 'Ada', { news: 'The storage is out of bread and cooked cod' }, chosen('', 'a1'), world(), T, false);
ok(d.includes('news'), `news made with the pick not run (${d})`);
ok(acts.newsLines(V, 'Ben', T + MIN)[0]?.startsWith('Ada says: "The storage is out of bread'), `Ben's news section (${acts.newsLines(V, 'Ben', T + MIN)})`);
ok(acts.newsLines(V, 'Clara', T + MIN).length === 1 && !acts.newsLines(V, 'Dev', T + MIN).length && !acts.newsLines(V, 'Elena', T + MIN).length, 'only those within 16 blocks');
ok(!acts.inbox(V, 'Ben', T + MIN).some((l) => l.includes('bread')), 'not in the 4-line inbox');
let rec = logged().filter((r) => r.type === 'news').pop();
ok(rec?.tag === 'checked' && JSON.stringify(rec?.hearers) === '["Ben","Clara"]', `logged with its tag and hearers (${JSON.stringify(rec)})`);
ok(acts.newsLines(V, 'Ben', T + 16 * MIN).length === 0, 'news shown for 15 minutes');

// a retelling: Ben passes it on to Dev (Ben at 5, Dev at 30: 25 away, so move Ben next to Dev)
const w2 = world();
w2.at.set('Ben', { x: 25, z: 0 });
d = acts.handle(V, 'Ben', { news: 'Ada says the storage is out of bread and cooked cod' }, chosen('', 'b1'), w2, T + 2 * MIN, false);
ok(d.includes('news retold'), `a retelling recognised (${d})`);
const devNews = acts.newsLines(V, 'Dev', T + 3 * MIN)[0] ?? '';
ok(devNews.startsWith('Ben says Ada said:'), `the retelling carries its first teller (${devNews})`);
ok(!acts.newsLines(V, 'Clara', T + 3 * MIN).some((l) => l.startsWith('Ben says')), 'not to Clara, who heard it already');
// Dev cannot pass it on again
const w3 = world();
w3.at.set('Dev', { x: 195, z: 0 });
d = acts.handle(V, 'Dev', { news: 'storage is out of bread, Ben says' }, chosen('', 'dv1'), w3, T + 4 * MIN, false);
ok(d.some((x) => x.startsWith('news dropped: passed on once already')) && !acts.newsLines(V, 'Elena', T + 5 * MIN).length, `retold once only (${d})`);

// the loop guard and the budget
d = acts.handle(V, 'Ada', { news: 'The storage is out of bread and cooked cod' }, chosen('', 'a2'), world(), T + 5 * MIN, false);
ok(d.some((x) => x.includes('the same news within the hour')), `the same news refused (${d})`);
for (const [i, t] of ['Iron ore seen by the river bend', 'Clay found in the swamp south', 'Pumpkins growing wild past the ridge'].entries()) acts.handle(V, 'Ada', { news: t }, chosen('', `a3${i}`), world(), T + (6 + i) * MIN, false);
d = acts.handle(V, 'Ada', { news: 'Sheep grazing beyond the hill east of the village' }, chosen('', 'a4'), world(), T + 10 * MIN, false);
ok(d.some((x) => x.includes('no news left today')), `the budget (${d})`);

// the holdout: everything withheld at 1, the would-be hearers logged
acts.setTalkSettings({ holdout: 1 });
d = acts.handle(V, 'Clara', { news: 'The well by the square is finished at last' }, chosen('', 'c1'), world(), T + 11 * MIN, false);
rec = logged().filter((r) => r.type === 'news').pop();
ok(d.includes('news withheld') && JSON.stringify(rec?.withheld) === '["Ada","Ben"]' && !acts.newsLines(V, 'Ada', T + 12 * MIN).some((l) => l.includes('well')), `withheld, would-be hearers logged (${JSON.stringify(rec)})`);
acts.setTalkSettings({ holdout: 0 });

// questions: to anyone, the world's answerer; the hook called once; the answer delivered for a village day
const calls: string[] = [];
acts.setAnswerer((_v, q) => {
  calls.push(`${q.id}:${q.from}->${q.to}`);
});
d = acts.handle(V, 'Ada', { question: 'Where have you seen iron ore?', question_to: 'anyone' }, chosen('', 'aq1'), world(), T + 12 * MIN, false);
const q1 = acts.questionsOf(V).find((q) => q.from === 'Ada')!;
ok(q1?.to === 'Clara' && q1.anyone && calls.length === 1 && calls[0].endsWith('Ada->Clara'), `to anyone: one answerer, one call (${d}; ${calls})`);
ok(acts.deliverAnswer(V, q1.id, 'Near the river bend, about 40 blocks east.', 'unchecked', T + 13 * MIN), 'the answer delivered');
ok(!acts.deliverAnswer(V, q1.id, 'again', 'unchecked', T + 13 * MIN), 'answered once only');
ok(acts.answerLines(V, 'Ada', T + 14 * MIN)[0]?.startsWith('Clara answered your question "Where have you seen iron ore?": "Near the river bend'), `Ada's answers section (${acts.answerLines(V, 'Ada', T + 14 * MIN)})`);
ok(acts.answerLines(V, 'Ada', T + 30 * MIN).length === 1 && acts.answerLines(V, 'Ada', T + 33 * MIN).length === 0, 'kept a village day (20 min)');
// named, the same again refused, a non-member refused, the holdout on answers
d = acts.handle(V, 'Ben', { question: 'Do we have enough torches?', question_to: 'Clara' }, chosen('', 'bq1'), world(), T + 15 * MIN, false);
ok(acts.questionsOf(V).some((q) => q.from === 'Ben' && q.to === 'Clara' && !q.anyone), `a named question (${d})`);
d = acts.handle(V, 'Ben', { question: 'Do we have enough torches?', question_to: 'Clara' }, chosen('', 'bq2'), world(), T + 16 * MIN, false);
ok(d.some((x) => x.includes('within the hour')) && calls.length === 2, `the same question refused (${d})`);
d = acts.handle(V, 'Ben', { question: 'Who are you?', question_to: 'Zed' }, chosen('', 'bq3'), world(), T + 17 * MIN, false);
ok(d.some((x) => x.includes('Zed is not a member')), `a non-member refused (${d})`);
acts.setTalkSettings({ holdout: 1 });
const q2 = acts.questionsOf(V).find((q) => q.from === 'Ben')!;
acts.deliverAnswer(V, q2.id, 'Yes, 30 in storage.', 'refuted', T + 18 * MIN);
ok(q2.state === 'withheld' && !acts.answerLines(V, 'Ben', T + 19 * MIN).length && logged().some((r) => r.type === 'answer' && r.id === q2.id && r.withheld), 'an answer held out: logged, not shown');
acts.setTalkSettings({ holdout: 0 });
d = acts.handle(V, 'Dev', { question: 'Is the mine open?', question_to: 'Ada' }, chosen('', 'dq1'), world(), T + 19 * MIN, false);
const q3 = acts.questionsOf(V).find((q) => q.from === 'Dev')!;
acts.failAnswer(V, q3.id, 'budget');
ok(q3.state === 'failed' && !acts.answerLines(V, 'Dev', T + 20 * MIN).length, 'a failed call closed');

// the small fixes: "axe" and "an axe" are the stone axe (the best made); a fixed pick accepts an unpriced request
T += 120 * MIN;
d = acts.handle(V, 'Elena', { act: 'request', act_to: 'anyone', act_item: 'an axe' }, chosen('make:torch', 'e1'), world(), T);
const ra = acts.actsState(V).requests.find((r) => r.from === 'Elena')!;
ok(ra?.what.option === 'make:stone_axe', `"an axe" is make:stone_axe (${d}; ${ra?.what.option})`);
ok(acts.actsState(V).requests.every((r) => r.what.option !== 'make:stone_pickaxe'), 'not the pickaxe');
const pid = acts.impliedAccept(V, 'Dev', chosen('make:stone_axe', 'dv2'), world(), T + MIN);
ok(pid && ra.state === 'accepted' && ra.by === 'Dev', `a fixed pick accepted the unpriced request (${pid}, ${ra.state})`);
acts.setTalkSettings({ fixes: false });
d = acts.handle(V, 'Elena', { act: 'request', act_to: 'anyone', act_item: 'axe' }, chosen('make:torch', 'e2'), world(), T + 70 * MIN);
ok(d.some((x) => x.includes('is not an item')), `fixes off: "axe" refused as before (${d})`);

// deliberation: reasons shown to later voters, the latest 2 of each side, never the voter's own
const m = { said: { l1: [
  { by: 'Ada', vote: 'yes', reason: 'It keeps the storage full.' }, { by: 'Ben', vote: 'yes', reason: 'Fair to all.' },
  { by: 'Clara', vote: 'yes', reason: 'We need wood.' }, { by: 'Dev', vote: 'no', reason: 'Too much work for miners.' },
] } };
const h = council.heardReasons(m, 'Elena');
ok(h.l1.length === 3 && h.l1.some((x) => x.startsWith('Dev (against)')) && !h.l1.some((x) => x.startsWith('Ada')), `the latest 2 of each side (${JSON.stringify(h)})`);
ok(!council.heardReasons(m, 'Dev').l1.some((x) => x.startsWith('Dev')), "not the voter's own");
const law = { id: 'l1', type: 'duty', text: 'every member gathers logs once a day', params: {}, backers: ['Ada'], opposers: [], status: 'agenda' } as never;
const bp = council.ballotPrompt(V, 'Elena', [law], '', T, {}, false, h);
ok(bp.user.includes('Said before you: ') && bp.user.includes('Dev (against): "Too much work for miners."'), 'the ballot shows them');
ok(!council.ballotPrompt(V, 'Elena', [law], '', T).user.includes('Said before you'), 'none without them');

console.log = quiet;
console.log(`talk_acts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
