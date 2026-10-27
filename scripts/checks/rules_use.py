"""G3's rules in a run, from its ledgers (NAME.acts.jsonl, NAME.choices.jsonl): laws proposed (refused, by type), backing,
the council's meetings (agenda, ballots cast, yes share, results), rules enacted, refusals by rule and member (the measure of
a code-enforced rule's pressure), and duties kept: for each duty in force, the share of member-days after its enactment on
which the member did the kind (from the decision log, village days from the clock's records). #164: the typed share of
laws, backs counted by a failure, repeals, and customs (members doing one by day, seeded apart); `summary()` gives
run_report.py its rows (train 7's report grepped the agent log for laws, which go only to the acts ledger: F330).

Usage: python scripts/checks/rules_use.py DIR/NAME
"""
import json, os, re, sys
from collections import Counter, defaultdict


def load(base):
    """The run's acts and choices ledgers (base: DIR/NAME, or either ledger's or the log's path); [] where missing."""
    base = re.sub(r"\.(acts|choices)\.jsonl$|\.log$", "", base)
    def rows(p):
        return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()] if os.path.exists(p) else []
    return rows(f"{base}.acts.jsonl"), rows(f"{base}.choices.jsonl")


def summary(acts):
    """#164's rows for run_report.py: laws (typed share), ballots and rules passed, compliance, repeals, customs. {} when
    the run has no council or custom records."""
    laws = [a for a in acts if a.get("type") == "law" and a.get("id") and not a.get("op")]
    ballots = [a for a in acts if a.get("type") == "ballot"]
    customs = [a for a in acts if a.get("type") == "custom" and a.get("op") == "did"]
    if not laws and not ballots and not customs:
        return {}
    r = {}
    typed = sum(1 for a in laws if a.get("rule") != "norm")
    r["laws (typed)"] = f"{len(laws)} ({typed / max(1, len(laws)):.0%} typed)"
    backs = [a for a in acts if a.get("type") == "law" and a.get("op") == "back"]
    counted = [a for a in backs if a.get("counted", True)]
    r["backs counted (by a failure)"] = f"{len(counted)} of {len(backs)} ({sum(1 for a in counted if a.get('by') == 'failure')})"
    enacted = [a for a in acts if a.get("type") == "rule" and a.get("op") == "enacted"]
    r["rules passed"] = ", ".join(f"{a.get('rule')} {a.get('id')}" for a in enacted) or "none"
    ltype = {a["id"]: a.get("rule") for a in laws}
    yes = defaultdict(Counter)
    for b in ballots:
        for k, v in (b.get("votes") or {}).items():
            if k in ltype:
                yes["norm" if ltype[k] == "norm" else "typed"][v] += 1
    r["yes: norms / typed"] = " / ".join(f"{yes[t]['yes'] / max(1, yes[t]['yes'] + yes[t]['no']):.0%}" if yes[t] else "-" for t in ("norm", "typed"))
    days = [a for a in acts if a.get("type") == "compliance" and a.get("op") == "day"]
    comp = []
    for rid in sorted({a["rule"] for a in days}):
        ds = [a for a in days if a["rule"] == rid]
        comp.append(f"{rid} {sum(1 for a in ds if a.get('met')) / len(ds):.0%}")
    if comp:
        r["compliance by rule"] = ", ".join(comp)
    rep = [a for a in acts if a.get("type") == "law" and a.get("rule") == "repeal" and not a.get("op")]
    gone = [a for a in acts if a.get("type") == "rule" and a.get("op") == "repealed"]
    if rep or gone:
        r["repeals proposed / passed"] = f"{len(rep)} / {len(gone)}"
    if customs:
        by = defaultdict(set)
        for a in customs:
            if not a.get("seeded"):
                by[a.get("custom")].add(a.get("agent"))
        r["customs: non-seeded members"] = ", ".join(f"{c} {len(m)}" for c, m in by.items()) or "0"
    return r


