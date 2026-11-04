"""#218's live probe: the hunt with a creeper beside its prey.

Train 20's I0 lost its agent server to a heap OOM: Ada's hunt left a spider for "a creeper came close" and went straight
back to it, 6.2M times. This probe stages that: on a test world whose agent server runs MC_WORLD_MODE=hostile with a
complete village (VILLAGE, default P1, from a checkpoint such as t12_pad_open), at night, an idle member with an iron
sword runs hunt_edge toward a spider with a creeper beside it (both NoAI and invulnerable, tagged probe, 6 blocks off), and
every 10 s it is teleported between them, so melee starts with the creeper within 3 (Ada's state after her reflex left
the spider). The old loop then never yielded: the event loop starved, the reflex never ran and the API stopped answering.
It counts the member's `[hunt]` lines in the agent log for SECS seconds (default 60), the API's unanswered polls and the
hunt's result.

PASS: the hunt left the spider for the creeper at least once (the condition reproduced), wrote fewer than 30 `[hunt]`
lines, and the agent server answered every poll.

  MCAI_API=http://127.0.0.1:8767/api python scripts/checks/hunt_creeper.py AGENT_LOG [VILLAGE] [SECS]
"""
import json, os, re, sys, time, urllib.error, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "mc"))
import rcon as mc_rcon  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
API = os.environ.get("MCAI_API", "http://127.0.0.1:8767/api").rstrip("/")
LOG = sys.argv[1]
VILLAGE = sys.argv[2] if len(sys.argv) > 2 else "P1"
SECS = float(sys.argv[3]) if len(sys.argv) > 3 else 60
SERVER_DIR = os.environ.get("MC_SERVER_DIR", "mc/testserver")
R = mc_rcon.Rcon()
NAME = "Ada"


def rc(cmd):
    return R.send(2, cmd)[1]


def call(path, body=None, method=None, timeout=60):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {"error": f"{e.code} {e.read()[:200]!r}"}


def main():
    vs = json.load(open(os.path.join(ROOT, SERVER_DIR, "villages.json"), encoding="utf-8"))
    vs = vs.get("villages", vs) if isinstance(vs, dict) else vs
    v = next(x for x in vs if x.get("name") == VILLAGE)
    ch = v["storage"]["chests"][0]
    x, y, z = ch["x"], ch["y"], ch["z"] - 4
    call(f"/agents/{NAME}", method="DELETE")
    r = call("/agents", {"name": NAME, "role": "worker", "brain": "idle", "gamemode": "survival", "reset": True,
                         "memory": {"village": VILLAGE}, "position": {"x": x + 0.5, "y": y + 1, "z": z + 0.5}})
    if r.get("error"):
        raise SystemExit(f"spawn: {r}")
    time.sleep(4)
    rc(f"clear {NAME}")
    rc(f"give {NAME} iron_sword")
    rc(f"effect give {NAME} resistance 120 4 true")
    rc("time set 18000")
    rc(f"kill @e[type=!player,type=!item,x={x},y={y},z={z},distance=..64]")
    time.sleep(2)
    sx, sz = x, z - 6
    rc(f"summon spider {sx + 0.5} {y + 1} {sz + 0.5} {{Tags:[\"probe\"],NoAI:1b,Invulnerable:1b,PersistenceRequired:1b}}")
    rc(f"summon creeper {sx + 1.5} {y + 1} {sz + 1.5} {{Tags:[\"probe\"],NoAI:1b,Invulnerable:1b,PersistenceRequired:1b}}")
    start = os.path.getsize(LOG)
    call(f"/agents/{NAME}/act", {"action": "hunt_edge", "chore": True})
    t0 = time.time()
    frozen = 0
    n = 0
    while time.time() - t0 < SECS:
        rc("time set 18000")
        # (into the middle, as train 20's Ada after her reflex left the spider: melee starts with the creeper within 3)
        if n % 2 == 0:
            rc(f"tp {NAME} {sx + 0.5} {y + 1} {sz + 2.0}")
        n += 1
        time.sleep(5)
        try:
            urllib.request.urlopen(API + f"/agents/{NAME}/actions", timeout=10).read()
        except Exception:
            frozen += 1
    print(f"agent server unanswered: {frozen} of {n} polls")
    acts = call(f"/agents/{NAME}/actions")
    call(f"/agents/{NAME}/stop", {})
    time.sleep(2)
    with open(LOG, encoding="utf-8", errors="replace") as f:
        f.seek(start)
        lines = [ln.rstrip() for ln in f if f"[hunt] {NAME} " in ln]
    creeper = [ln for ln in lines if "creeper came close" in ln]
    print(f"[hunt] lines: {len(lines)} ({len(creeper)} 'creeper came close')")
    for ln in lines[:20]:
        print("  " + ln[:220])
    hist = [h for h in (acts.get("history") or []) if "hunt" in json.dumps(h)]
    cur = acts.get("current")
    print("current:", json.dumps(cur)[:300] if cur else None)
    for h in hist[-2:]:
        print("history:", json.dumps(h)[:400])
    rc("kill @e[tag=probe]")
    call(f"/agents/{NAME}", method="DELETE")
    ok = len(creeper) >= 1 and len(lines) < 30 and frozen == 0
    print("PASS" if ok else "FAIL", "the hunt left the spider for the creeper and did not loop")


main()
