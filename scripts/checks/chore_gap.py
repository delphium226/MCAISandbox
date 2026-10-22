"""The wait between chores (the user's, 10-22): from a chore's end (its choice-end record's tEnd) to the same member's next
choice, in seconds: quantiles overall and by who decided the next choice; chores' own lengths; the chore-busy share
(chore minutes over member-minutes from the first choice to the last end); decisions a member-hour by source.

Usage: python scripts/checks/chore_gap.py DIR/NAME [DIR/NAME ...]
"""
import json, re, sys
from collections import Counter, defaultdict


def q(xs, fs=(0.1, 0.25, 0.5, 0.75, 0.9)):
    s = sorted(xs)
    return [round(s[min(len(s) - 1, int(f * (len(s) - 1)))], 1) for f in fs] if s else []


def run(base):
    base = re.sub(r"\.choices\.jsonl$|\.log$", "", base)
    rows = [json.loads(l) for l in open(f"{base}.choices.jsonl", encoding="utf-8") if l.strip()]
    ch = sorted([r for r in rows if r.get("type") == "choice"], key=lambda r: r["t"])
    ends = {r["id"]: r for r in rows if r.get("type") == "choice-end"}
    by_agent = defaultdict(list)
    for c in ch:
        by_agent[c["agent"]].append(c)
    gaps, by_src, lens = [], defaultdict(list), []
    busy = 0.0
    for a, cs in by_agent.items():
        for c, nxt in zip(cs, cs[1:]):
            e = ends.get(c["id"])
            if not e or not e.get("tEnd"):
                continue
            g = (nxt["t"] - e["tEnd"]) / 1000
            if g < 0:
                continue
            gaps.append(g)
            by_src[nxt.get("source")].append(g)
        for c in cs:
            e = ends.get(c["id"])
            if e and e.get("tEnd"):
                lens.append((e["tEnd"] - c["t"]) / 1000)
                busy += (e["tEnd"] - c["t"]) / 60000
    t0 = ch[0]["t"] if ch else 0
    t1 = max([e.get("tEnd", 0) for e in ends.values()] + [c["t"] for c in ch]) if ch else 0
    members = len(by_agent)
    span = (t1 - t0) / 60000 if ch else 0
    src = Counter(c.get("source") + (f":{c.get('reason')}" if c.get("reason") == "work block" else "") for c in ch)
    print(f"== {base.split('/')[-1]}: {len(ch)} choices by {members} members over {span:.0f} min")
    print(f"  gap end->next choice (s) q10/25/50/75/90 {q(gaps)}; under 10 s {sum(1 for g in gaps if g < 10)} of {len(gaps)}")
    for s, gs in sorted(by_src.items(), key=lambda x: -len(x[1])):
        print(f"    next by {s}: n {len(gs)}, median {q(gs, (0.5,))[0]}")
    print(f"  chore length (s) q10/25/50/75/90 {q(lens)}; chore-busy share {busy / max(1e-9, members * span):.1%}")
    print(f"  choices a member-hour {len(ch) / max(1e-9, members * span / 60):.1f}; by source {dict(src)}")


if __name__ == "__main__":
    for b in sys.argv[1:]:
        run(b)
