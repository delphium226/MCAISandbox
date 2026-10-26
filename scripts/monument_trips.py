"""
The monument's trips from a run's choices log (#163): for each monument chore kind (gather by item, tend_kiln, cut,
dye, job), how many, their minutes, each step's mean seconds, what the gathering delivered, and member-minutes per
1,000 items delivered; with the lodge's walk counter (choice-end "walked", MC_LODGE's runs on), blocks walked a chore.
Then the build: minutes from the monument's first chore to its last job, blocks built, and minutes per 1,000 blocks.

  python scripts/monument_trips.py RUN.choices.jsonl [RUN2.choices.jsonl ...]
"""
import json
import re
import sys
from collections import defaultdict


def kind_of(key: str) -> str | None:
    if not key.startswith('monument:'):
        return None
    p = key.split(':')
    if p[1] == 'gather':
        return f'gather {p[2]}'
    if p[1] == 'kiln':
        return 'build kiln' if p[2] == '0' else 'tend kiln'
    if p[1] in ('job', 'cut', 'dye', 'site', 'lodge'):
        return p[1]
    return p[1]


def report(path: str) -> None:
    starts: dict[str, dict] = {}
    rows: dict[str, list] = defaultdict(list)
    first = last_job = None
    blocks = 0
    for line in open(path, encoding='utf-8'):
        d = json.loads(line)
        if d['type'] == 'choice':
            starts[d['id']] = d
            continue
        c = starts.get(d['id'])
        k = c and kind_of(c.get('key', ''))
        if not k:
            continue
        first = c['t'] if first is None else min(first, c['t'])
        n = 0
        if k.startswith('gather') and d.get('ok'):
            item = k.split(' ', 1)[1]
            m = re.search(rf'deposited (?:[^.]*?, )?(\d+) {re.escape(item)}\b', d.get('message', ''))
            n = int(m.group(1)) if m else 0
        if k == 'job' and d.get('ok'):
            last_job = d['tEnd']
            m = re.search(r'\((\d+) blocks\)', c.get('what', '')) or re.search(r'(\d+) blocks', d.get('message', ''))
            blocks += int(m.group(1)) if m else 0
        rows[k].append({'min': d['minutes'], 'ok': d.get('ok'), 'n': n, 'walked': d.get('walked'),
                        'steps': [(s['type'], s['ms']) for s in d.get('steps', [])]})
    print(f'== {path}')
    print(f"{'chore':24} {'n':>4} {'ok':>4} {'min/each':>8} {'delivered':>9} {'mm/1k':>7} {'walk/ch':>7}  steps (mean s)")
    for k in sorted(rows):
        r = rows[k]
        mins = sum(x['min'] for x in r)
        got = sum(x['n'] for x in r)
        walks = [x['walked'] for x in r if x['walked'] is not None]
        steps: dict[str, list] = defaultdict(list)
        for x in r:
            for t, ms in x['steps']:
                if ms is not None:
                    steps[t].append(ms / 1000)
        st = ', '.join(f'{t} {sum(v) / len(v):.0f}' for t, v in steps.items())
        per = f'{1000 * mins / got:.0f}' if got else '-'
        walk = f'{sum(walks) / len(walks):.0f}' if walks else '-'
        print(f"{k:24} {len(r):>4} {sum(1 for x in r if x['ok']):>4} {mins / len(r):>8.2f} {got or '-':>9} {per:>7} {walk:>7}  {st}")
    tot = sum(x['min'] for r in rows.values() for x in r)
    walks = [x['walked'] for r in rows.values() for x in r if x['walked'] is not None]
    if walks:
        print(f'walked a monument chore: {sum(walks) / len(walks):.0f} blocks ({len(walks)} chores)')
    if first and last_job:
        span = (last_job - first) / 60000
        print(f'build: {span:.1f} min from the first monument chore to the last job; {blocks} blocks in jobs; '
              f'{1000 * span / max(1, blocks):.1f} min per 1,000 blocks; monument member-minutes {tot:.0f}')


if __name__ == '__main__':
    for p in sys.argv[1:]:
        report(p)
