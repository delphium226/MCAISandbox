<!-- G2 bench v1's spec as built in s27 (code and data: runs/2026-10-11/s27/memory/). Superseded by v2; kept for its design and counts. -->

# Offline memory bench (G2): specification and dataset

Status: specification and dataset, built 2026-10-11 (s27). The harness that calls models is not written yet; this
document is its contract. Files in this directory:

| File | What it is |
|---|---|
| `extract_events.py` | Parses the ten model-driven village runs into events and per-agent streams (`data/`). |
| `data/events_all.jsonl` | Every event of every run, in life order (2,329 events). |
| `data/streams/<Agent>.jsonl` | What Mayor, Worker1 and Worker2 each saw, with decision points marked. |
| `data/villages/<run>.json`, `data/tasks.json`, `data/counts.json` | End-of-run records, task titles, counts. |
| `build_questions.py` | The 81 probes as code; locates every evidence quote in the logs and checks it precedes the checkpoint. |
| `questions.jsonl` | The probes (output of `build_questions.py`). |
| `checkers.py` | Reference implementation of the deterministic checkers, with a self-test. |

Regenerate: `python runs/2026-10-11/s27/memory/extract_events.py` then `build_questions.py` then `checkers.py`
(from the repo root; no server, no model). Each step is deterministic.

## 1. What the bench measures

The question is which mechanism lets an agent remember across hours and days, for the four purposes the user set:

1. **Competence**: what failed and why, where things are, how long work takes, what worked.
2. **Identity and relations**: the agent's role and own history, who helped or blocked it, commitments made and kept.
3. **Shared village memory**: what the village built, when and by whom, its history.
4. **G1 frustrations**: recurring failures worth a game change, remembered with their evidence.

Across these, three properties are tested on purpose: **long range** (facts from earlier days), **conflict** (a fact
that changed later: the latest must win; a false or stale belief must be dropped) and **restart** (memory must
survive a serialise-and-reload of the mechanism's state). Recall alone is not usefulness, so seven **decision
probes** ask for the better next action in a situation that went wrong in a later run.

The bench replays real agent experience to each mechanism at the cadence the brain would call a model, lets the
mechanism write and curate its memory, then asks probes at checkpoints. Every probe's answer is traceable to quoted
log lines. Mechanisms are compared on gpt-oss-120b (Ollama Cloud) for under $1 per full run of all six arms.

## 2. The dataset

### 2.1 Ten runs as a ten-day life

The ten most recent model-driven village runs (all "two matching cottages and a meeting hall", survival, test world,
the same agent names) are replayed in order as ten consecutive days in the life of Mayor, Worker1 and Worker2.
Every run began with `reset_site.py` (site restored from the snapshot, the previous village removed, both servers
restarted; e.g. `runs/2026-10-11/s27/reset_Minevale39.log`), so each day boundary is a real restart, and each day's
village is new: identities and experience carry over, places and stock do not. This is the cheapest honest
long horizon in the logs: 291.8 minutes of play per agent (14.6 agent-hours), over four real days.

| Day | Run | Date | Minutes | Complete at | Events | Watcher / agent-log | Failed actions | Executor | How it ended |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Minevale31 | 10-08 | 16.5 | 16.5 | 205 | 176 / 27 | 0 | qwen3:30b | complete |
| 2 | Minevale32 | 10-08 | 11.2 | 11.2 | 136 | 130 / 4 | 0 | qwen3:30b | complete |
| 3 | Minevale33 | 10-08 | 36.0 | 10.6 | 171 | 146 / 23 | 2 | qwen3:30b | agent server crashed (F188) |
| 4 | Minevale34 | 10-09 | 30.6 | 10.6 | 167 | 147 / 18 | 2 | qwen3:30b | complete + 20 min chores |
| 5 | Minevale35 | 10-09 | 41.0 | 11.0 | 220 | 176 / 42 | 0 | qwen3:30b | complete + 30 min |
| 6 | Minevale36 | 10-10 | 55.7 | 10.6 | 249 | 193 / 53 | 0 | qwen3:30b | complete + 45 min |
| 7 | Minevale37 | 10-10 | 20.6 | 10.4 | 217 | 154 / 61 | 0 | gpt-oss | watcher stopped at +10.2 |
| 8 | Minevale38 | 10-11 | 12.3 | 10.1 | 247 | 192 / 53 | 6 | gpt-oss | complete (chores ran on) |
| 9 | Minevale39 | 10-11 | 15.9 | never | 395 | 271 / 122 | 55 | gpt-oss | stopped: deposits failing (storage chests) |
| 10 | Minevale40 | 10-11 | 42.0 | 11.0 | 322 | 201 / 118 | 3 | gpt-oss | complete + 31 min of chores |

Days 1-7 are on site A (plot centre -1628,47), days 8-10 on site B (-1657,23). The events table adds 22 synthetic
`bench` events (10 day starts, 10 day ends, 2 mid-run restarts). Source logs: the watcher logs named in
`extract_events.py`'s `RUNS` and the agent-server logs beside them (`testagents-132644`, `-173200`, `-232316` of
10-08; `-141045`, `-203139` of 10-09; `-131013`, `-171346` of 10-10; `-161217`, `-162600`, `-164752` of 10-11,
matched by start and end times).

