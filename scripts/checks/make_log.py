"""S.9's workshop read from an agent server's log (runs/2026-10-14/spec_s9.md 8.4; no server).

Usage: python scripts/checks/make_log.py AGENT_LOG [STAGE_LOG ...] [--logs-cap N]
  AGENT_LOG   the agent server's log (runs/<date>/testagents-<time>.log for staged runs on the test world)
  STAGE_LOG   stage_village.py's or watch_village.py's log of the same run: builds put back on the board for materials
              after completion are counted from its AFTER lines (the agent log does not carry the village's notes)
  --logs-cap  logs gathering may bring a village in an hour (default MC_GATHER_LOGS_HOUR or 96)

Per `[make] <agent> <village> item=... made=... batch=... furnace=... planned=... took=... back=... left=... storage=B->A
sec=...` end line (the make skill's, after its withdrawal; made=0 on a failure): what was taken is what was planned
(else a smaller batch announced first, `[make] A V: <item> short of <x> (took a of b): a smaller batch of <c>`), the batch
made whole, nothing left in hand, nothing given back but leftovers (never the good itself, never more of an input than
was taken), and the storage's count of the good up by what was made (a tool taken by a miner in the same second is
reported, not failed; for torches, a light chore of the village running during the make may take or put back torches
meanwhile, reported, not failed). Then: gathering's deposits per material from the [choice]/[choice-end] records of gather chores,
the logs gathering brought within any hour against the cap, the works plot's furnaces and the [tech] firsts, smelting
makes at once on different furnaces (from their chores' times), and builds put back for materials after completion.
Prints `MAKE ok N of M` and exits 1 on any mismatch.

B.4 (runs/2026-10-15/spec_b4.md 7.4): per `[light] <agent> <village> part=... placed=P standing=S dropped=D never=K
skipped=Q carried0=C took=T back=B left=L walk=... sec=...` end line (put_up_torches'), the torches add up (C + T - P - B
== L) and every placement is accounted for on the server's counts (P == S + D: S confirmed standing 1 s after placing, D
dropped, plus unconfirmed=U when the server gave no answer); and a stage log's `AFTER LIGHT standing S of D` (the server's check of every recorded spot at the end) must
have S == D. Also the light chores queued and their walks (door or fallback stand, failed walks), the torch demand lines,
and the light chores' minutes from the [choice] records. Prints `LIGHT ok N of M`.

A village that grows (s30, runs/2026-10-15/s30/spec_grow.md risk 6): growth builds, lamps, signs and the windows' make take
from and put into storage beside the makes, and their withdrawals are not logged. A make whose storage count is off while
growth board work ran (its chore's [choice] to [choice-end], against the stage log's `GROW TASK id claimed=MS end=MS|- by=A
title` spans) is a note naming that work, not a mismatch, when the work can take that good (a build by its bill, the
stage log's takes=; lamps, signs and the windows' make by their goods). Without the spans, a make during a growth layout (the
agent log's `[grow] V: layout L ... posted` to `... ended` lines, by log order) leaves its count unchecked: neither ok nor a
mismatch. Read the make's own line before trusting either (lesson 132). A growth build put back for materials is a mismatch
only when a make that took one of the short materials ran inside the build's span (traced to a make); otherwise a note.
Without growth lines nothing changes.

The village appetite (s30's food step, runs/2026-10-15/s30/spec_food.md 5 and 6): bread and pumpkin pie are workshop goods,
and members eat them from storage while a make runs. A food make whose storage count rose by less than it made while an
eat chore of the village ran (its [choice] kind eat, to its [choice-end]), or by more while a harvest of a wheat field baked
bread (kind farm), is a note naming that chore, not a mismatch (lesson 132), as far as those chores' end lines say they
moved the good ("ate N bread", "baked N bread"): beyond that it is a mismatch; without the choice records, the eat chores
between the make's queue line and its end line count. And `food:` lines: the meals the eat chores' ends name ("ate N item"),
the appetite state lines (`[food] <agent> peckish|hungry|fed ...`) and the food makes. Without food lines nothing changes.
"""
import json, os, re, sys
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
args = [a for a in sys.argv[1:]]
cap = int(os.environ.get("MC_GATHER_LOGS_HOUR", "96"))
if "--logs-cap" in args:
    i = args.index("--logs-cap")
    cap = int(args[i + 1])
    del args[i:i + 2]
if not args:
    print(__doc__)
    sys.exit(2)
agent_log, stage_logs = args[0], args[1:]

