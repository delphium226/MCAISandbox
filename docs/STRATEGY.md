# Strategy

What the project is aiming at, how we know we are getting there, and the order of the work. **The planning session owns
this file** (the user's, 2026-10-21): it starts work sessions with a brief, they report back to it, and it updates this
file and PLAN.md's handover after each report. Work sessions read this file and keep to their brief; they do not edit it.
PLAN.md keeps the handover and each phase's design; GitHub issues keep the todo list, each issue under one of the
milestones below.

*Last updated 2026-10-21 (the planning session; G1 done).*

## The goals

The user's, set 2026-10-10 to 10-16. Work goes toward these, not toward optimising a measure (the user's, 10-11 and
again 10-21).

1. **25 agents doing many different activities in parallel**, with a wide variety of work typical of the game
   (research, advanced manufacturing, the spell book and others).
2. **Emergent behaviour as in Project Sid**: specialisation, collective rules and cultural transmission, made possible
   by the brain and communication architecture.
3. **Agents propose improvements to the game** once they act autonomously; a Claude Code session triages each one,
   rejecting it with a reason fed back to the agents, or accepting it and building it through the usual design, review
   and test steps.
4. **Long-horizon memory**: agents remember across hours and days (the user's G2 choices, 10-11: model-managed memory,
   both horizons at once, serving competence, identity and relations, shared village memory, and goal 3).
5. **Richer activities through a self-improving loop**: new activities and community goals learned automatically (the
   foundry, the innovation library, the outer loop), not one development cycle each.

## Where we are (2026-10-21)

