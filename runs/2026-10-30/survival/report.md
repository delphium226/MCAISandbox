# Real survival: hostile mobs, damage, hunger and death (research, 2026-10-30)

The question (the user's, 10-30): could MCAISandbox's runs switch from today's peaceful survival to real survival, with
hostile mobs, damage, hunger that hurts and death, and is combat with mobs feasible for 25 agents? Research only: no
server code or `package.json` changed. One short live probe on test world 3 (2 bots, husks), put back after.

## Verdict

| Stage | What | Feasible? | Rough size |
|---|---|---|---|
| (a) | Damage on, still peaceful (falls, lava, drowning, fire, hunger off) | **Yes, with a little work** | ~300 lines, 1 session |
| (b) | Easy, day cycle, members home at night (hostile spawning still off) | **With work** | ~500 lines + prompts, 1-2 sessions |
| (c) | Hostile mobs on, code reflexes, armed members | **With work** (the reflex already exists and works) | ~800 lines, 2 sessions + a 25-bot load test |
| (d) | Defence as village works and roles (walls, lights, guards, hunters) | **Not now**; after (c) holds at 25 | a phase, like Phase N |

Combat itself is not the hard part: **the agent server already has a combat reflex** (`botAgent.ts` `selfDefence()`,
an `attack` skill in `mcSurvival.ts`, a `damage`/`death` event path to the brains), and in the probe an armed bot killed
two husks in about 7 seconds with no model call. The hard parts are what peaceful lets the code ignore today: deaths
send members 900 blocks away and drop their loads, every hit wakes the model, unarmed members cannot get away, the
prompts and note checks say "nobody dies", and the event loop at 25 bots has little room for pathfinder re-searches in
melee. All of it is ordinary code, behind one mode setting, and stage (a) is cheap enough to try next week.

## 1. Mineflayer's side

What the project runs: `mineflayer` 4.39.0 (npm 2026-09-06; supports `26.1`, through `minecraft-data` 3.117.0, whose
newest pc version is 26.1), `mineflayer-pathfinder` 2.4.5 (npm 2023-09, repo active, patched under `patches/`). No
combat plugin is installed.

Mineflayer's core already gives everything a reflex needs: `bot.health`, `bot.food`, `bot.foodSaturation`,
`bot.oxygenLevel`, the `health`, `entityHurt`, `death`, `respawn` events (auto-respawn on by default), `bot.attack`,
`bot.lookAt`, `bot.consume`, `bot.activateItem(true)` (shield in the off hand), `bot.entities`. The plugins add
policy, not capability.

| Plugin | npm version (published) | Repo (last push) | 26.1? | What it does per tick | Fit here |
|---|---|---|---|---|---|
| [mineflayer-pvp](https://github.com/PrismarineJS/mineflayer-pvp) | 1.3.2 (2022-07) | moved to PrismarineJS, pushed 2026-04 | installs against 4.39.0 | on `physicTick` (the deprecated name; Mineflayer warns): distance to the target, `GoalFollow(target, 2)` on the pathfinder, attack when the weapon's cooldown (its `AttackSpeeds.json`) allows, creeper check | **Do not use as is.** It swaps in its own default `Movements` (digs anything: lesson 30/31's protection lost; set `pvp.movements = a.moves()` if used), drags `mineflayer-utils` which pulls a second copy of **mineflayer 2.41.0**, and does no more than our `attack()` |
| [@nxg-org/mineflayer-custom-pvp](https://github.com/nxg-org/mineflayer-custom-pvp) | 1.7.16 (2026-04) | pushed 2026-04 | probably (pathfinder ^2.4.5) | melee with crit/strafe timing, bow aiming with trajectories, shield | Worth reading for bows; heavy (tracker, smooth-look, trajectories plugins, per-tick prediction per target). Not needed for melee against zombies |
| [mineflayer-auto-eat](https://github.com/linkle69/mineflayer-auto-eat) | 5.0.3 (2025-08) | pushed 2026-02 | yes (`mineflayer ^4.30`) | `physicsTick`: compare food to `minHunger` (15), pick best food by points, equip and eat | Usable, light (a few comparisons a tick). But eating must go through the village's food (appetite.ts, own chests, storage meals): a 20-line reflex of our own fits better |
| [mineflayer-armor-manager](https://github.com/PrismarineJS/MineflayerArmorManager) | 2.0.1 (2023-07) | PrismarineJS, pushed 2026-10-30 | yes (peer `^4.10`) | no tick work: on `playerCollect`, equip the best armour picked up | Fine and cheap, but members take armour from chests, not pickups: an `equip_armor` step after a withdrawal is simpler |
| [minecrafthawkeye](https://github.com/sefirosweb/minecraftHawkEye) | 1.3.9 (2024-05) | pushed 2024-05 | untested | bow aim (ballistics) when asked | Only for (d)'s ranged guards; stale |

All five installed cleanly against mineflayer 4.39.0 + pathfinder 2.4.5 in a scratch folder (not the repo), with
`npm audit` warnings from mineflayer-utils' old tree. **Recommendation: no plugin for melee, eating or armour**; keep
extending `selfDefence()`/`attack()`, which already respect the walk rules, the reflex slot and the event log. Revisit
custom-pvp only for archers in (d).

## 2. The live probe (test world 3, 2 bots, easy, husks)

Husks, because the time is frozen at day and zombies burn. Bots on the `idle` brain (no model), MC_TIME_SCALE 1.

- **Unarmed (Gus), 2 husks on him:** `damage` events at 3 per hit; the reflex chose to flee ("no weapon: craft a
  wooden_sword"), ran 10 s, resumed, was caught again: a hit every ~7.5 s for 60 s, health 20 -> 13 with natural
  regeneration eating food 20 -> 17. He would have died in about 3 minutes on easy, faster on normal. **Fleeing on foot
  does not shake a husk**: a flee must end somewhere safe (indoors, door shut, up a pillar) or in a fight.
- **Armed (Mayor, iron sword), standing 0 blocks from Gus:** never helped. The reflex fires only when the bot itself was
  hurt in the last 3 s; the husks followed Gus away. A guard needs "defend a neighbour".
- **Armed, alone, 2 husks:** took 3 hits (18 hp), killed both husks in 6 and 4 swings over ~7 s, picked up the rotten
  flesh, resumed. Mineflayer's health, hurt and pickup reporting all worked on 26.1.
- `/api/perf` with 1-2 bots fighting: loop p99 11 ms, tick p99 3 ms: no visible cost (the 25-bot cost is below).
- Restored: `difficulty peaceful` (it removes hostiles), checked `difficulty` and `advance_time`, world 3 stopped by
  `stack.py down test3` as it was before.

## 3. The event loop

Reflexes must be code; a model turn takes 2-20 s and a zombie kills an unarmed member in 20-40 s on normal.

**Code (reflexes, every tick or on an event):** attack back, flee to shelter, eat when hurt or hungry, swim up when air
is low, step out of fire/lava, retreat home at dusk, defend a member within ~8 blocks, put on armour after a withdrawal,
shield up against a skeleton (later).
**The model (seconds to minutes):** go out at night or not, arm up (craft swords, armour), build walls and lights,
hunt for drops (string, bone, gunpowder now bought from the merchant), take a guard or hunter role, set rules
("nobody mines after dusk"), and what to do after a death.

Per-tick cost at 25 bots fighting (1x, 20 ticks/s; the loop is shared):

| Work | Estimate | Note |
|---|---|---|
| `selfDefence()` scan (`Object.values(bot.entities)` + distance) | 25 x 20/s x ~150 entities = 75k checks/s, ~3-8 ms/s | runs today in peaceful too; cheap, but allocate less (keep a hostile list from `entitySpawn`/`entityGone`) |
| Entity packets for mobs (each bot parses moves of every entity in tracking range) | 25 bots x ~50 mobs x ~10 updates/s = 12k parses/s, ~20-40 ms/s | the new cost of mobs; cut with Paper's `entity-tracking-range` for monsters (spigot.yml) and lit villages (fewer mobs) |
| **Pathfinder in melee**: `GoalFollow(target, dynamic)` re-searches when the target moves | 1-3 ms a search x a few a second x 25 = 100-400 ms/s, capped at 15 ms/tick/bot (lesson 16), shared budget (lesson 126) | **the risk**: 25 bots in melee at once could take 10-40% of the loop, on top of a loop that is already busy at 25 (lesson 125). Within ~5 blocks steer directly (look + forward control, no A*); pathfind only to close a distance |
| Attack, look, eat packets | negligible | |
| **Model wake-ups**: `damage` sets `urgent` in `tieredBrain.ts:888` and `llmBrain.ts:45` | one model call per hit per member: a night siege could be hundreds of calls | must change before (c): reflex-handled damage informs, not wakes; a death or "health below 6 with no reflex" wakes |

At 2x/3x time scale mobs speed up but the reflex sleeps 650 ms of wall clock between swings: **combat tests run at 1x**,
or the cooldown is divided by `timeScale()`.

## 4. What breaks when peaceful goes

| Where | Today's assumption | Change | Size |
|---|---|---|---|
| `mcRules.ts` `WORLD_RULES`, `applyWorldRules` | peaceful + 11 rules fixed; status line says "peaceful..." | a mode setting (`MC_WORLD=peaceful|damage|easy|normal`, default peaceful) picks the rule set; status by mode | ~60 |
| `settings.ts`, `docs/SETTINGS.md` | (busy: the start-screen session edits settings.ts today) | one registry entry, after that session lands | ~10 |
| `scripts/stack.py`, `run_series.py`, `reset_site.py` | treat any non-peaceful rule as "NOT applied" | read the mode | ~20 |
| `botAgent.ts` `selfDefence()` | only defends itself; flees 10 s and resumes into the same mob | flee to shelter (storage hut/home, then fight); defend a neighbour; low-health eat; air and fire reflexes | ~150-250 |
| `botAgent.ts` `death` handler | `stop()` + event; the bot respawns at the world spawn | per-member `spawnpoint` at the village storage over RCON at spawn (lesson 37: respawns were 900 and 540 blocks away); after a death, walk back and say what was lost | ~40 |
| `mcSurvival.ts` `attack()` | 650 ms wall-clock cooldown, pathfinder follow | weapon cooldown by timeScale, direct steering under 5 blocks, shield | ~60 |
| `tieredBrain.ts:888`, `llmBrain.ts:45` | every `damage` event wakes the model | wake on death or unhandled danger only; throttle | ~20 |
| `mcUtil.ts` walks | `maxDropDown` 8 on a retry (5 damage a fall); drowning impossible | 4 when fall damage is on (or 8 only at full health); air watch in walks | ~20 |
| `mcRescue.ts` | a lake stuck 13 min was survivable; rescue after 2 failed moves in 6 min; last resort teleports | an air reflex long before the rescue (drowning from full takes ~25 s after 15 s of air) | ~30 |
| `mcMine.ts` (diamond level near y -58, lava lakes) | stops at lava adjacency already; the pathfinder avoids lava (`blocksToAvoid`); `fire_damage false` covers lava today | dark tunnels spawn mobs at block light 0: torches every ~10 cells in mine tunnels, or miners armed | ~50 |
| `mcBuild.ts` / chores digging at heights | suffocation already handled (lessons 12, 37, 44) | felling and scaffolds: fall checks once falls hurt | small |
| `appetite.ts`, `mcBuild.ts` meals | vanilla hunger never drains in peaceful, so a simulated appetite stands in | in survival vanilla hunger is real: the meal chore must read `bot.food`, and the simulated level stays for peaceful only (two hungers at once would double-count) | ~60-100 |
| Prompts and checks: `choose.ts:248` PRIMER ("nobody dies"), `goalMap.ts:25` WORLD_FACTS, `memory.ts:527` RULED_OUT (refuses notes about mobs, hurt, dying), `activities.ts`, `mcMaterials.ts:73` (mob drops "not obtainable"), `merchant.ts` (sells mob drops) | peaceful world facts in words | facts by mode; mob drops obtainable; the merchant's list shrinks | ~40, plus a bench (choicebench, mayorbench) since prompts change |
| Reservations, held tasks, carried loads (`village.ts`, the board) | a member never vanishes mid-task | a death keeps reservations (the member comes back) but drops the carried load (items despawn in 5 min): builds charged to the inventory fail; `keep_inventory` true removes this | ~30 with keep_inventory; more without |
| The scripted TaskBrain (staged tests) | handles "idle while waiting" (lesson 67) | already fine on a death | 0 |
| Time frozen at day (`advance_time false`) | the user watches by day | stage (b) on: nights; crops grow either way | see (b) |

## 5. Paper and the game rules (26.1 names)

- **Difficulty:** peaceful removes hostiles and refills hunger. Easy: starvation stops at 10 hp, mobs weaker. Normal:
  starvation to 1 hp. Hard: starvation kills, zombies break doors.
- **Damage rules:** `fall_damage`, `drowning_damage`, `fire_damage` (covers lava), `freeze_damage`. Suffocation has no
  rule (already met: lessons 12, 37, 44).
- **`keep_inventory`:** the soft step: a death costs position and time, not the load. Keep it on through (c).
- **`natural_regeneration`** (on): heals from food; with it, hunger is the cost of fighting.
- **Day cycle:** `advance_time`. Monsters spawn where block light is 0 (since 1.18), at night and underground; any torch
  or lamp light stops spawning on that block, so **a lit village is spawn-proof** (the street lamps already exist).
  Sleep skips the night when `players_sleeping_percentage` of players sleep: with 25 bots and beds (the m2 beds spec),
  or 1-2 % so one sleeper does it.
- **Spawn rules:** `spawn_monsters`, `spawn_phantoms` (insomnia; keep off), `spawn_patrols` (pillager patrols; off until
  (d)), `spawn_wardens` (off). Mob cap: 70 hostiles per 289 loaded chunks around players; 25 members spread over a
  village load more chunks, so more mobs.
- **How villages get attacked:** zombie sieges (rare, at midnight, in a vanilla village of beds and villagers: needs the
  villager/bed spec, and not on peaceful); raids (a player with Bad Omen, from an ominous bottle in 1.21+, entering a
  village: only if members drink one, so controllable); pillager patrols (rule above); and plain night spawns on unlit
  ground, which is the realistic pressure. Creepers blow up builds when `mob_griefing` is on: turn mob griefing off
  until walls and repairs exist (it also stops endermen taking blocks).
- `spawnpoint <name> x y z` per member (RCON), so a death respawns at home.

## 6. The staged path

**(a) Damage, still peaceful.** `fall_damage`, `drowning_damage`, `fire_damage` on; peaceful, day, keep_inventory as now.
Changes: the mode setting and rule sets, `spawnpoint` per member at spawn, death recovery (walk home, tell the brain),
air and fire reflexes, the walk's drop limit, damage no longer waking the model. Risks: deaths in lakes and tall
scaffolds; members respawning far away (fixed by spawnpoints). Measure: deaths per hour by cause (a new `[death]` line),
`[rescue]` count, completion time against peaceful on the same checkpoint (the village simulator can't model this; a
staged pair can). Pass: under 1 death per member-hour, completion within 10 %.

**(b) Easy, day cycle, home at night.** Easy difficulty with `spawn_monsters` still false (hunger real, starvation stops
at 10 hp), `advance_time` on, sleep or a skip. Changes: vanilla hunger replaces the simulated appetite in this mode;
eating reflex; a curfew chore (dusk: walk home, sleep or idle indoors); prompts by mode; beds (the m2 spec). Risks: work
stalls at night (half the day lost: worth it only if night brings something); the user watches in the dark. Measure:
work done per day-night cycle, starving members (hp at 10), meal chores. Pass: no member below 10 hp for more than a
minute.

**(c) Hostile mobs, reflexes, armed members.** `spawn_monsters` on, `mob_griefing` off, keep_inventory on. Changes: the
reflex extended (flee to shelter, defend neighbours, direct-steer melee, eat), swords and armour on the craft menu with
facts ("zombies come at night on unlit ground"), lighting chores (lamps, mine torches), mob drops obtainable (the
merchant sells fewer), Paper entity tracking range trimmed. Risks: the event loop at 25 (pathfinder in melee, entity
packets); model wake-ups; a death spiral at a dark build site. Measure: `/api/perf` loop p99 at 25 bots with mobs against
without (`scale_probe25.py` with a night), deaths and kills per night, model calls per hour (`/api/usage`). Pass: loop
p99 under 50 ms, no wake storm, under 2 deaths per member-night.

**(d) Defence as works and roles.** Walls and gates as public works, lit streets as a need (`MC_NEED_WORKS`), guards
(a patrol chore, defend-a-neighbour radius larger, bow later), hunters (drops for the economy: string for bows and
wool, bone meal for farms, gunpowder), a rule vote ("no one outside after dark", "guards are paid"). This is where
survival feeds the goals: danger gives choices stakes (#164's finding: prompt lines alone did not move laws; a world
step does), specialisation has a reason, and collective rules have something to protect. Risks: a phase of its own;
mob drops change the economy. Measure: share of members in a defence role, rules passed about safety, deaths per
night falling over a run.

## 7. Recommended first step

Stage (a), behind `MC_WORLD=damage` (default peaceful, so it is opt-in; by the 10-30 rule a flag defaults on, but this
changes the user's base assumption, so the user should say). One build session, ~300 lines: the mode table in
`mcRules.ts` and the scripts' rule checks, `spawnpoint` per member, a `[death]` log line and walk-home, the air and fire
reflexes, the drop limit, damage no longer waking the model. Then one staged pair (peaceful vs damage) from a
checkpoint in the next test train. That also makes deaths countable before any mob is turned on, and costs nothing in
tokens. Wait until the start-screen session has landed `settings.ts`.

## 8. The user's choices

1. Is survival a goal at all, or a side experiment? It moves G2/G3 (emergence, rules) but costs runs.
2. Keep `keep_inventory` on through (c) (recommended), or make death lose the load?
3. Day cycle: real nights (darker to watch, half the day for work), nights skipped by sleep, or always day with mobs
   only underground?
4. Difficulty for (c): easy (recommended first) or normal.
5. Mob griefing off (recommended until walls and repairs exist)?
6. Default: opt-in (`MC_WORLD=peaceful` default) despite the flags-default-on rule, since it changes the base premise?
7. Bows and ranged guards in (d), or melee only?
