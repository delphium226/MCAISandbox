"""Copy the agent server's code into runs/code/<hash>/ so a server started from the copy is untouched by later edits:
the code can be worked on while a test runs (the user's rule, relaxed on 2026-10-16 for runs started from a snapshot).

Usage: python scripts/snapshot_code.py        prints the snapshot's folder (made if new)
From Python: snapshot() returns it. reset_site.py starts the test agent server from one by default.

What is copied: server/src, server/panel, shared/src, package.json and tsconfig.json, laid out as in the repo, so relative
imports (server -> shared) and the panel page resolve inside the copy, and Node finds node_modules by walking up to the
repo. Code that needs the repo itself (mc/server, runs/, the Minecraft jar) reads MCAI_ROOT, which the starter sets to the
repo. A snapshot is named by a hash of its files, so an unchanged tree reuses the last one; CODE.txt records the commit and
the uncommitted files it was made from. Start one with:
  MCAI_ROOT=<repo> node node_modules/tsx/dist/cli.mjs <snapshot>/server/src/mineflayer/index.ts   (cwd: the repo)
"""
import hashlib, os, pathlib, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIRS = ("server/src", "server/panel", "shared/src")
FILES = ("package.json", "tsconfig.json")
OUT = ROOT / "runs" / "code"


def files():
    for d in DIRS:
        for p in sorted((ROOT / d).rglob("*")):
            if p.is_file() and "__pycache__" not in p.parts:
                yield p
    for f in FILES:
        yield ROOT / f


def snapshot():
    """The folder of a snapshot of the current code (made now unless one with the same contents exists)."""
    h = hashlib.sha1()
    paths = list(files())
    for p in paths:
        h.update(p.relative_to(ROOT).as_posix().encode() + b"\0" + p.read_bytes() + b"\0")
    dest = OUT / h.hexdigest()[:12]
    if (dest / "CODE.txt").exists():
        return dest
    tmp = dest.with_name(dest.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    for p in paths:
        q = tmp / p.relative_to(ROOT)
        q.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, q)
    git = lambda *a: subprocess.run(["git", *a], cwd=ROOT, capture_output=True, text=True).stdout.rstrip()
    dirty = [l for l in git("status", "--porcelain", "--", *DIRS, *FILES).splitlines() if l.strip()]
    (tmp / "CODE.txt").write_text(f"commit {git('rev-parse', '--short', 'HEAD')}\nuncommitted {len(dirty)}\n"
                                  + "".join(f"  {l}\n" for l in dirty), encoding="utf-8")
    tmp.rename(dest)
    return dest


if __name__ == "__main__":
    if len(sys.argv) > 1:
        raise SystemExit(__doc__)
    print(snapshot())
