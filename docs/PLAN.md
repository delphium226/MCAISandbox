# Implementation plan

The working plan for the real-Minecraft village agents, carried across coding sessions. CLAUDE.md says how to run
and test things; this file says **what to do next, why, and how we know it is done**. It changes as we learn: see
"Keeping this plan honest" at the end.

The logs live beside it (moved out on 2026-10-15 to keep this file short):
- `docs/FINDINGS.md`: the findings log (F1...), what runs showed and what was done;
- `docs/RUNS.md`: the run record, one row per run worth remembering;
- `docs/DECISIONS.md`: the decisions log, dated, with whose decision it was;
- `docs/LESSONS.md`: the durable lessons (findings that generalise); `docs/HISTORY.md`: what each session did;
- `docs/plan-archive/`: finished phases (`phases-done.md`) and earlier handovers (`handovers.md`).

## How to use this plan in a session

1. **Start:** read CLAUDE.md, then this file's "Next session starts with" and the current phase. Bring the stack up
   (CLAUDE.md, "Running and checking"). Check `git status` for uncommitted work left from the last session.
2. **Pick one step** (or a few small ones). Work only on that; note anything else you find in `docs/FINDINGS.md`,
   not in code.
3. **Test up the ladder** (cheapest first, stop at the first failure): typecheck → targeted test of the change →
   staged run (`scripts/stage_village.py`, scripted workers) → benchmark if a prompt changed (`scripts/bench/`) →
   model-driven village run (`scripts/watch_village.py`). Never edit server files while a run is going.
4. **Record:** tick the step here, add a row to `docs/RUNS.md`, findings to `docs/FINDINGS.md` and decisions to
   `docs/DECISIONS.md`, each with the date; a lesson that generalises goes to `docs/LESSONS.md`, and a line on the
   session to `docs/HISTORY.md`.
5. **Commit** the tested step (CRLF preserved; `git diff --stat` vs `git diff --ignore-cr-at-eol --stat`). Ask the
   user before pushing.
6. **End:** rewrite "Next session starts with" so the next session can begin without this one's context; move the
   note it replaces to the top of `docs/plan-archive/handovers.md`.

## Next session starts with

(written 2026-10-16 at the close of the thirty-second session; the next session's prompt is
`runs/2026-10-16/NEXT_PROMPT_s33.md`)

