# Plan: every rung of the ladder (G8)

(11-14, the user's request: "create a plan to offer all the rungs. only allow rungs that have already been implemented
to be on the ballot at any time. don't offer advanced rungs before simpler rungs are done")

## The ballot rule (done, this commit)

`ladder.ts`' `rungOptions` offers a rung only when:

- it is **implemented**: every one of its four stages has a counter and a target (`rungImplemented`). A rung in words
  only would hold the village on it for good, since no stage could end;
- it is not reached and not the current rung, and its `after` rungs are reached;
- it is of the **lowest tier** among the implemented rungs not yet reached. Each rung now has a `tier`:

| Tier | Rungs | Why there |
|---|---|---|
| 1 | iron | always first |
| 2 | letters, trade, copper, husbandry, music | built from what the village already does (cane, the merchant, the iron mine's side ore, the pens) |
| 3 | diamond, machines, bees, maps | the deep mine; machines' powered rails (gold and redstone, bought); bees after husbandry and copper; maps after letters |
| 4 | enchantment | needs letters (a book, a library) and diamond (2 diamonds, a pickaxe for obsidian) |
| 5 | the Nether | needs obsidian from enchantment; a second dimension |

A ballot with one option is no ballot: the village takes it up ("the one open to it"), as before. With nothing
implemented left the ladder stays at its last rung reached. Today, with letters, trade, copper and diamond on: iron,
then a ballot of letters, copper and trade (the first real ballot), then the two left, then the last, then diamond
alone, then nothing. As rungs are implemented they join the ballot in their tier with no further change here.

Checks: `ladder_unit` (the rule, tier 2 rung by rung, then diamond, nothing after), `diamond_unit`
(MC_LADDER_START=diamond; diamond only after tier 2), `trade_copper_unit` (#246, #247).

## Building the rest

Every rung needs the four parts letters (#21) and diamond (#22, cc4757d, ~750 lines) had:

1. **The gameplay**: skills or chores that do the work in the world, each with a check (CLAUDE.md: a new check with any
   skill that digs or places).
2. **Counters**: entries in `ladder.ts`' `Counter`, counted in `mcWorld.ts` where the work completes (`noteLadder`).
3. **Menu options that feed the stage** (`feeds`), so members' choices lean to it (VW 1.3).
4. **Tests**: a unit check, a staged run from a checkpoint with `MC_LADDER_START=<rung>`, then a model-driven run in a
   test train. One flag per rung (`MC_<RUNG>_AGE`, on by default); off leaves its stages in words, so it stays off the
   ballot.

In order (simplest first, so each tier opens as soon as possible):

### 1. Trade (tier 2, #246): built 11-14, `MC_TRADE_AGE` (on)

All the work existed (`merchant.ts`, the trade skill, market stalls, `MC_MERCHANT_ORDERS`). Built:

| Stage | Counter, target | Counted where | Feeds |
|---|---|---|---|
| 1. lots sold to the merchant | `sales`, 20 | the trade step's "sold N item for E emerald" at the chore's end, once its deposit landed (`ladder.ts` tradeCounts) | `activity:lib:sell`, the makes of torches, glass, stone bricks, bread |
| 2. market stalls standing | `stalls`, 3 | built `market_stall` initiatives, a level (`levelCounts`), at a chore's end and when an initiative is built | `help:market_stall` (an initiative's help, by its kind) |
| 3. emeralds in the village storage | `emeralds`, 40 | storage's emeralds, the highest seen since the rung began (a level) | as stage 1 |
| 4. lots of the workshop's goods sold | `crafted`, 10 | sales of torches, glass, stone bricks, bread (lots) | as stage 1 |

Stage 4 is "10 merchant orders filled" (`orders`) only with `MC_MERCHANT_ORDERS` on (off by default); otherwise lots of
the workshop's own goods sold, counted with the default flags. "A stall per neighbourhood" became 3 stalls: the target is
fixed per rung, and the first stall (posted at completion) plus two more is what one neighbourhood's growth gives room
for. Behaviour while trade is current (beside the brain's state): the workshop keeps a lot and a batch more of the four
goods (`makeTarget`'s `tradeExtra`, left out of `sellKeep`, so a lot stands for sale); selling no longer stops at "enough
emeralds" and `emeraldKeep` holds 40 (payments do not spend stage 3); while stage 2 is current the village posts another
market stall as its own work (`postRungWorks`, as #134's first stall). Targets: the merchant buys some 50 lots a restock
(every 20 minutes); 20 + about 20 more lots for the emeralds + 10 crafted lots is ~50 lots, about 2 hours of sales.

### 2. Copper (tier 2, #247): built 11-14, `MC_COPPER_AGE` (on)

Before: the iron mine left the copper ore in its walls (`mcMine.ts` keeps only iron and coal, and copper while a
monument's copper roof wants it, `MC_COPPER_ROOF`, off); the cathedral's copper roof comes only after the rung. Built:

| Stage | Counter, target | Counted where | Feeds |
|---|---|---|---|
| 1. raw copper kept from the iron mine | `copper`, 64 | the iron trip's "brought up ..., N raw copper" (`mcBuild.ts` digIron), `copperCounts` | `iron:dig` |
| 2. copper blocks made | `cblocks`, 5 | a make's "put into storage: N copper_block" | `make:copper_block` |
| 3. a copper-roofed canopy built | `croof`, 1 | the built `copper_canopy` initiative (a level) | `help:copper_canopy` |
| 4. a lightning rod and a spyglass | `instruments`, 2 | one of each in storage (a level) | `make:lightning_rod`, `make:spyglass`, `activity:lib:buy:amethyst_shard` |

While copper is current: the mine keeps the copper ore it meets (`setKeepCopper`, with the monument's want); the dig
stays offered beside a monument's iron until the 64 are up; the workshop makes the rung's goods (`COPPER_GOODS`, targets
in `ladder.ts` copperTarget: 5 blocks, then one rod and one spyglass; raw copper smelted in the same make); the
merchant sells an amethyst shard (2 emeralds, appended last to its offers) while the spyglass wants one, instead of the
geode (`MC_GEODE`, off); and once storage holds the 5 blocks the village posts the canopy (`smallWorks.ts` RUNG_WORKS: a
3x3 canopy on fence posts, its roof the 5 blocks in a cross with wood slabs at the corners), the blocks taken as gathered
from storage (`fromStore`). Stage 3 is a copper roof on a small work, not on a civic building or the monument: those
roofs come in their own stages hours apart, and the cathedral's copper roof follows the rung (`copperReached`). Waxing
comes back with the bees rung. Copper's needs in `wanted.ts` are [] with the flag (the shard is the merchant's).
Targets: 64 raw copper is about 18 ores (2-5 each), the 5 blocks take 45, the rod 3 and the spyglass 2.

What a live run should watch for: `[ladder] ... the iron mine keeps the copper ore`, iron trips' "N raw copper",
`[ladder] ... posts iN, a market stall / copper canopy`, "the copper canopy waits for 5 copper blocks", the merchant's
"sells N item" lines while trade is current, and each stage's `[ladder] ... finished stage` line. Risk: if every iron
level is finished when copper is chosen, nothing digs (the dig is not offered on a finished chain); count the copper
rung's first half-hour of trips.

### Husbandry (tier 2, #248): built 11-14, `MC_HUSBANDRY_AGE` (on)

The pens, their breeding (`breed_pen`), shearing (`shear_pen`), seeds for chickens and the enlarged pens existed (#139,
#229). Built: the counts, the hay make, the village's shears.

| Stage | Counter, target | Counted where | Feeds |
|---|---|---|---|
| 1. kinds of animal penned with a breeding pair | `pens`, 3 | a level: kinds of built annex pen holding 2 or more (`ladder.ts` pairedPenKinds, levelCounts) | `annex`, `pen:<kind>` |
| 2. young animals bred in the pens | `bred`, 20 | breed_pen's "N young born" (the pen's entities counted by the server before and after the feed, `mcBuild.ts` breedPen), `husbandryCounts` | `penwork:N:breed`, `penwork:N:enlarge`, `penfeed` |
| 3. wool sheared from a pen's flock | `wool`, 32 | shear_pen's "sheared S sheep ...: N wool" | `penwork:N:shear`, `pen:sheep`, `iron:forge:shears` |
| 4. hay bales in the village storage | `hay`, 8 | a level: storage's hay_block, the highest seen | `make:hay_block`, `farm:N`, `slot:wheat` |

While husbandry is current: the workshop makes hay bales from spare wheat (`HUSBANDRY_GOODS`, `allow: wheat`; the world's
wheat keeps for breeding and the cake still apply) up to 8 in storage; and when a sheep pen holds a pair and storage has
no shears, the forge makes the village a pair (`forgeNeed`; shear_pen is offered only with shears in storage). "A breeding
pen per animal" became 3 kinds: PEN_ORDER has six kinds, but a kind needs animals seen near the annex (rabbits and goats
rarely are) and the annex holds three or four pens. Births are counted from the server's entity count, not the feed: a
feed with no young counts nothing. Targets: a breeding visit breeds up to 4 pairs once the pen's adults are grown (20
game minutes), so 20 young is some 6-10 visits over three pens; a sheep gives 1-3 wool and regrows it on the pen's grass
(5 minutes between shearings), so 32 wool is some 16 shearings; 8 bales are 72 wheat, about four harvests of a
neighbourhood field. With 50 members the pens, not the members, set the pace: about 2-3 hours.

A live run should watch: `[pens] ... young <kind> born` lines, the `[ladder] ... finished stage` lines, a `Make the village
shears` forge once stage 3 is near, `make:hay_block` makes. Risks: a village whose annex never holds a third kind stays on
stage 1 (no animals seen near it); the hay competes with bread and the cows' and sheep's breeding for wheat.

### Music (tier 2, #249): built 11-14, `MC_MUSIC_AGE` (on)

The draft's jukebox needs a diamond (tier 3) and a music disc drops only from a creeper killed by a skeleton or from a
dungeon chest, neither practical in a peaceful world or by Mineflayer; they became a bandstand of note blocks tuned to a
scale, which is music the village builds and anyone can play. The bell has no recipe; the merchant sells one (as for the
monument's furnishing, 12 emeralds), and redstone, which the iron levels rarely meet (vanilla's clerics sell it, 2 for an
emerald).

| Stage | Counter, target | Counted where | Feeds |
|---|---|---|---|
| 1. redstone bought from the merchant | `redstone`, 8 | the trade step's "bought N redstone", once the activity's deposit landed (`musicCounts`) | `activity:lib:buy:redstone`, `activity:lib:sell` |
| 2. note blocks made | `notes`, 8 | a make's "put into storage: N note_block" | `make:note_block`, the redstone buy |
| 3. a bandstand of note blocks tuned to a scale | `bandstand`, 1 | a level: the built `bandstand` rung work | `help:bandstand` |
| 4. a bell hung on a post in the village | `bell`, 1 | a level: the built `bell_post` rung work | `help:bell_post`, `activity:lib:buy:bell`, `activity:lib:sell` |

While music is current: storage keeps (and lib:buy buys) a redstone for each note block still to make and one bell until
the bell post is posted (`ladder.ts` musicKeep, the world's tradeKeep and merchantUses); the workshop makes note blocks
(`MUSIC_GOODS`) up to the 8; the village posts the bandstand once storage holds the 8 note blocks and the bell post once it
holds the bell (`postRungWorks`, the blocks and the bell taken from storage as gathered, as the copper canopy's blocks).
The bandstand (`smallWorks.ts` RUNG_WORKS): 6x4, a plank floor, fence posts at the corners, a slab roof, two rows of four
note blocks set by command with `note` 6 8 10 11 13 15 17 18 (a C major octave from middle C), air above each. The bell
post: 3x3, a cobblestone base, two fence posts and a log beam, the bell hanging from it. Redstone joined the planner's
gathered items (`mcMaterials.ts` GATHER, as wheat: its only recipe is the redstone block's, a cycle that left the note
block with no plan). The merchant's redstone (and the bell, when the monument's bell offer is off) is appended last.
Targets: 8 redstone is 4 emeralds and the bell 12, some 16 lots sold; 8 note blocks are 64 planks; two small works.
About 2 hours, mostly the emeralds and the two works' crews.

A live run should watch: the merchant's "bought N redstone" and "bought 1 bell" trades, `make:note_block`, `[ladder] ...
the village posts iN, a bandstand / bell post`, "the bandstand waits for 8 note_block in storage", and whether the
bandstand's note blocks keep their `note` (placed with states by command; check one with `execute if block`). Risks: the
bell's 12 emeralds wait on sales; a small-work spot must be found for each work.

### 3. Machines (tier 3, #24): built 11-14, `MC_MACHINES_AGE` (on, with MC_IRON_AGE)

| Stage | Counter, target | Counted where | Feeds |
|---|---|---|---|
| 1. a hopper egg collector under the chicken pen, feeding a chest | `collector`, 1 | a level: `v.machines.collector`, written by `fit_egg_collector` (mcBuild.ts) once `execute if block` shows the hopper and the chest | `penwork:N:collector`, `make:hopper` |
| 2. 16 rails and a minecart made | `carts`, 17 | a level: min(16, rails stored) + min(1, minecarts stored) | `make:rail`, `make:minecart` |
| 3. a rail line from the mine to the storage hut | `railline`, 1 | a level: `v.machines.line.done`, set by `lay_rail_line` when the server shows a rail (`#minecraft:rails`) in every cell | `rung:rail_line`, `make:rail` |
| 4. powered rails on the line, lit by a redstone torch | `powered`, 6 | a level: the line's cells the server shows as `powered_rail[powered=true]` | `rung:power_line`, `make:powered_rail`, `make:redstone_torch`, `activity:lib:buy:gold_ingot`, `activity:lib:buy:redstone`, `activity:lib:sell` |

- **The egg collector** (`fit_egg_collector`, a pen chore `penwork:N:collector` on a chicken pen while stage 1 is current and
  storage holds a hopper or 5 ingots): a hopper set in the pen's floor at its back cell (where the chickens stand: an egg
  laid over it drops in), facing a chest set under the fence behind it; both placed by `runJob` (charged, withdrawn from
  storage, the hopper made from 5 ingots and a chest when short), then confirmed. It gathers the eggs laid over its one
  cell; the pen's egg collection goes on as before.
- **The rail line** (`lay_rail_line`, option `rung:rail_line` while stage 3 is current and storage holds rails): planned once
  by `padPaths.ts planRailLine`, the paths' A* turned to rails: 4-neighbour steps only, a climb of at most 1 a cell, no turn
  on a slope (a turn only where neither neighbour along the line is higher, and no rail in a dip), a turn costing 2 more so
  the line keeps straights; from the cell outside the mining hut facing the storage hut to the cell outside the storage hut
  facing the mine, off buildings, fields, pens and slots, lamps and signs (by 1), open works and other villages, at most
  160 rails (`RAIL_LINE_MAX`). Each rail's shape (`railShapes`) is set with it. A trip lays up to 48 rails by `runJob`
  (charged), a path cell under a rail made dirt first (a rail does not stay on a path block), then reads every cell from
  the server; `laid` is the confirmed count. A failed plan is kept 30 minutes (the option is not offered), then planned
  again. The minecart is set on the hut end once the line is whole (taken from the member, summoned).
- **The powered rails** (`lay_rail_line mode=power`, option `rung:power_line` once storage holds the 6 powered rails and a
  redstone torch): `poweredRun` finds the first 6 flat straights in a row away from the line's ends and a cell beside the
  middle one, on solid ground, for the torch (a torch powers the rail beside it; power runs 8 along powered rails); the 6
  replace the rails there, the torch is set, and each is confirmed `powered=true`.
- **Gold and redstone**: the iron levels rarely meet gold (it lies deeper) and redstone is below them, so the merchant sells
  gold ingots (1 for 2 emeralds, 6 a restock) with the rung on, and redstone (the music rung's offer, or its own when music
  is off); storage keeps 6 gold and the redstone the powered rails and torch take while stage 4 wants them (`ladder.ts
  rungKeep`, the world's `tradeKeep` and `merchantUses`), so lib:buy buys them. Raw gold a deep trip brings smelts too.
- **The goods** (`mcWorkshop.ts MACHINES_GOODS`, targets `rungGoodTarget`): a hopper until the collector stands; 16 rails and
  a minecart through stage 2; then the rails the planned line still takes; 6 powered rails and a redstone torch in stage 4.

Targets: the collector one hopper (5 ingots); 16 rails (6 ingots) and a minecart (5); a line of some 30-80 rails between
two huts a village apart (12-30 ingots, two or three trips of 48); 6 powered rails (6 gold, 12 emeralds) and a torch. With
50 members the ingots and the gold's emeralds set the pace: about 2-3 hours.

A live run should watch: `[machines] ... fitted an egg collector`, `[machines] ... the rail line planned, N rails` (or
`could not be planned: ...`), `laid rails on the line ...: N of M confirmed`, `the rail line ... is complete`, `powered N
of 6 rails`, the merchant's `bought N gold_ingot`. Check a powered rail with `execute if block X Y Z
minecraft:powered_rail[powered=true]` and walk the line once in a minecart. Risks: a village whose annex has no chicken
pen never fits the collector (husbandry's 3 kinds usually include chickens; nothing else offers the stage); the plan fails
on water or cliffs between the huts (the fail is logged and retried after 30 minutes, not routed round by bridges); a line
with no flat straight of 6 cannot take the powered rails; rails set by command may be reshaped by their neighbours'
updates (the server check reads `#minecraft:rails`, any shape); `runJob` fails a trip short of dirt for a path crossing.

### Bees (tier 3, #251): built 11-14, `MC_BEES_AGE` (on), after husbandry and copper

Before: the foundry's `harvest_honeycomb` activity (`activity:lib:honeycomb`, research-locked) shears wild nests off village
ground. Wild nests are few (4 within 150 blocks of minevale3's site in the test world's region files, against 10k logs and
4k wildflowers) and moving one takes Silk Touch, so the village keeps its own: **the merchant sells a bee nest with its bees
(6 emeralds, 2 a restock)** and the village sets two in an apiary. The bees are put in each nest by command (`data merge
block ... {bees:[two bees]}`) once the apiary stands: the honest stand-in for the nest's bees, paid for, with no spawn egg.

| Stage | Counter, target | Counted where | Feeds |
|---|---|---|---|
| 1. bee nests with their bees in the apiary, over campfires among flowers | `hives`, 2 | a level: `v.apiary.housed`, each nest the world's `houseBees` let its bees into (the server's "Modified" answer) | `help:apiary`, `make:campfire`, `activity:lib:buy:bee_nest`, `activity:lib:sell` |
| 2. honeycomb sheared from full nests | `honeycomb`, 16 | `tend_apiary mode=shear`'s "sheared N full bee nests at the apiary: M honeycomb" (counted on the server before and after), or the wild-nest activity's "got N honeycomb from" once its deposit landed (`beesCounts`) | `rung:apiary:shear`, `activity:lib:honeycomb`, `iron:forge:shears` |
| 3. honey bottles filled | `honey`, 8 | `tend_apiary mode=bottle`'s "filled N honey bottles at the apiary" | `rung:apiary:bottle`, `make:glass_bottle` |
| 4. the copper canopy's copper blocks waxed | `waxed`, 5 | `wax_copper`'s "waxed N copper blocks of the copper canopy", each confirmed by the server | `rung:wax_copper`, `rung:apiary:shear` |

- **The apiary** (`smallWorks.ts` RUNG_WORKS `apiary`, 5x3, posted by the village while stage 1 is current once storage holds 2
  nests and 2 campfires, taken as gathered): two `bee_nest[facing=south]` on a log frame, each 2 above a lit campfire with a
  cell of air between (the smoke keeps the bees calm when the nest is used), 9 wildflowers round them (gathered by the crew,
  as a garden's), a slab roof; the ground under the flowers left as it is. The village's gardens add more flowers.
- **Tending** (`tend_apiary`, options `rung:apiary:shear` / `rung:apiary:bottle`, every 3 minutes of game time at most): the
  server reads each nest; at a full one (`honey_level=5`) the member stands in front and uses the shears or a glass bottle
  on it (a real use: `activateBlock`), the nest back at 0 is read from the server, the honeycomb's drops are brought to it by
  command (as a pen's eggs), the gain is counted on the server; the chore deposits it. The forge makes the village shears
  while bees is current and storage has none; the workshop makes glass bottles (3 glass make 3) for the honey still to fill.
- **Waxing** (`wax_copper`, option `rung:wax_copper` while stage 4 is current and storage holds honeycomb): the copper
  canopy's roof cells (from its design at its structure) read from the server (copper, exposed, weathered or oxidised), a
  honeycomb taken and the waxed block of the same stage set, confirmed, the honeycomb given back otherwise. This is
  copper's stage 3 "waxed copper roofs", done on the copper rung's own roof.

Targets: a nest is full after five pollen trips by its 2 bees (some 5-10 minutes in daylight, the time frozen at day); 16
honeycomb is about 6 shearings (3 each), 8 bottles 8 fillings, so some 14 full nests from 2 nests, about an hour; the nests
are 12 emeralds (about 12 lots sold); the roof 5 honeycomb. About 2-3 hours.

A live run should watch: `[ladder] ... the village posts iN, a apiary`, "the apiary waits for 2 bee_nest, 2 campfire in
storage", `[bees] ... the apiary's bees let into 2 of 2 nests` (else "no bee nest at X to let the bees into"), `[bees] ...
sheared N full bee nests` / `filled N honey bottles`, "no full bee nest at the apiary" (how often), `waxed N copper blocks`.
Check a nest with `data get block X Y Z bees`. Risks: the bees' NBT format (`bees`, `entity_data`, `ticks_in_hive`,
`min_ticks_in_hive`, 1.20.5+) is untested on 26.1; bees need flowers within reach and daylight; the shears' use is a
Mineflayer `activateBlock` (a use that does not land leaves the nest full: retried next time); the campfire burns a member
who walks into it in a world with damage; the campfire's make needs coal (the planner takes coal for the recipe's coals).

### Maps (tier 3, #252): built 11-14, `MC_MAPS_AGE` (on), after letters

The draft's last stage, an explorer or locator map, is impractical: an explorer map comes only from a cartographer
villager's trade (a structure found for it), and since 1.20 every map is a locator map. It became a 3x3 atlas of the land.
Maps follow vanilla's grid: a map of scale 0 shows the 128x128 area its maker stands in (areas centred on 0,0).

| Stage | Counter, target | Counted where | Feeds |
|---|---|---|---|
| 1. a cartography table made | `ctable`, 1 | a level: a table in storage, or the map wall built | `make:cartography_table` |
| 2. a map of the village's own area, made at its centre | `vmap`, 1 | a level: the area holding the storage hut's middle charted (`v.maps.cells`) | `rung:chart:I:J`, `make:map`, `activity:lib:buy:redstone` |
| 3. maps of the nearest areas hung on the map wall | `mapwall`, 4 | a level: `v.maps.hung`, each frame confirmed by the server holding a filled map | `rung:chart:I:J`, `rung:hang_maps`, `help:map_wall`, `make:map`, `make:item_frame` |
| 4. a 3x3 atlas of the land round the village | `mapped`, 9 | a level: the charted areas among the 3x3 round the own one | `rung:chart:I:J`, `make:map`, `activity:lib:buy:redstone` |

- **Charting** (`chart_map i= j=`, options `rung:chart:I:J`, two at a time, the nearest first, while storage holds empty maps;
  `ladder.ts chartWanted`): the member takes an empty map, walks to the point of the area nearest the village 8 blocks
  inside it (`chartPoint`), checks it stands in that area, uses the map (`activateItem`), sees a new filled map counted on
  the server, reads its id (`data get entity ... SelectedItem.components."minecraft:map_id"`, else the highest map id in its
  inventory), holds it 4 seconds while it draws, records the area; the chore deposits it.
- **The map wall** (`smallWorks.ts` RUNG_WORKS `map_wall`, 4x2, posted while stage 3 is current once storage holds the
  cartography table, taken as gathered): a plank board between log posts under a slab roof, the table beside it. The four
  maps are the village's own area and its three neighbours toward the hut's nearest corner of it (`wallCells`), hung north
  up. **Hanging** (`hang_maps`, option `rung:hang_maps`): per frame, an item frame and that area's own map (by id, `clear
  ... filled_map[minecraft:map_id=N] 1`) taken from the member and the frame summoned on the board's south face holding it
  (`Fixed`), confirmed with `execute if entity @e[type=item_frame,...,nbt={Item:{id:"minecraft:filled_map"}}]`; what did not
  hang is given back.
- **The goods** (`MAPS_GOODS`): the table (2 paper, 4 planks); empty maps (8 paper and a compass of 4 ingots and a redstone)
  for the areas still wanted, 4 at a time; 4 item frames (8 sticks and a leather) in stage 3. Storage keeps a redstone for
  each map still to make (`rungKeep`), which lib:buy buys.

Targets: 9 maps are 72 paper (72 cane, the letters rung's farm), 36 ingots and 9 redstone (5 emeralds); the charting walks
are up to some 200 blocks out and back for the atlas' far corners. About 2-3 hours.

A live run should watch: `[maps] ... mapped area I,J (map #N) from X,Z`, "could not reach map area" (water, cliffs), "the map
did not fill", `[ladder] ... posts iN, a map wall`, `[maps] ... hung N maps on the map wall`, "did not hang". Look at the wall
in game. Risks: the map id's read (`SelectedItem` may be gone from 26.1's player data; the inventory fallback takes the
highest id); the frame's summon NBT (`Facing`, `Item.components`) is untested on 26.1; the far areas may lie over water;
maps needs MC_LETTERS on to reach the ballot (after letters).

### 4. Enchantment (tier 4, 2-3 sessions, #23 and #19)

- Obsidian: water poured on still lava (bucket skills: fill, pour) or mined with the diamond pickaxe. Lava lies at the
  deep mine's levels, which diamond already reaches and guards.
- The enchanting table (a book, 2 diamonds, 4 obsidian) placed in the library.
- **Experience** is the hard part: an enchanter must earn and keep 8 levels (mining ore, smelting, breeding). Nothing
  tracks experience now: #19's XP budget (who earns it, who must not spend it on death in hostile mode).
- Enchanting through the table's window (Mineflayer's `openEnchantmentTable`), lapis from the mine.

### 5. The Nether (tier 5, 4-6 sessions, #25, research)

The portal is easy once there is obsidian (flint and steel). The work is a second dimension: positions with a dimension,
the bodies and the atlas, pathfinding, rescue, protection, spawn checks and chunk loading all assume the overworld; then
an expedition, piglin barter (gold), and netherite (ancient debris and a smithing template from a bastion). Spec it
before building.

## A village wage for rung work (#250, `MC_RUNG_WAGE`, 1; built 11-14)

(the user's, 11-14) With MC_PAY on (off by default; it needs MC_OWN and MC_ACTS), a member whose chore fed the current
stage is paid by the village: `MC_RUNG_WAGE` emeralds (default 1, 0 off) into its own chest record. Nothing happens while
MC_PAY is off.

- **When**: a chore whose option carried the ladder's tag when it was picked (`feedsStage`, the menu's test; the tag is
  kept on the chore, `ChoiceState.ladderFed`) and ended well (ok, not cut). A failed, cut or unfed chore earns nothing.
- **From where** (`mcPay.ts` payWageFor, `pay.ts` reserveRungWage and payRungWage): storage's emeralds above the
  merchant's keep (`commonsSpare`; the keep holds the trade rung's 40 while trade is current, so wages never eat its
  third stage), taken by command and counted as a bounty's are; when storage has none to spare, minted. The ledger logs
  `escrow` from the village or `minted` with "a rung wage" in its why, so the conservation sum (`pay_ledger`) holds and
  `[pay]` lines show each wage; `[ladder] ... earns the village's wage` names the member.
- **Cap**: at most 5 emeralds a member a village day (RUNG_WAGE_DAY; with a wage over 5, one wage a day), reserved at
  the chore's end so two ends do not both fit. With 1 emerald a wage and 50 members that is at most 250 emeralds a village
  day, minted only when storage is short.
- **Told**: the tag on feeding options reads `[for the iron age, pays 1 emerald]` while the member's day has room for a
  wage, and the progress line adds "The village pays 1 emerald into your chest for each chore that feeds its ambition (up
  to 5 a day)."
- **Check**: `rung_wage_unit` (paid only for fed chores that ended well, from the commons above the keep, minted at the
  trade keep, the cap, conservation, the tag and the line; nothing with MC_PAY off or MC_RUNG_WAGE=0). A live run with
  MC_PAY on should count the `[pay] ... rung wage` lines against the fed chores and watch how many are minted.

## Rungs we do not have yet

Minecraft's progression has more than the seven rungs above. Candidates, with the tier they would take:

| Rung | Stages (draft) | Tier | Notes |
|---|---|---|---|
| **The sea** | a boat, a dock, prismarine from an ocean monument, a conduit | 4 | needs water travel and guardians (hostile mode) |
| **Brewing** | a brewing stand (blaze rod), Nether wart farm, 10 potions | 6 | after the Nether |
| **The End** | eyes of ender (ender pearls, blaze powder), the stronghold found, the portal lit, the dragon | 7 | the last rung; far off |

Brewing and the End need the Nether, so they only matter once tier 5 is built. Husbandry and music, the cheapest
additions to tier 2, are built (above), and bees and maps in tier 3 (above). With five tier-2 rungs the ballot after iron
offers the first four in the ballot's order (letters, copper, trade, husbandry); music joins once one is reached. Once
every tier-2 rung is reached the ballot offers tier 3: diamond, machines, bees and maps (maps only with MC_LETTERS, after
letters; bees after husbandry and copper). Checks: `tier3_unit` (the three rungs' stages, feeds, goods, keeps, the rail
line's plan and powered run, the designs, the map areas, the ballot, the flags off).

## Order of work

1. Trade, 2. copper (both built 11-14: tier 2 has three rungs, the first real ballot after iron), 3. husbandry (optional, tier 2),
4. machines, 5. bees and maps (tier 3; all three built 11-14), 6. enchantment, 7. the Nether (spec first). Each rung goes into a test
train with its flag on and off.
