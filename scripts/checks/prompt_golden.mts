/**
 * The chooser's prompts with members' memory off are those of a real run, byte for byte (G1, #26; the spec check's B1):
 * the model decisions of a recorded run (its decision log: context, options with their facts, the shuffle's seed) are
 * rebuilt with choose.ts' buildPrompt and compared with the prompts the model was sent (the run's model-call record), the
 * system text with them. The choose tool's schema with memory off is checked too: reason and choice, nothing else.
 *
 *   npx tsx scripts/checks/prompt_golden.mts [CHOICES.jsonl MODEL_CALLS.jsonl]
 * Defaults: LSc1 of 10-21 (runs/2026-10-21/live-scorecard/lsc/LSc1.choices.jsonl, runs/model-calls/2026-10-21-45656.jsonl);
 * skipped (exit 0) when they are not on this machine. Fails if any rebuilt prompt is not among the recorded ones, beyond
 * those whose options carry fields the decision log does not keep (a need's tag), which are counted apart.
 */
process.env.MC_MEMORY = 'off';
process.env.MC_CLOCK = 'off';
import fs from 'node:fs';
import { buildPrompt, shuffled } from '../../server/src/choose';
import type { ChoiceMenu, ChoiceOption } from '../../server/src/world';

const choicesFile = process.argv[2] ?? 'runs/2026-10-21/live-scorecard/lsc/LSc1.choices.jsonl';
const callsFile = process.argv[3] ?? 'runs/model-calls/2026-10-21-45656.jsonl';
if (!fs.existsSync(choicesFile) || !fs.existsSync(callsFile)) {
  console.log(`SKIP prompt_golden: ${!fs.existsSync(choicesFile) ? choicesFile : callsFile} is not here`);
  process.exit(0);
}

const lines = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
const systems = new Map<string, string>();
const sent = new Map<string, Set<string>>();
for (const r of lines(callsFile)) {
  if (r.type === 'system') systems.set(String(r.hash), String(r.system));
  else if (r.kind === 'choose') {
    const k = String(r.agent);
    if (!sent.has(k)) sent.set(k, new Set());
    sent.get(k)!.add(`${systems.get(String(r.system)) ?? r.system}\u0000${r.user}`);
  }
}

let n = 0, same = 0, unlogged = 0, bad = 0;
const fails: string[] = [];
for (const r of lines(choicesFile)) {
  if (r.type !== 'choice' || r.source !== 'model' || !r.seed || !r.ctx) continue;
  const opts = (r.options as Array<Record<string, unknown>>).filter((o) => typeof o.shown === 'number');
  if (!opts.length) continue;
  n++;
  // (the options the model was shown, as ChoiceOptions; the shuffle reorders them by the seed as choose() did)
  const options = (r.options as Array<Record<string, unknown>>).map((o) => ({ ...o }) as unknown as ChoiceOption);
  const menu = { agent: r.agent, village: r.village, t: r.t, options, guarded: [], reasons: {}, ctx: r.ctx } as unknown as ChoiceMenu;
  const shownOrder = shuffled(options, String(r.seed));
  const p = buildPrompt(menu, shownOrder);
  const key = `${p.system}\u0000${p.user}`;
  if (sent.get(String(r.agent))?.has(key)) {
    same++;
    continue;
  }
  // (a need's tag "[...]" sits on the option line from a field the log leaves out)
  if (options.some((o) => (o as { nw?: number }).nw !== undefined)) {
    unlogged++;
    continue;
  }
  bad++;
  if (fails.length < 3) fails.push(`${r.agent} ${r.id}: ${p.user.slice(0, 300)}`);
}

// The tool with memory off: reason and choice only
const one = { id: 'x', kind: 'make', key: 'make:x', name: 'Make x', facts: '', effect: '', rank: 1 } as unknown as ChoiceOption;
const t = buildPrompt({ agent: 'A', village: 'V', t: 0, options: [one], guarded: [], reasons: {}, ctx: { persona: '', village: '', others: '', outcomes: [] } } as ChoiceMenu, [one]).tools[0];
const props = Object.keys((t.input_schema as { properties: Record<string, unknown> }).properties).join(',');
const toolOk = props === 'reason,choice' && JSON.stringify((t.input_schema as { required: string[] }).required) === '["reason","choice"]';

console.log(`${n} model decisions rebuilt: ${same} byte-identical to the prompts sent, ${unlogged} with a need's weight (fields not logged), ${bad} different; tool ${toolOk ? 'unchanged' : `CHANGED (${props})`}`);
for (const f of fails) console.log(`  differs: ${f}`);
if (bad || !toolOk || !same) {
  console.log('FAIL prompt_golden');
  process.exit(1);
}
console.log('PASS prompt_golden');
