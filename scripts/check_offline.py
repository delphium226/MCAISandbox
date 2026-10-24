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
         "menu_probe", "needs_unit", "housing", "parts_unit", "needworks_unit", "utilisation_unit", "mine_flow_unit", "merchant_unit", "tech_unit", "goals_unit", "works_grow", "wanted_unit", "own_pending_unit", "own_share_unit", "pay_ledger", "pay_acts", "pay_store", "talk_acts", "flowers_unit", "gardens_unit", "rules_unit", "law_reading",
         "ladder_unit", "ladder_letters", "iron_legs_unit", "character_preset", "vanilla_all", "model_pace", "llm_limits", "fixes_all1", "wood_variants", "gen_homes", "open_hut", "make_short"]


def commands():
    node = "node"
    out = {"typecheck": ([node, os.path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", "tsconfig.json"], [])}
    for name, (args, needs) in GOLDENS.items():
        out[name] = ([node, TSX, f"scripts/checks/{name}.mts", *args], needs)
    for name in UNITS:
        out[name] = ([node, TSX, f"scripts/checks/{name}.mts"], [])
    # (G6: the foundry's CLI handling and its request queue, Python and offline)
    for name in ("foundry_cli", "foundry_requests_check"):
        out[name] = ([sys.executable, f"scripts/checks/{name}.py"], [])
    # (s42: the village simulator, 20 simulated minutes on mv3_grown25: no error, every member picking)
    out["village_sim"] = ([node, TSX, "scripts/sim/village_sim.mts", "--minutes", "20"], ["mc/testcheckpoints/mv3_grown25/villages.json"])
    # (#21: the letters rung's goods, keeps and trades, and the library's cells, on the im2_mine checkpoint)
    for name in ("letters_make", "letters_pace", "library_shelves", "storage_grow"):
        out[name] = ([node, TSX, f"scripts/checks/{name}.mts"], ["mc/testcheckpoints/im2_mine/villages.json"])
    # (MC_HOME_BASICS: a bed, a chest and a table for every owned house of im2_mine, and the jar's houses' cells)
    out["home_basics"] = ([node, TSX, "scripts/checks/home_basics.mts", "im2_mine"], ["mc/testcheckpoints/im2_mine/villages.json"])
    # (#117, MC_PROMPT_SELF: the self, needs, scarcity and ambition lines, the pins and tags, on mv3_base25 and im2_mine)
    out["prompt_self"] = ([node, TSX, "scripts/checks/prompt_self.mts"], ["mc/testcheckpoints/mv3_base25/villages.json", "mc/testcheckpoints/im2_mine/villages.json"])
    # (#97, MC_CHOICE_HOLDS: a pending decision's shown options off the others' menus, the projects' cap, flag on and off)
    out["choice_holds"] = ([node, TSX, "scripts/checks/choice_holds.mts"], ["mc/testcheckpoints/mv3_base25/villages.json"])
    # (#122, MC_POLICY_OPTIONS: the gated options on a filler-only menu of im2_mine set up for it, flag on and off)
    out["policy_options"] = ([node, TSX, "scripts/checks/policy_options.mts"], ["mc/testcheckpoints/im2_mine/villages.json"])
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
