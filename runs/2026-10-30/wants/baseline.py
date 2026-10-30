"""Baseline for the wants spec: choice reasons, persistence, empty menus (trains 9c-11)."""
import json, re, sys, math, random, collections, glob, os
ROOT = 'D:/Projects/MCAISandbox/'
ARMS = [('9c', 'M', 'runs/2026-10-28/train9c/M'), ('9c', 'O', 'runs/2026-10-28/train9c/O'),
        ('10', 'C', 'runs/2026-10-29/train10/C'), ('10', 'S', 'runs/2026-10-29/train10/S'),
        ('11', 'M', 'runs/2026-10-29/train11/M'), ('11', 'P', 'runs/2026-10-29/train11/P')]
NAMES = ['Mayor'] + [l.strip().strip("',") for l in re.findall(r"'([A-Z][a-z]+)'", open(ROOT + 'server/src/agentNames.ts', encoding='utf-8').read())]
NAMES = sorted(set(NAMES))
MEM = re.compile(r"\b(yesterday|earlier|last time|remember|intention|intend|as planned|planned|my plan|last night|my notes|today's plan|continu\w*|keep (on|going)|again|still)\b", re.I)
GOAL = re.compile(r"\b(life goal|my goal|toward my goal|mastery|master|my craft|best at|ambition of mine)\b", re.I)
VAMB = re.compile(r"\b(village'?s ambition|iron age|ambition|monument|cathedral)\b", re.I)
WANT = re.compile(r"\b(I want|I'd like|I would like|I love|I enjoy|enjoy|I like|proud|I wish|dream|passion|curious|bored|boring|dull|fun|satisf\w*|reputation|recogni\w*|admire|impress\w*|rival|beat|better than|status)\b", re.I)
NEED = re.compile(r"\b(I need|need (a|food|my)|hungry|appetite|my own|my house|own chest|own farm)\b", re.I)
VILLAGE = re.compile(r"\b(village|storage|stock|short|needed|shortage|everyone|the others|community)\b", re.I)
SOCIALW = re.compile(r"\b(help(ing)? \w+|request|promise|offer|asked|thank|owe|repay|return the favour|grateful)\b", re.I)

def load(p):
    out = []
    for l in open(ROOT + p + '.choices.jsonl', encoding='utf-8'):
        try: out.append(json.loads(l))
        except Exception: pass
    return out

def js(a, b):
    keys = set(a) | set(b); sa = sum(a.values()) or 1; sb = sum(b.values()) or 1
    d = 0.0
    for k in keys:
        p = a.get(k, 0) / sa; q = b.get(k, 0) / sb; m = (p + q) / 2
        if p: d += 0.5 * p * math.log2(p / m)
        if q: d += 0.5 * q * math.log2(q / m)
    return d

