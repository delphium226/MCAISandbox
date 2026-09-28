# MCAI Sandbox

A Minecraft-style voxel sandbox that runs in the browser, backed by an authoritative Node.js server. It is built to host
**human players and AI-controlled agents in the same world**, as a base for multi-agent experiments in the spirit of
[Project Sid: Many-agent simulations toward AI civilization](https://arxiv.org/html/2411.00114v1).

All textures, skins, sounds, music and the UI font are generated procedurally in code; no Mojang assets are used.

![Landscape](docs/screenshot-landscape.png)
![Sunset over the ocean](docs/screenshot-sunset.png)

## Quick start

```bash
npm install
npm run dev          # game server on :8765 + Vite client on :5173
```

Open http://localhost:5173, pick a name and press **Play**. Open more tabs to add more players.

For production, build the client once and let the game server serve it:

```bash
npm run build        # outputs dist/
npm start            # http://localhost:8765 serves the game, the WebSocket and the API
```

Server options (flags or `MC_*` environment variables):

| Flag | Default | Meaning |
|---|---|---|
| `--port` | `8765` | HTTP + WebSocket port |
| `--world` | `world` | World save folder (`server/worlds/<name>`) |
| `--seed` | random | Number or text seed (only used when a new world is created) |
| `--view-distance` | `10` | Chunks sent to human players |
| `--pvp` | `true` | Player-vs-player damage |
| `--agents` | `0` | Number of AI agents to spawn at start-up |
| `--agent-brain` | `worker` | Brain for those agents (`worker`, `companion`, `idle`, `llm`) |

For example: `npx tsx server/src/index.ts --world test --seed hello`.

## What's in the game

- **World:** infinite procedurally generated terrain with 15 biomes: oceans, beaches, plains, forests, birch forests, taiga, snowy taiga and plains, deserts, savanna, windswept hills, snowy peaks, swamps and meadows. It has rivers, caves (spaghetti tunnels and large caverns), underground lava lakes, ore veins, and oak, birch and spruce trees. Flowers, grass, sugar cane, cacti and pumpkins are scattered around.
- **Survival:**
  - Health, hunger and saturation, with natural regeneration.
  - Damage from falling, drowning, lava, fire and starvation.
  - Death drops your items and shows a respawn screen.
  - Beds set your spawn point and skip the night.
- **Mining and building:** break times follow Minecraft's formula (hardness × tool tier × tool speed). Tools wear out, blocks drop the right items, and pickup behaves like Minecraft. You can place blocks with orientation (logs, furnaces, torches, ladders, slabs, stairs), and two slabs merge into a full block. Doors are two blocks tall and open and close; fences and cobblestone walls connect to their neighbours.
- **Crafting:** 95 shaped and shapeless crafting recipes plus 21 smelting recipes, including tools and armour in 5 materials, torches, chests, furnaces, beds, doors, stairs, fences, walls, food and building blocks.
  - 2×2 grid in the inventory, 3×3 grid on the crafting table.
  - Shift-click crafts in bulk; drag with the mouse to split stacks.
- **Smelting:** a furnace with fuel burn time and cooking progress: ores, food, sand to glass, and more.
- **Containers:** chests.
- **Experience:** XP orbs from mining ores, killing mobs and smelting fly to the nearest player and fill a green XP bar with a level number (Minecraft level formula); you drop some XP when you die.
- **Creative mode:** a tabbed, searchable item palette and flying.
- **Mobs:** pig, cow, sheep (dyed and shearable), chicken, zombie, skeleton (shoots arrows), creeper (explodes) and spider.
  - Animals wander, panic when hit and follow you when you hold wheat or seeds.
  - Monsters spawn in the dark, and undead mobs burn in daylight.
- **Simulation:**
  - Water and lava flow; lava meeting water makes obsidian or cobblestone.
  - Sand and gravel fall, and leaves decay.
  - Grass spreads, crops, saplings, sugar cane and cacti grow, and farmland hydrates.
  - TNT explodes and sets off nearby TNT.
- **Multiplayer:** see other players with skins, name tags, held items and animations. There is chat, a player list (Tab) and server commands (`/help`).
- **Saving:** the world is saved to disk: chunks you changed, player data, and container contents.

### Graphics
WebGL2 through Three.js, with a custom deferred-style pipeline:

- **Terrain:** smooth lighting and ambient occlusion using Minecraft-style sky and block light that spreads across chunks. Chunks are meshed in Web Workers.
- **Shadows:** real-time sun and moon shadows with two cascades and PCF filtering.
- **Water:** animated waves, refraction of the scene below, colour absorption with depth, Fresnel reflections of the sky, **screen-space reflections** and sun highlights. Being underwater adds fog.
- **Sky and time of day:** a sky model with sunrise and sunset glow, a square sun and moon, twinkling stars, and a 20-minute day/night cycle.
- **Clouds:** Minecraft-style block clouds.
- **Weather:** rain and snow (snow in cold biomes), thunderstorms with lightning, an overcast sky, ground that looks wet, and rain sounds. Use `/weather clear|rain|thunder`.
- **Foliage and lava:** leaves and plants sway in the wind; lava glows and flows.
- **Post-processing:** HDR tone mapping (ACES), bloom, god rays, vignette and dithering.
- **Particles:** block-break debris, torch flames and smoke, explosions, bubbles and critical-hit sparks.
- **Title screen:** a rotating 3D panorama of a world generated locally.
- **Settings:** each effect can be turned off in *Options*.

Controls: WASD, Space, Shift (sneak), Ctrl or double-tap W (sprint), mouse, 1–9 or the scroll wheel, E (inventory),
Q (drop), T or / (chat), F1 (hide the HUD), F3 (debug screen), F5 (camera view), Tab (player list), middle-click (pick block).

Useful commands: `/gamemode creative|survival|spectator`, `/time set day|night`, `/give <item> [count]`, `/tp x y z`,
`/summon <mob>`, `/weather rain`, `/gamerule doMobSpawning false`, `/agent ...` (see below).

## AI agents

(For how the agent system is built, with diagrams, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).)

