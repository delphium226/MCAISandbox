"""The village mine (plan steps V.5, V.5b): Gus, a survival member of the village, runs `collect cobblestone` ROUNDS
times; around each round the check snapshots the mine's level with /api/blocks (every main tunnel's reach grown by 30
blocks sideways, from the floor to the ceiling) and replays the tunnels' digging order (tunnelCell, ported from
mcMine.ts) to verify that the result came from the village mine, that every cell dug this round is open (two high), and
that nothing else at the mine's level changed (WARN for leaves, plants and water or lava flowing, and for a block turned
into another block).
Usage: python scripts/checks/mine.py VILLAGE [ROUNDS [COUNT]] (default 3 rounds of 24 cobblestone). The village needs a
mine dug to stone (`level` and `legs` in its record). Needs the agent server; Gus spawns inside the mining hut and is
removed at the end. Gus starts with nothing (reset): the script waits PICKAXE_WAIT seconds (default 120, env) for a
pickaxe given with RCON (it prints the command); with none the skill makes its own (logs from outside, a crafting table).
Exits non-zero on any FAIL.
"""
import json, os, sys, time, urllib.error, urllib.request

sys.stdout.reconfigure(encoding="utf-8")

API = "http://127.0.0.1:8766/api"
if len(sys.argv) < 2:
    raise SystemExit("usage: python scripts/checks/mine.py VILLAGE [ROUNDS [COUNT]]")
VILLAGE = sys.argv[1]
ROUNDS = int(sys.argv[2]) if len(sys.argv) > 2 else 3
COUNT = int(sys.argv[3]) if len(sys.argv) > 3 else 24
PICKAXE_WAIT = int(os.environ.get("PICKAXE_WAIT", "120"))
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


