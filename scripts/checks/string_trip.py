"""Live check for gather_string (#178, MC_STRING): string from cobwebs underground.

Spawns Gus idle in survival on the surface near a known cobweb (default: the test world's nearest to minevale3, the
mineshaft at -1550,33,41, ~30 blocks down), checks that without a sword the skill refuses ("no sword"), then gives a
stone pickaxe and a wooden sword and runs gather_string count=4 (the skill finds the web itself). Passes when the server
counts at least 2 string on Gus (one rod) and Gus ends within 3 blocks of the surface. Leaves Gus removed.
Usage: MCAI_API=http://127.0.0.1:8767/api MC_SERVER_DIR=mc/testserver python scripts/checks/string_trip.py [X Z]
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

API = os.environ.get("MCAI_API", "http://127.0.0.1:8767/api").rstrip("/")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
X = int(sys.argv[1]) if len(sys.argv) > 2 else -1557
Z = int(sys.argv[2]) if len(sys.argv) > 2 else 44


def call(path, body=None, method=None, timeout=60):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        return json.loads(raw) if raw else {"error": str(e)}


def rcon(cmd):
    return subprocess.run([sys.executable, os.path.join(ROOT, "mc", "rcon.py"), cmd], cwd=ROOT, capture_output=True, text=True, timeout=20).stdout.strip()


def count(item):
    m = re.search(r"Found (\d+)", rcon(f"clear Gus minecraft:{item} 0"))
    return int(m.group(1)) if m else 0


def act(action, timeout_s=420, **args):
    evs = call("/agents/Gus/events")
    last = max([e.get("id", 0) for e in evs if isinstance(e, dict)] or [0]) if isinstance(evs, list) else 0
    res = call("/agents/Gus/act", {"action": action, **args})
    if isinstance(res, dict) and res.get("error"):
        return "action_failed", str(res["error"])
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(1)
        evs = call("/agents/Gus/events")
        done = [e for e in evs if isinstance(e, dict) and e.get("id", 0) > last and e.get("type") in ("action_done", "action_failed")]
        if done:
            return done[-1]["type"], done[-1].get("text", "")
    return "timeout", f"no result in {timeout_s} s"


def main():
    call("/agents/Gus", method="DELETE")
    time.sleep(0.5)
    sp = call("/agents", {"name": "Gus", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": X + 0.5, "z": Z + 0.5}})
    if not isinstance(sp, dict) or sp.get("error"):
        print(f"STRING_TRIP FAILED: spawn: {sp}")
        return 1
    time.sleep(3)
    rcon("give Gus minecraft:stone_pickaxe 1")
    time.sleep(1)
    t, text = act("gather_string", 60, count=2)
    print(f"without a sword: {t}: {text}")
    ok = t == "action_failed" and "no sword" in text
    rcon("give Gus minecraft:wooden_sword 1")
    time.sleep(1)
    t0 = time.time()
    t, text = act("gather_string", count=4)
    got = count("string")
    st = call("/agents/Gus")
    pos = (st.get("position") or {}) if isinstance(st, dict) else {}
    y = pos.get("y")
    top = None
    if pos:
        r = call(f"/block?x={int(pos['x'] // 1)}&y={int(y)}&z={int(pos['z'] // 1)}")
        top = r
    print(f"with a sword: {t} in {time.time() - t0:.0f} s: {text}")
    print(f"string on Gus (server): {got}; Gus at {pos}")
    ok = ok and got >= 2 and t == "action_done" and "stuck" not in text
    call("/agents/Gus", method="DELETE")
    print("STRING_TRIP OK" if ok else "STRING_TRIP FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
