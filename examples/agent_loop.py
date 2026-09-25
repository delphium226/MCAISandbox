"""
Minimal external agent controller for MCAI Sandbox (standard library only).

Runs an observe -> decide -> act loop over the REST API. Replace `decide()` with an LLM call
(e.g. send the observation + recent events as context and ask for the next skill as JSON) to build
PIANO-style agents like those in "Project Sid" (arXiv:2411.00114).

Usage:
    python examples/agent_loop.py --name Ada --role farmer --server http://localhost:8765
"""
import argparse
import json
import random
import time
import urllib.request


def call(server, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(server + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read() or b"null")


def decide(obs, new_events, memory):
    """Very small hand-written policy. Returns a list of {action, ...args} dicts (or [] to keep waiting)."""
    if obs["currentAction"] or obs["queuedActions"]:
        return []
    inv = obs["inventory"]
    # Social: answer greetings from people within earshot
    for e in new_events:
        if e["type"] == "chat" and "hello" in e["data"]["text"].lower():
            return [{"action": "chat", "message": f"Hello {e['data']['from']}! I'm {obs['name']}."}]
    logs = sum(v for k, v in inv.items() if k.endswith("_log"))
    if logs < 3 and "wooden_pickaxe" not in inv:
        return [{"action": "collect", "block": "logs", "count": 3}]
    if "wooden_pickaxe" not in inv:
        log = next(k for k in inv if k.endswith("_log"))
        return [
            {"action": "craft", "item": log.replace("_log", "_planks"), "count": 12},
            {"action": "craft", "item": "stick", "count": 4},
            {"action": "craft", "item": "crafting_table"},
            {"action": "craft", "item": "wooden_pickaxe"},
            {"action": "chat", "message": "I made a wooden pickaxe!"},
        ]
    if inv.get("cobblestone", 0) < 8:
        return [{"action": "collect", "block": "stone", "count": 8}]
    return [{"action": "explore", "distance": random.choice([16, 32])}]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default="http://localhost:8765")
    ap.add_argument("--name", default="Ada")
    ap.add_argument("--role", default="villager")
    args = ap.parse_args()

    try:
        call(args.server, "POST", "/api/agents", {"name": args.name, "role": args.role})
        print(f"spawned {args.name}")
    except Exception as ex:  # already exists -> reuse
        print("spawn:", ex)

    last_event = 0
    memory = {}
    while True:
        obs = call(args.server, "GET", f"/api/agents/{args.name}/observe?radius=12")
        events = call(args.server, "GET", f"/api/agents/{args.name}/events?since={last_event}")
        if events:
            last_event = events[-1]["id"]
            for e in events:
                print(f"[{e['type']}] {e['text']}")
        actions = decide(obs, events, memory)
        if actions:
            call(args.server, "POST", f"/api/agents/{args.name}/act", actions)
            print("->", ", ".join(a["action"] for a in actions))
        time.sleep(1.0)


if __name__ == "__main__":
    main()