END = re.compile(r"^\[make\] (\S+) (\S+) item=(\S+) made=(\d+) batch=(\d+) furnace=(\S+) planned=(\S*) took=(\S*) back=(\S*) left=(\S*) storage=(-?\d+)->(-?\d+) sec=([\d.]+)")
SMALLER = re.compile(r"^\[make\] (\S+) (\S+): (\S+) short of (\S+) \(took (\d+) of (\d+)\): a smaller batch of (\d+)")
QUEUE = re.compile(r"^\[make\] (\S+): (\S+) makes (\d+) (\S+) \((.*)\)$")
GATHER_Q = re.compile(r"^\[gather\] (\S+): (\S+) gathers (\d+) (\S+) \((.*)\)$")
WORKS = re.compile(r"^\[works\] (.*)")
TECH = re.compile(r"^\[tech\] (.*)")
# B.4's light chores (mcWorld.ts the queue and the demand, mcBuild.ts putUpTorches the walk and the end)
LIGHT_END = re.compile(r"^\[light\] (\S+) (\S+) part=(\S+) placed=(\d+) standing=(\d+) dropped=(\d+) never=(\d+) skipped=(\d+) carried0=(\d+) "
                       r"took=(\d+) back=(\d+) left=(\d+) walk=(\S+) sec=([\d.]+)(?: unconfirmed=(\d+))?")
LIGHT_Q = re.compile(r"^\[light\] (\S+): (\S+) lights (\S+) \((.*)\): (\d+) of (\d+) unlit, (\d+) torches spare")
LIGHT_WALK = re.compile(r"^\[light\] (\S+) walks to the (.*): stand (\S+) \((door|fallback)\), (\S+) blocks from the hut")
LIGHT_DEMAND = re.compile(r"^\[light\] (\S+): torch demand (\d+) \(buildings (\d+), mine (\d+)\), make target (\d+)")
STANDING = re.compile(r"AFTER LIGHT standing (\d+) of (\d+)(?: \((\d+) not loaded\))?")
# Tools a miner or a farm start may take from storage while a make deposits (the storage count then rises by less), and
# fuel a torch make or a smelt takes meanwhile (S9m: charcoal 3->6 for 5 made). Torches are not here: a torch count that
# moves is a note only when a light chore or the sweep's put-back of a stopped make's torches overlapped the make (B.4's fix
# review, M1: otherwise a real torch shortfall was hidden)
TAKEN_BY_OTHERS = {"stone_pickaxe", "stone_hoe", "charcoal"}
# A village that grows (spec 2.6): a layout posted and ended in the agent log; the stage log's growth task spans; a build put
# back for materials (its task id)
# (X.2: a public work's layout too, "[work] V: layout N (public work piece) posted by A"; its number is the layout's)
GROW_POSTED = re.compile(r"^\[(?:grow|work)\] (\S+): layout (\S+) \((?:neighbourhood (\d+)|public work \S+)\) posted by (\S+)")
GROW_ENDED = re.compile(r"^\[grow\] (\S+): layout (\S+) ended (\S+) in ([\d.]+) min")
GROW_TASK = re.compile(r"^GROW TASK (t\d+) claimed=(\d+) end=(\d+|-) by=(\S+)(?: takes=(\S*))? (.*)")
REQUEUE_ID = re.compile(r"put (t\d+) back on the board to wait for them|(t\d+) \"[^\"]*\" waits for .*: materials were short")
PUTBACK = re.compile(r"^\[make\] (\S+): (\S+) puts back what a stopped make left \((.*)\)")
# The village appetite (s30): the workshop's food goods, a member's state change, a meal's message, food points (appetite.ts
# FOOD_POINTS for what a village makes)
FOOD_GOODS = {"bread", "pumpkin_pie"}
FOOD_STATE = re.compile(r"^\[food\] (?:\S+: )?(\S+) (fed|peckish|hungry)\b")
FOOD_MEAL = re.compile(r"\bate (\d+) ([a-z_]+)")
FOOD_POINTS = {"bread": 5, "pumpkin_pie": 8, "melon_slice": 2, "carrot": 3, "baked_potato": 5, "potato": 1, "apple": 4, "cookie": 2,
               "beetroot": 1, "mushroom_stew": 6, "beetroot_soup": 6, "rabbit_stew": 10, "sweet_berries": 2, "glow_berries": 2,
               "golden_carrot": 6, "cake": 14}


