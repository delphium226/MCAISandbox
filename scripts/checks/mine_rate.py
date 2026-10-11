"""The mine's lines of staged run logs (plan step S.2): the MINE rate, task times and busy hand-backs stage_village.py prints at
the end of a run, worked out again from a log's events, BOARD lines and final task list, for runs from before those lines
(S.0's Van12b/c and S.1's Van12d/e are S.2's baselines). Board times are the polls' stamps (0.1 min).
Usage: python scripts/checks/mine_rate.py RUNLOG [RUNLOG ...]
"""
import os, sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from autonomy_metrics import MineStats  # noqa: E402

if len(sys.argv) < 2:
    raise SystemExit("usage: python scripts/checks/mine_rate.py RUNLOG [RUNLOG ...]")
for path in sys.argv[1:]:
    ms, tasks, stamps = MineStats.from_runlog(path)
    print(f"{os.path.basename(path)}:")
    for line in ms.lines(tasks, stamps):
        print(f"  {line}")
