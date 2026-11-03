"""One table of what matters in staged runs, read from their logs, side by side for comparison: so a run is judged from a
dozen numbers instead of a read through its log.

Usage: python scripts/run_report.py LOG [LOG ...]
       python scripts/run_report.py DIR/NAME [...]      (NAME.log in DIR, as run_series.py writes them)
Each LOG is a stage_village.py log. The agent server's log of the same run is found through reset_NAME.log beside it
(run_series.py and stage_runs.py write one) for the [lag], [stuck], [stuck-world], [repath] and [dig] counts.
Rows: how the run started and stopped, completion and total minutes, failed actions before and after completion, busy
shares (and chore busy by 10 minutes from NAME.choices.jsonl, as scripts/scorecard.py counts it), repeat failures of one key a member, the mine's rate, growth, food, tokens and cost, the agent server's warning lines (with #205's instinct counts and [stuck] at one 8x8 cell), and the load figures run_series.py
sampled (NAME.perf.jsonl: event loop, tick, Paper's mspt, RCON, memory). A row no run has is left out.
"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scorecard import chore_busy_bins, jsonl  # noqa: E402  (the scorecard's chore busy, #80: one code for both)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "checks"))
from rules_use import load as load_ledgers, summary as rules_summary  # noqa: E402  (#164: the council's rows)

# Widest cell; a longer value is cut (MCAI_REPORT_WIDTH to change)
W = int(os.environ.get("MCAI_REPORT_WIDTH", "44"))


def read(path):
    return open(path, encoding="utf-8", errors="replace").read() if os.path.exists(path) else ""


def first(rx, text, group=1, default=None):
    m = re.search(rx, text, re.M)
    return m.group(group) if m else default


def danger_summary(text):
    """Survival (d)'s danger count (mcCombat.ts): the last [danger] line's numbers, deaths, watches, curfew walks and grounds torches."""
    r = {}
    last = [l for l in text.splitlines() if "[danger]" in l and "hostiles" in l]
    if last:
        m = re.search(r"night peaks (\d+)/(\d+)\); out after dark (\d+) member-min \(farthest (\d+)\); deaths ([^;]*); spawns inside (\d+); defence min ([^;]*); watchers (\d+)", last[-1])
        if m:
            r["danger: night peak 48/96"] = f"{m.group(1)}/{m.group(2)}"
            r["danger: out after dark"] = f"{m.group(3)} member-min (farthest {m.group(4)})"
            r["danger: deaths by distance"] = m.group(5)
            r["danger: spawns inside"] = m.group(6)
            r["danger: defence min"] = m.group(7)
            r["danger: watchers"] = m.group(8)
    if "[death]" in text:
        r["deaths"] = str(sum(1 for l in text.splitlines() if l.startswith("[death]") or "] [death]" in l or l.find("[death] ") >= 0 and " at " in l))
    r["watches / curfew walks"] = f"{text.count(' keeps watch (')} / {text.count(': heads home')}"
    g = [int(x) for x in re.findall(r"\[light\] \S+ \S+ part=grounds:[\d,]+ placed=(\d+)", text)]
    r["grounds torches placed"] = str(sum(g))
    return r


def instinct_summary(text):
    """#205's instincts (spec 4.2, 6.4): the [instinct] lines by op, borrows by channel, the largest lineage's holders and the
    deepest copy, the night's picks, lessons learned on their own by 3 or more members (a bug candidate), and [stuck] lines
    at one 8x8 cell (the most for one member, the most for one cell)."""
    r = {}
    lines = [l for l in text.splitlines() if "[instinct] " in l]
    if lines:
        ops = {}
        for l in lines:
            m = re.search(r"\[instinct\] \S+: \S+? (\S+)", l)
            if m:
                op = m.group(1).rstrip(":")
                ops[op] = ops.get(op, 0) + 1
        r["instinct ops"] = ", ".join(f"{k} {n}" for k, n in sorted(ops.items(), key=lambda x: -x[1]))
        via = {}
        holders, depth = {}, 0
        learned_by = {}
        for l in lines:
            m = re.search(r"\] \S+: (\S+) learns (i\d+) \"([^\"]*)\"", l)
            if m:
                key = re.sub(r"-?\d+", "#", m.group(3))
                learned_by.setdefault(key, set()).add(m.group(1))
            b = re.search(r"\] \S+: (\S+) borrows i\d+ from (\S+) \((side by side|storage|dusk); (\S+) gen (\d+)", l)
            if b:
                via[b.group(3)] = via.get(b.group(3), 0) + 1
                holders.setdefault(b.group(4), {b.group(4).split(":")[0]}).add(b.group(1))
                depth = max(depth, int(b.group(5)))
        if via:
            r["instinct borrows by channel"] = ", ".join(f"{k} {n}" for k, n in via.items())
            top = max(holders.items(), key=lambda x: len(x[1]))
            r["instinct largest lineage / depth"] = f"{top[0]} {len(top[1])} members / gen {depth}"
        nights = re.findall(r"night picks c\d+ \(([a-z]+)", text)
        if nights:
            r["instinct night picks"] = ", ".join(f"{k} {nights.count(k)}" for k in sorted(set(nights))) + f"; field filled {text.count(', field filled)')}"
        bugs = [f"{len(ms)}: {k[:40]}" for k, ms in learned_by.items() if len(ms) >= 3]
        if bugs:
            r["instinct bug candidates (3+ learned)"] = "; ".join(bugs)
    cells = {}
    for m in re.finditer(r"\[stuck\] (\S+) (?:stuck|timed out) at (-?[\d.]+),-?[\d.]+,(-?[\d.]+)", text):
        k = (m.group(1), int(float(m.group(2))) >> 3, int(float(m.group(3))) >> 3)
        cells[k] = cells.get(k, 0) + 1
    if cells:
        by_cell = {}
        for (a, x, z), n in cells.items():
            by_cell[(x, z)] = by_cell.get((x, z), 0) + n
        (who, x, z), n = max(cells.items(), key=lambda kv: kv[1])
        (cx, cz), cn = max(by_cell.items(), key=lambda kv: kv[1])
        r["[stuck] at one 8x8 cell: member / all"] = f"{n} ({who} {x * 8},{z * 8}) / {cn} ({cx * 8},{cz * 8})"
    return r


def repeat_failures(rows):
    """A member's failures of a chore key it had failed before in the run (#205's measure; contention and cut ends left out),
    with the members who repeated one."""
    keys = {x["id"]: (x.get("agent"), re.sub(r"^(.+:.+):\d+$", r"", x.get("key", ""))) for x in rows if x.get("type") == "choice"}
    seen, rep, who, fails = set(), 0, set(), 0
    for x in rows:
        if x.get("type") != "choice-end" or x.get("ok") or x.get("cut") or x.get("code") or x.get("id") not in keys:
            continue
        fails += 1
        k = keys[x["id"]]
        if k in seen:
            rep += 1
            who.add(k[0])
        seen.add(k)
    return f"{rep} of {fails} failures ({len(who)} members)" if fails else None


def agent_log_counts(log):
    reset = os.path.join(os.path.dirname(log), "reset_" + os.path.basename(log))
    m = re.search(r"log (\S*testagents-\S+\.log)", read(reset))
    if not m:
        return {}
    p = m.group(1)
    if not os.path.isabs(p):
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), p)
    text = read(p)
    if not text:
        return {}
    r = {k: text.count(k) for k in ("[lag]", "[stuck]", "[stuck-world]", "[repath]", "[dig]")}
    r.update(danger_summary(text))
    r.update(instinct_summary(text))
    # (initiatives, N.0: started, joins, steps, and how they ended)
    ini = [l for l in text.splitlines() if "[initiative]" in l]
    if ini:
        ends = {s: sum(1 for l in ini if re.search(rf": i\d+ {s} in ", l)) for s in ("built", "failed", "lapsed")}
        r["initiatives started / joins / steps"] = "%d / %d / %d" % (
            sum(" starts " in l for l in ini), sum(" joins " in l for l in ini),
            sum(" gathers " in l or " builds " in l or " prepares a green " in l for l in ini))
        r["initiatives built / failed / lapsed"] = "%d / %d / %d" % (ends["built"], ends["failed"], ends["lapsed"])
        r["initiatives could not start"] = sum(" could not start " in l for l in ini)
    # (#115: settings changed during the run, by the panel, the API or a profile's schedule)
    changes = re.findall(r"\[setting\] (MC_\w+|MCAI_\w+) (.*?) -> (.*?) \(by ([^)]*)\)", text)
    if changes:
        r["setting changes"] = "; ".join(f"{n} {a}->{b} ({by})" for n, a, b, by in changes)[:200]
    # (N.1's needs: status changes and the last status of each need)
    need = re.findall(r"\[need\] \S+: (\w+) \S+ -> ([a-z ]+) \(", text)
    if need:
        last = {}
        for k, st in need:
            last[k] = st
        r["need changes / last"] = "%d / %s" % (len(need), ", ".join(f"{k} {st}" for k, st in sorted(last.items())))
    return r


def perf_summary(path):
    """The figures of NAME.perf.jsonl (run_series.py samples /api/perf and Paper's mspt every 10 s during a stage run):
    {row: text}, empty without samples. Loop and tick are the worst minute's p99 (each sample covers the last minute or
    two), mspt Paper's 5 s average, RCON its p90."""
    rows = []
    for line in read(path).splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    if not rows:
        return {}
    vals = lambda f: [v for v in (f(r) for r in rows) if v is not None]
    med = lambda xs: sorted(xs)[len(xs) // 2] if xs else 0
    loop99, loopmax = vals(lambda r: (r.get("loop") or {}).get("p99")), vals(lambda r: (r.get("loop") or {}).get("max"))
    tick99 = vals(lambda r: (r.get("tick") or {}).get("p99"))
    mspt = vals(lambda r: r.get("mspt"))
    rcon = vals(lambda r: (r.get("rcon") or {}).get("p90"))
    rss = vals(lambda r: r.get("rss"))
    out = {"perf samples": f"{len(rows)} over {(rows[-1]['at'] - rows[0]['at']) / 60000:.1f} min, {max(r.get('agents', 0) for r in rows)} agents"}
    if loop99:
        out["loop p99 med / max (ms)"] = f"{med(loop99):g} / {max(loop99):g}, worst stall {max(loopmax or [0]):g}"
    if tick99:
        out["tick p99 med / max (ms)"] = f"{med(tick99):g} / {max(tick99):g}"
    if mspt:
        out["mspt med / max"] = f"{med(mspt):g} / {max(mspt):g} (budget {rows[0].get('mspt_budget', 50):g})"
    if rcon:
        out["rcon p90 med / max (ms)"] = f"{med(rcon):g} / {max(rcon):g}"
    if rss:
        out["rss max (MB)"] = f"{max(rss) / 2**20:.0f}"
    return out


def report(log):
    t = read(log)
    if not t:
        return {"run": os.path.basename(log), "error": "no log"}
    r = {"run": os.path.splitext(os.path.basename(log))[0]}
    r["start"] = "checkpoint" if re.search(r"^RESUME village", t, re.M) else "snapshot"
    r["complete at"] = first(r"COMPLETE at ([\d.]+m)", t, default="-" if r["start"] == "snapshot" else "(resumed)")
    r["total"] = first(r"^STOPPED after ([\d.]+m)", t, default="-")
    r["stopped by"] = (first(r"^STOPPED after [\d.]+m \(([^)]*)\)", t) or "- (no STOPPED line: killed or timed out)")[:60]
    before = after = 0
    for line in t.splitlines():
        if " action_failed " in line:
            if line.startswith("AFTER "):
                after += 1
            else:
                before += 1
    r["failed before / after"] = f"{before} / {after}"
    busy = re.search(r"^BUSY all: before completion (\S+) busy.*?after (\S+) \(", t, re.M)
    if busy:
        r["busy before / after"] = f"{busy.group(1)} / {busy.group(2)}"
    r["busy after by 10 min"] = first(r"^BUSY after by 10 min: (.*)$", t)
    rows = jsonl(log[:-len(".log")] + ".choices.jsonl")
    starts = [x for x in rows if x.get("type") == "choice"]
    if starts:
        span = (max(x["t"] for x in starts) - min(x["t"] for x in starts)) / 60000
        bins = chore_busy_bins(rows, len({x.get("agent") for x in starts}), span)
        r["chore busy by 10 min"] = ", ".join(f"{10 * k}-{10 * k + 10} {b:g}%" for k, b in enumerate(bins))
        r["repeat failures of one key"] = repeat_failures(rows)
    r["mine rate"] = first(r"^MINE rate: (.*)$", t)
    r["critical path"] = first(r"^CRITICAL PATH (.*)$", t)
    g = first(r"^GROW layouts (.*)$", t)
    if g:
        r["growth"] = g[:70]
    r["until"] = first(r"UNTIL met: (.*)$", t)
    food = first(r"^(FOOD ok.*|FOOD MISMATCH.*)$", t)
    if food:
        r["food"] = food[:70]
    r["food: all ate"] = first(r"^FOOD members \d+: every member ate (\S+)", t)
    r["tokens / cost"] = first(r"; tokens (.*)$", t)
    for k, n in agent_log_counts(log).items():
        r[k] = str(n)
    # (#164: laws, ballots, rules, compliance and customs, from the acts ledger as rules_use.py reads it)
    r.update(rules_summary(load_ledgers(log)[0]))
    r.update(perf_summary(log[:-len(".log")] + ".perf.jsonl"))
    return r


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    logs = [a if a.endswith(".log") else a + ".log" for a in args]
    rows = [report(l) for l in logs]
    keys = []
    for r in rows:
        keys += [k for k, v in r.items() if k not in keys and v is not None]
    width = max(len(k) for k in keys)
    cols = [max(len(str(r.get(k) or "-")) for k in keys) for r in rows]
    cols = [min(c, W) for c in cols]
    for k in keys:
        cells = [str(r.get(k) or "-")[:W].ljust(c) for r, c in zip(rows, cols)]
        print(f"{k:<{width}}  " + "  ".join(cells).rstrip())


if __name__ == "__main__":
    main()
