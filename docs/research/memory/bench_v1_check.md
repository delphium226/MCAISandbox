<!-- The adversarial check of G2 bench v1 (s27). Its section 6 lists the fixes v2 needs. -->

# Adversarial check of the offline memory bench (G2)

Checked 2026-10-11 (s27) against `bench_spec.md`, `extract_events.py`, `build_questions.py`, `checkers.py`,
`questions.jsonl` and `data/`. Nothing in this directory was edited except this file: the extractor was run with
`--out` into the scratchpad, and `build_questions.py` was run on a scratch copy. The bench's data files have the same
checksums as before the check.

## Verdict

**Not ready to run.** The extractor is sound and deterministic, and the 262 quoted evidence lines are real. But the
probe set measures far less memory than the spec claims, for three reasons:

1. **Leakage.** The answers reach every arm, arm A included, through the village snapshot the spec defines, the
   synthetic day-start text, the decision options and the question texts.
   - 21 of the 69 non-control, non-"before" probes can be answered without memory.
   - On the test split only 27 clean probes remain. All 7 test-split conflict probes and 6 of the 7 decision probes
     leak.
2. **Checker bugs.** These turn non-answers into correct answers and correct answers into wrong ones.
3. **Too few items.** With the leaks removed, the test split cannot separate arms D, E and F, and the stale-belief
   and decision metrics have no clean test items at all.

All of this can be fixed cheaply (section 6), mostly in `build_questions.py`, `checkers.py` and the spec. Fix the
blocking items first, then run arm A, a no-context control A0 and an oracle arm to screen the probes before spending
on D-F.

## 1. The extractor (run and output verified)

- `extract_events.py --out <scratch>` ran in under a second. `events_all.jsonl`, the three streams, `counts.json`,
  `tasks.json` and the village files are byte-identical to `data/`. `build_questions.py` on a scratch copy reproduces
  `questions.jsonl` byte for byte, and the checker self-test passes 56/56.
- **Counts are as stated:**
  - 2,329 events: 1,786 watcher, 521 agent log, 22 bench.
  - Types and time qualities match section 2.2.
  - `t_life` is monotonic, and no event of a run comes after its `day_end`.
- **Board extraction is correct.** I diffed every BOARD line of Minevale31, 36, 39 and 40 myself.
  - Every non-open transition is either a `board` event or covered by a `board_closed` event; 0 are unexplained.
  - Re-opened tasks are kept (e.g. t11103 and t11143 in Minevale39).
  - Newly posted open tasks are dropped by design.
- **All 262 evidence quotes exist at their cited line.** Every one maps to an event in the asking agent's stream at
  or before the checkpoint, so none is invisible to the agent.
- **Spec inaccuracies (minor):**
  - (a) "No probe depends on an interpolated time" is false. These probes have `interp` evidence: rel-01, rel-06,
    rst-01/01b, rst-03/03b and comp-dur-04. rel-01's second line sits at an interpolated 13.75 min against a 14.0
    checkpoint. comp-place-06 also cites an `after_last_anchor` line.
  - (b) Only 9 probes, not 10, have all their evidence in the 30-event window. ctl-04's role line is outside it;
    the system prompt gives the role anyway.
- **Lower-bound times bunch up.** All `after_last_anchor` events of a run share one timestamp:
  - Minevale34: 10 events at 14.6, though the run went on to 30.6.
  - Minevale37: 34 events at 20.6.
  - Minevale39: 39 events at 15.5.

  They collapse into one decision-point batch and distort "events back". This is fine for now, but flag these
  events in renders.
- **The dev and test days are not the same distribution:**
  - STOCK lines exist only in Minevale38-40 (60 events, about one every 0.5 min). They dilute the 30-event window on
    the test days only, and conf-01 and conf-07 exist only because of them.
  - The executors are gpt-oss from day 7.
  - The after-phases of Minevale38-40 come only from agent-log lines; the watcher stopped at completion.

  Report results per day and per evidence source.
- **The visibility model is an assumption the probes lean on hard.**
  - 12 probes have only agent-server console lines as evidence: comp-dur-03, comp-dur-04, rel-01, rel-06, rel-08,
    vil-08, conf-04, conf-08/08b, rst-03/03b, ctl-02. These lines are `[parts]`, `[furnace]`, `[storage]` and
    `[choice-end]`, and no agent's prompt ever contains them.
  - Today chore events carry `chore: true` and the brains ignore them (CLAUDE.md lesson 93).
  - So these probes assume A.2's controller will feed chore results and these diagnostics to the agent. State this
    in section 2.2, or render such lines as the action events the controller would push.