def counts(s):
    """'cobblestone:12,birch_log:1' (or 'none', '-' or empty) as a dict."""
    out = {}
    for part in (s or "").split(","):
        if ":" not in part:
            continue
        n, q = part.rsplit(":", 1)
        try:
            out[n] = out.get(n, 0) + int(q)
        except ValueError:
            pass
    return out


def deposited(message, material):
    """What a deposit's message says went in of a gathering's material (its head only, as mcWorld.ts depositedOf)."""
    m = re.match(r"^deposited ([^(;.]*)", message or "")
    head = m.group(1) if m else ""
    name = r"[a-z_]+_log" if material == "logs" else r"(?:red_)?sand" if material == "sand" else r"cobblestone"
    return sum(int(x) for x in re.findall(rf"(\d+) {name}\b", head))


lines = open(agent_log, encoding="utf-8", errors="replace").read().splitlines()
ends, smaller, queued, gather_q, works, tech = [], {}, [], [], [], []
choices, choice_ends = {}, {}
light_ends, light_q, light_walks, light_demand = [], [], [], []
putbacks = []
grow_layouts = []
food_states = []
for i, ln in enumerate(lines):
    m = FOOD_STATE.match(ln)
    if m:
        food_states.append(dict(agent=m.group(1), state=m.group(2), i=i))
        continue
    m = GROW_POSTED.match(ln)
    if m:
        grow_layouts.append(dict(village=m.group(1), layout=m.group(2), k=int(m.group(3)) if m.group(3) else 0, by=m.group(4), i=i, end=None, why=None))
        continue
    m = GROW_ENDED.match(ln)
    if m:
        for g in reversed(grow_layouts):
            if g["village"] == m.group(1) and g["layout"] == m.group(2) and g["end"] is None:
                g["end"], g["why"] = i, m.group(3)
                break
        continue
    m = PUTBACK.match(ln)
    if m:
        putbacks.append(dict(village=m.group(1), agent=m.group(2), items=counts(m.group(3).replace(" ", "")), i=i))
        continue
    m = LIGHT_END.match(ln)
    if m:
        a, v, part, p, s, d, k, q, c0, t, b, l, walk, sec, u = m.groups()
        light_ends.append(dict(agent=a, village=v, part=part, placed=int(p), standing=int(s), dropped=int(d), never=int(k), skipped=int(q),
                               carried0=int(c0), took=int(t), back=int(b), left=int(l), walk=walk, sec=float(sec), unconfirmed=int(u or 0), line=ln, i=i))
        continue
    m = LIGHT_Q.match(ln)
    if m:
        light_q.append(dict(village=m.group(1), agent=m.group(2), part=m.group(3), label=m.group(4), n=int(m.group(5)), unlit=int(m.group(6)), spare=int(m.group(7)), i=i))
        continue
    m = LIGHT_WALK.match(ln)
    if m:
        light_walks.append(dict(agent=m.group(1), label=m.group(2), stand=m.group(3), how=m.group(4), d=m.group(5)))
        continue
    m = LIGHT_DEMAND.match(ln)
    if m:
        light_demand.append(dict(village=m.group(1), demand=int(m.group(2)), buildings=int(m.group(3)), mine=int(m.group(4)), target=int(m.group(5))))
        continue
    m = END.match(ln)
    if m:
        a, v, item, made, batch, fur, planned, took, back, left, s0, s1, sec = m.groups()
        ends.append(dict(agent=a, village=v, item=item, made=int(made), batch=int(batch), furnace=fur, planned=counts(planned),
                         took=counts(took), back=counts(back), left=left, before=int(s0), after=int(s1), sec=float(sec),
                         smaller=smaller.pop((a, v, item), None), line=ln, i=i))
        continue
    m = SMALLER.match(ln)
    if m:
        smaller[(m.group(1), m.group(2), m.group(3))] = ln
        continue
    m = QUEUE.match(ln)
    if m:
        queued.append(dict(village=m.group(1), agent=m.group(2), count=int(m.group(3)), item=m.group(4), rest=m.group(5), i=i))
        continue
    m = GATHER_Q.match(ln)
    if m:
        gather_q.append(dict(village=m.group(1), agent=m.group(2), n=int(m.group(3)), material=m.group(4)))
        continue
    if WORKS.match(ln):
        works.append(ln)
        continue
    if TECH.match(ln):
        tech.append(ln)
        continue
    for tag, store in (("[choice] ", choices), ("[choice-end] ", choice_ends)):
        if ln.startswith(tag):
            try:
                r = json.loads(ln[len(tag):])
                r["_i"] = i
                store[r["id"]] = r
            except (ValueError, KeyError):
                pass

