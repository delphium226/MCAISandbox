"""The prompt audit (G2, PLAN E.8; the spec's 1.4): reads a run's acts ledger (NAME.acts.jsonl: every decision's and
reflection's full prompt) and fails the run on a leak.

  - Any arm: a role label ("you have become", "the village's <role noun>") outside the fixed template, unless the run
    showed roles (--roles: E.8's condition (e)); role-adjacent profile kinds ("seen mostly ...") are counted, not failed.
  - --arm off: any other member's name in any prompt ("the Mayor" is a role word and allowed), or the others' activity
    (the others' line, the awareness block, "on it:", "helping:"), or an inbox, acts or a line said.

Usage: python scripts/checks/prompt_audit.py RUN.acts.jsonl [--arm on|off|countsonly|noblock|legacy] [--roles]
Exit 1 on a leak; prints counts and the first few leaks.
"""
import json, re, sys

ROLE_NOUNS = ["harvester", "farm starter", "annex builder", "herder", "baker", "miner", "explorer", "works builder", "maker", "gatherer",
              "lamplighter", "furnisher", "builder of projects", "helper", "craftsperson", "house builder", "trader", "inventor"]
TEMPLATE = re.compile(r"You have become the village's (" + "|".join(map(re.escape, ROLE_NOUNS)) + r"|[a-z' ]+ hand)\.")


def main():
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        sys.exit(2)
    path = argv[0]
    arm = argv[argv.index("--arm") + 1] if "--arm" in argv else "on"
    roles = "--roles" in argv
    recs = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    prompts = [(r.get("type"), r.get("agent"), r.get("prompt") or "") for r in recs if r.get("type") in ("decision", "reflect") and r.get("prompt")]
    names = sorted({r.get("agent") for r in recs if r.get("agent")} - {"Mayor"})
    leaks = []
    adjacent = 0
    for kind, agent, p in prompts:
        bare = TEMPLATE.sub("", p) if roles else p
        if re.search(r"you have become", bare, re.I) or re.search(r"the village's (" + "|".join(map(re.escape, ROLE_NOUNS)) + r")\b", bare):
            leaks.append((kind, agent, "role label"))
        adjacent += len(re.findall(r"seen mostly ", p))
        if arm == "off":
            text = re.sub(r"\bthe Mayor\b", "", p, flags=re.I)
            for n in names:
                if n != agent and re.search(rf"\b{re.escape(n)}\b", text):
                    leaks.append((kind, agent, f"names {n}"))
                    break
            if re.search(r"Others now|What the others are doing|on it:|helping:|Your inbox:|You may add one act|said:", text):
                leaks.append((kind, agent, "others' activity or acts"))
    print(f"prompt_audit {path} (arm {arm}{', roles shown' if roles else ''}): {len(prompts)} prompts, {len(leaks)} leaks, {adjacent} role-adjacent profile lines")
    for l in leaks[:8]:
        print(f"  {l[0]} {l[1]}: {l[2]}")
    sys.exit(1 if leaks else 0)


if __name__ == "__main__":
    main()
