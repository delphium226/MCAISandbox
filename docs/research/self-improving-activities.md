# Richer activities and a self-improving loop

Session 33, 2026-10-16, the user's request: agents should have far more to choose from, votes should be more varied and
ambitious, the whole game should be used, and learning new activities should be automated rather than built one at a time
through the development loop (spec, check, implement, review, staged run, model run). External coding agents (Claude Code
and Gemini through their CLIs) may help. This note is a design proposal, not research with sources; the plan's Phase X
holds the steps.

## The problem

Every activity today is hand-written code: a menu option in `mcWorld.ts` (`choiceOptions`), a skill in `mcSkills.ts`, a
check, a staged test. A.2-B.4 and the food step added about 15 chore kinds over eight sessions. The workshop makes a fixed
list of goods (`MAKE_GOODS`). Votes have one topic. At this rate the village never uses most of the game: fishing, bees,
trading, enchanting, brewing, maps and books, flowers and decoration, trees and orchards, docks, bridges, walls, wells.

## The idea: split what an activity is from how it is done

Most of Minecraft is a few dozen actions: walk, collect, mine, craft, smelt, place, use an item on a block or a mob, breed,
trade, deposit. Most of them are skills already. Most new activities are recipes over those actions plus a place and a
measure of what they gave. So:

1. **Activities as data** (most of the breadth, no new code each).
2. **Projects as data** (votes: ambitious, varied, proposed by members).
3. **A skill foundry** for the few actions that need real code, built by external coding agents and gated by checks.
4. **An outer optimisation loop** that runs series, finds the biggest failure or gap and files the work for the foundry.

## 1. Activity specs and a catalogue generated from the game

- **An activity spec** (JSON, checked by a validator in code): its name and kind; preconditions (a station, a tool, an
  animal pen, a biome, a gauge below target); the steps as existing skills with arguments (`collect`, `craft`, `smelt`,
  `place`, `use_on`, `breed`, `deposit`, ...); the bill (from the jar's recipe graph, `mcMaterials.ts`); the expected effect
  on a village gauge (A.3); and the test of success, judged by the cells or items it was meant to change (lesson 138).
- **Code generates the catalogue** from the game data we already read (`vanillaData.ts`, recipes, tags): every craftable
  item with a use in the village, every crop, every breedable animal, every smeltable, every vanilla structure piece that
  passes the survival checks. The menu then ranks options by need x temperament x learning progress (A.2, A.3p) and shows
  the top ones. The workshop's fixed list becomes "what the recipe graph says we can make, ranked by need".
- **Models author specs live.** A member (or the Mayor) may propose a new activity as a spec; the validator checks it
  (known skills, sane arguments, protection rules, a bill code can cost) and a first trial decides whether it joins the
  library (Voyager's skill library, but a typed format a model cannot crash the server with). The library persists across
  runs; a spec that keeps failing is retired.
- Lessons that bind it: models decide, code does arithmetic and geometry (s1, 18); one event loop serves every bot (16,
  49); code handed to a library accepts anything (104); judge by the cells meant to change (138).

## 2. Projects and proposals for votes

- **A project** is a bigger spec: a structure (a vanilla piece, a generated design from `buildingGen.ts`, or a road/bridge
  plan from `streetPlan.ts`) plus the activities that supply it, a place (code's site search), and the gauges it moves. The
  catalogue: wells, lighthouses, walls, bridges, docks, libraries, statues, orchards, bee yards, flower gardens, roads with
  lamps, a second storage hut, a mine level, a wider farm (the vote research's ranked topics).
- **Members propose** (G1-style triage): the proposal call sees the gauges, the member's temperament and record, and the
  catalogue; it may also propose a project by composing specs. Code validates and costs every proposal (feasible,
  materials near, effort in agent-minutes from past runs) and puts 2-4 on a ballot. The vote machinery of s33 carries over.
- **Outcomes are measured** (finished, minutes, what it changed), and both proposers and the catalogue learn which kinds
  of project succeed: losing and failing proposals return with their record.

## 3. The skill foundry: external coding agents for new actions

Some activities need actions no skill has: fishing, villager trading, enchanting, brewing, taming, boats, bone meal,
shearing (check first). For those:

- **A ticket** is written when a spec needs a missing action or a failure cluster keeps recurring: the action's interface
  (`skills.ts` / `mcSkills.ts` shape), the acceptance check to write (`scripts/checks/`), the lessons that apply (grep of
  `docs/LESSONS.md`), and the test site.
- **A coding agent works the ticket headless**: `claude -p` (Claude Code) or `gemini` (Gemini CLI) in its own git worktree
  on a `foundry/<ticket>` branch, with CLAUDE.md and the ticket as its brief. It must deliver the skill and its check.
- **Test world 2 is the lab** (`MCAI_TEST_WORLD=2`): the candidate runs there from its own code snapshot, so a crash costs
  nothing.
- **Gates, in order**: typecheck; `npm run check:offline`; its own check passing live on world 2; a staged series with no
  regression (run_report against the last accepted run); a review agent's verdict. Passing work lands on a candidate
  branch; the user approves merges (at first: see the open questions).
- A driver script (`scripts/foundry.py`): ticket queue, worktree, the CLI call with a time and cost limit, the gates,
  a report per ticket.

## 4. The outer loop: optimisation against run metrics

The ingredients exist: `run_series.py` (runs from specs), `run_report.py` and `temperament_report.py` (metrics), model-call
recording and replay (free reruns of a run's decisions), two test worlds, the goldens.

- On a schedule: run a series; cluster failures by message and place; rank by cost (agent-minutes lost); turn the top
  cluster or the most-wanted missing action into a foundry ticket; evaluate the result on world 2; keep it only if the
  metric improves and nothing regresses (the ADAS / AlphaEvolve pattern, our series as the fitness function).
- **The metric needs care**: the loop optimises what it measures. Use breadth (distinct activities done, kinds per agent),
  projects finished, gauges held, failure share and diversity (A.3p's divergence), never throughput alone.

## What stays human

The user approves merges until the loop has earned trust; the metric and the catalogue's limits (peaceful world, no
griefing, protection rules) are the user's; Claude reviews foundry output like any other change.

## Order (speed first)

1. Activity specs and the generated catalogue (1-2 sessions): the most breadth, no external agents.
2. Projects and proposals for votes (1-2 sessions), on 1.
3. The foundry with one external CLI (~2 sessions to the first skill built automatically, e.g. fishing).
4. The automatic outer loop, once 3 has produced a few good skills.

## Open questions for the user

- Which CLIs are installed and logged in (Claude Code, Gemini), and a budget for them.
- Autonomy: a human approves every merge, or merges go automatically to a branch the test world runs from.
- Permissions: auto mode's classifier blocks worktree agents and pushes; the foundry needs them allowed explicitly in the
  user's settings, scoped to its script.
- Whether gpt-oss may write code that runs live (Voyager-style). Proposed: no; specs in the typed format only, code only
  through the gated foundry.
