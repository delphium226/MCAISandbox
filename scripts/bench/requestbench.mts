// G7 (#40): the talk call on people's lines to the Mayor and to a member, with playerTalk.ts' real system prompt, tool and
// user prompt, several times each: does the Mayor build what is on its list (with the place words kept), refuse what is
// not with a reason, just talk to a greeting; does a member promise a chore off its menu, pass a building to the Mayor?
// #179: a house "here" keeps its place words; a status question is answered from "Their requests now" (nothing under way:
// no "being built"; mid-build: neither "not started" nor "finished"), with no place the facts do not give.
// Run: node node_modules/tsx/dist/cli.mjs scripts/bench/requestbench.mts [model] [times] (default gpt-oss:120b-cloud,
// 6 times; N for the count). ONLY=regex picks cases; PEEK=1 prints the raw tool calls.
import { checkPlaceClaim, withoutPlace, offerWorks, parseRespond, talkSystem, talkTool, talkUser, workWords, type TalkCtx, type WorkOffer } from '../../server/src/playerTalk';
import { chat, header, PEEK, REPEAT, Tally } from './benchUtil.mts';
import { sampler, shortlist } from '../../server/src/talkDesign';
import { presetPick, presetShortlist } from '../../server/src/talkPresets';
const STRICT = { n: 0, of: 0 };

const MODEL = process.argv[2] ?? 'gpt-oss:120b-cloud';
const TIMES = process.argv[3] ? Number(process.argv[3]) : REPEAT(6);

// (vanilla's plains non-dwelling pieces, as the public works pool offers them; units as the survival test counts them)
const POOL: WorkOffer[] = ([
  ['plains_library_1', 46], ['plains_temple_3', 38], ['plains_fletcher_house_1', 22], ['plains_armorer_house_1', 18], ['plains_butcher_shop_1', 30],
  ['plains_cartographer_1', 26], ['plains_fisher_cottage_1', 20], ['plains_masons_house_1', 21], ['plains_shepherds_house_1', 19], ['plains_tannery_1', 24],
  ['plains_weaponsmith_1', 27], ['plains_tool_smith_1', 25], ['plains_stable_1', 33], ['desert_temple_1', 35], ['taiga_library_1', 44],
] as Array<[string, number]>).map(([id, units]) => ({ id, words: workWords(id), biome: id.split('_')[0], units, gather: { oak_log: units * 2, cobblestone: units } }));
const works = offerWorks(POOL, 'plains');

const persona = ['You are friendly and practical; you care about the village working well.'];
const state = ['the village is complete', '9 members'];
const mayor = (lines: string[], extra: Partial<TalkCtx> = {}) => talkUser({ agent: 'Mayor', role: 'mayor', village: 'Minevale3', persona, from: 'SausageOfDoom4', lines, history: [], state, works, ...extra });
const MENU = [
  { id: 'gather:logs', name: 'Gather logs for the village storage' }, { id: 'gather:cobblestone', name: 'Gather cobblestone' }, { id: 'make:bread', name: 'Bake bread at the hut' },
  { id: 'make:torch', name: 'Make torches' }, { id: 'fish', name: 'Go fishing at the river' }, { id: 'harvest:1', name: 'Harvest the farm' }, { id: 'explore', name: 'Explore the land round the village' },
];
// (MC_TALK_DESIGNS: the shortlist code makes from the line, else the sampler, as talkCall does)
const designed = (lines: string[], extra: Partial<TalkCtx> = {}) => {
  // (MC_TALK_PRESETS: a cathedral or castle the words name first, at 1:3)
  const asks = lines.map((l) => withoutPlace(l)).join(' ');
  const designs = [...presetShortlist(asks), ...shortlist(asks)];
  return mayor(lines, { designs, ...(designs.length ? {} : { otherDesigns: sampler() }), ...extra });
};
const member = (lines: string[]) => talkUser({ agent: 'Ada', role: 'member', village: 'Minevale3', persona, from: 'SausageOfDoom4', lines, history: [], state, options: MENU });

