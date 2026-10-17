# History

What each session did, the economy's original plan and the early milestones, moved verbatim from CLAUDE.md on
2026-10-15. Add a numbered entry per session at the end of "State of the work".

## State of the work

Branch `tiered-brain-building`, pushed to origin, not merged (`main` is unchanged):
1. `182a934` two-tier brain, building skills, door and pathfinding fixes
2. `8c79b1f` villages: registry, model-designed buildings, mayor and workers
3. `c661150` village robustness (fast worker planning, walls, stuck tasks, site search)
4. `570778d` schematic import
5. documentation and test scripts (this file, README, `scripts/`)
6. `86b6794` world interface (`world.ts`, `skills.ts`)
7. `c143688` real Minecraft: server setup and Mineflayer adapter, milestone (a)
8. `4749536` survival skills, reflex, fresh-start spawns (milestone b, partly tested)
9. `bc94747` building skills with server commands (milestone c)
10. `7b9b392` control panel; village fixes; cloud planner (milestone d passed)
11. `41d35e2` panel maps and "what the model saw", model routing and pinned Ollama servers, docs/ARCHITECTURE.md
12. `cd33cc4` fix: build tasks wrongly held back for a missing design ("build_design design=..." read as a design
    called "design"); pushed to origin (the feature branch only; `main` untouched)
13. `bedee15` handover notes and model benchmark scripts (`scripts/bench/`)
14. `58f0d2d` peaceful world settings; `a597469` bills of materials; `11a691b` village storage; `2073569` survival
    building charged to the inventory (village economy steps 1-4)
15. `4803a57` plan_layout, material tasks, self-crafting builds; `65c3e9e` staged tests and scripted workers;
    `ffcf9bd` movement, pickaxe, step-matching fixes; `8f2a8b9` workers run code-posted tasks as written, wood per
    part; `37d8a74` builds top up from storage, doors, buildings protected from gathering; `4fda71e` water, re-opened
    failed builds, verified completion (village economy steps 5-6, done)
16. `114ef12`, `11eea1f` docs: README (how the agents work, in detail) and ARCHITECTURE.md; all pushed to origin
    (`tiered-brain-building` only; `main` untouched)
17. `0c6c2aa` session lessons; `19b9b47` reliability (one wood kind, fast-failing collect, stuck rescue, quiet
    mayor); `b7908db` fixes from the 4-worker runs, panel simple mode, LAN access, `docs/PLAN.md`; `83bfe05` plan
    handover. Not pushed (ask first). From here on, progress is tracked in `docs/PLAN.md`.

