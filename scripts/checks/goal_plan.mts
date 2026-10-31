/**
 * The start screen's typed goals, offline (spec runs/2026-10-30/startscreen/spec.md 12.1.1): a goal plan put on a village
 * keeps every typed member's text and measure through ensureGoals' redraws: the plan applied before the draw, a resume with
 * more members (the redraw before counters), a record drawn by another run (no free member in it), a measure-less goal
 * (no `of` entry, no late goal), a checkpoint's plan cleared in a run without one; the goal line and persona name with
 * the text; the pursuit candidates from the typed templates; parsePlan's clipping.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/goal_plan.mts
 */
process.env.MC_GOALS = 'on';
process.env.MC_OWN = 'on';
process.env.MC_INNOVATE = 'on';
const { workerName } = await import('../../server/src/agentNames');
const { vectorOf } = await import('../../server/src/temperament');
const G = await import('../../server/src/goals');
const P = await import('../../server/src/pursuits');
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
const village = (): Village => ({ name: 'GP', objective: '', plots: [], structures: [], complete: true } as unknown as Village);

const raw = {
  mode: 'member', hash: 'h1',
  specs: {
    Mayor: { text: 'explore the far lands and get rich', measure: 'wealth', pursuits: ['explore', 'wealth'], unmatched: [], by: 'user' },
    [workerName(1)]: { text: 'map the far rings and find what is new there', measure: 'invention', pursuits: ['explore', 'research', 'craft', 'house'], unmatched: [], by: 'take' },
    [workerName(2)]: { text: 'steal from each other', measure: null, pursuits: [], unmatched: ['steal from each other'], by: 'user' },
    [workerName(3)]: { text: '   ', measure: 'beauty', pursuits: [], unmatched: [], by: 'user' },
    [workerName(4)]: { text: 'x '.repeat(100), measure: 'fly', pursuits: [], unmatched: [], by: 'user' },
  },
};
const plan = G.parsePlan(raw)!;
ok(!!plan && Object.keys(plan.specs).length === 4, `parsePlan drops the blank text (${Object.keys(plan?.specs ?? {}).join(',')})`);
ok(plan.specs[workerName(1)].pursuits.length === 3, 'parsePlan keeps 3 pursuit templates');
ok(plan.specs[workerName(4)].text.length <= G.GOAL_TEXT_MAX && !plan.specs[workerName(4)].text.endsWith(' '), `parsePlan clips at ${G.GOAL_TEXT_MAX} at a word`);
ok(plan.specs[workerName(4)].measure === null, 'an unknown measure is none');
ok(G.clip('one two three four', 9) === 'one two', `clip at a word (${G.clip('one two three four', 9)})`);

const typed = (v: Village) => {
  const g = G.goalsOf(v)!;
  ok(g.of.Mayor === 'wealth', `${v.name}: the Mayor keeps wealth (${g.of.Mayor})`);
  ok(g.of[workerName(1)] === 'invention', `${v.name}: ${workerName(1)} keeps invention (${g.of[workerName(1)]})`);
  ok(!(workerName(2) in g.of), `${v.name}: the words-only goal has no measure and no late goal (${g.of[workerName(2)]})`);
  ok(G.goalsInPlay().includes(g.of[workerName(5)]), `${v.name}: an untyped member is drawn (${g.of[workerName(5)]})`);
};

