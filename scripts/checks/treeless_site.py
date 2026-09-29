"""At Accept7's desert site: find_site should not settle on ground whose only wood is buried; plan_layout there refuses.
Usage: python scripts/checks/treeless_site.py (Gus at Accept7's desert site; rename DesertTest to rerun).
"""
import json, time, urllib.request

API = "http://127.0.0.1:8766/api"


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
    for _ in range(120):
        time.sleep(1)
        done = [e for e in call("/agents/Gus/events") if e["id"] > last and e["type"] in ("action_done", "action_failed")]
        if done:
            return done[-1]["text"]


call("/agents/Gus", method="DELETE")
call("/agents", {"name": "Gus", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": -34.5, "y": 90, "z": 324.5}})
time.sleep(10)
print("find_site 24 at Accept7's site:", act("find_site", size=24))
d = call("/village/Accept7")["designs"]["cottage"]
call("/village", {"name": "DesertTest", "objective": "test"})
call("/village/DesertTest/designs", {**d, "layers": [[" ".join(r) for r in layer] for layer in d["layers"]]})
r = call("/village/DesertTest/layout", {"buildings": ["cottage"], "x": -35, "y": 70, "z": 324, "size": 24, "by": "Gus"})
print("\nlayout at Accept7's site:", (r.get("result") or r)[:300])
call("/agents/Gus", method="DELETE")
