# Spec: the start screen (profiles, the run's goals, start) (Support, after #115 and #137)

The user's design (10-30): a screen opened before a run, where a **game profile** (switches and settings) is loaded,
edited, saved or deleted, the run's **goals** are typed (for the village, per member, or drawn by code as today), and
the run is **started**; afterwards the screen links to the run's panel, and a past run's `profile.json` loads back in
("run again"). The goals amend today's life goals (#79, `goals.ts`); they do not add a second goal. Spec only; written
by a work session for the planning session. **Section 12 (draft 2) folds in the adversarial check and overrides
sections 1-11 where they differ** (notably: no `kinds` or `records` levers in v1, the launcher local by default, no
main world in v1, takes opt-in).

## 0. What exists (read before building)

- **The settings registry** (`server/src/settings.ts`, f88ccb5): 253 entries `{name, type, default, group, live,
  values?, requires?, notIn?, read, describe}` in 11 groups (speed, models, choices, building, economy, social,
  character, ladder, needs, server, debug); `valueFault()` checks a value; `setSetting()` changes a live one;
  `settingsNow()` and `GET/POST /api/settings` serve the panel's **Run › Settings** tab. Only 6 settings are live.
- **Profiles** (`profiles/*.json`, own ones in `profiles/local/`, gitignored; `server/src/profiles.ts`,
  `scripts/profile.mts list|check|effective`): `{name, describe, kind: staged|model|checkpoint, site, preset, workers,
  fast, time_scale, objective, minutes, after, args, checks, settings, schedule, archetypes}`; `checkProfile()` gives
  errors (unknown names, types, `requires`) and warnings (acceptance rules), `estimateCost()` an hourly cloud cost from
  recent runs' STOPPED lines. Ten profiles today (acceptance, all-features, drawn, mono-*, mixed-40-60, overnight-cheap,
  staged-fast).
