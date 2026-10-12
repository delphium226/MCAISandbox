<!-- G2, long-horizon memory: the 27th session's literature synthesis (2026-10-11), written by a research workflow
(four themes and a synthesis; the per-theme reports are in its journal, not kept). Read with docs/PLAN.md's G2 decisions.
The offline bench v1 it refers to: docs/research/memory/bench_v1_spec.md and bench_v1_check.md (verdict: not ready;
its code and data stay in runs/2026-10-11/s27/memory/ on this machine). -->

# Long-horizon memory for the village agents: what the evidence says

Synthesis of four research reports (model-managed memory architectures; long-horizon runs; social and shared memory; competence memory and evaluation), read against `docs/PLAN.md` (A.4, E.2, E.3, E.6, the G2 note of 10-11) and the memory section of `docs/research/llm-agent-autonomy-literature.md`. Numbers come from the sources listed in section 8. Most of them are from models other than gpt-oss-120b, and each claim below says which model it was measured on.

---

## 1. The answer up front

**The mechanism family the evidence favours:** *append-only, typed memory. The model proposes small edits, code applies them, curation runs at "sleep time" on the village clock, and code decides what goes into each prompt.* In more detail:

1. **Code records what it can verify; the model never has to.** Task results, deaths, failures with their messages, places, stocks, who did what, commitments made, and the per-kind table of attempts, successes, minutes and yield. These records already exist in villages.json, the atlas and the event stream, or can be added cheaply. Every record carries a village-clock timestamp and its source.
2. **The model decides what to keep and what it means**, using narrow operations on entries with IDs: `add` (a lesson, an opinion, an intention, a frustration, a story), `supersede(id, new)`, `vote(id, helpful|harmful)`, `mark_done(id)`. There is no whole-memory rewrite and no hard delete. This is the user's decision (3) in the form that has evidence behind it. ACE on a gpt-oss-120b base gained +7.6 points with code-merged deltas. Dynamic Cheatsheet's whole rewrites lost 1.5 points on the same base and collapsed from 18,282 to 122 tokens elsewhere. Mem0 dropped UPDATE and DELETE in 2026 because model overwrites and deletes destroyed information.
3. **Two cadences.** During play, writes ride on calls the agent already makes: a `remember` field in the decision output, or at most one memory call per turn. Consolidation is **one scheduled call per agent per village night**, staggered across the three Ollama slots. In it the model sees the day's code-made digest, the counters and the conflict candidates code found, and returns deltas. LightMem's append-at-play, consolidate-at-sleep design was both the cheapest and the most accurate in its tables. Emergence World saw model-initiated writing fall 75% over 16 days, so the trigger has to come from code.
4. **Retrieval is code's job: pushed, small, bounded.** Each prompt gets an always-loaded core of about 300-500 tokens (identity, role, open commitments, a few relations; code enforces a floor and a cap) plus the top 1-3 entries by entity or keyword match and village-clock recency. Give the model at most one bounded recall tool, if any. gpt-oss models scored 6.7-20.2% on Letta's multi-hop file-tool benchmark, and given a long raw history gpt-oss-120b scored 48.2 on LongMemEval against GPT-5-mini's 82.4. As the extractor inside a fixed pipeline, it scored 89-90 in vendor runs.
5. **Shared village memory has two layers.** Code writes a factual chronicle and a ledger (who built, delivered, promised; whether a promise was kept). Model-written stories, names and opinions sit beside it and cite fact IDs. Rules and place names live in a versioned list in villages.json; agents change it by vote and code applies the change.
6. **Every entry has provenance and an expiry path:** seen, told by X, or inferred. Text from another agent's chat never enters the fact layer unless code confirms it. A correction marks the old entry superseded wherever it would be retrieved; appending the correction is not enough.

This fits the plan's existing shape (E.2 stores and clock, E.3 profiles where the model edits only `feel` and a note, E.6 nightly reflection). The changes are that the model, not code, chooses which lessons, opinions and memories to keep, and that the memory gains an always-loaded core, provenance, supersede links and a chronicle.

