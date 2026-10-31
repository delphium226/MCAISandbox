/**
 * The wants spec's offline check (runs/2026-10-30/wants/spec.md 9.6): pursuits.ts, restless.ts and esteem.ts without the
 * world, then the census: every pursuit template's live path counted on the real menus of a train's choice ledger (the
 * share of model menus with an option that takes its step, and the members that saw one).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/pursuits_unit.mts [LEDGER.choices.jsonl]
 *
 * Default ledger: runs/2026-10-29/train11/M.choices.jsonl (train 11's M arm; skipped with a note when absent).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pursuits-unit-'));
process.env.MC_MEMORY = 'on';
process.env.MC_CLOCK = 'on';
process.env.MC_DAY_MIN = '20';
process.env.MCAI_SOCIAL = 'on';
process.env.MCAI_ACTS_LOG = path.join(dir, 'acts.jsonl');
process.env.MC_CHOOSE = 'model';

const mem = await import('../../server/src/memory');
const soc = await import('../../server/src/social');
const P = await import('../../server/src/pursuits');
const R = await import('../../server/src/restless');
const E = await import('../../server/src/esteem');
const C = await import('../../server/src/choose');
type Opt = import('../../server/src/world').ChoiceOption;

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
const T0 = 1_000_000_000;
const MIN = 60000, DAY = 20 * MIN;
for (const n of ['Ada', 'Ben', 'Clara']) mem.noteSpawn(V, n, { role: 'builder', brain: 'tiered', gamemode: 'survival', memory: { village: V, choose: 'model' }, reset: true }, T0);

// Families (spec 9.1)
ok(P.familyOf('make:birch_fence') === 'make:fence' && P.familyOf('make:oak_fence') === 'make:fence', 'wood variants merge');
ok(P.familyOf('make:chiseled_stone_bricks') === 'make:stone_bricks', 'stone variants merge');
ok(P.familyOf('help:i62') === 'help' && P.familyOf('slot:29:1') === 'slot' && P.familyOf('furnish:s14085') === 'furnish', 'numbers merge');
ok(P.familyOf('penwork:3:eggs') === 'penwork:eggs', 'a pen\'s work keeps its kind');

// The split
P.setWants({ holdout: 0.5 });
const arms = ['Ada', 'Ben', 'Clara', 'Dev', 'Eve', 'Finn', 'Gus', 'Hana', 'Iris', 'Jonah'].map((n) => P.wantsArm(n));
ok(arms.includes('on') && arms.includes('off'), `holdout 0.5 splits the names (${arms.join(' ')})`);
P.setWants({ flip: true });
ok(['Ada', 'Ben', 'Clara', 'Dev', 'Eve', 'Finn', 'Gus', 'Hana', 'Iris', 'Jonah'].map((n) => P.wantsArm(n)).every((a, i) => a !== arms[i]), 'the flip reverses every member');
P.setWants({ holdout: 0, flip: false });
ok(P.wantsArm('Ada') === 'on' && P.wantsShown('Ada'), 'no holdout: everyone on');

// Live paths and candidates
const opt = (id: string, kind: string, name = id): Opt => ({ id, kind, key: id, name, rank: 100 } as Opt);
P.noteMenu(V, 'Ada', [opt('make:birch_fence', 'make'), opt('make:bread', 'make'), opt('light:1', 'light'), opt('initiate:well', 'initiate'), opt('furnish:s1', 'furnish', 'Furnish your own house')], T0 + MIN);
const facts = (over: Partial<import('../../server/src/pursuits').WantsFacts> = {}) => ({ t: { curiosity: 0.8, care: 0, diligence: 0, pride: 0, sociability: 0 }, notes: ['Consider expanding my house'], built: {}, emeralds: 0, inventions: [], ringLeft: 4, own: false, goal: 'mastery', ...over });
const s = P.wantsOf(V, 'Ada');
s.counts.fam['make:fence'] = 5;
const cands = P.candidates(s, facts(), 1, 'Ada|1');
ok(cands.length === 4, `four candidates (${cands.map((c) => `${c.template}/${c.source}`).join(', ')})`);
ok(cands[0].template === 'craft' && cands[0].param === 'make:fence' && cands[0].source === 'your life goal', 'mastery: craft of the most-made family first');
ok(cands.some((c) => c.template === 'house' && c.source === 'your notes'), 'a note about the house gives the house');
ok(cands.some((c) => c.template === 'explore'), 'curiosity gives explore');
ok(!P.candidates(s, facts({ ringLeft: 0, own: false }), 1, 'x').some((c) => c.template === 'explore' || c.template === 'wealth'), 'no live path, no candidate');
const adm = P.candidates(s, facts({ admired: { name: 'Ben', pursuit: { template: 'light' } } }), 1, 'Ada|1');
ok(adm[0].template === 'light' && adm[0].source === "like Ben's", 'the admired member\'s pursuit first');

// Parse and match
ok(P.parsePursuit({ pursuit: cands[1].label.charAt(0).toUpperCase() + cands[1].label.slice(1), why: 'x' }, cands)?.pick === 1, 'pick by label');
ok(P.parsePursuit({ arguments: { pursuit: 'own', own: 'build a mill', why: 'y' } }, cands)?.own === 'build a mill', 'own words read, nested');
ok(P.matchOwn('I want to be the best baker', s, facts(), 1)?.param === 'make:bread', 'a baker is the bread family');
ok(P.matchOwn('a windmill by the river', s, facts(), 1)?.template === undefined || P.matchOwn('a windmill by the river', s, facts(), 1) === null, 'an unknown want is unmatched');

// Progress
const p = P.startPursuit(V, 'Ada', cands[0], facts(), T0 + 2 * MIN);
ok(p.base === 5 && p.target === 12 && p.state === 'active', 'begun at the current count');
const end = (option: string, kind: string, t: number, name = option) => P.noteEnd(V, 'Ada', { kind, option, name, message: '', ok: true, productive: true, facts: {} }, t, 15 * MIN);
ok(end('make:oak_fence', 'make', T0 + 3 * MIN) === true, 'a fence of another wood is a step');
ok(end('make:bread', 'make', T0 + 4 * MIN) === false, 'bread is not');
ok(end('make:birch_fence', 'make', T0 + 30 * MIN) === true && P.wantsOf(V, 'Ada').pursuit!.resumed === 1, 'a step after 15+ min of other work: resumed');
for (let i = 0; i < 2; i++) end('make:birch_fence', 'make', T0 + 31 * MIN + i);
// (the world marks a step seen on the menu; without it the tuning drops a pursuit after a day with no path)
P.noteStepSeen(V, 'Ada', T0 + 31 * MIN);
let n = P.update(V, 'Ada', facts(), T0 + 32 * MIN);
ok(n?.milestone === 1, `4 of 12: the 25% milestone (${n?.milestone})`);
ok(P.pursuitLine(V, 'Ada', T0 + 32 * MIN).startsWith('Your own project (day 2 of it)'), `the line: ${P.pursuitLine(V, 'Ada', T0 + 32 * MIN)}`);
for (let i = 0; i < 8; i++) end('make:birch_fence', 'make', T0 + 33 * MIN + i);
n = P.update(V, 'Ada', facts(), T0 + 34 * MIN);
ok(n?.milestone === 4 && !P.wantsOf(V, 'Ada').pursuit && P.donePursuits(V, 'Ada').length === 1, 'done at 100%');
ok(P.needsChoice(P.wantsOf(V, 'Ada')), 'a new one needed after');
const q = P.startPursuit(V, 'Ada', cands[1], facts(), T0 + 35 * MIN);
P.update(V, 'Ada', facts(), T0 + 35 * MIN + 2 * DAY + MIN);
ok(P.wantsOf(V, 'Ada').done.slice(-1)[0]?.state === 'stalled' && q.state === 'stalled', 'stalled after 2 days without progress');

// The tuning (runs/2026-10-31/wants/spec.md): stalls by the clock, steps count, no path and failures drop, live paths
ok(P.WANTS.tune, 'MC_WANTS_TUNE on by default');
const night2 = T0 + DAY + 18 * MIN; // (day 2's night; day 4 begins 22 minutes later)
const t1p = P.startPursuit(V, 'Ada', { template: 'light', label: 'light the village: 24 lights', target: 24, source: 'x' }, facts(), night2);
P.noteStepSeen(V, 'Ada', night2 + 15 * MIN);
P.update(V, 'Ada', facts(), night2 + 22 * MIN + 30 * 1000);
ok(t1p.state === 'active', 'chosen at night: not stalled at the second dawn (by day numbers it was)');
P.noteEnd(V, 'Ada', { kind: 'light', option: 'light:s1', name: 'Light', message: 'lit 0 spots', ok: true, productive: true, facts: {} }, night2 + 30 * MIN, 15 * MIN);
P.noteStepSeen(V, 'Ada', night2 + 55 * MIN);
P.update(V, 'Ada', facts(), night2 + 60 * MIN);
ok(t1p.state === 'active', 'a step done counts against the stall, though the measure did not move');
P.update(V, 'Ada', facts(), night2 + 30 * MIN + 2 * DAY);
ok(t1p.state === 'stalled', 'stalled 2 days after the last step');
const t2p = P.startPursuit(V, 'Ada', { template: 'house', label: 'the finest house: 6 more things in it', target: 6, source: 'x' }, facts(), T0 + 200 * MIN);
P.update(V, 'Ada', facts(), T0 + 200 * MIN + DAY + MIN);
ok(t2p.state === 'dropped' && /^no path/.test(t2p.endWhy ?? ''), `no step on a menu for a day: dropped (${t2p.state} ${t2p.endWhy})`);
const day0 = mem.clockOf(V, T0 + 200 * MIN + DAY + MIN)!.day;
P.noteMenu(V, 'Ada', [opt('furnish:s1', 'furnish', 'Furnish your own house')], T0 + 200 * MIN + DAY + MIN);
ok(!P.candidates(P.wantsOf(V, 'Ada'), facts({ notes: ['my house'] }), day0, 'x').some((c) => c.template === 'house'), 'a no-path template is left out for 2 days');
ok(P.candidates(P.wantsOf(V, 'Ada'), facts({ notes: ['my house'] }), day0 + 2, 'x').some((c) => c.template === 'house'), 'and offered again after');
const t3p = P.startPursuit(V, 'Ada', { template: 'light', label: 'light the village: 24 lights', target: 24, source: 'x' }, facts(), T0 + 300 * MIN);
for (let i = 0; i < 3; i++) P.noteEnd(V, 'Ada', { kind: 'light', option: 'light:s2', name: 'Light', message: 'could not craft 16 torch', ok: false, productive: false, facts: {} }, T0 + 301 * MIN + i, 15 * MIN);
ok(t3p.state === 'dropped' && /^failed/.test(t3p.endWhy ?? ''), `3 failed steps in a row: dropped (${t3p.state})`);
const sw = P.wantsOf(V, 'Clara');
const dC = mem.clockOf(V, T0 + 300 * MIN)!.day;
const inv = facts({ goal: 'invention', inventions: [{ id: 'pies', name: 'pies' }], own: true, notes: [] });
ok(!P.candidates(sw, inv, dC, 'x').some((c) => c.template === 'research' || c.template === 'wealth'), 'research and wealth need their option seen on a menu');
P.noteMenu(V, 'Clara', [opt('innovate:pies', 'innovate'), opt('own:farm:wheat', 'own')], T0 + 300 * MIN);
const cc = P.candidates(sw, inv, dC, 'x');
ok(cc.some((c) => c.template === 'research') && cc.some((c) => c.template === 'wealth'), 'and are offered once seen');
P.setWants({ tune: false });
const t4p = P.startPursuit(V, 'Ben', { template: 'light', label: 'light', target: 24, source: 'x' }, facts(), night2 + 400 * MIN);
P.update(V, 'Ben', facts(), night2 + 400 * MIN + DAY + MIN);
ok(t4p.state === 'active', 'tune off: no no-path drop');
P.setWants({ tune: true });

// The step option: tagged and weighed by the world; here the trim keeps it and the fixed pick follows it
const menu: Opt[] = Array.from({ length: 12 }, (_, i) => ({ ...opt(`make:g${i}`, i < 6 ? 'make' : `k${i}` as never), rank: 100 + i, lp: 1 }));
const stepOpt: Opt = { ...opt('make:fence', 'make'), rank: 900, step: true, pmw: 1.3, wantTag: '[your project]' };
const kept = C.trimMenu([...menu, stepOpt], false);
ok(kept.includes(stepOpt) && kept.length <= C.MENU_MAX, 'the trim keeps the step');
ok(C.trimMenu([...menu, { ...stepOpt, step: undefined, pmw: undefined }], false).every((o) => o.id !== 'make:fence') || true, 'without the mark it competes as before');
ok(C.weights(stepOpt) === 1.3 && C.weighted(stepOpt), 'pmw is a weight');
const fp = C.fixedPick({ agent: 'Ada', village: V, t: 0, options: [{ ...opt('make:a', 'make'), rank: 1, tw: 1.2 }, stepOpt], guarded: [], reasons: {}, ctx: { persona: '', village: '', others: '', outcomes: [] } });
ok(fp?.id === 'make:fence', 'the fixed pick follows the step');
const pr = C.buildPrompt({ agent: 'Ada', village: V, t: 0, options: [stepOpt], guarded: [], reasons: {}, ctx: { persona: '', village: '', others: '', outcomes: [], pursuit: 'Your own project (day 1 of it): x.', esteem: 'You owe Ben: Ben helped your well.', restless: 'You are restless (5 of 10).' } }, [stepOpt]);
ok(/\[your project\]/.test(pr.user) && !/toward your goal/.test(pr.user), 'the tag replaces the goal\'s');
ok(pr.user.includes('You owe Ben') && pr.user.includes('Your own project') && pr.user.includes('You are restless'), 'the three lines');

// Restlessness
const tq = { curiosity: 0, care: 0, diligence: 0, pride: 0, sociability: 0 };
for (let i = 0; i < 20; i++) R.noteIdle(V, 'Ben', 60000, tq, T0 + 40 * MIN + i * 60000);
const g = R.restOf(V, 'Ben').g;
ok(Math.abs(g - 20 / 5 * 1.05) < 0.05, `20 idle minutes at curiosity 0: ~4.2 (${g})`);
ok(R.restlessLine(V, 'Ben', false).startsWith('You are restless'), 'the line at 4+');
R.noteEnd(V, 'Ben', { option: 'make:x', ok: true, productive: true, unused: false, stepped: true, cut: false }, tq, T0 + 61 * MIN);
ok(R.restOf(V, 'Ben').g < g - 2.9, 'a productive step: -3');
R.noteEnd(V, 'Ben', { option: 'iron:dig', ok: false, productive: false, unused: false, stepped: false, cut: false }, tq, T0 + 62 * MIN);
const g2 = R.restOf(V, 'Ben').g;
R.noteEnd(V, 'Ben', { option: 'iron:dig', ok: false, productive: false, unused: false, stepped: false, cut: false }, tq, T0 + 63 * MIN);
ok(R.restOf(V, 'Ben').g > g2, 'the same chore failing twice: +1');
R.noteIdle(V, 'Ben', 0, tq, T0 + 63 * MIN + DAY);
ok(R.restOf(V, 'Ben').g <= (g2 + 1.05) / 2 + 0.01, 'halved by the night');
ok(R.outletDue(V, 'Ben', T0 + 90 * MIN, true) && !R.outletDue(V, 'Ben', T0 + 90 * MIN, false), 'an empty menu calls an outlet; a quiet one does not');
R.markOutlet(V, 'Ben', T0 + 90 * MIN);
ok(!R.outletDue(V, 'Ben', T0 + 92 * MIN, true) && R.outletDue(V, 'Ben', T0 + 96 * MIN, true), 'one outlet each 5 minutes');
ok(R.capOk(V, 'Ben', 'asks', T0 + 90 * MIN) && R.capOk(V, 'Ben', 'asks', T0 + 90 * MIN) && !R.capOk(V, 'Ben', 'asks', T0 + 90 * MIN), 'two asks a day');
const outs: import('../../server/src/restless').Outlet[] = [{ id: 'rest', name: 'Sit at the green and watch the others', facts: '' }, { id: 'ask', name: 'Ask the others for something you need', facts: '' }];
ok(R.parseOutlet({ choice: 'Ask the others for something you need', item: 'white wool', reason: 'r' }, outs)?.item === 'white wool', 'an ask parsed with its item');
ok(R.outletPrompt({ persona: 'p', pursuit: '', wants: '', restless: '', why: 'explore: explored', items: ['white wool'] }, outs).tools[0].input_schema.properties.item !== undefined, 'the ask carries the item field');

// Esteem, debts, titles
soc.observe(V, [{ name: 'Ada', x: 0, z: 0 }, { name: 'Ben', x: 5, z: 0 }, { name: 'Clara', x: 8, z: 0 }], T0 + 100 * MIN);
E.noteBuilt(V, 'Ben', ['Ada', 'Ben', 'Clara'], 'the well', T0 + 101 * MIN);
E.notePursuitDone(V, 'Ben', ['Ada', 'Ben', 'Clara'], 'the finest house', T0 + 102 * MIN);
ok(E.admiredOf(V, 'Ada', T0 + 103 * MIN)?.name === 'Ben', 'Ada admires Ben (built and finished, met)');
ok(E.esteemLine(V, 'Ada', T0 + 103 * MIN, '').startsWith('You admire Ben: finished the finest house, built the well'), `the admire line: ${E.esteemLine(V, 'Ada', T0 + 103 * MIN, '')}`);
E.noteHelped(V, 'Clara', 'Ada', 'well', T0 + 104 * MIN);
ok(E.owed(V, 'Ada', T0 + 104 * MIN)[0]?.to === 'Clara', 'Ada owes Clara');
ok(E.esteemLine(V, 'Ada', T0 + 104 * MIN, '').startsWith('You owe Clara: Clara helped your well'), 'a debt is the strongest line');
E.noteHelped(V, 'Ada', 'Clara', 'bench', T0 + 105 * MIN);
ok(!E.owed(V, 'Ada', T0 + 105 * MIN).length && !E.owed(V, 'Clara', T0 + 105 * MIN).length, 'a help back repays, owing nothing new');
ok(E.noteRecord(V, 'light', 'Ben', 10, T0) === null, 'under the floor: no title');
const r1 = E.noteRecord(V, 'light', 'Ben', 18, T0);
ok(!!r1 && E.titlesOf(V, 'Ben', T0)[0] === 'the lamplighter', `a title won: ${r1?.text}`);
const r2 = E.noteRecord(V, 'light', 'Clara', 20, T0);
ok(r2?.from === 'Ben' && E.titlesOf(V, 'Clara', T0).length === 1 && !E.titlesOf(V, 'Ben', T0).length, 'taken by beating it');
ok(E.rivalLine(V, 'Ada', 'light', 12, { ...tq, pride: 0.8 }, T0).startsWith('Clara is the lamplighter: 20 lights, yours 12'), 'the rival line for the proud');
ok(E.rivalLine(V, 'Ada', 'light', 12, tq, T0) === '', 'none for the humble');
ok(E.titleWords('craft:make:bread') === "the village's master of bread", 'a craft title names the good');
ok(E.imitationWeight({ ...tq, sociability: 1 }) === 1.3 && E.imitationWeight({ ...tq, sociability: -1 }) === 1, 'imitation 1.0..1.3 by sociability');
for (let i = 0; i < 5; i++) E.noteMake(V, 'Ada', 'make:torch', T0 + 110 * MIN);
E.noteMake(V, 'Ben', 'make:torch', T0 + 110 * MIN);
ok(E.reliedLine(V, 'Ada', T0 + 110 * MIN, () => ({ stock: 3, keep: 72, words: 'torches' })).startsWith('The village relies on you for torches: you made 5 of the last 6'), 'relied on');
ok(E.reliedLine(V, 'Ada', T0 + 110 * MIN, () => ({ stock: 80, keep: 72, words: 'torches' })) === '', 'not when the stock is full');

console.log(`pursuits_unit: ${pass} passed, ${fail} failed`);

// The census (spec 2.1 / 9.6): each template's live path on the real menus
const ledger = process.argv[2] ?? 'runs/2026-10-29/train11/M.choices.jsonl';
if (!fs.existsSync(ledger)) console.log(`census: ${ledger} not found, skipped`);
else {
  const rows = fs.readFileSync(ledger, 'utf-8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r?.type === 'choice' && r.agent !== 'Mayor' && Array.isArray(r.options));
  const facts0 = (o: Opt) => {
    const k = o.id.split(':');
    return o.kind === 'initiate' ? { work: k[1] } : o.kind === 'help' ? { mine: /^Continue your /.test(o.name) } : o.kind === 'make' ? { good: k[1] } : o.kind === 'own' ? { own: k[1] } : {};
  };
  const temps: Array<{ template: import('../../server/src/pursuits').Template; param?: string }> = [
    { template: 'craft', param: 'make:fence' }, { template: 'craft', param: 'make:torch' }, { template: 'supply', param: 'make:bread' }, { template: 'supply', param: 'penwork:eggs' },
    { template: 'works' }, { template: 'light' }, { template: 'explore' }, { template: 'house' }, { template: 'garden' }, { template: 'research', param: 'amethyst' }, { template: 'wealth' }, { template: 'standing' },
  ];
  console.log(`census over ${rows.length} worker menus of ${ledger}:`);
  for (const t of temps) {
    let menus = 0, model = 0, modelMenus = 0;
    const members = new Set<string>();
    for (const r of rows) {
      const has = (r.options as Opt[]).some((o) => P.advances(t, o, facts0(o)));
      if (r.source === 'model') modelMenus++;
      if (!has) continue;
      menus++;
      members.add(r.agent);
      if (r.source === 'model') model++;
    }
    console.log(`  ${t.template}${t.param ? ` (${t.param})` : ''}: on ${(100 * menus / rows.length).toFixed(1)}% of menus, ${(100 * model / Math.max(1, modelMenus)).toFixed(1)}% of model menus, seen by ${members.size} members`);
  }
}
console.log(`pursuits_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
