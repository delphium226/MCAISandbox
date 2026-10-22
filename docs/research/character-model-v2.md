# Character model v2: temperament, values, needs, mood, relationships, identity

2026-10-22, written for the character v2 spec (`runs/2026-10-22/character/spec.md`) from the planning session's review,
each source checked before its numbers are used here. It extends `docs/research/agent-individuality.md` (10-16) and does
not repeat it: that note's conclusions stand (personas move what a model says far more than what it does; code-held
weights act on the decision itself; identities kept in code, model notes beside them). Where a source was read only as an
abstract, it says so; numbers from abstracts are not relied on.

## What the new sources add

**More reasoning narrows a population; keep the variety in code.** The Context-Value-Action study (Findings of ACL 2026,
full text read) generated and re-evaluated candidate actions for simulated users over more rounds (0, 1, 2, 4, 8 rounds,
GPT-4o-mini): the population's spread fell from 107% of the real human spread to 76%, 65%, 59% and 51%, and the mean
deviation from the ground truth grew from 0.007 to 0.091 (not monotonically) ([CVA](https://arxiv.org/abs/2604.05939),
Table 5). Its own architecture scores candidate actions with a separate verifier trained on real context-value-action
triples; on a 7B base its spread gap was +1% against -35% to -41% for the reasoning agents. For this village: members'
choices stay at low reasoning (they are), the spread between members is code's (weights, draws), and a check that a
choice fits a member's values is a code score beside the model, not more model reasoning.

**Values are levers on a society's stability, and their prevalence tips it.** With 25 GPT-4o residents and Schwartz's ten
values emphasised or removed in a share of them, a community's basin of stability (how far it can be pushed before
collapse) was 19.0 at baseline, 5.4 without benevolence (fast collapse), 11.2 without power and 21.4 without tradition;
with power emphasised, betrayal and deception rose with it (both r = 0.87; with power removed, -0.87 and -0.97); tipping
appeared at intermediate prevalence (about 25% for removing benevolence, 75% for emphasising power) ([Human Values
Matter](https://arxiv.org/abs/2604.05339), full text read in part; behaviours were labelled by GPT-5 and only correlations
are given). For this village: the share of self-enhancement-heavy members is a parameter to cap and to vary on purpose,
benevolence (self-transcendence) kept common, and hoarding and broken promises logged by value.

**Blends of values make better shared rules than single values.** With LLaMA-3.1-70B agents in groups of 4, 10 and 30
holding Schwartz values through dilemma narratives, agents with two neighbouring values produced 20-30% more high-quality
community rules than single-value agents and formed bridges between clusters; groups with no values wrote about 90%
collective ("Rousseauian") rules, value groups 80% with property-rights ("Lockean") rules at 16% ([Huang et
al.](https://arxiv.org/html/2512.10665v1), full text; a pilot with no repetitions or tests). For this village: each member
holds a blend of 2-3 neighbouring values, and G3's rules are where the blend should show.

**Value personas move questionnaire answers reliably, behaviour untested.** Personas built from three trait words per
Schwartz value moved GPT-4o-mini's 57-item value questionnaire answers above or below the neutral model for every value,
in the expected direction against human norms, and reproduced Schwartz's circle; temperature only widened the spread
(mean SD 0.41 at 0.5 to 0.63 at 1.5) ([Hyland, Newsham & Prince](https://aclanthology.org/2026.nlpaics-1.21.pdf), full text
read). The authors note that behaviour in agent environments is untested. For this village: a value line is cheap and
moves votes and stated reasons (questionnaire-like), and its effect on chores has to be measured, as the 10-16 note found
for traits.

**Honesty-humility is resistance to temptation, not general niceness.** Across a reanalysis and a new study varying the
payoff order of prisoner's dilemma, stag hunt and chicken games, honesty-humility predicted cooperation only where
defection is driven by the temptation to exploit, not where it is driven by fear of being exploited ([Hilbig et
al.](https://www.mzes.uni-mannheim.de/en/publications/details/lead-us-not-into-temptation-testing-the-motivational-mechanisms-linking-honesty-humility-to-cooperation),
European Journal of Personality 2018; abstract only, no numbers used). For this village: H levers the choices that are
temptations (keeping a share the levy asks for, taking from storage beyond need, dropping a promise for a better chore),
not helping in general (that is agreeableness and the values).

**Needs as decaying gauges with trait-set targets, and the model choosing among candidates.** D2A gives agents 11 desire
dimensions (14 outdoors), each 0-10, falling by 1 with a profile-set probability per step, with targets set by a
personality adjective ("extremely sociable" 9, "slightly" 7) and dissatisfaction as the sum of shortfalls; the model
proposes three activities, predicts their effect on the desires and picks one; it had the lowest dissatisfaction of the
compared methods (Llama-3.1-70B; GPT-4o as judge, agreeing with humans on every pair where humans agreed above 75%) ([D2A](https://arxiv.org/abs/2412.06435),
full text read in part; win rates only in figures). For this village: code holds the gauges and their trait-set targets
(as the 10-16 note's row 8), the menu shows each option's effect on them, and the model chooses; the model never judges
a need's level.

**Societies at scale use a few numeric emotions and a ranked list of needs.** AgentSociety's agents (over 10,000) keep six
emotions 0-10 with a keyword and a one-sentence thought, a Maslow hierarchy of needs ordered by urgency, and attitudes
0-10, all updated after each action ([AgentSociety](https://arxiv.org/abs/2502.08691), read in part; its validation could
not be checked). For this village: a little numeric state per member is enough; more categories add tokens and noise.

**Models report moods blunted and positive; compute mood from events.** Asked to fill the PANAS questionnaire after
scenes compared with a memory "norm", GPT-3.5 lowered positive affect after negative scenes (-18) but barely raised
negative affect (+0.3 to +1.6); the authors call the results mixed, with no human comparison ([Regan et
al.](https://arxiv.org/abs/2402.04232), full text). An earlier study found that ChatGPT can do basic appraisal from a
prompt-based OCC model ([Broekens et al.](https://arxiv.org/abs/2309.01664), abstract only). For this village: code
appraises events into thoughts (who did what to whom, a goal advanced or blocked: the OCC categories), and the model is
told its mood and the top reasons, never asked how it feels.

**RimWorld's mood is the working template.** Base mood 32 (42 on the peaceful setting); the target is the base plus the
sum of active thoughts; shown mood moves toward it at most +12 an hour up and -8 down; each thought has a value, a
duration and a stack limit with a stacking multiplier (ate a fine meal +5 for a day; kind words +5 and insulted -5 for two
days, stacking to 10 at x0.9; attended a party +8 for 10 days; a colonist lost -6 for 6 days); traits shift the break
thresholds additively (iron-willed -18, steadfast -9, nervous +8, volatile +15), the minor threshold at 35% capped
1-50% ([Mental break](https://rimworldwiki.com/wiki/Mental_break), [Mood](https://rimworldwiki.com/wiki/Mood),
[Thoughts](https://rimworldwiki.com/wiki/Thoughts); community wiki). For this village: thoughts from events code already
logs, trait-shifted sensitivity, a capped rate of change; no breaks (peaceful, no damage), so mood only tilts weights.

**Personality-aligned division of labour: a design idea, not evidence.** The social-spider study of aggressive and docile
females specialising in capture and brood care ([Wright, Holbrook & Pruitt](https://pmc.ncbi.nlm.nih.gov/articles/PMC4084461),
PNAS 2014) was **retracted in 2024** (PNAS 121(22):e2408816121) in the Pruitt data affair; "keystone individuals" come
from related papers in the same affair. Pairing temperament with jobs and skill stays a reasonable game design (the 10-16
note's response thresholds and RimWorld's passions carry it); this source is not cited as evidence.

## What this changes in the 10-16 note

- **Mood moves from "not worth it" to a code-only layer.** The 10-16 note dropped "emotions as moods that swing" because
  in a peaceful world only chat would drive them. Since then G2 and G3 give code-verified events (promises kept and
  broken, help, works built, proposals answered, hunger, rules): enough to appraise in code, as RimWorld does, without
  asking the model.
- **Honesty-humility and agreeableness are the two traits with behavioural evidence for exactly the choices the village
  now has** (promises, the levy, forgiving a breaker), so HEXACO replaces the ad hoc five.
- **Values become a population parameter,** not only a persona line: their prevalence and blends are set and varied by
  code.
- **Reasoning stays low for choices:** CVA's diversity collapse with more reasoning rounds agrees with the 10-16 note's
  "per-agent reasoning levels are not a personality".

## Sources checked, and how

| source | read | relied on |
| --- | --- | --- |
| Hilbig et al. 2018 | abstract (the MZES page and the publisher refused) | the claim only, no numbers |
| Hyland, Newsham & Prince 2026 | full text (PDF) | yes |
| Huang et al. 2025 | full text (HTML) | numbers, flagged as a pilot |
| CVA (Findings of ACL 2026) | most of the full text | Table 3 and 5 numbers |
| Human Values Matter 2026 | half the full text | the basin and correlation numbers |
| D2A 2024-25 | most of the full text | the design; win rates not quoted |
| AgentSociety 2025-26 | half the full text | the state design; not its validation |
| Regan et al. 2024 | full text | its numbers, as "mixed" |
| Broekens et al. 2023 | abstract | the claim only |
| RimWorld wiki | four pages | the numbers (a game, not a study) |
| Wright, Holbrook & Pruitt 2014 | abstract and record | **retracted**: not evidence |
