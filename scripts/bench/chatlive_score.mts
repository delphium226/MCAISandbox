/**
 * chatlive_score (#233's live tier): scores a scripts/chat_live.py run with the offline bench's own rules and judge
 * (chatbench.mts' CASES, rules, judge), on the talk prompt each member really saw (its call in the model-call recording,
 * runs/model-calls/*.jsonl: agent, kind "talk", ended after the line was said). Beside "said the right thing" it reads
 * what the bench cannot: who the line reached in the world, whether a reply came at all, and for a promise whether its
 * chore started and was kept (the request ledger, saved by chat_live.py).
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/chatlive_score.mts runs/<date>/chat-live/live-HHMMSS.json
 * Env: JUDGE=0 (rules only), MODEL (the judge's, default gpt-oss:120b-cloud), REASK=1 (each talk call asked again with
 * today's talk system prompt and tool, its prompt's fact lines reworded as talkFacts now words them: a fix to the prompt
 * checked on the live prompts, without a live run; promises are then not run, `did` holds; ONLY=regex case ids).
 * Writes <file>.scored.json beside it (<file>.reask.json with REASK).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRespond, talkFacts, talkSystem, talkTool, type Respond } from '../../server/src/playerTalk';
import { CASES, judge, rules, tokens, type Case, type Verdict } from './chatbench.mts';
import { chat } from './benchUtil.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const JUDGE = process.env.JUDGE !== '0';
const REASK = process.env.REASK === '1';
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const MODEL = (process.env.MODEL ?? 'ollama:gpt-oss:120b-cloud').replace(/^ollama:/, '');
const file = process.argv[2];
if (!file) throw new Error('usage: chatlive_score.mts LIVE.json');
const live = JSON.parse(fs.readFileSync(file, 'utf8')) as {
  start: number; end: number;
  results: Array<{ id: string; line: string; to: string[]; t0: number; answered: string[]; requests: string[]; error?: string; setup?: string[];
    ledger?: Array<{ id: string; to: string; via?: string; status: string; kind?: string; option?: string; answer?: string; ran?: number; outcome?: string; closed?: number }> }>;
};

// ---- the talk calls the run made (every recording that was written to during it) -------------------------------------
interface Rec { at: number; agent: string; kind: string; user: string; reply: { calls?: Array<{ name: string; input: Record<string, unknown> }>; text?: string } }
const recs: Rec[] = [];
const dir = path.join(ROOT, 'runs', 'model-calls');
for (const f of fs.readdirSync(dir)) {
  const p = path.join(dir, f);
  if (!f.endsWith('.jsonl') || fs.statSync(p).mtimeMs < live.start) continue;
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!l.includes('"kind":"talk"')) continue;
    try {
      const r = JSON.parse(l) as Rec;
      if (r.at >= live.start - 1000 && r.at <= live.end + 60000) recs.push(r);
    } catch { /* a line cut at the end */ }
  }
}
recs.sort((a, b) => a.at - b.at);
const used = new Set<Rec>();
const callFor = (agent: string, line: string, t0: number) => {
  const r = recs.find((x) => !used.has(x) && x.agent === agent && x.at >= t0 && x.user.includes(line.slice(0, 40)));
  if (r) used.add(r);
  return r;
};
// (the chores list talkUser writes: "Your chores (id: what):" then "- id: name" lines)
const optionsIn = (user: string) => {
  const i = user.indexOf('Your chores (id: what):');
  if (i < 0) return [];
  const out: Array<{ id: string; name: string }> = [];
  for (const l of user.slice(i).split('\n').slice(1)) {
    const m = /^- (\S+): (.+)$/.exec(l.trim());
    if (!m) break;
    out.push({ id: m[1], name: m[2] });
  }
  return out;
};

// ---- REASK: the recorded prompt asked again (fact lines as talkFacts words them today; an empty reply asked once more,
// as talkCall does since #236)
const factLine = (start: string, s: Parameters<typeof talkFacts>[0], role: 'mayor' | 'member') => talkFacts(s, role).find((l) => l.startsWith(start))!;
function relive(user: string): string {
  return user
    .replace(/^- Last night: no record \(no night has passed since the village was counted\)\.$/m, `- ${factLine('Last night', { monsters: true }, 'mayor')}`)
    .replace(/^- You carry: no weapon and no armour\.$/m, `- ${factLine('You carry', { carries: [] }, 'member')}`);
}
async function reask(rec: Rec): Promise<Rec> {
  const role = rec.agent === 'Mayor' ? 'mayor' : 'member';
  const designs = /Pre-designed buildings that match|No pre-designed building matches/.test(rec.user);
  const user = relive(rec.user);
  let reply: Rec['reply'] = {};
  for (let i = 0; i < 2; i++) {
    const r = await chat(MODEL, talkSystem(role, designs), user, [talkTool(role, designs)], { kind: 'talk' });
    reply = { calls: r.calls as Rec['reply']['calls'], text: r.text };
    if (parseRespond(reply, role)) break;
  }
  return { ...rec, user, reply };
}

