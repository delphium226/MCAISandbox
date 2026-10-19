/**
 * Neighbourhood names (#10, server/src/placeNames.ts), offline: every name the generator gives fits a sign line (90 px);
 * names are deterministic (the same village and index give the same name), unique within a village (40 neighbourhoods);
 * an old village's layouts without names get them (the same answer twice, stored by ensureNames, unchanged after); a
 * signpost's text. Given villages.json files (read-only), prints each village's neighbourhood names.
 * Usage: node_modules/.bin/tsx scripts/checks/place_names.mts [villages.json ...]
 */
import fs from 'node:fs';
import { ALL_NAMES, ensureNames, neighbourhoodNames, pickName, signpostText } from '../../server/src/placeNames';
import { signLineWidth } from '../../server/src/streetPlan';
import type { Village } from '../../server/src/village';

let failures = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) failures++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};

ok(ALL_NAMES.length >= 40, `${ALL_NAMES.length} names to give`);
const wide = ALL_NAMES.filter((n) => signLineWidth(n) > 90);
ok(!wide.length, `every name fits a sign line (widest ${Math.max(...ALL_NAMES.map(signLineWidth))} px)${wide.length ? `: ${wide.join(', ')}` : ''}`);

// Deterministic and unique: 40 neighbourhoods, twice
const run = (village: string, wood?: string, style?: string) => {
  const used: string[] = [];
  for (let k = 1; k <= 40; k++) used.push(pickName(village, k, used, { wood, style }));
  return used;
};
const a = run('Minevale3', 'birch', 'plains'), b = run('Minevale3', 'birch', 'plains');
ok(a.join() === b.join(), 'the same village gives the same names');
ok(new Set(a).size === a.length, `40 names, all different (first: ${a.slice(0, 6).join(', ')})`);
ok(a[0].startsWith('Birch'), `the first fits the wood (${a[0]})`);
ok(run('Hutvale4').join() !== a.join(), `another village gets others (${run('Hutvale4').slice(0, 3).join(', ')})`);

// An old village: growth layouts with no names
const lay = (grow: number | undefined, buildings: string[], x: number) => ({ x1: x, z1: 0, x2: x + 20, z2: 20, buildings, ...(grow ? { grow } : {}) });
const old = {
  name: 'Oldvale', wood: 'spruce', designs: {}, tasks: [], plots: [], structures: [],
  layouts: [lay(undefined, ['storage_hut', 'plains_library_2'], 0), lay(1, ['plains_small_house_1', 'plains_small_house_2'], 30),
    lay(2, ['plains_temple_3'], 60), lay(3, ['plains_small_house_3'], 90)],
  growth: { past: [{ k: 1, layout: 2, style: 'taiga' }, { k: 2, layout: 3, project: 'plains_temple_3' }, { k: 3, layout: 4 }] },
} as unknown as Village;
const first = neighbourhoodNames(old), again = neighbourhoodNames(old);
ok([...first.keys()].join() === '2,4', `only the house neighbourhoods are named (layouts ${[...first.keys()].join(', ')}: ${[...first.values()].join(', ')})`);
ok(JSON.stringify([...first]) === JSON.stringify([...again]), 'an old village gets the same names twice');
ok(ensureNames(old) && old.layouts![1].name === first.get(2) && old.layouts![3].name === first.get(4) && !old.layouts![2].name, 'ensureNames stores them on the layouts');
ok(!ensureNames(old) && JSON.stringify([...neighbourhoodNames(old)]) === JSON.stringify([...first]), 'stored, they stay');
ok(signpostText(old, 35, 5)[0] === first.get(2) && signpostText(old, 35, 5).length === 1, `a signpost in a neighbourhood: ${signpostText(old, 35, 5).join(' / ')}`);
ok(signpostText(old, 150, 10)[1] === 'to the west', `a signpost outside: ${signpostText(old, 150, 10).join(' / ')}`);

for (const file of process.argv.slice(2)) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const vs: Village[] = Array.isArray(raw) ? raw : Array.isArray(raw.villages) ? raw.villages : Object.values(raw.villages ?? raw);
  for (const v of vs) {
    const names = neighbourhoodNames(v);
    console.log(`${file}: ${v.name} (${v.wood ?? 'no wood'}): ${names.size ? [...names].map(([n, name]) => `layout ${n} ${name}`).join(', ') : 'no neighbourhoods'}`);
    ok(new Set(names.values()).size === names.size, `${v.name}: names all different`);
    for (const it of v.initiatives ?? []) if (it.kind === 'signpost') console.log(`  signpost ${it.id} at ${it.x},${it.z}: ${signpostText(v, it.x, it.z).join(' / ')}`);
  }
}
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
