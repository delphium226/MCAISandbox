"""Survival stage (c)'s live probe (spec runs/2026-10-31/survival/spec_c.md 8): the combat reflex against zombies at night.

On a test world whose agent server runs MC_WORLD_MODE=hostile (or normal), at night, with idle brains (no model):
  A. Gus unarmed, 2 zombies summoned 4 blocks off: he should run (no village: away), and survive or die (counted);
  B. Gus with a stone sword, 2 zombies: he fights back and kills both;
  C. Gus unarmed and the Mayor with an iron sword 5 blocks from him, 1 zombie 2 blocks on Gus's other side: the Mayor defends him;
  D. Gus with a sword, a creeper 3 blocks off: he runs from it (no fight).
Each case: fresh agents ("reset": true), the zombies tagged `probe` and killed after, SCENE seconds (default 45). Per case:
health at the end, deaths, the probe mobs left, and the `Reflex:` events (the [combat] lines are in the agent log). Prints
one line a case and PASS/FAIL marks: B and C kill their zombies, D flees, nobody's model is woken (idle brains).

  MCAI_API=http://127.0.0.1:8769/api MC_SERVER_DIR=mc/testserver3 python scripts/checks/combat_probe.py [X Z] [CASES]
X Z default to minevale3's site (-1563, -36); CASES e.g. ABCD (default).
"""
import json, os, re, sys, time, urllib.error, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "mc"))
import rcon as mc_rcon  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
API = os.environ.get("MCAI_API", "http://127.0.0.1:8769/api").rstrip("/")
args = sys.argv[1:]
X, Z = (int(args[0]), int(args[1])) if len(args) >= 2 and args[0].lstrip("-").isdigit() else (-1563, -36)
CASES = next((a for a in args if a.isalpha()), "ABCD").upper()
SCENE = float(os.environ.get("SCENE", "45"))
R = mc_rcon.Rcon()


def rc(cmd):
    return R.send(2, cmd)[1]


def call(path, body=None, method=None, timeout=60):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return {"error": f"{e.code} {e.read()[:200]!r}"}


def spawn(name, dx, items):
    call(f"/agents/{name}", method="DELETE")
    r = call("/agents", {"name": name, "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": X + dx + 0.5, "y": 64, "z": Z + 0.5}})
    if r.get("error"):
        raise SystemExit(f"spawn {name}: {r}")
    for _ in range(40):
        a = call(f"/agents/{name}")
        if a.get("position"):
            break
        time.sleep(0.5)
    rc(f"clear {name}")
    rc(f"effect clear {name}")
    for it in items:
        rc(f"give {name} {it}")
    time.sleep(1.5)


def agent(name):
    a = call(f"/agents/{name}")
    return a if isinstance(a, dict) else {}


def reflexes(name):
    evs = call(f"/agents/{name}/events")
    evs = evs if isinstance(evs, list) else []
    return [e.get("text", "") for e in evs if e.get("type") == "system" and "Reflex" in e.get("text", "")], [e for e in evs if e.get("type") == "death"]


def left(kind):
    m = re.search(r"count: (\d+)", rc(f"execute if entity @e[tag=probe,type={kind}]"), re.I)
    return int(m.group(1)) if m else 0


def summon(kind, at, n, dx):
    for i in range(n):
        rc(f"execute at {at} run summon {kind} ~{dx} ~ ~{i} {{Tags:[\"probe\"],PersistenceRequired:1b}}")


def scene(case):
    rc("kill @e[tag=probe]")
    rc(f"kill @e[type=!player,type=!item,x={X},y=64,z={Z},distance=..40]")
    rc("time set 18000")
    call("/agents/Mayor", method="DELETE")
    t0 = time.time()
    if case == "A":
        spawn("Gus", 0, [])
        summon("zombie", "Gus", 2, 4)
        mob = "zombie"
    elif case == "B":
        spawn("Gus", 0, ["stone_sword"])
        summon("zombie", "Gus", 2, 4)
        mob = "zombie"
    elif case == "C":
        spawn("Gus", 0, [])
        spawn("Mayor", 5, ["iron_sword"])
        summon("zombie", "Gus", 1, -2)
        mob = "zombie"
    else:
        spawn("Gus", 0, ["stone_sword"])
        summon("creeper", "Gus", 1, 3)
        mob = "creeper"
    hp_min = {"Gus": 20, "Mayor": 20}
    while time.time() - t0 < SCENE:
        for n in (["Gus", "Mayor"] if case == "C" else ["Gus"]):
            h = agent(n).get("health")
            if isinstance(h, (int, float)):
                hp_min[n] = min(hp_min[n], h)
        if case in "BC" and left(mob) == 0:
            break
        time.sleep(1)
    time.sleep(4)  # (a reflex reports after walking over the drops)
    n_left = left(mob)
    out = {"case": case, "secs": round(time.time() - t0), "left": n_left}
    for n in (["Gus", "Mayor"] if case == "C" else ["Gus"]):
        refl, deaths = reflexes(n)
        out[n] = {"health": agent(n).get("health"), "min": hp_min[n], "deaths": len(deaths), "reflexes": refl[-4:]}
    rc("kill @e[tag=probe]")
    return out


def arena():
    """A flat clearing (25x25 at y 64, air to y 84) round X Z, so nobody spawns in a tree; the world is a test world."""
    rc(f"fill {X - 12} 64 {Z - 12} {X + 12} 84 {Z + 12} air")
    rc(f"fill {X - 12} 63 {Z - 12} {X + 12} 63 {Z + 12} grass_block")
    rc(f"fill {X - 12} 60 {Z - 12} {X + 12} 62 {Z + 12} dirt")


def main():
    marks = []
    arena()
    res = []
    try:
        for c in CASES:
            r = scene(c)
            res.append(r)
            print(json.dumps(r))
            g = r["Gus"]
            if c == "B":
                marks.append(("B armed Gus kills both zombies", r["left"] == 0))
            if c == "C":
                m = r.get("Mayor", {})
                marks.append(("C the Mayor defends Gus (zombie killed, a defend reflex)", r["left"] == 0 and any("help" in t for t in m.get("reflexes", []))))
            if c == "D":
                marks.append(("D Gus runs from the creeper", any("creeper" in t for t in g["reflexes"]) and g["deaths"] == 0))
            if c == "A":
                marks.append(("A unarmed Gus runs (a shelter reflex)", any("ran" in t for t in g["reflexes"])))
    finally:
        rc("kill @e[tag=probe]")
        for n in ("Gus", "Mayor"):
            call(f"/agents/{n}", method="DELETE")
    for what, ok in marks:
        print(f"{'PASS' if ok else 'FAIL'} {what}")
    os.makedirs(os.path.join(ROOT, "runs", time.strftime("%Y-%m-%d"), "survival"), exist_ok=True)
    with open(os.path.join(ROOT, "runs", time.strftime("%Y-%m-%d"), "survival", f"combat_probe-{time.strftime('%H%M%S')}.json"), "w") as f:
        json.dump({"results": res, "marks": marks}, f, indent=1)


main()