// (live menus number pens and towers by the world's own order: the bench's pen 4 and 5 and tower 11 are those of its
// fixture; the kind of chore is what is checked here)
function loosen(c: Case): Case {
  const re = (r?: RegExp) => (r ? new RegExp(r.source.replace(/penwork:[45]/g, 'penwork:\\d+').replace(/penwork:4:/g, 'penwork:\\d+:').replace(/castle:t\\d\+/g, 'castle:[tg]\\d+'), r.flags) : r);
  return { ...c, expect: c.expect.map((e) => ({ ...e, option: re(e.option), work: re(e.work) })),
    truth: `LIVE WORLD: the member's prompt (under "What you know now", its chores list, what it carries, what it is doing now) is the true situation; judge against it. The offline bench's scripted situation follows only as background and does NOT hold wherever it differs from the prompt (what a member carries, its health, the storage, last night, its chore now): ${c.truth}` };
}

interface Row { id: string; cat: string; to: string[]; answered: string[]; routeOk: boolean; replies: Array<{ agent: string; kind?: string; option?: string; say?: string; reason?: string; verdict: Verdict; strict: boolean; listed: number; status?: string; ran?: number; outcome?: string; did: string }>; pass: boolean; strict: boolean; said: boolean; did: boolean; note: string }
const rows: Row[] = [];
for (const r of live.results) {
  const c0 = CASES.find((x) => x.id === r.id);
  if (!c0 || (ONLY && !ONLY.test(r.id))) continue;
  const c = loosen(c0);
  const routeOk = r.to.length > 0 && r.answered.length === r.to.length && r.to.every((n) => r.answered.includes(n));
  const replies: Row['replies'] = [];
  for (const agent of r.answered) {
    const led = r.ledger?.find((q) => q.to === agent && !q.via);
    const rec0 = callFor(agent, r.line, r.t0);
    const rec = rec0 && REASK ? await reask(rec0) : rec0;
    const role = agent === 'Mayor' ? 'mayor' : 'member';
    const p: Respond | null = rec ? parseRespond(rec.reply, role) : null;
    let v: Verdict;
    // (strict: the bench's expected kinds; live, a refusal is also right when no chore the case expects is on the member's
    // list now, which the bench's fixed 18-24 chore menu never meets: judged like any refusal)
    let strict = false;
    const options = rec ? optionsIn(rec.user) : [];
    if (!rec || !p) v = { pass: false, fail: led?.status === 'unanswered' ? `no reply (${led.outcome ?? 'unanswered'})` : 'no reply' };
    else {
      v = r.to.includes(agent) || r.id === 'talk.meeting' ? rules(c, agent, p, options, rec.user) : { pass: false, fail: 'answered by another' };
      strict = v.pass;
      const offered = c.expect.some((e) => e.kind === 'promise' && options.some((o) => !e.option || e.option.test(o.id)));
      if (!v.pass && p.kind === 'refuse' && v.fail === 'wrong kind (refuse)' && !offered) v = rules({ ...c, expect: [...c.expect, { kind: 'refuse' }] }, agent, p, options, rec.user);
      if (v.pass && JUDGE && (c.judge || p.kind === 'chat' || p.kind === 'refuse')) v = (await judge(c, rec.user, p, options)).v;
      strict = strict && v.pass;
    }
    // what it did: a promise's chore started (ran) and was kept; a forward reached the Mayor; anything else does nothing
    let did = '-';
    if (p?.kind === 'promise' && REASK) did = 'started (re-ask: not run)';
    else if (p?.kind === 'promise') did = led?.status === 'kept' ? 'kept' : led?.ran ? `started, ${led.status}${led.outcome ? ` (${led.outcome})` : ''}` : led?.status === 'refused' ? 'refused by code (off its list)' : `not started (${led?.status ?? '?'}${led?.outcome ? `: ${led.outcome}` : ''})`;
    else if (p?.kind === 'forward') {
      const m = r.ledger?.find((q) => q.via === agent);
      did = m ? `the Mayor: ${m.status}${m.kind ? ` ${m.kind}` : ''}` : 'never reached the Mayor';
    }
    replies.push({ agent, kind: p?.kind, option: p?.option, say: REASK ? p?.say : led?.answer ?? p?.say, reason: p?.reason, verdict: v, strict, listed: options.length, status: led?.status, ran: led?.ran, outcome: led?.outcome, did });
  }
  const said = replies.length > 0 && replies.every((x) => x.verdict.pass);
  // "did what it said": a promise started its chore within the run (kept or still running); other kinds hold trivially
  const did = replies.length > 0 && replies.every((x) => x.kind !== 'promise' || /^(kept|started)/.test(x.did));
  const pass = routeOk && said && did;
  const strictPass = pass && replies.every((x) => x.strict);
  const note = !r.answered.length ? (r.error ? `error: ${r.error}` : 'nobody answered') : !routeOk ? `routed to ${r.answered.join('+')}, wanted ${r.to.join('+')}` : !said ? replies.filter((x) => !x.verdict.pass).map((x) => `${x.agent}: ${x.verdict.fail}`).join('; ') : !did ? replies.filter((x) => x.kind === 'promise').map((x) => `${x.agent}: ${x.did}`).join('; ') : '';
  rows.push({ id: r.id, cat: c.cat, to: r.to, answered: r.answered, routeOk, replies, pass, strict: strictPass, said, did, note });
  console.log(`${pass ? (strictPass ? 'PASS' : 'pass (true refusal)') : 'FAIL'} ${r.id} -> ${r.answered.join('+') || 'nobody'}${routeOk ? '' : ` (wanted ${r.to.join('+')})`}: ${replies.map((x) => `${x.agent} ${x.kind ?? 'no reply'}${x.option ? ` ${x.option}` : ''} [${x.verdict.pass ? 'ok' : x.verdict.fail}] ${x.listed} chores listed, did ${x.did}`).join('; ')}`);
  for (const x of replies) {
    console.log(`    ${x.agent}: "${(x.say ?? '').slice(0, 180)}"${x.reason ? ` reason "${x.reason.slice(0, 100)}"` : ''}${x.verdict.detail ? `\n      ${x.verdict.pass ? 'judge' : 'why'}: ${x.verdict.detail.slice(0, 200)}` : ''}`);
  }
}