- **The synthetic events are oracles.**
  - `day_end` texts tell the agent things it never experienced, e.g. "the agent server crashed (the watcher lost its
    connection)" and Minevale39's watcher stop reason.
  - vil-06, g1-07, vil-02 and vil-07 are answered from these bench-written sentences.

## 2. Probe verification (sample of 58 probes, every category)

I grepped each probe's evidence and, where needed, the surrounding log: all iron trips of Minevale33-40, all pen,
egg, breeding and milk lines, farms, glass and furnace failures, storage-hut failures, completions, lamps and signs,
and plot preparation. I also checked the agent's window and an approximation of the spec's village snapshot. The
snapshot approximation is today's `build_design`/`build_box`/`prepare_site` results with builders, the latest STOCK
line, and the last 6 village-visible lines, which is what the real `villages.summary` shows; see section 3.

**Correct and needing memory** (answer checked against the logs):
- comp-place-01, 02, 03 (+03b), 06
- comp-dur-02, 04
- comp-fail-01 (+01b; 7 failures at 5.8-8.5 confirmed), 02, 03 (five first trips at -1610,33,73), 04
- comp-work-01, 02 (8 = 5+1+2)
- id-02 (+02b), 03, 04 (+04b), 06, 07
- rel-04, 05, 06, 08, 09
- vil-03, 05, 06, 07, 08, 10
- g1-01, 02, 03, 04, 05, 07
- conf-02, 03
- rst-01 (+01b), rst-02 (+02b; 7 = 5+2)
- dec-02

**Defects:**

