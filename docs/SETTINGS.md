# Settings

Generated from `server/src/settings.ts` by `scripts/settings_doc.mts`; do not edit by hand. Every setting is an
environment variable of the agent server (or the sandbox). "Default" is the value used when it is unset (a flag: `on`
or `off`; any of on/1/true turns a flag on, off/0/false turns it off, as each reads it). "Live" settings may change
during a run; the others need a restart. "Not in" names run kinds a setting must not be raised in.

200 settings.

## Game speed

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_BUILD_SPEED` | number | `1` |  | not in acceptance | Building speed multiplier (MC_BUILD_SPEED): 1 is about 10 blocks per second; raise it to make tests faster. |
| `MC_HASTE` | number | `0` |  | not in acceptance | Haste level given to bots (digs faster; staged tests only, never acceptance runs). |
| `MC_RANDOM_TICK` | number | `3` |  | not in acceptance | Paper's random tick speed (crops grow faster; staged tests only). |
| `MC_TIME_SCALE` | number | `1` |  | not in acceptance | Game speed: Paper's tick rate and the after phase's clocks (2 for staged runs; never acceptance runs). |

## Models and budget

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_CALL_SLOTS` | string | (unset) |  |  | Model calls at once per provider ("ollama-cloud=3"). |
| `MC_CHOOSE_MODEL` | string | `ollama:gpt-oss:120b-cloud` |  |  | The model for choices (default: MC_EXEC_MODEL, else gpt-oss cloud). |
| `MC_EXEC_MODEL` | string | `ollama:gpt-oss:120b-cloud` |  |  | The executors' model (and choices', unless MC_CHOOSE_MODEL). |
| `MC_LLM_INTERVAL_MS` | number | `6000` |  |  | The sandbox Claude brain's least interval between calls. |
| `MC_LLM_LIMITS` | flag | `on` |  |  | MC_LLM_LIMITS (the user's, 10-23): on (default) keeps every limit on how often members call the model; off lifts them all for a run, each limit's own setting still taking precedence where it is set: - the member's minimum gap between model decisions (MC_CHOOSE_MIN_GAP_MS; 90 s, 30 s with work... |
| `MC_LLM_MODEL` | string | `claude-opus-5` |  |  | The sandbox Claude brain's model. |
| `MC_MODEL_RECORD` | string | (unset) |  |  | Record every model call (runs/model-calls); 0 turns it off. |
| `MC_MODEL_REPLAY` | string | (unset) |  |  | Replay model calls from these recorded files (comma list), free. |
| `MC_MODEL_REPLAY_MODE` | string | (unset) |  |  | exact: replay only word-for-word prompts (else by sequence). |
| `MC_OLLAMA_CTX` | number | `8192` |  |  | Ollama's num_ctx for local models. |
| `MC_OLLAMA_ROUTES` | string | (unset) |  |  | Models routed to their own Ollama servers ("model=url,..."). |
| `MC_OLLAMA_TIMEOUT` | number | `300` |  |  | How long one local model call may take (MC_OLLAMA_TIMEOUT, seconds): a 27B planner can queue behind another agent's call. |
| `MC_OLLAMA_URL` | string | `http://localhost:11434` |  |  | The Ollama app's address. |
| `MC_PLAN_INTERVAL_MS` | number | `180000` |  |  | The workers' planner's least interval between plans. |
| `MC_PLAN_MODEL` | string | (unset) |  |  | The workers' planner's model (default: the executors'). |
| `MC_REASONING` | string | (unset) | yes |  | Reasoning level per call kind (exec=medium,plan=low,design=medium). |
| `MC_SPEND_CAP_USD` | string | (unset) |  |  | A spend cap in dollars for paid model calls. |
| `MC_SPEND_PROGRAMME_START` | string | (unset) |  |  | When the spend cap started counting (a date). |
| `MC_TEMPERATURE` | number | (unset) | yes |  | Ollama models' sampling temperature for every call (0-2; unset: 0.4). |
| `MC_TOKEN_BUDGET_AGENT_HOUR` | number | `150000` |  |  | Cloud tokens an agent an hour, for the budget that follows the agents. |
| `MC_TOKEN_BUDGET_AGENTS` | string | (unset) |  |  | The least agent count the hourly budget scales by. |
| `MC_TOKEN_BUDGET_HOUR` | string | (unset) | yes |  | Cloud tokens an hour for all calls (2,000,000; unset: it follows the agents). |
| `MC_TOKEN_PRICES` | string | (unset) |  |  | Token prices per model, for the cost lines. |
| `MC_TOKEN_WINDOW_MS` | string | (unset) |  |  | The token budget's window. |

## Choices and pacing

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_BAN_SCOPE` | string | (unset) |  |  | member: a failed choice bans the option for that member only (else the village). |
| `MC_BLOCK_MIN` | number | `6` |  |  | Minutes a work block lasts (divided by the time scale). |
| `MC_CHOICE_FAMILIES` | string | `make,gather,works,light,catalog,furnish,initiatives,activities` |  |  | Goal-2 families switched on (S.9: make, gather, works; B.4: light); empty: none (the golden check, A.8's baselines). |
| `MC_CHOICE_HOLDS` | flag | `on` |  |  | #97 (MC_CHOICE_HOLDS=on, off): a pending decision holds the options it was shown (their keys and further keys) until its answer runs or it is dropped, so no other member's menu offers them meanwhile; one shown a project of its own counts as an open project against INITIATIVES_MAX. The... |
| `MC_CHOICE_INSTANCES` | string | `explore,start` |  |  | Option kinds offered as several instances on one menu. |
| `MC_CHOOSE` | string | `fixed` | yes |  | Who picks after-completion chores: fixed (code), model, or scripted (staged runs). |
| `MC_CHOOSE_BACKUP` | flag | `off` |  |  | MC_CHOOSE_BACKUP=on: the model names a second option, run when its first is taken by the time the pick runs, before a re-ask (All1, F304: 299 fixed picks for a taken pick and 475 re-asks with every member on the model). |
| `MC_CHOOSE_FALLBACK_MS` | number | `20000` |  |  | A choice call is cut off this long after its send (then the fixed pick). |
| `MC_CHOOSE_HOURLY` | string | (unset) |  |  | Model choices a member may make in an hour. |
| `MC_CHOOSE_MIN_GAP_MS` | string | (unset) |  |  | The least time between two model choices of a member. |
| `MC_CHOOSE_PARALLEL` | string | (unset) |  |  | 2, one below the gate's 3 cloud slots (modelCall.ts:199), so a human reply, a plan or an executor turn always finds a slot free of decisions (C11). (MC_LLM_LIMITS=off: every cloud slot, no give-up in the queue or at the gate; each setting still wins where set) |
| `MC_CHOOSE_QUEUE_MS` | string | (unset) |  |  | How long a choice may wait in the queue for a model slot. |
| `MC_CHOOSE_QUOTA_BACKOFF_MS` | number | `300000` |  |  | How long decisions leave a model alone after the provider refused for its quota (Ollama 429). |
| `MC_CHOOSE_WAIT_MS` | string | (unset) |  |  | How long a member waits for its choice before the fixed pick. |
| `MC_CONTROLLER` | flag | `off` |  |  | The controller: intents weigh the fixed and scripted picks. |
| `MC_DECLINE_MS` | number | `90000` |  |  | A.3p: how long a disliked option waits for a member who likes it before anyone takes it (MC_DECLINE_MS). |
| `MC_INTENT_WEIGHT` | number | `1.3` |  |  | How much a member's intent weighs in the controller's pick. |
| `MC_POLICY_OPTIONS` | flag | `off` |  |  | #122 (MC_POLICY_OPTIONS=on, off): on a menu that is empty or holds only filler makes, code's policy gates become options with their facts: a material nothing wants gathered anyway (under GATHER_ANYWAY_MAX in storage), a project past the village's cap (under twice it); the filler makes leave such... |
| `MC_QUICK_NEXT` | flag | `off` |  |  | The wait between chores (the user's, 10-22): MC_QUICK_NEXT=on runs the village's check within a few seconds of a chore's end (at most every QUICK_GAP_MS) instead of at the 30 s cycle, and skips the 10 s member cooling for a chore whose actions all finished (the cooling is for a stopped or... |
| `MC_SCRIPTED_ACTS` | number | `0.3` |  |  | In scripted runs, the share of choices that make an act. |
| `MC_WORK_BLOCKS` | flag | `off` |  |  | MC_WORK_BLOCKS: model decisions paced through the hour (modelCallsLastHour), at most PACE_BURST at a time. |

## Building

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_FLOWER_MIX` | flag | `off` |  |  | #140: with MC_GARDENS, a flower bed or ring is planted from a mix of 2-4 of the one-block flowers counted within 80 of the storage hut (each with enough blocks to gather), drawn per member; the option, the design and the bill name the mix, and its crew picks each kind by name. |
| `MC_GARDENS` | flag | `off` |  |  | #45: flower beds and front gardens (MC_GARDENS, off). A front garden is two beds of flowers on the grass either side of a house's door walkway (the walkway itself left as it is), one design a walkway's direction; a flower ring circles a green's centre, its four sides open. Planted from flowers... |
| `MC_GEN_HOMES` | flag | `on` |  |  | Generated homes (buildingGen) beside the catalogue's. |
| `MC_GREENS_PER` | string | (unset) |  |  | Members a green (the user's, s36): a village prepares one green per GREENS_PER members for small works (MC_GREENS_PER for experiments, s43). |
| `MC_GROW` | flag | `on` |  |  | Growth after completion: neighbourhoods until a house per member; 0 turns it off. |
| `MC_GROW_BATCH` | string | (unset) |  |  | Houses a growth layout lays out at once. |
| `MC_GROW_FARMS` | flag | `off` |  |  | Neighbourhood fields and farm slots. |
| `MC_GROW_OUTWARD` | flag | `off` |  |  | MC_GROW_OUTWARD=on (#138; off by default): on a village laid out on pads (MC_PAD_PER_BUILDING), growth places each new house at the nearest good spot on the edge of the village, on its own pad joined to the paths, instead of a neighbourhood on a flat plot found further off. |
| `MC_GROW_RANGE` | string | (unset) |  |  | How far from the village growth may lay out. |
| `MC_HOUSING` | flag | `on` |  |  | N.2 housing (s37; on by default since s38, MC_HOUSING=off turns it off): each member owns a house, a street of houses is a member's own project (the chore menu's `grow:street`) or a voted work, and growth's code trigger is retired (growth lays out only on a request). Growth's machinery stays:... |
| `MC_INITIATIVE_STORE` | flag | `on` |  |  | MC_INITIATIVE_STORE=off: initiatives gather all their own (s36's rule); on by default since s40 (the user's, 10-20). |
| `MC_INITIATIVES` | number | `3` |  |  | Initiatives (small works members start) open at once in a village; 0: none. |
| `MC_LIGHT_FACADES` | flag | `off` |  |  | Vanilla's facade torches lit too (D4: vanilla's own look); off, only the spots inside. |
| `MC_OPEN_STORAGE` | flag | `on` |  |  | The open-sided storage hut (MC_OPEN_STORAGE=on; off by default; the user's, 10-24): the same footprint, floor, roof, chest, barrel and station spots, but no walls: log posts at the four corners and halfway along each long side (the torches' and the sign's support: a wall torch on a post, the... |
| `MC_PAD_HALO` | string | `on` |  |  | #136: blended pad edges and cave sealing in prepare_site. |
| `MC_PAD_PER_BUILDING` | flag | `off` |  |  | MC_PAD_PER_BUILDING=on (#84 C1; off by default): a village's first street plan is not levelled as one plot but laid out on pads, each building, the wheat field and each farm slot on its footprint and a 1-block ring, at its own level and blended into the ground (prepare_site layout=N pad=K;... |
| `MC_PEN_VARIETY` | flag | `off` |  |  | #139: a 25x13 annex (the classic 13x9 where none fits; on pads, at its own ground level) with 3-4 pens of varied sizes and shapes (3x3 to 7x9 inside, and an L), a set per village; pens for sheep and pigs (and rabbits, goats) besides chickens and cows, each in the free pen nearest the size of its herd, its cap by area; goats milked, sheep sheared (with shears in storage). |
| `MC_PROJECT_REST_MS` | number | `120000` |  |  | How long public works rest after "no new work" wins. |
| `MC_PROJECTS` | flag | `on` |  |  | X.2: public works (MC_PROJECTS, on by default since X2p: 7 works in an hour, steady busy 1% -> 3-4%); the status quo option's id; how long a "no new work" win rests the question (2 min: at 5 the rests were most of each cycle, X2p). |
| `MC_QUARTER` | number | `3` |  |  | X.2 part 2a: the most pieces a public work's quarter holds (MC_QUARTER; 1: a lone piece, as part 1). |
| `MC_REFIT_FIRST` | flag | `off` |  |  | Refits offered before new public works. |
| `MC_VANILLA_ALL` | flag | `on` |  |  | #104's R1 (MC_VANILLA_ALL=on; off by default): the jar's village pieces opened up. Every passing vanilla dwelling is kept (vanillaLibrary), larger homes pass up to HOUSE_UNITS_LARGE (one a neighbourhood: plan_layout's rule for a building over HOUSE_UNITS), the importer's door fixes and snow's... |
| `MC_VANILLA_JAR` | string | (unset) |  |  | The Minecraft jar vanilla pieces and data are read from. |
| `MC_VILLAGE_RANGE` | number | `144` |  |  | The village's range (growth reaches 16 inside it). |
| `MC_WOOD_VARIANTS` | flag | `on` |  |  | #104's R2 (MC_WOOD_VARIANTS=on; off by default): wood variants of a design ("plains_small_house_1@spruce": its shape, every wooden block in another wood), and a wood for each neighbourhood among those with trees near home (grow.ts hoodWood), its houses, small works and lamps in it; the style... |
| `MC_WORKS_GROW` | flag | `off` |  |  | #75: works that grow with the village (off by default): standing buildings refitted a tier on their own cells (refit.ts), offered in the public-work vote where new works leave slots (runs/2026-10-21/works-grow/design.md). |
| `MC_WORKS_REPEAT` | flag | `off` |  |  | #75: public works may repeat a piece once the unbuilt ones run out (off by default, s43). |

## Economy and storage

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_BARTER` | flag | `off` |  | `MC_OWN` | Barter between members (with MC_OWN). |
| `MC_BARTER_LAPSE_MIN` | number | `10` |  |  | Minutes an unanswered barter offer stays up. |
| `MC_GATHER_LOGS_HOUR` | number | `96` |  |  | Logs gathering for the workshop may bring a village in an hour (counted with what is on the way). |
| `MC_INNOVATE` | flag | `off` |  |  | On with MC_INNOVATE=on. |
| `MC_MAKE_PARALLEL` | number | `4` |  |  | Crafting makes going at once in a village (they share the hut's table and its aisle; smelting makes go by furnace). |
| `MC_MERCHANT` | flag | `on` |  |  | On by default since s42 (Stg2: purchases only of what the village uses); MC_MERCHANT=off turns it off. |
| `MC_MERCHANT_ORDER_SIZE` | number | `1` |  |  | An order's count in the good's batches (MC_MERCHANT_ORDER_SIZE, 1). |
| `MC_MERCHANT_ORDERS` | flag | `off` |  | `MC_MERCHANT` | s42 (#73, the user's idea at s41: the merchant drives demand): orders. At each restock the merchant posts orders for goods the village's workshop can make ("wants 16 birch_fence, pays 3 emeralds"); an open order raises the good's make target by its count (a sink for the workshop, F258) and... |
| `MC_MERCHANT_RESTOCK` | number | `20` |  |  | Minutes between restocks (wall minutes times MC_TIME_SCALE, as the other after-phase clocks). |
| `MC_OWN` | flag | `off` |  |  | Members own things: own chests, shares of what they make. |
| `MC_OWN_FARM` | flag | `off` |  | `MC_OWN` | Members' own farms (s43, MC_OWN_FARM=on): a member with a house and no farm may lay out a wheat field of its own near its house (lay_out_field's pad, within OWN_FARM_REACH of the house), seeded from the commons' spare seeds; it is claimed for it for good, and its harvests are wholly its own (a... |
| `MC_OWN_LEVY` | number | `0.25` |  |  | The levy on own sales. |
| `MC_OWN_SALES` | flag | `off` |  | `MC_OWN` | Members' sales to the merchant (s43, MC_OWN_SALES=on): what it buys from members, items an emerald (vanilla's farmer and fisherman; since 10-23 also the mason's stone, the smiths' coal, the fletcher's sticks and string), at most OWN_SALE_LOTS lots of a good a restock across members; the levy... |
| `MC_OWN_SHARE` | number | `0.25` |  |  | A member's own share of what it makes or gathers. |
| `MC_PARTS` | flag | `on` |  |  | MC_PARTS (s37 S2-S6; on by default since s38): leftover building parts get a chest group of their own, misc and parts overflow into the chest with most room once the hut is down to its last free spot, and spare wooden parts burn first as smelting fuel. MC_PARTS=off: storage as before. |
| `MC_PAY` | flag | `off` |  | `MC_OWN` | Pay: emeralds for requests and wages (with MC_OWN). |
| `MC_PAY_BOUNTY` | string | (unset) |  |  | Test only: the share of unpriced requests given a 1-emerald bounty (the user's choice 4). |
| `MC_PAY_LEVY` | string | `contracts` |  |  | The levy on contracts (the user's choice 3: gifts go free): 'contracts' or 'off'. |
| `MC_PAY_MAX` | string | (unset) |  |  | The most a request may offer, in whole emeralds (per step for wages). |
| `MC_PURSE` | number | `4` |  |  | Emeralds each member gets once, when its own chest is placed (the user's choice 1). |
| `MC_SPECIAL` | string | (unset) |  |  | Specialisation modes (claim, ...: comma list). |
| `MC_STORAGE_BARRELS` | flag | `on` |  |  | MC_STORAGE_BARRELS=off: the hut's nine chest spots only (s40: barrels in the six cells between them, on by default). |
| `MC_STORAGE_CAP` | string | (unset) |  | `MC_STORAGE_GROW` | MC_STORAGE_CAP (#121, with MC_STORAGE_GROW): the most of each bulk stone kind storage keeps, "cobblestone:1024,stone:256" by default ("stone": each other bulk kind; a kind named on its own takes its own number); "off": no cap. |
| `MC_STORAGE_GROW` | flag | `on` |  |  | MC_STORAGE_GROW (#121; on by default since 10-24, the user's after test train 1; off turns it off): storage that grows. A deposit keeps at most a cap of each bulk stone kind (the rest goes on the spoil heap), and a storage yard is prepared beside the village once the hut is nearly full. |
| `MC_TECH_MADE` | string | (unset) |  |  | Tools counted as made already (innovation experiments). |
| `MC_TECH_ROYALTY` | number | `0.1` |  |  | The inventors' royalty (s44, the user's): this share of every batch the workshop makes of an unlocked entry's goods. |
| `MC_TECH_UNLOCKED` | string | (unset) |  |  | (MC_TECH_UNLOCKED=hay,campfire: entries a village starts with, for experiments) |
| `MC_WANTED` | flag | `off` |  |  | On with MC_WANTED=on: the API's writer and innovation's demand from the list (the route serves the list either way). |

## Social

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_ACT_FIXES` | flag | `off` |  | `MC_ACTS` | Fixes to acts (with MC_ACTS). |
| `MC_ACT_HINTS` | flag | `off` |  | `MC_ACTS` | MC_ACT_HINTS=on (#114, All1: 75 requests for axes nobody makes): a refused request is told what is close to it on offer, and that a tool nobody makes is not made here. |
| `MC_ACTS` | flag | `off` |  |  | Acts (requests, promises, news): on or off. |
| `MC_ACTS_EVERY` | string | (unset) |  |  | How often (in choices) a member may make an act. |
| `MC_BALLOT_FALLBACK_MS` | number | `30000` |  |  | A ballot's call is cut off this long after its send. |
| `MC_BALLOTS_PARALLEL` | number | `2` |  |  | Ballots of one vote at once (the gate's low class has 2 of the 3 cloud slots at most: the critique's M2). |
| `MC_COUNCIL` | flag | `off` |  |  | The council: village votes on rules and levies. |
| `MC_DELIBERATE` | flag | `off` |  |  | #107, deliberation's zero-cost form (MC_DELIBERATE, off): a later voter's ballot shows earlier voters' reasons for each item, attributed, both sides when both were given (the staggered offsets order the voters). |
| `MC_LEVY` | string | (unset) |  |  | A levy in force from the start, set by code (Experiment 2's imposed base, `MC_LEVY=0.2`), until a voted one replaces it. |
| `MC_LEVY_MIN` | string | (unset) |  |  | Experiment 2: a pending share is asked once it holds at least this many items (MC_LEVY_MIN, default 1: G3m1's shares were 1-4 items, the levy of 1 the same as all, so every answer paid). |
| `MC_LEVY_SET` | string | (unset) |  |  | Experiment 2's imposed arm: code sets the levy to R% at the moment the vote would be counted (MC_LEVY_SET=day2:30). |
| `MC_LEVY_VOTE` | string | (unset) |  |  | Experiment 2 (#33): a code-placed levy item on this day's ballot (MC_LEVY_VOTE=day2: rates 0-50%, the lower median). |
| `MC_NEED_VOTE` | flag | `off` |  |  | #1, the need vote: a need its answers sat untaken on for a village day goes on the next ballot (MC_NEED_VOTE, off). |
| `MC_NEWS` | flag | `off` |  | `MC_ACTS` | News acts (with MC_ACTS). |
| `MC_PROMISE_MIN` | number | `15` |  |  | Minutes a promise is due in (divided by the time scale). |
| `MC_PROPOSALS` | flag | `off` |  |  | Members' proposals (G1). |
| `MC_QUESTIONS` | flag | `off` |  | `MC_ACTS` | Question acts (with MC_ACTS). |
| `MC_RULES` | flag | `off` |  |  | Village rules (laws read by members). |
| `MC_TALK_HOLDOUT` | string | (unset) |  |  | Members held out of talk (a holdout experiment). |
| `MC_VOTE` | string | (unset) |  |  | The neighbourhood style vote: model, predicted or off. |
| `MC_VOTE_MAX_MS` | number | `240000` |  |  | A vote is tallied once every ballot is in or after this long (abstentions for the rest). |
| `MCAI_INFLUENCER_NAMES` | string | `Ben,Kai,Sam` |  |  | Experiment 2's influencers, by name (with MCAI_INFLUENCERS). |
| `MCAI_INFLUENCERS` | string | (unset) |  |  | Experiment 2's influencers (MCAI_INFLUENCERS=pro\|anti): these members argue for a higher or lower levy and cast no levy ballot (MCAI_INFLUENCER_NAMES, default three of the 24 workers). |
| `MCAI_SOCIAL` | string | `legacy` |  |  | The social layer: legacy, on, or off (talk, requests, relationships). |
| `MCAI_SOCIAL_ROLES` | string | (unset) |  |  | show: social roles in the prompts. |
| `MCAI_TEMPERAMENT` | string | `on` |  |  | A.3p's personalities: on, identical (every member the same) or off. |

## Memory and character

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_AFFINITY` | flag | `off` |  |  | The character model's affinity layer (default: MC_CHARACTER). |
| `MC_CHARACTER` | flag | `off` |  | `MCAI_TEMPERAMENT`, `MC_SKILL`, `MC_GOALS` | The character model (HEXACO traits, values, mood, identity) as a whole. |
| `MC_CHARACTER_ARCHETYPES` | string | (unset) |  |  | Custom archetypes as JSON ({name: {hex: {H,E,X,A,C,O: -1..1}, values: {openness, conservation, enhancement, transcendence: 0..1}, goal}}): a profile's "archetypes". |
| `MC_CHARACTER_MIX` | string | (unset) |  |  | A culture mix of archetypes by share of the workers ("wealth:40,invention:60"; drawn: the per-member draws; mayor:<archetype> names the Mayor's, else the largest share's), by largest remainder. Not with MC_CHARACTER_PRESET. |
| `MC_CHARACTER_PRESET` | string | (unset) |  |  | A monoculture: every member, the Mayor too, one archetype (wealth, invention, community, tradition, beauty, or a custom one), its traits jittered +-0.1; unset: the draws. Not with MC_CHARACTER_MIX. |
| `MC_CHARACTER_SEED` | string | `mix` |  |  | The seed that orders which workers get which archetype in a mix: the same seed, the same assignment. |
| `MC_CLOCK` | flag | `off` |  | `MC_MEMORY` | The village clock in prompts (with MC_MEMORY). |
| `MC_DAY_MIN` | number | `20` |  |  | A village day (thought durations, decay), as memory.ts' MC_DAY_MIN. |
| `MC_GAUGES` | flag | `off` |  |  | The character model's gauges layer (default: MC_CHARACTER). |
| `MC_GOALS` | flag | `off` |  |  | On with MC_GOALS=on. |
| `MC_GOALS_ONLY` | string | (unset) |  |  | Only these goals (comma list) in members' goal lines. |
| `MC_HEXACO` | flag | `off` |  |  | The character model's HEXACO traits (default: MC_CHARACTER). |
| `MC_IDENTITY` | flag | `off` |  |  | The character model's identity layer (default: MC_CHARACTER). |
| `MC_MEMORY` | flag | `off` |  |  | Members' memory (notes carried between calls). |
| `MC_MEMORY_CARRY` | flag | `off` |  |  | Memory carried across restarts. |
| `MC_MEMORY_CHARS` | number | `2000` |  |  | A member's memory, at most this many characters. |
| `MC_MEMORY_NOTES` | number | `8` |  |  | A member's memory, at most this many notes. |
| `MC_MEMORY_QUALITY` | flag | `off` |  | `MC_MEMORY` | Better memory notes (with MC_MEMORY). |
| `MC_MOOD` | flag | `off` |  |  | The character model's mood layer (default: MC_CHARACTER). |
| `MC_PROMPT_SELF` | flag | `on` |  |  | #117: the choice prompt's own state, basic needs first. |
| `MC_REFLECT` | flag | `on` |  | `MC_MEMORY` | Reflection notes in memory (with MC_MEMORY). |
| `MC_SKILL` | flag | `off` |  |  | Skills that grow with practice. |
| `MC_SKILL_DECAY` | number | `0.98` |  |  | How skill decays a village day. |
| `MC_SKILL_GAIN` | number | `0.15` |  |  | How skill grows a practised chore. |
| `MC_VALUES` | flag | `off` |  |  | The character model's values layer (default: MC_CHARACTER). |

## The ladder of ages

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_IRON_AGE` | flag | `off` |  |  | MC_IRON_AGE: the widened iron chain (dig on up to 3 legs, smelt at the works furnaces, forge for a named member, new iron levels as each ends); usable without the ladder. |
| `MC_IRON_STAIRS2` | flag | `off` |  | `MC_IRON_AGE` | MC_IRON_STAIRS2 (with MC_IRON_AGE, #101): each iron level's stairs get a second lane beside the first, dug by a second miner (a lock per lane) or on a later trip; miners walk down one lane and up the other. |
| `MC_LADDER` | flag | `off` |  |  | MC_LADDER: the ladder's state, the progress line, the stage tags and the rung ballot (wanted.ts reads the same). |
| `MC_LETTERS` | flag | `off` |  | `MC_LADDER` | MC_LETTERS (with MC_LADDER, #21): the age of letters' four counted stages (cane, leather, books, the library), the rung's make goods, the merchant's leather and sugar cane, the cane harvest's replanting and the library's shelving. |
| `MC_LETTERS_PACE` | flag | `on` |  | `MC_LETTERS` | MC_LETTERS_PACE (#134): the letters rung at 1x: while the cane slots hold fewer than a slot's 14 stalks the merchant sells cane for them and harvests (or a top-up visit) replant from storage; and the first market stall is posted as a village work at completion (with MC_MERCHANT), so the merchant... |
| `MC_MINE_LEAVE` | string | (unset) |  |  | A tunnel's holder leaves its junction's branches to miners waiting for a face and digs on along the main tunnel (S.2; MC_MINE_LEAVE=0 for comparison runs: the holder then digs main, left, right in order however many wait). |
| `MC_MINE_LEVEL_CELLS` | string | (unset) |  |  | Main tunnels at most per level: the first and the turns made from those that ended (V.5b); and tunnel cells dug at most per level (s40, F256: a cap on the whole mine spent B25x2's first level at 989 of 1080 and left levels 2-3 shut). |
| `MC_MONUMENT` | flag | `off` |  | `MC_IRON_AGE` | MC_MONUMENT=on (M1, #144; off by default): once the village completes the iron age it builds a Gothic cathedral drawn by gothicGen.ts, stage by stage, on a pad of its own at the edge of the village, with no vote (the user, 10-25); members gather each stage bill into a yard (a ledger over storage, outside the bulk cap) and build its jobs of 300-800 blocks. |
| `MC_MONUMENT_PALETTE` | string | `today` |  | `MC_MONUMENT` | today (cobblestone, a roof of the village wood, plain panes: what the skills of today gather) or full (the stone bricks, tuff, deepslate tiles and stained glass, for M2). |
| `MC_MONUMENT_PRESET` | string | `notre_dame` |  | `MC_MONUMENT` | The cathedral gothicGen.ts draws: notre_dame, salisbury or chartres. |
| `MC_MONUMENT_SCALE` | number | `0.5` |  | `MC_MONUMENT` | The scale against the real cathedral: 0.5 (1:2, the first target) or 0.25 (1:4, the first live test). |
| `MC_MONUMENT_SHARE` | number | `0.6` |  | `MC_MONUMENT` | At most this share of a menu may be monument options (one at least), so food, the ladder and chores go on. |
| `MC_ORE_MINE` | flag | `off` |  | `MC_IRON_AGE` | MC_ORE_MINE (with MC_IRON_AGE): the iron levels follow the iron seen (short drifts to ore seen near the tunnels, turns and next levels toward it, levels 6 apart down to y -8) instead of fixed patterns only, up to 8,000 cells in all. |
| `MC_ORE_VEIN` | flag | `off` |  |  | Ore veins followed in the mine (with the ore mine). |
| `MC_OWN_TOOLS` | flag | `off` |  |  | MC_OWN_TOOLS: a tool given to a member stays with it (deposits keep it) and its skills use it before storage's. |

## Needs and food

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_APPETITE` | string | (unset) | yes |  | Appetite: off, or the food points drained a busy game-hour (18 typical). |
| `MC_APPETITE_IDLE` | number | `0.25` |  |  | The share of the appetite drain while idle. |
| `MC_APPETITE_START` | number | `20` |  |  | Food points a member starts with (0-20). |
| `MC_HOME_BASICS` | flag | `on` |  |  | MC_HOME_BASICS: on by default since 10-24 (the user's, after test train 1); off turns it off. |
| `MC_NEED_COOLDOWN_MIN` | number | `90` |  |  | Game minutes after a farmstead is laid out before another is offered (a crop cycle and its first harvest). |
| `MC_NEED_FARMSTEAD` | flag | `off` |  |  | MC_NEED_FARMSTEAD=on: the farmstead (s39) beside the field (s40); off by default: where no 9x9 field pad is left, no 19x19 farmstead pad is either (Night40, the field spec's check 5). |
| `MC_NEED_FIELD_COOLDOWN_MIN` | number | `45` |  |  | Game minutes after a field work is laid out before another (s40: a crop cycle to its first harvest is ~40). |
| `MC_NEED_HOLD_MIN` | number | `30` |  |  | Game minutes the flow must stay short before the farmstead is offered (MC_NEED_HOLD_MIN shortens it for tests). |
| `MC_NEED_WORKS` | flag | `on` |  |  | MC_NEED_WORKS: on (the default since s40, 10-19) or off (0, false). |
| `MC_NEEDS` | string | (unset) | yes |  | N.1's needs (spec_needs_v2): off; show (measured, logged, on the API and panel); on (also on the menus). |

## Server and run

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_AGENT_BRAIN` | string | `worker` |  |  | The sandbox: those agents' brain (worker, companion, idle or llm). |
| `MC_AGENTS` | number | `0` |  |  | The sandbox: autonomous worker agents spawned at start. |
| `MC_API_HOST` | string | `127.0.0.1` |  |  | The agent server's API address (0.0.0.0 for the LAN). |
| `MC_API_PORT` | number | `8766` |  |  | The agent server's API and panel port. |
| `MC_HOST` | string | `127.0.0.1` |  |  | The Minecraft server Mineflayer connects to. |
| `MC_PORT` | number | `25565` |  |  | The Minecraft server port Mineflayer connects to; in the sandbox, its game server's port (default 8765). |
| `MC_PVP` | string | `true` |  |  | The sandbox: true lets players hurt each other. |
| `MC_RCON_TIMEOUT_MS` | number | `15000` |  |  | How long a command's reply may take (E.1): one lost reply used to hold the single chain, and every agent behind it, for good. Long enough for the longest /fill. |
| `MC_SCHEDULE` | string | (unset) |  |  | Scheduled live setting changes, a profile's "schedule" as JSON ([{at_min, set: {NAME: value}}]): applied at those run minutes from the agent server's start, paused time left out. |
| `MC_SEED` | string | (unset) |  |  | The sandbox: the world's seed (a number or any text; unset: random). |
| `MC_SERVER_DIR` | string | (unset) |  |  | The Minecraft server's folder: its server.properties (RCON) and this world's villages.json and atlas.json |
| `MC_VERSION` | string | `26.1` |  |  | The Minecraft version Mineflayer speaks. |
| `MC_VIEW_DISTANCE` | number | `10` |  |  | The sandbox: the players' view distance in chunks. |
| `MC_WORLD` | string | `world` |  |  | The sandbox: the world's folder name under server/worlds. |
| `MCAI_ACTS_LOG` | string | (unset) |  |  | Where the acts log goes (default: beside the choice log). |
| `MCAI_CHOICE_LOG` | string | (unset) |  |  | Where the choice log (choices.jsonl) goes. |
| `MCAI_ROOT` | string | (unset) |  |  | The repository root the server reads and writes under (a code snapshot sets it to the repo). |
| `MCAI_RUN` | string | (unset) |  |  | A run id written into the usage records. |

## Debug

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_DEBUG` | flag | `off` |  |  | Debug lines (the sandbox: rejected digs). |
| `MCAI_EXIT_AFTER_MIN` | string | (unset) |  |  | Stop the agent server after this many minutes (profiling runs). |
