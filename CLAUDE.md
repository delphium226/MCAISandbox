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
- To watch in the game: open http://localhost:5173, `/gamemode spectator`, `/tp <agent>`.
- `GET /api/block?x=&y=&z=` inspects the world; `loaded: false` means the chunk is not loaded (unloaded blocks used to read
  as air, which caused false conclusions).

## Conventions

- Work on the feature branch `tiered-brain-building` (see below); commit only when asked or clearly agreed. Commit
  messages end with the `Co-Authored-By` line the harness specifies.
- `package-lock.json` was already modified before this work started: leave it out of commits.
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

- `agents.ts`: `Agent` (body, skill queue, events, memory), all skills, the building engine (`BuildJob`: reach-first
  work order, commits to its walk target, reserves village ground, `buildSpeed` pacing, tree felling, creative direct
  placement), `find_site` / `prepare_site` / `build` / `build_box` / `build_design`, Navigator (A*, opens doors, digs out
  in creative through natural blocks only), and the REST API (`AgentManager.handleApi`).
- `tieredBrain.ts`: planner + executor brain on Ollama or Claude (`<provider>:<model>`, per agent via memory
  `execModel` / `planModel` / `designModel`), village roles (mayor, worker), design drawing, loop guards, stats.
- `village.ts`: shared village registry (plots, structures, design library, task board, reservations), saved to disk.
- `designs.ts`: design format (spaced symbol layers + palette), validation, automatic door fixing, the architect prompt.
- `schematic.ts` + `nbt.ts`: import `.schem` / `.schematic` / `.litematic` / `.nbt` as designs, with block mapping.
- `llmBrain.ts`: the Claude brain and `TOOLS`, the skill tool list shared by both LLM brains.

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
- For a single skill, spawn an `idle` agent in creative mode and queue actions with `/api/agents/:name/act`; check
  results with the events stream and `/api/block`.

## State of the work

Branch `tiered-brain-building`, not merged or pushed (`main` is unchanged):
1. `182a934` two-tier brain, building skills, door and pathfinding fixes
2. `8c79b1f` villages: registry, model-designed buildings, mayor and workers
3. `c661150` village robustness (fast worker planning, walls, stuck tasks, site search)
4. `570778d` schematic import
5. documentation and test scripts (this file, README, `scripts/`)

Backlog: `plan_layout` for the mayor; import a real downloaded schematic (only generated test files so far); stairs and
fence collision; survival-mode building (gather materials, then build).

## Next step: run the same agents in real Minecraft

Agreed plan (for a new session):
1. Extract a small **world adapter** interface from `Agent` (observe, queue/stop skills, event stream, memory, village)
   so `tieredBrain.ts`, `village.ts` and `designs.ts` depend only on it. Keep this sandbox as the first adapter: it is
   fast, controllable and good for tests.
2. Build a **Mineflayer adapter** against a local Paper/vanilla Java server (offline mode, private machine only; pick a
   Minecraft version Mineflayer supports). Skills map to mineflayer-pathfinder (walks, opens doors, digs, scaffolds),
   collectblock, pvp and bot.craft; building either places blocks one by one or uses operator commands (`/fill`,
   `/setblock`, WorldEdit) for creative-style speed; schematics load natively (prismarine-schematic), so no block mapping.
3. Mindcraft (open source, LLM agents on Mineflayer) is a useful reference for the skills layer.
