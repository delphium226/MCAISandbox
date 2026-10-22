/**
 * G5's triage (goal 3; spec runs/2026-10-21/g5-proposals/spec.md 5): members' open proposals handed to a headless Claude
 * Code run with a fixed prompt (proposals.ts' TRIAGE_SYSTEM and triageUser), its verdicts checked and written back with
 * their reasons. The run has no tools (`--tools ""`), no settings, MCP servers or session kept, and works in an empty folder:
 * members' words are data, and nothing in them can act. Uses the user's Claude subscription (`claude -p`).
 *
 * Usage: node_modules/.bin/tsx scripts/triage_proposals.mts --store DIR [--all] [--audit N] [--batch N] [--model M]
 *                                                           [--dry] [--no-write]
 *   --store DIR  the folder holding proposals.json (an agent server's world folder, or an offline draft's)
 *   --all        triage every open (or deferred) proposal, not only those ready (endorsed, or marked for triage)
 *   --audit N    also show the triage N of code's own answers (have, impossible) to see whether it agrees; logged, not applied
 *   --batch N    proposals per run (default 12)
 *   --model M    the CLI's model (default its own)
 *   --dry        no CLI: every verdict "defer" (tests the plumbing)
 *   --no-write   print the verdicts, keep the store as it is
 * Writes DIR/triage_log.jsonl (each run: prompt size, cost, verdicts, problems), DIR/accepted.json (accepted ones with
 * their route and capability: the foundry's queue reads the capabilities, a hook) and DIR/triage_issues.md (issue drafts).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const STORE = opt('--store');
if (!STORE) {
  console.error('usage: triage_proposals.mts --store DIR [--all] [--audit N] [--batch N] [--model M] [--dry] [--no-write]');
  process.exit(2);
}
const ALL = args.includes('--all'), DRY = args.includes('--dry'), WRITE = !args.includes('--no-write');
const AUDIT = Number(opt('--audit', '0')), BATCH = Number(opt('--batch', '12')), MODEL = opt('--model');
const P = await import('../server/src/proposals');
const { offlineCtx } = await import('./proposals_ctx.mts');
const ctx = await offlineCtx();
P.initProposals(STORE);

const all = P.allProposals();
const ready = all.filter((p) => p.status === 'endorsed' || p.status === 'triage' || (ALL && (p.status === 'open' || p.status === 'deferred')));
const audit = all.filter((p) => p.status === 'answered' && p.verdict?.by === 'code').slice(0, AUDIT);
console.log(`[triage] ${all.length} proposals in ${STORE}; ${ready.length} to triage${AUDIT ? `, ${audit.length} of code's answers to audit` : ''}`);
if (!ready.length && !audit.length) process.exit(0);

/** The CLI: on Windows its native exe under npm's folder (spawned without a shell, so the system prompt and the empty
 *  --tools argument pass exactly), else `claude` on the PATH; CLAUDE_BIN overrides. */
const NPM_EXE = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const CLAUDE = process.env.CLAUDE_BIN ?? (process.platform === 'win32' && fs.existsSync(NPM_EXE) ? NPM_EXE : 'claude');

