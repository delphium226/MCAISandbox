/**
 * #115: run profiles (server/src/profiles.ts): every profiles/*.json passes its check; known faults are caught (an unknown
 * setting, a wrong flag value or number, a value outside its list, a bad MC_REASONING kind, a flag on without what it
 * requires, a start-only setting in a schedule, a watch run without an objective, too many members); a model-driven
 * profile's speed-ups are warnings; effective settings fill every registry entry.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/profiles_check.mts
 */
const { checkProfile, checkSettings, effectiveSettings, listProfiles, loadProfile } = await import('../../server/src/profiles');
const { SETTINGS } = await import('../../server/src/settings');
let fails = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};

const all = listProfiles(process.cwd()).filter((p) => !/[\\/]local[\\/]/.test(p.file));
ok(all.length >= 4, `${all.length} committed profiles`);
for (const { name, file } of all) {
  const c = checkProfile(loadProfile(file, process.cwd()));
  ok(!c.errors.length, `${name}: ${c.errors.join('; ') || 'no errors'}`);
}
const base = { name: 't', describe: 't', kind: 'staged' as const };
const errs = (p: object) => checkProfile({ ...base, ...p } as never).errors.join(' | ');
ok(/unknown setting MC_NOPE/.test(errs({ settings: { MC_NOPE: 'on' } })), 'an unknown setting');
ok(/a flag takes on or off/.test(errs({ settings: { MC_LADDER: 'maybe' } })), 'a wrong flag value');
ok(/not a number/.test(errs({ settings: { MC_TIME_SCALE: 'fast' } })), 'a wrong number');
ok(/takes fixed, model, scripted/.test(errs({ settings: { MC_CHOOSE: 'smart' } })), 'a value outside its list');
ok(/MC_REASONING/.test(errs({ settings: { MC_REASONING: 'choice=low' } })), 'a bad reasoning kind');
ok(!errs({ settings: { MC_REASONING: 'exec=low,choose=high', MC_LADDER: true, MC_TIME_SCALE: 2 } }), 'good values (booleans and numbers too)');
ok(/MC_ORE_MINE is on but MC_IRON_AGE/.test(errs({ settings: { MC_ORE_MINE: 'on' } })), 'a flag without what it requires');
ok(!errs({ settings: { MC_ORE_MINE: 'on', MC_IRON_AGE: 'on' } }), 'and with it');
ok(/MC_STORAGE_CAP is on|MC_STORAGE_GROW/.test(errs({ settings: { MC_STORAGE_CAP: 'cobblestone:512' } })) === false, 'a non-flag with a default-on requirement passes');
ok(/start-only/.test(errs({ schedule: [{ at_min: 5, set: { MC_LADDER: 'on' } }] })), 'a start-only setting in a schedule');
ok(/needs an "objective"/.test(errs({ kind: 'model', preset: 'watch' })), 'a watch run without an objective');
ok(/workers/.test(errs({ workers: 30 })), 'too many members');
ok(/unknown key "foo"/.test(errs({ foo: 1 })), 'an unknown key');
ok(/under "settings"/.test(errs({ server_env: {} })), 'server_env refused');
ok(/both set/.test(errs({ settings: { MC_CHARACTER_PRESET: 'wealth', MC_CHARACTER_MIX: 'wealth:100' } })), 'a preset and a mix together');
ok(/greed/.test(errs({ settings: { MC_CHARACTER_MIX: 'greed:50,wealth:50' } })), 'a mix naming an unknown archetype');
ok(!errs({ settings: { MC_CHARACTER_MIX: 'farmer:50,wealth:50' }, archetypes: { farmer: { hex: { H: 0, E: 0, X: 0, A: 0, C: 0.5, O: 0 }, values: { openness: 0.2, conservation: 0.8, enhancement: 0.3, transcendence: 0.4 }, goal: 'home' } } }), "a mix naming the profile's own archetype");
ok(/MC_SKILL/.test(errs({ settings: { MC_CHARACTER: 'on', MC_GOALS: 'on' } })), 'MC_CHARACTER without MC_SKILL');
const w = checkSettings({ MC_TIME_SCALE: '2', MC_HASTE: '5' }, 'model').warnings;
ok(w.length === 2 && !checkSettings({ MC_TIME_SCALE: '2', MC_HASTE: '5' }, 'staged').warnings.length, `speed-ups warned in model runs only (${w.length})`);
const eff = effectiveSettings({ MC_LADDER: 'on' });
ok(Object.keys(eff).length === SETTINGS.length && eff.MC_LADDER === 'on' && eff.MC_STORAGE_GROW === 'on' && eff.MC_LETTERS_PACE === 'off', 'effective settings: given over defaults, every entry');
console.log(fails ? `profiles_check: ${fails} of ${checks} failed` : `profiles_check: all ${checks} passed`);
process.exit(fails ? 1 : 0);
