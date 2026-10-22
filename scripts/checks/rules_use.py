"""G3's rules in a run, from its ledgers (NAME.acts.jsonl, NAME.choices.jsonl): laws proposed (refused, by type), backing,
the council's meetings (agenda, ballots cast, yes share, results), rules enacted, refusals by rule and member (the measure of
a code-enforced rule's pressure), and duties kept: for each duty in force, the share of member-days after its enactment on
which the member did the kind (from the decision log, village days from the clock's records).

Usage: python scripts/checks/rules_use.py DIR/NAME
"""
import json, re, sys
from collections import Counter, defaultdict


def main():
    base = re.sub(r"\.(acts|choices)\.jsonl$|\.log$", "", sys.argv[1] if len(sys.argv) > 1 else "")
    acts = [json.loads(l) for l in open(f"{base}.acts.jsonl", encoding="utf-8") if l.strip()]
    try:
        choices = [json.loads(l) for l in open(f"{base}.choices.jsonl", encoding="utf-8") if l.strip()]
    except FileNotFoundError:
        choices = []
    out = []
    laws = [a for a in acts if a.get("type") == "law" and a.get("id") and not a.get("op")]
    ops = Counter((a.get("op"), a.get("counted", True)) for a in acts if a.get("type") == "law" and a.get("op"))
    out.append(f"LAWS proposed {len(laws)} by {len({a['agent'] for a in laws})} members; by type {dict(Counter(a.get('rule') for a in laws))}; refused {sum(1 for a in laws if a.get('status') == 'refused')} {dict(Counter(a.get('refused') for a in laws if a.get('refused')))}")
    backing = {(k if c else f"{k} (not counted)"): n for (k, c), n in ops.items()}
    out.append(f"BACKING {backing}")
    for a in laws[:4]:
        out.append(f"  e.g. {a['agent']}: {a.get('text') or a.get('params')} ({a.get('status')})")
    meets = [a for a in acts if a.get("type") == "meeting"]
    ballots = [a for a in acts if a.get("type") == "ballot"]
    votes = Counter(v for b in ballots for v in (b.get("votes") or {}).values())
    out.append(f"COUNCIL meetings with an agenda {sum(1 for m in meets if m.get('op') == 'agenda')}; ballots {len(ballots)} (failed or skipped {sum(1 for b in ballots if b.get('error') or b.get('skipped'))}); votes {dict(votes)}; yes share {votes['yes'] / max(1, votes['yes'] + votes['no']):.0%}")
    for m in [m for m in meets if m.get("op") == "tally"]:
        res = ", ".join("%s %s %d-%d" % (k, "passed" if r["passed"] else "failed", r["yes"], r["no"]) for k, r in (m.get("result") or {}).items())
        out.append(f"  day {m['day']}: present {m.get('present')}, cast {m.get('cast')}: {res}")
    enacted = [a for a in acts if a.get("type") == "rule" and a.get("op") == "enacted"]
    en = "; ".join("%s %s (%s-%s)" % (a["id"], a.get("text"), a.get("votes", {}).get("yes"), a.get("votes", {}).get("no")) for a in enacted) or "none"
    out.append(f"RULES enacted {len(enacted)}: {en}")
    comp = [a for a in acts if a.get("type") == "compliance" and a.get("op") == "refused"]
    out.append(f"REFUSALS by a rule {len(comp)} ({len({a['agent'] for a in comp})} members): {dict(Counter(a.get('why', '').split(':')[0] for a in comp))}")
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
    print("\n".join(out))


if __name__ == "__main__":
    main()
