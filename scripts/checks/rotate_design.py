"""Facing blocks turn with the building (phase D, D.1 and D.2): Gus (creative, idle) builds a design at rotate 0, 90, 180
and 270 side by side and the check compares every block with the design turned as build_design turns it.
Usage: python scripts/checks/rotate_design.py X Z Y [--design FILE.json | --style JSON]
(e.g. -1580 -36 64 on the minevale3 test site: four plots eastward from X at ground level Y, each prepared first with
prepare_site y=Y).

The design is by default a 7x7 stair-gabled test house (designs.ts's gable example plus a log beam lying east-west
over the door, a spruce trapdoor shutter (facing=north, open) and oak fences inside); --design takes a Design object
from a JSON file and --style a style for the building generator (buildingGen.ts, e.g. '{"width":7,"depth":9,
"roof":"hip","overhang":1,"walls":"planks","roof_material":"planks"}'). scripts/checks/gen_designs.mts (tsx) works out
what the build should show: each stair's shape by vanilla's rule and each door's way out of its wall. For each cell the
expected block is the palette's, with facing turned clockwise per quarter turn (north -> east -> south -> west) and
axis x <-> z on odd turns; "_" cells are not judged. Compared: the block name and its facing, half, axis, type and open
states and every stair's shape (GET /api/blocks?states=1); fence sides are printed. Gus is removed at the end. Exits
non-zero on any mismatch. Env: MCAI_API (default http://127.0.0.1:8767/api, the test world).
"""
import json, os, subprocess, sys, tempfile, time, urllib.error, urllib.request

sys.stdout.reconfigure(encoding="utf-8")
args = sys.argv[1:]
if len(args) < 3 or any(a in ("-h", "--help") for a in args):
    print(__doc__)
    sys.exit(0 if any(a in ("-h", "--help") for a in args) else 2)

API = os.environ.get("MCAI_API", "http://127.0.0.1:8767/api").rstrip("/")
X, Z, Y = int(args[0]), int(args[1]), int(args[2])
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEST_PALETTE = {"C": "cobblestone", "P": "oak_planks", "L": "oak_log", "G": "glass", "D": "oak_door",
                "N": "oak_stairs[facing=south,half=bottom]", "S": "oak_stairs[facing=north,half=bottom]",
                "B": "oak_log[axis=x]", "T": "spruce_trapdoor[facing=north,half=top,open=true]", "F": "oak_fence"}
TEST_LAYERS = [
    ["CCCCCCC"] * 7,
    ["LPPPPPL", "PFF...P", "P.....P", "P.....P", "P.....P", "P.....P", "LPPDPPL"],
    ["LPGTGPL", "P.....P", "G.....G", "P.....P", "G.....G", "P.....P", "LPG.GPL"],
    ["NNNNNNN", "P.....P", "P.....P", "P.....P", "P.....P", "P.....P", "SSBBBSS"],
    [".......", "NNNNNNN", "P.....P", "P.....P", "P.....P", "SSSSSSS", "......."],
    [".......", ".......", "NNNNNNN", "P.....P", "SSSSSSS", ".......", "......."],
    [".......", ".......", ".......", "PPPPPPP", ".......", ".......", "......."],
]
CLOCKWISE = {"north": "east", "east": "south", "south": "west", "west": "north"}
JUDGED = ("facing", "half", "axis", "type", "open")


def expected(source):
    """The design and what its build should show, from gen_designs.mts (STYLE= or DESIGN=, OUT=)."""
    out = os.path.join(tempfile.gettempdir(), f"rotate_design_{os.getpid()}.json")
    env = dict(os.environ, OUT=out, **source)
    tsx = os.path.join(ROOT, "node_modules", ".bin", "tsx.cmd" if os.name == "nt" else "tsx")
    subprocess.run([tsx, os.path.join(ROOT, "scripts", "checks", "gen_designs.mts")], env=env, check=True, cwd=ROOT)
    with open(out, encoding="utf-8") as f:
        data = json.load(f)
    os.remove(out)
    return data


if "--style" in args:
    data = expected({"STYLE": args[args.index("--style") + 1]})
    data["design"]["name"] = "rotatetest"
else:
    if "--design" in args:
        path = args[args.index("--design") + 1]
    else:
        path = os.path.join(tempfile.gettempdir(), f"rotate_design_in_{os.getpid()}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"name": "rotatetest", "description": "stair-roofed rotation test house", "palette": TEST_PALETTE,
                       "layers": TEST_LAYERS, "width": 7, "depth": 7, "height": len(TEST_LAYERS), "by": "check",
                       "blocks": sum(1 for l in TEST_LAYERS for r in l for c in r if c not in "._")}, f)
    data = expected({"DESIGN": path})
    data["design"]["name"] = "rotatetest"
design, SHAPES, DOORS = data["design"], data["shapes"], data["doors"]
PALETTE, LAYERS = design["palette"], design["layers"]
W, D, H = design["width"], design["depth"], len(design["layers"])
STEP = max(14, max(W, D) + 5)


def call(path, body=None, method=None, timeout=60):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def act(action, limit=240, **kw):
    ev = call("/agents/Gus/events")
    last = max([e["id"] for e in ev] or [0]) if isinstance(ev, list) else 0
    call("/agents/Gus/act", {"action": action, **kw})
    t = time.time()
    while time.time() - t < limit:
        time.sleep(1)
        evs = call(f"/agents/Gus/events?since={last}")
        for e in evs if isinstance(evs, list) else []:
            last = max(last, e["id"])
            if e["type"] in ("action_done", "action_failed"):
                return e["type"], e["text"]
    return "timeout", f"no result in {limit} s"


