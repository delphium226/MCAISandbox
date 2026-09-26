"""Send commands to the local Minecraft server over RCON (password from mc/server/server.properties).

Usage: python mc/rcon.py "command" ["command" ...]    e.g. python mc/rcon.py "list" "time set day"
`stop` saves the world and shuts the server down.
"""
import pathlib, socket, struct, sys

PROPS = pathlib.Path(__file__).resolve().parent / "server" / "server.properties"


def settings():
    kv = dict(l.split("=", 1) for l in PROPS.read_text().splitlines() if "=" in l and not l.startswith("#"))
    return kv.get("server-ip") or "127.0.0.1", int(kv.get("rcon.port", 25575)), kv["rcon.password"]


class Rcon:
    def __init__(self):
        host, port, password = settings()
        self.s = socket.create_connection((host, port), timeout=10)
        self.id = 0
        if self.send(3, password)[0] == -1:
            raise SystemExit("RCON login failed")

    def send(self, kind, body):
        self.id += 1
        data = struct.pack("<ii", self.id, kind) + body.encode() + b"\0\0"
        self.s.sendall(struct.pack("<i", len(data)) + data)
        size = struct.unpack("<i", self._read(4))[0]
        rid, _ = struct.unpack("<ii", self._read(8))
        return rid, self._read(size - 8)[:-2].decode(errors="replace")

    def _read(self, n):
        out = b""
        while len(out) < n:
            chunk = self.s.recv(n - len(out))
            if not chunk:
                raise ConnectionError("RCON connection closed")
            out += chunk
        return out

    def command(self, cmd):
        return self.send(2, cmd)[1]


if __name__ == "__main__":
    r = Rcon()
    for c in sys.argv[1:]:
        print(r.command(c))