Agents are **real players**: they have a body in the world, an inventory and health, and follow the same rules as
humans. Everyone sees them move, mine, craft and chat. Instead of a browser client, a server-side controller drives
the agent by running **skills** that you queue up.

| Skill | Arguments | What it does |
|---|---|---|
| `move_to` | x, y, z, range? | A* pathfinding: walks, jumps, swims and drops down ledges |
| `mine` | x, y, z | Walks there, equips the best tool, breaks the block and collects the drops |
| `collect` | block, count | Finds and mines blocks until it has `count` items (`logs`, `stone`, `iron_ore`, ...) |
| `place` | item, x, y, z | Places a block |
| `craft` | item, count? | Uses recipes; places or uses a crafting table when the recipe needs 3×3, and first makes missing planks and sticks from what it carries (in real Minecraft the recipe is carried out by server command, ingredients charged exactly) |
| `smelt` | item, count? | Uses a furnace, or places one if carried; adds fuel automatically |
| `attack` | id \| kind | Fights an entity |
| `follow` | player, distance?, seconds? | Follows a player |
| `give` | player, item, count? | Walks to a player and tosses them items (for trading and economy experiments) |
| `chat` | message | Talks. Agents only **hear** chat within 48 blocks, like people in the paper |
| `eat`, `equip`, `drop`, `look_at`, `wait`, `explore`, `sleep` | | |
| `find_site` | size?, radius?, x?, z?, max_slope? | Finds the flattest dry, open area of `size`×`size` nearby (no water or lava, few trees, off existing builds) and reports its centre |
| `prepare_site` | x?, z?, width?, depth?, margin?, y? | Prepares a building plot the way a player would: fells every tree touching it (whole trees, canopy included), cuts high ground down and fills low ground to one level with grass on top, plus a margin. Never demolishes builds. Records the plot in `memory.plots`; preparing next to it at the same `y` extends it |
| `build` | structure, x?, z?, material?, roof?, floor?, width?, depth?, height?, door?, length?, direction? | Builds a `hut` (5×5), `house` (7×7), `platform` or `wall` centred on x,z: levels the site, clears it, places walls, windows, roof, an oriented door and a clear path out. Needs prepared ground: refuses sites that are sloped, over water, cluttered by trees, or overlapping a building |
| `build_design` | design, x, z, rotate? | Builds a design from the village design library (drawn by a model or imported from a schematic) centred on x,z, turned by `rotate` degrees clockwise, with doors facing out and a clear path in front of them. Needs prepared ground; building a design that already stands there counts as done |
| `build_box` | x1, y1, z1, x2, y2, z2, block, hollow?, label? | Fills a box with a block (or only its shell), or clears it with `air`; `label` names it in the village record |
| `get_item` | item, count? | Creative mode only: takes items from the creative inventory |

