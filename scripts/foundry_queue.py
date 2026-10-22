"""The foundry's queue (G6, #73, #71, #16; spec runs/2026-10-21/g6-loop/spec.md 2): the wanted list of a running village
(server/src/wanted.ts, GET /api/wanted, or scripts/wanted.mts on a saved villages.json) turned into a foundry ticket.

It walks the list in rank order, says why it skips each capability it skips (not ticketable: have, locked, dead with
its reason, the user's call, a knowledge gap; no template for its verb; a ticket already written; the foundry already
failed it; not seen often enough in the top 3; none of its blocks in the village's land), and writes the first one left
as scripts/foundry/tickets/<id>.json from its verb's template, with structured fields only (no model call), in the shape
of fish.json and trade.json: a foundry skill, its activity adapter, a library spec with a `research` block (merged
locked: members unlock it by research, tech.ts) and its own live check. Each ticket written is logged in
scripts/foundry/queue_log.json with the wanted entry that made it.

Usage: python scripts/foundry_queue.py [--api URL | --villages FILE] [--village V] [--min-samples N] [--land WORLD]
                                       [--write] [--json]
  --api URL       an agent server's API (default MCAI_API); --villages FILE: a saved villages.json instead
  --village V     the village (default: the first complete one)
  --min-samples N the wanted list's writer must have seen it N times in the top 3 (wanted.json's history; default 0:
                  one sample of the list is enough, as now)
  --land WORLD    a world folder to count the capability's blocks in, within 144 of the storage hut (default: the
                  agent server's own world, from MC_SERVER_DIR, else mc/testworld)
  --write         write the ticket (without it: a dry run that prints what it would write)
  --capability ID ticket that capability (an accepted proposal routed to the foundry, #90), not the rank's first; the
                  same skips apply to it
  --wanted FILE   a wanted.json the live writer saved (MC_WANTED; a run's own list, read after the run)
  --accepted FILE the triage's accepted.json (triage_proposals.mts): the first accepted proposal routed `foundry` whose
                  capability has no ticket yet, as --capability
"""
import argparse, json, math, os, pathlib, re, subprocess, sys, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
TICKETS = ROOT / "scripts" / "foundry" / "tickets"
QUEUE_LOG = ROOT / "scripts" / "foundry" / "queue_log.json"
sys.path.insert(0, str(ROOT / "scripts" / "checks"))
REACH = 144


def words(n):
    return n.replace("_", " ")


def plural(n):
    w = words(n)
    return w if w.endswith("s") else w + "s"


