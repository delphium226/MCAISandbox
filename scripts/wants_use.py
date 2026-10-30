"""The wants spec's measures (runs/2026-10-30/wants/spec.md 6.2 with 9.3-9.4), from a run's choice ledger and acts ledger,
split by member arm (MC_WANTS_HOLDOUT's hash, as pursuits.ts' wantsArm computes it).

  python scripts/wants_use.py RUN_PREFIX [RUN_PREFIX ...] [--holdout 0.5] [--flip RUN_PREFIX] [--json OUT]

RUN_PREFIX is a run's ledger path without its ending (runs/2026-10-29/train11/M reads M.choices.jsonl and M.acts.jsonl).
--flip names the runs whose split is reversed (MC_WANTS_FLIP=on, the pilot's second world). Without a holdout every
member is "on" and the off columns are empty (a village-wide arm: compare runs instead).

Measures, by arm:
  1. the primary (9.3): when the member's pursuit step is on a model menu, the share of model picks that take it, against
     its share of shown options and against a shuffled pursuit (another member's, scored on the same menus); off-members
     are scored with their shadow pursuits;
  2. lines that persist at three grains (family, kind, option): hour-h top line in hour h+1's top 3, the top line's share;
  3. JS of family mixes within each arm, by hour;
  4. pursuits: chosen, carried 2+ village days, resumed after interruptions, done/stalled/dropped; own words, unmatched;
  5. chore busy and productive minutes per 10-minute bin, hour 2 (chosen rest apart, never busy);
  6. outlets: calls and picks; proposals from pursuits and outlets;
  7. reasons (manipulation checks only): naming the pursuit, a person beyond the option and its tags, a debt or thanks,
     imitation, status or a record;
  8. tokens a member-hour by arm and call kind (choose, pursuit, outlet).
"""
import collections
import json
import math
import random
import re
import statistics
import sys

ROOT = 'D:/Projects/MCAISandbox/'
WOODS = 'oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped'
STONES = 'chiseled|cracked|mossy|smooth|polished|cut'


def family(oid):
    """pursuits.ts' familyOf."""
    s = (oid or '?').lower()
    s = re.sub(r'\b(%s)_' % WOODS, '', s)
    s = re.sub(r'\b(%s)_' % STONES, '', s)
    s = re.sub(r':s?i?\d+(:\d+)?', ':', s)
    s = re.sub(r'\d+', '', s)
    return re.sub(r':+', ':', s).rstrip(':')


def fnv1a(s):
    h = 0x811c9dc5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xffffffff
    return h


def arm(name, holdout, flip):
    if holdout <= 0:
        return 'on'
    off = fnv1a(f'wants|{name.lower()}') / 2 ** 32 < holdout
    return 'off' if off != flip else 'on'


BEAUTY = {'statue', 'gazebo', 'lamp_posts', 'bench', 'front_bed', 'flower_ring', 'sapling'}


def advances(p, o):
    """pursuits.ts' advances, from an option record of the ledger (its id, kind and name)."""
    t, prm = p.get('template'), p.get('param')
    oid, kind, name = o.get('id', ''), o.get('kind', ''), o.get('name', '')
    if kind in ('eat', 'rest'):
        return False
    if t in ('craft', 'supply'):
        return family(oid) == prm
    if t == 'works':
        return kind == 'initiate' or (kind == 'help' and name.startswith('Continue your '))
    if t == 'light':
        return kind == 'light' or oid in ('make:torch', 'make:lantern')
    if t == 'explore':
        return kind == 'explore'
    if t == 'house':
        return (kind == 'furnish' and 'your own house' in name) or re.match(r'own:(chest|farm|basics|shear|decor)', oid) is not None
    if t == 'garden':
        return (kind == 'initiate' and oid.split(':')[-1] in BEAUTY) or oid.startswith('own:decor') or oid in ('make:lantern', 'make:jack_o_lantern')
    if t == 'research':
        return oid == f'innovate:{prm}' or oid.startswith('own:pledge')
    if t == 'wealth':
        return (kind == 'own' and not re.match(r'own:(pledge|basics|shear|decor)', oid)) or oid == 'activity:lib:sell'
    if t == 'standing':
        return (kind == 'help' and not name.startswith('Continue your ')) or (kind == 'initiate' and oid.split(':')[-1] not in BEAUTY)
    return False


def load(path):
    out = []
    try:
        for l in open(path, encoding='utf-8'):
            try:
                out.append(json.loads(l))
            except Exception:
                pass
    except FileNotFoundError:
        pass
    return out


def option_of(r):
    return r.get('chosen') or next((o['id'] for o in r.get('options', []) if o.get('key') == r.get('key')), r.get('key') or '?')


