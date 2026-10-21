/**
 * socialbench (G2, #27-#29): the chooser's real prompts (G1a's model decisions, memory on) rebuilt with G2's social
 * sections, asked of the real model through callModel. G1a ran without them, so each case's social content is built from
 * the decision's own logged context: the others' line becomes the awareness block (counts, nobody-doing, profiles of the
 * members it names), and the inbox and acts are added as code would show them.
 *
 *  A. Acts and requests: decisions whose menu has an item option (gather or make), each asked with the block and the acts
 *     on offer, with and without a request for one of its item options from a named member (the option tagged "[X asked
 *     you]", the inbox's line). Measures: valid replies; the act and say rates before the cadence; the acts' verdicts in
 *     acts.ts' validator on a world built from the menu; `say` on topic; the requested option's share with the request
 *     against without (requests met); position bias.
 *  B. A broken promise (the counterfactual E.5's exit asks for): two of a decision's options and two help options for two
 *     members' projects alike in all but the owner; one owner's profile says it broke a promise to this member (and others say so),
 *     the other's is plain; against both plain. Measures the share helping the breaker, with against without.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/socialbench.mts [CHOICES.jsonl ACTS.jsonl]
 *   (default G1a: runs/2026-10-21/g1-memory/g1run/G1a.{choices,acts}.jsonl)
 * Env: N_A (samples a case and condition, default 3), CASES_A (40), N_B (10), CASES_B (6), CONC (2), MODEL, DRY=1, PARTS (AB).
 * Writes runs/2026-10-21/g2-social/bench/socialbench-<timestamp>.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChoiceMenu, ChoiceOption } from '../../server/src/world';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'socialbench-'));
process.env.MC_MEMORY = 'on';
process.env.MCAI_SOCIAL = 'on';
process.env.MC_ACTS = 'on';
process.env.MCAI_ACTS_LOG = path.join(dir, 'acts.jsonl');
const mem = await import('../../server/src/memory');
const soc = await import('../../server/src/social');
const acts = await import('../../server/src/acts');
const { buildPrompt, shuffled, parseChoice } = await import('../../server/src/choose');
const { callModel, parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');

const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL)!;
const CONC = Math.max(1, Number(process.env.CONC) || 2);
const DRY = !!process.env.DRY;
const PARTS = (process.env.PARTS ?? 'AB').toUpperCase();
const N_A = Number(process.env.N_A ?? 3), CASES_A = Number(process.env.CASES_A ?? 40);
const N_B = Number(process.env.N_B ?? 10), CASES_B = Number(process.env.CASES_B ?? 6);
const choicesFile = process.argv[2] ?? path.join(ROOT, 'runs/2026-10-21/g1-memory/g1run/G1a.choices.jsonl');
const actsFile = process.argv[3] ?? path.join(ROOT, 'runs/2026-10-21/g1-memory/g1run/G1a.acts.jsonl');

type Rec = Record<string, any>;
const lines = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec);
const decisions = new Map<string, Rec>();
for (const r of lines(actsFile)) if (r.type === 'decision' && typeof r.prompt === 'string') decisions.set(`${r.decisionId}|${r.agent}`, r);
const NAMES = ['Mayor', 'Ada', 'Ben', 'Clara', 'Dev', 'Elena', 'Finn', 'Grace', 'Hugo', 'Iris', 'Jonah', 'Kai', 'Lena', 'Milo', 'Nora', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tess', 'Uma', 'Victor', 'Wren', 'Xavier'];
const V = 'Bench';
mem.initMemory(null);
for (const n of NAMES) mem.noteSpawn(V, n, { role: 'worker', brain: 'tiered', memory: {}, reset: true }, 1);

/** A G1a model decision as a menu, its recall text and outcomes (prompt_golden_memory.mts' reading). */
interface Base { r: Rec; menu: ChoiceMenu; options: ChoiceOption[]; recallText: string; dawn: boolean; outcomes?: string[]; others: Map<string, string[]> }
const bases: Base[] = [];
for (const r of lines(choicesFile)) {
  if (r.type !== 'choice' || r.source !== 'model' || !r.seed || !r.ctx) continue;
  const d = decisions.get(String(r.seed));
  if (!d) continue;
  const sent = String(d.prompt);
  const at = sent.indexOf('\nWhat you remember');
  const end = sent.indexOf('\nOptions (in no particular order):');
  let text = at >= 0 ? sent.slice(at + 1, end) : '';
  const dl = text.indexOf('\nThis is your first choice of village day');
  if (dl >= 0) text = text.slice(0, dl);
  const outLine = /\nYour last chores: (.*)\n/.exec(sent)?.[1] ?? '';
  const options = (r.options as Rec[]).filter((o) => typeof o.shown === 'number').map((o) => ({ ...o }) as unknown as ChoiceOption);
  // (the others' line: "harvesting 3 (Ada, Ben, Clara, ...), making goods 1 (Dev), idle 4")
  const others = new Map<string, string[]>();
  for (const m of String(r.ctx.others ?? '').matchAll(/([a-z' ]+?) (\d+) \(([^)]*)\)/g)) others.set(m[1].trim(), m[3].split(',').map((s) => s.trim()).filter((s) => NAMES.includes(s)));
  bases.push({ r, menu: { agent: r.agent, village: V, t: r.t, options, guarded: [], reasons: {}, ctx: { ...r.ctx } } as ChoiceMenu, options, recallText: text, dawn: !!d.dawn, outcomes: r.ctx.outcomes?.length ? undefined : outLine === 'none yet' ? [] : outLine.split(' | '), others });
}

/** Profiles for the members a decision's others' line names: seen at that kind (the counts as code would have them). */
function seedProfiles(b: Base) {
  const s = soc.memberSocial(V, b.r.agent);
  s.profiles = {};
  for (const [w, names] of b.others) for (const n of names) if (n !== b.r.agent) {
    s.profiles[n] = { of: n, kinds: [w], kept: 0, broke: 0, helped: 0, helpedBy: 0, lastMet: b.r.t - 3 * 60000, seen: { [w]: 2 } };
  }
}
function block(b: Base, near: string[]) {
  const kinds = new Map<string, string[]>();
  for (const [w, names] of b.others) kinds.set(w, names);
  return soc.awareness(V, b.r.agent, b.r.t, { kinds, choosing: 0, idle: 0, menuKinds: b.options.map((o) => o.kind), near }).text;
}
function actsWorld(b: Base): import('../../server/src/acts').ActsWorld {
  const items = new Map<string, string>();
  for (const o of b.options) if (/^(gather|make):/.test(o.id)) items.set(o.id, o.id.split(':')[1].replace(/_/g, ' '));
  const projects = new Map<string, { words: string; owner: string }>();
  for (const o of b.options) if (o.id.startsWith('help:')) projects.set(o.id, { words: /build an? ([a-z ]+?):/.exec(o.name)?.[1] ?? 'project', owner: /^Help (\w+)/.exec(o.name)?.[1] ?? b.r.agent });
  const at = new Map<string, { x: number; z: number }>([[b.r.agent, { x: 0, z: 0 }]]);
  for (const [i, n] of [...new Set([...b.others.values()].flat())].entries()) at.set(n, { x: 4 + i, z: 0 });
  return { items, projects, at, verify: () => true };
}

async function ask(system: string, user: string, tools: unknown, agent: string): Promise<{ reply: any; ms: number } | null> {
  if (DRY) return null;
  try {
    const r = await callModel({ spec, system, user, tools: tools as never, level: REASONING.choose, agent, kind: 'choose', priority: 'decision', maxWaitMs: 120000, fallbackMs: 120000 });
    return { reply: r.reply, ms: r.ms };
  } catch (e) {
    return { reply: { calls: [], text: `ERROR ${(e as Error).message}` }, ms: 0 };
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
const inputOf = (reply: any) => (reply?.calls ?? []).find((c: any) => c.name === 'choose')?.input ?? (reply?.calls ?? [])[0]?.input ?? null;

const result: Rec = { model: MODEL, at: new Date().toISOString(), choicesFile, parts: PARTS };

// ---- A
if (PARTS.includes('A')) {
  const pickable = bases.filter((b) => b.options.some((o) => /^(gather|make):/.test(o.id)) && b.others.size);
  const step = Math.max(1, Math.floor(pickable.length / CASES_A));
  const cases = pickable.filter((_, i) => i % step === 0).slice(0, CASES_A);
  const jobs: Array<() => Promise<Rec>> = [];
  for (const [ci, b] of cases.entries()) {
    const item = b.options.filter((o) => /^(gather|make):/.test(o.id))[ci % b.options.filter((o) => /^(gather|make):/.test(o.id)).length];
    const asker = [...new Set([...b.others.values()].flat())].find((n) => n !== b.r.agent) ?? (b.r.agent === 'Ada' ? 'Ben' : 'Ada');
    for (const cond of ['request', 'plain'] as const) for (let s = 0; s < N_A; s++) jobs.push(async () => {
      seedProfiles(b);
      const w = actsWorld(b);
      const options = b.options.map((o) => ({ ...o, ...(cond === 'request' && o.id === item.id ? { social: `[${asker} asked you]` } : {}) }));
      const ctx = { ...b.r.ctx, others: '', social: block(b, [...w.at.keys()].filter((n) => n !== b.r.agent)),
        ...(cond === 'request' ? { inbox: [`${asker} asks you: ${item.id.startsWith('make:') ? 'make' : 'gather'} ${w.items.get(item.id)} (r1, 2 min ago)`] } : {}),
        acts: acts.actsHelp(V, b.r.agent, b.r.t, w) || 'acts' };
      const menu = { ...b.menu, options, ctx } as ChoiceMenu;
      const shown = shuffled(options, `${b.r.seed}|sb${s}|${cond}`);
      const p = buildPrompt(menu, shown, { recall: b.recallText ? { text: b.recallText, shown: [], liveIds: [], full: false, dawn: b.dawn, day: 1 } : null, outcomes: b.outcomes });
      const got = await ask(p.system, p.user, p.tools, b.r.agent);
      if (!got) return { case: ci, cond, dry: true, chars: p.system.length + p.user.length + JSON.stringify(p.tools).length };
      const c = parseChoice(got.reply, shown);
      const f = acts.actFields(inputOf(got.reply));
      // (the validator on the bench's world: a fresh member each time, so the cadence and budget never bind)
      let verdict: string[] = [];
      if (!('invalid' in c)) {
        const st = acts.actsState(V);
        st.since[b.r.agent] = 9;
        st.recent = {};
        st.used = {};
        const opt = options.find((o) => o.id === c.id)!;
        if (cond === 'request') st.requests.push({ id: `r${st.next++}`, from: asker, to: b.r.agent, what: { kind: 'item', option: item.id, words: item.id }, made: b.r.t, state: 'open' });
        verdict = acts.handle(V, b.r.agent, f, { option: opt.id, kind: opt.kind, name: opt.name, chore: `bench${s}` }, w, b.r.t + 1000);
        for (const r of st.requests) if (r.state === 'open') r.state = 'expired';
      }
      return {
        case: ci, cond, agent: b.r.agent, item: item.id, valid: !('invalid' in c), choice: 'invalid' in c ? null : c.id, position: 'invalid' in c ? null : shown.findIndex((o) => o.id === c.id) + 1, n: shown.length,
        act: f.act ?? null, say: f.say ?? null, fields: f, verdict, ms: got.ms, promptTokens: got.reply.promptTokens, outputTokens: got.reply.outputTokens, reason: 'invalid' in c ? c.invalid : c.reason,
        chars: p.system.length + p.user.length + JSON.stringify(p.tools).length,
      };
    });
  }
  const res = await pool(jobs);
  result.A = res;
  const ok = res.filter((x) => x.valid);
  const share = (cond: string) => {
    const xs = ok.filter((x) => x.cond === cond);
    return { n: xs.length, item: xs.filter((x) => x.choice === x.item).length };
  };
  const withAct = ok.filter((x) => x.act && x.act !== 'none');
  const says = ok.filter((x) => x.say);
  const sayDropped = ok.filter((x) => (x.verdict ?? []).some((v: string) => v.startsWith('say dropped')));
  const verdicts: Record<string, number> = {};
  for (const x of ok) for (const v of x.verdict ?? []) verdicts[v.replace(/ r\d+| c\d+|: .*$/g, '')] = (verdicts[v.replace(/ r\d+| c\d+|: .*$/g, '')] ?? 0) + 1;
  const pos: number[] = [], exp: number[] = [];
  for (const x of ok) {
    for (let i = 0; i < x.n; i++) exp[i] = (exp[i] ?? 0) + 1 / x.n;
    pos[x.position - 1] = (pos[x.position - 1] ?? 0) + 1;
  }
  result.summaryA = {
    calls: res.length, valid: `${ok.length}/${res.length}`, request: share('request'), plain: share('plain'),
    actRate: `${withAct.length}/${ok.length}`, acts: Object.entries(withAct.reduce((m: Rec, x) => ((m[x.act] = (m[x.act] ?? 0) + 1), m), {})),
    sayRate: `${says.length}/${ok.length}`, sayOffTopic: `${sayDropped.length}/${says.length}`, verdicts,
    positionRatio: pos.map((p, i) => Math.round(((p ?? 0) / (exp[i] || 1)) * 100) / 100),
    meanChars: Math.round(res.reduce((s, x) => s + (x.chars ?? 0), 0) / res.length), meanPromptTokens: Math.round(ok.reduce((s, x) => s + (x.promptTokens ?? 0), 0) / (ok.length || 1)),
  };
  console.log('A', JSON.stringify(result.summaryA));
}

// ---- B
if (PARTS.includes('B')) {
  const pickable = bases.filter((b) => b.options.length >= 3 && b.options.length <= 7);
  const step = Math.max(1, Math.floor(pickable.length / CASES_B));
  const cases = pickable.filter((_, i) => i % step === 0).slice(0, CASES_B);
  const jobs: Array<() => Promise<Rec>> = [];
  const PAIRS = [['Ben', 'Clara'], ['Dev', 'Elena'], ['Finn', 'Grace'], ['Hugo', 'Iris'], ['Jonah', 'Kai'], ['Lena', 'Milo']];
  const WORKS = [['gazebo', 'well'], ['woodshed', 'market stall'], ['signpost', 'bench'], ['pair of lamp posts', 'flower bed'], ['well', 'gazebo'], ['market stall', 'woodshed']];
  for (const [ci, b] of cases.entries()) {
    let [x, y] = PAIRS[ci % PAIRS.length];
    if (x === b.r.agent || y === b.r.agent) [x, y] = ['Nora', 'Omar'];
    const [wx, wy] = WORKS[ci % WORKS.length];
    for (const cond of ['broke', 'plain'] as const) for (let s = 0; s < N_B; s++) jobs.push(async () => {
      // (the breaker alternates between the two owners by sample, so a name or a work never carries the effect)
      const breaker = s % 2 ? y : x;
      const helpOpt = (owner: string, work: string, n: number): ChoiceOption => ({ id: `help:b${n}`, kind: 'help', key: `initiative:b${n}:1`, name: `Help ${owner} build a ${work}: gather 6 logs`, rank: 1050 + n, facts: `${owner}'s project, started 6 min ago; nobody helping yet; 1 steps taken; logs still to gather for it`, effect: `+6 logs toward the ${work}`, holds: [] } as unknown as ChoiceOption);
      // (the two help options beside two of the decision's own, so the choice is mostly between the two owners)
      const options = [...b.options.slice(0, 2), helpOpt(x, wx, 1), helpOpt(y, wy, 2)];
      const s2 = soc.memberSocial(V, b.r.agent);
      s2.profiles = {
        [x]: { of: x, kinds: ['gathering'], kept: 0, broke: cond === 'broke' && breaker === x ? 1 : 0, heardBroke: cond === 'broke' && breaker === x ? 1 : 0, helped: 0, helpedBy: 0, lastMet: b.r.t - 4 * 60000, seen: { gather: 2 } },
        [y]: { of: y, kinds: ['gathering'], kept: 0, broke: cond === 'broke' && breaker === y ? 1 : 0, heardBroke: cond === 'broke' && breaker === y ? 1 : 0, helped: 0, helpedBy: 0, lastMet: b.r.t - 4 * 60000, seen: { gather: 2 } },
      };
      const sb = soc.awareness(V, b.r.agent, b.r.t, { kinds: new Map([['gathering', [x, y]]]), choosing: 0, idle: 2, menuKinds: options.map((o) => o.kind), near: [x, y] }).text;
      const ctx = { ...b.r.ctx, others: '', social: sb };
      const menu = { ...b.menu, options, ctx } as ChoiceMenu;
      const shown = shuffled(options, `${b.r.seed}|sbB${s}|${cond}`);
      const p = buildPrompt(menu, shown, { recall: b.recallText ? { text: b.recallText, shown: [], liveIds: [], full: false, dawn: false, day: 1 } : null, outcomes: b.outcomes });
      const got = await ask(p.system, p.user, p.tools, b.r.agent);
      if (!got) return { case: ci, cond, dry: true };
      const c = parseChoice(got.reply, shown);
      const id = 'invalid' in c ? null : c.id;
      const breakerOpt = breaker === x ? 'help:b1' : 'help:b2', otherOpt = breaker === x ? 'help:b2' : 'help:b1';
      return { case: ci, cond, agent: b.r.agent, breaker, valid: !('invalid' in c), choice: id, helpsBreaker: id === breakerOpt, helpsOther: id === otherOpt, reason: 'invalid' in c ? c.invalid : c.reason };
    });
  }
  const res = await pool(jobs);
  result.B = res;
  const sum = (cond: string) => {
    const xs = res.filter((r) => r.cond === cond && r.valid);
    return { n: xs.length, breaker: xs.filter((r) => r.helpsBreaker).length, other: xs.filter((r) => r.helpsOther).length };
  };
  const perCase = [...new Set(res.map((r) => r.case))].map((ci) => {
    const f = (cond: string) => res.filter((r) => r.case === ci && r.cond === cond && r.valid);
    const b1 = f('broke'), p1 = f('plain');
    return { case: ci, broke: `${b1.filter((r) => r.helpsBreaker).length}/${b1.filter((r) => r.helpsBreaker || r.helpsOther).length}`, plain: `${p1.filter((r) => r.helpsBreaker).length}/${p1.filter((r) => r.helpsBreaker || r.helpsOther).length}` };
  });
  result.summaryB = { broke: sum('broke'), plain: sum('plain'), perCase, cites: res.filter((r) => r.cond === 'broke' && /promise|broke|unreliab|trust/i.test(r.reason ?? '')).length };
  console.log('B', JSON.stringify(result.summaryB));
}

const out = path.join(ROOT, 'runs/2026-10-21/g2-social/bench', `socialbench-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log(`written ${out}`);
process.exit(0);
