"""#220's live probe: a death teaches an instinct through the agent server's own path (botAgent.died -> noteDeathLesson).

On a test world whose agent server runs MC_WORLD_MODE=hostile (or any mode with fall damage) and MC_INSTINCTS on, with a
complete village (VILLAGE, default P1, from a checkpoint such as t12_pad_open): an idle member (Ada) of the village is
teleported 40 blocks up, DIST blocks east of the storage hut (default 60), and falls to its death; then the same at the
storage hut itself. It reads the agent log from the probe's start.

PASS: the far death writes a `[death] Ada fall` line and an `[instinct] ... Ada learns ... died there` line (E5) at
that spot; the death at home writes "learns nothing from its death ... at home".

  MC_SERVER_DIR=mc/testserver MCAI_API=http://127.0.0.1:8767/api python scripts/checks/death_lesson.py AGENT_LOG [VILLAGE] [DIST]
"""
import json, os, sys, time, urllib.error, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "mc"))
import rcon as mc_rcon  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
API = os.environ.get("MCAI_API", "http://127.0.0.1:8767/api").rstrip("/")
LOG = sys.argv[1]
VILLAGE = sys.argv[2] if len(sys.argv) > 2 else "P1"
DIST = int(sys.argv[3]) if len(sys.argv) > 3 else 60
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


def read_from(start):
    with open(LOG, encoding="utf-8", errors="replace") as f:
        f.seek(start)
        return [ln.rstrip() for ln in f]


def main():
    vs = json.load(open(os.path.join(ROOT, SERVER_DIR, "villages.json"), encoding="utf-8"))
    vs = vs.get("villages", vs) if isinstance(vs, dict) else vs
    v = next(x for x in vs if x.get("name") == VILLAGE)
    ch = v["storage"]["chests"][0]
    x, y, z = ch["x"], ch["y"], ch["z"]
    call(f"/agents/{NAME}", method="DELETE")
    r = call("/agents", {"name": NAME, "role": "worker", "brain": "idle", "gamemode": "survival", "reset": True,
                         "memory": {"village": VILLAGE}, "position": {"x": x + 0.5, "y": y + 1, "z": z - 3.5}})
    if r.get("error"):
        raise SystemExit(f"spawn: {r}")
    time.sleep(5)
    rc("time set 1000")
    start = os.path.getsize(LOG)
    out = {}
    for label, (tx, tz) in (("far", (x + DIST, z)), ("home", (x + 2, z - 3))):
        rc(f"effect clear {NAME}")
        rc(f"tp {NAME} {tx + 0.5} {y + 45} {tz + 0.5}")
        t0 = time.time()
        lines = []
        while time.time() - t0 < 30:
            time.sleep(2)
            lines = read_from(start)
            if any(f"[death] {NAME} " in ln for ln in lines) and any(f"[instinct] {VILLAGE}: {NAME} " in ln and "death" in ln or "died there" in ln for ln in lines):
                break
        out[label] = lines
        start = os.path.getsize(LOG)
        time.sleep(8)  # (the respawn and the walk home)
    call(f"/agents/{NAME}", method="DELETE")
    ok = True
    for label, lines in out.items():
        deaths = [ln for ln in lines if ln.startswith(f"[death] {NAME} ")]
        inst = [ln for ln in lines if ln.startswith(f"[instinct] {VILLAGE}: {NAME} ")]
        print(f"{label}:")
        for ln in deaths[:2] + inst[:3]:
            print("  " + ln[:240])
        want = (lambda s: " learns i" in s and "died there" in s) if label == "far" else (lambda s: "learns nothing from its death" in s and "at home" in s)
        good = bool(deaths) and any(want(s) for s in inst)
        ok = ok and good
        print(f"  {'ok' if good else 'FAIL'} {label}")
    print("PASS" if ok else "FAIL", "a death away from home teaches a place lesson; one at home teaches nothing")


main()
