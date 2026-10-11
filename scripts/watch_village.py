"""Run a village: one mayor plus workers, all tiered agents, until the mayor declares the objective complete, the run
stalls (no successful action for MCAI_STALL_MIN minutes, default 3), one agent holding a task or running an action has had
no successful action for MCAI_AGENT_STALL_MIN minutes (default MCAI_STALL_MIN, at least 10; "cannot be gathered here" and
"the mine is busy" count as work), an agent fails the same way MCAI_SAME_FAIL
times (default 3), or time runs out. Agents are in creative mode unless
MCAI_GAMEMODE=survival (real Minecraft's village economy: materials are gathered, stored and paid for).
The agents spawn on a ring 4 blocks outside a 40 plot round the site (the mayor's first plot; beyond its margin), on ground read from the world while the
probe keeps it loaded, and where they stand is checked (S.0). At the end: each agent's busy and idle minutes (BUSY lines),
the critical path through the board's tasks (CRIT lines), and STOCK lines of the storage during the run for
scripts/checks/autonomy_metrics.py.

Usage: python scripts/watch_village.py VILLAGE X Z WORKERS MAX_MINUTES "objective" [WORKER_PLANNER] [SITE_SIZE]
Starts near X,Z: the Mayor (as an idle agent) first searches outward from there for dry land with room for a SITE_SIZE plot (default 30);
MCAI_NO_PROBE=1 starts the village at X,Z itself instead (scouting tests).
Every role defaults to ollama:gpt-oss:120b-cloud: WORKER_PLANNER, MCAI_MAYOR_MODEL (the mayor's planner),
MCAI_DESIGN_MODEL (the architect) and MCAI_EXEC_MODEL (every executor). Name a local model for a fallback run
(MCAI_EXEC_MODEL=ollama:qwen3:30b-instruct, WORKER_PLANNER ollama:qwen3.8:27b): that needs the agent server started with
MC_OLLAMA_ROUTES and `python scripts/ollama_exec.py start`. MCAI_REASONING (e.g. exec=medium) overrides the brain's
reasoning levels. The STOPPED line ends with the run's tokens and cost (/api/usage since the spawn).
"""
import json, os, math, re, subprocess, sys, time, urllib.error, urllib.request

# Chat and model text can hold any character; the Windows console encoding cannot
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "checks"))
from autonomy_metrics import BoardStamps, BusyClock, critical_path_lines  # noqa: E402
API = os.environ.get("MCAI_API", "http://localhost:8765/api")  # real Minecraft: http://localhost:8766/api
village, x, z, workers, minutes, objective = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
worker_planner = sys.argv[7] if len(sys.argv) > 7 else "ollama:gpt-oss:120b-cloud"
site_size = int(sys.argv[8]) if len(sys.argv) > 8 else 30
mayor_planner = os.environ.get("MCAI_MAYOR_MODEL", "ollama:gpt-oss:120b-cloud")
gamemode = os.environ.get("MCAI_GAMEMODE", "creative")
stall_minutes = float(os.environ.get("MCAI_STALL_MIN", "3"))
# (at least 10: one action can run longer than MCAI_STALL_MIN with no success, a mine trip 6 minutes on the wall clock)
agent_stall = float(os.environ.get("MCAI_AGENT_STALL_MIN", max(stall_minutes, 10)))
same_fail = int(os.environ.get("MCAI_SAME_FAIL", "3"))
# Minutes to keep watching after completion (opportunistic farming, 10-08): the chores, no stall or same-fail rule
after = float(os.environ.get("MCAI_AFTER", "0"))
BASE = {"execModel": os.environ.get("MCAI_EXEC_MODEL", "ollama:gpt-oss:120b-cloud"),
        "designModel": os.environ.get("MCAI_DESIGN_MODEL", "ollama:gpt-oss:120b-cloud"), "buildSpeed": 4}
if os.environ.get("MCAI_REASONING"):
    BASE["reasoning"] = os.environ["MCAI_REASONING"]


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method)
    # A slow reply (the agent server busy for a few seconds) is retried rather than ending the run
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read() or "null")
        except (TimeoutError, urllib.error.URLError) as e:
            if isinstance(e, urllib.error.HTTPError) or attempt == 3:
                raise
            time.sleep(5)