def parse(block):
    name, _, rest = block.partition("[")
    props = dict(p.split("=") for p in rest.rstrip("]").split(",") if "=" in p)
    return name, props


def turn_cell(i, j, rot):
    # mcBuild.ts buildDesign `turn`: clockwise, (u, v) -> (h - 1 - v, u) per quarter turn
    u, v, w, h = i, j, W, D
    for _ in range(rot):
        u, v, w, h = h - 1 - v, u, h, w
    return u, v


def turn_props(props, rot):
    out = {}
    for k, v in props.items():
        for _ in range(rot):
            if k == "facing" and v in CLOCKWISE:
                v = CLOCKWISE[v]
            elif k == "axis" and v in ("x", "z"):
                v = "z" if v == "x" else "x"
        out[k] = v
    return out


def turn_dir(d, rot):
    for _ in range(rot):
        d = CLOCKWISE[d]
    return d


call("/agents/Gus", method="DELETE")
spawn = call("/agents", {"name": "Gus", "brain": "idle", "gamemode": "creative", "reset": True, "position": {"x": X + 0.5, "y": Y + 2, "z": Z + 0.5}})
if not isinstance(spawn, dict) or spawn.get("error"):
    sys.exit(f"spawn failed: {spawn}")
time.sleep(8)
call("/agents/Gus/memory", {"designs": {"rotatetest": design}, "buildSpeed": 4})
print(f"design {W}x{D}x{H}, {len(SHAPES)} stairs ({', '.join(f'{s} {list(SHAPES.values()).count(s)}' for s in sorted(set(SHAPES.values())))}), doors {DOORS}")
bad = 0
for rot in range(4):
    cx = X + rot * STEP
    print(f"\n== rotate {rot * 90} at {cx},{Z}")
    TW, TD = (D, W) if rot % 2 else (W, D)
    k, t = act("prepare_site", x=cx, z=Z, width=TW + 2, depth=TD + 2, y=Y)
    print(f"prepare_site: {k}: {t[:160]}")
    k, t = act("build_design", design="rotatetest", x=cx, z=Z, rotate=rot * 90)
    print(f"build_design: {k}: {t[:200]}")
    if k != "action_done":
        bad += 1
        continue
    x1, z1 = cx - TW // 2, Z - TD // 2
    r = call(f"/blocks?x1={x1}&y1={Y - 2}&z1={z1}&x2={x1 + TW - 1}&y2={Y + H + 3}&z2={z1 + TD - 1}&states=1")
    names, cells = r["names"], r["cells"]

    def at(x, y, z):
        c = cells[((y - (Y - 2)) * TD + (z - z1)) * TW + (x - x1)]
        return names[c] if c >= 0 else None

    def score(y0):
        n = 0
        for li, layer in enumerate(LAYERS):
            for j, row in enumerate(layer):
                for i, ch in enumerate(row):
                    if ch in "._":
                        continue
                    ox, oz = turn_cell(i, j, rot)
                    if y0 + li <= Y + H + 3 and parse(at(x1 + ox, y0 + li, z1 + oz) or "?")[0] == parse(PALETTE[ch])[0]:
                        n += 1
        return n
    # The floor level: the y where most of the design's blocks match
    y0 = max(range(Y - 2, Y + 3), key=score)
    mism, fences, shapes = [], {}, {}
    for li, layer in enumerate(LAYERS):
        for j, row in enumerate(layer):
            for i, ch in enumerate(row):
                if ch == "_":
                    continue
                ox, oz = turn_cell(i, j, rot)
                got = at(x1 + ox, y0 + li, z1 + oz)
                gname, gprops = parse(got or "?")
                if ch == ".":
                    # A door's upper half stands on the "." above it
                    door_below = li > 0 and "_door" in PALETTE.get(LAYERS[li - 1][j][i], "")
                    if door_below and gname.endswith("_door") and gprops.get("half") == "upper":
                        continue
                    if gname not in ("air", "cave_air"):
                        mism.append(f"L{li} r{j} c{i}: want air, got {got}")
                    continue
                wname, wprops = parse(PALETTE[ch])
                if wname.endswith("_door"):
                    out = turn_dir(DOORS.get(f"{i},{j}", "south"), rot) if li == 1 else None
                    if gname != wname or (out and gprops.get("facing") != out):
                        mism.append(f"L{li} r{j} c{i}: want door facing {out}, got {got}")
                    continue
                want = turn_props(wprops, rot)
                if gname != wname or any(gprops.get(k) != v for k, v in want.items() if k in JUDGED):
                    mism.append(f"L{li} r{j} c{i}: want {wname}{want}, got {got}")
                shape = SHAPES.get(f"{li},{i},{j}")
                if shape:
                    shapes[shape] = shapes.get(shape, 0) + 1
                    if gprops.get("shape") != shape:
                        mism.append(f"L{li} r{j} c{i}: want shape {shape}, got {got}")
                if wname.endswith("_fence"):
                    fences["fence " + ",".join(k for k in ("north", "east", "south", "west") if gprops.get(k) == "true")] = 1
    print(f"floor y={y0}; {len(mism)} mismatches; stair shapes judged: {shapes}; fence sides: {list(fences)}")
    for m in mism[:12]:
        print("  " + m)
    bad += 1 if mism else 0
call("/agents/Gus", method="DELETE")
print(f"\nGus removed; {'PASS' if not bad else f'FAIL ({bad} of 4 rotations)'}")
sys.exit(1 if bad else 0)