`MC_BUILD_SPEED` multiplies how fast `build`, `build_box` and `prepare_site` work (default `1`, about 10 blocks per second;
walking speed is unchanged). Raise it to make experiments and tests faster. `buildSpeed` in an agent's memory overrides it
for that agent.

Building works best in creative mode, where blocks are unlimited and clearing is instant. In survival, `build` and
`build_box` use blocks from the inventory and skip anything they would have to dig out. Spawn an agent in creative mode
with `POST /api/agents {"name": "Mason", "gamemode": "creative"}`.

### In-game
```
/agent spawn Alex farmer worker     # name, role, brain (worker | companion | idle)
/agent do Alex collect block=logs count=8
/agent do Alex give player=@me item=oak_log count=4
/agent list
/agent stop Alex
/agent remove Alex
```

The built-in `worker` brain is a scripted baseline and a working test of every skill. It works up the tech tree:
wood → crafting table → wooden pickaxe → stone tools → furnace → coal and torches → iron → iron pickaxe. It also
answers nearby players ("hi", "follow me", "come here", "give me oak planks", "what are you doing?", "stop").

### REST API (control agents from any language)
| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/agents` `{name, role?, brain?, position?, memory?, gamemode?}` | Spawn an agent (`memory` sets its initial memory; `gamemode` is `survival` or `creative`) |
| GET | `/api/agents` | List agents |
| GET | `/api/agents/:name/observe?radius=16` | Observation: position, health, food, inventory, visible blocks (counts and nearest), nearby entities, current action, recent events |
| POST | `/api/agents/:name/act` `{action, ...args, replace?}` (or an array) | Queue skills |
| POST | `/api/agents/:name/stop` | Cancel the current and queued actions |
| GET | `/api/agents/:name/events?since=<id>` | Event stream: chat heard, damage, pickups, crafts, action done or failed, deaths |
| GET, POST | `/api/agents/:name/memory` | Free-form key-value memory for your controller |
| DELETE | `/api/agents/:name` | Remove the agent |
| GET | `/api/skills`, `/api/recipes?item=`, `/api/status` | Reference data and server status |
| GET | `/api/block?x=&y=&z=` | The block at a position (name and state bits) |
| GET, POST | `/api/village` `{name, objective}` | List villages, or create one or change its objective |
| GET | `/api/village/:name` | A village's plots, buildings, designs, task board, reservations and recent events |
| GET | `/api/village/:name/designs/:design/bill` | Minecraft: the blocks a design needs, and what to gather, craft and smelt for them |
| GET | `/api/materials?items=glass:8,chest:1&have=sand:2` | Minecraft: the same for any list of items, less what is in hand |
| POST | `/api/village/:name/designs` | Add a building design to the village library (checked like model-drawn designs) |
| POST | `/api/village/:name/designs/import?name=&skip_bottom=` | Import a Minecraft schematic file (the request body) as a design |
| GET | `/api/metrics` | Experiment metrics per agent: unique items and when each was first obtained (progression, as in Project Sid), items crafted, blocks mined, kills, deaths, distance, messages sent; plus a social graph of who heard whom |

**Scale:** the per-tick pathfinding budget and fast block search keep the server at about 8 ms per tick with 30 autonomous
agents (20 TPS needs under 50 ms). `/api/status` shows per-phase tick timings.

`examples/agent_loop.py` is a small, dependency-free Python controller that runs an observe → decide → act loop. Its
`decide()` function is where an LLM or PIANO-style architecture goes.

To write a brain in TypeScript instead, implement `AgentBrain` from `server/src/world.ts` (`tick`, `onEvent`) and
register it in `BRAINS` in `server/src/brains.ts`. A brain written against `WorldAgent` uses only the world interface,
so it is not tied to this sandbox.

**LLM brain (Claude).** `server/src/llmBrain.ts` is a ready-made brain that sends each agent's observation and recent
events to Claude and runs the returned tool calls as skills. It needs Anthropic credentials (`ANTHROPIC_API_KEY` or an
`ant auth login` profile). Spawn an agent with it using `/agent spawn Ada farmer llm` or `POST /api/agents {"name":"Ada","brain":"llm"}`.

Settings:
- `MC_LLM_MODEL` sets the model (default `claude-opus-5`).
- `MC_LLM_INTERVAL_MS` sets how often an idle agent asks for a new decision (default `6000`).

Requests use low effort, cache the system prompt, and opt into Anthropic's server-side refusal fallback (`fallbacks: "default"`).

**Two-tier brain (local or mixed models).** `server/src/tieredBrain.ts` splits the work between a planner model, which sets
a goal and 3-8 steps, and a faster executor model, which turns the current step and the latest observation into skill
calls. The planner runs when there is no plan, when a plan finishes, when the executor asks for a new one, after 3 failed
actions, after a death, or when no step has been completed for a while. Spawn an agent with it using
`/agent spawn Ada farmer tiered`. It runs on [Ollama](https://ollama.com) by default, so it needs no API credentials.

Settings take `<provider>:<model>`, where the provider is `ollama` (local or `:cloud` models) or `anthropic`:
- `MC_EXEC_MODEL` sets the executor (default `ollama:gemma4:31b`).
- `MC_PLAN_MODEL` sets the planner (default: the executor's model). For example, `anthropic:claude-sonnet-5` pairs a local
  executor with a Claude planner. `none` turns off automatic planning, so plans come only from
  `POST /api/agents/:name/memory {"plan": {"goal": "...", "steps": ["..."]}}`.
- `MC_OLLAMA_URL` (default `http://localhost:11434`) and `MC_OLLAMA_CTX` (context length, default `8192`). On a 24 GB GPU,
  8192 keeps a ~20 GB model like `gemma4:31b` entirely on the GPU. At 16384 part of it spills to the CPU and it runs
  several times slower.
