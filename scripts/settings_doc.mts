/**
 * #115: docs/SETTINGS.md from the settings registry (server/src/settings.ts): every setting by group, with its type,
 * default, whether it may change during a run, what it requires and its description. `--check` fails when the file
 * differs from what the registry gives (check:offline runs it).
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/settings_doc.mts [--check]
 */
import fs from 'node:fs';

const { SETTINGS } = await import('../server/src/settings');
const OUT = 'docs/SETTINGS.md';
const GROUPS: Record<string, string> = {
  speed: 'Game speed', models: 'Models and budget', choices: 'Choices and pacing', building: 'Building', economy: 'Economy and storage',
  social: 'Social', character: 'Memory and character', ladder: 'The ladder of ages', needs: 'Needs and food', server: 'Server and run', debug: 'Debug',
};
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const lines = [
  '# Settings',
  '',
  'Generated from `server/src/settings.ts` by `scripts/settings_doc.mts`; do not edit by hand. Every setting is an',
  'environment variable of the agent server (or the sandbox). "Default" is the value used when it is unset (a flag: `on`',
  'or `off`; any of on/1/true turns a flag on, off/0/false turns it off, as each reads it). "Live" settings may change',
  'during a run; the others need a restart. "Not in" names run kinds a setting must not be raised in.',
  '',
  `${SETTINGS.length} settings.`,
  '',
];
for (const [g, title] of Object.entries(GROUPS)) {
  const rows = SETTINGS.filter((s) => s.group === g).sort((a, b) => a.name.localeCompare(b.name));
  if (!rows.length) continue;
  lines.push(`## ${title}`, '', '| Setting | Type | Default | Live | Requires | Description |', '| --- | --- | --- | --- | --- | --- |');
  for (const s of rows)
    lines.push(`| \`${s.name}\` | ${s.type} | ${s.default === '' ? '(unset)' : `\`${cell(s.default)}\``} | ${s.live ? 'yes' : ''} | ${(s.requires ?? []).map((r) => `\`${r}\``).join(', ')}${s.notIn ? `${s.requires ? '; ' : ''}not in ${s.notIn.join(', ')}` : ''} | ${cell(s.describe)} |`);
  lines.push('');
}
const text = lines.join('\n');
if (process.argv.includes('--check')) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (have !== text) {
    console.log(`FAIL ${OUT} is out of date: run node node_modules/tsx/dist/cli.mjs scripts/settings_doc.mts`);
    process.exit(1);
  }
  console.log(`settings_doc: ${OUT} up to date (${SETTINGS.length} settings)`);
} else {
  fs.writeFileSync(OUT, text);
  console.log(`settings_doc: wrote ${OUT} (${SETTINGS.length} settings)`);
}
