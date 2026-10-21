"""G6's outer loop, a first form (#16; spec runs/2026-10-21/g6-loop/spec.md 6): one round of "a running village's demand
makes a ticket, the foundry builds it, members take it up", each step's output checked before the next.

  1. demand: a model-driven run on test world 2 with MC_WANTED on (run_series.py, the DEMAND spec), its wanted list
     read from the live agent server while it runs (foundry_queue.py --api, at least --min-samples in the top 3);
  2. ticket: foundry_queue.py --write (it says why it skips what it skips; nothing ticketable ends the round);
  3. foundry: foundry.py TICKET --merge on test world 3 (a candidate that passes every gate merges; anything else ends
     the round with the report's outcome);
  4. take-up: the TAKEUP spec on test world 2, then the counts of research, unlocks and the activity's runs from its
     agent server log and choice log (takeup_counts below).
The skill tree (#15) does not exist yet, so the wanted list's rank alone orders the tickets.

Usage: python scripts/g6_loop.py --demand SPEC.json --takeup SPEC.json [--village V] [--min-samples N] [--go]
  Without --go it prints the commands it would run (a dry run). With --go each step runs in turn (hours: detach it with
  scripts/detach.py and arm a watcher on "G6 LOOP DONE").
"""
import argparse, json, os, pathlib, re, subprocess, sys, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
PY = sys.executable
API2 = "http://127.0.0.1:8768/api"


def say(msg):
    print(f"[g6-loop {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def run(cmd, go, env=None, timeout=None):
    say(("RUN " if go else "WOULD RUN ") + " ".join(str(c) for c in cmd))
    if not go:
        return 0, ""
    r = subprocess.run([str(c) for c in cmd], cwd=ROOT, env={**os.environ, **(env or {})}, capture_output=True, text=True, timeout=timeout)
    out = r.stdout + r.stderr
    print(out[-3000:], flush=True)
    return r.returncode, out


def wait_for_samples(village, n, minutes):
    """Until the live writer has seen a ticketable capability n times in the top 3 (wanted.json's history via the API)."""
    end = time.time() + minutes * 60
    while time.time() < end:
        try:
            with urllib.request.urlopen(f"{API2}/wanted?village={village}", timeout=60) as r:
                got = json.loads(r.read().decode("utf-8"))
            top = (got[0].get("history") or {}).get("top", {}) if got else {}
            if any(t.get("samples", 0) >= n for t in top.values()):
                return True
        except Exception:
            pass
        time.sleep(30)
    return False


def takeup_counts(agent_log, choices, entry, spec_id, skill):
    """Research attempts, the unlock, the activity's runs and what they gave, from a run's logs."""
    text = pathlib.Path(agent_log).read_text(encoding="utf-8", errors="replace") if agent_log and pathlib.Path(agent_log).exists() else ""
    attempts = len(re.findall(rf"\[innovate\] [^:]+: \w+ experiments with {re.escape(entry)}\b", text))
    unlocked = re.search(rf"\[innovate\] [^:]+: (\w+)'s experiment with {re.escape(entry)}.*unlocked", text)
    picks = 0
    if choices and pathlib.Path(choices).exists():
        for line in pathlib.Path(choices).read_text(encoding="utf-8", errors="replace").splitlines():
            if f"activity:{spec_id}" in line:
                picks += 1
    return {"attempts": attempts, "unlocked_by": unlocked.group(1) if unlocked else None, "choice_lines": picks,
            "skill_done": len(re.findall(rf"{re.escape(skill)} finished", text)), "skill_failed": len(re.findall(rf"{re.escape(skill)} failed", text))}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--demand", required=True)
    ap.add_argument("--takeup", required=True)
    ap.add_argument("--village", default="B25x2")
    ap.add_argument("--min-samples", type=int, default=2)
    ap.add_argument("--go", action="store_true")
    a = ap.parse_args()
    go = a.go
    # 1. demand: the run detached, the list read while it runs
    code, out = run([PY, "scripts/run_series.py", a.demand, "--detach"], go)
    if go and code:
        return say("G6 LOOP DONE: the demand run did not start") or 1
    if go and not wait_for_samples(a.village, a.min_samples, 30):
        return say(f"G6 LOOP DONE: no capability reached {a.min_samples} samples in the top 3 within 30 minutes") or 1
    # 2. the ticket
    code, out = run([PY, "scripts/foundry_queue.py", "--api", API2, "--village", a.village, "--min-samples", a.min_samples, "--write"], go,
                    env={"MC_SERVER_DIR": "mc/testserver2"})
    m = re.search(r"QUEUE: wrote (\S+)", out)
    if go and not m:
        return say(f"G6 LOOP DONE: no ticket ({(re.search(r'QUEUE: .*', out) or [''])[0]})") or 0
    ticket = m.group(1) if m else "scripts/foundry/tickets/<id>.json"
    # (the demand run ends on its own; the take-up run needs world 2 free)
    demand_log = ROOT / json.loads((ROOT / a.demand).read_text(encoding="utf-8"))["out"]
    if go:
        while not any("ALL DONE" in p.read_text(encoding="utf-8", errors="replace") for p in demand_log.glob("*.runner.log")):
            time.sleep(30)
    # 3. the foundry
    code, out = run([PY, "scripts/foundry.py", ticket, "--merge"], go, timeout=3 * 3600)
    if go and "merged into tiered-brain-building" not in out:
        return say(f"G6 LOOP DONE: the foundry did not merge ({(re.search(r'FOUNDRY DONE .*', out) or [''])[0]})") or 1
    # 4. take-up
    code, out = run([PY, "scripts/run_series.py", a.takeup], go, timeout=4 * 3600)
    if go:
        t = json.loads((ROOT / ticket).read_text(encoding="utf-8"))
        tout = ROOT / json.loads((ROOT / a.takeup).read_text(encoding="utf-8"))["out"]
        name = json.loads((ROOT / a.takeup).read_text(encoding="utf-8"))["runs"][0]["name"]
        reset = (tout / f"reset_{name}.log").read_text(encoding="utf-8", errors="replace") if (tout / f"reset_{name}.log").exists() else ""
        alog = re.search(r"(runs[\\/]\S+testagents\S+\.log)", reset)
        counts = takeup_counts(ROOT / alog.group(1) if alog else None, tout / f"{name}.choices.jsonl", t["id"], f"lib:{t['id']}", f"harvest_{t['id']}")
        say(f"take-up: {json.dumps(counts)}")
    say("G6 LOOP DONE")
    return 0


if __name__ == "__main__":
    sys.exit(main())
