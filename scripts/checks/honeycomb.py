"""Live acceptance check for the harvest_honeycomb foundry skill (ticket honeycomb).

Finds open, dry, level ground near the test site's centre (-1563, -36 on minevale3) away from any village plot,
removes any agent Gus, builds a column of 3 oak_log 3 blocks from Gus's cell and places an empty bee_nest with
state [honey_level=5,facing=west] against the column's side at its top (3 blocks above the ground), spawns Gus on
the ground in survival mode with 1 shears, records the surrounding block box (leaving out the target cell), runs
harvest_honeycomb count=1 radius=16, and verifies:
1. at least 1 honeycomb on the server for Gus;
2. the target is no longer in honey_level=5 and is still a bee_nest;
3. no broke/placed events from Gus and no other cell of the box changed;
4. a second call harvest_honeycomb count=1 radius=16 (target used) fails or reports none left in the state within 2 minutes;
5. after clearing Gus's shears and resetting the target to honey_level=5, a third call fails with 'no shears'.
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
    print("HONEYCOMB FAILED: MCAI_API environment variable is not set", file=sys.stderr)
    sys.exit(2)

API = RAW_API if RAW_API.endswith("/api") else RAW_API + "/api"
PARSED_API = urllib.parse.urlparse(API)
API_BASE_PATH = PARSED_API.path.rstrip("/")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RCON_SCRIPT = os.path.join(ROOT, "mc", "rcon.py")

CENTRE_X = int(sys.argv[1]) if len(sys.argv) > 2 else -1563
CENTRE_Z = int(sys.argv[2]) if len(sys.argv) > 2 else -36

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
PLACED_CELLS: list[tuple[int, int, int]] = []


def fail(why: str):
    print(f"HONEYCOMB FAILED: {why}")
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


def events_since(last_id: int) -> list:
    evs = call("/agents/Gus/events")
    if not isinstance(evs, list):
        return []
    return [e for e in evs if isinstance(e, dict) and e.get("id", 0) > last_id]


def act(action: str, timeout_s: int = 240, **args):
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
                    boxes.append((int(item["x1"]) - 16, int(item["z1"]) - 16, int(item["x2"]) + 16, int(item["z2"]) + 16))
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
    if name in ("bee_nest", "beehive"):
        return False
    return True


def find_ground_y(x: int, z: int, y_hint: int, cache: dict) -> int | None:
    def get_b(xx: int, yy: int, zz: int) -> str:
        k = (xx, yy, zz)
        if k not in cache:
            cache[k] = block(xx, yy, zz)
        return cache[k]

    for dy in range(10, -14, -1):
        y = y_hint + dy
        below = get_b(x, y - 1, z)
        if not is_solid_dry_ground(below):
            continue
        if all(get_b(x, y + up, z) in PASSABLE for up in range(0, 5)):
            return y
    return None


def find_level_open_spot(base_x: int, base_z: int, y_hint: int, boxes: list):
    cache = {}

    def get_b(xx: int, yy: int, zz: int) -> str:
        k = (xx, yy, zz)
        if k not in cache:
            cache[k] = block(xx, yy, zz)
        return cache[k]

    offsets = [
        (0, 0), (8, 0), (-8, 0), (0, 8), (0, -8),
        (12, 12), (-12, 12), (12, -12), (-12, -12),
        (18, 0), (-18, 0), (0, 18), (0, -18),
        (24, 14), (-24, 14), (24, -14), (-24, -14),
        (32, 0), (-32, 0), (0, 32), (0, -32),
        (40, 20), (-40, 20), (40, -20), (-40, -20),
    ]

    for ox, oz in offsets:
        gx, gz = base_x + ox, base_z + oz
        if not away_from_villages(gx, gz, boxes) or not away_from_villages(gx + 3, gz, boxes):
            continue
        gy = find_ground_y(gx, gz, y_hint, cache)
        if gy is None:
            continue
        # Require level dry ground from gx-2..gx+4 and gz-2..gz+2 with clear air up to gy+4
        patch_ok = True
        for dx in range(-2, 5):
            for dz in range(-2, 3):
                ny = find_ground_y(gx + dx, gz + dz, gy, cache)
                if ny != gy:
                    patch_ok = False
                    break
                for up in range(0, 5):
                    bname = get_b(gx + dx, gy + up, gz + dz)
                    if bname not in PASSABLE:
                        patch_ok = False
                        break
                if not patch_ok:
                    break
            if not patch_ok:
                break
        if patch_ok:
            return gx, gy, gz
    return None


def read_box(x1: int, y1: int, z1: int, x2: int, y2: int, z2: int, exclude: set) -> dict:
    coords = [
        (x, y, z)
        for x in range(x1, x2 + 1)
        for z in range(z1, z2 + 1)
        for y in range(y1, y2 + 1)
        if (x, y, z) not in exclude
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


def cleanup():
    for cx, cy, cz in reversed(PLACED_CELLS):
        try:
            rcon(f"setblock {cx} {cy} {cz} minecraft:air")
        except Exception:
            pass
    if PLACED_CELLS:
        tx, ty, tz = PLACED_CELLS[-1]
        try:
            rcon(f"kill @e[type=minecraft:item,x={tx},y={ty},z={tz},distance=..12]")
        except Exception:
            pass
    try:
        call("/agents/Gus", method="DELETE")
    except Exception:
        pass


def main():
    try:
        cleanup()
        boxes = village_boxes()
        start_x, start_z = CENTRE_X, CENTRE_Z
        for step in range(0, 160, 16):
            cand = [
                (CENTRE_X + step, CENTRE_Z),
                (CENTRE_X - step, CENTRE_Z),
                (CENTRE_X, CENTRE_Z + step),
                (CENTRE_X, CENTRE_Z - step),
            ]
            picked = next(((x, z) for x, z in cand if away_from_villages(x, z, boxes)), None)
            if picked:
                start_x, start_z = picked
                break

        # Spawn Gus briefly near the search centre so chunks are loaded for /api/block ground probes
        sp0 = call("/agents", {
            "name": "Gus",
            "brain": "idle",
            "gamemode": "survival",
            "reset": True,
            "position": {"x": start_x + 0.5, "z": start_z + 0.5},
        })
        if not isinstance(sp0, dict) or sp0.get("error"):
            fail(f"initial probe spawn of Gus failed: {sp0}")
        time.sleep(0.8)
        obs0 = call("/agents/Gus/observe?radius=4")
        pos0 = (obs0.get("position") if isinstance(obs0, dict) else None) or (sp0.get("agent") or {}).get("position") or {}
        base_x = int(math.floor(pos0.get("x", start_x)))
        base_y = int(round(pos0.get("y", 70)))
        base_z = int(math.floor(pos0.get("z", start_z)))

        spot = find_level_open_spot(base_x, base_z, base_y, boxes)
        if spot is None:
            gy = find_ground_y(base_x, base_z, base_y, {}) or base_y
            spot = (base_x, gy, base_z)

        gx, gy, gz = spot
        ground_y = gy - 1
        ground_name = block(gx, ground_y, gz)
        rcon_probe = rcon(f"execute if block {gx} {ground_y} {gz} minecraft:{ground_name}")
        if "passed" not in rcon_probe.lower() and ground_name not in ("?", "solid"):
            fail(f"ground probe mismatch at {gx},{ground_y},{gz}: /api/block={ground_name}, rcon={rcon_probe}")

        # Remove any agent Gus before building the target by RCON
        call("/agents/Gus", method="DELETE")
        time.sleep(0.4)

        # Build the target by RCON:
        # - a column of 3 oak_log from the ground up at a spot 3 blocks from Gus's cell: (gx + 3, gy..gy+2, gz)
        # - a bee_nest[honey_level=5,facing=west] against the column's side at its top (3 blocks above ground_y: gy + 2)
        lx, lz = gx + 3, gz
        tx, ty, tz = gx + 2, gy + 2, gz
        target_cell = (tx, ty, tz)

        # Clear any grass/flowers in the immediate path between Gus and the log column before building and recording
        for cx in range(gx, lx + 1):
            for cy in range(gy, gy + 4):
                rcon(f"setblock {cx} {cy} {gz} minecraft:air")

        for ly in (gy, gy + 1, gy + 2):
            PLACED_CELLS.append((lx, ly, lz))
            rcon(f"setblock {lx} {ly} {lz} minecraft:oak_log[axis=y]")

        PLACED_CELLS.append((tx, ty, tz))
        rcon(f"setblock {tx} {ty} {tz} minecraft:bee_nest[honey_level=5,facing=west]")

        chk_init = rcon(f"execute if block {tx} {ty} {tz} minecraft:bee_nest[honey_level=5]")
        if "passed" not in chk_init.lower():
            fail(f"failed to place bee_nest[honey_level=5] at {tx},{ty},{tz}: {chk_init}")

        # Spawn Gus on the ground (brain idle, gamemode survival, reset true) and give 1 shears by RCON
        sp = call("/agents", {
            "name": "Gus",
            "brain": "idle",
            "gamemode": "survival",
            "reset": True,
            "position": {"x": gx + 0.5, "y": gy, "z": gz + 0.5},
        })
        if not isinstance(sp, dict) or sp.get("error"):
            fail(f"could not spawn Gus at {gx},{gy},{gz}: {sp}")

        rcon("give Gus minecraft:shears 1")
        time.sleep(0.5)

        # Record the blocks of a box around them (radius 6, from 2 below the ground to 5 above), leaving out the target cell
        x1, x2 = min(gx, lx) - 6, max(gx, lx) + 6
        y1, y2 = ground_y - 2, ground_y + 5
        z1, z2 = gz - 6, gz + 6
        box_before = read_box(x1, y1, z1, x2, y2, z2, exclude={target_cell})

        # Run harvest_honeycomb count 1 radius 16 through /api/agents/Gus/act, wait up to 4 minutes
        ev_type1, text1, evs1 = act("harvest_honeycomb", timeout_s=240, count=1, radius=16)
        if ev_type1 == "timeout":
            fail(f"first harvest_honeycomb call timed out after 240s: {text1}")

        # Verification 1: at least 1 honeycomb on the server for Gus
        hc = server_item_count("Gus", "honeycomb")
        print(f"verify 1 (server honeycomb): {hc} honeycomb on server for Gus (event={ev_type1}, text={text1})")
        if hc < 1:
            fail(f"expected at least 1 honeycomb on the server for Gus, got {hc} ({ev_type1}: {text1})")

        # Verification 2: target is no longer in honey_level=5, and is still a bee_nest
        chk_level5 = rcon(f"execute if block {tx} {ty} {tz} minecraft:bee_nest[honey_level=5]")
        chk_nest = rcon(f"execute if block {tx} {ty} {tz} minecraft:bee_nest")
        still_level5 = "passed" in chk_level5.lower()
        still_nest = "passed" in chk_nest.lower()
        print(
            f"verify 2 (target state): at {tx},{ty},{tz} honey_level=5 is {still_level5} "
            f"(expected False), still bee_nest is {still_nest} (expected True)"
        )
        if still_level5:
            fail(f"target at {tx},{ty},{tz} is still in state honey_level=5 ({chk_level5})")
        if not still_nest:
            fail(f"target at {tx},{ty},{tz} is no longer a bee_nest ({chk_nest})")

        # Verification 3: no 'broke' or 'placed' event from Gus and no other cell of the box changed
        bad_evs = [e for e in evs1 if e.get("type") in ("broke", "placed")]
        box_after = read_box(x1, y1, z1, x2, y2, z2, exclude={target_cell})
        changed = []
        for coord, b_before in box_before.items():
            b_after = box_after.get(coord)
            if b_before != b_after:
                if {b_before, b_after} <= {"grass_block", "dirt"}:
                    continue
                cx, cy, cz = coord
                if b_before not in ("?", "solid") and "passed" in rcon(f"execute if block {cx} {cy} {cz} minecraft:{b_before}").lower():
                    continue
                changed.append((coord, b_before, b_after))
        print(
            f"verify 3 (blocks untouched): {len(bad_evs)} broke/placed events, "
            f"{len(changed)} of {len(box_before)} cells changed in ({x1}..{x2}, {y1}..{y2}, {z1}..{z2})"
        )
        if bad_evs:
            fail(f"Gus emitted broke/placed events during harvest_honeycomb: {bad_evs[:3]}")
        if changed:
            fail(f"{len(changed)} block cells changed during harvest_honeycomb: {changed[:5]}")

        # Verification 4: second call harvest_honeycomb count 1 radius 16 (target used) must fail or report none left in the state within 2 minutes
        ev_type2, text2, _ = act("harvest_honeycomb", timeout_s=120, count=1, radius=16)
        print(f"verify 4 (second call with target used): {ev_type2} -> {text2}")
        if ev_type2 == "timeout":
            fail("second harvest_honeycomb call hung when target was already used")
        low2 = text2.lower()
        if ev_type2 != "action_failed" and not any(w in low2 for w in ("honey_level=5", "used", "refill", "no bee nest", "no more bee nests", "none")):
            fail(f"expected second call to fail or report none left in state honey_level=5, got {ev_type2}: {text2}")

        # Verification 5: clear Gus's shears by RCON, setblock target back to honey_level=5, third call must fail with 'no shears'
        rcon("clear Gus minecraft:shears")
        rcon(f"setblock {tx} {ty} {tz} minecraft:bee_nest[honey_level=5,facing=west]")
        time.sleep(0.4)
        ev_type3, text3, _ = act("harvest_honeycomb", timeout_s=60, count=1, radius=16)
        print(f"verify 5 (third call without shears): {ev_type3} -> {text3}")
        if ev_type3 != "action_failed" or "no shears" not in text3.lower():
            fail(f"expected action_failed containing 'no shears', got {ev_type3}: {text3}")

        print("HONEYCOMB OK")
    except SystemExit:
        raise
    except Exception as e:
        fail(str(e))
    finally:
        cleanup()


if __name__ == "__main__":
    main()
