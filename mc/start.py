"""Start the local Paper server (set up with mc/setup.py). Type server commands into this console; `stop` saves and exits.

Usage: python mc/start.py [MEMORY]   (MEMORY defaults to 4G)
MC_SERVER_DIR picks the server folder (absolute or relative to the repository; default mc/server), e.g.
MC_SERVER_DIR=mc/testserver python mc/start.py for the test world (plan step T.2, set up with mc/testserver.py init).
"""
import os, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent
SERVER = pathlib.Path(os.environ.get("MC_SERVER_DIR") or ROOT / "server")
if not SERVER.is_absolute():
    SERVER = ROOT.parent / SERVER
java = (sorted((ROOT / "runtime").glob("*/bin/java.exe")) + sorted((ROOT / "runtime").glob("*/bin/java")) or [None])[-1]
if not java or not (SERVER / "paper.jar").exists():
    raise SystemExit(f"no paper.jar in {SERVER}: run python mc/setup.py first (or python mc/testserver.py init for the test world)")
eula = SERVER / "eula.txt"
if not eula.exists() or "eula=true" not in eula.read_text():
    raise SystemExit(f"accept the Minecraft EULA first: read https://aka.ms/MinecraftEULA and put eula=true in {eula}")
mem = sys.argv[1] if len(sys.argv) > 1 else "4G"
sys.exit(subprocess.call([str(java), f"-Xms{mem}", f"-Xmx{mem}", "-jar", "paper.jar", "--nogui"], cwd=SERVER))
