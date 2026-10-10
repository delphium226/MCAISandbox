/**
 * How a model holds up when several agents call it at once (A.0: every role on one cloud model). Each round sends one
 * executor turn alone (the baseline), then N at once, each timed from its own start; errors (429s, 5xx, network) are
 * counted, never thrown. The prompt is the brain's executor prompt and tools on execbench's "build cottage on prepared
 * plot" case with 20 event lines as a busy turn has them. Every request, the baseline included, starts its system prompt
 * with a unique line, so no two share a prefix and a provider's prefix cache does not flatter the result (in real runs
 * the system prompt and tools are shared, so this measures the cold case). The throughput factor counts answered calls
 * only: a 429 is not served work.
 * Usage: tsx scripts/bench/concurrency.mts [model=gpt-oss:120b-cloud] [N=3] [ROUNDS=3]
 * Env: THINK, OLLAMA_URL, PEEK=1 (one full reply's eval_count, thinking and content lengths: is thinking billed as output?).
 */
import { TOOLS } from '../../server/src/skills';
import { EXEC_SYSTEM, toolsFor } from '../../server/src/tieredBrain';
import { chat, header, PEEK, percentile, type ChatResult } from './benchUtil.mts';

const MODEL = process.argv[2] ?? 'gpt-oss:120b-cloud';
const N = Number(process.argv[3] ?? 3);
const ROUNDS = Number(process.argv[4] ?? 3);
const tools = toolsFor(TOOLS).exec;

// execbench's first case, with the events a worker's turn carries in a busy village
const VILLAGE = `Village Oakridge, objective: two matching cottages and a meeting hall
Prepared plots (level ground; build inside them):
- plot10: x 86..113, z -4..23, ground y=70, by Worker1
Buildings (do not overlap them):
- cottage at x 87..93, z -3..3 by Worker1
Design library (build with build_design):
- "cottage": 7x7, 5 high, A cozy cottage with oak log corners
- "meeting_hall": 11x11, 6 high, A stone brick hall`;
const OBS = JSON.stringify({ position: '110,71,5', biome: 'savanna', time: 'day', health: 20, food: 20, holding: 'oak_planks', inventory: { oak_planks: 41, oak_log: 6, cobblestone: 23, glass_pane: 8, oak_door: 1, stick: 4, wooden_pickaxe: 1, dirt: 3 }, visibleBlocks: { grass_block: '300 seen, nearest 110,70,4', oak_log: '4 seen, nearest 96,71,-8', chest: '2 seen, nearest 104,71,26' }, nearby: ['Worker1 at 99,71,12 (14m)', 'Mayor at 104,71,24 (20m)'], currentAction: null, queuedActions: 0 });
const EVENTS = [
  '[system] New plan: Build cottage 2',
  '[action_done] move_to finished: arrived at 104,71,24',
  '[action_done] withdraw finished: took 32 oak_planks from the chest at 104,71,26 (storage has 9 left)',
  '[action_done] withdraw finished: took 23 cobblestone from the chest at 106,71,26 (storage has 0 left)',
  '[action_failed] withdraw failed: the storage has no glass_pane (needed 8); gather sand and smelt glass, or ask the mayor',
  '[chat] Worker1: I have 8 glass panes from the furnace, putting them in the chest now',
  '[action_done] wait finished: waited 10 s',
  '[action_done] withdraw finished: took 8 glass_pane from the chest at 104,71,26 (storage has 0 left)',
  '[pickup] picked up 2 oak_sapling',
  '[action_done] craft finished: crafted 1 oak_door from 6 oak_planks',
  '[action_done] move_to finished: arrived at 110,71,5',
  '[chat] Mayor: Worker2, the cottage at 110,0 is yours; the hall goes at 100,15 after it',
  '[action_failed] build_design failed: short of materials for the cottage: 9 oak_planks (carrying 41, storage has 9). To get them: withdraw oak_planks count=9',
  '[action_done] withdraw finished: took 9 oak_planks from the chest at 104,71,26 (storage has 0 left)',
  '[pickup] picked up 1 stick',
  '[system] t9 "Gather 12 logs for meeting_hall (1/2)" claimed by Worker1',
  '[chat] Worker1: going north for logs, back in a few minutes',
  '[action_done] move_to finished: arrived at 110,71,5',
  '[system] Task t7 is still yours: Build cottage 2',
];
const USER = `You are Worker2, role: builder, game mode: creative.\nObjective: two matching cottages and a meeting hall\n\n${VILLAGE}\n\nYour task t7: Build cottage 2: Build a cottage using the "cottage" design at x=110, z=0.\n\nPlan:\nGoal: Build cottage 2 using the 'cottage' design at x=110, z=0 on the prepared plot\n-> 1. build_design cottage at x=110 z=0\n\nWhat happened since your last turn:\n${EVENTS.map((e) => `- ${e}`).join('\n')}\n\nObservation:\n${OBS}`;

