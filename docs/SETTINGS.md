# Settings

Generated from `server/src/settings.ts` by `scripts/settings_doc.mts`; do not edit by hand. Every setting is an
environment variable of the agent server (or the sandbox). "Default" is the value used when it is unset (a flag: `on`
or `off`; any of on/1/true turns a flag on, off/0/false turns it off, as each reads it). "Live" settings may change
during a run; the others need a restart. "Not in" names run kinds a setting must not be raised in.

244 settings.

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
| `MC_CHOOSE` | string | `fixed` | yes |  | Who picks after-completion chores: fixed (code), model, scripted (staged runs), or open (#172: the model, from the whole palette and a block of what the village needs, not the menu's eight). |
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
| `MC_POLICY_OPTIONS` | flag | `on` |  |  | #122 (MC_POLICY_OPTIONS=on, off): on a menu that is empty or holds only filler makes, code's policy gates become options with their facts: a material nothing wants gathered anyway (under GATHER_ANYWAY_MAX in storage), a project past the village's cap (under twice it); the filler makes leave such... |
| `MC_PRIMER` | flag | `off` |  |  | MC_PRIMER=on: a short primer of how the world works (peace, the day, chores, acts beside a choice, storage, laws, emeralds, the ages, a good life) in the chooser's system prompt, both modes (#172). |
| `MC_QUICK_NEXT` | flag | `off` |  |  | The wait between chores (the user's, 10-22): MC_QUICK_NEXT=on runs the village's check within a few seconds of a chore's end (at most every QUICK_GAP_MS) instead of at the 30 s cycle, and skips the 10 s member cooling for a chore whose actions all finished (the cooling is for a stopped or... |
| `MC_SCRIPTED_ACTS` | number | `0.3` |  |  | In scripted runs, the share of choices that make an act. |
| `MC_WORK_BLOCKS` | flag | `off` |  |  | MC_WORK_BLOCKS: model decisions paced through the hour (modelCallsLastHour), at most PACE_BURST at a time. |

## Building

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_BIG_HOUSES` | string | `both` |  |  | #141: members' own houses bigger: long (+2 on the longer wall), both (+2 on each wall: 7x5 to 9x7, interior x2.1, wood +50%; the user's pick) or x15 (walls x1.5); the house and landmark budgets and the box cap rise with it. |
| `MC_FLOWER_MIX` | flag | `on` |  |  | #140: with MC_GARDENS, a flower bed or ring is planted from a mix of 2-4 of the one-block flowers counted within 80 of the storage hut (each with enough blocks to gather), drawn per member; the option, the design and the bill name the mix, and its crew picks each kind by name. |
| `MC_GARDENS` | flag | `on` |  |  | #45: flower beds and front gardens (MC_GARDENS, off). A front garden is two beds of flowers on the grass either side of a house's door walkway (the walkway itself left as it is), one design a walkway's direction; a flower ring circles a green's centre, its four sides open. Planted from flowers... |
| `MC_GEN_HOMES` | flag | `on` |  |  | Generated homes (buildingGen) beside the catalogue's. |
| `MC_GREENS_MIX` | flag | `off` |  |  | What fills a green (the user's 10-28): each small-work kind capped per green (lamps together), larger works ranked above small ones, a geometric parterre of flower beds reserved at each green's centre (its shape and size differing from green to green) and two corner trees, both ranked first until they stand. |
| `MC_GREENS_MORE` | flag | `off` |  |  | More and bigger greens on a pad village (test train 7): 21x21 greens, up to three times the members' greens, so small works keep finding room. |
| `MC_GREENS_PER` | string | (unset) |  |  | Members a green (the user's, s36): a village prepares one green per GREENS_PER members for small works (MC_GREENS_PER for experiments, s43). |
| `MC_GROW` | flag | `on` |  |  | Growth after completion: neighbourhoods until a house per member; 0 turns it off. |
| `MC_GROW_BATCH` | string | (unset) |  |  | Houses a growth layout lays out at once. |
| `MC_GROW_FARMS` | flag | `off` |  |  | Neighbourhood fields and farm slots. |
| `MC_GROW_OUTWARD` | flag | `on` |  |  | MC_GROW_OUTWARD=on (#138; off by default): on a village laid out on pads (MC_PAD_PER_BUILDING), growth places each new house at the nearest good spot on the edge of the village, on its own pad joined to the paths, instead of a neighbourhood on a flat plot found further off. |
| `MC_GROW_RANGE` | string | (unset) |  |  | How far from the village growth may lay out. |
| `MC_HOME_DESIGN` | string | `character` |  |  | #174: a member's own house: model (each member chooses its design in one model call, from the generator's options code found buildable, cut in its own ranking when over budget), program (#175: each member's house written as a short program against the house library by MC_HOME_PROGRAM_MODEL from its character and memory, run in a worker thread, compiled and fitted by code; a failed program falls back to the model pick, then the character draw) or character (today's draw from its character). |
| `MC_HOME_DESIGN_HOLDOUT` | number | `0` |  |  | With MC_HOME_DESIGN=model or program: the share of members (by a hash of the name) kept on the character draw (0.5 for the test train's split). |
| `MC_HOME_DESIGN_PARALLEL` | number | `2` |  |  | With MC_HOME_DESIGN=model: a street's design calls at once (each member sees the choices completed when its call is built). |
| `MC_HOME_DESIGN_WAIT_MS` | number | `240000` |  |  | With MC_HOME_DESIGN=model: a street waits this long at most for its members' design calls, then draws the rest by character. |
| `MC_HOME_PROGRAM_MODEL` | string | `ollama:qwen3.8:27b` |  |  | With MC_HOME_DESIGN=program: the model that writes each member's house program (qwen3.8 on the pinned local server: start it with scripts/ollama_exec.py and route it with MC_OLLAMA_ROUTES). |
| `MC_HOUSE_DECOR` | flag | `off` |  |  | #141: house decorations: free slots in each home (carpet, painting, flower pot, lantern...), made by the trades into storage and placed by the house's owner from its own menu, and exterior details (door lantern, window boxes, a flower bed) on generated homes. |
| `MC_HOUSING` | flag | `on` |  |  | N.2 housing (s37; on by default since s38, MC_HOUSING=off turns it off): each member owns a house, a street of houses is a member's own project (the chore menu's `grow:street`) or a voted work, and growth's code trigger is retired (growth lays out only on a request). Growth's machinery stays:... |
| `MC_INITIATIVE_STORE` | flag | `on` |  |  | MC_INITIATIVE_STORE=off: initiatives gather all their own (s36's rule); on by default since s40 (the user's, 10-20). |
| `MC_INITIATIVES` | number | `3` |  |  | Initiatives (small works members start) open at once in a village; 0: none. |
| `MC_LIGHT_FACADES` | flag | `off` |  |  | Vanilla's facade torches lit too (D4: vanilla's own look); off, only the spots inside. |
| `MC_OPEN_STORAGE` | flag | `on` |  |  | The open-sided storage hut (on by default since 10-25, the user's; =off turns it off; a checkpoint keeps the hut it was saved with): the same footprint, floor, roof, chest, barrel and station spots, but no walls: log posts at the four corners and halfway along each long side (the torches' and the sign's support: a wall torch on a post, the... |
| `MC_PAD_HALO` | string | `on` |  |  | #136: blended pad edges and cave sealing in prepare_site. |
| `MC_PAD_PER_BUILDING` | flag | `on` |  |  | MC_PAD_PER_BUILDING=on (#84 C1; off by default): a village's first street plan is not levelled as one plot but laid out on pads, each building, the wheat field and each farm slot on its footprint and a 1-block ring, at its own level and blended into the ground (prepare_site layout=N pad=K;... |
| `MC_PEN_VARIETY` | flag | `on` |  |  | #139: a 25x13 annex (the classic 13x9 where none fits; on pads, at its own ground level) with 3-4 pens of varied sizes and shapes (3x3 to 7x9 inside, and an L), a set per village; pens for sheep and pigs (and rabbits, goats) besides chickens and cows, each in the free pen nearest the size of its herd, its cap by area; goats milked, sheep sheared (with shears in storage). |
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
| `MC_COUNCIL_SCRIPTED` | flag | `off` |  | `MC_COUNCIL` | #164 (the F1 arm of test train 8): under the fixed chooser the laws of the night come from a script (claim, report, a stock contribution, a custom with MC_RULE_TYPES and MC_CUSTOMS on) and the dusk ballots are predicted (yes 70%): no model call for reflections or ballots. |
| `MC_CUSTOM_FACTS` | flag | `off` |  | `MC_CUSTOMS` | #164: a custom's option says who did it yesterday and when the member last did ("done yesterday by Ben, Kai and 2 others; you: never"); the channel the test's off arm removes. |
| `MC_CUSTOMS` | flag | `off` |  | `MC_RULES` | #164 (G4): customs, acts with a world effect code counts and no reward (a flower by your door, a torch or flower on the green's custom stone, tools back to storage at dusk, meeting at the green at dusk): the ledger (did, started, exposed), seeded members, a norm naming one starts it. |
| `MC_DELIBERATE` | flag | `off` |  |  | #107, deliberation's zero-cost form (MC_DELIBERATE, off): a later voter's ballot shows earlier voters' reasons for each item, attributed, both sides when both were given (the staggered offsets order the voters). |
| `MC_LAW_BACKING` | string | (unset) |  |  | #164 (off by default): failures counts a night's back of a law also when the backer's failed chores that day name the law's target (their messages, not only the chore lines; train 7 refused 85-92% of backs). |
| `MC_LEVY` | string | (unset) |  |  | A levy in force from the start, set by code (Experiment 2's imposed base, `MC_LEVY=0.2`), until a voted one replaces it. |
| `MC_LEVY_MIN` | string | (unset) |  |  | Experiment 2: a pending share is asked once it holds at least this many items (MC_LEVY_MIN, default 1: G3m1's shares were 1-4 items, the levy of 1 the same as all, so every answer paid). |
| `MC_LEVY_SET` | string | (unset) |  |  | Experiment 2's imposed arm: code sets the levy to R% at the moment the vote would be counted (MC_LEVY_SET=day2:30). |
| `MC_LEVY_VOTE` | string | (unset) |  |  | Experiment 2 (#33): a code-placed levy item on this day's ballot (MC_LEVY_VOTE=day2: rates 0-50%, the lower median). |
| `MC_NEED_VOTE` | flag | `off` |  |  | #1, the need vote: a need its answers sat untaken on for a village day goes on the next ballot (MC_NEED_VOTE, off). |
| `MC_NEWS` | flag | `off` |  | `MC_ACTS` | News acts (with MC_ACTS). |
| `MC_PROMISE_MIN` | number | `15` |  |  | Minutes a promise is due in (divided by the time scale). |
| `MC_PROPOSALS` | flag | `off` |  |  | Members' proposals (G1). |
| `MC_QUESTIONS` | flag | `off` |  | `MC_ACTS` | Question acts (with MC_ACTS). |
| `MC_RULE_FEASIBLE` | flag | `off` |  |  | #164: a duty or contribution on the ballot says how many members did that work or put that class yesterday (train 7 passed a tool contribution met on 4% of member-days). |
| `MC_RULE_RESULTS` | flag | `off` |  |  | #164: each rule in force with its id and its result in code's counts (members who met it on the last days, or "words only") in the night prompt and on the ballot; a law may repeal a rule in force by its id, with the rule's result beside it on the ballot. |
| `MC_RULE_TYPES` | string | (unset) |  | `MC_RULES` | #164: rule types read from the words of members, a list of claim (work held on the board by the storage hut: digs on the iron level and small works on the greens leave the menus of others while a claim holds, the land by each house is kept for its own farm), report (the find or failure of a trip offered for posting on the board, a fact on the options of others) and stock (contributions and floors of ore, seeds, fuel, a bucket). |
| `MC_RULE_WORDS` | flag | `off` |  |  | #164: a norm (a rule code cannot read as a type) says on the ballot that code will not enforce or count it (train 7: 94-98% yes on norms with no stake shown), and so does the night's invitation to propose a custom in words. |
| `MC_RULES` | flag | `off` |  |  | Village rules (laws read by members). |
| `MC_TALK` | flag | `on` |  |  | MC_TALK (G7, #35-#40; on by default, off turns it off): talking with the village. A person's line to the Mayor or a member (in the game, or POST /api/say and the panel's box) becomes a request in a ledger (talk.json, GET /api/requests), answered in one line by one talk call: the Mayor builds a public work where it was asked (placed and timed by code) or refuses with a reason; a member promises a chore, passes a building on to the Mayor or refuses. Off: the line wakes the tiered brain's chat turn as before. |
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
| `MC_COPPER_ROOF` | string | `off` |  | `MC_MONUMENT_DETAIL`, `MC_KILN` | MC_COPPER_ROOF=on\|test\|off (#162, tier 3, chain B; off by default; with MC_MONUMENT_DETAIL and MC_KILN): once the village has reached the copper rung, a detail cathedral's high roof (nave, choir, transepts) and its flèche base are cut copper and cut copper stairs, which weather green over the hours. Raw copper from storage first, then iron mine trips that keep copper ore; the kiln smelts it, the carver forges blocks (9 ingots) and cuts them (4 a block). Before the rung the roof is deepslate (MC_DEEP_STONE) or wood; a roof built so is re-roofed in copper by jobs of its own once the rung is reached, its old blocks back to storage. Short of copper after a wait, the old roof's blocks stand in. test: the rung counted reached (staged runs). |
| `MC_DEEP_STONE` | flag | `on` |  | `MC_MONUMENT_DETAIL`, `MC_IRON_AGE` | MC_DEEP_STONE=on (#162, tier 3, chain A; off by default; with MC_MONUMENT_DETAIL and MC_IRON_AGE): a detail cathedral begun with it keeps the generator deepslate roof tiles and tuff plinth (otherwise the village wood and stone bricks), cut at the stonecutter from cobbled deepslate and tuff. What storage holds is claimed first; then the iron mine lays a deep level (y 0 or below, past the iron age level count) and members make iron trips there for the stone; short after a wait, or with no way down, the wood and stone bricks stand in. No ladder rung (the user, 10-27). |
| `MC_DIAMOND_AGE` | flag | `on` |  | `MC_LADDER`, `MC_IRON_AGE` | MC_DIAMOND_AGE (#22; on by default, the user's rule since 10-30; off turns it off): the diamond rung's four counted stages (blocks dug down below y 0, diamonds brought up, the first diamond pickaxe, one for each of 3 deep miners); while the rung is current the iron chain is laid deeper by landings to the diamond level at y -56; a miner with an iron pickaxe keeps diamond, redstone and lapis ore; the rung's trips need an iron pickaxe (a worn-out one is forged again); and a forge makes diamond pickaxes for the deep miners. |
| `MC_DYE_BED` | flag | `on` |  | `MC_MONUMENT_DETAIL`, `MC_GLAZING` | MC_DYE_BED=on (#162, tier 2's chain B; off by default): the dye census counts tall flowers too, out to 144 (for the glass colours, the architect's and the detail palette's), the detail cathedral's windows take every colour the village can make (flowers, lapis, bone meal, mixes), its plan asks for the dyes, and the dyer's make_dye chore makes them: bone meal from a composter, tall flowers copied on a dye bed beside the storage hut, the mixes at the table. With MC_MONUMENT_DETAIL the merchant also sells a bell (12 emeralds). |
| `MC_FURNISH_BANNERS` | flag | `on` |  | `MC_MONUMENT_DETAIL` | MC_FURNISH_BANNERS=on (#162, tier 2, chain D; off by default): the furnishing stage, its banners on the nave piers, white and the first window colour, made by the weaver (make_furnishing: sheep sheared for wool, the wool dyed, banners crafted). |
| `MC_FURNISH_CANDLES` | flag | `on` |  | `MC_MONUMENT_DETAIL` | MC_FURNISH_CANDLES=on (#162, tier 2, chain E; off by default): the furnishing stage, its altar with candles (string from the merchant, honeycomb from bee nests) and the bell, which no recipe makes: the merchant sells one for 12 emeralds, and the smith sells the spare village goods to raise them. |
| `MC_FURNISH_LANTERNS` | flag | `on` |  | `MC_MONUMENT_DETAIL` | MC_FURNISH_LANTERNS=on (#162, tier 2, chain C; off by default): the detail cathedral gets a ninth stage, the furnishing, with lanterns hung on chains from its vault, made by the smith (make_furnishing: ingots into nuggets, torches, lanterns and chains at the table). The cathedral counts as built when stages 1-8 stand; the furnishing comes after and never holds it. |
| `MC_GEODE` | flag | `off` |  | `MC_MONUMENT_DETAIL`, `MC_GEODE_GUARD` | MC_GEODE=on (#162, tier 3, chain C; off by default; with MC_MONUMENT_DETAIL and MC_GEODE_GUARD): a detail cathedral begun with it has the geode accents: calcite round the west portals and in a string course across the west front, amethyst blocks at the roses' hubs and on the altar. The gem cutter works one geode near the iron mine from a sealed tunnel (each dug block that opens onto the hollow filled with cobblestone, budding amethyst never broken); storage first; short after a wait, polished diorite and chiselled stone bricks stand in. |
| `MC_GEODE_GUARD` | flag | `on` |  |  | MC_GEODE_GUARD=on (the geode case of #133, #162 tier 3; off by default): no member path digs a geode shell (smooth basalt, calcite, amethyst) or steps into its hollow (a cell over a shell block or holding an amethyst bud); a member already inside walks out. Mining a geode on purpose is not affected. |
| `MC_GLAZING` | flag | `on` |  | `MC_MONUMENT` | MC_GLAZING=on (M2, #145; off by default; with MC_MONUMENT_PALETTE=full): the cathedral's stained panes in the colours the flowers near the village give (chosen once), the flowers gathered for their dyes, its sand smelted into glass in the kiln; plain panes without. |
| `MC_IRON_AGE` | flag | `off` |  |  | MC_IRON_AGE: the widened iron chain (dig on up to 3 legs, smelt at the works furnaces, forge for a named member, new iron levels as each ends); usable without the ladder. |
| `MC_IRON_STAIRS2` | flag | `off` |  | `MC_IRON_AGE` | MC_IRON_STAIRS2 (with MC_IRON_AGE, #101): each iron level's stairs get a second lane beside the first, dug by a second miner (a lock per lane) or on a later trip; miners walk down one lane and up the other. |
| `MC_KILN` | flag | `on` |  | `MC_MONUMENT` | MC_KILN=on (M2, #145; off by default): the cathedral gets a kiln, a row of 4-16 furnaces near the storage hut that masons load and unload without waiting (stone for its stone bricks, glass with MC_GLAZING); its yard then holds made goods and its wants and jobs follow a materials plan against the yard. |
| `MC_LADDER` | flag | `off` |  |  | MC_LADDER: the ladder's state, the progress line, the stage tags and the rung ballot (wanted.ts reads the same). |
| `MC_LADDER_START` | string | (unset) |  | `MC_LADDER` | MC_LADDER_START (tests, #22): the rung a village's new ladder starts on instead of iron, the rungs it needs counted reached; for a test of a later rung from a checkpoint saved before the ladder began (e.g. diamond). |
| `MC_LETTERS` | flag | `off` |  | `MC_LADDER` | MC_LETTERS (with MC_LADDER, #21): the age of letters' four counted stages (cane, leather, books, the library), the rung's make goods, the merchant's leather and sugar cane, the cane harvest's replanting and the library's shelving. |
| `MC_LETTERS_PACE` | flag | `on` |  | `MC_LETTERS` | MC_LETTERS_PACE (#134): the letters rung at 1x: while the cane slots hold fewer than a slot's 14 stalks the merchant sells cane for them and harvests (or a top-up visit) replant from storage; and the first market stall is posted as a village work at completion (with MC_MERCHANT), so the merchant... |
| `MC_LODGE` | flag | `on` |  | `MC_KILN`, `MC_QUARRY` | MC_LODGE=on (#163; off by default): the masons' lodge, chosen with the kiln between the monument's pad and its quarry: the kiln's furnaces, the stonecutter, a crafting table and the yard's own chests (outside MC_STORAGE_CAP) on one level strip, so a monument chore withdraws and deposits there, not at the storage hut; and bulk trips: cobblestone, logs and sand for the monument gathered MC_LODGE_TRIP stacks at a time (or 5 minutes), the last trips cut to what the stage still wants, at most 3 at once. |
| `MC_LODGE_TRIP` | number | `4` |  | `MC_LODGE` | Stacks one bulk monument trip aims for with MC_LODGE (#163): 4 (256 cobblestone, logs or sand), ended sooner by its 5-minute cap. |
| `MC_MINE_LEAVE` | string | (unset) |  |  | A tunnel's holder leaves its junction's branches to miners waiting for a face and digs on along the main tunnel (S.2; MC_MINE_LEAVE=0 for comparison runs: the holder then digs main, left, right in order however many wait). |
| `MC_MINE_LEVEL_CELLS` | string | (unset) |  |  | Main tunnels at most per level: the first and the turns made from those that ended (V.5b); and tunnel cells dug at most per level (s40, F256: a cap on the whole mine spent B25x2's first level at 989 of 1080 and left levels 2-3 shut). |
| `MC_MONUMENT` | flag | `on` |  | `MC_IRON_AGE` | MC_MONUMENT=on (M1, #144; off by default): once the village completes the iron age it builds a Gothic cathedral drawn by gothicGen.ts, stage by stage, on a pad of its own at the edge of the village, with no vote (the user, 10-25); members gather each stage bill into a yard (a ledger over storage, outside the bulk cap) and build its jobs of 300-800 blocks. |
| `MC_MONUMENT_ARCHITECT` | flag | `off` |  | `MC_MONUMENT` | MC_MONUMENT_ARCHITECT=on (M3, #146; off by default): at the trigger the architect model (the mayor's design model) picks the preset, the scale among MC_MONUMENT_SCALES, the glass colours the flowers near the village allow and a dedication; code draws the geometry (lesson 1). One retry with the problems, then MC_MONUMENT_PRESET. |
| `MC_MONUMENT_DETAIL` | flag | `on` |  | `MC_MONUMENT`, `MC_KILN` | MC_MONUMENT_DETAIL=on (#162, tier 2; off by default; with MC_MONUMENT_PALETTE=full and MC_KILN): a cathedral begun with it is drawn with gothicGen's detail palette (chiselled capitals and jambs, arch shoulders, mullions, polished andesite ribs, a floor of polished andesite and diorite, windows in many colours) and its stone pieces are cut at a stonecutter set beside the kiln (the carver's cut_stone chore), none crafted at the build; its andesite and diorite gathered where they lie. |
| `MC_MONUMENT_NEWS` | flag | `on` |  | `MC_MONUMENT` | MC_MONUMENT_NEWS=on (M3, #146; off by default): the cathedral's progress (stage, parts built of the stage's, blocks) in every member's prompt with its latest news for a village day; its start, stage ends and finish in the chronicle, the village log and (MC_NEWS) every member's news; each member's own part in it in what it remembers (MC_MEMORY). |
| `MC_MONUMENT_PALETTE` | string | `full` |  | `MC_MONUMENT` | today (cobblestone, a roof of the village wood, plain panes: what the skills of today gather) or full (M2, #145: stone bricks, and plain stone for the andesite, smelted in the kiln with MC_KILN; tuff bricks as stone bricks; the roof in the village wood until cobbled deepslate has a source; stained panes with MC_GLAZING, plain without). |
| `MC_MONUMENT_PRESET` | string | `notre_dame` |  | `MC_MONUMENT` | The preset drawn: a cathedral (notre_dame, salisbury or chartres) or, with MC_MONUMENT_TYPE=castle, a castle (conwy, white_tower); one of the other type falls back to notre_dame or conwy. |
| `MC_MONUMENT_ROLES` | flag | `on` |  | `MC_MONUMENT` | MC_MONUMENT_ROLES=on (M3, #146; off by default): the cathedral's trades (quarryman, mason, glazier, carpenter) taken by practice: a member whose monument chores of one trade reach 2 holds it across stages (a switch needs 3 more of another among its last 8); options of its trade weigh 1.5 and say so, its role (social.ts) is the trade. |
| `MC_MONUMENT_SCALE` | number | `0.3333` |  | `MC_MONUMENT` | The scale against the real building, rounded to 1:N: 0.3333 (1:3, the user's scale since 10-27), 0.25 (1:4, quick tests) or 0.5 (1:2). |
| `MC_MONUMENT_SCALES` | string | (unset) |  | `MC_MONUMENT_ARCHITECT` | The scales the architect may pick from, comma-separated (0.25,0.5); empty: MC_MONUMENT_SCALE only. |
| `MC_MONUMENT_SHARE` | number | `0.6` |  | `MC_MONUMENT` | At most this share of a menu may be monument options (one at least), so food, the ladder and chores go on. |
| `MC_MONUMENT_TYPE` | string | `cathedral` |  | `MC_MONUMENT` | The monument the village builds after the iron age (#153): cathedral (gothicGen.ts) or castle (castleGen.ts: Conwy, or the White Tower with MC_MONUMENT_PRESET=white_tower), on the same pad, yard, quarry, kiln and jobs; the architect (MC_MONUMENT_ARCHITECT) picks only for the cathedral. |
| `MC_ORE_MINE` | flag | `off` |  | `MC_IRON_AGE` | MC_ORE_MINE (with MC_IRON_AGE): the iron levels follow the iron seen (short drifts to ore seen near the tunnels, turns and next levels toward it, levels 6 apart down to y -8) instead of fixed patterns only, up to 8,000 cells in all. |
| `MC_ORE_VEIN` | flag | `off` |  |  | Ore veins followed in the mine (with the ore mine). |
| `MC_OWN_TOOLS` | flag | `off` |  |  | MC_OWN_TOOLS: a tool given to a member stays with it (deposits keep it) and its skills use it before storage's. |
| `MC_QUARRY` | flag | `on` |  | `MC_MONUMENT` | MC_QUARRY=on (M2, #145; off by default): the cathedral's cobblestone trips dig a terrace pit beside its pad (sized from the bill, chosen by the first trip near the storage hut) instead of the village mine, one member a row; the pit is kept ground like a building. |

## Needs and food

| Setting | Type | Default | Live | Requires | Description |
| --- | --- | --- | --- | --- | --- |
| `MC_APPETITE` | string | (unset) | yes |  | Appetite: off, or the food points drained a busy game-hour (18 typical). |
| `MC_APPETITE_IDLE` | number | `0.25` |  |  | The share of the appetite drain while idle. |
| `MC_APPETITE_START` | number | `20` |  |  | Food points a member starts with (0-20). |
| `MC_FIELD_RIPE` | number | `0.75` |  |  | The share of a wheat field's grown plants that must be ripe (and 4 at least) before it is offered for harvest; 0.5 gives about 1.5x the harvest options and a tenth more wheat (train 9c's supply gaps). |
| `MC_FLOWER_WANTS` | flag | `off` |  |  | The flower picking activity is offered for a flower whose dye a good under its keep takes (lilac for magenta dye), counted by that flower's own stock, and picks it. |
| `MC_HOME_BASICS` | flag | `on` |  |  | MC_HOME_BASICS: on by default since 10-24 (the user's, after test train 1); off turns it off. |
| `MC_MORE_MINES` | flag | `off` |  |  | MC_MORE_MINES=on (#8, off by default): when the village mine gives nothing (stairs short of stone, every level ended or capped) and cobblestone in storage is under 256 or the iron level has no way down, an idle member opens a new mine: code finds an entrance 16-40 from home off every village's work and the member digs its stairs (open_mine); up to 4 mines a village, the old ones kept off. |
| `MC_NEED_COOLDOWN_MIN` | number | `90` |  |  | Game minutes after a farmstead is laid out before another is offered (a crop cycle and its first harvest). |
| `MC_NEED_FARMSTEAD` | flag | `off` |  |  | MC_NEED_FARMSTEAD=on: the farmstead (s39) beside the field (s40); off by default: where no 9x9 field pad is left, no 19x19 farmstead pad is either (Night40, the field spec's check 5). |
| `MC_NEED_FIELD_COOLDOWN_MIN` | number | `45` |  |  | Game minutes after a field work is laid out before another (s40: a crop cycle to its first harvest is ~40). |
| `MC_NEED_HOLD_MIN` | number | `30` |  |  | Game minutes the flow must stay short before the farmstead is offered (MC_NEED_HOLD_MIN shortens it for tests). |
| `MC_NEED_WORKS` | flag | `on` |  |  | MC_NEED_WORKS: on (the default since s40, 10-19) or off (0, false). |
| `MC_NEEDS` | string | (unset) | yes |  | N.1's needs (spec_needs_v2): off; show (measured, logged, on the API and panel); on (also on the menus). |
| `MC_OWN_ROD` | flag | `off` |  | `MC_OWN` | A member whose own chest holds a fishing rod may go fishing with it while storage has none to spare (out of its chest at its door, back after). |

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
