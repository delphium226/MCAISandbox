"""A new mine (#8, MC_MORE_MINES): its stairs and tunnels dug as its record says, and nothing beside the stairs.
Usage: python scripts/checks/more_mines.py VILLAGE   (MC_SERVER_DIR: the server folder, default mc/testserver; it reads
that folder's villages.json, so run it while the agent server is up or after it saved)
Over RCON (`execute if block`), for the village's current mine, which must have been opened after another (`before`):
  (a) every step dug: the three cells over each step are air and the step itself is a block;
  (b) every tunnel cell the record counts as dug (main cells and each branch's cells, kept per part) is open two high;
  (c) beside the stairs (one column either side, from the fourth step down, where they are underground) still solid:
      a WARN for each open cell (a cave can be open there; many mean the stairs were cut wider);
  (d) the old mines' records: none of their tunnel counts grew after the new mine was opened is not knowable from the
      record alone, so (d) only lists them.
Ends with a MORECHECK line; exits non-zero on any FAIL.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "mc"))
from rcon import Rcon

sys.stdout.reconfigure(encoding="utf-8")
if len(sys.argv) < 2:
    raise SystemExit(__doc__)
VILLAGE = sys.argv[1]
SERVER = os.environ.get("MC_SERVER_DIR", os.path.join(ROOT, "mc", "testserver"))
STEP, BRANCH = 3, 12

vs = json.load(open(os.path.join(SERVER, "villages.json"), encoding="utf-8"))["villages"]
vs = vs if isinstance(vs, list) else list(vs.values())
v = next((x for x in vs if x["name"] == VILLAGE), None)
if not v or not v.get("mine"):
    raise SystemExit(f"FAIL: no village {VILLAGE} with a mine in {SERVER}/villages.json")
m = v["mine"]
fails, warns = [], []
if not m.get("before"):
    print(f"MORECHECK FAIL: {VILLAGE}'s mine was not opened after another (no `before`)")
    sys.exit(1)
print(f"mine {len(m['before']) + 1} of {VILLAGE}: opened by {m.get('openedBy')} at {m['top']['x']},{m.get('floor')},{m['top']['z']} "
      f"heading {m['dir']}, {m['steps']} steps, level {m.get('level')}, dug {m['dug']}, stopped {m.get('stopped')!r}")
for i, b in enumerate(m["before"]):
    print(f"  before {i + 1}: top {b['top']['x']},{b['top']['z']} level {b.get('level')} dug {b['dug']} stopped {str(b.get('stopped'))[:80]!r}")

rc = Rcon(SERVER)
def air(x, y, z):
    return "passed" in rc.send(2, f"execute if block {x} {y} {z} #minecraft:air")[1].lower()

def is_(x, y, z, b):
    return "passed" in rc.send(2, f"execute if block {x} {y} {z} {b}")[1].lower()

# What a tunnel cell may hold once dug besides air: the mine's torches (lighting) and a ladder
OPEN_OK = ["minecraft:torch", "minecraft:wall_torch", "minecraft:ladder"]
# What to name a closed cell as (the first that matches)
NAMES = ["minecraft:cobblestone", "minecraft:dirt", "minecraft:stone", "#minecraft:base_stone_overworld", "minecraft:gravel", "#minecraft:planks",
         "minecraft:water", "minecraft:lava", "#minecraft:logs"]

def what(x, y, z):
    return next((n for n in NAMES if is_(x, y, z, n)), "something else")

def opened(x, y, z):
    return air(x, y, z) or any(is_(x, y, z, b) for b in OPEN_OK)

y0, (dx, dz) = m["floor"], m["dir"]
# (the mine's chunks loaded for the check: with no bot there, `execute if block` fails in an unloaded chunk)
xs = [m["top"]["x"]] + [l["x"] for l in m.get("legs") or []]
zs = [m["top"]["z"]] + [l["z"] for l in m.get("legs") or []]
FL = (min(xs) - 60, min(zs) - 60, max(xs) + 60, max(zs) + 60)
print(rc.send(2, f"forceload add {FL[0]} {FL[1]} {FL[2]} {FL[3]}")[1][:120])
import time; time.sleep(3)
stairs = 0
for i in range(1, m["steps"] + 1):
    x, z, fl = m["top"]["x"] + dx * (i - 1), m["top"]["z"] + dz * (i - 1), y0 - i
    for h in (1, 2, 3):
        stairs += 1
        if not opened(x, fl + h, z):
            fails.append(f"(a) step {i}: {x},{fl + h},{z} not open ({what(x, fl + h, z)})")
    if air(x, fl, z):
        fails.append(f"(a) step {i}: no block under it at {x},{fl},{z}")
    if 4 <= i < m["steps"]:  # (tunnels turn off the bottom step)
        for s in (1, -1):
            for h in (1, 2):
                if air(x + dz * s, fl + h, z + dx * s):
                    warns.append(f"(c) beside step {i}: {x + dz * s},{fl + h},{z + dx * s} open")

def cells(l):
    """The tunnel's dug cells by its per-part record (S.2), as mcMine.ts's legCells."""
    ldx, ldz = l["dir"]
    mn, br = l.get("main", 0), l.get("br") or {}
    out = [(l["x"] + ldx * i, l["z"] + ldz * i) for i in range(1, mn + 1)]
    for s in range(mn // STEP):
        k = STEP * (s + 1)
        for b in (3 * s + 1, 3 * s + 2):
            bx, bz = (ldz, -ldx) if b % 3 == 1 else (-ldz, ldx)
            for j in range(1, min(BRANCH, br.get(str(b), 0)) + 1):
                out.append((l["x"] + ldx * k + bx * j, l["z"] + ldz * k + bz * j))
    return out

tun = 0
for n, l in enumerate(m.get("legs") or []):
    if l.get("br") is None:
        continue
    for x, z in cells(l):
        tun += 1
        for h in (0, 1):
            if not opened(x, l["y"] + h, z):
                fails.append(f"(b) tunnel {n}: {x},{l['y'] + h},{z} not open ({what(x, l['y'] + h, z)})")
rc.send(2, f"forceload remove {FL[0]} {FL[1]} {FL[2]} {FL[3]}")
for f in fails[:30]:
    print("FAIL", f)
for w in warns[:15]:
    print("WARN", w)
print(f"MORECHECK {'FAIL' if fails else 'OK'}: {stairs} stair cells, {tun} tunnel cells checked; {len(fails)} failures, {len(warns)} open beside the stairs")
sys.exit(1 if fails else 0)
