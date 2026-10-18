/**
 * The world interface the brains and the village logic depend on. A world (this sandbox, or real Minecraft through
 * Mineflayer) hosts agents: bodies that observe, run queued skills and report what happens as events. Brains
 * (tieredBrain.ts, llmBrain.ts) only see WorldAgent and WorldAdapter, so the same agents run in any world.
 *
 * Events a world must emit (brains rely on their data):
 *   chat           data { from, text, distance?, wake? } (wake: from a world that routes chat, routesChat; the line is
 *                  for this agent to answer)
 *   action_done    data { action, type, args? }
 *   action_failed  data { action, type, args, message, code?, resource? } (code and resource: another agent's work in
 *                  the way, village.ts ContentionCode; brains hand the task back rather than count a failure)
 *   damage, death, pickup, crafted, killed, broke, system: text only is enough
 */
import type { Design, Task, Village, VillageRegistry } from './village';
import type { Appetite } from './appetite';

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
  /** A failure's contention code (another agent's work in the way, village.ts ContentionCode; A.2's chore ends). */
  code?: string;
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
  /**
   * Whether the world chooses who hears a chat line and who should answer it (E.0): then only lines in hearing range
   * arrive, and brains wake only on `wake`. Worlds without it deliver what each agent hears, and brains decide.
   */
  readonly routesChat?: boolean;
  /** Whether a design may use this block (design validation). */
  isPlaceable(block: string): boolean;
  /**
   * The blocks the architect may use here (in survival: what the economy can gather and make), and whether it may
   * write block states ("oak_stairs[facing=north]"). Worlds without it use designs.ts's DESIGN_BLOCKS, without states.
   */
  designBlocks?(survival: boolean): { blocks: string[]; states: boolean };
  /** Whether an item id exists (the mayor's add_need), where the world can tell. */
  isItem?(name: string): boolean;
  /**
   * The survival economy (real Minecraft): the gather tasks building a design needs (collect raw materials, deposit them
   * in the village storage), and why it cannot be built here at all (materials not obtainable). Worlds without an
   * economy leave it out.
   */
  materialTasks?(design: Design, label: string, wood?: string, stations?: boolean, without?: string[], extra?: Record<string, number>): {
    tasks: Array<{ title: string; detail: string }>;
    problems: string[];
    logs?: number;
    /** Raw blocks to gather (logs, cobblestone, sand... summed) and furnace runs: what the design costs (phase D's budget). */
    units?: number;
    smelts?: number;
  };
  /**
   * The windows of every building laid out (one design a placed copy), billed once for the village (S.3): their panes and
   * glass, the sand for them rounded once (and what the buildings' own bills would gather), and the gather tasks for that
   * sand ("for the windows"), and the logs their smelting burns (billed on the first building with windows). Null when no
   * building has windows. Worlds without it bill each building's own.
   */
  sharedParts?(designs: Design[], wood?: string): {
    panes: number; glass: number; sand: number; logs: number; separate: number;
    /** The designs (by name) that have windows, and the placed copies that do. */
    with: string[]; copies: number;
    tasks: Array<{ title: string; detail: string }>;
  } | null;
  /** Skills code-posted tasks may name besides `skills`, never shown to a model (S.3: make_into_storage). */
  taskSkills?: string[];
  /**
   * The items a worker holding a task with this detail may carry for it, deposited by name when it hands the task back
   * (F228: a worker gave up the panes' task holding 6 glass and 14 sand, and the next holder found storage empty for 7
   * minutes; lesson 112). Empty when nothing is worth taking back.
   */
  taskLeftovers?(detail: string): string[];
  /** Whether its prepare_site takes a layout's part (`layout=N part=K`, S.6): plan_layout then splits a new village's plot. */
  preparesParts?: boolean;
  /** How many workers a village has now (S.6: the plot is split into more parts with four or more). */
  memberCount?(v: Village): number;
  /**
   * How many of the blocks `collect` would gather for each name lie within `range` blocks of x,z and no more than 16
   * below ground level y, counted up to the number wanted, in the ground agent `by` has loaded; null when that agent is
   * not here. For the survival economy.
   */
  materialsNear?(by: string, want: Record<string, number>, x: number, y: number, z: number, range: number, skip?: { x1: number; z1: number; x2: number; z2: number }): Record<string, number> | null;
  /**
   * Vanilla's village pieces for a biome (phase D, V2.3; a Minecraft biome name or one of plains, savanna, snowy, taiga,
   * desert): the town centre (a meeting point without water, with its street connectors) and the houses that pass the
   * survival checks, from the server's jar. Worlds without one leave it out.
   */
  vanillaLibrary?(biome: string): { biome: string; centre: { design: Design; connectors: Array<{ side: string; offset: number }>; paths: Array<[number, number]> } | null; houses: Design[] } | null;
  /**
   * Where scouts should walk around a new village's home so that its land becomes known (step 2.4): points of a ring the
   * world's map does not cover yet, in walking order around the ring. Worlds without a map leave it out.
   */
  scoutPoints?(home: { x: number; z: number }): Array<{ x: number; z: number }>;
  /** A2: the menu this agent would choose from now (pure: no state written), or null if it is not an idle member of a
   *  complete village. */
  choices?(agent: WorldAgent): ChoiceMenu | null;
  /** A2: run one option (checked again against a fresh menu); the chore is queued and logged. Never throws (D9). */
  runChoice?(agent: WorldAgent, id: string, meta: ChoiceMeta): { ok: true; key: string } | { ok: false; why: string };
  /** A2: the panel's compact line and the last full decision (cached fields; never builds a menu, C10). */
  choiceStatus?(agent: WorldAgent): ChoiceStatus | null;
  lastDecision?(agent: WorldAgent): (ChoiceMeta & { chosen: string | null; at: number }) | null;
  /** s34: the agent's last chore ends in its village (kind, option id, ok, productive, minutes, when, the end's line). */
  choiceHistory?(agent: WorldAgent): Array<{ kind: string; id: string; ok: boolean; cut: boolean; productive: boolean; minutes: number; at: number; line: string }>;
  choiceSummary?(village: string): ChoiceSummary | null;
  /** s30's appetite: whether this member may claim a board task now (false: peckish with food in storage, or hungry and
   *  the task is no food work); true wherever the village keeps no appetite. Brains filter their claims by task with it. */
  mayClaim?(agent: WorldAgent, task?: Task): boolean;
  /** s30: a member's appetite and its state, or null where the village keeps none. */
  appetiteOf?(agent: WorldAgent): (Appetite & { state: string }) | null;
}

