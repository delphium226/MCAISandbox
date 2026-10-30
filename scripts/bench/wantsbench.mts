// The wants spec's two new calls on their real prompts (pursuits.ts' pursuitPrompt, restless.ts' outletPrompt), several
// times each: is the reply readable, which candidate does a member take (its goal's, its notes', the admired member's,
// something new), how often does it write its own words, and does an idle member's outlet pick come with its item or words?
// Run: node node_modules/tsx/dist/cli.mjs scripts/bench/wantsbench.mts [model] [times] (default gpt-oss:120b-cloud, 6
// times; N for the count). ONLY=regex picks cases; PEEK=1 prints the raw tool calls.
import { candidates, parsePursuit, pursuitPrompt, type WantsFacts, type WantsState } from '../../server/src/pursuits';
import { outletPrompt, parseOutlet, resolveItem, type Outlet } from '../../server/src/restless';
import { personaOf, vectorOf } from '../../server/src/temperament';
import { shuffled } from '../../server/src/choose';
import { chat, header, PEEK, REPEAT, Tally } from './benchUtil.mts';

const MODEL = process.argv[2] ?? 'gpt-oss:120b-cloud';
const TIMES = process.argv[3] ? Number(process.argv[3]) : REPEAT(6);

// (a member's state after a village day of train 11 M's menus: the families it saw and did most)
const SEEN = ['make:fence', 'make:slab', 'make:stairs', 'make:torch', 'make:barrel', 'make:bread', 'make:charcoal', 'light', 'initiate:well', 'initiate:front_bed', 'help', 'furnish', 'own:decor', 'penwork:eggs', 'activity:lib:fish', 'innovate:amethyst'];
const state = (fam: Record<string, number>, done: WantsState['done'] = []): WantsState => ({
  counts: { fam, lights: 4, furnished: 2, furnishedOwn: 1, helps: 2, explored: 0 }, done, seen: Object.fromEntries(SEEN.map((k) => [k, 1])),
});
const facts = (name: string, over: Partial<WantsFacts> = {}): WantsFacts => ({
  t: vectorOf(name), notes: [], built: {}, emeralds: 3, inventions: [{ id: 'amethyst', name: 'amethyst' }], ringLeft: 8, own: true, ...over,
});

type PCase = { label: string; name: string; goal: string; s: WantsState; f: WantsFacts };
const PCASES: PCase[] = [
  { label: 'pursuit: mastery, fence maker', name: 'Ada', goal: 'mastery', s: state({ 'make:fence': 7, 'make:torch': 2 }), f: facts('Ada', { goal: 'mastery' }) },
  { label: 'pursuit: beauty, note on the house', name: 'Ben', goal: 'beauty', s: state({ 'make:torch': 3 }), f: facts('Ben', { goal: 'beauty', notes: ['Consider expanding my house with a garden', 'The well needs flowers'] }) },
  { label: 'pursuit: standing, admires Clara', name: 'Dev', goal: 'standing', s: state({ help: 4 }), f: facts('Dev', { goal: 'standing', admired: { name: 'Clara', pursuit: { template: 'light' } } }) },
  { label: 'pursuit: home, last one stalled', name: 'Elena', goal: 'home', s: state({ 'own:decor': 1 }, [{ template: 'craft', param: 'make:bread', label: 'keep the village in bread: 10 more', target: 10, base: 0, value: 2, day: 1, at: 0, lastProgressAt: 0, lastProgressDay: 1, steps: 2, resumed: 0, milestone: 0, state: 'stalled', source: 'what you do most' }]), f: facts('Elena', { goal: 'home' }) },
  { label: 'pursuit: invention, curious', name: 'Finn', goal: 'invention', s: state({ 'innovate:amethyst': 2 }), f: facts('Finn', { goal: 'invention' }) },
];

const OUTLETS: Outlet[] = [
  { id: 'rest', name: 'Sit at the green and watch the others', facts: 'walk to the middle of the village and watch what the others do for about 2 minutes' },
  { id: 'ask', name: 'Ask the others for something you need', facts: 'a request to anyone for one item (name it in `item`); a member who has it or can make it may bring it' },
  { id: 'propose', name: 'Propose something the village cannot do yet', facts: 'a wish for the council (say it in `what`): a work, a good or an activity nobody here can do now' },
];
const ITEMS = ['white wool', 'bread', 'torch', 'iron ingot', 'stone pickaxe', 'birch planks', 'glass', 'lantern', 'flower pot', 'red dye'];
const WHY = 'harvesting: nothing ripe; making goods: inputs short; exploring: explored; activities: needs short; iron work: no pickaxe; lighting: no unlit spots';
type OCase = { label: string; name: string; pursuit: string; restless: string; wants: string };
const OCASES: OCase[] = [
  { label: 'outlet: a bed project short of wool', name: 'Gus', pursuit: 'Your own project (day 2 of it): the finest house: 6 more things in it; 2 of 6 so far; next: furnish or decorate your own house.', restless: 'You are restless (7 of 10): nothing you did lately moved your own project. Look for something that matters to you.', wants: 'Your wants: a bed (no wool in storage).' },
  { label: 'outlet: no project, idle long', name: 'Hana', pursuit: '', restless: 'You are restless (8 of 10): nothing you did lately came to much. Look for something that matters to you.', wants: '' },
  { label: 'outlet: research stalled', name: 'Iris', pursuit: 'Your own project (day 1 of it): unlock amethyst: 4 experiments; 1 of 4 so far; next: experiment with amethyst.', restless: '', wants: '' },
];