def js(a, b):
    keys = set(a) | set(b)
    sa, sb = sum(a.values()) or 1, sum(b.values()) or 1
    d = 0.0
    for k in keys:
        p, q = a.get(k, 0) / sa, b.get(k, 0) / sb
        m = (p + q) / 2
        if p:
            d += 0.5 * p * math.log2(p / m)
        if q:
            d += 0.5 * q * math.log2(q / m)
    return d


NAMES = sorted(set(['Mayor'] + re.findall(r"'([A-Z][a-z]+)'", open(ROOT + 'server/src/agentNames.ts', encoding='utf-8').read())))
PURSUIT_W = re.compile(r'\b(my (own )?project|my pursuit|toward my project|for my project)\b', re.I)
RECIP = re.compile(r'\b(thank\w*|owe|repay\w*|return the favou?r|grateful|in return)\b', re.I)
IMIT = re.compile(r"\b(like \w+ (did|does)|as \w+ (did|does)|\w+'s way|follow\w* \w+|copy\w*)\b", re.I)
STATUS = re.compile(r'\b(record|title|keeper|best|rival|ahead of|beat|proud|respect|admire\w*)\b', re.I)
NOT_WORK = re.compile(r'^(rest|eat|own:basics|own:carry)')


def run_measures(prefix, holdout, flip):
    rows = load(ROOT + prefix + '.choices.jsonl')
    acts = load(ROOT + prefix + '.acts.jsonl')
    ch = [r for r in rows if r.get('type') == 'choice' and r.get('agent') != 'Mayor']
    if not ch:
        return {'run': prefix, 'error': 'no choices'}
    ends = {r['id']: r for r in rows if r.get('type') == 'choice-end'}
    t0 = min(r['t'] for r in ch)
    A = lambda n: arm(n, holdout, flip)
    out = {'run': prefix, 'holdout': holdout, 'flip': flip}

    # The pursuits from the acts ledger: each member's pursuit over time (chosen -> ended)
    spans = collections.defaultdict(list)
    chosen = [a for a in acts if a.get('type') == 'pursuit-chosen' and a.get('template')]
    ended = [a for a in acts if a.get('type') == 'pursuit-end']
    for a in sorted(chosen, key=lambda x: x.get('t', 0)):
        spans[a['agent']].append({'template': a['template'], 'param': a.get('param'), 't': a.get('t', 0), 'end': None, 'shadow': a.get('shadow', False), 'day': a.get('day')})
    for e in sorted(ended, key=lambda x: x.get('t', 0)):
        for s in spans[e['agent']]:
            if s['end'] is None and s['template'] == e.get('template') and s.get('param') == e.get('param') and s['t'] <= e.get('t', 0):
                s['end'] = e.get('t', 0)
                s['state'] = e.get('state')
                s['days'] = e.get('days')
                s['resumed'] = e.get('resumed')
                break

    def pursuit_at(agent, t):
        for s in reversed(spans.get(agent, [])):
            if s['t'] <= t and (s['end'] is None or t < s['end']):
                return s
        return None

    # 1. The primary: step-taking on model menus
    prim = {k: collections.Counter() for k in ('on', 'off')}
    agents = sorted({r['agent'] for r in ch})
    rnd = random.Random(7)
    for r in ch:
        if r.get('source') != 'model':
            continue
        p = pursuit_at(r['agent'], r['t'])
        if not p:
            continue
        shown = [o for o in r.get('options', []) if o.get('shown')]
        if not shown:
            continue
        a = A(r['agent'])
        steps = [o for o in shown if advances(p, o)]
        if steps:
            c = prim[a]
            c['menus'] += 1
            c['shown'] += len(shown)
            c['step_shown'] += len(steps)
            c['took'] += any(o['id'] == r.get('chosen') for o in steps)
        # (the shuffled control: another member's pursuit at the same time, on this menu)
        others = [x for x in agents if x != r['agent'] and pursuit_at(x, r['t'])]
        if others:
            q = pursuit_at(rnd.choice(others), r['t'])
            ss = [o for o in shown if advances(q, o)]
            if ss:
                c = prim[a]
                c['sh_menus'] += 1
                c['sh_shown'] += len(shown)
                c['sh_step_shown'] += len(ss)
                c['sh_took'] += any(o['id'] == r.get('chosen') for o in ss)
    out['primary'] = {}
    for a, c in prim.items():
        if not c['menus']:
            continue
        out['primary'][a] = {
            'menus': c['menus'], 'took': c['took'], 'take_share': round(c['took'] / c['menus'], 3),
            'shown_share': round(c['step_shown'] / c['shown'], 3), 'lift': round((c['took'] / c['menus']) / max(1e-9, c['step_shown'] / c['shown']), 2),
            'shuffled_take_share': round(c['sh_took'] / c['sh_menus'], 3) if c['sh_menus'] else None,
            'shuffled_shown_share': round(c['sh_step_shown'] / c['sh_shown'], 3) if c['sh_menus'] else None,
        }

    # 2. Persistence at three grains (work only)
    grains = {'family': lambda r: family(option_of(r)), 'kind': lambda r: option_of(r).split(':')[0], 'option': option_of}
    work = [r for r in ch if not NOT_WORK.match(option_of(r))]
    out['persistence'] = {}
    for g, fn in grains.items():
        byh = collections.defaultdict(collections.Counter)
        for r in work:
            byh[(r['agent'], int((r['t'] - t0) / 3600000))][fn(r)] += 1
        H = sorted({h for _, h in byh})
        res = {}
        for a in ('on', 'off'):
            kept = n = 0
            shares = []
            for ag in agents:
                if A(ag) != a:
                    continue
                for h in H[:-1]:
                    if (ag, h) in byh and (ag, h + 1) in byh:
                        n += 1
                        kept += byh[(ag, h)].most_common(1)[0][0] in dict(byh[(ag, h + 1)].most_common(3))
                tot = collections.Counter()
                for (b, h), c in byh.items():
                    if b == ag:
                        tot.update(c)
                if sum(tot.values()):
                    shares.append(tot.most_common(1)[0][1] / sum(tot.values()))
            if n:
                res[a] = {'kept': kept, 'of': n, 'share_median': round(statistics.median(shares), 3) if shares else None}
        out['persistence'][g] = res

    # 3. JS of family mixes within each arm, by hour
    out['js'] = {}
    byh = collections.defaultdict(collections.Counter)
    for r in work:
        byh[(r['agent'], int((r['t'] - t0) / 3600000))][family(option_of(r))] += 1
    for h in sorted({h for _, h in byh}):
        row = {}
        for a in ('on', 'off'):
            mixes = [byh[(ag, h)] for ag in agents if A(ag) == a and sum(byh[(ag, h)].values()) >= 5]
            pairs = [js(x, y) for i, x in enumerate(mixes) for y in mixes[i + 1:]]
            if pairs:
                row[a] = round(statistics.mean(pairs), 3)
        out['js'][f'hour {h}'] = row

    # 4. Pursuits
    pz = {}
    for a in ('on', 'off'):
        ss = [s for ag, l in spans.items() if A(ag) == a for s in l]
        if not ss:
            continue
        states = collections.Counter(s.get('state', 'active') for s in ss)
        pz[a] = {
            'chosen': len(ss), 'states': dict(states), 'carried_2_days': sum(1 for s in ss if (s.get('days') or 0) >= 2 or (s['end'] is None and s.get('day') is not None)),
            'resumed_any': sum(1 for s in ss if (s.get('resumed') or 0) > 0), 'templates': dict(collections.Counter(s['template'] for s in ss)),
        }
    own = [a for a in chosen if a.get('own')]
    pz['own_words'] = {'n': len(own), 'unmatched': sum(1 for a in own if not a.get('matched')), 'proposals': sum(1 for a in own if a.get('proposal')), 'examples': [a['own'] for a in own[:8]]}
    pz['calls'] = {'model': sum(1 for a in chosen if a.get('by') == 'model'), 'code': sum(1 for a in chosen if a.get('by') == 'code'), 'errors': sum(1 for a in acts if a.get('type') == 'pursuit-chosen' and a.get('error'))}
    out['pursuits'] = pz

    # 5. Chore busy and productive minutes per 10-minute bin, by arm (rest apart)
    tmax = max([r['t'] for r in ch] + [e.get('tEnd', 0) for e in ends.values()])
    first = {ag: min(r['t'] for r in ch if r['agent'] == ag) for ag in agents}
    nb = int((tmax - t0) / 600000) + 1
    st = collections.defaultdict(collections.Counter)
    for r in ch:
        e = ends.get(r['id'])
        if not e or not e.get('tEnd'):
            continue
        kind = 'rest' if option_of(r).startswith('rest') else ('prod' if e.get('productive') else 'busy')
        t = r['t']
        while t < e['tEnd']:
            step = min(e['tEnd'], t + 60000) - t
            st[(A(r['agent']), int((t - t0) / 600000))][kind] += step / 60000
            t += 60000
    bins = {}
    for a in ('on', 'off'):
        row = []
        for b in range(nb):
            present = sum(1 for ag in agents if A(ag) == a and first[ag] <= t0 + (b + 1) * 600000)
            span = min(10, (tmax - t0) / 60000 - b * 10)
            if not present or span <= 2:
                continue
            s = st[(a, b)]
            tot = present * span
            row.append({'bin': b * 10, 'busy': round((s['busy'] + s['prod']) / tot, 3), 'productive': round(s['prod'] / tot, 3), 'rest': round(s['rest'] / tot, 3)})
        if row:
            h2 = [x for x in row if 60 <= x['bin'] < 120]
            bins[a] = {'hour2_busy': round(statistics.mean(x['busy'] for x in h2), 3) if h2 else None, 'hour2_productive': round(statistics.mean(x['productive'] for x in h2), 3) if h2 else None, 'bins': row}
    out['busy'] = bins

    # 6. Outlets and proposals
    outs = [a for a in acts if a.get('type') == 'outlet']
    out['outlets'] = {a: {'calls': sum(1 for x in outs if A(x['agent']) == a), 'picks': dict(collections.Counter(x.get('pick') for x in outs if A(x['agent']) == a)), 'valid': sum(1 for x in outs if A(x['agent']) == a and x.get('valid'))} for a in ('on', 'off')}
    props = [a for a in acts if a.get('type') == 'proposal' and a.get('source') in ('pursuit', 'outlet')]
    out['proposals'] = {'n': len(props), 'by_source': dict(collections.Counter(p['source'] for p in props)), 'checks': dict(collections.Counter(p.get('check') for p in props)), 'what': [p.get('what') for p in props[:10]]}

    # 7. Reasons (manipulation checks): beyond the option, its tags and the want lines' names
    rs = {a: collections.Counter() for a in ('on', 'off')}
    for r in ch:
        if r.get('source') != 'model':
            continue
        a = A(r['agent'])
        reason = r.get('reason') or ''
        chosen_o = next((o for o in r.get('options', []) if o.get('id') == r.get('chosen')), {}) or {}
        optxt = ' '.join(str(chosen_o.get(k, '')) for k in ('name', 'facts', 'wantTag', 'social', 'mark')) + ' ' + (r.get('what') or '')
        ctx = r.get('ctx') or {}
        wants_txt = ' '.join(str(ctx.get(k, '')) for k in ('pursuit', 'esteem', 'restless'))
        names = [x for x in NAMES if x != r['agent'] and re.search(r'\b' + x + r'\b', reason)]
        c = rs[a]
        c['n'] += 1
        c['person_beyond'] += bool([x for x in names if x not in optxt and x not in wants_txt])
        c['pursuit'] += bool(PURSUIT_W.search(reason))
        c['recip'] += bool(RECIP.search(reason))
        c['imitation'] += bool(IMIT.search(reason))
        c['status'] += bool(STATUS.search(reason))
        c['took_tagged_project'] += '[your project]' in str(chosen_o.get('wantTag', ''))
        c['took_way'] += "'s way]" in str(chosen_o.get('wantTag', ''))
        c['took_repays'] += '[repays ' in str(chosen_o.get('wantTag', ''))
    out['reasons'] = {a: {k: (v if k == 'n' else f"{v} ({100 * v / max(1, c['n']):.1f}%)") for k, v in c.items()} for a, c in rs.items() if c['n']}

    # 8. Tokens a member-hour by arm and call kind
    hours = (tmax - t0) / 3600000
    tok = {a: collections.Counter() for a in ('on', 'off')}
    for r in ch:
        if r.get('source') == 'model':
            tok[A(r['agent'])]['choose'] += (r.get('promptTokens') or 0) + (r.get('outputTokens') or 0)
    for x in acts:
        if x.get('type') in ('pursuit-chosen', 'outlet') and x.get('agent'):
            tok[A(x['agent'])][x['type'].split('-')[0]] += (x.get('promptTokens') or 0) + (x.get('outputTokens') or 0)
    n_arm = collections.Counter(A(ag) for ag in agents)
    out['tokens_member_hour'] = {a: {k: round(v / max(1, n_arm[a]) / max(0.1, hours)) for k, v in c.items()} for a, c in tok.items() if n_arm[a]}
    return out


def main():
    args = sys.argv[1:]
    holdout, flips, js_out, runs = 0.0, set(), None, []
    i = 0
    while i < len(args):
        if args[i] == '--holdout':
            holdout = float(args[i + 1]); i += 2
        elif args[i] == '--flip':
            flips.add(args[i + 1]); i += 2
        elif args[i] == '--json':
            js_out = args[i + 1]; i += 2
        else:
            runs.append(args[i]); i += 1
    if not runs:
        print(__doc__)
        sys.exit(1)
    res = [run_measures(r, holdout, r in flips) for r in runs]
    for m in res:
        print(f"== {m['run']} (holdout {m.get('holdout')}, flip {m.get('flip')})")
        for k, v in m.items():
            if k in ('run', 'holdout', 'flip'):
                continue
            if k == 'busy':
                v = {a: {kk: vv for kk, vv in x.items() if kk != 'bins'} for a, x in v.items()}
            print(f'  {k}: {json.dumps(v)}')
    if js_out:
        json.dump(res, open(js_out, 'w', encoding='utf-8'), indent=1)


if __name__ == '__main__':
    main()
