"""#221's check: an action a reflex keeps putting back still ends at its own time limit.

Clara's sand trip (train 21 I1) was put back by a swim-up for air every ~1.5 minutes for 32 minutes; each run started
collect's 7.5-minute trip clock afresh, so the trip never ended. Here the eating reflex does the putting back: on a test
world whose agent server runs MC_WORLD_MODE=easy (hunger on), Gus (idle) carries bread under Hunger 255, so he eats every
few seconds, and is told to collect 2000 dirt on a 1-minute trip (collect's `trip`).

PASS: the collect ends within 2 minutes of its start with "the trip ends" or "timed out", with eats (`[food] Gus ate`)
during it. Before the fix it ran on while the eats went on (its 64 bread last ~2 minutes), ending a minute after the last.

  MCAI_API=http://127.0.0.1:8767/api MC_SERVER_DIR=mc/testserver python scripts/checks/resume_limit.py AGENT_LOG [X Z]
"""
import json, os, sys, time, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "mc"))
import rcon as mc_rcon  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
API = os.environ.get("MCAI_API", "http://127.0.0.1:8767/api").rstrip("/")
LOG = sys.argv[1]
X, Z = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (-1544, 8)
NAME = "Gus"
R = mc_rcon.Rcon()
failed = 0


def rc(cmd):
    return R.send(2, cmd)[1]


def call(method, path, body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def check(ok, what):
    global failed
    print(f"{'ok  ' if ok else 'FAIL'} {what}", flush=True)
    failed += 0 if ok else 1


def run(action, args, cap_s):
    """Queue one action; wait for its end event; (seconds, ok, message)."""
    evs = call("GET", f"/agents/{NAME}/events")
    since = max([e.get("id", 0) for e in (evs.get("events", evs) if isinstance(evs, dict) else evs)] or [0])
    t0 = time.time()
    call("POST", f"/agents/{NAME}/act", {"action": action, **args})
    while time.time() - t0 < cap_s:
        time.sleep(3)
        evs = call("GET", f"/agents/{NAME}/events?since={since}")
        for e in (evs.get("events", evs) if isinstance(evs, dict) else evs):
            since = max(since, e.get("id", 0))
            if e.get("type") in ("action_done", "action_failed") and str(e.get("text", "")).startswith(action) or \
                    e.get("type") in ("action_done", "action_failed") and (e.get("data") or {}).get("type") == action:
                return time.time() - t0, e["type"] == "action_done", e.get("text", "")
    return time.time() - t0, None, "no end within the cap"


try:
    call("DELETE", f"/agents/{NAME}")
except Exception:
    pass
time.sleep(2)
call("POST", "/agents", {"name": NAME, "brain": "idle", "reset": True})
time.sleep(8)
rc(f"tp {NAME} {X} 100 {Z}")
time.sleep(1)
rc(f"spreadplayers {X} {Z} 0 4 false {NAME}")
time.sleep(4)
rc(f"give {NAME} bread 64")
rc(f"effect give {NAME} minecraft:hunger 900 255 true")
time.sleep(4)

size = os.path.getsize(LOG)
secs, ok, msg = run("collect", {"block": "dirt", "count": 2000, "trip": 1}, 600)
eats = [l for l in open(LOG, encoding="utf-8", errors="replace").read()[size:].splitlines() if l.startswith(f"[food] {NAME} ate")]
print(f"collect: {secs:.0f} s, {'done' if ok else 'failed' if ok is False else 'running'}: {msg[:200]}; eats during it {len(eats)}")
check(len(eats) >= 3, f"the eating reflex put collect back ({len(eats)} eats during it)")
check(ok is not None and secs <= 120 and ("the trip ends" in msg or "timed out" in msg), f"collect ends at its 1-minute trip ({secs:.0f} s)")

rc(f"effect clear {NAME}")
call("DELETE", f"/agents/{NAME}")
print(f"resume_limit: {failed} FAILED" if failed else "resume_limit: all checks passed")
sys.exit(1 if failed else 0)
