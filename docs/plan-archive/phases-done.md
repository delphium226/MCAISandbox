# Finished phases

Phases moved here from `docs/PLAN.md` on 2026-10-15, unchanged. Steps still open in them are listed in PLAN.md's
"Earlier phases".

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
