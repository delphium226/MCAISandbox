// The start screen's state (spec runs/2026-10-30/startscreen/spec.md 1, 9.1): a profile made into what the panes edit and
// back, the goals table, and the settings view. Shared by the page and scripts/checks/profile_roundtrip.mts, so the
// round trip is checked on the page's own functions. No DOM here.

/** The keys the panes edit; every other key of a profile rides along unchanged. */
export const FIELDS = ['name', 'describe', 'kind', 'site', 'checkpoint', 'preset', 'workers', 'fast', 'objective', 'minutes', 'after', 'settings', 'goal_mode', 'goals'];
export const GOAL_MAX = 120;

const copy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

/** A profile to the screen's state: the edited fields (defaults filled for the panes) and the rest kept as given. */
export function toState(p) {
  const s = { given: Object.keys(p), rest: {} };
  for (const [k, v] of Object.entries(p)) if (!FIELDS.includes(k)) s.rest[k] = copy(v);
  s.name = p.name ?? '';
  s.describe = p.describe ?? '';
  s.kind = p.kind ?? 'staged';
  s.site = p.site ?? 'minevale3';
  s.checkpoint = p.checkpoint ?? '';
  s.preset = p.preset ?? (s.kind === 'model' ? 'watch' : 's0');
  s.workers = p.workers ?? 2;
  s.fast = p.fast;
  s.objective = p.objective ?? '';
  s.minutes = p.minutes;
  s.after = p.after;
  s.settings = Object.fromEntries(Object.entries(p.settings ?? {}).map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v)]));
  s.settingsTyped = copy(p.settings ?? {});
  s.goal_mode = p.goal_mode ?? 'drawn';
  s.goals = copy(p.goals ?? {});
  return s;
}

/** The screen's state back to a profile: the keys it was given (and any the panes set), in the profile's order. */
export function fromState(s) {
  const out = {};
  const set = (k, v) => {
    if (v === undefined || v === null || (v === '' && !s.given.includes(k))) return;
    out[k] = v;
  };
  const settings = {};
  for (const [k, v] of Object.entries(s.settings)) {
    // (a value as the file gave it, a boolean or number kept when unchanged)
    const was = s.settingsTyped?.[k];
    settings[k] = was !== undefined && String(typeof was === 'boolean' ? (was ? 'on' : 'off') : was) === v ? was : v;
  }
  const fields = {
    name: s.name, describe: s.describe, kind: s.kind, site: s.site, checkpoint: s.checkpoint || undefined, preset: s.preset,
    workers: s.workers, fast: s.fast, objective: s.objective, minutes: s.minutes, after: s.after, settings,
    goal_mode: s.goal_mode === 'drawn' && !s.given.includes('goal_mode') ? undefined : s.goal_mode,
    goals: s.goal_mode === 'drawn' && !s.given.includes('goals') ? undefined : s.goals,
  };
  const defaultsUnlessGiven = { site: 'minevale3', preset: s.kind === 'model' ? 'watch' : 's0', workers: 2 };
  const order = [...s.given, ...FIELDS.filter((k) => !s.given.includes(k))];
  for (const k of order) {
    if (k in s.rest) out[k] = copy(s.rest[k]);
    else if (k in fields) {
      const v = fields[k];
      if (!s.given.includes(k) && (defaultsUnlessGiven[k] === v || (k === 'settings' && !Object.keys(v).length) || (k === 'objective' && !v) || (k === 'describe' && !v))) continue;
      set(k, v);
    }
  }
  return out;
}

/** The run's members: the Mayor and the pool's first `workers` names. */
export const members = (names, workers) => names.slice(0, 1 + Math.max(0, Math.min(24, workers)));

/** The goals as the table shows them, one row a member: its text, how it came, its mapping. */
export function goalRows(s, names) {
  const g = s.goals ?? {};
  return members(names, s.workers).map((n) => {
    const own = g.members?.[n];
    const v = s.goal_mode === 'village' && !(own && own.text) ? g.village : null;
    const x = own && own.text ? own : v;
    return { name: n, text: x?.text ?? '', by: own && own.text ? own.by ?? 'user' : v ? 'village' : 'drawn', measure: x?.measure ?? null,
      pursuits: x?.pursuits ?? [], unmatched: x?.unmatched ?? [], mapped: !!x?.mappedBy };
  });
}

/** Set a member's own goal text (blank: drawn, or the village's in village mode); a changed text loses its mapping. */
export function setMemberGoal(s, name, text, by = 'user') {
  s.goals.members ??= {};
  const t = text.slice(0, GOAL_MAX);
  if (!t.trim()) delete s.goals.members[name];
  else if (s.goals.members[name]?.text !== t) s.goals.members[name] = { text: t, by };
}

/** Set the village goal text (a changed text loses its mapping). */
export function setVillageGoal(s, text) {
  const t = text.slice(0, GOAL_MAX);
  if (!t.trim()) delete s.goals.village;
  else if (s.goals.village?.text !== t) s.goals.village = { text: t, by: 'user' };
}

/** Every distinct text not mapped yet. */
export function unmappedTexts(s) {
  const all = [s.goal_mode === 'village' ? s.goals.village : null, ...Object.values(s.goals.members ?? {})].filter((x) => x?.text);
  return [...new Set(all.filter((x) => !x.mappedBy).map((x) => x.text.trim()))];
}

/** Mapping results put on every goal with that text. */
export function applyMapping(s, results) {
  for (const x of [s.goals.village, ...Object.values(s.goals.members ?? {})]) {
    const r = x?.text && results[x.text.trim()];
    if (r?.spec) Object.assign(x, { measure: r.spec.measure, pursuits: r.spec.pursuits, unmatched: r.spec.unmatched, mappedBy: 'model', model: r.spec.model });
  }
}

/** The settings rows to show: changed ones (or all, or live only), matching the find text. */
export function settingRows(registry, s, view = 'changed', find = '') {
  const q = find.trim().toLowerCase();
  const requiredBy = {};
  for (const x of registry.settings) for (const r of x.requires ?? []) (requiredBy[r] ??= []).push(x.name);
  return registry.settings
    .filter((x) => (view === 'all' || (view === 'live' ? x.live : x.name in s.settings)) && (!q || x.name.toLowerCase().includes(q) || x.describe.toLowerCase().includes(q)))
    .map((x) => ({ ...x, value: s.settings[x.name] ?? x.default, changed: x.name in s.settings && s.settings[x.name] !== x.default, requiredBy: requiredBy[x.name] ?? [] }));
}
