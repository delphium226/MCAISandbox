"""Start a real-Minecraft village at a given stage and watch it, to test one part of the village economy quickly.

Usage: python scripts/stage_village.py VILLAGE X Z [options]
       python scripts/stage_village.py VILLAGE --site NAME [options]
  --site NAME                   a site of the fixed test world (scripts/test_sites.json, plan step T.2; restore it first
                                with scripts/reset_site.py NAME): its recorded find_site result is used as it is (no land
                                search); while it has none, the land search starts at its probe and prints the site found
                                to record. MCAI_API defaults to the test agent server (port 8767) and MC_SERVER_DIR to
                                mc/testserver with --site
  --buildings testhut,testhut   design names, one per building (default: one testhut; built in: testhut 5x5, testhall 9x9,
                                stairhut 5x5 and stairhall 9x9 with stair gable roofs; drawn by the building generator:
                                genhut 7x7 (a 5x5 hip with an overhang) and genhall 11x11 (a 9x9 gable with an overhang);
                                plan_layout takes one building over 150 gather units a village: testhall (~153),
                                stairhall (~172) and genhall (~191) do not go together)
  --design-from VILLAGE:NAME    copy a design from another village's library (repeatable)
  --design-file FILE.json       a design from a JSON file, by its name (repeatable; e.g. a vanilla piece written by
                                scripts/checks/vanilla_pieces.mts with OUT=)
  --plan street                 the street plan (V2.3): the biome's vanilla town centre in the middle, streets from it laid by
                                prepare_site as dirt_path, the buildings turned to face them (--biome picks the centre,
                                default plains)
  --stage full|build            full: layout only, workers do storage, gathering and building;
                                build: the storage chest is placed and stocked with the raw materials, so workers
                                only prepare the plot and build (tests building from storage, crafting included).
                                With a storage hut (new villages), the chests go into the hut's chest spots once the
                                plot is prepared, one per material group, and the hut is built around them; when every
                                building stands, Worker1 deposits mixed items and the chests are checked for sorting
  --no-deposit-check            skip that check
  --brain tasks|tiered          tasks (default): scripted workers that run each task's skill calls, no model;
                                tiered: model-driven workers (MCAI_EXEC_MODEL, --planner)
  --planner MODEL               the tiered workers' planner (default ollama:gpt-oss:120b-cloud)
  --workers N                   default 2 (Worker1, Worker2)
  --mayor                       also a tiered Mayor (V2.3m), its layout posted by it and its plan empty: it gathers while
                                it waits (soft gather tasks run as written, no model calls expected; --planner is its
                                planner, MCAI_EXEC_MODEL its executor: start the agent server with MC_OLLAMA_ROUTES)
  --minutes M                   time limit (default 20)
Stops early when every building is done, when an agent fails the same way 3 times, or after MCAI_STALL_MIN minutes
(default 3) without a successful action. Workers are left in the world: remove them afterwards (panel or DELETE).
"""
import argparse, json, math, os, re, subprocess, sys, time, urllib.error, urllib.request

# Chat and model text can hold any character; the Windows console encoding cannot
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
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


