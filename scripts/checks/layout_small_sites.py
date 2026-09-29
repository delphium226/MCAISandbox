"""plan_layout through the API on small sites: tight streets, a partial layout, a second site, refusals. No agents.
Usage: python scripts/checks/layout_small_sites.py NEW_VILLAGE_NAME (copies the designs of village Fourfold7, which
exists only in this machine's mc/server/villages.json).
"""
import json, sys, urllib.request

API = "http://127.0.0.1:8766/api"
V = sys.argv[1]


def call(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method="POST" if body is not None else "GET", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")


src = call("/village/Fourfold7")["designs"]
print(call("/village", {"name": V, "objective": "two matching cottages and a meeting hall"}).get("name"))
for n in ("cottage", "meeting_hall"):
    d = src[n]
    call(f"/village/{V}/designs", {**d, "layers": [[" ".join(r) for r in layer] for layer in d["layers"]]})
three = ["cottage", "cottage", "meeting_hall"]


def layout(label, x, z, size, buildings=three):
    r = call(f"/village/{V}/layout", {"buildings": buildings, "x": x, "y": 70, "z": z, "size": size, "by": "Mayor"})
    print(f"\n== {label}: size {size}, {buildings}\n{r.get('result') or r}")
    v = call(f"/village/{V}")
    print("   unplaced:", v.get("unplaced"), "| layouts:", [(l["x1"], l["z1"], l["x2"], l["z2"], l["buildings"]) for l in v.get("layouts", [])])


X, Z = 3000, 3000  # far from everything: the layout only posts tasks
layout("fewer than half fit", X, Z, 12)
layout("two of three fit", X, Z, 14)
layout("all again, same site", X, Z, 14)
layout("second site, all names again", X + 40, Z, 9)
layout("a third call", X + 80, Z, 20)
v = call(f"/village/{V}")
print("\nTasks:")
for t in v["tasks"]:
    print(f"  {t['id']} {t['title']} after={t['after']} :: {t['detail'][:110]}")
