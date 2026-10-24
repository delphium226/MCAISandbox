/**
 * #115: the settings registry against the server's code (server/src/settings.ts). Fails on: a process.env read of an
 * MC_/MCAI_ setting (or any process.env[...] read) outside settings.ts; a rawSetting/flag/layer name the registry lacks;
 * a registry entry the code never names; an entry whose default differs from the code's fallback (`rawSetting('X') ??
 * 'v'`); a sandbox arg() setting missing; requires naming an unknown setting; a duplicate entry.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/settings_reads.mts
 */
import fs from 'node:fs';
import path from 'node:path';

const { SETTINGS } = await import('../../server/src/settings');
const SRC = 'server/src';
let fails = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    fails++;
    console.log(`FAIL ${what}`);
  }
};

const files: string[] = [];
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) files.push(p);
  }
};
walk(SRC);
const reg = new Map(SETTINGS.map((s) => [s.name, s]));
ok(reg.size === SETTINGS.length, `no duplicate entries (${SETTINGS.length} entries, ${reg.size} names)`);

const named = new Set<string>();
const fallbacks = new Map<string, Set<string>>();
for (const f of files) {
  if (path.basename(f) === 'settings.ts' && path.dirname(f) === path.normalize(SRC)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(SRC, f).replace(/\\/g, '/');
  for (const m of src.matchAll(/process\.env(\.(MC|MCAI)_[A-Z0-9_]+|\[)/g)) ok(false, `${rel}: a read outside the registry (${m[0]})`);
  // (a number fallback may be a product, "2 * 60000", or spaced with _, "150_000"; one followed by more arithmetic is not taken)
  for (const m of src.matchAll(/\b(?:rawSetting|flag|layer)\('((?:MC|MCAI)_[A-Z0-9_]+)'\)(\s*\?\?\s*('([^']*)'|(-?[\d_.]+(?:\s*\*\s*[\d_.]+)*)(?=\s*[),;])))?/g)) {
    named.add(m[1]);
    ok(reg.has(m[1]), `${rel}: ${m[1]} is in the registry`);
    if (m[2] !== undefined) {
      const v = m[4] ?? String(m[5].split('*').reduce((a, x) => a * Number(x.trim().replace(/_/g, '')), 1));
      if (!fallbacks.has(m[1])) fallbacks.set(m[1], new Set());
      fallbacks.get(m[1])!.add(v);
    }
  }
  // (names passed through a helper or a table: any quoted literal counts as named)
  for (const m of src.matchAll(/['"`]((?:MC|MCAI)_[A-Z0-9_]+)['"`]/g)) named.add(m[1]);
  if (rel === 'index.ts') for (const m of src.matchAll(/\barg\('([a-z-]+)'/g)) {
    const n = `MC_${m[1].toUpperCase().replace(/-/g, '_')}`;
    named.add(n);
    ok(reg.has(n), `index.ts: the sandbox's ${n} is in the registry`);
  }
}
for (const s of SETTINGS) {
  ok(named.has(s.name), `${s.name} is read somewhere in server/src`);
  for (const r of s.requires ?? []) ok(reg.has(r), `${s.name} requires a known setting (${r})`);
  // (a flag's '' is its 'off')
  const fb = fallbacks.has(s.name) ? new Set([...fallbacks.get(s.name)!].map((v) => (s.type === 'flag' && v === '' ? 'off' : v))) : undefined;
  // (a code fallback differing from the entry's default: the doc would lie; several fallbacks are reported, not failed)
  if (fb && fb.size === 1) ok(fb.has(s.default), `${s.name}: default '${s.default}' is the code's fallback ('${[...fb][0]}')`);
  else if (fb && fb.size > 1) console.log(`note ${s.name}: several code fallbacks (${[...fb].join(', ')}); default '${s.default}'`);
}
console.log(fails ? `settings_reads: ${fails} of ${checks} failed` : `settings_reads: all ${checks} passed (${SETTINGS.length} settings)`);
process.exit(fails ? 1 : 0);
