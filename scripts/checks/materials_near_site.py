"""plan_layout's material check counts what the designs need: Accept12's sandstone designs at Accept12's site are
refused; Fourfold7's sandstone cottage in the badlands still passes; the jungle is still refused.
Usage: python scripts/checks/materials_near_site.py (uses villages Accept12 and Fourfold7 from mc/server/villages.json;
rename the MatTest* villages in `cases` to rerun: layouts are refused on a village laid out before).
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


def gus_at(x, z):
    call("/agents/Gus", method="DELETE")
    call("/agents", {"name": "Gus", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": x + 0.5, "y": 90, "z": z + 0.5}})
    time.sleep(10)


def as_input(d):
    return {**d, "layers": [[" ".join(r) for r in layer] for layer in d["layers"]]}


cases = [
    ("MatTest12b", "Accept12", ["cottage", "cottage", "meeting_hall"], (-51, 63, -315)),
    ("MatTestBadlands3", "Fourfold7", ["cottage"], (-195, 70, -97)),
    ("MatTestJungle3", "Fourfold7", ["cottage"], (-448, 70, 7)),
]
for name, src, buildings, (x, y, z) in cases:
    gus_at(x, z)
    designs = call(f"/village/{src}")["designs"]
    call("/village", {"name": name, "objective": "test"})
    for n in set(buildings):
        call(f"/village/{name}/designs", as_input(designs[n]))
    r = call(f"/village/{name}/layout", {"buildings": buildings, "x": x, "y": y, "z": z, "size": 24, "by": "Gus"})
    print(f"\n== {name} ({src} designs {buildings}) at {x},{z}:\n{(r.get('result') or str(r))[:400]}", flush=True)
call("/agents/Gus", method="DELETE")
