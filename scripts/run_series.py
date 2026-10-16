"""Staged runs in a row on the test world, from a JSON spec: the reusable form of the per-session drivers (stage_runs.py,
runs/*/g_runs.py, b4_runs.py, cp_check.py). Each run: reset the site (from the snapshot or a checkpoint) with the agent
server's settings, run stage_village.py, optionally save the result as a checkpoint, run the follow-up checks, and print the
lines that matter; at the end a table of every run and "ALL DONE".

Usage: python scripts/run_series.py SPEC.json [RUN ...] [--dry-run] [--detach]
  RUN        only these runs of the spec, in the spec's order (default all)
  --dry-run  print each run's commands and settings; run nothing
  --detach   start this same series detached (scripts/detach.py, so it outlives the session) and print the watcher to arm:
             a detached run sends no notification (lesson 122)

The spec (every key optional unless said; a run's keys override the spec's, its env dicts merge over the spec's and its
"args" are added after the spec's):
  {
    "out": "runs/2026-10-16/voting",     where logs go (default runs/<today>); NAME.log, reset_NAME.log, NAME.choices.jsonl
    "site": "minevale3",                 a site of scripts/test_sites.json
    "world": 2,                          the test world (default MCAI_TEST_WORLD, else 1): mc/testserverN on its own
                                         ports (mc/testserver.py), so two series can run at once on different worlds
    "port": 8770,                        the test agent server's port (default MCAI_TEST_API_PORT, else 8766 + world)
    "preset": "s0",                      the base stage command (PRESETS below), or "none" to give everything in "args"
    "workers": 2,
    "fast": true,                        the default: MC_TIME_SCALE 3 (2 from 12 workers), MC_HASTE 5, MC_RANDOM_TICK 30;
                                         false gives 2x with vanilla digging and crop growth
    "time_scale": 3,                     MC_TIME_SCALE for the agent server (0 or null for 1x), over "fast"
    "server_env": {"MC_GROW": "1"},      the agent server's environment (reset_site.py starts it with this)
    "stage_env": {"MCAI_STALL_MIN": "8"},  stage_village.py's environment
    "args": "--after 45 --choose fixed", stage_village.py arguments (a string, split on spaces, or a list)
    "timeout_min": 60,                   per run, stage_village.py's wall-clock limit
    "checks": ["make_log"],              follow-up checks (CHECKS below)
    "show": ["FOOD"],                    more line prefixes to print from the stage log
    "runs": [
      {"name": "CP1", "server_env": {"MC_GROW": "0"}, "args": "--after 0.5", "save": "mv3_cp1"},
      {"name": "V1", "checkpoint": "mv3_cp1", "args": "--after 20"},
      {"name": "V2", "checkpoint": "mv3_cp1", "workers": 24, "args": "--after 20", "reset": true}
    ]
  }
Model-driven runs ("preset": "watch"): watch_village.py instead of stage_village.py, real models for every role, from the
snapshot (no checkpoint: watch_village.py cannot resume). Their keys:
    "objective": "Build a small village...",   required
    "minutes": 20,                       watch_village.py's MAX_MINUTES (default 20)
    "x": -1544, "z": 8,                  where the land probe starts (default the site's probe point)
    "planner": "ollama:qwen3.8:27b",     the workers' planner (default gpt-oss cloud), "site_size": 30
    "after": 10,                         MCAI_AFTER: minutes watched after completion
    "replay": "W1",                      answer the model calls from an earlier run's recording (MC_MODEL_REPLAY; free, at
                                         once): a run of this spec (its NAME.calls.jsonl in "out") or a recording's path
                                         (runs/model-calls/...); "replay_mode": "exact" for word-for-word prompts only.
                                         Give the replay the recorded run's "village" name, so its prompts match
  Every watch run records its model calls to NAME.calls.jsonl beside its log (MC_MODEL_RECORD), so it can be replayed;
  the check "model_calls" (always run for watch runs) counts them and the [replay] lines. Watch runs default to 1x with
  vanilla digging and growth ("fast" false, no time_scale: CLAUDE.md's acceptance rule), and to MCAI_GAMEMODE=survival,
  MCAI_STALL_MIN=5 and MCAI_SAME_FAIL=6 (stage_env overrides them).
A run with "checkpoint" restores that checkpoint (reset_site.py --checkpoint) and resumes the village saved in it
(stage_village.py --resume; give it the saved run's village name with "village", default the checkpoint's own). A run with
"save" saves the site as that checkpoint after its stage run (reset_site.py --save --force --no-start; the next run's reset
starts the servers again). "reset": false runs on the world as the last run left it. Run names are the village names unless
"village" is given; names must be unique in the spec.
"""
import datetime, json, os, re, shlex, subprocess, sys, threading, time, urllib.request

