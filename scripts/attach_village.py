"""Follow a village run whose watcher died: print new events of its agents (failures and builds in full) until the
village is complete, nothing succeeds for STALL minutes, or the time limit. Usage: attach.py VILLAGE MINUTES_SO_FAR
Written when a session restart killed watch_village.py mid-run (Accept4).
"""
import json, sys, time, urllib.request

API = "http://127.0.0.1:8766/api"
V, OFFSET = sys.argv[1], float(sys.argv[2])
NAMES, STALL, LIMIT = ["Mayor", "Worker1", "Worker2"], 5, 90


def call(path):
    with urllib.request.urlopen(API + path, timeout=30) as r:
        return json.loads(r.read() or b"{}")


t0 = time.time() - OFFSET * 60
stamp = lambda: f"{(time.time() - t0) / 60:4.1f}m"
seen = {n: max([e["id"] for e in call(f"/agents/{n}/events")] or [0]) for n in NAMES}
last_done, reason = time.time(), "time limit"
print(f"attached to {V} at {stamp()}", flush=True)
while time.time() - t0 < LIMIT * 60:
    time.sleep(3)
    for n in NAMES:
        try:
            evs = [e for e in call(f"/agents/{n}/events") if e["id"] > seen[n]]
        except Exception as ex:
            print(f"{stamp()} {n}: {ex}", flush=True)
            continue
        for e in evs:
            seen[n] = e["id"]
            if e["type"] == "action_done":
                last_done = time.time()
            full = e["type"] == "action_failed" or e["text"].startswith("build_design finished")
            print(f"{stamp()} {n:8} {e['type']:13} | {e['text'] if full else e['text'][:220]}", flush=True)
    v = call(f"/village/{V}")
    if v.get("complete"):
        reason = "objective declared complete"
        break
    if time.time() - last_done > STALL * 60:
        reason = f"stalled: no successful action for {STALL} minutes"
        break
print(f"\nSTOPPED after {(time.time() - t0) / 60:.1f}m ({reason})")
print("STRUCTURES", [(s["kind"], s["x1"], s["z1"], s.get("builtBy")) for s in v["structures"]])
for t in v["tasks"]:
    print(f"  {t['id']} [{t['status']}{'/' + t['claimedBy'] if t.get('claimedBy') else ''}] {t['title']}")