problems, notes = [], []

# ---- a village that grows: the growth tasks' spans from the stage logs (ms since the epoch; end None while open)
# (and the tasks put back for materials: such a build deposits what it withdrew)
grow_tasks, put_back = {}, set()
for f in stage_logs:
    for ln in open(f, encoding="utf-8", errors="replace"):
        m = GROW_TASK.match(ln)
        if m:
            grow_tasks[m.group(1)] = dict(id=m.group(1), t0=int(m.group(2)), t1=None if m.group(3) == "-" else int(m.group(3)), by=m.group(4),
                                          takes=None if m.group(5) is None else set(filter(None, m.group(5).split(","))), title=m.group(6).strip())
        m = REQUEUE_ID.search(ln)
        if m:
            put_back.add(m.group(1) or m.group(2))


def make_window(e):
    """A make end line's chore: its [choice] record's time (the last make choice of that agent and item before the end
    line) and its [choice-end]'s; (None, None) when the choice log has none."""
    c = max((c for c in choices.values() if c.get("kind") == "make" and c.get("agent") == e["agent"] and (c.get("chosen") or "") == f"make:{e['item']}"
             and c["_i"] < e["i"]), key=lambda c: c["_i"], default=None)
    if not c:
        return None, None
    return c.get("t"), choice_ends.get(c["id"], {}).get("tEnd")


def can_take(g, item):
    """Whether a growth task can take this good from storage (the review's lens 3 M3: any overlapping task excused any
    good): a build what its bill holds (`takes=` from the stage log; without it, the goods a house is built of and smelting
    fuel), the lamps torches, sticks, fences, planks and fuel, a sign signs, sticks and planks, the windows' make its glass,
    sand and fuel, another make its own good."""
    title, fuel = g["title"], item in ("charcoal", "coal")
    if title.startswith("Build "):
        if g.get("takes") is None:
            return item in ("glass", "glass_pane", "stone_bricks", "smooth_stone") or fuel
        # (the bill names the design's wood, oak, while the village builds in its own kind, birch: any kind matches)
        wood = lambda n: re.sub(r"^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_", "WOOD_", n)
        return item in g["takes"] or wood(item) in {wood(t) for t in g["takes"]}
    if title.startswith("Light the streets"):
        return item in ("torch", "stick") or fuel or item.endswith(("_fence", "_planks"))
    if title.startswith("Put up the sign"):
        return item == "stick" or item.endswith(("_sign", "_planks"))
    m = re.match(r"Make \d+ (\S+)", title)
    if m:
        return item == m.group(1) or (m.group(1) in ("glass", "glass_pane") and (item in ("glass", "sand", "red_sand") or fuel))
    return False


def growth_during(e, more):
    """The growth board work a make overlapped that can explain its storage count, as (text, unchecked): text '' when none
    can (or no growth at all). A count short of what was made (`more` false) can be a growth task's withdrawal of that good;
    one beyond it only the windows' make of that good depositing, or a build put back depositing what it withdrew. Without
    GROW TASK spans, a growth layout under way (by log order, a short count only) leaves the count unchecked, not excused."""
    t0, t1 = make_window(e)
    if grow_tasks and t0:
        hit = [g for g in grow_tasks.values() if g["t0"] < (t1 or float("inf")) and (g["t1"] is None or g["t1"] > t0)
               and (can_take(g, e["item"]) if not more else (re.match(rf"Make \d+ {e['item']}\b", g["title"]) or (g["title"].startswith("Build ") and g["id"] in put_back)))]
        return ", ".join(f"{g['id']} {g['title'][:40]} ({g['by']})" for g in hit[:4]) + (f" and {len(hit) - 4} more" if len(hit) > 4 else ""), False
    # (no spans: a growth layout of the village under way, from the make's queue line to its end line; a count short of what
    # was made only)
    if more:
        return "", False
    start = max((q["i"] for q in queued if q["agent"] == e["agent"] and q["item"] == e["item"] and q["i"] < e["i"]), default=e["i"])
    return "", any(g["village"] == e["village"] and g["i"] < e["i"] and (g["end"] is None or g["end"] > start) for g in grow_layouts)


grow_notes = 0
unchecked = []