| Goal | State |
| --- | --- |
| 1. 25 agents, many activities | Largely there: 25 members run together; X1m did 60 distinct activities in 20 minutes. |
| 2. Sid-style emergence | Mostly unbuilt (Phase E, #26-#34). Life goals already make distinct roles (F267, behind `MC_GOALS`). |
| 3. Agents' proposals | Not built. Pieces: members' proposals for votes (#13), innovation demand (#73, #71). |
| 4. Long-horizon memory | **G1 done** (`deea7ea`, F272): journals, intentions and a village clock behind `MC_MEMORY`/`MC_CLOCK` (off); members' later choices use what they remember. Quality left: #86. |
| 5. Self-improving activities | The foundry (four tickets merged) and the innovation library exist; nothing in a running village yet makes a ticket (#73, #16). |

Built on the way and kept behind flags: the economy (s43), innovation v2 and life goals (s44), works that grow as refits
(`MC_WORKS_GROW`, F270). The village model is cheap to run with models (hour 1 of a live model-driven run: $0.17).

## The health check (not the target)

`python scripts/scorecard.py RUN` (#80) scores any simulated or live run: busy, needs met, goods, works, trades, by
hour. Every work session that changes members' behaviour runs it before and after, and reports a regression (a village
that breaks, stalls or goes idle sooner) rather than a score to beat. Its pass mark (no hour after the first with busy
below half of hour 1's) stays on the report as information. The simulator's collapse at minute 80-90 (F268) is harsher
than live: a 2-hour model-driven run (LSc1, F271) fell from 36% to 25% busy (0.68x, a pass) where the simulator gives
0.42-0.46x. Judge long-run effects live, not in the simulator alone.

**Each goal is judged by its behaviour appearing at 25 agents**, in a model-driven run: memories used in later
decisions, roles that persist and differ, rules members follow, customs that spread, proposals members make and see
answered, new activities members take up.

## The milestones, in order

Each is a GitHub milestone. The method is the project's own: spec, adversarial check, build behind a flag (off), the
offline checks, a staged run, then a model-driven run at 25 (lesson 124).

1. **G1 Memory and the clock** (goals 4 and 2; #26, done 10-21: `deea7ea`, `1bd83b8`, F272-F273; open: #86). Agent state, a persistent journal, the village clock and
   `respawn_agents.py` (PLAN.md Phase E, E.2), on the G2 design (`docs/research/memory/`). Done when an agent-server
   restart keeps every journal; the panel shows each member's intent; and in a 2-hour model-driven run members' choices
   use what they remember from earlier hours (a memory bench on the real prompts, and the run's decision log).
2. **G2 Social life and specialisation** (goal 2; #27, #28, #29, #17, #79, #32). Awareness from code-kept profiles, the
   controller, requests, offers and promises, skill from practice and life goals. Done when E.3-E.5's exits hold and
   Experiment 1 shows roles that persist and differ with social perception on against off.
3. **G3 Rules and votes** (goal 2; #30, #1, #33). Nightly reflection, endorsed proposals, voted rules. Done when E.6's
   exits hold and Experiment 2 measures a voted levy and its compliance.
4. **G4 Culture** (goal 2; #31, #34). Names, sayings, customs, a chronicle. Done when Experiment 3 shows a seeded custom
   spreading among non-seeded members.
5. **G5 Agents propose improvements** (goal 3; #13, #73, #71). Members propose works, activities and changes to the
   game from what they lack; code validates; a Claude Code triage session accepts or rejects with a reason the members
   see. Done when, in a model-driven run, members make proposals, see answers, and use at least one accepted one.
6. **G6 Activities and the self-improving loop** (goals 1 and 5; #14, #15, #16, #66, #72, #78). Tickets from the
   village's own demand, the skill tree, the outer loop. Done when a ticket made by a running village passes the
   foundry's gates and members take up the new activity.

**Why this order:** memory is goal 4 itself, and every behaviour in goal 2 needs agents that remember: profiles,
promises, reputations, rules and customs all live in memory. G5 and G6 can run beside G1-G4 where their files do not
overlap (the foundry's scripts and the library, against `social.ts` and the brain).

## Support and parked

- **Support** (a milestone): the bugs and tools every milestone relies on: walking and stuck bugs, the foundry's own
  gaps, the simulator (#74), the health check (#80, #82, #85), check scripts. Fixed when a milestone's runs trip over
  them, or between milestones.
- **Parked** (a milestone): good ideas that do not serve the goals now, each with its reason on the issue. Among them:
  growing the population (#4, #83; the user's, 10-21), upkeep (#44; the user's, 10-21), the rest of the old M2 (beds and
  day/night #6, #81; decoration #45, #46, #48, #49; needs-driven farms, mines and rooms #3, #8, #9; works that grow #75,
  built as refits behind a flag), the second settlement (#42, #76), a second agent-server process (#5), humans in the
  loop (#35-#40), and Phase S's big activities (candidates for the innovation library once demand for them exists).

## Rules for work sessions

Every brief from the planning session names the milestone and issues it serves and what is out of scope; the behaviour
it should produce and how it is judged (a prediction written first); the files it owns and the test world it may use;
and what it reports back.

Every work session:
- reads this file, CLAUDE.md and its brief, works only on its brief, and files anything else it finds as an issue with a
  milestone rather than doing it;
- edits only the files its brief gives it. All sessions share the main checkout (no worktrees), so two sessions never
  edit the same file; the busiest files (`mcWorld.ts`, `choose.ts`, `village.ts`, `tieredBrain.ts`, `scripts/sim/`)
  have one writer at a time;
- uses only its own test world (worlds 1-2 for one testing session at a time, world 3 for the foundry) and checks
  `python scripts/stack.py status` and the agent counts before any reset;
- puts design choices that are the user's to the user, as before;
- runs the health check before and after any change to members' behaviour;
- commits its own tested files (staging only its own) and asks before pushing;
- records findings, runs, decisions and lessons in the logs as usual, and its notes in `runs/<date>/<session>/`;
- ends with a report: commits; the behaviour seen and how it was judged; the health check before and after; findings (F
  numbers); decisions made and still open; issues closed or filed.

## How the planning session works

When a session reports, the planning session checks its commits and evidence (a report is not proof), updates this file
(a milestone done, a change of order, a finding that changes a milestone), closes or re-scopes issues, rewrites
PLAN.md's handover, and writes the next brief. Drift shows up as work outside any milestone, or as work aimed at a
number rather than a goal.

## Changes to this strategy

- 2026-10-21: written by the planning session (the user's decision to run one); five moves from the review of s43 and
  s44; the open issues sorted into milestones.
- 2026-10-21: the pass mark compares every hour after the first with hour 1 (the user's), after the scorecard's
  baseline passed the collapsing default village (F268).
- 2026-10-21: growing the population parked, as a step of M2 and as a scorecard measure (the user's, after the M2
  spec: residents added population but little work, F269); M2 starts with works that grow and upkeep.
- 2026-10-21: **re-centred on the user's five goals** (the user's, after works that grow, F270, and upkeep parked): the
  moves M1-M5 replaced by goal milestones G1-G6, memory and the clock first; the scorecard became a health check, not
  the target; the rest of M2 and M3 parked.
- 2026-10-21: G1 done (memory and the clock, F272); the simulator's late collapse is harsher than live (LSc1, F271).
