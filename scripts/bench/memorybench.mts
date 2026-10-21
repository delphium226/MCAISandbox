/**
 * memorybench (G1, #26): members' memory on the chooser's real prompts. A recorded run's decision log is replayed through
 * memory.ts (every chore end into its member's journal, on the village clock from the run's start), so each decision gets
 * the memory section code would have shown at that moment; then the real model is asked, through callModel, N samples a
 * case with a different shuffle each.
 *
 *  A. Writing: decisions from minute 30 on, asked with memory on (half of them as the member's first decision of the day,
 *     half with an intention already set): valid share, `remember` rate and length, notes that copy a line of the prompt,
 *     intentions and focuses given at the first decision.
 *  B. Using: cases where a remembered item bears on the menu, each asked with memory on and off (same menus, same shuffles):
 *     "avoid": the option the model chose in the run failed twice 30-40 minutes before (code's journal only): the share
 *       choosing it, on against off;
 *     "intend": an intention for today (set the night before) with a focus on a kind the model did not choose: the share
 *       choosing that kind, on against off; and the reasons that cite the memory.
 *  C. Counterfactual (after a G1 run): ACTS=<run>.acts.jsonl re-asks the run's own decisions whose prompt showed notes or an
 *     intention, with the memory section removed, and compares the choices with the run's (and with a re-ask with it).
 *
 * Usage: node_modules/.bin/tsx scripts/bench/memorybench.mts [CHOICES.jsonl]   (default LSc1 of 10-21)
 * Env: N (samples a case, default A 5, B 10, C 5), CONC (default 2), PARTS (default "AB"; "C" with ACTS), MODEL, DRY=1,
 *   CASES_A (30), CASES_B (6 per kind), ACTS (a G1 run's acts.jsonl, part C), CASES_C (24).
 * Writes runs/2026-10-21/g1-memory/bench/memorybench-<timestamp>.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChoiceContext, ChoiceMenu, ChoiceOption } from '../../server/src/world';
import type { Reply } from '../../server/src/modelCall';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mem = await import('../../server/src/memory');
const { buildPrompt, shuffled, parseChoice, memoryWrites } = await import('../../server/src/choose');
const { callModel, parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');

const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL)!;
const CONC = Math.max(1, Number(process.env.CONC) || 2);
const DRY = !!process.env.DRY;
const PARTS = (process.env.PARTS ?? (process.env.ACTS ? 'C' : 'AB')).toUpperCase();
const FILE = process.argv[2] ?? path.join(ROOT, 'runs/2026-10-21/live-scorecard/lsc/LSc1.choices.jsonl');
const MIN = 60000;

mem.setMemorySettings({ on: true, clock: true, dayMs: 20 * MIN, notes: 8, chars: 2000, reflect: false });
process.env.MCAI_ACTS_LOG = path.join(os.tmpdir(), 'memorybench-acts.jsonl');

// ---------------------------------------------------------------------------------------------
// The run's decisions and ends
// ---------------------------------------------------------------------------------------------

type Rec = Record<string, any>;
const recs: Rec[] = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const choices = recs.filter((r) => r.type === 'choice');
const byId = new Map(choices.map((r) => [r.id, r]));
const ends = recs.filter((r) => r.type === 'choice-end' && byId.has(r.id)).map((e) => ({ e, c: byId.get(e.id)! })).sort((x, y) => x.e.tEnd - y.e.tEnd);
const T0 = Math.min(...choices.map((r) => r.t)) - 5000;
const VILLAGE = choices[0].village as string;

interface Extra { agent: string; at: number; kind: string; option: string; name: string; ok: boolean; message: string }

/** The store as code would have kept it at `t`: the run's ends before t (plus extra ones), on a clock from the run's start. */
function storeAt(t: number, extra: Extra[] = []): void {
  mem.initMemory(null);
  for (const a of new Set(choices.map((r) => r.agent as string))) mem.noteSpawn(VILLAGE, a, { role: 'builder', brain: 'tiered', memory: { village: VILLAGE }, reset: true }, T0);
  const evs = [
    ...ends.filter(({ e }) => e.tEnd < t).map(({ e, c }) => ({ agent: c.agent, at: e.tEnd, kind: c.kind, option: c.chosen ?? c.key, name: (c.options.find((o: Rec) => o.id === c.chosen)?.name) ?? c.what, ok: !!e.ok, cut: !!e.cut, productive: !!e.productive, minutes: e.minutes, message: e.message ?? '' })),
    ...extra.map((x) => ({ ...x, cut: false, productive: x.ok, minutes: 2 })),
  ].sort((a, b) => a.at - b.at);
  for (const x of evs) {
    // (the night's day lines as the clock would have written them)
    const c = mem.clockOf(VILLAGE, x.at)!;
    mem.closeVillageDays(VILLAGE, c.day - 1);
    mem.closeAgentDays(VILLAGE, x.agent, c.day - 1);
    const verb = x.ok ? (x.productive ? 'done' : 'done, nothing gained') : x.cut ? 'cut short' : `failed (${x.message.slice(0, 60)})`;
    mem.noteEnd(VILLAGE, x.agent, { kind: x.kind, option: x.option, name: x.name, ok: x.ok, productive: x.productive, cut: x.cut, minutes: x.minutes, line: `${x.name}: ${verb}, ${Math.round(x.minutes * 10) / 10} min`, message: x.message }, x.at);
  }
  const c = mem.clockOf(VILLAGE, t)!;
  mem.closeVillageDays(VILLAGE, c.day - 1);
  for (const a of new Set(choices.map((r) => r.agent as string))) mem.closeAgentDays(VILLAGE, a, c.day - 1);
}