def usage_report(since_ms, agents):
    """The run's model usage from the agent server's ledger (A.0); None when the server has no /api/usage."""
    try:
        return call(f"/usage?since={since_ms}&agents={','.join(agents)}")
    except Exception:
        return None


def fmt_tok(n):
    return f"{n / 1e6:.2f}M" if n >= 1e6 else f"{n / 1e3:.1f}k" if n >= 1e3 else str(n)


def usage_suffix(u):
    if not u or "total" not in u:
        return "; tokens n/a"
    t = u["total"]
    s = (f"; tokens {fmt_tok(t['promptTokens'])} in / {fmt_tok(t['outputTokens'])} out in {t['calls']} calls"
         f", ~${t.get('cost', 0):.3f}")
    if t.get("refused"):
        s += f", {t['refused']} refused by the budget"
    if t.get("errors"):
        s += f", {t['errors']} errors"
    if u.get("unpriced"):
        s += f" (unpriced: {', '.join(u['unpriced'])})"
    if u.get("partial"):
        s += " (partial)"
    return s


def usage_lines(u, agents):
    """One line per agent: calls and tokens in/out per call kind."""
    if not u or "total" not in u:
        return []
    out = []
    for n in agents:
        k = (u.get("byAgentKind") or {}).get(n) or {}
        parts = []
        for kind in ("plan", "design", "exec"):
            d = k.get(kind) or {}
            parts.append(f"{kind} {d.get('calls', 0)}x {fmt_tok(d.get('promptTokens', 0))}/{fmt_tok(d.get('outputTokens', 0))}")
        out.append(f"USAGE {n}: " + ", ".join(parts))
    return out


