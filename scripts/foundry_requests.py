"""The foundry's request queue (G6, the user's, 10-22): every capability anyone asked the foundry for, one request a
capability, its sources merged, ranked across sources, its status moved by the scripts that act on it.

Stored in scripts/foundry/requests.json (committed, like the tickets). A request:
  capability   the wanted list's id (wanted.ts CAPABILITIES: honeycomb, wool, amethyst...)
  sources      who asked: {kind, ref, at, score, detail}; kinds, in priority order:
                 user      the user (this CLI's `add` or `pin`; the panel later)
                 ladder    a rung's missing skill (G8; ref "rung:<id>", detail "chosen", "offered" or "planned": a rung
                           still ahead, scored by its depth so the lower rungs come first)
                 proposal  an accepted proposal routed to the foundry (G5's triage; ref the proposal's id)
                 wanted    a village's wanted list (ref the village; score its rank)
  status       requested -> ticketed -> in_foundry -> merged | failed | rejected; each change in `history` with its
               time, reason and who moved it
  blocked      why the queue does not pull it (no ticket template, a peaceful world cannot give it, the user's call,
               the foundry failed it): flagged with the reason, never dropped silently; it stays `requested`
  ticket, commits, pinned
Priority (`rank_key`): pinned first; then the best source's tier (user, a chosen rung, an offered rung, a planned rung
by its depth up the ladder, an accepted proposal, the wanted list); within a tier the higher score (a wanted rank, endorsements); then the oldest.

Usage: python scripts/foundry_requests.py list [--all] [--json]
       python scripts/foundry_requests.py add CAPABILITY [--why TEXT] [--pin]        (a user's request)
       python scripts/foundry_requests.py ladder CAPABILITY RUNG chosen|offered       (a rung's missing skill)
       python scripts/foundry_requests.py pin|unpin CAPABILITY
       python scripts/foundry_requests.py reject CAPABILITY --why TEXT
       python scripts/foundry_requests.py reopen CAPABILITY --why TEXT
       python scripts/foundry_requests.py show CAPABILITY
       python scripts/foundry_requests.py top                                           (the request the queue pulls next)
Pulled by scripts/foundry_queue.py (it syncs the wanted list and accepted proposals into it, tickets the top request and
marks it ticketed); scripts/foundry.py marks a ticket's request in_foundry, then merged or failed. Served at
GET /api/foundry/requests (mcApi.ts) and shown on the panel's Foundry view.
"""
import argparse, datetime, json, os, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
STORE = ROOT / "scripts" / "foundry" / "requests.json"
STATUSES = ("requested", "ticketed", "in_foundry", "merged", "failed", "rejected")
OPEN = ("requested", "ticketed", "in_foundry")
TIERS = {"user": 0, "ladder:chosen": 1, "ladder:offered": 2, "ladder:planned": 3, "proposal": 4, "wanted": 5}


def now():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")


