/**
 * Life goals, offline (s44, #79, spec runs/2026-10-21/s44/spec_life_goals.md): the draw (every goal present at 25 and at
 * 50 members, the cap, the same names giving the same goals, the Mayor drawn), a late arrival's goal, the counters and
 * progress lines on a fixture record, which options serve which goal, the goal's weight, and the fixed pick choosing a
 * goal's option over a better-ranked one with temperaments on and off (no rank decay on it, the product capped).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/goals_unit.mts
 */
process.env.MC_OWN = 'on';
process.env.MC_INNOVATE = 'on';
const { workerName } = await import('../../server/src/agentNames');
const { vectorOf } = await import('../../server/src/temperament');
const G = await import('../../server/src/goals');
const { fixedPick, weights, WEIGHT_CAP } = await import('../../server/src/choose');
import type { ChoiceMenu, ChoiceOption } from '../../server/src/world';
import type { Village } from '../../server/src/village';

let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};
const members = (n: number) => [{ name: 'Mayor', t: vectorOf('Mayor') }, ...Array.from({ length: n }, (_, i) => ({ name: workerName(i + 1), t: vectorOf(workerName(i + 1)) }))];

// The draw
for (const n of [24, 49]) {
  const m = members(n), d = G.drawGoals(m), counts: Record<string, number> = {};
  for (const g of Object.values(d)) counts[g] = (counts[g] ?? 0) + 1;
  ok(Object.keys(d).length === m.length, `${m.length} members: everyone has a goal`);
  ok(G.GOALS.every((g) => counts[g] >= 1), `${m.length} members: every goal present (${JSON.stringify(counts)})`);
  ok(Math.max(...Object.values(counts)) <= Math.ceil(m.length / 6) + 1, `${m.length} members: cap held`);
  ok(JSON.stringify(G.drawGoals(m)) === JSON.stringify(d) && JSON.stringify(G.drawGoals([...m].reverse())) === JSON.stringify(Object.fromEntries(Object.entries(d).sort())) || JSON.stringify(Object.entries(G.drawGoals([...m].reverse())).sort()) === JSON.stringify(Object.entries(d).sort()), `${m.length} members: the same goals whatever the order`);
  if (n === 24) console.log(`  25 members: ${JSON.stringify(counts)}; ${Object.entries(d).slice(0, 8).map(([k, g]) => `${k} ${g}`).join(', ')}, ...`);
}
// The most curious worker draws invention, the proudest beauty, unless the cap or a first pass took them
{
  const m = members(24), d = G.drawGoals(m);
  const top = (t: 'curiosity' | 'pride') => [...m].sort((a, b) => b.t[t] - a.t[t])[0].name;
  ok(d[top('curiosity')] === 'invention', `the most curious (${top('curiosity')}) draws invention (${d[top('curiosity')]})`);
  ok(d[top('pride')] === 'beauty', `the proudest (${top('pride')}) draws beauty (${d[top('pride')]})`);
}
// A late arrival
{
  const of = G.drawGoals(members(24));
  ok(G.GOALS.includes(G.lateGoal('Yara', vectorOf('Yara'), of)), 'a late arrival gets a goal');
}

