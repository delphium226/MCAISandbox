// MC_WORLD_MODE (worldMode.ts, survival stage (a)): the mode table (peaceful as before, damage turns on falls, drowning and
// fire and nothing else, every mode sets the same rules and keeps keep_inventory), the setting's parsing, the death
// messages' causes (mcHazard.ts), and the prompts by mode: the primer's harm line and memory's note check. The prompt
// cases run in a child process per mode (the settings are read once at import). Stage (b) (MC_WORLD_MODE=easy, spec
// runs/2026-10-31/survival/spec_b.md): the sleeping rule, hunger and nights by mode, the appetite's thresholds and switch,
// the eating reflex's choice, the safe spawn cell, the sleeper's pick, the night window, and the wordings by mode
// (goalMap's world facts, the proposals' triage, wanted's bee facts; peaceful's unchanged).
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/world_mode.mts
import { execFileSync } from 'node:child_process';

if (process.env.MODE_CHILD) {
  const { PRIMER } = await import('../../server/src/choose');
  const { checkNote } = await import('../../server/src/memory');
  const { worldMode } = await import('../../server/src/worldMode');
  const { worldFacts } = await import('../../server/src/goalMap');
  const { APPETITE, appetiteOn } = await import('../../server/src/appetite');
  const { TRIAGE_SYSTEM } = await import('../../server/src/proposals');
  const { CAPABILITIES } = await import('../../server/src/wanted');
  const village = { complete: true, food: { members: {}, made: {}, eaten: {}, meals: 0 } } as never;
  console.log(JSON.stringify({
    facts: worldFacts(), eatAt: APPETITE.eatAt, rate: APPETITE.rate, appetiteOn: appetiteOn(village),
    triage: /The world: [^\n]*/.exec(TRIAGE_SYSTEM)?.[0] ?? '', bees: CAPABILITIES.find((c) => c.id === 'honeycomb')?.facts ?? '',
    primerFull: PRIMER.slice(0, 500),
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
    && Object.keys(p.rules).length === 14 && p.rules.players_sleeping_percentage === '100' && p.rules.pvp === 'true', 'peaceful: the 11 rules as before, plus mob_griefing, players_sleeping_percentage and pvp at vanilla\'s true, 100 and true');
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
  // Stage (c): hostile is easy with monsters, no griefing and no pvp (a sword's sweep hit a member); pvp off only with monsters
  const h = MODES.hostile, hc = Object.keys(h.rules).filter((k) => h.rules[k] !== MODES.easy.rules[k]).sort();
  ok(h.difficulty === 'easy' && h.mobs && h.hunger && h.nights && hc.join() === 'mob_griefing,pvp,spawn_monsters', `hostile: easy plus monsters, griefing and pvp off (${hc.join(', ')})`);
  ok(WORLD_MODES.every((m) => (MODES[m].rules.pvp === 'false') === MODES[m].mobs), 'pvp off exactly where monsters come');
  ok(parseMode('hostile') === 'hostile', 'parseMode: hostile');
  // Stage (b): one sleeper skips the night where nights fall; hunger real off peaceful difficulty
  ok(WORLD_MODES.every((m) => MODES[m].rules.players_sleeping_percentage === (MODES[m].nights ? '1' : '100') && (MODES[m].rules.advance_time === 'true') === MODES[m].nights),
    'players_sleeping_percentage 1 exactly where nights fall (easy, normal), 100 elsewhere');
  ok(WORLD_MODES.every((m) => MODES[m].hunger === (MODES[m].difficulty !== 'peaceful')) && MODES.easy.hunger && MODES.easy.nights && !MODES.damage.hunger && !MODES.damage.nights,
    'hunger and nights: easy and normal only');
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
  // Stage (b)'s pure parts
  const { packBite, cellSafe, safeSpawnCell, pickSleeper, isNight } = await import('../../server/src/mineflayer/mcSurvivalB');
  const { Vec3 } = await import('vec3');
  ok(packBite({ bread: 3 }, 15, 20) === null && packBite({ bread: 3 }, 14, 20) === 'bread' && packBite({ bread: 1 }, 17, 10) === 'bread' && packBite({ bread: 1 }, 18, 5) === null,
    'eating reflex: at 14 or less, or under 18 when hurt (health under 14)');
  ok(packBite({ carrot: 9 }, 10, 20) === null && packBite({ carrot: 9 }, 6, 20) === 'carrot' && packBite({ cod: 4, rotten_flesh: 2, cake: 1 }, 2, 20) === null,
    'eating reflex: planting stock only at 6 or less; raw fish, rotten flesh and the cake never');
  ok(packBite({ bread: 1, cooked_salmon: 1, apple: 1 }, 14, 20) === 'cooked_salmon' && packBite({ bread: 1, cooked_salmon: 1, apple: 1 }, 15, 10) === 'bread',
    'eating reflex: the item that fills the bar best without spilling over');
  // A small world: stone up to y 63, air above, the extra blocks given
  const world = (extra: Record<string, string>) => (p: InstanceType<typeof Vec3>) => {
    if (Math.abs(p.x) > 8 || Math.abs(p.z) > 8) return null;
    const n = extra[`${p.x},${p.y},${p.z}`] ?? (p.y <= 63 ? 'stone' : 'air');
    return { name: n, boundingBox: ['stone', 'magma_block', 'oak_planks'].includes(n) ? 'block' : 'empty' };
  };
  const home = new Vec3(0, 64, 0);
  ok(cellSafe(world({}), home) === true && safeSpawnCell(world({}), home)?.moved === false, 'spawn: a clear home cell is kept');
  const lava = safeSpawnCell(world({ '0,64,0': 'lava' }), home);
  ok(!!lava && lava.moved && cellSafe(world({ '0,64,0': 'lava' }), lava.cell) === true && lava.cell.distanceTo(home) <= 2.5 && lava.cell.distanceTo(home) > 1.1,
    `spawn: lava at home moves it to the nearest safe cell not beside the lava (${lava?.cell})`);
  ok(cellSafe(world({ '0,65,0': 'oak_planks' }), home) === false && cellSafe(world({ '0,63,0': 'magma_block' }), home) === false && cellSafe(world({ '0,64,0': 'water' }), home) === false,
    'spawn: a blocked head, magma below or water at the feet is unsafe');
  ok(cellSafe(() => null, home) === null && safeSpawnCell(() => null, home) === null, 'spawn: unloaded ground is unknown (kept as it was)');
  const tries = new Map([['Ben', 2]]);
  ok(pickSleeper([{ name: 'Ada', dist: 30, free: true }, { name: 'Ben', dist: 3, free: true }, { name: 'Cal', dist: 10, free: false }, { name: 'Dot', dist: 12, free: true }], tries)?.name === 'Dot',
    'sleeper: the nearest free bed owner not tried twice tonight');
  ok(pickSleeper([{ name: 'Ben', dist: 3, free: true }], tries) === null, 'sleeper: none left to try');
  ok(!isNight(12000) && isNight(12541) && isNight(18000) && isNight(23458) && !isNight(23459) && !isNight(null), 'night: the beds\' window (12541-23458)');
  // The prompts, per mode
  const run = (mode: string) => JSON.parse(execFileSync(process.execPath, [...process.execArgv, process.argv[1]],
    { env: { ...process.env, MC_WORLD_MODE: mode, MODE_CHILD: '1' }, encoding: 'utf-8' }).trim().split('\n').pop()!);
  const pc = run(''), dc = run('damage'), ec = run('easy');
  ok(pc.mode === 'peaceful' && pc.primer.includes('no monsters and no harm; nobody dies.'), 'peaceful: the primer says nobody dies');
  ok(!!pc.hurt && !!pc.mobs, `peaceful: notes of hurt (${pc.hurt}) and mobs (${pc.mobs}) refused`);
  ok(dc.mode === 'damage' && !dc.primer.includes('nobody dies') && /falls, deep water, fire and lava hurt/.test(dc.primer), 'damage: the primer says what hurts');
  ok(dc.hurt === null && !!dc.mobs, `damage: a note of hurt passes, mobs still refused (${dc.mobs})`);
  // Stage (b)'s wordings and the appetite by mode
  ok(pc.facts.startsWith('The world: a peaceful Minecraft village') && pc.facts.includes('no hostile mobs, no damage, no fighting') && pc.triage.includes('peaceful survival (no hostile mobs, no damage), time frozen at day')
    && pc.bees.includes('a peaceful world takes no damage'), 'peaceful: world facts, triage line and bee facts as before');
  ok(dc.facts.includes('falls, deep water, fire and lava hurt') && !dc.facts.includes('no damage') && !dc.facts.includes('hungry') && dc.triage.includes('no hostile mobs, time frozen at day'), 'damage: the facts say what hurts, no hunger or nights');
  ok(ec.facts.includes('hungry and must eat') && ec.facts.includes('nights fall') && ec.triage.includes('day and night') && ec.bees.includes('angry bees sting')
    && /hungry and must eat/.test(ec.primerFull) && !/hungry and must eat/.test(dc.primerFull), 'easy: facts, triage, bees and the primer name hunger and nights');
  ok(pc.eatAt === 12 && dc.eatAt === 12 && ec.eatAt === 14, `appetite: peckish at 12 (peaceful, damage), 14 with real hunger (${pc.eatAt}/${dc.eatAt}/${ec.eatAt})`);
  ok(pc.rate === 0 && !pc.appetiteOn && !dc.appetiteOn && ec.appetiteOn, 'appetite: off without MC_APPETITE, on with real hunger (easy) for a complete village');
  console.log(fails ? `world_mode: ${fails} failed` : 'world_mode: all passed');
  process.exit(fails ? 1 : 0);
}
