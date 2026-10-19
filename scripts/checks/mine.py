"""The village mine (plan steps V.5, V.5b, S.2): BOTS survival members of the village (Gus alone by default; Worker1..N with
BOTS=N) run `collect cobblestone` ROUNDS times, all at once each round; around each round the check snapshots the mine's
level with /api/blocks (every main tunnel's reach grown by 30 blocks sideways, from the floor to the ceiling) and works out
the planned cells from the mine's record (S.2's tunnels kept per part exactly, by the geometry ported from mcMine.ts; older
tunnels kept in order by tunnelCell over their count, with each branch cut short taken as its open run from the tunnel) to
verify that each bot's stone came from the village mine, that every cell dug this round is open (two high), and that
nothing else at the mine's level changed (WARN for leaves, plants and water or lava flowing, and for a block turned into
another block). With MINE_LOG (the agent server's log), check (e) reads the `[mine]` lines written during the check: no
cell dug twice or by two bots, every dug cell in the plan, and one holder a unit (no bot takes a tunnel's main cells or a
branch that another holds before that one finished, ended or left it). Where units share cells (a turned tunnel's
branches cross or run along another tunnel's), one bot digs them and the others pass them.
Usage: python scripts/checks/mine.py VILLAGE [ROUNDS [COUNT]] (default 3 rounds of 24 cobblestone). The village needs a
mine dug to stone (`level` and `legs` in its record). Needs the agent server (MCAI_API, default port 8766); the bots spawn
inside the mining hut (each removed first, so a staged run's Worker1 and Worker2 go too) and are removed at the end. They
start with nothing (reset): GIVE=1 gives each 2 stone pickaxes by RCON (mc/rcon.py; MC_SERVER_DIR=mc/testserver for the
test world); else the script waits PICKAXE_WAIT seconds (default 120, env) for pickaxes given with RCON (it prints the
commands); with none the skill makes its own (logs from outside, a crafting table). Exits non-zero on any FAIL.
"""
import json, os, re, subprocess, sys, time, urllib.error, urllib.request

sys.stdout.reconfigure(encoding="utf-8")

API = os.environ.get("MCAI_API", "http://127.0.0.1:8766/api").rstrip("/")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if len(sys.argv) < 2:
    raise SystemExit("usage: python scripts/checks/mine.py VILLAGE [ROUNDS [COUNT]]")
VILLAGE = sys.argv[1]
ROUNDS = int(sys.argv[2]) if len(sys.argv) > 2 else 3
COUNT = int(sys.argv[3]) if len(sys.argv) > 3 else 24
PICKAXE_WAIT = int(os.environ.get("PICKAXE_WAIT", "120"))
BOTS = max(1, int(os.environ.get("BOTS", "1")))
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent.parent))
from agent_names import worker_names
NAMES = ["Gus"] if BOTS == 1 else worker_names(BOTS)
GIVE = os.environ.get("GIVE") == "1"
MINE_LOG = os.environ.get("MINE_LOG")
ROUND_TIMEOUT = 8 * 60
GROW = 30
MAX_CELLS = 65536

# mcMine.ts: main tunnel columns between branches, each branch's length, the cells of one stretch
MAIN_STEP, BRANCH = 3, 12
PER = MAIN_STEP + 2 * BRANCH

AIR = ("air", "cave_air", "void_air")
# Changes that may happen by themselves (or are not the mine's digging): reported as WARN
SOFT = ("_leaves", "short_grass", "tall_grass", "fern", "large_fern", "water", "lava", "bubble_column", "seagrass", "kelp",
        "kelp_plant", "vine", "glow_lichen", "sapling", "dead_bush", "bush", "leaf_litter", "petals", "wildflowers",
        "dandelion", "poppy", "tulip", "orchid", "allium", "azure_bluet", "oxeye_daisy", "cornflower", "lily_of_the_valley",
        "sunflower", "lilac", "rose_bush", "peony", "snow", "moss_carpet", "hanging_roots", "spore_blossom", "cave_vines",
        "cave_vines_plant", "big_dripleaf", "big_dripleaf_stem", "small_dripleaf")


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def rcon(cmd):
    """One RCON command through mc/rcon.py (MC_SERVER_DIR picks the server folder)."""
    return subprocess.run([sys.executable, os.path.join(ROOT, "mc", "rcon.py"), cmd], capture_output=True, text=True).stdout.strip()