### 2.2 Events

Each line of `events_all.jsonl` is one event:

```
{"id": "Minevale36#0213", "run": "Minevale36", "day": 6, "village": "Minevale36", "t": 37.9, "t_life": 178.2,
 "t_quality": "watcher", "agent": "Mayor", "type": "action_done", "sub": null, "text": "breed_pen finished: ...",
 "fields": {"skill": "breed_pen", "born": 1, "in_pen": 3}, "visible": ["all"], "source": "watcher",
 "src": "runs/2026-10-10/Minevale36.log:151", "phase": "after"}
```

- `t` is minutes since the run's start (AFTER lines are converted with the completion time); `t_life` adds the
  earlier days (a minute between days).
- `type`: `action_done` 626, `board` 579 (task claimed/done/failed by someone), `system` 379 (plans, task steps,
  task taken or handed back, layout, completion), `action_failed` 68, `stock` 60 (storage snapshots), `slot` 37,
  `explore` 22, `board_closed` 15 (tasks closed by code, one event per board line), agent-log types `log_*` 521
  (`log_trees` 81, `log_pen` 53, `log_stuck` 47, `log_tiered` 42, `log_iron` 42, `log_prepare` 31,
  `log_pickaxe` 28, `log_choice` 27, `log_choice_end` 25, `log_explore` 20, `log_farm` 17, `log_dig` 17,
  `log_mine` 17, `log_parts` 15, `log_signs` 13, `log_annex` 12, `log_station` 10, `log_smelt` 9, `log_storage` 7,
  and a few others), plus the 22 `day_start`/`day_end`/`restart` events. Per-cell mine digging, pen hops, `[rcon]`
  and `[gate]` lines are dropped as too fine for a memory stream; posting of a layout's tasks is one `layout` event.
- `fields` holds what the extractor recovered: skill, items and counts, coordinates and boxes, design names, iron
  brought up and why the stairs stopped, pen animals and lead points, farm crop and seed source, scout outcome,
  task ids and titles (575 task titles), stock dicts, and the full `[choice]`/`[choice-end]` JSON.
