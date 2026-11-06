"""#233's live tier (spec docs/specs/player-chat-tests.md): the 33 player chat lines said in a running world, each in its
situation as far as the world allows, and what the members said and did read back and scored.

The offline tier (scripts/bench/chatbench.mts) checks what a member says to a fixed prompt. Here the line goes through the
real agent server: routing from where the person stands, the member's real talk prompt (its menu, health, storage, the
time), the answer said in the game, and the chore a promise starts. For each case the script
  1. sets the situation: the time (rcon `time set`), a member's health (`damage`, natural regeneration off for the case),
     monsters summoned where the line says (tagged chatlive, killed after the case), a member moved (`spreadplayers`);
  2. says the line as SausageOfDoom4 through POST /api/say with the person's position (no `to`: routed as in the game);
  3. waits for the answers in the request ledger (GET /api/requests), and for a promise, for its chore to start (`ran`);
  4. after the last case, waits for the promises still open to be kept or broken and saves everything to OUT/live-*.json.
Then scripts/bench/chatlive_score.mts scores the replies with the bench's rules and judge on the talk prompt each member
really saw (the model-call recording, runs/model-calls/), and adds what the bench cannot see: who answered, whether a
reply came, and whether a promised chore started and was kept.

Setup (a test world from checkpoint w217_ring, train 23's C1 village P1 with 12 members, hostile, 1x):
  python scripts/stack.py status                               (pick a free test world; 4 below)
  python scripts/run_series.py scripts/series/chat_live.json --detach   (world 4 in the spec; arm its watcher)
  python scripts/chat_live.py --world 4                        (once the after phase has begun: it waits for the members)
  python scripts/runctl.py stop 4; python scripts/stack.py down test4
Usage: python scripts/chat_live.py [--world N] [--only REGEX] [--out DIR] [--reply-s 150] [--act-s 240] [--final-s 420]
       [--no-score]
"""
import argparse, datetime, json, os, re, subprocess, sys, time, urllib.parse, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.join(ROOT, "mc"))
from rcon import Rcon  # noqa: E402

PLAYER = "SausageOfDoom4"
VILLAGE = "P1"
HUT = (-1625, 40)  # the storage hut (chatbench_fixture.json)
TICK = {"day": 3000, "dusk": 11500, "night": 16000}