def is_air(n):
    return n in AIR


def soft(n):
    return any(n == s or n.endswith(s) for s in SOFT)


def tunnel_cell(leg, k):
    """Cell k (0-based) of a main tunnel and its branches in digging order: (x, z, branch), as tunnelCell in mcMine.ts."""
    dx, dz = leg["dir"]
    sx, sz = leg["x"], leg["z"]
    seg, r = k // PER, k % PER
    main = lambda i: (sx + dx * i, sz + dz * i)
    base = main(MAIN_STEP * (seg + 1))
    if r < MAIN_STEP:
        x, z = main(MAIN_STEP * seg + r + 1)
        return x, z, 3 * seg
    left = r < MAIN_STEP + BRANCH
    j = r - MAIN_STEP + 1 if left else r - MAIN_STEP - BRANCH + 1
    bx, bz = (dz, -dx) if left else (-dz, dx)
    return base[0] + bx * j, base[1] + bz * j, 3 * seg + (1 if left else 2)


def per_part(leg):
    """Whether a tunnel keeps its progress per part (S.2's `br`)."""
    return leg.get("br") is not None


def from_order(dug):
    """A tunnel's main cells and cells per branch from its in-order count, as fromOrder in village.ts."""
    s, r = dug // PER, dug % PER
    br = {}
    for q in range(s):
        br[3 * q + 1] = br[3 * q + 2] = BRANCH
    if r > MAIN_STEP:
        br[3 * s + 1] = min(BRANCH, r - MAIN_STEP)
    if r > MAIN_STEP + BRANCH:
        br[3 * s + 2] = r - MAIN_STEP - BRANCH
    return MAIN_STEP * s + min(r, MAIN_STEP), br


def progress(leg):
    """A tunnel's main cells done and cells done per branch id (the record's JSON keys are strings: ints here)."""
    if per_part(leg):
        return leg.get("main") or 0, {int(k): q for k, q in leg["br"].items()}
    return from_order(leg["dug"])


