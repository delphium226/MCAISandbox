/**
 * wallballotbench (#217 step 1, spec docs/specs/castle-walls.md section 1): the 300 wall ballots trains 20-21 recorded
 * (12 votes, 93 yes), replayed through the new wall ballot (wallBallot.ts: the wall's own frame, the ring stage with its
 * bill and builders' cap, the benefit near home, a neutral "no", the proposer line). Each voter's context is rebuilt from
 * its recorded prompt (persona, pattern, self, village lines), the stage from the old option's facts, the stake from the
 * agent log's last `[danger] P1` line before the vote (hurtNear 0: not counted then) and the proposer from the `keeps
 * watch` lines before it. Treatment: that ballot. Control: the same contexts with no danger (no stake words, no proposer).
 * One sample a context and arm, through castBallot() and the real callModel.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/wallballotbench.mts
 * Env: MODEL (default: the recorded model), THINK (default REASONING.ballot), CONC (ballots at once, default 3),
 *   VOTES (the first N votes, default all 12), OUT (default runs/2026-11-05/castle-walls-build/ballot), REPORT=1 (only
 *   the report from OUT/results.jsonl), DRY=1 (no network), PEEK=1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(ROOT);
process.env.MC_MODEL_RECORD ??= '0';
const { castBallot, buildBallot } = await import('../../server/src/vote');
const { stageOption, noneOption, stakeWords, wallProposer } = await import('../../server/src/wallBallot');
const { parseSpec } = await import('../../server/src/modelCall');
const { REASONING, usage } = await import('../../server/src/modelUsage');
type VoterContext = Parameters<typeof buildBallot>[0];
type WallStake = Parameters<typeof stakeWords>[0];

const OUT = path.join(ROOT, process.env.OUT ?? 'runs/2026-11-05/castle-walls-build/ballot');
fs.mkdirSync(OUT, { recursive: true });
// (TAG=2: a rerun on a revised ballot writes results2.jsonl and report2.md, beside the first run's, and compares the two)
const TAG = process.env.TAG ?? '';
const RESULTS = path.join(OUT, `results${TAG}.jsonl`);

const LOGS: Record<string, string> = {
  'T20 I1': 'runs/2026-11-04/testagents-w4-174352.log',
  'T20 I0': 'runs/2026-11-04/testagents-w5-174354.log',
  'T21 I1': 'runs/2026-11-04/testagents-w4-211309.log',
  'T21 I0': 'runs/2026-11-04/testagents-w5-211311.log',
};
const CALLS = fs.readdirSync(path.join(ROOT, 'runs/model-calls')).filter((f) => f.startsWith('2026-11-04-')).map((f) => path.join(ROOT, 'runs/model-calls', f));

// ---- The votes, their ballots, stake and watch counts from the agent logs ----
interface OldBallot { agent: string; choice: string; reason: string }
interface Vote { train: string; id: string; old: OldBallot[]; stake: WallStake; watch: Record<string, number>; result?: string }
const votes: Vote[] = [];
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
for (const [train, file] of Object.entries(LOGS)) {
  let stake: WallStake = { peak48: 0, deathsNear: 0, deathsMid: 0, deathsFar: 0, hurtNear: 0 };
  const watch: Record<string, number> = {};
  let cur: Vote | null = null;
  for (const raw of fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    let m = /^\[danger\] P1 \(.*?night peaks (\d+)\/\d+\).*?; deaths ([^;]*);/.exec(line);
    if (m) {
      const bin = (b: string) => Number(new RegExp(`(?:^|, )${b.replace(/[+<]/g, '\\$&')} (\\d+)`).exec(m![2])?.[1] ?? 0);
      stake = { peak48: Number(m[1]), deathsNear: bin('<48'), deathsMid: bin('48-100'), deathsFar: bin('100-200') + bin('200+'), hurtNear: 0 };
      continue;
    }
    m = /^\[guard\] P1: (\S+) keeps watch/.exec(line);
    if (m) { watch[m[1]] = (watch[m[1]] ?? 0) + 1; continue; }
    m = /^\[vote\] P1: wall vote (\S+) \(/.exec(line);
    if (m) {
      cur = { train, id: m[1], old: [], stake: { ...stake }, watch: { ...watch } };
      votes.push(cur);
      continue;
    }
    m = /^\[ballot\] P1: (\S+) -> (No wall for now|A wall round the village) \(predicted .*?, shown \d of \d\): (.*)$/.exec(line);
    if (m && cur) { cur.old.push({ agent: m[1], choice: m[2], reason: m[3] }); continue; }
    m = /^\[vote\] P1: (No wall for now|A wall round the village) wins.*?\((A wall round the village \d+, No wall for now \d+)\)/.exec(line);
    if (m && cur) { cur.result = m[2]; cur = null; }
  }
}

// ---- The recorded prompts, matched to the log's ballots by agent and reason ----
interface Rec { agent: string; user: string; reason: string; choice: string }
const recs: Rec[] = [];
for (const f of CALLS) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.includes('"ballot"') || !line.includes('A wall round the village')) continue;
    const d = JSON.parse(line);
    if (d.kind !== 'ballot' || !String(d.user).includes('A wall round the village')) continue;
    const c = d.reply?.calls?.[0]?.input ?? {};
    recs.push({ agent: d.agent, user: d.user, reason: String(c.reason ?? ''), choice: String(c.choice ?? '') });
  }
}

interface Case { vote: Vote; agent: string; ctx: VoterContext; cells: number; parts: number; logs: number; members: number; oldChoice: string; oldReason: string }
const cases: Case[] = [];
const used = new Set<Rec>();
let unmatched = 0;
for (const v of votes) {
  for (const b of v.old) {
    const r = recs.find((x) => !used.has(x) && x.agent === b.agent && x.choice.startsWith(b.choice) && norm(x.reason) === norm(b.reason));
    if (!r) { unmatched++; continue; }
    used.add(r);
    const lines = r.user.split('\n');
    const head = lines.slice(0, lines.findIndex((l) => l.startsWith('The vote:')));
    const ctx: VoterContext = { persona: '', pattern: '', self: '', village: '' };
    const rest: string[] = [];
    for (const l of head) {
      if (l.startsWith('Village: ')) ctx.village = l.slice('Village: '.length);
      else if (l.startsWith('You built ')) ctx.self = l;
      else rest.push(l);
    }
    // (buildBallot writes persona, then pattern: two lines are both; one is the pattern only when it reads as one)
    if (rest.length >= 2) { ctx.persona = rest[0]; ctx.pattern = rest.slice(1).join(' '); }
    else if (rest.length === 1) { if (/^Your (last|own)/.test(rest[0])) ctx.pattern = rest[0]; else ctx.persona = rest[0]; }
    const f = /(\d+) blocks round in (\d+) parts.*?~(\d+) cobblestone and ~(\d+) logs/.exec(r.user);
    if (!f) throw new Error(`no wall facts in ${r.agent}'s prompt`);
    const members = Number(/for (\d+) members/.exec(ctx.village)?.[1] ?? v.old.length);
    cases.push({ vote: v, agent: b.agent, ctx, cells: Number(f[1]), parts: Number(f[2]), logs: Number(f[4]), members, oldChoice: b.choice, oldReason: b.reason });
  }
}
console.log(`${votes.length} votes, ${votes.reduce((n, v) => n + v.old.length, 0)} logged ballots, ${recs.length} recorded prompts, ${cases.length} matched, ${unmatched} unmatched`);
for (const v of votes) console.log(`  ${v.train} ${v.id}: ${JSON.stringify(v.stake)}; watch ${JSON.stringify(v.watch)}; old ${v.result}`);

// ---- The two arms ----
const NO_DANGER: WallStake = { peak48: 0, deathsNear: 0, deathsMid: 0, deathsFar: 0, hurtNear: 0 };
function setup(c: Case, arm: 'treatment' | 'control') {
  const stake = arm === 'treatment' ? c.vote.stake : NO_DANGER;
  const voters = c.vote.old.map((b) => b.agent);
  // (control: no danger, so nobody was moved to propose it either)
  const by = arm === 'treatment' ? wallProposer(c.vote.watch, undefined, voters) : null;
  const lead = [by?.line ?? '', stakeWords(stake)].filter(Boolean).join(' ');
  const cap = Math.max(1, Math.floor(c.members / 6));
  const options = [stageOption({ id: 'wall:yes', kind: 'ring', cells: c.cells, parts: c.parts, bill: { cobblestone: c.cells, logs: c.logs }, water: 'dammed' }, cap), noneOption('wall:no')];
  return { options, ctx: { ...c.ctx, ...(lead ? { lead } : {}) }, lead, by: by?.by };
}

interface Row { vote: string; train: string; agent: string; arm: string; choice: string | null; reason: string; position?: number; why?: string; old: string; oldReason?: string; pt?: number; ot?: number; ms?: number; lead: string }

async function run() {
  const MODEL = process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud';
  const spec = parseSpec(MODEL);
  if (!spec) throw new Error(`MODEL=${MODEL} is not <provider>:<model>`);
  const level = (process.env.THINK?.trim().toLowerCase() || REASONING.ballot) as 'low' | 'medium' | 'high';
  const CONC = Number(process.env.CONC ?? 3);
  const nVotes = Number(process.env.VOTES ?? votes.length);
  const keep = new Set(votes.slice(0, nVotes).map((v) => v.id));
  const dry = process.env.DRY === '1';
  const fake = async (req: { tools: Array<{ input_schema: { properties: { choice: { enum: string[] } } } }> }) =>
    ({ ms: 1, waitMs: 0, reply: { text: '', calls: [{ name: 'vote', input: { reason: 'dry', choice: req.tools[0].input_schema.properties.choice.enum[0] } }], promptTokens: 0, outputTokens: 0 } });
  fs.writeFileSync(RESULTS, '');
  const jobs: Array<() => Promise<void>> = [];
  for (const c of cases.filter((x) => keep.has(x.vote.id))) for (const arm of ['treatment', 'control'] as const) jobs.push(async () => {
    const s = setup(c, arm);
    let b = await castBallot({ voteId: c.vote.id, agent: c.agent, spec, level, options: s.options, predicted: null, ctx: s.ctx, topic: 'wall', ...(dry ? { call: fake as never } : {}) });
    // (a 429, 5xx or budget refusal: wait and try again, slower)
    for (let tries = 0; !b.choice && tries < 4 && /error|budget|timeout/.test(b.why ?? ''); tries++) {
      console.log(`  retry ${c.agent} ${arm}: ${b.why} ${b.reason}`);
      await new Promise((r) => setTimeout(r, 15000 * (tries + 1)));
      b = await castBallot({ voteId: c.vote.id, agent: c.agent, spec, level, options: s.options, predicted: null, ctx: s.ctx, topic: 'wall' });
    }
    const row: Row = { vote: c.vote.id, train: c.vote.train, agent: c.agent, arm, choice: b.choice, reason: b.reason, position: b.position, why: b.why, old: c.oldChoice, oldReason: arm === 'treatment' ? c.oldReason : undefined, pt: b.promptTokens, ot: b.outputTokens, ms: b.ms, lead: s.lead };
    fs.appendFileSync(RESULTS, `${JSON.stringify(row)}\n`);
    done++;
    if (process.env.PEEK || done % 25 === 0) console.log(`${done}/${jobs.length} ${c.agent} ${arm}: ${b.choice ?? `(${b.why})`} ${b.reason.slice(0, 120)}`);
  });
  let done = 0, next = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONC }, async () => { while (next < jobs.length) await jobs[next++](); }));
  console.log(`${jobs.length} ballots in ${Math.round((Date.now() - t0) / 1000)} s (${MODEL}, think ${level})`);
}

// ---- The report ----
const NO_B: Array<[string, RegExp]> = [
  ['own work / other tasks', /prefer|focus|rather|my (own )?(tasks|work)|keep (my|working)|instead|time (on|for)|spend(ing)? time/],
  ['cost: materials/labour', /cobblestone|logs|materials|resources|labou?r|effort|gather|massive|large|huge|cost|expensive|many/],
  ['freedom / confined', /free|freedom|confin|restrict|trap|closed|open/],
  ['deaths are on trips (wall would not help)', /trip|far|away from|over 100|outside the village|out(side)? there/],
  ['explore', /explor/],
];
const YES_B: Array<[string, RegExp]> = [
  ['safety / monsters', /safe|protect|monster|danger|death|die|hostile|zombie/],
  ['torches / light', /torch|light/],
  ['looks / pride', /look|appearance|pride/],
  ['uses my skills', /skill|gather|mining|build/],
];
const EFFECT: [string, RegExp] = ["names the wall's effect or its cost in members' time",
  /keeps? (\w+ )?(out|away)|keep out|at night|nights?\b|one in six|1 in 6|one member in six|builders?\b|chores?\b|at most|only a few|few members|(four|4) members|everyone else|others (can )?keep|spiders?|skeletons?|zombies?|gates?\b|dams?\b|curfew|watch\b|lamps/];
const OWN = /\bmy (own )?(tasks|work|chores)\b|prefer (to )?(focus|keep|stay|spend)|rather (than )?(focus|work)|focus on my/;

const CAP = /one in six|1 in 6|at most|only a few|few members|(four|4) members|everyone else|others (can )?(keep|build)|while others|builders?\b|take (its|the) chores|not (pull|take)|without pulling|hours?\b/;
const SPEC = /keeps? (\w+ )?(out|away)|spiders?|gates?\b|dams?\b|skeletons?|zombies?/;
const TRIPS = new Set(votes.filter((v) => v.stake.deathsMid + v.stake.deathsFar > 0).map((v) => v.id));

/** TAG runs: old / treatment1 / control1 / treatmentN / controlN side by side, the same buckets. */
function compare(out: string[]) {
  const P = (s = '') => out.push(s);
  const load = (f: string): Row[] => fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const r1 = load('results.jsonl'), rN = load(`results${TAG}.jsonl`);
  // (the old ballot as rows: its recorded choice and reason, ids mapped to the new ones)
  const old: Row[] = r1.filter((r) => r.arm === 'treatment').map((r) => ({ ...r, choice: r.old.startsWith('A wall') ? 'wall:yes' : 'wall:no', reason: r.oldReason ?? '' }));
  const cols: Array<[string, Row[]]> = [['old', old], ['treatment1', r1.filter((r) => r.arm === 'treatment')], ['control1', r1.filter((r) => r.arm === 'control')],
    [`treatment${TAG}`, rN.filter((r) => r.arm === 'treatment')], [`control${TAG}`, rN.filter((r) => r.arm === 'control')]];
  const lc = (r: Row) => r.reason.toLowerCase();
  const Y = (r: Row) => r.choice === 'wall:yes', N = (r: Row) => r.choice === 'wall:no';
  const line = (name: string, f: (rs: Row[]) => string) => P(`| ${name} | ${cols.map(([, rs]) => f(rs)).join(' | ')} |`);
  const of = (pred: (r: Row) => boolean, base: (r: Row) => boolean) => (rs: Row[]) => `${rs.filter((r) => base(r) && pred(r)).length} of ${rs.filter(base).length}`;
  P();
  P(`## Run 1 against run ${TAG}`);
  P();
  P(`| | ${cols.map(([n]) => n).join(' | ')} |`);
  P(`|---|${cols.map(() => '---').join('|')}|`);
  line('yes', (rs) => `${rs.filter(Y).length}`);
  line('no', (rs) => `${rs.filter(N).length}`);
  line('abstained', (rs) => `${rs.filter((r) => !r.choice).length}`);
  for (const [name, re] of NO_B) line(`no: ${name}`, of((r) => re.test(lc(r)), N));
  for (const [name, re] of YES_B) line(`yes: ${name}`, of((r) => re.test(lc(r)), Y));
  line(`any: ${EFFECT[0]} (wide)`, of((r) => EFFECT[1].test(lc(r)), (r) => !!r.choice));
  line('any: prefers own work (narrow)', of((r) => OWN.test(lc(r)), (r) => !!r.choice));
  line('no: starts "I prefer"', of((r) => lc(r).startsWith('i prefer'), N));
  line("no: names the builders' cap or the hours", of((r) => CAP.test(lc(r)), N));
  line('no: names what the wall does', of((r) => SPEC.test(lc(r)), N));
  line("yes: names the builders' cap or the hours", of((r) => CAP.test(lc(r)), Y));
  line('yes: names what the wall does', of((r) => SPEC.test(lc(r)), Y));
  line(`yes in the ${TRIPS.size} "trips" votes (deaths away from home shown)`, of(Y, (r) => TRIPS.has(r.vote) && !!r.choice));
  line(`yes in the other ${votes.length - TRIPS.size} votes`, of(Y, (r) => !TRIPS.has(r.vote) && !!r.choice));
  P();
  P(`Narrow keywords: builders' cap or hours \`${CAP.source}\`; what the wall does \`${SPEC.source}\`.`);
}