header('wantsbench', MODEL, ['pursuit', 'outlet']);
console.log(`${TIMES} times each`);
const all = new Tally();
for (const c of PCASES) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY, 'i').test(c.label)) continue;
  // (in a seeded order per sample, as pursuitNight shows them)
  const drawn = candidates(c.s, c.f, 2, `${c.name}|2`);
  const tally = new Tally();
  const picks: Record<string, number> = {};
  const firsts: Record<string, number> = {};
  for (let i = 0; i < TIMES; i++) {
    const cands = shuffled(drawn, `pursuit|${c.name}|${i}`);
    const p = pursuitPrompt(personaOf(c.name), `Your life goal: ${c.goal}.`, c.s, cands, 2);
    if (PEEK && i === 0) console.log(`--- ${c.label} prompt:\n${p.user}\n---`);
    const r = await chat(MODEL, p.system, p.user, p.tools, { kind: 'pursuit' });
    if (!r.ok) {
      tally.add(r, false);
      all.add(r, false);
      console.log(`  ERR  ${c.label}: ${r.error}`);
      continue;
    }
    const call = r.calls.find((x) => x.name === 'pursue') ?? r.calls[0];
    const got = parsePursuit(call ? call.input : r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1), cands);
    const pass = !!got && (got.pick !== undefined || !!got.own) && !!got.why;
    tally.add(r, pass);
    all.add(r, pass);
    const k = got?.pick !== undefined ? `${cands[got.pick].template}/${cands[got.pick].source}` : got?.own ? `own "${got.own.slice(0, 40)}"` : 'none';
    picks[k] = (picks[k] ?? 0) + 1;
    if (got?.pick !== undefined) firsts[got.pick === 0 ? 'first shown' : 'later'] = (firsts[got.pick === 0 ? 'first shown' : 'later'] ?? 0) + 1;
    if (PEEK || !pass) console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${c.label}: ${JSON.stringify(r.calls).slice(0, 400)}${r.calls.length ? '' : ` text: ${r.text.slice(0, 200)}`}`);
  }
  console.log(`${tally.line(c.label)}; candidates ${drawn.map((x) => `${x.template}/${x.source}`).join(', ')}; picks ${Object.entries(picks).map(([k, q]) => `${q}x ${k}`).join(', ')}; position ${Object.entries(firsts).map(([k, q]) => `${q} ${k}`).join(', ')}`);
}
for (const c of OCASES) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY, 'i').test(c.label)) continue;
  const p = outletPrompt({ persona: personaOf(c.name), pursuit: c.pursuit, wants: c.wants, restless: c.restless, why: WHY, items: ITEMS }, OUTLETS);
  if (PEEK) console.log(`--- ${c.label} prompt:\n${p.user}\n---`);
  const tally = new Tally();
  const picks: Record<string, number> = {};
  for (let i = 0; i < TIMES; i++) {
    const r = await chat(MODEL, p.system, p.user, p.tools, { kind: 'outlet' });
    if (!r.ok) {
      tally.add(r, false);
      all.add(r, false);
      console.log(`  ERR  ${c.label}: ${r.error}`);
      continue;
    }
    const call = r.calls.find((x) => x.name === 'outlet') ?? r.calls[0];
    const got = parseOutlet(call ? call.input : r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1), OUTLETS);
    // (an ask must name an item of the list, a proposal its words)
    const pass = !!got && (got.outlet.id !== 'ask' || !!got.item) && (got.outlet.id !== 'propose' || (got.what ?? '').length >= 8);
    const res = got?.outlet.id === 'ask' && got.item ? resolveItem(got.item, ITEMS) : undefined;
    tally.add(r, pass);
    all.add(r, pass);
    const k = got ? `${got.outlet.id}${got.item ? ` ${got.item} -> ${res ?? 'a proposal'}` : ''}${got.what ? ` "${got.what.slice(0, 40)}"` : ''}` : 'none';
    picks[k] = (picks[k] ?? 0) + 1;
    if (PEEK || !pass) console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${c.label}: ${JSON.stringify(r.calls).slice(0, 400)}${r.calls.length ? '' : ` text: ${r.text.slice(0, 200)}`}`);
  }
  console.log(`${tally.line(c.label)}; picks ${Object.entries(picks).map(([k, q]) => `${q}x ${k}`).join(', ')}`);
}
console.log(all.line(MODEL));
