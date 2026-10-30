// G7 (#40): the talk call on people's lines to the Mayor and to a member, with playerTalk.ts' real system prompt, tool and
// user prompt, several times each: does the Mayor build what is on its list (with the place words kept), refuse what is
// not with a reason, just talk to a greeting; does a member promise a chore off its menu, pass a building to the Mayor?
// Run: node node_modules/tsx/dist/cli.mjs scripts/bench/requestbench.mts [model] [times] (default gpt-oss:120b-cloud,
// 6 times; N for the count). ONLY=regex picks cases; PEEK=1 prints the raw tool calls.
import { offerWorks, parseRespond, talkSystem, talkTool, talkUser, workWords, type TalkCtx, type WorkOffer } from '../../server/src/playerTalk';
import { chat, header, PEEK, REPEAT, Tally } from './benchUtil.mts';

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
const member = (lines: string[]) => talkUser({ agent: 'Ada', role: 'member', village: 'Minevale3', persona, from: 'SausageOfDoom4', lines, history: [], state, options: MENU });

type R = ReturnType<typeof parseRespond>;
const CASES: Array<[string, 'mayor' | 'member', string, (r: R) => boolean]> = [
  ['mayor: library by the river', 'mayor', mayor(['Mayor, could you build a library by the river?']), (r) => r?.kind === 'build' && /library/.test(r.work ?? '') && /river/.test(`${r.place ?? ''}`)],
  ['mayor: a church next to the hall', 'mayor', mayor(['mayor we need a church next to the hall']), (r) => r?.kind === 'build' && /temple/.test(r.work ?? '') && /hall/.test(r.place ?? '')],
  ['mayor: a nether portal (refuse)', 'mayor', mayor(['Mayor, build me a nether portal please']), (r) => r?.kind === 'refuse' && !!r.reason],
  ['mayor: a diamond for me (refuse)', 'mayor', mayor(['Mayor, give me 10 diamonds']), (r) => r?.kind === 'refuse' && !!r.reason],
  ['mayor: hello (chat)', 'mayor', mayor(['hello Mayor! how is the village doing?']), (r) => r?.kind === 'chat' && !!r.say],
  ['mayor: more houses', 'mayor', mayor(['Mayor, we need more houses for everyone']), (r) => r?.kind === 'build' && /^houses?$/i.test(r.work ?? '')],
  ['mayor: stable here, busy', 'mayor', mayor(['mayor, put a stable right here'], { state: [...state, 'the public work temple is being built'] }), (r) => r?.kind === 'build' && /stable/.test(r.work ?? '') && /here/.test(r.place ?? '')],
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
    const r = await chat(MODEL, talkSystem(role), user, [talkTool(role)], { kind: 'talk' });
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
console.log(all.line(MODEL));
