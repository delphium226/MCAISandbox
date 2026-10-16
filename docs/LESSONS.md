# Lessons

What earlier sessions learned, moved verbatim from CLAUDE.md on 2026-10-15. Two numbered lists, kept apart so that
references elsewhere ("lesson 32", "lesson 5") still point at the same entry: the first eleven are from building
the agents in the sandbox, the long list from the real-Minecraft adapter and every session since (most references
mean that one). Add new lessons at the end of the second list.

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
   raw tool calls; `THINK=false|low|medium|high`, gpt-oss defaulting to the brain's level per call kind; `N=` samples;
   the benches follow `MC_OLLAMA_ROUTES`; `concurrency.mts [model] [N] [ROUNDS]` times N calls at once against one
   alone; `scripts/checks/model_usage.mts` checks the usage ledger offline). Look at the raw tool calls before
   judging: most "failures" of new models were format quirks.
   Results so far: gemma4:31b 10 tok/s but reliable designs; qwen3.8:27b 20 tok/s, best worker plans, designs need a
   retry; qwen3:30b fastest and fine as executor, poor designs and loose plans; gpt-oss:120b-cloud fastest planner and
   architect (~3.5 s / ~9 s).
11. **Model output needs normalising in code**, differently per model: qwen3.8 sent design layers as a JSON string
   without its outer brackets; gpt-oss wrote tasks as skill calls (`{task: "build_design", name, x, z}`) and plan steps
   as objects. `normalizeLayers`, `postedTasks` and `stepText` handle these; check a new model's raw tool calls first
   (the benchmark scripts in the scratchpad did: raw `/api/chat` with the real prompts and tools).

## Lessons from the adapter (real Minecraft)

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
109. **Ask what a command can do before making the bot do it** (F202, 2026-10-09): feeding by `activateEntity` worked live,
   but Mineflayer's entities carry no Age, so the bot fed a chick the seed meant for an adult; `execute as @e[...,nbt=
   {Age:0},limit=2] run data merge entity @s {InLove:600}` breeds exactly the two ready adults. Breeding, milking and eggs
   run by command from the cell beyond the gate, charged to the inventory, as crafting and building already do.
110. **A new kind of animal is a new geometry: test each live** (F203): chickens (0.4 wide) walk through a 1-wide open gate
   behind the bot; two cows (0.9) jammed in the gate cell and never came in. The lure ends by teleporting animals stuck at
   the gate into the pen.
111. **Measure idle time before adding work, and lock what waits in the queue** (F193): one AFTER line of busy minutes per
   agent showed Worker2 and the Mayor at 0 of 12 minutes. The skills' own locks are taken only when an action runs, so
   per-agent chores carry a key each that covers the time a chore waits in the queue; a stopped agent's statuses fail at
   once while its skill's finally still runs, so an ended chore's key and agent are held 10 s.
112. **What `deposit all` skips leaks out of the village** (F207): buckets are tools and eggs junk, so a chore stopped after
   a withdraw left them with a worker; storage, by which the milking and the cake are judged, never saw them again, and
   the iron age set out to make a bucket while three were stocked. Chores deposit such items by name at their start and
   end, and checks count what the village holds, not only what code recorded making.
113. **Measure the land and the animals before widening a rule** (F205, 2026-10-10): an offline 3D walk search on the
   snapshot (`runs/2026-10-10/research/f205_scan/`) and live slope tests (`slope_facts.py`) showed animals follow a lure
   down any 1-high slope and find a side stair, and stop only at a sheer drop (a mob path drops at most ~3): the height
   band, not the lure, was the block. A rule written from one bad case (F194's hill) had shut out every chicken and cow
   on VanG's land.
114. **A watchdog that counts any movement as progress is blind to bobbing** (F209): in water a bot drifting in a
   1.5-block cell reset the 10 s stall rule for 45-140 s a walk. Use a coarser threshold where the body moves without
   travelling, and make a goal's range match the rule that judges success (range 8 against "scouted within 12" spent
   minutes on the last 2 blocks to a lake floor).
115. **A reset rewrites the atlas without a backup** (2026-10-10): `reset_site.py` drops the chunk summaries (and the
   animal sightings) of the restored regions. Copy what a run saw before resetting when an analysis needs it.
116. **Check a tag's members before keying a rule on it** (F212): 26.1's `#minecraft:dirt` does not hold `grass_block`.
117. **Preview a UI against live data, and look at it after applying** (the panel, 2026-10-10): a scratch copy served by
   `runs/2026-10-10/scripts/panel_proxy.py` with headless Edge screenshots caught a collapsed overlay, stretched cards and
   tabs that jumped to the top each second (a page re-rendered every second must keep scroll and focus); a dropped space
   (`<istyle=`) went unseen until the next screenshot (F215).
118. **gpt-oss ignores `think: false` and the cloud ignores `num_ctx`** (A.0, 2026-10-10): a one-line test gave 69 output
   tokens at false, 51 at "medium", 20 at "low", so the Mayor had reasoned at medium all along; an 18,292-token prompt was
   read whole at num_ctx 8192. Set a level per call kind and judge it on the benches: low executors missed "step already
   done" 10 times in 10, a medium mayor re-posted work instead of waiting (`runs/2026-10-10/s26/bench/`).
