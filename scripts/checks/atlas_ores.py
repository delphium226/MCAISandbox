"""The underground atlas (plan step V.6): check the atlas's exposed ores against the blocks. For each chunk of a village's
mine (chunks the atlas marks with `mine`, and the mining hut's) or each chunk within RADIUS of X Z, read the whole column
with /api/blocks, count the ores exposed to air the way mcAtlas.ts does (a face inside the chunk touching air or cave
air; deepslate ores with the others) and compare kinds, counts and y ranges with the chunk's atlas entry. For a village,
also compare the mine's "seen" counts with the ores now in its tunnel walls (a soft check: ores later dug are gone from
the walls, ores a cave laid open first are not the mine's), and report the bytes the ores add per chunk.
Usage: python scripts/checks/atlas_ores.py VILLAGE
       python scripts/checks/atlas_ores.py --near X Z [RADIUS]
Reads only (GET). Needs the agent server and a bot near the chunks (they must be loaded): run it right after a mining
run (scripts/checks/mine.py, or a staged village) while the agent is still in the world, or spawn an idle Gus at the mine.
"""
import json, re, sys, time, urllib.parse, urllib.request
from collections import Counter

API = "http://127.0.0.1:8766/api"
ORE = re.compile(r"^(?:deepslate_)?(coal|iron|copper|gold|redstone|lapis|diamond|emerald)_ore$")
AIR = {"air", "cave_air"}
SIDES = [(1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1), (0, 1, 0), (0, -1, 0)]
MIN_Y = -64


def get(path):
    with urllib.request.urlopen(API + path, timeout=120) as r:
        return json.loads(r.read() or b"{}")


def entry(cx, cz):
    """The chunk's atlas entry (None if the atlas has none)."""
    a = get(f"/atlas?x={cx * 16 + 8}&z={cz * 16 + 8}&radius=16")
    return next((s for s in a["chunks"] if s["cx"] == cx and s["cz"] == cz), None)


def column(cx, cz, y_top):
    """{(x, y, z): name} of the chunk from MIN_Y to y_top (local x, z), or None where a chunk is not loaded."""
    blocks = {}
    for y1 in range(MIN_Y, y_top + 1, 256):  # 16 x 16 x 256 = the route's 65536 limit
        y2 = min(y_top, y1 + 255)
        b = get(f"/blocks?x1={cx * 16}&y1={y1}&z1={cz * 16}&x2={cx * 16 + 15}&y2={y2}&z2={cz * 16 + 15}")
        names, cells = b["names"], b["cells"]
        if -1 in cells:
            return None
        i = 0
        for y in range(y1, y2 + 1):
            for z in range(16):
                for x in range(16):
                    blocks[(x, y, z)] = names[cells[i]]
                    i += 1
    return blocks


def exposed_ores(blocks, y_top):
    """{kind: [count, lowest y, highest y]} as mcAtlas.ts counts them, and the exposed ore cells (local)."""
    out, cells = {}, []
    for (x, y, z), n in blocks.items():
        m = ORE.match(n)
        if not m:
            continue
        # Faces inside the chunk only; above the read range counts as air (the atlas reads it: empty sections are air)
        if not any(blocks.get((x + a, y + b, z + c), "air" if y + b > y_top else "out") in AIR
                   for a, b, c in SIDES if 0 <= x + a <= 15 and 0 <= z + c <= 15 and y + b >= MIN_Y):
            continue
        o = out.setdefault(m.group(1), [0, 9999, -9999])
        o[0] += 1
        o[1], o[2] = min(o[1], y), max(o[2], y)
        cells.append((x, y, z, n))
    return out, cells


def check_chunk(cx, cz, tries=3):
    for _ in range(tries):
        s = entry(cx, cz)
        if not s:
            return f"chunk {cx},{cz}: not in the atlas", None
        if "ores" not in s:
            return f"chunk {cx},{cz}: summarised before V.6 (no ores field; it is rescanned when a bot gets it again after 5 min)", None
        hs = [h for h in s["h"] if h is not None] or [64]
        y_top = min(319, max(max(hs) + 64, max([v[2] for v in s["ores"].values()] or [MIN_Y]) + 1))
        t = time.time()
        blocks = column(cx, cz, y_top)
        if blocks is None:
            return f"chunk {cx},{cz}: not loaded any more", None
        mine, cells = exposed_ores(blocks, y_top)
        again = entry(cx, cz)
        if again and again["t"] != s["t"]:
            continue  # summarised again while it was read: read once more
        diffs = [f"{k}: atlas {s['ores'].get(k)} vs blocks {mine.get(k)}" for k in sorted(set(s["ores"]) | set(mine)) if s["ores"].get(k) != mine.get(k)]
        age = time.time() - s["t"] / 1000
        text = ", ".join(f"{v[0]} {k} (y {v[1]}..{v[2]})" for k, v in sorted(mine.items(), key=lambda kv: -kv[1][0])) or "none"
        return (f"chunk {cx},{cz}{' [' + s['mine'] + ' mine]' if s.get('mine') else ''}: " + ("matches" if not diffs else "DIFFERS: " + "; ".join(diffs)) +
                f"; exposed ores: {text}; {len(json.dumps(s['ores'], separators=(',', ':'))) + 8} bytes; summary {age:.0f} s old; read in {time.time() - t:.1f} s"), (s, blocks, cells)
    return f"chunk {cx},{cz}: summarised again on every read (blocks still changing?)", None


