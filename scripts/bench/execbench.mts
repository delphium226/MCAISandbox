/**
 * Executor benchmark: real executor system prompt and skill tools, worker situations taken from the Oakridge run where
 * the executors went wrong. Scores whether the first call is the right skill with sensible arguments, and the latency.
 * Usage: tsx execbench.mts model1 model2 ...
 */
import { TOOLS } from '../../server/src/skills';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';

const EXEC_SYSTEM = `You control a player character in a Minecraft-like survival world shared with humans and other AI agents.
A planner has given you a goal and steps. Each turn you get the plan (the current step is marked), what happened since your
last turn (including whether your previous actions succeeded or failed), and a JSON observation.

Call skill tools to make progress on the CURRENT step; calls run in order as a queue, so prefer 1-3 purposeful calls.
When the observation shows the current step is already done, call step_done (you may also queue the first action of the next step).
If the step is impossible or makes no sense any more, call request_replan with the reason.
Urgent things come first: reply briefly and in character when someone talks to you, eat when food is low, and fight or flee
monsters that attack you. If an action failed, try a different approach instead of repeating it. Use exact item and block ids.
For building, prefer one build or build_box call over many place calls; their results say how many blocks were placed or skipped.`;

const obj = (p: Record<string, unknown>, r: string[] = []) => ({ type: 'object', properties: p, required: r, additionalProperties: false });
const EXTRA = [
  { name: 'step_done', description: 'Mark the current plan step as complete (only when the observation shows it is done).', input_schema: obj({}) },
  { name: 'design_building', description: 'Have the architect draw a new building design and add it to the design library, ready for build_design.', input_schema: obj({ name: { type: 'string' }, brief: { type: 'string' } }, ['name', 'brief']) },
  { name: 'request_replan', description: 'Ask the planner for a new plan because the current step is impossible or the situation changed.', input_schema: obj({ reason: { type: 'string' } }, ['reason']) },
];
const tools = [...TOOLS, ...EXTRA];

const VILLAGE = `Village Oakridge, objective: two matching cottages and a meeting hall
Prepared plots (level ground; build inside them):
- plot10: x 86..113, z -4..23, ground y=70, by Worker1
Buildings (do not overlap them):
- cottage at x 87..93, z -3..3 by Worker1
Design library (build with build_design):
- "cottage": 7x7, 5 high, A cozy cottage with oak log corners
- "meeting_hall": 11x11, 6 high, A stone brick hall`;
const OBS = (pos: string) => JSON.stringify({ position: pos, biome: 'savanna', time: 'day', health: 20, food: 20, holding: null, inventory: {}, visibleBlocks: { grass_block: '300 seen, nearest 110,70,4', oak_log: '4 seen, nearest 96,71,-8' }, nearby: [], currentAction: null, queuedActions: 0 });

