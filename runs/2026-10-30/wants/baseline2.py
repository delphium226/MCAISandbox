"""Refined: goal words, tag echoes, specific lines of work across hours."""
import json, re, collections
ROOT = 'D:/Projects/MCAISandbox/'
ARMS = [('9cM', 'runs/2026-10-28/train9c/M'), ('9cO', 'runs/2026-10-28/train9c/O'),
        ('10C', 'runs/2026-10-29/train10/C'), ('10S', 'runs/2026-10-29/train10/S'),
        ('11M', 'runs/2026-10-29/train11/M'), ('11P', 'runs/2026-10-29/train11/P')]
NAMES = sorted(set(['Mayor'] + re.findall(r"'([A-Z][a-z]+)'", open(ROOT + 'server/src/agentNames.ts', encoding='utf-8').read())))
GOALW = re.compile(r"\b(my (life )?goal|goal|mastery|master\w*|standing|wealth|beauty|invention|inventor|my craft)\b", re.I)
ENJOY = re.compile(r"\b(enjoy\w*|like doing|love)\b", re.I)
DULL = re.compile(r"\b(dull|bor(ed|ing)|tired of|change from|variety|something different|repetitive)\b", re.I)
MEM = re.compile(r"\b(yesterday|earlier|last time|remember|intention|intend\w*|as planned|planned|my plan|last night|my notes|continu\w*|again|plan)\b", re.I)
FUTURE = re.compile(r"\b(later|future|eventually|next|tomorrow|toward|towards|so that|in order to)\b", re.I)
STATUS = re.compile(r"\b(reputation|recogni\w*|admire|impress\w*|rival|better than|status|respect|best|proud|pride|famous|show)\b", re.I)
RECIP = re.compile(r"\b(thank\w*|owe|repay|return the favou?r|grateful|in return|helped me|back)\b", re.I)
IMIT = re.compile(r"\b(like \w+ (did|does)|as \w+ did|follow\w*|copy\w*|same as)\b", re.I)
EXPLORE = re.compile(r"\b(explor\w*|discover\w*|new|curious|find out|try\w*|experiment\w*)\b", re.I)
SELFNEED = re.compile(r"\b(I need|hungry|food|appetite|tired|energy|rest|my own|my house|own chest|my bed)\b", re.I)

def fam(r):
    w = (r.get('what') or '').lower()
    w = re.sub(r'\d+', '', w)
    w = re.sub(r'\b(i|for)\b.*$', '', w) if w.startswith(('build', 'gather', 'prepare')) else w
    return re.sub(r'\s+', ' ', w).strip()

for arm, p in ARMS:
    rows = [json.loads(l) for l in open(ROOT + p + '.choices.jsonl', encoding='utf-8')]
    ch = [r for r in rows if r.get('type') == 'choice' and r.get('agent') != 'Mayor']
    t0 = min(r['t'] for r in ch)
    model = [r for r in ch if r.get('source') == 'model']
    c = collections.Counter(); n = len(model)
    for r in model:
        rs = r.get('reason') or ''
        chosen = next((o for o in r.get('options', []) if o.get('id') == r.get('chosen')), {}) or {}
        tw = chosen.get('tw'); gw = chosen.get('gw')
        g = bool(GOALW.search(rs)); e = bool(ENJOY.search(rs))
        c['goal'] += g; c['goal_tagged'] += g and gw is not None
        c['enjoy'] += e; c['enjoy_tagged'] += e and (tw or 1) >= 1.6
        c['dull'] += bool(DULL.search(rs))
        c['memory'] += bool(MEM.search(rs)); c['future'] += bool(FUTURE.search(rs))
        c['status'] += bool(STATUS.search(rs)); c['recip'] += bool(RECIP.search(rs)); c['imit'] += bool(IMIT.search(rs))
        c['explore'] += bool(EXPLORE.search(rs)); c['selfneed'] += bool(SELFNEED.search(rs))
        others = [x for x in NAMES if x != r['agent'] and re.search(r'\b' + x + r'\b', rs)]
        optxt = ' '.join(str(chosen.get(k, '')) for k in ('name', 'facts')) + ' ' + (r.get('what') or '')
        c['person'] += bool(others); c['person_beyond'] += bool([x for x in others if x not in optxt])
        # untagged inner motive: names a person beyond the option, memory/plan, status, reciprocity, or goal/enjoy w/o tag
        inner = bool([x for x in others if x not in optxt]) or bool(MEM.search(rs)) or bool(STATUS.search(rs)) or bool(RECIP.search(rs)) \
            or (g and gw is None) or (e and (tw or 1) < 1.6)
        c['inner_untagged'] += inner
    print(f"== {arm} model reasons {n}: " + ', '.join(f"{k} {v} ({100*v/n:.1f}%)" for k, v in sorted(c.items())))
    # specific lines across hours
    byh = collections.defaultdict(collections.Counter)
    for r in ch:
        byh[(r['agent'], int((r['t'] - t0) / 3600000))][fam(r)] += 1
    agents = sorted({a for a, h in byh}); H = sorted({h for a, h in byh})
    kept = []; kept2 = []; distinct = []
    for a in agents:
        if (a, 0) in byh and (a, 1) in byh:
            top0 = byh[(a, 0)].most_common(1)[0]
            kept.append(top0[0] in dict(byh[(a, 1)].most_common(3)))
            if (a, 2) in byh and sum(byh[(a, 2)].values()) >= 5:
                kept2.append(top0[0] in dict(byh[(a, 2)].most_common(3)))
        distinct.append(len(set().union(*[set(byh[(a, h)]) for h in H if (a, h) in byh])))
    tops = collections.Counter(byh[(a, 0)].most_common(1)[0][0] for a in agents if (a, 0) in byh)
    share = []
    for a in agents:
        tot = collections.Counter()
        for h in H:
            tot.update(byh.get((a, h), {}))
        s = sum(tot.values()); share.append(tot.most_common(1)[0][1] / s if s else 0)
    share.sort()
    print(f"   hour-0 top line in hour-1 top3: {sum(kept)}/{len(kept)}; in hour-2 top3: {sum(kept2)}/{len(kept2)}; distinct lines/member median {sorted(distinct)[len(distinct)//2]}; top line share median {share[len(share)//2]:.2f}; hour-0 top lines {tops.most_common(5)}")
