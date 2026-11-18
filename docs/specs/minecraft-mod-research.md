# Turning MCAISandbox into a Minecraft mod (research, 2026-11-16)

The user asked: "research how to turn this into a minecraft mod". This report covers research only. Nothing was built, run
or committed. It covers the platforms for Minecraft 26.1, what a mod gains over today's Mineflayer bots, three
architectures with their effort and reuse, prior art, and licensing and distribution. It ends with a recommended path
and open questions.

Web facts are cited inline. Several came from search summaries and third-party listings rather than the projects' own
pages; those are marked *(secondary)*. Check them before relying on them.

## Summary

- **Every main platform supports 26.1.** 26.1 is the first Minecraft release shipped without obfuscation, so Paper
  internals, Fabric and NeoForge now all use Mojang's own names. That makes code shared between a Paper plugin and a
  Fabric/NeoForge mod far cheaper than before.
- **What a mod really buys** is direct world access in place of RCON (about 250 call sites), server-side bodies in place of
  network clients, single-player play, and a one-jar install for players. The brain and village code does not need it.
- **The code splits cleanly at a layer that already exists.** About 48k lines (brains, village, choices, ladder, votes,
  designs) depend only on `world.ts`. About 42k lines in `server/src/mineflayer/` are the body and skills, and those
  would have to change.
- **Recommendation: keep the Node agent server as the brain, and grow a Java "body" in steps.**
  1. A Paper bridge plugin that replaces RCON, with Mineflayer kept.
  2. Plugin-hosted fake-player bodies behind a flag. This is the same seam as the scale-50 brain/body spec.
  3. A Fabric (then NeoForge) port of that bridge for single-player, with the agent server shipped as a sidecar.

  Porting the brain to Java (option b) is not worth it: about 90k lines, plus the loss of the replay, benches,
  simulator and panel tooling.

## 1. Platforms for Minecraft 26.1

