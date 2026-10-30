"""#179 live: a person's house request with a place, and status questions, posted through /api/say while a staged run's
after phase goes (the village complete, growth on, members without a house).

1. "mayor, please build a house here", standing ~45 blocks from home on the side with the fewest layouts (or --at X,Z);
2. "where?" at once (nothing is under way yet: the answer must not say it is being built);
3. "how's my house coming along?" once the street is laid out and building (the answer carries code's progress facts);
4. at the end: the request's record, the street's layout and its distance from the place asked.

Usage: MCAI_API=http://127.0.0.1:8770/api python scripts/checks/talk_place.py VILLAGE [--at X,Z] [--minutes 30] [--from NAME]
       [--follow RID] (with --at: follow a request already posted, from step 3)
Ends with a TALK PLACE line: OK when the street lies within 32 blocks of the place asked and no answer claimed a build the
facts did not show.
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.request

API = os.environ.get("MCAI_API", "http://127.0.0.1:8770/api").rstrip("/")
CLAIMS = re.compile(r"(being built|under way|underway|rising|going up|right where|under construction|we('re| are) building|builders are)", re.I)


def get(path):
    with urllib.request.urlopen(API + path, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode("utf-8", "replace")}


def village(name):
    for v in get("/village"):
        if v["name"].lower() == name.lower():
            return v
    return None


def home(v):
    p = (v.get("layouts") or v.get("plots") or [None])[0]
    return ((p["x1"] + p["x2"]) // 2, (p["z1"] + p["z2"]) // 2) if p else None


def request(rid, village_name):
    for r in get(f"/requests?village={village_name}")["requests"]:
        if r["id"] == rid:
            return r
    return None


def answer(rid, village_name, wait=60):
    end = time.time() + wait
    while time.time() < end:
        r = request(rid, village_name)
        if r and r.get("status") not in (None, "heard"):
            return r
        time.sleep(1)
    return request(rid, village_name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("village")
    ap.add_argument("--at")
    ap.add_argument("--minutes", type=float, default=30)
    ap.add_argument("--from", dest="who", default="SausageOfDoom4")
    ap.add_argument("--follow")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    t0 = time.time()
    v = None
    while time.time() - t0 < 1800:
        try:
            v = village(a.village)
            if v and v.get("complete") and len(get("/agents")) > 1:
                break
        except Exception:
            pass
        time.sleep(10)
    if not v or not v.get("complete"):
        print("TALK PLACE FAIL: the village never stood complete")
        return 1
    time.sleep(20)
    h = home(v)
    if a.at:
        x, z = (int(q) for q in a.at.split(","))
    else:
        cs = [((p["x1"] + p["x2"]) / 2, (p["z1"] + p["z2"]) / 2) for p in v.get("layouts") or []]
        best = max(range(8), key=lambda k: min((math.hypot(h[0] + 45 * math.cos(k * math.pi / 4) - c[0], h[1] + 45 * math.sin(k * math.pi / 4) - c[1]) for c in cs), default=0))
        x, z = round(h[0] + 45 * math.cos(best * math.pi / 4)), round(h[1] + 45 * math.sin(best * math.pi / 4))
    print(f"home {h}; asking at {x},{z} ({round(math.hypot(x - h[0], z - h[1]))} blocks from home)", flush=True)
    bad = []
    if a.follow:
        rid = a.follow
        return follow(a, rid, x, z, h, t0, bad)
    out = post("/say", {"from": a.who, "to": a.village, "text": "mayor, please build a house here", "pos": {"x": x, "y": 70, "z": z}})
    print("say:", out, flush=True)
    rid = out.get("request")
    r1 = answer(rid, a.village) if rid else None
    print("r1:", json.dumps({k: r1.get(k) for k in ("status", "kind", "answer", "place")} if r1 else None), flush=True)
    if not r1 or r1.get("status") != "queued" and r1.get("status") != "under_way":
        print(f"TALK PLACE FAIL: the house request was not taken ({r1 and r1.get('status')}: {r1 and (r1.get('reason') or r1.get('answer'))})")
        return 1
    if "right here" in (r1.get("answer") or "").lower() and "as near" not in (r1.get("answer") or ""):
        bad.append("r1 promised 'right here' without code's place")
    out = post("/say", {"from": a.who, "to": a.village, "text": "where?", "pos": {"x": x, "y": 70, "z": z}})
    q = answer(out.get("request"), a.village) if out.get("request") else None
    print("where? ->", q and q.get("answer"), flush=True)
    # (the street may already be under way by now: judge the claim against the facts the answer carries)
    if q and CLAIMS.search(q.get("say") or "") and "being built" not in (q.get("answer") or "").split(" - ", 1)[-1]:
        bad.append(f"'where?' claimed a build the facts did not show: {q.get('answer')}")
    return follow(a, rid, x, z, h, t0, bad)


def follow(a, rid, x, z, h, t0, bad):
    asked_mid = False
    end = time.time() + a.minutes * 60
    while time.time() < end:
        r = request(rid, a.village)
        if r.get("status") in ("done", "failed"):
            break
        v = village(a.village)
        act = (v.get("growth") or {}).get("active")
        if not asked_mid and act and not act.get("project") and r.get("layout") == act.get("layout"):
            tasks = {t["id"]: t["status"] for t in v.get("tasks", [])}
            if any(tasks.get(b) == "done" for b in act.get("builds", [])) or time.time() - t0 > 300:
                out = post("/say", {"from": a.who, "to": a.village, "text": "how's my house coming along?", "pos": {"x": x, "y": 70, "z": z}})
                q = answer(out.get("request"), a.village) if out.get("request") else None
                print("how's it going? ->", q and q.get("answer"), flush=True)
                asked_mid = True
        time.sleep(15)
    r = request(rid, a.village)
    v = village(a.village)
    print("r1 at the end:", json.dumps({k: r.get(k) for k in ("status", "layout", "outcome", "answer")}), flush=True)
    # (a street laid outward is a layout a house: from the request's first to the next growth layout)
    dist = None
    if r.get("layout"):
        g = v.get("growth") or {}
        later = [q["layout"] for q in g.get("past", []) + ([g["active"]] if g.get("active") else []) if q["layout"] > r["layout"]]
        lays = (v.get("layouts") or [])[r["layout"] - 1:(min(later) if later else len(v.get("layouts") or []) + 1) - 1]
        cs = [((q["x1"] + q["x2"]) / 2, (q["z1"] + q["z2"]) / 2) for q in lays]
        ds = [math.hypot(c[0] - x, c[1] - z) for c in cs]
        dist = round(min(ds))
        print(f"the street: layouts {r['layout']}-{r['layout'] + len(cs) - 1}, {len(cs)} at {', '.join(f'{c[0]:.0f},{c[1]:.0f}' for c in cs)}: {round(min(ds))}-{round(max(ds))} blocks from the place asked, mean {round(sum(ds) / len(ds))} (home {round(math.hypot(x - h[0], z - h[1]))} from it)", flush=True)
    if dist is None:
        bad.append("no street was laid out for r1")
    elif dist > 16:
        bad.append(f"the street's nearest house lies {dist} blocks from the place asked")
    out = post("/say", {"from": a.who, "to": a.village, "text": "what happened to the house I asked for?", "pos": {"x": x, "y": 70, "z": z}})
    q = answer(out.get("request"), a.village) if out.get("request") else None
    print("what happened? ->", q and q.get("answer"), flush=True)
    print(f"TALK PLACE {'OK' if not bad else 'FAIL: ' + '; '.join(bad)}", flush=True)
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
