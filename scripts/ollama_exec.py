"""Local model servers for the agents: one Ollama instance per local model, each pinned to its own GPU.

Usage: python scripts/ollama_exec.py start|stop|status [exec|plan|all]    (default: all)

  exec  qwen3:30b-instruct on GPU 1 (nvidia-smi's numbering; it also drives the display), port 11435, 3 requests at once: executors are many
        small calls from every agent (a mixture of experts batches well; three 8k contexts add about 1.5 GB)
  plan  qwen3.8:27b on GPU 0, port 11436, one request at a time: the workers' planner (22 GB: no room for more slots)

GPUs are pinned by UUID (CUDA_VISIBLE_DEVICES): CUDA's device numbers do not match nvidia-smi's on this machine.
The Ollama app (port 11434) cannot be told where to put models: with two models it split one across both cards and
left no room, so Windows spilled into system RAM (60x slower). So the local models run here instead, and the app keeps
serving cloud models (no GPU memory). `start` unloads the models from the app, runs ollama.exe serve directly (not the
app, which updates itself), loads each model and checks it is fully in VRAM and fast. Then start the agent server with
the MC_OLLAMA_ROUTES line it prints.
"""
import json, os, pathlib, subprocess, sys, tempfile, time, urllib.request

MAIN = "http://127.0.0.1:11434"
INSTANCES = {
    "exec": {"port": 11435, "model": "qwen3:30b-instruct", "gpu": int(os.environ.get("EXEC_GPU", 1)), "parallel": int(os.environ.get("EXEC_PARALLEL", 3)), "min_tps": 20},
    "plan": {"port": 11436, "model": "qwen3.8:27b", "gpu": int(os.environ.get("PLAN_GPU", 0)), "parallel": 1, "min_tps": 10},
}
EXE = pathlib.Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe"
TMP = pathlib.Path(tempfile.gettempdir())
cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
which = sys.argv[2] if len(sys.argv) > 2 else "all"
names = list(INSTANCES) if which == "all" else [which]


def call(base, path, body=None, timeout=10):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or "null")


def up(base):
    try:
        call(base, "/api/version", timeout=2)
        return True
    except Exception:
        return False


def loaded(base):
    try:
        return call(base, "/api/ps")["models"]
    except Exception:
        return []


def gpus():
    out = subprocess.run(["nvidia-smi", "--query-gpu=index,memory.used,memory.total", "--format=csv,noheader,nounits"],
                         capture_output=True, text=True, check=True).stdout
    return [tuple(int(v) for v in line.split(",")) for line in out.strip().splitlines()]


def gpu_uuid(index):
    """The UUID of a GPU as nvidia-smi numbers it: CUDA's own numbering can differ, the UUID is unambiguous."""
    out = subprocess.run(["nvidia-smi", "--query-gpu=index,uuid", "--format=csv,noheader"], capture_output=True, text=True, check=True).stdout
    for line in out.strip().splitlines():
        i, uuid = [v.strip() for v in line.split(",")]
        if int(i) == index:
            return uuid
    raise SystemExit(f"no GPU {index}")


def describe(base):
    ms = loaded(base)
    return ", ".join(f"{m['name']} ({m['size_vram'] // 2**20} of {m['size'] // 2**20} MB in VRAM)" for m in ms) or "nothing loaded"


def routes():
    return ",".join(f"{c['model']}=http://127.0.0.1:{c['port']}" for c in INSTANCES.values())


if cmd == "status":
    print(f"app ({MAIN}):", describe(MAIN) if up(MAIN) else "not running")
    for n, c in INSTANCES.items():
        url = f"http://127.0.0.1:{c['port']}"
        print(f"{n} ({url}, GPU {c['gpu']}):", describe(url) if up(url) else "not running")
    for i, used, total in gpus():
        print(f"GPU {i}: {used} / {total} MB used")
    print(f'MC_OLLAMA_ROUTES="{routes()}"')

elif cmd == "start":
    if not EXE.exists():
        raise SystemExit(f"{EXE} not found")
    # The app must not hold these models (it would claim the same GPU memory)
    if up(MAIN):
        held = [c["model"] for c in INSTANCES.values() if any(m["name"] == c["model"] for m in loaded(MAIN))]
        for model in held:
            call(MAIN, "/api/generate", {"model": model, "keep_alive": 0}, timeout=60)
        # Unloading takes a few seconds to free the memory; a model loaded before that is only partly put on the GPU
        for _ in range(30):
            if not any(m["name"] in held for m in loaded(MAIN)):
                break
            time.sleep(1)
        time.sleep(5 if held else 0)
    for n in names:
        c = INSTANCES[n]
        url = f"http://127.0.0.1:{c['port']}"
        if up(url):
            print(f"{n}: already running on port {c['port']}")
            continue
        env = {**os.environ, "OLLAMA_HOST": f"127.0.0.1:{c['port']}", "CUDA_VISIBLE_DEVICES": gpu_uuid(c["gpu"]),
               "OLLAMA_NUM_PARALLEL": str(c["parallel"]),
               "OLLAMA_MAX_LOADED_MODELS": "1", "OLLAMA_KEEP_ALIVE": "60m"}
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW
        log = TMP / f"ollama_{n}.log"
        proc = subprocess.Popen([str(EXE), "serve"], env=env, stdout=open(log, "w"), stderr=subprocess.STDOUT, creationflags=flags)
        (TMP / f"ollama_{n}.pid").write_text(str(proc.pid))
        for _ in range(60):
            if up(url):
                break
            time.sleep(0.5)
        else:
            raise SystemExit(f"{n}: did not start; see {log}")
        # Load the model and time a short answer: a model spilled into system RAM is 10-60x slower. If it did not all
        # fit on the GPU (memory still being freed), unload and load it once more.
        for attempt in range(2):
            r = call(url, "/api/generate", {"model": c["model"], "prompt": "Count from 1 to 40.", "stream": False,
                                            "options": {"num_ctx": 8192, "num_predict": 60}}, timeout=600)
            m = next((x for x in loaded(url) if x["name"] == c["model"]), None)
            if (m and m["size_vram"] >= m["size"]) or attempt == 1:
                break
            call(url, "/api/generate", {"model": c["model"], "keep_alive": 0}, timeout=60)
            time.sleep(5)
        tps = r.get("eval_count", 0) / max(1e-9, r.get("eval_duration", 1) / 1e9)
        ok = m and m["size_vram"] >= m["size"] and tps >= c["min_tps"]
        print(f"{n}: {c['model']} on GPU {c['gpu']}, port {c['port']}, {describe(url)}, {tps:.0f} tok/s"
              f"{'' if ok else '  WARNING: not all in VRAM or too slow (spilled into system RAM?)'}")
    for i, used, total in gpus():
        print(f"GPU {i}: {used} / {total} MB used")
    print(f'Start the agent server with MC_OLLAMA_ROUTES="{routes()}"')

elif cmd == "stop":
    for n in names:
        pidfile = TMP / f"ollama_{n}.pid"
        if not pidfile.exists():
            print(f"{n}: not started by this script")
            continue
        pid = pidfile.read_text().strip()
        subprocess.run(["taskkill", "/PID", pid, "/T", "/F"], capture_output=True)
        pidfile.unlink()
        print(f"{n}: stopped (pid {pid})")

else:
    raise SystemExit(__doc__)
