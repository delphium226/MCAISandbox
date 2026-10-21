"""The thriving scorecard (#80, M1 of docs/STRATEGY.md): one measure of a village over hours, computed the same way for a
simulator run and a live run, in 10-minute and 1-hour bins, each measure's trend, and the pass mark.

Usage: python scripts/scorecard.py RUN [RUN ...] [--json OUT]
  RUN  a simulator output folder (village_sim.mts --out: sim.report.json, sim.choices.jsonl, sim.score.jsonl,
       sim.events.log), or a live run as run_series.py writes it: DIR/NAME or DIR/NAME.log (NAME.choices.jsonl beside it,
       the agent server's log through reset_NAME.log, NAME.score.jsonl if /api/scorecard was sampled).
  --json OUT  also write every run's bins and verdict.
With several runs it ends with one line a run (seeds side by side): verdict, collapse minute, the hours below half, busy
in hour 1, hour 2 and the last hour, and needs met in hour 1 and the last hour.

Measures (a live run lacks some; the scorecard says which and never fills them in):
  busy %        an action running, as run_report.py's busy row (the sim's busy bins; live: the stage log's "BUSY after by
                10 min" line, which a run stopped before its end lacks)
  chore busy %  chore minutes from the choice log over member-minutes (sim_report.mts's busy; the same code for both)
  members, houses (residents once #4 keeps them)
  needs met     the mean of the welfare gauges' shares met: food (members fed), housing (members housed), light (spots
                lit), furnish (decor spots filled); sim: sampled every 10 minutes; live: the [need] lines' levels (only
                with MC_NEEDS=show or on, and only at a status change)
  goods/member  storage items per member, and kinds in storage; with own chests (MC_OWN) where sampled
  techniques    inventions unlocked (the [innovate] lines); recipes: goods the village has made (sampled only)
  works         structures built since the start (sampled; live: builds' "recorded in village" ends), public works built
                (initiatives), roads (street cells, sampled only)
  trades        barter offers taken (sampled, the board's count; live: the [barter] "took" lines) and merchant trades (the
                [merchant] sells and buys lines, both kinds of run)
The pass mark (STRATEGY.md, revised 10-21): no collapse in a 6-hour run, a collapse being any hour after the first whose
busy falls below half of hour 1's (needs met shown, not judged). Collapse minute: the start of the first 30-minute window
after hour 1 under that half. A run under 2 hours gets no verdict. Trends: the last hour against hour 1.
"""
import json, os, re, sys

BIN = 10  # minutes


def read(path):
    return open(path, encoding="utf-8", errors="replace").read() if path and os.path.exists(path) else ""