- `t_quality` says how the time was found: `watcher` 1,786 (the watcher's own 0.1-minute stamps), `epoch` 52
  (`[choice]` timestamps), `inline` 7 (`t=` in the line), `anchor` 54 and `anchor_end` 19 (an agent-log line matched
  to a timed watcher event, `_end` meaning the matching event is the action's finish), `interp` 291 (interpolated by
  log order between anchors), `after_last_anchor` 97 and `before_first_anchor` 1 (lower bound only; mostly
  Minevale37 and Minevale39 after their watchers stopped). No probe depends on an interpolated time.
- `visible`: who saw the event. An agent sees its own events; everyone sees the village record: the layout,
  completion, board changes, storage snapshots, explore progress, and the results of building and chore skills
  (`build_design`, `prepare_site`, `dig_mine`, `tend_farm`, lamps, signs, annex, farms, pens, iron trips and tools,
  harvests, eggs, breeding, milk, scouting, stations, glass), which the real village log and summary show. Others'
  collect, deposit, craft, withdraw, `[stuck]`, `[pickaxe]`, `[storage]` lines are not visible. The Mayor alone sees
  its `[tiered]` plan lines. This is an assumption about today's prompts (open question 3).

### 2.3 The streams and decision points

`streams/<Agent>.jsonl` holds the events visible to that agent in life order, each with `own` (the agent's own
event) and `dp` (a decision point fires here, with its reason, or null).

| Agent | Visible events | Own events | Decision points (2-minute window) | Full history, compact |
|---|---|---|---|---|
| Mayor | 1,577 | 658 | 82 (task 41, chore 20, day end 10, gap 8, failure 3) | ~66k tokens |
| Worker1 | 1,547 | 795 | 101 (task 43, chore 40, day end 10, failure 8) | ~58k tokens |
| Worker2 | 1,516 | 727 | 87 (task 39, chore 26, day end 10, failure 10, gap 2) | ~56k tokens |

A decision point is where the brain calls, or under A.2/E.4 would call, a model: the agent's own plan or task step
(`New plan`, `Took task`, `Handed back`), its own failed action (an executor turn), a chore choice or chore result in
the after-phase (A.2's chore boundary), the day's end (dusk), and a `gap` after 25 visible events without one.
Candidates within 2 minutes coalesce into one decision point at the group's last event (no group crosses a restart
or a day boundary), so the batch it delivers holds the whole group. 270 decision points in all, an average batch of
17 events (~720 tokens). `--dp-window 1.0` gives 357. The workers' own model calls in the logs were few (code ran
their tasks as written; `plan 0x0ms` in most runs), so these points stand for the future controller's cadence, not
today's.

### 2.4 Restarts

- **Day boundaries** (9): the day ends with a `day_end` decision point (the mechanism may write), then the harness
  serialises the mechanism's whole state to JSON, discards the instance and loads a fresh one from the JSON. The
  next day starts with a `day_start` event saying the site was restored and the previous village is gone.
- **Mid-run restarts** (2, chosen by the bench): Minevale36 at 30.0 min and Minevale40 at 25.0 min, both in the
  after-phase with chores running (`MIDRUN_RESTARTS` in `extract_events.py`). These have crash semantics: no flush
  decision point first; the reloaded state is the snapshot taken at the last decision point. The world (village
  record) is unchanged.
- The harness snapshots the state at every decision point (cheap JSON), so "what survives a crash" is defined, and
  memory size is measured from the same snapshots.

Restart probes are asked right after a reload. Eight **pairs** ask the same question just before and just after a
restart (`pair` field: `pair-cow`, `pair-hut`, `pair-tools`, `pair-eggs`, `pair-stairs`, `pair-r36a`, `pair-r36b`,
`pair-r40a`).

### 2.5 The probes

`questions.jsonl` holds 81 probes:

```
{"id", "run", "agent", "checkpoint_minutes", "category", "purpose", "question", "answer", "checker",
 "evidence_lines": ["path:line: quoted text", ...], "tags", "day", "checkpoint_life", "evidence_events_back",
 "in_recent30", "recent30_share", "evidence_not_in_stream", "options"? , "outcome_lines"?, "pair"?}
```

| Category | Probes | Notes |
|---|---|---|
| competence | 14 | places (pumpkin source, chicken and cow lead points, sugar cane out of reach), durations (plot preparation 2.7 min, iron trips ~5 min, glass 26 s), failures and their causes, what worked |
| identity | 9 | own history and counts (raw iron brought up, eggs, chickens led, chores done, tools made), role |
| relations | 10 | who built or made what, who held the furnace or the chest spots, a task handed back, a note to self kept |
| village | 13 | build order and builders, completion minutes of every village, farms, cow pen and milk, how day 3 ended, the iron age of day 10 |
| g1 | 7 | recurring problems with evidence and a proposed fix: iron stairs on caves/gravel/water, glass smelts out of fuel, storage chests in the hut, the scout point in water, the furnace short of cobblestone, farm starts |
| conflict | 11 | latest wins (storage hut moved between sites, stock after chests were mined, pens 2 -> 3 -> 4, stairs start, milk) and stale beliefs (a farm or storage of a village that is gone) |
| restart | 10 | asked right after a day boundary or a mid-run restart |
| decision | 7 | choose A-D in a situation that later went wrong (smelting without fuel, chests blocking the storage hut, the scout point in water, iron trip budget, out-of-reach cane, furnace short of cobblestone) |

