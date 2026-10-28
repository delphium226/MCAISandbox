"""#164 step 3's staged check: two scripted members on one iron level, with a claim rule (and a report rule) or none.

Usage (the agent server reset with MC_RULES=on, MC_RULE_TYPES=claim,report and MCAI_ACTS_LOG=FILE, e.g. on test world 4
from the iron_age_g0 checkpoint; MC_IRON_AGE off, so the level takes one miner at a time):
  MCAI_API=http://127.0.0.1:8770/api python scripts/checks/claim_mine.py on|off MINUTES ACTS_FILE [VILLAGE]

Spawns Ada and Ben (scripted, no models) by the storage hut, puts the rules in force by the test hook with `on`
(POST /village/V/rule, a claim and a report law in train 7's words), then for MINUTES asks each idle member to dig for iron
(POST /agents/N/choice iron:dig, as a pick from its menu). Counts from the acts ledger and the answers: dig trips started,
trips blocked by the other miner (`claim blocked`), picks refused because the option was off the menu (the claim held),
claims posted, finds offered and posted; with `on`, posts the first find offered and checks the board's signs in the world
(execute if block on each sign cell). Ends with a CLAIMCHECK line.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "mc"))
API = os.environ.get("MCAI_API", "http://127.0.0.1:8770/api")


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=None if body is None else json.dumps(body).encode(), method=method or ("POST" if body is not None else "GET"),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"null")
        except Exception:
            return e.code, None


def main():
    arm, minutes, acts = sys.argv[1], float(sys.argv[2]), sys.argv[3]
    village = sys.argv[4] if len(sys.argv) > 4 else "G0"
    _, v = call(f"/village/{village}")
    hut = v["storageHut"]
    x, z = (hut["x1"] + hut["x2"]) // 2, hut["z2"] + 3
    if arm == "on":
        for what in ["Members must post a claim on the board before digging on the iron level; others wait 5 minutes.",
                     "When a member discovers a resource or a blocked tunnel, they must post it on the common board."]:
            s, r = call(f"/village/{village}/rule", {"what": what, "by": "check"})
            print(f"rule: {s} {(r or {}).get('rule', r)}", flush=True)
    names = ["Ada", "Ben"]
    for n in names:
        call(f"/agents/{n}", method="DELETE")
        s, r = call("/agents", {"name": n, "role": "builder", "brain": "tasks", "gamemode": "survival", "reset": True,
                                "position": {"x": x + 0.5 + names.index(n) * 2, "z": z + 0.5}, "memory": {"village": village, "buildSpeed": 4}})
        print(f"{n}: {s}", flush=True)
        time.sleep(4)
    started = {n: 0 for n in names}
    refused = {n: 0 for n in names}
    why = {}
    posted = False
    end = time.time() + minutes * 60
    while time.time() < end:
        for n in names:
            s, a = call(f"/agents/{n}/actions")
            if not a or a.get("current") or a.get("queued"):
                continue
            if arm == "on" and not posted:
                _, menu = call(f"/village/{village}/choices?agent={n}")
                if menu and any(o["id"] == "report:post" for o in menu.get("options", [])):
                    s, r = call(f"/agents/{n}/choice", {"id": "report:post", "reason": "the check posts its find"})
                    print(f"{n} posts its find: {s} {r}", flush=True)
                    posted = s == 200
                    continue
            s, r = call(f"/agents/{n}/choice", {"id": "iron:dig", "reason": "the check digs"})
            if s == 200:
                started[n] += 1
            elif s == 409:
                refused[n] += 1
                why[(r or {}).get("why", "?")[:90]] = why.get((r or {}).get("why", "?")[:90], 0) + 1
        time.sleep(3)
    for n in names:
        call(f"/agents/{n}/stop", {})
    led = [json.loads(l) for l in open(acts, encoding="utf-8") if l.strip()] if os.path.exists(acts) else []
    k = lambda t, op: sum(1 for e in led if e.get("type") == t and e.get("op") == op)
    _, board = call(f"/village/{village}/board")
    signs_ok = 0
    cells = [c for c in ((board or {}).get("cells") or []) if isinstance(c, dict)] if isinstance(board, dict) and isinstance(board.get("cells"), list) else []
    if cells:
        from rcon import Rcon  # noqa: E402
        rc = Rcon(os.environ.get("MC_SERVER_DIR", os.path.join(ROOT, "mc", "testserver4")))
        for c in cells:
            if "passed" in rc.command(f"execute if block {c['x']} {c['y']} {c['z']} #minecraft:all_signs").lower():
                signs_ok += 1
    print(f"refusals: {why}", flush=True)
    print(f"board: {json.dumps((board or {}).get('signs'))} cells {len(cells)}", flush=True)
    print(f"CLAIMCHECK arm={arm} started={started} refused={refused} blocked={k('claim', 'blocked')} waited={k('claim', 'waited')} "
          f"posted={k('claim', 'posted')} reportable={k('report', 'reportable')} reports_posted={k('report', 'posted')} "
          f"skipped={k('report', 'skipped')} signs_in_world={signs_ok}/{len(cells)}", flush=True)


if __name__ == "__main__":
    main()
