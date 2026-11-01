"""The runs of a series side by side as one HTML page (charts and the run_report.py table): busy and chore time by 10
minutes, failed chores, choice families, tokens by bin and call kind, the event loop's p99, each member's busy share,
and survival's deaths and danger count when the world had monsters. Static: no server, no script libraries; hover a mark
for its value (SVG titles), and each chart has its numbers in a table below it.

Usage: python scripts/run_report_html.py DIR/NAME [DIR/NAME ...] [-o OUT.html]
Reads what run_series.py writes beside NAME.log: NAME.choices.jsonl, NAME.perf.jsonl, NAME.acts.jsonl, reset_NAME.log (for
the agent server's log), and the agent server's model-call record (runs/model-calls/<date>-<pid>.jsonl, found by
matching the run's first choice; without it, tokens are the chore choices' own). Writes DIR/report.html by default.
"""
import glob, html, json, os, re, statistics, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_report import report, read  # noqa: E402
from run_series import agent_log_of  # noqa: E402
from scorecard import chore_busy_bins, jsonl  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIN = 10 * 60000
# The chooser's kinds in eight families (the panel's console uses the same)
FAMILY = {"make": "making goods", "help": "building", "initiate": "building", "monument": "building", "works": "building",
          "slot": "building", "start": "building", "annex": "building", "iron": "gathering", "gather": "gathering",
          "explore": "gathering", "light": "care and light", "tidy": "care and light", "furnish": "care and light",
          "farm": "farms and pens", "pen": "farms and pens", "penwork": "farms and pens", "grow": "farms and pens",
          "activity": "new crafts", "innovate": "new crafts", "own": "own goods", "eat": "eat and rest", "rest": "eat and rest"}
FAMILIES = ["making goods", "building", "gathering", "care and light", "farms and pens", "new crafts", "own goods", "eat and rest"]
# The dataviz reference palette (light, dark): runs take slots in order; families take all eight
SLOTS = [("#2a78d6", "#3987e5"), ("#eb6834", "#d95926"), ("#1baf7a", "#199e70"), ("#eda100", "#c98500"),
         ("#e87ba4", "#d55181"), ("#008300", "#008300"), ("#6250d6", "#9085e9"), ("#e34948", "#e66767")]
e = html.escape


def model_calls_of(choices):
    """The agent server's model-call record for this run: the file holding a choose call by the first chooser at its time."""
    first = next((c for c in choices if c.get("type") == "choice" and c.get("source") == "model"), None)
    if not first:
        return None
    day = __import__("time").strftime("%Y-%m-%d", __import__("time").localtime(first["t"] / 1000))
    for path in glob.glob(os.path.join(ROOT, "runs", "model-calls", f"{day}-*.jsonl")):
        with open(path, encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f):
                if i > 400:
                    break
                if f'"agent":"{first["agent"]}"' not in line.replace(" ", ""):
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get("kind") == "choose" and abs(int(d.get("at", 0)) - first["t"]) < 3000:
                    return path
    return None


