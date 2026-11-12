# Requested builds: any project, any material, up to 30x30x30 (MC_TALK_BIG)

The user's goal (2026-11-12): "make it so i can ask for any type of project to be built, using any kind of material, in
up to a 30x30x30 design space". A person says to the Mayor "build a 30-block pyramid of blue glass", "a red wool castle
tower", "a quartz obelisk", "a terracotta arch"; the village designs it and builds it in survival, gathering and making
its materials. Builds on the talk build of 11-12 (ca8461a: statues, fountains and arches up to 11x11x12 in easy colours).

## What changes (flag MC_TALK_BIG, on; `=off` gives 11-12's path exactly)

1. **Size.** The architect's sculpture space becomes 30x30 (x, z 0..29) and 30 high with the plinth (y 0..28). The Mayor's
   prompt: anything built of blocks in one place up to about 30x30x30 is `design`; only what is truly huge (a city, a
   skyscraper, a mountain, a 100-block statue) is refused. The Mayor's line gets code's scale and ETA once drawn ("a 29x29
   pyramid, 15 high, ~4,500 blocks in 12 parts; about 90 min of work with 50 members").
2. **Budget.** A requested work's units cap scales with the village: `clamp(members x 150, 3,000, 9,000)` units for a big
   work (small ones keep LANDMARK_UNITS). No hollowing while under the cap; over it, the hidden inside goes first (no
   face shows it), said in the Mayor's line ("hollowed inside to fit: 2,100 of 5,000 blocks"). Glass is never swapped
   for diorite on a big work (the old unsmelt did that to keep under 32 furnace runs; the monument's kiln has no such
   cap). A big work's furnace cap is 9,000 runs (the units cap binds first).
3. **Building in parts.** A drawn work goes the existing public-work way (one board job, a neighbourhood pad) only when
   it is small and in easy materials (the 11-12 statues: talk_statue still passes). Anything bigger than 11x11x12, over
   400 blocks, or with a material outside the easy list becomes an **asked record**: a monument record of type `civic`
   (the civic tier's machinery: site search and pad, yard, kiln, quarry, sand trips, dye bed, many builders on parallel
   jobs) whose plan is the drawn design, not a generator's. Decided over the board's parts: the monument path already
   gathers per stage (AHEAD 1), runs the kiln and the dyer, stands in what it cannot get, counts jobs done, and the talk
   ledger already follows civic records (queued, begun, done/failed, "N of M built"). Stages are bands of layers bottom
   up (at most 6 layers and ~900 blocks a stage); jobs are civicDraw's x-slices of 120-360 blocks within a stage, so
   several builders take one stage at once. Asked records queue behind the record under way, as a person's civic pick.
4. **Any material.** The architect names Minecraft block ids (or a colour word). Code resolves each block at drawing
   time with the village's yard planner (`Materials` with dyes asked for as such, terracotta smelted from clay,
   concrete from powder) and the routes the yard has:
   - full chains: stained glass and panes (sand smelted, dyes), wool (white from shearing, colours dyed), concrete
     (powder from sand, gravel and a dye; set by the builder), terracotta and its colours (clay balls, smelted, dyed),
     glazed terracotta (smelted), all the stones the mine, quarry and deep level give (stone, bricks, polished and cut
     forms, andesite, diorite, granite, deepslate and tuff forms), sandstone forms, wood of any kind (as the village
     wood), bricks (clay), copper and iron blocks (the iron mine's trips keep the ore; slow), plus the 16 dyes as the
     dye bed makes them (flowers near the village, lapis, bone meal, the merchant's ink sacs, mixes);
   - substituted at drawing time with a note the Mayor says: anything whose plan needs an item the overworld peaceful
     village cannot get (`UNOBTAINABLE`: quartz, glowstone, nether bricks, end stone, purpur, bone blocks, prismarine,
     sea lanterns, obsidian, diamond/emerald/gold blocks, netherite, bedrock, spawners, creative-only), and dye colours
     the village cannot make (makeableColours: the census, storage, composter, merchant). The stand-in is the nearest
     colour in what the village can get (quartz -> smooth stone or diorite, prismarine -> cyan terracotta when cyan is
     makeable else stone bricks, a colour not makeable -> its easy colour block).
   - stood in at build time: the yard waits ASKED_WAIT_MIN (30 game minutes) or 4 failed chores on a raw item; then the
     blocks whose plan needs it stand in (the monument's standIns from the first job the yard does not cover) as their
     easy colour block, with a news line. Nothing holds the work for good.
5. **Kept:** the statue path (talk_statue), refusals of creatures, items, fighting, magic and things over 30x30x30.

## Routes the yard gains (asked records only)

| raw item | route |
| --- | --- |
| `*_dye` | the dyer's make_dye (MC_DYE_BED; the plan asks for dyes on an asked record) |
| `white_wool` | storage first (the pens' shearing); then a shear chore: shears from storage or 2 iron, shear_sheep near home, deposit |
| `clay_ball` | collect `clay` (drops 4 balls), deposit |
| `gravel` | collect `gravel`, deposit |
| `raw_iron`, `raw_copper` | storage first; then the iron mine's trips (dig_iron, copper kept) |
| logs, sand, cobblestone, flowers, andesite/diorite/granite | the monument's own routes, as before |

## Settings

- `MC_TALK_BIG` (on): all of the above; off: 11-12's limits and colours.
- `MC_TALK_BIG_WAIT` (30): game minutes a raw item may hold an asked record before its blocks stand in.

## Checks

- `scripts/checks/talk_big.mts` (offline): canned architect programs cast through castPublic's real path (worker
  sandbox, compile, fit) with a world-free resolver built from the registry's Materials: a 30-base blue-glass stepped
  pyramid, a red-wool tower, a mixed-material arch (quartz substituted, terracotta, concrete, copper), a 40-wide draw
  clipped to 30; each becomes an asked record whose plan's stages and jobs cover every cell once, whose bill resolves to
  routable raw items (no unobtainable left), whose stage wants are a fraction of the whole; the Mayor's prompt designs a
  30-block pyramid and still refuses a city; talk_statue unchanged.
- Benches: requestbench (the Mayor: big and material requests are `design`, huge ones refused) and talkprogbench (the
  architect's drawings of big/material requests: calls, blocks, materials named), gpt-oss cloud, 4+ samples a case.

## Follow-ups (not in this step)

- Concrete is set by the builder's command (powder charged, the block placed): no water trough step.
- Quartz from the merchant (a Nether item; the merchant sells only what Phase S allows): substituted for now.
- Prismarine (ocean monuments), sea lanterns, ice and packed ice (frozen biomes), mud bricks, moss, dripstone, calcite and
  amethyst outside the geode chain: substituted; each could get a trip of its own.
- Gold blocks: raw gold is rare in the iron mine's levels; substituted (smooth sandstone / yellow terracotta).
- Measure live: sheep near a village and their regrowth (wool rate), clay under water near villages, lapis by depth; the
  ETA uses the civic tier's ~1.3 blocks a member-minute and will be wrong for wool and dye-heavy works until measured.
- A work over the cap could be redrawn smaller by the architect instead of hollowed or refused.

## Adversarial check against the code (before implementing)

- `newCivic` sets `dress` (MC_DRESSING) and `monumentPlan` would dress the walls: an asked record is made by `newAsked`
  without it (a blue-glass pyramid must not get textured stone).
- `civicDone`, `presetWords`, `cathedralName`, `monumentNoun` read `civicEntry(preset)`/`drawCivic(preset)`: `drawCivic`
  throws for an unknown id; each now reads the record's `asked` (preset `asked:<design name>`).
- The yard's planner for a civic record is `{ yard }` (no dyes), and `jobReady` waits on any smelt: terracotta (clay),
  bricks, iron, glazed terracotta would never be ready. The asked record gets its own planner (`asked`: dyes as such,
  terracotta from clay, concrete from powder) and the kiln smelts every input of `KILN_SMELTS` (clay, clay balls, raw iron,
  the dyed terracottas added; kilnWants/kilnLeft read the table instead of four names).
- Concrete has no recipe (water sets the powder): an `asked` plan crafts the powder and a `wet` step the builder runs by
  command (powder cleared, the block given, counted on the server).
- The planner chose a pitcher plant for cyan dye (cheaper than "gathered") although the yard has no route to one: an
  `asked` plan with dyes never plans a dye from a recipe; the dyer's make_dye does that.
- The wait clock: a long chain (wool) is progressing while it waits; the stand-in clock restarts whenever the yard's count
  of the item grows, so only a stalled chain stands in.
- The Mayor's design answer is overridden by a shortlist hit on the kind ("castle" names the tower houses): kept as a
  design when the person's words name a material or a size (`namesMaterial`).
- Another wood kind than the village's: the yard fells the village's trees and credits any log as its wood, so spruce
  planks asked would never be covered; resolved to the village's wood with a note.

## Results (offline, 11-12)

- `scripts/checks/talk_big.mts`: 62 checks (pyramid 30x30, 15 high, 4,960 blocks, 41 jobs in 7 stages, bill 4,960 sand,
  620 blue dye; red wool tower 11x11x29, 1,290 blocks, 11 jobs; mixed arch with 4 swaps said once; a 40-wide draw clipped;
  a 16-cube hollowed at 3,000 units; a 30x30x29 block refused in words; the wool stand-in; kiln and wet steps); talk_statue
  70/70 unchanged; check:offline all green.
- requestbench (gpt-oss cloud, 4 each): pyramid, red wool tower, quartz obelisk, terracotta arch, 25-block dragon all
  `design` 4/4; a 500-block castle, a skyscraper, a 200-block statue, a pet chicken refused 4/4; chicken statue, bakery
  designed 4/4.
- bigbench (new, gpt-oss cloud, 4 each, 50 members): drawn 24/24, size as asked 24/24, material asked 24/24, median 1.5 s;
  pyramids 4,960-5,860 blocks in 1-2 calls (loops); towers and obelisks drawn y 0..29 in 7 of 8 samples, so a work drawn
  the full 30 layers drops its plinth instead of losing its top layer.
- ETA (askedEta, 1x): a 30-base glass pyramid (4,960 blocks) ~85 min with 50 members, ~170 with 25; 1,100 red wool ~35 min
  with 50 (wool and dye counted twice as slow; unmeasured).

## More follow-ups found while building

- Wool takes a dye per block (stained glass, concrete and terracotta take one per 8): a big wool work is mostly dye work.
- Cut copper planned by crafting is 9 raw copper a block (the stonecutter would give 2.25): use the cutter for asked
  records once the carver serves them.
- Gold: raw gold is not routed (dig_iron may meet some); a gold block resolves to yellow concrete.
