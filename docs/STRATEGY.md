# Strategy

What the project is aiming at, how we know we are getting there, and the order of the work. **The planning session owns
this file** (the user's, 2026-10-21): it starts work sessions with a brief, they report back to it, and it updates this
file and PLAN.md's handover after each report. Work sessions read this file and keep to their brief; they do not edit it.
PLAN.md keeps the handover and each phase's design; GitHub issues keep the todo list, each issue under one of the
milestones below.

*Last updated 2026-10-21 (the planning session, after s44).*

## The goal

A civilisation that keeps thriving for hours, not one finished village: its needs come back and are met, it grows in
land, knowledge and works, and its members have a social life (memory, relationships, promises, rules, culture)
that shapes what they do. The aim behind it is unchanged: 25 or more agents, many activities, and behaviour nobody
scripted, in the spirit of Project Sid.

## Where we are (2026-10-21)

- The village builds, farms, mines, trades, invents and pursues life goals (the economy, innovation v2 and goals of s43
  and s44 are behind flags, off). The simulator matches live runs (F263, F265).
- **It runs out of work**, not materials or models: chore busy is 16-20% at best and falls to ~6% after ~90 minutes at
  real crop rates. Every source of work is a one-off pool: land within reach, public-work designs built once, goods made
  to fixed targets with few sinks (F258, F262-F264). Goals and innovation move work between members; they add none
  (F266, F267).
- The population is fixed at 25 bots, and time is frozen at noon.
- The social layer (Phase E: memory, awareness, acts, reflection, rules, culture) is unbuilt. Model choices are cheap
  (~$0.05 a half hour at 25 members, N1m), so cost is not what holds it back.

## The scorecard

Every work session reports its result on it, before and after. Until M1 builds it, the stand-in is chore busy in
10-minute bins over a 180-minute simulation at real-rate growth (`--random-tick 3`), 3 seeds.

- Needs met (food, housing, beds, light). Population is not a measure for now (parked by the user, 10-21).
- Goods per member and their variety; techniques known; works and roads built.
- Trades made and promises kept; named places and rules in force (once M4 and M5 exist).
- The trend of each over 6-10 simulated hours, not its peak.

**The pass mark:** no collapse in a 6-hour simulation at real-rate growth. A collapse is any hour after the first whose
busy falls below half of hour 1's (today: ~6% from minute 80-100 against ~22% in hour 1). Changed 2026-10-21 from "the
last hour against hour 2": hour 2 already holds the collapse, so the default village passed (F268).

## The moves, in order

Each move is a GitHub milestone. The method is the project's own: simulator first, flags off by default, then one live
pair.

1. **M1 Scorecard.** The measure above in the simulator's report and on the panel, built on s39's utilisation graphs and
   s44's Economy tab. Done when one command prints the scorecard for a simulated or a live run, and the panel shows it.
2. **M2 Demand that comes back.** Needs that renew as the village prospers:
   - public works that repeat or grow with the village (#75), then upkeep and repair (#44), then decoration that needs
     no new plot (#45, #46, #48, #49), which the beauty goal feeds (the user's order, U8; the M2 spec predicts upkeep is
     what reaches the pass mark, F269);
   - beds, then day and night (#6), with shears made wanted (#81; F266: shears never unlock without demand);
   - farms, mines and rooms as the need shows (#9, #8, #3, #1);
   - innovation driven by demand (#73, #71, #78), with the activity dependency tree (#66) to plan chains like
     sheep, shears, wool, beds.

   Done when a 6-hour simulation holds the pass mark at one settlement until its land runs out.
3. **M3 Second settlement.** Founded when the land within reach runs out: members move, a road joins the two (#42), they
   trade, and each specialises by its biome (#76; s43's spec `runs/2026-10-21/s43/spec_second_settlement.md`). Done when
   a 10-hour simulation passes with two settlements.
4. **M4 Social life.** Phase E's brain: memory and a village clock on the day/night cycle (#26), awareness from
   code-kept profiles (#27), the controller (#28), requests, offers and promises (#29), nightly reflection, members'
   proposals and voted rules (#30, #13), with life goals (#79) and skill from practice (#17) as members' individuality;
   model choices on in after-completion runs. Done when E.2-E.6's exits (PLAN.md Phase E) hold in a model-driven run.
5. **M5 Culture and experiments.** Culture (#31), Sid's three experiments (#32-#34), a second agent-server process for
   50 bots (#5), and humans in the loop (#35-#40).

**Why this order:** a social layer on a village that goes idle at minute 90 has nothing to remember, no reputations to
build and no reason for rules. M2 and M3 keep the world alive for hours, and M4 needs those hours. M1 comes first
because every later step is judged by it. Specs and analyses for a later move can run alongside code for the current
one.

## Support and parked

- **Support** (a milestone): the bugs and tools every move relies on: walking and stuck bugs, the foundry (#14-#16,
  #72), the simulator (#74), check scripts. Fixed when a move's runs trip over them, or between moves.
- **Parked** (a milestone): good ideas that do not serve the goal now, each with its reason on the issue. Phase S's big
  activities are candidates for the innovation library once demand for them exists. **Growing the population**
  (villagers as residents, #4, and the simulator's residents, #83) is parked by the user (10-21), as a step and as a
  measure of thriving, to revisit later; the M2 spec's part 1 and F269's measurements stay for that.

## Rules for work sessions

Every brief from the planning session names the move and issues it serves and what is out of scope; its expected
result on the scorecard (a prediction written first); the files it owns and the test world it may use; and what it
reports back.

Every work session:
- reads this file, CLAUDE.md and its brief, works only on its brief, and files anything else it finds as an issue with a
  milestone rather than doing it;
- edits only the files its brief gives it. All sessions share the main checkout (no worktrees), so two sessions never
  edit the same file; the busiest files (`mcWorld.ts`, `choose.ts`, `village.ts`, `scripts/sim/`) have one writer at a
  time;
- uses only its own test world (worlds 1-2 for one testing session at a time, world 3 for the foundry) and checks
  `python scripts/stack.py status` and the agent counts before any reset;
- puts design choices that are the user's to the user, as before;
- commits its own tested files (staging only its own) and asks before pushing;
- records findings, runs, decisions and lessons in the logs as usual, and its notes in `runs/<date>/<session>/`;
- ends with a report: commits; the scorecard before and after; findings (F numbers); decisions made and still open;
  issues closed or filed.

## How the planning session works

When a session reports, the planning session checks its commits and numbers (a report is not proof), updates this file
(a move done, a change of order, a finding that changes a move), closes or re-scopes issues, rewrites PLAN.md's
handover, and writes the next brief. Drift shows up as work outside any milestone, or as a drop on the scorecard.

## Changes to this strategy

- 2026-10-21: written by the planning session (the user's decision to run one); the five moves from the review of s43
  and s44; the open issues sorted into milestones.
- 2026-10-21: the pass mark compares every hour after the first with hour 1 (the user's), after the scorecard's
  baseline passed the collapsing default village (F268).
- 2026-10-21: growing the population parked, as a step of M2 and as a scorecard measure (the user's, after the M2
  spec: residents added population but little work, F269); M2 starts with works that grow and upkeep.