from run_report import perf_summary

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
PY = sys.executable
VANILLA = "runs/2026-10-05/vanilla_designs"

# Base stage commands. s0: the S.0 command on minevale3 at Minevale37's site (street plan, plains houses 1 and 3 and library
# 2, a Mayor without a planner), as scripts/stage_runs.py runs it. Each preset gives (X Z and site arguments, the rest);
# a resumed run keeps only the rest (stage_village.py --resume refuses designs and staging).
PRESETS = {
    "s0": (["-1630", "35", "--site-at=-1630,65,35,40,birch", "--stage", "full",
            "--buildings", "plains_small_house_1,plains_small_house_3,plains_library_2",
            "--design-file", f"{VANILLA}/plains__plains_small_house_1.json",
            "--design-file", f"{VANILLA}/plains__plains_small_house_3.json",
            "--design-file", f"{VANILLA}/plains__plains_library_2.json"],
           ["--plan", "street", "--biome", "plains", "--mayor", "--planner", "none", "--minutes", "30"]),
    "none": ([], []),
}
RESUME_XZ = {"s0": ["-1630", "35"]}
# (watch: watch_village.py, its arguments built from the run's keys in resolve)
PRESETS["watch"] = ([], [])
DEFAULT_PLANNER = "ollama:gpt-oss:120b-cloud"
FROM_CP = "<the checkpoint's village>"

# Lines worth printing from every stage log
SHOW = ("STOPPED", "RESUME", "COMPLETE at", "BUSY all", "CRITICAL PATH", "AFTER village", "AFTER busy", "AFTER GROW",
        "GROW layouts", "AFTER S.9", "AFTER LIGHT standing", "AFTER B.4", "FOOD ok", "FOOD MISMATCH", "FOOD members",
        "FOOD hungry", "HARVEST", "PEN")


def agent_log_of(reset_log):
    """The agent server's log reset_site.py started, as it named it."""
    if not os.path.exists(reset_log):
        return None
    m = re.search(r"log (\S*testagents-\S+\.log)", open(reset_log, encoding="utf-8", errors="replace").read())
    if not m:
        return None
    p = m.group(1) if os.path.isabs(m.group(1)) else os.path.join(ROOT, m.group(1))
    return p if os.path.exists(p) else None


def check_make_log(run, env):
    """scripts/checks/make_log.py on the run's agent server log and its stage log: MAKE ok / LIGHT ok / MISMATCH."""
    agent_log = agent_log_of(run["reset_log"])
    if not agent_log:
        return [f"make_log: no agent server log found (in {run['reset_log']})"]
    out = os.path.join(run["out"], f"{run['name']}.make_log.txt")
    with open(out, "w", encoding="utf-8") as f:
        r = subprocess.run([PY, "scripts/checks/make_log.py", agent_log, run["log"]], cwd=ROOT, env=env, stdout=f,
                           stderr=subprocess.STDOUT)
    keep = ("MAKE ok", "LIGHT ok", "MISMATCH", "gathering:", "smelting makes", "requeues", "light chores", "food")
    return [l.rstrip() for l in open(out, encoding="utf-8", errors="replace") if l.startswith(keep)] + [f"make_log: exit {r.returncode} ({out})"]


def check_agent_log(run, env):
    """Counts of the agent server's warning lines for this run: [lag], [stuck], [stuck-world], [repath], [dig]."""
    agent_log = agent_log_of(run["reset_log"])
    if not agent_log:
        return ["agent_log: no agent server log found"]
    counts = {k: 0 for k in ("[lag]", "[stuck]", "[stuck-world]", "[repath]", "[dig]")}
    for line in open(agent_log, encoding="utf-8", errors="replace"):
        for k in counts:
            if k in line:
                counts[k] += 1
    return ["agent_log: " + ", ".join(f"{k} {n}" for k, n in counts.items()) + f" ({agent_log})"]


