"""One table of what matters in staged runs, read from their logs, side by side for comparison: so a run is judged from a
dozen numbers instead of a read through its log.

Usage: python scripts/run_report.py LOG [LOG ...]
       python scripts/run_report.py DIR/NAME [...]      (NAME.log in DIR, as run_series.py writes them)
Each LOG is a stage_village.py log. The agent server's log of the same run is found through reset_NAME.log beside it
(run_series.py and stage_runs.py write one) for the [lag], [stuck], [stuck-world], [repath] and [dig] counts.
Rows: how the run started and stopped, completion and total minutes, failed actions before and after completion, busy
shares, the mine's rate, growth, food, tokens and cost, the agent server's warning lines, and the load figures run_series.py
sampled (NAME.perf.jsonl: event loop, tick, Paper's mspt, RCON, memory). A row no run has is left out.
"""
import json, os, re, sys

# Widest cell; a longer value is cut (MCAI_REPORT_WIDTH to change)
W = int(os.environ.get("MCAI_REPORT_WIDTH", "44"))


def read(path):
    return open(path, encoding="utf-8", errors="replace").read() if os.path.exists(path) else ""


def first(rx, text, group=1, default=None):
    m = re.search(rx, text, re.M)
    return m.group(group) if m else default


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
    return {k: text.count(k) for k in ("[lag]", "[stuck]", "[stuck-world]", "[repath]", "[dig]")}


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
