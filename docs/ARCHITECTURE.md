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
    materialTasks?(design, label, wood?) gather tasks
    materialsNear?(by, want, x, y, z, range) counts
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
    layoutts["layout.ts<br/>(plan_layout)"]
    taskb["taskBrain.ts<br/>(scripted worker, tests)"]
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
    mcecon["mcRules.ts (peaceful settings),<br/>mcMaterials.ts (bills, recipe chains),<br/>mcStorage.ts (village chests)"]
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
| `action_done` | `{action, type, args}` | marking a plan step done when the skill it names succeeds with the item it names |
| `action_failed` | `{action, type, args, message}` | the loop guard (same call failed twice: refused for 5 minutes) |
| `damage`, `death`, `pickup`, `crafted`, `broke`, `killed`, `system` | text | urgency, replanning, the panel |

Two optional `WorldAdapter` methods carry the survival economy, so `layout.ts` and the brain stay world-neutral:
`materialTasks` turns a design's bill of materials into gather tasks, and `materialsNear` counts, up to the amounts
wanted, the blocks `collect` would gather for each material near a point (as `collect` reaches them: anything within
40 blocks, only exposed blocks farther out, nothing more than 16 below the ground), in the ground one agent has loaded.
`plan_layout` uses it to refuse designs whose materials are not near the site, and the architect's brief uses it to
say when there is no sand or sandstone. The sandbox implements neither.

## 3. The two-tier brain

`TieredBrain` splits deciding into a slow **planner** (a goal and 3-8 steps, rarely) and a fast **executor** (the
next 1-3 skill calls, every few seconds). A third role, the **architect**, draws building designs on request. Each
role can use a different model, set per agent in memory (`planModel`, `execModel`, `designModel`, as
`"<provider>:<model>"`).

