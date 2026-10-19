"""
The workers' usernames for the scripts (#11, s38): worker N logs in as the Nth name of the pool in
server/src/agentNames.ts (read from there, so the list lives in one place); the Mayor stays Mayor, Gus stays Gus.

  from agent_names import worker_name, worker_names, legacy_map
  worker_names(2)  -> ['Ada', 'Ben']
  legacy_map()     -> {'Worker1': 'Ada', ...}: the old WorkerN names, for villages saved before s38
"""
import re
from pathlib import Path

_TS = Path(__file__).resolve().parent.parent / "server" / "src" / "agentNames.ts"
_body = re.search(r"NAME_POOL[^=]*=\s*\[(.*?)\]", _TS.read_text(encoding="utf-8"), re.S).group(1)
POOL = re.findall(r"'([A-Za-z0-9_]+)'", _body)


def worker_name(n):
    """Worker n's username (n from 1)."""
    return POOL[n - 1] if 1 <= n <= len(POOL) else f"Worker{n}"


def worker_names(count):
    return [worker_name(i + 1) for i in range(count)]


def legacy_map(count=24):
    return {f"Worker{i}": worker_name(i) for i in range(1, count + 1)}
