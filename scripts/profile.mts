/**
 * #115: run profiles from the command line (server/src/profiles.ts).
 *   list                          every profile with its kind and description
 *   check NAME|PATH [--json]      validate one (exit 1 on errors), with the cloud cost estimate for a model-driven one
 *   effective                     read {"kind":..., "settings": {...}} on stdin; print the check and every setting's value
 *                                 (run_series.py writes it into NAME.profile.json)
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/profile.mts list|check|effective ...
 */
import fs from 'node:fs';

const { checkProfile, checkSettings, effectiveSettings, estimateCost, listProfiles, loadProfile } = await import('../server/src/profiles');
const ROOT = process.cwd();
const [cmd, arg] = process.argv.slice(2);
const json = process.argv.includes('--json');

if (cmd === 'list') {
  for (const { name, file } of listProfiles(ROOT)) {
    try {
      const p = loadProfile(file, ROOT);
      const c = checkProfile(p);
      console.log(`${name.padEnd(18)} ${String(p.kind).padEnd(10)} ${c.errors.length ? `[${c.errors.length} errors] ` : ''}${p.describe}`);
    } catch (e) {
      console.log(`${name.padEnd(18)} unreadable: ${(e as Error).message}`);
    }
  }
} else if (cmd === 'check' && arg) {
  const p = loadProfile(arg, ROOT);
  const c = checkProfile(p);
  const members = (p.workers ?? 2) + 1;
  const est = p.kind === 'model' ? estimateCost(ROOT, members) : null;
  if (json) console.log(JSON.stringify({ ...c, estimate: est, members }));
  else {
    for (const e of c.errors) console.log(`error: ${e}`);
    for (const w of c.warnings) console.log(`warning: ${w}`);
    if (est) console.log(`estimate: ~${(est.tokensHour / 1e6).toFixed(1)}M cloud tokens and ~$${est.usdHour.toFixed(2)} an hour for ${members} members (from ${est.from} recent model-driven runs)`);
    console.log(`${p.name}: ${c.errors.length ? `${c.errors.length} errors` : 'ok'}${c.warnings.length ? `, ${c.warnings.length} warnings` : ''}`);
  }
  process.exit(c.errors.length ? 1 : 0);
} else if (cmd === 'effective') {
  const input = JSON.parse(fs.readFileSync(0, 'utf8')) as { kind?: 'staged' | 'model' | 'checkpoint'; settings?: Record<string, string> };
  const given = Object.fromEntries(Object.entries(input.settings ?? {}).map(([k, v]) => [k, String(v)]));
  console.log(JSON.stringify({ ...checkSettings(given, input.kind ?? 'staged'), effective: effectiveSettings(given) }));
} else {
  console.log('usage: profile.mts list | check NAME|PATH [--json] | effective < {"kind":..., "settings":{...}}');
  process.exit(2);
}