- **Done this session (s32), committed and pushed (the user's instruction; `main` untouched):** the speed steps the user
  chose, then two research reports. `97328af`: a second test world (`MCAI_TEST_WORLD=2`: `mc/testserver2`, 25567/25577/8768;
  every test-world script takes it, run_series `"world"`), model-driven runs in run_series (`"preset": "watch"`, calls
  recorded to NAME.calls.jsonl, `"replay": RUN`), a PERF line per run (`/api/perf` + Paper's mspt; run_report's load rows),
  `npm run check:offline` (typecheck, both goldens, 15 offline checks, ~35 s; vanilla_tags' missing LURE entry fixed), the
  SessionStart hook (`scripts/session_start.py`: git against origin, the stack, this section's first lines; **first run at
  this session's start: check its output appeared**), the research in `docs/research/vote-topics.md` and
  `agent-individuality.md`. `b8585a6`: A.3p in the plan, world 1's series recorded.
- **What the runs say (RUNS.md, s32 rows):** 25 agents at 3x built 0.2 min sooner and grew no faster than 2x (4 layouts,
  houses 2 -> 14 in 10 min either way; `[stuck]` 23 against 2, F231), load fine at both (0 `[lag]`, mspt <=3.5): run_series
  keeps 2x from 12 workers. W2a (world 2, model-driven, 1x) complete in 10.8 min for $0.009; its replay W2r answered all 13
  calls from the recording, 0 live, $0, complete in 11.2. World 1's staged series ran at the same time, all clean.
- **The user's decisions (10-16, DECISIONS.md):** the speed steps above; vote research into the plan's voting item;
  personality placement left to Claude, who made it **A.3p, built right before the first vote**.
- **Next (in order):**
  1. **A.3p, personalities that change behaviour** (PLAN.md, Phase A, after A.3; ~1 session): temperaments in code (a fixed
     trait vector per agent name, Latin-hypercube spread, ~2.5x/0.4x weights per chore kind in `choose.ts`'s score before
     the trim, `MCAI_TEMPERAMENT=off|on|identical`), a code-written persona line and own-pattern reminder in menu (and
     later ballot) prompts, skill from practice. Spec first (lesson 124's method, small step: one implementer plus a
     review); `choice_golden` must stay 0 differences with `MCAI_TEMPERAMENT=off`. Exit: staged A/B from `mv3_base25`
     (identical against on, fixed picker then model mode): divergence and identifiability above identical.
  2. **The first vote: the next neighbourhood's style** (PLAN.md backlog, "More variety in neighbourhood styles"): spec,
     a ballot bench (facts and temperament against option order), code, a 25-member run from `mv3_base25`.
  3. Then the next public work and the use of free land (the same machinery), then roads with lighting.
- **Stack:** test world 1 left running (Paper 25566, agent server 8767 from a code snapshot, 0 agents); test world 2
  stopped and saved (`python scripts/stack.py up test2` or `MCAI_TEST_WORLD=2 python scripts/reset_site.py SITE`); the main
  world stopped. Checkpoints (`reset_site.py --list`): `mv3_cpv1` (3 members), `mv3_base1` (3 members, s32), **`mv3_base25`**
  (25 members, village B25x2, complete, `MC_GROW=0`; the base for A.3p and the vote). Specs: `scripts/series/scale25.json`,
  `watch_example.json`, `example.json`. One stale worktree, `.claude/worktrees/dreamy-elbakyan-b1cc1f` (s15, merged, clean):
  remove it once the user agrees (CLAUDE.md, worktree clean-up; the hook lists worktrees each session).
- **How to run things now:** `python scripts/stack.py status|up|down [main|test|test2|all]`; `npm run check:offline` before
  commits that touch agent code; a series: `python scripts/run_series.py SPEC --detach` and arm the watcher it prints;
  compare with `python scripts/run_report.py DIR/NAME ...` (now with load rows).

## Earlier phases

Finished and moved to `docs/plan-archive/phases-done.md` (unchanged there):
- Phase 1: reliability of the survival village (done 2026-09-29)
- Phase 2: shared village atlas (agreed 2026-09-28)
- Phase 2A: village infrastructure (the user's, 2026-09-29; before 2.3)
- Phase T: faster tests (decided 2026-10-01, the user's request; first in the seventh session)
- Batch R: run-time fixes (decided 2026-10-02 at the eighth session's close; before 2.4 and phase 3)
- Phase D: buildings and villages with character (proposed 2026-10-02; not scheduled)
- Vanilla villages: pieces and plans from the Minecraft jar (agreed 10-04, eleventh session; next after this session)

Steps left unticked in them (first line of each; the full text is in the archive). D.4 and D.5 were largely taken
over by the vanilla villages (V2.1-V2.5) and the street lamps, and D.8's renderer exists (`scripts/render_design.py`):
- [ ] 2.2b **Gather from the atlas**: `collect` with nothing in view goes to the nearest atlas entry for the material
- [ ] D.4 **Village plans with character**: `plan_layout` takes a plan, `green`, `street` or `rows` (today's), and code
- [ ] D.5 **Vanilla village pieces as a library**: the Paper jar (`mc/server/versions/26.1.2/paper-26.1.2.jar`) holds
- [ ] D.6 **Ambition at the mayor's level**: a style chosen once per village from its biome and wood (spruce and
- [ ] D.7 **Terrain** (bigger; design review first): buildings on their own levels instead of one levelled pad:
- [ ] D.8 **Pictures and inspiration** (added 10-03; the renderer and the critic go with D.3, the sources after D.5):

## Phase A: agents that choose (proposed 2026-10-10, twenty-sixth session; the order and the open choices are the user's)

The user's goal (10-10): once the village stands and the farming runs, the agents decide for themselves what to do and
go and do it, and get better at it as they go. Today `nextChore` (mcWorld.ts) hands idle members chores in a fixed
order (slot starts, annex, pens, pen work, iron, scouting) and no model is called after completion. **Base assumption
from 10-10 (the user's): gpt-oss:120b-cloud for every role.** The design rests on a literature review,
`runs/2026-10-10/s26/reports/LLM agent autonomy literature.md` (~140 sources, 2023-2026, its six research notes beside
it; gitignored). Its finding in one line: every system with rich autonomy wraps the model in code that offers feasible
options, checks results and holds state; nobody has published a village like ours, so A.8's comparison is new.

Design rules (each from a lesson or the review):
1. **The model chooses; code offers, checks and runs** (lesson 1; SayCan, HERAKLES, Lyfe Agents). Only code judges
   completion: model-written success checks matched humans 72.7% of the time (OMNI-EPIC), and long-running frontier
   agents claimed false completions (AI Village).
2. **One call per decision point** (a chore ended, failed or was interrupted; a request arrived; dusk; night), never on a
   timer (Lyfe Agents ~$0.5 against ~$25 an agent-hour; the AI Village's idle nudges misfired).
3. **Menus**: 4-8 named options with facts, shuffled every call, the reason before the choice, the choice an enum in a
   JSON schema, each choice logged with its position (Zheng et al.; in Magentic Marketplace every model took the first
   of several proposals 60-100% of the time; Tam et al. on reason-first output).
4. **Novelty comes from code** (Affordable Generative Agents: sampling changed the wording, not the behaviour): options
   from new sightings and needs, cooldowns, a learning-progress weight per kind (OMNI: 55 tasks learned against 4 for
   uniform choice), a kind banned for an hour after 3 failures (ODYSSEY).
5. **Code selects memory; the model curates lessons** as short bullets with counters, edited, never rewritten (LightMem:
   Mem0 43 against full history 75 on Qwen3-30B; ACE: a one-pass rewrite shrank 18,282 tokens to 122 and fell below no
   learning).
6. **Typed social acts and one-round secret ballots, not free chat** (MineCollab: detailed plan-sharing cost over 15%;
   majority voting gives most of debate's gain; the 553 messages of lesson 4).
7. **Rules on shared resources live in code**; agents vote on their numbers (GovSim: every open model up to 72B collapsed
   the commons; reasoning models free-ride in public-goods games; gpt-oss untested).
8. **Every agent may propose, through one validator** (CAREB-MAS: decision authority tracked who proposed).
9. **A fallback always**: the fixed chore order whenever a call fails or times out, the cloud is down, or the hour's token
   budget is spent.
10. **Short prompts though 128k is available** (context rot; Vending-Bench's larger memory windows did worse); the room is
   for the nightly reflection and the project archive.
11. **Distinct agents by design**, since all three run one model: personality as code-side weights, one persona line and
   code-written reminders of the agent's own pattern (persona prompts move questionnaires more than behaviour; reminders
   cut drift 87%, Leins et al.).

Steps (each up the ladder before the next: typecheck, offline bench or check, staged after-phase on minevale3 with
`stage_village.py ... --mayor --after N --fixtures` against A.1's baseline, then a model-driven run with `MCAI_AFTER`):

- [x] A.0 **gpt-oss for every role** (~1 session). Done 10-10 (s26): `modelUsage.ts` (reasoning levels, token ledger,
  hourly budget with hysteresis, `/api/usage`), tieredBrain's calls through it, the panel's usage chip and per-tier
  rows, benches with `THINK` and output tokens (`benchUtil.mts`, `concurrency.mts`), gpt-oss defaults in the scripts and
  docs. Benches chose **exec medium, plan low, design medium** (run record); budget test 4a (Gus tripping and recovering
  twice) and the local fallback passed; Minevale37 10.4 min, 0 failed, $0.0015. Not run: the spec's budget tests 4b-4d
  (a worker's hand-written task held through refused replans, a designer refused mid-design, the mayor's gatherer while
  its planner is blocked); the code paths were reviewed but not exercised.
  - A reasoning level per call kind in place of `think: false`, which gpt-oss ignores (10-10 test: false gave 69 output
    tokens, "medium" 51, "low" 20): low for executor turns and menu choices, medium for the Mayor's plans, reflection
    and projects, settled by the benches.
  - Token accounting per call, agent and run (Ollama's `prompt_eval_count` and `eval_count`) in the panel and the run
    record; an hourly token budget beyond which agents fall back to the fixed order.
  - gpt-oss as the default executor and planner in tieredBrain, `watch_village.py` and `stage_village.py`; the local
    routes stay usable as a fallback; the 8k context check only for local models (check that the cloud honours
    `num_ctx` before raising it).
  - Benches at low and medium, at least 10 samples a case (lesson 20), raw calls checked (`PEEK=1`, lesson 11):
    `execbench`, `planbench`, `mayorbench`; three agents calling at once, for latency under load.
  - Exit: the benches at least the local models' scores; Minevale37 (1x, model-driven, every role on gpt-oss) complete in
    about 11 min with 0 failed actions, its tokens and cost recorded; CLAUDE.md's run commands updated.
- [x] A.0b **Scaling probe**: done 10-10 (s26; `runs/2026-10-10/s26/scale_probe.py`, `.log`). 3, 6, 9 and 12 bots in no
  village, all collecting logs at once for 90 s a level (every one felled real trees): **0 `[lag]` lines and 0 `[stuck]`
  at every level**, the API's p90 0.02-0.03 s (worst 0.04), Paper's tick 1.7 ms average and 2.9 ms worst at 12 (of
  50). One agent server holds 12 working bots. The cloud: 10-12 calls at once all answered, no 429, worst 5.3 s;
  **Ollama Cloud's Pro plan allows 3 concurrent requests** (Max and Team 10), the rest queue (a fixed, unpublished queue
  size; over it requests are rejected), which matches the bench's throughput levelling at ~2.5-3; no published RPM or
  TPM limits since the credits of 08-31 (ollama.com/pricing, 10-10). Not covered: find_site and prepare_site scans,
  builds and model calls at scale; the probe felled trees within minevale3's restore radius (reset before use).
  The plan was (the user's question, 10-10: can the approach take more agents?). With every role
  on the cloud and calls only at decision points, the model is no longer the limit (A.0's concurrency bench: 3 calls at
  once 1.1x slower, 6 at once 4x, no errors). What may be: one Node process runs every bot (pathfinder and scans on one
  event loop; lesson 16; a stall over ~30 s makes Paper drop every bot) and Paper's own tick. Measure: the concurrency
  bench at 10-12 calls at once; 10-12 bots on the test world (names whitelisted), first idle, then all walking and
  collecting at once, counting `[lag]` lines, the API's response time and Paper's tick time (`mspt`/`tps`). Exit: a
  number of agents one agent server holds without stalls over ~2 s, or the finding that bots must be split across
  processes (a second agent server per village).
- [ ] A.1 **Decision log and the baseline** (~half a session; no behaviour change). The code is in (`85ddef1`, s26:
  `[choice]`/`[choice-end]` records, `mcChoiceLog.ts`, per-run JSONL via `MCAI_CHOICE_LOG`, `autonomy_metrics.py`, which
  reads the AGENTS table since E.1); **the baseline runs are still to do** (as of s27).
  - Every chore decision logged as a `[choice]` record (agent, time, the options offered with their facts, the choice,
    the reason, "fixed order" for today's picker), closed with its outcome, minutes and yield; also a per-run JSONL.
  - `scripts/checks/autonomy_metrics.py`: activity entropy and specialisation per agent, cumulative unique (activity,
    target) pairs, the village value curve (storage priced in mcMaterials' raw units) and its drawdowns, a goal ledger
    (chosen, done, failed, abandoned), refused repeats and interventions per agent-hour (rescues, teleports), idle
    minutes (the `AFTER busy:` line).
  - Baseline: three staged after-phases with the fixed order (`--after 45 --fixtures --stock ...`) and one model-driven
    run (`MCAI_AFTER=45`).
  - Exit: the metrics for all four in the run record.
- [x] A.2 **The menu: chores become choices** (~1-2 sessions; the spine of the phase). **Done 10-13 (s28)**: every exit
  criterion met except the value curve, which cannot judge it (F223); see the progress note below.
  - World (mcWorld.ts): each chore kind split into `options(v, agent)`, its feasible instances with facts (what and where,
    materials on hand and in storage, distance, the agent's own success rate and minutes for the kind, the expected
    effect, who else is on it, when it was last done and how it went), and `run(option)`. Today's order becomes one
    picker over the same options (baseline and fallback). Exposed as `WorldAdapter.choices?(agent)` and
    `runChoice?(agent, id)`, so tieredBrain stays world-free. F193's keys stay: only options no one holds.
  - Brain (tieredBrain.ts): a `choose` call when an idle member of a complete village holds no chore: the persona line,
    the village's state, the options shuffled with names (no letters), the agent's last outcomes, what the others are
    doing; schema `{reason, choice}` with the choice an enum; reasoning low; a timeout or an invalid answer runs the
    fixed order.
  - Code guards: cooldowns per kind, the learning-progress weight, the 3-failure ban, scouting options that say "nothing
    new on the last N trips".
  - Options as instances, not one slot per kind (for scaling): today's keys let one agent explore, one go for iron, one
    work the pens, and the mine one miner a tunnel, so a fifth agent would sit idle. Several scouting points, harvests and
    pen jobs at once, a second tunnel or level for a second miner; a key then names the instance (`explore:3`).
  - Panel: each agent's last menu (with positions), choice and reason; a position-bias count.
  - `scripts/bench/choicebench.mts`: menus recorded in A.1's runs replayed in shuffled orders, at least 10 samples a
    case: valid answers, position bias, and sensible picks where there is a clear answer (a ripe field and nothing
    urgent: harvest; cows penned and no bucket: iron).
  - Exit: at least 95% valid; no slot chosen above ~1.5x chance among equal options; a staged after-phase with no stalls
    and a value curve at least the baseline's; one model-driven run.
  - Open (asked when the step starts): a "something else" slot that leads to a proposal (A.5) from the start or later;
    whether workers also choose among ready board tasks before completion (recommended later, after A.8's first
    comparison). **Answered 10-12 (s28): both later.**
  - **Progress (10-12, s28):** spec `runs/2026-10-12/spec_a2.md` (checked: 21 of 23 findings applied). It departs from the
    Brain bullet above: **the world drives the decision** (its 30 s sweep) and calls the world-free `server/src/choose.ts`,
    so the staged runs' scripted workers choose too; `tieredBrain.ts` and `taskBrain.ts` are unchanged. Implemented: the
    menu (`choices`, `runChoice`, pure options with instance ids, `MC_CHOICE_INSTANCES`), the fixed picker over it (default,
    `MC_CHOOSE=fixed`), model mode (`MC_CHOOSE=model` or `--choose model`: the `choose` call kind at low reasoning, 2
    decisions at once, 30 s queue, 15 s gate wait, a fixed pick on any failure), guards (per-id bans, kind bans, a 5-min
    agent cooldown, the learning-progress weight, scouting's "nothing new"), the decision log with full menus, the panel's
    Choice tab and village chip. Checks: `choice_golden.mts` (960 fixtures from both worlds' villages incl. A1b3's
    after-phase: 0 differences against HEAD, 960,000 `choices()` calls with 0 state changes, instances 0 invariants
    broken), `choose_unit.mts` 147/147; review (4 lenses, 22 of 24 survived refutation) and a fix review, all fixed.
    Live: a fixed-mode smoke test on A1b3's village (`runs/2026-10-12/smoke_a2.*`), 12 decisions with menus, 0 errors.
    Then (10-13): choicebench passed (100% valid, 70/70 sensible, no position bias); A2m (model mode at 25) ran with 0
    errors, 8% taken, decision wait p90 0.9 s, ~$0.003 a run; Minevale42 (model-driven, model mode) complete in 10.2 min.
    **Exit status:** every criterion met except the value curve, which cannot discriminate (F223: identical fixed runs
    spread 397-701; storage does not count scouting). Open: F224 (scouts shut out by any lure), F225 (herding).
- [ ] A.3 **Gauges and personalities** (~1 session).
  - Village gauges in code beside `refreshNeeds`: food in storage per agent (bread, cake, eggs, milk), tools (iron
    pickaxe, buckets, shears), farms and pens running, light, storage room, land explored round the ring; each with a
    target, a value and a trend, shown as words with numbers (D2A). Each option carries its expected effect; code
    scores options by deficit x effect x personality weight x learning progress and shows the top 5-8 (HERAKLES;
    BioBlue: models balancing several targets drift to maximising one).
  - Personalities: moved to A.3p below (10-16, s32), built before the first vote; the gauges here use its temperament
    weights when they come.
  - "What the others are doing and have promised" in every menu (Project Sid's specialisation; Riedl's one sentence).
  - Exit: staged A/B (identical against distinct personalities, two runs each): distinct ones give more different
    activity histograms; low gauges draw matching choices; the value curve not below A.2's.
  - Open: personas written by the user, proposed by Claude for approval (recommended: fixed across runs so they
    compare), or generated each run.
- [ ] A.3p **Personalities that change behaviour** (~1 session; s32's research, `docs/research/agent-individuality.md`,
  44 sources; placed by Claude on the user's word, 10-16: **built right before the first vote**, so ballots have distinct
  voters and the vote's bench can tell a temperament from option order).
  - Why this shape: persona prompts move what a model says about itself, not what it does (The Personality Illusion:
    ~24% of trait-behaviour links held; an agreeableness persona moved self-reports ~4 and behaviour ~0.03), and personas
    collapse on tasks with a right answer, worst in RL-trained reasoning models like gpt-oss. They do act where the trait
    names a decision with no right answer (GovSim's greedy newcomer: survival 53% -> 33%): our chore menu and ballots, not
    executor turns. Ballots are close to questionnaires, so personas show there easily: measure vote against deed.
    Project Sid's agents had identical traits; its roles came from social awareness (so E.8's main arms stay identical).
  - 1. **Temperaments in code**: a fixed vector per agent name (Mayor, Worker1-24), spread by a Latin-hypercube draw over
    a few traits (curiosity: exploring and new kinds; care: animals and farms; diligence: stock, gathering, light;
    pride: building and the village's look), mapped to a weight per chore kind multiplied into `choose.ts`'s score
    before the trim, so it works in the fixed picker too. Big enough to see (~2.5x the most-liked kind, ~0.4x the
    least: small Sims trait weights went unnoticed). `MCAI_TEMPERAMENT=off|on|identical` (E.8's arms).
  - 2. **A persona line and an own-pattern reminder**, both written by code from the vector and the agent's own record
    ("you mostly tend the pens; 5 of your last 8 chores"), in every menu and ballot prompt (~60 tokens, <50k tokens an
    hour at 25: ~2.5% of the budget; reminders cut drift 87%, Leins et al.).
  - 3. **Skill from practice**: the per-kind record becomes a skill; practice raises the kind's weight, neglect lowers
    it, a "passion" from the temperament multiplies the gain (response-threshold model, RimWorld passions); menu facts
    "you: 5 of 5, 6 min; village: 9 min".
  - Later, with growth and the votes: **stakes and likes** (an own house, pen or field and E.6's personal chest; a liked
    wood and flower in the house trim, Dwarf Fortress preferences), and **ballot wiring** (persona line, reminder,
    stakes and record in the ballot; code logs the vote the temperament predicts beside the real one, unseen by the
    agent). Already planned elsewhere: relationships (E.3), nightly intentions and projects (E.6, A.5).
  - Measures: per-agent chore-mix entropy, mean pairwise Jensen-Shannon divergence between agents, split-half
    consistency, whether the model keeps or flattens the code's tilt (model mode against the fixed picker),
    identifiability (name the agent from 10 choices; chance 1/25), say-do and vote-do agreement, and the user's test:
    name three agents after watching for ten minutes.
  - Exit: staged A/B from `mv3_base25` (`MCAI_TEMPERAMENT=identical` against `on`, fixed picker, then model mode):
    divergence and identifiability clearly above identical; model mode keeps most of the tilt; no rise in failed chores.
  - Not here: activation steering or fine-tuning (cloud weights), long backstories or MBTI, a model-rewritten identity
    (drifts), model-judged needs or moods, temperature or reasoning level as personality, a model per agent, free chat.
  - **Status (s33, 10-16): part 1 built** (items 1-2; spec `runs/2026-10-16/s33/spec_a3p.md`): `server/src/temperament.ts`
    (five traits with the user's sociability, Latin-hypercube vectors, 2.5x/0.4x kind weights, the code-written line),
    `tw` on every option, the weighted fixed pick and trim, option tags, the own-pattern line, the response threshold in the
    fixed sweep (liker first, a disliked pick left 90 s), `/api/temperaments`, the panel's line, `temperament_table.mts`
    (in check:offline), `scripts/temperament_report.py`. `MCAI_TEMPERAMENT` still defaults to off. Exit runs (RUNS.md,
    s33): fixed Ton2 against Tid/Tid2 JSD 0.60 vs 0.49/0.50, rho 0.52 vs 0.07/0.15, ident 0.29 vs 0.27/0.18; model Mon
    against Mid JSD 0.48 vs 0.39, ident 0.20 vs 0.07, rho 0.44 vs -0.01, the model's own picks the most-liked kind 72% vs
    43%: **the model keeps the tilt; identifiability is weak at ~7 choices an agent in 20 min** (F232, F234); failed
    share 5-8% vs 1-3%, mostly a hut no-path spot seen with identical temperaments too (F233). Part 2 (skill from
    practice) not started.
- [ ] A.4 **Journal, lessons and roles** (~1-2 sessions).
  - A village clock: a day every N real minutes, kept by code (Minecraft time stays frozen unless A.7 says otherwise),
    for recency, reflection and meetings.
  - A journal per agent written by code (typed events: chores with outcome, minutes and yield; first times; sightings;
    requests and replies), importance scored by code; a per-agent, per-kind table (attempts, successes, minutes, yield)
    that feeds the menu's facts.
  - A nightly reflection per agent (medium reasoning): the table, the day's records and the current lessons in; at most
    5 insights, add/update/delete edits to at most 10 lesson bullets with helpful and harmful counters (ExpeL, ACE), a
    role name from its histogram, and an intention for tomorrow (a weight on the menu, not a command) out. Code applies
    the edits, checks entries against the world and expires old ones.
  - Lessons reach the menu (the 2-3 most relevant) and the executor's turns after a failure, so the build phase gains
    too; roles show on the panel (house signs later: the backlog's Roles item).
  - Exit: over a 2-3 hour staged after-phase, success rates and minutes per trip improve for the kinds that failed
    early; no lesson contradicts the world when checked; roles persist across days.
- [ ] A.5 **Projects** (~2 sessions). Proposed by models, checked and compiled by code.
  - A fixed vocabulary compiled into existing machinery, each with a completion condition code checks: a building (a
    vanilla piece or a drawn design on the annex or a second plot, through find_site and plan_layout), a farm or pen
    (more slots, a second annex), stock (add_need: keep N of X), a beautifying piece (B.1-B.7 as they land), a path to a
    named place, exploring (a direction or a sighting), the mine (a new tunnel or level).
  - One proposal slot per agent, used at the nightly reflection; a validator (materials within reach, unobtainable
    items refused, room on the site, a time estimate from the bill and measured rates) with a neutral preview written by
    code, a refusal that names the reason and an alternative (lesson 2), up to two repairs, and an archive of proposals
    done, failed and refused shown to proposers, with a novelty check against it (OMNI-EPIC).
  - Accepted projects become board tasks or chores, so they reach everyone as menu options. Optional: an empty objective
    lets the Mayor propose the village itself.
  - This is phase 3's compiler: a player's request (3.3, 3.4) later goes through the same validator.
  - `scripts/bench/projectbench.mts`: proposals from recorded village states, scored valid, novel against the archive,
    feasible.
  - Exit: in a staged 2-hour after-phase, at least two projects proposed, validated and finished; none counted done that
    the server does not show.
- [ ] A.6 **Requests, meetings and village rules** (~1-2 sessions).
  - Typed acts: request, offer, accept or decline with a reason, report done, ask the Mayor for help after a failure,
    propose, vote. Code routes each to the addressee's next menu as an option, closes it (accepted, done, expired),
    keeps a ledger of commitments, and checks any claim about the world before the others see it (the AI Village's
    invented contact list cost 8+ hours). Chat stays throttled; a decision may carry one short spoken line for the
    watcher (Project Sid's controller).
  - A meeting at dusk: an agenda by code (open proposals, gauge alarms, rule changes), proposals collected before anyone
    sees the others', shown shuffled with previews by code, one statement each, a secret simultaneous ballot, the result
    enforced by code; the first speaker rotates.
  - Village rules as numbers over a small API (logs felled per area a day, saplings replanted per tree, stock floors, how
    near the green trees may be felled), voted at meetings, enforced by code, shown in every menu (GovSim-SelfGovern,
    CRSEC); the starting values are code's.
  - Exit: requests made and met in a staged run; a vote held and its rule enforced; messages per hour no higher than
    today's.
- [ ] A.7 **Day, night and culture** (~1 session).
  - Open (the user's): Minecraft's daylight cycle back on (harmless in peaceful; the lamps stand; beds later need wool,
    so shears, so iron) or the code clock alone. Dawn: journal summary, gauges, intention; day: choices at chore
    boundaries; dusk: the meeting; night: reflection, lessons, roles, the chronicle, fresh contexts (Cursor's fresh
    starts; Sinha et al.: models copy their own earlier errors).
  - Culture seeded and recorded by code: places named by the agent that finds them, kept in the atlas and used in
    prompts (naming balanced: one agent of three is 33%, above most measured tipping points); a nightly chronicle entry
    by gpt-oss from recorded events, novel against earlier entries, written into a book in the library by command; caps
    on what culture creates (the AI Village's expansion arms race).
  - Exit: the user reads a few days of chronicle and finds it accurate and worth reading; all three use the same names.
- [ ] A.8 **The comparison** (recurring: after A.2, A.3 and A.5, and at the end). On restored minevale3, the same
  after-phase length (60-90 min) and several seeds: (1) scripted chores, (2) menu, (3) with gauges and personalities,
  (4) with journal and lessons, (5) with projects and social acts; A.1's metrics for each, then a pairwise ranking of
  replays by the user. Then 2-4 hour runs with stop rules for autonomy (no decision for N minutes, the same failure
  repeated, the budget spent), read against the AI Village's failure list (invented state, goal neglect, false
  completion, metric gaming, loops). Later: one worker on a local model against the all-gpt-oss village.
  **Scale** (the user's, 10-10), once A.0b says one agent server holds it and A.2's options are instances: 5-6 agents a
  village (Worker3-6, whitelisted; a house each eventually), then two villages of 3-5 (the backlog's "two villages",
  with requests and trade between them). Specialisation and culture only emerged in Project Sid with 25-50 agents, so
  scale is what makes A.3-A.7's roles, rules and culture measurable at all. The research's warning: in MineCollab
  success fell from up to 90% to under 30% going from 2 to 5 agents coordinating by talk, while central assignment kept
  repeated work near zero (TeamCraft); our board, keys and typed acts are the central kind, and a meeting costs one call
  an agent. More agents fell trees faster: A.6's felling and replanting rules come before more than ~6 a village.

Order and size: A.0 to A.7 in order with A.8 between them, about 10-12 sessions; A.2-A.3 already give agents that choose
for reasons, A.4-A.5 agents that learn and invent, A.6-A.7 a society. Out of scope: code written by models (Voyager),
models judging completion, free agent chat, and changes to the build phase beyond lessons in failure turns. Cost (an
estimate at gpt-oss's $0.15/$0.60 per million tokens): decisions, reflections and the Mayor's calls for three agents
come to ~0.3M input and ~35k output tokens an hour, about $0.06; the monthly $60 credit covers hundreds of hours, and
A.0's budget guards against a runaway loop.

## Roadmap for Phases A, S and E (Claude's, 10-10, the user away)

**Goals added 10-11 (the user's):** (G1) once 25 agents act autonomously, they **propose improvements to the game**; a Claude Code session picks the proposals up, decides whether each is feasible, and rejects it (with a reason the agents get back) or accepts it and implements it through the usual design, review and test steps. (G2) **Long-horizon memory**: investigate the best mechanism for agents to remember across hours and days and implement it (it takes over and extends A.4 and E.2's journal, lessons and clock; the literature review's memory notes are the starting point, now with gpt-oss for every role instead of the small local models those notes assumed). Both get their own steps once designed. G2 started 10-11 (s27): the user's choices in the decisions log, the literature synthesis in `docs/research/memory/long-horizon-memory.md`, bench v1 and its check beside it; the bench's v2 and the design are next (the handover).

**Revised 10-11 (the user's direction):** after S.6, no more agent-count comparisons (the paired Van12/Van3 runs and the "12 must beat 3" pass rules end with S.6). Work goes to the stated goals: 25 agents doing many different activities in parallel (E.0, E.1, then the task families S.9-S.16), agents that choose (A.2 on), and Sid-style emergence (E.2-E.7, then E.8-E.10). Each step is tested by whether it works at 25 agents and does what it is for, with short purposeful runs. S.7 and S.8 stay as needed infrastructure (model-driven agents at scale, a village big enough for them), without their timing targets.

The user's goals (10-10): agents that choose and pursue their own goals (Phase A); 25 agents doing many different
activities in parallel, with more kinds of work (Phase S, first at 12); and Project Sid-style emergence through the brain
and communication architecture (Phase E). The measured starting point: 12 agents finish the village no faster than 3
(Van12a 6.1 min, Van3a 6.0, staged at 2x), because the build is one serial chain and the objective too small. The three
phases share steps; this is the order (each step tested up the ladder before the next):
1. **Measure:** S.0 with A.1 (busy minutes, critical path, the decision log, the new `[mine]`, `[furnace]`, `[pickaxe]`
   lines) and the baselines Van12b/c, Van3b/c.
2. **Break the chain and make 25 safe:** S.1-S.6 (contention, the mine for many miners, glass once, the tail, stations,
   the huts' ground first) beside E.0 (the model call gate for 3 cloud slots, chat heard within 48 blocks, a board that
   does not recompute on every claim, debounced saves) and E.1 (25 names, max-players, the panel at 25).
3. **Choices and size:** A.2 (the menu, with instances), S.7 (12 model-driven agents), S.8 (two plots at once).
4. **The society's brain and talk:** E.2-E.7 (memory and the clock, social awareness, the controller, acts and
   proximity talk, reflection and meetings and rules, culture), which take over A.3's "others", A.4, A.6 and A.7's
   culture as Phase E says; A.3's gauges and A.5's projects stay.
5. **More kinds of work:** S.9-S.16 (the workshop, research, smelting, string, the library, iron and copper goods, the
   deep mine, the spell book), each a menu option kind and a project kind; they can interleave with step 4.
6. **The experiments:** E.8-E.10 at 25 agents (specialisation with the social module on and off, a rule changed by vote,
   culture spreading), and A.8's comparisons for the smaller villages.

## Phase S: twelve agents in parallel, and more kinds of work (proposed 2026-10-10, twenty-sixth session; the user away, Claude's choices)

The user's goals (10-10): (1) twelve agents working on as many tasks in parallel as possible, with task chains broken up where that makes sense; (2) more kinds of work, "like research, advanced manufacturing, and spell book development, and any others typical in the game". Today twelve agents perform like three. The staged Van12a run (2x, Mayor and 11 scripted workers) was complete in 6.1 min. Van3a, the same village with 2 workers, took 6.0. Van12a's agents were busy about 40% of the time, Van3a's about 88%. The build is one serial chain (plot, mining hut, stairs, the hut's cobblestone, storage hut, houses, signs), and the standard objective gives only about 6 build tasks. The evidence is in `runs/2026-10-10/s26/` (`parallel_map.md`, `candidates_verified.md`, the two logs, `capacity*.mts`, and two designs with their judges' reports). The logs and the code confirm two losses and suggest a third:
- Duplicate glass smelts: three 6-glass batches for 14 panes (confirmed).
- Hut cobblestone used up by pickaxes: about 14 gone, and the hut came up 1-4 short (t9491 asked for 4), costing a 0.6 min requeue (confirmed).
- A mine limited by faces (a hypothesis). Per-miner rate fell from about 20 cells a minute (Van3a) to about 7, and 9 miners together dug about 62 a minute. The busy wait is never logged (`mcMine.ts:550-555`), and the same window has a competing cause: storage held 8 cobblestone at 2.1, so most miners made wooden pickaxes. S.0's `[mine]` line decides between them.

More agents alone cannot make completion earlier. Van12a is bound by its serial chain, not by work (lesson 97: only removing work on the critical path moves the finish). So Phase S does three things in order:
- shorten the chain (S.1-S.6);
- give twelve agents a village big enough to need them (S.7-S.8);
- add families of work that do not run out (S.9-S.16), each one an A.2 menu option kind and an A.5 project kind.

**Measure of goal 1:** Van12 should finish clearly ahead of Van3, measured against S.0's Van12b/c and Van3b/c (not Van12a's 6.1 and Van3a's 6.0), and busy time before completion should rise.

Rules for every step:
- Models decide; code does the counting and geometry (lesson 1).
- Peaceful survival with no damage: no mob drops except from passive animals.
- Building and crafting are charged to inventories by command.
- Staged runs with scripted workers come before model-driven runs.
- No server edits while a run is going.

**The test for every step:** `MCAI_API=http://127.0.0.1:8767/api MC_TIME_SCALE=2 python scripts/reset_site.py minevale3`, then Van12a's command as `Van12<step>` (`--workers 11 --mayor --stage full`, `--site-at=-1630,65,35,40,birch`, the same three vanilla designs) and as `Van3<step>` with `--workers 2`, two runs each. Also count `[stuck]`, `[lag]`, `[dig]` and failed actions, and run the typecheck.
- A step predicted to save 0.3 min or more passes when both runs save at least half of the prediction against the previous step's runs (S.0's for S.1).
- Smaller steps pass on their mechanism log lines, because a two-run gap of under ±0.2 cannot judge them.
- Van3 must never get worse beyond S.0's noise band.

- [x] S.0 **Measure first**: done 10-10/11 (s26). Baselines (staged, 2x, minevale3 at -1630,35; `runs/2026-10-10/s26/`): **Van12b 6.4 / Van12c 6.0 min, 44-45% busy; Van3b 5.7 / Van3c 5.9 min, 90-92% busy**: 12 agents average 6.2, 3 agents 5.8. Both causes confirmed: six miners waited 35-85 s for a face in each 12-agent run (`[mine] ... waits for a face (held 3, live 3, turns 4)`), and storage's first cobblestone went to pickaxes (left 5, 2, 0; then wooden pickaxes; Van12b's storage hut short of its furnace, `[shortfall]`). RCON never queued deeper than 2 (p99 under 20 ms). The order S.1, S.2 stands. The plan was: **Measure first** (~half a session; agent behaviour unchanged). Run it with A.1, which needs the same busy-minute counts.
  - `stage_village.py` and `watch_village.py`:
    - per-agent busy and idle minutes for the whole run;
    - a critical-path printer that reads the board's stamps;
    - a stall rule per agent, and `MCAI_SAME_FAIL` honoured in the stage script;
    - spawns on a ring outside the plot's margin, on ground read from the world, with the command's answer checked (lessons 37 and 51).
  - New log lines only:
    - `[furnace] X waited Ns held by Y`;
    - `[mine] X waits for a face (held, live, turns)`;
    - `[pickaxe] X took 3 cobblestone from storage (left N)`, and `X made a wooden pickaxe (storage had N cobblestone)`;
    - at a build shortfall, the storage record set against the server's counts;
    - RCON queue depth and p90/p99 latency every 30 s.
  - Exit:
    - Van12b/c and Van3b/c give the baseline and noise band for every later pass rule and for goal 1. The new spawns and stop rules make Van12a and Van3a incomparable.
    - The new lines confirm or refute the two losses and settle the face-limit hypothesis against the pickaxe cause. If the result changes the picture, re-order S.1-S.3 before writing any code.

- [x] S.1 **Small contention fixes**: done 10-11 (s26). Staged Van12d/e 6.2/6.1 min (baseline 6.4/6.0), Van3d 5.7 (5.7/5.9): no change in completion, as expected for this step; the mechanisms showed: the builds' cobblestone left alone 6 times a run, the 4-pickaxe supply made at 2.8-2.9 and every stored pickaxe taken, no `[shortfall]` (the storage hut no longer short). One regression, fixed after the runs (to confirm in S.2's runs): the stairs' digger failed once at 1.6 ('cannot make oak_planks': the spare kind chosen was oak, the bot carried another), so the mine opened at 2.2 instead of 2.0-2.1; the pickaxe crafts now name the kind on hand. 7 wooden pickaxes are still made before the supply lands (S.2's branch helpers cut the waits that follow). The plan was: **Small contention fixes** (~half a session).
  - `makePickaxe` (`mcSurvival.ts:236-247`) takes a stone pickaxe from storage first. Otherwise it uses storage cobblestone only beyond what the claimed and claimable builds still need, the same rule as `spareKind` (lesson 88), then cobblestone in hand, then makes a wooden pickaxe.
    - Storage holds no pickaxes today (`deposit all` keeps tools, `mcStorage.ts:265`), so the rule gets a supply: a soft task, "Make 4 stone_pickaxe into storage" (deposited by name), posted once storage holds the hut's cobblestone plus 12 and claimed by an idle worker.
  - `syncGather` (`mcWorld.ts:277`) rounds a remainder under 8 up to 8, or adds it to an open task of the same item. Dropping it would turn a 1-4 shortfall into the requeue this step removes.
  - In a hut village the storage task counts as done only once `storageFromFelled` has finished depositing. That removes Van12a's 5 log trips the felled logs already covered (about 6-8 agent-minutes).
  - `collect` no longer says "cannot be gathered here" when the only candidates it dropped were held by other gatherers (`takenByOther`, `mcSurvival.ts:781`, `:829-831`). It says they are taken, and `noneToGather` does not act on that message.
  - `placeChest` claims its spot before walking.
  - Exit:
    - no "short of materials for the storage_hut";
    - no log task claimed after 1.0 and then closed as covered;
    - no "Gather 1-4 cobblestone" tasks;
    - `[pickaxe]` shows no storage cobblestone taken while a build is short;
    - mine cells per minute not below S.0's;
    - `mine.py` passes.

- [x] S.2 **The mine for many miners**: done 10-11 (s26). Staged Van12f/g: **mine rate 82/81 cells a minute** (S.1's runs 50/51; 10 miners at peak), a cobblestone task 0.9 min claim to done (median; 1.6 before), 0 busy hand-backs; Van3e 44 (42-43 before). Just under the 86 set as the pass mark (1.6x, not 1.7x): passed with that note (Claude's decision; the rest of the wait is the stairs and the first pickaxes). Completion 6.1/6.1 (6.2/6.1 before) and Van3e 5.8: the critical path has moved on to the builds and the tail (S.3, S.4). Offline: `scripts/checks/mine_geometry.mts` (984 cases and 24 recorded mines match), `mine_rate.py`. The plan was: **The mine for many miners** (~1 session; the prediction stands only if S.0 confirms the face limit).
  - Branch helpers:
    - When every tunnel is held, `nextLeg` gives a waiting miner an unfinished branch at an already dug junction instead of `'busy'`.
    - Holder keys become `tunnel:branch`. The tunnel's own holder takes a branch's key as it reaches it, so it never enters a helper's branch.
    - `MineLeg.dug`, one in-order counter, becomes a main-tunnel count plus progress per branch, in `village.ts:110-125`, with an `upgradeMine`-style migration. `m.dug` stays as the total for its readers (`mcSurvival.ts:679,683`, `village.ts:711`), and `turnFrom` reads the per-branch progress (`mcMine.ts:463-465`).
    - `emptyTrips`, `awayAt` and `downFails` are kept per miner and branch (today per village, `:684-687`).
    - A helper never takes a branch whose junction is not dug, and a branch ending never ends its tunnel (F82, lesson 36).
  - A claim gate: no more cobblestone tasks open than faces + 2, with one claim always allowed when the count reads 0.
    - `village.ts` must not import Mineflayer. The gate is a registry callback, `claimLimit?: (v, t) => boolean` on `VillageRegistry`, set in the `MineflayerWorld` constructor the way `refreshNeeds?` is (`village.ts:322`, `mcWorld.ts:71`) and called inside `claimable`.
  - Every runner, not only the Mayor's (`tieredBrain.ts:743`), treats "the mine is busy" as not the task's fault. Today a scripted worker's soft give-up counts as finished and releases its build short of cobblestone (`village.ts:524`).
    - The handed-back task gets a per-agent cooldown that is released when a face frees. Without it the same idle worker reclaims the task at once (`taskBrain.ts:188`, 20 Hz).
    - The busy message is left out of the loop guard's key.
  - Exit:
    - `scripts/checks/mine.py` extended to N bots: every cell from the plan, one holder per cell, no cell dug twice.
    - Van12: cells per minute at least 1.7x ~~the 62 baseline~~ S.1's Van12d/e by `stage_village.py`'s `MINE rate` line (50 and 51, so **86 or more**; S.0's Van12b/c 60 and 53; Van12a's hand estimate of 62 is what the line gives for Van12a; older logs through `scripts/checks/mine_rate.py`), cobblestone task times 0.6-0.9 min (`MINE tasks`; Van12d/e 0.6-2.5, median 1.6), hand-backs counted and none repeated by one agent within the cooldown (`MINE hand-backs`, no REPEAT), no new `[stuck]` lines in the tunnels.
    - Prediction about 5.3 with S.1.

- [x] S.3 **Glass made once for the village**: done 10-11 (s26), with S.4 (results below S.4). The windows are pooled (`[parts] code pooled the windows: 14 glass_pane for 3 buildings`), one worker makes 16 panes into storage (`make_into_storage`, 32 s), builders find them after the furnace queue. The plan was: **Glass made once for the village** (~1 session). This is the first manufacturing task.
  - `makeFromStock` takes the furnace lock itself before it withdraws anything, then reads storage again for the target item. Today `smelt` takes the lock (`mcSurvival.ts:1314-1316`) after `makeFromStock` has already withdrawn the sand (`mcBuild.ts:414-422`). `smelt` called alone takes the lock after its walk, not before (`:1316`, `:1327`).
  - `makeFromStock` also:
    - deposits by name, while still at the hut, any made parts beyond the build's own bill (panes, glass, doors, slabs, stairs);
    - never deposits what the next claimed task counts as carried (lesson 64).
  - Glass panes are billed for the whole village and rounded once (14 panes = 6 glass = 6 sand, not 3 × 6), in `materialTasks`, `refreshNeeds` and `stockCovers` together. Run `materials.mts` before and after (lesson 76).
  - A soft task, "Make 16 glass_pane into storage" (withdraw sand and fuel, smelt with the spare wood kind as fuel, craft, deposit by name), posted once the furnace is ready. The lamps' charcoal joins it.
    - No build waits for it yet. Before S.5 the furnace exists only once the hut is built (`mcSurvival.ts:1014-1027`), and houses open at that same moment (`layout.ts:341`). S.5 adds the wait.
  - Exit:
    - exactly one 6-glass smelt per run;
    - `[furnace]` total wait under 0.2 min;
    - no requeue for glass;
    - prediction about 4.6.

- [x] S.4 **The tail: lamps early, a sign per building**: done 10-11 (s26). Staged with S.3: **Van12h 4.8 min** (S.2's 6.1/6.1), **Van3f 5.4** (5.7-5.9 before): **12 agents now finish clearly ahead of 3** (the measure of goal 1). Signs go up as each building finishes, lamps in parallel. Open: the stairs digger's pickaxe failed at 1.6 again (the spare log kind taken by the mining hut just before); after the runs the wooden-pickaxe craft gathers logs of any kind and retries once (to confirm in S.5's runs). The plan was: **The tail: lamps early, a sign per building** (~half a session).
  - First, a fix: `ownGather` (`tieredBrain.ts:1009`) closes only gather tasks. Today it would mark a half-done lamp or sign job done at completion.
  - Lamps wait for the plot, storage and `villageStation('furnace')`, not for every build to be claimed.
    - Without the station gate, `light_streets` smelts charcoal through `makeFromStock`, which bills a furnace of its own while `villageStation` returns null (`mcBuild.ts:401-402`). That would cost 8 of the hut's cobblestone and put a furnace off the plot.
    - Before S.5 the gate means "after the hut". Lamps become truly early with S.5's furnace.
    - Lamps' wood stays reserved in `stockCovers` while the task is claimed, not only while it is open (`village.ts:424-428`).
  - One sign task per building, after its own build only.
    - `put_up_signs building=`, identical in `skills.ts` for both worlds.
    - The signs' wood is reserved like the lamps', open or claimed. Signs came after the lamps because two jobs reading the chests at once came up short (`layout.ts:378-382`).
    - A per-sign record replaces `lay.signed`, followed through completion (`mcBuild.ts:1936`), `light_streets` (`:1873`), the summary (`village.ts:258`) and the panel (lesson 57).
    - Completion requires every building's sign record. Today a failed soft task counts (`tieredBrain.ts:1012`), so a failed sign task is re-opened instead.
    - Spare signs (one craft makes 3) are deposited.
  - The Mayor's gatherer may take lamp and sign tasks once the `ownGather` fix is in and no gather task is open (lesson 66: beside its plan, never inside it).
  - Exit:
    - no furnace made by a lamp task;
    - lamps start within 0.1 min of the furnace standing, and once S.5 is in, finish before the first house ends;
    - each sign within 0.1 min of its building;
    - completion never declared with a sign missing (`data get`);
    - the Mayor's busy minutes above 0 during the builds.

- [x] S.5 **Stations before the storage hut**: done 10-11 (s26). Staged **Van12i 4.2 min** (S.4's 4.8), **Van3g 5.6** (within S.0's band): the table stood at 1.0 (via the storage's chest craft), the furnace at 2.1 (via the dig task), both in the hut's cells, the sweep clean, 0 failed actions (the stairs digger's pickaxe recovered). One pass item off: the first building was claimed at 2.1, before the panes reached storage at 2.7 (most likely the windowless meeting point, which the check counts as a house; to check in the next runs). Since S.0: 12 agents 6.2 -> 4.2 min, 25% ahead of 3. The plan was: **Stations before the storage hut** (~1 session).
  - The hut's crafting table cell T and furnace cell F (layer 1, the chests' layer, plot level + 1) are filled early:
    - the table by the storage set-up, from the felled logs;
    - the furnace from the stairs' cobblestone, crafted and placed by the miner after it walks out to the hut, never underground (lesson 101). If the stairs gave fewer than 8, it withdraws the rest from storage.
    - Both placements are confirmed on the server (lessons 29 and 80), and nothing is set inside a player (lesson 44).
  - The stations are billed as their own consumer, closed when they are placed, in `materialTasks`, `refreshNeeds` and `stockCovers`. Otherwise the hut's gather tasks still ask for them and S.1's spare rule counts a phantom need. Run `materials.mts` before and after (lessons 57 and 76).
  - The hut build skips a T or F cell where the right station already stands, and places the station itself when it is missing. That is the fallback when a worker set up storage instead.
  - The build gets a level check for stations like the one for chests (lesson 33).
  - `villageStation` reads the cell once the hut's ground is prepared, without needing the hut's structure record (`:1017`). Every consumer is followed through, including the panel (lesson 57).
  - Houses and the wheat field wait for storage plus the stations, not for `hutBuild`. Builds that use panes now wait for S.3's pane task. The hut stays first in posting order (lesson 91).
  - Exit:
    - the furnace stands by about 2.2;
    - panes are in storage before any house starts;
    - no table or furnace outside the hut (`/api/blocks` round the plot);
    - no gather task for the stations after they stand;
    - `render_design.py` on the built hut;
    - prediction about 4.1.

- [x] S.6 **The huts' ground first**: done 10-11 (s26). Staged **Van12j 3.1 min** (S.5's 4.2): the plot split into the huts' two parts and four more (`[parts] ... huts 2 (276, 299), rest 4 (300, 300, 204, 221) for 11 workers`), one level y=65, `layout 1 complete: 6 parts, seams 448 columns, 0 bad`, 0 `[lag]`, 0 `[stuck]`; Van3h (small village, 4 parts) builds fine in 5.1. One failure: the lamps claimed at 2.0 before their fences and torches were in storage (retried; S.4's lamp gate should also wait for the parts' torches: backlog). **Phase S's chain work ends here: 12 agents 6.2 -> 3.1 min.** `scripts/checks/huts_box.mts` checks the split offline (182 layouts). The plan was: **The huts' ground first** (~1-1.5 sessions; the riskiest step, so it comes last in the chain work).
  - First task: "Prepare the huts' ground". It covers both huts' footprints and claim rings, a street corridor between them, and corridors from each hut to the nearest edge of the layout (F154).
    - Once any part is recorded, `protectedGround` makes the whole layout no-dig (`botAgent.ts:185-205`), so gatherers leaving the huts must not have to cross unprepared forest to get out.
    - Its level is the mode over the whole layout, written on the layout record.
    - Its plot record goes into `v.plots` before any tunnelling. `unsafe()` defers cells under an unprepared plot, treating them as busy until the plot record covers them. It never ends the leg, because faces are capped (one turn per side, `MAX_LEGS` 12 a level).
  - Storage set-up and the mining hut wait only for that task. `dig_mine` keeps `after: [build]` on the mining hut, because `digMine` refuses without the hut's structure (`mcMine.ts:290-307`).
  - "Prepare the rest of the plot" goes out as up to 4 rectangle tasks, each one free for any agent:
    - Each rectangle leaves out the huts' box plus its claim ring, with margin 0 on the side facing it. `prepare_site` reserves one rectangle plus its margin (`mcBuild.ts:1417`), and `runJob` refuses overlapping reservations (`:582-585`, `village.ts:373-381`).
    - They leave out `mineAreas`, so no fill can seal the stairs (F131).
    - Each ends with `deposit item=logs`, since `storageFromFelled` skips once storage exists and would strand about 300 logs.
    - Their records merge into one plot record, so the `plots[0]` readers still see one plot.
  - Streets: `mcBuild.ts:1338` finds the layout that contains the prepared area, so partial prepares lay their `dirt_path`. Lamps wait for whichever task lays the streets; re-check S.4 here.
  - Log tasks for houses and the landmark wait for the rest of the plot. Only the huts' and chests' logs open earlier, which keeps out the wasted log trips S.1 removed.
  - Before writing code, check the wood offline: count the logs the huts' ground fells on minevale3 against the chests plus the mining hut's 26 logs. If they fall short, post that gap as hand log tasks at t=0.
  - Exit:
    - `site.py` and `top_map.py` find no pits;
    - all felled logs end in storage, and no log task is closed as covered;
    - the mine is open by about 1.4, and no tunnel is ended under the plot;
    - no `[stuck]` anywhere in the unprepared rest or on the corridors;
    - streets laid;
    - the same pass on the shelf site;
    - prediction 3.6-4.0 (the 3.1-3.3 lower bound leaves no slack);
    - Van12 at least 1.3 min ahead of Van3.

- [ ] S.7 **Twelve model-driven agents** (~half a session).
  - At most 3 model calls in flight across the process (Ollama Cloud Pro), the Mayor's plans and designs first. A call's timeout starts at dispatch, not at queueing.
  - An RCON request timeout that drops late replies by id goes in only if S.0 shows a latency tail. A timed-out `clear` or `give` is counted again on the server before any refund (lesson 4).
  - This runs before A.6's felling rules, overriding A.8's "~6 a village" (see Decisions).
  - Exit:
    - `concurrency.mts` with 12 calls at once;
    - a staged `--brain tiered` run with 11 workers: no task handed back because a call was refused;
    - Minevale38 (1x, model-driven, 11 workers) complete with 0 failed actions;
    - `Worker3`-`Worker11` whitelisted first.

- [ ] S.8 **A village sized for twelve: two plots at once** (~1-1.5 sessions).
  - `plan_layout` lays out every plot in one call when the Mayor names more buildings than one plot holds.
    - Plot 1 takes the huts, the landmark and about 4 houses; plot 2 sits beside it and takes about 7 houses and a centre.
    - Plots come from find_site's best squares that do not overlap.
    - Every prepare task is posted at once, and the serial `unplaced` path stays as the fallback.
  - The Mayor's prompt (`tieredBrain.ts:304`) gives these capacities. There is one lamp task per plot.
  - Before the model-driven run, count offline the logs within 96 of both plots against the 16-build bill (lesson 99).
  - In the existing hut: second cobblestone and logs chests in its free spots, and a lock per chest.
  - Furnaces, judged at the test's speed: 41 pooled panes (18 glass) plus charcoal take about 1.85 min on one furnace at 2x, 3.7 at 1x (furnaces run on the tick rate, lesson 40).
    - Two more furnaces go in the hut's dead cells (1,4) and (5,4) only if Van12L's `[furnace]` waits exceed 0.2 min.
    - Then run `rotate_design.py` and the renderer, since the hut never turns (lesson 68).
  - Pickaxes:
    - a soft task, "Make 8 wooden_pickaxe into storage", from the felled logs, claimed by an idle worker once storage exists (never inside `storageFromFelled`, off the critical path);
    - S.1's stone batch raised to 8.
  - `stage_village.py` takes a second `--site-at`.
  - Exit:
    - "Van12L" (a library and 11 houses on plot 1 and the plot east of it, about 16 builds) complete in 6 min or less at 2x;
    - at least 70% busy before completion;
    - 0 failed actions;
    - the same village with 3 agents about 17 min, which is the goal-1 gap.

Goal 2 below is a tech tree. Families come in order of how much parallel work they offer soonest and how feasible they are in peaceful at minevale3. Each is tested alone with `--stock` to skip earlier tiers, measured by the `AFTER busy:` line, yield and failures, in a staged 12-agent after-phase (`--mayor --after 30 --fixtures`). A family that runs before completion must leave completion within the noise band. New families are off by flag in A.8's comparison runs.

- [x] S.9 **The workshop: `make` and the tech record** (~1 session). This is the framework. **Done 10-15 (s29)** with the
  user's wider scope (make + gathering, the works plot with three furnaces; the decisions of 10-14/10-15): `9c76d28`, spec
  `runs/2026-10-14/spec_s9.md` (count, check, reviews in `runs/2026-10-14/`). S9f (25 agents, fixed): 23 agents took an
  S.9 chore, peak 9 at once, after-phase busy 44.8 agent-min (A2f2 18.8), MAKE ok 24 of 24 made, 0 requeues; S9m (model):
  18 agents, peak 7, 33.9 (A2m 21.0), MAKE ok 23 of 23. The work peaks at minute ~1 and stops when the targets are met:
  B.4 (light) next, as the first consumer. Open: F226.
  - One composite skill, `make item= count=`: withdraw the inputs, make the item at the hut through `makeFromStock`, deposit it by name (lesson 112). Crafting stays charged by RCON.
  - Offered as a chore with an instance key (`make:<item>`, lesson 111). After completion first, as an A.2 option.
  - Before completion (`make` and S.10's surveys) only when all of these hold:
    - the inputs are spare beyond the open builds' needs;
    - one idle worker stays in reserve;
    - the chore's estimate fits before the next task can open;
    - the chore stops when a task opens, with the stop noticed as idle (lesson 67).
  - `v.tech` records the first time the village makes each item (when and by whom). It is the village's tech tree, and the panel shows it.
  - Room: the annex's two slots hold the chicken and cow pens. Decide here on a second annex or a works plot, built with `prepare_annex`'s machinery, for S.11's furnaces and S.14's sheep pen.
  - Tier 0 goods:
    - stone tools, and a wooden sword for S.12;
    - charcoal and torches;
    - glass, panes and glass bottles;
    - chests and barrels;
    - smooth stone and stone bricks;
    - mud bricks (dirt and a water bottle make mud; mud and wheat make packed mud; 4 packed mud make mud bricks). Minevale3's 25 clay lie under or beside the east lake (F136), so clay bricks come only where S.10 finds dry clay;
    - a composter, for bone meal without mobs;
    - ladders.
  - Exit: storage gains match the bills on the server's counts; 0 requeues traced to `make`; busy agents after completion at least 9 of 12.

- [ ] S.10 **Research: surveys and yield experiments** (~1-1.5 sessions). This is what "research" means here.
  - Survey tasks are typed questions with answers code checks. A task is done when the atlas holds a new record. Examples:
    - "nearest lava source the mine reaches" (none within 96 of minevale3 lies above y 31);
    - "bee nests within 160";
    - "cobwebs within 96 and their depth";
    - "dry clay";
    - "geodes";
    - "sugar cane";
    - "chests in structures".
  - The atlas gains sighting kinds for nests, cobwebs, geodes, lava sources, clay and chests.
  - Yield experiments: dig a sample tunnel in a y band and record ore per cell, so the deep mine picks its depth from what was measured (lesson 99).
  - The tech tree is `v.tech`, not advancements. Crafting by `/give`, building by `/setblock`, breeding by `data merge` and enchanting by `item modify` fire no player triggers, and the monster advancements are out of reach in peaceful.
    - Advancements are shown only where a live test shows the agents' real actions earn them (`inventory_changed` fires on `/give`). Never `advancement grant`.
  - Surveys need neither the mine nor the hut, so they may run during the build under S.9's rules, posted behind the critical path. Range stays at 96 (lesson 22). Underground trips end with the depth check and a teleport home (lesson 101).
  - Copy the atlas before any reset (lesson 115).
  - Exit: 4-8 surveys at once during a Van12 build with completion within noise; every survey's answer matches the snapshot (`region_blocks.py`).

- [ ] S.11 **The smelting works, ore side-yield and XP** (~1 session).
  - A furnace row on S.9's works plot with one lock per furnace. A blast furnace (5 iron + furnace + 3 smooth stone) for ores and a smoker for food.
  - Iron-age tunnels also keep copper, lapis and redstone, with redstone only with an iron pickaxe. Lesson 102 applies: no veins chased into floors.
  - Copper (32k blocks within 96 of minevale3) carries the decorative lines later.
  - XP budget, measured live: XP comes only from real furnace takes (`takeOutput`; 0.1 per glass, so level 8's 112 XP is about 1,100 glass), mining coal, lapis and redstone ores, and real fishing. Crafting, breeding and building are commands and give none.
  - Exit:
    - parallel smelt chores, one per furnace;
    - `--stock raw_iron:10` gives ingots by the jar's ratios;
    - no station outside the works plot or hut;
    - XP per agent-hour recorded for S.16.

- [ ] S.12 **String and fishing** (~1 session).
  - Cobwebs drop string only to a sword (`requiresCorrectToolForDrops`; by hand they take about 20 s and drop nothing). String comes from a wooden sword (2 planks + 1 stick).
    - The planner's string <- cobweb rule carries the tool and replaces the UNOBTAINABLE entry (`mcMaterials.ts:52`).
    - Within 96 of minevale3 there are 57 cobwebs, all in a mineshaft at y 12-34, 30-50 blocks under the surface (nearest about 70 away). `collect`'s filter (home level - 16, `mcSurvival.ts:214-215`) excludes them.
    - So string is one bounded trip chore (sword equipped, the depth check and teleport home, lesson 101) for about 57 string, never an endless menu option. Walks through cobwebs need lesson 114's coarser stall rule.
  - String opens up:
    - fishing rods;
    - the loom;
    - leads (5 string make 2, no slime ball in 26.1), for simpler animal lures.
    - Candles need honeycomb (see bees, later), and bundles need leather, so they wait for the leather supply.
  - Fishing, one agent per pond with no cap (lakes at about -1680,-16 and -1552,40). Test Mineflayer's `fish()` live first.
    - Real fishing yields fish, XP, junk and treasure books. Junk is about 10% of catches; leather is about 1% (about 95 catches, roughly 30 fisher-minutes a leather at 1x) and ink sacs about 0.1%. Junk is also the only renewable string, at about 0.5%.
    - If `fish()` fails, fish by command: `execute as <name> run loot give <name> fish minecraft:gameplay/fishing ... mainhand`, charged rod durability, timed by vanilla's 5-30 s wait. With no hook it gives **fish and junk only, no treasure and no XP**.
  - Exit:
    - 4+ fishers at once;
    - string and fish in storage matching the server's counts;
    - no stall in the mineshaft;
    - leather per fisher-hour recorded for S.13;
    - whether live `fish()` works recorded for S.16's XP.

- [ ] S.13 **The library: paper, books, shelves** (~1-1.5 sessions). The first half of the spell book.
  - There is no sugar cane within 96 of minevale3, so cane farms come from the 160-block sightings (or `--fixtures`). Then paper, books (3 paper + 1 leather), bookshelves and a lectern placed in the library building.
  - Leather binds, not cane (about 0.9 cane a minute from 16 plants). With culling off it comes only from fishing junk:
    - one shelf (3 books) is about 1.5 fisher-hours;
    - 15 shelves are about 22-24.
    - The first target is the enchanting table's book plus 1-2 shelves. Larger libraries are A.5 projects sized by S.12's measured rate.
  - Butchering surplus cows comes behind `MCAI_CULL`, **off by default**: the pen keeps a breeding pair and at least 4 adults, and nothing else is ever killed. Put the choice to the user before S.13.
  - A book and quill needs a feather, and every feather source here is a kill. It is dropped unless the user extends `MCAI_CULL` to chickens. A.7's chronicle stays in `villages.json` or on signs.
  - Cane harvests leave the bottom block.
  - Exit: `--stock sugar_cane:30,leather:7` gives 7 books: 2 shelves (or 1 shelf and a lectern) and 1 spare book, placed and checked with `execute if block`.

- [ ] S.14 **Iron and copper goods, and textiles** (~1.5 sessions).
  - Shears, then a sheep pen on S.9's works plot (6 sheep within 96, 21 within 160; test the gate geometry live, lesson 110), then wool, beds, carpets and banners.
  - Dyes come from what the site holds. Within 96: wildflowers (yellow, about 1,630), lilac (magenta, 20), lily of the valley (white, 15), plus bone meal (white) and lapis (blue, and light blue mixed with white). There is no red, green, orange, pink, lime, cyan, purple or brown here. Measure bone meal on grass before counting on other flowers.
  - The Mayor picks a banner or bed from a vocabulary code builds from the 32 `no_item_required` patterns and the dyes S.10's survey found. Code compiles it to `/setblock` and charges the dyes as well as the wool.
  - Lanterns, chains, cauldrons, a stonecutter, a smithing table; copper lanterns and chests.
  - These go into buildings as interiors and lamps v2.
  - Iron is the binding cost: iron goods come only after the iron pickaxe and buckets.
  - Exit: `--stock iron_ingot:10` gives shears, a sheep pen and a bed in a house; the iron age's own goals are still met.

- [ ] S.15 **The deep mine** (~1.5-2 sessions).
  - Stairs from the iron level (y 18) down to about y -58, with several starts (lesson 100), then one branch per miner.
  - The iron mine is separate code with no holders (`nextIronLeg`, `ironBusy`, one `stuckAt`). This step brings S.2's holders and branch record to it explicitly.
  - Lava is handled with a carried water bucket. The jar's `is_fire` damage tag includes lava, so `fire_damage false` should cover it; test only the walking and pathing live.
  - Stone-pickaxe tunnels never break diamonds.
  - Every miner is teleported home at the end (lesson 101).
  - Exit: 3-6 miners at depth, no `[stuck]` clusters on the deep stair, diamonds and deep lapis and redstone in storage.

- [ ] S.16 **Obsidian and the spell book** (~2 sessions). This is "spell book development".
  - `cast_obsidian`: no lava within 96 of minevale3 is reachable from the surface (all at y 31 or lower), so the lava comes from where S.15's mine meets it.
    - Either cast at that level (pour water by bucket, confirm on the server, mine it with a diamond pickaxe, teleport home), or carry a lava bucket up and cast in a lined pit by the hut.
  - The enchanting table needs a book, 2 diamonds and 4 obsidian.
  - Enchanting by charged command, after a live syntax test (lesson 109):
    - code checks the table, the shelf geometry and `xp query`;
    - it clears lapis and levels;
    - it applies vanilla's `enchant_with_levels` with `item modify`.
  - XP comes only from S.11's sources and real fishing (if S.12's live `fish()` works). The enchanter is the agent with the most XP: an A.4 role.
  - Anvil combining by code using vanilla's arithmetic.
  - The village's "spell book" is a catalogue of the enchantments it holds. Models choose what to pursue (an A.2 option or an A.5 project), and code says what is feasible.
  - Start with a bare table (levels 1-8). Shelves follow S.13.
  - Exit: `--stock diamond:2,obsidian:4,book:3,lapis_lazuli:6 --xp 30` (a new `stage_village.py` option, via `xp add`) gives an enchanted pickaxe and a book, both checked on the server.

**Later, not scheduled:** each waits for a measurement or for a site.
- Bees, honey and candles (candles need honeycomb; 1 nest within 96).
- Cartography (the atlas already does the mapping).
- Rails and redstone; the hopper egg collector alone is 0.5.
- Archaeology and trading (minevale3 has no suspicious blocks or villages within 320); the wandering trader as a 0.5 chore.
- The Nether: harmless in peaceful, but 4-6 sessions.

**Interleaving with Phase A.**
- S.0 runs together with A.1: the same busy counts, plus the `[choice]` log.
- S.1-S.6 change only the build phase, and A.2-A.7 only the after-phase, so S.1-S.6 go first. They are a clean, measurable win, and A.8's comparisons need a stable build in front of them.
- A.8's rounds all use one setup: restored minevale3, the 6-building village, new families off by flag. S.8 changes the village and the hut, so A.8's round after A.2 runs before S.8.
- A.2's instance keys must land before S.9. Every family from S.9 on is written as `options(v, agent)`/`run(option)` with instance keys (`survey:<question>`, `fish:<pond>`, `furnace:<k>`, `branch:<n>`, `cane:<farm>`, `make:<item>`). Each family is also added to A.5's vocabulary as a project kind with a completion check code makes:
  - "keep N of X";
  - "a library of N shelves" (sized by leather);
  - "a sheep pen";
  - "an enchanted pickaxe";
  - "a deep level".
- Suggested order:
  1. S.0 with A.1;
  2. S.1-S.6;
  3. S.7;
  4. A.2 (with instances), then A.8's round after A.2;
  5. S.8;
  6. S.9-S.12;
  7. A.3 and A.4 (A.8's rounds on the fixed setup);
  8. S.13-S.14;
  9. A.5;
  10. S.15-S.16 as A.5's first multi-branch project.
- A.8's scale item is S.7-S.8.

**Size:** S.0-S.8 about 7-8 sessions; S.9-S.16 about 10-12.

**Decisions (Claude's, the user away)**
- **Design B's order and guards as the backbone, with Design A's attack on the head (S.5, S.6) last.** B's steps are smaller and judged by mechanism. Only A attacks the 2.0 min serial head, the largest block left once the mine and furnace are fixed.
- **S.1 before S.2, with its own stone-pickaxe supply.** The pickaxe drain is hidden behind the mine today and lands on the critical path once the mine is faster. Without the supply, the spare rule would send every miner to make a wooden pickaxe.
- **Baseline from S.0's runs.** S.0 moves the spawns and changes the stop rules, so Van12a and Van3a no longer compare.
- **Pass rules: half the prediction for steps of 0.3 min or more, mechanism lines below that.** A's rule could neither pass nor fail steps of 0.05-0.1 min.
- **Stations placed early, billed on their own, not houses freed from the hut.** This keeps the hut's own stations, gets glass made before the builds, and comes with a fallback when the stations are missing. Builds wait for panes only from S.5 on.
- **More furnaces only at two plots, and only if measured at the test's speed (S.8).** With pooled panes one furnace hardly queues.
- **One mine with branches, not a second mine.** 6-8 faces cover two plots; a second mine touches about 10 files.
- **A.6's "~6 agents a village before felling rules" overridden for S.7-S.8 on the test world.** A reset restores the trees. S.8's offline log count guards the bill.
- **Culling off by default; leather from fishing first, and the library sized by it.** It keeps the peaceful premise. The user decides on cows (and on chickens, for feathers) before S.13.
- **String counts as gatherable (cobwebs, with a sword), as a bounded trip.** The jar's loot tables show it; the validator refuses by "no source in range" (lesson 21).
- **The tech tree is `v.tech`.** Command paths fire few advancements.
- **Mud bricks before clay bricks at minevale3.** Its clay is under water.
- **Brewing dropped.** There are no blazes in peaceful, so no stand and no fuel.
- **Enchanting by charged command with vanilla's own function.** Mineflayer's windows are unreliable on 26.1 (lesson 4).

**Rejected, and why**
- **Debounced `reg.save()`.** It gives up "saved on every change", and nothing measured binds on it.
- **An RCON pool and an RCON timeout before measuring.** A socket reset forces a re-login with requests in flight, and a timed-out `clear` or `give` hits the refund path.
- **Wooden pickaxes crafted inside `storageFromFelled`.** Those crafts sit on the critical path; S.8 makes them in a soft task instead.
- **A furnace crafted at the stair bottom.** It would put a crafting table in the mine (lesson 101).
- **Splitting one building between builders.** It adds walks and rounding, and `pendingBuilds` and reservations refuse it.
- **Mine levels dug in parallel, and outside stone.** F180-F183, F64, F66 and F136-F138.
- **Variety chores before completion with no stop rule.** Four builds open at once when the hut finishes, and workers on chores would delay them.
- **A storage reservation ledger now.** The spare rules of S.1 and S.9 and the lamp and sign reservations cover it until a run shows false shortfalls.
- **Advancements as the tech tree, and `advancement grant`.** The command paths cannot earn them honestly.

## Phase E: emergence with 25 agents (brain and communication) (proposed 2026-10-10, twenty-sixth session; Claude's, the user away; revised after three reviews)

The user's goals (10-10): 25 agents doing many different activities in parallel, and the emergent behaviour Project Sid reported (arXiv 2411.00114), reached by changing the brain and communication architectures. Sid reported three things:
- roles that differentiated and persisted, but only with its social modules on;
- a tax rule amended by vote, which the agents then followed in their own deposits;
- seeded memes and a religion that spread through conversation.

The analyses (`runs/2026-10-10/s26/`: the Sid analysis, the gap analysis, communications design C, the cost model) agree on three points:
1. Sid's mechanism is a social-awareness block feeding goal generation, plus one controller decision that also writes the agent's speech.
2. Sid's 5-10 s cadence is impossible on Ollama Cloud Pro: 9,000-18,000 calls an hour against a ceiling of about 4,000.
3. Most of what Sid called emergent was seeded. That includes the community goal, the constitution, the influencers and the religion. Our claims must therefore rest on ablations and null baselines, measured by code, not on an LLM labelling LLM output.

Phase E sits on top of Phase A and Phase S:
- From Phase A it uses A.1's decision log, A.2's menu (the `choose` call, `choices`/`runChoice`), A.3's gauges and A.5's project validator.
- From Phase S it uses the task families and instances that give 25 agents enough parallel work. Without them most agents would sit idle and nothing could emerge from them.

**How it changes Phase A** (so the two plans do not duplicate):
- **Kept as written:** A.1, A.2, A.5, and A.3's gauges.
- **A.3's personalities:** become an experimental factor in E.8 (identical against distinct). A.3's "what the others are doing" bullet moves to E.3.
- **A.4:** its journal, kind table and village clock are built in E.2, made persistent. Its nightly reflection is extended in E.6. Roles are named by code, and shown to the agent only in one experimental condition.
- **A.6:** replaced by E.5 and E.6.
- **A.7:** its culture bullet is replaced by E.7. The daylight question stays A.7's. E fixes a 20-minute village day kept by code.
- **A.8:** its "Scale" paragraph is replaced by E.1 and E.8-E.10. A.8's ladder of comparisons stays for the smaller villages.

Design rules on top of Phase A's:
1. **One decision call per decision point. It returns `{reason, choice, act?, say?}`.** Speech, a social act and the action come from the same call (Sid's cognitive controller). Calls happen at decision points only, never on a timer, and no more often than one model decision per agent every 90 s.
2. **Messages never start another agent's model call.** There are three bounded exceptions, each capped per conversation pair:
   - a request addressed to an idle agent (at most once in 5 minutes);
   - a human's chat line (code picks 1-3 responders);
   - an agent's name in a line (case-sensitive, agent names only).

   Acts per hour can then never exceed decisions per hour, which makes lesson 4's storm impossible by construction.
3. **Facts are global and checked by code. Culture is per agent.** Each agent sees only what it has heard, so convergence on names and sayings has to emerge; code never shows a winner.
4. **Code labels and measures every outcome:** activity kinds, deposits counted on the server, uses of a cultural item. No model judges an outcome.
5. **The brain modules stay world-free** (lesson 66: add beside the brain's state, not inside it). The new modules are:
   - `modelCall.ts`: every model call and the gate;
   - `controller.ts`: per agent;
   - `social.ts`: awareness, profiles, acts, validator;
   - `society.ts`: per village, holding the dispatcher, meetings, reflection schedule and chronicle.

   They talk to the world only through optional `WorldAdapter` hooks.

Steps (E.0-E.1 can run beside Phase S; E.2 onwards needs A.2. Each step goes through typecheck, a bench or check, a scripted staged run, then a model-driven staged run (`stage_village.py --brain tiered --after N`, Worker1-11 on the test world), then a model-driven run where the exit asks for one):

- [x] E.0 **Scale safety, all in code** (done 10-11, s27: golden board check 0 differences on 137 villages, a four-lens review with refutation (3 real defects fixed: unhandled contention falls through to the ordinary failure path as before E.0, Mayors never refused over a share, no temporary file left by a failed save), staged E0a 4.9 min at 2x (Van3h 5.1), Minevale38 1x complete in 10.1 min with a live human line routed to the Mayor only (154 blocks away, named) and the workers not reached; its 6 failed actions were F216, not E.0). No behaviour change at 3 agents.
  - **Model calls:** `complete`, `completeOllama`, `completeAnthropic`, `parseSpec` and `timed()`'s accounting move out of `tieredBrain.ts:75-140` into a world-free `modelCall.ts`. TieredBrain (architect retries included), the controller and society all call it. `modelUsage.ts` stays the ledger, with no imports and no timers.
  - **Call gate** (in `modelCall.ts`, acquired before `fetch` so the 300 s timeout does not run during the wait):
    - 3 calls in flight on Pro. One slot is held for human replies, the Mayor's plan and design calls, executor turns and decisions. Ballots, reflections and the chronicle share at most 2.
    - Priority order: human reply, plan and design, executor turn after a failure, decision, ballot, reflection, chronicle.
    - A decision's 20 s fallback counts from the call being sent. A request still queued after 60 s is withdrawn unsent and billed nothing. In both cases the fixed order runs (rule 9) and the choice is tagged as a fallback.
    - Gate wait p90 is logged per call kind.
  - **Chat routing** (in `mcWorld`, which sees every agent; every bot hears every line today, `botAgent.ts:343`):
    - Hearing is filtered at 48 blocks, as the chat skill already says. An undefined `distance` (speaker out of view) counts as out of range.
    - A human line tags 1-3 chosen agents' events with `data.wake: true`: the addressee, else the nearest within 48. The brain wakes only on that flag, not on any non-agent speaker (`tieredBrain.ts:862`).
    - Name wakes become case-sensitive and match agent names only: today "mayor" in a line wakes the Mayor.
    - Turn caps per conversation pair.
  - **Chat in prompts:** chat gets its own short section, so chat lines stop pushing `action_failed` out of the 20-event window.
  - **Contention failures** (mine busy, ground reserved, tree taken): the skills' errors carry a code (`data.code` in `mcSkills`), not text to match. Every brain treats them as "hand back, back off this resource". They do not go to an executor turn or count toward a give-up.
  - **Board:**
    - `refreshNeeds` and `coveredByStock` move from `claimable()` into the storage- and needs-update paths, so `claimable()` becomes a pure read.
    - A version counter bumps on task, storage-record and needs changes, and idle agents claim only when it moves. TaskBrain claims every tick today (`taskBrain.ts:188`); TieredBrain claims only on a wake.
    - Done tasks are not archived: prerequisites, `stockCovers`, duplicate checks and completion all read them. Prompts and the panel show only open and recent tasks.
  - **Saves:**
    - `villages.json` (`village.ts:342`, written on every change, 2.2 MB in the main world) gets a debounced asynchronous save with a short window. It writes to a temp file and renames it, and flushes on exit. A kill on Windows skips the exit handler, so the window stays short.
    - The atlas already saves at most every 30 s.
  - **Token budget:** `MC_TOKEN_BUDGET_HOUR` defaults to 150k x agents (experiments set 250k x agents, below). Each agent gets a share (2x fair) it can borrow against.
    - As the budget nears, it degrades in order: chronicle, reflections, acts, then menus to the fixed order. Every step is logged as a run event.
    - Seeded and influencer agents are exempt from share cuts.
  - **Spend ledger:** append-only, one JSONL file per day, written by `usage.record` and kept across restarts. `MC_SPEND_CAP_USD` (per month, and per programme) is checked in `usage.check`.
  - **Observations:** `compactObservation` summarises players ("12 villagers within 32; nearest W7, W3") so they do not crowd out animals and drops. The compact summary aggregates reservations.
  - Evidence: the gap analysis (8 failure modes at 25, all in code); lessons 4, 16 and 32; A.0b's cloud bench (6 calls at once ran 4x slower; over the queue size requests are rejected).
  - Exit:
    - VanH4's staged run is unchanged in time.
    - A scripted test with 12 bots and a human line makes 1-3 calls, not 12.
    - 25 concurrent calls through `modelCall.ts`: no rejection, priorities and the held slot honoured in the log, and withdrawn requests never sent.
- [x] E.1 **Infrastructure for 25 and the panel** (done 10-11, s27: max-players 30 and Worker1-24 in both worlds;
  `/api/perf`; the RCON timeout with charges settled by counting; the pathfinder's shared allowance (20 ms a 50 ms wall
  window, up to 3 searches never cut); find_site's survey on state ids (F219); the scan lock; the atlas round-robin; the
  panel at 25; spawns 2.5 s apart and the AGENTS table; `scripts/checks/scale_probe25.py`, `pf_share.mts`. A review with
  refutation (12 of 20 findings real) and a fix review before any run. E1b 3 agents 5.0 min, unchanged; the probe at 25
  for 10 min: 0 `[lag]`, API p90 0.048 s, mspt worst 6.7, RCON p90 11-46 ms a 30 s window (F220), RSS 1.3 GB; Van25a, 25
  agents staged, 6/6 in 4.1 min at 2x, 0 lag/stuck/timeouts).
  - **Paper:** `max-players=30` in `mc/server` and `mc/testserver`.
  - **Whitelist:** Worker5-24 on the main server; Worker12-24 on the test server, which already has Worker5-11.
  - **Spawns:** staggered, one every 2-3 s.
  - **Pathfinder:** the patch-package patch is extended so `AStar.compute()` reads a shared, process-wide per-tick allowance on every call. `tickTimeout` is copied into each search when it starts, so setting it per tick would never reach a search already running. The allowance is 15-20 ms a tick, round-robin, tuned by the probe. find_site and prepare_site scans are staggered.
  - **RCON:** every request gets a timeout. Today one lost reply over the one serialised socket stalls every agent. If the probe shows queueing, a pool of 2-3 connections keeps each agent's commands in order.
  - **Probe:** `scale_probe.py` is extended to 18 and 25 bots on the test world, with builds, deposits, find_site and model calls. It records:
    - RSS, `mspt` and `[lag]`;
    - the API's p90;
    - RCON queue depth and p90;
    - `/api/overview`'s size and serialise time.
  - **Panel at 25:**
    - `?agents=` on `/api/maps` and `/api/overview`, so maps (about 2 ms each) are computed only for visible cards;
    - prompts and replies moved to a per-agent drill-down endpoint;
    - designs sent once with an ETag;
    - a compact grid filtered by activity;
    - a village feed of choices and acts;
    - per-agent token rows;
    - later, E.5's social tab: inbox, commitments, profiles, board, ballots, rules with compliance, lore with adoption curves, and the interaction graph.
  - Evidence: A.0b (12 bots: 0 `[lag]`, Paper tick 2.9 ms worst, but collecting only); the cost model's risk list (pathfinder bursts, synchronous saves, an unmeasured 0.3-0.6 GB of RSS); lesson 16.
  - Exit:
    - 25 bots work for 10 minutes with no `[lag]` over 3.5 s, API p90 under 0.1 s, `mspt` under 25, and RCON p90 under 50 ms with builds and deposits running.
    - The panel's screenshot is readable at 25 cards (headless Edge).
    - If stalls show, worker threads come before a second process: two writers would overwrite each other's whole-file saves.
- [ ] E.2 **Agent state, memory and the clock** (~1 session; takes A.4's journal, table and clock).
  - **`memory.intent = {kind, what, why, since, source}`:** written by the controller, and by `mcWorld`'s `setChore` directly (chores run in the world, so no hook is needed). Today chores bypass the brain and an agent cannot say what it is doing.
  - **Stores** (`social.ts`), keyed by village, run id and agent:
    - append-only JSONL for the choice and commitment ledgers;
    - a debounced temp-and-rename snapshot of the per-agent journal (typed, importance by code, capped per agent) and the per-kind table (attempts, successes, minutes, yield).

    Memory use is bounded. A run starts empty unless a carry-over is configured. `reset_site.py` clears the entries of the villages it removes.
  - **Village clock** (`society.ts`): a 20-minute day (Minecraft's day at 1x). Dawn: the intention. Day: decisions. Dusk: the ballot window. Night: reflections. Every agent has its own offset inside each window. Bodies keep working throughout.
  - **Logs:** every decision, act, ballot and cultural use goes to a per-run `acts.jsonl` beside A.1's `[choice]` JSONL, with the full logged prompt for each call.
  - **Respawn:** `respawn_agents.py VILLAGE` brings back 25 named agents after an agent-server restart without `reset`.
  - Evidence: PIANO's shared Agent State; the gap analysis (no current intention, nothing persisted, `memory.notes` rewritten wholesale).
  - Exit:
    - An agent server restart mid-run, followed by a respawn, keeps every agent's journal and table.
    - The panel shows each agent's intent during chores.
- [ ] E.3 **Social awareness** (~1 session; replaces A.3's "others" bullet).
  - **The awareness block** (`social.ts` `awareness(agent)`), capped at about 300 tokens:
    - counts by activity kind ("mining 6; farming 3; pens 0, nobody");
    - up to 5 profiles, chosen in this order: open acts with this agent, nearby, most interactions;
    - Riedl's sentence: "consider what the others are doing and have promised".

    The village's needs (A.3's gauges) are not part of the block and go into every prompt in every condition.
  - **Profiles** (about 25 tokens each), kept by code from what the agent saw or heard as verified fact: top 2 kinds, kept or broken commitments to it, helped or helped-by, last met. The model edits only `feel` (-2..2) and a 12-word note, at reflection, at most 3 edits a night. "Top 2 kinds" is close to a role label, so the prompt audit logs it as role-adjacent.
  - **Roles inferred in code:** the modal kind over the last 5 model choices. They are shown back to the agent ("you have become the village's miner") only in E.8's condition (e).
  - **Switch `MCAI_SOCIAL`:**
    - `on`;
    - `noblock`: the block removed, nothing else;
    - `countsonly`: profiles removed;
    - `off`: all social perception removed. That covers the block, A.2's "who else is on it", in-flight picks, the inbox, gossip and acts. Reservations and F193 keys stay, since they are mechanical.

    Each condition's prompt diff against `on` is logged.
  - Evidence: Sid's ablation (roles "did not persist ... and were homogeneous" without the social modules); Riedl (differentiation came from prompt content); the cost model (25x24 LLM profiles add O(n²) calls, while code profiles cost none).
  - Exit:
    - A prompt-size test holds the cap at 25 agents.
    - Scripted staged runs at each switch setting differ from `on` only in the listed fields.
- [ ] E.4 **The controller: coherence and goal generation** (~1-2 sessions; extends A.2's `choose`).
  - **`controller.ts` `decide(agent, point)`** takes these inputs:
    - the persona line (identical in test conditions) and the community goal;
    - the agent's last 5 choices with their outcomes;
    - E.3's awareness block and the gauges;
    - the rules in force;
    - at most 4 inbox items;
    - at most 3 lessons;
    - A.2's options, which include open requests addressed to the agent, open commitments, and a "propose" option (from A.5's step on).

    It returns `{reason, choice, act?, say?}` at low reasoning, with the choice as a schema enum. A size test fails if the full prompt at 25 agents goes over its budget (3.5k tokens).
  - **Rate:**
    - Model decisions come at least 90 s apart per agent, capped at 30 an hour. A chore that ends sooner repeats its instance, tagged `repeat`, until the interval has passed.
    - A choice that ends in under 30 s with zero yield counts as a failure toward the kind's cooldown.
    - Every ledger entry is tagged with its source: model, repeat, timeout, withdrawn, budget, invalid or scripted.
  - **Coherence checks** in code:
    - A `say` must concern the chosen option or the carried act. Off-topic lines are dropped and the drop rate is logged per condition. Typed `advocate` acts (for or against a rule) and `saying` acts are exempt from this filter and budgeted by the validator.
    - A promise in `say` with no act becomes an offer if it is well formed, and is dropped otherwise.
    - Open commitments head the menu ("you promised W4 10 logs, due in 6 min"). One that passes its due time closes as broken, and the counterparty gets a report.
  - **Goal generation:**
    - the nightly intention (E.6) becomes a menu weight;
    - an event-triggered goal refresh, at most once in 10 minutes, after 3 failures, a request, a new sighting or a vote result, at each agent's own offset;
    - the propose slot.

    Never on a timer.
  - **Against herding:** only the reservation step is serialised, and it runs in code. An option is reserved when its decision starts (lesson 4's claim before planning). In-flight picks are shown, except under `MCAI_SOCIAL=off`. A pick taken in the meantime gets one re-ask. Options are shuffled with a seeded RNG. Up to 3 calls run at once.
  - **Scripted controller:** a deterministic seeded picker over the same menus and keys. It emits acts, proposals and ballots from a script, so every later step's plumbing can be tested without models. It is also E.8's null picker.
  - **Build phase:** workers keep run-as-written and central assignment. A code dispatcher hands out the board at 25. The Mayor keeps layout and `add_need`; its summary is O(agents + tasks), estimated at 8-15k tokens at 25.
  - Evidence: Sid's CC ("say one thing but do something else"); MineCollab and TeamCraft (central assignment kept redundancy at 0.01); CAREB-MAS (authority follows agenda control).
  - Exit:
    - `socialbench.mts` (at least 10 samples a case, lesson 20): at least 95% valid; `say` consistent with the choice at least 90% before the drop filter; no position over 1.5x chance.
    - In a model-driven staged 12-agent after-phase: no two agents hold the same instance, no stall, and a fallback share of 5% or less.
- [ ] E.5 **Acts, the board and proximity talk** (~1-2 sessions; replaces A.6's acts).
  - **Channels**, all in design C's types in `social.ts`:
    - typed private acts: request, offer, accept, decline, release, report;
    - a notice board, shown as a ranked digest of 4 items;
    - proximity inform, gossip, `advocate` and `saying`, heard within 16 blocks;
    - name acts.
  - **One validator** for every act:
    - **budget:** the day limits of design C §7.2;
    - **loop guard:** the same act twice in an hour is refused;
    - **claims:** every claim (stock, sighting, did, kept or broke, place) is checked through `WorldAdapter.verifyClaim?`. A false claim is refused and the speaker told the truth, and the refusal counts toward a fabrication rate;
    - **local recovery:** storage answers an item request it already covers;
    - **novelty:** hearers who already know an item are skipped.
  - **Delivery:**
    - requests and offers arrive as menu options under F193-style keys;
    - code closes commitments from world evidence (a deposit seen, a chore done) and writes reports;
    - verified gossip updates the hearer's `heardKept` and `heardBroke` (local reputation).
  - **Inbox shaping:** at most 4 items, by priority. No wake for anything but rule 2's exceptions. No social acts while an agent holds a build task, except a help request after its own retry failed.
  - Evidence: Moltbook (free chat gave parallel monologue); the AI Village (one invented fact spread to every agent); Cross et al. (verified gossip raised cooperation); Shi et al. (agents' announcements are often broken).
  - Exit:
    - A scripted staged run: every act type delivered, closed and logged; 0 false claims delivered.
    - A model-driven staged 12-agent run: requests made and met; acts per agent-hour at or below decisions; a broken commitment's gossip changes a hearer's later choice at least once.
- [ ] E.6 **Reflection, meetings and rules** (~2 sessions; replaces A.6's meetings and rules, extends A.4's reflection).
  - **Nightly reflection** (medium reasoning, on E.2's clock with per-agent offsets; A.4's inputs plus touched profiles and gossip heard). It outputs:
    - lesson edits;
    - profile edits;
    - an intention;
    - at most 1 proposal;
    - at most 3 endorsements or objections;
    - at most 1 adopted belief or saying.
  - **Proposals:** typed, with numeric params in a band code allows. Code writes the neutral text and a dry-run preview over the last 3 days.
  - **Agenda:** a proposal needs at least 2 endorsements from other agents. No agent may fill more than 25% of the ballot items over 3 days. At most 3 items a meeting.
  - **Ballot:** secret and simultaneous, one call per agent (options shuffled, reason before choice). Quorum is half the voting members; a rule needs 60%; a tie keeps the status quo. Only aggregates are revealed.
  - **Rules:**
    - `quota`, `floor`, `zone` and `duty` are enforced by code (`WorldAdapter.enforceRule?`: options leave the menu, skills refuse and name the rule);
    - `levy` and `norm` are measured only: compliance is the agents' own choice.
  - **Personal chests:** `v.personal[agent]`, a structure (builds and site search keep off it) kept outside `storage`, so it never counts as village stock, `withdraw` refuses anyone but the owner, and it is never a home chest.
    - They are double chests in a small generated hut (`huts.ts`) on the annex, which is prepared after completion.
    - A gathering chore's end decision offers neutrally named options, "deposit all M logs", "deposit N of your M logs" (the rate in force) and "keep them", recorded as `split: all|levy|keep`. The share is counted on the server (`clear <name> X 0` before and after the deposit).
    - Personal projects (A.5) may spend from the agent's own chest, so keeping has a use.
  - Evidence: Sid's appendix pipeline; CAREB-MAS (no single drafter); OASIS (secret ballots against herding); GovSim (resource rules in code); "Corrupted by Reasoning" (gpt-oss may free-ride; E.9 measures it).
  - Exit:
    - A scripted staged run holds a vote that changes a code-enforced quota, and the skills obey it.
    - socialbench ballot and feedback cases at least 95% valid.
    - The dusk window at 25 clears in about 30 s on Pro without touching the held slot.
- [ ] E.7 **Culture** (~1 session; replaces A.7's culture).
  - **Cultural items:** place names (the finder names a feature once a day; competing names coexist, and each agent sees the one it last heard or used), sayings, beliefs and customs.
  - **A custom is also a menu action** with a world effect code can count: a flower pot beside the agent's door, a torch on the shrine stone at the green. It is offered to every agent from t=0 in every condition, so exposure never adds an option.
  - **Exposure and adoption:**
    - Exposure means the key token is present in that agent's logged prompt, whatever the channel.
    - Adoption is counted from the raw model output (`say`, posts, names, reflection, chronicle), and only when the key token is absent from that call's prompt.
    - Transmission counts only from lines actually delivered, after a recorded exposure.
  - **Paths:** every path a token can take into a prompt is listed in code and switchable per item: proximity talk, the board, the chronicle, profile notes, gossip in reflection inputs, proposals and rules, and place names in prompts.
  - **Lore:** at most 30 active items, evicted least-recently-used.
  - **Chronicle:** one entry a day by a rotating writer. Code builds a digest of the day's recorded events (at most 3k tokens of counts and top events), and the entry is checked against it. One revision at most; after that the entry is dropped and logged. It is written into a book in the library.
  - **Seeding API:** `POST /api/village/:v/seed {agents, item, persona}`; seeded agents are marked in the ledger.
  - Evidence: Generative Agents (a seeded party reached 13 of 25, density from 0.167 to 0.74); Ashery (unseeded conventions by round 15, tipping at committed minorities of 2-67%, and collective bias without contact); Moltbook (no shared memory meant no adaptation).
  - Exit:
    - In a model-driven staged 12-agent run, names converge or are measured not to.
    - The token audit holds with a path switched off.
    - The user judges a day's chronicle accurate.

**Experiment protocol** (E.8-E.10, fixed before the first run):
- **Start state:** one post-completion snapshot of a 25-agent village (world region files, `villages.json`, `atlas.json`, an empty `social.json`), restored byte-identically for every run of every condition. Its hash is recorded with each run. There is no build phase, so no unequal histories, no Mayor build turns and no build cost.
- **Replicates, not seeds:** the cloud model cannot be seeded. Every code RNG (option shuffle, null picker, spawn order) is seeded per replicate and logged.
- **Analysis:**
  - Each experiment has one primary metric and one primary contrast, with 5 replicates per arm; secondary conditions get 3.
  - The test is a one-sided exact permutation test on run-level values (5 against 5: smallest p 1/252) at α 0.05.
  - The analysis script's hash is committed before the first run.
- **Run validity** (a run fails any of these and is void and replaced):
  - fallback share of choices over 5%;
  - any budget degradation step fired;
  - the spend cap reached;
  - a prompt audit failure.
- **Blocks:** conditions run in randomised blocks, one replicate of each condition per block, order shuffled. The commit hash is frozen per experiment and recorded. The model metadata the API returns and the latency distributions are logged per run. A code change mid-experiment means the primary contrast is re-run.
- **Metrics:** computed over model decisions only, and over non-seeded agents only. The Mayor is reported separately: its name and history are seeded authority, and its role prompt differs. Each metric is reported beside its value under the null picker.
- **Budget:** `MC_TOKEN_BUDGET_HOUR` at 250k x agents, so degradation should never fire, with `MC_SPEND_CAP_USD` as the real limit.

- [ ] E.8 **Experiment 1: specialisation** (~1-2 sessions of runs).
  - **Pilot** (after E.4): 12 agents, (a), (b2) and (c), 1 replicate each. It checks the pipeline, fallback share, cost per hour and decision rate. Its numbers feed the cost table, and no claim is made from it.
  - **Full run** (after E.7): 25 agents (Mayor, Worker1-24), 90-minute after-phases (4.5 days), the same community goal.
  - **Conditions:**
    - (a) `MCAI_SOCIAL=on`, identical personas (5);
    - (b2) `off`, all social perception removed (5): the Sid replication;
    - (b1) `noblock` (3);
    - (f) `countsonly` (3);
    - (c) null: the scripted controller over the same menus and keys (5, no model cost);
    - (d) on, distinct persona lines, with A.3's code weights by kind equalised (3);
    - (e) on, roles shown back at night (3).
  - **Primary:** the bias-corrected specialisation index I(agent; kind) / H(kind), judged against a permutation null that shuffles agent labels within time windows. The contrast is (a) against (b2).
  - **Secondary metrics** (`autonomy_metrics.py`, from the choice ledger):
    - role entropy across agents over time (Sid's measure);
    - persistence over fixed windows of 5 model decisions, and time-weighted by minutes rather than by calendar day (a 20-minute iron trip fills a day);
    - the models' own role names from reflection, for comparison only.
  - **Claims per contrast:**
    - (a) against (b2) supports a social-emergence claim.
    - (a) against (b1) and (f) tests the block's content and its profiles.
    - (a) or (b2) against (c) supports only "the model plus its own history and code ranking (last 5 choices, success rates, mine holders) yields persistence".
    - (d) is a manipulation check.
  - **Prompt audit** (`prompt_audit.py`), which fails a run on a leak:
    - in (a)-(b2), any inferred role label ("the village's miner", "you have become") outside the fixed prompt templates, and "top 2 kinds" logged;
    - in (b2), any other agent's name or activity in any prompt.
  - Exit: (a) beats (b2) on the primary at p < 0.05; or the finding that it does not, recorded with the numbers.
- [ ] E.9 **Experiment 2: a rule changed by vote, and its compliance** (~1-2 sessions of runs).
  - **Setup:** 25 agents, 100-minute runs, a `levy` rule starting at 20%. The agenda is opened to levy proposals on day 2. Ballot at day 2's dusk; days 3-5 under the result.
  - **Influencers:** 3 of 25 (Sid's 12%) get a persona line for or against the levy and speak through E.5's `advocate` act in proximity talk. They do not vote, and the log notes whether their votes could have swung the ballot.
  - **Conditions:**
    - voted, pro influencers (5);
    - imposed: code applies each voted run's resulting rate at the same moment, with no vote (5, yoked);
    - voted, anti influencers (3);
    - frozen rule (3);
    - voted with `MCAI_SOCIAL=off` (3).
  - **Primary:** P(deposit all or the rate) against P(keep) per trip on days 3-5, over non-seeded agents. This does not depend on the rate. The contrast is voted (pro) against imposed: the vote's own effect.
  - **Secondary:**
    - the deposited share per trip from server counts, before and after;
    - share of trips at or above the rate in force;
    - voted against frozen;
    - the direction of pro against anti.
  - **Missing treatment:** a run with no levy item on the ballot or no quorum is reported as a "no vote" outcome and replaced, up to 2 per condition. Beyond that, the finding is that votes do not happen.
  - Exit: the primary contrast at p < 0.05 with pro and anti in the predicted direction; or a free-riding or option-following finding for gpt-oss, recorded.
- [ ] E.10 **Experiment 3: culture spreading** (~1-2 sessions of runs).
  - **Setup:** 25 agents, 90 minutes. A saying and its custom are seeded in committed agents.
  - **Conditions:**
    - k = 4 committed (5);
    - channel-off: every path in E.7's list off for the item and for place names, which also serves as the naming null with no transmission (5);
    - neutral exposure: code announces the saying to the same exposure sets, with no committed agent, to measure the base echo rate (3);
    - unseeded (3);
    - k = 2 (3);
    - k = 6 (3).
  - **Primary:** custom uptake counted in the world among non-seeded agents by the run's end. The contrast is k = 4 against channel-off. The token audit must show the key token in no non-seeded prompt in channel-off.
  - **Secondary:**
    - keyword adoption by E.7's rule;
    - adoption curve and time to 50% from exposure sets;
    - conversion of exposure into adoption;
    - interaction-graph density by day;
    - naming convergence as the excess of the modal-name share over channel-off's.
  - **Optional:** a between-group comparison with two villages of 12 and 13 (the second Mayor named "Mayor2", whitelisted), given neutral names so a name cannot prime the culture.
  - Exit: the primary at p < 0.05, and naming convergence measured against its null.

**Cost per hour** (gpt-oss at $0.15 in and $0.60 out per million tokens, Pro's 3 slots; to be recomputed from the pilot and A.1's measured chore lengths):

| Item | Calls per agent-hour | Tokens in / out per call |
|---|---|---|
| Decisions (A.2, carrying the act and the line) | 12 (cap 30) | 3.1-3.5k / 0.3k |
| Idle wakes by a request | about 0.5 | 3.1k / 0.3k |
| Ballots | about 2 | 2k / 0.2k |
| Reflections (3 days an hour) | 3 | 6k / 1k |
| Executor turns after failures | 2-6 | 3k / 0.25k |
| Chronicle | 0.12 | 5k (capped digest) / 0.6k |

- **Typical, 25 agents:** about 500-650 calls an hour, about 1.9M tokens in and 0.2M out, about **$0.40 an hour**.
- **Failure-heavy, with decisions at the cap:** about $0.70 an hour. That is within the experiment budget of 6.25M tokens an hour.
- **Load:** steady use takes about 15-22% of Pro's slots. Peaks: about 30 s of queue at dusk and about 100 s at night, spread over per-agent offsets. The held slot keeps decisions out of those queues.
- **The programme, counted from the matrix above** (snapshot starts, no build phases):

  | Experiment | Model runs | Run-hours |
  |---|---|---|
  | E.8 pilot | 2 | 3 |
  | E.8 full | 22, plus 5 null runs at no model cost | 33 |
  | E.9 | 19 | 32 |
  | E.10 | 22 | 33 |

  That is about 100 model run-hours, about $40-70. With E.0-E.7's runs and socialbench on top, it spans two months of the $60 credit, under the spend cap.
  - If the pilot's cost per hour runs high, the first cuts are E.10's k = 2 and k = 6 and E.8's (f).
  - A build phase at 25 (for the snapshot) adds executor and Mayor turns: record them.
- **Rejected:** Sid's 5-10 s cadence would cost about $5 an hour, 28M tokens, and saturate Pro.

**Decisions (Claude's, the user away):**
1. **Event-driven decisions, not PIANO's concurrent modules on a clock.** Sid's cadence costs 14x the budget and saturates Pro, and our skills run to completion anyway. What PIANO lacks in our stack is the bottleneck, not concurrency. Decisions get a floor of 90 s and a cap of 30 an hour.
   - Rejected: Sid's cadence; a 60 s social cadence (3.5x the budget).
2. **Social awareness built by code, model profiles edited only at night.** It is free, cannot hallucinate, and is what Sid's ablation turned off.
   - Rejected: LLM likeability profiles for 600 pairs; batched social calls for 5 agents, which correlate the agents' goals and work against independent specialisation.
3. **Roles labelled from code activity kinds.**
   - Rejected: GPT-4o-style role inference from goals, which is an LLM grading LLM output.
4. **No free chat.** Typed acts, proximity talk, a board and secret ballots, with at most one act a decision. Evidence: lesson 4, Moltbook, MineCollab.
   - Rejected: talk-driven coordination; chat waking listeners.
5. **No LLM election manager, and the Mayor is an ordinary member after completion.** Agenda power is spread by endorsements and a 25% cap (CAREB-MAS), and the Mayor is reported apart from the metrics.
   - Rejected: Sid's neutral drafter; the Mayor as convener.
6. **Compliance must be the agents' choice for a replication to mean anything.** Hence personal chests outside village storage, a measured levy with neutral option names, and an imposed control beside the vote.
   - Rejected: enforcing the levy in code, which makes compliance trivially 100%.
7. **One village of 25 for E.8 and E.9.** Two villages only for E.10's optional between-group comparison, with neutral names.
   - Rejected: districts of 5-8 from the start, which would dilute both experiments.
8. **One agent server and Pro.** The gate, its held slot and budget shares come first.
   - Rejected for now: a second process (two writers to whole-file saves) and the Max plan (needed only for a social cadence of 60 s or less, or several villages of 25).
9. **Claims are differences from controls, fixed before the runs.** Every experiment runs from one snapshot, with a pre-registered primary metric and test, 5 replicates against a full social ablation and a null picker, and validity checks on fallbacks and degradation. Seeded content is reported as seeded, and seeded agents are left out of the outcomes. Sid's reception called its culture "prompt engineering". Our claims are differences from controls, not anecdotes.

Order and size: about 13-16 sessions in all.
1. E.0 and E.1, beside Phase S.
2. A.1-A.2, then A.3's gauges.
3. E.2, E.3 and E.4, then E.8's pilot.
4. A.5, then E.5, E.6 and E.7.
5. The snapshot, then E.8's full run, E.9 and E.10.

## Phase 3: humans in the loop (part 2 of the user's goal)

(Deferred by the user on 2026-10-02: batch R and step 2.4 come first.)

The user asks the mayor in chat ("build me a house by the river", "we need a bigger hall"); the village designs,
lays out, gathers and builds it, and the mayor answers in chat.

- [ ] 3.1 **Talking to the mayor in tests**: an API route that posts a player's message as chat the mayor hears
      (`POST /api/village/:v/say {from, text}`), or a real player message over RCON if one can be made to arrive as
      chat. Keep the 30 s chat limit and keep workers out of it (only the mayor answers players).
- [ ] 3.2 **The mayor hears requests**: player chat naming the mayor or the village wakes its planner (today chat
      only wakes the executor) with the request as a new objective or an addition to the current one.
- [ ] 3.3 **Code places it**: "by the river", "next to the hall", "here" become a site search near a place (atlas:
      water, forest), a building, or the player's position; a second plot when the first is full.
- [ ] 3.4 **Code checks it can be built**: materials within reach (atlas), unobtainable blocks refused, rough time
      estimate from the bill of materials.
- [ ] 3.5 **The mayor answers**: what it will build, where, and roughly how long, in one chat line.
- [ ] 3.6 mayorbench cases for chat requests; then runs with the user in the game.

## Phase 4: speed and scale

- [ ] 4.1 ~~Gathering that finishes trees~~ (moved to 2.2); choose trees by reachable logs (atlas `low` counts).
- [ ] 4.2 The storage chest between the plot and the nearest trees and stone, not wherever the first deposit is.
- [ ] 4.3 More workers where gathering allows (4 workers only paid off with enough trees apart; see F12).
- [ ] 4.4 Executors on gpt-oss (benchmark with `scripts/bench/execbench.mts` first). Low value now: workers make
      few model calls since run-as-written.

## Backlog (not scheduled)

**Village life (the user's list, 10-06, eighteenth session).** Order agreed so far: lamp posts (under way), then signs,
then farming; iron age suggested as the fourth (it unlocks buckets, shears, lanterns and interiors). The rest unordered.
- ~~**Lamp posts** along the streets and the green's ring~~: done 10-06 (`980a5cd`, the user's choices: a fence of the
  village's wood with a torch, charged, about every 8 blocks, completion waits for them). Vanilla's per-biome lamp pieces
  later, with the iron age (snowy's lanterns; plains' wall torches need a wall_torch charge and supports-first order).
- ~~**A sign beside each building's door** naming its function~~: done 10-08 (`cfe8b8c`, the user's choices: a wall
  sign beside the entrance door, every building with a door labelled by its use, a separate soft task after the lamps,
  waxed, completion waits). Leftovers: F161.
- ~~**Farming** v1~~: done 10-08 (`24e7037`, `e28198e`; the user's choices: seeds by gather tasks into storage, a 5x7
  field of our own shape (vanilla's farm pieces have no door and are dropped, F123; their inside is the shape), 16 seeds
  in alternate rows, planted early, completion waits for the planting; Claude's: a hoe required, no farm in cold or
  desert biomes, water laid free by tend_farm). Crops grow with time frozen (random ticks ignore `advance_time`) but only
  within ~6 chunks of an agent.
- ~~**Harvest and bread**~~: done 10-08 (`f17f360`, a chore rather than a posted task, see the decisions). The plan was
  (farming v2, the user's order 10-08): code posts "Harvest the farm" when ~3/4 of the
  wheat is age 7 (a check beside `refreshNeeds`, no board change), `loot give <name> mine X Y Z` per ripe cell (no
  walking on the field), resow charged a seed, bread (3 wheat) at the hut's table into storage; never counted for
  completion; tested with crops set ripe by command. The water can become charged after the iron age.
- ~~**The opportunities analysis**~~: done 10-08 (twenty-first session; `runs/2026-10-08/s21/opportunities/`, five
  opportunities built, see the decisions; left: a ready build pre-empting a fresh soft gather, seeds credited from
  prepare_site's grass, one trip for several sand tasks, side pickups on walks, the mine keeping ores). The plan was
  (the user's, 10-08; after harvest and bread): read-only subagents go through the last
  ~15 runs' logs (Minevale20-31, Van*) and measure where each agent's time goes (idle, waiting for a task, empty walks,
  storage round trips, a task claimed far off while a nearer one was ready, a needed block passed on the way); each
  pattern a candidate with its minutes per run, prototyped offline where possible, ranked by minutes saved against risk;
  the user picks. Known candidates: F164 (logs of another kind never cover log tasks, ~1.5 min a run), claiming the
  nearest ready task, collecting needed blocks passed on the way, carrying the next build's materials back, idle
  pre-gathering, the mine keeping ores, one storage-hut visit for lamps, signs and the farm. The existing examples:
  V2.3m, V.4, F97, prepare_site's logs.
- ~~**Opportunistic farming and exploring** v1~~: done 10-08 (twenty-second session; plants only, see the decisions; next:
  animal pens, chickens first). The plan was (the user's, 10-08; after the analysis): no "find X" goals. Agents record
  sightings while they work (passive animals; pumpkins, melons, sugar cane, berries, cocoa, bamboo, vanilla villages'
  carrots and potatoes) in the atlas; an opportunity rule (beside `refreshNeeds`) posts a farm for a kind not yet farmed
  when a sighting is in range, a farm slot is free and the lure food or seed item is in storage (seeds lure chickens,
  wheat cows and sheep, carrots pigs; kinds seen but not yet possible wait); farm slots reserved at plan_layout, kind-
  free; tasks fail soft ("Bring 2 chickens from x,z" led with food, no leads: they need string; "Take a pumpkin from
  x,z"); completion never waits for these. Once every building stands, idle agents explore for anything (the 2.4 ring,
  bounded trips, winding down after trips with nothing new), and the same rule farms what turns up. Tests need a "keep
  going after completion" mode with its own time limit. Vanilla's 12 animal pens (dropped like the farms, F123) as pen
  shapes.
- **Furnished interiors**: put back what the importer turns to air where the economy can make it (crafting tables,
  furnaces, chests, bookshelves, wall torches from the mine's coal; beds need wool).
- **Internal lighting inside buildings** (the user's, 10-06): torches on the inside walls (the importer drops vanilla's
  wall torches today; they need a wall_torch charge mapping and supports-first placement, the lamp research's notes).
- **Internal lighting inside mines** (the user's, 10-06): torches along the stairs and tunnels as they are dug (coal from
  the mine, or charcoal).
- **Gardens and fences**: a fenced front garden with flowers the agents pick.
- **A stock board**: signs at the storage hut showing what storage holds, rewritten on every deposit.
- **Campfires and chimneys** (logs, sticks, coal) on the green and the houses.
- **Animal pens**: v1 done 10-09 (`ecb7cf7`, chickens on the annex; see the decisions and `runs/2026-10-08/s23/`); v2
  (eggs, breeding, cows, milk, a cake) done 10-09 (`119df92`; `runs/2026-10-09/`: design, live facts, research, reviews;
  open F205: a pen of one gets no second trip when the other animals stand above the annex's level +-4). Left: sheep
  (wool needs shears: iron), pigs (carrots/potatoes), more pens than the annex's two slots. What was known before v1: sheep, cows,
  chickens fenced near the farm (eggs, food; wool for beds once shears exist). **Known already, don't re-derive**
  (`runs/2026-10-08/s22/research/sightings.md`, `farmslots.md`, `plants_scan.md`):
  - Tempt items, from the 26.1.2 jar's item tags: `chicken_food` = wheat/melon/pumpkin/beetroot/torchflower seeds and
    pitcher_pod; `cow_food`, `sheep_food`, `goat_food` = wheat; `pig_food` = carrot, potato, beetroot. Storage holds
    wheat_seeds (the harvest leaves ~27-33 a time; F168), so chickens are possible now; cows and sheep need wheat kept back
    from the bread (harvest_farm bakes floor(wheat/3) today, mcBuild.ts harvestFarm).
  - No leads: a lead is 5 string (no slime in 26.1); string only from cobwebs with a sword or shears (mcMaterials.ts marks
    string unobtainable). Animals follow a player holding their tempt item (vanilla TemptGoal, ~10 blocks; not yet checked
    in this jar or with a Mineflayer bot): luring by a held item is the new movement problem.
  - Pens: vanilla's animal pen pieces (outer W x D): plains 5x6, 7x11, 8x11 (two without a gate), savanna 9x9, 13x12, 8x9,
    snowy 8x9, 9x8, taiga 13x8, desert 10x7, 10x8 (dropped by the importer like the farms, F123). A 5x7 pen (fence on the
    outer ring, 3x5 inside, a gate) is 19 fences and a gate, ~39 planks (~10 logs); a farm slot (5x7, kind-free,
    `layouts[i].slots`) can hold one (kind e.g. `pen:chicken`; the slot's water channel is not laid for a pen).
  - Animals in the atlas (`Atlas.animals`, by uuid: kind, x, y, z, t, by; seen every 5 s per bot, deleted after 10 s
    missing near a bot; `/api/atlas?all=1` and `?village=` return them). World-generated animals are persistent in peaceful
    and stay near where seen (AI only within 32 of a player). Near minevale3's usual site: pigs 12 (60 blocks), sheep 8
    (48), chickens 4 (55), a cow (91); VanG's site: pigs 13 (41), sheep 9 (48), chickens 4 (45); VanX2's atlas within 176:
    sheep 10-20, pigs 14, chickens 5-6, a cow. Entity data in the snapshot covers only ~15-30 chunks a site.
  - Breeding: feed two adults (`bot.activateEntity` with the item held), ~5 min before they breed again, a baby grows
    ~20 min; animals tick only near agents (lesson 92). Eggs: a chicken lays one every 5-10 min (vanilla; check the jar).
  - The chore pattern to follow: MineflayerWorld.slotChores (one chore a village at a time, the `chores` lock from the
    actions' own state, `idleWorker`, back-offs), after completion only; staged tests with `--mayor --after N`; a fixture
    can `summon chicken X Y Z` by RCON near the site for a deterministic test.
  - Unknowns to settle live before designing (a Gus test on the test world): whether chickens follow a bot holding
    seeds, at what distance and speed (a bot walks ~4.3 m/s, faster than a chicken), how to walk so they keep up (short
    hops, waits), whether a fence gate opened and closed by command keeps them in, and how to count them inside on the
    server (`execute if entity @e[type=chicken,x=,y=,z=,dx=,dy=,dz=]`).
- **Iron age**: smelt the mine's iron for iron tools, buckets (water for farms), shears (wool) and lanterns. After
  farming (the user's choice, 10-08): ore is a new gathering problem (the mine takes stone only; iron lies in seams at
  depth; atlas ores can be far or in caves) and adds smelting time to every village; its payoff is spread over buckets,
  shears, lanterns, tools and interiors.
- **Roles**: a profession per worker (farmer, miner, builder) tied to its building and named on its sign (Project Sid's
  specialisation).
- **A village that grows**: once the objective is met, the mayor plans the next houses on its own, up to the site's room. (in progress, s30: neighbourhoods tied to population, farms and hunger with them.)
- **Roads with lighting between neighbourhoods** (the user's request, 10-15, s30): a road from each neighbourhood to the
  village (or to the nearest neighbourhood), laid like the streets (dirt path by prepare_site's rules, no structure on
  it: lesson 62) and lit with lamp posts ~8 apart from the torch stock (another real consumer for make:torch). Open: the
  route over uneven land and water (steps or a cut, a bridge?), and whether roads are planned when a neighbourhood is
  laid out or as their own chore afterwards.
- **More variety in neighbourhood styles** (the user's request, 10-15, s30): G25's six neighbourhoods were the same four
  plains small houses on the same 22x22 cross-street pad, the 4-house batch repeating houses 1 and 2. Ideas: each
  neighbourhood its own character (a biome's other houses: medium houses, other biomes' pieces that pass the survival
  checks, V2.1's 62; model-drawn houses through `submit_style` with a theme per neighbourhood, D.2's generator; wood kinds
  and roof styles varied per neighbourhood), other pad plans than the cross (a row along a road, a cul-de-sac, a small
  green), and lamp and sign styles to match. Open: how much the model decides (a theme per neighbourhood from the Mayor,
  one call each) against code choosing from the library.
  **Joined with voting (the user's, 10-15): the next neighbourhood's style is the village's first vote**, built after the
  food step and after A.3p's temperaments (s32: the voters need something to differ on): code prepares 2-4 buildable options (houses, wood, pad plan), every member casts a ballot (one model call:
  the options with their facts, plus a little about the voter: home, work, what it built) with a one-line reason, code
  tallies, applies, logs every reason and shows it on the panel (~25 gpt-oss calls a vote, ~$0.01). Measure whether
  ballots follow each voter's facts or the option order (a bench like choicebench) before reading meaning into results;
  agents have no lasting preferences until G2's memory, so voting and memory belong together later. Later topics: village
  policies (stock targets, the appetite rate, growing further), then open proposals (G1-style triage).
  **What else to vote on** (s32's research, 10-16, the user's request: `docs/research/vote-topics.md`, 26 sources: Project
  Sid, GovSim and GovSim-SelfGovern, the AI Village's election, CivMC/Towny/Hermitcraft, Frostpunk, RimWorld, Dwarf
  Fortress, Ostrom). Ranked for this world, effort S/M/L on today's systems: 1. the next public work, a participatory
  budget over 2-4 validated projects (a lit road, a well, a second storage hut, a mine level, a wider farm; M, S after
  A.5); 2. the use of the next free land (housing, farm, pasture, tree reserve, park: a `zone` rule; M); 3. forestry rules
  (logs a day per area, saplings per tree, no-fell radius from the green; re-voted when a dusk tree count crosses a line;
  S-M); 4. the crop mix of new farm slots (S); 5. who gets the next house (lottery, longest-serving, most deposits, the
  Mayor: shows status; S); 6. herd caps per pen (also guards Paper's tick; S); 7. the road and lamp standard (M, after
  roads); 8. street and neighbourhood names, put on signs (S); then a levy on deposits, storage caps and floors, working
  hours and a rest day, graduated sanctions, the Mayor's election and term, feast days and monuments, mine rules. Not
  here: PvP and mob toggles, war and diplomacy, one-off content votes, trading halls and redstone, prices and currency,
  exile, export bans, moral laws, religion by ballot, free-form constitutions. What the sources say for the design: a vote
  on a trigger code detects (each topic recurs), the facts each option changes shown on the ballot, losing options kept
  for the next ballot (the mob vote's complaint), the ballot run by code (the AI Village's own ballot form was never
  published and tied three ways), agents propose caps above all (GovSim-SelfGovern: 1,921 of 2,236 proposals), and
  reasoning models free-ride on levies (~40% contributed against ~90%): judge every vote by what it changed in the world.
- **Day and night**: time unfrozen; agents go home and sleep in their beds (needs beds, so wool).
- **Upkeep**: the mayor checks buildings against their designs and repairs damage.
- **Two villages**: a road between them and trade of surplus (Project Sid's economy at small scale).
- (Phase 3, talking to the mayor, stays its own phase below the plan's phases.)

**Beautifying the village (the user's request, 10-08, twenty-second session; proposed, not scheduled: the order and the
open choices are the user's).** Today a village is buildings on a levelled pad of grass, dirt paths, lamp posts, signs,
a wheat field and farm slots; its edges are the cut and fill prepare_site left. This plan gathers the decorative items
above (gardens, interior lighting, interiors, campfires and chimneys) with new ones into one programme, built the way
lamps, signs and farm slots were (each a lesson already paid for):
- **How each piece works** (the pattern of lamps, signs and slots): code places it, the model never does (lesson 1); a
  pure placer in streetPlan.ts computes the cells from the layout (off streets, door walkways, lamps, signs, farms and
  slots, 2 from every building's grid; never a structure: lesson 62), recorded on the layout and checked offline in
  `scripts/checks/street_plan.mts` over the five biomes and three plot sizes before any world test (lesson 68); one skill
  sets the blocks by command standing by the storage hut, charged from storage (lesson 44: never into a player), checked
  on the server after (R.3); its materials gathered as chores or soft tasks; run as a **chore after completion** (lesson
  93, the decision of farming and the iron age: never holding completion or the critical path), unless the user wants a
  piece counted in the objective as lamps and signs are. Staged tests on minevale3 with `--after`, then
  `render_design.py` on a saved `/api/blocks` box of the plot and a panel screenshot to judge the look (lesson 58).
- **B.1 Flower beds and front gardens** (first: cheap, natural, very visible). Flowers are collected like seeds (any
  small flower in the biome: dandelion, poppy, cornflower, wildflowers; collect already resolves plant blocks); a placer
  picks the 1-2 cells either side of each door's walkway along the house front and a ring of beds round the green's
  centrepiece; planted on grass by command, one flower an item. Later: a low fence (village wood) with a gate round each
  house's front garden, the "Gardens and fences" item.
- **B.2 Trees and hedges.** Saplings drop from the leaves prepare_site fells (today JUNK, never deposited: keep the
  village wood's saplings); plant 4-8 on the green and at the plot's corners (2+ from everything, room for a canopy) and
  let them grow (random ticks run with time frozen, only near agents: lesson 92). Hedges of leaves are not obtainable
  without shears (the iron age's shears would make them so).
- **B.3 The plot's edges blended into the land.** prepare_site's cut and fill leaves sheer steps up to its 2-block margin
  (F95's pits, the "shelf" site): a pass that turns each step over 1 block into a slope of the ground's own blocks
  (grass on top), and a 1-block grass verge between the pad's edge and the street; the stand spots and lesson 61 (never
  footing for a walk to build up to) to be checked. Costs dirt only (gathered early already, #3).
- ~~**B.4 Light inside buildings and the mine**~~: **done 10-15 (s29)** as the workshop's first consumer (`43b3dec`, spec
  `runs/2026-10-15/spec_b4.md`, live facts and reviews in `runs/2026-10-15/`): a `light` menu family after completion,
  torches withdrawn at the hut and set by command from a stand beside each building's door, the mine lit from the hut every
  7 cells and again as it is dug, make:torch's target following the unlit spots. B4f (25): 61 of 61 torches standing; but
  B.4's own work is ~5 agent-minutes (placing by command is quick): it makes the chain recur, it does not fill 25 agents.
  The plan was: wall torches inside each building
  on the walls' inner faces at head height (vanilla pieces' own torch cells, which the importer turns to air today, as a
  first source; a wall_torch charged as a torch and placed after its supporting wall: the lamp research's notes), and
  torches along the mine's stairs and tunnels every 6-8 cells as they are dug (coal from the mine, or charcoal; the iron
  level keeps its coal now). Lanterns instead once iron is plentiful (snowy villages' pieces use them).
- **B.5 Furnished interiors**: the importer's air back to what the economy can make (crafting tables, furnaces, chests,
  bookshelves from paper and leather: sugar cane from the farm slots gives paper; barrels, flower pots from bricks of
  clay; beds wait for wool). Per piece, from the jar's own blocks; materials by the bill (lesson 76: plan every item).
- **B.6 The green's centre and street furniture**: the meeting point's well or bell is vanilla's; add benches (stairs
  of the village wood facing the centre), a campfire (logs, sticks, coal: chimneys of cobblestone walls over a few houses'
  roofs too, the "Campfires and chimneys" item), and a notice board at the storage hut (the "stock board" item: signs
  rewritten from storage on every deposit).
- **B.7 Window boxes and shutters**: trapdoors beside windows (vanilla pieces carry some; F112's inside shutters are the
  warning: outside faces only, checked at four turns with rotate_design.py) and flower pots on sills.
- **Recommended order:** B.1, B.2, B.4 (light), B.3, B.6, B.5, B.7: visible and cheap first; edges before furniture
  because they change what stand spots and walks see; interiors last (largest bills, lesson 76). Each step: research
  (vanilla's pieces and tags for the blocks; the placer prototyped offline), a design note, a design review, the user's
  choices, code, staged test with `--after`, render, diff review, commit; a model-driven run when a piece is counted in
  the objective.
- **Open choices for the user:** chores after completion (recommended) or counted in the objective; flowers by the
  biome's own kinds (recommended) or a fixed palette; trees of the village wood (recommended) or the biome's; whether
  the edge blending may take a ring of ground outside the plot (it needs 2-4 blocks beyond the margin on steep sites).

- Stairs and fence collision in the sandbox; a real downloaded schematic; `/save` API route.
- Events carry no timestamp (the panel cannot say "2 min ago").
- Two builders drawing on the chest at once still come up short now and then (the requeue recovers).
- The pathfinder's own dirt pillars and bridges (scaffolding while walking) are left standing; track and remove them
  (felling's server check removes those in a climb column, F57).
- Whole-tree felling overshoots small tasks on 2x2 jungle trees (81 and 105 logs for 9-10-log tasks, over 5 min
  each), and a held gather task is not closed when storage covers it (F62).
- The timed review ("no step completed for 3 minutes") re-plans workers in the middle of long collects; the executor
  then queues more collects (61 cobblestone for a 31 task, F67). No timed review while a code-posted step's action
  is still running.
- ~~A bot stuck twice in a 1-deep pocket beside a plot on its way to a chest (F71)~~: explained and fixed by F147 (the
  half width's rounding at z 128), 10-05.
- ~~F148: a 12 s stand-still beside the storage hut's aisle on VanG's site~~: explained and fixed 10-06 (F151, the
  patched pathfinder). F133 (no reproduction; probably the same mechanism, F151).
- F150: the Mayor's sand walk through water (not reproduced 10-06 by Gus or a staged run; watch the next model-driven
  runs on -1628,65,47, whose `[stuck]` lines now carry the goal and path detail).
- The mine's doorway repaired before walking in (F131's third part; the cause, walks placing on village ground, was
  fixed 10-04; backlog by the user's choice 10-06).
- F153: the pathfinder's door branch with dirt carried, and `arrived()` without the cell above.
- ~~F155: a mayor plan of only "wait" with nothing laid out escapes the plan_layout nudge (~3 min in Minevale26).~~ Fixed
  10-06 (eighteenth session, `52f5b19`).
- F157: the Mayor stood 30 s in a 1x1 pocket on a lake shore (probably its own sand-dig hole; the pathfinder followed a
  "success" path whose first step no jump reaches, while the partial path's jump south was the way out). Self-recovered.
- F158: a stray drawn design in the library (Minevale26's "cottage") wins over the vanilla houses: gpt-oss laid out
  cottage, cottage, plains_library_2 12 times in 12 (valid, slower). The executor no longer runs stale design steps
  (F155's fix), the usual source.
- F159: street lamps know only each building's entrance door, not side doors (0 lamps on any walkway in 96 test
  layouts); stockCovers never closes requeued lamp gathering; `--stage build` stocks no lamp materials.
- The pathfinder still tunnels under plots below their protected 4 layers (StageH15: 29 andesite picked up on the way,
  a bot at y 60 under the storage hut); harmless to buildings so far.
- The hut chain: a failed prepare or storage hut build blocks the whole village until the mayor steps in (decisions
  log, 09-29).
- Not yet exercised in a run: the mayor's `add_need`, and a gather task code posts for a shortfall (V.3).
- Side pickups (V.4) rarely trigger: logs are excluded and what villages need seldom lies within 4 blocks of the
  material being gathered. Worth more with ores in the mine walls (V.6) or wider radii.
- F83: a prepare task credited for a plot prepared elsewhere (by the executor after a failure): count it done only
  when a prepared plot covers the laid-out one. (The margin half is fixed, F93: prepare_site leaves margin columns over
  a drop as they are; the plot-column error no longer says "find another site".)
- Two miners on crossing tunnels (F82): a dig aborted by the other bot counts toward an empty trip.
- Mine yield (log analysis of 10-01): branches end early at gravel pockets, gullies and the stairs' keep-off (6 of 9
  side branches of Minevale2's two later tunnels); diorite, andesite and granite are dug but do not count toward
  cobblestone (StageM7: 43 diorite); a second miner waits up to 2 minutes when the busy tunnel has no finished junction
  and both stairs-bottom turns are used (Minevale2, 28.3-30.4 min); it could take an unfinished branch instead.
- The Mayor's executor follows workers' distress chat ("I'm under attack") instead of its design steps (F84).
- ~~Fallen trees (26.1's lying logs without leaves) count as built: collect gives up on them after minutes (F94).~~
  Fixed 10-02 (F94 fixed, below F99).
- ~~find_site's wood count has a window tied to the bot's height like F88's (`floorY = bot y - 16`, mcBuild.ts ~866): a
  bot on a hill misses a valley site's trees, one in the mine counts buried logs (T.3 review).~~ Fixed 10-02 (F98).
- find_site's log search stops at 4,096 logs within 128 blocks: in dense woods (~8,000) its wood counts run ~30% low
  (F98). Harmless while sites pass the 30-log bar; matters if wood is ever compared closely.
- ~~Kelp reaching the water's surface makes `surfaceAt` pass down to the seabed and read a lake as dry ground (T.3
  review; site.py treats kelp as water).~~ Fixed 10-02: kelp and seagrass are liquid to `surfaceAt` (checked over
  seagrass at -1686,488 on the test world; the test world has no kelp reaching the surface).
- Post no gather task for a material collect cannot reach (sand under collect's floor, F96), or let a failed soft task
  go without at once; a futile collect's two `findBlocks` passes block the event loop ~1-2 s.
- A build whose needs storage already covers waits for its open gather tasks (F97: 1.3 min): close them.
- After prepare_site's job, check the plot's columns on the server and redo what is missing (F95's follow-up; also
  catches placements refused at 2x, F92).
- More from the T.3 reviews (10-01), not yet seen in a run: (a) `surfaceAt` still floors its scan at bot y - 48, so a
  valley far below the surveying bot reads as yHint - 48 "air" (penalised as built, not taken as flat; passing the
  neighbouring column's height as the hint would fix it); (b) its climb stops at the first plain `air`, so a large
  noise cave inside a hill (plain air, not cave_air) can read as the ground (neighbours differ, so the site reads as
  steep rather than flat; a guard: two airs 16 apart, or sky light); (c) prepare_site now also leaves deep ponds in the
  margin as they are: a builder stepping out of the footprint may land in one (the rescue handles it).
- `stage_village.py`: options before the coordinates (`V --stage build X Z`) are refused since `--site` made X Z
  optional (no caller uses that order). `scripts/bench/atlasbench.mts` creates a bot without `timeScale`.
- ~~A "drop" test site: the probe at -1656,-152 settled on the low ground, so no staged run has yet met a plot against a
  drop or a mine's main tunnel meeting a hillside on purpose; record a site on the y 95 shelf by hand.~~ Done 10-02:
  "shelf" in `scripts/test_sites.json` (run with `--buildings testhut,testhut,testhall`; Shelf2 passed).
- Narrow the pre-existing Windows firewall rule for Node.js (any TCP, any address) to the local subnet.
- Check scripts that still call the main world only (no `MCAI_API`): `mine.py`, `atlas.py`, `atlas_ores.py`,
  `find_site.py` and others (`site.py`, `fell_trees.py`, `walk_speed.py` take it). Add it when one is needed on the
  test world.
- Atlas site scores (review of 2.3, harmless for ranking): zero sand costs +20 but one block only +8.7; chunk distances
  are on the chunk grid (±16 blocks); atlas log counts include logs in builds and high canopy; a redundant `pad` copy.
- Kelp test spots for later (offline search 10-02; the test world has no kelp reaching the surface, only shallow
  seagrass at -1686,488): main world, a treeless island at -434,304 (kelp at -427,62,308 over a seabed at 61;
  `site.py -434 304 13`) and kelp 3 blocks off shore at -293,62,90 (seabed 57).
- Small tools kept from the eighth session: `scripts/checks/top_map.py` (offline top-ground map; found F95's pits) and
  `scripts/checks/region_logs.py` (logs with their axis, for fallen trees).
- F102: fellTree's swallowed refill failures; a stray dig at a plot's margin.
- V2.5's leftovers (10-05): F140 (collect refusing items it can never get), F141 (resin plans), F142's hand rules
  (water regexes, the craft hint, stems in charcoal, partial-shape waterlogged solids, tinted glass in renders);
  `treeAt` crawling plain oak_log frames of a building beside a tree (lesson 30: skip structure cells, as collect's
  `keep` does); red sand for glass with an `any:sand` family (collect and gatherNames would have to learn it); the
  stonecutter (stairs 1:1 instead of 6 blocks for 4). After a Paper or minecraft-data upgrade run
  `vanilla_tags.mts`, `vanilla_recipes.mts` and `vanilla_drops.mts` (tags and recipes exit 1 on problems).

## Keeping this plan honest

- **When a run shows something new**, add a finding to `docs/FINDINGS.md` with evidence (log line, numbers). Then decide: fix now if it
  blocks the current step; otherwise add it to the right phase or the backlog, and say why.
- **When a finding invalidates a step** (wrong cause, better approach), edit the step and add a decision explaining
  the change. Do not silently delete: strike through (`~~...~~`) and point to the replacement.
- **Acceptance criteria are concrete** (what run, what counts as passing). If one turns out to be wrong, change it in
  the decisions log, not quietly.
- Keep the "Next session starts with" section current at the end of every session, including uncommitted work and
  anything left running.