| Probe(s) | Defect | Kind |
|---|---|---|
| comp-place-04, g1-06 (reference), dec-05 (option B) | They say the cane at -1651,64,193 was "beyond the 160-block reach". It is ~148 blocks from the plot centre (-1628,47); Chebyshev 146. The log line says collect *found* none within 160, which is not the same thing. The rubric demands a cause that is geometrically false: a model that computes distance is marked down, one that parrots "beyond 160" gets full credit. | wrong answer |
| rel-02 | "Who built the storage hut?" The snapshot lists `storage_hut ... by Worker2`. It is tagged long_range but answered by arm A. | leak (snapshot) |
| vil-01 | Build order and builders are exactly the snapshot's structure list (record order = build order, with `builtBy`). | leak (snapshot) |
| comp-place-05 | The storage hut's box in the snapshot gives its centre, -1658,8. | leak (snapshot) |
| comp-place-07 | The plot centre is in the snapshot (prepare_site parts / plot box). The memory half ("same as Minevale37?") is not scored by the `coord` checker at all. | leak + checker scores the wrong half |
| conf-01 | The latest STOCK line (8.9 min, birch_log 16) is in both the window and the snapshot. | leak (window) |
| conf-04, vil-04, rel-03, conf-05 | The latest state is in the window (and in the snapshot's last lines): "stairs 40 steps (level y=18)", "4 in the pen", "Mayor milk_cows". `recent30_share` < 1 hides this: conflict evidence lists also cite the old values, so the share undercounts answerability. | leak (window) |
| conf-08 (after restart), rst-03 (after restart) | After the mid-run restart the window is empty, but the snapshot's last village lines still say "new ones start at -1627,58,19" and "(chicken, 3 in the pen)". The pairs pair-stairs and pair-r40a therefore score 1.0 for every arm, arm A included. | leak (snapshot) |
| conf-06, conf-07 | The `day_start` text in the window says "village Minevale37 and everything in it is gone" (conf-07 also has `STOCK {}`). The false-belief probes are answered by the bench's own sentence. | leak (synthetic text) |
| vil-09 | "How many villages before this one?" The `day_start` line says "Day 8 ... You join the new village Minevale38", so the answer 7 (and the names 31-37) follows from it. | leak (synthetic text) |
| dec-03, dec-04, dec-05 | The correct option contains the remembered fact: "it has stopped 13-24 blocks short in water twice", "in past villages the first raw iron came on the 3rd to 5th trip ... y=18", "that cane is beyond the 160-block reach". | leak (options) |
| dec-01, dec-06 | Solvable from the question alone: "carry no fuel" makes A an obvious mistake; "needs 8, storage has 6, you carry none" makes B arithmetic. | leak (question) |
| dec-05, dec-07 | All evidence is in the window, and dec-07's question restates the history. Tagged `lesson`, not control. | not a memory probe |
| all 7 dec-* | Answers are B×5, D×2. The correct option is always the longest and most hedged ("stop retrying and hand back ..."). Position and length bias alone will score well. | answer bias |
| vil-02 | Asked in one call with g1-07 ("What stopped Minevale39...") and rel-05 ("In Minevale39 ... the failed storage_hut task"), whose texts give away "Minevale39 was not completed". | leak (grouped call) |
| id-05, comp-dur-01, id-01 | Guessable. id-05's set (wheat/seed, sand, dirt, cobble, log; min_recall 0.6) passes on a generic "logs, cobblestone, sand, dirt" (tested: recall 0.80). comp-dur-01 accepts 2.3-3.1, so "about 3 minutes" passes. id-01's synonym "led" matches "failed"/"called"/"filled". | weak checker |
| rel-04 | The reference omits that t11143 then failed at 14.7 (before the 15.8 checkpoint). This is harmless to scoring but incomplete as a "commitment kept" record. | minor |
| rel-10 | Leaks if the snapshot lists who prepared each plot part; the spec does not say. | ambiguous (snapshot spec) |

The spec's leak-free claim of "only 10 answerable from the window" should read "at least 25 answerable without
memory" (window 9, latest-value-in-window 4, snapshot 6, synthetic text 3, options or question 4, grouped call 1),
plus about 3 guessable.

## 3. Do the probes need memory beyond the last 20-30 events?

**Some do; fewer than claimed, and the spec's checks cannot see that.**
- `build_questions.py` computes `in_recent30` from the evidence lines only. It never looks at the village snapshot,
  at the synthetic day text, at sibling questions in the same call, or at the options.
- The village snapshot is not defined in code ("structures built today with builders and boxes, the latest storage
  line, open and claimed tasks, the last 6 village-record lines"). The live `villages.summary` shows the same things:
  builders, the board with results, the mine line, and the village log, which `note()` fills with chore results.
  So the leaks are real in the live game too. The snapshot is not wrong; the probes ask what it already holds.

After removing the leaks above, the twins asked before a restart and the controls, **48 probes remain (42 strict)**:
**15 on the dev split and 27 on the test split.**
- Test, by category: competence 4, restart 3, identity 2, relations 6, village 5, g1 6, decision 1, conflict 0.
- The latest-wins and false-belief metrics (section 4, metric 4) have **no clean test item**.
- Decisions have one: dec-02.

The bench's window is also not today's window:
- Real executor and planner events are the agent's own action results, `system` lines, chat, pickups and breaks.
  Board diffs and STOCK lines (639 of about 1,550 events per stream) never enter real event lists; they live in the
  summary.
- Real prompts show only events not yet shown.

The direction of the error varies, so state the window as a bench convention and not as "today's state".

## 4. Can the candidates and metrics decide? Is the cost right?

**Power.**
- 27 clean test probes give a 95% interval of about ±18 points on one arm's accuracy.
- D, E and F will differ by less. Screening every arm once and then seeding only "the two leading arms" will pick on
  noise. Per-category accuracy on the test split rests on 0-6 items.

**Missing reference arms.**
- **(a) An oracle-evidence arm.** It is shown the probe's own evidence lines. It is the ceiling for the answerer plus
  the checkers, and it validates every probe for about $0.03.
- **(b) B-full.** The whole visible history is about 56-66k tokens per agent, and Ollama Cloud reads long prompts
  whole (lesson 118); about $0.6 a pass.
  - B at 8k is the last ~190 events, roughly the last 15-25 minutes. That is a longer recency window, not
    LightMem's "full history" baseline.
  - Without B-full the bench cannot reproduce the comparison that motivated the old plan, so "model-managed vs full
    history" stays undecided.
- **(c) A0.** No window, no snapshot, no memory: it measures the prior and guessability.

**Confounds.**
- **View budgets differ.** C shows about 1,900 tokens; D-F show core blocks of up to ~1,400 tokens plus one search;
  B shows 8,000. "Mechanism" is confounded with "tokens shown". Equalise (e.g. 2k and 8k tiers), or report accuracy
  against tokens in view.
- **E's guard 2 refuses aggregated numbers.** At least 9 probes want sums or averages: comp-work-02 (8), rst-02 (7),
  id-03 (2), id-04 (5), vil-05 (3), comp-dur-01 (2.7), comp-dur-02, vil-02, id-02. E and F lose these by
  construction, so "guards hurt" would be an artefact. Decide open question 10 before the run: allow a number whose
  addends are all cited.
- **Restart survival is tautological as specified.** The state is plain JSON, so `load(serialize())` reproduces it
  by definition. The before/after pairs mostly measure the loss of the recent window, which is the same for every
  arm. For D-F the "before" answer may come from the window, not from memory.
  - What matters is whether memory *had written* the fact before the restart, and whether writes since the last
    decision point are lost mid-run.
  - Score the pairs with a memory-only prompt (no window, no snapshot), and add pairs whose evidence lies between the
    last decision point and the crash.
- **G1** cannot separate remembering from code counting (spec question 9). Add a variant where code counts and the
  model only phrases, so you know what the model adds.
- **No direct memory-precision measure.** LightMem's finding was that model-managed memory holds wrong or invented
  content. At each day end, sample memory statements and check them against the cited events (the optional audit
  covers only gone villages).

**Cost.** The arithmetic of section 6 is right for its assumptions, but the assumptions are low.
- **Write output.** 220 output tokens per write at `low` with up to 6 tool calls (reasoning bills as output) is
  optimistic: the runs' own ledgers show ~200 per plan call at low and ~490 per executor call at medium (Minevale40
  USAGE).
- **Write input.** D-F writes may take a second call after `archival_search`, which the write estimate omits.
- **Probe input.** Probe inputs exclude the snapshot (full build lines, 6 log lines of up to 400 characters), so
  A's 2,200 and B's 8,500 are 20-40% low.
- **Realistic total:** model-managed arms ~$0.25-0.40 each, so ~$1.3-1.9 for one pass of all six.
  - The global **$1.20 stop would cut the first pass**.
  - Use per-arm caps, pilot one day (day 8) per arm to calibrate, and budget ~$4-6 for three seeds of D-F plus
    B-full and the oracle arm. This is still small.

## 5. What would make results misleading

- **Checker bugs** (reproduced with `checkers.check`):
  - **Numeric fallback.** Without `values`, `numeric` takes the first number in the text: "In Minevale36 I collected
    5 eggs" scores 0 (value 36), and comp-work-02 reads 35. `numeric_list` has the same problem.
  - **Boolean.** A missing value defaults to False:
    - "I do not know." scores 1.0 on conf-06 and conf-07 (gold false).
    - The same answer scores 0 on conf-02 *and is flagged stale*, which inflates the stale-belief metric.
  - **`field_in`** needs an exact name: "Worker 2" and "Worker2 at 7.1 min" both score 0 on rel-02. Format beats
    memory.
  - **`contains_all`** ignores negation: "It was not about fuel" passes ctl-03.
  - **`set`** uses substring synonyms ("led", "log", "seed") that match unrelated words.
  - **The self-test only feeds each checker its own gold.** It has no negatives: stale values, "I don't know", a
    village number first, a generic Minecraft answer.
- **Judge:**
  - The same model judges itself.
  - The judge sees only the reference, not the evidence, so invented "evidence from two days" can pass the g1 rubric.
  - E and F answers carry `#Minevale..#nnnn` ids, which unblind the arm. Strip them before judging.
  - `also_rubric` (vil-01, vil-03) is in the data but not in the scoring rules.
  - Hand calibration on ~20 judgements is thin for 150.
- **Too few and uneven items:**
  - 29 probes fall on day 10, most from one after-phase made of console lines.
  - The test split has 3 identity and 5 decision probes, all but one decision leaked.
  - Twins asked before a restart count in the categories (e.g. rst-01b as "village"), inflating the window-answerable
    share.
- **Split shift** (section 1): dev and test differ in STOCK visibility, executor model and evidence source, so dev
  tuning transfers poorly.
- **Questions name their topic.** This favours BM25 arms. There is no unprompted "what would you report?" probe for
  G1, and every g1 question names the problem area.

## 6. Fixes (in order)

**Blocking (before any model call):**
1. **Define the snapshot in code** in the bench, the same for every arm, as the live summary renders it. Add a leak
   pass to `build_questions.py`: search the rendered window, the snapshot and the sibling questions in a call group
   for the checker's key values, and fail or retag any probe they answer.
2. **Run the cheap controls first:** A (window and snapshot), A0 (nothing) and the oracle arm, 3 seeds each
   (about $0.2).
   - Drop or retag any non-control probe that A gets right in at least 2 of 3 seeds, or that A0 gets right.
   - Drop any probe the oracle misses (unanswerable or a checker bug).
3. **Add memory-only scoring** (no window, no snapshot) for every arm next to the realistic prompt, and use it for
   the restart pairs and the conflict probes.
4. **Rewrite the decision probes** and grow them to 20 or more:
   - Neutral options that state no remembered fact.
   - Letters randomised and balanced.
   - Questions that do not state the numbers needed.
   - Each with a plausible distractor that follows the game's own failure advice (as dec-02's option C does, the
     good pattern).
   - Take them from recurring situations at the checkpoint before each recurrence: stairs, fuel, furnace, chests,
     scout points, farms, pickaxe tables.
