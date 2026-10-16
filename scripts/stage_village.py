"""Start a real-Minecraft village at a given stage and watch it, to test one part of the village economy quickly.

Usage: python scripts/stage_village.py VILLAGE X Z [options]
       python scripts/stage_village.py VILLAGE --site NAME [options]
  --site NAME                   a site of the fixed test world (scripts/test_sites.json, plan step T.2; restore it first
                                with scripts/reset_site.py NAME): its recorded find_site result is used as it is (no land
                                search); while it has none, the land search starts at its probe and prints the site found
                                to record. MCAI_API defaults to the test agent server (port 8767) and MC_SERVER_DIR to
                                mc/testserver with --site
  --buildings testhut,testhut   design names, one per building (default: one testhut; built in: testhut 5x5, testhall 9x9,
                                stairhut 5x5 and stairhall 9x9 with stair gable roofs; drawn by the building generator:
                                genhut 7x7 (a 5x5 hip with an overhang) and genhall 11x11 (a 9x9 gable with an overhang);
                                plan_layout takes one building over 150 gather units a village: testhall (~153),
                                stairhall (~172) and genhall (~191) do not go together)
  --design-from VILLAGE:NAME    copy a design from another village's library (repeatable)
  --design-file FILE.json       a design from a JSON file, by its name (repeatable; e.g. a vanilla piece written by
                                scripts/checks/vanilla_pieces.mts with OUT=)
  --plan street                 the street plan (V2.3): the biome's vanilla town centre in the middle, streets from it laid by
                                prepare_site as dirt_path, the buildings turned to face them (--biome picks the centre,
                                default plains)
  --stage full|build            full: layout only, workers do storage, gathering and building;
                                build: the storage chest is placed and stocked with the raw materials, so workers
                                only prepare the plot and build (tests building from storage, crafting included).
                                With a storage hut (new villages), the chests go into the hut's chest spots once the
                                plot is prepared, one per material group, and the hut is built around them; when every
                                building stands, Worker1 deposits mixed items and the chests are checked for sorting
  --no-deposit-check            skip that check
  --brain tasks|tiered          tasks (default): scripted workers that run each task's skill calls, no model;
                                tiered: model-driven workers (MCAI_EXEC_MODEL, default ollama:gpt-oss:120b-cloud,
                                and --planner; MCAI_REASONING, e.g. exec=medium, overrides the reasoning levels)
  --planner MODEL               the tiered workers' planner (default ollama:gpt-oss:120b-cloud)
  --workers N                   default 2 (Worker1, Worker2)
  --mayor                       also a tiered Mayor (V2.3m), its layout posted by it and its plan empty: it gathers while
                                it waits (soft gather tasks run as written, no model calls expected; --planner is its
                                planner, MCAI_EXEC_MODEL its executor; only a local model there needs the agent server
                                started with MC_OLLAMA_ROUTES)
  --minutes M                   time limit (default 20)
  --verbose                     the full STATS line per agent beside the AGENTS table (over 4 agents the table replaces them)
  --resume                      start from the village VILLAGE as it stands, complete, in a checkpoint restored by
                                scripts/reset_site.py SITE --checkpoint CP (saved with --save CP once a staged run had
                                completed it): no designs, layout or staging; the agents spawn into it and the watch goes
                                straight to the after phase (needs --after). The build's PREPARE, CRITICAL PATH, MINE and
                                TAIL lines are left out (they belong to the run that saved it)
  --choose fixed|model          A.2: memory.choose on every spawn, how the complete village's idle members choose their chores
                                (fixed: the code's order; model: one model call a decision); unset sends nothing, so the
                                agent server's MC_CHOOSE (fixed by default) decides
Stops early when every building is done, when an agent fails the same way MCAI_SAME_FAIL times (default 3), after
MCAI_STALL_MIN minutes (default 3) without a successful action by anyone, or when one agent holding a task or running an
action has had none for MCAI_AGENT_STALL_MIN minutes (default MCAI_STALL_MIN, at least 10; an agent with nothing to do is
not stalled, and "cannot be gathered here" or "the mine is busy" count as work).
The agents spawn on a ring 4 blocks outside the plot (beyond prepare_site's margin), on ground read from the world and
checked after the spawn (S.0), at least MCAI_SPAWN_GAP_S seconds apart (default 2.5, E.1). At the end: each agent's busy
and idle minutes (BUSY lines; an agent is busy while an action runs; over 4 agents an AGENTS table of busy share, actions
done and failed, contention, refused repeats and rescues in place of the STATS lines, E.1), the critical path through the board's tasks (CRIT lines), STOCK lines of the storage during the run for
scripts/checks/autonomy_metrics.py, and the mine's MINE lines (S.2: cells a minute from the stairs to the last cobblestone
collect and the peak of miners, the cobblestone tasks' times from claim to done, the busy hand-backs per agent with any
REPEAT, a FAIL; scripts/checks/mine_rate.py works them out for older logs), and S.5's: STATIONS (when the hut's table and
furnace stood, placed before the hut; a STATION line as each appears), PANES (when the storage first held the windows'
panes, set against the first house's claim) and STATIONS SWEEP (any crafting table or furnace within 8 of the layout
outside the hut's two cells), and S.6's PREPARE lines (each part of the plot prepared at once: by whom, claimed and done;
when the huts' ground and the whole plot were done; the plot record and the layout's one level). With --after, S.9's
workshop too (the agent server's MC_CHOICE_FAMILIES switches its chores on): AFTER WORKS lines as the works plot and its
furnaces change, AFTER TECH as each first item is made, and at the end `AFTER S.9 chores: K agents took one; peak P at
once (minute m); make N, gather G (sand s, logs l, cobblestone c), works W; busy B agent-min` and the goods in storage
(scripts/checks/make_log.py reads the agent server's log of the same run). And B.4's lighting (MC_CHOICE_FAMILIES with
light): `AFTER Xm LIGHT <part> <done>/<all> never <k>` as a part's torch record changes (all: the spots its last light
option counted, read from MCAI_CHOICE_LOG, else ?), at the end `AFTER LIGHT standing S of D` (every recorded torch tested on
the server by RCON while the agents are still there) and `AFTER B.4 minutes: light L, for torches T` (the light chores'
agent-minutes and those of make:torch, and of charcoal and logs gathering whose option names torches, from the choice log).
A village that grows (s30, the agent server started with MC_GROW=1): `AFTER GROW on|off` (the agent server's /api/status `grow`, else this
environment's MC_GROW), `AFTER
Xm GROW layout L (k): n houses posted at <area> (pad SxS, field + j slots | no field (why)); built b/n; houses H for M members;
chests C` as a growth layout changes (the pad as its layout record has it, s30's food step), and
at the end `GROW layouts N (built/failed/stuck), houses H0 -> H1 for M members, minutes per layout a/b/c, stop: <reason>`, a
GROW line per layout (houses, members, plot, minutes from posting to built, its gathering's minutes), its GROW CRITICAL PATH
and GROW TASK lines (the claim-to-end spans of its builds, lamps, signs and makes, for scripts/checks/make_log.py). The
PREPARE, CRITICAL PATH, MINE and TAIL lines count only the tasks before the first growth layout's first id.
The village appetite (s30's food step, the agent server started with MC_APPETITE; runs/2026-10-15/s30/spec_food.md 6):
`AFTER FOOD on: ...` at the after phase's start, `AFTER Xm FOOD stock P pts (...) | made ... | eaten M meals P pts | fields F
(planted p, harvested h, harvests n) | peckish k hungry j` every 2 minutes, and at the end `FOOD per agent: ...`, `FOOD
members N: every member ate yes|no`, `FOOD hungry share of member-time: all a%, after +30 b%, after +45 c%; busy (D7) d%`,
`FOOD conversions: ...`, `FOOD note: ...` lines, `FOOD ok (...)` or `FOOD MISMATCH <what>` (the food in storage and carried
against the record's made and eaten and the food that left without a meal: from-storage farm starts; read
again up to 3 times while agents still work) and `FIELDS ticking: layout K S% of N checks` (every 30 s, whether each planted
field's chunks were within 115 blocks of a bot, the live check's rule). --appetite-start N sets every member's level once
the village is complete; --ripen-fields sets each wheat field ripe once when first planted (a quick meal test; leave it off
to time natural growth); --stock bread:10 stocks food like anything else.
Workers are left in the world: remove them afterwards (panel or DELETE).
"""
import argparse, importlib.util, json, math, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request

# Chat and model text can hold any character; the Windows console encoding cannot
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
API = os.environ.get("MCAI_API", "http://127.0.0.1:8766/api")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts", "checks"))
from autonomy_metrics import BoardStamps, BusyClock, MineStats, critical_path_lines, tail_lines  # noqa: E402

# A small, cheap building: cobblestone floor, oak plank walls and roof, oak log corners, a door and two windows
TESTHUT = {
    "name": "testhut", "description": "a small test hut (planks, logs, cobblestone, glass)", "width": 5, "depth": 5,
    "palette": {"C": "cobblestone", "P": "oak_planks", "L": "oak_log", "G": "glass", "D": "oak_door"},
    "layers": [
        ["C C C C C"] * 5,
        ["L P P P L", "P . . . P", "P . . . P", "P . . . P", "L P D P L"],
        ["L P G P L", "P . . . P", "P . . . P", "P . . . P", "L P . P L"],
        ["P P P P P"] * 5,
    ],
}

# A bigger one for village layouts: a 9x9 hall of planks on a cobblestone floor, log posts, glass, a door
TESTHALL = {
    "name": "testhall", "description": "a 9x9 test hall (planks, logs, cobblestone, glass)", "width": 9, "depth": 9,
    "palette": {"C": "cobblestone", "P": "oak_planks", "L": "oak_log", "G": "glass", "D": "oak_door"},
    "layers": [
        ["C C C C C C C C C"] * 9,
        ["L P P P P P P P L"] + ["P . . . . . . . P"] * 7 + ["L P P P D P P P L"],
        ["L P G P P P G P L", "P . . . . . . . P", "G . . . . . . . G", "P . . . . . . . P", "P . . . . . . . P",
         "P . . . . . . . P", "G . . . . . . . G", "P . . . . . . . P", "L P G P . P G P L"],
        ["L P P P P P P P L"] + ["P . . . . . . . P"] * 7 + ["L P P P P P P P L"],
        ["P P P P P P P P P"] * 9,
    ],
}


