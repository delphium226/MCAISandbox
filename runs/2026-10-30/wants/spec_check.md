# Adversarial check of the wants spec (spec.md, draft 1)

Written 2026-10-30 by the adversarial reviewer. I re-ran `baseline.py` and `baseline2.py` and checked the counts against
the ledgers, the profiles, the agent-server logs and the code. Nothing was run on a world. Each point gives the evidence
and a fix.

## Blocking

**B1. The train profile has the character layers off, and much of the spec depends on them.** The six baseline arms
set `MC_CHARACTER=on` but `MC_HEXACO`, `MC_VALUES`, `MC_GAUGES`, `MC_MOOD`, `MC_AFFINITY` and `MC_IDENTITY` all `off`
(every `*.profile.json` "effective"), so `characterAny()` is false (character.ts:51). The parts that depend on those
layers are therefore inert or undefined:
- pursuit candidates "from values (achievement, benevolence)";
- the rival line gated on achievement/power values or low honesty-humility;
- conformity scaled by HEXACO agreeableness and openness;
- restlessness scaled by openness;
- mood thoughts at milestones (`MC_MOOD`);
- esteem scaled by affinity;
- the identity line;
- "inside character v2's one cap and floor". Without a layer on, weights are capped only where `gw` is set
  (choose.ts:195-199).

If the train turns the layers on, every option's weights change too (cap and floor everywhere, cf 0.67-1.5), so the
arms differ by more than wants. *Fix:* name the train profile in the spec. Key each character rule to what is on:
A.3p's temperament traits (curiosity, sociability, care, diligence, pride; `MCAI_TEMPERAMENT` is on) and life goals.
Otherwise drop the rule. State that the cap does not apply.