function report() {
  const rows: Row[] = fs.readFileSync(RESULTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const out: string[] = [];
  const P = (s = '') => out.push(s);
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
  const yes = (r: Row) => r.choice === 'wall:yes';
  P('# Wall ballot bench (#217 step 1)');
  P();
  P(`${rows.length} ballots from ${new Set(rows.map((r) => r.vote)).size} of the ${votes.length} recorded wall votes (trains 20-21), replayed through the new wall ballot (\`server/src/wallBallot.ts\`, topic \`wall\` in \`vote.ts\`). ` +
    'Treatment: the stake each vote had (night peak within 48, deaths by distance; hurtNear 0, not counted then) and the proposer (most `keeps watch` lines before the vote). Control: the same voters with no danger (stakeWords of a zero stake, no proposer). One sample each. Bench: `scripts/bench/wallballotbench.mts`' + (TAG ? ` (TAG=${TAG}: this run's ballots in results${TAG}.jsonl; the first run's in results.jsonl).` : '.'));
  P();
  const arms = ['treatment', 'control'];
  const old = rows.filter((r) => r.arm === 'treatment');
  P('## Counts');
  P();
  P('| arm | yes | no | abstained | yes share |');
  P('|---|---|---|---|---|');
  P(`| old ballot (same voters, recorded) | ${old.filter((r) => r.old.startsWith('A wall')).length} | ${old.filter((r) => r.old.startsWith('No')).length} | 0 | ${pct(old.filter((r) => r.old.startsWith('A wall')).length, old.length)} |`);
  for (const a of arms) {
    const rs = rows.filter((r) => r.arm === a);
    const y = rs.filter(yes).length, n = rs.filter((r) => r.choice === 'wall:no').length, ab = rs.filter((r) => !r.choice).length;
    P(`| ${a} | ${y} | ${n} | ${ab}${ab ? ` (${[...new Set(rs.filter((r) => !r.choice).map((r) => r.why))].join(', ')})` : ''} | ${pct(y, y + n)} |`);
  }
  P();
  P('Yes by shown position (the wall option shown 1st or 2nd): ' + arms.map((a) => {
    const rs = rows.filter((r) => r.arm === a && r.choice);
    const first = rs.filter((r) => (yes(r) ? r.position === 1 : r.position === 2));
    return `${a} ${first.filter(yes).length} of ${first.length} when shown first, ${rs.filter(yes).length - first.filter(yes).length} of ${rs.length - first.length} when second`;
  }).join('; ') + '.');
  P();
  P('## Per vote');
  P();
  P('| train | vote | stake shown (treatment) | old yes/no | treatment yes/no | control yes/no |');
  P('|---|---|---|---|---|---|');
  for (const v of votes) {
    const rs = rows.filter((r) => r.vote === v.id);
    if (!rs.length) continue;
    const t = rs.filter((r) => r.arm === 'treatment'), c = rs.filter((r) => r.arm === 'control');
    const yn = (x: Row[]) => `${x.filter(yes).length}/${x.filter((r) => r.choice === 'wall:no').length}`;
    P(`| ${v.train} | ${v.id} | ${t[0]?.lead || '(none)'} | ${t.filter((r) => r.old.startsWith('A wall')).length}/${t.filter((r) => r.old.startsWith('No')).length} | ${yn(t)} | ${yn(c)} |`);
  }
  P();
  P('## Reason buckets');
  P();
  P('The same keyword buckets as `runs/2026-11-05/castle-walls/walltally.py` (a reason can fall in several), plus the new one, counted over every ballot of the arm. The old ballot\'s counts are its 300 (walltally.txt): no 207 (own work 204, cost 127, freedom 86, explore 85, trips 19), yes 93 (safety 88, skills 38, torches 17, looks 15).');
  P();
  P('| bucket | treatment | control |');
  P('|---|---|---|');
  const cnt = (a: string, pred: (r: Row) => boolean) => rows.filter((r) => r.arm === a && pred(r)).length;
  for (const [name, re] of NO_B) P(`| no: ${name} | ${cnt('treatment', (r) => r.choice === 'wall:no' && re.test(r.reason.toLowerCase()))} of ${cnt('treatment', (r) => r.choice === 'wall:no')} | ${cnt('control', (r) => r.choice === 'wall:no' && re.test(r.reason.toLowerCase()))} of ${cnt('control', (r) => r.choice === 'wall:no')} |`);
  for (const [name, re] of YES_B) P(`| yes: ${name} | ${cnt('treatment', (r) => yes(r) && re.test(r.reason.toLowerCase()))} of ${cnt('treatment', yes)} | ${cnt('control', (r) => yes(r) && re.test(r.reason.toLowerCase()))} of ${cnt('control', yes)} |`);
  const all = (a: string) => cnt(a, (r) => !!r.choice);
  P(`| any: ${EFFECT[0]} | ${cnt('treatment', (r) => !!r.choice && EFFECT[1].test(r.reason.toLowerCase()))} of ${all('treatment')} | ${cnt('control', (r) => !!r.choice && EFFECT[1].test(r.reason.toLowerCase()))} of ${all('control')} |`);
  P(`| any: says it prefers its own work/tasks (narrow: "my tasks/work", "prefer to focus/keep/stay/spend", "focus on my") | ${cnt('treatment', (r) => !!r.choice && OWN.test(r.reason.toLowerCase()))} of ${all('treatment')} | ${cnt('control', (r) => !!r.choice && OWN.test(r.reason.toLowerCase()))} of ${all('control')} |`);
  const oldR = rows.filter((r) => r.arm === 'treatment');
  P(`| the old ballot, same voters: ${EFFECT[0]} | ${oldR.filter((r) => EFFECT[1].test((r.oldReason ?? '').toLowerCase())).length} of ${oldR.length} | |`);
  P(`| the old ballot, same voters: prefers its own work/tasks (narrow) | ${oldR.filter((r) => OWN.test((r.oldReason ?? '').toLowerCase())).length} of ${oldR.length} | |`);
  P();
  P(`The new bucket's keywords: \`${EFFECT[1].source}\`.`);
  P();
  P('The new bucket is wide: "night", "zombies" and "skeletons" catch most safety-minded yes reasons. Two narrower counts, by choice:');
  P();
  P('| arm | choice | ballots | names the builders\' cap / others keep working | names what the wall does (keeps out, gates, dams, spiders, zombies, skeletons) | starts "I prefer" |');
  P('|---|---|---|---|---|---|');
  for (const a of arms) for (const ch of ['wall:yes', 'wall:no']) {
    const rs = rows.filter((r) => r.arm === a && r.choice === ch);
    P(`| ${a} | ${ch === 'wall:yes' ? 'yes' : 'no'} | ${rs.length} | ${rs.filter((r) => CAP.test(r.reason.toLowerCase())).length} | ${rs.filter((r) => SPEC.test(r.reason.toLowerCase())).length} | ${rs.filter((r) => r.reason.toLowerCase().startsWith('i prefer')).length} |`);
  }
  const oldNo = oldR.filter((r) => r.old.startsWith('No'));
  P(`| old ballot | no | ${oldNo.length} | ${oldNo.filter((r) => CAP.test((r.oldReason ?? '').toLowerCase())).length} | ${oldNo.filter((r) => SPEC.test((r.oldReason ?? '').toLowerCase())).length} | ${oldNo.filter((r) => (r.oldReason ?? '').toLowerCase().startsWith('i prefer')).length} |`);
  P();
  P('## Representative reasons');
  P();
  for (const a of arms) {
    P(`### ${a}`);
    P();
    const rs = rows.filter((r) => r.arm === a && r.choice);
    // (spread over votes and choices: up to 4 yes and 4 no in the arm's yes/no proportion, each from a different vote where possible)
    const ys = rs.filter(yes), ns = rs.filter((r) => r.choice === 'wall:no');
    let ky = Math.round((8 * ys.length) / Math.max(1, rs.length));
    ky = Math.min(ys.length, Math.max(ys.length ? 2 : 0, Math.min(6, ky)));
    const pick = (xs: Row[], k: number) => {
      const out2: Row[] = [];
      const step = xs.length / Math.max(1, k);
      for (let i = 0; i < k && i * step < xs.length; i++) out2.push(xs[Math.floor(i * step)]);
      return out2;
    };
    for (const r of [...pick(ys, ky), ...pick(ns, 8 - ky)]) {
      const words = r.reason.split(/\s+/);
      P(`- ${r.agent} (${r.vote}, ${yes(r) ? 'yes' : 'no'}): "${words.slice(0, 25).join(' ')}${words.length > 25 ? ' ...' : ''}"`);
    }
    P();
  }
  P('## What members saw');
  P();
  const ex = (arm: 'treatment' | 'control') => {
    const withLead = cases.find((c) => setup(c, 'treatment').by && c.ctx.persona) ?? cases[0];
    const s = setup(withLead, arm);
    const b = buildBallot(s.ctx, s.options, 'wall');
    P(`### ${arm}: ${withLead.agent}, ${withLead.vote.id} (options in one shown order)`);
    P();
    P('```');
    P(`SYSTEM: ${b.system}`);
    P();
    P(`USER:\n${b.user}`);
    P('```');
    P();
  };
  ex('treatment');
  ex('control');
  const pt = rows.reduce((n, r) => n + (r.pt ?? 0), 0), ot = rows.reduce((n, r) => n + (r.ot ?? 0), 0);
  const usd = usage.cost('ollama:gpt-oss:120b-cloud', pt, ot);
  const ms = rows.map((r) => r.ms ?? 0).sort((a, b) => a - b);
  P('## Cost');
  P();
  P(`${pt} prompt + ${ot} output tokens${usd !== null ? ` (~$${usd.toFixed(3)} at the configured price)` : ''}; latency p50 ${ms[Math.floor(ms.length / 2)] ?? 0} ms, p90 ${ms[Math.floor(ms.length * 0.9)] ?? 0} ms.`);
  if (TAG) compare(out);
  fs.writeFileSync(path.join(OUT, `report${TAG}.md`), `${out.join('\n')}\n`);
  console.log(out.join('\n'));
}

if (process.env.REPORT !== '1') await run();
report();
