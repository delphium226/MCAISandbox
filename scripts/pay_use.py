"""Members' payments in a run (#108/#111, spec runs/2026-10-23/payments/spec.md section 14), from the village's payments
ledger (villages.json: v.pay) and the acts log (X.acts.jsonl).

  python scripts/pay_use.py VILLAGES_JSON ACTS_JSONL [--village NAME] [--temperaments FILE_OR_API_URL]

VILLAGES_JSON is the agent server's villages.json at the run's end (mc/testserver2/villages.json for test world 2, or a
checkpoint's copy). Prints, per village with a ledger:
  - emeralds moved between members an hour, by kind (goods contract, wage, bounty, gift, gift after work, goods given);
  - the bounty against control requests: share accepted (all, and by model decisions only), minutes to acceptance, share
    delivered;
  - prices set, by option, over the run (the guide is not logged: compare with the prompt's guide line in the choices log);
  - wealth spread: the Gini of members' own emeralds (chest plus escrow) at the end, and every 10 minutes from the ledger
    (payments and the purse only: merchant sales are not on the ledger), the top member's share;
  - who pays whom: pairs, the top pair's share, payers' and payees' concentration (HHI), wealth-preset members if given;
  - wages: steps paid, helpers per wage request against helpers on unpaid help;
  - the levy: taken on contracts, merchant_own's sales levy, deposited into storage, still owed; gifts after work;
  - collusion pairs: pairs whose payments to each other are over half of either side's volume.
"""
import argparse
import json
import sys
import urllib.request
from collections import Counter, defaultdict


def gini(xs):
    xs = sorted(max(0, x) for x in xs)
    n, s = len(xs), sum(xs)
    if not n or not s:
        return 0.0
    return sum((2 * i - n + 1) * x for i, x in enumerate(xs)) / (n * s)


def hhi(c):
    t = sum(c.values())
    return sum((q / t) ** 2 for q in c.values()) if t else 0.0


def load_acts(path, village):
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if village and r.get("village") not in (None, village):
                continue
            out.append(r)
    return out


