"""Autonomy metrics of a village run (PLAN.md step A.1), and the run measurements the watch scripts share (step S.0).

Usage: python scripts/checks/autonomy_metrics.py RUNLOG [CHOICES] [--village V] [--api URL] [--every MIN] [--json OUT]
  RUNLOG       the output of scripts/stage_village.py or scripts/watch_village.py (runs/<date>/<Village>.log)
  CHOICES      the decision log: the JSONL the agent server writes (MCAI_CHOICE_LOG, by default runs/choices-<date>.jsonl),
               or the agent server's own log with its [choice] and [choice-end] lines (its [rescue] lines are then
               counted too; the log has no times, so pass one per run)
  --village V  the village (default: the run log's RUN line); choices are kept for it and within the run's times
  --api URL    an agent server whose /api/materials prices storage in raw units (default MCAI_API, then ports 8767 and
               8766); without one every item counts 1
  --every MIN  the step of the curves (default 5)
  --json OUT   also write the numbers to a JSON file
Prints per agent: activity entropy and specialisation (from the finished and failed actions in the run log), unique
(activity, target) pairs, busy and idle minutes (the BUSY lines, else the AFTER busy line), refused repeats and
interventions (rescues, teleports) per agent-hour; for the village: cumulative unique pairs, the value of the storage
over time (the STOCK lines) with its drawdowns, the goal ledger of the decision log (chosen, done, failed, abandoned) and
the board's ledger. Building takes from the storage, so the value curve falls while the village is built.

The watch scripts import BusyClock, BoardStamps and critical_path_lines from here.
"""
import argparse, json, math, os, re, sys, time, urllib.request


# ---- shared with the watch scripts

class BusyClock:
    """Each agent's busy and idle time, before and after completion, from samples of /api/agents: an agent is busy while an
    action runs, and the time since the last sample goes to the state seen now (at most 30 s, so a pause in sampling
    counts for nothing)."""

    def __init__(self, names):
        self.names = list(names)
        self.busy = {ph: dict.fromkeys(self.names, 0.0) for ph in ("before", "after")}
        self.span = {ph: dict.fromkeys(self.names, 0.0) for ph in ("before", "after")}
        self.last = None

    def restart(self):
        """Sampling resumes after a pause (the checks between the build and the after phase)."""
        self.last = None

    def sample(self, listing, phase, now=None):
        now = time.time() if now is None else now
        if not isinstance(listing, list):
            return
        dt = 0.0 if self.last is None else min(30.0, now - self.last)
        self.last = now
        running = {a.get("name"): bool(a.get("action")) for a in listing if isinstance(a, dict)}
        for n in self.names:
            if n in running:
                self.span[phase][n] += dt
                if running[n]:
                    self.busy[phase][n] += dt

    def lines(self):
        def part(label, b, s):
            return f"{label} {b / 60:.1f} of {s / 60:.1f} min (idle {(s - b) / 60:.1f})"
        out = []
        for n in self.names:
            b = {ph: self.busy[ph][n] for ph in self.busy}
            s = {ph: self.span[ph][n] for ph in self.span}
            out.append(f"BUSY {n}: " + ", ".join([part("before completion", b["before"], s["before"]), part("after", b["after"], s["after"]),
                                                  part("whole run", b["before"] + b["after"], s["before"] + s["after"])]))
        tot = lambda d: sum(d.values())
        pct = lambda b, s: f"{100 * b / s:.0f}%" if s else "n/a"
        bb, sb, ba, sa = tot(self.busy["before"]), tot(self.span["before"]), tot(self.busy["after"]), tot(self.span["after"])
        out.append(f"BUSY all: before completion {pct(bb, sb)} busy ({bb / 60:.1f} of {sb / 60:.1f} agent-min), after {pct(ba, sa)} "
                   f"({ba / 60:.1f} of {sa / 60:.1f}), whole run {pct(bb + ba, sb + sa)} ({(bb + ba) / 60:.1f} of {(sb + sa) / 60:.1f})")
        return out