def load(path=STORE):
    if not pathlib.Path(path).exists():
        return {"version": 1, "requests": []}
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def save(data, path=STORE):
    """Written ranked (each request's `order`: its place in the queue, open ones first), atomically, CRLF as the repo's."""
    reqs = data["requests"]
    ordered = sorted(reqs, key=rank_key)
    for i, r in enumerate(ordered):
        r["order"] = i + 1
    data["requests"] = ordered
    data["updated"] = now()
    text = json.dumps(data, indent=1, ensure_ascii=False) + "\n"
    p = pathlib.Path(path)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_bytes(text.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8"))
    os.replace(tmp, p)


def tier_of(src):
    if src["kind"] == "ladder":
        return TIERS.get(f"ladder:{src.get('detail')}", TIERS["ladder:offered"])
    return TIERS.get(src["kind"], 9)


def rank_key(r):
    """Open before closed; among open: unblocked first, pinned, then the best tier, the higher score, the oldest."""
    open_ = r["status"] in OPEN
    best = min((tier_of(s) for s in r.get("sources", [])), default=9)
    score = max((float(s.get("score") or 0) for s in r.get("sources", []) if tier_of(s) == best), default=0)
    return (0 if open_ else 1, 1 if r.get("blocked") else 0, 0 if r.get("pinned") else 1, best, -score, r.get("created", ""))


def find(data, cap):
    return next((r for r in data["requests"] if r["capability"] == cap), None)


def request(data, cap, title=None):
    """The capability's request, made `requested` if it is new."""
    r = find(data, cap)
    if r:
        if title and not r.get("title"):
            r["title"] = title
        return r
    r = {"capability": cap, "title": title or cap, "status": "requested", "created": now(), "sources": [], "history": [
        {"at": now(), "status": "requested", "why": "first asked", "by": "foundry_requests"}], "commits": []}
    data["requests"].append(r)
    return r


def add_source(data, cap, kind, ref, score=0, detail=None, title=None, why=None):
    """A source asks for a capability: merged into its one request (the same kind and ref updated in place). A closed
    request (merged, rejected) is not reopened by a source: it keeps the source as a note."""
    r = request(data, cap, title)
    src = next((s for s in r["sources"] if s["kind"] == kind and s.get("ref") == ref), None)
    if src:
        src.update({"at": now(), "score": score, **({"detail": detail} if detail else {}), **({"why": why} if why else {})})
    else:
        r["sources"].append({"kind": kind, "ref": ref, "at": now(), "score": score, **({"detail": detail} if detail else {}), **({"why": why} if why else {})})
    return r


def set_status(data, cap, status, why, by, **extra):
    if status not in STATUSES:
        raise SystemExit(f"status {status!r}: one of {', '.join(STATUSES)}")
    r = request(data, cap)
    if r["status"] == status and not extra:
        return r
    r["status"] = status
    r["history"].append({"at": now(), "status": status, "why": why, "by": by})
    if extra.get("ticket"):
        r["ticket"] = extra["ticket"]
    if extra.get("commit") and extra["commit"] not in r["commits"]:
        r["commits"].append(extra["commit"])
    if status in ("merged", "rejected"):
        r.pop("blocked", None)
    return r


def set_blocked(data, cap, why):
    """A request the queue cannot pull now, with why (None clears it)."""
    r = find(data, cap)
    if not r:
        return None
    if why:
        if r.get("blocked") != why:
            r["blocked"] = why
            r["history"].append({"at": now(), "status": r["status"], "why": f"blocked: {why}", "by": "foundry_queue"})
    elif r.get("blocked"):
        r.pop("blocked")
        r["history"].append({"at": now(), "status": r["status"], "why": "unblocked", "by": "foundry_queue"})
    return r


def ranked(data, include_closed=False):
    return [r for r in sorted(data["requests"], key=rank_key) if include_closed or r["status"] in OPEN]


def top(data):
    """The request the queue pulls next: open, `requested`, not blocked, first by rank."""
    return next((r for r in sorted(data["requests"], key=rank_key) if r["status"] == "requested" and not r.get("blocked")), None)


def line(r):
    srcs = ", ".join(f"{s['kind']}{':' + s['ref'] if s.get('ref') else ''}{'(' + s['detail'] + ')' if s.get('detail') else ''}"
                     f"{' ' + format(float(s['score']), 'g') if s.get('score') else ''}" for s in r.get("sources", []))
    extra = (f" [pinned]" if r.get("pinned") else "") + (f" BLOCKED: {r['blocked']}" if r.get("blocked") else "") \
        + (f" ticket {r['ticket']}" if r.get("ticket") else "") + (f" commits {', '.join(r['commits'])}" if r.get("commits") else "")
    return f"{r.get('order', '?'):>3}. {r['capability']:<14} {r['status']:<10} {srcs}{extra}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["list", "add", "ladder", "pin", "unpin", "reject", "reopen", "show", "top"])
    ap.add_argument("args", nargs="*")
    ap.add_argument("--why")
    ap.add_argument("--pin", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    data = load()
    if a.cmd == "list":
        rs = ranked(data, a.all)
        if a.json:
            print(json.dumps(rs, indent=1))
        else:
            print(f"{len(rs)} {'requests' if a.all else 'open requests'} ({STORE.relative_to(ROOT)}, updated {data.get('updated', '-')})")
            for r in rs:
                print(line(r))
        return 0
    if a.cmd == "top":
        r = top(data)
        print(line(r) if r else "no request the queue can pull")
        return 0
    if not a.args:
        raise SystemExit(f"{a.cmd} needs a capability")
    cap = a.args[0]
    if a.cmd == "show":
        r = find(data, cap)
        print(json.dumps(r, indent=1) if r else f"no request for {cap}")
        return 0
    if a.cmd == "add":
        r = add_source(data, cap, "user", "cli", why=a.why)
        if a.pin:
            r["pinned"] = True
            r["history"].append({"at": now(), "status": r["status"], "why": f"pinned{': ' + a.why if a.why else ''}", "by": "user"})
    elif a.cmd == "ladder":
        if len(a.args) < 3 or a.args[2] not in ("chosen", "offered"):
            raise SystemExit("ladder CAPABILITY RUNG chosen|offered")
        add_source(data, cap, "ladder", f"rung:{a.args[1]}", detail=a.args[2], why=a.why)
    elif a.cmd in ("pin", "unpin"):
        r = request(data, cap)
        r["pinned"] = a.cmd == "pin"
        r["history"].append({"at": now(), "status": r["status"], "why": a.cmd + (f": {a.why}" if a.why else ""), "by": "user"})
    elif a.cmd == "reject":
        if not a.why:
            raise SystemExit("reject needs --why (the reason is kept and shown)")
        set_status(data, cap, "rejected", a.why, "user")
    elif a.cmd == "reopen":
        if not a.why:
            raise SystemExit("reopen needs --why")
        set_status(data, cap, "requested", a.why, "user")
    save(data)
    print(line(find(data, cap)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
