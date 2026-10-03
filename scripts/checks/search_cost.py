"""Search costs (F106): how long plan_layout's material counts and find_site's searches hold the event loop at a spot.
Usage: python scripts/checks/search_cost.py X Z [ITEMS] (e.g. -35 324 for Scout3's desert; ITEMS default
logs:120,stone:300,cobblestone:300,sand:64,sandstone:200,dirt:100).

Gus (idle, survival, reset) spawns on the surface at X,Z, waits for his chunks, then the check asks
GET /api/agents/Gus/near (materialsNear from where he stands, range 96, each item timed alone) and runs find_site
size=24, timing it. The agent server's log has the `[search]` and `[lag]` lines. Gus is removed at the end.
Env: MCAI_API (default http://127.0.0.1:8766/api).
"""
import json, os, sys, time, urllib.error, urllib.request

sys.stdout.reconfigure(encoding="utf-8")

if len(sys.argv) < 3 or any(a in ("-h", "--help") for a in sys.argv[1:]):
    print(__doc__)
    sys.exit(0 if any(a in ("-h", "--help") for a in sys.argv[1:]) else 2)

API = os.environ.get("MCAI_API", "http://127.0.0.1:8766/api").rstrip("/")
X, Z = int(sys.argv[1]), int(sys.argv[2])
ITEMS = sys.argv[3] if len(sys.argv) > 3 else "logs:120,stone:300,cobblestone:300,sand:64,sandstone:200,dirt:100"


def call(path, body=None, method=None, timeout=120):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


call("/agents/Gus", method="DELETE")
spawn = call("/agents", {"name": "Gus", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": X + 0.5, "z": Z + 0.5}})
if not isinstance(spawn, dict) or spawn.get("error"):
    sys.exit(f"spawn failed: {spawn}")
time.sleep(12)
t0 = time.time()
r = call(f"/agents/Gus/near?items={ITEMS}&range=96")
print(f"materialsNear at {r.get('at')}: {round(time.time() - t0, 1)} s in all")
for n, c in (r.get("counts") or {}).items():
    print(f"  {n:12} {c['found']:5} found  {c['ms']:6} ms")
ev = call("/agents/Gus/events")
since = max([e["id"] for e in ev] or [0]) if isinstance(ev, list) else 0
t0 = time.time()
call("/agents/Gus/act", {"action": "find_site", "size": 24})
result = None
while time.time() - t0 < 240 and result is None:
    time.sleep(1)
    evs = call(f"/agents/Gus/events?since={since}")
    for e in evs if isinstance(evs, list) else []:
        since = max(since, e["id"])
        if e["type"] in ("action_done", "action_failed"):
            result = e
print(f"find_site: {round(time.time() - t0, 1)} s; {(result or {}).get('type')}: {str((result or {}).get('text') or '')[:300]}")
call("/agents/Gus", method="DELETE")
print("Gus removed")
