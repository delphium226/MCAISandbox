"""The foundry's request queue, offline (scripts/foundry_requests.py): one request a capability with its sources merged;
the rank across sources (a pin first, then the ladder's chosen rung, an offered rung, an accepted proposal, the wanted
list by its rank, the oldest on ties); a blocked request never pulled and its reason kept; statuses with their history;
a closed request not reopened by a new source; the store written ranked, CRLF, and read back. Works on a temporary file.
Usage: python scripts/checks/foundry_requests_check.py      (one line a check, "FOUNDRY_REQUESTS OK" or exit 1)
"""
import pathlib, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import foundry_requests as R  # noqa: E402

fails = []


def ok(cond, what):
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        fails.append(what)


d = {"version": 1, "requests": []}
R.add_source(d, "mud", "wanted", "B25x2", score=1.2)
R.add_source(d, "honeycomb", "wanted", "B25x2", score=3.5)
R.add_source(d, "honeycomb", "wanted", "B25x2", score=3.6)
R.add_source(d, "honeycomb", "wanted", "Other", score=2.0)
ok(len(d["requests"]) == 2 and len(R.find(d, "honeycomb")["sources"]) == 2 and R.find(d, "honeycomb")["sources"][0]["score"] == 3.6, "one request a capability, sources merged by kind and ref")
ok(R.top(d)["capability"] == "honeycomb", "the wanted list by rank")
R.add_source(d, "wool", "proposal", "p3", score=1)
ok(R.top(d)["capability"] == "wool", "an accepted proposal above the wanted list")
R.add_source(d, "obsidian", "ladder", "rung:enchantment", detail="offered")
ok(R.top(d)["capability"] == "obsidian", "an offered rung above a proposal")
R.add_source(d, "nether_thing", "ladder", "rung:nether", score=-3, detail="planned")
R.add_source(d, "spyglass_thing", "ladder", "rung:copper", score=-1, detail="planned")
ok(R.top(d)["capability"] == "obsidian", "an offered rung above planned ones")
R.find(d, "obsidian")["status"] = "rejected"
ok(R.top(d)["capability"] == "spyglass_thing", "planned rungs by depth: the lower rung first, above proposals")
R.find(d, "obsidian")["status"] = "requested"
R.add_source(d, "deep_mine", "ladder", "rung:diamond", detail="chosen")
ok(R.top(d)["capability"] == "deep_mine", "the chosen rung above an offered one")
R.find(d, "mud")["pinned"] = True
ok(R.top(d)["capability"] == "mud", "a pin above everything")
R.set_blocked(d, "mud", "no ticket template for its verb use_on_block")
ok(R.top(d)["capability"] == "deep_mine" and R.find(d, "mud")["blocked"].startswith("no ticket"), "a blocked request is not pulled, its reason kept")
R.set_status(d, "deep_mine", "ticketed", "ticket written", "foundry_queue", ticket="scripts/foundry/tickets/deep_mine.json")
ok(R.top(d)["capability"] == "obsidian", "a ticketed request is not pulled again")
R.set_status(d, "deep_mine", "in_foundry", "a run on agy", "foundry")
R.set_status(d, "deep_mine", "merged", "merged at abc1234", "foundry", commit="abc1234")
r = R.find(d, "deep_mine")
ok([h["status"] for h in r["history"]] == ["requested", "ticketed", "in_foundry", "merged"] and r["commits"] == ["abc1234"] and r["ticket"].endswith("deep_mine.json"), "statuses with their history, ticket and commit")
R.add_source(d, "deep_mine", "wanted", "B25x2", score=9)
ok(R.find(d, "deep_mine")["status"] == "merged" and R.top(d)["capability"] != "deep_mine", "a merged request is not reopened by a new source")
R.set_status(d, "obsidian", "failed", "the live check failed", "foundry")
R.set_status(d, "wool", "rejected", "the user's call", "user")
ok(R.top(d)["capability"] not in ("obsidian", "wool") and R.find(d, "obsidian")["status"] == "failed", "failed and rejected requests leave the queue")
try:
    R.set_status(d, "honeycomb", "nonsense", "x", "y")
    ok(False, "an unknown status is refused")
except SystemExit:
    ok(True, "an unknown status is refused")

with tempfile.TemporaryDirectory() as t:
    p = pathlib.Path(t) / "requests.json"
    R.save(d, p)
    raw = p.read_bytes()
    back = R.load(p)
    ok(b"\r\n" in raw and back["requests"][0]["status"] == "requested" and [r["order"] for r in back["requests"]] == list(range(1, len(back["requests"]) + 1)), "saved ranked with each request's order, CRLF, read back")
    ok([r["status"] for r in back["requests"][:2]] == ["requested", "requested"] and back["requests"][-1]["status"] in ("merged", "failed", "rejected"), "open requests first in the file")

# The committed store reads and is ranked
real = R.load()
ok(len(real["requests"]) >= 6 and all(r["status"] in R.STATUSES for r in real["requests"]), f"scripts/foundry/requests.json: {len(real['requests'])} requests, valid statuses")

print("FOUNDRY_REQUESTS OK" if not fails else f"FOUNDRY_REQUESTS FAILED: {len(fails)}")
sys.exit(1 if fails else 0)
