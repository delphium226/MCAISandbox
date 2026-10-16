"""Restore one site of the fixed test world (plan step T.2) from its snapshot, then start the test servers again.

Usage: python scripts/reset_site.py NAME [--no-start] [--checkpoint CP]
       python scripts/reset_site.py NAME --save CP [--force] [--no-start]
       python scripts/reset_site.py --list
  NAME            a site of scripts/test_sites.json (python mc/testserver.py regions all lists them and their region files)
  --no-start      restore (or save) only; leave the test Paper and its agent server stopped
  --save CP       save the site as it stands now as checkpoint CP in mc/testcheckpoints/CP: the region, entities and poi
                  files of its regions, the villages on them (villages.json) and their atlas summaries; then start the
                  servers again. Save once a staged village is complete (stage_village.py ... --mayor --after 1), so a
                  test of the after phase can start from there (stage_village.py ... --resume) instead of building it
                  again. --force replaces an existing CP
  --checkpoint CP restore from checkpoint CP instead of the snapshot (the site must be the one CP was saved from)
  --list          list the checkpoints

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
region are restored together. Forceloaded chunks, level.dat and the players' files are left as they are (so agents
spawned into a restored checkpoint start with empty hands: spawn them with "reset": true, as the stage scripts do).
"""
import datetime, json, os, pathlib, shutil, subprocess, sys, time, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "mc"))
import testserver as T  # noqa: E402
from rcon import Rcon  # noqa: E402

API = os.environ.get("MCAI_API", f"http://127.0.0.1:{T.API_PORT}/api")
# Saved states of sites (--save), each a folder laid out like the snapshot: world/<DIM>/<kind>/..., villages.json,
# atlas.json, checkpoint.json
CHECKS = T.HERE / "testcheckpoints"
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


def process_name(pid):
    out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"], capture_output=True, text=True).stdout
    return out.strip().split(",")[0].strip('"').lower() if out.strip().startswith('"') else ""


def listening_pids(port):
    """PIDs of node processes listening on a TCP port (netstat -ano). Only node: another program bound 127.0.0.1:8767 on
    2026-10-15, and taskkill /F on every listener would have killed it."""
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True).stdout
    pids = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[0] == "TCP" and parts[1].rsplit(":", 1)[-1] == str(port) and parts[3] == "LISTENING":
            pids.add(int(parts[4]))
    others = {p for p in pids if process_name(p) != "node.exe"}
    if others:
        raise SystemExit(f"port {port} is held by a program that is not an agent server (pid {', '.join(map(str, sorted(others)))}: "
                         f"{', '.join(process_name(p) or '?' for p in sorted(others))}); set MCAI_TEST_API_PORT and MCAI_API to another port")
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
    # villages.json is saved debounced (E.0) and taskkill /F runs no exit handler: written now first
    try:
        req = urllib.request.Request(API + "/villages/flush", data=b"{}", method="POST")
        with urllib.request.urlopen(req, timeout=10) as r:
            r.read()
    except (OSError, urllib.error.URLError) as e:
        print(f"agent server on {API_PORT}: villages not flushed ({e})")
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


def restore_files(regions, source=T.SNAP):
    """From the snapshot, or from a checkpoint (laid out alike)."""
    live, snap = T.TEST / "world" / T.DIM, source / "world" / T.DIM
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
                print(f"  {kind}/{name}: deleted (not in the {'snapshot' if source == T.SNAP else 'checkpoint'}: generated since)")
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


def restore_villages(regions, source=T.SNAP):
    """Villages on the restored regions go; the snapshot's are put back as it had them. From a checkpoint, every village
    it saved comes back (they are all on its regions), replacing any of the same name."""
    f = T.TEST / "villages.json"
    if not f.exists() and source == T.SNAP:
        print("villages.json: none")
        return
    data = read_json(f, {})
    saved = read_json(source / "villages.json", {}).get("villages", [])
    before = {v["name"].lower(): v for v in saved}
    kept, removed, put_back = [], 0, 0
    if source != T.SNAP:
        kept += saved
        put_back = len(saved)
        for v in saved:
            print(f"  village {v['name']}: from the checkpoint ({'complete' if v.get('complete') else 'not complete'}, "
                  f"{len(v.get('tasks') or [])} tasks, {len(v.get('structures') or [])} structures)")
    for v in data.get("villages", []):
        if source != T.SNAP and v["name"].lower() in before:
            removed += 1
            print(f"  village {v['name']}: replaced by the checkpoint's")
        elif not any(in_regions(a, regions) for a in village_areas(v)):
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
    if f.exists():
        shutil.copy2(f, backup)
    write_json(f, {**data, "villages": kept}, indent=1)
    print(f"villages.json: {removed} removed, {put_back} put back, {len(kept)} in all"
          + (f" (backup {backup.name})" if backup.exists() else ""))


