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
| 2 | letters, trade, copper | built from what the village already does (cane, the merchant, the iron mine's side ore) |
| 3 | diamond, machines | the deep mine; machines' powered rails need gold and redstone from deep levels |
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

### 3. Machines (tier 3, ~2 sessions, #24)

Hoppers, rails and minecarts are crafts from iron. The egg collector is a hopper under the chicken pen (pens exist). The
rail line from the mine to the storage hut is new route-and-place code (like a street: a path, then placing by command,
charged to the inventory) and a check. Powered rails need gold and redstone dust: the deep mine passes the redstone
levels, so this rung sits in tier 3 beside diamond.

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

## Rungs we do not have yet

Minecraft's progression has more than the seven rungs above. Candidates, with the tier they would take:

| Rung | Stages (draft) | Tier | Notes |
|---|---|---|---|
| **Husbandry** | a breeding pen per animal, 20 animals bred, wool from a flock, a hay bale store | 2 | pens and shearing exist (`shear_for_yard`); breeding is a right-click with food |
| **Bees** | 2 hives (campfire under), 16 honeycomb, 8 honey bottles, waxed copper | 3 | needs a bee nest found and moved with Silk Touch, or a hive near flowers; brings back copper's waxing |
| **Maps** (cartography) | paper (letters), a cartography table, a map of the village, a map wall | 3 | after letters; the atlas already knows the land |
| **Music** | note blocks, a jukebox, a disc, a bell in the square | 2 | small; makes the village feel lived in |
| **The sea** | a boat, a dock, prismarine from an ocean monument, a conduit | 4 | needs water travel and guardians (hostile mode) |
| **Brewing** | a brewing stand (blaze rod), Nether wart farm, 10 potions | 6 | after the Nether |
| **The End** | eyes of ender (ender pearls, blaze powder), the stronghold found, the portal lit, the dragon | 7 | the last rung; far off |

Brewing and the End need the Nether, so they only matter once tier 5 is built. Husbandry and music are the cheapest
additions to tier 2.

## Order of work

1. Trade, 2. copper (both built 11-14: tier 2 has three rungs, the first real ballot after iron), 3. husbandry (optional, tier 2),
4. machines, 5. bees and maps (optional, tier 3), 6. enchantment, 7. the Nether (spec first). Each rung goes into a test
train with its flag on and off.
