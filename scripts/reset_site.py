"""Restore one site of the fixed test world (plan step T.2) from its snapshot, then start the test servers again.

Usage: python scripts/reset_site.py NAME [--no-start]
  NAME        a site of scripts/test_sites.json (python mc/testserver.py regions all lists them and their region files)
  --no-start  restore only; leave the test Paper and its agent server stopped

Steps, each printed:
  1. stop the test agent server (the port of MCAI_API, default http://127.0.0.1:8767/api; never 8766, the main world's)
     and the test Paper (RCON `stop`, which saves the world; port 25566), and wait until the world is let go
  2. copy back from mc/testworld the region, entities and poi files of every region the site touches (its centre plus or
     minus its radius); a file the snapshot does not have is deleted (chunks generated since)
  3. remove the villages a test made there from mc/testserver/villages.json (a copy is kept beside it as
     villages.json.bak-<time>) and put the snapshot's atlas summaries back for those regions
  4. start the test Paper and its agent server detached, logging to runs/<date>/testpaper-<time>.log and
     testagents-<time>.log, and wait until the agent server has applied the world settings
The agent server gets MC_SERVER_DIR=mc/testserver, MC_PORT=25566, the API port and MC_API_HOST=0.0.0.0; MC_TIME_SCALE
and MC_OLLAMA_ROUTES pass through from this shell. A restore covers whole regions (512x512 blocks), so sites sharing a
region are restored together. Forceloaded chunks, level.dat and the players' files are left as they are.
"""
import datetime, json, os, pathlib, shutil, subprocess, sys, time, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "mc"))
import testserver as T  # noqa: E402
from rcon import Rcon  # noqa: E402

API = os.environ.get("MCAI_API", f"http://127.0.0.1:{T.API_PORT}/api")
API_PORT = urllib.parse.urlparse(API).port or 80
# A hidden console of their own (not DETACHED_PROCESS: java then opened a console window, and closing it would kill the
# test Paper unsaved), their own process group, and out of the caller's job, so they outlive this shell and the session
FLAGS = (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
         | getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0))


def detached(cmd, **kw):
    """Popen with FLAGS; without leaving the job when the job does not allow it."""
    try:
        return subprocess.Popen(cmd, creationflags=FLAGS, **kw)
    except OSError:
        return subprocess.Popen(cmd, creationflags=FLAGS & ~getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0), **kw)

def wait_until(test, seconds, step=0.5):
    end = time.time() + seconds
    while time.time() < end:
        if test():
            return True
        time.sleep(step)
    return test()


def listening_pids(port):
    """PIDs listening on a TCP port (netstat -ano)."""
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True).stdout
    pids = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[0] == "TCP" and parts[1].rsplit(":", 1)[-1] == str(port) and parts[3] == "LISTENING":
            pids.add(int(parts[4]))
    return pids


def call(path):
    with urllib.request.urlopen(API + path, timeout=5) as r:
        return json.loads(r.read() or "null")


def stop_agents():
    if not T.listening(API_PORT):
        print(f"agent server on {API_PORT}: not running")
        return
    pids = listening_pids(API_PORT)
    if not pids:
        raise SystemExit(f"something listens on {API_PORT} but netstat names no process")
    for pid in pids:
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    if not wait_until(lambda: not T.listening(API_PORT), 30):
        raise SystemExit(f"the agent server on {API_PORT} (pid {', '.join(map(str, pids))}) did not stop")
    print(f"agent server on {API_PORT}: stopped (pid {', '.join(map(str, pids))})")


def stop_paper():
    world = T.TEST / "world"
    if T.listening(T.GAME_PORT):
        try:
            print(f"test Paper: {Rcon(T.TEST).command('stop').strip() or 'stop sent'}")
        except (OSError, ConnectionError) as e:
            # The server may close the connection before it answers
            print(f"test Paper: stop sent ({e})")
        if not wait_until(lambda: not T.listening(T.GAME_PORT), 120):
            raise SystemExit(f"the test Paper still listens on {T.GAME_PORT} two minutes after stop")
        print(f"test Paper: port {T.GAME_PORT} closed")
    else:
        print(f"test Paper on {T.GAME_PORT}: not running")
    # It saves and closes the region files before it lets go of the world's session lock
    if not wait_until(lambda: not T.world_locked(world), 60):
        raise SystemExit(f"{world / 'session.lock'} is still held: a server still has the test world open")


