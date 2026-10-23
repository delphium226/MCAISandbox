"""Check that scripts/detach.py starts a process that outlives its starter's job (#99, F291).

Usage: python scripts/checks/detach_job.py [DETACH_PY]     (another detach.py to test: the old one fails)

A Claude app update kills the app's job object and every process in it (Long1, 10-22). This makes a job of its own that
forbids breaking away and kills its processes when closed (as the app's does), starts a parent python in it that runs
detach.py on a sleeping child (python, and node spawning a second node like the agent server), terminates the job, and
checks that the parent is gone and the child lives on. Then it stops the child. No world needed; ~10 s. Prints PASS or FAIL.
"""
import ctypes, ctypes.wintypes as W, pathlib, shutil, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[2]
DETACH = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "scripts" / "detach.py"
k = ctypes.WinDLL("kernel32", use_last_error=True)
k.CreateJobObjectW.restype = W.HANDLE
k.OpenProcess.restype = W.HANDLE
k.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
k.AssignProcessToJobObject.argtypes = [W.HANDLE, W.HANDLE]
k.TerminateJobObject.argtypes = [W.HANDLE, W.UINT]
k.IsProcessInJob.argtypes = [W.HANDLE, W.HANDLE, ctypes.POINTER(W.BOOL)]
k.GetExitCodeProcess.argtypes = [W.HANDLE, ctypes.POINTER(W.DWORD)]
k.SetInformationJobObject.argtypes = [W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD]


class BASIC(ctypes.Structure):
    _fields_ = [("a", ctypes.c_int64), ("b", ctypes.c_int64), ("LimitFlags", W.DWORD), ("c", ctypes.c_size_t), ("d", ctypes.c_size_t),
                ("e", W.DWORD), ("f", ctypes.c_size_t), ("g", W.DWORD), ("h", W.DWORD)]


class EXT(ctypes.Structure):
    _fields_ = [("Basic", BASIC), ("Io", ctypes.c_uint64 * 6), ("i", ctypes.c_size_t), ("j", ctypes.c_size_t), ("l", ctypes.c_size_t),
                ("m", ctypes.c_size_t)]


def alive(pid):
    h = k.OpenProcess(0x1000, False, pid)
    code = W.DWORD()
    return bool(h) and k.GetExitCodeProcess(h, ctypes.byref(code)) and code.value == 259


def in_job(pid):
    h = k.OpenProcess(0x1000, False, pid)
    b = W.BOOL()
    k.IsProcessInJob(h, None, ctypes.byref(b))
    return bool(b.value)


def trial(label, child):
    """One child started through detach.py from a parent in a job of our own, then the job killed."""
    job = k.CreateJobObjectW(None, None)
    e = EXT()
    e.Basic.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE, no BREAKAWAY_OK: like the app's job seen from the Bash tool
    k.SetInformationJobObject(job, 9, ctypes.byref(e), ctypes.sizeof(e))
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="detach-job-"))
    log, pidf = tmp / "child.log", tmp / "child.pid"
    # The parent: suspended until it is in the job, then runs detach.py on the child and sleeps
    parent_code = (f"import subprocess, sys; r = subprocess.run([sys.executable, {str(DETACH)!r}, {str(log)!r}, *{child!r}], "
                   f"capture_output=True, text=True); open({str(pidf)!r}, 'w').write(r.stdout.strip()); sys.stderr.write(r.stderr); "
                   f"import time; time.sleep(600)")
    parent = subprocess.Popen([sys.executable, "-c", parent_code], creationflags=0x4)  # CREATE_SUSPENDED
    k.AssignProcessToJobObject(job, int(parent._handle))
    ctypes.WinDLL("ntdll").NtResumeProcess(W.HANDLE(int(parent._handle)))
    end = time.time() + 60
    while time.time() < end and not (pidf.exists() and pidf.read_text().strip()):
        time.sleep(0.2)
    if not (pidf.exists() and pidf.read_text().strip()):
        print(f"{label}: FAIL: detach.py printed no PID in 60 s")
        k.TerminateJobObject(job, 1)
        return False
    child_pid = int(pidf.read_text().strip().splitlines()[-1])
    time.sleep(2)  # (a node child joins a job of libuv's own once it spawns: its own, not ours)
    print(f"{label}: parent {parent.pid} in our job: {in_job(parent.pid)}; child {child_pid} alive {alive(child_pid)}, in a job: {in_job(child_pid)}")
    k.TerminateJobObject(job, 1)
    time.sleep(2)
    p_alive, c_alive = alive(parent.pid), alive(child_pid)
    print(f"{label}: after the job's kill: parent alive {p_alive}, child alive {c_alive}; child log: {log.read_text().strip()!r}")
    if c_alive:
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(child_pid)], capture_output=True)
    return not p_alive and c_alive and "child up" in log.read_text()


def main():
    node = shutil.which("node")
    trials = [("python", [sys.executable, "-c", "import time; print('child up', flush=True); time.sleep(600)"])]
    if node:  # like the agent server: tsx's node spawns a second node
        trials.append(("node", [node, "-e", "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)']); "
                                           "console.log('child up'); setTimeout(() => {}, 600000)"]))
    ok = all([trial(label, child) for label, child in trials])
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