119. **Ollama Cloud Pro runs 3 requests at once** (A.0b): the rest queue (a fixed, unpublished queue size; beyond it they
   are rejected), which the concurrency bench showed as throughput levelling at ~2.5-3 with 6-12 calls at once. Max and
   Team allow 10. Call models at decision points, not on timers, and gate them (E.0's call gate).
120. **More agents do not speed a serial chain: measure the chain first** (S.0, 2026-10-10): 12 agents built the village in
   6.1 min and 3 in 6.0 (Van12a/Van3a). Busy minutes per agent and a critical path read from the board's stamps
   (`stage_village.py`'s BUSY and CRITICAL PATH lines) named the chain; `[mine]`, `[pickaxe]`, `[furnace]` lines named
   the waits (miners queued 35-85 s for 3 faces; pickaxes took the builds' cobblestone).
121. **Shared things need supplies, reservations or instances as agents multiply** (S.1-S.6): pickaxes from a stored
   supply and only from spare storage, glass made once for the village, the mine's branches as units with a claim gate,
   chest spots claimed before walking, stations placed early, the plot in parts with disjoint claims, one level, tree
   ownership and a seam check. Each was checked offline first (`mine_geometry.mts`, `huts_box.mts`); 12 agents 6.2 -> 3.1.
122. **A detached run does not wake the session** (2026-10-11): `scripts/detach.py` runs outlive the session but send no
   notification, and the session sat idle twice for 4-5 hours after runs ended. Arm a Bash `run_in_background` watcher
   (`until grep -q "ALL DONE" LOG; do sleep 15; done`) with every detached run. Detach a Python script, not a shell
   script: `bash` there is WSL's, which has no `/c/` paths (`runs/2026-10-10/s26/baselines_s0.py` runs staged runs in a row).
123. **Before 25 agents** (E.1's spec; all done in E.1, 2026-10-11): Paper's `max-players` was 16 (now 30); each name must
   be whitelisted (Worker1-24 now in both worlds); the panel's name-hash colours collided for 7 pairs among Mayor and
   Worker1-24 (now by number); `/api/overview` would have been ~1-1.5 MB every 2 s with model prompts at 25 (now ~120 KB).
124. **Spec, check, implement, review, refute, then test** (the twenty-sixth session's method): read-only spec agents with an
   adversarial check found real problems in every spec, and three or four lens reviewers plus a refuting pass found 7-12
   real defects in every implementation before a run; only one implementer edits a file set at a time, and nothing edits
   server files while a run goes. Heavy for small steps: one implementer plus one review is enough there.
125. **No `[lag]` line does not mean an idle loop: profile at scale** (F219, 2026-10-11): at 25 bots the agent server was 98%
   busy with no stall over 2 s, so every RCON reply and API answer waited a slow turn (RCON 649 ms). A 40 s CPU profile
   through the inspector (`scripts/checks/cdp_profile.cjs` WS SECONDS OUT, `profile_callers.cjs` OUT for time by our
   calling function) named one function with 60%: find_site's surface read building a Block per cell. `/api/perf`'s
   loop p99 is the number to watch; the 25-bot probe (`scripts/checks/scale_probe25.py`) is the load.
126. **A budget shared between bots must leave small villages alone** (E.1's reviews): a pathfinder allowance of 20 ms a
   50 ms window cut walks with only two bots searching (each asks 15 ms a tick), and counting compute time made the
   rescue's 5 s search take 15 s. Check a shared limit against the real per-bot numbers at 1-3 agents, not made-up ones
   (the first check used 4-8 ms budgets and passed); up to 3 searches are now never cut (`MC_PF_FREE_SEARCHES`).
127. **Facts are the model's eyes for choices too** (A.2, 2026-10-13): with effects that said only what a chore makes ("a
   bucket", "+1 cake"), gpt-oss went to a dull scout or a 1-ripe harvest in 6-7 of 10 labelled cases; with effects that
   say what it is for ("the penned cows can be milked only with buckets"), 10 of 10. Lesson 2 for menus: fix the facts
   code writes before the prompt, and judge on a bench of labelled cases (`scripts/bench/choicebench.mts`).
128. **One storage number cannot judge a brain** (F223): four fixed-order staged runs with identical settings ended at
   397-701, and scouting adds nothing to storage while an iron trip adds ~90 items. Before comparing two brains, measure
   the spread of identical runs and check the measure sees what each choice is for.
129. **Count the work before building the chooser** (A2f, A2m): a menu at 25 agents still left ~2% of agent-time busy, and
   a rule from one agent's days (scouting only while a farm slot is free) emptied every menu; the golden check could not
   see it (it compares against today's behaviour). Check what fraction of idle agents a new mechanism can occupy, offline,
   before the run that measures it.
130. **Work bounded by stock targets peaks and stops; count the consumers, not only the producers** (S.9, 2026-10-14/15):
   the offline count said `make` alone would take after-completion busy time at 25 from ~2% to ~2.3%, and with gathering
   the run gave 4% (S9f: 23 agents took a chore, a peak of 9 at minute ~1, then nothing once every target was met). A good
   nothing uses up is made once. Work recurs only where something drains the stock (B.4's torches) or grows (the mine).
131. **A block set by command on a bad support stays** (B.4's live facts, `runs/2026-10-15/b4_facts.log`): a wall torch
   `/setblock` on leaves, a pane, a fence or a slab floats until a later update from the support's side, so a server
   re-check after placing cannot catch a bad support. Judge the support in code before setting, by a rule measured live
   (full cubes incl. glass, double slabs, stairs facing the torch's way).
132. **A ledger check must know every flow of the good, or it cries wolf** (S9f, S9m): planks sawn from withdrawn logs came
   back beyond the planks taken, and another agent's torch make took charcoal while a charcoal make deposited; both read
   as mismatches though the makes were exact. Before trusting a MISMATCH, read the make's own line: the rule may lack a
   conversion, another chore's take, or a put-back.
133. **Fixtures that cannot be reached stall every run the same way** (F227): the staged runs' fixture pumpkins at y 73-80
   above the site gave a worker 2-3 `[stuck]` lines (GoalLookAtBlock, ~11 s each) in S9s1, S9f, S9m and B4s1 alike. A
   repeated stall in the same place across runs is a test fixture's fault before it is the code's.

134. **Judge arrival the way the pathfinder judges its start** (F218, 2026-10-15): on a block lower than a full one (a
   dirt_path's 15/16, farmland, a slab) mineflayer-pathfinder starts its search from the cell above the floored feet, so a
   GoalNear that accepts that cell resolves `goto` at once, and a check on the floored feet alone called it "no path" in
   every model-driven run at ~4.7 min for weeks. `atGoal` (mcUtil.ts) mirrors the start-node rule; an offline check on the
   run's exact numbers (`scripts/checks/at_goal.mts`) reproduced it before any live run.
135. **Measure a game mechanic's numbers live before designing on it** (the hunger facts, 2026-10-15): modern Java charges
   no exhaustion for walking (sprinting, jumping, swimming, mining and healing do), and 26.1 registered no sprint from the
   bots: ~1,850 blocks walked on easy cost nothing. Vanilla hunger would have given the fields no consumer; the village
   appetite is code's. And crops grow only while their chunk's centre is within ~115 blocks of a player or bot (a circle,
   not the 6-chunk square: a diagonal case decided it). Test geometry on the diagonal too.
136. **Work that ends by design must be counted over time** (the growth count): one extra batch of houses added ~2% busy
   time at 25, continuous growth tied to population ~16% until a house per member, then nothing. Count the steady state a
   mechanism leaves, not only its peak (lesson 130 again): what recurs is what drains (food) or grows without end.
137. **A port is not owned by whoever bound it first** (2026-10-15): another program bound 127.0.0.1:8767 mid-run while the
   agent server listened on 0.0.0.0:8767; every request to 127.0.0.1 went to it (`{"detail":"Not Found"}`, a FastAPI
   answer) and the watcher died with a 404. A more specific bind wins. Never kill by port alone (reset_site.py now kills
   only node listeners); move the test port (`MCAI_TEST_API_PORT`) instead.
138. **Judge a job by its result cells, not by the stock that should have made it** (the half-sown field, s30's food
   review): a pen lure borrowed 8 of a field's 16 seeds from storage and put them back mid-planting, so the planting sowed
   8, its requeue check saw 16 seeds counted and closed the task done, and nothing ever sowed the bare cells. Rescan what
   was supposed to change; keep shared stock an open task needs out of other chores' reach.
139. **A per-option ban must not apply to an option whose refusal blocks everything else** (the food fix review): eating
   failed three times would ban `eat` village-wide for an hour while the claim gate refused a peckish member every task
   until it ate. Exempt such options from bans and cooldowns, and make "nothing left" a contention code, not a failure.
140. **Check the path the feature takes, not the helper it should call** (s33, A.3p): the weighted `fixedPick` passed its
   unit checks and the golden's invariants, but the fixed sweep took `menu.options[0]` and never called it, so the first
   A/B's "on" arm ran without temperaments. A one-line probe of the real path (how often the pick left the lowest rank:
   0 of 136) would have shown it; the review found it independently. Count the effect in the run before reading it.
141. **Preferences do nothing where work is scarce** (s33, F232): with 25 members 6% busy and 70% of menus offering one
   or two kinds, chore weights barely separated agents; whoever came first in the sweep took each chore. Divergence came
   from the response threshold (likers first, a disliked chore left 90 s), and lasting variety needs more kinds of work
   on offer (Phase X).
142. **A status-quo shortcut breaks when "current" moves** (s33, F235): "if the vote's winner is the current style, pick
   as before" drew the village's original library, so a won "current" savanna built plains houses every other vote. When
   a decision exists, apply it the same way every time; keep the old path only for "no decision".
