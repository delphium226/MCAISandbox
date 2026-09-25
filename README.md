# MCAI Sandbox

A Minecraft-style voxel sandbox that runs in the browser, backed by an authoritative Node.js server. It is built to host
**human players and AI-controlled agents in the same world**, as a base for multi-agent experiments in the spirit of
[Project Sid: Many-agent simulations toward AI civilization](https://arxiv.org/html/2411.00114v1).

All textures, skins, sounds, music and the UI font are generated procedurally in code; no Mojang assets are used.

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

For example: `npx tsx server/src/index.ts --world test --seed hello`.

## What's in the game

- **World:** infinite procedurally generated terrain with 16 biomes: oceans, beaches, plains, forests, birch forests, taiga, snowy taiga and plains, deserts, savanna, windswept hills, snowy peaks, swamps and meadows. It has rivers, caves (spaghetti tunnels and large caverns), underground lava lakes, ore veins, and oak, birch and spruce trees. Flowers, grass, sugar cane, cacti and pumpkins are scattered around.
- **Survival:**
  - Health, hunger and saturation, with natural regeneration.
  - Damage from falling, drowning, lava, fire and starvation.
  - Death drops your items and shows a respawn screen.
  - Beds set your spawn point and skip the night.
- **Mining and building:** break times follow Minecraft's formula (hardness × tool tier × tool speed). Tools wear out, blocks drop the right items, and pickup behaves like Minecraft. You can place blocks with orientation (logs, furnaces, torches, ladders, slabs, stairs), and two slabs merge into a full block. Doors are two blocks tall and open and close.
- **Crafting:** over 130 shaped and shapeless recipes, including tools and armour in 5 materials, torches, chests, furnaces, beds, doors, stairs, food and building blocks.
  - 2×2 grid in the inventory, 3×3 grid on the crafting table.
  - Shift-click crafts in bulk; drag with the mouse to split stacks.
- **Smelting:** a furnace with fuel burn time and cooking progress: ores, food, sand to glass, and more.
- **Containers:** chests.
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

Agents are **real players**: they have a body in the world, an inventory and health, and follow the same rules as
humans. Everyone sees them move, mine, craft and chat. Instead of a browser client, a server-side controller drives
the agent by running **skills** that you queue up.

| Skill | Arguments | What it does |
|---|---|---|
| `move_to` | x, y, z, range? | A* pathfinding: walks, jumps, swims and drops down ledges |
| `mine` | x, y, z | Walks there, equips the best tool, breaks the block and collects the drops |
| `collect` | block, count | Finds and mines blocks until it has `count` items (`logs`, `stone`, `iron_ore`, ...) |
| `place` | item, x, y, z | Places a block |
| `craft` | item, count? | Uses recipes; places or uses a crafting table when the recipe needs 3×3 |
| `smelt` | item, count? | Uses a furnace, or places one if carried; adds fuel automatically |
| `attack` | id \| kind | Fights an entity |
| `follow` | player, distance?, seconds? | Follows a player |
| `give` | player, item, count? | Walks to a player and tosses them items (for trading and economy experiments) |
| `chat` | message | Talks. Agents only **hear** chat within 48 blocks, like people in the paper |
| `eat`, `equip`, `drop`, `look_at`, `wait`, `explore`, `sleep` | | |

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
| POST | `/api/agents` `{name, role?, brain?, position?}` | Spawn an agent |
| GET | `/api/agents` | List agents |
| GET | `/api/agents/:name/observe?radius=16` | Observation: position, health, food, inventory, visible blocks (counts and nearest), nearby entities, current action, recent events |
| POST | `/api/agents/:name/act` `{action, ...args, replace?}` (or an array) | Queue skills |
| POST | `/api/agents/:name/stop` | Cancel the current and queued actions |
| GET | `/api/agents/:name/events?since=<id>` | Event stream: chat heard, damage, pickups, crafts, action done or failed, deaths |
| GET, POST | `/api/agents/:name/memory` | Free-form key-value memory for your controller |
| DELETE | `/api/agents/:name` | Remove the agent |
| GET | `/api/skills`, `/api/recipes?item=`, `/api/status` | Reference data and server status |

**Scale:** the per-tick pathfinding budget and fast block search keep the server at about 8 ms per tick with 30 autonomous
agents (20 TPS needs under 50 ms). `/api/status` shows per-phase tick timings.

`examples/agent_loop.py` is a small, dependency-free Python controller that runs an observe → decide → act loop. Its
`decide()` function is where an LLM or PIANO-style architecture goes.

To write a brain in TypeScript instead, implement `AgentBrain` in `server/src/brains.ts` (`tick`, `onEvent`) and
register it in `BRAINS`.

**LLM brain (Claude).** `server/src/llmBrain.ts` is a ready-made brain that sends each agent's observation and recent
events to Claude and runs the returned tool calls as skills. It needs Anthropic credentials (`ANTHROPIC_API_KEY` or an
`ant auth login` profile). Spawn an agent with it using `/agent spawn Ada farmer llm` or `POST /api/agents {"name":"Ada","brain":"llm"}`.

Settings:
- `MC_LLM_MODEL` sets the model (default `claude-opus-5`).
- `MC_LLM_INTERVAL_MS` sets how often an idle agent asks for a new decision (default `6000`).

Requests use low effort, cache the system prompt, and opt into Anthropic's server-side refusal fallback (`fallbacks: "default"`).

## Project layout

```
shared/src   game logic used by both sides: blocks, items, recipes, world gen, lighting, physics, pathfinding, protocol
server/src   authoritative server: world storage, entities and mobs, players, containers, commands, agents and API
client/src   browser client: renderer and shaders, meshing workers, UI, audio, input, networking
examples/    external agent controller example
```

The protocol is JSON over WebSocket (`/ws`), plus a compact binary format for chunks (`shared/src/protocol.ts`).
Because the protocol is documented and shared, you can also write a headless bot as an ordinary network client.
