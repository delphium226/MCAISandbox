/**
 * openbench (#172): the open chooser's prompt against the menu's, on recorded states. palette_golden.mts saves both
 * (`dump ... --save MENU.json` in model mode, `open --save OPEN.json` with MC_CHOOSE=open, same checkpoint, flags and
 * sweeps): every member's prompt as the model would get it (system, user, tools; no memory section). For each member
 * menu of the first SWEEP that both files hold, N samples of each prompt go to the real model (callModel: the gate and the
 * usage ledger as in a run) and the reply is parsed as choose() parses it.
 * Reports per arm: valid %, distinct picks, the picks outside the menu's eight (open only), the open-only picks (a make
 * past its keep, a gather nothing wants), the kinds picked, latency, prompt and output tokens.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/openbench.mts MENU.json OPEN.json
 * Env: MODEL (default ollama:gpt-oss:120b-cloud), THINK (default REASONING.choose), N (samples a member, default 2),
 *   MEMBERS (at most this many, default 12), SWEEP (default 1), CONC (default 2), PEEK=1 (each raw reply).
 * Writes a JSON summary beside OPEN.json (openbench-<timestamp>.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ChoiceOption } from '../../server/src/world';
import { percentile } from './benchUtil.mts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const [menuFile, openFile] = process.argv.slice(2);
if (!menuFile || !openFile) {
  console.log('usage: openbench.mts MENU.json OPEN.json');
  process.exit(2);
}
process.env.MC_MODEL_RECORD ??= '0';
const { parseChoice } = await import('../../server/src/choose');
const { callModel, parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');

const spec = parseSpec(process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud');
if (!spec) throw new Error('MODEL is not <provider>:<model>');
const level = (process.env.THINK?.trim().toLowerCase() || REASONING.choose) as Any;
const N = Number(process.env.N ?? 2), MEMBERS = Number(process.env.MEMBERS ?? 12), SWEEP = Number(process.env.SWEEP ?? 1), CONC = Number(process.env.CONC ?? 2);
const PEEK = process.env.PEEK === '1';

const load = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8')).sweeps[SWEEP - 1].menus as Record<string, Any>;
const menus = load(menuFile), opens = load(openFile);
const names = Object.keys(opens).filter((n) => opens[n]?.system && menus[n]?.system && opens[n].options.length > 1).slice(0, MEMBERS);
if (!names.length) {
  console.log('no member has a menu in both files (saved with --save?)');
  process.exit(2);
}

interface Sample { arm: 'menu' | 'open'; agent: string; ok: boolean; id?: string; kind?: string; why?: string; ms: number; pt: number; ot: number; outside?: boolean; openOnly?: boolean; pickaxeAsk?: boolean; pastPickaxe?: boolean; toolTake?: boolean }
const samples: Sample[] = [];
const jobs: Array<() => Promise<void>> = [];
for (const agent of names)
  for (const arm of ['menu', 'open'] as const)
    for (let k = 0; k < N; k++)
      jobs.push(async () => {
        const m = arm === 'open' ? opens[agent] : menus[agent];
        const options = m.options as ChoiceOption[];
        const t0 = Date.now();
        try {
          const r = await callModel({ spec, system: m.system, user: m.prompt, tools: m.tools, level, agent: `bench-${agent}`, kind: 'choose', priority: 'decision' } as Any);
          const c = parseChoice(r.reply, options);
          const s: Sample = { arm, agent, ok: !('invalid' in c), ms: r.ms, pt: r.reply.promptTokens ?? 0, ot: r.reply.outputTokens ?? 0 };
          // (#172's tool want: a request for a pickaxe in the reply, a pickaxe made past the keep, a tool taken for oneself)
          const inp = ((r.reply.calls ?? []).find((x: Any) => x.name === 'choose') ?? r.reply.calls?.[0])?.input ?? {};
          s.pickaxeAsk = /pickaxe/i.test(String(inp.act_item ?? '')) || /^request.*pickaxe/i.test(String(inp.choice ?? ''));
          if ('invalid' in c) s.why = c.invalid;
          else {
            const o = options.find((x) => x.id === c.id)!;
            s.id = c.id;
            s.kind = o.kind;
            s.pastPickaxe = /pickaxe$/.test(c.id) && /\(past the keep\)/.test(o.facts ?? '');
            s.toolTake = /^own:tool:/.test(c.id);
            if (arm === 'open') {
              s.outside = !menus[agent].options.some((x: Any) => x.id === c.id);
              s.openOnly = /\(past the keep\)/.test(o.facts ?? '') || (o.kind === 'gather' && /nothing wants it/.test(o.name));
            }
          }
          if (PEEK) console.log(`[${arm}] ${agent}: ${s.ok ? `${s.id} | ${c && !('invalid' in c) ? c.reason : ''}` : `INVALID ${s.why}`} | ${JSON.stringify(r.reply.calls ?? r.reply.text).slice(0, 300)}`);
          samples.push(s);
        } catch (e) {
          samples.push({ arm, agent, ok: false, why: `error: ${String((e as Error)?.message ?? e).slice(0, 120)}`, ms: Date.now() - t0, pt: 0, ot: 0 });
        }
      });
let next = 0;
await Promise.all(Array.from({ length: Math.max(1, CONC) }, async () => {
  while (next < jobs.length) await jobs[next++]();
}));

const summary: Any = { model: process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud', level, members: names.length, n: N, arms: {} };
for (const arm of ['menu', 'open'] as const) {
  const xs = samples.filter((s) => s.arm === arm), ok = xs.filter((s) => s.ok);
  const kinds = new Map<string, number>();
  for (const s of ok) kinds.set(s.kind!, (kinds.get(s.kind!) ?? 0) + 1);
  const opts = names.map((n) => (arm === 'open' ? opens[n] : menus[n]).options.length);
  const a = {
    samples: xs.length, valid: ok.length, validPct: Math.round((100 * ok.length) / Math.max(1, xs.length)), distinct: new Set(ok.map((s) => s.id)).size,
    optionsMedian: percentile(opts, 0.5), promptTokensMedian: percentile(xs.map((s) => s.pt).filter(Boolean), 0.5), outputTokensMedian: percentile(xs.map((s) => s.ot).filter(Boolean), 0.5),
    msMedian: percentile(xs.map((s) => s.ms), 0.5), msP90: percentile(xs.map((s) => s.ms), 0.9),
    kinds: Object.fromEntries([...kinds.entries()].sort((p, q) => q[1] - p[1])),
    ...(arm === 'open' ? { outsideMenu: ok.filter((s) => s.outside).length, openOnly: ok.filter((s) => s.openOnly).length } : {}),
    pickaxeAsks: xs.filter((s) => s.pickaxeAsk).length, pastPickaxe: ok.filter((s) => s.pastPickaxe).length, toolTakes: ok.filter((s) => s.toolTake).length,
    invalid: xs.filter((s) => !s.ok).map((s) => s.why),
  };
  summary.arms[arm] = a;
  console.log(`${arm.padEnd(4)}: ${a.valid}/${a.samples} valid (${a.validPct}%), ${a.distinct} distinct picks; options median ${a.optionsMedian}; prompt tokens median ${a.promptTokensMedian}, output ${a.outputTokensMedian}; ${a.msMedian} ms median, p90 ${a.msP90}${arm === 'open' ? `; outside the menu's view ${a.outsideMenu}, open-only (past the keep / nothing wants it) ${a.openOnly}` : ''}`);
  console.log(`      tool want: pickaxe requests ${a.pickaxeAsks}, pickaxes made past the keep ${a.pastPickaxe}, tools taken for oneself ${a.toolTakes}`);
  console.log(`      kinds: ${Object.entries(a.kinds).map(([k, n]) => `${k} ${n}`).join(', ')}${a.invalid.length ? `; invalid: ${[...new Set(a.invalid)].slice(0, 3).join(' | ')}` : ''}`);
}
const out = path.join(path.dirname(openFile), `openbench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(out, JSON.stringify({ summary, samples }, null, 1));
console.log(`wrote ${out}`);
process.exit(0);
