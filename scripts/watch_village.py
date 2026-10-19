"""Run a village: one mayor plus workers, all tiered agents, until the mayor declares the objective complete, the run
stalls (no successful action for MCAI_STALL_MIN minutes, default 3), one agent holding a task or running an action has had
no successful action for MCAI_AGENT_STALL_MIN minutes (default MCAI_STALL_MIN, at least 10; "cannot be gathered here" and
"the mine is busy" count as work), an agent fails the same way MCAI_SAME_FAIL
times (default 3), or time runs out. Agents are in creative mode unless
MCAI_GAMEMODE=survival (real Minecraft's village economy: materials are gathered, stored and paid for).
The agents spawn on a ring 4 blocks outside a 40 plot round the site (the mayor's first plot; beyond its margin), on ground read from the world while the
probe keeps it loaded, and where they stand is checked (S.0); spawns go at least MCAI_SPAWN_GAP_S seconds apart (default
2.5, E.1). At the end: each agent's busy and idle minutes (BUSY lines),
the critical path through the board's tasks (CRIT lines), and STOCK lines of the storage during the run for
scripts/checks/autonomy_metrics.py. With MCAI_AFTER and a growing village (the agent server started with MC_GROW=1), the
growth layouts as stage_village.py prints them (AFTER GROW, GROW layouts and a GROW line, critical path and task spans per
layout), and the CRITICAL PATH counts only the tasks before the first growth layout's first id. With MCAI_AFTER and the
agent server's MC_APPETITE (s30's food step), the FOOD lines as stage_village.py prints them (every 2 minutes, then each
member, the hungry share, the FOOD ok or FOOD MISMATCH ledger and FIELDS ticking).

Usage: python scripts/watch_village.py VILLAGE X Z WORKERS MAX_MINUTES "objective" [WORKER_PLANNER] [SITE_SIZE]
Starts near X,Z: the Mayor (as an idle agent) first searches outward from there for dry land with room for a SITE_SIZE plot (default 30);
MCAI_NO_PROBE=1 starts the village at X,Z itself instead (scouting tests).
Every role defaults to ollama:gpt-oss:120b-cloud: WORKER_PLANNER, MCAI_MAYOR_MODEL (the mayor's planner),
MCAI_DESIGN_MODEL (the architect) and MCAI_EXEC_MODEL (every executor). Name a local model for a fallback run
(MCAI_EXEC_MODEL=ollama:qwen3:30b-instruct, WORKER_PLANNER ollama:qwen3.8:27b): that needs the agent server started with
MC_OLLAMA_ROUTES and `python scripts/ollama_exec.py start`. MCAI_REASONING (e.g. exec=medium) overrides the brain's
reasoning levels. The STOPPED line ends with the run's tokens and cost (/api/usage since the spawn).
"""
import json, os, math, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

# Chat and model text can hold any character; the Windows console encoding cannot
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "checks"))
from agent_names import worker_names  # noqa: E402
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
# Seconds at least between two spawn POSTs (E.1: 25 bots joining at once load every chunk round the site together)
SPAWN_GAP = float(os.environ.get("MCAI_SPAWN_GAP_S", "2.5"))


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


names = ["Mayor"] + worker_names(workers)  # (#11: the pool of first names, server/src/agentNames.ts)
# MCAI_NO_PROBE=1: start the village at X,Z itself, poor land or not (scouting tests, plan step 2.4): the agents get the
# server's surface spawn on the ring round it
if os.environ.get("MCAI_NO_PROBE") == "1":
    spots = ring_spawns({"x": x, "z": z, "size": site_size}, read_ground=False)
else:
    x, z, spots = find_land(x, z)
call("/village", {"name": village, "objective": objective})
# The run's usage counts from here (the probe's idle Mayor makes no model calls)
usage_since = int(time.time() * 1000)
last_spawn = 0.0
for i, n in enumerate(names):
    mem = {**BASE, "village": village, "planModel": mayor_planner if i == 0 else worker_planner, **({"villageRole": "mayor"} if i == 0 else {})}
    sx_, sy_, sz_ = spots[n]
    time.sleep(max(0.0, last_spawn + SPAWN_GAP - time.time()))
    last_spawn = time.time()
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


# A village that grows (s30, runs/2026-10-15/s30/spec_grow.md 8; as in stage_village.py, keep the two alike): the growth layouts as the village record shows them
# (v.growth: the active layout with its first task id `from`, the past ones; layouts[] entries carry grow: k), and the
# board split at the first growth layout's first id so the run's own lines describe the village it built
DWELLING_PIECE = re.compile(r"^(plains|desert|savanna|taiga|snowy)_")


