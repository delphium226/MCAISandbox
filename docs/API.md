# REST API

The agent server (real Minecraft, port 8766) and the browser sandbox (port 8765) serve the same routes under `/api`;
rows marked Minecraft are the adapter's only. Control agents from any language; `examples/agent_loop.py` is a small
example. The control panel's own routes (`/api/agents/:name/thoughts`, `/mind`, `/calls`, `/decision`) are in
`server/src/panel.ts`.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/agents` `{name, role?, brain?, position?, memory?, gamemode?, reset?}` | Spawn an agent (`memory` sets its initial memory; `gamemode` is `survival` or `creative`; in Minecraft, `reset` clears its saved inventory and position) |
| GET | `/api/agents` | List agents |
| GET | `/api/utilisation?bin=1&points=60` | Busy shares over time (#67): `{binMin, start, overall[], agents{name: []}, total}`, each point busy / seen time in `bin` minutes, null where unseen |
| GET | `/api/agents/:name/observe?radius=16` | Observation: position, health, food, inventory, visible blocks (counts and nearest), nearby entities, current action, recent events |
| POST | `/api/agents/:name/act` `{action, ...args, replace?}` (or an array) | Queue skills |
| POST | `/api/agents/:name/stop` | Cancel the current and queued actions |
| GET | `/api/agents/:name/events?since=<id>` | Event stream: chat heard, damage, pickups, crafts, action done or failed, deaths |
| GET, POST | `/api/agents/:name/memory` | Free-form key-value memory for your controller |
| DELETE | `/api/agents/:name` | Remove the agent |
| GET | `/api/skills`, `/api/recipes?item=`, `/api/status` | Reference data and server status (in Minecraft, also whether the peaceful world settings are applied) |
| GET | `/api/block?x=&y=&z=` | The block at a position (name and state, a sign's `text` in Minecraft; `loaded: false` when its chunk is not loaded) |
| GET | `/api/blocks?x1=&y1=&z1=&x2=&y2=&z2=&states=` | Minecraft: a box of up to 65,536 blocks, as a list of names and an index into it per block (x fastest, then z, then y; -1 where no bot has the chunk loaded), for checks that compare before and after; `states=1` names blocks with their states (`oak_stairs[facing=north,half=bottom,shape=straight]`) |
| GET | `/api/agents/:name/near?items=sand:64,stone:300&range=96` | Minecraft: plan_layout's material counts around where the agent stands, each item timed (`found`, `ms`) |
| GET, POST | `/api/village` `{name, objective}` | List villages, or create one or change its objective |
| GET | `/api/village/:name` | A village's plots, buildings, designs, task board, storage (chest by chest, with each one's material group in a storage hut), reservations and recent events |
| POST | `/api/village/:name/designs` | Add a building design to the village library (checked like model-drawn designs) |
| POST | `/api/village/:name/designs/import?name=&skip_bottom=` | Import a Minecraft schematic file (the request body) as a design |
| GET | `/api/village/:name/designs/:design/bill` | Minecraft: the blocks a design needs, and what to gather, craft and smelt for them |
| GET | `/api/materials?items=glass:8,chest:1&have=sand:2` | Minecraft: the same for any list of items, less what is in hand |
| POST | `/api/village/:name/layout` `{buildings, x, z, y?, size?, plan?, biome?}` | Minecraft: lay buildings out on a plot and post their tasks, as the mayor's `plan_layout` does (`plan: "street"` for the street plan, its town centre from `biome`, round a green when `size` is 40 or more; `"rows"` clears it) |
| POST | `/api/village/:name/storage` `{x, y, z, group?}`, `/api/village/:name/tasks/:id` `{status, by?}` | Minecraft, for tests: register an existing chest as storage (with its material group in a sorted storage); set a task's status (`claimed` holds a task back from the workers) |
| GET | `/api/overview`, `/api/maps`, `/api/models` | The control panel's data: every agent's brain state, maps, loaded models (cloud models flagged `cloud`), and the token usage summary |
| GET | `/api/timeline?village=&bin=10` | The panel's Overview console: since the village's first chore, by bins of `bin` minutes (at most 144): `busy[]` (the utilisation clock, members' mean), `families{name: []}` (choices by family at their start: making goods, building, gathering, care and light, farms and pens, new crafts, own goods, eat and rest), `failed[]` (failed chores at their end), `tokens[]` (members' model tokens; the last 36 bins only, earlier null), `byKind{kind: {calls, tokens}}`, `failWhy[{text, count}]`, `members[{name, role, top, goal, busy[], chore[], avg, choices, failed, tokens, pursuit}]` (`chore`: share of each bin between a choice and its end), `notes[]` (what is partial); kept 30 s |
| GET | `/api/civic?village=` | The village's projects: `civics[]` (preset, kind, scale, blocks, at, built, by, skipped, minutes), `monument` (type, preset, state, `jobs{done,total}`, `blocks{done,total}`, stage, stages with times, yard, `lastJobAt`, the kiln's record), `kiln` (furnaces, tends, ok, failed, `failWhy[]`, `bans[]`, lastFail: from the chore record), `ladder` (current rung, stage, words, reached), `homes` (owned houses, members, neighbourhoods), `society` (`laws[]` in force with votes, proposed, passed, `pursuits{active, stalled, dropped, done}`) |
| GET | `/api/usage?since=&agents=` | Model calls, tokens, errors, budget refusals and cost, by model, agent and kind of call, since the server started or since an epoch-ms time; the hourly budget's state |
| POST | `/api/usage/budget` `{tokensPerHour, windowMs?}` | For tests: change the hourly token budget (`null` or `0` turns it off) |
| GET | `/api/atlas?village=` (or `?x=&z=`), `radius=`; `?all=1` | Minecraft: the shared atlas, a summary of every chunk the bots have seen near a village or a point (ground height and flatness, water, logs by kind, surface materials, exposed ores underground and whose mine dug there, farmable plants), and what a summary costs; `all=1` returns every chunk and every village's ground, compact, for the panel's world map, and the animals the bots have seen |
| GET | `/api/metrics` | Sandbox experiment metrics per agent: unique items and when each was first obtained (progression, as in Project Sid), items crafted, blocks mined, kills, deaths, distance, messages sent; plus a social graph of who heard whom |

**Scale:** in the sandbox, the per-tick pathfinding budget and fast block search keep the server at about 8 ms per
tick with 30 autonomous agents (20 TPS needs under 50 ms). `/api/status` shows per-phase tick timings.