def temperaments(src):
    if not src:
        return {}
    try:
        if src.startswith("http"):
            with urllib.request.urlopen(src, timeout=10) as r:
                d = json.loads(r.read())
        else:
            d = json.load(open(src, encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"(temperaments unread: {e})")
        return {}
    rows = d.get("temperaments", d) if isinstance(d, dict) else d
    out = {}
    if isinstance(rows, dict):
        rows = [dict(name=k, **(v if isinstance(v, dict) else {"preset": v})) for k, v in rows.items()]
    for r in rows or []:
        if isinstance(r, dict) and r.get("name"):
            out[r["name"]] = r.get("preset") or r.get("drive") or r.get("kind") or ""
    return out


def report(v, acts, temps):
    pay = v.get("pay") or {}
    L = pay.get("ledger") or []
    K = {c["id"]: c for c in pay.get("contracts") or []}
    homes = v.get("homes") or {}
    if not L:
        print(f"{v.get('name')}: no payments ledger")
        return
    t0 = min(r["t"] for r in L)
    t1 = max([r["t"] for r in L] + [r.get("t", t0) for r in acts if r.get("t")])
    hours = max(1e-9, (t1 - t0) / 3600000)
    print(f"== {v.get('name')}: {len(L)} ledger rows over {(t1 - t0) / 60000:.1f} min, {len(K)} contracts")

    # moved between members, by kind
    kinds = Counter()
    edges = Counter()
    for r in L:
        op = r["op"]
        if op == "release":
            k = K.get(r.get("contract"), {}).get("kind", "?")
            kinds[{"goods": "goods contract", "wage": "wage", "bounty": "bounty"}.get(k, k)] += r["n"]
            if k != "bounty":
                edges[(r.get("from"), r.get("to"))] += r["n"]
        elif op in ("gift", "gift after work"):
            kinds[op] += r["n"]
            edges[(r.get("from"), r.get("to"))] += r["n"]
        elif op == "goods":
            kinds[f"goods given ({r.get('item')})"] += r["n"]
    print("moved an hour: " + (", ".join(f"{k} {q / hours:.1f}" for k, q in kinds.most_common()) or "nothing"))

    # bounty against control
    reqs = {r["id"]: r for r in acts if r.get("type") == "act" and r.get("act") == "request" and r.get("verdict") == "ok" and r.get("id")}
    bounty_c = {r["contract"] for r in L if r.get("contract") and "bounty" in (r.get("why") or "")}
    arms = {"bounty": [rid for rid, r in reqs.items() if r.get("contract") in bounty_c], "control": [r["why"] for r in L if r["op"] == "control" and r.get("why") in reqs]}
    scripted = {r.get("decisionId") for r in acts if r.get("type") == "decision" and r.get("scripted")}
    acc = {}
    for r in acts:
        if r.get("type") == "act" and r.get("act") == "accept" and r.get("verdict") == "ok" and r.get("ref") and r["ref"] not in acc:
            acc[r["ref"]] = {"t": r["t"], "model": not r.get("fixed") and r.get("decisionId") not in scripted}
    made = {}
    for r in acts:
        if r.get("type") == "commitment" and r.get("op") == "made" and str(r.get("how", "")).startswith("accepted "):
            made[r["how"].split()[1]] = r["id"]
    kept = {r["id"] for r in acts if r.get("type") == "commitment" and r.get("op") == "kept"}
    for arm, ids in arms.items():
        if not ids:
            continue
        a = [i for i in ids if i in acc]
        am = [i for i in a if acc[i]["model"]]
        mins = sorted((acc[i]["t"] - reqs[i]["t"]) / 60000 for i in a)
        dl = [i for i in a if made.get(i) in kept]
        med = f"{mins[len(mins) // 2]:.1f}" if mins else "-"
        print(f"{arm}: {len(ids)} requests, accepted {len(a)} ({len(a) / len(ids):.0%}), by model decisions {len(am)} ({len(am) / len(ids):.0%}), median {med} min to acceptance, delivered {len(dl)} ({len(dl) / len(ids):.0%})")

    # prices
    by = defaultdict(list)
    for r in reqs.values():
        if r.get("price") and r.get("contract") not in bounty_c:
            by[r.get("option")].append((round((r["t"] - t0) / 60000), r["price"], r.get("steps", 1)))
    if by:
        print("prices set (minute:price): " + "; ".join(f"{o} " + " ".join(f"{m}:{p}{'x' + str(s) if s > 1 else ''}" for m, p, s in sorted(xs)) for o, xs in sorted(by.items())))

    # wealth spread at the end (chests + escrow) and over time from the ledger
    esc = Counter()
    for c in K.values():
        if c.get("state") in ("open", "taken", "delivering") and c.get("payer") != "village":
            esc[c["payer"]] += c.get("escrow", 0)
    worth = {n: (h.get("chest") or {}).get("items", {}).get("emerald", 0) + esc[n] for n, h in homes.items() if h.get("chest")}
    if worth:
        top = max(worth, key=worth.get)
        tot = sum(worth.values())
        print(f"own emeralds at the end: {tot} over {len(worth)} members, Gini {gini(worth.values()):.2f}, top {top} {worth[top]} ({worth[top] / tot:.0%})" if tot else "own emeralds at the end: none")
    w = Counter()
    series = []
    nxt = t0
    for r in sorted(L, key=lambda x: x["t"]):
        while r["t"] >= nxt:
            if w:
                series.append(f"{round((nxt - t0) / 60000)}m {gini(w.values()):.2f}")
            nxt += 600000
        # (worth is chest plus escrow: escrow and refunds leave it; a release moves the kept part to the payee and the
        # payer loses that and the levy row's part)
        op, n = r["op"], r["n"]
        payer = K.get(r.get("contract"), {}).get("payer")
        if op == "minted" and r.get("to"):
            w[r["to"]] += n
        elif op == "release" and r.get("to"):
            w[r["to"]] += n
            if payer not in (None, "village"):
                w[payer] -= n
        elif op == "levy" and payer not in (None, "village"):
            w[payer] -= n
        elif op in ("gift", "gift after work"):
            w[r["from"]] -= n
            w[r["to"]] += n
    if series:
        print("Gini of payment-ledger worth every 10 min: " + ", ".join(series))

    # who pays whom
    if edges:
        payers, payees = Counter(), Counter()
        for (a, b), q in edges.items():
            payers[a] += q
            payees[b] += q
        (pa, pb), pq = edges.most_common(1)[0]
        tot = sum(edges.values())
        print(f"who pays whom: {len(edges)} pairs, {tot} emeralds; top pair {pa}->{pb} {pq} ({pq / tot:.0%}); payers HHI {hhi(payers):.2f}, payees HHI {hhi(payees):.2f}")
        print("  " + ", ".join(f"{a}->{b} {q}" for (a, b), q in edges.most_common(12)))
        if temps:
            wl = {n for n, p in temps.items() if "wealth" in str(p).lower()}
            if wl:
                print(f"  wealth-preset members: paid {sum(q for (a, _), q in edges.items() if a in wl)}, were paid {sum(q for (_, b), q in edges.items() if b in wl)} (of {tot}; {len(wl)} of {len(temps)} members)")
        vol = Counter()
        for (a, b), q in edges.items():
            vol[a] += q
            vol[b] += q
        col = []
        for (a, b), q in edges.items():
            if a < b or (b, a) not in edges:
                both = q + edges.get((b, a), 0)
                if both > 0.5 * vol[a] or both > 0.5 * vol[b]:
                    col.append(f"{a}<->{b} {both}")
        print("collusion pairs (over half of either's volume): " + (", ".join(col) or "none"))

    # wages
    wages = [c for c in K.values() if c.get("kind") == "wage"]
    if wages:
        helpers = defaultdict(set)
        for r in L:
            c = K.get(r.get("contract"))
            if r["op"] == "release" and c and c.get("kind") == "wage":
                helpers[c["id"]].add(r.get("to"))
        unpaid = defaultdict(set)
        for r in acts:
            if r.get("type") == "commitment" and r.get("op") == "made" and str(r.get("option", "")).startswith("help:") and not any(c.get("request") and r.get("how", "").endswith(c["request"]) for c in wages):
                unpaid[r["option"]].add(r.get("from"))
        hp = [len(h) for h in helpers.values()]
        print(f"wages: {len(wages)} requests, {sum(c.get('paidSteps', 0) for c in wages)} of {sum(c.get('steps', 1) for c in wages)} steps paid, helpers a wage request {sum(hp) / max(1, len(wages)):.1f}; unpaid help: {len(unpaid)} projects, {sum(len(x) for x in unpaid.values()) / max(1, len(unpaid)):.1f} helpers each")

    # the levy
    sm = lambda op: sum(r["n"] for r in L if r["op"] == op)  # noqa: E731
    print(f"levy: on contracts {sm('levy')}, merchant_own's sales levy {sm('sales levy')}, deposited {sm('levy deposited')}, owed now {pay.get('levyOwed', 0)}; gifts after work {sum(1 for r in L if r['op'] == 'gift after work')} ({sm('gift after work')} emeralds)")
    print(f"minted {sm('minted')} (purses {sum(r['n'] for r in L if r['op'] == 'minted' and r.get('why') == 'the purse')}), bounties from the commons {sum(r['n'] for r in L if r['op'] == 'escrow' and r.get('from') == 'the village')}, refunded {sm('refund')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("villages")
    ap.add_argument("acts")
    ap.add_argument("--village")
    ap.add_argument("--temperaments")
    a = ap.parse_args()
    d = json.load(open(a.villages, encoding="utf-8"))
    vs = d.get("villages", d) if isinstance(d, dict) else d
    vs = list(vs.values()) if isinstance(vs, dict) else vs
    temps = temperaments(a.temperaments)
    any_ = False
    for v in vs:
        if not isinstance(v, dict) or (a.village and v.get("name", "").lower() != a.village.lower()) or not v.get("pay"):
            continue
        any_ = True
        report(v, load_acts(a.acts, v.get("name")), temps)
    if not any_:
        print("no village with a payments ledger" + (f" named {a.village}" if a.village else ""))
        sys.exit(1)


if __name__ == "__main__":
    main()