def restore_atlas(regions, source=T.SNAP):
    f = T.TEST / "atlas.json"
    if not f.exists():
        print("atlas.json: none")
        return
    data = read_json(f, {})
    inside = lambda s: (s["cx"] >> 5, s["cz"] >> 5) in set(regions)
    chunks = [s for s in data.get("chunks", []) if not inside(s)]
    dropped = len(data.get("chunks", [])) - len(chunks)
    back = [s for s in read_json(source / "atlas.json", {}).get("chunks", []) if inside(s)]
    # (animals seen there go too: the restored region has its own; the snapshot's are put back with its summaries)
    animals = {k: s for k, s in data.get("animals", {}).items() if (s["x"] >> 9, s["z"] >> 9) not in set(regions)}
    animals.update({k: s for k, s in read_json(source / "atlas.json", {}).get("animals", {}).items() if (s["x"] >> 9, s["z"] >> 9) in set(regions)})
    write_json(f, {**data, "version": data.get("version", 1), "chunks": chunks + back, "animals": animals})
    print(f"atlas.json: {dropped} chunk summaries in the restored regions dropped, {len(back)} from the "
          f"{'snapshot' if source == T.SNAP else 'checkpoint'} put back")


def save_checkpoint(site, regions, name, force):
    """Copy the site's regions as the stopped test world has them, the villages on them and their atlas summaries into
    mc/testcheckpoints/NAME (the servers must be stopped first, so Paper has saved every chunk)."""
    dest = CHECKS / name
    if dest.exists():
        if not force:
            raise SystemExit(f"checkpoint {name} exists ({dest}); --force replaces it")
        shutil.rmtree(dest)
    live = T.TEST / "world" / T.DIM
    size = 0
    for kind in T.KINDS:
        (dest / "world" / T.DIM / kind).mkdir(parents=True, exist_ok=True)
        for rx, rz in regions:
            src = live / kind / T.region_name(rx, rz)
            for p in ([src] if src.exists() else []) + oversized(live / kind, rx, rz):
                shutil.copy2(p, dest / "world" / T.DIM / kind / p.name)
                size += p.stat().st_size
    villages = [v for v in read_json(T.TEST / "villages.json", {}).get("villages", [])
                if any(in_regions(a, regions) for a in village_areas(v))]
    write_json(dest / "villages.json", {"villages": villages}, indent=1)
    atlas = read_json(T.TEST / "atlas.json", {})
    inside = set(regions)
    write_json(dest / "atlas.json", {
        "version": atlas.get("version", 1),
        "chunks": [s for s in atlas.get("chunks", []) if (s["cx"] >> 5, s["cz"] >> 5) in inside],
        "animals": {k: s for k, s in atlas.get("animals", {}).items() if (s["x"] >> 9, s["z"] >> 9) in inside}})
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    meta = {"name": name, "site": site["name"], "regions": [T.region_name(*r) for r in regions],
            "time": f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S}", "commit": commit,
            "villages": [{"name": v["name"], "complete": bool(v.get("complete")), "tasks": len(v.get("tasks") or []),
                          "structures": len(v.get("structures") or []),
                          "claimed": [t["id"] for t in v.get("tasks") or [] if t.get("status") == "claimed"]} for v in villages]}
    write_json(dest / "checkpoint.json", meta, indent=1)
    print(f"checkpoint {name}: {size / 2**20:.1f} MB of world files, {len(villages)} village(s): "
          + (", ".join(f"{v['name']} ({'complete' if v['complete'] else 'NOT complete'}, {v['tasks']} tasks"
                       + (f", claimed {' '.join(v['claimed'])}: handed back when the agents spawn again" if v["claimed"] else "") + ")"
                       for v in meta["villages"]) or "none"))
    if not any(v["complete"] for v in meta["villages"]):
        print(f"checkpoint {name}: no complete village; stage_village.py --resume needs one")


