"""The shared atlas (plan step 2.1): walk Gus about 150 blocks, then check chunk summaries against /api/block column
by column (surface heights, water, logs by kind, surface materials, map letters) and report the cost of a summary.
Usage: python scripts/checks/atlas.py [X Z [DIRECTION DISTANCE]] (default: from the oak woods at -405,5, 150 blocks east).
Needs the agent server; Gus joins the test village AtlasTest (created if missing) and is removed at the end.
"""
import json, math, re, sys, time, urllib.request
from collections import Counter

API = "http://127.0.0.1:8766/api"
X, Z = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (-405, 5)
DIRECTION, DISTANCE = (sys.argv[3], int(sys.argv[4])) if len(sys.argv) > 4 else ("east", 150)


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def act(action, **args):
    last = max([e["id"] for e in call("/agents/Gus/events")] or [0])
    call("/agents/Gus/act", {"action": action, **args})
    for _ in range(300):
        time.sleep(1)
        done = [e for e in call("/agents/Gus/events") if e["id"] > last and e["type"] in ("action_done", "action_failed")]
        if done:
            return done[-1]["text"]
    return "(no result in 5 min)"


# The atlas's categories, by name (mcAtlas.ts decides by the block's bounding box; the names here cover what grows)
LOG = re.compile(r"^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$")
LEAF = re.compile(r"_leaves$|mushroom_block$")
WATER = re.compile(r"^(water|bubble_column|seagrass|tall_seagrass|kelp|kelp_plant)$")
PASS = re.compile(r"^(air|cave_air|void_air|snow|cocoa|vine|cactus|bamboo|sugar_cane|cobweb|fire)$|grass$|fern|flower|dandelion|poppy|tulip"
                  r"|orchid|allium|bluet|daisy|lilac|peony|rose_bush|sunflower|bush|sapling|mushroom$|dripleaf|moss_carpet|leaf_litter"
                  r"|petals|_wood$|_stem$|torch|lily_pad|carpet|button|pressure_plate|sign|rail|lichen|roots$|sweet_berry|pumpkin_stem")
MATERIALS = [("sand", r"^sand$", "s"), ("red_sand", r"^red_sand$", "r"), ("sandstone", r"^sandstone$", "d"),
             ("red_sandstone", r"^red_sandstone$", "D"), ("stone", r"^(stone|andesite|diorite|granite|deepslate|tuff|calcite)$", "x"),
             ("gravel", r"^gravel$", "g"), ("clay", r"^clay$", "c"), ("terracotta", r"^(.*_)?terracotta$", "t"),
             ("dirt", r"^(grass_block|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|mud|moss_block)$", "o"),
             ("snow", r"^(snow_block|powder_snow|ice|packed_ice|blue_ice)$", "n")]


OTHER_NAMES = Counter()  # what counted as "other" ground (reported at the end)


def material(n):
    for name, rx, letter in MATERIALS:
        if re.match(rx, n):
            return name, letter
    return "other", "b"


def column(x, z, y_top):
    """(surface y, kind, material, [(log y, wood)], canopy) of one column, read block by block."""
    logs, canopy = [], False
    for y in range(y_top, y_top - 200, -1):
        b = call(f"/block?x={x}&y={y}&z={z}")
        if b.get("loaded") is False:
            return None
        n = b["block"]
        m = LOG.match(n)
        if m:
            logs.append((y, m.group(1)))
            canopy = True
        elif LEAF.search(n):
            canopy = True
        elif WATER.match(n):
            return y, "water", None, logs, canopy
        elif PASS.search(n):
            continue
        elif n == "lava":
            return y, "lava", None, logs, canopy
        else:
            if material(n)[0] == "other":
                OTHER_NAMES[n] += 1
            return y, "ground", material(n), logs, canopy
    return None