def is_dwelling(name):
    """grow.ts isDwelling (D3), for the houses count H: vanilla pieces only as small, medium or big houses, other names by
    their words."""
    if name in ("storage_hut", "mining_hut"):
        return False
    if DWELLING_PIECE.match(name):
        return bool(re.search(r"_(small|medium|big)_house_\d+$", name))
    return bool(re.search(r"house|cottage|home|cabin|dwelling|lodge|hut", name)) and not re.search(
        r"hall|library|meeting|shop|smith|temple|church|tavern|inn|market|barn|storage|workshop|mine|tower", name)


def task_num(t):
    return int(re.sub(r"\D", "", str(t["id"])) or 0)


GROW_GATHER = re.compile(r"^Gather \d+ (\S+)")
# Growth tasks that take from or put into storage (builds, lamps, signs, the windows' make): their claim-to-end spans go to
# make_log.py as GROW TASK lines, so a make they overlap is not read as a storage mismatch (lesson 132)
GROW_STORAGE = re.compile(r"^(Build |Light the streets|Put up the sign|Make \d+ )")


def server_grow():
    """Whether the agent server grows villages: /api/status's `grow` (s30), else this environment's MC_GROW (an older
    server; the server's own setting is what counts, the review's lens 3 L5)."""
    try:
        st = call("/status")
        if isinstance(st, dict) and "grow" in st:
            return bool(st["grow"])
    except Exception:
        pass
    return os.environ.get("MC_GROW") == "1"


