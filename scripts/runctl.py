"""Run control (#115 step 3, spec runs/2026-10-24/run-profiles/spec.md 3): start a profile on a test world, pause, resume
and stop it, from the command line or (serve) as JSON routes the panel can call.

Usage: python scripts/runctl.py status
       python scripts/runctl.py start PROFILE --world N [--name NAME]   a one-run series (run_series.py --detach) from the
                                       profile on test world N; refused while that world's agent server has agents
       python scripts/runctl.py pause N | resume N    the agent server holds new chores, choices and model calls and Paper's
                                       ticks freeze (POST /api/run/pause|resume); watch scripts leave paused time out
       python scripts/runctl.py stop N  the series and its stage script ended, the agents removed, villages flushed, Paper
                                       saved (the servers stay up)
       python scripts/runctl.py serve [--port 8780]    GET /status; POST /start {profile, world, name?}, /pause, /resume,
                                       /stop {world}
Runs started here are recorded in runs/runctl.json (world -> name, spec, runner log, start).
"""
import datetime, http.server, json, os, re, subprocess, sys, time, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stack as S  # noqa: E402 (the worlds, their ports, api(), Paper's RCON)

ROOT = str(S.ROOT)
STATE = os.path.join(ROOT, "runs", "runctl.json")


def world(n):
    key = "test" if int(n) == 1 else f"test{int(n)}"
    if key not in S.WORLDS:
        raise SystemExit(f"no test world {n} (there are {', '.join(k for k in S.WORLDS if k != 'main')})")
    return key, S.WORLDS[key]