def restore_files(regions):
    live, snap = T.TEST / "world" / T.DIM, T.SNAP / "world" / T.DIM
    for kind in T.KINDS:
        for rx, rz in regions:
            name = T.region_name(rx, rz)
            src, dst = snap / kind / name, live / kind / name
            if src.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                print(f"  {kind}/{name}: restored ({src.stat().st_size / 2**20:.1f} MB)")
            elif dst.exists():
                dst.unlink()
                print(f"  {kind}/{name}: deleted (not in the snapshot: generated since)")
            else:
                print(f"  {kind}/{name}: in neither")
            # Oversized chunks live beside the region file as c.X.Z.mcc: the live world's go, the snapshot's come back
            for p in oversized(live / kind, rx, rz):
                p.unlink()
                print(f"  {kind}/{p.name}: deleted")
            for p in oversized(snap / kind, rx, rz):
                shutil.copy2(p, live / kind / p.name)
                print(f"  {kind}/{p.name}: restored")


def oversized(folder, rx, rz):
    """The c.X.Z.mcc files (chunks too big for the region file) of one region."""
    if not folder.exists():
        return []
    return [p for p in folder.glob("c.*.mcc") if (int(p.name.split(".")[1]) >> 5, int(p.name.split(".")[2]) >> 5) == (rx, rz)]


def in_regions(a, regions):
    return any(rx * 512 <= a["x2"] and a["x1"] <= rx * 512 + 511 and rz * 512 <= a["z2"] and a["z1"] <= rz * 512 + 511
               for rx, rz in regions)


def village_areas(v):
    """Everything of a village that lies on the ground: plots, layouts, buildings, reservations, chests, the huts."""
    for k in ("plots", "layouts", "structures", "reservations"):
        yield from v.get(k) or []
    for c in (v.get("storage") or {}).get("chests", []):
        yield {"x1": c["x"], "x2": c["x"], "z1": c["z"], "z2": c["z"]}
    if v.get("storageHut"):
        yield v["storageHut"]
    if (v.get("mine") or {}).get("hut"):
        yield v["mine"]["hut"]


def read_json(p, empty):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else empty


def write_json(p, data, indent=None):
    # As the agent server writes them: UTF-8, LF, villages indented by 1, the atlas compact
    text = json.dumps(data, indent=indent, ensure_ascii=False, separators=(",", ": ") if indent else (",", ":"))
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def restore_villages(regions):
    f = T.TEST / "villages.json"
    if not f.exists():
        print("villages.json: none")
        return
    data = read_json(f, {})
    before = {v["name"].lower(): v for v in read_json(T.SNAP / "villages.json", {}).get("villages", [])}
    kept, removed, put_back = [], 0, 0
    for v in data.get("villages", []):
        if not any(in_regions(a, regions) for a in village_areas(v)):
            kept.append(v)
        elif v["name"].lower() in before:
            kept.append(before[v["name"].lower()])
            put_back += 1
            print(f"  village {v['name']}: put back as the snapshot had it")
        else:
            removed += 1
            print(f"  village {v['name']}: removed")
    if not removed and not put_back:
        print("villages.json: no village in the restored regions")
        return
    backup = f.with_name(f"villages.json.bak-{datetime.datetime.now():%Y%m%d-%H%M%S}")
    shutil.copy2(f, backup)
    write_json(f, {**data, "villages": kept}, indent=1)
    print(f"villages.json: {removed} removed, {put_back} put back, {len(kept)} in all (backup {backup.name})")


def restore_atlas(regions):
    f = T.TEST / "atlas.json"
    if not f.exists():
        print("atlas.json: none")
        return
    data = read_json(f, {})
    inside = lambda s: (s["cx"] >> 5, s["cz"] >> 5) in set(regions)
    chunks = [s for s in data.get("chunks", []) if not inside(s)]
    dropped = len(data.get("chunks", [])) - len(chunks)
    back = [s for s in read_json(T.SNAP / "atlas.json", {}).get("chunks", []) if inside(s)]
    # (animals seen there go too: the restored region has its own; the snapshot's are put back with its summaries)
    animals = {k: s for k, s in data.get("animals", {}).items() if (s["x"] >> 9, s["z"] >> 9) not in set(regions)}
    animals.update({k: s for k, s in read_json(T.SNAP / "atlas.json", {}).get("animals", {}).items() if (s["x"] >> 9, s["z"] >> 9) in set(regions)})
    write_json(f, {**data, "version": data.get("version", 1), "chunks": chunks + back, "animals": animals})
    print(f"atlas.json: {dropped} chunk summaries in the restored regions dropped, {len(back)} from the snapshot put back")


