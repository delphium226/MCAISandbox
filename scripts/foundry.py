"""The skill foundry (plan step X.3): an external coding CLI writes a missing action from a ticket, in its own git worktree,
and the foundry's gates check it; the result is a candidate branch foundry/<id> for the user to merge (the user approves
every merge: this script never merges, pushes or deletes a branch). Spec: runs/2026-10-18/foundry/spec_x3.md.

Usage: python scripts/foundry.py TICKET.json [--cli agy|claude] [--model M] [--gates-only] [--skip-baseline]
       python scripts/foundry.py --probe ID          (agy's workspace boundary in an existing worktree)
       python scripts/foundry.py --cleanup ID [--delete-branch]
  TICKET.json     scripts/foundry/tickets/<id>.json (its format: the spec, or the shear ticket)
  --cli           agy (the default, the user's: the Antigravity CLI on the Google AI Pro plan) or claude (Claude Code)
  --model         the CLI's model (default the ticket's "model" for that CLI)
  --gates-only    run the gates on the worktree as it stands (no CLI round first; repair rounds still use the CLI)
  --skip-baseline compare the series with the cached baseline only (fail the series gate if there is none)
  --written-by T  with --gates-only: who wrote the change, for the commit message and the report
  --cleanup ID    remove the worktree .foundry/ID (and the branch foundry/ID only with --delete-branch, when the user says)

Steps: preflight (test world 3 only, 0 agents on it: lesson 146), the worktree .foundry/<id> on branch foundry/<id> from
HEAD (inside the repo, ignored through .git/info/exclude; node_modules is a junction to the repo's), the baseline series
from the base commit (in a thread while the CLI works; cached by base, spec, checkpoint and harness), the CLI rounds,
then the gates in order: scope (only the ticket's files; line endings; no other world's ports or folders), typecheck,
check:offline, review (a read-only agent), live (the ticket's own check on test world 3, from a code snapshot of the
worktree), series (no regression against the baseline). A failed gate goes back to the same CLI conversation as a
repair round (caps.rounds). Then the foundry commits on foundry/<id> and writes runs/<date>/foundry/<id>/report.md.

Test world 3 (mc/testserver3, game 25568, RCON 25578, agent server 8769) is the foundry's alone; worlds 1 and 2 are never
touched (the main checkout's own scripts run with MCAI_TEST_WORLD=3). agy's tool approval: scoped rules added to
~/.gemini/antigravity-cli/settings.json for the run and removed after (never --dangerously-skip-permissions); a denied
command ends agy's turn, so the foundry resumes the conversation with the list of allowed commands. Only the official
CLIs run, as child processes.
"""
import argparse, datetime, hashlib, json, os, pathlib, re, shutil, subprocess, sys, threading, time, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import run_report  # noqa: E402

PY = sys.executable
WORLD = 3
GAME_PORT, API_PORT = 25565 + WORLD, 8766 + WORLD
API = f"http://127.0.0.1:{API_PORT}/api"
SERVER_DIR = ROOT / "mc" / f"testserver{WORLD}"
FOUNDRY = ROOT / ".foundry"
CHECKS = ROOT / "mc" / "testcheckpoints"
TODAY = f"{datetime.date.today():%Y-%m-%d}"
AGY_SETTINGS = pathlib.Path.home() / ".gemini" / "antigravity-cli" / "settings.json"
AGY_LOCK = AGY_SETTINGS.with_name("settings.foundry.lock")
# Code folders a snapshot copies (snapshot_code.py) and the base's git archive holds
CODE = ["server/src", "server/panel", "shared/src", "package.json", "tsconfig.json"]
# The harness scripts that run the gates from the main checkout: a change to them invalidates a cached baseline
HARNESS = ["scripts/run_series.py", "scripts/stage_village.py", "scripts/reset_site.py", "scripts/snapshot_code.py", "mc/testserver.py"]
# Never in a candidate: another world's ports or folders (worlds 1-2 are another session's; 8766 and mc/server the main world)
FORBIDDEN = re.compile(r"\b(8766|8767|8768|2556[5-7]|2557[5-7])\b|mc[/\\](server|testserver2?)\b|testserver2?['\"/\\]")
# The files a candidate may never change, whatever the ticket says
NEVER = {"package.json", "package-lock.json", "tsconfig.json", "shared/src/physics.ts", ".gitignore"}
CRLF_EXEMPT = {"shared/src/physics.ts"}

# agy's rules (action(target); deny beats allow; regexes are anchored and refuse shell metacharacters). Commands the
# CLI may run: the typecheck, the offline checks, one offline .mts check, and git reads
NOMETA = r"[^;&|<>$()`'\"\n]"
AGY_ALLOW = [
    rf"command(regex:^git (status|diff|log|show)( {NOMETA}*)?$)",
    r"command(regex:^node node_modules[/\\]typescript[/\\]bin[/\\]tsc --noEmit( -p tsconfig\.json)?$)",
    r"command(regex:^node node_modules[/\\]tsx[/\\]dist[/\\]cli\.mjs scripts[/\\]checks[/\\][A-Za-z0-9_]+\.mts( [A-Za-z0-9_.,=:/ -]*)?$)",
    r"command(regex:^npm run (typecheck|check:offline)$)",
    r"command(regex:^python scripts[/\\]check_offline\.py( [a-z0-9_ ]+)?$)",
]
AGY_DENY = [
    r"command(regex:--output)",
    r"command(regex:^git (push|commit|reset|checkout|switch|restore|worktree|branch|rebase|merge|stash|clean|config|remote|tag|am|apply|cherry-pick|update-ref|gc))",
    "write_file(package.json)", "write_file(package-lock.json)", "write_file(tsconfig.json)", "write_file(node_modules/)",
    "write_file(.git)", "write_file(mc/)", "write_file(shared/src/physics.ts)",
]
ALLOWED_TEXT = """\
- git status / git diff / git log / git show (read only; no --output)
- node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json      (the typecheck; or: npm run typecheck)
- python scripts/check_offline.py [NAME ...]                           (the offline checks; or: npm run check:offline)
- node node_modules/tsx/dist/cli.mjs scripts/checks/NAME.mts [ARGS]    (one offline .mts check)
Each as one plain command, nothing chained (no ; && | or redirection). Every other command is refused and ends your turn."""
CLAUDE_ALLOW = ["Read", "Edit", "Write", "Glob", "Grep", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)",
                "Bash(git show:*)", "Bash(npm run typecheck)", "Bash(npm run check:offline)",
                "Bash(node node_modules/typescript/bin/tsc:*)", "Bash(node node_modules/tsx/dist/cli.mjs scripts/checks/:*)",
                "Bash(python scripts/check_offline.py:*)"]
CLAUDE_DENY = ["Bash(git push:*)", "Bash(git commit:*)", "Bash(git reset:*)", "Bash(git checkout:*)", "Bash(git switch:*)",
               "Bash(git worktree:*)", "Bash(git branch:*)", "Bash(git rebase:*)", "Bash(git merge:*)", "Bash(git stash:*)",
               "Bash(rm:*)", "WebFetch", "WebSearch"]

