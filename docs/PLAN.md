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

(written 2026-10-09 at the close of the twenty-third session: Minevale33, its fixes F188-F192, the annex and chicken pens
v1, F198/F199, Minevale34; the notes below for the twenty-second session stay valid where not overridden)

- **Code:** on `tiered-brain-building`: `91d1399` fixes from Minevale33 (F188 the agent-server crash on unloaded blocks,
  F189 scouts teleport home, F190 pickaxes by uses, F191 planks before stations, F192 cane sightings), `ecb7cf7` the annex
  and chicken pens v1, `5d156ca` F198/F199 and the pen review's small fixes, and the close-out (this record, CLAUDE.md
  lessons 104-108, README, ARCHITECTURE). Pushed at the close (the user's instruction this session). `main` untouched.
- **Stack:** stopped cleanly at the close. No agents in either world.
- **Where things stand:** Minevale33 and Minevale34 (1x, model-driven, minevale3's usual site) both complete in **10.6 min**,
  0 failed actions to completion. After completion: plant starts on the plot's slots, then an **annex** (13x9 beside the
  plot, chosen in code) and a **chicken pen** on it (ring charged at the storage hut, seeds in the off-hand by command,
  up to 4 chickens led in 4-block hops, the bot teleported 2 cells in and then to the back row, the gate closed by
  command), then the iron age. Minevale34 penned 2 wild chickens with real models at +5.8; staged VanA3/A5/A6 penned 1
  each, led 25-80 blocks. Eggs and breeding are v2 (the user's choice). Live facts: `runs/2026-10-08/s23/lure_facts.md`.
- **Next (planned with the user at the close, 10-09):** 1. **F193, per-agent chores** (a second idle worker takes a chore
  of another kind; Worker2 and the Mayor idle ~20-29 min after completion today). 2. **Pens v2: eggs, breeding and cows**
  (live facts first: feeding with `activateEntity`, eggs counted and taken by command, cows following wheat, milking with
  the bucket; then eggs into storage, breeding with a cooldown, a cow pen on the annex's second slot with a wheat reserve
  kept from the bread, milk, and a cake from milk, sugar, an egg and wheat). 3. **One model-driven run** at the end (1x,
  `MCAI_AFTER=30`). Smaller if time: F201, F200, F192's cane drop pickup, F189's dry ring points, F187, F170-F173. The
  beautifying plan (B.1) after that. This plan and the prompt's tracker update were pushed with the session (the user's
  instruction, 10-09).
  The prompt: `runs/2026-10-08/s23/NEXT_PROMPT.md`.
- **How to test now:** `stage_village.py ... --mayor --after 8 --fixtures` (fixture chickens on level ground; ANNEX and PEN
  lines with a server count of each pen); `SIZE=40 node_modules/.bin/tsx scripts/checks/street_plan.mts` (annex and pen
  geometry). Staged green plains ~6 min to completion at 2x, the annex and pen ~3 min more. `[pen]` lines log each hop.
- **Test world state:** minevale3 holds VanA6's village on Minevale31's site (-1648..-1609, 27..66) with its annex at
  -1659..-1651, 40..52 and a penned chicken: reset before using it.

(written 2026-10-08 at the close of the twenty-second session: Minevale32, opportunistic farming and exploring v1, the iron
age v1, F165/F169, F178, F179; the user asked for no questions this session, so every choice was the recommended one,
recorded in the decisions; the notes below for the twenty-first session stay valid where not overridden)

- **Code:** on `tiered-brain-building`: `0da949d` opportunistic farming and exploring v1, then the iron age v1 with
  F165/F169, F178 and F179, and the close-out (this record, CLAUDE.md lessons 98-103, README, ARCHITECTURE). Nothing was
  pushed this session (origin has `3705649`): ask before any push. `main` untouched.
- **Stack:** stopped cleanly at the close (the test agent server by PID, the test Paper "All dimensions are saved", the
  pinned model servers). No agents in either world.
- **Where things stand:** Minevale32 (1x, model-driven, minevale3's usual site) 6/6 in **11.2 min** (Minevale31 16.5), 0
  failed actions: the five opportunities hold with real models. Once a village is complete, idle workers start farms on
  two free slots from what the atlas has seen within 160 blocks (cane, pumpkins, melons, vanilla villages' crops),
  harvest them, explore 8 ring points while a slot is free, then go down for iron: their own stairs to y 18 (retried past
  caves, up to 5 tries), tunnels keeping iron and coal from walls, floors and veins, an iron pickaxe and then a bucket
  into storage. Staged VanI7: 6 raw iron from 144 cells, both tools made, 0 failed. The iron age takes ~20 min after
  completion at any time scale (digging is wall-clock). F165/F169: signs and lamps in one pass (VanW7, VanW9).
- **Next (set at the close, 10-08; the user confirms at the start):** 1. **Minevale33**, a model-driven run at 1x with
  `MCAI_AFTER=30`: the after-completion chores (farm starts from wild sightings, harvests, the iron age) with real models
  for the first time, and the build time against Minevale32's 11.2 min. 2. **Animal pens v1, chickens first** (the
  backlog's "Animal pens" item now holds everything already known: tempt items from the jar, no leads, pen pieces,
  fence costs, the slots, the animals map, what is near the test sites, the unknowns to settle live first). Then the
  beautifying plan (B.1 first; four open choices) or the smaller items (F170, F171-F173, F187; the atlas noting cane stalk
  heights: a 1-high wild stalk gives nothing, VanW7). The prompt: `runs/2026-10-08/s22/NEXT_PROMPT.md`.
- **How to test now:** `stage_village.py ... --mayor --after N [--fixtures] [--ripen] [--stock raw_iron:3]` (CLAUDE.md,
  Testing agents); `runs/2026-10-08/s22/iron_start_check.mts`, `ores_along.py`, `f165/sim.mts`, `cdp_stack.cjs` (a hung
  server's stack). Records, research, designs and reviews: `runs/2026-10-08/s22/`; the next prompt is
  `runs/2026-10-08/s22/NEXT_PROMPT.md`.
- **Test world state:** minevale3 holds VanW9's street village on Minevale31's site (-1648..-1609, 27..66): reset before
  using it. The test world's atlas knows the land to ~160 blocks round VanG's site (exploring).

(written 2026-10-08 at the close of the twenty-first session: harvest and bread, the opportunities analysis and five
of its opportunities; the notes below for the twentieth session stay valid where not overridden)

- **Code:** committed on `tiered-brain-building`, not pushed (ask first; origin had `fab2359`): `f17f360` farming v2
  (harvest_farm as a chore, MineflayerWorld.farmChores; `stage_village.py --harvest`), `33b70f6` the preparer sets up
  the storage with its felled logs, `5f3e133` F164 whole buildings (`v.woodFor`; `--site-at` sixth field = the wood's
  log count, gives a staged village a wood kind), `8724395` stations shared after the storage hut, `0ec7e0a` #3/#4
  (hand-gathered items while the plot is prepared, lamps once every build is claimed), and the close-out (this record,
  CLAUDE.md lessons 93-97, README, ARCHITECTURE). `main` untouched.
- **Stack:** stopped cleanly (the test agent server by PID, the test Paper "All dimensions are saved"); the pinned
  model servers were not started this session. No agents in either world.
- **Where things stand:** a ripe field is harvested by an idle worker as a chore (also after completion), resown and
  baked into bread; staged green plains complete in 6.1 min at 2x (8.9 at the start of the session), Minevale31's site
  with a wood kind 7.2 (9.6 before F164). **No model-driven run since Minevale31 (16.5 min)**: the analysts' simulation
  predicted ~11-12 min with #1 and F164.
- **Next:** 1. **Minevale32** (model-driven 1x, minevale3, after a reset without MC_TIME_SCALE; the command in the
  session prompt): compare with Minevale31's 16.5 min and check F164's moves and the early gathering with real models;
  log analysis if it loses minutes. 2. The user's order after the analysis: **opportunistic farming and exploring**, then
  **the iron age** (backlog). Smaller: F165/F169 (plank choice), F170 (no path out of the mine, once), F171-F173.
- **How to test now:** staged runs as before; `--harvest` sets the field ripe after the build and checks the harvest;
  `--site-at=X,Y,Z,SIZE,WOOD,WOODLOGS` gives a wood kind (F164 tests: Minevale31's site
  `--site-at=-1628,65,47,40,birch,999`, baseline VanW2 9.6, now VanW5 7.2). Records, reviews and analyses:
  `runs/2026-10-08/s21/`; the next prompt is `runs/2026-10-08/s21/NEXT_PROMPT.md`.
- **Test world state:** minevale3 holds VanO4's green village (-1677..-1638, 3..42) with its harvested and resown farm:
  reset before using it.

(written 2026-10-08 at the close of the twentieth session: farming v1 added; the notes below for the nineteenth session
stay valid where not overridden)

- **Code:** committed on `tiered-brain-building`: `24e7037` (farming v1: `placeFarm` in streetPlan.ts, the seed and
  "Plant the farm" tasks in layout.ts, `tend_farm` in mcBuild.ts, the walking ban in botAgent.ts, seeds from grass only
  and not junk, mineBlock's walk to plants, `materialsNear`'s skip, street_plan.mts's farm rules), `e28198e` (seeds in
  posting order, no hoe-log task) and the close-out (this record, CLAUDE.md lessons 90-92, README, ARCHITECTURE). Not
  pushed (ask first). `main` untouched.
- **Stack:** stopped cleanly at the close (the test agent server by PID, the test Paper "All dimensions are saved", the
  pinned model servers). No agents in either world. `ollama_exec.py status` gave no WARNING this session.
- **Where things stand:** every new survival village with a street or green plan (and rows where room) gets a 5x7
  wheat field (water channel down the middle) beside the storage hut, planted with 16 wheat right after the hut's build
  (two seed tasks the mayor and workers share). Wheat grows with time frozen (confirmed live: ages 0-5 within ~3 min at
  2x) but only near agents. Minevale31 (1x) 6/6 + 6 lamps + 5 signs + the farm in 16.5 min, 0 failed actions (about a
  minute of it the mayor's seeds-first order, fixed in `e28198e`; staged VanF5 8.9 min at 2x, not run model-driven again,
  the user's choice). The test server is reachable on the LAN at 192.168.1.84:25566 only if the user adds a firewall
  rule for 25566 (the existing rule opens 25565 only).
- **Next (the user's order, 10-08):** 1. **harvest and bread** (farming v2: code posts "Harvest the farm" when ~3/4 of
  the wheat is ripe, `loot give` per cell, resow, bread at the table into storage; never counted for completion; test
  with crops set ripe by command); 2. **the opportunities analysis** (read-only log analysis of existing runs for
  waste: idle, empty walks, storage round trips, nearer tasks; F164 is its first candidate); 3. **opportunistic farming
  and exploring** (sightings recorded while working, an opportunity rule posts a farm for whatever is found first, kind-
  free farm slots, exploring for anything once the buildings stand); 4. the iron age. Details in the backlog's
  "Village life" list.
  Smaller: F165 (the craft skill's own plank choice), F166 (minevale3's lake-shore pit), F157-F161.
- **How to test now:** as before; staged and model-driven runs wait for "Plant the farm" too; read the field with
  `runs/2026-10-08/s20/farmcheck.py VILLAGE` (MCAI_API's /api/block: farmland, water, wheat and its ages); offline
  `SIZE=32|40 [PLAN=green] node_modules/.bin/tsx scripts/checks/street_plan.mts` checks the farm's rules. The prompt for
  the twenty-first session is `runs/2026-10-08/s20/NEXT_PROMPT.md`; research, design, reviews and the run analysis are
  in `runs/2026-10-08/s20/`.
- **Test world state:** minevale3 holds VanF5's green village with its farm (-1677..-1638, 3..42): reset before using it.

(written 2026-10-08 at the close of the nineteenth session: name signs added; the notes below for the eighteenth
session stay valid where not overridden)

- **Code:** committed on `tiered-brain-building`: `cfe8b8c` (name signs: `placeSigns`/`signLabel`/`holdsSign` in
  streetPlan.ts, the soft "Put up the signs" task after every build and the lamps, the `put_up_signs` skill, wall signs
  charged as the sign item, `/api/block` text, street_plan.mts's sign rules) and the close-out (this record, CLAUDE.md
  lesson 89, README, ARCHITECTURE), pushed to origin at the close (`acc805f`; the user said push), then this tracker
  update (farming before the iron age), not pushed (ask before any push). `main` untouched.
- **Stack:** stopped cleanly at the close (the test agent server by PID, the test Paper "All dimensions are saved", the
  pinned model servers). No agents in either world. `ollama_exec.py status` gave no WARNING this session.
- **Where things stand:** every building of a village gets a waxed wall sign beside its entrance door ("House",
  "Library", "Storage", "Mine"; other designs their own name), put up after the lamps by one worker in ~0.3 min.
  Minevale30 (1x, minevale3's usual site) 6/6 + 6 lamps + 5 signs in 15.4 min, 0 failed actions; F156's fix confirmed
  (lamps in one pass); F157 did not show.
- **Next (the user's choice, confirmed after the close): farming**, before the iron age (decisions of 10-08): the
  farm's water laid free by prepare_site; first settle whether crops grow with time frozen at day. Research first
  (vanilla's farm pieces, hoe, seeds from grass, water, planting and harvest as tasks), then design note, review, one
  question round.
  Smaller: F157 (if it shows again), F158, F159, F161 (the signs' leftovers). The prompt for the twentieth session is
  `runs/2026-10-08/s19/NEXT_PROMPT.md`; the signs' research, design and reviews are in `runs/2026-10-08/s19/`
  (`signs_proto/` the prototype and the jar's glyph widths, `review/` the diff review's comparison of placeSigns with the
  prototype over 115 real villages, `checks/` the sign bill script and materials.mts before/after).
- **How to test now:** as before; staged and model-driven runs wait for the sign task too; check sign columns with
  `/api/block` (it shows `text`) or RCON `data get block X Y Z front_text.messages`; `street_plan.mts` checks signs.
- **Test world state:** minevale3 holds Minevale30's village with lamps and signs (-1648..-1609, 27..66): reset before
  using it.

(written 2026-10-06 at the close of the eighteenth session: F155 fixed, street lamps added; the notes below for the
seventeenth session stay valid where not overridden)

- **Code:** committed on `tiered-brain-building`: `52f5b19` (F155: wait-only mayor plans count as empty, the nudge names
  the library and says "call plan_layout now", refusal-aware and capped at 3 a site; find_site's reason ends "call
  plan_layout now"; the mayor's executor waits for a pending replan; a drawn design marks its step; workers running a
  code-posted step skip the timed review for up to three intervals; mayorbench's F155 cases and per-case tally),
  `980a5cd` (street lamps: `placeLamps`, the `light_streets` skill, the soft "Light the streets" task after every build),
  the charcoal fix (F156) and the close-out (this record, CLAUDE.md lessons 85-88, README, ARCHITECTURE). Pushed to
  origin at the close (the user said push; ask again for later pushes). `main` untouched.
- **Stack:** stopped cleanly at the close (the test Paper "All dimensions are saved", the test agent server by PID, the
  pinned model servers). No agents in either world. Ollama is 0.35.1 now (the app updated itself); `ollama_exec.py
  status` gave no WARNING.
- **Where things stand:** the mayor lays out on its second call (Minevale27/28/29: 0.1-0.2 min, no design drawn; the
  F155 guard never had to fire in a run, the bench shows it works: 12/12). Villages take 14.2-14.4 min on minevale3's
  usual site, 15.2 with the lamps (Minevale29: ~0.6 min of that was F156, fixed after the run but not yet run again).
- **Next (the user's choice at the close): signs straight away**; F156's fix is checked by the signs' own model-driven
  run (lamps in one pass, 0 failed actions). Then the village-life list in the backlog, in the agreed order: signs beside each
  building's door, then farming (iron age suggested fourth); the user's two lighting items (inside buildings, inside
  mines) are in that list. Smaller: F157 (the Mayor's 1x1 pocket), F158 (a stray drawn design wins over the library),
  F159 (lamp leftovers). The prompt for the nineteenth session is `runs/2026-10-06/s18/NEXT_PROMPT.md`.
- **How to test now:** as before; the mayorbench F155 cases (`ONLY=F155`); `scripts/checks/street_plan.mts` checks the
  lamps' rules (`SIZE=40 PLAN=green`); staged runs wait for the lamp task; check lamp columns with `/api/block` after a run.
- **Test world state:** minevale3 holds Minevale29's village with its lamps (-1648..-1609, 27..66): reset before using it.

(written 2026-10-06 at the close of the seventeenth session: F148 and F131's leftovers done, F150 waiting; the notes below
for the sixteenth session stay valid where not overridden)

- **Code:** committed on `tiered-brain-building`: `bd174c1` (F148: `patches/mineflayer-pathfinder+2.4.5.patch` copies A*
  nodes into paths; walkOnce's `[repath]`; the `[stuck]` line's goal and path fields), `51f10a2` (F131: the rescue's
  "out" test, no climb on village ground, `test_rescue.py tunnel`), and the close-out (mineflayer-pathfinder pinned at
  2.4.5, README, ARCHITECTURE, CLAUDE.md lessons 82-84, this record). All pushed to origin at the close (the user said
  push; ask again for later pushes). `main` untouched.
- **Stack:** stopped cleanly at the close (the test Paper "All dimensions are saved", the test agent server by PID, the
  pinned model servers). No agents in either world. `ollama_exec.py status` gave no WARNING this session.
- **Where things stand:** F148 was the pathfinder corrupting its own search with a partial path's post-processing (F151);
  five staged runs since without a `[stuck]` line (VanG12/13, VanP1, VanM6/7: 7.7-8.5 min at 2x). The rescue now knows a
  sealed-in village member at once (F152: teleported home in 2 s). Minevale26 (1x) 6/6 in 18.8 min, 0 failed actions, but
  ~3 min lost to the mayor's late layout (F155). F150 did not show in Minevale26 and did not reproduce otherwise.
- **Next (the user's choice at the close): F155 first**: the mayor's lone "wait" plans escape the plan_layout nudge
  (tieredBrain.ts ~1230-1254), and the nudge's second reason overwrites "call plan_layout now"; propose the guard with a
  recommendation (AskUserQuestion) before coding, check it with `scripts/bench/mayorbench.mts` if the prompt changes, then
  a model-driven run on minevale3. After that: the rest of the backlog (F133 now probably F151's; F153; F139-F142; F150 if
  it shows), lamp posts, or phase 3. The prompt for the eighteenth session is `runs/2026-10-06/NEXT_PROMPT.md`; the
  F155 analysis is `runs/2026-10-06/minevale26_analysis.md`.
- **How to test now:** as before; also count `[repath]` lines (one in Minevale26, a cell short of a tree: harmless);
  `test_rescue.py tunnel` must teleport (never "walked out" inside); a sealed-mine check: `runs/2026-10-06/f131_village.py`
  (a staged village's member in its mine with the mining hut's doorway sealed; `VILLAGE`, `SEAL`, `START`, `GOAL`).
  Loading server edits without a reset: stop the agent server on 8767 by PID and start it with `scripts/detach.py` and
  reset_site.py's environment (MC_SERVER_DIR, MC_PORT=25566, MC_API_PORT=8767, MC_API_HOST, MC_TIME_SCALE): the staged
  village stays for checks on it.
- **Test world state:** minevale3 holds Minevale26's green village (-1648..-1609, 27..66): reset before using it. The
  rescue traps at -20..70,-35 keep sinking (F149, F154).

(written 2026-10-05 at the close of the sixteenth session: F138's leftovers done, F147 found and fixed; the notes below
for the fifteenth and fourteenth sessions stay valid where not overridden)

- **Code:** committed on `tiered-brain-building`: `07306d5` (the fifteenth session's record), `32f3eff` (item 3:
  `[stuck]` lines, horizontal watchdog), `5861632` (item 1: storage fails at once on an unmoved stall; the rescue walks
  away first), `cff6dbc` (F147: half width 1229/4096, `[stuck-world]`), `8c73e20` (every dig checked with the server),
  and the close-out (README, ARCHITECTURE, CLAUDE.md lessons 78-81, this handover). All pushed to origin at the close
  (the user said push; ask again for later pushes). `main` untouched.
- **Stack:** stopped cleanly at the close (the test Paper "All dimensions are saved", the agent server by PID, the pinned
  model servers). No agents in either world. `ollama_exec.py status` gave no WARNING this session.
- **Where things stand:** F138's pit stall was F147, a rounding error in our `playerHalfWidth` (Paper's silent
  CLIPPED_INTO_BLOCK), fixed; the mine's set-back stalls were digs Paper never finished, now checked. The last staged
  run (VanM5) had no `[stuck]` line; Minevale25 (1x) 6/6 in 15.0 min on -1628,65,47, 0 failed actions.
- **Next (the user's choice at the close): the small backlog**: F148 (a reproducible 12 s stand-still by the storage
  hut on VanG's site: VanG8/9 hit it at -1661.48,65,6.50), F150 (the Mayor's 23 s sand walk through water on
  minevale3, Minevale24/25), F131's leftovers (the rescue's success test and its climb on protected ground, the mine's
  doorway); then F133 if it shows again, F139-F142. Lamp posts and phase 3 after that. Each entry now says where its
  evidence is (F148: a lead in the pathfinder's empty-path branch; F150: the two `[stuck]` lines; F131: Minevale19.log
  lines 91, 96). The research behind F147 is in `runs/2026-10-05/s16/research/README.md`; the prompt for the
  seventeenth session is `runs/2026-10-05/s16/NEXT_PROMPT.md`.
- **How to test now:** count `[stuck]`, `[stuck-world]` and `[dig]` lines in every run's agent log (CLAUDE.md,
  Testing agents); `pit_repro.py` must stay stall-free; `test_rescue.py` takes `MCAI_API`.
- **Test world state:** minevale3 holds Minevale25's green village (-1648..-1609, 27..66): reset before using it.
- **Working method that worked:** design review before code, diff review before each commit (each found real
  problems: a pillar regression in the watchdog, the dig wait), and a read-only research subagent on the server's own
  bytecode when the server was silent.

(written 2026-10-05 at the end of the fifteenth session: F138 reproduced and the design reviewed, no code changed; the
fourteenth session's notes below stay valid where not overridden)

- **Code:** unchanged since `e5efdef` (the session ran in a worktree whose edits to the main checkout were refused; its
  record was applied by the sixteenth session from `runs/2026-10-05/f138/HANDOVER.md`).
- **Stack:** left running at the end of the fifteenth session (pinned models 11435/11436 with no WARNING; test Paper 25566
  and test agent server 8767 at 2x, from `reset_site.py minevale3` at 11:37). minevale3 is dirty: the shore birch at
  -1657,-6 felled, pits at -1656,62,-6/-5, a chest at -1660,66,11 and a village **PitTest** (one registered chest, no plots)
  in `mc/testserver/villages.json`. Reset minevale3 before any run and check PitTest is gone.
- **Next: F138's leftovers in the user's order 3 -> 4 -> 1 -> (2 only if stalls remain)** (decisions of 10-05 s15;
  F143-F146). Item 3 first (the `[stuck]` line with a per-walk tick tally, F145), run `pit_repro.py` from
  -1655.5,62,-4.5 only (F144), read the mechanism, then decide item 4 with the user. Then F133, F131's leftovers.
- **Start sessions on the main checkout, not a worktree** (CLAUDE.md, Conventions).

(written 2026-10-05 at the close of the fourteenth session: V2.5 done)

- **Code:** committed on `tiered-brain-building` (`d2fda9a`, `05d9dbb` vanillaData.ts; `41d733c` renderer colours;
  `cda19c8` smelting from the jar; `34e205b` block lists from tags; the close-out commit: README, ARCHITECTURE,
  CLAUDE.md lessons 72-76, this handover), all pushed to origin at the close (the user said push). Check `git status -sb`.
  `main` untouched.
- **Stack:** stopped cleanly at the close (the test Paper "All dimensions are saved", the test agent server by PID, the
  pinned model servers). The main world did not run this session. No agents in either world. `ollama_exec.py status`
  gave no WARNING this session.
- **Where things stand:** the adapter's block and item lists come from vanilla's tags (`mcBlocks.ts`, the hand regexes
  as an all-or-nothing fallback, one `[vanilla]` log line at the first use), SMELT from the jar's smelting recipes,
  the renderer's colours from the client jar; loot tables stay on minecraft-data (`vanilla_drops.mts` checks they agree).
  Minevale23 (1x) 6/6 in 14.9 min on Minevale22's site (15.2); staged VanG6 and VanM3 8.3 min at 2x.
- **Next (the user's choice at the close): the backlog, F138's leftovers first** (then lamp posts or phase 3). The backlog (F138's leftovers: deposit
  gives up its side spots after a stuck that did not move the bot, a step out toward the goal inside `walk`, log the
  pathfinder's last update on "stuck", jump-up diagonals with a side solid at foot level; F133; F124, F126, F128, F130,
  F131's leftovers; V2.5's leftovers F139-F142), or phase 3 (talking to the mayor).
- **Test world state:** minevale3 holds Minevale23's green village at -1648..-1609, 27..66: reset before using it.
- **Main world:** unchanged this session.
- **How to test now:** as before, plus: `node_modules/.bin/tsx scripts/checks/vanilla_tags.mts [LIST]` (vanilla vs the
  hand lists, the waterlogged table; exit 1 on problems), `vanilla_recipes.mts` (the server's SMELT against the jar and
  the old table; exit 1 on lost parity), `vanilla_drops.mts [ITEM]` (loot tables against collect's drops),
  `python scripts/vanilla_colours.py` (hand vs jar colours); `MC_VANILLA_JAR=nope` runs anything on the hand lists;
  `render_design.py --colours hand` for the old colours. Run logs and renders: `runs/2026-10-05/`.
- **Working method:** as before. This session: four read-only inventories in parallel (one per part, each writing its
  comparison script), a design review (13 findings, among them a smelting filter that would have dropped cobblestone and
  a partly cached tag), three implementers on disjoint files, a diff review (7 lows). Capture every offline check's output
  before the change; compare a world check with the old code (stash, reset, run) before blaming the change.

## Phase 1: reliability of the survival village (done 2026-09-29)

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
- [x] 1.6 Docs. CLAUDE.md (lessons 21-28 of the adapter, the model-spill trap, test sites,
      `scripts/checks/`, `scripts/attach_village.py`, session-restart and Monitor practices; LAN access, `MC_API_HOST`
      and the whitelist were already there). README and ARCHITECTURE.md (`d63d314`, 2026-09-29): site search, layout,
      design limits, range, run-as-written, rescue, completion by code, spill check, checks; diagrams updated.
      **Phase 1 done.**

## Phase 2: shared village atlas (agreed 2026-09-28)

Idea (the user's): agents share a map of what they have seen, so they find resources others located and help find
sites. Code keeps and uses the atlas; models do not read it raw.

- [x] 2.1 **Record**: as bots move, summarise each chunk they have loaded (surface height and flatness, water,
      reachable logs by kind, exposed sand, stone, clay) with a timestamp, ~~in the village registry~~ in one shared
      atlas, `mc/server/atlas.json` (decision 09-29). Show it on the panel as one village map (simple mode too). Test:
      walk Gus around, check the saved summary against `/api/block`; measure the cost per chunk (target well under
      1 ms; CPU is shared by all bots). Done 09-29 (`mcAtlas.ts`, `/api/atlas`, `scripts/checks/atlas.py`; F53).
- [x] 2.2 **Finish trees** (replaces the atlas-guided collect here; decision 09-29, F54): `collect` fells a trunk
      it has started completely, like a player: pillar up beside or under it with dirt, cut each log in reach, then
      dig its own pillar back down (only the blocks it placed; the dirt comes back), so no floating trunk or pillar is
      left and the canopy decays by itself. One failure on a trunk marks the whole trunk, not one log. Dirt: carried,
      or dug beside the tree and put back. Test: Gus on tall oak and jungle trees (count logs left, pillar blocks
      left), then a staged full run; watch the "could not reach logs" count (39 of 61 were floating trunks).
      Done 09-29 (F55, F56): StageT5 built testhall + testhut in 13.0 min with no failures but soft sand ones.
- [ ] 2.2b **Gather from the atlas**: `collect` with nothing in view goes to the nearest atlas entry for the material
      (and fails fast if it is gone, updating the atlas). Low value while the view distance (8 chunks) covers the
      96-block range (F54); mainly a CPU saving. Test: staged full run on a site with sand out of view.
- [x] 2.3 **Sites from it** (done 10-02, eighth session; design in the decisions log): `find_site` scores candidates
      over the atlas: level, dry, and trees, stone and sand within reach. Test: staged runs in the places that went
      wrong (jungle hills at -560,-60; lake at -235,-53). Done as `mcSiteAtlas.ts` (`atlasSites`) and an atlas step in
      findSite: when the local search finds nothing good, the best atlas candidates (up to 3, 48 apart; nearest first
      after the best; 300 blocks of walking at most) are checked by the column survey there. Passed: site.py at both
      places; Atlas1 (jungle hills) 3/3 in 8.2 min, Atlas2 (woods-sand) 5.7, Atlas3 (hills) 9.8, Atlas4 (lake) 14.2 at
      2x (F100). Stone is not scored (the mine gives it).
- [x] 2.4 done 10-02 (ninth session; the mechanism tested, a scouting rescue not yet seen in a run): find_site
      writes a verdict (memory.siteSearch); a new village's first site may lie up to 256 from the mayor's start (bestSite,
      atlas step, legs; the mayor's move_to too); after a poor first verdict code posts scout tasks (`scout x= z=`, a skill
      that never fails, clamped to 96 once the village has ground) to the ring points the atlas lacks, once per village,
      split across the workers; plan_layout and the 10-s "nothing laid out" re-ask wait while scouts are out; when they are
      back (or gone, or after 20 min) code runs find_site once more, and its end (found or not) closes scouting. Scout3
      (desert): posted, run as written, re-run by code; the land has no wood within 256 (the mayor then loops on refused
      layouts: backlog). Scouting is rarely needed: an offline search of the main atlas found nearly all land has a good
      site within ~110 blocks, and find_site's own legs reach ~190 (Scout2, 4, 5 found sites at 31-110 blocks).
      Was: **Scouting**: when the site search finds nothing good, code posts "scout" tasks for idle workers in
      different directions (run as written, no model calls) while the mayor draws designs. Test: model-driven run
      from a poor start point. Design agreed 10-02 (decisions log): 256 before the first layout, a `scout` skill
      that never fails, ring points the atlas lacks, find_site re-run by code, one round. Test: regression on minevale3
      (no scouting), a staged run at 2x from the lake at -235,-53 on the test world (atlas never saw it; a no-probe
      start), then a model-driven run at 1x.

## Phase 2A: village infrastructure (the user's, 2026-09-29; before 2.3)

The first buildings of every village are a storage hut and a mining hut; storage is sorted and inventoried; the
mayor plans from stock against needs; workers gather several needed materials per trip; mining happens in one mine,
not in holes everywhere, and what it finds goes into the atlas. Decisions (the user's, 09-29): fixed designs in code
for the two huts; the needs list is computed by code (the mayor can add to it); the mine is a staircase from inside
the hut down to stone, then straight branch tunnels at one level.

- [x] V.1 **Storage hut** and V.2 **sorted storage** (done together; designed 09-29, built and passed 09-29 in the fifth
      session: Hutvale2):
      - Storage hut, fixed design in code: 7 wide x 9 deep x 4 high; cobblestone floor, plank walls, log corners, plank
        roof, oak door at the front middle, no windows (no sand needed); inside 5x7 with 9 chest spots, 4 along each
        side wall (x 0 and 4, z 0/2/4/6 of the interior) and 1 at the back middle (2,6), an aisle from the door. No two
        chests orthogonally adjacent (they would join into a double chest). Chest cells are `_` in the design (keep what
        is there), so the hut is built around chests already placed. About 150 blocks, mostly planks.
      - `plan_layout` (`layout.ts`, around the storage task at line ~138) adds the storage hut to a village's first
        layout by itself (the mayor does not name it); order: prepare the plot; set up the storage with the first chest
        in chest spot 1 of the laid-out hut (not beside the plot: `nextChestSpot`/`chestSpotOk` in `mcStorage.ts` refuse
        plots today, so designated spots need an exception); gather for the hut; build it. Gathering for the other
        buildings may start at once (deposits into chest 1); their build tasks wait for the storage hut (the mining hut
        joins that "first buildings" group in V.5).
      - Sorted storage: each chest gets a material group at its first use (logs of any kind, planks, cobblestone, sand,
        glass, ...; leftovers such as doors and coal share a misc chest); `deposit` routes each item to its group's
        chest, a new chest into the next free hut spot when that one is full or missing; `withdraw` goes to the right
        chest. The record reads "chest 1 (logs): 64 oak_log, 12 birch_log; chest 2 (cobblestone): ..." in the village
        summary, `/api/village/:v` and the panel. Cocoa beans go on the junk list (F57). Old villages keep their
        loose chests.
      - Tests: typecheck; staged `--stage build` with the hut (chest ends up inside, hut built around it, mixed deposits
        sorted); staged full run; then a model-driven run.
      - Built 09-29 (fifth session): `huts.ts` (design, spots), `layout.ts` (hut in the first layout, task order),
        `mcStorage.ts` (groups, `depositSorted`, chests crafted for new groups), `mcBuild.ts` (chests on "_" cells kept,
        refused when not at the hut's level), tables and furnaces kept off village ground (`mcUtil.ts`), per-chest
        record in the summary, API and panel, rescue to the hut door. Passed: StageH2 and H5 (build stage + deposit
        check), StageH4 and H6 (full, 3/3 built), and the model-driven Hutvale2 (4/4 in 18.8 min, 0 failed actions).
- [x] V.2 (see V.1).
- [x] V.2b **Workstations in the storage hut** (the user's, 09-29; done the same day: StageH9-H11): the village's crafting table and furnace stand
      inside the storage hut, and every craft and smelt in the village uses them, instead of a table or furnace put
      down wherever the crafter stands (F59: a gatherer's table inside the future hut; F68: a second furnace, and one
      refused on wildflowers). Proposed: two cells of the hut's design, off the aisle and off the chests' stand cells,
      e.g. hut cells (2,4) table and (4,4) furnace (the chest spots stand at x 1/5 on odd z and are reached from x 2/4
      on the same z; the aisle x 3 stays clear to the back chest); drawn as blocks the builder pays for (4 planks,
      8 cobblestone). Crafting and smelting then walk to the hut (`ensureTable`, `smelt`, the builders' `near`); the
      carried or put-down table stays as the fallback away from home (gatherers' pickaxes far out, villages without a
      hut). Test: staged full run: no table or furnace outside the hut, one furnace in the village, smelting in it.
      Built: `villageStation()` (within 32 blocks and 4 up or down), smelting in turns at the village furnace, the
      hut's doorway instead of a door (F69), doors made passable/openable for every bot. StageH10 (full): no furnace
      put down anywhere, the only table outside the storage task's before the hut stood.
- [x] V.3 **Materials needed** (done 09-29, StageH13): code computes what the laid-out, unbuilt buildings still need (their bills minus
      storage minus what workers carry) and shows it in every village summary; the mayor can add items
      (`add_need`); gather tasks come from it. Test: the list after each deposit in a staged run.
      Built: `MineflayerWorld.refreshNeeds` (via `VillageRegistry.refreshNeeds`, before claims and summaries, every 3 s
      at most) fills `v.needed`: the open builds' bills and the mayor's items in one wood kind, less the storage and
      what each worker carries of the material its task is for; a claimed build counts with neither. The summary,
      `/api/village/:v` and the panel show it; `stage_village.py` prints it (NEEDED). `syncGather` posts gathering
      for what no open or held task covers (not for a material that could not be gathered) and closes only what it
      posted (F73). The mayor's `add_need` tool (survival only). Not yet exercised: `add_need` and a posted shortfall.
- [x] V.4 **Several materials per trip** (built 09-29; rarely triggers, see below): a worker gathering X also takes other needed materials it passes (open
      blocks a few steps off its path, up to what is needed). Test: staged full run, trips and time against StageT5.
      Built: `sideGather` in collect: after each block or tree, open blocks of other needed materials (the V.3 list)
      within 4 blocks and 2 up or down, never logs, stone only with a pickaxe in hand, up to the need less what is
      carried; the result names them. StageH14 and H15 (3/3 in 23.2 min): no side pickup happened: what villages need
      is logs (excluded: a tree is minutes of work), stone and a little sand, rarely within 4 blocks of each other.
      Its value comes with the mine (ores and stone in tunnel walls) or wider radii; not worth more now.
- [x] V.5 **Mining hut and mine** (done 09-29: StageH18, Hutvale4): a fixed hut over a staircase down to stone, then branch tunnels at one level;
      `collect` stone, cobblestone and ores goes to the mine and extends the tunnels instead of digging at the
      surface; the tunnels are recorded in the village. Test: staged runs; no surface holes around the village.
      Built 09-29 (fifth session; the worktree agent was blocked by the permission classifier, so the main thread did
      it): `huts.ts` mining hut (5x5, wood only, open doorway, stairs cells open in the floor), turned by `plan_layout`
      so the stairs face the nearest plot edge; `mcMine.ts`: `dig_mine` (a code-posted soft task after the hut, before
      any cobblestone task) digs 1-wide stairs with 3 blocks of headroom until the cells a tunnel would dig are stone,
      at least 7 steps down; `collect cobblestone` in such a village extends a main tunnel with 12-long branches every
      3 cells (`mineFor`), ending a branch at water, lava, a cave, a missing ceiling (hillside, sand, gravel), village
      ground, anything not natural, or the 96-block range; a partial result instead of digging outside; the mine's
      area is kept from the pathfinder's digging; ores seen in the walls are counted (`v.mine.got`, V.6 later).
      StageH16-H18: stairs in 0.6-1.3 min; 18-32 cobblestone a trip in about a minute (outside: 30 in 3-5 min);
      StageH18 built mining hut, storage hut, hall and testhut in 13.6 min.
- [x] V.5b **A mine that goes on** (F77, next): when the main tunnel meets a hillside, water, a cave or village ground,
      the whole mine stops today and cobblestone goes back to the surface (StageH19: stopped after 80 cobblestone, 20.8
      min against StageH18's 13.6). Turn the main tunnel (left or right of the blocked direction), or dig the stairs on
      to a second level, before giving up. Test: staged full runs where the main tunnel meets a hillside (StageH19's
      site, -1399,-61, did); count cobblestone gathered outside (should be none).
      Built 10-01 (both: turns, then levels; decisions log): typecheck, `scripts/checks/mine.py` on StageH19 (resumed,
      turned, 0 cells changed outside the plan), the stairs down on StageM1 and under Hutvale4's dug tunnel, staged
      builds StageM2-M3; staged full StageM6-M8 (3/3 each, all cobblestone from the mine, two miners on separate tunnels;
      no main tunnel met a hillside on three hilly sites); model-driven Minevale2 (5/5, the first tunnel met a hillside and
      turned, no cobblestone from outside). Done 10-01.
- [x] V.6 **Underground atlas**: ores and stone exposed in tunnel walls (and seen in loaded chunks below the
      surface, if cheap enough) are recorded per chunk and level. Test: a mining run, then the atlas against
      `/api/block`.
      Done 10-01: every chunk summary counts the ores exposed to air (cave walls, ravines, cliffs, tunnels; not buried
      ones, which no player could see) by kind with their y range, and marks the chunks a village's mine dug in; the
      panel's map pointer shows them; the mine's "seen" counts no longer count an ore twice. Drafted by a subagent in the
      scratchpad during V.5b, reviewed, checked with `scripts/checks/atlas_ores.py` (the atlas against `/api/blocks`).
      Not done: collect going to the atlas for ores (2.2b), and the check reads the bots' view, not the server. If the
      summary's p99 grows past ~1.5 ms (it was 1.24-1.36 on 10-01; tall mountain chunks read ~70k states): map each
      section's palette to ore kinds once and read the raw BitArray, or scan only 64 below the surface (V.6 review and
      draft, 10-01).
- [x] V.7 Model-driven village runs with all of it (done 10-01, seventh session: Minevale6, after F88's fix, 5/5 in
      12.3 min with 0 failed actions on the test world's restored minevale3 land at 1x). 10-01: Minevale3 (14.4 min) and Minevale4 (12.2 min) passed in a row,
      0 failed actions each, every cobblestone from the mine; Minevale5 lost to find_site (F88). One more pass after F88. Hutvale4 (09-29): 5/5 in 19.2 min, 2 failed actions, every
      cobblestone from the mine. More runs, and F77 (a main tunnel that ends should turn or go a level down), next.

## Phase T: faster tests (decided 2026-10-01, the user's request; first in the seventh session)

Why: a staged full run takes 9-12 min and a model-driven one 12-40, almost all of it game time (walking, digging,
felling, building at 20 ticks a second); and runs were lost to land, not code (Minevale1 and 5 on bad sites, F83/F88;
StageM6-M8 never met the hillside they were meant to test). Decisions (10-01): **not** the sandbox engine: nearly every
bug of the sixth session lived in Minecraft or Mineflayer behaviour the sandbox does not have (pathfinder digging,
stairs under a wall, suffocation, block-update desync), and the economy, storage and mine exist only for Minecraft.
**Not** RCON fast travel either (it hides the pathfinding bugs the tests are for). Instead, in this order:

- [x] T.1 **Time scale** (done 10-01, seventh session: go; walking 1.94x, staged build 1.5 vs 2.2 min, mining
      unchanged because Paper times digs by the wall clock, F91; no rejected moves; see the decisions log). Use:
      `MC_TIME_SCALE=2` on the agent server, which sets the tick rate at start (20 again without it).
      Run the server and the bots at the same higher speed.
      - Server: `tick rate 40` over RCON at agent-server start when `MC_TIME_SCALE=2` (as `mcRules.ts` applies the
        world rules; read it back with `tick query`; reset to 20 when unset). Smelting, leaf decay and pickups follow.
      - Bots: Mineflayer 4.39's physics (`node_modules/mineflayer/lib/plugins/physics.js`) steps an accumulator of
        real elapsed time by `PHYSICS_TIMESTEP` (line 71; `PHYSICS_INTERVAL_MS = 50`, line 14): changing the interval
        alone changes nothing. Scale the elapsed time added to the accumulator by `MC_TIME_SCALE` (a `patch-package`
        patch, committed with `package-lock.json`; the closure's constants cannot be reached from outside), and wrap
        `bot.digTime` (exposed, `digging.js` line 262) to divide by it. Our own timeouts (walk watchdog, 6-minute trips,
        2-minute waits) stay in real time: generous at 2x, not wrong.
      - Test: `mine.py StageM8 2 24` and a staged build at 1x and 2x; compare times (10-01 at 1x: 40-80 s a mine round,
        staged build ~2.2 min); grep the Paper console for "moved too quickly", "moved wrongly" and refused digs; watch
        `[lag]` lines (four bots doubling physics and pathfinding on one event loop, lesson 16). Pass: about 2x faster,
        no rejected moves or digs, no new failures in either check. If Paper's movement or dig checks do not scale with
        its tick rate, drop T.1 and say why in the decisions log.
      - Use: iterating and staged runs only; acceptance runs (model-driven) stay at 1x, since timing quirks (lesson 29,
        inventory drift) may behave differently at another speed.
- [x] T.2 **A fixed test world** (done 10-01, seventh session, as option (b) of the decisions log: a second world from
      the seed in `mc/testserver`, snapshot in `mc/testworld`; Fixed1 and Fixed2 identical, 7.1 min each at 2x). Use:
      `python mc/testserver.py init|snapshot|status|regions`, `MC_TIME_SCALE=2 MCAI_API=http://127.0.0.1:8767/api
      python scripts/reset_site.py SITE` (stops the test servers, restores the site's regions, villages and atlas,
      starts both detached), then `python scripts/stage_village.py VILLAGE --site SITE ...` (no land probe once the
      site is recorded in `scripts/test_sites.json`). The steps as planned (snapshot of today's world) are below.
      Known sites restored before each staged run, so runs repeat and land stops deciding them.
      - Choose 4-6 sites in today's world and record them in `scripts/test_sites.json`: wooded with sand near
        (Minevale3's -1600,-35 and Minevale4's -1596,181 passed with 0 failed actions), one where the mine's main tunnel
        meets a hillside (StageH19's ground -1403,-42 shows the shape; find or make one where the stairs point at a
        drop), one in hills (StageM6, -740,-391).
      - Snapshot: with Paper stopped (`python mc/rcon.py stop` saves), copy the region files covering each site (r.X.Z.mca
        under `world/dimensions/minecraft/overworld/region` in 26.1, not `world/region`, and `entities/`, `poi/`) to `mc/testworld/` (gitignored), and the matching
        `villages.json`/`atlas.json` entries (none: the sites must be outside every village).
      - Restore: `scripts/reset_site.py NAME` stops Paper, copies the site's region files back, removes villages the
        test created there from `villages.json` (and their atlas marks), starts Paper. Check it with
        `scripts/checks/region_blocks.py` against the snapshot (no server needed) and with `/api/blocks` once it runs.
      - `stage_village.py --site NAME` uses a site from the file directly (no land probe).
      - Test: one staged full run twice on the same restored site: same plot, same mine direction, similar times.
- [x] T.3 **A site check** (done 10-01, seventh session: `scripts/checks/site.py X Z SIZE`; F88 and F83 fixed, F93): `scripts/checks/site.py X Z SIZE` runs find_site
      with Gus and compares its reported ground, height range and trees with `/api/blocks` over the site and its
      layout margin (F83: the margin reached past the measured site into a ravine; F88: "y=101, height range 0, 0 trees"
      where the ground was at 119). Then fix find_site (unloaded columns?) and plan_layout's margin; run the check on
      Minevale1's and Minevale5's places.
- [x] T.4 **Parallel staged runs** (done 10-01, seventh session: the main world and the test world at once, both at 2x,
      Par1 6.6 min and Par2 5.9 min, 0 failed actions, CPU ~10% on average (peak 47%), `[lag]` only at the probes'
      spawns; the test world is the second instance, so no `mc/server2`). As planned: a second Paper instance from the test world (`mc/server2`,
      port 25566, RCON 25576, whitelist and rules copied) and a second agent server (port 8767; `MC_PORT`/`MC_API_PORT`
      settings if missing); the scripts take `MCAI_API`. Two staged runs at once (no models: the GPUs are not shared).
      Watch CPU and `[lag]` in both servers.

Then F88's fix is checked with T.3, and V.7's last model-driven pass runs at 1x. (Done 10-01: phase T closed, V.7
passed with Minevale6.)

## Batch R: run-time fixes (decided 2026-10-02 at the eighth session's close; before 2.4 and phase 3)

Why: each was seen in the eighth session's runs and costs minutes or stalls; each has a ready test on a restored
test site (staged at 2x, ~6-11 min). Order as listed. Baselines (10-02, 2x): drop 6.3-6.8 min (Drop3, Drop4), shelf
10.2 (Shelf2, with 12 futile sand collects), woods-sand 5.7 (Atlas2), hills 9.8 (Atlas3, 4 futile sand collects);
1x model-driven: Minevale7 11.6 min.

- [x] R.1 done 10-02 (ninth session): the first collect that finds no sand fails its task and closes the village's other
      open sand tasks; sand is then recorded in `v.unavailable` (cleared at the next layout), which syncGather, the needs
      list, requeueBuild and collect itself respect; the scripted worker fails such a task at once like the tiered one;
      collect's second pass is positions only (512, beyond the first pass's 48) and filtered after; the first pass's sort
      computes each candidate's cost once; searches over 200 ms are logged as `[search]`. Not done (design review): a
      sand count at layout time (it never runs in staged runs, by='api', and would differ from collect's rules in four
      ways, lesson 46). Changed pass criterion: one sand failure per village (the detector) instead of none. Shelf3/4,
      Hills1, Drop5 in the run record; F103.
      Was: **No futile gather tasks** (F96). `server/src/layout.ts` ~78-88 lets sand off the material check ("windows
      stay open") but `materialTasks` (`server/src/mineflayer/mcWorld.ts` ~99) still posts "Gather N sand for X"
      (and plan_layout's `gatherTasks`); collect (`mcSurvival.ts` collect, `near` ~690: within 96 of home and not
      below home y - 16, plus `dry`) then finds none. The scripted worker takes each task twice and fails twice a take
      (Shelf1: 12 failed collects in 20 s); each futile collect's two synchronous `findBlocks` passes (48 blocks/1024,
      then 128/256) probably block the event loop 1-2.4 s (four `[lag]` 2.0-2.4 s lines). Ideas: post gather tasks
      only for materials collect can reach (count as collect does: the 96 range, the home y - 16 floor, dry, exposed
      or close), let a soft gather task that finds none go without at once (the build then leaves windows open as
      now), and make the futile search cheap (one pass, or the atlas's surface counts first). Test: Shelf (sand 93-96
      blocks off below the floor) and hills (no sand): no sand gather failures, no `[lag]` beyond spawn, windows open,
      3/3; drop (sand near the edge) still gathers its sand.
- [x] R.2 done 10-02 (ninth session): `claimable` counts a held (claimed) soft gather task as finished when the
      storage covers it (`stockCovers`, the same test coveredByStock closes open ones with, built once per call; log
      tasks of every name summed together, which errs toward waiting); the holder finishes and deposits; a board note says
      when a task goes ahead of a held one. Not taken: closing the held task (its holder would drop the deposit, design
      review). Shelf5 8.8 min, Hills2 **7.3 min** (Hills1 10.4: its testhut had waited 3.3 min). Was: **A build does not
      wait for gather tasks storage already covers** (F97). `server/src/village.ts` ~280-300
      closes "Gather" tasks as "not needed" only while they are **open**; a claimed one (in progress) keeps its build
      waiting (`claimable` ~311: `t.after.every(finished)`). Shelf1: storage held 224 birch logs at 2.5 min (prepare
      felled them) but the mining hut waited for t192 (16 logs) until 3.7 min while Worker1 had nothing to do.
      Ideas: in `claimable`, count a gather prerequisite as finished when storage covers what the unbuilt buildings
      want (the same `stock` test), and tell its holder to stop at the next step (or let it finish: harmless). Test:
      shelf staged (the mining hut should start right after the storage deposit), drop.
- [x] R.3 done 10-02 (ninth session): after the job, prepare_site re-reads every target on the plot and margin in the
      bot's view and runs the cells unlike the plan once more (the server's reply to each command is the check: RCON fills
      reach the bot as ordinary block updates, so lesson 29 does not apply, design review); then every plot column must
      pass the build's own rule (dry, ground at y-1..y, nothing solid above); odd columns are confirmed over RCON (64 at
      most; only "Test failed" clears one) and confirmed ones fail prepare_site with where they are (water: "cannot be made
      dry here"; a person skipped around is named). Shelf6: 2 cells repaired on the second pass (positions not logged
      then; logged now); Drop6: nothing to redo, plot level at y 65 everywhere offline (top_map.py), the stairs aside.
      Was: **Check the plot on the server after prepare_site** (F95's follow-up, also F92). `mcBuild.ts` prepareSite
      returns "plot ready" (~1246) after runJob without looking; placements refused (2x, F92) or held back for a
      person (F99) leave holes no one sees until a build refuses "not level". Read each plot column's top over RCON
      (`execute if block` is per block: cheaper to read the bot's view, then confirm odd columns over RCON, lesson 29)
      and redo or report what is missing. Test: shelf and drop staged; `scripts/checks/top_map.py` on the saved test
      world against the snapshot (`MC_SERVER_DIR=mc/testserver python mc/rcon.py "save-all flush"` first).
- [x] R.4 done 10-02 (ninth session), as option (b) after the design review: collect passes over the logs of a standing
      tree bigger than max(40, 2 x the logs still wanted + 20) (its size from `treeLogs`, which the built/fallen check runs
      anyway; once per tree per call) while an ordinary tree costs at most 40 blocks more to get to; giants stay the
      fallback and are felled whole (F54). Not done: (a) cutting one column of a 2x2 trunk (no floating logs, but the same
      climb; kept as a fallback if long tasks remain) and (c) a jungle term in the site scores (hardly worth it with (b);
      a jungle-share rule would also hit hills). fell_trees.py takes `FELL_Y` and stage_village.py `--site-at
      X,Y,Z,SIZE[,WOOD]` (in jungle a probe spawned by x,z lands on the canopy, lesson 19: Jungle1's probe drifted 220
      blocks to an oak site). Jungle2 6.5 min (Atlas4 14.2). Was: **Jungle** (F100, F62). Whole-tree felling of 2x2 jungle trees brings 45-105 logs for 9-10-log tasks and
      takes minutes (Atlas4: the storage task's 10 logs took 6.7 min, 97 logs). Ideas: in `fellTree` (`mcSurvival.ts`
      ~394+) stop climbing once the collect's count is reached on a 2x2 trunk, but never leave a trunk floating (F54:
      cut what stands above what was cut?) — or prefer non-jungle trees in collect's candidate order, or weigh tree
      kind in the site scores (`bestSite`, `mcSiteAtlas.ts`). Design review first (F54 floating trunks, lesson 30).
      Test: a staged run on jungle land (main world -471,-41 is now Atlas4's village; find fresh jungle with
      `scripts/checks/fresh_land.py` or the atlas), `fell_trees.py` there.

Then step 2.4 (scouting) as written in phase 2.

## Phase D: buildings and villages with character (proposed 2026-10-02; not scheduled)

The user (10-02): the building and village designs are "a bit flat". A review of the design path (10-02, a conversation
beside the ninth session) found that the model aims higher than the format lets it draw, and that the reliability fixes
left it little room. Of the 35 designs the architect has drawn (`mc/server/villages.json`, huts left out), 31 are boxes
with a flat one-layer roof and three have stepped pyramids of whole blocks; none uses stairs. Fourfold1's cottage is
described as having "a peaked oak roof" and its top layer is solid planks; Meadowford2-4's roofs sit a layer above
their walls with only air between. Causes, in the code:

- **Every cell is drawn by hand.** A pitched roof means layers that shrink inward with `_` outside them, counted row by
  row; models avoid it (lesson 1).
- **The architect's only example** (`DESIGN_SYSTEM`, `designs.ts` ~176) is a flat-roofed 5x5 box.
- **The block list.** `DESIGN_BLOCKS` (`designs.ts` ~13) is the sandbox's list, shown to the Minecraft architect too:
  no stairs, trapdoors, fence gates or walls. In survival `DESIGN_SURVIVAL` (`tieredBrain.ts` ~264) allows planks,
  logs, cobblestone, sandstone and 4 glass, and `MAYOR_SURVIVAL` bans stone bricks. The economy has no such limit:
  `Materials.plan` resolves stairs, slabs, fences, trapdoors, cobblestone walls, stone, stone bricks and torches to logs,
  cobblestone and fuel (`EASY_GATHER`), `makeFromStock` crafts whatever it resolves, and `plankUnits` and `swapWood`
  (`mcBuild.ts` ~243, ~309) already handle stairs, fences and trapdoors, states kept. Untested in a build so far.
- **Block states do not turn.** `buildDesign` (`mcBuild.ts` ~1367-1407) sets a facing for doors only: a drawn
  `oak_stairs[facing=north]` faces wrong after `rotate`. States do reach `/setblock` (runJob ~619).
- **The cap is on footprint, not cost.** `SURVIVAL_MAX = 9` (`tieredBrain.ts` ~279; decision 09-28, after Accept5's
  ~750 blocks) also rules out cheap tall, long or L-shaped buildings.
- **The village is one flat pad** of at most 32x32 (`layout.ts` ~111): buildings packed in rows by area
  (`layoutBuildings`, `village.ts` ~565), never turned toward a street; the streets are levelled ground with nothing on
  them.
- **Little is asked for:** the test objective is "two matching cottages and a meeting hall", and the mayor's prompt says
  "cheap" and "up to 9x9".

Principle (lesson 1): the model chooses the style; code draws the geometry, orients the blocks and counts the cost.
Every step keeps the economy's guards (bills, materials near the site, no workstations, the 96-block range). Ambition
is paid for in gathering time (log roofs: Accept16 and 18 took 38-39 min, F51): a stair costs 1.5 planks and a slab
0.5, so a stair gable with a 1-block overhang on a 9x9 is ~200 planks against 81 for a flat plank roof, and a slab
roof ~40. New designs are tried in creative first (runs of 4-10 min), then in survival on a restored test site. The
architect is gpt-oss:120b-cloud; designbench (D.1) compares it with the local models only: no cloud model dearer than
gpt-oss and no Claude API (decision 10-03); the generator (D.2) should make the model's strength matter less. A vision
critic, if one is added, is the local qwen3.8 (test of 10-02 below). Order as listed, with D.8's renderer and critic
alongside D.3; D.7 later.

- [x] D.1 **Quick wins and a design bench** (prompts and small code; measure before and after). **Done 10-04**
      (tenth session, second day): designbench before 0/40 pitched roofs, after 20/20 survival designs with stair
      gables; rotate_design.py 0 mismatches at four turns; staged StairB1 5/5 in 3.0 min; Minevale10 (1x,
      model-driven) 5/5 in 14.6 min, 0 failed actions (Minevale9 before the solid-roof check: 18.2 min). What was
      built differs from the plan in places: the budget is per design by kind (house 250, landmark 400 by its name or
      brief) with one building over 250 a layout, not one landmark chosen by order; the floor was already optional
      ("_"); torches and the roof overhang were left out (review: a torch over air drops off and is bought again; an
      overhang's "_" ring makes fixDoor move the door out of the wall). Added beyond the plan: the rain test and the
      solid-roof check in validateDesign (F109, F110), block states checked against minecraft-data, three design tries.
      The steps as planned:
      - `scripts/bench/designbench.mts`: the architect's real prompts (cottage and meeting-hall briefs from the runs,
        with and without the survival note and the site lines), N times per model; for each design its footprint,
        layers, roof shape (flat, stepped, pitched with stairs; read from the layers), materials, blocks and gather cost
        (`Materials.plan`), whether it was valid, and seconds. Judge on 10 or more samples a case (lesson 20).
      - Examples: replace the flat box in `DESIGN_SYSTEM` with two or three short ones in different styles (a
        log-framed house with a stair roof and an overhang, a hall on a cobblestone base).
      - A block list per world (the world gives it, e.g. `WorldAdapter.designBlocks`; the sandbox keeps today's), and in
        survival the derived blocks: stairs, slabs, fences, fence gates, trapdoors, cobblestone walls, stone and stone
        bricks in moderation (smelting fuel), torches (charcoal and sticks). Each checked with `Materials.plan`: no raw
        material outside `EASY_GATHER`.
      - A cost budget instead of the 9x9 cap: gather units from `materialTasks` (about 250 for a house and 400 for one
        landmark a village, to be set from the bench), keeping the site's footprint limit (`siteLimit`). The full
        cobblestone floor becomes optional (`_` keeps the prepared ground).
      - Turn block states with the building in `buildDesign`: `facing` (as the door's) and `axis` (x and z swap at 90
        and 270). `validateDesign` and `fixDoor` count only `oak_door` as a door: count any door.
      Test: typecheck; a design with stairs built by Gus in creative at rotate 0, 90, 180 and 270 on a restored site,
      checked with `GET /api/blocks`; designbench before and after; a staged build with a stair-roofed testhut and
      testhall (`--buildings`: builders must craft the stairs and slabs from storage); one model-driven village at 1x.
      Pass: designbench shows pitched roofs in most designs with no more invalid ones than before; staged 3/3; the
      model-driven village within 1.5x Minevale7's 11.6 min (or the budget lowered until it is).
- [x] D.2 **A building generator** (the main lever). **First version done 10-04 (eleventh session)**: built and
      committed (`buildingGen.ts`: rect footprints, gable, hip (pyramid on a square) and flat roofs, overhang 0-1, log
      frame, base course, foundation course, windows glass/panes/open, door side; the `submit_style` tool where the world
      takes states, the prompt leading with the style; `elevations()` in designs.ts; doors by the building's edge, not the
      grid's; furnace runs fitted by code (`fitSmelts`); layouts pack generated buildings by their walls with the eaves
      over the street; budgets 150/300). Differs from the plan: stair shapes are left to the server (/setblock computes
      them; code's vanilla rule only checks), copies vary by rotate only, no wood/ridge/window-spacing parameters (the
      decisions log, 10-04). Passed: offline checks, every roof at four rotations, staged GenB1-4 and GenF1, designbench
      20/20 by style, and the model-driven Minevale15 (5/5 in 16.1 min, 0 failed designs and actions; within 1.5x
      Minevale7) after a cap on a style's walls (houses 9, landmarks 11: Minevale14's 13x13 hall took 23.2 min, F117).
      Minevale15's cottage was drawn by hand and flat (F118): the generator built only its hall. Next, as D.2b: L and T
      footprints; D.2c: porch, chimney, trapdoor shutters (outside the wall, F112); later shed roofs and two storeys.
      The plan as written: the architect may submit a style instead of layers, and code draws
      the layers (`buildingGen.ts` beside `huts.ts`; world-independent, a `Design` out, so build_design, bills, layout
      and storage stay as they are). First parameters: footprint `rect`, `L` or `T` with width and depth; 1-2 storeys
      and wall height; frame (log corners, log beams laid on their side at each storey line); wall material per storey;
      roof `gable`, `hip`, `pyramid`, `flat` with a parapet, or `shed`, with its axis, overhang 0-1 and material (stairs
      on the slopes, slabs or full blocks on the ridge); windows (spacing, pairs, glass or open, trapdoor shutters); the
      door's side and an optional porch (fence posts under a slab roof); a chimney. Code gets right what models get
      wrong: stair facing and `shape` at hips and L corners, the door on an outer wall with headroom, symmetry, a roof
      that covers everything, the bill. The style is kept with the design, so copies can vary (mirrored, which swaps
      east and west facings and left and right stair shapes; the door on another side; another accent material):
      "matching" cottages that are not identical. Drawing by hand stays for what the generator cannot express, and the
      model may edit generated layers (a bell, a balcony) and submit them.
      Test: an offline script (no server) printing each roof type's layers and elevations (D.3) for 5x5, 7x9 and an L
      footprint and checking the door, every stair's facing and the bill; each built by Gus in creative at all four
      rotations and compared with `GET /api/blocks`; a staged build with generated designs; a model-driven village.
      Pass: every roof type built as drawn at every rotation; staged 3/3; model-driven 3/3 with no failed designs.
- [x] D.3 **Show the architect its building**. **Done 10-04 (eleventh session)**; the model-driven runs after it
      (Minevale16-18) had no failed designs or actions where the architect stayed on styles but did not meet the time
      (19.2 min; two stopped: F120, F121):
      `lintDesign` (designs.ts; definitions from a design review checked on 4,320 generated styles and the stored designs:
      wall cells, eaves as the roof's underside, openings grouped into windows, gaps and open gable ends, empty layers, a
      flat roof by its stairs, low walls; weak notes for drawn designs only) and one revision round in design() where
      styles are offered: the design, its elevations and the notes shown back once, a style revised only as a style, the
      revision kept only with fewer notes; every refused try and the revision's verdict logged (`[design]`). Measured
      (designbench): with styles offered, style designs never get notes, and the round turned flat hand drawings into
      styles (cottage_mayor 2 of 2); hand drawings shown their own open gable ends did not fix them (0 of 8 improved).
      So the lever was code fitting a style to the budget (Minevale16: a style refused at 168 of 150 sent the architect
      to drawing by hand): `shrinkStyle`, as fitSmelts and capWalls. Final bench: 30/30 by style, 0 notes left. The
      panel shows each design's elevations. The plan as written: after each submission code renders front, side and top views as text
      (`elevations(design)` in `designs.ts`) and lints it: a flat roof, one wall material, a blank wall on the door's
      side, an empty layer under the roof (Meadowford2-4), walls lower than 3 on a building over 7 wide. One revision
      round with both, in the retry loop `TieredBrain.design` (`tieredBrain.ts` ~1168) already runs for errors; lint
      notes are suggestions, so a valid design is saved after the revision either way. The panel shows the elevations
      in the village's design list. Test: designbench with and without the revision (share of pitched roofs, materials
      per design, cost, seconds: gpt-oss draws in ~9 s, and a revision about doubles it).
- [ ] D.4 **Village plans with character**: `plan_layout` takes a plan, `green`, `street` or `rows` (today's), and code
      places the buildings round a green with a well in the middle, facing in, or along both sides of a main street,
      facing it; each is turned with build_design's `rotate` so its door faces the green or the street (the door's side
      is in the design). The huts keep their rules (the mine's stairs face the nearest plot edge). After the buildings,
      code posts small soft tasks for what lies between them: gravel or dirt-path streets (dirt path charged as dirt,
      like grass) and a path from each door, lamp posts (a fence post with a torch), a well (drawn by code, like the
      huts), later fenced gardens or a farm plot. A green that does not fit on the site falls back to rows. Test: an
      offline check of the layouts (no overlaps, inside the plot, every door facing and reaching the street or green);
      a staged build on a restored site; one model-driven village.
- [ ] D.5 **Vanilla village pieces as a library**: the Paper jar (`mc/server/versions/26.1.2/paper-26.1.2.jar`) holds
      483 village pieces under `data/minecraft/structure/village/`: houses for plains (36), savanna (31), snowy (30),
      desert (28) and taiga (27), town centres and streets. `nbt.ts` and `schematic.ts`'s structure reader read them; a
      Minecraft variant of `schematicToDesign` keeps the block states (no sandbox mapping), turns jigsaw blocks into what
      they become and `structure_void` into `_`, and swaps or drops what the economy cannot make (villager job sites,
      beds, bells, hay, wool, lanterns...; a substitution table like `mapBlock`). A piece with more block states than
      the one-character symbols allow needs a wider symbol set. Each piece then passes the checks a drawn design does
      (bill, no workstations, the budget). Uses: one or two biome-matched examples in the architect's prompt, pieces
      the mayor can name outright, and the town centres (wells, meeting points) as D.4's green. Read from the local jar
      at runtime; commit no pieces (Mojang's files). Test: import every house of one biome and report how many pass after
      substitution and at what cost; build three in creative on a restored site at rotate 0 and 90 and compare with
      `GET /api/blocks`.
- [ ] D.6 **Ambition at the mayor's level**: a style chosen once per village from its biome and wood (spruce and
      cobblestone in taiga, acacia and terracotta in savanna and badlands, sandstone in desert), kept on the village and
      passed into every brief in one line; more building types in the mayor's prompt (watchtower, smithy, chapel with a
      bell tower, market stalls, gatehouse) within the budget; one landmark a village once the storage holds spare
      materials (the needs list, V.3); test objectives that ask for more ("a hamlet round a green with a watchtower").
      Test: mayorbench cases for the style and the landmark, then model-driven runs with the new objective.
- [ ] D.7 **Terrain** (bigger; design review first): buildings on their own levels instead of one levelled pad:
      terraces stepping down a slope, each its own plot at its ground's level, joined by stair paths; foundations filled
      down to the ground under a building on uneven ground instead of levelling it all. Touches prepare_site (several
      levels), `layoutBuildings`, the village's and the mine's protected ground (lessons 31, 35) and find_site's scores
      (a slope stops being a reason to pass a site over).
- [ ] D.8 **Pictures and inspiration** (added 10-03; the renderer and the critic go with D.3, the sources after D.5):
      - **Renderer**: a design (or a box of world blocks from `GET /api/blocks`) drawn offline as an isometric PNG, two
        views (south-east and north-west), block colours averaged from the textures in the client jar (flat colours
        will do at first). A prototype (Python and Pillow, ~80 lines, flat colours) rendered Minevale5's cottage and
        Sunhollow3's stepped pyramid correctly in a session scratchpad; rewrite it in the repo. Uses: design
        thumbnails on the panel, the critic's input, and a view of the whole village from above (layout, sameness,
        prepare_site's scars in the terrain).
      - **Vision critic** on the local qwen3.8 (decision 10-03): the render goes with the exact facts from code (size,
        layers, materials, door and window sides; dimensions written on the picture) and the model only judges: a
        critique and changes in the generator's terms (D.2), or the best of N generated variants for the brief.
        Measured 10-02 without the facts: 5-7 s an image, roof shapes right, counts unreliable, plain plank roofs
        proposed where kimi-k3 proposed stairs. First test: the same two renders with the facts given, scored against
        the layers; then designbench with and without the critic (share of pitched roofs, cost, seconds).
      - **Sources, gathered offline before runs, never searched for during one**:
        - Builders' rules: walls with depth (pillars out a block, windows set back), log frames, a stone base under
          wood, overhangs with upside-down stairs under the eaves, roof trim, odd widths for a centred ridge,
          trapdoors and fences as detail. A model distils them from tutorials into a list; they become generator
          features (D.2) and lint checks (D.3).
        - A style book: 30-50 vernacular styles (half-timbered, Alpine chalet, adobe, Nordic longhouse...) as cards of
          generator settings and materials by biome, written by a model and reviewed by the user. Minecraft is close
          to 1:1 (a storey is about 3 blocks), so real proportions carry over.
        - Photos to style cards: qwen3.8 (or gemma4) reads a reference photo into a card; later the user gives the
          mayor a photo on the panel ("build this", with phase 3).
        - Village plans: geography's village types (street, green, clustered, round) for D.4's templates; real
          villages' footprints and streets from OpenStreetMap (ODbL: attribution).
        - Christopher Alexander's *A Pattern Language* for layout and lint rules ("small public squares", "entrance
          transition", "light on two sides of every room"), in our own words.
        - Build collections: GrabCraft (MineAnyBuild used ~7,000 builds from it), rom1504's
          minecraft-schematics-dataset, CraftAssist/3D-Craft (2,586 player-built houses). Curated picks imported
          locally under each creator's terms (D.5's importer), and statistics (proportions, roof pitches, material
          pairings, window spacing) for the generator's defaults; nothing redistributed.
      - **Further out**: a short history per village that shapes it (an old core round the green, newer houses along
        the road), houses shaped by their owners' work (the miner's stone house by the mine), landmarks the atlas
        suggests (a lighthouse on the coast, a mill at the river, a watchtower on the highest ground), styles that
        drift between neighbouring villages, and GDMC's four criteria (adaptability, functionality, narrative,
        aesthetics) as a rubric for judging villages.
      Background (10-02): in MineAnyBuild (NeurIPS 2025) the best models scored ~41/100 at writing building plans as
      block matrices, the format our architect writes: pictures and styles in, geometry from code.

### Vanilla villages: pieces and plans from the Minecraft jar (agreed 10-04, eleventh session; next after this session)

The user's direction (10-04): re-use Minecraft's own resources. The Paper jar holds vanilla's whole village system:
542 pieces under `data/minecraft/structure/village/` in five biomes (plains, savanna, snowy, taiga, desert: 28-37
houses each, 3-5 town centres (fountains, meeting points), 12-20 street pieces, lamp posts, decorations; zombie variants
and spawn markers) and 74 template pools under `worldgen/template_pool/village/` (town centre -> streets -> houses ->
terminators, by jigsaw connectors). A survey of the plains (`scripts/checks/village_pieces.py`, 10-04): small houses 7x7 of
~150 blocks, mid houses ~250, the library 630; ~85% of all blocks are cobblestone, oak stairs, planks and logs; the
rest is white terracotta (1 house in 6), beds and wool, bells, workstations, stained glass, carpets, wall torches, and
dirt or grass in the lowest layers (ground fill); every house has a jigsaw block at its entrance (its street side: the
front, for turning it toward a street). Pieces are read from the local jar at runtime and never committed; renders of
them stay private (D.5's rule). Decisions in the decisions log (10-04). Steps, each tested before the next:

- [x] V2.1 (was D.5) **Importer**. **Done 10-04 (twelfth session)**: `server/src/vanillaPieces.ts` (jar read with a
      small zip reader on zlib, `listPieces`, `readPiece`, `pieceToDesign`, `substitute`), `scripts/checks/vanilla_pieces.mts`
      (offline report; `OUT=` writes each design and an index), `scripts/contact_sheet.py` (renders tiled by biome). Cut
      at the entrance door: its level is layer 1, the floor layer 0, vanilla's ground fill below dropped (plains floors
      sit a block lower than vanilla's, the entrance step flush); air outside the building (a flood of the door layer on
      vanilla's blocks) or open to the sky is "_"; double slabs become full blocks; states kept: facing, half, axis, type,
      open, rotation (the server works out stair shapes and fence sides); every piece turned so its entrance faces south,
      checked with doorOutward. Substitutions (the user's choices): terracotta by biome (plains, taiga, snowy cobblestone;
      savanna acacia planks; desert sandstone), smooth sandstone to sandstone, stained glass and iron bars to panes,
      diorite, granite, mossy cobblestone and bricks to cobblestone, glazed terracotta to chiseled sandstone, bookshelves
      to planks, decoration, lights, workstations, wool, hay and clay to air, water and plants to "_"; snow blocks and ice
      left for the checks. Economy changes: stripped logs and bark blocks charged as logs (`chargedItem`, the builder's
      wood swap keeps "stripped_": `woodPart`/`woodName`), dirt_path charged as dirt, a door with no way out faces across
      its wall and an upper-floor door is judged by its own layer (`doorOutward`). Two reviews (design and diff) found 15
      real problems, all fixed but F124's limit. Result (152 house pieces): 113 import, 105 valid, **62 pass** the survival
      checks and budgets: plains 14 of 36, savanna 21 of 31, snowy 10 of 30, taiga 4 of 27, desert 13 of 28; passing
      pieces cost 55-189 gather units. Contact sheets: `runs/2026-10-04/vanilla_v21/sheet_*.png` (private). The plan as
      written: **Importer** (`vanillaPieces.ts`, offline first): village pieces to Designs with their block states (`vanillaPieces.ts`, offline first): village pieces to Designs with their block states
      (no sandbox mapping), the front side from the entrance jigsaw, jigsaw blocks to their final state, structure_void
      and the ground-fill layers to `_`; a substitution table kept close to vanilla: blocks the economy makes stay
      (cobblestone, stairs, slabs, planks, logs, fences, trapdoors, doors, glass panes), stripped logs charged as logs,
      white terracotta to a near colour by biome, stained glass to plain panes, decoration and workstations (beds, bells,
      carpets, pots, job sites) to air; wall torches left out (placement order) and an interiors pass later. Report per
      biome: how many pass the economy's checks and the budget, at what cost; a contact sheet of renders for the user.
- [x] V2.2 **Built as drawn**. **Done 10-04 (twelfth session)**: `rotate_design.py --design` on six pieces in creative
      at 2x: plains_small_house_1, savanna_small_house_4, taiga_small_house_4, desert_small_house_7 and plains_library_2 (upper
      doors, 70 stairs) 0 mismatches at all four turns, vanilla's roof corners worked out by the server (plains_small_house_1:
      7 outer_left, 5 outer_right); snowy_small_house_2 3 of 4 (gravel slid onto rotate 0's plot, F128). Staged VanB1
      (`stage_village.py --design-file`, new): three vanilla houses of three biomes in a birch village, 5/5 in 2.5 min at 2x,
      0 failed actions; stripped birch logs placed and charged as birch logs, acacia and spruce swapped to birch. The plan:
      **Built as drawn**: a few pieces of each biome at four rotations (`rotate_design.py --design`), then a staged
      village of vanilla houses (`stage_village.py`).
- [x] V2.3 (D.4, hybrid plan) **A street village**. **Done 10-04 (twelfth session)**; part 2 (the mayor's library by
      biome, `d14fa53`) passed Minevale20 (6/6 in 18.0 min at 1x, 0 failed actions, no design drawn). Part 1: the street plan
      (`server/src/streetPlan.ts`: `planStreets`, `layoutStreets`, `doorOf`; plan_layout's street branch when the village's
      `plan` is "street"; `scripts/checks/street_plan.mts` offline). The biome's town centre (a meeting point without water,
      `centreToDesign`; desert has none, so its streets cross) in the middle of the pad, 3-wide streets from its connectors
      to the pad's edge (a plain one from each side without a connector, when that places more), buildings turned to face
      a street, their entrance step touching it or a path of up to 4 blocks to it, 2 blocks apart, the storage hut never
      turned, the mining hut with free ground behind it to the pad's edge; a beam search places them; a centre that leaves
      buildings out gives way to crossing streets, then to rows. Streets, paths and the centre's plaza are laid free by
      prepare_site as dirt_path (the layout record keeps them). Staged VanS1-3 (2x): 6/6, 6/6, 5/5 in 3.0-3.2 min, 0 failed
      actions. Part 2: the mayor's library filled by the site's biome after find_site, a prompt line, siblings
      for matching houses in code, F131's fixes (Minevale19). The plan as written: **A street village**: code lays the plan on the pad, vanilla supplies the content: the
      biome's town centre (substituted) in the middle, its jigsaw connectors giving the street directions, streets laid
      as dirt_path (charged as dirt, like vanilla's street pieces), houses along them turned so their entrance faces the
      street, the biome's lamp posts along it. The mayor asks by kind ("two small houses and a library"); code picks the
      pieces by the site's biome (D.6's village style for free, F113), "matching" houses as siblings of one family
      (plains_small_house_1..8), not copies; generated and drawn designs stay for anything else. Within the 32x32 pad
      first. Ground truth: `/place jigsaw` with the biome's town-centre pool in creative on the test world builds a real
      vanilla village to compare with. Test: an offline check of the plans (inside the pad, no overlaps, every entrance
      on a street), a staged run, then a model-driven village.
- [x] V2.3m **The mayor gathers while it waits**. **Done 10-04 (thirteenth session, `b716f33`)**: a `TaskBrain` sub-runner
      beside the mayor's empty plan (the design review's simpler alternative to a gather plan in `memory.plan`: every
      wake-up check and the chat-only executor stay as they are) claims soft "Gather N item" tasks (`mayorGatherPick`: logs,
      sand and dirt before cobblestone), runs them as written and hands the task back (`unclaim`, no try counted) when a plan
      with steps comes, the village is complete, a second site is needed or `memory.mayorGathers` is false; a busy mine
      hands back without a try and leaves cobblestone alone 3 minutes. Its gathering is kept out of the model's events, the
      3-failure replan, blocked calls and the completion and board checks. `stage_village.py --mayor` (`--planner none`).
      Staged VanM2 6/6 in 8.0 min at 2x (VanF2 without the mayor 10.9); Minevale21 (1x, model-driven, the same site as
      Minevale20, -1508,-63) 6/6 in **15.0 min** (Minevale20 18.0), the mayor 8 gather tasks, 0 extra model calls. The plan
      as written: Once a layout is posted and the mayor has nothing to plan, it claims the soft gather tasks
      (logs, cobblestone, sand: never builds, land or storage tasks) and runs them as written, as workers run code-posted
      tasks (no model call); events that need it (a failed task, the timed review, the village finished) still wake its
      planner, and a gather task in its hands is handed back when it must replan. Expected: gathering about a third
      faster. Test: a staged full run (stage_village.py with the mayor present), then a model-driven village against
      Minevale15's 16.1 min.
- [x] V2.4 **A green village**. **Done 10-04 (thirteenth session, `723a24d`, with collect's lake and pit fixes `bb48ec0`)**:
      on a site of 40 or more, the biome's town centre in an open green inside a 3-wide ring street, every building
      outside it facing in (`layoutGreen`/`planGreen` in streetPlan.ts, the beam search shared as `placeAlong`; the centre
      moved up to 4 blocks south or north so the unturned storage hut fits north of the ring); else the street plan, now on
      up to 40; the vanilla mayor searches find_site size=40; prepare_site takes 40x40 (~2.5 min at 1x). Staged VanG1/2/5
      (plains, snowy) 6/6 in 8.1-8.4 min at 2x; Minevale22 (1x, model-driven, the 40 site at -1628,47) 6/6 in **15.2 min**,
      0 failed actions. The plan as written: round a town centre with the buildings facing in; prepare_site's limit raised to ~40 once
      its time is measured. Later, with D.7: vanilla's full jigsaw assembly over terrain.
- [x] V2.5 **Vanilla data instead of hand lists**. **Done 10-05 (fourteenth session)**: `vanillaData.ts` (the jar reader
      moved out of vanillaPieces.ts; tags resolved recursively, `vanillaJar()` resolved against the repo root; `d2fda9a`,
      `05d9dbb`); `mcBlocks.ts`, the adapter's block and item lists from tags plus short extras lists, all at once with the
      hand regexes as an all-or-nothing fallback (`34e205b`); SMELT from the jar's smelting recipes (`cda19c8`); renderer
      colours averaged from the client jar (`41d733c`). Loot tables: no runtime change (minecraft-data's drops agree with
      the jar on every item the economy asks collect for); `vanilla_drops.mts` stays as the upgrade check. Four read-only
      inventories (one per part, each with its comparison script), a design review (13 findings), three implementers on
      disjoint files, a diff review (7 lows). Behaviour changes, all judged by the user: natural lists lose built blocks the
      regexes let through (stripped logs and wood, glazed terracotta, potted plants, crop stems as logs) and gain natural
      ones (corals, lush caves, newer flowers, pale garden, mangrove roots, dripstone, blue ice; bee nests, cocoa, pumpkins
      and melons are non-ground for find_site, F76's class); waterlogged empty-box states are water in the wet tables and
      the mine shares them; mushroom stems are cleared but not logs; built frames read as built ground; stone smelts from
      plain cobblestone. site.py PASS, staged VanG6 and VanM3 6/6 in 8.3 min at 2x, Minevale23 6/6 in **14.9 min** at 1x
      (Minevale22 15.2 on the same site), 0 failed actions. The plan as written: block tags
      (`data/minecraft/tags/block/`: logs, leaves, flowers, replaceable, dirt...) for NATURAL and similar lists (F61 and
      F76 were missing entries); the jar's recipes, smelting included, for mcMaterials' hand-made smelting table; loot
      tables for "which blocks drop this item" (collect); texture colours averaged from the user's client jar for the
      renderer (D.8).

## Phase 3: humans in the loop (part 2 of the user's goal)

(Deferred by the user on 2026-10-02: batch R and step 2.4 come first.)

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

- [ ] 4.1 ~~Gathering that finishes trees~~ (moved to 2.2); choose trees by reachable logs (atlas `low` counts).
- [ ] 4.2 The storage chest between the plot and the nearest trees and stone, not wherever the first deposit is.
- [ ] 4.3 More workers where gathering allows (4 workers only paid off with enough trees apart; see F12).
- [ ] 4.4 Executors on gpt-oss (benchmark with `scripts/bench/execbench.mts` first). Low value now: workers make
      few model calls since run-as-written.

## Backlog (not scheduled)

**Village life (the user's list, 10-06, eighteenth session).** Order agreed so far: lamp posts (under way), then signs,
then farming; iron age suggested as the fourth (it unlocks buckets, shears, lanterns and interiors). The rest unordered.
- ~~**Lamp posts** along the streets and the green's ring~~: done 10-06 (`980a5cd`, the user's choices: a fence of the
  village's wood with a torch, charged, about every 8 blocks, completion waits for them). Vanilla's per-biome lamp pieces
  later, with the iron age (snowy's lanterns; plains' wall torches need a wall_torch charge and supports-first order).
- ~~**A sign beside each building's door** naming its function~~: done 10-08 (`cfe8b8c`, the user's choices: a wall
  sign beside the entrance door, every building with a door labelled by its use, a separate soft task after the lamps,
  waxed, completion waits). Leftovers: F161.
- ~~**Farming** v1~~: done 10-08 (`24e7037`, `e28198e`; the user's choices: seeds by gather tasks into storage, a 5x7
  field of our own shape (vanilla's farm pieces have no door and are dropped, F123; their inside is the shape), 16 seeds
  in alternate rows, planted early, completion waits for the planting; Claude's: a hoe required, no farm in cold or
  desert biomes, water laid free by tend_farm). Crops grow with time frozen (random ticks ignore `advance_time`) but only
  within ~6 chunks of an agent.
- ~~**Harvest and bread**~~: done 10-08 (`f17f360`, a chore rather than a posted task, see the decisions). The plan was
  (farming v2, the user's order 10-08): code posts "Harvest the farm" when ~3/4 of the
  wheat is age 7 (a check beside `refreshNeeds`, no board change), `loot give <name> mine X Y Z` per ripe cell (no
  walking on the field), resow charged a seed, bread (3 wheat) at the hut's table into storage; never counted for
  completion; tested with crops set ripe by command. The water can become charged after the iron age.
- ~~**The opportunities analysis**~~: done 10-08 (twenty-first session; `runs/2026-10-08/s21/opportunities/`, five
  opportunities built, see the decisions; left: a ready build pre-empting a fresh soft gather, seeds credited from
  prepare_site's grass, one trip for several sand tasks, side pickups on walks, the mine keeping ores). The plan was
  (the user's, 10-08; after harvest and bread): read-only subagents go through the last
  ~15 runs' logs (Minevale20-31, Van*) and measure where each agent's time goes (idle, waiting for a task, empty walks,
  storage round trips, a task claimed far off while a nearer one was ready, a needed block passed on the way); each
  pattern a candidate with its minutes per run, prototyped offline where possible, ranked by minutes saved against risk;
  the user picks. Known candidates: F164 (logs of another kind never cover log tasks, ~1.5 min a run), claiming the
  nearest ready task, collecting needed blocks passed on the way, carrying the next build's materials back, idle
  pre-gathering, the mine keeping ores, one storage-hut visit for lamps, signs and the farm. The existing examples:
  V2.3m, V.4, F97, prepare_site's logs.
- ~~**Opportunistic farming and exploring** v1~~: done 10-08 (twenty-second session; plants only, see the decisions; next:
  animal pens, chickens first). The plan was (the user's, 10-08; after the analysis): no "find X" goals. Agents record
  sightings while they work (passive animals; pumpkins, melons, sugar cane, berries, cocoa, bamboo, vanilla villages'
  carrots and potatoes) in the atlas; an opportunity rule (beside `refreshNeeds`) posts a farm for a kind not yet farmed
  when a sighting is in range, a farm slot is free and the lure food or seed item is in storage (seeds lure chickens,
  wheat cows and sheep, carrots pigs; kinds seen but not yet possible wait); farm slots reserved at plan_layout, kind-
  free; tasks fail soft ("Bring 2 chickens from x,z" led with food, no leads: they need string; "Take a pumpkin from
  x,z"); completion never waits for these. Once every building stands, idle agents explore for anything (the 2.4 ring,
  bounded trips, winding down after trips with nothing new), and the same rule farms what turns up. Tests need a "keep
  going after completion" mode with its own time limit. Vanilla's 12 animal pens (dropped like the farms, F123) as pen
  shapes.
- **Furnished interiors**: put back what the importer turns to air where the economy can make it (crafting tables,
  furnaces, chests, bookshelves, wall torches from the mine's coal; beds need wool).
- **Internal lighting inside buildings** (the user's, 10-06): torches on the inside walls (the importer drops vanilla's
  wall torches today; they need a wall_torch charge mapping and supports-first placement, the lamp research's notes).
- **Internal lighting inside mines** (the user's, 10-06): torches along the stairs and tunnels as they are dug (coal from
  the mine, or charcoal).
- **Gardens and fences**: a fenced front garden with flowers the agents pick.
- **A stock board**: signs at the storage hut showing what storage holds, rewritten on every deposit.
- **Campfires and chimneys** (logs, sticks, coal) on the green and the houses.
- **Animal pens**: v1 done 10-09 (`ecb7cf7`, chickens on the annex; see the decisions and `runs/2026-10-08/s23/`); v2
  (eggs, breeding, sheep and cows) next. What was known before v1: sheep, cows,
  chickens fenced near the farm (eggs, food; wool for beds once shears exist). **Known already, don't re-derive**
  (`runs/2026-10-08/s22/research/sightings.md`, `farmslots.md`, `plants_scan.md`):
  - Tempt items, from the 26.1.2 jar's item tags: `chicken_food` = wheat/melon/pumpkin/beetroot/torchflower seeds and
    pitcher_pod; `cow_food`, `sheep_food`, `goat_food` = wheat; `pig_food` = carrot, potato, beetroot. Storage holds
    wheat_seeds (the harvest leaves ~27-33 a time; F168), so chickens are possible now; cows and sheep need wheat kept back
    from the bread (harvest_farm bakes floor(wheat/3) today, mcBuild.ts harvestFarm).
  - No leads: a lead is 5 string (no slime in 26.1); string only from cobwebs with a sword or shears (mcMaterials.ts marks
    string unobtainable). Animals follow a player holding their tempt item (vanilla TemptGoal, ~10 blocks; not yet checked
    in this jar or with a Mineflayer bot): luring by a held item is the new movement problem.
  - Pens: vanilla's animal pen pieces (outer W x D): plains 5x6, 7x11, 8x11 (two without a gate), savanna 9x9, 13x12, 8x9,
    snowy 8x9, 9x8, taiga 13x8, desert 10x7, 10x8 (dropped by the importer like the farms, F123). A 5x7 pen (fence on the
    outer ring, 3x5 inside, a gate) is 19 fences and a gate, ~39 planks (~10 logs); a farm slot (5x7, kind-free,
    `layouts[i].slots`) can hold one (kind e.g. `pen:chicken`; the slot's water channel is not laid for a pen).
  - Animals in the atlas (`Atlas.animals`, by uuid: kind, x, y, z, t, by; seen every 5 s per bot, deleted after 10 s
    missing near a bot; `/api/atlas?all=1` and `?village=` return them). World-generated animals are persistent in peaceful
    and stay near where seen (AI only within 32 of a player). Near minevale3's usual site: pigs 12 (60 blocks), sheep 8
    (48), chickens 4 (55), a cow (91); VanG's site: pigs 13 (41), sheep 9 (48), chickens 4 (45); VanX2's atlas within 176:
    sheep 10-20, pigs 14, chickens 5-6, a cow. Entity data in the snapshot covers only ~15-30 chunks a site.
  - Breeding: feed two adults (`bot.activateEntity` with the item held), ~5 min before they breed again, a baby grows
    ~20 min; animals tick only near agents (lesson 92). Eggs: a chicken lays one every 5-10 min (vanilla; check the jar).
  - The chore pattern to follow: MineflayerWorld.slotChores (one chore a village at a time, the `chores` lock from the
    actions' own state, `idleWorker`, back-offs), after completion only; staged tests with `--mayor --after N`; a fixture
    can `summon chicken X Y Z` by RCON near the site for a deterministic test.
  - Unknowns to settle live before designing (a Gus test on the test world): whether chickens follow a bot holding
    seeds, at what distance and speed (a bot walks ~4.3 m/s, faster than a chicken), how to walk so they keep up (short
    hops, waits), whether a fence gate opened and closed by command keeps them in, and how to count them inside on the
    server (`execute if entity @e[type=chicken,x=,y=,z=,dx=,dy=,dz=]`).
- **Iron age**: smelt the mine's iron for iron tools, buckets (water for farms), shears (wool) and lanterns. After
  farming (the user's choice, 10-08): ore is a new gathering problem (the mine takes stone only; iron lies in seams at
  depth; atlas ores can be far or in caves) and adds smelting time to every village; its payoff is spread over buckets,
  shears, lanterns, tools and interiors.
- **Roles**: a profession per worker (farmer, miner, builder) tied to its building and named on its sign (Project Sid's
  specialisation).
- **A village that grows**: once the objective is met, the mayor plans the next houses on its own, up to the site's room.
- **Day and night**: time unfrozen; agents go home and sleep in their beds (needs beds, so wool).
- **Upkeep**: the mayor checks buildings against their designs and repairs damage.
- **Two villages**: a road between them and trade of surplus (Project Sid's economy at small scale).
- (Phase 3, talking to the mayor, stays its own phase below the plan's phases.)

**Beautifying the village (the user's request, 10-08, twenty-second session; proposed, not scheduled: the order and the
open choices are the user's).** Today a village is buildings on a levelled pad of grass, dirt paths, lamp posts, signs,
a wheat field and farm slots; its edges are the cut and fill prepare_site left. This plan gathers the decorative items
above (gardens, interior lighting, interiors, campfires and chimneys) with new ones into one programme, built the way
lamps, signs and farm slots were (each a lesson already paid for):
- **How each piece works** (the pattern of lamps, signs and slots): code places it, the model never does (lesson 1); a
  pure placer in streetPlan.ts computes the cells from the layout (off streets, door walkways, lamps, signs, farms and
  slots, 2 from every building's grid; never a structure: lesson 62), recorded on the layout and checked offline in
  `scripts/checks/street_plan.mts` over the five biomes and three plot sizes before any world test (lesson 68); one skill
  sets the blocks by command standing by the storage hut, charged from storage (lesson 44: never into a player), checked
  on the server after (R.3); its materials gathered as chores or soft tasks; run as a **chore after completion** (lesson
  93, the decision of farming and the iron age: never holding completion or the critical path), unless the user wants a
  piece counted in the objective as lamps and signs are. Staged tests on minevale3 with `--after`, then
  `render_design.py` on a saved `/api/blocks` box of the plot and a panel screenshot to judge the look (lesson 58).
- **B.1 Flower beds and front gardens** (first: cheap, natural, very visible). Flowers are collected like seeds (any
  small flower in the biome: dandelion, poppy, cornflower, wildflowers; collect already resolves plant blocks); a placer
  picks the 1-2 cells either side of each door's walkway along the house front and a ring of beds round the green's
  centrepiece; planted on grass by command, one flower an item. Later: a low fence (village wood) with a gate round each
  house's front garden, the "Gardens and fences" item.
- **B.2 Trees and hedges.** Saplings drop from the leaves prepare_site fells (today JUNK, never deposited: keep the
  village wood's saplings); plant 4-8 on the green and at the plot's corners (2+ from everything, room for a canopy) and
  let them grow (random ticks run with time frozen, only near agents: lesson 92). Hedges of leaves are not obtainable
  without shears (the iron age's shears would make them so).
- **B.3 The plot's edges blended into the land.** prepare_site's cut and fill leaves sheer steps up to its 2-block margin
  (F95's pits, the "shelf" site): a pass that turns each step over 1 block into a slope of the ground's own blocks
  (grass on top), and a 1-block grass verge between the pad's edge and the street; the stand spots and lesson 61 (never
  footing for a walk to build up to) to be checked. Costs dirt only (gathered early already, #3).
- **B.4 Light inside buildings and the mine** (the user's two lighting items, 10-06): wall torches inside each building
  on the walls' inner faces at head height (vanilla pieces' own torch cells, which the importer turns to air today, as a
  first source; a wall_torch charged as a torch and placed after its supporting wall: the lamp research's notes), and
  torches along the mine's stairs and tunnels every 6-8 cells as they are dug (coal from the mine, or charcoal; the iron
  level keeps its coal now). Lanterns instead once iron is plentiful (snowy villages' pieces use them).
- **B.5 Furnished interiors**: the importer's air back to what the economy can make (crafting tables, furnaces, chests,
  bookshelves from paper and leather: sugar cane from the farm slots gives paper; barrels, flower pots from bricks of
  clay; beds wait for wool). Per piece, from the jar's own blocks; materials by the bill (lesson 76: plan every item).
- **B.6 The green's centre and street furniture**: the meeting point's well or bell is vanilla's; add benches (stairs
  of the village wood facing the centre), a campfire (logs, sticks, coal: chimneys of cobblestone walls over a few houses'
  roofs too, the "Campfires and chimneys" item), and a notice board at the storage hut (the "stock board" item: signs
  rewritten from storage on every deposit).
- **B.7 Window boxes and shutters**: trapdoors beside windows (vanilla pieces carry some; F112's inside shutters are the
  warning: outside faces only, checked at four turns with rotate_design.py) and flower pots on sills.
- **Recommended order:** B.1, B.2, B.4 (light), B.3, B.6, B.5, B.7: visible and cheap first; edges before furniture
  because they change what stand spots and walks see; interiors last (largest bills, lesson 76). Each step: research
  (vanilla's pieces and tags for the blocks; the placer prototyped offline), a design note, a design review, the user's
  choices, code, staged test with `--after`, render, diff review, commit; a model-driven run when a piece is counted in
  the objective.
- **Open choices for the user:** chores after completion (recommended) or counted in the objective; flowers by the
  biome's own kinds (recommended) or a fixed palette; trees of the village wood (recommended) or the biome's; whether
  the edge blending may take a ring of ground outside the plot (it needs 2-4 blocks beyond the margin on steep sites).

- Stairs and fence collision in the sandbox; a real downloaded schematic; `/save` API route.
- Events carry no timestamp (the panel cannot say "2 min ago").
- Two builders drawing on the chest at once still come up short now and then (the requeue recovers).
- The pathfinder's own dirt pillars and bridges (scaffolding while walking) are left standing; track and remove them
  (felling's server check removes those in a climb column, F57).
- Whole-tree felling overshoots small tasks on 2x2 jungle trees (81 and 105 logs for 9-10-log tasks, over 5 min
  each), and a held gather task is not closed when storage covers it (F62).
- The timed review ("no step completed for 3 minutes") re-plans workers in the middle of long collects; the executor
  then queues more collects (61 cobblestone for a 31 task, F67). No timed review while a code-posted step's action
  is still running.
- ~~A bot stuck twice in a 1-deep pocket beside a plot on its way to a chest (F71)~~: explained and fixed by F147 (the
  half width's rounding at z 128), 10-05.
- ~~F148: a 12 s stand-still beside the storage hut's aisle on VanG's site~~: explained and fixed 10-06 (F151, the
  patched pathfinder). F133 (no reproduction; probably the same mechanism, F151).
- F150: the Mayor's sand walk through water (not reproduced 10-06 by Gus or a staged run; watch the next model-driven
  runs on -1628,65,47, whose `[stuck]` lines now carry the goal and path detail).
- The mine's doorway repaired before walking in (F131's third part; the cause, walks placing on village ground, was
  fixed 10-04; backlog by the user's choice 10-06).
- F153: the pathfinder's door branch with dirt carried, and `arrived()` without the cell above.
- ~~F155: a mayor plan of only "wait" with nothing laid out escapes the plan_layout nudge (~3 min in Minevale26).~~ Fixed
  10-06 (eighteenth session, `52f5b19`).
- F157: the Mayor stood 30 s in a 1x1 pocket on a lake shore (probably its own sand-dig hole; the pathfinder followed a
  "success" path whose first step no jump reaches, while the partial path's jump south was the way out). Self-recovered.
- F158: a stray drawn design in the library (Minevale26's "cottage") wins over the vanilla houses: gpt-oss laid out
  cottage, cottage, plains_library_2 12 times in 12 (valid, slower). The executor no longer runs stale design steps
  (F155's fix), the usual source.
- F159: street lamps know only each building's entrance door, not side doors (0 lamps on any walkway in 96 test
  layouts); stockCovers never closes requeued lamp gathering; `--stage build` stocks no lamp materials.
- The pathfinder still tunnels under plots below their protected 4 layers (StageH15: 29 andesite picked up on the way,
  a bot at y 60 under the storage hut); harmless to buildings so far.
- The hut chain: a failed prepare or storage hut build blocks the whole village until the mayor steps in (decisions
  log, 09-29).
- Not yet exercised in a run: the mayor's `add_need`, and a gather task code posts for a shortfall (V.3).
- Side pickups (V.4) rarely trigger: logs are excluded and what villages need seldom lies within 4 blocks of the
  material being gathered. Worth more with ores in the mine walls (V.6) or wider radii.
- F83: a prepare task credited for a plot prepared elsewhere (by the executor after a failure): count it done only
  when a prepared plot covers the laid-out one. (The margin half is fixed, F93: prepare_site leaves margin columns over
  a drop as they are; the plot-column error no longer says "find another site".)
- Two miners on crossing tunnels (F82): a dig aborted by the other bot counts toward an empty trip.
- Mine yield (log analysis of 10-01): branches end early at gravel pockets, gullies and the stairs' keep-off (6 of 9
  side branches of Minevale2's two later tunnels); diorite, andesite and granite are dug but do not count toward
  cobblestone (StageM7: 43 diorite); a second miner waits up to 2 minutes when the busy tunnel has no finished junction
  and both stairs-bottom turns are used (Minevale2, 28.3-30.4 min); it could take an unfinished branch instead.
- The Mayor's executor follows workers' distress chat ("I'm under attack") instead of its design steps (F84).
- ~~Fallen trees (26.1's lying logs without leaves) count as built: collect gives up on them after minutes (F94).~~
  Fixed 10-02 (F94 fixed, below F99).
- ~~find_site's wood count has a window tied to the bot's height like F88's (`floorY = bot y - 16`, mcBuild.ts ~866): a
  bot on a hill misses a valley site's trees, one in the mine counts buried logs (T.3 review).~~ Fixed 10-02 (F98).
- find_site's log search stops at 4,096 logs within 128 blocks: in dense woods (~8,000) its wood counts run ~30% low
  (F98). Harmless while sites pass the 30-log bar; matters if wood is ever compared closely.
- ~~Kelp reaching the water's surface makes `surfaceAt` pass down to the seabed and read a lake as dry ground (T.3
  review; site.py treats kelp as water).~~ Fixed 10-02: kelp and seagrass are liquid to `surfaceAt` (checked over
  seagrass at -1686,488 on the test world; the test world has no kelp reaching the surface).
- Post no gather task for a material collect cannot reach (sand under collect's floor, F96), or let a failed soft task
  go without at once; a futile collect's two `findBlocks` passes block the event loop ~1-2 s.
- A build whose needs storage already covers waits for its open gather tasks (F97: 1.3 min): close them.
- After prepare_site's job, check the plot's columns on the server and redo what is missing (F95's follow-up; also
  catches placements refused at 2x, F92).
- More from the T.3 reviews (10-01), not yet seen in a run: (a) `surfaceAt` still floors its scan at bot y - 48, so a
  valley far below the surveying bot reads as yHint - 48 "air" (penalised as built, not taken as flat; passing the
  neighbouring column's height as the hint would fix it); (b) its climb stops at the first plain `air`, so a large
  noise cave inside a hill (plain air, not cave_air) can read as the ground (neighbours differ, so the site reads as
  steep rather than flat; a guard: two airs 16 apart, or sky light); (c) prepare_site now also leaves deep ponds in the
  margin as they are: a builder stepping out of the footprint may land in one (the rescue handles it).
- `stage_village.py`: options before the coordinates (`V --stage build X Z`) are refused since `--site` made X Z
  optional (no caller uses that order). `scripts/bench/atlasbench.mts` creates a bot without `timeScale`.
- ~~A "drop" test site: the probe at -1656,-152 settled on the low ground, so no staged run has yet met a plot against a
  drop or a mine's main tunnel meeting a hillside on purpose; record a site on the y 95 shelf by hand.~~ Done 10-02:
  "shelf" in `scripts/test_sites.json` (run with `--buildings testhut,testhut,testhall`; Shelf2 passed).
- Narrow the pre-existing Windows firewall rule for Node.js (any TCP, any address) to the local subnet.
- Check scripts that still call the main world only (no `MCAI_API`): `mine.py`, `atlas.py`, `atlas_ores.py`,
  `find_site.py` and others (`site.py`, `fell_trees.py`, `walk_speed.py` take it). Add it when one is needed on the
  test world.
- Atlas site scores (review of 2.3, harmless for ranking): zero sand costs +20 but one block only +8.7; chunk distances
  are on the chunk grid (±16 blocks); atlas log counts include logs in builds and high canopy; a redundant `pad` copy.
- Kelp test spots for later (offline search 10-02; the test world has no kelp reaching the surface, only shallow
  seagrass at -1686,488): main world, a treeless island at -434,304 (kelp at -427,62,308 over a seabed at 61;
  `site.py -434 304 13`) and kelp 3 blocks off shore at -293,62,90 (seabed 57).
- Small tools kept from the eighth session: `scripts/checks/top_map.py` (offline top-ground map; found F95's pits) and
  `scripts/checks/region_logs.py` (logs with their axis, for fallen trees).
- F102: fellTree's swallowed refill failures; a stray dig at a plot's margin.
- V2.5's leftovers (10-05): F140 (collect refusing items it can never get), F141 (resin plans), F142's hand rules
  (water regexes, the craft hint, stems in charcoal, partial-shape waterlogged solids, tinted glass in renders);
  `treeAt` crawling plain oak_log frames of a building beside a tree (lesson 30: skip structure cells, as collect's
  `keep` does); red sand for glass with an `any:sand` family (collect and gatherNames would have to learn it); the
  stonecutter (stairs 1:1 instead of 6 blocks for 4). After a Paper or minecraft-data upgrade run
  `vanilla_tags.mts`, `vanilla_recipes.mts` and `vanilla_drops.mts` (tags and recipes exit 1 on problems).

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
| 09-29 | felling checks 1-8 | Gus collects logs 3x12 (`fell_trees.py`): jungle edge -580,-200, oak/birch -380,20 and -400,45, fresh woods -620,-240 and -660,-280 | from 27-log trunks half cut to every tree whole | 1-2 min a round | F55, F56; check 1-5 also felled Accept15's log frames (restored) |
| 09-29 | StageT1 | staged full, testhut + testhall, felling | stopped at 3.6 min | 3.6 min | the runner's 3-minute stall rule: a 30-cobblestone task with a pickaxe to make took longer |
| 09-29 | StageT2 | same, MCAI_STALL_MIN=5, beside Accept15 | **2/2 built** | 18.0 min | 0 failed actions, 0 "could not reach logs", 26 trees felled, Accept15 untouched; slower than StageW2 (11.1): the drop sweep chased saplings |
| 09-29 | StageT3, T4 | same, hills -769,-384; oak woods -443,-22 | stopped at 3.6 / 6.1 min | | the runner stopped on "no sand" three times (a soft failure by design; the runner now ignores it) |
| 09-29 | StageT5 | same, oak woods -447,-60 | **2/2 built** | 13.0 min | only soft sand failures (windows open); logs-only sweep |
| 09-29 | Fell1 | model, 2 workers, qwen3.8 worker planner, jungle-edged woods -664,-169 | **3/3 built**, declared complete by code | 23.1 min | 4 failed actions: 3 soft sand (windows open), 1 "could not reach logs" (a capped jump, F57); 1 worker executor call; 4 log tasks covered by storage surplus |
| 09-29 | StageH1 | staged build, testhut + storage hut, -593,178 (jungle, fresh) | **2/2 built**, hut around 3 stocked chests | 1.1 min | deposit check: 8 kinds sorted into 6 chests (3 crafted), 1 log left over (F58); the check itself misread `/api/block` |
| 09-29 | StageH2 | same after the first review's fixes, -598,154 | **2/2 built**, deposit check passed | 2.0 min | the same 1 log left over: taken for a chest, its group already done (F58) |
| 09-29 | StageH3 | staged full, testhut + testhall + hut, -656,190 | stopped at 11.4 min | 11.4 min | a gatherer's crafting table inside the hut footprint raised its floor; the new guard refused to build over the chests (F59); a fifth chest tried (F60); 1 cobblestone into the last free chest (F58) |
| 09-29 | StageH4 | same after F58-F60 fixes, -744,72 | **3/3 built** | 14.7 min | runner stopped at 10.2 min (two 2x2 jungle trees felled for 9-10-log tasks, 81 and 105 logs, >5 min each: F62), followed on to the end; only soft sand failures; hut interior clean |
| 09-29 | StageH5 | staged build after the third review's fixes (tables and furnaces reused within 32 blocks, village ground by height), testhut + testhall + hut, -795,277 | **3/3 built**, deposit check passed | 4.2 min | 1 self-healed shortage (8 cobblestone: two builders' furnaces at once, as F9) |
| 09-29 | Hutvale1 | model, 2 workers, qwen3.8 worker planner, jungle -798,247 (next to StageH5) | stopped at ~5 min | 5 min | laid out hut + hall + 2 cottages on 23x23 at 1.4 min; storage chests in the hut; then "no cobblestone within 96 blocks" from the middle of the plot (F64) and a gather task marked done by the storage task's deposit (F65). Left a shaft in its plot at -795,247 (from the collect checks after, F66) |
| 09-29 | StageH6 | staged full after F64-F66 fixes (plots protected from digging, collect steps off), testhut + testhall + hut, birch woods -874,292 | **3/3 built** | 16.9 min | 0 failed actions, 0 lag lines, every window glazed; cobblestone mined beside the plot |
| 09-29 | Hutvale2 | model, 2 workers, qwen3.8 worker planner, birch woods with sand -959,359 | **4/4 built** (storage hut, hall, 2 cottages), declared complete by code | 18.8 min | 0 failed actions; hut built at 11.4 min, around 4 chests; storage sorted throughout; every window glazed; the workers' planner never called. **V.1/V.2 accepted** |
| 09-29 | StageH7 | staged build, V.2b (table and furnace in the hut), -944,331 | stopped at 3.1 min | 3.1 min | hut built with both stations; the builders could not get into the hut to smelt: no bot can pass a door (F69) |
| 09-29 | StageH8 | same, pathfinder opens doors, hut with an open doorway, -1103,260 | **3/3 built** | 3.3 min | glass smelted in the hut's furnace; deposit check failed: a chest for planks not made from 6 oak + 2 birch planks (F70) |
| 09-29 | StageH9 | same after F70, -919,240 | **3/3 built**, deposit check passed | 3.2 min | 3 chests crafted at the hut's table; no furnace put down outside |
| 09-29 | StageH10 | staged full, V.2b, -1053,112 | **3/3 built** | 22.6 min | no furnace put down, 1 table (the storage task's, before the hut); Worker1's deposit stuck twice in a 1-deep pocket south of the plot, ~5 min lost (F71) |
| 09-29 | StageH11 | staged build after the fourth review's fixes (F72), -1133,246 | **3/3 built**, deposit check passed | 3.1 min | no table or furnace put down outside the hut |
| 09-29 | StageH12 | staged full, V.3 first version, -1035,61 | **3/3 built** | 16.2 min | needs listed from 110 logs / 177 cobblestone / 9 sand down; closing tasks village-wide released the hut and the hall short (2 self-healed shortfalls, F73) |
| 09-29 | StageH13 | same after the V.3 review's fixes, -1047,33 | **3/3 built** | 16.1 min | 0 failed actions; the list only went down (177 cobblestone to none); no task posted or closed by code (none short); every window glazed |
| 09-29 | Hutvale3 | model, 2 workers, qwen3.8 worker planner, oak woods -1138,379, with V.2b and V.3 | stopped at 23.6 min | 23.6 min | layout only at 5.7 min (the mayor copied the hut's workstations into its hall brief: 3 designs refused, F74); hut built at 16.1; then Worker1 looped on stone beside a water pocket east of the plot (rescued by teleport once, 5 failed collects, F75) |
| 09-29 | StageH14 | staged full, V.4 (side pickups), hills -1274,-133 (y 87, birch) | 2/3 built, stopped at 12.4 min | 12.4 min | hut at 6.6 min (fastest yet), hall at 10.5; the testhut's ground held a bee nest left floating at y 92 by the plot's felling (F76); no sand here and no side pickups (V.4 not exercised) |
| 09-29 | StageH15 | staged full, V.4, acacia -43,46 (near spawn) | **3/3 built** | 23.2 min | 1 failed action; no side pickups; 29 andesite deposited (dug by the pathfinder tunnelling under the plot below its protected 4 layers: a bot at y 60 under the hut) |
| 09-29 | StageH16 | staged build with the mine, -1243,252 | **4/4 built** | 4.0 min | stairs 5 steps to stone in 0.6 min; then collect in the mine: 19 cells, 36 dirt and 10 cobblestone (tunnel in the dirt over the stone), and a fallback outside got stuck: stairs now go on until the tunnel cells are stone, no outside fallback |
| 09-29 | StageH17 | same after that, -1328,204 | **4/4 built** | 3.2 min | collect 20 cobblestone in the mine: 21 in 26 s (11 cells); walked out and deposited |
| 09-29 | StageH18 | staged full with the mine, -1344,15 | **4/4 built** | 13.6 min | every cobblestone task from the mine (209 cobblestone, 131 cells, 12 coal and 12 copper ore seen); 1 failure: copper ore needs a stone pickaxe (now dug through) |
| 09-29 | StageH19 | staged full after the mine review (7 steps, village ground, ceilings), -1399,-61 | **4/4 built** | 20.8 min | stairs 7 steps in 2 min; 80 cobblestone from 45 cells, then the main tunnel met a hillside (no ceiling) and the whole mine stopped: later cobblestone outside again (F77) |
| 09-29 | Hutvale4 | model, 2 workers, qwen3.8 worker planner, birch woods -1256,19, everything (storage hut with stations, needs list, side pickups, mine) | **5/5 built** (mining hut, storage hut, hall, 2 cottages 7x7), declared complete by code | 19.2 min | 2 failed actions (the storage task's table refused on wildflowers, F68; recovered); mine: 7 steps to y=57, 250 cobblestone from 139 cells, none gathered outside; 1 side pickup (sand); executor prompts over the 8k context 3 times (F78) |
| 09-29 | StageH20 | staged build after F68 and F78 fixes, -1457,250 | **4/4 built**, deposit check passed | 3.1 min | stairs in 0.8 min |
| 09-29 | atlas checks | Gus walks 150 blocks (oak woods -405,5; the lake at -235,-53), `scripts/checks/atlas.py` | 12/12 chunks match `/api/block` | 1-3 min each | 0.1 ms a summary; F53 |
| 10-01 | mine check H19 | `scripts/checks/mine.py StageH19 3 24` (V.5b: StageH19's mine, stopped at a hillside, resumes) | **PASS** 3/3 rounds | 4.3 min | 24-25 cobblestone a round in 79/38/125 s, all in the mine; the east turn ended 2 cells in (no ceiling), the west one dug 163 cells, then a south turn at its first junction; 0 cells changed outside the planned ones (30,276 compared); 203 dirt against 157 cobblestone (F79) |
| 10-01 | StageM1 | staged build with V.5b, -1176,104 (site found at -1103,232) | **3/3 built** | 2.1 min | stairs 7 steps to y=64, leg 0 recorded; the deposit check failed on a race in the script (the mine task's own deposit took the gift and sorted it right); the check now waits for the worker's task |
| 10-01 | mine check H19b | after the first review (empty trips, short reasons, open air beside a cell), 3 rounds | **PASS** | 8.3 min | round 1: 17 cobblestone in 361 s, a south tunnel ran 280 cells through dirt (Gus carried 412 dirt): F79 is worse than it looked; rounds 2-3 24 each in 48-75 s |
| 10-01 | mine check H19c | with "no stone ends a tunnel" and the stairs down, 4 rounds | FAIL round 1, rounds 2-4 PASS | 4.1 min | round 1 (from the hut): the pathfinder cut a 2-high shortcut from the hut to the face through unplanned ground (F80); 103 cobblestone for 9 dirt in four rounds |
| 10-01 | mine check M1 | StageM1's only tunnel marked ended (test edit in villages.json): the stairs down | **PASS** 3/3 | 1.7 min | stairs 6 steps on down, y 64 -> 58, then a level-2 tunnel; from the hut with the no-dig walk (`walkMine`) |
| 10-01 | mine check H19d | with `walkMine`, 2 rounds from the hut | **PASS** | 1.2 min | round 1 in 36 s (155 s with the shortcut), no dirt |
| 10-01 | StageM2 | staged build, -1160,488 (site -1202,500) | **3/3 built**, deposit check passed | 2.2 min | stairs 7 steps to y=57 |
| 10-01 | mine check Hutvale4 | after the second review (digCell never walks, stairs-down strikes and deadline); Hutvale4's 139-cell tunnel marked ended (test edit) | **PASS** 3/3 | 1.8 min | stairs down 6 steps under the dug tunnel, y 57 -> 51; 72 cobblestone in 92 s |
| 10-01 | StageM3 | staged build on the final code, -1176,520 (site -1190,564) | **3/3 built**, deposit check passed | 2.3 min | stairs 7 steps to y=57 |
| 10-01 | StageM4 | staged full, hills -1144,-168 (site -1164,-125) | stopped, 0/3 built besides the mining hut | 7.9 min | dig_mine failed once out of reach (F81); then two workers mined one tunnel at once and the second went for cells the first had not dug: "no path" three times (F82) |
| 10-01 | StageM5 | staged full after one-miner-a-tunnel, -1304,-248 (site -1348,-230) | stopped | 4.2 min | dig_mine failed three times: the walk onto the step under the hut's wall fell short and the bot stood on the ground above it (F81) |
| 10-01 | StageM6 | staged full after approach and holding fixes, hills -648,-328 (site -740,-391, y 111) | **3/3 built** | 9.5 min | every cobblestone from the mine (5 trips, 107), none outside; the second miner turned its own tunnel off the busy first one; no main tunnel met a hillside |
| 10-01 | StageM7 | same, valley edge -824,-504 (site -695,-402, y 102) | **3/3 built** | 11.7 min | all cobblestone from the mine (131 and 44 diorite), none outside; one wait of 2 min for the busy first tunnel ("the mine is busy"; fixed after: a second face at the stairs' bottom); no main tunnel met a hillside |
| 10-01 | mine check H19e | regression after the last review fixes | **PASS** 2/2 | 1.3 min | |
| 10-01 | StageM8 | staged full, -1512,360 (site -1475,334) | **3/3 built** | 9.0 min | all cobblestone from the mine (117); the second miner turned north at the stairs' bottom at once ("the east tunnel is another miner's"), no wait; no main tunnel met a hillside (three hilly sites tried, M6-M8: the stairs face the nearest plot edge, where the ground rarely drops) |
| 10-01 | Minevale1 | model, 2 workers, qwen3.8 worker planner, -840,136 (site -829,257, jungle edge) | stopped | 3.1 min | prepare_site refused a ravine at the layout's margin; the executor prepared a plot 43 blocks away and the task counted done (F83); no mine reached |
| 10-01 | Minevale2 | model, same, -888,-456 (site -828,-348, hills at y 95) | **5/5 built** (mining hut, storage hut, hall, 2 cottages), declared complete by code | 37.8 min | every cobblestone from the mine (none outside); the first tunnel met a hillside after 28 cells ("open air beside", a hillside) and the mine turned; one 2-minute "mine is busy" wait; slow elsewhere (log analysis): the watcher spawned everyone at y 90 inside the hill (ground y 100): both workers suffocated and respawned at the world spawn ~900 blocks away (F84), the Mayor landed in a cave and chased their "under attack" chat, layout at 7.0 min; the plot "not loaded" and Worker2's "0 of 10 logs" were their walks back; 5 pickaxe remakes felled trees outside while storage held 100+ logs (F85); 10 failed actions, no sand within 96 |
| 10-01 | mine check M8 + V.6 | `mine.py StageM8 2 24`, then `scripts/checks/atlas_ores.py StageM8` (V.6 applied) | **PASS**, 5/5 chunks match | 1.6 min | the atlas's exposed ores (kinds, counts, y ranges) equal the blocks in all 5 of the mine's chunks; summary cost median 0.40 ms, p99 1.24-1.36, max 2.94 (was 0.1 surface only); `?all=1` 1.40 MB for 5,920 chunks (ores add ~53 bytes a summarised chunk); rechecked after the review's fix (marks before a chunk's first summary) |
| 10-01 | mine check M8c/d | no pickaxe given (F85 fix): makePickaxe from the storage | **PASS** | 1.0-2.2 min | a stone pickaxe from 3 cobblestone and oak logs withdrawn, crafted at the hut's table; 24 cobblestone in 52-81 s |
| 10-01 | Minevale3 | V.7 run 1: model, 2 workers, qwen3.8 worker planner, oak and birch woods -1544,8 (site -1600,-35) | **5/5 built**, declared complete by code | **14.4 min** | **0 failed actions**; layout at 1.5 min; every cobblestone from the mine (11 trips, 16-30 each, ~0.5 min); agents spawned on the ground (F84 fix); fastest village yet |
| 10-01 | Minevale4 | V.7 run 2: same, -1576,168 (site -1596,181) | **5/5 built**, declared complete by code | **12.2 min** | **0 failed actions**; 8 cobblestone trips, all from the mine |
| 10-01 | Minevale5 | V.7 run 3: same, -1208,-296 (Mayor's site -1176,-360) | stopped | 8.8 min | find_site reported "ground y=101, height range 0, 0 tree blocks" where the ground is at y 119 with a 9-block drop at the edge: prepare_site refused 4 times, the executor looped on find_site (F88); slow layout (7.0 min: hall design with a furnace refused, an Ollama 500) |
| 10-01 (s7) | T.1 mine check, 1x | `PICKAXE_WAIT=0 mine.py StageM8 2 24` | **PASS** | 92 s | round 1 55 s (stone pickaxe from storage), round 2 28 s (20 cells) |
| 10-01 (s7) | T.1 mine check, 2x | same, `MC_TIME_SCALE=2` (tick rate 40) | **PASS** | 99 s | round 1 58 s, round 2 32 s (38 cells); no faster: mining is digging, and digs stay in real time (F91); no rejected moves or digs, no `[lag]` |
| 10-01 (s7) | T.1 walk check | Gus walks 14 fixed legs on StageM8's plot (`scripts/checks/walk_speed.py`) | 1.94x | 48.8 s at 1x, 25.1 s at 2x | every leg arrived; ~10 blocks/s sprinting at 2x |
| 10-01 (s7) | Fixed1 | T.2: staged full at 2x on the test world's restored site minevale3 (probe -1544,8; site -1563,-36, birch) | **3/3 built** | **7.1 min** (1x: 9-12, StageM6-M8) | 0 failed actions; plot x -1572..-1554, z -46..-26, y 64; stairs 7 steps to y 58 at 4.9 min; mine east, legs 26 and 33 cells |
| 10-01 (s7) | Fixed2 | T.2: the same after `reset_site.py minevale3`, the site from test_sites.json | **3/3 built** | **7.1 min** | **identical**: the same plot, 18 trees felled, stairs at 4.9 min, mine east with legs 26 and 33; then a restore without start: 0 of 264,191 blocks differ from the snapshot (`region_blocks.py --compare`) |
| 10-01 (s7) | site check M5 | T.3: `site.py -1208 -296 30` before and after the F88 fix (main world, 1x) | FAIL, then **PASS** | 15 s | before: "ground y=100, range 0" (Gus at y 68 + 32), real 123, range 14, 90 columns below the level; after: site -1109,-259, y 65, range 4, 344 tree blocks, all equal to the blocks |
| 10-01 (s7) | site check M1 | T.3: `site.py -840 136 30` (after the fix) | **PASS** (a WARN: 2 margin columns 5-6 down) | 17 s | site -772,51, y 70, range 4, 1445 tree blocks, all equal |
| 10-01 (s7) | Drop1 | staged full at 2x on the test world's "drop" site (probe -1656,-152; site -1706,-194, y 64) with the F88/F83 fixes | **3/3 built** | 11.0 min | 2 soft collect failures (birch scarce; a fallen tree read as built, F94); mine east, legs 25 and 32; the probe settled on the low ground, so no drop met; first pillar tries refused 3 of 4 trees, all placed on the retry (F92) |
| 10-01 (s7) | Par1 + Par2 | T.4: two staged full runs at once at 2x: Par1 in the main world (probe -1624,360; plot -1639..-1621, 377..397), Par2 on the test world's restored minevale4 (site -1578,161 recorded) | **3/3 and 3/3 built** | **6.6 and 5.9 min** | 0 failed actions in either; CPU mean ~10%, peak 47% (two Papers, two agent servers, four bots); `[lag]` 2.9 s and 4.8 s at the two probes' spawns only; Par2's mine east, legs 57 and 36 |
| 10-01 (s7) | Minevale6 | V.7 run 4 (after F88's fix): model-driven at 1x on the test world's restored minevale3 land (probe -1544,8; the Mayor's find_site chose -1564,-35, as the staged runs), gpt-oss Mayor and architect, qwen3.8 workers' planner, qwen3:30b executor | **5/5 built**, declared complete by code | **12.3 min** | **0 failed actions**; layout at 1.8 min (the hall design retried twice, plan_layout once refused before the cottage design); stairs at 8.2 min (7 steps to y 58); all 5 cobblestone trips from the mine; workers' planner never called; no `[lag]` |
| 10-01 (s7) | StageS1 | staged build at 2x, -1480,-248 (site -1495,-248, oak) | **3/3 built**, deposit check passed | **1.5 min** (1x: 2.2-2.3, StageM2/M3) | 0 failures; no rejected moves in Paper's log; one 2.3 s `[lag]` at the probe's spawn (normal); the last minutes may be missing from the world (Paper killed, F90) |
| 10-02 (s8) | site checks (B, C) | `site.py` on the test world: shelf -1656,-152 before and after B; seagrass -1686,488 15 after C; find_site from Shelf2's mine (y 89) | **pass** | 7-18 s each | before B: "58 log blocks within 48" for a valley site with 1,150 tree blocks (bot at y 96); after: 846-1,064 (real 1,169 by the same rule, the rest is the 4,096 cap); from the mine 998; seagrass: the site moved one row off the seagrass column, no wet columns |
| 10-02 (s8) | Shelf1 | staged full at 2x on the new "shelf" site, testhut,testhut,testhall, with B and C | **stopped**, 2/5 (both huts) | 8.5 min | plot prepared at y 95 with 5 margin columns over the drop left; the testhall refused "ground not level (93..95)" 3 times: prepare_site left pits where trees stood below the level (F95); 12 sand collects failed (F96) |
| 10-02 (s8) | Shelf2 | same, with F95's fix | **3/3 built** (5/5 with the huts) | **10.2 min** | plot level everywhere (checked offline); mine stairs 7 steps to y 89, the main tunnel west ended at "open air beside -1675,90,-157 (a hillside)" and turned (V.5b on purpose at last), 169 cells; only failures the 12 sand collects (F96) |
| 10-02 (s8) | Drop2 | staged full at 2x on "drop" with A (fallen trees) | **stopped**, 0/3 at 8.8 min | - | Worker1 suffocated about a minute in, during its own prepare_site ("Worker1 suffocated in a wall"), respawned ~540 blocks away and dug about underground (F99); no leafless log met |
| 10-02 (s8) | Drop3 | same, with F99's guard (no block into a player) | **3/3 built** | **6.3 min** (Drop1 11.0) | 0 failed actions; the guard held prepare_site's grass 4 times for Worker2 idle at its spawn on the plot (the lift came after); no leafless log met (the F94 tree lies under the plot) |
| 10-02 (s8) | fell check, fallen row | `MCAI_API=...8767 fell_trees.py -1703 -237 6 1` on the restored drop site | **pass** | 65 s | "cut the fallen tree at -1704,67,-237: 5 of 5 logs", its stump at -1704,68,-241 left standing, then a standing tree felled (one pillar placement refused on the first try, F92) |
| 10-02 (s8) | Drop4 | same, after the guard's review (agents teleported out of the way, doors as one command) | **3/3 built** | **6.8 min** | 0 failed actions; the guard fired once (Worker2 at its spawn, teleported); the testhut's door has both halves; the fell check on the fallen row repeated (5 of 5, stump left) |
| 10-02 (s8) | site.py, atlas (2.3) | Gus at -560,-60 and -235,-53, main world, size 30 | **pass** | 4-103 s | first version: atlas candidates first (jungle -556,-156 -> -564,-165; lake -384,-60 failed, -472,-44 -> -470,-31, 238 away); after the review: the local search first (jungle: a local site, no walk), the lake from the atlas ("walked 234 blocks"); every figure equal to the blocks |
| 10-02 (s8) | Atlas1 | staged full at 2x, main world, probe -560,-60 (jungle hills, PLAN's poor place) | **3/3 built** | 8.2 min | the probe took atlas candidate -556,-156 (96 away) -> site -538,-162; 0 failed actions |
| 10-02 (s8) | Atlas2 | staged full at 2x, test world woods-sand (probe) | **3/3 built** | 5.7 min | atlas candidate -1500,-252 (range 1, 686 logs, 333 sand) -> site -1499,-253, recorded in test_sites.json; 0 failed actions |
| 10-02 (s8) | Atlas3 | staged full at 2x, test world hills (probe) | **3/3 built** | 9.8 min | atlas candidate -652,-204 (no sand) -> site -657,-204, recorded; 4 sand collects failed (none there, F96), windows open |
| 10-02 (s8) | Atlas4 | staged full at 2x, main world, probe -235,-53 (the lake), after the review's fixes | **3/3 built** | 14.2 min | atlas -472,-44 -> site -471,-41 (jungle); the storage task collected 97 logs for 10 in 6.7 min (jungle overshoot, F62/F100); one dig_mine timed out on the way to stone, the retry went on |
| 10-02 (s8) | **Minevale7** | model-driven at **1x** on the restored minevale3 site (test world), gpt-oss mayor and architect, qwen3.8 workers' planner, qwen3:30b executor, "two matching cottages and a meeting hall", all of today's fixes | **5/5 built**, declared complete by code | **11.6 min** (Minevale6 12.3) | **0 failed actions**; the same site as Minevale6 (-1564,-35); mayor 5 plans (4.7 s), 6 executor turns; workers ran code-posted tasks only (plan 0x); one 2.3 s `[lag]` at spawn; no guard events, no rejected moves |
| 10-02 (s9) | Shelf3 | staged full at 2x, shelf, testhut,testhut,testhall, R.1 first version | **5/5** | **8.9 min** (Shelf2 10.2) | 1 sand failure (was 12), the other two sand tasks closed at once, windows left open (8+1+1); the futile 128-block sand pass filtered in the search took 2.4-2.7 s (one `[lag]` 2.2 s); the mining hut still waited for a held log task (F97) |
| 10-02 (s9) | Hills1 | same on hills (3 buildings), positions-only second pass | **3/3** | 10.4 min (Atlas3 9.8, with a probe) | 1 sand failure (was 4), futile sand pass 0.6 s, no `[lag]`; testhut waited 3.3 min (6.8-10.2) for a held 12-log task while storage covered it ("NEEDED nothing"): F97 again |
| 10-02 (s9) | Drop5 | same on drop | **3/3** | **6.6 min** (Drop3/4 6.3-6.8) | 0 failed actions, no `[lag]`; the sand near the edge gathered (1 sand) |
| 10-02 (s9) | Shelf4 | shelf again, R.1 after its diff review (sand-only cascade, pass 2 512 beyond 48) | **5/5** | 9.2 min | 1 sand failure, two sand tasks closed, futile pass 1.3 s, no `[lag]` |
| 10-02 (s9) | Shelf5 | shelf, R.2 | **5/5** | 8.8 min | the mining hut taken at 2.7 min, right after the preparer's 208-log deposit, while t674 was still held; 1 sand failure, no `[lag]` |
| 10-02 (s9) | Hills2 | hills, R.2 | **3/3** | **7.3 min** (Hills1 10.4) | testhut taken at 7.0 min as the needs reached nothing (Hills1 waited to 10.2); 1 sand failure, no `[lag]` |
| 10-02 (s9) | Shelf6 | shelf, R.3 first version | **5/5** | **8.5 min** | "[prepare] 2 cells looked unlike the plan after the job; second pass: placed 2 blocks" (real holes repaired; where not logged), 1 sand failure, no `[lag]` |
| 10-02 (s9) | Drop6 | drop, R.3 after its diff review | **3/3** | **6.1 min** | 0 failed actions; nothing to redo; top_map.py after `save-all flush`: every plot column at y 65 but the mine stairs; the F99 guard moved Worker2 once |
| 10-02 (s9) | fell check, jungle | `FELL_Y=87 fell_trees.py -747 -577 10 2`, main world 2x, R.4 | **pass** | 104 s + 59 s | 21 oak logs, then 12 jungle logs; no giant felled (Atlas4: 97 logs, 6.7 min for 10); 10 high branch logs of a big oak left out of reach (F104). A first try from y 120 left Gus on the canopy (y 117), no tree reachable |
| 10-02 (s9) | Jungle1 | staged full at 2x, main world, probe -746,-576 | **stopped** | - | the probe spawned on the canopy and the land search took an oak site 220 blocks east (-527,-627): not a jungle test; R.3 repaired a fill at -528,88,-634 |
| 10-02 (s9) | Jungle2 | staged full at 2x, main world, `--site-at=-747,86,-576,31,jungle` (find_site from the ground: 2,149 logs within 48, mostly jungle; 3,068 tree blocks on the site) | **3/3** | **6.5 min** (Atlas4 14.2) | storage task's 10 logs in 0.8 min; every collect 9-15 logs from small trees, no giant felled; 1 sand failure (none within collect's rules); no `[lag]`; R.3 cleared 2 cells on its second pass |
| 10-02 (s9) | **Minevale8** | model-driven at **1x** on the restored minevale3 site (test world), standard models, "two matching cottages and a meeting hall", batch R (R.1-R.4) | **5/5 built**, declared complete by code | **15.9 min** (Minevale7 11.6) | **0 failed actions**, workers 0 model calls, one 2.0 s `[lag]` at spawn; the slower time is the mayor's designs: its first ones used sandstone (4 of 131 near; plan_layout refused, redrawn: layout at 1.7 min, Minevale7 0.7) and the redrawn ones need ~330 cobblestone (the hall alone 98; Minevale7 ~90), mined at the wall clock's pace (F91); prepare 1.4 min in both; sand gathered in short trips (7) |
| 10-02 (s9) | Scout1 | 2.4 at 2x, test world, `MCAI_NO_PROBE=1` start at the lake -235,-53 | **stopped** | - | the spawn's `spreadplayers` refused the water and the Mayor stayed where its name last stood (minevale3's site, 1,300 blocks off): F105, fixed |
| 10-02 (s9) | Scout2 | same, after F105's fix | **stopped** | - | the lake has a good 30x30 31 blocks off on the test world (177 acacia logs): verdict good, no scouting (correct) |
| 10-02 (s9) | Scout3 | 2.4 at 2x, desert -35,324 (the test atlas knew none of it) | **stopped**, 0/5 | - | verdict treeless -> one scout task (the mayor's own find_site had walked ~125 blocks and mapped 7 of 8 ring points), run as written (162 blocks, 193 chunks added), find_site re-run by code: still treeless, nothing within 256; the mayor then looped on refused layouts; F106: 5-10 s stalls (material counts in a desert) |
| 10-02 (s9) | Scout4 | 2.4 at 2x, 20,-120 (few trees), after the review's fixes | **stopped**, 4/5 | - | good site 46 off, no scouting; Worker2 underground at 4,60,-77 failed a sandstone task 4 times with "could not reach logs" (F107); hall 15.4 min (sandstone gathering) |
| 10-02 (s9) | **Scout5** | 2.4 at 2x, mountain ridge -360,-696 (offline search's pick: nearest good site 156 off by the main atlas) | **5/5 built**, declared complete by code | **9.1 min** | site found 110 blocks off (beyond the old 96 limit; unmapped land) without scouting; 1 failed action (the sand detector); the mayor's move_to to its site was refused (fixed: 256 before the first layout); 3-4 s stalls from sand/sandstone counts (F106) |
| 10-03 (s10) | search cost, desert | `search_cost.py -35 324`, main world 2x, F106 before/after | **pass** | - | materialsNear logs 2,375 -> 3 ms, stone 59 -> 4, cobblestone 39 -> 4; find_site's log searches 0.5-2.3 s each -> none over 200 ms (one 2.3 s `[lag]` before, none after); same site (-60,320) |
| 10-03 (s10) | site checks | `site.py -35 324 24` and `-349 -114 24`, main world 2x, F106 | **pass** | 36 s, 3 s | wood count exact in oak woods (226 reported, 226 real); desert 0/0 |
| 10-03 (s10) | Hills3 | hills, staged full 2x, F106 | **3/3** | 8.1 min (Hills2 7.3) | 1 failed action (the sand detector), no `[lag]` or `[search]` |
| 10-03 (s10) | Shelf7 | shelf, staged full 2x, F106 (+ column cache, cheap filters first) | **5/5** | **8.4 min** (Shelf5 8.8) | 1 failed action (the sand detector), no `[lag]` or `[search]` with sand buried under the floor; R.3 redid 1 cell (F92) |
| 10-03 (s10) | Drop7 | drop, staged full 2x, F106 | **3/3** | **5.8 min** (Drop3-4 6.3-6.8) | 0 failed actions; the near sand gathered; no `[lag]` or `[search]` |
| 10-04 (s10) | designbench before | gpt-oss, 10 per case, the old prompt and checks | 40/40 valid | 7-14 s a design | **0 pitched roofs**; survival cottage 108 gather units, hall 213 |
| 10-04 (s10) | rotate_design.py | minevale3 test site, creative, D.1 | **pass** | - | a stair-gabled 7x7 with a log beam, trapdoor and fences at rotate 0/90/180/270: 0 mismatches (facing, half, axis, open); fences join by themselves, stairs straight |
| 10-04 (s10) | StairB1 | minevale3, staged build 2x, stairhut x2 + stairhall | **5/5** | **3.0 min** | 0 failed actions; birch stairs, slabs and trapdoors crafted from storage; the hall's 72 stairs, 9 slabs, 4 shutters as drawn |
| 10-04 (s10) | designbench after (final) | gpt-oss, survival cases, all D.1 checks | 20/20 valid (9 after a retry) | 19-20 s a design | **20/20 stair roofs**; cottage 93 units, hall 172; the creative 11x11 hall case 6/10 before the solid-roof check (2 server errors) |
| 10-04 (s10) | Minevale9 | model-driven 1x, minevale3, D.1 before the solid-roof check | **5/5** | 18.2 min | 0 failed actions, no `[lag]`; the hall's roof was solid (549 blocks, 253 units: F110), the cottage's stairs all in one layer |
| 10-04 (s10) | **Minevale10** | model-driven 1x, minevale3, D.1 final | **5/5** | **14.6 min** (Minevale7 11.6, Minevale8 15.9) | 0 failed actions, no `[lag]`; stair gables on the hall (225 blocks, 72 stairs) and the cottages; workers 0 model calls |
| 10-04 (s10) | mayorbench | gpt-oss, 3 per case, D.1's mayor prompt against the code before D.1 (611faf9) | **18/27** (before 13/27) | 1-7 s a case | no case worse; the weak ones ("wait" while a layout runs, "re-post the build") were weak before |
| 10-04 (s10) | **Minevale11** | model-driven 1x, minevale3, D.1 as committed (2b4afa3 + the review's fixes) | **5/5** | **17.0 min** | 0 failed actions, no `[lag]`; a 234-block stair hall and 96-block cottages; slower than Minevale10 in its early tasks only (layout 1.9 min against 1.2, mining hut 7.5 against 6.0): run-to-run spread 14.6-17.0 |
| 10-04 (s11) | gen_designs.mts | offline, D.2: gable, hip, flat at 5x5, 7x9, 9x7, 13x13, overhang 0/1, three looks; 223 stored designs | **22/22** | - | door, stair facing, vanilla shapes (hip corners outer, gables straight), whole walls, rain and shell tests, bill; the new door rules change none of the stored designs |
| 10-04 (s11) | rotate_design.py | minevale3, creative, 2x: the D.1 house, a hip 7x9 + overhang (door west), a gable 9x7 + overhang (cobblestone, stone-brick roof, panes, door east), a flat 7x7 (sandstone, wall height 4, door north) | **pass** | - | 0 mismatches at rotate 0/90/180/270 for all four, stair shapes judged against the server (16 outer corners on the hip each turn), doors turned with the building |
| 10-04 (s11) | designbench D.2 (first) | gpt-oss, cottage + hall, 10 each, both tools, style note after the drawing rules | 20/20 valid (8 after a retry) | 12.5 / 7.6 s | 14/20 by style (cottages 6/10); retries were hand-drawn tries (row counts); styles copied the example |
| 10-04 (s11) | designbench D.2 (style first) | the same, the prompt leading with the style | 17/20 valid | 5.2 / 5.7 s | cottages 10/10 by style; 3 halls failed: `roof_material "oak_stairs"` (7 refusals) and stone-brick walls needing ~190 furnace runs, three times over |
| 10-04 (s11) | **designbench D.2 (final)** | + "oak_stairs" read as planks, furnace runs fitted by code (fitSmelts) | **20/20 valid, 0 retries** | **4.0 / 2.9 s** | 19/20 by style; halls 7 gable, 3 hip; cottage 111 gather units (D.1 93), hall 220 (D.1 172) |
| 10-04 (s11) | **GenB1** | minevale3, staged build 2x, genhut x2 (5x5 hip + overhang, panes) + genhall (9x9 gable + overhang, wall height 4) | **5/5** | **3.2 min** (StairB1 3.0) | 0 failed actions; birch stairs, slabs, doors and panes crafted from storage; the render of the built blocks matches the designs |
| 10-04 (s11) | **GenF1** | minevale3, staged full 2x, genhut x2 + genhall | **5/5** | **10.1 min** | 0 failed actions, no `[lag]` |
| 10-04 (s11) | GenB2 | as GenB1, after the diff review's fixes (foundation course, door sides, odd sizes) | **5/5** | 3.3 min | 0 failed actions |
| 10-04 (s11) | Minevale12 | model-driven 1x, minevale3, D.2 | **5/5**, 2 failed designs | 22.7 min | 0 failed actions, no `[lag]`, workers 0 model calls; a cloud 500 ended the first cottage design (no retry on a call error) and the hall failed three tries on a crafting table (the mayor briefed furniture inside, so it was drawn by hand): layout at ~4 min (1.2-1.9 before) (F115); the style cottage had a cobblestone floor as briefed (68 cobblestone, 170 units each); the hall hand-drawn (155 units) |
| 10-04 (s11) | Minevale13 | model-driven 1x, minevale3, + the F115 fixes | **stopped** at ~2 min | - | both designs by style at 0.7 min, none failed; but cobblestone-roofed cottages (221 units) and hall (322: fitSmelts turned its stone roof to cobblestone), ~760 units a village; 9x9 cottages and an 11x11 hall with overhangs needed 24x31: one cottage went to a second site whose prepare margin overlapped the first plot's reservation (2 failed prepare_site); the mayor's find_site took a site 63 blocks off (F116) |
| 10-04 (s11) | designbench D.2 (150/300) | budgets 150 a house, 300 a landmark (the user's choice) | **20/20 valid**, 5 after a retry | 3.0 / 3.7 s | all by style; the retries took code's "the same style with walls of NxM needs U" at once; cottage 124 units, hall 184 |
| 10-04 (s11) | GenB3 | staged build 2x, a site given as 30 across | **5/5** | 3.5 min | 0 failed actions; but the API dropped the designs' style, so packing by walls was not exercised (the review) |
| 10-04 (s11) | **Minevale14** | model-driven 1x, minevale3, packing by walls, budgets 150/300 | **5/5**, 0 failed designs | 23.2 min | both designs by style at 0.3 min; the architect drew the "spacious" hall at 13x13 walls (15x15, 536 blocks, 210 stairs, 295 units), so the second cottage went to a second site 29 off (laid out by code, no clash); 3 failed actions: Worker2 dug to sand under a pond 70 blocks off and was stuck at y 59 until the rescue; no `[lag]`; the render of the plot shows every roof whole |
| 10-04 (s11) | GenB4 | staged build 2x, a site given as 30 across, the style kept through the API (packing by walls exercised) | **5/5** | 4.1 min | 0 failed actions, no `[lag]`; rings of neighbours 1 block apart, every roof whole in the render |
| 10-04 (s11) | **Minevale15** | model-driven 1x, minevale3, + walls capped (houses 9, landmarks 11) | **5/5 PASS** | **16.1 min** | 0 failed designs, 0 failed actions, no `[lag]`, workers 0 model calls; one 20x27 plot; the hall by style (9x9, cobblestone gable, 213 units), the cottage drawn by hand as a flat-roofed box (63 units, F118) |
| 10-04 (s11) | designbench D.3 hand | STYLES=0 (drawing by hand only), cottage + hall, 10 each, the reviewed lint, without / with REVISE | 20/20 both | 25 / 24 s; 28 / 31 s | strong notes left: cottages 7 and 3, halls 6 and 7; with REVISE 8 shown back and 0 improved (each kept its first): shown its own open gable ends, the model redrew them open |
| 10-04 (s11) | designbench D.3 styles | both tools, REVISE=1, cottage, hall, cottage_mayor, 10 each | 30/30 | 4.1 / 5.4 / 6.5 s | all by style, 0 notes left; style designs never shown back; 2 mayor-brief cottages first drawn flat by hand came back as stair-gabled styles |
| 10-04 (s11) | Minevale16 | model-driven 1x, minevale3, D.3 (before the budget fitting) | **5/5** | 19.2 min | 0 failed designs and actions, no `[lag]`; the `[design]` log showed F118's cause: the cottage's style refused at 168 of 150, then two hand drawings; the hall hand-drawn with empty layers and open gable ends, the revision no better, so built as first drawn (290 units) |
| 10-04 (s11) | Minevale17 | model-driven 1x, minevale3, + the budget fitted by code | **stopped** at 8.4 min | - | the cottage's style shrunk to fit (7x7 to 7x5 walls, 126 units) and saved; the hall drawn by hand three times (a row count, then the roof open to the sky) and failed, then ~4 min of the mayor replanning the same step (F120); a later flat hand drawing shown back came back a style; no layout by 8.4 min |
| 10-04 (s11) | Minevale18 | model-driven 1x, + a refused hand drawing pointed at submit_style | **stopped** at 24.5 min, 3/5 | - | both designs by style at 0.4 min, layout 0.9 min (on the other site, -1507,-62), 0 failed actions, no `[lag]`; slow gathering: cobblestone ~8 a minute from this site's mine (~25 on the usual site) for a hall with a cobblestone base and floor (F121) |
| 10-04 (s11) | designbench D.3 final | + the budget fitted by code (shrinkStyle), REVISE=1, the three cases | **30/30 by style** | 2.8 / 3.1 / 4.1 s | 0 notes left, 3 retries in all (11 before) |
| 10-04 (s11) | designbench cottage_mayor | gpt-oss, Minevale15's cottage brief ("7x7 house, 5 high, oak_planks roof..."), 10 | 10/10 valid | - | 10/10 by style, all stair gables: the hand-drawn cottage of Minevale15 is not the brief's usual result |
| 10-04 (s12) | vanilla_pieces.mts | offline, the 152 house pieces of the five biomes, V2.1 after both reviews | 113 import, 105 valid, **62 pass** | - | plains 14/36, savanna 21/31, snowy 10/30, taiga 4/27, desert 13/28; passing 55-189 gather units; the rest: 33 no door (F123), over budget (taiga 15 of 19, F122), snow and ice (F125), too big (F126), door side (F124) |
| 10-04 (s12) | rotate_design.py | minevale3 test world, creative, 2x: six vanilla pieces | **5 pass, 1 3/4** | - | plains_small_house_1, savanna_small_house_4, taiga_small_house_4, desert_small_house_7, plains_library_2: 0 mismatches at four turns, stair shapes and fence sides by the server; snowy_small_house_2 lost rotate 0 to gravel on the plot (F128); rows north of the site hit water and hills (y 97-117): rows chosen from `top_map.py` |
| 10-04 (s12) | **VanB1** | minevale3, staged build 2x, plains_small_house_1 + savanna_small_house_1 + snowy_small_house_2 (birch village) | **5/5** | **2.5 min** | 0 failed actions, no `[lag]`, deposit check passed; stripped_birch_log placed (16) and charged as birch_log; render saved (`runs/2026-10-04/VanB1-render.png`) |
| 10-04 (s12) | street_plan.mts | offline, the five biomes' libraries with both huts, V2.3 | **pass** | - | "two cottages and a hall" (small, small, landmark): plains 5/5, snowy 5/5, taiga 4/4, desert 5/5 (crossing), savanna 4/5 with its 13x12 centre and 5/5 with crossing streets (plan_layout takes those) |
| 10-04 (s12) | **VanS1** | minevale3, staged build 2x, street plan, plains: plains_meeting_point_2 + plains_small_house_1, 3 + plains_library_2 + huts | **6/6** | **3.1 min** | 0 failed actions, no `[lag]`; 126 blocks of street laid by prepare_site; the centre's plaza charged as 58 dirt (fixed after the review) |
| 10-04 (s12) | **VanS2** | as VanS1 after the diff review's fixes (plaza free, south door, crossing fallback) | **6/6** | **3.0 min** | 0 failed actions, no `[lag]`; 184 blocks of street and plaza, the centre 85 blocks with no dirt |
| 10-04 (s12) | **VanS3** | minevale3, staged build 2x, street plan, savanna: savanna_small_house_1, 2 + savanna_library_1 + huts | **5/5** | **3.2 min** | 0 failed actions, no `[lag]`; crossing streets (the 13x12 centre would have left the library out); built in birch, the site's wood |
| 10-04 (s12) | mayorbench | gpt-oss, 3 per case: before V2.3's mayor line / with it | **18/27 / 21/27** | 1-4 s a case | no case worse; then 5 per case with the review's fixes and a stricter judge: 34/50, the new "vanilla library: plan_layout with siblings" 4/5; the weak ones are the old ("wait" while a layout runs 0/5, "re-post a failed build" 0/5) |
| 10-04 (s12) | Minevale19 | model-driven 1x, minevale3, V2.3 part 2 (library by biome) | **stopped** at 10.1 min | - | the mayor's empty first plan got code's find_site size=24: a 24x24 street plan, a house to a second 9x9 plot; the mayor named plains_small_house_1 twice; then the storage hut's builder pillared dirt up to its stand spot on the mining hut's roof across the street, sealing the mine (F131); a trapped miner's crafting table walled it in |
| 10-04 (s12) | **VanF1** | minevale3, staged full 2x, street plan, plains (the F131 fixes) | **6/6** | **9.7 min** (GenF1 10.1) | 2 failed deposits (a miner deep in a west tunnel found no path out until the stuck rescue walked it back), no `[lag]`, nothing placed on village ground |
| 10-04 (s12) | VanS4 | staged build 2x, street plan, after the second review's fixes (stand spot widened, dirt deposits) | **6/6** | 3.1 min | 0 failed actions, no `[lag]` |
| 10-04 (s12) | **Minevale20** | model-driven 1x, minevale3, V2.3 complete (d14fa53) | **6/6 PASS** | **18.0 min** | 0 failed actions, no `[lag]`; the mayor's own find_site size=32 took the other site (-1508,-63, F121's slow mine: Minevale18 there had 3/5 at 24.5 min); 2 mayor plans, 0 designs drawn: plains_small_house_1 and 2 (siblings) and plains_library_2 as the hall, round plains_meeting_point_2; workers 0 model calls |
| 10-04 (s13) | VanF2 | minevale3, staged full 2x, street plan, plains (VanF1's command, before V2.3m) | **6/6** | **10.9 min** | 0 failed actions; the same-day baseline (VanF1 9.7) |
| 10-04 (s13) | **VanM1** | as VanF2 with `--mayor --planner none` (V2.3m, before the diff review) | **6/6** | **7.5 min** | 0 failed actions; the Mayor 6 gather tasks (1 log, 4 cobblestone, 1 sand); hand-back checked through the memory API (task open, no try, logs deposited; one executor call for the check's own step) |
| 10-04 (s13) | **VanM2** | as VanM1 after the diff review's fixes | **6/6** | **8.0 min** | 0 failed actions, the Mayor 8 gather tasks (log, dirt, 2 sand, 4 cobblestone), 0 model calls; hand-back again (deposit by the task's item); the mine never busy |
| 10-04 (s13) | **Minevale21** | model-driven 1x, minevale3, V2.3m (b716f33) | **6/6 PASS** | **15.0 min** | the mayor's find_site took -1508,-63 (Minevale20's slow-mine site): 18.0 -> 15.0 min; the mayor 8 gather tasks (2 log, 5 cobblestone, 1 sand), plan 2x / exec 2x (its first plan only); 2 failed actions, both Worker1's (F133, and sand none within 96: the soft path); no `[lag]`, no busy mine |

| 10-04 (s13) | prepare_site 40x40 | test world 1x, Gus (buildSpeed 1), find_site size=40 from minevale3's site (V2.4's measurement, the cap raised to 40) | done | find_site 3.0 s; prepare_site **9.6 min** | the 40 site at -1657,64,23 (old-growth birch, 111 blocks from the probe; minevale3's sites are 32 wide), 787 placed, 3709 cleared, 51 trees; ~450 s of it pacing at 10 blocks/s, so ~2.5-3 min at a worker's buildSpeed 4 (a 32 pad 2.1 min in Minevale21); no `[lag]` |

| 10-04 (s13) | street_plan.mts PLAN=green | offline, 40 pad, the five biomes' libraries with both huts (V2.4) | **pass** | - | plains, savanna, snowy 6/6 (7/7 with five houses), taiga 5/5 (its library), desert the street plan (no centre); plains' ring 3 blocks south of the middle (the storage hut north of it); the street plans at 32 and 40 identical before and after the refactor |
| 10-04 (s13) | **VanG1** | test world 2x, the 40 site (-1657,64,23, `--site-at`), green, plains, `--mayor --planner none` | **6/6** | **8.1 min** | 0 failed actions, no `[lag]`; prepare_site 40x40 in 1.3 min (5417 blocks, 340 of street); the Mayor 7 gather tasks; render `runs/2026-10-04/VanG1.png` |
| 10-04 (s13) | **VanG2** | as VanG1, snowy (snowy_small_house_3, 6, snowy_library_1) | **6/6** | **8.1 min** | 0 failed actions, no `[lag]`; four spokes across the green (the snowy centre's four connectors); render `VanG2.png` |

| 10-04 (s13) | VanG3 | as VanG1 after the diff review's fixes | **6/6** | 10.8 min | 4 failed actions, none from V2.4's code (F136, F137): Worker2 trapped in a flooded hole it dug at the lake shore north of the plot (3.9 min), the Mayor in a flooded sand tunnel under the lake bed (3.8 min) |
| 10-04 (s13) | sand_check (scratch) | test world 2x, Gus collects 6, then 20 sand from the green's storage spot beside the lake (F137's fix) | **pass** | 12 s, 46 s (60 s after the review's fixes) | shore sand only; the lake-bed box (x -1672..-1660, y 58..62, z -14..-4) unchanged |
| 10-04 (s13) | VanG4 | as VanG1 with F136/F137's first fixes | **6/6** | 9.6 min | the Mayor 0 failed; Worker2 stuck again 1.7 min in a dry 1-deep hole beside the shore birch (-1656,62,-5: the side pickup's two dirt pits, no water now) until the rescue walked it out (F138) |
| 10-04 (s13) | **VanG5** | as VanG1 with F136-F138's fixes (and the review's: seagrass and kelp as water, fresh position, unloaded sides wet) | **6/6** | **8.4 min** | 0 failed actions; side pickups still bring dirt (from banks); the Mayor 6 gather tasks |
| 10-04 (s13) | **Minevale22** | model-driven 1x, minevale3 (the watcher's probe with site size 40), V2.4 + collect fixes (bb48ec0) | **6/6 PASS** | **15.2 min** | the mayor's find_site size=40 took -1628,65,47 (40x40, 1162 logs within 48, 12 blocks from the probe's site), laid out round a green at 0.2 min (the ring 3 blocks south); prepare_site 2.5 min; 0 failed actions, no `[lag]`; the mayor 9 gather tasks, plan 2x / exec 2x; render `runs/2026-10-04/Minevale22.png` (Minevale21's 32 street plan on the slow-mine site: 15.0) |
| 10-05 (s14) | offline checks | V2.5 before/after: materials.mts, gen_designs.mts, vanilla_pieces.mts, street_plan.mts PLAN=green SIZE=40, vanilla_tags/recipes/drops.mts | **pass** | - | materials: 5 lines (stone from plain cobblestone, same totals); the rest unchanged; jar missing: materials byte-identical, every list its old regex; all 1,506 items planned in 33 ms (no cost-search hang); waterlogged table 0 mismatches against prismarine-block |
| 10-05 (s14) | site.py | test world 2x, minevale3 probe -1544,8, size 32, before / after the tag lists | **PASS / PASS** | 18 / 19 s | 0 failures, 0 warnings both; after: the site 2 blocks east (-1560 for -1562), 1565 tree blocks and 1195 logs for 1492 and 1220 (bee nests in the birch woods no longer read as built ground) |
| 10-05 (s14) | fell_trees.py | test world 2x, -1544,8, 12 logs x 2 rounds, old code / new code | **same trees** | 113 / 125 s | the same four trees in the same order; 13 logs left beside the third (a separate trunk 2 blocks off, both runs); the new run left 1 pillar dirt after a refused placement (F139) |
| 10-05 (s14) | **VanG6** | test world 2x, the 40 site (`--site-at`), green, plains, `--mayor --planner none`, V2.5 | **6/6** | **8.3 min** (VanG5 8.4) | 0 failed actions, no `[lag]`; prepare_site 1.3 min; the Mayor 18 tasks |
| 10-05 (s14) | **VanM3** | test world 2x, `--site minevale3`, street plan, plains, `--mayor --planner none`, V2.5 | **6/6** | **8.3 min** (VanM2 8.0) | 0 failed actions, no `[lag]` |
| 10-05 (s14) | **Minevale23** | model-driven 1x, minevale3 (probe size 40), V2.5 (34e205b) | **6/6 PASS** | **14.9 min** (Minevale22 15.2) | the mayor's find_site took -1628,65,47 (Minevale22's site), green layout at 0.2 min; 0 failed actions, no `[lag]`; plan 2x / exec 2x, 0 designs; render `runs/2026-10-05/Minevale23.png` (jar colours) |
| 10-05 (s15) | pit_repro (scratch) | test world 2x, minevale3, the shore birch felled and VanG4's pits dug, Gus idle, `move_to` -1645,64,6 (east) | **out** | 2.1 s | first try: east out of the pit at once (as VanG4's rescue) |
| 10-05 (s15) | pit_repro (scratch) | as above, `move_to` -1660,64,11 (VanG4's logs chest, SW), four start spots x2 moves | **stalls** | 10.2 s a move | stuck at -1656,62,-5 from -1655.5,62,-4.5 (both moves, then the rescue walked out east in 2 s); -1655.5,-5.5 out in 3.1 s; the two off-centre spots were artefacts (F144) |
| 10-05 (s15) | pit_deposit_before (scratch) | as above from -1655.5,62,-4.5, village PitTest with one chest at -1660,66,11, `deposit item=logs` x2, old code | **stalls** | 52.3 s a deposit | the reach and four side spots, 10 s each; rescue after the second (~105 s), its walk-out 30 s more (out to the north, -1655,64,-11). Baseline for items 1-4 |
| 10-05 (s16) | pit_repro, item 3 (`32f3eff`) | test world 2x, from -1655.5,62,-4.5, `move_to` -1660,64,11 x2 | **stalls** | 10.2 s a move | the `[stuck]` lines: set back ~33 times a second at y 62.42, z -4.3001, forward/jump/sprint on (F147); rescue out north after 30 s; `data get entity` gave the server's position |
| 10-05 (s16) | test_rescue pit/box/pool | test world 2x (`MCAI_API` 8767, `MC_SERVER_DIR=mc/testserver`), after item 3, item 1 and F147 | **pass x3** | 8 / 2 / 4 s | pit: the pathfinder pillars out with dirt (no rescue needed); box and pool teleported |
| 10-05 (s16) | pit_repro, item 1 + rescue order (`5861632`) | as above, `move_to` and `deposit` | **faster** | 10.2 s a move, **11.3 s a deposit** (52.3) | the rescue's first walk-out (away from the goal) out at once (30 s before) |
| 10-05 (s16) | **VanG7** | staged green, 2x, the 40 site, item 3 + item 1 | **6/6** | **8.4 min** (VanG6 8.3) | 0 failed; 2 mine stalls set back by the server (F147), retried by the mine code |
| 10-05 (s16) | **VanM4** | staged street plan, 2x, `--site minevale3` | **6/6** | **8.0 min** (VanM3 8.3) | 0 failed; 1 mine stall (F147) |
| 10-05 (s16) | **Minevale24** | model-driven 1x, minevale3, item 3 + item 1 (`5861632`) | **6/6 PASS** | **15.1 min** (Minevale23 14.9) | the mayor's find_site took -1628,65,47 (Minevale22/23's site), green layout; 0 failed actions, no `[lag]`; 2 `[stuck]` lines, both timeouts (a pickup, a 23 s walk to sand through water) |
| 10-05 (s16) | pit_repro, F147 (`cff6dbc`, half width 1229/4096) | as above | **no stall** | **2.0 s** a move, **3.1 s** a deposit | arrives at once; no `[stuck]` line |
| 10-05 (s16) | **VanG8** | staged green, 2x, F147 half width + `[stuck-world]` | **6/6** | **8.1 min** | 0 failed; one mine stall whose `[stuck-world]` found the server's block at -1636,58,34 (bot: air); one 12 s stand-still by the storage hut (F148) |
| 10-05 (s16) | **VanG9** | as VanG8 with the dig check (first version) | **6/6** | **8.5 min** | 0 failed; 1 re-dig (stone at -1649,58,25), no mine stall; F148 again at the same spot |
| 10-05 (s16) | **VanM5** | staged street plan, 2x, `--site minevale3`, the final dig check (`8c73e20`) | **6/6** | **8.3 min** (VanM4 8.0) | 0 failed, **no `[stuck]` line**; 2 re-digs, one at VanM4's stall cell (-1558,58,-57) |
| 10-05 (s16) | **Minevale25** | model-driven 1x, minevale3, all of the session (`8c73e20`) | **6/6 PASS** | **15.0 min** (Minevale24 15.1) | the mayor's find_site took -1628,65,47 again; 0 failed actions, no `[lag]`; 1 re-dig; 1 `[stuck]`: the Mayor's 23 s walk to sand through water, as in Minevale24 (F150) |
| 10-06 (s17) | **VanG10** | staged green 2x, the 40 site, F148's logging | **6/6** | **8.1 min** | 0 failed; no `[stuck]` (F148 did not show), 1 re-dig |
| 10-06 (s17) | f148_repro, f148_grid (scratch) | test world 2x, VanG10's standing hut, Gus `move_to` range 0.5 from the east | no repro | 2.6 s | aisle walks fine; targets on the table row lifted onto the roof (y 68) and searched partially (`f148_grid1.log`) |
| 10-06 (s17) | **VanG11** | as VanG10 | **6/6** | **8.6 min** | 0 failed; **F148 caught**: goal GoalNear -1659,65,8 range 3.5 (craft's table walk), "success" path ending NOT end, path empty 10 s (F151) |
| 10-06 (s17) | f150_repro (scratch) | test world 2x, Gus collects sand from -1629,38 (Minevale25's hut door), 1 and 4 rounds of 6 | no repro | 20-40 s a round | no `[stuck]`; ends on the same shore (-1687..-1692, -2..4) |
| 10-06 (s17) | **VanG12** | as VanG10, the patched pathfinder + `[repath]` (first version) | **6/6** | **8.5 min** | 0 failed; no `[stuck]`, no `[repath]`, 2 re-digs |
| 10-06 (s17) | **VanP1** | staged green 2x on Minevale25's site (`--site-at=-1628,65,47,40,birch`), final F148 code | **6/6** | **8.2 min** | 0 failed; no `[stuck]`, no re-dig; layout as Minevale25's; 3 sand tasks at ~3.7 min, no F150 |
| 10-06 (s17) | test_rescue tunnel (new case) | test world 2x, before F131 | **STILL SEALED** | 2 s | "walked out to -27,62,-35" inside the sealed tunnel (F152); a stone shell was dug through, a short tunnel gave no walk at all |
| 10-06 (s17) | pit_repro | test world 2x, F148 code, move and deposit | **no stall** | **2.1 s** / **3.1 s** | as F147's (2.0 / 3.1) |
| 10-06 (s17) | test_rescue pit/box/pool/tunnel | F148 code | pass x3, tunnel sealed | - / 2 / 4 / 2 s | the baseline for F131 |
| 10-06 (s17) | **VanM6** | staged street plan 2x, `--site minevale3`, F148 code (`bd174c1`) | **6/6** | **8.1 min** | 0 failed; no `[stuck]`, 1 re-dig |
| 10-06 (s17) | f131 sealed mine (scratch) | VanM6's mine, Gus a VanM6 member at -1554.5,58,-55.5, the mining hut's doorway sealed with dirt; F131 code | **teleported** | 2 s | "sealed in (no path home); on village ground, not dug out" to the storage hut; doorway open: walked out in 6 s, no rescue |
| 10-06 (s17) | **VanG13** | staged green 2x, F131 code (before its review fixes) | **6/6** | **7.7 min** | 0 failed; no `[stuck]`, `[dig]`, `[repath]` or `[rescue]` lines |
| 10-06 (s17) | test_rescue x4 + VanG13's sealed mine | F131 with the review fixes (`51f10a2`) | **pass x5** | 2-4 s | tunnel, box, pool teleported; pit no rescue; the sealed mine to the storage hut in 2 s |
| 10-06 (s17) | **VanM7** | staged street plan 2x, final code | **6/6** | **8.0 min** | 0 failed; no `[stuck]`, 1 re-dig |
| 10-06 (s17) | **Minevale26** | model-driven 1x, minevale3, the session's code (`51f10a2`) | **6/6 PASS** | **18.8 min** (Minevale25 15.0) | the mayor's find_site took -1628,65,47 again; laid out only at 3.3 min (F155: three "wait" plans before plan_layout, then a drawn 13x13 meeting_hall instead of plains_library_2, built in 3.2 min against 1.8); from layout to complete 15.5 min (14.8); 0 failed actions, no `[stuck]` (no F150), 1 `[repath]` (Worker1 a cell short of a tree, 1-2 s), 2 re-digs, no `[lag]` |
| 10-06 (s18) | mayorbench F155 cases | gpt-oss:120b-cloud, 10-12 samples a case, before and after `52f5b19` | - | ~1-4 s a call | Minevale26's second call 8/12 plan_layout (3 wait, 1 design), 12/12 with the reason ending "call plan_layout now"; the nudge after a wait plan 2/12 and 0/12 as it was (7 and 11 drew a design), 12/12 naming the library; with a stray drawn cottage 12/12 laid out cottage x2 (F158); old cases within noise |
| 10-06 (s18) | **Minevale27** | model-driven 1x, minevale3, `52f5b19` | **6/6 PASS** | **14.2 min** (Minevale26 18.8) | site -1628,65,47; laid out at 0.2 min on plan 2, no design drawn, the guard and nudge never fired; 0 failed actions; `[stuck]` 0, `[stuck-world]` 0, `[dig]` 0, `[repath]` 0, `[rescue]` 0, `[lag]` 0 |
| 10-06 (s18) | **Minevale28** | as Minevale27 | **6/6 PASS** | **14.4 min** | same site; laid out at 0.1 min, no design drawn; 0 failed actions; all counts 0 |
| 10-06 (s18) | **VanL1** | staged green plains, 2x, minevale3 (VanG's site), `--mayor --planner none`, the lamp code | **6/6 + 6 lamps** | **8.6 min** (VanG10-13 7.7-8.6) | lamps lit in ~18 s at the end (fences, sticks, 2 charcoal, torches made from storage); six columns grass / birch_fence / torch on `/api/block`; 0 failed; `[dig]` 1 |
| 10-06 (s18) | **Minevale29** | model-driven 1x, minevale3, `980a5cd` (lamps) | **6/6 + 6 lamps PASS** | **15.2 min** (27/28: 14.2/14.4) | site -1628,65,47; laid out at 0.2 min; buildings done at 14.2 as Minevale27; the lamp job's first try failed short of birch logs (F156: charcoal smelted the planks' logs), the executor's retry lit them 0.4 min later; 1 failed action; Mayor 3 `[stuck]` in a 1x1 pocket, 30 s, no rescue (F157); `[repath]` 1, `[dig]` 1, `[lag]` 0 |
| 10-08 (s19) | **VanS1** | staged green plains, 2x, minevale3 (VanG's site), `--mayor --planner none`, the sign code | **6/6 + 6 lamps + 5 signs** | **8.6 min** (VanL1 8.6) | signs up in ~6 s after the lamps; every sign on `/api/block` and `data get` right block, facing and wall, but the vanilla houses read "Plains small / house" (F160, fixed); 0 failed; `[dig]` 1 |
| 10-08 (s19) | **VanS2** | as VanS1, with F160's fix and the diff review's | **6/6 + 6 lamps + 5 signs** | **8.6 min** | "Mine", "Storage", "Library", "House", "House"; 0 failed; `[dig]` 1, other counts 0 |
| 10-08 (s19) | **Minevale30** | model-driven 1x, minevale3, `cfe8b8c` (signs) | **6/6 + 6 lamps + 5 signs PASS** | **15.4 min** (29: 15.2) | site -1628,65,47; laid out at 0.2 min; buildings done at 14.6, lamps in one pass by 15.1 (F156's fix confirmed), signs by 15.4; 0 failed actions; `[stuck]` 0 (F157 did not show), `[stuck-world]` 0, `[dig]` 1, `[repath]` 0, `[rescue]` 0, `[lag]` 0 |
| 10-08 (s20) | VanF2 | staged green plains, 2x, minevale3 (VanG's site), `--mayor --planner none`, the farm code | stopped at 4.5 min | - | every grass walk stalled ~11 s "stuck" (F162: the look goal never meets a plant); the Mayor 3 of 8 seeds in 1.5 min; stopped, fixed, reset |
| 10-08 (s20) | **VanF3** | as VanF2, F162 fixed | **6/6 + 6 lamps + 5 signs + farm** | **9.0 min** (VanS2 8.6) | the Mayor 8 seeds in 0.9 min, 16 by 3.8; planted 16 at 6.2 (0.1 min, hoe made from storage); every farm cell right on `/api/block`, wheat ages 0-4 at the end (it grows with time frozen); 3 failed actions, all a lake-shore pit (F166: Worker2 sealed in, teleported home); `[stuck]` 1, `[rescue]` 1, `[repath]` 2, `[dig]` 1 |
| 10-08 (s20) | **VanF4** | as VanF3, the diff review's fixes | **6/6 + 6 lamps + 5 signs + farm** | **9.2 min** | the Mayor took both seed tasks and the hoe's log; planted at 6.4; 0 failed; `[dig]` 1, other counts 0; field 0 problems, wheat 0-5 |
| 10-08 (s20) | **Minevale31** | model-driven 1x, minevale3, `24e7037` | **6/6 + 6 lamps + 5 signs + farm PASS** | **16.5 min** (30: 15.4) | site -1628,65,47 as 30, same layout and bills; laid out at 0.2; planted 16 at 11.3 (0.1 min); 0 failed actions; `[repath]` 1, other counts 0; ~1.0 min lost to the Mayor's seeds-first order (F163), 0.1 to the planting (`minevale31_analysis.md`) |
| 10-08 (s20) | **VanF5** | staged as VanF4, `e28198e` (seeds in posting order, no hoe-log task) | **6/6 + 6 lamps + 5 signs + farm** | **8.9 min** (F4 9.2) | seeds by Worker2 and the Mayor from 3.9, planted at 5.8; 0 failed; `[dig]` 1, other counts 0; field 0 problems |
| 10-08 (s21) | **VanH1** | staged green plains, 2x, minevale3, `--mayor --planner none --harvest`, the harvest code before the review fixes | **6/6 + lamps + signs + farm; HARVEST PASS** | **9.3 min** to the signs (F5 8.9) | planted 16 at 6.6; complete; field set ripe by `fill`, the chore fired at the next 30 s check (Worker1), harvest 0.5 min: 16 wheat, 49 seeds, 16 resown (ages 0-1), 5 bread + 1 wheat in storage; 0 failed; `[dig]` 1, other counts 0 |
| 10-08 (s21) | **VanH2** | as VanH1 without `--mayor` (harvest before completion), the review fixes (`f17f360`) | **6/6 + lamps + signs + farm; HARVEST PASS** | **10.5 min** to the signs (no mayor gathering: V2.3m 10.9) | planted 16 at 5.9; harvest 0.3 min: 16 wheat, 42 seeds, 16 resown at age 0, 5 bread; 1 failed action: light_streets 3 birch_fence short, self-healed (F165's family); all counts 0 |
| 10-08 (s21) | VanO1 | staged green plains 2x, opportunity #1 first version | stopped at ~1.5 min | - | the preparer's walk to the storage spot found no path (move_to's height rule missing); the storage task stayed on the board as designed; stopped, fixed (a hut layout's deposit walks to the aisle itself) |
| 10-08 (s21) | **VanO2** | as VanO1, fixed (`33b70f6`) | **6/6 + lamps + signs + farm** | **7.2 min** (F5 8.9, H1 9.3) | storage set up by the preparer at 1.4 (was 2.1-2.7), mine open at 2.4 (was ~4.35), farm planted 4.8; 0 failed; `[dig]` 1, other counts 0 |
| 10-08 (s21) | VanW1 | staged on Minevale31's site (-1628,65,47, 40, birch), 2x, `--mayor --planner none`, #1 | 6/6 + lamps + signs | 7.5 min | no village wood kind (staged sites gave none): any logs counted, so F164 did not show; the preparer felled 212 birch + 142 oak |
| 10-08 (s21) | **VanW2** | as VanW1 with `--site-at=...,birch,999` (a wood kind, as model runs) = F164's baseline | 6/6 + lamps + signs | **9.6 min** | the mining hut waited to 2.4 for birch log tasks, mine 3.4, storage hut 5.5; 136 oak unused at the end; 0 failed |
| 10-08 (s21) | VanW3 | as VanW2, F164 first version (per building in posting order) | 6/6 + lamps + signs | 7.3 min | logs covered at 1.5; library built in oak by chooseWood's fallback (no assignment); 1 failed deposit (no path out of the mine at y 59, not repeated, F170); the review found the per-building rule unsafe (H1, H2) |
| 10-08 (s21) | VanW4 | as VanW2, F164 v2 (per kind, latest buildings moved) | 6/6 + lamps + signs | 7.2 min | meeting point and house 1 in oak; house 3 moved to oak and back while house 1's builder held the oak, then built birch with oak planks (mixed); 0 failed |
| 10-08 (s21) | **VanW5** | as VanW2, F164 v3 (no undo while a build runs, one kind for a whole building) (`5f3e133` adds the final review's guards) | **6/6 + lamps + signs** | **7.2 min** (W2 9.6) | meeting point and both houses in oak, huts and library birch, every building one kind; 0 failed, all counts 0 |
| 10-08 (s21) | **VanW6** | as VanW5 + #5 (no table or furnace billed after the storage hut) | **6/6 + lamps + signs** | **7.5 min** | 55 tasks posted (57), 16 cobblestone left (42): ~26 fewer gathered; time within noise; 0 failed, all counts 0 |
| 10-08 (s21) | **VanO3** | staged green plains 2x, `--mayor --planner none --harvest`, #1 + F164 + #5 (`8724395`) | **6/6 + lamps + signs + farm; HARVEST PASS** | **7.0 min** (F5 8.9) | mining hut 1.5, storage hut 4.0, last build 6.6; harvest after completion 0.2 min (16 resown, 5 bread); 0 failed; `[dig]` 1, other counts 0 |
| 10-08 (s21) | **VanO4** | as VanO3 + #3/#4 (`0ec7e0a`, before the diff review's narrowing guards) | **6/6 + lamps + signs + farm; HARVEST PASS** | **6.1 min** (O3 7.0) | seeds taken at 0.1 while the plot was prepared, sand and dirt at 1.6-1.8 (deposited at once: storage at 1.4); lamps claimed at 5.3 while house 1 was still being built; last build 5.7; 0 failed; `[dig]` 1, other counts 0 |
| 10-08 (s22) | **Minevale32** | model-driven 1x, minevale3, `3705649` (#1 + F164 + #5 + #3/#4) | **6/6 + 6 lamps + 5 signs + farm PASS** | **11.2 min** (31: 16.5; the simulation predicted 11-12) | site -1628,65,47 as 30/31, same layout; laid out at 0.2; seeds at 0.2 and sand/dirt at 3.2-4.1 while the plot was prepared (2.9); storage set up by the preparer, no log task claimed at all; F164: both houses and the meeting point in oak (`woodFor`); mining hut 3.3, storage hut 7.3, farm planted 7.5, lamps claimed at 10.2 while house 1 was built (done 11.0); 0 failed actions, every count 0 |
| 10-08 (s22) | VanX1 | staged green plains 2x, minevale3 (VanG's site), `--mayor --planner none --fixtures --after 10 --ripen`, opportunistic farming v1 | built, complete; then **the agent server hung** | (5.7 min to the last build) | the first farm start (sugar cane) looped in collect without yielding (F174); watcher timed out |
| 10-08 (s22) | **VanX2** | as VanX1 with F174 fixed | **6/6 + lamps + signs + farm; cane and pumpkin farms started and harvested; 8 exploring trips** | **6.4 min** to complete, then 12 after | cane started 0.8 after completion (3 planted from the fixture), harvested 6 at 0.9 and 2 more at 7.9 (real growth); pumpkin started 1.7 (6 stems), 11 pumpkins at 1.9; exploring 2.4-6.5 (8 points at 160, all home); atlas: 31 animals, plants recorded; two explorers at once (F175); 0 failed, `[dig]` 2, other counts 0 |
| 10-08 (s22) | **VanX3** | as VanX2, F175 fixed | **6/6 + lamps + signs + farm; both farms; 8 exploring trips, one at a time** | **7.1 min** to complete, then 10 after | Worker2 2.6 min in a flooded lake-shore trench it dug for sand (F179; 6 `[stuck]`, no rescue): the storage hut claimed 0.7 min late; farms as VanX2; trips one after another; 0 failed after completion |
| 10-08 (s22) | **VanX4** | as VanX3 + the diff review's fixes | **6/6 + lamps + signs + farm; cane and pumpkin started and harvested; no exploring with no slot free** | **6.3 min**, then 5 after | the atlas within 176: plants cane 11, pumpkin 9, melon 1; 40 animals; 0 failed, `[dig]` 2, other counts 0 |
| 10-08 (s22) | VanI1 | staged green plains 2x, `--mayor --planner none --after 35`, the iron age (first version) | 6/6 complete; cane and pumpkin farms from wild sightings (140 and 115 blocks out) | - | the iron level "finished" at once: no clear side of the bottom step (F180); stopped |
| 10-08 (s22) | VanI2 | as VanI1, F180 fixed and the diff review's fixes | complete; farms from wild sightings again | - | the iron stairs met a cave at y 44 (13 steps) and the iron age ended (F182); stopped |
| 10-08 (s22) | VanI3 | as VanI2 with stairs retried (3 tries) | complete | - | three stairs met caves at y 44, 45, 41 (the first two 2 blocks apart); 1 raw iron and 7 coal from the stairs; 0 `[stuck]`, F179's fix held (no lake trench); stopped |
| 10-08 (s22) | VanI4 | as VanI3 with the spacing rule, 5 tries | complete | - | the second stairs settled at y 39; 87 tunnel cells in one 4-min trip, no ore (F183); stopped |
| 10-08 (s22) | VanI5 | as VanI4 with the settle rule (a level above y 28 only on the last try) | complete; 5 stairs, the fifth reached y 18 | - | four stairs met caves at 44, 38, 40 and water at 41; the fifth went 40 steps to y 18 and dug 102 cells: 3 iron ores seen, 1 raw iron, 10 coal, 11 raw copper; a worker left at y 11 dug a shaft up under the storage hut (F186); stopped |
| 10-08 (s22) | VanI6 | `--stock raw_iron:3`, F186's teleport, veins and floor ores | iron pickaxe made from storage (2.9 min after completion) | - | stopped early to take the third review's fixes |
| 10-08 (s22) | **VanI7** | as VanI6 + review 3's fixes | **complete; iron pickaxe from the stocked iron; stairs to y 18 on the fifth try; 6 raw iron from 144 cells (5 iron and 7 coal ores kept from walls, floors and veins); bucket made; 0 failed** | complete ~6.5 min, iron age 21.3 min after | a second iron pickaxe before the bucket (F184); both pickaxes worn out once (F185); `[dig]` 3, other counts 0 |
| 10-08 (s22) | **VanW7** | staged on Minevale31's site with a wood kind (`--site-at=...,birch,999`), 2x, `--harvest --after 12 --stock raw_iron:6`, F165/F169 + the made-tools fix | **6/6 + lamps + signs + farm; HARVEST PASS; iron pickaxe then bucket** | **6.5 min** (VanW5 7.2) | signs and lamps made in one pass (F165/F169 fixed); the bucket 0.5 min after the pickaxe (F184 fixed); a 1-high wild cane stalk gave no cane (soft, marked bad); all counts 0 |
| 10-08 (s22) | VanW8 | as VanW7 without `--after`, + the final review's fixes (the craft hint only when a kind looked spare) | 6/6 + lamps + signs + farm; HARVEST PASS | 7.2 min | the fences came a plank short ("could not craft 6 birch_fence ... have 3"), lit on the second pass: the hint gate reverted; 4 `[stuck]` east of the plot (F187) |
| 10-08 (s22) | **VanW9** | as VanW8 with the craft hint always passed | **6/6 + lamps + signs + farm; HARVEST PASS** | **7.5 min** | lamps, signs and the hoe each made in one pass (no "could not craft"); 0 failed, all counts 0 |
| 10-08 (s23) | **Minevale33** | model-driven, 1x, minevale3, `MCAI_AFTER=30` (gpt-oss mayor and architect, qwen3:30b executors) | **6/6 + lamps + signs + farm; pumpkin farm from a wild sighting 140 out; iron pickaxe and bucket at +22.9; crashed at +29** | **10.6 min** (Minevale32 11.2), site -1628,47 | 0 failed actions to completion; after: 2 cane starts failed (F192), 5 iron trips, 8 raw iron from 145 cells, 2 "no pickaxe left" (F190), the scout floated 4 min in a lake (F189), then the agent server crashed (F188); Worker2 and the Mayor idle 29 min (F193). `runs/2026-10-08/s23/analysis_Minevale33.md` |
| 10-09 (s23) | lure1-3 | Gus on the test world (lure tests 1-3: `runs/2026-10-08/s23/lure*.log`, `lure_facts.md`) | chickens follow seeds at 1.9-2.5; 4 led through 4-block hops; teleported to the back row, all 4 inside in ~3 s; gate closed by command holds them | - | test 1 confounded (Gus a member of the complete village got its chores) |
| 10-09 (s23) | VanP2 | staged green plains 2x, `--after 25 --fixtures`, F188-F192 | 6/6 complete; pickaxes topped up per trip; iron pickaxe and bucket | 6.5 min | the fixture cane start brought 1 of 3 (drops lost, F192's leftover); 0 `[stuck]`/`[lag]`, no crash |
| 10-09 (s23) | VanA1 | staged, `--after 15 --fixtures`, annex + pens first version | annex west of the plot ready at +1.4; the pen ring up; 1 chicken led, none in | 6.4 min | the fixture chickens on a hill 10 above the annex (F194); stopped |
| 10-09 (s23) | VanA2 | as VanA1, chickens within 4 in height, the fixture on level ground | annex ready at +1.3; no pen started | 6.1 min | storage held no seeds after the field took them (F195); iron trips instead |
| 10-09 (s23) | **VanA3** | as VanA2, start_pen gathers its own seeds | **annex at +1.6; a wild chicken led 50 blocks in 12 hops (2.2-4.0 behind) and penned at +2.6; it stayed** | **6.8 min** | 0 failed actions, 0 `[stuck]`/`[lag]`/`[rescue]` |
| 10-09 (s23) | VanA4 / VanA4b | as VanA3 + the diff review's fixes (VanA4 stopped by a machine shutdown; VanA4b after it) | annex at +1.7; a chicken led 65 blocks across the village in 16 hops, 3.7 behind at the gate, none in | 6.2 min | from the far side the chicken was 11 from the back row after the teleport, out of tempt range: entry in two steps (VanA5) |
| 10-09 (s23) | **VanA5** | as VanA4b + the two-step entry (wait at the gate until within 3; teleported 2 inside, then the back row) | **annex at +1.5; a chicken led ~80 blocks in 21 hops and penned at +3.2; birch fences made at once** | **5.9 min** | 0 failed actions, 0 `[stuck]`/`[lag]`/`[rescue]` |
| 10-09 (s23) | **Minevale34** | model-driven, 1x, minevale3, `MCAI_AFTER=20`, F188-F192 + the annex and pens | **6/6 + lamps + signs + farm; annex at +4.0; 2 wild chickens led 25 blocks and penned at +5.8; pumpkin farm at +15.3** | **10.6 min**, site -1628,47 | 0 failed actions to completion; storage hut with no "could not craft" (F191 held); 2 pumpkin starts failed on the hoe (F198); 2 iron trips (stairs to y 18, 27 cells, no iron yet); no crash in 30 min, 0 `[stuck]`/`[lag]`/`[rescue]` |
| 10-09 (s23) | **VanA6** | staged on Minevale31's site with a wood kind (`--site-at=-1628,65,47,40,birch,999`), 2x, `--after 8 --fixtures`, F198/F199 | **6/6 + lamps + signs + farm; cane and pumpkin farms, annex at +2.1, a chicken penned at +3.1** | **6.3 min** (VanW9 7.5) | 0 failed actions, 0 `[stuck]`/`[lag]`/`[rescue]`; the pen's fences "could not craft" once, recovered (F201) |

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
  ran farms, five iron trips and a scout in turn. Open: per-agent chores of different kinds.
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

## Keeping this plan honest

- **When a run shows something new**, add a finding with evidence (log line, numbers). Then decide: fix now if it
  blocks the current step; otherwise add it to the right phase or the backlog, and say why.
- **When a finding invalidates a step** (wrong cause, better approach), edit the step and add a decision explaining
  the change. Do not silently delete: strike through (`~~...~~`) and point to the replacement.
- **Acceptance criteria are concrete** (what run, what counts as passing). If one turns out to be wrong, change it in
  the decisions log, not quietly.
- Keep the "Next session starts with" section current at the end of every session, including uncommitted work and
  anything left running.