def light_during(e):
    """Whether a light chore of the make's village ran (its queue line to its end line, by log order) while the make did
    (its queue line to its end line): its withdrawal or put-back moves storage's torches inside the make's count."""
    start = max((q["i"] for q in queued if q["agent"] == e["agent"] and q["item"] == e["item"] and q["i"] < e["i"]), default=0)
    for le in light_ends:
        if le["village"] != e["village"]:
            continue
        ls = max((q["i"] for q in light_q if q["agent"] == le["agent"] and q["part"] == le["part"] and q["i"] < le["i"]), default=le["i"])
        if ls < e["i"] and le["i"] > start:
            return True
    # (the sweep's put-back of torches a stopped or stalled light chore left, inside the make's window)
    return any(pb["village"] == e["village"] and "torch" in pb["items"] and start < pb["i"] < e["i"] for pb in putbacks)


def is_eat(c):
    return c.get("kind") == "eat" or (c.get("chosen") or "").startswith("eat")


FOOD_BAKED = re.compile(r"\bbaked (\d+) bread")


def food_during(e, more):
    """The chores that can explain a food make's storage count (the village appetite, s30): eat chores of its village taking
    the good while the make ran (a count short of what was made), or a wheat field's harvest baking bread into storage (a count
    beyond it). By the chores' times inside the make's chore; without a make window, by log order from its queue line.
    Returns (the chores named, how many of the good they moved: the "ate N <good>" or "baked N bread" of their end lines),
    and the excuse holds only up to that many (lens 3 M1: a make that put back nothing must still fail)."""
    t0, t1 = make_window(e)
    want = (lambda c: c.get("kind") == "farm") if more else is_eat
    if more and e["item"] != "bread":
        return "", 0
    hit, moved = [], 0
    for c in choices.values():
        if c.get("village") != e["village"] or not want(c):
            continue
        end = choice_ends.get(c["id"], {})
        if t0:
            ok = c.get("t", 0) < (t1 or float("inf")) and (end.get("tEnd") is None or end["tEnd"] > t0)
        else:
            start = max((q["i"] for q in queued if q["agent"] == e["agent"] and q["item"] == e["item"] and q["i"] < e["i"]), default=e["i"])
            ok = start < c["_i"] < e["i"]
        if ok:
            hit.append(f"{c.get('agent')} {c.get('chosen') or c.get('key')}")
            msg = end.get("message") or ""
            moved += sum(int(q) for q in FOOD_BAKED.findall(msg)) if more else sum(int(q) for q, item in FOOD_MEAL.findall(msg) if item == e["item"])
    return ", ".join(hit[:4]) + (f" and {len(hit) - 4} more" if len(hit) > 4 else ""), moved


# ---- the make end lines
made_ok = made_n = 0
failed = []
for e in ends:
    who = f"{e['agent']} {e['village']} {e['item']}"
    if e["made"] == 0:
        failed.append(e)
        if e["left"] not in ("none", "", "-"):
            notes.append(f"{who}: a failed make left {e['left']} in hand (the sweep puts it back, spec 4.10)")
        continue
    made_n += 1
    bad = []
    if e["planned"] != e["took"]:
        if e["smaller"]:
            notes.append(f"{who}: took {e['took']} of planned {e['planned']} for a smaller batch of {e['batch']}")
        else:
            bad.append(f"took {e['took']} but planned {e['planned']} with no smaller batch announced")
    if e["made"] != e["batch"]:
        bad.append(f"made {e['made']} of a batch of {e['batch']}")
    if e["left"] not in ("none", "", "-"):
        bad.append(f"left {e['left']} in hand")
    if e["item"] in e["back"]:
        bad.append(f"gave back {e['back'][e['item']]} of the good itself")
    # (planks and slabs sawn from logs taken come back beyond the planks taken: 2 oak logs and 1 plank for two wooden
    # swords give 3 planks back, S9f)
    # (and sticks from planks or logs taken: a torch make with 2 sticks, a plank and a log gave 3 sticks back, B4f)
    def sawn(n):
        if n == "stick":
            return any(t.endswith(("_planks", "_log")) for t in e["took"])
        kind = re.sub(r"_(planks|slab)$", "", n)
        return kind != n and any(t in e["took"] for t in (f"{kind}_log", f"{kind}_planks") if t != n)
    for n, q in e["back"].items():
        if n in e["took"] and q > e["took"][n] and not sawn(n):
            bad.append(f"gave back {q} {n}, took {e['took'][n]}")
    d = e["after"] - e["before"]
    grown = None
    if d != e["made"]:
        if d < e["made"] and e["item"] in TAKEN_BY_OTHERS:
            notes.append(f"{who}: storage {e['before']}->{e['after']} for {e['made']} made (taken from storage meanwhile)")
        elif e["item"] in FOOD_GOODS and (fd := food_during(e, d > e["made"]))[0] and abs(d - e["made"]) <= fd[1]:
            notes.append(f"{who}: storage {e['before']}->{e['after']} for {e['made']} made ({'a harvest baked' if d > e['made'] else 'members ate'} {fd[1]} meanwhile: {fd[0]})")
        elif e["item"] == "torch" and light_during(e):
            notes.append(f"{who}: storage {e['before']}->{e['after']} for {e['made']} made (a light chore or a put-back moved torches meanwhile)")
        elif any(grown := growth_during(e, d > e["made"])):
            if grown[0]:
                grow_notes += 1
                notes.append(f"{who}: storage {e['before']}->{e['after']} for {e['made']} made (growth board work meanwhile: {grown[0]})")
            else:
                unchecked.append(f"{who}: storage {e['before']}->{e['after']} for {e['made']} made (a growth layout under way, no GROW TASK spans)")
        else:
            bad.append(f"storage {e['before']}->{e['after']} for {e['made']} made")
    if bad:
        problems.append(f"{who}: " + "; ".join(bad) + f"  [{e['line'][:200]}]")
    elif not (grown and not grown[0] and grown[1]):
        made_ok += 1

