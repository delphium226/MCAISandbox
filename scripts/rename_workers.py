"""
Rename the old WorkerN members to the pool's first names (#11, s38) in saved villages: villages.json and atlas.json
files of checkpoints and test worlds, so a checkpoint saved before s38 resumes with the names the scripts now spawn
(Worker1 -> Ada, ..., Worker24 -> Xavier; scripts/agent_names.py). Each changed file is kept beside itself as
FILE.bak-pre-s38 (once). Stop the agent server of a test world before renaming its villages.json (it writes the file).

Usage: python scripts/rename_workers.py FILE_OR_CHECKPOINT_DIR [...] [--dry-run]
  python scripts/rename_workers.py mc/testcheckpoints/mv3_grown25 mc/testserver/villages.json
"""
import re, shutil, sys
from pathlib import Path

from agent_names import legacy_map

args = [a for a in sys.argv[1:] if a != "--dry-run"]
dry = "--dry-run" in sys.argv
if not args:
    raise SystemExit(__doc__)
names = legacy_map()
word = re.compile(r"\bWorker(\d+)\b")
files = []
for a in args:
    p = Path(a)
    files += [p / "villages.json", p / "atlas.json"] if p.is_dir() else [p]
for f in files:
    if not f.exists():
        continue
    text = f.read_text(encoding="utf-8")
    left = sorted({m for m in word.findall(text) if f"Worker{m}" not in names}, key=int)
    new, n = word.subn(lambda m: names.get(m.group(0), m.group(0)), text)
    print(f"{f}: {n - sum(text.count(f'Worker{m}') for m in left)} renamed" + (f", left as they were: Worker{', Worker'.join(left)}" if left else ""))
    if dry or new == text:
        continue
    bak = f.with_name(f.name + ".bak-pre-s38")
    if not bak.exists():
        shutil.copyfile(f, bak)
    # As the agent server writes them (UTF-8, LF): bytes kept, only the names changed
    f.write_bytes(new.encode("utf-8"))
