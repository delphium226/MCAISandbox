"""Set up the local Minecraft server the Mineflayer agents play on: a Paper server bound to this machine only.

Usage: python mc/setup.py
Downloads (with checksum checks) a portable Temurin 25 runtime into mc/runtime and the Paper jar into mc/server, and
writes mc/server/server.properties on the first run: offline mode (bots need no accounts), listening on 127.0.0.1 only
(nothing is reachable from other machines), RCON on 127.0.0.1 with a random password (the adapter uses it to op
agents and run build commands), and a fixed seed. Nothing outside mc/ is changed. Re-running updates the jar and
leaves the world and settings alone.
Then accept the Minecraft EULA (https://aka.ms/MinecraftEULA) by setting eula=true in mc/server/eula.txt, and start
the server with python mc/start.py.
"""
import hashlib, json, pathlib, secrets, shutil, urllib.request, zipfile

MC_VERSION = "26.1.2"  # protocol 775, the same as 26.1, the newest version Mineflayer supports
JAVA = 25
SEED = 1793578865  # the sandbox's seed, for no reason other than being easy to recognise
ROOT = pathlib.Path(__file__).resolve().parent
RUNTIME, SERVER = ROOT / "runtime", ROOT / "server"
UA = {"User-Agent": "MCAISandbox-setup/1.0 (local agent test server)"}  # the PaperMC API refuses requests without one


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def download(url, dest, sha256):
    if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == sha256:
        return False
    print(f"downloading {url}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f)
    got = hashlib.sha256(tmp.read_bytes()).hexdigest()
    if got != sha256:
        tmp.unlink()
        raise SystemExit(f"checksum mismatch for {url}: {got} != {sha256}")
    tmp.replace(dest)
    return True


def java_exe():
    found = sorted(RUNTIME.glob("*/bin/java.exe")) + sorted(RUNTIME.glob("*/bin/java"))
    return found[-1] if found else None


def setup_java():
    asset = get_json(f"https://api.adoptium.net/v3/assets/latest/{JAVA}/hotspot?os=windows&architecture=x64&image_type=jre")[0]
    pkg = asset["binary"]["package"]
    RUNTIME.mkdir(exist_ok=True)
    zip_path = RUNTIME / pkg["name"]
    if download(pkg["link"], zip_path, pkg["checksum"]) or not java_exe():
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(RUNTIME)
    print(f"java: {java_exe()} ({asset['version']['semver']})")


def setup_paper():
    build = get_json(f"https://fill.papermc.io/v3/projects/paper/versions/{MC_VERSION}/builds/latest")
    dl = build["downloads"]["server:default"]
    SERVER.mkdir(exist_ok=True)
    download(dl["url"], SERVER / "paper.jar", dl["checksums"]["sha256"])
    print(f"paper: {dl['name']} ({build['channel']})")


def setup_properties():
    props = SERVER / "server.properties"
    if props.exists():
        print("server.properties exists; left as it is")
        return
    props.write_text("\n".join([
        "# Written by mc/setup.py: a private server for agents on this machine only",
        "online-mode=false",
        "enforce-secure-profile=false",
        "server-ip=127.0.0.1",
        "server-port=25565",
        "enable-rcon=true",
        "rcon.port=25575",
        f"rcon.password={secrets.token_hex(16)}",
        "broadcast-rcon-to-ops=false",
        "motd=MCAISandbox agents (private)",
        "level-name=world",
        f"level-seed={SEED}",
        "gamemode=survival",
        "difficulty=easy",
        "spawn-protection=0",
        "allow-flight=true",
        "max-players=16",
        "view-distance=8",
        "simulation-distance=6",
        "",
    ]))
    print("wrote server.properties")


setup_java()
setup_paper()
setup_properties()
if "eula=true" not in ((SERVER / "eula.txt").read_text() if (SERVER / "eula.txt").exists() else ""):
    print("Next: read https://aka.ms/MinecraftEULA and put eula=true in mc/server/eula.txt, then run python mc/start.py")