const menuOf = (r: Rec): ChoiceMenu => ({ agent: r.agent, village: r.village, t: r.t, options: r.options.map((o: Rec) => ({ ...o })) as ChoiceOption[], guarded: [], reasons: {}, ctx: r.ctx as ChoiceContext });
const model = choices.filter((r) => r.source === 'model' && r.ctx && r.options.length >= 3 && r.t - T0 >= 30 * MIN);
/** Every k-th, spread over agents and time. */
const spread = (xs: Rec[], n: number) => xs.filter((_, i) => i % Math.max(1, Math.floor(xs.length / n)) === 0).slice(0, n);

interface Job { part: string; case: string; cond: 'on' | 'off'; sample: number; system: string; user: string; tools: any; shown: ChoiceOption[]; meta: Rec }
const jobs: Job[] = [];
const promptFor = (r: Rec, cond: 'on' | 'off', sample: number, t: number) => {
  const menu = menuOf(r);
  const shown = shuffled(menu.options, `${r.seed ?? r.id}#${sample}`);
  const rc = cond === 'on' ? mem.recall(VILLAGE, r.agent, t, { lastShown: r.ctx.outcomes?.length || 5, mark: false }) : null;
  return { ...buildPrompt(menu, shown, cond === 'on' ? { recall: rc } : undefined), shown, rc };
};

// ---------------------------------------------------------------------------------------------
// A. Writing
// ---------------------------------------------------------------------------------------------

const NA = Number(process.env.N) || 5;
if (PARTS.includes('A')) {
  const cases = spread(model, Number(process.env.CASES_A) || 30);
  cases.forEach((r, i) => {
    storeAt(r.t);
    // (half with an intention already set the night before: their prompts have no dawn request)
    if (i % 2) mem.applyWrites(VILLAGE, r.agent, { intention: 'keep the village supplied with what it lacks most today', focus: 'making goods' }, 'night', mem.clockOf(VILLAGE, r.t)!.dayStart - 60000);
    for (let s = 0; s < NA; s++) {
      const p = promptFor(r, 'on', s, r.t);
      jobs.push({ part: 'A', case: `${r.agent}@${Math.round((r.t - T0) / MIN)}m`, cond: 'on', sample: s, system: p.system, user: p.user, tools: p.tools, shown: p.shown, meta: { dawn: !!p.rc?.dawn, chars: p.rc?.text.length ?? 0, recall: p.rc?.text ?? '' } });
    }
  });
}

// ---------------------------------------------------------------------------------------------
// B. Using
// ---------------------------------------------------------------------------------------------

