"""The deep chain (#22, MC_DIAMOND_AGE): the iron chain's stairs and levels below y 0 dug as their record says, nothing dug
open to lava, and no bot left down there.
Usage: python scripts/checks/deep_dig.py VILLAGE [--end]   (MC_SERVER_DIR: the server folder, default mc/testserver; it
reads that folder's villages.json, so run it while the agent server is up or after it saved)
Over RCON (`execute if block`), for every level of the chain (`mine.ironPast` and `mine.iron`) whose stairs reach below
y 0:
  (a) every step dug: the three cells over each step open (air, a torch or a ladder), the step itself a block;
  (b) every open cell of the level's tunnel pattern (each leg's main cells and branches, bounded by its dug count: the
      iron level's cells follow one counter, not a per-part record) has no lava on any face, nor do the stairs' cells;
      and how many are open, beside the level's own `dug` count;
  (c) with --end: no player below y 40 (lesson 101: a trip ends above ground, teleported if its walk up failed).
Prints the chain (each level's start, aim, steps, level, finished) and ends with a DEEPCHECK line; exits non-zero on any
FAIL.
"""
import json, os, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "mc"))
from rcon import Rcon

sys.stdout.reconfigure(encoding="utf-8")
args = [a for a in sys.argv[1:] if not a.startswith("--")]
if not args:
    raise SystemExit(__doc__)
VILLAGE, END = args[0], "--end" in sys.argv
SERVER = os.environ.get("MC_SERVER_DIR", os.path.join(ROOT, "mc", "testserver"))
vs = json.load(open(os.path.join(SERVER, "villages.json"), encoding="utf-8"))["villages"]
vs = vs if isinstance(vs, list) else list(vs.values())
v = next((x for x in vs if x["name"] == VILLAGE), None)
if not v or not (v.get("mine") or {}).get("iron"):
    raise SystemExit(f"DEEPCHECK FAIL: no village {VILLAGE} with an iron chain in {SERVER}/villages.json")
m = v["mine"]
chain = list(m.get("ironPast") or []) + [m["iron"]]
print(f"{VILLAGE}: ladder {json.dumps({k: (v.get('ladder') or {}).get(k) for k in ('current', 'stage', 'count', 'totals')})}")
for n, i in enumerate(chain):
    print(f"  level {n}: start {i['x']},{i['y']},{i['z']} dir {i['dir']} aim {i.get('targetY')} steps {i['steps']} level {i.get('level')} "
          f"dug {i['dug'] - (i.get('dugAt') or 0)} diamond {bool(i.get('diamond'))} given up {len(i.get('abandoned') or [])} finished {str(i.get('finished'))[:70]!r}")
    for d in (i.get("abandoned") or [])[-4:]:
        print(f"      given up: {d['x']},{d['y']},{d['z']} {d['dir']} after {d['steps']} steps: {d['why'][:80]}")
print(f"  got: {json.dumps({k: n for k, n in chain[-1].get('got', {}).items() if 'diamond' in k or k in ('raw_iron', 'redstone', 'lapis_lazuli')})}")

rc = Rcon(SERVER)
def is_(x, y, z, b):
    return "passed" in rc.send(2, f"execute if block {x} {y} {z} {b}")[1].lower()
OPEN_OK = ["#minecraft:air", "minecraft:torch", "minecraft:wall_torch", "minecraft:ladder"]
def opened(x, y, z):
    return any(is_(x, y, z, b) for b in OPEN_OK)
def lava_by(x, y, z):
    return [f"{x + a},{y + b},{z + c}" for a, b, c in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, 1, 0), (0, -1, 0)) if is_(x + a, y + b, z + c, "minecraft:lava")]

fails, notes = [], []
deep = [i for i in chain if i["y"] - i["steps"] < 0 or (i.get("level") is not None and i["level"] < 0)]
if not deep:
    print("DEEPCHECK FAIL: no level of the chain reaches below y 0")
    sys.exit(1)
stairs = cells = 0
for n, i in enumerate(deep):
    dx, dz = i["dir"]
    foot = (i["x"] + dx * i["steps"], i["z"] + dz * i["steps"])
    box = (min(i["x"], foot[0]) - 34, min(i["z"], foot[1]) - 34, max(i["x"], foot[0]) + 34, max(i["z"], foot[1]) + 34)
    rc.send(2, f"forceload add {box[0]} {box[1]} {box[2]} {box[3]}")
    time.sleep(3)
    for k in range(1, i["steps"] + 1):
        x, z, fl = i["x"] + dx * k, i["z"] + dz * k, i["y"] - 1 - k
        for h in (1, 2, 3):
            stairs += 1
            if not opened(x, fl + h, z):
                fails.append(f"(a) {n} step {k}: {x},{fl + h},{z} not open")
            elif lava_by(x, fl + h, z):
                fails.append(f"(b) {n} step {k}: {x},{fl + h},{z} open to lava at {lava_by(x, fl + h, z)}")
        if is_(x, fl, z, "#minecraft:air"):
            fails.append(f"(a) {n} step {k}: no block under it at {x},{fl},{z}")
    L = i.get("level")
    if L is None:
        continue
    # (the tunnels' own pattern from each leg's record, bounded by its dug count: main cells and the branches off every
    # third, as mcMine's tunnelCell; a cave's air elsewhere is the land's, not the mine's)
    pat = set()
    for l in i.get("legs") or []:
        ldx, ldz, d = l["dir"][0], l["dir"][1], max(l.get("dug", 0), l.get("main", 0) or 0)
        for k in range(0, d + 1):
            pat.add((l["x"] + ldx * k, l["z"] + ldz * k))
        for k in range(3, d + 1, 3):
            for bx, bz in ((ldz, -ldx), (-ldz, ldx)):
                for j in range(1, 13):
                    pat.add((l["x"] + ldx * k + bx * j, l["z"] + ldz * k + bz * j))
    opens = 0
    for x, z in sorted(pat):
        if not (is_(x, L, z, "#minecraft:air") and is_(x, L + 1, z, "#minecraft:air")) or is_(x, L - 1, z, "#minecraft:air"):
            continue
        opens += 1
        for h in (0, 1):
            lv = lava_by(x, L + h, z)
            if lv:
                fails.append(f"(b) level y={L}: {x},{L + h},{z} open to lava at {lv}")
    cells += opens
    notes.append(f"level y={L}: {opens} of {len(pat)} pattern cells open two high, its record {i['dug'] - (i.get('dugAt') or 0)} dug")
    rc.send(2, f"forceload remove {box[0]} {box[1]} {box[2]} {box[3]}")
if END:
    r = rc.send(2, "execute if entity @a[y=-64,dy=103]")[1]
    down = int(r.split("count:")[-1].strip()) if "count:" in r else 0
    if down:
        fails.append(f"(c) {down} players below y 40 at the end")
for s in notes:
    print("  " + s)
for f in fails[:30]:
    print("FAIL", f)
print(f"DEEPCHECK {'FAIL' if fails else 'OK'}: {len(deep)} levels below y 0 (deepest {min((i.get('level') if i.get('level') is not None else i['y'] - i['steps']) for i in chain)}), "
      f"{stairs} stair cells, {cells} level cells checked; {len(fails)} failures")
sys.exit(1 if fails else 0)