class GrowWatch:
    """The growth layouts seen during the after phase: each one's first task id (from the active record; a layout ended
    between two polls falls back to its own prepare task, posted first), its record, and the lines to print."""

    def __init__(self, t0, members):
        self.t0, self.members = t0, members
        self.k = {}
        self.seen, self.h0, self.stop = None, None, None
        # (whether the agent server grows villages, read at the after phase's start; the builds' takes by design)
        self.on, self.bills = None, {}

    def takes(self, v, t):
        """What a growth build can take from storage, for make_log.py: its bill's items, what its plan crafts or smelts, and
        fuel when it smelts (GET /api/village/V/designs/D/bill); '' when the API cannot say."""
        m = re.match(r'build_design "([^"]+)"', t.get("detail") or "")
        if not m:
            return ""
        d = m.group(1)
        if d not in self.bills:
            try:
                b = call(f"/village/{urllib.parse.quote(v['name'])}/designs/{urllib.parse.quote(d)}/bill")
            except Exception:
                b = None
            items = set()
            if isinstance(b, dict) and isinstance(b.get("bill"), dict):
                items |= set(b["bill"])
                for st in b.get("steps") or []:
                    items |= {x for x in (st.get("item"), st.get("input")) if x}
                if (b.get("fuel") or {}).get("smelts"):
                    items |= {"charcoal", "coal"}
            self.bills[d] = ",".join(sorted(items))
        return self.bills[d]

    def froms(self, v):
        """{k: first task id}: the active record's where seen, else the k-th growth prepare task's."""
        out = {k: r["from"] for k, r in self.k.items() if r.get("from")}
        preps = sorted(task_num(t) for t in v.get("tasks") or [] if t.get("postedBy") == "grow" and t["title"].startswith("Prepare "))
        for i, n in enumerate(preps):
            out.setdefault(i + 1, n)
        return out

    def first(self, v):
        """The first growth layout's first id, or None (no growth: every task is the village's)."""
        ids = list(self.froms(v).values()) + [task_num(t) for t in v.get("tasks") or [] if t.get("postedBy") == "grow"]
        return min(ids) if ids else None

    def base(self, v):
        """The tasks posted before the first growth layout (the village as built to completion)."""
        f = self.first(v)
        return [t for t in v.get("tasks") or [] if f is None or task_num(t) < f]

    def tasks_of(self, v, k):
        """Layout k's tasks: from its first id to the next layout's (one layout at a time, so its requeues and needs fall
        inside)."""
        fr = self.froms(v)
        lo = fr.get(k)
        if lo is None:
            return []
        hi = min([n for kk, n in fr.items() if n > lo] or [float("inf")])
        return [t for t in v.get("tasks") or [] if lo <= task_num(t) < hi]

    def record(self, v, k):
        r = dict(self.k.get(k) or {})
        g = v.get("growth") or {}
        for p in g.get("past") or []:
            if p.get("k") == k:
                r.update({kk: p[kk] for kk in ("layout", "at", "end", "built", "failed", "members", "why") if kk in p})
                r["n"] = p.get("houses", r.get("n"))
        lay = next((l for l in v.get("layouts") or [] if l.get("grow") == k), None)
        if lay and not r.get("plot"):
            r["plot"] = {q: lay.get(q) for q in ("x1", "x2", "z1", "z2")}
        if lay:
            # (the pad option the layout took, s30's food step: its size and field, or why it has none; lens 3 L9)
            r["pad"] = (f"{lay['x2'] - lay['x1'] + 1}x{lay['z2'] - lay['z1'] + 1}, "
                        + (f"field + {len(lay.get('slots') or [])} slots" if lay.get("farm") else f"no field ({lay['farmWhy']})" if lay.get("farmWhy") else "no field"))
        return r

    def members_now(self, v):
        g = v.get("growth") or {}
        a = g.get("active") or {}
        past = g.get("past") or []
        return a.get("members") or (past[-1].get("members") if past else None) or self.members

    def update(self, v):
        """Lines for what changed since the last poll."""
        out = []
        g = v.get("growth") or {}
        a = g.get("active")
        H = sum(1 for s in v.get("structures") or [] if is_dwelling(s.get("kind", "")))
        if self.h0 is None:
            self.h0 = H
        if a and a.get("k") is not None:
            r = self.k.setdefault(a["k"], {})
            r.update({kk: a.get(kk) for kk in ("layout", "from", "at", "plot", "houses", "builds", "members", "before")})
            r["n"] = len(a.get("houses") or [])
        M = self.members_now(v)
        ks = sorted(set(self.k) | {p.get("k") for p in g.get("past") or [] if p.get("k") is not None})
        for k in ks:
            r = self.record(v, k)
            builds = [t for t in self.tasks_of(v, k) if t["title"].startswith("Build ")]
            n = r.get("n") if r.get("n") is not None else len(builds)
            b = sum(1 for t in builds if t["status"] == "done") if builds else r.get("built", 0)
            ended = r.get("why") or ("ended" if r.get("end") else None)
            sig = (b, n, H, M, ended)
            if self.k.get(k, {}).get("_sig") == sig:
                continue
            self.k.setdefault(k, {})["_sig"] = sig
            p = r.get("plot") or {}
            area = f"{p.get('x1')}..{p.get('x2')},{p.get('z1')}..{p.get('z2')}" if p else "?"
            chests = len((v.get("storage") or {}).get("chests") or [])
            out.append(f"GROW layout {r.get('layout', '?')} ({k}): {n} houses posted at {area}" + (f" (pad {r['pad']})" if r.get("pad") else "")
                       + f"; built {b}/{n}; houses {H} for {M} members; chests {chests}"
                       + (f"; ended {ended}: built {r.get('built', b)} of {n}, failed {r.get('failed', 0)}" if ended else ""))
        if g.get("stop") and g["stop"] != self.stop:
            self.stop = g["stop"]
            out.append(f"GROW stopped: {self.stop}")
        return out

    def end_lines(self, v, stamps):
        """The summary: one line for all layouts, then per layout its houses, members, plot, minutes from posting to built,
        its gathering's minutes and its critical path; then the GROW TASK spans for make_log.py."""
        g = v.get("growth") or {}
        m = lambda s: f"+{(s - self.t0) / 60:.1f}" if s else "-"
        ks = sorted(set(self.froms(v)) | set(self.k) | {p.get("k") for p in g.get("past") or [] if p.get("k") is not None})
        H1 = sum(1 for s in v.get("structures") or [] if is_dwelling(s.get("kind", "")))
        whys, mins, per, crit = {}, [], [], []
        for k in ks:
            r = self.record(v, k)
            tasks = self.tasks_of(v, k)
            builds = [t for t in tasks if t["title"].startswith("Build ")]
            posted = (r["at"] / 1000) if r.get("at") else min([stamps.posted(t) for t in tasks if stamps.posted(t)] or [0]) or None
            ends = [stamps.end(t) for t in builds]
            built_at = max(ends) if builds and all(t["status"] == "done" for t in builds) and all(ends) else None
            why = r.get("why") or ("active" if not r.get("end") else "ended")
            whys[why] = whys.get(why, 0) + 1
            took = (built_at - posted) / 60 if built_at and posted else None
            if took is not None:
                mins.append(took)
            gather = {}
            for t in tasks:
                mm = GROW_GATHER.match(t["title"])
                if not mm or t["status"] != "done" or not stamps.end(t) or not stamps.last_claim(t):
                    continue
                mat = "logs" if mm.group(1) == "logs" or mm.group(1).endswith("_log") else mm.group(1)
                q = gather.setdefault(mat, [0, 0.0])
                q[0] += 1
                q[1] += (stamps.end(t) - stamps.last_claim(t)) / 60
            p = r.get("plot") or {}
            n = r.get("n") if r.get("n") is not None else len(builds)
            per.append(f"GROW layout {r.get('layout', '?')} ({k}): {n} houses ({', '.join(r.get('houses') or []) or '-'}), members {r.get('members', '?')}, "
                       f"plot {p.get('x1')}..{p.get('x2')},{p.get('z1')}..{p.get('z2')}" + (f" (pad {r['pad']})" if r.get("pad") else "") + f", posted {m(posted)}, built "
                       f"{sum(1 for t in builds if t['status'] == 'done')} of {len(builds)}"
                       + (f" by {m(built_at)} ({took:.1f} min from posting)" if took is not None else "")
                       + (f", ended {why} {m(r['end'] / 1000)}" if r.get("end") else f", {why}") + f"; {len(tasks)} tasks; gathering "
                       + (", ".join(f"{mat} {q[0]} tasks {q[1]:.1f} min" for mat, q in sorted(gather.items())) or "none"))
            if posted:
                crit += [ln.replace("CRITICAL PATH", f"GROW CRITICAL PATH layout {r.get('layout', '?')} ({k}),", 1) if ln.startswith("CRITICAL PATH") else "GROW " + ln
                         for ln in critical_path_lines(tasks, stamps, posted)]
        srt = sorted(mins)
        med = f" (median {srt[len(srt) // 2]:.1f})" if srt else ""
        out = [f"GROW layouts {len(ks)} ({whys.get('built', 0)}/{whys.get('failed', 0)}/{whys.get('stuck', 0)}"
               + "".join(f", {n} {w}" for w, n in sorted(whys.items()) if w not in ("built", "failed", "stuck"))
               + f"), houses {self.h0 if self.h0 is not None else '?'} -> {H1} for {self.members_now(v)} members, minutes per layout "
               + ("/".join(f"{x:.1f}" for x in mins) or "-") + med + f", stop: {g.get('stop') or '-'}"]
        out += per + crit
        f = self.first(v)
        for t in v.get("tasks") or []:
            c = stamps.first_claim(t)
            if f is None or task_num(t) < f or not GROW_STORAGE.match(t["title"]) or not c:
                continue
            e = stamps.end(t)
            # (a build's takes: what make_log.py may excuse a make's storage count by, the review's lens 3 M3)
            takes = self.takes(v, t) if t["title"].startswith("Build ") else ""
            out.append(f"GROW TASK {t['id']} claimed={int(c * 1000)} end={int(e * 1000) if e else '-'} by={t.get('claimedBy') or '-'} "
                       + (f"takes={takes} " if takes else "") + t["title"])
        return out