def _stamp(t, *keys):
    """A time a task record carries itself (ms since the epoch, at its top level or under `stamps`), in seconds; None if not."""
    for k in keys:
        v = t.get(k, (t.get("stamps") or {}).get(k))
        if isinstance(v, (int, float)) and v > 1e11:
            return v / 1000
    return None


class BoardStamps:
    """When each board task was first seen, claimed (each claim and by whom) and ended, from the watcher's polls (a few
    seconds apart); the end from the task's `updated` (the server sets it at done and failed), and any posted, claimed or
    done stamps the record carries itself take precedence."""

    def __init__(self):
        self.t = {}

    def update(self, tasks, now=None):
        now = time.time() if now is None else now
        for t in tasks or []:
            s = self.t.get(t["id"])
            if s is None:
                s = self.t[t["id"]] = {"seen": now, "claims": [], "end": None, "status": None, "reopened": 0}
            st = t["status"]
            if st == "claimed" and s["status"] != "claimed":
                s["claims"].append((now, t.get("claimedBy")))
            if st == "open" and s["status"] in ("claimed", "done", "failed"):
                s["reopened"] += 1
            if st in ("done", "failed") and s["status"] not in ("done", "failed"):
                s["end"] = (t["updated"] / 1000) if t.get("updated") else now
            if st in ("open", "claimed"):
                s["end"] = None
            s["status"] = st

    def posted(self, t):
        s = self.t.get(t["id"]) or {}
        return _stamp(t, "posted", "postedAt", "created") or s.get("seen")

    def first_claim(self, t):
        s = self.t.get(t["id"]) or {}
        return s["claims"][0][0] if s.get("claims") else _stamp(t, "claimed", "claimedAt")

    def last_claim(self, t):
        s = self.t.get(t["id"]) or {}
        return _stamp(t, "claimed", "claimedAt") or (s["claims"][-1][0] if s.get("claims") else None)

    def end(self, t):
        if t["status"] not in ("done", "failed"):
            return None
        s = self.t.get(t["id"]) or {}
        return _stamp(t, "done", "doneAt", "ended", "finished") or s.get("end") or ((t["updated"] / 1000) if t.get("updated") else None)

    def claims(self, t):
        return len((self.t.get(t["id"]) or {}).get("claims") or [])


# What completion waits for (the stage script's rule; the mayor's declaration follows them)
FINAL = re.compile(r"^(Build |Light the streets|Put up the signs|Plant the farm)")


def critical_path_lines(tasks, stamps, t0, complete_at=None):
    """The chain of tasks that set the finish: from the last task completion waited for, back through the prerequisite
    that let each one start last (its end, or its claim where the task waits only for claims; only those by the task's
    first claim). Per task: when it could
    start, the wait for a claim and the time held; then the totals. Times in minutes since t0; claims are seen at the
    watcher's polls."""
    by = {t["id"]: t for t in tasks or []}
    m = lambda s: (s - t0) / 60
    done = [t for t in by.values() if t["status"] == "done" and stamps.end(t)]
    finals = [t for t in done if FINAL.match(t["title"])] or done
    if not finals:
        return ["CRITICAL PATH: no task done"]
    cur, chain, visited = max(finals, key=stamps.end), [], set()
    while cur is not None and cur["id"] not in visited:
        visited.add(cur["id"])
        rel = []
        for i in cur.get("after") or []:
            p = by.get(i)
            if not p:
                continue
            at = (stamps.first_claim(p) or stamps.end(p)) if cur.get("afterClaimed") and p["title"].startswith("Build ") else stamps.end(p)
            if at:
                rel.append((at, p))
        posted = stamps.posted(cur) or t0
        # Only a prerequisite that ended by the task's first claim can have held it back: a claimed soft gather task the
        # storage covers counts as finished for claims (F97), so a build is often claimed before its gather tasks end. If
        # every one ended later, the task was ready at its claim and what let it start is not on the board: the chain ends.
        fc = stamps.first_claim(cur)
        early = [r for r in rel if fc is None or r[0] <= fc]
        covered = bool(rel) and not early
        at, binding = max(early, key=lambda r: r[0]) if early else ((fc, None) if covered else (posted, None))
        chain.append((cur, max(at, posted), binding is not None and posted > at, covered))
        cur = binding
    chain.reverse()
    out, held, waited, gaps, prev_end = [], 0.0, 0.0, 0.0, None
    for t, ready, late, covered in chain:
        claim, end = stamps.first_claim(t), stamps.end(t) or ready
        claim = ready if claim is None or claim < ready else claim
        n = stamps.claims(t)
        who = t.get("claimedBy") or "?"
        waited += claim - ready
        held += end - claim
        if prev_end is not None:
            gaps += max(0.0, ready - prev_end)
        prev_end = end
        out.append(f"CRIT {m(ready):5.1f}m-{m(end):5.1f}m {t['id']} {t['title'][:70]} [{who}]: waited {m(claim) - m(ready):.1f} for a claim, "
                   f"held {m(end) - m(claim):.1f}{f' ({n} claims)' if n > 1 else ''}{'; posted after its prerequisites ended' if late else ''}"
                   f"{'; claimed before its prerequisites ended (covered by storage)' if covered else ''}"
                   f"{'' if stamps.first_claim(t) else '; claim not seen'}")
    last = stamps.end(chain[-1][0])
    tail = f", completion {m(complete_at):.1f}m ({m(complete_at) - m(last):+.1f} after it)" if complete_at else ""
    out.insert(0, f"CRITICAL PATH {len(chain)} tasks, {m(chain[0][1]):.1f}m to {m(last):.1f}m{tail}: held {held / 60:.1f} min, "
                  f"waited for a claim {waited / 60:.1f}, gaps between tasks {gaps / 60:.1f}")
    return out


