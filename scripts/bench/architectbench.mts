/**
 * M3 (#146): the cathedral architect's prompt on a model (monument.ts' architectPrompt, ARCHITECT_TOOL, checkArchitect):
 * N calls on the same facts, each pick checked as the trigger checks it; prints the picks, the problems and the spread.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/bench/architectbench.mts [N=6] [MODEL=ollama:gpt-oss:120b-cloud]
 *   SCALES=4,2 (the scales offered, N for 1:N), DYES=none (no stained glass), PEEK=1 (raw tool calls), DRAWN=1 (each
 *   call a run of its own: MC_PICK_RANDOM's list of 5 drawn with seed draw<i>; else all 24, as before 11-01)
 */
process.env.MC_MODEL_RECORD ??= '0';
const { callModel, parseSpec } = await import('../../server/src/modelCall');
const mon = await import('../../server/src/monument');
const { setPicks } = await import('../../server/src/shortlist');
const { REASONING } = await import('../../server/src/modelUsage');

const N = Number(process.argv[2] ?? 6);
const spec = parseSpec(process.argv[3] ?? 'ollama:gpt-oss:120b-cloud')!;
const scales = (process.env.SCALES ?? '4,2').split(',').map(Number);
const DRAWN = !!process.env.DRAWN;
setPicks({ random: DRAWN });
const factsFor = (i: number) => {
  if (DRAWN) setPicks({ seed: `draw${i}` });
  return {
    village: 'G1', members: 25, wood: 'spruce',
    // (a census like iron_age_g1's: plenty of yellow, a few blues)
    dyes: process.env.DYES === 'none' ? null : { yellow: 41, light_gray: 12, blue: 7 },
    options: mon.architectOptions(scales, DRAWN ? 'G1' : undefined),
  };
};
console.log(`${mon.architectPrompt(factsFor(0))}\n---`);
const picks: string[] = [];
let bad = 0;
for (let i = 0; i < N; i++) {
  const facts = factsFor(i), user = mon.architectPrompt(facts);
  try {
    const { reply, ms } = await callModel({ spec, system: mon.ARCHITECT_SYSTEM, user, tools: [mon.ARCHITECT_TOOL], level: REASONING.design, agent: 'Bench', kind: 'design', priority: 'plan' });
    const call = reply.calls?.find((c) => c.name === mon.ARCHITECT_TOOL.name);
    if (process.env.PEEK) console.log(JSON.stringify(reply.calls));
    if (!call) {
      bad++;
      console.log(`${i + 1}: no plan_cathedral (${(reply.text ?? '').slice(0, 120)})`);
      continue;
    }
    const r = mon.checkArchitect(call.input as Record<string, unknown>, facts);
    if ('pick' in r) {
      picks.push(`${r.pick.preset} 1:${r.pick.scale}`);
      console.log(`${i + 1} (${(ms / 1000).toFixed(1)} s): ${r.pick.preset} 1:${r.pick.scale}, glass ${JSON.stringify(r.pick.colours)}${r.pick.name ? `, to ${r.pick.name}` : ''}: ${r.pick.reason}`);
    } else {
      bad++;
      console.log(`${i + 1}: sent back: ${r.problems.join('; ')} (${JSON.stringify(call.input).slice(0, 200)})`);
    }
  } catch (e) {
    bad++;
    console.log(`${i + 1}: error ${String((e as Error).message ?? e).slice(0, 160)}`);
  }
}
const spread = new Map<string, number>();
for (const p of picks) spread.set(p, (spread.get(p) ?? 0) + 1);
console.log(`--- ${picks.length} of ${N} good, ${bad} sent back or failed; ${[...spread].map(([p, n]) => `${p} x${n}`).join(', ')}`);