res = {}
samples = {}
for train, arm, p in ARMS:
    rows = load(p)
    ch = [r for r in rows if r.get('type') == 'choice']
    t0 = min(r['t'] for r in ch)
    model = [r for r in ch if r.get('source') == 'model' and r.get('agent') != 'Mayor']
    c = collections.Counter()
    for r in model:
        reason = r.get('reason') or ''
        chosen = next((o for o in r.get('options', []) if o.get('id') == r.get('chosen')), None)
        optxt = (r.get('what', '') + ' ' + (chosen.get('facts', '') if chosen else '') + ' ' + (chosen.get('name', '') if chosen else '')).lower()
        others = [n for n in NAMES if n != r['agent'] and re.search(r'\b' + n + r'\b', reason)]
        beyond = [n for n in others if n.lower() not in optxt]
        flags = {
            'person': bool(others), 'person_beyond': bool(beyond), 'memory': bool(MEM.search(reason)),
            'goal': bool(GOAL.search(reason)), 'vamb': bool(VAMB.search(reason)), 'want': bool(WANT.search(reason)),
            'need': bool(NEED.search(reason)), 'village': bool(VILLAGE.search(reason)), 'social': bool(SOCIALW.search(reason)),
        }
        flags['inner'] = flags['person_beyond'] or flags['memory'] or flags['goal'] or flags['want']
        for k, v in flags.items(): c[k] += v
        c['n'] += 1
    samples[train + arm] = random.Random(1).sample([(r['agent'], r.get('what'), r.get('reason')) for r in model], 12)
    # persistence by hour: kinds per member per hour (all chosen, incl. fixed/repeat)
    byh = collections.defaultdict(collections.Counter)
    for r in ch:
        if r.get('agent') == 'Mayor': continue
        h = int((r['t'] - t0) / 3600000)
        byh[(r['agent'], h)][r.get('kind')] += 1
    agents = sorted({a for a, h in byh})
    hours = sorted({h for a, h in byh})
    same_top = []; js_self = []; js_other = []
    for a in agents:
        if (a, 0) in byh and (a, 1) in byh and sum(byh[(a, 1)].values()) >= 5:
            top0 = byh[(a, 0)].most_common(1)[0][0]; top1 = byh[(a, 1)].most_common(1)[0][0]
            same_top.append(top0 == top1)
            js_self.append(js(byh[(a, 0)], byh[(a, 1)]))
    for a in agents:
        for b in agents:
            if a < b and (a, 1) in byh and (b, 0) in byh:
                js_other.append(js(byh[(a, 0)] if (a,0) in byh else {}, byh[(b, 1)]))
    # same key as previous choice, and longest same-kind run
    prev = {}; rep = 0; tot = 0
    for r in sorted(ch, key=lambda r: r['t']):
        a = r['agent']
        if a == 'Mayor': continue
        if a in prev:
            tot += 1; rep += (prev[a] == r.get('key'))
        prev[a] = r.get('key')
    drops = collections.Counter((r.get('why') or '?').split(':')[0][:40] for r in rows if r.get('type') == 'choice-drop')
    src = collections.Counter(r.get('source') for r in ch)
    # [choice-none] lines
    none_lines = 0; none_reasons = collections.Counter(); idle_peak = []
    logp = ROOT + p + '.log'
    if os.path.exists(logp):
        for l in open(logp, encoding='utf-8', errors='replace'):
            if '[choice-none]' in l:
                none_lines += 1
                m = re.search(r': (\d+) idle, nothing feasible \((.*)\)', l)
                if m:
                    idle_peak.append(int(m.group(1)))
                    for part in m.group(2).split(', '):
                        mm = re.match(r'(.*) (\d+)$', part)
                        if mm: none_reasons[mm.group(1)] += int(mm.group(2))
    ends = [r for r in rows if r.get('type') == 'choice-end']
    res[train + arm] = dict(model=c, hours=hours, same_top=(sum(same_top), len(same_top)),
        js_self=sum(js_self) / max(1, len(js_self)), js_other=sum(js_other) / max(1, len(js_other)),
        repeat_key=(rep, tot), drops=drops.most_common(6), src=dict(src), none_lines=none_lines,
        none_reasons=none_reasons.most_common(8), idle_mean=(sum(idle_peak) / len(idle_peak)) if idle_peak else 0,
        idle_max=max(idle_peak) if idle_peak else 0, n_choices=len(ch))

for k, v in res.items():
    m = v['model']; n = m['n']
    print(f"== {k}: choices {v['n_choices']} src {v['src']} hours {v['hours']}")
    print('  model reasons n=%d: ' % n + ', '.join(f"{x} {m[x]} ({100*m[x]/n:.0f}%)" for x in ['person','person_beyond','memory','goal','vamb','want','need','social','village','inner']))
    print(f"  top kind same h0->h1: {v['same_top']}; JS self h0/h1 {v['js_self']:.3f} vs other {v['js_other']:.3f}; same key as previous {v['repeat_key']}")
    print(f"  drops {v['drops']}")
    print(f"  [choice-none] lines {v['none_lines']} idle mean {v['idle_mean']:.1f} max {v['idle_max']}; reasons {v['none_reasons']}")
json.dump({k: [list(s) for s in v] for k, v in samples.items()}, open(sys.argv[1], 'w', encoding='utf-8'), indent=1)