def start_paper(logdir, stamp):
    log = logdir / f"testpaper-{stamp}.log"
    env = {**os.environ, "MC_SERVER_DIR": str(T.TEST)}
    proc = detached([sys.executable, str(T.HERE / "start.py")], cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                            stdout=open(log, "w"), stderr=subprocess.STDOUT)
    print(f"test Paper: starting (pid {proc.pid}), log {log}")
    # A detached Paper writes nothing to stdout (F90): its own logs/latest.log, rewritten at each start, says "Done"
    latest, started = T.TEST / "logs" / "latest.log", time.time() - 2

    def text():
        out = log.read_text(encoding="utf-8", errors="replace")
        # The old Paper's log is written to until it stops: only a file created since (st_ctime on Windows) is new
        if latest.exists() and latest.stat().st_ctime >= started:
            out += latest.read_text(encoding="utf-8", errors="replace")
        return out

    if not wait_until(lambda: "Done (" in text() or proc.poll() is not None, 180, 1) or proc.poll() is not None:
        raise SystemExit(f"the test Paper did not start: {'it exited' if proc.poll() is not None else 'no Done in 180 s'}; "
                         f"last lines:\n" + "\n".join(text().splitlines()[-15:]))
    print(f"test Paper: {next(l for l in text().splitlines() if 'Done (' in l).strip()}")


def start_agents(logdir, stamp):
    node = shutil.which("node")
    cli = ROOT / "node_modules" / "tsx" / "dist" / "cli.mjs"
    if not node or not cli.exists():
        raise SystemExit("node or node_modules/tsx not found (npm install)")
    log = logdir / f"testagents-{stamp}.log"
    env = {**os.environ, "MC_SERVER_DIR": str(T.TEST), "MC_PORT": str(T.GAME_PORT), "MC_API_PORT": str(API_PORT),
           "MC_API_HOST": "0.0.0.0"}
    proc = detached([node, str(cli), "server/src/mineflayer/index.ts"], cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                            stdout=open(log, "w"), stderr=subprocess.STDOUT)
    print(f"test agent server: starting (pid {proc.pid}, port {API_PORT}"
          f"{', MC_TIME_SCALE=' + os.environ['MC_TIME_SCALE'] if os.environ.get('MC_TIME_SCALE') else ''}), log {log}")
    status = {}

    def ready():
        nonlocal status
        try:
            status = call("/status")
        except Exception:
            return proc.poll() is not None
        return bool((status.get("worldRules") or {}).get("ok")) or proc.poll() is not None

    if not wait_until(ready, 60, 1) or proc.poll() is not None:
        tail = "\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[-15:])
        raise SystemExit(f"the test agent server is not ready: {'it exited' if proc.poll() is not None else (status.get('worldRules') or {}).get('summary', 'no answer in 60 s')}; "
                         f"last lines:\n{tail}")
    print(f"test agent server: {status.get('server')}, world settings: {status['worldRules'].get('summary')}")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1 or any(a not in ("--no-start",) for a in sys.argv[1:] if a.startswith("--")):
        raise SystemExit(__doc__)
    # Whatever listens on the API port is stopped: only ever the test world's agent server
    if API_PORT != T.API_PORT:
        raise SystemExit(f"MCAI_API points at port {API_PORT}: the test world's agent server is on {T.API_PORT} (8766 is the main world's)")
    if T.settings_rcon_port() != T.RCON_PORT:
        raise SystemExit(f"mc/testserver/server.properties does not say rcon.port={T.RCON_PORT}: a stop could reach another server")
    site = T.get_site(args[0])
    regions = T.site_regions(site)
    if not (T.SNAP / "world" / "level.dat").exists():
        raise SystemExit("no snapshot in mc/testworld: generate the sites, stop the test Paper, then python mc/testserver.py snapshot")
    if T.settings_port() != T.GAME_PORT:
        raise SystemExit(f"mc/testserver/server.properties does not say server-port={T.GAME_PORT}: is it the test server?")
    x, z = T.site_centre(site)
    print(f"site {site['name']}: {'site' if site.get('site') else 'probe'} {x},{z}, radius {site.get('radius') or 160}; "
          f"regions {', '.join(T.region_name(*r) for r in regions)}; snapshot of {(T.snapshot_info() or {}).get('time', '?')}")
    stop_agents()
    stop_paper()
    print("restoring files:")
    restore_files(regions)
    restore_villages(regions)
    restore_atlas(regions)
    if "--no-start" in sys.argv:
        print("restored; not started (--no-start)")
        return
    now = datetime.datetime.now()
    logdir = ROOT / "runs" / f"{now:%Y-%m-%d}"
    logdir.mkdir(parents=True, exist_ok=True)
    stamp = f"{now:%H%M%S}"
    start_paper(logdir, stamp)
    start_agents(logdir, stamp)
    print(f"site {site['name']} restored and running: MCAI_API={API} MC_SERVER_DIR=mc/testserver "
          f"python scripts/stage_village.py VILLAGE --site {site['name']}")


if __name__ == "__main__":
    main()
