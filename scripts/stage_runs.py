"""Staged runs in a row on the test world (2x, minevale3 at Minevale37's site, the S.0 command: street plan, plains houses
1 and 3 and library 2, --mayor --planner none), a reset before each; logs in runs/<today>/ (STAGE_OUT to change).
Run detached, with a watcher (lesson 122):
  python scripts/detach.py runs/<date>/NAME.runner.log python scripts/stage_runs.py NAME:WORKERS [NAME:WORKERS ...]
  until grep -q "ALL DONE" runs/<date>/NAME.runner.log; do sleep 15; done   (Bash, run_in_background)
Extra stage_village.py arguments for every run: STAGE_ARGS="--after 45 --fixtures --minutes 80" (split on spaces; a later
--minutes wins over the default 30); STAGE_TIMEOUT_S caps each run (default 2700: raise it for long after-phases)."""
import os, subprocess, sys, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.environ.get("STAGE_OUT") or os.path.join(ROOT, "runs", time.strftime("%Y-%m-%d"))
D = r"runs/2026-10-05/vanilla_designs"
specs = sys.argv[1:]
os.chdir(ROOT)
os.makedirs(OUT, exist_ok=True)
EXTRA = os.environ.get("STAGE_ARGS", "").split()
for spec in specs:
    name, n = spec.split(":")
    print(f"=== {name} ({n} workers) {time.strftime('%H:%M:%S')}", flush=True)
    env = {**os.environ, "MC_TIME_SCALE": "2", "MCAI_API": "http://127.0.0.1:8767/api",
           "MCAI_CHOICE_LOG": os.path.join(OUT, f"{name}.choices.jsonl"), "PYTHONIOENCODING": "utf-8"}
    with open(os.path.join(OUT, f"reset_{name}.log"), "w", encoding="utf-8") as f:
        r = subprocess.run([sys.executable, "scripts/reset_site.py", "minevale3"], env=env, stdout=f, stderr=subprocess.STDOUT, timeout=900)
    if r.returncode:
        print(f"reset failed ({r.returncode})", flush=True)
        continue
    env2 = {**env, "MC_SERVER_DIR": "mc/testserver", "MCAI_STALL_MIN": "8", "MCAI_AGENT_STALL_MIN": "8", "PYTHONUNBUFFERED": "1"}
    env2.pop("MC_TIME_SCALE")
    cmd = [sys.executable, "scripts/stage_village.py", name, "-1630", "35", "--site-at=-1630,65,35,40,birch", "--stage", "full",
           "--plan", "street", "--biome", "plains", "--mayor", "--planner", "none", "--workers", n,
           "--buildings", "plains_small_house_1,plains_small_house_3,plains_library_2",
           "--design-file", f"{D}/plains__plains_small_house_1.json", "--design-file", f"{D}/plains__plains_small_house_3.json",
           "--design-file", f"{D}/plains__plains_library_2.json", "--minutes", "30"] + EXTRA
    log = os.path.join(OUT, f"{name}.log")
    with open(log, "w", encoding="utf-8") as f:
        try:
            subprocess.run(cmd, env=env2, stdout=f, stderr=subprocess.STDOUT, timeout=int(os.environ.get("STAGE_TIMEOUT_S", "2700")))
        except subprocess.TimeoutExpired:
            print("run timed out", flush=True)
    for line in open(log, encoding="utf-8", errors="replace"):
        if line.startswith(("STOPPED", "CRITICAL PATH", "BUSY all")):
            print(line.rstrip()[:220], flush=True)
print(f"ALL DONE {time.strftime('%H:%M:%S')}", flush=True)
