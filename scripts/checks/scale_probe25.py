"""E.1's scaling probe: 25 bots on one agent server, doing mixed work (A.0b's scale_probe.py took 12 bots collecting).

Steps up to 12, 18 and 25 agents (Mayor, Worker1-24), spawned at least MCAI_SPAWN_GAP_S seconds apart (default 2.5) on a
ring of 18 round the probe point. At each level they idle for IDLE seconds (default 20), then work for WORK seconds
(default 600 at 25, 90 at the lower levels); every 2 s the probe samples /api/perf, the latency and size of /api/overview
and of the plain agent listing, Paper's mspt over RCON, and the agent log's [lag] (with the worst ms), [rcon] timeouts and
[stuck] lines. One line per level, then the exit at 25 (PLAN.md's E.1): no [lag] over 3.5 s, API p90 under 0.1 s (the
overview, as A.0b measured it), mspt under 25, RCON p90 under 50 ms, RSS recorded. Results go to
runs/<date>/scale_probe25-<time>.json. Every agent is deleted at the end, Ctrl-C included.

The work at 25 (the same mix, in proportion, at the lower levels):
  10 collect logs count=16, again and again (no village);
   6 build_box 5x5, 4 high: hollow cobblestone, then air, and again, each on its own flat spot 12+ blocks from the others
     (memory buildMode "commands": free blocks; no village);
   5 deposit / withdraw 32 cobblestone at a chest set by RCON and registered as village Probe25's storage (only these five
     are in a village, Probe25, which has no layout, so no chores: lesson 108);
   2 find_site size=30, again and again (no village);
   2 tiered agents with a small objective, on the brain's default model (gpt-oss cloud: real calls, cheap; no village).
The scripted agents are idle brains driven by this script; a failed action is retried after 5 s.

Run (the test world; no other agents in it):
  MCAI_API=http://127.0.0.1:8767/api MC_SERVER_DIR=mc/testserver python runs/2026-10-11/s27/scale_probe25.py AGENT_LOG
AGENT_LOG is the agent server's log (runs/<date>/testagents-*.log). PROBE_X / PROBE_Z move the probe point (default the
test world's -1544,8); WORK, IDLE and LEVELS (e.g. 25 or 12,25) change the run's shape. Names must be whitelisted and
Paper's max-players must exceed 25 (E.1's first step).
"""
import json, math, os, re, statistics, sys, time, traceback, urllib.error, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
os.environ.setdefault("MC_SERVER_DIR", "mc/testserver")
sys.path.insert(0, os.path.join(ROOT, "mc"))
import rcon as mc_rcon  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
API = os.environ.get("MCAI_API", "http://127.0.0.1:8767/api")
if len(sys.argv) < 2:
    raise SystemExit(__doc__)
LOG = sys.argv[1]
CX, CZ = int(os.environ.get("PROBE_X", "-1544")), int(os.environ.get("PROBE_Z", "8"))
LEVELS = [int(x) for x in os.environ.get("LEVELS", "12,18,25").split(",")]
IDLE = int(os.environ.get("IDLE", "20"))
SPAWN_GAP = float(os.environ.get("MCAI_SPAWN_GAP_S", "2.5"))
VILLAGE = "Probe25"
OBJECTIVE = "gather 8 logs, make a crafting table and a wooden pickaxe, then gather 6 cobblestone"
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent.parent))
from agent_names import worker_names
NAMES = ["Mayor"] + worker_names(24)
# Each name's work, ordered so the first 12 and 18 hold a mix too (12: 4 collect, 3 build, 3 store, 1 find, 1 tiered)
ROLES = ["collect", "build", "store", "collect", "find", "build", "collect", "store", "tiered", "collect", "build", "store",
         "collect", "build", "collect", "store", "tiered", "collect",
         "collect", "build", "store", "collect", "find", "build", "collect"]
ROLE = dict(zip(NAMES, ROLES))
assert {r: ROLES.count(r) for r in set(ROLES)} == {"collect": 10, "build": 6, "store": 5, "find": 2, "tiered": 2}


