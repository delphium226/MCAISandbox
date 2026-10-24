/**
 * Run profiles (#115, spec runs/2026-10-24/run-profiles/spec.md 2): a run's starting conditions as a file,
 * profiles/NAME.json (the user's own in profiles/local/, gitignored). A profile is a run_series run (scripts/run_series.py)
 * with a name, a description, a kind and its agent server settings under `settings` (run_series' `server_env`); any other
 * run_series run key may be given too (args, preset, fast, time_scale, stage_env, checks, objective, minutes...).
 * Validated against the settings registry (settings.ts): unknown settings and wrong values are errors, a flag on
 * without what it requires is an error, speed-ups in a model-driven run are warnings, and the cloud cost an hour is
 * estimated from recent model-driven runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { workerName } from './agentNames';
import { BUILT_IN, assignMix, mixMayor, parseArchetypes, parseMix, type Preset } from './archetypes';
import { CALL_KINDS } from './modelUsage';
import { SETTINGS, settingOf } from './settings';

export type ProfileKind = 'staged' | 'model' | 'checkpoint';

export interface Profile {
  name: string;
  describe: string;
  kind: ProfileKind;
  world?: number;
  site?: string;
  village?: string;
  /** Members besides the Mayor (1-24, agentNames.ts' pool). */
  workers?: number;
  objective?: string;
  minutes?: number;
  checkpoint?: string;
  /** The agent server's settings (MC_*, MCAI_*), as run_series' server_env. */
  settings?: Record<string, string | number | boolean>;
  schedule?: Array<{ at_min: number; set: Record<string, string | number | boolean> }>;
  /** Custom archetypes beside the built-in ones (archetypes.ts), passed as MC_CHARACTER_ARCHETYPES. */
  archetypes?: Record<string, Preset>;
  [key: string]: unknown;
}

/** The keys a profile may hold: its own, then run_series' run keys (its docstring). */
const OWN_KEYS = ['name', 'describe', 'kind', 'settings', 'schedule', 'archetypes'];
export const RUN_KEYS = ['world', 'site', 'village', 'workers', 'objective', 'minutes', 'checkpoint', 'port', 'preset', 'fast', 'time_scale', 'stage_env', 'args',
  'timeout_min', 'checks', 'show', 'save', 'reset', 'x', 'z', 'planner', 'site_size', 'after', 'replay', 'replay_mode', 'server_env', 'out'];
const KINDS: ProfileKind[] = ['staged', 'model', 'checkpoint'];
const FLAG_VALUE = /^(on|off|1|0|true|false|yes|no)$/i;
const ON = /^(on|1|true|yes)$/i;

export interface Check {
  errors: string[];
  warnings: string[];
}

/** A setting's value as the environment gives it ('' for none): booleans as on/off, numbers as written. */
export const envValue = (v: string | number | boolean): string => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));

/** Every registry setting's value under these settings (the given ones, else each one's default). */
export function effectiveSettings(given: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of SETTINGS) out[s.name] = given[s.name] ?? s.default;
  return out;
}

/** A flag's value counts as on (a flag the registry calls on by default stays on until set off). */
const flagOn = (v: string | undefined) => !!v && ON.test(v);

/**
 * The settings checked against the registry: unknown names, values that do not parse as their type, a flag turned on
 * whose required settings are off (given or by default), and for a model-driven run the speed-ups an acceptance run must
 * not have (warnings).
 */
