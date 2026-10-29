<!-- The committed copy of runs/2026-10-29/homedesign/spec.md (runs/ is gitignored). -->

# Spec: members design their own houses (MC_HOME_DESIGN; G2)

Draft 2, 2026-10-29, the homedesign session, on the planning session's brief (`runs/2026-10-29/planning/brief_homedesign.md`).
Spec only; no code. The adversarial check's points are folded in at the end ("Revisions after the adversarial check"),
which replaces the text above it where they differ.

## The behaviour wanted, and how it is judged

Today a member has no say in its own house. With `MC_GEN_HOMES` on (the default) `houseStyle.ts memberStyle` draws the
form (footprint, storeys, size, door, porch, chimney, shutters) from the member's character by code, the look (walls,
base, roof, frame, windows) from the neighbourhood's family with a seeded conformity draw, and the wood from the
neighbourhood. `fitHome` cuts it to the bill. The model only decides when to set the house up, furnish or decorate it, and
votes on the neighbourhood's style.

With `MC_HOME_DESIGN=model`, each member whose own house is about to be drawn makes **one model call**: it sees its own
character, the street's style, what its neighbours chose and a short form of the generator's options that code has
checked are buildable and payable here, each with its cost, and replies with its picks and a one-line reason. Code turns
the picks into a `BuildingStyle`, generates it, checks the bill and cuts it if needed (as today), and builds it as every
other house. The reason goes into the member's memory and onto the house's description. Any failure gives today's
character draw for that member.

