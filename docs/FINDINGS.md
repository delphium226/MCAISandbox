# Findings log

Moved from `docs/PLAN.md` on 2026-10-15; F-numbers are unchanged. Find one with `grep -n "^- F123 " docs/FINDINGS.md`.


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
- F53 (09-29, step 2.1) The atlas scan reads block state ids from the chunk column through a per-state lookup table,
  from the highest non-empty section down: 0.085 ms a chunk (99th percentile 0.14) in `scripts/bench/atlasbench.mts`
  on jungle-edge chunks, against 6.4-11.8 ms a chunk the `bot.blockAt` way (`surfaceAt` in find_site): ~80x. In the
  agent server: 329 chunks within 10 s of Gus spawning, median 0.1 ms, p99 0.6, max 1.0 (early, JIT warm-up); no
  `[lag]` lines. `scripts/checks/atlas.py` matched 12 chunks column by column against `/api/block` (oak woods, the
  lake at -235,-53: water, logs high and low, stone, gravel), after fixing the check's own rounding. "Other" ground
  is almost always built (Accept9's cottage); cocoa pods counted as ground, now passed over. 700 chunks are 158 KB
  on disk (~225 bytes each). find_site's `surfaceAt` could use the same reading (2.3).
- F54 (09-29) What collect failures were in Accept1-18 (103): 61 "could not reach" logs, of which 39 had the bot
  standing right under the target 5-9 blocks up (a trunk left floating after its lower logs were cut; the unreachable
  memory is per block, so each log of one trunk failed again: -571,-195 and -571,-220 in Accept15 over and over); 22
  unclear (the log keeps the last of three problems). All 13 "no logs within 96 blocks" came from Accept7, 8 and 14,
  whose causes are fixed. With view distance 8 (~128 blocks) a worker near home has the whole 96-block range loaded,
  so an atlas-guided collect would rarely find anything the local search misses.
- F55 (09-29, step 2.2) Felling tests with Gus (`scripts/checks/fell_trees.py`, `runs/2026-09-29/trees-check*.log`):
  in oak and birch woods (-380,20 and -400,45) about 24 trees came down, all but one with nothing left, 88 logs cut and 84 in hand
  (server count), climbs of 2-3 on tall birches, and the climbs' dirt came back. Found and fixed on the way: climbing
  for logs off to the side (a second trunk joined by a branch: now cut from the ground first, climbs only for logs
  above reach), drops lost (24 of 54 kept: a 20 s sweep within 8 blocks instead of 6 s within 4), a refused
  placement (retried once), a climb started 4 blocks below the foot (climbs only beside the trunk), pillar bottoms
  left or wrongly reported left (the bot's view lags placing and digging: the server is asked after the sweep and
  leftovers broken by command). **And Gus, in no village, felled about 101 jungle logs from Accept15's cottages
  and hall** (their log frames and log roofs read as trees): `collect` kept off only its own village's buildings,
  which let any agent take another village's logs one by one before, and whole frames with felling. Fixed: collect
  keeps off every village's buildings and plots, and a tree must have leaves on its logs (protects unrecorded log
  builds too). The logs were restored by command (the user agreed; each design's log cells that were air).
- F56 (09-29, step 2.2) On 26.1 the placer is often not sent the block update for its own placement: Mineflayer
  reports "the block is still air" (and its physics stands on nothing) when the server placed the dirt, and a retry
  put a second block on top. Pillar placements now ask the server (`execute if block`) and write the block into the
  bot's view. After each felling the climb column is checked on the server and leftovers are broken by command
  (`setblock ... air destroy`); a bot that dug dirt beside the tree walks back to the foot before climbing (it climbed
  from one of its holes, and the check then broke the refilled hole: 5 holes, filled by hand). Whole trees cost time:
  StageT2 18.0 min against StageW2's 11.1 for the same buildings, mostly the drop sweep walking after saplings; with
  logs and dirt only, StageT5 13.0 min. Whole trees also gather surplus (43 logs left in StageT2's storage).
- F57 (09-29, Fell1) Pillar placements refused with the bot's feet at 75.42-76.50 over a block at 75-76: a jump
  needs two free blocks over the head (feet + 2 and + 3), and a leaf or log at + 3 capped it. The climb now clears
  leaves and the tree's logs at both, and does not place until the feet are above the block. The 2 pillar blocks
  once left with no climb recorded were most likely the pathfinder's own scaffolding while sweeping drops (backlog:
  the pathfinder's pillars); the server check removed them. Deposits carry cocoa beans (27 in Fell1's chest): add
  them to the junk list (backlog). A first placement try is still refused now and then with the feet above the block
  (the server's copy of the bot's position is a tick behind); the retry places it (trees-check9: climbs of 4-5 with
  nothing left).
- F44 The materials check and find_site's log scan run synchronously (2-2.7 s stalls with agents idle, at layout
  and during the land probe). Harmless so far; make them incremental if stalls grow.
- F58 (09-29, V.2) Sorted deposits lost track of one item now and then: StageH1 and H2 left 1 jungle_log with the
  depositor ("could not put in ... though there is room"; the next deposit took it), StageH3 put 1 cobblestone in the
  last free chest while the cobblestone chest had 25 slots free. Causes: a chest crafted for a new group took 3 logs
  from storage and used 2 after the logs group was done; counts read from `bot.inventory` while a chest was open (lesson
  24). Fixed: counts from the window's slots, a group visited again when more of it turns up, a slipped put retried
  once, no free chest for a group whose own chest has room.
- F59 (09-29, V.1, StageH3) A gatherer crafting a pickaxe right after putting the chests down placed its crafting table
  at -652,64,184, inside the future hut: the hut's floor came out a block higher, and the build would have set the
  floor layer on the chests (a `/setblock` empties a chest). The first review had found that path; the guard added
  for it refused the build instead. Fixed at the cause: crafting tables and furnaces never go down on a village's
  plots, laid-out plots or within 2 blocks of its buildings (`placeNearby` steps off first). This was possible before
  the hut (any gatherer's table on a plot), just unlikely.
- F60 (09-29, V.1, StageH3) The storage task's deposit put the 4 carried chests in the hut, then tried a fifth: the
  bot's view still showed a chest the server had placed ("no chest in inventory"). Placement is now capped at the
  count carried at the start.
- F61 (09-29) prepare_site left "columns with existing buildings" on fresh jungle ground (StageH2: 2, StageH3: 4):
  cocoa pods were not in `NATURAL`. Added cocoa, glow lichen, hanging roots, berry bushes (all breakable by bots).
- F62 (09-29, StageH4) Whole-tree felling (2.2) on 2x2 jungle trees overshoots small tasks: 81 and 105 logs for
  10- and 9-log tasks, over 5 minutes each, while storage already held enough. A claimed gather task is not closed
  when storage covers it (only open ones are). Backlog: prefer small trees for small counts, or close covered tasks
  mid-collect.
- F63 (09-29, reviews) Found by the review subagents before any run hit them: a mayor-drawn "storage_hut" would have
  replaced the code's design (refused now); the stuck rescue teleported onto chest 1, which inside the hut puts the
  head in the roof (now the door walkway); a re-posted storage task used the old text and the hut build kept waiting
  on the failed one; a refusal over the hut's materials asked the mayor to redraw it.
- F64 (09-29, Hutvale1) "no cobblestone within 96 blocks of the village" at the first cobblestone task, on a site
  plan_layout had passed: collect takes buried blocks only within 16 blocks of the bot and none under a plot, and a
  worker starts from the middle of a 23x23 plot; this jungle had no exposed stone within 128. The material check ran
  before the plot existed and counted the stone under it (lesson 21 again). With the hut, cobblestone is needed by
  every village (63 for its floor), and a village whose hut cannot be built is stuck. Fixed: collect with nothing to
  be had steps off village ground once and looks again (then found 10 in a minute, 3 blocks past the plot's margin).
- F65 (09-29, Hutvale1) t2114 "Gather 31 cobblestone for storage_hut" was marked done with nothing gathered: the first
  chest put down finishes the storage task while its deposit is still running; the worker took t2114, and the
  deposit's success then matched t2114's "deposit" step (a success may match a later step; `item=all` matches any).
  Fixed: an action's success counts only toward the plan it was started under, or a replan of the same task
  (`actionPlan` in tieredBrain; the review found the run-as-written path needed it too).
- F66 (09-29, checks after Hutvale1) The pathfinder dug a shaft from a prepared plot's surface (y 70) to stone 5 blocks
  down beside the storage hut: collect's target was allowed (plots were protected 4 blocks down) and the pathfinder
  breaks any natural block on the way. Every bot now refuses to dig into any village's plots, laid-out plots and
  margins (from 4 under the level up) or beside its buildings (pathfinder `exclusionAreasBreak`, cached every 5 s),
  and collect takes nothing in the columns under a plot. Old damage stays: Hutvale1's plot at -795,247. V.5's mine is
  the real answer to cobblestone.
- F67 (09-29, Hutvale2) The timed review ("no step completed for 3 minutes") re-planned both workers in the middle of
  their 31- and 32-cobblestone collects; Worker1's executor then queued collects of 16 and 14 behind the running one:
  61 cobblestone for t2197, about 4 minutes on the hut's critical path (the surplus later closed 3 cobblestone tasks).
  Backlog: no timed review while a code-posted step's action is still running.
- F68 (09-29, Hutvale2) "could not smelt N glass (placing furnace at ... failed: block is still wildflowers)" at the
  hall and a cottage, though both then smelted and used their glass; two furnaces were made for three smelting
  builds. `freeSpotNearby` takes a cell holding wildflowers as free and the placement is refused. Backlog: treat
  replaceable plants as occupied (or clear them) and word the message after the retry.
- F69 (09-29, V.2b, StageH7) No bot could ever walk through a door: mineflayer-pathfinder's `canOpenDoors` opens fence
  gates only (its "openable" set is built from blocks named *gate*), and a door, open or closed, is a solid block to
  it (`physical` is `boundingBox === 'block'`). Until the hut's furnace, nothing needed to go inside a building (chests
  by the walls open from outside; crafting needs a table only nearby), so CLAUDE.md's lesson 15 ("the pathfinder
  opens doors") was wrong unnoticed. Now open doors and closed doors' upper halves are passable and closed lower halves
  "openable" (`moves()` wraps `getBlock`): a bot walked in through the closed hut door, but leaving through the open
  door it stuck in the doorway twice (the open panel leaves ~0.01 block). The storage hut therefore has an open
  doorway instead of a door (decision below).
- F70 (09-29, StageH8) A chest for a new group was not crafted from 6 oak and 2 birch planks: `ensureChest` counted
  planks of all kinds, a recipe takes one kind. It counts per kind now.
- F71 (09-29, StageH10) Worker1's deposit failed twice "stuck at -1055,66,128 on the way to" a hut chest, in a 1-deep
  pocket just south of the plot (ground at 66 around it, headroom clear), its x 0.3 from the block edge beside it; it
  walked off fine for the next collect and deposited 2 minutes later. ~5 minutes lost. Cause not found (lesson 1's
  wall overlap is a suspect); watch for it.
- F73 (09-29, V.3, StageH12) Closing gather tasks against the village-wide need released builds early: the storage
  hut's own cobblestone task (t2446) was closed because the hall's tasks covered the total, the hut started 15 short,
  used cobblestone gathered for the hall, and the hall started 43 short (both healed by requeue). The review had also
  found: carried items counted twice (whole held task plus hand), the preparer's felled logs closing log tasks,
  "logs" in add_need posting and closing every 3 s, and no-wood villages never lowering an oak need. Now only tasks the
  sync posted itself are closed (per-building ones stay with coveredByStock), held tasks cover what is left to
  collect, only a gatherer's own material counts in hand, one wood kind throughout, and no sync while a build runs.
- F74 (09-29, Hutvale3) The mayor's hall briefs asked for "interior includes a crafting table" three times (refused:
  no workstations in designs) and layout came at 5.7 min instead of ~1.4: the storage hut's library entry read "...and
  the village crafting table and furnace". Reworded ("built by code: plan_layout adds it by itself; not a design to
  build or copy").
- F75 (09-29, Hutvale3) Buried stone dug beside the plot (F64's step-off) left a hole at -1119,60,375, one block high
  (dirt above) next to water at y 58-59; Worker1 was rescued out of it by teleport, then collect chose stone around
  it again and again (5 failed collects, 4 of 26 cobblestone). Digging for cobblestone around the village makes traps:
  the mine (V.5) is the answer; until then the step-off holds for villages that have no open stone.
- F76 (09-29, StageH14) A bee nest left floating at y 92 on a plot levelled at 90 (from a felled birch; its block
  entity reads "beehive"): not in `NATURAL`, so prepare_site kept its column as built, and the testhut's site was
  "not level (heights 90..92)" three times. Added `bee_nest` (like cocoa, F61).
- F77 (09-29, V.5, StageH19) The main tunnel met a hillside 12 cells out ("no solid ceiling") and that ended the whole
  mine after 80 cobblestone; the rest was gathered outside (20.8 min against StageH18's 13.6). Next: a main tunnel that
  ends should turn, or the stairs go on down to a second level, rather than the mine stopping. The review of V.5 found
  before any run: tunnels could break built blocks or run out of range (now refused), the pathfinder could dig shafts
  into the mine (its area is kept from digging now), sand or gravel could fall in (a solid ceiling is required),
  stairs without stone still started tunnels (now stopped).
- F78 (09-29, Hutvale4) Worker executor prompts reached 8,198-8,391 tokens, over the local models' 8,192 context: every
  executor call failed ("exceeds the available context size"); code-posted steps ran on as written, so only failures
  went unhandled. Today's additions (41 tasks with a mining hut, per-chest storage, the needs and mine lines, two
  code designs) grew the village summary to ~2,200 tokens. Workers' prompts (executor and planner) now get a compact
  summary (~540 tokens: their own task in full, 10 other open tasks by title, no finished ones, designs by name, no
  chests as buildings); the mayor's cloud planner keeps the full one. F68 (a table refused on wildflowers) fixed too:
  only air cells take a crafting table or furnace.
- F79 (10-01, V.5b, mine check on StageH19) At a hillside the mine's level (y 63, the plot at 69) runs close under the
  surface (65-66 there) and the tunnels are partly dirt: 203 dirt against 157 cobblestone in three trips (Gus carried
  165 dirt at the end); the tunnel floors turn to grass where daylight comes in from the hillside. Still far quicker
  than outside (24 cobblestone in 38-125 s against 30 in 3-5 min), so left as it is; if dirt fills the storage, end a
  branch or tunnel at a stretch with no stone, or drop the dirt in the mine. The next check (H19b) was worse: a turned
  tunnel ran 280 cells through dirt, 17 cobblestone in 6 minutes and 412 dirt carried. Fixed: a cell to dig with no stone
  in it ends its branch or tunnel, and a level with no tunnel left goes a level down (the stairs on down, 6+ steps, into
  stone). Four rounds after it: 103 cobblestone for 9 dirt.
- F80 (10-01, V.5b, mine check H19c) The pathfinder cut a 2-high corridor from the hut toward the face (z -60, outside
  the tunnel's protected box, which ends a block past the stretch being dug) and dug the surface over a junction (the
  boxes now stop at the ceiling, y2). Any walk free to dig takes the shortest way through natural ground, and the mine's
  boxes only make the planned cells dearer. Every walk in the mine now runs without digging, scaffolding or pillaring
  (`walkMine`); the tunnels and stairs are open from the hut down. The second review found `mineBlock`'s own walk could
  still do it (digCell now refuses a cell out of reach) and that a bot that never got into the mine counted as an empty
  trip (it no longer does).
- F81 (10-01, StageM4, M5) With mineBlock no longer walking (F80), `dig_mine` depended on the pathfinder getting onto
  each stair step; onto step 3 (under the mining hut's wall) it sometimes did not, and the bot stood on the ground above
  the step (StageM5: three failures in a second, the stage run stopped). The stairs from the hut keep mineBlock's own walk
  (they lie on the plot, which no walk may dig); tunnels and the stairs down are dug only from their approach (the cell
  before, the step above).
- F82 (10-01, StageM4) Two workers mined one tunnel at once: both read the same next cell, and the second went for
  cells whose approach the first had not dug yet ("no path", three times). Now a bot holds the tunnel it digs (in memory,
  per trip); a second miner turns its own tunnel off the busy one at a finished junction (or at the stairs' bottom while
  the first has none), else waits up to 2 minutes; one bot digs the stairs down. Turned tunnels' branches can still cross
  the busy one's later branches (a cell found open is passed; a dig aborted by the other bot counts as an empty trip).
  Only trips that stopped inside the mine count toward ending a tunnel (a bot stuck outside ended none).
- F83 (10-01, Minevale1, model-driven, jungle edge -829,257) The layout's plot with its 2-block margin reached past the
  30x30 area find_site had checked (z 273 against 272): prepare_site refused "the ground at -819,273 is 10 blocks below
  the level (a ravine)". Worker1's executor then ran find_site itself and prepared a 23x29 plot 43 blocks west, and the
  code-posted prepare task counted as done (its step names prepare_site, which succeeded), while every building stayed
  laid out on the unprepared ground. Stopped at 3.1 min (no mine reached). Not V.5b; proposed: a prepare task is done
  only when the prepared plot covers the laid-out one, and plan_layout keeps the plot and margin inside the site
  find_site measured (backlog).
- F84 (10-01, Minevale2, log analysis) The watcher spawned the village at y 90 (`tp x 90 z`) where the ground was at
  y 100: both workers spawned in stone, suffocated (paper-start.log "Worker1 suffocated in a wall") and respawned at the
  world spawn ~900 blocks away; the Mayor landed in a cave at y 84 and its executor chased the workers' "I'm under
  attack" chat (follow, move_to) instead of designing. ~15 worker-minutes and the Mayor's first 5 minutes lost. Fixed:
  the probe spawns on the surface (no height), and the village's agents spawn one above the ground the probe read in each
  spawn column (`spawn_heights`, `/api/blocks`; leaves, logs and plants passed over; the server's surface spawn when
  unknown). Open: the Mayor's executor answering workers' distress chat.
- F85 (10-01, Minevale2, StageM6-M8) Every miner's first pickaxe is wooden (59 blocks) and its replacements are made
  from a tree felled outside the mine while the storage holds 100+ logs: 5 remakes in Minevale2, trips with one took
  1.7-3.2 min against 0.2-0.9 without; one remake's walk back left Worker2 at the tree (the 33.2 min "away"). Fixed:
  makePickaxe takes 3 cobblestone (a stone pickaxe) and logs of one kind from the village storage before felling a
  tree, and the walk back into the mine goes by the top of the stairs. Mine check on StageM8 with no pickaxe given:
  stone pickaxe from storage, 24 cobblestone in 52 s.
- F86 (10-01, Minevale2) prepare_site roofed a natural gully under the plot (2-3 blocks of lid over air at y 91-93)
  instead of filling it; the storage hut and hall stand over it, and tunnels open into it. 58 jungle logs from the
  plot's felling were never used in an oak village. Left in the world: a crafting table at -827,96,-365 (a pickaxe made
  outside, before F85's fix) and a 2-block dirt pillar at -833,96..97,-349 beside the mining hut. Backlog.
- F87 (10-01, review of V.6) The atlas check reads the bots' view (`/api/blocks`), as the atlas does: a stale view
  (lesson 29) would pass both. A few cells checked over RCON (`execute if block`) would close it. Noted.
- F88 (10-01, Minevale5) find_site reported a 30x30 site at -1176,-360 as "ground y=101, height range 0, 0 tree blocks
  to clear" where the ground is at y 119 with a 9-block drop at its edge (the watcher's probe nearby said the same: "y=97,
  height range 0, 0 tree blocks"); prepare_site then refused the drop four times and the executor looped on find_site.
  "height range 0" with no trees on hilly woodland suggests columns read from chunks not (yet) loaded. Next: check
  find_site's height grid where chunks are missing, and prepare_site/plan_layout against F83.
- F89 (10-01, seventh session, stack start) `ollama_exec.py start` warned twice that qwen3:30b was not in GPU 1's
  memory (GPU 1 at 1.0 GB, GPU 0 at 24.2 GB with both models), although each start ran at ~170 tok/s. Cause: this
  Ollama build turns Vulkan on by default (`OLLAMA_VULKAN:true` in the server log, set by no variable), and the Vulkan
  backend ignores `CUDA_VISIBLE_DEVICES`: the executor's server chose Vulkan device PCI 02:00.0, the planner's card.
  Fixed: the pinned servers start with `OLLAMA_VULKAN=0` (both cards then held their own model, no warning). This is
  probably also the cause of the earlier "fully in VRAM" false reports.
- F90 (10-01, seventh session) Paper, started with the Bash tool's `run_in_background`, was killed at the task's
  default 30-minute limit (15:03, right after StageS1); the agent servers started that way would have died the same
  way. Not a session restart: a time limit. Servers now start detached from the session (`Popen` with
  `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`, as `ollama_exec.py` does; a scratchpad `detach.py` this session).
  A detached Paper's stdout stays empty: wait for "Done (" in `mc/server/logs/latest.log`.
- F91 (10-01, T.1 design review) Paper 26.1 judges a dig by the wall clock: `ServerPlayerGameMode` counts ticks
  with `level.getLagCompensationTick()` ((nanoTime - start) / 50 ms, unconditional, no setting). A dig finished in
  half the time is refused (it becomes a "delayed destroy" needing full progress, one slot only), while Mineflayer
  sets the block to air in its own view anyway: phantom air and lost drops. So at 2x digs keep their real-time length
  and mining does not speed up (mine check 92 s at 1x, 99 s at 2x). Walking, furnaces, item pickup and leaf decay
  follow the tick rate. Not taken: finishing digs at 0.7 of their time plus a tick (the server's tolerance), ~1.3x on
  long digs at any speed, but it changes 1x behaviour.
- F92 (10-01, T.2 runs at 2x) The felling pillar's first dirt placement is refused more often at 2x: 8 first tries
  in 20 felled trees (Fixed1, Fixed2, Drop1) against ~10 in 116 at 1x (the sixth session's logs); every second try
  placed it, no felling failed. The jump's time above the block is half as long in real time while the poll, the extra
  tick and the placement's round trip are not (the T.1 review predicted it). Left: costs a retry only, in 2x runs only.
  If it starts failing: place on the first `physicsTick` with the feet a block up instead of polling.
- F93 (10-01, T.3) F88's cause: find_site's column scan (`surfaceAt`) ran from the surveying bot's y + 32 down, so
  ground higher than that read as solid at the window's top: level, treeless ground at exactly bot y + 32. Minevale5's
  Mayor stood at y 69 and reported "ground y=101"; `site.py -1208 -296 30` reproduced it (Gus at y 68: "ground y=100,
  height range 0", real median 123, range 14). Not unloaded chunks (those are rejected, never flat). Fixed: the scan
  climbs in 16-block steps while the window's top is not air, then scans down (prepare_site and readySite use the same
  function). After: the check passes there (a real site at -1109,-259, every figure equal to the blocks). F83's cause:
  prepare_site judged plot + 2-block margin while find_site had measured the plot's square only. Fixed: a margin column
  more than 8 below the level is left as it is and reported; only plot columns refuse, saying to run find_site again.
  `site.py -840 136 30` (Minevale1's probe): every figure matches; two margin columns 5-6 below the level (filled).
- F94 (10-01, Drop1, test world) collect spent 175 s on a birch log at -1711,67,-210 and gave up: "no leaves: built by
  someone, not a tree". It is a fallen tree (26.1 generates them: a row of logs lying on the ground, -1711,67,-210..-207
  in the untouched snapshot, no leaves). Leafless logs count as built since lesson 30; a lying log outside every
  village is natural. Backlog. (The site, "drop", had 191 birch logs; after the plot's 116 a collect found none left
  within 96 blocks: Drop1 took 11.0 min against minevale3's 7.1, and its probe chose the low ground at y 64, not the
  shelf at y 95, so it did not test a plot against a drop.)
- F95 (10-02, eighth session, Shelf1) prepare_site left pits in a plot it reported ready: the testhall's build then
  refused "the ground is not level here (heights 93..95)" three times and the run stopped at 8.5 min. Every pit was a
  cell that held a tree when the work was planned (the log analysis compared every plot column with the snapshot): the
  shelf's birches stood in hollows below the level, `treeAt` added the whole tree as 'air' targets first, and `add()`
  kept only the first target per cell, so the column's fill and grass were dropped as duplicates. A bug since milestone
  (c), shown by the first plot with trunks below its level. Fixed: a block replaces an earlier 'air' target (and, from
  the diff review, water plants and lily pads join `NATURAL`: a column with them above the level was kept as built,
  lesson 34). Not done:
  a check of the plot's columns on the server after the job (it would also catch placements refused at 2x, F92).
- F96 (10-02, Shelf1) plan_layout posts sand gather tasks where collect can take none: layout.ts lets sand off its
  material check (windows stay open without it) but `materialTasks` still posts them; Shelf1's only sand lies 93-96
  blocks off at y 60-63, below collect's floor (home y - 16). Each task was taken twice and failed twice per take (12
  failed collects in 20 s), and each futile collect probably blocked the event loop ~1-2.4 s (four `[lag]` lines of
  2.0-2.4 s line up with them, though Worker2's log collect ran at each too): two synchronous `findBlocks` passes (48 blocks, 1024, then 128 blocks, 256) that find nothing.
  Backlog: post no gather task for a material collect cannot reach; a failed soft task goes without at once.
- F97 (10-02, Shelf1) The mining hut's build waited 1.3 min for a log gather task (t192) although storage already held
  224 birch logs (prepare_site's felled trees, deposited at 2.5 min); Worker1 meanwhile had only the futile sand tasks.
  Backlog: a build whose needs storage covers does not wait for its gather tasks (close them).
- F98 (10-02, T.3 review item, B) find_site's wood count: from the y 96 shelf it reported 58 log blocks within 48 of a
  valley site with 1,150 tree blocks on it (the floor at the bot's y - 16 left the valley's trees out). Fixed: each log
  is judged against its own column's ground (the survey grid, else `surfaceAt` per column, cached), and (the diff
  review: a hill site counted the valley's trees under it, which collect and plan_layout refuse) not more than 16 below
  the candidate's lowest ground, as collect counts. After, the same valley site from y 103: 846 reported, 1,169 real
  (old rule 34; the rest of the gap is the search's 4,096-log cap, ~8,300 logs within 128 there: left, a soft warning in
  site.py); the hill site -1610,-168 (y 101): 1,064 reported and real, mostly oak (birch before, from the valley); from
  Shelf2's mine at y 89: 998 for a valley site. Left: logs outside the survey grid cost one `surfaceAt` per column
  inside findBlocks (a few thousand `blockAt`s; more for find_site given far-off x, z), no `[lag]` beyond the normal
  spawn stalls seen.
- F99 (10-02, Drop2) A preparer suffocated in its own fill: runJob set blocks by command with no check for players
  ("Worker1 suffocated in a wall" a minute in; damage from tick 811 during prepare_site's job), respawned ~540 blocks
  away (lesson 37) and was lost to the run. standBy stood south of the plot but inside prepare_site's filled margin, and
  a failed walk there was ignored. Fixed: standBy stands outside the job's claim (plot + margin, or a build's footprint
  + 1); no block goes into a player's body (bots and people, not spectators): the builder walks out once, agents
  still in the way are teleported to the stand spot, people's cells wait for the end of the job (three tries) and are
  then left out; a door's two halves are one command (the review: a deferred lower half left a lone upper one that
  the walls then broke). Drop3 (before the teleport): Worker2 idle at its spawn on the plot held a grass block four
  times; Drop4: one teleport, done.
- F94 fixed (10-02): a leafless log group is a fallen tree when it is one straight row of up to 16 logs of one kind
  lying along x or z, touching no other log or built block, at least half on natural ground, nothing solid on top,
  outside every village; such rows are cut from the ground. One-log stumps and everything else leafless count as built
  and are passed over in the candidate search itself (shared `bad` marks, no failure). The design review measured the
  snapshot: 215 leafless groups, 140 one-log stumps, ~58 lying rows of 1-9 (57 pass), 17 by built blocks (none
  pass). F94's row is -1711,67,-208..-206 (the stump at -210, where Drop1's collect gave up).
- F100 (10-02, Atlas4) The atlas (and bestSite) can choose dense jungle: Atlas4's site had 1,708 tree blocks on it and
  the storage task's whole-tree felling brought 97 logs for 10 (6.7 min), a 9-log task 45. Jungle's giant trees cost
  minutes each (F62); neither score knows. Backlog: weigh tree kind (or tree blocks per log) in the site scores, or
  stop felling at the task's count on 2x2 trunks.
- F187 (10-08, twenty-second session, VanW8) Four `[stuck]` lines for Worker2 at -1589.5,61,39.3, east of Minevale31's
  plot, on its walks back to the storage (moved 0.0-0.4 in 10 s each, path "moving" or empty); it recovered without a
  rescue. Not seen in VanW7 or VanW9 on the same site; watch for it (F170's family?).
- F186 (10-08, twenty-second session, VanI5) **A deposit walk from the deep dug a shaft under the storage hut**: a worker
  left at y 11 after an iron trip (fallen into a cave below the level; the trip's walks up failed quietly) walked to the
  storage, and the pathfinder, free to dig below protected ground, dug straight up from y 11 to y 58 under the hut and
  stalled there (106 s `[stuck]`). Fixed: after a trip a bot still below the mine's top step is teleported home, never
  walked; the trip ends rather than make a pickaxe down there (its walk for logs is free to dig). Lesson 31 again, deeper.
- F185 (10-08, twenty-second session, VanI7) Five iron stairs attempts (about 120 steps) and the tunnels wore out both
  pickaxes (~400 digs: stone 131 uses, iron 250); the trip ended "no pickaxe left" and the next made two stone ones at the
  hut. Works as designed; a trip could carry three on cave-riddled ground.
- F184 (10-08, twenty-second session, VanI7) A second iron pickaxe instead of the bucket: the first was made from stored
  iron before any trip had made `mine.iron`, so it was never recorded as made. The made tools and the iron chores'
  back-off live on the mine now (`ironMade`, `ironTries`, `ironLastTry`).
- F183 (10-08, twenty-second session, VanI4) The iron level settled at y 39 (stairs stopped there on their second try) and
  dug 87 tunnel cells past no ore at all: the snapshot holds 3 iron ores in the whole stretch at y 37-42
  (`runs/2026-10-08/s22/ores_along.py`). A level above y 28 is now dug only when no try is left (IRON_GOOD_Y 28).
- F182 (10-08, twenty-second session, VanI2/VanI3) minevale3's ground under VanG's site is full of (dripstone) caves at
  y 40-45: the iron stairs met "no floor" at y 44, then 45 two blocks over, then 41; with one try the iron age ended at
  once. Stairs stopped above the settle line are now given up (kept and protected as they are) and new ones start
  elsewhere on the level, their whole line at least 8 blocks from where earlier ones stopped, up to 5 tries.
- F181 (10-08, twenty-second session, the iron diff review) Strict digging (no forced digs in the iron level) would have
  stopped every trip at a gold or emerald ore a stone pickaxe cannot take, then given the dig stage up: strict only for
  iron and coal now; other ores are dug through (counted as lost).
- F180 (10-08, twenty-second session, VanI1) No iron stairs start beside the bottom step: with two or three miners the
  cobblestone mine turns tunnels off both its sides (StageM7's second face), so the first rule found no clear side and
  marked the iron level finished. Now any dug cell of the deepest level in any direction, nearest the stairs first,
  keeping off live tunnels' next two stretches (`iron_start_check.mts`: a start in all 27 recorded mines).
- F179 (10-08, twenty-second session, VanX3; the log analysis `runs/2026-10-08/s22/research/f179_analysis.md`) Worker2
  dug two shore sand columns on minevale3's lake (-1685..-1684, z -3) into a buried water pocket; the 3-deep trench
  flooded and every walk out (a jump-up whose floor had to be bridged over water, sneaking toward the edge in the current)
  pinned it against the wall: 6 `[stuck]` lines, 2.6 min, no rescue (collect's walk timeouts are not action failures; the
  stall check skips a "busy" pathfinder; collect has no unmoved give-up). F166 was the same cell. Fix: beside water collect
  takes a cell only when that water is the open surface (air over it).
- F178 (10-08, twenty-second session, the iron design draft) `makeFromStock` fetches only `plan.fromStock`, while the
  materials plan counts coal in storage as fuel (mcMaterials.ts ~344-347): a smelt that should burn stored coal fails
  "no fuel" unless the bot carries planks or logs. Latent (no coal reaches storage today); live for glass as soon as the
  mine keeps coal. Fix with the iron age.
- F177 (10-08, twenty-second session, VanX2) Collect takes a sugar cane stalk's upper blocks only (the base is left so
  the wild cane grows back): a 2-high stalk gives one cane, so the three fixture stalks gave 2-3 canes and the cane farm
  was planted with 3. Enough for a start (it grows and is harvested: VanX2 6 then 2 more).
- F176 (10-08, twenty-second session, the plant scan) Farm plants are rare near the test sites: none of sugar cane,
  pumpkin, melon, berries, bamboo or crops within 96 of minevale3's usual site or VanG's (pumpkins ~136 away), a few at
  other sites; pigs, sheep and chickens near every site. The opportunity rule will seldom fire on plants alone; animal
  pens (chickens first: seeds are in stock) are the next kind (`research/plants_scan.md`). The staged test plants
  fixtures by command (`stage_village.py --fixtures`).
- F175 (10-08, twenty-second session, VanX2) Two explorers out at once: `choreBusy` looked the chore's agent up by its
  name, but `MineflayerWorld.agents` is keyed by the lower-cased name, so a running chore never counted. Fixed (VanX3).
- F174 (10-08, twenty-second session, VanX1) **The agent server hung for good** when the first farm start collected
  sugar cane: `mineBlock` answered "nothing to mine" at once for a block with no collision box unless its name was a
  grass, fern, bush, flower, sapling or snow, so collect counted nothing, found the same cane again and looped; every
  await in that loop settled at once (microtasks), so the event loop never ran again: the API timed out, no `[lag]`
  line (it is logged after a stall ends). Found by attaching the inspector to the running process
  (`node -e "process._debugProcess(PID)"`, then `runs/2026-10-08/s22/cdp_stack.cjs ws://...` pauses it and prints the
  stack). Fixed: cane and crops in mineBlock's plant list, and collect counts "nothing to mine" as a failure of that cell.
- F173 (10-08, twenty-first session, the #3/#4 diff review) Left: the lamp job's runJob moves a player standing in a lamp
  cell to its stand spot by the storage hut, so a builder walking a street over a lamp cell could be moved mid-walk (it
  recovers); desert lamps over-count logs in the cover rule (sandstone posts); before a plot is prepared collect has no
  depth floor (as before). Not seen in VanO4.
- F172 (10-08, twenty-first session, the stations review) Accepted for now: the architect's budget checks and the vanilla
  library's accept still count a design with its own table and furnace, plan_layout's one-landmark check now without
  them (a design at 151-160 units may pass as a house); the mining hut bills no table (planks only).
- F171 (10-08, twenty-first session, the F164 reviews) Left from F164: an undone move leaves the log tasks it closed as
  done (the build recovers through requeue); `given` (a builder without the claim) can pick the other copy's label;
  a one-kind plan reached without the search is not recorded; requeued gather tasks are labelled by the design name,
  not the task label (pre-existing, copies 'cottage 1/2'); failed builds still reserve logs.
- F170 (10-08, twenty-first session, VanW3) A deposit failed once "could not reach the storage hut (no path ... stopped
  at -1621,59,37)": a miner at the mine's level found no path up to the hut; the next deposit worked. Watch for more.
- F169 (10-08, twenty-first session, VanH2) light_streets failed once "short of 3 birch_fence (carrying 3, storage has
  0)" and was re-run 0.5 min later: the lamps' fence planks went to something else made from storage first (F165's
  family: the craft skill's own plank choice or a generic step taking the spare kind). Self-healed; backlog with F165.
- F168 (10-08, twenty-first session, VanH1) Ripe wheat gives 1 wheat and **1-4** seeds (1 + binomial(3, 0.571), mean
  2.7: 49 and 42 seeds from 16 crops), not 0-3 as reports a and c read it: the bonus adds to the entry's count of 1. A
  harvest always pays its own resowing; a cell is left bare only when the server's counts fail (then it is sown
  uncharged). Surplus ~27-33 seeds a harvest goes to the misc chest.
- F167 (10-08, twentieth session, the diff review's rows test) Tight rows plots (street 2) leave no room for a 5x7
  field; those villages get no farm (rows are the fallback; street and green plans got one in all 15 offline layouts).
  Accepted.
- F166 (10-08, twentieth session, VanF3) A lake-shore pit on minevale3 (-1684,60,-3) sealed Worker2 in while gathering
  sand; the rescue teleported it home ("no path home"); 3 failed collects. F157's family (a 1x1 pocket by the lake), not
  the farm. Backlog.
- F165 (10-08, twentieth session, VanF3 and Minevale31) The sign job's result says "could not craft 12 birch_planks ...
  short of 1x birch_log (made 8 so far)" yet puts up every sign (runJob's second pass). Likely: the craft skill chooses
  the stick recipe's planks itself (`bestPlanks`, ties to birch) and saws a birch log meant for the sign planks;
  `spareKind` guards only the plan's `any:` steps (lesson 88's class). The farm made it likelier (the hoe used the spare
  sticks). Harmless; to confirm, log `plan.steps` and the inventory before each makeFromStock step. Backlog.
- F164 (10-08, twentieth session, the Minevale31 analysis; **fixed 10-08** `5f3e133`, whole buildings, see the decisions) The "covered by stock" rule (village.ts ~307-334) counts only
  the village's wood kind, so ~150 oak logs from prepare_site's felling never cover birch log tasks: the mining hut waited
  for three log tasks with 200+ logs in storage, ~1.5 min in Minevale30 and 31. Counting all logs would mix kinds in builds
  (the user's call): the first candidate of the opportunities analysis.
- F163 (10-08, twentieth session, Minevale31) The farm cost ~1.0 min: the waiting mayor took the seed tasks first
  (`mayorGatherPick`), not the mining hut's logs, and the build chain ran a minute late; the "Gather 1 logs for the farm"
  task felled a whole tree for a log storage held. Fixed in `e28198e` (posting order, no log task); VanF5 8.9 min.
  Lesson 91.
- F162 (10-08, twentieth session, VanF2) `mineBlock` walked to a plant with `GoalLookAtBlock`, whose ray test needs a
  collision box: a plant has none, so the goal never ended and every grass walk stalled ~11 s "stuck" (the Mayor 3 of 8
  seeds in 1.5 min). Its "dug on the way" test (an empty box) also returned at once for every plant without digging.
  Fixed before the commit: walk within 2 of a plant, "dug on the way" by the block's name changing. Lesson 90.
- F161 (10-08, nineteenth session, the signs' diff review) Left from the name signs: `put_up_signs` (like
  `light_streets`) reads the sign and wall cells before walking to the storage hut, so a worker far off (members range up
  to 96 blocks) skips "not loaded" signs and the task still ends done; `holdsSign` judges a support by name (accepts
  vines, glow lichen and crops; refuses sea lanterns and mushroom blocks; only house walls reach it); a village without
  `v.wood` (staged) places oak signs swapped to the storage's wood (works, says "built with birch"). Backlog.
- F160 (10-08, nineteenth session, VanS1) The design API records every posted design as `by: 'api'` whatever the body
  says (mcApi.ts ~73), so the signs' vanilla labels (keyed on `by === 'vanilla'`) missed the staged runs' vanilla pieces:
  "Plains small / house". Fixed before the commit: a vanilla piece is also known by its jar name
  (`<biome>_<kind>_<n>`). Lesson 89.
- F159 (10-06, eighteenth session, the lamp diff review) Left from the street lamps: `placeLamps` keeps off the 3 cells out
  of each building's entrance door only (that rule never excludes a cell: they are street or path cells already); six
  library houses have a second outside door, whose walkway gets no lamp today by geometry only (0 in 96 layouts).
  stockCovers looks only at "Build" tasks, so requeued lamp gathering runs even when storage holds enough;
  `stage_village.py --stage build` stocks no lamp materials (the lamps requeue a gather round there). Backlog.
- F158 (10-06, eighteenth session, mayorbench) With a drawn "cottage" in the library beside the vanilla houses, the named
  nudge laid out cottage, cottage, plains_library_2 in 12 of 12. Valid, but not the library's village and a slower
  house. The source in Minevale26 was the executor running plan 1's design step during plan 2 (fixed in `52f5b19`).
- F157 (10-06, eighteenth session, Minevale29) The Mayor's first sand deposit took 1.0 min (others 0.2-0.4): three
  `[stuck]` lines at -1673.5,62,-21.3, a 1x1 pocket on the lake shore 20 blocks south of F150's spot (feet `###/#.#/~#~`,
  head `###/#.#/...`), water 0 ticks, forced 0, fwd 6 jump 3 of ~204 ticks (the stand-still branch). Each re-search gave a
  partial path whose first node was the jump south (the way out) and then a "success" path starting east and 2 up (no
  jump reaches it), which the walk followed. The walk's fourth leg direction got out with no rescue. Probably its own
  sand-dig hole (lesson 70's pattern; not logged). Not F150 (no water) nor F147 (no set-backs). Off the critical path.
  Evidence: `runs/2026-10-06/s18/minevale29_analysis.md` section 2 (A:35-37 of `testagents-163217.log`).
- F156 (10-06, eighteenth session, Minevale29) The lamp job's first try failed "short of 1x birch_log (have 0)" while
  making from stock: the plan fetched 2 birch_log for the fence planks and 2 oak_log for charcoal, and the smelt took
  the first log carried (the birch). requeueBuild posted nothing (storage covered it); the executor withdrew 2 birch
  and retried: lamps lit 0.4 min later, ~0.6 min lost. Fixed after the run: charcoal from `spareKind`'s logs
  (makeFromStock). Not yet run again (the user's choice). Left (the fix's review): the smelt's fuel (`addFuel`, mcSurvival.ts
  ~1280: coal, then the first planks, then the first log in the window) is not tied to the plan's fuel planks, so it can
  still burn the fetched planks or logs; storage coal is not fetched as fuel. A preferred fuel kind from makeFromStock
  would close it. Evidence: `runs/2026-10-06/s18/minevale29_analysis.md` section 1 (W:122-125 of `Minevale29.log`).
  Confirmed 10-08 (Minevale30): the lamp job ran in one pass, 2 charcoal from spare logs, 0 failed actions.
- F155 (10-06, seventeenth session, Minevale26) The mayor's late layout cost ~3.1 min: its second plan (0.2 min, the
  library just filled with vanilla plains pieces) returned "prepare_site, wait" without plan_layout; code dropped
  prepare_site and kept "wait", and plans 3-5 were "wait" or board-watching steps, while the executor improvised (find_site
  again, 6 explores, 3 repeat refusals). The guard that asks for plan_layout when nothing is laid out (tieredBrain.ts
  ~1230-1254) fires only on an empty plan, so a lone "wait" step escapes it; and on an empty plan its second reason ("draw
  any design the objective still needs ... then call plan_layout") overwrites the first ("the site and the designs are
  ready: call plan_layout now"), which led to a drawn 13x13 hall (378 blocks, 3.2 min to build, 11 glass) instead of the
  library's plains_library_2. The executor also ran plan 1's design step while plan 2 was being made. Later phases were as
  fast as Minevale25's (prepare 2.5, storage 1.7 min; collect rates equal or better). Backlog (a behaviour change, the
  user's call): treat a mayor plan of only wait/monitor steps with nothing laid out like an empty one, and keep "call
  plan_layout now" when the library already holds what the objective needs. Evidence (pointer added 10-06): the full
  timeline with log line numbers is `runs/2026-10-06/minevale26_analysis.md`; the mayor's plans are lines 5-22 of
  `runs/2026-10-06/testagents-131705.log` (Minevale25's plan 2 called plan_layout at once: line 9 of
  `runs/2026-10-05/testagents-181638.log`, the same first plan and prompt). Code at 7489931: tieredBrain.ts ~1222-1231
  (worker steps dropped; the "call plan_layout now" reason only when the plan ends up empty), ~1233-1254 (`nothingYet`,
  the empty-plan branch and its "draw any design" reason ~1252), `fillVanilla` ~322-334 (fills the library after
  find_site and returns the prompt's library sentence), `WORKER_WORK` ~421; the executor tick does not wait for a pending replan (`planPending` ~616/890/936/978:
  plan 1's design step ran during plan 2). `scripts/bench/mayorbench.mts` replays the mayor's prompts (add a case: a
  site found, the vanilla library filled, nothing laid out). **Fixed 10-06 (eighteenth session, `52f5b19`)**: mayorbench's
  new F155 cases (12 samples each): Minevale26's second call 8/12 plan_layout as it was, 12/12 with find_site's reason
  ending "call plan_layout now"; the empty-plan nudge 2/12 and 0/12 as it was (7 and 11 drew a design), 12/12 naming the
  library. Code: wait-only plans with a site and nothing laid out count as empty; the nudge names the library, keeps a
  reason already set, repeats a refused plan_layout's advice while site and library are unchanged, at most 3 a site;
  the mayor's executor waits for a pending replan; a completed plan's pending reason goes to the planner; a drawn design
  marks its step; no "draw" reason once laid out; the timed review skips a worker running a code-posted step for up to
  three intervals (G4). Two reviews found 10 real problems first (a refusal loop, failures getting round the cap, a
  step_done after an auto-marked design...). Minevale27/28 laid out at 0.2/0.1 min, 14.2/14.4 min, 0 failed actions.
- F154 (10-06, seventeenth session, the F131 reviews) The pathfinder's exclusion weights are bans, not costs: movements.js
  refuses any break whose `exclusionAreasBreak` weight is 100 or more, and every move costing over 100 is dropped, so
  `exclusionAreasPlace`'s 1000 bans placing too (botAgent.ts's comments say "never" in effect). A village's mine sealed at
  its doorway therefore searches as `noPath` within milliseconds, for walks and the rescue's search alike. Left from the
  reviews (judged, not changed): a bot in **no** village is out only under the open sky (the user's choice), so one
  stalled in a cave walks four directions, climbs, and may be teleported to the world spawn (only Gus is ever in no
  village); with home unloaded and the loaded area boxed in, `noPath` could read a free bot as sealed (unlikely in 5 s).
  `test_rescue.py`'s trap sites keep sinking (ground at -20,-35: 60 then 57 this session, F149).
- F153 (10-06, seventeenth session, the F148 review) Two pre-existing pathfinder edges, not seen in any run: (a) after a door
  is opened (`useOne`), `placingBlock` becomes undefined while `placing` stays true; a bot carrying dirt would then read
  `placingBlock.y` (index.js ~536) and throw inside `physicsTick`, and the agent server has no `uncaughtException` handler
  (no TypeError in any run log so far); (b) walkOnce's `arrived()` tests the floored position and the raw one, not the
  cell above as the pathfinder's own `goal_reached` does (index.js ~590): a bot on a slab or path block can be told "no
  path" at its goal. Backlog.
- F152 (10-06, seventeenth session) F131's success test reproduced and fixed. `test_rescue.py tunnel` (a sealed cobblestone
  tunnel 15 long, Gus at its east end): the rescue said "walked out to -27,62,-35", still sealed; a stone shell does not do
  (walks dig natural stone; the mine is protected, F154). In a village's mine (VanM6, VanG13: a member at -1555,58,-56 /
  -1639,58,30, the mining hut's doorway sealed with dirt) the old walk-out would have walked the tunnels. Fixed (51f10a2):
  out = a path home exists (search only), no path = sealed in (no walking), a timeout counts as out; no climb for a
  village member on village ground, the climb never digs or pillars into any village's ground. After: tunnel teleported;
  the sealed mine teleported to the storage hut in 2 s ("sealed in (no path home); on village ground, not dug out"); with
  the doorway open Gus walked out in 6 s and no rescue came; pit/box/pool as before.
- F151 (10-06, seventeenth session) **F148 explained: the pathfinder's partial paths corrupted its own search.** The
  `[stuck]` line's new fields caught it in VanG11 (same spot, 11.5 s): goal GoalNear -1659,65,8 range 3.50 (craft's
  `reach(table, 3.5)` to the storage hut's crafting table, not placeChest's aisle: `at()` floors, so the label was the
  table's cell), "update partial len 16 ... last -1661.5,65.0,6.5 NOT end x3, update success len 15 ... last
  -1661.5,65.0,6.5 NOT end", path empty for 10 s, goal still set. When a search runs past its tick budget (7.5 ms at 2x)
  monitorMovement takes the partial result and `postProcessPath` moves its nodes to cell centres in place; those nodes are
  the A* open set's own (`reconstructPath` pushes `node.data`), so the search, going on, judged `isEnd` on the shifted
  coordinates: cell -1662,6 is 3.61 from the table, its shifted copy 2.92, "success". The walk ended a cell short and,
  `pathUpdated` being true, the pathfinder never searched again. Outside the hut only x -1662, z 7-9 lie within 3.5 of the
  table, so the walk round its north side ended there whenever the search went partial (VanG8, 9, 11; not VanG10, 12).
  Fixed (bd174c1): `patches/mineflayer-pathfinder+2.4.5.patch` copies the nodes into paths (toBreak/toPlace stay shared:
  the review found slices would send a bot back to a door it had opened), and walkOnce re-sets the goal after 1 s of an
  empty path with no search going on (`[repath]`, twice a walk). Since: VanG12, VanP1, VanM6, VanG13, VanM7 no `[stuck]`,
  no `[repath]`. F133 (a move_to 2 blocks short of the storage spot, 10-04) fits the same mechanism. Side result: Gus's
  `move_to` onto a workstation row lifted the target onto the hut's roof (y 68) and searched partially for 10 s (the
  F148 grid, `runs/2026-10-06/f148_grid1.log`): correct behaviour for an unreachable goal.
- F150 (10-05, sixteenth session, Minevale24 and 25) The Mayor's sand gather on minevale3 walks to sand at -1688,62,1
  through water and times out after 23 s (443 of 463 ticks in water, half of them busy placing or digging; moved 3.9)
  in both runs, then gets its sand another way; ~25 s a run, no failure. Backlog (collect's approach to shore sand).
  Both runs' `[stuck]` lines end at -1679.50,61.1-61.5,-2.50 with feet `y60 ~##/~##/###`: in the lake's edge west of
  the shore birch, y 59.00-62.25; full lines in `runs/2026-10-05/testagents-160003.log` and `testagents-181638.log`.
  The site is the same every run (the mayor takes -1628,65,47), so a staged `--mayor` run on minevale3's 40 site may
  reproduce it without models. 10-06: not reproduced: Gus collecting 4 x 6 sand from the storage hut's doorway (20-40 s
  each, `runs/2026-10-06/f150_repro2.log`) nor staged VanP1 on that site (3 sand tasks at ~3.7 min; the Mayor's stall
  came on a later one, ~14 min in, after the shore had been dug). Waits for a model-driven run (the user's choice).
- F149 (10-05, sixteenth session) Small things seen on the way: `test_rescue.py` on the test world (`MCAI_API` now
  points it there) builds its traps at -20,-35 outside every restored site, and each run digs the pit deeper (ground 69,
  66, 63); short pickup walks (timeout 5 s) timed out once or twice a run and their `[stuck]` lines said nothing new
  (no longer logged); felling's `cutInReach` and pillarDown's direct `bot.dig` skip F147's dig check (the review; both
  retry in later passes), and so do the pathfinder's own digs on a walk (`[stuck-world]` would show one). Review
  findings judged and left: a vertical climb before a stall still counts as "unmoved" for openChest (the rescue's own
  3D check in `finish` keeps it from counting); a set-back across two watchdog windows can give one false level credit
  per stretch of horizontal progress (bounded). The research behind F147 (Paper's movement checks from the bytecode,
  the rounding simulation, the class files) is kept in `runs/2026-10-05/s16/research/` (README.md first).
- F148 (10-05, sixteenth session, VanG8 and VanG9) A stand-still beside the storage hut on VanG's 40 site: Worker1 walking
  to the hut's aisle spot (placeChest, range 0.5, target -1659,65,8) went 13 blocks and stood at -1661.48,65,6.50 for
  12 s, forward held on only 60 of ~470 ticks, no set-backs, and no pathfinder event after the first path ("success len
  15"): no `reset stuck`, so not the stand-still branch; looks like the pathfinder idling with an empty path whose end the
  goal does not accept. The same spot in both runs (a reproduction); placeChest goes on from near (moved 13), so it costs
  12 s, no failure. Not chased: backlog. **Explained and fixed 10-06: F151** (the walk was craft's to the hut's table). Lead (read at the close, not tested): mineflayer-pathfinder's monitorMovement
  (index.js ~455-472) refreshes `lastNodeTime` while `path.length === 0` (so no `reset stuck`), and once `pathUpdated`
  is true and the goal's `isEnd(position.floored())` is false it does nothing until a `resetPath` (index.js:132 clears
  `pathUpdated`): a path consumed short of a range-0.5 goal idles silently. `runs/2026-10-05/s16/research/README.md`.
- F147 (10-05, sixteenth session) **F138's pit stall explained and fixed, and the mine's stalls with it.** The `[stuck]`
  tally (item 3) showed the server setting Gus back ~33 times a second (forcedMove) at -1655.39,62.42,-4.3001, mid-jump
  against the pit's south wall, forward, jump and sprint on throughout; every walk pressing south failed whatever its
  first node (south, south-east, south-west), only north got out; nothing in Paper's log. A read-only study of Paper
  26.1.2's `ServerGamePacketListenerImpl.handleMovePlayer` (bytecode) found the branch: CLIPPED_INTO_BLOCK, a move whose
  box newly overlaps a block by more than 1e-7 is refused and the player put back, with logWarning false. The cause was
  ours: with `playerHalfWidth` 0.3001 a bot stopped at a wall face stands at face - 0.3001, and adding 0.3001 back gives
  a box edge 4e-16 inside the wall at faces +-4, +-128 and +-1024 (6 faces an axis in +-3000); prismarine-physics'
  `computeOffset` has no tolerance, so the bot pressed on into the block every tick. The pit's wall face was z -4, and
  F71's pocket (stuck at -1055,66,128, "x 0.3 from the block edge") was z 128. Fixed with a half width of 1229/4096 (a
  binary fraction, adds back exactly; 5e-5 wider than the server's box): the reproduction's walk arrives in 2.0 s, the
  deposit in 3.1 s. The mine's stalls (VanG7 x2, VanM4, VanG8: set back 318-340 times in 10 s in a 1-wide tunnel) were the
  same branch with another cause: the `[stuck-world]` check found a block the server still had where the bot saw air
  (-1636,58,34), a tunnel dig Mineflayer counted done (its dig timer writes air) that Paper never finished (it breaks
  on STOP_DESTROY only at progress >= 0.7, later or never otherwise). mineBlock now asks the server after every dig
  (sand and gravel aside), up to max(450 ms, 4x the dig time), and if the block is still there puts it back in the
  bot's view and digs once more (VanG9: one re-dig, no mine stall).
- F146 (10-05, fifteenth session, the design review of item 1) openChest's errors are swallowed in more places than
  depositSorted (mcStorage ~408) and refreshStorage (~531): `newChest`'s catch (~461-465, errors from ensureChest -> take
  ~483), makePickaxe's `fromStock` (mcSurvival ~165) and the storage hut's placeChest reach (mcStorage ~212, which goes on
  to placeAt). A pinned (unmoved) stall must be rethrown in all of them, and a deposit that already put one group away
  must return that partial result with the stuck note, not fail (rethrow only when nothing moved), or the planner gathers
  it again. Failing at once also drops today's side-spot fallback for a bot 3-5 blocks from a chest on a step that stalls
  without moving: the review suggests one nearest standable side spot (~10 s) before the pinned error (changes the
  user's choice "fail at once": ask). Item 4's rule is geometrically safe (every refused jump-up diagonal leaves a
  cardinal jump-up and a step; a 1-wide diagonal staircase is refused today already), but `physical` also refuses low
  blocks (carpet, snow layer, bottom slab): test `side.height - node.y > 0.6`.
- F145 (10-05, fifteenth session, the design review of item 3) walkOnce's watchdog (mcUtil ~160-168) resets on any 3D
  move over 0.5 sampled every 500 ms, so a hop sampled near its top resets the stuck timer and stall times vary: use the
  horizontal distance, and attach the farthest horizontal distance from the walk's start to the thrown error (openChest's
  "did not move" test should read that, not a 3D distance < 1 from its own start, which a hop or `walk`'s 40-block legs
  defeat). A snapshot of the controls at the stuck moment says nothing (every 3.5 s `resetPath('stuck')`, index.js ~634,
  clears them): tally the walk's physics ticks instead (one `physicsTick` listener in `listen()`, counting while walkOnce
  sets `walkTally`): ticks with forward/jump/sprint, onGround ticks, y range, horizontal spread, `forcedMove` count with
  the corrected position, isMining/isBuilding ticks. Reading it: forward off most ticks = the "stand still" branch
  (index.js ~626-629: all four physics checks reject the next node); jump on with forcedMove = the server refuses the
  moves; jump on without = the client's physics and the server disagree; busy = a toBreak/toPlace on the path. Events
  for the ring (mineflayer-pathfinder 2.4.5): `path_update` (status success/partial/timeout/noPath, path length, first node
  x,y,z with toBreak/toPlace counts; copy numbers at once, never keep `results`, `context` (the A* closed set) or the live
  `path` array), `path_reset` (reason: goal_updated, movements_updated, block_updated, chunk_loaded, stuck, dig_error,
  place_error, no_scaffolding_blocks; only fires with a non-empty path), `goal_updated`, `path_stop`, `goal_reached`;
  `forcedMove` is mineflayer's physics plugin's (teleports fire it too). Register once in `listen()`: bots are never
  recreated, the listeners survive respawns; per-tick cost negligible with 4 bots.
