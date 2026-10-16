"""The real-Minecraft stack in one command: what runs, start what is missing, stop it cleanly.

Usage: python scripts/stack.py status
       python scripts/stack.py up [main|test|all]       (default all; starts only what is not running)
       python scripts/stack.py down [main|test|all]     (default all)
Worlds: main (Paper on 25565, agent server and panel on 8766, mc/server) and test (Paper on 25566, agent server on
MCAI_TEST_API_PORT or 8767, mc/testserver; restoring a site is reset_site.py's job). Agent servers start detached from a
code snapshot (scripts/snapshot_code.py; MCAI_CODE_SNAPSHOT=0 runs the working tree), listening on 0.0.0.0, with
MC_OLLAMA_ROUTES for the pinned local models; MC_TIME_SCALE and other MC_ settings pass through from this shell. Logs go to
runs/<today>/{paper,agents}-<world>-<time>.log. The Ollama app (11434) is the user's to start; the local model servers
(11435, 11436) are scripts/ollama_exec.py's.
down: the agent server's villages are flushed, then it is killed (only a node process on its port); Paper is stopped by
RCON, which saves the world.
"""
import datetime, json, os, pathlib, subprocess, sys, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "mc"))
import testserver as T  # noqa: E402
from rcon import Rcon  # noqa: E402
import reset_site as R  # noqa: E402 (scripts/, beside this file: detached, wait_until, listening_pids)

ROUTES = "qwen3:30b-instruct=http://127.0.0.1:11435,qwen3.8:27b=http://127.0.0.1:11436"
WORLDS = {
    "main": {"dir": T.MAIN, "game": 25565, "api": 8766},
    "test": {"dir": T.TEST, "game": T.GAME_PORT, "api": T.API_PORT},
}
OTHERS = {"Ollama app": 11434, "local model 1 (qwen3:30b)": 11435, "local model 2 (qwen3.8)": 11436}


def api(w, path, body=None):
    req = urllib.request.Request(f"http://127.0.0.1:{w['api']}/api{path}", method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read() or "null")


def status():
    for name, w in WORLDS.items():
        paper = "up" if T.listening(w["game"]) else "down"
        line = f"{name:5} Paper :{w['game']} {paper:4}  agent server :{w['api']} "
        if T.listening(w["api"]):
            try:
                st, agents = api(w, "/status"), api(w, "/agents")
                rules = (st.get("worldRules") or {}).get("summary", "?")
                line += f"up, plays {st.get('server')}, {len(agents) if isinstance(agents, list) else '?'} agents; {rules}"
            except OSError as e:
                line += f"listening but not answering ({e.__class__.__name__}: maybe another program)"
        else:
            line += "down"
        print(line)
    print("  ".join(f"{k} :{p} {'up' if T.listening(p) else 'down'}" for k, p in OTHERS.items()))


def logdir():
    d = ROOT / "runs" / f"{datetime.date.today():%Y-%m-%d}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def start_paper(name, w):
    log = logdir() / f"paper-{name}-{time.strftime('%H%M%S')}.log"
    latest, started = w["dir"] / "logs" / "latest.log", time.time() - 2
    proc = R.detached([sys.executable, str(T.HERE / "start.py")], cwd=ROOT, env={**os.environ, "MC_SERVER_DIR": str(w["dir"])},
                      stdin=subprocess.DEVNULL, stdout=open(log, "w"), stderr=subprocess.STDOUT)
    print(f"{name}: Paper starting (pid {proc.pid}), log {log.relative_to(ROOT)}", flush=True)
    done = lambda: latest.exists() and latest.stat().st_ctime >= started and "Done (" in latest.read_text(encoding="utf-8", errors="replace")
    if not R.wait_until(lambda: done() or proc.poll() is not None, 240, 1) or proc.poll() is not None:
        raise SystemExit(f"{name}: Paper did not start (see {log} and {latest})")
    print(f"{name}: Paper up", flush=True)


def start_agents(name, w):
    node, cli = R.shutil.which("node"), ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs"
    entry = pathlib.Path("server/src/mineflayer/index.ts")
    if os.environ.get("MCAI_CODE_SNAPSHOT", "1") != "0":
        import snapshot_code  # noqa: E402
        entry = snapshot_code.snapshot() / entry
    env = {**os.environ, "MC_SERVER_DIR": str(w["dir"]), "MC_PORT": str(w["game"]), "MC_API_PORT": str(w["api"]),
           "MC_API_HOST": "0.0.0.0", "MCAI_ROOT": str(ROOT)}
    env.setdefault("MC_OLLAMA_ROUTES", ROUTES)
    log = logdir() / f"agents-{name}-{time.strftime('%H%M%S')}.log"
    proc = R.detached([node, str(cli), str(entry)], cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=open(log, "w"),
                      stderr=subprocess.STDOUT)
    print(f"{name}: agent server starting (pid {proc.pid}, {entry.parent.parent.parent.parent if entry.is_absolute() else 'working tree'}), "
          f"log {log.relative_to(ROOT)}", flush=True)

    def ready():
        try:
            return bool((api(w, "/status").get("worldRules") or {}).get("ok")) or proc.poll() is not None
        except OSError:
            return proc.poll() is not None
    if not R.wait_until(ready, 120, 1) or proc.poll() is not None:
        raise SystemExit(f"{name}: the agent server is not ready (see {log})")
    print(f"{name}: agent server up: {(api(w, '/status').get('worldRules') or {}).get('summary')}", flush=True)


def up(names):
    for name in names:
        w = WORLDS[name]
        if not T.listening(w["game"]):
            start_paper(name, w)
        else:
            print(f"{name}: Paper already up")
        if not T.listening(w["api"]):
            start_agents(name, w)
        else:
            print(f"{name}: agent server already up")


def down(names):
    for name in names:
        w = WORLDS[name]
        if T.listening(w["api"]):
            try:
                api(w, "/villages/flush", {})
            except OSError as e:
                print(f"{name}: villages not flushed ({e})")
            for pid in R.listening_pids(w["api"]):
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
            print(f"{name}: agent server {'stopped' if R.wait_until(lambda: not T.listening(w['api']), 30) else 'still listening'}")
        if T.listening(w["game"]):
            try:
                Rcon(w["dir"]).command("stop")
            except (OSError, ConnectionError):
                pass
            ok = R.wait_until(lambda: not T.listening(w["game"]), 120) and R.wait_until(lambda: not T.world_locked(w["dir"] / "world"), 60)
            print(f"{name}: Paper {'stopped and saved' if ok else 'still running after 2 minutes'}")


def main():
    a = sys.argv[1:]
    if not a or a[0] not in ("status", "up", "down") or len(a) > 2 or (len(a) == 2 and a[1] not in ("main", "test", "all")):
        raise SystemExit(__doc__)
    names = list(WORLDS) if len(a) == 1 or a[1] == "all" else [a[1]]
    if a[0] == "status":
        return status()
    (up if a[0] == "up" else down)(names)
    status()


if __name__ == "__main__":
    main()
