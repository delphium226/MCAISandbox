/**
 * Character v2 (character.ts), offline: HEXACO vectors fixed per name and spread over the strata, values half from traits
 * with self-enhancement dominant capped, goals from values and their shares, every line's size, the factor's clamp and
 * the cap and floor, a thought's decay and trait shifts, energy's fall and rest, affinity from facts and its decay, the
 * series' bounds and their save and load, the views' shapes and sizes at 25.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/character_unit.mts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'character-unit-'));
process.env.MCAI_ACTS_LOG = path.join(dir, 'acts.jsonl');
process.env.MC_DAY_MIN = '20';
const ch = await import('../../server/src/character');
const { workerName } = await import('../../server/src/agentNames');

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL ${what}`);
  }
};
const NAMES = ['Mayor', ...Array.from({ length: 24 }, (_, i) => workerName(i + 1))];
const W = NAMES.slice(1);

// Layer 1
ok(JSON.stringify(ch.hexacoOf('Ada')) === JSON.stringify(ch.hexacoOf('ada')), 'a vector fixed per name');
for (const t of ch.HEXACO) {
  const vals = W.map((n) => ch.hexacoOf(n)[t]).sort((a, b) => a - b);
  const strata = new Set(vals.map((x) => Math.min(23, Math.floor(((x + 1) / 2) * 24))));
  ok(strata.size >= 22 && vals[0] < -0.8 && vals[23] > 0.8, `${t} spread over the strata (${strata.size})`);
}
const hw = ch.hexacoWeights('Ada', ['explore', 'gather', 'pen', 'help', 'make', 'light']);
ok(Math.max(...Object.values(hw)) <= 2.5 && Math.min(...Object.values(hw)) >= 0.4 && hw.eat === 1, `kind weights 0.4..2.5 (${JSON.stringify(hw)})`);
const tw = ch.temperamentWords('Ada');
ok(tw.length > 5 && tw.length < 60, `temperament words (${tw})`);

// Layer 2
const vals = NAMES.map((n) => ch.valuesOf(n));
ok(vals.every((v) => ch.VALUES.every((k) => v[k] >= 0 && v[k] <= 1)), 'values 0..1');
const dom = vals.map((v) => [...ch.VALUES].sort((a, b) => v[b] - v[a])[0]);
ok(dom.filter((d) => d === 'enhancement').length <= Math.floor(0.25 * NAMES.length), `self-enhancement dominant capped (${dom.filter((d) => d === 'enhancement').length})`);
const goals = new Map<string, number>();
for (const n of NAMES) goals.set(ch.goalFromValues(n), (goals.get(ch.goalFromValues(n)) ?? 0) + 1);
ok(goals.size >= 4, `goals from values spread (${JSON.stringify(Object.fromEntries(goals))})`);
ok(/^You value .+ most, .+ least\.$/.test(ch.valuesLine('Ben')), `values line (${ch.valuesLine('Ben')})`);

// Lines and their budget
ch.setCharacterSettings({ hexaco: true, values: true, gauges: true, mood: true, affinity: true, identity: true });
const V = 'Testvale';
const T0 = 2_000_000_000_000;
const MIN = 60000;
ch.initCharacter(dir);
ch.characterRunBegin(V, T0);
const id = ch.identityLine('Ada', { goal: 'beauty', house: 'the cottage at -1650,58' });
ok(id.startsWith('You are Ada, ') && id.includes('life goal is beauty') && !id.includes("village's"), `identity without a role by default (${id})`);
ok(ch.identityLine('Ada', { goal: 'beauty', role: 'lamplighter', achievements: ['32 lights'] }).includes("the village's lamplighter (32 lights)"), 'role only when given');
ch.think(V, 'Ada', 'kept', 'Ben kept a promise to you', T0);
ch.think(V, 'Ada', 'built', 'your well was built', T0);
ch.noteWork(V, 'Ada', 14);
const lines = [id, ch.valuesLine('Ada'), ch.needsLine(V, 'Ada'), ch.moodLine(V, 'Ada', T0 + MIN)].filter(Boolean);
const chars = lines.join(' ').length;
ok(chars <= 420, `the lines together ~100 tokens (${chars} chars: ${lines.join(' | ')})`);

// The factor, cap and floor
ok(ch.characterFactor({ mw: 1.3, fw: 1.4, dw: 1.2 }) === 1.5 && ch.characterFactor({ mw: 0.5, fw: 0.9 }) === 0.67 && ch.characterFactor({}) === 1, 'the factor clamped 0.67..1.5');
ok(ch.capFloor(9) === 6.25 && ch.capFloor(0.05) === 0.16 && ch.capFloor(2) === 2, 'cap and floor');

// Mood
ok(ch.moodWeight(V, 'Ada', 'initiate', T0 + MIN) > 1 && ch.moodWeight(V, 'Ada', 'make', T0 + MIN) === 1, 'good mood weighs own projects only');
const m0 = ch.moodOf(V, 'Ada', T0 + MIN);
const m1 = ch.moodOf(V, 'Ada', T0 + 10 * MIN);
const m2 = ch.moodOf(V, 'Ada', T0 + 3 * 20 * MIN);
ok(m0 > m1 && m1 > 0 && m2 === 0, `thoughts decay (${m0} > ${m1} > ${m2})`);
const hiE = W.reduce((b, n) => (ch.hexacoOf(n).E > ch.hexacoOf(b).E ? n : b), W[0]);
const loE = W.reduce((b, n) => (ch.hexacoOf(n).E < ch.hexacoOf(b).E ? n : b), W[0]);
ch.think(V, hiE, 'failed', 'a chore failed', T0);
ch.think(V, loE, 'failed', 'a chore failed', T0);
ok(ch.moodOf(V, hiE, T0) < ch.moodOf(V, loE, T0), 'emotionality scales a negative thought');

// Energy
const e1 = ch.energyOf(V, 'Ada');
ok(e1 < 1 && ch.restWeight(V, 'Ada') === null === (e1 >= 0.6), `energy fell (${e1})`);
ch.noteWork(V, 'Ada', 30);
ok(ch.restWeight(V, 'Ada')! >= 1 && ch.needsLine(V, 'Ada').includes('tired'), `tired: a rest weighed (${ch.energyOf(V, 'Ada')}, ${ch.restWeight(V, 'Ada')})`);
ch.noteRest(V, 'Ada', T0 + 20 * MIN);
ok(ch.energyOf(V, 'Ada') >= 0.6, 'a rest restores energy');

// Affinity
ch.noteFact(V, 'Ada', 'Ben', 'kept');
ch.noteFact(V, 'Ada', 'Ben', 'helpedBy');
ch.noteFact(V, 'Ada', 'Clara', 'broke');
ch.noteFact(V, 'Ada', 'Clara', 'refused');
ok(ch.affinityOf(V, 'Ada', 'Ben') === 3 && ch.affinityOf(V, 'Ada', 'Clara') === -4, 'affinity from facts');
ok(ch.affinityWord(3) === 'friend' && ch.affinityWord(-4) === 'wary of', 'its word');
ok(ch.helpWeight(V, 'Ada', 'Ben') > 1 && ch.helpWeight(V, 'Ada', 'Clara') === 1, 'help weighed for a friend only');
const rw = ch.requestWeight(V, 'Ada', 'Clara'), rb = ch.requestWeight(V, 'Ada', 'Ben');
ok(rw < rb && rb >= 0.8 && rb <= 1.25, `a request from one it is wary of weighs less (${rw} < ${rb})`);
ch.decayAffinity(V, T0 + 2 * 20 * MIN);
ok(Math.abs(ch.affinityOf(V, 'Ada', 'Ben')) < 3, 'affinity decays a village day');

// Series, views, save and load
for (let i = 0; i < 400; i++) ch.sample(V, NAMES.map((name) => ({ name, appetite: 15 })), T0 + i * MIN);
const mv = ch.memberView(V, 'Ada', 0, T0 + 400 * MIN);
ok(mv.series.length === ch.SERIES_POINTS && mv.series[0].length === 6, `the series bounded (${mv.series.length})`);
const vv = ch.villageView(V, NAMES, { Ada: 'beauty' }, T0 + 400 * MIN);
const size = JSON.stringify(vv).length;
ok(vv.members.length === 25 && size < 15000, `the village view at 25 (${size} bytes)`);
const sv = ch.seriesView(V, T0 + 300 * MIN, true);
ok(sv.points.length > 50 && Array.isArray(sv.matrix) && sv.matrix.length <= ch.MATRIX_POINTS, `the series view (${sv.points.length} points, ${sv.matrix?.length} matrices)`);
const json = ch.serialiseCharacter();
ch.loadCharacter(json);
ok(ch.memberView(V, 'Ada', 0, T0 + 400 * MIN).series.length === ch.SERIES_POINTS && ch.affinityOf(V, 'Ada', 'Clara') < 0, 'save and load');
ok(json.length < 1_500_000, `the store's size (${json.length})`);
ch.characterRunBegin(V, T0 + 500 * MIN);
ok(ch.memberView(V, 'Ada', 0, T0 + 500 * MIN).series.length === 0, 'a run begun clears it');

console.log(`character_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