# ---- gathering, from the chores' own records
trip_mats = {}
for cid, c in choices.items():
    if c.get("kind") == "gather":
        m = re.match(r"gather:(\w+)", c.get("chosen") or c.get("key") or "")
        if m:
            trip_mats[cid] = (c.get("village"), m.group(1), c.get("agent"))
got = defaultdict(int)
gathers = defaultdict(lambda: [0, 0])
logs_at = defaultdict(list)
for cid, (village, mat, agent) in trip_mats.items():
    e = choice_ends.get(cid)
    if not e:
        continue
    gathers[mat][0] += 1
    n = deposited(e.get("message", ""), mat) if e.get("ok") else 0
    if n:
        gathers[mat][1] += 1
    got[mat] += n
    if mat == "logs" and n:
        logs_at[village].append((e.get("tEnd", 0), n))
logs_peak = {}
for village, xs in logs_at.items():
    xs.sort()
    best = 0
    for i, (t, _) in enumerate(xs):
        best = max(best, sum(q for t2, q in xs if t - 3600_000 < t2 <= t))
    logs_peak[village] = best
    if best > cap:
        problems.append(f"{village}: {best} logs gathered within an hour (cap {cap})")

# ---- smelting makes at once on different furnaces (a make's chore from its [choice] to its [choice-end])
spans = []
last_choice = {}
for cid, c in sorted(choices.items(), key=lambda kv: kv[1].get("t", 0)):
    if c.get("kind") == "make":
        last_choice[(c.get("agent"), (c.get("chosen") or "")[5:])] = cid
for q in queued:
    m = re.search(r"furnace (\d+)\)?$", q["rest"]) or re.search(r"; furnace (\d+)", q["rest"])
    cid = last_choice.get((q["agent"], q["item"]))
    if not m or not cid or cid not in choice_ends:
        continue
    spans.append((choices[cid].get("t", 0), choice_ends[cid].get("tEnd", 0), int(m.group(1)), q["item"]))
overlap = 0
for i, (s, e, k, _) in enumerate(spans):
    at = {k2 for s2, e2, k2, _ in spans if s2 < e and s < e2}
    overlap = max(overlap, len(at))

# ---- builds put back for materials after completion (the stage log's AFTER lines)
requeues = []
grow_requeues, traced = [], []


def took_short(mat, took):
    """Whether a make's take holds a material a requeue posted gathering for (any log for logs)."""
    if mat == "logs" or mat.endswith("_log"):
        return any(n.endswith("_log") for n in took)
    return mat in took


