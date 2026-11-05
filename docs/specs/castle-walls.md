# Castle walls (#217): a stone wall members can patrol and shoot from (spec, 2026-11-05)

The user's request (11-03): "We need proper walls. Something like an outer castle wall that the members can patrol and
fire arrows from". Builds on survival (d) section 5 (`runs/2026-10-31/survival/spec_d.md`), the fence ring of #203
(45f5049, 4a18344, a37a58c; `runs/2026-11-03/survival-211-203/notes.md`) and the castle generator of #153
(`server/src/castleGen.ts`). Spec only. **Everything here acts only where `mobs` is true** (`MC_WORLD_MODE=hostile|normal`):
each step has its own flag, **on by default**, and peaceful and easy stay word for word as they are (the goldens hold).

**The rule this spec keeps** (DECISIONS 11-04, the user's): the wall keeps the members' vote. This spec changes what the
ballot offers and shows, so members vote on the real thing; it never builds a wall the members refused, and a wall that
is refused again after these changes is a result, not a bug.

## 1. Why members refuse the wall (trains 20 and 21)

Read from the `[vote]` and `[ballot]` lines of `runs/2026-11-04/testagents-w{4,5}-{174352,174354,211309,211311}.log`, the
recorded ballot prompts (`runs/model-calls/2026-11-04-*.jsonl`, kind `ballot`) and the acts files. Script and output:
`runs/2026-11-05/castle-walls/walltally.py`, `walltally.txt`.

- **12 wall votes, not 10** (5 in train 20's I1, 1 in its I0, 3 in each arm of train 21), 25 voters each, every ballot
  cast: **300 ballots, 93 yes (31%), 207 no**; every vote refused, 5-11 for. Deaths did not move it: the first vote
  (no deaths yet) drew 9 yes; the votes after 5-8 deaths drew 5, 8, 7 and 11.
- **What the no ballots say** (keyword buckets, a ballot can be in several): 204 of 207 name the member's own work ("I
  prefer focusing on animal pens", "keep my time gathering and digging"); 127 the cost ("the massive amount of
  cobblestone and logs a wall requires"); 86 freedom or being shut in ("I prefer freedom to explore ... rather than ...
  a restrictive wall"); 85 exploring. **What the yes ballots say:** 88 of 93 safety from monsters; 38 that it uses their
  own skills; 17 the torches; 15 the looks.
- **What the ballot shows** (`mcWorld.ts` wallVoteTick, `vote.ts` buildBallot), and where it works against the wall:
  1. The frame is the public-works one: the system line says the vote is on "its next public work, a building every
     member then helps to gather for and build", and the question reads "The vote: the next public work". In fact the
     wall takes at most one builder per 6 members and draws on storage. Members answer as if their own day is at stake,
     and their persona and last-chores lines come first, so "I prefer X" is the easy answer.
  2. The cost is exact and large; the benefit is not stated. "~748 cobblestone and ~312 logs from storage" (train 21 I1)
     is 2.5 times the bill of the public-work quarters on the same village's ballots (~400 units), and the option says
     nothing of what the wall does at night.
  3. The stake argues against it: after a death it reads "3 of 5 deaths were on trips over 100 blocks out, 4 after
     dark", that is, deaths a ring at the village edge would not have prevented. (It is true; a wall answers the deaths
     and hostiles near home, and the ballot does not count those.)
  4. The alternative is framed as freedom: "No wall for now: members stay free for their other work".
  5. A two-option yes/no: the public works votes, with three projects and one "No new public work for now", gave the
     "no" 22% of ballots on average (it won 7 of 33); the wall's "no" took 69%.
  6. Nobody asked for it: the vote comes from code at the danger trigger. Of 973 proposals and laws in the four runs, none
     asks for a wall or defence (two are about weapons or a pen fence); of ~3,200 lines said, 16 mention a wall (all
     cobblestone_wall crafts or "east of the wall") and 16 monsters or deaths. Danger is not on members' minds.
  7. Order: yes drew 37% of ballots when shown second and 24% when shown first (the shuffle evens this out over a vote).
  8. The temperament model predicted 156 yes of 300; the model voted 93: the ballot's words push below members' own
     leanings.
- **What would honestly not change it:** a fence ring that does not keep monsters out. N11's finished ring (28 of 29
  segments) had 36-42 hostiles inside at night, with its 29 water gaps open (#203). Before the ballot claims the wall
  keeps monsters out, the wall has to.

## 2. What the castle wall is

A ring of stone on the line the fence ring already plans (walls.ts hull/growRegion/wallPlan, 6 blocks outside the built
bounds once growth is done, #203 option a), built in stages, each useful alone:

| Part | Form (blocks above the ground) | Why |
|---|---|---|
| Curtain | 2 thick; solid to +4; the walk on top (members stand at +5); a parapet on the outer column at +5 and merlons at +6 on every other cell; an outward lip (an upside-down stair) at the top of the outer face | zombies cannot jump 2; spiders climb walls but not an overhang (to be checked live, step 0); 2 wide is a walk the pathfinder can use |
| Footing | the ground under each column made solid down to the first natural solid block | the wall reads ground per cell as build_wall does; hollows under it would let mobs pass |
| Water crossing | the curtain carried down to the bed through water (a dam), or on deep water an arch of iron bars on a stone sill (water flows, mobs and boats do not pass) | #203's 29 gaps (88 cells in N7) |
| Tower | square, 5 x 5 outside, 3 above the walk, a timber floor at the walk, a stair up the inner side from the ground, slits on the outer faces, merlons; at the ring's corners and every ~40 cells | patrol ends and shooting posts; the stair is the walk's way up |
| Gatehouse | where a street or a pad path crosses the ring: a passage 3 wide through a block 7 deep, two fence gates (inner and outer, isWallGate's hook and the gatekeeper as today), the walk across its top | only where people cross: the fence ring has a gate in each of its 28-29 segments; a stone ring needs one per crossing |

castleGen.ts already draws these parts for the castle monument (curtain with a wall-walk, parapet and merlons; towers
with doors to the walk and slits; gatehouses), so the geometry module (step 3) borrows its rules and look rather than its
plan: the village's ring is a rectilinear hull of rectangles with water and other villages' work on it, not a preset.

**Stone for the look:** the bulk in any of the mine's stones (cobblestone, andesite, diorite, granite, cobbled deepslate,
tuff: the deposit lines show storage holding all of them), laid by the wall dressing (MC_DRESSING, always on: the user's
11-01) as a rubble pattern with a cobblestone plinth course; stone bricks for merlons and tower tops only when the kiln
has made them. Taking every mine stone roughly doubles what the wall can use.

## 3. The measure (lesson 99/113): stone against supply

**A ring:** the fence rings planned after growth were 430 cells (N6), 480 (N7), 692 (N11) and ~748 (train 21's ballot);
take 700. Water on the ring: 29 gaps in N11, 88 cells in N7; street crossings not yet counted (step 0).

| Part | Stone a unit | Units on a 700-cell ring | Stone |
|---|---|---|---|
| Curtain (2 x 4, parapet 1, merlons 0.5, lip 1, footing ~1) | ~11.5 a cell | 700 | ~8,000 |
| Towers (5 x 5, 8 high: shell 128, floor 9, top 9, merlons 8, stair 6) | ~160 | ~18 | ~2,900 |
| Gatehouses | ~300 | 2-6 | 600-1,800 |
| Water crossings (2 columns to a bed ~2-3 down) | ~5 a cell | 30-90 | 150-450 |
| **Whole wall** | | | **~12,000-13,000** |
| Lean curtain instead (1 thick, solid to +5, merlons, lip, footing; a timber walk of slabs on the inner side, a post every 8) | ~7.5 a cell + 1 slab | 700 | ~5,200 + ~90 logs |

The fence ring needs ~700 cobblestone and ~300 logs. A stone wall is 8-18 times that in stone.

**The supply** (the same four runs, 25 members, 1x, 120 min after):
- Storage's cobblestone (read from the deposit messages' "Storage now holds" lines): 13-33 at the start, 400-1,000 from
  +40, 470-900 at the end. At the wall votes (+50 to +58) storage held ~750-1,000: enough for the fence ring, a tenth of
  a stone wall.
- The mine as members choose it: 47-60 mine trips an arm, ~1,000 cobblestone each run (~500 an hour), 20 a trip, ~23 a
  minute while digging. Iron trips, the quarry and gathers add more (not counted here: the per-chore storage deltas in
  `[choice-end]` overlap between members and cannot be summed).
- At the wall's cap (1 builder per 6: 4 of 25), four members mining for it at about half their time digging bring
  ~2,500-3,000 an hour: **the whole wall is ~4-5 hours of four members' work, the lean curtain ~2.** A model-driven train
  runs 2 hours after completion. So the stone wall cannot be one job; each stage has to stand on its own, and the supply
  has to be the wall's own (a quarry, step 4), not storage that the civic yard (it claimed 552 at once in N2) and the
  cathedral also draw on.
- **Not measured yet (step 0):** the monument quarry's rate per member-hour; the relief along a ring (the footing's
  share); the water depth on the ring; the number of street crossings.

## 4. Steps

Each step can be built and checked alone; 1 and 2 need nothing of 3-7.

### Step 0. Measure (no flag; an offline check and two live probes on world 3)

- `scripts/checks/wall_measure.mts` on checkpoints with a planned ring (w203_n9 and the train checkpoints): ring length,
  water cells and their depth (region files via `region_blocks.py`), ground relief under each cell (footing blocks),
  street and pad-path crossings, the stone bill of every stage of step 3 for that ring.
- The supply: storage's stone by 10-minute bin from the deposit lines and the mine and quarry trip lines of any run
  (this spec's numbers, as a script beside run_report). The quarry's yield a member-hour from a monument run.
- Live probes (world 3, `/api/agents/:name/act`, lesson 99): (a) a spider and a zombie against a 4-high stone wall with
  and without the outward lip; (b) a member walking a 2-wide walk with a parapet between two towers by the pathfinder,
  up and down a tower's stair; (c) where hostiles inside N11's ring came from: spawned inside on dark ground, or walked
  or swam in (an `entitySpawn` inside the ring against one first seen outside). (c) decides how much any wall can do
  against lit ground.

### Step 1. The ballot shows the wall truly (`MC_WALL_BALLOT`; ~120 lines)

Changes what the wall vote shows, never whether it is held or who decides:
- **Its own frame:** a `wall` vote topic with its own system line: the village votes on a defensive wall; it is built by
  members who take its chores, at most one in 6 at a time, from storage and its own supply trips; everyone else keeps to
  their work. The question: "The vote: a wall round the village".
- **The benefit in counts, honestly scoped:** from the danger count, the numbers a wall answers: hostiles within the ring
  line at night (peak and mean), members hit or killed within the village bounds + 16, and what the wall does ("keeps
  zombies and spiders out at night once closed; a walk to keep watch from"). Deaths on far trips are said as such and
  pointed at the curfew, not counted for the wall. Nothing is claimed that the wall's plan cannot do: while water gaps
  remain (step 2 off), the facts say "open where it crosses water".
- **The stage, not the whole:** the options are the next stage with its own bill (step 4's order: "Close the river
  crossings and raise watchtowers at the gates: ~N stone", or "A stone wall with towers, built section by section: ~N
  stone, about one stage an hour"), the fence ring when no stone stage is ready, and "No wall for now" reworded neutrally:
  "members keep to their other work; nights rely on the curfew, lamps and the watch; asked again after another death".
- **Who asks:** the trigger stays code's (the danger count), but the vote opens as a member's proposal when one exists:
  the member with the most watch nights or the last one hurt near home "proposes a wall" (the proposal record, shown on
  the ballot as "proposed by Iris, who kept watch two nights"). A member proposal for a wall or defence (the outlet's
  proposals) opens the vote at once if the danger trigger has fired.
- **Files:** `vote.ts` (topic `wall`: SYSTEM_OF, QUESTION), `mcWorld.ts` (wallVoteTick's options and facts), `mcCombat.ts`
  (counts near home for the facts: dangerTick already bins deaths by distance).
- **Checks (offline, before any live run):** rebuild the 300 recorded wall ballots' contexts from the model-call
  records and replay them through the new ballot, 3 samples each (`MC_MODEL_REPLAY` cannot: the prompt changes; a small
  bench like choicebench over the recorded contexts, lesson 85). Read the reasons, not only the count. A **control**: the
  same contexts with no danger (0 hostiles, 0 deaths) must still vote mostly no; if the new ballot passes the wall with
  no danger, it is pushing, not informing, and goes back.
- **Pass:** reasons that name the wall's effect or cost in members' time replace "I prefer my tasks" in most ballots;
  the control stays refused. No pass mark on the vote's outcome itself (the user's 11-04 ruling).

### Step 2. The fence ring closes over water (`MC_WALL_WATER`; ~80 lines; closes #203's last part)

- buildWall today turns water cells into gaps. With the flag: a water cell gets a stone column from the bed to one above
  the surface and the fence on it; on water deeper than 4 a sill and iron bars instead (iron from storage; when short,
  the column). Ring cells that are a river's whole width get a gate only if a street crosses.
- **Files:** `mcWalls.ts` (buildWall's column per cell, the bill), `walls.ts` (segBill with water cells).
- **Checks:** walls_check cases (water cells billed, no gap left); a staged build at minevale3 (`MC_WALLS_NOW`,
  `MC_VOTE=off` for the build test only); `[wall]`'s gaps 29 -> 0; hostiles inside at night against N11's 36.5 (with
  step 0 (c) saying how many were spawned inside).
- **Pass:** 0 water gaps; hostiles that entered (not spawned inside) at night under 1.

### Step 3. The castle wall's geometry, pure (`castleWall.ts`; ~350 lines; no flag: nothing calls it yet)

- From wallPlan's ordered ring: the curtain's two columns (outer, inner) along the ring, corners closed; towers at the
  corners and every ~40 cells (moved off streets and water); a gatehouse on each crossing; the water rule of step 2;
  per stage and per section (~24 cells, as SEG_LEN) the exact cells and bill (lesson 1: code draws every cell), any mine
  stone allowed for the bulk.
- Geometry from castleGen.ts's rules (parapet, merlons on alternate cells, slits every third cell, doors to the walk,
  timber floors); the rubble pattern from the dressing.
- **Checks:** `castle_wall_check.mts` (rings from walls_check's cases and two checkpoints): the walk is continuous from
  tower to tower and two wide; every tower has a stair from the ground; every crossing has a passage 3 wide and 3 high;
  no cell on a pad, a street or another village's work; bills match the cells. Prints step 0's table for each ring.

### Step 4. Building it in stages (`MC_CASTLE_WALL`; ~300 lines)

- **Order** (each stage a vote option in turn, step 1; the next stage is offered when the last is done and the danger
  trigger holds):
  1. the fence ring (today's) with step 2's water crossings: cheap, closes the ring;
  2. gatehouses and towers on the fence ring: the patrol's posts and shooting points, ~3,500-4,700 stone;
  3. the curtain in stone, a section at a time, replacing the fence of that section (the fence goes to storage);
     sections next to towers first, so the walk grows from the towers out.
- **Chores:** a section or a tower is a chore as a segment is today (rank 150 / 2x once voted and urgent, a37a58c; one
  builder per 6). Supply: "Quarry stone for the wall" (mcQuarry's pit, a wall pit sited outside the ring or in its
  ditch line, one member a row) beside the existing "Mine cobblestone for the village wall"; any mine stone counts.
  The wall's stone is held for it like the civic yard's claim, so the yard and the cathedral do not take the same stock
  twice.
- **Growth after the stone:** a stone section that ends up inside a grown village stays (an inner wall: real towns kept
  them) and gets a gatehouse where a new street crosses; the new neighbourhood gets the fence ring first, as regrowWall
  does today, and its stone later. Stone is never taken down.
- **Files:** `mcWalls.ts` (sections, towers, gatehouses as jobs; the fence-to-stone swap), `mcWorld.ts` (the menu, the
  stage's vote), `mcQuarry.ts` (a wall pit), `mcBuild.ts`/`monument.ts` keep-offs (wallTaken grows by the curtain's
  width and the towers).
- **Checks:** castle_wall_check; a staged build of stage 2 and of two curtain sections from checkpoint w203_n9
  (`MC_WALLS_NOW`, scripted workers, fast); `site.py`; `[stuck]` at gates against the fence ring's.
- **Pass (staged):** a stage's jobs finish with no stone shortfall the supply trips do not answer; no cell on others'
  work; the walk walkable end to end between finished towers.

### Step 5. The patrol on the walk (`MC_WALL_WATCH`; ~120 lines; closes #215 for walled villages)

- Once a tower pair and the walk between them stand, the watch chore (MC_GUARDS) walks the walk between towers instead of
  the lamps' loop, coming down by a tower stair to defend a member hurt inside the ring; with no walk yet, the watch
  keeps inside the ring line (#215's fix).
- **Files:** `mcCombat.ts` (watchSpots/watchLoop from the walk's cells), `mcWorld.ts` (the chore's facts: "walk the wall
  from the north tower to the gate").
- **Checks:** combat_unit cases (loop on the walk, inside the ring); a live staged night on world 3.
- **Pass:** no watch death outside the ring; the watchers' path stays on the walk; `[stuck]` on the walk under 1 an hour.

### Step 6. Bows and arrows (`MC_BOWS`; ~300 lines; the user's call first, Q1)

- **The chain:** bow = 3 string + 3 sticks (string from the hunt's spiders, MC_HUNT); arrows = flint + stick + feather,
  4 a craft (flint from gravel, 1 in 10 digs; feathers from the pens' chickens: killing a penned chicken is a passive-mob
  kill, Q2) and the arrows skeletons drop (already in HUNT_DROPS). The merchant sells arrows if the chain is short
  (fletcher trade).
- **Shooting:** the watcher on the walk with a bow and 8+ arrows shoots a hostile within 24 blocks in sight below the
  wall (outside, or inside the ring): draw ~1 s, aim by a pure ballistic function (gravity and drag of a full-charge
  arrow; `combat_unit.mts` cases), release; no shot if a member or a penned animal is within 2 blocks of the line.
  Arrows are picked up at dawn on a short walk outside the gate. Melee stays the reflex everywhere else.
- **Live first (lesson 99):** a probe on world 3: hits on a zombie at 10, 16 and 24 blocks from the walk; Paper's arrow
  pickup by a bot; the time a draw takes at `MC_TIME_SCALE` 1 and 2.
- **Files:** `mcCombat.ts` (shoot, the aim, the friendly-fire check), `mcMaterials.ts` (bow and arrow chains, flint from
  gravel, feathers), `mcWorld.ts` (make chores for bows and arrows when the watch has none).
- **Pass:** watchers kill hostiles at range from the walk with no member hit by an arrow; arrows kept up by the chain
  or the drops for a night of watch.

### Step 7. The look (no flag of its own: part of steps 3-4)

- Rubble masonry from the mine's stones by the dressing, a plinth course, stone-brick merlons when the kiln has made
  them, torches on the towers and in the gatehouse passage (the fence ring's torch every 8 moves to the inner face),
  banners or the village's flag on the gatehouses if the dyes exist. A screenshot of a finished stage for the user.

## 5. Testing (the train's, after steps 1-5)

1. Offline: typecheck, check:offline, walls_check, castle_wall_check, combat_unit, step 1's ballot replay and its control.
2. Staged pair on worlds 1 and 2 from w203_n9: hostile, `MC_WALLS_NOW`, `MC_VOTE=off` (build test only), steps 2-5 on
   against off, 25 scripted workers, 60 min after: stone placed, gaps, hostiles that entered at night, watch on the walk.
3. One model-driven pair (hostile, members' vote, 120 min after, as trains 20-21) with steps 1-5 on against off: the
   vote's outcome and its reasons in both arms. Whatever the vote decides is the result.

## 6. Open questions for the user

- **Q1. Bows.** The survival (d) decision was melee only at first, a bow ruling the user's for later; the request asks
  for members who fire arrows. Bows for watchers on the wall only, or for hunters too (bows kill creepers at range, so
  gunpowder would come in from the hunt rather than the merchant)?
- **Q2. Feathers.** Arrows need feathers, which come from killing chickens (passive mobs; the user's call, as leather
  is). Allow killing penned chickens for feathers, or arrows only from skeleton drops and the merchant?
- **Q3. How big.** The whole wall (~12,000-13,000 stone, ~4-5 hours of four members) or the lean curtain (~5,200 stone
  and a timber walk, ~2 hours)? Or towers and gatehouses on the fence ring only (~3,500-4,700), with stone curtain
  sections as later votes?
- **Q4. The ballot's changes** (step 1): a member named as the wall's proposer when the danger trigger fires (the
  watcher, or the last member hurt near home), and the stage-by-stage options. Both change what members see but not
  who decides; say if either goes too far toward steering the vote.
- **Q5. Iron bars on deep water** (iron from storage, the same iron the tools want) or stone dams only (the river is cut
  where the wall crosses it)?
