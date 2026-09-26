"""Start the local Paper server (set up with mc/setup.py). Type server commands into this console; `stop` saves and exits.

Usage: python mc/start.py [MEMORY]   (MEMORY defaults to 4G)
"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent
SERVER = ROOT / "server"
java = (sorted((ROOT / "runtime").glob("*/bin/java.exe")) + sorted((ROOT / "runtime").glob("*/bin/java")) or [None])[-1]
if not java or not (SERVER / "paper.jar").exists():
    raise SystemExit("run python mc/setup.py first")
eula = SERVER / "eula.txt"
if not eula.exists() or "eula=true" not in eula.read_text():
    raise SystemExit("accept the Minecraft EULA first: read https://aka.ms/MinecraftEULA and put eula=true in mc/server/eula.txt")
mem = sys.argv[1] if len(sys.argv) > 1 else "4G"
sys.exit(subprocess.call([str(java), f"-Xms{mem}", f"-Xmx{mem}", "-jar", "paper.jar", "--nogui"], cwd=SERVER))
