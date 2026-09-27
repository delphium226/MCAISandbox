# Architecture

How the agent system fits together: the two worlds agents can live in, the world interface that lets one brain run
in either, the two-tier brain, villages, the models behind it all, and the control panel. For running things see the
[README](../README.md); for working notes and lessons learned see [CLAUDE.md](../CLAUDE.md).

## 1. The system at a glance

Agents are players. A **world** gives them a body, skills and senses; a **brain** decides which skills to run; the
**village registry** lets several agents work on one project; **models** (local on two GPUs, or in the cloud) do the
deciding. There are two worlds: the browser sandbox in this repository, and real Minecraft Java Edition through
Mineflayer.

```mermaid
flowchart LR
  subgraph Sandbox["Sandbox world (port 8765)"]
    client["Browser client<br/>(Vite, three.js)"]
    game["Game server<br/>world, physics, mobs"]
    am["AgentManager + Agent<br/>(sandbox skills)"]
    client <-- "WebSocket /ws" --> game
    game --- am
  end

  subgraph MC["Real Minecraft"]
    paper["Paper 26.1.2 server<br/>127.0.0.1:25565<br/>RCON 25575"]
    mcagents["Agent server (port 8766)<br/>MineflayerWorld + BotAgents"]
    mcclient["Minecraft client<br/>(optional, to watch)"]
    mcagents -- "Mineflayer protocol<br/>(one bot per agent)" --> paper
    mcagents -- "RCON: gamemode, tp,<br/>/fill, /setblock" --> paper
    mcclient -.-> paper
  end

  brains["Brains<br/>tiered, llm (Claude), scripted"]
  village["VillageRegistry<br/>plots, buildings, designs,<br/>task board, reservations"]
  panel["Control panel /panel<br/>and REST API /api"]

  am --- brains
  mcagents --- brains
  brains --- village
  panel --- am
  panel --- mcagents

  subgraph Models["Models"]
    app["Ollama app :11434<br/>cloud relay: gpt-oss:120b-cloud"]
    exec["Executor server :11435<br/>qwen3:30b-instruct, GPU 1, 3 slots"]
    plan["Planner server :11436<br/>qwen3.8:27b, GPU 0"]
    claude["Claude API<br/>(llm brain only)"]
  end
  brains --> app
  brains --> exec
  brains --> plan
  brains -.-> claude
```

| Component | Where | What it does |
|---|---|---|
| Browser client | `client/src` | Renders the sandbox, sends player input; a human player or a spectator. |
| Game server | `server/src/game.ts`, `serverWorld.ts`, `mobs.ts` | Authoritative sandbox world: chunks, physics, mobs, crafting, saving. |
| Sandbox agents | `server/src/agents.ts` | Agents as real sandbox players, their skills, the building engine, the REST API. |
| Paper server | `mc/` (scripts; jar and world gitignored) | A private Minecraft 26.1.2 server for the agents (offline mode, localhost only). |
| Minecraft agents | `server/src/mineflayer/` | Agents as Mineflayer bots on the Paper server, their skills, the same REST API. |
| Brains | `server/src/tieredBrain.ts`, `llmBrain.ts`, `brains.ts` | Decide what agents do. The tiered and llm brains run in either world. |
| Villages | `server/src/village.ts`, `designs.ts` | Shared project state and building designs, one registry per world. |
| Control panel | `server/panel/index.html`, `server/src/panel.ts` | Live view of every agent's body and brain, maps, the task board. |
| Model servers | `scripts/ollama_exec.py`, the Ollama app | Local models pinned to GPUs; the app relays cloud models. |

## 2. The world interface

The brains and the village logic never import a world. They see an agent only through `WorldAgent` and a world only
through `WorldAdapter` (`server/src/world.ts`). Each world implements both; that is all it takes to host the same
agents.

