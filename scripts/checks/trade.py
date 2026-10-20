"""Live acceptance check for the trade foundry skill (ticket trade, spec_shop_v2).

Reads village B25x2 from GET /api/village/B25x2, finds the first built market_stall initiative and its
merchant cell (x, y+1, z-1), spawns Gus beside the stall in survival mode as a worker of B25x2 and queues
wait 1 immediately, waits up to 3 minutes for the merchant villager to appear, records the surrounding
block box, tests selling 32 birch_log (times=2) for 2 emerald, buying 2 string (times=1) for 1 emerald,
and failing to buy string (times=5) with 1 emerald, and verifies 1 merchant entity, no broke/placed
events, and no block changes in the box.
"""
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
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
    print("TRADE FAILED: MCAI_API environment variable is not set", file=sys.stderr)
    sys.exit(2)

API = RAW_API if RAW_API.endswith("/api") else RAW_API + "/api"
PARSED_API = urllib.parse.urlparse(API)
API_BASE_PATH = PARSED_API.path.rstrip("/")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RCON_SCRIPT = os.path.join(ROOT, "mc", "rcon.py")

_tls = threading.local()


def fail(why: str):
    print(f"TRADE FAILED: {why}")
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
                b = data.get("block") or data.get("type")
                if b and data.get("loaded") is not False:
                    return b
            break
        except Exception:
            try:
                getattr(_tls, "conn", None) and _tls.conn.close()
            except Exception:
                pass
            _tls.conn = None
    res = call(f"/block?x={x}&y={y}&z={z}")
    if isinstance(res, dict) and ("block" in res or "type" in res) and res.get("loaded") is not False:
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
        timeout=20,
    )
    return (p.stdout or "").strip()


def events_since(last_id: int) -> list:
    evs = call("/agents/Gus/events")
    if not isinstance(evs, list):
        return []
    return [e for e in evs if isinstance(e, dict) and e.get("id", 0) > last_id]


def act(action: str, timeout_s: int = 180, **args):
    evs0 = call("/agents/Gus/events")
    last = max([e.get("id", 0) for e in evs0 if isinstance(e, dict)] or [0]) if isinstance(evs0, list) else 0
    res = call("/agents/Gus/act", {"action": action, **args})
    if isinstance(res, dict) and res.get("error"):
        return "action_failed", str(res["error"]), []
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(0.4)
        evs = events_since(last)
        done = [
            e for e in evs
            if e.get("type") in ("action_done", "action_failed")
            and ((e.get("data") or {}).get("type") in (None, action) or str(e.get("text", "")).startswith(f"{action} "))
        ]
        if done:
            return done[-1]["type"], done[-1].get("text", ""), evs
    return "timeout", f"(no result in {timeout_s}s)", events_since(last)


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


def cleanup():
    try:
        call("/agents/Gus", method="DELETE")
    except Exception:
        pass


