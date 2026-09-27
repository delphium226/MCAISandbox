import { TOOLS } from '../../server/src/skills';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const SKILLS = TOOLS.map((t) => `- ${t.name}: ${t.description}`).join('\n');
const SYSTEM = `You are the strategic planner for a player character in a Minecraft-like survival world shared with humans and other AI agents.
A separate, faster executor model carries out your plan one step at a time using these skills:
${SKILLS}

Given the agent's role, objective, situation, previous plan and recent events, call set_plan with a goal and 3-8 steps.
Each step must be concrete, checkable, and achievable with the skills above. Use exact item and block ids.
In creative mode plan building projects the way a player does: find_site, then prepare_site, then build on it.
Structures must not overlap: give each its own space on the plot.
You are a worker in a village building project, doing the task you have claimed from the village task board. The task is
marked done when your plan's steps are all complete, so the steps must fully accomplish it (usually 1-3 steps, e.g.
"prepare_site x=.. z=.. width=.. depth=.." or "build_design cottage at x=.. z=.."). Use the coordinates, plots and designs
the task and the village summary give; never build over another building or on ground someone else is working on.`;
const tool = { type: 'function', function: { name: 'set_plan', description: "Set the agent's goal and an ordered list of steps.", parameters: { type: 'object', properties: { goal: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } }, required: ['goal', 'steps'] } } };
const VILLAGE = `Village Oakridge, objective: two matching cottages and a meeting hall
Prepared plots (level ground; build inside them):
- plot10: x 86..113, z -4..23, ground y=70, by Worker1
Buildings (do not overlap them):
- cottage at x 87..93, z -3..3 by Worker1
Design library (build with build_design):
- "cottage": 7x7, 5 high
- "meeting_hall": 11x11, 6 high`;
const CASES = [
  ['cottage 2 on the plot', `You are planning for Worker2, role: builder, game mode: creative. Replanning because you are free for a new task.\n\n${VILLAGE}\n\nYour task (already claimed) t7: Build cottage 2: Build a cottage using the "cottage" design at x=110, z=0.\nPlan steps that fully accomplish it.`,
   (s: string[]) => s.length <= 2 && /build_design/.test(s[0] ?? '') && /110/.test(s.join(' ')) && !s.some((x) => /find_site|explore|prepare_site/.test(x))],
  ['prepare the plot', `You are planning for Worker1, role: builder, game mode: creative. Replanning because you are free for a new task.\n\nVillage Oakridge, objective: two matching cottages and a meeting hall\n\nYour task (already claimed) t5: Prepare the village plot: Prepare the village plot at x=100, z=10 (size 30x30).\nPlan steps that fully accomplish it.`,
   (s: string[]) => s.length <= 2 && s.some((x) => /prepare_site/.test(x) && /100/.test(x)) && !s.some((x) => /explore|build_design/.test(x))],
  ['meeting hall on the plot', `You are planning for Worker1, role: builder, game mode: creative. Replanning because you are free for a new task.\n\n${VILLAGE}\n\nYour task (already claimed) t8: Build meeting hall: Build a meeting hall using the "meeting_hall" design at x=100, z=15.\nPlan steps that fully accomplish it.`,
   (s: string[]) => s.length <= 2 && /build_design/.test(s.join(' ')) && /meeting_hall/.test(s.join(' ')) && !s.some((x) => /explore|find_site/.test(x))],
] as const;
for (const model of process.argv.slice(2)) {
  console.log(`\n=== ${model}`);
  let right = 0, n = 0, time = 0;
  for (const [name, user, ok] of CASES)
    for (let rep = 0; rep < 2; rep++) {
      const t0 = Date.now();
      const d = await (await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: JSON.stringify({ model, stream: false, think: false, keep_alive: '30m', options: { num_ctx: 8192, temperature: 0.4 }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], tools: [tool] }) })).json() as any;
      const c = d.message?.tool_calls?.[0]?.function; const args = typeof c?.arguments === 'string' ? JSON.parse(c.arguments) : c?.arguments;
      const steps: string[] = (args?.steps ?? []).map(String); const s = (Date.now() - t0) / 1000; const good = ok(steps);
      n++; time += s; if (good) right++;
      console.log(`${s.toFixed(1).padStart(5)}s ${good ? 'ok   ' : 'WEAK '} ${name}: ${steps.map((x, i) => `${i + 1}. ${x}`).join(' | ').slice(0, 200)}`);
    }
  console.log(`${model}: ${right}/${n} tight plans, average ${(time / n).toFixed(1)}s`);
}