```mermaid
classDiagram
  class WorldAgent {
    <<interface>>
    name, role, gamemode
    world: WorldAdapter
    memory: Record
    events: AgentEvent[]
    brain?: AgentBrain
    observe(radius) Observation
    enqueue(skill, args, replace?) ActionStatus
    stop()
    idle() bool
    pushEvent(type, text, data?)
    village() Village
    mapAround?(radius) MapView
  }
  class WorldAdapter {
    <<interface>>
    kind: sandbox | minecraft
    villages: VillageRegistry
    ticks: number
    skills: ToolDef[]
    isAgent(name) bool
    isPlaceable(block) bool
    agentList() WorldAgent[]
  }
  class AgentBrain {
    <<interface>>
    name
    init?(agent)
    tick?(agent)
    onEvent?(agent, event)
    status?(agent) BrainStatus
  }
  class Agent {
    sandbox player, skill queue
  }
  class AgentManager {
    sandbox agents, REST API
  }
  class BotAgent {
    Mineflayer bot, skill queue, reflex
  }
  class MineflayerWorld {
    bots, RCON, village registry
  }
  class TieredBrain
  class LLMBrain
  WorldAgent <|.. Agent
  WorldAgent <|.. BotAgent
  WorldAdapter <|.. AgentManager
  WorldAdapter <|.. MineflayerWorld
  AgentBrain <|.. TieredBrain
  AgentBrain <|.. LLMBrain
  WorldAgent --> AgentBrain : ticked at 20 Hz
  WorldAgent --> WorldAdapter : world
```

```mermaid
flowchart TB
  subgraph neutral["World-neutral (depend only on world.ts)"]
    tiered["tieredBrain.ts"]
    llm["llmBrain.ts"]
    village["village.ts"]
    designs["designs.ts"]
    skills["skills.ts<br/>(tool definitions)"]
    panelts["panel.ts"]
  end
  world["world.ts<br/>WorldAgent, WorldAdapter,<br/>AgentBrain, events, observation"]
  subgraph sandbox["Sandbox world"]
    agents["agents.ts"]
    brains["brains.ts<br/>(scripted brains)"]
    schematic["schematic.ts + nbt.ts"]
  end
  subgraph minecraft["Minecraft world (server/src/mineflayer)"]
    mcworld["mcWorld.ts"]
    bot["botAgent.ts"]
    mcskills["mcSkills.ts, mcSurvival.ts,<br/>mcBuild.ts, mcUtil.ts"]
    mcapi["mcApi.ts, rcon.ts, index.ts"]
  end
  neutral --> world
  sandbox --> world
  minecraft --> world
  sandbox --> neutral
  minecraft --> neutral
```

**The contract a world keeps.** Skill names and arguments are the same in both worlds (the brain's tools come from
`skills.ts`; a world lists the ones it has in `WorldAdapter.skills`). Events carry the data the brain relies on:

| Event | Data | Used for |
|---|---|---|
| `chat` | `{from, text, distance?}` | answering people; agent chatter only interrupts when it names the agent |
| `action_done` | `{action, type}` | marking a plan step done when the skill it names succeeds |
| `action_failed` | `{action, type, args, message}` | the loop guard (same call failed twice: refused for 5 minutes) |
| `damage`, `death`, `pickup`, `crafted`, `broke`, `killed`, `system` | text | urgency, replanning, the panel |

## 3. The two-tier brain

`TieredBrain` splits deciding into a slow **planner** (a goal and 3-8 steps, rarely) and a fast **executor** (the
next 1-3 skill calls, every few seconds). A third role, the **architect**, draws building designs on request. Each
role can use a different model, set per agent in memory (`planModel`, `execModel`, `designModel`, as
`"<provider>:<model>"`).