def wait_quiet(limit=150):
    """Until the atlas has no chunk waiting or marked changed (a changed chunk is summarised a minute after the change)."""
    t0 = time.time()
    while time.time() - t0 < limit:
        st = get("/atlas?x=0&z=0&radius=16")["status"]
        if not st["queued"] and not st["changed"]:
            return st
        time.sleep(5)
    return get("/atlas?x=0&z=0&radius=16")["status"]


st = wait_quiet()
print("atlas:", st)
if sys.argv[1:2] == ["--near"]:
    X, Z = int(sys.argv[2]), int(sys.argv[3])
    R = int(sys.argv[4]) if len(sys.argv) > 4 else 48
    chunks = sorted({((X + dx) >> 4, (Z + dz) >> 4) for dx in range(-R, R + 1, 16) for dz in range(-R, R + 1, 16)})
    village = None
else:
    village = get(f"/village/{urllib.parse.quote(sys.argv[1])}")
    m = village.get("mine")
    if not m or m.get("level") is None:
        sys.exit(f"{sys.argv[1]} has no mine dug to stone: {m}")
    all_ = get("/atlas?all=1")
    n, size = len(all_["chunks"]), len(json.dumps(all_["chunks"], separators=(",", ":")))
    with_ores = [s for s in all_["chunks"] if s.get("ores")]
    extra = sum(len(json.dumps(s["ores"], separators=(",", ":"))) + 8 for s in all_["chunks"] if "ores" in s)
    print(f"atlas?all=1: {n} chunks, {size} bytes ({size / max(1, n):.0f} a chunk); {len(with_ores)} with exposed ores, "
          f"ores add {extra / max(1, sum(1 for s in all_['chunks'] if 'ores' in s)):.0f} bytes a summarised chunk")
    hut = m["hut"]
    chunks = {(s["cx"], s["cz"]) for s in all_["chunks"] if s.get("mine") == village["name"]}
    chunks |= {(x >> 4, z >> 4) for x in (hut["x1"], hut["x2"]) for z in (hut["z1"], hut["z2"])}
    chunks = sorted(chunks)
    print(f"{village['name']}'s mine: level {m['level']}, {m['dug']} cells dug, {len(m.get('legs') or [])} main tunnels; "
          f"{len(chunks)} chunks (marked as its mine, and the hut's)")

ok = bad = 0
walls = Counter()
for cx, cz in chunks:
    line, data = check_chunk(cx, cz)
    print(line)
    if data is None:
        continue
    ok += "matches" in line
    bad += "DIFFERS" in line
    if village:
        # Ores in the tunnel walls now: next to an air cell at a tunnel's two levels whose column is open at both
        s, blocks, cells = data
        levels = {l["y"] for l in (village["mine"].get("legs") or [])} or {village["mine"]["level"]}
        tunnel = {(x, y, z) for (x, y, z), n in blocks.items() if n in AIR and any(
            y in (L, L + 1) and blocks.get((x, L, z)) in AIR and blocks.get((x, L + 1, z)) in AIR for L in levels)}
        for x, y, z, n in cells:
            if any((x + a, y + b, z + c) in tunnel for a, b, c in SIDES):
                walls[n] += 1
                if walls[n] == 1:  # one of each kind, to mine for the "mined out" step of the test
                    print(f"  in a tunnel wall: {n} at {cx * 16 + x} {y} {cz * 16 + z}")
print(f"\n{ok} chunks match, {bad} differ, {len(chunks) - ok - bad} not checked")
if village:
    seen = {k[5:]: q for k, q in village["mine"]["got"].items() if k.startswith("seen ")}
    print("mine record, ores seen in its walls:", seen or "none")
    print("ores in its tunnel walls now:      ", dict(walls) or "none",
          "(at most the record plus ores a cave laid open first; fewer when some were dug since)")
# Non-zero when anything differs or nothing could be checked (chunks not loaded, or summarised before V.6)
if bad or not ok:
    sys.exit(1)
