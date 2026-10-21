"""
Whether members' choices used what they remembered (G1, #26): read a run's acts.jsonl (and its choices.jsonl beside it)
and count, by code.

  python scripts/checks/memory_use.py RUN            (RUN.acts.jsonl and RUN.choices.jsonl; e.g. runs/.../g1run/G1a)
  [--min-age 20] [--examples 12] [--perms 2000]

- Shown: model decisions whose prompt showed a note or an intention written at least --min-age minutes earlier.
- Cited: of those, the reasons that share 3+ content words (5+ letters, not words of the option chosen) with a note or the
  intention shown, or that name memory ("remember", "earlier", "yesterday", "intention", "planned", "as I noted"...).
- Intention followed: for each member-day with an intention and a focus, the share of that day's model choices whose kind
  is the focus; against a permutation baseline (focuses shuffled across member-days, --perms times).
- Writing: notes per model decision by hour, adds, replaces, evictions, drops; reflections, their notes and intentions.
- Examples of each, quoted.
"""
import argparse, collections, json, pathlib, random, re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

p = argparse.ArgumentParser()
p.add_argument("run")
p.add_argument("--min-age", type=float, default=20)
p.add_argument("--examples", type=int, default=12)
p.add_argument("--perms", type=int, default=2000)
args = p.parse_args()
base = pathlib.Path(args.run)
acts = [json.loads(l) for l in open(f"{base}.acts.jsonl", encoding="utf-8") if l.strip()]
choices = {}
cf = pathlib.Path(f"{base}.choices.jsonl")
if cf.exists():
    for l in open(cf, encoding="utf-8"):
        r = json.loads(l)
        if r.get("type") == "choice":
            choices[r["id"]] = r

# The kinds in words (memory.ts' KIND_WORDS)
KIND_WORDS = {"farm": "harvesting", "slot": "harvesting", "start": "starting farms", "annex": "preparing the annex", "pen": "leading animals",
              "penwork": "tending pens", "cake": "baking", "iron": "digging for iron", "explore": "exploring", "works": "setting up the works",
              "make": "making goods", "gather": "gathering", "light": "lighting", "furnish": "furnishing", "initiate": "own projects",
              "help": "helping others' projects", "activity": "new crafts", "grow": "laying out houses", "eat": "eating", "tidy": "tidying",
              "own": "own goods", "innovate": "innovating"}
kind_of = lambda opt: (opt or "").split(":")[0]
STOP = set("their there which would could should about these those other others while being where today village member members still small spare needed needs works helps using".split())
words = lambda s: {w for w in re.findall(r"[a-z]{5,}", (s or "").lower()) if w not in STOP}
MEMORY_WORDS = re.compile(r"\b(remember|recall|earlier|yesterday|last time|last night|intention|intend|planned|my plan|as i noted|noted|note|today i|my focus|focus on|i said|i meant)\b", re.I)

t0 = min(r["t"] for r in acts)
notes = {}  # (agent, id) -> (text, t)
intentions = {}  # (agent, day) -> (text, focus, t, by)
for r in acts:
    if r["type"] == "memory" and r.get("op") in ("add", "replace"):
        notes[(r["agent"], r["id"])] = (r["text"], r["t"])
    if r["type"] == "intention":
        intentions[(r["agent"], r["day"])] = (r["text"], r.get("focus"), r["t"], r.get("by"))