/** One headless run: the reply's text, cost and tokens. */
function runCli(system: string, user: string): { text: string; cost: number; tokens: Record<string, number>; ms: number; error?: string } {
  if (DRY) return { text: JSON.stringify({ verdicts: [...user.matchAll(/"id": "(p\d+)"/g)].map((m) => ({ id: m[1], decision: 'defer', reason: 'dry run', route: 'none', size: 'small' })) }), cost: 0, tokens: {}, ms: 0 };
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-'));
  const cli = ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--setting-sources', '', '--system-prompt', system, '--max-budget-usd', String(Number(opt('--budget', '1'))), ...(MODEL ? ['--model', MODEL] : [])];
  const t0 = Date.now();
  const r = spawnSync(CLAUDE, cli, { cwd, input: user, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
  fs.rmSync(cwd, { recursive: true, force: true });
  if (r.status !== 0 && !r.stdout) return { text: '', cost: 0, tokens: {}, ms: Date.now() - t0, error: `exit ${r.status}: ${(r.stderr || r.error?.message || '').slice(0, 300)}` };
  try {
    const o = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    const u = o.usage ?? {};
    return { text: String(o.result ?? ''), cost: Number(o.total_cost_usd ?? 0), tokens: { in: u.input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, out: u.output_tokens ?? 0 }, ms: Date.now() - t0 };
  } catch {
    return { text: r.stdout, cost: 0, tokens: {}, ms: Date.now() - t0, error: 'the CLI did not answer JSON' };
  }
}

const SYSTEM = P.TRIAGE_SYSTEM;
const log = path.join(STORE, 'triage_log.jsonl');
const accepted: Array<Record<string, unknown>> = fs.existsSync(path.join(STORE, 'accepted.json')) ? JSON.parse(fs.readFileSync(path.join(STORE, 'accepted.json'), 'utf8')) : [];
const issues: string[] = [];
let cost = 0;
const rows: string[] = [];
const auditRows: string[] = [];
const groups: Array<{ ps: typeof all; audit: boolean }> = [];
for (let i = 0; i < ready.length; i += BATCH) groups.push({ ps: ready.slice(i, i + BATCH), audit: false });
if (audit.length) groups.push({ ps: audit, audit: true });
for (const g of groups) {
  const user = P.triageUser(g.ps, ctx.caps);
  const r = runCli(SYSTEM, user);
  cost += r.cost;
  const ids = new Set(g.ps.map((p) => p.id));
  const { verdicts, problems } = r.error ? { verdicts: new Map(), problems: [r.error] } : P.parseTriage(r.text, ids);
  fs.appendFileSync(log, JSON.stringify({ t: Date.now(), audit: g.audit, ids: [...ids], promptChars: SYSTEM.length + user.length, cost: r.cost, tokens: r.tokens, ms: r.ms, verdicts: Object.fromEntries(verdicts), problems, ...(problems.length ? { reply: r.text.slice(0, 2000) } : {}) }) + '\n');
  console.log(`[triage] ${g.audit ? 'audit' : 'batch'} of ${g.ps.length}: ${verdicts.size} verdicts, ${problems.length} problems, $${r.cost.toFixed(3)}, ${Math.round(r.ms / 1000)} s${problems.length ? `: ${problems.slice(0, 3).join('; ')}` : ''}`);
  for (const p of g.ps) {
    const raw = verdicts.get(p.id);
    if (!raw) continue;
    const v = P.guardVerdict(p, raw);
    const line = `${p.id.padEnd(4)} ${p.by.padEnd(7)} ${p.kind.padEnd(8)} code ${p.check.verdict.padEnd(10)} -> ${v.decision.padEnd(6)} ${(v.route ?? '').padEnd(9)} ${p.what.slice(0, 70)}\n       "${v.reason}"`;
    if (g.audit) {
      auditRows.push(`${line}  (code: ${p.check.reason.slice(0, 80)})`);
      continue;
    }
    rows.push(line);
    if (WRITE) P.applyVerdict(p.id, v);
    if (v.decision === 'accept') {
      accepted.push({ id: p.id, by: p.by, kind: p.kind, what: p.what, route: v.route, capability: p.check.capability?.id ?? p.target.capability ?? null, size: v.size, reason: v.reason, notes: v.notes, at: v.at });
      issues.push(`### ${p.id}: ${p.what}\n\nProposed by ${p.by} (${p.source ?? p.village}), ${p.kind}; why: ${p.why}\n\nCode's check: ${p.check.verdict}: ${p.check.reason}\n\nTriage: accept, route ${v.route ?? '?'}, size ${v.size ?? '?'}: ${v.reason}${v.notes ? `\n\nNotes: ${v.notes}` : ''}\n`);
    }
  }
}
P.flushProposals();
if (WRITE) {
  fs.writeFileSync(path.join(STORE, 'accepted.json'), JSON.stringify(accepted, null, 1));
  if (issues.length) fs.appendFileSync(path.join(STORE, 'triage_issues.md'), `${issues.join('\n')}\n`);
}
console.log(rows.join('\n'));
if (auditRows.length) console.log(`[triage] audit of code's answers:\n${auditRows.join('\n')}`);
const by = (k: string) => rows.filter((r) => r.includes(`-> ${k}`)).length;
console.log(`[triage] ${rows.length} verdicts: accept ${by('accept')}, reject ${by('reject')}, defer ${by('defer')}; cost $${cost.toFixed(3)} (the subscription's usage)`);
