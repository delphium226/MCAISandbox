"""Live check for #209: a member pinned in the storage hut is rescued to a cell outside it, not back onto its own cell.

In train 18's I1 (minevale3, village P1) Xavier stood on the hut's floor by the furnace with every walk "path empty",
and each rescue teleported him "to the storage hut" at the cell he was stuck in: 49 rescues, 122 `[stuck]`. (The cause
of the empty paths was the pathfinder's step back to a placed block's node, kept after a fall: patched in
mineflayer-pathfinder, #209.) This spawns one P1 member (idle brain) on the rescue's home cell in the hut's aisle
(x1+3, the chests' y, z2-1, beside the furnace corner), walls that cell in with glass (only where there is air, so its
walks stall in place), has it `move_to` a point outside the village, and reads its `[rescue]` lines in the agent server's
log. Then it takes the glass away, puts the member back on that cell and walks it out again: the path from the hut floor
must be found (#209's second half).

Usage (test world 2, after `reset_site.py minevale3 --checkpoint t12_pad_open`):
  MCAI_API=http://127.0.0.1:8768/api MC_SERVER_DIR=mc/testserver2 python scripts/checks/hut_rescue.py LOG
      [--village P1] [--name Ada] [--minutes 5] [--to X,Y,Z]
LOG is the test agent server's log. Passes when a rescue fired, every rescue landed more than 2.5 blocks from the home
cell and outside the hut, none landed on the cell it rescued from, and the walk out from the hut floor finished with no
`[underground] ... found no way out` line.
"""
import argparse, json, os, re, subprocess, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
API = os.environ.get("MCAI_API", "http://127.0.0.1:8768/api").rstrip("/")


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


def village(name):
    """The village's record from the server dir's villages.json (beside the world)."""
    d = os.environ.get("MC_SERVER_DIR", "mc/testserver2")
    for f in (os.path.join(ROOT, d, "villages.json"), os.path.join(ROOT, d, "data", "villages.json")):
        if os.path.exists(f):
            j = json.load(open(f, encoding="utf-8"))
            vs = j.get("villages", j) if isinstance(j, dict) else j
            for v in (vs.values() if isinstance(vs, dict) else vs):
                if isinstance(v, dict) and v.get("name") == name:
                    return v
    sys.exit(f"HUT_RESCUE FAILED: no village {name} in {d}'s villages.json")


def wait_spawned(name):
    for _ in range(60):
        a = next((q for q in call("/agents") or [] if isinstance(q, dict) and q.get("name") == name), None)
        if a and a.get("position"):
            return
        time.sleep(1)
    sys.exit(f"HUT_RESCUE FAILED: {name} did not spawn")


def act_and_wait(name, act, minutes):
    st = call(f"/agents/{name}/act", act)
    t0 = time.time()
    while time.time() - t0 < minutes * 60:
        time.sleep(3)
        acts = call(f"/agents/{name}/actions")
        done = next((h for h in reversed(acts.get("history") or []) if h.get("id") == st.get("id")), None)
        if done:
            return done.get("state"), done.get("message") or "", time.time() - t0
    call(f"/agents/{name}/stop", {})
    return "running", "", time.time() - t0


