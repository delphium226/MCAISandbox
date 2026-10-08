"""Run a village: one mayor plus workers, all tiered agents, until the mayor declares the objective complete, the run
stalls (no successful action for MCAI_STALL_MIN minutes, default 3), an agent fails the same way 3 times, or time runs out. Agents are in creative mode unless
MCAI_GAMEMODE=survival (real Minecraft's village economy: materials are gathered, stored and paid for).

Usage: python scripts/watch_village.py VILLAGE X Z WORKERS MAX_MINUTES "objective" [WORKER_PLANNER] [SITE_SIZE]
Starts near X,Z: the Mayor (as an idle agent) first searches outward from there for dry land with room for a SITE_SIZE plot (default 30);
MCAI_NO_PROBE=1 starts the village at X,Z itself instead (scouting tests).
WORKER_PLANNER defaults to gemma4:31b. Other models: MCAI_MAYOR_MODEL (the mayor's planner), MCAI_DESIGN_MODEL (the
architect) and MCAI_EXEC_MODEL (every executor), e.g. MCAI_MAYOR_MODEL=ollama:gpt-oss:120b-cloud.
"""
import json, os, math, re, subprocess, sys, time, urllib.error, urllib.request

# Chat and model text can hold any character; the Windows console encoding cannot
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
API = os.environ.get("MCAI_API", "http://localhost:8765/api")  # real Minecraft: http://localhost:8766/api
village, x, z, workers, minutes, objective = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
worker_planner = sys.argv[7] if len(sys.argv) > 7 else "ollama:gemma4:31b"
site_size = int(sys.argv[8]) if len(sys.argv) > 8 else 30
mayor_planner = os.environ.get("MCAI_MAYOR_MODEL", "ollama:gemma4:31b")
gamemode = os.environ.get("MCAI_GAMEMODE", "creative")
stall_minutes = float(os.environ.get("MCAI_STALL_MIN", "3"))
same_fail = int(os.environ.get("MCAI_SAME_FAIL", "3"))
# Minutes to keep watching after completion (opportunistic farming, 10-08): the chores, no stall or same-fail rule
after = float(os.environ.get("MCAI_AFTER", "0"))
BASE = {"execModel": os.environ.get("MCAI_EXEC_MODEL", "ollama:qwen3:30b-instruct"),
        "designModel": os.environ.get("MCAI_DESIGN_MODEL", "ollama:gemma4:31b"), "buildSpeed": 4}


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method)
    # A slow reply (the agent server busy for a few seconds) is retried rather than ending the run
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read() or "null")
        except (TimeoutError, urllib.error.URLError) as e:
            if isinstance(e, urllib.error.HTTPError) or attempt == 3:
                raise
            time.sleep(5)


