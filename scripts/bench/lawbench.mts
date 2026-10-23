/**
 * lawbench (G3, #30): the night's law field on the real model, from a recorded run's own night prompts (Long1, 10-22: 275
 * nights, the law field in every one, no law kept). Each sampled prompt is asked in three conditions, the rest of the prompt
 * and the tool as the run had them (society.ts reflectTools from the prompt's notes, people and proposals):
 *   old    the prompt as recorded (Long1's law paragraph);
 *   new0   the council paragraph as now (society.ts lawLines), no open laws;
 *   new3   the same with 3 open laws to back (Long1's three most proposed rules) and the `back_laws` field.
 * Measures per condition: the share of nights with a law, the share Long1's reader kept (a `what` of 8 characters) and the
 * share read now (rules.ts lawFrom), typed (not a norm) and valid; in new3, nights that back (and the ids valid), laws
 * that would join a shown one (same target), and new laws. Also the intention and focus still given (no regression).
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/lawbench.mts [MODEL_CALLS.jsonl]
 * Env: N (samples a prompt, default 4), PROMPTS (default 10), CONC (3), MODEL, DRY=1, CONDS (default "old,new0,new3").
 * Writes runs/2026-10-23/g3-rules/bench/lawbench-<timestamp>.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.MC_MEMORY = 'on';
process.env.MC_CLOCK = 'on';
process.env.MC_MEMORY_QUALITY = 'on';
process.env.MC_RULES = 'on';
process.env.MC_COUNCIL = 'on';
process.env.MCAI_ACTS_LOG = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lawbench-')), 'acts.jsonl');
const soc = await import('../../server/src/society');
const rules = await import('../../server/src/rules');
const { callModel, parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');

const FILE = process.argv[2] ?? path.join(ROOT, 'runs/model-calls/2026-10-22-46872.jsonl');
const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL)!;
const N = Number(process.env.N ?? 4), PROMPTS = Number(process.env.PROMPTS ?? 10), CONC = Math.max(1, Number(process.env.CONC) || 3), DRY = !!process.env.DRY;
const CONDS = (process.env.CONDS ?? 'old,new0,new3').split(',');

const recs = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const systems = new Map(recs.filter((r) => r.type === 'system').map((r) => [r.hash, r.system]));
const nights = recs.filter((r) => r.kind === 'reflect' && /You may propose one village rule \(`law`\)/.test(r.user));
// (spread over the run: every k-th night, so members and days vary)
const step = Math.max(1, Math.floor(nights.length / PROMPTS));
const picked = nights.filter((_, i) => i % step === 0).slice(0, PROMPTS);

const OLD = /The village has no rules yet\.\nYou may propose one village rule \(`law`\)[^\n]*Most nights there is none\./;
const OPEN = [
  { id: 'l1', text: rules.ruleText('contribute', { class: 'torches', n: 1 }), backers: ['a', 'b', 'c', 'd'] },
  { id: 'l2', text: rules.ruleText('quota', { class: 'logs', n: 8 }), backers: ['a', 'b', 'c'] },
  { id: 'l3', text: rules.ruleText('floor', { class: 'torches', n: 10 }), backers: ['a', 'b'] },
];
const OPEN_TARGETS = new Map([['contribute:torches', 'l1'], ['quota:logs', 'l2'], ['floor:torches', 'l3']]);

function rebuild(user: string, cond: string): { user: string; tools: ReturnType<typeof soc.reflectTools> } {
  const live = [...user.matchAll(/^- \[(n\d+), day \d+\]/gm)].map((m) => m[1]);
  const block = /Members you dealt with[^\n]*\n((?:- [^\n]*\n?)+)/.exec(user)?.[1] ?? '';
  const people = [...block.matchAll(/^- ([A-Z][a-zA-Z]+):/gm)].map((m) => m[1]);
  const pline = /You may propose one improvement to the game[^\n]*(\nOthers' proposals[^\n]*)?/.exec(user);
  const propose = pline ? [...(pline[1] ?? '').matchAll(/\[(p\d+)\]/g)].map((m) => m[1]).slice(0, 3) : null;
  const open = cond === 'new3' ? OPEN : [];
  const u = cond === 'old' ? user : user.replace(OLD, soc.lawLines([], open));
  return { user: u, tools: soc.reflectTools({ live, people, openLaws: open.map((l) => l.id), propose }) };
}

const oldRead = (lw: unknown) => (typeof lw === 'string' ? lw.trim().length >= 8 : !!lw && typeof lw === 'object' && String((lw as Record<string, unknown>).what ?? (lw as Record<string, unknown>).text ?? '').trim().length >= 8);

interface Row { cond: string; prompt: number; agent: string; law: boolean; oldKept: boolean; read: boolean; type?: string; valid?: boolean; target?: string; joins?: string; backs: number; backValid: number; intention: boolean; focus: boolean; error?: string; raw?: unknown }
const jobs: Array<() => Promise<Row>> = [];
for (const cond of CONDS) picked.forEach((r, pi) => {
  for (let k = 0; k < N; k++) jobs.push(async () => {
    const { user, tools } = rebuild(r.user, cond);
    if (cond !== 'old' && user === r.user) throw new Error(`prompt ${pi}: the law paragraph was not found`);
    const row: Row = { cond, prompt: pi, agent: r.agent, law: false, oldKept: false, read: false, backs: 0, backValid: 0, intention: false, focus: false };
    if (DRY) return row;
    try {
      const res = await callModel({ spec, system: systems.get(r.system) ?? '', user, tools, level: REASONING.reflect, agent: `${r.agent}#${cond}${k}`, kind: 'reflect', priority: 'reflection' });
      const c = res.reply.calls.find((x) => x.name === 'reflect') ?? res.reply.calls[0];
      let inp = c?.input as unknown;
      if (typeof inp === 'string') try { inp = JSON.parse(inp); } catch { inp = {}; }
      const o = (inp ?? {}) as Record<string, unknown>;
      row.raw = { law: o.law, back_laws: o.back_laws };
      row.law = o.law !== undefined && o.law !== null && !(typeof o.law === 'object' && !Object.keys(o.law as object).length);
      row.oldKept = oldRead(o.law);
      const w = rules.lawFrom(o.law ?? o.rule);
      row.read = !!w;
      if (w) {
        const rl = rules.readLaw(w);
        row.type = rl.type;
        row.valid = !rules.validate(rl.type, rl.params);
        row.target = rules.lawTarget(rl.type, rl.params);
        row.joins = OPEN_TARGETS.get(row.target);
      }
      const bl = Array.isArray(o.back_laws) ? o.back_laws : [];
      row.backs = bl.length;
      row.backValid = bl.filter((b) => ['l1', 'l2', 'l3'].includes(typeof b === 'string' ? b : String((b as { id?: unknown })?.id))).length;
      row.intention = typeof o.intention === 'string' && o.intention.trim().length > 5;
      row.focus = typeof o.focus === 'string';
    } catch (e) {
      row.error = String((e as Error)?.message ?? e).slice(0, 160);
    }
    return row;
  });
});

// (RESCORE=<an earlier lawbench json>: its replies read again by the code as it is now, no calls)
let rows: Row[];
if (process.env.RESCORE) {
  rows = (JSON.parse(fs.readFileSync(process.env.RESCORE, 'utf8')).rows as Row[]).map((r) => {
    if (r.error) return r;
    const raw = (r.raw ?? {}) as { law?: unknown };
    const w = rules.lawFrom(raw.law);
    const rl = w ? rules.readLaw(w) : null;
    return { ...r, read: !!w, type: rl?.type, valid: rl ? !rules.validate(rl.type, rl.params) : undefined, target: rl ? rules.lawTarget(rl.type, rl.params) : undefined, joins: rl ? OPEN_TARGETS.get(rules.lawTarget(rl.type, rl.params)) : undefined };
  });
  console.log(`lawbench: ${process.env.RESCORE} read again`);
} else {
  console.log(`lawbench: ${picked.length} prompts x ${N} samples x ${CONDS.length} conditions = ${jobs.length} calls on ${MODEL}${DRY ? ' (dry)' : ''}`);
  rows = new Array(jobs.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (next < jobs.length) {
      const i = next++;
      rows[i] = await jobs[i]();
      if (++done % 20 === 0) console.log(`  ${done}/${jobs.length}`);
    }
  }));
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const summary: Record<string, unknown> = {};
for (const cond of CONDS) {
  const rs = rows.filter((r) => r.cond === cond && !r.error);
  const n = rs.length;
  const law = rs.filter((r) => r.law).length, read = rs.filter((r) => r.read).length;
  const typed = rs.filter((r) => r.read && r.type !== 'norm').length, valid = rs.filter((r) => r.read && r.valid).length;
  const byType: Record<string, number> = {};
  for (const r of rs) if (r.read) byType[r.type!] = (byType[r.type!] ?? 0) + 1;
  const joins = rs.filter((r) => r.joins).length, backs = rs.filter((r) => r.backs > 0).length, backValid = rs.reduce((s, r) => s + r.backValid, 0), backAll = rs.reduce((s, r) => s + r.backs, 0);
  // (per prompt: the law rate across its samples, so the spread shows it is not one prompt's)
  const perPrompt = picked.map((_, pi) => { const x = rs.filter((r) => r.prompt === pi); return x.length ? x.filter((r) => r.read).length / x.length : NaN; });
  const s = {
    n, errors: rows.filter((r) => r.cond === cond && r.error).length, law: pct(law, n), oldKept: pct(rs.filter((r) => r.oldKept).length, n), read: pct(read, n),
    typedOfRead: pct(typed, read), validOfRead: pct(valid, read), byType, joinsShown: cond === 'new3' ? pct(joins, read) : undefined,
    newLawWithOpen: cond === 'new3' ? pct(read - joins, n) : undefined, backNights: cond === 'new3' ? pct(backs, n) : undefined, backIdsValid: cond === 'new3' ? pct(backValid, backAll) : undefined,
    intention: pct(rs.filter((r) => r.intention).length, n), focus: pct(rs.filter((r) => r.focus).length, n),
    readPerPrompt: perPrompt.map((x) => (Number.isFinite(x) ? Math.round(x * 100) : null)),
  };
  summary[cond] = s;
  console.log(`${cond.padEnd(5)} n ${n} (err ${s.errors}): law ${s.law}, kept by Long1's reader ${s.oldKept}, read now ${s.read}; typed ${s.typedOfRead} and valid ${s.validOfRead} of read; ${JSON.stringify(byType)}`
    + (cond === 'new3' ? `; joins a shown law ${s.joinsShown} of read, new laws ${s.newLawWithOpen} of nights; backs on ${s.backNights} of nights (ids valid ${s.backIdsValid})` : '')
    + `; intention ${s.intention}, focus ${s.focus}; read per prompt ${JSON.stringify(s.readPerPrompt)}`);
}
const out = path.join(ROOT, 'runs/2026-10-23/g3-rules/bench', `lawbench-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ model: MODEL, file: FILE, N, prompts: picked.map((r) => ({ agent: r.agent, at: r.at })), summary, rows }, null, 1));
console.log(`wrote ${out}`);
process.exit(0);
