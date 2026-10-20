"""Live acceptance check for the fish foundry skill (ticket fish).

Finds open water near the test site's centre (-1563, -36 on minevale3) away from any village plot,
spawns Gus on a dry standable cell beside the water in survival mode with a fishing_rod, records the
surrounding block box, runs fish count=2 radius=16, verifies at least 1 fish on the server for Gus,
verifies no broke/placed events and no block changes in the box, and verifies that after clearing
Gus's fishing rods a second call fish count=1 fails with a message containing 'no fishing rod'.
"""
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
import math
import os
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

RAW_API = os.environ.get("MCAI_API", "").strip().rstrip("/")
if not RAW_API:
    print("FISH FAILED: MCAI_API environment variable is not set", file=sys.stderr)
    sys.exit(2)

API = RAW_API if RAW_API.endswith("/api") else RAW_API + "/api"
PARSED_API = urllib.parse.urlparse(API)
API_BASE_PATH = PARSED_API.path.rstrip("/")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RCON_SCRIPT = os.path.join(ROOT, "mc", "rcon.py")

CENTRE_X = int(sys.argv[1]) if len(sys.argv) > 2 else -1563
CENTRE_Z = int(sys.argv[2]) if len(sys.argv) > 2 else -36

FISH_NAMES = ("cod", "salmon", "pufferfish", "tropical_fish")
AIR_BLOCKS = {"air", "cave_air", "void_air"}
PASSABLE = {
    "air", "cave_air", "void_air", "short_grass", "tall_grass", "fern", "large_fern",
    "dandelion", "poppy", "azure_bluet", "oxeye_daisy", "cornflower", "allium",
    "blue_orchid", "dead_bush", "pink_petals", "snow",
}
BAD_GROUND = {
    "water", "lava", "kelp", "kelp_plant", "seagrass", "tall_seagrass", "bubble_column",
    "lily_pad", "cactus", "sweet_berry_bush", "fire", "soul_fire", "magma_block", "powder_snow",
    "ice", "packed_ice", "blue_ice", "frosted_ice", "cobweb",
}

_tls = threading.local()


def fail(why: str):
    print(f"FISH FAILED: {why}")
    sys.exit(1)


