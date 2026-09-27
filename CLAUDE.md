# MCAISandbox: notes for Claude Code sessions

A browser Minecraft-style sandbox with an authoritative Node server, built to host human players and LLM agents in one
world (Project Sid-style experiments). The README documents features, skills and the API; this file records how to work
on the project and what earlier sessions learned.

## Running and checking

- `npm run dev` starts the game server (http://localhost:8765, REST API under `/api`) and the Vite client
  (http://localhost:5173). `npm run typecheck` is the main check; there is no test suite, so verify agent changes by
  running agents (see Testing).
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
  models; buttons to stop, remove or (Minecraft) watch an agent. `server/panel/index.html` (no build step) and
  `server/src/panel.ts` (`/api/overview`, `/api/models`); brains report through `AgentBrain.status()`.
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
- Installed: `gemma4:31b` (dense, ~20 GB loaded; planner/architect), `qwen3:30b-instruct` (MoE, ~19 GB; executor), plus
  some `:cloud` models. Ollama puts one model per GPU, so both stay loaded.
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
9. **Latency.** Prompt size dominates local-model speed (observations are trimmed to ~2k tokens). With several agents the
   single gemma instance is the bottleneck; workers plan with qwen (6-10 s) while designs and the mayor use gemma.

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
10. control panel; village fixes; cloud planner (milestone d passed)

Backlog: `plan_layout` for the mayor; import a real downloaded schematic (only generated test files so far); stairs and
fence collision; survival-mode building (gather materials, then build).

## Real Minecraft (in progress)

The same brains run in real Minecraft Java Edition through Mineflayer. Decisions (agreed with the user): Minecraft
**26.1** (Paper 26.1.2; protocol 775, the newest Mineflayer supports; Paper warns it is behind 26.2, which is expected),
**Paper**, adapter code in `server/src/mineflayer/`, and building in two modes behind an option (operator commands in
creative, block-by-block placement in survival; not built yet).

- `mc/`: `setup.py` (portable Temurin 25 in `mc/runtime`, the Paper jar and `server.properties` in `mc/server`, both
  gitignored; checksums verified), `start.py` (runs the server), `rcon.py` (send commands, e.g. `python mc/rcon.py
  "list"`). The server listens on 127.0.0.1 only, offline mode, RCON on localhost, seed 1793578865, survival, easy.
  The user accepted the EULA on 2026-09-26. Stop the server with `python mc/rcon.py stop` (saves the world); killing
  it loses unsaved chunks. 26.x keeps no spawn chunks loaded: RCON block tests need `forceload` or a player nearby.
- `npm run mc:agents` (`server/src/mineflayer/index.ts`) connects agents as bots and serves the agent REST API on
  **port 8766**, with the sandbox's routes and JSON shapes, so the watch scripts can point at it. It needs the
  Minecraft server running. `tsx` here does not watch; stopping `npm` leaves the `tsx` child listening on 8766: stop
  it by PID (`Get-NetTCPConnection -LocalPort 8766`).
- `mcWorld.ts` (`MineflayerWorld`: WorldAdapter, spawn via bots + RCON gamemode/teleport, `reset` for a fresh start,
  villages in `mc/server/villages.json`), `botAgent.ts` (`BotAgent`: WorldAgent, skill queue, events, observation,
  self-defence reflex), `mcSkills.ts` (registry; skills as async functions with an AbortSignal, same names and
  arguments as the sandbox), `mcSurvival.ts` (survival skills), `mcBuild.ts` (building skills), `mcUtil.ts` (walk
  with watchdog, helpers),
  `mcApi.ts`, `rcon.ts`.
- Skills so far: move_to, chat (refuses "/" commands), wait, look_at, mine, collect, place, craft, smelt, eat,
  attack, explore, follow, give, equip, drop, get_item, find_site, prepare_site, build_design, build_box, build. Written on the pathfinder directly (collectblock and pvp were
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

Milestones (each tested and reported before the next): (a) done: an idle bot joins, observes, walks and chats;
(b) partly done, then set aside for creative (the user's call, to stop the deaths): scripted skills reach a stone
pickaxe; the best tiered run (qwen exec, gemma plan) had 7 unique items and a wooden pickaxe at 3.1 min (sandbox
baseline ~10 items in 8 min); earlier runs died to zombies before the reflex; `scripts/watch_survival.py`; (c) a creative agent runs find_site, prepare_site, build_design; (d) the full village, watched with
the real client. (d) passed on 2026-09-27 (village Elmfield, 11.0 min, 2 cottages + meeting hall, 8/8 tasks done,
1 failed action) with gpt-oss:120b-cloud as mayor planner and architect, qwen3.8:27b as worker planner (tight 1-step
plans, 6/6 in a benchmark against 2/6 for qwen3:30b) and qwen3:30b-instruct as executor (1.2 s/turn alone, but 6-11 s
in the run: three agents queue on one Ollama model). Models are set per run with MCAI_MAYOR_MODEL / MCAI_DESIGN_MODEL /
MCAI_EXEC_MODEL and the WORKER_PLANNER argument of watch_village.py. Model output is normalised in code: designs with
stringified layers (even without outer brackets) or rows as symbol arrays, tasks posted as skill calls
({task:"build_design", name, x, z}); build tasks wait for missing designs and for a land task posted with them.
(c) done: the tiered brain (qwen exec, gemma plan) ran find_site, prepare_site and build_design
"cottage" in 1.1 min with no failures (Gus not in a village, the design in memory.designs: as a village member he would
be a worker waiting for tasks). The village "Testville" in `mc/server/villages.json` holds the cottage design copied
from the sandbox (`POST /api/village/Testville/designs`). Mindcraft (github.com/kolbytn/mindcraft) is a reference for skills; check its licence before
copying anything.
