# MCAISandbox: notes for Claude Code sessions

A browser Minecraft-style sandbox with an authoritative Node server, built to host human players and LLM agents in one
world (Project Sid-style experiments); the same agents also run in real Minecraft. The README documents features,
skills and the API, `docs/ARCHITECTURE.md` how the system fits together (with diagrams); this file records how to work
on the project and what earlier sessions learned.

**Current work is planned in `docs/PLAN.md`**: read its "Next session starts with" and the current phase at the start
of every session, work step by step, and update it (steps, run record, findings, decisions, next-session notes) before
the session ends. When a run teaches something new, the plan changes with it (its last section says how).

## Running and checking

- `npm run dev` starts the game server (http://localhost:8765, REST API under `/api`) and the Vite client
  (http://localhost:5173). `npm run typecheck` is the main check; there is no test suite, so verify agent changes by
  running agents (see Testing).
- **Starting the real-Minecraft stack** (in this order; after a reboot nothing is running, and the Ollama app is started
  by the user):
  1. `python scripts/detach.py runs/<date>/paper.log python mc/start.py` (Paper server; wait for "Done (" in
     `mc/server/logs/latest.log`; `mc/server/console.log` is stale). **Start servers with `scripts/detach.py`, not the
     Bash tool's `run_in_background`**: a background task is stopped at its 30-minute limit, and Paper was killed
     unsaved that way (F90).
  2. `python scripts/ollama_exec.py start` (the two pinned local model servers; it unloads them from the app first)
  3. `MC_API_HOST=0.0.0.0 MC_OLLAMA_ROUTES="qwen3:30b-instruct=http://127.0.0.1:11435,qwen3.8:27b=http://127.0.0.1:11436" python scripts/detach.py runs/<date>/agentserver-N.log node node_modules/tsx/dist/cli.mjs server/src/mineflayer/index.ts`
     (agent server + panel on 8766; restart it after editing server files: it does not watch; add `MC_TIME_SCALE=2`
     for staged runs and checks at double speed, never for model-driven acceptance runs)
  The **test world** (phase T, `docs/PLAN.md`): a second Paper in `mc/testserver` (25566, RCON 25576) with its own
  agent server on 8767, generated from the same seed; `MCAI_API=http://127.0.0.1:8767/api python
  scripts/reset_site.py SITE` (add `MC_TIME_SCALE=2` and/or `MC_OLLAMA_ROUTES` as needed) restores a site from the
  snapshot in `mc/testworld` and starts both servers detached; then `MCAI_API=http://127.0.0.1:8767/api
  MC_SERVER_DIR=mc/testserver python scripts/stage_village.py V --site SITE` (or watch_village.py with the same two
  settings and the site's probe point). Sites: `scripts/test_sites.json`.
  4. a test: first the staged one without models, `python scripts/stage_village.py <Village> -160 -100 --stage build`
     (~1 min; `--stage full` ~8 min), then a model-driven village, the survival economy:
     `MCAI_API=http://127.0.0.1:8766/api MCAI_MAYOR_MODEL=ollama:gpt-oss:120b-cloud MCAI_DESIGN_MODEL=ollama:gpt-oss:120b-cloud
     MCAI_GAMEMODE=survival MCAI_STALL_MIN=5 MCAI_SAME_FAIL=6 python scripts/watch_village.py <Village> -160 -100 2 90
     "two matching cottages and a meeting hall" ollama:qwen3.8:27b` (10-40 min: ~300-block villages 10-15 min,
     500+ blocks or log roofs 25-40). Without `MCAI_GAMEMODE` it runs in creative (free blocks, a few minutes). The
     watcher probes for land (in survival it skips ground with too few trees) and spawns the village at the site
     it found, not at X Z.
  To restart the agent server after a server edit: stop the process on port 8766
  (`Get-NetTCPConnection -LocalPort 8766 -State Listen`), start step 3 again with `run_in_background`.
  Stop: `python mc/rcon.py stop` (saves the world), `python scripts/ollama_exec.py stop`, the agent server by PID.
  Watch scripts leave their agents in the world when they stop (time limit or stall): remove them (panel or
  `DELETE`). If a session restart kills a watcher mid-run, `python scripts/attach_village.py VILLAGE MINUTES_SO_FAR`
  follows the running agents instead.
- **Background tasks die with the Claude session and at their time limit** (30 minutes by default): servers and
  watchers started with `run_in_background` stopped when a session restarted (a watcher mid-run on 2026-09-28), and
  Paper was stopped unsaved at the limit (2026-10-01). Servers go through `scripts/detach.py`; watchers of long runs
  get a `timeout` above their length. At every session start check ports 25565, 8766, 11435, 11436 (and 25566, 8767
  for the test world) and restart what is missing.
- The agent server logs event-loop stalls over 2 s as `[lag] ... blocked for ~N ms; <each agent's action>`. 2-3.5 s
  when bots spawn and during find_site's log scan are normal; a stall over ~30 s makes Paper time out every bot at
  once (Accept4, cause never found).
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
- **Network access (2026-09-28):** the Paper server listens on the LAN (`server-ip=` empty; firewall rule "MCAISandbox
  Minecraft server (LAN)" allows TCP 25565 from the local subnet) with the **whitelist on**: SausageOfDoom4, Gus,
  Mayor, Worker1-4. A new agent name must be whitelisted first (`python mc/rcon.py "whitelist add <name>"`) or its
  bot is refused. RCON also listens on all addresses now but no firewall rule lets it in. The agent server serves the
  panel to the LAN when started with `MC_API_HOST=0.0.0.0` (http://192.168.1.84:8766/panel; no login). Time is frozen
  at day (`gamerule advance_time false`, 26.1's name for doDaylightCycle). The watch scripts teleport SausageOfDoom4 to
  the Mayor (or the test agent) when the user is online.
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
  and run them. In edit scripts: open files with `encoding='utf-8'` (the panel HTML is not cp1252), and prefer the Edit
  tool for lines with backslash escapes (``, `
` in template strings came out wrong through Python twice). Check
  `git ls-files --eol` after any shell edit. **Never use `sed -i` on repo files**: Git Bash's sed writes LF and has
  turned CRLF files into LF three times (twice on 2026-09-29); use the Edit tool or a Python script.
- Start long runs with the Bash tool's `run_in_background` (not `&`, which can die with the shell) and follow them with
  a Monitor on the log (`tail -n +1 -f log | grep --line-buffered ... | awk '{print substr($0,1,280); fflush()}'`):
  `cut` at the end of the pipe buffers and delivers nothing, and so does a second `grep` without `--line-buffered`
  (a monitor stayed silent through a whole run). Stop old monitors (two tailing one log report every event twice) and
  re-arm when one expires (30 min) during a long run.
- **Auto mode's classifier** (2026-09-29) blocked `git push` ("Out-of-Place Publication"; the user then added a
  `Bash(git push *)` allow rule to `~/.claude/settings.json`; still ask before pushing), an Agent call with
  `isolation: "worktree"` (same reason) and editing Claude's own settings ("Self-Modification"). Do not work around
  these: ask the user to switch out of auto mode or to request the action explicitly.
- Python edit scripts inside a Bash heredoc mangle backslashes (`\n`, `\S`, Windows paths): write the script with
  the Write tool and run the file, or use the Edit tool.
- **Start Claude Code sessions on the main checkout** (`D:\Projects\MCAISandbox`), not in a worktree (2026-10-05): the
  desktop app refused every edit a worktree session made to the main checkout (even with the folder granted), and a
  worktree has no worlds, run logs or `node_modules`; the fifteenth session's record had to be handed over in a file.
- Never edit server files while a test runs, even though the agent server does not reload them (the user's rule; it
  was broken twice in the 2026-09-27 session without effect on the runs).
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
- **Pinned models stay loaded** (the brain sends `keep_alive: -1` for routed models; the servers start with
  `OLLAMA_KEEP_ALIVE=-1`): after an idle unload, qwen3.8 once reloaded partly into system RAM and every worker plan
  timed out. `ollama_exec.py start` warms each model with a ~3k-token prompt: the first long prompt after loading
  took qwen3.8 ~4 minutes (short prompts do not show it). Calls time out after `MC_OLLAMA_TIMEOUT` (default 300 s).
  If plans time out, run `python scripts/ollama_exec.py status`: a model not fully in VRAM means stop and start.
- **Ollama can report a spilled model as fully in VRAM** (2026-09-28): "20383 of 20383 MB in VRAM" while nvidia-smi
  showed 1.3 GB on that card and the executor ran at 2.7 tok/s (one turn took 187 s and stalled a village). It was
  fast at start-up and degraded later. `ollama_exec.py start` and `status` now compare each card's memory with its
  model and print a WARNING: then stop and start. Check `status` before every run series.
- qwen3.8 worker plans measured ~12-28 s on 2026-09-27 (not the 7-10 s benchmarked earlier), with GPU 0 nearly full.
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
- `huts.ts`: the buildings code draws itself (2026-09-29): the storage hut (7x9, nine chest spots, the village's crafting
  table and furnace) and the mining hut (5x5, wood only, the mine's stairs); `plan_layout` adds both to a new village's
  first layout in survival.
- `layout.ts`: plan_layout (`postLayout`), used by the mayor and the API. `taskBrain.ts`: the scripted village worker
  for tests (runs the skill calls a task spells out).
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
- A survival village run (mayor + 2 workers) takes 10-40 minutes; creative runs 4-10. The village watcher finds land
  itself; read the log for failures, loops and duplicate work, not just the outcome (most failures on 2026-09-28 were
  code bugs visible in the log, not model behaviour).
- **Targeted checks without models** (`scripts/checks/`, 2026-09-28; need the agent server, some use villages from this
  machine's `mc/server/villages.json`): `find_site.py X Z SIZE[:SLOPE],...` (site search, wood, walking legs),
  `layout_small_sites.py NAME` (partial layouts, second site), `materials_near_site.py` (plan_layout's material
  counts), `treeless_site.py`, `smelt_fuel.py`, `atlas.py [X Z [DIRECTION DISTANCE]]` (walks Gus, compares chunk summaries
  with `/api/block`, ~15 s a chunk), `fell_trees.py [X Z [COUNT [ROUNDS]]]` (Gus collects logs; logs, pillar dirt and
  drops left around each felled tree), `mine.py VILLAGE [ROUNDS [COUNT]]` (Gus collects cobblestone in a village's mine;
  every round must come from the planned tunnel cells with nothing else changed; it prints the RCON line to give him a
  pickaxe, `PICKAXE_WAIT=0` makes him make his own) and `atlas_ores.py VILLAGE` (the atlas's exposed ores against the
  blocks; spawn an idle Gus at the mine first so its chunks are loaded). Run the relevant one after changing find_site,
  layout.ts, smelting, the atlas, felling or the mine. No server needed: `region_blocks.py X Y Z [X2 Y2 Z2]` reads
  blocks from the saved region files (only chunks already saved: unloaded or after `python mc/rcon.py stop`), and
  `hilly_land.py [DROP]` lists fresh land beside a drop from the atlas. Staged runs with felling need `MCAI_STALL_MIN=5` (a 30-cobblestone task with a pickaxe to make takes over
  3 minutes; since the huts, use 8); `stage_village.py` ignores soft "cannot be gathered here" failures.
  `fresh_land.py [MIN_DISTANCE]` lists fresh land from the atlas, away from every village (no server needed);
  `follow_workers.py VILLAGE MINUTES` follows the workers on after a stage run's stall rule stopped it.
  Since phase T (2026-10-01): `site.py X Z SIZE` (find_site's report against the blocks; run after changing find_site
  or prepare_site), `walk_speed.py` (Gus walks 14 fixed legs on StageM8's plot: compare game speeds),
  `scripts/gen_test_sites.py NAME|all` (generate a new test site's land; its docstring says how to add a site to the
  snapshot), `region_blocks.py --world W --compare OTHER X1 Y1 Z1 X2 Y2 Z2` (a restored site against the snapshot).
  Since 2026-10-02: `top_map.py WORLD X1 Z1 X2 Z2` (offline top-ground map: a prepared plot's pits against the
  snapshot), `region_logs.py WORLD X1 Y1 Z1 X2 Y2 Z2` (logs with their axis: fallen trees); `site.py` also checks the
  wood count; `site.py` and `fell_trees.py` take `MCAI_API`. The "shelf" site needs `--buildings testhut,testhut,testhall`.
  To see the panel without a browser:
  headless Edge (`"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --screenshot=<png>
  --window-size=1300,1100 --virtual-time-budget=8000 http://127.0.0.1:8766/panel`), then read the PNG.
- **Agent names are fixed** (the user finds them in the world by name): **Gus** for any single-agent test,
  **Mayor, Worker1, Worker2** for villages (2 workers, the user's choice: `watch_village.py ... 2 ...`). In real Minecraft a name keeps its inventory and position, so
  spawn test agents with `"reset": true`. The user watches with the real client as SausageOfDoom4 (spectator).
- For a single skill, spawn an `idle` agent in creative mode and queue actions with `/api/agents/:name/act`; check
  results with the events stream and `/api/block`. `move_to` needs x, y and z.
- `scripts/test_rescue.py [pit|box|pool|tunnel]` traps Gus with RCON and checks the stuck rescue (pit: the pathfinder climbs
  out with dirt by itself, "NO RESCUE" is its pass; box: teleport; pool: swim, then teleport; tunnel: teleport, never
  "walked out" inside it, F152). A village member sealed in a real mine: `runs/2026-10-06/f131_village.py`. On the test world:
  `MCAI_API=http://127.0.0.1:8767/api MC_SERVER_DIR=mc/testserver` (its traps at -20,-35 dig deeper each run, F149).
- **Walk stalls** (2026-10-05): every stalled walk logs a `[stuck]` line in the agent log (the walk's physics ticks,
  the server's set-backs, the feet, the pathfinder's events, the goal and whether the path is empty, F151; F145's
  reading guide in PLAN.md); `[repath]` logs a walk searched again after idling on an empty path; 20+ set-backs add
  `[stuck-world]` (the blocks the server has differently); `[dig]` logs a dig the server did not count. Count them in
  every run. `runs/2026-10-05/f138/pit_repro.py` is the pit reproduction (now no stall: a check that F147 holds);
  `runs/2026-10-05/s16/jdis.py Class.class [method]` disassembles a class from the Paper jar (no JDK here).
- **Test the village economy in stages before model-driven runs** (the user asked for faster tests; almost every bug
  of the economy work was in code, not in model behaviour): `python scripts/stage_village.py VILLAGE X Z [--stage
  full|build] [--buildings testhut,testhut,testhall] [--brain tasks|tiered]` lays a village out through the API and
  runs **scripted workers** (brain `tasks`, `taskBrain.ts`: they run the skill calls each task spells out, no model).
  `--stage build` places and stocks the storage chest first, so only building from storage is tested (~1 min;
  in a new village with the huts ~3-4 min: a worker prepares the plot, the chests go into the storage hut's spots by
  material group, the mining hut and its stairs are built and dug, and a mixed deposit is checked for sorting at the
  end, `--no-deposit-check` skips it); `--stage full` runs storage, gathering and building (~14-21 min with the huts). It stops when every building is done,
  when an agent fails the same way 3 times, or after 3 minutes without progress. Then run the model-driven village.
- **After completion** (chores: farm slots, harvests, exploring, the iron age; 2026-10-08): `stage_village.py ... --mayor
  --after MINUTES` keeps watching after the village is complete (only a tiered mayor sets it complete); `--fixtures`
  plants sugar cane, pumpkins and a melon 35-45 blocks off the site first (minevale3 has none within 96), `--ripen` sets
  each newly planted slot ripe, `--stock raw_iron:3` gives a worker items to deposit (the iron tools without the digging);
  `watch_village.py` takes `MCAI_AFTER=MINUTES`. Iron trips dig on the wall clock: an iron age takes ~20 min after
  completion even at 2x. Offline: `runs/2026-10-08/s22/iron_start_check.mts [villages.json]` (where the iron stairs would
  start in every recorded mine), `ores_along.py X1 Y1 Z1 X2 Y2 Z2` (ores in the snapshot).
- `scripts/bench/mayorbench.mts [model] [times]` replays the mayor's real prompts in the situations that went wrong
  (seconds per case): run it after changing the mayor's prompt or tools.
- While iterating, the workers' planner is gpt-oss:120b-cloud (~3 s a plan instead of qwen3.8's ~20 s; agreed with the
  user); the final runs use qwen3.8:27b. In village runs the workers' planner is no longer called at all (`plan 0x0ms`:
  code-posted tasks run as written, the executor handles failures), so planner choice does not show in them.

## State of the work

Branch `tiered-brain-building`, pushed to origin, not merged (`main` is unchanged):
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
13. `bedee15` handover notes and model benchmark scripts (`scripts/bench/`)
14. `58f0d2d` peaceful world settings; `a597469` bills of materials; `11a691b` village storage; `2073569` survival
    building charged to the inventory (village economy steps 1-4)
15. `4803a57` plan_layout, material tasks, self-crafting builds; `65c3e9e` staged tests and scripted workers;
    `ffcf9bd` movement, pickaxe, step-matching fixes; `8f2a8b9` workers run code-posted tasks as written, wood per
    part; `37d8a74` builds top up from storage, doors, buildings protected from gathering; `4fda71e` water, re-opened
    failed builds, verified completion (village economy steps 5-6, done)
16. `114ef12`, `11eea1f` docs: README (how the agents work, in detail) and ARCHITECTURE.md; all pushed to origin
    (`tiered-brain-building` only; `main` untouched)
17. `0c6c2aa` session lessons; `19b9b47` reliability (one wood kind, fast-failing collect, stuck rescue, quiet
    mayor); `b7908db` fixes from the 4-worker runs, panel simple mode, LAN access, `docs/PLAN.md`; `83bfe05` plan
    handover. Not pushed (ask first). From here on, progress is tracked in `docs/PLAN.md`.

18. 2026-09-28/29 (phase 1 steps 1.2-1.5, all pushed to origin `tiered-brain-building`, `main` untouched): a site
    that fits (`3b5627e`), mayor start and small items (`64786af`), then fixes from 18 acceptance runs
    (`ad7edda`..`212a190`, see PLAN.md F24-F52). Acceptance passed: Accept9-11 (gpt-oss workers' planner) and
    Accept15, 18 (qwen3.8).
19. 2026-09-29 (fourth session; pushed with the fifth's): README and ARCHITECTURE.md brought up to date
    (`d63d314`, step 1.6, phase 1 closed); the shared atlas (`7cc1f9d`, step 2.1: `mcAtlas.ts`, `/api/atlas`, the
    panel's village map); whole-tree felling and every village's buildings kept off (`9494d3d`, step 2.2), jump room
    for the climb and the Fell1 run (`bd68f12`); phase 2A (village infrastructure, the user's requirements) planned
    in PLAN.md with V.1/V.2 designed.
20. 2026-09-29 (fifth session): storage hut and sorted storage (`d77313d`, V.1 + V.2:
    `huts.ts`, sorted `deposit`, chests crafted per material group); village ground protected from digging, collect
    steps off a plot for buried stone, plan-bound step credit (`d4aa32d`); the panel's world map of the whole atlas and
    Hutvale2 (4/4 built with the hut in 18.8 min, `b54cc99`); then V.2b workstations in the hut and doors passable
    (`5710a15`), V.3 materials still to gather (`3a53548`), V.4 side pickups (`dafe26f`), V.5 the village mine
    (`832a3be`), compact worker prompts (F78) and Hutvale4 (5/5 in 19.2 min); all pushed to origin
    (`tiered-brain-building`, 2026-09-29), and the tracker brought up to date on 2026-10-01.
21. 2026-10-01 (sixth session; pushed at the seventh's close): V.5b, a mine that goes on (`813703a`, `9ad3a42`: turned
    tunnels, levels down, stone only, one miner a tunnel, no-dig walks; F79-F82); V.6, exposed ores in the atlas
    (`d34ed76`, with README and ARCHITECTURE.md); spawns on the ground and pickaxes from storage (`abfd90c`, F84, F85).
    V.7: Minevale3 and Minevale4 passed in a row (14.4 and 12.2 min, 0 failed actions); Minevale5 lost to find_site
    (F88). Next (decided at the close): phase T, faster tests (PLAN.md), then F88 and one more V.7 pass.
22. 2026-10-01 (seventh session; pushed with the sixth's at the close, `main` untouched): phase T, faster tests: `MC_TIME_SCALE` (`2a782fd`, T.1), the
    fixed test world `mc/testserver` with `reset_site.py` (`ae77c36`, T.2), `site.py` and the F88/F83 fixes
    (`b8c1e6b`, T.3), parallel staged runs and docs (`58d68bb`, T.4); Ollama's Vulkan default fixed (F89). V.7 passed:
    Minevale6 5/5 in 12.3 min, 0 failed actions, on the test world at 1x. Next: the open items in PLAN.md.
23. 2026-10-02 (eighth session; not pushed at the close, ask first): the small fixes (`797297b`: find_site's wood count
    by each column's ground (F98), kelp as water, prepare_site pits (F95), the "shelf" test site; `f390386`: fallen
    trees gathered (F94), no block set inside a player (F99)) and step 2.3, sites from the atlas (`1bf19a1`,
    `mcSiteAtlas.ts`). Minevale7 (model-driven, 1x, test world): 5/5 in 11.6 min, 0 failed actions. Next (the user's
    choice at the close): batch R in PLAN.md (F96, F97, F95's plot check, F100 jungle), then 2.4; phase 3 deferred.
24. 2026-10-02 (ninth session; not pushed at the close, ask first): batch R, each step tested and diff-reviewed: R.1 no
    futile sand gathering (`8ebfc33`, F96), R.2 builds not held by gather tasks storage covers (`e2d619b`, F97), R.3 the
    plot checked after prepare_site (`9bde50f`), R.4 small trees before giant jungle trees (`aefad6e`, F100); step 2.4,
    scouting, and spawns off water (`fd0bf3c`, F105). Minevale8 (1x, model-driven): 5/5 in 15.9 min, 0 failed actions
    (slower than Minevale7 only by the mayor's cobblestone-heavy designs). Open: F106 (search stalls of 3-10 s on sand
    and stone land), F107 (a pickaxe remake that collects logs far from storage), phase D (written into PLAN.md by a
    conversation beside the session; its place relative to the rest is the user's call).
25. 2026-10-03/04 (tenth session; all pushed to origin `tiered-brain-building`, `main` untouched): the ninth session's
    and the eighth's commits pushed; F106 fixed (`611faf9`: `nearestBlocks` reads state ids itself, desert searches
    2.4 s -> 3 ms, Hills3/Shelf7/Drop7 staged with no `[lag]`; lesson 53); phase D step D.1 (`2b4afa3`: stair roofs,
    the architect's block list per world, block states checked and turned with `rotate`, the rain test and solid-roof
    check, a cost budget instead of 9x9, `designbench.mts`, `rotate_design.py`; lesson 54); `5d20e44` run record and
    handover. Minevale10/11 (1x, model-driven): 5/5 in 14.6 and 17.0 min, 0 failed actions, every roof a stair gable.
    Next (the user's choice of order): D.2, the building generator (PLAN.md).
26. 2026-10-04 (eleventh session; not pushed at the close, ask first; `main` untouched): phase D steps D.2 and D.3.
    D.2, the building generator (`399f6a2`, `017deae`, `61595c0`: `buildingGen.ts`, `submit_style`, doors by the
    building's edge, packing by walls with eaves over the street, budgets 150/300, walls capped 9/11, `fitSmelts`;
    `render_design.py`, `gen_designs.mts`, rotate_design.py for any design or style): every roof at four rotations, staged
    GenB1-4/GenF1 5/5, designbench 20/20 by style; Minevale15 (1x, model-driven) 5/5 in 16.1 min, 0 failed designs and
    actions. D.3 (`e8f019f`: `lintDesign`, one revision round, `shrinkStyle`, the panel's elevations, `[design]` log):
    designbench 30/30 by style; Minevale16 19.2 min, Minevale17-18 stopped (F120, F121). Lessons 55-59. Next (agreed at
    the close): vanilla village pieces and plans from the Minecraft jar (PLAN.md "Vanilla villages", V2.1-V2.5).
27. 2026-10-04 (twelfth session; all pushed to origin `tiered-brain-building` at the close, `main` untouched): vanilla
    villages V2.1-V2.3. V2.1/V2.2 (`4e44df9`: `vanillaPieces.ts`, `vanilla_pieces.mts`, `contact_sheet.py`,
    `stage_village.py --design-file`; stripped logs charged as logs): 62 of 152 house pieces pass the survival checks,
    five built at four turns with 0 mismatches, staged VanB1 5/5. V2.3 (`5805c5c` the street plan: `streetPlan.ts`,
    `street_plan.mts`, plan_layout's street branch, streets laid free by prepare_site; `d14fa53` the mayor's library
    filled by the site's biome, F131/F132 fixes; `9182b77`): staged VanS1-4 and VanF1 (9.7 min full at 2x), Minevale19
    stopped (F131: a sealed mine), Minevale20 (1x, model-driven) 6/6 in 18.0 min, 0 failed actions, no design drawn.
    Lessons 60-65. Next (the user's choice): V2.3m, the mayor gathers while it waits (PLAN.md).
28. 2026-10-04 (thirteenth session; all pushed to origin `tiered-brain-building` at the close, `main` untouched): V2.3m,
    the mayor gathers while it waits (`b716f33`: a TaskBrain beside its empty plan runs soft gather tasks as written;
    `stage_village.py --mayor [--planner none]`): VanM2 8.0 min staged (10.9 without), Minevale21 15.0 min at 1x on
    Minevale20's site (18.0). V2.4, the green village (`723a24d`: `layoutGreen`/`planGreen`, a ring street round the
    town centre's green on 40 sites, the street plan up to 40 otherwise, find_site size=40, prepare_site 40x40) and
    collect's lake and pit fixes (`bb48ec0`, F136-F138): staged VanG1/2/5 8.1-8.4 min at 2x, Minevale22 (1x) 6/6 in
    15.2 min, 0 failed actions. Lessons 66-71. `stage_village.py --site-at=X,Y,Z,SIZE[,WOOD]` needs the `=` for a
    negative X and the X Z arguments as well. Next: V2.5 (vanilla data) or the backlog (PLAN.md).
29. 2026-10-05 (fourteenth session; all pushed to origin `tiered-brain-building` at the close, `main` untouched): V2.5, vanilla data
    instead of hand lists: `vanillaData.ts` (`d2fda9a`, `05d9dbb`: the jar reader shared with vanillaPieces.ts, tags
    resolved recursively, `vanillaJar()`), the renderer's colours from the client jar (`41d733c`), SMELT from the jar's
    smelting recipes (`cda19c8`), the adapter's block and item lists from tags in `mcBlocks.ts` with the hand regexes
    as an all-or-nothing fallback (`34e205b`); loot tables left on minecraft-data (they agree). Staged VanG6 and VanM3
    8.3 min at 2x, Minevale23 (1x) 6/6 in 14.9 min on Minevale22's site, 0 failed actions. Lessons 72-76. Next (the
    user's choice): the backlog, F138's leftovers first (PLAN.md).
30. 2026-10-05 (fifteenth session; no code, nothing to push): F138's leftovers started. The pit reproduced live
    (`runs/2026-10-05/f138/pit_repro.py`: 10.2 s per stalled walk, 52 s per stalled deposit, the rescue after ~105 s);
    a design review held item 4 back (the stall's first move is a cardinal jump-up, not a diagonal) and widened item 1
    (F143-F146). Next: item 3, the `[stuck]` line (PLAN.md).
31. 2026-10-05 (sixteenth session; all pushed to origin `tiered-brain-building` at the close, `main` untouched): F138's leftovers and F147.
    `07306d5` the fifteenth session's record; `32f3eff` item 3, the `[stuck]` line and a horizontal walk watchdog;
    `5861632` item 1, storage fails at once on an unmoved stall (nearest side spot within 6 blocks), the rescue walks
    away from the stalled goal first; `cff6dbc` F147, half width 1229/4096 and `[stuck-world]`; `8c73e20` every dig
    checked with the server. Items 4 and 2 dropped (the stall was the server refusing moves). The pit reproduction: a
    move arrives in 2.0 s and a deposit in 3.1 s (52.3 s and the rescue after ~105 s before). Staged VanG7-9 and
    VanM4-5 8.0-8.5 min at 2x, Minevale24 and 25 (1x) 6/6 in 15.1 and 15.0 min, all 0 failed actions. Lessons 78-81.
    Next (the user's choice): the small backlog, F148, F150 and F131's leftovers (PLAN.md).
32. 2026-10-06 (seventeenth session; see PLAN.md for push state): the small backlog. `bd174c1` F148, explained as the
    pathfinder's partial paths corrupting its own search (F151): a patch-package patch copies A* nodes into paths,
    walkOnce re-searches an idle empty path (`[repath]`), the `[stuck]` line names the goal; `51f10a2` F131's rescue: "out"
    means a path home exists (or open sky in no village), a sealed-in village member is teleported home at once, no climb
    on village ground, `test_rescue.py tunnel`. F150 not reproduced (waits for a model run). Staged VanG10-13, VanP1,
    VanM6-7 6/6 in 7.7-8.6 min at 2x, 0 failed; Minevale26 (1x) 6/6 in 18.8 min, 0 failed actions, ~3 min lost to the
    mayor's late layout (F155). Lessons 82-84. Next: the user's choice (F155, backlog, lamp posts or phase 3).
33. 2026-10-06 (eighteenth session; see PLAN.md for push state): F155 and street lamps. `52f5b19` F155 (wait-only mayor
    plans count as empty, the nudge names the vanilla library, find_site's reason ends "call plan_layout now", the mayor's
    executor waits for a pending replan; mayorbench F155 cases: 2/12 -> 12/12 plan_layout); Minevale27/28 (1x) 6/6 in
    14.2/14.4 min, laid out at 0.2/0.1 min, 0 failed actions. `980a5cd` street lamps (`placeLamps`, `light_streets`, the
    soft "Light the streets" task after every build; the user's choices: fence + torch, charged, ~8 apart, completion
    waits); staged VanL1 8.6 min at 2x, Minevale29 (1x) 6/6 + 6 lamps in 15.2 min; `246c962` F156 (charcoal from spare
    logs), not run again (the user's choice). The user's village-life list (signs, farming, lighting inside buildings
    and mines, ...) is in PLAN.md's backlog. Lessons 85-88. Next: one model run for F156, then signs.
34. 2026-10-08 (nineteenth session; see PLAN.md for push state): name signs. `cfe8b8c`: a waxed wall sign beside each
    building's entrance door naming its use ("House", "Library", "Storage", "Mine"; other designs their own name;
    `placeSigns`/`signLabel` in streetPlan.ts, the soft "Put up the signs" task after every build and the lamps on every
    layout kind, `put_up_signs` charged at the storage hut and checked with `data get`; the user's choices, all as
    recommended). Staged VanS1/VanS2 8.6 min at 2x; Minevale30 (1x) 6/6 + 6 lamps + 5 signs in 15.4 min, 0 failed
    actions, F156's fix confirmed. Lesson 89. Next: farming (the village-life list's order).
35. 2026-10-08 (twentieth session; see PLAN.md for push state): farming v1. `24e7037`: a 5x7 wheat field (water channel
    down the middle) placed by `placeFarm` beside the storage hut, two soft seed tasks after the storage and "Plant the
    farm: 16 wheat" (`tend_farm`: water and farmland free, a hoe, 16 wheat in alternate rows charged as seeds, checked on
    the server) after the hut's build; walks banned from every field; seeds from grass only and not junk (the user's
    choices, all as recommended). `e28198e`: seeds in posting order, no hoe-log task (F163). Staged VanF3-5 8.9-9.2 min
    at 2x, Minevale31 (1x) 6/6 + lamps + signs + farm in 16.5 min, 0 failed actions. Crops grow with time frozen, only
    near agents. Lessons 90-92. Next (the user's order): harvest and bread, the opportunities analysis, opportunistic
    farming and exploring, the iron age.
36. 2026-10-08 (twenty-first session; not pushed at the close, ask first; `main` untouched): harvest and bread and the
    opportunities analysis. `f17f360` farming v2 (`harvest_farm`, a chore code queues on an idle worker at 3/4 ripe,
    `loot give` per cell, resown charged a seed, bread at the hut's table; never counted for completion;
    `stage_village.py --harvest`); the analysis (`runs/2026-10-08/s21/opportunities/`: Minevale26-31 with a schedule
    simulation, 15 staged runs, the code side) and five of its opportunities (the user's picks): `33b70f6` the preparer
    sets up the storage with its felled logs, `5f3e133` F164 whole buildings (`v.woodFor`), `8724395` the hut's stations
    shared, `0ec7e0a` hand-gathered items while the plot is prepared and lamps once every build is claimed. Staged green
    plains 8.9 -> 6.1 min at 2x (VanO4, harvest PASS), Minevale31's site with a wood kind 9.6 -> 7.2. No model-driven
    run (the user's choice): Minevale32 first next session. Lessons 93-97.
37. 2026-10-08 (twenty-second session; not pushed at the close, ask first; `main` untouched; the user asked for no
    questions this session, so every choice was the recommended one, recorded in PLAN.md's decisions): Minevale32 (1x,
    model-driven) 6/6 in **11.2 min** (Minevale31 16.5; the simulation predicted 11-12), 0 failed actions. `0da949d`
    opportunistic farming and exploring v1 (sightings in the atlas: plants per chunk, animals by uuid; two kind-free farm
    slots a layout; after completion, chores start cane, pumpkin, melon or crop farms from sightings within 160 blocks,
    harvest them, and explore 8 ring points; staged VanX2-4 and VanI1-7 started farms from fixtures and from wild cane and
    pumpkins 115-140 blocks out). The iron age v1 (`mine.iron`: its own stairs from the deepest level to y 18, retried past
    minevale3's caves, tunnels keeping iron and coal from walls, floors and veins; an iron pickaxe, then a bucket, from the
    village's iron; VanI7 6 raw iron from 144 cells, both tools made), F178, F179, F165/F169 (the spare wood kind passed to
    the craft and smelt skills; VanW7/VanW8: signs and lamps in one pass) and F184-F186. The village beautifying plan is
    in PLAN.md's backlog (the user's request). Lessons 98-103.
38. 2026-10-09 (twenty-third session; pushed at the close, the user's instruction; `main` untouched): Minevale33 (1x,
    model-driven, `MCAI_AFTER=30`) 6/6 in **10.6 min**, 0 failed actions to completion; its after phase ran a pumpkin farm,
    the iron age (iron pickaxe and bucket at +22.9) and a scout, then the agent server crashed (F188). `91d1399` fixes
    F188-F192 (walk bans skip the pathfinder's unloaded-chunk stub; scouts and failed farm starts teleport home; pickaxes by
    uses; planks before stations; cane counted by takeable blocks). `ecb7cf7` the annex and chicken pens v1 (the user's
    choices: pens on a 13x9 annex prepared beside the plot after completion; one lure trip of up to 4; eggs and breeding
    later): `prepare_annex` and `start_pen` chores, fence gates as walls to walks, lure tests 1-3 with Gus. `5d156ca` F198
    ("any planks" from one kind) and F199. Minevale34 (1x) 6/6 in 10.6 min, 2 wild chickens penned with real models;
    staged VanA3/A5/A6 penned chickens led 25-80 blocks. Lessons 104-108.

Backlog and open problems: `docs/PLAN.md` (phases, backlog and findings log). The items listed here before
(re-posting mayor, logs short, slow-failing collect) were fixed on 2026-09-28.

## The peaceful village economy (agreed 2026-09-27; done 2026-09-28)

The user changed the base assumptions: **no survival with hostile mobs or damage at all**. Agents gather and craft
the materials a village needs, then build with them. Decisions made with the user:
- **Minecraft only.** The sandbox stays as it is (a quick test bed for the brain); no peaceful mode is added there.
- **Survival mode, made safe:** peaceful difficulty (no hostile mobs; hunger does not drain), and game rules for no
  fall, drowning, fire or freeze damage and keep-inventory. Done: `mcRules.ts` applies them over RCON at every
  agent-server start and reads each back (log line "World settings: ...", `/api/status` `worldRules`, the panel
  header). 26.1 names game rules in snake_case (`fall_damage`, `keep_inventory`, `spawn_monsters`,
  `fire_spread_radius_around_player`; camelCase is rejected), and a bare `gamerule` lists nothing over RCON: the full
  list is in the jar (`net/minecraft/world/level/gamerules/GameRules.class`). `time query daytime` no longer exists
  (timelines). `mc/server/server.properties` still says `difficulty=easy` (checked 2026-10-01; an earlier note said
  peaceful): peaceful comes from the agent server's RCON at every start, so a Paper running without it is on easy.
  `mc/testserver`'s says peaceful.
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
4. Done (tested with Gus and a 5x5 "shed" design in Depot, sheds at -10,-24, 29,-26 and 58,-20). Survival agents pay
   for every block (`runJob`, `charged()`): at the site the builder counts what is still missing (server-side counts,
   `clear <name> <item> 0`), withdraws it from storage, and fails before placing anything with "short of materials for
   the shed: 35 acacia_planks (carrying 1, storage has 0). To get them: withdraw ...; gather 9 acacia_log; craft ...".
   Each run of blocks is then charged with `clear <name> <item> <n>` (refunded if not placed); running out stops the
   job ("ran out of X after placing N blocks; still needed: ...") and the same build later continues at the
   remembered level (`memory.pendingBuilds`; its own walls would fail the site checks). Wood kinds are swapped for the
   kind the builder can supply (`chooseWood`: oak designs built in acacia). The dirt walkway in front of doors is
   optional. prepare_site stays free (landscaping) and gives the preparer the logs of the trees it fells.
   `memory.buildMode: "commands"` builds free in survival. Creative is unchanged.
5. Done. `plan_layout` (a mayor planner tool; `layout.ts`, also `POST /api/village/:v/layout`) packs the named
   buildings onto one plot with 3-block streets (`layoutBuildings`), refuses undrawn designs, designs needing
   unobtainable or hard-to-find materials (iron, wool...) and a find_site result smaller than the plot, and posts in
   order: prepare the plot, set up the storage (collect 4 logs, craft a chest, deposit at a spot beside the plot; the
   first chest finishes it), gather tasks per building (`WorldAdapter.materialTasks`, `gatherTasks`: even chunks of
   <= 12 logs or 32 of anything, collect then deposit all, "soft" so a failed one does not block the build), and each
   build at computed coordinates. Builders craft and smelt from storage themselves (`makeFromStock`: planks, doors,
   slabs, glass, the table and furnace), re-read the chests when the record looks short, and a build short of raw
   materials posts gather tasks for exactly that and goes back on the board (`requeueBuild`). The mayor's flow:
   find_site + design_building steps, then plan_layout, then wait. Code guards: hand-written building tasks before
   a layout are laid out in code; duplicates of the layout's tasks and plan steps that are workers' jobs are dropped;
   a refused plan_layout replans at once; no timed review while workers hold tasks.
6. Passed. Riverbend6: one cottage from nothing in 9.3 min (1 failed action). Meadowford2: "two matching cottages
   and a meeting hall" in 35.0 min, declared complete, 6 failed actions (3 were self-healed material shortfalls);
   mayor gpt-oss:120b-cloud (planner and architect), workers' planner qwen3.8:27b (never called: code-posted tasks
   carry their own steps), executors qwen3:30b-instruct. Staged runs (two testhuts and a testhall from stocked
   storage) then found more: see the lessons below. Meadowford5 (all fixes): both cottages in ~21 min, the hall build
   failed on a crafting shortfall; resumed with fresh agents, the mayor's re-post re-opened the failed layout task and
   the hall was built from storage in 4.3 min; completion is now checked in code. Failed confirming runs on the way:
   a worker stuck in a lake (water avoidance and swim-out added), a mayor that declared a village complete with nothing
   built (refused now), a site-size loop (the site must be as big as the plot, no margin).

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
- Every village member stays within 96 blocks of the village (move_to and explore are refused or shortened beyond;
  collect walks back first). find_site searches up to 112 blocks and walks up to two 40-block legs; in survival a
  site needs 30 log blocks within 48 (only wood within 16 of the ground counts). plan_layout refuses designs whose
  materials are not near the site in the amounts needed (as collect can reach them; wood may be 25% short).
  Survival designs have a cost budget (phase D, 2026-10-04: a house 250 gather units, one landmark a village 400) and
  use only raw materials that are easy to gather; the architect's block list includes stairs, slabs, fences,
  trapdoors and walls (`designBlockList` in mcMaterials.ts).
- **Log roofs make villages slow** (a 9x9 hall with an oak log roof needs 81 logs; Accept16 and 18 took 38-39 min).
  The commonest failure left is collect not reaching logs high on hills (9-23 failed collects per run in hilly or
  jungle-edged woods).
- Where village tests went well: around -160,-100 (savanna with trees and sand: Riverbend6, Meadowford2 and 5), but
  that area is now full of test villages (the staged land search found nothing free there on 2026-09-28); the oak and
  birch woods around -360..-430, -80..-105 (StageW2-W4); -428,-200 (Fourfold5, all built in 21.6 min).
  Poor: 120,-160 (desert, no trees), 20..60,-120 (few trees), -200,-140 (a lake at -235,-53 trapped a worker),
  -560,-60 (jungle hills: logs out of reach, sand under water), 4..60,-232..-194 (few trees), -494,-336 (hills at
  y 95, no sand within 96), -195,-97 (only 18x18 of level land). Test villages of 2026-09-28: StageW1-W4, Fourfold1-7
  (all in `mc/server/villages.json`); start new ones away from them. Run logs are kept in `runs/<date>/` (gitignored).
- Acceptance runs of 2026-09-28/29 (Accept1-18, Tightfit1; also test villages LayoutTest*, MatTest*, DesertTest):
  good: -349,-114 and -405,5 (oak woods, Accept1 and 9), -367,-2 (Accept2), -462,-183 (Accept10), -111,50 (acacia,
  Accept11), -590,-209 (Accept15), -416,49 (Accept18). Poor: -35,324 (desert, only buried wood), -262,125 (1 log
  near), -51,-315 (little sandstone), -519,-382 (hills at y 101, no sand), -330,150 (the probe point is a hollow; the
  site found is at -382,105). find_site keeps off every village's ground now, so reusing an area only shares its
  trees.
- 2026-09-29 test villages: AtlasTest (atlas checks, no buildings), StageT1-T5 (staged felling runs), Fell1
  (model-driven, -664,-169: jungle-edged woods, good, but no sand within 96 blocks, so windows stay open). Poor for
  glass: -769,-384 (hills at y 111, no sand: StageT3) and the oak woods at -443,-22 / -447,-60 (4 sand in a watery
  hollow 80 blocks off: StageT4/T5). Trees were felled around -560..-700, -90..-290 and -360..-440, 20..70 by the
  felling checks. Accept15's log frames were cut by the first felling checks and restored by command (F55).

## Real Minecraft

The same brains run in real Minecraft Java Edition through Mineflayer. Decisions (agreed with the user): Minecraft
**26.1** (Paper 26.1.2; protocol 775, the newest Mineflayer supports; Paper warns it is behind 26.2, which is expected),
**Paper**, adapter code in `server/src/mineflayer/`, and building in two modes behind an option (operator commands in
creative, block-by-block placement in survival; not built yet).

- `mc/`: `setup.py` (portable Temurin 25 in `mc/runtime`, the Paper jar and `server.properties` in `mc/server`, both
  gitignored; checksums verified), `start.py` (runs the server), `rcon.py` (send commands, e.g. `python mc/rcon.py
  "list"`). The server listens on 127.0.0.1 only, offline mode, RCON on localhost, seed 1793578865, survival, peaceful.
  The user accepted the EULA on 2026-09-26. Stop the server with `python mc/rcon.py stop` (saves the world); killing
  it loses unsaved chunks (Paper autosaves every 6000 ticks, `bukkit.yml` `autosave`: 5 minutes at 1x, so a kill loses
  at most the last few minutes). 26.x keeps no spawn chunks loaded: RCON block tests need `forceload` or a player nearby.
  The world is under `world/dimensions/minecraft/overworld/{region,entities,poi}` in 26.1 (not `world/region`).
- `npm run mc:agents` (`server/src/mineflayer/index.ts`) connects agents as bots and serves the agent REST API on
  **port 8766**, with the sandbox's routes and JSON shapes, so the watch scripts can point at it. It needs the
  Minecraft server running. `tsx` here does not watch; stopping `npm` leaves the `tsx` child listening on 8766: stop
  it by PID (`Get-NetTCPConnection -LocalPort 8766`).
- `mcWorld.ts` (`MineflayerWorld`: WorldAdapter, spawn via bots + RCON gamemode/teleport, `reset` for a fresh start,
  villages in `mc/server/villages.json`), `botAgent.ts` (`BotAgent`: WorldAgent, skill queue, events, observation,
  self-defence reflex), `mcSkills.ts` (registry; skills as async functions with an AbortSignal, same names and
  arguments as the sandbox), `mcSurvival.ts` (survival skills), `mcBuild.ts` (building skills), `mcRules.ts` (peaceful world settings), `mcAtlas.ts` (the shared atlas: chunk summaries, `mc/server/atlas.json`, `/api/atlas`), `mcMaterials.ts` (bills of
  materials, recipe chains), `mcStorage.ts` (village storage, sorted in the storage hut), `mcMine.ts` (the village
  mine: `dig_mine`, tunnels for `collect cobblestone`), `mcUtil.ts` (walk
  with watchdog, helpers),
  `mcApi.ts`, `rcon.ts`.
- Skills: move_to, chat (refuses "/" commands), wait, look_at, mine, collect, place, craft, smelt, eat,
  attack, explore, follow, give, equip, drop, get_item, find_site, prepare_site, build_design, build_box, build, deposit,
  withdraw, dig_mine. Written on the pathfinder directly (collectblock and pvp were
  dropped: less control over failure messages and cancelling, and pvp pulls in mineflayer 2.x). Brains: idle,
  tiered, llm.
- `collect` resolves names in code: "logs" is any log, an item means the blocks that drop it (cobblestone -> stone),
  ores include deepslate variants; open blocks first, buried ones by digging to them. `craft` makes the table, then
  sticks, then planks (in that order: each uses planks), and prefers everyday recipe variants in messages.
- **Building** (`mcBuild.ts`) ports the sandbox's checks, messages and village records (reserve, plots, structures,
  "already stands here"), but in creative the work is done with `/setblock` and `/fill` over RCON (the server console,
  so bots need no op), paced by `buildSpeed` (x10 blocks/s), vertical runs merged into one `/fill`, while the bot
  stands south of the site and looks at the blocks. Doors are set as both halves with the outward facing; whole trees
  touching a plot are felled. In survival the same commands run but every block is charged to the builder's
  inventory (village economy step 4). `isPlaceable` accepts block states (`[facing=east]`).
- **Reflex** (`BotAgent.selfDefence`): a hostile mob that just hurt the bot is fought (with a sword or axe) or fled
  from (unarmed, low health, creepers); the interrupted action resumes. An LLM turn is too slow for a zombie.

Left after the twenty-third session (2026-10-09): see PLAN.md's "Next session starts with" for what was left running (the
stack is normally stopped cleanly at the close; start it as above); no agents in either world. In the main world, test
buildings, storage chests and mines stand near spawn and at the test villages (Depot, Stage*,
Sunhollow*, Riverbend*, Meadowford*, Fourfold*, Accept*, Tightfit1, Fell1, StageH1-H20, Hutvale1-4, StageM1-M8,
Minevale1-5, StageS1, Par1, Atlas1, Atlas4, Jungle1-2 (-527,-627 and -747,-576); all in `mc/server/villages.json`): build elsewhere (`scripts/checks/fresh_land.py`), clear
them, or test on the test world (`mc/testserver`, restored per site; VanA6's street village (6 of 6, lamps, signs, a wheat field, cane and pumpkin farms, an annex at -1659..-1651, 40..52 with a penned chicken) stands on Minevale31's site at -1648..-1609, 27..66 until the next reset (inside minevale3's restore radius); the atlas there now knows the land to ~160 blocks round VanG's site from the exploring trips, and the
scouting tests left Scout4 at -19,-88 and Scout5 at -378,-804 there, outside every recorded site). The atlas
(`mc/server/atlas.json`) holds ~6,700 chunks, with exposed ores, shown on the panel's world map. The user confirmed the panel's simple
mode reads well (2026-09-29).

Lessons from the adapter:
1. **Mineflayer bots got stuck against walls on 26.1**: its physics uses a player half-width of exactly 0.3 while the
   server uses 0.6f / 2, so a bot pressed into a wall overlaps it by ~1e-8 in the server's eyes and every move is
   rejected (the server teleports it back each tick, silently). `botAgent.ts` sets `playerHalfWidth` to 1229/4096
   (0.3001 until 2026-10-05: not a binary fraction, it left the box 4e-16 inside walls at faces ±4, ±128, ±1024, F147).
   Worth reporting upstream (ask the user first).
2. Wait for chunks (`waitForChunksToLoad`) after spawning and after teleports, or the first skills see unloaded
   (null) blocks.
3. Pin `vec3` to Mineflayer's 0.1.x, or its types clash with the pathfinder's.
4. **Crafting is done by server command**, charged exactly (`doCraft`: count and `/clear` the ingredients, `/give` the
   result; a table recipe still needs a table placed nearby). Mineflayer's window clicking on 26.1 worked from a stale
   inventory view: it put crafted planks back into the grid and made an oak_button of them, or crafted nothing, in 4
   of 5 chest crafts. Its inventory view also drifts after chest transfers: `syncInventory` (Mineflayer's
   `_syncWindow`, an impossible state id) gets the full inventory back; anything that must be right counts on the
   server (`clear <name> <item> 0`).
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
13. **Mineflayer's inventory view can drift after chest withdrawals**: once it showed 4 cobblestone where the server
   had 25 (not reproducible in plain withdrawals; it happened in a withdraw-then-walk build flow). Anything that must
   be right (building's material check) counts on the server with `clear <name> <item> 0`.
14. `treeAt` (whole-tree felling) returned the logs only: the log search marked the leaves around each log as seen, so
   the leaf search found none, canopies outside a plot stayed floating and each leaf column counted as another tree.
   Fixed with separate seen-sets. `runJob`'s pacing slept once per command however far over budget, so buildSpeed
   below ~10 had no effect; it now waits until the budget is positive.
15. **Village gathering lessons** (staged and model-driven runs): a worker holding a code-posted task runs the task's
   own skill calls (the planner turned build_design into its own furnace recipe); a plan step counts as done only when
   the action's item matches (action_done carries args); gathering stays within 96 blocks of the village and never
   mines inside a village building (a gatherer mined the hall's cobblestone floor; cobblestone now comes from stone);
   collect weighs candidates by effort (exposed stone deep in caves had no path); walks over 64 blocks go in legs;
   builders step out of the footprint first (one walled itself in); the pathfinder's `canOpenDoors` opens fence
   gates only, doors were solid to it until `moves()` taught it (F69, 2026-09-29); wood kinds are chosen per part; crafting planks eats any carried logs, so builders top up from
   storage before requeueing; windows stay open when there is no sand for glass; paths avoid water (`liquidCost`) and
   a walk stuck in water swims out; `declare_complete` is refused while a layout build is not done; a mayor re-posting
   a failed building re-opens the layout task; the watch scripts write UTF-8 (a chat message with U+2011 crashed one).
16. **Several bots share one Node event loop.** The pathfinder searches up to `tickTimeout` ms per bot per tick (40 by
   default) and `findBlocks` with a large count scans synchronously: with four bots the API stopped answering and the
   watcher died. `moves()` sets `tickTimeout` 15 and `thinkTimeout` 15 s; filter inside the search
   (`nearestBlocks(..., keep)`, `useExtraInfo`) rather than asking for thousands and filtering after. Set pathfinder
   options in `moves()`: the plugin is not attached yet when `loadPlugin` returns (setting it there broke every spawn).
17. **The pathfinder's `goto` can resolve without arriving** (boxed in by built walls: `move_to` said "arrived" where
   the bot stood, so a trapped bot was never rescued); `walkOnce` checks `goal.isEnd`. And `pathfinder.stop()` lets a
   dig in progress finish: `bot.dig` right after a walk collided with it ("Digging aborted"); clear the goal and wait
   for `!isMining()` first.
18. **Executors change code-posted calls.** qwen3:30b withdrew logs from storage and deposited them again (counted as
   gathering) and collected 6 of 29; code now runs such steps as written and asks the model only after a failure.
   Rule of thumb: whatever code can spell out exactly, code should run.
19. 26.1 details: the daylight game rule is `advance_time` (was `doDaylightCycle`); `time set day` works;
   `spreadplayers` lands on the jungle canopy (teleport onto a known block instead); the whitelist matches names in
   offline mode.
20. **Judge prompt changes on more than three samples**: `mayorbench` gave 3/3 and 0/3 for the same prompt and case.
   Prompt wording did not stop gpt-oss re-posting work; fewer wake-ups and code guards did.
21. **Checks must count what the skills can actually do** (2026-09-28): the material check first passed a village
   needing 247 sandstone on finding one block, then counted sandstone buried under sand that collect never digs for;
   wood 36 blocks down a mineshaft counted as trees near a desert site. Count near the surface, in the amounts
   needed, and as collect reaches blocks (anything close, only exposed blocks farther out).
22. **Range limits must cover every agent**: the 96-block guard covered only the mayor, and a worker's executor
   explored hop by hop to 180 blocks away, then gave up every gathering task it took ("none within 96 blocks of the
   village", judged from where it stood).
23. **A failure handler must check the failure is about the current task**: a queued sandstone collect left over from
   a given-up task failed again under each newly claimed log task and gave three of them up.
24. **Mineflayer's inventory view lags inside windows too**: smelting's fuel top-up offered the plank already burning;
   while a furnace or chest is open, read `window.items()` (the window's slots), not `bot.inventory`.
25. **Completion and other "nothing else will wake it" checks belong in the tick**, not after a particular model
   reply: all three buildings stood while the mayor, which had just tried to re-post work, was never woken again.
26. **Model steps that name a planner tool go to the executor**, which cannot call it and improvises (a "plan_layout"
   step made it run find_site and replace a 30x30 site with a 24x24). Drop such steps in code.
27. **Designs need limits in code, not prompts**: 11x11 and 13x13 buildings of mossy cobblestone (moss from lush caves
   at y=-4), furnaces and chests as decoration, sandstone roofs where there is no sandstone. Survival designs are
   capped (9x9 then; a cost budget since phase D), raw materials are whitelisted, workstations refused, and materials
   checked against the site.
28. **Where the watcher spawns matters**: it spawned villages at its probe point, 100 blocks from the site it found,
   and the mayor started stuck in a hollow; a timed-out walk that got nowhere was not counted as stuck either.
29. **On 26.1 a bot is often not sent the block update for its own placement** (2026-09-29): Mineflayer said "the
   block is still air" and its physics stood on nothing where the server had placed the dirt; a retry stacked a
   second block. Ask the server (`execute if block` over RCON) and write the block into the bot's view
   (`bot.world.setBlockStateId`); check what must be gone on the server too (felling's pillar check).
30. **Keep off every village's work, not only the agent's own** (2026-09-29): Gus, in no village, felled the jungle-log
   frames and roofs of Accept15's cottages and hall as trees (~101 logs, restored by command). Any skill that breaks
   blocks must exclude all villages' structures and plots, and treat logs without leaves as built.
31. **The pathfinder digs whatever is natural on its way** (2026-09-29): a cobblestone gatherer dug a shaft from a
   prepared plot's surface to stone below it (F66). Every bot's movements now refuse to break blocks on any village's
   plots and margins (from 4 below the level up), beside its buildings and in its mine (`protectedGround` +
   `exclusionAreasBreak` in `moves()`); a skill's own planned digging uses `bot.dig` directly. Collect takes nothing
   in the columns under a plot, and steps off village ground to find buried stone beside it (F64).
32. **Local models have an 8k context and prompts grow quietly** (F78): the village summary reached ~2,200 tokens
   (41 tasks, per-chest storage, the needs and mine lines) and workers' executor prompts 8,391 tokens: every call
   failed. Workers get a compact summary now; check prompt size whenever something is added to the summary.
33. **A `/setblock` over a chest empties it, and stray blocks raise a floor** (F59): a gatherer's crafting table
   inside the future storage hut made its floor a block higher, and the floor layer would have been set on the
   chests. Tables and furnaces never go on village ground; builds refuse when a kept chest is not at their level.
34. **What counts as natural decides what prepare_site clears** (F61, F76): cocoa pods and bee nests were missing from
   `NATURAL`, so their columns were kept as "built" and a plot stayed uneven. When a plot is left uneven on fresh
   ground, look for a block missing from that list.
35. **A walk free to dig takes the shortest way through natural ground** (F80, 2026-10-01): protected boxes only make
   planned cells dearer, so the pathfinder cut its own corridor from the mining hut to the face. Walks in the mine run
   with `canDig` false (`walkMine`), and `mineBlock` must not be left to walk to a far cell (its walk digs): dig from a
   known approach or not at all.
36. **Two bots on one work plan race** (F82): both read the same next cell, and the second went for cells whose approach
   the first had not dug. Hold work per bot (the mine's `holders`), and give a second worker its own piece.
37. **Never spawn at a fixed height** (F84): `y 90` put a village's agents inside a hill at y 100; they suffocated (one
   damage the game rules do not turn off) and respawned 900 blocks away. Spawn on ground read from the world, or give no
   height (the server's surface spawn).
38. **"height range 0, 0 tree blocks" on wooded hills is a warning** (F88): find_site reported a flat, treeless site
   where the ground was 18 blocks higher with a ravine at its edge; prepare_site then refused it again and again.
39. **Check scripts that compare the world** (`scripts/checks/mine.py`, `atlas_ores.py`, `GET /api/blocks`) found
   every mine bug of 2026-10-01 that a run would have taken minutes to show; write one with a new skill that digs.
40. **Paper times digs by the wall clock** (F91, 2026-10-01): its lag-compensated tick is (nanoTime - start) / 50 ms,
   unconditional. A faster tick rate speeds walking, furnaces, pickups and leaf decay but not digging, and a dig
   finished early is refused while Mineflayer shows the block as air. Never shorten `digTime`.
41. **A scan window tied to the bot's height hides terrain** (F88/F93): find_site read every column from bot y + 32
   down, so a hill above that read as flat, treeless ground at exactly that height and was chosen as the best site.
   A survey must find each column's real top; `scripts/checks/site.py` compares find_site's report with the blocks.
   (find_site's wood count still has such a window: backlog.)
42. **Ollama turned Vulkan on by default** (F89, ~2026-09): the Vulkan backend ignores `CUDA_VISIBLE_DEVICES` and
   put the executor on the planner's card; `ollama_exec.py` starts the pinned servers with `OLLAMA_VULKAN=0`. If
   `status` warns again, look for `OLLAMA_VULKAN:true` or `library=Vulkan` in `%TEMP%\ollama_exec.log`.
43. **A fixed test world beats searching for land** (phase T): two staged runs on a restored site gave the same plot,
   mine and time; land luck had lost more runs than code. Test fixes on a restored site of `scripts/test_sites.json`.
44. **Commands place blocks into whatever stands there, players included** (F99, 2026-10-02): a preparer suffocated in
   its own prepare_site fill and respawned 540 blocks away. runJob now never sets a block inside a player (agents are
   moved to the stand spot); any new code that places by command must do the same.
45. **When merging targets per cell, a block must win over 'air'** (F95): a felled tree's cells came first as air and
   the fill under them was dropped as a duplicate, leaving pits in a plot reported ready. A test site built for one
   case (the shelf, for the mine) found it: new test land finds old bugs.
46. **A count from a window must match the rule the consumers use** (F98's review): find_site's wood count, freed from
   the bot's height, counted valley logs that collect (site level - 16) would never take. Check every new count
   against collect's and plan_layout's own filters.
47. **Leafless logs**: agents only build upright logs, so a lying row of one kind outside every village is a fallen
   tree (26.1 generates them) and is felled; one-log stumps and other leafless logs count as built and are passed over
   in the candidate search itself (no failure, no rescan). Lesson 30's protection comes from the village filter.
48. **The atlas ranks areas, the column scan chooses the square** (step 2.3): 4x4-block cell means are too coarse for a
   2-4 block slope; look around the bot first and walk to atlas candidates only when nothing good is near (a first
   version went to candidates first and could zigzag ~650 blocks).
49. **Filtering inside `findBlocks` builds a Block for every match** (F96, F106, 2026-10-02): a search that finds
   nothing still visits every section that holds the block, and on sand or stone land that is thousands of matches: a
   futile 128-block sand search took 2.4-2.7 s, a desert's material counts 5-10 s in one call. Search positions only
   and filter after when the block is common; `[search]` lines log every search over 200 ms.
50. **Check a job after it, by its consumer's rule** (R.3): RCON fills reach the bot as ordinary block updates (lesson 29
   is about a bot's own placements), so re-reading the targets is cheap; run what looks wrong once more (the command's
   answer is the server's check) and judge the result as the next step will (the build's level rule, which also sees
   water flowing back).
51. **Spawning by x,z can silently go elsewhere** (F105): `spreadplayers` refuses water and the agent stayed where its
   name last stood; in jungle it lands on the canopy (lesson 19). Check the command's answer; give a ground height
   (`FELL_Y`, `stage_village.py --site-at`) for tests in jungle.
52. **Measure how often a case happens before building for it** (F108): an offline port of `atlasSites` over the main
   atlas showed nearly all land has a good site within ~110 blocks, so scouting (2.4) is a safety net; five starts chosen
   as poor gave one scouting run. Widening a range before the first layout did more than the scouts.
53. **Mineflayer's `findBlocks` scans the sky** (F106, 2026-10-03): a section filled with one state has no palette, so
   every all-air and all-stone section was read cell by cell, a Block built per cell; a futile log search took 2.4 s in a
   desert. `nearestBlocks` now reads state ids itself (`scanBlocks`: palette and single-state skips, a y window per
   caller, filters on matches only, ~3 ms). Never call `bot.findBlocks` directly; in search filters read with
   `stateAt`/`exposedAt`/`wetAbove`, not `blockAt`. `scripts/checks/search_cost.py X Z` times the counts at a spot.
54. **Check a design's shape in code, not only its blocks** (phase D, 2026-10-04): with stairs allowed, gpt-oss drew
   pitched roofs in every design at once, but copied a 5-deep example onto 7-deep houses (rows open to the sky) and drew
   "pitched" roofs as solid blocks (a 549-block hall; the run took 18.2 min instead of 14.6). The rain test and the
   solid-roof check in `validateDesign` send them back; `scripts/bench/designbench.mts` measures designs (roof shape,
   cost, validity) on 10+ samples a case, and `scripts/checks/rotate_design.py` checks facing blocks at four turns.
55. **Stair shapes are the server's** (D.2, 2026-10-04, read from the 26.1.2 jar): `/setblock` and `/fill` work out a
   placed stair's shape from its neighbours, and a neighbour placed later works it out again; a shape written in a
   design survives only on a stair placed last. Never write `shape`; check it with vanilla's rule (`stairShape` in
   buildingGen.ts) against `GET /api/blocks?states=1` (rotate_design.py judges it at four turns).
56. **Fix a model's design in code rather than refuse it** (D.2/D.3, 2026-10-04): a style refused over budget sent
   gpt-oss to drawing by hand, where it drew a flat box or a hall with open gable ends and failed more (F118, Minevale16
   and 17); shown its own hand drawing's faults, it redrew them (0 of 8 improved, F119). Code now makes the change and
   says so (odd sizes, walls capped, `fitSmelts`, `shrinkStyle`, door rules, workstations to air): designbench went to
   30/30 by style with no retries for the budget. Point a refused hand drawing at the style.
57. **Whatever the consumers key on must survive every path in** (D.2's reviews): the design API dropped `style`, so a
   staged run "passed" on the old packing (GenB3); a door check keyed on the grid's edge turned doors sideways once
   overhangs and `_` rows existed. Follow a new field through the API, the library and each world's builder.
58. **Render what was built** (D.8's renderer, 2026-10-04): `scripts/render_design.py` on a design or a saved
   `/api/blocks` box showed open gable ends and wall gaps (F111) and inside shutters (F112) in designs that passed
   every check, and confirmed whole roofs after the tight-layout runs. Save the blocks while agents are still in the
   world: removing them unloads the chunks (the box comes back empty).
59. **Run times depend on the site the mayor picks** (F121): on minevale3 the mayor's find_site sometimes takes
   -1507,-62, whose mine gave cobblestone at a third of the usual rate. Record the site with each run before comparing
   times; generated buildings are fuller than drawn ones (overhangs, gable ends), so budgets (150/300) and the wall cap
   (houses 9, landmarks 11) keep a village near Minevale10's cost.
60. **Read vanilla's data for its own contract before designing on it** (V2.1, 2026-10-04): a village piece's entrance
   jigsaw is at walk level (street pieces: path at y 0, entrance jigsaws at y 1) and gives the front side; a door's
   `facing` points in or out depending on the piece. An offline dump of a few pieces (`scripts/checks/vanilla_pieces.mts`
   PIECE=, the scratch dump scripts) settled the layering before any code; the reviews then found 15 real problems in
   the importer, mostly in how its output met our own rules (door layer 1, outside "_", double slabs, stripped logs).
61. **A stand spot is somewhere to wait, never worth building up to** (F131): "3 blocks south of the claim" with
   footing searched 24 up and down chose a neighbour's roof once a street plan packed buildings 3 apart, and the walk
   there pillared dirt in front of the mining hut's door and sealed the mine. No walk may place blocks on village ground
   (`exclusionAreasPlace`), stand spots are searched at the job's level first and off every building and the mine. Any
   fixed offset is worth checking again when layouts get tighter.
62. **Whatever lies between buildings must not be a building** (F129): every build claims its area plus a ring and
   refuses recorded structures in it, so streets built as designs would have failed every house beside them; streets are
   laid by prepare_site and kept on the layout record, and neighbours stand 2 blocks apart.
63. **A greedy placement wastes room; compare a clever plan with the simple one** (V2.3): nearest-first placement left
   half the pad empty and 2-3 buildings out; a small beam search and trying fewer streets placed them, and a centre that
   still leaves buildings out gives way to crossing streets, then rows (the review found savanna's centre pushing the
   hall to a second site while a crossing placed all five).
64. **Rules about "junk" must know who gathers what** (F132): dirt was junk to deposit, so a task gathering dirt for a
   vanilla floor could never finish; with the village's needs as the rule every miner would have emptied its scaffolding
   into storage. The rule now asks whether the depositing agent holds a claimed task to collect that item.
65. **"Matching" is code's to enforce** (V2.3): told in the prompt that matching houses are siblings, the mayor still
   named one house twice in its first model-driven run; plan_layout now swaps a repeated vanilla small house for an
   unused sibling (lesson 1). The mayor's own choice from a filled library was right at once in Minevale20.
66. **Add a behaviour beside the brain's state, not inside it** (V2.3m's design review): a gather plan written into the
   mayor's `memory.plan` would have reached the executor's building tools on urgent turns, the 3-failure replan and two
   wake-ups blocked by its own claim. A TaskBrain running beside the empty plan left every existing check as it was;
   only the few places that count tasks or events had to learn to ignore it.
67. **A stopped action sends no report** (F134): `BotAgent.stop()` aborts the running action and its `finish` returns
   early, so no `action_failed` comes. Anything that waits for an action's end must also notice "idle while waiting"
   (the scripted workers held their task for good after a death or the panel's stop button).
68. **One piece that never turns can decide a layout** (V2.4's review, from a prototype before any code): the storage hut
   opens south and is never turned, so a ring centred on the pad left no room north of it in plains and savanna. Moving
   the centre and ring a few blocks fixed it; turning the hut would have broken six places that assume it as drawn.
   Prototype a new plan offline across the biomes before coding it.
69. **Every dig beside water floods** (F136, F137): checks must look at the sides and up through sand and gravel, not
   only at the block above; seagrass, kelp and bubble columns are water. Shore sand in the open is fine to take; a buried
   block next to water and the ground under the bot's own feet are not.
70. **A drop pickup walks into the pit it came from** (F138): side pickups dug ground below the bot, `pickUpDrops` walked
   it into each hole, and from there every walk stalled "stuck" for minutes. Take only blocks at or above the feet;
   don't dig ground the bot will have to stand in.
71. **Measure with the run's own settings** (V2.4): prepare_site at 40x40 took 9.6 min for Gus at the default
   buildSpeed 1, ~450 s of it pacing; at a village worker's buildSpeed 4 it was 2.5 min.
72. **The hand lists were wrong more than incomplete** (V2.5, 2026-10-05): suffix patterns took built blocks as natural
   (`_log$` stripped logs, `.*_terracotta` glazed terracotta, `_sapling$` and `.*_tulip` potted plants, `_stem$` crop
   stems as tree logs), so prepare_site could clear and felling crawl into vanilla houses' stripped-log frames. Vanilla's
   tags list blocks by name; prefer a set of names to a pattern for anything that decides what may be broken.
73. **Tags do not hold every natural block**: cocoa, bee nests and berry bushes (F61, F76) are in no tag that does not
   also hold built or farmed blocks (`#beehives` has the beehive). A vanilla list is tags plus a short, visible extras
   list (`mcBlocks.ts` DEFS); `vanilla_tags.mts` prints both against the old hand lists.
74. **A fallback must be all or nothing** (V2.5's design review): one list from the jar and another from the hand
   regexes would have kept a stripped-log frame in prepare_site's column check and felled it in treeAt's crawl. Build
   every derived set in one pass; on any error use every hand list. And never cache a result before it is complete
   (a tag read that threw left its partial set cached).
75. **Inventory before deciding, and check the old code in the world before blaming the new** (V2.5): four read-only
   subagents with comparison scripts turned "replace the hand lists" into a list of judged differences and showed the
   loot-table part was not worth changing. A felling check that left a pillar dirt was run again on the stashed old
   code after a reset: the same trees, so the dirt was lesson 29's placement quirk, not the change.
76. **A new recipe source can cycle a cost search** (V2.5): the jar's wool recolouring hung it and resin's
   clump/block pair made it return null (F141). After changing recipe data, plan every registry item once with a time
   limit (33 ms for 1,506 items) and compare the bills with the old ones (`materials.mts`).
77. **Reproduce live before trusting a replay, and spawn tests at a cell's centre** (F143, F144, 2026-10-05): two
   offline replays of the pathfinder got out of VanG4's pit, while Gus in the live world stalled on every walk toward
   the chest; and a test bot spawned within 0.3 of a wall has its box inside it, so the server refuses its moves
   ("moved wrongly"): two of four start spots were artefacts. Measure a baseline on the live reproduction before
   changing code.
78. **Tally what the physics did, not what the controls say at the end** (F145, F147, 2026-10-05): the `[stuck]` line's
   per-walk tick tally (controls held, on ground, set-backs by the server with the corrected position) named F138's
   mechanism on its first run, after two sessions of replays: the server refused ~33 moves a second, so no
   pathfinder rule (item 4's diagonal guard) could have helped. Read a stall's `[stuck]` line before changing a walk.
79. **A workaround constant must be exact in binary** (F147): `playerHalfWidth` 0.3001 meant face - 0.3001 + 0.3001 >
   face at ±4, ±128 and ±1024, the bot's box 4e-16 inside the wall, and Paper's CLIPPED_INTO_BLOCK check refuses such
   moves **without logging** (logWarning false). Silent set-backs (forcedMove, no "moved wrongly") mean a box overlap:
   look for rounding or a world mismatch. F71's unexplained pocket (z 128) was the same bug, a week earlier.
80. **The bot's world is not the server's after a dig either** (F147): Mineflayer writes air when its own dig timer
   ends, Paper breaks the block only when it agrees (progress >= 0.7, later or never); walks through such a cell are
   set back for 10 s. mineBlock asks the server after every dig (`[dig]` logs a re-dig). With lesson 29 (own placements
   not echoed), anything that changes a block should be confirmed on the server when a later step depends on it.
81. **Ask the server's code when its behaviour is silent** (F147): a read-only subagent disassembled Paper's
   `handleMovePlayer` from the jar (`runs/2026-10-05/s16/jdis.py`, no JDK needed) and found the silent branch in one pass;
   `[stuck-world]` (RCON `execute if block` round the feet) then confirmed the mine case in the next staged run.
82. **A library can corrupt its own state through what it hands you** (F151, 2026-10-06): mineflayer-pathfinder's
   `postProcessPath` edits a partial path in place, and those nodes were the A* search's own; the search went on judging
   the goal on shifted coordinates and called a cell 3.6 from a range-3.5 goal a success, then idled with an empty path.
   Log the library's own judgement at a stall (the path's last node and whether the goal accepts it) and fix it where it
   lives (`patches/`, patch-package; the dependency pinned to the patched version).
83. **A stall's label can name the wrong call** (F151): `at()` floors, so "-1659,65,8" read as placeChest's aisle when it
   was craft's walk to the crafting table; two sessions chased the wrong walk. Log the goal itself (kind, cell, range).
84. **A recovery test needs the protections of the real trap** (F152): a stone shell was dug through (walks dig natural
   stone), a short closed tunnel answered "no path" at once and walked nowhere, and only a long sealed tunnel or a real
   village mine (protected: the pathfinder's exclusion weights of 100+ are bans, F154) showed the false "walked out".
   Test what a recovery counts as success against the trap, not only that it ends.
85. **Rebuild a failing model call from the run's own log before benchmarking it** (F155, 2026-10-06): the first bench
   case, written from the analysis, passed 10/10; with the real prompt's events (plan 1's "New plan" line, "size raised
   to 40") it failed 4/12 as the run had. The events the model saw are part of the prompt.
86. **A wake-up reason is advice the model follows literally** (F155): told "draw any design the objective still needs,
   then call plan_layout", gpt-oss drew a design 7-11 times in 12 with a full library; told "the library holds X, Y, Z:
   call plan_layout now", it laid out 12 in 12. When code already knows the next call, the reason should name it and its
   arguments, and say nothing that invites a detour.
87. **Code-posted steps that code runs inside the brain need their own completion** (F155's review): a design drawn by
   the executor sends no action_done, so its step stayed current and the executor improvised; and a tick that checks
   "plan complete" before a pending reason drops the reason. Wherever progress is credited by events, check the
   in-brain paths too.
88. **"Any" in a recipe plan must not mean "the first one carried"** (F156): charcoal's "any logs" took the birch fetched
   for fence planks. When a plan reserves some items of a kind for a later step, every generic step must choose from
   what is spare (makeFromStock's `spareKind`), fuel included (still open).
89. **A rule keyed on a record's author must hold on every path in** (F160, 2026-10-08): the signs named vanilla pieces
   by `design.by === 'vanilla'`, but the design API records every posted design as `by: 'api'`, so the staged runs'
   vanilla houses read "Plains small / house"; the model-driven library keeps `vanilla`. Read the staged run's own
   record before trusting a field (lesson 57), and key on something the data carries itself (the jar's piece name).
   Sign text in 26.1 is plain SNBT strings (`messages:["Library","","",""]`, exactly four); a JSON string shows its
   braces. Check signs on the server with `data get block X Y Z front_text.messages`.
90. **A goal must be one the bot can meet** (F162, 2026-10-08): `mineBlock` walked to grass with `GoalLookAtBlock`, whose
   test casts a ray against collision shapes; a plant has none, so the goal never ended and every grass walk stalled
   ~11 s "stuck" (3 of 8 seeds in 1.5 min), and its "dug on the way" test (an empty box) passed every plant undug.
   Choose the goal by the target's box (within 2 of a plant), and test "dug" by the block changing, not by its shape.
91. **A priority is a scheduling decision; check it against the critical path** (F163): "the farm's seeds first" for
   the waiting mayor looked free (off the builds' path) but took it off the mining hut's logs, and the whole build ran a
   minute late (Minevale31, 16.5 min against 15.4). Line up the run against the last one (a log-analysis subagent did,
   same layout and bills) before calling a loss variance; post off-path work in posting order.
92. **Read the jar for loot and ticking, not minecraft-data or assumptions** (the farm's research): minecraft-data lists
   the wheat crop as a seed source and tall grass and ferns as none (collect would have harvested the village's own
   field); `advance_time false` leaves random ticks running (crops grow with time frozen, ~25-45 min a crop at 1x), but
   only in chunks within simulation distance of a player or bot: a field no agent is near does not grow.
93. **Work that must run after completion, or must not hold it, is a chore beside the board** (farming v2, 10-08): a
   posted "Harvest the farm" task needed exemptions in completion, the mayor's wake-ups, cancelOpen and both claim gates,
   and the design review still found races, a stall after completion and a posting loop. Code queues the skill on an
   idle worker holding no task (nothing claimable unless complete), marks its args `chore: true` so the brains ignore
   its events, locks the field and backs off after a failure (`MineflayerWorld.farmChores`). Lesson 66's pattern again.
94. **Count a loot table's drops in the world before designing around them** (F168): two research reports read wheat's
   seed bonus as 0-3, but it adds to the entry's count of 1 (1-4 seeds, 49 and 42 from 16 crops), so the zero-seed
   case the design guarded against cannot happen. `loot give` reports stacks, not items: count with `clear <name> X 0`.
95. **A staged test must reproduce the condition the fix is for** (F164): staged sites gave no village wood kind, so
   every log already counted and the baseline looked fine (VanW1 7.5 min); a wood kind (`--site-at` sixth field) showed
   the real cost (VanW2 9.6, 136 oak unused). Check the staged village's record (wood, layout, bills) matches the
   model-driven run's before comparing.
96. **An all-together rule can be a safety property** (F164's reviews): covering log tasks building by building let
   one building's deposits close another's tasks and builds came up short; keep the aggregate per kind and move whole
   buildings between kinds. Never move work under way (a builder holds the logs it withdrew, so the pool looks short:
   VanW4 moved a house to oak and back), and enforce the choice where the work happens (chooseWood mixed kinds part by
   part until it searched for one kind covering the whole building).
97. **Rank opportunities on the critical path with a schedule replay of the run logs** (the opportunities analysis): the
   runs are work-bound after the mine opens, so removing work (the preparer's logs, F164) moves the finish and shifting
   it earlier does not; the predictions held (#1 1.7 min staged against 1.5-1.9). Starting work earlier needs its
   ground protected earlier: gatherers working while the plot is prepared would have dug the plot's own dirt (the
   review's High), so laid-out plots count as village ground before they are prepared.
98. **A loop whose awaits all settle at once starves the event loop for good** (F174, 2026-10-08): mineBlock answered
   "nothing to mine" at once for sugar cane, collect counted nothing, found the same cane and looped; with only microtasks
   between rounds, no I/O ran: the API timed out and no `[lag]` line ever came (it is logged after a stall ends). Every
   loop over candidates must treat a no-progress answer as a failure of that candidate. To see a hung process's stack,
   attach the inspector: `node -e "process._debugProcess(PID)"`, then `node runs/2026-10-08/s22/cdp_stack.cjs
   ws://127.0.0.1:9229/<id>` (pauses it, prints the stack, resumes).
99. **Count what the land holds before building for it** (F176, F183): an offline scan of the test world's snapshot
   (plants and animals by site; ores per y band along a planned tunnel) showed farm plants are rare and animals common,
   and that a level at y 39 held 3 iron ores in its whole stretch. Region-file scans take seconds
   (`runs/2026-10-08/s22/ores_along.py`); run one before choosing a depth, a kind or a site.
100. **The ground under a site is not one block of stone** (F180, F182): the mine's own turned tunnels took both sides of
   its bottom step, and caves and aquifers at y 36-51 stopped three straight descents in a row on minevale3. Plans that
   dig down need several starts, chosen apart from where the last ones failed, and a rule for when to settle that looks
   at what the depth gives (F183: settling at y 39 dug 87 cells for nothing).
101. **Never walk a bot home from deep underground** (F186): a worker left at y 11 by a cave walked to the storage and
   the pathfinder dug a shaft straight up under the storage hut, below the depth protected ground starts. Any chore that
   goes deep ends by checking where the bot is and teleporting it home if it is still down there; and nothing down there
   may make a tool (its walk for logs is free to dig).
102. **Every protection rule has a third dimension** (the iron reviews): `keptStairs` ignored y, so iron stairs 20 blocks
   down would have ended tunnels above them; vein following without a height floor dug holes in the next cell's floor
   and under the bot. When a rule is extended to something at another depth, check it in y as well as in x and z.
103. **A record made by the first step must exist before the first step** (F184): the iron pickaxe was made from stored
   iron before any trip had created `mine.iron`, so "made" was written nowhere and a second pickaxe was made. Keep
   state a chore reads on the record that always exists (the mine), not on one a later stage creates.
104. **A callback handed to a library runs inside its tick, and an exception there takes the whole server down** (F188,
   2026-10-09): the pathfinder passes a stub with no `position` for a block in an unloaded chunk, and the farm-field walk
   ban read it; every agent and the API went with it. Code given to a library must accept everything the library can pass
   it (stubs, nulls), not only what our own calls produce.
105. **Lead animals by the server's rule, never through a gate on foot** (the pens, 2026-10-09): TemptGoal looks 10 blocks
   in 3D from the player's feet at either hand, so chickens 10 above the bot on a hill never came (F194), and one trailing
   on the far side was 11 from the pen's back row once the bot was there (VanA4b). The pathfinder took a fence gate for a
   full block and clicked closed ones open, never shutting them (F197). What worked: seeds in the off-hand by command, hops
   with waits, and teleporting the bot into the pen (2 cells in, then the back row) so the chickens follow through the open
   gate; the live tests (`runs/2026-10-08/s23/lure_facts.md`) settled each step before code.
106. **A chore must not wait on what another chore uses up** (F195): the pen waited for seeds in storage, and the wheat
   field took every seed before its first harvest. When a skill needs only a little of something common, let it get it
   itself (start_pen gathers 3 seeds from the grass).
107. **A pool that merges kinds must match how the consumer spends it** (F198): the planner counted 1 oak + 1 birch plank as
   the 2 "any planks" a hoe needs, but every craft takes one kind. Real runs leave odd mixed inventories that staged runs
   do not: an offline replay of the planner over a grid of inventories (31 failing ones) found the case and checked the fix.
108. **A test agent in a complete village is one of its workers** (F196): Gus, spawned as a member of Minevale33 for a lure
   test, was given its chores and went scouting mid-test. Single-agent tests spawn in no village (or an incomplete one).

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
