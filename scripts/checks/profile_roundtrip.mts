/**
 * The start screen's profile round trip (spec runs/2026-10-30/startscreen/spec.md 9.1): every profile (profiles/ and
 * profiles/local/) made into the screen's state and back with the page's own functions (server/startscreen/state.mjs)
 * equals its file, key for key; an edit and its undo give the file again; typed goals survive the trip, a changed goal
 * text loses its mapping, and the goals table shows the village text for members without their own.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/profile_roundtrip.mts
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const St = await import('../../server/startscreen/state.mjs');
const { listProfiles } = await import('../../server/src/profiles');
const { workerName } = await import('../../server/src/agentNames');

let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

for (const { name, file } of listProfiles(ROOT)) {
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  const back = St.fromState(St.toState(p));
  ok(same(back, p), `${name}: round trip (${path.relative(ROOT, file)})\n  file ${JSON.stringify(p).slice(0, 300)}\n  back ${JSON.stringify(back).slice(0, 300)}`);
  const s = St.toState(p);
  s.settings.MC_TEMPERATURE = '0.9';
  ok(!same(St.fromState(s), p), `${name}: an edit shows`);
  delete s.settings.MC_TEMPERATURE;
  if (p.settings && 'MC_TEMPERATURE' in p.settings) s.settings.MC_TEMPERATURE = String(p.settings.MC_TEMPERATURE);
  ok(same(St.fromState(s), p), `${name}: the edit undone gives the file`);
}

// Goals through the screen's state
const names = ['Mayor', ...Array.from({ length: 24 }, (_, i) => workerName(i + 1))];
const typed = {
  name: 'goals-rt', describe: 'x', kind: 'model', preset: 'watch', workers: 3, objective: 'o', settings: { MC_OWN: true, MC_GOALS: 'on' }, goal_mode: 'village',
  goals: { village: { text: 'explore the far lands', by: 'user', measure: null, pursuits: ['explore'], unmatched: [], mappedBy: 'model' }, members: { Ada: { text: 'grow rich from the far lands', by: 'take', measure: 'wealth', pursuits: ['wealth', 'explore'], unmatched: [], mappedBy: 'model' } } },
};
ok(same(St.fromState(St.toState(typed)), typed), 'typed goals: round trip (with a boolean setting kept a boolean)');
{
  const s = St.toState(typed);
  const rows = St.goalRows(s, names);
  ok(rows.length === 4 && rows[0].text === 'explore the far lands' && rows[0].by === 'village' && rows[1].by === 'take' && rows[1].measure === 'wealth', `goal rows: ${rows.map((r) => `${r.name} ${r.by} ${r.measure}`).join(', ')}`);
  ok(St.unmappedTexts(s).length === 0, 'every text mapped');
  St.setMemberGoal(s, 'Ben', 'steal from each other');
  St.setVillageGoal(s, 'explore the far lands and get rich');
  ok(same(St.unmappedTexts(s).sort(), ['explore the far lands and get rich', 'steal from each other']), `changed texts unmapped: ${St.unmappedTexts(s)}`);
  St.applyMapping(s, { 'steal from each other': { spec: { measure: null, pursuits: [], unmatched: ['steal from each other'], model: 'm' } } });
  ok(s.goals.members.Ben.mappedBy === 'model' && s.goals.members.Ben.unmatched[0] === 'steal from each other', 'a mapping applied by text');
  St.setMemberGoal(s, 'Ben', '');
  ok(!s.goals.members.Ben, 'a blank member goal is the village\'s (or drawn)');
  ok(St.goalRows(s, names)[2].by === 'village', 'Ben shows the village goal');
}
// A drawn profile gains no goal keys
{
  const p = { name: 'd', describe: 'x', kind: 'staged', settings: {} };
  const s = St.toState(p);
  ok(same(St.fromState(s), p), 'drawn: no goal keys added');
  s.goal_mode = 'member';
  St.setMemberGoal(s, 'Mayor', 'get rich');
  const out = St.fromState(s) as Record<string, unknown>;
  ok(out.goal_mode === 'member' && (out.goals as { members: Record<string, unknown> }).members.Mayor !== undefined, 'member mode saved with its goals');
}
// The settings view
{
  const reg = { settings: [{ name: 'MC_A', type: 'flag', default: 'off', group: 'x', live: true, describe: 'a', requires: ['MC_B'] }, { name: 'MC_B', type: 'flag', default: 'on', group: 'x', live: false, describe: 'b' }], groups: ['x'] };
  const s = St.toState({ name: 'v', describe: 'x', kind: 'staged', settings: { MC_A: 'on' } });
  ok(St.settingRows(reg, s, 'changed').map((r: { name: string }) => r.name).join() === 'MC_A', 'changed view');
  ok(St.settingRows(reg, s, 'all').length === 2 && St.settingRows(reg, s, 'live').length === 1, 'all and live views');
  ok(St.settingRows(reg, s, 'all').find((r: { name: string }) => r.name === 'MC_B').requiredBy[0] === 'MC_A', 'needed by');
}

console.log(`profile_roundtrip: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
