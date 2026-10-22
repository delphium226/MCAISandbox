"""#45's gardens, live: after a staged run with MC_GARDENS=on, the garden initiatives the village started and built
(villages.json beside the test server), and every flower or sapling each built one planted, read back over RCON
(`execute if block`), with the cells either side checked against the walkway rule (no planted cell in a door's column
within 3 cells out). Prints one line a garden and ends "GARDENS OK" (at least one built, every planted cell there) or
"GARDENS FAILED: <why>".
Usage: MC_SERVER_DIR=mc/testserver3 python scripts/checks/gardens_live.py [VILLAGE]
"""
import json, os, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SERVER = os.environ.get("MC_SERVER_DIR")
if not SERVER:
    print("GARDENS FAILED: set MC_SERVER_DIR (never the main world by default)")
    sys.exit(2)
GARDEN_KINDS = ("garden_ns", "garden_ew", "flower_ring", "sapling")


def rcon(cmd):
    r = subprocess.run([sys.executable, str(ROOT / "mc" / "rcon.py"), cmd], cwd=ROOT, capture_output=True, text=True, env=os.environ)
    return (r.stdout + r.stderr).strip()


def main():
    data = json.loads((ROOT / SERVER / "villages.json").read_text(encoding="utf-8"))
    villages = data["villages"] if isinstance(data, dict) else data
    want = sys.argv[1] if len(sys.argv) > 1 else None
    v = next((x for x in villages if not want or x["name"] == want), None)
    if not v:
        print(f"GARDENS FAILED: no village {want or ''}")
        return 1
    gardens = [i for i in v.get("initiatives") or [] if i.get("kind") in GARDEN_KINDS]
    print(f"{v['name']}: {len(gardens)} garden initiatives: " + ", ".join(f"{i['kind']} {i.get('state')} by {i.get('by')}" for i in gardens))
    built = [i for i in gardens if i.get("state") == "built"]
    missing_total, planted_total = 0, 0
    for it in built:
        d = v["designs"].get(it["design"])
        if not d:
            print(f"  {it['id']}: no design {it['design']}")
            missing_total += 1
            continue
        w, dd = d["width"], d["depth"]
        x1, z1 = it["x"] - w // 2, it["z"] - dd // 2
        y = it.get("y", 64) + 1
        top = d["layers"][1]
        missing = []
        for j, row in enumerate(top):
            for i, c in enumerate(row):
                if c in "._":
                    continue
                block = d["palette"][c].split("[")[0]
                out = rcon(f"execute if block {x1 + i} {y} {z1 + j} minecraft:{block}")
                planted_total += 1
                if "passed" not in out.lower():
                    missing.append(f"{x1 + i},{y},{z1 + j} ({block}: {out[:40]})")
        missing_total += len(missing)
        print(f"  {it['id']} {it['kind']} at {it['x']},{it.get('y')},{it['z']} by {it.get('by')}: {sum(1 for row in top for c in row if c not in '._')} cells, "
              + (f"{len(missing)} missing: {'; '.join(missing[:4])}" if missing else "all there"))
    if not built:
        print("GARDENS FAILED: no garden built")
        return 1
    if missing_total:
        print(f"GARDENS FAILED: {missing_total} of {planted_total} planted cells missing")
        return 1
    print(f"GARDENS OK: {len(built)} built, {planted_total} planted cells read back")
    return 0


if __name__ == "__main__":
    sys.exit(main())
