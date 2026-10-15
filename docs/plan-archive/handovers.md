# Earlier session handovers

The "Next session starts with" notes of earlier sessions, newest first, moved here from `docs/PLAN.md` on
2026-10-15. PLAN.md keeps only the latest one.

(written 2026-10-15 at the close of the twenty-ninth session, which ran overnight: the user went to bed early on and asked
Claude to keep building and decide on its own; the next session's prompt is `runs/2026-10-15/NEXT_PROMPT.md`)

- **Done this session (s29), committed on `tiered-brain-building` and pushed at the close (the user's yes)**: `ebec76d` F224 (scouts beside a lure in instance mode; no lure in a scout's
  hand), `9c76d28` **S.9** (the workshop: make, gather, works with three furnaces, `v.tech`; behind `MC_CHOICE_FAMILIES`),
  `58fe85c` S.9's runs and F226, `43b3dec` **B.4** (light inside buildings and the mine, the workshop's first consumer),
  `c69dbe1` B.4's runs, lessons 130-133, and the close-out commit. `main` untouched.
- **What the runs say:** at 25 agents the families work (S9f: 23 agents took an S.9 chore, peak 9; B4f: 61 of 61 torches
  standing; every make matching its bill on the server's counts), but after-completion busy time is still ~4% (S9f 44.8,
  B4f 40.2 agent-minutes of ~1125), because the work is bounded by stock targets and placing by command is quick
  (lesson 130). In a 3-agent model-driven village they matter: Minevale43's after-phase was 38% busy (Minevale41 25%).
- **Open:** F228 (Minevale43's slow build, 17.8 min with 10 failed actions: not the families; the analysis in
  `runs/2026-10-15/mv43_analysis.md`), F226 (one make planned nothing; now logged and retried), F227 (fixture pumpkins),
  F218, F220, F222-F225.
