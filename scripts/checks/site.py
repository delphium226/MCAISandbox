"""A site check (plan step T.3): Gus runs find_site and the check compares what it reported with the blocks.
Usage: python scripts/checks/site.py X Z SIZE (e.g. -1208 -296 30, Minevale5's probe point, F88).

Gus (idle, survival, reset) spawns on the surface at X,Z (no height: the server's surface spawn, F84) and runs
`find_site size=SIZE`. The check reads the site he reported (memory.lastSite and the action_done text) and the real
blocks over that square plus prepare_site's 2-block margin with /api/blocks, while Gus still stands where find_site
surveyed (the blocks come from the bots' view, so the chunks are the ones find_site saw). Per column it finds the
ground as find_site's surfaceAt does: top down, the first liquid (the column is wet, at the water's surface) or the
first solid block that is not a plant, leaf, log or snow layer; tree blocks are the logs and leaves above it. Under
water it also finds the solid bottom (what prepare_site fills from) for the drop test.

FAIL when: find_site failed; the reported ground y is more than 2 off the real median ground of the site; the real
height range over the site is more than 3 above the reported one; any column of the site is more than 4 below the
level (a ravine or drop; in the margin only a WARN: prepare_site fills it up to 8 down and leaves deeper columns, F83);
any column is not loaded; the site has wet columns (find_site rejects those). WARN when the tree count is far off, and when the real
ground lies above Gus's y + 32 (before F88's fix such columns read as that height, flat and treeless).
Prints a height map of the site and margin. Gus is removed at the end. Exits non-zero on any FAIL.
Env: MCAI_API (default http://127.0.0.1:8766/api).
"""
import json, os, re, sys, time, urllib.error, urllib.request

sys.stdout.reconfigure(encoding="utf-8")

if len(sys.argv) < 4 or any(a in ("-h", "--help") for a in sys.argv[1:]):
    print(__doc__)
    sys.exit(0 if any(a in ("-h", "--help") for a in sys.argv[1:]) else 2)

API = os.environ.get("MCAI_API", "http://127.0.0.1:8766/api").rstrip("/")
X, Z, SIZE = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
# prepare_site's default margin around the plot plan_layout posts (mcBuild.ts prepareSite, `margin`)
MARGIN = 2
MAX_CELLS = 65536
FIND_TIMEOUT = 4 * 60
# The world's height limits (26.1 overworld)
WORLD_MIN, WORLD_MAX = -64, 319
# find_site's scan window above the surveying bot (mcBuild.ts surfaceAt: yHint + 32)
SCAN_UP = 32

# mcBuild.ts NON_GROUND: plants, trees and snow are not ground
NON_GROUND = re.compile(r"leaves|_log$|_wood$|_stem$|grass$|fern|flower|dandelion|poppy|tulip|orchid|allium|bluet|daisy|lilac"
                        r"|peony|rose_bush|sunflower|bush|sapling|^snow$|vine|mushroom|sugar_cane|bamboo|cactus|azalea|dripleaf"
                        r"|moss_carpet|leaf_litter|petals|cobweb")
# Blocks with no full collision box (surfaceAt passes them: boundingBox is not 'block'); /api/blocks gives names only
NON_SOLID = re.compile(r"torch|rail$|sign$|_button$|^lever$|pressure_plate|carpet$|lily_pad|lichen|hanging_roots|^ladder$"
                       r"|tripwire|redstone_wire|sculk_vein|spore_blossom|frogspawn|^light$|^fire$|soul_fire|coral_fan$|coral$"
                       r"|sea_pickle|_banner$|_head$|_skull$|flower_pot|^scaffolding$")
# Liquids, and the plants that only grow in water (surfaceAt counts waterlogged see-through blocks as liquid)
LIQUID = re.compile(r"^(water|lava|bubble_column|seagrass|tall_seagrass|kelp|kelp_plant)$")
AIR = ("air", "cave_air", "void_air")


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def is_tree(n):
    return bool(re.search(r"_log$|_wood$|_stem$", n)) or n.endswith("_leaves")


def is_ground(n):
    return n not in AIR and not LIQUID.match(n) and not NON_GROUND.search(n) and not NON_SOLID.search(n)


def gus():
    for a in call("/agents") or []:
        if isinstance(a, dict) and a.get("name") == "Gus":
            return a
    return None


