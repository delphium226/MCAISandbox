// MC_CHARACTER_PRESET (character.ts, the user's monoculture experiment): with the wealth preset every member of 25 (the
// Mayor and workers 1-24) has wealth as its life goal, self-enhancement as its dominant value, low honesty-humility and
// high conscientiousness, a little jitter between members, and an identity line saying so; an unknown preset is refused.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/character_preset.mts
process.env.MC_CHARACTER_PRESET = 'wealth';
const C = await import('../../server/src/character');
const { workerName } = await import('../../server/src/agentNames');
const names = ['Mayor', ...Array.from({ length: 24 }, (_, i) => workerName(i + 1))];
let fails = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) fails++;
  if (!cond || process.env.VERBOSE) console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const hs = new Set<string>();
for (const n of names) {
  const h = C.hexacoOf(n), v = C.valuesOf(n), g = C.goalFromValues(n);
  const top = [...C.VALUES].sort((a, b) => v[b] - v[a])[0];
  ok(g === 'wealth', `${n}: goal ${g}`);
  ok(top === 'enhancement', `${n}: dominant value ${top}`);
  ok(h.H <= -0.5 && h.C >= 0.5, `${n}: H ${h.H}, C ${h.C}`);
  const line = C.identityLine(n, { goal: g });
  ok(/life goal is wealth/.test(line) && /out for yourself/.test(line), `${n}: ${line}`);
  ok(/getting ahead most/.test(C.valuesLine(n)), `${n}: ${C.valuesLine(n)}`);
  hs.add(JSON.stringify(h));
}
ok(hs.size === names.length, `members not identical (${hs.size} distinct trait sets of ${names.length})`);
console.log(`e.g. ${C.identityLine('Ada', { goal: C.goalFromValues('Ada') })} ${C.valuesLine('Ada')}`);
console.log(fails ? `character_preset: ${fails} failed` : `character_preset: all ${names.length} members have the wealth profile`);
process.exit(fails ? 1 : 0);