def leg_area(leg):
    """One main tunnel's box from mineAreas (mcMine.ts): x1, z1, x2, z2."""
    dx, dz = leg["dir"]
    ln = MAIN_STEP * (leg["dug"] // PER + 1) + 1
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
        print(f"    leg {i}: from {l['x']},{l['y']},{l['z']} dir {l['dir']} dug {l['dug']} ended {l.get('ended', [])}"
              f" turned {l.get('turned', 0)} end: {l.get('end') or '-'}")
    print(f"    mine: dug {m.get('dug')}, stopped: {m.get('stopped') or '-'}, got {m.get('got')}")


def events_since(last):
    ev = call(f"/agents/Gus/events?since={last}")
    return ev if isinstance(ev, list) else []


def act(action, **args):
    ev = call("/agents/Gus/events")
    last = max([e["id"] for e in ev] or [0]) if isinstance(ev, list) else 0
    call("/agents/Gus/act", {"action": action, **args})
    t = time.time()
    while time.time() - t < ROUND_TIMEOUT:
        time.sleep(2)
        evs = events_since(last)
        for e in evs:
            last = max(last, e["id"])
            if e["type"] in ("action_done", "action_failed"):
                return e["type"], e["text"]
    return "timeout", f"(no result in {ROUND_TIMEOUT // 60} min)"


def round_check(r, before_mine, after_mine, snap0, snap1, text, kind):
    """PASS/FAIL/WARN lines of one round; returns the number of FAILs."""
    fails = 0

    def out(level, msg):
        nonlocal fails
        fails += level == "FAIL"
        print(f"  {level} round {r}: {msg}")

    # a. the stone came from the village mine
    if kind == "action_done" and "in the village mine" in text:
        out("PASS", "collected in the village mine")
    else:
        out("FAIL", f"not collected in the village mine ({kind}): {text[:300]}")

    legs0, legs1 = before_mine.get("legs") or [], after_mine.get("legs") or []
    # Planned cells: every leg's cells dug so far, except branches cut short (their dug part is the open run from the
    # tunnel, found below); this round's cells are those from each leg's dug count before the round
    planned, this_round, ended = set(), [], {}
    for i, leg in enumerate(legs1):
        d0 = legs0[i]["dug"] if i < len(legs0) else 0
        for k in range(leg["dug"]):
            x, z, br = tunnel_cell(leg, k)
            if br in leg.get("ended", []):
                ended.setdefault((i, br), []).append((x, z, leg["y"]))
                continue
            for y in (leg["y"], leg["y"] + 1):
                planned.add((x, y, z))
                if k >= d0:
                    this_round.append((x, y, z, i, k))
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

    # b. this round's cells are open
    closed, unloaded = [], 0
    for x, y, z, i, k in this_round:
        n = block(x, y, z, snap1)
        if n is None:
            unloaded += 1
        elif not is_air(n):
            closed.append(f"{x},{y},{z} (leg {i} cell {k}) is {n}")
    if closed:
        out("FAIL", f"{len(closed)} of {len(this_round)} cells dug this round are not open: " + "; ".join(closed[:12]))
    else:
        out("PASS", f"all {len(this_round) - unloaded} cells dug this round are open ({len(this_round) // 2} tunnel cells)")
    if unloaded:
        out("WARN", f"{unloaded} cells dug this round could not be read (not loaded)")
    outside = sum(1 for x, y, z, _, _ in this_round if (x, y, z) not in snap0)
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

others = [a["name"] for a in (call("/agents") or []) if isinstance(a, dict) and a.get("name") != "Gus"]
if others:
    print(f"WARN other agents are in the world ({', '.join(others)}): blocks they change near the mine show up as changes")

# Inside the hut, on its floor: the cell behind the first step (the hut's middle; its doorway is beyond it)
hut = next((s for s in v.get("structures", []) if s.get("kind") == "mining_hut" and s["x1"] == mine["hut"]["x1"] and s["z1"] == mine["hut"]["z1"]), None)
y0 = hut["y"] if hut else mine["level"] + mine["steps"] - 1
sx, sz = mine["top"]["x"] - mine["dir"][0], mine["top"]["z"] - mine["dir"][1]

fails, t_all = 0, time.time()
try:
    call("/agents/Gus", method="DELETE")
    r = call("/agents", {"name": "Gus", "role": "worker", "brain": "idle", "gamemode": "survival", "reset": True,
                         "position": {"x": sx + 0.5, "y": y0 + 1, "z": sz + 0.5}, "memory": {"village": VILLAGE}})
    if "name" not in r:
        raise SystemExit(f"could not spawn Gus: {r}")
    print(f"Gus spawned in the mining hut at {sx},{y0 + 1},{sz}")
    time.sleep(5)
    if PICKAXE_WAIT > 0:
        print(f'WAITING up to {PICKAXE_WAIT} s for a pickaxe: python mc/rcon.py "give Gus minecraft:stone_pickaxe 2"', flush=True)
        t = time.time()
        while time.time() - t < PICKAXE_WAIT:
            inv = call("/agents/Gus/observe?radius=4").get("inventory", {})
            if any(k.endswith("_pickaxe") for k in inv):
                print(f"Gus carries {inv}")
                break
            time.sleep(2)
        else:
            print("no pickaxe given: the skill makes one (logs gathered outside the mine, maybe a crafting table placed)")
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
        kind, text = act("collect", block="cobblestone", count=COUNT)
        print(f"round {r}: {kind} after {time.time() - t:.0f} s: {text[:400]}", flush=True)
        _, after_mine = mine_of()
        after_mine = after_mine or {}
        # The same boxes before and after (a new leg's boxes are added after: its cells are checked by /api/block)
        snap1, _ = snapshot(merge(boxes0, regions(after_mine.get("legs") or [])))
        fails += round_check(r, before_mine, after_mine, snap0, snap1, text, kind)
        inv = call("/agents/Gus/observe?radius=4").get("inventory", {})
        print(f"    Gus carries {inv}", flush=True)
        if kind == "timeout":
            break
except KeyboardInterrupt:
    print("interrupted")
    fails += 1
finally:
    call("/agents/Gus", method="DELETE")
    print(f"Gus removed; {time.time() - t_all:.0f} s in all; {'FAIL' if fails else 'PASS'} ({fails} failures)")
sys.exit(1 if fails else 0)
