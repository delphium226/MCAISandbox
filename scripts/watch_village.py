"""Run a village: one mayor plus workers, all tiered agents, until the mayor declares the objective complete, the run
stalls (no successful action for MCAI_STALL_MIN minutes, default 3), an agent fails the same way 3 times, or time runs out. Agents are in creative mode unless
MCAI_GAMEMODE=survival (real Minecraft's village economy: materials are gathered, stored and paid for).

Usage: python scripts/watch_village.py VILLAGE X Z WORKERS MAX_MINUTES "objective" [WORKER_PLANNER] [SITE_SIZE]
Starts near X,Z: the Mayor (as an idle agent) first searches outward from there for dry land with room for a SITE_SIZE plot (default 30).
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


def find_land(x, z):
    """Search outward from x,z (rings of 8 points, 120 blocks apart) for room to build."""
    points = [(x, z)] + [(x + r * math.cos(a * math.pi / 4), z + r * math.sin(a * math.pi / 4)) for r in (120, 240) for a in range(8)]
    for px, pz in points:
        try:
            call("/agents/Mayor", method="DELETE")
        except urllib.error.HTTPError:
            pass
        call("/agents", {"name": "Mayor", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": px + 0.5, "y": 90, "z": pz + 0.5}})
        time.sleep(10)
        call("/agents/Mayor/act", {"action": "find_site", "size": site_size})
        # find_site takes a few seconds, more when it walks farther out
        for _ in range(120):
            time.sleep(1)
            result = [e for e in call("/agents/Mayor/events?since=0") if e["type"] in ("action_done", "action_failed")]
            if result:
                break
        site = call("/agents/Mayor/memory").get("lastSite")
        call("/agents/Mayor", method="DELETE")
        # Survival villages need trees near them (Accept7's desert site had none within 112 blocks)
        treeless = gamemode == "survival" and result and any(w in result[-1]["text"] for w in ("No trees within 48 blocks", "too few trees"))
        if result and result[-1]["type"] == "action_done" and site and not treeless:
            print(f"land found near {px:.0f},{pz:.0f}: {result[-1]['text'][:120]}", flush=True)
            # The village starts at the site found, not at the probe point (Accept17's mayor spawned 100 blocks from the
            # site, stuck in a hollow, and spent the run walking)
            return site["x"], site["z"]
        print(f"no room near {px:.0f},{pz:.0f}: {result[-1]['text'][60:200] if result else 'no result'}", flush=True)
    raise SystemExit("no land found")


x, z = find_land(x, z)
call("/village", {"name": village, "objective": objective})
names = ["Mayor"] + [f"Worker{i + 1}" for i in range(workers)]
for i, n in enumerate(names):
    mem = {**BASE, "village": village, "planModel": mayor_planner if i == 0 else worker_planner, **({"villageRole": "mayor"} if i == 0 else {})}
    try:
        call("/agents", {"name": n, "role": "mayor" if i == 0 else "builder", "brain": "tiered", "gamemode": gamemode, "reset": True,
                         "position": {"x": x + 0.5 + 2 * i, "y": 90, "z": z + 0.5}, "memory": mem})
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
                if e["type"] == "action_failed":
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