def check_model_calls(run, env):
    """The model calls the run's agent server recorded (NAME.calls.jsonl) and, on a replay, how many it answered from the
    recording with the same prompt or a different one ([replay] lines in the agent log)."""
    path = run["server_env"].get("MC_MODEL_RECORD")
    calls = 0
    if path and os.path.exists(path):
        calls = sum(1 for l in open(path, encoding="utf-8", errors="replace") if '"reply"' in l)
    out = f"model_calls: {calls} recorded ({os.path.relpath(path, ROOT) if path else 'not recorded'})"
    agent_log = agent_log_of(run["reset_log"])
    if run["server_env"].get("MC_MODEL_REPLAY") and agent_log:
        text = open(agent_log, encoding="utf-8", errors="replace").read()
        same, differs = text.count("replayed (prompt same)"), text.count("replayed (prompt differs)")
        out += f"; replayed {same + differs} ({same} same prompt, {differs} differing)"
    return [out]


CHECKS = {"make_log": check_make_log, "agent_log": check_agent_log, "model_calls": check_model_calls}


def as_args(v):
    return shlex.split(v, posix=False) if isinstance(v, str) else list(v or [])


def resolve(spec, run, out_default):
    """One run's settings: the spec's with the run's over them."""
    get = lambda k, d=None: run.get(k, spec.get(k, d))
    world = int(get("world", os.environ.get("MCAI_TEST_WORLD") or 1))
    port = str(get("port", os.environ.get("MCAI_TEST_API_PORT") or 8766 + world))
    preset = get("preset", "s0")
    if preset not in PRESETS:
        raise SystemExit(f"run {run['name']}: no preset {preset!r} (there are {', '.join(PRESETS)})")
    cp = run.get("checkpoint")
    watch = preset == "watch"
    if watch and cp:
        raise SystemExit(f"run {run['name']}: a watch run starts from the snapshot (watch_village.py cannot resume a checkpoint)")
    if watch and not get("objective"):
        raise SystemExit(f"run {run['name']}: a watch run needs an \"objective\"")
    head, rest = PRESETS[preset]
    if cp:
        head = RESUME_XZ.get(preset, [])
    # (a resumed run's village is the one its checkpoint saved, read when the run starts: an earlier run may save it)
    village = run.get("village") or (FROM_CP if cp else run["name"])
    args = head + rest + ["--workers", str(get("workers", 2))] + as_args(spec.get("args")) + as_args(run.get("args"))
    if cp and "--resume" not in args:
        args.append("--resume")
    out = os.path.join(ROOT, get("out", out_default))
    site = get("site", "minevale3")
    if watch:
        sites = json.load(open(os.path.join(ROOT, "scripts", "test_sites.json"), encoding="utf-8"))["sites"]
        probe = next((s["probe"] for s in sites if s["name"].lower() == site.lower()), None)
        if probe is None and (get("x") is None or get("z") is None):
            raise SystemExit(f"run {run['name']}: no site {site} in scripts/test_sites.json (or give \"x\" and \"z\")")
        x, z = get("x", probe and probe["x"]), get("z", probe and probe["z"])
        tail = ([get("planner", DEFAULT_PLANNER)] if get("planner") or get("site_size") else []) + \
               ([str(get("site_size"))] if get("site_size") else [])
        args = [str(x), str(z), str(get("workers", 2)), str(get("minutes", 20)), get("objective")] + tail
    # Staged runs go fast by default (the user's decision, 2026-10-16): 3x, haste 5 and fast crops (H5T3 built 35%
    # faster, Rt30 harvested at +2.4 min); 2x from 12 workers up: at 25, 3x built 0.2 min sooner and grew no faster
    # (G25x2/G25x3, s32: the after phase is bound by work and walking), with more [stuck].
    # "fast": false in a spec or run gives 2x with vanilla digging and growth; time_scale and server_env still override.
    fast = get("fast", not watch)
    workers = int(get("workers", 2))
    ts = get("time_scale", (3 if workers < 12 else 2) if fast else None if watch else 2)
    server_env = {**({"MC_TIME_SCALE": str(ts)} if ts and float(ts) != 1 else {}),
                  **({"MC_HASTE": "5", "MC_RANDOM_TICK": "30"} if fast else {}),
                  **spec.get("server_env", {}), **run.get("server_env", {})}
    stage_env = {**spec.get("stage_env", {}), **run.get("stage_env", {})}
    checks = list(get("checks", []))
    if watch:
        # (the run's model calls recorded beside its log, to replay later; a replay answers from an earlier recording)
        server_env.setdefault("MC_MODEL_RECORD", os.path.join(out, f"{run['name']}.calls.jsonl"))
        rp = get("replay")
        if rp:
            # (a run's name, or a path; whether it exists is checked when the run starts: an earlier run may record it)
            rp = os.path.join(out, f"{rp}.calls.jsonl") if not rp.endswith(".jsonl") else rp if os.path.isabs(rp) else os.path.join(ROOT, rp)
            server_env["MC_MODEL_REPLAY"] = rp
            if get("replay_mode"):
                server_env["MC_MODEL_REPLAY_MODE"] = get("replay_mode")
        stage_env = {"MCAI_GAMEMODE": "survival", "MCAI_STALL_MIN": "5", "MCAI_SAME_FAIL": "6",
                     **({"MCAI_AFTER": str(get("after"))} if get("after") else {}), **stage_env}
        checks += [] if "model_calls" in checks else ["model_calls"]
    return {
        "name": run["name"], "village": village, "site": site, "port": port, "out": out, "watch": watch,
        "world": world, "server_dir": "mc/testserver" if world == 1 else f"mc/testserver{world}",
        "checkpoint": cp, "save": run.get("save"), "reset": run.get("reset", True),
        "server_env": server_env, "stage_env": stage_env,
        "stage": [PY, "scripts/watch_village.py" if watch else "scripts/stage_village.py", village] + args,
        "timeout": float(get("timeout_min", float(get("minutes", 20)) + float(get("after", 0) or 0) + 15 if watch else 60)) * 60,
        "checks": checks, "show": tuple(SHOW) + tuple(get("show", [])),
        "log": os.path.join(out, f"{run['name']}.log"), "reset_log": os.path.join(out, f"reset_{run['name']}.log"),
    }