RULES = """\
You are working one ticket of the project's skill foundry, in a git worktree of the project (this folder). Rules:
- Read CLAUDE.md first (the project's notes; its parts on starting servers, test worlds, sessions and commits are for
  the project's own sessions, not for you), then the files and lessons the ticket names.
- Work only in this folder. Do not start or stop any server, do not run live checks or scripts that talk to a server,
  do not commit, push, switch branches or touch git state: the foundry runs the gates (typecheck, offline checks, a
  review, your live check on a real test server, a staged series) and commits the result.
- Change only the files the ticket lists. Never change package.json, tsconfig.json, shared/src/physics.ts or anything
  under mc/.
- Source files use CRLF line endings: keep a file's endings as they are; write new files with CRLF.
- Keep skill names and arguments identical across worlds (server/src/skills.ts and mineflayer/mcSkills.ts).
- Failure messages are the model's eyes: say what is short, where, and what to do next.
- One event loop serves every bot: never call bot.findBlocks, filter inside searches, keep loops short.
- Code handed to mineflayer or its pathfinder must accept anything it can pass (stubs, nulls, entities that vanished).
- The live check you write must default to nothing: read MCAI_API and MC_SERVER_DIR from the environment, exit 2 if
  MCAI_API is not set, and name no other server's port or folder.
- Commands you may run (exactly these; others are refused):
{allowed}
- End with a short summary: the files you changed, how the check judges success, anything left open.
"""


# ---------------------------------------------------------------- small helpers

def log(msg):
    print(f"[foundry {time.strftime('%H:%M:%S')}] {msg}", flush=True)


def git(*args, cwd=ROOT, check=True):
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode:
        raise SystemExit(f"git {' '.join(args)} failed in {cwd}: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout.rstrip("\n")


def kill_tree(proc):
    if proc.poll() is None:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)