def main():
    try:
        cleanup()

        v = call("/village/B25x2")
        if not isinstance(v, dict) or v.get("error"):
            fail(f"could not read village B25x2: {v}")

        inits = [
            i for i in (v.get("initiatives") or [])
            if isinstance(i, dict)
            and i.get("kind") == "market_stall"
            and i.get("state") == "built"
            and i.get("x") is not None
            and i.get("y") is not None
            and i.get("z") is not None
        ]
        inits.sort(key=lambda i: i.get("at", 0))
        if not inits:
            fail("no built market_stall initiative in village B25x2")

        stall = inits[0]
        sx, sy, sz = int(stall["x"]), int(stall["y"]), int(stall["z"])
        mx, my, mz = sx, sy + 1, sz - 1

        # Spawn Gus beside the stall as a B25x2 worker so the village tick runs, and right away queue wait 1
        sp = call("/agents", {
            "name": "Gus",
            "brain": "idle",
            "gamemode": "survival",
            "reset": True,
            "position": {"x": mx + 0.5, "y": my, "z": mz - 1 + 0.5},
            "memory": {"village": "B25x2", "villageRole": "worker"},
        })
        if not isinstance(sp, dict) or sp.get("error"):
            fail(f"could not spawn Gus beside market stall at {mx},{my},{mz - 1}: {sp}")

        call("/agents/Gus/act", {"action": "wait", "seconds": 1})
        call("/agents/Gus/act", {"action": "wait", "seconds": 180})

        # Wait up to 3 minutes for the merchant entity to appear
        t_wait = time.time()
        merchant_reply = ""
        while time.time() - t_wait < 180:
            out = rcon("execute if entity @e[type=minecraft:villager,tag=mcai_merchant]")
            if "passed" in out.lower():
                merchant_reply = out
                break
            time.sleep(1.0)
        if not merchant_reply:
            fail("merchant entity (@e[type=minecraft:villager,tag=mcai_merchant]) did not appear within 180s")

        print(f"verify 1 (merchant present): stall at {sx},{sy},{sz}, merchant cell at {mx},{my},{mz} ({merchant_reply})")

        # Record the blocks of a box around the stall (radius 6, ground-2 to ground+4)
        x1, x2 = sx - 6, sx + 6
        y1, y2 = sy - 2, sy + 4
        z1, z2 = sz - 6, sz + 6
        box_before = read_box(x1, y1, z1, x2, y2, z2)

        evs_start = call("/agents/Gus/events")
        start_ev_id = max([e.get("id", 0) for e in evs_start if isinstance(e, dict)] or [0]) if isinstance(evs_start, list) else 0

        # Give Gus 32 birch_log by RCON
        rcon("clear Gus")
        rcon("give Gus minecraft:birch_log 32")
        time.sleep(0.3)
        emeralds_before = server_item_count("Gus", "emerald")
        logs_before = server_item_count("Gus", "birch_log")

        # 1) Sell 32 birch_log (times=2) for 2 emerald
        ev_type1, text1, _ = act("trade", timeout_s=180, item="birch_log", dir="sell", times=2, replace=True)
        call("/agents/Gus/act", {"action": "wait", "seconds": 60})
        logs_after = server_item_count("Gus", "birch_log")
        emeralds_after_sell = server_item_count("Gus", "emerald")
        print(
            f"verify 2 (sell 32 birch_log): {ev_type1} -> {text1} "
            f"(birch_log {logs_before}->{logs_after}, emerald {emeralds_before}->{emeralds_after_sell})"
        )
        if ev_type1 != "action_done":
            fail(f"expected action_done for sell birch_log times=2, got {ev_type1}: {text1}")
        if logs_after != 0 or emeralds_after_sell - emeralds_before != 2:
            fail(
                f"expected 0 birch_log and +2 emerald on server after sell, "
                f"got birch_log={logs_after}, emerald={emeralds_before}->{emeralds_after_sell}"
            )

        # 2) Buy 2 string (times=1) for 1 emerald
        string_before = server_item_count("Gus", "string")
        ev_type2, text2, _ = act("trade", timeout_s=180, item="string", dir="buy", times=1, replace=True)
        call("/agents/Gus/act", {"action": "wait", "seconds": 60})
        string_after = server_item_count("Gus", "string")
        emeralds_after_buy = server_item_count("Gus", "emerald")
        print(
            f"verify 3 (buy 2 string): {ev_type2} -> {text2} "
            f"(string {string_before}->{string_after}, emerald {emeralds_after_sell}->{emeralds_after_buy})"
        )
        if ev_type2 != "action_done":
            fail(f"expected action_done for buy string times=1, got {ev_type2}: {text2}")
        if string_after != 2 or emeralds_after_sell - emeralds_after_buy != 1:
            fail(
                f"expected 2 string and 1 emerald fewer on server after buy, "
                f"got string={string_after}, emerald={emeralds_after_sell}->{emeralds_after_buy}"
            )

        # 3) Buy string times=5 with 1 emerald must fail naming what it has (1) and needs (5)
        ev_type3, text3, _ = act("trade", timeout_s=180, item="string", dir="buy", times=5, replace=True)
        call("/agents/Gus/act", {"action": "wait", "seconds": 60})
        print(f"verify 4 (buy times=5 with 1 emerald fails): {ev_type3} -> {text3}")
        if ev_type3 != "action_failed" or "1" not in text3 or "5" not in text3 or "emerald" not in text3.lower():
            fail(f"expected action_failed saying what it has (1) and needs (5), got {ev_type3}: {text3}")

        # 4) Verify exactly 1 merchant entity exists, no broke/placed event from Gus, and no box cell changed
        ent_out = rcon("execute if entity @e[type=minecraft:villager,tag=mcai_merchant]")
        m_cnt = re.search(r"count:\s*(\d+)", ent_out, re.I)
        merchant_count = int(m_cnt.group(1)) if m_cnt else (1 if "passed" in ent_out.lower() else 0)

        all_evs = events_since(start_ev_id)
        bad_evs = [e for e in all_evs if e.get("type") in ("broke", "placed")]

        box_after = read_box(x1, y1, z1, x2, y2, z2)
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
            f"verify 5 (world intact): merchant count={merchant_count} ({ent_out}), "
            f"{len(bad_evs)} broke/placed events, {len(changed)} of {len(box_before)} cells changed"
        )
        if merchant_count != 1:
            fail(f"expected exactly 1 merchant entity, got {merchant_count} ({ent_out})")
        if bad_evs:
            fail(f"Gus emitted broke/placed events during trade: {bad_evs[:3]}")
        if changed:
            fail(f"{len(changed)} block cells changed around stall: {changed[:5]}")

        print("TRADE OK")
    except SystemExit:
        raise
    except Exception as e:
        fail(str(e))
    finally:
        cleanup()


if __name__ == "__main__":
    main()
