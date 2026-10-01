"""The fixed test world (plan step T.2): a second Paper server in mc/testserver, from the same jar and seed as mc/server,
so its land is the original land, untouched by any test village; and its snapshot in mc/testworld, which
scripts/reset_site.py copies back site by site before a staged run. Both folders are gitignored.

Usage: python mc/testserver.py init | snapshot | status | regions NAME|all

  init      create mc/testserver from mc/server: the jar, libraries, config, plugins, whitelist and the rest, but no world,
            logs, villages or atlas. Its server.properties: game port 25566, RCON 25576, peaceful, whitelist on; the rest
            as mc/server's. Refused when mc/testserver/world exists.
  snapshot  copy mc/testserver/world to mc/testworld/world (replacing it), with villages.json and atlas.json when there
            are any (mc/testworld/snapshot.json records which). Paper must be stopped first:
            MC_SERVER_DIR=mc/testserver python mc/rcon.py stop
  status    whether the test Paper (25566, RCON 25576) and its agent server (8767) listen, and the snapshot's date
  regions   the region files (r.X.Z.mca, 512x512 blocks each) that resetting a site of scripts/test_sites.json restores,
            and the regions two sites share (resetting one site resets the other's land there too)

Run it with MC_SERVER_DIR=mc/testserver python mc/start.py, or with scripts/reset_site.py (Paper and an agent server on
port 8767, both detached). The main world keeps 25565, 25575 and 8766.
"""
import datetime, json, pathlib, shutil, socket, sys

try:
    import msvcrt
except ImportError:
    msvcrt = None

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
MAIN = HERE / "server"
TEST = HERE / "testserver"
SNAP = HERE / "testworld"
SITES = ROOT / "scripts" / "test_sites.json"
GAME_PORT, RCON_PORT, API_PORT = 25566, 25576, 8767
# Where 26.1 keeps the overworld's chunk files (there is no world/region): blocks, entities and points of interest
DIM = pathlib.Path("dimensions") / "minecraft" / "overworld"
KINDS = ("region", "entities", "poi")
# Never copied by init: the world and everything the server or the agent server writes about it
SKIP = {"world", "logs", "villages.json", "atlas.json", "usercache.json", "console.log", "crash-reports", "debug"}
PROPS = {"server-port": "25566", "query.port": "25566", "rcon.port": "25576", "level-name": "world",
         "level-seed": "1793578865", "difficulty": "peaceful", "white-list": "true", "enable-rcon": "true"}


def listening(port, host="127.0.0.1"):
    try:
        socket.create_connection((host, port), timeout=1).close()
        return True
    except OSError:
        return False


def world_locked(world):
    """Whether a running server holds the world: Minecraft locks world/session.lock while the world is open, and on
    Windows the lock is mandatory, so locking its first byte fails (or the file cannot be opened) while Paper runs."""
    lock = pathlib.Path(world) / "session.lock"
    if not lock.exists() or msvcrt is None:
        return False
    try:
        with open(lock, "r+b") as f:
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        return False
    except OSError:
        return True


def settings_port():
    """The game port mc/testserver/server.properties names (None without one)."""
    props = TEST / "server.properties"
    if not props.exists():
        return None
    kv = dict(l.split("=", 1) for l in props.read_text().splitlines() if "=" in l and not l.startswith("#"))
    return int(kv.get("server-port", 25565))


def settings_rcon_port():
    """The RCON port mc/testserver/server.properties names (None without one). Its password is the main server's (copied
    by init), so a wrong port here would send a stop to the main world."""
    props = TEST / "server.properties"
    if not props.exists():
        return None
    kv = dict(l.split("=", 1) for l in props.read_text().splitlines() if "=" in l and not l.startswith("#"))
    return int(kv.get("rcon.port", 25575))


def load_sites():
    data = json.loads(SITES.read_text(encoding="utf-8"))
    return data["sites"] if isinstance(data, dict) else data


def get_site(name):
    sites = load_sites()
    s = next((s for s in sites if s["name"].lower() == name.lower()), None)
    if not s:
        raise SystemExit(f"no site {name} in {SITES}; there are: {', '.join(x['name'] for x in sites)}")
    return s


def site_centre(s):
    """The recorded site's centre once find_site has run there, else the probe."""
    c = s.get("site") or s["probe"]
    return int(c["x"]), int(c["z"])


