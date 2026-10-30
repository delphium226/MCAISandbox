# Wants of their own: motivation from within (goal 2, G2/G4/G5): spec

Written 2026-10-30 by the wants session for the planning session, after the user's "go for it". **Spec only, no code.**
Draft 1 is sections 0-8; the adversarial check (`spec_check.md`) is folded in as section 9 (draft 2), which overrides
anything above it that it contradicts.

## 0. The problem, measured

Today a member is moved from outside: code builds a menu of feasible options with facts, and one model call picks one,
flavoured by temperament tags ("[you enjoy this]"), the life goal ("[toward your goal]"), memory (notes, the day's
intention), needs ("Your wants: food, your house, tools"), laws, prices and the village ambition. Nothing in a member
persists past a village day except its record, and nothing pushes it when the menu is empty.

**Baseline** from the choice ledgers of trains 9c (M, O), 10 (C, S) and 11 (M, P): 25 members, 1x, 113-120 min each,
`MC_MEMORY`, `MC_CLOCK`, `MCAI_SOCIAL=on`, `MC_ACTS`, `MC_CHARACTER`, `MC_GOALS`, `MC_SKILL`, `MC_RULES` all on (train
3-combined profile). Scripts: `baseline.py`, `baseline2.py` in this folder (keyword counts on the model's `reason`;
36 sampled reasons were read by hand and the classes matched them, but no formal agreement was scored). Workers only
(the Mayor left out); the `[choice-none]` counts are from the agent-server logs (`runs/2026-10-29/testagents-w*-*.log`;
9c's were not counted).

| measure | 9cM | 9cO | 10C | 10S | 11M | 11P |
|---|---|---|---|---|---|---|
| choices / by the model | 1,946 / 1,165 | 2,070 / 1,215 | 1,474 / 792 | 1,434 / 720 | 1,457 / 690 | 1,691 / 816 |
| only one option (no call) | 26% | 12% | 30% | 34% | 33% | 34% |
| reason names another member | 11.6% | 9.8% | 9.3% | 10.7% | 9.2% | 7.5% |
| ... not named in the chosen option itself | **2.2%** | **1.9%** | **1.7%** | **2.0%** | **2.9%** | **0.9%** |
| names memory or a plan (remember, intention, again, continue...) | 3.4% | 2.2% | 2.1% | 4.0% | 2.7% | 4.9% |
| names the life goal (goal, mastery, standing, wealth, beauty...) | 51% | 51% | 49% | 49% | 47% | 48% |
| ... on an option tagged "[toward your goal]" | 18% | 17% | 15% | 14% | 14% | 15% |
| "enjoy" / of those, on a tagged option | 4.5% / 94% | 4.3% / 96% | 2.6% / 100% | 4.1% / 100% | 3.8% / 96% | 4.3% / 100% |
| status words (best, proud, respect, impress...) | 1.7% | 1.4% | 1.2% | 2.3% | 2.4% | 1.9% |
| gratitude or reciprocity (thank, owe, repay, in return) | 0.1% | 0 | 0 | 0.1% | 0 | 0 |
| imitation (like X did, follow, copy) | 0.1% | 0.3% | 0 | 0.1% | 0.3% | 0 |
| boredom words (dull, bored, repetitive, change from) | 0.2% | 0.4% | 0.3% | 0.1% | 0.2% | 0.3% |
| own needs (I need, hungry, rest, my house) | 44% | 42% | 45% | 48% | 43% | 44% |
| the village (village, storage, short, needed) | 43% | 47% | 53% | 48% | 50% | 55% |
| member's hour-0 top line of work in its hour-1 top 3 | 11/24 | 8/24 | 6/24 | 5/24 | 2/24 | 5/24 |
| distinct lines of work a member in 2 h (median) | 40 | 39 | 38 | 35 | 37 | 39 |
| a member's top line's share of its choices (median) | 12% | 13% | 8% | 9% | 8% | 8% |
| same option as the member's previous choice | 7.4% | 12.8% | 5.2% | 4.4% | 4.8% | 4.8% |
| mean pairwise JS of kind mixes (report) | 0.160 | 0.150 | - | - | - | - |
| BUSY (board + chores), hour 1 / hour 2 (10-min bins) | 75 / 55% | 75 / 60% | 71 / 50% | 69 / 50% | 67 / 51% | 60 / 65% |
| chore busy only, hour 1 / hour 2 (scorecard; the check's recount) | 77 / 49% | 78 / 54% | 33 / 36% | 30 / 30% | 33 / 32% | 33 / 47% |
| `[choice-none]` lines; idle members when one fires | - | - | 427; 10.0 | 410; 9.8 | 430; 10.3 | 534; 8.4 |

What it says:
1. **Members justify by what the prompt hands them.** Half the reasons name the life goal, but 70% of those are on
   options not tagged toward it (post-hoc: "fits my goal of standing"). "Enjoy" appears almost only on an option the
   prompt tagged "[you enjoy this]" (94-100%). The tags are read and repeated; they are not wants.
2. **Other members barely figure.** A person is named beyond the option's own text in 1-3% of reasons, although every
   prompt carries "What the others are doing" and five profiles (F339: no house reason named a neighbour). Gratitude
   and imitation are absent (0-0.3%).
3. **Memory barely figures** in reasons (2-5%), though intentions move choices (F272: 67% against 17%) and every prompt
   carries notes. What moves a choice is attached to an option; a block of prose is acknowledged, then ignored.
4. **There are no lines of work.** A member does 35-40 different things in 2 hours, its commonest is 8-13% of its
   choices, and in 4 of 6 arms at most a quarter of members keep their first hour's main line in the second. Members
   are generalists who follow the menu; specialisation (JS 0.150-0.160) is what the menu's churn leaves.
5. **When the menu runs dry, members do nothing.** 12-34% of choices had one option (no model call at all); after +40
   min 8-10 of 24 members sit idle whenever `[choice-none]` fires (410-534 times a run), with every reason a dead end:
   `explore: explored` in every line (the 8 ring points are done in the first hour), `make: inputs short`, `activity:
   needs short`, `farm: nothing ripe`, `gather: no mine`. An idle member gets no call, so it cannot ask, propose or
   look further: busy falls to 50-60% in hour 2.
6. **Repetition is not the problem.** Members repeat their previous option 4-13% of the time. A boredom that punishes
   repetition would make them still more generalist; boredom has to come from idleness and pointless work.

## 1. What Project Sid did, and what transfers

From `docs/research/llm-agent-autonomy-literature.md` and `agent-individuality.md` (the Sid report, arXiv 2411.00114):
- **PIANO**: concurrent modules (memory, action awareness, goal generation, social awareness, talking, skills) behind
  one cognitive controller whose decision is broadcast to the others, so speech and action agree. Our controller and
  acts already follow this.
- **Specialisation came from social awareness plus a community goal**, among 30 identically prompted agents: roles
  (farmer, miner, guard, curator...) formed only when agents built profiles of each other's goals ("Here's what other
  people are doing"); without it, roles were homogeneous and did not persist. The goal generation module wrote
  agents' *own* next objectives from their experience and the community's, every few minutes. We show the others, but
  we never let a member set an objective of its own that lasts; our F284 found awareness alone load-balances.
- **Culture was seeded and measured**: 20 priests given the goal of spreading a religion, spread by conversation and
  counted by keywords; laws changed by amendment and vote, and compliance followed the law.
- **Sid named its own gap**: no innate drives. Its agents had goals, not wants.

What transfers: **objectives of the member's own, generated at a reflective moment and pursued over hours** (Sid's goal
generation, with our rule that code measures and breaks them into steps), **others' objectives and works visible as
things to admire, copy, outdo or repay** (social awareness made into motives, not a list), and **a push when nothing is
offered** (the innate drive Sid lacked, in a peaceful world: restlessness, not hunger).

## 2. Personal projects ("pursuits"; `pursuits.ts`, new; `MC_PURSUITS`, on)

The name "pursuit" in code avoids the clash with `MC_PROJECTS` (public works) and initiatives (small works).

### 2.1 What a pursuit is

A lasting objective of one member, measured by code, with a target, a progress count and steps. It lasts hours (2-6
village days at 20 min a day), survives interruptions and restarts, and ends done, dropped or stalled. One active
pursuit a member, plus one done list (shown as achievements).

**Templates** (code; each a counter over the world or the ledgers, a target, and the option families that advance it):

| template | example the member sees | measured by | steps (menu families) |
|---|---|---|---|
| collect | "find every flower" (14 kinds the biome holds) | distinct kinds in own chest, garden or storage given by it | `lib:flowers` (any kind, not only dye flowers), explore further (2.5), request a kind |
| garden | "the finest garden in the village" | flowers and decorations placed in its plot's yard, against the village's best | gather flowers, `decor`, `furnish`, light own home |
| house | "the finest house" | furnished spots, decor, lights, a bed (houseDecor's count) | furnish own, decor, make bed (wool), request wool |
| craft | "the best smith: 40 iron tools" / "the village's baker" | makes of one product family by it | that family's makes and its inputs' gathers |
| supply | "keep the village in bread for two days" | stock never under N while it holds the pursuit | the family's harvest, make, sow; request seeds |
| works | "build a fountain, a statue and a well" | its own initiatives built (by kind) | `initiate` of that kind, gather for it |
| light | "light the road to the mine" | lights placed along a code-chosen path | `light` of those spots, make torches |
| explore | "map the land to the north" | new survey points visited and their finds recorded | explore further (2.5) |
| research | "unlock glazed terracotta" | research points it gave to one invention | `innovate` of that one |
| teach | "teach 3 members my craft" | members who made its craft after its offer or request | offer, help, the craft |
| own | "the richest trader: 40 emeralds of my own" | own chest's emeralds | own sales, merchant, paid requests |

Each template's steps name option families that exist today (a unit check proves every template has a live path in
the base checkpoint, as the motivation spec's census did); a pursuit whose path closes mid-run (no wool anywhere) shows
the gap as a want and opens an outlet (section 4), it does not silently stall.

### 2.2 How a member chooses one (the model decides, code proposes and measures)

- **When**: at the night's reflection (G1's `reflect` call; no new call), when the member has none, has finished one,
  or code flags the active one stalled (no progress for 2 village days).
- **What it sees**: 4 candidate pursuits drawn by code from the templates, each with its target sized to the run
  (e.g. the flower kinds the land has, read from the atlas), and why it is offered: from its life goal (beauty ->
  garden, house), values (achievement -> craft, works; benevolence -> supply, teach), skill (its highest-skill family),
  temperament (openness -> collect, explore), memory (a note or intention it wrote, matched by word to a template:
  "Consider expanding my house" -> house), and the others (one candidate copies an admired member's pursuit, section
  3.1; one is a rivalry if a record exists, 3.2). Plus "keep your current one" when active.
- **Its own words**: the member may instead describe a pursuit (`pursuit_text`). Code matches it to a template and
  target by keywords and parameters ("a mill" -> works of the closest kind, or no match). An unmatched want is not lost:
  it becomes a **proposal** (G5's `MC_PROPOSALS` path, kind `activity`) and a wish on the wanted list (#89's demand,
  `wanted.ts`), so the foundry and the triage see what members want and cannot do. The member is told at dawn
  ("Nobody here can build a mill yet; your wish is with the council") and picks from the four next night.
- **Reply**: `pursuit` (one of the four names, or `keep`), a one-sentence `why`. Logged as an act (`pursuit-chosen`)
  with the candidates, their sources and the pick.

### 2.3 How it is pursued

- **Progress** is computed by code from the counters each sweep; milestones at 25/50/75/100% are memory entries
  (pinned) and mood thoughts (`MC_MOOD`, +3; done +8).
- **The prompt** carries one line (section 5): "Your project (day 3 of it): the finest garden: 9 of 14 flower kinds;
  next: pick blue orchid (seen by the swamp, 120 blocks east); short: nothing."
- **Options that advance the next step** get a tag "[your project]" and a weight `pw` 1.3 (inside character v2's one
  cap of 6.25 and floor 0.16), so the fixed picker and fallbacks follow the pursuit as the model does.
- **When the step is feasible but not on the menu** (trimmed by `MENU_MAX`, or no family offers it: a flower kind not
  among the dye flowers), code adds one option "Work on your project: <step>" (section 4.3).
- **Interruptions**: hunger, laws, requests and the village's needs come first exactly as now; the pursuit is state
  beside the brain (lesson 66), saved with the member's memory (`social.json`), so the next decision, a restart or the
  next day picks it up. A pursuit is "resumed" when a step follows a gap of other work of 15+ min.
- **Drop**: at night the member may drop it (`pursuit: drop`, with why); code drops it when its path has been closed for
  2 days and no outlet answered. Dropped and done pursuits stay in the record and the identity line ("made the finest
  garden, day 4").

### 2.4 Against the motivation spec's ambitions (10-22, not built)

Those were code-fixed 5-step ladders per life goal branch. Pursuits replace them: member-chosen from a wider set,
sized to the land, tied to memory and the others, with unmet wants sent to proposals. The ladder's good parts are kept:
every step has a live path; the step names what is short; the weight follows the current step only. Titles (3.2) take
the ladder's recognition role.

## 3. Social motives (`esteem.ts`, new; `MC_ESTEEM`, on)

Everything here is computed by code from verified facts already logged (helps, kept and broken promises, initiatives
built, pursuits done, makes by family, what each member *saw*: `social.observe` and `profiles.seen`). A member only
knows what it saw or heard (local, as E.5's reputation): no omniscient leaderboard in the prompt.

### 3.1 Admiration and imitation (how customs spread)

- **Code tracks**: an esteem score per (viewer, other): works of the other's the viewer saw built (+3), pursuits the
  viewer heard were done (+4), kept promises to the viewer (+2), help to the viewer (+2), records held (3.2, +2),
  broken promises (-3), decaying 10% a village day; scaled by affinity (`MC_AFFINITY`) when on. The **admired** member
  is the viewer's top score, if over a threshold (6) and met in the last 2 days.
- **The prompt shows** one line: "You admire Jonah: he built the well and the fountain, and finished the finest house."
- **Imitation as an option** (the transmission path): code keeps, per member, its last 5 *distinctive* acts (a chore or
  custom the village rarely does: share under 10% of the day's chores, or any `MC_CUSTOMS` custom, or its pursuit's
  steps). One of the admired member's distinctive acts that is feasible for the viewer appears as an option: "Do as
  Jonah does: put a flower by your door [Jonah's way]" (weight `aw` 1.2, scaled by conformity: high HEXACO
  agreeableness or tradition value up to 1.3, high openness down to 1.0). Its ledger entry names the source:
  `imitate {from: Jonah, act}`.
- **Pursuits copy too**: one of the night's four candidates is the admired member's pursuit (or its done one), "like
  Jonah's".
- **Customs**: a seeded custom (G4's `customs.ts`) spreads when a non-seeded member imitates it (`noteStarted` with
  `from`), so the chain who-copied-whom is in the ledger. This is the G4 experiment's mechanism, not a prompt line
  hoping for it.

### 3.2 Rivalry and status

- **Code tracks records**: per pursuit template and per product family, the village's best (most flower kinds, the
  finest house score, most bread made, most lights) and who holds it; a member's own standing against it.
- **Titles**: the holder of a record over a floor (e.g. at least 8 flower kinds) gets a title ("keeper of the finest
  garden"); shown in others' awareness lines ("Rosa (keeper of the finest garden) is gathering flowers"), the dawn news
  when won or taken, the panel, and the identity line. One holder per record; taken by beating it.
- **The rival**: for a member with a pursuit, the member closest above it on the same record (if any) within 30%, or
  the title holder. The prompt line: "Rosa's garden has 11 kinds, yours 9." Shown only to members whose character
  leans to it (achievement or power values high, or HEXACO honesty-humility low); others see the record as news only.
- **Peaceful by construction**: rivalry has no harmful act. No option takes, breaks or blocks another's work
  (protection rules already forbid it); the only way to beat a rival is to do more.

### 3.3 Gratitude and reciprocity

- **Code tracks debts**: when B helps A's initiative or pursuit, fills A's request, pays A or keeps a promise to A,
  A owes B one favour (a count with the act, decaying over 3 days). Closed when A helps B's work, fills B's request, or
  gives B what B's pursuit is short of.
- **The prompt shows**: "You owe Ben: he helped your well (2 steps) and brought you wool." Options that repay (B's
  project help, B's open request, B's pursuit's short item) are tagged "[repays Ben]", weight `rw2` 1.2 (more with high
  agreeableness). If no repaying option exists, the acts line suggests an offer to B.
- **The other side**: B's profile of A records repaid / not repaid, which feeds esteem (3.1) and affinity: members who
  repay are admired more; the loop of reciprocity is code arithmetic, the decision to repay is the model's.

### 3.4 Wanting to be needed (roles from dependence)

- **Code tracks**: per product family, each member's share of the last 2 village days' makes and the family's stock
  against its keep.
- **The prompt shows** (one line, at most): when the member made the largest share (over 40%) and the stock is under the
  keep: "The village relies on you for torches: you made 6 of 10 torches this day, and storage has 3 of 72." When
  another member has overtaken it: "Ada now makes most of the torches." The first pulls the member back to its niche;
  the second is a fact the model can answer by competing (rivalry) or by moving on.
- **This is the specialisation mechanism**: a member's niche is reinforced by being relied on, as Sid's roles were by
  others' awareness of them, and code shows the role back only as a fact ("you made 6 of 10"), not as an assigned label.

## 4. Boredom and curiosity (`restless.ts`, new; `MC_RESTLESS`, on)

### 4.1 Restlessness, not repetition

Repetition is a specialist's work (section 0.6), so it is not punished. **Restlessness** is a code gauge per member,
0-10, that rises with:
- time idle with nothing feasible (+1 for each 5 minutes);
- chores that gave nothing anyone uses (`made for later, nothing uses them now`, a gather nothing wants) (+1);
- the same chore failing twice (+1);
and falls with a productive chore (-1), progress on its pursuit (-2), and the night (halved). Openness scales the rise
(x0.7-1.4).

Only **pointless repetition** is tagged: an option whose output is already over its keep and that the member did 3+
times this day gets "[you have done this a lot, and storage is full of it]" and weight 0.8.

### 4.2 What restlessness does

- **At 4+**, the prompt line: "You are restless: nothing you did today moved your project." and the menu gains the
  outlets below as options.
- **At 7+, or with an empty menu**, the member gets an **outlet call** even though the menu has nothing (today it gets
  no call, section 0.5). Its options are only outlets:

### 4.3 The outlets (options created by code)

1. **Explore further** (code, `mcWorld`): survey points on a second and third ring (2x and 3x the village range, 8 each,
   only past the first ring), each visit recording finds by code (biome, flower kinds, animals, ore showing, trees)
   into the atlas and as news ("Iris found blue orchids by the swamp to the east"). Finds open options that were not
   there (a new flower kind to pick, a herd to lead home). Today `explore: explored` closes every menu after hour 1.
2. **Ask**: a request (G2's act) for what blocks its pursuit or its wants, to a member who has it or anyone; with an
   offered price when the member has emeralds. Made from the outlet call, so an idle member can ask.
3. **Help someone's pursuit or work**: another member's pursuit step that the idle member can do (code lists up to 2,
   by affinity and debts), e.g. "Give Rosa a lilac for her garden".
4. **Propose**: an unmet want ("I want to build a mill", "a bed, but no wool") as a proposal (`MC_PROPOSALS`, kind
   `activity` or `work`) and a wish on the wanted list (#89 demand), answered by the council or the triage session
   (G5). The proposal records the restlessness and the member's pursuit, so the foundry's tickets come from real,
   repeated wants.
5. **Practise or try**: research (`innovate`) and the activity library's options already exist; they are offered
   here even when the member's ranking trimmed them.
6. **Rest by choice**: "Sit at the green and watch the others" (code: walk to the green, 2 min; it adds the member to
   others' scenes, so it sees more works for esteem). Chosen rest is not idle: it ends the call and lowers
   restlessness by 1, and it is counted apart.

The outlet call is rate-limited: at most one a member every 5 minutes of village time, and only while the village's
token budget allows (`MC_TOKEN_BUDGET_HOUR`).

## 5. How wants enter a choice

Three ways, and the design uses each where the evidence says it works:

| way | used for | why |
|---|---|---|
| a block in the prompt | 3 lines at most: the pursuit, one social line (admire / rival / owe / relied on: the strongest one only), restlessness when 4+ | prose blocks are acknowledged and ignored (0.2, 0.3: 1-3% name a person; memory 2-5%), so the block is kept short and is the context the tags refer to, not the lever |
| re-ranking by code weights | `pw` (project), `aw` (admired's way), `rw2` (repays), pointless repetition 0.8, inside character v2's one cap and floor | the fixed picker, the fallback and the trim must follow wants too (12-34% of choices never reach the model); code does the arithmetic |
| options created by code | the pursuit's step when not on the menu, the imitation option, the outlets | the menu's dry spells are the largest loss (0.5); a want with no option is a sentence the model cannot act on |

Tags on options (`[your project]`, `[Jonah's way]`, `[repays Ben]`) are what members demonstrably read (0.1: "enjoy"
appears on tagged options 94-100% of the time). The model still picks; a want never forces an option.

**Prompt line order**: the pursuit line goes where the life goal's line is now (and replaces the goal's "no craft of
your own yet" text when a pursuit exists); the social line after "What the others are doing"; restlessness after
"Your wants".

## 6. Measures, predictions, flags and the train

### 6.1 Flags (on by default, the user's rule since 10-30)

| flag | default | what |
|---|---|---|
| `MC_PURSUITS` | on | personal projects: night choice, progress, line, tags, step options |
| `MC_ESTEEM` | on | admiration and imitation, records and titles, debts, relied-on lines |
| `MC_ESTEEM_RIVALS` | on | the rival line (with `MC_ESTEEM`) |
| `MC_RESTLESS` | on | restlessness, pointless-repetition tag, outlet calls |
| `MC_EXPLORE_RINGS` | 3 | survey rings (1 = today's) |
| `MC_WANTS_HOLDOUT` | 0 | share of members (by seed) with all four off, for the train's split |

Each in `settings.ts`, `docs/SETTINGS.md` regenerated. Control arms set them off.

### 6.2 Measures (scripts: `wants_use.py`, new, reading the ledgers and acts; all split by member arm)

1. **Specialisation**: mean pairwise JS of kind mixes, within the on half and within the off half, by hour.
2. **Lines that persist**: a member's hour-h top line of work in its hour-h+1 top 3 (baseline 2-11 of 24); the top
   line's share (baseline median 8-13%); pursuits carried over 2+ village days and resumed after interruptions.
3. **Reasons with a want of its own**: model reasons naming a person beyond the option (baseline 0.9-2.9%), a
   pursuit (baseline none exist), a debt or thanks (0-0.1%), imitation (0-0.3%), status or a record (1.2-2.4%).
4. **Busy in the second hour**: chore busy by 10-minute bins (baseline hour 2 50-65%); idle members at `[choice-none]`
   (baseline 8.4-10.3); outlet calls and what they chose (explore, ask, help, propose, practise, rest).
5. **Customs spreading among non-seeded members**: with `MC_CUSTOMS=on` and 3 seeded members, the share of non-seeded
   members doing a custom by day, and the imitation chains (`from`). No live baseline exists (customs ran off in every
   train since #164); the off half is the control.
6. **Wants reaching G5**: proposals and wished items from members' unmet pursuits; how many became tickets or answers.
7. **The health check** (`scorecard.py`) before and after; a stall check: no member hungry over a day, growth not
   blocked, the monument's pace within 15% of the off arm's.

### 6.3 Predictions (written before any build)

For on-members against off-members of the same runs (two runs, worlds 4-5, 2 h each, from t3_p1b):
1. Hour-0 top line kept in hour-1 top 3: **at least 50%** of on-members (off: at most 30%, as baseline).
2. JS among on-members at least **0.03 above** the off half's (the power is weak; a direction, not a test: F284).
3. Model reasons naming the member's pursuit: **20-40%**; naming a person beyond the option: **at least 6%** (off 1-3%);
   repaying or thanking: **at least 2%**; imitation: **at least 2%**.
4. At least **70%** of pursuits chosen on night 1 still active or done at night 4; at least **half** resumed after an
   interruption.
5. Busy in hour 2: on-members **at least 10 points above** off-members; idle at `[choice-none]` among on-members at
   most half of off-members'.
6. Outlets: explore further and ask make up at least half of outlet picks; **at least 5 proposals** a run from unmet
   pursuits, and at least one wished item ranks in the wanted list's top 5.
7. Customs: the non-seeded on-members' adoption of a seeded custom by day 3 at least **2x** the off half's.
8. Cost per member-hour at most **1.4x** the off half's (section 7).
9. No stall (6.2.7).

### 6.4 The train's arms

Per-member split inside one run (the rules for work sessions): `MC_WANTS_HOLDOUT=0.5` on both worlds, the second
world's seed reversed so each member is on in one run and off in the other. Records, titles and explore rings are
village-wide (an off-member still sees news of finds and titles; its prompt simply has no wants lines, tags, created
options or outlet calls). A village-wide pair (all on against all off) follows only if the split shows an effect, to
see whether the social motives need everyone on to work (imitation needs on-members to be admired, so the split
understates it; said in the report).

## 7. Cost

- **Prompt**: 3 lines (~60-90 tokens) and 3-4 tags (~20) on a 3,200-3,700-token choose prompt: **+3%**.
- **Night reflection**: the four candidates and the reply: +250 prompt tokens and +60 output a member a village day
  (25 members, 6 days in 2 h: ~40k tokens).
- **Outlet calls**: new calls, ~1,500 tokens each (a short prompt: the member, its pursuit, wants, 3-6 outlets). At
  most 12 a member-hour; expected 3-5 (idle members only) = **~120 calls an hour** for the village, ~180k tokens, about
  **+15% of the choose calls' tokens** (1,100-1,500 choose calls in 2 h).
- **Created options** replace single-option menus (no call) with real choices: 12-34% of choices become model calls,
  up to **+25%** choose calls.
- Total: about **+30-40%** model tokens, **~$0.25-0.35 more for a 2-hour 25-member run** at train 9c-11's $0.77-1.09.
- Code: four counters over ledgers already kept; the outlet call is the one new concurrent caller (share `MC_CALL_SLOTS`).

## 8. Open questions for the user

1. **Who chooses a pursuit**: the model from 4 code candidates plus its own words (recommended), or code alone from
   character (cheaper, less "own")?
2. **Rivalry**: shown only to members whose character leans to it (recommended), to everyone, or not at all?
3. **Imitation's weight**: conformity varies by character (recommended); or the same for all?
4. **Outlet calls for idle members**: new model calls (recommended, +15% tokens), or only options added to the next
   normal menu (free, but an idle member with an empty menu still gets no call)?
5. **Explore rings 2-3**: walks of 150-450 blocks from the village; fine at 25 members, or capped at ring 2?
6. **Unmatched pursuits as proposals to the foundry**: on by default, or held for the triage session only?
7. **The test**: the per-member split first (recommended), or a village-wide pair first, since imitation and rivalry
   need others who are on?

## 9. Draft 2: the adversarial check folded in

`spec_check.md`: 5 blocking, 12 should fix, 11 minor. All accepted; this section overrides sections 0-8 where they
differ. (Claude's decisions; the user's choices stay in section 8, revised in 9.6.)

### 9.1 Corrections to the baseline (section 0)

- **Busy**: in trains 10-11 the hour-2 fall is in BUSY (board and growth work ending as houses reach 25), not in chore
  busy, which is flat at 30-47%. Finding 5 is restated: idle members are many all along (chore busy ~33% in trains
  10-11), and the empty menus are the cause, not a late collapse. Every busy measure below is **chore busy**, and
  productive minutes are counted by the cells and stock changed (lesson 138), not by walks or rest.
- **`[choice-none]`** is logged when its reasons change or every 5 minutes (mcWorld.ts' `noteNone`), so 410-534 are
  reason changes, not firings, and the idle mean is not time-weighted (means over all lines: 9.6, 9.4, 9.9, 8.2).
  `explore: explored` is in 96% of lines, and the ring was already done in the checkpoint (0 explore choices in the
  ledgers), not in hour 1. Build step 0 adds a timed idle count per 10-minute bin.
- **Grain**: lines of work were counted by option name (82-86 lines a run). At kind grain persistence is trivial
  (`make` is the hour-0 top kind of 23-24 of 24 members in trains 10-11; 20-23 of 24 keep it); at **product-family
  grain** (wood and stone variants merged) it is 10, 5, 4, 4, 3, 5 of 24. The family grain, the one the craft and supply
  pursuits name, is the measure from now on; kind-level JS cannot see a baker against a smith.
- Goal words are inflated by the bare nouns (standing, wealth, beauty used generically) and by the persona line and
  PRIMER that put the goal in every prompt; 64-70% of them are on untagged options. Non-model picks (only, fixed,
  fallback, repeat) are 40-53% of all choices. The intention figure is F272's 70% against 30% (33% shuffled) over 50
  cases.

### 9.2 The design changes

1. **No character v2 dependence (B1).** The train profile has `MC_HEXACO`, `MC_VALUES`, `MC_GAUGES`, `MC_MOOD`,
   `MC_AFFINITY` and `MC_IDENTITY` off, so `characterAny()` is false. Every character-gated rule keys instead on A.3p's
   temperament traits (`MCAI_TEMPERAMENT`, on: curiosity, sociability, care, diligence, pride) and the life goal:
   pursuit candidates from goal, skill, curiosity and memory; rivalry shown to high-pride members; imitation scaled by
   sociability; restlessness by curiosity. Mood thoughts, affinity scaling and the identity line apply only when their
   layer is on. The weight cap applies as today (only where `gw` is set), and the new weights replace, not multiply,
   the goal's (point 2).
2. **Pursuits are the life goal made concrete, not a second goal (S4).** goals.ts already measures home, wealth,
   mastery, invention, standing and beauty, weights their options (`gw`) and ranks a member against the best
   (`goalScore`). So a pursuit of those templates is the goal's measure with a sized target and a next step: its tag
   "[your project]" **replaces** "[toward your goal]" on those options and `pw` replaces `gw` (one weight). The night's
   focus (`iw`) is set from the pursuit's step, not stacked on it. New templates are only collect, garden, supply,
   light, explore and teach; teach needs an accepted offer or request to count.
3. **A separate pursuit call (S7).** The reflect tool already has ten fields and gpt-oss mis-shaped notes (F273); the
   pursuit is chosen in its own short call (kind `pursuit` in `modelUsage.CALL_KINDS`, so replay numbering holds), only
   on nights that need one: night 1, a pursuit done, or one stalled.
4. **Imitation never touches customs; titles get their own flag (B4).** The imitation option copies only acts whose
   output is used (stock under its keep or wanted), initiatives, or the admired member's pursuit steps (S10); never a
   G4 custom, which keeps its own facts line and the same option in every arm (i164 spec). Titles move behind
   `MC_TITLES` (on), and the "relied on" line is part of it; both set off in customs and G4 control arms.
5. **"Relied on" replaces the role line (S5).** `MCAI_SOCIAL_ROLES=show` already puts "You have become the village's
   maker" in 89% of 11M's prompts without lines forming; 3.4's line replaces `roleLine` at family grain, with the
   numbers, rather than adding a second role line.
6. **Explore rings measured before they are built (S3).** Rings sit at 320 and 480 blocks (ring radius 160,
   village.ts' `FARM_TRIP_RANGE`); 16 points against ~800 idle member-minutes run out fast; the atlas records no
   flowers. `MC_EXPLORE_RINGS` defaults to 2; build step 0 counts the outlet's supply in 10-minute bins (lessons 129,
   130), checks the test worlds' generated chunks that far out, and budgets the flower scan as one region read at the
   visit (no `findBlocks`, lesson 16). The ring is also offered without the free-farm-slot condition (mcWorld.ts'
   explore gate).
7. **Outlets tightened (S8).** No "practise" outlet on an empty menu (if `innovate` were feasible the menu would not be
   empty). Chosen rest and walk-only outlets are logged apart and never count as busy. Asks and proposals are capped at
   2 each a member-day; requests for items nobody can make are folded into one proposal.
8. **Weight names (minor).** `pmw` for pursuits, `imw` imitation, `dbw` debts (`aw` and `rw` are taken). All added to
   `weighted()`, `weights()`, the ledger and `choice_golden.mts`. Most model menus show 2-3 options, so the created
   step option mostly fills "no family offers it", not a trim.

### 9.3 Measures, revised (B2, B3, S9)

- **One behavioural primary**: when the pursuit's step is on a model menu, the share of model picks that take it,
  against its share of shown options and against **shuffled pursuits** (another member's pursuit scored on the same
  menus), as F272 did for intentions. Off-members get **shadow pursuits** (chosen and tracked by code from the same
  candidates, never shown), so persistence, resumption and step-taking compare across arms.
- **A menu-only arm** (`MC_WANTS=menu`): created options and outlets, no prompt lines, tags or weights. Only on above
  menu-only on behaviour says the *want* did something rather than the *menu*.
- Reason counts (naming a pursuit, a person, a debt) are **manipulation checks only**, with the chosen option's tags
  and every name in the prompt's want lines excluded from "beyond the option".
- Persistence and JS at product-family grain, with kind and option-name grains reported beside.

### 9.4 The test, revised (B5, S11)

- The 2-run per-member split is a **pilot**: stall checks, denominators, the outlet mix, the primary's direction. No
  directional claim from it: the persistence baseline at the option grain has SD 3.1 of 24 a run (13 points), and the
  family-grain SD is to be computed from the 6 baseline arms before the pilot, with the runs needed stated then.
- The split measures only per-member effects: pursuit persistence and resumption, step-taking, outlet use, idle.
  Imitation, reciprocity, rivalry and customs need others who are on: a **village-wide pair** (all on against
  menu-only), and customs in their own pair with `MC_CUSTOMS=on`, 3 seeded members and titles off.
- Predictions, replacing 6.3 (set before the pilot, sized after it):
  1. **Primary**: on-members take the step when offered at least **1.5x** its share of shown options, and at least 15
     points above shuffled pursuits; shadow pursuits of off-members at their share (no lift).
  2. Pursuits chosen on night 1 still active or done at night 4: **70%**; half resumed after an interruption.
  3. Family-grain top line kept hour to hour: on above menu-only (direction only in the pilot).
  4. Chore busy and productive minutes: on and menu-only both above off (the menu effect), on not below menu-only.
  5. Outlets: distinct wants proposed per run and their verdicts reported (no count target); at least one wished item in
     the wanted list's top 5.
  6. Village-wide pair: repayments within 3 days at least 2x off's pairs' reciprocal helps; imitation acts traced to an
     admired source.
  7. Cost per member-hour at most 1.6x off (9.5); no stall.

### 9.5 Cost, revised (S6)

- Single-option menus are 55-69% of the model calls in trains 10-11 (435 of 792, 481 of 720, 474 of 690, 567 of 816);
  made into real choices they could add up to **~60%** choose calls, less the repeat rule's share (to be counted in the
  pilot).
- The outlet ceiling is 25 x 12 = **300 calls an hour** (~450k tokens), each against `MC_TOKEN_BUDGET_AGENT_HOUR`; the
  expected figure is idle members only, ~100-150. Concurrency is no issue (choose latency 1.3-1.5 s, queue 0).
- Total: about **+50-80%** model tokens, **~$0.40-0.80 more for a 2-hour run** at trains 9c-11's $0.77-1.09.

### 9.6 Files and build order (S12), and the open questions revised

- New, world-free: `pursuits.ts`, `esteem.ts`, `restless.ts`, `pursuits_unit.mts` (every template's live path in the
  checkpoint, the census), `wants_use.py`. Hooks: choose.ts (tags, weights, prompt lines), mcWorld.ts (the menu build,
  the sweep's `none` path for outlet calls, the counters, explore rings), goals.ts (the pursuit as the goal's measure),
  society.ts (the pursuit call at night), social.ts (debts, the roles line), settings.ts. mcWorld.ts, choose.ts and
  settings.ts have one writer at a time, and another session has uncommitted edits in settings.ts today: the build
  waits for those to be committed.
- Order: step 0 (the timed idle count, the explore supply census, the family-grain baseline and its SD); pursuits and
  outlets (the per-member parts); then esteem, debts and titles; then the pilot and the village-wide pair.
- Open questions 1-3 and 6 stand. Question 4 (outlet calls) now costs +15-30% tokens on its own; question 5 is "ring
  2 only (320 blocks) for the pilot, or ring 3 too". Added: **8. Does the menu-only arm earn its cost** (a third arm
  in every pair), or is shuffled-pursuit control enough for the pilot?

### 9.7 The user's choices (10-30: "let's go with your suggestions")

1. The model chooses its pursuit from code's four candidates, or describes its own (matched by code, else a proposal).
2. Rivalry is shown only to members whose temperament leans to it (high pride).
3. The pull to imitate varies by temperament (sociability).
4. Idle members get the outlet call (its own call kind, rate-limited, against the token budget).
5. Explore ring 2 only (320 blocks) for the pilot; ring 3 after the supply census.
6. Unmatched pursuits go to proposals and the wanted list by default (on, the 10-30 flag rule).
   **Overridden by the user (10-30, DECISIONS ab8bc07): unmatched pursuits go to the triage session first**: a proposal
   (source `pursuit`) for the Claude triage session (G5) only, never on the wanted list or feeding foundry tickets; the
   member hears the triage's answer when it comes. Built in fa1bfcc (wanted list) and the commit after it (foundry).
7. The per-member split first, as a pilot; the village-wide pairs after it.
8. The menu-only arm runs in the village-wide pair, where it separates the want from the menu; the pilot relies on
   shadow and shuffled pursuits.