def act(action, **args):
    ev = call("/agents/Gus/events")
    last = max([e["id"] for e in ev] or [0]) if isinstance(ev, list) else 0
    call("/agents/Gus/act", {"action": action, **args})
    t = time.time()
    while time.time() - t < FIND_TIMEOUT:
        time.sleep(1)
        evs = call(f"/agents/Gus/events?since={last}")
        for e in evs if isinstance(evs, list) else []:
            last = max(last, e["id"])
            if e["type"] in ("action_done", "action_failed"):
                return e["type"], e["text"]
    return "timeout", f"(no result in {FIND_TIMEOUT // 60} min)"


def read_box(x1, y1, z1, x2, y2, z2, cells):
    """Add {(x, y, z): name or None} for the box to cells, in requests of at most MAX_CELLS (None: not loaded)."""
    h = y2 - y1 + 1
    zstep = max(1, min(z2 - z1 + 1, MAX_CELLS // h))
    xstep = max(1, MAX_CELLS // (zstep * h))
    n = 0
    for bz in range(z1, z2 + 1, zstep):
        for bx in range(x1, x2 + 1, xstep):
            ex, ez = min(x2, bx + xstep - 1), min(z2, bz + zstep - 1)
            r = call(f"/blocks?x1={bx}&y1={y1}&z1={bz}&x2={ex}&y2={y2}&z2={ez}")
            n += 1
            if "cells" not in r:
                out("FAIL", f"/blocks {bx},{y1},{bz}..{ex},{y2},{ez}: {r}")
                raise SystemExit(1)
            w, d, names = r["x2"] - r["x1"] + 1, r["z2"] - r["z1"] + 1, r["names"]
            for i, c in enumerate(r["cells"]):
                x, rest = i % w, i // w
                cells[(r["x1"] + x, r["y1"] + rest // d, r["z1"] + rest % d)] = names[c] if c >= 0 else None
    return n


def column(cells, x, z, top, bottom):
    """One column as find_site sees it: None if not loaded, else {y, wet, floor, trees, block}; y None when no ground
    is found down to the bottom of the read."""
    trees = 0
    for y in range(top, bottom - 1, -1):
        n = cells.get((x, y, z))
        if n is None:
            return None
        if n in AIR:
            continue
        if LIQUID.match(n):
            # The water's surface for the site (find_site), its solid bottom for filling (prepare_site)
            floor = next((yy for yy in range(y - 1, bottom - 1, -1) if is_ground(cells.get((x, yy, z)) or "air")), None)
            return {"y": y, "wet": True, "floor": floor, "trees": trees, "block": n}
        if is_tree(n):
            trees += 1
        if is_ground(n):
            return {"y": y, "wet": False, "floor": y, "trees": trees, "block": n}
    return {"y": None, "wet": False, "floor": None, "trees": trees, "block": "air"}


fails, warns = 0, 0


def out(level, msg):
    global fails, warns
    fails += level == "FAIL"
    warns += level == "WARN"
    print(f"{level} {msg}", flush=True)


t_all = time.time()
try:
    call("/agents/Gus", method="DELETE")
    # No height: the server puts him on the surface (y 90 put agents inside hills, F84)
    r = call("/agents", {"name": "Gus", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": X + 0.5, "z": Z + 0.5}})
    if "name" not in r:
        out("FAIL", f"could not spawn Gus: {r}")
        raise SystemExit(1)
    time.sleep(8)
    p = (gus() or {}).get("position") or {}
    print(f"Gus spawned at {p.get('x', 0):.1f},{p.get('y', 0):.1f},{p.get('z', 0):.1f}", flush=True)

    t = time.time()
    kind, text = act("find_site", size=SIZE)
    print(f"find_site size={SIZE}: {kind} after {time.time() - t:.1f} s: {text}", flush=True)
    site = call("/agents/Gus/memory").get("lastSite")
    p = (gus() or {}).get("position") or {}
    gy = int(p["y"] // 1) if "y" in p else None
    print(f"lastSite: {site}; Gus surveyed from {p.get('x', 0):.1f},{p.get('y', 0):.1f},{p.get('z', 0):.1f}"
          f" (before F88's fix find_site read ground from y {gy + SCAN_UP if gy is not None else '?'} down)", flush=True)
    m = re.search(r"centre x=(-?\d+) z=(-?\d+), ground y=(-?\d+), (\d+)x\d+, height range (\d+).*?, (\d+) tree blocks", text)
    if kind != "action_done":
        out("FAIL", f"find_site did not finish: {text[:300]}")
        if not (m and site):
            raise SystemExit(1)
        print("  (the largest smaller site it saved is checked below)")
    if not site or not m:
        out("FAIL", "no site to check (no lastSite, or the result text has no 'centre x=.. ground y=..')")
        raise SystemExit(1)
    rx, rz, ry, rsize, rrange, rtrees = (int(v) for v in m.groups())
    if (rx, rz, ry, rsize) != (site["x"], site["z"], site["y"], site["size"]):
        out("WARN", f"the text ({rx},{rz} y={ry} {rsize}x{rsize}) and lastSite ({site['x']},{site['z']} y={site['y']} "
                    f"{site['size']}x{site['size']}) differ; checking lastSite")
    cx, cz, level, sz = site["x"], site["z"], site["y"], site["size"]

    # The square find_site judged (bestSite: the window's top-left is the centre less size // 2) and the margin
    # prepare_site levels around it (plan_layout's plot is at most the site, centred the same way)
    half = sz // 2
    sx1, sz1 = cx - half, cz - half
    sx2, sz2 = sx1 + sz - 1, sz1 + sz - 1
    bx1, bz1, bx2, bz2 = sx1 - MARGIN, sz1 - MARGIN, sx2 + MARGIN, sz2 + MARGIN
    print(f"site x {sx1}..{sx2}, z {sz1}..{sz2}; with the {MARGIN}-block margin x {bx1}..{bx2}, z {bz1}..{bz2}", flush=True)

    # Read from 48 below the lowest of the level and Gus to 64 above the highest, then on up while any column is
    # still solid at the top of the read (ground far above the reported level: F88)
    lo = max(WORLD_MIN, min(level, gy if gy is not None else level) - 48)
    hi = min(WORLD_MAX, max(level, gy if gy is not None else level) + 64)
    cells = {}
    t = time.time()
    reqs = read_box(bx1, lo, bz1, bx2, hi, bz2, cells)
    while hi < WORLD_MAX and any((n := cells.get((x, hi, z))) is not None and n not in AIR
                                 for x in range(bx1, bx2 + 1) for z in range(bz1, bz2 + 1)):
        top = min(WORLD_MAX, hi + 64)
        reqs += read_box(bx1, hi + 1, bz1, bx2, top, bz2, cells)
        hi = top
    print(f"read y {lo}..{hi} over {(bx2 - bx1 + 1) * (bz2 - bz1 + 1)} columns in {reqs} requests ({time.time() - t:.1f} s)", flush=True)

    cols = {(x, z): column(cells, x, z, hi, lo) for x in range(bx1, bx2 + 1) for z in range(bz1, bz2 + 1)}
    in_site = lambda x, z: sx1 <= x <= sx2 and sz1 <= z <= sz2

    # Not loaded
    unl_site = [k for k, c in cols.items() if c is None and in_site(*k)]
    unl_margin = [k for k, c in cols.items() if c is None and not in_site(*k)]
    if unl_site or unl_margin:
        out("FAIL", f"{len(unl_site)} site columns and {len(unl_margin)} margin columns are not loaded "
                    f"(first: {', '.join(f'{x},{z}' for x, z in (unl_site + unl_margin)[:6])}); find_site rejects windows "
                    f"with unloaded columns, so site columns here mean it judged ground it could not see (F88)")
    else:
        out("PASS", "every column of the site and margin is loaded")

    site_cols = [c for k, c in cols.items() if c is not None and in_site(*k)]
    ys = sorted(c["y"] for c in site_cols if c["y"] is not None)
    if not ys:
        out("FAIL", "no ground found in any site column")
        raise SystemExit(1)
    median = ys[len(ys) >> 1]
    real_range = ys[-1] - ys[0]
    trees = sum(c["trees"] for c in site_cols)
    tops = {}
    for c in site_cols:
        tops[c["block"]] = tops.get(c["block"], 0) + 1
    print(f"real: median ground y={median}, heights {ys[0]}..{ys[-1]} (range {real_range}), {trees} tree blocks; "
          f"tops: {', '.join(f'{n} {q}' for n, q in sorted(tops.items(), key=lambda kv: -kv[1])[:6])}")
    print(f"find_site: ground y={level}, height range {rrange}, {rtrees} tree blocks", flush=True)

    # The level
    if abs(median - level) > 2:
        out("FAIL", f"reported ground y={level}, real median y={median} ({median - level:+d})")
    else:
        out("PASS", f"reported ground y={level} matches the real median y={median}")
    # The height range
    if real_range - rrange > 3:
        out("FAIL", f"reported height range {rrange}, real {real_range} ({ys[0]}..{ys[-1]})")
    else:
        out("PASS", f"reported height range {rrange}, real {real_range}")
    # Trees (a soft check: find_site counts only within its scan window)
    if abs(trees - rtrees) > max(10, trees // 4):
        out("WARN", f"reported {rtrees} tree blocks, real {trees}")
    else:
        out("PASS", f"reported {rtrees} tree blocks, real {trees}")
    # Wet columns on the site (find_site rejects any)
    wet = [k for k, c in cols.items() if c and c["wet"] and in_site(*k)]
    if wet:
        out("FAIL", f"{len(wet)} site columns are water or lava (first: {', '.join(f'{x},{z}' for x, z in wet[:6])})")
    wet_margin = sum(1 for k, c in cols.items() if c and c["wet"] and not in_site(*k))
    if wet_margin:
        out("WARN", f"{wet_margin} margin columns are water or lava (prepare_site fills them from the bottom)")
    # Drops: columns more than 4 below the level prepare_site will choose (prepare_site refuses more than 8; F83). Its
    # level is the commonest dry ground height on the plot (lowest on ties), so it is read from the real blocks: against
    # a wrong reported level (F88: 101 for 119) a ravine reads as ground above the level
    counts = {}
    for c in site_cols:
        if c["y"] is not None and not c["wet"]:
            counts[c["y"]] = counts.get(c["y"], 0) + 1
    prep = min(counts, key=lambda y: (-counts[y], y)) if counts else level
    drops = sorted(((prep - (c["floor"] if c["floor"] is not None else lo - 1), x, z, in_site(x, z))
                    for (x, z), c in cols.items() if c and (c["floor"] is None or prep - c["floor"] > 4)), reverse=True)
    if drops:
        n_site = sum(1 for d in drops if d[3])
        # prepare_site fills margin columns up to 8 down and leaves deeper ones as they are (F83): only the site fails
        out("FAIL" if n_site else "WARN", f"{len(drops)} columns lie more than 4 below prepare_site's level y={prep} ({n_site} on the site, "
                    f"{len(drops) - n_site} in the margin; prepare_site refuses more than 8 on the plot): "
                    + "; ".join(f"{x},{z} {d} below{'' if s else ' (margin)'}" for d, x, z, s in drops[:10]))
    else:
        out("PASS", f"no column of the site or margin lies more than 4 below prepare_site's level y={prep}")
    # Ground above the old scan window: before F88's fix every such column read as the window's top; the level and range
    # checks above catch a return of it, this only says the case was exercised
    if gy is not None:
        above = [c for c in site_cols if c["y"] is not None and c["y"] > gy + SCAN_UP]
        if above:
            print(f"  note: {len(above)} site columns have ground above y {gy + SCAN_UP} (Gus's y {gy} + {SCAN_UP}), where "
                  f"find_site's scan began before F88's fix", flush=True)

    # Height map: north at the top, x to the right; the site inside the frame, the margin outside
    def ch(c, base):
        if c is None:
            return "?"
        if c["wet"]:
            return "~"
        if c["y"] is None:
            return "!"
        d = c["y"] - base
        if d == 0:
            return "="
        if d > 0:
            return str(d) if d <= 9 else "+"
        return "abcdefghi"[-d - 1] if d >= -9 else "!"

    def height_map(base, what):
        print(f"\nheight map relative to y={base}, {what} (north up, x {bx1}..{bx2} left to right, z {bz1}..{bz2} top to bottom):")
        print("  '=' level, 1-9 above, '+' more than 9 above, a-i 1-9 below, '!' more than 9 below, '~' water/lava, '?' not loaded")
        rule = " " * MARGIN + "+" + "-" * sz + "+"
        for z in range(bz1, bz2 + 1):
            if z == sz1:
                print("  " + rule)
            row = "".join(ch(cols[(x, z)], base) + ("|" if x in (sx1 - 1, sx2) else "") for x in range(bx1, bx2 + 1))
            print(f"  {row}  z={z}")
            if z == sz2:
                print("  " + rule)

    height_map(level, "the reported level")
    # A wrong reported level shows as all '+' or all letters: then the map against the level prepare_site would choose
    if abs(prep - level) > 2:
        height_map(prep, "prepare_site's level from the real blocks")
except KeyboardInterrupt:
    print("interrupted")
    fails += 1
finally:
    call("/agents/Gus", method="DELETE")
    print(f"\nGus removed; {time.time() - t_all:.0f} s in all; {'FAIL' if fails else 'PASS'} ({fails} failures, {warns} warnings)")
sys.exit(1 if fails else 0)
