/**
 * Compare models for the planner / architect jobs: raw speed, a mayor planning turn (post_tasks with coordinates) and
 * two designs checked by the project's own validator. Usage: tsx modelbench.ts model1 model2 ...
 */
import { DESIGN_SYSTEM, DESIGN_TOOL, validateDesign } from '../../server/src/designs';
import { TOOLS } from '../../server/src/skills';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';


const obj = (p: Record<string, unknown>, r: string[] = []) => ({ type: 'object', properties: p, required: r });

async function chat(model: string, system: string, user: string, tools: Array<{ name: string; description?: string; input_schema: unknown }>, maxTokens?: number) {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false, think: false, keep_alive: '30m',
      options: { num_ctx: 8192, temperature: 0.4, ...(maxTokens ? { num_predict: maxTokens } : {}) },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    }),
    signal: AbortSignal.timeout(300000),
  });
  const d = (await res.json()) as any;
  if (d.error) throw new Error(d.error);
  const calls = (d.message?.tool_calls ?? []).map((c: any) => ({ name: c.function.name, input: typeof c.function.arguments === 'string' ? JSON.parse(c.function.arguments) : c.function.arguments }));
  return {
    ms: Date.now() - t0, loadS: (d.load_duration ?? 0) / 1e9,
    promptTok: d.prompt_eval_count, promptS: (d.prompt_eval_duration ?? 0) / 1e9,
    outTok: d.eval_count, tokPerS: d.eval_count / Math.max(1e-9, (d.eval_duration ?? 1) / 1e9),
    calls, text: d.message?.content ?? '',
  };
}

const SKILLS = TOOLS.map((t) => `- ${t.name}: ${t.description}`).join('\n');
const PLANNER = `You are the strategic planner for a player character in a Minecraft-like survival world shared with humans and other AI agents.
A separate, faster executor model carries out your plan one step at a time using these skills:
${SKILLS}
Given the agent's role, objective, situation, previous plan and recent events, call set_plan with a goal and 3-8 steps.
You are the mayor. You coordinate; you do not build or prepare land yourself. Workers claim tasks from the task board,
one at a time in the order posted, and do the physical work. Once you know the site, post the rest with post_tasks,
always with absolute coordinates: designs (one task per kind of building), 'Prepare the village plot' (prepare_site at
x, z with width and depth), then one task per building (build_design "name" at x, z inside the plot, after the design and
land tasks). Space footprints so there are 3-block streets between buildings.`;
const MAYOR_TOOLS = [
  { name: 'set_plan', description: 'Set your own next steps.', input_schema: obj({ goal: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } }, ['goal', 'steps']) },
  { name: 'post_tasks', description: 'Add tasks to the village task board. after lists indexes of earlier tasks in this call that must be done first.', input_schema: obj({ tasks: { type: 'array', items: obj({ title: { type: 'string' }, detail: { type: 'string' }, after: { type: 'array', items: {} } }, ['title', 'detail']) } }, ['tasks']) },
];
const MAYOR_USER = `You are planning for Mayor, role: mayor, game mode: creative. Replanning because you found a site (site found: centre x=166 z=-10, ground y=70, 30x30, height range 2, 0 tree blocks to clear): post the land and building tasks for it now.
Objective: two matching cottages and a meeting hall
Village Oakridge, objective: two matching cottages and a meeting hall
Previous plan:
Goal: choose the village site
[x] 1. find_site size 30
Observation: {"position":"166,71,-10","biome":"savanna","time":"day","inventory":{}}`;

function judgeTasks(calls: any[]) {
  const post = calls.find((c) => c.name === 'post_tasks');
  if (!post) return `no post_tasks (calls: ${calls.map((c) => c.name).join(', ') || 'none'})`;
  const tasks = post.input.tasks ?? [];
  const withCoords = tasks.filter((t: any) => /x\s*=?\s*-?\d+.*z\s*=?\s*-?\d+|-?\d+\s*,\s*-?\d+/i.test(`${t.title} ${t.detail}`)).length;
  const kinds = tasks.map((t: any) => t.title).join(' | ');
  return `${tasks.length} tasks, ${withCoords} with coordinates, ${tasks.filter((t: any) => (t.after ?? []).length).length} with prerequisites: ${kinds}`;
}

const BRIEFS: Array<[string, string]> = [
  ['cottage', 'A small cozy cottage for two villagers: oak planks walls, oak log corners, cobblestone floor, glass windows, about 7x7.'],
  ['meeting_hall', 'A meeting hall for the whole village: stone bricks and spruce, large windows, about 11x11.'],
];

for (const model of process.argv.slice(2)) {
  console.log(`\n=== ${model}`);
  try {
    // Warm up (loads the model; its load time is reported, not counted)
    const w = await chat(model, 'You are terse.', 'Say ok.', [], 5);
    console.log(`load ${w.loadS.toFixed(1)}s`);
    const p = await chat(model, PLANNER, MAYOR_USER, MAYOR_TOOLS);
    if (process.env.PEEK) console.log(JSON.stringify(p.calls, null, 1).slice(0, 2500)); // raw tool calls
    console.log(`mayor turn: ${(p.ms / 1000).toFixed(1)}s (prompt ${p.promptTok} tok in ${p.promptS.toFixed(1)}s, ${p.outTok} tok out at ${p.tokPerS.toFixed(0)} tok/s): ${judgeTasks(p.calls)}`);
    for (const [name, brief] of BRIEFS) {
      let user = `Design a building named "${name}". Brief: ${brief}`;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const r = await chat(model, DESIGN_SYSTEM, user, [DESIGN_TOOL]);
        const call = r.calls.find((c: any) => c.name === 'submit_design');
        const v = call ? validateDesign({ ...call.input, name }, 'bench', { isPlaceable: () => true }) : { errors: ['no submit_design call'] as string[] };
        const ok = 'design' in v && v.design;
        console.log(`design ${name} try ${attempt}: ${(r.ms / 1000).toFixed(1)}s, ${r.outTok} tok at ${r.tokPerS.toFixed(0)} tok/s: ${ok ? `valid ${v.design!.width}x${v.design!.depth}x${v.design!.height}, ${v.design!.blocks} blocks${v.fixes?.length ? ` (fixed: ${v.fixes.join(', ')})` : ''}` : `INVALID: ${v.errors.slice(0, 3).join('; ')}`}`);
        if (ok) break;
        user += `\n\nYour previous design had problems; fix them and submit again:\n- ${v.errors.join('\n- ')}`;
      }
    }
  } catch (e) {
    console.log(`error: ${(e as Error).message}`);
  }
}
