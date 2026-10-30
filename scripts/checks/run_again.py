"""Run again from a past run's NAME.profile.json (the start screen, spec runs/2026-10-30/startscreen/spec.md 9.1): the
launcher's run_again() makes the record back into a profile, and run_series.py --dry-run of it gives the agent server the
same settings the run had (less the paths a series sets per run: MC_MODEL_RECORD, MC_GOAL_PLAN). Checked on records made
from the committed profiles by a dry run, and on the newest real records that carry their profile (runs since the screen).
Usage: python scripts/checks/run_again.py
"""
import datetime, glob, json, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import runctl  # noqa: E402

OUT = os.path.join(ROOT, "runs", f"{datetime.date.today():%Y-%m-%d}", "check_run_again")
PER_RUN = ("MC_MODEL_RECORD", "MC_GOAL_PLAN")
fails = 0


def dry_env(profile, name):
    """The agent server's settings run_series.py would start a one-run series of this profile with."""
    os.makedirs(OUT, exist_ok=True)
    pf = os.path.join(OUT, f"{name}.profile-in.json")
    json.dump(profile, open(pf, "w", encoding="utf-8"), indent=1)
    spec = os.path.join(OUT, f"{name}.json")
    json.dump({"world": 2, "out": os.path.relpath(os.path.join(OUT, name), ROOT), "runs": [{"name": name, "profile": os.path.relpath(pf, ROOT)}]},
              open(spec, "w", encoding="utf-8"))
    r = subprocess.run([sys.executable, "scripts/run_series.py", spec, "--dry-run"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    m = re.search(r"server (\{.*?\})(?:, from|, saving|$)", r.stdout, re.M)
    if not m:
        raise SystemExit(f"{name}: no dry run ({(r.stderr or r.stdout).strip()[-300:]})")
    env = json.loads(m.group(1))
    return {k: v for k, v in env.items() if k not in PER_RUN}


def check(name, record, want):
    global fails
    again = runctl.run_again(record)["profile"]
    got = dry_env(again, f"{name}-again")
    diff = sorted(set(got.items()) ^ set(want.items()))
    if diff:
        fails += 1
        print(f"FAIL {name}: run again differs: {diff[:6]}")
    else:
        print(f"ok   {name}: {len(want)} settings the same")


for f in sorted(glob.glob(os.path.join(ROOT, "profiles", "*.json"))):
    p = json.load(open(f, encoding="utf-8"))
    name = f"rt-{p['name']}"
    env = dry_env(p, name)
    # (a record as write_profile_json writes it: the given settings and the profile with its source)
    record = {"name": name, "started": "now", "commit": "x", "site": p.get("site"), "checkpoint": p.get("checkpoint"), "settings": env,
              "profile": {"name": p["name"], "kind": p["kind"], "source": p}, "goal_mode": p.get("goal_mode", "drawn"), "goals": p.get("goals")}
    check(name, record, env)

real = [f for f in glob.glob(os.path.join(ROOT, "runs", "*", "**", "*.profile.json"), recursive=True) if "check_run_again" not in f]
n = 0
for f in sorted(real, key=os.path.getmtime, reverse=True):
    rec = json.load(open(f, encoding="utf-8"))
    if not (rec.get("profile") or {}).get("source") or n >= 3:
        continue
    n += 1
    check(f"real {rec['name']}", rec, {k: v for k, v in (rec.get("settings") or {}).items() if k not in PER_RUN})
print(f"run_again: {'ok' if not fails else f'{fails} failed'} ({n} real records with their profile)")
sys.exit(1 if fails else 0)