def cell_at(leg, u, n):
    """Cell n of a unit ("main" or a branch id; 0 is where it starts: the tunnel's start or the branch's junction), as
    cellAt in mcMine.ts: (x, z). Branch 3s + 1 is the left and 3s + 2 the right one at main cell 3(s + 1)."""
    dx, dz = leg["dir"]
    if u == "main":
        return leg["x"] + dx * n, leg["z"] + dz * n
    k = MAIN_STEP * (u // 3 + 1)
    bx, bz = (dz, -dx) if u % 3 == 1 else (-dz, dx)
    return leg["x"] + dx * k + bx * n, leg["z"] + dz * k + bz * n


def cut_branches(leg):
    """Branches cut short before S.2: their record says dug in full, since the in-order count ran on over the cells skipped
    past the cut (upgradeMine's fromOrder); S.2's own cuts stop the count at the cut."""
    main, br = progress(leg)
    return {b for b in leg.get("ended", []) if br.get(b, 0) >= BRANCH and b // 3 < main // MAIN_STEP}


def leg_cells(leg, skip=()):
    """The cells a tunnel has dug or passed, as legCells in mcMine.ts: {(x, z): what it is}; not those of the branches in
    `skip`."""
    main, br = progress(leg)
    out = {cell_at(leg, "main", i): f"main {i}" for i in range(1, main + 1)}
    for s in range(main // MAIN_STEP):
        for b in (3 * s + 1, 3 * s + 2):
            if b in skip:
                continue
            for j in range(1, min(BRANCH, br.get(b, 0)) + 1):
                out.setdefault(cell_at(leg, b, j), f"branch {b} cell {j}")
    return out


def leg_area(leg):
    """One main tunnel's box from mineAreas (mcMine.ts): x1, z1, x2, z2; kept per part, to the end of the stretch its main
    tunnel is in."""
    dx, dz = leg["dir"]
    stretches = progress(leg)[0] // MAIN_STEP if per_part(leg) else leg["dug"] // PER
    ln = MAIN_STEP * (stretches + 1) + 1
    ends = [(leg["x"] - dx + dz * (BRANCH + 1), leg["z"] - dz - dx * (BRANCH + 1)),
            (leg["x"] + dx * ln - dz * (BRANCH + 1), leg["z"] + dz * ln + dx * (BRANCH + 1))]
    return min(e[0] for e in ends), min(e[1] for e in ends), max(e[0] for e in ends), max(e[1] for e in ends)


def regions(legs):
    """Boxes to snapshot: per tunnel level, the legs' boxes grown by GROW, from the floor (y-1) to three blocks over the
    ceiling (y+5: shafts dug into the tunnels, a table or scaffolding put down in them)."""
    by_y = {}
    for leg in legs:
        x1, z1, x2, z2 = leg_area(leg)
        b = by_y.get(leg["y"])
        g = (x1 - GROW, z1 - GROW, x2 + GROW, z2 + GROW)
        by_y[leg["y"]] = g if b is None else (min(b[0], g[0]), min(b[1], g[1]), max(b[2], g[2]), max(b[3], g[3]))
    # The deepest level from 11 below: the stairs down to a next level (up to 10 steps) are dug there
    low = min(by_y) if by_y else None
    return [(x1, y - (11 if y == low else 1), z1, x2, y + 5, z2) for y, (x1, z1, x2, z2) in sorted(by_y.items())]


def merge(a, b):
    """Two region lists as one, boxes at the same levels joined."""
    out = {}
    for x1, y1, z1, x2, y2, z2 in a + b:
        o = out.get((y1, y2))
        out[(y1, y2)] = (x1, z1, x2, z2) if o is None else (min(o[0], x1), min(o[1], z1), max(o[2], x2), max(o[3], z2))
    return [(x1, y1, z1, x2, y2, z2) for (y1, y2), (x1, z1, x2, z2) in sorted(out.items())]


def snapshot(boxes):
    """{(x, y, z): name} for every loaded cell of the boxes, in requests of at most MAX_CELLS cells."""
    cells, requests = {}, 0
    for x1, y1, z1, x2, y2, z2 in boxes:
        h = y2 - y1 + 1
        zstep = max(1, min(z2 - z1 + 1, MAX_CELLS // h))
        xstep = max(1, MAX_CELLS // (zstep * h))
        for bz in range(z1, z2 + 1, zstep):
            for bx in range(x1, x2 + 1, xstep):
                ex, ez = min(x2, bx + xstep - 1), min(z2, bz + zstep - 1)
                r = call(f"/blocks?x1={bx}&y1={y1}&z1={bz}&x2={ex}&y2={y2}&z2={ez}")
                requests += 1
                if "cells" not in r:
                    print(f"  WARN /blocks {bx},{y1},{bz}..{ex},{y2},{ez}: {r}")
                    continue
                w, d, names = r["x2"] - r["x1"] + 1, r["z2"] - r["z1"] + 1, r["names"]
                for i, c in enumerate(r["cells"]):
                    if c < 0:
                        continue
                    x, rest = i % w, i // w
                    z, y = rest % d, rest // d
                    cells[(r["x1"] + x, r["y1"] + y, r["z1"] + z)] = names[c]
    return cells, requests


def block(x, y, z, snap):
    if (x, y, z) in snap:
        return snap[(x, y, z)]
    r = call(f"/block?x={x}&y={y}&z={z}")
    return None if r.get("loaded") is False else r.get("block")


def mine_of():
    v = call(f"/village/{VILLAGE}")
    return v, (v.get("mine") if isinstance(v, dict) else None)


def describe(m):
    for i, l in enumerate(m.get("legs") or []):
        part = ""
        if per_part(l):
            main, br = progress(l)
            part = f" main {main} branches {dict(sorted(br.items()))}"
        print(f"    leg {i}: from {l['x']},{l['y']},{l['z']} dir {l['dir']} dug {l['dug']}{part} ended {l.get('ended', [])}"
              f" turned {l.get('turned', 0)} end: {l.get('end') or '-'}")
    print(f"    mine: dug {m.get('dug')}, stopped: {m.get('stopped') or '-'}, got {m.get('got')}")


def events_since(name, last):
    ev = call(f"/agents/{name}/events?since={last}")
    return ev if isinstance(ev, list) else []


def act_all(action, **args):
    """The same action for every bot at once; each bot's result: (kind, text), or a timeout. Results of other actions (a
    chore the world gave an idle member) are kept apart and the wait goes on."""
    last = {}
    for n in NAMES:
        ev = call(f"/agents/{n}/events")
        last[n] = max([e["id"] for e in ev] or [0]) if isinstance(ev, list) else 0
    for n in NAMES:
        call(f"/agents/{n}/act", {"action": action, **args})
    results, others, t = {}, [], time.time()
    while len(results) < len(NAMES) and time.time() - t < ROUND_TIMEOUT:
        time.sleep(2)
        for n in NAMES:
            if n in results:
                continue
            for e in events_since(n, last[n]):
                last[n] = max(last[n], e["id"])
                if e["type"] not in ("action_done", "action_failed"):
                    continue
                if not e["text"].startswith(f"{action} "):
                    others.append(f"{n}: {e['text'][:200]}")
                    continue
                results.setdefault(n, (e["type"], e["text"]))
    for n in NAMES:
        results.setdefault(n, ("timeout", f"(no result in {ROUND_TIMEOUT // 60} min)"))
    return results, others


# Check (e): the agent server's [mine] lines (mcMine.ts)
DUG = re.compile(r"\[mine\] (\S+) dug (-?\d+),(-?\d+),(-?\d+) \((\d+):(main|\d+) ")
TAKES = re.compile(r"\[mine\] (\S+) takes (?:tunnel (\d+)|branch (\d+):(\d+))")
LETS_GO = re.compile(r"\[mine\] (\S+) (?:finished branch (\d+):(\d+)|left tunnel (\d+)|left branch (\d+):(\d+)|ended branch (\d+):(\d+))")
TUNNEL_ENDS = re.compile(r"\[mine\] (\S+): tunnel (\d+) ends")


class MineLog:
    """The [mine] lines appended to the agent server's log since the check began, round by round: the cells logged dug
    (by whom) and who holds each unit ("tunnel:main" or "tunnel:branch")."""

    def __init__(self, path):
        self.path, self.pos, self.dug, self.holder = path, os.path.getsize(path), {}, {}

    def check(self, r, planned, out):
        with open(self.path, "rb") as f:
            f.seek(self.pos)
            text = f.read().decode("utf-8", errors="replace")
            self.pos = f.tell()
        twice, two, outside, holders, lines = [], [], [], [], 0
        for line in text.splitlines():
            m = DUG.search(line)
            if m:
                lines += 1
                who, cell = m.group(1), (int(m.group(2)), int(m.group(3)), int(m.group(4)))
                unit = f"{m.group(5)}:{m.group(6)}"
                if cell in self.dug:
                    (two if self.dug[cell][0] != who else twice).append(f"{cell} by {self.dug[cell][0]} ({self.dug[cell][1]}) and {who} ({unit})")
                else:
                    self.dug[cell] = (who, unit)
                if cell not in planned:
                    outside.append(f"{cell} by {who} ({unit})")
                continue
            m = TAKES.search(line)
            if m:
                who = m.group(1)
                unit = f"{m.group(2)}:main" if m.group(2) else f"{m.group(3)}:{m.group(4)}"
                if self.holder.get(unit) not in (None, who):
                    holders.append(f"{who} took {unit} while {self.holder[unit]} held it")
                self.holder[unit] = who
                continue
            m = LETS_GO.search(line) or TUNNEL_ENDS.search(line)
            if m:
                g = [x for x in m.groups() if x is not None]
                who, unit = g[0], (f"{g[1]}:main" if len(g) == 2 else f"{g[1]}:{g[2]}")
                if self.holder.get(unit) == who:
                    del self.holder[unit]
        if lines == 0:
            out("WARN", f"(e) no [mine] dug lines in {self.path} this round (the agent server's log, written since the check began?)")
        for label, bad in (("dug twice", twice), ("dug by two bots", two), ("logged dug outside the plan", outside), ("one holder a unit", holders)):
            if bad:
                out("FAIL", f"(e) {label}: {len(bad)}: " + "; ".join(bad[:10]) + (" ..." if len(bad) > 10 else ""))
        if lines and not (twice or two or outside or holders):
            out("PASS", f"(e) {lines} cells logged dug this round, each once, by one bot and in the plan; one holder a unit")


def round_check(r, before_mine, after_mine, snap0, snap1, results, log):
    """PASS/FAIL/WARN lines of one round; returns the number of FAILs."""
    fails = 0

    def out(level, msg):
        nonlocal fails
        fails += level == "FAIL"
        print(f"  {level} round {r}: {msg}")

    # a. each bot's stone came from the village mine (a minute's wait for a face that ended "the mine is busy" is a WARN)
    for n, (kind, text) in results.items():
        if kind == "action_done" and "in the village mine" in text:
            out("PASS", f"{n} collected in the village mine")
        elif "the mine is busy" in text:
            out("WARN", f"{n} found the mine busy ({kind}): {text[:240]}")
        else:
            out("FAIL", f"{n}: not collected in the village mine ({kind}): {text[:300]}")

    legs0, legs1 = before_mine.get("legs") or [], after_mine.get("legs") or []
    # Planned cells: every leg's cells done so far; S.2's tunnels by their record (a branch cut short counts as far as it
    # got), older ones by their digging order; a branch cut short before S.2 (in an older or a migrated record) is neither:
    # its dug part is the open run from the tunnel, found below. This round's cells: those not done before the round
    planned, this_round, ended = set(), [], {}
    for i, leg in enumerate(legs1):
        if per_part(leg):
            cut = cut_branches(leg)
            before = leg_cells(legs0[i], cut) if i < len(legs0) else {}
            for (x, z), what in leg_cells(leg, cut).items():
                for y in (leg["y"], leg["y"] + 1):
                    planned.add((x, y, z))
                    if (x, z) not in before:
                        this_round.append((x, y, z, f"leg {i} {what}"))
            for b in cut:
                ended[(i, b)] = [(*cell_at(leg, b, j), leg["y"]) for j in range(1, BRANCH + 1)]
            continue
        d0 = legs0[i]["dug"] if i < len(legs0) else 0
        for k in range(leg["dug"]):
            x, z, br = tunnel_cell(leg, k)
            if br in leg.get("ended", []):
                ended.setdefault((i, br), []).append((x, z, leg["y"]))
                continue
            for y in (leg["y"], leg["y"] + 1):
                planned.add((x, y, z))
                if k >= d0:
                    this_round.append((x, y, z, f"leg {i} cell {k}"))
    # A branch cut short: its cells from the tunnel outward while both are open were dug before it ended
    for cells in ended.values():
        for x, z, y in cells:
            if not all(is_air(block(x, yy, z, snap1) or "") for yy in (y, y + 1)):
                break
            planned.update({(x, y, z), (x, y + 1, z)})
    # The stairs down to deeper levels: step k of one that starts at x, z (its level y) opens y-k .. y-k+2
    dx, dz = after_mine["dir"]
    for d in after_mine.get("down") or []:
        for k in range(1, d["steps"] + 1):
            for y in range(d["y"] - k, d["y"] - k + 3):
                planned.add((d["x"] + dx * k, y, d["z"] + dz * k))
    # A stair step not finished (stopped short, or the trip ended in it): its cells dug so far
    for d in after_mine.get("down") or []:
        if d.get("level") is None:
            k = d["steps"] + 1
            for y in range(d["y"] - k, d["y"] - k + 3):
                planned.add((d["x"] + dx * k, y, d["z"] + dz * k))
    # (a cell two tunnels share is checked once)
    this_round = list({(x, y, z): (x, y, z, what) for x, y, z, what in this_round}.values())

    # b. this round's cells are open
    closed, unloaded = [], 0
    for x, y, z, what in this_round:
        n = block(x, y, z, snap1)
        if n is None:
            unloaded += 1
        elif not is_air(n):
            closed.append(f"{x},{y},{z} ({what}) is {n}")
    if closed:
        out("FAIL", f"{len(closed)} of {len(this_round)} cells dug this round are not open: " + "; ".join(closed[:12]))
    else:
        out("PASS", f"all {len(this_round) - unloaded} cells dug this round are open ({len(this_round) // 2} tunnel cells)")
    if unloaded:
        out("WARN", f"{unloaded} cells dug this round could not be read (not loaded)")
    outside = sum(1 for x, y, z, _ in this_round if (x, y, z) not in snap0)
    if outside:
        out("WARN", f"{outside} cells dug this round lie outside the pre-round snapshot (their surroundings were not compared)")

    # c. nothing else changed
    dug, bad, warn = 0, [], []
    for p, b0 in snap0.items():
        b1 = snap1.get(p)
        if b1 is None or b1 == b0:
            continue
        where = f"{p[0]},{p[1]},{p[2]}: {b0} -> {b1}"
        if p in planned:
            if is_air(b1):
                dug += 1
            elif soft(b0) or soft(b1):
                warn.append(f"{where} (a mine cell)")
            else:
                bad.append(f"{where} (a mine cell filled{'; a crafting table for a pickaxe?' if b1 == 'crafting_table' else ''})")
        elif soft(b0) or soft(b1):
            warn.append(where)
        elif not is_air(b0) and not is_air(b1):
            warn.append(f"{where} (one block turned into another)")
        else:
            bad.append(where + ("; a crafting table for a pickaxe?" if b1 == "crafting_table" else "")
                       + ("; scaffolding?" if b1 in ("dirt", "cobblestone") and is_air(b0) else ""))
    if len(snap0) < 1000:
        out("FAIL", f"only {len(snap0)} cells compared: the mine's chunks were not loaded")
    elif bad:
        out("FAIL", f"{len(bad)} blocks outside the planned cells changed: " + "; ".join(bad[:20]) + (" ..." if len(bad) > 20 else ""))
    else:
        out("PASS", f"nothing outside the planned cells changed ({dug} planned blocks dug, {len(snap0)} cells compared)")
    for w in warn[:20]:
        out("WARN", w)
    if len(warn) > 20:
        out("WARN", f"... {len(warn) - 20} more")

    # e. the agent server's log: each cell dug once, by one bot, in the plan; one holder a unit
    if log:
        log.check(r, planned, out)

    # d. the mine after the round
    describe(after_mine)
    print(f"    new legs this round: {len(legs1) - len(legs0)}; tunnel cells this round: "
          f"{after_mine.get('dug', 0) - before_mine.get('dug', 0)} (m.dug {before_mine.get('dug')} -> {after_mine.get('dug')})")
    return fails


v, mine = mine_of()
if not mine or mine.get("level") is None or not mine.get("legs"):
    print(json.dumps(mine if mine else v, indent=2)[:4000])
    raise SystemExit(f"{VILLAGE} has no mine dug to stone (needs `level` and `legs`): see the record above")
if mine.get("stopped"):
    describe(mine)
    raise SystemExit(f"{VILLAGE}'s mine has stopped ({mine['stopped']}): collect would gather outside it")
print(f"{VILLAGE}'s mine: hut {mine['hut']}, stairs from {mine['top']} dir {mine['dir']}, {mine['steps']} steps to y={mine['level']}")
describe(mine)
log = MineLog(MINE_LOG) if MINE_LOG else None
if MINE_LOG:
    print(f"check (e) reads {MINE_LOG} from byte {log.pos}")

# Inside the hut, on its floor: the cell behind the first step (the hut's middle; its doorway is beyond it)
hut = next((s for s in v.get("structures", []) if s.get("kind") == "mining_hut" and s["x1"] == mine["hut"]["x1"] and s["z1"] == mine["hut"]["z1"]), None)
y0 = hut["y"] if hut else mine["level"] + mine["steps"] - 1
sx, sz = mine["top"]["x"] - mine["dir"][0], mine["top"]["z"] - mine["dir"][1]

fails, t_all = 0, time.time()
try:
    for n in NAMES:
        call(f"/agents/{n}", method="DELETE")
    others = [a["name"] for a in (call("/agents") or []) if isinstance(a, dict) and a.get("name") not in NAMES]
    if others:
        print(f"WARN other agents are in the world ({', '.join(others)}): blocks they change near the mine show up as changes")
    for n in NAMES:
        r = call("/agents", {"name": n, "role": "worker", "brain": "idle", "gamemode": "survival", "reset": True,
                             "position": {"x": sx + 0.5, "y": y0 + 1, "z": sz + 0.5}, "memory": {"village": VILLAGE}})
        if "name" not in r:
            raise SystemExit(f"could not spawn {n}: {r}")
    print(f"{', '.join(NAMES)} spawned in the mining hut at {sx},{y0 + 1},{sz}")
    time.sleep(5)
    if GIVE:
        for n in NAMES:
            print(f"  give {n}: {rcon(f'give {n} minecraft:stone_pickaxe 2') or 'no answer'}")
        time.sleep(2)
    elif PICKAXE_WAIT > 0:
        print(f"WAITING up to {PICKAXE_WAIT} s for pickaxes: " + "; ".join(f'python mc/rcon.py "give {n} minecraft:stone_pickaxe 2"' for n in NAMES), flush=True)
        t = time.time()
        while time.time() - t < PICKAXE_WAIT:
            if all(any(k.endswith("_pickaxe") for k in call(f"/agents/{n}/observe?radius=4").get("inventory", {})) for n in NAMES):
                break
            time.sleep(2)
        else:
            print("not every bot was given a pickaxe: the skill makes one (logs gathered outside the mine, maybe a crafting table placed)")
    for n in NAMES:
        print(f"  {n} carries {call(f'/agents/{n}/observe?radius=4').get('inventory', {})}")
    for r in range(1, ROUNDS + 1):
        before_village, before_mine = mine_of()
        if not before_mine or before_mine.get("stopped"):
            print(f"round {r}: the mine has stopped ({(before_mine or {}).get('stopped')}); no more rounds")
            break
        boxes0 = regions(before_mine.get("legs") or [])
        t = time.time()
        snap0, n0 = snapshot(boxes0)
        print(f"round {r}: snapshot of {len(snap0)} loaded cells in {n0} requests ({time.time() - t:.1f} s), boxes {boxes0}", flush=True)
        t = time.time()
        results, chores = act_all("collect", block="cobblestone", count=COUNT)
        for n, (kind, text) in results.items():
            print(f"round {r}: {n} {kind} after {time.time() - t:.0f} s: {text[:400]}", flush=True)
        for c in chores:
            print(f"  WARN round {r}: another action ran (a chore given to an idle member?): {c}")
        _, after_mine = mine_of()
        after_mine = after_mine or {}
        # The same boxes before and after (a new leg's boxes are added after: its cells are checked by /api/block)
        snap1, _ = snapshot(merge(boxes0, regions(after_mine.get("legs") or [])))
        fails += round_check(r, before_mine, after_mine, snap0, snap1, results, log)
        for n in NAMES:
            print(f"    {n} carries {call(f'/agents/{n}/observe?radius=4').get('inventory', {})}", flush=True)
        if any(kind == "timeout" for kind, _ in results.values()):
            break
except KeyboardInterrupt:
    print("interrupted")
    fails += 1
finally:
    for n in NAMES:
        call(f"/agents/{n}", method="DELETE")
    print(f"{', '.join(NAMES)} removed; {time.time() - t_all:.0f} s in all; {'FAIL' if fails else 'PASS'} ({fails} failures)")
sys.exit(1 if fails else 0)
