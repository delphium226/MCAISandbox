"""Survival stage (c) (spec runs/2026-10-31/survival/spec_c.md 6): trim Paper's entity tracking range for monsters.

Every bot parses the moves of every entity in tracking range; with mobs at night that is the new per-bot cost at 25 bots
(the survival research's section 3). spigot.yml's world-settings.default.entity-tracking-range.monsters goes from 96 to
RANGE (default 48) in each server folder given, or in every one under mc/ (server, testserver, testserver2-5). Takes effect
at the next Paper start. A line is printed per file: its old value and the new one.

  python scripts/mob_tracking.py [RANGE] [mc/testserver3 ...]
"""
import os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
args = sys.argv[1:]
rng = int(args.pop(0)) if args and args[0].isdigit() else 48
dirs = args or [os.path.join(ROOT, "mc", d) for d in sorted(os.listdir(os.path.join(ROOT, "mc"))) if re.fullmatch(r"server|testserver\d*", d)]
for d in dirs:
    p = os.path.join(d, "spigot.yml")
    if not os.path.exists(p):
        print(f"{p}: missing (Paper writes it at its first start)")
        continue
    s = open(p, encoding="utf-8").read()
    m = re.search(r"(entity-tracking-range:\s*\n(?:\s+\w+: \d+\n)*?\s+monsters: )(\d+)", s)
    if not m:
        print(f"{p}: no entity-tracking-range.monsters")
        continue
    old = m.group(2)
    if old != str(rng):
        s = s[: m.start(2)] + str(rng) + s[m.end(2):]
        open(p, "w", encoding="utf-8").write(s)
    print(f"{p}: monsters {old} -> {rng}")
