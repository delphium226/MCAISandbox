"""Start a server detached from the shell and the Claude session that started it, logging to a file.

Usage: python scripts/detach.py LOGFILE COMMAND [ARGS...]     (prints the new process's PID)
e.g.   python scripts/detach.py runs/2026-10-01/paper.log python mc/start.py
       MC_API_HOST=0.0.0.0 python scripts/detach.py runs/2026-10-01/agents.log node node_modules/tsx/dist/cli.mjs server/src/mineflayer/index.ts

Why (F90, 2026-10-01): a server started as a session's background task was stopped at the task's 30-minute limit
(Paper, killed unsaved). This one gets a hidden console of its own (not DETACHED_PROCESS: java then opened a console
window, closing it kills Paper, and its output went there instead of the log), its own process group, and leaves the
session's job where Windows allows it. The environment is inherited. A detached Paper also writes logs/latest.log.
"""
import subprocess, sys

if len(sys.argv) < 3:
    raise SystemExit(__doc__)
log, cmd = sys.argv[1], sys.argv[2:]
flags = (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
         | getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0))
out = open(log, "a")
try:
    p = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=flags)
except OSError:
    # The job does not allow leaving it
    p = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         creationflags=flags & ~getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0))
print(p.pid)