# The village appetite (s30's food step, runs/2026-10-15/s30/spec_food.md 6; as in stage_village.py and watch_village.py,
# keep the two alike): the food points an item gives (appetite.ts FOOD_POINTS, cake 14 for its 7 slices of 2;
# scripts/checks/food_check.mts compares this table with it), and the planting stock a meal never takes (appetite.ts KEEP)
FOOD_POINTS = {
    "bread": 5, "pumpkin_pie": 8, "melon_slice": 2, "carrot": 3, "baked_potato": 5, "potato": 1, "apple": 4, "cookie": 2,
    "beetroot": 1, "mushroom_stew": 6, "beetroot_soup": 6, "rabbit_stew": 10, "sweet_berries": 2, "glow_berries": 2,
    "golden_carrot": 6, "cake": 14,
}
FOOD_KEEP = {"carrot": 8, "potato": 8, "beetroot": 8}
# The foods the village makes (fields, slots, the hut's table, the cake); any other food that turns up in storage came in
# with other work (an apple from oak leaves with the logs), which the ledger notes rather than fails (lesson 132)
FOOD_MADE = {"bread", "pumpkin_pie", "cake", "melon_slice", "carrot", "potato", "beetroot", "baked_potato", "cookie"}
# Food that leaves storage without a meal (the spec check's L5): a farm start from storage takes its kind's count
# (farmSlots.ts SLOT_KINDS take and count: melon slices made into seeds, carrots and potatoes planted); a crop slot's
# replant is netted already (harvest_slot's made is the server-counted change after it). The pie's pumpkins, sugar and egg
# and the cake's wheat, milk, egg and sugar are not food, so the ledger in points never sees them (the conversions line
# names them).
FOOD_STARTS = {"melon": ("melon_slice", 6), "carrots": ("carrot", 6), "potatoes": ("potato", 6)}
# Where a field grows (the food step's live check, s30_crop_reach.py and s30_crop_diag.py): a chunk whose centre is within
# ~115 blocks of a bot (grew at 103.6 and 115.6, not at 119.6)
FOOD_TICK_RANGE = 115
FOOD_PECKISH, FOOD_HUNGRY = 12, 6
FOOD_MEAL = re.compile(r"\bate (\d+) ([a-z_]+)")