export function checkSettings(given: Record<string, string>, kind: ProfileKind = 'staged'): Check {
  const errors: string[] = [], warnings: string[] = [];
  const eff = effectiveSettings(given);
  for (const [name, v] of Object.entries(given)) {
    const s = settingOf(name);
    if (!s) {
      errors.push(`unknown setting ${name} (not in server/src/settings.ts)`);
      continue;
    }
    if (s.type === 'flag' && v !== '' && !FLAG_VALUE.test(v)) errors.push(`${name}=${v}: a flag takes on or off`);
    if (s.type === 'number' && v !== '' && !Number.isFinite(Number(v))) errors.push(`${name}=${v}: not a number`);
    if (s.values && v !== '' && !s.values.includes(v.trim().toLowerCase())) errors.push(`${name}=${v}: takes ${s.values.join(', ')}`);
    if (name === 'MC_REASONING' && v !== '')
      for (const part of v.split(',').map((q) => q.trim()).filter(Boolean)) {
        const [k, lv] = part.split('=').map((q) => q.trim());
        if (!(CALL_KINDS as readonly string[]).includes(k) || !['low', 'medium', 'high'].includes((lv ?? '').toLowerCase())) errors.push(`MC_REASONING: "${part}" (kinds ${CALL_KINDS.join(', ')}; levels low, medium, high)`);
      }
    if (s.type === 'flag' && flagOn(v))
      for (const r of s.requires ?? []) {
        const rs = settingOf(r);
        const rv = eff[r];
        if (rs?.type === 'flag' ? !flagOn(rv) : !rv) errors.push(`${name} is on but ${r}, which it needs, is ${rv || 'unset'}`);
      }
  }
  // (#115 2b: the culture: one of preset or mix, every archetype known, custom ones well formed)
  try {
    const known = { ...BUILT_IN, ...parseArchetypes(given.MC_CHARACTER_ARCHETYPES ?? '') };
    if (given.MC_CHARACTER_PRESET && given.MC_CHARACTER_MIX) errors.push('MC_CHARACTER_PRESET and MC_CHARACTER_MIX are both set: give one');
    if (given.MC_CHARACTER_PRESET && !known[given.MC_CHARACTER_PRESET.trim().toLowerCase()]) errors.push(`MC_CHARACTER_PRESET=${given.MC_CHARACTER_PRESET}: no such archetype (${Object.keys(known).join(', ')})`);
    if (given.MC_CHARACTER_MIX) parseMix(given.MC_CHARACTER_MIX, known);
  } catch (e) {
    errors.push((e as Error).message);
  }
  if (kind === 'model') {
    const raised = (n: string, base: number) => Number(eff[n] || base) > base;
    if (raised('MC_TIME_SCALE', 1)) warnings.push(`MC_TIME_SCALE=${eff.MC_TIME_SCALE} in a model-driven run (acceptance runs are 1x)`);
    if (raised('MC_HASTE', 0)) warnings.push(`MC_HASTE=${eff.MC_HASTE} in a model-driven run (acceptance runs dig at vanilla speed)`);
    if (raised('MC_RANDOM_TICK', 3)) warnings.push(`MC_RANDOM_TICK=${eff.MC_RANDOM_TICK} in a model-driven run (acceptance runs grow crops at vanilla speed)`);
    if (raised('MC_BUILD_SPEED', 1)) warnings.push(`MC_BUILD_SPEED=${eff.MC_BUILD_SPEED} in a model-driven run`);
  }
  return { errors, warnings };
}

/** A profile checked: its own keys, its kind and members, its settings and its schedule. */
export function checkProfile(p: Profile): Check {
  const errors: string[] = [], warnings: string[] = [];
  if (!p || typeof p !== 'object') return { errors: ['not a JSON object'], warnings };
  for (const k of Object.keys(p)) if (!OWN_KEYS.includes(k) && !RUN_KEYS.includes(k)) errors.push(`unknown key "${k}"`);
  if (typeof p.name !== 'string' || !/^[a-z0-9][a-z0-9_.-]*$/i.test(p.name)) errors.push('"name" must be a plain name');
  if (typeof p.describe !== 'string' || !p.describe.trim()) errors.push('"describe" is required');
  if (!KINDS.includes(p.kind)) errors.push(`"kind" must be one of ${KINDS.join(', ')}`);
  if (p.server_env !== undefined) errors.push('give the agent server\'s settings under "settings", not "server_env"');
  if (p.workers !== undefined && (!Number.isInteger(p.workers) || p.workers < 1 || p.workers > 24)) errors.push('"workers" must be 1-24 (members besides the Mayor)');
  if (p.preset === 'watch' && typeof p.objective !== 'string') errors.push('a watch run (preset "watch") needs an "objective"');
  if (p.preset === 'watch' && p.kind !== 'model') errors.push('a watch run is model-driven: "kind": "model"');
  if (p.kind === 'checkpoint' && typeof p.checkpoint !== 'string') errors.push('a checkpoint profile needs a "checkpoint"');
  const given = profileEnv(p);
  const c = checkSettings(given, p.kind);
  errors.push(...c.errors);
  warnings.push(...c.warnings);
  for (const [i, step] of (p.schedule ?? []).entries()) {
    if (!(Number(step?.at_min) >= 0)) errors.push(`schedule ${i + 1}: "at_min" must be a minute >= 0`);
    for (const n of Object.keys(step?.set ?? {})) {
      const s = settingOf(n);
      if (!s) errors.push(`schedule ${i + 1}: unknown setting ${n}`);
      else if (!s.live) errors.push(`schedule ${i + 1}: ${n} cannot change during a run (start-only)`);
    }
  }
  return { errors, warnings };
}

