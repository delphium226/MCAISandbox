/**
 * Two-tier LLM brain: a slow "planner" model sets a goal and a short list of steps, and a fast "executor"
 * model turns the current step plus the latest observation into skill calls every few seconds.
 *
 * Each tier can run on a different model and provider, set as "<provider>:<model>":
 *   MC_EXEC_MODEL   executor, default "ollama:gemma4:31b"
 *   MC_PLAN_MODEL   planner, default: same as the executor. "none" disables automatic planning, so plans only come
 *                   from outside (POST /api/agents/:name/memory {"plan": {"goal": "...", "steps": ["..."]}}).
 * Providers: "ollama" (local or :cloud models via the Ollama server) and "anthropic" (Claude, needs credentials).
 * Other settings: MC_OLLAMA_URL (default http://localhost:11434), MC_OLLAMA_CTX (context length, default 8192:
 * enough for these prompts, and it keeps a ~20 GB model like gemma4:31b entirely on a 24 GB GPU),
 * MC_PLAN_INTERVAL_MS (replan when no step completes for this long, default 180000), MC_LLM_INTERVAL_MS (idle executor interval).
 *
 * Per agent, memory.execModel and memory.planModel (same form) override these, so agents on different models can share
 * a world; memory.stats records call counts, average latency and action outcomes for comparing models.
 *
 * memory.objective (a sentence, e.g. "build a small village") steers every plan.
 *
 * The plan lives in agent.memory.plan (and long-term notes in agent.memory.notes), so it can be read or replaced
 * through the memory API. Spawn with `/agent spawn Ada farmer tiered`.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Agent, AgentEvent } from './agents';
import type { AgentBrain } from './brains';
import { TOOLS as SKILL_TOOLS } from './llmBrain';
import { DESIGN_SYSTEM, DESIGN_TOOL, validateDesign } from './designs';
import type { Design, Village } from './village';

const OLLAMA_URL = process.env.MC_OLLAMA_URL ?? 'http://localhost:11434';
const OLLAMA_CTX = Number(process.env.MC_OLLAMA_CTX ?? 8192);
const EXEC_INTERVAL_MS = Number(process.env.MC_LLM_INTERVAL_MS ?? 6000);
const PLAN_INTERVAL_MS = Number(process.env.MC_PLAN_INTERVAL_MS ?? 180000);

// ---------------------------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------------------------

interface ModelSpec { provider: 'ollama' | 'anthropic'; model: string }
interface ToolDef { name: string; description?: string; input_schema: unknown }
interface ToolCall { name: string; input: Record<string, unknown> }
interface Reply { calls: ToolCall[]; text: string; promptTokens?: number; loadMs?: number }

function parseSpec(s: string | undefined): ModelSpec | null {
  if (!s || s === 'none') return null;
  const i = s.indexOf(':');
  const head = i > 0 ? s.slice(0, i) : '';
  if (head === 'ollama' || head === 'anthropic') return { provider: head, model: s.slice(i + 1) };
  return { provider: s.startsWith('claude-') ? 'anthropic' : 'ollama', model: s };
}

const EXEC_SPEC = parseSpec(process.env.MC_EXEC_MODEL ?? 'ollama:gemma4:31b')!;
const PLAN_SPEC = process.env.MC_PLAN_MODEL === undefined ? EXEC_SPEC : parseSpec(process.env.MC_PLAN_MODEL);
const label = (s: ModelSpec) => `${s.provider}:${s.model}`;

let anthropic: Anthropic | null = null;

async function complete(spec: ModelSpec, system: string, user: string, tools: ToolDef[]): Promise<Reply> {
  return spec.provider === 'ollama' ? completeOllama(spec.model, system, user, tools) : completeAnthropic(spec.model, system, user, tools);
}

async function completeOllama(model: string, system: string, user: string, tools: ToolDef[]): Promise<Reply> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: '30m',
      options: { num_ctx: OLLAMA_CTX, temperature: 0.4 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as {
    message?: { content?: string; tool_calls?: Array<{ function: { name: string; arguments: unknown } }> };
    prompt_eval_count?: number;
    load_duration?: number;
  };
  // Ollama silently drops the start of prompts that overflow the context window.
  if ((data.prompt_eval_count ?? 0) > OLLAMA_CTX * 0.9) console.warn(`[tiered] ${model}: prompt used ${data.prompt_eval_count}/${OLLAMA_CTX} tokens; raise MC_OLLAMA_CTX`);
  const text = data.message?.content ?? '';
  const calls: ToolCall[] = (data.message?.tool_calls ?? []).map((c) => ({ name: c.function.name, input: toArgs(c.function.arguments) }));
  return { calls: calls.length ? calls : callsFromText(text), text, promptTokens: data.prompt_eval_count, loadMs: (data.load_duration ?? 0) / 1e6 };
}

async function completeAnthropic(model: string, system: string, user: string, tools: ToolDef[]): Promise<Reply> {
  anthropic ??= new Anthropic();
  const response = await anthropic.beta.messages.create({
    model,
    max_tokens: 4000,
    // Refusal fallback applies to the models that ship safety classifiers; effort is not supported on Haiku 4.5.
    ...(/^claude-(opus-5|fable)/.test(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    ...(/^claude-(opus|sonnet-5|fable)/.test(model) ? { output_config: { effort: 'low' as const } } : {}),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    tools: tools as Anthropic.Beta.BetaTool[],
    messages: [{ role: 'user', content: user }],
  });
  const u = response.usage;
  const promptTokens = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  if (response.stop_reason === 'refusal') return { calls: [], text: '(request declined)', promptTokens };
  const calls: ToolCall[] = [];
  let text = '';
  for (const b of response.content) {
    if (b.type === 'tool_use') calls.push({ name: b.name, input: (b.input ?? {}) as Record<string, unknown> });
    else if (b.type === 'text') text += b.text;
  }
  return { calls, text, promptTokens };
}

function toArgs(a: unknown): Record<string, unknown> {
  if (typeof a === 'string') {
    try { return JSON.parse(a) as Record<string, unknown>; } catch { return {}; }
  }
  return (a ?? {}) as Record<string, unknown>;
}

/** Smaller local models sometimes write tool calls as JSON text instead of using the tool-call channel. */
function callsFromText(text: string): ToolCall[] {
  const body = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const start = body.search(/[[{]/);
  if (start < 0) return [];
  try {
    const parsed = JSON.parse(body.slice(start).trim()) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string')
      .map((c) => ({ name: String(c.name), input: toArgs(c.arguments ?? c.parameters ?? c.input) }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------------------------
// Prompts and tools
// ---------------------------------------------------------------------------------------------

interface Plan { goal: string; steps: string[]; step: number; by: string; tick: number; taskId?: string }

const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties: props, required, additionalProperties: false });

const PLAN_TOOLS: ToolDef[] = [{
  name: 'set_plan',
  description: 'Set the agent\'s goal and an ordered list of 3-8 concrete steps for the executor to carry out.',
  input_schema: obj({
    goal: { type: 'string', description: 'What the agent is working toward over the next few minutes.' },
    steps: { type: 'array', items: { type: 'string' }, description: 'Ordered, checkable steps, e.g. "Collect 6 logs", "Craft a wooden_pickaxe".' },
    notes: { type: 'string', description: 'Optional long-term notes to remember (base location, where ores were seen, promises made to others). Replaces the previous notes.' },
  }, ['goal', 'steps']),
}];

const SET_PLAN = PLAN_TOOLS[0];

/** The mayor coordinates: it posts tasks, may act itself, and declares the objective met. */
const MAYOR_PLAN_TOOLS: ToolDef[] = [
  {
    ...SET_PLAN,
    description: 'Set your own next steps (e.g. announce plans in chat, find_site to choose the village centre, design_building). Use an empty steps list to wait while workers do the tasks.',
    input_schema: obj({ goal: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, ['goal', 'steps']),
  },
  {
    name: 'post_tasks',
    description: 'Add tasks to the village task board for workers to claim. Each needs a clear title and detail (where, what size, which design); after lists task ids, or indexes of earlier tasks in this call, that must be done first.',
    input_schema: obj({
      tasks: { type: 'array', items: obj({ title: { type: 'string' }, detail: { type: 'string' }, after: { type: 'array', items: {} } }, ['title', 'detail']) },
    }, ['tasks']),
  },
  { name: 'declare_complete', description: 'Declare the village objective achieved (only when the village summary shows it).', input_schema: obj({ summary: { type: 'string' } }, ['summary']) },
];

const WORKER_ROLE = `
You are a worker in a village building project, doing the task you have claimed from the village task board. The task is
marked done when your plan's steps are all complete, so the steps must fully accomplish it (usually 1-3 steps, e.g.
"prepare_site x=.. z=.. width=.. depth=.." or "build_design cottage at x=.. z=.."). Use the coordinates, plots and designs
the task and the village summary give; never build over another building or on ground someone else is working on.`;

const MAYOR_ROLE = `
You are the mayor. You coordinate; you do not build or prepare land yourself. Workers claim tasks from the task board,
one at a time in the order posted, and do the physical work.
First choose where the village goes: if the village has no plot and you have no find_site result yet, set_plan with a
find_site step sized for the whole village (e.g. size 30 for four small buildings plus streets) and post only the design
tasks. Once you know the site, post the rest with post_tasks, always with absolute coordinates:
1. Designs, one task per kind of building: 'Design "cottage"' with a brief (style, materials, size up to 11x11).
2. Land: 'Prepare the village plot': prepare_site at x, z (the site centre) with width and depth.
3. Buildings: one task per building: 'Build cottage 1': build_design "cottage" at x, z (inside the plot), after the design
   and land tasks. Space footprints (design width x depth) so there are 3-block streets between buildings.
Keep each task specific enough that a worker can do it without asking. Review the board when it changes: re-post failed
tasks with a fix, add follow-ups, and call declare_complete once the summary shows the objective is met. Use set_plan
only for your own steps (find_site, chat once to announce, design_building), or with an empty list to wait.`;

const EXEC_TOOLS: ToolDef[] = [
  ...SKILL_TOOLS,
  { name: 'step_done', description: 'Mark the current plan step as complete (only when the observation shows it is done).', input_schema: obj({}) },
  {
    name: 'design_building',
    description: 'Have the architect (the planner model) draw a new building design and add it to the design library, ready for build_design. Takes about half a minute. Give a short name and a brief: purpose, style, materials, rough size (up to 15x15).',
    input_schema: obj({ name: { type: 'string' }, brief: { type: 'string' } }, ['name', 'brief']),
  },
  { name: 'request_replan', description: 'Ask the planner for a new plan because the current step is impossible or the situation changed.', input_schema: obj({ reason: { type: 'string' } }, ['reason']) },
];

/** What the mayor may do itself: look around, talk, design; building and land work are for workers. */
const MAYOR_EXEC = new Set(['move_to', 'follow', 'chat', 'wait', 'explore', 'find_site', 'look_at', 'step_done', 'design_building', 'request_replan']);
const MAYOR_EXEC_TOOLS = EXEC_TOOLS.filter((t) => MAYOR_EXEC.has(t.name));
const CHAT_TOOLS = EXEC_TOOLS.filter((t) => t.name === 'chat');

const SKILL_SUMMARY = SKILL_TOOLS.map((t) => `- ${t.name}: ${t.description}`).join('\n');

const PLAN_SYSTEM = `You are the strategic planner for a player character in a Minecraft-like survival world shared with humans and other AI agents.
A separate, faster executor model carries out your plan one step at a time using these skills:
${SKILL_SUMMARY}

Given the agent's role, objective, situation, previous plan and recent events, call set_plan with a goal and 3-8 steps.
If an objective is given, every plan must work toward it.
Each step must be concrete, checkable from the inventory or surroundings, and achievable with the skills above
(e.g. "Collect 8 logs", "Craft 4 oak_planks into a crafting_table", "Smelt 3 raw_iron"). Build on what the agent already has.
Follow the usual progression: wood -> crafting table -> wooden pickaxe -> stone tools -> furnace -> coal and iron -> iron tools.
Keep the agent alive (food, night, monsters) and fit the role. Use exact item and block ids.
In creative mode the agent cannot be hurt, has unlimited blocks (get_item, and build supplies its own) and needs no gathering:
plan building projects the way a player does: find_site (never guess coordinates: the ground may be water or a cliff),
then prepare_site to fell trees and level a plot big enough for the project plus room to walk (a 7x7 house needs about 11x11,
several buildings need a bigger plot), then build on it. Prefer build_design with a design from the village design library;
add a step to design_building when the village needs a new kind of building (a design is reusable, so similar buildings
match). build (simple hut/house/wall) and build_box (custom shapes) also work.
Structures must not overlap: give each its own space on the plot. To grow a settlement, prepare the neighbouring area with the
same y as the existing plot, then build there.`;

const EXEC_SYSTEM = `You control a player character in a Minecraft-like survival world shared with humans and other AI agents.
A planner has given you a goal and steps. Each turn you get the plan (the current step is marked), what happened since your
last turn (including whether your previous actions succeeded or failed), and a JSON observation.

Call skill tools to make progress on the CURRENT step; calls run in order as a queue, so prefer 1-3 purposeful calls.
When the observation shows the current step is already done, call step_done (you may also queue the first action of the next step).
If the step is impossible or makes no sense any more, call request_replan with the reason.
Urgent things come first: reply briefly and in character when someone talks to you, eat when food is low, and fight or flee
monsters that attack you. If an action failed, try a different approach instead of repeating it. Use exact item and block ids.
For building, prefer one build or build_box call over many place calls; their results say how many blocks were placed or skipped.`;

/** Blocks that rarely matter for decisions; dropping them keeps prompts short (prompt size dominates local-model latency). */
const FILLER = /leaves|grass|fern|bush|flower|dandelion|poppy|tulip|orchid|allium|bluet|daisy|granite|diorite|andesite|^dirt$|^snow$|vine|sapling/;

/** A trimmed, flattened observation: ~3x fewer tokens than the raw one. */
function compactObservation(a: Agent) {
  const o = a.observe(12);
  const p = o.position;
  const d2 = ([x, y, z]: [number, number, number]) => (x - p.x) ** 2 + (y - p.y) ** 2 + (z - p.z) ** 2;
  const blocks = Object.entries(o.nearbyBlocks)
    .filter(([name]) => !FILLER.test(name))
    .sort((x, y) => d2(x[1].nearest) - d2(y[1].nearest))
    .slice(0, 20);
  const entities = o.nearbyEntities
    .filter((e) => e.kind !== 'item' || e.distance <= 16)
    .slice(0, 10)
    .map((e) => `${e.name ?? e.kind}${e.kind === 'item' ? ' (dropped item)' : ''} id=${e.id}${e.health !== undefined ? ` hp=${e.health}` : ''} at ${Math.round(e.x)},${Math.round(e.y)},${Math.round(e.z)} (${e.distance}m)`);
  return {
    position: `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}`,
    biome: o.biome,
    time: o.isDay ? 'day' : 'night',
    health: o.health,
    food: o.food,
    ...(o.dead ? { dead: true } : {}),
    holding: o.holding,
    inventory: o.inventory,
    ...(o.equipment.some(Boolean) ? { armor: o.equipment.filter(Boolean) } : {}),
    visibleBlocks: Object.fromEntries(blocks.map(([name, b]) => [name, `${b.count} seen, nearest ${b.nearest.join(',')}`])),
    nearby: entities,
    currentAction: o.currentAction ? `${o.currentAction.type} ${JSON.stringify(o.currentAction.args)}` : null,
    queuedActions: o.queuedActions,
  };
}

const formatEvents = (events: AgentEvent[], max: number) =>
  events.slice(-max).map((e) => `- [${e.type}] ${e.text}`).join('\n') || '- none';

/** Prepared building plots (from prepare_site), so plans can build on and extend them. */
function formatPlots(a: Agent): string {
  const v = a.village();
  if (v) return a.manager.villages.summary(v, a.player.name);
  const plots = a.memory.plots as Array<{ x1: number; z1: number; x2: number; z2: number; y: number }> | undefined;
  if (!plots?.length) return '';
  return 'Prepared plots (level ground):\n' + plots.map((p) => `- x ${p.x1}..${p.x2}, z ${p.z1}..${p.z2}, ground y=${p.y}`).join('\n');
}

function villageRole(a: Agent): 'mayor' | 'worker' | null {
  if (!a.village()) return null;
  return a.memory.villageRole === 'mayor' ? 'mayor' : 'worker';
}

/** The claimed task, spelled out for the planner and executor. */
function formatTask(v: Village | undefined, p: Plan | undefined): string {
  const t = v && p?.taskId ? v.tasks.find((x) => x.id === p.taskId) : undefined;
  return t ? `Your task ${t.id}: ${t.title}: ${t.detail}` : '';
}

function formatPlan(p: Plan | undefined): string {
  if (!p) return '(no plan yet)';
  if (!p.steps.length) return `Goal: ${p.goal} (waiting)`;
  return `Goal: ${p.goal}\n` + p.steps.map((s, i) => `${i < p.step ? '[x]' : i === p.step ? '-> ' : '[ ]'} ${i + 1}. ${s}`).join('\n');
}

// ---------------------------------------------------------------------------------------------
// Brain
// ---------------------------------------------------------------------------------------------

const REPEAT_BLOCK_MS = 5 * 60 * 1000;
/** Minimum time between an agent's chat messages. */
const CHAT_GAP_MS = 30 * 1000;
const callKey = (name: string, args: Record<string, unknown>) =>
  `${name}(${JSON.stringify(Object.keys(args).sort().map((k) => [k, args[k]]))})`;

export class TieredBrain implements AgentBrain {
  name = 'tiered';
  private execPending = false;
  private planPending = false;
  private lastExec = 0;
  private lastPlan = 0;
  private seenExec = 0;
  private seenPlan = 0;
  private urgent = false;
  private replanReason: string | null = null;
  private failuresSincePlan = 0;
  private notes: string[] = [];
  private progressKey = '';
  private lastProgress = 0;
  /** Calls (name + arguments) that failed, with when and why: repeating one that failed twice is refused for a while. */
  private failed = new Map<string, { count: number; at: number; why: string }>();
  private lastChat = 0;
  /** Calls made in the last couple of minutes, to catch loops of identical successful calls. */
  private recent: Array<{ key: string; at: number }> = [];
  /** Task board state the mayor last planned on. */
  private boardSeen = '';
  /** Task claimed for the plan being made (workers claim before asking the planner). */
  private claimedTask: string | undefined;

  private specs(a: Agent): { exec: ModelSpec; plan: ModelSpec | null } {
    const m = a.memory;
    const exec = (typeof m.execModel === 'string' && parseSpec(m.execModel)) || EXEC_SPEC;
    let plan = PLAN_SPEC;
    if (typeof m.planModel === 'string') plan = parseSpec(m.planModel);
    else if (typeof m.execModel === 'string' && process.env.MC_PLAN_MODEL === undefined) plan = exec;
    return { exec, plan };
  }

  private stat(a: Agent, key: string, add = 1) {
    const s = (a.memory.stats ??= {}) as Record<string, number>;
    s[key] = (s[key] ?? 0) + add;
    return s;
  }

  private async timed(a: Agent, tier: 'exec' | 'plan', run: () => Promise<Reply>): Promise<Reply> {
    const t0 = Date.now();
    const out = await run();
    const s = this.stat(a, `${tier}Calls`);
    // Model load time (a cold start on Ollama can take a minute) would swamp the per-decision latency.
    this.stat(a, `${tier}MsTotal`, Math.max(0, Date.now() - t0 - (out.loadMs ?? 0)));
    this.stat(a, `${tier}PromptTokensTotal`, out.promptTokens ?? 0);
    s[`${tier}MsAvg`] = Math.round(s[`${tier}MsTotal`] / s[`${tier}Calls`]);
    s[`${tier}PromptTokensAvg`] = Math.round(s[`${tier}PromptTokensTotal`] / s[`${tier}Calls`]);
    return out;
  }

  private blockedCalls(): string[] {
    const now = Date.now();
    return [...this.failed]
      .filter(([, f]) => f.count >= 2 && now - f.at < REPEAT_BLOCK_MS)
      .map(([k, f]) => `- ${k}: ${f.why.slice(0, 160)}`);
  }

  private plan(a: Agent): Plan | undefined {
    const p = a.memory.plan as Partial<Plan> | undefined;
    if (!p || typeof p.goal !== 'string' || !Array.isArray(p.steps)) return undefined;
    // Plans posted through the memory API may leave out the bookkeeping fields.
    p.step ??= 0;
    p.by ??= 'external';
    p.tick ??= a.game.tick;
    return p as Plan;
  }

  onEvent(a: Agent, e: AgentEvent) {
    if (e.type === 'chat' && e.data?.from !== a.player.name) {
      // Reply at once to people, and to agents who address this agent by name; other agent chatter waits for the
      // next turn (otherwise every message makes every listener answer, and the answers never stop)
      const from = String(e.data?.from ?? '');
      const byAgent = !!a.manager.get(from);
      if (!byAgent || new RegExp(`\\b${a.player.name}\\b`, 'i').test(String(e.data?.text ?? ''))) this.urgent = true;
    }
    if (e.type === 'damage') this.urgent = true;
    if (e.type === 'death') {
      this.urgent = true;
      this.replanReason = 'the agent died and lost its items';
    }
    if (e.type === 'action_failed') {
      this.failuresSincePlan++;
      this.stat(a, 'actionsFailed');
      const st = a.current?.status;
      if (st) {
        const k = callKey(st.type, st.args);
        const f = this.failed.get(k);
        this.failed.set(k, { count: (f?.count ?? 0) + 1, at: Date.now(), why: st.message ?? e.text });
      }
    }
    if (e.type === 'action_done') {
      this.stat(a, 'actionsDone');
      // A step that names the skill that just succeeded is done (executors often forget step_done and redo the work)
      // (it may name a later step, when preparatory steps such as move_to were not marked done)
      const plan = this.plan(a);
      const type = String(e.data?.type ?? '');
      if (plan && type && type !== 'move_to') {
        const i = plan.steps.findIndex((st, k) => k >= plan.step && new RegExp(`\\b${type}\\b`).test(st));
        if (i >= 0) {
          this.stat(a, 'stepsDone', i + 1 - plan.step);
          this.stat(a, 'stepsAutoDone');
          plan.step = i + 1;
        }
      }
      // The mayor's site search is what unblocks the land and building tasks: act on it straight away
      if (e.data?.type === 'find_site' && villageRole(a) === 'mayor') this.replanReason = `you found a site (${e.text.slice(0, 160)}): post the land and building tasks for it now`;
    }
  }

  tick(a: Agent) {
    const now = Date.now();
    const plan = this.plan(a);
    const { exec: EXEC, plan: PLAN } = this.specs(a);
    const key = plan ? `${plan.tick}:${plan.step}` : '';
    if (key !== this.progressKey) {
      this.progressKey = key;
      this.lastProgress = now;
    }

    const v = a.village();
    const role = villageRole(a);
    const complete = !!plan && plan.steps.length > 0 && plan.step >= plan.steps.length;
    // A worker whose plan is complete has finished its task
    if (v && role === 'worker' && complete && plan.taskId && v.tasks.find((t) => t.id === plan.taskId)?.status === 'claimed') {
      a.manager.villages.finish(v, plan.taskId, a.player.name, this.notes.slice(-3).join(' ') || 'done');
      plan.taskId = undefined;
    }
    const boardKey = v ? v.tasks.map((t) => t.status[0]).join('') : '';

    if (PLAN && !this.planPending && now >= this.lastPlan && !v?.complete) {
      let why: string | null = null;
      if (!plan) why = 'there is no plan yet';
      else if (complete) why = 'the previous plan is complete';
      else if (this.replanReason) why = this.replanReason;
      else if (this.failuresSincePlan >= 3) why = `${this.failuresSincePlan} actions failed since the plan was made`;
      else if (role === 'mayor' && !plan.steps.length && boardKey !== this.boardSeen && !v!.tasks.some((t) => t.status === 'open' || t.status === 'claimed'))
        why = 'every posted task is finished or failed: review the village';
      else if (role === 'mayor' && !plan.steps.length && boardKey !== this.boardSeen && v!.tasks.some((t) => t.status === 'failed' && t.updated > this.lastPlan))
        why = 'a task failed';
      else if (plan.by !== 'external' && (plan.steps.length || role === 'mayor') && now - this.lastProgress > PLAN_INTERVAL_MS)
        why = `no step has been completed for ${Math.round((now - this.lastProgress) / 60000)} minutes`;
      // Workers take the next task before planning (so two workers never plan the same one); with none, they wait
      if (why && role === 'worker' && (!plan || complete)) {
        const next = a.manager.villages.claimable(v!)[0];
        if (next) {
          a.manager.villages.claim(v!, next.id, a.player.name);
          this.claimedTask = next.id;
        } else why = null;
      }
      if (why) {
        this.boardSeen = boardKey;
        this.startPlan(a, PLAN, plan, why);
      }
    }

    if (this.execPending) return;
    if (!plan && PLAN && !this.urgent) return; // wait for the first plan unless something needs a reply
    if (plan && (!plan.steps.length || (role === 'worker' && complete)) && !this.urgent) return; // waiting
    const idle = !a.current && a.queue.length === 0;
    if (!idle && !this.urgent) return;
    if (now - this.lastExec < (this.urgent ? 1500 : EXEC_INTERVAL_MS)) return;
    this.urgent = false;
    this.lastExec = now;
    this.execPending = true;
    this.execute(a, EXEC)
      .catch((err: unknown) => {
        a.pushEvent('system', `Executor error (${label(EXEC)}): ${(err as Error).message}`);
        this.lastExec = Date.now() + 20000; // back off
      })
      .finally(() => (this.execPending = false));
  }

  private startPlan(a: Agent, spec: ModelSpec, old: Plan | undefined, why: string) {
    this.planPending = true;
    this.replanReason = null;
    this.makePlan(a, spec, old, why)
      .catch((err: unknown) => {
        a.pushEvent('system', `Planner error (${label(spec)}): ${(err as Error).message}`);
        this.lastPlan = Date.now() + 30000; // back off
        const v = a.village();
        if (v && this.claimedTask && this.plan(a)?.taskId !== this.claimedTask) a.manager.villages.giveUp(v, this.claimedTask, a.player.name, 'could not plan it');
      })
      .finally(() => {
        this.planPending = false;
        this.claimedTask = undefined;
      });
  }

  private async makePlan(a: Agent, spec: ModelSpec, old: Plan | undefined, why: string) {
    const events = a.events.filter((e) => e.id > this.seenPlan);
    if (events.length) this.seenPlan = events[events.length - 1].id;
    const notes = typeof a.memory.notes === 'string' ? a.memory.notes : '';
    let user = [
      `You are planning for ${a.player.name}, role: ${a.role}, game mode: ${a.player.gamemode}. Replanning because ${why}.`,
      typeof a.memory.objective === 'string' ? `Objective: ${a.memory.objective}` : '',
      notes ? `Long-term notes:\n${notes}` : '',
      formatPlots(a),
      `Previous plan:\n${formatPlan(old)}`,
      `Events since the last plan:\n${formatEvents(events, 30)}`,
      `Observation:\n${JSON.stringify(compactObservation(a))}`,
    ].filter(Boolean).join('\n\n');

    const v = a.village();
    const role = villageRole(a);
    // A worker plans the task it holds: the one just claimed, or the one it was already doing
    if (role === 'worker' && !this.claimedTask && old?.taskId && v?.tasks.find((t) => t.id === old.taskId)?.status === 'claimed') this.claimedTask = old.taskId;
    const task = v && this.claimedTask ? v.tasks.find((t) => t.id === this.claimedTask) : undefined;
    if (task) user = `${user}\n\nYour task (already claimed) ${task.id}: ${task.title}: ${task.detail}\nPlan steps that fully accomplish it.`;
    const system = PLAN_SYSTEM + (role === 'mayor' ? MAYOR_ROLE : role === 'worker' ? WORKER_ROLE : '');
    const tools = role === 'mayor' ? MAYOR_PLAN_TOOLS : PLAN_TOOLS;
    const reply = await this.timed(a, 'plan', () => complete(spec, system, user, tools));
    const reg = a.manager.villages;
    for (const c of reply.calls) {
      if (!v) break;
      if (c.name === 'post_tasks' && Array.isArray(c.input.tasks)) {
        const made = reg.post(v, (c.input.tasks as Array<Record<string, unknown>>).filter((t) => t && typeof t.title === 'string').map((t) => ({
          title: String(t.title), detail: String(t.detail ?? ''), after: Array.isArray(t.after) ? (t.after as Array<string | number>) : [],
        })), a.player.name);
        a.pushEvent('system', `Posted tasks: ${made.map((t) => `${t.id} ${t.title}`).join('; ')}`);
      }
      if (c.name === 'declare_complete') {
        v.complete = true;
        reg.cancelOpen(v, 'the village objective is complete');
        reg.note(v, `${a.player.name} declared the objective complete: ${String(c.input.summary ?? '')}`);
        a.pushEvent('system', `Declared the village complete: ${String(c.input.summary ?? '')}`);
      }
    }
    const call = reply.calls.find((c) => c.name === 'set_plan');
    const steps = Array.isArray(call?.input.steps) ? call.input.steps.map(String).filter(Boolean) : [];
    const acted = reply.calls.some((c) => c.name === 'post_tasks' || c.name === 'declare_complete');
    if (role === 'mayor' && (!call || !steps.length)) {
      // Nothing to do personally: wait for the board to change
      a.memory.plan = { goal: typeof call?.input.goal === 'string' ? call.input.goal : 'coordinate the village', steps: [], step: 0, by: label(spec), tick: a.game.tick };
      this.lastPlan = Date.now();
      if (!acted && !call) throw new Error(`the mayor returned no tasks or plan${reply.text ? `: ${reply.text.slice(0, 120)}` : ''}`);
      return;
    }
    if (!call || typeof call.input.goal !== 'string' || !steps.length) throw new Error(`no usable plan returned${reply.text ? `: ${reply.text.slice(0, 120)}` : ''}`);

    const plan: Plan = { goal: call.input.goal, steps: steps.slice(0, 8), step: 0, by: label(spec), tick: a.game.tick };
    if (v && role === 'worker') plan.taskId = this.claimedTask ?? old?.taskId;
    // Re-issuing the same steps (common on a stall review) keeps the progress made so far.
    if (old && JSON.stringify(old.steps) === JSON.stringify(plan.steps)) plan.step = old.step;
    a.memory.plan = plan;
    if (typeof call.input.notes === 'string' && call.input.notes.trim()) a.memory.notes = call.input.notes.trim();
    this.lastPlan = Date.now();
    this.failuresSincePlan = 0;
    a.pushEvent('system', `New plan: ${plan.goal} | ${plan.steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}`);
    console.log(`[tiered] ${a.player.name} plan (${plan.by}, ${why}): ${plan.goal}\n  ${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n  ')}`);
  }

  /** Ask the architect model for a design, check it (one retry with the problems), and store it in the library. */
  private async design(a: Agent, name: string, brief: string): Promise<string> {
    const spec = this.specs(a).plan ?? this.specs(a).exec;
    const v = a.village();
    const library = v?.designs ?? (a.memory.designs as Record<string, Design> | undefined) ?? {};
    const key = name.trim().toLowerCase();
    if (library[key]) return `design "${key}" already exists (${library[key].width}x${library[key].depth}, by ${library[key].by}); build it with build_design or pick a new name`;
    const existing = Object.values(library);
    let user = [
      `Design a building named "${name}". Brief: ${brief}`,
      v ? `It is for the village ${v.name}${v.objective ? ` (objective: ${v.objective})` : ''}.` : '',
      existing.length ? `Existing designs (make this one distinct): ${existing.map((d) => `${d.name} (${d.width}x${d.depth}, ${d.description})`).join('; ')}` : '',
    ].filter(Boolean).join('\n');
    let problems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await this.timed(a, 'plan', () => complete(spec, DESIGN_SYSTEM, user, [DESIGN_TOOL]));
      const call = reply.calls.find((c) => c.name === 'submit_design');
      if (!call) {
        problems = ['no submit_design call was made'];
      } else {
        const { design, errors, fixes } = validateDesign({ ...call.input, name: name || call.input.name }, a.player.name);
        if (design) {
          if (v) {
            v.designs[design.name] = design;
            a.manager.villages.note(v, `${a.player.name} designed "${design.name}" (${design.width}x${design.depth}, ${design.height} high)`);
          } else a.memory.designs = { ...((a.memory.designs as Record<string, Design> | undefined) ?? {}), [design.name]: design };
          this.stat(a, 'designs');
          const fixed = fixes?.length ? ` (${fixes.join(', ')})` : '';
          return `design "${design.name}" saved${fixed}: ${design.width}x${design.depth}, ${design.height} layers, ${design.blocks} blocks (${design.description}). Build it with build_design on a level plot at least ${design.width + 2}x${design.depth + 2}.`;
        }
        problems = errors;
      }
      user += `\n\nYour previous design had problems; fix them and submit again:\n- ${problems.join('\n- ')}`;
    }
    this.stat(a, 'designsFailed');
    return `design "${name}" failed: ${problems.join('; ')}`;
  }

  private async execute(a: Agent, spec: ModelSpec) {
    const events = a.events.filter((e) => e.id > this.seenExec);
    if (events.length) this.seenExec = events[events.length - 1].id;
    const plan = this.plan(a);
    const user = [
      `You are ${a.player.name}, role: ${a.role}, game mode: ${a.player.gamemode}.`,
      typeof a.memory.objective === 'string' ? `Objective: ${a.memory.objective}` : '',
      formatPlots(a),
      formatTask(a.village(), plan),
      `Plan:\n${formatPlan(plan)}`,
      this.notes.length ? `Your recent decisions:\n${this.notes.slice(-6).join('\n')}` : '',
      this.blockedCalls().length ? `Calls that failed repeatedly and are blocked for now (do something different):\n${this.blockedCalls().join('\n')}` : '',
      `What happened since your last turn:\n${formatEvents(events, 20)}`,
      `Observation:\n${JSON.stringify(compactObservation(a))}`,
    ].filter(Boolean).join('\n\n');

    // Without a plan (answering chat while waiting) an agent may only talk: no freelance building
    const tools = !plan || !plan.steps.length ? CHAT_TOOLS : villageRole(a) === 'mayor' ? MAYOR_EXEC_TOOLS : EXEC_TOOLS;
    const reply = await this.timed(a, 'exec', () => complete(spec, EXEC_SYSTEM, user, tools));
    const done: string[] = [];
    for (const c of reply.calls) {
      if (c.name === 'step_done') {
        if (plan && plan.step < plan.steps.length) {
          done.push(`step_done(${plan.steps[plan.step]})`);
          plan.step++;
          this.stat(a, 'stepsDone');
        }
        continue;
      }
      if (c.name === 'design_building') {
        const msg = await this.design(a, String(c.input.name ?? ''), String(c.input.brief ?? ''));
        a.pushEvent('system', msg);
        done.push(`design_building(${String(c.input.name ?? '')}): ${msg.slice(0, 120)}`);
        continue;
      }
      if (c.name === 'request_replan') {
        this.replanReason = `the executor asked: ${String(c.input.reason ?? 'no reason given')}`;
        done.push(`request_replan(${String(c.input.reason ?? '')})`);
        continue;
      }
      const ck = callKey(c.name, c.input);
      const f = this.failed.get(ck);
      if (f && f.count >= 2 && Date.now() - f.at < REPEAT_BLOCK_MS) {
        done.push(`(refused repeat of ${c.name}: it already failed ${f.count} times)`);
        this.stat(a, 'repeatsRefused');
        continue;
      }
      // Doing exactly the same thing again and again (e.g. the same chat line) is a loop, even when it succeeds
      const now = Date.now();
      this.recent = this.recent.filter((r) => now - r.at < 2 * 60 * 1000);
      if (this.recent.filter((r) => r.key === ck).length >= 2) {
        done.push(`(refused: ${c.name} with the same arguments was already done twice just now; move on to the next step)`);
        this.stat(a, 'repeatsRefused');
        continue;
      }
      if (c.name === 'chat' && now - this.lastChat < CHAT_GAP_MS) {
        done.push('(refused chat: you spoke less than 30 s ago; get on with the work)');
        continue;
      }
      if (c.name === 'chat') this.lastChat = now;
      this.recent.push({ key: ck, at: now });
      try {
        a.enqueue(c.name, c.input);
        done.push(`${c.name}(${JSON.stringify(c.input)})`);
      } catch (e) {
        a.pushEvent('action_failed', `${c.name} rejected: ${(e as Error).message}`);
      }
    }
    if (!reply.calls.length && reply.text) done.push(`(no action; said: ${reply.text.slice(0, 100)})`);
    if (done.length) this.notes.push(`t=${a.game.tick}: ${done.join('; ')}`);
    if (this.notes.length > 20) this.notes.splice(0, this.notes.length - 20);
  }
}