```mermaid
flowchart TD
  tick(["tick(agent), 20 times a second"]) --> planq{"Planner needed?<br/>no plan, plan complete,<br/>free worker, replan asked,<br/>3 failures, 3 min no progress,<br/>mayor: board changed"}
  planq -- "worker without a task" --> claim["Claim the next open task<br/>(before planning, so two workers<br/>never plan the same one)"]
  claim --> planner
  planq -- yes --> planner["Planner call (async)<br/>set_plan; mayor also post_tasks,<br/>declare_complete"]
  planq -- no --> execq
  planner --> mem[("memory.plan<br/>goal, steps, current step")]
  execq{"Executor due?<br/>idle, or urgent<br/>(chat, damage)"} -- no --> done(["wait for the next tick"])
  execq -- yes --> executor["Executor call (async)<br/>skill calls, step_done,<br/>design_building, request_replan"]
  executor --> guard{"Loop guards<br/>failed twice? done twice in 2 min?<br/>chatted in the last 30 s?"}
  guard -- refused --> notes["noted as refused<br/>(the model sees it next turn)"]
  guard -- ok --> queue["agent.enqueue(skill, args)"]
  executor -- design_building --> architect["Architect call<br/>submit_design, validated,<br/>one retry with the problems"]
  architect --> library[("design library")]
  queue --> skill["the world runs the skill"]
  skill -- "action_done / action_failed" --> onevent["onEvent: step auto-done,<br/>failure counted, replan triggers"]
  onevent --> mem
```

What each model is shown, per call:

| Role | Sees | Answers with | How often |
|---|---|---|---|
| Planner | role, objective, long-term notes, village summary (plots, buildings, designs, task board), previous plan, events since the last plan, observation; a worker also its claimed task | `set_plan`; the mayor also `post_tasks` and `declare_complete` | on the triggers above; for a worker about once per task |
| Executor | plan with the current step marked, the claimed task, recent decisions, blocked calls, events since its last turn, a trimmed observation (~2k tokens) | 1-3 skill calls, or `step_done`, `design_building`, `request_replan` | whenever the agent is idle, at least 6 s apart; 1.5 s when urgent |
| Architect | the design rules and format, a brief, the existing designs | `submit_design` (layers of spaced symbols plus a palette) | when a `design_building` call is made |

Code, not the model, does arithmetic and geometry and cleans up model output: `craft` makes missing planks and sticks,
doors are moved onto an outside wall, `find_site` suggests the largest site that fits, design layers sent as JSON
strings (even without their outer brackets) are parsed, tasks written as skill calls are turned into task text, plan
steps given as objects are turned into text.

### A village task, end to end

```mermaid
sequenceDiagram
  autonumber
  participant M as Mayor (planner: gpt-oss)
  participant B as Task board (VillageRegistry)
  participant W as Worker1 brain
  participant P as Worker planner (qwen3.8)
  participant E as Worker executor (qwen3:30b)
  participant S as World skills
  M->>S: find_site size 30 (via its executor)
  S-->>M: site found: centre x=166 z=-10
  M->>B: post_tasks: designs, prepare plot, build cottage x2, build hall
  W->>B: claim next claimable task (prerequisites done, design drawn)
  B-->>W: t22 "Prepare site for cottage 1"
  W->>P: plan the claimed task
  P-->>W: set_plan: 1. prepare_site x=115 z=3 width=7 depth=7
  loop every few seconds while idle
    W->>E: plan, events, observation
    E-->>W: prepare_site(x=115, z=3, width=7, depth=7)
    W->>S: enqueue prepare_site
    S-->>W: action_done: plot ready (step auto-marked done)
  end
  W->>B: finish t22 (plan complete)
  B-->>M: board changed: review
  M->>B: declare_complete (when the summary shows the objective)
```

## 4. Villages

A village is shared state for agents building together, saved to `villages.json` next to each world
(`server/worlds/<world>/` for the sandbox, `mc/server/` for Minecraft). Roles come from memory: `villageRole: "mayor"`
coordinates, everyone else in the village is a worker.

```mermaid
stateDiagram-v2
  [*] --> open: mayor posts (post_tasks)
  open --> claimable: prerequisites done and its design drawn
  claimable --> claimed: a free worker claims it (before planning)
  claimed --> done: the worker's plan completes
  claimed --> open: handed back (replanned 3 times, or the plan failed), 1st time
  claimed --> failed: handed back a 2nd time
  open --> failed: cancelled (objective declared complete)
  failed --> [*]: the mayor reviews and may post a fix
  done --> [*]
```

