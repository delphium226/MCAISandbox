"""Live acceptance check for the harvest_amethyst foundry skill (ticket amethyst).

Finds open, dry, level ground near the test site's centre (-1563, -36 on minevale3) away from any village plot,
builds a small geode by RCON 10 blocks below the ground there, 6 blocks horizontally from Gus's spot:
fill a 7x7x7 cube of smooth_basalt, then a 5x5x5 of calcite inside it, then a 3x3x3 of amethyst_block inside that,
then hollow its centre (the single middle cell, air), and set one cell of the lining to budding_amethyst and put
2 amethyst_cluster in the hollow's air against the lining (setblock with facing away from the lining it stands on);
spawns Gus on the ground in survival mode with 1 stone_pickaxe; records the surrounding block box and corridor;
runs harvest_amethyst with x, y, z of one amethyst_cluster and count 2; and verifies:
1. at least 2 amethyst shard more on the server for Gus;
2. the budding_amethyst is still there;
3. no 'placed' event from Gus;
4. no cell of the big box changed outside the corridor and the geode;
5. Gus stands within 3 blocks of the ground's height (it climbed out);
6. a second call with x, y, z of a amethyst_cluster cell now mined fails or reports none left within 3 minutes;
7. after clearing Gus's pickaxes by RCON, a third call fails with a message containing 'no pickaxe'.
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
    print("AMETHYST FAILED: MCAI_API environment variable is not set", file=sys.stderr)
    sys.exit(2)

API = RAW_API if RAW_API.endswith("/api") else RAW_API + "/api"
PARSED_API = urllib.parse.urlparse(API)
API_BASE_PATH = PARSED_API.path.rstrip("/")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RCON_SCRIPT = os.path.join(ROOT, "mc", "rcon.py")

CENTRE_X = int(sys.argv[1]) if len(sys.argv) > 2 else -1563
CENTRE_Z = int(sys.argv[2]) if len(sys.argv) > 2 else -36

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
    print(f"AMETHYST FAILED: {why}")
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
    return "solid"


def rcon(cmd: str) -> str:
    p = subprocess.run(
        [sys.executable, RCON_SCRIPT, cmd],
        cwd=ROOT,
        env=os.environ.copy(),
        capture_output=True,
        text=True,
        timeout=25,
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
            d = done[-1]
            return d.get("type"), d.get("message") or d.get("text") or "", evs
    return "timeout", f"action {action} timed out after {timeout_s}s", events_since(last)


def village_boxes() -> list:
    vs = call("/village")
    if not isinstance(vs, list):
        return []
    boxes = []
    for v in vs:
        if not isinstance(v, dict):
            continue
        for p in v.get("plots", []):
            if isinstance(p, dict):
                boxes.append((p.get("x1", 0), p.get("z1", 0), p.get("x2", 0), p.get("z2", 0)))
        for s in v.get("structures", []):
            if isinstance(s, dict):
                boxes.append((s.get("x1", 0), s.get("z1", 0), s.get("x2", 0), s.get("z2", 0)))
        for l in v.get("layouts", []):
            if isinstance(l, dict):
                boxes.append((l.get("x1", 0), l.get("z1", 0), l.get("x2", 0), l.get("z2", 0)))
    return boxes


def away_from_villages(x: int, z: int, boxes: list, margin: int = 12) -> bool:
    for x1, z1, x2, z2 in boxes:
        if x >= min(x1, x2) - margin and x <= max(x1, x2) + margin and z >= min(z1, z2) - margin and z <= max(z1, z2) + margin:
            return False
    return True


def is_solid_dry_ground(name: str) -> bool:
    if not name or name in ("?", "solid"):
        return True
    return name not in PASSABLE and name not in BAD_GROUND and "leaves" not in name and "log" not in name


def find_ground_y(x: int, z: int, y_hint: int, cache: dict) -> int | None:
    def get_b(xx, yy, zz):
        k = (xx, yy, zz)
        if k not in cache:
            cache[k] = block(xx, yy, zz)
        return cache[k]

    for dy in range(10, -14, -1):
        y = y_hint + dy
        below = get_b(x, y - 1, z)
        if not is_solid_dry_ground(below):
            continue
        if all(get_b(x, y + up, z) in PASSABLE for up in range(0, 4)):
            return y
    return None


def column_stand_y(x: int, z: int, y_top: int, y_bottom: int) -> int | None:
    """The height one stands at on the highest solid block of the column (x, z), scanned down from y_top to y_bottom.
    Trees, plants, water and unknown cells do not count, so a bot in a tunnel reads the ground above its head."""
    cells = read_box_blocks(x, y_bottom, z, x, y_top, z)
    for y in range(y_top, y_bottom - 1, -1):
        name = cells.get((x, y, z)) or "?"
        if name == "?" or name in PASSABLE or name in BAD_GROUND:
            continue
        if any(w in name for w in ("leaves", "log", "vine", "torch", "wood")):
            continue
        return y + 1
    return None


def climb_out_diff(pos: dict, ref_y: int) -> tuple:
    """(Gus's y, the stand height over Gus's own column, their difference) for a climb-out verification."""
    gus_y = float(pos.get("y", 0))
    x, z = int(math.floor(pos.get("x", 0))), int(math.floor(pos.get("z", 0)))
    top = max(int(math.floor(gus_y)), ref_y) + 30
    stand = column_stand_y(x, z, top, int(math.floor(gus_y)) - 4)
    if stand is None:
        stand = ref_y
    return gus_y, stand, abs(gus_y - stand)


def find_level_open_spot(base_x: int, base_z: int, y_hint: int, boxes: list):
    cache = {}

    def get_b(xx, yy, zz):
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
    ]

    for ox, oz in offsets:
        gx, gz = base_x + ox, base_z + oz
        if not away_from_villages(gx, gz, boxes, 14) or not away_from_villages(gx + 6, gz, boxes, 14):
            continue
        gy = find_ground_y(gx, gz, y_hint, cache)
        if gy is None:
            continue
        patch_ok = True
        for dx in range(-2, 8):
            for dz in range(-3, 4):
                ny = find_ground_y(gx + dx, gz + dz, gy, cache)
                if ny is None or abs(ny - gy) > 1:
                    patch_ok = False
                    break
                for up in range(0, 4):
                    if get_b(gx + dx, gy + up, gz + dz) not in PASSABLE:
                        patch_ok = False
                        break
            if not patch_ok:
                break
        if patch_ok:
            return gx, gy, gz
    return None


def read_box_blocks(x1: int, y1: int, z1: int, x2: int, y2: int, z2: int) -> dict:
    res = call(f"/blocks?x1={x1}&y1={y1}&z1={z1}&x2={x2}&y2={y2}&z2={z2}")
    if isinstance(res, dict) and "names" in res and "cells" in res:
        names = res["names"]
        cells = res["cells"]
        out = {}
        idx = 0
        for y in range(y1, y2 + 1):
            for z in range(z1, z2 + 1):
                for x in range(x1, x2 + 1):
                    c_idx = cells[idx] if idx < len(cells) else -1
                    out[(x, y, z)] = names[c_idx] if c_idx >= 0 and c_idx < len(names) else "?"
                    idx += 1
        return out

    coords = [(x, y, z) for x in range(x1, x2 + 1) for z in range(z1, z2 + 1) for y in range(y1, y2 + 1)]
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
            picked = next(((x, z) for x, z in cand if away_from_villages(x, z, boxes, 14)), None)
            if picked:
                start_x, start_z = picked
                break

        # Spawn Gus briefly to load chunks for ground probing
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

        call("/agents/Gus", method="DELETE")
        time.sleep(0.4)

        # Build a small geode by RCON 10 blocks below the ground there, 6 blocks horizontally from Gus's spot:
        # Geode centre: (cx, cy, cz)
        cx = gx + 6
        cz = gz
        cy = ground_y - 10

        # 1) fill a 7x7x7 cube of smooth_basalt
        rcon(f"fill {cx - 3} {cy - 3} {cz - 3} {cx + 3} {cy + 3} {cz + 3} minecraft:smooth_basalt")
        # 2) then a 5x5x5 of calcite inside it
        rcon(f"fill {cx - 2} {cy - 2} {cz - 2} {cx + 2} {cy + 2} {cz + 2} minecraft:calcite")
        # 3) then a 3x3x3 of amethyst_block inside that
        rcon(f"fill {cx - 1} {cy - 1} {cz - 1} {cx + 1} {cy + 1} {cz + 1} minecraft:amethyst_block")
        # 4) then hollow its centre (the single middle cell, air)
        rcon(f"setblock {cx} {cy} {cz} minecraft:air")
        # 5) and set one cell of the lining to budding_amethyst
        bud_x, bud_y, bud_z = cx, cy - 1, cz
        rcon(f"setblock {bud_x} {bud_y} {bud_z} minecraft:budding_amethyst")
        # 6) and put amethyst_cluster in the hollow's air against the lining (setblock with facing away from lining)
        cl1_x, cl1_y, cl1_z = cx, cy, cz
        rcon(f"setblock {cl1_x} {cl1_y} {cl1_z} minecraft:amethyst_cluster[facing=up]")

        chk_bud_init = rcon(f"execute if block {bud_x} {bud_y} {bud_z} minecraft:budding_amethyst")
        if "passed" not in chk_bud_init.lower():
            fail(f"failed to setblock budding_amethyst at {bud_x},{bud_y},{bud_z}: {chk_bud_init}")
        chk_cl1_init = rcon(f"execute if block {cl1_x} {cl1_y} {cl1_z} minecraft:amethyst_cluster")
        if "passed" not in chk_cl1_init.lower():
            fail(f"failed to setblock amethyst_cluster at {cl1_x},{cl1_y},{cl1_z}: {chk_cl1_init}")

        # Spawn Gus on the ground (brain idle, gamemode survival, reset true)
        sp = call("/agents", {
            "name": "Gus",
            "brain": "idle",
            "gamemode": "survival",
            "reset": True,
            "position": {"x": gx + 0.5, "y": gy, "z": gz + 0.5},
        })
        if not isinstance(sp, dict) or sp.get("error"):
            fail(f"could not spawn Gus at {gx},{gy},{gz}: {sp}")

        # Give Gus 1 stone_pickaxe by RCON
        rcon("give Gus minecraft:stone_pickaxe 1")
        time.sleep(0.5)

        # Record the blocks of a box covering the geode and Gus's spot, plus 4 on every side,
        # and of the corridor (the box between Gus's spot and the geode, both included, widened by 1)
        geo_x1, geo_x2 = cx - 3, cx + 3
        geo_y1, geo_y2 = cy - 3, cy + 3
        geo_z1, geo_z2 = cz - 3, cz + 3

        box_x1 = min(gx, geo_x1) - 4
        box_x2 = max(gx, geo_x2) + 4
        box_y1 = min(gy, geo_y1) - 4
        box_y2 = max(gy, geo_y2) + 4
        box_z1 = min(gz, geo_z1) - 4
        box_z2 = max(gz, geo_z2) + 4

        corr_x1 = min(gx, geo_x1) - 1
        corr_x2 = max(gx, geo_x2) + 1
        corr_y1 = min(gy, geo_y1) - 1
        corr_y2 = max(gy, geo_y2) + 1
        corr_z1 = min(gz, geo_z1) - 1
        corr_z2 = max(gz, geo_z2) + 1

        box_before = read_box_blocks(box_x1, box_y1, box_z1, box_x2, box_y2, box_z2)

        shards_before = server_item_count("Gus", "amethyst_shard")

        # Run harvest_amethyst with x, y, z of one amethyst_cluster and count 2 through /api/agents/Gus/act
        ev_type1, text1, evs1 = act("harvest_amethyst", timeout_s=360, x=cl1_x, y=cl1_y, z=cl1_z, count=2)
        if ev_type1 == "timeout":
            fail(f"first harvest_amethyst call timed out after 360s: {text1}")

        # Verification 1: at least 2 amethyst shard more on the server for Gus
        shards_after = server_item_count("Gus", "amethyst_shard")
        gained = shards_after - shards_before
        print(f"verify 1 (server amethyst shards): gained {gained} shards (before={shards_before}, after={shards_after}, event={ev_type1}, msg={text1})")
        if gained < 2:
            fail(f"expected at least 2 amethyst shard on server for Gus, got {gained} ({ev_type1}: {text1})")
        # (#93: a harvest that gained its shards must say so: a member's chore is judged by the event, not the server's count)
        if ev_type1 != "action_done":
            fail(f"the first call gained {gained} shards but ended {ev_type1}: {text1}")

        # Verification 2: the budding_amethyst is still there
        chk_bud_after = rcon(f"execute if block {bud_x} {bud_y} {bud_z} minecraft:budding_amethyst")
        bud_intact = "passed" in chk_bud_after.lower()
        print(f"verify 2 (budding amethyst preserved): budding_amethyst at {bud_x},{bud_y},{bud_z} intact={bud_intact}")
        if not bud_intact:
            fail(f"budding_amethyst at {bud_x},{bud_y},{bud_z} was broken! ({chk_bud_after})")

        # Verification 3: no 'placed' event from Gus
        placed_evs = [e for e in evs1 if e.get("type") == "placed"]
        print(f"verify 3 (no placed events): {len(placed_evs)} placed events from Gus")
        if placed_evs:
            fail(f"Gus emitted 'placed' events during harvest_amethyst: {placed_evs[:3]}")

        # Verification 4: no cell of the big box changed outside the corridor and the geode
        box_after = read_box_blocks(box_x1, box_y1, box_z1, box_x2, box_y2, box_z2)
        changed_outside = []
        for coord, b_before in box_before.items():
            b_after = box_after.get(coord)
            if b_before != b_after:
                x, y, z = coord
                in_corridor = (corr_x1 <= x <= corr_x2 and corr_y1 <= y <= corr_y2 and corr_z1 <= z <= corr_z2)
                in_geode = (geo_x1 <= x <= geo_x2 and geo_y1 <= y <= geo_y2 and geo_z1 <= z <= geo_z2)
                if not in_corridor and not in_geode:
                    if {b_before, b_after} <= {"grass_block", "dirt"}:
                        continue
                    changed_outside.append((coord, b_before, b_after))
        print(f"verify 4 (box unchanged outside corridor/geode): {len(changed_outside)} cells changed outside corridor and geode")
        if changed_outside:
            fail(f"{len(changed_outside)} block cells changed outside corridor and geode: {changed_outside[:5]}")

        # Verification 5: Gus stands within 3 blocks of the ground's height (it climbed out)
        time.sleep(0.5)
        obs1 = call("/agents/Gus/observe?radius=4")
        pos1 = (obs1.get("position") if isinstance(obs1, dict) else None) or {}
        if not pos1:
            fail("case 1: Gus's position could not be read after the run")
        # (measured at Gus's own x, z: the highest solid block in its column, scanned from 30 above, so a tunnel reads
        # the ground over its head; the spawn's ground only if nothing solid is found)
        gus_y, gy, y_diff = climb_out_diff(pos1, gy)
        print(f"verify 5 (Gus climbed out): Gus y={gus_y:.2f}, ground gy={gy} (diff={y_diff:.2f})")
        if y_diff > 3.0:
            fail(f"Gus did not climb out to within 3 blocks of ground height: Gus y={gus_y}, ground y={gy} (diff={y_diff:.2f})")

        # Verification 6: a second call with x, y, z of a amethyst_cluster cell now mined must fail or report none left, within 3 minutes
        ev_type2, text2, _ = act("harvest_amethyst", timeout_s=180, x=cl1_x, y=cl1_y, z=cl1_z, count=1)
        print(f"verify 6 (second call with mined cluster cell): {ev_type2} -> {text2}")
        if ev_type2 == "timeout":
            fail("second harvest_amethyst call timed out after 180s")
        low2 = text2.lower()
        if ev_type2 != "action_failed" and not any(w in low2 for w in ("none", "no amethyst cluster", "already mined", "0 amethyst shard", "explore")):
            fail(f"expected second call with mined cluster to fail or report none left, got {ev_type2}: {text2}")

        # Verification 7: clear Gus's pickaxes by RCON, and a third call must fail with a message containing 'no pickaxe'
        rcon("clear Gus #minecraft:pickaxes")
        for p in ("stone_pickaxe", "wooden_pickaxe", "iron_pickaxe", "diamond_pickaxe", "netherite_pickaxe", "golden_pickaxe"):
            rcon(f"clear Gus minecraft:{p}")
        time.sleep(0.4)

        ev_type3, text3, _ = act("harvest_amethyst", timeout_s=60, count=1)
        print(f"verify 7 (third call without pickaxe): {ev_type3} -> {text3}")
        if ev_type3 != "action_failed" or "no pickaxe" not in text3.lower():
            fail(f"expected action_failed with message containing 'no pickaxe', got {ev_type3}: {text3}")

        # Reset Case 1's area by RCON fill
        rcon(f"fill {cx - 3} {cy - 3} {cz - 3} {cx + 3} {cy + 3} {cz + 3} minecraft:stone")
        rcon(f"fill {corr_x1} {corr_y1} {corr_z1} {corr_x2} {ground_y - 1} {corr_z2} minecraft:stone replace minecraft:air")
        rcon(f"fill {corr_x1} {ground_y} {corr_z1} {corr_x2} {ground_y} {corr_z2} minecraft:dirt replace minecraft:air")
        box_case1_end = read_box_blocks(corr_x1, corr_y1, corr_z1, corr_x2, corr_y2, corr_z2)
        for coord, b_orig in box_before.items():
            x, y, z = coord
            if corr_x1 <= x <= corr_x2 and corr_y1 <= y <= corr_y2 and corr_z1 <= z <= corr_z2:
                in_geode = (geo_x1 <= x <= geo_x2 and geo_y1 <= y <= geo_y2 and geo_z1 <= z <= geo_z2)
                if not in_geode and box_case1_end.get(coord) != b_orig:
                    b_cmd = b_orig if ":" in b_orig else f"minecraft:{b_orig}"
                    rcon(f"setblock {x} {y} {z} {b_cmd}")

        # Case 2: build a second geode 16 blocks below the ground at a spot where the ground is at least 2 blocks higher than the spot 6 blocks away (slope)
        slope_spot = None
        cand_cache = {}
        for ox in range(-32, 33, 4):
            for oz in range(-32, 33, 4):
                if math.hypot(ox, oz) > 32:
                    continue
                sx, sz = base_x + ox, base_z + oz
                if not away_from_villages(sx, sz, boxes, 14) or not away_from_villages(sx + 6, sz, boxes, 14):
                    continue
                sy = find_ground_y(sx, sz, base_y, cand_cache)
                if sy is None:
                    continue
                sy6 = find_ground_y(sx + 6, sz, sy, cand_cache)
                if sy6 is None:
                    continue
                if sy6 - sy >= 2:
                    slope_spot = (sx, sy, sz, sx + 6, sz, sy6 - 1)
                    break
                elif sy - sy6 >= 2:
                    slope_spot = (sx + 6, sy6, sz, sx, sz, sy - 1)
                    break
            if slope_spot:
                break

        if slope_spot:
            gx2, gy2, gz2, cx2, cz2, ground_y2 = slope_spot
            # (ground_y2 derived from geode column's ground)
        else:
            # Pick a fresh spot 24 blocks away
            spot2 = find_level_open_spot(base_x + 24, base_z, base_y, boxes)
            if spot2 is None:
                gy2_cand = find_ground_y(base_x + 24, base_z, base_y, {}) or base_y
                spot2 = (base_x + 24, gy2_cand, base_z)
            gx2, gy2, gz2 = spot2
            cx2 = gx2 + 6
            cz2 = gz2
            # (ground_y2 derived from geode column's ground)
            # Build a 3-high dirt mound over the geode's column by RCON before the run so the climb starts below raised ground
            cy_geo2 = find_ground_y(cx2, cz2, gy2, {}) or gy2
            rcon(f"fill {cx2 - 1} {cy_geo2} {cz2 - 1} {cx2 + 1} {cy_geo2 + 2} {cz2 + 1} minecraft:dirt")
            ground_y2 = cy_geo2 + 2

        # Build geode 2 by RCON 16 blocks below the ground
        cy2 = ground_y2 - 16
        rcon(f"fill {cx2 - 3} {cy2 - 3} {cz2 - 3} {cx2 + 3} {cy2 + 3} {cz2 + 3} minecraft:smooth_basalt")
        rcon(f"fill {cx2 - 2} {cy2 - 2} {cz2 - 2} {cx2 + 2} {cy2 + 2} {cz2 + 2} minecraft:calcite")
        rcon(f"fill {cx2 - 1} {cy2 - 1} {cz2 - 1} {cx2 + 1} {cy2 + 1} {cz2 + 1} minecraft:amethyst_block")
        rcon(f"setblock {cx2} {cy2} {cz2} minecraft:air")
        bud2_x, bud2_y, bud2_z = cx2, cy2 - 1, cz2
        rcon(f"setblock {bud2_x} {bud2_y} {bud2_z} minecraft:budding_amethyst")
        cl2_x, cl2_y, cl2_z = cx2, cy2, cz2
        rcon(f"setblock {cl2_x} {cl2_y} {cl2_z} minecraft:amethyst_cluster[facing=up]")

        chk_bud2_init = rcon(f"execute if block {bud2_x} {bud2_y} {bud2_z} minecraft:budding_amethyst")
        if "passed" not in chk_bud2_init.lower():
            fail(f"case 2 failed to setblock budding_amethyst at {bud2_x},{bud2_y},{bud2_z}: {chk_bud2_init}")
        chk_cl2_init = rcon(f"execute if block {cl2_x} {cl2_y} {cl2_z} minecraft:amethyst_cluster")
        if "passed" not in chk_cl2_init.lower():
            fail(f"case 2 failed to setblock amethyst_cluster at {cl2_x},{cl2_y},{cl2_z}: {chk_cl2_init}")

        # Delete Gus from case 1 before spawning for case 2
        call("/agents/Gus", method="DELETE")
        time.sleep(0.4)

        # Spawn Gus on the ground for case 2
        sp2 = call("/agents", {
            "name": "Gus",
            "brain": "idle",
            "gamemode": "survival",
            "reset": True,
            "position": {"x": gx2 + 0.5, "y": gy2, "z": gz2 + 0.5},
        })
        if not isinstance(sp2, dict) or sp2.get("error"):
            fail(f"could not spawn Gus at {gx2},{gy2},{gz2} for case 2: {sp2}")

        # Give Gus 1 stone_pickaxe by RCON
        rcon("give Gus minecraft:stone_pickaxe 1")
        time.sleep(0.5)

        geo2_x1, geo2_x2 = cx2 - 3, cx2 + 3
        geo2_y1, geo2_y2 = cy2 - 3, cy2 + 3
        geo2_z1, geo2_z2 = cz2 - 3, cz2 + 3

        box2_x1 = min(gx2, geo2_x1) - 4
        box2_x2 = max(gx2, geo2_x2) + 4
        box2_y1 = min(gy2, geo2_y1) - 4
        box2_y2 = max(gy2, geo2_y2, gy2 + 5) + 4
        box2_z1 = min(gz2, geo2_z1) - 4
        box2_z2 = max(gz2, geo2_z2) + 4

        corr2_x1 = min(gx2, geo2_x1) - 1
        corr2_x2 = max(gx2, geo2_x2) + 1
        corr2_y1 = min(gy2, geo2_y1) - 1
        corr2_y2 = max(gy2, geo2_y2, gy2 + 5) + 1
        corr2_z1 = min(gz2, geo2_z1) - 1
        corr2_z2 = max(gz2, geo2_z2) + 1

        box2_before = read_box_blocks(box2_x1, box2_y1, box2_z1, box2_x2, box2_y2, box2_z2)
        shards_before2 = server_item_count("Gus", "amethyst_shard")

        # Run harvest_amethyst for case 2
        ev_type4, text4, evs4 = act("harvest_amethyst", timeout_s=360, x=cl2_x, y=cl2_y, z=cl2_z, count=2)
        if ev_type4 == "timeout":
            fail(f"case 2 harvest_amethyst call timed out after 360s: {text4}")

        # Verification 8: at least 2 amethyst shard more on the server for Gus
        shards_after2 = server_item_count("Gus", "amethyst_shard")
        gained2 = shards_after2 - shards_before2
        print(f"verify 8 (case 2 server amethyst shards): gained {gained2} shards (before={shards_before2}, after={shards_after2}, event={ev_type4}, msg={text4})")
        if gained2 < 2:
            fail(f"expected at least 2 amethyst shard on server for Gus in case 2, got {gained2} ({ev_type4}: {text4})")
        if ev_type4 != "action_done":
            fail(f"case 2 call gained {gained2} shards but ended {ev_type4}: {text4}")

        # Verification 9: the budding_amethyst is still there
        chk_bud2_after = rcon(f"execute if block {bud2_x} {bud2_y} {bud2_z} minecraft:budding_amethyst")
        bud2_intact = "passed" in chk_bud2_after.lower()
        print(f"verify 9 (case 2 budding amethyst preserved): budding_amethyst at {bud2_x},{bud2_y},{bud2_z} intact={bud2_intact}")
        if not bud2_intact:
            fail(f"case 2 budding_amethyst at {bud2_x},{bud2_y},{bud2_z} was broken! ({chk_bud2_after})")

        # Verification 10: no 'placed' event from Gus
        placed_evs2 = [e for e in evs4 if e.get("type") == "placed"]
        print(f"verify 10 (case 2 no placed events): {len(placed_evs2)} placed events from Gus")
        if placed_evs2:
            fail(f"Gus emitted 'placed' events during case 2 harvest_amethyst: {placed_evs2[:3]}")

        # Verification 11: no cell of the big box changed outside the corridor and the geode
        box2_after = read_box_blocks(box2_x1, box2_y1, box2_z1, box2_x2, box2_y2, box2_z2)
        changed_outside2 = []
        for coord, b_before in box2_before.items():
            b_after = box2_after.get(coord)
            if b_before != b_after:
                x, y, z = coord
                in_corridor = (corr2_x1 <= x <= corr2_x2 and corr2_y1 <= y <= corr2_y2 and corr2_z1 <= z <= corr2_z2)
                in_geode = (geo2_x1 <= x <= geo2_x2 and geo2_y1 <= y <= geo2_y2 and geo2_z1 <= z <= geo2_z2)
                if not in_corridor and not in_geode:
                    if {b_before, b_after} <= {"grass_block", "dirt"}:
                        continue
                    changed_outside2.append((coord, b_before, b_after))
        print(f"verify 11 (case 2 box unchanged outside corridor/geode): {len(changed_outside2)} cells changed outside corridor and geode")
        if changed_outside2:
            fail(f"{len(changed_outside2)} block cells changed outside corridor and geode in case 2: {changed_outside2[:5]}")

        # Verification 12: Gus stands within 3 blocks of the ground's height (it climbed out)
        time.sleep(0.5)
        obs2 = call("/agents/Gus/observe?radius=4")
        pos2 = (obs2.get("position") if isinstance(obs2, dict) else None) or {}
        if not pos2:
            fail("case 2: Gus's position could not be read after the run")
        # (as case 1: the highest solid block in Gus's own column, scanned from 30 above the ground)
        gus2_y, target_g2, y_diff2 = climb_out_diff(pos2, max(gy2, ground_y2 + 1))
        print(f"verify 12 (case 2 Gus climbed out): Gus y={gus2_y:.2f}, ground gy={target_g2} (diff={y_diff2:.2f})")
        if y_diff2 > 3.0:
            fail(f"case 2 Gus did not climb out to within 3 blocks of ground height: Gus y={gus2_y}, ground y={target_g2} (diff={y_diff2:.2f})")

        print("AMETHYST OK")
    except SystemExit:
        raise
    except Exception as e:
        fail(str(e))
    finally:
        cleanup()


if __name__ == "__main__":
    main()
