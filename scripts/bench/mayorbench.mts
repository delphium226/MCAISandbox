// The mayor's planner on the situations that went wrong in village runs, with the brain's real system prompt and tools,
// several times each: does it find a site and draw designs first, call plan_layout (not write tasks itself), and wait
// while the layout's tasks are under way? Run: node_modules/.bin/tsx scripts/bench/mayorbench.mts [model] [times]
// (default ollama gpt-oss:120b-cloud, 5 times; OLLAMA_URL for another server). PEEK=1 prints the raw tool calls.
import { TOOLS } from '../../server/src/skills';
import { plannerPrompt } from '../../server/src/tieredBrain';

const MODEL = process.argv[2] ?? 'gpt-oss:120b-cloud';
const TIMES = Number(process.argv[3] ?? 5);
const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const { system, tools } = plannerPrompt('mayor', TOOLS, true);

const obs = '{"position":"-12,63,-82","biome":"savanna","time":"day","health":20,"food":20,"holding":null,"inventory":{},"visibleBlocks":{"acacia_log":"12 seen, nearest -5,64,-80"},"nearby":["Worker1 at -9,63,-80 (3m)","Worker2 at -10,63,-79 (4m)"]}';
const head = (why: string, objective: string) => `You are planning for Mayor, role: mayor, game mode: survival. Replanning because ${why}.\n\nObjective: ${objective}`;
const village = (objective: string, extra: string) => `Village Sunhollow, objective: ${objective}\n${extra}`;

type Call = { name: string; input: Record<string, unknown> };
const steps = (c: Call[]) => ((c.find((x) => x.name === 'set_plan')?.input.steps as unknown[]) ?? []).map((s) => (typeof s === 'string' ? s : JSON.stringify(s)));
const layout = (c: Call[]) => c.find((x) => x.name === 'plan_layout');
const posted = (c: Call[]) => ((c.find((x) => x.name === 'post_tasks')?.input.tasks as unknown[]) ?? []).length;
const workerJob = /\b(collect|mine|craft|smelt|place|deposit|withdraw|prepare_site|build_design|build_box|gather)\b/i;
const names = (c: Call[]) => ((layout(c)?.input.buildings as unknown[]) ?? []).map((b) => String(typeof b === 'object' && b ? (b as Record<string, unknown>).design ?? (b as Record<string, unknown>).name : b).toLowerCase()).sort().join(',');

const CASES: Array<[string, string, (c: Call[]) => boolean]> = [
  ['first plan: site and designs', [
    head('there is no plan yet', 'one small cottage'),
    village('one small cottage', ''),
    'Previous plan:\n(no plan yet)', 'Events since the last plan:\n- [system] You are Mayor, a mayor. You just arrived in the world.', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => steps(c).some((s) => /find_site/.test(s)) && steps(c).some((s) => /design_building/.test(s)) && !steps(c).some((s) => workerJob.test(s) && !/design_building|find_site/.test(s)) && !posted(c)],
  ['site found, design ready: plan_layout', [
    head('you found a site (find_site finished: site found: centre x=-12 z=-82, ground y=63, 30x30, height range 1): draw any design still missing, then call plan_layout', 'one small cottage'),
    village('one small cottage', 'Design library (build with build_design):\n- "cottage": 7x7, 5 high, a small oak cottage'),
    'Previous plan:\nGoal: choose the site and draw the cottage\n[x] 1. find_site size=30\n[x] 2. design_building name=cottage', 'Events since the last plan:\n- [action_done] find_site finished: site found: centre x=-12 z=-82\n- [system] design "cottage" saved: 7x7', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => names(c) === 'cottage' && !posted(c)],
  ['layout under way: wait', [
    head('no step has been completed for 3 minutes', 'one small cottage'),
    village('one small cottage', 'Prepared plots (level ground; build inside them):\n- plot1: x -18..-6, z -88..-76, ground y=63, by Worker1\nDesign library (build with build_design):\n- "cottage": 7x7, 5 high, a small oak cottage\nVillage storage (deposit / withdraw; chest at -12,64,-72): 12 cobblestone, 4 acacia_log\nTask board:\n- t2 [claimed by Worker2] Gather 17 cobblestone for cottage (1/2): collect block=cobblestone count=17, then deposit item=all\n- t3 [claimed by Worker1] Gather 12 logs for cottage (1/2): collect block=logs count=12, then deposit item=all\n- t4 [open] Gather 11 logs for cottage (2/2) (after t9)\n- t5 [open] Build cottage (after t0, t2, t3, t4): build_design "cottage" x=-12 z=-82\n- t0 [done by Worker1] Prepare the village plot\n- t9 [done by Worker2] Set up the village storage'),
    'Previous plan:\nGoal: coordinate the village (waiting)', 'Events since the last plan:\n- [system] Laid out 1 buildings on a 13x13 plot ... and posted 8 tasks. Now wait for the workers.', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => !posted(c) && !layout(c) && !steps(c).some((s) => workerJob.test(s))],
  ['two cottages and a hall: plan_layout', [
    head('you found a site (find_site finished: site found: centre x=40 z=-100, ground y=70, 30x30, height range 1): draw any design still missing, then call plan_layout', 'two matching cottages and a meeting hall'),
    village('two matching cottages and a meeting hall', 'Design library (build with build_design):\n- "cottage": 7x7, 5 high, a small oak cottage\n- "meeting_hall": 11x11, 6 high, a hall of planks and cobblestone'),
    'Previous plan:\nGoal: site and designs\n[x] 1. find_site size=30\n[x] 2. design_building name=cottage\n[x] 3. design_building name=meeting_hall', 'Events since the last plan:\n- [action_done] find_site finished: site found: centre x=40 z=-100', `Observation:\n${obs}`,
  ].join('\n\n'), (c) => names(c) === 'cottage,cottage,meeting_hall' && !posted(c)],
];

console.log(`=== ${MODEL}, ${TIMES} times each`);
let good = 0, total = 0;
for (const [label, user, ok] of CASES) {
  let n = 0;
  const times: number[] = [];
  for (let i = 0; i < TIMES; i++) {
    const t0 = Date.now();
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({
        model: MODEL, stream: false, think: false, options: { num_ctx: 8192, temperature: 0.4 },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      }),
    });
    const data = (await res.json()) as { message?: { tool_calls?: Array<{ function: { name: string; arguments: unknown } }> } };
    const calls: Call[] = (data.message?.tool_calls ?? []).map((c) => ({ name: c.function.name, input: (typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments) : c.function.arguments) as Record<string, unknown> }));
    times.push(Date.now() - t0);
    const pass = ok(calls);
    if (pass) n++;
    if (process.env.PEEK || !pass) console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(calls).slice(0, 400)}`);
  }
  good += n;
  total += TIMES;
  console.log(`${n}/${TIMES}  ${label}  (${(times.reduce((s, t) => s + t, 0) / times.length / 1000).toFixed(1)}s avg)`);
}
console.log(`${MODEL}: ${good}/${total}`);
