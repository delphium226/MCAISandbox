"""What a Claude Code session should know before it starts, in a dozen lines: the branch against origin, uncommitted
work, which servers run (stack.py status), and the first lines of each point of PLAN.md's "Next session starts with".

Usage: python scripts/session_start.py
Run by the SessionStart hook in .claude/settings.json (its output goes into the session's context); fine by hand too.
Never fails: a part that cannot be read says so and the rest still prints.
"""
import os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def git(*args):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=20)
    return r.stdout.rstrip() if r.returncode == 0 else ""


def git_lines():
    branch = git("rev-parse", "--abbrev-ref", "HEAD") or "?"
    head = git("log", "-1", "--format=%h %s")[:100]
    out = [f"git: {branch} at {head}"]
    counts = git("rev-list", "--left-right", "--count", f"origin/{branch}...HEAD")
    if counts:
        behind, ahead = counts.split()
        out[0] += "; origin: " + ("equal" if behind == ahead == "0" else f"{ahead} ahead, {behind} behind")
    changed = [l for l in git("status", "--porcelain").splitlines() if l.strip()]
    out.append(f"git: {'clean tree' if not changed else str(len(changed)) + ' changed: ' + ', '.join(l[3:] for l in changed[:8])}"
               + (" ..." if len(changed) > 8 else ""))
    return out


def stack_lines():
    r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "stack.py"), "status"], cwd=ROOT, capture_output=True,
                       text=True, timeout=30)
    return ["stack: " + l for l in r.stdout.splitlines() if l.strip()] or [f"stack: status failed ({r.stderr.strip()[-200:]})"]


def handover_lines(per_point=2):
    text = open(os.path.join(ROOT, "docs", "PLAN.md"), encoding="utf-8").read()
    m = re.search(r"^## Next session starts with\n(.*?)(?=^## )", text, re.M | re.S)
    if not m:
        return ["handover: no \"Next session starts with\" in docs/PLAN.md"]
    out = ['handover (docs/PLAN.md "Next session starts with": read it whole; the first lines of each point):']
    lines, n = m.group(1).splitlines(), 0
    for l in lines:
        if l.startswith("("):
            out.append("  " + l)
        elif l.startswith("- ") or re.match(r"\s+\d+\. ", l):
            n = 0
        if (l.startswith("- ") or re.match(r"\s+\d+\. ", l) or (l.startswith("  ") and n)) and n < per_point:
            out.append("  " + l.strip()[:160])
            n += 1
    return out


def main():
    print("MCAISandbox session start (scripts/session_start.py, the SessionStart hook)")
    for part in (git_lines, stack_lines, handover_lines):
        try:
            for line in part():
                print(line)
        except Exception as e:
            print(f"{part.__name__}: failed ({e.__class__.__name__}: {e})")


if __name__ == "__main__":
    main()
