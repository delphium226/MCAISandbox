# Decisions log

Moved from `docs/PLAN.md` on 2026-10-15; add new decisions at the end, dated.


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
- 09-29 The atlas is one shared map for every agent and village (the user's choice over per-village knowledge), kept
  in its own file (`mc/server/atlas.json`, saved at most every 30 s) rather than `villages.json`, which is written on
  every change and returned whole by `/api/village/:v`.
- 09-29 Working method for phase 2A (the user agreed): one main thread does V.1-V.4 in order (they depend on each
  other and on the one test world); subagents do side work that does not touch the world: reading run logs after
  each run, reviewing each diff before it is committed (bugs, and blocks broken outside the agent's own work, cf.
  F55), writing check scripts, docs. Once V.2 has settled the storage record, a second agent may build V.5/V.6 (the
  mine) in a git worktree; its tests wait for the world between the main thread's runs. No second Paper instance
  unless waiting for the world becomes the bottleneck. No orchestrated workflow unless the user asks for one.
- 09-29 New phase 2A, village infrastructure (the user's requirements): storage hut with 9 chests, sorted storage
  and a readable inventory, a code-computed materials-needed list the mayor plans from and can add to, several
  materials per trip, a mining hut with a staircase mine, underground finds in the atlas. It comes before 2.3.
  Fixed designs in code for both huts; mine = staircase then branch tunnels (the user's choices).
- 09-29 Step 2.2 becomes "finish trees" with pillar removal (the user's choice, after F54); the atlas-guided collect
  moves to 2.2b.
- 09-29 Phase 1 closed with step 1.6 (README and ARCHITECTURE.md brought up to date); phase 2 starts with 2.1.
- 09-29 (fifth session) The storage hut has an open doorway, not the oak door of the agreed design (F69: a bot
  leaving through the open door stuck in the doorway). Peaceful worlds have no mobs to keep out.
- 09-29 (fifth session) New step V.2b (the user's): the crafting table and furnace go inside the storage hut and the
  village crafts and smelts there.
- 10-01 V.5 counted done (StageH18 and Hutvale4); the mine stopping at a hillside (F77) becomes its own step, V.5b,
  before V.6.
- 10-01 (sixth session) Faster tests become phase T, before F88 and V.7's last pass (the user asked for it): time scale
  first, then a fixed test world, a site check, parallel runs. Not the sandbox engine (the bugs live in Minecraft and
  Mineflayer behaviour) and not RCON fast travel (it hides pathfinding bugs).
- 10-01 (sixth session) V.5b does both, in the plan's order: main tunnels turn left, then right, at a junction of one
  that ended (`legs`, at most 12 a level, breadth-first, the turned tunnel's first stretch is a finished branch), and when
  no tunnel at a level can go on the stairs go on down from its bottom step, under its first tunnel (nothing goes there
  any more), 6-10 steps into stone (at most 3 levels). A cell with no stone ends its tunnel (F79). Old mines load as one
  leg; a mine stopped by its main tunnel resumes (StageH19 did). Mine boxes stop at the tunnel ceiling (the ground above
  stays free for other bots), and every walk in the mine digs nothing (F80). New `GET /api/blocks` (a box of blocks) and
  `scripts/checks/mine.py` for checks. Test edits: StageM1's and Hutvale4's first tunnels were marked ended in
  `villages.json` to test the stairs down (backups in `runs/2026-10-01/`).
- 10-01 (seventh session) T.1 goes ahead (go): `MC_TIME_SCALE=2` runs the server at tick rate 40 and the bots'
  physics at 40 (a patch-package patch on Mineflayer 4.39.0's physics clock, pinned); digs stay in real time (F91);
  build pacing, smelt polling, the jump-and-place waits and the pathfinder's per-tick search budget scale with it.
  Walking 1.94x, staged build ~1.5x, mining 1x. For staged runs and checks only; model-driven acceptance runs stay at 1x.
- 10-01 (seventh session) T.2 takes option (b), a separate test world generated from seed 1793578865 in
  `mc/testserver` (ports 25566, RCON 25576, agent server 8767), not snapshots of today's world: a region file is
  512x512 blocks, and the test regions of today's world hold up to 14 villages each that a restore would wipe while
  `villages.json` still listed them; the proven sites of Minevale3 and Minevale4 are built over with no backup, and a
  fresh world from the same jar regenerates them untouched. The agent server takes `MC_SERVER_DIR` (its world's
  `server.properties`, `villages.json`, `atlas.json`). The test world is also T.4's second instance.
- 09-29 (fifth session) The panel's per-village atlas maps are replaced by one world map of the whole atlas (the
  user's request): drag, zoom, every village's ground and chests, the agents, and what is under the pointer
  (`/api/atlas?all=1`, fetched every 30 s).
- 09-29 (fifth session) V.1/V.2 as designed; details decided in code: the storage task crafts 4 chests at once
  (collect 10 logs) so crafting happens in the woods, and a deposit crafts another chest only when a group needs one;
  groups are logs, planks, cobblestone (with stone kinds), sand (with sandstone), glass, terracotta, misc; the hut's
  door faces south, spot 1 is just inside it and the back-middle spot is last. Known risk, left as agreed: the hut
  chains the village (prepare -> storage -> every gather; the hut build -> every other build), so a failed prepare or
  hut build blocks the rest until the mayor steps in (review finding).
- 10-02 (ninth session) 2.4 after its diff review: scouting ends with the re-run's result (found or not), after 20 min,
  or when the scouts' tasks are gone with their agents; only the mayor's first verdict counts; no scouts without workers;
  `scout` is clamped to 96 once the village has ground (an executor must not use it as a boundless explore, lesson 22);
  no code-added find_site while scouting; a failed re-run wakes the planner. Left: plan_layout's material count around a
  far site (it counts around the mayor; errs toward refusing).
- 10-02 (ninth session) Step 2.4 design (the user agreed, "go"): scouts within the 96-block range add nothing (a bot
  sees ~128 blocks, and a new mayor's site search, the atlas step included, stays within 96 of its spawn), so **before a
  village's first layout its site search and its scouts may go 256 blocks from home** (as for an agent in no village,
  2.3); after the first layout home is the plot and 96 applies again (changes the decisions of 09-28 and 10-02 for that
  phase only). A `scout x= z=` skill walks toward a point and never fails (a dead end reports how far it got), so the
  tasks run as written with no model calls; walking is enough (the atlas records every chunk a bot loads). Code posts
  scout tasks once per village when the mayor's first find_site finds nothing good (a verdict field written by
  find_site, not parsed text), in survival, to the points of an 8-point ring (radius 160 around home) **the atlas does
  not already know** (the user agreed to this refinement: on warm land no scouting at all); `plan_layout` is refused
  while scouts are out; when they are all back, code (not the mayor's model) runs find_site once more with the 256 range;
  one round only, then the best site found is used. The mayor draws its designs meanwhile. Order: the 1x model-driven
  run of batch R first (Minevale8), then 2.4.
- 10-02 (eighth session, close) Phase 3 is deferred (the user); next: batch R (today's findings F96, F97, F95's
  follow-up, F100), then step 2.4 scouting.
- 10-02 (eighth session) A, the fallen-tree rule: lying rows are felled, one-log stumps and other leafless logs count
  as built and are passed over at no cost (the user asked Claude to decide; the design review's measurements).
- 10-02 (eighth session) Step 2.3 design (the user asked Claude to decide): the atlas ranks areas, the column survey
  chooses the square; within 96 blocks of home for a village (a new village's mayor has its spawn as home), 256 for an
  agent in no village; a candidate needs 90% of its cells known, unknown land adds nothing; the atlas only replaces
  the blind legs (after the review: only when the local search found nothing good). The test world's atlas needs no
  seeding: a village search stays within the spawn's loaded chunks, which the atlas records in seconds.
- 09-28 The mayor stays within 96 blocks of its village (the same range as gathering); find_site walks at most two
  40-block legs itself instead.
- 10-02 (a conversation beside the ninth session) Phase D, buildings and villages with character, written into the plan
  at the user's request after a review of the design path (the user: the designs are "a bit flat"). Not scheduled:
  where it goes relative to 2.4 is the user's to decide.
- 10-03 (the same conversation) No cloud models that cost extra (the user): Ollama Cloud bills every call against the
  plan's monthly credits by model since 08-31 (gpt-oss:120b $0.15/$0.60 per million tokens in/out, kimi-k3 $3/$15), and
  the Claude API is billed separately. gpt-oss stays the mayor's planner and architect (a few cents a village); vision
  work goes to the local models. The vision test that led to it (two design renders, 10-02): every model but
  mistral-large-3 named the roof shape, none counted footprints reliably; kimi-k3 read doors and windows best (5-9 s),
  qwen3.8 (5-7 s on its pinned server) invented a door and logs once, gemma4 (12-14 s) misread every footprint. So a
  critic gets the exact facts from code with the render and is asked only to judge.
- 10-03 (tenth session) The user's choices at the start: push the twelve unpushed commits (done: origin at `ec88826`),
  then F106 (the search stalls) before phase D, which follows in the same session; F107, F104 and the desert mayor's
  loop stay in the backlog; phase 3 stays deferred.
- 10-03 (tenth session) F106: one fast scanner behind `nearestBlocks` rather than fixing each caller, so collect,
  find_site and plan_layout's counts change together (lesson 46); the scan stays synchronous (it is ms now, and an async
  materialsNear would change the WorldAdapter interface and its callers).
- 10-04 (tenth session) D.1's budget: per design by kind, a house 250 gather units and a landmark (a hall, chapel,
  tower... by its name or brief) 400, and plan_layout lays out one building over 250 a village; not "the first design
  drawn" (the review: that gave the cottage, built twice, the larger budget). Torches and roof overhangs left for D.2's
  generator, which can place them right.
- 10-04 (eleventh session) D.2's design (the user's choices among Claude's recommendations, after a design review):
  first version rect footprints with gable, hip (a pyramid on a square) and flat roofs and an overhang of 0-1; then L
  and T; then porch, chimney and trapdoor shutters; shed roofs and two storeys later (a 9-deep shed needs 13 layers,
  agents never climb). A separate `submit_style` tool beside `submit_design` (an enum schema; offered only where the
  world takes block states, so not in the sandbox), and the generated design goes through design()'s checks unchanged.
  Copies differ by `rotate` only for now; variant designs (mirror, accents) wait for D.4 and a shared check function
  (the review: exact-name "already stands here", copy labels, summaries and plan_layout's material checks would break).
  The mayor's brief stays as it is (D.6). No `wood`, `ridge` or window-spacing parameters (a survival village swaps
  every design into its own wood; code chooses the rest, with odd spans). Stair `shape` is left to the server: the
  review read the 26.1.2 jar, and /setblock and /fill compute a placed stair's shape from its neighbours and a later
  neighbour recomputes it, so code computes shapes only to check them (the offline script, the elevations, the
  four-rotation build).
- 10-04 (eleventh session, late) Vanilla villages next (the user agreed Claude's recommendations, "re-use minecraft
  resources"): code picks vanilla pieces by the site's biome and the kind the mayor asks for; "matching" houses are
  siblings of one family; vanilla's blocks are kept where the economy makes them, the rest substituted (decoration to
  air, interiors later); the plan is a hybrid (our planner places a vanilla town centre, dirt_path streets from its
  connectors, houses facing the streets, lamp posts), a street village within 32x32 first, then a green with a larger
  pad; `/place jigsaw` in creative as ground truth; vanilla tags, recipes, loot tables and client textures replace hand
  lists (V2.5). Pieces are read from the local jars at runtime, never committed. The steps: "Vanilla villages" in phase D.
- 10-04 (eleventh session) After Minevale12-13 (the user's choices among Claude's options): generated buildings are
  packed by their walls, the overhang's eaves over the street (a building with an overhang reserves only its own area
  while it builds; the doorway clearing keeps off other buildings, built or planned); budgets 150 gather units a house
  and 300 a landmark (were 250 and 400; generated villages came to ~760 units). Workstations in a hand-drawn survival
  design become air and a failed model call is one try (F115), both in code. After Minevale14 (23.2 min, a 13x13 hall):
  a style's walls are capped, houses 9 and landmarks 11; and the tested work is committed before the next model run
  (the user).

- 10-08 (twenty-second session) F165/F169 (no question asked; the research `research/f165_analysis.md` and its
  simulation `f165/sim.mts`, 7 of 24 cases failing before, 0 after): makeFromStock passes the spare wood kind to every
  craft (a tie-break after shortfall; sticks of that kind when enough can be had) and every smelt (its planks, then its
  logs, burn before other kinds'); always passed (VanW8, with the hint dropped when no kind looked spare, came up a
  plank short on the fences; VanW7 and VanW9 with it always passed made signs and lamps in one pass).
- 10-08 (twenty-second session) The iron age v1 (no questions this session; each choice the recommended one; design
  `runs/2026-10-08/s22/iron_design.md`, research `research/iron.md` and `iron_design_draft.md`, review
  `reviews/iron_design_review.md`): **after completion, as chores** (after the farm slots' starts, before exploring; one
  chore a village at a time); **an iron level** reached by its own stairs from the deepest level's bottom step,
  **sideways** off that level's first tunnel (the review's H1: straight on they would have cut the live corridor; the side
  whose first 4 steps stay off every dug cell, that side then never turned at), one block down a step to y 18 (iron peaks
  at 12-27 in 26.1; the mine's levels at 56-64 meet ~0-1 iron in 100 cells), or a level at the last step when water or a
  cave stops them at y 40 or less; tunnels there in the cobblestone mine's pattern (4 legs, 160 cells) keeping the iron
  and coal in their walls and ceiling (never the floor); its **own record** `mine.iron` (the cobblestone mine's tunnels,
  turns, counters and stop rules never see it); trips of 6 minutes with two stone pickaxes or better from the hut (no
  forced digs: a wooden one would lose the ore); **make_iron_tool**: an iron pickaxe once 3 raw iron are stored, then a
  bucket, both into storage by name (the miner takes the best stored pickaxe at a trip's start); F178 fixed (storage
  coal fetched as fuel); a bot stuck in the iron level is **teleported home at once** (the review's H3 asked for walks
  that cannot dig; a teleport is simpler and is what a sealed-in member gets). Not in v1: lanterns, shears, buckets used
  for anything, axes.
- 10-08 (twenty-second session) Opportunistic farming and exploring v1 (the user asked for no questions this session;
  each choice the recommended one): **chores after completion only** (code queues the skill on an idle worker, lesson
  93; never on the critical path, lesson 91); **plant kinds first** (sugar cane, pumpkin, melon, then carrots, potatoes,
  beetroot from vanilla villages' fields), animals only recorded (pens next: luring by held food is a new movement
  problem, no leads without string); **two kind-free 5x7 slots** per layout placed after the lamps and off them (no lamp
  lost: 2 on every 40 plot, 0-2 on 30-32); the farmer gathers the first plants at the sighting itself and makes seeds by
  hand; **farm trips and exploring reach FARM_TRIP_RANGE = 160** from home (the design review's H3: the bots at home
  already see ~128 blocks, so exploring within 96 could find nothing; every board task keeps collect's 96); exploring
  visits 8 ring points at 160 once each, one explorer at a time, then stops; tests with `--fixtures --after --ripen`
  (stage) and `MCAI_AFTER` (watch). The design review's 16 findings all taken (stems on inner rows, CHARGE_AS for the new
  plants, locks inside the skills, collect's own filter shared, partial collects counted on the server, cane cut
  top-down, the animals' grace and save flag, `plants: {}` always).
- 10-08 (twenty-first session) The opportunities analysis (`runs/2026-10-08/s21/opportunities/`: three read-only
  analyses, Minevale26-31 with a schedule simulation, 15 staged runs, the code side; `ranking.md`). The user chose to
  build #1, #2 (F164), #5 and #3/#4, F164 as whole buildings. Done: **#1 the preparer sets up the storage with its
  felled logs** (`33b70f6`: VanO2 7.2 min against VanF5 8.9); **#2 F164** (`5f3e133`: per kind with the old
  all-together rule, latest buildings moved to another kind that covers them, one kind per building in the builder;
  VanW5 7.2 against VanW2 9.6 on Minevale31's site with a wood kind); **#5 the huts' stations shared** (buildings after
  the storage hut bill no table or furnace; the hut's stations reach 64 blocks: VanW6 ~26 fewer cobblestone, time
  within noise). Then (the user: build them without re-measuring) **#3 pre-gathering** (hand-gathered items only:
  sand, red_sand, dirt, gravel, clay_ball, wheat_seeds; a deposit waits for the storage; unprepared layouts are village
  ground for collect, the review's High) and **#4(b) lamps once every build is claimed** (`afterClaimed`; lamps
  outside every claim ring and door walkway, checked offline; the lamps' logs kept back while their task is open;
  #4(a), signs in the lamp job, skipped as conflicting) (`0ec7e0a`: VanO4 6.1 min). Staged green plains 8.9 -> 6.1 min
  over the session. No model-driven run this session (the user's choice): Minevale32 first next session.
- 10-08 (twenty-first session) Harvest and bread (the user's choices, all as recommended): a **chore**, not a board task
  (`MineflayerWorld.farmChores`: every 30 s, fields read from the bots' views, at 3/4 ripe and at least 4 an idle worker
  holding no task, with nothing claimable unless the village is complete, is given `harvest_farm`; brains ignore chore
  events; completion, wake-ups and stop rules never see it; it runs after completion too); `loot give ... mine` per ripe
  cell standing by the hut (no walking on the field), resown charged a seed; **all wheat baked** into bread at the hut's
  table (only that table), the rest into storage; tests **staged with the field set ripe by command**
  (`stage_village.py --harvest`), no model-driven run (a harvest never fires inside one; the user agreed to skip it).
  The design review proposed the chore over a board task (races, a stall after completion, a posting loop); the diff
  review's two mediums taken (a failed count no longer clears the field; never ahead of claimable board work), and its
  lows 3-5, 7, 10. Next (the user): the opportunities analysis.
- 10-08 (twentieth session) Farming v1 (the user's choices, all as recommended): seeds by soft gather tasks into storage
  (not gathered by the planter); a 5x7 field with 16 seeds in alternate rows; planted early (after the storage hut's
  build), completion waits for the planting; harvest and bread later, as v2. Claude's calls after the design review: a
  hoe required; no farm in cold or desert biomes; water laid by tend_farm, not prepare_site (M5); every H and M finding
  taken. After Minevale31: seeds in posting order and no hoe-log task (the user: both fixes, a staged run only, no second
  model run); F164 to the opportunities analysis. The user's order for what follows: harvest and bread, then the
  opportunities analysis (the user's idea: look for more places agents can act opportunistically, for a faster build),
  then opportunistic farming and exploring (the user's: farm whatever is found first, never search for a given kind;
  explore for anything once the buildings stand), then the iron age.
- 10-08 (nineteenth session, after the close) Farming before the iron age (the user asked whether the iron age should
  come first; Claude recommended farming first): iron's only hard link to farming is water (a water bucket, 3 iron),
  and prepare_site lays the farm's water free as landscaping, as it lays the streets. The iron age stays next after
  farming; the farm's water can be charged once buckets exist.
- 10-08 (nineteenth session) Name signs (the user's choices, all as recommended): a wall sign on the outside wall
  beside the entrance door (right as seen from outside, then left; the door's upper half, then its lower half, then over
  the door), not a standing sign or one over the door (536/536 test layouts against 305 standing); every building with a
  door, the huts too ("Storage", "Mine"), labelled by its use ("House", "Library", vanilla kinds; other designs their own
  name), one line, capitalised; the town centre gets none; a separate soft task "Put up the signs" after every build and
  after the lamps (both draw the storage's wood), on every layout kind; waxed; completion waits for it. The review's
  street guard for wall signs was dropped (it left 207 of 536 without a sign). Next: farming, in the agreed order of
  the village-life list.
- 10-06 (eighteenth session) F155 (the user's choices among Claude's recommendations): the full package (wait-only plans
  as empty, the nudge naming the library, find_site's reason ending "now", the executor waiting for a pending replan, the
  review's fixes) and G4's skip; code calling plan_layout itself (c) to the backlog (the review: names from free text
  would lay out the wrong village and code would declare it complete). Staged runs skipped for F155 (no changed path
  runs with `--planner none`). Then lamp posts (the user's choice of next): simple fence + torch now, vanilla pieces
  later; charged; about every 8 blocks; completion waits for them. Claude's calls after the reviews: the lamp task after
  every build; no gather tasks at layout (made from storage, requeued when short); the job stands by the storage hut.
  The user's village-life list added to the backlog (signs, farming, interiors, lighting inside buildings and mines,
  and more). F156 fixed without a run (the user's choice); F157 to the backlog.
- 10-06 (seventeenth session) The small backlog (the user's choices among Claude's recommendations): F148 fixed at the
  root and guarded (the patched pathfinder copies A* nodes into paths, and walkOnce re-searches an idle empty path), not
  by a larger tick budget or the safety net alone. F131: "out" means a path home exists (a search only), else, in no
  village, the open sky; no climb on village ground (teleport home); the mine's doorway repair goes to the backlog (its
  cause was fixed 10-04). F150: no speculative fix; wait for a model-driven run's `[stuck]` line. After the reviews
  (Claude's calls): no slices of toBreak/toPlace in the patch; a home search that times out counts as out (sealed spaces
  answer `noPath` quickly, F154); the climb skip only for village members; F153's two pathfinder edges to the backlog.
- 10-05 (sixteenth session) F138's leftovers, after item 3's lines (the user's choices among Claude's recommendations):
  item 4 skipped (the stall was the server refusing moves, not a diagonal); item 1's side spot only within 6 blocks of
  the chest (farther, an unmoved stall fails at once); item 2 replaced by the rescue walking out away from the stalled
  walk's goal first. F147: the half width 1229/4096 (not an epsilon patch of prismarine-physics); the mine's stalls
  diagnosed first (`[stuck-world]`), then every dig checked with the server (mineBlock, collect included). At the close:
  push, and next the small backlog (F148, F150, F131's leftovers) before lamp posts or phase 3.
- 10-05 (fifteenth session) F138's leftovers (the user's choices among Claude's recommendations, after the reproduction):
  order 3 -> 4 -> 1 -> 2; item 3 a permanent `[stuck]` line in the agent log (the pathfinder's recent events and the
  walk's tick tally, F145); item 1 fails the deposit or withdraw at once on a stall that did not move the bot (a stall
  after moving keeps today's side spots), so two such failures bring the rescue in ~20 s; item 4 now and item 2 (a
  straight step toward the goal inside `walk`) only if stalls remain. After the design review (Claude's call, to confirm
  with the user at the next session): item 4 waits for item 3's lines (the live stall's first node is a cardinal jump-up,
  F143); item 1's open question: one nearest side spot before failing (F146).
- 10-05 (fourteenth session) V2.5's shape (the user's choices among Claude's recommendations, after four inventories):
  tags, smelting and textures this session, loot tables only as a check (no runtime change); read from the local jars at
  runtime, cached per process, today's hand lists when the jar is missing (logged once; all lists at once, never mixed);
  vanilla's sets in every list, also the ones found beside V2.5's (find_site's NON_GROUND, the mine's and rescue's
  DIGGABLE, isLog, the atlas); waterlogged states with an empty box count as water in collect's and the mine's checks
  (solid ones not). After the design review (Claude's call, the user deferred): mushroom stems are not logs, and built
  log and bamboo frames read as built ground; crafting stays on minecraft-data (a strict subset of the jar's; the jar's
  recolouring recipes made the cost search cycle).
- 10-04 (thirteenth session) V2.4's shape (the user's choices among Claude's options, after prepare_site 40x40 was
  measured): a ring street round a green, the town centre in it, every building outside the ring facing in (not an open
  green with paths, not just a bigger street plan); the vanilla mayor searches find_site size=40, a 40 site gets the green
  (when it places every building), a smaller one the street plan as before. Next after V2.3m (pushed at that point).
- 10-04 (thirteenth session) V2.3m's shape (after the design review): the mayor's gathering runs in a TaskBrain beside
  its empty plan, not as a "by task" plan in `memory.plan` (the review found that path reaching the executor's building
  tools on urgent turns, the 3-failure replan and two wake-ups blocked by the mayor's own claim); a hand-back for the
  mayor's own reasons or a busy mine counts no try (`unclaim`), a failed collect after one retry does (`giveUp`); the
  staged Mayor has no planner (`--planner none`), so a staged run makes no model calls.
- 10-04 (twelfth session) The mayor gathers while it waits (the user's choice among Claude's options: gathering tasks
  only, not builds or every task, nor idle until phase 3): step V2.3m, after V2.3.
- 10-04 (twelfth session) V2.3's design (the user's choices): the mayor gets vanilla houses through the village library,
  filled from the site's biome after find_site (not kinds in plan_layout); town centres are the meeting points without
  water (no fountains: no buckets); lamp posts later; the house budget stays 150 (taiga's log houses mostly fail it,
  F122); streets are laid free by prepare_site as dirt_path, not charged as dirt (a shovel's work in vanilla; building
  them as designs collided with every build's claim); wool becomes a slab of the piece's wood (market awnings stay roofs);
  leaves stay out (shears need iron).
- 10-04 (twelfth session) V2.1's design (the user's choices among Claude's recommendations): an imported piece's
  entrance door is in layer 1 (plains floors sit a block lower than vanilla's; no new Design field); terracotta by biome
  (plains, taiga and snowy cobblestone, savanna acacia planks, desert sandstone); stripped logs and bark blocks keep their
  look and are charged as logs (the builder's wood swap keeps the prefix); every piece turned so its entrance faces south
  (V2.3 turns it to its street with build_design's rotate). Doors with no way out face across their wall. Snow and ice
  houses are left to fail the checks.
- 10-09 Animal pens (the user's choices): pens on an **annex**, a 13x9 plot prepared beside the village after completion
  with two slots (not the plot's own slots: plants keep those), chosen in code from the four sides by earthwork, trees and
  the walk from the storage hut; one lure trip of up to 4 chickens (a retry only when none got in); eggs and breeding
  later (v2). Claude's: chickens first; the ring charged at the storage hut with the gate open; seeds in the off-hand by
  command; 4-block hops waiting for the chickens; the bot teleported into the pen's back row and out again, the gate
  closed by command when its cell is clear; annex and pen chores after the plant starts and before the iron age; one pen
  with chickens a village in v1; tries forgiven after an hour; failed sightings passed over within 8.
- 10-09 F193 (per-agent chores) left for later: one chore a village keeps the chores simple to reason about.
- 10-09 (s24; the user asked Claude to decide everything after the first question) F193: chores keyed by agent, each with
  a key (`slot:k:j`, `farm:k`, `start`, `annex`, `pen`, `penwork:j`, `cake`, `iron`, `explore`); an idle member takes the
  first chore of a kind no other holds; workers first, then **the Mayor after completion (the user's choice, every
  kind)**; a complete Mayor takes no executor turn unless urgent; the lure never runs beside harvests or farm starts
  (seeds tempt chickens), exploring never beside a lure; an ended chore's key is held 10 s while its skill unwinds.
- 10-09 (s24) Pens v2 (Claude's choices): cows on the annex's second slot, lured with wheat from storage only; eggs,
  breeding and milking by command from the cell beyond the gate (F202), never a bot in a closed pen; caps 6 chickens, 4
  cows; breeding at most every 6000 ticks a pen with storage food, only Age-0 adults; eggs taken whenever a bot sees an
  item in a chicken pen (1 min apart: eggs despawn after 5 min); milk into every bucket storage holds up to 3; the iron
  age makes 3 buckets once a cow pen holds cows; a cake at the hut's table once storage holds 3 milk, an egg, 3 wheat
  and 2 sugar or cane (at most 2 in storage); crafts give back their remainders (buckets); bread only from wheat beyond
  16 kept in storage; a pen of one is lured into again (F204); animals stuck at the gate are teleported in (F203).

- 10-10 (s25) F205 (the user's choices): sightings from 4 below to **8 above** the pen level, level ones first; the 96
  blocks measured **from the annex's centre**. Claude's: the walk to the animals with a 3D goal and no scaffolding (XZ on
  "no path"), animals chosen within 9 in 3D, the lead with drops of at most 3, a straggler dropped after two waits
  beyond 12, the height named in "lost"/"stuck" messages; staged `--fixture-dy`, `--fixture-at`, `--fixture-clear`.
- 10-10 (s25) F209 (the user's choice: the root causes only): in water a walk's progress needs 2 blocks; an exploring
  scout's goal range 11; a chore's home leg that starts in water teleports at once. No dry ring points, no scout watchdog.
- 10-10 (s25) The control panel (the user's requests): the simple view reworked; the detailed view as summary cards with
  drill-down tabs ("no long lists; an option to drill in"); fading agent trails; world map "Auto" framing on by default,
  never closer than the village; a who-is-doing-what overlay top-right; a fullscreen map; drawn icons for animals, farms,
  pens, the mine and chests with a key bottom-right. Applying the panel during a run is fine (the file is read per
  request; the user's approval, 10-10).
- 10-10 (s25) Minevale36's wheat field ripened by command at +26 min to reach the cow pen with real models (the user's
  choice); an `MCAI_RIPEN` option for `watch_village.py` proposed.
- 10-10 (s25) README restructured as an AI-agent project first (the user's request), with fresh panel screenshots.
- 10-10 (s26) **Base assumption: gpt-oss:120b-cloud for every role** (executors, the workers' planner, the Mayor's planner
  and architect; the user's decision after the literature review and the cost estimate, ~$0.06 an hour at decision
  points). Replaces 10-03's "new roles go to local models"; the local servers stay as a fallback. gpt-oss ignores
  `think: false` (a one-line test: 69 output tokens against 51 at "medium" and 20 at "low"), so A.0 sets a reasoning
  level per call kind.
- 10-10 (s26) Phase A, agents that choose, proposed (the user's request: "make the agents more intelligent and
  autonomous"); its place against the twenty-fifth session's proposals (`MCAI_RIPEN`, F213, F211) and the open choices
  in A.2, A.3 and A.7 are the user's.
- 10-10 (s26) The user chose Phase A before the twenty-fifth session's leftovers, and the scaling work in it (A.0b's
  probe, instances in A.2, 5-6 agents a village and two villages in A.8).
- 10-10 (s26) A.0's reasoning defaults from the benches, against the spec's guess (exec low, plan medium): exec
  **medium** (low missed "step already done" 10 times in 10), plan **low** (a medium mayor re-posted work instead of
  waiting), design **medium** (low needed nearly four times the retries). Decision rule: low unless more than 10 points
  below medium.
- 10-10 (s26) Speeding up the time after completion (the user's question): `gamerule random_tick_speed` (default 3; 30
  grows crops, cane, pumpkins and saplings ~10x) set by RCON once a village is complete, `MC_TIME_SCALE=2` for animal
  timers where walking speed does not matter; digging stays on the wall clock (F91). Proposed: an `MCAI_FAST=1` switch
  for the watch and stage scripts in place of `MCAI_RIPEN`; A.8's comparisons use one fixed setting for every variant.
  Minevale37 was stopped at +10.2 after completion (the user's choice: no need to wait out the 30 minutes).
- 10-10 (s26) The user's goals, set while the session ran: 12, then **25 agents doing many different activities in
  parallel**, task chains broken where logical, **more kinds of work** ("research, advanced manufacturing, spell book
  development, and others typical in the game"), and **Project Sid-style emergence** through the brain and
  communication architecture. The user then went away and let Claude decide.
- 10-10 (s26, Claude's) Phase S and Phase E designed by two workflows (two designs judged and merged for S; Sid
  replication, gap, communications and cost analyses for E; three adversarial reviews each; the material in
  `runs/2026-10-10/s26/phase{S,E}_*.md`) and merged with Phase A under one roadmap. Research is read as surveys and
  yield experiments, advanced manufacturing as a workshop of crafting and smelting chains, spell book development as
  the library and the enchanting table (obsidian by lava casting, diamonds from the deep mine); brewing needs a blaze
  rod from the Nether and stays out. Agents beyond Worker4 are named Worker5-24 (whitelisted per world); Paper's
  max-players (16) is raised before 25. Emergence claims rest on ablations and null baselines measured by code.
- 10-11 (s26, Claude's) S.2's departures from its plan text (the spec and its adversarial check in
  `runs/2026-10-10/s26/spec_s2*.md`): `downFails` stays per village (one bot digs the stairs down at a time; counted per
  miner, miners taking turns would retry a blocked step for ever); the busy wait drops from 120 to 60 s (the claim gate
  keeps few waiting, a face frees whenever a holder's trip ends, and the 2-minute wait only kept the loop guard quiet, which
  now leaves busy out); a tunnel's holder leaves its junction's branches to miners already waiting and digs on along the
  main tunnel (`MC_MINE_LEAVE=0` on the agent server turns it off for a comparison run); a waiting miner gets a free branch
  before a new turn; a cell lock where units share cells (a bottom turn's branches and a junction turn's on the same side
  run along each other for 9 cells, not only crossings); an empty trip is one that dug no cell at all, charged to its last
  unit (cells, not items: passing miners pick up drops, and a trip that dug a branch and then failed at once on the main
  tunnel no longer counts against it); "one claim always allowed when the count reads 0" read as no mine task held; the
  face count leaves out a main tunnel whose holder is on a branch; a side of a tunnel that ended is not marked tried while
  a branch on that side is open; the mine answers busy, not "nothing left", while any branch at a dug junction is open; and
  the Mayor's board status names a task held back by the gate or a cooldown instead of "waits for a design". The MINE rate
  baseline comes from the runs' own line (S.1's Van12d/e, 50/51), not Van12a's hand estimate.
- 10-11 (s26) The user's direction: after S.6, focus on the stated goals (25 agents in many parallel activities, agents
  that choose, Sid-style emergence) and stop measuring which number of agents is optimal. The roadmap's revision note
  says what changes.
- 10-11 (s26) The user added two goals: agents propose improvements to the game, which Claude triages (rejects with a
  reason, or accepts and implements), and long-horizon memory for agents, the best mechanism to be investigated and
  implemented (the roadmap's goals note).
- 10-11 (s27) G2, long-horizon memory, started with the user. The user's choices: design for both horizons at once
  (continuous multi-hour runs, and a village that persists across agent-server restarts and days); memory serves all four
  purposes (competence, identity and relations, shared village memory, G1's improvement proposals); **model-managed**
  memory (gpt-oss decides what to keep, through memory tools), which reverses A.4/E.2's "code selects" premise (it rested
  on Qwen3-30B results; every role is gpt-oss-120b now); a literature refresh and an offline memory bench built from our
  run logs, in parallel, before any design. Starting point (s27's inventory): an agent's memory is never saved (a restart
  or respawn wipes it), the model's only memory write is `set_plan`'s notes (replaced each time, planner only), prompts
  see only events not yet shown (30/20, 5 chat lines), nothing summarises; long-lived memory is village-level only.
- 10-11 (s27) E.1's pathfinder allowance is CPU per 50 ms of wall time (`MC_PF_TICK_MS`, default 20), **not divided by
  the time scale** (the spec's wording halved a lone bot's search at 2x: 7.9 ms per 50 ms against 15, measured offline by
  the review), and searches are **not throttled while total demand fits** the allowance: the share only cuts slices
  under real contention. A search's timeout is wall time minus the time the share held it back (the rescue's 5 s search
  stays 5 s).
- 10-12 (s28) The user's answers at the session start (all as recommended): A.2 has **no "something else" option** (it
  comes with A.5's validator); **workers do not choose among board tasks before completion** (after A.8's first
  comparison), so A.2's menu serves idle members of a complete village only and pre-completion harvests stay code-driven;
  G2's bench v2 **waits until the user has read** `docs/research/memory/long-horizon-memory.md`; the five unpushed commits
  were **pushed** (`c5224d6..8f91251`, `tiered-brain-building` only, `main` untouched).

- 10-13 (s28, Claude's) Exploring in instance mode no longer needs a free farm slot (A2f: two starts took both free slots
  and the 8 points left every menu while 21 of 25 idled); single keys keep today's rule, so the golden check and the
  baselines are unchanged. A cloud 429 over the quota is a budget fallback with a 5-minute back-off for decisions. The
  effects of the bucket, the iron pickaxe, digging, the cake and exploring say what they are for (choicebench's bucket and
  cake cases went from 4 and 3 of 10 to 10 of 10): facts written by code are the model's eyes (lesson 2).
- 10-14 (s29) The user's answers at the session start (all as recommended): S.9's room is a **works plot** beside the annex,
  prepared with `prepare_annex`'s machinery, the one place for the works to come (S.11's furnace row, S.14's sheep pen);
  the four s28 commits were **pushed** (`8f91251..5d6f06b`, `tiered-brain-building` only, `main` untouched); `MC_CHOOSE`
  **stays `fixed`** by default until A.3's gauges can measure what the model's choices are worth (F223).
- 10-14 (s29) S.9's scope widened (the user's choice, after the offline count `runs/2026-10-14/count_s9.md`: `make` alone
  would take after-completion busy time at 25 from ~2% to ~2.3%, the goods made once, sand with no inflow, one furnace):
  **make + gathering**: the `gather` family (sand, the village's logs, mine cobblestone) feeding the workshop against what it
  lacks, and three furnaces on the works plot now (S.11's row brought forward, one lock each). The user then went to bed
  and asked Claude to keep building and decide on its own (pushing still waits for the user).
- 10-14 (s29, Claude's, from the spec `runs/2026-10-14/spec_s9.md` and its check) S.9's design: the families sit behind
  one flag, `MC_CHOICE_FAMILIES` (default `make,gather,works`; empty for the golden checks and A.8's baselines), not in
  `MC_CHOICE_INSTANCES`; ranks after every existing kind (works 850, make 900+, gather 950+), so today's order is
  untouched; `make` never gathers its own shortfall (a short input becomes gathering demand for another agent); earmarks
  while a chore is queued; **mud bricks, chests and the stone axe, shovel and sword cut** (mud has no recipe; a carried
  chest becomes a storage chest at every deposit; the tools have no consumer yet); barrel and composter in one wood kind
  chosen by code (the planner chose cherry); `v.tech` recorded at `doCraft` and `smelt`, so every path counts.
- 10-14 (s29, Claude's) **S.9's exit reset** (from "busy agents after completion at least 9 of 12"): the families are
  bounded by stock targets, so the exit counts what they can give: in S9f (25 agents, 2x, 45-min after-phase) `MAKE ok`
  (gains match the bills on the server's counts), 0 requeues traced to make, 0 `[choice-error]`, the works plot with 3
  furnaces and two smelting makes overlapping, **at least 12 distinct agents taking an S.9 chore, a peak of at least 6 at
  once, after-phase busy agent-minutes at least 32** (A2f2 18.8; the spec's estimate 37-47), gathering stopping once
  nothing is wanted. Sustained busy agents need consumers of the goods (lighting, ladders, upgrades), a later step.
- 10-15 (s29, Claude's, the user asleep) **Next after S.9: B.4, light inside buildings and the mine, as the workshop's first
  consumer** (before S.10 or A.3): S9f showed the S.9 families peak at minute ~1 and stop once the stock targets are met;
  torches used up by lighting make `make:torch`, charcoal and `gather:logs` recur, and the mine's lighting recurs as the
  mine is dug. It is one of the user's own village-life items (10-06). Built as an S.9-style menu family (`light`, after
  completion, behind `MC_CHOICE_FAMILIES`); the beautifying plan's open choices taken as recommended (chores after
  completion, not counted in the objective). Spec `runs/2026-10-15/spec_b4.md`.
- 10-15 (s29, Claude's) B.4's departures and exit: buildings are lit by an agent who walks to a stand beside the door
  (outside the building's ring, never a doorway or the cell in front of any door, within 12 of the building; no stand
  straight out from the door, the fix review's M2: 196 of 201 stored buildings get one, 5 fall back to `standSpot`); the
  mine is lit by command from the hut (no walk underground, lessons 35 and 101); mine parts by tunnel, not by unit (a
  unit holds 1-2 spots). **The exit's busy-minute bars were not met** (B.4's own work 5.2 agent-min against 8; the
  after-phase 40.2 against 52): every correctness bar was (61 of 61 standing, LIGHT ok, the demand driving make:torch 6
  times, 10 distinct lighters, 0 requeues). Recorded as is: what fills 25 agents is work that takes agent time and grows
  (lesson 130), which placing by command does not.
- 10-15 (s29, the user's, after waking) Claude's recommendations taken: the session's commits **pushed**; next session
  F228's three fixes and a model-driven run, then **a village that grows** (after completion the Mayor lays out more
  houses on free land, built by the same economy). More furnaces not now (the user asked): S9f and B4f had one 30 s
  furnace wait each (both at the hut, during the build) and the works furnaces none; revisit with the growing village's
  `[furnace]` wait lines (builds could use the works furnaces first).
- 10-15 (s30, the user's, from the count `runs/2026-10-15/s30/grow_facts.md`) **A village that grows**: the count showed
  one extra batch adds only ~2-5% busy time at 25 (4 houses ~26 agent-minutes, ~3.1 a house plus logs; 25 agents build 4
  in 4-5 min) and continuous growth ~20-25% until land runs out (~40 houses on gentle land within 96 of minevale3's
  village, ~80 at slope 4). The user chose: growth **tied to population** (houses grow toward one per member, then stop);
  new houses in **neighbourhoods** (each batch its own small plot found off the village's ground within 96 blocks, signs
  and lamps; postLayout already takes a second plot); the village **stays complete** while it grows (a growing mark lets
  workers claim the growth tasks beside the chores; no extra model calls). Test servers: the test agent server's port is
  now `MCAI_TEST_API_PORT` (default 8767; s30 used 8768 after another program bound 127.0.0.1:8767 mid-run), and
  reset_site.py kills only node listeners.
- 10-15 (s30, Claude's, from the spec `runs/2026-10-15/s30/spec_grow.md` and its check `spec_grow_check.md`: no High, 3
  Medium, 15 Low) The growing village's design: a code chore `lay_out_houses` from the world tick (`growTick`), no model
  calls; neighbourhood pads of up to 4 houses with a cross street (18/19/23/23 by batch, Q2), one layout at a time (Q3),
  prepared whole (Q4); growth tasks are those with ids from the layout's first, claimable while complete; the Mayor takes
  the growth chore, never board tasks (Q5); per-chunk keep-off for sighted plants (Q6); houses only grow (Q7). `MC_GROW`
  off until the 25-agent staged run passes, then on (Q1). The check's fixes taken: the sweep leaves the Mayor out while
  growth is due (M1), the end-of-run metrics limited to the first layout's tasks with a critical path per growth layout
  (M2), stage_runs.py on `MCAI_TEST_API_PORT` (M3), and its Low items L1, L3-L5, L9.
- 10-15 (s30, the user's, during G25) **Farms with the growth, and real hunger now.** Each neighbourhood gets a wheat field
  and its own farm slots (cane, pumpkin, melon where sighted), like the first layout's ("fields plus crop variety"), and
  agents get hungry and eat, in this step ("now, with the farms"; Claude had recommended hunger as a later step). Peaceful
  difficulty never drains hunger, so this means a difficulty above peaceful with hostile spawning kept off, starvation
  handled and an eat chore from storage. Order: finish growth (G25, the fix review's Medium, commit), then live facts on
  hunger in 26.1 before any design (drain per activity at 1x and 2x, the starvation floor, what still spawns hostile with
  `spawn_monsters` false: spawners, patrols, phantoms, wardens; eating and regeneration), then the food count (bread a
  member-hour against a field's yield), spec, check, implement, reviews, runs.
- 10-15 (s30, the user's, after the hunger facts) **Hunger as a village appetite, on peaceful.** Live (`runs/2026-10-15/
  s30_hunger_facts.py`, Gus on easy at 2x): walking ~1,850 blocks cost **no exhaustion at all** (modern Java: walking is
  free; sprinting 0.1 a block, jumping, swimming, mining 0.005 a block and healing cost food), and 26.1 registered no
  sprint from the bot; the hunger effect drained food as expected (20 -> 15 in 10 s). Agents that walk and build by command
  would lose a point or two an hour, so vanilla hunger gives farms no consumer. The user chose a **village appetite**: the
  world stays peaceful (no mob risk; T1/T2's spawner and hostile checks are moot), code gives each member an appetite
  (eat every N minutes of work, from storage: bread, cake, pumpkin pie, melon slices; eggs are not edible in Minecraft,
  only an ingredient of cake and pie), and a hungry member slows or stops taking work until
  fed. Tunable so the fields have a steady consumer at 25.
  Live check for the food spec (`runs/2026-10-15/s30_crop_reach.py`, Gus alone on the test world, 2x, 10 min, single
  wheat cells west of him): ages 2-4 at 32-88 blocks, 1 at 96 and 3 at 104, **0 at 112, 128, 144**: crops grow in chunks up
  to 6 from the bot's chunk (simulation-distance 6) and not beyond, so neighbourhood fields up to ~92 blocks from home grow
  while any agent is at the hut, the mine or the works plot (no forceload or farmer needed).
  Diagonal (`s30_crop_diag.py`, the check's M5): grew at (48,48), (64,64), (80,80) from Gus, not at (88,88) and beyond.
  With the axis run: a cell grows when its chunk's centre is within ~115 blocks of the bot (grew at 103.6 and 115.6),
  not from ~120 (119.6, 126.6): a circle, not the 6-chunk square. Rule for the food step: every field and slot cell within
  96 blocks of the storage hut (Q9's cap, from the hut not from home).
- 10-15 (s30, Claude's, from the food spec `runs/2026-10-15/s30/spec_food.md`, its count `food_count.md` and its check
  `spec_food_check.md`: 2 High, 6 Medium, 13 Low, ready after fixes) The food step's design: neighbourhood fields and up
  to 2 slots behind `MC_GROW_FARMS` (pads 30/27/19 by houses, a pad without a field last); the appetite on the village
  record behind `MC_APPETITE` (both off until the staged runs pass), drained by server game time (check M4) only after
  completion in villages with a planted field, 18 food points a busy game-hour and a quarter of that idle (Q1, Q2), eat at
  12, hungry at 6, no "slower" stage (Q7: a hungry member takes only food work; the user's "slows or stops" taken as
  stops), an `eat_meal` chore at the storage hut consuming food by `clear` (vanilla `eat` refuses at 20/20 on peaceful),
  eating by code without a model call (M2); bread and pumpkin pie as workshop goods (wheat into mcMaterials' GATHER, M1);
  no meat (Q5), no foraging (Q8). The check's High fixes: growHold counts only members the hunger gate lets claim (H1),
  and the fixed-mode sweep goes on past an empty menu when the appetite is on (H2).
- 10-16 (s31, the user's) Development speed ranks ahead of quality: regression checks stay light (offline checks, a
  report that saves reading); no smoke series required per commit, no baselines or thresholds unless asked.
- 10-16 (s31, the user's) The no-edits-during-runs rule is relaxed for runs whose agent server runs from a code snapshot
  (`scripts/snapshot_code.py`; reset_site.py and stack.py start from one by default).
- 10-16 (s31, the user's) run_series.py's staged runs are fast by default: MC_TIME_SCALE 3 below 12 workers (2 from 12,
  where 3x is unmeasured), MC_HASTE 5, MC_RANDOM_TICK 30; "fast": false turns it off. Acceptance runs stay at 1x, vanilla.
- 10-16 (s31, the user's) The food flags (MC_GROW_FARMS, MC_APPETITE) stay off by default for now.
- 10-16 (s31, the user's) Next session: more speed work first (25-agent 3x measurement, a second test world, model runs
  in run_series, the SessionStart hook if approved), then voting with neighbourhood variety, then roads.
- 10-16 (s31, Claude's) Model-call replay matches by agent, kind and call number by default (exact prompts rarely recur:
  positions and times differ); `[replay]` lines show where prompts diverge. Recording is on by default.
- 10-16 (s32, Claude's, from G25x2/G25x3) run_series keeps 2x from 12 workers: 3x at 25 agents grew the same 4 layouts in
  the same wall-clock time (the after phase is bound by work and walking, not the game clock), with more `[stuck]`; the
  load was fine at 3x (no `[lag]`, mspt 2.4 of 16.7).
- 10-16 (s32, the user's) This session's speed steps: 25 agents at 3x, a second test world, the SessionStart hook, model
  runs in run_series; check:offline if quick (it was: 35 s).
- 10-16 (s32, the user's) The vote-topic research goes into the plan with the first vote (PLAN.md, "More variety in
  neighbourhood styles": the ranked list; `docs/research/vote-topics.md`); next research: how to individualise agents
  (personalities that change behaviour).
- 10-16 (s32, Claude's, the user left the placement to Claude) Personalities become A.3p, split from A.3's gauges and built
  right before the first vote: temperament weights in code, a code-written persona line and own-pattern reminder, skill
  from practice; stakes, likes and ballot wiring with the votes. The research (`docs/research/agent-individuality.md`)
  says persona prompts act only on choices without a right answer, which the chore menu and ballots are.
- 10-16 (s33, the user's) A.3p's temperaments: five traits (curiosity, care, diligence, pride and **sociability**, added
  to the plan's four), weights 2.5x / 0.4x (the most- and least-liked kind), persona lines written by code from the traits
  (not by the user, not approved line by line). The stale s15 worktree removed.
- 10-16 (s33, Claude's) Sociability acts per option by how many other members are on the same kind now (2.5^(s x
  min(1, n/2))): sociable members join, loners avoid; by position is later. The fixed pick weighs tw x 0.85^(the kind's
  place in rank order), a meal of lowest rank first, so all-1 weights give today's order; model mode orders the trim by
  lp x tw and a disliked kind (tw < 0.7) gets no reserved place; option lines carry "[you enjoy this]" (tw >= 1.6) or "[you
  find this dull]" (tw <= 0.63). `MCAI_TEMPERAMENT` defaults to off until A.3p's exit (spec runs/2026-10-16/s33/spec_a3p.md).
- 10-16 (s33, the user's) After A.3p part 1's runs (identifiability weak, the model keeping the tilt): temperaments on by
  default (`MCAI_TEMPERAMENT=on`; the goldens set off themselves) and on to the first vote; skill from practice (A.3p
  part 2) later, when longer runs can show it.
- 10-16 (s33, the user's) Richer activities and automated learning of them: Claude's design (activities and projects as
  validated data, a gated skill foundry with external coding agents on test world 2, an outer metric loop) written up as
  `docs/research/self-improving-activities.md` and added to the plan as Phase X, after the first vote.
- 10-16 (s33, the user's) Phase X.3's foundry uses the Claude Code CLI (`claude -p`, headless), billed to the user's
  Claude subscription (no API key; the foundry caps turns and time per ticket), and the user approves every merge (gated
  work lands on `foundry/<ticket>` branches with a report). Installed by Claude the same day (`npm install -g
  @anthropic-ai/claude-code`, 2.1.301, `C:\Users\rhett\AppData\Roaming\npm\claude`); it shares the extension's login
  (a headless test call answered).
- 10-16 (s34, the user's) Phase X.1's scope: the workshop from the recipe graph and decoration that uses goods up come
  first (forestry, more crops and animals later); catalogue goods keep giving work through consumers in the catalogue
  (furnishing, food, the reserves' gathering), not stock targets alone (lesson 130); members' live spec authoring waits
  for X.2, with proposals (X.1 delivers the format and its validator).
- 10-18 (s35, the user's idea and choices) Two levels of public works: besides the big works the whole village votes on,
  **initiatives**: a member starts a small work of its own ("who wants to help me build X?") and others join it, no vote.
  Anyone may start one: "Start something of your own" is an option on an idle member's chore menu, weighted by its
  personality like any chore (no threshold in code), with a cap on initiatives open at once and one a member. An
  initiative **starts at once with its initiator alone**; others join along the way from their menus ("Help Worker7 build
  a fishing hut"). Who starts and who joins whom is recorded (the social ties).
- 10-18 (s35, the user's) Initiatives build **small works designed by code on the village's own ground** (wells, benches,
  market stalls, woodsheds, statues, lamp paths...: 3x3 to 7x7, off streets, doors and farms), not single vanilla buildings
  on their own pads (17 fit a house's budget, 1 in plains, and room ran out after ~10 layouts, F243).
- 10-18 (s35, the user's) Direction: move as much of the village's work as possible into the three tiers members decide
  (individual chores, voluntary initiatives, voted public works), so the civilisation grows from needs; growth beyond
  ~25-30 agents through a second agent-server process (Paper has headroom), and a population that grows through vanilla
  villagers rather than more bots. Written into PLAN.md as Phase N.
- 10-18 (s36, the user's) **Batch development before live tests**: several steps are built behind their own flags and
  verified offline (typecheck, checks on checkpoint records, menu checks, model replay), then tested together in one run
  series with on/off runs per flag on both test worlds; the next step is developed while a live run goes. Live runs stay
  for walks, digs, placing and load, and before a step is called done. In CLAUDE.md "Testing agents".
- 10-18 (s36, the user's) **N.1's need vote waits for N.2/N.3**: N.1 measures needs, shows them, puts need facts and
  per-member weights on the menus and detects escalation (logged as ignored, blocked or no answer yet); the vote comes with
  the concrete works that answer needs (a storage room, a furnace room, a street of houses), since today any chore that
  answers a need is taken at once by idle members (spec_needs_v1's check, M1).
- 10-18 (s36, the user's) **The foundry gets a second back-end: the Antigravity CLI** (`agy -p`, headless), on the
  user's Google AI Pro subscription, beside the Claude Code CLI (`foundry.py --cli claude|agy`, same gates, branches
  and merge approval). The CLI, not the Antigravity IDE (its window cannot be driven reliably), and not Gemini CLI (it
  stopped serving AI Pro accounts on 2026-06-18; Google points individuals to agy). Headless agy uses the credentials
  cached by one interactive login, which the user does; running the official binary as a child process is the
  supported use (reusing its tokens elsewhere is not). Tool approval through scoped `permissions.allow` rules rather
  than `--dangerously-skip-permissions`.
- 10-18 (s36, the user's) After N.0/N.1: **N.2 housing and N.3 storage and furnace rooms specified and built together**, as
  one batch tested in one combined series (storage was full in every s36 run: 9 of 9 chest spots). **Initiatives gather
  their own materials** (the crew gathers the bill; storage stays for the workshop and public works: crews formed only when
  something was short, ~4 joins a run). **Greens grow with the members**: one per 5 members.
- 10-18 (s36, the user's) **The next batch is N.2 housing plus storage fixes; storage and furnace rooms wait** for a
  measured need (s36's surveys: storage 99 of 216 slots used, only the misc chests full, of leftover building parts;
  furnaces never all held at once, no make refused for them). Storage fixes: the gauge counts slots, not chests; misc
  overflows into empty group chests; **leftover parts reused** (builds, furnishing and initiatives take matching parts
  from storage first), **wooden parts burned as furnace fuel**, a **"parts" chest group**; **nothing discarded**. The
  batch is done in a new session.
- 10-18 (s36, the user's) **Workers get human first names as their real usernames**: the bots log in as names from a pool
  of 50 (`server/src/agentNames.ts`, all whitelisted on every world), replacing Worker1-24; scripts, specs and checks read
  the pool. The Mayor stays Mayor and Gus stays Gus.
- 10-18 (s36, the user's) **The foundry (X.3) starts now, in its own session, and defaults to the Antigravity CLI**
  (`foundry.py --cli agy` the default; `--cli claude` the alternative), on its own test world 3.
- 10-20 (s41, the user's) **Foundry candidates merge without the user's approval** (replacing s33's "the user approves
  every merge"): a candidate that passes every gate (scope, typecheck, check:offline, review, live, series) is merged
  by the session into `tiered-brain-building`, never into main; pushing still waits for the user's yes. Also s41's
  order: the make/gather gap and open-ended demand first (route a), then members' proposals feeding foundry tickets
  (routes b and c combined: a proposal doable with existing skills goes on menus, one needing a new action becomes a
  ticket).
- 10-20 (s41, the user's) **A barter economy between members, for starters, linked to the foundry** (#12): personal stock,
  personal wants from code, offers on a board; unmet wants (no skill makes the good) become the foundry's wanted list,
  ranked by what members offer. A bank with currency and loans is a later variant to compare. Order: the activity runner
  and the fishing ticket first, then the barter ladder.
- 10-20 (s41, the user's) **What drives foundry tickets: the adjacent possible, needs with no answer, members'
  endorsement**: code lists the items one new action away (from the recipe graph and game data, ranked by what each
  unlocks) and the needs no existing work answers; members endorse among them (the vote machinery, temperament); a
  candidate becomes a ticket only when its demand persists (won twice, or a need unanswered for an hour). Barter's unmet
  wants (#71) join later; free proposals (#13) are a supplement. Parallel foundry runs (#72) wait until tickets come in
  numbers.
- 10-20 (s41, the user's) **A sales levy once members hold their own goods** (#68): a member selling to the merchant
  keeps the proceeds less a levy (VAT-like, taken by code at the sale) paid to the village's shared storage, the
  treasury; a fixed default first (~20-25%), later voted (#33). Member-to-member barter untaxed at first (a levy in kind
  is awkward; watch for barter to dodge it). Until #68, emeralds are the village's, in shared storage.

- 10-20 (s42) **The `activities` family and `MC_MERCHANT` on by default** (the user's question at the session's start:
  after a run with the purchase fix): Stg2 bought only what the village uses, and Stg3 ran on the defaults alone (busy
  21%, no errors, the library loaded).
- 10-20 (s42, the user let the session decide) **The simulator is validated before it is used**: after v0's first
  experiments (the buy rule, a pumpkin offer, merchant orders) rested on 10-hour projections it could not support, the
  session went back to fidelity: the public works and the task brain in the sim, a prediction written before a 90-minute
  real run (Lng1), validation against the spread of several runs. The pumpkin offer was taken out (Stg3 sold none);
  merchant orders stay in the code, off by default, untuned, until the sim holds over long runs.
- 10-20 (s42) **The simulator runs the run's own growth, works, housing and votes** (votes predicted: code, never a model)
  with the members' TaskBrain; `--v0` switches them off as v0 ran. It is in check:offline (20 minutes).
- 10-21 (s43) **The village grows past its land limit by a wider reach** (the user's choice of three: a wider reach,
  harder land, a second settlement; the rejection counts said reach: taken 19,422 vs wet 446 and steep 213). The user
  then left the session to decide overnight. **VILLAGE_RANGE 96 -> 144 by default** (MC_VILLAGE_RANGE; growth's reach 16
  inside it): Rch1 and Rch2 held 17% busy to minute 90 vs Lng1's 9.6% collapse at 40, with few stalls. 192 stays a
  setting: Rch3 (before build_design's walk) collapsed to 7.9%, Rch4 and Rch5 (150 min) were 16% and 13.3%, no better
  than 144 within 150 minutes; the sim says 192 pays off only after ~90 minutes. **MC_GREENS_PER stays 5** (Rch2: per 3
  changed nothing at this reach). **MC_WORKS_REPEAT off** until a run outlasts the pool (~26 works). A wider reach only
  postpones the limit (sim: 144 runs out at ~90 min, 192 at ~120, then the pool): the second settlement is drafted as a
  spec for the user (#76, runs/2026-10-21/s43/spec_second_settlement.md).
- 10-21 (s43, the user's) **Innovation: a library of locked skills, unlocked by members' experiments.** The foundry fills
  a library offline, ahead of time (skills written, gated and merged but locked); a running village never waits on code
  generation. Villages unlock library entries by experiments: idle members (the curious first) spend time and materials
  trying a candidate, succeeding with some chance; candidates come from the adjacent possible (recipe graph and library
  entries one step from what the village has, #73 part 1) and from unmet market wants (lapsed barter offers, wants nobody
  fills, #71). Measured in the sim first: new goods an hour, who invents, how techniques spread, late busy. Builds on F264
  (the economy gives reasons to trade, not work to fill idle time).
- 10-21 (s43, the user's) **The economy ladder built in the sim, each step the user's pick:** personal stock (a fixed 25%
  share of new goods, a real chest in each house, wants as facts and own stock spent first), own makes, barter (code
  drafts offers, members accept from menus, prices drift, a notice board by the hut), specialists by claimed plots (after
  habit and price weights did nothing), members' sales to the merchant with the 25% levy (emeralds a good on the board),
  own farms of four kinds chosen by price, lack and how many stand. All behind flags, off by default; tested in the sim,
  then one live pair (Eco1/Eco2). The second settlement (#76) parked by the user for the economy.
- 10-21 (s43, the user's) **Innovation: experiments pay with commons materials, members pledge goods or emeralds, the
  inventor collects the pledges.** Next (the user's, for s44): unlock cost from complexity (the recipe chain's steps,
  inputs, tools) and benefit (the value of what it opens, wants and gluts), as research points that several members add
  to (credit and pledges split by contribution), with prerequisites (a tech tree); and **life goals**: a goal per member
  from its temperament (wealth, invention, mastery, standing, home, and **beauty: art, creativity, the look of the
  village**, the user's addition), progress measured by code, shown on menus and weighting options.
- 10-21 (s44, the user's) **Innovation v2: research points from complexity; demand speeds research.** Points needed =
  10 x complexity (code, from the recipe data); wants, gluts and pledges raise each attempt's points (to 2x) and rank the
  entry up, instead of the brief's +benefit/10 (necessity should speed invention, and benefit was under 10% of the cost).
  Entries started or wanted on everyone's menu, untouched ones for curious members only; iron taken only on a good roll.
  Library: shears (after iron tools) -> jack o'lanterns (a carve step by command); campfire stays out (the planner picks
  coal). **Inventors' royalties:** 10% (MC_TECH_ROYALTY) of every batch of an entry's final goods, split by all points at
  the unlock, attempts' and pledges' (pledges capped at half the need, so funders hold at most half), owed as own stock's
  shares and carried home. Next: life goals (#79), whose invention goal is what should carry research past demand (F266).
- 10-21 (s44, the user's) **Life goals: gw 1.6 (to 2 when behind), exempt from the rank decay, product capped at 6.25;
  a capped draw with every goal present, fixed for life** (drawn at completion, not at spawn: agents spawn one at a time).
  Kept beside the spec's rev. 10: innovate options carry both curiosity's ww and gw (the cap bounds them; without gw the
  invention goal had no pull). **The panel's economy views** (the user's request): an Economy tab on the village card
  (members' wealth richest first, the board, inventions, goals), an Economy card in the simple view (the ten richest), a
  wealth line on each agent card.
- 10-21 (scorecard session, #80) **The scorecard's definitions** (the session's, within the brief): busy is an action
  running (the sim's busy bins and run_report.py's BUSY line), chore busy (the choice log) beside it and used for the
  verdict when a live run lacks the BUSY line; needs met is the mean of the welfare gauges' shares met (food, housing,
  light, furnish; storage and mine are capacity, left out); a level's hour is its mean, a counter's its sum; the collapse
  minute is where the 30-minute mean falls under half of hour 2's for good, the decline where it falls under hour 2's mean
  for good; no verdict under 3 hours. The sim samples `server/src/scorecard.ts` every 10 minutes (reading only); the panel
  samples it a minute from the agent server's first request. A live run's missing measures are named, not filled in.
  **Open, for the planning session:** the pass mark against hour 2 passes today's default (F268: the collapse falls in
  hour 2); against hour 1, the peak hour or a floor (busy 10%?) it would fail. The scorecard prints the hour-1 ratio,
  not judged.
- 10-21 (the user's, through the planning session) **The pass mark revised:** a collapse is any hour after the first whose
  busy falls below half of hour 1's; needs met leaves the verdict until it has a definition that can move (it sat at ~0.97
  in every baseline run). scripts/scorecard.py and the panel (scorecardView) judge it alike; trends now read the last hour
  against hour 1. The baseline fails 6 of 6 at minute 80-90 (F268).
- 10-21 (M2 spec session, #4 #6 #81 #44 #75) **M2's core loop, the user's choices on the spec**
  (`runs/2026-10-21/m2-spec/spec_m2.md`, each as recommended): residents stay unemployed while the day is frozen (the
  furniture leaves out composters, barrels and grindstones with residents on; F269: employed villagers never breed at
  noon); resident beds as lodgings in members' houses first, then cottages; a founding pair summoned by code, then births
  only (no immigrants); a code-kept pantry appetite for residents (4 points a game hour); shears made wanted by the beds
  gauge (and raw iron with them) plus a small `requires` on the bed chain in #66's shape; day and night behind its own
  flag after beds, the night skipped once the members sleep (its mechanism below); at most one iron golem a village; the rest of M2 in the order works that grow (#75), upkeep
  (#44), decoration (#45 #46 #48 #49). After the read-only review, also as recommended: residents pick up nothing and
  never farm (code puts their food in their inventories; with pickup, births would leak past the code's gate); iron stocked in the
  simulator's M2 series until it models the mine's iron (shears, so beds, need iron); the night passed by code once
  every member is home or 3 minutes after dusk (vanilla's sleeping percentage fails once residents take members' beds).
  Beds are one pool (the game's rule, not a choice). **Open:** upkeep's wear model (visible weathering or a counter), at
  that step.
- 10-21 (works-grow session, #75) **Works grow as refits of the standing buildings** (the user's, two choices): with the
  population parked and the probes showing land (public works) and a people cap (greens) as the limits, the user chose
  **upgrades in place** over growing with buildings, stock or annexes; a larger variant then fitted on 0 of 26 buildings,
  and the user chose **same-footprint refits** (tier 2 stone, tier 3 timber and a stone roof) over adding a storey or
  falling back. MC_WORKS_GROW (off); the brief's files plus `mcBuild.ts` (build_design accepts a refit over its own
  building) and `village.ts` (`Structure.tier`). Also the user's: procedural architecture and settlement layout (GDMC
  methods, split grammars) to consider later, filed as #84 (Parked). **Open** (the planning session's): whether
  MC_WORKS_GROW and MC_WORKS_REPEAT go on by default (both together miss the pass mark by one hour, F270).
- 10-21 (g1-memory session, #26) **G1's memory: model writes ride on decisions and a nightly call** (the user's, four
  choices after the spec and its adversarial check): members write notes from their chore decisions (`remember`, one a
  call, three a member-day) **and** each member with chores makes one reflection call a village night (up to 2 notes and
  tomorrow's intention; the user's pick over the recommendation of decisions only); when the 8 notes are full the model
  names one to replace and code replaces the oldest if it does not; a 20-minute village day; the village's day line in
  prompts now. MC_MEMORY and MC_CLOCK (off). Departures from PLAN E.2: `reset_site.py` untouched (a spawn with reset
  begins a run and empties the member's memory instead), the kind table keeps counts and minutes but no per-item yield.
  **Open** (the planning session's): whether MC_MEMORY and MC_CLOCK go on by default.
- 10-21 (g6-loop session, #73 #71 #16) **G6's loop: the wanted list picks the ticket, members research what comes back**
  (the user's, four choices after the spec, each as recommended): the first village-made ticket is whatever the wanted
  list ranks first and ticketable (predicted and found: honeycomb from bee nests), not a pick; the foundry's merge needs
  only the candidate's own files clean in the shared checkout (other sessions' uncommitted work elsewhere no longer
  queues it; fast-forward only, never main, never a push, and a typecheck of the main checkout after, logged); the
  after-merge run stocks 2 shears (as LSc1 stocked rods) rather than researching shears first; with MC_WANTED on, a
  locked entry whose capability is in the village's wanted top 3 counts as demanded (offered to every member, not only
  the curious: F266's shears gap). Claude's, after the adversarial check: a merged research activity is locked in code
  (a `research` block on its library spec, registered by loadLibrary while MC_INNOVATE is on, not loaded while it is
  off), and the wanted list keeps it as `locked` until researched.
- 10-21 (g2-social session, #27 #28 #29 #17 #86) **G2's social perception, acts and skill behind flags** (the user's, four
  choices after the spec, each as recommended): `MCAI_SOCIAL` defaults to `legacy` (today's prompts byte-identical; runs
  name their arm on, noblock, countsonly or off); a line said is delivered by code to members within 16 blocks and shown
  by tellraw ("Ada says: ..."), never bot chat, so no brain wakes on it; acts are about what a chore end can settle only
  (an item a gather or make option names, a step on a project); life goals off in Experiment 1's arms. Claude's, after the
  adversarial check (runs/2026-10-21/g2-social/spec_check.md): the arms differ only in social perception (the intention's
  weight and the quick-failure rule under their own MC_CONTROLLER, on in both arms; (b2) runs MC_ACTS=off, and MC_ACTS=on
  with off refuses to start); `off` leaves names and others' activity out at the source (help, light, furnish and trade
  options unique by place or offer id); a promise is one chore, kept by a productive chore of its option started after it
  (or running when it was made); acts offered once in 3 model decisions with flat fields; a member reports only promises
  it was party to or heard of. Claude's, the user away overnight (10-21): Experiment 1 runs with MCAI_TEMPERAMENT=off in
  both arms (A.3p's sociability weight reads how many others are on a kind, a channel of social perception (b2) would
  keep) and with skill off (a non-social driver of specialisation that could mask the contrast).
- 10-22 (g5-proposals session, #13) **G5's design, Claude's, the user away overnight** (the planning session's brief):
  proposals come from the night's reflection, at most one a member-night, offered only on nights with a reason code can
  see (not from the 90-second decision call: gpt-oss fills optional fields it is offered there, F273); five kinds
  (activity, item, work, rule, fix); code answers outright only what it can settle (impossible in this world; already
  possible for item and activity proposals), and everything else goes to a headless Claude Code triage (`claude -p` on
  the user's subscription, no tools, settings or MCP servers, an empty folder, members' words as data) whose verdicts code
  guards (never accept what code found impossible; the user's calls and config changes deferred to the user; the foundry
  only for a ticketable capability); duplicates count as endorsements; two backers, a fix seen 3+ times or a capability
  in the wanted top 3 sends a proposal to triage; verdicts reach members as a pinned memory line and an inbox report
  (hooks after G2); accepted ones go to `accepted.json` for the foundry's queue (a hook) and to issue drafts, none filed
  automatically. MC_PROPOSALS (off). **Open** (the user's): the five deferred proposals (farm and works radii, plot
  reservations, an automated coop), and whether triage may file issues itself.
- 10-22 (G3 spec, written by the g5-proposals session for the planning session, #30, #1, #33) **G3's design, Claude's,
  the user away overnight** (spec only: runs/2026-10-21/g3-rules/spec.md, its adversarial check folded in): the levy is
  answered on members' own model decisions (a `share` field after sharing chores, amounts only, shuffled; fallbacks never
  answer it), not by menu variants (own:carry is chosen 1-6 times a run and the fixed pick takes "keep"); a run is valid
  when failed model calls stay under 5% (E's 5%-fallback rule cannot hold at 25 members: 26-32% today, mostly the rate
  cap), a departure from E's protocol; Experiment 2's day-2 levy item is code-placed (claim: ratification, as Sid's tax),
  a departure from E.9, with matched arms (influencers and the announcement in the imposed arm too); village rules are
  proposals of kind `law` (G5's `rule` stays the user's config requests); quota and floor never block meals, carries or
  builds; duty is tagged and measured, not forced (a departure from E.6); no meeting walks; one ballot call a member at
  its own offset over dusk and half the night; the need vote's trigger is `ignored` (a `no answer` need has no answer
  to vote on). Order: after G2 lands. **Open** (the user's): whether 5 vs 5 is enough for a predicted 0-10 point effect.
- 10-22 (g6-loop session, #89 #91) **Claude's, the user away overnight (10-21):** (1) #89's demand as members' life-goal
  wishes kept by code, not barter wants (members' own chests were empty, so offers had nothing to pay with); (2) #91's
  second template (amethyst) not built: live, `collect` dug to a geode's shell and found no path to the clusters, so it
  needs a new tunnelling skill, a bigger ticket than a template; (3) the wool ticket finished with the Claude Code back-end
  (`--cli claude --gates-only`, the user's s33 choice of back-ends) after agy's plan quota ran out mid-ticket ("resets in
  81h"), keeping agy's three files and letting Claude's repair rounds add the rest.
- 10-22 (G4 spec, written by the g5-proposals session for the planning session, #31, #34) **G4's design, Claude's, the
  user away overnight** (spec only: runs/2026-10-21/g4-culture/spec.md, its adversarial check folded in): a seeded
  saying's token is an invented word found in no prompt or output of G1a, G2a and LSc1 and in no menu template ("light"
  and "torch" are in 96-98% of decision prompts); customs are added only to decisions that go to the model (never the
  fixed pick, repeats, rate fallbacks or one-option menus), and Experiment 3's primary is their rate per model decision
  where shown (E.10's uptake share would sit near the ceiling by chance; a departure from E.10); committed members'
  sayings are delivered by code (`say` is offered on 1 decision in 3 and dropped when the pick does not run); neutral
  exposure replays a finished k = 4 run's delivery log; customs are a 32-spot shrine ring and a door lamp post (no flower
  pots: no clay; a departure from E.7's examples); adoption is counted three ways (echo, retained, spontaneous) from
  tagged prompt parts; names only at night, bound to a code-offered place; G3's meetings off in Experiment 3; its sample
  size set from a pilot (8 a side if the base rate is under 8%). Order: after G2 and G3.
- 10-22 (the user's) **The foundry's agy model is Gemini 3.8 Flash high** for writing and review (`scripts/foundry.py`'s
  defaults and `foundry_queue.py`'s new tickets), in place of Gemini 4 Argon high: Argon's quota ran out on 10-21 (resets
  ~10-25; Flash high and low still answer). The five earlier tickets keep their recorded model. Flash has not written a
  ticket yet: watch its repair rounds and the gates on the first one.
- 10-22 (motivation spec, written by the g5-proposals session for the planning session; runs/2026-10-22/motivation/spec.md)
  **The user's choices (AskUserQuestion):** needs that bite = own food and own tools (not house wear, not an account
  commons); ambitions = the member picks one of 2-3 code ladder branches for its goal at night (over the recommended
  fixed ladder per goal); the village ambition = a ballot of all members at the start among 3 staged goals; the test = a
  pilot first, then the experiment's design. **Claude's, after the adversarial check:** every ladder step names the
  option or act that advances it and is skipped (with the reason shown) where the run offers no path (own-house furnish
  options were 0 in G2a's 1,359 menus; trades 0); a separate step weight (1.3, inside the 6.25 cap) beside the goal's,
  and repeats honouring weights; measures split by who decided; the experiment recommended after the pilot is M1,
  ambitions alone against off, 5 vs 5, primary "projects carried across days" with shadow ladders in the off arm; G3's
  validity rule (failed model calls under 5%); own-food eating exempt from bans, tools delivered to their askers; the
  village ambition counted from delivered goods and built parts on land reserved at the start (pledges never reached
  live menus); titles off in Experiment 1 and 3 runs; the build after Experiment 1 and after G3's Experiment 2.
- 10-22 (character v2 spec, written by the g5-proposals session for the planning session; runs/2026-10-22/character/spec.md,
  research docs/research/character-model-v2.md) **The user's choices (AskUserQuestion):** redraw all six HEXACO traits
  for every member (over the recommendation to keep today's five and add honesty-humility and agreeableness); mood as
  code-summed thoughts with weights and one line; energy with rest at night only; life goals drawn from values (over the
  recommendation to keep goals from temperament). Persona lines and goals therefore change at v2: findings before it
  describe the old members, and a checkpoint's stored goals are redrawn at a v2 run's first sweep. **Claude's, after the
  adversarial check:** the layers beyond temperament multiply into one factor clamped to 0.67-1.5, and with any character
  flag every option's product is capped at 6.25 and floored at 0.16; roles, titles and achievements only with roles shown
  (E.8's (e)); `MC_CHARACTER` off = E1's settings (temperament, skill and goals off), on = all three on, expanded by the
  launcher, contradictions refused; honesty-humility measured against the model's temptation choices, not levered (0
  broken promises in E1's 106; the levy is a model-only field), agreeableness levers request acceptance; likes deferred;
  competence and autonomy measures only, belonging folded into extraversion; mood never levers help; values half
  independent of traits, standing from self-transcendence, self-enhancement-dominant members capped at 25%; measures split
  by who decided; `character.ts` built offline first, wired after Experiment 1, the motivation build and G3's.
- 10-22 (character v2 spec, addition; the user's through the planning session) **Experiment 1 cancelled and
  Experiment 1b dropped; the panel is part of the spec.** Character v2 goes straight to build and test in G2's files:
  offline checks, a staged run at 25, then two 2-hour model-driven runs back to back on the same build with
  `MC_CHARACTER=on` and `=off` (descriptive measures, predictions marked pass/fail). **Claude's, after the second check
  (spec_check2.md):** the per-member series and affinity snapshots live in memory and a separate `character.json`
  written once a minute and cleared at a new run (not social.json, rewritten twice a second, and never in checkpoints),
  sampled every 60 s / MC_TIME_SCALE from the world's start; three routes (`/api/character?village=`,
  `/api/agents/:name/character?since=`, `/api/character/series?village=&since=`), the matrix only on request; the views:
  Members -> Character (absorbing Mind's Persona and Chores' Temperament), affinity in Members -> Social, Society -> People
  and Relations, an Overview mood card, the flags in Run -> Flags; mood's items called feelings.
- 10-22 (the user's) **Model temperature stays 0.4** (`MC_TEMPERATURE`, default 0.4): charbench's 0.4 against 1.0 on
  G2a's rebuilt character prompts showed no real difference (valid 120/120 vs 119/120, distinct picks 2.75 vs 2.83, most-
  weighted pick 0.25 vs 0.26, say-do 0.86 vs 0.87). Temperature is not a character lever (docs/research/character-model-v2.md).
- 10-22 (G8 ladder spec, written by the g5-proposals session for the planning session; runs/2026-10-22/ladder/spec.md)
  **The user's choices (AskUserQuestion, all as recommended):** iron fixed as the first rung, ballots after; leather for
  books bought from the merchant (no culling); the iron age's last stage counts iron tools issued to members; the Nether
  kept as the top rung (peaceful probed: blazes, endermen and every hostile mob cannot be summoned, so no brewing and no
  End; piglins, hoglins, striders and shulkers can). **Claude's, after the adversarial check:** the iron rung sized to the
  measured supply (2.66 raw iron a trip over 200 trips; a level ends at 12-25): 600 cells dug, 30 raw iron, 24 ingots at
  the works furnaces, 10 tools issued, with new iron levels opened as each finishes and per-leg locks for up to 3 miners;
  forge options name a recipient whose work needs the tool, delivered to it, and members use their own tools first;
  the blast furnace moves to the copper branch (`smelt` takes a plain furnace only); the rung ballot is a `vote.ts`
  topic, not G3's law council; `ladder.ts` holds rungs, prerequisites and typed needs (have, hand build, ticket) and is
  the motivation spec's village-ambition engine; enchantment starts at 8 levels; specialisation over the iron kinds
  judged against a permutation null on model picks.
- 10-23 (the user's, through the planning session, after IM1/F289) **G8's stages count from the rung's start, not each
  from its own:** every counter (cells, raw iron, ingots, tools given) runs from the rung's start and the stages end in
  order, each once its total reaches its target, several at once when the work is already done. This revises draft 2's
  minor decision. Reason: the village digs, smelts and forges at once. In IM1, 18 tools given and 16 smelts before stages 3
  and 4 began counted for nothing, and every target was met by minute 46. Also, with MC_WORK_BLOCKS, a member's model
  decisions are at least 30 s apart, not 90 (CHOOSE.minGapMs). A member inside the gap with nothing of the same kind waits,
  rather than take the fixed pick. Only decided choices open a block: the model's, the scripted controller's, or the fixed
  pick in fixed mode. IM1 had 421 rate fallbacks against 168 model decisions.
- 10-23 (the user's, G3) **Laws: the same rule proposed again joins the open one; one open law a member; the open laws
  listed first, most backed first.** Long1's rate with the reader fixed would be ~22 laws a night. A join needs the same
  type and target with numbers within half again; laws that already have their 2 backers are not listed (the adversarial
  check's bandwagon point).
- 10-23 (the user's, G3) **A new rule type, `contribute`**: each member puts at least N of a class (logs, torches, tools,
  food, stone, any goods, or a list) into storage a day, measured from the server's storage flow per member-day, its options
  tagged and ranked first until met. Members' commonest law in Long1 (96 of 238).
- 10-23 (Claude's, G3) **Zones gate new siting only** (growTaken, annexSpot, smallBlocked, plan_layout), not every build
  claim (village.ts conflictOf): a zone voted on a neighbourhood would otherwise fail its planned houses again and again.
  **The ballot shows code's stake line** for each member (F299). **The need vote's choices are shown in each member's
  own order** (position bias 2x, F299).
- 10-23 (the user's, Experiment 2) **Sized as a vignette bench plus 5 voted vs 5 imposed live runs; then, after the pilot
  and the bench showed the measure at ceiling (F300), reported as a ceiling with no live runs.**
- 10-24 (the user's choice 3 of 10-23, #107) **PLAN's design rule 2 changes: a member's question starts the addressee's
  own answer call** (MC_QUESTIONS). Its safeguards keep the rule's guarantee against lesson 4's storm without limiting
  calls: an answer is plain words with no tools, so it can neither ask nor tell (depth 1); a question to anyone goes to one
  answerer code picks; answers run in the gate's low class and never take the last slot even with MC_LLM_LIMITS=off; the
  budget turns them off at 85% (after reflections, before acts); they are billed to the asker and count toward no
  decision gap or cap; they are shown a village day.
- 10-24 (the user's choice 2 of 10-23, #107) **News passes attributed and unchecked** (MC_NEWS): code tags each line
  checked, refuted or unchecked for the measures and refuses none of them; a retelling carries its first teller and is
  not passed on again.
- 10-24 (Claude's, #107) **News and questions are offered with the acts** (the acts' cadence: every decision under
  MC_LLM_LIMITS=off), delivered whether or not the pick ran; **the holdout draws per message, seeded by its id**, and an
  answer is withheld after its call is made (the would-be answer is then known); **the small fixes ride behind their own
  flag** (MC_ACT_FIXES) so the goldens stay; **the second wording of the news and question lines** (talkbench: news in
  1-3% of replies with the first, 3-4% unprompted and 12-26% retelling a told shortage with the second).
- 10-24 (Claude's, #107) **Deliberation's zero-cost form shows a later voter at most 4 earlier reasons an item, the
  latest 2 of each side**, attributed with the side ("Dev (against): ..."): the ballot stays secret as a tally, the
  reasons are what members said before voting.
- 10-24 (Claude's, #111) **The levy owed the commons (payments' and merchant_own's) is written into a storage chest by
  command and counted**, one list element a read (`data get block ... Items[i]`: the whole list's reply is cut short past
  a few stacks); **a bounty's emerald is taken from the commons above the merchant's keep (one of each used sold item
  kept), else minted**.
- 10-24 (the user's, G8 #21, the letters spec `runs/2026-10-24/letters/spec.md`) **The letters rung as recommended**:
  its new skills are written by hand behind MC_LETTERS (the foundry stays parked until the enchantment rung's cast
  obsidian); leather from the merchant plus fishing's trickle (no cows, no culling); the first library is
  plains_library_2's own 4 shelves and lectern plus the enchanting table's book (16 books: 48 cane, 16 leather); the
  first cane is bought from the merchant, not searched for.
- 10-24 (the user's, #5) **A second agent-server process, when needed, is a brain/body split**: one village process keeps
  all shared state and the model gate and makes every choice; body processes (~12 bots each) run the bots, walks and
  skills and call the village over a local socket. Not a shared store with locks. Worker threads for pathfinding come
  first if the event loop is ever the limit; at 25 it is not (0 [lag] lines since 10-23).
- 10-24 (the user's, home basics `runs/2026-10-24/home-basics/spec.md`, MC_HOME_BASICS) **Every member's house gets a
  bed, a chest and a crafting table early**: three cells per owned dwelling (buildingDecor's `basics`, ahead of the
  furniture), set by command and charged to storage (table 1 log, chest 2 logs, bed 3 wool of one colour + 1 log or a
  stored bed). **The bed's wool**: when storage has none, the owner's own chore "Shear wool for your bed" (shears from
  storage, else made from 2 of its iron first; 3 wool of one colour sheared at the atlas's sheep). **With MC_OWN off the
  chest is a plain chest**; with it on, it is the member's own chest (any own chest placed before counts). #81 (shears
  wanted) closes into this; #6 stays parked, re-scoped to the day's rhythm.
- 10-24 (the user's, after test train 1, F312) **MC_STORAGE_GROW, MC_HOME_BASICS and MC_PROMPT_SELF on by default**
  (d9f9815; `=off` turns each off). **The shared-files queue:** #134's fix (cane buying, the early market stall), #136
  (the pad halo), #97, #122, #84's per-building layout step (a), #115, the combined model-driven run, then #84 (b), (c).
- 10-25 (the user's, after the monument research `runs/2026-10-25/monument/report.md`) **Start the monument on the
  recommended approach**: Notre-Dame de Paris at 1:2 (~20k blocks) as the first target, the same grammar at 1:4 as the
  first live test; a code-drawn Gothic split grammar (the model picks the reference and parameters, never geometry);
  phases M0-M4 behind MC_MONUMENT, MC_QUARRY, MC_GLAZING (off); the village votes for it; at most ~60% of the menu; no
  /forceload for now; the default palette. M0 (the grammar, offline) first, M1 after #142 frees mcWorld.ts.
- 10-25 (the user's, during M0) **The monument has no vote**: it starts by itself once the village completes the iron
  age, and its tests start from a checkpoint saved at the end of the iron age (#144, #146, #148). M0 done (c0845e6,
  #143): Notre-Dame 1:2 bills 7,773 blocks in 26 jobs, ~0.6x the research's shell estimate, so its hours are upper bounds.
- 10-25 (the user's, after test train 5, F321) **MC_PEN_VARIETY on by default** (#139: varied pens on a 25x13 annex,
  sheep, pigs, rabbits and goats; breed_pen 54 against 12, shear_pen ran; `=off` gives the classic pens). The choice
  golden pins it off. MC_FLOWER_MIX stays off until #140's fix; MC_POLICY_OPTIONS waits for the confirm run.
- 10-25 (the user's, after the confirm run, F322) **MC_POLICY_OPTIONS on by default** (#122 with #142's fixes: busy
  77.8/71.7% against 78.5/61.8% in hours 1-2, 192 against 99 initiatives, no [lag]; `=off` turns it off). The choice
  golden and workshop_check pin it off (policy_options.mts checks the gated path).
- 10-25 (the user's) **A castle after the cathedral's M3**: Conwy at 1:2 first (runs/2026-10-25/monument/castle_note.md),
  on M1's stages and yard and M2's quarry; whether villages choose their monument type is decided later.
- 10-26 (the user's) **Monument materials tier 2** (#162): richer palettes (stonecutter variants, lanterns, chains,
  bells, candles, banners, every stained-glass colour) to drive new crafting chains, built in code as M2's were; the
  foundry stays parked. Missing sources become members' wants. Runs beside the castle (#153) and train 6.
- 10-26 (the user's, after test train 6, F323) **MC_PAD_PER_BUILDING and MC_GROW_OUTWARD on by default** (#84, #138:
  per-building pads and outward growth; with #149's spot cache the pad village had 0 [lag] against 429 and [stuck] 56
  against 434; `=off` turns each off). MC_FLOWER_MIX stays off until the menu stops offering a used-up flower.
- 10-26 (the user's) **MC_FLOWER_MIX on by default after #140's menu fix** (F324's left-over: no new mixed bed with a
  flower the village ran out of in the last hour; the mixes read the dye census out to 144, so they vary with what
  grows). It still acts only with MC_GARDENS on (off by default); `MC_FLOWER_MIX=off` turns it off.
- 10-26 (the user's) **MC_GARDENS always on** (#45: front beds, flower rings, saplings; with it the flower mix, on
  by default since e854a3a, takes effect). `=off` remains for tests; small_works checks the pieces without it.
- 10-27 (the user's) **Monuments at 1:3 from now on**: MC_MONUMENT_SCALE defaults to 0.3333 (was 0.5). Built so far at
  1:3: Conwy (2,008 blocks), Salisbury (3,149), Cologne (6,902). M4's 1:2 target and 1:1 are dropped for now; 1:4
  stays for quick tests.
- 10-27 (the user's, on runs/2026-10-27/houses/spec.md) **Bigger houses with decorations (#141)**: +2 on each wall
  (`both`: interior x2.1, wood +50%), both flags built and A/B'd in one train, small vanilla houses as fillers, trades
  stock decorations and owners place them, HOUSE_UNITS 225 and LANDMARK_UNITS ~400, +30-45% build cost accepted.
  Built after the 10-27 budget reset.
- 10-27 (the user's, tier 3 spec) **Deepslate needs no rung; the copper roof waits for the copper rung** (deepslate
  first, re-roofed later).
- 10-27 (the user's, on #141's A/B: wood per home +51%, interior x2.2, growth to 12 houses +23%, no [lag]) **MC_BIG_HOUSES
  on by default (both)**; MC_HOUSE_DECOR stays off until decorations pass a rerun with beds done.
- 10-27 (the user's, on test train 7, F326-F328) **The monument goes on by default once stage 7's dyes have a supply
  or a stand-in** (red, pink, bone meal); it held hour-2 busy at 54-64% against 13% without it. **Pad villages get room
  for small works** by more or bigger greens (pads and outward growth stay on). **#164 gives the model's choices stakes**
  (options whose results differ: rungs, laws, trades), not more on/off pairs first.
- 10-27 (the user's, on the #164 spec runs/2026-10-27/i164/spec.md) **Rules and customs get consequences:** claim rules
  are enforced (claimed work leaves others' menus while the claim holds); customs carry no material reward, and the
  dusk gathering at the green is one template; untyped norms stay votable with a "words only" ballot line, and a kept
  farm plot becomes a claim on an own-farm site; a back counts when the backer's failures that day name the law's
  target; the first test is one pilot train (R1/R0/F1, ~$3), E.10's replicates only after it passes.
- 10-28 (the user's 10-27 decision, applied after F331) **The monument is on by default:** MC_MONUMENT, the full palette,
  MC_QUARRY, MC_KILN, MC_GLAZING, MC_MONUMENT_DETAIL, MC_DYE_BED, MC_MONUMENT_ROLES, MC_MONUMENT_NEWS, MC_LODGE,
  MC_DEEP_STONE, MC_GEODE_GUARD and MC_FURNISH_LANTERNS/BANNERS/CANDLES (train 7's set), now that the dyes and the
  furnishing have stand-ins and D3 finished the cathedral from train 7's stall. MC_GREENS_MORE stays off for the next
  test train. Checks written with these flags off pin them off.
- 10-28 (the user's, on the dyes-greens run's furnishing stall) **Monument furnishing left out for want of iron comes
  back:** lanterns, chains and banners left out after failed chores are added by a later job once iron is in stock again
  (as the copper re-roof). **New mines open as needed:** when the iron level (or another mine) is worked out, the village
  opens a new one rather than running dry.
- 10-28 (the user's, on D1's greens: 146 small works, 77 of them one lamp design) **The greens get a better mix:** fewer
  lamps, more of the larger works, gardens on the greens; a finished green carries geometric flower patterns (beds laid
  out as shapes, kept for flowers) and trees where there are none.
- 10-28 (the user's, after train 8: choices change picks but not output, and laws have little to govern) **An open
  palette beside the menu:** members may choose from the game's whole skill palette, not only from a menu shaped by the
  village's progression. Both stay in the code: the palette becomes the base layer (every action a skill with its
  arguments, one shared check for feasibility, laws and reservations, and its facts) and the menu a ranked view on top of
  it, so a law or custom is wired once and both modes see it. First the refactor, golden-checked with no change in
  behaviour; then `MC_CHOOSE=open` (the palette plus a short "what the village needs" block) behind its flag; tested as
  whole-village arms against the menu. #170 and #171 are fixed before the next #164 rerun either way.
- 10-28 (the user's) **#172's open questions take the spec's defaults** (runs/2026-10-28/palette/spec.md section 5):
  open lifts only make-past-target and gathers nothing wants; refused takes shown as counts per law; the open palette's
  own fixed pick as the fallback; ~1.5-2x the menu's cost accepted; whole-village arms; makes capped at twice the keep;
  no holds while an open decision is pending (re-asks measured); #122's storage cap lifted for open gathers; the tags kept.
- 10-28 (the user's, on #172 round 2's finding) **A member who wants a tool gets one of their own:** the want for a
  pickaxe, axe or fishing rod is met by a make (or a take from storage) into the member's own hands, not a make into
  village storage; fixed before the full menu vs open rerun, which runs with MC_PRIMER on in both arms.
- 10-29 (the user's, on train 9c, F338) **The menu stays the default; the open palette stays a flag (`MC_CHOOSE=open`); next
  the supply gaps:** with #170 fixed the open arm matched the menu (works 93/85, failures 7.5/7.6%, 1.11x cost) but was no
  more varied (median 4 options); 93% of the needs block's first steps were not possible (wheat unripe, no fishing rod or
  string, lilac, leather, axes). The world's supply, not the chooser, limits what members can do.
- 10-29 (the user's, on the house-design spec 1c0a6cf, #174) **Members design their own houses, v1 as specified:**
  look fields stay to the street's style or its one alternative; first build only, no remodel; the street's larger house
  to the first member who asks (wealth deciding it waits for coins to be tested); decorations stay code's; whether
  `MC_HOME_DESIGN=model` becomes the default is decided after the test train; the train runs with `MC_MEMORY=on`; a
  design over budget is cut in the member's own ranking.
- 10-30 (the user's) **New feature flags default on**: "from now on - always default new feature flags to be set on". A
  build session's new flag ships `on` (`=off` turns it off); a test train's control arm sets new flags `off` explicitly.
  Flags built before 10-30 keep their defaults until the user decides each.
- 10-30 (the user's, on the wants spec bf6359f) **Members get wants of their own, as the spec suggests**
  (runs/2026-10-30/wants/spec.md, draft 2 and 9.7): pursuits chosen by the model from four code candidates or in its own
  words (unmatched ones become proposals and wishes); rivalry shown only to high-pride members; imitation scaled by
  sociability; outlet calls for idle members; explore ring 2 only for the pilot; a per-member split as the pilot, then
  village-wide pairs with a menu-only arm. Flags on by default; build after step 0's census and baseline.
- 10-30 (the user's) **Unmatched pursuits go to the triage session first** (wants spec question 6, overriding 9.7's
  point 6): a pursuit the game cannot offer becomes a proposal for the Claude triage session only, not a wanted-list
  entry or a foundry ticket.
