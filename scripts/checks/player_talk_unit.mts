/**
 * #179, the talk's status facts offline (playerTalk.ts; no server): a person's builds and promises as fact lines (open
 * ones and those closed within the hour, newest last; chat left out); the world's words for a request's state in the
 * history instead of the ledger's "being built"; the prompt's "Their requests now" section (and "none open"); which lines
 * are status questions; a house request's place words.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/player_talk_unit.mts
 */
const T = await import('../../server/src/playerTalk');

let fails = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};

T.initTalk(null);
const now = 100 * 60000;
const r1 = T.addRequest({ village: 'V', from: 'Sam', to: 'Mayor', text: 'mayor, please build a house here', at: now - 20 * 60000, pos: { x: -40, y: 66, z: 0 } });
T.updateRequest(r1.id, { kind: 'build', status: 'under_way', piece: 'houses', what: 'a street of houses for the 14 members without one', place: { words: 'here', kind: 'here', x: -40, z: 0 }, started: now - 18 * 60000 });
const r2 = T.addRequest({ village: 'V', from: 'Sam', to: 'Mayor', text: 'hello', at: now - 10 * 60000 });
T.updateRequest(r2.id, { kind: 'chat', status: 'chat', closed: now - 10 * 60000 });
const r3 = T.addRequest({ village: 'V', from: 'Sam', to: 'Mayor', text: 'a temple please', at: now - 90 * 60000 });
T.updateRequest(r3.id, { kind: 'build', status: 'done', piece: 'plains_temple_3', what: 'a temple', closed: now - 80 * 60000 });
const r4 = T.addRequest({ village: 'V', from: 'Ann', to: 'Mayor', text: 'a library', at: now - 5 * 60000 });
T.updateRequest(r4.id, { kind: 'build', status: 'queued', piece: 'plains_library_1', what: 'a library' });

const waiting = { state: 'accepted, not started yet: the street is laid out when growth is free; building rests 6 more min after a failed layout', where: 'asked here (west of the village, ~40 blocks)' };
const lines = T.statusLines('V', 'Sam', now, () => waiting);
ok(lines.length === 1 && lines[0].startsWith('r1, a street of houses') && lines[0].includes('not started yet') && lines[0].includes('asked here (west'), `only Sam's open build, not the chat nor the temple done 80 min ago: ${JSON.stringify(lines)}`);
const mid = T.statusFact(r1, now, { state: 'being built', done: 2, of: 4, where: 'east of the village, ~40 blocks, ~5 blocks from the place asked' });
ok(/being built, 2 of 4 built; east of the village/.test(mid), `mid-build: ${mid}`);
const h = T.historyLines('V', 'Sam', now, 5, undefined, (q) => (q.status === 'under_way' ? waiting.state : undefined));
ok(h.some((l) => l.includes('-> accepted, not started yet')) && !h.some((l) => l.includes('being built')) && h.some((l) => l.includes('-> done')), `the history takes the world's words: ${JSON.stringify(h)}`);
const ctx = { agent: 'Mayor', role: 'mayor' as const, village: 'V', persona: [], from: 'Sam', lines: ['where?'], history: h, state: ['the village is complete'] };
ok(T.talkUser({ ...ctx, status: lines }).includes("Their requests now (from the village's records; say nothing about them these do not show):\n- r1, a street"), 'the prompt shows them');
ok(T.talkUser({ ...ctx, status: [] }).includes('Their requests now') && T.talkUser({ ...ctx, status: [] }).includes('- none open'), '"none open" when there are none');
ok(!T.talkUser(ctx).includes('Their requests now'), 'no section without status');
ok(/Their requests now/.test(T.talkSystem('mayor')) && /Their requests now/.test(T.talkSystem('member')), 'both system prompts point at it');

for (const q of ['where?', 'what happened to the house I asked for?', 'is it done yet', "how's the temple going", 'any news on my library?', 'where is it'])
  ok(T.isStatusQuestion(q), `a status question: "${q}"`);
for (const q of ['hello Mayor!', 'please build a house here', 'a temple please', 'build a library by the river'])
  ok(!T.isStatusQuestion(q), `not a status question: "${q}"`);
ok(T.placeOf('mayor, please build a house here')?.kind === 'here', 'a house "here" has a place');

console.log(fails ? `PLAYER TALK UNIT FAIL (${fails})` : 'PLAYER TALK UNIT OK');
process.exit(fails ? 1 : 0);
