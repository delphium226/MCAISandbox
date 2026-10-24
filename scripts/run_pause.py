"""The run's pause seen from a watch script (#115 step 3): GET /api/run's pausedMs, read once a poll; step() gives the
seconds paused since the last read, which the script adds to its clocks (start, last success, stall timers) so a paused
run neither times out nor reads as stalled. An agent server without the route counts no pause."""
import json, urllib.request


class PauseClock:
    def __init__(self, api):
        self.url = api.rstrip("/") + "/run"
        self.seen = self._read(0.0)

    def _read(self, last):
        try:
            with urllib.request.urlopen(self.url, timeout=5) as r:
                return float(json.loads(r.read().decode("utf-8")).get("pausedMs", 0)) / 1000
        except Exception:  # (no route, a restart, a slow reply: no news)
            return last

    def step(self):
        now = self._read(self.seen)
        d = max(0.0, now - self.seen)
        self.seen = now
        return d
