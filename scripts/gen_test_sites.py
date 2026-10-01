"""Generate a test site's land in the test world (mc/testserver), so it can go into the snapshot.

Usage: python scripts/gen_test_sites.py NAME|all
Forceloads the square of each site in scripts/test_sites.json (its recorded site's centre, else its probe point, plus
or minus its radius, default 160) in tiles of at most 256 chunks, holds them 45 s so the server generates them, then
releases them and saves. Needs the test Paper running (25566 / RCON 25576); no agent server or agents needed.

Adding a site (2026-10-01; the snapshot is a copy of the whole test world, so it must be taken from untouched land):
  1. add the site to scripts/test_sites.json (name, kind, probe, site null, radius);
  2. restore every site first, so no test village is left in the world:
     `MCAI_API=http://127.0.0.1:8767/api python scripts/reset_site.py SITE --no-start` for each, then start the test
     Paper alone (`MC_SERVER_DIR=mc/testserver python scripts/detach.py LOG python mc/start.py`);
  3. python scripts/gen_test_sites.py NEWSITE;
  4. `MC_SERVER_DIR=mc/testserver python mc/rcon.py stop`, then `python mc/testserver.py snapshot`.
The first staged run there (stage_village.py --site NEWSITE) prints the find_site result to record as its `site`.
"""
import json, pathlib, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "mc"))
from rcon import Rcon  # noqa: E402

if len(sys.argv) != 2:
    raise SystemExit(__doc__)
data = json.loads((ROOT / "scripts" / "test_sites.json").read_text(encoding="utf-8"))
sites = data["sites"] if isinstance(data, dict) else data
if sys.argv[1] != "all":
    sites = [s for s in sites if s["name"].lower() == sys.argv[1].lower()]
    if not sites:
        raise SystemExit(f"no site {sys.argv[1]} in scripts/test_sites.json")
r = Rcon(ROOT / "mc" / "testserver")
for s in sites:
    c = s.get("site") or s["probe"]
    x, z, R = int(c["x"]), int(c["z"]), int(s.get("radius") or 160)
    cx1, cz1, cx2, cz2 = (x - R) >> 4, (z - R) >> 4, (x + R) >> 4, (z + R) >> 4
    n = 0
    for tx in range(cx1, cx2 + 1, 16):
        for tz in range(cz1, cz2 + 1, 16):
            ex, ez = min(tx + 15, cx2), min(tz + 15, cz2)
            out = r.send(2, f"forceload add {tx * 16} {tz * 16} {ex * 16} {ez * 16}")[1]
            n += (ex - tx + 1) * (ez - tz + 1)
            if "Marked" not in out and "already" not in out.lower():
                print("  ", out.strip()[:160])
    # Forceloaded chunks are generated over the following ticks: give them time, then let them go
    time.sleep(45)
    print(f"{s['name']}: {n} chunks around {x},{z} forceloaded, held 45 s", flush=True)
    print("  ", r.send(2, "forceload remove all")[1].strip()[:120], flush=True)
print(r.send(2, "save-all flush")[1].strip())
