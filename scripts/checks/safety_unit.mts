/**
 * Survival stage (d)'s safety rules (rules.ts' curfew, spec runs/2026-10-31/survival/spec_d.md 2), offline: the curfew read
 * from members' words (the spec's three and train sentences that must stay other rules), its band (32-128 blocks, dusk or
 * nightfall), code's words, its target (a second proposal joins), enacted into curfewBand, the ballot's stake from the danger
 * facts and the results line's last night, the scripted laws' curfew, and by mode (a child process each, the settings are
 * read at import): read only with monsters and MC_SAFETY_RULES on; peaceful reads the same words as before.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/safety_unit.mts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SENTENCES = ['No one goes outside after dark.', 'Be home by dusk.', 'No trips at night.', 'Stay within 48 blocks of the village at night.'];

if (process.env.MODE_CHILD) {
  const rules = await import('../../server/src/rules');
  console.log(JSON.stringify({ on: rules.safetyOn(), types: SENTENCES.map((w) => rules.readLaw({ what: w }).type) }));
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-unit-'));
  Object.assign(process.env, { MC_MEMORY: 'on', MC_CLOCK: 'on', MC_DAY_MIN: '20', MC_RULES: 'on', MC_COUNCIL: 'on', MC_CHOOSE: 'scripted', MC_WORLD_MODE: 'hostile', MCAI_ACTS_LOG: path.join(dir, 'acts.jsonl') });
  const mem = await import('../../server/src/memory');
  const rules = await import('../../server/src/rules');
  let fails = 0;
  const ok = (cond: unknown, what: string) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
    if (!cond) fails++;
  };

  // Reading
  const c = SENTENCES.map((w) => rules.readCurfew(w));
  ok(c[0]?.phase === 'night' && c[0].dist === 64, `"no one outside after dark": nightfall, 64 blocks (${JSON.stringify(c[0])})`);
  ok(c[1]?.phase === 'dusk' && c[2]?.phase === 'night', '"be home by dusk" from dusk; "no trips at night" from nightfall');
  ok(c[3]?.dist === 48, 'a distance named is kept');
  ok(rules.readCurfew('Stay within 500 blocks at night')?.dist === 128 && rules.readCurfew('Stay within 5 blocks at night')?.dist === 32, 'the distance held to 32-128');
  ok(rules.readCurfew('A curfew for everyone.')?.phase === 'night', 'the word curfew alone');
  for (const w of ['Each member puts at least 2 torches into storage each day.', 'Each member may take up to 4 logs from storage per day.', 'Each villager must light at least one unlit spot each day.', 'Members must post a claim on the board before digging on the iron level; others wait 10 minutes.'])
    ok(rules.readCurfew(w) === null && rules.readLaw({ what: w }).type !== 'curfew', `not a curfew: "${w.slice(0, 50)}"`);
  ok(rules.readCurfew('Members light torches at night.') === null, 'night words without staying in: none');
  const typed = rules.readLaw({ what: 'x', rule: { type: 'curfew', params: { dist: 40 } } });
  ok(typed.type === 'curfew' && typed.params.dist === 40 && typed.params.phase === 'night', 'typed fields, the phase defaulted');
  // Bands and words
  ok(rules.validate('curfew', { dist: 64, phase: 'night' }) === null && /32 to 128/.test(rules.validate('curfew', { dist: 200, phase: 'night' }) ?? '') && /dusk or from nightfall/.test(rules.validate('curfew', { dist: 64, phase: 'noon' }) ?? ''), 'the bands');
  ok(rules.ruleText('curfew', { dist: 64, phase: 'dusk' }) === 'no member goes more than 64 blocks from home from dusk until dawn', 'code\'s words');
  ok(rules.lawTarget('curfew', { dist: 64, phase: 'night' }) === 'curfew', 'one target');

  // A law, joined, enacted, and its lines
  mem.initMemory(dir);
  const V = 'Safevale', now = Date.now();
  mem.touchMemory();
  rules.setDangerFacts((v) => (v === V ? { fact: '4 of 5 deaths were on trips over 100 blocks out, 4 after dark', lastNight: { out: 2, deaths: 0 } } : null));
  const l1 = rules.addLaw(V, 'Ada', { what: 'No one goes more than 64 blocks from home after dark.' }, now);
  const l2 = rules.addLaw(V, 'Ben', { what: 'No trips at night.' }, now);
  ok(l1.type === 'curfew' && l1.status === 'open' && l2.id === l1.id && l1.backers.includes('Ben'), 'a second curfew joins the first');
  ok(rules.stake(V, 'Ada', 'curfew', l1.params, {}, now) === '4 of 5 deaths were on trips over 100 blocks out, 4 after dark', 'the ballot\'s stake: the deaths\' fact');
  ok(rules.curfewBand(V) === null, 'no band before it passes');
  const r = rules.enact(V, l1, { yes: 5, no: 1, abstain: 0 }, now);
  ok(JSON.stringify(rules.curfewBand(V)) === JSON.stringify({ dist: 64, phase: 'night' }), 'the band in force');
  ok(rules.ruleResult(V, r, now) === '2 members out after dark last night, 0 deaths', 'the results line');
  ok(rules.rulesLine(V).includes('no member goes more than 64 blocks from home from nightfall until dawn'), 'the rules line');
  const again = rules.addLaw(V, 'Cy', { what: 'Be home by dusk.' }, now);
  ok(again.status === 'refused' && /already a village rule/.test(again.refused ?? ''), 'a curfew in force is not put up again');

  // By mode
  const child = (mode: string, extra: Record<string, string> = {}) => JSON.parse(execFileSync(process.execPath, [path.join('node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/checks/safety_unit.mts'], {
    env: { ...process.env, MODE_CHILD: '1', MC_WORLD_MODE: mode, ...extra }, encoding: 'utf-8',
  }).trim().split('\n').pop()!);
  const peace = child('peaceful'), host = child('hostile'), off = child('hostile', { MC_SAFETY_RULES: 'off' }), easy = child('easy');
  ok(!peace.on && !easy.on && host.on && !off.on, 'read only with monsters and the flag on');
  ok(host.types.every((t: string) => t === 'curfew') && !peace.types.includes('curfew') && JSON.stringify(peace.types) === JSON.stringify(off.types), `peaceful and off read the words as before (${peace.types.join(', ')})`);

  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
}