const NB = Number(process.env.N) || 10;
const CB = Number(process.env.CASES_B) || 6;
if (PARTS.includes('B')) {
  // avoid: the model's own pick in the run failed twice 30-40 minutes before, by code's record only
  const avoid = spread(model.filter((r) => r.chosen && !['eat', 'grow'].includes(r.kind) && r.t - T0 >= 45 * MIN), CB);
  for (const r of avoid) {
    const o = r.options.find((x: Rec) => x.id === r.chosen);
    const extra: Extra[] = [40, 33].map((m) => ({ agent: r.agent, at: r.t - m * MIN, kind: r.kind, option: r.chosen, name: o.name, ok: false, message: 'could not finish it: what it needs was not there' }));
    for (const cond of ['on', 'off'] as const) for (let s = 0; s < NB; s++) {
      storeAt(r.t, extra);
      mem.applyWrites(VILLAGE, r.agent, { intention: 'do useful work for the village today', focus: 'making goods' }, 'night', mem.clockOf(VILLAGE, r.t)!.dayStart - 60000);
      const p = promptFor(r, cond, s, r.t);
      jobs.push({ part: 'B', case: `avoid ${r.agent}@${Math.round((r.t - T0) / MIN)}m ${o.name}`, cond, sample: s, system: p.system, user: p.user, tools: p.tools, shown: p.shown, meta: { kind: 'avoid', target: r.chosen, recall: p.rc?.text ?? '' } });
    }
  }
  // intend: an intention (set the night before) with a focus on a kind on the menu the model did not choose in the run
  const intend = spread(model.filter((r) => r.chosen && new Set(r.options.map((o: Rec) => o.kind)).size >= 3), CB);
  for (const r of intend) {
    const kinds = [...new Set(r.options.map((o: Rec) => o.kind as string))].filter((k) => k !== r.kind && k !== 'eat' && mem.FOCUS.includes(mem.focusOf(k)));
    const k = kinds[0];
    if (!k) continue;
    const focus = mem.focusOf(k);
    for (const cond of ['on', 'off'] as const) for (let s = 0; s < NB; s++) {
      storeAt(r.t);
      mem.applyWrites(VILLAGE, r.agent, { intention: `spend today on ${focus}: the village has had too little of it`, focus }, 'night', mem.clockOf(VILLAGE, r.t)!.dayStart - 60000);
      const p = promptFor(r, cond, s, r.t);
      jobs.push({ part: 'B', case: `intend ${r.agent}@${Math.round((r.t - T0) / MIN)}m ${k}`, cond, sample: s, system: p.system, user: p.user, tools: p.tools, shown: p.shown, meta: { kind: 'intend', targetKind: k, recall: p.rc?.text ?? '' } });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// C. Counterfactual on a G1 run's own decisions
// ---------------------------------------------------------------------------------------------

const NC = Number(process.env.N) || 5;
if (PARTS.includes('C')) {
  const acts: Rec[] = fs.readFileSync(process.env.ACTS!, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const decs = acts.filter((r) => r.type === 'decision' && r.choice && (r.memory ?? []).some((m: string) => /^n\d+$/.test(m) || m === 'intention'));
  const runChoices = new Map<string, Rec>();
  for (const r of acts) void r;
  const cases = spread(decs, Number(process.env.CASES_C) || 24);
  for (const d of cases) {
    // (the run's prompt as sent, and the same with the memory section removed; the tool as sent)
    const user: string = d.prompt;
    const stripped = user.replace(/\nWhat you remember[\s\S]*?(?=\nOptions \(in no particular order\):)/, '').replace(/\nThis is your first choice of village day \d+[^\n]*/, '');
    const options = [...user.matchAll(/^- (.+?)(?::|$| \(expected| \[)/gm)].map((m) => m[1]);
    void options;
    for (const cond of ['on', 'off'] as const) for (let s = 0; s < NC; s++) {
      const tools = [{ name: 'choose', description: 'Choose your next chore: a one-sentence reason first, then the exact name of one option.', input_schema: { type: 'object', properties: { reason: { type: 'string' }, choice: { type: 'string' } }, required: ['reason', 'choice'] } }];
      jobs.push({ part: 'C', case: `${d.agent} ${d.decisionId}`, cond, sample: s, system: cond === 'on' ? d.system : String(d.system).replace(' Use what you remember where it bears on the choice.', ''), user: cond === 'on' ? user : stripped, tools, shown: [], meta: { runChoice: d.choice, runReason: d.reason, memory: d.memory } });
    }
  }
  void runChoices;
}

// ---------------------------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------------------------

interface Out extends Job { choice: string | null; name?: string; kind?: string; reason: string; writes: Rec; invalid?: string; ms: number; pt?: number; ot?: number }
const outs: Out[] = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    const t0 = Date.now();
    let reply: Reply;
    try {
      reply = DRY
        ? { calls: [{ name: 'choose', input: { reason: 'dry', choice: j.shown[0]?.name ?? 'x' } }], text: '' }
        : (await callModel({ spec, system: j.system, user: j.user, tools: j.tools, level: REASONING.choose, agent: 'memorybench', kind: 'choose', priority: 'decision', fallbackMs: 60000 })).reply;
    } catch (e) {
      outs.push({ ...j, choice: null, reason: '', writes: {}, invalid: `error ${String((e as Error).message).slice(0, 80)}`, ms: Date.now() - t0 });
      continue;
    }
    if (j.part === 'C') {
      const call = reply.calls[0];
      const inp = (typeof call?.input === 'string' ? JSON.parse(call.input as string) : call?.input) as Rec | undefined;
      outs.push({ ...j, choice: inp?.choice ?? null, name: inp?.choice, reason: inp?.reason ?? '', writes: {}, ms: Date.now() - t0, pt: reply.promptTokens, ot: reply.outputTokens });
      continue;
    }
    const c = parseChoice(reply, j.shown);
    const o = 'invalid' in c ? undefined : j.shown.find((x) => x.id === c.id);
    outs.push({ ...j, choice: 'invalid' in c ? null : c.id, name: o?.name, kind: o?.kind, reason: 'invalid' in c ? '' : c.reason, writes: memoryWrites(reply), ...('invalid' in c ? { invalid: c.invalid } : {}), ms: Date.now() - t0, pt: reply.promptTokens, ot: reply.outputTokens });
    if (outs.length % 25 === 0) console.log(`[memorybench] ${outs.length}/${jobs.length}`);
  }
}
console.log(`[memorybench] ${jobs.length} calls (${PARTS}) on ${path.basename(FILE)}${DRY ? ' (dry)' : ''}`);
await Promise.all(Array.from({ length: CONC }, () => worker()));

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
const summary: Rec = { file: FILE, model: MODEL, parts: PARTS, calls: outs.length, at: new Date().toISOString() };
const A = outs.filter((o) => o.part === 'A');
if (A.length) {
  const valid = A.filter((o) => o.choice);
  const notes = valid.filter((o) => o.writes.remember);
  const dawn = valid.filter((o) => o.meta.dawn);
  // (a note that copies 6+ consecutive words of the prompt restates what it was shown)
  const copies = notes.filter((o) => {
    const w = String(o.writes.remember).toLowerCase().split(/\s+/);
    for (let i = 0; i + 6 <= w.length; i++) if (o.user.toLowerCase().includes(w.slice(i, i + 6).join(' '))) return true;
    return false;
  });
  summary.A = {
    calls: A.length, valid: pct(valid.length, A.length), remember: pct(notes.length, valid.length),
    noteChars: notes.length ? Math.round(notes.reduce((s, o) => s + String(o.writes.remember).length, 0) / notes.length) : 0,
    copies: `${copies.length} of ${notes.length}`,
    dawnIntention: `${dawn.filter((o) => o.writes.intention).length} of ${dawn.length}`, dawnFocus: `${dawn.filter((o) => o.writes.focus).length} of ${dawn.length}`,
    sectionChars: Math.round(A.reduce((s, o) => s + o.meta.chars, 0) / A.length), promptTokens: Math.round(A.reduce((s, o) => s + (o.pt ?? 0), 0) / A.length),
    examples: notes.slice(0, 12).map((o) => `${o.case}: ${o.writes.remember}`), intentions: dawn.filter((o) => o.writes.intention).slice(0, 6).map((o) => `${o.case}: ${o.writes.intention} [${o.writes.focus}]`),
  };
}
const B = outs.filter((o) => o.part === 'B');
if (B.length) {
  const rows: Rec[] = [];
  for (const name of [...new Set(B.map((o) => o.case))]) {
    const xs = B.filter((o) => o.case === name);
    const hit = (o: Out) => (o.meta.kind === 'avoid' ? o.choice === o.meta.target : o.kind === o.meta.targetKind);
    const on = xs.filter((o) => o.cond === 'on' && o.choice), off = xs.filter((o) => o.cond === 'off' && o.choice);
    const cites = on.filter((o) => /remember|earlier|failed|intention|intend|today|yesterday|planned|focus/i.test(o.reason)).length;
    rows.push({ case: name, kind: xs[0].meta.kind, on: `${on.filter(hit).length}/${on.length}`, off: `${off.filter(hit).length}/${off.length}`, shift: on.length && off.length ? Math.round((on.filter(hit).length / on.length - off.filter(hit).length / off.length) * 100) : null, cites: `${cites}/${on.length}`, invalid: xs.filter((o) => !o.choice).length });
  }
  const agg = (k: string) => {
    const xs = B.filter((o) => o.meta.kind === k && o.choice);
    const hit = (o: Out) => (k === 'avoid' ? o.choice === o.meta.target : o.kind === o.meta.targetKind);
    const on = xs.filter((o) => o.cond === 'on'), off = xs.filter((o) => o.cond === 'off');
    return { on: pct(on.filter(hit).length, on.length), off: pct(off.filter(hit).length, off.length), n: `${on.length}+${off.length}`, casesMoved: rows.filter((r) => r.kind === k && (k === 'avoid' ? r.shift < 0 : r.shift > 0)).length, cases: rows.filter((r) => r.kind === k).length };
  };
  summary.B = { avoid: agg('avoid'), intend: agg('intend'), rows, valid: pct(B.filter((o) => o.choice).length, B.length), reasons: B.filter((o) => o.cond === 'on' && o.choice).slice(0, 10).map((o) => `${o.case}: ${o.name}: ${o.reason}`) };
}
const C = outs.filter((o) => o.part === 'C');
if (C.length) {
  const rows: Rec[] = [];
  for (const name of [...new Set(C.map((o) => o.case))]) {
    const xs = C.filter((o) => o.case === name);
    const run = xs[0].meta.runChoice;
    const on = xs.filter((o) => o.cond === 'on' && o.choice), off = xs.filter((o) => o.cond === 'off' && o.choice);
    // (the run logged option ids; the re-asks give names: compare by the name in the run's prompt line for that id is not
    // logged, so by the modal on-choice instead: how often off picks what on picks most)
    const modal = (ys: Out[]) => [...ys.reduce((m, o) => m.set(o.name!, (m.get(o.name!) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const m = modal(on);
    rows.push({ case: name, run, onModal: m, onAgree: `${on.filter((o) => o.name === m).length}/${on.length}`, offAgree: `${off.filter((o) => o.name === m).length}/${off.length}`, memory: xs[0].meta.memory });
  }
  const tot = (k: 'onAgree' | 'offAgree') => rows.reduce((s, r) => s + Number(r[k].split('/')[0]), 0) / Math.max(1, rows.reduce((s, r) => s + Number(r[k].split('/')[1]), 0));
  summary.C = { cases: rows.length, onAgree: Math.round(tot('onAgree') * 100), offAgree: Math.round(tot('offAgree') * 100), changed: rows.filter((r) => Number(r.offAgree.split('/')[0]) / Math.max(1, Number(r.offAgree.split('/')[1])) < 0.5 && Number(r.onAgree.split('/')[0]) / Math.max(1, Number(r.onAgree.split('/')[1])) >= 0.6).length, rows };
}
summary.tokens = { prompt: outs.reduce((s, o) => s + (o.pt ?? 0), 0), output: outs.reduce((s, o) => s + (o.ot ?? 0), 0) };
summary.cost = Math.round((summary.tokens.prompt * 0.15 + summary.tokens.output * 0.6) / 1e4) / 100;
const outDir = path.join(ROOT, 'runs/2026-10-21/g1-memory/bench');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `memorybench-${PARTS}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(outFile, JSON.stringify({ summary, outs: outs.map(({ system, user, tools, shown, ...o }) => ({ ...o, user: o.part === 'A' ? user : undefined })) }, null, 1));
console.log(JSON.stringify({ ...summary, B: summary.B ? { ...summary.B, rows: summary.B.rows } : undefined }, null, 1));
console.log(`[memorybench] written ${path.relative(ROOT, outFile)}`);
void words;