def gable(width, depth, walls, floor="C", ridge="P"):
    """Roof layers for a gable over a width x depth building whose walls are `walls` (a list of wall layers): stairs N
    (facing south, the north slope) and S (facing north) rising one row per layer from both sides, the ridge on the
    middle row, the gable ends of planks (phase D's test buildings)."""
    def row(cells):
        return " ".join(cells)
    layers = [[row([floor] * width)] * depth] + walls
    for k in range(depth // 2):
        rows = []
        for j in range(depth):
            if j == k:
                rows.append(row(["N"] * width))
            elif j == depth - 1 - k:
                rows.append(row(["S"] * width))
            elif k < j < depth - 1 - k:
                rows.append(row(["P"] + ["."] * (width - 2) + ["P"]))
            else:
                rows.append(row(["."] * width))
        layers.append(rows)
    layers.append([row([ridge] * width) if j == depth // 2 else row(["."] * width) for j in range(depth)])
    return layers


STAIRS = {"N": "oak_stairs[facing=south,half=bottom]", "S": "oak_stairs[facing=north,half=bottom]"}
# Phase D: the testhut with a gable roof of stairs (the builder crafts the stairs from storage)
STAIRHUT = {
    "name": "stairhut", "description": "a small test hut with a stair gable roof", "width": 5, "depth": 5,
    "palette": {"C": "cobblestone", "P": "oak_planks", "L": "oak_log", "G": "glass", "D": "oak_door", **STAIRS},
    "layers": gable(5, 5, [
        ["L P P P L", "P . . . P", "P . . . P", "P . . . P", "L P D P L"],
        ["L P G P L", "P . . . P", "P . . . P", "P . . . P", "L P . P L"],
    ]),
}
# ...and a 9x9 hall with a slab ridge and trapdoor shutters (stairs, slabs and trapdoors crafted from storage)
STAIRHALL = {
    "name": "stairhall", "description": "a 9x9 test hall with a stair gable roof, slab ridge and shutters", "width": 9, "depth": 9,
    "palette": {"C": "cobblestone", "P": "oak_planks", "L": "oak_log", "G": "glass", "D": "oak_door", **STAIRS,
                "R": "oak_slab[type=bottom]", "T": "oak_trapdoor[facing=south,half=top,open=true]"},
    "layers": gable(9, 9, [
        ["L P P P P P P P L"] + ["P . . . . . . . P"] * 7 + ["L P P P D P P P L"],
        ["L P G P P P G P L", "P . . . . . . . P", "G . . . . . . . G", "P . . . . . . . P", "P . . . . . . . P",
         "P . . . . . . . P", "G . . . . . . . G", "P . . . . . . . P", "L T G T . T G T L"],
        ["L P P P P P P P L"] + ["P . . . . . . . P"] * 7 + ["L P P P P P P P L"],
    ], ridge="R"),
}

# Phase D, D.2: designs the building generator draws from a style (buildingGen.ts, through scripts/checks/gen_designs.mts):
# a hip-roofed hut with an overhang and glass panes, and a gabled hall with an overhang on a cobblestone base
GEN_STYLES = {
    "genhut": {"width": 5, "depth": 5, "wall_height": 3, "floor": "none", "base": "cobblestone", "frame": "logs",
               "walls": "planks", "roof": "hip", "roof_material": "planks", "overhang": 1, "windows": "panes",
               "door_side": "south", "description": "a generated test hut with a hip roof"},
    "genhall": {"width": 9, "depth": 9, "wall_height": 4, "floor": "none", "base": "cobblestone", "frame": "logs",
                "walls": "planks", "roof": "gable", "roof_material": "planks", "overhang": 1, "windows": "glass",
                "door_side": "south", "description": "a generated test hall with a gable roof"},
}


def generated(name):
    """A design drawn by the building generator from GEN_STYLES[name]."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "runs", f"gen_{name}_{os.getpid()}.json")
    tsx = os.path.join(root, "node_modules", ".bin", "tsx.cmd" if os.name == "nt" else "tsx")
    env = dict(os.environ, STYLE=json.dumps({**GEN_STYLES[name], "name": name}), OUT=out)
    subprocess.run([tsx, os.path.join(root, "scripts", "checks", "gen_designs.mts")], env=env, check=True, cwd=root)
    with open(out, encoding="utf-8") as f:
        d = json.load(f)["design"]
    os.remove(out)
    return {**d, "name": name}


p = argparse.ArgumentParser()
p.add_argument("village"); p.add_argument("x", type=float, nargs="?"); p.add_argument("z", type=float, nargs="?")
p.add_argument("--site", help="a site of scripts/test_sites.json (the fixed test world)")
p.add_argument("--site-at", help="X,Y,Z,SIZE[,WOOD[,WOODLOGS]]: a site find_site gave (e.g. from the ground in jungle, where a probe "
               "spawned by x,z lands on the canopy), used directly in the world MCAI_API points at")
p.add_argument("--buildings", default="testhut")
p.add_argument("--design-from", action="append", default=[])
p.add_argument("--design-file", action="append", default=[])
p.add_argument("--plan", choices=["rows", "street"], default="rows")
p.add_argument("--biome", default="plains")
p.add_argument("--stage", choices=["full", "build"], default="full")
p.add_argument("--brain", choices=["tasks", "tiered"], default="tasks")
p.add_argument("--planner", default="ollama:gpt-oss:120b-cloud")
p.add_argument("--workers", type=int, default=2)
p.add_argument("--mayor", action="store_true")
p.add_argument("--minutes", type=float, default=20)
p.add_argument("--verbose", action="store_true", help="the full STATS line per agent at any count (over 4 agents an AGENTS table "
                                                      "replaces them)")
p.add_argument("--mixed-wood", action="store_true", help="stage build: stock half the logs in another wood kind")
p.add_argument("--no-deposit-check", action="store_true")
p.add_argument("--harvest", action="store_true", help="after the build, set the farm ripe by command and check the harvest "
                                                          "(farming v2): bread in storage, every looted cell sown again")
p.add_argument("--after", type=float, default=0, help="keep watching this many minutes after the village is complete: the "
                                                      "chores (opportunistic farms, harvests, exploring) and the atlas's sightings; needs --mayor (only a "
                                                      "tiered mayor sets the village complete, and the chores wait for that)")
p.add_argument("--fixtures", action="store_true", help="before the run, put sugar cane (with water), pumpkins and a melon "
                                                       "on the ground 35-45 blocks off the site by command (sightings to farm), "
                                                       "and summon 4 chickens there (tagged stagefix, to lure into a pen)")
p.add_argument("--fixture-dy", default="-2:2", help="with --fixtures: LO:HI, the chickens' and cows' ground LO..HI above "
                                                   "the site's level (5:8 puts them on a rise above the annex, F205)")
p.add_argument("--fixture-at", default="", help="with --fixtures: X,Z for the chickens and cows instead of a search (still "
                                                "checked against --fixture-dy; use = for a negative X)")
p.add_argument("--fixture-clear", action="store_true", help="with --fixtures: kill the chickens and cows within 120 of the site "
                                                            "first, so only the fixtures can fill a pen (F205's review H2)")
p.add_argument("--after-until", default="", help="with --after: end the after phase early once every one of these holds "
               "(comma-separated; --after stays the limit): grow (no growth layout under way, and growth stopped or a house "
               "per member) and idle:N (no member ran an action for N minutes; mind waits for growing fields)")
p.add_argument("--ripen", action="store_true", help="with --after: set each newly planted farm slot ripe by command once")
p.add_argument("--ripen-fields", action="store_true", help="with --after: set each layout's wheat field ripe by command once, when it is "
               "first planted (a quick meal test; G3f and G25f time natural growth and leave it off)")
p.add_argument("--appetite-start", type=float, help="with --after and the agent server's MC_APPETITE: set every member's appetite to "
               "this level once the village is complete (POST /api/village/V/appetite)")
p.add_argument("--choose", choices=["fixed", "model"], help="A.2: how idle members of the complete village choose their chores "
                                                          "(memory.choose on every spawn; fixed: the code's order, model: a "
                                                          "model call per decision); unset sends nothing (the agent server's "
                                                          "MC_CHOOSE, fixed by default)")
p.add_argument("--resume", action="store_true", help="start from VILLAGE complete in a restored checkpoint "
               "(reset_site.py SITE --checkpoint CP): spawn its members and watch the after phase only (needs --after)")
p.add_argument("--stock", default="", help="with --after: ITEM:N,... given to the last worker and deposited into storage once the "
                                          "village is complete (e.g. raw_iron:3 to test the iron tools without digging for it)")
args = p.parse_args()
until = [c.strip() for c in args.after_until.split(",") if c.strip()]
for c in until:
    if not (c == "grow" or re.fullmatch(r"idle:\d+(\.\d+)?", c)):
        p.error(f"--after-until {c}: give grow or idle:N")
if until and not args.after:
    p.error("--after-until needs --after (the limit)")
if args.resume:
    if not args.after:
        p.error("--resume watches the after phase only: give --after MINUTES")
    clash = [o for o, on in (("--stage build", args.stage == "build"), ("--harvest", args.harvest), ("--fixtures", args.fixtures),
                             ("--design-from", args.design_from), ("--design-file", args.design_file)) if on]
    if clash:
        p.error(f"--resume starts from a built village: {', '.join(clash)} cannot apply (the checkpoint keeps any fixtures)")
test_site = None
if args.site:
    sites = json.load(open(os.path.join(ROOT, "scripts", "test_sites.json"), encoding="utf-8"))
    sites = sites["sites"] if isinstance(sites, dict) else sites
    test_site = next((s for s in sites if s["name"].lower() == args.site.lower()), None)
    if not test_site:
        p.error(f"no site {args.site} in scripts/test_sites.json; there are: {', '.join(s['name'] for s in sites)}")
    if args.x is not None:
        print(f"--site {args.site}: X Z ignored", flush=True)
    args.x, args.z = test_site["probe"]["x"], test_site["probe"]["z"]
    # The test world's servers, unless told otherwise (rcon.py reads MC_SERVER_DIR)
    # (MCAI_TEST_WORLD=N: test world N, mc/testserverN with its agent server on 8766+N; mc/testserver.py)
    world = int(os.environ.get("MCAI_TEST_WORLD") or 1)
    if "MCAI_API" not in os.environ:
        API = f"http://127.0.0.1:{os.environ.get('MCAI_TEST_API_PORT') or 8766 + world}/api"
    os.environ.setdefault("MC_SERVER_DIR", "mc/testserver" if world == 1 else f"mc/testserver{world}")
    print(f"test world: API {API}, server folder {os.environ['MC_SERVER_DIR']}", flush=True)
    # The village records (API) and the RCON commands (server folder) must reach the same world
    props = os.path.join(ROOT, os.environ["MC_SERVER_DIR"], "server.properties")
    kv = dict(l.split("=", 1) for l in open(props).read().splitlines() if "=" in l and not l.startswith("#"))
    with urllib.request.urlopen(API + "/status", timeout=10) as r:
        served = json.loads(r.read()).get("server", "")
    if not served.endswith(f":{kv.get('server-port', '25565')}"):
        raise SystemExit(f"the agent server at {API} plays on {served}, but {props} says server-port={kv.get('server-port')}: not one world")
elif args.x is None or args.z is None:
    p.error("give X and Z, or --site NAME")
buildings = [b.strip() for b in args.buildings.split(",") if b.strip()]
stall_minutes = float(os.environ.get("MCAI_STALL_MIN", "3"))
# (at least 10: one action can run longer than MCAI_STALL_MIN with no success, a mine trip 6 minutes on the wall clock)
agent_stall = float(os.environ.get("MCAI_AGENT_STALL_MIN", max(stall_minutes, 10)))
same_fail = int(os.environ.get("MCAI_SAME_FAIL", "3"))
# Seconds at least between two spawn POSTs (E.1: 25 bots joining at once load every chunk round the site together)
SPAWN_GAP = float(os.environ.get("MCAI_SPAWN_GAP_S", "2.5"))


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method)
    # (a connection reset is tried twice more, 2 s apart: one reset each ended A1b1 and A1b3 at 25 bots, 10-12, with the
    # agent server healthy; likely Windows resetting a reused port beside the server's hundreds of TIME_WAIT sockets)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read() or "null")
        except urllib.error.HTTPError as e:
            return {"error": e.read().decode()[:300], "status": e.code}
        except (ConnectionError, urllib.error.URLError) as e:
            # (urllib wraps a reset during the send in URLError, A1b3: the request never arrived, so any method is sent
            # again; a reset raised raw came while reading the answer, after the server acted, so only a GET is; anything
            # else, e.g. a refused port, is raised)
            wrapped = isinstance(e, urllib.error.URLError)
            cause = e.reason if wrapped else e
            if attempt == 2 or not isinstance(cause, (ConnectionResetError, ConnectionAbortedError)) \
                    or (not wrapped and req.get_method() != "GET"):
                raise
            print(f"[api] {path}: {cause.__class__.__name__}, trying again", flush=True)
            time.sleep(2)


def usage_report(since_ms, agents):
    """The run's model usage from the agent server's ledger (A.0); None when it cannot be read."""
    try:
        return call(f"/usage?since={since_ms}&agents={','.join(agents)}")
    except Exception:
        return None


def fmt_tok(n):
    return f"{n / 1e6:.2f}M" if n >= 1e6 else f"{n / 1e3:.1f}k" if n >= 1e3 else str(n)


def usage_suffix(u):
    if not u or "total" not in u:
        return "; tokens n/a"
    t = u["total"]
    s = (f"; tokens {fmt_tok(t['promptTokens'])} in / {fmt_tok(t['outputTokens'])} out in {t['calls']} calls"
         f", ~${t.get('cost', 0):.3f}")
    if t.get("refused"):
        s += f", {t['refused']} refused by the budget"
    if t.get("errors"):
        s += f", {t['errors']} errors"
    if u.get("unpriced"):
        s += f" (unpriced: {', '.join(u['unpriced'])})"
    if u.get("partial"):
        s += " (partial)"
    return s


def usage_lines(u, agents):
    """One line per agent: calls and tokens in/out per call kind."""
    if not u or "total" not in u:
        return []
    out = []
    for n in agents:
        k = (u.get("byAgentKind") or {}).get(n) or {}
        parts = []
        for kind in ("plan", "design", "exec"):
            d = k.get(kind) or {}
            parts.append(f"{kind} {d.get('calls', 0)}x {fmt_tok(d.get('promptTokens', 0))}/{fmt_tok(d.get('outputTokens', 0))}")
        out.append(f"USAGE {n}: " + ", ".join(parts))
    return out


def rcon(cmd):
    return subprocess.run([sys.executable, os.path.join(ROOT, "mc", "rcon.py"), cmd], capture_output=True, text=True).stdout.strip()


_rc = None


def rcon_fast(cmd):
    """One RCON connection kept open, for the spawn's many block tests (rcon() starts a process per command)."""
    global _rc
    try:
        if _rc is None:
            spec = importlib.util.spec_from_file_location("mc_rcon", os.path.join(ROOT, "mc", "rcon.py"))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            _rc = mod.Rcon()
        return _rc.command(cmd)
    except Exception:
        _rc = None
        return rcon(cmd)


def ring_points(area, count, out=4):
    """`count` points spread evenly round the rectangle `out` blocks outside `area` (x1..x2, z1..z2): beyond the plot and
    prepare_site's 2-block margin, so no agent starts on ground a preparer levels or fills. Each with its outward step."""
    x1, z1, x2, z2 = area["x1"] - out, area["z1"] - out, area["x2"] + out, area["z2"] + out
    w, d = x2 - x1, z2 - z1
    per = 2 * (w + d)
    pts = []
    for i in range(count):
        s = (i + 0.5) * per / count
        if s < w:
            p = (x1 + s, z2, 0, 1)
        elif s < w + d:
            p = (x2, z2 - (s - w), 1, 0)
        elif s < 2 * w + d:
            p = (x2 - (s - w - d), z1, 0, -1)
        else:
            p = (x1, z1 + (s - 2 * w - d), -1, 0)
        pts.append((int(round(p[0])), int(round(p[1])), p[2], p[3]))
    return pts


def stand_ground(x, z, y0):
    """The y to stand at on x, z: one above the first block down from y0 + 32 that is not open (air, plants without a
    collision box, snow), so every block over it is open, as watch_village.column_y reads a column (a fixed height put
    agents inside a hill, F84; a search upward from inside one could stop in a cave). None when y0 + 32 is itself inside a
    hill, in water or lava, on a lily pad or anything else over water, on a tree's crown, a cactus or a harmful plant, or
    with no ground within reach (the server's block tests; the chunk must be loaded)."""
    test = lambda y, b: "passed" in rcon_fast(f"execute if block {x} {y} {z} {b}").lower()
    top, g = y0 + 32, None
    if not test(top, "#minecraft:replaceable"):
        return None
    for y in range(top - 1, y0 - 24, -1):
        if test(y, "#minecraft:replaceable"):
            continue
        # (26.1's #replaceable holds no flowers, tall flowers or saplings: open too, tested only where a block is not
        # replaceable; #replaceable_by_trees also holds the leaves, so a crown is caught first)
        if any(test(y, b) for b in ("#minecraft:leaves", "minecraft:sweet_berry_bush", "minecraft:wither_rose", "minecraft:cactus")):
            return None
        if test(y, "#minecraft:replaceable_by_trees") or test(y, "#minecraft:saplings"):
            continue
        g = y
        break
    if g is None:
        return None
    # (#replaceable holds water and lava, so the scan above goes down to a lake's bed)
    if any(test(g + k, b) for k in (1, 2) for b in ("minecraft:water", "minecraft:lava")):
        return None
    if any(test(g, b) for b in ("#minecraft:logs", "minecraft:bamboo", "minecraft:sugar_cane", "minecraft:lily_pad")) or test(g - 1, "minecraft:water"):
        return None
    return g + 1


def ring_spawns(area, agents, y0):
    """A stand spot on the ring for each agent, read from the world (lesson 37): {name: (x, y, z)}, y None where no ground
    was found within 6 blocks outward or 4 along the ring (the server's surface spawn there)."""
    pts = ring_points(area, len(agents))
    box = (area["x1"] - 15, area["z1"] - 15, area["x2"] + 15, area["z2"] + 15)
    rcon(f"forceload add {box[0]} {box[1]} {box[2]} {box[3]}")
    for _ in range(20):
        if all("passed" in rcon_fast(f"execute if loaded {px} {y0} {pz}").lower() for px, pz, _, _ in pts):
            break
        time.sleep(0.5)
    spots = {}
    for n, (px, pz, nx, nz) in zip(agents, pts):
        spot = None
        for k in range(7):
            for s in (0, 2, -2, 4, -4):
                x, z = px + nx * k - nz * s, pz + nz * k + nx * s
                y = stand_ground(x, z, y0)
                if y is not None:
                    spot = (x, y, z)
                    break
            if spot:
                break
        spots[n] = spot or (px, None, pz)
        print(f"SPAWN {n}: {f'ground at {spot[0]},{spot[1]},{spot[2]}' if spot else f'no ground near {px},{pz}: the server surface spawn there'}", flush=True)
    rcon(f"forceload remove {box[0]} {box[1]} {box[2]} {box[3]}")
    return spots


def check_spawn(n, spot):
    """Where the agent stands after its spawn, against the spot (lesson 51: a spawn can silently go elsewhere); one teleport
    by command if it is off, its answer printed."""
    x, y, z = spot
    for attempt in range(2):
        a = next((q for q in (call("/agents") or []) if isinstance(q, dict) and q.get("name") == n), None)
        p = (a or {}).get("position")
        if p and math.hypot(p["x"] - (x + 0.5), p["z"] - (z + 0.5)) <= (1.5 if y is not None else 20) and (y is None or abs(p["y"] - y) <= 1.5):
            print(f"SPAWN CHECK {n}: at {p['x']:.1f},{p['y']:.1f},{p['z']:.1f}", flush=True)
            return True
        where = f"{p['x']:.1f},{p['y']:.1f},{p['z']:.1f}" if p else "nowhere (no position)"
        if attempt or y is None:
            print(f"SPAWN WARNING {n}: at {where}, not at {x},{y},{z}", flush=True)
            return False
        print(f"SPAWN WARNING {n}: at {where}, not at {x},{y},{z}; tp: {rcon(f'tp {n} {x + 0.5} {y} {z + 0.5}') or 'no answer'}", flush=True)
        time.sleep(2)
    return False


def bring_player(agent):
    """If the watching player (MCAI_PLAYER, default SausageOfDoom4) is in the game, teleport them to the agent."""
    player = os.environ.get("MCAI_PLAYER", "SausageOfDoom4")
    rc = [sys.executable, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mc", "rcon.py")]
    try:
        online = subprocess.run(rc + ["list"], capture_output=True, text=True, timeout=10).stdout
        if player and player in online:
            print(subprocess.run(rc + [f"tp {player} {agent}"], capture_output=True, text=True, timeout=10).stdout.strip(), flush=True)
    except Exception as e:
        print(f"could not bring {player} to {agent}: {e}", flush=True)


def find_land(x, z, size):
    """Search outward from x,z for room for the plot (an idle survival probe runs find_site, which prefers ground with trees near)."""
    points = [(x, z)] + [(x + r * math.cos(a * math.pi / 4), z + r * math.sin(a * math.pi / 4)) for r in (120, 240) for a in range(8)]
    for px, pz in points:
        call("/agents/Mayor", method="DELETE")
        # No height: the server puts it on the surface (y 90 put agents inside hills, F84)
        call("/agents", {"name": "Mayor", "brain": "idle", "gamemode": "survival", "reset": True, "position": {"x": px + 0.5, "z": pz + 0.5}})
        time.sleep(8)
        call("/agents/Mayor/act", {"action": "find_site", "size": size})
        # find_site takes a few seconds, more when it walks farther out (to atlas candidates: up to 300 blocks, step 2.3)
        for _ in range(300):
            time.sleep(1)
            if [e for e in call("/agents/Mayor/events?since=0") if e["type"] in ("action_done", "action_failed")]:
                break
        site = call("/agents/Mayor/memory").get("lastSite")
        call("/agents/Mayor", method="DELETE")
        # find_site falls back to the largest site near by: that is too small for the layout
        if site and site.get("size", size) >= size:
            print(f"land near {px:.0f},{pz:.0f}: site {site}", flush=True)
            return site
    raise SystemExit("no land found")


# ---- the village and its designs
if args.resume:
    # A village saved complete in a checkpoint: read it as it stands
    v = call(f"/village/{args.village}")
    if "error" in v or not v.get("tasks"):
        raise SystemExit(f"no village {args.village} with tasks at {API} (restore its checkpoint first: "
                         f"python scripts/reset_site.py SITE --checkpoint CP; --list shows them): {str(v)[:200]}")
    if not v.get("complete"):
        raise SystemExit(f"village {args.village} is not complete in this world: --resume needs a checkpoint saved after completion")
    tasks = v["tasks"]
    hut = v.get("storageHut")
    built_designs = [m.group(1) for t in tasks if t["title"].startswith("Build ") for m in [re.search(r'build_design "([^"]+)"', t["detail"])] if m]
    lay = (v.get("layouts") or [{}])[0]
    if test_site and test_site.get("site"):
        site = test_site["site"]
    elif lay and "x1" in lay:
        site = {"x": (lay["x1"] + lay["x2"]) // 2, "y": lay.get("y", 64), "z": (lay["z1"] + lay["z2"]) // 2,
                "size": max(lay["x2"] - lay["x1"], lay["z2"] - lay["z1"]) + 1}
    else:
        raise SystemExit(f"village {args.village} has no layout to spawn round")
    size = site.get("size", 30)
    print(f"RESUME village {args.village}: complete, {len(tasks)} tasks, {len(v.get('structures') or [])} structures, "
          f"{len(v.get('layouts') or [])} layout(s), growth {'yes' if v.get('growth') else 'none'}; site {json.dumps(site)}", flush=True)
else:
    call("/village", {"name": args.village, "objective": f"test: {', '.join(buildings)}"})
    designs = {"testhut": TESTHUT, "testhall": TESTHALL, "stairhut": STAIRHUT, "stairhall": STAIRHALL}
    for spec in args.design_from:
        src, name = spec.split(":")
        d = call(f"/village/{src}").get("designs", {}).get(name)
        if not d:
            raise SystemExit(f"no design {name} in {src}")
        designs[name] = {**d, "layers": [[" ".join(r) for r in layer] for layer in d["layers"]]}
    for path in args.design_file:
        d = json.load(open(path, encoding="utf-8"))
        designs[d["name"]] = {**d, "layers": [[" ".join(r) for r in layer] for layer in d["layers"]]}
    for name in set(buildings):
        if name in GEN_STYLES and name not in designs:
            designs[name] = generated(name)
        if name not in designs:
            raise SystemExit(f"unknown design {name}: use testhut, --design-from VILLAGE:{name} or --design-file FILE")
        r = call(f"/village/{args.village}/designs", designs[name])
        print(f"design {name}: {r}", flush=True)

    # ---- site and layout (the size covers the plot plus prepare_site's margin; a new village gets a 7x9 storage hut too)
    biggest = max(9, *(max(designs[n]["width"], designs[n]["depth"]) for n in buildings))
    size = min(36, int(math.ceil(math.sqrt(len(buildings) + 1))) * (biggest + 3) + 8)
    if args.site_at:
        f = args.site_at.split(",")
        # (a sixth field, the logs of that wood near the site as find_site counts them, gives the village a wood kind as in
        # model-driven runs: plan_layout sets one only with enough of it, F164's tests)
        site = {"x": int(f[0]), "y": int(f[1]), "z": int(f[2]), "size": int(f[3]), **({"wood": f[4]} if len(f) > 4 else {}),
                **({"woodLogs": int(f[5])} if len(f) > 5 else {})}
        print(f"site given: {json.dumps(site)}", flush=True)
    elif test_site and test_site.get("site"):
        site = test_site["site"]
        print(f"site {test_site['name']} from test_sites.json: {json.dumps(site)}", flush=True)
        # (a rough estimate: the layout packs tighter, e.g. two 9x9 houses, an 11x11 hall and the huts in 24x31; the layout's
        # own answer says when they do not fit)
        if site.get("size", size) < size:
            print(f"the recorded site is {site['size']} blocks across, these buildings may need {size}: if the layout leaves "
                  f"some out, set its site to null in scripts/test_sites.json and run once more to find a bigger one", flush=True)
    else:
        site = find_land(args.x, args.z, size)
        if test_site:
            found = {k: site[k] for k in ("x", "y", "z", "size", "wood", "woodLogs") if k in site}
            print(f"record this in test_sites.json as the site of {test_site['name']}: {json.dumps(found)}", flush=True)
    r = call(f"/village/{args.village}/layout", {"buildings": buildings, "x": site["x"], "y": site["y"], "z": site["z"], "size": site.get("size", size), "wood": site.get("wood"), "woodLogs": site.get("woodLogs"),
                                                 "plan": args.plan, **({"biome": args.biome} if args.plan == "street" else {}),
                                                 # (how many will work it: S.6 splits the plot into more parts with four or more,
                                                 # and the workers are spawned only after the layout)
                                                 "workers": args.workers, **({"by": "Mayor"} if args.mayor else {})})
    print(r.get("result") or r, flush=True)
    if "error" in r:
        raise SystemExit(1)
    tasks = r["tasks"]
    hut = call(f"/village/{args.village}").get("storageHut")
    # Every design the layout builds (the storage hut included)
    built_designs = [m.group(1) for t in tasks if t["title"].startswith("Build ") for m in [re.search(r'build_design "([^"]+)"', t["detail"])] if m]
GROUPS = [("logs", r"_(log|wood|stem|hyphae)$"), ("planks", r"_planks$"),
          ("cobblestone", r"^(cobblestone|cobbled_deepslate|stone|smooth_stone|deepslate|andesite|diorite|granite|tuff)$"),
          ("sand", r"^(red_)?(sand|sandstone)$"), ("glass", r"^glass(_pane)?$"), ("terracotta", r"terracotta$")]


def group_of(item):
    """The storage group an item is sorted into (mcStorage.ts groupOf)."""
    return next((g for g, rx in GROUPS if re.search(rx, item)), "misc")


def stock_needed():
    """Every building's raw materials, plus a crafting table's and a furnace's worth (logs in the village's wood kind;
    with --mixed-wood, half of them in another kind)."""
    need = {}
    wood = None
    for n in built_designs:
        bill = call(f"/village/{args.village}/designs/{n}/bill")
        wood = bill.get("wood") or "oak"
        for item, q in bill.get("gather", {}).items():
            item = f"{wood}_log" if item == "any:logs" else "cobblestone" if item == "any:cobblestone" else item.replace("any:", "")
            need[item] = need.get(item, 0) + q
    # (and in a hut village, for the chests the deposit check crafts: 3 logs each)
    need[f"{wood}_log"] = need.get(f"{wood}_log", 0) + (13 if hut else 4)
    need["cobblestone"] = need.get("cobblestone", 0) + 8
    # (and the farm's 16 seeds and a log for its hoe, 10-08: --stage build marks the seed tasks done)
    need["wheat_seeds"] = need.get("wheat_seeds", 0) + 16
    need[f"{wood}_log"] = need.get(f"{wood}_log", 0) + 1
    if args.mixed_wood:
        other = "spruce" if wood != "spruce" else "birch"
        for item in [i for i in need if i.endswith("_log")]:
            half = need[item] // 2
            need[item] -= half
            need[f"{other}_log"] = need.get(f"{other}_log", 0) + half
    return need


def fill_chest(x, y, z, items):
    slot = 0
    for item, q in items.items():
        while q > 0 and slot < 27:
            n = min(64, q)
            rcon(f"item replace block {x} {y} {z} container.{slot} with minecraft:{item} {n}")
            q -= n
            slot += 1


def stock_hut():
    """Put chests into the storage hut's spots on the prepared plot, one per material group, stocked, registered."""
    v = call(f"/village/{args.village}")
    plot = next((q for q in v["plots"] if q["x1"] <= hut["x1"] and q["x2"] >= hut["x2"] and q["z1"] <= hut["z1"] and q["z2"] >= hut["z2"]), None)
    if not plot:
        raise SystemExit(f"no prepared plot covers the storage hut {hut}")
    y = plot["y"] + 1
    by_group = {}
    for item, q in stock_needed().items():
        by_group.setdefault(group_of(item), {})[item] = q
    for spot, (group, items) in zip(hut["spots"], by_group.items()):
        sx, sz = spot["x"], spot["z"]
        rcon(f"forceload add {sx} {sz}")
        time.sleep(1)
        print(rcon(f"setblock {sx} {y} {sz} chest"), flush=True)
        fill_chest(sx, y, sz, items)
        print(call(f"/village/{args.village}/storage", {"x": sx, "y": y, "z": sz, "group": group}).get("result"), group, items, flush=True)
        rcon(f"forceload remove {sx} {sz}")


def harvest_check():
    """Farming v2: set the field's wheat ripe by command, wait for the harvest chore, check bread and the resown field."""
    v = call(f"/village/{args.village}")
    if args.mayor:
        for _ in range(40):
            if v.get("complete"):
                break
            time.sleep(3)
            v = call(f"/village/{args.village}")
    print(f"HARVEST village {'complete' if v.get('complete') else 'not complete'}: the harvest runs "
          f"{'after' if v.get('complete') else 'before'} completion", flush=True)
    farm = ((v.get("layouts") or [{}])[0]).get("farm")
    if not farm or not farm.get("planted"):
        print("HARVEST FAIL: no planted farm", flush=True)
        return
    plot = next((p for p in v["plots"] if p["x1"] <= farm["x1"] and p["x2"] >= farm["x2"] and p["z1"] <= farm["z1"] and p["z2"] >= farm["z2"]), None)
    if not plot:
        print("HARVEST FAIL: no plot holds the farm", flush=True)
        return
    y = plot["y"] + 1
    # The cells holding wheat now: each must hold wheat again after the harvest (sown, not left bare)
    sown = [(x, z) for x, z in farm["sow"] if call(f"/block?x={x}&y={y}&z={z}").get("block") == "wheat"]
    harvests0 = farm.get("harvests") or 0
    bread0 = sum(c["items"].get("bread", 0) for c in (v.get("storage") or {}).get("chests", []))
    since = {n: 0 for n in watched}
    for n in watched:
        ev = call(f"/agents/{n}/events?since=0")
        since[n] = max([e["id"] for e in ev] + [0]) if isinstance(ev, list) else 0
    print("HARVEST ripen:", rcon(f"fill {farm['x1']} {y} {farm['z1']} {farm['x2']} {y} {farm['z2']} minecraft:wheat[age=7] replace minecraft:wheat"), flush=True)
    t1, done = time.time(), None
    while time.time() - t1 < 240 and done is None:
        time.sleep(3)
        for n in watched:
            ev = call(f"/agents/{n}/events?since={since[n]}")
            if not isinstance(ev, list):
                continue
            for e in ev:
                since[n] = e["id"]
                if e["type"] in ("action_done", "action_failed") and "harvest_farm" in e["text"]:
                    print(f"HARVEST {(time.time() - t1) / 60:4.1f}m {n:8} {e['type']:13} | {e['text'][:300]}", flush=True)
                    done = e["type"] == "action_done"
    if done is None:
        f2 = ((call(f"/village/{args.village}").get("layouts") or [{}])[0]).get("farm") or {}
        print(f"HARVEST FAIL: no harvest within 4 minutes (last: {f2.get('lastHarvest')})", flush=True)
        return
    time.sleep(2)
    v = call(f"/village/{args.village}")
    bread = sum(c["items"].get("bread", 0) for c in (v.get("storage") or {}).get("chests", [])) - bread0
    ages, bad = [], []
    for x, z in sown:
        b = call(f"/block?x={x}&y={y}&z={z}")
        if b.get("block") == "wheat":
            ages.append(int((b.get("properties") or {}).get("age", -1)))
        else:
            bad.append(f"{x},{z}:{b.get('block')}")
    ripe = sum(1 for a in ages if a >= 7)
    f2 = ((v.get("layouts") or [{}])[0]).get("farm") or {}
    ok = done and bread > 0 and not ripe and not bad and (f2.get("harvests") or 0) > harvests0
    print(f"HARVEST {'PASS' if ok else 'FAIL'}: bread +{bread} in storage, field {len(ages)} of {len(sown)} wheat (ages {sorted(ages)}), "
          f"{ripe} still ripe, not wheat {bad[:8]}; record harvests={f2.get('harvests')} bread={f2.get('bread')} "
          f"last={f2.get('lastHarvest')}", flush=True)


def deposit_check(worker):
    """Give the worker mixed items, have it deposit everything, and check each chest holds only its own group, in the hut."""
    gift = {"cobblestone": 5, "oak_log": 7, "sand": 3, "glass": 4, "oak_planks": 6, "torch": 2, "cocoa_beans": 3}
    # Not while it still holds a task: the mine task ends with its own deposit, which took the gift (StageM1)
    for _ in range(60):
        v = call(f"/village/{args.village}")
        if not any(t["status"] == "claimed" and t.get("claimedBy") == worker for t in v["tasks"]):
            break
        time.sleep(3)
    for item, q in gift.items():
        rcon(f"give {worker} minecraft:{item} {q}")
    time.sleep(2)
    events = call(f"/agents/{worker}/events?since=0")
    seen = max([e["id"] for e in events] + [0]) if isinstance(events, list) else 0
    call(f"/agents/{worker}/act", {"action": "deposit", "item": "all"})
    result = None
    for _ in range(200):
        time.sleep(3)
        events = call(f"/agents/{worker}/events?since={seen}")
        for e in events if isinstance(events, list) else []:
            seen = e["id"]
            if e["type"] in ("action_done", "action_failed") and ((e.get("data") or {}).get("type") == "deposit" or "deposit" in e["text"][:60].lower()):
                result = e
        if result:
            break
    print(f"DEPOSIT {result and result['type']}: {result and result['text'][:400]}", flush=True)
    v = call(f"/village/{args.village}")
    h = v.get("storageHut") or {}
    ok = bool(result and result["type"] == "action_done")
    for i, c in enumerate(v["storage"]["chests"]):
        wrong = [n for n, q in c["items"].items() if q > 0 and group_of(n) != c.get("group")]
        inside = h and h["x1"] < c["x"] < h["x2"] and h["z1"] < c["z"] < h["z2"]
        block = call(f"/block?x={c['x']}&y={c['y']}&z={c['z']}")
        print(f"  chest {i + 1} ({c.get('group')}) at {c['x']},{c['y']},{c['z']}: {c['items']}"
              f"{'' if inside else ' NOT INSIDE THE HUT'}{' WRONG: ' + ', '.join(wrong) if wrong else ''}; block: {block.get('block', block)}", flush=True)
        ok = ok and inside and not wrong and block.get("block") == "chest"
    print(f"DEPOSIT CHECK {'PASSED' if ok else 'FAILED'}", flush=True)
    return ok


# ---- stage build: storage placed and stocked, gathering done
storage_spot = None
hut_storage = None
if args.stage == "build":
    for t in tasks:
        if t["status"] == "open" and t["title"].startswith("Gather"):
            call(f"/village/{args.village}/tasks/{t['id']}", {"status": "done"})
        if t["status"] == "open" and t["title"].startswith("Set up the village storage"):
            if hut:
                # Held back from the workers: the chests go in by command once the plot is prepared
                call(f"/village/{args.village}/tasks/{t['id']}", {"status": "claimed", "by": "stage"})
                hut_storage = t["id"]
            else:
                call(f"/village/{args.village}/tasks/{t['id']}", {"status": "done"})
        m = re.search(r"move_to x=(-?\d+) y=(-?\d+) z=(-?\d+)", t["detail"])
        if t["title"].startswith("Set up the village storage") and m and not hut:
            storage_spot = tuple(int(v) for v in m.groups())

if storage_spot:
    # Before any worker exists (a worker claimed the build before the chest was there): load the chunk, find the
    # ground with the server's own block tests, place the chest, register it and stock it
    sx, sy, sz = storage_spot
    rcon(f"forceload add {sx} {sz}")
    time.sleep(1)
    y = None
    for yy in range(sy + 12, sy - 24, -1):
        if "passed" in rcon(f"execute unless block {sx} {yy} {sz} #minecraft:replaceable").lower():
            y = yy + 1
            break
    if y is None:
        raise SystemExit(f"could not find the ground at {sx},{sz} for the storage chest")
    print(rcon(f"setblock {sx} {y} {sz} chest"), flush=True)
    need = stock_needed()
    fill_chest(sx, y, sz, need)
    print(call(f"/village/{args.village}/storage", {"x": sx, "y": y, "z": sz}).get("result"), flush=True)
    rcon(f"forceload remove {sx} {sz}")
    print(f"storage at {sx},{y},{sz} stocked with {need}", flush=True)

def ground_at(x, z, near_y):
    """The top solid block's y at x, z (the server's block tests; the chunk forceloaded meanwhile)."""
    for yy in range(near_y + 16, near_y - 24, -1):
        if "passed" in rcon(f"execute unless block {x} {yy} {z} #minecraft:replaceable").lower():
            return yy
    return None


def plant_fixtures():
    """Sightings to farm (opportunistic farming): sugar cane two high beside a water cell, three pumpkins, one melon,
    each 35-45 blocks off the site's centre (outside its plot and margin)."""
    gy = site.get("y", 64)
    spots = {"sugar_cane": (site["x"] + 35, site["z"] + 35), "pumpkin": (site["x"] + 42, site["z"] - 6), "melon": (site["x"] - 8, site["z"] + 42)}
    for kind, (x, z) in spots.items():
        fixtures[kind] = []
        rcon(f"forceload add {x - 2} {z - 2} {x + 4} {z + 2}")
        time.sleep(1)
        out = []
        for i in range(3 if kind != "melon" else 1):
            cx = x + 2 * i
            g = ground_at(cx, z, gy)
            if g is None:
                out.append(f"no ground at {cx},{z}")
                continue
            if kind == "sugar_cane":
                out += [rcon(f"setblock {cx} {g} {z} minecraft:dirt"), rcon(f"setblock {cx} {g} {z + 1} minecraft:water"),
                        rcon(f"fill {cx} {g + 1} {z} {cx} {g + 2} {z} minecraft:sugar_cane")]
            else:
                out.append(rcon(f"setblock {cx} {g + 1} {z} minecraft:{kind}"))
            fixtures[kind].append((cx, g + (2 if kind == "sugar_cane" else 1), z))
        print(f"FIXTURE {kind} at {x},{z}: {'; '.join(o for o in out if o)[:200]}", flush=True)
        rcon(f"forceload remove {x - 2} {z - 2} {x + 4} {z + 2}")


def summon_chickens():
    """Chickens to lure into a pen (the annex, 10-09): four, kept from despawning, 2 apart along z some 38-45 blocks off the
    site's centre (off the other fixtures), on ground within 2 of the site's level: VanA1's spot was a hill 10 above the
    annex, and chickens up there were out of the bot's tempt range and would not come down."""
    gy = site.get("y", 64)
    lo, hi = (int(v) for v in args.fixture_dy.split(":"))
    if args.fixture_clear:
        sx_, sz_ = int(site["x"]), int(site["z"])
        rcon(f"forceload add {sx_ - 120} {sz_ - 120} {sx_ + 120} {sz_ + 120}")
        time.sleep(3)
        for kind in ("chicken", "cow"):
            print(f"FIXTURE clear {kind}: {rcon(f'kill @e[type={kind},x={sx_},y={gy},z={sz_},distance=..120]')}", flush=True)
        rcon(f"forceload remove {sx_ - 120} {sz_ - 120} {sx_ + 120} {sz_ + 120}")
    best = None
    # (the usual spots, then rings 45-60 out for ground above the site: F205's chickens and cow stood 5-8 above the annex;
    # within 60 so the pen chore's 96 from the annex (25-30 off the centre) covers them; soil only, not a tree's crown:
    # review H1)
    spots = [(-38, -8), (-38, 8), (-42, 20), (-10, -42), (20, -40), (40, 20), (-42, -24), (10, 42)]
    spots += [(round(r * math.cos(a * math.pi / 8)), round(r * math.sin(a * math.pi / 8))) for r in (45, 52, 60) for a in range(16)]
    if args.fixture_at:
        fx, fz = (int(v) for v in args.fixture_at.split(","))
        # (a few blocks round it: a tree or a step there, VanH1)
        spots = sorted(((fx + ox - int(site["x"]), fz + oz - int(site["z"])) for ox in range(-6, 7, 2) for oz in range(-6, 7, 2)),
                       key=lambda d: abs(d[0] + int(site["x"]) - fx) + abs(d[1] + int(site["z"]) - fz))
    for dx, dz in spots:
        x, z = int(site["x"]) + dx, int(site["z"]) + dz
        rcon(f"forceload add {x - 1} {z - 1} {x + 1} {z + 7}")
        time.sleep(1)
        gs = [ground_at(x, z + 2 * i, gy) for i in range(4)]
        # (grass_block is not in 26.1's #minecraft:dirt: VanH2 found no spot on a grassy rise)
        soil = all(g is not None and lo <= g - gy <= hi for g in gs) and all(any("passed" in rcon(f"execute if block {x} {g} {z + 2 * i} {b}").lower() for b in ("minecraft:grass_block", "#minecraft:dirt"))
                   for i, g in enumerate(gs))
        rcon(f"forceload remove {x - 1} {z - 1} {x + 1} {z + 7}")
        if soil and all(lo <= g - gy <= hi for g in gs):
            best = (x, z, gs)
            break
    if not best:
        print(f"FIXTURE chicken: no spot {lo}..{hi} above the site's level", flush=True)
        return
    x, z, gs = best
    rcon(f"forceload add {x - 1} {z - 1} {x + 1} {z + 7}")
    time.sleep(1)
    out = [rcon(f'summon chicken {x}.5 {g + 1} {z + 2 * i}.5 {{Tags:["stagefix","luretest"],PersistenceRequired:1b}}') for i, g in enumerate(gs)]
    print(f"FIXTURE chicken at {x},{z}..{z + 6} (ground {min(gs)}..{max(gs)}): {'; '.join(o for o in out if o)[:200]}", flush=True)
    # (two cows on the same ground, pens v2: a cow pen once storage holds wheat)
    out = [rcon(f'summon cow {x}.5 {gs[i] + 1} {z + 2 * i}.5 {{Tags:["stagefix","luretest"],PersistenceRequired:1b,Age:0}}') for i in (0, 2)]
    print(f"FIXTURE cow at {x},{z}..{z + 4}: {'; '.join(o for o in out if o)[:200]}", flush=True)
    rcon(f"forceload remove {x - 1} {z - 1} {x + 1} {z + 7}")


fixtures = {}
if args.fixtures:
    plant_fixtures()
    summon_chickens()

# ---- workers
names = [f"Worker{i + 1}" for i in range(args.workers)]
exec_model = os.environ.get("MCAI_EXEC_MODEL", "ollama:gpt-oss:120b-cloud")
reasoning = {"reasoning": os.environ["MCAI_REASONING"]} if os.environ.get("MCAI_REASONING") else {}
# (A.2: every spawn alike, since one village runs one mode; without --choose nothing is sent and MC_CHOOSE decides)
choose_mem = {"choose": args.choose} if args.choose else {}
watched = names + (["Mayor"] if args.mayor else [])
# Spawns on a ring outside the plot and its margin (S.0: a line of 12 at x + 2i ran off the plot into trees and water)
lay0 = (call(f"/village/{args.village}").get("layouts") or [None])[0 if args.resume else -1]
half = site.get("size", size) // 2
area = lay0 if lay0 and "x1" in lay0 else {"x1": site["x"] - half, "z1": site["z"] - half, "x2": site["x"] + half - 1, "z2": site["z"] + half - 1}
spots = ring_spawns(area, watched, int(site.get("y", 64)))


def spawn_at(spot):
    x, y, z = spot
    return {"x": x + 0.5, **({"y": y} if y is not None else {}), "z": z + 0.5}


# The run's usage counts from here
usage_since = int(time.time() * 1000)
last_spawn = [0.0]


def spawn_gap():
    """Wait out the rest of SPAWN_GAP since the last spawn POST (the spawn's check counts toward it)."""
    time.sleep(max(0.0, last_spawn[0] + SPAWN_GAP - time.time()))
    last_spawn[0] = time.time()


for i, n in enumerate(names):
    call(f"/agents/{n}", method="DELETE")
    mem = {"village": args.village, "buildSpeed": 4, **reasoning, **choose_mem}
    if args.brain == "tiered":
        mem.update({"planModel": args.planner, "execModel": exec_model})
    spawn_gap()
    r = call("/agents", {"name": n, "role": "builder", "brain": args.brain, "gamemode": "survival", "reset": True,
                         "position": spawn_at(spots[n]), "memory": mem})
    print(f"{n}: {r}", flush=True)
    check_spawn(n, spots[n])
if args.mayor:
    # The layout is the Mayor's own (posted with by=Mayor) and its plan is empty: the brain sees a mayor waiting for its
    # workers, which gathers meanwhile (V2.3m)
    call("/agents/Mayor", method="DELETE")
    spawn_gap()
    r = call("/agents", {"name": "Mayor", "role": "mayor", "brain": "tiered", "gamemode": "survival", "reset": True,
                         "position": spawn_at(spots["Mayor"]),
                         "memory": {"village": args.village, "villageRole": "mayor", "buildSpeed": 4, "planModel": args.planner,
                                    "execModel": exec_model, **reasoning, **choose_mem,
                                    "plan": {"goal": "wait for the workers", "steps": [], "by": "external"}}})
    print(f"Mayor: {r}", flush=True)
    check_spawn("Mayor", spots["Mayor"])
print(f"RUN village={args.village} agents={','.join(watched)} start={usage_since}{f' choose={args.choose}' if args.choose else ''}", flush=True)
bring_player(names[0])

# ---- watch
t0, seen, board, reason, last_done = time.time(), {n: 0 for n in watched}, "", "time limit", time.time()
fails = {}
last_need = None
stamp = lambda: f"{(time.time() - t0) / 60:4.1f}m"
# S.0's measurements: busy and idle time per agent, the board's stamps for the critical path, each agent's last success;
# S.2's, the mine's
clock, stamps, last_ok, complete_at = BusyClock(watched), BoardStamps(), {n: time.time() for n in watched}, None
if args.resume:
    # (setting the reason skips the build's watch below: the after phase starts at once)
    reason, complete_at = "every building is done", t0
    print(f"{stamp()} RESUMED complete village: the after phase starts now", flush=True)
mine_stats = MineStats()
stock_seen = [None, 0.0]
# S.4's: the minutes the Mayor ran an action while it held a lamp or sign task (before completion)
tail_busy = [0.0, None]
TAIL_CALL = re.compile(r"^(light_streets|put_up_signs) ")
# S.5's: the stations as recorded (printed as each appears), and when the storage first held panes (or glass)
stations_seen = {}
panes_at = [None, ""]
STATION_LABEL = {"crafting_table": "table", "furnace": "furnace"}


def watch_stations(v):
    """S.5: a STATION line when the village records its table or furnace standing (placed in the hut's cell), and the first
    time the storage holds the windows' panes or glass."""
    for n, s in (v.get("stations") or {}).items():
        if n not in stations_seen:
            stations_seen[n] = s
            print(f"{stamp()} STATION {STATION_LABEL.get(n, n)} at {s['x']},{s['y']},{s['z']} by {s.get('by')} via {s.get('via')} "
                  f"(t={(s['at'] / 1000 - t0) / 60:.1f}m)", flush=True)
    tot = storage_totals(v)
    q = tot.get("glass_pane", 0) + tot.get("glass", 0)
    if panes_at[0] is None and q > 0:
        panes_at[:] = [time.time(), f"{tot.get('glass_pane', 0)} glass_pane, {tot.get('glass', 0)} glass"]
        print(f"{stamp()} PANES in storage: {panes_at[1]}", flush=True)


def station_lines(v):
    """S.5's outputs: when each station stood (STATIONS), the panes in storage against the first house's claim (PANES), and
    a sweep of the layout and 8 blocks round it (GET /api/blocks, y-6..y+10 of the plot) for any crafting table or furnace
    outside the storage hut's two cells (lesson 33, F59, F68): STATIONS SWEEP clean, or STRAY with each one."""
    out = []
    st = v.get("stations") or {}
    parts = []
    for n in ("crafting_table", "furnace"):
        s = st.get(n)
        parts.append(f"{STATION_LABEL[n]} t={(s['at'] / 1000 - t0) / 60:.1f}m ({s.get('by')}, via {s.get('via')})" if s else f"{STATION_LABEL[n]} not recorded")
    out.append("STATIONS " + " ".join(parts))
    houses = [t for t in v["tasks"] if t["title"].startswith("Build ") and not re.search(r'build_design "(storage_hut|mining_hut)"', t["detail"])]
    claims = [c for c in (stamps.first_claim(t) for t in houses) if c]
    first_house = min(claims) if claims else None
    p = f"t={(panes_at[0] - t0) / 60:.1f}m ({panes_at[1]})" if panes_at[0] else "never"
    h = f"t={(first_house - t0) / 60:.1f}m" if first_house else "never"
    verdict = "before" if panes_at[0] and (not first_house or panes_at[0] <= first_house + 3) else "AFTER" if first_house else "n/a"
    out.append(f"PANES in storage {p}; first house claimed {h}: {verdict}{' (within a poll)' if verdict == 'before' and first_house and panes_at[0] > first_house else ''}")
    hut_ = v.get("storageHut")
    lay = (v.get("layouts") or [None])[0]
    if not hut_ or not lay:
        out.append("STATIONS SWEEP skipped: no storage hut or layout")
        return out
    plot = next((q for q in v.get("plots") or [] if q["x1"] <= hut_["x1"] and q["x2"] >= hut_["x2"] and q["z1"] <= hut_["z1"] and q["z2"] >= hut_["z2"]), None)
    y0 = plot["y"] if plot else int(site.get("y", 64))
    own = {(hut_["x1"] + 2, y0 + 1, hut_["z1"] + 4): "crafting_table", (hut_["x1"] + 4, y0 + 1, hut_["z1"] + 4): "furnace"}
    for n, s in st.items():
        own[(s["x"], s["y"], s["z"])] = n
    x1, z1, x2, z2 = lay["x1"] - 8, lay["z1"] - 8, lay["x2"] + 8, lay["z2"] + 8
    w, d = x2 - x1 + 1, z2 - z1 + 1
    per = max(1, 60000 // (w * d))
    found, stray, unloaded = [], [], 0
    for ya in range(y0 - 6, y0 + 11, per):
        yb = min(y0 + 10, ya + per - 1)
        b = call(f"/blocks?x1={x1}&y1={ya}&z1={z1}&x2={x2}&y2={yb}&z2={z2}")
        if not isinstance(b, dict) or "cells" not in b:
            out.append(f"STATIONS SWEEP error: {str(b)[:160]}")
            return out
        for i, c in enumerate(b["cells"]):
            if c < 0:
                unloaded += 1
                continue
            n = b["names"][c].split("[")[0]
            if n in ("crafting_table", "furnace"):
                x, z, y = x1 + i % w, z1 + (i // w) % d, ya + i // (w * d)
                (found if own.get((x, y, z)) == n else stray).append(f"{n} {x},{y},{z}")
    out.append(f"STATIONS SWEEP {'STRAY' if stray else 'clean'} (x {x1}..{x2}, z {z1}..{z2}, y {y0 - 6}..{y0 + 10}): hut cells "
               f"{', '.join(found) or 'empty'}; elsewhere {', '.join(stray) or 'none'}{f'; {unloaded} cells unloaded' if unloaded else ''}")
    return out


def signs_waited(v):
    """The signs completion waits for, as the server's signsMissing: each not recorded up whose own task is on the board and
    not failed (a sign with no task, or a layout marked signed, is not waited on)."""
    out = []
    for i, lay in enumerate(v.get("layouts") or []):
        if lay.get("signed"):
            continue
        for s in lay.get("signs") or []:
            call_ = f"put_up_signs layout={i + 1} x={s['cx']} z={s['cz']} "
            t = None if s.get("up") else next((t for t in v["tasks"] if t["detail"].startswith(call_)), None)
            if t and t["status"] != "failed":
                out.append(f"{t['title'][17:]} ({t['id']} {t['status']})")
    return out


def check_tail(v):
    """At completion (S.4): every recorded sign read on the server by its text (data get, at its recorded height), and every
    lamp's torch (lesson 50: lamps go up before the houses now, and a later build or walkway could break one)."""
    n = up = 0
    for i, lay in enumerate(v.get("layouts") or []):
        for s in lay.get("signs") or []:
            n += 1
            got = rcon_fast(f"data get block {s['x']} {s['y']} {s['z']} front_text.messages") if s.get("y") is not None else ""
            if all(json.dumps(x) in got for x in s["text"] if x) and "following block data" in got:
                up += 1
            else:
                print(f"SIGN MISSING {s['building']} at {s['x']},{s.get('y', '?')},{s['z']} (layout {i + 1}; recorded up {s.get('up')}{', ' + s['why'] if s.get('why') else ''}): {got[:120]}", flush=True)
    if n:
        print(f"SIGNS {up}/{n} up (data get)", flush=True)
    lamps = lit = 0
    for lay in v.get("layouts") or []:
        for c in lay.get("lamps") or []:
            lamps += 1
            plot = next((p for p in v.get("plots") or [] if p["x1"] <= c["x"] <= p["x2"] and p["z1"] <= c["z"] <= p["z2"]), None)
            if plot and any("passed" in rcon_fast(f"execute if block {c['x']} {y} {c['z']} minecraft:torch").lower() for y in range(plot["y"] + 1, plot["y"] + 4)):
                lit += 1
            else:
                print(f"LAMP MISSING at {c['x']},{c['z']}", flush=True)
    if lamps:
        print(f"LAMPS {lit}/{lamps} lit (rcon)", flush=True)


def storage_totals(v):
    tot = {}
    for c in (v.get("storage") or {}).get("chests", []):
        for k, q in c["items"].items():
            tot[k] = tot.get(k, 0) + q
    return tot


def stock_line(v, force=False):
    """The storage's totals, when they changed and at most every 30 s (the value curve of autonomy_metrics.py)."""
    tot = storage_totals(v)
    if tot != stock_seen[0] and (force or time.time() - stock_seen[1] >= 30):
        stock_seen[:] = [tot, time.time()]
        print(f"STOCK {stamp()} {json.dumps(tot, sort_keys=True)}", flush=True)


while time.time() - t0 < args.minutes * 60 and reason == "time limit":
    time.sleep(3)
    for n in watched:
        events = call(f"/agents/{n}/events?since={seen[n]}")
        if not isinstance(events, list):
            continue
        for e in events:
            seen[n] = e["id"]
            if e["type"] in ("action_done", "action_failed", "system"):
                print(f"{stamp()} {n:8} {e['type']:13} | {e['text'][:240]}", flush=True)
                mine_stats.event((time.time() - t0) / 60, n, e["type"], e["text"])
            if e["type"] == "action_done":
                last_done = last_ok[n] = time.time()
            # A material that is not within reach is given up by design (soft gather tasks; the build goes without):
            # not a stuck agent (StageT3 and T4 were stopped on sand)
            # (nor a busy mine: a third miner, the gathering Mayor, hands its task back and comes back later, V2.3m)
            # (both are an agent at work for the per-agent stall rule too: a miner waits up to a minute for a face, S.2, then
            # hands its task back)
            # (nor material others are taking: the task goes back for later, S.1)
            # (nor a busy resource or material taken, by their contention codes, E.0; ground reserved by another agent still
            # counts: it is handed back only from a code-posted task)
            if e["type"] == "action_failed" and ("cannot be gathered here" in e["text"] or "the mine is busy" in e["text"] or "being taken by other gatherers" in e["text"]
                                                 or (e.get("data") or {}).get("code") in ("busy", "taken")):
                last_ok[n] = time.time()
            elif e["type"] == "action_failed":
                k = (n, e["text"][:80])
                fails[k] = fails.get(k, 0) + 1
                if fails[k] >= same_fail:
                    reason = f"{n} failed the same way {same_fail} times: {e['text'][:160]}"
    listing = call("/agents")
    clock.sample(listing, "before")
    v = call(f"/village/{args.village}")
    stamps.update(v["tasks"])
    mine_stats.board(v["tasks"])
    stock_line(v)
    watch_stations(v)
    # The stall rule per agent: one that holds a task or runs an action and has had no success for agent_stall minutes
    # (with 12 agents one success reset the village's clock for all); one with nothing to do is idle, not stalled
    holding = {t["claimedBy"]: t["id"] for t in v["tasks"] if t["status"] == "claimed" and t.get("claimedBy")}
    running = {a.get("name"): a.get("action") for a in listing} if isinstance(listing, list) else {}
    for n in watched:
        if n not in holding and not running.get(n):
            last_ok[n] = time.time()
        elif reason == "time limit" and time.time() - last_ok[n] > agent_stall * 60:
            what = f"holding {holding[n]}" if n in holding else f"running {(running.get(n) or {}).get('type', 'an action')}"
            reason = f"{n} stalled: no successful action for {agent_stall:g} minutes while {what}"
    need = " ".join(f"{q} {n}" for n, q in sorted(((v.get("needed") or {}).get("items") or {}).items()))
    if need != last_need:
        last_need = need
        print(f"{stamp()} NEEDED {need or 'nothing'}", flush=True)
    if hut_storage and all(t["status"] == "done" for t in v["tasks"] if t["title"].startswith("Prepare")):
        stock_hut()
        call(f"/village/{args.village}/tasks/{hut_storage}", {"status": "done"})
        hut_storage = None
        last_done = time.time()
        v = call(f"/village/{args.village}")
    b = " ".join(f"{t['id']}:{t['status']}{'/' + t['claimedBy'] if t.get('claimedBy') else ''}" for t in v["tasks"])
    if b != board:
        board = b
        print(f"{stamp()} BOARD {b}", flush=True)
    builds = [t for t in v["tasks"] if t["title"].startswith("Build ")]
    # (and the street lamps and signs, 10-06 and 10-08: the village is complete once they are up; a failed one is soft)
    # (one sign task a building since S.4, "Put up the sign: house 2", and each sign recorded up unless its task failed)
    lamps = [t for t in v["tasks"] if t["title"].startswith(("Light the streets", "Put up the sign", "Plant the farm"))]
    mayor_tail = next((t for t in v["tasks"] if t["status"] == "claimed" and t.get("claimedBy") == "Mayor" and TAIL_CALL.match(t["detail"])), None)
    if mayor_tail and (running.get("Mayor") or None) and tail_busy[1] is not None:
        tail_busy[0] += min(30.0, time.time() - tail_busy[1]) / 60
    tail_busy[1] = time.time()
    if builds and all(t["status"] == "done" for t in builds) and all(t["status"] in ("done", "failed") for t in lamps) and not signs_waited(v):
        reason = "every building is done"
        complete_at = time.time()
        print(f"{stamp()} COMPLETE at {stamp().strip()}", flush=True)
        check_tail(v)
    elif reason == "time limit" and time.time() - last_done > stall_minutes * 60:
        reason = f"stalled: no successful action for {stall_minutes:g} minutes"

if reason == "every building is done" and hut and args.stage == "build" and not args.no_deposit_check:
    deposit_check(names[0])
if reason == "every building is done" and args.harvest:
    harvest_check()
# S.5: the stations, the panes against the first house, and the sweep for stray tables and furnaces (while the agents still
# hold the chunks)
for line in station_lines(call(f"/village/{args.village}")):
    print(line, flush=True)


def slot_text(s):
    return f"{s.get('kind') or 'free'} {s['x1']}..{s['x2']},{s['z1']}..{s['z2']} planted={s.get('planted')} harvests={s.get('harvests')} tries={s.get('tries')}"


def ripen(v, k, s):
    """Set a planted slot ripe by command: crops at their last age, sugar cane a third block, a fruit beside each stem."""
    plot = next((p for p in v["plots"] if p["x1"] <= s["x1"] and p["x2"] >= s["x2"] and p["z1"] <= s["z1"] and p["z2"] >= s["z2"]), None)
    if not plot:
        return "no plot"
    y = plot["y"] + 1
    kind, out = s["kind"], []
    ages = {"carrots": 7, "potatoes": 7, "beetroots": 3}
    for x, z in s.get("cells") or []:
        if kind in ages:
            out.append(rcon(f"setblock {x} {y} {z} minecraft:{kind}[age={ages[kind]}]"))
        elif kind == "sugar_cane":
            out.append(rcon(f"fill {x} {y + 1} {z} {x} {y + 2} {z} minecraft:sugar_cane"))
    for x, z in (s.get("fruit") or [])[::2] if kind in ("pumpkin", "melon") else []:
        out.append(rcon(f"setblock {x} {y} {z} minecraft:{kind}"))
    return f"{len(out)} commands: {'; '.join(o for o in out[:3] if o)[:200]}"


def annex_text(an):
    """The annex record (layouts[0].annex, 10-09) in one line."""
    if not an:
        return "none"
    last = an.get("lastTry") or {}
    pen_last = an.get("penLastTry") or {}
    return (f"{an.get('state')} side {an.get('side')} {an.get('x1')}..{an.get('x2')},{an.get('z1')}..{an.get('z2')} y {an.get('y')} "
            f"tries={an.get('tries')}{' (' + str(last.get('why'))[:120] + ')' if last.get('why') else ''} bad={len(an.get('bad') or [])} "
            f"penTries={an.get('penTries')}{' (' + str(pen_last.get('why'))[:120] + ')' if pen_last.get('why') else ''}"
            f" penBy={json.dumps({k: [q.get('tries'), str(q.get('why'))[:100]] for k, q in (an.get('penBy') or {}).items()})}")


def pen_inner(s):
    """A pen slot's inner 3x5 cells (penPlan's inner box): columns 1..3 across the middle line, rows 1..5 along it."""
    w = s.get("water") or {}
    if w.get("x1") == w.get("x2"):
        # (5 across x, 7 along z)
        return s["x1"] + 1, s["z1"] + 1, s["x1"] + 3, s["z1"] + 5
    return s["x1"] + 1, s["z1"] + 1, s["x1"] + 5, s["z1"] + 3


def pen_text(v, an, s):
    """An annex slot: its kind, the pen's record and, once it has a gate, the animals the server counts inside (and the eggs
    lying there)."""
    pen = s.get("pen") or {}
    t = (f"{s.get('kind') or 'free'} {s['x1']}..{s['x2']},{s['z1']}..{s['z2']} face {s.get('face')} animals={pen.get('animals')} "
         f"built={pen.get('built')} laying={s.get('laying')} tries={s.get('tries')} eggs={pen.get('eggs')} born={pen.get('born')} milk={pen.get('milk')}")
    if pen.get("gate"):
        plot = next((p for p in v.get("plots") or [] if p.get("annex")), None)
        y = plot["y"] if plot else (an or {}).get("y")
        if y is None:
            return t + " gate " + str(pen["gate"]) + "; no annex plot y"
        x1, z1, x2, z2 = pen_inner(s)
        box = f"x={x1},y={y},z={z1},dx={x2 - x1},dy=3,dz={z2 - z1}"
        n = rcon(f"execute if entity @e[type={s.get('kind') or 'chicken'},{box}]")
        t += f" gate {pen['gate'][0]},{pen['gate'][1]} facing {pen.get('facing')}; inside: {n or 'no answer'}"
        if s.get("kind") == "chicken":
            t += f"; items: {rcon(f'execute if entity @e[type=item,{box}]') or 'no answer'}"
    return t


def works_text(wk):
    """The works plot (layouts[0].works, S.9) in one line: its state, area and tries, and each furnace recorded."""
    if not wk:
        return "none"
    last = wk.get("lastTry") or {}
    fs = wk.get("furnaces") or []
    placed = ", ".join(f"{k + 1}@{f['x']},{f['y']},{f['z']} by {f.get('by')}" for k, f in enumerate(fs) if f) or "none"
    return (f"{wk.get('state')} side {wk.get('side')} {wk.get('x1')}..{wk.get('x2')},{wk.get('z1')}..{wk.get('z2')} y {wk.get('y')} "
            f"tries={wk.get('tries')}{' (' + str(last.get('why'))[:120] + ')' if last.get('why') else ''}; furnaces {sum(1 for f in fs if f)} of 3: {placed}")


# S.9's chores, as the agents' actions show them (mcWorld.ts runOption: make, prepare_works, place_works_furnace; gathering
# is a collect then a deposit with chore set; a deposit with keep_wood puts back what a stopped make left)
S9_TYPES = {"make": "make", "prepare_works": "works", "place_works_furnace": "works", "furnish": "furnish"}
# The workshop's goods (mcWorkshop.ts MAKE_GOODS), for the stock line at the end
S9_GOODS = ["stone_pickaxe", "stone_hoe", "wooden_sword", "charcoal", "torch", "glass", "glass_pane", "glass_bottle", "barrel",
            "smooth_stone", "stone_bricks", "composter", "ladder"]


def s9_kind(action):
    """An action's S.9 family (make, gather, works), or None."""
    if not isinstance(action, dict):
        return None
    t, a = action.get("type"), action.get("args") or {}
    if t in S9_TYPES:
        return S9_TYPES[t]
    if t in ("collect", "deposit") and a.get("chore"):
        return "make" if a.get("keep_wood") else "gather"
    return None


def s9_material(block):
    """A gathering collect's material from its block."""
    b = str(block or "")
    return "logs" if b == "logs" or b.endswith("_log") else "sand" if b in ("sand", "red_sand") else "cobblestone" if b in ("cobblestone", "stone") else b or "?"


class ChoiceLog:
    """B.4: the agent server's choice log (MCAI_CHOICE_LOG, the same file stage_runs.py gives both), read on as it grows:
    each light option's spot count by part (its facts' "<unlit> of <all> torch spots"), and the [choice] and [choice-end]
    records of this village for the minutes at the end."""

    def __init__(self, path, village):
        self.path, self.village, self.at = path, village, 0
        self.spots, self.choices, self.ends = {}, {}, {}

    def read(self):
        if not self.path or not os.path.exists(self.path):
            return
        with open(self.path, "rb") as f:
            f.seek(self.at)
            data = f.read()
        # (a record still being written is left for the next read)
        cut = data.rfind(b"\n") + 1
        self.at += cut
        for ln in data[:cut].decode("utf-8", errors="replace").splitlines():
            try:
                r = json.loads(ln)
            except ValueError:
                continue
            if r.get("type") == "choice" and r.get("village") == self.village:
                self.choices[r["id"]] = r
                for o in r.get("options") or []:
                    m = re.match(r"(\d+) of (\d+) torch spots", str(o.get("facts") or ""))
                    if o.get("kind") == "light" and m and str(o.get("id", "")).startswith("light:"):
                        self.spots[o["id"][len("light:"):]] = int(m.group(2))
            elif r.get("type") == "choice-end":
                self.ends[r.get("id")] = r

    def minutes(self):
        """B.4's own agent-minutes: the light chores', and those made for torches (make:torch; charcoal and logs gathering
        whose chosen option's facts or effect name torches), with the counts and agents behind them."""
        light, torches, n_light, agents, n_t = 0.0, 0.0, 0, set(), {}
        for cid, c in self.choices.items():
            e = self.ends.get(cid)
            if not e:
                continue
            chosen = c.get("chosen") or ""
            o = next((x for x in c.get("options") or [] if x.get("id") == chosen), {})
            text = f"{o.get('facts', '')} {o.get('effect', '')}"
            if c.get("kind") == "light":
                light += e.get("minutes") or 0
                n_light += 1
                agents.add(c.get("agent"))
            elif chosen == "make:torch" or (chosen in ("make:charcoal", "gather:logs") and "torch" in text):
                torches += e.get("minutes") or 0
                n_t[chosen] = n_t.get(chosen, 0) + 1
        return light, torches, n_light, agents, n_t


def light_spot_test(cell):
    """Whether a torch stands at "x,y,z" on the server (a wall torch of any facing, or a standing one): True, False, or None
    when the server could not say (its chunk not loaded)."""
    x, y, z = cell.split(",")
    for b in ("wall_torch", "torch"):
        r = rcon_fast(f"execute if block {x} {y} {z} minecraft:{b}") or ""
        if "passed" in r.lower():
            return True
        if "not loaded" in r.lower() or "cannot" in r.lower():
            return None
    return False


# A village that grows (s30, runs/2026-10-15/s30/spec_grow.md 8): the growth layouts as the village record shows them
# (v.growth: the active layout with its first task id `from`, the past ones; layouts[] entries carry grow: k), and the
# board split at the first growth layout's first id so the run's own lines describe the village it built
DWELLING_PIECE = re.compile(r"^(plains|desert|savanna|taiga|snowy)_")


def is_dwelling(name):
    """grow.ts isDwelling (D3), for the houses count H: vanilla pieces only as small, medium or big houses, other names by
    their words."""
    if name in ("storage_hut", "mining_hut"):
        return False
    if DWELLING_PIECE.match(name):
        return bool(re.search(r"_(small|medium|big)_house_\d+$", name))
    return bool(re.search(r"house|cottage|home|cabin|dwelling|lodge|hut", name)) and not re.search(
        r"hall|library|meeting|shop|smith|temple|church|tavern|inn|market|barn|storage|workshop|mine|tower", name)


def task_num(t):
    return int(re.sub(r"\D", "", str(t["id"])) or 0)


GROW_GATHER = re.compile(r"^Gather \d+ (\S+)")
# Growth tasks that take from or put into storage (builds, lamps, signs, the windows' make): their claim-to-end spans go to
# make_log.py as GROW TASK lines, so a make they overlap is not read as a storage mismatch (lesson 132)
GROW_STORAGE = re.compile(r"^(Build |Light the streets|Put up the sign|Make \d+ )")


def server_grow():
    """Whether the agent server grows villages: /api/status's `grow` (s30), else this environment's MC_GROW (an older
    server; the server's own setting is what counts, the review's lens 3 L5)."""
    try:
        st = call("/status")
        if isinstance(st, dict) and "grow" in st:
            return bool(st["grow"])
    except Exception:
        pass
    return os.environ.get("MC_GROW") == "1"


class GrowWatch:
    """The growth layouts seen during the after phase: each one's first task id (from the active record; a layout ended
    between two polls falls back to its own prepare task, posted first), its record, and the lines to print."""

    def __init__(self, t0, members):
        self.t0, self.members = t0, members
        self.k = {}
        self.seen, self.h0, self.stop = None, None, None
        # (whether the agent server grows villages, read at the after phase's start; the builds' takes by design)
        self.on, self.bills = None, {}

    def takes(self, v, t):
        """What a growth build can take from storage, for make_log.py: its bill's items, what its plan crafts or smelts, and
        fuel when it smelts (GET /api/village/V/designs/D/bill); '' when the API cannot say."""
        m = re.match(r'build_design "([^"]+)"', t.get("detail") or "")
        if not m:
            return ""
        d = m.group(1)
        if d not in self.bills:
            try:
                b = call(f"/village/{urllib.parse.quote(v['name'])}/designs/{urllib.parse.quote(d)}/bill")
            except Exception:
                b = None
            items = set()
            if isinstance(b, dict) and isinstance(b.get("bill"), dict):
                items |= set(b["bill"])
                for st in b.get("steps") or []:
                    items |= {x for x in (st.get("item"), st.get("input")) if x}
                if (b.get("fuel") or {}).get("smelts"):
                    items |= {"charcoal", "coal"}
            self.bills[d] = ",".join(sorted(items))
        return self.bills[d]

    def froms(self, v):
        """{k: first task id}: the active record's where seen, else the k-th growth prepare task's."""
        out = {k: r["from"] for k, r in self.k.items() if r.get("from")}
        preps = sorted(task_num(t) for t in v.get("tasks") or [] if t.get("postedBy") == "grow" and t["title"].startswith("Prepare "))
        for i, n in enumerate(preps):
            out.setdefault(i + 1, n)
        return out

    def first(self, v):
        """The first growth layout's first id, or None (no growth: every task is the village's)."""
        ids = list(self.froms(v).values()) + [task_num(t) for t in v.get("tasks") or [] if t.get("postedBy") == "grow"]
        return min(ids) if ids else None

    def base(self, v):
        """The tasks posted before the first growth layout (the village as built to completion)."""
        f = self.first(v)
        return [t for t in v.get("tasks") or [] if f is None or task_num(t) < f]

    def tasks_of(self, v, k):
        """Layout k's tasks: from its first id to the next layout's (one layout at a time, so its requeues and needs fall
        inside)."""
        fr = self.froms(v)
        lo = fr.get(k)
        if lo is None:
            return []
        hi = min([n for kk, n in fr.items() if n > lo] or [float("inf")])
        return [t for t in v.get("tasks") or [] if lo <= task_num(t) < hi]

    def record(self, v, k):
        r = dict(self.k.get(k) or {})
        g = v.get("growth") or {}
        for p in g.get("past") or []:
            if p.get("k") == k:
                r.update({kk: p[kk] for kk in ("layout", "at", "end", "built", "failed", "members", "why") if kk in p})
                r["n"] = p.get("houses", r.get("n"))
        lay = next((l for l in v.get("layouts") or [] if l.get("grow") == k), None)
        if lay and not r.get("plot"):
            r["plot"] = {q: lay.get(q) for q in ("x1", "x2", "z1", "z2")}
        if lay:
            # (the pad option the layout took, s30's food step: its size and field, or why it has none; lens 3 L9)
            r["pad"] = (f"{lay['x2'] - lay['x1'] + 1}x{lay['z2'] - lay['z1'] + 1}, "
                        + (f"field + {len(lay.get('slots') or [])} slots" if lay.get("farm") else f"no field ({lay['farmWhy']})" if lay.get("farmWhy") else "no field"))
        return r

    def members_now(self, v):
        g = v.get("growth") or {}
        a = g.get("active") or {}
        past = g.get("past") or []
        return a.get("members") or (past[-1].get("members") if past else None) or self.members

    def update(self, v):
        """Lines for what changed since the last poll."""
        out = []
        g = v.get("growth") or {}
        a = g.get("active")
        H = sum(1 for s in v.get("structures") or [] if is_dwelling(s.get("kind", "")))
        if self.h0 is None:
            self.h0 = H
        if a and a.get("k") is not None:
            r = self.k.setdefault(a["k"], {})
            r.update({kk: a.get(kk) for kk in ("layout", "from", "at", "plot", "houses", "builds", "members", "before")})
            r["n"] = len(a.get("houses") or [])
        M = self.members_now(v)
        ks = sorted(set(self.k) | {p.get("k") for p in g.get("past") or [] if p.get("k") is not None})
        for k in ks:
            r = self.record(v, k)
            builds = [t for t in self.tasks_of(v, k) if t["title"].startswith("Build ")]
            n = r.get("n") if r.get("n") is not None else len(builds)
            b = sum(1 for t in builds if t["status"] == "done") if builds else r.get("built", 0)
            ended = r.get("why") or ("ended" if r.get("end") else None)
            sig = (b, n, H, M, ended)
            if self.k.get(k, {}).get("_sig") == sig:
                continue
            self.k.setdefault(k, {})["_sig"] = sig
            p = r.get("plot") or {}
            area = f"{p.get('x1')}..{p.get('x2')},{p.get('z1')}..{p.get('z2')}" if p else "?"
            chests = len((v.get("storage") or {}).get("chests") or [])
            out.append(f"GROW layout {r.get('layout', '?')} ({k}): {n} houses posted at {area}" + (f" (pad {r['pad']})" if r.get("pad") else "")
                       + f"; built {b}/{n}; houses {H} for {M} members; chests {chests}"
                       + (f"; ended {ended}: built {r.get('built', b)} of {n}, failed {r.get('failed', 0)}" if ended else ""))
        if g.get("stop") and g["stop"] != self.stop:
            self.stop = g["stop"]
            out.append(f"GROW stopped: {self.stop}")
        return out

    def end_lines(self, v, stamps):
        """The summary: one line for all layouts, then per layout its houses, members, plot, minutes from posting to built,
        its gathering's minutes and its critical path; then the GROW TASK spans for make_log.py."""
        g = v.get("growth") or {}
        m = lambda s: f"+{(s - self.t0) / 60:.1f}" if s else "-"
        ks = sorted(set(self.froms(v)) | set(self.k) | {p.get("k") for p in g.get("past") or [] if p.get("k") is not None})
        H1 = sum(1 for s in v.get("structures") or [] if is_dwelling(s.get("kind", "")))
        whys, mins, per, crit = {}, [], [], []
        for k in ks:
            r = self.record(v, k)
            tasks = self.tasks_of(v, k)
            builds = [t for t in tasks if t["title"].startswith("Build ")]
            posted = (r["at"] / 1000) if r.get("at") else min([stamps.posted(t) for t in tasks if stamps.posted(t)] or [0]) or None
            ends = [stamps.end(t) for t in builds]
            built_at = max(ends) if builds and all(t["status"] == "done" for t in builds) and all(ends) else None
            why = r.get("why") or ("active" if not r.get("end") else "ended")
            whys[why] = whys.get(why, 0) + 1
            took = (built_at - posted) / 60 if built_at and posted else None
            if took is not None:
                mins.append(took)
            gather = {}
            for t in tasks:
                mm = GROW_GATHER.match(t["title"])
                if not mm or t["status"] != "done" or not stamps.end(t) or not stamps.last_claim(t):
                    continue
                mat = "logs" if mm.group(1) == "logs" or mm.group(1).endswith("_log") else mm.group(1)
                q = gather.setdefault(mat, [0, 0.0])
                q[0] += 1
                q[1] += (stamps.end(t) - stamps.last_claim(t)) / 60
            p = r.get("plot") or {}
            n = r.get("n") if r.get("n") is not None else len(builds)
            per.append(f"GROW layout {r.get('layout', '?')} ({k}): {n} houses ({', '.join(r.get('houses') or []) or '-'}), members {r.get('members', '?')}, "
                       f"plot {p.get('x1')}..{p.get('x2')},{p.get('z1')}..{p.get('z2')}" + (f" (pad {r['pad']})" if r.get("pad") else "") + f", posted {m(posted)}, built "
                       f"{sum(1 for t in builds if t['status'] == 'done')} of {len(builds)}"
                       + (f" by {m(built_at)} ({took:.1f} min from posting)" if took is not None else "")
                       + (f", ended {why} {m(r['end'] / 1000)}" if r.get("end") else f", {why}") + f"; {len(tasks)} tasks; gathering "
                       + (", ".join(f"{mat} {q[0]} tasks {q[1]:.1f} min" for mat, q in sorted(gather.items())) or "none"))
            if posted:
                crit += [ln.replace("CRITICAL PATH", f"GROW CRITICAL PATH layout {r.get('layout', '?')} ({k}),", 1) if ln.startswith("CRITICAL PATH") else "GROW " + ln
                         for ln in critical_path_lines(tasks, stamps, posted)]
        srt = sorted(mins)
        med = f" (median {srt[len(srt) // 2]:.1f})" if srt else ""
        out = [f"GROW layouts {len(ks)} ({whys.get('built', 0)}/{whys.get('failed', 0)}/{whys.get('stuck', 0)}"
               + "".join(f", {n} {w}" for w, n in sorted(whys.items()) if w not in ("built", "failed", "stuck"))
               + f"), houses {self.h0 if self.h0 is not None else '?'} -> {H1} for {self.members_now(v)} members, minutes per layout "
               + ("/".join(f"{x:.1f}" for x in mins) or "-") + med + f", stop: {g.get('stop') or '-'}"]
        out += per + crit
        f = self.first(v)
        for t in v.get("tasks") or []:
            c = stamps.first_claim(t)
            if f is None or task_num(t) < f or not GROW_STORAGE.match(t["title"]) or not c:
                continue
            e = stamps.end(t)
            # (a build's takes: what make_log.py may excuse a make's storage count by, the review's lens 3 M3)
            takes = self.takes(v, t) if t["title"].startswith("Build ") else ""
            out.append(f"GROW TASK {t['id']} claimed={int(c * 1000)} end={int(e * 1000) if e else '-'} by={t.get('claimedBy') or '-'} "
                       + (f"takes={takes} " if takes else "") + t["title"])
        return out


# The village appetite (s30's food step, runs/2026-10-15/s30/spec_food.md 6; as in stage_village.py and watch_village.py,
# keep the two alike): the food points an item gives (appetite.ts FOOD_POINTS, cake 14 for its 7 slices of 2;
# scripts/checks/food_check.mts compares this table with it), and the planting stock a meal never takes (appetite.ts KEEP)
FOOD_POINTS = {
    "bread": 5, "pumpkin_pie": 8, "melon_slice": 2, "carrot": 3, "baked_potato": 5, "potato": 1, "apple": 4, "cookie": 2,
    "beetroot": 1, "mushroom_stew": 6, "beetroot_soup": 6, "rabbit_stew": 10, "sweet_berries": 2, "glow_berries": 2,
    "golden_carrot": 6, "cake": 14,
}
FOOD_KEEP = {"carrot": 8, "potato": 8, "beetroot": 8}
# The foods the village makes (fields, slots, the hut's table, the cake); any other food that turns up in storage came in
# with other work (an apple from oak leaves with the logs), which the ledger notes rather than fails (lesson 132)
FOOD_MADE = {"bread", "pumpkin_pie", "cake", "melon_slice", "carrot", "potato", "beetroot", "baked_potato", "cookie"}
# Food that leaves storage without a meal (the spec check's L5): a farm start from storage takes its kind's count
# (farmSlots.ts SLOT_KINDS take and count: melon slices made into seeds, carrots and potatoes planted); a crop slot's
# replant is netted already (harvest_slot's made is the server-counted change after it). The pie's pumpkins, sugar and egg
# and the cake's wheat, milk, egg and sugar are not food, so the ledger in points never sees them (the conversions line
# names them).
FOOD_STARTS = {"melon": ("melon_slice", 6), "carrots": ("carrot", 6), "potatoes": ("potato", 6)}
# Where a field grows (the food step's live check, s30_crop_reach.py and s30_crop_diag.py): a chunk whose centre is within
# ~115 blocks of a bot (grew at 103.6 and 115.6, not at 119.6)
FOOD_TICK_RANGE = 115
FOOD_PECKISH, FOOD_HUNGRY = 12, 6
FOOD_MEAL = re.compile(r"\bate (\d+) ([a-z_]+)")


def food_store(v):
    """Storage's food items, from the chests as last opened."""
    tot = {}
    for c in (v.get("storage") or {}).get("chests", []):
        for k, q in (c.get("items") or {}).items():
            if k in FOOD_POINTS and q:
                tot[k] = tot.get(k, 0) + q
    return tot


def food_points(counts, meals=False):
    """Points of food in `counts`; `meals`: only what a meal may take (less the planting stock, appetite.ts foodPoints)."""
    return sum(FOOD_POINTS.get(k, 0) * max(0, q - (FOOD_KEEP.get(k, 0) if meals else 0)) for k, q in counts.items())


def food_call(path):
    """A GET that answers None for an error (stage_village.py's call returns HTTP errors, watch_village.py's raises)."""
    try:
        r = call(path)
    except Exception:
        return None
    return None if isinstance(r, dict) and "error" in r and "status" in r else r


class FoodWatch:
    """The village appetite after completion (spec 6): the FOOD line every 2 minutes, then each member's appetite and meals,
    the hungry and D7-busy shares of member-time, the FOOD ledger and how often each planted field was within growing
    range of a bot (FIELDS ticking). Silent unless the agent server has the appetite on (/api/status `appetite.rate`, else
    this environment's MC_APPETITE) or the village keeps a food record."""

    def __init__(self, members):
        self.members = list(members)
        self.on = False
        self.t0 = self.last = self.line_at = self.tick_at = None
        self.base = None
        self.member_s = {n: 0.0 for n in self.members}
        self.hungry_s = {n: 0.0 for n in self.members}
        self.busy_s = {n: 0.0 for n in self.members}
        self.eat_s = 0.0
        self.series = []  # (minute, hungry member-seconds, member-seconds) per sample
        self.ticks = {}  # layout k -> [checks in range, checks]
        self.out, self.eats, self.meal_events = {}, {}, 0

    def start(self, v, start_level=None):
        """`start_level`: the level --appetite-start set every member to (the FOOD on line names it over the server's)."""
        st = food_call("/status")
        ap = st.get("appetite") if isinstance(st, dict) else None
        env = os.environ.get("MC_APPETITE", "").strip().lower()
        env_rate = 18 if env in ("1", "on", "true") else float(env) if env.replace(".", "", 1).isdigit() else 0
        self.rate = ap.get("rate") if isinstance(ap, dict) else env_rate
        # (the server's rate when it reports one: an old food record on a server with the appetite off is no appetite)
        self.on = bool(self.rate) if isinstance(ap, dict) else bool(self.rate) or bool(v.get("food"))
        self.t0 = self.last = self.line_at = self.tick_at = time.time()
        if self.on:
            self.base = self.snapshot(v)
            start = f"{start_level:g} (--appetite-start)" if start_level is not None else ap.get("start") if isinstance(ap, dict) else "?"
            return [f"FOOD on: appetite {self.rate or '?'} a busy game-hour" + (f", idle x{ap.get('idle')}, start {start}" if isinstance(ap, dict) else f", start {start}")
                    + f"; grow farms {'on' if isinstance(st, dict) and st.get('growFarms') else 'off' if isinstance(st, dict) and 'growFarms' in st else '?'}"
                    + f"; storage {food_points(self.base['store'], True)} pts {self.items_text(self.base['store'])}"]
        return []

    def items_text(self, counts, n=5):
        top = sorted(counts.items(), key=lambda kv: -FOOD_POINTS.get(kv[0], 0) * kv[1])[:n]
        return "(" + (", ".join(f"{q} {k}" for k, q in top) or "none") + ")"

    def levels(self, v):
        mem = ((v.get("food") or {}).get("members") or {})
        return {n: (mem.get(n) or {}).get("level") for n in self.members}

    def event(self, name, e):
        """An action_done event of the after phase: from-storage farm starts and crop harvests take food out without a meal,
        and each eat_meal's message names what was eaten (checked against the record's eaten)."""
        if not self.on or e.get("type") != "action_done":
            return
        d = e.get("data") or {}
        t, a = d.get("type"), d.get("args") or {}
        if t == "start_farm" and a.get("from") == "storage" and a.get("kind") in FOOD_STARTS:
            item, n = FOOD_STARTS[a["kind"]]
            self.out[item] = self.out.get(item, 0) + n
        elif t == "eat_meal":
            self.meal_events += 1
            for q, item in FOOD_MEAL.findall(e.get("text") or ""):
                self.eats[item] = self.eats.get(item, 0) + int(q)

    def sample(self, v, listing):
        """One sample of the watch loop: the members' appetite states and D7's busy (an action other than eat_meal), each
        planted field's growing range every 30 s, and the FOOD line every 2 minutes (returned)."""
        if not self.on:
            return []
        now = time.time()
        dt, self.last = now - self.last, now
        lv = self.levels(v)
        acts = {a.get("name"): a for a in listing} if isinstance(listing, list) else {}
        hungry = 0.0
        for n in self.members:
            if n not in acts:
                continue
            self.member_s[n] += dt
            if lv.get(n) is not None and lv[n] <= FOOD_HUNGRY:
                self.hungry_s[n] += dt
                hungry += dt
            act = acts[n].get("action")
            kind = act.get("type") if isinstance(act, dict) else None
            if kind == "eat_meal":
                self.eat_s += dt
            elif act:
                self.busy_s[n] += dt
        self.series.append(((now - self.t0) / 60, hungry, dt * sum(1 for n in self.members if n in acts)))
        if now - self.tick_at >= 30 and isinstance(listing, list):
            self.tick_at = now
            bots = [(a["position"]["x"], a["position"]["z"]) for a in listing if a.get("position")]
            for k, lay in enumerate(v.get("layouts") or []):
                f = lay.get("farm")
                if not f or not f.get("planted"):
                    continue
                chunks = [(cx * 16 + 8, cz * 16 + 8) for cx in range(f["x1"] >> 4, (f["x2"] >> 4) + 1) for cz in range(f["z1"] >> 4, (f["z2"] >> 4) + 1)]
                near = all(any(math.hypot(x - bx, z - bz) <= FOOD_TICK_RANGE for bx, bz in bots) for x, z in chunks)
                t = self.ticks.setdefault(k, [0, 0])
                t[0] += near
                t[1] += 1
        if now - self.line_at >= 120:
            self.line_at = now
            return [self.line(v, lv)]
        return []

    def line(self, v, lv=None):
        lv = lv if lv is not None else self.levels(v)
        food = v.get("food") or {}
        store = food_store(v)
        b = self.base or {"made": {}, "eaten": {}, "meals": 0}
        made = {k: q - b["made"].get(k, 0) for k, q in (food.get("made") or {}).items() if q - b["made"].get(k, 0)}
        eaten = {k: q - b["eaten"].get(k, 0) for k, q in (food.get("eaten") or {}).items() if q - b["eaten"].get(k, 0)}
        fields = [lay.get("farm") for lay in v.get("layouts") or [] if lay.get("farm")]
        peckish = sum(1 for n in self.members if lv.get(n) is not None and FOOD_HUNGRY < lv[n] <= FOOD_PECKISH)
        hungry = sum(1 for n in self.members if lv.get(n) is not None and lv[n] <= FOOD_HUNGRY)
        return (f"FOOD stock {food_points(store, True)} pts ({', '.join(f'{store.get(k, 0)} {k}' for k in ('bread', 'cake', 'pumpkin_pie', 'melon_slice'))}"
                + "".join(f", {q} {k}" for k, q in sorted(store.items()) if k not in ("bread", "cake", "pumpkin_pie", "melon_slice")) + ")"
                + f" | made {' '.join(f'{k} {q}' for k, q in sorted(made.items(), key=lambda kv: -kv[1])[:6]) or 'nothing'}"
                + f" | eaten {(food.get('meals') or 0) - b['meals']} meals {food_points(eaten)} pts"
                + f" | fields {len(fields)} (planted {sum(1 for f in fields if f.get('planted'))}, harvested {sum(1 for f in fields if f.get('harvests'))}, harvests {sum(f.get('harvests') or 0 for f in fields)})"
                + f" | peckish {peckish} hungry {hungry}")

    def snapshot(self, v):
        """Storage, what the members carry, the record's made, eaten and meals (and `used` if the server keeps one), and the
        bread the fields' harvests baked, as counts."""
        food = v.get("food") or {}
        carried = {}
        for n in self.members:
            o = food_call(f"/agents/{n}")
            for k, q in ((o.get("inventory") or {}) if isinstance(o, dict) else {}).items():
                if k in FOOD_POINTS and q:
                    carried[k] = carried.get(k, 0) + q
        return {"store": food_store(v), "carried": carried, "made": dict(food.get("made") or {}), "eaten": dict(food.get("eaten") or {}),
                "used": dict(food.get("used") or {}), "meals": food.get("meals") or 0,
                "bread": sum(((lay.get("farm") or {}).get("bread") or 0) for lay in v.get("layouts") or [])}

    def ledger(self, e, eating):
        """Food in storage and carried changed by what was made less what was eaten and what left without a meal (lesson
        132: every flow named): ([mismatches], [notes]). `eating`: eat_meal actions running at either snapshot (a meal in
        flight may be taken and not yet recorded: up to 4 items each)."""
        b = self.base
        d = lambda key, k: e[key].get(k, 0) - b[key].get(k, 0)
        keyed = ("store", "carried", "made", "eaten", "used")
        items = sorted({k for s in (b, e) for key in keyed for k in s[key] if k in FOOD_POINTS} | set(self.out) | set(self.eats))
        used_rec = bool(b["used"] or e["used"])
        bad, notes = [], []
        slack = 4 * eating
        for k in items:
            moved = d("store", k) + d("carried", k)
            made, eaten = d("made", k), d("eaten", k)
            used = d("used", k) if used_rec else self.out.get(k, 0)
            u = moved - made + eaten + used
            what = (f"{k}: storage {d('store', k):+d}, carried {d('carried', k):+d}, made {made}, eaten {eaten}"
                    + (f", out without a meal {used}" if used else "") + f" (unexplained {u:+d})")
            if u == 0:
                continue
            # (no replant excuse: harvest_slot's made is already net of its replant, lens 3 L1)
            if abs(u) <= slack:
                notes.append(f"{what}: {eating} meal(s) in flight")
            elif u > 0 and k not in FOOD_MADE:
                notes.append(f"{what}: came in with other work")
            else:
                bad.append(what)
        # (bread from the harvest chore is the record's too, spec 4.5; the fields count it per layout)
        hb = e["bread"] - b["bread"]
        if hb > d("made", "bread"):
            bad.append(f"bread: the harvests baked {hb} but the record's made counts {d('made', 'bread')}")
        # (each eat_meal's message against the record's eaten: the record short of the messages is a mismatch; messages short
        # of the record a note, a meal may end after the watch's last read of the events)
        for k in sorted(set(self.eats) | {k for k in e["eaten"] if d("eaten", k)}):
            said, rec = self.eats.get(k, 0), d("eaten", k)
            if said > rec + slack:
                bad.append(f"{k}: the meals' messages ate {said}, the record's eaten {rec}")
            elif rec > said:
                notes.append(f"{k}: the record's eaten {rec}, the meals' messages seen {said} (meals after the last read of the events)")
        return bad, notes

    def end_lines(self, v, listing, wait=None):
        """At the end: FOOD per agent, the shares, the conversions, the ledger (read again up to 3 times, 5 s apart, while
        it does not add up: agents are still at work) and FIELDS ticking."""
        if not self.on:
            return []
        out = []
        lv = self.levels(v)
        out.append(self.line(v, lv))
        mem = ((v.get("food") or {}).get("members") or {})
        per = [f"{n} level {lv[n]:.1f} meals {(mem.get(n) or {}).get('meals', 0)} hungry {self.hungry_s[n] / 60:.1f} min" if lv.get(n) is not None
               else f"{n} no record" for n in self.members]
        out.append("FOOD per agent: " + ", ".join(per))
        none = [n for n in self.members if not (mem.get(n) or {}).get("meals")]
        out.append(f"FOOD members {len(self.members)}: every member ate {'yes' if not none else 'no'}" + (f" ({len(none)} without a meal: {', '.join(none)})" if none else ""))
        span = lambda m: (sum(h for t, h, _ in self.series if t >= m), sum(s for t, _, s in self.series if t >= m))
        share = lambda m: (lambda hs: f"{100 * hs[0] / hs[1]:.1f}%" if hs[1] else "-")(span(m))
        total = sum(self.member_s.values())
        out.append(f"FOOD hungry share of member-time: all {share(0)}, after +30 {share(30)}, after +45 {share(45)}; "
                   f"busy (D7: an action other than eat_meal) {100 * sum(self.busy_s.values()) / total:.1f}%" if total else "FOOD hungry share: no samples")
        out[-1] += f"; eating {self.eat_s / 60:.1f} agent-min, {self.meal_events} meals seen"
        food = v.get("food") or {}
        made = {k: q - self.base["made"].get(k, 0) for k, q in (food.get("made") or {}).items()}
        out.append(f"FOOD conversions: bread {made.get('bread', 0)} (from harvests {sum(((lay.get('farm') or {}).get('bread') or 0) for lay in v.get('layouts') or []) - self.base['bread']}), "
                   f"pumpkin_pie {made.get('pumpkin_pie', 0)} (pumpkins, sugar and eggs are not food), cake {made.get('cake', 0)}; "
                   f"out without a meal {', '.join(f'{q} {k}' for k, q in sorted(self.out.items())) or 'none'}")
        bad = notes = None
        for attempt in range(4):
            if attempt:
                time.sleep(5)
                v = food_call(f"/village/{v['name']}") or v
                listing = food_call("/agents")
            eating = sum(1 for a in listing or [] if a.get("name") in self.members and isinstance(a.get("action"), dict) and a["action"].get("type") == "eat_meal")
            e = self.snapshot(v)
            bad, notes = self.ledger(e, eating)
            if not bad:
                break
        moved = food_points(e["store"]) - food_points(self.base["store"]) + food_points(e["carried"]) - food_points(self.base["carried"])
        mp = food_points({k: q - self.base["made"].get(k, 0) for k, q in e["made"].items()})
        ep = food_points({k: q - self.base["eaten"].get(k, 0) for k, q in e["eaten"].items()})
        head = f"made {mp} pts, eaten {ep} pts, storage and carried {moved:+d} pts"
        for n in notes:
            out.append(f"FOOD note: {n}")
        out.append(f"FOOD ok ({head})" if not bad else f"FOOD MISMATCH {'; '.join(bad)} ({head})")
        ticks = [f"layout {k + 1} {100 * t[0] / t[1]:.0f}% of {t[1]} checks" for k, t in sorted(self.ticks.items()) if t[1]]
        out.append("FIELDS ticking: " + (", ".join(ticks) if ticks else "no planted field checked") + f" (a chunk centre within {FOOD_TICK_RANGE} of a bot)")
        return out


grow = GrowWatch(t0, len(watched))
# ---- after completion (opportunistic farming and exploring): the chores, the slots, the sightings
if args.after and reason == "every building is done":
    for _ in range(40):
        if call(f"/village/{args.village}").get("complete"):
            break
        time.sleep(3)
    v = call(f"/village/{args.village}")
    print(f"AFTER village {'complete' if v.get('complete') else 'NOT complete (chores wait for completion)'}; watching {args.after:g} min", flush=True)
    # (the early dirt and sand tasks may have taken a fixture's ground, the design review's M6)
    for kind, cells in fixtures.items():
        print(f"AFTER fixture {kind}: " + ", ".join(f"{x},{y},{z} {call(f'/block?x={x}&y={y}&z={z}').get('block')}" for x, y, z in cells), flush=True)
    if args.fixtures:
        # (only chickens in loaded chunks are counted)
        print(f"AFTER fixture chicken: {rcon('execute if entity @e[type=chicken,tag=stagefix]') or 'no answer'}", flush=True)
        print(f"AFTER fixture cow: {rcon('execute if entity @e[type=cow,tag=stagefix]') or 'no answer'}", flush=True)
    if args.stock:
        w = names[-1]
        for kv in args.stock.split(","):
            item, n = kv.split(":")
            print(f"AFTER stock: {rcon(f'give {w} minecraft:{item} {n}')}", flush=True)
        time.sleep(2)
        # (each by name: buckets are tools to "deposit all", eggs junk)
        for kv in args.stock.split(","):
            call(f"/agents/{w}/act", {"action": "deposit", "item": kv.split(":")[0]})
    # The village appetite (s30's food step): every member's level set for the test, then the food watch's baseline
    if args.appetite_start is not None:
        print(f"AFTER appetite start {args.appetite_start:g}: {json.dumps(call(f'/village/{args.village}/appetite', {'level': args.appetite_start}))[:200]}", flush=True)
    food = FoodWatch(watched)
    for line in food.start(call(f"/village/{args.village}"), args.appetite_start):
        print(f"AFTER {line}", flush=True)
    fields_ripened = set()
    a0 = call(f"/atlas?village={args.village}&radius=176") or {}
    chunks0 = len(a0.get("chunks") or [])
    t2, slots_seen, ripened, explore_seen, annex_seen, pens_seen = time.time(), {}, set(), None, None, {}
    print(f"AFTER start at {stamp().strip()}", flush=True)
    # (a village that grows, s30: as the agent server says, else this environment's MC_GROW, which reset_site.py passed on)
    grow.on = server_grow()
    print(f"AFTER GROW {'on' if grow.on else 'off'}", flush=True)
    clock.restart()
    # (each agent's samples with an action running, F193: idle minutes per agent after completion)
    busy, samples = {n: 0 for n in watched}, 0
    # (E.1: the same samples by the running action's type, {type: {agent: samples}}, for the grouped line over 6 agents)
    doing = {}
    # (S.9: agents running a workshop chore per sample and at its peak, its samples per agent, the chores ended by family
    # and gathering's trips by material, from the agents' action events; the works plot and the tech record as they change)
    s9_busy, s9_peak, s9_agents, s9_ends, s9_trips = {}, (0, 0.0), set(), {"make": 0, "gather": 0, "works": 0, "furnish": 0}, {}
    works_seen, tech_seen = None, set()
    # (B.4: each part's torch record as last printed, and the choice log for the spots each part has)
    lights_seen, choice_log = {}, ChoiceLog(os.environ.get("MCAI_CHOICE_LOG"), args.village)
    # (--after-until: when a member last ran an action, and the conditions met at the stop)
    last_busy, until_met = time.time(), None
    if until:
        print(f"AFTER until {','.join(until)} (or {args.after:g} min)", flush=True)
    while time.time() - t2 < args.after * 60:
        time.sleep(3)
        listing = call("/agents")
        clock.sample(listing, "after")
        if isinstance(listing, list):
            samples += 1
            if any(a.get("name") in busy and a.get("action") for a in listing):
                last_busy = time.time()
            for a in listing:
                if a.get("name") in busy and a.get("action"):
                    busy[a["name"]] += 1
                    kind = (a["action"].get("type") if isinstance(a["action"], dict) else None) or "?"
                    doing.setdefault(kind, {}).setdefault(a["name"], 0)
                    doing[kind][a["name"]] += 1
            on_s9 = [a["name"] for a in listing if a.get("name") in busy and s9_kind(a.get("action"))]
            for n in on_s9:
                s9_busy[n] = s9_busy.get(n, 0) + 1
                s9_agents.add(n)
            if len(on_s9) > s9_peak[0]:
                s9_peak = (len(on_s9), (time.time() - t2) / 60)
        for n in watched:
            events = call(f"/agents/{n}/events?since={seen[n]}")
            for e in events if isinstance(events, list) else []:
                seen[n] = e["id"]
                if e["type"] in ("action_done", "action_failed"):
                    print(f"AFTER {(time.time() - t2) / 60:4.1f}m {n:8} {e['type']:13} | {e['text'][:300]}", flush=True)
                    food.event(n, e)
                    d = e.get("data") or {}
                    fam = s9_kind({"type": d.get("type"), "args": d.get("args")})
                    # (a chore counted once: a make by its make, gathering by its collect, the works by each of its skills)
                    if fam and not (d.get("type") == "deposit"):
                        s9_ends[fam] += 1
                        s9_agents.add(n)
                        if fam == "gather":
                            mat = s9_material((d.get("args") or {}).get("block"))
                            s9_trips[mat] = s9_trips.get(mat, 0) + 1
        v = call(f"/village/{args.village}")
        stock_line(v)
        # (the board's stamps go on through the after phase: growth tasks are claimed and done there, the spec check's M2)
        stamps.update(v["tasks"])
        for line in grow.update(v):
            print(f"AFTER {(time.time() - t2) / 60:4.1f}m {line}", flush=True)
        if until:
            g = v.get("growth") or {}
            # (growth pauses at a house per member without recording a stop: new members could still come)
            H = sum(1 for s in v.get("structures") or [] if is_dwelling(s.get("kind", "")))
            held = {"grow": not g.get("active") and (bool(g.get("stop")) or H >= grow.members_now(v))}
            held.update({c: time.time() - last_busy >= float(c.split(":")[1]) * 60 for c in until if c.startswith("idle:")})
            if all(held[c] for c in until):
                until_met = f"{','.join(until)} at {(time.time() - t2) / 60:.1f} min"
                print(f"AFTER {(time.time() - t2) / 60:4.1f}m UNTIL met: {','.join(until)}"
                      + (f" (growth {'stopped: ' + g['stop'] if g.get('stop') else f'paused: {H} houses for {grow.members_now(v)} members'})" if "grow" in until else "")
                      + (f"; idle since {(last_busy - t2) / 60:.1f}m" if any(c.startswith("idle:") for c in until) else ""), flush=True)
                break
        for k, lay in enumerate(v.get("layouts") or []):
            for j, s in enumerate(lay.get("slots") or []):
                t = slot_text(s)
                if slots_seen.get((k, j)) != t:
                    slots_seen[(k, j)] = t
                    print(f"AFTER {(time.time() - t2) / 60:4.1f}m SLOT {k + 1}.{j + 1}: {t}", flush=True)
                if args.ripen and s.get("kind") and s.get("planted") and (k, j) not in ripened:
                    ripened.add((k, j))
                    print(f"AFTER RIPEN {k + 1}.{j + 1} {s['kind']}: {ripen(v, k, s)}", flush=True)
            # (--ripen-fields: each layout's wheat field once, when first planted, the food spec check's L11)
            f = lay.get("farm")
            if args.ripen_fields and f and f.get("planted") and k not in fields_ripened:
                fields_ripened.add(k)
                plot = next((p for p in v["plots"] if p["x1"] <= f["x1"] and p["x2"] >= f["x2"] and p["z1"] <= f["z1"] and p["z2"] >= f["z2"]), None)
                print(f"AFTER RIPEN field {k + 1}: " + (rcon(f"fill {f['x1']} {plot['y'] + 1} {f['z1']} {f['x2']} {plot['y'] + 1} {f['z2']} minecraft:wheat[age=7] replace minecraft:wheat") if plot else "no plot holds it"), flush=True)
        # The village appetite: the members' states, the fields' growing range, the FOOD line every 2 minutes
        for line in food.sample(v, listing):
            print(f"AFTER {(time.time() - t2) / 60:4.1f}m {line}", flush=True)
        # The annex and its pens (10-09)
        lay0 = (v.get("layouts") or [{}])[0]
        an = lay0.get("annex")
        t = annex_text(an)
        if t != annex_seen:
            annex_seen = t
            print(f"AFTER {(time.time() - t2) / 60:4.1f}m ANNEX {t}", flush=True)
        for j, s in enumerate(lay0.get("slots") or []):
            if not s.get("annex"):
                continue
            t = pen_text(v, an, s)
            if pens_seen.get(j) != t:
                pens_seen[j] = t
                print(f"AFTER {(time.time() - t2) / 60:4.1f}m PEN 1.{j + 1}: {t}", flush=True)
        ex = v.get("explore")
        if ex != explore_seen:
            explore_seen = ex
            print(f"AFTER {(time.time() - t2) / 60:4.1f}m EXPLORE {json.dumps(ex)[:300]}", flush=True)
        # S.9: the works plot and its furnaces, and each first in the village's tech record
        t = works_text(lay0.get("works"))
        if t != works_seen:
            works_seen = t
            print(f"AFTER {(time.time() - t2) / 60:4.1f}m WORKS {t}", flush=True)
        for item, te in sorted((v.get("tech") or {}).items(), key=lambda kv: kv[1].get("at", 0)):
            if item not in tech_seen:
                tech_seen.add(item)
                print(f"AFTER {(time.time() - t2) / 60:4.1f}m TECH {item} ({te.get('how')} {te.get('n')}) by {te.get('by')} via {te.get('via')}", flush=True)
        # B.4: each part's torches as its record changes, against the spots its last light option counted
        choice_log.read()
        for part, rec in sorted((v.get("lights") or {}).items()):
            done, never = len(rec.get("done") or []), len(rec.get("never") or [])
            t = (done, never, choice_log.spots.get(part))
            if lights_seen.get(part) != t:
                lights_seen[part] = t
                print(f"AFTER {(time.time() - t2) / 60:4.1f}m LIGHT {part} {done}/{t[2] if t[2] is not None else '?'} never {never} (by {rec.get('by')})", flush=True)
    a1 = call(f"/atlas?village={args.village}&radius=176") or {}
    plants = {}
    for c in a1.get("chunks") or []:
        for kind, q in (c.get("plants") or {}).items():
            plants[kind] = plants.get(kind, 0) + q[0]
    animals = {}
    for s in a1.get("animals") or []:
        animals[s["kind"]] = animals.get(s["kind"], 0) + 1
    print(f"AFTER atlas within 176: {chunks0} -> {len(a1.get('chunks') or [])} chunks; plants {plants}; animals {animals}", flush=True)
    span = (time.time() - t2) / 60
    print("AFTER busy: " + ", ".join(f"{n} {span * busy[n] / max(1, samples):.1f}" for n in watched) + f" of {span:.1f} min", flush=True)
    if len(watched) > 6:
        # (over 6 agents the line above is a wall of names: agent-minutes per activity, with how many agents did it)
        per = lambda c: span * c / max(1, samples)
        groups = sorted(doing.items(), key=lambda kv: -sum(kv[1].values()))
        idle = span * len(watched) - sum(per(c) for g in doing.values() for c in g.values())
        print("AFTER busy by activity: " + ", ".join(f"{k} {per(sum(g.values())):.1f} ({len(g)} agent{'s' if len(g) != 1 else ''})" for k, g in groups)
              + f"; idle {max(0.0, idle):.1f} agent-min of {len(watched)} x {span:.1f} min", flush=True)
    # S.9 (spec 9.2 step 9 and the exit, 9.3): who took a workshop chore, the most at once, the chores by family, the busy
    # agent-minutes they added, and the goods in storage at the end
    s9_min = span * sum(s9_busy.values()) / max(1, samples)
    trips = s9_trips
    print(f"AFTER S.9 chores: {len(s9_agents)} agents took one; peak {s9_peak[0]} at once (minute {s9_peak[1]:.1f}); make {s9_ends['make']}, "
          f"gather {s9_ends['gather']} (sand {trips.get('sand', 0)}, logs {trips.get('logs', 0)}, cobblestone {trips.get('cobblestone', 0)}), "
          f"works {s9_ends['works']}, furnish {s9_ends['furnish']}; busy {s9_min:.1f} agent-min", flush=True)
    tot = storage_totals(call(f"/village/{args.village}"))
    print("AFTER S.9 stock: " + (", ".join(f"{g} {tot[g]}" for g in S9_GOODS if tot.get(g)) or "none")
          + f"; works {works_seen}; tech {len(tech_seen)} firsts", flush=True)
    # B.4 (spec 9.2 step 8): every recorded torch tested on the server while the agents still hold its chunks loaded, and
    # lighting's own agent-minutes beside those made for torches
    lights = (call(f"/village/{args.village}") or {}).get("lights") or {}
    if lights:
        tested = {p: [light_spot_test(c) for c in rec.get("done") or []] for p, rec in sorted(lights.items())}
        alls = [r for rs in tested.values() for r in rs]
        unknown = sum(1 for r in alls if r is None)
        missing = [f"{p} {rs.count(False)}" for p, rs in tested.items() if False in rs]
        print(f"AFTER LIGHT standing {sum(1 for r in alls if r)} of {len(alls)}" + (f" ({unknown} not loaded)" if unknown else "")
              + (f"; missing: {', '.join(missing)}" if missing else "")
              + f"; buildings {sum(len(r.get('done') or []) for p, r in lights.items() if not p.startswith('mine'))}, "
              f"mine {sum(len(r.get('done') or []) for p, r in lights.items() if p.startswith('mine'))}; "
              f"never {sum(len(r.get('never') or []) for r in lights.values())}", flush=True)
    choice_log.read()
    lm, tm, ln, la, nt = choice_log.minutes()
    print(f"AFTER B.4 minutes: light {lm:.1f}, for torches {tm:.1f} (light chores {ln} by {len(la)} agents; "
          + (", ".join(f"{k} {n}" for k, n in sorted(nt.items())) or "nothing made for torches")
          + ("" if choice_log.path else "; no MCAI_CHOICE_LOG: not counted") + ")", flush=True)
    # The village appetite at the end: each member, the shares, the ledger, the fields' growing range (spec 6)
    for line in food.end_lines(call(f"/village/{args.village}"), call("/agents")):
        print(line, flush=True)
    # (an early stop keeps the " min after" ending the growth lines key on)
    reason += f", until {until_met} after" if until_met else f", then {args.after:g} min after"
v = call(f"/village/{args.village}")
stamps.update(v["tasks"])
stock_line(v, force=True)
u = usage_report(usage_since, watched)
print(f"RUN village={args.village} end={int(time.time() * 1000)}", flush=True)
print(f"\nSTOPPED after {(time.time() - t0) / 60:.1f}m ({reason}){usage_suffix(u)}")
for t in v["tasks"]:
    print(f"  {t['id']} [{t['status']}{'/' + t['claimedBy'] if t.get('claimedBy') else ''}] {t['title']}: {(t.get('result') or '')[:120]}")


def prepare_lines(v):
    """S.6: each part of the plot prepared at once (or the whole plot's one task): by whom, claimed and done in minutes since
    the start; when the huts' ground and the whole plot were done; and the plot record (its parts done while not whole,
    and the layout's one level)."""
    m = lambda s: f"+{(s - t0) / 60:.1f}" if s else "-"
    out = []
    prep = [t for t in v["tasks"] if t["title"].startswith("Prepare ")]
    for t in prep:
        out.append(f"PREPARE {t['id']} [{t['status']}{'/' + t['claimedBy'] if t.get('claimedBy') else ''}] {t['title']}: "
                   f"claimed {m(stamps.first_claim(t))}, done {m(stamps.end(t))}")
    huts = [stamps.end(t) for t in prep if re.search(r"huts?'s? ground\)", t["title"])]
    ends = [stamps.end(t) for t in prep]
    lay0 = (v.get("layouts") or [{}])[0]
    rec = next((q for q in v.get("plots") or [] if not q.get("annex")), None)
    state = "none" if not rec else f"{rec['id']} y={rec['y']}, " + (f"parts {len(rec['parts'])} of {len(lay0.get('parts') or [])} done" if rec.get("parts") is not None else "whole")
    out.append(f"PREPARE {len(prep)} task{'s' if len(prep) != 1 else ''}: huts' ground done {m(max(huts)) if huts and all(huts) else '-'}, "
               f"whole plot done {m(max(ends)) if ends and all(ends) else '-'}; record {state}; level {lay0.get('y', '-')}")
    return out


# (the village as built to completion: the tasks before the first growth layout's first id, the spec check's M2; then the
# growth layouts' own lines)
base_v = {**v, "tasks": grow.base(v)}
build_lines = [] if args.resume else (prepare_lines(base_v) + critical_path_lines(base_v["tasks"], stamps, t0, complete_at)
                                      + mine_stats.lines(base_v["tasks"], stamps) + tail_lines(base_v["tasks"], stamps, t0))
if args.resume:
    print("RESUMED from a checkpoint: the build's PREPARE, CRITICAL PATH, MINE and TAIL lines belong to the run that saved it")
for line in clock.lines() + build_lines:
    print(line)
# (only with growth: a run without it prints what it did before s30, the review's lens 3 L4)
if (grow.on and args.after and reason.endswith(" min after")) or v.get("growth"):
    for line in grow.end_lines(v, stamps):
        print(line)
# (S.4: the Mayor's share of the tail, beside its gathering)
mayor_done = [t for t in v["tasks"] if t["status"] == "done" and t.get("claimedBy") == "Mayor" and TAIL_CALL.match(t["detail"])]
if "Mayor" in watched:
    print(f"TAIL Mayor: finished {len(mayor_done)} lamp and sign tasks ({', '.join(t['id'] for t in mayor_done) or 'none'}), busy {tail_busy[0]:.1f} min holding them")
storage = {}
for c in (v.get("storage") or {}).get("chests", []):
    for k, q in c["items"].items():
        storage[k] = storage.get(k, 0) + q
print("STORAGE", storage)
for i, c in enumerate((v.get("storage") or {}).get("chests", [])):
    print(f"  chest {i + 1} ({c.get('group')}) at {c['x']},{c['y']},{c['z']}: {c['items']}")
# Over 4 agents one AGENTS table (one aligned row each) replaces the STATS lines, which --verbose keeps (E.1: 25 STATS lines
# buried the rest of the summary)
table = len(watched) > 4
rows = []
for n in watched:
    mem = call(f"/agents/{n}/memory") or {}
    st = mem.get("stats") or {}
    out_tokens = sum(st.get(k + "OutTokensTotal", 0) for k in ("plan", "design", "exec"))
    refused = f", budget-refused {st['budgetRefused']}" if st.get("budgetRefused") else ""
    # (the stuck rescues by how, from the agent's memory: interventions for autonomy_metrics.py)
    rescues = {k: q for k, q in (mem.get("rescues") or {}).items() if k != "last"}
    b = clock.busy["before"][n] + clock.busy["after"][n]
    sp = clock.span["before"][n] + clock.span["after"][n]
    rows.append((n, f"{100 * b / sp:.0f}%" if sp else "n/a", st.get("actionsDone", 0), st.get("actionsFailed", 0), st.get("contention", 0),
                 st.get("repeatsRefused", 0), " ".join(f"{k} {q}" for k, q in rescues.items()) or "-"))
    if table and not args.verbose:
        continue
    print(f"STATS {n}: plan {st.get('planCalls', 0)}x{st.get('planMsAvg', 0)}ms, exec {st.get('execCalls', 0)}x{st.get('execMsAvg', 0)}ms, "
          f"design {st.get('designCalls', 0)}x{st.get('designMsAvg', 0)}ms, done {st.get('actionsDone', 0)}, failed {st.get('actionsFailed', 0)}, "
          f"contention {st.get('contention', 0)}, refused {st.get('repeatsRefused', 0)}, out tokens {out_tokens}{refused}, rescues {json.dumps(rescues)}")
if table:
    head = ("AGENTS", "busy", "done", "failed", "contention", "refused", "rescues")
    wid = [max(len(str(r[i])) for r in rows + [head]) for i in range(len(head))]
    for r in [head] + rows:
        print("  ".join(str(c).ljust(wid[i]) if i in (0, 6) else str(c).rjust(wid[i]) for i, c in enumerate(r)).rstrip())
for line in usage_lines(u, watched):
    print(line)
print("STRUCTURES", [(s["kind"], s["x1"], s["x2"], s["z1"], s["z2"], s["builtBy"]) for s in v["structures"]])