/** The profile files' folders under the repository: the committed ones, then the user's own. */
export const profileDirs = (root: string) => [path.join(root, 'profiles'), path.join(root, 'profiles', 'local')];

/** A profile by name (profiles/NAME.json, else profiles/local/NAME.json) or by path. */
export function loadProfile(nameOrPath: string, root: string): Profile {
  const file = /[\\/]|\.json$/.test(nameOrPath) ? nameOrPath : profileDirs(root).map((d) => path.join(d, `${nameOrPath}.json`)).find((f) => fs.existsSync(f));
  if (!file || !fs.existsSync(file)) throw new Error(`no profile "${nameOrPath}" in profiles/ or profiles/local/`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Profile;
}

/** Every profile's name and file. */
export function listProfiles(root: string): Array<{ name: string; file: string }> {
  const out: Array<{ name: string; file: string }> = [];
  for (const d of profileDirs(root))
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.json')) out.push({ name: f.replace(/\.json$/, ''), file: path.join(d, f) });
  return out;
}

/**
 * The cloud cost of a model-driven run an hour, from recent ones: the watch logs' STOPPED lines (tokens and dollars over
 * the run's minutes, runs of 20+ minutes and 300+ calls) over the members spawned (SPAWN lines), the median of the
 * latest `n`, scaled to `members`. Null when no such run is found.
 */
export function estimateCost(root: string, members: number, n = 6): { tokensHour: number; usdHour: number; from: number } | null {
  const runs = path.join(root, 'runs');
  if (!fs.existsSync(runs)) return null;
  const found: Array<{ t: number; tok: number; usd: number }> = [];
  const days = fs.readdirSync(runs).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-6);
  const scan = (dir: string, depth: number) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 2) scan(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.log') && fs.statSync(p).size < 5_000_000) {
        const text = fs.readFileSync(p, 'utf8');
        const m = /STOPPED after ([\d.]+)m.*?tokens ([\d.]+)([kM]) in \/ ([\d.]+)([kM]) out in (\d+) calls, ~\$([\d.]+)/.exec(text);
        if (!m || Number(m[1]) < 20 || Number(m[6]) < 300) continue;
        const spawned = (text.match(/^SPAWN /gm) ?? []).length;
        if (!spawned) continue;
        const k = (x: string, u: string) => Number(x) * (u === 'M' ? 1e6 : 1e3);
        const hours = Number(m[1]) / 60;
        found.push({ t: fs.statSync(p).mtimeMs, tok: (k(m[2], m[3]) + k(m[4], m[5])) / hours / spawned, usd: Number(m[7]) / hours / spawned });
      }
    }
  };
  for (const d of days) scan(path.join(runs, d), 0);
  if (!found.length) return null;
  const last = found.sort((a, b) => b.t - a.t).slice(0, n);
  const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return { tokensHour: Math.round(med(last.map((r) => r.tok)) * members), usdHour: Math.round(med(last.map((r) => r.usd)) * members * 100) / 100, from: last.length };
}

/** A profile's agent server settings as the environment takes them: its settings, and its custom archetypes as
 *  MC_CHARACTER_ARCHETYPES. */
export function profileEnv(p: Profile): Record<string, string> {
  const out = Object.fromEntries(Object.entries(p.settings ?? {}).map(([k, v]) => [k, envValue(v)]));
  if (p.archetypes && Object.keys(p.archetypes).length) out.MC_CHARACTER_ARCHETYPES = JSON.stringify(p.archetypes);
  if (p.schedule?.length) out.MC_SCHEDULE = JSON.stringify(p.schedule);
  return out;
}

/** The members' archetypes under these settings (character.ts' archetypeOf for the Mayor and the 24 workers), or null
 *  with no preset or mix: profile.json's realised assignment. */
export function assignmentOf(given: Record<string, string>): Record<string, string> | null {
  const preset = (given.MC_CHARACTER_PRESET ?? '').trim().toLowerCase();
  const mixText = (given.MC_CHARACTER_MIX ?? '').trim().toLowerCase();
  const names = ['Mayor', ...Array.from({ length: 24 }, (_, i) => workerName(i + 1))];
  if (preset) return Object.fromEntries(names.map((n) => [n, preset]));
  if (!mixText) return null;
  const mix = parseMix(mixText, { ...BUILT_IN, ...parseArchetypes(given.MC_CHARACTER_ARCHETYPES ?? '') });
  const workers = assignMix(mix.shares, 24, (given.MC_CHARACTER_SEED ?? 'mix').trim());
  return Object.fromEntries(names.map((n, i) => [n, i === 0 ? mixMayor(mix) : workers[i - 1]]));
}