/** A2: the kinds of chores a complete village's idle members choose among (S.9 adds the works plot, making and
 *  gathering for the workshop; B.4 lighting the buildings and the mine). 'grow' (s30) is code-driven, never on a menu:
 *  laying out the next neighbourhood. 'eat' (s30's appetite): a meal from the village storage, on a peckish member's menu.
 *  'furnish' (X.1): furniture from storage into a building (the furnish family). 'initiate' and 'help' (s35): a member's
 *  own small work started, and a step of one taken (the initiatives family). */
export type ChoiceKind = 'farm' | 'slot' | 'start' | 'annex' | 'pen' | 'penwork' | 'cake' | 'iron' | 'explore' | 'works' | 'make' | 'gather' | 'light' | 'furnish' | 'initiate' | 'help' | 'grow' | 'eat';

/** One feasible chore instance: data only (the world runs it by id). */
export interface ChoiceOption {
  /** Stable instance id: 'farm:1', 'slot:1:2', 'start:pumpkin', 'annex', 'pen:cow', 'penwork:2:milk', 'cake',
   *  'iron:dig' | 'iron:iron_pickaxe' | 'iron:bucket', 'explore:3' (ring point i, 0 = east, clockwise: 2 = south),
   *  'works:prepare' | 'works:furnace:2', 'make:torch', 'gather:sand'. */
  id: string;
  kind: ChoiceKind;
  /** The F193 key it holds while it runs (single-key mode: 'start', 'explore'; instance mode: 'explore:3',
   *  'start:<k>:<j>' with the slot chosen by runOption). */
  key: string;
  /** Further keys it holds ('farmkind:pumpkin' for an instance-mode start); cooled with the key at its end. */
  holds: string[];
  /** It is infeasible while any busy key matches one of these. An entry ending in '=' matches exactly (its text without
   *  the '='); any other entry matches a key equal to it or starting with it plus ':' ('slot' matches 'slot:1:2'; 'pen'
   *  matches 'pen' and 'pen:x', not 'penwork:2'). */
  excludes: string[];
  /** Menu text, words only, unique within a menu ("Explore to the north-east", "Milk the cows"). */
  name: string;
  /** One line, <= 240 chars. */
  facts: string;
  /** Expected effect in a few words ("+1 cake in storage"). */
  effect: string;
  /** Fixed-order position: lower runs first. */
  rank: number;
  at?: { x: number; y?: number; z: number };
  /** Learning-progress weight 0.5..1.5 (model mode). */
  lp?: number;
  /** Temperament weight 0.16..6.25 (A.3p: the kind's weight times sociability's; absent when MCAI_TEMPERAMENT is off). */
  tw?: number;
}