By purpose: competence 32, village 26, identity 16, g1 7. By agent: Mayor 29, Worker1 28, Worker2 24. By day of
the checkpoint: 3:1, 4:1, 5:4, 6:15, 7:9, 8:11, 9:11, 10:29. Tags: 31 `long_range`, 25 `after_restart`, 4
`control_recent`.

How far back the answers lie (computed by `build_questions.py` against each agent's stream):

- 44 of 81 probes need evidence from an earlier day (across at least one restart): 1 day back 20, 2 days 9,
  3-4 days 4, 5-9 days 11. The oldest evidence is a median 16.5 play-minutes before the checkpoint, at least an
  hour for 22 probes and two hours for 11 (up to 232 minutes).
- Today's prompts see the events since the agent server last started, at most 30 (the planner's window). Only 24
  probes have any evidence line in that window, and only 10 have all of it there: the 4 controls (which every arm
  should answer) and 6 others (two "before restart" twins, `comp-dur-03`, `conf-05`, `dec-05`, `dec-07`).
- Every evidence line is at or before the checkpoint (checked); for decision probes, what happened afterwards is
  in `outcome_lines` and never shown to a model.

**Split.** Tune prompts and parameters on the 30 probes of days 3-7 (dev) and report on the 51 of days 8-10
(test). The set is small; tuning on all of it would overfit.

### 2.6 Limits of the data

- Three agents, two sites, one objective. Relations are thin: there is no chat content in the logs (3 messages
  in Minevale38, text not logged), no opinions, no promises between agents; relations probes use who-did-what,
  blocking (furnace, chest-spot claims), task claims handed back, and the Mayor's notes to itself.
- Chores ran in a fixed order (`reason: "fixed order"`); the agents chose nothing after completion. Decision probes
  are therefore counterfactual: they ask what a remembering agent should choose, scored against what happened.
- The model prompts and replies are not in these logs (`[tiered]` plan lines only). The bench cannot replay what
  the executor saw turn by turn; it replays the events those turns produced.
- Agent-log lines carry no time stamps before Minevale38's `[choice]` lines; their times are anchored or
  interpolated (see `t_quality`).

## 3. The replay protocol

### 3.1 The mechanism interface

Every arm implements the same interface (Python or TypeScript; the harness is the next step):

```
init(agent, role, shared)        # shared: the village-level store all three agents of the life share
observe(batch, dp)               # at a decision point: the new events since the last one; may call the model
serialize() -> JSON              # the whole state; nothing may live outside it
load(JSON)                       # a fresh instance from a snapshot
view(questions, now) -> text     # the memory part of the probe prompt; may call the model (read only)
sleep(day_info) -> None          # optional: at day_end (and mid-run nights in a variant), arms C and F
```

The harness replays the three agents together in global `t_life` order, so writes to the shared village store
interleave as they would live. At each event it appends to the agent's recent window; at each of that agent's
decision points it calls `observe` with the batch; at each restart it serialises and reloads every agent (crash
semantics mid-run); at each checkpoint it asks that agent's probes. Probes never write memory.

### 3.2 Rendering events (identical for every arm)

One line per event, newest last, truncated to 300 characters (the first line is a real event; the others show the forms):

```
#Minevale36#0213 [d6 37.9m] Mayor: breed_pen finished: fed 2 chickens wheat_seeds in the pen on annex slot 3: ...
#Minevale36#0098 [d6 25.4m] you: make_iron_tool finished: made a iron_pickaxe (...)
#Minevale36#0050 [d6 7.2m] board: t9252 claimed by Worker1 (Build plains_meeting_point_2)
#Minevale36#0051 [d6 7.4m] storage: 141 oak_log, 136 birch_log, 8 dirt, 8 raw_copper, 1 wheat_seeds
#Minevale37#0000 [d7 0.0m] village: Day 7 (2026-10-10): the agent server restarted and the test site was restored ...
```

The `#id` prefix is shown to arms E and F (provenance) and omitted for the others.

### 3.3 The probe prompt (identical except the memory section)

