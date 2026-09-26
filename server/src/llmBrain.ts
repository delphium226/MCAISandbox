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
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  { name: 'move_to', description: 'Walk to a block position using pathfinding.', input_schema: obj({ x: n, y: n, z: n, range: n }, ['x', 'y', 'z']) },
  { name: 'collect', description: "Find and mine blocks of a type until `count` items are gathered. block examples: 'logs', 'stone', 'coal_ore', 'iron_ore', 'sand', 'dirt'.", input_schema: obj({ block: s, count: n }, ['block', 'count']) },
  { name: 'mine', description: 'Mine the single block at x,y,z.', input_schema: obj({ x: n, y: n, z: n }, ['x', 'y', 'z']) },
  { name: 'place', description: 'Place a block item from the inventory at x,y,z.', input_schema: obj({ item: s, x: n, y: n, z: n }, ['item', 'x', 'y', 'z']) },
  { name: 'craft', description: 'Craft an item from inventory ingredients (uses a nearby crafting table for 3x3 recipes, placing one if carried). Missing planks and sticks are made automatically from carried logs. Use exact item ids like oak_planks, stick, crafting_table, wooden_pickaxe, stone_pickaxe, furnace, torch, bread.', input_schema: obj({ item: s, count: n }, ['item']) },
  { name: 'smelt', description: 'Smelt items in a furnace (e.g. iron_ore, raw food, sand).', input_schema: obj({ item: s, count: n }, ['item']) },
  { name: 'attack', description: 'Fight an entity by id or kind (zombie, pig, ...).', input_schema: obj({ id: n, kind: s }) },
  { name: 'follow', description: 'Follow a player for some seconds.', input_schema: obj({ player: s, distance: n, seconds: n }, ['player']) },
  { name: 'give', description: 'Walk to a player and give them items (trading, helping).', input_schema: obj({ player: s, item: s, count: n }, ['player', 'item']) },
  { name: 'chat', description: 'Say something out loud. Only players within ~48 blocks hear it.', input_schema: obj({ message: s }, ['message']) },
  { name: 'eat', description: 'Eat food from the inventory.', input_schema: obj({ item: s }) },
  { name: 'explore', description: 'Walk some distance in a direction to find new resources.', input_schema: obj({ direction: { type: 'string', enum: ['north', 'south', 'east', 'west'] }, distance: n }) },
  { name: 'wait', description: 'Idle for a number of seconds.', input_schema: obj({ seconds: n }, ['seconds']) },
  { name: 'find_site', description: 'Find a dry, flat, open area to build on (no water, few trees, not on existing builds) and report its centre x,z. Then prepare_site there, then build. size: plot side (a 7x7 house needs about 11).', input_schema: obj({ size: n, radius: n, x: n, z: n }) },
  { name: 'prepare_site', description: 'Prepare a building plot before building: fells every tree touching it (whole trees), levels the ground by cutting and filling, and leaves a margin to walk around. Never demolishes buildings. Defaults to the last find_site result. To extend a plot later, prepare the neighbouring area with the same y.', input_schema: obj({ x: n, z: n, width: n, depth: n, margin: n, y: n }) },
  { name: 'get_item', description: 'Creative mode only: take any item from the creative inventory.', input_schema: obj({ item: s, count: n }, ['item']) },
  {
    name: 'build',
    description: "Build a whole structure centred on x,z on prepared ground (run prepare_site first; build refuses sloped or cluttered ground and never overlaps existing buildings). Creative mode supplies the blocks; in survival carry them. structure: 'hut' (5x5), 'house' (7x7, door and windows), 'platform' (floor only) or 'wall' (a line from x,z along direction). Optional: material (walls), roof, floor, width, depth, height, door side, length and direction for walls.",
    input_schema: obj({
      structure: { type: 'string', enum: ['hut', 'house', 'platform', 'wall'] },
      x: n, z: n, material: s, roof: s, floor: s, width: n, depth: n, height: n,
      door: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
      length: n, direction: { type: 'string', enum: ['north', 'south', 'east', 'west'] },
    }, ['structure']),
  },
  { name: 'build_design', description: 'Build a design from the village design library (see the village summary), centred on x,z on prepared, level ground. rotate turns it clockwise (0, 90, 180, 270), e.g. to face a door toward the street.', input_schema: obj({ design: s, x: n, z: n, rotate: n }, ['design', 'x', 'z']) },
  { name: 'build_box', description: "Fill the box between two corners with a block (hollow: only the shell, inside cleared), or clear it with block 'air'. For custom shapes: towers, pillars, bridges, extensions.", input_schema: obj({ x1: n, y1: n, z1: n, x2: n, y2: n, z2: n, block: s, hollow: { type: 'boolean' } }, ['x1', 'y1', 'z1', 'x2', 'y2', 'z2', 'block']) },
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