- F144 (10-05, fifteenth session, a test artefact) A test bot spawned off a cell's centre within 0.3 of a wall has its box
  1e-4 inside the wall (half width 0.3001, the adapter's lesson 1): prismarine-physics does not push out of a block it
  already overlaps, the bot walks into it and Paper logs "Gus moved wrongly!" and puts it back. Two of pit_repro's four
  start spots (-1655.3/-4.3 and -1655.7/-5.7) were such: one spot of four is a real stall. Spawn tests at x.5, z.5.
- F143 (10-05, fifteenth session, pit_repro) F138 reproduced live. On a fresh minevale3 (2x), with the shore birch at
  -1657,63..66,-6 felled and VanG4's pits dug (-1656,62,-6 and -5: dry, 1 deep, dirt floor at 61, ground 62 round them
  rising to 63-66 south and east; `terrain.py` prints it), Gus (idle, survival) at -1655.5,62,-4.5 failed every `move_to`
  toward -1660,64,11 (VanG4's logs chest, SW and uphill) with "stuck at -1656,62,-5" after 10.2 s, ending within 0.2 blocks
  of the start (y 62.0-62.8: small hops, never out of the cell); east (-1645,6) got out in 2.1 s, and from -1655.5,62,-5.5
  the SW walk worked in 3.1 s. A deposit (village PitTest, one chest at -1660,66,11, 10 logs) failed after 52 s (the reach
  and four side spots, 10 s each); the rescue came after the second (~105 s) and its walk-out took 30 s more (east and
  south stalled, out to the north). The design review's replay on the real terrain gives a **cardinal** jump-up south to
  -1656,63,-4 as the first node from -1655.5,-4.5 (not the diagonal the thirteenth session's approximate replay showed),
  and gets out offline: the live bot's physics or the server disagree with the replay, so the mechanism is still open
  (item 3's tally decides it; a live check without models: from the centre of -5, `move_to` due south and due east, both
  cardinal jump-ups). Item 4 is held: from -1655.5,-5.5 it would reroute the one walk that worked onto that same cardinal
  jump. The VanG4 log analysis: Worker2 lost 3.4 min (3.1 to 6.5 min of the run), not 1.7: two deposits of ~100 s each
  (the logs group visited its chest twice, five walks each); the rescue started at the second (`movedFailed`: two move
  failures within 3 blocks and 6 minutes; `finish` counts one only when the action ended within 4 blocks of its start).
  Least time to the rescue today for a bot that cannot move: two one-walk actions ~20 s, two withdraws ~100 s, two hut
  deposits ~200 s per group carried. The rescue's `walkOut` counts > 4 blocks from the start and dry as success; its
  teleport always succeeds; it reports failed only with no home.
- F139 (10-05, fourteenth session, fell_trees.py) A refused pillar placement (lesson 29: "the block is still air") at
  -1539,63,15 left one dirt at -1538,63,14 beside the felled trunk; the same check on the old code left none (timing;
  the felling code reads the same log set). Rare; backlog with lesson 29's other placement retries.
- F140 (10-05, V2.5's inventories) Items collect accepts but can never get: vine (needs shears), ice and packed ice
  (drop nothing), snow and snowballs (need a shovel; collect makes only pickaxes), raw_gold (an iron pickaxe), leather
  (no block drops it). None is posted today (EASY_GATHER and the libraries refuse them first); a rule refusing names
  whose blocks give the bot nothing would close it (backlog).
- F141 (10-05, V2.5's diff review) With the jar's smelting, the resin family plans as "gather the block itself":
  resin_brick now has a smelt option from resin_clump, which only crafts in a cycle with resin_block, and the cost search
  returns null for an item whose every option cycles. No design uses resin; backlog (resin_clump to GATHER, or cost()
  treating a self-dropping block as gatherable).
- F142 (10-05, V2.5) Left as hand rules (noted, not changed): mcBuild ~509 and ~1170, mcUtil ~201 and ~460
  (`/water|lava/`), mineBlock's plant regex and fallenRow's in mcSurvival, the `_leaves` endsWith tests, the atlas's
  MATERIALS, the craft skill's "(try smelt)" hint (names cobblestone, misses terracotta and smooth sandstone). Crimson and
  warped stems stay in `any:logs` (charcoal; vanilla does not burn them). Partial-shape waterlogged solids (sea pickles,
  stairs, slabs) are not wet. Old atlas.json summaries take the new categories only on rescan. The renderer draws
  tinted glass, slime and honey opaque in jar mode (the jar marks only force_translucent sprites).
- F138 (10-04, thirteenth session, VanG4) With F136's water checks in, the side pickup still dug two dirt pits beside
  the felled shore birch (-1656,62,-6 and -5), and `pickUpDrops` walked the bot into each; from the second, every walk to
  the storage (10 per deposit: the chest's reach and four side spots, two chests) stalled "stuck" for 10 s without
  moving, 1.7 min, until the rescue's straight walk-out east freed it. An offline replay of mineflayer-pathfinder 2.4.5
  and prismarine-physics on that terrain gets out in 9 ticks (first move a diagonal jump-up across the pit's corner), so
  the stall's mechanism is unproven (the "stand still" branch or a stale `returningPos`; the diagonal guard checks side
  cells only at y+1/y+2 for a jump-up). Fixed at the cause: side pickups take only blocks at or above the bot's feet
  (banks), no pits. Backlog: `openChest` gives up its side spots after a "stuck" that did not move the bot (the rescue
  then comes in ~20 s, not minutes); a straight step out toward the goal inside `walk` on such a stall; log the last
  `path_update`/`path_reset` on "stuck" to settle the mechanism; refused jump-up diagonals with a side solid at foot level.
  Reproduced live on 10-05 (F143); the leftovers' design and review in F144-F146 and the decisions of 10-05 (s15).
- F136 (10-04, thirteenth session, VanG3) A side pickup dug a gatherer into the lake: after felling the shore birch at
  -1657,63,-6, `sideGather` (mcSurvival.ts ~843) took 2 dirt the village needed within 4 blocks, nearest first, without
  skipping the block under its feet or blocks with water beside them; the lake flooded the holes (-1657,62,-5 and
  -1656,62,-5 water after the run), the bot stood in water, `walk`'s swim-out and the pathfinder's jump-up out of water
  failed, and the rescue came only after two failed moves (7.2 min, 3.9 lost). Fix (backlog, low risk): skip its own
  column and any block with water or lava on a side or above (`wetAround` beside `wetAbove`), also in `dirtForClimb`; a
  faster rescue when still stuck in water after the swim-out.
- F137 (10-04, thirteenth session, VanG3) Sand under a lake bed passed collect's `dry` filter (mcSurvival.ts ~700): it
  checks only the block above, and sand at -1665,59,-7 had sand above it and water above that. Within 16 blocks as a
  buried candidate and cheaper than exposed sand 20 blocks off, the Mayor tunnelled to it; the sand fell and the lake
  poured in (3.8 min for 6 sand). Fix (backlog): for falling blocks follow the column up through sand and gravel and
  reject the candidate when water comes first; reject buried candidates with a wet face. The green's storage hut on the
  plot's north edge put every gatherer's start beside that lake (chance decided which run met it: VanG1 needed no dirt by
  then and its third sand task went to another gatherer).
- F133 (10-04, thirteenth session, Minevale21) The storage task's `move_to` to its spot in the storage hut's area stuck 2
  blocks short (-1519,68,-69 for -67), right after prepare_site; Worker1's executor got there 0.3 min later (2 calls).
  Not chased: backlog.
- F134 (10-04, thirteenth session, V2.3m's diff review) A stopped action is not reported: `BotAgent.stop()` aborts the
  running action and its `finish` returns early, so no `action_failed` comes. TaskBrain (the scripted workers too) then
  waited for good and held its task (death, the panel's stop button, a replace). Fixed: idle while waiting means the report
  was lost; the call runs once more, then the task goes back. The review also found the runner taking the tiered brain's
  refused calls (an `action_failed` with no action id) as its own (now only its own id), "the village mine gave no ..."
  covering a missing pickaxe as well as a busy mine (now "the mine is busy" only), and `deposit item=all` leaving out
  junk (dirt for a floor, F132) once a task is handed back (now the task's own item by name).
- F135 (10-04, thirteenth session, V2.3m) The mayor's gathering gained 27% staged (2x) but 17% model-driven (1x): the
  first ~4 minutes (prepare_site, the storage task) give it nothing to take, and most log tasks are closed by the felled
  wood in storage (F97), so its work is cobblestone (5 of 8 tasks in Minevale21) and sand. A reply to a person waits
  behind its collect (up to ~6 min): fine while nobody talks to it; phase 3 must interrupt.
- F132 (10-04, twelfth session, Minevale19) Dirt is junk to `deposit item=all`, so a task gathering dirt (4 for
  plains_library_2's floor) could not deposit it. Fixed: junk counts when the depositing agent holds a claimed task to
  collect it (a miner keeps its dirt: with the village's needs as the rule, the review found every miner would empty its
  scaffolding into storage).
- F131 (10-04, twelfth session, Minevale19) The mine sealed by a stand spot: the storage hut's builder stood "3 south of
  the claim", which in the street plan is the mining hut across a 3-wide street; its footing search (24 up and down) chose
  that hut's roof, and the walk there pillared dirt on the street in front of the hut's doorway. The miner inside, told by
  deposit's failure to craft a chest, put a crafting table down in its tunnel and walled itself in; the rescue's walk-out
  counted 4 blocks moved as success. Fixed: no placing on village ground in any walk (`exclusionAreasPlace`), stand spots
  on four sides at the job's level first and off every building and the mine, walked to without scaffolding; no tables or
  furnaces in a mine; a deposit with no path says to walk back. Backlog: the rescue's success test and its climb on
  protected ground (the analysis, `runs/2026-10-04/`), and the mine's doorway repaired before walking in. The evidence
  (pointer added 10-05, s16): `runs/2026-10-04/Minevale19.log` lines 91 and 96: the rescue "walked out" 7 blocks along
  the sealed tunnel (-1553,58,-28 to -1560,58,-28; `walkOut` counts > 4 blocks and dry as success, mcRescue.ts ~38-52),
  the next rescue's climb failed ("the block did not go down underfoot") and it was teleported to the storage hut.
  10-06: the success test and the climb on village ground fixed (F152); the doorway repair stays in the backlog.
- F130 (10-04, twelfth session, V2.3) Every desert town centre holds water (wells and basins) and savanna's only one
  without water is 13x12: a 32x32 pad holds a centre, its streets and only four or five buildings, so desert villages and
  most savanna ones get crossing streets. Larger pads (V2.4's ~40) or water placed by command (the user chose no water)
  would bring the centres back.
- F129 (10-04, twelfth session, V2.3's reviews) Street plans and the build's claims: every build claims its area plus a
  block and refuses recorded structures in it, so streets cannot be buildings (laid by prepare_site instead) and
  neighbours need 2 blocks between them; a greedy placement left half the pad unused (a beam search fixed it); a
  centre's plaza path was charged as dirt while the streets were free (laid free now).
- F128 (10-04, twelfth session, V2.2's rotation check) Gravel on a prepared plot: prepare_site at -1580,-82 passed its
  after-check, then build_design found 6 gravel at y 65-66 ("the ground is not level here (heights 64..66)"); gravel from
  the cut's edge slid in after the check. Rare (land with gravel near the surface). Backlog: prepare_site's after-check
  could look again for falling blocks, or cut gravel back from a plot's edge.
- F127 (10-04, twelfth session, V2.1's design review) Two gaps found in existing code: a stripped log in a design was
  planned as "gather stripped_oak_log", which EASY_GATHER's `.*_log` let through though collect cannot gather it; and
  doorOutward faced every door without a way out (an inside door) south, sideways in a wall running north-south. Both
  fixed (stripped logs and bark blocks charged as logs; such doors face across their wall).
- F126 (10-04, twelfth session, V2.1) Seven pieces are larger than a design may be (15 across, 12 layers): plains_library_1
  (11x17), the plains butcher shops and stable, the taiga and snowy temples, desert_small_house_6 (a tower). Left out; a
  landmark's limits could be raised when V2.3 wants them.
- F125 (10-04, twelfth session, V2.1) Snowy houses of snow blocks or packed and blue ice (igloos: snowy_small_house_1, 4,
  5, 8, medium_house_1, 3) fail as hard to gather (snowballs, ice), as the user chose; snow piled outside a house's walls
  (a snow block with open space above it) is ground ("_").
- F124 (10-04, twelfth session, V2.1's reviews) Five pieces' entrance door opens on another side than the entrance
  jigsaw's (a yard or porch, the path round it; houses built into slopes): plains_weaponsmith_1, snowy_fisher_cottage,
  snowy_weapon_smith_1, taiga_medium_house_1, desert_cartographer_house_1. Refused rather than guessed; the front could
  be taken from the door's way out instead (backlog).
- F123 (10-04, twelfth session, V2.1) 33 of the 152 "houses" have no door: farms, animal pens, meeting points, the desert
  temples and two taiga smithies (open forges). They are a village's yards and decorations, for V2.3 (soft tasks).
- F122 (10-04, twelfth session, V2.1) Taiga houses are log-built and mostly over the house budget: 15 of 19 valid pieces
  cost 158-300 gather units (a log is a unit; planks a quarter), a 7x7 taiga house ~160. Only 4 taiga pieces pass. The
  budget's choice is the user's (keep 150, or allow vanilla houses more; gathering logs is the slow part, F117).
- F121 (10-04, eleventh session, Minevale18) The mayor's site search on minevale3 sometimes takes the site at -1507,-62
  (Minevale13, 18) instead of -1564,-35, and there the mine gave cobblestone at ~8 a minute against ~25: runs on the
  same test site are not always comparable. Pin the site for acceptance runs (the watcher already finds -1564,-35; the
  mayor's own find_site differs), or record which site a run used.
- F120 (10-04, eleventh session, Minevale17) A failed design costs minutes: the mayor replanned the same design step
  about ten times in four minutes (2.3-6.5 min) after design_building failed, until it changed the brief. Made rarer by
  pointing refused hand drawings at submit_style; the replan loop itself is open (backlog).
- F119 (10-04, eleventh session, D.3 benches) A revision round does not fix a hand drawing: shown its elevations and
  "the west wall is open above the eaves (16 cells)", gpt-oss redrew the same open gable ends or broke the design (0 of 8
  improved). What helps is keeping the architect on styles: code fits a style to the budget (shrinkStyle) instead of
  refusing it, and a flat hand drawing shown back comes back as a style.
- F118 (10-04, eleventh session, Minevale15) The cottage was drawn by hand as a flat-roofed plank box, though the same
  brief gives a style with a stair gable 10 times in 10 in designbench; design() does not log refused tries, so whether
  a style was sent back first (the 150 budget) is unknown. To do: log each try's refusal; D.3's flat-roof lint.
- F117 (10-04, eleventh session, Minevale14) The landmark budget lets the architect draw a hall that dominates the
  village: "a spacious community hall" became 13x13 walls (536 blocks, 210 stairs, 295 of 300 units), the second cottage
  no longer fitted the site, and the run took 23.2 min. Gather units are only part of the time: placing and crafting
  hundreds of stairs counts too. A cap on landmark walls (e.g. 11) or a lower landmark budget would bring runs back
  towards Minevale10's 14.6 min.
- F116 (10-04, eleventh session, Minevale13) A second site's prepare_site overlapped the first plot's live reservation
  (its 2-block margin reached 2 rows into it) and failed twice: find_site keeps off plots, structures and layouts but
  not off another agent's reservation plus prepare_site's margin. Backlog (packing by walls makes second sites rarer).
- F115 (10-04, eleventh session, Minevale12) Two design failures, both code gaps: design() retried only on refused
  designs, so a model call error (a cloud 500) ended a design outright; and the mayor briefed the hall with "a
  crafting_table and furnace" inside, which a style cannot express, so the architect drew it by hand and kept the
  table through all three tries. Fixed: a failed call is one try; workstations and containers in a survival
  hand-drawn palette become air with a note (as fixDoor moves a door). The mayor's briefs ask for furniture often
  (designbench's brief does not): briefs might be checked or trimmed in code too (backlog).
- F114 (10-04, eleventh session, designbench) Styles refused for small things: gpt-oss named the roof's material
  "oak_stairs" (7 of 20 first tries) and chose stone-brick walls for halls needing ~190 furnace runs, three times over
  despite the hint. Fixed in code (lesson 11): `_stairs`/`_slab`/`_wall` stripped and wood names read as planks;
  `fitSmelts` swaps stone and stone bricks for cobblestone and glass for panes until the design fits MAX_SMELTS, with a
  note. After: 20/20 valid with no retries.
- F113 (10-04, eleventh session, designbench) The architect copies the style example: 12 of 14 styles in the first
  bench were the example's settings at 7x7 or 9x9 (planks, log frame, cobblestone base, planks gable, overhang); the
  final bench varied only roof shape (3 hips) and floor. Variety is D.6's (a style per village) and D.4's (turned to
  the street); a second example or examples by biome would help. Not fixed.
- F112 (10-04, eleventh session, D.8's renderer) Trapdoor shutters drawn in the wall row sit on the inside: an open
  trapdoor sits on the edge opposite its facing, so `oak_trapdoor[facing=south,open=true]` in a south wall cell (the
  stairhall of `stage_village.py`, `rotate_design.py`'s house) is a recess on the cell's north side, not a shutter
  outside. The generator puts shutters in the cell outside the wall, facing out of it (D.2's third step).
- F111 (10-04, eleventh session, D.8's renderer) Open gable ends and wall gaps pass validation: Minevale11's hall has
  no wall under its roof's east and west ends and 5-6-block gaps beside the windows of its north and south walls
  (layers 2-3 `L.G.....L`), its cottages open gable ends too; the rain test only looks up. The generator draws gable
  ends and walls whole; a lint (D.3) or a check of every wall-ring cell under the roof should catch hand drawings.
- F110 (10-04, Minevale9) A "pitched" roof drawn as a solid block: the hall filled four roof layers with planks under
  its stair rows and topped them with cobblestone (5 blocks a column, 549 blocks, 253 gather units), and the run took
  18.2 min. validateDesign now refuses more than 2.5 blocks a column above the inside ("the roof is a shell"); 11 of
  36 earlier bench designs would have been refused. Minevale10 after it: 14.6 min.
- F109 (10-04, designbench) Stair roofs copied from a 5-deep example onto 7-deep houses left rows open to the sky and
  passed validation. The rain test (every "." of layer 1 has a block above it; drawn buildings only) and a 7x7 example
  with the rule "rising one layer per row from both sides until they meet".
- F108 (10-02, ninth session, 2.4) Scouting is seldom needed: an offline port of `atlasSites` over the main atlas
  (~6,700 chunks) found a good 24-block square within ~110 blocks of nearly every mapped point (none beyond 156), and
  find_site's two 40-block legs reach ~190. Of the poor starts tried, the lake had a site 31 off, 20,-120 one 46 off,
  the ridge one 110 off; only the desert had none within 256. Scouting stays as a safety net for phase 3 ("build here").
- F107 (10-02, Scout4) A worker on a sandstone task failed 4 times with "could not reach logs ... stuck at 4,60,-77"
  (under the surface, ~80 blocks from storage; the rescue moved it to 12,55,-78): its pickaxe broke and the remake
  collected logs instead of taking them from storage (F85's rule?). The cottage behind the task waited; the run was lost
  at 4/5. Backlog: log analysis.
- F106 (10-02, Scout3, Scout5) Material counts stall the event loop on sand- and stone-heavy land: plan_layout's
  `materialsNear` (128 blocks, filtered in the search, one Block per match) took stone 5.4 s, sandstone 2.8 s, logs 2.5 s
  in one call (a 9.8 s `[lag]`), and sand/sandstone counts 2.1-2.8 s each with none found (3-4 s `[lag]` in the
  mountains); find_site's 4,096-log search 2.2-2.8 s in a desert. A stall over ~30 s drops every bot. Next: positions-only
  searches filtered after (as collect's second pass, R.1), or the atlas's surface counts first.
  **Fixed 10-03** (tenth session): `nearestBlocks` (`mcUtil.ts`) no longer calls mineflayer's `findBlocks`, which built a
  Block for every cell of each section that might hold the block; a section filled with one state (all air, all stone)
  has no palette, so it scanned the whole sky as well. `scanBlocks` reads state ids from the loaded sections, passes over
  sections whose palette or single state holds none of the blocks and sections outside the caller's y window, runs
  `keep` on matches only, walks columns nearest first and stops once `count` are nearer than any column left (a true
  sphere: findBlocks' octahedron of sections reached ~100 of 128 horizontally, so counts can only rise, the same for
  collect and plan_layout). `exposed` and `dry` read state ids (`exposedAt`, `wetAbove`, the last column cached during
  a scan). y windows: collect and materialsNear from home or site y - 16, find_site's logs from the lowest surveyed
  ground - 16. Desert (-35,324, `scripts/checks/search_cost.py`): materialsNear logs 2,375 -> 3 ms, stone 59 -> 4 ms,
  find_site's log searches 0.5-2.3 s -> none over 200 ms, same site; `site.py` in oak woods: wood 226 reported, 226
  real. Staged at 2x: Hills3 3/3 8.1 min, Shelf7 5/5 8.4 min, Drop7 3/3 5.8 min, no `[lag]` or `[search]` line in any.
- F105 (10-02, Scout1) `spreadplayers` refuses water ("Could not spread"), and spawning ignored the answer: an agent stayed
  where its name last stood (1,300 blocks off). Fixed: dry land within 16, then 64 blocks, else dropped in from y 120.
- F104 (10-02, ninth session, R.4's fell check) A big oak in the jungle at -746,87,-580 kept 10 high branch logs (e.g.
  -750,96,-578) "out of reach" after felling: branches beyond `treeLogs`' 4-block box from the start log (the R.4 design
  review saw the same on 2x2 trunk corners: 1-2 branch logs). They stay floating (F54's rule, small). Backlog.
- F103 (10-02, ninth session, R.1 runs) Search costs measured (`[search]` lines): collect's first pass (48 blocks,
  up to 1,024 candidates, filtered in the search) takes 0.2-0.5 s for logs on every pass of its loop (once per log or
  tree); a futile 128-block pass filtered in the search took 2.4-2.7 s on shelf (mineflayer builds a Block for every
  matching block, and the sand under the floor is thousands), 1.3 s positions only. Each section that holds the block is
  scanned cell by cell, so the cost follows how many sections hold it, not how many are found. Left: the first pass's
  0.2-0.5 s per log (a smaller radius or count first, or the atlas, would cut it; no `[lag]` seen from it in R.1's runs).
- F102 (10-02, Shelf1's log analysis) Two small marks outside the plot: a grass block dug at -1666,97,-135 and a
  dirt block left at -1667,96,-133 beside Worker1's tree (pillar try 1 refused): `fellTree`'s refill of the holes
  `dirtForClimb` dug swallows failures (`placeAt(...).catch(() => undefined)`, mcSurvival.ts ~486); and at
  -1653,97,-142 one grass block gone where collect's `near` should exclude it (a pathfinder dig?). Cosmetic. Backlog.
- F101 (10-02, review of 2.3) The first atlas step went to candidates before looking around the bot and walked them in
  score order (up to ~650 blocks zigzag), surveyed each at full size (a 2.4 s `[lag]` in jungle), and dropped low-wood
  results. Fixed before commit: local search first, atlas only for no village or a mayor's first site, nearest-first
  after the best, 300 blocks in all, a small survey per candidate, low-wood results kept, the walk named in the reply;
  the probes wait 300 s for find_site (was 120).
- F72 (09-29, review of V.2b) Fixed before any run hit them: two builders at the one village furnace would mix inputs,
  fuel and glass (smelting now goes in turns, and another smelt's leftovers come out first); the hut's own crafting
  table was spent as the builder's work table (the bill now adds one); opening a door counted as placing a block
  (the pathfinder's "blocks left" went to -1); the door click shut doors already open (it now skips them); the rescue
  into the hut went in front of a doorway that may not be levelled (now the aisle just inside).
- F188 (10-08, twenty-third session, Minevale33) **The agent server crashed** on a scout's walk home: mineflayer-pathfinder's
  `getBlock` returns a stub with no `position` for a block in an unloaded chunk, and the farm-field walk ban read
  `b.position.x` inside the pathfinder's tick (needs a village field within 160 and a path into unloaded chunks: the
  160-block exploring trips). Fixed (`91d1399`): all three walk bans skip the stub.
- F189 (10-08, Minevale33) A scout's ring point lay in a shallow lake; on the way home the bot floated 4 minutes (the
  pathfinder planned along the lake floor under it; walkRetrying's legs have no swim-out; the rescue counts only failed
  actions). Fixed (`91d1399`): an exploring chore's walk home that ends more than 12 short teleports home. Open: ring points
  on dry land, swim-out in the legs.
- F190 (10-08, Minevale33) Two of five iron trips stopped "no pickaxe left": `ironPickaxes` counted pickaxes, and a worn
  carried one counted as one of the two (makeFromStock also counted it as stock). Fixed (`91d1399`): uses left, topped up
  to 250 with stone pickaxes; VanP2 made 2, then 1, as worn.
- F191 (10-08, Minevale30, 31, 33) The storage hut's "could not craft 4 planks ... oak_planks": makeFromStock sorted the
  table first, its craft sawed the log kept for the "any planks" step, and spareKind's tie went to oak (none carried).
  Fixed (`91d1399`): planks and sticks before the stations, a kind not carried never wins. Leftover: put_up_signs' "could
  not craft 12 oak_planks" in birch villages (7 staged runs; signs are oak by name), cosmetic.
- F192 (10-08, Minevale33) The cane start failed twice on a single 2-high stalk (a start needs 2; collect never takes a
  base): try 1 broke the top and lost the drop, the atlas then saw the base and the bad-sighting key held y, so it counted
  as new. Fixed (`91d1399`): cane in the atlas counts the blocks over each stalk's base (1-high not recorded), a cane start
  needs 2, bad sightings by column, a failed start far out teleports home. Leftover: cane drops lost beside water (VanP2's
  fixture gave 1 of 3; earlier runs 2-4).
- F193 (10-08, Minevale33) One chore a village: Worker2 and the Mayor were idle 29 minutes after completion while Worker1
  ran farms, five iron trips and a scout in turn. Fixed 10-09 (s24): per-agent chores (the decisions); staged VanC1 busy
  9.9/0.0/0.0 of 12.1 min (Worker1/Worker2/Mayor), VanC3 7.4/6.0/2.6 of 20.0.
- F194 (10-09, VanA1) The fixture chickens stood on a hill 10 above the annex: from the slope's foot only one was within
  the 10 blocks a chicken is tempted from (3D), and chickens do not come down a drop. Fixed: start_pen takes chickens
  within 10 across and 4 up or down; penChores takes sightings within 4 of the annex's level; the staged fixture is
  summoned on ground within 2 of the site's level.
- F195 (10-09, VanA2) No pen started: storage held no wheat seeds (the field took every seed before its first harvest).
  Fixed: start_pen gathers 3 from the grass when storage has none (luring uses none up).
- F196 (10-09, lure test 1) A test agent that is an idle member of a complete village is given its chores (Gus went
  scouting mid-test): single-agent tests spawn in no village or an incomplete one.
- F197 (10-09, the pen design review) The pathfinder took any fence gate for a full block (not in its fence set) and
  clicked closed ones open, never shutting them: a walk past a pen would have let the chickens out. Fixed in `moves()`:
  an open gate is passable, a closed one a wall no walk opens. Chickens are never led through a gate on foot: the bot is
  teleported to the pen's back row and they follow it in.
- F198 (10-09, Minevale34) Two pumpkin starts failed "could not craft 1 wooden_hoe": the worker carried odd planks of
  two kinds and no logs; the materials planner counted 1 oak + 1 birch as the 2 "any planks" a hoe needs, so it planned no
  plank craft and fetched nothing, while every recipe variant (doCraft charges one) takes one kind. Not 91d1399's (an
  offline replay failed the same with the old code). Fixed: "any planks" draws from one kind, the rest sawn from a log.
- F199 (10-09, the hoe analysis) After F191, spareKind's tie-break counted logs kept for a later planks step, so that kind
  could win and the stick step saw a reserved log (VanA3's "could not craft 12 oak_planks ... made 8 so far"). Fixed:
  spare logs only, the carried total as the last tie-breaker.
- F200 (10-09, the F198 review) "Any planks" from one kind also applies to fuel, which smelting can take mixed: with
  storage holding sand and mixed planks but no logs or coal, glass now plans a log gather and a build leaves its windows
  open; a village with a wood kind may post a few extra logs. Rare; a separate fuel node would be exact. Open.
- F201 (10-09, VanA3, Minevale34, VanA6) The pen's fences fail once on the first pass ("could not craft 21 birch_fence
  ... needs 4x birch_planks") and the second pass makes them; the plan's arithmetic holds in either step order, so the
  shortfall lies in the craft skill's own plank and stick choices. Costs seconds. Open.
- F202 (10-09, s24, pens_v2_facts) Feeding by `bot.activateEntity` works on 26.1 but picks the nearest animal, a baby
  as readily as an adult (a seed went to the new chick); Mineflayer entities carry no Age. Breeding, milking and eggs
  are done by command from the cell beyond the gate instead (`data merge ... {InLove:600}` on `nbt={Age:0}`, a bucket
  cleared and a milk bucket given for an adult found by score, egg items teleported to the bot), charged to the
  inventory; no bot goes into a closed pen (the design review's H1-H3).
- F203 (10-09, pens_v2_facts) Two cows led to a pen jammed in its 1-wide open gate and never came in (twice; chickens walk
  through). Fixed: after the entry, animals of the kind in or just outside the gate are teleported into the pen.
- F204 (10-09, VanC2) A pen of one animal never breeds, and v1 allowed one lure trip. Fixed: a pen holding fewer than 2 is
  lured into again; its gate stays shut until the bot is at it with the new animals (the penned ones would walk out),
  and the count is judged against the pen's starting number. One back-off for both kinds held the chicken and cow pens
  10 minutes after one failure: now by kind (`annex.penBy`, penBad entries `kind:x,z,t`).
- F205 (10-09, VanC3, Minevale35) A pen of one gets no second trip when the other animals stand higher: in Minevale35 the
  chickens seen within 96 were at y 72-74 and the cow at 71, the annex's level 66; penChores takes sightings within 4 of
  it (F194's rule, from chickens on a hill not coming down). Likely VanC3's cow too. Open: allow sightings higher when a
  path down exists, or lure from below them (the tempt range is 10 in 3D).
- F206 (10-09, VanC3) Before completion the Mayor's deposit failed once "could not reach the storage hut ... stopped at
  -1622,59,40" (inside the mine area, y 59). Not this session's change; once in VanC1-3. Open, watch.
- F207 (10-09, s24, the diff review) Buckets are tools to `deposit all` and eggs junk, so a chore stopped after a withdraw
  kept them with a worker for good (VanC2: Worker2 held a bucket after its failed bucket craft, and the iron age set out
  to make one while three had been stocked). Fixed: the pens' chores and the cake deposit carried buckets, milk and eggs
  by name first; the iron age counts buckets and milk buckets storage holds.
- F208 (10-09, the fixes review) Left open: egg collection fires on any dropped item a bot sees in a chicken pen (a stray
  item makes a "no eggs" run a minute until it despawns; the item's metadata would tell eggs apart), and a pen chore can
  be queued on a slot whose start_pen still waits in the queue (the second fails "busy", no try counted). Fixed with it:
  no iron trip while milking or the cake hold the buckets; a failed count no longer reads as an empty pen; an agent
  whose chore ended is given no new one for 10 s.
- F209 (10-09, Minevale35) A scout stalled ~6 min at -1471,62,36 on ring point 2 (-1469,46; sea level), 6 `[stuck]` lines,
  then F189's teleport home. F189's leftover: ring points on dry land, or a shorter give-up on the way out.
- F210 (10-10, s25) 31 chunks round minevale3's village site (chunks -103..-97, -1..5: x -1648..-1552, z -16..95) were
  force-loaded on the test server from an earlier session (`forceload query`); a reset does not clear them (level data).
  They keep that ground loaded with no agent near. Open: clear them (`forceload remove all`) at the next reset, and check
  which script left them.
- F211 (10-10, s25, F209's live check) In the shallow sea east of minevale3 (surface y 62, sand under one block of water
  for 10+ blocks), a floating bot barely moves (1.6-1.9 blocks a stalled walk) while the pathfinder plans along the sea
  floor; with F209's water rule each walk gives up in 12-34 s, but walkRetrying's legs all start from the same spot (four
  legs, ~100 s, scout_water_mid.log). Open: swim to the nearest dry land first (a walk in water toward the nearest
  known shore before any leg).
- F212 (10-10, s25, VanH1/VanH2) 26.1's `#minecraft:dirt` does not hold `grass_block`: the staged fixture's soil test
  found no spot on a grassy rise twice (and the first try stood on a tree). Fixed in `stage_village.py` (grass_block or
  #dirt). Check a tag's members (the jar, or `execute if block` live) before keying a rule on it.
- F213 (10-10, Minevale36) The cow pen stayed at one cow for ~25 min after the harvest: no second cow was seen within 96
  of the annex in the band (the snapshot holds one cow within 96 of minevale3's chest; F205's scan). Open: lure a cow from
  a scouted sighting farther out (FARM_TRIP_RANGE, as the farm starts do), or breed only once a pair exists.
- F214 (10-10, s25, VanH3) The fixture animals were never chosen: wild ones seen first and nearer the annex were taken.
  The F205 path was still exercised (3 trips from +5..+7). A staged test that must use its fixtures needs
  `--fixture-clear` over the whole 96 from the annex (two forceload passes), or a tag filter.
- F215 (10-10, s25, panel) A trailing space dropped by an edit turned the activity overlay's `<i style=` into
  `<istyle=` (the dots vanished; committed in 9ca781f, fixed with the icons). Screenshot a UI change after applying it.
- F216 (10-11, s27, Minevale38) The stations task (S.5) closed with only the table placed: TieredBrain's step matching
  checks the item only for collect, craft, withdraw, deposit and smelt, so the table's `place_station` also matched step
  2 "place_station item=furnace". The glass task's gate opened, `make_into_storage` failed ("not both standing yet") and
  the executor improvised smelts short of fuel: 6 failed actions. Staged runs (TaskBrain) never showed it. Fix: the item
  is matched for `place_station` and `make_into_storage` too; it exposed F217.
- F217 (10-11, s27, Minevale39) With F216's fix the furnace step failed honestly (8 cobblestone needed, 6 to hand), and
  the executor took it over: it crafted a furnace and `place`d it at -1660,65,12, inside the storage hut's footprint beside
  the chests (lesson 33's stray block), the hut's build refused its level, and the executor then `mine`d the village's
  storage chests (229 items lost from the record): 55 failed actions, no hut. Three gaps: `place_station` does not get
  its own missing cobblestone (lesson 106), `place` puts blocks on a planned building's ground, and `mine` breaks a
  village's storage chests (lesson 30). Fixed: the stations task's `place_station` collects what storage cannot give (the mine digger's
  optional call still leaves it to that task); the model-facing `place` refuses a village's ground (`onVillageGround`)
  and `mine` refuses a village's buildings, chests and stations, in survival. Minevale40: the furnace placed by the
  stations task at 4.0 min, complete in 11.0 min.
- F218 (10-11, s27, Minevale40; **fixed 10-15, s30, `8371ab6`**: see F228) `make_into_storage` failed "no path to -1657,65,8" from -1657,64,15, the bot's
  feet on a street's `dirt_path` (15/16 high, so they floor a block low); the executor's `move_to` along the same line
  arrived at once. Then two improvised smelts ran out of fuel (3 failed actions). Look at walks that start on dirt_path
  or farmland if it recurs. Recurred in E1a (s27, staged, 2x, with E.1): Worker2 on the street's dirt_path at -1630,65,27,
  7 blocks south of the furnace cell, three "no path" in a row within seconds (the stage watcher's 3-same-failures rule
  stopped the run at 1.7 min), then the stuck rescue walked it out and the glass was made. The walk's `goto` resolved
  without arriving (the message's "stopped at" branch), not a NoPath rejection. Not reproduced with Gus's `move_to` from
  the same cell, in no village or as a member: next, `reach()`'s GoalNear on the hut cell (range 3) from that spot.
- F219 (10-11, s27, probe25) At 25 bots the agent server's CPU was saturated (2.4% idle in a 40 s profile) with no `[lag]`
  line at all (each turn short, every turn slow: event-loop p99 381 ms, RCON waits 649 ms): 60% was find_site's
  `surfaceAt`, which read every column cell through `bot.blockAt` (a Block object per cell), the one scan lesson 53 had
  not reached. Fixed: per-state classes (air, liquid, tree, ground) and names in a table per registry, read with
  `stateAt`; `site.py` passes (the report against the blocks). probe25c: 51% idle, surfaceAt 1.8%, builds 312 -> 475 in
  the same 10 minutes. The pathfinder's block reads (`getBlock` in botAgent's movements, 15%) are the largest left.
- F220 (10-11, s27, probe25c) The probe's "RCON p90" is the worst one-minute p90 sampled from `/api/perf`, so one bad
  minute fails the run: the server's own 30 s lines read 11-46 ms with one 722 ms window, when Paper's tick peaked at
  127.5 ms (a save or chunk work on Paper's side, which a pool of connections would not help). No RCON pool (the spec:
  only if queueing shows; the queue held at most 6). Count the run's p90 over all commands next time.
- F221 (10-12, s28, A1b1 and A1b3) A 25-agent staged run's watcher died on one `ConnectionResetError` from the agent API
  (A1b1 at 0.6 min, A1b3 at 44.2 of its 45 after-minutes, the second wrapped in `URLError`); the agent server was healthy
  (no `[lag]`, status in 2 ms) with ~600 sockets in TIME_WAIT on port 8767 from one connection per request. The runner
  then reset the site, which looked like a silent server death in A1b1's log. A1b2's reset also timed out waiting 60 s for
  the new agent server. Fixed in the scripts: `stage_village.py`'s `call()` sends a request again after a reset during
  the send (any method) or while reading the answer (GET only), twice at most; `reset_site.py` waits 120 s. Not changed:
  a keep-alive connection in the watchers would remove the TIME_WAIT churn if resets come back.

- F222 (10-12, s28, A1b5) A pen's work was offered on a pen whose second lure had just been queued in the same sweep: the
  `pen` and `penwork:j` keys differ and the lure's slot lock is taken only when its action runs, so `milk_cows` failed
  "annex slot 4 is busy" (a contention failure, harmless). Today's picker had the same race (the golden check keeps it).
- F223 (10-13, s28, A2m/A2f2, Minevale41/42) **The storage value cannot judge A.2.** Four fixed-mode staged runs with the
  same settings ended at 397-701 (A2m's 374 lies inside the spread), and the value counts only storage: scouting adds
  nothing to it while an iron trip adds ~90 items, so Minevale41 (single keys: 10 iron trips, no scouting) ended at 1158
  and Minevale42 (8 scouts, 5 iron trips) at 511. A.3's gauges (the atlas explored, pens and farms running, tools) are
  the measure that sees what a choice was for; until then compare chore mixes, not one storage number.
- F224 (10-13, s28, A2m) Exploring is shut out while any pen lure runs (the options exclude the `pen` key, today's
  rule): `[choice-none]` showed "explore: busy" beside "pen: busy" with ~20 idle. Whether a scout disturbs a lure (it
  carries no seeds) is unchecked; if not, the exclusion is the next ceiling on parallel work.
  **Checked live and fixed 10-14 (s29)** (`runs/2026-10-14/f224_facts.py`, `f224_*.log`; Gus in no village leads two animals
  48 blocks in start_pen's hops on a glass-walled pad, Worker1 walks the other way past them): no scout, a scout 3.6 off,
  and a scout straight through the herd all gave 2 of 2 followed, the farthest 3.8-4.8 from Gus, for chickens and cows
  alike; a scout **holding seeds (or wheat) in its main hand took one animal away** (it followed the scout 47.8 blocks).
  Pumpkin and melon seeds are junk that deposit "all" keeps, so a worker can carry a lure. Fixed: in instance mode explore
  no longer excludes `pen` (single keys keep the rule: golden 0 differences, instances 0 invariants broken); the `scout`
  skill selects another hotbar slot when the server says the main hand holds `#chicken_food` or `#cow_food` (a `LURE`
  list in mcBlocks.ts); live with the real skill and seeds or wheat in hand: put away, 2 of 2 followed for both kinds.
  Not changed: harvests and farm starts still exclude `pen` (a harvester holds seeds in hand while sowing).
- F225 (10-13, s28, A2m, Minevale42) Herding: 5 "taken" a run, two choosers picking the same instance in one sweep, the
  second given the fixed pick (spec risk 4). E.4's reservation at decision start and one re-ask address it.
- F226 (10-15, s29, S9f) One `make` of 8 smooth stone on the hut's furnace (before the works furnaces stood) failed in 2 s:
  `could not make 8 smooth_stone from what was withdrawn (2 charcoal, 8 cobblestone)`, so `makeHeld` returned null at one
  of its two early returns, though the server had the items (they went back) and the same plan offline is fine (16
  smelts, 2 charcoal, nothing to gather; `runs/2026-10-15/scratch/smooth.mts`). Not explained from the log: the next step
  logs what `makeHeld` saw when a make gets null, and the make resyncs and tries once more. 1 of 25 makes; soft.
- F227 (10-15, s29, S9s1, S9f, S9m, B4s1) `--fixtures`' pumpkins at -1588..-1584, y 73-80 (on a rise above the site)
  give a pumpkin start 2-3 `[stuck]` lines every run (GoalLookAtBlock, ~11 s each, `could not reach pumpkin: 3 tried`):
  the same cells in all four runs. A fixture's fault (lesson 133), not new code; place the fixture pumpkins on reachable
  ground (`--fixture-dy`, or a search for a standable cell beside each) when the staged runs are next touched.
- F228 (10-15, s29, Minevale43) The build phase took 17.8 min with 10 failed actions (Minevale41/42 on the same site:
  10.4/10.2 min, 3 each): F218's "no path to -1657,65,8" again, then `smelt failed: ran out of fuel after 1 of N` 4 times
  (Minevale41 had 2, Minevale42 0) and "14 glass_pane cannot be made from the village storage yet (gather 3-6 sand)" 3
  times. Not the new families (their first log line follows "declared complete"); the build's fuel paths are unchanged
  by diff (no coal budget is passed for glass, the fetch is the same without an ingredient coal). The line-up against
  Minevale42 is `runs/2026-10-15/mv43_analysis.md`. **Conclusion (the analysis): not the code changes** (`plan()` old and
  new give 0 differences on 7 of the run's inventories; the new smelt and makeFromStock options are never passed by
  make_into_storage or executor smelts). The layout, bills and first 4.7 min match Minevale41/42 to the minute; all ~7.6
  extra minutes went into "Make 14 glass_pane into storage" (done at 7.1/7.8 min in 41/42, 16.5 in 43), through three
  older defects: F218 set it off (no path to the hut's furnace cell; the executor improvised); **a smelt that runs out of
  fuel leaves its unsmelted sand in the furnace** (since `5710a15`, mcSurvival.ts smelt's fuel loop), where makeHeld's
  count (carried plus storage) never sees it (~11 sand by 8.0 min); and **a worker that hands a task back keeps what it
  made** (6 glass and 14 sand in Worker2's pockets from 11.3 to ~18.9 min, lesson 112). Worker1's executor turns took 29 s
  each (Worker2 2.8 s, same tokens). Next: fix F218 (the cheapest model-driven failure left), take the input back out of
  the furnace when a smelt runs out of fuel, and deposit by name what a handed-back task made; then a model-driven run.
  **Fixed (10-15, s30, `8371ab6`):** (1) F218's mechanism: on a dirt_path (top 64.9375) the pathfinder starts its search
  from the cell above the floored feet (y 65), where holdVillageFurnace's GoalNear range 7 already accepted dz 7, so `goto`
  resolved at once, while walkOnce's arrival test looked at the floored feet (y 64) and the raw position, both just outside
  range 7: "no path". `atGoal` now mirrors the pathfinder's start-node rule; `scripts/checks/at_goal.mts` reproduces the old
  false "no path" on the run's numbers (6 of 6). (2) smelt: out of fuel or out of time, the output and the unsmelted input
  come back out of the furnace and the message says so ("the 4 sand left are back in the inventory; carry planks, logs or
  charcoal for fuel"); live with Gus (`runs/2026-10-15/s30_smelt_facts.py`): 4 of 4. Left: a smelt cancelled mid-way still
  leaves its input in the furnace (the next smelt of the same item smelts it; uncounted between). (3) A tiered worker that
  gives up a task deposits by name what it carries for it (`WorldAdapter.taskLeftovers`: make_into_storage's batch
  leftovers, a gather task's material), queued as chores. **Minevale44** (model-driven): complete at 9.1 min, 0 failed
  actions in 54 min; the panes' task ran as written (F218 gone). (2) and (3) did not come up (no smelt ran dry, no task was
  given up): they rest on the live smelt check and the code.
- F229 (10-15, s30, G25f) make_log MISMATCH "glass: storage 5->8 for 8 made": Worker9's workshop make of 16 glass_pane took 5
  glass from storage during Worker18's glass make. make_log knows growth tasks and food chores that take a good, but not
  another workshop make consuming this make's output (lesson 132's kind). Fix in make_log: a make whose good is another
  overlapping make's input (glass for panes, charcoal for torches, planks for many) excuses a short count up to that
  make's take. Not a defect of the makes.
- F230 (10-15, s30, G25f) "charcoal: made 4 of a batch of 5": the smelt of 5 logs deposited 4 charcoal and put back the
  plan's 1 coal: the refuel took the freshly made charcoal as fuel (addFuel's FUELS-first order finds the output before the
  coal the plan budgeted, smelt's `coal` budget being for the ingredient case only). Small (1 a batch); fix with addFuel
  preferring the item the plan reserved as fuel, never the smelt's own output.
- F231 (10-16, s32, G25x3) 23 `[stuck]` lines at 3x against 2 at 2x in the same 25-member growth test: 12 are Worker3 in
  water at -1674,60,-21 (swimming in place, "water 617" ticks, goals to the plot and to -1681/-1667,-28), 7 Worker4. One run
  each, so possibly the spot (lesson 133) rather than the speed; not looked into further since 3x is not used at 25.
- F232 (10-16, s33, A.3p Tid/Ton) Temperament weights alone barely separate agents in a 25-member village after
  completion: the fixed pick moved 42 of 156 choices off the lowest rank (tilt 1.22 against 1.03, rho 0.20 against 0.07),
  but JSD (0.41 against 0.49) and identifiability (0.17 against 0.27) were no higher than with identical temperaments.
  Members were busy 6% of the time and 41% of menus held one kind (70% two or fewer): with a surplus of idle members the
  sweep's order (Worker1 first) hands each chore to whoever comes first, liked or not. Choice needs either more work on
  offer or a way to leave work to those who like it (the response threshold: liker-first sweep order and declining a
  disliked chore until it has waited 90 s, added the same day). Also found by the run: the fixed sweep took
  `menu.options[0]` and never called `fixedPick` (fixed before Ton; the review found it too).
- F233 (10-16, s33, Mid/Mon on world 2, once in Ton2) Workshop smelts fail "no path to -1631,66,10 / -1629,66,10 from
  -16xx,66,17 (blocked by terrain, water or buildings)": 3 in Mid (identical), 5 in Mon, 1 in Ton2, none in Tid/Tid2/Ton.
  The same spot in `mv3_base25` across temperament arms, so the fixture or hut crowding (lesson 133), not temperaments; the
  temperament-on runs' failed share (5-8% against 1-3%) is mostly these and the workshop's input and furnace shortages.
- F234 (10-16, s33, Mid/Mon) In model mode at 25 members most decisions never reach the model: Mid 9 model picks of 151
  (fallback 'rate' 49 from MC_CHOOSE_MIN_GAP_MS 90 s, 'taken' 31, 'repeat' 41, 'only' 21). With choices this sparse the
  model's share of a run is small; the 'taken' ones are the model's picks too (modelChose) and count for its tilt.
- F235 (10-16, s33, Vm) A style that won while it was already the current one built the village's own library's houses:
  growTick took today's picks (`pickHouses` without `only`) when the winner equalled the current style, and those draw
  the village's biome library (plains), so after savanna won neighbourhood 1, the savanna "current" won neighbourhoods 2
  and 4 and plains houses were laid out (current flipping plains/savanna each vote). Fixed the same day: a voted style
  always builds its own houses only (villages that cannot vote never reach this path).
- F236 (10-16, s34, X.1's spec check and counts) Vanilla's house furnishings are mostly out of a peaceful village's reach:
  of 685 furnishing cells in the five biomes' houses, ~230 need wool (beds, banners, carpets), ~70 iron (MAKE_NEVER), 39
  wheat (hay), 45 a potted plant, 56 jungle buttons; `mv3_base25`'s four vanilla pieces hold 2 beds, a lectern and a bell,
  none makeable. Clay near minevale3: 47 blocks within 96, under water (collect refuses blocks with water above). Hence
  X.1's furniture is code-designed (`buildingDecor`), from logs, cobblestone and sand only.
- F237 (10-16, s34, X.1) `Materials.plan` makes a smoker from 4 stripped warped stems and a campfire from coal and stripped
  warped stems: a stripped log has no recipe, so it counts as gathered at cost 1 and ties with `any:logs`, and the exact
  variant comes first. The catalogue drops both (its gather rule); the decor cycle leaves the smoker out. A tie-break
  preferring `any:` options would bring them back (and must be checked against materials.mts and the goldens).
- F238 (10-16, s34, X1s; also s33's Mon) A torch make's charcoal smelt failed "no oak_log in inventory" while it carried the
  birch log its plan took: lesson 88's generic fuel/input step still picks a kind it does not hold (the plan withdrew
  birch_log:1 and oak_planks:2). Rare (1 of 53 makes in X1s).
- F239 (10-16, s34, X.1's reviews) The menu and the furnish skill chose different spots (the skill took the first open
  ones whatever storage held, withdrew nothing and threw a contention the world never backed off): found by both lens
  reviews, fixed before any run (the skill picks as the menu does; none spare ends "no progress", which backs off).
- F240 (10-16, s34, X1g0/X0g0/X1fg/X0fg) After the first 20 minutes the 25-member village is 0-1% busy in every arm,
  with and without the catalogue, growth and food: growth stops at a house per member (~15 min at 2x), the appetite's
  food is made ~3x faster than eaten (530 points made, 170 eaten in X1fg) and every stock target is met. Nothing drains
  or grows without end; X.2's projects (large, voted, open-ended builds) are the next lever, with a higher appetite or
  wear as smaller ones.
- F241 (10-16/17, s34, X2p) With predicted ballots the status quo wins every first work vote 13-12: three works split the
  hard-working and proud voters while the easy-going and sociable all take "no new work". Plurality with a lone status quo
  favours it; deterministic predicted ballots then repeat it forever, hence "none may win once in a row" (spec_x2). Each
  cycle was ~5 min resting, ~1 min gap and ~2 min building, so the rest went to 2 min. A work of ~140 units takes 25
  members 1.5-3.5 min at 2x with haste: in fast staged runs projects look cheap, and larger works or several pieces a
  project are the next lever for steady busy time.
- F242 (10-17, s34, X2q on world 2) F153(a) happened: at minute 33 the agent server died on a TypeError inside
  mineflayer-pathfinder's `monitorMovement` (`placingBlock.y` of undefined, index.js:546, in the physics tick) and dropped
  all 25 bots; the public works' new doors put it on members' paths. Fixed: patch-package's pathfinder patch ends placing
  when the next placement is none; the agent server now logs an uncaught exception and carries on (`[crash-guard]`),
  exiting only after more than 10 in a minute. F153(b) stays open.
- F243 (10-17, s34, X2q2) After 10 layouts (8 neighbourhood-sized pads of public works round minevale3's village) no free
  26x26 square was left within growth's reach of 77 blocks (taken 17,773 cells, steep 530, wet 302): two works failed and
  projects rested 10 and 20 min, so the last 20 minutes fell to 1-3% busy. Fixed: a "no free NxN site" is the land's,
  not the piece's (kept on offer), and later quarters drop companions until their pad fits N - 1 (`growth.workRoom`).
  Growth's reach itself is the next limit. The same run had 23 `[stuck]` (45 `[repath]`), spread over walks out to
  trees through the packed core; X2q1 and X0q1 had none.
- F244 (10-17, s34, X2q2/X2q3/X2q4, open) In fast quarter runs bots stall repeatedly at the same spots, "path moving, fwd
  0" and moved 0.00 (23, 36 and 17 `[stuck]`; none at 1x in X2q1/X2qm, none without works): chiefly inside or beside the
  public works built at the same places every run (the plains butcher shop at -1625..-1614, 62..72, y 63, and the armorer
  at -1643..-1636, -22..-14), a few at sand near -1673,60,-22. A first guess, that F242's guard left bots on a stale path
  after opening a door, gave only 2 door resets in X2q4 (the guard now resets the path all the same, as the library did
  for bots without scaffolding). Next: watch one live (lesson 77), check the butcher shop's pad level against the street
  and its doors (lesson 133: a fixture first).
- F245 (10-18, s36, N0on, fixed `71aa99d`) N.0 as built in s35 failed live in three ways the offline menu probe also
  found: an initiator's first step held only its `initiate:<name>` key, so another member was offered the same build in
  the same sweep (duplicate builds, "already stands"); a public works quarter was laid over an open initiative's spot
  (growTaken ignored initiatives); and room for small works ran out after ~3 on the plots. Fixed: the step's own key held,
  growTaken keeps off initiatives, greens (a 15x15 plot prepared as the first step when the plots are full, one per 5
  members). `scripts/checks/menu_probe.mts` reproduces menus and sweeps offline on a checkpoint.
- F246 (10-18, s36, N1on/N1show, fixed s37 `8c393fd`) N.1's storage gauge read "9 of 9" (full) in every run, but it
  counted chests, not slots: storage held 99 of 216 slots (46%); only the three misc chests were full, mostly of leftover
  building parts. Fixed: the gauge counts slots, a `parts` chest group, spare wooden parts burned as fuel (MC_PARTS).
  Lesson 147.
- F247 (10-18, s36, survey) Furnaces were never the workshop's bottleneck: all four held at once once a run, no make ever
  refused for "furnaces busy"; the binding limits were make back-off and the hut's crafting cap. N.3's furnace room waits
  for a measured need (issue #3).
- F248 (10-18, s36/s37, open, issue #7) `plains_small_house_3` traps bots inside: Worker14 in N1show (18 `[stuck]`),
  Worker7 in s37's Son (22 of 32), at -1623..-1617, 63..69 on mv3_grown25, moved 0.00 on every try. F244's family; the
  house's door or interior needs a look (lesson 133: a fixture first).
- F249 (10-18, s36, N1m, fixed) A fresh green's own reservation (held by prepare_green until prepareSite had deposited the
  felled logs, after the plot was recorded) blocked the whole green, and the initiative failed "no spot for it on its
  green". The green's own reservation is left out, and no verdict is given while its preparer works.
- F250 (10-19, s38, issue #7, cause found) F248's trap reproduced with Gus on test world 1 (after Son): teleported to each
  free cell of `plains_small_house_3` at -1621..-1619, 65..67 and sent to the street (z 73) and the storage hut, 7 of 14
  walks failed, every one "stuck at -1620,64,67" (the cell inside the door), the bot at x -1619.43..-1619.51, path
  moving, fwd but moved 0. The door (-1620,64,68) is a single oak door facing south, hinge left, open: its open panel is
  the east 3/16 of the doorway (x -1619.19..-1619), leaving a bot centred on the path node (x -1619.5, half-width 0.3)
  0.0125 of clearance; a drift of +0.05 east presses it on the panel. Walks starting from the west column (x -1621)
  came in at an angle and passed. Any 1-wide doorway with an open single door has the same margin (hinge right leaves
  0.0125 on the other side), so F244's family is this. The bot is not held by the panel itself: the pathfinder's
  straight-line simulation of the next step hits it, so it lets go of forward and stands until its 3.5 s reset (fwd 4-9
  of ~433 ticks in the `[stuck]` lines). Fixed in the walk, not the design (botAgent.ts `offDoorPanel`): after 4 ticks of
  a moving path and no move, a bot in an open door's column within 0.6 of its panel moves across to the middle of the
  gap the panel leaves (x -1619.45 -> -1619.59, about 0.1 of room each side; a first try that only cleared the panel by
  0.05 failed 10 of 14). The probe again: 14 of 14 walks out, 0 `[stuck]`, 12 `[door]` lines.

- F251 (10-19, s39, issues #1 #9 #8 #3) Needs measured at real rates before building their works (R60, scale 1, vanilla
  crops, appetite 18): the 25-member village drains ~180-210 food points an hour (112 with everyone idle) and makes
  ~40-95 (55 of R60's 95 were bread baked from stored wheat); the stored bread covers about an hour. 30-minute fast runs
  (2x, random ticks 30) hid this: supply ran several times ahead. Storage (41-44% of slots) and the mine (0-2 faces held,
  2 "no stone" tunnel ends an hour) move over days. Iron: one digger at a time on the iron level, and stairs that never
  get down on some ground (Hon: 5 trips, 0 iron); demand ends after an iron pickaxe and 1-3 buckets. Built: food first,
  behind `MC_NEED_WORKS` (spec v2 after an adversarial check that found pies ignored, a field-only layout impossible on
  the growth path, a second annex broken). Live: the first gate counted a free farm slot the menus could not start
  ("nothing seen to farm") and held the farmstead back; gated on the menu's own reason, Won2 voted and built two
  farmsteads, fields planted. Raising the bread and pie targets alone made nothing more (bread is held by wheat grown).

- F252 (10-19, s40, issues #1 #9) Farmsteads beside the vote, not on it: as a vote option (s39's Won2) a farmstead won
  votes the quarters would have (busy 17% vs 20%). Laid out by the Mayor or an idle member when due, before the next
  vote opens and never over one voted, it still cost a vote cycle at first (Fon: 3 public works vs Foff's 6): the layout
  deleted `g.work`, the vote's rest record, so the next vote offered "no new public work" again and won it. Kept for a
  farmstead, Fon2 built 4 public works and 2 farmsteads, food went short and back, busy 21% vs 19% off. The third
  farmstead found no free 19x19 site within 80 blocks (it backs off as a public work: 5 min a failure, projects stop
  after 3; a farmstead failure counting against public works is a leftover). `MC_NEED_WORKS` is on by default since.
  Also: two series started at once raced in `snapshot_code.py` (one temp folder, one rename refused): a temp folder a
  process now.

- F253 (10-20, s40, issues #9 #1) The first long real-rate model run (Night40: mv3_grown25, 1x, `--choose model`,
  appetite 18, need works on; 92 min, ended by the PC's shutdown). Three limits for a village meant to run for days:
  (1) **land**: food went short (made 84-119 of 180-186 points an hour) and the farmstead found no free 19x19 site within
  80 blocks (taken 19032 cells, wet 780, steep 269), after nine public works and the grown neighbourhoods; the need's only
  big answer had nowhere to go. (2) **work**: busy ~14%, 136 menus with 24 idle and nothing feasible. (3) **model
  choices lost to contention**: of 149 model decisions, 103 came back to an option another member had taken meanwhile
  (latency median 0.7 s: several members shown one single-holder option at once, `make:birch_fence` 12, `penwork:3:eggs`
  11, `make:torch` 10) and ran the fixed pick instead; 127 more were the 90 s gap (`rate`, by design).

- F254 (10-20, s40, issues #9 #1) Field works on small pads answer the food flow where farmsteads cannot (spec
  `runs/2026-10-20/s40/spec_fields_v1.md`, after F253's land count: 34 free 9x9 squares within 80 blocks of Night40's
  home, 1 at 19x19). The spec's adversarial check found the blocker: after completion only growth's workers claim board
  tasks (`isGrowTask` goes by task number, not poster), so a field's seeds and planting tasks would have stayed open, or
  been closed by a neighbourhood's end; the field is planted by its own chore instead. Also from the check: the plot just
  prepared clashes with growTaken (re-check before preparing, not after), the field's corners kept within 96 of the
  storage hut before preparing (no orphan plots), `hutLevel` for field records, its own gate outside `projectDue`.
  Fld1 (staged fast, appetite 60): 4 fields, 14 harvests, food made 655 vs eaten 450 points, short -> no longer short.

- F255 (10-20, s40, issues #28) One re-ask for a model pick another member took meanwhile (PLAN E.4's rule) doubles the
  model decisions that stand: Rsk1 (as Night40, 30 min) kept 65 of 102 (64%) against Night40's first 30 minutes 23 of 73
  (32%), for about 1.5x the call rows (278 vs 186) and ~2x the cost (~$0.07 a half hour, still ~$0.14 an hour at 25
  members). Herding persists: 27 of ~50 re-asks were taken again (several members re-asked at once see the same fresh
  menu). The rest of E.4's rule (in-flight picks shown, options spread across members) would cut it further.
- F256 (10-20, s40, issues #8 #3) The adversarial check of spec_storage_mine_v1 found the mine near its end, not days
  away: `MAX_CELLS` (1080) caps the whole mine, not a level (mcMine.ts:25, 529, 535), and Night40's B25x2 had dug 989
  with all 12 main tunnels used (~182 cells an hour: spent ~30 min after the shutdown); levels 2-3 can never open under
  the cap. Storage's +39 slots in 92 min were mostly not a trend: 14 slots of surplus logs from initiatives (which
  gather their own: 916 logs felled, storage birch_log +709), ~16 of fragmentation (the full misc chests spilling into
  others: packed by kind 83 -> 106), 9 of new kinds. Also: gather and make chores already stop at their targets, so a
  "hold the overflow" tier holds nothing; the mine gauge vanishes once the mine can give no stone (mineFaces zeros);
  six free cells in the storage hut could take barrels (+162 slots) with no second hut. The user (10-20): initiatives
  take storage's surplus above the keep first.
  Built (s40): the cap per level, counted by real digs from where the stairs reached the level (the tunnels' own counts
  take in cells passed undug: mv3_grown25's 1377 against 710 dug), a full level sending the stairs down; the `mineflow`
  gauge (cells left, dug per game hour, hours left); a blocked mine read full. Night40's mine would read 2251 cells left
  (91 at its level, two levels below). Min1 (cap lowered to 760): level 1 filled, the stairs went down, 142 cells dug on
  level 2.

- F257 (10-20, s40, issue #3) The storage half: initiatives taking storage's surplus first, six barrels in the hut, a
  tidy-up. Sto1 against Fld1 (30 min staged, mv3_grown25): logs into storage +237 vs +411, all items +749 vs +1225, the
  storage 27% of 405 slots vs 45% of 243; initiatives built 25 vs 28. **Busy fell from 18% to 13%**: initiatives' own
  gathering trips were a large share of the work idle members had, and much of it only made surplus (Night40's 916 logs
  felled). Kept on (the user's, 10-20): the lost busy time should come back as more kinds of work, not as logs nobody
  uses. Night40's storage had 42 slots of strays (items in another group's chest).

- F258 (10-20, s41, issues #13 #14) **The work supply runs out for want of sinks, not inputs** (`scripts/checks/make_gap.mts`
  on mv3_grown25 and Sto1's end record; Sto1's choice log in 10-minute bins). 40-44 of the 44-46 workshop goods sit at
  their fixed targets (1-16 each) and none is short of an input gathering could bring; `make: inputs short` on every
  empty menu is the reason's order (any good below stock outranks "all at stock"), not a gap, and `gather: nothing
  wanted` follows from it. Goods leave storage only through initiatives and lighting (birch_fence: target 6, 105 made).
  Busy by bin: 15%, 14%, 7%, 0% (minutes 0-10 ... 30-40); initiatives (start and help) were 50 of the 90 busy minutes,
  stopped by "enough projects open" (3) and "no room". Raising targets alone would only fill storage (lesson 149). The
  user's choice: members' proposals feeding foundry tickets (routes b and c) now, the initiatives cap left as it is.

- F259 (10-20, s41, issues #20 #12 #74) **Fishing and the merchant raise busy; fish are a real flow, the merchant's
  purchases are not.** Stg1 (Sto1's staged settings + activities + merchant, 3 rods; mv3_grown25, 30 min) busy 20% vs
  Sto1 13% (147 vs 91 agent-min: fishing 18, initiatives 46 vs 34 as selling logs drained the surplus initiatives take
  first, make 33 vs 23); Erl2 (model choices, 1x, mv3_sto1end) 13% vs Erl1 7% (Erl1 loaded no activity: snapshots left
  out server/library, fixed: lesson 140 again, the foundry's live checks called the skills directly). Fish: 76 caught in
  12 trips (Erl2 55 in 9), 26 cooked each; none eaten in 30 min (meals prefer bread; Stg1 ate 85 bread meals, food -120
  points). Trade: 430 logs sold (27 emeralds; Erl2 400 for 25), every emerald spent on string, bone, gunpowder, spider
  eyes, slime balls, ink and an ender pearl that nothing uses (lib:buy picks the item furthest below a keep of 8): busy
  bought partly with logs turned into junk (lesson 149). gpt-oss chose selling, buying and fishing unprompted ($0.04 the
  half hour). Next: buy only items with a consumer; the simulator (#74) to test such rules first.


- F260 (10-20, s42, issue #74) **The village simulator matches staged runs once it runs the public works; without them
  its long-run results were artefacts.** `scripts/sim/village_sim.mts` (the real decision code, modelled skills, a 5 s
  clock; 30 simulated minutes in ~10 s, 10 hours in ~2 min). v0 (works, growth, housing off) against Stg1/Stg2: meals,
  harvests, pens, fishing and sales inside the two runs' spread, but make -15%, light -40%, initiatives -20% and the last
  10-minute bin half as busy (9% vs 15%). Not logs (600 logs added changed only what was sold): the public works' plots
  (room for initiatives, new buildings to light and furnish) and their felled logs (~500 in Stg1). With the real TaskBrain
  in the fakes, lay_out_houses posting the real postLayout's tasks on a free square and prepare_site's felled logs:
  busy 19.7 / 19 / 20 per bin (Stg2 19.2 / 19.6 / 15.9), make 188 (168-181), light 44 (44-51), initiatives 39 (33-37),
  builds 37 (31-37). Left: meals +20% and cod eaten (real members ate only bread), furnishing 17 (6-11), four board skills
  unmodelled (put_up_signs, light_streets, make_into_storage, tidy_storage). Real runs differ widely from each other
  (Stg1 vs Stg2: activity 27 vs 16, emeralds 27 vs 8): compare against the spread, not one run.
- F261 (10-20, s42, issues #20 #73 #74) **The merchant's purchase fix works live; the sim's merchant economy results were
  v0's.** Stg2 and Stg3 bought only a fishing rod (no junk), sold 128 logs each, stopped at the emerald keep. In v0's 10
  simulated hours fishing stopped after ~4.5 h with the fix (no logs above their keep left to sell, so no emeralds for new
  rods; ~1.8 h with the old rule, its emeralds spent on junk) and pumpkins (4,900) and seeds piled up with no sink; a
  pumpkin offer kept fishing all 10 h. With the works modelled, logs pile up instead (+2,700 in 90 simulated minutes), so
  the log sales never run dry: the pumpkin offer was tried (Stg3: no pumpkin sold in 30 min, logs first) and taken out.
  Merchant orders (MC_MERCHANT_ORDERS, off): 38 filled in 10 v0 hours, makes +16%, busy +0.2 points: cheap goods are
  quick crafts, and orders 4x the size did not help (7.6%).
- F262 (10-20, s42, issue #74) **A 90-minute village runs out of room at ~40 minutes; the simulator predicts it only on
  the real land.** Lng1 (Stg3's defaults, mv3_grown25, 90 min fast): busy 19.6 / 20.4 / 19.1 / 14.1 per 10-minute bin,
  then 4.7, 1.5, 2.1, 2.4, 2.6 (9.6% overall); from minute 40 every idle menu said "initiate: no room", "help: no project
  open", "make: inputs short", "gather: nothing wanted": the public works stopped at "no free 20x20 site within 80 blocks
  of the village (wet 446, steep 213, taken 19422)" (then 18x18: "no public work buildable here"), and without new plots
  no new initiatives. The sim's five predictions, written before the run, all missed the collapse (busy 16.9-19.9%,
  initiatives 61-109 vs 44): they placed layouts and greens by geometry alone. With the checkpoint's land
  (`scripts/sim/land.py`: top ground and water from the saved regions; sites as growSite picks them): busy 11.5%
  overall, make 283 vs 269, help 76 vs 83, initiatives 41 vs 44, public works 8 vs 9, furnish 8 vs 8; its room runs out
  ~10 minutes early, and its floor after the collapse is ~6-7% vs 2% (cooked cod and charcoal made twice as often, egg
  collecting 1.6x). The village's long-run limit today is land within reach, not materials or models.
- F263 (10-21, s43, issue #74) **A wider village range keeps a 90-minute village busy; the simulator now matches both
  long runs.** Rch1 (Lng1's settings, MC_VILLAGE_RANGE=144, growth reach 128): chore busy 17% steady to minute 90
  (bins 18-20% after a dip to 11-12% at minutes 20-40) vs Lng1's 9.6% collapse at minute 40; 15 public works (Lng1 5),
  88 initiatives (44), builds 83 (44); [stuck] 8 vs 5, loop p99 44 ms: the longer walks cost little. Rch2 (Rch1 plus a
  green per 3 members, test world 2 alongside): the same, 17%, 89 initiatives; the green cap does not bind once the
  reach is wider (its prediction, +2 points from the uncorrected sim, missed). The sim's long-run misses had four causes,
  each found by scoring the real run's own choices with the sim's rule: (1) sites judged with a 2-block margin the real
  bestSite does not have (Rch1's sites had 5-8 blocks of range and water there): the sim ran out of room 20-30 minutes
  early; (2) every build converted to the village's wood (birch) where the real skill chooses the kind that covers the
  building, the felled oak first for the plains pieces: birch ran dry and public works failed, holding the next work 17-30
  minutes; (3) make and fishing times drawn whatever the batch (late top-ups of 1-2 take half a full batch); (4) durations
  drawn from members spread at builds, while idle members stand by storage (eat 0.03 vs 0.06 min); and the furnace's fuel
  carried between smelts (the sim made charcoal 2.5x as often). Corrected: Lng1 9.7% vs 9.6% (collapse at 40), Rch1 17 /
  16% vs 17%, works 15 vs 15, make 524 vs 512, help 177 vs 168, initiatives 94 vs 88. Left: light 53 vs 101 (public works'
  parts), cooked cod eaten +30%, the dip at 20-40 minutes. Four-hour sims: range 96 runs out at ~40 min, 144 at ~90,
  192 at ~120, where the public-work pool (each design built once; 26 built) runs out before the land: a wider reach
  postpones the limit, it does not remove it. Merchant orders (sim, reach 128, 3 seeds): 15.7% vs 15.1%, noise.
- F264 (10-21, s43, issues #68-#70) **Personal stock, barter, claims, sales and own farms in the simulator: trade and diet
  hold up at real-rate growth, busy does not.** Built behind flags (all off: MC_OWN, MC_BARTER, MC_SPECIAL=claim,
  MC_OWN_SALES, MC_OWN_FARM), tested only in the sim (the user's choice). At the fast staged settings (random ticks 30)
  each step looked better than it is: own stock +2-3 points of busy; barter traded pumpkins only (every chest the same, the
  pumpkin's price at its floor); habit and price weights did nothing; claims made holdings differ but thinned the market
  (3 of 25 members held a plot); sales made emeralds a medium of exchange; own farms took trades from 4-8 to 34-39 a run.
  Rerun at real-rate growth (random ticks 3, 180 min, 2 seeds): busy 14.0-14.3% with the economy vs 13.3-13.5% without,
  both collapsing to ~6% after ~90 min (land and works run out, F263); as stocked (wheat and pumpkins only) 29-31 trades,
  most offers lapsing, 665 pumpkins idle in chests; with 40 cane and 40 carrots stocked 201-288 trades, a third paid in
  emeralds, 160-180 pies and 230-270 carrots eaten, top good 54-61% of a chest. Members eat ~450 bread a run vs ~75.
  The economy gives members reasons to trade and a varied diet; it does not fill idle time (its chores are short).
- F265 (10-21, s43, issues #73 #71) **Innovation v1 in the simulator: experiments unlock techniques, but by lottery and
  too early; and the live economy works on its first run.** MC_INNOVATE (off): a library (server/src/tech.ts) of four
  entries (hay bales, pies for the commons, lanterns, armour stands; a campfire entry dropped: its recipe plans coal, which
  the workshop keeps) unlocked by members' experiments (attempt materials from the commons, code's roll, +0.1 a member's
  failed try), pledges paid to the inventor. Sim (real-rate, 180 min): 2-3 unlocks a run, each by a different member, but
  in the first 2-7 minutes (curious members explore candidates with no demand) and late busy unchanged; pies made ~100
  times a run once cane is stocked; hay rarely (members' own wheat goes into bread); no pledge in any run. Cost is not
  tied to complexity or benefit (hay costs what a lantern does). The user's next step (10-21): research points scaled by
  complexity and benefit, shared credit, prerequisites. The live economy (Eco1/Eco2, MC_OWN, MC_BARTER, MC_SPECIAL=claim,
  MC_OWN_SALES, MC_OWN_FARM, real-rate crops; stopped by the user at minute 95): every new path ran live without a code
  failure; chore busy over 90 min 19.9% / 16.4% vs the sim's 18.7%; 25 chests each, 13-14 own farms, 48 / 36 carry trips,
  10 / 45 trades, 41 / 48 own meals, 10 / 23 own makes, 19 / 7 sales; the late phase (the sim's collapse after ~90 min)
  was not observed live;
  refusals by design (no 9x9 pad within 24 of a house; houses ~87 from the hut leave 3 blocks of reach under
  FIELD_HUT_REACH; a public work being laid out); one offer left up after its poster spent the goods (failed twice, fixed
  in 7d84c87). Logs: runs/2026-10-21/s43/s43_eco1, s43_eco2.
  Sim at 50 members (--workers 49): busy 11.5% vs 20.4% at 25 (90 min); 14.3% with the economy; new members' appetites
  look missing (meals 340 vs 312 at 25): check before trusting food numbers at 50.
- F266 (10-21, s44, issue #78) **Innovation v2 in the simulator: research points end the lottery; the tree stops where
  demand stops, and royalties are small.** MC_INNOVATE (off): an entry unlocks when members' experiments (8 points a good
  roll, 2 a bad one; more for curious members, repeat researchers and wanted entries, up to 2x) reach 10 x its complexity
  (recipe steps beyond planks, sticks, charcoal and torches, raw inputs, a furnace, hard inputs: hay 15, pies 35,
  jack o'lanterns 25, armour stands and shears 55, lanterns 65); pledges add capped points; credit and pledges by share;
  shears after iron tools, jack o'lanterns after shears; a 10% royalty on the final goods to researchers and pledgers by
  points (the user's). Sim (real-rate growth, 180 min, 3 seeds, economy on, raw iron 24 stocked and iron tools set made):
  hay at 5-20 min, pies 11-17, lanterns 38-51 (v1: 2-6 min), 19-24 attempts a run (v1 3-13), lanterns by 5-10 researchers,
  credit over 9-13 members; busy 14.8 / 16.8 / 15.7% vs v1's 15.0 / 15.3 / 15.9 (noise). Shears and jack o'lanterns never
  unlocked: with no want they are offered to curious members only, who have other chores (prediction: shears in 1-2 of 3
  runs, missed). Royalties 7-11 pies a run to 2-3 members (hay bales never made, 4-5 lantern batches). v1's experiments
  were rare (60 of 5,062 menus) because an attempt's materials were seldom all in the commons. A first royalty count from
  the member's storage flow paid a third of what was due (the flow nets a put against the member's earlier takes of the
  item, a pie eaten); counted from the make's own "put into storage" line. Logs: runs/2026-10-21/s44/sim (v1_s*, v2_s*,
  r3_s*), predictions v2_prediction.txt.
- F267 (10-21, s44, issue #79) **Life goals in the simulator: beauty, standing and invention make distinct roles;
  wealth, home and mastery do not yet.** MC_GOALS (off; server/src/goals.ts): a goal per member drawn once the village is
  complete from its temperament (capped, every goal present: 25 members 3-6 a goal), progress measured by code and shown
  on the menu and prompt, gw 1.6-2 on the options that serve it (exempt from the fixed pick's rank decay, the weights'
  product capped at 6.25; the user's). Sim (180 min, real-rate growth, 3 seeds, economy and innovation v2 on; off arm
  r3_s*): goal members' share of picks on their goal's options against other members': beauty 24-41% vs 6-7% (lift
  4.1-6.2), standing 26-41% vs 4-7% (3.7-9.7), invention 10-15% vs 2-3% (4.2-6.4), each group far ahead on its own measure
  (beauty 73-90 vs 4-5: 6-8 small works each; standing 21-29 helps each); wealth 0.4-1.3x (own-stock chores are common to
  everyone; prediction 0.8-1.3 held in 2 of 3), home 0.7x (its options, own-house furnishing and an own chest, are rare:
  prediction 1.3-2 missed), mastery not measured (a craft needs 5 makes of one good; progress ~0.1). Busy 15.7 / 14.7 /
  16.9% vs 14.8 / 16.8 / 15.7 (goals move work between members, they add none: prediction +0-2 met at 0); late bins
  unchanged. Shears and jack o'lanterns still never unlocked (prediction 2 of 3 missed): invention members see untouched
  entries, but raw iron and research go to lanterns first. Fixed after the diff review: a draw over a half-spawned village
  on resume (redrawn while no counter is kept), invention offered with innovation off, a member's own project counted as
  help for standing. Logs: runs/2026-10-21/s44/sim/g2_s*, prediction goals_prediction.txt.
- F268 (10-21, scorecard session, issue #80) **The thriving scorecard's baseline: the village collapses at minute 80-100
  in every run, but the pass mark as written passes today's default, because hour 2 already holds half the collapse.**
  `scripts/scorecard.py` on 6-hour sims (mv3_grown25, Rch1's settings, `--random-tick 3`, seeds 1-3; prediction
  `runs/2026-10-21/scorecard/prediction.txt`). Default: busy 22.0 / 12.2 / 6.3 / 6.3 / 6.1 / 6.4% by hour (seeds 2-3 within
  0.4), below hour 2's mean for good from minute 80 in all three, a floor of ~6% from minute 100 to 360; last hour 0.52-0.54x
  hour 2, so **PASS 3 of 3** by the rule (0.27-0.29x hour 1). The economy's flags on (MC_OWN, MC_BARTER, MC_SPECIAL=claim,
  MC_OWN_SALES, MC_OWN_FARM, MC_INNOVATE, MC_GOALS): 25-26 / 13-15 / ~6 / ~6 / ~6 / 5.4-6.6%, **FAIL 3 of 3** (0.42-0.46x
  hour 2) only because barter raises hour 2; the late floor is the default's. Prediction FAIL 3 of 3 for both with the
  collapse at 100-120: the shape and minute held, the verdict missed for the default. Needs met 0.95-0.98 throughout
  (housing and light 1.0, food 0.84-0.96): nothing collapses but labour. Works and public works stop at minute ~100
  (74 + 32 then 0); road cells flat at 3,127 from hour 3. Goods per member in storage rise 1.12x hour 2 (default) to 2.3-2.5x
  (flags on: own crops pile up, kinds flat at 73-74): stock grows with nothing to spend it on. Inventions: hay only, at 17-33
  min (no raw iron stocked: no lanterns, as F266). Barter 30-60 trades a run, most in hours 2-3, ~0-5 an hour after (s44's
  197 in 3 hours had sugar cane, carrots and raw iron stocked); merchant 4-7 trades an hour (default), ~0-1 (flags on).
  The scorecard's live side reproduces RUNS' figures (Eco1 chore busy 19.9% over 90 min, Lng1 F262's bins exactly). The sim
  export changes no decision (choice log and villages.json byte-identical, same seed). Logs: runs/2026-10-21/scorecard/
  (baseline.txt, baseline.json, sim/).
  **Rescored on the revised pass mark** (the user's, 10-21: a collapse is any hour after the first whose busy falls under
  half of hour 1's; needs met not judged): **all six FAIL**, hours 3-6 under half in every run, collapse (the first
  30-minute window under half) at minute 80 (def_s1, def_s2, on_s2, on_s3) or 90 (def_s3, on_s1); hour 2 at 0.51-0.62x
  hour 1 (just above), the worst later hour 0.20-0.29x. The panel's verdict and the script's agree on every run
  (`runs/2026-10-21/scorecard/verdict_compare.mts`). Logs: baseline_v2.txt, baseline_v2.json.
- F269 (10-21, M2 spec session, issues #4 #6 #81) **Vanilla villagers on Paper 26.1, measured: the free bed gates every
  birth and food given without one is eaten in vain; at the frozen noon only unemployed villagers breed; residents cost
  little load.** Probes on test world 1 (mv3_grown25 restored; glass pens at y 150 beside an idle Gus, 2 summoned
  adults each; `runs/2026-10-21/m2-spec/probes.md`). Adults claim a free bed within seconds, babies too. Two adults with
  12 food points each (3 bread) and a free bed make a baby within ~1 min; each parent eats 12 points (6 bread a baby),
  waits 6000 ticks (5 min), the baby stays a baby 24000 (20 min). With no free bed the pair keeps trying and eats the
  food every try (24 bread gone in under a minute, no baby; a full 4-bed pen ate its last 12). At day 6870 (the frozen
  noon, the working hour) two farmers on composters never bred in 11 min (one pair a rule: each rule observed once); at
  a frozen 9500 (the meeting hour) they bred within 45 s; unemployed adults bred at 6870. Summoned villagers have `CanPickUpLoot 0b` and never pick up bread until
  set to 1b (then within 30 s, one villager taking the whole stack). With the day on (tick rate 40), all 12 villagers
  were in their beds at one reading and an iron golem spawned at dawn among 5 adults that had slept (none in 25 min of
  frozen day; one night, one golem). Six homeless adults let
  loose at the village's meeting point drifted out of the village within 4 min, and four housed ones (a bed each in a
  village house) kept their homes but roamed 18-77 blocks from them within 9 min: a bed does not keep a resident home
  while the day is frozen. Any bed is a home a villager may take, a member's included. Sheared sheep on a fresh grass
  floor regrew wool in 30-100 s (tick rate 40). A Mineflayer bot sleeps on 26.1, and the night skips within a second once `players_sleeping_percentage` of the
  players sleep (100% with one player awake held it). Load (25x25 pen, homeless villagers, 60 s each): Paper 1.3 / 3.2 /
  5.2 / 9.7 ms a tick at 0 / 50 / 100 / 200 villagers with 9 idle bots (~0.04 ms a villager); the agent server's worker
  4.6 / 4.8 / 5.6 / 8.1% of a core, loop delay p99 unchanged at ~12 ms (~0.002% of a core per bot per villager:
  extrapolated, ~5% for 25 bots among 100). Not measured: working bots among residents, residents taking furnished houses' workstations (the
  checkpoint's houses hold only chairs and tables), residents picking up what working bots drop, restocks of trades
  with the day frozen. Spec: `runs/2026-10-21/m2-spec/spec_m2.md` (the review folded in: `review.md`).
- F270 (10-21, works-grow session, issue #75) **Works that grow, as refits: the late floor doubles while they last, and
  with repeats beside them the village misses the pass mark by one hour in each run.** What stops the works today (sim,
  mv3_grown25, Rch1's settings, `--random-tick 3`): public works stop for **land**, not designs (no free 24x24 site within
  127 blocks at minute ~91; 15 of 48 pieces built, refused 0), small works at a **people cap** (greens = members / 5 = 5,
  "initiate: no room (greens full)"); with the population parked, a copy per N people adds nothing. A larger variant on a
  building's own spot fits **0 of 26** buildings (layouts pack them against streets, lamps, signs and neighbours' rings,
  even spilling off the pad). Vanilla has no building tiers (numbered pieces are worldgen alternatives). So (the user's
  choice) **refits**: MC_WORKS_GROW (off; refit.ts) raises a layout's standing buildings a tier on their own cells, tier 2
  cobblestone to stone bricks, tier 3 log posts to wood and wooden roof stairs and slabs to stone brick, only changed cells
  drawn; offered in the public-work vote where new works leave slots; ~2,700 + 5,200 units on the 240-minute village
  against ~3,500 for all its public works. 6-hour sim, 3 seeds (busy by hour; collapse minute; worst later hour / hour 1):
  off 22 / 12 / 6.3 / 6.2 / 6.2 / 6.5, collapse 80-90, 0.28-0.29, FAIL 3; MC_WORKS_REPEAT 22 / 15 / 11.8 / 6.2 / 6.2 / 6.2,
  collapse 150 (24 works, last at minute ~160), 0.27-0.29, FAIL 3; **MC_WORKS_GROW 22 / 13.1 / 11.5 / 15.3-16.6 /
  13.5-15.9 / 6.1**, late (hours 4-6) 11.7-12.8% vs 6.2-6.3, FAIL 3 on hour 6 alone (collapse minute 80-90: a dip at
  80-100 while land-blocked works still fill the vote), all 41 refits built by minute 285-289, then the 6% floor; **both
  flags 22 / 15 / 12 / 9.8-11.4 / 10.7-11.1 / 15.8-17.6**, collapse 130-150, worst hour **0.45-0.49x**, FAIL 3 by one hour
  each (47-49 refits, still running at minute 358: repeats add buildings, and each can be refitted). Prediction (refits
  +2 to +5 late, 0-1 of 3 pass, collapse 150-270) held on the verdict, undershot the gain (+6) and missed the collapse
  minute (the dip at 80-100). Refits are a sink: storage goods per member
  end at 120 vs 145, net logs into storage 92 vs 677. Needs met unchanged (0.95-0.99). The scorecard's "+works" counts new
  structures only, so refits do not show there. Live (test world 1, Base1 from mv3_base1, MC_REFIT_FIRST and MC_VOTE=off,
  2x, haste 5): a tier 2 and a tier 3 refit built, the builder smelting 44 stone and crafting 44 stone bricks inside
  build_design; `scripts/checks/refit_cells.mts` read every changed cell back over RCON (43 + 16 right, 0 wrong) and the
  buildings not refitted unchanged. Where it stops: two tiers a building; the pool grows only with buildings, so after land
  runs out it ends (minute ~290 alone, past 360 with repeats). Logs: runs/2026-10-21/works-grow/ (probe/, sim/, report.md).
- F271 (10-21, live-scorecard session, issue #80) **Live, with model choices, the village declines from minute 80 as the
  sim does, but softly: hour 2 holds at 0.68x hour 1 and passes; the panel's scorecard works, but its busy runs one bin
  late and is lost once the agents leave.** LSc1: test world 2, mv3_grown25, 120 min at 1x, `--choose model` (gpt-oss
  cloud), F268's settings with the economy, innovation and goals flags on (prediction `prediction.txt`: FAIL, hour 1
  18-26%). Busy by 10 min 39 35 36 41 32 32 | 34 32 21 26 14 20; by hour **35.8 / 24.5%** (sim flags-on arm 25 / 14%,
  0.42-0.46x), chore busy 30.5 / 20.5% (Eco1 with fixed choices: 19.9% over 90 min). The 30-minute mean first falls under
  half at minute 100. Needs met 0.97 both hours (food 0.93 / 0.88, the rest at 1). Goods per member in storage 68 -> 89
  (1.3x), kinds 72 -> 77. Works 52 then 39, public works 39 then 31. **Barter: 0 offers in 2 hours** (25 own chests, but
  only 4 own farms, 8 refused near the hut, nothing stocked to trade; Eco2's 45 had cane and carrots stocked). Merchant 5
  trades in hour 2. Inventions: hay bales (minute ~40) and armour stands (~95). Load fine (0 [lag], 7 [stuck]). 1,467
  calls, 1.24M tokens, ~$0.25. The panel (`/api/scorecard`) sampled every minute and its works, inventions, goods and
  needs agree with `scorecard.py`. But (1) its busy points are the utilisation clock's bins aligned to the current minute,
  not to the scorecard's start, so they run ~one bin late and drift between reads (bin 0 read 26 against 39); and
  (2) busy is read from the agents present, so once the run's agents were removed every bin's busy and the verdict went
  (the last sample also showed goods per member 2,416 with 0 members). Issues #94 (the bins) and #95 (busy lost). Logs: runs/2026-10-21/live-scorecard/ (report.md, scorecard.txt, panel_scorecard_final.json).
- F272 (10-21, g1-memory session, #26) **With G1's memory on, members' later choices use what they remember, and an
  agent-server restart keeps every journal.** G1a: test world 1, mv3_grown25, 120 min at 1x, `--choose model`, LSc1's
  settings plus MC_MEMORY=on MC_CLOCK=on (20-minute days, the night's reflection). 924 model decisions in the ledger, 475
  notes written, 175 intentions (25 at the first dawn, then nearly all from the nights' 148 reflections). **Shown:** 704
  of 924 decisions (76%) showed a note or intention written 20+ minutes before. **Cited:** 137 of those reasons (19%)
  cite it (68 by 3+ shared content words, 69 naming it: "my intention", "as planned"), e.g. Kai at 31.5m chose fishing:
  "I need a fishing rod for personal food" <- its note of minute ~7 "I should still plan to craft a fishing rod soon".
  **Followed:** where the menu offered the intention's focus kind, members chose it 70% of 50 times against 30% by chance
  (its share of the options) and 33% with focuses shuffled across member-days (p < 0.001). **Counterfactual**
  (memorybench C: 24 of the run's own decisions re-asked 5 times with and without their memory section): the modal choice
  86% with it, 57% without; 12 of 24 decisions changed (e.g. Elena's first choice of day 1, intention "make torches":
  charcoal 5/5 with memory, her bench 5/5 without). **Restart** (R1, world 1, 25 members, model choices at 3x):
  `memory_restart.py` killed the agent server after night 1 (64 notes, 74 ends, 21 day lines), restarted it from a code
  snapshot in 11 s, `respawn_agents.py` brought all 25 back without reset: every journal as before; night 2's 23
  reflections and the members' choices went on from them. Health check against LSc1 (memory off, same settings, world 2):
  busy 36.0 / 27.3% by hour (LSc1 35.8 / 24.5), needs met 0.94-0.95 (0.97; food 0.84-0.87 against 0.93-0.88), works 54 /
  53 (52 / 39), PASS with no 30-minute collapse (LSc1's at minute 100); cost $0.44 (LSc1 $0.25: prompts ~1,350 tokens
  against ~900, plus 148 reflections); 0 [lag], 7 [stuck]. Prediction (`prediction.md`) held on use and health; the cost
  was at its low end. Logs: runs/2026-10-21/g1-memory/ (report.md, memory_use_G1a.txt, g1run/, restart/, bench/).
- F273 (10-21, g1-memory session, #26) **gpt-oss as its own memory's keeper: it writes at almost every chance, never
  supersedes unless forced, repeats itself, ignores enums, and keeps false beliefs; intentions steer it, remembered
  failures in day lines do not.** In G1a `remember` came in 889 of 924 decisions (96%; memorybench A: 47% of 150 on
  LSc1's prompts, 0 copies of the prompt): the per-day cap (3 a member-day) dropped 509; once notes were full it named
  `replaces` 3 times against 275 evictions by code (add-only, as AgeMem found untrained models to be); live notes are often
  near-duplicates ("craft an axe soon" three times) that exact-text dedup misses. At night it often answered the notes
  array with ids of notes to keep ("n1") rather than new text. It ignored the `focus` enum in the dawn and night tools
  ("animal care", "building", "beauty"): code maps free text to a kind (normaliseFocus). Some notes are false for this
  world ("lighting my house early prevents night mobs": peaceful, always day). Bench B (LSc1's prompts, 10 samples a case
  on and off): an intention set the night before moved the choice to its kind 67% against 17% (5 of 6 cases); the run's
  own pick shown as failed twice in an earlier day line stayed chosen 62% against 69% (2 of 6 cases moved).
  memorybench A-C cost $0.16 in all. Follow-ups: near-duplicate notes, replacement and false-belief checks (#86).
- F274 (10-22, g6-loop session, #73 #71 #16) **G6's loop closed once: a running village's wanted list made a foundry
  ticket, the foundry built and merged it, and members researched, unlocked and used it within one run.** W0 (world 2,
  mv3_grown25, 30 min, model choices, LSc1's flags + MC_WANTED=on): the live writer ranked honeycomb (shears on a full bee
  nest) first in all 7 samples (rank 3.46); `foundry_queue.py --api` wrote `tickets/honeycomb.json` from it (2 samples, 4
  chunks within 144 of the hut hold nests: 4 nests, 3 full, all 2-5 blocks up a trunk). The foundry (agy,
  gemini-4-argon-high): 1 round, 47 steps, 30 min, 4.65M tokens in; every gate passed (live: 3 honeycomb from a nest built
  by command, 0 of 1,663 cells changed; the new log gate saw `lib:honeycomb` load); merged `9666366` beside 22 of G2's
  uncommitted paths (the relaxed rule). W1 (same, 75 min, 2 shears stocked): research on 24 members' menus from minute 1
  (53 menus), 6 attempts by 4 members, unlocked at minute ~27 (inventor Quinn); the activity then on 20 members' menus
  (34), taken 7 times by 6 members: 4 harvests gave 18 honeycomb, 3 found the nest already used ("try later": bees
  refill a nest in some minutes); the workshop made 2 beehives and 2 honeycomb blocks from it. Busy 37.8% (LSc1's hour 1
  35.8%). Of the 13 take-ups (research and harvest) the model chose 3; 9 were the fixed order's fallback (30% of all W1
  decisions are fallbacks, 33% in LSc1) and 1 a repeat: when the model saw them, it took research 1 time in 18 and the
  harvest 2 in 9. Cost: W0 $0.08, W1 $0.19 (model calls). Logs: runs/2026-10-21/g6-loop/ (report.md, w0/, w1/,
  foundry_honeycomb.log), runs/2026-10-21/foundry/honeycomb/.
- F275 (10-22, g6-loop session, #89) **The wanted list's demand terms barely fire: the ticket was chosen by the adjacent
  possible, not by members asking.** Honeycomb's rank 3.46 = 2.46 from recipe value (18 items opened, none a consumer
  uses: waxed copper, beehives, honeycomb blocks, candles) and 1 from the village (118 raw copper held idle that waxed
  copper would use), 29%. Barter posted 0 offers in W0, W1 and LSc1 though all 25 members have own chests (`wantList`
  wants only food under 16 points or an own recipe's missing input, and members hold 60-90 goods; and it drafts wants
  only for goods another member can spare, so by construction it never names a missing capability); no need reached `no
  answer`; merchant orders are off. Filed #89 (make demand visible) rather than tuning weights.
- F276 (10-22, g5-proposals session, #13, #71, #89) **Asked at night, members propose improvements on about 1 night in
  7, and their proposals cluster on what keeps failing for them; code settles little, the triage settles all.**
  `scripts/proposals_draft.mts` re-asked 80 real night-reflection prompts of G1a and G2a (24 "reason nights" with a
  failure or refusal that day, 56 drawn at random; 2 samples each, gpt-oss medium, $0.08) with proposals.ts' optional
  `propose` field: 24 proposals in 160 replies (15%; reason nights 8 of 48, random 16 of 112), plus 5 `fix` drafts from
  failures that recurred in the decision logs. Themes, in the members' words: shared storage for tools, logs, seeds, torches
  or eggs (10); farms that cannot find a free 9x9 site (9: a wider radius, reserved plots, a plot-finder tool, pumpkins on
  dirt, a seed pack); a wider radius for public works, a request board, an automated coop, a tool crafting station, an
  irrigation block (5). 12 of 29 were duplicates of
  an open one (counted as backing it). Code's check (after three rounds of fixes on these very proposals): ok 8, the
  user's call 5, unclear 4, nothing it could answer outright (its "you can already" answers were wrong 5 of 5 on works
  and rules naming items in passing, so code now answers only item and activity proposals). The triage
  (`scripts/triage_proposals.mts`, headless `claude -p`, no tools, Opus 5.5; 2 runs, 66 s, $0.13): accepted 4 (a request
  board, a chest by the pens, the farm-site failure, the birch-sign failure), rejected 8 with how it already works
  (shared storage holds tools and logs; water already keeps farmland wet), deferred 5 to the user (wider farm and works
  radii, plot reservations). Its reasons are plain and correct about this world; it does not know G2's acts (it accepted
  a request board, which G2's requests already are). Logs: runs/2026-10-21/g5-proposals/ (report.md, draft.log,
  triage.log, proposals.json, accepted.json).
- F277 (10-22, g5-proposals session) **gpt-oss fills an optional object field with keys of its own invention, and the
  night's parsers were dropping them.** Of 24 filled `propose` fields, none used the schema's `what`/`why`: they came as
  `{"remoteFarmPlots": "Allow players to claim..."}`, `{"increasePumpkinFarmPlacementRadius": 5, "reason": ...}` or
  `{"birchLogExchange": {"description": ...}}`; parsed by the schema alone, 0 of 24 survived (the first parse). The same
  holds for G1's notes: in G1a's 148 reflections, 98 note items came as `{content, id}` or `{content, replace}` and
  society.ts' parseReflect dropped them (#90; G2a 16). Parse by shape (the key in words, the first sentence-long value, a
  nested description), keep the raw replies, and count fill against parse.
- F278 (10-22, g6-loop session, #89 #91) **With members' life-goal wishes as demand, the live wanted list ranks on the
  village's asking: 78-87% of each top entry's rank, against 0-55% before; the queue then stops for want of templates.**
  W2 (world 2, mv3_grown25, 30 min, model choices, W0's settings, 4287a68): once goals were drawn the writer ranked
  honeycomb 7.96-10.96 (locked: 9 members wish for candles, 35 research points, idle copper; 78% demand), wool 7.5 (13
  members wish for beds, banners, carpets, paintings; 87%), amethyst 6.31 (9 wish for a spyglass; 87%); in W0 the top 3
  were honeycomb 29%, copper weathering 0%, amethyst 55%. The wishes are code-kept from each member's goal (as needs are),
  not members' words; barter could not carry them (own chests empty, nothing to pay with). foundry_queue skipped all three
  (locked; no template for `use_on_entity` or `mine`) and fell through to mud (0 demand), which it could not ticket: the
  next limit is templates (#91). Busy 37% (W0 39%). Logs: runs/2026-10-22/g6-demand/ (w2/, wanted_W2.json,
  scorecard_W2.txt).
- F279 (10-22, g2-social session, #27 #28 #29 #86) **With G2's social perception and acts on, 25 members see each other
  through code-kept profiles, ask, take up and keep promises, and say lines; on the real prompts a request lifts its option
  from 29% to 65% and a broken promise halves the help its breaker gets.** G2a: test world 1, mv3_grown25, 120 min at 1x,
  `--choose model`, G1a's settings plus MCAI_SOCIAL=on MC_ACTS=on MC_MEMORY_QUALITY=on MC_CONTROLLER=on MC_SKILL=on (code
  f757fcb): 347 model decisions (fallbacks 1.4%); profiles in 1,001 of 1,005 prompts, 692 with facts beyond sight (help,
  promises, reports); 32 reasons name another member ("Helping Grace gathers needed logs for the market stall"); 22
  requests delivered, 6 taken up by choosing the tagged option, all 6 kept (Grace made the stone hoe Lena asked for); 15
  promises, all kept; 171 lines said (15 dropped off topic); 130 note merges (#86); roles: 6 distinct at the end,
  persistence of the modal kind over 5-decision windows 0.44 (G1a 0.54), specialisation index 0.079 (G1a 0.094). Health
  check against G1a: busy 37.5 / 28.2% by hour (36 / 27.3), worst hour 0.75x, needs met 0.92 (0.94); $0.55 ($0.44); 0
  [lag], 15 [stuck]. socialbench on G1a's real prompts: A (240 calls) 99.6% valid, `say` on topic 94%, no position over
  1.15x chance, the requested option chosen 65% with the request against 29% without; B (320 calls: two alike help options,
  one owner's profile shows it broke a promise to the chooser) the breaker got 28% of the help picks against 56% with plain
  profiles, 7 of 8 cases moved, 44 reasons cite the promise. #86 replayed on G1a's 984 note writes: 36% merge as
  near-duplicates, 0.2% refused (mobs). Scripted staged runs at 25 (no model calls): S3 24 requests, 17 taken up, all 17
  kept. Logs: runs/2026-10-21/g2-social/ (report.md, social_use_G2a.txt, bench/, staged*/).
- F280 (10-22, g2-social session, #29) **gpt-oss asks for what no menu offers, and acts tied to the menus' current options
  were mostly refused; a request has to be able to create the work that answers it.** In G2a members proposed 287 requests;
  the validator refused 265, most for items no gather or make option offered then (birch logs 151 in four spellings, stone
  hoes 51+, pickaxes): members wanted tools and materials the workshop had stopped making at its stock targets. About 60% of
  model decisions never run their pick (re-asked, taken or empty, as in G1a), and acts on them were lost until f757fcb.
  Fixed in 29431f2: an open request (or the promise that took it up) adds a batch to the make target or a trip to the gather
  want, so the asked option appears; a request may name any good or raw material; the storage check answers what storage
  covers. S2 found the demand vanishing once accepting closed the request (the make then failed "at stock"); counting open
  promises fixed it (S3: 17 of 17 kept). With the acts paragraph no longer saying "most choices need none", lines said rose
  from 36% to 62% of bench replies; spontaneous requests stayed rare in the bench (2 of 117) and frequent live, where real
  shortages prompt them.
- F281 (10-22, g6-loop session, #91 #89 #90) **The loop closed on what members asked for: the wool members wished for
  was ticketed, built, merged, researched, sheared and made into the wished goods in one run.** foundry_queue's
  skill-activity template (e40dd55) ticketed wool from W2's list (7.5, 87% demand: 13 members wish for banners, paintings,
  beds, carpets) as `shear_sheep_at` (the existing `shear_sheep` run at the atlas's sheep sightings), locked until
  researched. agy's plan quota ran out mid-ticket after 3 of 4 files ("resets in 81h"); the Claude Code back-end finished
  it (`--gates-only --cli claude`: 1 repair round, 2 min, $0.72; review $0.75, 5 low findings); every gate passed (live:
  2 wool from summoned sheep, 0 of 1,386 cells changed); merged 08891a0. W3 (world 2, mv3_grown25, 90 min, model choices,
  W2's settings, 3 shears stocked): wool research on 23 menus from minute 2, 7 attempts by 5 members, unlocked at minute
  ~56 (inventor Jonah); shearing on 68 menus of members from minute 59, taken 12 times by 8 members (5 the model's own
  picks, 3 fallbacks, 3 only-option, 1 repeat), 47 white wool deposited; the workshop then made the wished goods: 2 white
  banners, 2 white beds, 3 paintings, 1 white carpet (and from honeycomb, also researched and unlocked in W3: 9 harvests
  by 6 members, 2 beehives, 2 honeycomb blocks). The wanted list's end: wool and honeycomb `have`, amethyst first (89%
  demand: 9 wish for a spyglass). Busy 36.2 / 37% by hour (LSc1 35.8 / 24.5). The model took the new options more than in
  W1 (wool 5 of 12, honeycomb research 5 of 7, against 3 of 13). Beds stay in storage: placing them in houses is the
  world's (#6, G2-adjacent). Amethyst needs a new skill: live, `collect` dug to a geode's shell and found no path to its
  clusters (#91). The G5 hooks (d910dbd) checked live on world 2: the proposals route listed a seeded proposal, a verdict
  routed `foundry` for a capability no ticket can build was guarded to `issue`, the wanted list's demand rose +1 to +2 on
  acceptance, and a checkpoint kept and restored the village's proposals and 25 members' memory. Logs:
  runs/2026-10-22/g6-demand/ (w3/, wanted_W3.json, scorecard_W3.txt, foundry_wool*.log), runs/2026-10-22/foundry/wool/.
- F282 (10-22, g6-loop session, #91 #92) **Gemini 3.8 Flash high on the amethyst ticket: sound code that passes every
  offline gate, a live check failed four times on one point it never diagnosed, and the ticket's own geometry was the
  cause.** The ticket (foundry_queue's mine template, 3d09a49, from W3's list: 9 members wish for a spyglass) asked for
  a skill that digs its own staircase into a geode. Flash's code did that right in the live check: 29 cells dug, 4 shards,
  the budding amethyst kept, 0 of 5,940 cells changed outside the corridor and the geode. But the bot never climbed out
  (ended 9.6 below the ground). The template said to dig two cells ahead (feet, head) and the one below at each step: a
  staircase two high, which the no-dig walk cannot climb (a step up needs headroom above the head). Run 1: 5 rounds (one
  lost to a refused command), 102 tool steps, ~25 min of CLI, ~0.74M input + 11.2M cache reads + 162k output (132k
  thinking); scope, typecheck and check:offline passed every round; reviews passed with 1-3 low findings; live failed
  twice; then a network outage (06:29) ended it (no review verdict, the sign-in stop). Run 2 (`--gates-only`, the kept
  worktree): 4 rounds (one refused command), 51 steps, round 2 took 19 of the 31 minutes left, so rounds 3-4 had ~1 min
  each and answered nothing; live failed 4 times at the same verification. Not merged; the worktree kept. Against
  Argon (gemini-4-argon-high) on four earlier tickets: 1 round each, 47-151 steps, 30-52 minutes, 4.7-9.5M input, every
  gate first time, reviews 0 findings; but those were smaller tickets (use an item, a trade, fishing, an existing skill)
  and none had a geometry error in its brief. Flash's reviews found more (4 runs, 0-3 low findings each). The foundry
  also summed agy's cumulative usage (the report's 28-42M input is several times the real figure; fixed). Template and
  ticket corrected to three-high stairs (not rerun). Logs: runs/2026-10-22/foundry/amethyst/ (cli-round1-10, report.md,
  live_check.txt), runs/2026-10-22/g6-demand/foundry_amethyst*.log.
- F283 (10-22, g6-loop session, #91 #93) **With the brief right (three-high stairs) and a 90-minute cap, Gemini 3.8 Flash
  high wrote the amethyst skill and passed every gate in 5 rounds: the village's second wished capability, merged.**
  Fresh run (a6c739b, world 3): round 1 (69 steps, 13.5 min) wrote the four files; the review gate failed it (7
  findings, 2 high: the descent stopped outside the geode's shell, and a dig the server refused was ignored); round 2
  fixed them (review pass, 2 findings); the live check failed (no path to the surface spot); round 3 (one refused command)
  and 4; live failed again (the climb-out ended 4 blocks short); round 5 passed live (4 shards, the budding amethyst kept,
  0 cells changed outside the corridor and the geode, back at the ground's height) and the series; merged c61fcc8. In
  all: 5 rounds, 204 tool steps, ~54 min of CLI (113 min with the gates), 1.2M input + 23.5M cache reads, 377k output
  (302k thinking; the corrected count: the conversation's total, not a sum of cumulative reports). Reviews: 7 (2 high),
  2, 4, 3 findings. Against Argon (four earlier, smaller tickets: 1 round, 47-151 steps, 30-52 min, every gate first
  time, 0 review findings): Flash needs repair rounds on a hard ticket but makes real use of them (it fixed both high
  review findings and both live failures), and its review is the stricter one (it failed round 1 where Argon's reviews
  never found anything). The passing check hid one fault: the first call ended `action_failed` ("no amethyst cluster
  found") though it gained 4 shards on the server; the skill counts before the drops reach it (#93: the check should
  require `action_done`). Members' take-up is not run yet (worlds 1-2 held by Experiment 1). Logs:
  runs/2026-10-22/foundry/amethyst/, runs/2026-10-22/g6-demand/foundry_amethyst3.log (the earlier runs:
  g6-demand/amethyst_flash_run1-2/).
- F284 (10-22, g2-social session, #32) **Experiment 1, stopped early by the user's decision: with identical members over
  90 minutes, social perception did not raise specialisation; the off arm specialised as much or more; inconclusive.**
  Arms (a) MCAI_SOCIAL=on MC_ACTS=on against (b2) off; memory, clock, memory quality and the controller's rules on in
  both, temperaments, goals and skill off; 25 members, mv3_grown25, 90 min at 1x, code frozen at 29431f2; ABBA, then
  simultaneous pairs on worlds 1 and 2 with arms alternating (a recorded deviation). Valid runs: (a) 0.028, 0.015, 0.013,
  0.047 (mean 0.026); (b2) 0.037, 0.093, 0.068 (mean 0.066); primary one-sided exact p (a > b2) 0.97, the opposite
  direction (not pre-registered) 0.057. Void: E1b2 and E1a2 (a network drop at 06:24-06:34: error fallbacks 12% and 19%),
  E1b4 (the off-arm audit found a skill's failure message naming a member: fixed in c91b609); with E1b4 counted, 0.026
  against 0.054. Not pre-registered: the index over all picks 0.032 against 0.039, minutes-weighted 0.123 against 0.136,
  persistence over all picks ~0.5 everywhere. Power: 8-10 model decisions a member a run, pooled SD 0.022: a difference of
  0.02 needs ~15 runs per arm, 0.04 ~4. The data cannot tell a real absence from a lack of power; awareness among
  identical members may load-balance rather than differentiate (the planning session's reading), so the next test is
  character v2's heterogeneous members over 4-6 hour runs. ~$3.4. Logs: runs/2026-10-21/g2-social/ (report.md, e1/,
  e1_prereg.md, e1_primary.txt, e1_secondary.txt).
- F285 (10-22, g6-loop session, #91 #93 #96) **The flowers knowledge gap was mostly not the planner's: it planned dyes from
  flowers already, but no chore gathered them, coloured wool had no plan, and a dye planned from the tall flowers nobody
  picked.** The planner (mcMaterials.ts) chose red dye from rose bushes and yellow from sunflowers (2 dye a flower) and
  never from what storage held; green dye was dropped (cactus not gathered); coloured wool's one recipe recolours "any
  wool" and loops, so red wool, banners, beds and carpets planned as "gathered as they are". Fixed (7074fc4): flowers,
  cactus and beetroot gathered; coloured wool from white wool and its dye; a dye's source held in storage costs nothing
  when a recipe is chosen; no plan without a dye changed (the recipe check's same 28/29 differences). A pick_flowers
  library activity (collect on the flower with the most blocks near the hut), locked as "dyeing with flowers". Staged
  live (FL1, world 3, mv3_grown25, dyeing unlocked, scripted members, 15 min): Dev picked 18 wildflowers in its first
  chore; the workshop made 8 yellow dye and 8 yellow stained glass from them. On the wanted list flowers are now first
  (value 15.5: dyes, stained glass, concrete powder, coloured wool). #93 fixed (a205432): harvest_amethyst counted its
  shards before the climb picked up the drops of a cluster broken on the way; now action_done with 4 shards from 1
  cluster, twice live; the climb-out still fails from a deeper staircase (#96). Logs: runs/2026-10-22/flowers/ (fl1/,
  planprobe.mts).
- F286 (10-22, g2-social, character v2 step 5) **Character v2's layers reach the prompts and the weights, but at 25
  members over 2 hours their effect on model decisions is small: identifiability 1.8x chance (predicted 3-6x), the
  trait's option picked at 1.3x chance, a specialisation index above the null (0.026, p 0.02, against -0.008 off), and no
  mood effect.** A pair at the same time on one build, CM1 (MC_CHARACTER=on, world 1) and CM0 (off, world 2), 25 members,
  mv3_grown25, 120 minutes after completion, model choice at 1x. Both are valid (1 invalid reply each, 0.3%; prompt audit
  clean) and both pass the health check: busy 40->28% on against 38->31% off; needs 0.90 in both.
  - Results with character on: 58 rests by 23 members (0.39 a member-day; predicted 1-3); 8 requests taken up and kept
    against 5.
  - Goals from values: within 10 points of the draw except home (4%).
  - Public works in hour 2: 25 on against 42 off (rests, and members held to their kinds of work).
  - Predictions: identifiability, mood and rests fail; goals partly pass; the agreeableness lever is not measurable (5
    requests shown).
  - The interim's persistence contrast (0.41 against 0.71 at 68 min) reversed by the end (0.32 against 0.28).

  The gap between chores is the same in both (median 57-58 s, the 30 s cycle; MC_QUICK_NEXT is for it). ~$1.07.
  Logs: runs/2026-10-22/character/ (report.md, model/).
- F287 (10-22, g2-social, the wait between chores) **The 30-60 s gap between chores was the 30 s village cycle plus the
  10 s member cooling: MC_QUICK_NEXT cuts it to 5 s (median, 55 s off), and members spend 37% of their time on chores
  against 25%.** A staged pair, side by side on af3c35b: Q1 (MC_QUICK_NEXT and MC_WORK_BLOCKS on, world 1) against Q0
  (off, world 2), 25 members, mv3_grown25, scripted, 30 min, character and MC_GARDENS on in both.
  - Busy 41% against 28%.
  - Work blocks: 64 repeats; decided choices 172 against 301; role changes 59 against 103. The specialisation index is
    not raised in scripted runs (0.012, p 0.24, against 0.029, p 0.02).
  - Load: tick p99 18.5 ms against 5.3 ms.
  - Gardens: all 9 of Q1's saplings planted and grew into birches under MC_RANDOM_TICK=30, which gardens_live.py reads as
    missing. The sapling's leaf trip fails to reach canopy leaves (18 failures, most of the 44 `[stuck]` lines).

  Logs: runs/2026-10-22/quicknext/ (report.md, staged/).
- F288 (10-22, g2-social, the user's "Victor just stood around") **With MC_QUICK_NEXT, the sweep's fixed member order
  starved the last members: in staged L1, Rosa to Xavier never chose (Ada 51 choices, Victor 0).** A sweep came at each
  chore's end. The first members in the list finished short chores and took every freed option again, while up to 17
  idle members found nothing feasible. Q0 (off) was even (Victor 17), Q1 was skewed (Ada 62, Victor 6). Fixed (975f283):
  under MC_QUICK_NEXT the sweep serves the longest idle first, the Mayor still last; in L2 every member chose 11-17 times.
  - The fair order lengthens each member's own wait: gap median 36.5 s against L1's 5.1 s, since options are scarce.
  - The sapling's leaf trip takes only leaves within reach of the ground: 0 and 3 "could not reach" (L1, L2) against
    Q1's 18.
  - front_bed reached menus and its wildflowers were gathered, but its 4x4 box overlapped a house twice (sent to G6).

  Logs: runs/2026-10-22/quicknext/leaves/.
- F289 (10-22, g2-social, G8 the iron age) **The iron age runs live, but the village did not reach iron in 3 hours: the
  mine gave out at minute 46, and stages counted from their own starts missed the work done early.** Five staged runs
  (I1-I5, world 1) each found a blocker, all fixed (dc1dc83, 1f587fa):
  - tools unfound by name;
  - a village-wide back-off on one failure;
  - turned-back miners banning the iron kind;
  - an unreachable stairs start;
  - three levels too few;
  - two smelters on one load.

  The model-driven run IM1 (25 members, 1x, 3 h, $0.62):
  - **Stages:** stage 1 (600 cells) at minute 17, stage 2 (30 raw iron) at 37; stage 3 stuck at 11 of 24 ingots.
  - **The mine:** all four levels (1,919 cells, y 28 down to y -8) dug by minute 46, giving 85 raw iron (0.044 a cell, as
    the spec measured).
  - **Tools:** 18 given to 18 members, all before stage 4; 16 smelts.
  - **Why iron was not reached:** counted from the rung's start, every stage's target was met by minute 46.
  - **Forging:** 18 of 36 forge chores failed, "cannot be made from the village storage" with 4-6 ingots stored (other
    chores' earmarks, likely), and the forge was banned for over two hours.
  - **Specialisation over the iron kinds:** none, among 8 members with 5+ iron chores (index -0.028, p 0.74; 4 of 8 at
    60%+). Only 8 of 91 iron picks were the model's (421 rate fallbacks).
  - **Health check:** fails, busy 59% -> 37% -> 15% (collapse from minute 120, once the iron was gone).

  Next:
  - count each stage cumulatively from the rung's start, in order;
  - offer forging only when the ingots are free of earmarks;
  - add iron supply beyond four levels, or lower the targets.

  Logs: runs/2026-10-22/ladder/ (staged/, model/).
- F290 (10-22, long-run-w4 session, the user's 10-hour observation run) **With every feature on, food, innovation and
  the economy reinforce each other, and the iron stall turned into the village's most-backed proposal. Rules and council
  never fire, requests expire, and quick-next leaves the model only 8% of chores.** Long1: test world 4, dc1dc83, from
  scratch (L10, 25 members), model choices at 1x, 226 minutes of village life (F291 ended it). Chore busy 44.7 / 37.3 /
  34.4 / 22.8% by hour (0.51x; the first 30-minute window under half at minute 200). Needs met 0.77 to 0.87 (food 0.73
  to 0.88, housing 0.67 to 0.88 at 26 houses). Goods per member in storage 36 to 189 (5.3x), kinds 64 to 90. Works 98 /
  74 / 54 / 44 an hour.
  **Reinforced:** the iron level's stairs blocked digging (26 failures; the known bug, fixed in 1f587fa). Omar proposed
  several diggers at once (p1, kind "rule"), it was backed 11 times, and code's check tied it to the failing chore.
  Pumpkin pies unlocked in hour 0, paid inventors' royalties and fed the village. Nightly intentions converged on own
  pumpkin farms, so farm and slot work rose while the rest fell. Low energy (0.37) brought rests (21-47 an hour) and
  recovered it (0.75).
  **Conflicted:** MC_QUICK_NEXT against the chooser's 90 s gap: of 3,104 decisions, 253 were the model's (8%), 628 fixed
  picks for pacing, 492 repeats and 1,095 single options (#97). The `propose` field took the rule-like ideas, and the
  council's `law` field was used 0 times in ~275 reflections: no law, agenda or meeting (#30). Requests reached busy
  members: 74 made, 73 expired, 1 accepted; 6 commitments in all, all kept (#98). Barter came only once own chests
  filled (hour 2): 29 offers, 2 taken, 22 lapsed, with food in shared storage for all.
  **Never fired:** laws and the council; gardens (no garden option in any menu or vote); the ladder past iron (the
  stall); proposal triage (not run). Innovation stopped after hour 1 (5 unlocks). Need works stopped in hour 2.
  **Drifted:** say acts 234 to 46 an hour; make choices 419 to 140; mood stayed positive for every member throughout
  (mean 4-9, never negative). Ballots (~275 an hour) and reflections (75) were most of the model use. 2,657 calls,
  4.1M tokens, ~$0.86. Load fine: [stuck] 25 / 27 / 22 / 17, [lag] 3 (hour 3). Logs: runs/2026-10-22/long-run-w4/
  (report.md, analysis.txt, scorecard.txt, hourly.md).
- F291 (10-22, long-run-w4 session) **A Claude desktop app update kills every process a session started through
  scripts/detach.py.** Long1's Paper, agent server, run_series.py and stage_village.py died together at 23:48:41, with no
  shutdown lines, as the app's package was reinstalled (System log 23:48:44). detach.py falls back from
  CREATE_BREAKAWAY_FROM_JOB when the job forbids it, so the servers stay in the app's job. A restart from the same
  snapshot with respawn_agents.py brought all 25 members back with their journals (00:12). Issue #99; lesson 166.
- F292 (10-23, #99) **The Claude app's job forbids breaking away from the Bash tool's shell, so detach.py now starts
  through WMI.** Every process a session starts is in the app's job (claude.exe and the CLI are in it; from the PowerShell
  tool the job allows breakaway, from Bash it does not), so detach.py's CREATE_BREAKAWAY_FROM_JOB fell back and its
  servers stayed in. Processes started by `Win32_Process.Create` belong to no job and run in the user's session: detach.py
  has WMI run itself with a spec (command, log, directory, environment), and that one starts the command and returns its
  PID. `scripts/checks/detach_job.py` starts a child through detach.py from a parent in a kill-on-close job of its own
  and kills the job: python and node children live on (the old detach.py: both die). A node that spawns joins a job of
  libuv's own, which is not the app's. stack.py up and down on world 3 worked unchanged (Paper and agent server out of
  the app's job, logs written, ~26 s up).
- F293 (10-23, g2-social, G8 the iron age after F289's fixes) **With cumulative stages, the forge on free ingots, the
  model's 30 s floor and the ore-following mine, the model-driven village reached the iron age at minute 16 and voted for
  letters. The model's share of real choices doubled. The mine gave 28% more iron a cell, and kept going. No specialists
  formed, and a 120 s event-loop freeze at minute 120 ended the run.**
  - **Staged I6-I7:** iron at minutes 6-8. I6's rung vote looped (growTick closed every finished vote): fixed in 4d8de24,
    and I7 took up copper from a single vote.
  - **IM2** (25 members, 1x, model, real ore, the first 2 hours; driver died at 119.9 min): every stage done at 16.4 min,
    all at once once the tools counted. The rung vote cast 25 of 25 ballots: letters 13, diamond 7, copper 3, machines 2.
  - **Model share of real choices:** 53% (509 model, 278 rate, 181 taken) against IM1's 24% (168, 421, 118). Of the iron
    picks, 48 of 202 were the model's, against 8 of 91.
  - **The mine:** 5,226 cells, 295 raw iron (0.056 a cell against IM1's 0.044), still digging at 2 h (IM1 dry at 46 min).
  - **Iron work:** 202 iron chores (74 dig, 62 smelt, 66 forge), 47 tools given to 24 members.
  - **Specialisation:** none. 23 members with 5+ iron chores, 7 of them at 60%+; index 0.011, p 0.30.
  - **Health:** chore busy 59 -> 53% (IM1 collapsed to 15%). Food met fell 0.81 -> 0.64, with storage food at 0 by the end.
  - **The freeze:** the event loop was blocked about 120 s (`[lag]`, Tess on a dig trip); Paper dropped every bot and the
    driver's API read timed out. Likely the ore mine's per-step search: drifts against sightings over 5,226 cells (the risk
    its build named).
  - Logs: runs/2026-10-23/ladder/ (staged/, model/).
- F294 (10-23, long-run-w4 session, the user's all-features observation run) **With G2's iron fixes and the 30 s model
  floor, the all-features village holds its work and climbs the ladder. Long1's collapse and starved model choices are
  gone; what's left is the run spec's appetite, the iron stairs, the forge's message and the unused law field.** Long4:
  test world 4, 4d8de24, from scratch (L40, 25 members), model choices at 1x, every flag on with MC_ORE_MINE, 159
  minutes (stopped by the user). Chore busy 55.1 / 49.3 / 48.2% by hour (0.88x; Long1 0.51x by hour 4). The model chose
  38-39% of chores in hours 0-1 (Long1 8%), with pacing fallbacks down from 20% to 13%. Iron age stages 1-3 (600 cells,
  30 raw iron, 24 ingots) done, the iron age reached on day 2, and a rung vote for the age of letters (16 of 25), with
  no progress on letters in the 50 minutes left. Commitments 46 made, 44 kept (Long1 6); requests still all expire (43
  expired, 8 moot; #98).
  **What went wrong:** food met 0.57 to 0.48 with 152 hungry and 220 peckish events. MC_APPETITE=60, copied from F268's
  sim settings, drains 3.3x the default 18. 47 of 52 failed iron trips were refused for the stairs lock (#101). 13
  forges failed with a message naming only ingots and fuel (#102). 0 laws in ~200 reflections while all 3 proposals were
  kind "rule" (#30; Long1 the same). 0 barter trades. A member stranded at y 25 had no rescue (#103). Goods per member in
  storage rose 118 to 479.
  No freeze: the mine stayed at ~1,150 cells a level (IM2's froze near 5,000, F293). Cost 2,186 calls, 4.0M tokens,
  ~$0.79; 0 [lag]; [stuck] 8 / 12 / 40.
  Before it, Long3 ran ~45 minutes with the Ollama app down (645 failed calls, every choice the fixed pick), and Smk2's
  48 early failures had been the first sign. Logs: runs/2026-10-23/long-run-w4-4/ (report.md, hourly.md, analysis.txt).
- F295 (10-23, ore-veins session, #100) **Miners left a third of each vein they touched: the ore inside the walls and in
  the floors. Digging out the whole vein raises raw iron a cell by about half offline and doubled it in a short staged run.**
  - **The saved mine** (im2_mine, 5,228 cells; scripts/checks/ore_veins.py, regions against mc/testworld): 278 iron mined
    of the 408 in the 65 veins it touched (26-connected, mean vein 5.3 blocks, largest 18). Left: 34 exposed (29 in
    floors: a floor ore needs cobblestone for its hole, and trips start with none; deepslate levels give none), 96 a block
    or more inside the walls, where keepOres (one column from the cell) never looks.
  - **Offline** (scripts/checks/vein_sim.py, 6 seeds on the same land): today's rule 55 raw iron a 1,000 cells (IM2 live
    56), the whole vein dug 82 (+48%) for 5% more blocks broken; a cap of 12 a cell loses nothing; branches 5 apart with
    the vein dig 116 (#105).
  - **Built:** MC_ORE_VEIN (with MC_ORE_MINE; off), 247ece1. Live check ore_vein.py (world 4): 23 of 25 planted vein ores
    by dug cells taken, 36 mined and 36 raw iron brought up (keepOres alone lost about 1 drop in 4).
  - **Staged from im2_mine** (25 scripted members, 2x): V1 (on) 251 cells, 25 iron (100 a 1,000), 4 veins touched, all
    wholly taken, 0 exposed left; V0 (off) 1,008 cells, 44 iron (44 a 1,000), 12 veins touched, 27 of their 71 ore left,
    12 exposed. Region diff: nothing changed but cells, ores, fills, torches and dripstone. V1 ended at 7.5 min in a 124 s
    event-loop freeze, the third today with a dig_iron trip running (two before the vein dig existed, #106); the profiled
    PV1 (on, 14 min) had none and the vein dig under 0.1% of CPU. Logs: runs/2026-10-23/ore-veins/ (report.md).
- F296 (10-23, the economy, offline) **Members' own chests stayed empty in the wealth monoculture (W1, world 5) because
  the share only ever reached food from a few chores.** In 30+ minutes, 944 choices: make 332, iron 143, help 94, light 78,
  and only 50 farm/slot/penwork/gather/activity chores, the kinds that share (own.ts SHARED). Of those, only food was
  shared (OWN_GOODS): gathering trips' logs and stone and iron trips' coal and stone never were. So: 11 shares of 1 item
  in all, never the 8 owed that offers "Take your share home", so no surplus and no sale (sales need 6-20 of a food); two
  of six own farms got no seeds and two failed on land. And from day 2 the council's 10% levy took the whole of each
  share: `levyLeft` left at least 1 item, all of a 1-item share. Fixed behind MC_OWN: iron trips share (their stone and
  coal, never the iron); the merchant buys members' coal (15), stone (20), granite, andesite, diorite (16), sticks (32),
  string (20), carrots and potatoes, and those goods are shared; the levy rounds (a 10% levy leaves nothing of a share
  under 5); an emerald's barter value is still the food sales' 16. `scripts/checks/own_share_unit.mts`; goldens
  unchanged. The simulator does not model iron trips' stone: needs a live run.
- F297 (10-23, monoculture session, the user's experiment) **An all-wealth village talks, asks and votes differently from
  a mixed one within 30 minutes, but works the same, and can't get rich: in an hour no own share reached a chest.** One
  pair, 65 minutes of village life each, from scratch side by side (W1: MC_CHARACTER_PRESET=wealth on test world 5; M1
  mixed on world 3; code 7d89164; Long4's flags with MC_APPETITE=18, MC_NEED_VOTE, MC_LEVY_VOTE=day2).
  **Clear:** the wealth members' model choices named wealth 69% of the time (M1 13%), profit 31% and the market 17%, and
  the village or helping 13% (M1 54%). Requests 41 against 91, offers 6 against 16, promises 5 against 18. Laws: 9 of
  W1's 21 proposals were contribution laws (M1 1 of 17), and W1's council rejected 3 of 6 (deposits of torches and of
  tools, announcing iron digs; 4-7 yes against 17-20 no), against none of M1's 6. Levy ballots: W1 17 at 10% and 7 at
  0%, M1 20 at 10%; 10% won in both.
  **Could be noise:** chore busy 61.0 against 58.1%; buildings (houses 29 / 28, small works 38 / 43, gardens 14 / 19,
  public works 6 / 5 at minute 60); food (15.0 / 14.7 of 20, none hungry at appetite 18); mood (+5.1 / +8.0); own farms
  started 10 / 4; [stuck] 60 / 23; the ladder (iron on day 2, then letters in both).
  **Not measurable:** 25 own chests each but 0 items and 0 emeralds in every one (shares of 1 cod or wheat earned, none
  carried home), 1 merchant sale each, 0 barter. The model's share fell from 36-37% to 13-17% after 30 minutes in both,
  mostly `fallback/rate`: the 30-an-hour cap (MC_CHOOSE_HOURLY) is used up within the first hour under the 30 s floor.
  There were no queue or withdrawn fallbacks and the gates' waits were 0 ms, so it was pacing, not cloud contention,
  and it was equal in both arms.
  Logs: runs/2026-10-23/monoculture/ (report.md, compare.md).
- F298 (10-23, g3-rules session, #30) **The law field was never unused: gpt-oss wrote a law on 238 of Long1's 275 nights,
  every one under its own key ({"dailyToolQuota": "Each member may take..."}), and applyLaws, reading only `law.what`, dropped
  all 238.** The acts log keeps the parsed reply, so it showed no law at all; the raw replies are in the model-call record
  (runs/model-calls/2026-10-22-46872.jsonl). What members proposed (code's reading now): "each member puts at least N X into
  storage a day" 96 (a new type, `contribute`, the user's), take quotas 49, storage floors 22, duties 12, customs 59 (mine
  scheduling, returning borrowed tools); 4 meal quotas refused. With the reader fixed the rate would be ~22 laws a night;
  the same rule proposed again now joins the open one (the user's). lawbench on Long1's own night prompts (10 nights x 4
  samples x 3 conditions, run twice): a law written on 70-88% of nights, read by Long1's code 0%, read now on every night
  one is written; typed 83-91%; a template of sentences in the prompt narrowed laws to one type (29 of 33), the kinds in
  prose did not; with 3 open laws shown, members back one on 82-87% of nights and propose a new one on 36-46%.
  Logs: runs/2026-10-23/g3-rules/ (bench/, spec_addendum.md).
- F299 (10-23, g3-rules session, #30) **The secret ballot: 13 of 120 ballots parsed (gpt-oss leaves the item out on a
  one-item ballot, or writes "reason; yes"); 119 after. With nothing at stake gpt-oss votes yes on 99% of laws; with code's
  stake line ("For you: yesterday you took 12 logs: it would have refused 4") members a rule burdens vote yes 37%, others
  89%.** rulebench, 12 samples a case, 10 cases: valid 97-99%; yes or no listed first chosen 55% (no bias); a need item's
  first-shown choice 65% against 33% by chance (about 2x: each member sees its own order, so it adds noise, not a side).
  Live (G3m1, 25 members, 2 h): 36 laws by 24 members, 75 ballots at 3 councils, yes 66% (contributions 48%, customs 94%,
  duties 77%); passed "1 item a day into storage" 20-2, a help duty 17-5, two customs 22-2 and 24-1; failed 64 items a day
  2-21, 5 torches a day 8-15, 1 tool a day 14-10. Ballot reasons cite the member's own stake ("The 64-goods threshold is
  above what I can consistently produce"; "The minimal 1 good rule is trivial and aligns with my contributions").
- F300 (10-23, g3-rules session, #30 #33) **Members live under the rules they pass, and the village keeps its work: G3m1
  (CM1's settings with rules, council and an imposed 20% levy) held busy 42.3 then 39.3% (0.93x) where CM1 fell 40.3 to 28%
  (0.69x); needs met 0.89 both. Compliance from world evidence: the contribution met on 90% of member-days (a rule members
  called trivial), the help duty on 64%; the duty's tag taken on 38% of the menus that showed it, the contribution's on 58%.
  Members who helped a project on days 4-6: 16, 16, 18 of 25 (CM1 13, 9, 13). Experiment 2's measure is at ceiling: the levy
  paid on 67 of 68 share answers live, and 98-100% of 1,080 vignette answers voted, imposed or as recorded, at shares of
  1-6 and of 12.** Shares were 1-6 items (about 1 a member-day at MC_OWN's 25%), so the levy of 1 was often "all". The
  only spread is in leaving more than the levy (P(all) 13-46%). The user's decision: report the ceiling, no live runs.
  Staged G3s1 (scripted): a log quota of 4 a day took away torch making, so a torch contribution was met on 3 of 75
  member-days and a lighting duty on 6 of 50: rules members vote for can undercut each other. Cost of G3m1: 1,772 calls,
  3.1M tokens, ~$0.63. Logs: runs/2026-10-23/g3-rules/ (model/, staged/, bench/, report.md).
- F301 (10-23, ore-veins session, #106) **The ~120 s freezes with an iron trip running were harvest_amethyst's loops
  spinning on microtasks, not the mine.** Each of the three blocks (11:32, P0, V1) came with a member on harvest_amethyst
  begun before it. Each ended where that skill's wall limit falls (300 s at 1x, 150 s at 2x, from its own start): V1's
  Wren began 33 s before the block, which lasted 124 s. A turn of its dig loops whose cell was dug already, with the bot
  on the step, awaits nothing real, so the loop ran until the limit and every bot timed out. dig_iron was only
  coincident (the miners walking at the time). The uncommitted fix in server/src/mineflayer/foundry/amethyst.ts (another
  session's, 17:12) yields 20 ms in each of its four loops. F1 (without it), F2 and F3 (with it) ran 25 minutes each
  from im2_mine with 3 amethyst trips each and no freeze, under scripts/checks/freeze_catch.cjs (the inspector paused on
  any API silence over 5 s; none). Logs: runs/2026-10-23/ore-veins/freeze/.

- F302 (10-23, monoculture session, the user's experiment repeated) **The all-wealth village's council again rejects
  duties and coordination norms, and a quarter of it again votes for no levy. With own shares working, the wealth drive
  now shows in own stock (160 shares received against 43). Payments barely moved (1 emerald each), and #104's building
  variety works live (28-29 distinct house designs a village).** W2 (MC_CHARACTER_PRESET=wealth, test world 5) against
  M2 (mixed, test world 1), side by side from scratch, 92 minutes each, server 6b2649a (MC_PAY, MC_ORE_VEIN,
  MC_VANILLA_ALL, MC_WOOD_VARIANTS on W1/M1's spec).
  **Repeated from F297:** model reasons naming wealth 59% against 11% (emeralds 32%, trade 31%), the village or helping
  17% against 54%. W2's council passed 1 law of 5 and rejected 4 norms to announce or post iron digs (8-12 yes, 12-16
  no); M2 passed 4 of 5, rejecting only a 5-minute mine turn limit. Levy ballots at 0%: 6 of 23 against 1 of 22; 10%
  won in both.
  **New:** own shares received 160 against 43, own stock 194 against 119 items (Gini 0.54 both); priced requests 7 of
  47 against 5 of 61, all at 1 emerald; market stalls 15 against 9, front beds 21 against 11.
  **Didn't repeat:** W1/M1's request and promise gap (47 against 61 requests; 9 against 11 promises). 37 and 56 of the
  requests were refused because the village had plenty, so there was little to pay for: 2 emeralds moved in all, and
  members sold the merchant 1 item against its 193 bought.
  **#104 live:** 28 and 29 distinct house designs, each built once or twice (the old library gave 4 at ~6 each); birch
  for most neighbourhoods and oak for one or two, no other woods (none near home); 1 medium house in W2, 2 medium and 1
  big in M2; 23 and 25 work designs; no overlapping builds.
  **Caveats:** the model chose 16-18% of chores in both arms (work blocks' 3-in-6-minutes pacing), so the preset steered
  a minority of the work. Payments' levy isn't deposited yet; wages and short deliveries never came up. One pair: busy
  (59 against 54%), gardens (33 against 18, reversed from W1/M1), [stuck] (76 against 55) could be noise.
  Logs: runs/2026-10-24/monoculture2/ (report.md, compare.md).
- F303 (10-23, building-variety, #104's R3) **Members' own houses, measured offline** (`scripts/checks/gen_homes.mts`,
  commit f119569, MC_GEN_HOMES off).
  - **Variety:** generator v2 plus houseStyle.ts give 20-24 distinct homes for the 24 workers in each of the five
    families. Today's growth uses 4 designs.
  - **Forms over 120 homes:** L 39, T 17, two storeys 36, porch 74, chimney 58, shutters 49. The plains renders are in
    `runs/2026-10-23/building-variety/renders/sheet.png`.
  - **The budget shapes the result:**
    - stone bricks cost a furnace run a block, so even a 7x7 base is about 55 runs, over 32;
    - a cobblestone roof cut 21 of 24 snowy homes, and desert's sandstone cuts 15 of 24;
    - two storeys fit 150 units only at 5x7 or 7x5, so one home a neighbourhood may take 230 (the user's choice).
  - **Conformity is weak:** the most traditional members' houses share 3.9 of 5 looks with their family, the least
    traditional 3.6.
  - **Names:** a member's name can carry a word the name rules key on. `home_finn` and `home_quinn` ended in "inn":
    `isLandmark` took them for landmarks and `isDwelling` refused them. Homes are named by a hash, with the owner in
    `style.owner`.
  - **Not yet wired:** the world hooks (pickHouses' owners, homeTick binding, layoutStyle reading a home's family) are
    patches in the folder; no live run yet.
- F304 (10-23, all1 session, the user's run with all the latest code) **With every model-call limit lifted, the model
  runs three in four real choices for ~$0.6 an hour. The village still collapses at minute 60, on iron and land, not on
  the model. Generated homes work live (23 built, all different).** All1: test world 5, 56943ab, from scratch, 25 mixed
  members, 124 minutes; Monoculture 2's flags with MC_LLM_LIMITS=off and MC_GEN_HOMES=on; no spend cap.
  **Models:** 721 of 1,465 choices (49%; Monoculture 2 16-18%), 54-76% of real choices in the [models] lines.
  27.5 model decisions per member-hour in the first ten minutes, 8-13 once work ran out. Collisions: 299 fixed picks
  for a taken pick and 475 re-asks. Gate: reflections waited up to 14 s, decisions ~0, queue max 11. Cost $1.19 for
  6.3M tokens and 2,964 calls (3 errors).
  **Village:** busy 61.5% in hour 1, 29.3% in hour 2 (FAIL; the first window under half at minute 60); 14-16 members idle
  with nothing feasible from minute ~80. Iron never started: one early dig failed for want of a stone pickaxe
  (cobblestone short), the guard banned iron:dig village-wide for an hour (851 of 908 menus), and then the iron stairs
  couldn't be reached, so the level was marked finished ("no way down") with 0 cells dug, for good (#113). Own farms ran
  out of land ("no free 9x9 site within 24 blocks"); growth ended at 28-30 houses for 25 members.
  **Society:** acts on every decision gave 300 requests, 272 refused, 75 of them for axes not on offer (#114). 771 say
  acts; 30 commitments, 28 kept; 5 emeralds moved between members. The council passed all 5 laws, and the levy came
  out at 10% (14 at 10%, 3 at 20%, 1 at 30%, none at 0%).
  **#104 R3 live:** 23 generated homes, 23 distinct (38 designs drawn, one per member-to-be): L one-storey 6, rectangle
  one-storey 6, T 4, rectangle two-storey 4, L two-storey 3 (7 two-storey, 30%; F303 offline 30%), all in birch, no
  overlaps.
  Logs: runs/2026-10-24/all1/ (report.md, compare.md, scorecard.txt).
- F305 (10-24, finish-100 session, #100) **The vein dig holds in model-driven runs: 83 raw iron a 1,000 cells against 46
  without it, and 45% more iron a minute of digging, with no freezes.** Monoculture 2's W2 and M2 (92 minutes each,
  MC_ORE_VEIN on) against W1 and M1 (the same setup without it).
  - **Cells:** 5,935 cells gave 493 raw iron, against 5,332 cells and 247 raw iron. F295's staged run gave 100 against
    44; the offline estimate was +48%.
  - **The cost:** the tunnel goes ~19% slower (13.3 cells a dig-minute against 16.4), but iron a dig-minute rises (1.10
    against 0.76).
  - **The [vein] lines:** 95 of them, 397 vein ores taken beyond the 315 by the walls, 8 cells at the 12-ore cap. Left:
    52 out of reach, 39 beyond the box, 18 unsafe, 2 under a falling block, and 1 for want of stone (F295 left 29 floor
    ores for want of cobblestone).
  - **Freezes and tools:** event loop max 0.6 s, no RCON timeouts; pickaxes made 0.23 a trip-minute against 0.29.
  - **One fault:** two miners in one open cell (tunnels cross) dug and counted the same vein. Wren brought up 0 raw iron
    from 18 ores; Lena brought up 18. Fixed with a lock on each vein ore being dug.
  - **Not measured:** ore left in the faces. No checkpoint was saved and both worlds have been reset.
  Logs: runs/2026-10-24/finish-100/ (report.md, trips.py).
- F306 (10-24, g2-talk-pay, #111, paybench on Long4's real prompts) **A price does not draw members to a request: a
  2-emerald request's option was chosen as often as the same request unpriced (26% against 27% of 258 replies, 53
  decisions x 5; by decision 11 higher, 13 lower, 29 equal), and the prices gpt-oss sets are 1 emerald.**
  - Where a reply noticed the money (43 of 265 priced replies name emeralds or pay) it took the job (38 of 43), but the
    total did not move: members who would take it anyway now give the price as a reason.
  - Wealth-preset members took the asked option more in both arms (56% and 58%, 5 decisions), not more for the price.
  - Offered the pay paragraph and a guide (logs about 2, torch and charcoal about 1), members wrote a request in 13 of 120
    replies and priced 9: eight at 1 emerald and one at 0 (refused), whatever the guide or the item (a stone axe, a
    fishing rod, a signpost); wealth-preset members priced none of their 2.
  - So the monoculture rerun with MC_PAY on should expect few and cheap contracts; prices settling per good needs
    scarcity first (lesson 176). Logs: runs/2026-10-24/g2-talk-pay/paybench1.txt.
- F307 (10-24, g2-talk-pay, #107, talkbench on Long4's real prompts) **A told shortage barely moves choices, members
  pass told news on readily, and gpt-oss never asks a question.**
  - A food shortage told in the news section moved choices toward food from 19% to 22-23% (40 decisions with food among
    other options, 3-5 samples, three runs): +3 to +8 points where the prompt already said members were hungry, none where
    it did not. By decision: told higher in 4-7, lower in 4-5, equal in the rest.
  - With the first wording of the news line members wrote news in 1-3% of replies; with the second (concrete cases to
    tell) 3-4% unprompted and 12-26% when they had just been told the shortage, nearly all retelling it attributed ("Rosa
    said the storage has no food left...").
  - Not one question in 880 replies, with either wording or a concrete field description.
  - So news will spread a told problem but adds little to the choice it is about, and questions will come only from
    something other than the decision prompt (a scripted trigger, a failed chore, a night's reflection). Logs:
    runs/2026-10-24/g2-talk-pay/talkbench1-3.txt.
- F308 (10-24, g2-talk-pay, #111 and #107 staged, world 2, from ov_v1, 25 scripted members, 2x fast, 25 min after)
  **Every path fires in a staged run: the levy deposited by command, bounties from the commons, a wage step, a delivery
  emptied before it ran, news delivered, retold once and held out, questions answered by a model call, and voters shown
  earlier reasons.**
  - **Payments (TalkOn):** 18 contracts: a charcoal delivery paid 2; a torch delivery whose 18 torches were taken out of
    storage by command first refunded `short` (nothing reached the buyer; the deliverer unpaid, the promise moot); a wage
    on a project paid 1 of its 2 steps before the project closed and refunded the rest; 15 bounties (2 funded from the
    commons, 13 minted: storage held under the merchant's keep), 12 control requests. The levy owed (one sales levy and 8
    bounty refunds) was written into storage by command and counted, 9 emeralds; while storage was full it stayed owed
    and went in later. The emeralds the ledger sees match its rows plus merchant and barter trades.
  - **The first command deposit failed:** `data get block ... Items` returns the list cut short past a few stacks, so a
    full chest read as nearly empty (Pay111's emptying took 0 of 33 torches). Read one element at a time (lesson 178).
  - **Talk (TalkOn):** 25 news items (17 retellings, 14 held out), 17 dropped (13 already passed on once, 4 repeats);
    3.5 hearers an item; an item reached 7.5 members in 5 minutes, 9.8 in 10. A retelling first matched any two shared
    words ("short of glass" retold "short of torches"): now 3. 11 questions, all to anyone, to 10 different answerers,
    each answered once by one call in about 1 s (3 answers held out); answers were plain and sometimes useful ("the sheep
    have been grazing near the western edge of the wheat fields"). 24 of 25 ballots were shown earlier reasons (10.8
    lines a ballot).
  - **Health check (scorecard, 25 min, one run each):** TalkBase (payments and talk off) busy 37%, chore busy 24.5%,
    6 works, 2 barter, 0 merchant trades; TalkOn busy 44%, chore busy 34.0%, 6 works, 3 barter, 4 merchant trades (the
    purses bought 23 fishing rods). No verdict under 2 hours.
  - **Walk stalls:** [stuck] 17 in TalkBase, 72 in Pay111 (payments only), 162 in TalkOn, 159 of them three members:
    Wren in a 7-deep pit under the storage hut (-1629,59,19), Uma and Clara far west. Not traced to payments or talk;
    to watch in the combined run (filed as an issue).
  Logs: runs/2026-10-24/g2-talk-pay/ (report.md, staged/).
- F309 (10-24, home-basics session) **Home basics (MC_HOME_BASICS): every member's house got a crafting table and a chest
  in its first minutes, and 15 of 25 a bed by minute 10; the rest of the beds waited on sheep.** Measured first
  (im2_mine, ov_v0): 25 owned houses (plains small houses, a 3x3 inside), 25 chests (MC_OWN's), 0 beds, 0 tables: a
  3x3 inside gets one furniture spot (a chair) and the jar's beds, chests and tables are stripped at import.
  buildingDecor's `basics` picks a bed, a chest and a table first (25 of 25 owned houses fit all three; 360 of 452 jar
  house turns). Staged from im2_mine, 24 scripted members, 30 min after: HB0 (off) 0/25/0 (bed/chest/table); HB1 (on,
  first code) 2/25/17, two bugs and a rank: sheared wool counted only when white, a bed's cells holding an own chest
  placed by the old rule (4 houses), the option at rank 945 cut from most menus (Ben's on 5 of 43); HB2 (fixed, rank 5)
  15/25/25, all 15 complete by minute 10. The 10 short: the one sheep cluster sheared out (4 trips ended with 1-2 wool)
  and 26 "another agent took the wool" retries on wool storage listed but did not hold (the full hut, #120). Busy 40%
  against HB0's 39% (by 10 min 42/35/42 against 49/46/20); [stuck] 71 against 32 (the walks to the sheep, ~90 blocks).
  The pin (basic needs taken after a meal by every picker, kept on the model's menu) is checked offline only.
  Logs: runs/2026-10-24/home-basics/ (spec.md, judge_HB*.txt, staged/).
- F310 (10-24, storage-grows, #121) **A mining village fills its one storage hut in about two hours, and bulk stone and
  spill take most of it; with storage that grows (MC_STORAGE_GROW) the full im2_mine hut stopped refusing deposits.**
  Measured: the gauge rose ~2.5 slots a minute in M2 and W2 (224 -> 294 and 108 -> 322 of 405 by minute 90), flat in All1
  (no mine). Stone kinds took 34-43% of the slots (im2_mine: 155 of 357, 6,145 cobblestone in 12 of 14 containers), and
  spill cost ~30% (357 slots would pack into 248). Built (off): a cap on bulk stone (cobblestone 1,024, other stone kinds
  256; the rest on a spoil heap) and a 13x9 storage yard with 44 barrel spots, prepared by a chore once the hut has at
  most 2 free spots and 75% of its slots used (405 -> 1,593 slots). The first live try found no room: im2_mine's first
  mine level (y 58-61, 4 below the plot) lay under every candidate, so the yard keeps off the mine's hut and stairs only
  and searches 3, 7 and 11 blocks out. The second found barrels never crafted: craft does not make a recipe's slabs (6,000+
  "short of 2x oak_slab" in s41-s43's logs), fixed in ensureBarrel for every run, flag or not. Staged SG1 (im2_mine,
  world 1, 15 min after): the yard ready within ~2 minutes, 10 barrels in it, 9 spoil events; failed deposits by 5-min bin
  2/3/1 (none "full") against HB0's 88/63/204 (309 "full") with the same settings; [stuck] 19, [lag] 0.
  Logs: runs/2026-10-24/storage-grows/ (spec.md, staged/, try1-2 the failed tries).
- F311 (10-24, prompt-117, #117) **The choice prompt lacked the member's own state, and naming its unmet basic need is
  what moves the choice: with it the house, bed or basics option was taken 18 of 18 times when shown (9 of 18 as recorded).**
  choicebench on five real All1 decisions (gpt-oss low, 6 samples a variant): the self line alone ("You: no house of your
  own yet; ... 0 emeralds") moved a houseless member to iron for trade (2 of 12 took the street); with "Your basic needs
  first: you have no house yet" and the `[your basic need: a house]` tag, 12 of 12. Goal meaning fixed the misreading
  ("standing ... no help on others' projects" became "earning respect by helping") without moving Elena's pick to a
  standing work (1 of 6). "[nothing uses it yet]" on ladders and barrels changed nothing (5 of 6 ladders: "for the deep
  mine, the iron age"); "[not needed now: nothing in the village uses it yet]" halved it, and with the rest 0 of 6. A line
  naming the ambition's work on the menu took 11 of 12 picks to iron and overrode goals and scarcity: dropped (25 members
  at one mine would herd). Built behind MC_PROMPT_SELF (off), flag-off menus, contexts and prompts identical on two
  checkpoints. Logs: runs/2026-10-24/prompt-117/ (spec.md, bench/results.md).
- F312 (10-24, train1, #121/#117/home basics) **The first test train: storage that grows ends the full hut's failed
  deposits (10 vs 589 in 30 min), and #117's self lines make a model-choosing member take its basic need (own:basics 33 of
  35 shown, against 17 of 29 off and 32 of 60 in W4); the home-basics pin is absolute only for scripted choices.**
  Pair S (staged, im2_mine): yard ready ~1 min after start, 18 barrels, 7 spoil lines; busy fell 56 to 49% because the
  off run's busy was collecting and making goods it could not store. Pair M (model-driven, 1x, blank land): the flag-on run
  matched W4 (houses 2->25, beds 23 of 25 by hour 1); the flag-off run grew 13 houses, held back by walk stalls (903
  [stuck], most in the village mine under the storage hut; one member underground 64 min, #133), so the village pace is
  not the flag's measure. Tagged "not needed now" options were taken 15 times in 201 menus. Letters stayed at stage 0 in
  both (cane 27-29 an hour, #134). Logs: runs/2026-10-24/train1/ (report.md).
- F313 (10-24, prompt-117 session, #97) **Most of the model's lost picks are races between decisions in flight, and
  holding a pending decision's shown options would have run 95-99% of answers (model of model+fallback; 83-92% of every
  answer, drops included) in All1 and train 1, against 71-76% (32-47%).** Counterfactual on the decision logs
  (runs/2026-10-24/collisions-97/): of All1's 1,513 lost picks (741 empty drops, 475 re-asks, 297 taken fallbacks), 826
  were taken by another member while the loser was in flight (656 of them by another model decision answering first,
  p50 1.0 s after the loser asked), 133 more less than 3 s before its ask (after its menu was built), and 396 were
  projects lost to the 3-open cap when another member started one; train 1's M0 and M1 alike (897 of 1,596 races in M1).
  Decisions in flight at an ask: p50 2-3, p90 5-7. Holding the makes' capacity too adds 1 point: not built. Built behind
  MC_CHOICE_HOLDS (off): key holds plus the cap; the bound is optimistic (a prevented loss counts as run) and does not
  count the calls holds remove. Offline only: on mv3_base25 three decisions in flight cut the others' menus from 8.0 to
  7.0 options and every project; flag off, every golden unchanged.
- F314 (10-24, prompt-117 session, #122) **Two policy gates stood behind nearly every idle member in All1, and the
  model takes the gated options when they replace the filler but not beside it.** Of 3,193 idle-member entries with
  nothing feasible, 3,022 named "gather: nothing wanted" and 2,812 "initiate: enough projects open"; after minute 80, 104
  of 148 makes were filler (effect "later" or the torch reserve) and 106 menus held only makes. Built behind
  MC_POLICY_OPTIONS (off): on an empty or filler-only menu, a material nothing wants gathered anyway (under 192 in storage)
  and another project past the cap (under 6), tagged "[past a village limit]" with plain facts, and the filler off the
  menu. Bench on five such late All1 menus (6 samples each): gated options in the filler's place 30 of 30 (cobblestone 20,
  logs 6, a project 4); beside the filler only 9 of 30, filler 21 ("furniture for the houses later" reads as work). Check
  on im2_mine set up for it: 24 of 25 menus gated; flag off, goldens unchanged. Logs: runs/2026-10-24/policy-122/.
- F315 (10-24, train2, #134/#136) **The second test train: letters pace brings the age of letters in at 1x (stage 1 61
  minutes after the vote, the rung at 76, against 99 and 101 without), and the pad halo leaves a sloped plot's edge as
  the ground was (2 steps over 1 against 24, no cave air under the cut against 22 cells).** Letters pace: the market
  stall posted and built 3 minutes after completion (18 without), the merchant 4 minutes after (19), 16 cane bought the
  minute of the vote and both cane slots planted from storage (6 + 6, twice), ~47 cane an hour to stage 1 (~29 without);
  leather and books were made ahead in both. Pad halo (minevale3's sloped s0 plot, staged): growth plots blended over
  5-58 columns with 10 cave cells sealed, at 43% more blocks cleared a plot; stalls 4 vs 10. With storage grow, home
  basics and prompt self on by default both model runs housed all 25 and had beds for 21 and 24 by hour 1. Members
  trapped underground (#133) were teleported 4 times in L1, two on the way back from the amethyst geode under the
  village. Logs: runs/2026-10-24/train2/ (report.md).
- F316 (10-25, train3, #97/#122/#84) **Holds make nearly every model answer run (90-92% of model and fallback, 75-80% of
  all with drops, against 69-78% and 37-49%) and cut model calls by about a third; per-building pads keep a slope's
  ground (19% of the plot's columns changed against 46%) but starve the after phase of small works.** Pair C (the
  combined model-driven run, blank land, 1x) was cut at AFTER ~90 by an overnight shutdown: lost picks fell from 302 /
  278 / 320 a half hour to 122 / 54 / 57, menus shrank (2.5-2.9 options against 2.9-3.7) and $0.87 against $1.27. Policy
  options were taken on 150 of 162 menus that had them, yet idle members with nothing feasible were sampled 3-8 times as
  often as without (nearly all naming "enough projects open") and filler makes did not fall; with both flags in one run,
  and only 10 minutes past minute 80, #122 is not judged (a rerun splits holds from policy options). C1's iron age came
  at AFTER 84 against 40 because its iron stairs met caves five times (not a flag). Pair P (staged, the sloped s0 plot):
  every pad passed pad_halo but one member-dug column; after 20 minutes busy 33% against 56%, initiatives offered on 27
  of 507 menus against 161 of 818. Logs: runs/2026-10-25/train3/ (report.md).
- F317 (10-25, train3 rerun, #122/#97) **Policy options halve the idle members in hours 2+ (3,899 idle samples against
  8,426) and the filler makes after minute 80 (87 against 181), raise busy to 75% from 61% and cost less an hour (~$0.31
  against ~$0.43); much of what idle is left behind "enough projects open" is held decisions counting as open projects.**
  With holds on (both runs), the cap reads open projects plus every other member's pending decision shown a start option
  (mcWorld.ts heldProjects): 61% of C1's gate samples came with fewer than 6 projects really open, 20% of C0's with fewer
  than 3. Gated options were taken on 161 of 170 menus (lamp posts 92, sand 25), logs in storage grew to 972 against 604.
  Two things to look at: C1's event loop degraded from AFTER ~65 (loop p50 150-520 ms, RCON p90 1-4 s, against ~6 ms),
  and its walks stalled 1,107 times against 119 (members in the mine's tunnels under the storage hut, and the gated sand
  at a lake). Letters came at AFTER 175 in C1 against 112 (its shelving stage took an hour). Logs:
  runs/2026-10-25/train3r/ (report.md).
- F318 (10-25, prompt-117 session, #142) **C1's late event loop was held by the menus' light and furniture parts, whose
  cache key cost more than the cache saved, not by the gated spot search.** CPU profile of choices() for 25 members on
  C1's own end record (217 structures, 166 small works built; runs/2026-10-25/policy-142/): 5.4 ms a menu with policy
  options on, 4.7 off (0.3-1.7 on a fresh checkpoint); lightPartsOf took 336 of 579 ms self time (its signature
  stringified every structure, done build and lit spot on each of several calls a menu), smallWorkSpot 78 ms. A quick
  signature of counts and ids checked first: 2.4 ms on, 1.45 off; the past-cap spot search only on a menu that is filler
  so far: 2.15 on. A late sweep (25 members, ~3 menus each) from ~400 to ~160 ms. Also: held decisions shown a project
  count as one open project at most (three counted as three, filling the cap while none chose one), and sand is never
  gathered anyway (collect's lake-edge sand sent C1's gatherers into the water). The walks in the mine's tunnels were not
  traced. Offline only; checks parts_cache.mts, choice_holds.mts, policy_options.mts.
- F319 (10-25, train4, #84/#138) **A pad village growing outward builds in 6.4 min against 11.1, moves half the ground
  (26% of the plot's columns against 49%), walks stall less (167 [stuck] against 443) and stays compact (buildings a
  median 52 blocks from the meeting point against 83, max 92 against 130; 41 placed outward, none refused), but its
  after phase thins from AFTER ~80: busy 51/51% in hours 2-3 against 60/60, 88 initiatives against 138, 22 small works
  standing against 66; and from 13:47 (AFTER ~83) its agent server stalled 283 times for 2-6.7 s (tick p99 up to 5.2
  s), with members on dig_iron in every stall, where the off run had none.** Model-driven, 1x, blank minevale3, 25
  members, 150 min after, code 76b77de (before 59af444's parts-cache fix). Hour 1 was level (busy 74.7 vs 74.2), so the
  busy gap starts with the stalls; not traced. Pads: 10 of 13 passed pad_halo, 3 with steps of 2 (no cliffs, no
  caves); [stuck-world] 68 vs 2 (members in the mine under the pads). Both reached iron (AFTER ~42 vs ~27) and letters
  (~135 vs ~104); $0.95 vs $1.09. A DNS outage at 13:20-13:35 hit both alike. Logs: runs/2026-10-25/train4/
  (report.md); checkpoints iron_age_g1 / iron_age_g0.
- F320 (10-25, train5, #149) **The pad village's stalls are the chore menu's small-work spot search, not the iron
  trips, and 59af444 did not end them.** iron_age_g1 resumed with code 2339905: 429 [lag] lines in 90 min (56 in the
  first 10), 4.0-6.2 s each. CPU profile during them (runs/2026-10-25/train5/X/prof/x1_2): 45% busy, about half of it
  gardenSpots (13.9% of all samples) + smallWorkSpots (6.4%) + placedGrid/placedDoor (~2%), all under smallWorkSpot <
  choiceOptions (mcWorld.ts); lightPartsOf 0.4%. On a village spread out on pads (45 buildings out to 92 blocks) every
  menu searches the whole spread, likely also why it held 22 small works against 66 (F319). dig_iron is only the
  commonest action. A profile must attach to tsx's child node process, not the launcher.
- F321 (10-25, train5, #142/#139/#140) **A mixed flower bed whose flower runs out stays open for good: in C1 six beds
  needing lily of the valley (used up near minevale3 by AFTER ~39) filled the project cap of 6 to the end, 124
  collects failed and busy fell to 45% in hour 2 against 62% off.** C1 = policy options + pen variety + flower mix on,
  C0 off, blank minevale3, 25 members, 1x, 120 min after, shears and carrots stocked. With that cause set aside: #142
  works as specified (loop p50 6-14 ms past minute 65, every gate sample at a really full cap against 61% held in F317,
  gated options taken 90 of 91 in hour 1, [stuck] 140 vs 348) but its busy gain could not be judged; #139 drew a small
  3x3, a long 5x7 and an L-shaped pen (37 cells), with sheep, pigs and chickens, 54 breedings (pigs on the fixture's
  carrots) and two pen shearings. Logs: runs/2026-10-25/train5/ (report.md).
- F322 (10-25, fix-149 confirm run, #142) **With the flower mix off, policy options give F317's gain again: busy 71.7%
  in hour 2 against C0's 61.8% (same code), works 87 against 58, 192 initiatives against 99.** P1 = MC_POLICY_OPTIONS
  + MC_PEN_VARIETY on, MC_FLOWER_MIX off, gardens on, blank minevale3, 25 members, 1x, 120 min after, shears and carrots
  stocked, code 9f0f68c (before c1b6bc1). Gated options taken 160 of 170 menus; [lag] 0, loop p50 5-27 ms but six 5-min
  samples at 136-292 ms (C0 had five); [stuck] 338 (C0 348); 5% of the cap gate's samples came with fewer than 3
  projects open; $1.21 against C0's $1.00. Logs: runs/2026-10-25/fix-149/ (report.md).
- F323 (10-26, train6, #149) **c1b6bc1's small-work spot cache ends the pad village's stalls: 0 [lag] in 90 minutes
  against 429.** iron_age_g1 resumed (pads + outward on, profile train4-pad, 24 staged members with model chores, 1x, 90
  min after), code 34d2c4e: loop p50 5.6-6.6 ms in every 10-minute bin (X1 up to 137), loop max 0.24-0.43 s (X1 4.6-6.2
  s), tick p99 4.1-4.3 ms (X1 up to 4.3 s); [stuck] 56 vs 434, [stuck-world] 4 vs 177; busy 29% (X1 30%). No small works
  in either run (the resumed village has none to give), so F319's 22-vs-66 needs a blank pad run. Two members trapped
  after amethyst trips at the same geode as trains 4-5 (#133). $0.23. Logs: runs/2026-10-26/train6/ (report.md).
- F324 (10-26, train6, #140) **With c1b6bc1's fix the flower mix no longer holds the cap: lily of the valley ran out at
  AFTER ~32 as in C1, and each of the 6 mixed beds started after that dropped it on its first failed gather and was
  built with wildflowers; at most one bed open at a time, failures after 140 against 143 off (C1: 450).** F1 =
  MC_FLOWER_MIX on, F0 off, policy options and pen variety on (defaults), gardens on, blank minevale3, 25 members, 1x,
  120 min after, shears and carrots stocked. Beds 20 (9 mixed, all wildflowers + lily) against 30 plain. The menu still
  offers mixed beds with a used-up flower (one wasted collect each). F1's hour 2 was thinner (busy 62.2 vs 68,
  initiatives started 48 vs 91): members idled at the project gate with 3 open, and no gated "another project" option
  was offered in its last 30 minutes (F0: 53, taken 31), so F0 kept 5-6 open and F1 3; not from beds, not traced. F0
  repeats F322's gain with policy options on by default (68 vs 71.7 in hour 2). $1.19 vs $1.28. Logs:
  runs/2026-10-26/train6/ (report.md).
- F325 (10-26, tier2, #162) **The detail cathedral with the stonecutter and the dye bed builds in full live, and the
  monument's work splits beyond masons.** T2d (world 3, iron_age_g1, Chartres 1:4, staged, 2x, MC_MONUMENT_DETAIL +
  MC_DYE_BED with kiln, quarry, glazing, roles): 12 of 12 jobs, 18 kinds of block (M3a 11), 96 of 96 sampled cells in
  place; 1,999 pieces cut in 59 carver loads, 8 dye colours from 13 dye chores (the bed's rose bushes and lilacs copied
  with composted bone meal, lapis, mixes); trades held at the end carpenter 7, mason 6, quarryman 3, carver 1 (masons 35%
  of holders, M3a 74%); busy 54% (51%), [lag] 0, [stuck] 231 (73 one member in #133's amethyst geode; 6 near the new
  works). Three runs before it each stalled on a supply the spec missed: the polished floor's andesite and diorite (open
  stone 50-70 out, under water or in hills: collect failed 32 of 40 trips; storage held 256 of each, now claimed first),
  the dye bed's ground (none within 48 of a crowded hut; found at 64), and the yard's dyes (dyers mixed them away). The
  dye census at reach 144 with tall flowers makes 12 colours near G1 against today's 2. No member took the dyer trade
  (dye chores spread thin). Logs: runs/2026-10-26/tier2/ (report.md).
- F326 (10-27, train7) **The new defaults run together without a stall, but pads per building + grow outward
  leave the after phase no small works: with no monument the village idles from minute 60.** C (model chooser, every
  current default: pads + outward, pen variety, policy options, flower mix, bigger houses; blank minevale3, 25 members,
  1x, 150 min after, code b335ca3): [lag] 0, complete at 6.4 min, 25 houses for 25 members, pens worked; busy 74.5% in
  hour 1, 12.7% in hour 2, every idle menu "nothing feasible" with "initiate: no room (greens full)" (all 5 greens used),
  "help: no project open", "gather: nothing wanted"; food ran short in hour 2. Initiatives built 53-70 a run (26-38 of
  them lamps) against 152-195 in train 6 with pads off (F324): F319's small-works gap measured on a blank pad village.
  The storage hut's #133 trap returned on this layout in A and B (the mine tunnel at y 54 under the hut, walks aiming
  straight up at the chest; 5 teleports). Logs: runs/2026-10-27/train7/ (report.md).
- F327 (10-27, train7) **The monument starts after iron and builds 92% of a 1:3 Notre-Dame at 1x model-driven in about
  80 minutes, then stalls at stage 7 for dyes; it holds the village's other life better than no monument.** A (model,
  monument with quarry, kiln, glazing, detail, dye bed, roles, news, lodge, deep stone, geode guard, furnishing) and B
  (the same, fixed chooser): begun at the iron age (+30 both), stage 6 done at +107 / +95, 3,296 of 3,587 blocks, then
  job 13 (glass and rose) short of red, purple, orange, pink, magenta and light-blue panes to the end: dye chores failed
  83 times in A (red needs beetroot, pink a cactus flower, the dye bed no bone meal without crops to compost). Against C
  (F326): hour 2 busy 53.5 / 64.3 vs 12.7, everyone fed (C not), A reached letters at +115 (C one letters stage by
  +136). Recommend on by default once stage 7's dyes have a supply or a stand-in. Logs: runs/2026-10-27/train7/.
- F328 (10-27, train7, #164 step 0) **The model chooser changes what members do but not how much: 68% of its picks
  were not code's first option, and all talk, speech acts and promises came with it, yet the fixed chooser was busier
  and built faster at a quarter of the cost; neither made a law or custom.** A (model) against B (fixed), both with the
  monument: busy 80.3 / 53.5 vs 89 / 64.3; cathedral stage 6 at +107 vs +95; distinct choice keys 358 vs 399; acts
  650 vs 0, promises 26 vs 0, pay lines 97 vs 26, barter offers 87 vs 56; letters chosen and reached (B: diamond from
  predicted ballots, not begun); proposals 0 vs 1, laws and customs 0 in both; failed after 324 vs 415; $1.00 (1,870
  calls) vs $0.25 (331). One pair. Logs: runs/2026-10-27/train7/ (report.md).
- F329 (10-27, i133, #133) **Members trapped under the storage hut came from failed amethyst trips, and the trap is the
  walk home's search, not a tunnel anyone planned.** All six (A: Tess, Rosa, Sam; B: Rosa, Victor, Wren) had just run
  harvest_amethyst at a geode near y -22; when its climb back failed (the bot fell into a cave below its own stairs, its
  own stair stopped: "dig a way up from here before the next job") it stood ~50 blocks down, and the next walk to the
  hut (eat_meal, deposit) dug straight toward it. The pathfinder refuses any break costing 100 or more, so village ground
  (plots from 4 below their level, the hut from a block under its floor, the mine) is a wall from below; the search
  under the village then explores the whole rock volume, runs out of time, and its best partial path ends under the
  floor (y 54-58, the train's spot; the y 54-55 maze is those walks and rescue walk-outs). Rescue made it worse: a
  timed-out search home counted as out, so each 10-block walk along the rock was a success (3 rescues before its
  teleport). Reproduced offline by scripts/checks/under_hut.mts (6 searches end at y 58 under the hut; climbing to open
  ground off the plot first takes 2.2 s of search, then 3 ms to the hut). Fix: walks up to village ground from 6+
  blocks under cover go out first (by the mine's stairs without digging, else to open ground standing back from village
  ground by the climb), rescue does the same and counts a timeout under ground as in, and a backstop teleports a member
  under ground 8 min with nothing done and hands back its tasks. Not yet run live.
- F330 (10-27, i164 spec, corrects F328) **Train 7 did make laws: F328's "0 laws, 1 proposal" was a measuring error**
  (train7/measures.py grepped the log for `[rule`/`[law`/`[proposal`, which are never written; laws live in the acts
  ledger). `scripts/checks/rules_use.py` on the ledgers: laws proposed A 39, B 21, C 27; rules enacted A 3, B 5, C 4
  (levy included). A and B passed only free-text norms (iron-dig notices on a board that does not exist) and a 10%
  levy; C passed typed rules (1 item a day 84% kept, 1 tool a day 4%, lighting duty 14%). B's laws were model laws too:
  reflections and ballots call the model under MC_CHOOSE=fixed. The gap is consequence, not production: 85-92% of
  backs refused by the "day touched it" gate, norms voted yes 94-98% with no stake line, and nothing counts or shows a
  norm's result. Customs (G4) are unbuilt. Spec: runs/2026-10-27/i164/spec.md.
- F331 (10-28, dyes_greens, #162/G8 and G1) **The monument completes from train 7's stall, and bigger greens keep small
  works going on a pad village.** Train 7 A's stage-7 stall was 2 purple dye: its dyers raced (two made 4 orange for 2
  and used the red) and the composter had nothing to take (seeds kept for sowing). With 7c7f668 (the composter takes
  flowers past 32 and saplings past 8; one dyer a colour; a colour stands in as plain glass after 4 failed chores or 30
  min) live D1 from t7_a_mon_stage7 (world 5, 1x, model chooser) made the purple at once and built stages 7 and 8: dye
  failures 0, no colour stood in. The furnishing then stalled on iron (the iron level finished: no ingots for lanterns,
  chains or the shears banners need); with a furnishing kind left out after 4 failed chores (the bell kept) D3 finished
  the cathedral, 16 of 16 jobs, 3,524 blocks, lanterns and banners left out. MC_GREENS_MORE (21x21 greens, up to 3x the
  members' greens on a pad village, off) in D1: 8 new greens, "no room (greens full)" 0 against train 7's 566 (A) and
  389 (C), 93 initiatives built in 85 min (39 plot-sized), busy 24-41% in every 10 minutes against A's 13-22% in its last
  30; the simulator from t7_c_greens_full gave 88 -> 177 initiatives in 2 h. [lag] 0, [stuck] 36, all fed. Open: the
  iron level runs out by the furnishing at 1x, so lanterns and banners go; runs/2026-10-27/dyes_greens/resume.md.
- F332 (10-28, dyes_greens, #162/G8; the user's 10-28 decision) **Furnishing left out for want of iron comes back once
  iron is in.** 32d28c4 records a kind left out and, when storage holds its makings (ingots; shears or 2 ingots for
  banners), brings it back as a job of its own cells after the plan's, as the copper re-roof does. Live from dg_d3_end
  (D3's finished cathedral, lanterns and banners left out) with 96 ingots, 2 shears, 16 torches and 84 wool stocked: D4
  brought the banners back but showed three faults, fixed before D5: the readiness counted storage's one nugget for
  both lanterns and chains (69e0056), make_furnishing had no planks for sticks with 395 logs stored (bb3a3a9), and a kind
  left out again came straight back, doubling its job (1fb1ef7: a 20-minute wait, its unbuilt job dropped, listed once).
  D5: lanterns (49 cells) and banners (14) back at once, made (10 lanterns, 39 chains, 14 banners) and built, 18 of 18
  jobs, 3,587 of 3,587 blocks; every re-furnish cell confirmed in the world (63 of 63). Fixed chooser (the Ollama app
  was down: D3-D5 made no model calls), [lag] 0.
- F333 (10-28, mines, G8/#168; the user's 10-28 decision) **The iron ran out because the deep level left no level
  below it.** Train 7 A and B dug a level at y 22, then the monument's deep level at y -4 (MC_DEEP_STONE, +34 min); when
  that finished (1,150 cells), the next aim, y -10, lay below IRON_FLOOR_Y, so no level followed and y 4-16 were never
  dug. Raw iron per 10 min, A: 0, 28, 40, 19, 25, 23, 2, then 0 for 90 minutes (B the same, 0 from +70); C (monument off)
  laid y 18, 12, 6 and still dug at +150. Refused trips: the stairs lock 29 (A), 67 (B), 23 (C), "three miners already"
  13 and 20. Fix (mcMine.ts): a mine with no level to follow opens a new shaft at once, from any level dug before (or the
  cobblestone mine) down to a free height (no level within 6 in y whose foot is within 48), the one nearest y 18 first,
  aimed toward the atlas' iron; a shaft has its own level and cell counts. #168: the dig option leaves the menu while
  another member holds the stairs. Staged M1 from dg_d1_end (world 4, 2x, haste 5, 25 min): the shaft opened off y 22
  on the first trip, its y 16 level was dug out (1,150 cells) and y 10 was laid; raw iron in all 137 -> 300 (90, 50, 21
  per 10 min), lanterns made again; [lag] 0, [stuck] 6. The #168 line was not in M1's snapshot (4 lock refusals there).
  Check: scripts/checks/new_shaft.mts (on D1's mine record).
- F334 (10-28, greens_mix, G1 / the village's look; the user's 10-28 decision) **The cheapest lamp won the greens because
  it was the one kind left that fitted.** D1 (MC_GREENS_MORE on): 146 small works, 77 of them plains_lamp_1 (1x1); in its
  choices the lamp was offered 57 times and on 42 menus it was the only initiative offered (works fill a green from the
  centre out, leaving gaps only a 1x1 fits). MC_GREENS_MIX (off, smallWorks.ts + small mcWorld hunks): each kind capped
  at 2 a green (the lamps together), larger works ranked above small ones, a parterre (six geometric shapes, 7 across on a
  21 green, 5 on a 15, shape differing green to green) reserved at each green's centre and 2 corner trees, the parterre
  ranked first, then the trees while a green wants them. Simulator 2 h from t7_c_greens_full (no garden spots there: the
  sim has no soil): top share on greens 41% (lamps) -> 27%, lamps 2 a green, busy 35.4 -> 34.1%. Live on world 1 from
  t7_c_greens_full (2x, fixed chooser, 0 model calls in G1/G2; G3 72 non-chooser calls): G1 30 min top share 21%, 6-7
  kinds a new green, but 1 parterre of 3 (a dropped flower redrew a knot5 as quarters7; a new green's first work took the
  centre because the green's own preparation reservation hid the reserve); G3 20 min after both fixes: every new 21
  green with its parterre (chequer7, knot7) at the centre and 2 trees, 7 kinds a green, top share 17%, [lag] 0, [stuck]
  31. Check: scripts/checks/greens_mix.mts. Renders: runs/renders/g3_green_a.png (a green read from the world),
  greens_mix_shapes.png.
- F335 (10-28, train8, G3/G4, #164's pilot) **#164's world steps did not get tested: members wrote no claim or report law,
  and two bugs ate the test.** Three 25-member runs from t7_c_greens_full, 1x, 150 min, code 6193892: R1 (model, the
  effects on), R0 (model, effects off), F1 (fixed + the scripted council). Laws (rules_use.py): R1 24, 33% typed (norm 16,
  floor 5, contribute 2, quota 1), R0 28 at 25%. **No claim or report law in 175 reflections in either model arm**, so no
  claim was posted or report made (blocked trips 105 vs 101, nearly all "no free 9x9 site" for own farms); no repeal.
  Norms got 63% yes in R1 and 68% in R0 (train 7: 94-98%), so the drop is not the words line. Cost R1 $1.47 vs R0 $1.55.
  Pass rule (predictions 1, 2, 4, 7): not met. Bugs: (a) #170, the sign board is saved as `v.board`, barter's offer
  board: once F1's scripted claim and report passed (day 2), every menu threw `b.offers is not iterable` and F1 sat at 0%
  busy from +42 min; (b) #171, on t7_c's full 15-greens the custom stone has no free ground, and the option stays on the
  menu after failing: custom:green_stone was 65% of R1's 6,444 choices (2,973 as the only option) and 3,385 of its 4,919
  failures. The seeded door_flower was offered 52 times and never done, so custom uptake (prediction 7) could not be
  measured. Busy in R1 and R0 (84/64 and 86/72 by hour) counts those failing chores. The greens (first model-driven run of
  MC_GREENS_MORE + MC_GREENS_MIX): 111 works in R1 and R0 (train 7 C 70), top kind 20%, a parterre and 2-3 trees on each
  new 21-green, 6-9 kinds a green, "greens full" 0. The default monument from t7_c reached stage 9, 3,523 of 3,587 blocks,
  in both model arms. [lag] 0 everywhere. Report: runs/2026-10-28/train8/report.md.
- F336 (10-28, train9, G2, #172) **Test train 9 (the menu M against the open palette O) was stopped at +12 min**, the
  user's decision: O's invalid replies are to be fixed and a world primer built first, then the comparison reruns. Code
  10f5640, t7_c_greens_full, 25 members, 1x, R1's #164 rule flags, greens on, customs off; worlds 4 (M) and 5 (O). In 12
  minutes: **O had 52 invalid replies in 343 choose calls (15%; M 0 in 225)**: an act name in `choice` 39 ("request" 31,
  "accept ..." 6, "offer" 1; the acts line is in both prompts, so the long grouped palette pulls the model to it), a
  project label or reworded name 7 ("young tree (Uma, help:i76)"), invented 4, none 2; each fell back to the fixed pick
  (65 of O's 340 choices). Re-asks 18% of O's asks (M 10%). O's palette: median 31 options (0-66). 21% of O's picks were
  makes past the keep (stone pickaxe 11, then signs, stairs, doors, ladders; M 0) and 44% of its model picks fell outside
  the menu view. O's needs block named bread, cooked cod and salmon in ~all calls and charcoal in 206, but the palette had
  no make for them (charcoal in 28): their inputs (wheat, the fishing catch) are a step away and the block does not name
  the step. Busy 0-10 min 72% / 76%, failed ends 12% / 8% (both mostly own farms' "no free 9x9 site"), initiatives 8 / 4,
  [lag] 0; no night, so no laws. Cost $0.11 / $0.24 (O's choose call 1.5x M's). Report:
  runs/2026-10-28/train9/report.md.
- F337 (10-28, train9b, G2, #172, #170) **Test train 9b (the menu M against the open palette O, with #172 round 2,
  the tool want and MC_PRIMER on in both) broke on #170 in both arms**: once the first claim law passed (M day 2, +37
  min; O day 3, +57 min) every menu threw `b.offers is not iterable` (the sign board's cells saved as `v.board`, barter's
  field) and no chore was chosen for the rest of the 150 min, so only 37 minutes compare. Code 5972dfa, t7_c_greens_full,
  25 members, 1x, R1's #164 rule flags, greens on, customs off; worlds 4 (M) and 5 (O). To +37 min (M / O): **O's invalid
  replies 2.8% of its choices over 57 min (train 9 15%), inside the 3% target**, through the re-ask: 227 first replies
  were invalid (220 an act in `choice`), 196 came back valid; the 31 left are mostly plural or reworded makes ("Make
  wooden axes"); M 1.5% with no re-ask. Taken-meanwhile re-asks 12.6% / 19.1%. Makes past the keep 0 / 18.5% of picks
  (stone pickaxe 17, ladder 12, slabs, signs), gathers nothing wants 8 / 58 (cobblestone; 22 of O's deposits refused at
  the cap; O ended with 670 cobblestone, 143 stone bricks, 90 torches). O's model picks outside the menu view 27%,
  palette median 18. The own tools work: own-tool picks 54 / 37, 48 / 35 ended ok, collisions 7 / 15 drops and 6 / 2 failed
  takes, members still wanting a tool after 30 min 1 / 11, and a make-for-oneself (Sam, M) put a stone pickaxe in the
  member's chest (RCON); O still made 20 stone pickaxes past the keep. The "Not on your list now" line (taken by whom,
  why a kind is absent) was in 1,410 O prompts; the needs block still names bread and fish the palette cannot make.
  Predictions: law refusals 387 / 0 (all one floor law hiding the mine's torches; held), distinct ids 1.05x (not met),
  past-keep + unwanted 25% (met), JS 0.240 / 0.218 (met), works 18 / 26 initiatives and 899 / 1,304 monument blocks (not
  met), failures 10.0 / 8.9% (met), cost a call 1.54x (met). Busy 73-93% before the break in both, [lag] 0, [stuck] 19 /
  43; $0.45 / $1.17. A rerun needs #170 fixed. Report: runs/2026-10-28/train9b/report.md.
- F338 (10-28, train9c, G2, #172, #170) **Test train 9c (the menu M against the open palette O on d663508: #170
  fixed, open overstock offered only when asked, needs with a first step; MC_PRIMER on) ran to +113 min, stopped by
  hand** (the user's, for the evening). **#170 holds**: laws passed on days 2-5 in both (claims rl3 / rl4 on day 2), 0
  `offers is not iterable`, members chose to the end. Over 113 min (M / O): **O's makes past the keep 0 (9b 18.5%)
  and gathers nothing wants 36 (9b 58 in 37 min)**; O's palette shrank to a median of 4 options (9b 18), 317 drops
  found nothing to choose, picks outside the menu view 9% (9b 27%). Invalid replies 1.7% / **0.6%** (the re-ask fixed 117
  of 126; what is left is "Make wooden axes"). Chore busy alike (74-78% / 69-90% in the first hour), failures 7.6 / 7.5%,
  initiatives built 85 / 93, both monuments finished (3,587 blocks), JS 0.160 / 0.150, distinct ids 478 / 494, cost a
  choose call 1.11x; refusals by a rule 0 / 0. The needs block named a first step 6,752 times but 93% were not on the
  member's list (harvest wheat: nothing ripe; go fishing: no rod in storage; get lilac, leather); of the 279 calls with
  one on the list, the member took it in 65 (23%). Own tools: 40 / 47 takes ok, 7 / 2 failed on an empty spare, members
  still wanting a tool after +60 3 / 0. Predictions 3-6 met, 1 and 2 not (O no longer diversifies or overmakes: it
  behaves like the menu at a tenth more cost). [lag] 0, [stuck] 92 / 102; $1.09 / $1.75. Report:
  runs/2026-10-28/train9c/report.md.
- F339 (10-29, train10, G2, #174, supply) **Test train 10 (the supply flags S against C, members' own house designs in
  both) ran to the end on t3_p1b** (the pad village, the user's call: mv3_base25 is not on pads, so its first launch was
  set aside). Code 7dd87fb, 25 members, 1x, 120 min after, 9c's settings, `MC_HOME_DESIGN=model` holdout 0.5,
  `MC_MEMORY=on`; growth placed houses outward on pads, 2 -> 25 in 6 neighbourhoods in both. **MC_FIELD_RIPE=0.5 works**:
  16 / 6 wheat harvests, wheat 60 / 36 an hour, bread made 33 / 16 (eaten as it came, stock 0-6). **MC_FLOWER_WANTS
  works small**: 2 lilac trips, magenta dye 4 / 0. **MC_OWN_ROD did almost nothing here**: t3_p1b's storage held 3 rods, so
  lib:fish took those (27 / 28 picks, own_tool_out 1 / 0, the own-rod form in 0 prompts); it needs a village with no rod
  in storage. Own farms still fail on "no free 9x9 site" (15 of 26 / 16 of 23). **House design**: the same 12 designers
  in both arms, 24 of 24 replies valid, 1 cut to fit, 0 failed builds, no layout waited; models chose two storeys 83%
  (draw 23%), two storeys and all three extras 42% (prediction 2's < 25% not met), 20 of 24 asked for the larger house;
  blocks +34% (380 / 284; prediction 10 said 10-25%), build minutes +8% median; reasons give roles and values, none
  names a neighbour (6 not met); the same member's shape agreed across arms in 6 of 12. Memory 5 / 5 of 12 (prediction 11
  met at the threshold), nearly all in journal notes (Milo: "Consider expanding my house to a two-storey layout"), one
  talk line, no choice reasons; 7 dropped the note as personal. Busy 60 / 60%, falling to 40-65% after +40 min with ~420
  "nothing feasible" lines an arm (t3_p1b's mine spent, cobblestone short, no wool for beds; #8); initiatives 83 / 76;
  failed 104 / 109; quota law refusals 95 / 0; [lag] 0, [stuck] 87 / 61; $0.77 / $0.84. Report:
  runs/2026-10-29/train10/report.md.
- F340 (10-29, train11, G2, #175, #174, supply) **Test train 11 (house programs P against model picks M, the supply flags
  on in both) ran to the end on t3_p1b.** Code 689f4b5, 25 members, 1x, 120 min after, train 10's settings, holdout 0.5;
  P's programs on qwen3.8 locally. **Programs work mechanically**: 12 of 12 ran, 0 fallbacks, 0 worker kills, 0 failed
  builds, 2.5-8.7 s each, and four houses read back from the world match their designs. **But they went small and
  alike**: all 12 one-storey with a hip roof, 90-141 units, 175 blocks a house (model picks 349, character 279), and 6 of
  12 the same "7x7 one-storey house with a porch and shutters" on four different streets: the village converges on one
  cheap house, not street copying. The stake line is the likely cause (the integration's staged run, without it, built
  mostly two-storey 7x7s); Hugo's note cites it. Model picks: two storeys in 8 of 11, 9 distinct forms of 11. Houses 2 ->
  25 by +41 (P) / +45 min (M); build minutes about equal (1.1 / 1.2 median). House notes kept to the end 12 of 12 / 11 of
  11; later mentions are rare (Clara's own note, Nora's "two-storey house entrance"). **The own rod still untested**:
  storage starts with no rod, but members buy the merchant's 2 rods into storage by +4 min, so own_tool_out ran 1 / 1
  times; a real test needs the merchant's rods kept out (MC_MERCHANT off or a fixture). Wheat 32 / 30 an hour (train 10's
  S 60; fewer fields, own farms failing on "no free 9x9 site"); magenta dye 4 / 4. M's fishing spot went dead after +80
  min (7 of 9 trips "nothing bit", #176). Busy 63 / 59%; P's extra failures are beds without shears (spent mine, #8);
  cloud 502s and 429s 208 / 166 handed back; [lag] 0, [stuck] 173 / 157; $0.84 / $0.75. Report:
  runs/2026-10-29/train11/report.md.
- F340 correction (10-30, smallfixes, `runs/2026-10-30/smallfixes/report.md`): train 11's wheat did not halve. Its 30-32 an
  hour came from supply.py's net storage yield; train 10's 60 from the FOOD line. On the FOOD line train 11 made 127 (P)
  and 175 (M) against train 10 S's 121. Take wheat from the FOOD line in future reports. #176 fixed in 2d44093.
- F341 (10-30, train12, G2, #175, #177, #178) **Test train 12 (the new house-program prompt P against model picks M, the
  merchant off, MC_MORE_MINES on) from t12_pad_open: the prompt works live; M's arm and the own rod were lost to two
  bugs.** t12_pad_open is t3_p1b rebuilt at 2d8d9bd (open-sided hut; mine stairs to y57, mine.py PASS); a first start from
  t3_p1b was stopped at +5 min. P's programs: two storeys 5 of 12 (train 11: 0), 7 distinct forms of 12 (commonest 3,
  train 11: 6), mean 242 blocks (175; character 289), build 1.2 min median, 4 cut to fit, 0 fallbacks or failed builds,
  2.9-6.5 s; all still 7x7 planks (variety in storeys, roof, wing, porch); forms partly track the notes (Clara's
  "sturdy two-storey" -> two storeys, Iris's "modest workshop-home" -> one); 24 houses by +47 min. **M's growth stalled
  at 7 houses (#177)**: reset_site.py keeps the world's nextId (world 5: 16013 against the checkpoint's t16234), so layout
  3's tasks took used ids, layOutOutward's id-set difference dropped them and growth.active.from (16203) hid its pads
  from members for 110 min; idle members took the monument (338 picks against 111). **No fishing at all (#178)**: with
  the merchant off there is no rod or string anywhere, lib:fish offered 0 times, so the own rod is untested a third
  time and food was bread alone (wheat 115 / 155, cod 0; hungry 48 / 33% of member-time, 0% in train 11); P was 23 of 25
  hungry by +55 and busy by 10 min fell from 60-95% to 11-38% in the second hour, which hides the working mine's effect
  (41 / 66 trips, 990 / 1,299 cobblestone; MC_MORE_MINES never triggered, as expected). Laws 30 (67% typed) / 27 (26%);
  [lag] 0, [stuck] 34 / 50; $0.84 / $0.89. Report: runs/2026-10-30/train12/report.md.
- F342 (10-30, train13, G2, G5, G7, G8, #179, #180) **Test train 13 (everything new together: talk, diamond rung, wants pilot,
  more mines, supply flags, merchant back on; P program houses, M model picks) from t12_pad_open at de617fb: food and busy
  are back; the wants pull choices but do not raise persistence; the diamond rung deadlocked.** With the merchant's rods
  fishing returned: hungry 0% / 0% of member-time (train 12: 48 / 33%), cooked cod 139 / 83 and salmon 46 / 23 made,
  every [fish] trip reached 8 fish (#176 held); busy 85 / 81%, second hour 65-89% (train 12: 11-38%); 2,205 / 2,173
  choices, $1.39 / $1.26. Own rod: a fixture gave each of 24 new homes' chests a rod (own_tool_back), but its storage clear
  matched no rod (nested item data) so storage kept 1-3 merchant rods; own rods still went out 5 / 9 times. **Wants pilot**
  (holdout 0.5, same split both worlds): the step is taken at 2.9 / 3.5x its shown share, +34 / +47 points over shuffled
  pursuits (prediction 1 holds; shadow pursuits also lift 1.4 / 2.0x, as they follow the life goal); family-grain
  persistence on 5/11, 4/14 against off 11/19, 10/17 (the other way, pilot n); hour-2 chore busy on 7-14 points below off
  (outlet rest picks); pursuits mostly stall (16 / 18 of 27), so 9.4's prediction 2 fails; tokens per member-hour on
  94-100k against off 100-111k. Outlets 105 / 126 calls (ask 68 / 79, rest 27 / 29, propose 10 / 18); 34 / 42 proposals,
  mostly duplicates or "iron ingot: nobody here can make it yet". 11 titles a run; 8 far-ring trips a run, all home.
  **Diamond (#180):** MC_LADDER_START=diamond on a village with no iron pickaxes stays at stage 0: no iron level is dug
  while diamond is current, the deep level needs an iron pickaxe, raw iron came only from tunnels (4 / 2 smelted); the
  menu line claims "every deep miner has a diamond pickaxe". Stages 1-4 and the forge are untested. **Talk:** temple and
  library built in 3.6 / 4.4 min against 5-min ETAs; nether portal, a grain silo and vague asks refused; members refused
  bread (not on their menu); a house request ignores its place and the Mayor invents where it is (#179). **Houses:**
  programs 9 of 12 two-storey (train 12: 5), 11 forms, 274 blocks; model picks 7 of 12, 338 blocks, 8 forms (commonest
  4, "L-shaped two-storey"). Mine 1,505 / 1,153 cells, MC_MORE_MINES never triggered; M's torch floor rule refused 102
  chores; [lag] 0, [stuck] 117 / 151. Report: runs/2026-10-30/train13/report.md.
- F343 (10-30, train13 side bench, G7) **Vision models can judge clear building shapes from renders; glm-5.3-flash judges
  best, gemma4 is near free, qwen3.8 is no gate.** 21 untitled two-view renders (7 hand-made shapes, 13 real designs, a
  program house), three blind calls each (what is it; reads as its label; reads as a decoy). Both checks right: glm-5.3-flash
  13/21 (made shapes 6/7, thinking must stay on or it writes prose), gemma4:cloud 9 (5/7, 1 false yes, 0.6 s, $0.07 a
  thousand checks), mistral-large-4 9, kimi-k3 9 (25-30x gemma's cost), qwen3.8 6 (3/7, 5 false yeses). No model saw a
  7-wide block silo (it reads as a tower); vanilla shop houses read as "a house" to all (their use is inside), so a critic
  needs code's facts with the picture. Report: runs/2026-10-30/rendbench/report.md.
- F344 (10-30, train14, survival, G7, G8) **Damage costs little (0.04 deaths per member-hour, work within 10% of
  peaceful); both deaths were members trapped in a water pit dug for sand. #180 is fixed live, #179 mostly.** Test train
  14: D (`MC_WORLD_MODE=damage`, world 4) against C (peaceful, world 5), t12_pad_open, 25 members, 1x, 120 min,
  `MC_LADDER_START=diamond`, wants holdout 0.5, house design at its default, code 3daeb87.
  **Survival:**
  - 2 deaths, both drowning: Xavier and Uma, trapped together in one sand pit in the lake shallows NW of the village.
    The air reflex swam them up every 10-20 s for ~5 min without getting them out, and the stuck rescue, which saved
    Quinn and Clara from the same shallows, never fired (#181).
  - 99 `[hazard]` lines, all air; 0 fire or lava; 25 spawnpoints at the storage hut.
  - The death-loop guard and the walk home were not exercised.
  - A death reaches no choosing member's prompt (0 mentions), so it added no model calls.
  - Busy 86 / 88%, houses 25 / 25, initiatives 104 / 92.
  **Diamond (C):**
  - iron from +0.2 min; the third iron pickaxe at +40.9 (15 forged);
  - deep landings at y 20, -14 and -31 by +48;
  - 30 diamonds, 10 diamond pickaxes; DEEPCHECK OK (deepest -31, 0 failures).
  - Stage 0 was never marked reached: it wants y -56.
  **Diamond (D):** the first iron trip found no stairs start (a cobblestone tunnel had just turned on that cell).
  `layIronStart` closed the level with no retry time, so no iron was dug for 2 hours (#182; a race, not damage).
  **Talk:**
  - the house place was carried ("as near here as there is room, NW ~40"); the street was done in 8.5 / 10 min, its
    houses 30-65 blocks from the place asked;
  - Ada promised and made torches in D, and refused in C (not on her menu); the nether portal was refused in both.
  - In D, every house status question got the later torch request's fact (`facts.at(-1)`). In C the Mayor said "right
    where you asked for it" in front of code's "~30-65 blocks" (#183).
  **Wants (second pair, 4 runs now):** step lift 3.2 / 3.5x (+34 / +46 points over shuffled); persistence no better;
  hour-2 chore busy 6-17 points lower for on-members; most pursuits stall.
  **Food:** 0% hungry, fish 201 / 203, own-rod uses 6 / 17 with storage cleared of rods.
  **The rest:** [lag] 0 / 0, [stuck] 190 / 105; $1.28 / $1.34.
  Report: runs/2026-10-30/train14/report.md.
- F345 (10-31, wants, G2) **Pursuits stalled by a clock artefact, and the wants' busy cost was the outlet's rest; the
  tuning (MC_WANTS_TUNE, f90833b) removes both, but a work-limited village gains no total busy.** From trains 13-14's
  four pilot runs (`runs/2026-10-31/wants/causes.txt`):
  - **The stall clock:** 40 of 68 on-members' stalls (74 of 95 shadow) ended about one village day after a night
    choice. "Stalled" compared day numbers, and a night choice crosses two of them in a day.
  - **Other causes:** 37 stalls had steps that never moved the measure (wealth's own emeralds: 16). 24 had no step on any
    menu (research and wealth offered without their options). Failed steps: 1.
  - **Busy:** every outlet, asks included, ended in 2 minutes at the green. Hour-2 rest was 14-20 minutes a member
    against off-members' 6, more than the busy gap.
  - **The tuning:**
    - stalls by time, with done steps counting;
    - research and wealth candidates only with their option seen;
    - no-path and 3-failure drops, re-planned the next night;
    - rest only when chosen, 1 minute.
  - **Simulator** (new `--stub-models`, 3 seeds a side):
    - on-members' hour-2 busy 36-38% -> 42-46%, rest 20 -> 5 minutes, no stalls inside 25 minutes (12-15 before);
    - the 24 workers' total is unchanged (48-49% against 48-51%): off-members lose what on-members gain.
  - **Staged pair on world 5 (2x):** stall life 12-14 -> 21-22 wall minutes (1.2 -> 2+ village days), stalls 25 -> 7,
    9 no-path drops.
  - The 9.3 primary and persistence need the next model-driven train. Report: runs/2026-10-31/wants/report.md.
- F346 (10-31, goals, G2) **A typed village goal ("get rich") moved what members aimed at and said, not what they
  had.** G (typed: the Mayor's text and 24 mapped takes, 23 to wealth) against N (drawn); `t12_pad_open`, 25 members,
  1x, 90 min after; first look at the goal levers live:
  - The goal reached every prompt: the choice goal line, the identity line, and the planner's recall as a kept line
    (offline check, 25 of 25).
  - **Aim:** wealth pursuits 40 of 50 against 7 of 54; reasons naming the goal 10% against 5%; own choices +25%,
    public works -23% (66 against 86), helps -13%. Merchant sales 6 against 3, though wealth's `serves()` does not tag
    them: the words did that.
  - **Trade tried, no sellers:** 30 offers of emeralds for cooked cod, 29 lapsed (N: 0). The lapses drove the emerald's
    barter factor to 0.25.
  - **Holdings:** 55 against 50 emeralds, the same goods. The wealth measure priced the emerald by that factor, so G's
    goal lines read poorer (chests worth 368 against 901; 1028 with the fix, #185).
  - No law named wealth in either arm. Busy 89 / 90%, $1.15 / $1.11.
  - Bugs, fixed: #184 (an iron tool asked for by name was refused), #185, #186 (unmatched goal words never reached
    proposals; not yet seen live). Report: runs/2026-10-31/goals/report.md.
- F347 (10-31, train15, G8/G2/G7) **Train 15: the civic tier's first building handed the cathedral a kiln too small
  for it; the wants tuning ended stalls but weakened the step's pull.** N (MC_CIVIC, MC_WANTS_TUNE, MC_STRING on)
  against O (off); `t12_pad_open`, 25 members, 1x, 120 min after, peaceful, code 3cdca2c:
  - **Civic:** the Mayor picked the smallest of 6 (Pembridge Market Hall, 166 blocks), built in 4 min. Its 4-furnace
    kiln passed to the 3,587-block cathedral (O's own kiln: 15). Every tend from +23.6 failed `destination full` (63),
    and the cathedral stayed at 1 of 16 jobs to the end; O's was finished at +114 (#190). N's busy 83% against 90%,
    61-65% in the last 20 min. Houses and initiatives did not slow (25 / 25, 109 / 101). With MC_CIVIC_FIRST=1 a
    village gets one civic building before the monument.
  - **Wants tuning:** on-members' stalls 19 -> 3 with 6 dropped and re-planned, green rest 162 -> 21 member-min. The
    hour-2 busy gap was absent in both arms (59/60, 63/64), so the busy effect is not shown. The 9.3 primary was the
    weakest yet: take share 41% (1.7x) on against 48% off, and family persistence 2/15. One pair: judge it again.
  - **String:** 4 model-chosen trips (2 brought 6 string; 2 found no cobweb), 3 rods made; the own-rod fixture made the
    chain unnecessary.
  - **Fixes:** #183's request matching held (house answers carried the house's fact with a torch promise open), but
    "right where you asked" survived on a street 10-95 blocks off (#192). #182's retry worked, but the first give-up
    waited 30 min in both arms although 8 starts were clear (#191). #181 had nothing to show in peaceful.
  - $1.39 + $1.46, [lag] 0 / 0. Report: runs/2026-10-31/train15/report.md.
- F348 (10-31, looplag, Support) **The 25-bot loop p99 of 176 ms was mostly the meter; the real stalls were path
  searches fed by physics catch-up.** `scale_probe25.py` at 25 on world 3, 1x, 13 runs:
  - `/api/perf` took the current minute's p99 from a few samples after each reset. A 10 ms timer in the process
    (`cdp_stalls.cjs`) measured the old code at p99 32.5-44.9 ms (p99.9 51-102, max 84-167). Fixed (1,000 samples).
  - After a stall, physics' up to 4 catch-up ticks per bot each called the A* search (15 ms) again; 3 searches are
    never cut, so ~180 ms in one callback made the next stall: 85% of stalls over 100 ms was search, and without a cap
    46 stalls over 200 ms came in 4 minutes. Now two slices a turn (three at 2x), one after a stall (the pathfinder patch).
  - CPU cut: protodef's PartialReadError per TCP chunk (10% of busy), minecraft-data per physics tick (2%), find_site's
    column lookups per cell (6%), closures per call in the pathfinder hooks.
  - Final: true p99 27.9-36.3 ms, p99.9 45-47, max 57-77, no stall over 100 ms in 4 runs (one hostile at night: 31.5 /
    63, mobs cost nothing visible). The search load varies 4-5x between runs; the final runs were light (12-21 s of A*
    in 4 min). The probe's max of 230-280 ms is from outside the window (spawns or the start of work), not measured.
    Report: runs/2026-10-31/looplag/report.md.
- F349 (11-01, train16, G8/G2/G7) **Train 16: with #190 fixed, the civic building and the cathedral both finish; over two
  pairs the wants tuning ends stalls and does not weaken the step's pull.** P (MC_CIVIC, MC_WANTS_TUNE, MC_STRING on)
  against Q (off); train 15's setup, code 2e608ed:
  - **Civic and the kiln:** the Mayor picked Pembridge Market Hall again (4.5 min). Its kiln of 4 was left behind, the
    cathedral built its own 15 at +19.7, and all 143 tends succeeded (0 failed). The cathedral was finished at +106.5,
    against Q's +112.0 and train 15 N's 1 of 16. Busy 87 / 87%. One civic building a run, the same one twice.
  - **Wants, two pairs (trains 15-16):** on-members' stalls 3 and 2 tuned, against 19 and 17 untuned. The primary was
    60% (3.2x) tuned this time, against 41% (1.7x) in train 15, so that low did not repeat. Untuned it was 58% (2.8x).
    Family persistence was 7/12 (2/15 before). Hour-2 busy, on minus off: tuned -1 / +2 points, untuned -1 / -5.
  - **#191 live:** the first iron start was retried at +5.9 (train 15: +30.6). Deep landings came at +43 / +29 (+59 /
    +61 before).
  - **#192 held** on Q's talk lines. In P the user's own line made the fixture skip its house request, and the Mayor then
    answered house questions with an invented house ("all set and ready for you to move in"): #198.
  - [lag] 0 / 0, [stuck] 158 / 120, loop p99 median 68 / 61 ms; $1.52 + $1.34, and $1.23 more for a first try stopped
    at +50. Report: runs/2026-11-01/train16/report.md.
- F350 (11-02, train17, G8/G7) **Train 17: the drawn civic shortlist can pick a building the village cannot supply.
  R drew the Zytglogge (sandstone) on a plains site, stalled it at 1 of 6 jobs, and the cathedral never began (#202).**
  R (MC_PICK_RANDOM, MC_CIVIC_VARIETY, MC_TALK_DESIGNS, MC_STORAGE_KEEP, MC_MONUMENT_STOCK on) against S (off). Train
  16's P setup with MC_OWN and MC_DRESSING on in both; code f1b07da:
  - **Picks:** R's seed was a487653b, its pick the Zytglogge (the first civic pick other than Pembridge Market Hall in
    three trains). S picked Pembridge again.
  - **The Zytglogge stalled:** stage 2 wants ~108 sandstone pieces. Sandstone is gathered as it is, the monument's
    gather options cover only logs, sand, cobblestone and stone, and there is none near home ("411 wanted, found 0").
    It stayed at 36 of 610 blocks from ~+3 to the end.
  - **R's cost:** no cathedral; busy 80% against 85%; chore busy at 10-20 min 40% against 85%. A talk windmill
    (MC_TALK_DESIGNS took Pitstone Windmill, which S refused) was queued 90 min behind it.
  - **S:** the cathedral was finished at +97.1 (train 16 P: +106.5), so the wall dressing costs no pace. House layouts
    took a median of 5.4 min (6.2).
  - **Storage keep:** no spoil in R, against 4,696 blocks spoiled in S. Not a clean pair: R mined less without the
    cathedral.
  - **Loop:** p99 median 65.6 / 64.8 ms (train 16: 61-68), still over the 50 ms mark; the larger storage did not move it.
    R had one 2.6 s `[lag]` as the talk house request came in. [stuck] 175 / 171.
  - $1.17 + $1.31. MC_MONUMENT_STOCK not judged. Report: runs/2026-11-02/train17/report.md.
- F351 (11-03, train18, G8/G1) **Train 18: the sand chain ran end to end in one arm. I1 finished the Zytglogge in 64
  min and began the cathedral. In I0 it stalled 32 sand short, because the yard's sand count is not storage's (#208).
  Instincts made no measurable difference in 2 hours and learned two wrong lessons from one walk stall (#210).**
  I1 (MC_INSTINCTS and MC_INSTINCT_SHARE on) against I0 (off). Train 17's R setup with #199, #202, #204, #206 and #205
  at their defaults, and `MCAI_SAND_ACROSS=allow` in both; code 4446b83. Both were pinned to the Zytglogge:
  `MC_PICK_SEED=0180003b` draws it first, and `MC_CIVIC_CHOOSE=code` takes it.
  - **Sand trips:** 8 / 7 trips, 820 / 931 sand, about 24-25 sand a minute while trips ran. Up to 3 were out at once,
    145-299 blocks out, median 9 min a trip; 0 lost.
  - **I1:** the stone-brick stand-in fired at +48.8 ("no sand to be had near home") while sand was still arriving, and
    475 sand stayed unused. The tower was finished at +63.8, then the talk windmill (+83.7), then Notre-Dame 1:3 from
    +83.7: 5 of 16 jobs, 998 of 3,587 blocks by +120.
  - **I0:** job 2 needs 488 sand, and storage held 456 of the yard's 504. No trip was offered after +51.5, and the job
    failed 6 times to the end. The tower stayed at 316 of 610, and the cathedral never began (#208).
  - **Instincts:** 4 learned. 36 borrows (23 at the storage, 13 side by side; the dusk channel was off with
    MC_CUSTOMS). One sapling rule reached all 25 in minutes, and 24 copies faded after 2 days.
    - Only 3 options carried an instinct weight all run, all in code-made picks. No "[your instinct: avoid]" tag reached
      the model.
    - Two wrong lessons came from Xavier's stall: avoid the storage hut, and avoid eating (#210). They did no harm, by
      chance.
    - Busy 83 / 81%, failures 221 / 212, houses 26 / 25: noise.
  - **Stalls:** I1's 216 `[stuck]` / 225 `[repath]` (I0 82 / 4) are one member. Rescues teleported Xavier back to the
    hut cell he was stuck in, 49 times (#209).
    - Water: `[swim]` 35 / 14, no pinned teleport (#204 holds).
    - Kiln: 72 / 11 tends, 1 failure from the walk loop (#199 holds).
  - **Survival slot** (hostile, walls now, scripted, 30 min): no errors from the walls, the hunt or the curfew; no death
    after dawn (#201). One night death came from an initiate whose new green was placed 100 out: the curfew's filter
    cannot see its site (#211). #203 showed as known.
  - Loop p99 median 55.9 / 53.2 ms. One `[lag]` in each arm at the talk house request (2.3 / 2.5 s). $1.35 + $1.26 +
    $0.02. Report: runs/2026-11-03/train18/report.md.
- F352 (11-03, train19, G8/G1/G2) **Train 19: both arms finished the Zytglogge in sandstone after #208's recounts, with
  no stand-in (I1 +70.8, I0 +115.5); only I1 began the cathedral. Instincts changed behaviour for the first time: the
  "[your instinct: avoid]" tag reached 843 model-made choices and halved the model's pick rate of the option it tagged.
  But every lesson that mattered was about a broken custom (#213).**
  I1 (MC_INSTINCTS and MC_INSTINCT_SHARE on) against I0 (off), train 18's setup with MC_CUSTOMS and MC_CUSTOM_FACTS on
  in both, so the dusk channel ran; code e9ade01 (git-archive snapshot), worlds 4 / 5, talk18.py on time.
  - **False start:** world 4's instincts.json still held train 18's store. A checkpoint reset keeps it, and a spawn
    with reset does not clear it, so I1 began with train 18's lessons, and the wrong "avoid eating" (i39) spread to 7
    members in 3 min. The run was restarted with the file moved aside (#212).
  - **Civic:** recounts brought trips back 3 times in each arm (job 2 short 134 and 12 in I1; 370, 86 and 12 in I0).
    The yard over-counted storage by 12-140 sand each time (not traced: not the kiln, 60 / 36 sand, nor windows).
    - I1: tower +70.8, talk windmill +96.1, then Notre-Dame 1:3, 605 of 3,587 blocks by +113.
    - I0: job 2's last 12 sand waited 38 min, because Finn froze on the way back (#214), and the tower was done only at
      +115.5. Its trips were spread out: 981 sand from +13.4 to +109.2, against I1's 875 from +24.2 to +67.1.
  - **Stalls:** #209's loop is gone (I1 0 rescues, `[repath]` 3). A new freeze in I0: Finn's pathfinder stayed
    mining/building on every tick (moved 0, path planned), and the rescue moved him 12 times between the hut cell and
    the one outside it. 14 rescues in all (#214).
  - **Customs:** the green's custom stone never finds ground, because grass_block is not in #minecraft:dirt on 26.1.
    It failed 1,082 / 1,800 times, most picks a menu's only option (79 agent-min in each arm). The dusk tools custom is
    offered to members carrying only their own tools (72 / 52 failures), and the door flower fails on grass (#213). The
    dusk gathering worked: 12 / 10 non-seeded members.
  - **Instincts:** 24 learned, 86 borrows (storage 52, side by side 27, dusk 7), 64 fades.
    - Right lessons: avoid the custom stone (12 members in 3 min), the tools custom (7, borrowed by 13 more) and the
      door flower (2).
    - Two E2 walk lessons, far from home and plausible, and one doubtful lesson from a shortage (a flower garden).
    - None near home or the hut (#210 holds).
    - **The tag:** the model took the tagged stone in 96 of 813 shown (11.8%), against 25.4% (230 of 906) untagged in
      I0. Stone picks by the model fell 87 against 222, and all stone attempts 1,179 against 1,888. The tools tag did
      not hold (24 of 26).
  - Busy 84 / 81%, houses 26 / 25, initiatives built 90 / 77: noise. Failures 1,573 / 2,197, about 490 / 400 without
    the stone.
  - **Verdict:** the mechanism works end to end (learn, tag, the model mostly obeys, share, fade), but its effect is
    bounded by what fails often enough to teach. Here that was a code bug. Judging it on a working village needs
    longer runs or harder ground.
  - Loop p99 median 69.5 / 60.6 ms. One `[lag]` each at the talk house request (2.9 / 2.1 s). $1.47 + $1.43.
    Report: runs/2026-11-03/train19/report.md.
- F353 (11-04, train20, G1/G3) **Train 20: on harder ground (hostile, the wall on) the instincts learned 24 lessons, 1
  right, and none from 8 deaths.** I1 (instincts on, world 4) against I0 (off, world 5), train 19's setup with
  MC_WORLD_MODE=hostile and MC_WALLS on, code 22cc7b0. I0's agent server died at ~+72 of heap (Ada's hunt left a spider
  for a creeper 6.2M times with no pause, #218), so the arms are compared over the first 69 min.
  - **Lessons:** 23 of I1's 24 came from transient failures. 20 members learned "avoid gather 256 sand for the clock
    tower" from #211's night band ("no sand inside the band now ... collect it again by day"); 2 learned "avoid hunt"
    from low health; 1 learned to avoid flowers at night. 1 is right (keep_custom's green stone). The tagged option was
    picked 7 of 280 times (2.5% against ~21% untagged): the tags steer, here wrongly. #220.
  - **Deaths:** 0 / 1 to +69; I1 8 after +71: 4 at one amethyst shaft (3 falls, a zombie; harvest_amethyst's open drop,
    #219), 4 on night trips 99-176 out once beds lifted the band (2 creepers, drowned, zombie). The finder reads no
    deaths, so no danger lesson formed.
  - **The wall:** voted by model at the danger trigger once growth was done (+54 / +51) and refused 9-16 in both; I1
    refused 4 more times after deaths (5-8 for). 0 cells; a37a58c's rank never came into play.
  - To +69: failures 10% / 9%, repeats 11 / 10, chore minutes 63% / 60%, houses 25 / 25, yard sand 105 / 30. I1 whole:
    Zytglogge finished +110.4, busy 81%, $1.425; an 11.8 s event-loop stall at +15.9.
  - **Verdict:** the planning prediction (danger lessons, mostly right, fewer deaths) is not borne out; the finder
    learns from passing states and cannot see deaths. Fix #220 before another instinct train; rerun with #218 and #219
    fixed and the wall voted by rank or MC_VOTE=off. Report: runs/2026-11-04/train20/report.md.
- F354 (11-05, train21, G1/G3) **Train 21: with #220 the instincts learned from deaths (5 E5 lessons) and nothing from
  the night band, 2 of 6 lessons right, but I1 died more (6 / 3).** Train 20 rerun (I1 instincts on, world 4; I0 off,
  world 5; hostile, MC_WALLS, the members' vote), code be3e959 with #218, #219, #220. Both arms stopped at +116.4 (every
  process of the train ended at 23:10 during the evening pause; not saved, no runner summary).
  - **Lessons:** 6 (train 20: 24), none from the night band (13 + 6 failures) or low health (9). 1 E2 (Jonah i263, 3
    stalls on the way home), 5 E5 from deaths, + 1 death confirming a borrowed copy at its spot. Right 2 (i288 the
    drowning sand spot, i290 a night skeleton 129 out); right place but wrong scope or words 2 (i263's area passed over
    targets 30-144 away; i389 keyed on "rest at home"); unproven 1; wrong 1 (i291, an enderman 21 from home). Each E5
    lesson reached 22-24 members within minutes. i288's text lost its cause to the word cap (#222).
  - **Jonah's i263:** 3 stalls within 12 of the spot before, 0 after; 24 members borrowed it; 47 gathering targets
    passed over, 32 of them logs 30-39 away; 18 tagged model options picked 6 (33%, ~21% untagged): no steering. Uma held
    a copy and was killed at its spot: lessons reorder targets, never walks.
  - **Deaths:** I1 6 (5 at night, 4 in 3.2 min at +80-83 with 22 hostiles within 48 against I0's 9), I0 3; train 20 I1
    8. No hunt loop, no amethyst deaths (#218, #219 hold). I0's 2 "guessed" deaths at log-in are not deaths (#223).
  - **The wall:** refused 3 times in each arm (9-16, 7-18, 11-14; 7-18, 7-18, 8-17), 0 cells.
  - Failures 7% / 10%, repeats 6 / 17 (the night band's sand 13 / 51 and keep_custom, not learned about), chore
    minutes 57 / 58%, houses 25 / 25; I1 finished the Zytglogge +94.3 and a windmill +111.5, I0 not the Zytglogge. Lag
    one 2.3 s; $1.199 + $1.321. Clara's sand trip hung 32 min in the water at the drowning spot (#221).
  - **Verdict:** #220 fixed what it was for (no transient lessons; deaths teach), but place lessons did not cut deaths:
    most came in one night before any lesson, and a lesson cannot steer walks or night trips, which killed 5 of I1's 6.
    Report: runs/2026-11-04/train21/report.md.
- F355 (11-05, castle-walls-live, G3/G8) **#217 model-driven pair: with the new ballot the members passed the wall
  (9-4) and its dams held the water, but the ring was not closed in 82 min, so no stone stage, and the beds skipped every
  night (no watch on towers, no bow shot).** W1 (world 1, the five #217 flags on) against W0 (world 2, all off); train
  21's settings, hostile, MC_VOTE=model, 12 members, 90 min after, code 617b7b7, from `w217_vote` (w203_n9 with its
  MC_WALLS_NOW wall record removed so both arms vote; 48 old fence cells stand).
  - **Votes:** W1 passed 9-4 at +7.8 (the first wall passed in a model-driven run; trains 20-21 0 of 12); W0 refused 4-9
    at +9.0 and was not asked again (no death). W1's "yes" reasons name the wall's effect and their own work going on
    safely (8 of 9 "A wall will..."); its "no" 3 of 4 "I prefer..." (two name the labour); W0's "no" all 9 "I prefer...",
    freedom and confinement. **Caveat:** W1's ballot showed 15 monsters and 2 hits near home, W0's 5 monsters; the replay
    found the danger facts move the vote, so one vote per arm cannot separate frame from danger.
  - **Ring (W1):** 18 of 29 segments, 428 of 692 cells at the cap of 2 (~5.2 a minute), **29 dammed, 0 water gaps**; 3
    cells skipped "built on" at the checkpoint's old fence (an artifact). Stone stage vote not held (it waits for the
    closed ring): 0 parts. Hostiles entered 0; 1 night sample (open ring).
  - **Nights:** each ended 10-35 s after dusk by a bed (9 / 8 nights): 0 hunters, 0 tower visits, 0 bow shots or bows
    taken in W1. The watch and bows are still untested live.
  - **Deaths:** W1 3, none the wall's: Kai suffocated at log-in in rock at a stale saved position (#227); Elena and Lena
    killed by one witch by day 58-61 north, no combat line (the reflex acts within 5 blocks only, #228). W0 0.
  - [stuck] 41 / 32, failures 64 / 54, busy 91 / 92%, [lag] 0; $0.665 + $0.639.
  - Next: a 120-min W1 run (or from a checkpoint with the ring closed) for the stone stage, with nights that run; the
    frame-vs-danger question at matched facts on the ballot bench. Report: runs/2026-11-05/castle-walls-live/report.md.
- F356 (11-05, train22, G8) **The castle's stone stage, tower watch and bows live, from a closed ring with nights that
  run: both arms voted the towers (7-6) and built all 21 parts; watchers reached 154 of 158 tower posts; bows shot 35
  times, hit 14 and killed 1; but members died outside the ring at night (21 of 26 / 27 of 37).** C1 (world 4, every
  flag on) against C0 (world 5, MC_WALL_WATCH, MC_BOWS, MC_BOWS_FIRST off); castle-walls-live W1's settings, hostile,
  MC_VOTE=model, 12 members, 90 min after, 1x, code 87c72d5, from the new checkpoint `w217_ring` (w203_n9 with the fence
  ring closed by two staged runs: 692 of 692 cells, 29 dammed); nights left to run by `players_sleeping_percentage 101`
  set by rcon after start (no code change), 4 full nights of ~9 min each.
  - **Stone stage:** passed 7-6 in both (+5.5 / +2.5; "yes" names protection while their own work goes on, "no" all "I
    prefer..."; the "no" still reads "No wall for now", #232). 21 of 21 parts by +62.5 / +55.1, 2,672 stone, 1 failure
    each (a water rescue).
  - **Watch and bows (C1):** 154 of 158 tower visits reached, 0 watch spots outside the ring; 10 bows taken, 35 shots, 14
    hits, 1 kill; 12 arrows picked up after fights, 0 sweeps; flint 10 trips, 5 brought 13 flint (8 then 1-2), 3 failed
    (#225's gravel gap).
  - **Hostiles inside the ring at night** (within 8 of home's height), mean per night: C1 2.6, 5.1, 3.1, 1.5 (peak 11),
    C0 4.2, 7.0, 3.6, 3.3 (peak 13); 11 / 7 came in over the ring.
  - **Deaths 26 / 37**, 21 / 27 outside the ring at night, median ~125 from storage, on hunts and initiatives: with beds
    the curfew is off and the hunt reaches the bounds + 48 (#230). Hunts: 28 of 31 / 33 of 37 picks failed at once,
    health 11-14 against "above 14" (#231).
  - **Pens (#229):** all enlarged in the first 2.2 min; sheep full at once, chickens full by +19 (C0) / +59 (C1, the bow
    supply first), C1's two feather plucks bred back; no pen reached its restock line, so the restock and youngUntil
    are still untested live.
  - [stuck] 116 / 81, [lag] 0 / 0, busy 80 / 73%, $0.546 + $0.433. Report: runs/2026-11-05/train22/report.md.
- F357 (11-06, train23, G8) **Home by dusk works: with MC_NIGHT_BAND 19 of 20 members the band reached walked home,
  and deaths outside the ring at night fell to 12 (train 22: 21) against the control's 26; the tower ballot's words are
  right; far gravel works once needed; the pen restock and youngUntil work live. But hunts still fail at the start (12
  of 20 / 15 of 24), now at health 6-11 minutes after the pick.** C1 (world 4, every flag on) against C0 (world 5,
  MC_NIGHT_BAND and MC_GRAVEL_TRIPS off); train 22's setup (checkpoint `w217_ring`, hostile, MC_VOTE=model, 12 members,
  90 min after, 1x, nights left to run by rcon), code 161f190; C1's chicken pen killed to 0 at +35.
  - **Deaths 17 / 32** (train 22: 26 / 37): outside the ring at night 12 / 26, inside at night 5 / 1; by chore C1 hunt
    5, watch 2, initiative 2; C0 initiative 10, initiate 5 (the help and trips the band now brings home). 20 `[curfew]
    heads home` lines in C1 (99-180 blocks out, 7 by day before dusk), 19 walked home, Grace died on the way from 180.
  - **Hunts (#231):** picks 20 / 24 (31 / 37), went out 3 / 4; 12 / 15 failed "health 6-11 (a hunt starts above 11)"
    1.3-4.6 min after the pick: the member is hurt between the menu and huntEdge's check. 11 heal lines (12-14 -> 12-15).
  - **Stone-stage ballot (#232):** "No towers for now", no-voters "keep the wall as is"; refused first in both (5-8;
    4-9, 6-7, 5-8 with 5-6 monsters shown, train 22 showed 7), passed 7-6 at +18.4 / 8-5 at +29.2; 21 of 21 parts by
    +61.9 / 20 of 21 by +69.8 (t1 dropped, ground 4 above its base).
  - **Flint (#225):** 5 trips each, 17 / 20 flint; C1's second trip went 124 blocks out after the first failed near (5
    flint from 8 gravel); C0's near trips kept working after the same failure, so the far source was needed once.
  - **Watch and bows:** tower posts 150 of 151 / 78 of 82 (C0 11 spots outside the ring); shots 14 / 2, hits 3 / 2,
    kills 0. Hostiles inside the ring at night, mean per night: C1 1.1-3.5, C0 3.9-7.2.
  - **Pen restock (#229):** emptied at +36.3, restocking at once; led in, 3 hatched, 6 bred; back at 5 at +49.3 (13
    min); no breeding for 20 min while the young grew, then 11 of 12 by +88. 4 of the 9 young after the kill are not
    in the census.
  - [stuck] 62 / 113, [lag] 1 / 0, busy 75 / 78%, $0.513 + $0.468. Report: runs/2026-11-06/train23/report.md.
- F358 (11-06, #233, G7) **The player chat bench's baseline: 103 of 165 (62%); exploring is weakest (36%), then combat
  (49%) and talk (55%); gathering 97%, building 70%. The commonest failure is a fact the member makes up (32 of 62
  failures): asked what its prompt cannot know, it answers confidently ("All is well, no monsters were spotted" after a
  night of 14 monsters and a death, 5 of 5; "beyond the hills lies a dense forest" for an unexplored north, 5 of 5;
  Ada "building the east tower" when she was lighting, 5 of 5). Then routing (15): a member's line that says "village"
  goes to the Mayor (Kai's "explore west of the village"), and a line naming two members reaches only the first (Hugo
  and Iris, Ada and Finn).** `scripts/bench/chatbench.mts` (spec `docs/specs/player-chat-tests.md`): the user's 33
  lines through the real `routeChat` on fake bots and the real talk prompt on train 23's C1 village (personas, the
  Mayor's works), menus set by time and health; N 5, gpt-oss:120b-cloud (talk low, judge medium); rules first, a judge
  with the true situation for chat and refusals. 254 calls, 230k prompt + 37k output tokens, ~4 min.
  - **Acts are right when a chore fits:** cobblestone, flint, chickens, logs, sheep, the lookout, lamps and the statue 5
    of 5; the tower watch and the wall gap 5 of 5 for the one member reached; the skeletons 5 of 5 (hunt or watch).
  - **Asked to rest or eat, it chats instead of promising** (Finn hurt: 4 of 5 "I'll rest and have a meal soon" with
    `eat`/`rest` on its list), and "I'll be there" to a meeting (3 of 5): act claims no chore carries.
  - **Refusals with untrue reasons:** "no chore matches" a creeper or zombie with `watch` on the list; Lena "I don't
    have a bow" (4 of 5; it carries one); the Mayor "we only build listed buildings, not walls" to a wall vote.
  - **The talk prompt lacks the situation** (health, time, current chore, storage, explored land, last night): the
    invented facts come from questions about exactly these. A first run with a looser judge scored 101 of 165.
  - **First improvement (not made):** give the talk prompt the member's situation facts and a rule to answer only from
    them, else say it does not know and offer a chore; with it, the routing fix (a named member before "village"; each
    of two named members answers). Logs: `runs/2026-11-06/chat-tests/`.
- F359 (11-06, train24, G8) **The hunt no longer throws but goes out no more often; bows now hit and kill; flees ended
  hurt less in one arm of two; the arms differ 2.6x in deaths on the same code.** Test train 24 (PLAN "Next" 7), the
  first live test of 3373726 (#231 call-off, creeper flees round walls), 9a4e363 (#228 ranged attackers), 4e241b7 (#227
  buried log-in) and f06c2ae (bows): train 23's C1 setup (w217_ring, hostile, MC_VOTE=model, 12 members, 90 min, 1x,
  nights run), both arms A1 / A2 on 431b23e, against train 23's C1 (F357).
  - **Deaths 10 / 26** (train 23 C1 17); outside the ring at night 8 / 18 (12). The spread on one code is wider than any
    change in it: no death count here measures the fixes.
  - **Hunt (#231):** 0 `hunt_edge` health failures (train 23 12 / 15); 12 / 12 calls-off instead, done, at health 2-11.
    Hunts that met prey 9 / 10 (7 / 11), ok 4 / 2 (3 / 4), kills on hunts 14 / 7 (5 / 11): not more hunting. Half the
    calls-off (6 / 6) came on a resume after meeting prey, worded "hurt on the way out"; an ok hunt's summary reads
    "0 kills" when its kills came before a resume (#234).
  - **Creeper flees:** ended hurt 15% of 147 / 33% of 91 (train 23 42% / 33%); median 10 / 8 blocks gained, 0-1 blocks
    in 5 / 4; creeper deaths 2 / 8 (5 / 6).
  - **Ranged (#228):** fought 28 / 19, ran 7 / 1 (2 witch fights); skeleton deaths 2 / 1 (2 / 4), none by witch.
  - **Buried log-in (#227):** not exercised (no `[spawn] ... moved to the surface`, no suffocation).
  - **Bows:** 32 / 33 shots, 17 / 20 hits (53% / 61%; train 23 21%), 1 / 3 arrow kills plus 4 / 3 sword kills after
    arrow hits (train 23 0 / 0).
  - **New:** endermen killed 3 in A2, two inside the ring by the storage hut; members fought them and fled to the hut,
    where they followed (#235).
  - Curfew heads home 12 / 12, "walked home" 6 / 10 (20 / 19); stone stage refused 5-8 then passed 8-5 / passed 8-5;
    parts 21 / 20 of 21; hostiles inside at night 3.5-6.0 / 4.1-8.2 per night (1.1-3.5). [stuck] 73 / 75, [lag] 0 / 0,
    busy 83 / 84% (75%), $0.595 + $0.606. Report: runs/2026-11-06/train24/report.md.
- F360 (11-06, #233, G7) **The talk prompt's situation facts and the routing fix take the player chat bench from 103 to
  159 of 165 (62% to 96%): combat 17 -> 33 of 35, gathering 34 -> 35, exploring 9 -> 24 of 25, building 21 -> 30 of 30,
  talk 22 -> 37 of 40; invented facts 32 -> 5 failures, routing 15 -> 0.** A person's talk prompt now has "What you know
  now" (`talkSituation` -> `talkFacts`, all from what the world keeps): the time, a member's health, appetite, what it
  carries, its chore now and whether it is in the village; the storage in groups (a 0 said); the explore ring's
  directions; last night's most monsters at once within 48, who died, how many were out (the danger record keeps them
  per night now); deaths on record; members hurt; the home band at dusk. The system prompts add: answer only from those
  facts (else "I do not know", offering a listed chore), only a promise makes you act, a question is answered with chat,
  a refusal's reason must be true, only buildings are forwarded, no hand-overs or walks to meetings; the Mayor cannot call
  a vote. Routing: a named member answers before "village" wakes the Mayor, and each member a line opens with answers
  ("Hugo and Iris, ...", up to 3; `addressed`). No flag: both touch only a person's lines. N 5, gpt-oss:120b-cloud, 260
  calls, 363k prompt + 39k output tokens.
  - **The bench changed only where the prompt now holds the answer:** `situationFor` gives each case its facts as
    `talkSituation` reads them (train 23's C1 the morning after); combat.lastnight, gather.storage and gather.shortest
    are judged against those facts instead of "does not know", talk.working's truth says the prompt shows Ada's chore.
  - **Now right 5 of 5:** last night (was 0), Hugo and Iris both (0), Kai explores west (0), Ada and Finn both (0), the
    second farm (0, explore or chat), the north (0), Ada's work (0), Lena's bow (1, a true refusal), the creeper (2),
    the wall vote (3, "the villagers will decide on the stone wall when they vote"), the busiest (2, "I'm not sure");
    Last night reads "up to 14 monsters nearby last night, and Finn is hurt with 6 health left" (5 of 5; Kai's death,
    in its facts, named in none).
  - **First tries regressed and were fixed:** "promise the watch rather than refuse" turned the witch's advice question
    into hunts (5 -> 0 of 5) until "a question is answered with chat"; meeting calls went to the Mayor as forwards (4 of
    5) until forward was kept to buildings.
  - **Left (6):** Finn chats "I'll rest and eat soon" 1 of 5; the witch "let the watch handle it" 1; Iris "I haven't
    explored that area" with east explored 1; Ben refuses the meeting 3 of 5 with "I cannot walk to the meeting", which
    the judge fails as he stands 8 blocks off (debatable: no chore walks him there). The live tier is still to build.
    Logs: `runs/2026-11-06/chat-tests/facts-n5-final.log` (and the first try, `facts-n5.log`, 150 of 165).
- F361 (11-06, #233, G7) **The player chat live tier: the 33 lines said in a running world pass 28 of 33 (23 by the
  bench's strict kinds), against the offline bench's 159 of 165 (F360). Routing is right 33 of 33, at range too; what
  differs live is the chores list: the talk prompt offers 0-17 chores (about 4 typical), not the bench's 18-24, so six
  requests the bench expects promised are refused, truly ("I have no chore that gathers cobblestone").** Built:
  `scripts/chat_live.py` (sets the time, a member's health, monsters and a member's place per case, says the line as
  SausageOfDoom4 through `/api/say`, reads the request ledger, waits for promised chores), `scripts/bench/chatlive_score.mts`
  (the bench's rules and judge on the talk prompt each member really saw, from the model-call recording, with that prompt
  as the truth), `scripts/series/chat_live.json` (train 23's C1 setup on world 4, w217_ring, 1x, hostile). `/api/say`'s
  `pos` now reaches routing as well, so "the nearest member" works for a person not in the game. N 1, gpt-oss:120b-cloud.
  - **Per category:** combat 5 of 7, gathering 6 of 7, exploring 4 of 5, building 6 of 6, talk 7 of 8. Replied 32 of 33;
    every promise ran: Grace, Hugo and Iris started theirs in 4-10 s; Dev's flint waited 17.6 min behind his "Make
    charcoal" (past its 15-min due) and was kept at +21 min.
  - **Why the lists are short:** the menu offers only what is feasible now and not held by others: no
    `gather:cobblestone` with 1,439 in storage, no explore with every direction explored, no eat or rest for Finn 110
    blocks out, pens and breeding held. Members carry what the checkpoint left them: Kai and Grace had no weapon, so no
    watch or hunt. A refusal then is the true answer, but the person's request goes nowhere: the menu, not the model, is
    the limit live.
  - **Failing (5):** Lena's talk call came back empty: the request stays `unanswered` and she says nothing in the game (no
    fallback line; the bench retries and never sees it). The Mayor read "Last night: no record" as "no monsters were
    near" (the record starts with the first night after a resume). Grace, unarmed, answered skeletons with "make stone
    swords". Hugo refused the second farm with own farms on his list. Lena "can't hand over my bow", carrying none.
  - **Setting the situation:** time and summoned monsters work; `damage` left Finn at 10, not 6; monsters near now are
    still not in the talk prompt; jumping the time to day for the next case ends a promised watch early ("kept").
    Notes `runs/2026-11-06/chat-live/notes.md`; scored `runs/2026-11-06/chat-live/score2.log`.
- F362 (11-06, #235, #234, #231, test train 25) **Endermen no longer kill members: 0 fights, 0 deaths, gaze turned 26 /
  36 times (train 24 A2: 3 deaths). The hunt's reach of 64 holds (every distance 45-59, train 24 51-182) and makes hunts
  safe: 0 calls-off, 0 deaths on hunts, HP lost 0 / 1 (12 / 12, 2 / 7, 110 / 192). It also makes them nearly empty:
  kills inside hunts 4 / 5 against 54 / 46. And members stay hurt: 19-21% of member-time at health 14 or less, 99% of it
  at food 14-17, under vanilla's regen at 18.** Both arms on fd5800c, train 24's setup (w217_ring, hostile, 1x, nights
  run, 90 min, gpt-oss cloud), worlds 4 and 5; a new sampler read every member's health and food every 30 s.
  - **#234:** ok hunts' kills match the `[hunt] ... killed` lines (2 / 2, 1 / 1) across 13 / 13 resumed hunts. The
    "after N kills" wording was not exercised (no call-off). Reflex kills inside a hunt (6 of 9 here) are not in its summary.
  - **New, #237:** all 112 "-> the village edge" `[stuck]` lines (57 / 55; train 24 1 / 0) aim at two spots, the north
    and south points of the radius-48 circle round the hut, whose surface is 6-9 above home (castle towers or a rise).
    Other `[stuck]` lines are 58 / 93 against 73 / 75, the same kinds, so the gaze guard did not upset walks.
  - **New, #238:** the appetite eats at food 14 (`APPETITE.eatAt`), so food sits at 14-17 between meals and vanilla never
    heals: Dev at health 1 for 16 min, Lena at 2 for 12. ce4a955's eat-to-18 covers the hunt and the reflex's hut
    recovery only (2 meals in this train, both Dev's).
  - Deaths 6 / 13 (10 / 26), all 71-158 blocks out, 17 of 19 at night, 10 on initiative chores. Cost ~$0.47 / $0.54.
    Report `runs/2026-11-06/train25/report.md`.
- F364 (11-07, #238, #237, #231, #233, test train 26) **Hurt members heal now: member-time at health 14 or less fell
  from 19-21% to 4%, and the hunt's walk no longer stalls at the towers (village-edge `[stuck]` 57 / 55 -> 0 / 6).**
  Both arms on a5c7af8, train 25's setup (w217_ring, hostile, 1x, nights run, 90 min, gpt-oss cloud), worlds 4 and 5;
  A1 every flag on, A2 `MC_HUNT_NEAR=off`. Health and storage sampled every 30 s / 2 min.
  - **#238:** at health <= 6 13-16 member-min (56-66), longest spell 5-7 min (15-25). Meals 92 / 81 (51 / 52), every
    peckish line a hurt-only one; bread 231 -> 204 / 211, far above the guard. Eat chores doubled (81 / 80 against
    39 / 38); A1's busy dip at +10-30 (64%) is "nothing feasible" idling, not meal holds.
  - **#237:** all `[stuck]` 73 / 66 (115 / 148); ring spots moved to level ground 17 / 157, dropped 3 / 17, never all of
    a hunt's; "still alive after 30 s" 0 / 0 (6 / 1).
  - **`MC_HUNT_NEAR`:** on, the hunt was offered in 6 menus and went out twice (2 hunt + 2 reflex kills); off, 60 and 16
    (2 + 5). Fuller hunts, fewer of them; bone in storage 7 against 13 at the end; string 0-1 in both. No hunt deaths.
  - **`MC_PIG_CARROTS`:** carrots bought 5 / 4 times, pigs 2 -> 5 in both (train 25: 2 all run, never bred). Led cows
    pass the ring (gate held open 2, lost on the way 0; train 25 A2 2).
  - Endermen 0 deaths, 0 fights. Deaths 8 / 5 (6 / 13), all 92-158 out, none on a hunt. Cost ~$0.45 / $0.51.
  - **#233 live tier with `MC_TALK_PASS`: 30 of 33** (F361 28), replied 33 of 33 (#236 holds). The pass-on routed all 4
    "no chore" refusals, but no receiver promised: 3 chatted, 1 refused, Iris with gather:logs on her list ("Good
    morning!"). New #244. Reports `runs/2026-11-07/train26/report.md`, `runs/2026-11-07/chat-live/notes.md`.
