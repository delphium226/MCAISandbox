/**
 * The world interface the brains and the village logic depend on. A world (this sandbox, or real Minecraft through
 * Mineflayer) hosts agents: bodies that observe, run queued skills and report what happens as events. Brains
 * (tieredBrain.ts, llmBrain.ts) only see WorldAgent and WorldAdapter, so the same agents run in any world.
 *
 * Events a world must emit (brains rely on their data):
 *   chat           data { from, text, distance? }
 *   action_done    data { action, type, args? }
 *   action_failed  data { action, type, args, message }
 *   damage, death, pickup, crafted, killed, broke, system: text only is enough
 */
import type { Design, Village, VillageRegistry } from './village';

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
  /** The brain driving it, if any (for status displays). */
  readonly brain?: AgentBrain | null;
  /** A top-down map of the ground around the agent, for the control panel. */
  mapAround?(radius: number): MapView;
}

/** The top block of each column in a square around a point: palette indexes (-1: not loaded) and heights, row by row. */
export interface MapView {
  x0: number;
  z0: number;
  size: number;
  palette: string[];
  cells: number[];
  heights: number[];
}

/** Build a MapView from a function giving a column's top block and its height (or null when it is not loaded). */
export function makeMapView(cx: number, cz: number, radius: number, top: (x: number, z: number) => [string, number] | null): MapView {
  const size = radius * 2 + 1, x0 = cx - radius, z0 = cz - radius;
  const palette: string[] = [], index = new Map<string, number>(), cells: number[] = [], heights: number[] = [];
  for (let z = z0; z < z0 + size; z++)
    for (let x = x0; x < x0 + size; x++) {
      const t = top(x, z);
      if (!t) {
        cells.push(-1);
        heights.push(0);
        continue;
      }
      let i = index.get(t[0]);
      if (i === undefined) index.set(t[0], (i = palette.push(t[0]) - 1));
      cells.push(i);
      heights.push(t[1]);
    }
  return { x0, z0, size, palette, cells, heights };
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
  /** The agents in this world. */
  agentList(): WorldAgent[];
  /** Whether a design may use this block (design validation). */
  isPlaceable(block: string): boolean;
  /**
   * The survival economy (real Minecraft): the gather tasks building a design needs (collect raw materials, deposit them
   * in the village storage), and why it cannot be built here at all (materials not obtainable). Worlds without an
   * economy leave it out.
   */
  materialTasks?(design: Design, label: string, wood?: string): { tasks: Array<{ title: string; detail: string }>; problems: string[]; logs?: number };
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
  /** What the brain is doing right now, for the control panel. */
  status?(agent: A): BrainStatus;
}

/** A brain's state at a glance: what it is doing (and since when, ms since the epoch) and why, plus details. */
export interface BrainStatus {
  state: 'planning' | 'thinking' | 'acting' | 'waiting' | 'idle' | 'done' | 'backing off';
  detail: string;
  since?: number;
  [key: string]: unknown;
}