def food_store(v):
    """Storage's food items, from the chests as last opened."""
    tot = {}
    for c in (v.get("storage") or {}).get("chests", []):
        for k, q in (c.get("items") or {}).items():
            if k in FOOD_POINTS and q:
                tot[k] = tot.get(k, 0) + q
    return tot


def food_points(counts, meals=False):
    """Points of food in `counts`; `meals`: only what a meal may take (less the planting stock, appetite.ts foodPoints)."""
    return sum(FOOD_POINTS.get(k, 0) * max(0, q - (FOOD_KEEP.get(k, 0) if meals else 0)) for k, q in counts.items())


def food_call(path):
    """A GET that answers None for an error (stage_village.py's call returns HTTP errors, watch_village.py's raises)."""
    try:
        r = call(path)
    except Exception:
        return None
    return None if isinstance(r, dict) and "error" in r and "status" in r else r


class FoodWatch:
    """The village appetite after completion (spec 6): the FOOD line every 2 minutes, then each member's appetite and meals,
    the hungry and D7-busy shares of member-time, the FOOD ledger and how often each planted field was within growing
    range of a bot (FIELDS ticking). Silent unless the agent server has the appetite on (/api/status `appetite.rate`, else
    this environment's MC_APPETITE) or the village keeps a food record."""

    def __init__(self, members):
        self.members = list(members)
        self.on = False
        self.t0 = self.last = self.line_at = self.tick_at = None
        self.base = None
        self.member_s = {n: 0.0 for n in self.members}
        self.hungry_s = {n: 0.0 for n in self.members}
        self.busy_s = {n: 0.0 for n in self.members}
        self.eat_s = 0.0
        self.series = []  # (minute, hungry member-seconds, member-seconds) per sample
        self.ticks = {}  # layout k -> [checks in range, checks]
        self.out, self.eats, self.meal_events = {}, {}, 0

    def start(self, v):
        st = food_call("/status")
        ap = st.get("appetite") if isinstance(st, dict) else None
        env = os.environ.get("MC_APPETITE", "").strip().lower()
        env_rate = 18 if env in ("1", "on", "true") else float(env) if env.replace(".", "", 1).isdigit() else 0
        self.rate = ap.get("rate") if isinstance(ap, dict) else env_rate
        # (the server's rate when it reports one: an old food record on a server with the appetite off is no appetite)
        self.on = bool(self.rate) if isinstance(ap, dict) else bool(self.rate) or bool(v.get("food"))
        self.t0 = self.last = self.line_at = self.tick_at = time.time()
        if self.on:
            self.base = self.snapshot(v)
            return [f"FOOD on: appetite {self.rate or '?'} a busy game-hour" + (f", idle x{ap.get('idle')}, start {ap.get('start')}" if isinstance(ap, dict) else "")
                    + f"; grow farms {'on' if isinstance(st, dict) and st.get('growFarms') else 'off' if isinstance(st, dict) and 'growFarms' in st else '?'}"
                    + f"; storage {food_points(self.base['store'], True)} pts {self.items_text(self.base['store'])}"]
        return []

    def items_text(self, counts, n=5):
        top = sorted(counts.items(), key=lambda kv: -FOOD_POINTS.get(kv[0], 0) * kv[1])[:n]
        return "(" + (", ".join(f"{q} {k}" for k, q in top) or "none") + ")"

    def levels(self, v):
        mem = ((v.get("food") or {}).get("members") or {})
        return {n: (mem.get(n) or {}).get("level") for n in self.members}

    def event(self, name, e):
        """An action_done event of the after phase: from-storage farm starts and crop harvests take food out without a meal,
        and each eat_meal's message names what was eaten (checked against the record's eaten)."""
        if not self.on or e.get("type") != "action_done":
            return
        d = e.get("data") or {}
        t, a = d.get("type"), d.get("args") or {}
        if t == "start_farm" and a.get("from") == "storage" and a.get("kind") in FOOD_STARTS:
            item, n = FOOD_STARTS[a["kind"]]
            self.out[item] = self.out.get(item, 0) + n
        elif t == "eat_meal":
            self.meal_events += 1
            for q, item in FOOD_MEAL.findall(e.get("text") or ""):
                self.eats[item] = self.eats.get(item, 0) + int(q)

    def sample(self, v, listing):
        """One sample of the watch loop: the members' appetite states and D7's busy (an action other than eat_meal), each
        planted field's growing range every 30 s, and the FOOD line every 2 minutes (returned)."""
        if not self.on:
            return []
        now = time.time()
        dt, self.last = now - self.last, now
        lv = self.levels(v)
        acts = {a.get("name"): a for a in listing} if isinstance(listing, list) else {}
        hungry = 0.0
        for n in self.members:
            if n not in acts:
                continue
            self.member_s[n] += dt
            if lv.get(n) is not None and lv[n] <= FOOD_HUNGRY:
                self.hungry_s[n] += dt
                hungry += dt
            act = acts[n].get("action")
            kind = act.get("type") if isinstance(act, dict) else None
            if kind == "eat_meal":
                self.eat_s += dt
            elif act:
                self.busy_s[n] += dt
        self.series.append(((now - self.t0) / 60, hungry, dt * sum(1 for n in self.members if n in acts)))
        if now - self.tick_at >= 30 and isinstance(listing, list):
            self.tick_at = now
            bots = [(a["position"]["x"], a["position"]["z"]) for a in listing if a.get("position")]
            for k, lay in enumerate(v.get("layouts") or []):
                f = lay.get("farm")
                if not f or not f.get("planted"):
                    continue
                chunks = [(cx * 16 + 8, cz * 16 + 8) for cx in range(f["x1"] >> 4, (f["x2"] >> 4) + 1) for cz in range(f["z1"] >> 4, (f["z2"] >> 4) + 1)]
                near = all(any(math.hypot(x - bx, z - bz) <= FOOD_TICK_RANGE for bx, bz in bots) for x, z in chunks)
                t = self.ticks.setdefault(k, [0, 0])
                t[0] += near
                t[1] += 1
        if now - self.line_at >= 120:
            self.line_at = now
            return [self.line(v, lv)]
        return []

    def line(self, v, lv=None):
        lv = lv if lv is not None else self.levels(v)
        food = v.get("food") or {}
        store = food_store(v)
        b = self.base or {"made": {}, "eaten": {}, "meals": 0}
        made = {k: q - b["made"].get(k, 0) for k, q in (food.get("made") or {}).items() if q - b["made"].get(k, 0)}
        eaten = {k: q - b["eaten"].get(k, 0) for k, q in (food.get("eaten") or {}).items() if q - b["eaten"].get(k, 0)}
        fields = [lay.get("farm") for lay in v.get("layouts") or [] if lay.get("farm")]
        peckish = sum(1 for n in self.members if lv.get(n) is not None and FOOD_HUNGRY < lv[n] <= FOOD_PECKISH)
        hungry = sum(1 for n in self.members if lv.get(n) is not None and lv[n] <= FOOD_HUNGRY)
        return (f"FOOD stock {food_points(store, True)} pts ({', '.join(f'{store.get(k, 0)} {k}' for k in ('bread', 'cake', 'pumpkin_pie', 'melon_slice'))}"
                + "".join(f", {q} {k}" for k, q in sorted(store.items()) if k not in ("bread", "cake", "pumpkin_pie", "melon_slice")) + ")"
                + f" | made {' '.join(f'{k} {q}' for k, q in sorted(made.items(), key=lambda kv: -kv[1])[:6]) or 'nothing'}"
                + f" | eaten {(food.get('meals') or 0) - b['meals']} meals {food_points(eaten)} pts"
                + f" | fields {len(fields)} (planted {sum(1 for f in fields if f.get('planted'))}, harvested {sum(1 for f in fields if f.get('harvests'))}, harvests {sum(f.get('harvests') or 0 for f in fields)})"
                + f" | peckish {peckish} hungry {hungry}")

    def snapshot(self, v):
        """Storage, what the members carry, the record's made, eaten and meals (and `used` if the server keeps one), and the
        bread the fields' harvests baked, as counts."""
        food = v.get("food") or {}
        carried = {}
        for n in self.members:
            o = food_call(f"/agents/{n}")
            for k, q in ((o.get("inventory") or {}) if isinstance(o, dict) else {}).items():
                if k in FOOD_POINTS and q:
                    carried[k] = carried.get(k, 0) + q
        return {"store": food_store(v), "carried": carried, "made": dict(food.get("made") or {}), "eaten": dict(food.get("eaten") or {}),
                "used": dict(food.get("used") or {}), "meals": food.get("meals") or 0,
                "bread": sum(((lay.get("farm") or {}).get("bread") or 0) for lay in v.get("layouts") or [])}

    def ledger(self, e, eating):
        """Food in storage and carried changed by what was made less what was eaten and what left without a meal (lesson
        132: every flow named): ([mismatches], [notes]). `eating`: eat_meal actions running at either snapshot (a meal in
        flight may be taken and not yet recorded: up to 4 items each)."""
        b = self.base
        d = lambda key, k: e[key].get(k, 0) - b[key].get(k, 0)
        keyed = ("store", "carried", "made", "eaten", "used")
        items = sorted({k for s in (b, e) for key in keyed for k in s[key] if k in FOOD_POINTS} | set(self.out) | set(self.eats))
        used_rec = bool(b["used"] or e["used"])
        bad, notes = [], []
        slack = 4 * eating
        for k in items:
            moved = d("store", k) + d("carried", k)
            made, eaten = d("made", k), d("eaten", k)
            used = d("used", k) if used_rec else self.out.get(k, 0)
            u = moved - made + eaten + used
            what = (f"{k}: storage {d('store', k):+d}, carried {d('carried', k):+d}, made {made}, eaten {eaten}"
                    + (f", out without a meal {used}" if used else "") + f" (unexplained {u:+d})")
            if u == 0:
                continue
            # (no replant excuse: harvest_slot's made is already net of its replant, lens 3 L1)
            if abs(u) <= slack:
                notes.append(f"{what}: {eating} meal(s) in flight")
            elif u > 0 and k not in FOOD_MADE:
                notes.append(f"{what}: came in with other work")
            else:
                bad.append(what)
        # (bread from the harvest chore is the record's too, spec 4.5; the fields count it per layout)
        hb = e["bread"] - b["bread"]
        if hb > d("made", "bread"):
            bad.append(f"bread: the harvests baked {hb} but the record's made counts {d('made', 'bread')}")
        # (each eat_meal's message against the record's eaten: the record short of the messages is a mismatch; messages short
        # of the record a note, a meal may end after the watch's last read of the events)
        for k in sorted(set(self.eats) | {k for k in e["eaten"] if d("eaten", k)}):
            said, rec = self.eats.get(k, 0), d("eaten", k)
            if said > rec + slack:
                bad.append(f"{k}: the meals' messages ate {said}, the record's eaten {rec}")
            elif rec > said:
                notes.append(f"{k}: the record's eaten {rec}, the meals' messages seen {said} (meals after the last read of the events)")
        return bad, notes

    def end_lines(self, v, listing, wait=None):
        """At the end: FOOD per agent, the shares, the conversions, the ledger (read again up to 3 times, 5 s apart, while
        it does not add up: agents are still at work) and FIELDS ticking."""
        if not self.on:
            return []
        out = []
        lv = self.levels(v)
        out.append(self.line(v, lv))
        mem = ((v.get("food") or {}).get("members") or {})
        per = [f"{n} level {lv[n]:.1f} meals {(mem.get(n) or {}).get('meals', 0)} hungry {self.hungry_s[n] / 60:.1f} min" if lv.get(n) is not None
               else f"{n} no record" for n in self.members]
        out.append("FOOD per agent: " + ", ".join(per))
        none = [n for n in self.members if not (mem.get(n) or {}).get("meals")]
        out.append(f"FOOD members {len(self.members)}: every member ate {'yes' if not none else 'no'}" + (f" ({len(none)} without a meal: {', '.join(none)})" if none else ""))
        span = lambda m: (sum(h for t, h, _ in self.series if t >= m), sum(s for t, _, s in self.series if t >= m))
        share = lambda m: (lambda hs: f"{100 * hs[0] / hs[1]:.1f}%" if hs[1] else "-")(span(m))
        total = sum(self.member_s.values())
        out.append(f"FOOD hungry share of member-time: all {share(0)}, after +30 {share(30)}, after +45 {share(45)}; "
                   f"busy (D7: an action other than eat_meal) {100 * sum(self.busy_s.values()) / total:.1f}%" if total else "FOOD hungry share: no samples")
        out[-1] += f"; eating {self.eat_s / 60:.1f} agent-min, {self.meal_events} meals seen"
        food = v.get("food") or {}
        made = {k: q - self.base["made"].get(k, 0) for k, q in (food.get("made") or {}).items()}
        out.append(f"FOOD conversions: bread {made.get('bread', 0)} (from harvests {sum(((lay.get('farm') or {}).get('bread') or 0) for lay in v.get('layouts') or []) - self.base['bread']}), "
                   f"pumpkin_pie {made.get('pumpkin_pie', 0)} (pumpkins, sugar and eggs are not food), cake {made.get('cake', 0)}; "
                   f"out without a meal {', '.join(f'{q} {k}' for k, q in sorted(self.out.items())) or 'none'}")
        bad = notes = None
        for attempt in range(4):
            if attempt:
                time.sleep(5)
                v = food_call(f"/village/{v['name']}") or v
                listing = food_call("/agents")
            eating = sum(1 for a in listing or [] if a.get("name") in self.members and isinstance(a.get("action"), dict) and a["action"].get("type") == "eat_meal")
            e = self.snapshot(v)
            bad, notes = self.ledger(e, eating)
            if not bad:
                break
        moved = food_points(e["store"]) - food_points(self.base["store"]) + food_points(e["carried"]) - food_points(self.base["carried"])
        mp = food_points({k: q - self.base["made"].get(k, 0) for k, q in e["made"].items()})
        ep = food_points({k: q - self.base["eaten"].get(k, 0) for k, q in e["eaten"].items()})
        head = f"made {mp} pts, eaten {ep} pts, storage and carried {moved:+d} pts"
        for n in notes:
            out.append(f"FOOD note: {n}")
        out.append(f"FOOD ok ({head})" if not bad else f"FOOD MISMATCH {'; '.join(bad)} ({head})")
        ticks = [f"layout {k + 1} {100 * t[0] / t[1]:.0f}% of {t[1]} checks" for k, t in sorted(self.ticks.items()) if t[1]]
        out.append("FIELDS ticking: " + (", ".join(ticks) if ticks else "no planted field checked") + f" (a chunk centre within {FOOD_TICK_RANGE} of a bot)")
        return out


