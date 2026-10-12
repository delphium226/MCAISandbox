"""Snapshots of a running village for A.2's golden check (spec runs/2026-10-12/spec_a2.md 4.2, input 1).

Every N minutes it reads GET {api}/village/{V} (the whole record, as the registry keeps and saves it) and writes
OUTDIR/<V>-<minute>.json shaped like villages.json ({"nextId": ..., "villages": [record]}, plus "t" and "source", which
the registry ignores), and GET {api}/atlas?village=V&radius=R (the chunk summaries with their plant sightings, and the
animals seen, round the village's home) to OUTDIR/<V>-<minute>.atlas.json. scripts/checks/choice_golden.mts takes the
.json files as inputs (variant 0 runs the real atlas on the sibling .atlas.json's chunks and animals). Read-only: it
only GETs.

The API's record is the village itself; what villages.json has besides is the registry's nextId (written as 0 here:
nothing in the golden check reads it) and the other villages (their plots and buildings are what collect's filter and
village ground keep off; a snapshot has only its own).

Usage: python scripts/checks/village_snapshots.py VILLAGE OUTDIR [--every MIN] [--api URL] [--radius R] [--minutes TOTAL] [--once]
(api from MCAI_API, default http://127.0.0.1:8767/api: the test world's agent server)
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request


def get(url, timeout=20):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def write(path, data):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(tmp, path)


def snapshot(api, village, outdir, minute, radius):
    t = int(time.time() * 1000)
    name = urllib.parse.quote(village)
    rec = get(f'{api}/village/{name}')
    if not isinstance(rec, dict) or rec.get('error'):
        raise RuntimeError(f'no village {village}: {rec}')
    base = os.path.join(outdir, f'{village}-{minute:03d}')
    write(base + '.json', {'nextId': 0, 'villages': [rec], 't': t, 'source': f'{api}/village/{name}'})
    atlas_note = ''
    try:
        atlas = get(f'{api}/atlas?village={name}&radius={radius}', timeout=60)
        write(base + '.atlas.json', {'t': t, 'centre': atlas.get('centre'), 'radius': atlas.get('radius'),
                                     'chunks': atlas.get('chunks', []), 'animals': atlas.get('animals', [])})
        atlas_note = f", atlas {len(atlas.get('chunks', []))} chunks, {len(atlas.get('animals', []))} animals"
    except Exception as e:  # (the record is the important part: keep going without the atlas)
        atlas_note = f', atlas failed: {e}'
    lay = (rec.get('layouts') or [{}])[0]
    print(f"[snap] {village} +{minute} min: complete={bool(rec.get('complete'))} slots={len(lay.get('slots') or [])} "
          f"annex={(lay.get('annex') or {}).get('state')} explore={len((rec.get('explore') or {}).get('visited') or [])}"
          f"{atlas_note} -> {base}.json", flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('village')
    ap.add_argument('outdir')
    ap.add_argument('--every', type=float, default=5, help='minutes between snapshots (default 5)')
    ap.add_argument('--api', default=os.environ.get('MCAI_API', 'http://127.0.0.1:8767/api'))
    ap.add_argument('--radius', type=int, default=260, help='atlas radius round home (the ring at 160 plus known()\'s 48; max 400)')
    ap.add_argument('--minutes', type=float, default=0, help='stop after this many minutes (default: until stopped)')
    ap.add_argument('--once', action='store_true', help='one snapshot, then exit')
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    api = a.api.rstrip('/')
    start = time.time()
    while True:
        minute = int(round((time.time() - start) / 60))
        try:
            snapshot(api, a.village, a.outdir, minute, a.radius)
        except Exception as e:
            print(f'[snap] {a.village} +{minute} min failed: {e}', flush=True)
        if a.once or (a.minutes and time.time() - start + a.every * 60 > a.minutes * 60 + 1):
            break
        time.sleep(max(1.0, start + (minute + a.every) * 60 - time.time()))
    return 0


if __name__ == '__main__':
    sys.exit(main())
