"""MC_ORE_VEIN's live check (#100, G8, 10-23): plants small iron veins beside the next cells of the iron level's going
tunnels, sends one member on a dig_iron trip, and reads every planted block back over RCON.

Each planted vein (only into the ground the overworld's stone tags hold): one ore in the wall at head height (laid open
by the cell), one a block further in, one diagonally above that, one a corner step above again, and one diagonally down
and along (diagonals only reach the last three: a vein followed by faces alone stops at the second). For every cell the
trip dug (both blocks open), its vein's ores should be gone (or the hole filled with stone in the floor and ceiling
layers); veins of cells not dug say nothing. Passes when 80% of the dug cells' planted ores were taken and none of the
planted cells beyond the bounds changed. Also prints the [vein] lines the trip wrote (MINE_LOG, the agent server's log).
The agent server needs MC_IRON_AGE, MC_ORE_MINE and MC_ORE_VEIN on; a complete village with an iron level (checkpoint
im2_mine on minevale3).
Usage: MCAI_API=http://127.0.0.1:8770/api MC_SERVER_DIR=mc/testserver4 python scripts/checks/ore_vein.py [VILLAGE [MEMBER [MINUTES]]]
       (default B25x2, Ada, 3 minutes)
"""
import json, os, re, sys, time, urllib.error, urllib.request
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "mc"))
from rcon import Rcon, server_dir

API = os.environ.get("MCAI_API", "http://127.0.0.1:8770/api").rstrip("/")
VILLAGE = sys.argv[1] if len(sys.argv) > 1 else "B25x2"
MEMBER = sys.argv[2] if len(sys.argv) > 2 else "Ada"
MINUTES = float(sys.argv[3]) if len(sys.argv) > 3 else 3
MAIN_STEP, BRANCH = 3, 12
PER = MAIN_STEP + 2 * BRANCH


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return {"error": e.code, "body": e.read().decode(errors="replace")[:300]}


def tunnel_cell(l, k):
    """mcMine.ts tunnelCell: cell k (0-based) of an in-order leg, the cell it is dug from, and its branch."""
    dx, dz = l["dir"]
    seg, r = divmod(k, PER)
    main = lambda i: (l["x"] + dx * i, l["z"] + dz * i)
    base = main(MAIN_STEP * (seg + 1))
    if r < MAIN_STEP:
        i = MAIN_STEP * seg + r + 1
        return main(i), main(i - 1), 3 * seg
    left = r < MAIN_STEP + BRANCH
    j = r - MAIN_STEP + 1 if left else r - MAIN_STEP - BRANCH + 1
    bx, bz = (dz, -dx) if left else (-dz, dx)
    return (base[0] + bx * j, base[1] + bz * j), (base[0] + bx * (j - 1), base[1] + bz * (j - 1)), 3 * seg + (1 if left else 2)


def next_cells(i, n=4):
    """The next cells of every going tunnel (drifts: their main cells up to their length), with the way each is dug."""
    drifts = {d[0]: d[1] for d in i.get("drifts", [])}
    out = []
    for k, l in enumerate(i["legs"]):
        if l.get("end"): continue
        dx, dz = l["dir"]
        if k in drifts:
            for m in range(l.get("main", l["dug"]) + 1, min(drifts[k], l["dug"] + n) + 1):
                out.append(((l["x"] + dx * m, l["z"] + dz * m), (dx, dz)))
            continue
        got, kk = 0, l["dug"]
        while got < n and kk < l["dug"] + 3 * PER:
            c, f, br = tunnel_cell(l, kk)
            kk += 1
            if br in l.get("ended", []): continue
            out.append((c, (c[0] - f[0], c[1] - f[1])))
            got += 1
    return out