// (the unique line goes first: the system prompt and tools come before the user turn in the rendered prompt)
const turn = (round: number, i: number) => chat(MODEL, `Request ${round}.${i} at ${Date.now()}.\n${EXEC_SYSTEM}`, USER, tools, { kind: 'exec' });
const s = (ms: number) => (ms / 1000).toFixed(1);
const show = (label: string, r: ChatResult) =>
  console.log(`  ${label.padEnd(8)} ${s(r.ms).padStart(6)}s  status ${r.status}  ${r.promptTokens} prompt / ${r.outputTokens} output tokens, thinking ${r.thinking?.length ?? 0} chars${r.ok ? ` -> ${r.calls.map((c) => c.name).join(', ') || '(no call)'}` : `  ERROR ${r.error}`}`);

header('concurrency', MODEL, 'exec');
console.log(`N=${N} at once, ${ROUNDS} rounds`);
const singles: number[] = [], medians: number[] = [], maxes: number[] = [], factors: number[] = [], answered: number[] = [];
const all: ChatResult[] = [];
let firstPrompt: number | undefined;
for (let round = 1; round <= ROUNDS; round++) {
  console.log(`round ${round}`);
  const one = await turn(round, 0);
  all.push(one);
  show('single', one);
  if (one.ok) firstPrompt ??= one.promptTokens;
  if (PEEK && round === 1 && one.ok) {
    // Ladder step 3a: thinking comes as message.thinking and is counted in eval_count
    console.log(`  PEEK eval_count ${one.raw?.eval_count ?? 'MISSING'}, prompt_eval_count ${one.raw?.prompt_eval_count ?? 'MISSING'}, thinking ${one.thinking?.length ?? 0} chars, content ${one.text.length} chars, ${one.calls.length} tool calls`);
    console.log(`  PEEK thinking: ${one.thinking ?? '(none)'}`);
    console.log(`  PEEK calls: ${JSON.stringify(one.calls)}${one.text ? `\n  PEEK content: ${one.text}` : ''}`);
  }
  const many = await Promise.all(Array.from({ length: N }, (_, i) => turn(round, i + 1)));
  all.push(...many);
  many.forEach((r, i) => show(`#${i + 1}`, r));
  // Latency figures from answered calls only (an error's time says nothing about the model)
  const ms = many.filter((r) => r.ok).map((r) => r.ms);
  if (!one.ok || !ms.length) {
    console.log(`  round ${round}: not counted (${one.ok ? 'every concurrent call failed' : 'the single call failed'})`);
    continue;
  }
  const med = percentile(ms, 0.5), max = Math.max(...ms), min = Math.min(...ms);
  singles.push(one.ms); medians.push(med); maxes.push(max);
  // Served work per round: answered calls x single / max (3 answers and three 429s at single speed is 3, not N)
  factors.push((ms.length * one.ms) / max); answered.push(ms.length);
  console.log(`  round ${round}: single ${s(one.ms)}s, concurrent min ${s(min)} / median ${s(med)} / max ${s(max)}, spread ${s(max - min)}s, ${ms.length} of ${N} answered`);
}

const mean = (v: number[]) => (v.length ? v.reduce((t, x) => t + x, 0) / v.length : 0);
const count = (f: (r: ChatResult) => boolean) => all.filter(f).length;
console.log(`\nsummary ${MODEL}, N=${N}, ${singles.length} of ${ROUNDS} rounds counted:`);
if (singles.length) {
  const single = mean(singles), max = mean(maxes);
  console.log(`  mean single ${s(single)}s, mean concurrent median ${s(mean(medians))}s, mean max ${s(max)}s`);
  console.log(`  slowdown (max / single) ${(max / single).toFixed(2)}x, throughput factor (answered x single / max, mean per round) ${mean(factors).toFixed(2)}, mean ${mean(answered).toFixed(1)} of ${N} answered`);
}
console.log(`  errors: ${count((r) => r.status === 429)} x 429, ${count((r) => r.status >= 500)} x 5xx, ${count((r) => !r.ok && r.status === 0)} network or timeout, ${count((r) => !r.ok && r.status > 0 && r.status < 500 && r.status !== 429)} other, of ${all.length} calls`);
console.log(`  first call's prompt_eval_count: ${firstPrompt ?? 'n/a'} tokens`);
