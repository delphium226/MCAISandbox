"""Trap Gus four ways (pit with dirt to pillar, roofed box, walled water pit, a sealed cobblestone tunnel) and check that
the rescue gets him out.

Run: python scripts/test_rescue.py [pit|box|pool|tunnel ...] (agent server on 8766, or MCAI_API; Paper running). Builds
the traps near -20,-35 with RCON, 30 blocks apart, spawns Gus inside, fails two move_to calls and waits up to 5.5 minutes
for a "Rescue:" event. The pit case usually needs no rescue: the pathfinder pillars out with the dirt it carries. The
tunnel case (F131) must not end "walked out" inside the tunnel ("STILL SEALED"); Gus is in no village there, so it tests
the open-sky rule only (a village member sealed in a mine was tested with VanM6's mine, runs/2026-10-06/f131_village1.log).
Each run cuts the ground a little deeper at the trap sites (F149).
"""
import json, os, subprocess, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = os.environ.get("MCAI_API", "http://127.0.0.1:8766/api")


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()[:300]}


def rcon(cmd):
    return subprocess.run([sys.executable, os.path.join(ROOT, "mc", "rcon.py"), cmd], capture_output=True, text=True).stdout.strip()


def ground(x, z):
    for y in range(110, 40, -1):
        if "passed" in rcon(f"execute unless block {x} {y} {z} #minecraft:replaceable").lower():
            return y
    raise SystemExit(f"no ground at {x},{z}")


def run_case(name, x, z, build, give):
    rcon(f"forceload add {x - 8} {z - 8} {x + 8} {z + 8}")
    time.sleep(1)
    g = ground(x, z)
    # Clear the air above, then build the trap (the tunnel's whole length: hills and trees there are cut, F149)
    rcon(f"fill {x - (16 if name == 'tunnel' else 4)} {g + 1} {z - 4} {x + 4} {g + 8} {z + 4} air")
    stand = build(x, g, z)
    call("/agents/Gus", method="DELETE")
    r = call("/agents", {"name": "Gus", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": x + 0.5, "y": stand, "z": z + 0.5}})
    print(f"[{name}] ground {g}, Gus at {x},{stand},{z}: {r.get('error') or 'spawned'}", flush=True)
    time.sleep(3)
    for item, n in give:
        rcon(f"give Gus {item} {n}")
    seen = 0
    for i in range(2):
        r = call("/agents/Gus/act", {"action": "move_to", "x": x + 40, "y": stand, "z": z})
        if "error" in r:
            raise SystemExit(f"act failed: {r}")
    t0 = time.time()
    outcome = None
    while time.time() - t0 < 330 and not outcome:
        time.sleep(2)
        for e in call(f"/agents/Gus/events?since={seen}") or []:
            seen = e["id"]
            if e["type"] in ("action_failed", "action_done", "system"):
                print(f"  {time.time() - t0:5.1f}s {e['type']}: {e['text'][:260]}", flush=True)
            if e["type"] == "system" and e["text"].startswith("Rescue"):
                outcome = e["text"]
    pos = call("/agents/Gus").get("position") if outcome else None
    # (the tunnel: a rescue that leaves Gus inside the stone shell has not got him out, F131)
    sealed = name == "tunnel" and pos and x - 14 <= pos["x"] < x + 3 and abs(pos["z"] - (z + 0.5)) < 3 and pos["y"] < g + 6
    print(f"[{name}] {'RESCUED' if outcome else 'NO RESCUE'} in {time.time() - t0:.0f}s; now at {pos}"
          f"{' STILL SEALED in the tunnel (F131)' if sealed else ''}", flush=True)
    call("/agents/Gus", method="DELETE")
    rcon(f"fill {x - (16 if name == 'tunnel' else 4)} {g - 3} {z - 4} {x + 4} {g + 8} {z + 4} air replace cobblestone")
    rcon(f"fill {x - 4} {g - 3} {z - 4} {x + 4} {g + 8} {z + 4} air replace water")
    rcon(f"fill {x - 4} {g + 1} {z - 4} {x + 4} {g + 8} {z + 4} air replace dirt")
    rcon(f"forceload remove {x - 8} {z - 8} {x + 8} {z + 8}")


def pit(x, g, z):
    # A 1x1 hole in a 4-high cobblestone ring: no path out, cannot dig cobblestone; climb with dirt
    # A cobblestone shell down into the ground too (walls on the surface only were dug under through the dirt)
    rcon(f"fill {x - 1} {g - 2} {z - 1} {x + 1} {g + 4} {z + 1} cobblestone")
    rcon(f"fill {x} {g + 1} {z} {x} {g + 4} {z} air")
    return g + 1


def box(x, g, z):
    # The same with a roof and nothing to pillar with: the teleport
    pit(x, g, z)
    rcon(f"setblock {x} {g + 3} {z} cobblestone")
    return g + 1


def pool(x, g, z):
    # A 3x3 pool, 3 deep, walled 3 high above the water
    rcon(f"fill {x - 2} {g - 2} {z - 2} {x + 2} {g + 3} {z + 2} cobblestone")
    rcon(f"fill {x - 1} {g - 1} {z - 1} {x + 1} {g + 1} {z + 1} water")
    rcon(f"fill {x - 1} {g + 2} {z - 1} {x + 1} {g + 3} {z + 1} air")
    return g - 1


def tunnel(x, g, z):
    # A mine tunnel sealed at both ends (Minevale19, F131): 1 wide, 2 high, 15 long (x - 13 to x + 1), on the ground, Gus at
    # its east end. Cobblestone stands in for the mine's protected stone (natural stone here the walks dig through). Its
    # walk-out reaches a point 10 blocks west inside the tunnel, which is not getting out
    rcon(f"fill {x - 14} {g + 1} {z - 2} {x + 2} {g + 5} {z + 2} cobblestone")
    rcon(f"fill {x - 13} {g + 2} {z} {x + 1} {g + 3} {z} air")
    return g + 2


cases = {"pit": (pit, [("dirt", 10)]), "box": (box, []), "pool": (pool, []), "tunnel": (tunnel, [])}
only = sys.argv[1:] or list(cases)
bx, bz = -20, -35
for i, n in enumerate(only):
    build, give = cases[n]
    run_case(n, bx + 30 * i, bz, build, give)
