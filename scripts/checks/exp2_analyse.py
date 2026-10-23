"""Experiment 2 (#33): the preregistered analysis (runs/2026-10-23/g3-rules/exp2_prereg.md, section 7).

Per run: the model share answers on days 3-5 by non-influencer members (the acts ledger's `compliance op: levy` records,
`lapsed` ones apart), P(pay) = P(levy or all), P(all), items left per answer; the levy in force (voted or imposed) and the
levy item's counts. Then the primary test: voted (V+) against imposed (I) run means, one-sided exact permutation test, with
a bootstrap 95% interval of the difference over runs.

Usage: python scripts/checks/exp2_analyse.py V:DIR/NAME [V:DIR/NAME ...] I:DIR/NAME [...]  [--days 3-5] [--influencers Ben,Kai,Sam]
  (a run's arm is the prefix before the colon: V, I, Vm (anti), F (frozen); runs without one are listed, not tested)
"""
import itertools, json, random, re, sys
from collections import Counter


def load(base):
    base = re.sub(r"\.(acts|choices)\.jsonl$|\.log$", "", base)
    return [json.loads(l) for l in open(f"{base}.acts.jsonl", encoding="utf-8") if l.strip()]


def per_run(acts, days, influencers):
    clocks = sorted((a["t"], a["day"]) for a in acts if a.get("type") == "clock" and "t" in a)

    def day_at(t):
        d = 0
        for ct, cd in clocks:
            if ct <= t:
                d = cd
        return d

    ans = [a for a in acts if a.get("type") == "compliance" and a.get("op") == "levy" and a.get("split") != "lapsed"
           and a.get("agent") not in influencers and days[0] <= day_at(a.get("t", 0)) <= days[1]]
    sp = Counter(a.get("split") for a in ans)
    n = len(ans)
    pay = (sp.get("levy", 0) + sp.get("all", 0)) / n if n else float("nan")
    levy = [a for a in acts if a.get("type") == "rule" and str(a.get("op", "")).startswith("levy")]
    item = [a for a in acts if a.get("type") == "meeting" and a.get("op") == "tally" and "levy:rate" in (a.get("result") or {})]
    return {"n": n, "pay": pay, "all": sp.get("all", 0) / n if n else float("nan"), "splits": dict(sp),
            "left_per_answer": sum(a.get("left", 0) for a in ans) / n if n else float("nan"),
            "levy": [(a.get("op"), a.get("rate"), a.get("day")) for a in levy],
            "item": item[0]["result"]["levy:rate"] if item else None,
            "members": len({a["agent"] for a in ans})}


def perm_test(v, i):
    """One-sided: P(mean(V) - mean(I) >= observed) over every relabelling."""
    obs = sum(v) / len(v) - sum(i) / len(i)
    pool = v + i
    k = len(v)
    hits = total = 0
    for idx in itertools.combinations(range(len(pool)), k):
        a = [pool[j] for j in idx]
        b = [pool[j] for j in range(len(pool)) if j not in idx]
        total += 1
        if sum(a) / len(a) - sum(b) / len(b) >= obs - 1e-12:
            hits += 1
    return obs, hits / total


def boot(v, i, n=10000, seed=1):
    r = random.Random(seed)
    ds = sorted(sum(r.choice(v) for _ in v) / len(v) - sum(r.choice(i) for _ in i) / len(i) for _ in range(n))
    return ds[int(0.025 * n)], ds[int(0.975 * n)]


def main():
    args = sys.argv[1:]
    days = (3, 5)
    influencers = {"Ben", "Kai", "Sam"}
    runs = []
    k = 0
    while k < len(args):
        if args[k] == "--days":
            a, b = args[k + 1].split("-")
            days = (int(a), int(b))
            k += 2
            continue
        if args[k] == "--influencers":
            influencers = set(args[k + 1].split(","))
            k += 2
            continue
        arm, _, path = args[k].partition(":") if re.match(r"^[A-Za-z]+:", args[k]) else ("", "", args[k])
        runs.append((arm, path))
        k += 1
    rows = []
    for arm, path in runs:
        r = per_run(load(path), days, influencers)
        rows.append((arm, path, r))
        print(f"{arm or '-':3} {path}: answers {r['n']} by {r['members']} members, P(pay) {r['pay']:.2f}, P(all) {r['all']:.2f}, left/answer {r['left_per_answer']:.2f}; {r['splits']}; levy {r['levy']}; item {r['item']}")
    v = [r["pay"] for a, _, r in rows if a == "V" and r["n"]]
    i = [r["pay"] for a, _, r in rows if a == "I" and r["n"]]
    if v and i:
        obs, p = perm_test(v, i)
        lo, hi = boot(v, i)
        print(f"PRIMARY V+ ({len(v)}) vs I ({len(i)}): difference {obs:+.3f} (bootstrap 95% {lo:+.3f} to {hi:+.3f}); one-sided exact permutation p = {p:.3f}")


if __name__ == "__main__":
    main()
