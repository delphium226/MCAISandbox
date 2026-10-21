"""
Bring a village's members back after an agent-server restart, with their memory (G1, PLAN E.2, #26).

  python scripts/respawn_agents.py VILLAGE [--only Ada,Ben] [--api URL] [--wait S]

Reads the rosters the agent server kept for the village (GET /api/memory/VILLAGE/roster: role, brain, gamemode and the
memory fields each was spawned with) and spawns each member again WITHOUT reset and without a position: its inventory
stays and it appears where Paper last saved it, and with MC_MEMORY=on its journal, notes, kind table and intention come
back (social.json). Members already in the world are left alone. Spawns 2.5 s apart (E.1's gap, MCAI_SPAWN_GAP_S).
Prints each member's notes, log entries and day lines as stored before the spawn and as the server holds them after.
Exit code 1 if any spawn failed or a member's stored journal shrank.

The API: --api, else MCAI_API, else http://127.0.0.1:8766/api (the test world's is http://127.0.0.1:8767/api).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
p.add_argument("village")
p.add_argument("--only", default="", help="comma-separated member names (default: every member with a roster)")
p.add_argument("--api", default=os.environ.get("MCAI_API", "http://127.0.0.1:8766/api"))
p.add_argument("--wait", type=float, default=60.0, help="seconds to wait for the agent server to answer (default 60)")
args = p.parse_args()
API = args.api.rstrip("/")
GAP = float(os.environ.get("MCAI_SPAWN_GAP_S", "2.5"))


def call(path, body=None, method=None, timeout=60):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()[:300], "status": e.code}


def sizes(mem):
    """name -> (live notes, log entries, day lines, kinds) from GET /api/memory/VILLAGE."""
    return {m["name"].lower(): (len(m.get("notes") or []), m.get("log") or 0, len(m.get("days") or []), sum(r["n"] for r in (m.get("kinds") or {}).values()))
            for m in (mem or {}).get("members", [])}


# The agent server may still be starting
deadline = time.time() + args.wait
while True:
    try:
        roster = call(f"/memory/{urllib.request.quote(args.village)}/roster")
        break
    except (urllib.error.URLError, ConnectionError) as e:
        if time.time() > deadline:
            raise SystemExit(f"the agent server at {API} does not answer: {e}")
        time.sleep(2)
members = roster.get("members") or []
only = {n.strip().lower() for n in args.only.split(",") if n.strip()}
if only:
    members = [m for m in members if m["name"].lower() in only]
if not members:
    raise SystemExit(f"no rosters kept for {args.village} (spawned before G1, or another world's agent server?)")
before_mem = call(f"/memory/{urllib.request.quote(args.village)}")
before = sizes(before_mem)
present = {a["name"].lower() for a in (call("/agents") or [])}
print(f"{args.village}: {len(members)} member{'s' if len(members) != 1 else ''} kept; memory {'on' if before_mem.get('on') else 'OFF (journals are not kept)'}"
      f"{', ' + before_mem['clock'] if before_mem.get('clock') else ''}", flush=True)

failed, last = [], 0.0
for m in sorted(members, key=lambda m: (m.get("memory", {}).get("villageRole") != "mayor", m["name"])):
    name = m["name"]
    if name.lower() in present:
        print(f"  {name}: already in the world", flush=True)
        continue
    time.sleep(max(0.0, last + GAP - time.time()))
    last = time.time()
    body = {"name": name, "role": m.get("role") or "builder", "brain": m.get("brain"), "memory": m.get("memory") or {}}
    if m.get("gamemode"):
        body["gamemode"] = m["gamemode"]
    r = call("/agents", body, timeout=120)
    if not r or r.get("error"):
        failed.append(name)
        print(f"  {name}: FAILED {r}", flush=True)
    else:
        print(f"  {name}: back ({m.get('role')}, {m.get('brain')})", flush=True)

after = sizes(call(f"/memory/{urllib.request.quote(args.village)}"))
shrank = []
print("member          notes  log  days  ends   (before -> after)")
for m in members:
    k = m["name"].lower()
    b, a = before.get(k, (0, 0, 0, 0)), after.get(k, (0, 0, 0, 0))
    if any(x < y for x, y in zip(a, b)):
        shrank.append(m["name"])
    print(f"  {m['name']:<13} {b[0]:>2}->{a[0]:<2} {b[1]:>3}->{a[1]:<3} {b[2]:>2}->{a[2]:<2} {b[3]:>3}->{a[3]:<3}{'  SHRANK' if m['name'] in shrank else ''}")
print(f"RESPAWN {args.village}: {len(members) - len(failed)} of {len(members)} back{f', failed: {failed}' if failed else ''}"
      f"{f'; journals shrank: {shrank}' if shrank else '; every journal kept'}", flush=True)
sys.exit(1 if failed or shrank else 0)
