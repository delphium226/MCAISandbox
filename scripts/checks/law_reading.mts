/**
 * G3 (#30): code's reading of the laws members wrote in Long1 (10-22, 238 nights; scripts/checks/long1_laws.json,
 * the night replies' `law` field as gpt-oss wrote it). Every one must be read into words (lawFrom), and the share typed
 * (not a free-text norm) is printed by type, with refusals and their reasons; VERBOSE=1 prints each law and its reading.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/law_reading.mts [LAWS.json]
 */
import fs from 'node:fs';
process.env.MC_RULES = 'on';
const rules = await import('../../server/src/rules');
const file = process.argv[2] ?? 'scripts/checks/long1_laws.json';
const xs = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ law: unknown }>;
const by: Record<string, number> = {}, refused: Record<string, number> = {}, targets: Record<string, number> = {};
let unread = 0;
for (const x of xs) {
  const w = rules.lawFrom(x.law);
  if (!w) {
    unread++;
    console.log(`  UNREAD ${JSON.stringify(x.law).slice(0, 160)}`);
    continue;
  }
  const r = rules.readLaw(w);
  const bad = rules.validate(r.type, r.params);
  by[r.type] = (by[r.type] ?? 0) + 1;
  if (bad) refused[bad] = (refused[bad] ?? 0) + 1;
  else targets[rules.lawTarget(r.type, r.params).slice(0, 40)] = (targets[rules.lawTarget(r.type, r.params).slice(0, 40)] ?? 0) + 1;
  if (process.env.VERBOSE) console.log(`${r.type.padEnd(10)} ${bad ? 'REFUSED ' : ''}${JSON.stringify(r.params).slice(0, 60).padEnd(60)} | ${w.what.slice(0, 120)}`);
}
const n = xs.length;
console.log(`laws ${n}, read ${n - unread}; by type: ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([t, k]) => `${t} ${k}`).join(', ')}; typed ${Math.round(100 * (n - unread - (by.norm ?? 0)) / n)}%`);
console.log(`refused: ${JSON.stringify(refused)}`);
console.log(`distinct targets (typed and valid): ${Object.keys(targets).filter((t) => !t.startsWith('norm')).length}; top: ${Object.entries(targets).filter(([t]) => !t.startsWith('norm')).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, k]) => `${t} ${k}`).join(', ')}`);
if (unread) process.exitCode = 1;
