/**
 * The world interface the brains and the village logic depend on. A world (this sandbox, or real Minecraft through
 * Mineflayer) hosts agents: bodies that observe, run queued skills and report what happens as events. Brains
 * (tieredBrain.ts, llmBrain.ts) only see WorldAgent and WorldAdapter, so the same agents run in any world.
 *
 * Events a world must emit (brains rely on their data):
 *   chat           data { from, text, distance? }
 *   action_done    data { action, type }
 *   action_failed  data { action, type, args, message }
 *   damage, death, pickup, crafted, killed, broke, system: text only is enough
 */
import type { Village, VillageRegistry } from './village';

export interface AgentEvent {
  id: number;
  tick: number;
  type: 'chat' | 'damage' | 'death' | 'pickup' | 'crafted' | 'action_done' | 'action_failed' | 'system' | 'killed' | 'broke';
  text: string;
  data?: Record<string, unknown>;
}

export interface ActionStatus {
  id: number;
  type: string;
  args: Record<string, unknown>;
  state: 'queued' | 'running' | 'done' | 'failed';
  message?: string;
  startedTick?: number;
}

export interface Observation {
  name: string;
  tick: number;
  timeOfDay: number;
  isDay: boolean;
  position: { x: number; y: number; z: number };
  yaw: number;
  health: number;
  food: number;
  gamemode: string;
  dead: boolean;
  biome: string;
  holding: string | null;
  inventory: Record<string, number>;
  equipment: (string | null)[];
  nearbyBlocks: Record<string, { count: number; nearest: [number, number, number] }>;
  nearbyEntities: Array<{ id: number; kind: string; name?: string; x: number; y: number; z: number; distance: number; health?: number }>;
  currentAction: ActionStatus | null;
  queuedActions: number;
  recentEvents: AgentEvent[];
}

/** A tool definition in Anthropic's shape (the Ollama client converts it). */
export interface ToolDef {
  name: string;
  description?: string;
  input_schema: unknown;
}

/** One agent's body in some world. */
export interface WorldAgent {
  readonly name: string;
  readonly role: string;
  /** 'survival', 'creative', 'spectator', ... */
  readonly gamemode: string;
  readonly world: WorldAdapter;
  /** Free-form memory for brains and external controllers (plan, notes, objective, village, ...). */
  memory: Record<string, unknown>;
  /** Recent events, oldest first; ids increase. */
  readonly events: readonly AgentEvent[];
  observe(radius?: number): Observation;
  /** Queue a skill; throws with a helpful message on an unknown skill or bad arguments. */
  enqueue(type: string, args: Record<string, unknown>, replace?: boolean): ActionStatus;
  /** Cancel the running skill and everything queued. */
  stop(): void;
  /** Nothing running and nothing queued (cheap, unlike observe). */
  idle(): boolean;
  pushEvent(type: AgentEvent['type'], text: string, data?: Record<string, unknown>): void;
  /** The village this agent belongs to (memory.village), if any. */
  village(): Village | undefined;
}

/** A world that hosts agents. */
export interface WorldAdapter {
  readonly kind: 'sandbox' | 'minecraft';
  /** Villages in this world (their coordinates are world coordinates, so each world has its own registry). */
  readonly villages: VillageRegistry;
  /** Server ticks elapsed (20 per second). */
  readonly ticks: number;
  /** Tool definitions for the skills this world implements (names and arguments as in skills.ts). */
  readonly skills: ToolDef[];
  isAgent(name: string): boolean;
  /** Whether a design may use this block (design validation). */
  isPlaceable(block: string): boolean;
}

/**
 * An in-process decision maker that chooses which skills an agent runs.
 *   - tick(agent) is called every server tick (20 Hz): keep it cheap and do slow work asynchronously
 *     (e.g. call an LLM with agent.observe() and enqueue the returned actions when the promise resolves).
 *   - onEvent(agent, event) receives chat, damage, crafting results, action completions, ...
 * Brains typed on WorldAgent run in any world; A narrows that for world-specific brains.
 */
export interface AgentBrain<A extends WorldAgent = WorldAgent> {
  name: string;
  init?(agent: A): void;
  tick?(agent: A): void;
  onEvent?(agent: A, e: AgentEvent): void;
}
