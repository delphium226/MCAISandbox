/**
 * #117 (MC_PROMPT_SELF) checked offline (spec runs/2026-10-24/prompt-117/spec.md; no server, ~20 s).
 * Part 1, the pure lines (promptSelf.ts) and the chooser with the flag on (choose.ts): the self line for a member with no
 * house, one being built and one standing without a bed; the basic needs in Maslow's order; the scarcity line; the
 * stage's feed kinds; the trim keeping one ambition option on a 12-option menu; the fixed pick taking the street (a
 * house) before the house's basics and after a meal; the prompt rendering the self and scarcity lines and the basic
 * need's tag; the goal's meaning.
 * Part 2, real menus on two checkpoints (menu_ctx_golden.mts' harness, run as a child with the flag on, with MC_LADDER,
 * MC_HOME_BASICS, MC_GOALS and MC_OWN): mv3_base25 (no member has a house) and im2_mine (every member's house lacks a bed
 * and a table). Every member's prompt has its self line; a member without a house is told so first among its needs; a
 * member whose house has no bed sees a bed among its needs and, when its menu offers the basics, the option tagged with
 * it; every prompt either shows an option tagged for the ambition or says why nothing feeds it.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/prompt_self.mts [--no-world]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.MC_PROMPT_SELF = 'on';
process.env.MC_GOALS = 'on';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

let failures = 0, checks = 0;
const say = (s: string) => console.log(s);
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 40) say(`FAIL ${what}`);
  }
};

const P = await import('../../server/src/promptSelf');
const C = await import('../../server/src/choose');
const G = await import('../../server/src/goals');

// ---- part 1: the pure lines and the chooser -------------------------------------------------------------------------
{
  const none = { house: { state: 'none' as const }, carry: {}, emeralds: 0, appetite: 20, bedPossible: true, chestPossible: true };
  ok(P.selfLine(none) === 'You: no house of your own yet; you carry nothing of note; 0 emeralds; appetite 20 of 20.', `self, no house: ${P.selfLine(none)}`);
  ok(P.needsLine(none) === 'Your basic needs first: you have no house yet (then a bed and a chest in it).', `needs, no house: ${P.needsLine(none)}`);
  const building = { ...none, house: { state: 'building' as const }, hungry: true };
  ok(JSON.stringify(P.basicNeeds(building)) === '["food","house"]', 'needs: food before the house');
  ok(/yours is being built/.test(P.selfLine(building)), 'self: a house being built');
  const noBed = { house: { state: 'standing' as const, label: 'the plains small house 1 at 10,20', has: ['a chest'], lacks: ['bed', 'crafting table'] }, carry: { stone_pickaxe: 1, cobblestone: 12, bread: 4, oak_log: 30, dirt: 2, torch: 3, wheat: 1 }, bedPossible: true, chestPossible: true };
  const line = P.selfLine(noBed);
  ok(line.startsWith('You: your house (the plains small house 1 at 10,20) has a chest, no bed and no crafting table; you carry a stone pickaxe, 30 oak log, 12 cobblestone, 4 bread, 3 torch, 2 dirt.'), `self, no bed: ${line}`);
  ok(!/emerald|appetite/.test(line), 'self: emeralds and appetite only where the world keeps them');
  ok(JSON.stringify(P.basicNeeds(noBed)) === '["bed"]', `needs, no bed: ${JSON.stringify(P.basicNeeds(noBed))}`);
  ok(P.needsLine(noBed) === 'Your basic needs first: your house has no bed.', `needs line, no bed: ${P.needsLine(noBed)}`);
  ok(!P.basicNeeds({ ...noBed, bedPossible: false }).length, 'needs: no bed need where no bed can be made');
  ok(!P.needsLine({ ...noBed, house: { ...noBed.house, lacks: [] } }), 'needs: none when all are met');
  const sc = P.scarcityLine([{ item: 'cobblestone', stored: 12, wanted: 211 }, { item: 'sand', stored: 0, wanted: 25 }, { item: 'logs', stored: 40, wanted: 20 }], ['barrels', 'ladders']);
  ok(sc === 'Short: cobblestone (12 stored, the workshop wants 211), sand (0 stored, the workshop wants 25). Made for later, nothing uses them now: barrels, ladders.', `scarcity: ${sc}`);
  ok(P.scarcityLine([], []) === '', 'scarcity: empty');
  ok(P.UNUSED_GOOD.test('a storage block for the works plot; nothing places it yet') && P.UNUSED_GOOD.test('ladders for the deep mine (later)') && !P.UNUSED_GOOD.test('light for the mine and the houses later; the street lamps are lit already'), 'unused goods: barrels and ladders, not torches');
  ok(JSON.stringify(P.feedKinds(/^iron:dig\b/)) === '["iron"]', `feed kinds, iron: ${JSON.stringify(P.feedKinds(/^iron:dig\b/))}`);
  ok(JSON.stringify(P.feedKinds(/^(start:sugar_cane|slot:sugar_cane|activity:lib:buy:sugar_cane)$/)) === '["start","slot","activity"]', 'feed kinds, cane');
  ok(JSON.stringify(P.feedKinds(/^(make:bookshelf|make:lectern|shelve(:.*)?)$/)) === '["make","shelve"]', `feed kinds, library: ${JSON.stringify(P.feedKinds(/^(make:bookshelf|make:lectern|shelve(:.*)?)$/))}`);

  const opt = (id: string, kind: string, rank: number, extra: Any = {}) => ({ id, kind, key: id, name: `Do ${id}`, rank, facts: 'f', effect: 'e', holds: [], excludes: [], ...extra });
  const fillers = Array.from({ length: 12 }, (_, i) => opt(`make:${i}`, `k${i % 6}`, 600 + i, { tw: 1.4, lp: 1.5 }));
  const dig = opt('iron:dig', 'iron', 700, { tw: 0.5, lp: 0.6, vw: 1.3, ladderTag: '[for the iron age]' });
  ok(C.trimMenu([...fillers, dig] as Any).some((o: Any) => o.id === 'iron:dig'), 'trim: the ambition option kept');
  ok(C.trimMenu([...fillers, dig] as Any).length <= C.MENU_MAX, 'trim: the menu within its limit');
  const street = opt('grow:street', 'grow', 1, { basic: true, basicNeed: 'a house' });
  const basics = opt('own:basics', 'own', 5, { basic: true, basicNeed: 'a bed' });
  const menu = (options: Any[], ctx: Any = {}) => ({ agent: 'Ada', village: 'V', t: 0, options, guarded: [], reasons: {}, ctx: { persona: '', village: 'V, complete', others: '', outcomes: [], ...ctx } }) as Any;
  ok(C.fixedPick(menu([...fillers, basics, street]))?.id === 'grow:street', 'fixed pick: the house before its basics');
  ok(C.fixedPick(menu([...fillers, basics, street, opt('eat', 'eat', 0)]))?.id === 'eat', 'fixed pick: a meal first');
  const m = menu([fillers[0], fillers[1], basics, dig], { self: 'You: your house (x) has a chest, no bed. Your basic needs first: your house has no bed.', scarcity: 'Short: sand (0 stored, the workshop wants 25).', goal: 'Your life goal: standing (0 helps).' });
  const u = C.buildPrompt(m, m.options).user;
  ok(/\nYou: your house \(x\) has a chest, no bed\. Your basic needs first: your house has no bed\.\n/.test(`\n${u}`), 'prompt: the self line');
  ok(/\nShort: sand \(0 stored, the workshop wants 25\)\.\n/.test(u), 'prompt: the scarcity line');
  ok(/- Do own:basics: f \(expected: e\) \[your basic need: a bed\]/.test(u), 'prompt: the basic need\'s tag');
  ok(!/a basic need: your own house/.test(u), 'prompt: the old tag gone where the need is named');
  ok(u.indexOf('You: your house') < u.indexOf('Village:'), 'prompt: the self line before the village');
  // (the goal's meaning: goalLine with meaning on a village whose goals are drawn)
  const v: Any = { name: 'V', initiatives: [], homes: {}, layouts: [], goals: { of: { Ada: 'standing' }, drawnFor: 1, at: 0, stats: {} } };
  ok(G.goalLine(v, 'Ada', true) === `Your life goal: standing (0 helps on others' projects; 0 public works of yours stand). Your goal: ${G.GOAL_MEANING.standing}`, `goal meaning: ${G.goalLine(v, 'Ada', true)}`);
  ok(G.goalLine(v, 'Ada') === "Your life goal: standing (0 helps on others' projects; 0 public works of yours stand).", 'goal line unchanged without meaning');
  for (const g of G.GOALS) ok(G.GOAL_MEANING[g] && G.GOAL_MEANING[g].length < 260, `goal meaning for ${g}`);
}

// ---- part 2: real menus on two checkpoints --------------------------------------------------------------------------
if (!process.argv.includes('--no-world')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-self-'));
  const run = (cp: string) => {
    const out = path.join(tmp, `${cp}.json`);
    if (!fs.existsSync(`mc/testcheckpoints/${cp}/villages.json`)) {
      say(`  ${cp}: not here, skipped`);
      return null;
    }
    execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/checks/menu_ctx_golden.mts', 'dump', out, `mc/testcheckpoints/${cp}`], {
      env: { ...process.env, MC_PROMPT_SELF: 'on', MC_LADDER: 'on', MC_HOME_BASICS: 'on', MC_GOALS: 'on', MC_OWN: 'on', MC_NEEDS: 'on' }, stdio: 'pipe',
    });
    return JSON.parse(fs.readFileSync(out, 'utf8')) as Record<string, Any>;
  };
  for (const cp of ['mv3_base25', 'im2_mine']) {
    const d = run(cp);
    if (!d) continue;
    let members = 0, noHouse = 0, noBed = 0, bedTagged = 0, bedOffered = 0, ambTag = 0, ambGap = 0, goalMeant = 0, scarce = 0;
    for (const [k, m] of Object.entries(d)) {
      if (!m?.user || !k.startsWith('1|')) continue;
      members++;
      const u: string = m.user;
      ok(/^You: /m.test(u), `${cp} ${k}: no self line`);
      if (/^You: no house of your own yet/m.test(u)) {
        noHouse++;
        ok(/Your basic needs first: (you are hungry; )?you have no house yet/.test(u), `${cp} ${k}: no house, not named first among its needs`);
        const st = m.options.find((o: Any) => o.id === 'grow:street');
        if (st) ok(u.includes(`${st.name}:`) && /\[your basic need: a house\]/.test(u), `${cp} ${k}: the street not tagged as its need`);
      }
      if (/^You: your house .*no bed/m.test(u)) {
        noBed++;
        ok(/Your basic needs first: (you are hungry; )?your house has no bed/.test(u), `${cp} ${k}: no bed, not among its needs`);
        const b = m.options.find((o: Any) => o.id === 'own:basics' || o.id === 'own:shear');
        if (b) {
          bedOffered++;
          if (/\[your basic need: a bed\]/.test(u)) bedTagged++;
        } else ok(m.reasons?.own, `${cp} ${k}: no bed, no basics option and no reason`);
      }
      if (/\[for the [a-z ]+\]/.test(u)) ambTag++;
      else if (/Nothing on your menu feeds it now/.test(u)) ambGap++;
      // (a stage with no work built yet says so in its own line: letters without MC_LETTERS)
      else ok(!/The village's ambition: .*stage/.test(u) || /this stage's work is not built yet/.test(u), `${cp} ${k}: an ambition with neither an option for it nor why not`);
      if (/Your goal: \w+ is /.test(u)) goalMeant++;
      if (/^(Short: |Made for later)/m.test(u)) scarce++;
    }
    ok(members >= 20, `${cp}: only ${members} menus`);
    ok(bedTagged === bedOffered, `${cp}: ${bedOffered - bedTagged} basics options without the bed's tag`);
    say(`  ${cp}: ${members} members; no house ${noHouse}; house without a bed ${noBed} (the basics offered ${bedOffered}, tagged ${bedTagged}); ambition tagged ${ambTag}, why-not ${ambGap}; goal meaning ${goalMeant}; scarcity ${scarce}`);
  }
}

say(`${failures ? 'FAIL' : 'PASS'}: ${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
