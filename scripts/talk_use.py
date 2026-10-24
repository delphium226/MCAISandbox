"""Members' talk in a run (#107: MC_NEWS, MC_QUESTIONS, MC_DELIBERATE, MC_TALK_HOLDOUT), from its acts log (X.acts.jsonl).

  python scripts/talk_use.py ACTS_JSONL [--village NAME] [--window MIN]

Prints:
  - news: items made, retold, dropped (by why), withheld; hearers a delivered item; code's tags (checked, refuted,
    unchecked) and the reach of refuted ones (falsehood reach: members who heard a refuted claim);
  - diffusion: per first teller's item, members holding it at +5, +10, +20 minutes;
  - acted on: a hearer's next decision within --window minutes (default 10) whose chosen option or reason shares 2+
    content words with the item, heard against withheld (the holdout's contrast), pooled and by member;
  - response time: from a checked shortage told to the first choice by a hearer that answers it (the item's words in the
    chosen option);
  - questions: asked, to anyone, answered, failed, withheld; who is asked (counts, the top's share, HHI); answer latency;
    the asker's next decision acting on the answer (as for news);
  - deliberation: ballots that were shown earlier reasons; per item, the share of voters siding with the majority of the
    votes cast before them (a cascade index), and the margins.
"""
import argparse
import json
import re
from collections import Counter, defaultdict

STOP = set("the a an and or of to in on for with is are was were be been it its this that there here you your our we us i me my he she they them his her their at by from as not no but so if then than too very can could will would should may might just now more most some any all each every have has had do does did get got make made".split())


def words(t):
    out = set()
    for w in re.split(r"[^a-z]+", (t or "").lower()):
        if len(w) < 3 or w in STOP:
            continue
        out.add(re.sub(r"(ing|ed|es|s)$", "", w) or w)
    return out


