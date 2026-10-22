"""G8's ladder in a run (runs/2026-10-22/ladder/spec.md, 4.4 and draft 2): from NAME.choices.jsonl, NAME.acts.jsonl and
the agent log beside it.

  - stage times: each [ladder] stage and rung line, minutes from the first choice;
  - the iron work by kind (dig, smelt, forge): chores, ok, by member; tools given (forge results "given to X");
  - specialists: members with 5+ iron chores, the share of their iron work in their main kind, how many do 60%+ in one
    kind, and a specialisation index (the mean main-kind share less its mean under a permutation null: kind labels
    shuffled among the iron chores within 10-minute windows, 500 draws; p = the share of draws at or above the index),
    by source (model picks only for a model run, everything for a staged one);
  - requests naming forge goods (acts records), taken up and kept.

Usage: python scripts/ladder_use.py DIR/NAME [--log AGENT_LOG] [--source model]
"""
import json, random, re, sys
from collections import Counter, defaultdict


def kind_of(opt):
    m = re.match(r"iron:(dig|smelt|forge)", opt or "")
    return m.group(1) if m else None


def spec_index(rows, draws=500, seed=7):
    by = defaultdict(list)
    for r in rows:
        by[r["agent"]].append(r["k"])
    members = [m for m, ks in by.items() if len(ks) >= 5]
    if not members:
        return None

    def idx(lab):
        shares = []
        for m in members:
            c = Counter(lab[m])
            shares.append(max(c.values()) / len(lab[m]))
        return sum(shares) / len(shares)

    obs = idx(by)
    rows5 = [r for r in rows if r["agent"] in members]
    win = defaultdict(list)
    for i, r in enumerate(rows5):
        win[int(r["t"] // 600000)].append(i)
    rnd = random.Random(seed)
    null = []
    for _ in range(draws):
        ks = [r["k"] for r in rows5]
        for ids in win.values():
            sub = [ks[i] for i in ids]
            rnd.shuffle(sub)
            for i, k in zip(ids, sub):
                ks[i] = k
        lab = defaultdict(list)
        for r, k in zip(rows5, ks):
            lab[r["agent"]].append(k)
        null.append(idx(lab))
    mean = sum(null) / len(null)
    sixty = sum(1 for m in members if max(Counter(by[m]).values()) / len(by[m]) >= 0.6)
    return {"members": len(members), "index": round(obs - mean, 3), "raw": round(obs, 3), "null": round(mean, 3), "p": round(sum(1 for x in null if x >= obs) / len(null), 3), "sixty": sixty}


def main():
    args = sys.argv[1:]
    base = re.sub(r"\.(choices|acts)\.jsonl$|\.log$", "", args[0])
    log = args[args.index("--log") + 1] if "--log" in args else None
    src = args[args.index("--source") + 1] if "--source" in args else None
    rows = [json.loads(l) for l in open(f"{base}.choices.jsonl", encoding="utf-8") if l.strip()]
    ch = [r for r in rows if r.get("type") == "choice"]
    ends = {r["id"]: r for r in rows if r.get("type") == "choice-end"}
    t0 = min(r["t"] for r in ch) if ch else 0
    iron = []
    for c in ch:
        k = kind_of(c.get("chosen"))
        if not k or (src and c.get("source") != src):
            continue
        e = ends.get(c["id"], {})
        iron.append({"agent": c["agent"], "k": k, "t": c["t"], "ok": e.get("ok"), "msg": e.get("message") or "", "id": c.get("chosen")})
    print(f"== {base.split('/')[-1]}: {len(iron)} iron chores{f' ({src} picks)' if src else ''} of {len(ch)} choices")
    for k in ("dig", "smelt", "forge"):
        ks = [r for r in iron if r["k"] == k]
        who = Counter(r["agent"] for r in ks)
        print(f"  {k:6} {len(ks)} chores, {sum(1 for r in ks if r['ok'])} ok; by {dict(who.most_common(8))}")
    given = [re.search(r"given to ([A-Za-z0-9_]+)", r["msg"]) for r in iron if r["k"] == "forge"]
    print(f"  tools given: {Counter(g.group(1) for g in given if g)}")
    si = spec_index(iron)
    print(f"  specialists (5+ iron chores): {si}")
    if log:
        for l in open(log, encoding="utf-8", errors="replace"):
            if l.startswith("[ladder]") or "rung vote" in l or ("[vote]" in l and "next ambition" in l):
                print("  " + l.strip()[:220])
    acts = f"{base}.acts.jsonl"
    try:
        recs = [json.loads(l) for l in open(acts, encoding="utf-8") if l.strip()]
        forge = [r for r in recs if "iron:forge" in json.dumps(r)]
        print(f"  acts naming forge goods: {Counter(r.get('type') for r in forge)}")
        lad = [r for r in recs if r.get("type") == "ladder"]
        for r in lad:
            print(f"  ladder {r.get('kind')} at {round((r.get('t', t0) - t0) / 60000, 1)} min: {r.get('text', '')[:160]}")
    except FileNotFoundError:
        pass


if __name__ == "__main__":
    main()
