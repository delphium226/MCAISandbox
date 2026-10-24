"""Count the machine's TCP sockets in TIME_WAIT by service port, once a minute (#112: short-lived connections ran the
machine out of ephemeral ports, WinError 10048, and ended a run).

Usage: python scripts/checks/time_wait.py [MINUTES] [INTERVAL_S] [--ports 8767,25576,...]
Prints one line per sample: the total, then each service port's count split into the side holding it (srv: the
server's end closed first, cli: the client's end, which holds an ephemeral port until TIME_WAIT ends, ~2 min on
Windows). The service port of a socket is the lower of its two ports (ephemeral ports are 49152 and up by default).
--ports picks the ports to show (default: the eight busiest); the total counts every TIME_WAIT socket.
"""
import argparse, collections, re, subprocess, time

p = argparse.ArgumentParser()
p.add_argument("minutes", type=float, nargs="?", default=1)
p.add_argument("interval", type=float, nargs="?", default=60)
p.add_argument("--ports", type=lambda s: [int(x) for x in s.split(",")])
a = p.parse_args()
minutes, interval, ports = a.minutes, a.interval, a.ports

LINE = re.compile(r"TCP\s+\S+:(\d+)\s+\S+:(\d+)\s+TIME_WAIT")


def sample():
    out = subprocess.run(["netstat", "-an", "-p", "TCP"], capture_output=True, text=True).stdout
    by = collections.Counter()
    total = 0
    for m in LINE.finditer(out):
        local, remote = int(m.group(1)), int(m.group(2))
        total += 1
        port = min(local, remote)
        by[(port, "srv" if local == port else "cli")] += 1
    return total, by


end = time.time() + minutes * 60
while True:
    total, by = sample()
    shown = ports or [p for p, _ in collections.Counter({p: by[(p, "srv")] + by[(p, "cli")] for p, _ in by}).most_common(8)]
    parts = [f"{p} {by[(p, 'srv')] + by[(p, 'cli')]} (srv {by[(p, 'srv')]}, cli {by[(p, 'cli')]})" for p in shown]
    print(f"{time.strftime('%H:%M:%S')} TIME_WAIT {total}: " + "; ".join(parts), flush=True)
    if time.time() + interval > end:
        break
    time.sleep(interval)