```
system: You are {agent}, {role} of a Minecraft village. Answer from what you remember and what you see below.
        If you do not know, say so; do not invent numbers or places.
user:   ## What you remember
        {mechanism.view(...)}                                   (empty for arm A)
        ## Recent events (since the agent server last started, at most 30)
        {rendered recent window}
        ## The village now
        {village snapshot: today's village name, structures built today with builders and boxes, the latest
         storage line, open and claimed tasks, the last 6 village-record lines}
        ## Questions
        1. [{id}] {question}  -- reply fields: {checkers.answer_format(checker)}
        ...
        Reply with a JSON list: [{"id": "...", "answer": "<text>", "values": {...}}]
```

Every arm gets the same recent window and village snapshot, as every real prompt does; memory is judged by what it
adds. Probes at the same agent and checkpoint are asked in one call (65 calls instead of 81: 58 recall groups and
7 decisions). Decision probes are asked one per call with the options listed and the reply
`{"answer": "<one-sentence reason>", "values": {"choice": "A".."D"}}`. All probe calls use reasoning `low`;
arms D-F may make one `archival_search` call first (so up to two calls).

### 3.4 Scoring

- Deterministic checkers (`checkers.py`): `numeric` (value within `tol`), `numeric_list`, `numeric_fields`
  (named values), `coord` (x and z within `tol`), `boolean`, `choice`, `field_in` (a named field such as `who`),
  `contains_all` / `any_of` / `none_of`, `set` (recall over synonym groups, `min_recall`), `sequence` (order kept,
  `min_score`), and `all` (every sub-check). `stale` lists values that were true earlier: an answer is **stale**
  when it is wrong and matches one. The self-test passes 56 of 56 deterministic probes on gold responses.
- `rubric` (25 probes): a judge call (gpt-oss, reasoning `medium`, temperature 0) sees the question, the reference
  answer, the rubric and the candidate answer, and replies `{"score": 0|1|2, "reason": "..."}`; scored /2. The
  judge never sees which arm answered. Calibrate it once by hand on ~20 judgements (open question 6).
- Each probe scores 0..1. Pairs score both halves separately.

## 4. Metrics

Reported per arm, on the test split (and dev for tuning):

1. **Accuracy** per category, per purpose and overall, with the recency-only controls shown apart (they check the
   harness: every arm should get them).
2. **Long range**: accuracy by how far back the evidence lies (same day / 1 day / 2+ days) and by
   `evidence_events_back` bucket (under 30, 30-300, over 300).
3. **Restart survival**: accuracy on `after_restart` probes; for the 8 pairs, the after-score over the
   before-score (1.0 = nothing lost); and whether `load(serialize())` reproduces `view()` exactly for a fixed
   question (a cheap determinism check per snapshot).
4. **Stale and false beliefs**: the share of conflict probes answered with a superseded value, and of
   false-belief probes (`conf-06`, `conf-07`) answered yes. Optional audit: at each day start, a judge reads the
   arm's memory view and lists statements presented as current that refer to a village that is gone (cost below).
5. **Decisions**: accuracy on the 7 decision probes.
6. **Cost**: model calls and input/output tokens, split into writes (observe), sleep, reads (view) and answers;
   per agent-hour of play (14.6 agent-hours in a run) and per full run in dollars ($0.15/$0.60 per M).
7. **Memory size growth**: serialised state in tokens (len/4) at every day end, per agent and shared; growth per
   hour; core-block fill.
8. **Write behaviour** (D-F): tool calls per decision point, share of decision points with no write, writes refused
   by E's guards and why, supersessions, expiries.

Variance: model-managed arms are not deterministic. Run every arm once to screen; run the two leading arms three
times (lesson 20: judge on more than three samples) and report the spread.

## 5. The mechanisms

Shared: model `gpt-oss:120b-cloud` through Ollama (`/api/chat`, tools in Ollama's format); reasoning `low` for
writes and answers, `medium` for sleep, reflection and the judge; at most 3 requests in flight (the Pro plan's
limit); the harness keeps its own token ledger and stops at $1.20. Normalise tool calls in code (lesson 11: gpt-oss
writes arguments as strings, steps as objects).

### A. Baseline: today's state

No memory. `view()` returns nothing; the probe prompt has only the recent window (since the last restart, at most
30 events) and the village snapshot, which is what today's planner sees (`memory.notes` from `set_plan` is not
reproducible offline and is left out). A restart empties the recent window; the village record survives a mid-run
restart but not a day boundary (that village is removed). State: none. Cost: answers only.