grow = GrowWatch(t0, len(names))

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
                # (both are an agent at work for the per-agent stall rule: a miner waits up to a minute for a face, S.2, then
                # hands its task back)
                # (and a busy resource or material taken, by their contention codes, E.0; reserved ground still counts)
                contended = (e.get("data") or {}).get("code") in ("busy", "taken")
                if e["type"] == "action_failed" and ("cannot be gathered here" in e["text"] or "the mine is busy" in e["text"] or "being taken by other gatherers" in e["text"] or contended):
                    last_ok[n] = time.time()
                # (a busy mine is no stuck agent: the gathering Mayor, a third miner, hands its task back for later, V2.3m;
                # nor is material others are taking, S.1)
                if e["type"] == "action_failed" and "the mine is busy" not in e["text"] and "being taken by other gatherers" not in e["text"] and not contended:
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
    # (a village that grows, s30: as the agent server says, else this environment's MC_GROW)
    grow.on = server_grow()
    print(f"AFTER GROW {'on' if grow.on else 'off'}", flush=True)
    # (the village appetite, s30's food step: silent unless the agent server has it on)
    food = FoodWatch(names)
    for line in food.start(call(f"/village/{village}")):
        print(f"AFTER {line}", flush=True)
    clock.restart()
    while time.time() - t2 < after * 60:
        time.sleep(5)
        agents_now = listing()
        clock.sample(agents_now, "after")
        for n in names:
            try:
                events = call(f"/agents/{n}/events?since={seen[n]}")
            except urllib.error.HTTPError:
                continue
            for e in events:
                seen[n] = e["id"]
                if e["type"] in ("action_done", "action_failed"):
                    print(f"AFTER {(time.time() - t2) / 60:4.1f}m {n:8} {e['type']:13} | {e['text'][:300]}", flush=True)
                    food.event(n, e)
        v = call(f"/village/{village}")
        for line in food.sample(v, agents_now):
            print(f"AFTER {(time.time() - t2) / 60:4.1f}m {line}", flush=True)
        stock_line(v)
        # (the board's stamps go on through the after phase: growth tasks are claimed and done there, the spec check's M2)
        stamps.update(v["tasks"])
        for line in grow.update(v):
            print(f"AFTER {(time.time() - t2) / 60:4.1f}m {line}", flush=True)
        for k, lay in enumerate(v.get("layouts") or []):
            for j, sl in enumerate(lay.get("slots") or []):
                t = f"{sl.get('kind') or 'free'} planted={sl.get('planted')} harvests={sl.get('harvests')} tries={sl.get('tries')}"
                if slots_seen.get((k, j)) != t:
                    slots_seen[(k, j)] = t
                    print(f"AFTER {(time.time() - t2) / 60:4.1f}m SLOT {k + 1}.{j + 1}: {t}", flush=True)
        if v.get("explore") != explore_seen:
            explore_seen = v.get("explore")
            print(f"AFTER {(time.time() - t2) / 60:4.1f}m EXPLORE {json.dumps(explore_seen)[:300]}", flush=True)
    for line in food.end_lines(call(f"/village/{village}"), listing()):
        print(line, flush=True)
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
# (the village as built to completion: the tasks before the first growth layout's first id; then the growth layouts')
for line in clock.lines() + critical_path_lines(grow.base(v), stamps, t0, complete_at):
    print(line)
# (only with growth: a run without it prints what it did before s30, the review's lens 3 L4)
if (grow.on and after and reason.endswith(" min after")) or v.get("growth"):
    for line in grow.end_lines(v, stamps):
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
              f"contention {st.get('contention', 0)}, designs {st.get('designs', 0)}, refused {st.get('repeatsRefused', 0)}, out tokens {out_tokens}{refused}, rescues {json.dumps(rescues)}")
    except urllib.error.HTTPError:
        pass
for line in usage_lines(u, names):
    print(line)
