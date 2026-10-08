"""Follow a village's workers until every building is done, after the stage runner has stopped (its stall rule fired
while work was still going on: StageH4 felled two 2x2 jungle trees for over 5 minutes each, 2026-09-29). Prints the
workers' finished and failed actions, the build tasks when they change, and the storage chests at the end. Needs the
agent server; leaves the agents in the world.

Usage: python scripts/checks/follow_workers.py VILLAGE MINUTES [WORKER ...]   (workers default to Worker1 Worker2)
"""
import json, sys, time, urllib.request

API = 'http://127.0.0.1:8766/api'
village, minutes = sys.argv[1], float(sys.argv[2])
workers = sys.argv[3:] or ['Worker1', 'Worker2']


def get(path):
    with urllib.request.urlopen(API + path, timeout=30) as r:
        return json.loads(r.read())


seen = {}
for n in workers:
    events = get(f'/agents/{n}/events?since=0')
    seen[n] = events[-1]['id'] if events else 0
t0, board = time.time(), ''
while time.time() - t0 < minutes * 60:
    time.sleep(5)
    for n in workers:
        for e in get(f'/agents/{n}/events?since={seen[n]}'):
            seen[n] = e['id']
            if e['type'] in ('action_done', 'action_failed'):
                print(f"{(time.time() - t0) / 60:4.1f}m {n} {e['type']} | {e['text'][:260]}", flush=True)
    v = get(f'/village/{village}')
    builds = [t for t in v['tasks'] if t['title'].startswith('Build ')]
    b = ' '.join(f"{t['id']}:{t['status']}" for t in builds)
    if b != board:
        board = b
        print('BUILDS', b, flush=True)
    # (and the street lamps and signs, 10-06 and 10-08: a failed one is soft)
    lamps = [t for t in v['tasks'] if t['title'].startswith(('Light the streets', 'Put up the signs', 'Plant the farm'))]
    if builds and all(t['status'] == 'done' for t in builds) and all(t['status'] in ('done', 'failed') for t in lamps):
        print('ALL BUILT', flush=True)
        break
    if any(t['status'] == 'failed' for t in builds):
        print('BUILD FAILED', flush=True)
        break
for i, c in enumerate((get(f'/village/{village}').get('storage') or {}).get('chests', [])):
    print(f"chest {i + 1} ({c.get('group')}) {c['x']},{c['y']},{c['z']}: {c['items']}", flush=True)
print('END', flush=True)
