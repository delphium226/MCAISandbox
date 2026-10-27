/**
 * resultsbench (#164, MC_RULE_RESULTS and MC_RULE_WORDS): the night's law field on train 7's own night prompts, the council
 * paragraph rebuilt in three conditions, the rest of the prompt and the tool as the run had them:
 *   off      society.ts lawLines with both flags off (the recorded paragraph, checked word for word);
 *   results  each rule in force with its id and result in code's counts, as ruleResults writes them from the run's own
 *            ledger (compliance by day for duties and contributions, "words only" for norms, the levy's rate), and the
 *            repeal in the invitation;
 *   words    the same, and the invitation says a custom in words is not enforced or counted.
 * Nights are those with a rule in force whose recorded reply wrote a law (so most samples write one). Measures per
 * condition: nights with a law read, the typed share of laws (not a norm), repeals, valid, and by type.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/resultsbench.mts [RUN ...]   (runs: train 7's A B C by default)
 * Env: N (samples a prompt and condition, default 4), PROMPTS (a run, default 6), CONC (3), MODEL, DRY=1, CONDS
 *   (default "off,results,words"), RESCORE=<an earlier json>. Writes runs/2026-10-27/i164/resultsbench-<timestamp>.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.MC_MEMORY = 'on';
process.env.MC_CLOCK = 'on';
process.env.MC_RULES = 'on';
process.env.MC_COUNCIL = 'on';
process.env.MCAI_ACTS_LOG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'resultsbench-')), 'acts.jsonl');
const soc = await import('../../server/src/society');
const rules = await import('../../server/src/rules');
const { callModel, parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');

const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL)!;
const N = Number(process.env.N ?? 4), PROMPTS = Number(process.env.PROMPTS ?? 6), CONC = Math.max(1, Number(process.env.CONC) || 3), DRY = !!process.env.DRY;
const CONDS = (process.env.CONDS ?? 'off,results,words').split(',');
const RUNS = process.argv.slice(2).length ? process.argv.slice(2) : ['A', 'B', 'C'];
const T = path.join(ROOT, 'runs/2026-10-27/train7/T');
type Rec = Record<string, any>;
const jsonl = (f: string): Rec[] => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** The council paragraph as lawLines writes it: from the rules line (or "no rules yet") to the invitation's end. */
const PARA = /(?:Village rules in force: [^\n]*|The village has no rules yet\.)\n(?:Rules members proposed[^\n]*\n(?:- \[l\d+\][^\n]*\n)*)?You may propose one village rule \(`law`[^\n]*Most nights there is none\./;

interface Night { run: string; agent: string; user: string; system: string; day: number; inForce: string[]; results: string[]; open: Array<{ id: string; text: string; backers: string[] }> }
const nights: Night[] = [];
for (const run of RUNS) {
  const calls = jsonl(path.join(T, `${run}.calls.jsonl`));
  const acts = jsonl(path.join(T, `${run}.acts.jsonl`));
  const systems = new Map(calls.filter((r) => r.type === 'system').map((r) => [r.hash, r.system]));
  // (the village day at a time: the latest act with a day at or before it)
  const dayed = acts.filter((a) => Number.isFinite(a.t) && Number.isFinite(a.day)).sort((a, b) => a.t - b.t);
  const dayAt = (t: number) => { let d = 0; for (const a of dayed) { if (a.t > t) break; d = Math.max(d, a.day); } return d; };
  const enacted = acts.filter((a) => a.type === 'rule' && a.op === 'enacted');
  const comp = acts.filter((a) => a.type === 'compliance' && a.op === 'day');
  // (the result as rules.ruleResult words it, from the ledger: met by X of N over at most the last 3 days since it passed)
  const result = (e: Rec, day: number) => {
    if (e.rule === 'norm') return 'words only: not enforced or counted';
    if (e.rule === 'levy') return `in force at ${e.params?.rate ?? /(\d+)%/.exec(e.text)?.[1]}%`;
    if (e.rule === 'duty' || e.rule === 'contribute') {
      const since = dayAt(e.t);
      const per = [day - 3, day - 2, day - 1].filter((d) => d > since && d >= 1).map((d) => comp.filter((c) => c.rule === e.id && c.day === d))
        .filter((cs) => cs.length).map((cs) => `${cs.filter((c) => c.met).length} of ${cs.length}`);
      return per.length ? `met by ${per.join(', then ')} members a day` : 'no full day yet';
    }
    return 'enforced by code (options that break it leave the menu)';
  };
  const lawNights = calls.filter((r) => r.kind === 'reflect' && /Village rules in force:/.test(r.user) && PARA.test(r.user)).filter((r) => {
    const c = r.reply?.calls?.[0]?.input;
    const o = typeof c === 'string' ? (() => { try { return JSON.parse(c); } catch { return {}; } })() : c ?? {};
    return !!rules.lawFrom(o.law ?? o.rule);
  });
  const step = Math.max(1, Math.floor(lawNights.length / PROMPTS));
  for (const r of lawNights.filter((_, i) => i % step === 0).slice(0, PROMPTS)) {
    const t = Date.parse(r.at) || Number(r.at);
    const day = dayAt(t);
    const line = /Village rules in force: ([^\n]*)/.exec(r.user)![1];
    const inForceActs = enacted.filter((e) => e.t <= t && line.includes(String(e.text).slice(0, 60)))
      .filter((e, _, all) => !all.some((x) => x !== e && x.t > e.t && x.rule === e.rule && x.rule === 'levy'))
      .sort((a, b) => line.indexOf(String(a.text).slice(0, 60)) - line.indexOf(String(b.text).slice(0, 60)));
    const open = [...r.user.matchAll(/^- \[(l\d+)\] (.*) \(backed by (\d+)\)$/gm)].map((m) => ({ id: m[1], text: m[2].replace(/^./, (c) => c.toLowerCase()), backers: Array.from({ length: Number(m[3]) }, (_, i) => `b${i}`) }));
    nights.push({
      run, agent: r.agent, user: r.user, system: systems.get(r.system) ?? '', day,
      inForce: inForceActs.map((e) => e.text), results: inForceActs.map((e) => `[${e.id}] ${e.text} (${result(e, day)})`), open,
    });
  }
}

function rebuild(n: Night, cond: string): { user: string; tools: ReturnType<typeof soc.reflectTools> } {
  rules.setRulesSettings({ results: cond !== 'off', words: cond === 'words' });
  const para = soc.lawLines(cond === 'off' ? n.inForce : n.results, n.open);
  const user = n.user.replace(PARA, () => para);
  const live = [...user.matchAll(/^- \[(n\d+), day \d+\]/gm)].map((m) => m[1]);
  const block = /Members you dealt with[^\n]*\n((?:- [^\n]*\n?)+)/.exec(user)?.[1] ?? '';
  const people = [...block.matchAll(/^- ([A-Z][a-zA-Z]+):/gm)].map((m) => m[1]);
  const pline = /You may propose one improvement to the game[^\n]*(\nOthers' proposals[^\n]*)?/.exec(user);
  const propose = pline ? [...(pline[1] ?? '').matchAll(/\[(p\d+)\]/g)].map((m) => m[1]).slice(0, 3) : null;
  return { user, tools: soc.reflectTools({ live, people, openLaws: n.open.map((l) => l.id), propose }) };
}

// (the off condition must be the recorded paragraph, word for word, so the comparison is only the flags)
let same = 0;
for (const n of nights) if (rebuild(n, 'off').user === n.user) same++;
console.log(`resultsbench: ${nights.length} nights (${RUNS.join(', ')}), off rebuilt word for word on ${same}`);
if (DRY) {
  for (const n of nights) console.log(`  ${n.run} d${n.day} ${n.agent}: ${n.results.join(' | ').slice(0, 260)}`);
  const n = nights.find((x) => x.results.some((r) => /met by/.test(r))) ?? nights[0];
  console.log(PARA.exec(rebuild(n, 'words').user)?.[0]);
  process.exit(0);
}

interface Row { cond: string; night: number; agent: string; read: boolean; type?: string; valid?: boolean; of?: string; error?: string; raw?: unknown }
const score = (row: Row, law: unknown) => {
  rules.setRulesSettings({ results: true });
  const w = rules.lawFrom(law);
  row.read = !!w;
  if (w) {
    const rl = rules.readLaw(w);
    row.type = rl.type;
    row.valid = !rules.validate(rl.type, rl.params) || rl.type === 'repeal';
    if (rl.type === 'repeal') row.of = String(rl.params.of || '(words)');
  }
  return row;
};
let rows: Row[];
if (process.env.RESCORE) {
  rows = (JSON.parse(fs.readFileSync(process.env.RESCORE, 'utf8')).rows as Row[]).map((r) => (r.error ? r : score({ ...r }, (r.raw as { law?: unknown })?.law)));
} else {
  const jobs: Array<() => Promise<Row>> = [];
  for (const cond of CONDS) nights.forEach((n, ni) => {
    for (let k = 0; k < N; k++) jobs.push(async () => {
      const { user, tools } = rebuild(n, cond);
      const row: Row = { cond, night: ni, agent: n.agent, read: false };
      try {
        const res = await callModel({ spec, system: n.system, user, tools, level: REASONING.reflect, agent: `${n.agent}#${cond}${k}`, kind: 'reflect', priority: 'reflection' });
        const c = res.reply.calls.find((x) => x.name === 'reflect') ?? res.reply.calls[0];
        let inp = c?.input as unknown;
        if (typeof inp === 'string') try { inp = JSON.parse(inp); } catch { inp = {}; }
        const o = (inp ?? {}) as Record<string, unknown>;
        row.raw = { law: o.law ?? o.rule, back_laws: o.back_laws };
        score(row, o.law ?? o.rule);
      } catch (e) {
        row.error = String((e as Error)?.message ?? e).slice(0, 160);
      }
      return row;
    });
  });
  console.log(`${jobs.length} calls on ${MODEL}`);
  rows = new Array(jobs.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (next < jobs.length) {
      const i = next++;
      rows[i] = await jobs[i]();
      if (++done % 30 === 0) console.log(`  ${done}/${jobs.length}`);
    }
  }));
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const summary: Record<string, unknown> = {};
for (const cond of CONDS) {
  const rs = rows.filter((r) => r.cond === cond && !r.error);
  const read = rs.filter((r) => r.read);
  const byType: Record<string, number> = {};
  for (const r of read) byType[r.type!] = (byType[r.type!] ?? 0) + 1;
  const typed = read.filter((r) => r.type !== 'norm' && r.type !== 'repeal').length, rep = read.filter((r) => r.type === 'repeal');
  const s = { n: rs.length, errors: rows.filter((r) => r.cond === cond && r.error).length, laws: read.length, lawShare: pct(read.length, rs.length), typed: pct(typed, read.length), typedOrRepeal: pct(typed + rep.length, read.length), repeals: rep.map((r) => r.of), valid: pct(read.filter((r) => r.valid).length, read.length), byType };
  summary[cond] = s;
  console.log(`${cond.padEnd(8)} n ${s.n} (err ${s.errors}): laws ${s.laws} (${s.lawShare} of nights); typed ${s.typed} of laws, with repeals ${s.typedOrRepeal}; repeals ${rep.length} ${JSON.stringify(s.repeals)}; valid ${s.valid}; ${JSON.stringify(byType)}`);
}
const out = path.join(ROOT, 'runs/2026-10-27/i164', `resultsbench-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ model: MODEL, runs: RUNS, N, nights: nights.map((n) => ({ run: n.run, agent: n.agent, day: n.day, results: n.results })), summary, rows }, null, 1));
console.log(`wrote ${out}`);
process.exit(0);