const CASES: Array<{ name: string; user: string; ok: (c: { name: string; input: any }[]) => string | null }> = [
  {
    name: 'build cottage on prepared plot',
    user: `You are Worker2, role: builder, game mode: creative.\nObjective: two matching cottages and a meeting hall\n\n${VILLAGE}\n\nYour task t7: Build cottage 2: Build a cottage using the "cottage" design at x=110, z=0.\n\nPlan:\nGoal: Build cottage 2 using the 'cottage' design at x=110, z=0 on the prepared plot\n-> 1. build_design cottage at x=110 z=0\n\nWhat happened since your last turn:\n- [system] New plan: Build cottage 2\n\nObservation:\n${OBS('110,71,5')}`,
    ok: (c) => (c[0]?.name === 'build_design' && /cottage/i.test(c[0].input.design) && Math.abs(c[0].input.x - 110) <= 1 && Math.abs(c[0].input.z) <= 1 ? null : 'expected build_design cottage at 110,0'),
  },
  {
    name: 'prepare the plot (not explore)',
    user: `You are Worker1, role: builder, game mode: creative.\nObjective: two matching cottages and a meeting hall\n\nVillage Oakridge, objective: two matching cottages and a meeting hall\n\nYour task t5: Prepare the village plot: Prepare the village plot at x=100, z=10 (size 30x30) to clear trees and level the ground.\n\nPlan:\nGoal: Prepare the village plot at x=100, z=10\n-> 1. prepare_site x=100 z=10 width=30 depth=30\n\nWhat happened since your last turn:\n- none\n\nObservation:\n${OBS('122,72,0')}`,
    ok: (c) => (c[0]?.name === 'prepare_site' && Math.abs(c[0].input.x - 100) <= 1 && Math.abs(c[0].input.z - 10) <= 1 ? null : 'expected prepare_site at 100,10'),
  },
  {
    name: 'design missing: draw it',
    user: `You are Worker1, role: builder, game mode: creative.\nObjective: two matching cottages and a meeting hall\n\n${VILLAGE.replace(/- "meeting_hall".*\n?/, '')}\n\nYour task t8: Build meeting hall: Build a meeting hall using the "meeting_hall" design at x=100, z=20.\n\nPlan:\nGoal: Build the meeting hall at x=100, z=20\n-> 1. build_design meeting_hall at x=100 z=20\n\nWhat happened since your last turn:\n- [action_failed] build_design failed: no design called "meeting_hall" (available: "cottage"); if it is not drawn yet, draw it first with design_building name="meeting_hall" and a short brief, then build it\n\nObservation:\n${OBS('100,71,26')}`,
    ok: (c) => (c[0]?.name === 'design_building' && /meeting/i.test(c[0].input.name) ? null : 'expected design_building meeting_hall'),
  },
  {
    name: 'step already done',
    user: `You are Worker1, role: builder, game mode: creative.\n\n${VILLAGE}\n\nPlan:\nGoal: Build cottage 1 at x=90, z=0\n-> 1. build_design cottage at x=90 z=0\n\nWhat happened since your last turn:\n- [action_done] build_design finished: cottage recorded in village Oakridge at x 87..93, z -3..3; placed 169 blocks, cleared 0\n\nObservation:\n${OBS('90,71,6')}`,
    ok: (c) => (c.some((x) => x.name === 'step_done') && !c.some((x) => x.name === 'build_design') ? null : 'expected step_done (and no rebuild)'),
  },
];

async function turn(model: string, user: string) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false, think: false, keep_alive: '30m', options: { num_ctx: 8192, temperature: 0.4 },
      messages: [{ role: 'system', content: EXEC_SYSTEM }, { role: 'user', content: user }],
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    }),
    signal: AbortSignal.timeout(300000),
  });
  const d = (await res.json()) as any;
  if (d.error) throw new Error(d.error);
  const calls = (d.message?.tool_calls ?? []).map((c: any) => ({ name: c.function.name, input: typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments) : c.function.arguments }));
  return { s: (Date.now() - t0) / 1000, calls, promptTok: d.prompt_eval_count, outTok: d.eval_count };
}

for (const model of process.argv.slice(2)) {
  console.log(`\n=== ${model}`);
  await turn(model, 'Say ok.').catch(() => {}); // load
  let right = 0, total = 0, time = 0;
  for (const c of CASES)
    for (let rep = 0; rep < 2; rep++) {
      try {
        const r = await turn(model, c.user);
        const bad = c.ok(r.calls);
        total++; time += r.s; if (!bad) right++;
        console.log(`${r.s.toFixed(1).padStart(5)}s ${bad ? 'WRONG' : 'ok   '} ${c.name}: ${r.calls.map((x: any) => `${x.name}(${JSON.stringify(x.input)})`).join(' ').slice(0, 170) || '(no call)'}${bad ? ` -- ${bad}` : ''}`);
      } catch (e) {
        console.log(`error ${c.name}: ${(e as Error).message}`);
      }
    }
  console.log(`${model}: ${right}/${total} right, average ${(time / Math.max(1, total)).toFixed(1)}s per executor turn`);
}
