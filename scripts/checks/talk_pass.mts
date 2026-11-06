/**
 * The F361 chat follow-ups, offline (docs/specs/talk-pass-on.md): MC_TALK_PASS's matcher on the person's words, which
 * refusals are passed on, and talkAct's path on a stub world (a member refusing for want of a chore hands the line to the
 * member whose list has it, says so and marks the request; a refusal for another reason, the Mayor, a line already passed
 * on, and no matching chore are not passed); #236's fallback line (talkCall's retry calls the model: not stubbed here); the
 * talk facts' new lines (last
 * night not counted, monsters near now, unarmed); a respond call written as JSON in the text.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/talk_pass.mts
 */
const P = await import('../../server/src/playerTalk');
const { MineflayerWorld } = await import('../../server/src/mineflayer/mcWorld');

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL ${what}`);
  }
};

// ---- the matcher
const o = (id: string, name: string) => ({ id, name });
const best = (text: string, opts: Array<{ id: string; name: string }>) => P.passTarget(text, opts.map((x, i) => ({ name: `M${i}`, idle: true, dist: i, options: [x] })))?.option.id;
const BASE = [o('watch', 'Keep watch tonight'), o('rest', 'Rest at home'), o('eat', 'Eat a meal from the storage'), o('explore:4', 'Explore to the west'), o('penwork:5:breed', 'Breed the sheep'),
  o('gather:cobblestone', 'Mine cobblestone for the storage'), o('gather:logs', 'Fell trees for the storage'), o('castle:t11', 'Build the east tower of the wall'), o('own:farm:wheat', 'Start a wheat farm of your own by your house')];
ok(best('Ben, could you breed the sheep? We need wool for beds.', BASE) === 'penwork:5:breed', 'sheep -> breed the sheep');
ok(best("Ada, we're low on cobblestone for the towers. Can you bring 64?", BASE) === 'gather:cobblestone', 'cobblestone, not the tower');
ok(best('Lena, bring me 20 oak logs, please.', BASE) === 'gather:logs', 'logs -> fell trees');
ok(best('Kai, explore west of the village and tell me what you find.', BASE) === 'explore:4', 'explore west');
ok(best('Grace, skeletons are shooting at me from the hill. Help!', BASE) === 'watch', 'skeletons -> the watch');
ok(best('Finn, you look hurt. Go home and eat before you do anything else.', BASE) === 'eat', 'eat');
ok(best('Lena, can you give me your bow?', BASE) === undefined, 'a bow: nothing');
ok(best('Grace, go and look for a cave with iron in it, but be home before dark.', [o('rest', 'Rest at home')]) === undefined, '"home" is not a rest');
ok(best('Hugo, find a good place for a second farm', [o('own:farm:wheat', 'Start a wheat farm of your own by your house')]) === undefined, "a member's own chore is not passed to");
const tie = P.passTarget('breed the sheep', [{ name: 'Far', idle: true, dist: 50, options: [o('penwork:5:breed', 'Breed the sheep')] }, { name: 'Busy', idle: false, dist: 1, options: [o('penwork:5:breed', 'Breed the sheep')] }, { name: 'Near', idle: true, dist: 5, options: [o('penwork:5:breed', 'Breed the sheep')] }]);
ok(tie?.member.name === 'Near', `a tie: the idle member, then the nearest (${tie?.member.name})`);
ok(P.noChoreReason('I have no chore that breeds sheep') && P.noChoreReason('"x" is not among the chores I can do now') && P.noChoreReason('I carry no weapon'), 'no-chore reasons');
ok(!P.noChoreReason('I cannot give items; handing items is not allowed') && !P.noChoreReason("I'm too hurt to hunt") && !P.noChoreReason('that is outside this game'), 'other reasons are not');

// ---- the facts and the parse
const night = P.talkFacts({ monsters: true }, 'mayor').join('\n');
ok(/not counted/.test(night) && /do not know/.test(night) && !/no record/.test(night), 'last night without a record: not counted, not known');
ok(P.talkFacts({ monsters: true, near: { n48: 2, n96: 5 } }, 'mayor').some((l) => /2 within 48 blocks of home, 5 within 96/.test(l)), 'monsters near now');
ok(P.talkFacts({ monsters: true, near: { n48: 0, n96: 0 } }, 'mayor').some((l) => /none within 96/.test(l)), 'no monsters near now');
ok(P.talkFacts({ monsters: false, near: { n48: 3, n96: 3 } }, 'mayor').every((l) => !/near the village now/.test(l)), 'a peaceful world says nothing of them');
ok(P.talkFacts({ carries: [] }, 'member').some((l) => /no weapon.*cannot fight/.test(l)), 'unarmed: cannot fight');
const js = P.parseRespond({ text: '{\n  "kind": "chat",\n  "say": "I am not sure."\n}' }, 'mayor');
ok(js?.kind === 'chat' && js.say === 'I am not sure.', 'a respond call written as JSON text');
ok(P.parseRespond({ text: '```json\n{"kind":"refuse","say":"No.","reason":"no chore for it"}\n```' }, 'member')?.reason === 'no chore for it', 'JSON in a fence');
ok(P.parseRespond({ text: 'Hello {there}' }, 'member')?.say === 'Hello {there}', 'plain text stays talk');
ok(P.parseRespond({ calls: [], text: '' }, 'member') === null, 'an empty reply is null');

// ---- talkAct on a stub world
type Bot = { name: string; memory: { villageRole: string }; bot: { entity: { position: { x: number; y: number; z: number } } } };
const mk = (name: string, x: number, role = 'worker'): Bot => ({ name, memory: { villageRole: role }, bot: { entity: { position: { x, y: 64, z: 0 } } } });
const lena = mk('Lena', 0), ben = mk('Ben', 10), ada = mk('Ada', 40), mayor = mk('Mayor', 0, 'mayor');
const menus: Record<string, Array<{ id: string; name: string }>> = { Ben: [o('penwork:5:breed', 'Breed the sheep'), o('make:torch', 'Make torches')], Ada: [o('gather:logs', 'Fell trees for the storage')], Mayor: [o('penwork:5:breed', 'Breed the sheep')] };
function world() {
  const said: Array<[string, string]> = [], heard: Array<{ to: string; via?: string; text: string }> = [];
  const w = Object.create(MineflayerWorld.prototype) as Record<string, any>;
  Object.assign(w, {
    growMembers: () => [lena, ben, ada, mayor], heldKeys: () => new Set<string>(), sweepFacts: () => ({}), isIdleMember: () => true,
    menu: (_v: unknown, m: Bot) => ({ feasible: menus[m.name] ?? [] }),
    talkSay: (n: string, line: string) => said.push([n, line]),
    talkHeard: (a: Bot, _f: string, text: string, _p: unknown, via?: string) => heard.push({ to: a.name, via, text }),
    mayorOf: () => mayor,
  });
  return { w, said, heard };
}
P.initTalk(null);
const V = { name: 'P1', complete: true };
const act = (who: Bot, text: string, p: Partial<ReturnType<typeof P.parseRespond> & object>, via?: string, options: Array<{ id: string; name: string }> = []) => {
  const s = world();
  const r = P.addRequest({ village: 'P1', from: 'Sam', to: who.name, text, at: Date.now(), pos: { x: 0, y: 64, z: 0 } });
  if (via) P.updateRequest(r.id, { via });
  s.w.talkAct(V, who, r, { kind: 'refuse', say: 'Sorry, I can\'t.', ...p }, [], options);
  return { ...s, r: P.requestById(r.id)! };
};
let t = act(lena, 'Lena, could you breed the sheep?', { reason: 'I have no chore that breeds sheep' });
ok(t.heard.length === 1 && t.heard[0].to === 'Ben' && t.heard[0].via === 'Lena', `a no-chore refusal goes to Ben, via Lena (${JSON.stringify(t.heard)})`);
ok(/I'll ask Ben, who can breed the sheep/.test(t.said[0]?.[1] ?? ''), `the line says so (${t.said[0]?.[1]})`);
ok(t.r.status === 'refused' && /passed to Ben/.test(t.r.outcome ?? ''), 'the request: refused, passed to Ben');
t = act(lena, 'Lena, bring me 20 oak logs', { kind: 'promise', option: 'gather:logs', reason: undefined }, undefined, [o('make:torch', 'Make torches')]);
ok(t.heard[0]?.to === 'Ada', `a promise off the list goes on too (${JSON.stringify(t.heard)})`);
t = act(lena, 'Lena, can you give me your bow?', { reason: 'I cannot give items' });
ok(!t.heard.length && !/ask/.test(t.said[0]?.[1] ?? ''), 'another reason: not passed');
t = act(lena, 'Lena, could you breed the sheep?', { reason: 'I have no chore that breeds sheep' }, 'Kai');
ok(!t.heard.length, 'a line already passed on: not again');
t = act(lena, 'Lena, sing me a song', { reason: 'I have no chore for that' });
ok(!t.heard.length && t.r.status === 'refused' && !t.r.outcome, 'no chore matches: not passed');
t = act(mayor, 'Mayor, could you breed the sheep?', { reason: 'I have no chore that breeds sheep' });
ok(!t.heard.length, 'the Mayor does not pass');
t = act(ben, 'Ben, could you breed the sheep?', { reason: 'I have no chore that breeds sheep' });
ok(!t.heard.length || t.heard[0].to !== 'Ben', 'never to the member who refused');

ok(/^Sam, sorry/.test(P.emptyReplyLine('Sam')), "#236's fallback line names the person");
console.log(`talk_pass: ${fail ? 'FAIL' : 'all'} ${pass} of ${pass + fail} passed`);
process.exit(fail ? 1 : 0);