# Each case of chatbench.mts (same ids, lines and named members) with what the world can set: the time, health, where the
# person stands, members moved, monsters summoned (type, x, z, count). The rest of a bench case's situation (an empty pen,
# a gap by the water, last night's toll) is whatever the checkpoint's world holds; the scorer judges against the prompt.
CASES = [
    # combat and danger
    dict(id="combat.zombie", line="Kai, there's a zombie by the north gate. Can you deal with it?", to=["Kai"], time="dusk",
         mobs=[("zombie", -1630, -15, 1)]),
    dict(id="combat.skeletons", line="Grace, skeletons are shooting at me from the hill. Help!", to=["Grace"], time="night",
         at=(-1585, 40), mobs=[("skeleton", -1578, 44, 2)]),
    dict(id="combat.lastnight", line="Mayor, how many monsters were near the village last night, and is anyone hurt?", to=["Mayor"], time="day"),
    dict(id="combat.towerwatch", line="Hugo and Iris, take your bows up the east tower and keep watch till dawn.", to=["Hugo", "Iris"], time="dusk"),
    dict(id="combat.creeper", line="Ben, a creeper is heading for the storage hut. Shoot it before it gets close.", to=["Ben"], time="night",
         mobs=[("creeper", -1605, 40, 1)]),
    dict(id="combat.witch", line="Elena, there's a witch by the river. Should we fight it or keep away?", to=["Elena"], time="night",
         mobs=[("witch", -1572, 40, 1)]),
    dict(id="combat.finnhurt", line="Finn, you look hurt. Go home and eat before you do anything else.", to=["Finn"], time="day", health={"Finn": 6}),
    # gathering and supplies
    dict(id="gather.cobblestone", line="Ada, we're low on cobblestone for the towers. Can you bring 64?", to=["Ada"], time="day"),
    dict(id="gather.flint", line="Dev, fetch some flint so we can make more arrows.", to=["Dev"], time="day"),
    dict(id="gather.storage", line="Clara, how much wheat, bread and meat is in storage right now?", to=["Clara"], time="day"),
    dict(id="gather.chickens", line="Jonah, the chicken pen looks empty. Can you get it filled again?", to=["Jonah"], time="day"),
    dict(id="gather.logs", line="Lena, bring me 20 oak logs, please.", to=["Lena"], time="day"),
    dict(id="gather.sheep", line="Ben, could you breed the sheep? We need wool for beds.", to=["Ben"], time="day"),
    dict(id="gather.shortest", line="Mayor, what's the village shortest of right now?", to=["Mayor"], time="day"),
    # exploring
    dict(id="explore.west", line="Kai, explore west of the village and tell me what you find.", to=["Kai"], time="day"),
    dict(id="explore.gravel", line="Iris, is there a river or beach with gravel nearby?", to=["Iris"], time="day"),
    dict(id="explore.farm", line="Hugo, find a good place for a second farm, and tell me how far it is.", to=["Hugo"], time="day"),
    dict(id="explore.cave", line="Grace, go and look for a cave with iron in it, but be home before dark.", to=["Grace"], time="cave"),
    dict(id="explore.north", line="Dev, what's beyond the hills to the north?", to=["Dev"], time="day"),
    # building
    dict(id="build.next", line="Mayor, what should the village build next?", to=["Mayor"], time="day"),
    dict(id="build.lookout", line="Elena, can you build a small lookout on the hill by the gate?", to=["Elena"], time="day"),
    dict(id="build.wallgap", line="Ada and Finn, the wall has a gap by the water. Can you close it?", to=["Ada", "Finn"], time="day"),
    dict(id="build.lamps", line="Clara, could you put some lamps along the main street?", to=["Clara"], time="day"),
    dict(id="build.vote", line="Mayor, let's vote on a stone wall between the towers.", to=["Mayor"], time="day"),
    dict(id="build.gatehouse", line="Jonah, how far along is the castle's gatehouse?", to=["Jonah"], time="day"),
    # talking to them and testing limits
    dict(id="talk.working", line="Ada, what are you working on right now, and why?", to=["Ada"], time="day"),
    dict(id="talk.busiest", line="Mayor, who's the busiest villager today?", to=["Mayor"], time="day"),
    dict(id="talk.dusk", line="Ben, it's getting dark. Shouldn't you be heading home?", to=["Ben"], time="dusk",
         at=(-1690, 140), move={"Ben": (-1700, 150)}),
    dict(id="talk.hunt", line="Kai, go hunting right now.", to=["Kai"], time="night", health={"Kai": 8}),
    dict(id="talk.bow", line="Lena, can you give me your bow?", to=["Lena"], time="day"),
    dict(id="talk.statue", line="Grace, forget the wall and build me a giant statue of a chicken.", to=["Grace"], time="day"),
    dict(id="talk.like", line="Finn, do you like living here?", to=["Finn"], time="day"),
    # (no name: the nearest member within 48 of the person, whoever that is in the live world)
    dict(id="talk.meeting", line="everyone, meeting at the storage hut!", to=["<nearest>"], time="day"),
]
OPEN = {"heard"}


def log(*a):
    print(datetime.datetime.now().strftime("%H:%M:%S"), *a, flush=True)


