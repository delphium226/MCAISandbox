# Fixes for #180 (the diamond rung's deadlock) and #179 (house place, status answers): report

Commit **157036d** on `tiered-brain-building`, pushed to `private`. Both issues are closed with comments. No new flag: both
are bug fixes inside `MC_DIAMOND_AGE` and `MC_TALK`, which are already on.

## #180: the diamond rung deadlocked for want of iron pickaxes

**Cause.** There were three gates, all keyed on "the village wants diamonds" and none on whether it had the pickaxes:
1. `deepenForDiamonds` closed every iron level as a landing as soon as its level was known, so no iron level was dug.
2. The menu's `deepDigBlocked` refused the dig to anyone without an iron pickaxe.
3. `digIron` in mcBuild refused the trip too. I found this gate only in the live run: the menu offered the dig, the trip
   failed, and the dig was banned for an hour.

A village with no iron pickaxes could not get iron, so it could never make any. Train 13's iron came only from stray ore.

**Fix.**
- **The rule:** `deepPicksShort(v)` (mcMine): diamond is the current rung and fewer than `IRON_MINERS` (3) members have
  been given an iron pickaxe or better (`ironGiven`, one per member). The count is what the village has made, not how
  the ladder got there, so it holds for `MC_LADDER_START=diamond` and for a ladder that reached diamond with few
  pickaxes made.
- **While it holds and the chain is not deep:**
  - `deepenForDiamonds` lays nothing deep, so iron levels are dug as before;
  - `deepDigBlocked` returns null, and so does `digIron`'s `gems`, so stone pickaxes may dig;
  - the dig keeps iron's own words, with the fact "the deep stairs wait for the deep miners' iron pickaxes (k of 3 given):
    iron first".
- **The forge** already gives an iron pickaxe to each member who has dug iron (`FORGE_NEEDS`), so k climbs to 3 and the
  chain then goes deep.
- **A deep chain stays gated:** it still needs an iron pickaxe.
- **The false clause:** `diamondForgeNeed` now says "no member has dug in the mine yet" when nobody has dug.
  "Every deep miner has a diamond pickaxe" is said only when it is true.

**Checks.**
- **`diamond_unit.mts`:** 7 new cases, all ok:
  - 0 or 2 pickaxes (one member given two): nothing deepens, there is no gate, iron's words, the fact;
  - the third pickaxe given: the chain deepens and the gate holds;
  - a deep chain stays gated;
  - nothing before the rung;
  - the corrected clause.
- **Staged F1** (world 4; t12_pad_open, P1, 6 scripted workers, fast; `MC_LADDER_START=diamond`, MC_LADDER, MC_IRON_AGE,
  MC_ORE_MINE; `--stock stick:16` and **no iron pickaxes**; log `testagents-w4-180109.log`):
  - **iron dug** with stone pickaxes: storage went 0 → 4 → 11 → 19 raw iron over the first trips;
  - **iron pickaxes forged:** 4 in the first ~15 min (Ada, Ben, Elena, Finn);
  - **deep stairs started:** a landing at y 12, stairs to y -28, then a landing at -28 with stairs to -56.
  - **at the end (+45 min):** the chain reached the diamond level, y -56, by landings at 12 and -28. **Stage 1 was done**
    (56 blocks down below y 0, mostly by Finn). 797 cells had been dug at -56; 3 diamonds, 17 redstone and 2 lapis were
    kept; 65 raw iron came up in all.
  - **iron pickaxes given:** 10, to Ada, Ben, Elena and Finn (the worn ones forged again); also 4 iron hoes.
  - **`deep_dig.py P1 --end`: DEEPCHECK OK.** 3 levels below y 0, 270 stair cells and 928 level cells checked, 0
    failures.
  - **Walk-stall lines** (agent_log): `[lag]` 0, `[stuck]` 10, `[repath]` 5, `[dig]` 13. Busy 56%.
- **The first F1 try** (log `testagents-w4-175131.log`) found the third gate (digIron) and was restarted after the fix.

## #179: a house request ignored its place, and the Mayor invented status answers

