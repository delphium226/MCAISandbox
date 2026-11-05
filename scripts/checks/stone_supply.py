"""Storage's stone and the mine's and quarry's trips by 10-minute bin, from an agent server's log (#217 step 0, the
castle wall's supply: docs/specs/castle-walls.md 3).
Usage: python scripts/checks/stone_supply.py LOG [LOG ...] [--bin MIN]
Time is the run's own: the latest "t"/"tEnd" (epoch ms) of a [choice]/[choice-end] line before each line, minutes from
the first. Per bin:
  storage  the mine stones in the last deposit message's "Storage now holds" list (cobblestone, cobbled_deepslate,
           andesite, diorite, granite, tuff, stone, deepslate), as cobblestone + the rest; the message is cut at ~250
           characters, so a stone listed past the cut is missing (a lower bound)
  mine     [mine] trips ended ("X trip: ... got N cobblestone"), the cobblestone they got, and their minutes digging
  quarry   [quarry] trips ended ("X trip: dug D in R rows in M min; got N cobblestone"), likewise
Then per log: the mine's and the quarry's cobblestone a member-hour of trip time, and the quarry's a member-hour of
the chores the trips were part of (choice-end minutes of each choice with a quarry trip, its walks included).
"""
import json, re, sys
from collections import defaultdict

STONES = ('cobblestone', 'cobbled_deepslate', 'andesite', 'diorite', 'granite', 'tuff', 'stone', 'deepslate')
T_RE = re.compile(r'"(?:t|tEnd)":(\d{13})')
TRIP_RE = re.compile(r'^\[(mine|quarry)\] (\w+) trip: dug (\d+).*? in ([\d.]+) min.*?; got (\d+) cobblestone')
STORE_RE = re.compile(r'Storage now holds (.*?)(?:","|$)')


def stones(held):
    """{stone: count} from a 'Storage now holds' list; a last item cut short is left out."""
    out = defaultdict(int)
    for part in re.split(r'[;,] ?', held):
        m = re.search(r'(\d+) ([a-z_]+)$', part.strip().split(': ')[-1])
        if m and m.group(2) in STONES:
            out[m.group(2)] += int(m.group(1))
    # (a final token that is a prefix, e.g. "100 gran", does not match a whole name above)
    return out


def one(path, bin_min):
    t0 = now = None
    bins = defaultdict(lambda: {'cob': None, 'other': None, 'mine': 0, 'mine_got': 0, 'mine_min': 0.0, 'q': 0, 'q_got': 0, 'q_min': 0.0})
    open_choice = {}  # agent -> choice id
    id_agent = {}
    q_choices = set()
    choice_min = {}
    totals = defaultdict(float)
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            m = T_RE.search(line)
            if m:
                now = int(m.group(1))
                if t0 is None:
                    t0 = now
            if now is None:
                continue
            b = int((now - t0) / 60000 // bin_min)
            if line.startswith('[choice] '):
                try:
                    d = json.loads(line[9:])
                    open_choice[d['agent']] = d['id']
                    id_agent[d['id']] = d['agent']
                except (ValueError, KeyError):
                    pass
            elif line.startswith('[choice-end] '):
                try:
                    d = json.loads(line[13:])
                    choice_min[d['id']] = float(d.get('minutes') or 0)
                except (ValueError, KeyError):
                    pass
                s = STORE_RE.search(line)
                if s:
                    st = stones(s.group(1))
                    bins[b]['cob'] = st.get('cobblestone', 0)
                    bins[b]['other'] = sum(v for k, v in st.items() if k != 'cobblestone')
            m = TRIP_RE.match(line)
            if m:
                kind, who, dug, mins, got = m.group(1), m.group(2), int(m.group(3)), float(m.group(4)), int(m.group(5))
                k = 'mine' if kind == 'mine' else 'q'
                bins[b][k] += 1
                bins[b][k + '_got'] += got
                bins[b][k + '_min'] += mins
                totals[k + '_trips'] += 1
                totals[k + '_got'] += got
                totals[k + '_min'] += mins
                totals[k + '_dug'] += dug
                if kind == 'quarry' and who in open_choice:
                    q_choices.add(open_choice[who])
    print(f'== {path}')
    if t0 is None:
        print('no timed lines')
        return
    print(f'{"min":>7} {"cob":>6} {"other":>6} | {"mine":>4} {"got":>5} {"dig-min":>7} | {"quarry":>6} {"got":>5} {"dig-min":>7}')
    last_c = last_o = None
    for b in range(max(bins) + 1):
        r = bins[b]
        if r['cob'] is not None:
            last_c, last_o = r['cob'], r['other']
        c = '-' if last_c is None else last_c
        o = '-' if last_o is None else last_o
        print(f'{b * bin_min:>4}-{(b + 1) * bin_min:<3}{c:>6} {o:>6} | {r["mine"]:>4} {r["mine_got"]:>5} {r["mine_min"]:>7.1f} | {r["q"]:>6} {r["q_got"]:>5} {r["q_min"]:>7.1f}')
    for k, name in (('mine', 'mine'), ('q', 'quarry')):
        if totals[k + '_trips']:
            rate = totals[k + '_got'] / totals[k + '_min'] * 60 if totals[k + '_min'] else 0
            print(f'{name}: {int(totals[k + "_trips"])} trips, {int(totals[k + "_got"])} cobblestone, {int(totals[k + "_dug"])} blocks dug, '
                  f'{totals[k + "_min"]:.0f} trip-minutes: {totals[k + "_got"] / totals[k + "_trips"]:.0f} a trip, {rate:.0f} cobblestone a member-hour of trip time')
    if q_choices:
        mins = sum(choice_min.get(i, 0) for i in q_choices)
        if mins:
            print(f'quarry chores: {len(q_choices)} choices with a trip, {mins:.0f} member-minutes: {totals["q_got"] / mins * 60:.0f} cobblestone a member-hour of chore time (walks included)')


def main():
    args, bin_min = sys.argv[1:], 10
    if '--bin' in args:
        i = args.index('--bin')
        bin_min = int(args[i + 1])
        del args[i:i + 2]
    if not args:
        raise SystemExit(__doc__)
    for p in args:
        one(p, bin_min)


if __name__ == '__main__':
    main()