```mermaid
flowchart TD
  tick(["tick(agent), 20 times a second"]) --> donecheck{"mayor: every layout build done,<br/>nothing open or unplaced?"}
  donecheck -- yes --> complete(["village declared complete by code"])
  donecheck -- no --> planq{"Planner needed?<br/>no plan, plan complete,<br/>free worker, replan asked,<br/>3 failures, 3 min no progress,<br/>mayor: board changed"}
  planq -- "worker without a task" --> claim["Claim the next open task<br/>(before planning, so two workers<br/>never plan the same one)"]
  claim --> codetask{"task posted by code?<br/>(skill calls with arguments)"}
  codetask -- yes --> ownsteps["the task's own skill calls<br/>become the plan (no model)"]
  ownsteps --> mem
  codetask -- no --> planner
  mem -- "code-posted step,<br/>nothing failed yet" --> asis["queued as written<br/>(no executor call)"]
  asis --> queue
  planq -- yes --> planner["Planner call (async)<br/>set_plan; mayor also plan_layout,<br/>post_tasks, declare_complete"]
  planq -- no --> execq
  planner -- "steps checked: workers' jobs and<br/>planner tools dropped (mayor);<br/>empty first plan: find_site added" --> mem[("memory.plan<br/>goal, steps, current step")]
  execq{"Executor due?<br/>idle, or urgent<br/>(chat, damage),<br/>or a written step failed"} -- no --> done(["wait for the next tick"])
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
| Planner | role, objective, long-term notes, village summary (plots, buildings, designs, storage contents, task board, recent village events, ground others are working on), previous plan, events since the last plan, observation; a worker also its claimed task | `set_plan`; the mayor also `plan_layout`, `post_tasks` and `declare_complete` | on the triggers above; a worker only for tasks a model wrote (code-posted tasks carry their own steps, so in the acceptance runs no worker's planner was called once) |
| Executor | plan with the current step marked, the claimed task, recent decisions, blocked calls, events since its last turn, a trimmed observation (~2k tokens) | 1-3 skill calls, or `step_done`, `design_building`, `request_replan` | whenever the agent is idle, at least 6 s apart; 1.5 s when urgent. A step of a code-posted task is first queued exactly as written; the executor takes it over only after it fails (executors had rewritten such calls: withdrawing logs and depositing them again counted as gathering) |
| Architect | the design rules and format, a brief, the existing designs | `submit_design` (layers of spaced symbols plus a palette) | when a `design_building` call is made |

Code, not the model, does arithmetic and geometry and cleans up model output: `craft` makes missing planks and sticks,
doors are moved onto an outside wall, `find_site` suggests the largest site that fits, `plan_layout` places buildings,
design layers sent as JSON strings (even without their outer brackets) are parsed, tasks written as skill calls are
turned into task text, plan steps given as objects are turned into text (keeping arguments such as a design's name).

Code also keeps the mayor on its job, because gpt-oss drifts back to doing the work itself:

| Guard | What it catches |
|---|---|
| Plan steps that are workers' jobs are dropped | a mayor planning "collect 12 logs, craft a pickaxe" (its executor cannot do them) |
| Hand-written building tasks before a layout are laid out by `plan_layout` | a mayor writing its own gather-craft-build chain |
| Tasks duplicating the layout's are not posted | a mayor re-posting the whole village after one failure |
| A re-posted failed building re-opens the layout task | "Build meeting hall" posted for the failed "Build meeting_hall" |
| `declare_complete` is refused while a layout build is not done | a village declared complete with nothing built |
| No timed review while workers hold tasks; a refused `plan_layout` replans at once | a waiting mayor re-posting gathering every 3 minutes; minutes lost after a refusal |
| Plan steps naming a planner tool (`plan_layout`) are dropped; the planner calls the tool | the executor, unable to call it, ran `find_site` and swapped a 30x30 site for a 24x24 |
| An empty first plan with nothing laid out gets `find_site` added (or is asked again after 10 s) | a mayor that waited 3 minutes before doing anything |
| Completion is checked by code on every tick of the mayor's brain | all three buildings stood, but the mayor had just tried to re-post work, so nothing woke it again |
| `move_to` and `explore` beyond 96 blocks of home are refused or shortened (every member) | a mayor wandering 500 blocks for a site; a worker exploring to 180 blocks out |
| Buildings that did not fit are laid out by code at the mayor's next successful `find_site` | the model placing them there only 1-2 times in 10 |

### A village, end to end (the survival economy)

```mermaid
sequenceDiagram
  autonumber
  participant M as Mayor (planner: gpt-oss)
  participant L as plan_layout (code)
  participant B as Task board
  participant W as Worker brain
  participant E as Worker executor (qwen3:30b)
  participant S as Skills (Minecraft)
  participant C as Village storage
  M->>S: find_site size 24+ (with 30 logs near), design_building cottage, meeting_hall (its executor)
  M->>L: plan_layout ["cottage", "cottage", "meeting_hall"]
  L->>S: materialsNear: are the materials near the site, as collect reaches them?
  L->>B: prepare the plot; set up the storage; gather tasks per building; builds at x, z
  opt the site holds only some of the buildings
    L->>B: lay out the ones that fit (at least half); the rest wait as unplaced
    M->>S: find_site again
    S->>L: code lays the unplaced buildings out on the new site
  end
  W->>B: claim "Gather 12 logs for cottage 1"
  B-->>W: its steps: collect block=logs count=12, deposit item=all (the plan, no planner call)
  W->>S: collect(block=logs, count=12), then deposit(item=all), queued as written (no model call)
  S->>C: deposit: logs into the chest
  opt a step fails (logs out of reach)
    W->>E: plan, the failure, observation
    E-->>W: another way (e.g. collect elsewhere within 96 blocks)
    W->>S: enqueue
  end
  W->>B: finish (plan complete); claim "Build cottage 1" when its gather tasks are done
  W->>S: build_design cottage x, z
  S->>C: withdraw what is missing; craft planks, doors, smelt glass
  alt still short (gathered logs went elsewhere)
    S->>B: post gather tasks for the shortfall, put the build back behind them
  else everything in hand
    S-->>W: action_done: cottage recorded, placed 81 blocks
  end
  alt the mayor declares it
    M->>B: declare_complete (checked: every layout build done)
  else code, on the mayor's next tick
    B-->>M: every layout build done, nothing open: declared complete by code
  end
