"""
G1's restart test (#26, PLAN E.2's exit): an agent-server restart mid-run, then a respawn, keeps every member's journal.

  python scripts/checks/memory_restart.py VILLAGE --snapshot runs/code/<snap> [--env K=V ...] [--log LOG] [--grace S]

On the test world (MCAI_TEST_WORLD picks which; MCAI_API the agent server's API, default the world's): reads every member's
memory (GET /api/memory/VILLAGE), kills the agent server listening on the API's port (taskkill /F, as a crash: no exit
handler runs), starts it again from the same code snapshot with the same settings (the --env pairs; MC_SERVER_DIR, the
ports and MCAI_ROOT as reset_site.py sets them), checks the journals it loaded from social.json, runs
scripts/respawn_agents.py, and checks them again with every member back in the world.

A member's journal passes when its notes (ids and texts), its replaced notes, its intention, its day lines, its kind table
and its log are as before the kill, allowing what changed in the last `--grace` seconds before the kill (default 1: the
store saves 0.5 s after a change; a kill can lose that). Prints PASS or FAIL and writes before/after JSON beside the log.
"""
import argparse, datetime, json, os, pathlib, subprocess, sys, time, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "mc"))
import testserver as T  # noqa: E402

p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
p.add_argument("village")
p.add_argument("--snapshot", required=True, help="the code snapshot the agent server runs from (runs/code/...)")
p.add_argument("--env", action="append", default=[], help="K=V settings the agent server ran with (repeat)")
p.add_argument("--log", default=None, help="the restarted agent server's log (default runs/<date>/testagents-restart-<time>.log)")
p.add_argument("--grace", type=float, default=1.0)
p.add_argument("--no-respawn", action="store_true")
args = p.parse_args()
API = os.environ.get("MCAI_API", f"http://127.0.0.1:{T.API_PORT}/api").rstrip("/")
PORT = urllib.parse.urlparse(API).port
V = urllib.parse.quote(args.village)


def get(path, timeout=30):
    with urllib.request.urlopen(API + path, timeout=timeout) as r:
        return json.loads(r.read() or "null")


def full():
    """Every member's whole journal: the compact view plus each member's mind (notes with replaced ones, log)."""
    m = get(f"/memory/{V}")
    out = {}
    for x in m["members"]:
        out[x["name"]] = {"notes": [(n["id"], n["text"]) for n in x["notes"]], "replaced": x["replaced"], "today": (x.get("today") or {}).get("text"),
                          "days": [d["line"] for d in x["days"]], "kinds": {k: r["n"] for k, r in x["kinds"].items()}, "log": x["log"], "nightDone": x["nightDone"]}
    return m, out


def pid_on(port):
    out = subprocess.run(["powershell", "-NoProfile", "-Command", f"(Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue).OwningProcess"],
                         capture_output=True, text=True).stdout.split()
    return int(out[0]) if out else None


stamp = datetime.datetime.now().strftime("%H%M%S")
logdir = ROOT / "runs" / datetime.date.today().isoformat()
logdir.mkdir(parents=True, exist_ok=True)
log = pathlib.Path(args.log) if args.log else logdir / f"testagents-restart-{stamp}.log"

before_raw, before = full()
kill_at = time.time()
pid = pid_on(PORT)
if not pid:
    raise SystemExit(f"no agent server listening on {PORT}")
print(f"before: {len(before)} members, {sum(len(x['notes']) for x in before.values())} live notes, {sum(x['log'] for x in before.values())} log entries, "
      f"{sum(len(x['days']) for x in before.values())} day lines; {before_raw.get('clock')}", flush=True)
subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
print(f"killed the agent server (pid {pid}) at {datetime.datetime.now():%H:%M:%S}", flush=True)
end = time.time() + 30
while pid_on(PORT) and time.time() < end:
    time.sleep(0.5)

env = {**os.environ, **dict(e.split("=", 1) for e in args.env), "MC_SERVER_DIR": str(T.TEST), "MC_PORT": str(T.GAME_PORT),
       "MC_API_PORT": str(PORT), "MC_API_HOST": "0.0.0.0", "MCAI_ROOT": str(ROOT)}
node = "node"
cli = ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs"
entry = ROOT / args.snapshot / "server" / "src" / "mineflayer" / "index.ts"
FLAGS = (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0))
try:
    proc = subprocess.Popen([node, str(cli), str(entry)], cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=open(log, "w"), stderr=subprocess.STDOUT, creationflags=FLAGS)
except OSError:
    proc = subprocess.Popen([node, str(cli), str(entry)], cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=open(log, "w"), stderr=subprocess.STDOUT,
                            creationflags=FLAGS & ~getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0))
print(f"restarted the agent server (pid {proc.pid}) from {args.snapshot}, log {log}", flush=True)
end = time.time() + 120
while time.time() < end:
    try:
        get("/agents", timeout=5)
        break
    except Exception:
        time.sleep(1)
else:
    raise SystemExit("the restarted agent server does not answer")
down = time.time() - kill_at
print(f"the agent server answers again after {down:.0f} s", flush=True)


def compare(label, now):
    bad = []
    for name, b in before.items():
        a = now.get(name)
        if not a:
            bad.append(f"{name}: missing")
            continue
        for k in ("notes", "today", "days", "kinds", "replaced", "nightDone"):
            if a[k] != b[k] and not (k == "notes" and set(map(tuple, b[k])) <= set(map(tuple, a[k]))) and not (k == "kinds" and all(a[k].get(x, 0) >= y for x, y in b[k].items())) \
                    and not (k in ("days", "nightDone", "replaced") and (a[k] if isinstance(a[k], int) else len(a[k])) >= (b[k] if isinstance(b[k], int) else len(b[k]))):
                bad.append(f"{name}: {k} {b[k]!r:.80} -> {a[k]!r:.80}")
        if a["log"] < b["log"] and not (b["log"] == 60):
            bad.append(f"{name}: log {b['log']} -> {a['log']}")
    print(f"{label}: {len(now)} members; " + ("every journal as before (or grown)" if not bad else f"{len(bad)} differences:"), flush=True)
    for x in bad[:20]:
        print(f"  {x}")
    return bad


_, loaded = full()
bad1 = compare("loaded from social.json", loaded)
bad2 = []
if not args.no_respawn:
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "respawn_agents.py"), args.village, "--api", API], capture_output=True, text=True)
    print(r.stdout[-3000:], r.stderr[-1000:], flush=True)
    time.sleep(5)
    _, after = full()
    bad2 = compare("after the respawn", after)
    present = {a["name"] for a in get("/agents")}
    gone = [n for n in before if n not in present]
    if gone:
        bad2.append(f"not back in the world: {gone}")
        print(f"  not back in the world: {gone}")
(logdir / f"memory_restart-{stamp}.json").write_text(json.dumps({"before": before, "loaded": loaded, "down_s": down}, indent=1), encoding="utf-8")
print(f"{'PASS' if not bad1 and not bad2 else 'FAIL'} memory_restart {args.village}: {len(before)} journals, down {down:.0f} s", flush=True)
sys.exit(1 if bad1 or bad2 else 0)