def bring_player(agent):
    """If the watching player (MCAI_PLAYER, default SausageOfDoom4) is in the game, teleport them to the agent."""
    player = os.environ.get("MCAI_PLAYER", "SausageOfDoom4")
    rc = [sys.executable, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mc", "rcon.py")]
    try:
        online = subprocess.run(rc + ["list"], capture_output=True, text=True, timeout=10).stdout
        if player and player in online:
            print(subprocess.run(rc + [f"tp {player} {agent}"], capture_output=True, text=True, timeout=10).stdout.strip(), flush=True)
    except Exception as e:
        print(f"could not bring {player} to {agent}: {e}", flush=True)


def column_y(cx, cz, y0):
    """Where an agent stands at cx, cz: one above the highest ground with two blocks of air over it, not leaves, logs or
    water, read while the probe keeps the chunks loaded. A fixed y 90 spawned Minevale2's agents inside a hill at y 100:
    the workers suffocated and respawned at the world spawn, 900 blocks away (F84). None where unknown."""
    try:
        b = call(f"/blocks?x1={cx}&y1={y0 - 16}&z1={cz}&x2={cx}&y2={y0 + 32}&z2={cz}")
        names = [b["names"][c] if c >= 0 else None for c in b["cells"]]
    except (urllib.error.HTTPError, KeyError, TypeError):
        return None
    # Open: air and the plants one stands in; passed over: tree crowns and plants one cannot stand on or in
    # (tall flowers and saplings too: standing on one, an agent fell 2 blocks and the spawn check called it misplaced)
    open_ = lambda n: n in ("air", "cave_air", "snow") or bool(re.search(r"grass$|fern$|flower|poppy|dandelion|tulip|orchid|allium|bluet|daisy|cornflower|lily_of|dead_bush|vine|lilac|peony|rose_bush|pitcher_plant|sapling|petals|eyeblossom", n)) and n != "grass_block"
    # Down from the top past air, plants and tree crowns to the first ground: there, or nowhere (under a trunk or in
    # water the server's surface spawn is better than a cave below; a lily pad, a berry bush or a wither rose is no ground,
    # nor anything with water under it)
    for k in range(len(names) - 3, -1, -1):
        n = names[k]
        if n is None or open_(n) or re.search(r"leaves|_log$|cactus|bamboo|sugar_cane", n):
            continue
        if re.search(r"water|lava|lily_pad|sweet_berry_bush|wither_rose", n) or (k and re.search(r"water", names[k - 1] or "")):
            return None
        if all(m and open_(m) for m in names[k + 1:k + 3]):
            return b["y1"] + k + 1
        return None
    return None


def ring_points(cx, cz, size, count, out=4):
    """`count` points spread evenly round the square `out` blocks outside a size x size plot centred at cx, cz: beyond the
    plot and prepare_site's 2-block margin (a line at x + 2i ran off the plot into trees and water with 12 agents, S.0).
    Each with its outward step."""
    half = size // 2
    x1, z1, x2, z2 = cx - half - out, cz - half - out, cx + half - 1 + out, cz + half - 1 + out
    w, d = x2 - x1, z2 - z1
    per = 2 * (w + d)
    pts = []
    for i in range(count):
        s = (i + 0.5) * per / count
        if s < w:
            p = (x1 + s, z2, 0, 1)
        elif s < w + d:
            p = (x2, z2 - (s - w), 1, 0)
        elif s < 2 * w + d:
            p = (x2 - (s - w - d), z1, 0, -1)
        else:
            p = (x1, z1 + (s - 2 * w - d), -1, 0)
        pts.append((int(round(p[0])), int(round(p[1])), p[2], p[3]))
    return pts


FIRST_SITE = 40


def ring_spawns(site, read_ground=True):
    """A stand spot on the ring for each agent: {name: (x, y, z)}, y None where no ground was read within 6 blocks outward
    or 4 along the ring (the server's surface spawn there)."""
    sx, sz, y0 = int(site["x"]), int(site["z"]), int(site.get("y", 70))
    # (sized for the plot the mayor lays out, not the probe's search: its first find_site is raised to 40 when the village
    # has a vanilla library, tieredBrain.ts VANILLA_FIRST_SITE, and a ring round a 30 site lay inside that plot)
    plot = max(int(site.get("size", site_size)), FIRST_SITE)
    spots = {}
    for n, (px, pz, nx, nz) in zip(names, ring_points(sx, sz, plot, len(names))):
        spot = None
        for k in range(7 if read_ground else 0):
            for s in (0, 2, -2, 4, -4):
                x, z = px + nx * k - nz * s, pz + nz * k + nx * s
                y = column_y(x, z, y0)
                if y is not None:
                    spot = (x, y, z)
                    break
            if spot:
                break
        spots[n] = spot or (px, None, pz)
        print(f"SPAWN {n}: {f'ground at {spot[0]},{spot[1]},{spot[2]}' if spot else f'no ground read near {px},{pz}: the server surface spawn there'}", flush=True)
    return spots


def rcon(cmd):
    """A command to the Minecraft server (real Minecraft only; MC_SERVER_DIR picks the test world's)."""
    rc = [sys.executable, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mc", "rcon.py"), cmd]
    try:
        return subprocess.run(rc, capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception as e:
        return f"no RCON: {e}"


def check_spawn(n, spot):
    """Where the agent stands after its spawn, against the spot (lesson 51: a spawn can silently go elsewhere); one teleport
    by command if it is off, its answer printed."""
    x, y, z = spot
    for attempt in range(2):
        try:
            a = next((q for q in call("/agents") or [] if isinstance(q, dict) and q.get("name") == n), None)
        except urllib.error.HTTPError:
            a = None
        p = (a or {}).get("position")
        if p and math.hypot(p["x"] - (x + 0.5), p["z"] - (z + 0.5)) <= (1.5 if y is not None else 20) and (y is None or abs(p["y"] - y) <= 1.5):
            print(f"SPAWN CHECK {n}: at {p['x']:.1f},{p['y']:.1f},{p['z']:.1f}", flush=True)
            return True
        where = f"{p['x']:.1f},{p['y']:.1f},{p['z']:.1f}" if p else "nowhere (no position)"
        # (the teleport only in real Minecraft: its agent server names the Minecraft server it plays on; the sandbox has
        # no RCON, and mc/rcon.py would reach whatever Minecraft server runs beside it)
        try:
            minecraft = bool((call("/status") or {}).get("server"))
        except Exception:
            minecraft = False
        if attempt or y is None or not minecraft:
            print(f"SPAWN WARNING {n}: at {where}, not at {x},{y},{z}", flush=True)
            return False
        print(f"SPAWN WARNING {n}: at {where}, not at {x},{y},{z}; tp: {rcon(f'tp {n} {x + 0.5} {y} {z + 0.5}') or 'no answer'}", flush=True)
        time.sleep(2)
    return False


def find_land(x, z):
    """Search outward from x,z (rings of 8 points, 120 blocks apart) for room to build."""
    points = [(x, z)] + [(x + r * math.cos(a * math.pi / 4), z + r * math.sin(a * math.pi / 4)) for r in (120, 240) for a in range(8)]
    for px, pz in points:
        try:
            call("/agents/Mayor", method="DELETE")
        except urllib.error.HTTPError:
            pass
        # No height: the server puts it on the surface (y 90 put it inside hills)
        call("/agents", {"name": "Mayor", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": px + 0.5, "z": pz + 0.5}})
        time.sleep(10)
        call("/agents/Mayor/act", {"action": "find_site", "size": site_size})
        # find_site takes a few seconds, more when it walks farther out (to atlas candidates: up to 300 blocks, step 2.3)
        for _ in range(300):
            time.sleep(1)
            result = [e for e in call("/agents/Mayor/events?since=0") if e["type"] in ("action_done", "action_failed")]
            if result:
                break
        site = call("/agents/Mayor/memory").get("lastSite")
        spots = ring_spawns(site) if site else None
        call("/agents/Mayor", method="DELETE")
        # Survival villages need trees near them (Accept7's desert site had none within 112 blocks)
        treeless = gamemode == "survival" and result and any(w in result[-1]["text"] for w in ("No trees within 48 blocks", "too few trees"))
        if result and result[-1]["type"] == "action_done" and site and not treeless:
            print(f"land found near {px:.0f},{pz:.0f}: {result[-1]['text'][:120]}", flush=True)
            # The village starts at the site found, not at the probe point (Accept17's mayor spawned 100 blocks from the
            # site, stuck in a hollow, and spent the run walking)
            return site["x"], site["z"], spots
        print(f"no room near {px:.0f},{pz:.0f}: {result[-1]['text'][60:200] if result else 'no result'}", flush=True)
    raise SystemExit("no land found")


names = ["Mayor"] + [f"Worker{i + 1}" for i in range(workers)]
# MCAI_NO_PROBE=1: start the village at X,Z itself, poor land or not (scouting tests, plan step 2.4): the agents get the
# server's surface spawn on the ring round it
if os.environ.get("MCAI_NO_PROBE") == "1":
    spots = ring_spawns({"x": x, "z": z, "size": site_size}, read_ground=False)
else:
    x, z, spots = find_land(x, z)
call("/village", {"name": village, "objective": objective})
# The run's usage counts from here (the probe's idle Mayor makes no model calls)
usage_since = int(time.time() * 1000)
for i, n in enumerate(names):
    mem = {**BASE, "village": village, "planModel": mayor_planner if i == 0 else worker_planner, **({"villageRole": "mayor"} if i == 0 else {})}
    sx_, sy_, sz_ = spots[n]
    try:
        call("/agents", {"name": n, "role": "mayor" if i == 0 else "builder", "brain": "tiered", "gamemode": gamemode, "reset": True,
                         "position": {"x": sx_ + 0.5, **({"y": sy_} if sy_ is not None else {}), "z": sz_ + 0.5}, "memory": mem})
        check_spawn(n, spots[n])
    except urllib.error.HTTPError as e:
        print(f"{n}: {e.code} {e.read()[:100]}")
print(f"RUN village={village} agents={','.join(names)} start={usage_since}", flush=True)
bring_player("Mayor")
print(f"spawned {', '.join(names)} in village {village}; mayor plans with {mayor_planner}, workers with {worker_planner}, "
      f"designs by {BASE['designModel']}, executors {BASE['execModel']}, {gamemode}, reasoning {BASE.get('reasoning', 'default')}", flush=True)

t0, seen, board, reason, chats = time.time(), {n: 0 for n in names}, "", "time limit", 0
last_done = time.time()
fails = {}
stamp = lambda: f"{(time.time() - t0) / 60:4.1f}m"
# S.0's measurements: busy and idle time per agent, the board's stamps for the critical path, each agent's last success
clock, stamps, last_ok, complete_at = BusyClock(names), BoardStamps(), {n: time.time() for n in names}, None
stock_seen = [None, 0.0]


def stock_line(v, force=False):
    """The storage's totals, when they changed and at most every 30 s (the value curve of autonomy_metrics.py)."""
    tot = {}
    for c in (v.get("storage") or {}).get("chests", []):
        for k, q in c["items"].items():
            tot[k] = tot.get(k, 0) + q
    if tot != stock_seen[0] and (force or time.time() - stock_seen[1] >= 30):
        stock_seen[:] = [tot, time.time()]
        print(f"STOCK {stamp()} {json.dumps(tot, sort_keys=True)}", flush=True)


def listing():
    try:
        return call("/agents")
    except urllib.error.HTTPError:
        return None


while time.time() - t0 < minutes * 60:
    time.sleep(5)
    for n in names:
        try:
            events = call(f"/agents/{n}/events?since={seen[n]}")
        except urllib.error.HTTPError:
            continue
        for e in events:
            seen[n] = e["id"]
            if e["type"] == "chat":
                chats += 1
            elif e["type"] in ("action_done", "action_failed", "system"):
                # Failures and finished builds in full (their reasons are at the end); the rest shortened
                full = e["type"] == "action_failed" or e["text"].startswith("build_design finished")
                print(f"{stamp()} {n:8} {e['type']:13} | {e['text'] if full else e['text'][:220]}", flush=True)
                # Progress also counts: brain tools (designs, the layout) report as system events
                if e["type"] == "action_done" or (e["type"] == "system" and re.search(r"saved|Laid out|Posted tasks", e["text"])):
                    last_done = last_ok[n] = time.time()
                # (both are an agent at work for the per-agent stall rule: a miner waits up to 2 minutes for a face twice)
                if e["type"] == "action_failed" and ("cannot be gathered here" in e["text"] or "the mine is busy" in e["text"] or "being taken by other gatherers" in e["text"]):
                    last_ok[n] = time.time()
                # (a busy mine is no stuck agent: the gathering Mayor, a third miner, hands its task back for later, V2.3m;
                # nor is material others are taking, S.1)
                if e["type"] == "action_failed" and "the mine is busy" not in e["text"] and "being taken by other gatherers" not in e["text"]:
                    k = (n, e["text"][:80])
                    fails[k] = fails.get(k, 0) + 1
                    if fails[k] >= same_fail:
                        reason = f"{n} failed the same way {same_fail} times: {e['text'][:160]}"
    agents_now = listing()
    clock.sample(agents_now, "before")
    v = call(f"/village/{village}")
    stamps.update(v["tasks"])
    stock_line(v)
    b = " ".join(f"{t['id']}:{t['status']}{'/' + t['claimedBy'] if t.get('claimedBy') else ''}" for t in v["tasks"])
    if b != board:
        board = b
        print(f"{stamp()} BOARD {b}", flush=True)
    if reason != "time limit":
        break
    if v.get("complete"):
        reason = "objective declared complete"
        complete_at = time.time()
        print(f"{stamp()} COMPLETE at {stamp().strip()}", flush=True)
        break
    if time.time() - last_done > stall_minutes * 60:
        reason = f"stalled: no successful action for {stall_minutes:g} minutes"
        break
    # The stall rule per agent: one that holds a task or runs an action and has had no success for agent_stall minutes
    # (with 12 agents one success reset the village's clock for all); one with nothing to do (a mayor thinking, a worker
    # with nothing claimable) is idle, not stalled
    holding = {t["claimedBy"]: t["id"] for t in v["tasks"] if t["status"] == "claimed" and t.get("claimedBy")}
    running = {a.get("name"): a.get("action") for a in agents_now if isinstance(a, dict)} if isinstance(agents_now, list) else {}
    for n in names:
        if n not in holding and not running.get(n):
            last_ok[n] = time.time()
        elif reason == "time limit" and time.time() - last_ok[n] > agent_stall * 60:
            what = f"holding {holding[n]}" if n in holding else f"running {(running.get(n) or {}).get('type', 'an action')}"
            reason = f"{n} stalled: no successful action for {agent_stall:g} minutes while {what}"
    if reason != "time limit":
        break

if after and reason == "objective declared complete":
    print(f"{stamp()} COMPLETE; watching {after:g} min more (MCAI_AFTER)", flush=True)
    t2, slots_seen, explore_seen = time.time(), {}, None
    print(f"AFTER start at {stamp().strip()}", flush=True)
    clock.restart()
    while time.time() - t2 < after * 60:
        time.sleep(5)
        clock.sample(listing(), "after")
        for n in names:
            try:
                events = call(f"/agents/{n}/events?since={seen[n]}")
            except urllib.error.HTTPError:
                continue
            for e in events:
                seen[n] = e["id"]
                if e["type"] in ("action_done", "action_failed"):
                    print(f"AFTER {(time.time() - t2) / 60:4.1f}m {n:8} {e['type']:13} | {e['text'][:300]}", flush=True)
        v = call(f"/village/{village}")
        stock_line(v)
        for k, lay in enumerate(v.get("layouts") or []):
            for j, sl in enumerate(lay.get("slots") or []):
                t = f"{sl.get('kind') or 'free'} planted={sl.get('planted')} harvests={sl.get('harvests')} tries={sl.get('tries')}"
                if slots_seen.get((k, j)) != t:
                    slots_seen[(k, j)] = t
                    print(f"AFTER {(time.time() - t2) / 60:4.1f}m SLOT {k + 1}.{j + 1}: {t}", flush=True)
        if v.get("explore") != explore_seen:
            explore_seen = v.get("explore")
            print(f"AFTER {(time.time() - t2) / 60:4.1f}m EXPLORE {json.dumps(explore_seen)[:300]}", flush=True)
    reason += f", then {after:g} min after"

v = call(f"/village/{village}")
stamps.update(v["tasks"])
stock_line(v, force=True)
u = usage_report(usage_since, names)
print(f"RUN village={village} end={int(time.time() * 1000)}", flush=True)
print(f"\nSTOPPED after {(time.time() - t0) / 60:.1f}m ({reason}); {chats} chat messages heard{usage_suffix(u)}")
print("TASKS")
for t in v["tasks"]:
    print(f"  {t['id']} [{t['status']}{'/' + t['claimedBy'] if t.get('claimedBy') else ''}] {t['title']}: {t['detail'][:140]}")
for line in clock.lines() + critical_path_lines(v["tasks"], stamps, t0, complete_at):
    print(line)
print("DESIGNS", [(d["name"], f"{d['width']}x{d['depth']}x{d['height']}") for d in v["designs"].values()])
print("PLOTS", [(p["id"], p["x1"], p["x2"], p["z1"], p["z2"], p["y"]) for p in v["plots"]])
storage = {}
for c in (v.get("storage") or {}).get("chests", []):
    for k, q in c["items"].items():
        storage[k] = storage.get(k, 0) + q
print("STORAGE", storage)
print("STRUCTURES", [(s["kind"], s["x1"], s["x2"], s["z1"], s["z2"], s["builtBy"]) for s in v["structures"]])
for n in names:
    try:
        mem = call(f"/agents/{n}/memory") or {}
        st = mem.get("stats") or {}
        out_tokens = sum(st.get(k + "OutTokensTotal", 0) for k in ("plan", "design", "exec"))
        refused = f", budget-refused {st['budgetRefused']}" if st.get("budgetRefused") else ""
        # (the stuck rescues by how, from the agent's memory: interventions for autonomy_metrics.py)
        rescues = {k: q for k, q in (mem.get("rescues") or {}).items() if k != "last"}
        print(f"STATS {n}: plan {st.get('planCalls', 0)}x{st.get('planMsAvg', 0)}ms, exec {st.get('execCalls', 0)}x{st.get('execMsAvg', 0)}ms, "
              f"design {st.get('designCalls', 0)}x{st.get('designMsAvg', 0)}ms, done {st.get('actionsDone', 0)}, failed {st.get('actionsFailed', 0)}, "
              f"designs {st.get('designs', 0)}, refused {st.get('repeatsRefused', 0)}, out tokens {out_tokens}{refused}, rescues {json.dumps(rescues)}")
    except urllib.error.HTTPError:
        pass
for line in usage_lines(u, names):
    print(line)