# ---- the metrics

EVENT = re.compile(r"^\s*(\d+\.\d)m (\S+)\s+(action_done|action_failed)\s+\| (.*)$")
AFTER_EVENT = re.compile(r"^AFTER\s+(\d+\.\d)m (\S+)\s+(action_done|action_failed)\s+\| (.*)$")
# A skill's target, read from its result text (none where the text names nothing that tells one trip from another)
TARGETS = [
    (r"^collect$", r"collected \d+ ([a-z_]+)"),
    (r"^build_design$", r"^([a-z0-9_]+) recorded"),
    (r"^start_farm$", r"started an? ([a-z_]+) farm"),
    (r"^(start_pen|breed_pen|collect_eggs|milk_cows)$", r"annex slot (\d+)"),
    (r"^make_iron_tool$", r"made an? ([a-z_]+)"),
    (r"^(harvest_farm|tend_farm)$", r"at x (-?\d+)"),
    (r"^scout$", r"toward (-?\d+,-?\d+)"),
    (r"^(withdraw|deposit|craft|smelt)$", r"(?:deposited|withdrew|crafted|smelted) (?:\d+ )?([a-z_]+)"),
    (r"^dig_iron$", r"(iron trip)"),
]


def activity_of(text):
    """(skill, target) of an action's result text ("collect finished: collected 8 wheat_seeds" -> collect, wheat_seeds)."""
    m = re.match(r"([a-z_]+) (finished|failed)", text)
    if not m:
        return None, None
    skill, rest = m.group(1), text[m.end():]
    for sk, rx in TARGETS:
        if re.match(sk, skill):
            t = re.search(rx, rest)
            return skill, (t.group(1) if t else None)
    return skill, None


def entropy(counts):
    n = sum(counts.values())
    return max(0.0, -sum(c / n * math.log2(c / n) for c in counts.values() if c)) if n else 0.0


def jsd(dists):
    """Jensen-Shannon divergence (bits) of several distributions, equal weights: 0 when every agent does the same mix."""
    dists = [d for d in dists if sum(d.values())]
    if len(dists) < 2:
        return None
    ps = [{k: v / sum(d.values()) for k, v in d.items()} for d in dists]
    keys = set().union(*ps)
    mix = {k: sum(p.get(k, 0) for p in ps) / len(ps) for k in keys}
    return entropy(mix) - sum(entropy(p) for p in ps) / len(ps)


