"""Send commands to the local Minecraft server over RCON (address and password from the server's server.properties).

Usage: python mc/rcon.py "command" ["command" ...]    e.g. python mc/rcon.py "list" "time set day"
`stop` saves the world and shuts the server down.
MC_SERVER_DIR picks the server folder (absolute or relative to the repository; default mc/server), e.g.
MC_SERVER_DIR=mc/testserver python mc/rcon.py "list" for the test world (plan step T.2).
"""
import os, pathlib, select, socket, struct, sys

HERE = pathlib.Path(__file__).resolve().parent


def server_dir(path=None):
    """The server folder: `path`, else MC_SERVER_DIR, else mc/server; a relative path is taken from the repository root."""
    p = pathlib.Path(path or os.environ.get("MC_SERVER_DIR") or HERE / "server")
    return p if p.is_absolute() else HERE.parent / p


def settings(path=None):
    props = server_dir(path) / "server.properties"
    kv = dict(l.split("=", 1) for l in props.read_text().splitlines() if "=" in l and not l.startswith("#"))
    return kv.get("server-ip") or "127.0.0.1", int(kv.get("rcon.port", 25575)), kv["rcon.password"]


class Rcon:
    def __init__(self, path=None):
        host, port, password = settings(path)
        self.s = socket.create_connection((host, port), timeout=10)
        self.id = 0
        if self.send(3, password)[0] == -1:
            raise SystemExit("RCON login failed")

    def send(self, kind, body):
        self.post(kind, body)
        return self.reply()

    def post(self, kind, body):
        self.id += 1
        data = struct.pack("<ii", self.id, kind) + body.encode() + b"\0\0"
        self.s.sendall(struct.pack("<i", len(data)) + data)

    def reply(self):
        size = struct.unpack("<i", self._read(4))[0]
        rid, _ = struct.unpack("<ii", self._read(8))
        return rid, self._read(size - 8)[:-2].decode(errors="replace")

    def closed(self):
        """True when the server has closed its end (a restart, a timeout): nothing sent now would arrive."""
        try:
            if not select.select([self.s], [], [], 0)[0]:
                return False
            return self.s.recv(1, socket.MSG_PEEK) == b""
        except OSError:
            return True

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

    def close(self):
        try:
            self.s.close()
        except OSError:
            pass


# One connection per server folder for a script's whole life (#112: a connection per command, or a process running this
# file per command, left hundreds of sockets in TIME_WAIT and helped run the machine out of ephemeral ports)
_shared = {}


def command(cmd, path=None):
    """`cmd` over this process's kept connection to the server in `path` (default as settings()), opened on first use and
    again when the server has closed it (a restart). An error while sending or reading raises and drops the connection:
    the command may have run, so it is never sent twice; the next call connects afresh."""
    key = str(server_dir(path))
    r = _shared.get(key)
    if r is not None and r.closed():
        r.close()
        r = None
    if r is None:
        r = _shared[key] = Rcon(path)
    try:
        r.post(2, cmd)
        return r.reply()[1]
    except OSError:
        r.close()
        _shared.pop(key, None)
        raise


if __name__ == "__main__":
    r = Rcon()
    for c in sys.argv[1:]:
        print(r.command(c))