for f in stage_logs:
    after = False
    for ln in open(f, encoding="utf-8", errors="replace"):
        if ln.startswith("AFTER start"):
            after = True
        if after and (re.search(r"back on the board to wait for them", ln) or re.search(r"waits for .*: materials were short", ln)):
            m = REQUEUE_ID.search(ln)
            g = grow_tasks.get(m.group(1) or m.group(2)) if m else None
            if not g:
                requeues.append(ln.strip()[:200])
                continue
            # (a growth build: traced to a make when a make that took a short material ran inside the build's span)
            short = set(re.findall(r"Gather \d+ (\S+) for", ln))
            hit = []
            for e in ends:
                t0, t1 = make_window(e)
                if t0 and t0 < (g["t1"] or float("inf")) and (t1 is None or t1 > g["t0"]) and any(took_short(mt, e["took"]) for mt in short):
                    hit.append(f"{e['agent']} {e['item']} took {','.join(f'{n}:{q}' for n, q in e['took'].items())}")
            (traced if hit else grow_requeues).append(f"{g['id']} {g['title'][:40]} short of {', '.join(sorted(short)) or '?'}" + (f": {'; '.join(hit[:3])}" if hit else ""))
if requeues:
    problems.append(f"{len(requeues)} builds put back for materials after completion (first: {requeues[0]})")
for t in traced:
    problems.append(f"a growth build put back for materials a make took meanwhile: {t}")
for t in grow_requeues:
    notes.append(f"a growth build put back for materials (no make took them meanwhile): {t}")

# ---- B.4's light chores: each end line's torches and placements, the stage log's standing check
light_ok = 0
light_bad = []
for e in light_ends:
    bad = []
    if e["carried0"] + e["took"] - e["placed"] - e["back"] != e["left"]:
        bad.append(f"carried0 {e['carried0']} + took {e['took']} - placed {e['placed']} - back {e['back']} != left {e['left']}")
    if e["placed"] != e["standing"] + e["dropped"] + e["unconfirmed"]:
        bad.append(f"placed {e['placed']} != standing {e['standing']} + dropped {e['dropped']}" + (f" + unconfirmed {e['unconfirmed']}" if e["unconfirmed"] else ""))
    if bad:
        light_bad.append(f"{e['agent']} {e['village']} {e['part']}: " + "; ".join(bad) + f"  [{e['line'][:200]}]")
    else:
        light_ok += 1
problems.extend(light_bad)
standing = []
for f in stage_logs:
    for ln in open(f, encoding="utf-8", errors="replace"):
        m = STANDING.search(ln)
        if m:
            standing.append((int(m.group(1)), int(m.group(2)), int(m.group(3) or 0), f))
for s, d, u, f in standing:
    # (spots whose chunk was not loaded at the check are not known either way: noted, not counted)
    if s != d - u:
        problems.append(f"{os.path.basename(f)}: {s} torches standing of {d - u} recorded and tested (AFTER LIGHT standing)")
    if u:
        notes.append(f"{os.path.basename(f)}: {u} recorded torches not tested (chunk not loaded)")
light_choices = [c for c in choices.values() if c.get("kind") == "light"]
light_min = sum(choice_ends[c["id"]].get("minutes", 0) for c in light_choices if c["id"] in choice_ends)

# ---- report
by_item = defaultdict(lambda: [0, 0])
for e in ends:
    by_item[e["item"]][0] += 1
    by_item[e["item"]][1] += e["made"]
print(f"makes queued {len(queued)}, ended {len(ends)} ({len(failed)} failed): " + (", ".join(f"{k} {n}x/{q}" for k, (n, q) in sorted(by_item.items())) or "none"))
for e in failed[:10]:
    print(f"  failed: {e['agent']} {e['item']} batch {e['batch']} furnace {e['furnace']} took {e['took'] or '-'} left {e['left']}")
smelting = [e for e in ends if e["furnace"] != "-"]
if smelting:
    fz = defaultdict(int)
    for e in smelting:
        fz[e["furnace"]] += 1
    print(f"smelting makes by furnace: {', '.join(f'{k} {n}' for k, n in sorted(fz.items()))}; most at once on different furnaces {overlap}")
print(f"gathering: {sum(g[0] for g in gathers.values())} trips ended; " + (", ".join(f"{m} {gathers[m][1]} of {gathers[m][0]} landed, {got[m]} deposited" for m in sorted(gathers)) or "none")
      + (f"; logs within an hour at most {max(logs_peak.values())} (cap {cap})" if logs_peak else ""))
queued_by = defaultdict(int)
for g in gather_q:
    queued_by[g["material"]] += 1
print(f"gathering queued: {len(gather_q)} ({', '.join(f'{m} {n}' for m, n in sorted(queued_by.items())) or 'none'})")
for ln in works:
    print(f"  {ln[:200]}")
print(f"tech firsts: {len(tech)}")
for ln in tech[:40]:
    print(f"  {ln[:200]}")
for n in notes[:30]:
    print(f"note: {n}")