**Why it serves the goals:** a house is the first thing a member owns that it shaped itself (G2: identity, and a
character that shows where it can act, lesson 172); the choices and reasons are memories later prompts can use (G1);
and a street of houses chosen in turn, each member seeing its neighbours', is a small place for imitation or distinction
to show (G4's cultural transmission).

**Judged by** (predictions in section 7, written before any build): spread of designs between members, whether choices
track character and neighbours (against code's draw as the reference), how often code had to cut a choice, build
failures and neighbourhood build time against the character draw, and whether members mention their house later.

## 1. Where the choice goes

### 1.1 The moment

Own houses are drawn in one place: `mcWorld.layOutNext` builds the owners-to-be (`homeless(v)`, the asker first) and the
family (the voted style's biome, else the village's current style), and calls `pickHouses(..., own)`, which calls
`ownHomes`. That call is synchronous and decides the pad (`padFor`/`padLadder` read the designs' sizes), so the design
must be fixed before it.

The model call therefore runs **ahead of the layout**, as a world-level call beside the brain (as ballots are: lesson 66,
"add behaviour beside the brain's state"), not as a chore:

- **Prefetch.** When a neighbourhood has been laid out, and at the start of the after phase, the world takes the next
  batch's owners-to-be (the first `GROW.batch` of `homeless(v)` not yet housed by the batch just laid out) and starts a
  design call for each one without a stored choice. The calls run in the owners' order, one at a time per village
  (`MC_HOME_DESIGN_PARALLEL`, default 1), so each member sees the choices made before it in its street.
- **Wait.** When `layOutNext` is reached and an owner of this batch has a call in flight, it returns and growTick tries
  again next tick, up to `MC_HOME_DESIGN_WAIT_MS` (default 90 s) from the first try; after that, the missing owners take
  the character draw (logged `[home] Ada: character (timeout)`). An owner with no call started (the batch changed: an
  asker moved to the front) gets one started then, under the same wait.
- **Stored, then fixed.** A choice is stored per member in the world (`homeChoices`, in memory, keyed by member) until
  the house is laid out; from then on it lives on the design (`style.chosen`, `style.reason`, below). A redraw of the
  same member's house (pickHouses called again after a failed layout: "drawn again, it replaces the one laid out
  before") reuses the stored choice and never calls again. A restart loses only unplaced choices, which are called again
  (cheap).

Why not a chore ("design your house" on the menu): it needs a menu option, its pacing and `choose.ts`, a busy file, and
the decision of *when* adds nothing here: the house is drawn when the street is laid out either way. A chore stays a
later option if the user wants a member to remodel (section 2.4).

### 1.2 Who chooses

Every member whose house is drawn by `ownHomes` (growth neighbourhoods with `MC_HOUSING` on and `MC_GEN_HOMES` on: both
defaults). Members housed in the first layout's vanilla houses do not choose (to be counted in the build: in a 25-member
village most members are housed by growth). The mayor chooses like any member when it is an owner-to-be.

### 1.3 What it chooses (the form)

The generator's options, each limited by code to what is buildable here. The **look** fields are relative to the street's
family ("the street's roof" / "the other roof"), so a choice made before a style vote is read in the family the street
finally has (code maps it; the prompt shows the concrete materials of the family known at call time).

| field | values (as the tool's enum) | limits code holds |
| --- | --- | --- |
| `size` | `small` 7x7, `deep` 7x9, `wide` 9x7, `large` 9x9 (today's sizes under `MC_BIG_HOUSES=both`; their own words with other settings) | V2_LIMITS box with overhang and porch; a value is offered only if a plain house of that size fits the budget |
| `shape` | `rect`, `L`, `T` | as memberStyle: an L or T sets the main block and wing by code (width 7 or 9, wing 3 or 5 wide); `wing_side` east or west (L only) |
| `storeys` | 1, 2 | 2 only within the ridge-span rule and 12 layers |
| `roof` | `street` (the family's), `other` (gable and hip swap; desert's other is hip in sandstone) | flat only in desert, as today |
| `walls` | `street`, `contrast` (planks to cobblestone, sandstone to planks) | as memberStyle's contrast |
| `base` | `street`, `cobblestone` | none where the family has none and the member picks `street` |
| `frame` | `street`, `timber` (walls 7+ only), `none` | timber offered only where the walls allow |
| `windows` | `rhythm`, `wide`, `single` | as today |
| `door` | `centre`, `left`, `right` | rect only (an L or T keeps the centre) |
| `porch`, `chimney`, `shutters` | true/false | as today's combinations (a wing in front with a porch drops the overhang: code applies the rule) |
| `larger` | true/false: ask for the street's one larger house | section 2.2 |

Wood is not offered: it follows the neighbourhood (R2) as for every house. Wall and accent materials beyond the family's
two choices are not offered in v1 (open question 1).

### 1.4 The facts each option carries

Code computes them from the real bill (`materialTasks(d).units` and smelts, the same function pickHouses passes) before
the call:

- **The base house:** the cheapest house in the family (small, rect, one storey, street look, no extras) and its units.
- **Each option's cost:** the units it adds to the base, alone (`two storeys: +70 units`). Costs do not add exactly; code
  checks the whole combination after the reply.
- **The budget:** the house budget (HOUSE_UNITS, 225 today) and, while the street's larger house is unclaimed, the larger
  budget (HOUSE_UNITS_LARGE, 345) with "one per street; Ada has asked for it" when claimed.
- **The stake, in the village's terms:** units are gathered by the village before the house goes up; the prompt says so
  in one line with the street's total so far ("the 3 houses chosen in this street come to 610 units; a plain house is
  120"). No invented minutes: units are what code knows exactly.
- An option value that does not fit even with every other field at its cheapest is left out of the enum (code's job:
  lesson 27, "designs need limits in code, not prompts").

## 2. What stays fixed

### 2.1 Code keeps the geometry, the bill and the fallback

- The picks become a `BuildingStyle` by a pure function beside `memberStyle` (`styleFromChoice(member, family, choice,
  wood?)`), which applies the same derived rules memberStyle applies (wing sizes, the porch/overhang rule, upper walls,
  wall height, roof material). The design comes from `generateDesign`, as today.
- `fitHome` checks it against the budget, V2_LIMITS and MAX_SMELTS. A choice over budget is **cut by code, not refused**
  (lesson 56): `fitHome`'s cuts in its order, the cut list on the description as today, and the memory line says what
  was cut ("you wanted two storeys; the bill allowed one").
- A reply missing a field or naming a value outside the enum: that field takes the character draw's value (logged, and
  counted as `partial` in the bench); no valid field at all, a timeout, a budget pause (`usage.allows('decisions')`), a
  withdrawn or failed call: the whole house is the character draw (`[home] Ada: character (why)`).
- The flag off (`character`, the default): no call, no new field on any design, `memberStyle` as today; the goldens and
  `gen_homes.mts` byte-identical.

### 2.2 The street's larger house

Today one house a neighbourhood may take HOUSE_UNITS_LARGE: the member wanting two storeys most, self-enhancement first.
With the model, the larger budget goes to **the first owner in the street's order who asks for it** (`larger: true`); the
asker of the street comes first in that order, as today. Members after the claim see "Ada has asked for it" and the
option is shown as taken (its enum value removed). A member who asks for it but whose picks fit the normal budget does
not hold it (code releases it to the next). Open question 3 asks whether wealth (coins under `MC_PAY`) should decide
instead.

### 2.3 How far from the voted style

As far as the character draw may go today and no further: each look field is the street's or the family's one
alternative (section 1.3), the wood is the neighbourhood's, and the family itself is the vote's. So a voted savanna street
stays acacia under hip roofs with a few gables; it never gets sandstone walls. Open question 1.

### 2.4 First build only

v1 chooses only when a house is first drawn. A **remodel** later (a refit of the member's own house, `refit.ts`'s
"cells that change only" path, as a chore when a member has the means) is open question 2 and would be its own spec.

### 2.5 Out of scope

- Decorations and basics stay code's (`mcHome.ts` basics, `houseDecor.ts` picks from taste, `MC_HOUSE_DECOR` off). A
  second call choosing decorations is open question 4.
- The first layout's houses, public works, landmarks, the architect's path, monuments.
- Styles drifting between neighbourhoods (G4) beyond what the neighbours line gives.

## 3. The prompt and tool

### 3.1 Prompt (one call a member; kind `home_design`)

System (about 120 tokens): "You are a member of a Minecraft village choosing the design of your own house, which the
village will build for you in your street. Choose as the person described would. The options are the ones the builders
can make here; costs are in units the village gathers. Call `design_house` once with a one-sentence reason and your
picks. Never invent an option."

User (about 700-900 tokens), in this order:
1. The persona and character lines the ballot uses (`voterContext(v, a).persona`, and `characterLines` where character v2
   is on): who the member is, its values, goal and likes, in words. Nothing of code's own draw.
2. One self line: the member's role, what it has done most (the ballot's `self`), and its coins when `MC_PAY` is on.
3. The street: its family in words ("plains: oak planks on a cobblestone base, gable roofs, log frames, glass panes"),
   its wood, and each house already chosen or standing in it with its owner and one line (`describeStyle`, plus "chosen
   because ..." for model-chosen ones, at most 120 chars each, at most 4).
4. The village at a glance in one line: "12 houses: 5 two-storey, 7 with porches, 3 L-shaped" (code's counts over own
   houses).
5. The budget and stake lines (section 1.4).
6. The form: each field with its values, each value with its cost against the base house, in the order of the table in
   1.3. The order of the values inside each field is shuffled per member (seeded) so a first-listed bias shows in the
   bench and does not steer every member alike (as the ballot shuffles its options).
7. "Call design_house with your reason and one value for each field."

Not shown in v1's default arm: code's character draw ("what your character suggests"). Showing it would anchor the reply
to today's house; the bench runs it as an arm to measure that anchor.

### 3.2 Tool

```json
{ "name": "design_house",
  "description": "Choose your house: a one-sentence reason first, then one value for each field.",
  "input_schema": { "type": "object",
    "properties": {
      "reason": { "type": "string", "maxLength": 200 },
      "size": { "enum": ["small", "deep", "wide", "large"] },
      "shape": { "enum": ["rect", "L", "T"] }, "wing_side": { "enum": ["east", "west"] },
      "storeys": { "enum": [1, 2] },
      "roof": { "enum": ["street", "other"] }, "walls": { "enum": ["street", "contrast"] },
      "base": { "enum": ["street", "cobblestone"] }, "frame": { "enum": ["street", "timber", "none"] },
      "windows": { "enum": ["rhythm", "wide", "single"] }, "door": { "enum": ["centre", "left", "right"] },
      "porch": { "type": "boolean" }, "chimney": { "type": "boolean" }, "shutters": { "type": "boolean" },
      "larger": { "type": "boolean" } },
    "required": ["reason", "size", "shape", "storeys", "roof", "walls", "porch", "chimney", "shutters"] } }
```

Enums carry only the values code offered (1.4). The parser normalises as other gpt-oss replies need (lesson 11): numbers
as strings, `"two"` for 2, booleans as `"yes"`, a field nested under `house`; a reply as plain JSON text instead of a
tool call is read too (the ballot's `parseChoice` path).

### 3.3 Where the code goes (for the build session)

- `server/src/homeDesign.ts` (new, world-free, as `vote.ts`): the prompt builder, the tool, `castDesign(req)` (one call,
  never throws, `call` injectable for checks and benches), the parser and normaliser.
- `server/src/houseStyle.ts`: `homeOptions(family, budget, bill)` (the enum values that fit and each one's cost),
  `styleFromChoice`, and `ownHomes` taking an optional `choices` map (a member with a choice gets `styleFromChoice`,
  the others `memberStyle`; the larger-house rule of 2.2 when choices are given).
- `server/src/buildingGen.ts`: `BuildingStyle` gains optional `chosen?: 'model'` and `reason?: string` (riding on the
  design like `owner` and `family`; generateDesign ignores them).
- `server/src/grow.ts`: `pickHouses`' `own` gains `choices` (a few lines).
- `server/src/mineflayer/mcWorld.ts`: the prefetch and wait (1.1), the `homeChoices` map, the memory line, `[home]` log
  lines. A busy file: one writer at a time (STRATEGY).
- `server/src/settings.ts` and `docs/SETTINGS.md`: `MC_HOME_DESIGN` (model|character, default character),
  `MC_HOME_DESIGN_WAIT_MS` (90000), `MC_HOME_DESIGN_PARALLEL` (1), `MC_HOME_DESIGN_HOLDOUT` (0: the share of members,
  by a seeded hash of the name, kept on the character draw while the flag is model, for the train's split).
- `server/src/modelUsage.ts`: the call kind's reasoning level (`MC_REASONING` gains `home`, default `low`).
- The panel: the member's house line shows "chosen: <reason>" or "drawn from character".
- `scripts/checks/home_design.mts` (new, offline), `scripts/bench/homebench.mts` (new), `scripts/check_offline.py`.

### 3.4 The memory line

On placement (the house laid out with the member as its owner), one note through `applyWrites(village, member,
{ remember: ... }, 'decision')`: "I chose my house: a two-storey oak house with a porch and a chimney, because <reason>"
(plus "the builders cut: one storey" when cut). The house's description carries the reason after its words. The note
uses the ordinary G1 path, so `MC_MEMORY` decides whether it is recalled; the description is shown wherever descriptions
are (the panel, house signs do not change).

## 4. Cost

- **Tokens a call:** prompt about 1,000-1,300 tokens (system 120, user 700-900, tool schema about 250); output about
  300-700 at reasoning `low` (gpt-oss reasons anyway: lesson on `think:false`). Say 1,200 in and 500 out.
- **A call:** 1,200 x $0.15/M + 500 x $0.60/M = $0.00018 + $0.00030 = **about $0.0005**.
- **A village:** 24 own houses = 24 calls, plus about 20% for timeouts and retries: **about $0.015 and 50k tokens**,
  2.5% of the hourly cloud budget (`MC_TOKEN_BUDGET_HOUR` 2,000,000), spread over the hour or two growth takes. Against
  hour 1 of a live model-driven run ($0.17) it is under a tenth.
- **Latency:** one call at a time per village, 5-20 s each on gpt-oss cloud; prefetch puts it in the time the previous
  street takes to build (several minutes), so layout should rarely wait. The wait's cap bounds the worst case at 90 s a
  street.
- **Concurrency:** priority class `ballot` (2 of the 3 cloud slots at most), so it never starves the executors; a
  budget pause gives the character draw.
- **The bench:** 25 members x 3 samples x 3 families x 3 arms = 675 calls, about $0.35.

## 5. The bench (`scripts/bench/homebench.mts`)

Modelled on `ballotbench.mts`: a real `MineflayerWorld` loaded on a copy of a checkpoint's `villages.json` (no bots), so
families, wood, budgets, costs and neighbours are a run's own; the real prompt through `castDesign` and the real
`callModel`. Checkpoint: a completed staged village with one growth street built (a train 7-9 checkpoint; the build
session names it), and a synthetic "empty street" case.

- **Cases:** the 25 names (Mayor + Ada...Xavier) as owners, in streets of 4 in their order, each later owner seeing the
  earlier ones' choices (as live); families plains, savanna, desert (desert has the tightest budget: R3 cut 15 of 24).
- **Arms:** `form` (the default prompt), `form+suggest` (code's draw shown as "what your character suggests"), and
  `nostake` (no stake and street-total lines; for the rubber-stamp risk, lesson 174).
- **Env:** MODEL, THINK (`low` and `medium` compared once), N (samples, default 3), FAMILIES, ARMS, PEEK=1 (each raw tool
  call and reason: read them before judging, CLAUDE.md), DRY=1.
- **Measures**, each per arm: valid share (all required fields valid after normalising), partial share, over-budget
  share before cuts and the cuts' kinds; distinct designs among 24 (by layers and palette, as `gen_homes.mts` counts)
  and per-field spread (entropy) against the character draw's; **the max-out share** (two storeys and all three extras
  and `large`); agreement with the character draw per field against chance; the conformity test (`gen_homes.mts`'s:
  the 5 most conservation-dominant members' look picks vs the 5 most open); the neighbour effect (agreement of a member's
  shape and storeys with the earlier houses of its street, against the same member in the empty-street case);
  consistency across samples; first-listed value share against chance; latency and tokens. JSON to
  `runs/<date>/bench/homebench-<ts>.json`.

## 6. The test

### 6.1 Offline (the build session)

- `npm run typecheck`, `npm run check:offline` (the goldens and `gen_homes.mts` byte-identical with the flag off).
- `scripts/checks/home_design.mts` (new; flag `model` in its own process, the call injected):
  - `homeOptions` for the 25 members in the five families: every offered value fits the budget with the others at their
    cheapest; no value offered that cannot;
  - canned replies: a valid one gives the expected style; out-of-enum and missing fields take the character's values; an
    over-budget one is cut in fitHome's order and the memory line names the cuts; a thrown call, a timeout and a budget
    pause give the character draw; two members asking for `larger` give it to the first and the normal budget to the
    second; a reply as text JSON is read;
  - every model-shaped home passes `gen_homes.mts`' rules (validateDesign, box, layers, budget, easy materials, name
    rules: `isDwelling`, not `isLandmark`, `homeOwner`);
  - the holdout splits 25 members about half and half at 0.5, by name, stably.
- `homebench.mts` (section 5), read with PEEK=1.

### 6.2 The staged check (one, short; the build session or the train)

A staged run from a completed checkpoint with growth on: `run_series` spec with `MC_HOME_DESIGN=model` and
`--after-until grow`, scripted workers (the house call is a world-level call: it calls gpt-oss even with taskBrain
workers, as `MC_VOTE=model` does; about $0.015). It checks: a `[home] X: model` line for each owner, calls before each
layout and no layout waiting past the cap, the designs carrying `chosen`/`reason`, each house given to its own owner
(homeTick's binding by `style.owner`), houses built with no more `[stuck]`/`[dig]`/build failures than a character run
from the same checkpoint, the memory note written once a member.

### 6.3 The test train's arms

Per-member feature, so split inside one run (STRATEGY's rule): `MC_HOME_DESIGN=model` with
`MC_HOME_DESIGN_HOLDOUT=0.5` on the train's model-driven run, half the members designing and half on the character draw,
in the same streets. A second, village-wide pair only if the split shows a difference in build time worth confirming
(on: model for everyone; off: character), from the same checkpoint on both test worlds.

## 7. Predictions (written before any build or bench)

Bench (form arm, plains, gpt-oss low):
1. **Valid** at least 95% after normalising; partial under 10%.
2. **Max-out:** without the stake lines (`nostake`), 50% or more of members pick two storeys and all three extras (gpt-oss
   says yes when nothing is at stake, F299). With the stake lines (`form`), under 25%.
3. **Over budget before cuts:** under 15% in `form`.
4. **Spread:** at least 20 distinct designs of 24 (the character draw gives about the same: F-number in R3's
   gen_homes), and per-field entropy above the character draw's for storeys and extras (code's draw is near
   all-or-nothing by goal).
5. **Tracks character:** per-field agreement with the character draw 50-65% against about 40% by chance; the 5 most
   conservation-dominant members pick the street's look in at least 70% of look fields, the 5 most open in at most 45%.
6. **Neighbours:** a member's shape and storeys agree with its street's earlier houses more often than in the
   empty-street case (by at least 10 points), with reasons naming a neighbour in at least a fifth of later owners.
7. **Anchor:** `form+suggest` agrees with the character draw 80% or more (the reason not to show it).
8. **Latency** median under 15 s; tokens as section 4 within a factor of 1.5.

Live (the train's split run, 2 h):
9. **No new failures:** model-designed houses fail to build no more often than character houses (both 0-1 in a run);
   no layout waits past the cap.
10. **Build time:** model-designed houses are 10-25% dearer in units on average, so a street with model houses takes
    10-25% longer to finish; busy and the health check unchanged.
11. **Memory:** at least 5 of the 12 designing members mention their own house in a later journal note, talk line or
    reason within the run (lesson 172: character shows in talk first).

## 8. Open questions for the user (through the planning session)

1. **Straying from the voted style:** v1 keeps each look field to the street's or the family's one alternative (as the
   character draw does today). May a member go further (another family's walls or roof, stone bricks within the smelt
   cap, a different wood from the street's)? More freedom, less of a street look.
2. **Remodel:** first build only in v1. Should a member later be able to remodel its house (a refit chore: add a storey,
   a porch, change the roof), paid by the village or by its own coins?
3. **The street's larger house:** first owner who asks for it, in the street's order (the asker first), in v1. Or
   should a richer member (coins under `MC_PAY`) get it, or a bigger budget generally (wealth buys a bigger house)?
4. **Decorations:** stay code's (taste-driven) in v1. Should a second call let the member choose its decorations and
   furnishings too, when `MC_HOUSE_DECOR` is on?
5. **The default later:** once the train passes, should `model` become the default (about $0.015 a village), with
   `character` for staged runs?

## Revisions after the adversarial check (draft 2, 2026-10-29)

The check was a read-only subagent's, against the code (it also ran `gen_homes.mts` under `MC_BIG_HOUSES=both`). Its 14
points are all taken; these revisions replace the text above where they differ. The two timing claims were re-read
and hold (mcWorld.ts `growDue`, `styleFor`, `homeLayout`).

**R1. The moment (High 1, 2).** Since N.2 a street exists only after a request (`growDue` returns false without
`g.request`, mcWorld.ts:2312): a member's menu "grow" (the asker first) or a works vote. The style vote opens only then,
in `styleFor`, and `g.next` is cleared once each layout is posted. So the prefetch of 1.1 would guess the wrong batch and
the wrong family, and prefetch at completion is worse (homeTick first moves homeless members into the first layout's
unowned houses). **Replaced:** the design calls start when the street's style is settled (`g.next` set, or no vote
held), for the batch as `layOutNext` will form it (asker first). `styleFor` returns `undefined` while that street's
design calls are in flight, exactly as it does for a vote under way, so both callers (growTick and the menu's
`homeLayout`) already wait correctly; `layOutNext` never returns early, and a member's chosen "lay out houses" keeps its
meta and holds as it does during a vote. The wait's state (calls, started-at) is per village, beside `this.voting`.
The relative look fields stay (they are the simplest enum), but nothing is mapped across families: the family is known
before the call.

**R2. The wait (High 3).** The `ballot` class is low priority with a gate wait up to 120 s (modelCall.ts:191-193), so a
fixed 90 s cap with four serial calls would often run out in a busy run. **Replaced:** `MC_HOME_DESIGN_WAIT_MS` default
240 s (a vote's own 4 minutes), each call given `maxWaitMs` equal to the time left; `MC_HOME_DESIGN_PARALLEL` default 2,
each member seeing the choices completed when its call is built (the first two of a street see none of its own; they
still see the village's). The cap is reset from measured gate waits (`[models]` lines) after the first live run.

**R3. A stake the member owns (High 4, lesson 174).** The village gathers the units, so the street total of 1.4 is
someone else's cost and invites a yes to everything. **Replaced** by two stakes code can compute, both the member's own:
- **Its own wait:** "your house goes up after the units ahead of it; as chosen, you move in after about N units of the
  street's gathering, a plain house after M" (the street's Build tasks in board order, own house last among its own).
- **Its neighbour:** when a choice's footprint would make `padFor` fit fewer houses on the street's pad (grow.ts:199),
  the option says so and names who would wait for the next street ("Ben would wait for the next street").
Coins under `MC_PAY` stay open question 3.

**R4. The member's priorities decide the cuts (High 5, Low 12).** fitHome's fixed order (storey, wing, size) would cut
the feature a member cares about most; desert already cuts 13 of 24. **Added:** the tool's `priority` field, an ordered
list of the optional features the member picked (`storeys`, `shape`, `size`, `porch`, `chimney`, `shutters`, `larger`,
`look`), most wanted first. Code cuts in reverse priority (each feature's own cut step from fitHome), then fitHome's
remaining steps; the memory line names what was cut. A yes to everything is then harmless: it ranks the features and
code keeps the top ones the budget allows. The extras are still listed with their costs; prediction 2 now measures the
ranked-and-cut result, not the raw picks.

**R5. Size against shape (Medium 6).** In memberStyle an L or T sets width 7 or 9 and depth 5 before `growWalls`, so
under `MC_BIG_HOUSES=both` it is 9 or 11 by 7; a rect house with a porch is forced to depth 7. **Replaced:** the form
offers `size` only for rect houses ("rect only; an L or T has its own sizes: L 9x7 or 11x7 with a wing"), and L/T have
their own two sizes (`compact`, `long`) with their costs. `wall_height` (4 for X ≥ 0.5) stays code's.

**R6. The larger house (Medium 7).** Decided at reply time: code runs fitHome on each reply before the next call is
built; the claim holds only if the house needs the larger budget, else it is released then, before anyone saw it taken.
A stored choice whose house was not laid out (`pad.n` cut the batch) has its claim re-checked in its next street. In
effect the asker, first in line, gets the larger house whenever it wants it; open question 3 says so. Flag off and the
holdout keep today's rule (the two-storey member with the most self-enhancement, even when its house fits 225).

**R7. How long a choice lives (Medium 8).** A choice is kept until homeTick binds a Build task to its owner (the
`bound` map, mcWorld.ts:2754-2760), not until layout: a member cut from the batch by `pad.n` keeps its choice for the
next street, and a house laid out for a member housed meanwhile goes in queue order as today, its choice dropped with a
log line. The memory note is written at binding.

**R8. The memory note (Medium 9).** `MC_MEMORY` is off by default, so prediction 11 needs `MC_MEMORY=on` in the train's
run (open question 6). The note is kept under 140 characters (`NOTE_CHARS`), e.g. "I chose my house: two storeys and
a porch, to host my neighbours" (cuts as "(built with one storey)"), and is written with a new `by: 'world'` that does not
count toward `NOTES_PER_DAY` and evicts nothing it would not evict for a decision note (the build session checks
`applyWrites`' eviction rule). The full reason lives on the design's description.

**R9. Plumbing (Medium 10, Low 13).** One name: call kind and reasoning key `home`, added to `CALL_KINDS` and
`DEFAULT_REASONING` (modelUsage.ts:31,38; `MC_REASONING` default gains `home=low`). The persona comes from
`voterContext` only (there is no `characterLines` helper of that name in reach; the build session reuses whatever the
ballot uses). The bill: fitHome gets `{ units, smelts }` from the world (pickHouses passes only `units` today,
grow.ts:76; with model choices it passes both, so stone picks are smelt-checked). The option costs (about 30
`materialTasks` calls a member) are computed once per family and street and cached, not per member. Cobblestone's
mining is in the units already; the facts say "cobblestone (mined)".

**R10. A test that can show it matters (Medium 11).**
- Prediction 4 (distinct designs) is dropped: the character draw already gives 24/24 in four families and 22/24 in
  desert, so it cannot show a difference. Spread is judged by per-field entropy only.
- Agreement with code's draw is no evidence that choices follow character (the draw is an arbitrary mapping). The bench
  adds a **persona-shuffled arm** (each member given another member's persona) and tests value-to-feature
  associations against it: enhancement with storeys and `larger`, conservation with the street look, openness with L/T
  and contrast, agreeableness with porches. Prediction 5 becomes: at least three of these four associations hold in the
  real arm (rank correlation 0.3 or more) and vanish (under 0.15) in the shuffled arm.
- With the 0.5 holdout streets are mixed and finish together, so prediction 10 is measured per house (units, and each
  Build task's start-to-done time), not per street.
- The house count: the build session counts the own houses train 9's 2-hour run laid out and sets prediction 11's
  denominator from it ("at least 40% of designing members whose house was built mention it"), not a guessed 12.

**R11. Flag off (Low 14).** Confirmed safe by the check (optional fields, `generateDesign` keeps the style as given,
`woodVariant` keeps it). The build session also confirms that `board_golden` and `choice_golden` print nothing from the
usage or reasoning lists that the new `home` kind would change.

**R12. Open questions added** (section 8 gains):
6. **Memory on for the test:** run the train's split run with `MC_MEMORY=on`, so the reasons can be recalled
   (prediction 11)?
7. **Whose priorities cut:** the member's own ranking decides what is cut (R4), not fitHome's fixed order. Agreed?
Open question 3 now reads: in v1 the asker in effect gets the larger house whenever it wants one (first in line, R6);
should wealth (coins under `MC_PAY`) or a street ballot decide instead, or should every member's budget grow with its
coins? The real stake (R3: its own wait and its neighbour's) is v1's; coins as a stake is part of the same question.

**Cost after the revisions:** the prompt gains the stake lines and the priority field (about +150 tokens), so about
1,350 in and 550 out a call: about $0.0005 a call, **about $0.015-0.02 a village** of 24 own houses. The bench gains
the shuffled arm: 25 x 3 samples x 3 families x 4 arms = 900 calls, about $0.45.
