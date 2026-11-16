"""The ladder in a run: when each rung became the village's ambition, and the stage, rung and vote lines in order.

Minutes come from NAME.choices.jsonl (the first choice whose options pay a rung's wage, "for the <rung>"); the agent
log has no timestamps, so its lines are listed in order. The agent log is read from NAME.spec.runner.log's
"agent_log: ... (PATH)" line when --log is not given.

Usage: python .claude/skills/live-run/rung_times.py DIR/NAME [--log AGENT_LOG]
"""
import json, os, re, sys

RUNGS = ["iron age", "age of letters", "copper age", "age of trade", "age of husbandry", "age of music",
         "diamond age", "age of machines", "age of bees", "age of maps", "age of the sea", "age of enchantment",
         "age of the nether", "nether age"]


def find_log(base):
    d, name = os.path.split(base)
    for runner in [os.path.join(d, f) for f in os.listdir(d or ".") if f.endswith(".spec.runner.log")]:
        text = open(runner, encoding="utf-8", errors="replace").read()
        if f"=== {name} " not in text:
            continue
        part = text.split(f"=== {name} ", 1)[1]
        m = re.search(r"agent_log: .*?\(([^)]+\.log)\)", part)
        if m:
            return m.group(1)
    return None


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    base = args[0]
    log = args[args.index("--log") + 1] if "--log" in args else find_log(base)
    rows = []
    for line in open(base + ".choices.jsonl", encoding="utf-8"):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if isinstance(r.get("t"), (int, float)):
            rows.append(r)
    if not rows:
        print("no timed choices in", base + ".choices.jsonl")
        return
    t0 = min(r["t"] for r in rows)
    end = (max(r["t"] for r in rows) - t0) / 60000
    first = {}
    for r in sorted(rows, key=lambda r: r["t"]):
        s = json.dumps(r.get("options", "")).lower()
        for rung in RUNGS:
            if rung not in first and ("for the " + rung) in s:
                first[rung] = (r["t"] - t0) / 60000
    print(f"== {os.path.basename(base)}: {len(rows)} choices over {end:.1f} min")
    order = sorted(first.items(), key=lambda kv: kv[1])
    for i, (rung, m) in enumerate(order):
        nxt = order[i + 1][1] if i + 1 < len(order) else None
        span = f"{nxt - m:5.1f} min until the next" if nxt is not None else "current at the end"
        print(f"  {m:6.1f}  {rung:22s} {span}")
    if not log or not os.path.exists(log):
        print("  (no agent log found; pass --log)")
        return
    print(f"-- {log}")
    pat = re.compile(r"finished stage|reached the|wins for the next|chose the .* as its next")
    wages = 0
    for line in open(log, encoding="utf-8", errors="replace"):
        if "earns the village's wage" in line:
            wages += 1
        elif ("[ladder]" in line or "[vote]" in line) and pat.search(line):
            print("  " + line.strip()[:200])
    print(f"  rung wages paid: {wages}")


if __name__ == "__main__":
    main()