def main():
    acts, choices = load(sys.argv[1] if len(sys.argv) > 1 else "")
    if not acts:
        raise SystemExit(__doc__)
    out = []
    laws = [a for a in acts if a.get("type") == "law" and a.get("id") and not a.get("op")]
    ops = Counter((a.get("op"), a.get("counted", True)) for a in acts if a.get("type") == "law" and a.get("op"))
    out.append(f"LAWS proposed {len(laws)} by {len({a['agent'] for a in laws})} members; by type {dict(Counter(a.get('rule') for a in laws))}; refused {sum(1 for a in laws if a.get('status') == 'refused')} {dict(Counter(a.get('refused') for a in laws if a.get('refused')))}")
    # (10-23: the same rule proposed again joins the open one; a member's second open law is held)
    joined = [a for a in acts if a.get("type") == "law" and a.get("op") == "joined"]
    held = [a for a in acts if a.get("type") == "law" and a.get("op") == "held"]
    nights = [a for a in acts if a.get("type") == "reflect" and not a.get("error") and not a.get("skipped")]
    out.append(f"NIGHTS {len(nights)} reflections; a law written (new, joined or held) on {len(laws) + len(joined) + len(held)}; joined an open law {len(joined)} {dict(Counter(a.get('id') for a in joined))}; held {len(held)}")
    backing = {(k if c else f"{k} (not counted)"): n for (k, c), n in ops.items()}
    out.append(f"BACKING {backing}")
    for a in laws[:4]:
        out.append(f"  e.g. {a['agent']}: {a.get('text') or a.get('params')} ({a.get('status')})")
    meets = [a for a in acts if a.get("type") == "meeting"]
    ballots = [a for a in acts if a.get("type") == "ballot"]
    votes = Counter(v for b in ballots for v in (b.get("votes") or {}).values())
    out.append(f"COUNCIL meetings with an agenda {sum(1 for m in meets if m.get('op') == 'agenda')}; ballots {len(ballots)} (failed or skipped {sum(1 for b in ballots if b.get('error') or b.get('skipped'))}); votes {dict(votes)}; yes share {votes['yes'] / max(1, votes['yes'] + votes['no']):.0%}")
    # (yes share by rule type: each law's type from its proposal record)
    ltype = {a["id"]: a.get("rule") for a in laws}
    by_type = defaultdict(Counter)
    for b in ballots:
        for k, v in (b.get("votes") or {}).items():
            by_type[ltype.get(k, "need" if k.startswith("need:") else "?")][v] += 1
    out.append("  yes share by type: " + ", ".join(f"{t} {c['yes'] / max(1, c['yes'] + c['no']):.0%} of {c['yes'] + c['no']}" for t, c in by_type.items() if t != "need"))
    for m in [m for m in meets if m.get("op") == "tally"]:
        res = ", ".join(("%s chose %s %s" % (k, r.get("winner") or "none", r.get("counts"))) if "counts" in r else "%s %s %d-%d" % (k, "passed" if r["passed"] else "failed", r["yes"], r["no"]) for k, r in (m.get("result") or {}).items())
        out.append(f"  day {m['day']}: present {m.get('present')}, cast {m.get('cast')}: {res}")
    enacted = [a for a in acts if a.get("type") == "rule" and a.get("op") == "enacted"]
    en = "; ".join("%s %s (%s-%s)" % (a["id"], a.get("text"), a.get("votes", {}).get("yes"), a.get("votes", {}).get("no")) for a in enacted) or "none"
    out.append(f"RULES enacted {len(enacted)}: {en}")
    comp = [a for a in acts if a.get("type") == "compliance" and a.get("op") == "refused"]
    out.append(f"REFUSALS by a rule {len(comp)} ({len({a['agent'] for a in comp})} members): {dict(Counter(a.get('why', '').split(':')[0] for a in comp))}")
    for a in comp[:3]:
        out.append(f"  e.g. {a['agent']}: {a.get('option')} refused, {a.get('why')}")
    nv = [a for a in acts if a.get("type") == "rule" and a.get("op") == "need vote"]
    if nv:
        out.append(f"NEED VOTES {len(nv)}: " + "; ".join(f"{a.get('need')}: {a.get('name')} {a.get('counts')}" for a in nv))
    # Compliance by member-day (code's judgement at the next dawn: a duty's kind done, a contribution's goods put)
    days = [a for a in acts if a.get("type") == "compliance" and a.get("op") == "day"]
    for rid in sorted({a["rule"] for a in days}):
        ds = [a for a in days if a["rule"] == rid]
        met = sum(1 for a in ds if a.get("met"))
        text = next((e.get("text") for e in enacted if e.get("id") == rid), rid)
        by_day = Counter((a["day"], bool(a.get("met"))) for a in ds)
        per = ", ".join(f"day {d} {by_day[(d, True)]}/{by_day[(d, True)] + by_day[(d, False)]}" for d in sorted({a['day'] for a in ds}))
        out.append(f"COMPLIANCE {rid} ({text}): met on {met} of {len(ds)} member-days ({met / max(1, len(ds)):.0%}); {per}")
    # A rule's tag on menus (a duty, a contribution, a need vote's winner): menus that showed one, and choices of it
    shown, taken = Counter(), Counter()
    for c in choices:
        if c.get("type") != "choice":
            continue
        opts = c.get("options") or []
        for t in {o.get("ruleTag") for o in opts if o.get("ruleTag")}:
            shown[t] += 1
        pick = next((o for o in opts if o.get("key") == c.get("key")), None)
        if pick and pick.get("ruleTag"):
            taken[pick["ruleTag"]] += 1
    for t in shown:
        out.append(f"TAG {t}: on {shown[t]} menus, chosen {taken[t]} ({taken[t] / shown[t]:.0%})")
    # The levy: members' answers on their pending shares (lapsed ones apart, outside the measure)
    lv = [a for a in acts if a.get("type") == "compliance" and a.get("op") == "levy"]
    if lv:
        sp = Counter(a.get("split") for a in lv)
        answered = sum(n for k, n in sp.items() if k != "lapsed")
        paid = sp.get("levy", 0) + sp.get("all", 0)
        left = sum(a.get("left", 0) for a in lv if a.get("split") != "lapsed")
        total = sum(a.get("total", 0) for a in lv if a.get("split") != "lapsed")
        out.append(f"LEVY answers {answered} by {len({a['agent'] for a in lv if a.get('split') != 'lapsed'})} members: {dict(sp)}; P(levy or all) {paid / max(1, answered):.0%}; left {left} of {total} items shared")
    # Duties kept: member-days after enactment with the kind done
    clocks = sorted((a["t"], a["day"]) for a in acts if a.get("type") == "clock")
    def day_at(t):
        d = 0
        for ct, cd in clocks:
            if ct <= t:
                d = cd
        return d
    for a in [a for a in enacted if a.get("rule") == "duty"]:
        kind = a.get("params", {}).get("kind")
        since = day_at(a["t"]) + 1
        done = defaultdict(set)
        members = set()
        for c in choices:
            if c.get("type") != "choice":
                continue
            members.add(c["agent"])
            d = day_at(c["t"])
            if d >= since and c.get("kind") == kind:
                done[d].add(c["agent"])
        days = sorted({day_at(c["t"]) for c in choices if c.get("type") == "choice" and day_at(c["t"]) >= since})
        kept = sum(len(done[d]) for d in days)
        out.append(f"DUTY {kind}: kept on {kept} of {len(days) * len(members)} member-days after day {since - 1}")
    out += [f"#164 {k}: {v}" for k, v in summary(acts).items()]
    print("\n".join(out))


if __name__ == "__main__":
    main()
