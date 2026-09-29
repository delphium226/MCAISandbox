# Implementation plan

The working plan for the real-Minecraft village agents, carried across coding sessions. CLAUDE.md says how to run
and test things and what earlier sessions learned; this file says **what to do next, why, and how we know it is
done**. It changes as we learn: see "Keeping this plan honest" at the end.

## How to use this plan in a session

1. **Start:** read CLAUDE.md, then this file's "Next session starts with" and the current phase. Bring the stack up
   (CLAUDE.md, "Running and checking"). Check `git status` for uncommitted work left from the last session.
2. **Pick one step** (or a few small ones). Work only on that; note anything else you find in the findings log below,
   not in code.
3. **Test up the ladder** (cheapest first, stop at the first failure): typecheck → targeted test of the change →
   staged run (`scripts/stage_village.py`, scripted workers) → benchmark if a prompt changed (`scripts/bench/`) →
   model-driven village run (`scripts/watch_village.py`). Never edit server files while a run is going.
4. **Record:** tick the step, add a row to the run record, add findings and decisions with the date.
5. **Commit** the tested step (CRLF preserved; `git diff --stat` vs `git diff --ignore-cr-at-eol --stat`). Ask the
   user before pushing.
6. **End:** rewrite "Next session starts with" so the next session can begin without this one's context.

## Next session starts with

(written 2026-09-29 at the end of the third reliability session)

- **Code:** all committed on `tiered-brain-building`, nothing pushed (ask first); the last commits are `212a190`
  (village spawns at the site; timed-out walks count as stuck) and the docs commit with this handover. Working tree
  clean except the gitignored `runs/`.
- **Running when this session ended:** Paper, the Ollama app, both pinned model servers (both on their own cards:
  `python scripts/ollama_exec.py status` now warns when a card does not hold its model) and the agent server (log
  `runs/2026-09-28/agentserver-s3p.log`). No agents in the world. The servers were started as background tasks of the
  Claude session: a session restart can stop them (it stopped a watcher once).
- **Step 1.5 (acceptance):** gpt-oss workers' planner: Accept9, 10, 11 passed in a row. qwen3.8:27b: Accept15 and
  Accept18 passed; Accept12-14, 16, 17 failed on code bugs, each fixed (F45-F51). **The workers' planner was never
  called in any of these runs** (`plan 0x0ms`: code-posted tasks run as written), so the model comparison the step
  asked for says nothing about planners (F52). Only Accept18 ran on the final code; the user counted 1.5 as passed.
- **Next:** 1.6 docs (CLAUDE.md lessons of this phase, README, ARCHITECTURE.md), then phase 2. Open small items:
  village log lines in plain words, F44 (synchronous scans, 2-3 s stalls),
  F20 (deposits counted on the bot's view), collect failures on logs high on hills (the commonest failure left: 9-23
  per run in hilly or jungle-edged woods).
- Run logs: `runs/2026-09-28/` (accept1-18, tight1, s2-*/s3-* targeted tests, agentserver-*.log).
- **The user's standing preferences** (also in Claude's memory): teleport SausageOfDoom4 to the Mayor at the start
  of every run when online; agent names Gus, Mayor, Worker1-4; commit tested batches, ask before pushing; never edit
  server files while a run is going (draft edits in the scratchpad and apply them between runs).

## Phase 1: reliability of the survival village (in progress)