**B2. The measures cannot tell "members want things" from "the menu changed".** Every lever is a menu change: created
options, the outlet call, tags and weights.
- Prediction 3 ("reasons name the pursuit 20-40%") is guaranteed by the spec's own finding 1: "enjoy" appears on
  tagged options 94-100% of the time, and goal words appear in about 50% of reasons because the persona line ("your
  life goal is standing", in every `ctx.persona`) and the PRIMER ("A good life here is working toward your life
  goal...", choose.ts:239) put them there.
- Off-members have no pursuit, so persistence, resumption and advancing a step cannot be compared across arms.

*Fix:*
- **Shadow pursuits**: code assigns and tracks a pursuit for each off-member and never shows it, as the motivation
  spec's shadow ladders did (runs/2026-10-22/motivation/spec.md:190-196).
- **A menu-only arm** (`MC_WANTS=menu`): created options and outlets with no prompt lines, tags or weights. Only
  on > menu-only on behaviour says the want did something.
- **One behavioural primary**: when the pursuit's step is on the menu, the share of model picks that take it, against
  its share of options and against shuffled pursuits (F272's design, FINDINGS:1494-1503).
- Report reason counts only as manipulation checks, never as evidence.

**B3. The "line of work" grain decides finding 4 and prediction 1, and the spec picks the finest grain without saying
so.** `fam()` (baseline2.py:19-23) counts "make birch_slab", "make birch_stairs", "build i5" and "furnish home
627028birch" as separate lines (82-86 lines in a run). The same ledgers at two other grains:

| grain | hour-0 top line kept in hour-1 top 3 | top line's share of a member's choices |
|---|---|---|
| kind (baseline.py prints it, the spec omits it) | 12, 8, 21, 21, 23, 20 of 24 | 0.24-0.42 |
| family (wood and stone variants and numbers merged; my recount) | 10, 5, 4, 4, 3, 5 of 24 | |

At kind level the persistence is trivial: `make` is the hour-0 top kind of 23-24 of 24 members in trains 10-11. That
also makes measure 6.2.1 ("JS of kind mixes") blind to the craft pursuits it is meant to show: a baker and a smith are
both `make`. *Fix:* define one product-family grain, the one the craft and supply templates name. Report all three
grains. Set predictions 1-2 and the JS at the family grain, with the baseline recomputed at it.

**B4. Imitation and titles break rules set for the customs (G4) and roles experiments.**
- The customs design says the custom option is offered to every member from the start, "so exposure never adds the
  option", that the option "is the same in every arm", and that a custom carries no reward
  (runs/2026-10-27/i164/spec.md:177-199). The spec's "Do as Jonah does ... [Jonah's way]" with `aw` 1.2 adds a tagged,
  weighted twin of the custom for on-members only. Prediction 7's 2x adoption would then measure the tag and the weight.
- Titles and the "relied on" line are E.8's condition (e), roles shown back. The motivation decisions kept titles off
  in G4-type runs because "they would add names G4 measures" (motivation/spec.md:223).

*Fix:* imitation never touches a custom's option. Customs spread by their own facts line (`MC_CUSTOM_FACTS`). Test
customs in their own village-wide pair. Put titles behind their own flag (on by default, per the 10-30 rule), set off
in customs and G4 control arms.

**B5. The test cannot detect most of the predicted effects.**
- At the spec's own grain, the persistence baseline across the 6 arms is 11, 8, 6, 5, 2, 5 of 24: mean 6.2, SD 3.1,
  which is 13 points per run of 24.
- Per-member halves of 12 over 2 runs give a difference SD of about 18 points. Prediction 1's 50% against 30% is about
  1.1 SD, and 9cM already reached 46% with no wants.
- Prediction 2 borrows F284's SD 0.022, but that is a different index (0.013-0.093 there, against 0.150-0.160 here).
  F284 needed ~15 runs per arm to see 0.02.
- Prediction 5 (busy +10 points) is inside the arms' own spread (hour-2 busy 50-65%).

*Fix:* name one primary (B2's behavioural one). Take its SD from the 6 baseline arms at the chosen grain and state the
runs needed. Call the 2-run split a pilot: stall checks, the denominators, outlet mix. Make no directional claims from
it.

## Should fix

**S1. Most of the `[choice-none]` row is right, but what it counts is not what the spec says.**
- The arm mapping holds:

  | arm | world | log | lines |
  |---|---|---|---|
  | 10C | 5 | testagents-w5-134822 | 427 |
  | 10S | 4 | testagents-w4-134819 | 410 |
  | 11M | 5 | testagents-w5-205320 | 430 |
  | 11P | 4 | testagents-w4-205318 | 534 |

- `noteNone` logs only when the set of reasons changes, or every 5 minutes (mcWorld.ts:9882-9891). So 410-534 is a
  count of reason changes, not of "times it fires". A mean over lines is not time-weighted, and "after +40 min" cannot
  be read from lines that carry no timestamp.
- My means over all lines, zeros included: 9.6, 9.4, 9.9 and 8.2 (spec: 10.0, 9.8, 10.3, 8.4).
- 9c's logs do exist: w4-215116 (625 lines) and w5-215118 (313).

*Fix:* add a timed idle count per sweep (or per 10-minute bin) to the log, and measure idle from it.

**S2. The busy row mixes two measures and swaps two arms.**
- My recount gives 11M 67/51 and 11P 60/65; the spec prints them the other way round.
- 9c's figures are chore busy (my recount 77/49 and 78/54); trains 10-11 use the `BUSY after` line.
- In trains 10-11 chore busy (scorecard's `chore_busy_bins`) is flat or rising: 33→36, 30→30, 33→32, 33→47. The
  hour-2 drop in BUSY is board and growth work ending (houses 2→25), not chore menus running dry.
- Measure 6.2.4 says "chore busy (baseline hour 2 50-65%)", which is the BUSY figure.

*Fix:* use chore busy throughout. Restate finding 5 and prediction 5 on it.

**S3. The explore outlet, measured.**
- **Ring distances.** The ring radius is `FARM_TRIP_RANGE = max(160, VILLAGE_RANGE)` = 160 (village.ts:718). Rings 2-3
  are therefore 320 and 480 blocks out (round trips up to ~960 blocks), not "150-450" (open question 5).
- **When explore is offered.** Only while a farm slot is free, or under `MC_CHOICE_INSTANCES=explore`
  (mcWorld.ts:7123-7131).
- **The ring was done before these runs started.** The 10C, 11P and 9cM ledgers hold 0 explore choices, and the first
  `[choice-none]` line of each log already says `explore: explored`. That is checkpoint state, not "done in the first
  hour".
- **Supply against demand.** 16 new points are a finite supply set against ~10 idle members for ~80 minutes (about 800
  idle member-minutes). They would be used up early.
- **Flowers are not recorded.** The atlas records no flower kinds (no "flower" in mcAtlas.ts or mcSiteAtlas.ts), so
  "finds" needs a new block scan. That costs event-loop time (lessons 16, 49).

*Fix:* count the outlet's supply over time in 10-minute bins before building (lessons 129, 130). Cap at ring 2 for the
pilot. Budget the scan. Check that the test worlds have the chunks generated that far out.

**S4. Pursuits duplicate goals.ts and intentions.** Five templates are the life goals with a target:
- house = `home`
- own = `wealth`
- craft = `mastery` (`topCraft`)
- research = `invention`
- works = `standing`/`beauty`

goals.ts:146-188 already measures each one, and the goal weights its options (`gw` 1.6-2) and tags them
"[toward your goal]". `goalScore` already ranks a member against the best at the same goal: that is the rivalry record.
The night's intention and focus (`iw` 1.3, `MC_CONTROLLER` on) is already a one-day pursuit. As written, one option
gets both tags and `gw × iw × pw`. *Fix:* make a pursuit the goal's measure with a sized target. Its tag replaces the
goal's tag on those options. Set the next day's focus from the pursuit's step and use one weight. Keep only collect,
garden, supply, light, explore and teach as new.

**S5. Roles are already shown back, and they did not form lines.** `MCAI_SOCIAL_ROLES=show` in all six arms: 594 of
666 model prompts in 11M carry "You have become the village's maker/gatherer/lamplighter" (`ctx.role`;
mcWorld.ts:8909). Section 3.4 calls "relied on" the specialisation mechanism without saying that its coarse form is
running now. *Fix:* say so. Make 3.4 replace `roleLine` at family grain, not add a second role line.

**S6. Cost is understated.**
- Single-option menus are 20-69% of model calls in number (trains 10-11: 435/792, 481/720, 474/690, 567/816). Turning
  them into real choices could add up to ~60% choose calls, not 25%. The repeat and rate rules would cut part of that;
  count them.
- The outlet ceiling is 25 × 12 = 300 calls an hour, not 120. Each counts against `MC_TOKEN_BUDGET_AGENT_HOUR=150000`.
- Concurrency is not the issue: choose latency median is 1.3-1.5 s and queue wait 0 in every arm.

*Fix:* recompute the totals with these, and give the outlet call its own call kind in `modelUsage.CALL_KINDS`, so
model replay's numbering of `choose` calls stays matched.

**S7. The reflect tool is already crowded.** It carries notes, keep, intention, focus, profiles, law, back_laws,
custom, propose and back (society.ts:195-265); pursuit, pursuit_text and drop would add three more. gpt-oss already
mis-shaped notes (F273, #90). *Fix:* a separate short pursuit call, only on nights that need one (night 1, a stalled
pursuit or a finished one). Or bench the merged tool on replayed reflect prompts before building.

**S8. Restlessness and the outlets can game the measures.**
- Chosen rest "is not idle", and outlets are mostly walks, so prediction 5 can be met by resting and walking.
- "Practise" cannot be an outlet on an empty menu: if `innovate` were feasible, the menu would not be empty.
- With up to 300 outlet calls an hour, "at least 5 proposals a run" is trivial, and asks for items nobody has pile up
  as requests.

*Fix:* leave rest and walk-only outlets out of busy. Count productive minutes by the cells and stock changed (lesson
138). Cap proposals and asks per member-day. Drop practise from the empty-menu outlet. Raise prediction 6 to the
distinct wants proposed and their verdicts.

**S9. The echo check is too loose.** "Beyond the option" excludes only the option's name and facts
(baseline2.py:39-40). The tags are appended separately in the prompt (choose.ts:265-266) and are not in the ledger's
name or facts. A reason that repeats "[repays Ben]", "[Jonah's way]" or the social line will count as naming a person
of its own accord. *Fix:* exclude the chosen option's tags and every name in the prompt's want lines.

**S10. Imitation will copy useless acts.** "Distinctive" means under 10% of the day's chores, and rarity favours
pointless makes. The hour-0 top lines include "make birch_pressure_plate" and "make composter". *Fix:* copy only acts
whose output is used (the stock under its keep, or wanted), initiatives, or the admired member's pursuit steps.

**S11. The per-member split leaks between arms.**
- Records, titles and rings are village-wide.
- Off-members become rivals and admired members.
- An on-member's debt to an off-member can never be repaid by the off side.
- Single-key options (explore, initiatives) taken by on-members change off-members' menus.

So the off half is neither a clean control nor today's baseline. *Fix:* list which effects the split can measure
(pursuit persistence and resumption, outlet use, idle) and which need village-wide pairs (imitation, reciprocity,
rivalry, customs). Move predictions 3 (thanks and imitation) and 7 out of the split.

**S12. There is no files and build-order section.** The spec touches mcWorld.ts (10,595 lines), choose.ts,
society.ts, social.ts, character.ts and memory.ts. Another session already has uncommitted edits in mcWorld.ts,
tieredBrain.ts and settings.ts (today's git status). *Fix:*
- Add a files section, and make pursuits.ts, esteem.ts and restless.ts world-free.
- Keep the hooks in mcWorld.ts to the menu build, the sweep's `none` path and the sweep's counters.
- Add the new weights to `weighted()`, `weights()`, the ledger and `choice_golden.mts`.
- Order the build after the other session's files are committed.

## Minor

- The "life goal" keyword count is inflated. In 11M's 316 goal-word reasons there are 225 matches of the bare nouns
  standing, wealth or beauty, some of them generic ("adds beauty to the village", "personal wealth"). Another 6 are the
  "iron age goal".
- About 64-70% of goal-word reasons are on untagged options (207/578, 202/594, 116/376, 101/341, 96/316, 118/384),
  so "70%" is the top of the range.
- "12-34% of choices never reach the model" counts only single-option menus. Non-model picks are 40-53% of all
  choices (only + fixed + fallback + repeat).
- 9cO's "same option as previous" (12.8%) is mostly code repeats (249 `repeat` choices, against 28-39 in trains 10-11).
  Count model choices only.
- "F272: 67% against 17%" is FINDINGS:1522's 5 of 6 cases. F272 itself has 70% against 30% (and 33% shuffled) over
  50 cases. Quote the larger one.
- `explore: explored` is in 96% of lines (394/410, 412/427, 517/534, 412/430), not every line.
- The weight names clash. `aw` is character v2's ambition weight (character/spec.md:186). `rw` is already the
  monument trade weight (world.ts:306), so `rw2` invites mistakes. Rename both (for example `imw` for imitation and `dbw` for debts).
- The cap rarely binds: 17 of 2,053 options in 11M and 27 of 2,277 in 10C have a weight product of 6.25 or more. The
  risk in stacking is not the cap. It is three new weights all favouring the same few options.
- Model menus have a median of 2-3 shown options (11P: 391 of 797 model decisions show 2, and 27 show 8). The
  "trimmed by MENU_MAX" case is rare, so the created step option will mostly be "no family offers it". Say so.
- The teach template's "made its craft after its offer" has no causal link code can verify. Require an accepted offer
  or request.
- Section 0's table takes reasons from workers only, but the "only one option" row includes the Mayor's choices.