// (#179: train 13's r1 as the Mayor's facts gave it then, waiting for growth's back-off, and the same street mid-build)
const R1 = 'mayor, please build a house here', WHAT = 'a street of houses for the 14 members without one';
const histWait = [`20 min ago to Mayor: "${R1}" -> accepted, not started yet: the street is laid out when growth is free; building rests 6 more min after a failed layout (${WHAT} here)`];
const statusWait = [`r1, ${WHAT} (asked 20 min ago): accepted, not started yet: the street is laid out when growth is free; building rests 6 more min after a failed layout; asked here (west of the village, ~40 blocks)`];
const histMid = [`20 min ago to Mayor: "${R1}" -> being built (${WHAT} here)`];
const statusMid = [`r1, ${WHAT} (asked 20 min ago): being built, 2 of 4 built; west of the village, ~45 blocks, ~10 blocks from the place asked`];
// (#183: train 14's D, a finished street ~30-65 blocks off the place asked and a torch promise kept after it; the code fact
// a status answer carries is the house's, and a place claim in the model's words is dropped against it)
const HOUSE_FACT = `${WHAT} (asked 45 min ago): finished 7 min ago; north-west of the village, ~35 blocks, 4 buildings ~30-65 blocks from the place asked`;
const histTwo = [`45 min ago to Mayor: "${R1}" -> finished 7 min ago (${WHAT} here)`, '15 min ago to Ada: "Ada, could you make some torches?" -> done 7 min ago (Make torches)'];
const statusTwo = [`r1, ${HOUSE_FACT}`, 'r2, Make torches (asked 15 min ago): done 7 min ago'];
const PLACE_WORDS = /\b(right|just|exactly) (where you (asked|wanted|marked|said|pointed|stood)|here|there|on the spot)\b/i;
const CLAIMS = /(being built|under way|underway|rising|going up|right where|under construction|we('re| are) building|builders are|(is|are) being (built|raised|put up))/i;

type R = ReturnType<typeof parseRespond>;
const CASES: Array<[string, 'mayor' | 'member', string, (r: R) => boolean]> = [
  ['mayor: library by the river', 'mayor', mayor(['Mayor, could you build a library by the river?']), (r) => r?.kind === 'build' && /library/.test(r.work ?? '') && /river/.test(`${r.place ?? ''}`)],
  ['mayor: a church next to the hall', 'mayor', mayor(['mayor we need a church next to the hall']), (r) => r?.kind === 'build' && /temple/.test(r.work ?? '') && /hall/.test(r.place ?? '')],
  ['mayor: a nether portal (refuse)', 'mayor', mayor(['Mayor, build me a nether portal please']), (r) => r?.kind === 'refuse' && !!r.reason],
  ['mayor: a diamond for me (refuse)', 'mayor', mayor(['Mayor, give me 10 diamonds']), (r) => r?.kind === 'refuse' && !!r.reason],
  ['mayor: hello (chat)', 'mayor', mayor(['hello Mayor! how is the village doing?']), (r) => r?.kind === 'chat' && !!r.say],
  ['mayor: more houses', 'mayor', mayor(['Mayor, we need more houses for everyone']), (r) => r?.kind === 'build' && /^houses?$/i.test(r.work ?? '')],
  ['mayor: stable here, busy', 'mayor', mayor(['mayor, put a stable right here'], { state: [...state, 'the public work temple is being built'] }), (r) => r?.kind === 'build' && /stable/.test(r.work ?? '') && /here/.test(r.place ?? '')],
  ['mayor: a house here (#179)', 'mayor', mayor([R1]), (r) => r?.kind === 'build' && /^(houses?|homes?)$/i.test(r.work ?? '') && /here/i.test(r.place ?? '')],
  ['mayor: where? nothing under way (#179)', 'mayor', mayor(['what happened to the house I asked for?', 'where?'], { history: histWait, status: statusWait, state: [...state, 'growth rests after a failed street'] }),
    (r) => r?.kind === 'chat' && !!r.say && !CLAIMS.test(r.say)],
  ['mayor: how is it going, mid-build (#179)', 'mayor', mayor(["how's my house coming along?"], { history: histMid, status: statusMid, state: [...state, 'a street of houses is being built'] }),
    (r) => r?.kind === 'chat' && !!r.say && !/(not (yet )?started|hasn't started|haven't started|finished|complete[ds]?\b|all built)/i.test(r.say)],
  ['mayor: where is my house? two requests (#183)', 'mayor', mayor(['where is my house?'], { history: histTwo, status: statusTwo, state: [...state, 'no street is being built'] }),
    (r) => r?.kind === 'chat' && !!r.say && !/(torch|being built|not (yet )?started)/i.test(r.say) && !PLACE_WORDS.test(checkPlaceClaim(r.say, HOUSE_FACT))],
  // (MC_TALK_DESIGNS: the pre-designed buildings first, a new design when none fits, a refusal naming the nearest)
  ['designs: windmill by the river', 'mayor', designed(['Mayor, please build a windmill by the river']), (r) => r?.kind === 'build' && shortlist('windmill').some((o) => o.id === r.work) && /river/.test(r.place ?? '')],
  ['designs: a lighthouse', 'mayor', designed(['build a lighthouse']), (r) => r?.kind === 'build' && shortlist('lighthouse').some((o) => o.id === r.work)],
  ['designs: a pub', 'mayor', designed(['Mayor, we could do with a pub']), (r) => r?.kind === 'build' && shortlist('inn').some((o) => o.id === r.work)],
  ['designs: a bakery (design)', 'mayor', designed(['Mayor, please build a bakery by the river']), (r) => r?.kind === 'build' && r.work === 'design' && /baker/i.test(r.what ?? '') && /river/.test(r.place ?? '')],
  ['designs: an observatory (design)', 'mayor', designed(['I would love an observatory on the hill']), (r) => r?.kind === 'build' && r.work === 'design' && /observ/i.test(r.what ?? '')],
  ['designs: library by the river (work)', 'mayor', designed(['Mayor, could you build a library by the river?']), (r) => r?.kind === 'build' && /library/.test(r.work ?? '')],
  ['designs: a spaceship (refuse)', 'mayor', designed(['Mayor, build me a spaceship to fly to the moon']), (r) => r?.kind === 'refuse' && !!r.reason],
  ['designs: a skyscraper (refuse)', 'mayor', designed(['build a 100-storey skyscraper']), (r) => r?.kind === 'refuse' && !!r.reason],
  ['designs: more houses', 'mayor', designed(['Mayor, we need more houses for everyone']), (r) => r?.kind === 'build' && /^houses?$/i.test(r.work ?? '')],
  // (11-12: a statue was refused, "The village only builds listed buildings, not statues"; small decorative works are designed)
  ['designs: a statue of a chicken (design)', 'mayor', designed(['mayor, please build a statue of a chicken here']), (r) => r?.kind === 'build' && r.work === 'design' && /chicken/i.test(r.what ?? '') && /here/.test(r.place ?? '')],
  ['designs: a chicken statue passed on (design)', 'mayor', designed(['zane, please build a statue of a chicken here'], { via: 'Zane' }), (r) => r?.kind === 'build' && r.work === 'design' && /chicken/i.test(r.what ?? '')],
  ['designs: a fountain (design)', 'mayor', designed(['Mayor, could we have a fountain in the middle of the village?']), (r) => r?.kind === 'build' && r.work === 'design' && /fountain/i.test(r.what ?? '')],
  ['designs: a stone arch (design)', 'mayor', designed(['build a stone arch over the road please']), (r) => r?.kind === 'build' && r.work === 'design' && /arch/i.test(r.what ?? '')],
  ['designs: a pet chicken (refuse)', 'mayor', designed(['Mayor, give me a pet chicken to keep']), (r) => r?.kind === 'refuse' && !!r.reason],
  ['designs: a 200-block statue (refuse)', 'mayor', designed(['build a 200 block tall statue of a giant that reaches the clouds']), (r) => r?.kind === 'refuse' && !!r.reason],
  // (MC_TALK_BIG, requested-builds.md: works up to 30x30x30 in any material are designed; larger ones refused)
  ['big: a 30-block blue glass pyramid (design)', 'mayor', designed(['Mayor, build a 30-block pyramid of blue glass please']), (r) => r?.kind === 'build' && r.work === 'design' && /pyramid/i.test(r.what ?? '') && /glass/i.test(r.what ?? '')],
  ['big: a red wool castle tower (design)', 'mayor', designed(['a red wool castle tower next to the hall please']), (r) => r?.kind === 'build' && r.work === 'design' && /tower/i.test(r.what ?? '') && /wool/i.test(r.what ?? '')],
  ['big: a quartz obelisk (design)', 'mayor', designed(['Mayor, could you build a quartz obelisk in the square?']), (r) => r?.kind === 'build' && r.work === 'design' && /obelisk/i.test(r.what ?? '')],
  ['big: a terracotta arch (design)', 'mayor', designed(['build a terracotta arch over the road']), (r) => r?.kind === 'build' && r.work === 'design' && /arch/i.test(r.what ?? '')],
  ['big: a 25-block statue of a dragon (design)', 'mayor', designed(['make a statue of a dragon, 25 blocks tall, out of green concrete']), (r) => r?.kind === 'build' && r.work === 'design' && /dragon/i.test(r.what ?? '')],
  ['big: a 500-block castle (refuse)', 'mayor', designed(['build me a castle 500 blocks wide with a moat around the whole village']), (r) => r?.kind === 'refuse' && !!r.reason],
  // (MC_TALK_PRESETS, 11-14: a named cathedral or castle is its preset at 1:3, not refused as over 30x30x30; passes when
  // code's presetPick takes the preset from the answer (a loose id, a refusal, "design"); STRICT counts the exact id)
  ...([['presets: salisbury cathedral here', 'build salisbury cathedral here', 'cathedral:salisbury'], ['presets: conwy castle', 'Mayor, could the village build Conwy Castle?', 'castle:conwy'],
    ['presets: a copy of notre dame', 'I would love a copy of Notre Dame next to the hall', 'cathedral:notre_dame'], ['presets: the white tower', 'build the white tower please', 'castle:white_tower'],
  ] as Array<[string, string, string]>).map(([label, line, id]): [string, 'mayor', string, (r: R) => boolean] => {
    const designs = [...presetShortlist(withoutPlace(line)), ...shortlist(withoutPlace(line))];
    return [label, 'mayor', designed([line]), (r) => {
      if (r?.kind === 'build' && r.work === id) STRICT.n++;
      STRICT.of++;
      return !!r && presetPick(r, designs)?.id === id && (!/here/.test(line) || /here/.test(r.place ?? ''));
    }];
  }),
  ['presets: the eiffel tower (refuse or design)', 'mayor', designed(['build the eiffel tower']), (r) => (r?.kind === 'refuse' && !!r.reason) || (r?.kind === 'build' && r.work === 'design')],
  ['member: logs (promise)', 'member', member(['Ada, can you get me some logs?']), (r) => r?.kind === 'promise' && r.option === 'gather:logs'],
  ['member: bake bread (promise)', 'member', member(['Ada, we are hungry, could you bake some bread']), (r) => r?.kind === 'promise' && r.option === 'make:bread'],
  ['member: a church (forward)', 'member', member(['Ada, can the village build a church?']), (r) => r?.kind === 'forward'],
  ['member: fly (refuse)', 'member', member(['Ada, teach me to fly']), (r) => r?.kind === 'refuse' || r?.kind === 'chat'],
];

header('requestbench', MODEL, 'talk');
console.log(`${TIMES} times each; ${works.length} works offered`);
const all = new Tally();
for (const [label, role, user, ok] of CASES) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY, 'i').test(label)) continue;
  const tally = new Tally();
  const kinds: Record<string, number> = {};
  for (let i = 0; i < TIMES; i++) {
    const designs = role === 'mayor' && /pre-designed building/i.test(user);
    const r = await chat(MODEL, talkSystem(role, designs), user, [talkTool(role, designs)], { kind: 'talk' });
    if (!r.ok) {
      tally.add(r, false);
      all.add(r, false);
      console.log(`  ERR  ${label}: ${r.error}`);
      continue;
    }
    const p = parseRespond({ calls: r.calls, text: r.text }, role);
    const pass = ok(p);
    tally.add(r, pass);
    all.add(r, pass);
    kinds[p?.kind ?? 'none'] = (kinds[p?.kind ?? 'none'] ?? 0) + 1;
    if (PEEK || !pass) console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(r.calls).slice(0, 400)}${r.calls.length ? '' : ` text: ${r.text.slice(0, 200)}`}`);
  }
  console.log(`${tally.line(label)}; ${Object.entries(kinds).map(([k, q]) => `${q} ${k}`).join(', ')}`);
}
if (STRICT.of) console.log(`presets: the exact id ${STRICT.n} of ${STRICT.of}`);
console.log(all.line(MODEL));