- Per agent, `execModel` and `planModel` in its memory override the two settings above, so agents on different models
  can share a world: `POST /api/agents {"name":"Qwen","brain":"tiered","memory":{"execModel":"ollama:qwen3:30b-instruct"}}`.
  `memory.stats` records call counts, average latency and how many actions succeeded or failed.
- `MC_PLAN_INTERVAL_MS` sets how long without a completed step before the planner reviews the plan (default `180000`).

**Choosing local models.** Measured on RTX 3090s (24 GB each) with Ollama, 8-minute runs from an empty inventory:

| Model | Decision time | Notes |
|---|---|---|
| `gemma4:31b` (dense) | 14-18 s | Plans well and gets quantities right; slow because every turn re-reads the prompt |
| `qwen3:30b-instruct` (MoE, ~3B active) | 0.7-1.1 s | Very fast, clean once skills are forgiving, but a shallower planner |

The best mix is Qwen as executor with Gemma as planner and architect. The two models (about 20 GB each) do not fit on
one 24 GB card together, so swapping would cost 7-50 s per switch; with two GPUs Ollama keeps one on each. Prompt size
dominates local latency, so observations are trimmed to about 2,000 tokens. Language models count badly, so skills
do the arithmetic (craft makes missing planks and sticks, designs are drawn with spaced symbols, doors are fixed in code).