| Record | Written by | Purpose |
|---|---|---|
| Plots | `prepare_site` | Level ground, with its height, so buildings go on prepared land and plots can be extended at the same level. |
| Structures | `build`, `build_design`, `build_box` | Footprints: nothing is built on top of them; "a cottage already stands here" ends duplicate work. |
| Designs | the architect, the API, schematic import | The design library for `build_design`: layers of palette symbols, validated. |
| Task board | the mayor | Tasks with prerequisites (`after`), claims, results, tries. |
| Reservations | building skills while they run | Ground another agent is working on; `find_site` and other jobs avoid it (renewed while working, 3-minute expiry). |

## 5. Skills in each world

Both worlds run skills from a per-agent queue, one at a time, with the same names, arguments and failure messages.

```mermaid
flowchart LR
  enqueue["enqueue(skill, args)<br/>arguments checked,<br/>throws on bad ones"] --> q[["queue"]]
  q --> run["current skill"]
  run -- "sandbox: tick() each game tick<br/>minecraft: async run(signal)" --> result{"result"}
  result -- done --> ev1["action_done event"]
  result -- failed --> ev2["action_failed event<br/>(what is wrong, what to do next)"]
  stop["stop()"] -. "cancels (AbortSignal)" .-> run
  reflex["Minecraft only:<br/>self-defence reflex"] -. "interrupts, then puts<br/>the action back first" .-> run
```

| | Sandbox (`agents.ts`) | Minecraft (`server/src/mineflayer/`) |
|---|---|---|
| Body | a sandbox `Player` driven by input each tick | a Mineflayer bot (client-side physics, half-width 0.3001 to stay in step with the server) |
| Walking | own A* Navigator (opens doors, digs out in creative) | mineflayer-pathfinder with a stuck/timeout watchdog, digging natural blocks only, a retry with longer drops |
| Gathering | `collect`, `mine` on sandbox blocks | `collect` resolves names in code (logs, cobblestone from stone, deepslate ores), digs to buried blocks |
| Crafting | sandbox recipes | minecraft-data recipes; table, sticks and planks made in order; each craft waits for the server |
| Building | `BuildJob`: blocks placed one by one, paced by `buildSpeed` | `/setblock` and `/fill` over RCON in creative, paced by `buildSpeed`, vertical runs merged |
| Safety | none | reflex: fight back with a weapon, run when unarmed, hurt or near a creeper |
| Spawning | `game.join` | a bot joins; RCON sets game mode, teleports, `reset` clears inventory and returns it to spawn |

### Building in Minecraft

```mermaid
sequenceDiagram
  participant E as Executor
  participant B as BotAgent
  participant J as mcBuild runJob
  participant V as VillageRegistry
  participant R as RCON
  participant P as Paper server
  E->>B: build_design(design=cottage, x=115, z=3)
  B->>J: plan targets from the design (rotated, doors facing out)
  J->>J: readySite: loaded, dry, level, nothing in the way?
  J->>V: conflict check, reserve the footprint
  J->>B: walk south of the site, look at the blocks
  loop paced by buildSpeed (x10 blocks a second)
    J->>R: fill / setblock (clear top-down, then place bottom-up)
    R->>P: run as the server console
    P-->>B: block updates reach the bot's world
  end
  J->>V: record the structure, release the reservation
  J-->>E: action_done: "cottage recorded ... placed 145 blocks"
```

## 6. Models and GPUs

```mermaid
flowchart LR
  subgraph brain["TieredBrain (per call)"]
    route{"MC_OLLAMA_ROUTES<br/>model -> server"}
  end
  route -- "qwen3:30b-instruct" --> exec["Executor server :11435<br/>ollama.exe serve<br/>GPU 1 (also the display)<br/>OLLAMA_NUM_PARALLEL=3"]
  route -- "qwen3.8:27b" --> plan["Planner server :11436<br/>ollama.exe serve<br/>GPU 0, 1 slot"]
  route -- "anything else,<br/>e.g. gpt-oss:120b-cloud" --> app["Ollama app :11434"]
  app --> cloud["Ollama cloud<br/>(subscription)"]
  route -. "anthropic:..." .-> claudeapi["Claude API<br/>(billed separately)"]
```

