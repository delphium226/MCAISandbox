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