18. 2026-09-28/29 (phase 1 steps 1.2-1.5, all pushed to origin `tiered-brain-building`, `main` untouched): a site
    that fits (`3b5627e`), mayor start and small items (`64786af`), then fixes from 18 acceptance runs
    (`ad7edda`..`212a190`, see PLAN.md F24-F52). Acceptance passed: Accept9-11 (gpt-oss workers' planner) and
    Accept15, 18 (qwen3.8).
19. 2026-09-29 (fourth session; pushed with the fifth's): README and ARCHITECTURE.md brought up to date
    (`d63d314`, step 1.6, phase 1 closed); the shared atlas (`7cc1f9d`, step 2.1: `mcAtlas.ts`, `/api/atlas`, the
    panel's village map); whole-tree felling and every village's buildings kept off (`9494d3d`, step 2.2), jump room
    for the climb and the Fell1 run (`bd68f12`); phase 2A (village infrastructure, the user's requirements) planned
    in PLAN.md with V.1/V.2 designed.
20. 2026-09-29 (fifth session): storage hut and sorted storage (`d77313d`, V.1 + V.2:
    `huts.ts`, sorted `deposit`, chests crafted per material group); village ground protected from digging, collect
    steps off a plot for buried stone, plan-bound step credit (`d4aa32d`); the panel's world map of the whole atlas and
    Hutvale2 (4/4 built with the hut in 18.8 min, `b54cc99`); then V.2b workstations in the hut and doors passable
    (`5710a15`), V.3 materials still to gather (`3a53548`), V.4 side pickups (`dafe26f`), V.5 the village mine
    (`832a3be`), compact worker prompts (F78) and Hutvale4 (5/5 in 19.2 min); all pushed to origin
    (`tiered-brain-building`, 2026-09-29), and the tracker brought up to date on 2026-10-01.
21. 2026-10-01 (sixth session; pushed at the seventh's close): V.5b, a mine that goes on (`813703a`, `9ad3a42`: turned
    tunnels, levels down, stone only, one miner a tunnel, no-dig walks; F79-F82); V.6, exposed ores in the atlas
    (`d34ed76`, with README and ARCHITECTURE.md); spawns on the ground and pickaxes from storage (`abfd90c`, F84, F85).
    V.7: Minevale3 and Minevale4 passed in a row (14.4 and 12.2 min, 0 failed actions); Minevale5 lost to find_site
    (F88). Next (decided at the close): phase T, faster tests (PLAN.md), then F88 and one more V.7 pass.
22. 2026-10-01 (seventh session; pushed with the sixth's at the close, `main` untouched): phase T, faster tests: `MC_TIME_SCALE` (`2a782fd`, T.1), the
    fixed test world `mc/testserver` with `reset_site.py` (`ae77c36`, T.2), `site.py` and the F88/F83 fixes
    (`b8c1e6b`, T.3), parallel staged runs and docs (`58d68bb`, T.4); Ollama's Vulkan default fixed (F89). V.7 passed:
    Minevale6 5/5 in 12.3 min, 0 failed actions, on the test world at 1x. Next: the open items in PLAN.md.
23. 2026-10-02 (eighth session; not pushed at the close, ask first): the small fixes (`797297b`: find_site's wood count
    by each column's ground (F98), kelp as water, prepare_site pits (F95), the "shelf" test site; `f390386`: fallen
    trees gathered (F94), no block set inside a player (F99)) and step 2.3, sites from the atlas (`1bf19a1`,
    `mcSiteAtlas.ts`). Minevale7 (model-driven, 1x, test world): 5/5 in 11.6 min, 0 failed actions. Next (the user's
    choice at the close): batch R in PLAN.md (F96, F97, F95's plot check, F100 jungle), then 2.4; phase 3 deferred.
24. 2026-10-02 (ninth session; not pushed at the close, ask first): batch R, each step tested and diff-reviewed: R.1 no
    futile sand gathering (`8ebfc33`, F96), R.2 builds not held by gather tasks storage covers (`e2d619b`, F97), R.3 the
    plot checked after prepare_site (`9bde50f`), R.4 small trees before giant jungle trees (`aefad6e`, F100); step 2.4,
    scouting, and spawns off water (`fd0bf3c`, F105). Minevale8 (1x, model-driven): 5/5 in 15.9 min, 0 failed actions
    (slower than Minevale7 only by the mayor's cobblestone-heavy designs). Open: F106 (search stalls of 3-10 s on sand
    and stone land), F107 (a pickaxe remake that collects logs far from storage), phase D (written into PLAN.md by a
    conversation beside the session; its place relative to the rest is the user's call).
25. 2026-10-03/04 (tenth session; all pushed to origin `tiered-brain-building`, `main` untouched): the ninth session's
    and the eighth's commits pushed; F106 fixed (`611faf9`: `nearestBlocks` reads state ids itself, desert searches
    2.4 s -> 3 ms, Hills3/Shelf7/Drop7 staged with no `[lag]`; lesson 53); phase D step D.1 (`2b4afa3`: stair roofs,
    the architect's block list per world, block states checked and turned with `rotate`, the rain test and solid-roof
    check, a cost budget instead of 9x9, `designbench.mts`, `rotate_design.py`; lesson 54); `5d20e44` run record and
    handover. Minevale10/11 (1x, model-driven): 5/5 in 14.6 and 17.0 min, 0 failed actions, every roof a stair gable.
    Next (the user's choice of order): D.2, the building generator (PLAN.md).
26. 2026-10-04 (eleventh session; not pushed at the close, ask first; `main` untouched): phase D steps D.2 and D.3.
    D.2, the building generator (`399f6a2`, `017deae`, `61595c0`: `buildingGen.ts`, `submit_style`, doors by the
    building's edge, packing by walls with eaves over the street, budgets 150/300, walls capped 9/11, `fitSmelts`;
    `render_design.py`, `gen_designs.mts`, rotate_design.py for any design or style): every roof at four rotations, staged
    GenB1-4/GenF1 5/5, designbench 20/20 by style; Minevale15 (1x, model-driven) 5/5 in 16.1 min, 0 failed designs and
    actions. D.3 (`e8f019f`: `lintDesign`, one revision round, `shrinkStyle`, the panel's elevations, `[design]` log):
    designbench 30/30 by style; Minevale16 19.2 min, Minevale17-18 stopped (F120, F121). Lessons 55-59. Next (agreed at
    the close): vanilla village pieces and plans from the Minecraft jar (PLAN.md "Vanilla villages", V2.1-V2.5).
27. 2026-10-04 (twelfth session; all pushed to origin `tiered-brain-building` at the close, `main` untouched): vanilla
    villages V2.1-V2.3. V2.1/V2.2 (`4e44df9`: `vanillaPieces.ts`, `vanilla_pieces.mts`, `contact_sheet.py`,
    `stage_village.py --design-file`; stripped logs charged as logs): 62 of 152 house pieces pass the survival checks,
    five built at four turns with 0 mismatches, staged VanB1 5/5. V2.3 (`5805c5c` the street plan: `streetPlan.ts`,
    `street_plan.mts`, plan_layout's street branch, streets laid free by prepare_site; `d14fa53` the mayor's library
    filled by the site's biome, F131/F132 fixes; `9182b77`): staged VanS1-4 and VanF1 (9.7 min full at 2x), Minevale19
    stopped (F131: a sealed mine), Minevale20 (1x, model-driven) 6/6 in 18.0 min, 0 failed actions, no design drawn.
    Lessons 60-65. Next (the user's choice): V2.3m, the mayor gathers while it waits (PLAN.md).
28. 2026-10-04 (thirteenth session; all pushed to origin `tiered-brain-building` at the close, `main` untouched): V2.3m,
    the mayor gathers while it waits (`b716f33`: a TaskBrain beside its empty plan runs soft gather tasks as written;
    `stage_village.py --mayor [--planner none]`): VanM2 8.0 min staged (10.9 without), Minevale21 15.0 min at 1x on
    Minevale20's site (18.0). V2.4, the green village (`723a24d`: `layoutGreen`/`planGreen`, a ring street round the
    town centre's green on 40 sites, the street plan up to 40 otherwise, find_site size=40, prepare_site 40x40) and
    collect's lake and pit fixes (`bb48ec0`, F136-F138): staged VanG1/2/5 8.1-8.4 min at 2x, Minevale22 (1x) 6/6 in
    15.2 min, 0 failed actions. Lessons 66-71. `stage_village.py --site-at=X,Y,Z,SIZE[,WOOD]` needs the `=` for a
    negative X and the X Z arguments as well. Next: V2.5 (vanilla data) or the backlog (PLAN.md).
29. 2026-10-05 (fourteenth session; all pushed to origin `tiered-brain-building` at the close, `main` untouched): V2.5, vanilla data
    instead of hand lists: `vanillaData.ts` (`d2fda9a`, `05d9dbb`: the jar reader shared with vanillaPieces.ts, tags
    resolved recursively, `vanillaJar()`), the renderer's colours from the client jar (`41d733c`), SMELT from the jar's
    smelting recipes (`cda19c8`), the adapter's block and item lists from tags in `mcBlocks.ts` with the hand regexes
    as an all-or-nothing fallback (`34e205b`); loot tables left on minecraft-data (they agree). Staged VanG6 and VanM3
    8.3 min at 2x, Minevale23 (1x) 6/6 in 14.9 min on Minevale22's site, 0 failed actions. Lessons 72-76. Next (the
    user's choice): the backlog, F138's leftovers first (PLAN.md).
30. 2026-10-05 (fifteenth session; no code, nothing to push): F138's leftovers started. The pit reproduced live
    (`runs/2026-10-05/f138/pit_repro.py`: 10.2 s per stalled walk, 52 s per stalled deposit, the rescue after ~105 s);
    a design review held item 4 back (the stall's first move is a cardinal jump-up, not a diagonal) and widened item 1
    (F143-F146). Next: item 3, the `[stuck]` line (PLAN.md).
31. 2026-10-05 (sixteenth session; all pushed to origin `tiered-brain-building` at the close, `main` untouched): F138's leftovers and F147.
    `07306d5` the fifteenth session's record; `32f3eff` item 3, the `[stuck]` line and a horizontal walk watchdog;
    `5861632` item 1, storage fails at once on an unmoved stall (nearest side spot within 6 blocks), the rescue walks
    away from the stalled goal first; `cff6dbc` F147, half width 1229/4096 and `[stuck-world]`; `8c73e20` every dig
    checked with the server. Items 4 and 2 dropped (the stall was the server refusing moves). The pit reproduction: a
    move arrives in 2.0 s and a deposit in 3.1 s (52.3 s and the rescue after ~105 s before). Staged VanG7-9 and
    VanM4-5 8.0-8.5 min at 2x, Minevale24 and 25 (1x) 6/6 in 15.1 and 15.0 min, all 0 failed actions. Lessons 78-81.
    Next (the user's choice): the small backlog, F148, F150 and F131's leftovers (PLAN.md).
32. 2026-10-06 (seventeenth session; see PLAN.md for push state): the small backlog. `bd174c1` F148, explained as the
    pathfinder's partial paths corrupting its own search (F151): a patch-package patch copies A* nodes into paths,
    walkOnce re-searches an idle empty path (`[repath]`), the `[stuck]` line names the goal; `51f10a2` F131's rescue: "out"
    means a path home exists (or open sky in no village), a sealed-in village member is teleported home at once, no climb
    on village ground, `test_rescue.py tunnel`. F150 not reproduced (waits for a model run). Staged VanG10-13, VanP1,
    VanM6-7 6/6 in 7.7-8.6 min at 2x, 0 failed; Minevale26 (1x) 6/6 in 18.8 min, 0 failed actions, ~3 min lost to the
    mayor's late layout (F155). Lessons 82-84. Next: the user's choice (F155, backlog, lamp posts or phase 3).
33. 2026-10-06 (eighteenth session; see PLAN.md for push state): F155 and street lamps. `52f5b19` F155 (wait-only mayor
    plans count as empty, the nudge names the vanilla library, find_site's reason ends "call plan_layout now", the mayor's
    executor waits for a pending replan; mayorbench F155 cases: 2/12 -> 12/12 plan_layout); Minevale27/28 (1x) 6/6 in
    14.2/14.4 min, laid out at 0.2/0.1 min, 0 failed actions. `980a5cd` street lamps (`placeLamps`, `light_streets`, the
    soft "Light the streets" task after every build; the user's choices: fence + torch, charged, ~8 apart, completion
    waits); staged VanL1 8.6 min at 2x, Minevale29 (1x) 6/6 + 6 lamps in 15.2 min; `246c962` F156 (charcoal from spare
    logs), not run again (the user's choice). The user's village-life list (signs, farming, lighting inside buildings
    and mines, ...) is in PLAN.md's backlog. Lessons 85-88. Next: one model run for F156, then signs.
34. 2026-10-08 (nineteenth session; see PLAN.md for push state): name signs. `cfe8b8c`: a waxed wall sign beside each
    building's entrance door naming its use ("House", "Library", "Storage", "Mine"; other designs their own name;
    `placeSigns`/`signLabel` in streetPlan.ts, the soft "Put up the signs" task after every build and the lamps on every
    layout kind, `put_up_signs` charged at the storage hut and checked with `data get`; the user's choices, all as
    recommended). Staged VanS1/VanS2 8.6 min at 2x; Minevale30 (1x) 6/6 + 6 lamps + 5 signs in 15.4 min, 0 failed
    actions, F156's fix confirmed. Lesson 89. Next: farming (the village-life list's order).
35. 2026-10-08 (twentieth session; see PLAN.md for push state): farming v1. `24e7037`: a 5x7 wheat field (water channel
    down the middle) placed by `placeFarm` beside the storage hut, two soft seed tasks after the storage and "Plant the
    farm: 16 wheat" (`tend_farm`: water and farmland free, a hoe, 16 wheat in alternate rows charged as seeds, checked on
    the server) after the hut's build; walks banned from every field; seeds from grass only and not junk (the user's
    choices, all as recommended). `e28198e`: seeds in posting order, no hoe-log task (F163). Staged VanF3-5 8.9-9.2 min
    at 2x, Minevale31 (1x) 6/6 + lamps + signs + farm in 16.5 min, 0 failed actions. Crops grow with time frozen, only
    near agents. Lessons 90-92. Next (the user's order): harvest and bread, the opportunities analysis, opportunistic
    farming and exploring, the iron age.
36. 2026-10-08 (twenty-first session; not pushed at the close, ask first; `main` untouched): harvest and bread and the
    opportunities analysis. `f17f360` farming v2 (`harvest_farm`, a chore code queues on an idle worker at 3/4 ripe,
    `loot give` per cell, resown charged a seed, bread at the hut's table; never counted for completion;
    `stage_village.py --harvest`); the analysis (`runs/2026-10-08/s21/opportunities/`: Minevale26-31 with a schedule
    simulation, 15 staged runs, the code side) and five of its opportunities (the user's picks): `33b70f6` the preparer
    sets up the storage with its felled logs, `5f3e133` F164 whole buildings (`v.woodFor`), `8724395` the hut's stations
    shared, `0ec7e0a` hand-gathered items while the plot is prepared and lamps once every build is claimed. Staged green
    plains 8.9 -> 6.1 min at 2x (VanO4, harvest PASS), Minevale31's site with a wood kind 9.6 -> 7.2. No model-driven
    run (the user's choice): Minevale32 first next session. Lessons 93-97.
37. 2026-10-08 (twenty-second session; not pushed at the close, ask first; `main` untouched; the user asked for no
    questions this session, so every choice was the recommended one, recorded in PLAN.md's decisions): Minevale32 (1x,
    model-driven) 6/6 in **11.2 min** (Minevale31 16.5; the simulation predicted 11-12), 0 failed actions. `0da949d`
    opportunistic farming and exploring v1 (sightings in the atlas: plants per chunk, animals by uuid; two kind-free farm
    slots a layout; after completion, chores start cane, pumpkin, melon or crop farms from sightings within 160 blocks,
    harvest them, and explore 8 ring points; staged VanX2-4 and VanI1-7 started farms from fixtures and from wild cane and
    pumpkins 115-140 blocks out). The iron age v1 (`mine.iron`: its own stairs from the deepest level to y 18, retried past
    minevale3's caves, tunnels keeping iron and coal from walls, floors and veins; an iron pickaxe, then a bucket, from the
    village's iron; VanI7 6 raw iron from 144 cells, both tools made), F178, F179, F165/F169 (the spare wood kind passed to
    the craft and smelt skills; VanW7/VanW8: signs and lamps in one pass) and F184-F186. The village beautifying plan is
    in PLAN.md's backlog (the user's request). Lessons 98-103.
38. 2026-10-09 (twenty-third session; pushed at the close, the user's instruction; `main` untouched): Minevale33 (1x,
    model-driven, `MCAI_AFTER=30`) 6/6 in **10.6 min**, 0 failed actions to completion; its after phase ran a pumpkin farm,
    the iron age (iron pickaxe and bucket at +22.9) and a scout, then the agent server crashed (F188). `91d1399` fixes
    F188-F192 (walk bans skip the pathfinder's unloaded-chunk stub; scouts and failed farm starts teleport home; pickaxes by
    uses; planks before stations; cane counted by takeable blocks). `ecb7cf7` the annex and chicken pens v1 (the user's
    choices: pens on a 13x9 annex prepared beside the plot after completion; one lure trip of up to 4; eggs and breeding
    later): `prepare_annex` and `start_pen` chores, fence gates as walls to walks, lure tests 1-3 with Gus. `5d156ca` F198
    ("any planks" from one kind) and F199. Minevale34 (1x) 6/6 in 10.6 min, 2 wild chickens penned with real models;
    staged VanA3/A5/A6 penned chickens led 25-80 blocks. Lessons 104-108.
39. 2026-10-09 (twenty-fourth session; not pushed at the close, ask first; `main` untouched; the user asked Claude to decide
    everything after the first question, the Mayor's chores, recorded in PLAN.md's decisions): `119df92` F193 per-agent
    chores (a key each; workers, then the Mayor once complete; staged busy minutes after completion 9.9/0.0/0.0 of 12.1 ->
    7.4/6.0/2.6 of 20) and pens v2 (live facts first: activateEntity feeds babies too, cows jam in a 1-wide gate; eggs,
    breeding and milking by command from beyond the gate, cows lured with wheat, a pen of one lured into again, a cake
    with the buckets given back, bread only beyond 16 wheat, three buckets once cows are penned). Staged VanC3: a chick
    bred, 5 eggs, 3 x 3 milk, 2 cakes. Minevale35 (1x) 6/6 in 11.0 min, 0 failed actions, then all three agents on chores
    at once (iron pickaxe and bucket, annex, a chicken pen, 4 eggs, all 8 scouts by +24.7); no cow pen or breeding with
    real models yet (no wheat harvested in 30 min; other chickens 6-8 above the annex, F205). Lessons 109-112.
40. 2026-10-10 (twenty-fifth session; pushed, and `main` fast-forwarded to the branch at the close, the user's instruction): F205 (`15c65a4`: pens take
    animals from 4 below to 8 above the annex, measured from the annex; live slope tests and an offline scan first), F209
    (`479b87c`: walks in water need 2 blocks of progress, scouts stop within 11 of a ring point, a home leg from water
    teleports), and the control panel (`2039bee`, `95fa904`, `9ca781f` and the icons commit: a simple view for the whole
    village life, a drill-down detailed view, agent trails, Auto framing, an activities overlay, fullscreen, map icons and
    a key). Staged VanH3 (F205 at +5..+7) and VanH4; Minevale36 (1x) 6/6 in 10.6 min, 0 failed actions in 55.7 min,
    chickens bred to 5, a cow pen and milk with real models (the field ripened by command). README restructured as an
    AI-agent project with fresh screenshots. Lessons 113-117.
41. 2026-10-10/11 (twenty-sixth session; pushed to origin `tiered-brain-building` up to `c5224d6`, `main` untouched): the
    user's new goals (agents that choose; 25 agents in many parallel activities with more kinds of work; Project Sid-style
    emergence; agents proposing game improvements that Claude triages; long-horizon memory), a literature review
    (`docs/research/llm-agent-autonomy-literature.md`) and Phases A, S and E with one roadmap in PLAN.md. `fd5f80f` A.0:
    gpt-oss for every role (reasoning levels per call kind, token ledger, hourly budget, `/api/usage`; benches chose exec
    medium, plan low, design medium); Minevale37 10.4 min, $0.0015. A.0b: one agent server holds 12 working bots. Phase S's
    chain work (`85ddef1` S.0/A.1 measuring, `99a9195` S.1 contention, `cad847f` S.2 mine for many miners, `8fe8c8b`
    S.3/S.4 glass once, lamps early, a sign per building, `28223ac` S.5 stations early, `3b69e17` S.6 the plot in parts):
    the staged 12-agent village 6.2 -> 3.1 min. E.0 (scale safety) implemented but uncommitted at the close (see
    PLAN.md's handover). Lessons 118-124.
42. 2026-10-11/12 (twenty-seventh session; NOT pushed at the close, ask first; origin at `c5224d6`, `main` untouched):
    `475f060` E.0, scale safety (the model call gate, chat routed within 48 blocks with wakes, contention codes, the
    board refreshed outside claimable(), debounced saves, budget shares with Mayors exempt, the spend ledger; golden check
    0 differences on 137 villages); `f22a1bc` F216/F217 (the stations task's steps matched by item; no station, block or
    mining on village ground); `4d2d77a` E.1 (max-players 30, Worker1-24 in both worlds, `/api/perf`, the RCON timeout
    with charges settled by counting, the pathfinder's shared allowance, F219 find_site's survey on state ids, the scan
    lock, the panel at 25, spawns 2.5 s apart, the AGENTS table, `scale_probe25.py`, `pf_share.mts`). Minevale38/40 (1x)
    10.1/11.0 min; the 25-bot probe 10 min with 0 `[lag]`, API p90 0.048 s; Van25a (25 agents, staged, 2x) 6/6 in 4.1
    min, 21% busy. G2 (long-horizon memory) started with the user: model-managed memory, both horizons, all purposes;
    `docs/research/memory/`. Lessons 125-126. Next: A.1's baseline, then A.2 (PLAN.md's handover).
43. 2026-10-12/14 (twenty-eighth session; the five s26/s27 commits pushed at its start; its own NOT pushed at the close,
    ask first; `main` untouched): A.1's baseline (A1b3, A1b4 staged at 25; Minevale41 model-driven) and **A.2, the menu**
    (`ef5deec`, `31c36a5`, `d463440`): idle members of a complete village choose among feasible chore instances
    (`choices`/`runChoice`, `server/src/choose.ts`, `MC_CHOOSE=fixed|model`, `MC_CHOICE_INSTANCES`, `--choose`), the fixed
    order as default and fallback (golden check 0 differences on 960 fixtures), choicebench 100% valid with no position
    bias, A2m at 25 with 0 errors, Minevale42 complete in 10.2 min. After completion only ~2% of agent-time is busy at 25:
    the work, not the choosing, is missing (S.9 next). Lessons 127-129.
44. 2026-10-14/15 (twenty-ninth session, overnight: the user asked Claude to keep building and decide; s28's commits pushed
    at its start; its own NOT pushed at the close, ask first; `main` untouched): F224 (`ebec76d`: a scout passing a lure
    does not disturb it, one holding seeds does; instance-mode exploring beside a lure, the scout's hand cleared), **S.9,
    the workshop** with the user's wider scope (`9c76d28`, `58fe85c`: `make`, `gather` (sand, logs, mine cobblestone),
    `works` (a works plot with three locked furnaces), `v.tech`, all behind `MC_CHOICE_FAMILIES`; S9f at 25: 23 agents took
    a chore, peak 9, busy 4%) and **B.4, light** as its first consumer (`43b3dec`, `c69dbe1`: torches in buildings from a
    stand by the door and along the mine from the hut; B4f 61 of 61 standing). Minevale43 (model-driven) 38% busy after
    completion but a slow build (F228). Work bounded by targets stops (lesson 130). Lessons 130-133.

45. 2026-10-15 (thirtieth session; pushed at the close, the user's instruction; `main` untouched): F228's fixes (`8371ab6`:
    the walk's arrival judged on the pathfinder's start node, F218; smelts take their input back; hand-backs deposit) and
    Minevale44 (`505ada6`, model-driven, 9.1 min, 0 failed actions in 54 min); **a village that grows** (`209e934`,
    `server/src/grow.ts`: neighbourhoods of up to 4 houses until a house per member, a code chore, no model calls; G25: 25
    houses in 6 neighbourhoods, after-phase busy 4% -> 16%); **food** (`0197159`, `server/src/appetite.ts`: fields and slots
    in every neighbourhood, `MC_GROW_FARMS`; a village appetite on peaceful, `MC_APPETITE`; both off by default; G25f: 6
    fields, 52 meals, hungry 2.2%, FOOD ok). Lessons 134-139. Next: voting with neighbourhood variety, then roads.
46. 2026-10-16 (thirty-first session; pushed at the close, the user's instruction; `main` untouched): speed work, no
    features (the user: speed ahead of quality). The docs split (`a98d242`), checkpoints and `--resume` (`c387652`),
    `run_series.py` (`eeaf692`), code snapshots so server files can be edited during runs, `--after-until`,
    `MC_RANDOM_TICK`, `MC_HASTE`, `stack.py`, `run_report.py` (`fa51aac`), model calls recorded and replayable
    (`ff9a11b`), run_series fast by default. Restore 0.3 min instead of a 5-9 min build; first harvest +2.4 min
    (~+17); a 30-min watch stopped at 4.4; the 3-agent build 3.2 min (4.9). Next: more speed work (PLAN.md).
47. 2026-10-16 (thirty-second session; pushed at the close, the user's instruction; `main` untouched): speed work, then
    research. A second test world (`MCAI_TEST_WORLD`), model-driven runs and replays in run_series, per-run load figures,
    `npm run check:offline`, a SessionStart hook (`97328af`); 25 agents at 3x no faster than 2x (run_series keeps 2x from
    12); W2a/W2r: a model-driven run and its free replay on world 2 beside a staged series on world 1. Online research:
    vote topics and agent individuality (`docs/research/`); personalities planned as A.3p before the first vote
    (`b8585a6`). Next: A.3p, then the first vote.
48. 2026-10-16 (thirty-third session; pushed up to `e1a1fc7` at the user's word, the close-out commits after it):
    A.3p part 1, personalities (`cee9cef`: five traits with the user's sociability, Latin-hypercube vectors, 2.5x/0.4x
    chore weights, persona and own-pattern lines, option tags, the response threshold in the fixed sweep); temperaments on
    by default (`1c2d330`); the first vote, each neighbourhood's house style (`e1a1fc7`: `vote.ts`, ballots by gpt-oss or
    predicted, ballotbench, /api/votes, the panel); Vm2 voted savanna 4 times and built it. The user asked for richer
    activities and a self-improving loop: Phase X (`docs/research/self-improving-activities.md`); the Claude Code CLI
    installed for its foundry (the user's subscription, the user approves merges). Next: Phase X.1.
49. 2026-10-16/17 (thirty-fourth session; local commits, not pushed): Phase X.1 (`35312b0`, `204da9a`): the activity spec
    format and validator, a catalogue of ~31 goods from the recipe graph in the village's pinned wood, code-designed
    furniture (`buildingDecor`, the `furnish` chore), both on by default; distinct activities doubled (58 vs 27) but busy
    time only burst (F240, lessons 143-144). X.2 part 1 (`8985b32`): public works voted (a pool of 48 vanilla shops,
    smithies, libraries, temples) and built one after another through growth's path; 7 works an hour staged, 6 in 30 min
    with gpt-oss ballots. Part 2a (`f01136f`): works as quarters of up to 3 pieces; at 1x the village holds 6-25% busy past
    minute 20 where it otherwise falls to 0; the pathfinder crash F242 guarded (lesson 145); F244 (stalls near the same
    works) open. The user away for most of it ("make the decisions yourself").
Backlog and open problems: `docs/PLAN.md` (phases, backlog and findings log). The items listed here before
(re-posting mayor, logs short, slow-failing collect) were fixed on 2026-09-28.

## The peaceful village economy (agreed 2026-09-27; done 2026-09-28)

The user changed the base assumptions: **no survival with hostile mobs or damage at all**. Agents gather and craft
the materials a village needs, then build with them. Decisions made with the user:
- **Minecraft only.** The sandbox stays as it is (a quick test bed for the brain); no peaceful mode is added there.
- **Survival mode, made safe:** peaceful difficulty (no hostile mobs; hunger does not drain), and game rules for no
  fall, drowning, fire or freeze damage and keep-inventory. Done: `mcRules.ts` applies them over RCON at every
  agent-server start and reads each back (log line "World settings: ...", `/api/status` `worldRules`, the panel
  header). 26.1 names game rules in snake_case (`fall_damage`, `keep_inventory`, `spawn_monsters`,
  `fire_spread_radius_around_player`; camelCase is rejected), and a bare `gamerule` lists nothing over RCON: the full
  list is in the jar (`net/minecraft/world/level/gamerules/GameRules.class`). `time query daytime` no longer exists
  (timelines). `mc/server/server.properties` still says `difficulty=easy` (checked 2026-10-01; an earlier note said
  peaceful): peaceful comes from the agent server's RCON at every start, so a Paper running without it is on easy.
  `mc/testserver`'s says peaceful.
- **Building places blocks by command but charges the inventory:** `/setblock` / `/fill` as now, but each block must
  be carried, is taken from the inventory (e.g. RCON `clear <agent> <item> <n>` per run of blocks), and the job stops
  when a material runs out. Not real block-by-block placement.
- **Shared village storage:** gatherers and crafters deposit into a village chest; builders withdraw what a building
  needs. The first chest is crafted like anything else (8 planks).

Agreed plan (each step tested before the next):
1. Done (tested: a 30-block drop leaves a survival bot at 20 health). World config: peaceful + no-damage game rules, applied at agent-server start.
2. Done (`mcMaterials.ts`; `GET /api/village/:v/designs/:d/bill`, `GET /api/materials?items=glass:8&have=sand:2`,
   `scripts/bench/materials.mts` prints every stored design's plan). Recipes merged across wood kinds become
   "any planks"/"any logs" (a chest takes any planks, an oak door oak planks); smelting is a hand table (minecraft-data
   has none); batches round up and leftovers are reused; sandstone, terracotta, coal and wool count as gathered;
   Nether and hostile-drop items (glowstone, string) are reported as unobtainable. Placed grass is charged as dirt.
   The plan was: blocks per design (a door is one item for two cells; `_` and `.` cost nothing), and a
   recipe-chain resolver to raw materials with minecraft-data (planks <- logs, glass <- sand + fuel in a furnace,
   stone bricks <- stone <- cobblestone smelted, doors <- planks...). Code, not the model, does this arithmetic.
3. Done (`mcStorage.ts`; tested with Gus in the test village Depot, chests at -6,81,8 and -4,80,8). `village.storage`
   holds the chests and each one's contents as last opened (the server's counts matched). The first `deposit` puts a
   carried chest down near the agent, outside plots; a full storage takes a carried chest in a row beside the others,
   one block apart (single chests, never read twice). Each chest is also a 1x1 `storage` structure, so building and
   site search keep off it. `deposit` item / "logs" / "planks" / "all" (keeps tools and chests), `withdraw` item and
   count (partial amounts reported). Shown in the village summary, the panel and `/api/village/:v`;
   `POST /api/village/:v/storage {x,y,z}` registers an existing chest.
4. Done (tested with Gus and a 5x5 "shed" design in Depot, sheds at -10,-24, 29,-26 and 58,-20). Survival agents pay
   for every block (`runJob`, `charged()`): at the site the builder counts what is still missing (server-side counts,
   `clear <name> <item> 0`), withdraws it from storage, and fails before placing anything with "short of materials for
   the shed: 35 acacia_planks (carrying 1, storage has 0). To get them: withdraw ...; gather 9 acacia_log; craft ...".
   Each run of blocks is then charged with `clear <name> <item> <n>` (refunded if not placed); running out stops the
   job ("ran out of X after placing N blocks; still needed: ...") and the same build later continues at the
   remembered level (`memory.pendingBuilds`; its own walls would fail the site checks). Wood kinds are swapped for the
   kind the builder can supply (`chooseWood`: oak designs built in acacia). The dirt walkway in front of doors is
   optional. prepare_site stays free (landscaping) and gives the preparer the logs of the trees it fells.
   `memory.buildMode: "commands"` builds free in survival. Creative is unchanged.
5. Done. `plan_layout` (a mayor planner tool; `layout.ts`, also `POST /api/village/:v/layout`) packs the named
   buildings onto one plot with 3-block streets (`layoutBuildings`), refuses undrawn designs, designs needing
   unobtainable or hard-to-find materials (iron, wool...) and a find_site result smaller than the plot, and posts in
   order: prepare the plot, set up the storage (collect 4 logs, craft a chest, deposit at a spot beside the plot; the
   first chest finishes it), gather tasks per building (`WorldAdapter.materialTasks`, `gatherTasks`: even chunks of
   <= 12 logs or 32 of anything, collect then deposit all, "soft" so a failed one does not block the build), and each
   build at computed coordinates. Builders craft and smelt from storage themselves (`makeFromStock`: planks, doors,
   slabs, glass, the table and furnace), re-read the chests when the record looks short, and a build short of raw
   materials posts gather tasks for exactly that and goes back on the board (`requeueBuild`). The mayor's flow:
   find_site + design_building steps, then plan_layout, then wait. Code guards: hand-written building tasks before
   a layout are laid out in code; duplicates of the layout's tasks and plan steps that are workers' jobs are dropped;
   a refused plan_layout replans at once; no timed review while workers hold tasks.
6. Passed. Riverbend6: one cottage from nothing in 9.3 min (1 failed action). Meadowford2: "two matching cottages
   and a meeting hall" in 35.0 min, declared complete, 6 failed actions (3 were self-healed material shortfalls);
   mayor gpt-oss:120b-cloud (planner and architect), workers' planner qwen3.8:27b (never called: code-posted tasks
   carry their own steps), executors qwen3:30b-instruct. Staged runs (two testhuts and a testhall from stocked
   storage) then found more: see the lessons below. Meadowford5 (all fixes): both cottages in ~21 min, the hall build
   failed on a crafting shortfall; resumed with fresh agents, the mayor's re-post re-opened the failed layout task and
   the hall was built from storage in 4.3 min; completion is now checked in code. Failed confirming runs on the way:
   a worker stuck in a lake (water avoidance and swim-out added), a mayor that declared a village complete with nothing
   built (refused now), a site-size loop (the site must be as big as the plot, no margin).

## Milestones of the Minecraft adapter

Milestones (each tested and reported before the next): (a) done: an idle bot joins, observes, walks and chats;
(b) partly done, then set aside for creative (the user's call, to stop the deaths): scripted skills reach a stone
pickaxe; the best tiered run (qwen exec, gemma plan) had 7 unique items and a wooden pickaxe at 3.1 min (sandbox
baseline ~10 items in 8 min); earlier runs died to zombies before the reflex; `scripts/watch_survival.py`; (c) a creative agent runs find_site, prepare_site, build_design; (d) the full village, watched with
the real client. (d) passed on 2026-09-27 (village Elmfield, 11.0 min, 2 cottages + meeting hall, 8/8 tasks done,
1 failed action) with gpt-oss:120b-cloud as mayor planner and architect, qwen3.8:27b as worker planner (tight 1-step
plans, 6/6 in a benchmark against 2/6 for qwen3:30b) and qwen3:30b-instruct as executor (1.2 s/turn alone, but 6-11 s
in the run: three agents queue on one Ollama model). Models are set per run with MCAI_MAYOR_MODEL / MCAI_DESIGN_MODEL /
MCAI_EXEC_MODEL and the WORKER_PLANNER argument of watch_village.py. Rerun as Ashvale with the pinned Ollama servers (3 parallel executor
slots): all 6 tasks done in 4.2 min instead of 7.8, executor turns 3.4-7 s instead of 6.5-11, 0 failed actions; but
the mayor placed the hall partly outside the prepared plot (layout arithmetic, lesson 5), then spent the rest of the
run relocating it (17 refused repeats) instead of declaring complete: `plan_layout` is the next thing to build. Model output is normalised in code: designs with
stringified layers (even without outer brackets) or rows as symbol arrays, tasks posted as skill calls
({task:"build_design", name, x, z}); build tasks wait for missing designs and for a land task posted with them.
(c) done: the tiered brain (qwen exec, gemma plan) ran find_site, prepare_site and build_design
"cottage" in 1.1 min with no failures (Gus not in a village, the design in memory.designs: as a village member he would
be a worker waiting for tasks). The village "Testville" in `mc/server/villages.json` holds the cottage design copied
from the sandbox (`POST /api/village/Testville/designs`). Mindcraft (github.com/kolbytn/mindcraft) is a reference for skills; check its licence before
copying anything.


## What earlier sessions left in the worlds

Left after the thirtieth session (2026-10-15): the stack stopped (the test Paper saved by RCON stop); G25f's village left in
the test world (reset minevale3 before the next run); another program held 127.0.0.1:8767, so the test agent server ran on
8768 (`MCAI_TEST_API_PORT=8768`, `MCAI_API=http://127.0.0.1:8768/api`); see PLAN.md's handover.
Left after the twenty-ninth session (2026-10-15): the test Paper (25566) and its agent server (8767, on `c69dbe1`'s code)
running with Minevale43's village (reset minevale3 before the next run); the main world stopped; see PLAN.md's handover.
Left after the twenty-eighth session (2026-10-14): nothing running (the machine went down overnight); no agents in either
world; see PLAN.md's handover. Left after the twenty-seventh session (2026-10-12): nothing running; the test Paper went down with the machine without a
save (the test world is restored per site anyway); the main Paper stopped cleanly; no agents in either world; see
PLAN.md's handover. Left after the twenty-sixth session (2026-10-11): the stack stopped (the test Paper saved by RCON stop); E.0's uncommitted
work in the working tree, backed up in `runs/2026-10-11/s26_e0_backup/`; see PLAN.md's handover. Before that, after the twenty-fifth session (2026-10-10): see PLAN.md's "Next session starts with" for what was left running (the
stack is normally stopped cleanly at the close; start it as above); no agents in either world. In the main world, test
buildings, storage chests and mines stand near spawn and at the test villages (Depot, Stage*,
Sunhollow*, Riverbend*, Meadowford*, Fourfold*, Accept*, Tightfit1, Fell1, StageH1-H20, Hutvale1-4, StageM1-M8,
Minevale1-5, StageS1, Par1, Atlas1, Atlas4, Jungle1-2 (-527,-627 and -747,-576); all in `mc/server/villages.json`): build elsewhere (`scripts/checks/fresh_land.py`), clear
them, or test on the test world (`mc/testserver`, restored per site; Minevale36's street village (6 of 6, lamps, signs, a wheat field, a pumpkin farm, an annex at -1659..-1651, 40..52 with chicken and cow pens) stands on Minevale31's site at -1648..-1609, 27..66 until the next reset (inside minevale3's restore radius); the atlas there now knows the land to ~160 blocks round VanG's site from the exploring trips, and the
scouting tests left Scout4 at -19,-88 and Scout5 at -378,-804 there, outside every recorded site). The atlas
(`mc/server/atlas.json`) holds ~6,700 chunks, with exposed ores, shown on the panel's world map. The user confirmed the panel's simple
mode reads well (2026-09-29).