def site_regions(s):
    """The regions (rx, rz) a site's square touches: its centre plus or minus its radius (default 160). Before find_site's
    site is recorded, the land probe may settle up to 240 blocks from the probe point, so the square is that much wider."""
    x, z = site_centre(s)
    r = int(s.get("radius") or 160) + (0 if s.get("site") else 240)
    return [(rx, rz) for rx in range((x - r) // 512, (x + r) // 512 + 1) for rz in range((z - r) // 512, (z + r) // 512 + 1)]


def region_name(rx, rz):
    return f"r.{rx}.{rz}.mca"


def snapshot_info():
    f = SNAP / "snapshot.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    return None


def init():
    if (TEST / "world").exists():
        raise SystemExit(f"{TEST / 'world'} exists: the test server is set up already (delete mc/testserver to start over)")
    if not (MAIN / "paper.jar").exists():
        raise SystemExit("no mc/server/paper.jar: run python mc/setup.py first")
    TEST.mkdir(exist_ok=True)
    for p in sorted(MAIN.iterdir()):
        if p.name in SKIP or p.name.startswith("world") or p.name.endswith(".pid") or p.name == "server.properties":
            continue
        if p.is_dir():
            shutil.copytree(p, TEST / p.name, dirs_exist_ok=True)
        else:
            shutil.copy2(p, TEST / p.name)
        print(f"copied {p.name}{'/' if p.is_dir() else ''}")
    lines, done = [], set()
    for line in (MAIN / "server.properties").read_text().splitlines():
        key = line.split("=", 1)[0] if "=" in line and not line.startswith("#") else None
        if key in PROPS:
            line = f"{key}={PROPS[key]}"
            done.add(key)
        lines.append(line)
    lines += [f"{k}={v}" for k, v in PROPS.items() if k not in done]
    (TEST / "server.properties").write_text("\n".join(lines) + "\n", newline="\n")
    print("server.properties: " + ", ".join(f"{k}={v}" for k, v in PROPS.items()) + "; the rest as mc/server's")
    print(f"set up {TEST}. Start it with MC_SERVER_DIR=mc/testserver python mc/start.py (or scripts/reset_site.py once a "
          f"snapshot exists); the world is generated at the first start")


def snapshot():
    if listening(GAME_PORT) or world_locked(TEST / "world"):
        raise SystemExit("the test Paper is running: stop it first (MC_SERVER_DIR=mc/testserver python mc/rcon.py stop)")
    if not (TEST / "world" / "level.dat").exists():
        raise SystemExit(f"no world in {TEST} yet: start the test server once and generate the sites")
    if listening(API_PORT):
        print(f"warning: an agent server listens on {API_PORT}; it saves the atlas every 30 s, so summaries of the last "
              f"30 s may be missing from the snapshot")
    SNAP.mkdir(exist_ok=True)
    if (SNAP / "world").exists():
        shutil.rmtree(SNAP / "world")
    shutil.copytree(TEST / "world", SNAP / "world", ignore=shutil.ignore_patterns("session.lock"))
    print(f"copied {TEST / 'world'} to {SNAP / 'world'}")
    info = {"time": datetime.datetime.now().isoformat(timespec="seconds")}
    for name in ("villages.json", "atlas.json"):
        src, dst = TEST / name, SNAP / name
        if src.exists():
            shutil.copy2(src, dst)
            print(f"copied {name}")
        elif dst.exists():
            dst.unlink()
        info[name] = src.exists()
    regions = sorted(p.name for p in (SNAP / "world" / DIM / "region").glob("r.*.mca"))
    info["regions"] = regions
    (SNAP / "snapshot.json").write_text(json.dumps(info, indent=1) + "\n", encoding="utf-8")
    print(f"snapshot of {info['time']}: {len(regions)} region files ({', '.join(regions)}); "
          f"villages.json {'kept' if info['villages.json'] else 'absent'}, atlas.json {'kept' if info['atlas.json'] else 'absent'}")


def status():
    for what, port in (("test Paper (game)", GAME_PORT), ("test Paper (RCON)", RCON_PORT), ("test agent server", API_PORT)):
        print(f"{what} on {port}: {'listening' if listening(port) else 'not running'}")
    print(f"test server folder: {'set up' if (TEST / 'paper.jar').exists() else 'missing (python mc/testserver.py init)'}"
          f"{', world generated' if (TEST / 'world' / 'level.dat').exists() else ', no world yet'}"
          f"{', world in use (session locked)' if world_locked(TEST / 'world') else ''}")
    info = snapshot_info()
    if info and (SNAP / "world" / "level.dat").exists():
        print(f"snapshot: {info['time']}, {len(info.get('regions', []))} region files, villages.json "
              f"{'kept' if info.get('villages.json') else 'absent'}, atlas.json {'kept' if info.get('atlas.json') else 'absent'}")
    else:
        print("snapshot: none (python mc/testserver.py snapshot)")


def regions(name):
    sites = load_sites() if name == "all" else [get_site(name)]
    have = set((snapshot_info() or {}).get("regions", []))
    used = {}
    for s in sites:
        x, z = site_centre(s)
        rs = site_regions(s)
        for r in rs:
            used.setdefault(r, []).append(s["name"])
        missing = [region_name(*r) for r in rs if have and region_name(*r) not in have]
        print(f"{s['name']}: {'site' if s.get('site') else 'probe'} {x},{z}, radius {s.get('radius') or 160}: "
              f"{', '.join(region_name(*r) for r in rs)}{'  (not in the snapshot: ' + ', '.join(missing) + ')' if missing else ''}")
    shared = {r: n for r, n in used.items() if len(n) > 1}
    for r, n in sorted(shared.items()):
        print(f"shared: {region_name(*r)} by {', '.join(n)}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "init":
        init()
    elif cmd == "snapshot":
        snapshot()
    elif cmd == "status":
        status()
    elif cmd == "regions" and len(sys.argv) > 2:
        regions(sys.argv[2])
    else:
        raise SystemExit(__doc__)