| Platform | 26.1 status | Fits this project? |
|---|---|---|
| **Paper plugin** | Paper 26.1 released, and 26.2 and 26.3 have followed ([Paper 26.1 news](https://papermc.io/news/26-1), [26.2](https://papermc.io/news/26-2), [26.3](https://papermc.io/news/26-3)). Paper dropped its internal remapper because server jars are now unobfuscated, so plugins built against Spigot-mapped internals break, and `paperweight-userdev` is the way to reach server internals. Java 25 ([paper-api 26.1.1 javadoc](https://jd.papermc.io/paper/26.1.1/index.html)). After a world is upgraded to 26.1 it cannot be downgraded. | **Best first step.** We already run Paper, so there is no new server, the whitelist and RCON stay, and test worlds can run it beside today's setup. Server only: no single-player. |
| **Fabric mod** | Fabric shipped 26.1 support ([Fabric blog, 2026-03-14](https://fabricmc.net/2026/03/14/261.html)). It calls this its largest tooling change for one release: Yarn is no longer officially supported and mods move to Mojang's names; the new `net.fabricmc.fabric-loom` plugin does no remapping; Java 25; the porting guide is at [docs.fabricmc.net](https://docs.fabricmc.net/develop/porting/). | **The single-player route.** It runs on the integrated server, so a mod's server-side bodies work in a single-player world. It is the home of Carpet fake players and Automatone. |
| **NeoForge mod** | NeoForge 26.1.0.x for 26.1, Java 25 ([NeoForge 26.1 release](https://neoforged.net/news/26.1release/), [snapshots post](https://neoforged.net/news/26.1snapshots/)). Fabric-on-NeoForge bridges (Forgified Fabric API, Sinytra Connector) carry 26.1.2/26.2 builds *(secondary: [mcmodfinder](https://mcmodfinder.com/mods/forgified-fabric-api/))*. | **Second loader.** It is where MineColonies-style players are. Because both loaders use Mojang names, a shared "common" module plus thin loader shims is now practical. |
| **Quilt** | Quilt retired its own libraries (QSL, QKL, Quilted Fabric API) for 26.1 ([Quilt blog, 2026-02-03](https://quiltmc-org.pages.dev/en/blog/2026-02-03-non-obfuscated-updates)). Quilt Loader still loads Fabric mods, and some mods have dropped Quilt builds *(secondary: [mixson](https://modrinth.com/mod/mixson))*. | No separate target. A Fabric build covers Quilt users. |
| **Data packs** | Supported, but limited to functions, tags, loot, advancements and worldgen. A data pack has no network or file I/O and no long-running code. | Not a host for agents. It can still ship content: our game rules (`mcRules.ts`), recipes and advancements as "ladder rung" markers. |

**Version drift.** The project is pinned to Paper 26.1, but 26.2 and 26.3 are out. Every mod or plugin pins a game version,
while Mineflayer's protocol layer (`minecraft-data`) already absorbs most of that drift for us today. A Java body means
following Minecraft releases ourselves: one port per version, smaller since 26.1 because there are no mappings to
chase.

## 2. What a mod gains over the bot setup

Today one Node process runs every bot as a full network client: protocol, chunks, physics and `mineflayer-pathfinder`.
It reads the world through those clients and changes it through about 250 RCON calls (`rcon.command` 143, `take` 33,
`count` 45, `give` 21, plus about 106 `rcon(\`...\`)` sites). The costs are measured in our own findings:

- F363: one process saturates at about 100 bots (102% busy, loop p99 605 ms, RCON p90 1.3 s).
- The scale-50 profile: block reads 17%, pathfinder 13%, chunks 9% and physics 9% of CPU, against a village side of
  about 3%.

The workarounds come from the same causes: lessons 4, 13, 29 and 80 (Mineflayer's view is not the server's), lesson 40
(Paper times digs by the wall clock), and lesson 104 (a pathfinder exception took the server down).

| Gain | How a mod gets it | Worth to us |
|---|---|---|
| **Direct world access** | Read blocks, inventories and containers on the server thread. Place, fill and take items through the API instead of `/setblock`, `/fill` and `clear <name> <item> 0`, with batched writes and real events (block broken, item picked up, entity died) pushed to the agent server. | **High.** It removes RCON latency and timeouts, Mineflayer-versus-server view mismatches and polling with `execute if block`. It is the cheapest gain, because it needs no change to the bodies. |
| **Server-side bodies** | Fake `ServerPlayer`s: Carpet's fake players on Fabric (a shared Fabric API fake player was proposed in [fabric-api#1980](https://github.com/FabricMC/fabric-api/issues/1980)). On Paper they are NMS `ServerPlayer`s, as done by [NPCs](https://hangar.papermc.io/AugmentedThunder/NPCs), [Fake Player Plugin](https://hangar.papermc.io/Janky-Development/FakePlayerPlugin) and [Better Spoofer](https://builtbybit.com/resources/better-spoofer.106979/) *(secondary)*. Alternatively, custom mob-like entities. | **High at scale.** There is no protocol, client chunk cache or client physics per bot: the server already simulates the entity. Fake players fill a whitelist and player-count slot like real ones (`max-players` 30 today), but they are real players for game rules, sleep, inventories and advancements, which our skills assume. Better Spoofer's changelog shows the traps: ViaVersion login events and skin lookups for fake UUIDs. |
| **Pathfinding** | **Vanilla mob navigation** is cheap and does not dig or pillar. **[Automatone](https://github.com/Ladysnake/Automatone)** (Ladysnake) is a server-side Baritone fork for any entity, Fabric, LGPL-3.0, marked experimental and possibly unmaintained *(secondary)*. Player2's PlayerEngine builds on it ([itch.io](https://goodbird-git.itch.io/playerengine)). **Baritone** itself is a client mod, so it does not apply on the server. | **Medium, and the riskiest part.** Our walks carry about 40 lessons of tuning (stuck, repath, protected cells, scaffolds), and `mineflayer-pathfinder`'s digging and placing behaviour is built into the skills. Any server-side pathfinder means re-earning those lessons. Automatone is the nearest match in behaviour (digs, places, parkours). |
| **Single-player** | Fabric and NeoForge mods run on the integrated server. | **Needed for "a mod players install".** Paper cannot give it. |
| **Distribution** | One jar on [Modrinth](https://modrinth.com) and CurseForge, or a plugin on [Hangar](https://hangar.papermc.io). | Real, but it depends on how players get a brain and models (section 5). |
| **What a mod does not fix** | The model calls, the village side's CPU (P-1's sweeps) and Paper's tick time with 200 entities. | F365: Paper holds 200 bots at about 31 ms a tick, so the server is not the limit. |

## 3. Architectures

### Sizing the code

| Layer | Files and lines | Depends on Mineflayer? |
|---|---|---|
| Brains, village, choices, ladder, votes, designs, generators, social (`server/src/*.ts`, 114 files) | ~47,800 lines | Only through `world.ts`'s `WorldAgent`/`WorldAdapter` interfaces. Seven files import **data** (types and tables) from `mineflayer/mcMaterials.ts` and `mcWorkshop.ts` (`activities`, `library`, `merchant`, `proposals`, `tech`, `techTree`, `wanted`). Those two files have no `bot.` use and move out unchanged. |
| Adapter, skills and world (`server/src/mineflayer/`, 41 files plus `foundry/`) | ~42,000 lines | Yes, unevenly. The mineflayer, pathfinder, prismarine and minecraft-data imports are in 28 files. The largest by `bot.` uses: mcBuild 8,964 lines (171 `bot.` uses, 237 RCON uses); mcWorld 13,235 (75 `bot.`, 33 RCON, mostly the **village side**, which stays in Node); mcSurvival 2,270 (143 `bot.`); mcCombat 1,785 (130); botAgent 1,264 (111); mcUtil 950 (70, walks and `nearestBlocks`); mcMine 2,853 (51); mcNether 887 (60); mcRescue 411 (53). Pure logic with no `bot.` use: mcMaterials, mcWorkshop, mcAtlas, mcSiteAtlas, mcBlocks, mcChoiceLog, mcSandTrips, mcDiamond, mcLibrary. |
| Tooling | Panel, REST API, model recording and replay, benches, the village simulator, `run_series.py`, about 50 checks | All against the agent server's API: kept by (a) and (c), lost or redone by (b). |

The **scale-50 brain/body spec** (`D:\Projects\MCAISandbox-scale50\docs\specs\brain-body.md`, approved 11-07) has already
surveyed this seam. One village process holds all shared state and the brains, and "body" processes run the bots and
skills, with `RemoteAgent implements WorldAgent` as the boundary. A mod-hosted body is that same design with the body in
Java instead of in a second Node process. The spec's findings apply directly:
- skills write shared `Village` objects in place (about 125 `a.village()` uses, about 164 uses of `a.world.villages`);
- there are 40 cross-bot lock maps;
- mcWorld reads blocks through any bot's world.

### (a) A thin mod or plugin hosts the bodies; the Node agent server keeps the brain

**Shape.** The Java side spawns fake players and exposes a local WebSocket. Two ways to split it:
- **(a1) A Mineflayer-shaped facade.** The Java side exposes body primitives: position, inventory, `dig`,
  `placeBlock`, `goto`, `openContainer`, `attack`, `equip`, block reads, `nearestBlocks`. A Node shim implements the
  slice of Mineflayer's `bot` the skills use, over that socket, so the skills stay in TypeScript nearly unchanged.
- **(a2) Skills move into the body.** The Java side implements the 27 tool skills (`skills.ts`) and the chores'
  helpers, and Node sends `enqueue(skill, args)` and receives events. This is the brain/body spec's boundary one level
  further in.

**Reuse.**
- (a1) keeps all ~48k lines of brain and village code and most of the 42k-line adapter. Walks are the exception:
  `goto` becomes a server-side pathfinder call.
- (a2) keeps the 48k lines and rewrites about 30k lines of skills in Java.

**Effort** (sessions as in PLAN.md):
- (a1) about 12-18 sessions: protocol and fake players 3-4, facade 4-6, walks on Automatone or our own 4-6, checks
  and staged runs 2.
- (a2) about 35-50 sessions, plus re-earning the skill lessons.

**Risks.**
- Chatty RPC: a skill's tight loops over `bot.blockAt` need batching or a world mirror. The brain/body spec's world
  mirror and hints address this.
- Walk behaviour drifts from the tuned `mineflayer-pathfinder`.
- Two languages in one repo.
- (a1) keeps some Mineflayer semantics as a fiction, but it is the only route that keeps the staged tests meaningful
  from day one.

### (b) Port the brain into Java or Kotlin

**Shape.** Everything in one jar: brains, village registry, designs, generators, model clients (Ollama and Anthropic
over HTTP from Java) and the panel.

**Reuse.** Ideas, prompts and the JSON formats (`villages.json`, designs) only. All about 90k lines are rewritten.

**Effort.** Very high: at the project's pace, 80-150 sessions before parity, with the codebase changing under the port
every day.

**Risks.**
- We lose model replay, the benches, the village simulator, `run_series.py` and the checks, or must port them too.
- Two code lines diverge.
- Running models on the server thread needs careful async handling. Kotlin coroutines help.

**Gain.** One install with no Node. That gain is reachable more cheaply by shipping the Node agent server as a
sidecar: a Node single-executable build, or a portable Node bundled in the mod's download, started and stopped by the
mod. *Not recommended.*

### (c) A Paper plugin as the first step

**Shape.** A plugin on the Paper servers we already run. Step one is a **bridge**:
- an authenticated local WebSocket that replaces RCON for `command` (batched), `count`, `give`, `take`, `peek` and block
  checks;
- direct block and region reads for mcWorld's village-side reads (farm ripeness, `materialsNear`, `surfaceAt`, the
  panel's maps), which today borrow a bot's chunk cache;
- pushed events: block changes near villages, deaths, chat, and player joins.

Mineflayer bots stay. Step two adds plugin-hosted NMS fake players as bodies behind a flag. That is (a1) on Paper.

**Reuse.** All of it. `rcon.ts` gets a second transport, and call sites change only where batching helps.

**Effort.**
- Bridge: about 4-6 sessions (a Gradle/paperweight project 1, protocol and transport 2, moving the hot RCON and
  block-read paths 1-2, checks 1).
- Fake-player bodies afterwards: the (a1) numbers.

**Risks.**
- Low for the bridge: it sits beside RCON behind a flag, and the old path stays the control arm.
- Paper's NMS fake players rest on internals that change per version (fewer breaks since 26.1, but still some).
- Paper-only: no single-player, so the work counts toward a mod only if the Java core is kept loader-neutral.

| | (a) thin host + Node brain | (b) Java port | (c) Paper plugin first |
|---|---|---|---|
| Reuses brain/village (~48k) | all | none (rewrite) | all |
| Reuses adapter/skills (~42k) | most (a1) / little (a2) | none | all (bridge), then as (a1) |
| Keeps panel, replay, benches, sim, checks | yes | no | yes |
| Effort (sessions) | 12-18 (a1), 35-50 (a2) | 80-150 | 4-6 bridge, then (a1) |
| Single-player | yes, on Fabric/NeoForge | yes | no |
| Main risk | walks on a new pathfinder; RPC chatter | a long port that never catches up | Paper-only; NMS churn |
| Gives players a one-jar install | jar + sidecar | jar only | plugin + sidecar (server owners) |

## 4. Prior art

| Project | What it is | Lesson for us |
|---|---|---|
| **Voyager** (NVIDIA et al., 2023; [arXiv 2305.16291](https://arxiv.org/abs/2305.16291), [MineDojo/Voyager](https://github.com/MineDojo/Voyager)) | One GPT-4 agent with an automatic curriculum, a skill library of code and self-verification, on **Mineflayer**. | Same body stack as ours. Our foundry and skill library are its descendants. It stayed a research harness, not a mod. |
| **Project Sid** (Altera, 2024; [arXiv 2411.00114](https://arxiv.org/abs/2411.00114), [altera-al/project-sid](https://github.com/altera-al/project-sid)) | PIANO: concurrent modules with a cognitive controller as a bottleneck; 10-1,000+ agents; specialisation, taxes and constitutions, cultural spread. | Scale came from their own infrastructure, not a public mod. Our brain/body split is the same kind of move. No public mod or plugin came out of it *(as far as the search shows)*. |
| **Mindcraft** ([UCI write-up](https://sites.uci.edu/kolbynottingham/2024/10/30/mindcraft), [kolbytn/mindcraft](https://github.com/kolbytn/mindcraft)) | Node + **Mineflayer** LLM bots with many model providers; players run it beside their own world (LAN or server). | The closest to how we would distribute today: "run this Node app, it joins your world". Mineflayer bodies work for players without any mod. |
| **Player2 AI NPC / PlayerEngine** ([Modrinth](https://modrinth.com/mod/player2npc), [PlayerEngine](https://goodbird-git.itch.io/playerengine)) | Fabric/NeoForge companion mod for 1.20.1/1.21.1; server-side player-like entities on Automatone; model access through the separate Player2 desktop app *(secondary)*. | Shows the "mod + external brain app" shape works and is accepted on Modrinth and CurseForge. Shows Automatone in use for bodies. |
| **Other LLM companion mods** (SecondBrain, CraftAgent, AI-Player, Core Companion, 0xAI; [Modrinth search](https://modrinth.com/mod/secondbrain), [CraftAgent](https://modrinth.com/mod/craftagent)) | Mostly Fabric, 1.20-1.21; local Ollama or OpenAI keys; Carpet fake players or Baritone for movement; 0xAI lists 26.1 *(secondary)*. | Mostly one or a few companions. None builds or governs a village of 25. Bring-your-own-Ollama is the norm. VoxelMind shut its hosted service on 2026-11-08 *(secondary)*, a warning against a hosted model backend. |
| **MineColonies** ([CurseForge](https://www.curseforge.com/minecraft/mc-mods/minecolonies)) | NeoForge colony mod with scripted citizens: jobs, buildings from schematics, requests and a warehouse. An unofficial Fabric port to 26.2 exists *(secondary)*. | The best design reference for a village mod: hut-based jobs, a request system, building styles as resource packs. It shows scripted entities can carry a colony without player-shaped bodies. |
| **Carpet** ([fabric-carpet](https://github.com/gnembon/fabric-carpet)) and its fake-player add-ons | `/player` fake players on Fabric; add-ons for batches of bots ([PlayerBatch](https://modrinth.com/mod/playerbatch)). | The standard server-side player body on Fabric. Its quirks (no connection events, as in [Carpet PRY Addition](https://www.curseforge.com/minecraft/mc-mods/carpet-primaryuan-addition)'s BlueMap fix) are known. |
| **Citizens** ([SpigotMC](https://www.spigotmc.org/resources/citizens.13811/)) | The standard Paper/Spigot NPC plugin, with its own navigation and traits; updated for 26.1 in April 2026 *(secondary)*. | An option for Paper bodies. Its navigator is mob-like (no digging or pillaring), so our skills would still need their own movement. |

## 5. Licensing, distribution and costs

- **Mojang's EULA and Usage Guidelines** ([EULA](https://www.minecraft.net/en-us/eula); a summary at [ConductAtlas](https://conductatlas.com/platform/minecraft/minecraft-usage-guidelines/)):
  - Mods may be shared free, but not sold (selling is only through the Marketplace).
  - A mod must not include Minecraft's code or assets.
  - Mojang may withdraw these permissions and take down mods that break the guidelines.

  A free mod plus an open-source agent server is fine. Paid hosting of the brain would need care: a service, not the
  mod, may be charged for, but check the guidelines' wording on servers and services before any money is involved.
  The search found no Mojang rule on AI-driven mods.
- **Platforms.**
  - Modrinth added an AI policy (Content Rules section 6, grace period ending 2026-09-27; [Modrinth news](https://modrinth.com/news/article/ai-policy-and-disclosures/)). It is about disclosure; read section 6 before uploading.
  - CurseForge's terms and Hangar's rules also need a read for mods that call outside services and for any bundled
    executable (the sidecar). Hosts commonly forbid mods that download and run code at runtime. *Open question 3.*
- **Dependency licences.** Mineflayer and mineflayer-pathfinder are MIT. Automatone is LGPL-3.0 (usable as a library).
  Fabric API is Apache-2.0. Paper's licensing differs by part (API versus server patches); check before shipping NMS
  code. **This repo has no LICENSE file**, so one is needed before any public release (and the public repo is frozen
  until the user publishes).
- **Model costs for players.**
  - Our own figure: a 25-member village on `gpt-oss:120b-cloud` used about 4.1M tokens over about 4 hours (2,657
    calls, about $0.86 at the estimate the runs report; F-entry at FINDINGS.md:1779). That is roughly $0.20 an hour
    per village of 25, on an Ollama Cloud subscription.
  - Claude-class models would cost many times more per token.
  - Local models need serious hardware: our fallback uses two RTX 3090s for 30B models.

  So a mod would offer three backends:
  - **bring your own Ollama**, local or Ollama Cloud: the norm among LLM mods;
  - **an OpenAI-compatible endpoint with your own key**;
  - **scripted mode**: today's `taskBrain` and fixed choices, which runs with no model at all, and is the free tier.

  The hourly token budget (`MC_TOKEN_BUDGET_HOUR`) and `MC_LLM_LIMITS` are already the player-facing cost controls.
  Never ship our keys.

## 6. Recommended path

The goal is a sequence where every phase is useful on its own and keeps today's tests as the control arm.

| Phase | What | Done when | Rough size |
|---|---|---|---|
| **M0. Decide** | The user answers the open questions below. In particular: who is the mod for (us at scale, server owners, or single-player players)? | Answers recorded in DECISIONS | 0 |
| **M1. Paper bridge plugin** | `mc/bridge/`: Gradle and paperweight-userdev, Java 25. A local authenticated WebSocket. Batched commands, server-side item counts, give and take, block and region reads, and pushed events. In Node, `rcon.ts` gets a bridge transport behind `MC_BRIDGE` (on by default, as new flags are; `=off` falls back to RCON). | A staged full build and an after-phase on a test world with RCON p90 and `[lag]` below today's, and `count`/`take` agreeing with `clear <name> <item> 0` (lesson 4). | 4-6 sessions |
| **M2. Java bodies behind a flag** | Fake `ServerPlayer`s in the plugin. Node's (a1) facade implements the `bot` slice the skills use. Walks go to a server-side pathfinder: try Automatone's approach, ported or reimplemented on Paper, against `pf_share.mts` and the walk checks. `MC_BODIES=plugin`. Align with the brain/body spec: the plugin is a body that serves many bots. | A staged village of 25 on Java bodies, with completion and busy share within the spread of Mineflayer runs, `[stuck]` no worse, and then a 50-bot and 200-bot load test (the F363/F365 numbers). | 12-18 sessions |
| **M3. Loader-neutral core and Fabric** | Move the bridge and body code into a `common` module on Mojang names, with Paper, Fabric and then NeoForge shims. Fake players come from Carpet-style code on Fabric. The mod starts the agent server as a sidecar (a Node single-executable build) on the integrated server for single-player. | A single-player world on Fabric 26.x where a scripted village (no models) completes, then one with Ollama. | 8-12 sessions |
| **M4. Package** | Licence, a player-facing config screen (model endpoint, budget, number of members), Modrinth and Hangar pages, and the mod's own version policy (one Minecraft version at a time). | A clean install on a fresh machine with only the jar and the sidecar download | 3-5 sessions |

M1 is worth doing even if the mod never ships: it removes RCON as a scaling and correctness limit. M2 is the scale-50
brain/body work in a different body, so plan the two together rather than twice.

## 7. Open questions for the user

1. **Who is the mod for?** Our own experiments at scale (M1-M2 suffice, Paper only), server owners (plugin plus
   sidecar), or players in single-player (needs M3)? This decides whether Fabric/NeoForge work is needed at all.
2. **Body route:** keep skills in TypeScript over a Mineflayer-shaped facade (a1, recommended), or move skills into
   Java (a2) for speed at the cost of re-earning the skill lessons?
3. **Sidecar or not:** is a bundled Node executable acceptable for Modrinth and CurseForge distribution, or must the
   player install the agent server separately, as Mindcraft and Player2 users do? This needs a read of the hosts'
   rules on bundled executables.
4. **Pathfinding:** port or adapt Automatone (LGPL) on Paper and Fabric, or write our own server-side walker on the
   lessons we have?
5. **Minecraft version policy:** stay on 26.1 for research, or follow releases (26.3 is out) once a Java body exists?
6. **Licence and publishing:** which licence, and when does the public repo unfreeze?
7. **Fake players and the whitelist:** fake players take player slots (`max-players` 30) and appear in the tab list.
   Is that acceptable to player-facing servers, or should bodies be custom entities that look like players?