def state():
    try:
        return json.load(open(STATE, encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(st):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(st, open(STATE, "w", encoding="utf-8"), indent=1)


def agents_of(w):
    try:
        a = S.api(w, "/agents")
        return [x["name"] for x in a] if isinstance(a, list) else []
    except OSError:
        return []


def status():
    out, st = [], state()
    for key, w in S.WORLDS.items():
        row = {"world": key, "game": w["game"], "api": w["api"], "paper": S.T.listening(w["game"]), "agentServer": S.T.listening(w["api"])}
        if row["agentServer"]:
            row["agents"] = len(agents_of(w))
            try:
                row["run"] = S.api(w, "/run")
            except OSError:
                row["run"] = None
        n = "1" if key == "test" else key[4:] if key.startswith("test") else None
        if n and st.get(n):
            row["started"] = st[n]
        out.append(row)
    return out


def start(profile, n, name=None):
    key, w = world(n)
    busy = agents_of(w) if S.T.listening(w["api"]) else []
    if busy:
        return {"ok": False, "error": f"world {n} has {len(busy)} agents ({', '.join(busy[:5])}): one run a world at a time"}
    check = subprocess.run(["node", "node_modules/tsx/dist/cli.mjs", "scripts/profile.mts", "check", profile, "--json"], cwd=ROOT,
                           capture_output=True, text=True, encoding="utf-8")
    try:
        c = json.loads(check.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {"ok": False, "error": f"profile {profile}: {(check.stderr or check.stdout).strip()[-300:]}"}
    if c["errors"]:
        return {"ok": False, "error": f"profile {profile}: " + "; ".join(c["errors"])}
    name = name or f"{re.sub(r'[^A-Za-z0-9]', '', profile.title())[:12]}{time.strftime('%H%M')}"
    out = f"runs/{datetime.date.today():%Y-%m-%d}/runctl"
    os.makedirs(os.path.join(ROOT, out), exist_ok=True)
    spec = os.path.join(out, f"{name}.json")
    json.dump({"about": f"runctl: profile {profile} on test world {n}", "world": int(n), "out": f"{out}/{name}",
               "runs": [{"name": name, "profile": profile}]}, open(os.path.join(ROOT, spec), "w", encoding="utf-8"), indent=1)
    r = subprocess.run([sys.executable, "scripts/run_series.py", spec, "--detach"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        return {"ok": False, "error": (r.stderr or r.stdout).strip()[-400:]}
    runner = f"{out}/{name}/{name}.runner.log"
    st = state()
    st[str(int(n))] = {"name": name, "profile": profile, "spec": spec, "runner": runner, "started": time.strftime("%Y-%m-%dT%H:%M:%S")}
    save_state(st)
    return {"ok": True, "name": name, "spec": spec, "runner": runner, "warnings": c["warnings"], "estimate": c.get("estimate")}


def pause_resume(n, what):
    key, w = world(n)
    if not S.T.listening(w["api"]):
        return {"ok": False, "error": f"world {n}'s agent server is down"}
    try:
        return {"ok": True, **S.api(w, f"/run/{what}", {})}
    except OSError as e:
        return {"ok": False, "error": f"{e}"}


def series_pids(spec):
    """The run_series processes running this spec (their trees hold the stage script)."""
    ps = ("Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*run_series.py*' -and $_.CommandLine -like '*"
          + os.path.basename(spec).replace("'", "") + "*' } | ForEach-Object { $_.ProcessId }")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
    return [int(x) for x in r.stdout.split() if x.isdigit()]


def stop(n):
    key, w = world(n)
    st = state()
    run = st.get(str(int(n)))
    killed = []
    if run:
        for pid in series_pids(run["spec"]):
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
            killed.append(pid)
    removed = []
    if S.T.listening(w["api"]):
        try:
            S.api(w, "/run/resume", {})
        except OSError:
            pass
        for a in agents_of(w):
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{w['api']}/api/agents/{a}", method="DELETE")
                urllib.request.urlopen(req, timeout=10).read()
                removed.append(a)
            except OSError:
                pass
        try:
            S.api(w, "/villages/flush", {})
        except OSError:
            pass
    saved = ""
    if S.T.listening(w["game"]):
        try:
            saved = S.Rcon(w["dir"]).command("save-all")
        except (OSError, ConnectionError) as e:
            saved = f"not saved: {e}"
    if run:
        st.pop(str(int(n)))
        save_state(st)
    return {"ok": True, "series": killed, "removed": len(removed), "saved": saved.strip()[:120], "run": run}


class Handler(http.server.BaseHTTPRequestHandler):
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.rstrip("/") == "/status":
            return self.reply(200, status())
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except ValueError:
            return self.reply(400, {"error": "bad JSON"})
        p = self.path.rstrip("/")
        try:
            if p == "/start":
                return self.reply(200, start(str(body["profile"]), int(body["world"]), body.get("name")))
            if p in ("/pause", "/resume"):
                return self.reply(200, pause_resume(int(body["world"]), p[1:]))
            if p == "/stop":
                return self.reply(200, stop(int(body["world"])))
        except (KeyError, ValueError) as e:
            return self.reply(400, {"error": f"missing or bad {e}"})
        except SystemExit as e:
            return self.reply(400, {"error": str(e)})
        self.reply(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        print(f"[runctl] {self.address_string()} {fmt % args}", flush=True)


def main():
    a = sys.argv[1:]
    if not a:
        raise SystemExit(__doc__)
    cmd = a[0]
    if cmd == "status":
        for r in status():
            run = r.get("run") or {}
            line = f"{r['world']:6} Paper {'up' if r['paper'] else 'down':4} agent server {'up' if r['agentServer'] else 'down':4}"
            if r["agentServer"]:
                line += f" {r.get('agents', 0)} agents" + (", PAUSED" if run.get("paused") else "")
                if run.get("pausedMs"):
                    line += ", paused %.1f min in all" % (run["pausedMs"] / 60000)
            if r.get("started"):
                s = r["started"]
                line += f"; run {s['name']} ({s['profile']}) since {s['started']}"
            print(line)
    elif cmd == "start" and len(a) >= 2 and "--world" in a:
        res = start(a[1], a[a.index("--world") + 1], a[a.index("--name") + 1] if "--name" in a else None)
        print(json.dumps(res, indent=1))
        if res.get("ok"):
            print(f'arm a watcher: until grep -q "ALL DONE" {res["runner"]}; do sleep 15; done; cat {res["runner"]}')
    elif cmd in ("pause", "resume") and len(a) == 2:
        print(json.dumps(pause_resume(a[1], cmd)))
    elif cmd == "stop" and len(a) == 2:
        print(json.dumps(stop(a[1]), indent=1))
    elif cmd == "serve":
        port = int(a[a.index("--port") + 1]) if "--port" in a else 8780
        print(f"runctl on http://127.0.0.1:{port} (GET /status; POST /start, /pause, /resume, /stop)", flush=True)
        http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
