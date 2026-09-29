"""Felling whole trees (plan step 2.2): Gus collects logs in survival, then for every tree he cut the check looks through
/api/block for logs left standing within 4 blocks of the trunk and for dirt left in the trunk's column (his pillar).
Usage: python scripts/checks/fell_trees.py [X Z [COUNT [ROUNDS]]] (default: Accept15's woods at -580,-200, where
trunks were left floating; 12 logs, 2 rounds). Needs the agent server; Gus is removed at the end.
"""
import json, subprocess, sys, time, urllib.request

API = "http://127.0.0.1:8766/api"
X, Z = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (-580, -200)
COUNT = int(sys.argv[3]) if len(sys.argv) > 3 else 12
ROUNDS = int(sys.argv[4]) if len(sys.argv) > 4 else 2


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


def events_since(last):
    return [e for e in call("/agents/Gus/events") if e["id"] > last]


def act(action, **args):
    last = max([e["id"] for e in call("/agents/Gus/events")] or [0])
    call("/agents/Gus/act", {"action": action, **args})
    for _ in range(600):
        time.sleep(1)
        evs = events_since(last)
        done = [e for e in evs if e["type"] in ("action_done", "action_failed")]
        if done:
            return done[-1]["text"], evs
    return "(no result in 10 min)", events_since(last)


def block(x, y, z):
    return call(f"/block?x={x}&y={y}&z={z}").get("block", "?")


def rcon(cmd):
    return subprocess.run([sys.executable, "mc/rcon.py", cmd], capture_output=True, text=True).stdout.strip()


def check_tree(logs):
    """Logs a tree lost (from 'broke' events): anything left of it, and dirt in its trunk column."""
    foot = min(logs, key=lambda p: p[1])
    x0, z0 = foot[0], foot[2]
    ys = [p[1] for p in logs]
    left, dirt = [], []
    for dx in range(-4, 5):
        for dz in range(-4, 5):
            for y in range(min(ys), max(ys) + 4):
                n = block(x0 + dx, y, z0 + dz)
                if n.endswith("_log") and not n.startswith("stripped_"):
                    left.append((x0 + dx, y, z0 + dz, n))
    # A pillar block: dirt standing free (open on 3 or more sides), anywhere around the foot; dirt in a bank is natural
    open_ = lambda x, y, z: block(x, y, z) in ("air", "cave_air", "short_grass", "tall_grass", "fern") or block(x, y, z).endswith("_leaves")
    for dx in range(-2, 3):
        for dz in range(-2, 3):
            x, z = x0 + dx, z0 + dz
            for y in range(foot[1] - 1, max(ys) + 2):
                if block(x, y, z) == "dirt" and sum(open_(x + a, y, z + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))) >= 3:
                    dirt.append((x, y, z))
    return foot, left, dirt


call("/agents/Gus", method="DELETE")
call("/agents", {"name": "Gus", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": X + 0.5, "y": 120, "z": Z + 0.5}})
time.sleep(8)
for r in range(ROUNDS):
    t = time.time()
    text, evs = act("collect", block="logs", count=COUNT)
    broke = [(e["data"]["x"], e["data"]["y"], e["data"]["z"]) for e in evs if e["type"] == "broke" and e["data"]["block"].endswith("_log")]
    print(f"round {r + 1}: {text[:300]} ({time.time() - t:.0f} s, {len(broke)} logs broken)")
    # One tree per cluster of broken logs (within 4 blocks sideways of the cluster's first log)
    trees = []
    for p in broke:
        for tr in trees:
            if abs(tr[0][0] - p[0]) <= 4 and abs(tr[0][2] - p[2]) <= 4:
                tr.append(p)
                break
        else:
            trees.append([p])
    for tr in trees:
        foot, left, dirt = check_tree(tr)
        items = sum(int(r.rsplit(" ", 1)[-1]) for r in (rcon(f"execute if entity @e[type=item,x={foot[0]},y={foot[1]},z={foot[2]},distance=..12,nbt={{Item:{{id:\"minecraft:{k}_log\"}}}}]")
                                                          for k in ("oak", "birch", "spruce", "jungle", "acacia", "dark_oak", "cherry", "mangrove")) if "passed" in r)
        print(f"  tree at {foot[0]},{foot[1]},{foot[2]}: {len(tr)} logs cut, {len(left)} left{' ' + str(left[:4]) if left else ''}, "
              f"{len(dirt)} pillar dirt left{' ' + str(dirt) if dirt else ''}; log items lying within 12: {items}")
inv = call("/agents/Gus/observe?radius=2").get("inventory", [])
print("inventory:", inv, "| on the server:", rcon("clear Gus #minecraft:logs 0"), "|", rcon("clear Gus minecraft:dirt 0"))
call("/agents/Gus", method="DELETE")
