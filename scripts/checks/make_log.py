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
reported, not failed). Then: gathering's deposits per material from the [choice]/[choice-end] records of gather chores,
the logs gathering brought within any hour against the cap, the works plot's furnaces and the [tech] firsts, smelting
makes at once on different furnaces (from their chores' times), and builds put back for materials after completion.
Prints `MAKE ok N of M` and exits 1 on any mismatch.
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
# Tools a miner or a farm start may take from storage while a make deposits (the storage count then rises by less)
TAKEN_BY_OTHERS = {"stone_pickaxe", "stone_hoe"}


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
for ln in lines:
    m = END.match(ln)
    if m:
        a, v, item, made, batch, fur, planned, took, back, left, s0, s1, sec = m.groups()
        ends.append(dict(agent=a, village=v, item=item, made=int(made), batch=int(batch), furnace=fur, planned=counts(planned),
                         took=counts(took), back=counts(back), left=left, before=int(s0), after=int(s1), sec=float(sec),
                         smaller=smaller.pop((a, v, item), None), line=ln))
        continue
    m = SMALLER.match(ln)
    if m:
        smaller[(m.group(1), m.group(2), m.group(3))] = ln
        continue
    m = QUEUE.match(ln)
    if m:
        queued.append(dict(village=m.group(1), agent=m.group(2), count=int(m.group(3)), item=m.group(4), rest=m.group(5)))
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
                store[r["id"]] = r
            except (ValueError, KeyError):
                pass

problems, notes = [], []

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
    for n, q in e["back"].items():
        if n in e["took"] and q > e["took"][n]:
            bad.append(f"gave back {q} {n}, took {e['took'][n]}")
    d = e["after"] - e["before"]
    if d != e["made"]:
        if d < e["made"] and e["item"] in TAKEN_BY_OTHERS:
            notes.append(f"{who}: storage {e['before']}->{e['after']} for {e['made']} made (taken from storage meanwhile)")
        else:
            bad.append(f"storage {e['before']}->{e['after']} for {e['made']} made")
    if bad:
        problems.append(f"{who}: " + "; ".join(bad) + f"  [{e['line'][:200]}]")
    else:
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
for f in stage_logs:
    after = False
    for ln in open(f, encoding="utf-8", errors="replace"):
        if ln.startswith("AFTER start"):
            after = True
        if after and (re.search(r"back on the board to wait for them", ln) or re.search(r"waits for .*: materials were short", ln)):
            requeues.append(ln.strip()[:200])
if requeues:
    problems.append(f"{len(requeues)} builds put back for materials after completion (first: {requeues[0]})")

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
print(f"MAKE ok {made_ok} of {made_n}")
sys.exit(1 if problems else 0)
