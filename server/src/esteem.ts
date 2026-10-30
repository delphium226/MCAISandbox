/**
 * Social motives (the wants spec 3 with 9.2; MC_ESTEEM, MC_ESTEEM_RIVALS, MC_TITLES, all on): code keeps, from facts the
 * world already logs, what each member saw and was told of the others: esteem per (viewer, other), debts, the village's
 * records and their titles, and who the village relies on for each product family. The prompt gets one line, the
 * strongest (owe, rival, admire); options that repay or follow the admired member's way are tagged and weighed by the
 * world. A member only knows what it saw or heard: esteem counts only members it met in the last 2 village days.
 * World-free: the world calls the note* functions at chore ends and builds the tags.
 */
import type { Temperament } from './temperament';
import type { Template } from './pursuits';
import { clockOf, socialOf, touchMemory, villageSocialOf } from './memory';
import { profile } from './social';
import { rawSetting } from './settings';

/** MC_ESTEEM (on): read here too, for the hooks in acts.ts (pursuits.ts' WANTS.esteem is the same setting). */
export const ESTEEM_ON = !/^(off|0|false|no)$/i.test(rawSetting('MC_ESTEEM') ?? 'on');

/** Esteem's points (spec 3.1). */
export const ESTEEM = { built: 3, pursuit: 4, kept: 2, help: 2, record: 2, broke: -3, decay: 0.9, admire: 6 };
/** Debts last 3 village days. */
export const DEBT_DAYS = 3;

const dayOf = (village: string, now: number) => clockOf(village, now)?.day ?? 0;

interface EsteemRow { s: number; day: number; why: string[] }
const esteemOf = (village: string, viewer: string) => ((socialOf(village, viewer) as { esteem?: Record<string, EsteemRow> }).esteem ??= {});

/** Whether the viewer met the other in the last 2 village days (its profile's lastMet). */
function met(village: string, viewer: string, other: string, now: number): boolean {
  const p = profile(village, viewer, other);
  const c = clockOf(village, now);
  return !!p && !!c && now - p.lastMet <= 2 * c.dayMs;
}

/** Points to the viewer's esteem of the other, decayed to today first; `why` a short phrase ("built the well"). */
export function addEsteem(village: string, viewer: string, other: string, pts: number, why: string, now: number): void {
  if (viewer === other) return;
  const e = esteemOf(village, viewer);
  const day = dayOf(village, now);
  const r = (e[other] ??= { s: 0, day, why: [] });
  r.s = r.s * ESTEEM.decay ** Math.max(0, day - r.day) + pts;
  r.day = day;
  if (pts > 0) r.why = [why, ...r.why.filter((w) => w !== why)].slice(0, 3);
  touchMemory();
}

/** A work of `by` built: esteem from every member present that met it lately. */
export function noteBuilt(village: string, by: string, members: string[], what: string, now: number): void {
  for (const m of members) if (m !== by && met(village, m, by, now)) addEsteem(village, m, by, ESTEEM.built, `built ${what}`, now);
}
/** A pursuit of `by` done: the members that met it lately hear of it. */
export function notePursuitDone(village: string, by: string, members: string[], what: string, now: number): void {
  for (const m of members) if (m !== by && met(village, m, by, now)) addEsteem(village, m, by, ESTEEM.pursuit, `finished ${what}`, now);
}
/** `helper` helped `owner`'s work: esteem, and `owner` owes `helper`. */
export function noteHelped(village: string, helper: string, owner: string, what: string, now: number): void {
  if (helper === owner) return;
  addEsteem(village, owner, helper, ESTEEM.help, `helped your ${what}`, now);
  // (a help back closes a debt first: `helper` repays `owner`)
  if (repay(village, helper, owner, now)) return;
  noteDebt(village, owner, helper, `helped your ${what}`, now);
}
/** A promise to `promisee` kept or broken by `promiser`. */
export function noteKeptTo(village: string, promisee: string, promiser: string, kept: boolean, now: number): void {
  addEsteem(village, promisee, promiser, kept ? ESTEEM.kept : ESTEEM.broke, kept ? 'kept a promise to you' : 'broke a promise to you', now);
  // (a kept promise repays the promiser's own debt to the promisee first; else the promisee owes it a favour)
  if (kept && !repay(village, promiser, promisee, now)) noteDebt(village, promisee, promiser, 'kept a promise to you', now);
}