def lines_since(log, off, name):
    with open(log, encoding="utf-8", errors="replace") as f:
        f.seek(off)
        return [l for l in f.read().splitlines() if re.match(rf"\[\w[\w-]*\] {name}\b", l)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("log")
    ap.add_argument("--village", default="P1")
    ap.add_argument("--name", default="Ada")
    ap.add_argument("--minutes", type=float, default=5)
    ap.add_argument("--to", default="-1600,70,-57", help="a walk's goal off the village (train 18's 'open ground')")
    args = ap.parse_args()
    v = village(args.village)
    h, c = v["storageHut"], v["storage"]["chests"][0]
    hx, hy, hz = h["x1"] + 3, c["y"], h["z2"] - 1
    print(f"hut {h['x1']},{h['z1']}..{h['x2']},{h['z2']}; home cell {hx},{hy},{hz}", flush=True)
    name = args.name
    call(f"/agents/{name}", method="DELETE")
    time.sleep(2)
    r = call("/agents", {"name": name, "role": "builder", "brain": "idle", "gamemode": "survival", "reset": True,
                         "position": {"x": hx + 0.5, "z": hz + 0.5}, "memory": {"village": args.village}})
    if "error" in r:
        sys.exit(f"HUT_RESCUE FAILED: spawn {name}: {r['error']}")
    wait_spawned(name)
    rcon(f"tp {name} {hx + 0.5} {hy} {hz + 0.5}")
    time.sleep(2)
    # Glass round the cell (sides at the feet and head, and over the head), only where there is air
    walls = [(hx + dx, hy + dy, hz + dz) for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)) for dy in (0, 1)] + [(hx, hy + 2, hz)]
    placed = []
    for x, y, z in walls:
        if "passed" in rcon(f"execute if block {x} {y} {z} air"):
            rcon(f"setblock {x} {y} {z} glass")
            placed.append((x, y, z))
    print(f"glass at {len(placed)} cells round {hx},{hy},{hz}", flush=True)
    tx, ty, tz = (int(s) for s in args.to.split(","))
    off = os.path.getsize(args.log)
    # (no path fails at once, with no stall: two failed moves at one spot start the rescue, BotAgent.movedFailed)
    for k in range(4):
        state, msg, secs = act_and_wait(name, {"action": "move_to", "x": tx, "y": ty, "z": tz, "range": 3}, args.minutes)
        time.sleep(8)
        ls = lines_since(args.log, off, name)
        rescues = [l for l in ls if l.startswith("[rescue] ")]
        if rescues:
            break
    for l in rescues + [l for l in ls if l.startswith("[underground] ")]:
        print("   ", l[:260])
    bad = []
    for l in rescues:
        m = re.search(r"at (-?\d+),(-?\d+),(-?\d+)(?: \(last resort\))?$", l)
        f = re.search(r"(?:stuck|stalled \d+ times) at (-?\d+),(-?\d+),(-?\d+)", l)
        if not m:
            continue
        x, y, z = (int(q) for q in m.groups())
        inside = h["x1"] <= x <= h["x2"] and h["z1"] <= z <= h["z2"]
        near = ((x - hx) ** 2 + (z - hz) ** 2) ** 0.5 <= 2.5
        same = f and ((x - int(f.group(1))) ** 2 + (z - int(f.group(3))) ** 2) ** 0.5 <= 2.5
        if inside or near or same:
            bad.append(l)
    print(f"boxed in: {state} in {secs:.0f} s; rescues {len(rescues)}, landed badly {len(bad)}; "
          f"stuck {sum(l.startswith('[stuck] ') for l in ls)}; {msg[:160]}", flush=True)
    for x, y, z in placed:
        rcon(f"setblock {x} {y} {z} air")
    # The walk out from the hut floor, with nothing in the way
    rcon(f"tp {name} {hx + 0.5} {hy} {hz + 0.5}")
    time.sleep(2)
    off = os.path.getsize(args.log)
    state2, msg2, secs2 = act_and_wait(name, {"action": "move_to", "x": tx, "y": ty, "z": tz, "range": 3}, args.minutes)
    ls2 = lines_since(args.log, off, name)
    under = [l for l in ls2 if l.startswith("[underground] ") and "no way out" in l]
    print(f"walk out from the hut floor: {state2} in {secs2:.0f} s; stuck {sum(l.startswith('[stuck] ') for l in ls2)}, "
          f"underground no way out {len(under)}; {msg2[:160]}", flush=True)
    call(f"/agents/{name}", method="DELETE")
    ok = bool(rescues) and not bad and state2 == "done" and not under
    print("HUT_RESCUE PASSED" if ok else "HUT_RESCUE FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
