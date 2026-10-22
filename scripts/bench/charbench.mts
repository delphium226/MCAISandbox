/**
 * charbench (character v2, spec 13 step 4, and the user's temperature bench): G2a's real chooser prompts rebuilt with
 * character v2's lines (identity with HEXACO words, values, needs, mood) and HEXACO weights' tags, asked of the real model.
 *
 *  L. Lines: each case asked full and with one line removed (identity, values, needs, mood), N_L samples each at 0.4:
 *     how often the modal pick changes, and the share picking the option the member's character weighs most.
 *  T. Temperature (the user's): the full prompt at MC_TEMPERATURE 0.4 and 1.0, N_T samples each: valid replies, distinct
 *     picks per case (spread within a member), trait-to-choice agreement (the share picking the most-weighed option, and
 *     its rank), say-do agreement (with acts offered: the line said shares a content word with the pick).
 *  S. Spread across members: the same menu with 5 different members' characters, at 0.4 and 1.0, N_S samples each: distinct
 *     modal picks across the 5 (identifiability's seed).
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/charbench.mts [CHOICES.jsonl ACTS.jsonl]  (default G2a)
 * Env: CASES (12), N_L (5), N_T (10), N_S (3), CONC (2), MODEL, DRY=1, PARTS (LTS).
 * Writes runs/2026-10-22/character/bench/charbench-<timestamp>.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChoiceMenu, ChoiceOption } from '../../server/src/world';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'charbench-'));
process.env.MC_MEMORY = 'on';
process.env.MCAI_SOCIAL = 'on';
process.env.MC_ACTS = 'on';
process.env.MCAI_ACTS_LOG = path.join(dir, 'acts.jsonl');
const ch = await import('../../server/src/character');
const acts = await import('../../server/src/acts');
const mem = await import('../../server/src/memory');
const { buildPrompt, shuffled, parseChoice } = await import('../../server/src/choose');
const { callModel, parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');

const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL)!;
const CONC = Math.max(1, Number(process.env.CONC) || 2), DRY = !!process.env.DRY, PARTS = (process.env.PARTS ?? 'LTS').toUpperCase();
const CASES = Number(process.env.CASES ?? 12), N_L = Number(process.env.N_L ?? 5), N_T = Number(process.env.N_T ?? 10), N_S = Number(process.env.N_S ?? 3);
const choicesFile = process.argv[2] ?? path.join(ROOT, 'runs/2026-10-21/g2-social/g2run/G2a.choices.jsonl');
type Rec = Record<string, any>;
const lines = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec);
const V = 'Bench';
mem.initMemory(null);
ch.setCharacterSettings({ hexaco: true, values: true, gauges: true, mood: true, affinity: true, identity: true });
ch.initCharacter(null);

const KINDS = ['explore', 'activity', 'light', 'furnish', 'works', 'start', 'iron', 'gather', 'make', 'farm', 'slot', 'pen', 'penwork', 'annex', 'cake', 'initiate', 'help', 'grow', 'own', 'innovate'];
const bases = lines(choicesFile).filter((r) => r.type === 'choice' && r.source === 'model' && r.ctx && (r.options ?? []).filter((o: Rec) => typeof o.shown === 'number').length >= 3);
const step = Math.max(1, Math.floor(bases.length / CASES));
const cases = bases.filter((_, i) => i % step === 0).slice(0, CASES);

/** A menu for `member` from a recorded decision: HEXACO weights as tw (the prompt's tags), and character lines. */
function build(r: Rec, member: string, drop: string | null, now: number, withActs: boolean) {
  const hw = ch.hexacoWeights(member, KINDS);
  const options = (r.options as Rec[]).filter((o) => typeof o.shown === 'number').map((o) => ({ ...o, tw: hw[o.kind] ?? 1, gw: undefined, nw: undefined, ww: undefined }) as unknown as ChoiceOption);
  // (a tired member in a fairly good mood: Ben kept a promise, its work stands)
  const identity = ch.identityLine(member, { goal: ch.goalFromValues(member) });
  const values = ch.valuesLine(member);
  const needs = 'You are tired (energy 30%); you can rest at home at night.';
  const mood = `You feel fairly good (+8): a member kept a promise to you; your work was built.`;
  const char = [drop === 'values' ? '' : values, drop === 'needs' ? '' : needs, drop === 'mood' ? '' : mood].filter(Boolean).join(' ');
  const ctx = { ...r.ctx, persona: drop === 'identity' ? '' : identity, character: char, pattern: undefined, wants: undefined, goal: undefined,
    ...(withActs ? { acts: 'You may add one act to this choice when another member could help you or you could help one: request, offer, accept or decline, release, report. You may also say one short line aloud to those near you (`say`), about your choice or your act.' } : {}) };
  const menu = { agent: member, village: V, t: now, options, guarded: [], reasons: {}, ctx } as unknown as ChoiceMenu;
  const best = [...options].sort((a, b) => (b.tw ?? 1) - (a.tw ?? 1))[0];
  return { menu, options, best };
}