def hhi(c):
    t = sum(c.values())
    return sum((q / t) ** 2 for q in c.values()) if t else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("acts")
    ap.add_argument("--village")
    ap.add_argument("--window", type=float, default=10)
    a = ap.parse_args()
    W = a.window * 60000
    recs = []
    with open(a.acts, encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if a.village and r.get("village") not in (None, a.village):
                continue
            recs.append(r)
    recs.sort(key=lambda r: int(r.get("t", 0)))
    decisions = defaultdict(list)
    for r in recs:
        if r.get("type") == "decision" and r.get("choice"):
            decisions[r["agent"]].append(r)

    def next_dec(agent, t):
        for d in decisions.get(agent, []):
            if t < int(d["t"]) <= t + W:
                return d
        return None

    def acted(agent, t, ws):
        d = next_dec(agent, t)
        if not d:
            return None
        return len(ws & (words(d.get("choice", "").replace(":", " ").replace("_", " ")) | words(d.get("reason", "")))) >= 2

    # news
    news = [r for r in recs if r.get("type") == "news"]
    made = [r for r in news if r.get("id")]
    dropped = Counter(r.get("dropped") for r in news if r.get("dropped"))
    print(f"== news: {len(made)} made ({sum(1 for r in made if r.get('retellOf'))} retold, {sum(1 for r in made if 'withheld' in r)} withheld), {sum(dropped.values())} dropped" + (f" ({', '.join(f'{k} {n}' for k, n in dropped.most_common())})" if dropped else ""))
    if made:
        hearers = [len(r.get("hearers") or []) for r in made if "hearers" in r]
        tags = Counter(r.get("tag") for r in made)
        print(f"hearers a delivered item {sum(hearers) / max(1, len(hearers)):.1f}; tags {dict(tags)}")
        ref = set()
        for r in made:
            if r.get("tag") == "refuted":
                ref.update(r.get("hearers") or [])
        print(f"falsehood reach: {len(ref)} members heard a refuted claim ({sum(1 for r in made if r.get('tag') == 'refuted')} refuted items)")
        # diffusion by first item (a retelling carries its retellOf)
        holders = defaultdict(dict)
        for r in made:
            root = r.get("retellOf") or r["id"]
            for h in r.get("hearers") or []:
                holders[root].setdefault(h, int(r["t"]))
        t0 = {r["id"]: int(r["t"]) for r in made if not r.get("retellOf")}
        rows = []
        for root, hs in holders.items():
            if root not in t0:
                continue
            rows.append([sum(1 for t in hs.values() if t - t0[root] <= m * 60000) for m in (5, 10, 20)])
        if rows:
            print("diffusion (members holding an item at +5/+10/+20 min, mean): " + "/".join(f"{sum(x[i] for x in rows) / len(rows):.1f}" for i in range(3)) + f" over {len(rows)} items; reached by a retelling: {sum(1 for r in made if r.get('retellOf') and r.get('hearers'))}")
        # acted on: heard against withheld
        arms = {"heard": [], "withheld": []}
        by = defaultdict(lambda: {"heard": [0, 0], "withheld": [0, 0]})
        for r in made:
            ws = words(r.get("text"))
            for arm, key in (("heard", "hearers"), ("withheld", "withheld")):
                for h in r.get(key) or []:
                    x = acted(h, int(r["t"]), ws)
                    if x is None:
                        continue
                    arms[arm].append(x)
                    by[h][arm][0] += x
                    by[h][arm][1] += 1
        print("acted on within %g min: " % a.window + ", ".join(f"{k} {sum(v)}/{len(v)} ({sum(v) / len(v):.0%})" if v else f"{k} -" for k, v in arms.items()))
        both = [(m, x) for m, x in by.items() if x["heard"][1] and x["withheld"][1]]
        if both:
            d = [x["heard"][0] / x["heard"][1] - x["withheld"][0] / x["withheld"][1] for _, x in both]
            print(f"  by member ({len(both)} with both): mean heard - withheld {sum(d) / len(d):+.2f}, heard higher in {sum(1 for x in d if x > 0)}, lower in {sum(1 for x in d if x < 0)}")
        # response time to a checked shortage
        rt = []
        for r in made:
            if r.get("tag") != "checked" or r.get("retellOf"):
                continue
            ws = words(r.get("text"))
            best = None
            for h in r.get("hearers") or []:
                for d in decisions.get(h, []):
                    if int(d["t"]) > int(r["t"]) and len(ws & words(d.get("choice", "").replace(":", " ").replace("_", " "))) >= 1:
                        best = min(best or 1e18, int(d["t"]) - int(r["t"]))
                        break
            if best is not None:
                rt.append(best / 60000)
        if rt:
            rt.sort()
            print(f"response to a checked shortage: {len(rt)} answered by a hearer's choice, median {rt[len(rt) // 2]:.1f} min")

    # questions
    qs = [r for r in recs if r.get("type") == "question"]
    asked = [r for r in qs if r.get("id")]
    ans = [r for r in recs if r.get("type") == "answer"]
    got = {r["id"]: r for r in ans if r.get("text")}
    failed = Counter(r.get("failed") for r in ans if r.get("failed"))
    print(f"== questions: {len(asked)} asked ({sum(1 for r in asked if r.get('anyone'))} to anyone), {sum(1 for r in qs if r.get('dropped'))} dropped; answers {len(got)} ({sum(1 for r in got.values() if r.get('withheld'))} withheld), failed {sum(failed.values())}" + (f" ({dict(failed)})" if failed else ""))
    if asked:
        to = Counter(r["to"] for r in asked)
        top, n = to.most_common(1)[0]
        print(f"who is asked: {len(to)} members, top {top} {n} ({n / len(asked):.0%}), HHI {hhi(to):.2f}: " + ", ".join(f"{k} {v}" for k, v in to.most_common(8)))
        lat = sorted((int(got[r["id"]]["t"]) - int(r["t"])) / 1000 for r in asked if r["id"] in got)
        if lat:
            print(f"answer latency: median {lat[len(lat) // 2]:.0f} s, max {lat[-1]:.0f} s")
        arms = {"shown": [], "withheld": []}
        for r in asked:
            x = got.get(r["id"])
            if not x:
                continue
            v = acted(r["agent"], int(x["t"]), words(x.get("text")) | words(r.get("text")))
            if v is not None:
                arms["withheld" if x.get("withheld") else "shown"].append(v)
        print("asker acted on the answer: " + ", ".join(f"{k} {sum(v)}/{len(v)}" if v else f"{k} -" for k, v in arms.items()))
        for r in asked[:4]:
            x = got.get(r["id"])
            print(f"  {r['agent']} -> {r['to']}: {r.get('text', '')[:70]} | {(x or {}).get('text', '(none)')[:110]}")

    # deliberation
    ballots = [r for r in recs if r.get("type") == "ballot" and r.get("votes")]
    if ballots:
        shown = [b for b in ballots if (b.get("heard") or 0) > 0]
        print(f"== ballots: {len(ballots)}, {len(shown)} shown earlier reasons (mean {sum(b['heard'] for b in shown) / max(1, len(shown)):.1f} lines)")
        byday = defaultdict(list)
        for b in ballots:
            byday[b.get("day")].append(b)
        with_major, n = 0, 0
        for day, bs in byday.items():
            items = {i for b in bs for i in b["votes"]}
            for it in items:
                seen = Counter()
                for b in bs:
                    v = b["votes"].get(it)
                    if v in (None, "abstain"):
                        continue
                    if seen:
                        maj, k = seen.most_common(1)[0]
                        if k > sum(seen.values()) - k:
                            n += 1
                            with_major += v == maj
                    seen[v] += 1
                tot = sum(seen.values())
                if tot:
                    (w, k) = seen.most_common(1)[0]
                    print(f"  day {day} {it}: {dict(seen)} (margin {k / tot:.0%} for {w})")
        if n:
            print(f"cascade index: {with_major}/{n} later votes sided with the earlier majority ({with_major / n:.0%})")


if __name__ == "__main__":
    main()
