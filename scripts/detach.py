"""Start a server detached from the shell and the Claude session that started it, logging to a file.

Usage: python scripts/detach.py LOGFILE COMMAND [ARGS...]     (prints the new process's PID)
e.g.   python scripts/detach.py runs/2026-10-01/paper.log python mc/start.py
       MC_API_HOST=0.0.0.0 python scripts/detach.py runs/2026-10-01/agents.log node node_modules/tsx/dist/cli.mjs server/src/mineflayer/index.ts

Why (F90, 2026-10-01): a server started as a session's background task was stopped at the task's 30-minute limit
(Paper, killed unsaved). This one gets a hidden console of its own (not DETACHED_PROCESS: java then opened a console
window, closing it kills Paper, and its output went there instead of the log) and its own process group. The environment
and working directory are the caller's. A detached Paper also writes logs/latest.log.

Out of the Claude app's job (#99, F291): every process a session starts is in the desktop app's job object, which does
not allow breaking away from the Bash tool's shell, and an app update kills the job (Long1, 10-22). So the command is
started by WMI (Win32_Process.Create, whose processes belong to no job): WMI runs this script again with --spawn and a
spec file (command, log, directory, environment), and that one starts the command and writes its PID back. Without WMI
it falls back to a plain start in the job, with a warning.

`launch()` is the same for scripts (stack.py and reset_site.py through `reset_site.detached`): it returns a handle with
`.pid` and `.poll()`.
"""
import ctypes, json, os, pathlib, subprocess, sys, tempfile, time

FLAGS = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
BREAKAWAY = getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0)


class Proc:
    """A process started elsewhere, by PID: `poll()` is None while it runs, else its exit code (a handle is held from the
    start, so a reused PID is not mistaken for it)."""

    def __init__(self, pid):
        self.pid = pid
        self.returncode = None
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.OpenProcess.restype = ctypes.c_void_p
        k.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
        k.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]
        self._k, self._h = k, k.OpenProcess(0x1000 | 0x100000, False, pid)  # QUERY_LIMITED_INFORMATION | SYNCHRONIZE

    def poll(self):
        if self.returncode is None:
            code = ctypes.c_uint32()
            if not self._h or not self._k.GetExitCodeProcess(self._h, ctypes.byref(code)):
                self.returncode = -1
            elif code.value != 259:  # STILL_ACTIVE
                self.returncode = code.value
        return self.returncode


def _popen(cmd, log, cwd, env, breakaway):
    out = open(log, "a")
    try:
        return subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, cwd=cwd, env=env,
                                creationflags=FLAGS | (BREAKAWAY if breakaway else 0))
    finally:
        out.close()


def _wmi(cmdline, cwd):
    """Start a command line through WMI (hidden window); its PID, or None."""
    ps = ("$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]0}; "
          "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments "
          "@{CommandLine=$env:DETACH_CMDLINE; CurrentDirectory=$env:DETACH_CWD; ProcessStartupInformation=$si}; "
          "if ($r.ReturnValue -eq 0) { $r.ProcessId } else { 'error ' + $r.ReturnValue }")
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, text=True, timeout=60,
                           env={**os.environ, "DETACH_CMDLINE": cmdline, "DETACH_CWD": cwd})
    except (OSError, subprocess.TimeoutExpired):
        return None
    out = r.stdout.strip().splitlines()
    return int(out[-1]) if out and out[-1].strip().isdigit() else None


def launch(cmd, log, cwd=None, env=None):
    """Start `cmd` out of the caller's job, its output appended to `log`; a Proc. Falls back to a start in the job."""
    cwd, env = str(pathlib.Path(cwd or os.getcwd()).resolve()), dict(os.environ if env is None else env)
    log = str(pathlib.Path(cwd, log).resolve())
    fd, spec = tempfile.mkstemp(prefix="detach-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({"cmd": [str(c) for c in cmd], "log": log, "cwd": cwd, "env": env}, f)
    pidfile = spec + ".pid"
    py = pathlib.Path(sys.executable)
    pyw = py.with_name("pythonw.exe") if py.with_name("pythonw.exe").exists() else py
    if _wmi(subprocess.list2cmdline([str(pyw), str(pathlib.Path(__file__).resolve()), "--spawn", spec]), cwd):
        end = time.time() + 30
        while time.time() < end:
            if os.path.exists(pidfile):
                text = open(pidfile, encoding="utf-8").read().strip()
                if text:
                    for p in (spec, pidfile):
                        try:
                            os.remove(p)
                        except OSError:
                            pass
                    if text.startswith("error"):
                        raise OSError(f"detach: {text}")
                    return Proc(int(text))
            time.sleep(0.1)
        # (no fallback: the command may yet start, and a second copy would fight it for its ports)
        raise OSError(f"detach: WMI started the launcher but no PID came back in 30 s ({spec})")
    try:
        os.remove(spec)
    except OSError:
        pass
    print("detach: WMI did not start it; started in the caller's job (it dies with the Claude app, #99)", file=sys.stderr)
    try:
        p = _popen(cmd, log, cwd, env, True)
    except OSError:  # the job does not allow leaving it
        p = _popen(cmd, log, cwd, env, False)
    return p


def _spawn(spec):
    """Run by WMI, out of any job: start the spec's command and write its PID (or the error) beside the spec."""
    s = json.load(open(spec, encoding="utf-8"))
    try:
        text = str(_popen(s["cmd"], s["log"], s["cwd"], s["env"], False).pid)
    except OSError as e:
        text = f"error {e}"
    with open(spec + ".tmp", "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(spec + ".tmp", spec + ".pid")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--spawn":
        _spawn(sys.argv[2])
    elif len(sys.argv) < 3:
        raise SystemExit(__doc__)
    else:
        print(launch(sys.argv[2:], sys.argv[1]).pid)
