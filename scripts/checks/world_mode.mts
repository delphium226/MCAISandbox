// MC_WORLD_MODE (worldMode.ts, survival stage (a)): the mode table (peaceful as before, damage turns on falls, drowning and
// fire and nothing else, every mode sets the same rules and keeps keep_inventory), the setting's parsing, the death
// messages' causes (mcHazard.ts), and the prompts by mode: the primer's harm line and memory's note check. The prompt
// cases run in a child process per mode (the settings are read once at import).
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/world_mode.mts
import { execFileSync } from 'node:child_process';

if (process.env.MODE_CHILD) {
  const { PRIMER } = await import('../../server/src/choose');
  const { checkNote } = await import('../../server/src/memory');
  const { worldMode } = await import('../../server/src/worldMode');
  console.log(JSON.stringify({
    mode: worldMode(), primer: PRIMER.slice(0, 200),
    hurt: checkNote('Nowhere', 'Ada', 'I fell and got hurt near the lake'), mobs: checkNote('Nowhere', 'Ada', 'zombies came at night'),
  }));
} else {
  const { MODES, WORLD_MODES, parseMode } = await import('../../server/src/worldMode');
  const { deathCauseOf, causeFromState } = await import('../../server/src/mineflayer/mcHazard');
  let fails = 0;
  const ok = (c: boolean, what: string) => {
    if (!c) fails++;
    console.log(`${c ? 'ok  ' : 'FAIL'} ${what}`);
  };
  // The table
  const OLD: Record<string, string> = { fall_damage: 'false', drowning_damage: 'false', fire_damage: 'false', freeze_damage: 'false', keep_inventory: 'true',
    spawn_monsters: 'false', spawn_phantoms: 'false', spawn_patrols: 'false', spawn_wardens: 'false', fire_spread_radius_around_player: '0', advance_time: 'false' };
  const p = MODES.peaceful, d = MODES.damage;
  ok(p.difficulty === 'peaceful' && !p.damage && !p.mobs && Object.entries(OLD).every(([k, v]) => p.rules[k] === v) && p.rules.mob_griefing === 'true'
    && Object.keys(p.rules).length === 12, 'peaceful: the 11 rules as before, plus mob_griefing at vanilla\'s true');
  ok(p.summary.startsWith('peaceful, no damage, keep_inventory, always day'), 'peaceful: the status line as before (the scripts\' and the hook\'s)');
  const changed = Object.keys(d.rules).filter((k) => d.rules[k] !== p.rules[k]).sort();
  ok(d.difficulty === 'peaceful' && d.damage && !d.mobs && changed.join() === 'drowning_damage,fall_damage,fire_damage'
    && changed.every((k) => d.rules[k] === 'true'), `damage: peaceful with exactly falls, drowning and fire on (${changed.join(', ')})`);
  ok(d.rules.advance_time === 'false' && d.rules.freeze_damage === 'false', 'damage: always day, no freezing');
  const keys = Object.keys(p.rules).sort().join();
  ok(WORLD_MODES.every((m) => Object.keys(MODES[m].rules).sort().join() === keys), 'every mode sets the same rules (a switch back leaves nothing behind)');
  ok(WORLD_MODES.every((m) => MODES[m].rules.keep_inventory === 'true' && MODES[m].rules.spawn_phantoms === 'false' && MODES[m].rules.spawn_patrols === 'false'),
    'keep_inventory on, phantoms and patrols off in every mode (the user\'s 10-30)');
  ok(MODES.easy.difficulty === 'easy' && MODES.easy.rules.spawn_monsters === 'false' && MODES.easy.rules.advance_time === 'true', 'easy: stage (b): no monsters, day and night');
  ok(MODES.normal.mobs && MODES.normal.rules.spawn_monsters === 'true' && MODES.normal.rules.mob_griefing === 'false', 'normal: monsters, mob griefing off');
  // The setting
  ok(parseMode(undefined) === 'peaceful' && parseMode('') === 'peaceful' && parseMode(' Damage ') === 'damage' && parseMode('hard') === null, 'parseMode: unset is peaceful, case aside, unknown null');
  // Death causes
  const cases: Array<[string, string | null]> = [
    ['Ada fell from a high place', 'fall'], ['Ada hit the ground too hard', 'fall'], ['Ada drowned', 'drowning'],
    ['Ada tried to swim in lava', 'lava'], ['Ada burned to death', 'fire'], ['Ada went up in flames', 'fire'],
    ['Ada walked into the danger zone due to Magma Block', 'fire'], ['Ada suffocated in a wall', 'suffocation'],
    ['Ada was slain by Zombie', 'mob'], ['Ada was pricked to death', 'other'], ['<Ada> I drowned in work today', null],
    ['Adam drowned', null], ['Ben drowned', null],
  ];
  for (const [line, want] of cases) ok(deathCauseOf('Ada', line) === want, `death message "${line}" -> ${want}`);
  ok(causeFromState({ hazard: 'air', fell: 0 }) === 'drowning' && causeFromState({ hazard: null, fell: 9 }) === 'fall'
    && causeFromState({ hazard: 'lava', fell: 0 }) === 'lava' && causeFromState(null) === 'other', 'causeFromState: the guesses');
  // The prompts, per mode
  const run = (mode: string) => JSON.parse(execFileSync(process.execPath, [...process.execArgv, process.argv[1]],
    { env: { ...process.env, MC_WORLD_MODE: mode, MODE_CHILD: '1' }, encoding: 'utf-8' }).trim().split('\n').pop()!);
  const pc = run(''), dc = run('damage');
  ok(pc.mode === 'peaceful' && pc.primer.includes('no monsters and no harm; nobody dies.'), 'peaceful: the primer says nobody dies');
  ok(!!pc.hurt && !!pc.mobs, `peaceful: notes of hurt (${pc.hurt}) and mobs (${pc.mobs}) refused`);
  ok(dc.mode === 'damage' && !dc.primer.includes('nobody dies') && /falls, deep water, fire and lava hurt/.test(dc.primer), 'damage: the primer says what hurts');
  ok(dc.hurt === null && !!dc.mobs, `damage: a note of hurt passes, mobs still refused (${dc.mobs})`);
  console.log(fails ? `world_mode: ${fails} failed` : 'world_mode: all passed');
  process.exit(fails ? 1 : 0);
}
