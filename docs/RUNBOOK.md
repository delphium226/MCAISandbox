# Runbook

The full notes on running, testing and benchmarking, moved verbatim from CLAUDE.md on 2026-10-15. CLAUDE.md keeps
the short version; look here for a check script's arguments, a model detail or where land was good.

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
  2. only when a role runs on a local model: since A.0 every role defaults to gpt-oss:120b-cloud;
     `python scripts/ollama_exec.py start` (the two pinned local model servers; it unloads them from the app first)
  3. `MC_API_HOST=0.0.0.0 MC_OLLAMA_ROUTES="qwen3:30b-instruct=http://127.0.0.1:11435,qwen3.8:27b=http://127.0.0.1:11436" python scripts/detach.py runs/<date>/agentserver-N.log node node_modules/tsx/dist/cli.mjs server/src/mineflayer/index.ts`
     (agent server + panel on 8766; restart it after editing server files: it does not watch; add `MC_TIME_SCALE=2`
     for staged runs and checks at double speed, never for model-driven acceptance runs; `MC_OLLAMA_ROUTES` is
     harmless when every role is on the cloud, and a named local model needs it). Since E.1: `GET /api/perf` (RSS, event-loop delay, tick time, RCON
     in flight and p90, the overview's size), `MC_RCON_TIMEOUT_MS` (15 s), `MC_PF_TICK_MS` (20) and `MC_PF_FREE_SEARCHES` (3) for
     the pathfinder's shared allowance (`scripts/checks/pf_share.mts`). Since s30 (2026-10-15) a complete village **grows**: code lays out neighbourhoods of up to 4
     houses until it has a house per member (`server/src/grow.ts`, `[grow]` lines; `MC_GROW=0` turns it off; a growth layout
     saved under way is watched to its end either way) Food (s30): `MC_GROW_FARMS=1` gives neighbourhoods fields and
     slots, `MC_APPETITE=18` (or 1/on) the village appetite (`[food]` lines; `MC_APPETITE_START`; `POST
     /api/village/V/appetite {"level":N}` for tests); both off by default. The test agent server's port is
     `MCAI_TEST_API_PORT` (default 8767). The hourly budget
     `MC_TOKEN_BUDGET_HOUR` defaults to 2,000,000 cloud tokens (0 or off disables it); `MC_REASONING=exec=medium,plan=low,design=medium`
     is the default (A.0's benches: low executors missed "step already done", a medium mayor re-posted work instead of waiting); for tests, `MC_TOKEN_WINDOW_MS` and `POST /api/usage/budget {"tokensPerHour":N}`.
  The **test world** (phase T, `docs/PLAN.md`): a second Paper in `mc/testserver` (25566, RCON 25576) with its own
  agent server on 8767, generated from the same seed; `MCAI_API=http://127.0.0.1:8767/api python
  scripts/reset_site.py SITE` (add `MC_TIME_SCALE=2` and/or `MC_OLLAMA_ROUTES` as needed) restores a site from the
  snapshot in `mc/testworld` and starts both servers detached; then `MCAI_API=http://127.0.0.1:8767/api
  MC_SERVER_DIR=mc/testserver python scripts/stage_village.py V --site SITE` (or watch_village.py with the same two
  settings and the site's probe point). Sites: `scripts/test_sites.json`.
  4. a test: first the staged one without models, `python scripts/stage_village.py <Village> -160 -100 --stage build`
     (~1 min; `--stage full` ~8 min), then a model-driven village, the survival economy:
     `MCAI_API=http://127.0.0.1:8766/api MCAI_GAMEMODE=survival MCAI_STALL_MIN=5 MCAI_SAME_FAIL=6 python
     scripts/watch_village.py <Village> -160 -100 2 90 "two matching cottages and a meeting hall"` (10-40 min:
     ~300-block villages 10-15 min, 500+ blocks or log roofs 25-40). Without `MCAI_GAMEMODE` it runs in creative
     (free blocks, a few minutes). The watcher probes for land (in survival it skips ground with too few trees) and
     spawns the village at the site it found, not at X Z. The STOPPED line ends with the run's tokens and cost
     (from `/api/usage?since=`); the panel header shows the totals since the agent server started, not per run.
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
  Mayor, Worker1-24 in both worlds (2026-10-11, E.1). Paper's `max-players` is 30 in both (25 agents, the user, Gus and headroom). A new agent name must be whitelisted first (`python mc/rcon.py "whitelist add <name>"`) or its
  bot is refused. RCON also listens on all addresses now but no firewall rule lets it in. The agent server serves the
  panel to the LAN when started with `MC_API_HOST=0.0.0.0` (http://192.168.1.84:8766/panel; no login). Time is frozen
  at day (`gamerule advance_time false`, 26.1's name for doDaylightCycle). The watch scripts teleport SausageOfDoom4 to
  the Mayor (or the test agent) when the user is online.
- `GET /api/block?x=&y=&z=` inspects the world; `loaded: false` means the chunk is not loaded (unloaded blocks used to read
  as air, which caused false conclusions).

## Models (gpt-oss for every role; local models as a fallback)

- **Every role defaults to `ollama:gpt-oss:120b-cloud`** (the user's decision, 2026-10-10, A.0): mayor, architect,
  workers' planner and executors. Each call kind has a reasoning level (Ollama's `think`; `MC_REASONING`, per agent
  `memory.reasoning`), because gpt-oss ignores `think:false` (69/51/20 output tokens at false/medium/low). Tokens and
  cost show in the panel header and `GET /api/usage`; prices come from `MC_TOKEN_PRICES` ($0.15/$0.60 per M tokens
  for gpt-oss; thinking bills as output; costs are a lower bound, errored calls count 0). The hourly budget
  (`MC_TOKEN_BUDGET_HOUR`) pauses cloud calls when spent: agents back off and code-posted work goes on; a 429 or 5xx
  hands a task back instead of failing it.
- Two RTX 3090s (24 GB each); GPU 1 also drives the display. Ollama (0.34.x) at localhost:11434, models in `F:\AI Models`.
- Installed: `qwen3:30b-instruct` (MoE, ~19 GB; the executor until A.0; now a fallback), `qwen3.8:27b` (dense, ~22 GB at 8k; the workers'
  planner), `gemma4:31b` (dense, ~21 GB, only ~10 tok/s: the old planner/architect), and cloud models through the
  Ollama app: `gpt-oss:120b-cloud` (the user's paid subscription; every role), kimi, deepseek,
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
  not fit, so `OLLAMA_NUM_PARALLEL` does not help it. Local models only: Ollama Cloud ignores `num_ctx` (an
  18,292-token prompt was read whole at 8192); the 8k warning fires only for local models, and a cloud prompt over
  8192 logs one warning per agent and kind (lesson 32).
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
  Since E.1 (2026-10-11): `scale_probe25.py AGENT_LOG` (25 bots of mixed work; `LEVELS`, `WORK`), `pf_share.mts` (the
  pathfinder's shared allowance offline), `human_line.cjs NAME PORT "TEXT"` (a plain player's chat line, for chat
  routing), `cdp_profile.cjs`/`profile_callers.cjs` (CPU profile of a running agent server, lesson 125), and
  `scripts/stage_runs.py NAME:WORKERS ...` (staged runs in a row on minevale3 with a reset before each; detach it and
  arm a watcher, lesson 122).
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
- **Checkpoints** (2026-10-15): `reset_site.py SITE --save CP [--force] [--no-start]` stops the test servers (Paper saves)
  and copies the site's region, entities and poi files, the villages on them and their atlas summaries into
  `mc/testcheckpoints/CP/` (gitignored; ~26 MB for minevale3, a few seconds); `reset_site.py SITE --checkpoint CP` restores
  from there instead of the snapshot; `--list` shows them with the commit they were saved at. `stage_village.py VILLAGE
  ... --resume --after MINUTES` then reads the complete village as it stands (no designs, layout or staging; refuses
  `--stage build`, `--harvest`, `--fixtures`, `--design-*`), spawns the members round its first layout and starts the
  after phase at once; the build's PREPARE, CRITICAL PATH, MINE and TAIL lines are left out. Players' files are not
  saved: agents spawn with empty hands (`"reset": true`), and claims of the saved run are handed back at their spawn.
  Save with the agent server's `MC_GROW=0` (a growth layout is posted right after completion) and restore with whatever
  the test needs. CPv1 (`runs/2026-10-15/cp_check.py`): build 5.9 min, save + restore 0.3, then the after phase from 0.0.
- **Run series** (2026-10-15): `scripts/run_series.py SPEC.json [RUN ...] [--dry-run] [--detach]` replaces the
  per-session drivers (`runs/*/g_runs.py`, `b4_runs.py`, `a2_runs.py`, `s9_runs.py`; `scripts/stage_runs.py` still works).
  A spec gives the site, a base command (`preset`: `s0` is stage_runs.py's S.0 command on minevale3, `none` for your own),
  workers, the agent server's settings (`server_env`, through reset_site.py), stage_village.py's arguments and environment,
  a timeout, follow-up checks and extra line prefixes to print; each run overrides any of them and may `save` a checkpoint
  or start from one (`checkpoint`: a resumed run, its village read from the checkpoint). Checks: `make_log`
  (scripts/checks/make_log.py on the run's agent server log, found in its reset log) and `agent_log` (`[lag]`, `[stuck]`,
  `[stuck-world]`, `[repath]`, `[dig]` counts); add one to `CHECKS` in the script. Logs go to `out` (default
  runs/<today>): NAME.log, reset_NAME.log, NAME.choices.jsonl, save_NAME.log, SPEC.runner.log with `--detach`. The s0 preset
  reads its designs from `runs/2026-10-05/vanilla_designs` (gitignored, as stage_runs.py). Tested with
  `runs/2026-10-15/series/cp_series.json`: two resumed runs from `mv3_cpv1`, 3.5 and 4.5 min each with the restore.
  Model-driven runs (watch_village.py) are not covered yet. `--detach` moves an earlier runner log aside first (the
  watcher would wake on its "ALL DONE").
- **Faster test runs** (2026-10-16): `scripts/run_report.py LOG|DIR/NAME [...]` (one table per run, side by side; the
  agent log's counts found through reset_NAME.log; `MCAI_REPORT_WIDTH`). `stage_village.py --after-until grow[,idle:N]`
  ends the after phase once every condition holds (grow: no growth layout under way and growth stopped or a house per
  member; idle:N: no member ran an action for N minutes, rare with the workshop and light chores on). The agent server's
  `MC_RANDOM_TICK` (the game rule random_tick_speed, set at every start, 3 unless given): 30 gave Rt30's first harvest at
  +2.4 min (G3f ~+17), every food line intact. `MC_HASTE` (level of an infinite Haste given at every spawn; Mineflayer's
  digTime and Paper's check both count it: H5's `[dig]` re-digs 2, as without). One s0 build each from the snapshot
  (2 workers and the Mayor): CPv1 (2x) complete 4.9 min, mine 35 cells/min; H5 (2x, haste 5) 4.2, 39; T3 (3x) 3.9, 41;
  H5T3 (3x, haste 5) 3.2, 52; all 0 failed, 0 `[lag]` and `[stuck]` (single runs). `--after-until grow` ended UntilG at
  4.4 min of 30. `scripts/stack.py status|up|down [main|test|all]`: ports, agent counts and world settings; starts Paper
  and the agent server detached (from a snapshot, `MC_OLLAMA_ROUTES` set, MC_ settings from the shell); stops them
  cleanly. Code snapshots: `scripts/snapshot_code.py` copies server/src, server/panel,
  shared/src, package.json and tsconfig.json to `runs/code/<hash>/` (reused while the code is unchanged; CODE.txt names the
  commit and uncommitted files); `reset_site.py` starts the test agent server from one with `MCAI_ROOT` (index.ts,
  mcChoiceLog.ts and vanillaData.ts read the repo from it), so server files can be edited during a run.
- **After completion** (chores: farm slots, harvests, exploring, the iron age; 2026-10-08): `stage_village.py ... --mayor
  --after MINUTES` keeps watching after the village is complete (only a tiered mayor sets it complete); `--fixtures`
  plants sugar cane, pumpkins and a melon 35-45 blocks off the site first (minevale3 has none within 96), `--ripen` sets
  each newly planted slot ripe, `--stock raw_iron:3` gives a worker items to deposit (the iron tools without the digging);
  `watch_village.py` takes `MCAI_AFTER=MINUTES`. Iron trips dig on the wall clock: an iron age takes ~20 min after
  completion even at 2x. Offline: `runs/2026-10-08/s22/iron_start_check.mts [villages.json]` (where the iron stairs would
  start in every recorded mine), `ores_along.py X1 Y1 Z1 X2 Y2 Z2` (ores in the snapshot).
  Since pens v2 (2026-10-09): `--fixtures` also summons 2 cows by the 4 chickens, `--stock wheat:12,bucket:3,sugar_cane:2`
  deposits each item by name (the cow pen, milk and a cake without a harvest or the iron age), the PEN lines show eggs,
  young and milk, and `AFTER busy:` gives each agent's busy minutes after completion. Live animal facts:
  `runs/2026-10-09/scripts/pens_v2_facts.py X Z [feed|cmdbreed|eggs|cowlure|cowfeed|milk]` (Gus in no village, a pad);
  `use_on` (not in TOOLS) clicks an item on the nearest entity of a kind for such tests.
  Since F205 (2026-10-10): `--fixture-dy LO:HI` puts the fixture chickens and cows on soil LO..HI above the site,
  `--fixture-at=X,Z` at a given spot (searched round it), `--fixture-clear` kills the wild ones within 120 first;
  `runs/2026-10-10/scripts/slope_facts.py X Z KIND steps|cliff|side below|lead` (animals on a rise, Gus in no village) and
  `scout_water.py` (a scout into a lake). In a model-driven run the wheat field can be ripened by RCON
  (`fill X1 Y X1 X2 Y Z2 minecraft:wheat[age=7] replace minecraft:wheat`) to reach the cow pen and the cake.
- `scripts/bench/mayorbench.mts [model] [times]` replays the mayor's real prompts in the situations that went wrong
  (seconds per case): run it after changing the mayor's prompt or tools.
- Every role is gpt-oss:120b-cloud by default (A.0). For a local run, name the models (`MCAI_EXEC_MODEL=ollama:qwen3:30b-instruct`,
  WORKER_PLANNER `ollama:qwen3.8:27b`) and start the pinned servers. In village runs the workers' planner is hardly
  called (`plan 0x0ms`: code-posted tasks run as written, the executor handles failures).

## Things to expect in survival, and land in the main world

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

## Conventions (the full notes, with their reasons)


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

## Agent architecture (the full notes)


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
