# A skill tree for the foundry

Session 36, 2026-10-18: a proposal only (the user's word: document it, build nothing yet). The skill foundry (X.3,
`scripts/foundry.py`) now runs one ticket end to end: `shear_sheep`, written by agy, passed every gate and was merged
(`b3ab0b7`). What it lacks is a source of tickets: which skill to build next, in what order, and how to tell it works.
This note proposes one, for X.3's next tickets and X.4's outer loop.

## The idea in one line

Use Minecraft's **advancements** for the order and the acceptance tests, and a tree **computed from the game's data** for
the value of each skill; the next ticket is the most valuable skill whose prerequisites are done.

## 1. Advancements: the tree the game ships

The game jar holds every advancement as data (`data/minecraft/advancement/**.json`), each with a `parent`, so they form a
real tree in five tabs. Two matter here:

- **Story**: Stone Age, Getting an Upgrade, Acquire Hardware, Suit Up, Hot Stuff (a lava bucket), Isn't It Iron Pick,
  Diamonds!, Enchanter...
- **Husbandry**: A Seedy Place (plant a seed), The Parrots and the Bats (breed two animals), Fishy Business (catch a fish),
  Bee Our Guest (honey from a hive), Best Friends Forever (tame an animal), Serious Dedication...

Why they suit the foundry:
- **Machine-checkable criteria.** Each advancement lists its criteria (an item obtained, an entity bred, a block placed).
  The bots are real players, so they earn advancements as anyone does, and Paper records them per player
  (`world/advancements/<uuid>.json`; `/advancement test` checks one). A ticket's live gate becomes "the bot earned the
  advancement", a test the coding agent cannot fake by printing a success message.
- **Order for free.** A skill is ready for a ticket when its parent advancements are earned in the village.
- **Visible progress.** Advancements show in-game and per agent; the panel could list the village's.

Limits: advancements name achievements, not skills; several need the Nether or the End, or combat (dead ends here, see 3);
and some skills the village needs have no advancement (shearing has none of its own). So the tree needs a second source.

## 2. A tree computed from the game's data

X.1 already builds the recipe graph from the jar (`activities.ts`, `mcMaterials.ts`): what can be crafted or smelted from
what. Recipes are not actions, though: what blocks most goods is a missing **verb**.

- Join the recipe graph to the **loot tables** in the jar (`data/minecraft/loot_table/**`): shearing (`shearing/sheep`),
  fishing (`gameplay/fishing`), bee nests and hives, villager trades, archaeology, and so on. Each loot table is an action
  with its yield.
- For each action the village lacks, count what it **unlocks**: catalogue goods that become reachable (wool -> beds,
  carpets, banners; fish -> cooked fish; honey -> honey blocks, sugar), and N.1 needs it answers (beds for N.6).
- The value of a skill = goods unlocked (weighted by how much the catalogue and the needs use them) per unit of expected
  ticket cost. Shearing would have ranked high: wool is the only route to beds.

This is lesson 143 (read what the game's data holds before designing on it) applied to the foundry: the value is counted,
not guessed.

## 3. What the tree shows before any ticket

- **Peaceful dead ends**, flagged instead of ticketed: no hostile mobs means no string from spiders (so no fishing rod,
  unless from rare cobwebs), no blaze rods (no brewing), no gunpowder, no ender pearls; the Nether and the End are out of
  reach as the village stands.
- **Choices that belong to the user**, marked as such: killing passive animals (leather for books, hence enchanting;
  meat) is possible in peaceful but a question of the village's character; taming, breeding and trading raise no such
  question.
- **Links to Phase N**: trading needs villagers (N.4); beds need wool (N.6, now unblocked by shearing); bee keeping and
  more crops feed the food needs (N.1).

## 4. How the foundry would use it

1. A world-free builder (offline, like the X.1 catalogue) reads the jar: advancements, recipes, loot tables; writes the
   tree with each node's parents, value, status (have / ready / blocked by a parent / dead end / the user's call) and a
   ticket template (what the skill must do, the files to read, the acceptance advancement or check).
2. The next ticket = the ready node of highest value. A person (the user, or a session) still reads the generated ticket
   before it runs: s36's shearing showed that the acceptance check, not the coding agent's own review, carries the weight
   (agy's review found nothing in 92 s).
3. X.4's outer loop can rank by the tree's value first, then by run failures (agent-minutes lost), as planned.

## 5. Costs and limits

- One ticket cost ~37 minutes and ~1M input tokens through agy (the user's Google plan): a tree of 30-50 nodes is many
  sessions' worth of tickets; the value ranking is what keeps that affordable.
- **A skill nobody uses is wasted.** Each built skill needs a way onto the members' menus (a chore, an initiative's step,
  a workshop make) or it sits unused, as `shear_sheep` does today. A ticket for a skill should name the menu option that
  will use it, or come paired with one.
- Advancement criteria can be met in ways the skill did not cause (an item picked up, given by command in a test); the
  gate should start from a bot that lacks the advancement and items, on test world 3's reset.

## Status

Proposal only; nothing built. Related: `docs/research/self-improving-activities.md` (the foundry's design), PLAN.md
Phase X (X.3, X.4), `runs/2026-10-18/foundry/shear/report.md` (the first ticket).