export interface ChoiceContext {
  /** memory.persona, else the temperament's line (A.3p); '' when off */
  persona: string;
  /** A.3p: the agent's own pattern, "Your last 10 chores: exploring 5, ..." (absent when off or none yet). */
  pattern?: string;
  /** <= 300 chars */
  village: string;
  /** <= 200 chars */
  others: string;
  /** The agent's last <= 5 chore ends, one line each. */
  outcomes: string[];
}

export interface ChoiceMenu {
  agent: string;
  village: string;
  t: number;
  /** Feasible options in rank order (guarded and trimmed in model mode). */
  options: ChoiceOption[];
  /** Options removed by guards, with why (logged, never shown). */
  guarded: Array<{ id: string; why: string }>;
  /** Why each kind with no feasible option has none (for [choice-none]), e.g. { iron: 'tools made', explore: 'no free slot' }. */
  reasons: Partial<Record<ChoiceKind, string>>;
  ctx: ChoiceContext;
}

export type ChoiceSource = 'model' | 'fixed' | 'only' | 'repeat' | 'fallback';
export type FallbackWhy = 'off' | 'budget' | 'rate' | 'queue' | 'withdrawn' | 'timeout' | 'invalid' | 'error' | 'taken';

export interface ChoiceMeta {
  source: ChoiceSource;
  why?: FallbackWhy;
  /** The model's reason; 'fixed order' for every other source (A.1's value, autonomy_metrics reads it). */
  reason: string;
  /** Minted when the decision starts (decide()); seeds the shuffle; setChore reuses it as the choice id. */
  decisionId?: string;
  /** Option ids in the order shown to the model (model and its fallbacks after a call). */
  shown?: string[];
  model?: string;
  latencyMs?: number;
  /** The gate's wait for a slot (modelCall). */
  waitMs?: number;
  /** ChooserQueue's wait from submit to start. */
  queueWaitMs?: number;
  promptTokens?: number;
  outputTokens?: number;
  /** The menu the decision was made on (for the log; runChoice checks it again against a fresh one); a fallback's is the
   *  fresh menu its fixed pick was made on. */
  menu?: ChoiceMenu;
  /** A model's pick that was no longer feasible when its reply came ('taken'): the id it chose and its reason. */
  modelChose?: string;
  modelReason?: string;
  /** The exact user prompt (kept for the panel's drill-down only, not logged). */
  prompt?: string;
}

export interface ChoiceStatus {
  state: 'choosing' | 'queued' | 'running' | 'none';
  since?: number;
  name?: string;
  kind?: ChoiceKind;
  source?: ChoiceSource;
  why?: FallbackWhy;
  /** <= 160 chars */
  reason?: string;
  /** 1-based, among `shown` */
  position?: number;
  shown?: number;
  at?: number;
  menuSize?: number;
}

export interface ChoiceSummary {
  model: number;
  fixed: number;
  only: number;
  repeat: number;
  /** Fixed picks made by the rate throttle (minGapMs with no same-kind option, or the hourly cap): not failures. */
  rate: number;
  /** Failures only: budget, queue, withdrawn, timeout, invalid, error, taken (never 'rate'). */
  fallback: Partial<Record<FallbackWhy, number>>;
  /** Decisions dropped before running (agent gone, busy, village no longer complete). */
  drops: number;
  /** Model choices by the chosen option's shown position (index 0 = first), and the counts expected by chance. */
  positions: number[];
  expected: number[];
  promptTokens: number;
  outputTokens: number;
  msP50: number;
  queueWaitP90: number;
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
  /** Whether it takes tasks from the village board for this agent (a village grows only with such a worker, s30). */
  claimsTasks?(agent: A): boolean;
  /** Whether it holds this board task now (a claim its holder no longer holds is given back, s30). */
  holdsTask?(agent: A, id: string): boolean;
}

/** A brain's state at a glance: what it is doing (and since when, ms since the epoch) and why, plus details. */
export interface BrainStatus {
  state: 'planning' | 'thinking' | 'acting' | 'waiting' | 'idle' | 'done' | 'backing off';
  detail: string;
  since?: number;
  [key: string]: unknown;
}
