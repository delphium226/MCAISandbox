"""Live check for #204: a member walking home across a river lands or is rescued within a few stalls.

In fix202's runs 5-6 (minevale3, checkpoint t12_zyt202, village P1) members who gathered sand on the far bank of the
river east of P1 swam in place at about -1496,62,63 for 20-30 `[stuck]` lines each and never landed: the pathfinder
planned their way home along the river bed, under water, where a swimming bot never gets. This spawns one P1 member
(idle brain) in each start spot (the far bank, the water by it, mid-river), gives it sand and has it `deposit` (the walk
home that stalled), and in a shallow channel by the shore has it `collect` sand from the bank (the sand-trips run's
shore digs, #204's second case: three 25 s timeouts in the water), then counts its `[stuck]`, `[repath]`, `[swim]` and `[rescue]` lines in the agent server's log.

Usage (test world 2, after `reset_site.py minevale3 --checkpoint t12_zyt202`):
  MCAI_API=http://127.0.0.1:8768/api MC_SERVER_DIR=mc/testserver2 python scripts/checks/river_swim.py LOG [--village P1]
      [--name Ada] [--spots bank,water,mid,shore] [--minutes 6] [--max-stuck 4]
LOG is the test agent server's log (runs/<date>/testagents-w2-<time>.log). Passes when every spot's deposit finished
(the sand is in storage), and the shore's collect finished, with at most --max-stuck `[stuck]` lines, or the member was rescued within that many.
"""
import argparse, json, os, re, subprocess, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
API = os.environ.get("MCAI_API", "http://127.0.0.1:8768/api").rstrip("/")
# Start spots (x, y, z) and what the member does there: by the river, the east bank where the sand was, the water just off
# it and the middle of the river (deposit, the walk home); a seagrass channel between two sand banks (collect from the bank)
SPOTS = {"bank": (-1488.5, 63, 63.5), "water": (-1496.5, 62.2, 63.5), "mid": (-1512.5, 62.2, 63.5), "shore": (-1724.5, 62.2, -15.5)}
ACTS = {"shore": {"action": "collect", "block": "sand", "count": 6}}


def call(path, body=None, method=None, timeout=60):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {"error": f"{e.code} {e.read()[:200]!r}"}


def rcon(*cmds):
    out = subprocess.run([sys.executable, os.path.join(ROOT, "mc", "rcon.py"), *cmds], capture_output=True, text=True, timeout=30)
    return out.stdout.strip()


def carried(name, item):
    """How many of an item the server says the player holds (`clear` with count 0 counts without taking)."""
    m = re.search(r"(\d+)", rcon(f"clear {name} {item} 0"))
    return int(m.group(1)) if m and "No items" not in m.group(0) else 0


def run_spot(args, spot, log):
    x, y, z = SPOTS[spot]
    name = args.name
    call(f"/agents/{name}", method="DELETE")
    time.sleep(2)
    r = call("/agents", {"name": name, "role": "builder", "brain": "idle", "gamemode": "survival", "reset": True,
                         "position": {"x": x, "z": z}, "memory": {"village": args.village}})
    if "error" in r:
        sys.exit(f"RIVER_SWIM FAILED: spawn {name}: {r['error']}")
    for _ in range(60):
        a = next((q for q in call("/agents") or [] if isinstance(q, dict) and q.get("name") == name), None)
        if a and a.get("position"):
            break
        time.sleep(1)
    rcon(f"tp {name} {x} {y} {z}", f"clear {name}", f"give {name} sand 40")
    time.sleep(2)
    off = os.path.getsize(log)
    t0 = time.time()
    act = ACTS.get(spot, {"action": "deposit", "item": "sand"})
    st = call(f"/agents/{name}/act", act)
    state, msg = "running", ""
    while time.time() - t0 < args.minutes * 60:
        time.sleep(3)
        acts = call(f"/agents/{name}/actions")
        done = next((h for h in reversed(acts.get("history") or []) if h.get("id") == st.get("id")), None)
        if done:
            state, msg = done.get("state"), done.get("message") or ""
            break
    secs = time.time() - t0
    left = carried(name, "sand")
    with open(log, encoding="utf-8", errors="replace") as f:
        f.seek(off)
        lines = [l for l in f.read().splitlines() if re.match(rf"\[\w[\w-]*\] {name}\b", l)]
    count = {k: sum(1 for l in lines if l.startswith(f"[{k}] ")) for k in ("stuck", "repath", "swim", "rescue")}
    for l in lines:
        if re.match(r"\[(swim|rescue)\] ", l) or l.startswith("[stuck] "):
            print("   ", l[:260])
    rescued = count["rescue"] > 0
    # (deposit: the sand reached storage; collect: it finished)
    ok = count["stuck"] <= args.max_stuck and (state == "done" and (left == 0 or act["action"] != "deposit") or rescued)
    print(f"{spot}: {state} in {secs:.0f} s, sand left {left}; stuck {count['stuck']}, repath {count['repath']}, swim {count['swim']}, "
          f"rescue {count['rescue']} -> {'ok' if ok else 'FAIL'}; {msg[:200]}", flush=True)
    if state == "running":
        call(f"/agents/{name}/stop", {})
    return ok, count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("log")
    ap.add_argument("--village", default="P1")
    ap.add_argument("--name", default="Ada")
    ap.add_argument("--spots", default="bank,water,mid,shore")
    ap.add_argument("--minutes", type=float, default=6)
    ap.add_argument("--max-stuck", type=int, default=4)
    args = ap.parse_args()
    results = [run_spot(args, s, args.log) for s in args.spots.split(",")]
    call(f"/agents/{args.name}", method="DELETE")
    total = {k: sum(c[k] for _, c in results) for k in results[0][1]}
    print(f"total: {', '.join(f'{k} {v}' for k, v in total.items())}")
    print("RIVER_SWIM PASSED" if all(ok for ok, _ in results) else "RIVER_SWIM FAILED")
    sys.exit(0 if all(ok for ok, _ in results) else 1)


if __name__ == "__main__":
    main()