def envs(run):
    api = f"http://127.0.0.1:{run['port']}/api"
    base = {**os.environ, "MCAI_API": api, "MCAI_TEST_API_PORT": run["port"], "MCAI_TEST_WORLD": str(run["world"]),
            "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    # (reset_site.py starts the agent server with its own environment: the server settings go there, and the choice log,
    # which the agent server writes and stage_village.py reads)
    choices = os.path.join(run["out"], f"{run['name']}.choices.jsonl")
    server = {**base, "MCAI_CHOICE_LOG": choices, **run["server_env"]}
    stage = {**base, "MC_SERVER_DIR": run["server_dir"], "MCAI_CHOICE_LOG": choices,
             **({} if run["watch"] else {"MCAI_STALL_MIN": "8", "MCAI_AGENT_STALL_MIN": "8"}), **run["stage_env"]}
    # (stage_village.py reads MC_APPETITE and MC_GROW from its own environment when the server does not report them)
    stage.update({k: v for k, v in run["server_env"].items() if k in ("MC_GROW", "MC_APPETITE", "MC_GROW_FARMS")})
    stage.pop("MC_TIME_SCALE", None)
    return server, stage


def run_step(cmd, env, log, timeout):
    t = time.time()
    with open(log, "w", encoding="utf-8") as f:
        try:
            code = subprocess.run(cmd, cwd=ROOT, env=env, stdout=f, stderr=subprocess.STDOUT, timeout=timeout).returncode
        except subprocess.TimeoutExpired:
            code = "timeout"
    return code, (time.time() - t) / 60


class PerfSampler(threading.Thread):
    """During a stage run, every 10 s: the agent server's /api/perf and Paper's mspt (RCON), one JSON line each to
    NAME.perf.jsonl; run_report.py sums them up (perf_summary)."""

    def __init__(self, run):
        super().__init__(daemon=True)
        self.r, self.halt = run, threading.Event()
        ts = float(run["server_env"].get("MC_TIME_SCALE") or 1)
        self.budget = round(1000 / (20 * ts), 1)
        self.path = os.path.join(run["out"], f"{run['name']}.perf.jsonl")

    def mspt(self, rc):
        m = re.findall(r"([\d.]+)/([\d.]+)/([\d.]+)", re.sub("§.", "", rc.command("mspt")))
        return float(m[0][0]) if m else None

    def run(self):
        sys.path.insert(0, os.path.join(ROOT, "mc"))
        import rcon as mc_rcon
        rc = None
        with open(self.path, "w", encoding="utf-8") as f:
            while not self.halt.wait(10):
                row = {}
                try:
                    row = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{self.r['port']}/api/perf", timeout=5).read())
                except (OSError, ValueError):
                    continue
                try:
                    rc = rc or mc_rcon.Rcon(self.r["server_dir"])
                    row["mspt"] = self.mspt(rc)
                except Exception:
                    rc = None
                row.pop("overview", None)
                row["mspt_budget"] = self.budget
                f.write(json.dumps(row) + "\n")
                f.flush()


def remove_agents(run):
    """The stage scripts leave their agents in the world: remove the ones the last run spawned."""
    m = re.search(r"^RUN village=\S+ agents=(\S+)", open(run["log"], encoding="utf-8", errors="replace").read(), re.M) \
        if os.path.exists(run["log"]) else None
    for n in (m.group(1).split(",") if m else []):
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{run['port']}/api/agents/{n}", method="DELETE")
            urllib.request.urlopen(req, timeout=10).read()
        except OSError:
            pass
    return len(m.group(1).split(",")) if m else 0


def main():
    argv = sys.argv[1:]
    flags = {a for a in argv if a.startswith("--")}
    pos = [a for a in argv if not a.startswith("--")]
    if not pos or flags - {"--dry-run", "--detach"}:
        raise SystemExit(__doc__)
    spec_path = pos[0]
    spec = json.load(open(spec_path, encoding="utf-8"))
    names = [r["name"] for r in spec.get("runs", [])]
    if not names or len(set(n.lower() for n in names)) != len(names):
        raise SystemExit("the spec needs runs with unique names")
    pick = pos[1:]
    for n in pick:
        if n not in names:
            raise SystemExit(f"no run {n} in {spec_path}: there are {', '.join(names)}")
    today = f"runs/{datetime.date.today():%Y-%m-%d}"
    runs = [resolve(spec, r, today) for r in spec["runs"] if not pick or r["name"] in pick]

    if "--detach" in flags:
        out = runs[0]["out"]
        os.makedirs(out, exist_ok=True)
        stem = os.path.splitext(os.path.basename(spec_path))[0]
        runner = os.path.join(out, f"{stem}.runner.log")
        # (a fresh log: the watcher waits for "ALL DONE", and an earlier series' would wake it at once)
        if os.path.exists(runner):
            os.replace(runner, runner + f".{time.strftime('%H%M%S')}")
        rest = [a for a in argv if a != "--detach"]
        subprocess.run([PY, "scripts/detach.py", runner, PY, "scripts/run_series.py", *rest], cwd=ROOT, check=True)
        rel = os.path.relpath(runner, ROOT).replace("\\", "/")
        print(f"started detached; arm a watcher (Bash, run_in_background, timeout above the series):\n"
              f'  until grep -q "ALL DONE" {rel}; do sleep 15; done; cat {rel}')
        return

    print(f"SERIES {spec_path}: {', '.join(r['name'] for r in runs)} {time.strftime('%H:%M:%S')}", flush=True)
    results = []
    for run in runs:
        server_env, stage_env = envs(run)
        os.makedirs(run["out"], exist_ok=True)
        reset = [PY, "scripts/reset_site.py", run["site"]] + (["--checkpoint", run["checkpoint"]] if run["checkpoint"] else [])
        print(f"=== {run['name']} {time.strftime('%H:%M:%S')}: world {run['world']}, port {run['port']}, server {json.dumps(run['server_env'])}"
              + (f", from checkpoint {run['checkpoint']}" if run["checkpoint"] else "")
              + (f", saving as {run['save']}" if run["save"] else ""), flush=True)
        if "--dry-run" in flags:
            print(f"    reset: {' '.join(reset) if run['reset'] else '(none)'}\n    stage: {' '.join(run['stage'][1:])}"
                  f"\n    stage env: {json.dumps(run['stage_env'])}; timeout {run['timeout'] / 60:g} min; checks {run['checks']}", flush=True)
            if run["save"]:
                print(f"    save: scripts/reset_site.py {run['site']} --save {run['save']} --force --no-start", flush=True)
            continue
        row = {"name": run["name"], "minutes": 0.0, "stopped": "-", "code": "-"}
        results.append(row)
        if run["village"] == FROM_CP:
            meta = os.path.join(ROOT, "mc", "testcheckpoints", run["checkpoint"], "checkpoint.json")
            done = [v["name"] for v in (json.load(open(meta, encoding="utf-8")) if os.path.exists(meta) else {}).get("villages", [])
                    if v.get("complete")]
            if len(done) != 1:
                row["code"] = "no village"
                print(f"    checkpoint {run['checkpoint']}: {'no complete village' if not done else 'several: ' + ', '.join(done)}"
                      f" (give the run a \"village\")", flush=True)
                continue
            run["village"] = run["stage"][2] = done[0]
        if run["server_env"].get("MC_MODEL_REPLAY") and not os.path.exists(run["server_env"]["MC_MODEL_REPLAY"]):
            row["code"] = "no recording"
            print(f"    no recording {run['server_env']['MC_MODEL_REPLAY']} to replay", flush=True)
            continue
        if run["reset"]:
            code, mins = run_step(reset, server_env, run["reset_log"], 900)
            print(f"    reset: exit {code} after {mins:.1f} min", flush=True)
            if code != 0:
                row["code"] = f"reset {code}"
                print("".join("    | " + l for l in open(run["reset_log"], encoding="utf-8", errors="replace").readlines()[-6:]), end="", flush=True)
                continue
        sampler = PerfSampler(run)
        sampler.start()
        code, mins = run_step(run["stage"], stage_env, run["log"], run["timeout"])
        sampler.halt.set()
        sampler.join(15)
        row.update(code=code, minutes=mins)
        print(f"    stage: exit {code} after {mins:.1f} min (log {os.path.relpath(run['log'], ROOT)})", flush=True)
        for line in open(run["log"], encoding="utf-8", errors="replace"):
            if line.startswith(run["show"]) or (run["watch"] and re.match(r"\s*[\d.]+m (COMPLETE|BUSY|CRIT)", line)):
                print("    " + line.rstrip()[:240], flush=True)
            if line.startswith("STOPPED"):
                row["stopped"] = line.strip()[len("STOPPED "):][:120]
        perf = perf_summary(sampler.path)
        if perf:
            print("    PERF " + "; ".join(f"{k} {v}" for k, v in perf.items()), flush=True)
        for name in run["checks"]:
            for line in CHECKS[name](run, stage_env) if name in CHECKS else [f"no check {name} (there are {', '.join(CHECKS)})"]:
                print("    " + line[:240], flush=True)
        if run["save"]:
            remove_agents(run)
            code, _ = run_step([PY, "scripts/reset_site.py", run["site"], "--save", run["save"], "--force", "--no-start"],
                               server_env, os.path.join(run["out"], f"save_{run['name']}.log"), 900)
            for line in open(os.path.join(run["out"], f"save_{run['name']}.log"), encoding="utf-8", errors="replace"):
                if line.startswith("checkpoint "):
                    print("    " + line.rstrip()[:240], flush=True)
            print(f"    save {run['save']}: exit {code}", flush=True)
    if results and "--dry-run" not in flags:
        last = runs[-1]
        if not last["save"]:
            print(f"removed {remove_agents(last)} agents of {last['name']}", flush=True)
        print("\nRUN      exit  minutes  stopped", flush=True)
        for r in results:
            print(f"{r['name']:8} {str(r['code']):5} {r['minutes']:7.1f}  {r['stopped']}", flush=True)
    print(f"ALL DONE {time.strftime('%H:%M:%S')}", flush=True)


if __name__ == "__main__":
    main()