Set `objective` in the agent's memory (for example `"build a small village"`) to steer every plan toward it. In
creative mode the planner plans building projects like a player: `find_site`, then `prepare_site`, then `build` or
`build_box` on the plot, extending the plot at the same level when the settlement grows.

The current plan is stored in the agent's memory (`GET /api/agents/:name/memory`), along with any long-term notes the
planner writes.

### Villages: agents building together

Agents with the same `village` in their memory share one village, stored in `<world>/villages.json`:

- **Plots and buildings.** `prepare_site` and the build skills record what they make. While they work they reserve their
  ground, so two agents never work the same area, and building over another building is refused.
- **Design library.** `design_building` asks the planner model to draw a building as layers of symbols (`L P P P L`, one
  per block) with a palette. The design is checked (sizes, real blocks, a door on the outside, which is moved or added
  if missing) and saved for anyone to build with `build_design`, so the village's buildings match.
- **Task board and roles.** An agent with `villageRole: "mayor"` coordinates and does no building itself. It picks the
  site, posts tasks with exact coordinates (design, prepare the plot, build X at x,z), reviews the board when it changes,
  and declares the objective complete. Every other member is a worker: it takes the next open task whose prerequisites are
  done, plans it, and the task is marked done when the plan finishes. Workers with nothing to do wait without calling
  the model.

```sh
curl -X POST localhost:8765/api/village -d '{"name":"Birchwood","objective":"two matching cottages and a meeting hall"}'
curl -X POST localhost:8765/api/agents -d '{"name":"Mayor","brain":"tiered","gamemode":"creative","memory":{"village":"Birchwood","villageRole":"mayor"}}'
curl -X POST localhost:8765/api/agents -d '{"name":"Ada","brain":"tiered","gamemode":"creative","memory":{"village":"Birchwood"}}'
```

With a mayor and three workers on `qwen3:30b-instruct` (executor) and `gemma4:31b` (planner and architect), that
objective takes about four minutes at `buildSpeed: 4`; four cottages, a meeting hall and a wall took ten minutes with four
workers in dense forest. `designModel` in an agent's memory sets the model that draws its designs (default: its planner),
so workers can plan with a fast model (`planModel: "ollama:qwen3:30b-instruct"`, 6-10 s per plan instead of 20-60 s) while
designs still come from a strong one.

**Importing schematics.** Builds shared on sites such as Planet Minecraft or Minecraft-Schematics.com can be added to a
village's design library: `.schem` (WorldEdit/Sponge v1-v3), `.schematic` (MCEdit, pre-1.13 ids), `.litematic`
(Litematica) and `.nbt` (structure blocks), up to 64x64x64 after trimming empty space.

```sh
curl -X POST "localhost:8765/api/village/Birchwood/designs/import?name=tavern" --data-binary @tavern.schem
```

Blocks this game lacks become the nearest match (dark oak planks become spruce planks, brick stairs become bricks, glass
panes become glass); decorations with no counterpart (carpets, signs, trapdoors) are left out, and plants and water
keep whatever is on site. The response lists the substitutions and any blocks with no match. Use `skip_bottom=N` to drop
ground layers saved with the build. Stairs and logs lose their orientation; doors face outward. Check each build's
licence before sharing it further.

To keep several agents from looping or flooding each other: chat from other agents only interrupts an agent that is
addressed by name, each agent speaks at most once every 30 seconds, an agent without a plan can only talk, a step is
marked done when the skill it names succeeds, and repeating the same call (failed, or twice in two minutes) is refused.

### Testing agents

`scripts/` has the harnesses used to develop the agents (Python, standard library only; the game server must be running):

