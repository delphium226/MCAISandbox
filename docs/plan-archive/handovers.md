# Earlier session handovers

The "Next session starts with" notes of earlier sessions, newest first, moved here from `docs/PLAN.md` on
2026-10-15. PLAN.md keeps only the latest one.

(written 2026-10-18 at the close of the thirty-sixth session, which ran sessions s37 (N.2) and the foundry beside it)

- **Done since s35's close (s36 and its two sessions, 10-18), all pushed, `main` fast-forwarded:**
  `71aa99d` N.0 tested and fixed (greens, own gathering, step keys; `scripts/checks/menu_probe.mts`) and N.1 needs behind
  `MC_NEEDS`; `8c393fd` (s37) N.2 housing behind `MC_HOUSING` and storage fixes behind `MC_PARTS`, the `initiatives`
  family on by default; `8e3fb4a` the skill foundry (`scripts/foundry.py`, six gates, test world 3 on 25568/8769, the
  Antigravity CLI `agy` by default); `b3ab0b7` its first ticket merged, `shear_sheep`. Results: `runs/2026-10-18/s36/notes.md`,
  `runs/2026-10-18/s37/notes.md`, `runs/2026-10-18/foundry/shear/report.md`. Best after-phase run yet: s37's model-driven
  Hm, busy 45% (members start their own streets and own their houses).
