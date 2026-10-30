"""Run control and the start screen's launcher (#115 step 3; the start screen, spec runs/2026-10-30/startscreen/spec.md):
start a profile on a test world, pause, resume and stop it, from the command line or (serve) from the start screen.

Usage: python scripts/runctl.py status
       python scripts/runctl.py start PROFILE --world N [--name NAME]   a one-run series (run_series.py --detach) from the
                                       profile on test world N; refused while that world is locked or has agents
       python scripts/runctl.py pause N | resume N    the agent server holds new chores, choices and model calls and Paper's
                                       ticks freeze (POST /api/run/pause|resume); watch scripts leave paused time out
       python scripts/runctl.py stop N  the series and its stage script ended, the agents removed, villages flushed, Paper
                                       saved (the servers stay up), the world's lock removed
       python scripts/runctl.py serve [--port 8780] [--lan]   the launcher: the start screen at GET / and its JSON routes
                                       (spec 4); 127.0.0.1 only, or with --lan every address (192.168.1.84:8780), where
                                       every write route needs the token in runs/launcher.token (the page served to
                                       127.0.0.1 carries it; a LAN browser types it once). stack.py up launcher starts it.
Runs started here are recorded in runs/runctl.json (world -> name, spec, runner log, start).
Test worlds only (the user's, 10-30): never the main world, never world 3 (the foundry's).
"""
import datetime, glob, http.server, json, os, re, secrets, subprocess, sys, threading, time, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stack as S  # noqa: E402 (the worlds, their ports, api(), Paper's RCON)
import run_series as RS  # noqa: E402 (the world locks, agent_log_of)
from agent_names import worker_names  # noqa: E402

ROOT = str(S.ROOT)
STATE = os.path.join(ROOT, "runs", "runctl.json")
TOKEN_FILE = os.path.join(ROOT, "runs", "launcher.token")
PAGE = os.path.join(ROOT, "server", "startscreen", "index.html")
NAME = re.compile(r"^[a-z0-9][a-z0-9_.-]*$", re.I)
# (keys a profile from the screen may not carry: they reach a subprocess's environment or paths, spec 12.1.3)
SCREEN_REFUSED = ("stage_env", "server_env", "out")
ARG_TOKEN = re.compile(r"^[A-Za-z0-9_.:,=+-]+$")
TSX = ["node", "node_modules/tsx/dist/cli.mjs"]
LOCK = threading.Lock()


class Refused(Exception):
    pass


def world(n):
    n = int(n)
    key = "test" if n == 1 else f"test{n}"
    if n == 3:
        raise Refused("world 3 is the foundry's")
    if key not in S.WORLDS:
        raise Refused(f"no test world {n} (there are {', '.join(k for k in S.WORLDS if k != 'main')})")
    return key, S.WORLDS[key]


def world_no(key):
    return 1 if key == "test" else int(key[4:]) if key.startswith("test") else None


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
        n = world_no(key)
        row = {"world": key, "n": n, "game": w["game"], "api": w["api"], "paper": S.T.listening(w["game"]), "agentServer": S.T.listening(w["api"]),
               "offered": n is not None and n != 3}
        if row["agentServer"]:
            row["agents"] = len(agents_of(w))
            try:
                row["run"] = S.api(w, "/run")
            except OSError:
                row["run"] = None
        if n is not None:
            row["lock"] = RS.lock_holder(n)
            if st.get(str(n)):
                row["started"] = st[str(n)]
                # (a run that ended on its own: its lock gone and ALL DONE in its runner log)
                runner = os.path.join(ROOT, st[str(n)]["runner"])
                if not row["lock"] and os.path.exists(runner) and "ALL DONE" in open(runner, encoding="utf-8", errors="replace").read():
                    row["started"] = {**st[str(n)], "ended": True}
        out.append(row)
    return out


