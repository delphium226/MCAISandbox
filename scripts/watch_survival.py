"""Spawn a tiered agent in survival and follow its progression (unique items obtained, as in Project Sid) until it holds
TARGET, gets stuck, or the time runs out.

Usage: python scripts/watch_survival.py NAME [MAX_MINUTES=8] [TARGET=stone_pickaxe] [SPEC_JSON]
SPEC_JSON is merged into the spawn request (e.g. '{"position":{"x":100,"z":40}}' or other models in "memory").
Set MCAI_API=http://localhost:8766/api for real Minecraft (default: the sandbox on port 8765).
Stops early on the target, after 6 failures in a row, when the executor keeps retrying blocked calls (5 refusals), or when nothing new
has been obtained for 4 minutes. The agent is removed at the end.
"""
import json, os, sys, time, urllib.error, urllib.request

API = os.environ.get("MCAI_API", "http://localhost:8765/api")
name = sys.argv[1]
minutes = float(sys.argv[2]) if len(sys.argv) > 2 else 8
target = sys.argv[3] if len(sys.argv) > 3 else "stone_pickaxe"
extra = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
# reset: real Minecraft keeps a name's inventory and position between runs; start each test afresh at the spawn
spec = {"name": name, "role": "survivor", "brain": "tiered", "gamemode": "survival", "reset": True,
        "memory": {"execModel": "ollama:qwen3:30b-instruct", "planModel": "ollama:gemma4:31b"}}
spec = {**spec, **extra, "memory": {**spec["memory"], **extra.get("memory", {})}}


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or "null")


print(call("/agents", spec), flush=True)
t0, seen, fails_in_row, reason = time.time(), 0, 0, "time limit"
first = {}  # item -> minutes when first held
stamp = lambda: (time.time() - t0) / 60
try:
    while stamp() < minutes:
        time.sleep(4)
        for e in call(f"/agents/{name}/events?since={seen}"):
            seen = e["id"]
            if e["type"] in ("action_done", "action_failed", "system", "chat", "death", "crafted"):
                print(f"{stamp():4.1f}m {e['type']:13} {e['text'][:260]}", flush=True)
            if e["type"] == "action_failed":
                fails_in_row += 1
            elif e["type"] == "action_done":
                fails_in_row = 0
            if e["type"] in ("pickup", "crafted") and e.get("data", {}).get("item"):
                first.setdefault(e["data"]["item"], round(stamp(), 1))
        inv = call(f"/agents/{name}/observe").get("inventory", {})
        for item in inv:
            if item not in first:
                first[item] = round(stamp(), 1)
                print(f"{stamp():4.1f}m NEW ITEM      {item} ({len(first)} unique)", flush=True)
        stats = call(f"/agents/{name}/memory").get("stats") or {}
        if target in inv:
            reason = f"done: holds {target}"
            break
        if fails_in_row >= 6:
            reason = "stuck: 6 failures in a row"
            break
        if stats.get("repeatsRefused", 0) >= 5:
            reason = "stuck: keeps retrying blocked calls"
            break
        if first and stamp() - max(first.values()) > 4:
            reason = "stuck: nothing new for 4 minutes"
            break
    m = call(f"/agents/{name}/memory")
    print(f"\nSTOPPED after {stamp():.1f}m ({reason})")
    print(f"UNIQUE ITEMS ({len(first)}):", ", ".join(f"{k} {v}m" for k, v in sorted(first.items(), key=lambda kv: kv[1])))
    print("PLAN", json.dumps(m.get("plan")))
    print("STATS", json.dumps(m.get("stats")))
    print("LAST DECISIONS")
    for d in m.get("recentDecisions") or []:
        print("  " + d[:300])
finally:
    try:
        call(f"/agents/{name}", method="DELETE")
    except urllib.error.URLError:
        pass