def parse_runlog(path):
    r = {"village": None, "agents": [], "start": None, "end": None, "after_at": None, "complete_at": None, "stopped": None,
         "events": [], "busy": {}, "after_busy": {}, "stats": {}, "stock": [], "tasks": [], "crit": [], "final_storage": None}
    last_main = 0.0
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.rstrip("\r\n")
        if line.startswith("RUN "):
            kv = dict(re.findall(r"(\w+)=(\S+)", line))
            r["village"] = r["village"] or kv.get("village")
            if kv.get("agents"):
                r["agents"] = kv["agents"].split(",")
            if kv.get("start"):
                r["start"] = int(kv["start"]) / 1000
            if kv.get("end"):
                r["end"] = int(kv["end"]) / 1000
            continue
        m = re.match(r"^(?:\s*\d+\.\dm )?COMPLETE(?: at (\d+\.\d)m)?", line.strip())
        if m:
            # ("COMPLETE at" from the scripts since S.0; watch_village's older "COMPLETE; watching" line only has its stamp)
            if m.group(1):
                r["complete_at"] = float(m.group(1))
            elif r["complete_at"] is None:
                st = re.match(r"^\s*(\d+\.\d)m", line)
                r["complete_at"] = float(st.group(1)) if st else last_main
            continue
        m = re.match(r"^AFTER start at (\d+\.\d)m", line)
        if m:
            r["after_at"] = float(m.group(1))
            continue
        m = EVENT.match(line)
        if m:
            last_main = float(m.group(1))
            r["events"].append({"t": last_main, "agent": m.group(2), "ok": m.group(3) == "action_done", "text": m.group(4), "after": False})
            continue
        m = re.match(r"^\s*(\d+\.\d)m ", line)
        if m:
            last_main = float(m.group(1))
        m = AFTER_EVENT.match(line)
        if m:
            r["events"].append({"t": float(m.group(1)), "agent": m.group(2), "ok": m.group(3) == "action_done", "text": m.group(4), "after": True})
            continue
        m = re.match(r"^BUSY (\S+): (.*)$", line)
        if m and m.group(1) != "all":
            parts = dict((k, (float(b), float(s))) for k, b, s in re.findall(r"(before completion|after|whole run) (\d+\.\d) of (\d+\.\d)", m.group(2)))
            r["busy"][m.group(1)] = parts
            continue
        m = re.match(r"^AFTER busy: (.*) of (\d+\.\d) min", line)
        if m:
            span = float(m.group(2))
            r["after_busy"] = {n: (float(b), span) for n, b in re.findall(r"(\S+) (\d+\.\d)(?:,|$)", m.group(1))}
            continue
        m = re.match(r"^STOCK\s+(\d+\.\d)m (\{.*\})$", line)
        if m:
            r["stock"].append((float(m.group(1)), json.loads(m.group(2))))
            continue
        m = re.match(r"^STATS (\S+): (.*)$", line)
        if m:
            st = {"refused": int((re.search(r"refused (\d+)", m.group(2)) or [0, 0])[1]),
                  "done": int((re.search(r"done (\d+)", m.group(2)) or [0, 0])[1]),
                  "failed": int((re.search(r"failed (\d+)", m.group(2)) or [0, 0])[1])}
            res = re.search(r"rescues (\{.*?\})", m.group(2))
            st["rescues"] = json.loads(res.group(1)) if res else None
            r["stats"][m.group(1)] = st
            continue
        m = re.match(r"^STOPPED after (\d+\.\d)m", line.strip())
        if m:
            r["stopped"] = float(m.group(1))
            continue
        m = re.match(r"^STORAGE (\{.*\})$", line)
        if m:
            try:
                r["final_storage"] = json.loads(m.group(1).replace("'", '"'))
            except ValueError:
                pass
            continue
        m = re.match(r"^  (t\d+) \[(\w+)(?:/(\S+?))?\] (.*?): ", line)
        if m:
            r["tasks"].append({"id": m.group(1), "status": m.group(2), "by": m.group(3), "title": m.group(4)})
            continue
        if line.startswith("CRIT"):
            r["crit"].append(line)
    # AFTER lines count from the after phase's start (the COMPLETE line's time in watch_village's older logs)
    off = r["after_at"] if r["after_at"] is not None else (r["complete_at"] if r["complete_at"] is not None else last_main)
    for e in r["events"]:
        if e["after"]:
            e["t"] += off
    if not r["agents"]:
        r["agents"] = sorted({e["agent"] for e in r["events"]} | set(r["stats"]), key=lambda n: (re.sub(r"\d+$", "", n), int(re.search(r"\d*$", n).group() or 0)))
    return r