for p in problems[:40]:
    print(f"MISMATCH {p}")
print(f"requeues for materials after completion: {len(requeues)}" if stage_logs else "requeues: not checked (no STAGE_LOG)")
# (a village that grows: only when its lines are there)
if grow_layouts or grow_tasks:
    print(f"growth: {len(grow_layouts)} layouts posted, {sum(1 for g in grow_layouts if g['end'] is not None)} ended ("
          + (", ".join(f"{g['layout']} {g['why'] or 'open'}" for g in grow_layouts) or "-")
          + f"); {len(grow_tasks)} GROW TASK spans; {grow_notes} makes with storage moved by growth work, {len(unchecked)} unchecked; growth builds put back "
          f"{len(grow_requeues) + len(traced)} ({len(traced)} traced to a make)")
# (B.4) the light chores
by_part = defaultdict(lambda: [0, 0, 0])
for e in light_ends:
    by_part[e["part"]][0] += 1
    by_part[e["part"]][1] += e["standing"]
    by_part[e["part"]][2] += e["never"]
walks = defaultdict(int)
for e in light_ends:
    walks[e["walk"]] += 1
print(f"light chores queued {len(light_q)}, ended {len(light_ends)} by {len({e['agent'] for e in light_ends})} agents, "
      f"{sum(e['standing'] for e in light_ends)} torches standing, {sum(e['dropped'] for e in light_ends)} dropped, "
      f"{sum(e['never'] for e in light_ends)} spots never, {sum(e['skipped'] for e in light_ends)} skipped; walks "
      + (", ".join(f"{k} {n}" for k, n in sorted(walks.items())) or "none")
      + f" (stands: door {sum(1 for w in light_walks if w['how'] == 'door')}, fallback {sum(1 for w in light_walks if w['how'] == 'fallback')}); "
      f"{len(light_choices)} light choices, {light_min:.1f} agent-min")
for part, (n, s, k) in sorted(by_part.items()):
    print(f"  light {part}: {n} runs, {s} standing, {k} never")
if light_demand:
    last = light_demand[-1]
    print(f"torch demand lines {len(light_demand)}: first {light_demand[0]['demand']} (target {light_demand[0]['target']}), "
          f"last {last['demand']} (buildings {last['buildings']}, mine {last['mine']}, target {last['target']}), most {max(d['demand'] for d in light_demand)}")
for s, d, u, f in standing:
    print(f"standing check ({os.path.basename(f)}): {s} of {d} recorded torches standing" + (f" ({u} not loaded)" if u else ""))
for u in unchecked[:20]:
    print(f"unchecked: {u}")
# (the village appetite: only when its lines are there)
eats = [c for c in choices.values() if is_eat(c)]
if eats or food_states:
    ate, ok_n, fail_n, who = defaultdict(int), 0, 0, set()
    for c in eats:
        end = choice_ends.get(c["id"])
        if not end:
            continue
        if end.get("ok"):
            ok_n += 1
            who.add(c.get("agent"))
            for q, item in FOOD_MEAL.findall(end.get("message") or ""):
                ate[item] += int(q)
        else:
            fail_n += 1
    states = defaultdict(int)
    for f in food_states:
        states[f["state"]] += 1
    print(f"food: {len(eats)} eat chores, {ok_n} meals by {len(who)} agents ({sum(FOOD_POINTS.get(k, 0) * q for k, q in ate.items())} pts: "
          + (", ".join(f"{q} {k}" for k, q in sorted(ate.items())) or "nothing") + f"), {fail_n} failed; state lines "
          + (", ".join(f"{k} {n}" for k, n in sorted(states.items())) or "none")
          + f" ({len({f['agent'] for f in food_states if f['state'] == 'hungry'})} agents hungry at some time)")
    fm = [e for e in ends if e["item"] in FOOD_GOODS]
    print("food makes: " + (", ".join(f"{k} {sum(e['made'] for e in fm if e['item'] == k)} in {sum(1 for e in fm if e['item'] == k)} makes" for k in sorted(FOOD_GOODS)) if fm else "none"))
# (a make's storage count during growth with no GROW TASK spans is neither ok nor a mismatch: pass the stage log)
print(f"MAKE ok {made_ok} of {made_n}" + (f"; storage unchecked {len(unchecked)} (growth without GROW TASK spans)" if unchecked else ""))
print(f"LIGHT ok {light_ok} of {len(light_ends)}")
sys.exit(1 if problems else 0)
