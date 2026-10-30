# Test train 12 (10-30 10:46-12:48): the new house-program prompt, the merchant off: report

## Setup

**Code:** 2d8d9bd (#8 MC_MORE_MINES, #176's fish fix), run at HEAD b8c78dd (docs only since then). No source edits.

**A first start was stopped.** It began at 08:47 at 8dd1257 from t3_p1b. The planning session stopped it at about +5 min,
at the user's request, to restart on a rebuilt checkpoint. Its partial output is in `aborted/`.

**The checkpoint, t12_pad_open.** It is t3_p1b rebuilt at 2d8d9bd:
- t3_p1b's own build spec on world 4, staged, fast, `MC_GROW=0` (`build_pad.json`, `build/`);
- complete at 1.8 min, 102 tasks, [stuck] 0;
- **the storage hut is open-sided:** read from the saved region files, it has posts only at y65-66 (t3_p1b has full walls);
- **the mine reaches stone:**
  - stairs of 9 steps to y57, against t3_p1b's 7 to y59;
  - 7 tunnel cells dug at the save, against 0;
  - `scripts/checks/mine.py` with 3 bots and 2 rounds passed: 93 cells and 184 cobblestone, nothing changed outside the
    plan.

**The two arms.** Two worlds at once, 25 members, model-driven, 1x, `--after 120`, both run to the end. Each arm has
train 11's settings (`make_specs.py`) plus:
- `MC_MERCHANT=off` (the brief's one change);
- `MC_MORE_MINES=on` (the planning session's addition).

| arm | world | house design |
|---|---|---|
| **P** | 4 | `MC_HOME_DESIGN=program`, with qwen3.8 on the pinned server (all of it in VRAM) |
| **M** | 5 | `MC_HOME_DESIGN=model` |

Every setting name is in `docs/SETTINGS.md`. The runner warned "MC_MERCHANT_ORDERS is on but MC_MERCHANT, which it needs,
is off".

**Logs and records.** Model calls ran from the first minute, 1,591 and 1,592 in all.
- Agent logs: `runs/2026-10-30/testagents-w4-104635.log` (P) and `-w5-104636.log` (M).
- Scripts and outputs here: `houses.py` (`houses.txt`), `supply.py` (`supply.txt`), `run_report.txt`, `rules_P.txt`,
  `rules_M.txt`, `read_built.py` (`renders/`).

## Two things went wrong, and they shape the rest

**1. M's growth stalled because of a bug: #177, task ids collided after the checkpoint restore.**
- **The cause:**
  - `reset_site.py` keeps the live world's `nextId`, and checkpoints save none.
  - World 5's counter was 16013, while t12_pad_open's tasks run to t16234. World 4's was 16243.
  - M's third growth layout (outward 2 by the Mayor, at about +10 min) got task ids already in use: 48 duplicates by the
    end.
  - `layOutOutward` finds its new tasks by an id-set difference, so it dropped the colliding ones. `growth.active.from`
    became 16203.
  - The pads and builds below 16203 were never growth tasks to the members, so no one took them for 110 minutes.
- **The effect:**
  - Houses went 2 -> 7 in M, against 2 -> 25 by about +47 min in P.
  - Hugo's house failed on an unprepared pad.
  - Idle members took monument work instead: 338 picks in M against 111 in P.
- **So M is not a fair arm for houses or busy.** Only 2 model-picked houses were built.
- Earlier trains that restored a checkpoint onto a world with a lower `nextId` may have the same fault. Check them for
  duplicate task ids.

**2. With the merchant off, the village cannot fish, and food fell to bread: #178.**
- There was no rod and no string anywhere: not in the checkpoint, not in storage, not in any member's own chest. A
  peaceful world has no spiders.
- `lib:fish` was offered on 0 menus in either arm, and no `[fish]` line was written. So the own rod got no test for the
  third train running, and #176's fix could not show.
- Food came from wheat alone (FOOD line, per F340's correction):

| | P | M | train 11 |
|---|---|---|---|
| wheat made | 115 | 155 | 127 / 175 |
| bread | 30 | 43 | |
| cooked cod | 0 | 0 | 105 / 64 |
| hungry share of member-time | 48% | 33% | 0% |
| members who never ate | 8 | 6 | |

- **P went hungry at once:** peckish from +30 min, and 23 of 25 hungry by +55.
- **Busy by 10 min fell with it:**

| | first hour | second hour |
|---|---|---|
| P | 81, 85, 84, 95, 89, 60% | 11, 17, 18, 30, 15, 27% |
| M | 88, 69, 65, 73, 61, 60% | 24, 24, 21, 38, 33, 35% |
| trains 10-11, second hour | | 35-80% |

- P made 1,048 choices in the first hour and 289 in the second. The second hour's busy figures measure hunger, not the
  mine.

## Houses (P against train 11's P; M's 2 picks only)

| | P train 12 | P train 11 | character in P | M model picks |
|---|---|---|---|---|
| houses built | 12 | 12 | 10 | 2 |
| two storeys | **5 of 12** | 0 of 12 | 2 of 10 | 2 of 2 |
| distinct forms | **7 of 12** | 6 of 12 one form | 9 of 10 | 2 of 2 |
| houses in the commonest form | 3 ("7x7 two-storey, hip roof, porch, shutters") | 6 | | |
| mean blocks | **242** | 175 | 289 | 445 |
| build minutes (median) | 1.2 | 1.1 | 1.2 | 1.3 |
| cut to fit | 4 (3 "no overhang, shallower wing", 1 "cobblestone for stone, one storey") | | | |
| fallbacks / failed builds | 0 / 0 | 0 / 0 | 0 / 0 | |
| program time | 2.9-6.5 s | 2.5-8.7 s | | |

- **The prompt fix worked.**
  - Two storeys rose from 0 to 5 of 12 (the bench had 35%).
  - Mean blocks rose 38% (175 -> 242).
  - The commonest form went from 6 houses to 3.
- **Every program house is a 7x7 planks box.** The variety is in the storeys, the roof (hip or gable), a front wing and a
  porch, not in the footprint or the material.
- **Per street, distinct descriptions:** 4/4, 3/4, 4/4, 4/4, 4/4, 2/2.
- **P built houses at about the old pace:** 24 by +47 min, against 25 by +41 in train 11.
- **Forms partly track character.** Clara wrote "a sturdy, orderly two-storey ... home with a covered porch" and got a
  two-storey gable house. Iris wrote "a modest, open workshop-home" and got one storey with a front wing.
- **Renders as built** (`renders/`):
  - Clara: 457 blocks, gable, a two-storey porch side;
  - Iris: 283 blocks, a cut wing;
  - Xavier: 439 blocks.
  The doors, ladders and stairs match their designs; the counts show one extra door and fence, as in train 11's renders.

## The rest

- **Mines:**
  - The rebuilt mine worked: 41 / 66 trips, 990 / 1,299 cobblestone from trips (train 11 had 0 trips).
  - `MC_MORE_MINES` never triggered, as expected with a working mine.
  - The top failure is `dig_iron`'s "three miners are on the iron level" (17 / 66).
- **Flowers and dyes:** flower trips 3 / 2 and lilac deposited, with magenta dye made in both (M kept 2 in storage).
  `lib:amethyst` was offered 42 / 3 times.
- **Laws:**
  - P passed 30 laws (67% typed) and M 27 (26% typed).
  - Rules passed: P 6, M 4. Compliance: P rl3 15%, rl5 70%; M rl3 88%.
- **What the merchant's absence changed beyond the rods:** no purchases, no sales, no merchant orders. The rod and string
  supply is the change that mattered. Leather was not measured.
- **Run totals:**

| | P | M |
|---|---|---|
| busy overall | 51% | 49% |
| failed tasks after | 132 | 168 |
| [lag] | 0 | 0 |
| [stuck] | 34 | 50 |
| tokens | 4.04M / 0.39M | 4.26M / 0.42M |
| cost | $0.84 | $0.89 |

## Verdict

- **House programs with the new prompt work live.** They build bigger and more varied houses than train 11's (5 of 12
  two-storey, 7 forms, +38% blocks), at the same build time and with no failures. They are still all 7x7 planks.
- **The comparison with model picks did not happen.** M's growth was stopped by #177.
- **The own rod is still untested.** With the merchant off there is no rod to own (#178).
- **The working mine's effect on second-hour busy is hidden by hunger.**
- **For a rerun:** fix #177, then give the village a rod source or a rod per own chest (#178). That keeps cod in the food
  supply and tests the own rod.
