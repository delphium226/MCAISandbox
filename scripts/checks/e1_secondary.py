"""Experiment 1's secondary views (g2-social, 10-22; NOT pre-registered: the primary is spec_index.py's index over model
decisions). Per run: model decisions per member (mean, min, max); the corrected index over every chore pick (model, repeat,
fixed, only, fallback: what members spent their time on, whoever decided); the same weighted by each chore's minutes (from
its choice-end record); persistence over all picks. With --arms, both arms' means and the exact one-sided test on each
view, and a rough power estimate: from the pooled run-to-run spread of the primary index, the runs per arm a one-sided
two-sample test at 0.05 would need to detect a difference of 0.02, 0.04 and the observed one with 80% power.

Usage: python scripts/checks/e1_secondary.py --arms a=A1.choices.jsonl,... b2=B1.choices.jsonl,...
"""
import json, math, random, sys
from collections import Counter, defaultdict
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spec_index import ROLE, LEAVE, entropy, index, load, persistence, contrast  # noqa: E402


def all_picks(path):
    picks, ends = [], {}
    for line in open(path, encoding="utf-8"):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("type") == "choice-end":
            ends[r["id"]] = r.get("minutes", 0) or 0
        elif r.get("type") == "choice" and r.get("agent") != "Mayor" and r.get("options"):
            k = ROLE.get(r.get("kind"), r.get("kind"))
            if k and k not in LEAVE:
                picks.append((r["t"], r["agent"], k, r["id"]))
    picks.sort()
    return [(t, a, k, ends.get(i, 0)) for t, a, k, i in picks]


def weighted_index(picks):
    w = defaultdict(float)
    for _, a, k, m in picks:
        w[(a, k)] += max(0.0, m)
    tot = sum(w.values())
    if not tot:
        return 0.0
    pa, pk = defaultdict(float), defaultdict(float)
    for (a, k), v in w.items():
        pa[a] += v
        pk[k] += v
    mi = sum(v / tot * math.log2((v / tot) / ((pa[a] / tot) * (pk[k] / tot))) for (a, k), v in w.items() if v)
    hk = -sum(v / tot * math.log2(v / tot) for v in pk.values() if v)
    return mi / hk if hk else 0.0


def per_member(ds):
    c = Counter(a for _, a, _ in ds)
    v = list(c.values())
    return (round(sum(v) / len(v), 1), min(v), max(v)) if v else (0, 0, 0)


def n_needed(sd, delta):
    """Runs per arm for a one-sided two-sample z-approximation at alpha 0.05, power 0.8."""
    if delta <= 0 or sd <= 0:
        return None
    return math.ceil(2 * ((1.645 + 0.842) * sd / delta) ** 2)


def main():
    argv = sys.argv[1:]
    arms = {}
    if "--arms" in argv:
        for x in argv[argv.index("--arms") + 1:]:
            if "=" in x:
                k, v = x.split("=", 1)
                arms[k] = [p for p in v.split(",") if p]
    rows = defaultdict(list)
    for arm, ps in arms.items():
        for p in ps:
            ds = load(p, "model", 0)
            prim = index(ds, 500, 600000, 1)
            picks = all_picks(p)
            allds = [(t, a, k) for t, a, k, _ in picks]
            alli = index(allds, 500, 600000, 1)
            wi = weighted_index(picks)
            pers = persistence(allds)
            pm = per_member(ds)
            rows[arm].append({"primary": prim["index"], "all": alli["index"], "minutes": round(wi, 4)})
            print(f"{arm} {os.path.basename(p)}: model decisions {prim['n']} ({pm[0]} a member, {pm[1]}-{pm[2]}); primary {prim['index']}; "
                  f"all picks {alli['n']} ({per_member(allds)[0]} a member): index {alli['index']} (null p {alli['p_null']}); "
                  f"minutes-weighted raw index {round(wi, 4)}; persistence over all picks {pers['held']} ({pers['windows']} pairs), roles {pers['roles']}")
    ks = list(arms)
    if len(ks) == 2 and all(rows[k] for k in ks):
        for view in ("primary", "all", "minutes"):
            xs, ys = [r[view] for r in rows[ks[0]]], [r[view] for r in rows[ks[1]]]
            obs, p, n = contrast(xs, ys)
            print(f"{view.upper()} {ks[0]} {sum(xs) / len(xs):.4f} vs {ks[1]} {sum(ys) / len(ys):.4f}: difference {obs:.4f}, one-sided p {p:.3f} ({n} splits){'' if view == 'primary' else ' (not pre-registered)'}")
        allp = [r["primary"] for k in ks for r in rows[k]]
        means = {k: sum(r["primary"] for r in rows[k]) / len(rows[k]) for k in ks}
        ss = sum((r["primary"] - means[k]) ** 2 for k in ks for r in rows[k])
        dof = max(1, len(allp) - 2)
        sd = math.sqrt(ss / dof)
        obs = abs(means[ks[0]] - means[ks[1]])
        print(f"POWER pooled run-to-run SD of the primary index {sd:.4f}; runs per arm for 80% power at 0.05 (one-sided): "
              f"difference 0.02 -> {n_needed(sd, 0.02)}, 0.04 -> {n_needed(sd, 0.04)}, the observed {obs:.4f} -> {n_needed(sd, obs)}")


if __name__ == "__main__":
    main()