/** The admired member: the viewer's top esteem over the threshold, met in the last 2 days. */
export function admiredOf(village: string, viewer: string, now: number): { name: string; s: number; why: string[] } | null {
  const e = esteemOf(village, viewer);
  const day = dayOf(village, now);
  let best: { name: string; s: number; why: string[] } | null = null;
  for (const [name, r] of Object.entries(e)) {
    const s = r.s * ESTEEM.decay ** Math.max(0, day - r.day);
    if (s >= ESTEEM.admire && (!best || s > best.s) && met(village, viewer, name, now)) best = { name, s, why: r.why };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Distinctive acts (what imitation copies, spec 3.1 with 9.2.4: used output, initiatives, pursuit steps; never a custom)
// ---------------------------------------------------------------------------------------------

interface VillageWants { acts?: Record<string, Array<{ option: string; name: string; at: number }>>; records?: Record<string, { holder: string; value: number; at: number }>; makes?: Record<string, Record<string, Record<string, number>>> }
const vw = (village: string, now: number) => villageSocialOf(village, now) as VillageWants;

export function noteDistinct(village: string, member: string, option: string, name: string, now: number): void {
  const a = (vw(village, now).acts ??= {});
  a[member] = [{ option, name, at: now }, ...(a[member] ?? []).filter((x) => x.option !== option)].slice(0, 5);
  touchMemory();
}
export const distinctOf = (village: string, member: string, now: number) => vw(village, now).acts?.[member] ?? [];

/** Imitation's weight: 1.2 at middling sociability, 1.0..1.3 by it (the user's 9.7.3). */
export const imitationWeight = (t: Temperament) => Math.round((1.0 + 0.15 * (Math.max(-1, Math.min(1, t.sociability ?? 0)) + 1)) * 100) / 100;
/** A repayment's weight: 1.2, more with care. */
export const repayWeight = (t: Temperament) => Math.round((1.2 + 0.1 * Math.max(0, Math.min(1, t.care ?? 0))) * 100) / 100;

// ---------------------------------------------------------------------------------------------
// Debts (spec 3.3)
// ---------------------------------------------------------------------------------------------

interface Debt { n: number; what: string[]; day: number }
const debtsOf = (village: string, debtor: string) => ((socialOf(village, debtor) as { debts?: Record<string, Debt> }).debts ??= {});

export function noteDebt(village: string, debtor: string, creditor: string, what: string, now: number): void {
  if (debtor === creditor) return;
  const d = debtsOf(village, debtor);
  const r = (d[creditor] ??= { n: 0, what: [], day: dayOf(village, now) });
  r.n++;
  r.day = dayOf(village, now);
  r.what = [what, ...r.what.filter((w) => w !== what)].slice(0, 2);
  touchMemory();
}
/** `debtor` did something for `creditor`: one favour repaid (true if one was owed). */
export function repay(village: string, debtor: string, creditor: string, now: number): boolean {
  const d = debtsOf(village, debtor);
  const r = d[creditor];
  if (!r || dayOf(village, now) - r.day >= DEBT_DAYS) return false;
  r.n--;
  if (r.n <= 0) delete d[creditor];
  touchMemory();
  return true;
}
/** Open debts, the largest first. */
export function owed(village: string, debtor: string, now: number): Array<{ to: string; n: number; what: string[] }> {
  const day = dayOf(village, now);
  return Object.entries(debtsOf(village, debtor)).filter(([, r]) => day - r.day < DEBT_DAYS && r.n > 0).map(([to, r]) => ({ to, n: r.n, what: r.what })).sort((a, b) => b.n - a.n || (a.to < b.to ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// Records and titles (spec 3.2; MC_TITLES)
// ---------------------------------------------------------------------------------------------

/** Each pursuit template's record words and floor. */
const RECORD: Record<Template, { title: string; floor: number; unit: string }> = {
  craft: { title: 'the village\'s master of', floor: 8, unit: 'made' },
  supply: { title: 'the village\'s provider of', floor: 8, unit: 'brought in' },
  works: { title: 'the village\'s builder', floor: 2, unit: 'works built' },
  light: { title: 'the lamplighter', floor: 16, unit: 'lights' },
  explore: { title: 'the explorer', floor: 2, unit: 'far points mapped' },
  house: { title: 'keeper of the finest house', floor: 4, unit: 'things in the house' },
  garden: { title: 'keeper of the finest garden', floor: 3, unit: 'works and touches' },
  research: { title: 'the village\'s inventor of', floor: 3, unit: 'experiments' },
  wealth: { title: 'the richest trader', floor: 10, unit: 'emeralds' },
  standing: { title: 'the one everyone counts on', floor: 4, unit: 'helps' },
};
export const recordKey = (t: Template, param?: string) => (param ? `${t}:${param}` : t);
const words = (p?: string) => (p ?? '').replace(/^(make|activity:lib|innovate|iron):/, '').replace(/_/g, ' ');
export function titleWords(key: string): string {
  const [t, ...rest] = key.split(':');
  const r = RECORD[t as Template];
  if (!r) return key;
  const p = rest.join(':');
  return /of$/.test(r.title) ? `${r.title} ${words(p) || 'its craft'}` : r.title;
}

/** A member's value on a record; returns the news when it takes the title (over the floor, beating the holder). */
export function noteRecord(village: string, key: string, member: string, value: number, now: number): { text: string; from?: string } | null {
  const t = key.split(':')[0] as Template;
  const floor = RECORD[t]?.floor ?? Infinity;
  const recs = (vw(village, now).records ??= {});
  const r = recs[key];
  if (r && r.holder === member) {
    if (value > r.value) {
      r.value = value;
      touchMemory();
    }
    return null;
  }
  if (value < floor || (r && value <= r.value)) return null;
  recs[key] = { holder: member, value, at: now };
  touchMemory();
  return { text: `${member} is now ${titleWords(key)} (${value} ${RECORD[t].unit})${r ? `, ahead of ${r.holder}` : ''}`, ...(r ? { from: r.holder } : {}) };
}
/** The titles a member holds. */
export function titlesOf(village: string, member: string, now: number): string[] {
  return Object.entries(vw(village, now).records ?? {}).filter(([, r]) => r.holder === member).map(([k]) => titleWords(k));
}
export function recordOf(village: string, key: string, now: number): { holder: string; value: number } | undefined {
  return vw(village, now).records?.[key];
}

/** The rival line for a member whose temperament leans to it (pride above 0.3, the user's 9.7.2): the record's holder on
 *  its pursuit's record when ahead of it. */
export function rivalLine(village: string, member: string, key: string, mine: number, t: Temperament, now: number): string {
  if ((t.pride ?? 0) <= 0.3) return '';
  const r = recordOf(village, key, now);
  if (!r || r.holder === member || r.value <= mine) return '';
  const unit = RECORD[key.split(':')[0] as Template]?.unit ?? '';
  return `${r.holder} is ${titleWords(key)}: ${r.value} ${unit}, yours ${mine}.`;
}

// ---------------------------------------------------------------------------------------------
// Relied on (spec 3.4 with 9.2.5: replaces the role line at family grain)
// ---------------------------------------------------------------------------------------------

export function noteMake(village: string, member: string, fam: string, now: number): void {
  const day = String(dayOf(village, now));
  const m = (vw(village, now).makes ??= {});
  const d = (m[day] ??= {});
  const f = (d[fam] ??= {});
  f[member] = (f[member] ?? 0) + 1;
  for (const k of Object.keys(m)) if (Number(k) < Number(day) - 2) delete m[k];
  touchMemory();
}

/** "The village relies on you for torches: you made 6 of 10 ..." when the member made over 40% of a family's makes in the
 *  last 2 village days and the family's stock is under its keep; "Ada now makes most of the X" when another overtook it. */
export function reliedLine(village: string, member: string, now: number, short: (fam: string) => { stock: number; keep: number; words: string } | null): string {
  const day = dayOf(village, now);
  const m = vw(village, now).makes ?? {};
  const tot: Record<string, Record<string, number>> = {};
  for (const [k, d] of Object.entries(m)) {
    if (Number(k) < day - 1) continue;
    for (const [fam, by] of Object.entries(d)) for (const [who, n] of Object.entries(by)) ((tot[fam] ??= {})[who] = (tot[fam][who] ?? 0) + n);
  }
  let best: { fam: string; mine: number; all: number } | null = null;
  for (const [fam, by] of Object.entries(tot)) {
    const all = Object.values(by).reduce((t, n) => t + n, 0), mine = by[member] ?? 0;
    if (all >= 4 && mine / all > 0.4 && (!best || mine / all > best.mine / best.all)) best = { fam, mine, all };
  }
  if (best) {
    const s = short(best.fam);
    if (s && s.stock < s.keep) return `The village relies on you for ${s.words}: you made ${best.mine} of the last ${best.all}, and storage has ${s.stock} of the ${s.keep} it keeps.`;
  }
  // (overtaken: a family it led yesterday that another leads today)
  const y = m[String(day - 1)] ?? {}, t = m[String(day)] ?? {};
  for (const [fam, by] of Object.entries(y)) {
    const lead = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
    const now2 = Object.entries(t[fam] ?? {}).sort((a, b) => b[1] - a[1])[0];
    if (lead?.[0] === member && now2 && now2[0] !== member && now2[1] >= 3) return `${now2[0]} now makes most of the ${short(fam)?.words ?? fam.replace(/^make:/, '').replace(/_/g, ' ')}.`;
  }
  return '';
}

/** The one social line (spec 5: the strongest only): a debt, else a rival, else the admired member. */
export function esteemLine(village: string, member: string, now: number, rival: string): string {
  const d = owed(village, member, now)[0];
  if (d) return `You owe ${d.to}: ${d.to} ${d.what.join(' and ')}${d.n > 1 ? ` (${d.n} favours)` : ''}.`;
  if (rival) return rival;
  const a = admiredOf(village, member, now);
  if (a) return `You admire ${a.name}: ${a.why.join(', ')}.`;
  return '';
}
