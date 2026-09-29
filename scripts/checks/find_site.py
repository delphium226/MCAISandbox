"""Gus runs find_site at a spot with little level land; time each call and the API's responsiveness meanwhile.
Usage: python scripts/checks/find_site.py X Z SIZE[:MAX_SLOPE],... (e.g. -195 -97 19,30 or 30:0 to force walking legs).
"""
import json, sys, time, urllib.request

API = "http://127.0.0.1:8766/api"
X, Z = int(sys.argv[1]), int(sys.argv[2])
SIZES = [tuple(int(v) for v in s.split(":")) for s in sys.argv[3].split(",")]


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()}


def evlist():
    r = call("/agents/Gus/events")
    return r if isinstance(r, list) else r.get("events", [])


call("/agents/Gus", method="DELETE")
print(call("/agents", {"name": "Gus", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": X + 0.5, "y": 90, "z": Z + 0.5}}))
time.sleep(8)
for spec in SIZES:
    size = spec[0]
    extra = {"max_slope": spec[1]} if len(spec) > 1 else {}
    last = max([e["id"] for e in evlist()] or [0])
    t0 = time.time()
    call("/agents/Gus/act", {"action": "find_site", "size": size, **extra})
    worst = 0.0
    while True:
        t1 = time.time()
        evs = [e for e in evlist() if e["id"] > last]
        worst = max(worst, time.time() - t1)
        done = [e for e in evs if e["type"] in ("action_done", "action_failed")]
        if done:
            print(f"size {size} {extra}: {time.time() - t0:.1f} s (slowest API reply {worst:.2f} s)\n  {done[-1]['text']}", flush=True)
            break
        time.sleep(0.5)
    print("  lastSite:", call("/agents/Gus/memory").get("lastSite"), "| Gus at", call("/agents/Gus").get("position"), flush=True)