def parse_choices(path, village, start, end):
    """The decision log's choices, each with its outcome (None: abandoned, no end recorded, cut short or ended after the
    run); ids repeat after an agent server restart, so a choice is paired with the end that follows it."""
    recs, rescues = [], {}
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        kind = None
        if line.startswith("{"):
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            kind = "end" if rec.get("type") == "choice-end" or ("outcome" in rec and "agent" not in rec) or ("ok" in rec and "agent" not in rec) else "choice"
        else:
            m = re.search(r"\[(choice|choice-end)\] (\{.*\})$", line)
            if m:
                try:
                    rec = json.loads(m.group(2))
                except ValueError:
                    continue
                kind = "end" if m.group(1) == "choice-end" else "choice"
            else:
                m = re.search(r"\[rescue\] (\S+) stuck at \S+: ([^:]+):", line)
                if m:
                    rescues.setdefault(m.group(1), []).append(m.group(2).strip())
                continue
        recs.append((kind, rec))
    open_, out = {}, []
    for kind, rec in recs:
        if kind == "choice":
            if rec.get("id") in open_:
                out.append(open_.pop(rec["id"]))
            c = dict(rec, outcome=None)
            open_[rec.get("id")] = c
        else:
            c = open_.pop(rec.get("id"), None)
            if c is not None:
                o = rec.get("outcome") if isinstance(rec.get("outcome"), dict) else rec
                c["outcome"] = {"ok": bool(o.get("ok")), "message": o.get("message", ""), "minutes": o.get("minutes"),
                                "tEnd": o.get("tEnd"), "cut": bool(o.get("cut")), "yield": o.get("yield")}
                out.append(c)
    out += open_.values()
    keep = []
    for c in out:
        if village and c.get("village") and c["village"].lower() != village.lower():
            continue
        t = (c.get("t") or 0) / 1000
        if start and t and t < start - 5:
            continue
        if end and t and t > end + 5:
            continue
        # Cut short (its agent stopped or removed) or ended after the run did (the watch scripts leave their agents in the
        # world): abandoned, not done or failed; the end is kept as `cut_outcome`
        o = c["outcome"]
        if o and ((not o["ok"] and o["cut"]) or (end and o["tEnd"] and o["tEnd"] / 1000 > end + 5)):
            c["cut_outcome"], c["outcome"] = o, None
        keep.append(c)
    return sorted(keep, key=lambda c: c.get("t") or 0), rescues


class Prices:
    """Raw units per item from an agent server's bill of materials (mcMaterials: 64 of the item planned, the gathered raw
    items counted and divided by 64, so batch rounding does not show); 1 where no server answers or the item is unplannable."""

    def __init__(self, api):
        self.api, self.cache, self.fallback = None, {}, False
        for url in [api, os.environ.get("MCAI_API"), "http://127.0.0.1:8767/api", "http://127.0.0.1:8766/api"]:
            if not url:
                continue
            try:
                with urllib.request.urlopen(url.rstrip("/") + "/materials?items=cobblestone:1", timeout=3) as r:
                    if "gather" in json.loads(r.read()):
                        self.api = url.rstrip("/")
                        break
            except Exception:
                continue

    def __call__(self, item):
        if item not in self.cache:
            p = None
            if self.api:
                try:
                    with urllib.request.urlopen(f"{self.api}/materials?items={item}:64", timeout=5) as r:
                        plan = json.loads(r.read())
                    if not plan.get("problems"):
                        p = sum(plan.get("gather", {}).values()) / 64
                except Exception:
                    pass
            if p is None:
                self.fallback = True
            self.cache[item] = 1.0 if p is None else p
        return self.cache[item]