5. **Remove the oracle wording** from synthetic events:
   - `day_start`: "Day N: you are in the village Minevale38", with no "everything in it is gone".
   - `day_end`: no crash or stop reasons the agent never saw.
   - Rewrite vil-09, conf-06 and conf-07, or keep them only as controls.
6. **Fix the factual error** in comp-place-04 and g1-06 and dec-05's option B: the cane is ~148 blocks out and collect
   did not find it (unknown why, perhaps unloaded chunks); it is not beyond 160. Correct the spec's statement about
   interpolated times and its count of 10.
7. **Fix the checkers:**
   - Require `values` and treat a missing or unparseable value as "abstain" (score 0, not stale, counted apart).
   - Never parse numbers out of village names or ids.
   - `field_in`: compare names with spaces removed, as a word inside the value.
   - Make `contains_all` negation-aware, or move those probes to structured fields.
   - Use word-boundary regexes in `set`, and drop "led" and "log".
   - Score `coord` probes with a memory half (comp-place-07) with an `all` check on both halves.
   - Add negative self-tests (expected 0).
8. **Replace the global $1.20 stop with per-arm caps** and a one-day pilot to calibrate the cost estimate.

**Before trusting comparisons:**

9. **Grow the set to 150 or more clean test items**, at least 15 per category, spread over agents and days.
   - Use templated probes built from events by `build_questions.py`: counts per chore kind per earlier day,
     who-built-what of earlier villages, sighting and lead-point places, failure causes by kind, durations.
   - Keep the conflict probes on values that are absent from the snapshot at the checkpoint, e.g. asked after a day
     boundary about the latest of several earlier values.
