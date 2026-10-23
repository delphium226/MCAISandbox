/**
 * rulebench (G3, #30): the council's secret ballot (council.ts ballotPrompt, parseBallot) asked of the real model. Cases:
 * ballots of 1-3 laws of each type (quota, floor, duty, levy, norm), with and without rules already in force, each asked N
 * times with a different member (the yes/no order and the items' order are seeded per member). Measures: valid ballots
 * (every item answered), the yes share by type, abstentions, and whether the first-listed of yes/no is chosen more than
 * the second (position bias, E.6's exit: under 1.5x).
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/rulebench.mts   (env N: samples a case, default 10; CONC 2;
 *   MODEL; DRY=1). Writes runs/2026-10-21/g3-rules/bench/ballotbench-<timestamp>.json.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rulebench-'));
process.env.MC_MEMORY = 'on';
process.env.MC_CLOCK = 'on';
process.env.MC_RULES = 'on';
process.env.MC_COUNCIL = 'on';
process.env.MCAI_ACTS_LOG = path.join(dir, 'acts.jsonl');
const mem = await import('../../server/src/memory');
const rules = await import('../../server/src/rules');
const council = await import('../../server/src/council');
const { callModel, parseSpec } = await import('../../server/src/modelCall');
const { REASONING } = await import('../../server/src/modelUsage');

const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
const spec = parseSpec(MODEL)!;
const N = Number(process.env.N ?? 10), CONC = Math.max(1, Number(process.env.CONC) || 2), DRY = !!process.env.DRY;
const NAMES = ['Ada', 'Ben', 'Clara', 'Dev', 'Elena', 'Finn', 'Grace', 'Hugo', 'Iris', 'Jonah', 'Kai', 'Lena'];
const V = 'Bench';
mem.initMemory(null);
for (const n of NAMES) mem.noteSpawn(V, n, { role: 'worker', brain: 'tiered', memory: {}, reset: true }, 1);
// (REAL=1, 10-23: each member's own persona from Long1's night prompts, and a stake: the even-numbered members took 12 logs
// and 6 torches yesterday, put nothing in and tended no pens; the odd ones took 2 logs, put 3 torches and 3 logs in and
// tended pens; ballots on day 2, so "yesterday" is day 1)
const REAL = !!process.env.REAL;
const epoch = mem.villageMemory(V)!.epoch, dayMs = mem.villageMemory(V)!.dayMs;
const NOW = REAL ? epoch + 1.5 * dayMs : 3;
const PERSONA = new Map<string, string>();
if (REAL) {
  const file = path.join(ROOT, 'runs/model-calls/2026-10-22-46872.jsonl');
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l.includes('"kind":"reflect"')) continue;
    const r = JSON.parse(l) as { agent: string; user: string };
    if (!PERSONA.has(r.agent)) PERSONA.set(r.agent, r.user.split(/\n\nDay \d+ in /)[0]);
  }
  const t = epoch + 0.5 * dayMs;
  NAMES.forEach((n, i) => {
    if (i % 2 === 0) rules.noteTakes(V, n, { birch_log: 12, torch: 6 }, t);
    else {
      rules.noteTakes(V, n, { birch_log: 2 }, t);
      rules.notePuts(V, n, 'make:torch', { torch: 3 }, t);
      rules.notePuts(V, n, 'gather:birch_log', { birch_log: 3 }, t);
      mem.noteEnd(V, n, { kind: 'penwork', option: 'penwork:1:milk', name: 'Tend the pens', ok: true, productive: true, cut: false, minutes: 1, line: 'Tend the pens: done', message: '' }, t);
    }
  });
}

const L = (by: string, what: string) => {
  const l = rules.addLaw(V, by, { what }, 2);
  for (const b of NAMES.filter((x) => x !== by).slice(0, 3)) rules.backLaw(V, l.id, b);
  return l;
};
// (10-23: a village with a green for the zone case)
rules.setZoneVillages(() => ({ name: V, layouts: [{ x1: 0, z1: 0, x2: 40, z2: 40, buildings: [], green: { x1: 10, z1: 10, x2: 20, z2: 20 } }] }) as never);
type NeedItems = Parameters<typeof council.ballotPrompt>[5];
const NEED: NeedItems = { 'need:light': { need: 'light', text: '9 unlit spots in 3 buildings', options: [{ id: 'A', name: 'Light the houses', option: 'light' }, { id: 'B', name: 'Make torches', option: 'make:torch' }, { id: 'C', name: 'Put up street lamps', option: 'light:streets' }] } };
const cases: Array<{ name: string; items: ReturnType<typeof L>[]; needs?: NeedItems }> = [
  { name: 'quota', items: [L('Ada', 'Each member takes at most 8 logs a day from storage')] },
  { name: 'floor', items: [L('Ben', 'Storage keeps at least 32 bread')] },
  { name: 'duty', items: [L('Clara', 'Every member tends pens once a day')] },
  { name: 'levy', items: [L('Dev', 'A levy of 20% on every share')] },
  { name: 'norm', items: [L('Elena', 'Members greet each other at the storage hut')] },
  { name: 'three', items: [L('Finn', 'Each member takes at most 4 torches a day from storage'), L('Grace', 'Storage keeps at least 16 torch'), L('Hugo', 'Every member lights the village once a day')] },
  // (10-23: the members' own commonest rule, a zone, and the need vote, alone and beside a law)
  { name: 'contribute', items: [L('Iris', 'Each member puts at least 2 torches into storage a day')] },
  { name: 'zone', items: [L('Jonah', 'Nothing new is built on the green')] },
  { name: 'need', items: [], needs: NEED },
  { name: 'need+law', items: [L('Kai', 'Each member puts at least 2 logs into storage a day')], needs: NEED },
];
for (const c of cases) for (const l of c.items) if (l.status !== 'open') throw new Error(`case ${c.name}: ${l.what} is ${l.status} (${l.refused})`);

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

const jobs = cases.flatMap((c) => Array.from({ length: N }, (_, s) => async () => {
  const agent = NAMES[s % NAMES.length];
  const p = council.ballotPrompt(V, agent, c.items, PERSONA.get(agent) ?? '', NOW, c.needs);
  const burdened = REAL && NAMES.indexOf(agent) % 2 === 0;
  const firstWord = /then (yes|no) or/.exec(p.user)?.[1];
  const firstNeed = /two days\? ([A-D]):/.exec(p.user)?.[1];
  if (DRY) return { case: c.name, agent, dry: true, chars: p.user.length, prompt: s === 0 ? p.user : undefined };
  try {
    const r = await callModel({ spec, system: p.system, user: p.user, tools: p.tools as never, level: REASONING.ballot, agent, kind: 'ballot', priority: 'ballot', maxWaitMs: 120000, fallbackMs: 120000 });
    const call = r.reply.calls.find((x) => x.name === 'vote') ?? r.reply.calls[0];
    const votes = council.parseBallot(call?.input ?? r.reply.text.slice(r.reply.text.indexOf('{'), r.reply.text.lastIndexOf('}') + 1), c.items, c.needs, p.order);
    return { case: c.name, agent, votes, valid: [...c.items.map((l) => l.id), ...Object.keys(c.needs ?? {})].every((id) => votes[id]), firstWord, firstNeed, burdened, prompt: s < 2 ? p.user : undefined, raw: JSON.stringify(call?.input ?? r.reply.text).slice(0, 400) };
  } catch (e) {
    return { case: c.name, agent, error: String((e as Error).message).slice(0, 160) };
  }
}));
const res = await pool(jobs);
const valid = res.filter((x) => (x as { valid?: boolean }).valid).length;
const by: Record<string, { yes: number; no: number; abstain: number }> = {};
let first = 0, decided = 0;
for (const x of res as Array<{ case: string; votes?: Record<string, string>; firstWord?: string }>) {
  for (const v of Object.values(x.votes ?? {})) {
    const b = (by[x.case] ??= { yes: 0, no: 0, abstain: 0 }) as Record<string, number>;
    b[v] = (b[v] ?? 0) + 1;
    if (v === 'yes' || v === 'no') {
      decided++;
      if (v === x.firstWord) first++;
    }
  }
}
// (a need item's first-shown choice taken, against a third by chance with three choices)
let nFirst = 0, nDecided = 0;
for (const x of res as Array<{ votes?: Record<string, string>; firstNeed?: string }>) {
  const v = x.votes?.['need:light'];
  if (v && /^[A-D]$/.test(v)) {
    nDecided++;
    if (v === x.firstNeed) nFirst++;
  }
}
// (REAL: the yes share of members a rule burdened yesterday against those it did not, on quota, contribute and duty)
const stakeYes: Record<string, { yes: number; n: number }> = {};
for (const x of res as Array<{ case: string; votes?: Record<string, string>; burdened?: boolean }>) {
  if (!REAL || !['quota', 'contribute', 'duty', 'three'].includes(x.case)) continue;
  for (const v of Object.values(x.votes ?? {})) {
    if (v !== 'yes' && v !== 'no') continue;
    const k = x.burdened ? 'burdened' : 'not burdened';
    const s = (stakeYes[k] ??= { yes: 0, n: 0 });
    s.n++;
    if (v === 'yes') s.yes++;
  }
}
const summary = { real: REAL, stakeYes, calls: res.length, valid: `${valid}/${res.length}`, byCase: by, firstListedShare: decided ? Math.round((first / decided) * 100) / 100 : null, needFirstShownShare: nDecided ? Math.round((nFirst / nDecided) * 100) / 100 : null };
console.log(JSON.stringify(summary));
const out = path.join(ROOT, 'runs/2026-10-23/g3-rules/bench', `rulebench-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ model: MODEL, summary, res }, null, 1));
console.log(`written ${out}`);
process.exit(0);
