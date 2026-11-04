// #219: harvest_amethyst's spiral stair killed 4 of train 20's 8 members in the hostile world (3 falls, a zombie in the
// dark). Where falls hurt (every MC_WORLD_MODE but peaceful) the skill and its library spec are left out, research included
// (foundry/list.ts AMETHYST_TRIP); peaceful keeps them, and the cobweb trip (#178) stays in every mode. A child process
// per mode (the mode is read once at import): the foundry's skill names and which specs the library loads with them.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/amethyst_mode.mts
import { execFileSync } from 'node:child_process';
import minecraftData from 'minecraft-data';

if (process.env.MODE_CHILD) {
  const { FOUNDRY_SKILLS } = await import('../../server/src/mineflayer/foundry/list');
  const { loadLibrary } = await import('../../server/src/library');
  const names = FOUNDRY_SKILLS.filter((f) => f.activity).map((f) => f.name);
  const lib = loadLibrary(minecraftData('26.1'), new Set(names));
  console.log(JSON.stringify({ skills: names, specs: lib.specs.map((s) => s.id) }));
} else {
  let fails = 0;
  const ok = (cond: unknown, what: string) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
    if (!cond) fails++;
  };
  const child = (mode: string): { skills: string[]; specs: string[] } => {
    const out = execFileSync(process.execPath, [...process.execArgv, process.argv[1]], {
      env: { ...process.env, MODE_CHILD: '1', MC_WORLD_MODE: mode, MC_STRING: 'on', MC_INNOVATE: 'on' }, encoding: 'utf8',
    });
    return JSON.parse(out.trim().split('\n').pop()!);
  };
  const by = Object.fromEntries(['peaceful', 'damage', 'easy', 'hostile', 'normal'].map((m) => [m, child(m)]));
  ok(by.peaceful.skills.includes('harvest_amethyst') && by.peaceful.specs.includes('lib:amethyst'), 'peaceful: harvest_amethyst and lib:amethyst as before');
  for (const m of ['damage', 'easy', 'hostile', 'normal']) {
    ok(!by[m].skills.includes('harvest_amethyst') && !by[m].specs.includes('lib:amethyst'), `${m}: no harvest_amethyst, no lib:amethyst (its research neither)`);
  }
  const cobweb = (m: string) => by[m].skills.some((s) => /cobweb|string/.test(s));
  ok(['peaceful', 'hostile'].every(cobweb), 'the cobweb trip stays in peaceful and hostile');
  const others = (m: string) => by[m].specs.filter((s) => s !== 'lib:amethyst').sort().join(',');
  ok(others('hostile') === others('peaceful'), `every other spec loads alike (${others('hostile')})`);
  console.log(fails ? `${fails} failed` : 'amethyst_mode: all ok');
  process.exit(fails ? 1 : 0);
}