10. **Add B-full and the oracle arm; equalise or report view budgets.**
    - Decide open question 10: computed numbers are allowed when every addend is cited.
    - Run every model-managed arm three or more times and compare per probe in pairs (bootstrap or McNemar), not by
      screening on one run.
11. **Fix the judge:**
    - Blind it (strip `#ids`) and show it the evidence lines.
    - Use another model family or a majority of three.
    - Make g1 answers structured `{problem, evidence: [{village, place|count|message}], fix}`, with the evidence
      checked deterministically against a list of valid tuples and only the fix judged.
    - Define how `also_rubric` combines.
    - Hand-check at least 30 judgements and report agreement.
12. **Ask probes that would reveal each other in separate calls** (Mayor at Minevale40 0.0 at least); this costs
    about 16 extra calls.
13. **Document the visibility assumption:**
    - Console diagnostics and chore results are fed to agents by the planned controller.
    - Report results split by evidence source (watcher / agent log) and by day, or render agent-log lines as the
      action events the controller would push.
14. **Add a memory-precision audit** (sampled statements at each day end, checked against cited events), which is the
    direct test of LightMem's concern about model-managed memory.

Scratch scripts used for this check (not part of the bench): the session scratchpad's `chk/show.py` (probe and
evidence with visibility), `chk/win.py` (the recent window), `chk/snap.py` and `chk/leak.py` (the snapshot
approximation and the leak scan).
