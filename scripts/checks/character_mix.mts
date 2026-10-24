/**
 * #115 2b: culture mixes (MC_CHARACTER_MIX, character.ts and archetypes.ts). Under "wealth:40,invention:60" with the
 * default seed: 10 wealth and 14 invention workers, the Mayor an inventor, each member's traits, values and goal its
 * archetype's; the same seed the same members, another seed others; a "drawn" share keeps those members' draws exactly as
 * with no mix; mayor:<archetype> names the Mayor's; profiles.ts' assignment equals character.ts'; bad mixes and custom
 * archetypes are refused.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/character_mix.mts
 */
const { assignMix, parseMix, parseArchetypes, BUILT_IN } = await import('../../server/src/archetypes');
const { workerName } = await import('../../server/src/agentNames');
let fails = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const count = (xs: string[]) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {} as Record<string, number>);

// the arithmetic, pure
const a = assignMix([['wealth', 40], ['invention', 60]], 24, 'mix');
ok(count(a).wealth === 10 && count(a).invention === 14, `40/60 of 24: ${JSON.stringify(count(a))}`);
ok(JSON.stringify(assignMix([['wealth', 40], ['invention', 60]], 24, 'mix')) === JSON.stringify(a), 'the same seed, the same assignment');
const b = assignMix([['wealth', 40], ['invention', 60]], 24, 'other');
ok(JSON.stringify(b) !== JSON.stringify(a) && count(b).wealth === 10, 'another seed: other members, the same counts');
const c3 = count(assignMix([['wealth', 1], ['invention', 1], ['community', 1]], 24, 'mix'));
ok(c3.wealth === 8 && c3.invention === 8 && c3.community === 8, `thirds: ${JSON.stringify(c3)}`);
const c7 = count(assignMix([['wealth', 33], ['invention', 33], ['beauty', 34]], 24, 'mix'));
ok(c7.wealth + c7.invention + c7.beauty === 24 && c7.beauty === 8, `33/33/34 sums to 24: ${JSON.stringify(c7)}`);
const bad = (m: string) => {
  try {
    parseMix(m, BUILT_IN);
    return false;
  } catch {
    return true;
  }
};
ok(bad('greed:50') && bad('wealth:0') && bad('') && bad('mayor:nobody,wealth:1') && !bad('drawn:50,wealth:50,mayor:beauty'), 'bad mixes refused, a good one taken');
const badArch = (x: object) => {
  try {
    parseArchetypes(x as never);
    return false;
  } catch {
    return true;
  }
};
const good = { hex: { H: 0, E: 0, X: 0, A: 0, C: 0, O: 0 }, values: { openness: 0.5, conservation: 0.5, enhancement: 0.5, transcendence: 0.5 }, goal: 'home' };
ok(!badArch({ farmer: good }) && badArch({ farmer: { ...good, goal: 'fame' } }) && badArch({ farmer: { ...good, hex: { ...good.hex, O: 2 } } }) && badArch({ wealth: good }) && badArch({ drawn: good }), 'custom archetypes checked');

// character.ts under a mix (its state is set at load: one mix per process)
process.env.MC_CHARACTER_MIX = 'drawn:25,wealth:25,invention:50';
process.env.MC_CHARACTER_ARCHETYPES = JSON.stringify({ farmer: good });
const ch = await import('../../server/src/character');
const asg = ch.characterAssignment();
const n = count(Object.values(asg).slice(1));
ok(n.drawn === 6 && n.wealth === 6 && n.invention === 12 && asg.Mayor === 'invention', `drawn:25,wealth:25,invention:50: ${JSON.stringify(n)}, Mayor ${asg.Mayor}`);
const { assignmentOf } = await import('../../server/src/profiles');
ok(JSON.stringify(assignmentOf({ MC_CHARACTER_MIX: process.env.MC_CHARACTER_MIX!, MC_CHARACTER_ARCHETYPES: process.env.MC_CHARACTER_ARCHETYPES! })) === JSON.stringify(asg), "profiles.ts' assignment is character.ts'");
const inv = Object.keys(asg).find((k) => asg[k] === 'invention' && k !== 'Mayor')!;
const wl = Object.keys(asg).find((k) => asg[k] === 'wealth')!;
ok(ch.goalFromValues(inv) === 'invention' && ch.goalFromValues(wl) === 'wealth', `goals follow the archetype (${inv}: ${ch.goalFromValues(inv)}, ${wl}: ${ch.goalFromValues(wl)})`);
ok(ch.hexacoOf(inv).O >= 0.7 && ch.valuesOf(inv).openness >= 0.85 && ch.hexacoOf(wl).H <= -0.6, `traits and values follow it (${inv} O ${ch.hexacoOf(inv).O}; ${wl} H ${ch.hexacoOf(wl).H})`);
ok(ch.PRESETS.farmer?.goal === 'home', 'a custom archetype is known');
// (a drawn member's character as with no mix: the Latin hypercube's and the value table's, which the mix leaves alone)
const drawnName = Object.keys(asg).find((k) => asg[k] === 'drawn')!;
const { spawnSync } = await import('node:child_process');
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { pathToFileURL } = await import('node:url');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'char-mix-')), 'plain.mts');
fs.writeFileSync(tmp, `const c = await import(${JSON.stringify(pathToFileURL(path.resolve('server/src/character.ts')).href)});
console.log(JSON.stringify([c.hexacoOf('${drawnName}'), c.valuesOf('${drawnName}'), c.goalFromValues('${drawnName}')]));
`);
const env = { ...process.env };
for (const k of ['MC_CHARACTER_MIX', 'MC_CHARACTER_ARCHETYPES', 'MC_CHARACTER_PRESET']) delete env[k];
const plain = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', tmp], { encoding: 'utf8', env });
fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
const mine = JSON.stringify([ch.hexacoOf(drawnName), ch.valuesOf(drawnName), ch.goalFromValues(drawnName)]);
ok(plain.stdout.trim() === mine, `a drawn member (${drawnName}) keeps its draws: ${plain.stdout.trim() === mine ? 'same' : `${plain.stdout.trim()} vs ${mine}`}`);
ok(ch.archetypeOf('Stranger') !== undefined && ['drawn', 'wealth', 'invention'].includes(ch.archetypeOf('Stranger')), `a name outside the pool gets one (${ch.archetypeOf('Stranger')})`);
ok(workerName(1) in asg, 'the assignment names the pool');
console.log(fails ? `character_mix: ${fails} of ${checks} failed` : `character_mix: all ${checks} passed`);
process.exit(fails ? 1 : 0);
