# MCAISandbox: notes for Claude Code sessions

A browser Minecraft-style sandbox with an authoritative Node server, built to host human players and LLM agents in one
world (Project Sid-style experiments); the same agents also run in real Minecraft (Paper 26.1 through Mineflayer), where
nearly all current work happens. This file is the short version of how to work on the project; it is loaded into every
session, so keep it short and put detail in the files below.

**Current work is planned in `docs/PLAN.md`**: read its "Next session starts with" and the current phase at the start
of every session, work step by step, and record as you go (PLAN.md's "How to use" says where each kind of note goes).

## Where things are

- `docs/PLAN.md`: the handover, the current phases and the backlog.
- `docs/RUNBOOK.md`: the full running, testing and benchmarking notes: every check script and its arguments, staged-run
  flags, model and Ollama details, the Mineflayer adapter's files and skills, where land was good in the main world.
  Look there before writing a new check or a new way to run something.
- `docs/LESSONS.md`: what earlier sessions learned (11 sandbox lessons, then the adapter's list, 139 so far). "Lesson N"
  means the adapter's list. **Grep it for the area you are about to change** (pathfinder, storage, mine, chores...).
- `docs/FINDINGS.md` (F1...), `docs/RUNS.md`, `docs/DECISIONS.md`: the logs. `docs/HISTORY.md`: what each session did and
  committed. `docs/plan-archive/`: finished phases and earlier handovers.
- `README.md` (features, skills, API) and `docs/ARCHITECTURE.md` (how the system fits together, with diagrams).

## Running and checking

- `npm run typecheck` is the main check; there is no test suite, so verify agent changes by running agents (Testing).
  `npm run dev` starts the sandbox game server (8765) and the Vite client (5173).
- **`python scripts/stack.py status`** at every session start, **`up [main|test]`** to start what is missing (steps 1
  and 3 below, the agent server from a code snapshot), **`down [main|test]`** to stop cleanly (villages flushed, Paper
  saved). The steps by hand (after a reboot nothing is running; the user starts the Ollama app):
  1. `python scripts/detach.py runs/<date>/paper.log python mc/start.py`; wait for "Done (" in
     `mc/server/logs/latest.log`. **Start servers with `scripts/detach.py`, never the Bash tool's `run_in_background`**:
     background tasks die with the session and at their 30-minute limit (Paper was killed unsaved that way).
  2. Only when a role runs on a local model: `python scripts/ollama_exec.py start` (pinned local model servers).
  3. `MC_API_HOST=0.0.0.0 MC_OLLAMA_ROUTES="qwen3:30b-instruct=http://127.0.0.1:11435,qwen3.8:27b=http://127.0.0.1:11436" python scripts/detach.py runs/<date>/agentserver-N.log node node_modules/tsx/dist/cli.mjs server/src/mineflayer/index.ts`
     (agent server and panel on 8766; it does not watch files: restart it after a server edit by stopping the process
     on 8766, `Get-NetTCPConnection -LocalPort 8766 -State Listen`).
  4. A test: staged first (Testing), then model-driven: `MCAI_API=http://127.0.0.1:8766/api MCAI_GAMEMODE=survival
     MCAI_STALL_MIN=5 MCAI_SAME_FAIL=6 python scripts/watch_village.py <Village> X Z 2 90 "<objective>"` (10-20 min; the
     watcher probes for land and spawns at the site it found; its STOPPED line ends with the run's tokens and cost).
- **The test world** (use it for nearly every test): a second Paper in `mc/testserver` (25566, RCON 25576) with its own
  agent server on 8767 (`MCAI_TEST_API_PORT` moves it if another program holds the port), same seed.
  `MCAI_API=http://127.0.0.1:8767/api python scripts/reset_site.py SITE` restores a site from `mc/testworld` and starts
  both servers detached; then `MCAI_API=http://127.0.0.1:8767/api MC_SERVER_DIR=mc/testserver python
  scripts/stage_village.py V --site SITE` (or watch_village.py with the same two settings). Sites:
  `scripts/test_sites.json`; minevale3 is the usual one. The main world is full of old test villages: build elsewhere
  (`scripts/checks/fresh_land.py`) if you must use it.
- Agent-server settings worth knowing: `MC_TIME_SCALE=2` (staged runs and checks; never for model-driven acceptance
  runs), for staged after-phase tests `MC_RANDOM_TICK=30` (crops ripen ~7x faster: first harvest at +2.4 min, not ~+17)
  and `MC_HASTE=5` (bots dig faster for real; never in acceptance runs); with `MC_TIME_SCALE=3` a 3-agent staged
  build completes 35% sooner (H5T3 3.2 min, CPv1 4.9; untested at 25 agents, where the agent server is the limit), `MC_GROW=0` (no growth after completion), `MC_GROW_FARMS=1` and `MC_APPETITE=18` (food; both off by default),
  `MC_CHOOSE=fixed|model`, `MC_CHOICE_FAMILIES`, `MC_TOKEN_BUDGET_HOUR` (2,000,000 cloud tokens), `MC_REASONING`
  (default `exec=medium,plan=low,design=medium`). `GET /api/perf` (event loop, RCON, tick time), `GET /api/usage`,
  `GET /api/block?x=&y=&z=` (`loaded: false` means the chunk is not loaded). The rest: RUNBOOK.
- Stop: `python mc/rcon.py stop` (saves the world; killing Paper loses up to 5 minutes), `python scripts/ollama_exec.py
  stop`, the agent server by PID. Watch scripts leave their agents in the world: remove them (panel or `DELETE`). If a
  watcher died mid-run, `python scripts/attach_village.py VILLAGE MINUTES_SO_FAR` follows the agents instead.
- **A detached run does not wake the session**: arm a Bash `run_in_background` watcher with every detached run
  (`until grep -q "ALL DONE" LOG; do sleep 15; done`) with a `timeout` above the run's length (lesson 122).
- `[lag] ... blocked for ~N ms` lines are event-loop stalls over 2 s (2-3.5 s at spawns is normal; over ~30 s Paper
  drops every bot).
- **Control panel:** http://127.0.0.1:8766/panel (LAN: http://192.168.1.84:8766/panel): every agent's brain state, plan,
  map, inventory, what its last model call saw, the task board, tokens and cost. Without a browser: headless Edge
  (`"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --screenshot=<png>
  --window-size=1300,1100 --virtual-time-budget=8000 http://127.0.0.1:8766/panel`), then read the PNG.
- Paper runs with the **whitelist on** (SausageOfDoom4, Gus, Mayor, Worker1-24 in both worlds; a new name needs
  `python mc/rcon.py "whitelist add <name>"`), `max-players` 30, time frozen at day. Use 127.0.0.1, not localhost, with
  curl (localhost adds ~0.2 s on Windows).

## Conventions

- Work on the feature branch `tiered-brain-building`; commit only when asked or clearly agreed, and ask before pushing.
  Commit messages end with the `Co-Authored-By` line the harness specifies. Commit `package-lock.json` with dependency
  changes.
- Source files use CRLF line endings and `core.autocrlf=true`. `shared/src/physics.ts` has **mixed** endings (the fence
  block is LF): preserve them. When editing with Python on Windows, `open(p, encoding='utf-8').read()` then
  `open(p, 'w', encoding='utf-8').write()` keeps CRLF; never write with `newline=''`. Check `git diff --stat` against
  `git diff --ignore-cr-at-eol --stat` before committing, and `git ls-files --eol` after any shell edit.
- **Never use `sed -i` on repo files** (Git Bash's sed writes LF; it converted CRLF files three times). Use the Edit tool
  or a Python script. Write edit scripts to the scratchpad with the Write tool and run the file: inline heredocs fail to
  parse or mangle backslashes, and lines with backslash escapes (`\n` in template strings) are safest with the Edit tool.
- Follow long runs with a Monitor on the log (`tail -n +1 -f log | grep --line-buffered ... | awk '{print
  substr($0,1,280); fflush()}'`): `cut` at the end of the pipe, or a second `grep` without `--line-buffered`, buffers
  and delivers nothing. Stop old monitors, and re-arm one that expires (30 min) during a long run.
- **Server files may be edited while a test runs only if its agent server runs from a code snapshot** (the user's rule,
  relaxed on 2026-10-16): `reset_site.py` starts the test agent server from one (`scripts/snapshot_code.py`, under
  `runs/code/`; `MCAI_CODE_SNAPSHOT=0` runs the working tree). Never while an agent server runs from the working tree (the
  main world's step 3 above, unless started from a snapshot with `MCAI_ROOT` set to the repo).
- **Auto mode's classifier** blocks `git push`, Agent calls with `isolation: "worktree"` and edits to Claude's own
  settings. Do not work around it: ask the user to switch out of auto mode or to request the action explicitly.
- **Two Claude sessions at once** (the user runs them): one test world means one session runs tests on it at a time
  (check `python scripts/stack.py status` and the agent count before resetting a site); the other works offline (specs,
  analysis, code, benches). Only the session the user names writes PLAN.md's handover and closes the session record; the
  other leaves its notes in `runs/<date>/<session>/` for it. Logs append-only (FINDINGS, RUNS, DECISIONS) can take entries
  from both: re-read the end of the file right before adding to it.
- **Start sessions on the main checkout** (`D:\Projects\MCAISandbox`), never in a worktree (no worlds, run logs or
  `node_modules` there, and the desktop app refused its edits to the main checkout).
- Write prose (README, comments) plainly; match the surrounding comment density. Run logs go in `runs/<date>/`
  (gitignored).

## Models

- **Every role defaults to `ollama:gpt-oss:120b-cloud`** (the user's decision, A.0): mayor, architect, workers' planner
  and executors, through the Ollama app at 11434 (the user's paid subscription; Ollama Cloud Pro runs 3 requests at once).
  gpt-oss ignores `think:false`, so each call kind has a reasoning level (`MC_REASONING`). The hourly budget pauses cloud
  calls when spent; a 429 or 5xx hands a task back instead of failing it.
- Local models are the fallback (`MCAI_EXEC_MODEL=ollama:qwen3:30b-instruct`, workers' planner `ollama:qwen3.8:27b`) on
  their own pinned servers (`scripts/ollama_exec.py start|stop|status`, ports 11435/11436, two RTX 3090s). Run `status`
  before a local run series: a model spilled into system RAM (it can be reported as fully in VRAM) means stop and start.
  Keep `num_ctx` at 8192. Pull models through the API, not the CLI (the CLI launches and may update the app).
- **Every model call is recorded** (`runs/model-calls/<date>-<pid>.jsonl`; `MC_MODEL_RECORD=0` off) and a run can be
  replayed without the models: start the agent server with `MC_MODEL_REPLAY=<that file>` and each call is answered from
  it at once, free, matched by agent, call kind and number (`MC_MODEL_REPLAY_MODE=exact`: only word-for-word prompts);
  `[replay]` lines say where prompts began to differ. Use it to check a fix against a model-driven run's decisions.
- Benches on the real prompts (`scripts/bench/`): `mayorbench.mts` after changing the mayor's prompt or tools,
  `designbench.mts`, `choicebench.mts`, `execbench.mts`, `planbench.mts`; `PEEK=1` prints raw tool calls (look at them
  before judging a model). Claude API calls are billed separately from the user's Claude subscription.

## Agent architecture (server/src)

- `world.ts`: the world interface. `WorldAgent` and `WorldAdapter`, plus `AgentBrain`, the event, observation and tool
  types. `tieredBrain.ts`, `llmBrain.ts`, `village.ts` and `designs.ts` depend only on it (and on each other), never on
  `agents.ts`. Events: `chat` `{from, text}`, `action_done` `{type}`, `action_failed` `{type, args, message}` (the loop
  guard keys on type + args).
- `skills.ts`: `TOOLS`, the skill definitions shared by both LLM brains; keep skill names and arguments identical
  across worlds.
- `tieredBrain.ts`: planner + executor brain (`<provider>:<model>` per agent), village roles (mayor, worker), design
  drawing, loop guards. `taskBrain.ts`: the scripted worker for staged tests (runs the skill calls a task spells out).
- `village.ts`: the village registry (plots, structures, designs, task board, reservations), saved to disk.
  `layout.ts` (`plan_layout`), `streetPlan.ts` (street and green plans, lamps, signs, farms), `huts.ts` (storage and
  mining huts), `designs.ts`, `buildingGen.ts` (the building generator), `vanillaPieces.ts` / `vanillaData.ts` (pieces
  and data from the Minecraft jar).
- After completion: `choose.ts` (the chore menu), `grow.ts` (neighbourhoods until a house per member), `appetite.ts`
  (food).
- `mineflayer/`: the real-Minecraft world. `index.ts` (agent server on 8766), `mcWorld.ts` (`MineflayerWorld`: the
  WorldAdapter, spawns, chores), `botAgent.ts` (`BotAgent`), `mcSkills.ts` (skill registry), `mcSurvival.ts` (collect,
  craft, smelt...), `mcBuild.ts` (find_site, prepare_site, builds by command charged to the inventory), `mcStorage.ts`,
  `mcMine.ts`, `mcMaterials.ts` (bills, recipe chains), `mcWorkshop.ts`, `mcAtlas.ts` / `mcSiteAtlas.ts`, `mcBlocks.ts`
  (block sets from the jar's tags), `mcRules.ts` (peaceful world settings), `mcUtil.ts` (walks, `nearestBlocks`),
  `mcRescue.ts`, `mcApi.ts`, `rcon.ts`.
- The sandbox: `agents.ts` (`Agent`, `AgentManager`, its skills, building engine and REST API), `brains.ts`,
  `schematic.ts` + `nbt.ts`, `llmBrain.ts` (the Claude brain). The control panel: `server/panel/index.html` (no build
  step) and `server/src/panel.ts`.
- The world is peaceful survival (the user's base assumption): no hostile mobs or damage; agents gather and craft
  materials, deposit them in shared storage, and build by `/setblock`/`/fill` charged to the builder's inventory.

## Testing agents

- **Test up the ladder** (PLAN.md): typecheck, the targeted check, a staged run, a bench if a prompt changed, then one
  model-driven run. Most bugs show in a staged run or a check; read logs for failures, loops and duplicate work, not
  only the outcome.
- **Staged runs** (scripted workers, no models): `python scripts/stage_village.py VILLAGE X Z [--stage full|build]`
  (or `--site SITE` on the test world; `--stage build` ~1 min, full ~6-9 min at 2x). After completion: `--mayor --after
  MINUTES`, with `--fixtures`, `--stock item:N,...`, `--choose`. `scripts/stage_runs.py` runs several in a row with a
  reset before each (detach it and arm a watcher). Flags and their uses: RUNBOOK.
- **Test the after phase from a checkpoint**, not by building the village again: once a staged village is complete,
  `reset_site.py SITE --save CP` (seconds); then for each test `reset_site.py SITE --checkpoint CP` and `stage_village.py
  VILLAGE ... --resume --mayor --after MINUTES` (the after phase starts at once). `reset_site.py --list` shows them; save
  with the agent server's `MC_GROW=0` so no growth layout is under way.
- **Run series from a spec, not a new driver per session**: `python scripts/run_series.py SPEC.json [RUN ...] --detach`
  resets (snapshot or checkpoint), runs stage_village.py, saves checkpoints, runs checks (`make_log`, `agent_log`) and
  prints the key lines and a table, ending "ALL DONE"; `--detach` prints the watcher to arm, `--dry-run` the commands.
  The spec format is in its docstring; `scripts/series/example.json` saves a base village and tests growth off and on.
  `python scripts/run_report.py DIR/NAME [...]` puts runs side by side (completion, failures, busy, mine, growth, food,
  cost, the agent log's warning counts): read it before reading a log. `--after-until grow` ends a growth test once the
  growth is done (`idle:N` rarely holds: workshop and light chores keep members busy).
- **Checks** (`scripts/checks/`, about 50): run the one for the area you changed (`site.py` for find_site and
  prepare_site, `mine.py` for the mine, `fell_trees.py` for felling, `scale_probe25.py` at 25 bots, the golden checks
  `board_golden.mts` and `choice_golden.mts` before a refactor...). Offline ones read the region files or replay data (`region_blocks.py`, `top_map.py`,
  `at_goal.mts`, `pf_share.mts`). The catalogue is in RUNBOOK; write a new check with any new skill that digs or
  places.
- **Agent names are fixed** (the user finds them by name): **Gus** for single-agent tests (spawned in no village),
  **Mayor, Worker1, Worker2** for villages (2 workers), Worker3-24 for scale runs. Spawn test agents with
  `"reset": true` (a name keeps its inventory and position). If SausageOfDoom4 is online, the watch scripts teleport them
  to the Mayor. For one skill: an `idle` agent and `/api/agents/:name/act`.
- **Count the walk-stall lines in every run**: `[stuck]` (read it before changing a walk, lesson 78), `[repath]`,
  `[stuck-world]`, `[dig]`. Also `[lag]`, `[grow]`, `[food]`, `[mine]`.
- The user prefers fast iterations: early stops, `buildSpeed: 4`, background runs with a notification, no fixed long
  waits.

## Lessons that bite most often

The full list, with the stories behind them, is in `docs/LESSONS.md`; numbers below refer to its adapter list
("s" = the sandbox list).

- **Models decide; code does arithmetic, geometry and anything it can spell out exactly** (s1, 18, 56). Failure
  messages and choice facts are the model's eyes: say what is short and what to do next (s2, 127).
- **Mineflayer's view is not the server's.** Count items on the server (`clear <name> <item> 0`), confirm placed and dug
  blocks with `execute if block` (4, 13, 29, 80). Silent set-backs mean a box overlap (79).
- **One event loop serves every bot.** Never call `bot.findBlocks` (use `nearestBlocks`), filter inside searches, and
  profile at scale: no `[lag]` line does not mean an idle loop (16, 49, 53, 125).
- **Code handed to a library must accept anything it can pass** (stubs, nulls): an exception inside the pathfinder's
  tick took the whole server down (104). The pathfinder digs natural ground on its way unless protected (31, 35).
- **Protection rules**: keep off every village's work, not only the agent's own (30), and check rules in y as well as x
  and z (102). Commands place blocks into players (44); spawn on ground read from the world (37).
- **Paper times digs by the wall clock**: never shorten `digTime` (40).
- **Add behaviour beside the brain's state, not inside it**; after-completion work is a chore beside the board (66, 93).
- **Measure before building**: count what the land holds and test a game mechanic live (99, 113, 135); count the work a
  mechanism can give idle agents over time, not its peak (129, 130, 136).
- **Make a staged test reproduce the condition the fix is for** (95); a repeated stall in one place across runs is a
  fixture's fault first (133); reproduce live before trusting an offline replay (77).
- **Judge a job by the cells it was meant to change**, not by the stock that should have made it (138).
- **Rebuild a failing model call from the run's own log before benchmarking it** (85); wake-up reasons are followed
  literally (86); judge prompt changes on more than three samples (20).
- **Method for bigger steps**: spec, adversarial check, implement, lens reviews and a refuter, then test (124); a golden
  check before a refactor; one implementer plus one review for small steps.