def wanted_from_api(api, village):
    q = f"?village={village}" if village else ""
    with urllib.request.urlopen(f"{api}/wanted{q}", timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def wanted_from_file(path, village):
    cmd = ["node", str(ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs"), str(ROOT / "scripts" / "wanted.mts"), str(path)] + ([village] if village else []) + ["--json"]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, env={**os.environ, "MC_INNOVATE": os.environ.get("MC_INNOVATE", "on")})
    if r.returncode:
        raise SystemExit(f"wanted.mts failed: {r.stderr.strip()[:400]}")
    return json.loads(r.stdout)


def failed_before():
    """Capability ids the foundry already failed: the queue log's tickets whose newest report's outcome is not a pass."""
    out = {}
    log = json.loads(QUEUE_LOG.read_text(encoding="utf-8")) if QUEUE_LOG.exists() else []
    for e in log:
        reports = sorted(ROOT.glob(f"runs/*/foundry/{e['ticket']}/report.md"))
        if not reports:
            continue
        text = reports[-1].read_text(encoding="utf-8", errors="replace")
        m = re.search(r"^- outcome: (.+)$", text, re.M)
        outcome = m.group(1).replace("*", "").strip() if m else ""
        if outcome and not re.search(r"pass|merged", outcome, re.I):
            out[e["capability"]] = f"the foundry failed ticket {e['ticket']} ({reports[-1].relative_to(ROOT)}: {outcome[:80]})"
    return out


def land_counts(world, hut, blocks):
    """The capability's blocks in the saved land within REACH of the hut (region files; chunks saved only)."""
    import region_blocks as R  # noqa: E402
    W = R.World(str(world))
    cx0, cz0 = hut
    names = set(blocks)
    found = 0
    for cx in range((cx0 - REACH) >> 4, ((cx0 + REACH) >> 4) + 1):
        for cz in range((cz0 - REACH) >> 4, ((cz0 + REACH) >> 4) + 1):
            if math.hypot(cx * 16 + 8 - cx0, cz * 16 + 8 - cz0) > REACH + 12:
                continue
            secs = W.chunk(cx, cz)
            for pal, _ in (secs or {}).values():
                if names & set(pal):
                    found += 1
                    break
    return found


# The use_on_block template: an item used on a block in a state, the drops picked up (honeycomb, honey bottles, mud...)
BRIEF = """Add a foundry skill `{skill}` to the real-Minecraft world (Mineflayer), so a village member gets {yields_w} by using {tool_a} on {targets_w} {state_w}, and so the village's `activity` chore kind can run it from a library spec once members have researched it. This ticket was made by scripts/foundry_queue.py from village {village}'s wanted list (G6): {why}. THE GAME: {facts}. Foundry skills live one file each in server/src/mineflayer/foundry/ and export `FOUNDRY: FoundrySkill` (read foundry/types.ts: name, skill (an McSkill: check + run), tool (a ToolDef: name, a one-sentence description a model can act on, input_schema), activity (place, holds)); list it in foundry/list.ts (one import, and one entry inside the array before `].map(locked)`: keep `.map(locked)`, which locks a researched activity); edit no other table. THE SKILL `{skill}`, arguments: count ({yield0_w} wanted, default {count_default}, 1..{count_max}), x, y, z (optional: one {target0_w} to use it on, given by the activity adapter), radius (optional, default 48, at most 96: how far to look when x, y, z are not given). It needs {tool_a} in the inventory (fail with: 'no {tool_w}: withdraw one from storage'). Without x, y, z: find the nearest {targets_w} within radius in the state {state} with the project's nearestBlocks helper (mcUtil.ts; never bot.findBlocks: one event loop serves every bot, lessons 16 and 49), reading each block's state from bot.blockAt(pos).getProperties() (a block whose properties are missing is skipped), skipping blocks on any village's work ground (onVillageGround, lesson 30). For each target until count {yield0_w} are gathered: walk to a standable dry cell within 3 blocks horizontally of it, on the ground, from which the block is within reach (survival reach 4.5 blocks from the eyes; targets may hang 2-5 blocks above the ground on a tree trunk), with the project's walk helpers (mcUtil walk/reach, which keep the pathfinder off village work and protected ground; the walk must not dig or place: check walk's options); re-read the block's state on arrival (another member may have used it: skip it); equip the {tool_w}; look at the block's face toward the bot and use the item on it (bot.activateBlock(block) with the item held, as use_on does in mcSurvival.ts); wait up to 2 s for the state to change and pick up the dropped items (walk to item entities within 6 blocks); a target that gave nothing is not tried again in this call. Stop when count is reached, no target in the state is left in range, the {tool_w} breaks or runs out, or 3 minutes of wall time pass (divide by the game's tick-rate scale as other skills do with timeScale() from mcRules.ts). Count {yields_w} on the server before and after (CLAUDE.md: 'clear <name> <item> 0', the a.world.rcon.count helper as foundry/fish.ts and mcAnimals.ts use), not from Mineflayer's inventory view. Never break, place or change any block except the target's state change the use itself causes; never attack or lead a mob. Result message: 'got N {yield0_w} from K {target0_w}s at x,y,z (M more in the state within R blocks)' and why it stopped. Failure messages say what is short and what to do next (lesson 127): no {tool_w}; none of the {targets_w} within radius ('explore to find one'); all of them used ('{refill}; try later'). The skill must accept anything Mineflayer can pass it (a block unloaded or gone, an item entity gone, properties missing: lesson 104). THE ACTIVITY ADAPTER (activity.place, called inside the menu for every idle member: cheap and never throwing; ctx.hut is the storage hut's centre, none: {{why: 'no storage hut'}}): keep per village a list of the {targets_w} found within {reach} blocks of the hut, refreshed at most every 10 minutes by one nearestBlocks search from ctx.agent's bot (count up to 24); return {{x, y, z}} of the nearest one whose state, read now with ctx.agent.bot.blockAt (a cheap read of a loaded chunk), is {state}, else {{why: 'no {target0_w} in the state {state} within {reach} blocks of the storage hut ({refill})'}}; cache that answer 1 minute. activity.holds: one key per target block (`{id}:x,y,z`), so two members never walk to the same one. THE LIBRARY SPEC server/library/{id}.json (read server/src/library.ts: LibrarySpec, validateLibrarySpec and its `research` block): exactly this JSON: {spec_json}. Keep its research block as given: it makes the activity a locked innovation entry members unlock by research (tech.ts). THE LIVE CHECK scripts/checks/{id}.py (Python 3, standard library only, in the style of scripts/checks/fish.py and shear.py: urllib calls to the agent server API, mc/rcon.py through subprocess with the environment passed through so MC_SERVER_DIR picks the server; never default to the main world: if MCAI_API is not set, exit 2). The foundry starts the agent server with MC_INNOVATE=on before it runs the check. The check: find open, dry, level ground near the test site's centre (-1563, -36 on minevale3; read the ground with /api/block, away from any village plot: GET /api/village lists them); remove any agent Gus; build the target by RCON: a column of 3 oak_log from the ground up at a spot 3 blocks from Gus's cell, and `setblock` a {target0} with the state [{state},facing=<toward Gus>] against the column's side at its top (3 blocks above the ground; an empty nest: no bees); spawn Gus on the ground (brain idle, gamemode survival, reset true); give Gus {tool_give} by RCON; record the blocks of a box around them (radius 6, from 2 below the ground to 5 above, read with 'execute if block' or /api/block), leaving out the target cell; run `{skill} count {check_count} radius 16` through /api/agents/Gus/act, wait for action_done or action_failed (up to 4 minutes), then verify: at least {check_count} {yield0} on the server for Gus; the target is no longer in the state {state} (execute if block ... {target0}[{state}] fails); it is still a {target0}; no 'broke' or 'placed' event from Gus during the skill and no other cell of the box changed; then a second call `{skill} count 1 radius 16` (the target used) must fail or report that none is left in the state, within 2 minutes (not hang); then clear Gus's {tool_w} by RCON, setblock the target back to {state}, and a third call must fail with a message containing 'no {tool_w}'. Clean up (remove Gus, set the logs and the target to air) in a finally. Print one line per verification and end with exactly '{CHECK} OK' on success or '{CHECK} FAILED: <why>' and exit 1. Out of scope, no need to read: the HTTP server and panel (server/src/index.ts, api.ts, panel.ts, mineflayer/index.ts, mcApi.ts), mcWorld.ts (it already runs foundry activities from library specs), mcBuild.ts, tech.ts and lock.ts (they lock it already), the pathfinder's sources."""


# The skill-activity template (#91): a capability whose skill exists but no activity runs it (wool: shear_sheep), run
# at a place the adapter finds, as a locked library activity like honeycomb's
SKILL_BRIEF = """Add a foundry skill `{skill}` to the real-Minecraft world (Mineflayer): it runs the EXISTING skill `{base}` (exported in {base_set} from {base_file}; read its run function and arguments, change nothing in that file) at a place the activity adapter gives, so the village's `activity` chore kind can run {base} as a chore from a library spec once members have researched it. Members have asked for it: this ticket was made by scripts/foundry_queue.py from village {village}'s wanted list (G6, #91): {why}. THE GAME: {facts}. Foundry skills live one file each in server/src/mineflayer/foundry/ and export `FOUNDRY: FoundrySkill` (read foundry/types.ts: name, skill (an McSkill: check + run), tool (a ToolDef: name, a one-sentence description a model can act on, input_schema), activity (place, holds)); list it in foundry/list.ts (one import, and one entry inside the array before `].map(locked)`: keep `.map(locked)`, which locks a researched activity); edit no other table. Import the existing skill from its own file (`import {{ {base_set} }} from '../{base_mod}'`), never from mcSkills.ts (mcSkills.ts imports foundry/list.ts: a cycle). THE SKILL `{skill}`, arguments: x, y, z (where to go: given by the adapter), count ({yield0_w} wanted, default {count_default}, 1..{count_max}), radius (passed on to {base}, default 16, at most 32). It checks {tool_a} in the inventory first (fail with: 'no {tool_w}: withdraw one from storage'); walks to within 4 blocks of x, y, z with the project's walk helpers (mcUtil walk/reach, which keep the pathfinder off village work and protected ground; no digging or placing: check walk's options), giving up after 90 s of walking with a message that says where it got to; then calls {base_set}.{base}.run(a, {{ count, radius }}, signal) and returns its result message, prefixed with where it ran ('at x,y,z: ' + the message); a failure of {base} is passed on as it is (its messages already say what is short and what to do next). Count {yields_w} on the server before and after (the a.world.rcon.count helper, '#minecraft:wool' style tags where the base skill uses one), and put the number gained in the result. The skill must accept anything it is passed (missing or non-numeric x, y, z: fail 'no place given'; lesson 104). THE ACTIVITY ADAPTER (activity.place, called inside the menu for every idle member: cheap and never throwing; ctx.hut is the storage hut's centre, none: {{why: 'no storage hut'}}): {place_rule}; cache the answer per village for 1 minute. activity.holds: none (the spec's own key holds it to one member at a time). THE LIBRARY SPEC server/library/{id}.json (read server/src/library.ts: LibrarySpec, validateLibrarySpec and its `research` block): exactly this JSON: {spec_json}. Keep its research block as given: it makes the activity a locked innovation entry members unlock by research (tech.ts). THE LIVE CHECK scripts/checks/{id}.py (Python 3, standard library only, in the style of scripts/checks/shear.py and fish.py: urllib calls to the agent server API, mc/rcon.py through subprocess with the environment passed through so MC_SERVER_DIR picks the server; never default to the main world: if MCAI_API is not set, exit 2). The foundry starts the agent server with MC_INNOVATE=on before it runs the check. The check: {check_setup}; spawn Gus on the ground 8 blocks from that spot (brain idle, gamemode survival, reset true); give Gus {tool_give} by RCON; record the blocks of a box around Gus and the spot (every cell from 2 below the ground to 3 above, a radius covering both plus 4); run `{skill}` with x, y, z of the spot and `count {check_count}` through /api/agents/Gus/act; wait for action_done or action_failed (up to 4 minutes); then verify: at least {check_count} {yield0_w} more on the server for Gus ({count_cmd}); {check_alive}; no 'broke' or 'placed' event from Gus and no cell of the box changed; then clear Gus's {tool_w} by RCON, and a second call must fail with a message containing 'no {tool_w}'; and a call with no x must fail with 'no place given'. Clean up ({cleanup}, remove Gus) in a finally. Print one line per verification and end with exactly '{CHECK} OK' on success or '{CHECK} FAILED: <why>' and exit 1. Out of scope, no need to read: the HTTP server and panel (server/src/index.ts, api.ts, panel.ts, mineflayer/index.ts, mcApi.ts), mcWorld.ts (it already runs foundry activities from library specs), mcBuild.ts, tech.ts and lock.ts (they lock it already), the pathfinder's sources."""

ENTITY_PLACE = "from the atlas's animal sightings (ctx.agent.world.atlas.animals, a Map of uuid -> {{kind, x, y, z, t}}, mcAtlas.ts AnimalSighting), among sightings of kind {target0} within {reach} blocks of the hut seen in the last 30 minutes, the one with the most such sightings within 16 blocks of it (ties: the nearest the hut); return {{x, y, z}} of it; none: {{why: 'no {target0} seen within {reach} blocks of the storage hut (explore to find some)'}}"
ENTITY_SETUP = "find open, dry, level ground near the test site's centre (-1563, -36 on minevale3; read the ground with /api/block, away from any village plot: GET /api/village lists them); summon 4 adult {target0} there by RCON (/summon minecraft:{target0} x y z, with a tag of the check's own so it can count and remove them after); remove any agent Gus"


def base_skill(base):
    """The file and record exporting an existing skill (`  shear_sheep: {` inside `export const X_SKILLS`)."""
    for f in sorted((ROOT / "server" / "src" / "mineflayer").glob("*.ts")):
        text = f.read_text(encoding="utf-8", errors="replace")
        if re.search(rf"^\s+{re.escape(base)}: \{{", text, re.M):
            m = re.search(r"export const (\w+_SKILLS)\b", text)
            if m:
                return f.relative_to(ROOT).as_posix(), m.group(1)
    return None, None


def goods_for(w, y0):
    """The research's workshop goods: what members wished for that it opens first (#89), then the simplest it opens."""
    order = [i for i in (w.get("wished") or []) if i in (w.get("unlocks") or [])] + [i for i in (w.get("simplest") or []) if i not in (w.get("wished") or [])]
    out = []
    for item in order[:4]:
        out.append({"item": item, "target": 2, "batch": 1, "unit": 1, "words": plural(item),
                    "forWhat": f"{plural(item)} from the village's {words(y0)} (an invention of the village)"[:120], "allow": [y0]})
    return out


def skill_ticket_for(w, village, why):
    cid, base = w["id"], w["skill"]
    skill = w.get("activitySkill") or f"{base}_at"
    base_file, base_set = base_skill(base)
    if not base_file:
        return None, f"the skill {base} was not found in server/src/mineflayer/*.ts"
    if w["verb"] != "use_on_entity":
        return None, f"the skill-activity template places only entity targets so far, not {w['verb']}"
    tool = w.get("tool") or "nothing"
    y0, target0 = w["yields"][0], w["target"][0]
    goods = goods_for(w, y0)
    if not goods:
        return None, "nothing the workshop could make of its yield"
    also = [f"{c}_wool" for c in ("orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black")] if y0 == "white_wool" else []
    spec = {
        "id": f"lib:{cid}", "name": w["name"][:60], "skill": skill, "count": {"arg": "count", "max": 8},
        **({"needs": {tool: 1}} if tool != "nothing" else {}),
        "gives": [{"item": y} for y in w["yields"]], **({"also": also} if also else {}), "keep": 24,
        "effect": f"{words(y0)} for the workshop's {', '.join(plural(g['item']) for g in goods)}: what members wish for"[:160],
        "research": {
            "name": f"{words(base)} for {words(y0)}"[:40], "requires": {tool: 1} if tool != "nothing" else {"torch": 2}, "attempt": {"wheat": 2},
            "minutes": 3, "chance": 0.3, "complexity": 4, "capability": cid, "goods": goods,
        },
    }
    count_cmd = "count with RCON 'clear Gus #minecraft:wool 0' before and after" if y0.endswith("_wool") else f"count with RCON 'clear Gus minecraft:{y0} 0' before and after"
    fields = dict(
        skill=skill, base=base, base_set=base_set, base_file=base_file, base_mod=pathlib.PurePosixPath(base_file).stem, id=cid, village=village, why=why,
        facts=w.get("facts") or "", tool_a=("nothing" if tool == "nothing" else words(tool) if tool.endswith("s") else f"a {words(tool)}"), tool_w=words(tool),
        tool_give=f"1 {tool}", yields_w=" and ".join(words(y) for y in w["yields"]), yield0_w=words(y0), count_default=3, count_max=12, reach=REACH,
        place_rule=ENTITY_PLACE.format(target0=target0, reach=REACH), check_setup=ENTITY_SETUP.format(target0=target0),
        check_alive=f"all 4 tagged {target0} still alive (execute if entity @e[tag=...] count)", cleanup=f"kill the tagged {target0}",
        count_cmd=count_cmd, spec_json=json.dumps(spec, separators=(", ", ": ")), check_count=2, CHECK=cid.upper(),
    )
    t = {
        "id": cid,
        "title": f"{w['name']}: a {skill} activity running the existing {base}, locked until researched (from {village}'s wanted list, #91)",
        "brief": SKILL_BRIEF.format(**fields),
        "read": [
            "CLAUDE.md",
            "server/src/mineflayer/foundry/types.ts",
            "server/src/mineflayer/foundry/list.ts",
            "server/src/mineflayer/foundry/fish.ts (a foundry skill in the house style: guards, walks, server counts, the adapter)",
            f"{base_file}: only {base} (its run function and the helpers it calls) and the imports at the top",
            "server/src/library.ts",
            "server/src/mineflayer/mcSkills.ts: only the McSkill interface",
            "server/src/mineflayer/mcAtlas.ts: only AnimalSighting and the animals map",
            "server/src/mineflayer/mcUtil.ts: only walk, reach, sleep, checkAbort, at, num, syncInventory",
            "scripts/checks/shear.py (the style of a live check)",
            "mc/rcon.py",
            "docs/API.md: only the agent endpoints (/agents, /agents/:name/act, /agents/:name/events, /block) and GET /api/village",
        ],
        "lessons": [4, 13, 16, 29, 30, 31, 35, 44, 49, 79, 80, 102, 104, 105, 127, 145, 151],
        "deliver": [f"server/src/mineflayer/foundry/{cid}.ts", "server/src/mineflayer/foundry/list.ts", f"server/library/{cid}.json", f"scripts/checks/{cid}.py"],
        "may_touch": [],
        "check": {"file": f"scripts/checks/{cid}.py", "args": [], "timeout_min": 12, "pass": f"^{cid.upper()} OK",
                  "env": {"MC_INNOVATE": "on"}, "log_pass": rf"\[activity\] library: .*lib:{cid}\b"},
        "series": "scripts/foundry/series_base.json",
        "caps": {"minutes": 45, "turns": 500, "rounds": 3},
        "model": {"agy": "gemini-3.8-flash-high", "claude": "claude-opus-5-5"},
        "wanted": {"village": village, "rank": w["rank"], "value": w["value"], "demand": w["demand"], "demandShare": w.get("demandShare"), "why": w["why"]},
    }
    return t, None


# The mine template (#91's second): a block sealed underground that a pickaxe breaks for its drop (amethyst clusters in a
# geode), reached by a staircase the skill digs itself, as a locked library activity
MINE_BRIEF = """Add a foundry skill `{skill}` to the real-Minecraft world (Mineflayer), so a village member digs its own way down to {targets_w} sealed underground and mines them for {yields_w}, and so the village's `activity` chore kind can run it from a library spec once members have researched it. Members have asked for it: this ticket was made by scripts/foundry_queue.py from village {village}'s wanted list (G6, #91): {why}. THE GAME: {facts}. Foundry skills live one file each in server/src/mineflayer/foundry/ and export `FOUNDRY: FoundrySkill` (read foundry/types.ts: name, skill (an McSkill: check + run), tool (a ToolDef: name, a one-sentence description a model can act on, input_schema), activity (place, holds)); list it in foundry/list.ts (one import, and one entry inside the array before `].map(locked)`: keep `.map(locked)`, which locks a researched activity); edit no other table. THE SKILL `{skill}`, arguments: x, y, z (one {target0_w} to go for, given by the adapter), count ({yield0_w} wanted, default {count_default}, 1..{count_max}), radius (optional, default 32, at most 64: how far to look when x, y, z are not given). It needs a pickaxe in the inventory (any: wooden, stone, iron, diamond or netherite; fail with: 'no pickaxe: withdraw one from storage'). Without x, y, z: the nearest {target0_w} within radius, found with the project's nearestBlocks helper (mcUtil.ts; never bot.findBlocks: lessons 16 and 49). THE WAY DOWN: walk on the surface (mcUtil walk/reach, which keep off village work and protected ground) to a standable cell 3-6 blocks horizontally from the target's column, not within 8 blocks (x, z) of any village's ground (onVillageGround at the surface), then dig a staircase toward the target: each step digs the cell ahead at feet height, the one above it at head height, the one above that (three high, so the stairs can be walked back up without digging: climbing a step needs headroom above the head), and the one below it, and steps down one, by real digs with the pickaxe equipped (bot.dig; Paper times digs by the wall clock: never shorten digTime, lesson 40), never by command; turn toward the target as you go; once beside it, dig straight through what lies between you and the target (the shell: smooth basalt, calcite, amethyst blocks: these may be broken) but NEVER break {avoid_w} (step around it: dig a cell beside it instead) and never dig a cell with water, lava or a falling block (sand, gravel) next to it or above it: stop there and fail with what was found ('lava beside the way down at x,y,z: the tunnel stops there'). Read every cell before digging it (bot.blockAt; a cell not loaded or unknown is not dug). Inside, mine every {target0_w} within 4 blocks that the bot can reach (bot.dig on each, the pickaxe equipped; skip {avoid_w}) and pick up the drops (walk to item entities within 6 blocks), until count {yield0_w} are gathered or none is left within reach. Then climb back up your own staircase to the surface (walk; the stairs you dug are free cells). At most 48 cells dug in a call and 5 minutes of wall time (divide by the game's tick-rate scale as other skills do with timeScale() from mcRules.ts): past either, stop, climb out and report. Place no block; dig nothing but the staircase, the way through the shell and the {targets_w}. Count {yields_w} on the server before and after (the a.world.rcon.count helper, as foundry/fish.ts and mcAnimals.ts use). Read server/src/mineflayer/mcMine.ts's digCell, unsafe and digIronStairs for how the village's mine digs safely (do not import them: they are private and tied to the village's mine; write your own small versions in this file). Result message: 'got N {yield0_w} from K {target0_w}s at x,y,z (M left within 4 blocks; dug D cells; back at x,y,z)' and why it stopped. Failure messages say what is short and what to do next (lesson 127): no pickaxe; none of the {targets_w} within radius ('explore to find a geode'); the way down blocked (water, lava, sand above: 'try another one'); the pickaxe broke ('withdraw another'). The skill must accept anything Mineflayer can pass it (a block unloaded or gone, an item entity gone, the bot falling into the hollow: lesson 104); falling does no damage in this world. THE ACTIVITY ADAPTER (activity.place, called inside the menu for every idle member: cheap and never throwing; ctx.hut is the storage hut's centre, none: {{why: 'no storage hut'}}): keep per village a list of the {targets_w} found within {reach} blocks of the hut, refreshed at most every 10 minutes by one nearestBlocks search from ctx.agent's bot (count up to 24), leaving out any within 8 blocks (x, z) of a village's ground; return {{x, y, z}} of the nearest one still a {target0} when read now (bot.blockAt; a cheap read of a loaded chunk), else {{why: 'no {target0_w} known within {reach} blocks of the storage hut away from the village (explore to find a geode)'}}; cache that answer 1 minute. activity.holds: one key per target's geode, `{id}:` and the target's x, y, z rounded down to a multiple of 16, so two members never dig toward the same geode. THE LIBRARY SPEC server/library/{id}.json (read server/src/library.ts: LibrarySpec, validateLibrarySpec and its `research` block): exactly this JSON: {spec_json}. Keep its research block as given: it makes the activity a locked innovation entry members unlock by research (tech.ts). THE LIVE CHECK scripts/checks/{id}.py (Python 3, standard library only, in the style of scripts/checks/fish.py and shear.py: urllib calls to the agent server API, mc/rcon.py through subprocess with the environment passed through so MC_SERVER_DIR picks the server; never default to the main world: if MCAI_API is not set, exit 2). The foundry starts the agent server with MC_INNOVATE=on before it runs the check. The check: find open, dry, level ground near the test site's centre (-1563, -36 on minevale3; read the ground with /api/block, away from any village plot: GET /api/village lists them); build a small geode by RCON 10 blocks below the ground there, 6 blocks horizontally from Gus's spot: `fill` a 7x7x7 cube of smooth_basalt, then a 5x5x5 of calcite inside it, then a 3x3x3 of amethyst_block inside that, then hollow its centre (the single middle cell, air), and set one cell of the lining to budding_amethyst and put 2 {target0} in the hollow's air against the lining (setblock with facing away from the lining it stands on); spawn Gus on the ground (brain idle, gamemode survival, reset true); give Gus 1 {tool} by RCON; record the blocks of a box covering the geode and Gus's spot, plus 4 on every side (read with 'execute if block' or /api/block), and of the corridor (the box between Gus's spot and the geode, both included, widened by 1); run `{skill}` with x, y, z of one {target0} and `count {check_count}` through /api/agents/Gus/act; wait for action_done or action_failed (up to 6 minutes); then verify: at least {check_count} {yield0_w} more on the server for Gus ({count_cmd}); the budding_amethyst is still there; no 'placed' event from Gus; no cell of the big box changed outside the corridor and the geode; Gus stands within 3 blocks of the ground's height (it climbed out); then a second call with x, y, z of a {target0} cell now mined must fail or report none left, within 3 minutes; then clear Gus's pickaxes by RCON, and a third call must fail with a message containing 'no pickaxe'. Clean up (remove Gus) in a finally (the foundry restores the site before every check). Print one line per verification and end with exactly '{CHECK} OK' on success or '{CHECK} FAILED: <why>' and exit 1. Out of scope, no need to read: the HTTP server and panel (server/src/index.ts, api.ts, panel.ts, mineflayer/index.ts, mcApi.ts), mcWorld.ts (it already runs foundry activities from library specs), mcBuild.ts, tech.ts and lock.ts (they lock it already), the pathfinder's sources."""


def mine_ticket_for(w, village, why):
    cid, skill = w["id"], w.get("activitySkill") or f"harvest_{w['id']}"
    tool = w.get("tool") or "stone_pickaxe"
    y0, target0 = w["yields"][0], w["target"][0]
    goods = goods_for(w, y0)
    if not goods:
        return None, "nothing the workshop could make of its yield"
    spec = {
        "id": f"lib:{cid}", "name": w["name"][:60], "skill": skill, "count": {"arg": "count", "max": 8},
        "needs": {tool: 1}, "gives": [{"item": y} for y in w["yields"]], "keep": 16,
        "effect": f"{words(y0)} for the workshop's {', '.join(plural(g['item']) for g in goods)}: what members wish for"[:160],
        "research": {
            "name": f"mining {words(y0)} in geodes"[:40], "requires": {tool: 1}, "attempt": {"torch": 2},
            "minutes": 3, "chance": 0.3, "complexity": 5, "capability": cid, "goods": goods,
        },
    }
    fields = dict(
        skill=skill, id=cid, village=village, why=why, facts=w.get("facts") or "", yields_w=" and ".join(words(y) for y in w["yields"]),
        yield0_w=words(y0), targets_w=" or ".join(plural(t) for t in w["target"]), target0=target0, target0_w=words(target0),
        avoid_w=" or ".join(words(b) for b in (w.get("avoid") or [])) or "anything outside the way", tool=tool, count_default=4, count_max=16,
        reach=REACH, spec_json=json.dumps(spec, separators=(", ", ": ")), check_count=2, CHECK=cid.upper(),
        count_cmd=f"count with RCON 'clear Gus minecraft:{y0} 0' before and after",
    )
    t = {
        "id": cid,
        "title": f"{w['name']}: a {skill} skill that digs its own way to them, with an activity adapter, locked until researched (from {village}'s wanted list, #91)",
        "brief": MINE_BRIEF.format(**fields),
        "read": [
            "CLAUDE.md",
            "server/src/mineflayer/foundry/types.ts",
            "server/src/mineflayer/foundry/list.ts",
            "server/src/mineflayer/foundry/fish.ts (a foundry skill in the house style: guards, walks, server counts, the adapter)",
            "server/src/mineflayer/foundry/honeycomb.ts: only its activity adapter (a cached block list per village)",
            "server/src/mineflayer/mcMine.ts: only digCell, unsafe and digIronStairs (how the mine digs safely)",
            "server/src/library.ts",
            "server/src/mineflayer/mcSkills.ts: only the McSkill interface",
            "server/src/mineflayer/mcUtil.ts: only walk, reach, standableY, nearestBlocks, onVillageGround, sleep, checkAbort, countItem, itemId, at, num, syncInventory",
            "server/src/mineflayer/mcRules.ts: only timeScale",
            "scripts/checks/fish.py (the style of a live check)",
            "mc/rcon.py",
            "docs/API.md: only the agent endpoints (/agents, /agents/:name/act, /agents/:name/events, /block) and GET /api/village",
        ],
        "lessons": [4, 13, 16, 29, 30, 31, 35, 40, 44, 49, 79, 80, 102, 104, 105, 127, 145, 151],
        "deliver": [f"server/src/mineflayer/foundry/{cid}.ts", "server/src/mineflayer/foundry/list.ts", f"server/library/{cid}.json", f"scripts/checks/{cid}.py"],
        "may_touch": [],
        "check": {"file": f"scripts/checks/{cid}.py", "args": [], "timeout_min": 15, "pass": f"^{cid.upper()} OK",
                  "env": {"MC_INNOVATE": "on"}, "log_pass": rf"\[activity\] library: .*lib:{cid}\b"},
        "series": "scripts/foundry/series_base.json",
        "caps": {"minutes": 45, "turns": 500, "rounds": 3},
        "model": {"agy": "gemini-3.8-flash-high", "claude": "claude-opus-5-5"},
        "wanted": {"village": village, "rank": w["rank"], "value": w["value"], "demand": w["demand"], "demandShare": w.get("demandShare"), "why": w["why"]},
    }
    return t, None


def ticket_for(w, village, why):
    if w["status"] == "skill":
        return skill_ticket_for(w, village, why)
    if w["verb"] == "mine":
        return mine_ticket_for(w, village, why)
    return block_ticket_for(w, village, why)


def block_ticket_for(w, village, why):
    cid = w["id"]
    skill = w["skill"]
    tool = w.get("tool") or "nothing"
    y0 = w["yields"][0]
    target0 = w["target"][0]
    state = w.get("state") or ""
    goods = []
    for item in (w.get("simplest") or [])[:2]:
        goods.append({"item": item, "target": 2, "batch": 1, "unit": 1, "words": plural(item),
                      "forWhat": f"{plural(item)} from the village's {words(y0)} (an invention of the village)", "allow": [y0]})
    if not goods:
        return None, "nothing the workshop could make of its yield (no research goods for the menu's words)"
    tool_used_up = tool in ("glass_bottle", "potion", "wheat_seeds", "bucket")
    research_name = f"harvesting {words(y0)} from {plural(target0)}"[:40]
    spec = {
        "id": f"lib:{cid}", "name": w["name"][:60], "skill": skill,
        "count": {"arg": "count", "max": 6},
        **({"needs": {tool: 4 if tool_used_up else 1}} if tool != "nothing" else {}),
        "gives": [{"item": y} for y in w["yields"]],
        "keep": 16,
        "effect": f"{words(y0)} for the workshop's {', '.join(plural(g['item']) for g in goods)}; {len(w.get('unlocks') or [])} items need it"[:160],
        "research": {
            "name": research_name, "requires": {tool: 1} if tool != "nothing" else {"torch": 2}, "attempt": {"torch": 2},
            "minutes": 3, "chance": 0.3, "complexity": 4, "capability": cid, "goods": goods,
        },
    }
    refill = "bees refill them over minutes" if target0 in ("bee_nest", "beehive") else "they refill over time"
    fields = dict(
        skill=skill, id=cid, village=village, why=why, facts=w.get("facts") or "", tool_a=("nothing" if tool == "nothing" else words(tool) if tool.endswith("s") else f"a {words(tool)}"),
        tool_w=words(tool), tool_give=f"{4 if tool_used_up else 1} {tool}", yields_w=" and ".join(words(y) for y in w["yields"]),
        yield0=y0, yield0_w=words(y0), targets_w=" or ".join(plural(t) for t in w["target"]), target0=target0, target0_w=words(target0),
        state=state, state_w=f"in the state {state}" if state else "", count_default=3, count_max=12, reach=REACH, refill=refill,
        spec_json=json.dumps(spec, separators=(", ", ": ")), check_count=1, CHECK=cid.upper(),
    )
    t = {
        "id": cid,
        "title": f"{w['name']}: a {skill} skill with an activity adapter, locked until researched (from {village}'s wanted list, G6)",
        "brief": BRIEF.format(**fields),
        "read": [
            "CLAUDE.md",
            "server/src/mineflayer/foundry/types.ts",
            "server/src/mineflayer/foundry/list.ts",
            "server/src/mineflayer/foundry/fish.ts (a foundry skill in the house style: guards, walks, server counts, the adapter)",
            "server/src/library.ts",
            "server/src/mineflayer/mcSkills.ts: only the McSkill interface",
            "server/src/mineflayer/mcSurvival.ts: only use_on (search 'use_on: {') and the imports at the top",
            "server/src/mineflayer/mcUtil.ts: only walk, reach, standableY, nearestBlocks, onVillageGround, sleep, checkAbort, countItem, itemId, at, num, syncInventory",
            "server/src/mineflayer/mcRules.ts: only timeScale",
            "scripts/checks/fish.py (the style of a live check)",
            "mc/rcon.py",
            "docs/API.md: only the agent endpoints (/agents, /agents/:name/act, /agents/:name/events, /block) and GET /api/village",
        ],
        "lessons": [4, 13, 16, 29, 30, 31, 35, 40, 44, 49, 79, 80, 102, 104, 105, 127, 145, 151],
        "deliver": [f"server/src/mineflayer/foundry/{cid}.ts", "server/src/mineflayer/foundry/list.ts", f"server/library/{cid}.json", f"scripts/checks/{cid}.py"],
        "may_touch": [],
        "check": {"file": f"scripts/checks/{cid}.py", "args": [], "timeout_min": 12, "pass": f"^{cid.upper()} OK",
                  "env": {"MC_INNOVATE": "on"}, "log_pass": rf"\[activity\] library: .*lib:{cid}\b"},
        "series": "scripts/foundry/series_base.json",
        "caps": {"minutes": 45, "turns": 500, "rounds": 3},
        "model": {"agy": "gemini-3.8-flash-high", "claude": "claude-opus-5-5"},
        "wanted": {"village": village, "rank": w["rank"], "value": w["value"], "demand": w["demand"], "why": w["why"]},
    }
    return t, None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default=os.environ.get("MCAI_API"))
    ap.add_argument("--villages")
    ap.add_argument("--village")
    ap.add_argument("--min-samples", type=int, default=0)
    ap.add_argument("--land")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--capability")
    ap.add_argument("--accepted")
    ap.add_argument("--wanted")
    a = ap.parse_args()
    if a.accepted:
        acc = json.loads(pathlib.Path(a.accepted).read_text(encoding="utf-8"))
        ticketed = {p.stem for p in TICKETS.glob("*.json")}
        cands = [x for x in acc if x.get("route") == "foundry" and x.get("capability") and x["capability"] not in ticketed]
        if not cands:
            print(f"QUEUE: no accepted proposal routed to the foundry without a ticket in {a.accepted}")
            return 0
        a.capability = cands[0]["capability"]
        print(f"accepted proposal {cands[0].get('id')} ({cands[0].get('by')}: {str(cands[0].get('what'))[:80]}) asks for {a.capability}")
    if not a.villages and not a.api and not a.wanted:
        raise SystemExit("give --api URL (or MCAI_API), --villages FILE or --wanted FILE")
    if a.wanted:
        saved = json.loads(pathlib.Path(a.wanted).read_text(encoding="utf-8"))
        name = a.village or next(iter(saved.get("villages", {})), None)
        got = [{"village": name, "at": saved.get("at"), "list": saved["villages"][name], "history": (saved.get("history") or {}).get(name)}] if name in saved.get("villages", {}) else []
        # (the run's own rank, demand and wishes; the capability's fields as the code has them now: a saved list may be
        # older than a template or a tool added since)
        fresh = {w["id"]: w for w in wanted_from_file(ROOT / "mc" / "testcheckpoints" / "mv3_grown25" / "villages.json", None)[0]["list"]}
        for w in (got[0]["list"] if got else []):
            f = fresh.get(w["id"])
            if f and f["status"] == w["status"]:
                for k in ("verb", "target", "state", "tool", "facts", "find", "avoid", "skill", "activitySkill", "ticketable"):
                    if k in f:
                        w[k] = f[k]
    else:
        got = wanted_from_file(a.villages, a.village) if a.villages else wanted_from_api(a.api.rstrip("/"), a.village)
    if not got:
        raise SystemExit("no complete village in the wanted list")
    entry = got[0]
    village, lst, history = entry["village"], entry["list"], entry.get("history") or {}
    src = a.wanted or a.villages or a.api
    print(f"wanted list of {village} ({src}): {len(lst)} capabilities")
    # (the village's land: its storage hut from the record, its world from the agent server's folder)
    vrec = None
    vfile = pathlib.Path(a.villages) if a.villages else (pathlib.Path(os.environ["MC_SERVER_DIR"]) / "villages.json" if os.environ.get("MC_SERVER_DIR") else None)
    if vfile and not vfile.is_absolute():
        vfile = ROOT / vfile
    if vfile and vfile.exists():
        data = json.loads(vfile.read_text(encoding="utf-8"))
        vrec = next((v for v in (data["villages"] if isinstance(data, dict) else data) if v["name"] == village), None)
    hut = None
    if vrec and vrec.get("storageHut"):
        h = vrec["storageHut"]
        hut = ((h["x1"] + h["x2"]) // 2, (h["z1"] + h["z2"]) // 2)
    land = pathlib.Path(a.land) if a.land else (pathlib.Path(os.environ["MC_SERVER_DIR"]) / "world" if os.environ.get("MC_SERVER_DIR") else ROOT / "mc" / "testworld" / "world")
    if not land.is_absolute():
        land = ROOT / land
    have = {p.stem for p in TICKETS.glob("*.json")}
    failed = failed_before()
    chosen, skipped = None, []
    if a.capability:
        lst = [w for w in lst if w["id"] == a.capability]
        if not lst:
            raise SystemExit(f"QUEUE: no capability {a.capability} in the wanted list")
    for w in lst:
        cid = w["id"]
        why_not = None
        if not w["ticketable"]:
            why_not = {"have": "the village has it", "locked": w.get("reason") or "built, locked until researched",
                       "dead": f"a peaceful overworld cannot give it: {w.get('reason')}", "user": f"the user's call: {w.get('reason')}",
                       "knowledge": f"a table fix, not a ticket: {w.get('reason')}"}.get(w["status"]) or f"no ticket template for its verb {w['verb']}"
        elif cid in have:
            why_not = f"a ticket exists (scripts/foundry/tickets/{cid}.json)"
        elif cid in failed:
            why_not = failed[cid]
        elif a.min_samples and (history.get("top", {}).get(cid, {}).get("samples", 0) < a.min_samples):
            why_not = f"in the top 3 {history.get('top', {}).get(cid, {}).get('samples', 0)} times, fewer than {a.min_samples}"
        elif w.get("find") and hut and land.exists():
            n = land_counts(land, hut, w["find"])
            if not n:
                why_not = f"no {' or '.join(w['find'])} within {REACH} of the storage hut in {land.relative_to(ROOT) if ROOT in land.parents else land}"
            else:
                w["_land"] = f"{n} chunks within {REACH} of the hut hold {' or '.join(w['find'])}"
        if why_not:
            skipped.append((cid, w["rank"], why_not))
            continue
        chosen = w
        break
    for cid, rank, why_not in skipped:
        print(f"  skip {cid} (rank {rank}): {why_not}")
    if not chosen:
        print("QUEUE: nothing to ticket")
        return 0
    why = "; ".join(chosen["why"] + ([chosen["_land"]] if chosen.get("_land") else [])) or "it opens items nothing else gives"
    t, err = ticket_for(chosen, village, why)
    if not t:
        print(f"QUEUE: {chosen['id']} chosen (rank {chosen['rank']}) but no ticket: {err}")
        return 1
    path = TICKETS / f"{t['id']}.json"
    print(f"  chose {chosen['id']} (rank {chosen['rank']}, value {chosen['value']}, demand {chosen['demand']}): {why}")
    if a.json:
        print(json.dumps(t, indent=1))
    if not a.write:
        print(f"QUEUE: would write {path.relative_to(ROOT)} (dry run; --write to write it)")
        return 0
    path.write_text(json.dumps(t, indent=1) + "\n", encoding="utf-8")
    log = json.loads(QUEUE_LOG.read_text(encoding="utf-8")) if QUEUE_LOG.exists() else []
    log.append({"at": time.strftime("%Y-%m-%d %H:%M"), "ticket": t["id"], "capability": chosen["id"], "village": village, "source": src,
                "rank": chosen["rank"], "value": chosen["value"], "demand": chosen["demand"], "why": chosen["why"],
                "skipped": [{"id": c, "rank": r, "why": y} for c, r, y in skipped]})
    QUEUE_LOG.write_text(json.dumps(log, indent=1) + "\n", encoding="utf-8")
    print(f"QUEUE: wrote {path.relative_to(ROOT)}; logged in {QUEUE_LOG.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
