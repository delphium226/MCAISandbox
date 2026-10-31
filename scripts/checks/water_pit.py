"""#181 live: a member dropped into a sealed water pocket with a 1x1 hole above it (train 14's D drowning pit at
-1682,59,-3: a hole dug from the lake shore's grass into a water pocket under it) must be got out alive, by mcRescue's
outOfWater (a walk to dry ground, else a teleport home), not left swimming up for minutes.

Needs a test agent server with damage on (MC_WORLD_MODE=damage) and the member spawned. Builds, 12 blocks east of the
member: a stone box 5x5x7 below the surface, a 3x3x4 water pocket in it, and a 1x1 air shaft 2 deep from the pocket's
top to the surface (as in D: the water's top is 2 blocks below the rim, so no swim reaches the rim); then teleports the
member to the pocket's bottom and follows it for up to --wait seconds.

Usage: MCAI_API=http://127.0.0.1:8770/api MC_SERVER_DIR=mc/testserver4 python scripts/checks/water_pit.py NAME [--wait 150] [--hold]
  --hold  give the member a long wait action first, as train 14's drowned members had actions that never failed: then only
          the hazard reflex can get it out (without it, two failed walks in the pocket call the stuck rescue first)
Ends with a WATER PIT line: OK when the member's rescues show a water rescue and it did not drown.
"""
import argparse, json, os, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "mc"))
import rcon  # noqa: E402 (MC_SERVER_DIR picks the test world's server)

API = os.environ.get("MCAI_API", "http://127.0.0.1:8770/api").rstrip("/")


def get(path):
    with urllib.request.urlopen(API + path, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--wait", type=float, default=150)
    ap.add_argument("--dx", type=int, default=12)
    ap.add_argument("--hold", action="store_true")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    me = None
    for _ in range(120):
        try:
            me = next((x for x in get("/agents") if x["name"].lower() == a.name.lower() and x.get("position")), None)
        except Exception:
            me = None
        if me:
            break
        time.sleep(5)
    if not me:
        print(f"WATER PIT FAIL: {a.name} is not spawned")
        return 1
    p = me["position"]
    x, y, z = int(p["x"] // 1) + a.dx, int(p["y"] // 1), int(p["z"] // 1)
    before = get(f"/agents/{a.name}/memory")
    deaths0 = sum((before.get("deaths") or {}).values())
    if a.hold:
        req = urllib.request.Request(f"{API}/agents/{a.name}/act", data=json.dumps({"action": "wait", "seconds": 240, "replace": True}).encode(), headers={"Content-Type": "application/json"}, method="POST")
        print("hold:", urllib.request.urlopen(req, timeout=20).read().decode()[:120], flush=True)
    for c in [
        f"fill {x - 2} {y - 7} {z - 2} {x + 2} {y - 1} {z + 2} stone",
        f"fill {x - 1} {y - 6} {z - 1} {x + 1} {y - 3} {z + 1} water",
        f"fill {x} {y - 2} {z} {x} {y - 1} {z} air",
        f"tp {a.name} {x + 0.5} {y - 6} {z + 0.5}",
    ]:
        print(c, "->", rcon.command(c).strip(), flush=True)
    t0 = time.time()
    print(f"{a.name} dropped into the pocket at {x},{y - 6},{z} (rim at y {y})", flush=True)
    got = None
    while time.time() - t0 < a.wait:
        time.sleep(3)
        m = get(f"/agents/{a.name}/memory")
        r = m.get("rescues") or {}
        ag = next((q for q in get("/agents") if q["name"].lower() == a.name.lower()), {})
        q = ag.get("position") or {}
        if sum((m.get("deaths") or {}).values()) > deaths0:
            print(f"WATER PIT FAIL: {a.name} died ({m.get('lastDeath')}) after {time.time() - t0:.0f} s")
            return 1
        n = sum(v for k, v in r.items() if k.startswith("water-") and isinstance(v, (int, float)))
        n0 = sum(v for k, v in (before.get("rescues") or {}).items() if k.startswith("water-") and isinstance(v, (int, float)))
        if n > n0:
            got = r.get("last")
            print(f"rescued after {time.time() - t0:.0f} s: {got}; now at {q.get('x', 0):.1f},{q.get('y', 0):.1f},{q.get('z', 0):.1f}", flush=True)
            break
    if not got:
        print(f"WATER PIT FAIL: no water rescue within {a.wait:.0f} s")
        return 1
    time.sleep(20)
    m = get(f"/agents/{a.name}/memory")
    if sum((m.get("deaths") or {}).values()) > deaths0:
        print(f"WATER PIT FAIL: {a.name} died after the rescue ({m.get('lastDeath')})")
        return 1
    print("WATER PIT OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
