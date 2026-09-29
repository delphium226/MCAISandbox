"""Smelting tops its fuel up from further stacks: 4 sand, a furnace, 1 oak plank and 5 spruce planks -> 4 glass.
Usage: python scripts/checks/smelt_fuel.py (Gus, survival, near -337,-66).
"""
import json, os, subprocess, sys, time, urllib.request

API = "http://127.0.0.1:8766/api"
RCON = [sys.executable, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "mc", "rcon.py")]


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


rc = lambda cmd: subprocess.run(RCON + [cmd], capture_output=True, text=True).stdout.strip()
call("/agents/Gus", method="DELETE")
call("/agents", {"name": "Gus", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": -337.5, "y": 90, "z": -66.5}})
time.sleep(10)
rc("clear Gus")
for item, n in (("oak_planks", 1), ("sand", 4), ("furnace", 1), ("spruce_planks", 5)):
    print(rc(f"give Gus {item} {n}"))
time.sleep(2)
last = max([e["id"] for e in call("/agents/Gus/events")] or [0])
call("/agents/Gus/act", {"action": "smelt", "item": "sand", "count": 4})
for _ in range(120):
    time.sleep(1)
    done = [e for e in call("/agents/Gus/events") if e["id"] > last and e["type"] in ("action_done", "action_failed")]
    if done:
        print(done[-1]["type"], done[-1]["text"])
        break
print("server count of glass:", rc("clear Gus glass 0"))
call("/agents/Gus", method="DELETE")