def main():
    ap = argparse.ArgumentParser(description="Autonomy metrics of a village run (A.1)")
    ap.add_argument("runlog")
    ap.add_argument("choices", nargs="?")
    ap.add_argument("--village")
    ap.add_argument("--api")
    ap.add_argument("--every", type=float, default=5)
    ap.add_argument("--json")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    run = parse_runlog(a.runlog)
    village = a.village or run["village"]
    agents = run["agents"]
    total = run["stopped"] or max([e["t"] for e in run["events"]] + [0.0])
    after_at = run["after_at"] if run["after_at"] is not None else run["complete_at"]
    done_at = f", complete at {run['complete_at']:.1f}m" if run["complete_at"] is not None else ", not complete"
    print(f"RUN {a.runlog}: village {village or '?'}, agents {', '.join(agents)}, {total:.1f} min{done_at}")
    result = {"village": village, "agents": {}, "minutes": total, "complete_at": run["complete_at"]}

    # Activities: every finished or failed action, whole run and after completion
    acts = {n: [] for n in agents}
    for e in run["events"]:
        skill, target = activity_of(e["text"])
        if skill and e["agent"] in acts:
            acts[e["agent"]].append((e["t"], skill, target, e["ok"], e["after"]))
    for phase, keep in (("whole run", lambda x: True), ("after completion", lambda x: x[4])):
        hist = {n: {} for n in agents}
        for n in agents:
            for x in acts[n]:
                if keep(x):
                    hist[n][x[1]] = hist[n].get(x[1], 0) + 1
        kinds = set().union(*[h.keys() for h in hist.values()]) if hist else set()
        if not any(hist.values()):
            continue
        print(f"\nACTIVITY ({phase}; {len(kinds)} kinds in the village; specialisation = 1 - entropy / log2(kinds))")
        for n in agents:
            h = hist[n]
            if not h:
                print(f"  {n:8} no actions")
                continue
            H = entropy(h)
            spec = 1 - H / math.log2(len(kinds)) if len(kinds) > 1 else None
            top = max(h, key=h.get)
            print(f"  {n:8} {sum(h.values()):3} actions (done or failed), entropy {H:.2f} bits, specialisation {'n/a' if spec is None else f'{spec:.2f}'}, "
                  f"top {top} {100 * h[top] / sum(h.values()):.0f}%: " + ", ".join(f"{k} {v}" for k, v in sorted(h.items(), key=lambda kv: -kv[1])))
            result["agents"].setdefault(n, {})[phase] = {"actions": sum(h.values()), "entropy": round(H, 3), "specialisation": None if spec is None else round(spec, 3), "hist": h}
        d = jsd(list(hist.values()))
        print(f"  agents' mixes apart (Jensen-Shannon): {'n/a' if d is None else f'{d:.2f} bits'}")
        result.setdefault("jsd", {})[phase] = d

    # Unique (activity, target) pairs among the finished actions, cumulative over the village
    pairs, curve, firsts = set(), [], []
    for t, n, skill, target in sorted((x[0], n, x[1], x[2]) for n in agents for x in acts[n] if x[3]):
        if (skill, target) not in pairs:
            pairs.add((skill, target))
            firsts.append((t, n))
    step = max(0.5, a.every)
    k = 0.0
    while k <= total + 1e-9:
        curve.append((k, sum(1 for t, _ in firsts if t <= k)))
        k += step
    if curve[-1][0] < total - 1e-9:
        curve.append((round(total, 1), len(firsts)))
    print(f"\nPAIRS unique (activity, target) among finished actions: {len(pairs)}; cumulative every {step:g} min: "
          + ", ".join(f"{k:g}m {c}" for k, c in curve))
    for n in agents:
        own = {(x[1], x[2]) for x in acts[n] if x[3]}
        new = sum(1 for _, who in firsts if who == n)
        late = {(x[1], x[2]) for x in acts[n] if x[3] and x[4]}
        print(f"  {n:8} {len(own)} pairs, {new} first in the village, {len(late)} after completion")
        result["agents"].setdefault(n, {})["pairs"] = {"own": len(own), "first": new, "after": len(late)}
    result["pairs"] = {"total": len(pairs), "curve": curve}

    # The storage's value over time
    stock = list(run["stock"])
    if stock and run["final_storage"] is not None and stock[-1][1] != run["final_storage"]:
        stock.append((total, run["final_storage"]))
    if not stock and run["final_storage"] is not None:
        price = Prices(a.api)
        print(f"\nVALUE: no STOCK lines in the run log; the storage at the end is worth "
              f"{sum(q * price(i) for i, q in run['final_storage'].items()):.0f} raw units")
    elif stock:
        price = Prices(a.api)
        vals = [(t, sum(q * price(i) for i, q in s.items())) for t, s in stock]
        print(f"\nVALUE of the storage in raw units ({'priced by ' + price.api if price.api else 'no agent server: every item 1'}"
              f"{'; some items unpriced, counted 1' if price.fallback and price.api else ''}): "
              + ", ".join(f"{k:g}m {next((v for t, v in reversed(vals) if t <= k), 0):.0f}" for k, _ in curve) + f", end {vals[-1][1]:.0f}")
        peak, peak_t, dds, cur = vals[0][1], vals[0][0], [], None
        for t, v in vals:
            if v >= peak:
                if cur:
                    dds.append(cur)
                    cur = None
                peak, peak_t = v, t
            elif peak > 0 and (peak - v) / peak >= 0.05:
                if not cur or v < cur[3]:
                    cur = (peak_t, peak, t, v)
        if cur:
            dds.append(cur)
        worst = max(dds, key=lambda d: d[1] - d[3]) if dds else None
        print(f"  drawdowns of 5% or more: {len(dds)}" + (f"; the largest {worst[1]:.0f} at {worst[0]:.1f}m to {worst[3]:.0f} at {worst[2]:.1f}m "
                                                          f"(-{100 * (worst[1] - worst[3]) / worst[1]:.0f}%)" if worst else ""))
        for d in dds[:8]:
            print(f"    {d[0]:5.1f}m {d[1]:.0f} -> {d[2]:5.1f}m {d[3]:.0f}")
        result["value"] = {"curve": vals, "drawdowns": dds}
    else:
        print("\nVALUE: no STOCK lines in the run log")

    # The goal ledger: the decision log's choices and their outcomes
    rescues_log = {}
    if a.choices:
        choices, rescues_log = parse_choices(a.choices, village, run["start"], run["end"])
        done = [c for c in choices if c["outcome"] and c["outcome"]["ok"]]
        failed = [c for c in choices if c["outcome"] and not c["outcome"]["ok"]]
        left = [c for c in choices if not c["outcome"]]
        opts = [len(c.get("options") or []) for c in choices]
        print(f"\nGOALS (the decision log, {len(choices)} choices): done {len(done)}, failed {len(failed)}, abandoned {len(left)}"
              f"{f'; {sum(opts) / len(opts):.1f} options a choice' if opts else ''}")
        by_kind = {}
        for c in choices:
            k = by_kind.setdefault(c.get("kind") or "?", {"chosen": 0, "done": 0, "failed": 0, "abandoned": 0, "min": [], "gained": 0, "solo": 0})
            k["chosen"] += 1
            o = c["outcome"]
            k["done" if o and o["ok"] else "failed" if o else "abandoned"] += 1
            if o and isinstance(o.get("minutes"), (int, float)):
                k["min"].append(o["minutes"])
            # The yield of a finished chore: items gained in storage or in the agent's hands while it ran (a chore that
            # overlapped none of the village's others has the storage change to itself)
            y = (o or {}).get("yield")
            if o and o["ok"] and isinstance(y, dict):
                k["gained"] += sum(q for part in (y.get("storage") or {}, y.get("carried") or {}) for q in part.values() if q > 0)
                k["solo"] += 0 if y.get("with") else 1
        for kind, k in sorted(by_kind.items(), key=lambda kv: -kv[1]["chosen"]):
            each = f", {sum(k['min']) / len(k['min']):.1f} min each" if k["min"] else ""
            gained = f", {k['gained']} items gained by the done ones ({k['solo']} overlapping no other chore)" if k["done"] else ""
            print(f"  {kind:16} chosen {k['chosen']:3}, done {k['done']:3}, failed {k['failed']:3}, abandoned {k['abandoned']:3}{each}{gained}")
        for n in agents:
            mine = [c for c in choices if c.get("agent") == n]
            if mine:
                print(f"  {n:8} chose {len(mine)}: done {sum(1 for c in mine if c['outcome'] and c['outcome']['ok'])}, "
                      f"failed {sum(1 for c in mine if c['outcome'] and not c['outcome']['ok'])}, abandoned {sum(1 for c in mine if not c['outcome'])}; "
                      f"kinds {', '.join(sorted({c.get('kind') or '?' for c in mine}))}")
        result["goals"] = {k: {kk: vv for kk, vv in v.items() if kk != "min"} for k, v in by_kind.items()}
        result["choices"] = [{"id": c.get("id"), "agent": c.get("agent"), "kind": c.get("kind"), "t": c.get("t"),
                              "outcome": c["outcome"], "cut": c.get("cut_outcome")} for c in choices]
        if not choices:
            print("  (no [choice] records for this village in the run's time)")

    # The board's ledger (the run log's final task list)
    if run["tasks"]:
        st = {}
        for t in run["tasks"]:
            st[t["status"]] = st.get(t["status"], 0) + 1
        print(f"\nBOARD {len(run['tasks'])} tasks: " + ", ".join(f"{k} {v}" for k, v in sorted(st.items())))
        for n in agents:
            mine = [t for t in run["tasks"] if t["by"] == n]
            if mine:
                print(f"  {n:8} " + ", ".join(f"{k} {sum(1 for t in mine if t['status'] == k)}" for k in ("done", "failed", "claimed", "open") if any(t["status"] == k for t in mine)))
    if run["crit"]:
        print()
        for line in run["crit"]:
            print(line)

    # Busy and idle minutes, refused repeats and interventions per agent-hour
    print("\nPER AGENT (busy and idle from the BUSY lines, else the AFTER busy line; per agent-hour of the whole run)")
    for n in agents:
        b = run["busy"].get(n)
        if b and "whole run" in b:
            busy, span = b["whole run"]
            idle_txt = (f"busy {busy:.1f} of {span:.1f} min, idle {span - busy:.1f} (before completion {b['before completion'][1] - b['before completion'][0]:.1f}, "
                        f"after {b['after'][1] - b['after'][0]:.1f})" if "before completion" in b and "after" in b else f"busy {busy:.1f} of {span:.1f} min")
        elif n in run["after_busy"]:
            busy, span = run["after_busy"][n]
            idle_txt = f"after completion busy {busy:.1f} of {span:.1f} min, idle {span - busy:.1f}"
            span = total
        else:
            busy, span, idle_txt = None, total, "no busy samples"
        hours = max(span, 1e-6) / 60
        st = run["stats"].get(n) or {}
        resc = st.get("rescues")
        n_resc = sum(int(v) for k, v in resc.items() if k != "last" and str(v).isdigit()) if resc else len(rescues_log.get(n, []))
        tele_resc = sum(int(v) for k, v in resc.items() if k != "last" and "teleport" in k.lower() and str(v).isdigit()) if resc else \
            sum(1 for h in rescues_log.get(n, []) if "teleport" in h.lower())
        tele = sum(1 for e in run["events"] if e["agent"] == n and re.search(r"teleport", e["text"], re.I))
        refused = st.get("refused", 0)
        print(f"  {n:8} {idle_txt}; refused repeats {refused} ({refused / hours:.1f}/h); interventions {n_resc + tele} "
              f"({(n_resc + tele) / hours:.1f}/h: {n_resc} rescues, {tele_resc} of them teleports, {tele} teleports in action results)")
        result["agents"].setdefault(n, {}).update({"busy": busy, "span": span, "refused": refused, "rescues": n_resc, "teleports": tele + tele_resc})
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=1)
        print(f"\nwritten {a.json}")


if __name__ == "__main__":
    main()