def call(path: str, body=None, method: str = None, timeout: int = 60):
    url = API + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method or ("POST" if body is not None else "GET"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return json.loads(raw) if raw else {"error": str(e)}
        except Exception:
            return {"error": str(e)}


def _thread_conn() -> http.client.HTTPConnection:
    conn = getattr(_tls, "conn", None)
    if conn is None:
        conn = http.client.HTTPConnection(PARSED_API.netloc, timeout=15)
        conn.connect()
        if conn.sock is not None:
            conn.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        _tls.conn = conn
    return conn


def block(x: int, y: int, z: int) -> str:
    path = f"{API_BASE_PATH}/block?x={x}&y={y}&z={z}"
    for _ in range(2):
        try:
            conn = _thread_conn()
            conn.request("GET", path)
            resp = conn.getresponse()
            raw = resp.read()
            if resp.status == 200 and raw:
                data = json.loads(raw)
                return data.get("block") or data.get("type") or "?"
            break
        except Exception:
            try:
                getattr(_tls, "conn", None) and _tls.conn.close()
            except Exception:
                pass
            _tls.conn = None
    res = call(f"/block?x={x}&y={y}&z={z}")
    if isinstance(res, dict) and ("block" in res or "type" in res):
        return res.get("block") or res.get("type")
    if "passed" in rcon(f"execute if block {x} {y} {z} #minecraft:air").lower():
        return "air"
    if "passed" in rcon(f"execute if block {x} {y} {z} minecraft:water").lower():
        return "water"
    return "solid"


def rcon(cmd: str) -> str:
    p = subprocess.run(
        [sys.executable, RCON_SCRIPT, cmd],
        cwd=ROOT,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        timeout=20,
    )
    return (p.stdout or "").strip()


def events_since(last_id: int) -> list:
    evs = call("/agents/Gus/events")
    if not isinstance(evs, list):
        return []
    return [e for e in evs if isinstance(e, dict) and e.get("id", 0) > last_id]


def act(action: str, timeout_s: int = 360, **args):
    evs0 = call("/agents/Gus/events")
    last = max([e.get("id", 0) for e in evs0 if isinstance(e, dict)] or [0]) if isinstance(evs0, list) else 0
    res = call("/agents/Gus/act", {"action": action, **args})
    if isinstance(res, dict) and res.get("error"):
        return "action_failed", str(res["error"]), []
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(0.5)
        evs = events_since(last)
        done = [e for e in evs if e.get("type") in ("action_done", "action_failed")]
        if done:
            return done[-1]["type"], done[-1].get("text", ""), evs
    return "timeout", f"(no result in {timeout_s}s)", events_since(last)


def village_boxes() -> list:
    data = call("/village")
    villages = data if isinstance(data, list) else (data.get("villages", []) if isinstance(data, dict) else [])
    boxes = []
    for v in villages:
        if not isinstance(v, dict):
            continue
        for key in ("plots", "structures", "layouts"):
            for item in v.get(key) or []:
                if isinstance(item, dict) and all(k in item for k in ("x1", "z1", "x2", "z2")):
                    boxes.append((int(item["x1"]) - 12, int(item["z1"]) - 12, int(item["x2"]) + 12, int(item["z2"]) + 12))
    return boxes


def away_from_villages(x: int, z: int, boxes: list) -> bool:
    for x1, z1, x2, z2 in boxes:
        if x1 <= x <= x2 and z1 <= z <= z2:
            return False
    return True


def is_solid_dry_ground(name: str) -> bool:
    if not name or name == "?" or name in PASSABLE or name in BAD_GROUND:
        return False
    if "water" in name or "lava" in name:
        return False
    if name.endswith(("_leaves", "_log", "_wood", "_stem", "_fence", "_fence_gate", "_wall", "_door", "_trapdoor")):
        return False
    return True


def find_open_water_and_shore(base_x: int, base_z: int, boxes: list):
    cache = {}

    def get_b(xx: int, yy: int, zz: int) -> str:
        k = (xx, yy, zz)
        if k not in cache:
            cache[k] = block(xx, yy, zz)
        return cache[k]

    def open_sky(xx: int, yy: int, zz: int, height: int = 16) -> bool:
        for up in range(1, height + 1):
            if get_b(xx, yy + up, zz) not in AIR_BLOCKS:
                return False
        return True

    def check_water_cell(wx: int, wy: int, wz: int):
        if not away_from_villages(wx, wz, boxes):
            return None
        if get_b(wx, wy, wz) != "water":
            return None
        if not open_sky(wx, wy, wz, 16):
            return None
        # Confirm over RCON that the water cell and the air cell above it match the server
        if "passed" not in rcon(f"execute if block {wx} {wy} {wz} minecraft:water").lower():
            return None
        if "passed" not in rcon(f"execute if block {wx} {wy + 1} {wz} #minecraft:air").lower():
            return None

        # Look for an adjacent dry standable cell right beside the water cell
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sx, sz = wx + dx, wz + dz
            if not away_from_villages(sx, sz, boxes):
                continue
            for sy in (wy + 1, wy):
                under = get_b(sx, sy - 1, sz)
                if not is_solid_dry_ground(under):
                    continue
                if get_b(sx, sy, sz) not in AIR_BLOCKS or get_b(sx, sy + 1, sz) not in AIR_BLOCKS:
                    continue
                if not open_sky(sx, sy, sz, 6):
                    continue
                # Ensure none of the 4 neighbours of the stand spot at foot level (sy) are water (no flooding/stepping into water)
                if any(get_b(sx + ndx, sy, sz + ndz) == "water" for ndx, ndz in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    continue
                if "passed" not in rcon(f"execute if block {sx} {sy - 1} {sz} minecraft:{under}").lower():
                    continue
                return (wx, wy, wz), (sx, sy, sz)
        return None

    # Build a coarse grid within 130 blocks of (base_x, base_z), ordered outward from the centre
    coarse = []
    for dx in range(-128, 129, 8):
        for dz in range(-128, 129, 8):
            dist = math.hypot(dx, dz)
            if dist <= 130 and away_from_villages(base_x + dx, base_z + dz, boxes):
                coarse.append((dist, base_x + dx, base_z + dz))
    coarse.sort(key=lambda t: t[0])

    for wy in (62, 63, 61, 64):
        # Probe coarse grid in batches using /api/block
        pts = [(x, wy, z) for _, x, z in coarse]
        with ThreadPoolExecutor(max_workers=8) as pool:
            names = list(pool.map(lambda p: block(p[0], p[1], p[2]), pts))
        for (x, y, z), bname in zip(pts, names):
            cache[(x, y, z)] = bname

        water_seeds = [(x, y, z) for (x, y, z), bname in zip(pts, names) if bname == "water"]
        # If /api/block had unloaded far chunks or found no water at this y, also probe coarse points over RCON at y=62..63
        if not water_seeds and wy in (62, 63):
            for _, cx, cz in coarse[::2]:
                if "passed" in rcon(f"execute if block {cx} {wy} {cz} minecraft:water").lower():
                    rcon(f"tp Gus {cx} {wy + 10} {cz}")
                    time.sleep(0.8)
                    water_seeds.append((cx, wy, cz))
                    break

        for wx0, wy0, wz0 in water_seeds:
            # Search local 17x17 patch around the water seed for a shoreline water cell with a dry standable neighbour
            for r in range(0, 9):
                for ddx in range(-r, r + 1):
                    for ddz in range(-r, r + 1):
                        if max(abs(ddx), abs(ddz)) != r:
                            continue
                        hit = check_water_cell(wx0 + ddx, wy0, wz0 + ddz)
                        if hit is not None:
                            return hit
    return None, None


def read_box(x1: int, y1: int, z1: int, x2: int, y2: int, z2: int) -> dict:
    coords = [
        (x, y, z)
        for x in range(x1, x2 + 1)
        for z in range(z1, z2 + 1)
        for y in range(y1, y2 + 1)
    ]
    out = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for c, b in zip(coords, pool.map(lambda p: block(p[0], p[1], p[2]), coords)):
            out[c] = b
    return out


def server_item_count(player: str, item: str) -> int:
    out = rcon(f"clear {player} minecraft:{item} 0")
    if "no items were found" in out.lower():
        return 0
    m = re.search(r"found (\d+) matching", out, re.I)
    return int(m.group(1)) if m else 0


def server_fish_counts(player: str = "Gus") -> dict:
    return {name: server_item_count(player, name) for name in FISH_NAMES}


def cleanup():
    try:
        call("/agents/Gus", method="DELETE")
    except Exception:
        pass


def main():
    try:
        cleanup()
        boxes = village_boxes()

        # Spawn Gus near the site centre first so chunks within 130 blocks are loaded for probing
        sp0 = call("/agents", {
            "name": "Gus",
            "brain": "idle",
            "gamemode": "survival",
            "reset": True,
            "position": {"x": CENTRE_X + 0.5, "z": CENTRE_Z + 0.5},
        })
        if not isinstance(sp0, dict) or sp0.get("error"):
            fail(f"initial probe spawn of Gus failed: {sp0}")
        time.sleep(1.0)

        water_cell, dry_cell = find_open_water_and_shore(CENTRE_X, CENTRE_Z, boxes)
        if not water_cell or not dry_cell:
            fail(f"no open water with a dry standable neighbour found within 130 blocks of {CENTRE_X},{CENTRE_Z}")

        wx, wy, wz = water_cell
        sx, sy, sz = dry_cell
        print(f"probe: open water at {wx},{wy},{wz}, dry standable cell beside it at {sx},{sy},{sz}")

        # Remove any agent Gus and spawn Gus on the dry cell beside the open water
        call("/agents/Gus", method="DELETE")
        time.sleep(0.4)
        sp = call("/agents", {
            "name": "Gus",
            "brain": "idle",
            "gamemode": "survival",
            "reset": True,
            "position": {"x": sx + 0.5, "y": sy, "z": sz + 0.5},
        })
        if not isinstance(sp, dict) or sp.get("error"):
            fail(f"could not spawn Gus at {sx},{sy},{sz}: {sp}")

        # Clear any nearby hostile mobs so Gus is not interrupted while fishing, and give Gus a fishing_rod by RCON
        for mob in ("drowned", "zombie", "skeleton", "creeper", "spider", "witch"):
            rcon(f"tp @e[type=minecraft:{mob},x={sx},y={sy},z={sz},distance=..48] ~ -200 ~")
        rcon("give Gus minecraft:fishing_rod 1")
        time.sleep(0.5)

        # Record the blocks of a box around Gus (radius 6, from 2 below the ground to 3 above)
        ground_y = sy - 1
        x1, x2 = sx - 6, sx + 6
        y1, y2 = ground_y - 2, ground_y + 3
        z1, z2 = sz - 6, sz + 6
        box_before = read_box(x1, y1, z1, x2, y2, z2)

        # Run fish count 2 radius 16 through /api/agents/Gus/act and wait up to 6 minutes
        ev_type1, text1, evs1 = act("fish", timeout_s=360, count=2, radius=16)
        if ev_type1 == "timeout":
            fail(f"first fish call timed out after 360s: {text1}")

        # Verification 1: at least 1 fish on the server for Gus
        counts = server_fish_counts("Gus")
        total_fish = sum(counts.values())
        print(
            f"verify 1 (server fish): {total_fish} fish on server {counts} "
            f"(event={ev_type1}, text={text1})"
        )
        if total_fish < 1:
            fail(f"expected at least 1 fish on the server for Gus, got {total_fish} ({counts}; {ev_type1}: {text1})")

        # Verification 2: no 'broke' or 'placed' event from Gus during the skill and no cell of the box changed
        bad_evs = [e for e in evs1 if e.get("type") in ("broke", "placed")]
        box_after = read_box(x1, y1, z1, x2, y2, z2)
        changed = []
        for coord, b_before in box_before.items():
            b_after = box_after.get(coord)
            if b_before != b_after:
                # Ignore natural grass_block <-> dirt spread on random ticks
                if {b_before, b_after} <= {"grass_block", "dirt"}:
                    continue
                cx, cy, cz = coord
                if b_before not in ("?", "solid") and "passed" in rcon(f"execute if block {cx} {cy} {cz} minecraft:{b_before}").lower():
                    continue
                changed.append((coord, b_before, b_after))
        print(
            f"verify 2 (blocks untouched): {len(bad_evs)} broke/placed events, "
            f"{len(changed)} of {len(box_before)} cells changed in ({x1}..{x2}, {y1}..{y2}, {z1}..{z2})"
        )
        if bad_evs:
            fail(f"Gus emitted broke/placed events during fish: {bad_evs[:3]}")
        if changed:
            fail(f"{len(changed)} block cells changed during fish: {changed[:5]}")

        # Verification 3: clear Gus's fishing rods by RCON and a second call fish count 1 must fail with 'no fishing rod'
        rcon("clear Gus minecraft:fishing_rod")
        time.sleep(0.4)
        ev_type2, text2, _ = act("fish", timeout_s=30, count=1)
        print(f"verify 3 (second call without rod): {ev_type2} -> {text2}")
        if ev_type2 != "action_failed" or "no fishing rod" not in text2.lower():
            fail(f"expected action_failed containing 'no fishing rod', got {ev_type2}: {text2}")

        print("FISH OK")
    except SystemExit:
        raise
    except Exception as e:
        fail(str(e))
    finally:
        cleanup()


if __name__ == "__main__":
    main()