def series(name):
    """Every series one run gives, binned by 10 minutes from its first choice."""
    choices = jsonl(name + ".choices.jsonl")
    starts = [c for c in choices if c.get("type") == "choice"]
    if not starts:
        return None
    t0 = min(c["t"] for c in starts)
    t1 = max(c["t"] for c in starts)
    n = max(1, round((t1 - t0) / BIN))  # (a last bin under half full is left out: it reads as a fall to zero)
    members = sorted({c["agent"] for c in starts})
    s = {"n": n, "members": len(members)}
    s["chore"] = chore_busy_bins(choices, len(members), n * 10, t0)
    fam = {f: [0] * n for f in FAMILIES}
    for c in starts:
        f, k = FAMILY.get(c.get("kind")), int((c["t"] - t0) // BIN)
        if f and k < n:
            fam[f][k] += 1
    s["fam"] = fam
    fail = [0] * n
    byid = {c["id"]: c for c in starts}
    occ = {m: 0.0 for m in members}
    for x in choices:
        if x.get("type") != "choice-end" or x.get("id") not in byid:
            continue
        st = byid[x["id"]]
        end = x.get("tEnd") or st["t"] + (x.get("minutes") or 0) * 60000
        occ[st["agent"]] += max(0, min(end, t0 + n * BIN) - st["t"])
        if not x.get("ok") and not x.get("cut"):
            k = int((end - t0) // BIN)
            if 0 <= k < n:
                fail[k] += 1
    s["fail"] = fail
    s["memberBusy"] = sorted(round(100 * v / (n * BIN)) for v in occ.values())
    rep = read(name + ".log")
    m = re.search(r"^BUSY after by 10 min: (.*)$", rep, re.M)
    s["busy"] = [float(v) for v in re.findall(r"\d+-\d+ ([\d.]+)%", m.group(1))][:n] if m else []
    # Tokens: the model-call record, else the chore choices' own counts
    tok, kinds = [0] * n, {}
    path = model_calls_of(choices)
    if path:
        for d in jsonl(path):
            if d.get("type") == "system" or "at" not in d:
                continue
            k = int((int(d["at"]) - t0) // BIN)
            if not 0 <= k < n:
                continue
            r = d.get("reply") or {}
            v = (r.get("promptTokens") or 0) + (r.get("outputTokens") or 0)
            tok[k] += v
            kk = kinds.setdefault(d.get("kind", "?"), [0, 0])
            kk[0] += v
            kk[1] += 1
        s["tokSource"] = os.path.relpath(path, ROOT)
    else:
        for c in starts:
            v = (c.get("promptTokens") or 0) + (c.get("outputTokens") or 0)
            if int((c["t"] - t0) // BIN) < n:
                tok[int((c["t"] - t0) // BIN)] += v
            kk = kinds.setdefault("choose", [0, 0])
            kk[0] += v
            kk[1] += 1
        s["tokSource"] = "chore choices only (no model-call record found)"
    s["tok"] = [round(v / 1000) for v in tok]
    s["kinds"] = {k: (round(v[0] / 1000), v[1]) for k, v in kinds.items()}
    # The event loop's p99, 5-minute medians
    p = {}
    for d in jsonl(name + ".perf.jsonl"):
        if "at" in d and d.get("loop"):
            p.setdefault(int((d["at"] - t0) // 300000), []).append(d["loop"]["p99"])
    s["p99"] = [round(statistics.median(p[k])) for k in sorted(p) if 0 <= k < 2 * n]
    # Survival: deaths by cause and the last danger line, from the agent server's log
    alog = agent_log_of(os.path.join(os.path.dirname(name), "reset_" + os.path.basename(name) + ".log"))
    text = read(alog) if alog else ""
    deaths = re.findall(r"^\[death\] (\w+) \w+ at [-\d,]+ \(\"(.*)\"\)", text, re.M)
    s["deaths"] = [(who, re.sub(r"^\w+ ", "", why)) for who, why in deaths]
    s["kills"] = len(re.findall(r"^\[combat\] \w+ fight \w+ .*: killed", text, re.M))
    s["nights"] = len(re.findall(r"^\[night\] dusk", text, re.M))
    return s


def esc_rows(rows):
    return "".join("<tr>" + "".join(f"<td>{e(str(c))}</td>" for c in r) + "</tr>" for r in rows)


def table(head, rows):
    return (f"<details><summary>Table</summary><div class='tw'><table><thead><tr>{''.join(f'<th>{e(h)}</th>' for h in head)}"
            f"</tr></thead><tbody>{esc_rows(rows)}</tbody></table></div></details>")


def line_chart(runs, key, unit, lo=None, hi=None, step=10):
    """One line per run over its bins; hairline grid at three ticks; a title on each point for hover."""
    vals = [v for _, s, _ in runs for v in s[key]]
    if not vals:
        return "<p class='mut'>No data.</p>"
    lo = min(vals) if lo is None else lo
    hi = max(vals) if hi is None else hi
    hi = hi if hi > lo else lo + 1
    n = max(len(s[key]) for _, s, _ in runs)
    W, H = 600, 200
    x = lambda i: 40 + (i + 0.5) / n * (W - 50)
    y = lambda v: 10 + (1 - (v - lo) / (hi - lo)) * (H - 30)
    out = [f"<svg viewBox='0 0 {W} {H}' role='img' aria-label='{e(key)} by bin, one line per run'>"]
    for t in (lo, (lo + hi) / 2, hi):
        out.append(f"<line class='grid' x1='40' x2='{W - 10}' y1='{y(t):.1f}' y2='{y(t):.1f}'/>"
                   f"<text class='tick' x='34' y='{y(t) + 4:.1f}' text-anchor='end'>{t:g}{unit}</text>")
    for i in range(0, n, max(1, n // 6)):
        out.append(f"<text class='tick' x='{x(i):.1f}' y='{H - 4}' text-anchor='middle'>+{i * step}</text>")
    for name, s, c in runs:
        v = s[key]
        if not v:
            continue
        pts = " ".join(f"{x(i):.1f},{y(a):.1f}" for i, a in enumerate(v))
        out.append(f"<polyline class='ln' style='stroke:var(--s{c})' points='{pts}'/>")
        for i, a in enumerate(v):
            out.append(f"<circle class='pt' style='fill:var(--s{c})' cx='{x(i):.1f}' cy='{y(a):.1f}' r='4'>"
                       f"<title>{e(name)}, +{i * step} to +{(i + 1) * step} min: {a:g}{unit}</title></circle>")
    out.append("</svg>")
    rows = [[f"+{i * step}"] + [(s[key][i] if i < len(s[key]) else "-") for _, s, _ in runs] for i in range(n)]
    return "".join(out) + table(["min"] + [r[0] for r in runs], rows)


def columns(runs, key, unit):
    """Grouped columns per bin, one per run."""
    n = max(len(s[key]) for _, s, _ in runs)
    hi = max([v for _, s, _ in runs for v in s[key]] + [1])
    W, H = 600, 200
    gw = (W - 50) / n
    bw = min(24, (gw - 6) / len(runs) - 2)
    out = [f"<svg viewBox='0 0 {W} {H}' role='img' aria-label='{e(key)} per 10 minutes, one column per run'>"]
    for t in (0, hi / 2, hi):
        yy = 10 + (1 - t / hi) * (H - 30)
        out.append(f"<line class='grid' x1='40' x2='{W - 10}' y1='{yy:.1f}' y2='{yy:.1f}'/><text class='tick' x='34' y='{yy + 4:.1f}' text-anchor='end'>{t:.0f}</text>")
    for i in range(n):
        x0 = 40 + i * gw + (gw - len(runs) * (bw + 2)) / 2
        for j, (name, s, c) in enumerate(runs):
            v = s[key][i] if i < len(s[key]) else 0
            h = (v / hi) * (H - 30)
            xx, yy = x0 + j * (bw + 2), 10 + (H - 30) - h
            r = min(4, h / 2, bw / 2)
            out.append(f"<path class='bar' style='fill:var(--s{c})' d='M{xx:.1f} {yy + h:.1f}V{yy + r:.1f}Q{xx:.1f} {yy:.1f} {xx + r:.1f} {yy:.1f}"
                       f"H{xx + bw - r:.1f}Q{xx + bw:.1f} {yy:.1f} {xx + bw:.1f} {yy + r:.1f}V{yy + h:.1f}Z'>"
                       f"<title>{e(name)}, +{i * 10} min: {v}{unit}</title></path>")
        if i % max(1, n // 6) == 0:
            out.append(f"<text class='tick' x='{40 + (i + 0.5) * gw:.1f}' y='{H - 4}' text-anchor='middle'>+{i * 10}</text>")
    out.append("</svg>")
    rows = [[f"+{i * 10}"] + [(s[key][i] if i < len(s[key]) else "-") for _, s, _ in runs] for i in range(n)]
    return "".join(out) + table(["min"] + [r[0] for r in runs], rows)


def families(runs):
    """Small multiples: one panel per family, one line per run, each panel on its own scale (its peak printed)."""
    cells = []
    for f in FAMILIES:
        sub = [(name, {"v": s["fam"][f]}, c) for name, s, c in runs]
        peak = max([v for _, d, _ in sub for v in d["v"]] + [1])
        n = max(len(d["v"]) for _, d, _ in sub)
        W, H = 240, 90
        x = lambda i: 4 + (i + 0.5) / n * (W - 8)
        y = lambda v: 4 + (1 - v / peak) * (H - 10)
        svg = [f"<svg viewBox='0 0 {W} {H}' role='img' aria-label='{e(f)} choices by bin'><line class='axis' x1='0' x2='{W}' y1='{H - 6}' y2='{H - 6}'/>"]
        for name, d, c in sub:
            pts = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(d["v"]))
            svg.append(f"<polyline class='ln' style='stroke:var(--s{c})' points='{pts}'><title>{e(name)}: {e(f)} {d['v']}</title></polyline>")
        svg.append("</svg>")
        totals = " · ".join(f"{e(name)} {sum(d['v'])}" for name, d, _ in sub)
        cells.append(f"<div class='mini'><div class='mh'><b>{e(f)}</b><span class='mut'>peak {peak}</span></div><div class='mut sm'>{totals}</div>{''.join(svg)}</div>")
    return "<div class='minis'>" + "".join(cells) + "</div>"


def kinds_chart(runs):
    keys = sorted({k for _, s, _ in runs for k in s["kinds"]}, key=lambda k: -max(s["kinds"].get(k, (0, 0))[0] for _, s, _ in runs))
    hi = max([s["kinds"][k][0] for _, s, _ in runs for k in s["kinds"]] + [1])
    rows = []
    for k in keys:
        bars = "".join(f"<div class='hb' style='width:{max(0.5, 100 * s['kinds'].get(k, (0, 0))[0] / hi):.1f}%;background:var(--s{c})' "
                       f"title='{e(name)} {e(k)}: {s['kinds'].get(k, (0, 0))[0]}k tokens, {s['kinds'].get(k, (0, 0))[1]} calls'></div>" for name, s, c in runs)
        calls = " · ".join(str(s["kinds"].get(k, (0, 0))[1]) for _, s, _ in runs)
        rows.append(f"<div class='kr'><span class='mut'>{e(k)}</span><div class='hbs'>{bars}</div><span class='num mut'>{calls}</span></div>")
    return "".join(rows) + "<p class='mut sm'>Bars: thousand tokens. Right: calls per run, in run order.</p>"


def strips(runs):
    out = []
    for name, s, c in runs:
        seen, dots = {}, []
        for v in s["memberBusy"]:
            seen[v] = seen.get(v, 0) + 1
            dots.append(f"<span class='dot' style='left:{v}%;bottom:{2 + (seen[v] - 1) * 12}px;background:var(--s{c})' title='{e(name)}: a member busy {v}% of the run'></span>")
        out.append(f"<div class='strip'><b>{e(name)}</b><div class='track'>{''.join(dots)}</div></div>")
    return "".join(out) + "<div class='scale mut sm'><span>0%</span><span>50%</span><span>100%</span></div>"


def page(names, out):
    runs, reps = [], []
    for i, name in enumerate(names):
        s = series(name)
        if s:
            runs.append((os.path.basename(name), s, i % len(SLOTS) + 1))
        reps.append(report(name + ".log"))
    keys = []
    for r in reps:
        keys += [k for k, v in r.items() if k not in keys and v is not None and k != "run"]
    head = "".join(f"<th>{e(r['run'])}</th>" for r in reps)
    body = "".join(f"<tr><td>{e(k)}</td>" + "".join(f"<td>{e(str(r.get(k) or '-'))}</td>" for r in reps) + "</tr>" for k in keys)
    legend = "".join(f"<span class='lg'><i style='background:var(--s{c})'></i>{e(n)}</span>" for n, _, c in runs)
    css_slots = ";".join(f"--s{i + 1}:{l}" for i, (l, _) in enumerate(SLOTS))
    css_dark = ";".join(f"--s{i + 1}:{d}" for i, (_, d) in enumerate(SLOTS))
    surv = ""
    if any(s["deaths"] or s["kills"] for _, s, _ in runs):
        rows = "".join(f"<tr><td>{e(n)}</td><td>{len(s['deaths'])}</td><td>{s['kills']}</td><td>{s['nights']}</td><td>{e('; '.join(f'{w} {why}' for w, why in s['deaths']))}</td></tr>" for n, s, _ in runs)
        surv = f"<section class='card'><h2>Survival</h2><p class='sub'>From the agent server's [death], [combat] and [night] lines; the danger count's last line is in the table below.</p><div class='tw'><table><thead><tr><th>run</th><th>deaths</th><th>kills</th><th>nights</th><th>who and how</th></tr></thead><tbody>{rows}</tbody></table></div></section>"
    title = os.path.basename(os.path.dirname(os.path.abspath(names[0]))) + ": " + ", ".join(os.path.basename(n) for n in names)
    src = "; ".join(f"{n}: tokens from {s['tokSource']}" for n, s, _ in runs)
    doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title><style>
:root{{color-scheme:light;--bg:#f9f9f7;--card:#fcfcfb;--ink:#0b0b0b;--sec:#52514e;--mut:#6b6a65;--grid:#e1e0d9;--axis:#c3c2b7;--line:rgba(11,11,11,.10);{css_slots}}}
@media (prefers-color-scheme:dark){{:root{{color-scheme:dark;--bg:#0d0d0d;--card:#1a1a19;--ink:#f0efec;--sec:#c3c2b7;--mut:#a3a29c;--grid:#2c2c2a;--axis:#383835;--line:rgba(255,255,255,.10);{css_dark}}}}}
body{{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}}
.wrap{{max-width:1320px;margin:0 auto;padding:24px 24px 48px;display:flex;flex-direction:column;gap:16px}}
h1{{margin:0;font-size:26px}}h2{{margin:0;font-size:15px}}.sub{{color:var(--sec);font-size:13px;margin:2px 0 10px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px 18px;min-width:0}}
.g2{{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}}
.mut{{color:var(--mut)}}.sm{{font-size:12px}}.num{{font-variant-numeric:tabular-nums}}
.lg{{display:inline-flex;align-items:center;gap:6px;margin-right:14px}}.lg i{{width:14px;height:3px;border-radius:2px;display:inline-block}}
svg{{width:100%;height:auto;display:block}}.grid{{stroke:var(--grid);stroke-width:1}}.axis{{stroke:var(--axis);stroke-width:1}}
.tick{{fill:var(--mut);font-size:11px}}.ln{{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}}.pt{{stroke:var(--card);stroke-width:2}}
.minis{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}}.mini{{border:1px solid var(--grid);border-radius:6px;padding:8px 10px}}
.mh{{display:flex;justify-content:space-between;gap:8px}}
.kr{{display:grid;grid-template-columns:70px minmax(0,1fr) 90px;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid var(--grid)}}
.hbs{{display:flex;flex-direction:column;gap:2px}}.hb{{height:9px;border-radius:0 4px 4px 0}}.kr .num{{text-align:right}}
.strip{{display:grid;grid-template-columns:40px minmax(0,1fr);gap:10px;align-items:center;margin-top:10px}}
.track{{position:relative;height:50px;border-bottom:1px solid var(--axis)}}.dot{{position:absolute;width:10px;height:10px;margin-left:-5px;border-radius:50%;box-shadow:0 0 0 2px var(--card)}}
.scale{{display:flex;justify-content:space-between;margin-left:50px}}
.tw{{overflow-x:auto}}table{{border-collapse:collapse;width:100%;font-size:13px}}th,td{{text-align:left;padding:5px 8px;border-bottom:1px solid var(--grid);vertical-align:top}}
th{{color:var(--sec);border-bottom-color:var(--axis)}}td:not(:first-child){{font-variant-numeric:tabular-nums}}
details{{margin-top:8px}}summary{{cursor:pointer;color:var(--sec);font-size:12px}}
@media (max-width:900px){{.g2{{grid-template-columns:minmax(0,1fr)}}.minis{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}
@media (max-width:480px){{.wrap{{padding:16px}}.minis{{grid-template-columns:minmax(0,1fr)}}}}
</style></head><body><div class="wrap">
<header><div class="mut sm">run_report_html.py · {e(__import__('time').strftime('%Y-%m-%d %H:%M'))}</div><h1>{e(title)}</h1><div style="margin-top:6px">{legend}</div></header>
<section class="g2">
<div class="card"><h2>Busy by 10 minutes</h2><p class="sub">Members on any task, from the stage log's BUSY line.</p>{line_chart(runs, 'busy', '%', 0, 100)}</div>
<div class="card"><h2>Time inside a chore</h2><p class="sub">Member-time between a choice and its end (scorecard.py's chore busy).</p>{line_chart(runs, 'chore', '%', 0, 100)}</div>
<div class="card"><h2>Failed chores</h2><p class="sub">Chore ends with ok false, by when they ended.</p>{line_chart(runs, 'fail', '', 0)}</div>
<div class="card"><h2>Event-loop p99, 5-minute medians</h2><p class="sub">From NAME.perf.jsonl (ms).</p>{line_chart(runs, 'p99', '', 0, None, 5)}</div>
</section>
<section class="card"><h2>What members chose, family by family</h2><p class="sub">Chore choices per 10 minutes; each panel has its own scale.</p>{families(runs)}</section>
<section class="g2">
<div class="card"><h2>Tokens per 10 minutes</h2><p class="sub">Thousand tokens, prompt plus output.</p>{columns(runs, 'tok', 'k tokens')}</div>
<div class="card"><h2>Tokens by call kind</h2><p class="sub">Hover a bar for tokens and calls.</p>{kinds_chart(runs)}</div>
</section>
<section class="card"><h2>How busy each member was</h2><p class="sub">One dot per member: share of the run inside a chore.</p>{strips(runs)}</section>
{surv}
<section class="card"><h2>Every number (run_report.py)</h2><div class="tw"><table><thead><tr><th></th>{head}</tr></thead><tbody>{body}</tbody></table></div></section>
<p class="mut sm">{e(src)}</p>
</div></body></html>"""
    with open(out, "w", encoding="utf-8") as f:
        f.write(doc)
    return out


def main():
    args = sys.argv[1:]
    if not args:
        raise SystemExit(__doc__)
    out = None
    if "-o" in args:
        i = args.index("-o")
        out = args[i + 1]
        del args[i:i + 2]
    names = [a[:-4] if a.endswith(".log") else a for a in args]
    out = out or os.path.join(os.path.dirname(os.path.abspath(names[0])), "report.html")
    print(page(names, out))


if __name__ == "__main__":
    main()