def bring_player(agent):
    """If the watching player (MCAI_PLAYER, default SausageOfDoom4) is in the game, teleport them to the agent."""
    player = os.environ.get("MCAI_PLAYER", "SausageOfDoom4")
    rc = [sys.executable, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mc", "rcon.py")]
    try:
        online = subprocess.run(rc + ["list"], capture_output=True, text=True, timeout=10).stdout
        if player and player in online:
            print(subprocess.run(rc + [f"tp {player} {agent}"], capture_output=True, text=True, timeout=10).stdout.strip(), flush=True)
    except Exception as e:
        print(f"could not bring {player} to {agent}: {e}", flush=True)


def spawn_heights(site):
    """Where each agent stands at the site (x + 2i, z): one above the highest ground with two blocks of air over it, not
    leaves, logs or water, read while the probe keeps the chunks loaded. A fixed y 90 spawned Minevale2's agents inside a
    hill at y 100: the workers suffocated and respawned at the world spawn, 900 blocks away (F84). None where unknown."""
    sx, sz, y0 = int(site["x"]), int(site["z"]), int(site.get("y", 70))
    try:
        b = call(f"/blocks?x1={sx}&y1={y0 - 16}&z1={sz}&x2={sx + 2 * workers}&y2={y0 + 32}&z2={sz}")
    except urllib.error.HTTPError:
        return None
    w = b["x2"] - b["x1"] + 1
    # Open: air and the plants one stands in; passed over: tree crowns and plants one cannot stand on or in
    open_ = lambda n: n in ("air", "cave_air", "snow") or bool(re.search(r"grass$|fern$|flower|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily_of|dead_bush|vine", n)) and n != "grass_block"
    out = []
    for i in range(workers + 1):
        col = [b["cells"][(y - b["y1"]) * w + 2 * i] for y in range(b["y1"], b["y2"] + 1)]
        names = [b["names"][c] if c >= 0 else None for c in col]
        found = None
        # Down from the top past air, plants and tree crowns to the first ground: there, or nowhere (under a trunk or in
        # water the server's surface spawn is better than a cave below)
        for k in range(len(names) - 3, -1, -1):
            n = names[k]
            if n is None or open_(n) or re.search(r"leaves|_log$|cactus|bamboo|sugar_cane", n):
                continue
            if not re.search(r"water|lava", n) and all(m and open_(m) for m in names[k + 1:k + 3]):
                found = b["y1"] + k + 1
            break
        out.append(found)
    return out


def find_land(x, z):
    """Search outward from x,z (rings of 8 points, 120 blocks apart) for room to build."""
    points = [(x, z)] + [(x + r * math.cos(a * math.pi / 4), z + r * math.sin(a * math.pi / 4)) for r in (120, 240) for a in range(8)]
    for px, pz in points:
        try:
            call("/agents/Mayor", method="DELETE")
        except urllib.error.HTTPError:
            pass
        # No height: the server puts it on the surface (y 90 put it inside hills)
        call("/agents", {"name": "Mayor", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": px + 0.5, "z": pz + 0.5}})
        time.sleep(10)
        call("/agents/Mayor/act", {"action": "find_site", "size": site_size})
        # find_site takes a few seconds, more when it walks farther out (to atlas candidates: up to 300 blocks, step 2.3)
        for _ in range(300):
            time.sleep(1)
            result = [e for e in call("/agents/Mayor/events?since=0") if e["type"] in ("action_done", "action_failed")]
            if result:
                break
        site = call("/agents/Mayor/memory").get("lastSite")
        ground = spawn_heights(site) if site else None
        call("/agents/Mayor", method="DELETE")
        # Survival villages need trees near them (Accept7's desert site had none within 112 blocks)
        treeless = gamemode == "survival" and result and any(w in result[-1]["text"] for w in ("No trees within 48 blocks", "too few trees"))
        if result and result[-1]["type"] == "action_done" and site and not treeless:
            print(f"land found near {px:.0f},{pz:.0f}: {result[-1]['text'][:120]}", flush=True)
            # The village starts at the site found, not at the probe point (Accept17's mayor spawned 100 blocks from the
            # site, stuck in a hollow, and spent the run walking)
            return site["x"], site["z"], ground
        print(f"no room near {px:.0f},{pz:.0f}: {result[-1]['text'][60:200] if result else 'no result'}", flush=True)
    raise SystemExit("no land found")


# MCAI_NO_PROBE=1: start the village at X,Z itself, poor land or not (scouting tests, plan step 2.4): the agents get the
# server's surface spawn there
x, z, ground = (x, z, None) if os.environ.get("MCAI_NO_PROBE") == "1" else find_land(x, z)
call("/village", {"name": village, "objective": objective})
names = ["Mayor"] + [f"Worker{i + 1}" for i in range(workers)]
for i, n in enumerate(names):
    mem = {**BASE, "village": village, "planModel": mayor_planner if i == 0 else worker_planner, **({"villageRole": "mayor"} if i == 0 else {})}
    try:
        call("/agents", {"name": n, "role": "mayor" if i == 0 else "builder", "brain": "tiered", "gamemode": gamemode, "reset": True,
                         "position": {"x": x + 0.5 + 2 * i, **({"y": ground[i]} if ground and ground[i] is not None else {}), "z": z + 0.5}, "memory": mem})
    except urllib.error.HTTPError as e:
        print(f"{n}: {e.code} {e.read()[:100]}")
bring_player("Mayor")
print(f"spawned {', '.join(names)} in village {village}; mayor plans with {mayor_planner}, workers with {worker_planner}, "
      f"designs by {BASE['designModel']}, executors {BASE['execModel']}, {gamemode}", flush=True)

t0, seen, board, reason, chats = time.time(), {n: 0 for n in names}, "", "time limit", 0
last_done = time.time()
fails = {}
stamp = lambda: f"{(time.time() - t0) / 60:4.1f}m"
while time.time() - t0 < minutes * 60:
    time.sleep(5)
    for n in names:
        try:
            events = call(f"/agents/{n}/events?since={seen[n]}")
        except urllib.error.HTTPError:
            continue
        for e in events:
            seen[n] = e["id"]
            if e["type"] == "chat":
                chats += 1
            elif e["type"] in ("action_done", "action_failed", "system"):
                # Failures and finished builds in full (their reasons are at the end); the rest shortened
                full = e["type"] == "action_failed" or e["text"].startswith("build_design finished")
                print(f"{stamp()} {n:8} {e['type']:13} | {e['text'] if full else e['text'][:220]}", flush=True)
                # Progress also counts: brain tools (designs, the layout) report as system events
                if e["type"] == "action_done" or (e["type"] == "system" and re.search(r"saved|Laid out|Posted tasks", e["text"])):
                    last_done = time.time()
                # (a busy mine is no stuck agent: the gathering Mayor, a third miner, hands its task back for later, V2.3m)
                if e["type"] == "action_failed" and "the mine is busy" not in e["text"]:
                    k = (n, e["text"][:80])
                    fails[k] = fails.get(k, 0) + 1
                    if fails[k] >= same_fail:
                        reason = f"{n} failed the same way {same_fail} times: {e['text'][:160]}"
    v = call(f"/village/{village}")
    b = " ".join(f"{t['id']}:{t['status']}{'/' + t['claimedBy'] if t.get('claimedBy') else ''}" for t in v["tasks"])
    if b != board:
        board = b
        print(f"{stamp()} BOARD {b}", flush=True)
    if reason != "time limit":
        break
    if v.get("complete"):
        reason = "objective declared complete"
        break
    if time.time() - last_done > stall_minutes * 60:
        reason = f"stalled: no successful action for {stall_minutes:g} minutes"
        break

if after and reason == "objective declared complete":
    print(f"{stamp()} COMPLETE; watching {after:g} min more (MCAI_AFTER)", flush=True)
    t2, slots_seen, explore_seen = time.time(), {}, None
    while time.time() - t2 < after * 60:
        time.sleep(5)
        for n in names:
            try:
                events = call(f"/agents/{n}/events?since={seen[n]}")
            except urllib.error.HTTPError:
                continue
            for e in events:
                seen[n] = e["id"]
                if e["type"] in ("action_done", "action_failed"):
                    print(f"AFTER {(time.time() - t2) / 60:4.1f}m {n:8} {e['type']:13} | {e['text'][:300]}", flush=True)
        v = call(f"/village/{village}")
        for k, lay in enumerate(v.get("layouts") or []):
            for j, sl in enumerate(lay.get("slots") or []):
                t = f"{sl.get('kind') or 'free'} planted={sl.get('planted')} harvests={sl.get('harvests')} tries={sl.get('tries')}"
                if slots_seen.get((k, j)) != t:
                    slots_seen[(k, j)] = t
                    print(f"AFTER {(time.time() - t2) / 60:4.1f}m SLOT {k + 1}.{j + 1}: {t}", flush=True)
        if v.get("explore") != explore_seen:
            explore_seen = v.get("explore")
            print(f"AFTER {(time.time() - t2) / 60:4.1f}m EXPLORE {json.dumps(explore_seen)[:300]}", flush=True)
    reason += f", then {after:g} min after"

v = call(f"/village/{village}")
print(f"\nSTOPPED after {(time.time() - t0) / 60:.1f}m ({reason}); {chats} chat messages heard")
print("TASKS")
for t in v["tasks"]:
    print(f"  {t['id']} [{t['status']}{'/' + t['claimedBy'] if t.get('claimedBy') else ''}] {t['title']}: {t['detail'][:140]}")
print("DESIGNS", [(d["name"], f"{d['width']}x{d['depth']}x{d['height']}") for d in v["designs"].values()])
print("PLOTS", [(p["id"], p["x1"], p["x2"], p["z1"], p["z2"], p["y"]) for p in v["plots"]])
storage = {}
for c in (v.get("storage") or {}).get("chests", []):
    for k, q in c["items"].items():
        storage[k] = storage.get(k, 0) + q
print("STORAGE", storage)
print("STRUCTURES", [(s["kind"], s["x1"], s["x2"], s["z1"], s["z2"], s["builtBy"]) for s in v["structures"]])
for n in names:
    try:
        st = call(f"/agents/{n}/memory").get("stats") or {}
        print(f"STATS {n}: plan {st.get('planCalls', 0)}x{st.get('planMsAvg', 0)}ms, exec {st.get('execCalls', 0)}x{st.get('execMsAvg', 0)}ms, done {st.get('actionsDone', 0)}, failed {st.get('actionsFailed', 0)}, designs {st.get('designs', 0)}, refused {st.get('repeatsRefused', 0)}")
    except urllib.error.HTTPError:
        pass