def node_json(args, stdin=None, timeout=600):
    r = subprocess.run(TSX + args, cwd=ROOT, input=stdin, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise Refused(f"{' '.join(args[:2])}: {(r.stderr or r.stdout).strip()[-400:]}")


def screen_profile(p):
    """A profile from the screen, checked for what may reach a subprocess (spec 12.1.3)."""
    if not isinstance(p, dict):
        raise Refused("the profile must be a JSON object")
    if not NAME.match(str(p.get("name", ""))):
        raise Refused("a profile name is letters, digits, _ . - (starting with a letter or digit)")
    for k in SCREEN_REFUSED:
        if k in p:
            raise Refused(f'a profile from the screen cannot carry "{k}"')
    args = p.get("args")
    if args is not None:
        toks = args.split() if isinstance(args, str) else args
        if not isinstance(toks, list) or not all(isinstance(t, str) and ARG_TOKEN.match(t) for t in toks):
            raise Refused('"args" takes plain stage flags and values only (no paths)')
    return p


def check(p):
    """The screen's check: the profile's errors and warnings, the cost, the busy world, the commit."""
    c = node_json(["scripts/profile.mts", "check", "-", "--json"], json.dumps(p))
    c["warnings"] = list(c["warnings"])
    n = p.get("world")
    if n:
        try:
            key, w = world(n)
            held = RS.lock_holder(int(n))
            if held:
                c["errors"].append(f"world {n} is locked by {held.get('by')} run {held.get('name')}")
            elif S.T.listening(w["api"]) and agents_of(w):
                c["errors"].append(f"world {n} has agents: one run a world at a time")
        except Refused as e:
            c["errors"].append(str(e))
    if p.get("checkpoint") and p.get("preset") == "watch":
        c["errors"].append("a model-driven run (watch) starts from a fresh site: no checkpoint")
    est = c.get("estimate")
    if est and p.get("minutes"):
        hours = (float(p.get("minutes") or 0) + float(p.get("after") or 0)) / 60
        c["run_usd"] = round(est["usdHour"] * hours, 2)
        try:
            budget = float((p.get("settings") or {}).get("MC_TOKEN_BUDGET_HOUR") or 2_000_000)
        except ValueError:
            budget = 2_000_000
        if est["tokensHour"] > budget:
            c["warnings"].append(f"~{est['tokensHour'] / 1e6:.1f}M tokens an hour for {c['members']} members, budget {budget / 1e6:.1f}M: the run would pause its calls")
    c["commit"] = subprocess.run(["git", "describe", "--always", "--dirty"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    return c


def clean_env(**extra):
    """The launcher's environment without MC_*/MCAI_* settings, so nothing unrecorded reaches a run (spec 12.2.8)."""
    env = {k: v for k, v in os.environ.items() if not re.match(r"^(MC|MCAI)_", k)}
    env.update(extra)
    return env


def start(profile, n, name=None):
    """A one-run series from a profile (a name, or the screen's inline profile), on test world n."""
    key, w = world(n)
    n = int(n)
    out = f"runs/{datetime.date.today():%Y-%m-%d}/runctl"
    os.makedirs(os.path.join(ROOT, out), exist_ok=True)
    if isinstance(profile, dict):
        p = screen_profile(profile)
        base = p["name"]
        ref = f"{out}/{base}.{time.strftime('%H%M%S')}.in.json"
        json.dump(p, open(os.path.join(ROOT, ref), "w", encoding="utf-8"), indent=1)
    else:
        if not NAME.match(profile):
            raise Refused("a profile name is letters, digits, _ . -")
        ref = base = profile
    with LOCK:
        held = RS.lock_holder(n)
        if held:
            return {"ok": False, "error": f"world {n} is locked by {held.get('by')} run {held.get('name')} (pid {held.get('pid')}, since {held.get('started')})"}
        busy = agents_of(w) if S.T.listening(w["api"]) else []
        if busy:
            return {"ok": False, "error": f"world {n} has {len(busy)} agents ({', '.join(busy[:5])}): one run a world at a time"}
        c = node_json(["scripts/profile.mts", "check", ref, "--json"])
        if c["errors"]:
            return {"ok": False, "error": f"profile {base}: " + "; ".join(c["errors"])}
        name = name or f"{re.sub(r'[^A-Za-z0-9]', '', base.title())[:12]}{time.strftime('%H%M')}"
        if not NAME.match(name):
            return {"ok": False, "error": "a run name is letters, digits, _ . -"}
        spec = f"{out}/{name}.json"
        json.dump({"about": f"runctl: profile {base} on test world {n}", "world": n, "out": f"{out}/{name}",
                   "runs": [{"name": name, "profile": ref}]}, open(os.path.join(ROOT, spec), "w", encoding="utf-8"), indent=1)
        # (the lock is the launcher's until the detached series adopts it by the token: spec 12.1.2)
        token = secrets.token_hex(8)
        err = RS.take_lock(n, {"by": "launcher", "name": name, "spec": os.path.abspath(os.path.join(ROOT, spec))})
        if err:
            return {"ok": False, "error": err}
        lk = json.load(open(RS.lock_path(n), encoding="utf-8"))
        lk["token"] = token
        json.dump(lk, open(RS.lock_path(n), "w", encoding="utf-8"))
        r = subprocess.run([sys.executable, "scripts/run_series.py", spec, "--detach"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                           env=clean_env(MCAI_LOCK_TOKEN=token, MCAI_LOCK_BY="launcher"))
        if r.returncode:
            RS.drop_lock(n)
            return {"ok": False, "error": (r.stderr or r.stdout).strip()[-400:]}
        runner = f"{out}/{name}/{name}.runner.log"
        st = state()
        st[str(n)] = {"name": name, "profile": base, "spec": spec, "runner": runner, "started": time.strftime("%Y-%m-%dT%H:%M:%S"),
                      "members": int((profile if isinstance(profile, dict) else {}).get("workers") or c.get("members", 3) - 1) + 1}
        save_state(st)
    return {"ok": True, "name": name, "spec": spec, "runner": runner, "warnings": c["warnings"], "estimate": c.get("estimate"), **links(n)}


def links(n):
    key, w = world(n)
    return {"panel": [f"http://127.0.0.1:{w['api']}/panel", f"http://192.168.1.84:{w['api']}/panel"],
            "game": [f"127.0.0.1:{w['game']}", f"192.168.1.84:{w['game']}"]}


def progress(n):
    """The start's steps (spec 3.2.5): series started, reset, Paper up, agent server up, goal plan, members spawned, done."""
    key, w = world(n)
    run = state().get(str(int(n)))
    if not run:
        return {"ok": False, "error": f"no run started on world {n} from here"}
    runner = os.path.join(ROOT, run["runner"])
    text = open(runner, encoding="utf-8", errors="replace").read() if os.path.exists(runner) else ""
    out_dir = os.path.join(ROOT, os.path.dirname(run["runner"]))
    agent_log = RS.agent_log_of(os.path.join(out_dir, f"reset_{run['name']}.log"))
    alog = open(agent_log, encoding="utf-8", errors="replace").read() if agent_log else ""
    plan = [l for l in alog.splitlines() if l.startswith("[goal] plan")][:1]
    reset = re.search(r"reset: exit (\d+) after ([\d.]+) min", text)
    agents = len(agents_of(w)) if S.T.listening(w["api"]) else 0
    want = run.get("members") or 0
    steps = [
        {"step": "series started", "done": bool(text)},
        {"step": "goals: " + (re.search(r"goals: .*", text).group(0)[7:] if "goals: " in text else "drawn by code"), "done": bool(text)},
        {"step": f"reset{(' (exit ' + reset.group(1) + ')') if reset else ''}", "done": bool(reset and reset.group(1) == "0"), "failed": bool(reset and reset.group(1) != "0")},
        {"step": "Paper up", "done": S.T.listening(w["game"])},
        {"step": "agent server up", "done": S.T.listening(w["api"]) and bool(reset)},
        {"step": plan[0][7:].strip() if plan else "goal plan (none: drawn)", "done": bool(plan) or "goals: " not in text},
        {"step": f"members spawned {agents}/{want}", "done": want > 0 and agents >= want},
        {"step": "run ended" if "ALL DONE" in text else "run going", "done": "ALL DONE" in text},
    ]
    return {"ok": True, "run": run, "steps": steps, "tail": text.splitlines()[-12:], **links(n)}


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
    # (the series was killed: its lock goes with it; another starter's lock is left alone)
    held = RS.lock_holder(int(n))
    if held and run and held.get("name") == run["name"]:
        RS.drop_lock(int(n))
    if run:
        st.pop(str(int(n)))
        save_state(st)
    return {"ok": True, "series": killed, "removed": len(removed), "saved": saved.strip()[:120], "run": run}


# ---------------------------------------------------------------------------------------------
# The screen's read routes
# ---------------------------------------------------------------------------------------------

_registry = {}


def registry():
    m = os.path.getmtime(os.path.join(ROOT, "server", "src", "settings.ts"))
    if _registry.get("m") != m:
        _registry.update(m=m, data=node_json(["scripts/profile.mts", "registry", "--json"]))
    return _registry["data"]


def profiles():
    out = []
    for d, committed in ((os.path.join(ROOT, "profiles"), True), (os.path.join(ROOT, "profiles", "local"), False)):
        for f in sorted(glob.glob(os.path.join(d, "*.json"))):
            try:
                p = json.load(open(f, encoding="utf-8"))
            except (OSError, ValueError):
                continue
            out.append({"name": os.path.basename(f)[:-5], "committed": committed, "kind": p.get("kind"), "describe": p.get("describe", ""),
                        "goal_mode": p.get("goal_mode", "drawn")})
    return out


def profile_file(name):
    if not NAME.match(name):
        raise Refused("bad profile name")
    for d in ("profiles", os.path.join("profiles", "local")):
        f = os.path.join(ROOT, d, f"{name}.json")
        if os.path.exists(f):
            return f, d == "profiles"
    return None, False


def save_profile(name, p):
    f, committed = profile_file(name)
    if committed:
        raise Refused(f"{name} is a committed profile: save it under a new name")
    p = screen_profile({**p, "name": name})
    os.makedirs(os.path.join(ROOT, "profiles", "local"), exist_ok=True)
    json.dump(p, open(os.path.join(ROOT, "profiles", "local", f"{name}.json"), "w", encoding="utf-8"), indent=1)
    return {"ok": True, "saved": f"profiles/local/{name}.json"}


def delete_profile(name):
    f, committed = profile_file(name)
    if not f:
        raise Refused(f"no profile {name}")
    if committed:
        raise Refused(f"{name} is a committed profile")
    d = os.path.join(ROOT, "profiles", "local", ".deleted")
    os.makedirs(d, exist_ok=True)
    to = os.path.join(d, f"{name}.{time.strftime('%Y%m%d-%H%M%S')}.json")
    os.replace(f, to)
    return {"ok": True, "moved": os.path.relpath(to, ROOT).replace("\\", "/")}


def checkpoints():
    out = []
    for f in glob.glob(os.path.join(ROOT, "mc", "testcheckpoints", "*", "checkpoint.json")):
        try:
            c = json.load(open(f, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        out.append({"name": c.get("name") or os.path.basename(os.path.dirname(f)), "site": c.get("site"), "time": c.get("time"), "commit": c.get("commit"),
                    "villages": [{"name": v.get("name"), "complete": v.get("complete"), "structures": v.get("structures")} for v in c.get("villages", [])]})
    return sorted(out, key=lambda c: c.get("time") or "", reverse=True)


def past_runs(limit=40):
    files = glob.glob(os.path.join(ROOT, "runs", "*", "**", "*.profile.json"), recursive=True)
    files = [f for f in files if os.path.realpath(f).startswith(os.path.realpath(os.path.join(ROOT, "runs")))]
    out = []
    for f in sorted(files, key=os.path.getmtime, reverse=True)[:limit]:
        try:
            r = json.load(open(f, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        prof = r.get("profile") or {}
        out.append({"file": os.path.relpath(f, ROOT).replace("\\", "/"), "name": r.get("name"), "started": r.get("started"), "world": r.get("world"),
                    "kind": prof.get("kind"), "profile": prof.get("name"), "commit": r.get("commit"), "goal_mode": r.get("goal_mode", "drawn"),
                    "site": r.get("site"), "checkpoint": r.get("checkpoint")})
    return out


def past_run(rel):
    """A past run's profile.json, made back into a profile the screen loads (spec 1.1's "run again")."""
    f = os.path.realpath(os.path.join(ROOT, rel))
    if not f.startswith(os.path.realpath(os.path.join(ROOT, "runs"))) or not f.endswith(".profile.json") or not os.path.exists(f):
        raise Refused("not a run's profile.json under runs/")
    return run_again(json.load(open(f, encoding="utf-8")))


def run_again(r):
    """A profile from a run's record: its profile's own content when recorded (the source), else its keys; the settings as
    run (the given ones), the goals, the site, the checkpoint."""
    prof = r.get("profile") or {}
    src = dict(prof.get("source") or {})
    p = {k: v for k, v in src.items() if k not in SCREEN_REFUSED}
    p.setdefault("kind", prof.get("kind") or "staged")
    p["name"] = re.sub(r"[^a-z0-9_.-]", "-", f"again-{r.get('name', 'run')}".lower())
    p["describe"] = f"Run again: {r.get('name')} ({r.get('started')}, commit {r.get('commit')})"
    run_keys = ("MC_MODEL_RECORD", "MC_GOAL_PLAN", "MC_TIME_SCALE", "MC_HASTE", "MC_RANDOM_TICK", "MC_CHARACTER_ARCHETYPES", "MC_SCHEDULE")
    given = {k: v for k, v in (r.get("settings") or {}).items() if k not in run_keys}
    p["settings"] = {**(src.get("settings") or {}), **given}
    for k in ("site", "checkpoint"):
        if r.get(k):
            p[k] = r[k]
    if r.get("goal_mode") and r["goal_mode"] != "drawn":
        p["goal_mode"], p["goals"] = r["goal_mode"], r.get("goals")
    return {"profile": p, "commit": r.get("commit"), "head": subprocess.run(["git", "describe", "--always", "--dirty"], cwd=ROOT, capture_output=True, text=True).stdout.strip(),
            "inherited": r.get("inherited") or {}}


def token():
    if not os.path.exists(TOKEN_FILE):
        os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
        open(TOKEN_FILE, "w", encoding="utf-8").write(secrets.token_urlsafe(12))
    return open(TOKEN_FILE, encoding="utf-8").read().strip()


class Handler(http.server.BaseHTTPRequestHandler):
    def reply(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def local(self):
        return self.client_address[0] in ("127.0.0.1", "::1")

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        p, q = u.path.rstrip("/") or "/", urllib.parse.parse_qs(u.query)
        try:
            if p in ("/", "/index.html"):
                html = open(PAGE, encoding="utf-8").read()
                # (the page served to this machine carries the token; a LAN browser asks for it once)
                inject = f"<script>window.LAUNCHER_TOKEN={json.dumps(token())};</script>" if self.local() else "<script>window.LAUNCHER_TOKEN=null;</script>"
                return self.reply(200, html.replace("<!--TOKEN-->", inject).encode(), "text/html; charset=utf-8")
            if p == "/state.mjs":
                return self.reply(200, open(os.path.join(os.path.dirname(PAGE), "state.mjs"), "rb").read(), "text/javascript; charset=utf-8")
            if p == "/status":
                return self.reply(200, status())
            if p == "/registry":
                return self.reply(200, registry())
            if p == "/profiles":
                return self.reply(200, profiles())
            if p.startswith("/profiles/"):
                f, committed = profile_file(p[len("/profiles/"):])
                if not f:
                    return self.reply(404, {"error": "no such profile"})
                return self.reply(200, {"profile": json.load(open(f, encoding="utf-8")), "committed": committed})
            if p == "/sites":
                return self.reply(200, json.load(open(os.path.join(ROOT, "scripts", "test_sites.json"), encoding="utf-8"))["sites"])
            if p == "/checkpoints":
                return self.reply(200, checkpoints())
            if p == "/runs":
                return self.reply(200, past_runs(int((q.get("limit") or [40])[0])))
            if p == "/runs/load":
                return self.reply(200, past_run((q.get("file") or [""])[0]))
            if p == "/names":
                return self.reply(200, ["Mayor"] + worker_names(max(0, min(24, int((q.get("n") or [2])[0])))))
            if p == "/start/progress":
                return self.reply(200, progress(int((q.get("world") or [0])[0])))
        except Refused as e:
            return self.reply(400, {"error": str(e)})
        except (ValueError, KeyError) as e:
            return self.reply(400, {"error": f"bad request: {e}"})
        self.reply(404, {"error": "not found"})

    def authorised(self):
        """Write routes: the token, and a browser's Origin must be this launcher's own host (no cross-site starts)."""
        origin = self.headers.get("Origin")
        if origin and urllib.parse.urlparse(origin).netloc != self.headers.get("Host"):
            return False
        return secrets.compare_digest(self.headers.get("X-Launcher-Token") or "", token())

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 2_000_000:
            raise Refused("too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def write(self, method):
        if not self.authorised():
            return self.reply(403, {"error": "the launcher's token is needed (runs/launcher.token)"})
        p = urllib.parse.urlparse(self.path).path.rstrip("/")
        try:
            body = self.body()
            if method == "PUT" and p.startswith("/profiles/"):
                return self.reply(200, save_profile(p[len("/profiles/"):], body))
            if method == "DELETE" and p.startswith("/profiles/"):
                return self.reply(200, delete_profile(p[len("/profiles/"):]))
            if method != "POST":
                return self.reply(404, {"error": "not found"})
            if p == "/check":
                return self.reply(200, check(body["profile"]))
            if p == "/goals/map":
                prof = body.get("profile") or {}
                texts = [str(t)[:400] for t in body.get("texts", [])][:60]
                return self.reply(200, node_json(["scripts/goal_map.mts", "map"], json.dumps({"texts": texts, "settings": prof.get("settings") or {}}), 900))
            if p == "/goals/takes":
                prof = body.get("profile") or {}
                members = [m for m in body.get("members", []) if isinstance(m, str) and NAME.match(m)][:25]
                return self.reply(200, node_json(["scripts/goal_map.mts", "takes"], json.dumps({"text": str(body.get("text", ""))[:400], "members": members,
                                                                                               "settings": prof.get("settings") or {}}), 900))
            if p == "/start":
                prof = body["profile"]
                return self.reply(200, start(prof if isinstance(prof, dict) else str(prof), int(body["world"]), body.get("name")))
            if p in ("/pause", "/resume"):
                return self.reply(200, pause_resume(int(body["world"]), p[1:]))
            if p == "/stop":
                return self.reply(200, stop(int(body["world"])))
        except Refused as e:
            return self.reply(400, {"error": str(e)})
        except (KeyError, ValueError, TypeError) as e:
            return self.reply(400, {"error": f"missing or bad {e}"})
        except subprocess.TimeoutExpired:
            return self.reply(504, {"error": "timed out"})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        self.write("POST")

    def do_PUT(self):
        self.write("PUT")

    def do_DELETE(self):
        self.write("DELETE")

    def log_message(self, fmt, *args):
        print(f"[runctl] {self.address_string()} {fmt % args}", flush=True)


def main():
    a = sys.argv[1:]
    if not a:
        raise SystemExit(__doc__)
    cmd = a[0]
    try:
        if cmd == "status":
            for r in status():
                run = r.get("run") or {}
                line = f"{r['world']:6} Paper {'up' if r['paper'] else 'down':4} agent server {'up' if r['agentServer'] else 'down':4}"
                if r["agentServer"]:
                    line += f" {r.get('agents', 0)} agents" + (", PAUSED" if run.get("paused") else "")
                    if run.get("pausedMs"):
                        line += ", paused %.1f min in all" % (run["pausedMs"] / 60000)
                if r.get("lock"):
                    line += f"; locked by {r['lock'].get('by')} run {r['lock'].get('name')}"
                if r.get("started"):
                    s = r["started"]
                    line += f"; run {s['name']} ({s['profile']}) since {s['started']}" + (", ended" if s.get("ended") else "")
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
            host = "0.0.0.0" if "--lan" in a else "127.0.0.1"
            token()
            print(f"launcher on http://127.0.0.1:{port}" + (f" and http://192.168.1.84:{port} (token in runs/launcher.token)" if host == "0.0.0.0" else "")
                  + " (the start screen at /, JSON routes: spec runs/2026-10-30/startscreen/spec.md 4)", flush=True)
            http.server.ThreadingHTTPServer((host, port), Handler).serve_forever()
        else:
            raise SystemExit(__doc__)
    except Refused as e:
        raise SystemExit(str(e))


if __name__ == "__main__":
    main()