def list_checkpoints():
    found = sorted(CHECKS.glob("*/checkpoint.json")) if CHECKS.exists() else []
    if not found:
        print(f"no checkpoints in {CHECKS}")
    for p in found:
        m = read_json(p, {})
        print(f"{m.get('name')}: site {m.get('site')}, saved {m.get('time')} at {m.get('commit')}; "
              + ", ".join(f"{v['name']} ({'complete' if v['complete'] else 'not complete'}, {v['tasks']} tasks)" for v in m.get("villages", [])))


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
           "MC_API_HOST": "0.0.0.0", "MCAI_ROOT": str(ROOT)}
    # From a snapshot of the code (scripts/snapshot_code.py), so server files can be edited while it runs; MCAI_CODE_SNAPSHOT=0
    # runs the working tree itself
    entry = pathlib.Path("server/src/mineflayer/index.ts")
    if os.environ.get("MCAI_CODE_SNAPSHOT", "1") != "0":
        import snapshot_code  # noqa: E402 (scripts/, beside this file)
        snap = snapshot_code.snapshot()
        entry = snap / entry
        print(f"test agent server: code snapshot {snap.relative_to(ROOT)} ({(snap / 'CODE.txt').read_text(encoding='utf-8').splitlines()[0]})")
    proc = detached([node, str(cli), str(entry)], cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
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

    # (120 s: A1b2's server, 10-12, had not answered in 60)
    if not wait_until(ready, 120, 1) or proc.poll() is not None:
        tail = "\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[-15:])
        raise SystemExit(f"the test agent server is not ready: {'it exited' if proc.poll() is not None else (status.get('worldRules') or {}).get('summary', 'no answer in 120 s')}; "
                         f"last lines:\n{tail}")
    print(f"test agent server: {status.get('server')}, world settings: {status['worldRules'].get('summary')}")


def main():
    argv, opts, args = sys.argv[1:], {}, []
    while argv:
        a = argv.pop(0)
        if a in ("--save", "--checkpoint"):
            if not argv or argv[0].startswith("--"):
                raise SystemExit(f"{a} needs a checkpoint name\n\n{__doc__}")
            opts[a] = argv.pop(0)
        elif a in ("--no-start", "--force", "--list"):
            opts[a] = True
        elif a.startswith("--"):
            raise SystemExit(__doc__)
        else:
            args.append(a)
    if "--list" in opts:
        return list_checkpoints()
    if len(args) != 1 or ("--save" in opts and "--checkpoint" in opts) or ("--force" in opts and "--save" not in opts):
        raise SystemExit(__doc__)
    save, cp = opts.get("--save"), opts.get("--checkpoint")
    for n in (save, cp):
        if n is not None and not all(c.isalnum() or c in "-_." for c in n):
            raise SystemExit(f"checkpoint name {n!r}: letters, digits, - _ . only")
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
    source = T.SNAP
    if cp is not None:
        source = CHECKS / cp
        meta = read_json(source / "checkpoint.json", None)
        if meta is None:
            raise SystemExit(f"no checkpoint {cp} in {CHECKS} (python scripts/reset_site.py --list)")
        if meta.get("site", "").lower() != site["name"].lower():
            raise SystemExit(f"checkpoint {cp} was saved from site {meta.get('site')}, not {site['name']}")
    x, z = T.site_centre(site)
    print(f"site {site['name']}: {'site' if site.get('site') else 'probe'} {x},{z}, radius {site.get('radius') or 160}; "
          f"regions {', '.join(T.region_name(*r) for r in regions)}; "
          + (f"saving as checkpoint {save}" if save else f"checkpoint {cp} of {meta.get('time')} at {meta.get('commit')}" if cp
             else f"snapshot of {(T.snapshot_info() or {}).get('time', '?')}"))
    stop_agents()
    stop_paper()
    if save:
        save_checkpoint(site, regions, save, "--force" in opts)
    else:
        print("restoring files:")
        restore_files(regions, source)
        restore_villages(regions, source)
        restore_atlas(regions, source)
    if "--no-start" in opts:
        print(f"{'saved' if save else 'restored'}; not started (--no-start)")
        return
    now = datetime.datetime.now()
    logdir = ROOT / "runs" / f"{now:%Y-%m-%d}"
    logdir.mkdir(parents=True, exist_ok=True)
    stamp = f"{now:%H%M%S}"
    start_paper(logdir, stamp)
    start_agents(logdir, stamp)
    print(f"site {site['name']} {'saved' if save else 'restored'} and running: MCAI_API={API} MC_SERVER_DIR=mc/testserver "
          f"python scripts/stage_village.py VILLAGE --site {site['name']}" + (" --resume --mayor --after MINUTES" if cp else ""))


if __name__ == "__main__":
    main()
