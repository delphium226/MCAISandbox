"""Facing blocks turn with the building (phase D, D.1): Gus (creative, idle) builds a stair-roofed test house at rotate
0, 90, 180 and 270 side by side and the check compares every block with the design turned as build_design turns it.
Usage: python scripts/checks/rotate_design.py X Z Y (e.g. -1580 -36 64 on the minevale3 test site: four plots 14 apart
eastward from X at ground level Y, prepared first with prepare_site y=Y).

The design is designs.ts's 7x7 gable example plus a log beam lying east-west (oak_log[axis=x]) over the door, a
spruce trapdoor shutter (facing=north, open) and oak fences inside. For each cell the expected block is the palette's,
with facing turned clockwise per quarter turn (north -> east -> south -> west) and axis x <-> z on odd turns; doors face
out of their wall. Compared: the block name and its facing, half, axis, type and open states (GET /api/blocks?states=1);
stair shapes and fence sides are the server's and are printed, not judged. Gus is removed at the end. Exits non-zero on
any mismatch. Env: MCAI_API (default http://127.0.0.1:8767/api, the test world).
"""
import json, os, sys, time, urllib.error, urllib.request

sys.stdout.reconfigure(encoding="utf-8")
if len(sys.argv) < 4 or any(a in ("-h", "--help") for a in sys.argv[1:]):
    print(__doc__)
    sys.exit(0 if any(a in ("-h", "--help") for a in sys.argv[1:]) else 2)

API = os.environ.get("MCAI_API", "http://127.0.0.1:8767/api").rstrip("/")
X, Z, Y = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
STEP = 14

PALETTE = {"C": "cobblestone", "P": "oak_planks", "L": "oak_log", "G": "glass", "D": "oak_door",
           "N": "oak_stairs[facing=south,half=bottom]", "S": "oak_stairs[facing=north,half=bottom]",
           "B": "oak_log[axis=x]", "T": "spruce_trapdoor[facing=north,half=top,open=true]", "F": "oak_fence"}
LAYERS = [
    ["CCCCCCC"] * 7,
    ["LPPPPPL", "PFF...P", "P.....P", "P.....P", "P.....P", "P.....P", "LPPDPPL"],
    ["LPGTGPL", "P.....P", "G.....G", "P.....P", "G.....G", "P.....P", "LPG.GPL"],
    ["NNNNNNN", "P.....P", "P.....P", "P.....P", "P.....P", "P.....P", "SSBBBSS"],
    [".......", "NNNNNNN", "P.....P", "P.....P", "P.....P", "SSSSSSS", "......."],
    [".......", ".......", "NNNNNNN", "P.....P", "SSSSSSS", ".......", "......."],
    [".......", ".......", ".......", "PPPPPPP", ".......", ".......", "......."],
]
W = D = 7
H = len(LAYERS)
CLOCKWISE = {"north": "east", "east": "south", "south": "west", "west": "north"}
JUDGED = ("facing", "half", "axis", "type", "open")


def call(path, body=None, method=None, timeout=60):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def act(action, limit=240, **args):
    ev = call("/agents/Gus/events")
    last = max([e["id"] for e in ev] or [0]) if isinstance(ev, list) else 0
    call("/agents/Gus/act", {"action": action, **args})
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


design = {"name": "rotatetest", "description": "stair-roofed rotation test house", "palette": PALETTE, "layers": LAYERS,
          "width": W, "depth": D, "height": H, "by": "check",
          "blocks": sum(1 for l in LAYERS for r in l for c in r if c != ".")}
call("/agents/Gus", method="DELETE")
spawn = call("/agents", {"name": "Gus", "brain": "idle", "gamemode": "creative", "reset": True, "position": {"x": X + 0.5, "y": Y + 2, "z": Z + 0.5}})
if not isinstance(spawn, dict) or spawn.get("error"):
    sys.exit(f"spawn failed: {spawn}")
time.sleep(8)
call("/agents/Gus/memory", {"designs": {"rotatetest": design}, "buildSpeed": 4})
bad = 0
for rot in range(4):
    cx = X + rot * STEP
    print(f"\n== rotate {rot * 90} at {cx},{Z}")
    k, t = act("prepare_site", x=cx, z=Z, width=9, depth=9, y=Y)
    print(f"prepare_site: {k}: {t[:160]}")
    k, t = act("build_design", design="rotatetest", x=cx, z=Z, rotate=rot * 90)
    print(f"build_design: {k}: {t[:200]}")
    if k != "action_done":
        bad += 1
        continue
    x1, z1 = cx - W // 2, Z - D // 2
    r = call(f"/blocks?x1={x1}&y1={Y - 2}&z1={z1}&x2={x1 + W - 1}&y2={Y + H + 3}&z2={z1 + D - 1}&states=1")
    names, cells = r["names"], r["cells"]
    ny = Y + H + 3 - (Y - 2) + 1

    def at(x, y, z):
        c = cells[((y - (Y - 2)) * D + (z - z1)) * W + (x - x1)]
        return names[c] if c >= 0 else None
    # The floor level: the y where the design's floor (cobblestone) fills the footprint
    y0 = next((y for y in range(Y - 2, Y + 4) if all((at(x1 + i, y, z1 + j) or "").startswith("cobblestone") for i in range(W) for j in range(D))), None)
    if y0 is None:
        print("FAIL no cobblestone floor found")
        bad += 1
        continue
    mism, shapes = [], {}
    for li, layer in enumerate(LAYERS):
        for j, row in enumerate(layer):
            for i, ch in enumerate(row):
                ox, oz = turn_cell(i, j, rot)
                got = at(x1 + ox, y0 + li, z1 + oz)
                gname, gprops = parse(got or "?")
                if ch == ".":
                    # A door's upper half stands on the "." above it
                    door_below = li > 0 and LAYERS[li - 1][j][i] == "D"
                    if door_below and gname == "oak_door" and gprops.get("half") == "upper":
                        continue
                    if gname not in ("air", "cave_air"):
                        mism.append(f"L{li} r{j} c{i}: want air, got {got}")
                    continue
                wname, wprops = parse(PALETTE[ch])
                if wname == "oak_door":
                    out = "west" if ox == 0 else "east" if ox == W - 1 else "north" if oz == 0 else "south"
                    if gname != wname or gprops.get("facing") != out:
                        mism.append(f"L{li} r{j} c{i}: want door facing {out}, got {got}")
                    continue
                want = turn_props(wprops, rot)
                if gname != wname or any(gprops.get(k) != v for k, v in want.items() if k in JUDGED):
                    mism.append(f"L{li} r{j} c{i}: want {wname}{want}, got {got}")
                if "shape" in gprops:
                    shapes[gprops["shape"]] = shapes.get(gprops["shape"], 0) + 1
                if wname == "oak_fence":
                    shapes["fence " + ",".join(k for k in ("north", "east", "south", "west") if gprops.get(k) == "true")] = 1
    print(f"floor y={y0}; {len(mism)} mismatches; stair shapes and fence sides: {shapes}")
    for m in mism[:12]:
        print("  " + m)
    bad += 1 if mism else 0
call("/agents/Gus", method="DELETE")
print(f"\nGus removed; {'PASS' if not bad else f'FAIL ({bad} of 4 rotations)'}")
sys.exit(1 if bad else 0)
