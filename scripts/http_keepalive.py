"""HTTP calls to the agent servers over one kept-alive connection per server (#112): urllib opens a new connection per
request and asks the server to close it, so a poller every few seconds left hundreds of sockets in TIME_WAIT, and with
several runs and their pollers at once the machine ran out of ephemeral ports (WinError 10048) and a run ended.

    from http_keepalive import urlopen
    with urlopen(API + "/agents", timeout=30) as r: data = json.loads(r.read())

urlopen(url_or_request, data=None, timeout=...) is a drop-in for urllib.request.urlopen on http:// URLs: it answers with
the same kind of object (read(), status, getcode(), a context manager) and raises the same errors (HTTPError for a status
of 400 and up, URLError around an error while connecting or sending, a raw ConnectionError or timeout while reading the
answer), so callers' error handling keeps working. Anything else (https, file:) goes to urllib.

One connection per host and port per process, reused while it lives. The agent server (Node) closes a connection idle 5 s,
so one idle longer is replaced before use; a kept connection that turns out to be closed (the server's end went first)
is opened again and the request sent once more, as it never reached the server. Not thread-safe: a thread keeps its own
connections (threading.local).
"""
import http.client, io, socket, threading, time, urllib.error, urllib.parse, urllib.request

# A connection idle longer than this is opened again before use (Node's keepAliveTimeout is 5 s)
IDLE_S = 4.0
_local = threading.local()
# (errors that mean a reused connection was already closed by the server: the request is sent again on a new one)
STALE = (http.client.RemoteDisconnected, BrokenPipeError, ConnectionResetError, ConnectionAbortedError)


class _Conn:
    def __init__(self, host, port):
        self.host, self.port = host, port
        self.c, self.used = None, 0.0

    def close(self):
        if self.c is not None:
            try:
                self.c.close()
            except OSError:
                pass
        self.c = None

    def fresh(self, timeout):
        """True when the connection is (re)opened for this request, False when a kept one is reused."""
        if self.c is not None and time.time() - self.used > IDLE_S:
            self.close()
        if self.c is None:
            self.c = http.client.HTTPConnection(self.host, self.port, timeout=timeout)
            return True
        self.c.timeout = timeout
        if self.c.sock is not None:
            self.c.sock.settimeout(timeout)
        return False


def _conn(host, port):
    pool = getattr(_local, "pool", None)
    if pool is None:
        pool = _local.pool = {}
    key = (host, port)
    if key not in pool:
        pool[key] = _Conn(host, port)
    return pool[key]


class Response(io.BytesIO):
    """The answer, read whole (the connection is free again at once): read(), status, getcode(), headers, url."""

    def __init__(self, body, status, reason, headers, url):
        super().__init__(body)
        self.status, self.code, self.reason, self.headers, self.url = status, status, reason, headers, url

    def getcode(self):
        return self.status

    def info(self):
        return self.headers

    def geturl(self):
        return self.url


def urlopen(url, data=None, timeout=30):
    req = url if isinstance(url, urllib.request.Request) else urllib.request.Request(url, data=data)
    if data is not None and isinstance(url, urllib.request.Request):
        req.data = data
    parts = urllib.parse.urlsplit(req.full_url)
    if parts.scheme != "http":
        return urllib.request.urlopen(req, timeout=timeout)
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    headers = {k: v for k, v in req.header_items()}
    body = req.data
    if body is not None and "Content-type" not in headers and "Content-Type" not in headers:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    conn = _conn(parts.hostname, parts.port or 80)
    for attempt in (0, 1):
        new = conn.fresh(timeout)
        try:
            # (connect and send: an error here means the request did not arrive, which urllib reports as URLError)
            conn.c.request(req.get_method(), path, body=body, headers=headers)
        except STALE as e:
            conn.close()
            if not new and attempt == 0:
                continue
            raise urllib.error.URLError(e)
        except (OSError, http.client.HTTPException) as e:
            conn.close()
            raise urllib.error.URLError(e)
        try:
            r = conn.c.getresponse()
            payload = r.read()
        except http.client.RemoteDisconnected:
            # (closed before any answer: on a kept connection the server had closed it before the request came; a
            # ConnectionResetError, as urllib raises it)
            conn.close()
            if not new and attempt == 0:
                continue
            raise
        except (OSError, http.client.HTTPException):
            conn.close()
            raise
        conn.used = time.time()
        if r.will_close:
            conn.close()
        if r.status >= 400:
            raise urllib.error.HTTPError(req.full_url, r.status, r.reason, r.headers, io.BytesIO(payload))
        return Response(payload, r.status, r.reason, r.headers, req.full_url)
