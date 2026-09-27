# MCAISandbox: notes for Claude Code sessions

A browser Minecraft-style sandbox with an authoritative Node server, built to host human players and LLM agents in one
world (Project Sid-style experiments); the same agents also run in real Minecraft. The README documents features,
skills and the API, `docs/ARCHITECTURE.md` how the system fits together (with diagrams); this file records how to work
on the project and what earlier sessions learned.

## Running and checking

- `npm run dev` starts the game server (http://localhost:8765, REST API under `/api`) and the Vite client
  (http://localhost:5173). `npm run typecheck` is the main check; there is no test suite, so verify agent changes by
  running agents (see Testing).
- **Starting the real-Minecraft stack** (in this order; after a reboot nothing is running, and the Ollama app is started
  by the user):
  1. `python mc/start.py` (Paper server; wait for "Done" in `mc/server/console.log`)
  2. `python scripts/ollama_exec.py start` (the two pinned local model servers; it unloads them from the app first)
  3. `MC_OLLAMA_ROUTES="qwen3:30b-instruct=http://127.0.0.1:11435,qwen3.8:27b=http://127.0.0.1:11436" node_modules/.bin/tsx server/src/mineflayer/index.ts`
     (agent server + panel on 8766; restart it after editing server files: it does not watch)
  4. a watch script, e.g. `MCAI_API=http://127.0.0.1:8766/api MCAI_MAYOR_MODEL=ollama:gpt-oss:120b-cloud
     MCAI_DESIGN_MODEL=ollama:gpt-oss:120b-cloud python scripts/watch_village.py <Village> 120 0 2 12 "<objective>" ollama:qwen3.8:27b`
  Stop: `python mc/rcon.py stop` (saves the world), `python scripts/ollama_exec.py stop`, the agent server by PID.
  Watch scripts leave their agents in the world when they stop on the time limit: remove them (panel or `DELETE`).
- `tsx watch` **restarts the server on every server-file edit**. That removes all agents (villages in
  `world/villages.json` and players' inventories persist). Do not edit server files while a test run is in progress.
- **World saving:** chunks are written to disk only when they unload (30 s after no player or agent needs them) or on a
  clean shutdown (SIGINT/SIGTERM runs `Game.stop()`). On Windows neither a `tsx watch` restart nor killing the process
  runs that handler, so building in still-loaded chunks is lost, while `villages.json` (saved on every change) keeps
  listing it. Before stopping the server, remove agents and let their chunks unload; a `/save` command or API endpoint
  would be a worthwhile addition.
- To watch in the game: open http://localhost:5173, `/gamemode spectator`, `/tp <agent>`.
- **Control panel:** http://localhost:8766/panel (real Minecraft) or http://localhost:8765/panel (sandbox):
  every agent's brain state (planning / thinking / acting / waiting, since when and why), plan, task, current action,
  recent decisions and events, blocked calls, model stats, inventory, the village task board, and Ollama's loaded
  models; buttons to stop, remove or (Minecraft) watch an agent. Each card also has a top-down map (every 2 s:
  terrain by top block and height, the agent's facing, mobs, players, its target, plots, buildings, reserved ground;
  `WorldAgent.mapAround`, `/api/maps`, cached 1.5 s, ~2 ms per 49x49 map) and "what the executor / planner saw": the
  exact user prompt of its last model call and the reply (`TieredBrain.status().lastExecutorCall/lastPlannerCall`).
  `server/panel/index.html` (no build step) and `server/src/panel.ts` (`/api/overview`, `/api/models`, `/api/maps`).
  A live 3D view was considered: prismarine-viewer stops at 1.21.4 (last release 2025-02), so not for 26.1.
  On Windows, `curl localhost:...` adds ~0.2 s per request (IPv6 first); use 127.0.0.1 when timing.
- `GET /api/block?x=&y=&z=` inspects the world; `loaded: false` means the chunk is not loaded (unloaded blocks used to read
  as air, which caused false conclusions).

## Conventions

- Work on the feature branch `tiered-brain-building` (see below); commit only when asked or clearly agreed. Commit
  messages end with the `Co-Authored-By` line the harness specifies.
- Commit `package-lock.json` together with dependency changes.
- Source files use CRLF line endings and `core.autocrlf=true`. `shared/src/physics.ts` has **mixed** endings (the fence
  block is LF): preserve them. When editing with Python on Windows, `open(p).read()` then `open(p, 'w').write()` keeps
  CRLF; never write with `newline=''`. Check `git diff --stat` against `git diff --ignore-cr-at-eol --stat` before committing.
- Long inline heredocs in the Bash tool sometimes fail to parse; write edit scripts to the scratchpad with the Write tool
  and run them.
- Write prose (README, comments) plainly; match the surrounding comment density.

## Local models (the user's machine)

- Two RTX 3090s (24 GB each); GPU 1 also drives the display. Ollama (0.34.x) at localhost:11434, models in `F:\AI Models`.
- Installed: `qwen3:30b-instruct` (MoE, ~19 GB; the executor), `qwen3.8:27b` (dense, ~22 GB at 8k; the workers'
  planner), `gemma4:31b` (dense, ~21 GB, only ~10 tok/s: the old planner/architect), and cloud models through the
  Ollama app: `gpt-oss:120b-cloud` (the user's paid subscription; the mayor's planner and architect), kimi, deepseek,
  mistral-large, minimax. Pull models through the API (`POST /api/pull`), not the CLI.
- **Local models run on their own servers** (`scripts/ollama_exec.py start|stop|status`): qwen3:30b on GPU 1 (it also
  drives the display) at port 11435 with `OLLAMA_NUM_PARALLEL=3`, qwen3.8 on GPU 0 at port 11436; the Ollama app
  (11434) only relays cloud models. The agent server routes by model: `MC_OLLAMA_ROUTES="qwen3:30b-instruct=http://127.0.0.1:11435,qwen3.8:27b=http://127.0.0.1:11436"`.
  Why: the app, holding two local models, split one across both cards and Windows silently spilled the rest into
  system RAM (qwen3:30b fell from ~30 to 1.8 tok/s). The script pins by GPU UUID (CUDA's device numbers differ from
  nvidia-smi's here), waits for the app to free memory, and checks each model is fully in VRAM and fast.
- Measured (Minecraft and agent servers running): executor turn ~2.0 s alone (1.2 s with them stopped), three at
  once ~1.7x the throughput of three in sequence; qwen3.8 worker plan ~7-10 s; gpt-oss mayor plan ~3.5 s, designs
  ~9 s. In a village run executors took 6-11 s per turn on one shared model: benchmarks alone understate queueing.
- Keep `num_ctx` at 8192 (`MC_OLLAMA_CTX`): at 16384 gemma spills to the CPU and runs ~7x slower. Two gemma instances do
  not fit, so `OLLAMA_NUM_PARALLEL` does not help it.
- Running the `ollama` CLI launches the Ollama app, which may auto-update itself.
- Claude API calls are billed separately from the user's Claude subscription.

## Agent architecture (server/src)

- `world.ts`: the world interface. `WorldAgent` (name, role, gamemode, memory, events, observe, enqueue, stop, idle,
  pushEvent, village) and `WorldAdapter` (villages, ticks, skills, isAgent, isPlaceable), plus `AgentBrain`, the
  event, observation and tool types. `tieredBrain.ts`, `llmBrain.ts`, `village.ts` and `designs.ts` depend only on it
  (and on each other), never on `agents.ts`, so they can run in another world (the planned Mineflayer adapter). World
  contract for events: `chat` carries `{from, text}`, `action_done` `{type}`, `action_failed` `{type, args, message}`
  (the loop guard keys on type + args).
- `skills.ts`: `TOOLS`, the skill tool definitions shared by both LLM brains. A world exposes the ones it implements
  as `WorldAdapter.skills`; keep skill names and arguments identical across worlds.
- `agents.ts`: the sandbox world. `Agent` implements `WorldAgent`, `AgentManager` implements `WorldAdapter`. It holds
  the body, skill queue, events and memory, all skills, the building engine (`BuildJob`: reach-first
  work order, commits to its walk target, reserves village ground, `buildSpeed` pacing, tree felling, creative direct
  placement), `find_site` / `prepare_site` / `build` / `build_box` / `build_design`, Navigator (A*, opens doors, digs out
  in creative through natural blocks only), and the REST API (`AgentManager.handleApi`).
- `tieredBrain.ts`: planner + executor brain on Ollama or Claude (`<provider>:<model>`, per agent via memory
  `execModel` / `planModel` / `designModel`), village roles (mayor, worker), design drawing, loop guards, stats.
- `village.ts`: shared village registry (plots, structures, design library, task board, reservations), saved to disk.
- `designs.ts`: design format (spaced symbol layers + palette), validation, automatic door fixing, the architect prompt.
- `schematic.ts` + `nbt.ts`: import `.schem` / `.schematic` / `.litematic` / `.nbt` as designs, with block mapping
  onto the sandbox's blocks (sandbox-only; real Minecraft needs no mapping).
- `llmBrain.ts`: the Claude brain.
- `brains.ts`: the brain registry and the scripted brains (worker, companion), which use the sandbox `Agent` directly.

## Lessons from building the agents

These cost real debugging time; keep them in mind before changing agent behaviour.

1. **Models decide; code does arithmetic and geometry.** LLMs miscount (crafting quantities, row lengths), misplace
   things spatially (doors a block inside the wall, overlapping building positions) and invent ids. Fix this in skills,
   not prompts: `craft` makes missing planks/sticks, designs use spaced symbols (`"L P P L"`), doors are moved in code,
   `find_site` suggests the largest site that fits. The weaker the model, the higher-level the skills should be.
2. **Failure messages are the model's eyes** (Project Sid's "action awareness"): say what is short or where the problem
   is and what to do next ("needs 3 planks (have 2)", "the ground is not level; run prepare_site x= z= first",
   "a cottage built by Worker2 already stands here; if this was your task it is done").
3. **Agents loop unless stopped.** Guards in place: the same failed call twice, or the same successful call twice in two
   minutes, is refused; a step is marked done when the skill it names succeeds (executors forget `step_done`); a worker
   hands back a task it replanned three times; the planner reviews after 3 failures or 3 minutes without progress.
4. **Multi-agent races and storms.** Workers claim a task *before* planning (otherwise all plan the same one); ground is
   reserved during work; an agent without a plan may only chat (urgent chat made idle agents freelance); chat from other
   agents only interrupts when it names the agent, and each agent speaks at most every 30 s (553 messages in 10 min
   before this).
5. **The mayor** must pick the site before posting land and building tasks, and tasks need absolute coordinates
   ("prepare_site at x, z, 30x30", "build_design cottage at x, z"). It is still poor at layout arithmetic: buildings it
   places can overlap. Planned fix: a `plan_layout` tool that computes positions in code.
6. **Prepare land like a player** (the user's idea): find_site, then prepare_site (fell whole trees, cut and fill to one
   level), then build. Building on unprepared ground caused pillars, floating canopy and trapped agents.
7. **Terrain and loading.** Much of this world (seed 1793578865) is ocean or steep hills: probe for land before village
   tests. Agents load 4 chunks around them (enough for find_site up to 40x40).
8. **Doors** collide as a thin panel (they were full cubes, a pre-existing bug), the pathfinder treats them as passable,
   walkers open them, and blueprint doors are placed facing through the wall. Stairs and fences still collide as full
   cubes (not fixed).
9. **Latency.** Prompt size dominates local-model speed (observations are trimmed to ~2k tokens). With several agents
   one model instance is a queue: gemma (mayor and designs) was the bottleneck until the cloud planner; now the
   executors share qwen3:30b with three parallel slots. The user's Minecraft client on GPU 1 made models 3-10x slower:
   keep it closed during runs (watch from the control panel).
10. **Evaluating a model**: time it on the real prompts and tools (`scripts/bench/`: `modelbench.mts` planner and
   architect, `execbench.mts` executor turns from situations that went wrong, `planbench.mts` worker plans; run with
   `node_modules/.bin/tsx scripts/bench/<name>.mts <model>...` and `OLLAMA_URL=` for a pinned server; `PEEK=1` prints
   raw tool calls). Look at the raw tool calls before judging: most "failures" of new models were format quirks.
   Results so far: gemma4:31b 10 tok/s but reliable designs; qwen3.8:27b 20 tok/s, best worker plans, designs need a
   retry; qwen3:30b fastest and fine as executor, poor designs and loose plans; gpt-oss:120b-cloud fastest planner and
   architect (~3.5 s / ~9 s).
11. **Model output needs normalising in code**, differently per model: qwen3.8 sent design layers as a JSON string
   without its outer brackets; gpt-oss wrote tasks as skill calls (`{task: "build_design", name, x, z}`) and plan steps
   as objects. `normalizeLayers`, `postedTasks` and `stepText` handle these; check a new model's raw tool calls first
   (the benchmark scripts in the scratchpad did: raw `/api/chat` with the real prompts and tools).

## Testing agents

- Use `scripts/watch_village.py` (village runs) or `scripts/watch_agent.py` (one agent). They stop early when the
  objective is met or the agent is stuck; the user prefers fast iterations over fixed long waits, so always use an early
  stop, `buildSpeed: 4`, and background runs with a notification.
- A typical village run (mayor + 3-4 workers, qwen executors, gemma mayor/designs) takes 4-10 minutes. Spawn on land
  (the village watcher searches for it); read the log for failures, loops and duplicate work, not just the outcome.
- **Agent names are fixed** (the user finds them in the world by name): **Gus** for any single-agent test,
  **Mayor, Worker1, Worker2** for villages (2 workers, the user's choice: `watch_village.py ... 2 ...`). In real Minecraft a name keeps its inventory and position, so
  spawn test agents with `"reset": true`. The user watches with the real client as SausageOfDoom4 (spectator).
- For a single skill, spawn an `idle` agent in creative mode and queue actions with `/api/agents/:name/act`; check
  results with the events stream and `/api/block`.

## State of the work

Branch `tiered-brain-building`, not merged or pushed (`main` is unchanged):
1. `182a934` two-tier brain, building skills, door and pathfinding fixes
2. `8c79b1f` villages: registry, model-designed buildings, mayor and workers
3. `c661150` village robustness (fast worker planning, walls, stuck tasks, site search)
4. `570778d` schematic import
5. documentation and test scripts (this file, README, `scripts/`)
6. `86b6794` world interface (`world.ts`, `skills.ts`)
7. `c143688` real Minecraft: server setup and Mineflayer adapter, milestone (a)
8. `4749536` survival skills, reflex, fresh-start spawns (milestone b, partly tested)
9. `bc94747` building skills with server commands (milestone c)
10. `7b9b392` control panel; village fixes; cloud planner (milestone d passed)
11. `41d35e2` panel maps and "what the model saw", model routing and pinned Ollama servers, docs/ARCHITECTURE.md
12. `cd33cc4` fix: build tasks wrongly held back for a missing design ("build_design design=..." read as a design
    called "design"); pushed to origin (the feature branch only; `main` untouched)
13. handover notes and model benchmark scripts (`scripts/bench/`)

**Next: the peaceful village economy** (see the section below). Other backlog: `plan_layout` for the mayor (part of the
next work); import a real downloaded schematic (only generated test files so far); stairs and
fence collision; survival-mode building (gather materials, then build).

## Next: the peaceful village economy (agreed 2026-09-27, not started)

The user changed the base assumptions: **no survival with hostile mobs or damage at all**. Agents gather and craft
the materials a village needs, then build with them. Decisions made with the user:
- **Minecraft only.** The sandbox stays as it is (a quick test bed for the brain); no peaceful mode is added there.
- **Survival mode, made safe:** peaceful difficulty (no hostile mobs; hunger does not drain), and game rules for no
  fall, drowning, fire or freeze damage and keep-inventory. Done: `mcRules.ts` applies them over RCON at every
  agent-server start and reads each back (log line "World settings: ...", `/api/status` `worldRules`, the panel
  header). 26.1 names game rules in snake_case (`fall_damage`, `keep_inventory`, `spawn_monsters`,
  `fire_spread_radius_around_player`; camelCase is rejected), and a bare `gamerule` lists nothing over RCON: the full
  list is in the jar (`net/minecraft/world/level/gamerules/GameRules.class`). `time query daytime` no longer exists
  (timelines). `server.properties` now says `difficulty=peaceful` too (the server re-applies it at start).
- **Building places blocks by command but charges the inventory:** `/setblock` / `/fill` as now, but each block must
  be carried, is taken from the inventory (e.g. RCON `clear <agent> <item> <n>` per run of blocks), and the job stops
  when a material runs out. Not real block-by-block placement.
- **Shared village storage:** gatherers and crafters deposit into a village chest; builders withdraw what a building
  needs. The first chest is crafted like anything else (8 planks).

Agreed plan (each step tested before the next):
1. Done (tested: a 30-block drop leaves a survival bot at 20 health). World config: peaceful + no-damage game rules, applied at agent-server start.
2. Done (`mcMaterials.ts`; `GET /api/village/:v/designs/:d/bill`, `GET /api/materials?items=glass:8&have=sand:2`,
   `scripts/bench/materials.mts` prints every stored design's plan). Recipes merged across wood kinds become
   "any planks"/"any logs" (a chest takes any planks, an oak door oak planks); smelting is a hand table (minecraft-data
   has none); batches round up and leftovers are reused; sandstone, terracotta, coal and wool count as gathered;
   Nether and hostile-drop items (glowstone, string) are reported as unobtainable. Placed grass is charged as dirt.
   The plan was: blocks per design (a door is one item for two cells; `_` and `.` cost nothing), and a
   recipe-chain resolver to raw materials with minecraft-data (planks <- logs, glass <- sand + fuel in a furnace,
   stone bricks <- stone <- cobblestone smelted, doors <- planks...). Code, not the model, does this arithmetic.
3. Done (`mcStorage.ts`; tested with Gus in the test village Depot, chests at -6,81,8 and -4,80,8). `village.storage`
   holds the chests and each one's contents as last opened (the server's counts matched). The first `deposit` puts a
   carried chest down near the agent, outside plots; a full storage takes a carried chest in a row beside the others,
   one block apart (single chests, never read twice). Each chest is also a 1x1 `storage` structure, so building and
   site search keep off it. `deposit` item / "logs" / "planks" / "all" (keeps tools and chests), `withdraw` item and
   count (partial amounts reported). Shown in the village summary, the panel and `/api/village/:v`;
   `POST /api/village/:v/storage {x,y,z}` registers an existing chest.
4. Survival building: `build_design` / `build` / `build_box` check the bill against inventory + storage, withdraw
   what is missing, charge the inventory while placing, and fail with "short of N x (carrying A, storage has B):
   gather or craft them".
5. Mayor planning: code adds the gather / craft / deposit tasks a build task needs ahead of it (from the bill of
   materials), and `plan_layout` gives building positions inside the plot with streets (the Ashvale run showed the
   mayor's layout arithmetic still fails: the hall stuck out of the plot and he spent the run relocating it).
6. Test: one cottage first, then two cottages and a meeting hall.

Things to expect:
- **Gathering is slow**: two cottages and a hall are ~600 blocks (~75 logs' worth of planks, cobblestone, sand for
  glass, fuel): perhaps half an hour or more for two workers. Start with one small cottage; have the architect prefer
  cheap, gatherable materials (planks, logs, cobblestone, glass; sandstone only if sand is near); consider axes and
  pickaxes early (crafting them is the usual progression, and they speed gathering a lot).
- The spawn area (seed 1793578865) is badlands/savanna: acacia trees are scattered, sand and terracotta common,
  stone close under the surface. Earlier plots are at ~86..130, -32..23 (Oakridge, Elmfield, Ashvale): build elsewhere
  or reuse them.
- Survival skills that exist and work (`collect`, `craft`, `smelt`, `mine`, `place`, `explore`): see the lessons below
  (crafting desync, buried stone, leaves). The self-defence reflex stays but should never fire in peaceful.
- Survival walking is slower than creative (no flying, real digging times); watch `stuck` failures in `move_to`.

## Real Minecraft

The same brains run in real Minecraft Java Edition through Mineflayer. Decisions (agreed with the user): Minecraft
**26.1** (Paper 26.1.2; protocol 775, the newest Mineflayer supports; Paper warns it is behind 26.2, which is expected),
**Paper**, adapter code in `server/src/mineflayer/`, and building in two modes behind an option (operator commands in
creative, block-by-block placement in survival; not built yet).

- `mc/`: `setup.py` (portable Temurin 25 in `mc/runtime`, the Paper jar and `server.properties` in `mc/server`, both
  gitignored; checksums verified), `start.py` (runs the server), `rcon.py` (send commands, e.g. `python mc/rcon.py
  "list"`). The server listens on 127.0.0.1 only, offline mode, RCON on localhost, seed 1793578865, survival, peaceful.
  The user accepted the EULA on 2026-09-26. Stop the server with `python mc/rcon.py stop` (saves the world); killing
  it loses unsaved chunks. 26.x keeps no spawn chunks loaded: RCON block tests need `forceload` or a player nearby.
- `npm run mc:agents` (`server/src/mineflayer/index.ts`) connects agents as bots and serves the agent REST API on
  **port 8766**, with the sandbox's routes and JSON shapes, so the watch scripts can point at it. It needs the
  Minecraft server running. `tsx` here does not watch; stopping `npm` leaves the `tsx` child listening on 8766: stop
  it by PID (`Get-NetTCPConnection -LocalPort 8766`).
- `mcWorld.ts` (`MineflayerWorld`: WorldAdapter, spawn via bots + RCON gamemode/teleport, `reset` for a fresh start,
  villages in `mc/server/villages.json`), `botAgent.ts` (`BotAgent`: WorldAgent, skill queue, events, observation,
  self-defence reflex), `mcSkills.ts` (registry; skills as async functions with an AbortSignal, same names and
  arguments as the sandbox), `mcSurvival.ts` (survival skills), `mcBuild.ts` (building skills), `mcRules.ts` (peaceful world settings), `mcMaterials.ts` (bills of
  materials, recipe chains), `mcUtil.ts` (walk
  with watchdog, helpers),
  `mcApi.ts`, `rcon.ts`.
- Skills: move_to, chat (refuses "/" commands), wait, look_at, mine, collect, place, craft, smelt, eat,
  attack, explore, follow, give, equip, drop, get_item, find_site, prepare_site, build_design, build_box, build, deposit,
  withdraw. Written on the pathfinder directly (collectblock and pvp were
  dropped: less control over failure messages and cancelling, and pvp pulls in mineflayer 2.x). Brains: idle,
  tiered, llm.
- `collect` resolves names in code: "logs" is any log, an item means the blocks that drop it (cobblestone -> stone),
  ores include deepslate variants; open blocks first, buried ones by digging to them. `craft` makes the table, then
  sticks, then planks (in that order: each uses planks), and prefers everyday recipe variants in messages.
- **Building** (`mcBuild.ts`) ports the sandbox's checks, messages and village records (reserve, plots, structures,
  "already stands here"), but in creative the work is done with `/setblock` and `/fill` over RCON (the server console,
  so bots need no op), paced by `buildSpeed` (x10 blocks/s), vertical runs merged into one `/fill`, while the bot
  stands south of the site and looks at the blocks. Doors are set as both halves with the outward facing; whole trees
  touching a plot are felled. Survival building (placing carried blocks) is not implemented: it refuses with a message
  (`memory.buildMode: "commands"` forces commands in survival). `isPlaceable` accepts block states (`[facing=east]`).
- **Reflex** (`BotAgent.selfDefence`): a hostile mob that just hurt the bot is fought (with a sword or axe) or fled
  from (unarmed, low health, creepers); the interrupted action resumes. An LLM turn is too slow for a zombie.

Open issues left from the last session: the Ashvale agents (Mayor, Worker1, Worker2) are still in the world on old
code with task t55 (a relocated meeting hall) open and unneeded; the pinned servers and the Paper server were left
running. `/api/maps` and the "what the model saw" panel sections were checked through the API but not yet viewed in
a browser by the user.

Lessons from the adapter:
1. **Mineflayer bots got stuck against walls on 26.1**: its physics uses a player half-width of exactly 0.3 while the
   server uses 0.6f / 2, so a bot pressed into a wall overlaps it by ~1e-8 in the server's eyes and every move is
   rejected (the server teleports it back each tick, silently). `botAgent.ts` sets `playerHalfWidth` to 0.3001.
   Worth reporting upstream (ask the user first).
2. Wait for chunks (`waitForChunksToLoad`) after spawning and after teleports, or the first skills see unloaded
   (null) blocks.
3. Pin `vec3` to Mineflayer's 0.1.x, or its types clash with the pathfinder's.
4. **Crafts sent back to back desync the inventory** (the server drops some, the client counts them): `doCraft` waits
   for the result to appear. At a crafting table it can take over 2 s, so a false "not confirmed" still happens
   occasionally (the craft does go through; open issue).
5. A bot that climbed a tree for logs can stand on leaves 5 blocks up; the pathfinder's 4-block drop limit leaves it
   no path at all. `walk` retries once with an 8-block drop.
6. A player name keeps its inventory and position on the server between runs: tests spawn with `"reset": true`.
7. In creative, broken blocks drop nothing (collect refuses and suggests get_item).
8. On Windows `curl localhost:...` takes ~0.2 s per request (IPv6 first, servers listen on IPv4): time with 127.0.0.1.
9. prismarine-viewer (a live 3D bot view) stops at 1.21.4 (last release 2025-02), so there is none for 26.1; the
   panel's top-down map (`mapAround`) is the substitute.
10. The pathfinder spends carried dirt **and cobblestone** as scaffolding by default: `moves()` limits it to dirt
   (cobblestone is a building material now).
11. The pathfinder takes diagonal steps with one side blocked; the bot catches on that corner and wiggles in place until
   the watchdog says "stuck" (reproduced on a badlands terracotta mound). `moves()` allows diagonals only with both
   sides clear.
12. Teleporting a bot with `tp x ~ z` can put it inside a hill: it suffocates (damage the game rules do not turn off)
   and cannot walk. Use `spreadplayers x z 0 1 false <name>` for the surface. A name also rejoins where it left.

Milestones (each tested and reported before the next): (a) done: an idle bot joins, observes, walks and chats;
(b) partly done, then set aside for creative (the user's call, to stop the deaths): scripted skills reach a stone
pickaxe; the best tiered run (qwen exec, gemma plan) had 7 unique items and a wooden pickaxe at 3.1 min (sandbox
baseline ~10 items in 8 min); earlier runs died to zombies before the reflex; `scripts/watch_survival.py`; (c) a creative agent runs find_site, prepare_site, build_design; (d) the full village, watched with
the real client. (d) passed on 2026-09-27 (village Elmfield, 11.0 min, 2 cottages + meeting hall, 8/8 tasks done,
1 failed action) with gpt-oss:120b-cloud as mayor planner and architect, qwen3.8:27b as worker planner (tight 1-step
plans, 6/6 in a benchmark against 2/6 for qwen3:30b) and qwen3:30b-instruct as executor (1.2 s/turn alone, but 6-11 s
in the run: three agents queue on one Ollama model). Models are set per run with MCAI_MAYOR_MODEL / MCAI_DESIGN_MODEL /
MCAI_EXEC_MODEL and the WORKER_PLANNER argument of watch_village.py. Rerun as Ashvale with the pinned Ollama servers (3 parallel executor
slots): all 6 tasks done in 4.2 min instead of 7.8, executor turns 3.4-7 s instead of 6.5-11, 0 failed actions; but
the mayor placed the hall partly outside the prepared plot (layout arithmetic, lesson 5), then spent the rest of the
run relocating it (17 refused repeats) instead of declaring complete: `plan_layout` is the next thing to build. Model output is normalised in code: designs with
stringified layers (even without outer brackets) or rows as symbol arrays, tasks posted as skill calls
({task:"build_design", name, x, z}); build tasks wait for missing designs and for a land task posted with them.
(c) done: the tiered brain (qwen exec, gemma plan) ran find_site, prepare_site and build_design
"cottage" in 1.1 min with no failures (Gus not in a village, the design in memory.designs: as a village member he would
be a worker waiting for tasks). The village "Testville" in `mc/server/villages.json` holds the cottage design copied
from the sandbox (`POST /api/village/Testville/designs`). Mindcraft (github.com/kolbytn/mindcraft) is a reference for skills; check its licence before
copying anything.