```

## 4. Villages

A village is shared state for agents building together, saved to `villages.json` next to each world
(`server/worlds/<world>/` for the sandbox, `mc/server/` for Minecraft). Roles come from memory: `villageRole: "mayor"`
coordinates, everyone else in the village is a worker.

```mermaid
stateDiagram-v2
  [*] --> open: plan_layout or the mayor posts
  open --> claimable: prerequisites done (a failed "soft" gather task counts) and its design drawn
  claimable --> claimed: a free worker claims it (before planning)
  claimed --> done: the worker's plan completes
  claimed --> open: handed back (replanned 3 times, or the plan failed), 1st time
  claimed --> failed: handed back a 2nd time
  open --> failed: cancelled (objective declared complete)
  failed --> open: the mayor re-posts it (a failed layout build is re-opened)
  failed --> [*]: the mayor reviews and may post a fix
  claimed --> open: a short build puts itself back behind new gather tasks
  done --> [*]
```

| Record | Written by | Purpose |
|---|---|---|
| Plots | `prepare_site` | Level ground, with its height, so buildings go on prepared land and plots can be extended at the same level. |
| Structures | `build`, `build_design`, `build_box` | Footprints: nothing is built on top of them; "a cottage already stands here" ends duplicate work. |
| Designs | the architect, the API, schematic import | The design library for `build_design`: layers of palette symbols, validated. |
| Task board | `plan_layout`, the mayor, short builds | Tasks with prerequisites (`after`), claims, results, tries; gather tasks are `soft` (their failure does not block the build, which checks its materials itself). |
| Storage | `deposit`, `withdraw`, builders (Minecraft) | The village's chests and what each held when last opened; shown in the planners' village summary and the panel. |
| Reservations | building skills while they run | Ground another agent is working on; `find_site` and other jobs avoid it (renewed while working, 3-minute expiry). |
| Layouts (`layouts`) | `plan_layout` | Each laid-out plot with its buildings, before any ground is prepared: site searches and later layouts, this village's or another's, keep off it. |
| Unplaced (`unplaced`) | `plan_layout` | Buildings that did not fit on the site: shown in the village summary, laid out by code at the mayor's next successful `find_site`; completion waits for them. |

Every village member stays within `VILLAGE_RANGE` (96 blocks, `village.ts`) of the village's home, `villageHome`: the
first layout or plot, else the first storage chest, else where the mayor started (`memory.origin`). `move_to` and
`explore` beyond it are refused or shortened, `collect` walks back first and searches from there, and `find_site`
walks at most two 40-block legs without leaving it.

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
  ev2 -. "a move failed twice<br/>from one spot" .-> rescue["Minecraft only:<br/>stuck rescue (mcRescue.ts),<br/>before the next skill"]
```

| | Sandbox (`agents.ts`) | Minecraft (`server/src/mineflayer/`) |
|---|---|---|
| Body | a sandbox `Player` driven by input each tick | a Mineflayer bot (client-side physics, half-width 0.3001 to stay in step with the server) |
| Walking | own A* Navigator (opens doors, digs out in creative) | mineflayer-pathfinder with a stuck/timeout watchdog, digging natural blocks only, opening doors, avoiding water (and swimming out of it), diagonals only with both sides clear, legs of ~40 blocks for long walks, a retry with longer drops |
| Crafting | recipes applied to the inventory | the recipe from minecraft-data, carried out by server command: ingredients counted and taken (`/clear`), the result given (`/give`); a table recipe still needs a table placed nearby |
| Gathering | `collect`, `mine` on sandbox blocks | `collect` resolves names in code (logs, cobblestone from stone, deepslate ores), picks the cheapest block to reach (near, not deep below, in the open, away from water), crafts a wooden pickaxe when stone needs one, stays within 96 blocks of the village and no more than 16 below it, and never mines inside a plot or its 2-block margin; it gives up a block after 3 tries or 90 s and shares unreachable blocks and targets between bots |
| Stuck rescue | none | `mcRescue.ts`: two failed moves within 3 blocks in 6 minutes (including a timed-out walk that got nowhere; `BotAgent.movedFailed`) run in the reflex's slot: swim up, walk out, climb out through natural blocks (pillaring with dirt or stone), and last, teleport beside the village storage; survival only |
| Building | `BuildJob`: blocks placed one by one, paced by `buildSpeed` | `/setblock` and `/fill` over RCON, paced by `buildSpeed`, vertical runs merged; in survival each run is charged to the inventory (`/clear`) after a material check, with crafting from storage and a requeue when short |
| Storage | none | `deposit` and `withdraw` against the village's chests (`mcStorage.ts`) |
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
  opt survival: materials
    J->>J: choose the wood kind per part from what is carried and stored
    J->>R: count what the builder carries (clear name item 0)
    J->>B: withdraw what is missing from the village storage, walk back
    J->>B: craft and smelt what can be made from the storage (table, furnace, planks, doors, glass), top up again
    J-->>E: action_failed "short of materials ... to get them: ..." and a requeue if still short
  end
  loop paced by buildSpeed (x10 blocks a second)
    J->>R: survival: clear name item n (charge the run)
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
| Workers' planner | `qwen3.8:27b` | tight one-step plans (6/6 against 2/6 for qwen3:30b); in the village economy it is not called at all (`plan 0x0ms` in every acceptance run), since tasks posted by code carry their own steps; it will matter for tasks players ask for in chat |
| Executors | `qwen3:30b-instruct` | a mixture of experts (~3B active): ~2 s a turn, as accurate as larger models when the plan is clear |