- **Next (the user's choice, 10-15: Claude's recommendations):** first F228's three small fixes (F218's path to the hut's furnace,
  a smelt out of fuel taking its input back, a handed-back task depositing what it made) and a model-driven run, then the
  work that fills 25 agents, which must take agent time and grow: **a village that grows** (the backlog's item: after
  completion the Mayor lays out more houses on free land, built by the same economy; every family then has a real
  consumer, and builds take minutes of many agents), or A.3 (gauges, which also give F223 its measure), or S.10
  (surveys). `MC_CHOOSE` stays `fixed` (the user's answer at the start).
- **Stack:** the test Paper (25566) and its agent server (8767, on `c69dbe1`'s code) are left running with Minevale43's
  village; the main world is stopped. Restart the agent server after any server edit; reset minevale3 before a run.

(written 2026-10-14 at the close of the twenty-eighth session; the next session's prompt is
`runs/2026-10-14/NEXT_PROMPT.md`; the notes below for the twenty-seventh session stay valid where not overridden)

- **Done this session (s28), committed on `tiered-brain-building`, NOT pushed** (origin is at `8f91251`, pushed at this
  session's start; ask before pushing): `ef5deec` A.2 part 1 (the menu, fixed picker, model mode, guards, decision log,
  panel, `choice_golden.mts`, `choose_unit.mts`, F221's watcher retry), `31c36a5` (choicebench, exploring in instance mode
  without a free slot, the 429 back-off, effects that say what a chore is for), `d463440` (run record, F222-F225) and the
  close-out commit. `main` untouched.
- **A.2 is done** (the decision log above): model mode at 25 ran with 0 errors, 8% "taken", decision wait p90 0.9 s,
  ~$0.003 a 45-minute after-phase; choicebench 100% valid, 70/70 sensible, no position bias; Minevale42 (model mode,
  model-driven) complete in 10.2 min. The storage value cannot judge it (F223). `MC_CHOOSE` still defaults to `fixed`
  (D3 of the spec): switching the default to `model` is the user's call; the staged scripts take `--choose model`.
- **Where things stand at 25:** after completion only ~2% of agent-time is busy whoever picks (A2m 21.0, A2f2 18.8
  agent-minutes of ~1125): the menu works, the work is missing. That is the next step's job.
- **Next (Claude's decision at the close, the user asked for it):** first F224's live check (does a scout disturb a pen
  lure? if not, drop `pen` from explore's excludes in instance mode: the next ceiling on parallel work), then **S.9, the
  workshop** (`make item= count=` as a chore with instance keys `make:<item>`, offered as A.2 options; `v.tech`; the Tier
  0 goods; the works-plot question goes to the user at the start). Then S.10 (surveys) or A.3 (gauges, which also fix
  F223's measurement), the user's call.
- **Open findings:** F218 (no path to the hut's furnace cell -1657,65,8; reproduced in Minevale40, 41 and 42, always
  Worker2 at ~4.7 min: the cheapest model-driven failure left), F220, F222-F225.
- **Stack:** nothing running (the machine went down overnight; the test world is restored per site anyway). The Ollama
  app serves gpt-oss:120b-cloud; the user's session quota ran out once this session (a 429 on every call for hours):
  check with one tiny call before model work.
- **How runs went this session:** drivers in `runs/2026-10-12/a2_runs.py` and `runs/2026-10-13/a2_runs2.py` (staged
  runs with per-run env such as `MC_CHOOSE`, `MC_CHOICE_INSTANCES`, then model-driven runs with a 1x reset), detached
  with a background watcher on `ALL RUNS DONE`. Staged runs make 0 cloud calls; auto mode may still refuse a command
  naming the cloud planner while the user has paused cloud use.

(written 2026-10-12 at the close of the twenty-seventh session; the next session's prompt is
`runs/2026-10-12/NEXT_PROMPT.md`; the notes below for the twenty-sixth session stay valid where not overridden)

- **Done this session (s27), committed on `tiered-brain-building`, NOT pushed** (origin is at `c5224d6`; ask before
  pushing): `d0d6c8f` (s26's close-out, also unpushed), `475f060` E.0 (scale safety), `f22a1bc` F216/F217, `4d2d77a` E.1
  (infrastructure for 25), and the close-out commit (this record, `docs/research/memory/`, `scripts/stage_runs.py`, the
  profiling and chat helpers in `scripts/checks/`). `main` untouched.
- **Where things stand at 25:** the 25-bot probe (`scripts/checks/scale_probe25.py`) runs 10 minutes of mixed work with 0
  `[lag]`, API p90 0.048 s, Paper's tick worst 6.7 ms, RCON p90 11-46 ms a 30 s window; the agent server is ~51% idle
  (F219 fixed find_site's survey, which took 60% of the CPU). Van25a (25 agents, staged, 2x) built the village in 4.1
  min with 0 lag/stuck/timeouts but **21% busy: 16 of 25 waited while 8 mined**. The work runs out at 25: A.2 (the menu
  with instances) and the task families S.9-S.16 are what fills it.
- **Next (the roadmap's step 3, agreed order):** finish A.1's baseline (its code is in since `85ddef1`; the runs never
  happened: three staged after-phases with the fixed order and one model-driven run, metrics from
  `scripts/checks/autonomy_metrics.py`), then **A.2, the menu with instances** (spec, check, implement, review, refute,
  test; the step's two open questions go to the user first). Then S.7/S.8 or the task families, the user's call.
- **G2, long-horizon memory (started with the user this session):** the user's choices are in the decisions log
  (10-11, s27): both horizons, all four purposes, **model-managed** memory. The literature synthesis is
  `docs/research/memory/long-horizon-memory.md` (it favours: code records verifiable facts with provenance; the model
  curates through narrow ops on entries with ids, add/supersede/vote/mark_done, no rewrites or hard deletes; writes ride
  existing calls plus one consolidation call per agent per village night; code pushes a ~300-500-token core and the top
  1-3 entries into each prompt; ~0.73M tokens/h at 25 agents, ~$0.15/h). Bench v1 (`docs/research/memory/bench_v1_*.md`;
  code and data in `runs/2026-10-11/s27/memory/`) was judged **not ready** by its adversarial check (25+ probes need no
  memory, wrong answers, leaks, decision probes give the answer away, ~27 clean test probes). **Open with the user:**
  rebuild the bench as v2 to the report's section 7 (template probes from code-computed state, decision probes inside
  execbench/mayorbench, a BM25/log-search baseline, dev/test split frozen, 5 samples a probe) and run the candidate
  designs (~$1.5-2 each), or the user reads the report first and adjusts the direction. Ask once at the start.
- **Open findings:** F218 (a bot on a street's dirt_path gets "no path" to the storage hut's furnace cell, `goto`
  resolving without arriving; twice in four runs, not reproduced with `move_to`: next, `reach()`'s GoalNear range 3 on
  the hut cell from that spot); F220 (the probe's RCON figure is the worst minute; count the run's p90 over all
  commands). The 25-bot village's idle agents are a goal, not a finding.
- **Stack:** nothing running. The test Paper went down with the machine overnight without a save (its log ends at
  19:27, Van25a's end): the test world is restored per site anyway; reset minevale3 before use. The main Paper was
  stopped cleanly (whitelist Worker5-24 added). max-players 30 in both worlds.
- **How to run things now:** staged runs in a row, detached, with a watcher: `python scripts/detach.py
  runs/<date>/NAME.runner.log python scripts/stage_runs.py NAME:WORKERS` (minevale3 at Minevale37's site, the S.0
  command, a reset before each; `STAGE_ARGS`, `STAGE_TIMEOUT_S` for long after-phases), then a Bash
  `run_in_background` loop `until grep -q "ALL DONE" ...; do sleep 15; done`. Model-driven villages: as in CLAUDE.md, on
  the test world after a 1x reset (`reset_site.py minevale3` without `MC_TIME_SCALE`), detached through detach.py with a
  watcher on its `^STOPPED` line. A live human chat line: `node scripts/checks/human_line.cjs Gus 25566 "Mayor, ..."`.
  A CPU profile of the agent server: `node -e "process._debugProcess(PID)"`, then `node scripts/checks/cdp_profile.cjs
  ws://127.0.0.1:9229/<id> 40 OUT.cpuprofile` and `node scripts/checks/profile_callers.cjs OUT.cpuprofile`.
- **Method that held up again (s27):** a golden check before reviewing a refactor; four lens reviewers plus one refuter per
  finding found 3 real defects in E.0 and 12 of 20 in E.1, and a fix review found one more (the pathfinder share cut
  two bots); implementers on disjoint file sets; every staged and probe run detached with a watcher; a CPU profile when
  the numbers are bad without any `[lag]` (lesson 125).

(written 2026-10-11 at the close of the twenty-sixth session; the next session's prompt is
`runs/2026-10-11/NEXT_PROMPT.md`)

- **Goals (the user's, 10-10/11; full list in the roadmap's goals note and memory `scale-and-emergence-goals`):** agents
  that choose (Phase A); 25 agents doing many different activities in parallel, with more kinds of work (Phase S);
  Project Sid-style emergence through the brain and communication (Phase E); agents propose game improvements that
  Claude triages (G1); long-horizon memory (G2, the user wants to start its investigation together). **No more
  agent-count comparisons** (the roadmap's revision note): test each step by whether it works at 25 and does its job.
- **Pushed** (`origin/tiered-brain-building` = `c5224d6`; `main` untouched): A.0, the Phase S/E plans, S.0-S.6, the
  goals G1/G2. The close-out commit (this record, CLAUDE.md lessons 118-124, `docs/research/`) is local until pushed.
- **E.0 (scale safety): implemented, uncommitted, in the working tree** (21 tracked files + `server/src/modelCall.ts` and
  five checks in `scripts/checks/`; backup in `runs/2026-10-11/s26_e0_backup/`: `e0_tracked.patch` and `new/`). The
  implementing agent was stopped at its self-review. Typecheck clean; its offline checks pass: `call_gate.mts` 30/30,
  `board_version.mts` 23/23, `chat_route.mts` 18/18, `save_debounce.mts` 12/12, `model_usage.mts` 161/161.
  `board_golden.mts dump|check GOLDEN.json [villages.json]` needs a dump from the committed code first (stash, dump,
  unstash, check). Still to do: the self-review (adversarial, with refutation), the golden check, a staged run that shows
  nothing changed at small scale and the new lines work, then commit.
- **Then:** E.1 (spec `runs/2026-10-10/s26/spec_e1.md`: max-players 30, whitelist Worker12-24 on the test world and
  Worker5-24 on the main one, pathfinder time shared between bots, RCON timeout, `/api/perf`, the panel at 25 with
  colours by number), a 25-bot probe, a staged 25-agent village; then A.2 (the menu with instances) and the task
  families S.9-S.16, then E.2-E.7.
- **Material on disk** (`runs/2026-10-10/s26/`, gitignored): specs and checks `spec_{s1..s6,e0,e1}.md`, `*check.md`;
  `phaseS_*`, `phaseE_*` (the design workflows' research), `parallel_map.md`, `candidates_verified.md`, the literature
  notes `research_notes/`, bench logs `bench/`, run logs Van12a..j, Van3a..h, `scale_probe.py`, `baselines_s0.py`
  (staged runs in a row with resets: `python scripts/detach.py LOG python runs/2026-10-10/s26/baselines_s0.py Van12x:11`).
- **Stack:** stopped (test Paper saved by RCON stop, its agent server killed; local model servers stopped). The test
  world's minevale3 holds Van12j's village: reset before use. Test whitelist: Worker1-11 added.
- **Session method that worked:** read-only spec agents with an adversarial check; one implementer per file set; lens
  reviewers plus a refuting pass before any run; staged runs detached with a background watcher (lesson 122).

(written 2026-10-10 at the close of the twenty-fifth session: F205, F209, Minevale36 and the control panel's redesign;
the notes below for the twenty-fourth session stay valid where not overridden)

- **Code:** on `tiered-brain-building`: `15c65a4` F205 (pens take animals up to 8 above the annex, measured from the
  annex), `479b87c` F209 (water progress, scout range, teleport home from water), `2039bee`, `95fa904`, `9ca781f` and the
  icons-and-key commit (the panel's simple view, drill-down detailed view, trails, Auto framing, activities overlay,
  fullscreen, map icons and key), and the close-out (this record, CLAUDE.md lessons 113-117, README restructured as an
  AI-agent project with fresh screenshots in `docs/images/`, ARCHITECTURE). **Pushed, and `main` fast-forwarded to the
  branch** at the close (the user's instruction, 2026-10-10: `main` = `tiered-brain-building` = `0ebb540` + this note).
- **Stack:** stopped cleanly at the close. No agents in either world.
- **Where things stand:** Minevale36 (1x, model-driven, minevale3's usual site) 6/6 in **10.6 min**, **0 failed actions in
  55.7 min**; after completion: two chickens led down from +5 and bred to 5, 6 eggs, all 8 scouting trips (Worker1 passed
  Minevale35's lake point with no stall), the iron pickaxe and three buckets, and, after the wheat field was ripened by
  command at +26 min (the user's choice), a harvest, the first cow pen with real models (one cow from +6) and 3 milk. No
  cake: the cow pen stayed at one (F213) and the cake waits for 3 milk, an egg, 3 wheat and 2 sugar (no cane farm this
  run). Staged VanH3 (F205 fixtures at +6): 4 pen trips, 3 from +5..+7, a chick and two calves, 2 cakes.
- **Next (proposed; the user picks):** 1. `MCAI_RIPEN` for `watch_village.py` (ripen the field by command once, as
  `--harvest` does for staged runs) and one model-driven run to a cake. 2. F213 (a pen of one when no second animal is
  within reach: widen the cow search or lure from a scouted sighting). 3. F211 (swim to the nearest shore before walk
  legs from a shallow sea). 4. The beautifying plan (B.1) or the smaller items (F208, F201, F200, F192's cane drops, F187,
  F170-F173, F210's forceloads).
- **Panel work:** previews ran through `runs/2026-10-10/scripts/panel_proxy.py PORT` (serves a scratch copy at /panel and
  passes /api to 8767) and headless Edge (`--force-dark-mode`, `/panel#simple` or `#detailed`); the patch scripts are
  `runs/2026-10-10/scripts/panel_apply*.py`, the node render harness `panel_review2_t.cjs`. The panel file is read on every
  request, so applying it during a run does not touch the agents (done with the user's approval during Minevale36).
- **Test world state:** minevale3 holds Minevale36's village: reset before using it.

(written 2026-10-09 at the close of the twenty-fourth session: F193 per-agent chores and pens v2; the user asked Claude
to decide everything after the first question; the notes below for the twenty-third session stay valid where not
overridden)

- **Code:** on `tiered-brain-building`: `119df92` F193 per-agent chores and pens v2 (eggs, breeding, a cow pen, milk, a
  cake), and the close-out (this record, CLAUDE.md lessons 109-112, README, ARCHITECTURE). Not pushed: ask first. `main`
  untouched.
- **Stack:** stopped cleanly at the close (the test agent server by PID, the test Paper "All dimensions are saved", the
  pinned model servers). No agents in either world.
- **Where things stand:** after completion every idle member takes a chore of a kind nobody holds (workers first, then
  the Mayor); Minevale35 (1x, model-driven) 6/6 in **11.0 min**, 0 failed actions, then all three on chores at once (iron
  trips, annex, pen, farm, all 8 scouts, eggs). Pens hold chickens or cows; eggs, breeding and milking are done by
  command from beyond the gate; a cake at the storage hut once storage holds 3 milk, an egg, 3 wheat and 2 sugar. Staged
  VanC3 showed the whole chain (a chick bred, 3 x 3 milk, 5 eggs, 2 cakes). Live facts: `runs/2026-10-09/pens_v2_facts.md`.
- **Next (proposed; the user picks):** 1. F205 (pens of one: sightings above the annex) and one more model-driven run
  long enough for a wheat harvest (`MCAI_AFTER=45`) to see a cow pen, breeding and a cake with real models. 2. F209 /
  F189's dry ring points. 3. The beautifying plan (B.1) or the smaller items (F208, F201, F200, F192's cane drops, F187,
  F170-F173). The prompt: `runs/2026-10-09/NEXT_PROMPT.md`.
- **Saved from the session's scratchpad** (gitignored): `runs/2026-10-09/s24_scratch/` (`research2/cake.mts` replays the
  materials planner offline, F207-style checks; `research2/tags.mts` reads tags and recipes from the jar; `research/*.txt`
  the jar's Cow, AbstractCow, Items, EntityType, WalkNodeEvaluator disassemblies; the edit scripts and review diffs).
- **How to test now:** staged `--after 20 --fixtures --stock wheat:12,bucket:3,sugar_cane:2` (VanC3: complete at 6.3,
  pens, milk and cakes within 20 min after); `AFTER busy:` gives each agent's busy minutes;
  `runs/2026-10-09/scripts/pens_v2_facts.py` for live animal facts; `runs/2026-10-09/scripts/restart_agents.py` restarts
  only the test agent server.
- **Test world state:** minevale3 holds Minevale35's village on Minevale31's site with an annex (a chicken pen) and a
  pumpkin farm: reset before using it.

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
