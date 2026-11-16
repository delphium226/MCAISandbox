---
name: live-run
description: Launch a live test run on a test world from a code snapshot (run_series.py --detach), watch it to the end and read the result (completion, busy, ladder rungs and votes, [stuck]/[lag]). Use whenever a change needs a live run, a rung test, a ladder climb or a confirmation run, or when the user asks to start, watch or read a run.
---

# A live run, start to report

Every live run in this project goes the same way. Do the steps in order; skipping the snapshot or the watcher has cost
runs before (CLAUDE.md, lesson 122).

## 1. Pick a free world

`python scripts/stack.py status` (from the checkout whose code you test; the scale-50 clone is
`D:\Projects\MCAISandbox-scale50`). A world with agents on it belongs to someone: never reset it. Worlds: 1 = 25566/8767,
2 = 25567/8768, 6 = 25571/8772 (world 3 is the foundry's). When agents share the worlds, each brief names whose
world is whose; keep to it. At most 2 runs at once.

## 2. Write the spec

Copy the nearest recent spec rather than writing one: `runs/<date>/**/<name>.spec.json` (e.g.
`runs/2026-11-15/houses/homes2.spec.json` is the rung-test settings from `rt_base`, 25 members, 2x, model choices). Change only:
`out` (a new `runs/<today>/<topic>/` folder), `name`, `world`, `timeout_min` (run length + ~20), `args`
(`--after MINUTES --choose model`), `show` (log tags to print, e.g. `[ladder]`, `[vote]`, `[pay]`), and the flags under
test in `server_env`. `MC_LADDER_START=<rung>` starts at a rung (omit it for a climb from where the checkpoint stands);
`checkpoint` picks the saved village (`ls mc/testcheckpoints`). A Python snippet that loads, edits and dumps the JSON is
safest.

## 3. Snapshot the code and launch

```bash
D="<scratchpad>/<topic>/code_<sha>"; mkdir -p "$D" && git archive <sha> | tar -x -C "$D"
MCAI_CODE_FROM="$D" python scripts/run_series.py runs/<date>/<topic>/<name>.spec.json --detach
```

Commit first: the snapshot is of a commit, so the run's code is known and files can be edited while it runs. If auto mode
blocks the detached start, stop and ask the user to approve that run (approval is per run); never work around it.

## 4. Arm the watcher

Bash with `run_in_background: true`, `timeout: 600000`:

```bash
cd <checkout> && until grep -q "ALL DONE" <spec>.runner.log; do sleep 30; done; tail -40 <spec>.runner.log
```

The Bash timeout is 10 minutes; a longer run keeps going detached. When the watcher ends without ALL DONE, re-arm it.
Do not sleep or poll in the foreground.

## 5. Read the result

- The runner log's tail: STOPPED (minutes, tokens, cost), BUSY, FOOD, PERF, `agent_log: [lag] N, [stuck] N ...` and
  "removed N agents" (the run removes its bots; check `stack.py status` shows 0 agents if it died).
- `python scripts/run_report.py DIR/NAME`: busy by 10-minute bin, failures, repeat failures of one key. Read it before
  the logs.
- Ladder runs: `python .claude/skills/live-run/rung_times.py DIR/NAME [--log AGENT_LOG]` prints the minute each rung
  became the village's ambition, each stage and rung line, and each vote's tally. `python scripts/ladder_use.py
  DIR/NAME --log AGENT_LOG` adds the iron work by member and specialisation.
- The agent log is `runs/<date>/testagents-w<world>-<HHMMSS>.log` (the runner log names it). Count `[stuck]`, `[lag]`,
  `[choice-ban]` and the area's own tags.

## 6. Report

Lead with the outcome (reached / not, at what minute), then a short table (stage or rung minutes, busy %, `[stuck]`/`[lag]`,
cost), what stands out, and what was not tested. Give the world's addresses when the user may want to watch:
`192.168.1.84:<paper port>` and `http://192.168.1.84:<agent port>/panel` beside the 127.0.0.1 ones.