def jsonl(path):
    out = []
    for line in read(path).splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def chore_busy_bins(rows, members, minutes, t0=None):
    """Chore minutes per 10-minute bin over member-minutes, in % (sim_report.mts's busy): each chore from its choice record's
    t to its end record's tEnd (else t + minutes), clipped to the bins. t0: the run's start (default the first choice)."""
    starts = {r["id"]: r for r in rows if r.get("type") == "choice"}
    if not starts or members < 1:
        return []
    t0 = min(r["t"] for r in starts.values()) if t0 is None else t0
    n = max(1, -(-int(minutes) // BIN))
    busy = [0.0] * n
    end_all = t0 + n * BIN * 60000
    for e in rows:
        if e.get("type") != "choice-end" or e.get("id") not in starts:
            continue
        s = starts[e["id"]]
        a = s["t"]
        b = min(e.get("tEnd") or s["t"] + (e.get("minutes") or 0) * 60000, end_all)
        while a < b:
            k = int((a - t0) // (BIN * 60000))
            edge = min(b, t0 + (k + 1) * BIN * 60000)
            if 0 <= k < n:
                busy[k] += edge - a
            a = edge
    return [round(100 * x / (members * BIN * 60000), 1) for x in busy]


def stamped_lines(text, t0):
    """(minute, line) for an agent server's log, each line at the time of the last [choice] record before it (the log has
    no times, as sim_report.mts reads it)."""
    t, out = t0, []
    for line in text.splitlines():
        m = re.match(r'^\[choice(?:-end)?\] (\{.*)$', line)
        if m:
            tt = re.search(r'"t(?:End)?":(\d{13})', m.group(1))
            if tt:
                t = int(tt.group(1))
            continue
        if t is not None and t >= t0:
            out.append(((t - t0) / 60000, line))
    return out


def sim_event_lines(text):
    out = []
    for line in text.splitlines():
        m = re.match(r'^\+(\d+(?:\.\d+)?)m (.*)$', line)
        if m:
            out.append((float(m.group(1)), m.group(2)))
    return out


# (what both kinds of run log the same way)
TRADE_BARTER = re.compile(r'^\[barter\] [^:]+: \S+ took \S+ offer ')
TRADE_MERCHANT = re.compile(r'^\[merchant\] [^:]+: \S+ (sells|buys) \d+ \S+ for \d+ emerald')
UNLOCK = re.compile(r'^\[innovate\] .*; unlocked: ')
NEED = re.compile(r'^\[need\] [^:]+: (\w+) \S+ -> [a-z ]+ \(level ([\d.]+)')
WELFARE = ("food", "housing", "light", "furnish")


def events_to_counts(lines, n):
    """Per-bin counts of trades and unlocks, and the welfare needs' met shares at each bin's end from [need] lines."""
    barter, merchant, unlock = [0] * n, [0] * n, [0] * n
    levels = {}
    need_bins = {k: [None] * n for k in WELFARE}
    changes = sorted((m, l) for m, l in lines if l.startswith("[need]"))
    for minute, line in lines:
        k = int(minute // BIN)
        if not 0 <= k < n:
            continue
        if TRADE_BARTER.match(line):
            barter[k] += 1
        elif TRADE_MERCHANT.match(line):
            merchant[k] += 1
        elif UNLOCK.match(line):
            unlock[k] += 1
    i = 0
    for k in range(n):
        while i < len(changes) and changes[i][0] < (k + 1) * BIN:
            m = NEED.match(changes[i][1])
            if m and m.group(1) in WELFARE:
                levels[m.group(1)] = 1 - float(m.group(2))
            i += 1
        for kind in WELFARE:
            need_bins[kind][k] = levels.get(kind)
    return barter, merchant, unlock, need_bins if any(any(x is not None for x in v) for v in need_bins.values()) else None


def at_bin_ends(samples, n, f):
    """A sampled measure at each bin's end: the last sample at or before it (None before the first)."""
    out, i, last = [], 0, None
    for k in range(n):
        while i < len(samples) and samples[i]["minute"] <= (k + 1) * BIN + 0.5:
            last = f(samples[i])
            i += 1
        out.append(last)
    return out


def increments(cum, start=0):
    out, prev = [], start
    for x in cum:
        if x is None:
            out.append(None)
            continue
        out.append(x - prev)
        prev = x
    return out


def from_samples(card, samples, n):
    """The sampled measures (simulator, or a live run's NAME.score.jsonl)."""
    s0 = samples[0]
    card["members"] = at_bin_ends(samples, n, lambda s: s["members"])
    card["houses"] = at_bin_ends(samples, n, lambda s: s["houses"])
    if any("residents" in s for s in samples):
        card["residents"] = at_bin_ends(samples, n, lambda s: s.get("residents"))
    card["needs met"] = at_bin_ends(samples, n, lambda s: s["needsMet"])
    for k in WELFARE:
        if any(k in s["needs"] for s in samples):
            card[f"  {k}"] = at_bin_ends(samples, n, lambda s, k=k: s["needs"].get(k))
    card["goods/member (storage)"] = at_bin_ends(samples, n, lambda s: round(s["store"]["items"] / max(1, s["members"]), 1))
    card["kinds in storage"] = at_bin_ends(samples, n, lambda s: s["store"]["kinds"])
    if any(s["own"]["chests"] for s in samples):
        card["goods/member (with own)"] = at_bin_ends(samples, n, lambda s: round((s["store"]["items"] + s["own"]["items"]) / max(1, s["members"]), 1))
        card["kinds held anywhere"] = at_bin_ends(samples, n, lambda s: s["kinds"])
    card["recipes made"] = at_bin_ends(samples, n, lambda s: s["recipes"])
    card["+techniques"] = increments(at_bin_ends(samples, n, lambda s: s["techniques"]), s0["techniques"])
    card["+works"] = increments(at_bin_ends(samples, n, lambda s: s["structures"]), s0["structures"])
    card["+public works"] = increments(at_bin_ends(samples, n, lambda s: s["publicWorks"]), s0["publicWorks"])
    card["roads (cells)"] = at_bin_ends(samples, n, lambda s: s["roads"])
    card["+trades (barter)"] = increments(at_bin_ends(samples, n, lambda s: s["trades"]["barter"]), s0["trades"]["barter"])


def load_sim(d):
    rep = json.loads(read(os.path.join(d, "sim.report.json")) or "{}")
    samples = jsonl(os.path.join(d, "sim.score.jsonl"))
    rows = jsonl(os.path.join(d, "sim.choices.jsonl"))
    minutes = rep.get("minutes") or (samples[-1]["minute"] if samples else 0)
    members = rep.get("members") or 25
    n = max(1, -(-int(minutes) // BIN))
    card, missing = {}, []
    card["busy %"] = list(rep.get("busyBins") or [])[:n] or [None] * n
    t0 = samples[0]["t"] if samples else None
    card["chore busy %"] = chore_busy_bins(rows, members, minutes, t0) or [None] * n
    if samples:
        from_samples(card, samples, n)
    else:
        missing.append("every sampled measure (no sim.score.jsonl: a run before #80)")
    lines = sim_event_lines(read(os.path.join(d, "sim.events.log")))
    barter, merchant, unlock, _ = events_to_counts(lines, n)
    # (the simulator's trade model does not log the live "took" line: its barter trades are the board's sampled count)
    if not samples:
        card["+trades (barter)"] = barter
    card["+trades (merchant)"] = merchant
    if not samples:
        card["+techniques"] = unlock
    about = f"sim, {minutes} min, {members} members, {rep.get('checkpoint', '?')}, seed {rep.get('seed', '?')}, random ticks {rep.get('randomTick', '?')}"
    return {"name": os.path.basename(os.path.normpath(d)), "kind": "sim", "about": about, "minutes": minutes, "n": n, "card": card, "missing": missing}


def agent_log_of(log):
    reset = os.path.join(os.path.dirname(log), "reset_" + os.path.basename(log))
    m = re.search(r"log (\S*testagents-\S+\.log)", read(reset))
    if not m:
        return None
    p = m.group(1)
    if not os.path.isabs(p):
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), p)
    return p if os.path.exists(p) else None


def load_live(arg):
    log = arg if arg.endswith(".log") else arg + ".log"
    base = log[:-len(".log")]
    t = read(log)
    rows = jsonl(base + ".choices.jsonl")
    if not t and not rows:
        raise SystemExit(f"{arg}: no run log or choice log")
    starts = [r for r in rows if r.get("type") == "choice"]
    t0 = min(r["t"] for r in starts) if starts else None
    stopped = re.search(r"^STOPPED after ([\d.]+)m", t, re.M)
    last_after = [float(x) for x in re.findall(r"^(?:AFTER|STOCK) +([\d.]+)m", t, re.M)]
    minutes = float(stopped.group(1)) if stopped else (max(last_after) if last_after else ((max(r["t"] for r in starts) - t0) / 60000 if starts else 0))
    # (the after phase is what the scorecard follows: a run resumed from a checkpoint is all after phase)
    n = max(1, -(-int(minutes) // BIN))
    members = len({r.get("agent") for r in starts}) or 25
    card, missing = {}, []
    bm = re.search(r"^BUSY after by 10 min: (.*)$", t, re.M)
    if bm:
        vals = {int(a): float(b) for a, b in re.findall(r"(\d+)-\d+ (\d+)%", bm.group(1))}
        card["busy %"] = [vals.get(k * BIN) for k in range(n)]
    else:
        card["busy %"] = [None] * n
        missing.append("busy % (no 'BUSY after by 10 min' line: the run was stopped before its end; the verdict uses chore busy)")
    card["chore busy %"] = chore_busy_bins(rows, members, minutes, t0) or [None] * n
    samples = jsonl(base + ".score.jsonl")
    if samples:
        for s in samples:
            s.setdefault("minute", (s["t"] - samples[0]["t"]) / 60000)
        from_samples(card, samples, n)
    else:
        card["members"] = [members] * n
        houses, last = [None] * n, None
        grow = [(float(m), int(h)) for m, h in re.findall(r"^AFTER +([\d.]+)m GROW .*?; houses (\d+) for \d+ members", t, re.M)]
        for k in range(n):
            for m, h in grow:
                if m < (k + 1) * BIN:
                    last = h
            houses[k] = last
        card["houses"] = houses
        stock = [(float(m), json.loads(j)) for m, j in re.findall(r"^STOCK +([\d.]+)m (\{.*\})\s*$", t, re.M)]
        if stock:
            gm, kinds = [None] * n, [None] * n
            i, last = 0, None
            for k in range(n):
                while i < len(stock) and stock[i][0] < (k + 1) * BIN:
                    last = stock[i][1]
                    i += 1
                if last is not None:
                    gm[k] = round(sum(q for q in last.values() if q > 0) / members, 1)
                    kinds[k] = sum(1 for q in last.values() if q > 0)
            card["goods/member (storage)"], card["kinds in storage"] = gm, kinds
        else:
            missing.append("goods (no STOCK lines)")
        builds = [float(m) for m in re.findall(r"^AFTER +([\d.]+)m \S+ +action_done +\| build_design finished: \S+ recorded in village", t, re.M)]
        card["+works"] = [sum(1 for m in builds if k * BIN <= m < (k + 1) * BIN) for k in range(n)]
        missing += ["goods in own chests, recipes made, roads (sampled only: no NAME.score.jsonl)",
                    "members as sampled (taken as the choice log's members throughout)"]
    alog = agent_log_of(log)
    lines = stamped_lines(read(alog), t0) if alog and t0 else []
    if lines:
        barter, merchant, unlock, needs = events_to_counts(lines, n)
        if not samples:
            card["+trades (barter)"] = barter
        card["+trades (merchant)"] = merchant
        if not samples:
            card["+techniques"] = unlock
            if needs:
                kept = [k for k in WELFARE if any(x is not None for x in needs[k])]
                card["needs met"] = [round(sum(needs[k][b] for k in kept if needs[k][b] is not None) / max(1, sum(1 for k in kept if needs[k][b] is not None)), 3)
                                     if any(needs[k][b] is not None for k in kept) else None for b in range(n)]
                for k in kept:
                    card[f"  {k}"] = needs[k]
                missing.append("needs met between status changes (live [need] lines carry the level only when a need's status changes)")
            else:
                missing.append("needs met (no [need] lines: MC_NEEDS was off)")
            ini = [m for m, l in lines if re.search(r"^\[initiative\] .*: i\d+ built in ", l)]
            card["+public works"] = [sum(1 for m in ini if k * BIN <= m < (k + 1) * BIN) for k in range(n)]
    else:
        missing.append("trades, techniques, needs and public works (no agent server log found through reset_NAME.log)")
    about = f"live, {minutes:g} min, {members} members, {os.path.basename(base)}"
    return {"name": os.path.basename(base), "kind": "live", "about": about, "minutes": minutes, "n": n, "card": card, "missing": missing}


def load(arg):
    if os.path.isdir(arg) and os.path.exists(os.path.join(arg, "sim.report.json")):
        return load_sim(arg)
    return load_live(arg)


# ---- judging

def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def hours_of(vals, counter):
    """1-hour bins: a counter's sum, a level's mean; a partial last hour counts if it has at least half its bins."""
    out = []
    for h in range(0, len(vals), 6):
        part = vals[h:h + 6]
        if len(part) < 3:
            break
        known = [x for x in part if x is not None]
        out.append(None if not known else (sum(known) if counter else sum(known) / len(known)))
    return out


def verdict(run):
    """The pass mark (STRATEGY.md, the user's of 10-21): a collapse is any hour after the first whose busy falls below half of
    hour 1's. Hours are whole 6-bin hours (a last hour of at least 3 bins counts); the collapse minute is the start of the
    first 30-minute window after hour 1 whose mean is below that half. Needs met is shown, not judged."""
    card, n = run["card"], run["n"]
    out = {"verdict": "NO VERDICT", "why": [], "collapse": None, "failed hours": []}
    if run["minutes"] < 120:
        out["why"].append(f"{run['minutes']:g} min: the pass mark needs at least 2 hours (6 for STRATEGY.md's)")
        return out
    key = "busy %" if any(x is not None for x in card.get("busy %", [])) else "chore busy %"
    vals = card.get(key) or []
    hours = hours_of(vals, False)
    if len(hours) < 2 or hours[0] is None:
        out["why"].append(f"{key}: hour 1 or a later hour not measured")
        return out
    half = hours[0] / 2
    out["failed hours"] = [h + 1 for h in range(1, len(hours)) if hours[h] is not None and hours[h] < half]
    for k in range(6, n):
        m = mean(vals[k:k + 3])
        if m is not None and m < half:
            out["collapse"] = k * BIN
            break
    later = " / ".join(fmt(round(x, 2)) if x is not None else "-" for x in hours[1:])
    out["why"].append(f"{key}: hour 1 {hours[0]:.3g} (half {half:.3g}); later hours {later}"
                      + (f"; below half in hour {', '.join(map(str, out['failed hours']))}" if out["failed hours"] else "; none below half")
                      + (f"; the 30-minute mean first below half at minute {out['collapse']}" if out["collapse"] is not None else ""))
    worst = min((x for x in hours[1:] if x is not None), default=None)
    if worst is not None and hours[0]:
        out["why"].append(f"worst later hour {worst / hours[0]:.2f}x hour 1")
    out["verdict"] = "FAIL" if out["failed hours"] else "PASS"
    if run["minutes"] < 360:
        out["why"].append(f"(a {run['minutes']:g}-minute run: STRATEGY.md's pass mark is for 6 hours)")
    return out


def trend(hours, counter):
    xs = [x for x in hours if x is not None]
    if len(xs) < 3:
        return "-"
    h1, last = hours[0], hours[-1]
    if h1 is None or last is None:
        return "-"
    if h1 == 0:
        return "none" if last == 0 else "rising"
    r = last / h1
    word = "collapsed" if r < 0.5 else "falling" if r < 0.9 else "rising" if r > 1.1 else "flat"
    return f"{word} ({r:.2f}x hour 1{' rate' if counter else ''})"


def fmt(x):
    if x is None:
        return "-"
    if isinstance(x, float):
        return f"{x:.2f}" if abs(x) < 10 and x != int(x) else f"{x:.1f}" if x != int(x) else f"{int(x)}"
    return str(x)


TEN_MIN = ("busy %", "chore busy %", "needs met", "goods/member (storage)", "+works", "+trades (barter)", "+trades (merchant)", "+techniques")


def show(run):
    card, n = run["card"], run["n"]
    print(f"\nSCORECARD {run['name']} ({run['about']})")
    cols = [k for k in TEN_MIN if k in card]
    heads = {"busy %": "busy", "chore busy %": "chore", "needs met": "needs", "goods/member (storage)": "goods/m", "+works": "+works",
             "+trades (barter)": "+barter", "+trades (merchant)": "+merch", "+techniques": "+tech"}
    print("by 10 min   " + "".join(f"{heads[k]:>9}" for k in cols))
    for b in range(n):
        print(f"  {b * BIN:>3}-{b * BIN + BIN:<4}  " + "".join(f"{fmt(card[k][b] if b < len(card[k]) else None):>9}" for k in cols))
    hours = None
    width = max(len(k) for k in card) + 2
    rows = []
    for k, vals in card.items():
        counter = k.startswith("+")
        hs = hours_of(vals, counter)
        hours = hours or len(hs)
        rows.append((k, hs, trend(hs, counter)))
    print("by hour".ljust(width) + "".join(f"{f'{h}-{h + 1}h':>9}" for h in range(hours or 0)) + "  trend (last hour vs hour 1)")
    for k, hs, tr in rows:
        print(k.ljust(width) + "".join(f"{fmt(x):>9}" for x in hs) + f"  {tr}")
    for m in run["missing"]:
        print(f"  not in this run: {m}")
    v = run["verdict"]
    for w in v["why"]:
        print(f"  {w}")
    print(f"{v['verdict']} pass mark ({run['name']})" + (f": collapse from minute {v['collapse']}" if v["collapse"] is not None else ""))


def main():
    args = sys.argv[1:]
    out_json = None
    if "--json" in args:
        i = args.index("--json")
        out_json = args[i + 1]
        del args[i:i + 2]
    if not args:
        raise SystemExit(__doc__)
    runs = [load(a) for a in args]
    for r in runs:
        r["verdict"] = verdict(r)
        show(r)
    if len(runs) > 1:
        print("\nrun".ljust(24) + "verdict     collapse  hours below half  busy h1  busy h2  busy last  needs h1  needs last")
        for r in runs:
            c = r["card"]
            bk = "busy %" if any(x is not None for x in c.get("busy %", [])) else "chore busy %"
            b, nm = c.get(bk) or [], c.get("needs met") or []
            f = lambda xs, a, z: fmt(round(mean(xs[a:z]), 3) if mean(xs[a:z]) is not None else None)
            below = ",".join(map(str, r["verdict"].get("failed hours") or [])) or "-"
            print(f"{r['name'][:22]:<23}{r['verdict']['verdict']:<12}{fmt(r['verdict']['collapse']):<10}{below:<18}{f(b, 0, 6):<9}{f(b, 6, 12):<9}{f(b, max(12, r['n'] - 6), r['n']):<11}"
                  f"{f(nm, 0, 6):<10}{f(nm, max(12, r['n'] - 6), r['n'])}")
    if out_json:
        with open(out_json, "w", encoding="utf-8") as fh:
            json.dump(runs, fh, indent=1)


if __name__ == "__main__":
    main()