### B. Plain full history

Code keeps every visible event since day 1 (persisted, so it survives restarts). `view()` renders them newest last,
cut from the oldest to a budget of **8,000 tokens** (variant B32: 32,000 tokens, ~$0.3 more a run). No model calls
while replaying. This is LightMem's strongest baseline (full history 74.9 on LoCoMo for Qwen3-30B) made affordable;
it shows how far plain context goes. State: the event list.

### C. Code-written journal, code retrieval (the old plan: A.4/E.2)

- **Journal**: one record per visible event, written by code, with an importance by rule: own failure 8; first
  success of a skill or chore kind for this agent 7; a new place (a build box, farm, pen, annex, sighting or lead
  point, scout end) 6; a chore outcome or an iron trip 4; a task taken, done or handed back 2; routine collect,
  deposit, board and storage lines 1. Records keep `scope` (`village:<name>` for places, counts and board state,
  `life` otherwise).
- **Kind table** (ExpeL's counters, in code): per agent and kind (skill or chore), attempts, successes, minutes and
  yield (raw iron, eggs, milk, animals, cobblestone), from `action_done`/`action_failed` and `[choice-end]`.
- **Nightly reflection** at each `day_end` (A.4 as planned): one call, reasoning `medium`, input = the kind table,
  the day's records of importance >= 4 and the current lessons; output = at most 5 insights and add/update/delete
  edits to at most 10 lesson bullets, each with helpful/harmful counters; code applies the edits.
- **Retrieval** for `view()`: score = recency (0.99 per play-minute since the record) + importance/10 + BM25
  relevance to the question text (normalised to 0..1); records of a gone village get their village name and "gone"
  added; top 12 records (~1,200 tokens) + the table (~400) + the lessons (~300).

### D. Model-managed core memory (MemGPT/Letta style)

**State.** Core blocks (character limits), shown in every write and probe prompt:

| Block | Limit | Who writes |
|---|---|---|
| `persona` | read only | code: "You are Worker1, a builder in the village Minevale36." (the village name updated at day start) |
| `self` | 1,200 | the agent: its own history, achievements, counts |
| `relations` | 800 | the agent: who did what with or against it, commitments and whether kept |
| `places` | 800 | the agent: where things are and in which village |
| `lessons` | 1,000 | the agent: what fails and why, what works, how long things take |
| `frustrations` | 600 | the agent: recurring problems with counts and when (G1) |
| `village` | 1,200 | shared by all three agents: the villages' history and rules |

plus an **archival store** per agent and a shared one (unbounded list of `{id, text, tags, t_life, day}`), searched
by BM25 (no embeddings, so the bench needs no extra model).

**Write path** (`observe`, at each decision point). One model call (two if the first calls `archival_search`), at
most 6 tool calls applied:

```
system: You keep the long-term memory of {agent}, the {role} of a Minecraft village. Below is your memory and what
        has happened since your last update. Keep what will matter in hours and days: what failed and why, where
        things are, how long work takes, what worked, who did what for or against you, commitments made and
        whether they were kept, the village's history, and problems that keep coming back. Do not copy routine
        events (a deposit that worked, a board change) unless they change what you know. When a fact changes (a
        count, a place, a state), replace the old text instead of adding a second version; when a village is gone,
        say so. Stay within each block's limit by shortening older text. Call no tool if nothing is worth keeping.
user:   ## Your memory
        [persona] ...   [self 412/1200] ...   [relations ...] ... [village (shared) ...]
        Archival: 37 entries of yours, 12 shared (search with archival_search)
        ## Since your last update (day 6, 27.1-29.4 min, 14 events)
        {rendered batch}
tools:
  core_memory_append {block: "self"|"relations"|"places"|"lessons"|"frustrations"|"village", text: string}
  core_memory_replace {block: ..., old: string (an exact substring of the block), new: string ("" deletes)}
  archival_insert {text: string, tags: string[], shared: boolean}
  archival_search {query: string, k: integer <= 5}
```

A write that would exceed a block's limit is refused with the block's size, never truncated (lesson 2: the message
tells the model what to do: shorten or move text to archival).

**Read path** (`view`): the core blocks, plus the results of one optional `archival_search` the answering model
issues before answering (tool offered in the probe call).

**Restart**: the blocks and stores are the state; nothing else exists.

### E. Model-managed plus code guards

D's tools and prompts, with code that checks every write before applying it (refusals go back to the model in the
same decision point as a tool result; at most one retry):

