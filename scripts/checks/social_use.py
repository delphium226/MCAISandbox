"""G2's behaviour in a run, from its ledgers (NAME.acts.jsonl and NAME.choices.jsonl): what the brief judges G2 by.

  - Profiles: decisions whose prompt showed profile lines, lines with facts beyond sight (helped, kept, broke, heard), and
    reasons that name another member.
  - Acts: proposed by the model (each type) and the validator's verdicts; acts delivered per member-hour against model
    decisions per member-hour.
  - Requests: made, taken up (accepted by choosing the tagged option), and their promises kept, broken or moot; offers;
    the share of tagged options chosen when shown.
  - A broken promise changing a later choice: after a member learned that X broke a promise (to it, or by a report), the
    later decisions where it was shown X's request or a help option for X's project: how often it chose them, against the
    same members' choices of other members' requests and projects.
  - Roles: role changes, the modal kind's persistence (spec_index.py's measures), distinct roles at the end.
  - Lines said: delivered, dropped off-topic or as unbacked promises; promises read from a line.
  - Memory quality (#86): note merges and refusals by reason.

Usage: python scripts/checks/social_use.py DIR/NAME   (DIR/NAME.acts.jsonl and DIR/NAME.choices.jsonl)
"""
import json, os, re, sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from spec_index import load, persistence, index  # noqa: E402


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else ""
    base = re.sub(r"\.(acts|choices)\.jsonl$|\.log$", "", base)
    acts = [json.loads(l) for l in open(f"{base}.acts.jsonl", encoding="utf-8") if l.strip()]
    choices = [json.loads(l) for l in open(f"{base}.choices.jsonl", encoding="utf-8") if l.strip()]
    ch = [c for c in choices if c.get("type") == "choice"]
    names = sorted({c["agent"] for c in ch})
    t0 = min(c["t"] for c in ch) if ch else 0
    t1 = max(c["t"] for c in ch) if ch else 0
    hours = max(1e-9, (t1 - t0) / 3600000)
    model = [c for c in ch if c.get("source") in ("model", "scripted")]
    out = []
    say = out.append

    # Run validity (E.8): the fallback share of model-mode decisions
    fb = [c for c in ch if c.get("source") == "fallback" and c.get("why") in ("timeout", "error", "invalid", "queue", "withdrawn", "budget")]
    say(f"VALIDITY model decisions {len(model)}, fallbacks {len(fb)} ({Counter(c.get('why') for c in fb)}): share {len(fb) / max(1, len(model) + len(fb)):.1%} (void over 5%)")

    # Profiles
    dec = [a for a in acts if a.get("type") == "decision" and a.get("prompt")]
    shown = [d for d in dec if re.search(r"^- \w+: (seen mostly|not seen at work)", d["prompt"], re.M)]
    deep = [d for d in dec if re.search(r"^- \w+: .*(helped you|you helped|promise|others say)", d["prompt"], re.M)]
    named = [c for c in model if any(n != c["agent"] and re.search(rf"\b{n}\b", c.get("reason", "")) for n in names if n != "Mayor")]
    say(f"PROFILES decisions showing profiles {len(shown)}/{len(dec)}; with facts beyond sight (helped, promises, heard) {len(deep)}; model reasons naming another member {len(named)}/{len(model)}")
    for c in named[:4]:
        say(f"  e.g. {c['agent']} chose {c.get('chosen')}: {c.get('reason', '')[:150]}")

    # Acts
    av = Counter((a.get("act"), a.get("verdict")) for a in acts if a.get("type") == "act")
    why = Counter(a.get("why") for a in acts if a.get("type") == "act" and a.get("verdict") == "refused")
    delivered = sum(n for (k, v), n in av.items() if v == "ok")
    say(f"ACTS {dict(sorted(((f'{k}:{v}', n) for (k, v), n in av.items())))}")
    say(f"ACTS delivered {delivered} = {delivered / len(names) / hours:.2f} per member-hour; model decisions {len(model)} = {len(model) / len(names) / hours:.2f} per member-hour")
    if why:
        say(f"ACTS refused by reason: {dict(why.most_common(8))}")

    # Requests and promises
    reqs = [a for a in acts if a.get("type") == "act" and a.get("act") == "request" and a.get("verdict") == "ok"]
    com = defaultdict(dict)
    for a in acts:
        if a.get("type") == "commitment":
            com[a["id"]][a["op"]] = a
    made = [c for c in com.values() if "made" in c]
    how = Counter(re.sub(r" r\d+", "", c["made"].get("how", "")) for c in made)
    states = Counter(next((op for op in ("kept", "broken", "released", "moot") if op in c), "open") for c in made)
    accepted = [c for c in made if c["made"].get("how", "").startswith("accepted")]
    met = [c for c in accepted if "kept" in c]
    say(f"REQUESTS made {len(reqs)} (to anyone {sum(1 for r in reqs if r.get('to') == 'anyone')}); taken up {len(accepted)}; met (kept) {len(met)}")
    say(f"PROMISES made {len(made)} by {dict(how)}; closed {dict(states)}")
    tagged = [c for c in ch if any(o.get("social") for o in c.get("options", []))]
    took = [c for c in tagged if next((o for o in c["options"] if o.get("id") == c.get("chosen")), {}).get("social")]
    say(f"TAGGED menus with a request or promise tag {len(tagged)}; the tagged option chosen {len(took)}")
    for c in met[:3]:
        m = c["made"]
        say(f"  e.g. {m['from']} -> {m['to']}: {m.get('words')} ({m['id']}), kept: {c['kept'].get('evidence')}")

    # A broken promise and later choices
    learned = defaultdict(dict)  # hearer -> breaker -> when
    for c in made:
        if "broken" in c:
            b = c["broken"]
            learned[b["to"]].setdefault(b["from"], b["t"])
    for a in acts:
        if a.get("type") == "act" and a.get("act") == "report" and a.get("verdict") == "ok" and a.get("claim") == "broken":
            for h in a.get("hearers", []):
                learned[h].setdefault(a["about"], a["t"])
    after_b = after_o = chose_b = chose_o = 0
    examples = []
    for c in model:
        lb = learned.get(c["agent"], {})
        for o in c.get("options", []):
            owner = None
            m = re.match(r"Help (\w+) build", o.get("name", ""))
            if m:
                owner = m.group(1)
            m2 = re.search(r"\[(\w+) asked you\]", o.get("social", "") or "")
            if m2:
                owner = m2.group(1)
            if not owner or owner == c["agent"]:
                continue
            if owner in lb and lb[owner] < c["t"]:
                after_b += 1
                chose_b += o.get("id") == c.get("chosen")
                if len(examples) < 3:
                    examples.append(f"{c['agent']} (knew {owner} broke a promise) was shown {o['name'][:60]}: {'chose it' if o.get('id') == c.get('chosen') else 'chose ' + str(c.get('chosen'))}: {c.get('reason', '')[:110]}")
            else:
                after_o += 1
                chose_o += o.get("id") == c.get("chosen")
    say(f"BROKEN members who learned a breaker {len(learned)}; shown the breaker's request or project {after_b} times, chose it {chose_b}; others' requests and projects shown {after_o} times, chosen {chose_o}")
    for e in examples:
        say(f"  e.g. {e}")

    # Roles
    roles = [a for a in acts if a.get("type") == "role"]
    ds = load(f"{base}.choices.jsonl", "any", 0)
    p = persistence(ds)
    r = index(ds, 200, 600000, 1)
    say(f"ROLES role changes {len(roles)} by {len({a['agent'] for a in roles})} members; persistence {p['held']} over {p['windows']} window pairs; roles at the end {p['roles']} {p['role_counts']}; specialisation index {r['index']} (raw {r['raw']}, null p {r['p_null']})")

    # Lines said
    sv = Counter("said" if not a.get("dropped") else a["dropped"] for a in acts if a.get("type") == "say")
    asoffer = sum(1 for c in made if c["made"].get("how") == "said")
    say(f"SAY {dict(sv)}; promises read from a line {asoffer}")
    for a in [a for a in acts if a.get("type") == "say" and not a.get("dropped")][:3]:
        say(f"  e.g. {a['agent']}: \"{a['text']}\" (heard by {len(a.get('hearers', []))})")

    # Memory quality
    mq = Counter(a.get("op") for a in acts if a.get("type") == "memory")
    rw = Counter(a.get("why") for a in acts if a.get("type") == "memory" and a.get("op") == "refused")
    prof = [a for a in acts if a.get("type") == "profile"]
    say(f"MEMORY {dict(mq)}; refused by reason {dict(rw)}; night profile edits {len(prof)}")
    for a in prof[:3]:
        say(f"  e.g. {a['agent']} on {a['of']}: feel {a.get('feel')}, \"{a.get('note', '')}\"")
    print("\n".join(out))


if __name__ == "__main__":
    main()
