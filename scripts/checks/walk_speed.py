"""Walking speed (plan step T.1): Gus walks the same 14 legs on StageM8's prepared plot in the main world (floor y 68,
x -1484..-1466, z 324..344), and the total time is compared between game speeds (MC_TIME_SCALE on the agent server).
Usage: python scripts/checks/walk_speed.py      (env MCAI_API, default http://127.0.0.1:8766/api)
10-01: 48.8 s at 1x, 25.1 s at 2x (1.94x). Gus spawns at the mining hut, the legs use the free points of the plot
(air at y 69 and 70 over ground); he is removed at the end.
"""
import json, os, sys, time, urllib.error, urllib.request

API = os.environ.get("MCAI_API", "http://127.0.0.1:8766/api")


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def free(x, z):
    a = call(f"/block?x={x}&y=69&z={z}")
    b = call(f"/block?x={x}&y=70&z={z}")
    g = call(f"/block?x={x}&y=68&z={z}")
    return a.get("block") == "air" and b.get("block") == "air" and g.get("block") not in (None, "air")


def act(action, **args):
    last = max([e["id"] for e in call("/agents/Gus/events")] or [0])
    t = time.time()
    call("/agents/Gus/act", {"action": action, **args})
    while time.time() - t < 120:
        time.sleep(0.2)
        done = [e for e in call("/agents/Gus/events") if e["id"] > last and e["type"] in ("action_done", "action_failed")]
        if done:
            return time.time() - t, done[-1]["text"]
    return time.time() - t, "(timeout)"


status = call("/status")
print("server:", status.get("worldRules", {}).get("summary"))
call("/agents/Gus", method="DELETE")
r = call("/agents", {"name": "Gus", "role": "worker", "brain": "idle", "gamemode": "survival", "reset": True,
                     "position": {"x": -1470.5, "y": 69, "z": 330.5}})
if "name" not in r:
    raise SystemExit(f"could not spawn Gus: {r}")
time.sleep(6)
pts = []
for x, z in [(-1467, 343), (-1483, 343), (-1483, 325), (-1467, 325), (-1475, 343), (-1475, 325), (-1467, 334), (-1483, 336)]:
    if free(x, z):
        pts.append((x, z))
print("free points:", pts)
if len(pts) < 2:
    raise SystemExit("not enough free points")
dt, text = act("move_to", x=pts[0][0], y=69, z=pts[0][1])
print(f"to start: {dt:.1f} s {text[:80]}")
legs = (pts[1:] + pts[:1]) * 2
total = 0.0
for x, z in legs:
    dt, text = act("move_to", x=x, y=69, z=z)
    total += dt
    print(f"move_to {x},{z}: {dt:.1f} s  {text[:90]}", flush=True)
print(f"total {total:.1f} s over {len(legs)} legs")
call("/agents/Gus", method="DELETE")
