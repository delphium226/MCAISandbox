"""Staged runs in a row on the test world (2x, minevale3 at Minevale37's site, the S.0 command: street plan, plains houses
1 and 3 and library 2, --mayor --planner none), a reset before each; logs in runs/<today>/ (STAGE_OUT to change).
Run detached, with a watcher (lesson 122):
  python scripts/detach.py runs/<date>/NAME.runner.log python scripts/stage_runs.py NAME:WORKERS [NAME:WORKERS ...]
  until grep -q "ALL DONE" runs/<date>/NAME.runner.log; do sleep 15; done   (Bash, run_in_background)
Extra stage_village.py arguments for every run: STAGE_ARGS="--after 45 --fixtures --minutes 80" (split on spaces; a later
--minutes wins over the default 30); STAGE_TIMEOUT_S caps each run (default 2700: raise it for long after-phases).
The test agent server's port is MCAI_TEST_API_PORT (default 8767, as mc/testserver.py; another program took 127.0.0.1:8767
on 2026-10-15): MCAI_API is built from it for reset_site.py and the runs. A village that grows (s30): MC_GROW=1 reaches the
agent server through reset_site.py's environment; NAME:WORKERS:GROW (0 or 1) sets it for one run, over MC_GROW. The food
step (s30, runs/2026-10-15/s30/spec_food.md 7): MC_GROW_FARMS=1 (fields and farm slots in neighbourhoods) and MC_APPETITE=18
(the village appetite, points a busy game-hour; MC_APPETITE_IDLE and MC_APPETITE_START beside it) reach the agent server the
same way, and stage_village.py reads MC_APPETITE too when the server does not report it; the header line names them."""
import os, subprocess, sys, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.environ.get("STAGE_OUT") or os.path.join(ROOT, "runs", time.strftime("%Y-%m-%d"))
D = r"runs/2026-10-05/vanilla_designs"
specs = sys.argv[1:]
os.chdir(ROOT)
os.makedirs(OUT, exist_ok=True)
EXTRA = os.environ.get("STAGE_ARGS", "").split()
PORT = os.environ.get("MCAI_TEST_API_PORT", "8767")
for spec in specs:
    name, n, *grow = spec.split(":")
    env = {**os.environ, "MC_TIME_SCALE": "2", "MCAI_API": f"http://127.0.0.1:{PORT}/api", "MCAI_TEST_API_PORT": PORT,
           "MCAI_CHOICE_LOG": os.path.join(OUT, f"{name}.choices.jsonl"), "PYTHONIOENCODING": "utf-8"}
    if grow:
        env["MC_GROW"] = grow[0]
    food = "".join(f", {k} {env[k]}" for k in ("MC_GROW_FARMS", "MC_APPETITE", "MC_APPETITE_IDLE", "MC_APPETITE_START") if env.get(k))
    print(f"=== {name} ({n} workers, port {PORT}, MC_GROW {env.get('MC_GROW') or 'unset'}{food}) {time.strftime('%H:%M:%S')}", flush=True)
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
        if line.startswith(("STOPPED", "CRITICAL PATH", "BUSY all", "GROW layouts", "FOOD ok", "FOOD MISMATCH")):
            print(line.rstrip()[:220], flush=True)
print(f"ALL DONE {time.strftime('%H:%M:%S')}", flush=True)