| Role | Model (as used in the Elmfield and Ashvale runs) | Why |
|---|---|---|
| Mayor's planner, architect | `gpt-oss:120b-cloud` | ~3.5 s per plan, ~9 s per design, valid designs; about 10x faster than gemma4:31b |
| Workers' planner | `qwen3.8:27b` | tight one-step plans (6/6 against 2/6 for qwen3:30b); called about once per task, so its ~7-10 s is fine |
| Executors | `qwen3:30b-instruct` | a mixture of experts (~3B active): ~2 s a turn, as accurate as larger models when the plan is clear |

`scripts/ollama_exec.py start` runs the two local models on their own `ollama.exe serve` instances, pinned to a GPU
by UUID (CUDA and nvidia-smi number the cards differently here), after unloading them from the Ollama app: left to
itself, the app split a model across both cards and Windows silently spilled the rest into system RAM (60x slower).
It loads each model, checks it is fully in VRAM and times it.

## 7. The control panel

```mermaid
flowchart LR
  page["/panel (server/panel/index.html)<br/>browser, refreshes every 2 s"]
  page -- "GET /api/overview (2 s)" --> overview["panel.ts overview()<br/>for each agent: observe(4), memory,<br/>brain.status(), events, village"]
  page -- "GET /api/maps (2 s)" --> maps["mapAround(24) per agent<br/>top block + height per column,<br/>cached 1.5 s (~2 ms each)"]
  page -- "GET /api/models (5 s)" --> models["/api/ps on every Ollama<br/>in use (app + routes)"]
  page -- "GET /api/status" --> status["world, version, server"]
  page -- "POST stop, DELETE,<br/>POST /api/watch" --> actions["stop actions, remove,<br/>spectate an agent (Minecraft: RCON tp)"]
```

Each agent's card shows: the brain's state (planning, thinking, acting, waiting, idle, backing off, done: since when
and why), health and food, position and biome, objective and task, the plan as a checklist, the current action, blocked
calls, a top-down map (terrain, facing, mobs, players, target, plots, buildings, reserved ground), what the executor and
the planner last saw (the exact user prompt) and answered, recent decisions and events, inventory and model stats. The
village section shows the task board, buildings, plots, designs, reservations and the village log.

## 8. Testing

```mermaid
flowchart LR
  script["watch_village.py / watch_agent.py /<br/>watch_survival.py<br/>(MCAI_API picks the world)"] -- "spawn (reset), memory,<br/>models" --> api["REST API<br/>8765 sandbox / 8766 Minecraft"]
  script -- "poll events, board, stats" --> api
  script -- "early stop: objective met,<br/>stuck, time limit" --> report["log: timeline, board,<br/>designs, plots, buildings, stats"]
```

Agent names are fixed (Gus for single-agent tests; Mayor, Worker1, Worker2 for villages) so they are easy to find in
the world. There is no unit test suite: `npm run typecheck`, then agents are run. `scripts/bench/` compares models on
the brain's real prompts and tools.

## 9. Where this is going

The next step (agreed, see CLAUDE.md, "Next: the peaceful village economy") replaces creative building with a safe
survival economy in Minecraft: peaceful difficulty with no damage, a bill of materials per design worked back through
the recipes to raw materials, a shared village storage chest, building that charges the builder's inventory, and a
mayor whose building tasks come with the gather and craft tasks they need, laid out by `plan_layout`.

```mermaid
flowchart LR
  design["design<br/>(architect)"] --> bom["bill of materials<br/>(code)"]
  bom --> raw["raw materials<br/>logs, cobblestone, sand, fuel<br/>(recipe chain, code)"]
  raw --> gather["gather tasks<br/>collect"]
  gather --> craft["craft / smelt tasks"]
  craft --> storage[("village chest<br/>deposit")]
  storage --> build["build task<br/>withdraw, then /setblock<br/>charging the inventory"]
  layout["plan_layout<br/>(code)"] --> build
```
