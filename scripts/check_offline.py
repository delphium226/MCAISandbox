"""Every check that needs no server, in about a minute: the typecheck, the two golden checks (the task board and the chore
menu against dumps from the code before a refactor) and the offline unit checks of scripts/checks/. Run it before a
refactor and before a commit that touches the agent code; it does not replace a staged run.

Usage: python scripts/check_offline.py [NAME ...]      (npm run check:offline; NAME: only these, e.g. typecheck choose_unit)
Runs up to MCAI_CHECK_JOBS at once (default 4); each check's last line, then a summary; exit 1 if any failed. A check's
whole output goes to runs/<today>/check_offline/NAME.txt. The golden fixtures live in gitignored runs/ (GOLDENS below):
a check whose fixture is missing is skipped, not failed. After a deliberate change to the board or the menu, dump new
goldens (the checks' own usage lines) and point GOLDENS at them.
"""
import concurrent.futures, datetime, os, subprocess, sys, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
TSX = os.path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs")
INPUTS = ["runs/2026-10-12/golden_inputs/villages_main.json", "runs/2026-10-12/golden_inputs/villages_test.json"]
# name: (arguments after the script, files that must exist)
GOLDENS = {
    "choice_golden": (["check", "runs/2026-10-14/golden_head.json"], ["runs/2026-10-14/golden_head.json"] + INPUTS),
    "board_golden": (["check", "runs/2026-10-14/board_ebec76d.json"] + INPUTS, ["runs/2026-10-14/board_ebec76d.json"] + INPUTS),
}
# The scripts/checks/*.mts that run with no arguments and no server (each under ~35 s)
UNITS = ["board_version", "call_gate", "chat_route", "choose_unit", "model_usage", "save_debounce", "street_plan",
         "light_check", "workshop_check", "gen_designs", "pf_share", "at_goal", "huts_box", "vanilla_tags", "vanilla_recipes",
         "temperament_table", "vote_unit", "activities_unit", "decor_check", "public_works", "small_works",
         "menu_probe", "needs_unit"]


def commands():
    node = "node"
    out = {"typecheck": ([node, os.path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", "tsconfig.json"], [])}
    for name, (args, needs) in GOLDENS.items():
        out[name] = ([node, TSX, f"scripts/checks/{name}.mts", *args], needs)
    for name in UNITS:
        out[name] = ([node, TSX, f"scripts/checks/{name}.mts"], [])
    return out


def run(name, cmd, needs, logdir):
    missing = [p for p in needs if not os.path.exists(os.path.join(ROOT, p))]
    if missing:
        return name, "skipped", 0.0, f"no {', '.join(missing)}"
    t = time.time()
    try:
        # (A.3p: temperaments off, whatever the shell says: the goldens are of the picker without them)
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300,
                           env={**os.environ, "MCAI_TEMPERAMENT": "off"})
        code, text, out = r.returncode, r.stdout + r.stderr, r.stdout
    except subprocess.TimeoutExpired:
        code, text, out = "timeout", "", ""
    open(os.path.join(logdir, f"{name}.txt"), "w", encoding="utf-8").write(text)
    # (the check's own last line; stderr carries notes such as [vanilla]'s jar line)
    last = next((l.strip() for l in reversed((out if out.strip() else text).splitlines()) if l.strip()), "(no output)")
    return name, "ok" if code == 0 else f"FAILED ({code})", time.time() - t, last


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    every = commands()
    pick = sys.argv[1:]
    for n in pick:
        if n not in every:
            raise SystemExit(f"no check {n}; there are: {', '.join(every)}")
    todo = {n: every[n] for n in (pick or every)}
    logdir = os.path.join(ROOT, "runs", f"{datetime.date.today():%Y-%m-%d}", "check_offline")
    os.makedirs(logdir, exist_ok=True)
    t0, results = time.time(), []
    jobs = int(os.environ.get("MCAI_CHECK_JOBS", "4"))
    with concurrent.futures.ThreadPoolExecutor(jobs) as pool:
        # (the slowest first, so the run ends sooner)
        order = sorted(todo, key=lambda n: n not in ("choice_golden", "pf_share", "save_debounce", "huts_box", "typecheck"))
        futures = [pool.submit(run, n, *todo[n], logdir) for n in order]
        for f in concurrent.futures.as_completed(futures):
            name, status, secs, last = f.result()
            results.append((name, status))
            print(f"{name:16} {status:12} {secs:5.1f}s  {last[:150]}", flush=True)
    failed = [n for n, s in results if s not in ("ok", "skipped")]
    skipped = [n for n, s in results if s == "skipped"]
    print(f"\n{len(results) - len(failed) - len(skipped)} ok, {len(failed)} failed{' (' + ', '.join(failed) + ')' if failed else ''}, "
          f"{len(skipped)} skipped in {time.time() - t0:.0f} s; outputs in {os.path.relpath(logdir, ROOT)}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