**Cause.**
- The houses branch of `talkBuildCheck` returned no place.
- `talkStart` set `growth.request` with no point, so `layOutNext` laid the street where outward growth put it.
- The ledger marked the request `under_way` as soon as growth was asked, so the talk prompt's history said "being built"
  while growth rested in its back-off. The model then filled in "right where you marked".

**Fix.**
- **The place.**
  - `talkPlace` now runs for houses too. `growth.request.near` carries it, and `layOutNext` passes `near=` to
    lay_out_houses (`growSite` already honoured it).
  - For a pad village's outward layout, the search area now reaches 16 round the place (it stopped at the pads' extent
    plus 20, short of a spot 45 out). A place asked pulls with weight 3 instead of 1.5.
  - A request made while a street is already asked for (and has no place) joins it and gives it the place. Before, it
    was refused. That is what F2's first try met: a member had asked for a street just before.
  - The answer says "as near here as there is room (north-west of the village, ~45 blocks)", or why not.
- **Status facts.**
  - `talkProgress` (mcWorld) reads the world: queued and why it waits (growth's back-off), not started, being built with
    k of n Build tasks done, done or failed. It gives where the layouts are and how far each is from the place asked. A
    street laid outward is one layout per house, and all of them are counted.
  - `statusLines` (playerTalk) turns these into lines. The talk prompt shows them as "Their requests now (from the
    village's records; say nothing about them these do not show)", and both system prompts point at it.
  - The history line uses the world's state, not "being built".
  - A status question (`isStatusQuestion`: "where?", "what happened…", "is it done yet"...) gets the latest request's
    fact appended after the model's line, as builds already did.
- **Also:**
  - `/api/say` takes `pos {x,y,z}` for a speaker not in the game;
  - `reset_site.py` drops the reset villages' requests from `talk.json`. A checkpoint does not hold them, and a
    "finished" street left from an earlier run made the Mayor refuse a new one.

**Checks.**
- **`player_talk_unit.mts`** (new, in check:offline): the fact lines, the history's words, the prompt's section, and 10
  lines judged as status questions or not.
- **requestbench**, gpt-oss:120b-cloud, PEEK=1, 6 samples each:
  - house "here": 6/6 `build houses place="here"`;
  - "where?" while nothing is under way: 6/6 chat with no claim of building ("still pending; … before we can start
    building");
  - "how's my house coming along?" mid-build: 6/6, "two of the four houses are already up";
  - all 14 cases: 84/84.
- **Staged F2** (world 5; t12_pad_open, P1, 6 workers; `scripts/checks/talk_place.py`, asking from -1663,2, 45 blocks
  north-west of home; `talk_place6.log`): **TALK PLACE OK**.
  - The request joined the street a member had asked for: "as near here as there is room (north-west of the village,
    ~45 blocks)".
  - "where?" got "…accepted, not started yet: the street is laid out when growth is free".
  - Mid-build, "being built, 1 of 4 built; north-west of the village, ~35 blocks, 4 buildings ~…".
  - The street was finished within 5 min. Its 4 houses stood 10, 11, 26 and 33 blocks from the place asked (mean 20).
    The run before the weight change (`talk_place4.log`) had 11, 26, 34 and 47, mean 30.
  - "what happened?" got "finished 1 min ago; north-west of the village, ~35 blocks, 4 buildings ~10-35 blocks from the
    place asked".
- **Left for the model:** gpt-oss still words it warmly. One answer said "right where you requested it" in front of
  code's "~10-35 blocks". The facts after the dash are now true, but the model's own clause can still overstate.

## Offline

`npm run check:offline`: 114 ok, 0 failed (with `player_talk_unit`; the `diamond_unit` cases; `grow_outward` passes with
the new weight).

## Follow-ups (not done here)

- The model's own words can still overstate a place ("right where you requested"). A code check on the say against the
  facts would be the next step if it matters in a train.
- A deep chain whose miners' iron pickaxes all wore out, with no ingots left, can still stall: deep digs need an iron
  pickaxe, and the deep level is the iron source then. That did not happen here (the deep level holds ~16 iron a layer,
  and the forge re-forges worn pickaxes).

Context used at the end: ~70%.