- **Run series take a profile** (`run_series.py`: `"profile": NAME`, its keys under the spec's; `sweep`); each run
  writes `NAME.profile.json` (resolved settings, commit, world, assignment of archetypes).
- **Run control** (`scripts/runctl.py`, ec0a1ff): `status`, `start PROFILE --world N` (a one-run series, detached;
  refused while that world's agent server has agents), `pause|resume|stop N`, and `serve [--port 8780]` with
  `GET /status`, `POST /start|/pause|/resume|/stop`, bound to 127.0.0.1, CORS open; state in `runs/runctl.json`.
  Live-checked (LC1, world 4).
- **Character mix** (`MC_CHARACTER_MIX`, `MC_CHARACTER_SEED`, `MC_CHARACTER_ARCHETYPES`; `archetypes.ts`): five
  built-in archetypes, each with traits, values and a goal; custom ones in a profile.
- **Life goals** (`goals.ts`, `MC_GOALS`, **default off**; the trains' profiles turn it on): six goals (wealth,
  invention, mastery, standing, home, beauty), drawn per member by code when the village is complete
  (`ensureGoals`, `drawGoals`), wealth only with `MC_OWN`, invention only with `MC_INNOVATE` (`goalsInPlay`). With
  `MC_VALUES` (character v2) `mcWorld.goalsFor()` **overrides** the draw on every call with `goalFromValues()`, and an
  archetype gives its own goal. The goal reaches the model in three ways: the line `Your life goal: X (progress).`
  (+ `GOAL_MEANING` with `MC_PROMPT_SELF`) in the choice prompt (mcWorld.ts ~9240), `[toward your goal]` on options that
  `serves()` (weight `gw` = 1.6..2 by `goalScore`, exempt from rank decay), and `identityLine()` (character v2). It also
  seeds pursuit candidates (`pursuits.ts` `GOAL_TEMPLATES`), wishes (`wanted.ts` #89) and the house draw
  (`homeDesign.ts`). The line and weights apply only once `v.complete`.
- **Pursuits, esteem, titles** (fa1bfcc, all on): a pursuit is the life goal made concrete (`pmw` replaces `gw`);
  unmatched own pursuits go to `proposals.json` for the **triage only, never foundry tickets** (41626d8). Titles are
  records per template (`esteem.ts` `RECORD`: master of, lamplighter, explorer, richest trader...).
- **The ambition vote** (`vote.ts` topic `rung`, `ladder.ts`): every member votes the next rung with its persona
  (`voterContext`: `memory.persona` or `personaOf`).
- **Memory**: notes evict; G5's proposal answers are **pinned** (memory.ts `noteAnswer`, last 3, never evicted).

What is missing: a screen, an always-on server for it (runctl serve exists but nobody keeps it up, and it binds
127.0.0.1 only), the registry readable without an agent server, goals typed by the user, and a lock per world that
every starter respects.

## 1. The screen

One static page, `server/startscreen/index.html` (no build step, same style and helpers as `server/panel/index.html`),
served by the launcher (section 3). Four panes on one page, top to bottom, the Start button always visible:

```
┌ MCAISandbox · start a run ──────────────────────────── worlds: 1 free · 2 free · 4 BUSY (train13) · 5 BUSY ┐
│ Profile [ acceptance        ▾]  [Save] [Save as…] [Delete] [Load a past run…]    ● 3 unsaved changes       │
├ 1. Where ───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ World  (•) test 1   ( ) test 2   ( ) test 4 busy   ( ) test 5 busy   ( ) main (fresh land only)            │
│ Start  (•) fresh site [minevale3 ▾]   ( ) checkpoint [t12_pad_open ▾ saved 10-30, 25 members, complete]   │
│ Kind   (•) model-driven  ( ) staged (scripted workers)      Minutes [120]  after completion [60]            │
│ Members [24] + Mayor   Ada Ben Cal … Xavier                Objective [Build a small village: …          ]  │
│ Character mix  wealth [40]% invention [60]% community [ ]% tradition [ ]% beauty [ ]% drawn [ ]%  seed [1] │
├ 2. Goals ───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ (•) Let the code choose (today's draw)  ( ) One goal for the village  ( ) A goal per member                │
│ Village goal [ explore the far lands and get rich                                    ] [Draft takes]       │
│ ┌ member ┬ character        ┬ goal (editable)                               ┬ levers found      ┬ ⚠ ┐      │
│ │ Mayor  │ invention        │ explore the far lands and get rich (as given) │ explore, wealth   │   │      │
│ │ Ada    │ wealth, careful  │ grow rich trading what the far lands yield    │ wealth, explore   │   │      │
│ │ Ben    │ invention        │ map the far rings and find what is new there  │ explore, research │   │      │
│ │ …      │                  │                                               │                   │   │      │
│ └────────┴──────────────────┴───────────────────────────────────────────────┴───────────────────┴───┘      │
│ [Map goals] Not matched, sent to the triage: "steal from each other" (no lever: nothing can be taken)      │
├ 3. Switches and settings ───────────────────── find [        ] show: (•) changed  ( ) all  ( ) live only ┤
│ ▸ Game speed (4)   ▾ Economy and storage (27)                                                              │
│     MC_OWN        [on ▾]   members' own stock …                    needed by: wealth goals (Ada, Mayor)     │
│     MC_BARTER     [off▾]   the offer board …                       ⚠ MC_SPECIAL=claim requires MC_BARTER    │
│ ▸ Memory and character (29)  ▸ The ladder of ages (34) …                                                   │
├ 4. Check ───────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 0 errors · 2 warnings (MC_HASTE in a model-driven run; 25 members at 1x is ~2.0M tokens/h, budget 2.0M)    │
│ Estimate ~$1.40 an hour, ~$4.20 for the run (from 6 recent runs)          Commit de617fb (working tree clean)│
│                                                       [ Start on test 1 ]                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

After Start the page shows the start's steps as they happen (reset or checkpoint restore, Paper up, agent server up,
goals applied, members spawned N/25) and then the links: the run's panel `http://127.0.0.1:{8766+N}/panel` and
`http://192.168.1.84:{8766+N}/panel`, the game `127.0.0.1:{25565+N}` / `192.168.1.84:{25565+N}`, and Pause, Resume,
Stop for that world (runctl's).

### 1.1 Profiles

- **Pick**: a list from `profiles/` and `profiles/local/` (committed ones marked; they cannot be overwritten or deleted
  from the screen, only saved as a new name, which goes to `profiles/local/`).
- **Edit**: every key of the profile shape plus the settings. Settings are shown by registry group with the
  description, type control (a flag as on/off, a `values` list as a menu, a number box, a text box), the default
  greyed, and three marks: *changed from default*, *start-only* / *live*, and the setting's `requires` and the
  settings that require it. The default view shows only the changed ones (253 rows is too many to read), with a find
  box and "all".
- **Validation** (as you type, from the launcher's check route, section 4): `checkProfile()`'s errors and warnings, plus
  the screen's own: a goal that needs a setting that is off (a wealth goal without `MC_OWN`, section 2.4), a world that
  is busy, a checkpoint saved on another site, member count above the name pool (24) or above a checkpoint's members
  (the extra members arrive without houses; a warning), `notIn: acceptance` settings in a model-driven run.
- **Cost estimate**: `estimateCost()` per hour times members, times the minutes; plus the start's own goal calls
  (section 2.3). Shown beside `MC_TOKEN_BUDGET_HOUR` with a warning when the estimate passes the budget (the run would
  pause its calls).
- **Save / Save as / Delete**: a profile file in `profiles/local/NAME.json`; delete moves it to
  `profiles/local/.deleted/` (recoverable; never a hard delete). The goals (section 2) save with the profile.
- **Load a past run**: a list of `runs/*/**/NAME.profile.json` (newest first: date, name, world, kind, commit,
  members, goal mode); loading fills every pane, including the goals, the character assignment's seed and the
  checkpoint. A past run on a commit that differs from HEAD shows "this run was on commit X; HEAD is Y" (settings
  added or removed since are listed).

### 1.2 Where

World (test worlds that are set up, except world 3, the foundry's; main only as "fresh land", section 3.4), fresh site
(`scripts/test_sites.json`) or checkpoint (`reset_site.py --list`, with what each holds: site, village, members,
complete or not, saved when), kind (staged or model-driven), member count (1-24 plus the Mayor), the objective and
minutes, the character mix (share boxes summing to 100, or one archetype; custom archetypes as in the profile's
`archetypes`, sliders later, #137).

## 2. Goals

### 2.1 Modes

`goal_mode` in the profile: `drawn` (default), `village`, `member`.

- **drawn**: today's draw, untouched (`goals.ts` and, with `MC_VALUES`, `goalFromValues`). The default for test trains
  and for every existing profile (a profile without `goal_mode` is `drawn`).
- **village**: the user types one goal. The Mayor's goal is that text as given. Each worker gets its **own take**,
  drafted by one model call per member (kind `goal_take`): its persona (temperament words, archetype or values, the
  checkpoint's skill and records if any) and the village goal in, one sentence out (at most 160 characters, first
  person dropped: "grow rich trading what the far lands yield"). The takes appear in the table for editing before start
  (the user can also clear a take to use the village goal as given). Takes are drafted only when asked (Draft takes),
  not at every keystroke; their text is saved with the profile, so a reload does not redraft.
- **member**: a table of the members' names (the Mayor and the pool's first N names, `agentNames.ts`), one text box
  each. A blank box is **drawn** by code (mixed tables are allowed); "fill blanks from the village goal" copies the
  village box into the blanks.

The text is the member's **life goal** for the run. It does not change during the run in the first version (section
2.6).

### 2.2 What a typed goal becomes (the record)

A typed goal is stored per member as a `GoalSpec`:

```
{ text: "map the far rings and find what is new there",   // shown verbatim
  measure: "invention" | ... | null,                      // one of goals.ts' six, in play; null: no measure
  kinds: [{kind: "explore"}, {kind: "innovate"}],          // option kinds (with an optional work/good/activity filter)
  pursuits: ["explore", "research"],                      // pursuit templates, at most 3, first preferred
  records: ["explore"],                                   // esteem.ts RECORD keys the goal reaches for
  unmatched: ["steal from each other"],                   // words with no lever
  by: "user" | "take" | "drawn", mappedBy: "model" | "user", model: "...", at: ... }
```

The village's record (`goals.ts` `Goals`) gains `spec: Record<string, GoalSpec>` beside `of`; `of[name]` is set from
`measure` (or, when `measure` is null, left out of the six-goal draw and counted as `custom`). A member with a spec is
never redrawn: `ensureGoals` skips it, and `mcWorld.goalsFor()`'s `MC_VALUES` override and an archetype's goal skip it
too (today both would overwrite it). A member without a spec is drawn as today (late arrivals too).

### 2.3 The mapping (one model call per distinct text)

At **Map goals** (and before Start if any text is unmapped), the launcher calls `scripts/goal_map.mts` (TypeScript, so
it uses `modelCall.ts`, the call is recorded in `runs/model-calls/` and replayable): one call (kind `goal_map`,
`MC_REASONING` design level) per distinct text, cached by a hash of text + lever catalogue version. The model gets the
text and the **lever catalogue**, generated by code from the source, not written by hand:

- the six measures with `GOAL_MEANING` and which are in play under the profile's settings (`goalsInPlay` against the
  edited settings, not the launcher's environment);
- the option kinds with one line each (choose.ts' `KIND_PHRASE`), the small works (`SMALL_WORKS`, beauty and standing
  sets), activities and goods families;
- the pursuit templates (`pursuits.ts` `DEFS` labels) and the records (`esteem.ts` `RECORD` titles);
- and the instruction to put every phrase it cannot place in `unmatched`, never to stretch a lever.

It answers with one tool call `map_goal` in the `GoalSpec` shape. **Code checks it**: every kind, template and record
must exist; a measure not in play becomes a warning with a fix ("wealth needs MC_OWN: turn it on?" with a button that
sets it in the profile); an empty mapping (no measure, no kinds) is allowed and shown as "words only: shown to the
member, nothing weighs for it". The levers found show in the table, and the user can edit them (chips: remove one,
add one from the catalogue); an edited mapping is marked `mappedBy: user`.

In **village** mode the village text is mapped once and each take is mapped on its own (takes differ, which is the
point: Ada's take maps to wealth, Ben's to explore + research). 25 members: ~26 `goal_take` and up to ~26 `goal_map`
calls, ~1.5k tokens each, ~80k tokens, ~1-2 minutes at 3 concurrent cloud calls, ~$0.05; shown in the cost line.

### 2.4 How the levers act in the run

All of it reads the `GoalSpec`; the world and goals.ts keep doing the arithmetic.

| lever | today (drawn) | with a typed goal |
| --- | --- | --- |
| prompt line | `Your life goal: beauty (progress).` (+ `GOAL_MEANING`) | `Your life goal: <text>` + the measure's progress text when there is a measure, else the count of chores of its kinds done; `GOAL_MEANING` dropped (the text is the meaning) |
| persona | `personaOf()` / `identityLine()` name the goal word | the text in `personaOf()`'s line, so every call kind that carries the persona (choice, vote, question, talk, house, pursuit) sees it; the build's planner and executor prompts get it too (from spawn, not only after completion) |
| `[toward your goal]`, `gw` | options `serves(goal)` | options that `serves(measure)` **or** match one of `kinds`; same weight rule (`goalWeight(goalScore)`), `goalScore` from the measure, or from the kinds' chore count ranked against members with the same kinds |
| pursuits | `GOAL_TEMPLATES[goal]` | `spec.pursuits` in that order, then as today (skill, nature, notes) |
| titles | none from the goal | the goal line names the nearest record it reaches for: "3 lights from the lamplighter's title (held by Eve, 19)". Esteem points are not changed (section 11, Q4) |
| ambition vote, Mayor | persona only | persona only (the goal text is in it); in village mode the Mayor's goal is the village text. The run's objective stays the profile's `objective` |
| memory | none | a pinned note at spawn, "My life goal, set at the start: <text>", kept like G5's answers (never evicted), so the night's reflection and recall see it |
| wishes, house draw | goal word | the measure's (as today); words-only goals: none |

`MC_GOALS` must be on for any typed goal; the screen sets it on when a typed mode is chosen and the check makes it an
error otherwise (it is off by default in the registry).

### 2.5 Words with no lever: the triage

Every `unmatched` phrase becomes one proposal in the world's `proposals.json` with `source: "goal"`, `by: <member>` (or
`"user"` for the village goal), the full text and the run name, written when the run starts (the world's store exists
then). Same rule as unmatched pursuits (41626d8): the triage reads them; `foundry_queue.py` skips accepted proposals
whose source is `goal` (a one-word change beside `pursuit`). The member is not told "nobody can" at start; its goal text
still shows the words (a goal can be partly aspirational). The screen lists the unmatched phrases before start, so the
user knows ("steal from each other: no lever; nothing can be taken from another member in a peaceful world with shared
storage; sent to the triage").

### 2.6 Changing goals during a run

Not in the first version. The record allows it later: `POST /api/goals {member, text}` on the agent server, the
mapping run in the agent server (it has `modelCall`), logged `[goal] X: "<old>" -> "<new>" (by panel)` with the change
minute in `run_report.py`, the pinned note replaced, pursuits left to finish or drop at the next night. Listed as a
follow-up.

## 3. The launcher (always on)

### 3.1 What it is

`runctl.py serve`, grown: a small Python HTTP server that does not need Paper, an agent server or a model to answer.
It already wraps `run_series.py`, `reset_site.py` and `stack.py`'s worlds. Changes:

- binds `0.0.0.0` on **8780** (LAN `http://192.168.1.84:8780`; 127.0.0.1 first in every printed link);
- serves `GET /` (the start screen) and its static files;
- new routes (section 4); TypeScript work (registry dump, checks, goal calls) by `node tsx scripts/profile.mts ...`
  and `scripts/goal_map.mts` subprocesses, as `start()` already does for `check`;
- one start at a time per world, guarded by the **world lock** (3.3), and starts run in a thread so `/status` keeps
  answering.

**Kept up** by `stack.py`: `stack.py up launcher` starts it detached (`scripts/detach.py`, log
`runs/<date>/launcher-<time>.log`), `stack.py status` lists it, `stack.py down launcher` stops it; `stack.py up` with no
argument does not start worlds any more than today, but does start the launcher (it costs nothing idle). At logon:
open question (Q2).

### 3.2 Start, step by step

`POST /start {profile: NAME | {...inline}, world, name?, goals?}`:

1. Resolve: the inline profile (the screen's edited state) or the file; check it (`profile.mts check`, the goal checks);
   refuse on errors.
2. Take the world's lock (3.3); refuse if held, or if the world's agent server has agents, or (main) if anything runs
   on 8766/25565.
3. Map goals not yet mapped (2.3); write `runs/<date>/runctl/NAME.json` (the one-run series spec, as today) and
   `NAME.goals.json` (every member's `GoalSpec`, or `{"mode":"drawn"}`).
4. `run_series.py SPEC --detach`, with `MC_GOAL_PLAN=<path to NAME.goals.json>` in its server environment. From there it
   is today's path: `reset_site.py` (site or checkpoint, servers from a code snapshot), `stage_village.py` or
   `watch_village.py` spawns the members. The agent server reads the plan at start (3.5).
5. The launcher follows the runner log and the agent server (`/status`, `/agents`) and reports steps to the screen
   (`GET /start/progress?world=N`): reset, Paper up, agent server up, plan loaded (`[goal] plan: 25 members, 3 drawn,
   2 unmatched sent to triage`), members spawned N/M. Then the links.
6. The run folder gets `NAME.profile.json` (as today, plus `goal_mode`, the goals file's content and the screen's
   inline profile as given), so "run again" has everything.

Stop: `POST /stop {world}` (runctl's stop: series killed, agents removed, villages flushed, Paper saved) and the lock
released. A run that ends on its own releases the lock when the runner log says `ALL DONE` (the launcher watches) or,
if the launcher was down, at the next status call that finds no series process for it.

### 3.3 One run per world: the lock

Today runctl refuses a world with agents, but a run series between two runs has none (reset under way), and train 13 on
worlds 4-5 was started by `run_series.py`, not runctl. So: `runs/locks/world-N.json` `{by, name, pid, started}`,
written by **run_series.py** (every series, whoever starts it) and by the launcher, removed at the series' end; a lock
whose pid is gone is stale and cleared with a log line. The launcher refuses a locked world and names who holds it. The
foundry's world 3 is never offered. `reset_site.py` warns when it resets a locked world it was not started under.

### 3.4 The main world

The main world has no snapshot to reset to and is full of old villages. First version: offered only as model-driven,
fresh land (the watcher's land probe from `scripts/checks/fresh_land.py`'s result), no checkpoint, after a confirm
("the main world is kept; this run builds on new land at X,Z"); the agent server starts by `stack.py up main` with
the profile's settings. Or test worlds only at first (Q1).

### 3.5 The agent server's side

- New start-only setting `MC_GOAL_PLAN` (string, a path, default empty = drawn), registry group `character`. Read at
  start by `goals.ts`; the plan's specs go into each village's `Goals.spec` when the village is registered (the
  member names are known from the plan), so the prompt line, persona and pinned note exist from spawn.
- `GET /api/goals`: each member's text, measure, kinds, progress and by (the panel's Character view shows them; the
  Run › Settings tab shows `MC_GOAL_PLAN`).
- A checkpoint saved with typed goals carries `Goals.spec` in `villages.json`; a run from it with `goal_mode: drawn`
  clears the specs (logged), one with a plan replaces them.

## 4. The API (the screen, scripts and test trains use the same routes)

All on the launcher, JSON, `Access-Control-Allow-Origin` as today:

| route | does |
| --- | --- |
| `GET /` | the start screen |
| `GET /status` | worlds (Paper, agent server, agents, paused, lock holder, run) |
| `GET /registry` | the settings registry (`profile.mts registry --json`, new: `SETTINGS` and groups, no agent server needed) |
| `GET /profiles`, `GET /profiles/NAME` | list, one (file content, committed or local) |
| `PUT /profiles/NAME` | save to `profiles/local/NAME.json` (refused for a committed name) |
| `DELETE /profiles/NAME` | move to `profiles/local/.deleted/` |
| `POST /check` | `{profile}` → errors, warnings, effective settings, cost estimate, goal checks |
| `GET /sites`, `GET /checkpoints` | `test_sites.json`; `reset_site.py --list` with what each holds |
| `GET /runs?limit=` | past runs' `NAME.profile.json`, newest first |
| `GET /names?n=` | the Mayor and the first n pool names |
| `POST /goals/takes` | `{text, members, profile}` → one take per member (model calls) |
| `POST /goals/map` | `{texts, profile}` → a `GoalSpec` per text (model calls, cached) |
| `POST /start` | section 3.2 |
| `GET /start/progress?world=` | the start's steps |
| `POST /pause`, `/resume`, `/stop` | runctl's, by world |

The command line keeps working and gains nothing it needs a screen for: `runctl.py start PROFILE --world N` reads the
profile's goals; `scripts/goal_map.mts --profile NAME` maps and writes them into the profile (so a test train can
prepare typed goals offline and commit them).

## 5. Run series and the screen

- One format: a profile is a run-series run's keys (today), now with `goal_mode` and `goals`
  (`{village: "...", members: {Ada: {text, measure, ...}}}`) in it. A spec's run may name a profile and override any
  key, goals included.
- The screen starts a **one-run series** (as runctl does today); several runs, sweeps, checkpoints saved between runs
  and checks stay `run_series.py` specs, written by hand or by a session. The screen's "Save as" can also write the
  current state as a one-run spec (`runs/series/NAME.json`) to start from.
- `run_series.py` passes `MC_GOAL_PLAN` when a run has typed goals, and refuses a typed goal mode whose goals are not
  mapped yet (no model call inside a series start: mapping is a separate, recorded step, so a series is reproducible).
- `run_report.py` gains a "goals" line (mode, how many typed, drawn, unmatched) and splits the goal measures by
  `by` (user, take, drawn) when mixed.

## 6. What is stored where

| what | where | committed |
| --- | --- | --- |
| built-in profiles | `profiles/*.json` | yes |
| the user's profiles | `profiles/local/*.json`, deleted ones in `profiles/local/.deleted/` | no |
| goal mapping cache | `runs/goalmap/cache.jsonl` (text hash, catalogue version, spec) | no |
| goal and take calls | `runs/model-calls/<date>-<pid>.jsonl` (replayable) | no |
| a start | `runs/<date>/runctl/NAME.json` (spec), `NAME.goals.json` (plan) | no |
| a run's record | `runs/<date>/runctl/NAME/NAME.profile.json` (+ goal mode, goals, inline profile) | no |
| world locks | `runs/locks/world-N.json` | no |
| runs started | `runs/runctl.json` (as today) | no |
| goals in a village | `villages.json` `goals.spec` (checkpoints carry it) | no |
| unmatched words | the world's `proposals.json` (`source: goal`) | no |

## 7. Flags and defaults

The user's rule (10-30): a new feature flag defaults on, `=off` turns it off.

- `MC_GOAL_PLAN` (start-only path, empty by default): no plan means today's draw, so **"let the code choose" is the
  default** and every existing profile and train is unchanged.
- `MC_GOAL_TEXT` (flag, **on**): a typed goal's text replaces the goal word in the prompt line and persona. Off: the
  measure's word and progress only (a control arm testing the words against the levers).
- `MC_GOAL_PIN` (flag, **on**): the pinned memory note.
- `MC_GOAL_KINDS` (flag, **on**): `kinds` add `gw` beside the measure's options. Off: the measure alone weighs.
- No flag for the screen or the launcher (tools, not behaviour).
- All four registry entries in group `character`, `requires: ['MC_GOALS']` for the three flags; `docs/SETTINGS.md`
  regenerated.

## 8. Test trains and comparability

- Trains keep `goal_mode: drawn` (the default) unless the train is about goals; their profiles and specs do not change.
- A goals train fixes the goals in the committed profile (texts, takes and mappings written by `goal_map.mts` before the
  train and committed), so both arms and every repeat read the same `GoalSpec`; no model call happens at a series start.
- Arms for a goals experiment: typed vs drawn on the same checkpoint and character seed; `MC_GOAL_TEXT=off` (levers
  only) vs `MC_GOAL_KINDS=off` (words only) to separate what the words do from what the weights do. The village-mode
  takes are part of the arm (frozen text), not redrawn per run.
- `NAME.profile.json` records the goal file's hash; `run_report.py` flags two runs compared with different goal hashes.

## 9. Predictions and checks

Written before the build; each with what would count as wrong.

1. **Profile round trip** (offline check, `scripts/checks/profile_roundtrip.mts`): every committed profile → screen
   state (the same functions the page uses, in a module both load) → saved → equal to the file (keys, settings, goals);
   a past run's `NAME.profile.json` → loaded → started dry (`run_series.py --dry-run`) gives the same server
   environment as that run had. Prediction: 0 differences; any key the screen drops is a fail.
2. **The registry dump**: `profile.mts registry --json` lists 253+4 settings with groups and `requires`; the page
   renders every group (headless Edge screenshot of the launcher, CLAUDE.md's way).
3. **Goal mapping bench** (`scripts/bench/goalmapbench.mts`, on the real prompt and catalogue): 40 goal texts, 3
   samples each, gpt-oss cloud: the user's three ("explore", "get rich", "steal from each other"), the six goals in
   plain words, 15 compound or vague ones ("be remembered", "make the village beautiful and rich"), 10 with no lever
   ("fly", "start a war", "steal"), 6 archetype-flavoured takes. Expected labels written by hand first. Predictions:
   measure right in ≥ 85% of texts that have one; no-lever words in `unmatched` in ≥ 90% (stretching a lever, e.g.
   "steal" → `own`, is the failure to watch); every answer valid after code's checks in ≥ 98%; the same text gives the
   same measure in ≥ 2 of 3 samples for ≥ 90% of texts. Below that: rework the catalogue's wording before building on it.
4. **Takes bench** (part of 3): one village goal × 25 members from the t12 checkpoint's characters: distinct measures
   among the takes ≥ 3 for a broad goal ("make the village great"), and ≥ 80% of takes keep the village goal's measure
   for a narrow one ("get rich"). Takes that all say the same thing are the failure the takes exist to prevent.
5. **Replay check**: a model-driven run's recording replayed with a goal plan whose measures equal the drawn goals and
   `MC_GOAL_TEXT=off`: menus and weights identical to the original run (`choice_golden.mts`-style diff, 0 weight
   differences). Proves the plumbing changes nothing when it says the same thing.
6. **Live start from the screen** (one test session, a free world): load `acceptance`, set 4 members, village goal
   "explore the far lands", Draft takes, Map, Start on a free test world with a checkpoint; the screen reaches "members
   spawned 5/5" and the panel link works on 127.0.0.1 and 192.168.1.84; `[goal] plan` line; `GET /api/goals` shows the
   texts; within 20 minutes after completion the members whose take maps to explore pick `explore` options more than in
   the drawn arm's same checkpoint (count `[toward your goal]` picks of kind explore; direction only, one pair, no claim).
   Start a second run on the same world while it runs: refused, naming the holder. Stop from the screen: lock released,
   Paper saved.
7. `check:offline` and the goldens unchanged with no plan (the default path).

## 10. Build order

Each step behind its flag, checked offline; one live check at the end (the test train's way).

1. **Registry dump + launcher shell**: `profile.mts registry --json`, `runctl.py serve` on 0.0.0.0:8780 serving a page
   with the profile panes (list, edit, check, save, delete, load a past run), `stack.py up|down|status launcher`, the
   world lock in `run_series.py` and runctl. Round-trip check (9.1, 9.2). No goals yet. ~1 session.
2. **Goals in the agent server**: `GoalSpec`, `Goals.spec`, `MC_GOAL_PLAN` and the three flags, the overrides skipped
   (`ensureGoals`, `goalsFor`'s `MC_VALUES`, archetype goal), prompt line, persona, `kinds` weights, pursuits, records
   line, pinned note, `GET /api/goals`, unmatched → `proposals.json`, `foundry_queue.py`'s skip. A hand-written plan
   file; replay check (9.5); goldens. ~1 session.
3. **Mapping and takes**: the catalogue generator, `goal_map.mts` (`goal_map`, `goal_take` call kinds in
   `modelUsage.CALL_KINDS`), the bench (9.3, 9.4), then the screen's Goals pane. Depends on 2's `GoalSpec`. Can run
   beside 1.
4. **Start from the screen**: progress route, links, pause/resume/stop buttons, `NAME.profile.json` additions,
   `run_report.py`'s goals line. Live start (9.6) in the next test train.
5. Later: goals changed mid-run (2.6), the main world (3.4) if not in 1, custom archetype sliders and the archetype
   per member in the panel (#137), a profile diff.

## 11. Open questions for the user

- **Q1** Main world on the screen in the first version, or test worlds only (main later, fresh land only)?
- **Q2** The launcher always on: started by `stack.py up` (when you start the stack) or also at Windows logon (a
  scheduled task)? Logon means 8780 answers on the LAN whenever the PC is on.
- **Q3** Village mode: drafted takes for every worker (the suggestion), or the village text as given to all with an
  option to draft? Takes cost ~1-2 minutes and ~$0.05 at start.
- **Q4** Should a typed goal change what the village rewards (esteem points for the records a village goal names), or
  only the members' own goals (the suggestion for v1)?
- **Q5** In village mode, should the village goal also become the Mayor's objective (what the build aims at), or stay
  the members' life goal only (the suggestion: the objective is separate, set in pane 1)?
- **Q6** `MC_GOALS` is off by default in the registry while the trains turn it on: flip it on by default (your 10-30
  rule would say on for a new flag; this one is old)?
- **Q7** Goals mid-run: wanted soon, or after the first version proves itself?

## 12. Draft 2: the adversarial check folded in

A subagent checked draft 1 against the code: 4 blocking, 9 should fix, 5 minor, all accepted (the three facts it
corrected verified: `MC_PROPOSALS` defaults off, settings.ts:436; `checkProfile` errors on unknown keys, profiles.ts:117;
G5's answers keep only 3, memory.ts:309-311). **This section overrides sections 1-11 where they differ.**

### 12.1 Blocking, and the fixes

1. **`ensureGoals` would wipe the typed goals.** goals.ts:105 deletes the whole record when no present member is in
   `of`, or when there are more members than `drawnFor` and no counters yet: a plan applied at registration is lost at
   the first `goalsFor` after completion. And goals.ts:107 gives anyone missing from `of` a drawn goal (`lateGoal`), so a
   measure-less goal would get drawn levers. Fix: the specs live in `v.goalPlan` (`{specs, mode, hash}`), **outside**
   the record `ensureGoals` may delete; `ensureGoals` takes the plan: spec members are set from it after any delete,
   never drawn, never given `lateGoal`; `drawnFor` counts plan members as present. A measure-less goal sets no `of`
   entry and no `gw` (12.2.4). An offline check (`goal_plan.mts`): plan applied, a resume with more members, a
   checkpoint of another run, `MC_VALUES` on: every spec member keeps its text and measure.
2. **The world lock.** Draft 1's lock deadlocked (the launcher takes it, then `run_series --detach` re-executes itself
   through detach.py, run_series.py:420, and its child refuses the held lock), was not atomic, and a pid-only stale test
   fails on Windows (pids reused; runctl's `taskkill /F` never lets run_series remove its file). Fix: **only the
   detached series child holds the lock**; the launcher passes `MCAI_LOCK_TOKEN` and the child adopts a lock carrying
   that token. Created with `os.open(O_CREAT | O_EXCL)`. Stale only when no process has that pid **and** a command line
   with `run_series.py` and the spec's name **and** the recorded start time. One lock per world a run uses (`world` is
   per run, run_series.py:240). runctl's stop removes it after the kill. Stated limit: direct `stage_village.py` /
   `reset_site.py` runs (CLAUDE.md's usual path) do not take the lock; `reset_site.py` only warns on a locked world.
3. **The launcher was remote code execution.** CORS `*` (runctl.py:158) plus routes that write files and start
   processes, on the LAN: any web page in the user's browser or any LAN host could start runs. `checkProfile` refuses
   `server_env` but not `stage_env`, `out` or `args`, which go into a subprocess's environment and paths
   (run_series.py:188-190: `NODE_OPTIONS` in `stage_env` runs code); `loadProfile` takes any path (profiles.ts:146).
   Fix:
   - binds **127.0.0.1 by default**; the LAN (192.168.1.84:8780) is opt-in (`MCAI_LAUNCHER_LAN=on`) and then every
     write route needs a token from `runs/launcher.token` (the page reads it when served from 127.0.0.1; LAN users type
     it once, kept in the browser);
   - no `Access-Control-Allow-Origin: *`; write routes check `Origin`/`Host` against the launcher's own;
   - profile and run names match `^[a-z0-9][a-z0-9_.-]*$` before any path join; `/runs` lists only files under `runs/`;
   - profiles from the screen refuse `stage_env`, `server_env`, `out` and free `args` (the screen's fields cover what
     they did: minutes, after, choose, stock become named keys); committed profiles keep `args` as today;
   - goal text is data: a length cap (12.2.6), shown to members as a quoted line, written into proposals as text only
     (the triage already runs with no tools, triage_proposals.mts).
4. **Unmatched words at start would be dropped.** `wantProposal` needs `MC_PROPOSALS` (default off) and a village's
   `proposalCtx` (mcWorld.ts:8664), and on a fresh site no village exists at start. Fix: unmatched words are written to
   the run folder as `NAME.unmatched.json` (`source: goal`, by, text, run) by the launcher at start, always; when
   `MC_PROPOSALS` is on they are also added to `proposals.json` once the village exists (the plan's apply step). The
   triage reads both (`triage_proposals.mts --goals FILE`); `foundry_queue.py` skips source `goal` as it does
   `pursuit`. The check warns "unmatched words go to the triage file only (MC_PROPOSALS is off)".

### 12.2 Should fix

1. **Persona** (2.4): `personaOf(name)` is name-only (temperament.ts:142) and loses to `a.memory.persona`
   (mcWorld.ts:2493, 9230, 9964); with character v2 the persona is `identityLine` (mcWorld.ts:9116-9118). The text goes
   into `characterLines`' goal and into `voterContext`'s persona, and the choice prompt's goal line, not `personaOf`.
2. **Build prompts: cut from v1.** tieredBrain.ts carries no persona; adding the goal to the planner and executor is a
   build-prompt change needing planbench and execbench. Goals act from completion, as today; the prompt line and pinned
   note appear from spawn only where the prompt already has a goal slot (choice, vote, talk, question, house, pursuit
   calls, which happen after completion anyway).
3. **Pinned note**: G5's answers keep 3 and slice to 220, so proposal answers would evict the goal. A separate
   `lifeGoal` field on the member's memory, rendered as a kept line in `recall()` (beside memory.ts:679).
4. **`kinds`: cut from v1.** No counters exist for kinds (`GoalStats.done` counts crafts only, goals.ts:120), so a
   kinds-only member is its own best (gw 2.0, then 1.6), and nothing bounds a broad goal marking every option. Pursuits
   already cover explore, research, wealth, light, garden, works, standing, house and craft, with titles, and `pmw`
   replaces `gw` (mcWorld.ts:8555; product capped at 6.25, choose.ts:195-203), so no double count. v1's levers are:
   **measure** (one of the six, in play, or null) and **pursuits** (templates, at most 3). A measure-less goal acts
   through its words, pinned note and pursuit templates only. `MC_GOAL_KINDS` is dropped from section 7.
5. **`records`: dropped.** `RECORD` is keyed by pursuit template (esteem.ts:138); the goal line's nearest-title text is
   derived from `pursuits`.
6. **Length**: the goal line is sliced at 200 without `MC_PROMPT_SELF` (mcWorld.ts:9240). Typed text, takes and the
   Mayor's village text are capped at **120 characters**; the line is built in parts (text, progress, title), each
   capped, never cut mid-word.
7. **The replay check** (9.5) runs with `MC_GOAL_TEXT=off` **and** `MC_GOAL_PIN=off`, and the persona untouched.
8. **Reproducibility**: the agent server inherits the starter's environment (run_series.py:310, 315) while
   `profile.json` records only given values and defaults, so a stray `MC_*` in the launcher's shell leaks into a run
   unrecorded. run_series strips `MC_*`/`MCAI_*` from the inherited environment except its own keys (and records the
   rest it kept); the launcher starts with a clean environment. The plan file is written **once**, by run_series, from
   the profile's `goals` key, to an absolute path (the server runs from a code snapshot with `MCAI_ROOT`,
   reset_site.py:392); the launcher only puts mapped goals into the profile it hands over.
9. **Profile keys**: `goal_mode` and `goals` join `OWN_KEYS` (profiles.ts) and run_series' `PROFILE_OWN`.

### 12.3 Minor

1. The plan is applied when a village is registered **and** when one is loaded from a checkpoint (`--resume`).
2. **Bench** (9.3) revised: at least 25 no-lever texts (so 90% is not 9 of 10), fixed in-play sets per item ("get rich"
   with `MC_OWN` off: expected wealth plus the warning), measure and pursuit precision both scored, and the expected
   labels written by another session than the catalogue's author.
3. **Cost and latency**: ~52 calls at design reasoning in 3 cloud slots is 3-4 minutes, not 1-2, and the slots are
   shared with any train on another world. Takes are **opt-in** (Q3 revised): village mode gives every member the
   village text by default, with a "Draft personal takes" button; the screen says the takes compete with running
   trains for the cloud slots. Takes read the persona and archetype only (no checkpoint skill or records in v1).
4. **Facts**: `estimateCost` already multiplies by members (profiles.ts:189; 1.1 counted twice); `KIND_PHRASE` is in
   temperament.ts:57; pursuit `DEFS` labels are functions, so the catalogue carries fixed text per template; the
   archetype's goal comes only through `goalFromValues` (character.ts:254): one override to skip, not two.
5. **Scope and runctl**: `world()` raises `SystemExit` (runctl.py:27), killing a handler without a reply: return an
   error. `start()` refuses world 3. **The main world is cut from v1** (`stack.py up main` takes no profile and runs
   from the working tree; Q1 answered by the check, the user may overrule). "Save as a series spec" and the past-run
   commit diff are cut from v1.

### 12.4 The design after the check, in short

- Launcher: `runctl.py serve`, 127.0.0.1:8780, LAN opt-in with a token, kept up by `stack.py up|down|status launcher`.
- Screen: profile panes (pick, edit by group, check and cost, save to `profiles/local/`, delete to `.deleted/`, load a
  past run), where (test worlds 1, 2, 4+; no main, no world 3), goals, start with progress and panel links.
- Goals: modes drawn (default), village (text for all; takes opt-in), member (table; blanks drawn). Each typed goal maps
  by one recorded model call to a **measure** (or none) and **pursuit templates**; unmatched words to the triage file
  (and `proposals.json` when proposals are on). Specs in `v.goalPlan`, outside the drawable record. Text capped at 120.
- Flags (on by default): `MC_GOAL_TEXT`, `MC_GOAL_PIN`; `MC_GOAL_PLAN` start-only path (empty: today's draw).
- Build order unchanged except: step 1 includes the lock and launcher security; step 2 is measure + pursuits + text +
  pin (no kinds, no build prompts), with `goal_plan.mts`.

### 12.5 Open questions, revised

Q1 (main world): cut from v1 unless you want it. Q2 (launcher at logon) stands; with the LAN opt-in, logon start is
local-only by default. Q3: village text for all by default, personal takes on a button (draft 1 had takes always).
Q4-Q7 stand. **Q8 (new)**: the LAN screen behind a token typed once: acceptable, or 127.0.0.1 only?
