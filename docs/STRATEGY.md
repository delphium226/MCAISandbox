# Strategy

What the project is aiming at, how we know we are getting there, and the order of the work. **The planning session owns
this file** (the user's, 2026-10-21): it starts work sessions with a brief, they report back to it, and it updates this
file and PLAN.md's handover after each report. Work sessions read this file and keep to their brief; they do not edit it.
PLAN.md keeps the handover and each phase's design; GitHub issues keep the todo list, each issue under one of the
milestones below.

*Last updated 2026-11-03 (the planning session, after test trains 7-18: G8's civic and monument tiers build, the sand chain works, survival modes under test, instincts on trial).*

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

## Where we are (2026-11-03)

| Goal | State |
| --- | --- |
| 1. 25 agents, many activities | **There**: every train runs 25 members for 2 hours at 1x, 80-83% busy after completion, ~$1.3 a run (F349-F351). The loop holds (p99 ~55 ms, one `[lag]` a run; F348). Walk stalls are the commonest fault left (#209 and #204 fixed; Support). |
| 2. Sid-style emergence | **Pieces built, effects small.** Laws are read, voted and followed (G3 done, F298-F300); character v2, wants, pursuits, esteem and titles run by default. A typed village goal moved what members aimed at and said, not what they had (F346); the wants pull choices without raising persistence (F342, F345); the model chooser changes what members do, not how much (F328). Instincts (#205, learned and shared lessons) made no measurable difference in their first 2-hour trial (F351). No custom has yet spread on its own (customs off in recent trains). |
| 3. Agents' proposals | Members' proposals reach the council and become laws (G3); talk-driven designs get built (train 18's windmill from a talk request). The triage loop with a Claude session (G5, #71) is not built. |
| 4. Long-horizon memory | **G1 done** (F272): journals, intentions, the village clock, reflections, all on by default. Quality left: #86. |
| 5. Self-improving activities | G6's first loop done (10-22: honeycomb, wool from members' wishes). **The foundry is parked** (the user's, 10-23); new activities since came by hand through G8. |
| G8, the ladder | **Iron and letters reached** model-driven (10-24/25). Diamond works from a pinned start (`MC_LADDER_START=diamond`, #180 fixed). **The civic tier and monuments build**: a civic building then a 1:3 cathedral finish in one 2-hour run (F349); a drawn shortlist can pick an unsuppliable building (F350), fixed by sand trips and parties (#202, #206) up to #208's sand count (F351). |
| Survival modes | Opt-in (peaceful stays the default). Damage costs little (0.04 deaths per member-hour, F344); hostile nights with the curfew, beds, hunters and walls under test: #211 (a night initiative past the curfew), #203 (the wall chases growth), #189 (lava burn). |

The village model is cheap to run with models: a 25-member 2-hour model-driven run costs about $1.3 (gpt-oss cloud).

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

Each is a GitHub milestone. The method is the project's own: spec, adversarial check, build behind a flag (on by default
since 10-30, the user's), the offline checks, a staged run, then a model-driven run at 25 (lesson 124).

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
6. **G6 Activities and the self-improving loop** (goals 1 and 5; #14, #15, #16, #66, #72, #78; first loop done 10-22, #73
   closed; next #89, demand members actually express). Tickets from the
   village's own demand, the skill tree, the outer loop. Done when a ticket made by a running village passes the
   foundry's gates and members take up the new activity.
7. **G7 Talking with the village** (the user's, 10-22; next after G2's character v2; #35-#40, unparked). The user
   interacts with members in the game (chat heard by nearby members, requests, gifts) and through the control panel
   (messages to a member or the village, requests, proposals); members remember the user (G1), answer in character (G2),
   take requests as acts and promises (G2), carry proposals to the council (G3, G5) and keep a relationship with them.
   Done when the user can ask a member for something in either place and see it remembered, answered and done or refused
   with a reason.
8. **G8 The ladder of ages** (the user's, 10-22: the focus now). The village climbs Minecraft's progression as a ladder of
   voted village ambitions, each in four stages counted by code (the motivation spec's village ambition): **iron** (mine
   trips, raw iron, iron tools, every member with one), **letters** (paper, leather, books, a library; #21), **diamond**
   (the deep mine, #22), **enchantment** (obsidian, the table, experience; #23, #19), **the Nether** (a portal and an
   expedition; netherite at the top; #25); branches **copper**, **machines** (rails and redstone, #24) and **trade**.
   Each rung's new skills come through the foundry and the innovation library's prerequisites (`tech.ts`), and each
   needs different specialists, the condition for roles to form. Peaceful mode rules out blazes and endermen, so no
   brewing and no End (to verify in game). Done for a rung when a model-driven village votes for it, works its four
   stages and reaches it. **Iron reached** (10-24, W4: model-driven from a blank map, ~31 min after completion);
   **letters reached** (10-24/25, test train 2's L1: model-driven from a blank map at 1x, voted at +34 min, reached at
   vote +76 with `MC_LETTERS_PACE`; 886af89, F315); the village then voted for trade. **The civic tier and monuments**
   (10-26 to 11-03, trains 7-18): after iron the village picks a civic building from a drawn shortlist, then a monument
   (cathedrals at 1:3) with a quarry, kiln, glazing, dye bed and masons' roles; both finish in a 2-hour run when the
   materials can be had (F349). Open: the sand chain's last gap (#208), the follow-ups #150-#163, smelting over 64 (#193).

**The order now (11-03):** finish G8's sand chain (#208) and prove it with instincts on against off (train 19); the
survival fixes (#211, #203, #189); then G8's follow-ups. **The open question is G2's**: emergence pieces run but change
little in 2-hour runs (F328, F342, F346, F351). Whether to answer it with longer runs, stronger learning or more weight on
members' own choices is the user's call; the planning session brings it with numbers after train 19.

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
  built as refits behind a flag), the second settlement (#42, #76), a second agent-server process (#5), and Phase S's big activities (candidates for the innovation library once demand for them exists).

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
- commits its own tested files (staging only its own) and pushes them to the private remote's `tiered-brain-building`
  without asking (the user's, 10-24; never `main`, never the public `origin`);
- records findings, runs, decisions and lessons in the logs as usual, and its notes in `runs/<date>/<session>/`;
- ends with a report: commits; the behaviour seen and how it was judged; the health check before and after; findings (F
  numbers); decisions made and still open; issues closed or filed;
- **watches its own context** (the user's, 10-24): from about 70% of the window it takes no new task and finishes the one
  it has; at about 85% mid-task it stops at the next safe point (no half-made edit, no run waiting on it), writes a
  resume note in `runs/<date>/<session>/` and says so in its report, and a fresh session takes over from the note. The
  planning session checks a session's context (the app's usage tool) when it reports and before giving it new work, and
  starts the next brief in a fresh session rather than in one past 70%;
- **leaves live testing to the test train** (the user's, 10-24): a build session stops at the offline ladder
  (typecheck, `check:offline`, the goldens, a new check for its piece, a bench or `MC_MODEL_REPLAY` if a prompt
  changed) plus at most one short targeted live check, and only for what needs the real world (walks, digs, placing);
  it commits with its flag on by default (the user's, 10-30; `=off` turns it off) and reports the flag ready. **The test train** is one test session, started by the
  planning session once or twice a day or after each step on the busiest files: it gathers every flag built since the
  last train into one `run_series` spec, splits per-member features by member inside one run (half the members on, by
  seed) and per-message ones by holdout (as `MC_TALK_HOLDOUT`), pairs village-wide flags on/off with several sharing
  one pair, runs the pairs on all free test worlds at once from the standard checkpoints (not from scratch), screens
  ideas in the simulator first, and reports per flag. When a combined run goes wrong, the split, the pairs and the logs
  point to the flag; a rerun with half the flags settles the rest. The combined model-driven run is the train's big
  run.

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
- 2026-10-22 (overnight, Claude's with the user's leave): G6's first loop done; G5 started as a spec plus the parts outside
  G2's files, its menu hooks after G2; #89 (visible demand) continues G6.
- 2026-10-22: **motivation** added to G2/G3 (the user's): members act but do not drive progress (react to a menu, plan one
  day, feel no need). A spec for ambitions with milestones, needs that bite, recognition and a village ambition, tested
  on vs off in 4-6 hour runs by behaviour (`runs/2026-10-22/motivation/`).
- 2026-10-22 (the user's): **Experiment 1 cancelled, Experiment 1b dropped; character v2 next.** A six-layer character model
  (HEXACO-based temperament, Schwartz values, needs, mood, relationships, a code-held identity; research note
  `docs/research/character-model-v2.md`, spec `runs/2026-10-22/character/`) makes the identical-member tests moot. Built
  and tested straight after its spec, every element and its trend over time shown on the control panel.
- 2026-10-22 (the user's): **G7, talking with the village**, next after G2's character v2; Phase 3's issues unparked.
- 2026-10-22 (the user's): **the ladder of ages (G8) is the focus**: iron first, then letters, diamond, enchantment and
  the Nether; #19, #21-#25 unparked into it.
- 2026-10-23 (the user's): **the foundry is parked**; finish the work in progress (G3 rules and Experiment 2, the economy's
  own shares and own farms, #108 members paying each other, choice pacing, #104 buildings and woods, #106), then
  **repeat the monoculture experiment** (wealth against mixed, F297) with those in place.
- 2026-10-23: **G3 done** (F298-F300; #30, #33 closed): laws read and voted (36 laws, 4 passed, 3 failed on members' own
  stakes; compliance 90% contribution, 64% help duty). Experiment 2 stopped at a ceiling (the levy paid 98-100% voted or
  imposed; the user's choice), redesign in #109.
- 2026-10-24 (the user's): work sessions watch their context: no new task past ~70%, a resume note and a fresh session
  at ~85% (Rules for work sessions).
- 2026-10-24 (the user's): **live tests move to a test train**: build sessions stop at offline checks and commit with
  flags off; one test session runs every new flag together (per-member splits, holdouts, shared on/off pairs, all free
  worlds, standard checkpoints) once or twice a day (Rules for work sessions).
- 2026-10-24: **G8's iron rung reached** in a model-driven run (W4, `runs/2026-10-24/watch-all/report.md`); letters
  voted next and built, its cane pace at 1x the open problem.
- 2026-10-25: **G8's letters rung reached** model-driven (test train 2, F315); the next vote chose the trade branch.
- 2026-10-30 (the user's): new feature flags default on; control arms set them off. Survival modes stay opt-in.
- 2026-11-03: refreshed after trains 7-18 (the planning session): goal 1 there; G8's civic tier and monuments build;
  survival modes under test; emergence (G2) the open question, to bring to the user with train 19's numbers.
