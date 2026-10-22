"""Character v2's behaviour in a run (spec section 9 as revised in draft 2), from its decision log (NAME.choices.jsonl),
every measure split by who decided (model, fixed, repeat, only, scripted):

  - identifiability: a member predicted from its picks' kinds (naive Bayes over each member's kind profile, leave one
    decision out), from 1 pick and from blocks of 5, against chance (1 / members);
  - trait-to-choice: the share of picks that are the option the member's character weighs most (`tw`, HEXACO's with
    character on), against the share by chance (1 / menu size);
  - mood and own projects: the share of `initiate` picks in the top and bottom thirds of mood (the mood line's number);
  - agreeableness and requests: the share of shown `[X asked you]` options taken, by agreeableness third;
  - rests: rest picks by member; the character lines' presence.

Usage: python scripts/checks/character_use.py DIR/NAME [DIR/NAME ...]   (several runs side by side)
"""
import json, math, re, sys
from collections import Counter, defaultdict

LEAVE = {"eat", "tidy"}
ROLE = {"slot": "farm"}


def hexaco_a(name):
    """Agreeableness from the server's draw is not readable here: use the identity line's words as a proxy third."""
    return None


def load(base):
    base = re.sub(r"\.(choices|acts)\.jsonl$|\.log$", "", base)
    return [json.loads(l) for l in open(f"{base}.choices.jsonl", encoding="utf-8") if l.strip() and '"type":"choice"' in l]


def ident(decs):
    """Naive Bayes, leave one out: accuracy from 1 pick and from blocks of 5."""
    by = defaultdict(list)
    for d in decs:
        by[d["agent"]].append(d["k"])
    kinds = sorted({d["k"] for d in decs})
    members = [m for m, ks in by.items() if len(ks) >= 3]
    if len(members) < 2:
        return None
    cnt = {m: Counter(by[m]) for m in members}
    tot = {m: len(by[m]) for m in members}

    def score(m, ks, minus):
        c, t = cnt[m], tot[m]
        s = 0.0
        for k in ks:
            s += math.log((c[k] - minus.get(k, 0) + 1) / (t - sum(minus.values()) + len(kinds)))
        return s

    hit1 = n1 = hit5 = n5 = 0
    for m in members:
        ks = by[m]
        for k in ks:
            n1 += 1
            best = max(members, key=lambda x: score(x, [k], {k: 1} if x == m else {}))
            hit1 += best == m
        for i in range(0, len(ks) - 4, 5):
            blk = ks[i:i + 5]
            minus = Counter(blk)
            n5 += 1
            best = max(members, key=lambda x: score(x, blk, minus if x == m else {}))
            hit5 += best == m
    return {"members": len(members), "acc1": round(hit1 / max(1, n1), 3), "acc5": round(hit5 / max(1, n5), 3) if n5 else None, "chance": round(1 / len(members), 3), "n": n1}


def run(base):
    ch = load(base)
    out = {"run": base.split("/")[-1].split("\\")[-1]}
    by_src = defaultdict(list)
    for c in ch:
        k = ROLE.get(c.get("kind"), c.get("kind"))
        if c.get("agent") == "Mayor" or not k or k in LEAVE or not c.get("options"):
            continue
        by_src[c.get("source")].append({**c, "k": k})
    for src in ("model", "fixed", "repeat", "scripted"):
        decs = by_src.get(src, [])
        if not decs:
            continue
        r = {"n": len(decs), "identifiability": ident(decs)}
        # trait-to-choice
        best = chance = n = 0
        for d in decs:
            opts = d["options"]
            if len(opts) < 2 or all(o.get("tw") is None for o in opts):
                continue
            top = max(opts, key=lambda o: o.get("tw", 1))
            n += 1
            best += d.get("chosen") == top["id"]
            chance += 1 / len(opts)
        r["traitPick"] = {"share": round(best / max(1, n), 3), "chance": round(chance / max(1, n), 3), "n": n} if n else None
        # mood and own projects
        moods = []
        for d in decs:
            m = re.search(r"You feel [a-z ]+ \(([+-]?\d+)\)", (d.get("ctx") or {}).get("character", "") or "")
            moods.append((int(m.group(1)) if m else 0, d["k"] == "initiate"))
        if moods:
            s = sorted(moods, key=lambda x: x[0])
            third = max(1, len(s) // 3)
            lo, hi = s[:third], s[-third:]
            r["moodInitiate"] = {"bottomThird": round(sum(x[1] for x in lo) / len(lo), 3), "topThird": round(sum(x[1] for x in hi) / len(hi), 3), "withMoodLine": sum(1 for d in decs if "You feel" in ((d.get("ctx") or {}).get("character") or ""))}
        # requests taken
        shown = taken = 0
        for d in decs:
            for o in d["options"]:
                if re.match(r"\[\w+ asked you\]", o.get("social") or ""):
                    shown += 1
                    taken += d.get("chosen") == o["id"]
        r["requests"] = {"shown": shown, "taken": taken}
        r["rests"] = sum(1 for d in decs if d["k"] == "rest")
        out[src] = r
    out["restsAll"] = Counter(c["agent"] for c in ch if c.get("kind") == "rest")
    out["identityLines"] = sum(1 for c in ch if (c.get("ctx") or {}).get("persona", "").startswith("You are ") and "life goal" in (c.get("ctx") or {}).get("persona", ""))
    return out


def main():
    for b in sys.argv[1:]:
        r = run(b)
        print(f"== {r['run']}: identity lines in {r['identityLines']} decisions; rests {sum(r['restsAll'].values())} by {len(r['restsAll'])} members")
        for src in ("model", "fixed", "repeat", "scripted"):
            if src in r:
                x = r[src]
                print(f"  {src:8} n {x['n']}; identifiability {x['identifiability']}; trait pick {x['traitPick']}; mood -> own projects {x.get('moodInitiate')}; requests {x['requests']}; rests {x['rests']}")


if __name__ == "__main__":
    main()