async function ask(menu: ChoiceMenu, options: ChoiceOption[], seed: string, temp: number) {
  const shown = shuffled(options, seed);
  const p = buildPrompt(menu, shown);
  if (DRY) return { dry: true, chars: p.user.length };
  process.env.MC_TEMPERATURE = String(temp);
  try {
    const r = await callModel({ spec, system: p.system, user: p.user, tools: p.tools as never, level: REASONING.choose, agent: menu.agent, kind: 'choose', priority: 'decision', maxWaitMs: 120000, fallbackMs: 120000 });
    const c = parseChoice(r.reply, shown);
    const call = r.reply.calls.find((x) => x.name === 'choose') ?? r.reply.calls[0];
    const f = acts.actFields(call?.input);
    return { valid: !('invalid' in c), choice: 'invalid' in c ? null : c.id, say: f.say ?? null };
  } catch (e) {
    return { valid: false, choice: null, error: String((e as Error).message).slice(0, 120) };
  }
}
async function pool<T>(jobs: Array<() => Promise<T>>): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (i < jobs.length) {
      const k = i++;
      out[k] = await jobs[k]();
    }
  }));
  return out;
}
const mode = (xs: Array<string | null>) => {
  const c = new Map<string, number>();
  for (const x of xs) if (x) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const result: Rec = { model: MODEL, at: new Date().toISOString(), cases: cases.length };

if (PARTS.includes('L')) {
  const out: Rec[] = [];
  for (const drop of [null, 'identity', 'values', 'needs', 'mood']) {
    const jobs = cases.flatMap((r, ci) => Array.from({ length: N_L }, (_, s) => async () => {
      const b = build(r, r.agent, drop, r.t, false);
      const a = await ask(b.menu, b.options, `${r.seed}|L${s}`, 0.4);
      return { ci, drop, ...a, best: b.best.id };
    }));
    out.push(...(await pool(jobs)));
  }
  const full = new Map(cases.map((_, ci) => [ci, mode(out.filter((x) => x.ci === ci && x.drop === null).map((x) => x.choice))]));
  const sum: Rec = {};
  for (const drop of [null, 'identity', 'values', 'needs', 'mood']) {
    const xs = out.filter((x) => x.drop === drop && x.valid);
    const changed = cases.filter((_, ci) => drop !== null && mode(out.filter((x) => x.ci === ci && x.drop === drop).map((x) => x.choice)) !== full.get(ci)).length;
    sum[drop ?? 'full'] = { valid: xs.length, bestShare: Math.round((xs.filter((x) => x.choice === x.best).length / (xs.length || 1)) * 100) / 100, modalChanged: drop === null ? null : `${changed}/${cases.length}` };
  }
  result.L = out;
  result.summaryL = sum;
  console.log('L', JSON.stringify(sum));
}

if (PARTS.includes('T')) {
  const out: Rec[] = [];
  for (const temp of [0.4, 1.0]) {
    const jobs = cases.flatMap((r, ci) => Array.from({ length: N_T }, (_, s) => async () => {
      const b = build(r, r.agent, null, r.t, true);
      const a = await ask(b.menu, b.options, `${r.seed}|T${s}`, temp);
      const rank = [...b.options].sort((x, y) => (y.tw ?? 1) - (x.tw ?? 1)).findIndex((o) => o.id === a.choice) + 1;
      const name = b.options.find((o) => o.id === a.choice)?.name ?? '';
      const sayOk = a.say ? [...mem.contentWords(a.say)].some((w) => mem.contentWords(name).has(w)) : null;
      return { ci, temp, ...a, best: b.best.id, rank, n: b.options.length, sayOk };
    }));
    out.push(...(await pool(jobs)));
  }
  const sum: Rec = {};
  for (const temp of [0.4, 1.0]) {
    const xs = out.filter((x) => x.temp === temp);
    const v = xs.filter((x) => x.valid);
    const spread = cases.map((_, ci) => new Set(v.filter((x) => x.ci === ci).map((x) => x.choice)).size);
    const says = v.filter((x) => x.say);
    sum[temp] = {
      valid: `${v.length}/${xs.length}`, distinctPerCase: Math.round((spread.reduce((a, b) => a + b, 0) / spread.length) * 100) / 100,
      bestShare: Math.round((v.filter((x) => x.choice === x.best).length / (v.length || 1)) * 100) / 100,
      meanRelRank: Math.round((v.reduce((s, x) => s + (x.rank - 1) / Math.max(1, x.n - 1), 0) / (v.length || 1)) * 100) / 100,
      sayRate: `${says.length}/${v.length}`, sayDo: says.length ? Math.round((says.filter((x) => x.sayOk).length / says.length) * 100) / 100 : null,
    };
  }
  result.T = out;
  result.summaryT = sum;
  console.log('T', JSON.stringify(sum));
}

if (PARTS.includes('S')) {
  const members = ['Ada', 'Ben', 'Clara', 'Dev', 'Elena'];
  const menus = cases.slice(0, 6);
  const out: Rec[] = [];
  for (const temp of [0.4, 1.0]) {
    const jobs = menus.flatMap((r, ci) => members.flatMap((m) => Array.from({ length: N_S }, (_, s) => async () => {
      const b = build(r, m, null, r.t, false);
      const a = await ask(b.menu, b.options, `${r.seed}|S${m}${s}`, temp);
      return { ci, temp, member: m, ...a };
    })));
    out.push(...(await pool(jobs)));
  }
  const sum: Rec = {};
  for (const temp of [0.4, 1.0]) {
    const distinct = menus.map((_, ci) => new Set(members.map((m) => mode(out.filter((x) => x.temp === temp && x.ci === ci && x.member === m).map((x) => x.choice)))).size);
    sum[temp] = { distinctModalAcross5: Math.round((distinct.reduce((a, b) => a + b, 0) / distinct.length) * 100) / 100, perMenu: distinct };
  }
  result.S = out;
  result.summaryS = sum;
  console.log('S', JSON.stringify(sum));
}
delete process.env.MC_TEMPERATURE;
const file = path.join(ROOT, 'runs/2026-10-22/character/bench', `charbench-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(result, null, 1));
console.log(`written ${file}`);
process.exit(0);