- `watch_survival.py NAME [MAX_MINUTES] [TARGET]` spawns a tiered survival agent and tracks unique items until it
  holds TARGET (default stone_pickaxe) or stalls.
- All watch scripts use the sandbox API by default; set `MCAI_API=http://localhost:8766/api` for real Minecraft.
- `scripts/bench/` compares models on the brain's real prompts and tools: `modelbench.mts` (mayor planning and
  designs), `execbench.mts` (executor turns) and `planbench.mts` (worker plans), e.g.
  `node_modules/.bin/tsx scripts/bench/execbench.mts qwen3:30b-instruct` (`OLLAMA_URL=` for another Ollama server).
- `watch_village.py VILLAGE X Z WORKERS MAX_MINUTES "objective" [WORKER_PLANNER] [SITE_SIZE]` searches outward from X,Z for
  dry land, spawns a mayor and workers, streams their actions and the task board, and stops when the mayor declares the
  objective complete, the run stalls or an agent fails the same way 3 times. It prints tasks, designs, plots, buildings,
  storage and per-agent stats. `MCAI_GAMEMODE=survival` runs the village economy (real Minecraft).
- `stage_village.py VILLAGE X Z [--stage full|build] [--buildings testhut,testhall] [--brain tasks|tiered]` (real
  Minecraft) starts a village at a stage and watches it: the layout is posted through the API, `--stage build` also
  places and stocks the storage chest, and the default workers are scripted (brain `tasks`: they run the skill calls
  each task spells out, no model), so the economy's code is tested in one to ten minutes.
- `scripts/bench/mayorbench.mts [model] [times]` replays the mayor's real prompts in situations that went wrong.
- `watch_agent.py SPEC_JSON [MAX_MINUTES] [EXPECTED_BUILDS]` runs one agent and stops early when it has built enough or is
  stuck. `bench_agent.py` compares models on survival progression.
- `design_test.ts` asks a model for a design and validates it; `gen_test_schematics.ts` writes a test house in every
  schematic format.

Most of this world is ocean or hills, so start village tests where there is land (the village watcher searches for it).

## Real Minecraft (experimental)