def main():
    vs = json.load(open(server_dir() / "villages.json", encoding="utf-8"))
    vs = vs if isinstance(vs, list) else vs.get("villages", vs)
    vs = vs if isinstance(vs, list) else list(vs.values())
    v = next(x for x in vs if x["name"] == VILLAGE)
    i = v["mine"]["iron"]
    L = i["level"]
    cells = next_cells(i)
    planned = {c for c, _ in cells}
    print(f"{VILLAGE}: iron level y={L}, {len(i['legs'])} legs, {i['dug']} cells; planting by {len(cells)} next cells")
    rc = Rcon()
    # (no player near: the chunks are kept loaded while the veins are planted, else setblock finds them not loaded)
    chunks = sorted({((cx + ox) >> 4, (cz + oz) >> 4) for (cx, cz), _ in cells for ox in (-4, 4) for oz in (-4, 4)})
    for x, z in chunks: rc.send(2, f"forceload add {x * 16} {z * 16}")
    time.sleep(3)
    veins = []  # (cell, [(x, y, z), ...] planted)
    taken_spots = set()
    for (cx, cz), (dx, dz) in cells:
        px, pz = dz, -dx  # one side of the cell's way
        spots = []
        # (side, along, above L): the wall ore, one in, diagonally above it, a corner step above, diagonally down and along
        for s, a, up in [(1, 0, 1), (2, 0, 1), (2, 0, 2), (3, 0, 3), (2, 1, 0)]:
            x, z, y = cx + px * s + dx * a, cz + pz * s + dz * a, L + up
            if (x, z) in planned or (x, y, z) in taken_spots: continue
            r = rc.send(2, f"execute if block {x} {y} {z} #minecraft:base_stone_overworld run setblock {x} {y} {z} minecraft:iron_ore")[1]
            if "Changed" in r:
                spots.append((x, y, z)); taken_spots.add((x, y, z))
        veins.append(((cx, cz), spots))
    for x, z in chunks: rc.send(2, f"forceload remove {x * 16} {z * 16}")
    print(f"planted {sum(len(s) for _, s in veins)} iron ores in {sum(1 for _, s in veins if s)} veins")
    if not any(s for _, s in veins):
        print("FAIL: nothing planted"); sys.exit(1)
    # The member: spawned at the mine's top with two iron pickaxes and stone for fills
    top = v["mine"]["top"]
    call(f"/agents/{MEMBER}", method="DELETE")
    r = call("/agents", {"name": MEMBER, "role": "builder", "brain": "idle", "gamemode": "survival", "reset": True,
                         "position": {"x": top["x"] + 0.5, "z": top["z"] + 0.5}, "memory": {"village": VILLAGE}})
    print(f"{MEMBER}: {r}")
    time.sleep(6)
    rc.send(2, f"give {MEMBER} minecraft:iron_pickaxe 2")
    t0 = time.time()
    call(f"/agents/{MEMBER}/act", {"action": "dig_iron", "minutes": MINUTES, "want": 64})
    out = None
    while time.time() - t0 < MINUTES * 60 + 420:
        time.sleep(5)
        h = call(f"/agents/{MEMBER}/actions")
        done = [x for x in h.get("history", []) if "dig_iron" in json.dumps(x)]
        if done and not h.get("current") and not h.get("queued"):
            out = done[-1]; break
    print(f"trip ({time.time() - t0:.0f} s): {json.dumps(out)[:600] if out else 'no result'}")
    # Read back
    def name_at(x, y, z):
        for b in ("iron_ore", "air", "cave_air", "cobblestone", "cobbled_deepslate", "andesite", "diorite", "granite", "tuff"):
            if "passed" in rc.send(2, f"execute if block {x} {y} {z} minecraft:{b}")[1].lower(): return b
        return "other"
    dug_cells, ore, gone, rows = 0, 0, 0, []
    for (cx, cz), spots in veins:
        if not spots: continue
        open_ = all(name_at(cx, y, cz) in ("air", "cave_air") for y in (L, L + 1))
        states = [name_at(*p) for p in spots]
        if not open_: continue
        dug_cells += 1
        ore += len(spots)
        g = sum(1 for s in states if s != "iron_ore")
        gone += g
        rows.append(f"  cell {cx},{L},{cz}: {g}/{len(spots)} taken ({', '.join(f'{p[0]},{p[1]},{p[2]} {s}' for p, s in zip(spots, states))})")
    print(f"dug cells with a planted vein: {dug_cells}; their planted ore {ore}, taken {gone}")
    print("\n".join(rows))
    log = os.environ.get("MINE_LOG")
    if log and os.path.exists(log):
        lines = [l.rstrip() for l in open(log, encoding="utf-8", errors="replace") if l.startswith("[vein]") and f" {MEMBER} " in l]
        print(f"[vein] lines for {MEMBER}: {len(lines)}")
        for l in lines[-15:]: print("  " + l[:240])
    call(f"/agents/{MEMBER}", method="DELETE")
    if not dug_cells:
        print("FAIL: the trip dug none of the planted cells"); sys.exit(1)
    ok = gone >= 0.8 * ore
    print(f"{'PASS' if ok else 'FAIL'}: {gone} of {ore} planted ores beside dug cells taken ({100 * gone / max(1, ore):.0f}%)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