Goal (the user's): "two matching cottages and a meeting hall" succeeds from nothing 2-3 times in a row with no
restarts or manual help. Standard setup: Mayor + Worker1, Worker2; mayor and architect gpt-oss:120b-cloud,
executors qwen3:30b-instruct; workers' planner gpt-oss while iterating, qwen3.8:27b for the final runs.

- [x] 1.0 Material estimate, collect fails fast, stuck rescue, quiet mayor (`19b9b47`; see findings F1-F9).
- [x] 1.1 Fixes from the 4-worker runs (`b7908db`, partly tested; see the handover): code-posted steps run as written;
      gather tasks covered by storage are marked done; ungatherable soft tasks fail at once; completion declared by
      code when the mayor waits with everything built; dig retry; pickaxe fixes; rescue only when the failed action
      got nowhere; pathfinder CPU limits; `collect` avoids plots and water.
- [x] 1.2 **A site that fits** (F19, F21, F24-F25). `find_site` checks every centre on a height grid built once
      (prefix sums, sliding min/max), allows a height range of 4 before shrinking (prepare_site levels it), widens to
      112 blocks, then walks up to 2 legs of 40 blocks toward dry land, never leaving 96 blocks of the village.
      `plan_layout` tries narrow streets (2, margin 1), then lays out the largest set that fits when at least half do
      (the rest in `v.unplaced`, shown in the village summary); fewer than half is refused with the size the whole
      village needs. When the mayor's next `find_site` succeeds, code lays out the unplaced buildings there (the model
      managed it 1-2 times in 10). Laid-out plots (`v.layouts`) are kept off by site searches and later layouts;
      completion waits for unplaced buildings. The mayor's `move_to`/`explore` beyond 96 blocks of home (first plot,
      storage, or where it started: `memory.origin`) is refused or shortened. The architect's brief carries the site's
      room. Tested: find_site at Fourfold7's spot, from open water and forced legs; layouts on 12/14/9-block sites
      through the API; mayorbench; Tightfit1 (below).
- [x] 1.3 **Slow mayor start** (F29). Fourfold7's mayor answered its first plan with an empty (waiting) plan, which
      was accepted silently; with nothing laid out only the 3-minute stall review woke it. Now a mayor with nothing
      laid out that returns no steps gets `find_site` added by code (without a site) or is asked again after 10 s
      (with one), and every mayor wait is logged. Accept1: first plan at 0.1 min, layout at 1.7 min.