1. **Provenance**: every write carries `cites: [event ids]` (from the batch, shown as `#id`) or archival ids;
   writes without a valid cite are refused ("cite the events this comes from").
2. **Numbers and places from evidence**: every coordinate and every number of two or more digits in the new text
   must occur in a cited event (or in the text it replaces); otherwise refused, naming the number. This blocks
   invented places and counts (the AI Village contact-list failure).
3. **Keys and supersession**: `archival_insert` takes an optional `key` (`place:storage_hut`, `count:chickens`,
   `state:iron_stairs`, `who:built:storage_hut`); a new entry with a key that exists in the same scope supersedes
   the old one, which stays in history but leaves search results unless asked for.
4. **Scope and expiry**: an entry citing village-scoped events (places, counts, board, storage) gets
   `scope = village:<name>`, others `life`. At `day_start`, code moves core text and archival entries of the old
   village scope to "past" (prefix `[past: Minevale37, gone since day 8]`), removes them from core blocks, and says
   so in the next batch. `count:` keys not reconfirmed for 30 play-minutes are shown as "(possibly stale)".
5. **Validation against the world record**: a `place:` entry must lie within 3 blocks of a structure, plot, farm,
   pen, sighting or lead point recorded in its scope's events; a `who:` entry must match a build or chore event's
   agent. In the live game these checks read `villages.json` and the atlas.
6. Block limits as in D.

### F. Model-managed with sleep-time consolidation

E's write path during play, plus a **sleep** step on the village clock (LightMem's offline consolidation, ACE's
edit-not-rewrite):