`scripts/ollama_exec.py start` runs the two local models on their own `ollama.exe serve` instances, pinned to a GPU
by UUID (CUDA and nvidia-smi number the cards differently here), after unloading them from the Ollama app: left to
itself, the app split a model across both cards and Windows silently spilled the rest into system RAM (60x slower).
It loads each model, checks it is fully in VRAM and times it.

Ollama's own "in VRAM" figure is not enough: once it reported "20383 of 20383 MB in VRAM" while nvidia-smi showed
1.3 GB on that card (Windows' shared GPU memory counted as VRAM), and the executor ran at 2.7 tokens a second; a model
fast at start-up can degrade like this later. `ollama_exec.py start` and `status` compare each card's used memory with
the model pinned to it and print a WARNING when it does not fit; then stop and start the servers. The brain sends
`keep_alive: -1` for routed models, so they stay loaded between runs.

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
village section shows the task board, buildings, plots, designs, the storage contents, reservations and the village log.

## 8. Testing

```mermaid
flowchart LR
  stage["stage_village.py<br/>(layout through the API,<br/>storage stocked by RCON)"] -- "scripted workers<br/>(brain: tasks)" --> api["REST API<br/>8765 sandbox / 8766 Minecraft"]
  script["watch_village.py / watch_agent.py /<br/>watch_survival.py<br/>(MCAI_API picks the world)"] -- "spawn (reset), memory,<br/>models" --> api
  script -- "poll events, board, stats" --> api
  script -- "early stop: objective met,<br/>same failure 3 times, stalled" --> report["log: timeline, board,<br/>designs, plots, buildings, storage, stats"]
  bench["scripts/bench/*.mts"] -- "the brain's real prompts<br/>and tools" --> ollama["Ollama models"]
  checks["scripts/checks/*.py<br/>(one skill or layout case,<br/>no models)"] -- "find_site, plan_layout,<br/>materials, smelting" --> api
  attach["attach_village.py<br/>(follow a running village)"] -- "poll events" --> api
```

Tests go from fast to slow. `npm run typecheck` first. `scripts/checks/` then checks one piece of the survival
village's code in seconds to a minute, without models: `find_site.py` (site search, wood, walking legs),
`layout_small_sites.py` (partial layouts, second sites), `materials_near_site.py` (plan_layout's material counts),
`treeless_site.py`, `smelt_fuel.py`; `test_rescue.py` traps Gus in a pit, a box or a pool. `stage_village.py` sets a
village up at a stage and runs scripted workers (`taskBrain.ts`: they run the skill calls each task spells out), so
the economy's code is checked in one to ten minutes with no model involved. The benches (`modelbench`, `execbench`,
`planbench`, `mayorbench`) replay the brain's real prompts against a model in seconds per case. Only then do
model-driven village runs test behaviour. `watch_village.py` probes for land (in survival, skipping ground with too
few trees) and spawns the village at the site it found; when a watcher dies mid-run (background tasks stop with the
session that started them), `attach_village.py` follows the running agents instead.

The agent server runs every bot on one Node event loop, so a slow synchronous step stalls them all: it logs any stall
over 2 s as a `[lag]` line with each agent's current action (`mineflayer/index.ts`). 2-3.5 s while bots join and
during a site search's log scan are expected; a stall over ~30 s made Paper time out every bot at once.

Agent names are fixed (Gus for single-agent tests; Mayor, Worker1, Worker2 for villages) so they are easy to find in
the world. There is no unit test suite: `npm run typecheck`, then agents are run.

## 9. The village economy (real Minecraft)

Villages in real Minecraft are built in survival from materials the agents gather themselves, in a world made safe:
the agent server applies peaceful difficulty and game rules for no damage and keep-inventory at every start
(`mcRules.ts`).

```mermaid
flowchart LR
  site["find_site<br/>(level, dry, 30 logs near)"] --> layout
  design["design<br/>(architect; 9x9 at most,<br/>whitelisted materials)"] --> bom["bill of materials<br/>and recipe chain<br/>(mcMaterials.ts)"]
  bom --> near{"materialsNear:<br/>enough near the site?"}
  near -- no --> refuse["plan_layout refused:<br/>smaller buildings or another site"]
  near -- yes --> tasks["gather tasks per building<br/>(plan_layout, gatherTasks)"]
  layout["plan_layout<br/>(layout.ts)"] --> near
  layout --> buildtask["build tasks at x, z"]
  tasks --> collect["collect, then deposit all"]
  collect --> storage[("village chests<br/>(mcStorage.ts)")]
  storage --> build["build_design (mcBuild.ts)<br/>withdraw, craft and smelt from storage,<br/>/setblock charging the inventory"]
  buildtask --> build
  build -- "still short" --> requeue["gather tasks for the shortfall;<br/>the build waits behind them"]
  requeue --> collect
```

| Part | File | What it does |
|---|---|---|
| World rules | `mcRules.ts` | peaceful; no fall, drowning, fire or freeze damage; keep-inventory; no monster spawning or fire spread; read back and shown in `/api/status` |
| Bill of materials | `mcMaterials.ts` | blocks per design (a door once for two cells), the cheapest recipe chain to raw materials (wood-kind variants merged into "any planks", a smelting table, whole batches, leftovers reused, fuel), unobtainable and hard-to-find items flagged |
| Storage | `mcStorage.ts` | chests placed by the first deposit and when full, registered as 1x1 structures, contents recorded at every opening |
| Site search | `mcBuild.ts` (`surveyGround`, `bestSite`) | a height grid built once with prefix sums and sliding min/max, every centre within 112 blocks checked, a height range of 4 allowed; off every village's buildings, layouts and plots; in survival 30 log blocks within 48 (none deeper than 16 below ground), walking up to two 40-block legs toward land or trees |
| Design limits | `tieredBrain.ts` (design checks) | survival designs at most 9x9, raw materials whitelisted (logs, stone, sand, sandstone, dirt, gravel, terracotta), no workstations or containers as decoration; one retry with the problems |
| Materials near the site | `mcWorld.materialsNear` | counts up to the amounts needed, as `collect` reaches blocks; wood may be a quarter short |
| Layout and tasks | `layout.ts`, `mcWorld.materialTasks` | positions with streets (narrower when that fits), partial layouts with the rest kept as unplaced; land, storage, gather (soft, in shareable parts) and build tasks, each as exact skill calls |
| Survival building | `mcBuild.ts` | wood kind per part, server-side counting, withdrawing, crafting and smelting from storage (fuel topped up from every plank stack), charging each run, requeueing a shortfall, open windows when there is no glass |
| Scripted workers | `taskBrain.ts` | run a task's skill calls without a model, for staged tests |

Results: the acceptance runs of 2026-09-28/29 built "two matching cottages and a meeting hall" from nothing with a
mayor and two workers and no manual help, five times with gpt-oss as the workers' planner (10.2-29.2 minutes; three in
a row) and twice with qwen3.8 (26.2 and 39.2 minutes); every failed run on the way was a code bug, since fixed. Still
open: `collect` often cannot reach logs high on hills (9-23 failed collects in hilly or jungle-edged woods); log roofs
make villages slow (a 9x9 log roof is 81 logs); the site search and the materials check scan synchronously and stall
the event loop for 2-3 s; and builders drawing on the chest at the same moment still come up short now and then (the
requeue recovers). The shared village atlas (`docs/PLAN.md`, phase 2) is meant to help with the first.