def run(cmd, cwd, env, logfile, timeout, stdin_text=None):
    """Runs a command with its output in logfile; kills the whole process tree past timeout seconds.
    Returns (exit code or 'timeout', output text)."""
    logfile.parent.mkdir(parents=True, exist_ok=True)
    with open(logfile, "w", encoding="utf-8", errors="replace") as f:
        f.write(f"$ {' '.join(map(str, cmd))}\n(cwd {cwd})\n")
        f.flush()
        proc = subprocess.Popen([str(c) for c in cmd], cwd=cwd, env=env, stdout=f, stderr=subprocess.STDOUT,
                                stdin=subprocess.PIPE if stdin_text is not None else subprocess.DEVNULL,
                                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
        if stdin_text is not None:
            proc.stdin.write(stdin_text.encode("utf-8"))
            proc.stdin.close()
        try:
            code = proc.wait(timeout)
        except subprocess.TimeoutExpired:
            kill_tree(proc)
            code = "timeout"
    return code, logfile.read_text(encoding="utf-8", errors="replace")


def tail(text, n=60):
    return "\n".join(text.rstrip().splitlines()[-n:])


def api(path, body=None, method=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None,
                                 method=method or ("POST" if body is not None else "GET"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read() or b"null")


def listening(port):
    import socket
    try:
        socket.create_connection(("127.0.0.1", port), timeout=1).close()
        return True
    except OSError:
        return False


def world_env(**extra):
    """The environment of the main checkout's scripts acting on test world 3 (and never another)."""
    env = {k: v for k, v in os.environ.items() if k not in ("MCAI_CODE_FROM", "MCAI_TEST_API_PORT", "MCAI_CODE_SNAPSHOT")}
    env.update({"MCAI_TEST_WORLD": str(WORLD), "MCAI_API": API, "MC_SERVER_DIR": str(SERVER_DIR), "MCAI_ROOT": str(ROOT),
                "PYTHONIOENCODING": "utf-8"})
    env.update({k: str(v) for k, v in extra.items()})
    return env


def cli_env():
    """The CLI's environment: no server reachable through the usual variables (MCAI_API points at a closed port)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith(("MCAI_", "MC_"))}
    env.update({"MCAI_ROOT": str(ROOT), "MCAI_API": "http://127.0.0.1:9/api", "PYTHONIOENCODING": "utf-8"})
    return env


# ---------------------------------------------------------------- ticket and preflight

def load_ticket(path):
    t = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    for k in ("id", "title", "brief", "deliver", "check"):
        if not t.get(k):
            raise SystemExit(f"ticket {path}: no {k!r}")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,40}", t["id"]):
        raise SystemExit(f"ticket id {t['id']!r}: lowercase letters, digits, _ and - only")
    files = set(t["deliver"]) | set(t.get("may_touch", []))
    bad = sorted(f for f in files if f in NEVER or f.startswith(("mc/", ".git", "node_modules")) or ".." in f)
    if bad:
        raise SystemExit(f"ticket {t['id']}: these files are never a candidate's: {', '.join(bad)}")
    if t["check"]["file"] not in t["deliver"]:
        raise SystemExit(f"ticket {t['id']}: its check {t['check']['file']} must be among the files it delivers")
    t.setdefault("read", [])
    t.setdefault("lessons", [])
    t.setdefault("may_touch", [])
    t.setdefault("series", "scripts/foundry/series_base.json")
    # (turns: tool steps, a backstop against a loop; agy reads files in small pieces, ~75 steps of reading before it
    # writes anything, so the time cap is the real limit)
    t["caps"] = {"minutes": 45, "turns": 500, "rounds": 3, **t.get("caps", {})}
    t.setdefault("model", {})
    return t


def preflight():
    if os.environ.get("MCAI_CODE_SNAPSHOT") == "0":
        raise SystemExit("MCAI_CODE_SNAPSHOT=0: the gates would run the main working tree, not the candidate; unset it")
    if not (SERVER_DIR / "server.properties").exists():
        raise SystemExit(f"no {SERVER_DIR}: set up test world 3 first (MCAI_TEST_WORLD=3 python mc/testserver.py init)")
    props = dict(l.split("=", 1) for l in (SERVER_DIR / "server.properties").read_text().splitlines() if "=" in l and not l.startswith("#"))
    if int(props.get("server-port", 0)) != GAME_PORT:
        raise SystemExit(f"{SERVER_DIR}/server.properties does not say server-port={GAME_PORT}")
    if listening(API_PORT):
        try:
            agents = api("/agents") or []
        except Exception as e:
            raise SystemExit(f"the agent server on {API_PORT} does not answer /api/agents ({e}): look before resetting")
        if agents:
            raise SystemExit(f"test world 3 has {len(agents)} agents ({', '.join(a.get('name', '?') for a in agents[:6])}): "
                             f"someone is using it (lesson 146); the foundry acts only on a world with 0 agents")
    log(f"preflight: test world 3 ({SERVER_DIR.relative_to(ROOT)}, agent server {API_PORT}"
        f" {'up, 0 agents' if listening(API_PORT) else 'down'}); worlds 1 and 2 are not touched")


class Lock:
    """One foundry at a time (one test world 3)."""

    def __init__(self, path):
        self.path = path

    def __enter__(self):
        FOUNDRY.mkdir(exist_ok=True)
        if self.path.exists():
            pid = self.path.read_text().strip()
            alive = pid.isdigit() and str(pid) in subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
            if alive:
                raise SystemExit(f"another foundry runs (pid {pid}, {self.path})")
        self.path.write_text(str(os.getpid()))
        return self

    def __exit__(self, *a):
        self.path.unlink(missing_ok=True)


# ---------------------------------------------------------------- worktree and baseline tree

def ensure_exclude():
    ex = pathlib.Path(git("rev-parse", "--git-path", "info/exclude"))
    ex = ex if ex.is_absolute() else ROOT / ex
    text = ex.read_text(encoding="utf-8") if ex.exists() else ""
    if "/.foundry/" not in text.splitlines():
        ex.parent.mkdir(parents=True, exist_ok=True)
        ex.write_text(text + ("" if text.endswith("\n") or not text else "\n") + "/.foundry/\n", encoding="utf-8")


def make_worktree(t, base):
    wt = FOUNDRY / t["id"]
    branch = f"foundry/{t['id']}"
    if wt.exists():
        log(f"worktree {wt.relative_to(ROOT)} exists: using it as it stands (branch {git('branch', '--show-current', cwd=wt)}; "
            f"{copy_fixtures(wt)} fixture files refreshed)")
        return wt
    if git("branch", "--list", branch):
        raise SystemExit(f"branch {branch} exists without its worktree: merge or delete it first (the user's call)")
    ensure_exclude()
    git("worktree", "add", str(wt), "-b", branch, base)
    # node_modules: the repo's, through a junction (check_offline.py and the CLI's commands use ./node_modules)
    subprocess.run(["cmd", "/c", "mklink", "/J", str(wt / "node_modules"), str(ROOT / "node_modules")], capture_output=True, check=True)
    n = copy_fixtures(wt)
    log(f"worktree {wt.relative_to(ROOT)} on {branch} from {base[:7]} (node_modules junction, {n} fixture files copied)")
    return wt


def copy_fixtures(wt):
    """The gitignored files the offline checks read (check_offline.py's goldens under runs/, the village records under
    mc/: villages.json, never a server's settings) are copied in, so the checks run in the worktree as in the repo."""
    names = set()
    for f in [wt / "scripts" / "check_offline.py", *sorted((wt / "scripts" / "checks").glob("*.mts"))]:
        text = f.read_text(encoding="utf-8", errors="replace")
        names |= set(re.findall(r"runs/[A-Za-z0-9_./-]+\.json", text))
        names |= set(re.findall(r"mc/(?:server|testserver|testcheckpoints)/[A-Za-z0-9_./-]*[A-Za-z0-9_]", text))
    n = 0
    for rel in sorted(names):
        src = ROOT / rel
        files = [src] if src.is_file() else [q for q in src.rglob("*.json") if "world" not in q.relative_to(src).parts] if src.is_dir() else []
        for q in files:
            if q.name in ("server.properties", "ops.json", "whitelist.json"):
                continue
            dst = wt / q.relative_to(ROOT)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(q, dst)
            n += 1
    return n


def base_tree(sha):
    """The base commit's code folders (git archive), for the baseline's code snapshot."""
    d = FOUNDRY / f"base-{sha[:12]}"
    if (d / "package.json").exists():
        return d
    tmp = FOUNDRY / f"base-{sha[:12]}.zip"
    git("archive", "--format=zip", "-o", str(tmp), sha, *CODE)
    with zipfile.ZipFile(tmp) as z:
        z.extractall(d)
    tmp.unlink()
    # (git archive writes LF; the snapshot's hash then differs from a CRLF checkout's, which only names the folder)
    return d


# ---------------------------------------------------------------- agy settings

def agy_rules(add):
    """Adds (add=True) or removes the foundry's rules in agy's global settings, leaving every other rule as it is."""
    for _ in range(60):
        try:
            fd = os.open(AGY_LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            break
        except FileExistsError:
            if time.time() - AGY_LOCK.stat().st_mtime > 600:
                AGY_LOCK.unlink(missing_ok=True)
            time.sleep(1)
    else:
        raise SystemExit(f"{AGY_LOCK} is held")
    try:
        data = json.loads(AGY_SETTINGS.read_text(encoding="utf-8") or "{}") if AGY_SETTINGS.exists() else {}
        perms = data.setdefault("permissions", {})
        for key, rules in (("allow", AGY_ALLOW), ("deny", AGY_DENY)):
            have = [r for r in perms.get(key, []) if r not in rules]
            perms[key] = have + (rules if add else [])
            if not perms[key]:
                perms.pop(key)
        if not perms:
            data.pop("permissions")
        AGY_SETTINGS.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        marker = FOUNDRY / "agy_rules_added"
        marker.write_text("1") if add else marker.unlink(missing_ok=True)
    finally:
        AGY_LOCK.unlink(missing_ok=True)


# ---------------------------------------------------------------- the CLI

def lessons_text(numbers):
    """The adapter list's lessons by number (docs/LESSONS.md, "Lessons from the adapter")."""
    text = (ROOT / "docs" / "LESSONS.md").read_text(encoding="utf-8")
    part = text.split("## Lessons from the adapter", 1)[-1]
    out = []
    for n in numbers:
        m = re.search(rf"^{n}\. (.*?)(?=^\d+\. |\Z|^## )", part, re.M | re.S)
        if m:
            out.append(f"{n}. " + re.sub(r"\s+", " ", m.group(1)).strip())
    return "\n".join(out)


def ticket_prompt(t, base):
    files = "\n".join(f"- {f}" for f in t["read"])
    deliver = "\n".join(f"- {f}" for f in t["deliver"] + t["may_touch"])
    return (f"# Foundry ticket {t['id']}: {t['title']}\n\n"
            + RULES.format(allowed=ALLOWED_TEXT)
            + f"\n## What to build\n\n{t['brief']}\n\n## Read first\n\n{files}\n\n## The only files you may change or add\n\n{deliver}\n\n"
            + f"## Its acceptance check\n\n{t['check']['file']}: the foundry runs it on a test server and expects exit 0 and a line "
            + f"matching {t['check']['pass']!r}.\n\n## Lessons that apply (docs/LESSONS.md)\n\n{lessons_text(t['lessons'])}\n\n"
            + f"(This worktree is at commit {base[:7]} of the branch tiered-brain-building.)\n")


class Cli:
    """One conversation with an external CLI: start(prompt), then resume(message) for repair rounds."""

    def __init__(self, kind, model, wt, out, caps):
        self.kind, self.model, self.wt, self.out, self.caps = kind, model, wt, out, caps
        self.conv, self.round, self.steps, self.started = None, 0, 0, time.time()
        self.usage = {"input": 0, "output": 0}
        self.cost = 0.0
        self.calls = []

    def left_min(self):
        return max(1.0, self.caps["minutes"] - (time.time() - self.started) / 60)

    def call(self, text):
        """One turn; returns (status, response, denied). Kills the CLI past the time or step caps."""
        self.round += 1
        n = self.round
        # The message goes in a file inside the worktree (gitignored runs/): no command-line length limit, and the CLI
        # may read it without asking
        msgfile = self.wt / "runs" / "foundry" / f"message{n}.md"
        msgfile.parent.mkdir(parents=True, exist_ok=True)
        msgfile.write_text(text, encoding="utf-8")
        (self.out / f"message{n}.md").write_text(text, encoding="utf-8")
        short = (f"Read the file runs/foundry/message{n}.md in this folder (the foundry's message {n}) and do what it says. "
                 f"It is the whole task; the rules in it bind you.")
        if self.kind == "agy":
            cmd = [shutil.which("agy") or "agy", "-p", short, "--output-format", "stream-json", "--model", self.model,
                   "--print-timeout", f"{int(self.left_min())}m", "--mode", "accept-edits"]
            if self.conv:
                cmd += ["--conversation", self.conv]
            stdin = None
        else:
            cmd = [shutil.which("claude") or "claude", "-p", "--output-format", "stream-json", "--verbose", "--model", self.model,
                   "--max-turns", str(max(1, self.caps["turns"] - self.steps)), "--permission-mode", "acceptEdits",
                   "--allowedTools", ",".join(CLAUDE_ALLOW), "--disallowedTools", ",".join(CLAUDE_DENY)]
            if self.conv:
                cmd += ["--resume", self.conv]
            stdin = short
        logf = self.out / f"cli-round{n}.jsonl"
        log(f"{self.kind} round {n} ({self.model}; {self.left_min():.0f} min and {self.caps['turns'] - self.steps} steps left), log {logf.relative_to(ROOT)}")
        proc = subprocess.Popen(cmd, cwd=self.wt, env=cli_env(), stdout=subprocess.PIPE, stderr=open(self.out / f"cli-round{n}.err", "w"),
                                stdin=subprocess.PIPE if stdin else subprocess.DEVNULL,
                                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
        if stdin:
            proc.stdin.write(stdin.encode("utf-8"))
            proc.stdin.close()
        result, why, t0 = {}, None, time.time()
        steps_usage = {}
        deadline = t0 + self.left_min() * 60 + 60

        def watchdog():
            nonlocal why
            while proc.poll() is None:
                if time.time() > deadline:
                    why = "time cap"
                    kill_tree(proc)
                time.sleep(2)

        threading.Thread(target=watchdog, daemon=True).start()
        with open(logf, "w", encoding="utf-8") as f:
            for raw in proc.stdout:
                line = raw.decode("utf-8", errors="replace")
                f.write(line)
                f.flush()
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                if self.kind == "agy":
                    if ev.get("event") == "init":
                        self.conv = ev.get("conversation_id") or self.conv
                    elif ev.get("event") == "step_update":
                        s = ev["step_update"]
                        self.conv = s.get("conversation_id") or self.conv
                        if s.get("step_type") == "tool" and s.get("state") == "DONE":
                            self.steps += 1
                        # (each model turn's own usage: the sum stands in for the result's when the CLI is killed)
                        if s.get("step_type") == "agent_response" and s.get("state") == "DONE":
                            for k, v in (s.get("usage") or {}).items():
                                if isinstance(v, (int, float)):
                                    steps_usage[k] = steps_usage.get(k, 0) + v
                    elif ev.get("event") == "result":
                        result = ev["result"]
                else:
                    if ev.get("type") == "system" and ev.get("subtype") == "init":
                        self.conv = ev.get("session_id") or self.conv
                    elif ev.get("type") == "assistant":
                        self.steps += sum(1 for c in (ev.get("message") or {}).get("content", []) if c.get("type") == "tool_use")
                    elif ev.get("type") == "result":
                        result = ev
                        self.conv = ev.get("session_id") or self.conv
                if self.steps > self.caps["turns"] and proc.poll() is None:
                    why = "step cap"
                    kill_tree(proc)
        proc.wait()
        u = result.get("usage") or steps_usage
        self.usage["input"] += int(u.get("input_tokens") or 0) + int(u.get("cache_read_tokens") or u.get("cache_read_input_tokens") or 0)
        self.usage["output"] += int(u.get("output_tokens") or 0) + int(u.get("thinking_tokens") or 0)
        self.cost += float(result.get("total_cost_usd") or 0)
        response = result.get("response") if self.kind == "agy" else result.get("result")
        status = why or (result.get("status") or result.get("subtype") or f"exit {proc.returncode}")
        denied = result.get("denied_actions") or result.get("permission_denials") or []
        self.calls.append({"round": n, "status": status, "seconds": round(time.time() - t0), "steps": self.steps,
                           "denied": denied, "usage": u})
        (self.out / f"cli-round{n}.response.md").write_text(response or "", encoding="utf-8")
        log(f"{self.kind} round {n}: {status} in {time.time() - t0:.0f} s, {self.steps} steps so far"
            f"{', denied ' + json.dumps(denied)[:200] if denied else ''}; response {len(response or '')} chars")
        return status, response or "", denied


def work(cli, first_text, caps):
    """The CLI's turn, resumed after denied commands (agy ends its turn at a denial) while rounds are left.
    Returns whether the CLI ended normally."""
    status, response, denied = cli.call(first_text)
    while denied and cli.kind == "agy" and cli.round < caps["rounds"] + 3 and status not in ("time cap", "step cap"):
        status, response, denied = cli.call(
            "Your last command was refused (not on the allowed list), which ended your turn. Carry on with the task without "
            f"it. The only commands allowed:\n{ALLOWED_TEXT}\nIf you were checking something a command would show, read the "
            "files instead. Finish the task, then end with your summary.")
    return status not in ("time cap", "step cap")


# ---------------------------------------------------------------- gates

def changed_files(wt):
    out = git("status", "--porcelain", "-uall", cwd=wt)
    files = []
    for line in out.splitlines():
        path = line[3:].strip().strip('"')
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        files.append(path.replace("\\", "/"))
    return sorted(f for f in files if f != "node_modules")


def fix_endings(wt, files):
    """Mixed endings in a changed text file become CRLF (the CLI may write LF lines into a CRLF file); a new LF file too."""
    fixed = []
    for f in files:
        p = wt / f
        if f in CRLF_EXEMPT or not p.is_file() or p.suffix not in (".ts", ".mts", ".py", ".json", ".md", ".html", ".cjs", ".js"):
            continue
        b = p.read_bytes()
        lf = b.count(b"\n") - b.count(b"\r\n")
        if lf:
            p.write_bytes(b.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
            fixed.append(f"{f} ({lf} LF lines)")
    return fixed


def gate_scope(t, wt, out):
    files = changed_files(wt)
    allowed = set(t["deliver"]) | set(t["may_touch"])
    extra = [f for f in files if f not in allowed]
    missing = [f for f in t["deliver"] if f not in files]
    notes = []
    if not files:
        return False, "no file changed", ""
    fixed = fix_endings(wt, files)
    if fixed:
        notes.append("line endings made CRLF: " + ", ".join(fixed))
    git("add", "-N", "--", *[f for f in files if (wt / f).exists()], cwd=wt, check=False)
    a, b = git("diff", "--stat", cwd=wt), git("diff", "--ignore-cr-at-eol", "--stat", cwd=wt)
    hits = []
    for f in files:
        p = wt / f
        if p.is_file() and p.suffix in (".ts", ".mts", ".py", ".json", ".cjs", ".js"):
            diff = git("diff", "--", f, cwd=wt, check=False)
            for line in diff.splitlines():
                if line.startswith("+") and not line.startswith("+++") and FORBIDDEN.search(line):
                    hits.append(f"{f}: {line[1:].strip()[:160]}")
    (out / "scope.txt").write_text(f"changed: {files}\nallowed: {sorted(allowed)}\n{chr(10).join(notes)}\n\n{a}\n\n"
                                   f"ignore-cr:\n{b}\n\nforbidden:\n" + "\n".join(hits), encoding="utf-8")
    problems = ([f"files outside the ticket: {', '.join(extra)}"] if extra else []) + \
               ([f"files the ticket delivers are missing: {', '.join(missing)}"] if missing else []) + \
               (["git diff --stat differs from --ignore-cr-at-eol (line endings changed)"] if a != b else []) + \
               ([f"another world's port or folder named: {'; '.join(hits[:5])}"] if hits else [])
    return not problems, "; ".join(problems) or f"{len(files)} files, all the ticket's" + (f"; {notes[0]}" if notes else ""), \
        "\n".join(problems)


def gate_typecheck(t, wt, out):
    code, text = run(["node", ROOT / "node_modules" / "typescript" / "bin" / "tsc", "--noEmit", "-p", "tsconfig.json"],
                     wt, cli_env(), out / "typecheck.txt", 600)
    return code == 0, "clean" if code == 0 else f"exit {code}", tail(text)


def offline_failures(text):
    m = re.search(r"\d+ ok, \d+ failed(?: \(([^)]*)\))?", text)
    return None if not m else set(x.strip() for x in (m.group(1) or "").split(",") if x.strip())


def gate_offline(t, wt, out, base_failed=frozenset()):
    """check:offline in the worktree; fails only on checks that pass on the base (some fail there already)."""
    code, text = run([PY, "scripts/check_offline.py"], wt, cli_env(), out / "check_offline.txt", 900)
    failed = offline_failures(text)
    if failed is None:
        return False, f"no summary line (exit {code})", tail(text)
    new = sorted(failed - set(base_failed))
    summary = next(l for l in reversed(text.splitlines()) if re.search(r"\d+ ok, \d+ failed", l)).strip()
    if base_failed:
        summary += f"; failing on the base too: {', '.join(sorted(base_failed))}"
    return not new, (summary if not new else f"newly failing: {', '.join(new)} ({summary})"), tail(text)


REVIEW_SCHEMA = {"type": "object", "required": ["verdict", "findings"], "properties": {
    "verdict": {"type": "string", "enum": ["pass", "fail"]},
    "findings": {"type": "array", "items": {"type": "object", "required": ["severity", "text"], "properties": {
        "file": {"type": "string"}, "line": {"type": "integer"}, "severity": {"type": "string", "enum": ["high", "medium", "low"]},
        "text": {"type": "string"}}}}}}


def gate_review(t, wt, out, reviewer, model):
    """A read-only agent reads the ticket and the diff; a fail with a high finding is a gate failure."""
    rdir = wt / "runs" / "foundry"
    rdir.mkdir(parents=True, exist_ok=True)
    diff = git("diff", cwd=wt)
    (rdir / "review_diff.patch").write_text(diff, encoding="utf-8")
    shutil.copy2(rdir / "review_diff.patch", out / "review_diff.patch")
    (rdir / "review_ticket.json").write_text(json.dumps(t, indent=2), encoding="utf-8")
    prompt = ("You review a candidate change for a Minecraft agent project (Mineflayer bots in real Minecraft). Read "
              "runs/foundry/review_ticket.json (what was asked) and runs/foundry/review_diff.patch (the change), and the "
              "surrounding code it touches (CLAUDE.md for the project's rules). Do not run any command: shell commands are "
              "refused here and end your turn. Look for: bugs that would throw inside mineflayer's or the pathfinder's "
              "callbacks; digging or placing blocks the ticket forbids; anything that could reach another server than the "
              "test server named by the environment (other ports, mc/server, RCON to other worlds); loops that can hang; "
              "failure messages that do not say what to do; the check passing when the skill does not work; skill names or "
              "arguments differing between skills.ts and mcSkills.ts. Answer only with JSON: {\"verdict\": \"pass\" or "
              "\"fail\", \"findings\": [{\"file\", \"line\", \"severity\": high|medium|low, \"text\"}]}. Fail only for a high "
              "finding: one that breaks the skill, the check or the server, or is unsafe.")
    if reviewer == "agy":
        schema = out / "review_schema.json"
        schema.write_text(json.dumps(REVIEW_SCHEMA), encoding="utf-8")
        cmd = [shutil.which("agy") or "agy", "-p", prompt, "--mode", "plan", "--model", model, "--output-format", "json",
               "--json-schema", str(schema), "--print-timeout", "20m"]
        code, text = run(cmd, wt, cli_env(), out / "review.txt", 1500)
    else:
        cmd = [shutil.which("claude") or "claude", "-p", "--permission-mode", "plan", "--model", model, "--output-format", "json",
               "--max-turns", "40", "--allowedTools", "Read,Glob,Grep"]
        code, text = run(cmd, wt, cli_env(), out / "review.txt", 1500, stdin_text=prompt)
    body = text.split("\n", 2)[-1]
    verdict = None
    try:
        env, _ = json.JSONDecoder().raw_decode(body[body.index("{"):])
        resp = env.get("result") if isinstance(env.get("result"), (str, dict)) else env.get("response")
        if isinstance(resp, dict):
            resp = resp.get("response", resp)
        verdict = resp if isinstance(resp, dict) else json.loads(re.search(r"\{.*\}", str(resp), re.S).group(0))
    except Exception:
        pass
    if not verdict or "verdict" not in verdict:
        return False, f"no verdict from the reviewer (exit {code}; review.txt)", tail(text, 30)
    (out / "review.json").write_text(json.dumps(verdict, indent=2), encoding="utf-8")
    high = [f for f in verdict.get("findings", []) if f.get("severity") == "high"]
    findings = "\n".join(f"- [{f.get('severity')}] {f.get('file', '')}:{f.get('line', '')} {f.get('text', '')}" for f in verdict.get("findings", []))
    ok = verdict["verdict"] == "pass" or not high
    return ok, f"{verdict['verdict']}, {len(verdict.get('findings', []))} findings ({len(high)} high)", findings


def agent_log_of(reset_text):
    m = re.search(r"log (\S*testagents-w\d+-\S+\.log)", reset_text)
    if not m:
        return None
    p = pathlib.Path(m.group(1))
    return p if p.is_absolute() else ROOT / p


def reset_world(code_from, logfile, checkpoint=None):
    cmd = [PY, "scripts/reset_site.py", "minevale3"] + (["--checkpoint", checkpoint] if checkpoint else [])
    # (the snapshot the reset must start: snapshot_code.py names it by a hash of code_from's files)
    want = subprocess.run([PY, "scripts/snapshot_code.py"], cwd=ROOT, env=world_env(MCAI_CODE_FROM=code_from),
                          capture_output=True, text=True).stdout.strip()
    code, text = run(cmd, ROOT, world_env(MCAI_CODE_FROM=code_from), logfile, 600)
    snap = re.search(r"code snapshot (\S+)", text)
    if code != 0 or not snap:
        return None, f"reset_site failed (exit {code})", tail(text)
    if not want or pathlib.Path(snap.group(1)).name != pathlib.Path(want).name:
        return None, f"the agent server's snapshot {snap.group(1)} is not of {code_from} ({want})", tail(text)
    return agent_log_of(text), "", ""


def gate_live(t, wt, out):
    agentlog, why, detail = reset_world(wt, out / "live_reset.txt")
    if not agentlog:
        return False, why, detail
    chk = t["check"]
    code, text = run([PY, wt / chk["file"], *chk.get("args", [])], ROOT, world_env(), out / "live_check.txt",
                     int(chk.get("timeout_min", 10) * 60))
    passed = code == 0 and re.search(chk["pass"], text, re.M)
    crashes = agentlog.read_text(encoding="utf-8", errors="replace").count("[crash-guard]") if agentlog.exists() else 0
    shutil.copy2(agentlog, out / "live_agentserver.log") if agentlog.exists() else None
    left = []
    try:
        left = [a.get("name") for a in api("/agents") or []]
        for name in left:
            api(f"/agents/{name}", method="DELETE")
    except Exception:
        pass
    ok = bool(passed) and not crashes
    summary = (f"{'passed' if passed else f'failed (exit {code})'}; {crashes} crash-guard lines in the agent server log"
               + (f"; agents left and removed: {', '.join(left)}" if left else ""))
    return ok, summary, tail(text)


def stop_category(stopped):
    s = (stopped or "").lower()
    if "every building is done" in s or "complete" in s:
        return "done"
    if "failed the same way" in s:
        return "same-fail"
    if "no stopped line" in s:
        return "killed"
    return "stall" if "stall" in s or "progress" in s else "other"


METRICS = (("[stuck]", 2, 5), ("[stuck-world]", 2, 5), ("[repath]", 2, 5), ("[dig]", 2, 5), ("[lag]", 2, 3))


def series_runs(spec_path, out, code_from, names, checkpoint):
    """Runs the ticket's series (main checkout's run_series.py on world 3) from code_from; returns the reports."""
    spec = json.loads((ROOT / spec_path).read_text(encoding="utf-8"))
    if any(r.get("save") for r in spec.get("runs", [])) or spec.get("save"):
        raise SystemExit(f"{spec_path}: a foundry series may not save checkpoints (mc/testcheckpoints is shared)")
    base_run = spec["runs"][0]
    # (the village saved in the checkpoint, which the run resumes)
    village = json.loads((CHECKS / checkpoint / "checkpoint.json").read_text(encoding="utf-8"))["villages"][0]["name"]
    spec.update({"world": WORLD, "out": str(out.relative_to(ROOT)).replace("\\", "/"),
                 "runs": [{**base_run, "name": n, "checkpoint": checkpoint, "village": base_run.get("village") or village} for n in names]})
    spec.pop("port", None)
    out.mkdir(parents=True, exist_ok=True)
    sp = out / "series_spec.json"
    sp.write_text(json.dumps(spec, indent=2), encoding="utf-8")
    code, text = run([PY, "scripts/run_series.py", sp], ROOT, world_env(MCAI_CODE_FROM=code_from), out / "series.txt",
                     int(spec.get("timeout_min", 30) * 60 * len(names) + 900))
    reports = []
    for n in names:
        r = run_report.report(str(out / f"{n}.log"))
        agent = out / f"reset_{n}.log"
        alog = agent_log_of(agent.read_text(encoding="utf-8", errors="replace")) if agent.exists() else None
        r["crash"] = alog.read_text(encoding="utf-8", errors="replace").count("[crash-guard]") if alog and alog.exists() else 0
        reports.append(r)
    return code, reports


def ckpt_key(cp):
    h = hashlib.sha1()
    for p in sorted((CHECKS / cp).rglob("*")):
        if p.is_file():
            st = p.stat()
            h.update(f"{p.relative_to(CHECKS)}:{st.st_size}:{int(st.st_mtime)}".encode())
    return h.hexdigest()[:8]


def private_checkpoint(spec_path):
    """The series' checkpoint copied once to foundry_<name>, so another session's save cannot change the baseline."""
    spec = json.loads((ROOT / spec_path).read_text(encoding="utf-8"))
    cp = spec["runs"][0].get("checkpoint") or spec.get("checkpoint")
    mine = cp if cp.startswith("foundry_") else f"foundry_{cp}"
    if not (CHECKS / mine / "checkpoint.json").exists():
        shutil.copytree(CHECKS / cp, CHECKS / mine)
        meta = json.loads((CHECKS / mine / "checkpoint.json").read_text(encoding="utf-8"))
        meta.update({"name": mine, "copied_from": cp})
        (CHECKS / mine / "checkpoint.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        log(f"checkpoint {cp} copied to {mine} (the foundry's own)")
    return mine


def baseline(t, base, cp, skip):
    """The base commit's series: two runs, cached by base, spec, checkpoint and harness."""
    h = hashlib.sha1((base + (ROOT / t["series"]).read_text(encoding="utf-8") + cp + ckpt_key(cp)).encode())
    for f in HARNESS:
        h.update((ROOT / f).read_bytes())
    d = ROOT / "runs" / "foundry" / f"baseline-{h.hexdigest()[:12]}"
    cached = d / "baseline.json"
    if cached.exists():
        log(f"baseline: cached {d.relative_to(ROOT)}")
        return json.loads(cached.read_text(encoding="utf-8"))
    if skip:
        return None
    log(f"baseline: two series runs from {base[:7]} on world 3 ({d.relative_to(ROOT)})")
    code, reports = series_runs(t["series"], d, base_tree(base), ["B1", "B2"], cp)
    data = {"base": base, "checkpoint": cp, "exit": code, "reports": reports}
    if any(r.get("error") for r in reports):
        log(f"baseline: a run gave no log ({d.relative_to(ROOT)}/series.txt); not cached")
        return data
    cached.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return data


def regressions(cand, base_reports):
    cats = {stop_category(r.get("stopped by")) for r in base_reports}
    probs = []
    if stop_category(cand.get("stopped by")) not in cats:
        probs.append(f"stopped by {cand.get('stopped by')!r} (baseline: {sorted(cats)})")
    fa = lambda r: int(str(r.get("failed before / after", "0 / 0")).split("/")[-1].strip() or 0)
    worst = max(fa(r) for r in base_reports)
    if fa(cand) > 1.5 * worst + 3:
        probs.append(f"failed actions after completion {fa(cand)} (baseline at most {worst})")
    for k, mul, add in METRICS:
        b = max(int(r.get(k) or 0) for r in base_reports)
        if int(cand.get(k) or 0) > mul * b + add:
            probs.append(f"{k} {cand.get(k)} (baseline at most {b})")
    if cand.get("crash"):
        probs.append(f"{cand['crash']} crash-guard lines in the agent server log")
    return probs


def gate_series(t, wt, out, base_data, cp, attempt):
    if not base_data or not base_data.get("reports") or any(r.get("error") for r in base_data["reports"]):
        return False, "no usable baseline", json.dumps(base_data)[:2000] if base_data else ""
    d = out / f"series-{attempt}"
    code, reports = series_runs(t["series"], d, wt, ["C1"], cp)
    probs = regressions(reports[0], base_data["reports"])
    if probs:
        log(f"series: an apparent regression ({'; '.join(probs)}): run again once")
        code, again = series_runs(t["series"], d, wt, ["C1b"], cp)
        reports += again
        if not regressions(again[0], base_data["reports"]):
            probs = []
    table = "\n".join(f"{k}: " + " | ".join(str(r.get(k, "-")) for r in base_data["reports"] + reports)
                      for k in ("run", "stopped by", "failed before / after", "[stuck]", "[stuck-world]", "[repath]", "[dig]", "[lag]", "crash"))
    (out / "series_table.txt").write_text(table + "\n", encoding="utf-8")
    return not probs, ("no regression against the baseline" if not probs else "; ".join(probs)), table


# ---------------------------------------------------------------- result

def authorship(cli, written_by):
    """Who wrote the change: this run's CLI rounds, or (a gates-only run) what --written-by says."""
    if cli.round:
        return f"Written by {cli.kind} ({cli.model}) in {cli.round} rounds, {cli.steps} tool steps"
    return f"Written {written_by or 'before this run (an earlier foundry run of the ticket)'}; this run: the gates only"


def commit(t, wt, cli, gates, written_by=None):
    files = changed_files(wt)
    git("add", "-A", "--", *files, cwd=wt)
    body = "\n".join(f"- {g['name']}: {'ok' if g['ok'] else 'FAILED'}, {g['summary']}" for g in gates)
    msg = (f"foundry: {t['title']}\n\n{authorship(cli, written_by)}, from scripts/foundry/tickets/{t['id']}.json; "
           f"checked by scripts/foundry.py:\n{body}\n\n"
           f"Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n")
    msgfile = wt / "runs" / "foundry" / "commit_msg.txt"
    msgfile.write_text(msg, encoding="utf-8")
    git("commit", "-q", "-F", str(msgfile), cwd=wt)
    return git("rev-parse", "--short", "HEAD", cwd=wt)


def write_report(t, wt, out, cli, base, gates, sha, started, outcome, written_by=None):
    stat = git("diff", "--stat", f"{base}..HEAD", cwd=wt, check=False) if sha else git("diff", "--stat", cwd=wt, check=False)
    lines = [f"# Foundry ticket {t['id']}: {t['title']}", "",
             f"- outcome: **{outcome}**",
             f"- {authorship(cli, written_by)}; this run's CLI: {cli.kind}, model {cli.model}; tokens {cli.usage['input']:,} in, "
             f"{cli.usage['output']:,} out" + (f"; ${cli.cost:.2f}" if cli.cost else ""),
             f"- minutes: {(time.time() - started) / 60:.0f} in all",
             f"- base: {base[:7]} (HEAD of tiered-brain-building when the ticket started; the main checkout's uncommitted work "
             f"is not in it)",
             f"- branch: `foundry/{t['id']}`" + (f" at {sha}" if sha else " (nothing committed)") + f"; worktree `.foundry/{t['id']}`",
             "", "## Gates", ""]
    for g in gates:
        lines.append(f"- **{g['name']}** (round {g['round']}): {'ok' if g['ok'] else 'FAILED'}: {g['summary']}")
    lines += ["", "## CLI rounds", ""] + [f"- round {c['round']}: {c['status']}, {c['seconds']} s, {c['steps']} steps so far"
                                         + (f", denied {c['denied']}" if c['denied'] else "") for c in cli.calls]
    review = out / "review.json"
    if review.exists():
        v = json.loads(review.read_text(encoding="utf-8"))
        lines += ["", "## Review", "", f"verdict: {v.get('verdict')}"] + \
                 [f"- [{f.get('severity')}] {f.get('file', '')}:{f.get('line', '')} {f.get('text', '')}" for f in v.get("findings", [])]
    lines += ["", "## Diff", "", "```", stat, "```", ""]
    if sha:
        lines += ["## To merge (the user's call)", "", "```", "git merge --no-ff foundry/" + t["id"], "```",
                  f"then `python scripts/foundry.py --cleanup {t['id']}` (and `--delete-branch` once merged)."]
    lines += ["", f"Files: {out.relative_to(ROOT)} (cli-round*.jsonl, message*.md, scope.txt, typecheck.txt, check_offline.txt, "
              "review.*, live_*.txt, series-*/)"]
    (out / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out / "result.json").write_text(json.dumps({"ticket": t["id"], "outcome": outcome, "branch": f"foundry/{t['id']}",
                                                 "commit": sha, "base": base, "cli": cli.kind, "model": cli.model,
                                                 "rounds": cli.calls, "gates": gates, "usage": cli.usage}, indent=2), encoding="utf-8")
    log(f"report {(out / 'report.md').relative_to(ROOT)}: {outcome}")


# ---------------------------------------------------------------- main

def probe(tid):
    """Whether agy's workspace stops at the worktree: it is asked to write inside and two levels up."""
    wt = FOUNDRY / tid
    if not wt.exists():
        raise SystemExit(f"no worktree {wt}")
    outside = ROOT / "foundry_probe_outside.txt"
    outside.unlink(missing_ok=True)
    out = ROOT / "runs" / TODAY / "foundry" / tid / "probe"
    out.mkdir(parents=True, exist_ok=True)
    agy_rules(True)
    try:
        code, text = run([shutil.which("agy") or "agy", "-p", "Write the text 1 into a new file probe_inside.txt in this folder, "
                          "then write the text 1 into ..\\..\\foundry_probe_outside.txt (two folders up). Reply which writes worked.",
                          "--output-format", "json", "--model", "gemini-3.8-flash-low", "--print-timeout", "3m", "--mode",
                          "accept-edits"], wt, cli_env(), out / "probe.txt", 300)
    finally:
        agy_rules(False)
    inside = (wt / "probe_inside.txt").exists()
    (wt / "probe_inside.txt").unlink(missing_ok=True)
    print(f"inside write: {'yes' if inside else 'no'}; outside write (must be no): {'YES' if outside.exists() else 'no'}")
    outside.unlink(missing_ok=True)


def cleanup(tid, delete_branch):
    wt = FOUNDRY / tid
    if wt.exists():
        if (wt / "node_modules").exists():
            subprocess.run(["cmd", "/c", "rmdir", str(wt / "node_modules")], capture_output=True)
        git("worktree", "remove", "--force", str(wt))
        log(f"worktree {wt.relative_to(ROOT)} removed")
    if delete_branch:
        git("branch", "-D", f"foundry/{tid}")
        log(f"branch foundry/{tid} deleted")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ticket", nargs="?")
    ap.add_argument("--cli", choices=["agy", "claude"], default="agy")
    ap.add_argument("--model")
    ap.add_argument("--reviewer", choices=["agy", "claude"])
    ap.add_argument("--review-model")
    ap.add_argument("--gates-only", action="store_true")
    ap.add_argument("--skip-baseline", action="store_true")
    ap.add_argument("--written-by", help="with --gates-only: who wrote the change (for the commit and the report)")
    ap.add_argument("--probe")
    ap.add_argument("--cleanup")
    ap.add_argument("--delete-branch", action="store_true")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if a.cleanup:
        return cleanup(a.cleanup, a.delete_branch)
    if a.probe:
        return probe(a.probe)
    if not a.ticket:
        raise SystemExit(__doc__)
    t = load_ticket(a.ticket)
    model = a.model or t["model"].get(a.cli) or ("gemini-4-argon-high" if a.cli == "agy" else "claude-opus-5-5")
    reviewer = a.reviewer or a.cli
    review_model = a.review_model or ("gemini-4-argon-high" if reviewer == "agy" else "claude-opus-5-5")
    out = ROOT / "runs" / TODAY / "foundry" / t["id"]
    out.mkdir(parents=True, exist_ok=True)
    started = time.time()
    with Lock(FOUNDRY / "foundry.lock"):
        if (FOUNDRY / "agy_rules_added").exists():
            agy_rules(False)
        preflight()
        base = git("rev-parse", "HEAD")
        wt = make_worktree(t, base)
        # (an existing worktree keeps the base it was made from)
        base = git("merge-base", "HEAD", "tiered-brain-building", cwd=wt)
        cp = private_checkpoint(t["series"])
        main_before = git("status", "--porcelain")
        cli = Cli(a.cli, model, wt, out, t["caps"])
        holder = {}
        bthread = threading.Thread(target=lambda: holder.update(data=baseline(t, base, cp, a.skip_baseline)), daemon=True)
        bthread.start()
        gates, outcome, sha = [], "failed", None
        if a.cli == "agy" or reviewer == "agy":
            agy_rules(True)
        try:
            alive = True
            # The base's own offline failures (run once on the worktree before the CLI changes it; kept for --gates-only)
            bfile = out / "offline_base.json"
            if bfile.exists():
                base_failed = set(json.loads(bfile.read_text(encoding="utf-8")))
            elif changed_files(wt):
                raise SystemExit(f"{bfile} is missing and the worktree has changes: the base's offline failures are unknown")
            else:
                code, text = run([PY, "scripts/check_offline.py"], wt, cli_env(), out / "check_offline_base.txt", 900)
                base_failed = offline_failures(text) or set()
                bfile.write_text(json.dumps(sorted(base_failed)), encoding="utf-8")
                log(f"base offline checks: {len(base_failed)} failing on the base ({', '.join(sorted(base_failed)) or 'none'})")
            if not a.gates_only:
                alive = work(cli, ticket_prompt(t, base), t["caps"])
            repairs = 0
            while alive:
                failed = None
                for name, fn in (("scope", gate_scope), ("typecheck", gate_typecheck),
                                 ("check:offline", lambda t, wt, out: gate_offline(t, wt, out, base_failed)),
                                 ("review", lambda t, wt, out: gate_review(t, wt, out, reviewer, review_model)),
                                 ("live", None), ("series", None)):
                    if name in ("live", "series") and bthread.is_alive():
                        log("waiting for the baseline series to free world 3")
                        bthread.join()
                    if name == "live":
                        ok, summary, detail = gate_live(t, wt, out)
                    elif name == "series":
                        ok, summary, detail = gate_series(t, wt, out, holder.get("data"), cp, repairs + 1)
                    else:
                        ok, summary, detail = fn(t, wt, out)
                    gates.append({"name": name, "ok": ok, "summary": summary, "round": cli.round})
                    log(f"gate {name}: {'ok' if ok else 'FAILED'}: {summary}")
                    if not ok:
                        failed = (name, summary, detail)
                        break
                if not failed:
                    outcome = "passed every gate"
                    break
                name, summary, detail = failed
                if name == "series" and summary == "no usable baseline":
                    outcome = "no baseline (the series gate could not judge)"
                    break
                repairs += 1
                if repairs > t["caps"]["rounds"] or cli.round >= t["caps"]["rounds"] + 3:
                    outcome = f"failed the {name} gate after {repairs - 1} repair rounds"
                    break
                # (a new conversation, as after --gates-only, gets the whole ticket first)
                intro = "" if cli.conv else ticket_prompt(t, base) + ("\n## Where it stands\n\nThe files above were written in an "
                                                                    "earlier conversation; the foundry's gates have now run on them.\n\n")
                alive = work(cli, intro + f"The foundry's gate '{name}' failed: {summary}\n\nIts output (last lines):\n\n{detail}\n\n"
                                  "Fix the cause within the ticket's files and rules, then end with your summary.", t["caps"])
            if not alive:
                outcome = f"the CLI hit a cap ({cli.calls[-1]['status']})"
            main_after = git("status", "--porcelain")
            if main_after != main_before:
                new = sorted(set(main_after.splitlines()) - set(main_before.splitlines()))
                (out / "main_checkout_changes.txt").write_text("\n".join(new), encoding="utf-8")
                log(f"note: the main checkout's status changed during the ticket ({len(new)} lines; another session's work, or "
                    f"look: main_checkout_changes.txt)")
            if outcome == "passed every gate":
                sha = commit(t, wt, cli, gates, a.written_by)
                log(f"committed {sha} on foundry/{t['id']} (not merged, not pushed: the user's call)")
        finally:
            if a.cli == "agy" or reviewer == "agy":
                agy_rules(False)
            if bthread.is_alive():
                log("waiting for the baseline series to end")
                bthread.join()
            write_report(t, wt, out, cli, base, gates, sha, started, outcome, a.written_by)
    print(f"FOUNDRY DONE {t['id']}: {outcome}")


if __name__ == "__main__":
    main()
