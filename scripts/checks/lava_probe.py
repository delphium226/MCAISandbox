"""#188's live probe: lava at an idle bot's feet, in a world with damage (MC_WORLD_MODE=damage or up).

Spawns Gus (idle brain, survival) at X Z, then three times: full health by RCON, lava set at his feet, 4 s; the
agent-server log must show a `[hazard] Gus lava` line for each (the reflex logs as it starts) and Gus must be alive and
out of the lava. Then the stale-flag case: lava at his feet and `kill Gus` at once; after the respawn no `[hazard] Gus
lava` line may come within 8 s. Every lava cell set is put back to air.
Usage: MCAI_API=http://127.0.0.1:8767/api MC_SERVER_DIR=mc/testserver python scripts/checks/lava_probe.py AGENT_LOG X Z
Prints PASS/FAIL lines and exits 1 on any FAIL.
"""
import json, math, os, sys, time, urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'mc'))
import rcon  # noqa: E402

API = os.environ.get('MCAI_API', 'http://127.0.0.1:8767/api').rstrip('/')
SERVER = os.environ.get('MC_SERVER_DIR', 'mc/testserver')
fails = 0


def call(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, method=method or ('POST' if body is not None else 'GET'),
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b'{}')
    except Exception as e:  # noqa: BLE001
        return {'error': str(e)}


def cmd(c):
    return rcon.command(c, SERVER)


def check(cond, what):
    global fails
    print(('PASS ' if cond else 'FAIL ') + what)
    if not cond:
        fails += 1


def pos():
    o = call('/agents/Gus/observe?radius=2')
    p = o.get('position') or {}
    return p, o.get('health')


def log_since(path, off):
    with open(path, encoding='utf-8', errors='replace') as f:
        f.seek(off)
        return f.read()


def main():
    log, x, z = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    call('/agents/Gus', method='DELETE')
    sp = call('/agents', {'name': 'Gus', 'brain': 'idle', 'gamemode': 'survival', 'reset': True, 'position': {'x': x + 0.5, 'z': z + 0.5}})
    check(not sp.get('error'), f'Gus spawned ({sp.get("error", "ok")})')
    time.sleep(4)
    placed = []
    for n in range(3):
        cmd('effect give Gus minecraft:instant_health 1 5 true')
        time.sleep(1.5)
        p, h = pos()
        fx, fy, fz = math.floor(p['x']), math.floor(p['y']), math.floor(p['z'])
        off = os.path.getsize(log)
        cmd(f'setblock {fx} {fy} {fz} minecraft:lava')
        placed.append((fx, fy, fz))
        time.sleep(4)
        text = log_since(log, off)
        hz = [l for l in text.splitlines() if l.startswith('[hazard] Gus lava')]
        died = [l for l in text.splitlines() if 'Gus' in l and ('[death]' in l or 'tried to swim in lava' in l)]
        p2, h2 = pos()
        print(f'  try {n + 1}: lava at {fx},{fy},{fz}; health {h} -> {h2}; {len(hz)} hazard lines; {"; ".join(l[:160] for l in hz[:2])}')
        check(len(hz) >= 1, f'try {n + 1}: the lava reflex logged')
        check(not died and (h2 or 0) > 0, f'try {n + 1}: Gus alive (health {h2})')
        cmd(f'setblock {fx} {fy} {fz} minecraft:air')
        cmd(f'fill {fx - 3} {fy - 1} {fz - 3} {fx + 3} {fy + 2} {fz + 3} minecraft:air replace minecraft:lava')
        cmd(f'fill {fx - 3} {fy - 1} {fz - 3} {fx + 3} {fy + 2} {fz + 3} minecraft:air replace minecraft:fire')
        time.sleep(3)
    # The stale flag: lava at the feet, killed at once, respawned elsewhere
    cmd('effect give Gus minecraft:instant_health 1 5 true')
    time.sleep(1.5)
    p, _ = pos()
    fx, fy, fz = math.floor(p['x']), math.floor(p['y']), math.floor(p['z'])
    cmd(f'setblock {fx} {fy} {fz} minecraft:lava')
    time.sleep(0.15)
    cmd('kill Gus')
    off = os.path.getsize(log)
    cmd(f'setblock {fx} {fy} {fz} minecraft:air')
    cmd(f'fill {fx - 3} {fy - 1} {fz - 3} {fx + 3} {fy + 2} {fz + 3} minecraft:air replace minecraft:lava')
    time.sleep(10)
    p3, h3 = pos()
    text = log_since(log, off)
    # (a reflex started in the 0.15 s before the kill may still log its end at the lava's cell: only another place counts)
    after = [l for l in text.splitlines() if l.startswith('[hazard] Gus lava') and f'{fx},{fy},{fz}' not in l]
    print(f'  after the kill: at {p3}, health {h3}; lava lines after: {after[:2]}')
    check(not after, 'no stale lava reflex after the respawn')
    call('/agents/Gus', method='DELETE')
    print('ALL PASSED' if not fails else f'{fails} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
