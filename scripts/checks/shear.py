"""Live acceptance check for the shear_sheep skill (ticket shear).

Finds an open, dry spot near the test site's centre (-1563, -36 on minevale3) away from any village plot,
spawns Gus in survival mode with shears, summons 4 tagged adult sheep 4-8 blocks away, records the surrounding
block box, runs shear_sheep count=4, verifies server wool >= 3, >= 2 sheared sheep, all 4 sheep alive, no blocks
broken/placed or changed in the box, and verifies a second shear_sheep count=2 call when all sheep are sheared
fails or reports no shearable sheep left without hanging.
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
    print("SHEAR FAILED: MCAI_API environment variable is not set", file=sys.stderr)
    sys.exit(2)

API = RAW_API if RAW_API.endswith("/api") else RAW_API + "/api"
PARSED_API = urllib.parse.urlparse(API)
API_BASE_PATH = PARSED_API.path.rstrip("/")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RCON_SCRIPT = os.path.join(ROOT, "mc", "rcon.py")

CENTRE_X = int(sys.argv[1]) if len(sys.argv) > 2 else -1563
CENTRE_Z = int(sys.argv[2]) if len(sys.argv) > 2 else -36
TAG = "mcai_shear_check"

PASSABLE = {
    "air", "cave_air", "void_air", "short_grass", "tall_grass", "fern", "large_fern",
    "dandelion", "poppy", "azure_bluet", "oxeye_daisy", "cornflower", "allium",
    "blue_orchid", "dead_bush", "pink_petals", "snow",
}
BAD_GROUND = {
    "water", "lava", "kelp", "kelp_plant", "seagrass", "tall_seagrass", "bubble_column",
    "lily_pad", "cactus", "sweet_berry_bush", "fire", "soul_fire", "magma_block", "powder_snow",
}

_tls = threading.local()


def fail(why: str):
    print(f"SHEAR FAILED: {why}")
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
                return json.loads(raw).get("block", "?")
            break
        except Exception:
            try:
                getattr(_tls, "conn", None) and _tls.conn.close()
            except Exception:
                pass
            _tls.conn = None
    res = call(f"/block?x={x}&y={y}&z={z}")
    if isinstance(res, dict) and "block" in res:
        return res["block"]
    # Fallback probe over RCON if chunk is not in bot view yet
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


def act(action: str, timeout_s: int = 90, **args):
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
        if get_b(x, y, z) in PASSABLE and get_b(x, y + 1, z) in PASSABLE and get_b(x, y + 2, z) in PASSABLE:
            return y
    return None


def find_open_spot(base_x: int, base_z: int, y_hint: int, boxes: list):
    cache = {}
    offsets = [
        (0, 0), (10, 0), (-10, 0), (0, 10), (0, -10),
        (14, 14), (-14, 14), (14, -14), (-14, -14),
        (22, 0), (-22, 0), (0, 22), (0, -22),
        (28, 16), (-28, 16), (28, -16), (-28, -16),
        (36, 0), (-36, 0), (0, 36), (0, -36),
    ]
    sheep_candidates = [
        (5, 0), (-5, 0), (0, 5), (0, -5),
        (4, 4), (-4, 4), (4, -4), (-4, -4),
        (6, 0), (-6, 0), (0, 6), (0, -6),
        (5, 4), (-5, 4), (5, -4), (-5, -4),
        (6, 3), (-6, 3), (3, 6), (3, -6),
    ]

    for ox, oz in offsets:
        cx, cz = base_x + ox, base_z + oz
        if not away_from_villages(cx, cz, boxes):
            continue
        gy = find_ground_y(cx, cz, y_hint, cache)
        if gy is None:
            continue
        # Ensure a flat, dry 5x5 patch around Gus with no leaves overhead
        patch_ok = True
        for dx in range(-2, 3):
            for dz in range(-2, 3):
                ny = find_ground_y(cx + dx, cz + dz, gy, cache)
                if ny is None or abs(ny - gy) > 1:
                    patch_ok = False
                    break
                if cache.get((cx + dx, ny + 3, cz + dz), block(cx + dx, ny + 3, cz + dz)).endswith("_leaves"):
                    patch_ok = False
                    break
            if not patch_ok:
                break
        if not patch_ok:
            continue

        sheep_spots = []
        for sdx, sdz in sheep_candidates:
            dist = math.hypot(sdx, sdz)
            if not (4.0 <= dist <= 8.0):
                continue
            sx, sz = cx + sdx, cz + sdz
            if not away_from_villages(sx, sz, boxes):
                continue
            if any(math.hypot(sx - px, sz - pz) < 3.0 for px, _, pz in sheep_spots):
                continue
            sy = find_ground_y(sx, sz, gy, cache)
            if sy is None or abs(sy - gy) > 2:
                continue
            # Ensure 3x3 dry ground around each sheep and clear line of walk from Gus
            spot_ok = True
            for ddx in range(-1, 2):
                for ddz in range(-1, 2):
                    nsy = find_ground_y(sx + ddx, sz + ddz, sy, cache)
                    if nsy is None or abs(nsy - sy) > 1:
                        spot_ok = False
                        break
                if not spot_ok:
                    break
            if not spot_ok:
                continue
            steps = max(abs(sdx), abs(sdz))
            for k in range(1, steps):
                lx = cx + round(sdx * k / steps)
                lz = cz + round(sdz * k / steps)
                ly = find_ground_y(lx, lz, gy, cache)
                if ly is None or abs(ly - gy) > 2:
                    spot_ok = False
                    break
            if spot_ok:
                sheep_spots.append((sx, sy, sz))
                if len(sheep_spots) == 4:
                    return (cx, gy, gz := cz), sheep_spots
    return None, []


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


def count_entities(selector: str) -> int:
    out = rcon(f"execute if entity {selector}")
    if "failed" in out.lower() or not out:
        return 0
    m = re.search(r"count:?\s*(\d+)", out, re.I)
    if m:
        return int(m.group(1))
    return 1 if "passed" in out.lower() else 0


def server_wool(player: str = "Gus") -> int:
    out = rcon(f"clear {player} #minecraft:wool 0")
    if "no items were found" in out.lower():
        return 0
    m = re.search(r"found (\d+) matching", out, re.I)
    return int(m.group(1)) if m else 0


def cleanup():
    try:
        rcon(f"tp @e[type=minecraft:sheep,tag={TAG}] ~ -200 ~")
        rcon(f"kill @e[type=minecraft:sheep,tag={TAG}]")
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

        # Spawn Gus once at the search centre so chunks are loaded for /api/block ground probes
        sp0 = call("/agents", {
            "name": "Gus",
            "brain": "idle",
            "gamemode": "survival",
            "reset": True,
            "position": {"x": start_x + 0.5, "z": start_z + 0.5},
        })
        if not isinstance(sp0, dict) or sp0.get("error"):
            fail(f"initial Gus spawn failed: {sp0}")
        obs0 = call("/agents/Gus/observe?radius=4")
        pos0 = (obs0.get("position") if isinstance(obs0, dict) else None) or (sp0.get("agent") or {}).get("position") or {}
        base_x = int(math.floor(pos0.get("x", start_x)))
        base_y = int(round(pos0.get("y", 70)))
        base_z = int(math.floor(pos0.get("z", start_z)))

        gus_spot, sheep_spots = find_open_spot(base_x, base_z, base_y, boxes)
        if not gus_spot or len(sheep_spots) < 4:
            # Fallback right where spreadplayers landed Gus
            gy = find_ground_y(base_x, base_z, base_y, {}) or base_y
            gus_spot = (base_x, gy, base_z)
            sheep_spots = []
            for sdx, sdz in ((5, 0), (-5, 0), (0, 5), (0, -5), (5, 5), (-5, 5), (5, -5), (-5, -5)):
                sx, sz = base_x + sdx, base_z + sdz
                sy = find_ground_y(sx, sz, gy, {}) or gy
                sheep_spots.append((sx, sy, sz))
                if len(sheep_spots) == 4:
                    break

        gx, gy, gz = gus_spot
        ground_name = block(gx, gy - 1, gz)
        rcon_probe = rcon(f"execute if block {gx} {gy - 1} {gz} minecraft:{ground_name}")
        if "passed" not in rcon_probe.lower() and ground_name not in ("?", "solid"):
            fail(f"ground probe mismatch at {gx},{gy - 1},{gz}: /api/block={ground_name}, rcon={rcon_probe}")

        # Remove any agent Gus and spawn Gus cleanly at the chosen open, dry spot
        call("/agents/Gus", method="DELETE")
        sp = call("/agents", {
            "name": "Gus",
            "brain": "idle",
            "gamemode": "survival",
            "reset": True,
            "position": {"x": gx + 0.5, "y": gy, "z": gz + 0.5},
        })
        if not isinstance(sp, dict) or sp.get("error"):
            fail(f"could not spawn Gus at {gx},{gy},{gz}: {sp}")

        # Give Gus shears by RCON
        rcon("give Gus minecraft:shears 1")
        time.sleep(0.4)

        # Summon 4 adult, unsheared sheep 4-8 blocks away with our tag (NoAI:1b prevents EatBlockGoal from
        # turning grass_block into dirt and regrowing wool mid-check)
        for sx, sy, sz in sheep_spots:
            rcon(
                f"summon minecraft:sheep {sx + 0.5} {sy} {sz + 0.5} "
                f"{{Age:0,Sheared:0b,NoAI:1b,PersistenceRequired:1b,Tags:[\"{TAG}\"]}}"
            )
        time.sleep(0.8)

        initial_alive = count_entities(f"@e[type=minecraft:sheep,tag={TAG}]")
        if initial_alive != 4:
            fail(f"expected 4 summoned sheep with tag {TAG}, found {initial_alive}")

        # Record the blocks of a box around Gus and the sheep: 2 below ground to 3 above, radius covering where they stand + 6
        all_x = [gx] + [s[0] for s in sheep_spots]
        all_y = [gy - 1] + [s[1] - 1 for s in sheep_spots]
        all_z = [gz] + [s[2] for s in sheep_spots]
        x1, x2 = min(all_x) - 6, max(all_x) + 6
        y1, y2 = min(all_y) - 2, max(all_y) + 4
        z1, z2 = min(all_z) - 6, max(all_z) + 6
        box_before = read_box(x1, y1, z1, x2, y2, z2)

        # Run shear_sheep count=4 through /api/agents/Gus/act
        ev_type1, text1, evs1 = act("shear_sheep", timeout_s=90, count=4)
        if ev_type1 == "timeout":
            fail(f"first shear_sheep call timed out: {text1}")

        # Verification 1: wool on the server >= 3
        wool = server_wool("Gus")
        print(f"verify 1 (server wool): clear Gus #minecraft:wool 0 -> {wool} wool (action: {text1})")
        if wool < 3:
            fail(f"expected >= 3 wool on the server, got {wool} ({text1})")

        # Verification 2: at least 2 of the tagged sheep are sheared
        sheared = count_entities(f"@e[type=minecraft:sheep,tag={TAG},nbt={{Sheared:1b}}]")
        print(f"verify 2 (sheared sheep): {sheared} of 4 tagged sheep have Sheared:1b")
        if sheared < 2:
            fail(f"expected at least 2 tagged sheep sheared, got {sheared}")

        # Verification 3: all 4 tagged sheep still alive
        alive = count_entities(f"@e[type=minecraft:sheep,tag={TAG}]")
        print(f"verify 3 (sheep alive): {alive} of 4 tagged sheep alive")
        if alive != 4:
            fail(f"expected all 4 tagged sheep still alive, got {alive}")

        # Verification 4: no 'broke' or 'placed' event from Gus and no cell of the box changed
        bad_evs = [e for e in evs1 if e.get("type") in ("broke", "placed")]
        box_after = read_box(x1, y1, z1, x2, y2, z2)
        changed = []
        for coord, b_before in box_before.items():
            b_after = box_after.get(coord)
            if b_before != b_after:
                cx, cy, cz = coord
                if b_before not in ("?", "solid") and "passed" in rcon(f"execute if block {cx} {cy} {cz} minecraft:{b_before}").lower():
                    continue
                changed.append((coord, b_before, b_after))
        print(
            f"verify 4 (blocks untouched): {len(bad_evs)} broke/placed events, "
            f"{len(changed)} of {len(box_before)} cells changed in ({x1}..{x2}, {y1}..{y2}, {z1}..{z2})"
        )
        if bad_evs:
            fail(f"Gus emitted broke/placed events during shear_sheep: {bad_evs[:3]}")
        if changed:
            fail(f"{len(changed)} block cells changed during shear_sheep: {changed[:5]}")

        # Verification 5: second call with count=2 after all are sheared must fail or report no shearable sheep left (not hang)
        rcon(f"execute as @e[type=minecraft:sheep,tag={TAG}] run data merge entity @s {{Sheared:1b}}")
        rcon("execute at Gus as @e[type=minecraft:sheep,distance=..48] run data merge entity @s {Sheared:1b}")
        time.sleep(0.5)
        ev_type2, text2, _ = act("shear_sheep", timeout_s=30, count=2)
        print(f"verify 5 (second call when all sheared): {ev_type2} -> {text2}")
        if ev_type2 == "timeout":
            fail("second shear_sheep call hung when all sheep were sheared")
        low2 = text2.lower()
        if ev_type2 != "action_failed" and not ("no shearable" in low2 or "already sheared" in low2 or "0 shearable" in low2):
            fail(f"second shear_sheep call should fail or report no shearable sheep left, got {ev_type2}: {text2}")

        print("SHEAR OK")
    except SystemExit:
        raise
    except Exception as e:
        fail(str(e))
    finally:
        cleanup()


if __name__ == "__main__":
    main()
