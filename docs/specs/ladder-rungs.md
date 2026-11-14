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
implemented left the ladder stays at its last rung reached. Today, with letters and diamond on: iron, then letters
alone, then diamond alone, then nothing. As rungs are implemented they join the ballot in their tier with no further
change here.

Checks: `ladder_unit` (the rule, letters then diamond, nothing after), `diamond_unit` (MC_LADDER_START=diamond).

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

### 1. Trade (tier 2, ~half a session, #246)

All the work exists (`merchant.ts`, `pay.ts`, market stalls, `MC_MERCHANT_ORDERS`). Counters only:
merchant sales, a market stall per neighbourhood, emeralds in the village chest, merchant orders filled.
Stage 4 needs `MC_MERCHANT_ORDERS` on: the rung is implemented only with it (or stage 4 changes to "N barters").

### 2. Copper (tier 2, ~1 session, #247)

Exists: copper ore in the iron mine (`mcMine.ts`), the kiln smelts it, the cutter makes cut copper, monuments lay copper
roofs. New: keep copper ore when found (stage 1's counter), copper blocks and cut copper for a work (stage 2). Stage 3's
waxing needs honeycomb, which needs bees (a new chain); replace it with "a copper roof on a civic building" now and
bring waxing back with the bees rung below. Stage 4: a lightning rod (3 ingots) and a spyglass (amethyst shard from the
geode, `MC_GEODE`).

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

1. Trade, 2. copper (tier 2 then has three rungs, so the first real ballot after iron), 3. husbandry (optional, tier 2),
4. machines, 5. bees and maps (optional, tier 3), 6. enchantment, 7. the Nether (spec first). Each rung goes into a test
train with its flag on and off.
