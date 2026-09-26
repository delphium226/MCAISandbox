"""Run one tiered-brain agent for a fixed time and report progress. Usage: python scripts/bench_agent.py NAME EXEC_MODEL MINUTES [PLAN_MODEL]
Spawns a fresh tiered agent (role toolmaker, survival) at spawn and prints plan progress and unique items every 30 s."""
import json, sys, time, urllib.request

API = "http://localhost:8765/api"
name, model, minutes = sys.argv[1], sys.argv[2], float(sys.argv[3])
memory = {"execModel": model, **({"planModel": sys.argv[4]} if len(sys.argv) > 4 else {})}


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or "null")


call("/agents", {"name": name, "role": "toolmaker", "brain": "tiered", "position": {"x": 16.5, "y": 75, "z": 0.5},
                 "memory": memory})
t0 = time.time()
while time.time() - t0 < minutes * 60:
    time.sleep(30)
    m = call(f"/agents/{name}/memory")
    met = call("/metrics")["agents"].get(name, {})
    p = m.get("plan") or {}
    print(f"{(time.time() - t0) / 60:4.1f}m  step {p.get('step')}/{len(p.get('steps', []))}  unique={met.get('uniqueItemCount')}  {p.get('goal', '')[:70]}", flush=True)

m = call(f"/agents/{name}/memory")
met = call("/metrics")["agents"][name]
events = call(f"/agents/{name}/events?since=0")
print("\nSTATS", json.dumps(m.get("stats")))
print("UNIQUE", met["uniqueItemCount"], "first obtained (ticks):", json.dumps(met["firstObtained"]))
print("DEATHS", met["deaths"], "INVENTORY", json.dumps(met["inventory"]))
print("PLANS / FAILURES / ERRORS:")
for e in events:
    if e["type"] == "system" or e["type"] == "action_failed" or e["type"] == "chat":
        print(" ", e["type"], "|", e["text"][:200])
call(f"/agents/{name}", method="DELETE")