// 1. The plan applied, then the draw over 10 members
G.setGoalPlan(plan);
{
  const v = village();
  G.ensureGoals(v, members(10), 1);
  typed(v);
  ok(G.goalsOf(v)!.drawnFor === 7, `drawn over the 7 untyped members (${G.goalsOf(v)!.drawnFor})`);
  // 2. a resume with more members before any counter: redrawn, the typed kept
  G.ensureGoals(v, members(24), 2);
  typed(v);
  ok(G.goalsOf(v)!.drawnFor === 21, `redrawn over 21 untyped (${G.goalsOf(v)!.drawnFor})`);
  ok(Object.keys(G.goalsOf(v)!.of).length === 23, `23 measures (25 members less the two words-only ones): ${Object.keys(G.goalsOf(v)!.of).length}`);
  // the lines
  ok(G.goalLine(v, 'Mayor').startsWith('Your life goal: "explore the far lands and get rich" ('), `goal line with text and progress: ${G.goalLine(v, 'Mayor')}`);
  ok(G.goalLine(v, workerName(2)) === 'Your life goal: "steal from each other".', `words-only goal line: ${G.goalLine(v, workerName(2))}`);
  ok(G.goalName(v, workerName(1)) === '"map the far rings and find what is new there"', 'persona names the text');
  ok(G.goalName(v, workerName(5)) === G.goalsOf(v)!.of[workerName(5)], 'persona names a drawn goal by its word');
  ok(!/"/.test(G.goalLine(v, workerName(5))), 'a drawn goal line as today');
}
// 3. A record drawn by another run for other members (none of the free members in it): redrawn, the typed kept
{
  const v = village() as Village & { goals?: unknown };
  v.goals = { of: { Zed: 'home', Mayor: 'beauty' }, drawnFor: 2, at: 0, stats: { Zed: { done: { bread: 9 }, lights: 0, furnished: 0, furnishedOwn: 0, helps: 0 } } };
  G.ensureGoals(v, members(6), 3);
  typed(v);
}
// 4. Every member typed, none free: the record is never deleted (no endless redraw)
{
  const all = G.parsePlan({ mode: 'village', hash: 'h2', village: 'get rich', specs: Object.fromEntries(members(3).map((m) => [m.name, { text: 'get rich', measure: 'wealth', pursuits: ['wealth'], unmatched: [], by: 'user' }])) })!;
  G.setGoalPlan(all);
  const v = village();
  const g1 = G.ensureGoals(v, members(3), 4);
  G.statsOf(v, 'Mayor').helps = 3;
  const g2 = G.ensureGoals(v, members(3), 5);
  ok(g1 === g2 && g2.stats.Mayor?.helps === 3, 'an all-typed record is kept with its counters');
  ok(Object.values(g2.of).every((x) => x === 'wealth') && Object.keys(g2.of).length === 4, 'all four wealth');
}
// 5. A checkpoint's plan in a run without one: cleared, everyone drawn
{
  G.setGoalPlan(plan);
  const v = village();
  G.ensureGoals(v, members(4), 6);
  G.setGoalPlan(null);
  delete (v as Village & { goals?: unknown }).goals;
  G.ensureGoals(v, members(4), 7);
  ok(!(v as Village & { goalPlan?: unknown }).goalPlan, 'the plan cleared');
  ok(Object.keys(G.goalsOf(v)!.of).length === 5 && !G.goalLine(v, 'Mayor').includes('"'), 'everyone drawn, no typed line');
}
// 6. Pursuit candidates from the typed templates, the goal word's otherwise
{
  const s = P.wantsOf('GP', 'Ada');
  // (the wants tuning: research is a candidate once its experiment was on a menu)
  s.seen['innovate:kiln'] = 1;
  const f = { t: vectorOf('Ada'), notes: [], built: {}, emeralds: 0, inventions: [{ id: 'kiln', name: 'kiln' }], ringLeft: 4, own: true };
  const typedC = P.candidates(s, { ...f, goal: 'invention', goalTemplates: ['explore', 'research'] }, 1, 'x');
  ok(typedC[0]?.template === 'explore' && typedC[0].source === 'your life goal' && typedC[1]?.template === 'research', `typed templates first (${typedC.map((c) => `${c.template}/${c.source}`).join(', ')})`);
  const drawnC = P.candidates(s, { ...f, goal: 'invention' }, 1, 'x');
  ok(drawnC[0]?.template === 'research', `a drawn goal's template (${drawnC[0]?.template})`);
}

console.log(`goal_plan: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