// The record, counters and progress
const v = { name: 'T', complete: true, plots: [], layouts: [], homes: { Ada: { owed: {}, got: {}, used: {}, chest: { x: 0, y: 0, z: 0, items: { emerald: 3, bread: 4 } } } }, initiatives: [
  { id: 'i1', by: 'Ben', kind: 'statue', state: 'built', crew: [], steps: [] },
  { id: 'i2', by: 'Ben', kind: 'well', state: 'built', crew: [], steps: [] },
] } as unknown as Village;
const g = G.ensureGoals(v, [{ name: 'Ada', t: vectorOf('Ada') }, { name: 'Ben', t: vectorOf('Ben') }], 0);
ok(!!g.of.Ada && !!g.of.Ben, 'goals drawn on the record');
for (let i = 0; i < 6; i++) G.noteEnd(v, 'Ada', 'make', 'make:bread', 'Make bread', 'made 4 bread; put into storage: 4 bread');
G.noteEnd(v, 'Ben', 'make', 'make:bread', 'Make bread', 'made 4 bread');
G.noteEnd(v, 'Ben', 'light', 'light:p1', 'Light the hut', 'lit 7 torch spots in the hut (7 of 9 lit)');
G.noteEnd(v, 'Ben', 'furnish', 'furnish:p2', 'Furnish your own house (house 3)', 'furnished 3 spots in house 3');
G.noteEnd(v, 'Ben', 'help', 'help:i1', 'Help Ada build a bench: build it', 'done');
G.noteEnd(v, 'Ben', 'help', 'help:i2', 'Continue your well: build it', 'done');
ok(G.topCraft(g.stats.Ada) === 'make:bread' && G.topCraft(g.stats.Ben) === undefined, 'mastery: a craft after 5 times');
ok(/86% of the village's bread/.test(G.progress(v, 'Ada', 'mastery').text), `mastery line: ${G.progress(v, 'Ada', 'mastery').text}`);
ok(/1 work of yours stand; 7 lights/.test(G.progress(v, 'Ben', 'beauty').text), `beauty line: ${G.progress(v, 'Ben', 'beauty').text}`);
ok(/1 help on others' projects; 1 public work/.test(G.progress(v, 'Ben', 'standing').text), `standing line: ${G.progress(v, 'Ben', 'standing').text}`);
ok(/3 spots furnished, a chest of your own|3 spots furnished/.test(G.progress(v, 'Ben', 'home').text), `home line: ${G.progress(v, 'Ben', 'home').text}`);
ok(/3 emeralds/.test(G.progress(v, 'Ada', 'wealth').text), `wealth line: ${G.progress(v, 'Ada', 'wealth').text}`);
ok(G.goalLine(v, 'Ada').startsWith('Your life goal: '), `goal line: ${G.goalLine(v, 'Ada')}`);

// Serving
const opt = (kind: string, id: string, name = id, rank = 900): ChoiceOption => ({ id, kind, key: id, excludes: [], name, rank } as unknown as ChoiceOption);
ok(G.serves('beauty', opt('initiate', 'initiate:statue'), { work: 'statue' }) && !G.serves('beauty', opt('initiate', 'initiate:well'), { work: 'well' }), 'beauty: a statue, not a well');
ok(G.serves('standing', opt('initiate', 'initiate:well'), { work: 'well' }) && G.serves('standing', opt('help', 'help:i1'), {}) && !G.serves('standing', opt('help', 'help:i2'), { mine: true }), "standing: a well and help on others' projects");
ok(G.serves('home', opt('furnish', 'furnish:p', 'Furnish your own house (house 3)'), {}) && !G.serves('home', opt('furnish', 'furnish:p', 'Furnish the hut'), {}), 'home: its own house only');
ok(G.serves('invention', opt('innovate', 'innovate:hay'), {}) && G.serves('invention', opt('own', 'own:pledge:hay'), { own: 'pledge' }) && !G.serves('wealth', opt('own', 'own:pledge:hay'), { own: 'pledge' }), 'invention: experiments and pledges');
ok(G.serves('mastery', opt('make', 'make:bread'), {}, 'make:bread') && !G.serves('mastery', opt('make', 'make:torch'), {}, 'make:bread'), 'mastery: its own craft');
ok(G.serves('beauty', opt('make', 'make:lantern'), { good: 'lantern' }), 'beauty: lanterns');
ok(G.goalWeight(0) === 2 && G.goalWeight(1) === 1.6, 'goal weight 1.6..2');

// The fixed pick: a goal's option late in rank order beats the first kind, temperaments off (only gw) and on
const menu = (options: ChoiceOption[]): ChoiceMenu => ({ agent: 'Ada', village: 'T', t: 0, options, guarded: [], reasons: {}, ctx: { persona: '', village: '', others: '', outcomes: [] } });
const kinds = ['farm', 'slot', 'make', 'gather', 'light', 'furnish', 'help', 'initiate'];
{
  const os = kinds.map((k, i) => opt(k, `${k}:1`, k, 100 * (i + 1)));
  ok(fixedPick(menu(os))?.kind === 'farm', 'no weights: the lowest rank');
  os[7].gw = 1.6;
  ok(fixedPick(menu(os))?.kind === 'initiate', 'temperaments off: the goal option (gw only)');
  for (const o of os) o.tw = 1;
  os[0].tw = 2.5;
  ok(fixedPick(menu(os))?.kind === 'farm', 'a strongly enjoyed first kind beats a goal of 1.6');
  os[7].tw = 2.5;
  os[7].gw = 2;
  ok(fixedPick(menu(os))?.kind === 'initiate', 'enjoyed and a goal: the goal option');
  ok(weights({ ...os[7], nw: 3 } as ChoiceOption) === WEIGHT_CAP, 'the product capped');
}

console.log(`${fail ? 'FAIL' : 'PASS'} goals_unit (${pass} passed, ${fail} failed)`);
process.exit(fail ? 1 : 0);