- **New ways of working (the user's, 10-18):** develop in flagged batches verified offline, then one combined live series
  (CLAUDE.md "Batch development"); **the todo list is GitHub issues**: #1-#16 for Phases N and X, #17-#65 from the
  older phases and the backlog (triaged and approved by the user, `docs/plan-archive/triage-2026-10-18.md`).
- **Next (the user's order, 10-18; see the issues):** a quick-wins batch: workers' human usernames [#11](https://github.com/delphium226/MCAISandbox/issues/11) (pool
  `server/src/agentNames.ts`, all whitelisted), neighbourhood names [#10](https://github.com/delphium226/MCAISandbox/issues/10), `MC_HOUSING`/`MC_PARTS` on by default
  [#2](https://github.com/delphium226/MCAISandbox/issues/2); then one mechanism for needs-driven works (rooms [#3](https://github.com/delphium226/MCAISandbox/issues/3), mines [#8](https://github.com/delphium226/MCAISandbox/issues/8), farms [#9](https://github.com/delphium226/MCAISandbox/issues/9)) with
  the need vote [#1](https://github.com/delphium226/MCAISandbox/issues/1); the foundry's next tickets [#14](https://github.com/delphium226/MCAISandbox/issues/14) (a skill tree is proposed, [#15](https://github.com/delphium226/MCAISandbox/issues/15),
  `docs/research/foundry-skill-tree.md`; the user said document it, build nothing yet). Bug [#7](https://github.com/delphium226/MCAISandbox/issues/7):
  `plains_small_house_3` traps bots.
- **Stack:** main, test 1, test 2 and test 3 (the foundry's) may be up; check `python scripts/stack.py status` and the agent
  counts before any reset (lesson 146). Checkpoints: `mv3_base25`, `mv3_grown25` (25 houses, s36), `mv3_base1`, `mv3_cpv1`.
- **Uncommitted at the close:** nothing of this session's; another session's village running time (`runMs`) was committed
  apart. Two sessions share this checkout at times: stage only your own files and hunks.


(written 2026-10-18 at the close of the thirty-fifth session; the next session's prompt is
`runs/2026-10-18/NEXT_PROMPT_s36.md`)

- **Done since s34's close (s35, 10-17/18):** a 25-agent model-driven village from scratch (Watch25: built, grown to 25
  houses, a style vote by model ballots, the first public-works vote 12-11 for a tool smith's quarter), resumed after the
  PC restarted; the panel's Votes, Thoughts (each agent's last 40 model calls with its reasoning) and Memory tabs
  (`0ccc2a4`, `aa4b5a2`); the README cut to 100 lines with the API and the sandbox in docs/ (`d7af51b`); pushed, and `main`
  fast-forwarded to the branch (the user's word). Then the user's ideas, settled into **Phase N, a needs-driven
  village** (PLAN.md; DECISIONS.md 10-18): initiatives (members' own small works others join), needs and escalation,
  owned houses, storage and furnace rooms, villagers as a growing population, a second agent-server process, beds and
  the day's rhythm; the foundry (X.3) alongside. The last commit: **N.0 initiatives built and committed off by default,
  not yet tested live** (`server/src/smallWorks.ts`, mcWorld's `initiate`/`help` kinds, the panel's Initiatives tab).
- **A mistake to learn from (lesson 146):** `reset_site.py minevale3 --save` was run while another run used test world 1
  (25 agents at fast settings): the save stops Paper, so that run was cut off at 09:19 on 10-18. Check `stack.py status`
  and the agent count before any reset_site call, `--save` included.
- **Next (in order; the user wants a multi-agent approach in Claude Code):**
  1. **N.0 tested**: staged on a test world from a checkpoint with room (`mv3_base25` has room for ~4 small works at once:
     save a grown village first, e.g. a staged growth run, then test there), families + `initiatives`, 60 min fast,
     binned busy; then a model-driven run; then on by default.
  2. **N.1 needs and escalation** (spec, adversarial check, implement, reviews, tests).
  3. N.2 housing and N.3 storage/furnace rooms, with the foundry (X.3) built alongside (test world 3 to set up).
- **Stack:** everything stopped (test worlds 1 and 2 saved; the main world stopped). Checkpoints `mv3_base25`,
  `mv3_base1`, `mv3_cpv1`. Test world 1 holds the end of another run's B25x2 (cut off): reset before use.
- **How to run things now:** as s34's handover (RUNBOOK "Activities (X.1, s34)"), plus `MC_INITIATIVES` (3) and the
  `initiatives` family; `scripts/checks/small_works.mts` (in check:offline); `[initiative]` lines.

(written 2026-10-17 at the close of the thirty-fourth session; the next session's prompt is
`runs/2026-10-17/NEXT_PROMPT_s35.md`)

- **Done this session (s34), committed locally, not pushed (ask the user):** `35312b0`/`204da9a` Phase X.1
  (`server/src/activities.ts`: the activity spec format, its validator and buildCatalog, ~31 goods of the recipe graph in
  the village's pinned wood; code-designed furniture, `streetPlan.ts` buildingDecor and the `furnish` chore; F237/F238);
  `8985b32` X.2 part 1, public works voted (a pool of 48 non-dwelling vanilla pieces, "no new work" once in a row) and
  built through growth's path; `f01136f` part 2a, works as quarters of up to 3 pieces (`MC_QUARTER`), the pathfinder
  crash F242 guarded (patch + `[crash-guard]`), works fit the room left (F243); the last commit: F244's path reset, runs,
  this handover. Catalogue, furnishing and public works are on by default (Claude's decisions; the user away).
- **What the runs say (RUNS.md, s34 rows):** X.1 doubles distinct activities (58/27; 60 in model mode) with a lower failed
  share, but alone busy time only bursts and falls to 0-1% after minute 20 (F240, lesson 144). Public works make work
  recur: at 1x the village holds 6-25% busy past minute 20 where it otherwise falls to 0 (X2q1 against X0q1); in model
  mode at 1x 24% over 30 min (X2qm, $0.051); fast staged runs 8-15%. Room round the village is the next limit (F243).
- **Open:** F244, repeated stalls in fast quarter runs inside or beside the same public works (butcher shop, armorer);
  watch one live before changing anything. F234 (most model-mode decisions never reach the model) as before.
- **Next (Claude's proposal, in order):**
  1. F244 live (a quarter run on world 1, watch the butcher shop's spot), then growth's reach for works (a second ring of
     sites once the first is full).
  2. **Members' proposals** (X.2 part 2b): a proposal call when a work ends (G1 triage), validated against the pool and the
     activity spec format (live specs authored by members), losers kept for the next ballot, outcomes fed back; a
     proposalbench first.
  3. X.3's foundry: first ticket shearing (wool unlocks beds, carpets and banners, a third of vanilla's furnishings, F236).
- **Stack:** test worlds 1 and 2 up from code snapshots, 0 agents (each agent server keeps its last run's settings; reset_site
  restarts them); the main world stopped. Checkpoints as before (`mv3_base25` the base).
- **How to run things now:** RUNBOOK's "Activities (X.1, s34)" note; `MC_PROJECTS` (on), `MC_QUARTER` (3),
  `MC_PROJECT_REST_MS` (2 min); `[catalog]`, `[furnish]`, `[work]`, `[crash-guard]` lines; series specs
  `scripts/series/x1_*.json` and `x2_*.json` (`x2_quarters_1x.json` and `x2_baseline_1x.json` for 1x); temperament_report's
  distinct activities; stage_village's `BUSY after by 10 min`.

(written 2026-10-16 at the close of the thirty-third session; the next session's prompt is
`runs/2026-10-16/NEXT_PROMPT_s34.md`)

- **Done this session (s33):** `cee9cef` A.3p part 1, personalities (`server/src/temperament.ts`: five traits, the user's
  sociability added; Latin-hypercube vectors per name; chore-kind weights 2.5x/0.4x as `tw` on every option; the
  weighted fixed pick, the trim, option tags, a code-written persona line and own-pattern line; the response threshold in
  the fixed sweep: likers first, a disliked pick left 90 s); `1c2d330` temperaments on by default (the user's);
  `e1a1fc7` the first vote (`server/src/vote.ts`: before each neighbourhood every member votes on its house style, the
  current biome's small houses against other biomes' that pass the survival checks and whose materials lie near; gpt-oss
  ballots or the temperament's predicted ones; `/api/votes`, the panel's "Last vote"; ballotbench) and the Phase X design
  (`docs/research/self-improving-activities.md`); `c3e4d2b`/`af365f0` the foundry's settings; this close-out. Pushed up
  to `e1a1fc7` (the user's word); the close-out commits after it are local unless the user said push.
- **What the runs say (RUNS.md, s33 rows):** temperaments alone barely separate agents where work is scarce (Tid/Ton,
  F232); with the threshold the tilt shows (Ton2 rho 0.52 vs 0.07-0.15, JSD 0.60 vs 0.50) and the model keeps it (Mon:
  the most-liked kind 72% of its picks vs 43% identical); identifiability stays weak at ~7 choices an agent in 20 min.
  Ballots: no order bias; identical voters unanimous for the cheapest set, temperaments split them; Vm2 voted savanna 4 of
  4 and built 4 savanna neighbourhoods for $0.014, growth as fast as with the vote off (Vp/V0). F233 (a hut no-path spot
  on minevale3's workshop), F234 (most model-mode decisions at 25 never reach the model), F235 (fixed).
- **The user's decisions (10-16, DECISIONS.md):** the trait set, strength and code-written personas; temperaments on;
  the vote's design left to Claude; Phase X after the vote, with the Claude Code CLI (installed, logged in, the user's
  subscription) and the user approving every foundry merge. A.3p part 2 (skill from practice) later.
- **Next (in order):**
  1. **Phase X.1, activity specs and a catalogue generated from the game** (PLAN.md, Phase X; design in
     `docs/research/self-improving-activities.md`): spec format and validator, the catalogue from the jar's data, menus
     ranked by need x temperament x learning progress, MAKE_GOODS replaced by the recipe graph, live spec authoring by
     members (validated, tried, kept or retired). The prompt gives the method (multi-agent, safe).
  2. X.2 projects and proposals for votes; X.3 the foundry (Claude CLI); A.3p part 2 when longer runs can show it.
- **Stack:** test world 1 running (Paper 25566, agent server 8767 from a code snapshot, 0 agents); test world 2 stopped
  and saved; the main world stopped. Checkpoints: `mv3_base25` (25 members, B25x2, complete, MC_GROW=0; the base for every
  s33 test), `mv3_base1`, `mv3_cpv1`.
- **How to run things now:** as s32's (stack.py, check:offline, run_series + run_report), plus `temperament_report.py`
  and ballotbench (RUNBOOK, "Personalities and votes").

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

(written 2026-10-16 at the close of the thirty-first session; the next session's prompt is
`runs/2026-10-16/NEXT_PROMPT_s32.md`)

- **Done this session (s31), all committed and pushed (the user's instruction; `main` untouched):** a speed session, no
  feature work. `a98d242` the docs split (CLAUDE.md 133 -> ~19 KB, PLAN.md 523 -> ~140 KB; RUNBOOK, LESSONS, HISTORY,
  FINDINGS, RUNS, DECISIONS, plan-archive); `c387652` checkpoints (`reset_site.py --save/--checkpoint/--list`,
  `stage_village.py --resume`); `eeaf692` `run_series.py` (staged series from a JSON spec); `fa51aac` code snapshots (the
  test agent server runs from `runs/code/<hash>/`, so **server files may be edited during a run**: the user relaxed the
  rule), `--after-until grow`, `MC_RANDOM_TICK`, `MC_HASTE`, `stack.py`, `run_report.py`, `.claude/settings.json` allow
  rules; `ff9a11b` model calls recorded (`runs/model-calls/`) and replayable (`MC_MODEL_REPLAY`); the close-out commit
  (run_series's fast default and these notes).
- **What the runs say (RUNS.md, s31 rows):** a checkpoint restore takes 0.3 min instead of a 5-9 min build; fast crops
  (`MC_RANDOM_TICK=30`) gave the first harvest at +2.4 min (~+17 before); `--after-until grow` stopped a 30-min watch at
  4.4; haste 5 + 3x built the 3-agent s0 village in 3.2 min (4.9 at 2x), `[dig]` re-digs unchanged; replay answered all 5
  recorded calls (the first 3 prompts identical). All single runs on minevale3 with 3 agents.
- **The user's decisions (10-16, DECISIONS.md):** speed ahead of quality (light regression checks only, no per-commit
  smoke series); edits during runs allowed from a code snapshot; staged runs fast by default in run_series (3x below 12
  workers, 2x from 12; haste 5; random ticks 30; `"fast": false` turns it off); food flags (`MC_GROW_FARMS`,
  `MC_APPETITE`) stay off; **next session: more speed work first**, then voting with neighbourhood variety (s30's plan,
  unchanged), then roads.
- **Next (speed work, Claude's proposed order; confirm with the user at the start):**
  1. Measure 3x (and haste) at 25 agents from a checkpoint: a 25-agent base village saved once (`MC_GROW=0`), then 2x
     against 3x with `run_report.py`; if `/api/perf`'s loop and `[lag]` stay clean, lift run_series's 12-worker cap.
  2. A second test world (copy of `mc/testserver` on its own ports, `reset_site.py`/`stack.py` taking the world), so two
     series or two sessions can test at once.
  3. `watch_village.py` in run_series (model-driven runs from a spec, with recording on and replay as an option).
  4. The SessionStart hook (ports, git status, the handover's first lines), if the user approves editing settings;
     `stack.py status` covers most of it meanwhile.
  5. `npm run check:offline` (typecheck + the two goldens + offline checks), only if quick; the golden fixtures and the
     s0 designs still live in gitignored `runs/` (`runs/2026-10-14/golden_*`, `runs/2026-10-05/vanilla_designs`).
- **Stack:** the test world left running (Paper 25566, agent server 8767 from a code snapshot, 0 agents, minevale3 holds
  checkpoint `mv3_cpv1`'s village CPv1); the main world stopped. Checkpoints in `mc/testcheckpoints/`: `mv3_cpv1` (CPv1, 3
  members, complete, at `a98d242`'s code). Model recordings in `runs/model-calls/`.
- **How to run things now:** `python scripts/stack.py status|up|down`; a series: write a spec (`scripts/series/example.json`),
  `python scripts/run_series.py SPEC --detach`, arm the watcher it prints; read results with `python scripts/run_report.py
  DIR/NAME ...`. After-phase tests from a checkpoint with `--after-until grow`.

(written 2026-10-15 at the close of the thirtieth session; the next session's prompt is `runs/2026-10-15/NEXT_PROMPT_s31.md`)

- **Done this session (s30), committed and pushed at the close (the user's instruction; `main` untouched):** `8371ab6`
  F228's three fixes (F218's false "no path" from a dirt_path start node, smelts taking their input back, hand-backs
  depositing what they carried), `505ada6` Minevale44 (model-driven, complete at 9.1 min, 0 failed actions in 54 min) and
  the movable test port, `209e934` **a village that grows** (neighbourhoods of up to 4 houses until a house per member;
  `MC_GROW`, on by default), `0197159` **food** (fields and slots in neighbourhoods behind `MC_GROW_FARMS`, the village
  appetite behind `MC_APPETITE`, both off by default), and the close-out commit.
- **What the runs say:** G25 grew a 25-agent village to 25 houses in 6 neighbourhoods in ~26 min, after-phase busy 4% ->
  16%; G25f with food: 6 fields planted and harvested 16 times, 52 meals, every member ate, hungry 2.2% of member-time
  (0% after +45), FOOD ok. Growth stops by design at a house per member, so after-phase busy time falls off again (G25f 9%
  over 75 min); food adds little agent time (as counted) but makes the fields the limit.
- **The user's choices this session (decisions log, s30):** growth tied to population, in neighbourhoods, the village
  staying complete; farms in every neighbourhood with crop variety; hunger as a village appetite on peaceful (vanilla
  hunger measured useless: walking costs no food); push at the close. **Backlog added by the user:** roads with lighting
  between neighbourhoods; more variety in neighbourhood styles, **joined with voting** (the first vote: the next
  neighbourhood's style; after the food step).
- **Next (the user's order):** voting with neighbourhood variety (spec first: options code prepares, a ballot per member,
  a bench for whether ballots follow facts or option order), then roads with lighting. Before it, small: decide with the
  user whether `MC_GROW_FARMS`/`MC_APPETITE` go on by default (G3f/G25f passed; a model-driven Minevale45f with both on
  first is the recommendation), F229/F230, F227.
- **Stack:** stopped at the close (the test Paper saved by RCON stop, its agent server killed by PID). **Another program
  (`D:\Projectspptest\...mbient.exe web`) bound 127.0.0.1:8767 this session**: start the test agent server with
  `MCAI_TEST_API_PORT=8768` (and `MCAI_API=http://127.0.0.1:8768/api`) while it is there; reset_site.py now refuses to
  kill a non-node listener.

(written 2026-10-15 at the close of the twenty-ninth session, which ran overnight: the user went to bed early on and asked
Claude to keep building and decide on its own; the next session's prompt is `runs/2026-10-15/NEXT_PROMPT.md`)

- **Done this session (s29), committed on `tiered-brain-building` and pushed at the close (the user's yes)**: `ebec76d` F224 (scouts beside a lure in instance mode; no lure in a scout's
  hand), `9c76d28` **S.9** (the workshop: make, gather, works with three furnaces, `v.tech`; behind `MC_CHOICE_FAMILIES`),
  `58fe85c` S.9's runs and F226, `43b3dec` **B.4** (light inside buildings and the mine, the workshop's first consumer),
  `c69dbe1` B.4's runs, lessons 130-133, and the close-out commit. `main` untouched.
- **What the runs say:** at 25 agents the families work (S9f: 23 agents took an S.9 chore, peak 9; B4f: 61 of 61 torches
  standing; every make matching its bill on the server's counts), but after-completion busy time is still ~4% (S9f 44.8,
  B4f 40.2 agent-minutes of ~1125), because the work is bounded by stock targets and placing by command is quick
  (lesson 130). In a 3-agent model-driven village they matter: Minevale43's after-phase was 38% busy (Minevale41 25%).
- **Open:** F228 (Minevale43's slow build, 17.8 min with 10 failed actions: not the families; the analysis in
  `runs/2026-10-15/mv43_analysis.md`), F226 (one make planned nothing; now logged and retried), F227 (fixture pumpkins),
  F218, F220, F222-F225.
- **Next (the user's choice, 10-15: Claude's recommendations):** first F228's three small fixes (F218's path to the hut's furnace,
  a smelt out of fuel taking its input back, a handed-back task depositing what it made) and a model-driven run, then the
  work that fills 25 agents, which must take agent time and grow: **a village that grows** (the backlog's item: after
  completion the Mayor lays out more houses on free land, built by the same economy; every family then has a real
  consumer, and builds take minutes of many agents), or A.3 (gauges, which also give F223 its measure), or S.10
  (surveys). `MC_CHOOSE` stays `fixed` (the user's answer at the start).
- **Stack:** the test Paper (25566) and its agent server (8767, on `c69dbe1`'s code) are left running with Minevale43's
  village; the main world is stopped. Restart the agent server after any server edit; reset minevale3 before a run.

(written 2026-10-14 at the close of the twenty-eighth session; the next session's prompt is
`runs/2026-10-14/NEXT_PROMPT.md`; the notes below for the twenty-seventh session stay valid where not overridden)

- **Done this session (s28), committed on `tiered-brain-building`, NOT pushed** (origin is at `8f91251`, pushed at this
  session's start; ask before pushing): `ef5deec` A.2 part 1 (the menu, fixed picker, model mode, guards, decision log,
  panel, `choice_golden.mts`, `choose_unit.mts`, F221's watcher retry), `31c36a5` (choicebench, exploring in instance mode
  without a free slot, the 429 back-off, effects that say what a chore is for), `d463440` (run record, F222-F225) and the
  close-out commit. `main` untouched.
- **A.2 is done** (the decision log above): model mode at 25 ran with 0 errors, 8% "taken", decision wait p90 0.9 s,
  ~$0.003 a 45-minute after-phase; choicebench 100% valid, 70/70 sensible, no position bias; Minevale42 (model mode,
  model-driven) complete in 10.2 min. The storage value cannot judge it (F223). `MC_CHOOSE` still defaults to `fixed`
  (D3 of the spec): switching the default to `model` is the user's call; the staged scripts take `--choose model`.
- **Where things stand at 25:** after completion only ~2% of agent-time is busy whoever picks (A2m 21.0, A2f2 18.8
  agent-minutes of ~1125): the menu works, the work is missing. That is the next step's job.
- **Next (Claude's decision at the close, the user asked for it):** first F224's live check (does a scout disturb a pen
  lure? if not, drop `pen` from explore's excludes in instance mode: the next ceiling on parallel work), then **S.9, the
  workshop** (`make item= count=` as a chore with instance keys `make:<item>`, offered as A.2 options; `v.tech`; the Tier
  0 goods; the works-plot question goes to the user at the start). Then S.10 (surveys) or A.3 (gauges, which also fix
  F223's measurement), the user's call.
- **Open findings:** F218 (no path to the hut's furnace cell -1657,65,8; reproduced in Minevale40, 41 and 42, always
  Worker2 at ~4.7 min: the cheapest model-driven failure left), F220, F222-F225.
- **Stack:** nothing running (the machine went down overnight; the test world is restored per site anyway). The Ollama
  app serves gpt-oss:120b-cloud; the user's session quota ran out once this session (a 429 on every call for hours):
  check with one tiny call before model work.
- **How runs went this session:** drivers in `runs/2026-10-12/a2_runs.py` and `runs/2026-10-13/a2_runs2.py` (staged
  runs with per-run env such as `MC_CHOOSE`, `MC_CHOICE_INSTANCES`, then model-driven runs with a 1x reset), detached
  with a background watcher on `ALL RUNS DONE`. Staged runs make 0 cloud calls; auto mode may still refuse a command
  naming the cloud planner while the user has paused cloud use.

(written 2026-10-12 at the close of the twenty-seventh session; the next session's prompt is
`runs/2026-10-12/NEXT_PROMPT.md`; the notes below for the twenty-sixth session stay valid where not overridden)

- **Done this session (s27), committed on `tiered-brain-building`, NOT pushed** (origin is at `c5224d6`; ask before
  pushing): `d0d6c8f` (s26's close-out, also unpushed), `475f060` E.0 (scale safety), `f22a1bc` F216/F217, `4d2d77a` E.1
  (infrastructure for 25), and the close-out commit (this record, `docs/research/memory/`, `scripts/stage_runs.py`, the
  profiling and chat helpers in `scripts/checks/`). `main` untouched.
- **Where things stand at 25:** the 25-bot probe (`scripts/checks/scale_probe25.py`) runs 10 minutes of mixed work with 0
  `[lag]`, API p90 0.048 s, Paper's tick worst 6.7 ms, RCON p90 11-46 ms a 30 s window; the agent server is ~51% idle
  (F219 fixed find_site's survey, which took 60% of the CPU). Van25a (25 agents, staged, 2x) built the village in 4.1
  min with 0 lag/stuck/timeouts but **21% busy: 16 of 25 waited while 8 mined**. The work runs out at 25: A.2 (the menu
  with instances) and the task families S.9-S.16 are what fills it.
- **Next (the roadmap's step 3, agreed order):** finish A.1's baseline (its code is in since `85ddef1`; the runs never
  happened: three staged after-phases with the fixed order and one model-driven run, metrics from
  `scripts/checks/autonomy_metrics.py`), then **A.2, the menu with instances** (spec, check, implement, review, refute,
  test; the step's two open questions go to the user first). Then S.7/S.8 or the task families, the user's call.
- **G2, long-horizon memory (started with the user this session):** the user's choices are in the decisions log
  (10-11, s27): both horizons, all four purposes, **model-managed** memory. The literature synthesis is
  `docs/research/memory/long-horizon-memory.md` (it favours: code records verifiable facts with provenance; the model
  curates through narrow ops on entries with ids, add/supersede/vote/mark_done, no rewrites or hard deletes; writes ride
  existing calls plus one consolidation call per agent per village night; code pushes a ~300-500-token core and the top
  1-3 entries into each prompt; ~0.73M tokens/h at 25 agents, ~$0.15/h). Bench v1 (`docs/research/memory/bench_v1_*.md`;
  code and data in `runs/2026-10-11/s27/memory/`) was judged **not ready** by its adversarial check (25+ probes need no
  memory, wrong answers, leaks, decision probes give the answer away, ~27 clean test probes). **Open with the user:**
  rebuild the bench as v2 to the report's section 7 (template probes from code-computed state, decision probes inside
  execbench/mayorbench, a BM25/log-search baseline, dev/test split frozen, 5 samples a probe) and run the candidate
  designs (~$1.5-2 each), or the user reads the report first and adjusts the direction. Ask once at the start.
- **Open findings:** F218 (a bot on a street's dirt_path gets "no path" to the storage hut's furnace cell, `goto`
  resolving without arriving; twice in four runs, not reproduced with `move_to`: next, `reach()`'s GoalNear range 3 on
  the hut cell from that spot); F220 (the probe's RCON figure is the worst minute; count the run's p90 over all
  commands). The 25-bot village's idle agents are a goal, not a finding.
- **Stack:** nothing running. The test Paper went down with the machine overnight without a save (its log ends at
  19:27, Van25a's end): the test world is restored per site anyway; reset minevale3 before use. The main Paper was
  stopped cleanly (whitelist Worker5-24 added). max-players 30 in both worlds.
- **How to run things now:** staged runs in a row, detached, with a watcher: `python scripts/detach.py
  runs/<date>/NAME.runner.log python scripts/stage_runs.py NAME:WORKERS` (minevale3 at Minevale37's site, the S.0
  command, a reset before each; `STAGE_ARGS`, `STAGE_TIMEOUT_S` for long after-phases), then a Bash
  `run_in_background` loop `until grep -q "ALL DONE" ...; do sleep 15; done`. Model-driven villages: as in CLAUDE.md, on
  the test world after a 1x reset (`reset_site.py minevale3` without `MC_TIME_SCALE`), detached through detach.py with a
  watcher on its `^STOPPED` line. A live human chat line: `node scripts/checks/human_line.cjs Gus 25566 "Mayor, ..."`.
  A CPU profile of the agent server: `node -e "process._debugProcess(PID)"`, then `node scripts/checks/cdp_profile.cjs
  ws://127.0.0.1:9229/<id> 40 OUT.cpuprofile` and `node scripts/checks/profile_callers.cjs OUT.cpuprofile`.
- **Method that held up again (s27):** a golden check before reviewing a refactor; four lens reviewers plus one refuter per
  finding found 3 real defects in E.0 and 12 of 20 in E.1, and a fix review found one more (the pathfinder share cut
  two bots); implementers on disjoint file sets; every staged and probe run detached with a watcher; a CPU profile when
  the numbers are bad without any `[lag]` (lesson 125).

(written 2026-10-11 at the close of the twenty-sixth session; the next session's prompt is
`runs/2026-10-11/NEXT_PROMPT.md`)

- **Goals (the user's, 10-10/11; full list in the roadmap's goals note and memory `scale-and-emergence-goals`):** agents
  that choose (Phase A); 25 agents doing many different activities in parallel, with more kinds of work (Phase S);
  Project Sid-style emergence through the brain and communication (Phase E); agents propose game improvements that
  Claude triages (G1); long-horizon memory (G2, the user wants to start its investigation together). **No more
  agent-count comparisons** (the roadmap's revision note): test each step by whether it works at 25 and does its job.
- **Pushed** (`origin/tiered-brain-building` = `c5224d6`; `main` untouched): A.0, the Phase S/E plans, S.0-S.6, the
  goals G1/G2. The close-out commit (this record, CLAUDE.md lessons 118-124, `docs/research/`) is local until pushed.
- **E.0 (scale safety): implemented, uncommitted, in the working tree** (21 tracked files + `server/src/modelCall.ts` and
  five checks in `scripts/checks/`; backup in `runs/2026-10-11/s26_e0_backup/`: `e0_tracked.patch` and `new/`). The
  implementing agent was stopped at its self-review. Typecheck clean; its offline checks pass: `call_gate.mts` 30/30,
  `board_version.mts` 23/23, `chat_route.mts` 18/18, `save_debounce.mts` 12/12, `model_usage.mts` 161/161.
  `board_golden.mts dump|check GOLDEN.json [villages.json]` needs a dump from the committed code first (stash, dump,
  unstash, check). Still to do: the self-review (adversarial, with refutation), the golden check, a staged run that shows
  nothing changed at small scale and the new lines work, then commit.
- **Then:** E.1 (spec `runs/2026-10-10/s26/spec_e1.md`: max-players 30, whitelist Worker12-24 on the test world and
  Worker5-24 on the main one, pathfinder time shared between bots, RCON timeout, `/api/perf`, the panel at 25 with
  colours by number), a 25-bot probe, a staged 25-agent village; then A.2 (the menu with instances) and the task
  families S.9-S.16, then E.2-E.7.
- **Material on disk** (`runs/2026-10-10/s26/`, gitignored): specs and checks `spec_{s1..s6,e0,e1}.md`, `*check.md`;
  `phaseS_*`, `phaseE_*` (the design workflows' research), `parallel_map.md`, `candidates_verified.md`, the literature
  notes `research_notes/`, bench logs `bench/`, run logs Van12a..j, Van3a..h, `scale_probe.py`, `baselines_s0.py`
  (staged runs in a row with resets: `python scripts/detach.py LOG python runs/2026-10-10/s26/baselines_s0.py Van12x:11`).
- **Stack:** stopped (test Paper saved by RCON stop, its agent server killed; local model servers stopped). The test
  world's minevale3 holds Van12j's village: reset before use. Test whitelist: Worker1-11 added.
- **Session method that worked:** read-only spec agents with an adversarial check; one implementer per file set; lens
  reviewers plus a refuting pass before any run; staged runs detached with a background watcher (lesson 122).

(written 2026-10-10 at the close of the twenty-fifth session: F205, F209, Minevale36 and the control panel's redesign;
the notes below for the twenty-fourth session stay valid where not overridden)

- **Code:** on `tiered-brain-building`: `15c65a4` F205 (pens take animals up to 8 above the annex, measured from the
  annex), `479b87c` F209 (water progress, scout range, teleport home from water), `2039bee`, `95fa904`, `9ca781f` and the
  icons-and-key commit (the panel's simple view, drill-down detailed view, trails, Auto framing, activities overlay,
  fullscreen, map icons and key), and the close-out (this record, CLAUDE.md lessons 113-117, README restructured as an
  AI-agent project with fresh screenshots in `docs/images/`, ARCHITECTURE). **Pushed, and `main` fast-forwarded to the
  branch** at the close (the user's instruction, 2026-10-10: `main` = `tiered-brain-building` = `0ebb540` + this note).
- **Stack:** stopped cleanly at the close. No agents in either world.
- **Where things stand:** Minevale36 (1x, model-driven, minevale3's usual site) 6/6 in **10.6 min**, **0 failed actions in
  55.7 min**; after completion: two chickens led down from +5 and bred to 5, 6 eggs, all 8 scouting trips (Worker1 passed
  Minevale35's lake point with no stall), the iron pickaxe and three buckets, and, after the wheat field was ripened by
  command at +26 min (the user's choice), a harvest, the first cow pen with real models (one cow from +6) and 3 milk. No
  cake: the cow pen stayed at one (F213) and the cake waits for 3 milk, an egg, 3 wheat and 2 sugar (no cane farm this
  run). Staged VanH3 (F205 fixtures at +6): 4 pen trips, 3 from +5..+7, a chick and two calves, 2 cakes.
- **Next (proposed; the user picks):** 1. `MCAI_RIPEN` for `watch_village.py` (ripen the field by command once, as
  `--harvest` does for staged runs) and one model-driven run to a cake. 2. F213 (a pen of one when no second animal is
  within reach: widen the cow search or lure from a scouted sighting). 3. F211 (swim to the nearest shore before walk
  legs from a shallow sea). 4. The beautifying plan (B.1) or the smaller items (F208, F201, F200, F192's cane drops, F187,
  F170-F173, F210's forceloads).
- **Panel work:** previews ran through `runs/2026-10-10/scripts/panel_proxy.py PORT` (serves a scratch copy at /panel and
  passes /api to 8767) and headless Edge (`--force-dark-mode`, `/panel#simple` or `#detailed`); the patch scripts are
  `runs/2026-10-10/scripts/panel_apply*.py`, the node render harness `panel_review2_t.cjs`. The panel file is read on every
  request, so applying it during a run does not touch the agents (done with the user's approval during Minevale36).
- **Test world state:** minevale3 holds Minevale36's village: reset before using it.

(written 2026-10-09 at the close of the twenty-fourth session: F193 per-agent chores and pens v2; the user asked Claude
to decide everything after the first question; the notes below for the twenty-third session stay valid where not
overridden)

- **Code:** on `tiered-brain-building`: `119df92` F193 per-agent chores and pens v2 (eggs, breeding, a cow pen, milk, a
  cake), and the close-out (this record, CLAUDE.md lessons 109-112, README, ARCHITECTURE). Not pushed: ask first. `main`
  untouched.
- **Stack:** stopped cleanly at the close (the test agent server by PID, the test Paper "All dimensions are saved", the
  pinned model servers). No agents in either world.
- **Where things stand:** after completion every idle member takes a chore of a kind nobody holds (workers first, then
  the Mayor); Minevale35 (1x, model-driven) 6/6 in **11.0 min**, 0 failed actions, then all three on chores at once (iron
  trips, annex, pen, farm, all 8 scouts, eggs). Pens hold chickens or cows; eggs, breeding and milking are done by
  command from beyond the gate; a cake at the storage hut once storage holds 3 milk, an egg, 3 wheat and 2 sugar. Staged
  VanC3 showed the whole chain (a chick bred, 3 x 3 milk, 5 eggs, 2 cakes). Live facts: `runs/2026-10-09/pens_v2_facts.md`.
- **Next (proposed; the user picks):** 1. F205 (pens of one: sightings above the annex) and one more model-driven run
  long enough for a wheat harvest (`MCAI_AFTER=45`) to see a cow pen, breeding and a cake with real models. 2. F209 /
  F189's dry ring points. 3. The beautifying plan (B.1) or the smaller items (F208, F201, F200, F192's cane drops, F187,
  F170-F173). The prompt: `runs/2026-10-09/NEXT_PROMPT.md`.
- **Saved from the session's scratchpad** (gitignored): `runs/2026-10-09/s24_scratch/` (`research2/cake.mts` replays the
  materials planner offline, F207-style checks; `research2/tags.mts` reads tags and recipes from the jar; `research/*.txt`
  the jar's Cow, AbstractCow, Items, EntityType, WalkNodeEvaluator disassemblies; the edit scripts and review diffs).
- **How to test now:** staged `--after 20 --fixtures --stock wheat:12,bucket:3,sugar_cane:2` (VanC3: complete at 6.3,
  pens, milk and cakes within 20 min after); `AFTER busy:` gives each agent's busy minutes;
  `runs/2026-10-09/scripts/pens_v2_facts.py` for live animal facts; `runs/2026-10-09/scripts/restart_agents.py` restarts
  only the test agent server.
- **Test world state:** minevale3 holds Minevale35's village on Minevale31's site with an annex (a chicken pen) and a
  pumpkin farm: reset before using it.

(written 2026-10-09 at the close of the twenty-third session: Minevale33, its fixes F188-F192, the annex and chicken pens
v1, F198/F199, Minevale34; the notes below for the twenty-second session stay valid where not overridden)

- **Code:** on `tiered-brain-building`: `91d1399` fixes from Minevale33 (F188 the agent-server crash on unloaded blocks,
  F189 scouts teleport home, F190 pickaxes by uses, F191 planks before stations, F192 cane sightings), `ecb7cf7` the annex
  and chicken pens v1, `5d156ca` F198/F199 and the pen review's small fixes, and the close-out (this record, CLAUDE.md
  lessons 104-108, README, ARCHITECTURE). Pushed at the close (the user's instruction this session). `main` untouched.
- **Stack:** stopped cleanly at the close. No agents in either world.
- **Where things stand:** Minevale33 and Minevale34 (1x, model-driven, minevale3's usual site) both complete in **10.6 min**,
  0 failed actions to completion. After completion: plant starts on the plot's slots, then an **annex** (13x9 beside the
  plot, chosen in code) and a **chicken pen** on it (ring charged at the storage hut, seeds in the off-hand by command,
  up to 4 chickens led in 4-block hops, the bot teleported 2 cells in and then to the back row, the gate closed by
  command), then the iron age. Minevale34 penned 2 wild chickens with real models at +5.8; staged VanA3/A5/A6 penned 1
  each, led 25-80 blocks. Eggs and breeding are v2 (the user's choice). Live facts: `runs/2026-10-08/s23/lure_facts.md`.
- **Next (planned with the user at the close, 10-09):** 1. **F193, per-agent chores** (a second idle worker takes a chore
  of another kind; Worker2 and the Mayor idle ~20-29 min after completion today). 2. **Pens v2: eggs, breeding and cows**
  (live facts first: feeding with `activateEntity`, eggs counted and taken by command, cows following wheat, milking with
  the bucket; then eggs into storage, breeding with a cooldown, a cow pen on the annex's second slot with a wheat reserve
  kept from the bread, milk, and a cake from milk, sugar, an egg and wheat). 3. **One model-driven run** at the end (1x,
  `MCAI_AFTER=30`). Smaller if time: F201, F200, F192's cane drop pickup, F189's dry ring points, F187, F170-F173. The
  beautifying plan (B.1) after that. This plan and the prompt's tracker update were pushed with the session (the user's
  instruction, 10-09).
  The prompt: `runs/2026-10-08/s23/NEXT_PROMPT.md`.
- **How to test now:** `stage_village.py ... --mayor --after 8 --fixtures` (fixture chickens on level ground; ANNEX and PEN
  lines with a server count of each pen); `SIZE=40 node_modules/.bin/tsx scripts/checks/street_plan.mts` (annex and pen
  geometry). Staged green plains ~6 min to completion at 2x, the annex and pen ~3 min more. `[pen]` lines log each hop.
- **Test world state:** minevale3 holds VanA6's village on Minevale31's site (-1648..-1609, 27..66) with its annex at
  -1659..-1651, 40..52 and a penned chicken: reset before using it.

(written 2026-10-08 at the close of the twenty-second session: Minevale32, opportunistic farming and exploring v1, the iron
age v1, F165/F169, F178, F179; the user asked for no questions this session, so every choice was the recommended one,
recorded in the decisions; the notes below for the twenty-first session stay valid where not overridden)

- **Code:** on `tiered-brain-building`: `0da949d` opportunistic farming and exploring v1, then the iron age v1 with
  F165/F169, F178 and F179, and the close-out (this record, CLAUDE.md lessons 98-103, README, ARCHITECTURE). Nothing was
  pushed this session (origin has `3705649`): ask before any push. `main` untouched.
- **Stack:** stopped cleanly at the close (the test agent server by PID, the test Paper "All dimensions are saved", the
  pinned model servers). No agents in either world.
- **Where things stand:** Minevale32 (1x, model-driven, minevale3's usual site) 6/6 in **11.2 min** (Minevale31 16.5), 0
  failed actions: the five opportunities hold with real models. Once a village is complete, idle workers start farms on
  two free slots from what the atlas has seen within 160 blocks (cane, pumpkins, melons, vanilla villages' crops),
  harvest them, explore 8 ring points while a slot is free, then go down for iron: their own stairs to y 18 (retried past
  caves, up to 5 tries), tunnels keeping iron and coal from walls, floors and veins, an iron pickaxe and then a bucket
  into storage. Staged VanI7: 6 raw iron from 144 cells, both tools made, 0 failed. The iron age takes ~20 min after
  completion at any time scale (digging is wall-clock). F165/F169: signs and lamps in one pass (VanW7, VanW9).
- **Next (set at the close, 10-08; the user confirms at the start):** 1. **Minevale33**, a model-driven run at 1x with
  `MCAI_AFTER=30`: the after-completion chores (farm starts from wild sightings, harvests, the iron age) with real models
  for the first time, and the build time against Minevale32's 11.2 min. 2. **Animal pens v1, chickens first** (the
  backlog's "Animal pens" item now holds everything already known: tempt items from the jar, no leads, pen pieces,
  fence costs, the slots, the animals map, what is near the test sites, the unknowns to settle live first). Then the
  beautifying plan (B.1 first; four open choices) or the smaller items (F170, F171-F173, F187; the atlas noting cane stalk
  heights: a 1-high wild stalk gives nothing, VanW7). The prompt: `runs/2026-10-08/s22/NEXT_PROMPT.md`.
- **How to test now:** `stage_village.py ... --mayor --after N [--fixtures] [--ripen] [--stock raw_iron:3]` (CLAUDE.md,
  Testing agents); `runs/2026-10-08/s22/iron_start_check.mts`, `ores_along.py`, `f165/sim.mts`, `cdp_stack.cjs` (a hung
  server's stack). Records, research, designs and reviews: `runs/2026-10-08/s22/`; the next prompt is
  `runs/2026-10-08/s22/NEXT_PROMPT.md`.
- **Test world state:** minevale3 holds VanW9's street village on Minevale31's site (-1648..-1609, 27..66): reset before
  using it. The test world's atlas knows the land to ~160 blocks round VanG's site (exploring).

(written 2026-10-08 at the close of the twenty-first session: harvest and bread, the opportunities analysis and five
of its opportunities; the notes below for the twentieth session stay valid where not overridden)

- **Code:** committed on `tiered-brain-building`, not pushed (ask first; origin had `fab2359`): `f17f360` farming v2
  (harvest_farm as a chore, MineflayerWorld.farmChores; `stage_village.py --harvest`), `33b70f6` the preparer sets up
  the storage with its felled logs, `5f3e133` F164 whole buildings (`v.woodFor`; `--site-at` sixth field = the wood's
  log count, gives a staged village a wood kind), `8724395` stations shared after the storage hut, `0ec7e0a` #3/#4
  (hand-gathered items while the plot is prepared, lamps once every build is claimed), and the close-out (this record,
  CLAUDE.md lessons 93-97, README, ARCHITECTURE). `main` untouched.
- **Stack:** stopped cleanly (the test agent server by PID, the test Paper "All dimensions are saved"); the pinned
  model servers were not started this session. No agents in either world.
- **Where things stand:** a ripe field is harvested by an idle worker as a chore (also after completion), resown and
  baked into bread; staged green plains complete in 6.1 min at 2x (8.9 at the start of the session), Minevale31's site
  with a wood kind 7.2 (9.6 before F164). **No model-driven run since Minevale31 (16.5 min)**: the analysts' simulation
  predicted ~11-12 min with #1 and F164.
- **Next:** 1. **Minevale32** (model-driven 1x, minevale3, after a reset without MC_TIME_SCALE; the command in the
  session prompt): compare with Minevale31's 16.5 min and check F164's moves and the early gathering with real models;
  log analysis if it loses minutes. 2. The user's order after the analysis: **opportunistic farming and exploring**, then
  **the iron age** (backlog). Smaller: F165/F169 (plank choice), F170 (no path out of the mine, once), F171-F173.
- **How to test now:** staged runs as before; `--harvest` sets the field ripe after the build and checks the harvest;
  `--site-at=X,Y,Z,SIZE,WOOD,WOODLOGS` gives a wood kind (F164 tests: Minevale31's site
  `--site-at=-1628,65,47,40,birch,999`, baseline VanW2 9.6, now VanW5 7.2). Records, reviews and analyses:
  `runs/2026-10-08/s21/`; the next prompt is `runs/2026-10-08/s21/NEXT_PROMPT.md`.
- **Test world state:** minevale3 holds VanO4's green village (-1677..-1638, 3..42) with its harvested and resown farm:
  reset before using it.

(written 2026-10-08 at the close of the twentieth session: farming v1 added; the notes below for the nineteenth session
stay valid where not overridden)

- **Code:** committed on `tiered-brain-building`: `24e7037` (farming v1: `placeFarm` in streetPlan.ts, the seed and
  "Plant the farm" tasks in layout.ts, `tend_farm` in mcBuild.ts, the walking ban in botAgent.ts, seeds from grass only
  and not junk, mineBlock's walk to plants, `materialsNear`'s skip, street_plan.mts's farm rules), `e28198e` (seeds in
  posting order, no hoe-log task) and the close-out (this record, CLAUDE.md lessons 90-92, README, ARCHITECTURE). Not
  pushed (ask first). `main` untouched.
- **Stack:** stopped cleanly at the close (the test agent server by PID, the test Paper "All dimensions are saved", the
  pinned model servers). No agents in either world. `ollama_exec.py status` gave no WARNING this session.
- **Where things stand:** every new survival village with a street or green plan (and rows where room) gets a 5x7
  wheat field (water channel down the middle) beside the storage hut, planted with 16 wheat right after the hut's build
  (two seed tasks the mayor and workers share). Wheat grows with time frozen (confirmed live: ages 0-5 within ~3 min at
  2x) but only near agents. Minevale31 (1x) 6/6 + 6 lamps + 5 signs + the farm in 16.5 min, 0 failed actions (about a
  minute of it the mayor's seeds-first order, fixed in `e28198e`; staged VanF5 8.9 min at 2x, not run model-driven again,
  the user's choice). The test server is reachable on the LAN at 192.168.1.84:25566 only if the user adds a firewall
  rule for 25566 (the existing rule opens 25565 only).
- **Next (the user's order, 10-08):** 1. **harvest and bread** (farming v2: code posts "Harvest the farm" when ~3/4 of
  the wheat is ripe, `loot give` per cell, resow, bread at the table into storage; never counted for completion; test
  with crops set ripe by command); 2. **the opportunities analysis** (read-only log analysis of existing runs for
  waste: idle, empty walks, storage round trips, nearer tasks; F164 is its first candidate); 3. **opportunistic farming
  and exploring** (sightings recorded while working, an opportunity rule posts a farm for whatever is found first, kind-
  free farm slots, exploring for anything once the buildings stand); 4. the iron age. Details in the backlog's
  "Village life" list.
  Smaller: F165 (the craft skill's own plank choice), F166 (minevale3's lake-shore pit), F157-F161.
- **How to test now:** as before; staged and model-driven runs wait for "Plant the farm" too; read the field with
  `runs/2026-10-08/s20/farmcheck.py VILLAGE` (MCAI_API's /api/block: farmland, water, wheat and its ages); offline
  `SIZE=32|40 [PLAN=green] node_modules/.bin/tsx scripts/checks/street_plan.mts` checks the farm's rules. The prompt for
  the twenty-first session is `runs/2026-10-08/s20/NEXT_PROMPT.md`; research, design, reviews and the run analysis are
  in `runs/2026-10-08/s20/`.
- **Test world state:** minevale3 holds VanF5's green village with its farm (-1677..-1638, 3..42): reset before using it.

(written 2026-10-08 at the close of the nineteenth session: name signs added; the notes below for the eighteenth
session stay valid where not overridden)

- **Code:** committed on `tiered-brain-building`: `cfe8b8c` (name signs: `placeSigns`/`signLabel`/`holdsSign` in
  streetPlan.ts, the soft "Put up the signs" task after every build and the lamps, the `put_up_signs` skill, wall signs
  charged as the sign item, `/api/block` text, street_plan.mts's sign rules) and the close-out (this record, CLAUDE.md
  lesson 89, README, ARCHITECTURE), pushed to origin at the close (`acc805f`; the user said push), then this tracker
  update (farming before the iron age), not pushed (ask before any push). `main` untouched.
- **Stack:** stopped cleanly at the close (the test agent server by PID, the test Paper "All dimensions are saved", the
  pinned model servers). No agents in either world. `ollama_exec.py status` gave no WARNING this session.
- **Where things stand:** every building of a village gets a waxed wall sign beside its entrance door ("House",
  "Library", "Storage", "Mine"; other designs their own name), put up after the lamps by one worker in ~0.3 min.
  Minevale30 (1x, minevale3's usual site) 6/6 + 6 lamps + 5 signs in 15.4 min, 0 failed actions; F156's fix confirmed
  (lamps in one pass); F157 did not show.
- **Next (the user's choice, confirmed after the close): farming**, before the iron age (decisions of 10-08): the
  farm's water laid free by prepare_site; first settle whether crops grow with time frozen at day. Research first
  (vanilla's farm pieces, hoe, seeds from grass, water, planting and harvest as tasks), then design note, review, one
  question round.
  Smaller: F157 (if it shows again), F158, F159, F161 (the signs' leftovers). The prompt for the twentieth session is
  `runs/2026-10-08/s19/NEXT_PROMPT.md`; the signs' research, design and reviews are in `runs/2026-10-08/s19/`
  (`signs_proto/` the prototype and the jar's glyph widths, `review/` the diff review's comparison of placeSigns with the
  prototype over 115 real villages, `checks/` the sign bill script and materials.mts before/after).
- **How to test now:** as before; staged and model-driven runs wait for the sign task too; check sign columns with
  `/api/block` (it shows `text`) or RCON `data get block X Y Z front_text.messages`; `street_plan.mts` checks signs.
- **Test world state:** minevale3 holds Minevale30's village with lamps and signs (-1648..-1609, 27..66): reset before
  using it.

(written 2026-10-06 at the close of the eighteenth session: F155 fixed, street lamps added; the notes below for the
seventeenth session stay valid where not overridden)

- **Code:** committed on `tiered-brain-building`: `52f5b19` (F155: wait-only mayor plans count as empty, the nudge names
  the library and says "call plan_layout now", refusal-aware and capped at 3 a site; find_site's reason ends "call
  plan_layout now"; the mayor's executor waits for a pending replan; a drawn design marks its step; workers running a
  code-posted step skip the timed review for up to three intervals; mayorbench's F155 cases and per-case tally),
  `980a5cd` (street lamps: `placeLamps`, the `light_streets` skill, the soft "Light the streets" task after every build),
  the charcoal fix (F156) and the close-out (this record, CLAUDE.md lessons 85-88, README, ARCHITECTURE). Pushed to
  origin at the close (the user said push; ask again for later pushes). `main` untouched.
- **Stack:** stopped cleanly at the close (the test Paper "All dimensions are saved", the test agent server by PID, the
  pinned model servers). No agents in either world. Ollama is 0.35.1 now (the app updated itself); `ollama_exec.py
  status` gave no WARNING.
- **Where things stand:** the mayor lays out on its second call (Minevale27/28/29: 0.1-0.2 min, no design drawn; the
  F155 guard never had to fire in a run, the bench shows it works: 12/12). Villages take 14.2-14.4 min on minevale3's
  usual site, 15.2 with the lamps (Minevale29: ~0.6 min of that was F156, fixed after the run but not yet run again).
- **Next (the user's choice at the close): signs straight away**; F156's fix is checked by the signs' own model-driven
  run (lamps in one pass, 0 failed actions). Then the village-life list in the backlog, in the agreed order: signs beside each
  building's door, then farming (iron age suggested fourth); the user's two lighting items (inside buildings, inside
  mines) are in that list. Smaller: F157 (the Mayor's 1x1 pocket), F158 (a stray drawn design wins over the library),
  F159 (lamp leftovers). The prompt for the nineteenth session is `runs/2026-10-06/s18/NEXT_PROMPT.md`.
- **How to test now:** as before; the mayorbench F155 cases (`ONLY=F155`); `scripts/checks/street_plan.mts` checks the
  lamps' rules (`SIZE=40 PLAN=green`); staged runs wait for the lamp task; check lamp columns with `/api/block` after a run.
- **Test world state:** minevale3 holds Minevale29's village with its lamps (-1648..-1609, 27..66): reset before using it.

(written 2026-10-06 at the close of the seventeenth session: F148 and F131's leftovers done, F150 waiting; the notes below
for the sixteenth session stay valid where not overridden)

- **Code:** committed on `tiered-brain-building`: `bd174c1` (F148: `patches/mineflayer-pathfinder+2.4.5.patch` copies A*
  nodes into paths; walkOnce's `[repath]`; the `[stuck]` line's goal and path fields), `51f10a2` (F131: the rescue's
  "out" test, no climb on village ground, `test_rescue.py tunnel`), and the close-out (mineflayer-pathfinder pinned at
  2.4.5, README, ARCHITECTURE, CLAUDE.md lessons 82-84, this record). All pushed to origin at the close (the user said
  push; ask again for later pushes). `main` untouched.
- **Stack:** stopped cleanly at the close (the test Paper "All dimensions are saved", the test agent server by PID, the
  pinned model servers). No agents in either world. `ollama_exec.py status` gave no WARNING this session.
- **Where things stand:** F148 was the pathfinder corrupting its own search with a partial path's post-processing (F151);
  five staged runs since without a `[stuck]` line (VanG12/13, VanP1, VanM6/7: 7.7-8.5 min at 2x). The rescue now knows a
  sealed-in village member at once (F152: teleported home in 2 s). Minevale26 (1x) 6/6 in 18.8 min, 0 failed actions, but
  ~3 min lost to the mayor's late layout (F155). F150 did not show in Minevale26 and did not reproduce otherwise.
- **Next (the user's choice at the close): F155 first**: the mayor's lone "wait" plans escape the plan_layout nudge
  (tieredBrain.ts ~1230-1254), and the nudge's second reason overwrites "call plan_layout now"; propose the guard with a
  recommendation (AskUserQuestion) before coding, check it with `scripts/bench/mayorbench.mts` if the prompt changes, then
  a model-driven run on minevale3. After that: the rest of the backlog (F133 now probably F151's; F153; F139-F142; F150 if
  it shows), lamp posts, or phase 3. The prompt for the eighteenth session is `runs/2026-10-06/NEXT_PROMPT.md`; the
  F155 analysis is `runs/2026-10-06/minevale26_analysis.md`.
- **How to test now:** as before; also count `[repath]` lines (one in Minevale26, a cell short of a tree: harmless);
  `test_rescue.py tunnel` must teleport (never "walked out" inside); a sealed-mine check: `runs/2026-10-06/f131_village.py`
  (a staged village's member in its mine with the mining hut's doorway sealed; `VILLAGE`, `SEAL`, `START`, `GOAL`).
  Loading server edits without a reset: stop the agent server on 8767 by PID and start it with `scripts/detach.py` and
  reset_site.py's environment (MC_SERVER_DIR, MC_PORT=25566, MC_API_PORT=8767, MC_API_HOST, MC_TIME_SCALE): the staged
  village stays for checks on it.
- **Test world state:** minevale3 holds Minevale26's green village (-1648..-1609, 27..66): reset before using it. The
  rescue traps at -20..70,-35 keep sinking (F149, F154).

(written 2026-10-05 at the close of the sixteenth session: F138's leftovers done, F147 found and fixed; the notes below
for the fifteenth and fourteenth sessions stay valid where not overridden)

- **Code:** committed on `tiered-brain-building`: `07306d5` (the fifteenth session's record), `32f3eff` (item 3:
  `[stuck]` lines, horizontal watchdog), `5861632` (item 1: storage fails at once on an unmoved stall; the rescue walks
  away first), `cff6dbc` (F147: half width 1229/4096, `[stuck-world]`), `8c73e20` (every dig checked with the server),
  and the close-out (README, ARCHITECTURE, CLAUDE.md lessons 78-81, this handover). All pushed to origin at the close
  (the user said push; ask again for later pushes). `main` untouched.
- **Stack:** stopped cleanly at the close (the test Paper "All dimensions are saved", the agent server by PID, the pinned
  model servers). No agents in either world. `ollama_exec.py status` gave no WARNING this session.
- **Where things stand:** F138's pit stall was F147, a rounding error in our `playerHalfWidth` (Paper's silent
  CLIPPED_INTO_BLOCK), fixed; the mine's set-back stalls were digs Paper never finished, now checked. The last staged
  run (VanM5) had no `[stuck]` line; Minevale25 (1x) 6/6 in 15.0 min on -1628,65,47, 0 failed actions.
- **Next (the user's choice at the close): the small backlog**: F148 (a reproducible 12 s stand-still by the storage
  hut on VanG's site: VanG8/9 hit it at -1661.48,65,6.50), F150 (the Mayor's 23 s sand walk through water on
  minevale3, Minevale24/25), F131's leftovers (the rescue's success test and its climb on protected ground, the mine's
  doorway); then F133 if it shows again, F139-F142. Lamp posts and phase 3 after that. Each entry now says where its
  evidence is (F148: a lead in the pathfinder's empty-path branch; F150: the two `[stuck]` lines; F131: Minevale19.log
  lines 91, 96). The research behind F147 is in `runs/2026-10-05/s16/research/README.md`; the prompt for the
  seventeenth session is `runs/2026-10-05/s16/NEXT_PROMPT.md`.
- **How to test now:** count `[stuck]`, `[stuck-world]` and `[dig]` lines in every run's agent log (CLAUDE.md,
  Testing agents); `pit_repro.py` must stay stall-free; `test_rescue.py` takes `MCAI_API`.
- **Test world state:** minevale3 holds Minevale25's green village (-1648..-1609, 27..66): reset before using it.
- **Working method that worked:** design review before code, diff review before each commit (each found real
  problems: a pillar regression in the watchdog, the dig wait), and a read-only research subagent on the server's own
  bytecode when the server was silent.

(written 2026-10-05 at the end of the fifteenth session: F138 reproduced and the design reviewed, no code changed; the
fourteenth session's notes below stay valid where not overridden)

- **Code:** unchanged since `e5efdef` (the session ran in a worktree whose edits to the main checkout were refused; its
  record was applied by the sixteenth session from `runs/2026-10-05/f138/HANDOVER.md`).
- **Stack:** left running at the end of the fifteenth session (pinned models 11435/11436 with no WARNING; test Paper 25566
  and test agent server 8767 at 2x, from `reset_site.py minevale3` at 11:37). minevale3 is dirty: the shore birch at
  -1657,-6 felled, pits at -1656,62,-6/-5, a chest at -1660,66,11 and a village **PitTest** (one registered chest, no plots)
  in `mc/testserver/villages.json`. Reset minevale3 before any run and check PitTest is gone.
- **Next: F138's leftovers in the user's order 3 -> 4 -> 1 -> (2 only if stalls remain)** (decisions of 10-05 s15;
  F143-F146). Item 3 first (the `[stuck]` line with a per-walk tick tally, F145), run `pit_repro.py` from
  -1655.5,62,-4.5 only (F144), read the mechanism, then decide item 4 with the user. Then F133, F131's leftovers.
- **Start sessions on the main checkout, not a worktree** (CLAUDE.md, Conventions).

(written 2026-10-05 at the close of the fourteenth session: V2.5 done)

- **Code:** committed on `tiered-brain-building` (`d2fda9a`, `05d9dbb` vanillaData.ts; `41d733c` renderer colours;
  `cda19c8` smelting from the jar; `34e205b` block lists from tags; the close-out commit: README, ARCHITECTURE,
  CLAUDE.md lessons 72-76, this handover), all pushed to origin at the close (the user said push). Check `git status -sb`.
  `main` untouched.
- **Stack:** stopped cleanly at the close (the test Paper "All dimensions are saved", the test agent server by PID, the
  pinned model servers). The main world did not run this session. No agents in either world. `ollama_exec.py status`
  gave no WARNING this session.
- **Where things stand:** the adapter's block and item lists come from vanilla's tags (`mcBlocks.ts`, the hand regexes
  as an all-or-nothing fallback, one `[vanilla]` log line at the first use), SMELT from the jar's smelting recipes,
  the renderer's colours from the client jar; loot tables stay on minecraft-data (`vanilla_drops.mts` checks they agree).
  Minevale23 (1x) 6/6 in 14.9 min on Minevale22's site (15.2); staged VanG6 and VanM3 8.3 min at 2x.
- **Next (the user's choice at the close): the backlog, F138's leftovers first** (then lamp posts or phase 3). The backlog (F138's leftovers: deposit
  gives up its side spots after a stuck that did not move the bot, a step out toward the goal inside `walk`, log the
  pathfinder's last update on "stuck", jump-up diagonals with a side solid at foot level; F133; F124, F126, F128, F130,
  F131's leftovers; V2.5's leftovers F139-F142), or phase 3 (talking to the mayor).
- **Test world state:** minevale3 holds Minevale23's green village at -1648..-1609, 27..66: reset before using it.
- **Main world:** unchanged this session.
- **How to test now:** as before, plus: `node_modules/.bin/tsx scripts/checks/vanilla_tags.mts [LIST]` (vanilla vs the
  hand lists, the waterlogged table; exit 1 on problems), `vanilla_recipes.mts` (the server's SMELT against the jar and
  the old table; exit 1 on lost parity), `vanilla_drops.mts [ITEM]` (loot tables against collect's drops),
  `python scripts/vanilla_colours.py` (hand vs jar colours); `MC_VANILLA_JAR=nope` runs anything on the hand lists;
  `render_design.py --colours hand` for the old colours. Run logs and renders: `runs/2026-10-05/`.
- **Working method:** as before. This session: four read-only inventories in parallel (one per part, each writing its
  comparison script), a design review (13 findings, among them a smelting filter that would have dropped cobblestone and
  a partly cached tag), three implementers on disjoint files, a diff review (7 lows). Capture every offline check's output
  before the change; compare a world check with the old code (stash, reset, run) before blaming the change.