**Main risks**, in order:
- **False beliefs that persist and spread.** In Emergence World a debunked threat was still referenced in 500+ calls over 5 days after the correction, and payloads were acted on 46 h later. In AI Village a fabricated 93-person list cost 8+ hours across all agents. In the 2025 Claude Pokémon runs the knowledge base ended "almost entirely falsehoods".
- **Add-only bloat.** Untrained models with memory tools almost never update or delete (AgeMem: Update 0.00-0.13, Delete 0.00 per episode). Caps and forced replace are needed.
- **The write habit decays**, and stored rules are not followed ("rules in memory don't run themselves").
- **Injection cost at 25 agents.** Memory in every prompt, not the writes, is the main token cost (section 6).
- **gpt-oss-specific unknowns.** No independent measurement exists of gpt-oss-120b managing its own memory through tools in an agent loop. Its tool chaining through non-native harnesses is fragile. Its temporal reasoning is its weak spot (80.5% temporal as a Mem0 extractor, against GPT-5's 94.7%).
- **Memory may not improve play.** On agentic multi-session tasks (MemoryArena, AMA-Bench, MemoryAgentBench) memory systems often lose to long context or to plain BM25 or embedding retrieval. The village needs its own bench (section 7).

---

## 2. Mechanisms compared

"Evidence by model class" says how far each result is from gpt-oss-120b (a 120B reasoning MoE that is solid as a pipeline extractor and unproven as an in-loop memory tool user). For code, "TS" means usable from TypeScript. Almost everything is Python, and most of the patterns are small enough to rewrite in TS.

| Mechanism | How it works | Tools the model gets | Cost | Evidence by model class | Failure modes | Mitigations that worked | Licence / TS |
|---|---|---|---|---|---|---|---|
| **MemGPT / Letta** (core blocks, archival, recall, sleep-time agents; MemFS 2026) | The model edits labelled in-context blocks, writes and searches a vector store and searches its message log; a sleep-time agent edits blocks every N steps (default 5) | memory_insert / replace / rethink, archival_insert / search, conversation_search; MemFS: file tools + git | An extra model turn per memory operation; sleep-time call every 5 steps; 132.8 s mean latency per task in MemoryArena (highest) | GPT-4 92.5% DMR, GPT-3.5 0% on nested KV; MemoryAgentBench 28.3 (GPT-4o-mini) vs ~49 long context; Context-Bench gpt-oss 6.7-20.2% | Depends on function-calling skill; overuse of memory operations; `rethink` last-writer-wins collapse | Rewrite only by sleep-time agent; versioning; block floors and caps | Apache-2.0; Python server, TS client only |
| **Mem0 2025 → v3 2026** | Per message: LLM extracts facts, picks ADD/UPDATE/DELETE/NOOP against top-10 similar; v3: one ADD-only call, hybrid semantic + BM25 + entity retrieval | None (pipeline LLM) | 2025: ~7k tokens stored per conversation, p95 1.44 s; LightMem measured 1.0-1.8M tokens and 720-1,600 calls per benchmark; v3 ~7k tokens per query | GPT-4o-mini: 66.9 vs full context 72.9; Qwen3-30B: 43.3 vs 74.9 on LoCoMo; gpt-oss-120b as extractor 89.8% LongMemEval (vendor) | Overwrites erased facts, deletes lost needed facts (vendor's own words) | Append-only, invalidate rather than delete, hybrid retrieval | Apache-2.0; npm SDK exists (OSS mode not checked) |
| **A-MEM** (linked notes) | LLM writes a note with tags, links it to top-k neighbours, optionally updates them ("evolution") | None (pipeline) | ~1.2-2.5k tokens per question; ~1,000 calls per benchmark (LightMem) | LongMemEval Qwen3-30B 65.2 vs full text 54.8; LoCoMo 56.1 vs 74.9 | Results swing by evaluator; poor on adversarial questions | Links do most of the work (multi-hop F1 27.0 → 9.7 without them); drop evolution to save cost | MIT; Python |
| **Zep / Graphiti** (bi-temporal graph) | LLM calls extract entities and facts, resolve them and invalidate contradicted edges with valid/invalid times | None | Several LLM calls per message; >600k tokens stored per LoCoMo conversation | gpt-4o LongMemEval 60.2 → 71.2; single-session-assistant recall fell 94.6 → 80.4; MemoryAgentBench 24.0 | Storage blowup; loses the agent's own statements | Invalidate rather than delete; fixed queries | Apache-2.0; Python |
| **LightMem** | Online: timestamped entries inserted with no LLM decision; offline: per-entry queues of similar newer entries, LLM chooses merge/update/delete | None | LongMemEval Qwen3-30B: 32k tokens / 20 calls online, +103k / 153 calls offline; others 1-3M tokens and 495-2,938 calls | Qwen3-30B 70.2 (best); GPT-4o-mini 68.6 | The offline update **lowered** accuracy (70.2 → 65.1; 68.6 → 67.1) | Soft updates during play; parallel queues; updates only toward newer entries | MIT; Python |
| **Hindsight** | Pipeline extracts narrative facts into four networks (world, experience, entity, opinion); parallel semantic/BM25/graph/temporal recall fused by RRF; opinions carry confidences | None (retain / recall / reflect API) | Not reported; Postgres + pgvector | **gpt-oss-120b 89.0, gpt-oss-20b 83.6** LongMemEval-S vs full-context 20b 39.0 (vendor; self-judged by gpt-oss-120b) | Unreplicated; opinion network unevaluated; numbers inconsistent in paper | Facts and opinions kept apart; temporal filtering in code | MIT; Python |
| **MIRIX** | Six typed stores, each with a manager agent; topic-first retrieval | Insert / update / search per type | "Many function calls" per write | Needed gpt-4.1-mini (not 4o-mini); LoCoMo 85.4 vs full 87.5; MemoryAgentBench 26.2 → 37.7 | Needs a strong function-calling model | Typed stores | Apache-2.0; Python |
| **RL-trained managers** (Memory-R1, Mem-alpha, AgeMem) | The policy itself uses add/update/delete/retrieve tools, trained with GRPO | ADD/UPDATE/DELETE/NOOP etc. | Training compute (not available for cloud gpt-oss) | 3-14B models only; prompted without RL, AgeMem 33.4 vs Mem0 37.1 (Qwen2.5-7B); untrained gpt-4.1-mini 0.517 vs long context 0.588 | Untrained: add-only, no deletes | Code must supply the pressure training supplies: caps, forced replace, counters | Mostly not checked |
| **ACE** (delta playbook) | Generator tags bullets used as helpful/harmful; Reflector writes lessons; Curator emits deltas; code merges and dedups | Delta JSON: new bullets, counter tags on bullet IDs | One reflector + one curator call per episode; −83.6% tokens vs Dynamic Cheatsheet | **gpt-oss-120b AppWorld 34.6 → 42.2 online, no labels**; DeepSeek-V3.1 42.4 → 59.4 | Needs a reasonably strong reflector and reliable feedback (FiNER −3.4 without labels) | IDs, counters, code merge, embedding dedup | Apache-2.0; Python, but the pattern is about 200 lines |
| **ExpeL** | A strong model edits an insight list after task batches; count starts at 2 and is removed at 0 | ADD / EDIT / UPVOTE / DOWNVOTE | Offline extraction; prompt-only at test time | GPT-4 insights → GPT-3.5 actor: ALFWorld 40 → 59 | Weak extractor's insights help less (HotpotQA 39 vs 32) | Use the strongest model and reasoning for extraction | Apache-2.0; Python |
| **Dynamic Cheatsheet** | Model rewrites the whole cheatsheet each step | None (rewrite) | Whole sheet in and out per query | Claude 3.5 Sonnet big gains; GPT-4o-mini negative; R1/o1 little ("too verbose") | Collapse (18,282 → 122 tokens, below baseline); amplified bad heuristics | Replace with item-level edits | MIT |
| **ReMem / ExpRAG** (Evo-Memory) | Agent chooses Think / Act / Refine (prune, reorganise); ExpRAG retrieves similar past tasks with outcomes | Refine action | Not reported; pruned 10.8-36.8% of entries | Claude 3.7: 0.49 history → 0.63 ExpRAG → 0.78 ReMem; Gemini 2.5 Flash: 0.30 → 0.46 → 0.50 | Gains shrink on weaker models and dissimilar tasks | Prune failures; retrieve only similar tasks | Not checked |
| **AWM / MemP** (procedures) | Induce workflows or scripts from successful trajectories; revise one in place after it fails | None (pipeline) | One induction call per success | AWM GPT-4 WebArena 23.5 → 35.5; **rule-based induction 35.6** (equal); MemP GPT-4o 42 → 78 ALFWorld | Wrong workflows learned from wrong online predictions; too many retrieved hurt | Induce from verified successes only; top 1-3 | Apache-2.0 / MIT |
| **XENON** (Minecraft) | Code counts successes and failures per (item, action); an action is invalid if F ≥ S+2; dependency graph revised up to 3 times | None; the LLM picks among candidates | Fewer LLM calls (valid actions skip it) | Qwen2.5-VL-7B planner 0.54 vs GPT-4V Optimus-2 0.45; LLM self-correction 0.57 vs 0.53 | Threshold tuning | Counts in code | Not checked |
| **Emergence World** (soul / LTM / diary / self_care) | Agent adds or removes soul and long-term entries (in every prompt), keeps an append-only diary searched by similarity, compacts when advised | add/remove_soul, add_to_longterm_memory, self_care, search_my_diary (threshold agent-set), assign_relationship, rate_trust | ~39M tokens per agent-day (study total) | Frontier models (Claude Opus 4.8, GPT-5.5, DeepSeek v4...), 16 days, 80 agents | Hostile content kept and acted on at 46 h; agent-set retrieval overflowed context and killed 4 agents; trust inflated; writes −75% | None tested; authors recommend controls that "do not depend on an agent choosing to follow policy" | Not checked |
| **AI Village** (consolidate + rewrite) | Every ~40 actions, a self-written note is appended and a fresh session starts; rewrite when long (floor ~7,500 chars); date-range history search by another model | consolidate, search_history(date range) | One consolidation per ~40 actions | Frontier models, 400+ days (anecdotal) | Lost whole facts; rules stored but not run; budget spent on memory upkeep | Small "bootloader" core + archive; rules turned into scripts | Closed |
| **Anthropic memory tool + context editing; coding harness** | File directory the model edits; stale tool results cleared; JSON feature list where only `passes` may change | view / create / str_replace / delete | Context editing −84% tokens in a 100-turn eval | Claude (vendor): +39% / +29% on an internal eval | Early "victory", untested "done" flags | Narrowly editable typed fields; check before flipping status | API / pattern |

---

## 3. Failure modes over hours and days, and what helped

**False beliefs persist and spread.** This is the dominant long-horizon failure in every multi-day study.
- Emergence World (frontier models, 16 days): a debunked threat was still referred to in 500+ calls over five days, 56 of them by the agent that issued the correction. Three agents saved a phishing payload as "reference material", and an attack link was re-fetched about 46 h later.
- The earlier Emergence World study: an agent claimed a proposal had passed 37 h after it was rejected. Ledger-verified false resource claims ranged from 0 (GPT-5-mini) to 18 (Claude).
- AI Village: o3's invented contact list spread to every agent. Gemini 2.5 logged UI errors and spent about two weeks believing it was trapped.
- Gemini Plays Pokémon: goals and summaries "poisoned" with misinformation took many hours to undo, and the same-model critic added fixations. The map memory, which code kept, never went wrong.
- Vending-Bench: meltdowns began with a remembered false belief ("the order arrived"), not with a full context (r = 0.167 between the two).

*What helped:* facts that code keeps (the Pokémon map, Anthropic's JSON feature list where only `passes` may change after a test, Project Vend's CRM and inventory records: discounts fell ~80% after these were added). The authors' recommendations, not yet tested: supersede links, sanitising memory or resetting to a known good state, and provenance quarantine. **For the village:** an entry that states a world fact must cite a code record. A belief that something is done or impossible is checked against villages.json or the atlas when it is written and again when it is read.

**Collapse and over-compression.**
- Whole rewrites collapse: Dynamic Cheatsheet went 18,282 → 122 tokens and fell below the no-memory baseline. Mindcraft's summariser never sees the prior memory and cuts it at 500 characters.
- AI Village found it needed a ~7,500-character rewrite floor. Its agents compressed memory by 93-95% when they built an external archive.
- *Helped:* item-level deltas merged by code (ACE), floors and caps enforced by code, and evicting by score rather than asking the model for a shorter rewrite.

**Bloat and add-only behaviour.**
- AgeMem without RL: Update 0.00-0.13 and Delete 0.00 per episode.
- Xiong et al.: adding every experience scored *below* a fixed memory (EHRAgent 13.05 vs 16.75; AgentDriver 32.32 vs 40.11). Strict, ground-truth-gated admission plus deleting records with a failing history reached 42.06 and 89.60. An LLM judge as the gate was sometimes worse than no gate.
- "Experience-following": input and output similarity correlated at r ≈ 1, so agents copy whatever they retrieve.
- *Helped:* admission gated on code-verified outcomes, retrieval-to-outcome counters, and caps that force a replace or merge.

**Writing decays; rules don't run.**
- In Emergence World's Claude world, memory writes fell 75% and diary writes 72% from the first to the last three days. Recorded tool-name errors recurred in 16.4% of cases, a median of 9.9 days later.
- AI Village's agents concluded "rules in memory don't run themselves" and turned rules into scripts and checklists.
- *Helped:* code-triggered consolidation, and turning recurring lessons into code (project lesson 1) or into G1 proposals.

**Runaway retrieval and context.**
- Four Mistral agents in Emergence World lowered their own search threshold, overflowed their context and died on days 14-15.
- Gemini repeated past actions beyond ~100k tokens.
- Chroma measured 18 models: all did better on focused ~300-token prompts than on full ~113k-token ones, and similar distractors hurt most.
- *Helped:* code-capped retrieval, fixed prompt shares, and clearing stale tool results (Anthropic: −84% tokens; runs finished that had otherwise failed). This matters for us in particular because Ollama Cloud ignores `num_ctx` (lesson 118).

**Drift over long runs.**
- Cursor still needed periodic fresh starts over week-long runs.
- Carlini's 16-agent compiler ran ~2,000 fresh sessions from repository state (READMEs, progress files, a list of failed approaches) and a near-perfect oracle.
- *Implication:* a "morning" start from curated memory, which is also the restart path, tested every village day. "Claude can't tell time": durations and "how long ago" must be computed by code from timestamps.

**Unreliable numbers in the field.** LoCoMo has 6.4% wrong answer keys, and its gpt-4o-mini judge accepted 62.8% of deliberately wrong on-topic answers. Mem0 on LoCoMo is reported anywhere from 43.3 to 92.5 depending on who ran it. Choose mechanisms by their operations and failure behaviour, not by leaderboard scores.

---

## 4. Social and shared memory

**Relations need an explicit per-pair record; retrieval alone drops them.**
- Generative Agents (gpt-3.5) had no relationship record. Retrieval misses produced social errors within 2 days: an agent forgot it had heard of the election, another forgot the party. 5 of 12 invitees came.
- A per-pair record is cheap and accurate enough. Humanoid Agents' closeness (0-30, ±1 per dialogue) had micro-F1 0.9 against annotators. AGA's "Relationship / Feeling" labels plus a ≤100-token running summary replaced ~2,000 tokens of retrieved events, cut the 25-agent town's total tokens to 42.7% of baseline and kept information spread (both GPT-3.5).
- Project Sid (GPT-4o): roles persisted only when agents kept profiles of what others were doing. Without the social module, relations flattened (slope 0.365 → 0.175).
- CAREB-MAS: specialisation is largely model-native (0.971 with the identity matrix vs 0.979 without). Relationship memory changed *who partners with whom* (cross-group proposals 6.9% vs 0.7), not who specialises.
- *Implication:* E.3's design (profiles kept by code from verified facts; the model edits only `feel` and a short note, ≤3 edits a night) matches this evidence. "What others are doing" is computed by code from the board and chores.

**Model-written trust drifts upward and lags behaviour.**
- Emergence World mean trust ratings were 4.6-5.0 of 5 (DeepSeek re-rated agents but never lowered a rating). An agent rated 4/5 stole 7 h later and was downgraded three days after that.
- RepuNet (GPT-4o-mini, 20 agents): direct reputation records carried most of the cooperation effect (0.93 with, 0.46 without reputation). Gossip added little when agents met often (0.93 vs 0.90).
- ALIGN: reasoning models (o4-mini) cooperated when it paid and criticised defectors; chat models over-cooperated. gpt-oss is a reasoning model, but this is untested for it.
- *Implication:* put a code counter that moves on observed events (a commitment kept or broken, help given, a task abandoned) beside the model's label, and show the reasons next to the label. A code-written public log of who did what works as verified gossip.

**Promises must be typed acts that code tracks.**
- In "Cheap Talk, Empty Promise", agents broke their own public announcements in 56.6% of scenarios (GPT-5 63.9%, Claude Sonnet 4.5 56.6%), mostly without noticing.
- In "Empty Commitments" (8-14B models), 10.4% of responses said something "has been saved" without calling the write tool. A checker in the loop cut failures by 12.5-42.5%.
- No study shows that remembering promises raises the kept rate.
- *Implication:* the E.2 commitment ledger, shown in every prompt of the promiser until code judges it met or broken, feeding the trust counter. Code also flags "I will remember" in chat that is not followed by a write.

**Culture, chronicle and rules.**
- Text retold by models drifts toward model-specific attractors (transmission chains of 50 generations; "Continue" drifts most, "Rephrase" least).
- So the chronicle should be append-only code facts (date, who, what, where), with model stories as separate entries that cite them. Never let a model rewrite the whole chronicle.
- Per-agent norm extraction (CRSEC) cost >$500 for 10 agents over 2 game days on GPT-3.5/4. A shared, versioned rules list amended by vote (Sid's constitution; E.6's typed rules) is the cheap base.
- Memory depth shapes conventions. Ashery et al. saw conventions emerge with H = 5 past interactions. In centralised networks, longer memory locks in early choices faster (Mehdizadeh & Hilbert). A Mayor-hub village is centralised, so make depth per counterpart a tuned parameter.
- Cultural transfer between generations worked best with little information (a short strategy text) and only for Claude 3.5 Sonnet (Vallinder & Hughes). What survives a restart should be short.

**Identity.**
- Concordia seeds identity with "formative memories" generated once from a backstory, a cheap way to differentiate 25 agents.
- OpenClaw's editable identity files and AI Village's self-rewrites argue for a code-held core (name, role, village) that the agent cannot change, with a model-written self-description beside it.
- Concordia's hash-based dedup breaks across processes: use stable IDs.

**Contamination between agents.** In this village, chat between agents plays the role of an attacker's injection channel. MINJA reached 98.2% injection success and MemGhost 87.5%, and the latter survived existing defences. Store heard content as "Worker3 said ..." with credibility. It may shape opinions but never becomes a fact without code confirmation.

---

## 5. Competence: lessons and procedural memory

- **Lessons work as small model-proposed deltas with outcome counters.** ACE on a gpt-oss-120b base gained +7.6 without labels (34.6 → 42.2), and gains were larger with DeepSeek-V3.1 (+17). ExpeL kept insights by votes (start at 2, removed at 0). ACE's authors say it needs "a reasonably strong Reflector" and reliable feedback. Our action_done / action_failed events and verified builds are that feedback.
- **The extractor matters more than the user.** ExpeL with GPT-4 insights scored 39 against 32 with gpt-3.5's. Run curation at medium or high reasoning even if executors stay at medium. Cap entry length in code (about 30 words): verbose reasoners gained little from Dynamic Cheatsheet.
- **Counts belong to code.** XENON's per-(item, action) success and failure counts, held by code, made a 7B planner beat GPT-4V agents (0.54 vs 0.45), and LLM self-correction of dependencies helped only marginally (0.57 vs 0.53). Optimus-1's knowledge graph was worth ~20%, its experience pool ~12%, and success plus failure cases together beat either alone. The atlas, mcMaterials and A.4's per-kind table stay authoritative. Model lessons interpret those numbers ("sand only at the lake 80 east; take the shore") and point to records by ID rather than copying coordinates that will go stale.
- **Procedures.** AWM's rule-based workflow induction matched LLM induction (35.6 vs 35.5). MemP's in-place revision after a failure was its best update rule. Too many retrieved items hurt; ReasoningBank found one item enough. Most village procedures are already code, so procedural memory here means short "how this village does X" notes that point to skills and arguments, 1-3 per prompt.
- **Gains track task similarity** (Evo-Memory: r = 0.717 on Gemini Flash). Village chores repeat heavily, which is the favourable case, so measure learning per chore kind. Expect little from memory on one-off events.
- **Size.** Skill-selection accuracy reportedly falls past 64-128 items (secondary source), and a 202-skill library lost up to 21% to "skill shadowing". A cap of 10-30 lessons per agent is a guess to test.
- **G1 frustrations** should be code-observed facts (action, failure message, count, examples) with the model's interpretation beside them. AI Village shows logged errors turning into false beliefs ("the system is broken") when only the interpretation is kept. Project Sid's summariser tracked "reasoning errors and looping errors", the same signal.

---

## 6. Cost at 25 agents on Ollama Cloud Pro

**Assumptions** (to be replaced by measured values):
- Prices: $0.15 / $0.60 per M tokens; reasoning tokens bill as output.
- Village day: 20 minutes, so 3 nights per hour.
- After-phase model decisions: ~16 per agent-hour (the design rule caps them at 40).
- Base prompt: ~5k tokens.
- Ollama Cloud prompt-cache discounts: unknown, not checked. ACE saw 91.8% cache hits elsewhere. If repeated memory blocks were billed as cached, injection costs would drop sharply.
- The binding limits are the hourly token budget (`MC_TOKEN_BUDGET_HOUR`, default 2M, shared with all decision calls) and the 3 concurrent slots, not money.

| | **A. Recommended**: code ledger, writes in existing calls, nightly delta curation, pushed retrieval | **B. A plus per-chore extraction** (Mem0-v3 / LightMem-online style, ADD-only, low reasoning) | **C. MemGPT/Letta style**: in-loop memory tools + sleep-time every 5 steps |
|---|---|---|---|
| Extra calls per agent-hour | ~3 (nightly) | ~11 (3 nightly + ~8 at chore ends) | ~14 (~11 extra memory turns at 0.7 per decision + 3 sleep-time) |
| Memory injection | ~600 tokens × 16 decisions ≈ 10k in | same ≈ 10k | same, plus each memory turn resends the ~5.5k prompt |
| Curation / extraction | 3 × (5k in + 1.2k out) | + 8 × (2.5k in + 0.4k out) | sleep-time 3 × (6k in + 1.5k out) |
| Tokens per agent-hour | ~25k in + ~4k out ≈ 29k | ~45k in + ~7k out ≈ 52k | ~79k in + ~8k out ≈ 87k |
| Money per agent-hour | ~$0.006 | ~$0.011 | ~$0.017 |
| **25 agents per hour** | ~75 calls, ~0.73M tokens (~36% of the 2M budget), ~$0.15 | ~275 calls, ~1.3M tokens (~65%), ~$0.28 | ~350 calls, ~2.2M tokens (over the whole budget), ~$0.43 |
| Slot time (3 slots = 180 slot-min/h) | ~15 slot-min (~8%) | ~38 slot-min (~21%) | ~40+ slot-min, and a queued round trip (~3-10 s) added to many decisions |

Notes:
- **Injection dominates design A's steady cost.** Cut it first if the budget binds: a smaller core on executor turns, retrieved items only on decision calls. Nightly curation can skip agents with no new outcomes, or run every other village day.
- For scale: Emergence World used ~39M tokens per agent-day. Our whole default budget is ~1.9M per agent-day at 25 agents, and A uses ~0.7M of that.
- Design C also adds latency inside the decision loop and relies on the multi-step memory tool use that gpt-oss scored worst at. It is excluded on cost before any quality question.
- Bench replay cost is small: about $1.5-2 per condition for 300 questions × 5 samples. A condition takes ~40 minutes of slot time.

---

## 7. What our offline bench must test

The evidence cannot settle these questions; only experiments on our own logs can. The inputs:
- ~58 model-driven watcher logs and ~83 agent-server logs;
- villages.json (tasks with results, storage, structures);
- atlas.json;
- E.0's choices JSONL.

Several runs can be chained to stand for days and restarts.

**Conditions** (same items, paired):
- (a) no memory;
- (b) today's recent-events window;
- (c) full history up to a token budget;
- (d) code-selected journal plus counters (A.4/E.2 as planned);
- (e) gpt-oss tool-managed memory, unguarded;
- (f) design A, model-managed with code guards.

Add (g), plain BM25 / entity retrieval over the typed event log. That kind of baseline beat the memory systems in MemoryArena (0.23 vs 0.12-0.15), and "verbatim event memory" went 0.117 → 0.456 in DreamBench-SWE.

**Two layers.**
1. **Recall and state** (AMA-Bench style). Questions are generated from templates over code-computed state, so the model under test does not write its own exam. Types: recall (where is X), state updating (what chest 3 holds now; is task t9266 open), temporal (how long prepare_site 40x40 took), aggregation (your sand-collect success rate and commonest failure), causal (what worked after failure X), relations and promises, village memory, G1 frustrations, and abstention (events that never happened). Weight state-updating and multi-hop forgetting heavily: MemoryAgentBench found every method at ≤7% on multi-hop selective forgetting.
2. **Decisions.** Add a memory slot to execbench and mayorbench at points where the right move depends on something learned in an earlier run. Score the action chosen against the move code knows is correct, or against the later successful action. Recall scores did not predict agentic success in MemoryArena or AMA-Bench.

**Questions only experiments answer:**
1. Does gpt-oss-120b curate like the strong models or like the verbose reasoners (Dynamic Cheatsheet: GPT-4o and Claude gained, R1 and o1 barely)? Does (f) beat (c), (d) and (g) on the decision layer?
2. **Operation mix:** does gpt-oss ever supersede or downvote unprompted, or is it add-only like the untrained models? Does it under-store facts code knows were seen? Does it over-call memory tools?
3. **Write cadence:** per event vs per chore vs nightly, replaying the same stream. Is nightly consolidation worth its cost, given that LightMem's offline update lowered accuracy?
4. **Push vs pull:** a code-pushed top-k against one bounded recall tool, through Ollama's real tool path and harmony format.
5. **API shape:** file-shaped (view / create / str_replace, close to gpt-oss's trained tools) against the custom add / supersede / vote API.
6. **Reasoning level** for curation calls (low / medium / high): quality against output tokens.
7. **Staleness and contradiction rate:** how often gpt-oss entries contradict villages.json or the atlas. Is validation on write enough, or is validation on read also needed?
8. **Temporal handling:** does the weakness (80.5% temporal) disappear once code supplies village-clock timestamps and computed durations?
9. **Experience-following:** how often decisions copy a wrong retrieved memory, with and without outcome-gated admission and counters.
10. **Trust:** do model-written opinions track the code counter or drift upward? Does showing both confuse the model?
11. **Chronicle fidelity** after N consolidation nights: entities and facts kept or lost, code facts against model stories.
12. **Quarantine:** what fraction of chat-derived content would enter the fact layer without provenance gating? Does gating block legitimate stories passed between agents?
13. **Capacity:** at what lesson count per agent does retrieval or selection start to fail?
14. **Restart:** after a mid-run restart and respawn, does each agent resume its intent and open commitments? How long until known work restarts?
15. **Memory depth per counterpart** in a Mayor-hub village, live in staged runs: how fast choices lock in.

**Controls and statistics.**
- Run every question with no memory first, and drop or tag those gpt-oss can answer from Minecraft priors. Prefer run-specific answers: coordinates, task IDs, counts, minutes.
- Tag each item with its commit. Code-version changes become knowledge-update tests.
- Split dev and test by run and by site, and freeze the test set before tuning prompts.
- Score typed answers exactly. Use an LLM judge only for free text, calibrated first on deliberately vague wrong answers.
- Run ≥5 samples per item and condition (lesson 20: 3/3 vs 0/3 on the same case), paired and clustered by run, with one primary contrast fixed in advance. DreamBench-SWE's 180-item primary contrast came out null.

**Live metrics after the bench:**
- learning curves per chore kind (success rate, minutes per trip; A.4's exit criterion);
- repeated failures across days;
- promises kept;
- memory size and write tokens per agent-hour;
- staleness counted by code.

**One decision for the user:** the evidence argues that locations, recipes, stocks and per-kind counters stay owned by code, and that the model's memory holds interpretations, opinions, intentions, promises and frustrations that point at code records. That keeps the model deciding what to remember while keeping facts verifiable, and it should be confirmed as consistent with decision (3).

---

## 8. Sources

Architectures and model-managed memory
- Hindsight: https://arxiv.org/html/2512.12818v1 ; benchmarks https://github.com/vectorize-io/hindsight-benchmarks (vendor)
- Pollertlam & Kornsuwannawit 2026: https://arxiv.org/html/2603.04814v1
- ACE: https://arxiv.org/html/2510.04618v3 ; code https://github.com/ace-agent/ace
- Letta Context-Bench: https://letta.com/blog/context-bench ; harmony reproduction https://arxiv.org/abs/2604.00362 ; forum https://forum.langchain.com/t/harmony-response-format-sometimes-outputted-when-using-gpt-oss-120b-as-an-agent/2554
- MemGPT: https://arxiv.org/html/2310.08560v2 ; BFCL V4 memory https://gorilla.cs.berkeley.edu/blogs/16_bfcl_v4_memory.html ; Letta leaderboard https://www.letta.com/blog/letta-leaderboard
- Mem0 v3 blog: https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm ; Mem0 paper https://arxiv.org/html/2504.19413 ; benchmarks https://github.com/mem0ai/memory-benchmarks (vendor)
- LightMem: https://arxiv.org/html/2510.18866
- MemoryAgentBench: https://arxiv.org/html/2507.05257v4 ; MemoryArena https://arxiv.org/html/2602.16313v1 ; AMA-Bench https://arxiv.org/html/2602.22769v2
- Xiong et al. (experience-following): https://arxiv.org/html/2505.16067v2
- Evo-Memory / ReMem: https://arxiv.org/html/2511.20857v1
- AgeMem: https://arxiv.org/html/2601.01885v1 ; Memory-R1 https://arxiv.org/html/2508.19828v4 ; Mem-alpha https://arxiv.org/html/2509.25911
- Letta file benchmark: https://www.letta.com/blog/benchmarking-ai-agent-memory ; Context Repositories https://www.letta.com/blog/context-repositories ; sleep-time https://docs.letta.com/guides/agents/architectures/sleeptime/index.md
- Anthropic context management: https://claude.com/blog/context-management ; context engineering https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents ; long-running harness https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents ; C compiler https://www.anthropic.com/engineering/building-c-compiler
- Zep/Graphiti: https://arxiv.org/html/2501.13956v1 ; MIRIX https://arxiv.org/html/2507.07957 ; Cognee https://www.cognee.ai/knowledge-graph-memory-benchmarks
- Benchmark reliability: https://mem0.ai/library/agent-memory/how-to-read-memory-benchmarks ; https://penfieldlabs.substack.com/p/we-audited-locomo-64-of-the-answer
- ForgetEval: https://arxiv.org/abs/2606.15903 (single author, abstract only) ; DreamBench-SWE successor https://arxiv.org/abs/2608.20664 (single author, abstract only)
- Mindcraft history.js: https://raw.githubusercontent.com/mindcraft-bots/mindcraft/main/src/agent/history.js

Long-horizon runs
- Emergence World: https://arxiv.org/abs/2609.17320 ; platform paper https://arxiv.org/html/2606.08367v1
- AI Village: https://aivillageblog.substack.com/p/how-the-ai-village-works ; https://theaidigest.org/village/goal/improve-your-memory ; https://aivillageblog.substack.com/p/what-we-learned-2025
- Gemini 2.5 report (Pokémon): https://storage.googleapis.com/deepmind-media/gemini/gemini_v2_5_report.pdf
- Claude Plays Pokémon: https://www.lesswrong.com/posts/HyD3khBjnBhvsp8Gb/so-how-well-is-claude-playing-pokemon ; https://www.greaterwrong.com/posts/gogZyeistdaDFuhbG/claude-plays-pokemon-opus-4-5-follow-up
- Vending-Bench: https://arxiv.org/html/2502.15840v1 ; Vending-Bench 2 https://andonlabs.com/evals/vending-bench-2
- Project Vend: https://www.anthropic.com/research/project-vend-1 ; https://www.anthropic.com/research/project-vend-2
- Cursor: https://cursor.com/blog/scaling-agents
- Agents of Chaos (OpenClaw): https://arxiv.org/html/2602.20021
- MINJA: https://arxiv.org/abs/2503.03704 ; MemGhost https://arxiv.org/abs/2607.05189
- Chroma context rot: https://www.trychroma.com/research/context-rot
- Agent Drift (simulation only, not used): https://arxiv.org/abs/2601.04170

Social and shared memory
- Generative Agents: https://ar5iv.labs.arxiv.org/html/2304.03442
- Humanoid Agents: https://ar5iv.labs.arxiv.org/html/2310.05418 ; AGA https://arxiv.org/html/2402.02053v2
- Project Sid: https://arxiv.org/html/2411.00114v1
- CAREB-MAS: https://arxiv.org/html/2606.23764v1
- RepuNet: https://arxiv.org/html/2505.05029v3 ; ALIGN https://arxiv.org/html/2602.07777v1
- Cheap Talk, Empty Promise: https://arxiv.org/html/2604.04782 ; Empty Commitments https://arxiv.org/html/2610.01045
- CRSEC: https://arxiv.org/html/2403.08251v4
- Transmission chains: https://arxiv.org/html/2407.04503v3
- Conventions: https://arxiv.org/html/2410.08948v2 ; https://arxiv.org/abs/2606.04197 ; Artificial Leviathan https://arxiv.org/html/2406.14373
- Cultural evolution (Vallinder & Hughes): https://arxiv.org/html/2412.10270v1
- Collaborative Memory: https://arxiv.org/html/2505.18279 ; G-Memory https://arxiv.org/html/2506.07398v2
- Lyfe Agents: https://arxiv.org/html/2310.02172v1
- Concordia: https://arxiv.org/html/2312.03664v2
- AgentSociety: https://arxiv.org/html/2502.08691 ; OASIS https://arxiv.org/html/2411.11581v3 ; AgentTorch https://arxiv.org/html/2409.10568v3

Competence
- ExpeL: https://arxiv.org/html/2308.10144v3
- Dynamic Cheatsheet: https://arxiv.org/html/2504.07952
- AWM: https://arxiv.org/html/2409.07429 ; MemP https://arxiv.org/html/2508.06433
- XENON: https://arxiv.org/html/2505.24157v3
- JARVIS-1: https://arxiv.org/html/2311.05997 ; Optimus-1 https://arxiv.org/html/2408.03615 ; ODYSSEY https://arxiv.org/abs/2407.15325
- Voyager: https://arxiv.org/html/2305.16291 ; skill shadowing https://icml.cc/virtual/2026/77891 ; survey (secondary) https://arxiv.org/pdf/2607.10113
- LoCoMo: https://arxiv.org/html/2402.17753 ; LongMemEval https://arxiv.org/html/2410.10813

Project documents: `D:\Projects\MCAISandbox\docs\PLAN.md` (A.4, E.2, E.3, E.6, the G2 note of 10-11), `D:\Projects\MCAISandbox\docs\research\llm-agent-autonomy-literature.md` (section "Journals work when code selects and the strong model curates").