// ---- the scorecard ----------------------------------------------------------------------------------------------------
const cats = ['combat', 'gathering', 'exploring', 'building', 'talk'];
console.log(`\n=== live scorecard (${rows.length} cases, N 1, judge ${JUDGE ? 'on' : 'off'})`);
console.log('category    pass   bench-strict  routed  replied  said right  did what it said');
const line = (name: string, rs: Row[]) => console.log(`${name.padEnd(11)} ${`${rs.filter((r) => r.pass).length}/${rs.length}`.padEnd(6)} ${`${rs.filter((r) => r.strict).length}/${rs.length}`.padEnd(13)} ${`${rs.filter((r) => r.routeOk).length}/${rs.length}`.padEnd(7)} ${`${rs.filter((r) => r.replies.length && r.replies.every((x) => x.kind)).length}/${rs.length}`.padEnd(8)} ${`${rs.filter((r) => r.said).length}/${rs.length}`.padEnd(11)} ${rs.filter((r) => r.did).length}/${rs.length}`);
for (const cat of cats) line(cat, rows.filter((r) => r.cat === cat));
line('all', rows);
const proms = rows.flatMap((r) => r.replies.filter((x) => x.kind === 'promise'));
console.log(`promises ${proms.length}: kept ${proms.filter((x) => x.did === 'kept').length}, started ${proms.filter((x) => /^started/.test(x.did)).length}, not started ${proms.filter((x) => /^not started/.test(x.did)).length}, refused by code ${proms.filter((x) => /^refused/.test(x.did)).length}`);
console.log(`failing: ${rows.filter((r) => !r.pass).map((r) => `${r.id} (${r.note})`).join('; ') || 'none'}`);
console.log(`judge calls ${tokens.calls} (errors ${tokens.errors}); talk calls matched ${used.size} of ${recs.length} recorded in the run`);
fs.writeFileSync(file.replace(/\.json$/, REASK ? '.reask.json' : '.scored.json'), JSON.stringify({ judge: JUDGE, reask: REASK, rows }, null, 1));
process.exit(0);