The same agents can play real Minecraft Java Edition (26.1) through [Mineflayer](https://github.com/PrismarineJS/mineflayer),
on a private local server. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how it fits together, with diagrams.

```bash
npm run mc:setup     # once: portable Java 25 and a Paper 26.1.2 server in mc/ (listens on 127.0.0.1 only)
# accept the Minecraft EULA: eula=true in mc/server/eula.txt
npm run mc:server    # start the server (stop it with: python mc/rcon.py stop, which saves the world)
npm run mc:agents    # agent API on http://localhost:8766/api, same routes as the sandbox
```

Agents are spawned and driven through the same REST API as in the sandbox (on port 8766), and brains written against
the world interface (`tiered`, `llm`, `idle`) run unchanged. Skills: move_to, chat, wait, look_at, mine, collect,
place, craft, smelt, eat, attack, explore, follow, give, equip, drop, get_item, deposit, withdraw, find_site, prepare_site,
build_design, build_box and build (`GET /api/skills`), with the sandbox's names, arguments and failure messages.
Agents build with `/setblock` and `/fill` (run over RCON, paced by `buildSpeed`): free in creative, while survival
agents pay for every block from their inventory, fetch what is missing from the village storage first, and are told
what is short and how to get it (gather, craft, smelt) if they cannot build. Wood kinds adapt to what the builder has
(an oak design is built in acacia), and a build that ran out continues where it stopped. Spawn with `"reset": true` for a fresh start (a name keeps its inventory and position otherwise).
The agent server makes the world peaceful when it starts (no hostile mobs, no fall, drowning, fire or freeze damage,
keep-inventory; `mcRules.ts`), for the village economy: agents gather materials, then build with them, through
shared village storage: `deposit` and `withdraw` use the village's chests (the first deposit puts a carried chest
down), and their contents show in the planner's village summary and the panel. The mayor finds a site, has the
buildings designed and calls `plan_layout`: code places them on one plot with streets and posts every task (prepare
the plot, set up the storage, gather each building's raw materials, build). Builders craft planks, doors and glass
from the storage themselves, and a build that is short posts gather tasks for what is missing. Workers run the
tasks code posts as written (no planner call); gatherers stay near the village and never mine its buildings.
Survival bots
have a self-defence reflex: they fight back with a weapon, or run. Join with a 26.1.2 client at
`localhost` to watch (`POST /api/watch {"player": ..., "agent": ...}` puts you in spectator mode next to an agent).

### Models

Each brain role can use its own model (`"<provider>:<model>"`, per agent in memory: `planModel`, `execModel`,
`designModel`). The combination that built a whole village fastest so far:

| Role | Model | Runs on |
|---|---|---|
| Mayor's planner and architect | `ollama:gpt-oss:120b-cloud` | Ollama cloud (a subscription; prompts leave the machine) |
| Workers' planner | `ollama:qwen3.8:27b` | local, GPU 0 |
| Executors | `ollama:qwen3:30b-instruct` | local, GPU 1, three requests at once |

`scripts/ollama_exec.py start` runs the two local models on their own Ollama servers (ports 11435 and 11436), each
pinned to one GPU, and checks they fit; the Ollama app keeps relaying cloud models. Then point the agents at them:

```bash
python scripts/ollama_exec.py start
MC_OLLAMA_ROUTES="qwen3:30b-instruct=http://127.0.0.1:11435,qwen3.8:27b=http://127.0.0.1:11436" npm run mc:agents
MCAI_API=http://localhost:8766/api MCAI_MAYOR_MODEL=ollama:gpt-oss:120b-cloud MCAI_DESIGN_MODEL=ollama:gpt-oss:120b-cloud \
  python scripts/watch_village.py Elmfield 120 0 2 12 "two matching cottages and a meeting hall" ollama:qwen3.8:27b
```

### Control panel

http://localhost:8766/panel (or http://localhost:8765/panel for the sandbox) shows, for every agent: what its brain is
doing (planning, thinking, acting, waiting: since when and why), its plan as a checklist, its task, the current action,
a live top-down map (terrain, facing, mobs, players, the target, village plots and buildings), the exact prompt its
executor and planner last saw and what they answered, recent decisions and events, inventory and model statistics;
plus the village task board and the models loaded in every Ollama server. Buttons stop, remove or watch an agent.

## Project layout

```
shared/src   game logic used by both sides: blocks, items, recipes, world gen, lighting, physics, pathfinding, protocol
server/src   authoritative server: world storage, entities and mobs, players, containers, commands, agents and API
client/src   browser client: renderer and shaders, meshing workers, UI, audio, input, networking
examples/    external agent controller example
scripts/     agent test harnesses and the local model servers (ollama_exec.py)
mc/          the local Minecraft server: setup, start and RCON scripts (jar, Java and world are gitignored)
docs/        ARCHITECTURE.md: how the agent system fits together, with diagrams
```

The agent framework lives in `server/src`: `world.ts` (the world interface brains depend on: `WorldAgent`,
`WorldAdapter`, `AgentBrain`), `skills.ts` (skill tool definitions shared by the LLM brains), `agents.ts` (the sandbox
world: agents, skills including the building engine, REST API), `brains.ts` (brain registry and scripted brains),
`llmBrain.ts` (Claude brain),
`tieredBrain.ts` (planner/executor brain, village roles, model providers), `village.ts` (shared village state),
`designs.ts` (design format and checks) and `schematic.ts` with `nbt.ts` (schematic import). The Mineflayer
adapter for real Minecraft is in `server/src/mineflayer/`, the local server's scripts in `mc/`; the control panel is
`server/panel/index.html` with `server/src/panel.ts`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The protocol is JSON over WebSocket (`/ws`), plus a compact binary format for chunks (`shared/src/protocol.ts`).
Because the protocol is documented and shared, you can also write a headless bot as an ordinary network client.
