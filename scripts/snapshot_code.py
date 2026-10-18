"""Copy the agent server's code into runs/code/<hash>/ so a server started from the copy is untouched by later edits:
the code can be worked on while a test runs (the user's rule, relaxed on 2026-10-16 for runs started from a snapshot).

Usage: python scripts/snapshot_code.py        prints the snapshot's folder (made if new)
From Python: snapshot() returns it. reset_site.py starts the test agent server from one by default.

What is copied: server/src, server/panel, shared/src, package.json and tsconfig.json, laid out as in the repo, so relative
imports (server -> shared) and the panel page resolve inside the copy, and Node finds node_modules by walking up to the
repo. Code that needs the repo itself (mc/server, runs/, the Minecraft jar) reads MCAI_ROOT, which the starter sets to the
repo. A snapshot is named by a hash of its files, so an unchanged tree reuses the last one; CODE.txt records the commit and
the uncommitted files it was made from. MCAI_CODE_FROM=<folder> snapshots another tree's code instead (the skill
foundry, scripts/foundry.py: a worktree, or a base commit's files from git archive); runs/code stays the repo's. Start one with:
  MCAI_ROOT=<repo> node node_modules/tsx/dist/cli.mjs <snapshot>/server/src/mineflayer/index.ts   (cwd: the repo)
"""
import hashlib, os, pathlib, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIRS = ("server/src", "server/panel", "shared/src")
FILES = ("package.json", "tsconfig.json")
OUT = ROOT / "runs" / "code"


def source():
    """The tree whose code is copied: MCAI_CODE_FROM, else the repo."""
    return pathlib.Path(os.environ["MCAI_CODE_FROM"]).resolve() if os.environ.get("MCAI_CODE_FROM") else ROOT


def files(src=ROOT):
    for d in DIRS:
        for p in sorted((src / d).rglob("*")):
            if p.is_file() and "__pycache__" not in p.parts:
                yield p
    for f in FILES:
        yield src / f


def snapshot():
    """The folder of a snapshot of the current code (made now unless one with the same contents exists)."""
    src = source()
    h = hashlib.sha1()
    paths = list(files(src))
    for p in paths:
        h.update(p.relative_to(src).as_posix().encode() + b"\0" + p.read_bytes() + b"\0")
    dest = OUT / h.hexdigest()[:12]
    if (dest / "CODE.txt").exists():
        return dest
    tmp = dest.with_name(dest.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    for p in paths:
        q = tmp / p.relative_to(src)
        q.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, q)
    git = lambda *a: subprocess.run(["git", *a], cwd=src, capture_output=True, text=True).stdout.rstrip()
    # (a folder that is no checkout of its own, e.g. a git archive under .foundry/, says where it came from instead)
    own = src == ROOT or (src / ".git").exists()
    dirty = [l for l in git("status", "--porcelain", "--", *DIRS, *FILES).splitlines() if l.strip()] if own else []
    head = git("rev-parse", "--short", "HEAD") if own else "?"
    (tmp / "CODE.txt").write_text(f"commit {head}\nuncommitted {len(dirty)}\n" + "".join(f"  {l}\n" for l in dirty)
                                  + (f"from {src}\n" if src != ROOT else ""), encoding="utf-8")
    tmp.rename(dest)
    return dest


if __name__ == "__main__":
    if len(sys.argv) > 1:
        raise SystemExit(__doc__)
    print(snapshot())