- [x] 1.4 Small items (the user confirmed the panel's simple mode reads well, 09-29). Done: `advance_time false` in `mcRules.ts` WORLD_RULES (11 rules checked at start, "always
      day" in the summary); `explore` walks to an x/z goal (F23: the estimated y made it report "no path ... stopped
      at" the spot it reached). Moved to the backlog: village log lines in plain words for the panel.
- [x] 1.5 **Acceptance runs**, counted as passed by the user on 09-29 (gpt-oss: Accept9-11 passed in a row; qwen3.8: Accept15 and Accept18 passed, with
      five failed runs between them, each on a code bug since fixed; see the handover): 3 model-driven runs in a row, 2 workers, gpt-oss worker planner, all three buildings
      built and the village declared complete, no manual help. Then 2 runs with qwen3.8:27b as the workers' planner.
      Record each in the run record.
- [ ] 1.6 Docs: CLAUDE.md (lessons of this phase, LAN access, `MC_API_HOST`, whitelist: new agent names must be
      whitelisted), README, ARCHITECTURE.md (run-as-written, rescue, atlas when it exists).

## Phase 2: shared village atlas (agreed 2026-09-28)

Idea (the user's): agents share a map of what they have seen, so they find resources others located and help find
sites. Code keeps and uses the atlas; models do not read it raw.

- [ ] 2.1 **Record**: as bots move, summarise each chunk they have loaded (surface height and flatness, water,
      reachable logs by kind, exposed sand, stone, clay) with a timestamp, in the village registry (saved to disk).
      Show it on the panel as one village map (simple mode too). Test: walk Gus around, check the saved summary
      against `/api/block`; measure the cost per chunk (target well under 1 ms; CPU is shared by all bots).
- [ ] 2.2 **Gather from it**: `collect` with nothing in view goes to the nearest atlas entry for the material
      (and fails fast if it is gone, updating the atlas). Test: staged full run on a site with sand out of view.
- [ ] 2.3 **Sites from it**: `find_site` scores candidates over the atlas: level, dry, and trees, stone and sand
      within reach. Test: staged runs in the places that went wrong (jungle hills at -560,-60; lake at -235,-53).
- [ ] 2.4 **Scouting**: when the site search finds nothing good, code posts "scout" tasks for idle workers in
      different directions (run as written, no model calls) while the mayor draws designs. Test: model-driven run
      from a poor start point.

## Phase 3: humans in the loop (part 2 of the user's goal)

The user asks the mayor in chat ("build me a house by the river", "we need a bigger hall"); the village designs,
lays out, gathers and builds it, and the mayor answers in chat.

- [ ] 3.1 **Talking to the mayor in tests**: an API route that posts a player's message as chat the mayor hears
      (`POST /api/village/:v/say {from, text}`), or a real player message over RCON if one can be made to arrive as
      chat. Keep the 30 s chat limit and keep workers out of it (only the mayor answers players).
- [ ] 3.2 **The mayor hears requests**: player chat naming the mayor or the village wakes its planner (today chat
      only wakes the executor) with the request as a new objective or an addition to the current one.
- [ ] 3.3 **Code places it**: "by the river", "next to the hall", "here" become a site search near a place (atlas:
      water, forest), a building, or the player's position; a second plot when the first is full.
- [ ] 3.4 **Code checks it can be built**: materials within reach (atlas), unobtainable blocks refused, rough time
      estimate from the bill of materials.
- [ ] 3.5 **The mayor answers**: what it will build, where, and roughly how long, in one chat line.
- [ ] 3.6 mayorbench cases for chat requests; then runs with the user in the game.

## Phase 4: speed and scale

- [ ] 4.1 Gathering that finishes trees: fell a low tree completely rather than chasing canopy logs; choose trees by
      reachable logs.
- [ ] 4.2 The storage chest between the plot and the nearest trees and stone, not wherever the first deposit is.
- [ ] 4.3 More workers where gathering allows (4 workers only paid off with enough trees apart; see F12).
- [ ] 4.4 Executors on gpt-oss (benchmark with `scripts/bench/execbench.mts` first). Low value now: workers make
      few model calls since run-as-written.

## Backlog (not scheduled)

- Stairs and fence collision in the sandbox; a real downloaded schematic; `/save` API route.
- Events carry no timestamp (the panel cannot say "2 min ago").
- Two builders drawing on the chest at once still come up short now and then (the requeue recovers).
- Narrow the pre-existing Windows firewall rule for Node.js (any TCP, any address) to the local subnet.

## Run record

One row per model-driven or staged run worth remembering. Time is to the last building (or the stop).

| Date | Run | Setup | Result | Time | Notes |
|---|---|---|---|---|---|
| 09-27 | Meadowford2 | 2 workers, qwen3.8 planner | 3/3 built | 35.0 min | before this plan |
| 09-28 | StageW1 | staged build, 2 scripted workers, stock half acacia half spruce | 3/3 built | 2.5 min | parts split across kinds; 2 short starts from racing builders (F9) |
| 09-28 | rescue tests | Gus in a cobblestone box, a pit, a walled pool | box, pool rescued | 2-4 s | pit: pathfinder climbed out with dirt; found F3 |
| 09-28 | StageW2 | staged full, 2 scripted workers, testhut + testhall | 2/2 built | 11.1 min | 0 failures, one wood kind |
| 09-28 | StageW3 | staged full, 4 scripted workers | stopped | 8 min | 11 failures: shared trees, slow path searches (F11) |
| 09-28 | StageW4 | staged full, 4 scripted workers | 2/2 built | 10.4 min | trees shared: 4 workers barely faster (F12) |
| 09-28 | Fourfold1 | model, 4 workers | stopped | 16 min | executors faked gathering (F13) |
| 09-28 | Fourfold2 | model, 4 workers | stopped | 18 min | plot dug up by gatherers; hidden craft error (F15) |
| 09-28 | Fourfold3 | model, 4 workers | stopped | 11 min | jungle logs out of reach, sand under water |
| 09-28 | Fourfold4 | model, 4 workers | stopped | 7 min | agent server event loop saturated (F16) |
| 09-28 | Fourfold5 | model, 4 workers | **3/3 built** | 21.6 min | 6 failures, 11 executor calls; mayor never declared complete (fixed) |
| 09-28 | Fourfold6 | model, 4 workers | stopped | 17 min | hall built; cottages blocked by sand tasks (fixed) |
| 09-28 | Fourfold7 | model, 4 workers | stopped | 16 min | site too small; mayor wandered (step 1.2) |
| 09-28 | Tightfit1 | model, 2 workers, gpt-oss worker planner, Fourfold7's spot | **3/3 built**, mayor declared complete | 32.0 min | 11 failed actions (logs on hills, sand); 11x11 site, two cottages there, hall on a second site laid out by code; 3x3 cottages (F25) |
| 09-28 | Accept1 | model, 2 workers, gpt-oss worker planner, oak woods -335,-60 | **3/3 built**, declared complete by code | 10.6 min | 1 failed action; 13 trees felled on the plot (1200 blocks) supplied the wood; Worker1 made no executor calls |
| 09-28 | Accept2 | same, fresh woods near -367,-2 | **3/3 built**, declared complete by the mayor | 10.2 min | 2 failed actions (a stuck move; the hall short of a furnace, healed); hall windows left open (F32) |
| 09-28 | Accept3 | same, jungle near -448,7 | stopped (user's break) | ~10 min | nothing built; the hall's 81 sandstone given up at once, none within 96 blocks (F33) |
| 09-28 | Accept4 | fresh series after F32-F35 fixes, -235,163 | stopped at 18.9 min | 18.9 min | agent server froze 30+ s at ~16 min, Paper timed out all three bots at once (F37); nothing built |
| 09-28 | Accept5 | -410,164 | stalled at 17.3 min | 17.3 min | 11x11 and 13x13 designs, mossy cobblestone: workers sent 70 blocks down for moss (F38, F39) |
| 09-28 | Accept6 | -195,251 | stalled at 9.7 min | 9.7 min | the executor model had spilled into system RAM: 2.7 tok/s, one turn 187 s (F40) |
| 09-28 | Accept7 | desert -35,324 | stopped at ~18 min | 18 min | only buried wood near the site: storage chest never made (F41) |
| 09-28 | Accept8 | -262,125 | stopped at 21 min | 21 min | 1 log within 48 blocks; wood gave out, a worker chased logs 45 blocks down; plot margin dug out (F42) |
| 09-28 | Accept9 | oak woods -405,5 | **3/3 built**, declared complete by code | 14.6 min | 0 failed actions, no worker executor calls; one window short (fuel, F43) |
| 09-28 | Accept10 | woods -462,-183 | **3/3 built**, declared complete by the mayor | 25.2 min | 9 failed actions (logs out of reach near jungle); hall got 1 of 4 windows (F43, fixed after) |
| 09-28 | Accept11 | acacia woods -111,50 | **3/3 built**, declared complete by the mayor | 29.2 min | 3 failed actions; 7x7 and 9x9 designs (~530 blocks); every window glazed. **Accept9-11: three in a row with the gpt-oss worker planner** |
| 09-28 | Accept12 | qwen3.8 worker planner, -51,-315 | stopped at 16.4 min | 16.4 min | sandstone roofs needed 247, the area had ~66 (F45); leftover collects gave up log tasks (F46) |
| 09-28 | Accept13 | qwen3.8, -60,-170 | stopped at ~3 min | 3 min | wood check refused 115 of 131 logs; the mayor circled (F47) |
| 09-28 | Accept14 | qwen3.8, same site | stopped at 15 min | 15 min | a worker explored to 180 blocks from the village and gave up the board (F48) |
| 09-28 | Accept15 | qwen3.8, woods -590,-209 | **3/3 built**, declared complete by the mayor | 26.2 min | 23 failed actions (logs high on hills), every block placed, no wandering |
| 09-28 | Accept16 | qwen3.8, hills -519,-382 (y 101) | all 3 built at 37.6 min, not declared complete | 42.6 min | the mayor re-posted gathering, the completion check never ran (F49); no sand: windows open |
| 09-29 | Accept17 | qwen3.8, -330,150 | stalled at 8.2 min | 8.2 min | mayor spawned at the probe point 100 blocks from the site, stuck in a hollow; designs waited behind its walk (F50) |
| 09-29 | Accept18 | qwen3.8, -416,49 | **3/3 built**, declared complete by code | 39.2 min | 13 failed actions (Worker2's collects), every block placed; log roofs made gathering slow |

## Findings log

What runs showed, with the evidence, and what was done. Newest last. Keep entries short; move durable lessons to
CLAUDE.md when a phase ends.

- F1 (09-28) Builds came up short because gathering pooled wood kinds while builders put each part in one kind. Fix:
  one village wood kind (only when enough grows near the site), parts split across kinds by layers.
- F2 `collect` spent minutes on unreachable blocks (6 tries of up to 2 min each). Fix: 3 tries or 90 s, shared memory
  of unreachable blocks, targets shared between bots.
- F3 `move_to` reported "arrived" when boxed in: the pathfinder's goto can return without arriving. Fix: arrival check.
- F4 A trapped bot was never moved. Fix: `mcRescue.ts` (swim, walk, climb, teleport onto the storage chest).
- F5 The mayor re-posted work when woken on a timer. Fix: no timer once laid out; board status in its prompt. Prompt
  wording alone did not help (mayorbench results vary run to run).
- F6 Smelting stopped before the last item (8 sand gave 7 glass). Fix: wait while the furnace is cooking.
- F7 "Storage is full" with 23 slots free: a failed deposit was reported as full. Fix: retry, honest message.
- F8 Leaf litter and apples filled the chest. Fix: junk list.
- F9 Two builders starting together each chose wood from a record the other was emptying. Fix: re-read the chests
  and choose again before giving up (still happens rarely).
- F10 A pickaxe from mixed plank kinds failed (3 birch + 2 oak planks). Fix: count one kind.
- F11 `collect` counted blocks taken by another bot as unreachable. Fix: shared targets, gone blocks are no failure.
- F12 4 workers were barely faster than 2 on the same trees (a 12-log task took 2.3 min instead of 1.2). Gathering,
  not models, limits speed: see phase 4.
- F13 Executors faked gather tasks (withdrew logs and deposited them again). Fix: code-posted steps run as written;
  executor calls per worker fell from 13-52 to 0-6 per run.
- F14 Gatherers dug stone out of the prepared plot, then builds found the ground uneven. Fix: plots are off limits.
- F15 A build failed four times with everything needed carried: a crafting error was swallowed and the inventory view
  was stale. Fix: error shown in the message; crafting falls back to the server's counts.
- F16 The API stopped answering with 4 bots: pathfinder searches (15 s think time) and 4096-block scans saturated the
  event loop. Fix: 15 ms per tick per bot, filtered block search, watcher retries.
- F17 The mayor, woken with everything built, waited instead of declaring complete. Fix: code declares it.
- F18 Gather tasks for sand where there is none kept buildings waiting for minutes. Fix: fail at once (soft).
- F19 A site smaller than the layout sent the mayor exploring 500 blocks away. Open: step 1.2.
- F21 The mayor draws designs before it knows how much land there is (Fourfold7: designs for a 19x19 layout, land
  17-18 blocks). Step 1.2 gives the architect the site size.
- F22 "Digging aborted" on stone, 5 times in the 4-worker runs and never before: most likely the pathfinder finishing
  its own dig after a walk. Fix in `b7908db` (clear the goal, wait, retry once), not yet seen in a run.
- F23 `explore` reported "no path ... stopped at" the point it had reached: the arrival check compares with a goal
  whose y was estimated. Cosmetic; step 1.4.
- F20 Deposits leave 1-3 items behind "though there is room" (11 times in the 4-worker runs, every worker): the bot's
  inventory view and the server's disagree by a few items. Harmless (the items stay with the worker), but a sign to
  count deposits on the server as building already does. Backlog.

- F24 (09-28, step 1.2) find_site at Fourfold7's spot (-195,-97) now finds 19x19 in 3 s: the old search stepped
  centres by 2 blocks and offered 17x17 three times. Wider searches take 1-4 s (API replies stay under 1 s); forced to
  walk (max_slope 0) it took 2 legs, 74 blocks, 24 s. Tightfit1: partial layout, then the second site found and laid
  out by code within the same minute; the mayor never explored.
- F25 A vague first plan step ("Search for a dry, flat, open area...") made the mayor's executor ask for 11x11, and
  the architect sized to the site's room: 3x3 cottages. Fix (after the run, to be seen in 1.5): the mayor's first
  find_site asks for at least 24, and the brief never goes below 5x5 (what does not fit goes on a second site).
- F26 A worker gathered 135 blocks from the village (collect from -55,70,-54, storage at -189,-48) after repeated
  "stuck" failures on acacia logs on hills (4 of Worker1's 6 failures): workers' explore is not range-guarded. Backlog
  unless it recurs in 1.5.
- F27 The b7908db checks in Tightfit1: "Gave up" an ungatherable sand task at once, seen; the teleport of
  SausageOfDoom4, seen; no "Digging aborted" (5 in the 4-worker runs), consistent with the fix; completion was
  declared by the mayor itself, so the code path was not needed; no stone pickaxe: both pickaxes were crafted by the
  executor at 8-10 min with no cobblestone in hand (not a failure, not yet seen working).
- F28 mayorbench (gpt-oss, 6-10 samples): the new cases "partial layout: find a second site nearby" 6/6 and "refused,
  site too small: find_site bigger" 6/6; "second site found: plan_layout the rest" 2/6 and 1/10 (it took the second
  site as too small for everything), hence done in code. Old cases on the committed prompt vs the new one: first plan
  6/6 vs 7/10, requeued-wait 4/6 vs 6/10, layout-under-way 0/6 vs 1/6, failed-hard 0/6 vs 0/6: noise, and the last
  two are handled by code guards.
- F29 (step 1.3) Fourfold7's 3-minute mayor start: its first plan (at spawn) was an empty wait, accepted without a
  log line; the stall review ("no step has been completed for 3 minutes") was the first thing to wake it. Fixed as in
  1.3; Accept1's mayor planned at 0.1 min.
- F30 Accept1 (the F25 fix): "find_site size raised to 24" was seen, designs came out 5x5 and 7x7. find_site's
  level-ground pass (height range 2) chose a 30x30 in the forest (1057 tree blocks) over open ground with range 4;
  prepare_site felled 13 trees in 2.4 min and the logs fed the builds, so this is fine in woods. The watcher did not
  teleport SausageOfDoom4, who was offline (correct).
- F31 "Declared complete by code" seen working (Accept1, the mayor waited with everything built).
- F32 Accept2: both designs had a furnace as decoration ("a furnace for interior light"). The hall's build crafted one
  and placed it, and its 4 glass windows stayed open (142 of 146 blocks), most likely for want of a furnace to smelt
  the sand gathered for them. The watcher cuts event text at ~300 characters, so the exact reason is not in the log
  (F35).
- F33 Accept3: the architect drew the hall in sandstone in a jungle; all three sandstone tasks (81 blocks) were given
  up at once ("no sandstone within 96 blocks": the F18 fix working), leaving the hall short. Designs need materials
  that exist near the site: see the handover.
- F34 find_site's "taken" ground is its own village's buildings, layouts and reservations; other villages' buildings
  only count against a site as built-on ground. Accept2 started 100 blocks from Accept1 and was fine, but a new village
  could be laid out over an old one.
- F35 The watch script truncates event text (~300 characters), hiding the end of long failure messages. Print them
  in full, or write the full events to a second file.
- F36 (session 3) Fixes for F32-F35, tested without models (`runs/2026-09-28/s3-materials.log`): plan_layout asks the
  world (`WorldAdapter.materialsNear`, the blocks `collect` would look for, within 96 blocks of the site) for every
  material a design's gather tasks name, sand excepted, and refuses the design when one is missing: Fourfold7's
  sandstone cottage was refused at Accept3's jungle site and laid out in the badlands. The architect's brief says when
  the site has no sandstone or sand. Survival designs may not use furnaces, crafting tables, chests and the like as
  decoration (Fourfold7's cottage had a chest and a table; checked in code, one retry; not yet seen in a run).
  find_site keeps off every village's buildings, layouts and other villages' plots: Gus in the middle of Accept1's
  plot got a site 45 blocks away. The watcher prints failures and finished builds in full.
- F37 (Accept4) The agent server stopped answering for 30+ s at ~16 min and Paper disconnected all three bots at
  once ("Timed out"); the workers never recovered. Memory was fine (255 MB). Cause unknown: the agent server now logs
  every event-loop stall over 2 s with each agent's running action (`[lag]` lines). Seen since: 2-3.5 s at spawn
  (three bots joining) and during find_site's log scan (up to ~2 s; the API's slowest reply 2.1 s), none long.
- F38 (Accept4-5) A mayor plan step "plan_layout" went to the executor, which cannot call it and ran find_site
  instead, replacing a 30x30 site with a 24x24 one. Fixed: such steps are dropped and the planner calls the tool; a
  later search before any layout asks for no less than the site already found.
- F39 (Accept5) Designs of 11x11 and 13x13 (~1,100 blocks for the village) with mossy cobblestone: moss comes from
  lush caves, workers went to y=-4. Fixed: survival designs at most 9x9; raw materials whitelisted (logs, stone,
  sand, sandstone, dirt, gravel, terracotta): of 97 stored designs only the 10 needing moss, iron, glowstone, wool,
  sugar cane, leather or clay are refused.
- F40 (Accept6) The executor model ran at 2.7 tok/s, one turn 187 s: Ollama reported it "20383 of 20383 MB in VRAM"
  while nvidia-smi showed 1.3 GB on its card (Windows shared GPU memory counted as VRAM). `ollama_exec.py` now checks
  each card holds its model (start and status). Probably slowed Accept4-5 too.
- F41 (Accept7) Wood buried deep (y=34 under a desert at y=70) counted as wood near the site in find_site and the
  materials check. Fixed: only blocks within 16 of the ground count; a site without trees makes find_site walk toward
  trees and plan_layout refuse ("run find_site for a site with trees"); the watcher skips treeless land.
- F42 (Accept8) The site had 1 log block within 48: a survival site now needs 30 (find_site walks toward trees and
  prefers a smaller wooded site to a bigger bare one: from Accept8's spot it walked 52 blocks to a 25x25 with 38);
  collect keeps within 16 blocks below the village and off a plot's 2-block margin (an 18-deep hole appeared there).
- F43 (Accept9) One glass short: "could not smelt 2 glass (ran out of fuel after 1 of 2)". The fuel in the bill runs
  short by a little; backlog.
- F43 fixed: smelting loaded only the first plank stack as fuel (a leftover of one or two planks) and gave up with
  more in hand; it now tops up from the furnace window's slots (the bot's own inventory view lagged and offered the
  plank already burning). Tested: 4 sand with fuel split 1 + 5 planks gave 4 glass; Accept11's windows all glazed.
- F45 (Accept12) The material check passed a village needing 247 sandstone after finding one block, and counted
  sandstone buried under sand that collect never goes for. It now counts up to the amount needed, as collect can
  get it (near the surface; anything within 40 blocks of the site, only exposed blocks beyond).
- F46 (Accept12) A queued sandstone collect left over from a given-up task failed again under each newly claimed log
  task and gave three of them up. Only the held task whose material failed is given up, and the queue goes with it.
- F47 (Accept13) 115 of 131 logs was refused, find_site returned the same site, the mayor circled and finally drew a
  cottage named "two_cottages_and_hall". Wood may now be a quarter short (felled trees on the plot, unloaded ground),
  and the refusal offers smaller buildings as well as another site.
- F48 (Accept14) After failed log collects a worker's executor explored hop by hop to 180 blocks from the village
  (F26 again), then gave up every gathering task it took. The 96-block guard covers every village member, a collect
  far from home walks back first, and the failure message no longer suggests exploring.
- F49 (Accept16) All three buildings stood at 37.6 min, but the mayor had just tried to re-post gathering (dropped as
  duplicates), so the completion check after its "wait" never ran and nothing woke it. Completion is now checked by
  code on every tick of the mayor's brain; Accept18 was declared complete this way.
- F50 (Accept17) The watcher spawned the village at its probe point, 100 blocks from the site found, where the mayor
  was stuck in a hollow: its explore and move_to timed out there, the rescue ignored timed-out walks, and its design
  steps waited behind the walk until the run stalled. The watcher now spawns at the site; a timed-out walk that got
  nowhere counts as stuck.
- F51 Log roofs ("oak log roof", 81 logs for a 9x9 hall) make villages wood-heavy: Accept16 and 18 took 38-39 min.
  A cap on logs per design, or a hint to the architect, would help; backlog.
- F52 The workers' planner made no calls in any acceptance run (`plan 0x0ms` for every worker): tasks posted by code
  run as written, and the executor handles failures. Comparing planner models on these runs measures nothing; phase
  3 (chat requests) is where the workers' planner will matter.
- F44 The materials check and find_site's log scan run synchronously (2-2.7 s stalls with agents idle, at layout
  and during the land probe). Harmless so far; make them incremental if stalls grow.

## Decisions log

- 09-28 One wood kind per village, when enough of it grows near the site (user agreed).
- 09-28 Scaling test with 4 workers (Worker3, Worker4); the standard stays 2 workers.
- 09-28 Code-posted task steps run without the executor; the model handles only what follows a failure.
- 09-28 The Paper server listens on the LAN with a whitelist; the panel on the LAN via `MC_API_HOST=0.0.0.0`.
- 09-28 Shared atlas (phase 2) comes after the phase 1 acceptance runs and before the chat requests (phase 3 needs
  it for "by the river").
- 09-28 The panel opens in simple mode by default (detailed one click away, remembered per browser).
- 09-28 Time frozen at day (`advance_time false`); random ticks (growth) and animals are unaffected as far as known
  (not tested in 26.1: offer to check a sapling grows if it matters).
- 09-28 The watch scripts teleport the watching player (MCAI_PLAYER, default SausageOfDoom4) to the Mayor, Worker1
  (staged) or the test agent.
- 09-28 A partial layout goes ahead when at least half the buildings fit (the workers start at once); fewer is
  refused in favour of a bigger site. The rest is laid out by code at the mayor's next successful find_site.
- 09-28 (session 3) Survival designs are at most 9x9 and use only whitelisted raw materials; a survival site
  needs 30 log blocks within 48; material and wood counts ignore anything more than 16 below ground level.
- 09-29 Step 1.5 counted as passed (the user), and the branch pushed.
- 09-29 Every village member stays within 96 blocks of its village (the guard covered only the mayor before
  Accept14).
- 09-28 The mayor stays within 96 blocks of its village (the same range as gathering); find_site walks at most two
  40-block legs itself instead.

## Keeping this plan honest

- **When a run shows something new**, add a finding with evidence (log line, numbers). Then decide: fix now if it
  blocks the current step; otherwise add it to the right phase or the backlog, and say why.
- **When a finding invalidates a step** (wrong cause, better approach), edit the step and add a decision explaining
  the change. Do not silently delete: strike through (`~~...~~`) and point to the replacement.
- **Acceptance criteria are concrete** (what run, what counts as passing). If one turns out to be wrong, change it in
  the decisions log, not quietly.
- Keep the "Next session starts with" section current at the end of every session, including uncommitted work and
  anything left running.