def gable(width, depth, walls, floor="C", ridge="P"):
    """Roof layers for a gable over a width x depth building whose walls are `walls` (a list of wall layers): stairs N
    (facing south, the north slope) and S (facing north) rising one row per layer from both sides, the ridge on the
    middle row, the gable ends of planks (phase D's test buildings)."""
    def row(cells):
        return " ".join(cells)
    layers = [[row([floor] * width)] * depth] + walls
    for k in range(depth // 2):
        rows = []
        for j in range(depth):
            if j == k:
                rows.append(row(["N"] * width))
            elif j == depth - 1 - k:
                rows.append(row(["S"] * width))
            elif k < j < depth - 1 - k:
                rows.append(row(["P"] + ["."] * (width - 2) + ["P"]))
            else:
                rows.append(row(["."] * width))
        layers.append(rows)
    layers.append([row([ridge] * width) if j == depth // 2 else row(["."] * width) for j in range(depth)])
    return layers


STAIRS = {"N": "oak_stairs[facing=south,half=bottom]", "S": "oak_stairs[facing=north,half=bottom]"}
# Phase D: the testhut with a gable roof of stairs (the builder crafts the stairs from storage)
STAIRHUT = {
    "name": "stairhut", "description": "a small test hut with a stair gable roof", "width": 5, "depth": 5,
    "palette": {"C": "cobblestone", "P": "oak_planks", "L": "oak_log", "G": "glass", "D": "oak_door", **STAIRS},
    "layers": gable(5, 5, [
        ["L P P P L", "P . . . P", "P . . . P", "P . . . P", "L P D P L"],
        ["L P G P L", "P . . . P", "P . . . P", "P . . . P", "L P . P L"],
    ]),
}
# ...and a 9x9 hall with a slab ridge and trapdoor shutters (stairs, slabs and trapdoors crafted from storage)
STAIRHALL = {
    "name": "stairhall", "description": "a 9x9 test hall with a stair gable roof, slab ridge and shutters", "width": 9, "depth": 9,
    "palette": {"C": "cobblestone", "P": "oak_planks", "L": "oak_log", "G": "glass", "D": "oak_door", **STAIRS,
                "R": "oak_slab[type=bottom]", "T": "oak_trapdoor[facing=south,half=top,open=true]"},
    "layers": gable(9, 9, [
        ["L P P P P P P P L"] + ["P . . . . . . . P"] * 7 + ["L P P P D P P P L"],
        ["L P G P P P G P L", "P . . . . . . . P", "G . . . . . . . G", "P . . . . . . . P", "P . . . . . . . P",
         "P . . . . . . . P", "G . . . . . . . G", "P . . . . . . . P", "L T G T . T G T L"],
        ["L P P P P P P P L"] + ["P . . . . . . . P"] * 7 + ["L P P P P P P P L"],
    ], ridge="R"),
}

# Phase D, D.2: designs the building generator draws from a style (buildingGen.ts, through scripts/checks/gen_designs.mts):
# a hip-roofed hut with an overhang and glass panes, and a gabled hall with an overhang on a cobblestone base
GEN_STYLES = {
    "genhut": {"width": 5, "depth": 5, "wall_height": 3, "floor": "none", "base": "cobblestone", "frame": "logs",
               "walls": "planks", "roof": "hip", "roof_material": "planks", "overhang": 1, "windows": "panes",
               "door_side": "south", "description": "a generated test hut with a hip roof"},
    "genhall": {"width": 9, "depth": 9, "wall_height": 4, "floor": "none", "base": "cobblestone", "frame": "logs",
                "walls": "planks", "roof": "gable", "roof_material": "planks", "overhang": 1, "windows": "glass",
                "door_side": "south", "description": "a generated test hall with a gable roof"},
}


def generated(name):
    """A design drawn by the building generator from GEN_STYLES[name]."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "runs", f"gen_{name}_{os.getpid()}.json")
    tsx = os.path.join(root, "node_modules", ".bin", "tsx.cmd" if os.name == "nt" else "tsx")
    env = dict(os.environ, STYLE=json.dumps({**GEN_STYLES[name], "name": name}), OUT=out)
    subprocess.run([tsx, os.path.join(root, "scripts", "checks", "gen_designs.mts")], env=env, check=True, cwd=root)
    with open(out, encoding="utf-8") as f:
        d = json.load(f)["design"]
    os.remove(out)
    return {**d, "name": name}


p = argparse.ArgumentParser()
p.add_argument("village"); p.add_argument("x", type=float, nargs="?"); p.add_argument("z", type=float, nargs="?")
p.add_argument("--site", help="a site of scripts/test_sites.json (the fixed test world)")
p.add_argument("--site-at", help="X,Y,Z,SIZE[,WOOD[,WOODLOGS]]: a site find_site gave (e.g. from the ground in jungle, where a probe "
               "spawned by x,z lands on the canopy), used directly in the world MCAI_API points at")
p.add_argument("--buildings", default="testhut")
p.add_argument("--design-from", action="append", default=[])
p.add_argument("--design-file", action="append", default=[])
p.add_argument("--plan", choices=["rows", "street"], default="rows")
p.add_argument("--biome", default="plains")
p.add_argument("--stage", choices=["full", "build"], default="full")
p.add_argument("--brain", choices=["tasks", "tiered"], default="tasks")
p.add_argument("--planner", default="ollama:gpt-oss:120b-cloud")
p.add_argument("--workers", type=int, default=2)
p.add_argument("--mayor", action="store_true")
p.add_argument("--minutes", type=float, default=20)
p.add_argument("--mixed-wood", action="store_true", help="stage build: stock half the logs in another wood kind")
p.add_argument("--no-deposit-check", action="store_true")
p.add_argument("--harvest", action="store_true", help="after the build, set the farm ripe by command and check the harvest "
                                                          "(farming v2): bread in storage, every looted cell sown again")
p.add_argument("--after", type=float, default=0, help="keep watching this many minutes after the village is complete: the "
                                                      "chores (opportunistic farms, harvests, exploring) and the atlas's sightings; needs --mayor (only a "
                                                      "tiered mayor sets the village complete, and the chores wait for that)")
p.add_argument("--fixtures", action="store_true", help="before the run, put sugar cane (with water), pumpkins and a melon "
                                                       "on the ground 35-45 blocks off the site by command (sightings to farm)")
p.add_argument("--ripen", action="store_true", help="with --after: set each newly planted farm slot ripe by command once")
args = p.parse_args()
test_site = None
if args.site:
    sites = json.load(open(os.path.join(ROOT, "scripts", "test_sites.json"), encoding="utf-8"))
    sites = sites["sites"] if isinstance(sites, dict) else sites
    test_site = next((s for s in sites if s["name"].lower() == args.site.lower()), None)
    if not test_site:
        p.error(f"no site {args.site} in scripts/test_sites.json; there are: {', '.join(s['name'] for s in sites)}")
    if args.x is not None:
        print(f"--site {args.site}: X Z ignored", flush=True)
    args.x, args.z = test_site["probe"]["x"], test_site["probe"]["z"]
    # The test world's servers, unless told otherwise (rcon.py reads MC_SERVER_DIR)
    if "MCAI_API" not in os.environ:
        API = "http://127.0.0.1:8767/api"
    os.environ.setdefault("MC_SERVER_DIR", "mc/testserver")
    print(f"test world: API {API}, server folder {os.environ['MC_SERVER_DIR']}", flush=True)
    # The village records (API) and the RCON commands (server folder) must reach the same world
    props = os.path.join(ROOT, os.environ["MC_SERVER_DIR"], "server.properties")
    kv = dict(l.split("=", 1) for l in open(props).read().splitlines() if "=" in l and not l.startswith("#"))
    with urllib.request.urlopen(API + "/status", timeout=10) as r:
        served = json.loads(r.read()).get("server", "")
    if not served.endswith(f":{kv.get('server-port', '25565')}"):
        raise SystemExit(f"the agent server at {API} plays on {served}, but {props} says server-port={kv.get('server-port')}: not one world")
elif args.x is None or args.z is None:
    p.error("give X and Z, or --site NAME")
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


def find_land(x, z, size):
    """Search outward from x,z for room for the plot (an idle survival probe runs find_site, which prefers ground with trees near)."""
    points = [(x, z)] + [(x + r * math.cos(a * math.pi / 4), z + r * math.sin(a * math.pi / 4)) for r in (120, 240) for a in range(8)]
    for px, pz in points:
        call("/agents/Mayor", method="DELETE")
        # No height: the server puts it on the surface (y 90 put agents inside hills, F84)
        call("/agents", {"name": "Mayor", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": px + 0.5, "z": pz + 0.5}})
        time.sleep(8)
        call("/agents/Mayor/act", {"action": "find_site", "size": size})
        # find_site takes a few seconds, more when it walks farther out (to atlas candidates: up to 300 blocks, step 2.3)
        for _ in range(300):
            time.sleep(1)
            if [e for e in call("/agents/Mayor/events?since=0") if e["type"] in ("action_done", "action_failed")]:
                break
        site = call("/agents/Mayor/memory").get("lastSite")
        call("/agents/Mayor", method="DELETE")
        # find_site falls back to the largest site near by: that is too small for the layout
        if site and site.get("size", size) >= size:
            print(f"land near {px:.0f},{pz:.0f}: site {site}", flush=True)
            return site
    raise SystemExit("no land found")


# ---- the village and its designs
call("/village", {"name": args.village, "objective": f"test: {', '.join(buildings)}"})
designs = {"testhut": TESTHUT, "testhall": TESTHALL, "stairhut": STAIRHUT, "stairhall": STAIRHALL}
for spec in args.design_from:
    src, name = spec.split(":")
    d = call(f"/village/{src}").get("designs", {}).get(name)
    if not d:
        raise SystemExit(f"no design {name} in {src}")
    designs[name] = {**d, "layers": [[" ".join(r) for r in layer] for layer in d["layers"]]}
for path in args.design_file:
    d = json.load(open(path, encoding="utf-8"))
    designs[d["name"]] = {**d, "layers": [[" ".join(r) for r in layer] for layer in d["layers"]]}
for name in set(buildings):
    if name in GEN_STYLES and name not in designs:
        designs[name] = generated(name)
    if name not in designs:
        raise SystemExit(f"unknown design {name}: use testhut, --design-from VILLAGE:{name} or --design-file FILE")
    r = call(f"/village/{args.village}/designs", designs[name])
    print(f"design {name}: {r}", flush=True)

# ---- site and layout (the size covers the plot plus prepare_site's margin; a new village gets a 7x9 storage hut too)
biggest = max(9, *(max(designs[n]["width"], designs[n]["depth"]) for n in buildings))
size = min(36, int(math.ceil(math.sqrt(len(buildings) + 1))) * (biggest + 3) + 8)
if args.site_at:
    f = args.site_at.split(",")
    # (a sixth field, the logs of that wood near the site as find_site counts them, gives the village a wood kind as in
    # model-driven runs: plan_layout sets one only with enough of it, F164's tests)
    site = {"x": int(f[0]), "y": int(f[1]), "z": int(f[2]), "size": int(f[3]), **({"wood": f[4]} if len(f) > 4 else {}),
            **({"woodLogs": int(f[5])} if len(f) > 5 else {})}
    print(f"site given: {json.dumps(site)}", flush=True)
elif test_site and test_site.get("site"):
    site = test_site["site"]
    print(f"site {test_site['name']} from test_sites.json: {json.dumps(site)}", flush=True)
    # (a rough estimate: the layout packs tighter, e.g. two 9x9 houses, an 11x11 hall and the huts in 24x31; the layout's
    # own answer says when they do not fit)
    if site.get("size", size) < size:
        print(f"the recorded site is {site['size']} blocks across, these buildings may need {size}: if the layout leaves "
              f"some out, set its site to null in scripts/test_sites.json and run once more to find a bigger one", flush=True)
else:
    site = find_land(args.x, args.z, size)
    if test_site:
        found = {k: site[k] for k in ("x", "y", "z", "size", "wood", "woodLogs") if k in site}
        print(f"record this in test_sites.json as the site of {test_site['name']}: {json.dumps(found)}", flush=True)
r = call(f"/village/{args.village}/layout", {"buildings": buildings, "x": site["x"], "y": site["y"], "z": site["z"], "size": site.get("size", size), "wood": site.get("wood"), "woodLogs": site.get("woodLogs"),
                                             "plan": args.plan, **({"biome": args.biome} if args.plan == "street" else {}),
                                             **({"by": "Mayor"} if args.mayor else {})})
print(r.get("result") or r, flush=True)
if "error" in r:
    raise SystemExit(1)
tasks = r["tasks"]
hut = call(f"/village/{args.village}").get("storageHut")
# Every design the layout builds (the storage hut included)
built_designs = [m.group(1) for t in tasks if t["title"].startswith("Build ") for m in [re.search(r'build_design "([^"]+)"', t["detail"])] if m]
GROUPS = [("logs", r"_(log|wood|stem|hyphae)$"), ("planks", r"_planks$"),
          ("cobblestone", r"^(cobblestone|cobbled_deepslate|stone|smooth_stone|deepslate|andesite|diorite|granite|tuff)$"),
          ("sand", r"^(red_)?(sand|sandstone)$"), ("glass", r"^glass(_pane)?$"), ("terracotta", r"terracotta$")]


def group_of(item):
    """The storage group an item is sorted into (mcStorage.ts groupOf)."""
    return next((g for g, rx in GROUPS if re.search(rx, item)), "misc")


def stock_needed():
    """Every building's raw materials, plus a crafting table's and a furnace's worth (logs in the village's wood kind;
    with --mixed-wood, half of them in another kind)."""
    need = {}
    wood = None
    for n in built_designs:
        bill = call(f"/village/{args.village}/designs/{n}/bill")
        wood = bill.get("wood") or "oak"
        for item, q in bill.get("gather", {}).items():
            item = f"{wood}_log" if item == "any:logs" else "cobblestone" if item == "any:cobblestone" else item.replace("any:", "")
            need[item] = need.get(item, 0) + q
    # (and in a hut village, for the chests the deposit check crafts: 3 logs each)
    need[f"{wood}_log"] = need.get(f"{wood}_log", 0) + (13 if hut else 4)
    need["cobblestone"] = need.get("cobblestone", 0) + 8
    # (and the farm's 16 seeds and a log for its hoe, 10-08: --stage build marks the seed tasks done)
    need["wheat_seeds"] = need.get("wheat_seeds", 0) + 16
    need[f"{wood}_log"] = need.get(f"{wood}_log", 0) + 1
    if args.mixed_wood:
        other = "spruce" if wood != "spruce" else "birch"
        for item in [i for i in need if i.endswith("_log")]:
            half = need[item] // 2
            need[item] -= half
            need[f"{other}_log"] = need.get(f"{other}_log", 0) + half
    return need


def fill_chest(x, y, z, items):
    slot = 0
    for item, q in items.items():
        while q > 0 and slot < 27:
            n = min(64, q)
            rcon(f"item replace block {x} {y} {z} container.{slot} with minecraft:{item} {n}")
            q -= n
            slot += 1


def stock_hut():
    """Put chests into the storage hut's spots on the prepared plot, one per material group, stocked, registered."""
    v = call(f"/village/{args.village}")
    plot = next((q for q in v["plots"] if q["x1"] <= hut["x1"] and q["x2"] >= hut["x2"] and q["z1"] <= hut["z1"] and q["z2"] >= hut["z2"]), None)
    if not plot:
        raise SystemExit(f"no prepared plot covers the storage hut {hut}")
    y = plot["y"] + 1
    by_group = {}
    for item, q in stock_needed().items():
        by_group.setdefault(group_of(item), {})[item] = q
    for spot, (group, items) in zip(hut["spots"], by_group.items()):
        sx, sz = spot["x"], spot["z"]
        rcon(f"forceload add {sx} {sz}")
        time.sleep(1)
        print(rcon(f"setblock {sx} {y} {sz} chest"), flush=True)
        fill_chest(sx, y, sz, items)
        print(call(f"/village/{args.village}/storage", {"x": sx, "y": y, "z": sz, "group": group}).get("result"), group, items, flush=True)
        rcon(f"forceload remove {sx} {sz}")


def harvest_check():
    """Farming v2: set the field's wheat ripe by command, wait for the harvest chore, check bread and the resown field."""
    v = call(f"/village/{args.village}")
    if args.mayor:
        for _ in range(40):
            if v.get("complete"):
                break
            time.sleep(3)
            v = call(f"/village/{args.village}")
    print(f"HARVEST village {'complete' if v.get('complete') else 'not complete'}: the harvest runs "
          f"{'after' if v.get('complete') else 'before'} completion", flush=True)
    farm = ((v.get("layouts") or [{}])[0]).get("farm")
    if not farm or not farm.get("planted"):
        print("HARVEST FAIL: no planted farm", flush=True)
        return
    plot = next((p for p in v["plots"] if p["x1"] <= farm["x1"] and p["x2"] >= farm["x2"] and p["z1"] <= farm["z1"] and p["z2"] >= farm["z2"]), None)
    if not plot:
        print("HARVEST FAIL: no plot holds the farm", flush=True)
        return
    y = plot["y"] + 1
    # The cells holding wheat now: each must hold wheat again after the harvest (sown, not left bare)
    sown = [(x, z) for x, z in farm["sow"] if call(f"/block?x={x}&y={y}&z={z}").get("block") == "wheat"]
    harvests0 = farm.get("harvests") or 0
    bread0 = sum(c["items"].get("bread", 0) for c in (v.get("storage") or {}).get("chests", []))
    since = {n: 0 for n in watched}
    for n in watched:
        ev = call(f"/agents/{n}/events?since=0")
        since[n] = max([e["id"] for e in ev] + [0]) if isinstance(ev, list) else 0
    print("HARVEST ripen:", rcon(f"fill {farm['x1']} {y} {farm['z1']} {farm['x2']} {y} {farm['z2']} minecraft:wheat[age=7] replace minecraft:wheat"), flush=True)
    t1, done = time.time(), None
    while time.time() - t1 < 240 and done is None:
        time.sleep(3)
        for n in watched:
            ev = call(f"/agents/{n}/events?since={since[n]}")
            if not isinstance(ev, list):
                continue
            for e in ev:
                since[n] = e["id"]
                if e["type"] in ("action_done", "action_failed") and "harvest_farm" in e["text"]:
                    print(f"HARVEST {(time.time() - t1) / 60:4.1f}m {n:8} {e['type']:13} | {e['text'][:300]}", flush=True)
                    done = e["type"] == "action_done"
    if done is None:
        f2 = ((call(f"/village/{args.village}").get("layouts") or [{}])[0]).get("farm") or {}
        print(f"HARVEST FAIL: no harvest within 4 minutes (last: {f2.get('lastHarvest')})", flush=True)
        return
    time.sleep(2)
    v = call(f"/village/{args.village}")
    bread = sum(c["items"].get("bread", 0) for c in (v.get("storage") or {}).get("chests", [])) - bread0
    ages, bad = [], []
    for x, z in sown:
        b = call(f"/block?x={x}&y={y}&z={z}")
        if b.get("block") == "wheat":
            ages.append(int((b.get("properties") or {}).get("age", -1)))
        else:
            bad.append(f"{x},{z}:{b.get('block')}")
    ripe = sum(1 for a in ages if a >= 7)
    f2 = ((v.get("layouts") or [{}])[0]).get("farm") or {}
    ok = done and bread > 0 and not ripe and not bad and (f2.get("harvests") or 0) > harvests0
    print(f"HARVEST {'PASS' if ok else 'FAIL'}: bread +{bread} in storage, field {len(ages)} of {len(sown)} wheat (ages {sorted(ages)}), "
          f"{ripe} still ripe, not wheat {bad[:8]}; record harvests={f2.get('harvests')} bread={f2.get('bread')} "
          f"last={f2.get('lastHarvest')}", flush=True)


def deposit_check(worker):
    """Give the worker mixed items, have it deposit everything, and check each chest holds only its own group, in the hut."""
    gift = {"cobblestone": 5, "oak_log": 7, "sand": 3, "glass": 4, "oak_planks": 6, "torch": 2, "cocoa_beans": 3}
    # Not while it still holds a task: the mine task ends with its own deposit, which took the gift (StageM1)
    for _ in range(60):
        v = call(f"/village/{args.village}")
        if not any(t["status"] == "claimed" and t.get("claimedBy") == worker for t in v["tasks"]):
            break
        time.sleep(3)
    for item, q in gift.items():
        rcon(f"give {worker} minecraft:{item} {q}")
    time.sleep(2)
    events = call(f"/agents/{worker}/events?since=0")
    seen = max([e["id"] for e in events] + [0]) if isinstance(events, list) else 0
    call(f"/agents/{worker}/act", {"action": "deposit", "item": "all"})
    result = None
    for _ in range(200):
        time.sleep(3)
        events = call(f"/agents/{worker}/events?since={seen}")
        for e in events if isinstance(events, list) else []:
            seen = e["id"]
            if e["type"] in ("action_done", "action_failed") and ((e.get("data") or {}).get("type") == "deposit" or "deposit" in e["text"][:60].lower()):
                result = e
        if result:
            break
    print(f"DEPOSIT {result and result['type']}: {result and result['text'][:400]}", flush=True)
    v = call(f"/village/{args.village}")
    h = v.get("storageHut") or {}
    ok = bool(result and result["type"] == "action_done")
    for i, c in enumerate(v["storage"]["chests"]):
        wrong = [n for n, q in c["items"].items() if q > 0 and group_of(n) != c.get("group")]
        inside = h and h["x1"] < c["x"] < h["x2"] and h["z1"] < c["z"] < h["z2"]
        block = call(f"/block?x={c['x']}&y={c['y']}&z={c['z']}")
        print(f"  chest {i + 1} ({c.get('group')}) at {c['x']},{c['y']},{c['z']}: {c['items']}"
              f"{'' if inside else ' NOT INSIDE THE HUT'}{' WRONG: ' + ', '.join(wrong) if wrong else ''}; block: {block.get('block', block)}", flush=True)
        ok = ok and inside and not wrong and block.get("block") == "chest"
    print(f"DEPOSIT CHECK {'PASSED' if ok else 'FAILED'}", flush=True)
    return ok


# ---- stage build: storage placed and stocked, gathering done
storage_spot = None
hut_storage = None
if args.stage == "build":
    for t in tasks:
        if t["status"] == "open" and t["title"].startswith("Gather"):
            call(f"/village/{args.village}/tasks/{t['id']}", {"status": "done"})
        if t["status"] == "open" and t["title"].startswith("Set up the village storage"):
            if hut:
                # Held back from the workers: the chests go in by command once the plot is prepared
                call(f"/village/{args.village}/tasks/{t['id']}", {"status": "claimed", "by": "stage"})
                hut_storage = t["id"]
            else:
                call(f"/village/{args.village}/tasks/{t['id']}", {"status": "done"})
        m = re.search(r"move_to x=(-?\d+) y=(-?\d+) z=(-?\d+)", t["detail"])
        if t["title"].startswith("Set up the village storage") and m and not hut:
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
    need = stock_needed()
    fill_chest(sx, y, sz, need)
    print(call(f"/village/{args.village}/storage", {"x": sx, "y": y, "z": sz}).get("result"), flush=True)
    rcon(f"forceload remove {sx} {sz}")
    print(f"storage at {sx},{y},{sz} stocked with {need}", flush=True)

def ground_at(x, z, near_y):
    """The top solid block's y at x, z (the server's block tests; the chunk forceloaded meanwhile)."""
    for yy in range(near_y + 16, near_y - 24, -1):
        if "passed" in rcon(f"execute unless block {x} {yy} {z} #minecraft:replaceable").lower():
            return yy
    return None


def plant_fixtures():
    """Sightings to farm (opportunistic farming): sugar cane two high beside a water cell, three pumpkins, one melon,
    each 35-45 blocks off the site's centre (outside its plot and margin)."""
    gy = site.get("y", 64)
    spots = {"sugar_cane": (site["x"] + 35, site["z"] + 35), "pumpkin": (site["x"] + 42, site["z"] - 6), "melon": (site["x"] - 8, site["z"] + 42)}
    for kind, (x, z) in spots.items():
        fixtures[kind] = []
        rcon(f"forceload add {x - 2} {z - 2} {x + 4} {z + 2}")
        time.sleep(1)
        out = []
        for i in range(3 if kind != "melon" else 1):
            cx = x + 2 * i
            g = ground_at(cx, z, gy)
            if g is None:
                out.append(f"no ground at {cx},{z}")
                continue
            if kind == "sugar_cane":
                out += [rcon(f"setblock {cx} {g} {z} minecraft:dirt"), rcon(f"setblock {cx} {g} {z + 1} minecraft:water"),
                        rcon(f"fill {cx} {g + 1} {z} {cx} {g + 2} {z} minecraft:sugar_cane")]
            else:
                out.append(rcon(f"setblock {cx} {g + 1} {z} minecraft:{kind}"))
            fixtures[kind].append((cx, g + (2 if kind == "sugar_cane" else 1), z))
        print(f"FIXTURE {kind} at {x},{z}: {'; '.join(o for o in out if o)[:200]}", flush=True)
        rcon(f"forceload remove {x - 2} {z - 2} {x + 4} {z + 2}")


fixtures = {}
if args.fixtures:
    plant_fixtures()

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
if args.mayor:
    # The layout is the Mayor's own (posted with by=Mayor) and its plan is empty: the brain sees a mayor waiting for its
    # workers, which gathers meanwhile (V2.3m)
    call("/agents/Mayor", method="DELETE")
    r = call("/agents", {"name": "Mayor", "role": "mayor", "brain": "tiered", "gamemode": "survival", "reset": True,
                         "position": {"x": site["x"] + 0.5 - 2, "z": site["z"] + 0.5 + 8},
                         "memory": {"village": args.village, "villageRole": "mayor", "buildSpeed": 4, "planModel": args.planner,
                                    "execModel": os.environ.get("MCAI_EXEC_MODEL", "ollama:qwen3:30b-instruct"),
                                    "plan": {"goal": "wait for the workers", "steps": [], "by": "external"}}})
    print(f"Mayor: {r}", flush=True)
watched = names + (["Mayor"] if args.mayor else [])
bring_player(names[0])

# ---- watch
t0, seen, board, reason, last_done = time.time(), {n: 0 for n in watched}, "", "time limit", time.time()
fails = {}
last_need = None
stamp = lambda: f"{(time.time() - t0) / 60:4.1f}m"
while time.time() - t0 < args.minutes * 60 and reason == "time limit":
    time.sleep(3)
    for n in watched:
        events = call(f"/agents/{n}/events?since={seen[n]}")
        if not isinstance(events, list):
            continue
        for e in events:
            seen[n] = e["id"]
            if e["type"] in ("action_done", "action_failed", "system"):
                print(f"{stamp()} {n:8} {e['type']:13} | {e['text'][:240]}", flush=True)
            if e["type"] == "action_done":
                last_done = time.time()
            # A material that is not within reach is given up by design (soft gather tasks; the build goes without):
            # not a stuck agent (StageT3 and T4 were stopped on sand)
            # (nor a busy mine: a third miner, the gathering Mayor, hands its task back and comes back later, V2.3m)
            if e["type"] == "action_failed" and "cannot be gathered here" not in e["text"] and "the mine is busy" not in e["text"]:
                k = (n, e["text"][:80])
                fails[k] = fails.get(k, 0) + 1
                if fails[k] >= 3:
                    reason = f"{n} failed the same way 3 times: {e['text'][:160]}"
    v = call(f"/village/{args.village}")
    need = " ".join(f"{q} {n}" for n, q in sorted(((v.get("needed") or {}).get("items") or {}).items()))
    if need != last_need:
        last_need = need
        print(f"{stamp()} NEEDED {need or 'nothing'}", flush=True)
    if hut_storage and all(t["status"] == "done" for t in v["tasks"] if t["title"].startswith("Prepare")):
        stock_hut()
        call(f"/village/{args.village}/tasks/{hut_storage}", {"status": "done"})
        hut_storage = None
        last_done = time.time()
        v = call(f"/village/{args.village}")
    b = " ".join(f"{t['id']}:{t['status']}{'/' + t['claimedBy'] if t.get('claimedBy') else ''}" for t in v["tasks"])
    if b != board:
        board = b
        print(f"{stamp()} BOARD {b}", flush=True)
    builds = [t for t in v["tasks"] if t["title"].startswith("Build ")]
    # (and the street lamps and signs, 10-06 and 10-08: the village is complete once they are up; a failed one is soft)
    lamps = [t for t in v["tasks"] if t["title"].startswith(("Light the streets", "Put up the signs", "Plant the farm"))]
    if builds and all(t["status"] == "done" for t in builds) and all(t["status"] in ("done", "failed") for t in lamps):
        reason = "every building is done"
    elif time.time() - last_done > stall_minutes * 60:
        reason = f"stalled: no successful action for {stall_minutes:g} minutes"

if reason == "every building is done" and hut and args.stage == "build" and not args.no_deposit_check:
    deposit_check(names[0])
if reason == "every building is done" and args.harvest:
    harvest_check()


def slot_text(s):
    return f"{s.get('kind') or 'free'} {s['x1']}..{s['x2']},{s['z1']}..{s['z2']} planted={s.get('planted')} harvests={s.get('harvests')} tries={s.get('tries')}"


def ripen(v, k, s):
    """Set a planted slot ripe by command: crops at their last age, sugar cane a third block, a fruit beside each stem."""
    plot = next((p for p in v["plots"] if p["x1"] <= s["x1"] and p["x2"] >= s["x2"] and p["z1"] <= s["z1"] and p["z2"] >= s["z2"]), None)
    if not plot:
        return "no plot"
    y = plot["y"] + 1
    kind, out = s["kind"], []
    ages = {"carrots": 7, "potatoes": 7, "beetroots": 3}
    for x, z in s.get("cells") or []:
        if kind in ages:
            out.append(rcon(f"setblock {x} {y} {z} minecraft:{kind}[age={ages[kind]}]"))
        elif kind == "sugar_cane":
            out.append(rcon(f"fill {x} {y + 1} {z} {x} {y + 2} {z} minecraft:sugar_cane"))
    for x, z in (s.get("fruit") or [])[::2] if kind in ("pumpkin", "melon") else []:
        out.append(rcon(f"setblock {x} {y} {z} minecraft:{kind}"))
    return f"{len(out)} commands: {'; '.join(o for o in out[:3] if o)[:200]}"


# ---- after completion (opportunistic farming and exploring): the chores, the slots, the sightings
if args.after and reason == "every building is done":
    for _ in range(40):
        if call(f"/village/{args.village}").get("complete"):
            break
        time.sleep(3)
    v = call(f"/village/{args.village}")
    print(f"AFTER village {'complete' if v.get('complete') else 'NOT complete (chores wait for completion)'}; watching {args.after:g} min", flush=True)
    # (the early dirt and sand tasks may have taken a fixture's ground, the design review's M6)
    for kind, cells in fixtures.items():
        print(f"AFTER fixture {kind}: " + ", ".join(f"{x},{y},{z} {call(f'/block?x={x}&y={y}&z={z}').get('block')}" for x, y, z in cells), flush=True)
    a0 = call(f"/atlas?village={args.village}&radius=176") or {}
    chunks0 = len(a0.get("chunks") or [])
    t2, slots_seen, ripened, explore_seen = time.time(), {}, set(), None
    while time.time() - t2 < args.after * 60:
        time.sleep(3)
        for n in watched:
            events = call(f"/agents/{n}/events?since={seen[n]}")
            for e in events if isinstance(events, list) else []:
                seen[n] = e["id"]
                if e["type"] in ("action_done", "action_failed"):
                    print(f"AFTER {(time.time() - t2) / 60:4.1f}m {n:8} {e['type']:13} | {e['text'][:300]}", flush=True)
        v = call(f"/village/{args.village}")
        for k, lay in enumerate(v.get("layouts") or []):
            for j, s in enumerate(lay.get("slots") or []):
                t = slot_text(s)
                if slots_seen.get((k, j)) != t:
                    slots_seen[(k, j)] = t
                    print(f"AFTER {(time.time() - t2) / 60:4.1f}m SLOT {k + 1}.{j + 1}: {t}", flush=True)
                if args.ripen and s.get("kind") and s.get("planted") and (k, j) not in ripened:
                    ripened.add((k, j))
                    print(f"AFTER RIPEN {k + 1}.{j + 1} {s['kind']}: {ripen(v, k, s)}", flush=True)
        ex = v.get("explore")
        if ex != explore_seen:
            explore_seen = ex
            print(f"AFTER {(time.time() - t2) / 60:4.1f}m EXPLORE {json.dumps(ex)[:300]}", flush=True)
    a1 = call(f"/atlas?village={args.village}&radius=176") or {}
    plants = {}
    for c in a1.get("chunks") or []:
        for kind, q in (c.get("plants") or {}).items():
            plants[kind] = plants.get(kind, 0) + q[0]
    animals = {}
    for s in a1.get("animals") or []:
        animals[s["kind"]] = animals.get(s["kind"], 0) + 1
    print(f"AFTER atlas within 176: {chunks0} -> {len(a1.get('chunks') or [])} chunks; plants {plants}; animals {animals}", flush=True)
    reason += f", then {args.after:g} min after"
v = call(f"/village/{args.village}")
print(f"\nSTOPPED after {(time.time() - t0) / 60:.1f}m ({reason})")
for t in v["tasks"]:
    print(f"  {t['id']} [{t['status']}{'/' + t['claimedBy'] if t.get('claimedBy') else ''}] {t['title']}: {(t.get('result') or '')[:120]}")
storage = {}
for c in (v.get("storage") or {}).get("chests", []):
    for k, q in c["items"].items():
        storage[k] = storage.get(k, 0) + q
print("STORAGE", storage)
for i, c in enumerate((v.get("storage") or {}).get("chests", [])):
    print(f"  chest {i + 1} ({c.get('group')}) at {c['x']},{c['y']},{c['z']}: {c['items']}")
for n in watched:
    st = (call(f"/agents/{n}/memory") or {}).get("stats") or {}
    print(f"STATS {n}: plan {st.get('planCalls', 0)}x{st.get('planMsAvg', 0)}ms, exec {st.get('execCalls', 0)}x{st.get('execMsAvg', 0)}ms, done {st.get('actionsDone', 0)}, failed {st.get('actionsFailed', 0)}")
print("STRUCTURES", [(s["kind"], s["x1"], s["x2"], s["z1"], s["z2"], s["builtBy"]) for s in v["structures"]])
