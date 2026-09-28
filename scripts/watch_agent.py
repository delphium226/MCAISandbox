"""Spawn (or attach to) a tiered agent and stream its notable events until it finishes, gets stuck, or times out.

Usage: python scripts/watch_agent.py SPEC_JSON [MAX_MINUTES=6] [EXPECTED_BUILDS=3]
  e.g. SPEC_JSON = {"name":"Architect","brain":"tiered","gamemode":"creative","memory":{"objective":"build a small village"}}
Stops early when EXPECTED_BUILDS build/build_box/build_design actions have succeeded, after 5 failures in a row, or when the
executor keeps retrying calls that are blocked.
"""
import json, os, subprocess, sys, time, urllib.error, urllib.request

API = os.environ.get("MCAI_API", "http://localhost:8765/api")  # real Minecraft: http://localhost:8766/api
spec = json.loads(sys.argv[1])
minutes = float(sys.argv[2]) if len(sys.argv) > 2 else 6
expected = int(sys.argv[3]) if len(sys.argv) > 3 else 3
name = spec["name"]


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or "null")


def bring_player(agent):
    """If the watching player (MCAI_PLAYER, default SausageOfDoom4) is in the game, teleport them to the agent."""
    player = os.environ.get("MCAI_PLAYER", "SausageOfDoom4")
    rc = [sys.executable, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "mc", "rcon.py")]
    try:
        online = subprocess.run(rc + ["list"], capture_output=True, text=True, timeout=10).stdout
        if player and player in online:
            print(subprocess.run(rc + [f"tp {player} {agent}"], capture_output=True, text=True, timeout=10).stdout.strip(), flush=True)
    except Exception as e:
        print(f"could not bring {player} to {agent}: {e}", flush=True)


try:
    print(call("/agents", spec), flush=True)
except urllib.error.HTTPError as e:
    if e.code != 409:
        raise
    print(f"attached to running agent {name}", flush=True)
bring_player(name)

t0, seen, builds, fails_in_row, reason = time.time(), 0, 0, 0, "time limit"
while time.time() - t0 < minutes * 60:
    time.sleep(5)
    for e in call(f"/agents/{name}/events?since={seen}"):
        seen = e["id"]
        if e["type"] not in ("action_done", "action_failed", "system", "chat"):
            continue
        print(f"{(time.time() - t0) / 60:4.1f}m {e['type']} | {e['text'][:300]}", flush=True)
        if e["type"] == "action_failed":
            fails_in_row += 1
        elif e["type"] == "action_done":
            fails_in_row = 0
            if e["text"].startswith(("build finished", "build_box finished", "build_design finished")) and "placed 0 blocks" not in e["text"]:
                builds += 1
    stats = (call(f"/agents/{name}/memory").get("stats") or {})
    if builds >= expected:
        reason = f"done: {builds} structures built"
        break
    if fails_in_row >= 5:
        reason = "stuck: 5 failures in a row"
        break
    if stats.get("repeatsRefused", 0) >= 3:
        reason = "stuck: keeps retrying blocked calls"
        break

m = call(f"/agents/{name}/memory")
print(f"\nSTOPPED after {(time.time() - t0) / 60:.1f}m ({reason})")
print("PLAN", json.dumps(m.get("plan")))
print("PLOTS", json.dumps(m.get("plots")))
print("NOTES", m.get("notes"))
print("STATS", json.dumps(m.get("stats")))
