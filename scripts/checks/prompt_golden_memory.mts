/**
 * The chooser's prompts with members' memory on are rebuilt as G1a sent them (G2, the spec check's M4): prompt_golden.mts
 * covers memory off; this one takes each model decision of G1a (its decision log: context, options, the shuffle's seed)
 * with its memory section and stored last chores read back from the prompt the acts ledger logged, rebuilds the prompt
 * with choose.ts' buildPrompt, and compares system text and user text byte for byte. It checks how buildPrompt assembles
 * a memory-on prompt (every G2 setting at its default), not recall's own text (memory_unit.mts does that).
 *
 *   npx tsx scripts/checks/prompt_golden_memory.mts [CHOICES.jsonl ACTS.jsonl]
 * Defaults: G1a of 10-21 (runs/2026-10-21/g1-memory/g1run/G1a.{choices,acts}.jsonl); skipped (exit 0) when absent.
 */
process.env.MC_MEMORY = 'on';
process.env.MC_CLOCK = 'on';
import fs from 'node:fs';
import { buildPrompt, shuffled } from '../../server/src/choose';
import type { ChoiceMenu, ChoiceOption } from '../../server/src/world';
import type { Recall } from '../../server/src/memory';

const choicesFile = process.argv[2] ?? 'runs/2026-10-21/g1-memory/g1run/G1a.choices.jsonl';
const actsFile = process.argv[3] ?? 'runs/2026-10-21/g1-memory/g1run/G1a.acts.jsonl';
if (!fs.existsSync(choicesFile) || !fs.existsSync(actsFile)) {
  console.log(`SKIP prompt_golden_memory: ${!fs.existsSync(choicesFile) ? choicesFile : actsFile} is not here`);
  process.exit(0);
}
const lines = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
const decisions = new Map<string, Record<string, unknown>>();
for (const r of lines(actsFile)) if (r.type === 'decision' && typeof r.prompt === 'string') decisions.set(`${r.decisionId}|${r.agent}`, r);

let n = 0, same = 0, bad = 0, missing = 0;
const fails: string[] = [];
for (const r of lines(choicesFile)) {
  if (r.type !== 'choice' || r.source !== 'model' || !r.seed || !r.ctx) continue;
  const d = decisions.get(String(r.seed));
  if (!d) {
    missing++;
    continue;
  }
  n++;
  const sent = String(d.prompt);
  const at = sent.indexOf('\nWhat you remember');
  const end = sent.indexOf('\nOptions (in no particular order):');
  let text = at >= 0 ? sent.slice(at + 1, end) : '';
  const dawnLine = text.indexOf('\nThis is your first choice of village day');
  if (dawnLine >= 0) text = text.slice(0, dawnLine);
  const day = Number(/village day (\d+)/.exec(text)?.[1] ?? 0);
  const recall: Recall | null = text ? { text, shown: [], liveIds: [], full: false, dawn: !!d.dawn, day } : null;
  const ctx = r.ctx as { outcomes?: string[] };
  const outLine = /\nYour last chores: (.*)\n/.exec(sent)?.[1] ?? '';
  const outcomes = ctx.outcomes?.length ? undefined : outLine === 'none yet' ? [] : outLine.split(' | ');
  const options = (r.options as Array<Record<string, unknown>>).map((o) => ({ ...o }) as unknown as ChoiceOption);
  const menu = { agent: r.agent, village: r.village, t: r.t, options, guarded: [], reasons: {}, ctx: r.ctx } as unknown as ChoiceMenu;
  const p = buildPrompt(menu, shuffled(options, String(r.seed)), { recall, outcomes });
  if (p.user === sent && p.system === d.system) {
    same++;
    continue;
  }
  // (a need's tag sits on the option line from a field the log leaves out, as in prompt_golden)
  if (options.some((o) => (o as { nw?: number }).nw !== undefined)) continue;
  bad++;
  if (fails.length < 3) {
    let i = 0;
    while (i < sent.length && sent[i] === p.user[i]) i++;
    fails.push(`${r.agent} ${r.id}: first difference at ${i}: sent "${sent.slice(i, i + 80)}" rebuilt "${p.user.slice(i, i + 80)}"${p.system !== d.system ? ' (system differs)' : ''}`);
  }
}
console.log(`${n} memory-on decisions rebuilt: ${same} byte-identical, ${bad} different (${missing} not in the ledger)`);
for (const f of fails) console.log(`  ${f}`);
if (bad || !same) {
  console.log('FAIL prompt_golden_memory');
  process.exit(1);
}
console.log('PASS prompt_golden_memory');
