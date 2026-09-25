/**
 * Optional LLM-driven brain: asks Claude what to do next, given the agent's observation and
 * recent events, and turns Claude's tool calls into queued skills.
 *
 * Enable by spawning an agent with brain "llm" (e.g. `/agent spawn Ada farmer llm`) with Anthropic
 * credentials available (ANTHROPIC_API_KEY or an `ant auth login` profile). The model defaults to
 * claude-opus-5 and can be overridden with MC_LLM_MODEL.
 *
 * This is a deliberately small single-module decision loop — a starting point for richer
 * PIANO-style architectures (parallel modules for memory, social awareness, goal generation, ...).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Agent, AgentEvent } from './agents';
import type { AgentBrain } from './brains';

const MODEL = process.env.MC_LLM_MODEL ?? 'claude-opus-5';
const MIN_INTERVAL_MS = Number(process.env.MC_LLM_INTERVAL_MS ?? 6000);

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  properties: props,
  required,
  additionalProperties: false,
});
const n = { type: 'number' };
const s = { type: 'string' };

/** One tool per game skill. Tool calls are queued in order as the agent's next actions. */
const TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: 'move_to', description: 'Walk to a block position using pathfinding.', input_schema: obj({ x: n, y: n, z: n, range: n }, ['x', 'y', 'z']) },
  { name: 'collect', description: "Find and mine blocks of a type until `count` items are gathered. block examples: 'logs', 'stone', 'coal_ore', 'iron_ore', 'sand', 'dirt'.", input_schema: obj({ block: s, count: n }, ['block', 'count']) },
  { name: 'mine', description: 'Mine the single block at x,y,z.', input_schema: obj({ x: n, y: n, z: n }, ['x', 'y', 'z']) },
  { name: 'place', description: 'Place a block item from the inventory at x,y,z.', input_schema: obj({ item: s, x: n, y: n, z: n }, ['item', 'x', 'y', 'z']) },
  { name: 'craft', description: 'Craft an item from inventory ingredients (uses a nearby crafting table for 3x3 recipes, placing one if carried). Use exact item ids like oak_planks, stick, crafting_table, wooden_pickaxe, stone_pickaxe, furnace, torch, bread.', input_schema: obj({ item: s, count: n }, ['item']) },
  { name: 'smelt', description: 'Smelt items in a furnace (e.g. iron_ore, raw food, sand).', input_schema: obj({ item: s, count: n }, ['item']) },
  { name: 'attack', description: 'Fight an entity by id or kind (zombie, pig, ...).', input_schema: obj({ id: n, kind: s }) },
  { name: 'follow', description: 'Follow a player for some seconds.', input_schema: obj({ player: s, distance: n, seconds: n }, ['player']) },
  { name: 'give', description: 'Walk to a player and give them items (trading, helping).', input_schema: obj({ player: s, item: s, count: n }, ['player', 'item']) },
  { name: 'chat', description: 'Say something out loud. Only players within ~48 blocks hear it.', input_schema: obj({ message: s }, ['message']) },
  { name: 'eat', description: 'Eat food from the inventory.', input_schema: obj({ item: s }) },
  { name: 'explore', description: 'Walk some distance in a direction to find new resources.', input_schema: obj({ direction: { type: 'string', enum: ['north', 'south', 'east', 'west'] }, distance: n }) },
  { name: 'wait', description: 'Idle for a number of seconds.', input_schema: obj({ seconds: n }, ['seconds']) },
];

const SYSTEM = `You control a player character in a Minecraft-like survival world shared with humans and other AI agents.
Each turn you receive a JSON observation (position, health, food, inventory, visible blocks with counts and nearest positions,
nearby entities, your current action, and recent events including chat you overheard). Decide what to do next by calling one
or more of the provided tools; calls are executed in order as a queue. Prefer 1-3 purposeful actions per turn.

Play like a thoughtful person: stay alive (eat when food is low, fight or avoid monsters at night), progress through tools
(wood -> crafting table -> wooden pickaxe -> stone tools -> furnace -> iron), and be a good neighbour: reply when someone
talks to you, cooperate, trade and help. Keep chat short and in character. Use exact item and block ids.
If you have nothing useful to do, explore or gather resources for your role.`;

export class LLMBrain implements AgentBrain {
  name = 'llm';
  private pending = false;
  private lastCall = 0;
  private seenEvent = 0;
  private notes: string[] = [];
  private urgent = false;

  onEvent(_a: Agent, e: AgentEvent) {
    if (e.type === 'chat' || e.type === 'damage' || e.type === 'death') this.urgent = true;
  }

  tick(a: Agent) {
    if (this.pending) return;
    const now = Date.now();
    const idle = !a.current && a.queue.length === 0;
    if (!idle && !this.urgent) return;
    if (now - this.lastCall < (this.urgent ? 1500 : MIN_INTERVAL_MS)) return;
    this.pending = true;
    this.urgent = false;
    this.lastCall = now;
    this.decide(a)
      .catch((err: unknown) => {
        const msg = err instanceof Anthropic.APIError ? `API error ${err.status}: ${err.message}` : (err as Error).message;
        a.pushEvent('system', `LLM brain error: ${msg}`);
        this.lastCall = Date.now() + 20000; // back off
      })
      .finally(() => (this.pending = false));
  }

  private async decide(a: Agent) {
    const obs = a.observe(12);
    const newEvents = a.events.filter((e) => e.id > this.seenEvent);
    if (newEvents.length) this.seenEvent = newEvents[newEvents.length - 1].id;
    const { recentEvents: _drop, ...compactObs } = obs;
    void _drop;
    const user = [
      `You are ${a.player.name}, role: ${a.role}.`,
      this.notes.length ? `Your recent decisions:\n${this.notes.slice(-8).join('\n')}` : '',
      `New events since your last decision:\n${newEvents.map((e) => `- [${e.type}] ${e.text}`).join('\n') || '- none'}`,
      `Observation:\n${JSON.stringify(compactObs)}`,
    ].filter(Boolean).join('\n\n');

    const response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages: [{ role: 'user', content: user }],
    });
    if (response.stop_reason === 'refusal') {
      a.pushEvent('system', 'LLM brain: request declined');
      return;
    }
    const calls: string[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      try {
        a.enqueue(block.name, (block.input ?? {}) as Record<string, unknown>);
        calls.push(`${block.name}(${JSON.stringify(block.input)})`);
      } catch (e) {
        a.pushEvent('action_failed', `${block.name} rejected: ${(e as Error).message}`);
      }
    }
    if (calls.length) this.notes.push(`t=${a.game.tick}: ${calls.join('; ')}`);
    if (this.notes.length > 20) this.notes.splice(0, this.notes.length - 20);
  }
}
