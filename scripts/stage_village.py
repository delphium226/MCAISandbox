"""Start a real-Minecraft village at a given stage and watch it, to test one part of the village economy quickly.

Usage: python scripts/stage_village.py VILLAGE X Z [options]
  --buildings testhut,testhut   design names, one per building (default: one testhut; built in: testhut 5x5, testhall 9x9)
  --design-from VILLAGE:NAME    copy a design from another village's library (repeatable)
  --stage full|build            full: layout only, workers do storage, gathering and building;
                                build: the storage chest is placed and stocked with the raw materials, so workers
                                only prepare the plot and build (tests building from storage, crafting included)
  --brain tasks|tiered          tasks (default): scripted workers that run each task's skill calls, no model;
                                tiered: model-driven workers (MCAI_EXEC_MODEL, --planner)
  --planner MODEL               the tiered workers' planner (default ollama:gpt-oss:120b-cloud)
  --workers N                   default 2 (Worker1, Worker2)
  --minutes M                   time limit (default 20)
Stops early when every building is done, when an agent fails the same way 3 times, or after MCAI_STALL_MIN minutes
(default 3) without a successful action. Workers are left in the world: remove them afterwards (panel or DELETE).
"""
import argparse, json, math, os, re, subprocess, sys, time, urllib.error, urllib.request

API = os.environ.get("MCAI_API", "http://127.0.0.1:8766/api")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# A small, cheap building: cobblestone floor, oak plank walls and roof, oak log corners, a door and two windows
TESTHUT = {
    "name": "testhut", "description": "a small test hut (planks, logs, cobblestone, glass)", "width": 5, "depth": 5,
    "palette": {"C": "cobblestone", "P": "oak_planks", "L": "oak_log", "G": "glass", "D": "oak_door"},
    "layers": [
        ["C C C C C"] * 5,
        ["L P P P L", "P . . . P", "P . . . P", "P . . . P", "L P D P L"],
        ["L P G P L", "P . . . P", "P . . . P", "P . . . P", "L P . P L"],
        ["P P P P P"] * 5,
    ],
}

# A bigger one for village layouts: a 9x9 hall of planks on a cobblestone floor, log posts, glass, a door
TESTHALL = {
    "name": "testhall", "description": "a 9x9 test hall (planks, logs, cobblestone, glass)", "width": 9, "depth": 9,
    "palette": {"C": "cobblestone", "P": "oak_planks", "L": "oak_log", "G": "glass", "D": "oak_door"},
    "layers": [
        ["C C C C C C C C C"] * 9,
        ["L P P P P P P P L"] + ["P . . . . . . . P"] * 7 + ["L P P P D P P P L"],
        ["L P G P P P G P L", "P . . . . . . . P", "G . . . . . . . G", "P . . . . . . . P", "P . . . . . . . P",
         "P . . . . . . . P", "G . . . . . . . G", "P . . . . . . . P", "L P G P . P G P L"],
        ["L P P P P P P P L"] + ["P . . . . . . . P"] * 7 + ["L P P P P P P P L"],
        ["P P P P P P P P P"] * 9,
    ],
}

p = argparse.ArgumentParser()
p.add_argument("village"); p.add_argument("x", type=float); p.add_argument("z", type=float)
p.add_argument("--buildings", default="testhut")
p.add_argument("--design-from", action="append", default=[])
p.add_argument("--stage", choices=["full", "build"], default="full")
p.add_argument("--brain", choices=["tasks", "tiered"], default="tasks")
p.add_argument("--planner", default="ollama:gpt-oss:120b-cloud")
p.add_argument("--workers", type=int, default=2)
p.add_argument("--minutes", type=float, default=20)
args = p.parse_args()
buildings = [b.strip() for b in args.buildings.split(",") if b.strip()]
stall_minutes = float(os.environ.get("MCAI_STALL_MIN", "3"))


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()[:300], "status": e.code}