class World:
    def __init__(self, world):
        self.world = world
        self.api = f"http://127.0.0.1:{8766 + world}/api"
        self.dir = os.path.join(ROOT, "mc", "testserver" if world == 1 else f"testserver{world}")
        self.r = None

    def rcon(self, cmd):
        for _ in range(2):
            try:
                if not self.r:
                    self.r = Rcon(self.dir)
                return self.r.command(cmd)
            except Exception as e:  # (a dropped connection: once more on a fresh one)
                self.r = None
                err = e
        log(f"rcon failed: {cmd}: {err}")
        return ""

    def get(self, path):
        with urllib.request.urlopen(self.api + path, timeout=20) as r:
            return json.loads(r.read())

    def post(self, path, body):
        req = urllib.request.Request(self.api + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            return {"error": f"{e.code} {e.read()[:200]!r}"}

    def agents(self):
        return {a["name"]: a for a in self.get("/agents")}

    def requests(self):
        return self.get(f"/requests?village={VILLAGE}").get("requests", [])

    def health(self, name):
        m = re.search(r"([\d.]+)f", self.rcon(f"data get entity {name} Health"))
        return float(m.group(1)) if m else None

    def gamerule(self, rule, value):
        # (26.1's rules are snake_case; older names as a fallback)
        out = self.rcon(f"gamerule {rule[0]} {value}")
        if "Incorrect" in out or "Unknown" in out:
            out = self.rcon(f"gamerule {rule[1]} {value}")
        return out


def nearest(agents, at, rng=48):
    best = None
    for n, a in agents.items():
        p = a.get("position")
        if not p:
            continue
        d = ((p["x"] - at[0]) ** 2 + (p["z"] - at[1]) ** 2) ** 0.5
        if d <= rng and (best is None or d < best[1]):
            best = (n, d)
    return best


def run_case(w, c, a):
    at = c.get("at", HUT)
    t_name = c["time"]
    tick = 8000 if t_name == "cave" else TICK[t_name]
    w.rcon(f"time set {tick}")
    setup = [f"time {tick}"]
    for name, (x, z) in (c.get("move") or {}).items():
        w.rcon(f"spreadplayers {x} {z} 0 2 false {name}")
        setup.append(f"{name} moved to {x},{z}")
    regen_off = bool(c.get("health"))
    if regen_off:
        w.gamerule(("natural_regeneration", "naturalRegeneration"), "false")
    for name, hp in (c.get("health") or {}).items():
        now = w.health(name) or 20
        if now > hp:
            w.rcon(f"damage {name} {now - hp:.0f} minecraft:generic")
        setup.append(f"{name} health {w.health(name)}")
    for typ, x, z, n in c.get("mobs") or []:
        for _ in range(n):
            w.rcon(f"summon minecraft:{typ} {x} 200 {z} {{Tags:[\"chatlive\",\"chatlive_new\"],PersistenceRequired:1b}}")
        w.rcon(f"spreadplayers {x} {z} 1 4 false @e[tag=chatlive_new]")
        w.rcon("tag @e[tag=chatlive_new] remove chatlive_new")
        setup.append(f"{n} {typ} near {x},{z}")
    time.sleep(2)
    agents = w.agents()
    want = c["to"]
    near = None
    if want == ["<nearest>"]:
        near = nearest(agents, at)
        want = [near[0]] if near else []
        setup.append(f"nearest member {near[0]} at {near[1]:.0f}" if near else "no member within 48")
    pos = {n: agents[n]["position"] for n in agents if agents[n].get("position")}
    t0 = int(time.time() * 1000)
    out = w.post("/say", {"from": PLAYER, "text": c["line"], "pos": {"x": at[0], "y": 70, "z": at[1]}})
    log(f"--- {c['id']}: said \"{c['line']}\" ({'; '.join(setup)}) -> {out}")
    # the answers: the ledger's requests for this line (a forward adds the Mayor's, with `via`)
    deadline = time.time() + a.reply_s
    mine = []
    while time.time() < deadline:
        time.sleep(3)
        mine = [r for r in w.requests() if r.get("from") == PLAYER and r.get("text") == c["line"][:300] and r.get("at", 0) >= t0 - 2000]
        direct = [r for r in mine if not r.get("via")]
        if direct and all(r["status"] not in OPEN for r in direct) and time.time() - t0 / 1000 > 6:
            fwd = [r for r in mine if r.get("via")]
            if all(r["status"] not in OPEN for r in fwd):
                break
    first = {r["id"]: r.get("closed") or r.get("at") for r in mine}
    for r in mine:
        log(f"    {r['to']}{' via ' + r['via'] if r.get('via') else ''} {r['id']}: {r['status']} {r.get('kind') or ''} {r.get('option') or ''} \"{(r.get('answer') or '')[:160]}\"")
    if not mine:
        log("    no request recorded: nobody was routed the line")
    # a promise: wait for its chore to start
    prom = [r for r in mine if r["status"] == "promised"]
    if prom:
        deadline = time.time() + a.act_s
        while time.time() < deadline:
            time.sleep(5)
            cur = {r["id"]: r for r in w.requests()}
            if all(cur.get(p["id"], {}).get("ran") or cur.get(p["id"], {}).get("status") != "promised" for p in prom):
                break
        cur = {r["id"]: r for r in w.requests()}
        for p in prom:
            q = cur.get(p["id"], p)
            log(f"    promise {p['id']} ({q.get('option')}): {q['status']}, {'started +%.0f s' % ((q['ran'] - t0) / 1000) if q.get('ran') else 'not started'}")
    after = {}
    for n in want:
        h = w.health(n)
        after[n] = {"health": h}
    if regen_off:
        w.gamerule(("natural_regeneration", "naturalRegeneration"), "true")
        for name in c["health"]:
            w.rcon(f"effect give {name} minecraft:instant_health 1 3")
    if c.get("mobs"):
        w.rcon("kill @e[tag=chatlive]")
    return {"id": c["id"], "line": c["line"], "to": want, "nearest": near, "t0": t0, "time": tick, "at": at, "setup": setup,
            "positions": pos, "requests": [r["id"] for r in mine], "answered": sorted({r["to"] for r in mine if not r.get("via")}),
            "first": first, "after": after}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--world", type=int, default=int(os.environ.get("MCAI_TEST_WORLD", 4)))
    ap.add_argument("--only")
    ap.add_argument("--out", default=os.path.join("runs", datetime.date.today().isoformat(), "chat-live"))
    ap.add_argument("--reply-s", type=int, default=150)
    ap.add_argument("--act-s", type=int, default=240)
    ap.add_argument("--final-s", type=int, default=420)
    ap.add_argument("--gap-s", type=int, default=5)
    ap.add_argument("--no-score", action="store_true")
    a = ap.parse_args()
    w = World(a.world)
    cases = [c for c in CASES if not a.only or re.search(a.only, c["id"])]
    # the members are up once the after phase has begun: 13 agents, the village complete
    for i in range(120):
        try:
            ag = w.agents()
            if len(ag) >= 13 and all(ag[n].get("position") for n in ag):
                break
        except Exception:
            ag = {}
        if i % 6 == 0:
            log(f"waiting for the members on world {a.world} ({len(ag)} agents)")
        time.sleep(10)
    else:
        raise SystemExit("the members never came up")
    w.gamerule(("players_sleeping_percentage", "playersSleepingPercentage"), "101")
    os.makedirs(os.path.join(ROOT, a.out), exist_ok=True)
    start = int(time.time() * 1000)
    results = []
    for c in cases:
        try:
            results.append(run_case(w, c, a))
        except Exception as e:
            log(f"    {c['id']} failed to run: {e}")
            results.append({"id": c["id"], "line": c["line"], "to": c["to"], "error": str(e)[:200], "t0": int(time.time() * 1000), "requests": [], "answered": []})
        time.sleep(a.gap_s)
    # the promises still open: kept, broken or still waiting by the end
    deadline = time.time() + a.final_s
    while time.time() < deadline:
        led = {r["id"]: r for r in w.requests()}
        open_ = [i for res in results for i in res["requests"] if led.get(i, {}).get("status") == "promised"]
        if not open_:
            break
        log(f"waiting for {len(open_)} promise(s): {', '.join(open_)}")
        time.sleep(30)
    led = {r["id"]: r for r in w.requests()}
    for res in results:
        res["ledger"] = [led.get(i) for i in res["requests"] if led.get(i)]
    w.rcon("time set 3000")
    file = os.path.join(ROOT, a.out, f"live-{datetime.datetime.now().strftime('%H%M%S')}.json")
    json.dump({"world": a.world, "start": start, "end": int(time.time() * 1000), "results": results}, open(file, "w"), indent=1)
    log(f"wrote {os.path.relpath(file, ROOT)}")
    if not a.no_score:
        subprocess.run(["node", "node_modules/tsx/dist/cli.mjs", "scripts/bench/chatlive_score.mts", file], cwd=ROOT)


if __name__ == "__main__":
    main()