- **Night** at every `day_end` (variant F20: also every 20 play-minutes, E.2's 20-minute day, which adds 9 nights).
- **Per agent** one call, reasoning `medium`. Input: the core blocks; the day's archival entries; a code summary of
  the day (the kind table of arm C: attempts, successes, minutes, yield per kind; failures grouped by message with
  counts and first and last time); the current lessons with counters; the frustrations block.
  Output (JSON, applied by code through E's guards, at most 12 operations, never a whole-block rewrite):
  `{"edits": [{"op": "add"|"update"|"delete", "target": "<block>|<archival id>", "text": "...", "cites": [...]}],
    "lessons": [{"id": "L3"|null, "text": "...", "helpful": +n, "harmful": +n}],
    "frustrations": [{"text": "...", "count": n, "days": [...], "cites": [...]}],
    "day_summary": "<= 80 words"}`
  Lessons whose helpful minus harmful falls to -2 are deleted by code (ExpeL); the day summary goes to archival.
- **Village chronicle**: one call per `day_end` over the day's village-visible events and the shared block: a
  chronicle entry of at most 120 words (what was built, by whom, what went wrong, what was new) into the shared
  archive, and edits to the shared `village` block.

## 6. Cost of one full run

Assumptions, to be replaced by the first run's ledger: write call ~2,400 input (instructions and tools ~800, core
memory ~900 on average, batch ~720) and ~220 output tokens at `low`; probe call 2,200 (A), 8,500 (B), 4,000 (C) or
3,500 x 1.3 calls (D-F) input and ~300 output; sleep ~5,000 in / 1,200 out at `medium`; C's reflection
4,000 / 800; chronicle 4,000 / 800; judge 1,200 / 150 at `medium`. 270 decision points, 30 agent-nights, 10
chronicles, 65 probe calls per arm, 25 rubric probes.

| Arm | Replay calls | Replay $ | Probe $ | Total |
|---|---|---|---|---|
| A today | 0 | 0 | 0.033 | 0.03 |
| B full history (8k) | 0 | 0 | 0.095 | 0.10 |
| C code journal + nightly lessons | 30 | 0.032 | 0.051 | 0.08 |
| D core memory | 270 | 0.133 | 0.060 | 0.19 |
| E core memory + guards | ~300 (10% retries) | 0.146 | 0.060 | 0.21 |
| F = E + sleep (+ chronicle) | ~340 | 0.201 | 0.060 | 0.26 |
| Judge (25 rubric probes x 6 arms) | 150 | | 0.040 | 0.04 |
| **All six arms** | ~1,150 calls | | | **~$0.91** |

Optional: the day-start belief audit adds ~$0.02 per arm; F20's extra nights ~$0.04; B32 ~$0.30; three seeds of
the two leading arms ~$0.5. Wall time: the arms are independent, so they run in parallel within the 3-request limit;
a model-managed arm is ~300 sequential calls at 2-4 s, 10-20 minutes. Run the bench only when no village run is
using the cloud (E.0's gate and budget live in the agent server, not here).

For scale: the 270 write calls are 18.5 per agent-hour; at 25 agents that is ~460 calls an hour for memory writes
alone, before probes, which the live design must weigh against the 3-request limit.

## 7. Open design questions

1. **A life made of separate villages.** The ten days share identities but not villages, so "a village that
   persists across restarts and days" is tested only by the two mid-run restarts. A real multi-hour run with
   restarts of one village (E.2's `respawn_agents.py`) would make a second, truer dataset; until then, shared
   village memory is mostly tested within a day.
2. **Decision points are a proxy.** The workers barely called models in these runs; the bench's cadence (task,
   failure, chore, gap; 2-minute coalescing) stands for A.2/E.4's controller. Should the cadence follow the planned
   controller exactly (one decision per chore boundary) once it exists, and should batches be capped in size?
3. **What each agent sees** is an assumption (section 2.2). Others' collect/deposit and `[stuck]` lines are hidden;
   board and storage lines are shown to everyone. If the live prompts differ, the shared-memory probes change
   difficulty.
4. **Recall cues.** Questions name their topic, which favours retrieval by text (C's BM25, archival search). The
   decision probes are the only cue-free usefulness test, and there are only 7; more need runs where the agents
   actually choose (A.2) and situations recur.
5. **Relations are thin** (no chat content, opinions or inter-agent promises in the logs). The relations purpose is
   tested on who-did-what, blocking and self-commitments only; social memory needs data from E.3/E.5's acts.
6. **The judge is the same model family as the answerer.** 25 of 81 probes are rubric-scored; self-preference and
   leniency are possible. Calibrate by hand on ~20 judgements, or move more probes to deterministic checks by
   asking for structured fields.
7. **Recency is given to every arm.** That is realistic (prompts always carry recent events) but compresses the
   differences between arms on recent probes; report accuracy on the non-recent probes separately (71 of 81).
8. **Crash semantics.** Mid-run restarts reload the last decision point's snapshot; a live system that persists
   after every write (E.2's debounced snapshot) could lose up to its debounce interval. Should the bench model that
   (e.g. drop the last write)?
9. **Is G1 a memory or a report?** Frustrations could be counted entirely by code (failure messages grouped over
   days) and only phrased by the model. The g1 probes cannot tell a model that remembered from code that counted;
   E and F mix both.
10. **Guards may hide the model's skill.** E's number-from-evidence rule refuses summaries that compute (a total of
    8 raw iron across days is not in any single event). Should computed numbers be allowed when every addend is
    cited?
11. **Expiry rules are guesses** (30 play-minutes for counts, "gone" at day start). They need the live E.2 clock
    and real multi-day villages to tune.
12. **Small and uneven set.** 81 probes, 29 on day 10, Worker2 the fewest; one run's accuracy differences of under
    ~10 points are noise. Grow the set from each new long run (`build_questions.py` makes adding probes cheap: a
    question, a checker and quoted evidence).
13. **Mixed executors.** Days 1-6 had qwen executors, 7-10 gpt-oss. The events are what the code did either way,
    but the failure mix differs (Minevale39's 55 failures came from gpt-oss executors improvising).
14. **Scale.** Three agents and one shared block; at 25 agents a shared village block written by everyone needs
    ownership or merging rules the bench does not test.