def check_chunk(s, y_top):
    heights, water, lava, logs, low, surface, votes, cells = [], 0, 0, Counter(), Counter(), Counter(), [Counter() for _ in range(16)], [[] for _ in range(16)]
    for dz in range(16):
        for dx in range(16):
            c = column(s["cx"] * 16 + dx, s["cz"] * 16 + dz, y_top)
            if c is None:
                return f"chunk {s['cx']},{s['cz']}: not loaded any more"
            y, kind, mat, col_logs, canopy = c
            cell = (dz // 4) * 4 + dx // 4
            cells[cell].append(y)
            if kind == "water":
                water += 1
                votes[cell]["~"] += 1
            elif kind == "lava":
                lava += 1
                votes[cell]["^"] += 1
            else:
                heights.append(y)
                surface[mat[0]] += 1
                votes[cell]["T" if canopy else mat[1]] += 1
            for ly, wood in col_logs:
                logs[wood] += 1
                if ly - y <= 5:
                    low[wood] += 1
    heights.sort()
    med = heights[len(heights) // 2] if heights else None
    mine = {
        "y": [heights[0], med, heights[-1]] if heights else None,
        "flat": sum(1 for h in heights if abs(h - med) <= 1) if heights else 0,
        "water": water, "lava": lava, "logs": dict(logs), "low": dict(low), "surface": dict(surface),
        "h": [math.floor(sum(c) / len(c) + 0.5) if c else None for c in cells],  # as Math.round (Python rounds halves to even)
    }
    diffs = [f"{k}: atlas {s[k]} vs blocks {v}" for k, v in mine.items() if s[k] != v]
    # Map letters: a tie between two covers may go either way
    for i in range(16):
        top = votes[i].most_common()
        if top and s["s"][i] != top[0][0] and votes[i][s["s"][i]] != top[0][1]:
            diffs.append(f"cell {i}: atlas '{s['s'][i]}' vs blocks {dict(votes[i])}")
    return f"chunk {s['cx']},{s['cz']}: " + ("matches" if not diffs else "DIFFERS: " + "; ".join(diffs))


call("/agents/Gus", method="DELETE")
call("/village", {"name": "AtlasTest", "objective": "atlas test"})
before = call("/atlas?x=0&z=0&radius=16")["status"]
t0 = time.time()
call("/agents", {"name": "Gus", "brain": "idle", "gamemode": "creative", "reset": True, "position": {"x": X + 0.5, "y": 120, "z": Z + 0.5},
                 "memory": {"village": "AtlasTest"}})
time.sleep(8)
print(f"after spawning ({time.time() - t0:.0f} s): {call('/atlas?village=AtlasTest')['status']}  (before: {before})")
t1 = time.time()
for leg in range(0, DISTANCE, 50):  # explore walks at most 50 blocks a call
    print("walk:", act("explore", direction=DIRECTION, distance=min(50, DISTANCE - leg))[:200], f"({time.time() - t1:.0f} s)")
time.sleep(5)
a = call("/atlas?village=AtlasTest&radius=300")
print(f"after the walk: {a['status']}; {len(a['chunks'])} chunks within 300 of {a['centre']}")
# Chunks near Gus (still loaded): one wooded, one with water if any, and a few more
p = call("/agents/Gus/observe?radius=2")["position"]
gx, gz = int(p["x"]) >> 4, int(p["z"]) >> 4
near = [s for s in a["chunks"] if abs(s["cx"] - gx) <= 3 and abs(s["cz"] - gz) <= 3 and s["y"]]
pick = sorted(near, key=lambda s: -sum(s["logs"].values()))[:2] + [s for s in near if s["water"]][:1]
pick += [s for s in near if s not in pick][: 4 - len(pick)]
for s in pick:
    t = time.time()
    y_top = max(h for h in s["h"] if h is not None) + 45
    print(check_chunk(s, y_top), f"({time.time() - t:.0f} s)")
print("final:", call("/atlas?village=AtlasTest")["status"])
print("surface blocks counted as other:", dict(OTHER_NAMES.most_common(12)))
call("/agents/Gus", method="DELETE")