decs = [r for r in acts if r["type"] == "decision" and r.get("choice")]
age_ms = args.min_age * 60000
shown_old, cited, cited_named, ex_cite = [], [], [], []
for d in decs:
    old = []
    for m in d.get("memory", []):
        if re.fullmatch(r"n\d+", m) and (d["agent"], m) in notes and d["t"] - notes[(d["agent"], m)][1] >= age_ms:
            old.append(("note", m, notes[(d["agent"], m)][0]))
        if m == "intention":
            # (the intention shown is today's, or the last one)
            cands = [(k, v) for k, v in intentions.items() if k[0] == d["agent"] and v[2] <= d["t"]]
            if cands:
                k, v = max(cands, key=lambda kv: kv[1][2])
                if d["t"] - v[2] >= age_ms:
                    old.append(("intention", f"day {k[1]}", v[0]))
    if not old:
        continue
    shown_old.append(d)
    chosen = choices.get(d["decisionId"], {})
    opt_words = set()
    for o in chosen.get("options", []):
        if o.get("id") == d["choice"]:
            opt_words = words(o.get("name", "") + " " + o.get("facts", ""))
    rw = words(d.get("reason", "")) - opt_words
    hit = [(k, i, txt) for k, i, txt in old if len(rw & (words(txt) - opt_words)) >= 3]
    named = bool(MEMORY_WORDS.search(d.get("reason", "")))
    if hit or named:
        cited.append(d)
        if named:
            cited_named.append(d)
        if len(ex_cite) < args.examples and hit:
            ex_cite.append(f"{(d['t'] - t0) / 60000:5.1f}m {d['agent']}: chose {d['choice']}: \"{d['reason']}\" <- {hit[0][0]} {hit[0][1]}: \"{hit[0][2]}\"")

# Intention followed
days = collections.defaultdict(list)
for d in decs:
    if d.get("day"):
        days[(d["agent"], d["day"])].append(KIND_WORDS.get(kind_of(d["choice"]), kind_of(d["choice"])))
pairs = [(intentions[k][1], v) for k, v in days.items() if k in intentions and intentions[k][1]]
share = lambda ps: sum(sum(1 for x in ks if x == f) for f, ks in ps) / max(1, sum(len(ks) for _, ks in ps))
followed = share(pairs)
rng = random.Random(7)
foc = [f for f, _ in pairs]
perm = []
for _ in range(args.perms):
    rng.shuffle(foc)
    perm.append(share([(f, ks) for f, (_, ks) in zip(foc, pairs)]))
perm.sort()
p_value = sum(1 for x in perm if x >= followed) / max(1, len(perm))

# Writing
by_hour = collections.defaultdict(lambda: collections.Counter())
for r in acts:
    h = int((r["t"] - t0) // 3600000)
    if r["type"] == "decision" and r.get("choice"):
        by_hour[h]["decisions"] += 1
        if r.get("remember"):
            by_hour[h]["remember"] += 1
        if r.get("dawn"):
            by_hour[h]["dawn"] += 1
            if r.get("intention"):
                by_hour[h]["dawn_intention"] += 1
    if r["type"] == "memory":
        by_hour[h][r["op"] + ("_night" if r.get("by") == "night" else "")] += 1
    if r["type"] == "reflect":
        by_hour[h]["reflect" + ("_err" if r.get("error") else "_skip" if r.get("skipped") else "")] += 1
refl = [r for r in acts if r["type"] == "reflect" and not r.get("error") and not r.get("skipped")]

print(f"{base.name}: {len(decs)} model decisions with memory in the ledger; {len(notes)} notes written; {len(intentions)} intentions; {len(refl)} reflections")
print(f"SHOWN  decisions whose prompt showed a note or intention >= {args.min_age:g} min old: {len(shown_old)} of {len(decs)} ({100 * len(shown_old) / max(1, len(decs)):.0f}%)")
print(f"CITED  of those, reasons citing it: {len(cited)} ({100 * len(cited) / max(1, len(shown_old)):.0f}%): {len(cited) - len(cited_named)} by shared words only, {len(cited_named)} naming memory")
print(f"FOLLOW member-days with an intention and a focus: {len(pairs)}; their model choices of the focus kind {100 * followed:.0f}% "
      f"against {100 * sum(perm) / max(1, len(perm)):.0f}% with focuses shuffled (p {p_value:.3f}, {args.perms} permutations)")
print("WRITE  by hour: " + "; ".join(f"h{h}: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())) for h, c in sorted(by_hour.items())))
print("EXAMPLES (reason <- what it remembered):")
for e in ex_cite:
    print("  " + e)
print("NOTES (a sample):")
for (a, i), (txt, t) in list(notes.items())[:: max(1, len(notes) // args.examples)][: args.examples]:
    print(f"  {(t - t0) / 60000:5.1f}m {a} {i}: {txt}")
print("INTENTIONS (a sample):")
for (a, dday), (txt, f, t, by) in list(intentions.items())[:: max(1, len(intentions) // 8)][:8]:
    print(f"  day {dday} {a} ({by}, {f}): {txt}")