def work_seconds(level):
    return int(os.environ["WORK"]) if os.environ.get("WORK") else (600 if level >= 25 else 90)


def call(path, body=None, method=None, timeout=60, raw=False):
    """JSON from the API (raw: the bytes too); an HTTP error comes back as {"error", "status"}."""
    req = urllib.request.Request(API + path, json.dumps(body).encode() if body is not None else None,
                                 {"Content-Type": "application/json"}, method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        out = {"error": e.read().decode("utf-8", "replace")[:300], "status": e.code}
        return (out, b"") if raw else out
    out = json.loads(data.decode("utf-8")) if data else None
    return (out, data) if raw else out


_rc = None


def rcon(cmd):
    """One RCON connection kept open (the probe asks for mspt every 2 s); reconnects once after an error."""
    global _rc
    for attempt in range(2):
        try:
            if _rc is None:
                _rc = mc_rcon.Rcon()
            return re.sub("§.", "", _rc.command(cmd)).strip()
        except Exception as e:
            _rc = None
            if attempt:
                return f"rcon error: {e}"
    return ""


def mspt():
    """Paper's mspt: (5 s average, 5 s max) in ms, or None."""
    m = re.findall(r"([\d.]+)/([\d.]+)/([\d.]+)", rcon("mspt"))
    return (float(m[0][0]), float(m[0][2])) if m else None


class LogTail:
    """New lines of the agent log since the last read: [lag] ms, [rcon] timeouts and p90s, [stuck] count."""

    def __init__(self, path):
        self.path, self.pos = path, os.path.getsize(path)

    def read(self):
        with open(self.path, "rb") as f:
            f.seek(self.pos)
            data = f.read()
        # (only whole lines: a line being written stays for the next read)
        cut = data.rfind(b"\n") + 1
        self.pos += cut
        text = data[:cut].decode("utf-8", "replace")
        return {"lags": [int(x) for x in re.findall(r"\[lag\][^\n]*?blocked for ~?(\d+)\s*ms", text)],
                "rcon_timeouts": len(re.findall(r"\[rcon\] timeout", text)),
                "rcon_p90": [int(x) for x in re.findall(r"\[rcon\] queue max \d+, p90 (\d+) ms", text)],
                "stuck": len(re.findall(r"\[stuck\]", text))}


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else None


# ---- the agents

live = []          # names spawned, in order
plan = {}          # name -> the work it loops: {"kind", "next_at", "issued", "id", "step", ...}
counts = {}        # role -> {"done": n, "failed": n, "fails": {text: n}}
seen_event = {}    # name -> last event id read
box_spots, chest = [], None


def spawn(i):
    name = NAMES[i]
    ang = 2 * math.pi * i / len(NAMES)
    x, z = CX + 18 * math.cos(ang), CZ + 18 * math.sin(ang)
    role = ROLE[name]
    mem = {"buildSpeed": 4}
    if role == "build":
        mem["buildMode"] = "commands"
    if role == "store":
        mem["village"] = VILLAGE
    if role == "tiered":
        mem["objective"] = OBJECTIVE
    call(f"/agents/{name}", method="DELETE")
    r = call("/agents", {"name": name, "brain": "tiered" if role == "tiered" else "idle", "gamemode": "survival", "reset": True,
                         "position": {"x": round(x) + 0.5, "z": round(z) + 0.5}, "memory": mem}, timeout=120)
    if not isinstance(r, dict) or r.get("error"):
        print(f"   SPAWN FAILED {name}: {r}", flush=True)
        return False
    live.append(name)
    seen_event[name] = 0
    if role == "store":
        # (the cobblestone these five carry round the chest; a spawn with reset starts empty)
        rcon(f"give {name} minecraft:cobblestone 32")
    return True


GROUND = re.compile(r"^(grass_block|dirt|coarse_dirt|podzol|rooted_dirt|mycelium|mud|moss_block|dirt_path|sand|red_sand|gravel|clay|"
                    r"stone|andesite|diorite|granite|tuff|deepslate|calcite|sandstone|red_sandstone|snow_block|.*terracotta)$")
OPEN = re.compile(r"^(air|cave_air|short_grass|tall_grass|grass|fern|large_fern|dead_bush|bush|firefly_bush|snow|leaf_litter|"
                  r"short_dry_grass|tall_dry_grass|wildflowers|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|"
                  r"cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|pink_petals|.*_mushroom)$")


def survey():
    """Flat ground round the probe point from /api/blocks (the spawned bots have the chunks): a 5x5 box spot for each
    builder, 12+ apart and 8+ from the chest, and the chest's spot; nearest the probe point first."""
    global chest
    listing = call("/agents")
    ys = [a["position"]["y"] for a in listing if isinstance(a, dict) and a.get("position")] if isinstance(listing, list) else []
    y0 = int(statistics.median(ys)) if ys else 64
    R, lo, hi = 40, y0 - 10, y0 + 10
    top = {}
    for z1 in range(CZ - R, CZ + R + 1, 27):
        z2 = min(CZ + R, z1 + 26)
        b = call(f"/blocks?x1={CX - R}&y1={lo}&z1={z1}&x2={CX + R}&y2={hi}&z2={z2}")
        if not isinstance(b, dict) or "cells" not in b:
            print(f"   survey: /api/blocks gave {str(b)[:200]}", flush=True)
            continue
        nx, nz = CX + R - (CX - R) + 1, z2 - z1 + 1
        for dz in range(nz):
            for dx in range(nx):
                col = [b["cells"][(dy * nz + dz) * nx + dx] for dy in range(hi - lo + 1)]
                if -1 in col or not OPEN.match(b["names"][col[-1]]):
                    continue  # unloaded, or the ground goes above the window
                for dy in range(len(col) - 1, -1, -1):
                    name = b["names"][col[dy]]
                    if not OPEN.match(name):
                        if GROUND.match(name):
                            top[(CX - R + dx, z1 + dz)] = lo + dy
                        break

    def flat(x, z, r, slack):
        hs = [top.get((x + i, z + j)) for i in range(-r, r + 1) for j in range(-r, r + 1)]
        return None if None in hs or max(hs) - min(hs) > slack else max(hs)

    cells = sorted(top, key=lambda p: math.hypot(p[0] - CX, p[1] - CZ))
    chest = next(((x, flat(x, z, 1, 0) + 1, z) for x, z in cells if math.hypot(x - CX, z - CZ) >= 3 and flat(x, z, 1, 0) is not None), None)
    want = ROLES.count("build")
    for slack in (0, 1):
        for x, z in cells:
            if len(box_spots) >= want:
                break
            g = flat(x, z, 3, slack)  # the 5x5 and a ring round it
            if g is None or any(math.hypot(x - s[0], z - s[2]) < 12 for s in box_spots):
                continue
            if chest and math.hypot(x - chest[0], z - chest[2]) < 8:
                continue
            box_spots.append((x, g + 1, z))
    print(f"   survey: {len(top)} ground columns near y {y0}; chest {chest}; box spots {box_spots}", flush=True)


def set_up_storage():
    """The chest (RCON setblock) registered as Probe25's storage."""
    if not chest:
        print("   no flat spot for the chest: the store agents only fail", flush=True)
        return
    x, y, z = chest
    print(f"   chest: {rcon(f'setblock {x} {y} {z} minecraft:chest')}", flush=True)
    r = call(f"/village/{VILLAGE}/storage", {"x": x, "y": y, "z": z, "group": "cobblestone"})
    print(f"   storage: {str(r.get('result') if isinstance(r, dict) else r)[:200]}", flush=True)


def next_action(name):
    p = plan[name]
    kind = p["kind"]
    if kind == "collect":
        return {"action": "collect", "block": "logs", "count": 16}
    if kind == "find":
        return {"action": "find_site", "size": 30}
    if kind == "store":
        p["step"] += 1
        return {"action": "deposit", "item": "cobblestone"} if p["step"] % 2 else {"action": "withdraw", "item": "cobblestone", "count": 32}
    if kind == "build":
        x, y, z = p["spot"]
        p["step"] += 1
        fill = p["step"] % 2 == 1
        return {"action": "build_box", "x1": x - 2, "y1": y, "z1": z - 2, "x2": x + 2, "y2": y + 3, "z2": z + 2,
                "block": "cobblestone" if fill else "air", **({"hollow": True} if fill else {})}
    return None


def start_work(names):
    counts.clear()
    builders = [n for n in names if ROLE[n] == "build"]
    for n in names:
        role = ROLE[n]
        if role == "tiered":
            continue
        kind = role
        if role == "build":
            k = builders.index(n)
            if k >= len(box_spots):
                kind = "collect"
                print(f"   {n}: no box spot left, collects instead", flush=True)
        plan[n] = {"kind": kind, "next_at": 0, "issued": 0, "id": None, "step": 0,
                   **({"spot": box_spots[builders.index(n)]} if kind == "build" else {})}


def drive(listing, read_events):
    """Issue each scripted agent's next action when its last one ended (its event, or idle 20 s after issuing)."""
    if not isinstance(listing, list):
        return  # (without the listing an action still running would look ended)
    now = time.time()
    running = {a["name"]: a.get("action") for a in listing if isinstance(a, dict)}
    for n, p in plan.items():
        if read_events and p["id"] is not None:
            ev = call(f"/agents/{n}/events?since={seen_event[n]}")
            for e in ev if isinstance(ev, list) else []:
                seen_event[n] = e["id"]
                if e["type"] in ("action_done", "action_failed") and (e.get("data") or {}).get("action") == p["id"]:
                    c = counts.setdefault(p["kind"], {"done": 0, "failed": 0, "fails": {}})
                    if e["type"] == "action_done":
                        c["done"] += 1
                        p["next_at"] = now
                    else:
                        c["failed"] += 1
                        key = re.sub(r"-?\d+", "N", e["text"])[:120]
                        c["fails"][key] = c["fails"].get(key, 0) + 1
                        p["next_at"] = now + 5
                    p["id"] = None
        if p["id"] is not None and not (running.get(n) is None and now - p["issued"] > 20):
            continue
        if now < p["next_at"]:
            continue
        act = next_action(n)
        r = call(f"/agents/{n}/act", act)
        p["issued"] = now
        p["id"] = r.get("id") if isinstance(r, dict) else None
        if p["id"] is None:
            p["next_at"] = now + 5


def stop_work():
    for n in list(plan):
        call(f"/agents/{n}/stop", {})
    plan.clear()


# ---- sampling

def sample(seconds, label, working):
    tail = LogTail(LOG)
    s = {"label": label, "agents": len(live), "overview_s": [], "overview_bytes": [], "list_s": [], "mspt": [], "perf": [],
         "lags": [], "rcon_timeouts": 0, "rcon_p90_log": [], "stuck": 0, "errors": 0}
    t0, k = time.time(), 0
    while time.time() - t0 < seconds:
        a = time.time()
        try:
            t = time.time()
            ov, data = call("/overview", raw=True)
            s["overview_s"].append(time.time() - t)
            s["overview_bytes"].append(len(data))
            t = time.time()
            listing = call("/agents")
            s["list_s"].append(time.time() - t)
            perf = call("/perf")
            if isinstance(perf, dict) and "rss" in perf:
                s["perf"].append(perf)
            m = mspt()
            if m:
                s["mspt"].append(m)
            if working:
                drive(listing, k % 3 == 0)
        except Exception as e:
            s["errors"] += 1
            s["overview_s"].append(60.0)
            print(f"   sample error: {e}", flush=True)
        got = tail.read()
        s["lags"] += got["lags"]
        s["rcon_timeouts"] += got["rcon_timeouts"]
        s["rcon_p90_log"] += got["rcon_p90"]
        s["stuck"] += got["stuck"]
        k += 1
        time.sleep(max(0, 2 - (time.time() - a)))
    return summarise(s)


def summarise(s):
    perf = s.pop("perf")
    mx = lambda xs: max(xs) if xs else None
    s["api_p50"], s["api_p90"], s["api_max"] = pct(s["overview_s"], 0.5), pct(s["overview_s"], 0.9), mx(s["overview_s"])
    s["list_p90"] = pct(s["list_s"], 0.9)
    s["overview_kb"] = round(mx(s["overview_bytes"]) / 1024) if s["overview_bytes"] else None
    s["mspt_avg"] = round(statistics.mean(m[0] for m in s["mspt"]), 1) if s["mspt"] else None
    s["mspt_worst5s"] = mx([m[0] for m in s["mspt"]])
    s["mspt_max"] = mx([m[1] for m in s["mspt"]])
    s["lag_max"] = mx(s["lags"])
    if perf:
        s["rss_mb"] = round(mx([p["rss"] for p in perf]) / 2**20)
        s["heap_mb"] = round(mx([p["heapUsed"] for p in perf]) / 2**20)
        s["loop_p99"] = mx([p["loop"]["p99"] for p in perf])
        s["loop_max"] = mx([p["loop"]["max"] for p in perf])
        s["tick_p99"] = mx([p["tick"]["p99"] for p in perf])
        s["rcon_p90"] = mx([p["rcon"]["p90"] for p in perf])
        s["rcon_peak"] = mx([p["rcon"]["peak"] for p in perf])
        s["rcon_timeouts_perf"] = perf[-1]["rcon"]["timeouts"]
        s["overview_ms"] = mx([p["overview"]["ms"] for p in perf])
    else:
        # (an agent server without /api/perf: RCON's p90 from its [rcon] lines, no RSS)
        s["rss_mb"] = None
        s["rcon_p90"] = mx(s["rcon_p90_log"])
    s["work"] = {k: {"done": c["done"], "failed": c["failed"]} for k, c in counts.items()}
    s["fails"] = {k: sorted(c["fails"].items(), key=lambda kv: -kv[1])[:3] for k, c in counts.items() if c["fails"]}
    return s


def fmt(x, unit="", nd=2):
    return "?" if x is None else (f"{x:.{nd}f}{unit}" if isinstance(x, float) else f"{x}{unit}")


def line(s):
    return (f"  {s['label']}: API p90 {fmt(s['api_p90'], 's')} max {fmt(s['api_max'], 's')} (overview {fmt(s['overview_kb'], ' KB')}"
            f"{', built in ' + fmt(s.get('overview_ms'), ' ms', 0) if s.get('overview_ms') is not None else ''}; listing p90 "
            f"{fmt(s['list_p90'], 's')}); [lag] {len(s['lags'])}{', max ' + str(s['lag_max']) + ' ms' if s['lags'] else ''}; "
            f"mspt avg {fmt(s['mspt_avg'], '', 1)} worst 5s {fmt(s['mspt_worst5s'], '', 1)} max {fmt(s['mspt_max'], '', 1)}; "
            f"RCON p90 {fmt(s['rcon_p90'], ' ms')} peak {fmt(s.get('rcon_peak'))} timeouts {s['rcon_timeouts']}; loop p99 "
            f"{fmt(s.get('loop_p99'), ' ms')} max {fmt(s.get('loop_max'), ' ms')}; tick p99 {fmt(s.get('tick_p99'), ' ms')}; RSS "
            f"{fmt(s['rss_mb'], ' MB')}; [stuck] {s['stuck']}"
            + ("; work " + ", ".join(f"{k} {c['done']}/{c['failed']}" for k, c in s["work"].items()) + " (done/failed)" if s["work"] else ""))


def verdict(s):
    """The exit at 25 (PLAN.md E.1), each part with its number."""
    parts = [("no [lag] over 3.5 s", (s["lag_max"] or 0) <= 3500, f"max {s['lag_max'] or 0} ms"),
             ("API p90 < 0.1 s", s["api_p90"] is not None and s["api_p90"] < 0.1, f"{fmt(s['api_p90'], ' s', 3)}"),
             ("mspt < 25", s["mspt_worst5s"] is not None and s["mspt_worst5s"] < 25, f"worst 5 s average {fmt(s['mspt_worst5s'])}"),
             ("RCON p90 < 50 ms", s["rcon_p90"] is not None and s["rcon_p90"] < 50, fmt(s["rcon_p90"], " ms")),
             ("RSS recorded", s["rss_mb"] is not None, fmt(s["rss_mb"], " MB"))]
    return [f"  {'PASS' if ok else 'FAIL'} {what}: {got}" for what, ok, got in parts]


tried, last_spawn = 0, 0.0
results = {"probe": [CX, CZ], "levels": LEVELS, "spawn_gap_s": SPAWN_GAP, "started": time.strftime("%Y-%m-%d %H:%M:%S"), "phases": []}
out = os.path.join(ROOT, "runs", time.strftime("%Y-%m-%d"), f"scale_probe25-{time.strftime('%H%M%S')}.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
try:
    call("/village", {"name": VILLAGE, "objective": "scale probe storage (E.1)"})
    m = mspt()
    print(f"baseline: mspt {m}; probe at {CX},{CZ}; levels {LEVELS}", flush=True)
    results["phases"].append(sample(IDLE, "0 agents", False))
    print(line(results["phases"][-1]), flush=True)
    for level in LEVELS:
        t = time.time()
        # (a name whose spawn fails is skipped: the level then has fewer agents, said in its label)
        while len(live) < level and tried < len(NAMES):
            time.sleep(max(0.0, last_spawn + SPAWN_GAP - time.time()))
            last_spawn = time.time()
            spawn(tried)
            tried += 1
        print(f"{len(live)} agents spawned in {time.time() - t:.0f}s", flush=True)
        far = [a["name"] for a in call("/agents") or [] if isinstance(a, dict) and a.get("position")
               and math.hypot(a["position"]["x"] - CX, a["position"]["z"] - CZ) > 40]
        if far:
            print(f"   SPAWN WARNING: {', '.join(far)} more than 40 from the probe point (lesson 51)", flush=True)
        if not box_spots and chest is None:
            survey()
            set_up_storage()
        idle = sample(IDLE, f"{len(live)} idle", False)
        start_work(live)
        work = sample(work_seconds(level), f"{len(live)} working {work_seconds(level)}s", True)
        stop_work()
        results["phases"] += [idle, work]
        print(line(work) + f" | idle: API p90 {fmt(idle['api_p90'], 's')}, mspt {fmt(idle['mspt_avg'], '', 1)}", flush=True)
        for k, f in work["fails"].items():
            print(f"   {k} failures: " + "; ".join(f"{q}x {t}" for t, q in f), flush=True)
        json.dump(results, open(out, "w", encoding="utf-8"), indent=1)
    final = next((p for p in reversed(results["phases"]) if "working" in p["label"]), None)
    if final:
        print(f"\nEXIT ({final['label']}):", flush=True)
        for v in verdict(final):
            print(v, flush=True)
        results["verdict"] = verdict(final)
except KeyboardInterrupt:
    print("\ninterrupted: removing the agents", flush=True)
    results["interrupted"] = True
except Exception:
    traceback.print_exc()
    results["error"] = traceback.format_exc()
finally:
    try:
        stop_work()
    except Exception:
        pass
    for n in live:
        try:
            call(f"/agents/{n}", method="DELETE", timeout=30)
        except Exception as e:
            print(f"   could not remove {n}: {e}", flush=True)
    results["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")
    json.dump(results, open(out, "w", encoding="utf-8"), indent=1)
    print(f"removed {len(live)} agents; results in {out} (the chest {chest} and village {VILLAGE} stay)", flush=True)