def rcon(cmd):
    return subprocess.run([sys.executable, os.path.join(ROOT, "mc", "rcon.py"), cmd], capture_output=True, text=True).stdout.strip()


def find_land(x, z, size):
    """Search outward from x,z for room for the plot (an idle survival probe runs find_site, which prefers ground with trees near)."""
    points = [(x, z)] + [(x + r * math.cos(a * math.pi / 4), z + r * math.sin(a * math.pi / 4)) for r in (120, 240) for a in range(8)]
    for px, pz in points:
        call("/agents/Mayor", method="DELETE")
        call("/agents", {"name": "Mayor", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": px + 0.5, "y": 90, "z": pz + 0.5}})
        time.sleep(8)
        call("/agents/Mayor/act", {"action": "find_site", "size": size})
        time.sleep(3)
        site = call("/agents/Mayor/memory").get("lastSite")
        call("/agents/Mayor", method="DELETE")
        # find_site falls back to the largest site near by: that is too small for the layout
        if site and site.get("size", size) >= size:
            print(f"land near {px:.0f},{pz:.0f}: site {site}", flush=True)
            return site
    raise SystemExit("no land found")


# ---- the village and its designs
call("/village", {"name": args.village, "objective": f"test: {', '.join(buildings)}"})
designs = {"testhut": TESTHUT, "testhall": TESTHALL}
for spec in args.design_from:
    src, name = spec.split(":")
    d = call(f"/village/{src}").get("designs", {}).get(name)
    if not d:
        raise SystemExit(f"no design {name} in {src}")
    designs[name] = {**d, "layers": [[" ".join(r) for r in layer] for layer in d["layers"]]}
for name in set(buildings):
    if name not in designs:
        raise SystemExit(f"unknown design {name}: use testhut or --design-from VILLAGE:{name}")
    r = call(f"/village/{args.village}/designs", designs[name])
    print(f"design {name}: {r}", flush=True)

# ---- site and layout (the size covers the plot plus prepare_site's margin)
biggest = max(max(designs[n]["width"], designs[n]["depth"]) for n in buildings)
size = min(36, int(math.ceil(math.sqrt(len(buildings)))) * (biggest + 3) + 8)
site = find_land(args.x, args.z, size)
r = call(f"/village/{args.village}/layout", {"buildings": buildings, "x": site["x"], "y": site["y"], "z": site["z"], "size": site.get("size", size)})
print(r.get("result") or r, flush=True)
if "error" in r:
    raise SystemExit(1)
tasks = r["tasks"]

# ---- stage build: storage placed and stocked, gathering done
storage_spot = None
if args.stage == "build":
    for t in tasks:
        if t["status"] == "open" and (t["title"].startswith("Gather") or t["title"].startswith("Set up the village storage")):
            call(f"/village/{args.village}/tasks/{t['id']}", {"status": "done"})
        m = re.search(r"move_to x=(-?\d+) y=(-?\d+) z=(-?\d+)", t["detail"])
        if t["title"].startswith("Set up the village storage") and m:
            storage_spot = tuple(int(v) for v in m.groups())

if storage_spot:
    # Before any worker exists (a worker claimed the build before the chest was there): load the chunk, find the
    # ground with the server's own block tests, place the chest, register it and stock it
    sx, sy, sz = storage_spot
    rcon(f"forceload add {sx} {sz}")
    time.sleep(1)
    y = None
    for yy in range(sy + 12, sy - 24, -1):
        if "passed" in rcon(f"execute unless block {sx} {yy} {sz} #minecraft:replaceable").lower():
            y = yy + 1
            break
    if y is None:
        raise SystemExit(f"could not find the ground at {sx},{sz} for the storage chest")
    print(rcon(f"setblock {sx} {y} {sz} chest"), flush=True)
    # Stock it with every building's raw materials, plus a crafting table's and a furnace's worth
    need = {}
    for n in buildings:
        for item, q in call(f"/village/{args.village}/designs/{n}/bill").get("gather", {}).items():
            item = "oak_log" if re.search(r"_log$|^any:logs$", item) else "cobblestone" if item == "any:cobblestone" else item.replace("any:", "")
            need[item] = need.get(item, 0) + q
    need["oak_log"] = need.get("oak_log", 0) + 4
    need["cobblestone"] = need.get("cobblestone", 0) + 8
    slot = 0
    for item, q in need.items():
        while q > 0 and slot < 27:
            n = min(64, q)
            rcon(f"item replace block {sx} {y} {sz} container.{slot} with minecraft:{item} {n}")
            q -= n
            slot += 1
    print(call(f"/village/{args.village}/storage", {"x": sx, "y": y, "z": sz}).get("result"), flush=True)
    rcon(f"forceload remove {sx} {sz}")
    print(f"storage at {sx},{y},{sz} stocked with {need}", flush=True)

# ---- workers
names = [f"Worker{i + 1}" for i in range(args.workers)]
for i, n in enumerate(names):
    call(f"/agents/{n}", method="DELETE")
    mem = {"village": args.village, "buildSpeed": 4}
    if args.brain == "tiered":
        mem.update({"planModel": args.planner, "execModel": os.environ.get("MCAI_EXEC_MODEL", "ollama:qwen3:30b-instruct")})
    r = call("/agents", {"name": n, "role": "builder", "brain": args.brain, "gamemode": "survival", "reset": True,
                         "position": {"x": site["x"] + 0.5 + 2 * i, "z": site["z"] + 0.5 + 8}, "memory": mem})
    print(f"{n}: {r}", flush=True)

# ---- watch
t0, seen, board, reason, last_done = time.time(), {n: 0 for n in names}, "", "time limit", time.time()
fails = {}
stamp = lambda: f"{(time.time() - t0) / 60:4.1f}m"
while time.time() - t0 < args.minutes * 60 and reason == "time limit":
    time.sleep(3)
    for n in names:
        events = call(f"/agents/{n}/events?since={seen[n]}")
        if not isinstance(events, list):
            continue
        for e in events:
            seen[n] = e["id"]
            if e["type"] in ("action_done", "action_failed", "system"):
                print(f"{stamp()} {n:8} {e['type']:13} | {e['text'][:240]}", flush=True)
            if e["type"] == "action_done":
                last_done = time.time()
            if e["type"] == "action_failed":
                k = (n, e["text"][:80])
                fails[k] = fails.get(k, 0) + 1
                if fails[k] >= 3:
                    reason = f"{n} failed the same way 3 times: {e['text'][:160]}"
    v = call(f"/village/{args.village}")
    b = " ".join(f"{t['id']}:{t['status']}{'/' + t['claimedBy'] if t.get('claimedBy') else ''}" for t in v["tasks"])
    if b != board:
        board = b
        print(f"{stamp()} BOARD {b}", flush=True)
    builds = [t for t in v["tasks"] if t["title"].startswith("Build ")]
    if builds and all(t["status"] == "done" for t in builds):
        reason = "every building is done"
    elif time.time() - last_done > stall_minutes * 60:
        reason = f"stalled: no successful action for {stall_minutes:g} minutes"

v = call(f"/village/{args.village}")
print(f"\nSTOPPED after {(time.time() - t0) / 60:.1f}m ({reason})")
for t in v["tasks"]:
    print(f"  {t['id']} [{t['status']}{'/' + t['claimedBy'] if t.get('claimedBy') else ''}] {t['title']}: {(t.get('result') or '')[:120]}")
storage = {}
for c in (v.get("storage") or {}).get("chests", []):
    for k, q in c["items"].items():
        storage[k] = storage.get(k, 0) + q
print("STORAGE", storage)
print("STRUCTURES", [(s["kind"], s["x1"], s["x2"], s["z1"], s["z2"], s["builtBy"]) for s in v["structures"]])
