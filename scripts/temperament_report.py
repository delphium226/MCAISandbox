"""A.3p's measures (spec runs/2026-10-16/s33/spec_a3p.md section 4) from runs' choice logs (MCAI_CHOICE_LOG).

Per run: the chores chosen after completion (`choice` records with a menu; eating and growth left out), and from them
  choices    how many, by how many agents, and how they were decided (fixed, model, fallback)
  H village  the entropy of the village's kind mix (bits)
  H agent    the mean entropy of each agent's own mix, agents with >= 4 choices (lower than the village's: agents specialise)
  JSD        the mean pairwise Jensen-Shannon divergence between agents' kind mixes (bits, agents with >= 4 choices)
  ident      identifiability, split-half: naive Bayes (add-one smoothing) trained on every agent's first half names each
             agent (4+ choices) from up to 10 choices of its second half; against 1/n chance
  rho        the manipulation check: per agent the Spearman correlation between a kind's temperament weight (the on-vectors,
             whatever the run's mode, so an identical run is scored against the weights it would have had) and the kind's
             share of its choices, over the kinds on its menus; the mean
  tilt       the mean of chosen kind weight / mean kind weight of the menu it was chosen from (1: no tilt)
  failed     the share of choice ends not ok (cut ends left out)
Usage: python scripts/temperament_report.py RUN.choices.jsonl [...] (a directory/NAME or NAME.log finds NAME.choices.jsonl)
"""
import collections
import json
import math
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {"eat", "grow"}


def table():
    tsx = os.path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs")
    out = subprocess.run(["node", tsx, "scripts/checks/temperament_table.mts", "--json"], cwd=ROOT, capture_output=True,
                         text=True, encoding="utf-8", check=True).stdout
    return {r["name"].lower(): r["weights"] for r in json.loads(out)}


def path_of(arg):
    for p in (arg, f"{arg}.choices.jsonl", arg[:-4] + ".choices.jsonl" if arg.endswith(".log") else None):
        if p and os.path.isfile(p) and p.endswith(".jsonl"):
            return p
    raise SystemExit(f"no choice log for {arg}")


def entropy(c):
    n = sum(c.values())
    return -sum(v / n * math.log2(v / n) for v in c.values() if v) if n else 0.0


def jsd(a, b):
    na, nb = sum(a.values()), sum(b.values())
    m = {k: (a.get(k, 0) / na + b.get(k, 0) / nb) / 2 for k in set(a) | set(b)}
    def kl(c, n):
        return sum(c[k] / n * math.log2((c[k] / n) / m[k]) for k in c if c[k])
    return (kl(a, na) + kl(b, nb)) / 2


def ranks(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2
        i = j + 1
    return r


def spearman(x, y):
    if len(x) < 3:
        return None
    rx, ry = ranks(x), ranks(y)
    mx, my = sum(rx) / len(rx), sum(ry) / len(ry)
    sxy = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    sx = math.sqrt(sum((a - mx) ** 2 for a in rx))
    sy = math.sqrt(sum((b - my) ** 2 for b in ry))
    return sxy / (sx * sy) if sx and sy else None


def identifiability(seqs, window=10):
    """Split-half: every agent's first half trains, then each agent with 4+ choices is named from (up to `window` of) its
    second half; the share named right."""
    kinds = sorted({k for s in seqs.values() for k in s})
    train = {a: collections.Counter(s[:len(s) // 2]) for a, s in seqs.items()}
    hits = tries = 0
    for agent, seq in seqs.items():
        if len(seq) < 4:
            continue
        win = seq[len(seq) // 2:][:window]
        best, best_ll = None, -math.inf
        for other, c in train.items():
            n = sum(c.values())
            ll = sum(math.log((c[k] + 1) / (n + len(kinds))) for k in win)
            if ll > best_ll:
                best, best_ll = other, ll
        hits += best == agent
        tries += 1
    return hits / tries if tries else 0.0


def report(path, weights):
    choices, ends = [], []
    for line in open(path, encoding="utf-8"):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("type") == "choice" and r.get("options") and r.get("kind") not in SKIP:
            choices.append(r)
        elif r.get("type") == "choice-end" and not r.get("cut"):
            ends.append(r)
    # (an end carries no kind: it counts when its choice does, matched by id)
    ids = {r["id"] for r in choices}
    ends = [e for e in ends if e.get("id") in ids]
    seqs = collections.defaultdict(list)
    menus = collections.defaultdict(set)
    tilts, sources = [], collections.Counter()
    for r in sorted(choices, key=lambda r: r["t"]):
        a = r["agent"]
        seqs[a].append(r["kind"])
        sources[r.get("source", "?")] += 1
        w = weights.get(a.lower())
        kinds_on = [o["kind"] for o in r["options"] if o["kind"] not in SKIP]
        menus[a].update(kinds_on)
        if w and kinds_on:
            mean = sum(w.get(k, 1) for k in kinds_on) / len(kinds_on)
            tilts.append(w.get(r["kind"], 1) / mean)
    village = collections.Counter(k for s in seqs.values() for k in s)
    per = {a: collections.Counter(s) for a, s in seqs.items()}
    big = [a for a, s in seqs.items() if len(s) >= 4]
    pairs = [(x, y) for i, x in enumerate(big) for y in big[i + 1:]]
    rhos = []
    for a, c in per.items():
        w = weights.get(a.lower())
        ks = sorted(menus[a])
        if w and len(seqs[a]) >= 4:
            rho = spearman([w.get(k, 1) for k in ks], [c.get(k, 0) / len(seqs[a]) for k in ks])
            if rho is not None:
                rhos.append(rho)
    failed = sum(1 for e in ends if not e.get("ok")) / len(ends) if ends else 0.0
    n = len(seqs)
    return {
        "choices": len(choices), "agents": n, "sources": dict(sources),
        "H_village": entropy(village), "H_agent": sum(entropy(per[a]) for a in big) / len(big) if big else 0.0,
        "JSD": sum(jsd(per[x], per[y]) for x, y in pairs) / len(pairs) if pairs else 0.0,
        "ident": identifiability(seqs), "chance": 1 / n if n else 0.0,
        "rho": sum(rhos) / len(rhos) if rhos else None, "tilt": sum(tilts) / len(tilts) if tilts else None,
        "failed": failed, "kinds": dict(village.most_common()),
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    weights = table()
    rows = []
    for arg in sys.argv[1:]:
        p = path_of(arg)
        rows.append((os.path.basename(p).replace(".choices.jsonl", ""), report(p, weights)))
    f = lambda x, d=2: "-" if x is None else f"{x:.{d}f}"
    print(f"{'run':<14}{'choices':>8}{'agents':>7}{'H vill':>8}{'H agent':>8}{'JSD':>7}{'ident':>7}{'chance':>7}{'rho':>7}{'tilt':>6}{'failed':>7}  sources")
    for name, r in rows:
        print(f"{name:<14}{r['choices']:>8}{r['agents']:>7}{f(r['H_village']):>8}{f(r['H_agent']):>8}{f(r['JSD']):>7}{f(r['ident']):>7}"
              f"{f(r['chance']):>7}{f(r['rho']):>7}{f(r['tilt']):>6}{f(r['failed']):>7}  {r['sources']}")
    for name, r in rows:
        print(f"{name}: {', '.join(f'{k} {v}' for k, v in r['kinds'].items())}")


if __name__ == "__main__":
    main()
