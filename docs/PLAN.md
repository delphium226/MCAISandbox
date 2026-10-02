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

(written 2026-10-02 at the close of the eighth session: the small fixes and step 2.3 done, Minevale7 passed)

- **Code:** committed on `tiered-brain-building`: `797297b` (B, C, D, F95), `f390386` (A = F94, F99), `1bf19a1`
  (step 2.3) and the closing docs commit. **Not pushed** (origin is at `d15c9c5`; ask the user). `main` untouched.
- **Stack:** stopped cleanly at the close unless the user asked to leave it up (see the session's last message). Start
  it in CLAUDE.md's order; `reset_site.py` starts the test world's two servers. No agents in either world.
- **Where things stand:** the batch of small fixes is done and step 2.3 is done:
  - fallen trees are gathered, leafless built logs passed over at no cost (F94);
  - find_site's wood count judges each log by its own column and the site's level (F98); kelp and seagrass are water;
  - prepare_site no longer leaves pits where trees stood below the level (F95, found by the new "shelf" site);
  - no block is ever set inside a player; doors are placed as one command (F99: a preparer suffocated in its fill);
  - sites from the atlas (`mcSiteAtlas.ts`), used when the local search finds nothing good, for an agent in no village
    or a mayor's first site;
  - test sites: "shelf" (a plot against a drop; its mine turned at the hillside, Shelf2), woods-sand and hills recorded;
    `site.py` checks the wood count; `fell_trees.py` takes `MCAI_API`.
  Minevale7 (model-driven, 1x, test world): 5/5 in 11.6 min, 0 failed actions.
- **Next (decided at the close with the user, 10-02): batch R, then 2.4.** Phase 3 (talking to the mayor) is
  **deferred** by the user. Batch R ("run-time fixes", section below, before phase 3) takes today's findings in this
  order: R.1 F96 (no futile gather tasks; the 1-2 s stalls), R.2 F97 (a build not waiting for gather tasks storage
  covers), R.3 F95's follow-up (check the plot on the server after prepare_site), R.4 F100/F62 (jungle: felling past
  the task's count, and the site scores). Then step 2.4, scouting. Each R step has its code pointers and test in its
  section; show the user the approach in a few lines first (the user's standing rule), and design reviews before code.
  Left for later as before: F84, F86, F102, two miners on crossing tunnels, the rest of the backlog.
- **Test world state:** the snapshot (`mc/testworld`) is unchanged; Minevale7 stands on minevale3's land (reset first).
  `scripts/test_sites.json`: minevale3, minevale4, drop, shelf, woods-sand, hills recorded; woods-sand2 still probes.
  Shelf runs need `--buildings testhut,testhut,testhall`.
- **Main world:** new test villages Atlas1 (-538,-162) and Atlas4 (-471,-41) stand there now (main world at 2x when the
  session ended its staged runs: the agent server sets the tick rate at its start, so restart it without
  `MC_TIME_SCALE` for 1x).
- **How to test now:** as before (CLAUDE.md "Testing agents"); the staged probes wait up to 300 s for find_site.
  Run logs: `runs/2026-10-02/`.
- **Working method** as before: subagents for design and diff reviews, log analysis, offline searches and docs. Every
  review found something real again (the wood floor vs collect's, the guard's door split, the atlas's zigzag walks).

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
- [ ] 2.4 **Scouting**: when the site search finds nothing good, code posts "scout" tasks for idle workers in
      different directions (run as written, no model calls) while the mayor draws designs. Test: model-driven run
      from a poor start point.

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
- A bot stuck twice in a 1-deep pocket beside a plot on its way to a chest (F71; lesson 1's wall overlap suspected).
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

## Keeping this plan honest

- **When a run shows something new**, add a finding with evidence (log line, numbers). Then decide: fix now if it
  blocks the current step; otherwise add it to the right phase or the backlog, and say why.
- **When a finding invalidates a step** (wrong cause, better approach), edit the step and add a decision explaining
  the change. Do not silently delete: strike through (`~~...~~`) and point to the replacement.
- **Acceptance criteria are concrete** (what run, what counts as passing). If one turns out to be wrong, change it in
  the decisions log, not quietly.
- Keep the "Next session starts with" section current at the end of every session, including uncommitted work and
  anything left running.
