"""Experiment 1's analysis (G2, #32, PLAN E.8; fixed before the first run): the specialisation index of each run and the
contrast between two arms.

Per run (a decision log, NAME.choices.jsonl), over the model decisions (source "model", or "scripted" for the null arm)
of members other than the Mayor, with kinds at a fixed grain (harvests on fields and slots one kind; eating and tidying left
out):
  - MI: the mutual information I(agent; kind) in bits, over H(kind): the normalised index;
  - the null: agent labels shuffled within 10-minute windows (each window keeps its kinds and its members' decision counts),
    1,000 times (seeded); the bias-corrected index = (MI - mean null MI) / H(kind), and the share of nulls >= MI;
  - persistence: each member's decisions in windows of 5, the modal kind per window; the share of consecutive windows
    whose modal kind holds; distinct modal kinds among members in their last window; and the entropy of those roles.
The contrast (--arms): run-level corrected indexes of arm A against arm B, a one-sided exact permutation test (A > B) over
every split of the pooled runs.

Usage:
  python scripts/checks/spec_index.py RUN.choices.jsonl [...]                 one line per run
  python scripts/checks/spec_index.py --arms A=a1.jsonl,a2.jsonl B=b1.jsonl,b2.jsonl   per run, then the contrast
Options: --null N (1000), --window-min 10, --source model|scripted|any (model, plus scripted with "any"), --from-min M
(decisions from minute M of the run; default 0).
"""
import itertools, json, math, random, sys
from collections import Counter, defaultdict

ROLE = {"slot": "farm"}
LEAVE = {"eat", "tidy"}


def load(path, source, from_min):
    out = []
    t0 = None
    for line in open(path, encoding="utf-8"):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("type") != "choice":
            continue
        t0 = r["t"] if t0 is None else min(t0, r["t"])
        src = r.get("source")
        ok = src == "model" if source == "model" else src == "scripted" if source == "scripted" else src in ("model", "scripted")
        if not ok or r.get("agent") == "Mayor":
            continue
        k = ROLE.get(r.get("kind"), r.get("kind"))
        if not k or k in LEAVE:
            continue
        out.append((r["t"], r["agent"], k))
    out.sort()
    if t0 is not None and from_min:
        out = [x for x in out if x[0] >= t0 + from_min * 60000]
    return out


def entropy(counts):
    n = sum(counts.values())
    return -sum(c / n * math.log2(c / n) for c in counts.values() if c) if n else 0.0


def mi(pairs):
    n = len(pairs)
    if not n:
        return 0.0
    ja = Counter(pairs)
    pa = Counter(a for a, _ in pairs)
    pk = Counter(k for _, k in pairs)
    return sum(c / n * math.log2((c / n) / ((pa[a] / n) * (pk[k] / n))) for (a, k), c in ja.items())


def index(ds, nulls, window_ms, seed):
    pairs = [(a, k) for _, a, k in ds]
    hk = entropy(Counter(k for _, k in pairs))
    m = mi(pairs)
    # (the null: agent labels shuffled within windows)
    wins = defaultdict(list)
    t0 = ds[0][0] if ds else 0
    for i, (t, a, k) in enumerate(ds):
        wins[(t - t0) // window_ms].append(i)
    rnd = random.Random(seed)
    ms = []
    for _ in range(nulls):
        agents = [a for _, a, _ in ds]
        for idx in wins.values():
            sub = [agents[i] for i in idx]
            rnd.shuffle(sub)
            for i, a in zip(idx, sub):
                agents[i] = a
        ms.append(mi(list(zip(agents, [k for _, _, k in ds]))))
    mean = sum(ms) / len(ms) if ms else 0.0
    p = (sum(1 for x in ms if x >= m) + 1) / (len(ms) + 1)
    return {"n": len(pairs), "members": len({a for a, _ in pairs}), "Hk": round(hk, 3), "MI": round(m, 4), "null": round(mean, 4),
            "raw": round(m / hk, 4) if hk else 0.0, "index": round((m - mean) / hk, 4) if hk else 0.0, "p_null": round(p, 4)}


def persistence(ds, size=5):
    by = defaultdict(list)
    for _, a, k in ds:
        by[a].append(k)
    held = total = 0
    last = {}
    for a, ks in by.items():
        modes = []
        for i in range(0, len(ks) - size + 1, size):
            w = ks[i:i + size]
            c = Counter(w)
            top = max(c.values())
            modes.append(next(k for k in reversed(w) if c[k] == top))
        for x, y in zip(modes, modes[1:]):
            total += 1
            held += x == y
        if modes:
            last[a] = modes[-1]
    roles = Counter(last.values())
    return {"windows": total, "held": round(held / total, 3) if total else None, "roles": len(roles), "role_H": round(entropy(roles), 3), "role_counts": dict(roles.most_common())}


def run_line(path, a):
    ds = load(path, a["source"], a["from"])
    r = index(ds, a["null"], a["window"] * 60000, 1)
    r.update(persistence(ds))
    return r


def contrast(xs, ys):
    """One-sided exact permutation test of mean(xs) > mean(ys) over every split of the pooled values."""
    pool = xs + ys
    obs = sum(xs) / len(xs) - sum(ys) / len(ys)
    n = ge = 0
    for idx in itertools.combinations(range(len(pool)), len(xs)):
        a = [pool[i] for i in idx]
        b = [pool[i] for i in range(len(pool)) if i not in idx]
        n += 1
        ge += (sum(a) / len(a) - sum(b) / len(b)) >= obs - 1e-12
    return obs, ge / n, n


def main():
    argv = sys.argv[1:]
    a = {"null": 1000, "window": 10.0, "source": "model", "from": 0.0}
    arms = {}
    files = []
    i = 0
    while i < len(argv):
        x = argv[i]
        if x == "--null":
            a["null"] = int(argv[i + 1]); i += 2
        elif x == "--window-min":
            a["window"] = float(argv[i + 1]); i += 2
        elif x == "--source":
            a["source"] = argv[i + 1]; i += 2
        elif x == "--from-min":
            a["from"] = float(argv[i + 1]); i += 2
        elif x == "--arms":
            i += 1
            while i < len(argv) and "=" in argv[i]:
                k, v = argv[i].split("=", 1)
                arms[k] = [p for p in v.split(",") if p]
                i += 1
        else:
            files.append(x); i += 1
    if arms:
        vals = {}
        for k, ps in arms.items():
            vals[k] = []
            for p in ps:
                r = run_line(p, a)
                vals[k].append(r["index"])
                print(f"{k} {p}: {json.dumps(r)}")
        ks = list(arms)
        if len(ks) == 2:
            obs, p, n = contrast(vals[ks[0]], vals[ks[1]])
            print(f"CONTRAST {ks[0]} > {ks[1]}: mean index {sum(vals[ks[0]]) / len(vals[ks[0]]):.4f} vs {sum(vals[ks[1]]) / len(vals[ks[1]]):.4f}, difference {obs:.4f}, one-sided exact p = {p:.4f} ({n} splits)")
    for p in files:
        print(f"{p}: {json.dumps(run_line(p, a))}")


if __name__ == "__main__":
    main()
