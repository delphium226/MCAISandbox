/**
 * A small RCON client for the local Minecraft server: the adapter uses it for what bots cannot do themselves
 * (set game modes, teleport, op agents, run build commands). Commands run one at a time, in order.
 */
import net from 'node:net';

// How long a command's reply may take (E.1): one lost reply used to hold the single chain, and every agent behind it,
// for good. Long enough for the longest /fill.
const TIMEOUT_MS = Number(process.env.MC_RCON_TIMEOUT_MS ?? 15000) || 15000;

/** A command (or the connection) got no answer within MC_RCON_TIMEOUT_MS; whether the server ran it is unknown. */
export class RconTimeout extends Error {
  constructor(what: string) {
    super(`RCON gave no answer within ${TIMEOUT_MS} ms (${what}); the connection was reset`);
    this.name = 'RconTimeout';
  }
}

type Waiter = { ok: (body: string) => void; timer: NodeJS.Timeout };

export class Rcon {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private waiting = new Map<number, Waiter>();
  private chain: Promise<unknown> = Promise.resolve();
  // Measurement only (S.0): commands queued or running now, the most at once and each command's wait (queue and
  // reply, ms) since the last stats() call
  private queued = 0;
  private queueMax = 0;
  private latencies: number[] = [];
  // The same for /api/perf (E.1), over the last minute in 10 s buckets, untouched by stats(); and timeouts since start
  private recent: { at: number; peak: number; lat: number[] }[] = [];
  private timeouts = 0;
  /** A quietCommand read is running. */
  private quiet = false;

  constructor(private host: string, private port: number, private password: string) {}

  private async connect() {
    if (this.socket) return;
    const socket = net.createConnection({ host: this.host, port: this.port });
    await new Promise<void>((ok, fail) => {
      let done = false;
      // (decided after the loop's next poll, as a reply's timeout is: a connect made during a long stall is not lost)
      const timer = setTimeout(() => setImmediate(() => {
        if (done) return;
        done = true;
        this.timeouts++;
        console.log('[rcon] timeout connecting');
        socket.destroy();
        fail(new RconTimeout('connecting'));
      }), TIMEOUT_MS);
      socket.once('connect', () => {
        clearTimeout(timer);
        if (!done) (done = true), ok();
      });
      socket.once('error', (e) => {
        clearTimeout(timer);
        if (!done) (done = true), fail(e);
      });
    });
    // (a fresh connection starts with no partial packet left from one dropped mid-reply)
    this.buffer = Buffer.alloc(0);
    socket.on('data', (d: Buffer) => {
      if (this.socket === socket) this.onData(d);
    });
    socket.on('close', () => {
      // (a socket dropped after a timeout closes later, maybe once the next one is up: its waiters are not this one's)
      if (this.socket !== socket) return;
      this.socket = null;
      for (const w of this.waiting.values()) {
        clearTimeout(w.timer);
        w.ok('');
      }
      this.waiting.clear();
    });
    socket.on('error', () => socket.destroy());
    this.socket = socket;
    const id = await this.request(3, this.password, 'login');
    if (id === -1) throw new Error('RCON login failed: check rcon.password in mc/server/server.properties');
  }

  private onData(d: Buffer) {
    this.buffer = Buffer.concat([this.buffer, d]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readInt32LE(0);
      if (this.buffer.length < 4 + size) return;
      const id = this.buffer.readInt32LE(4);
      const body = this.buffer.subarray(12, 4 + size - 2).toString('utf8');
      this.buffer = this.buffer.subarray(4 + size);
      // A failed login answers with id -1
      const key = id === -1 ? [...this.waiting.keys()][0] : id;
      const w = key === undefined ? undefined : this.waiting.get(key);
      if (w) {
        this.waiting.delete(key!);
        clearTimeout(w.timer);
        w.ok(id === -1 ? '\u0000login failed' : body);
      }
    }
  }

  /** Send one packet; resolves with the reply body (or -1 for a failed login), rejects with RconTimeout. */
  private request(kind: number, body: string, label: string): Promise<number | string> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error('RCON is not connected'));
    const id = this.nextId++;
    const payload = Buffer.from(body, 'utf8');
    const packet = Buffer.alloc(14 + payload.length);
    packet.writeInt32LE(10 + payload.length, 0);
    packet.writeInt32LE(id, 4);
    packet.writeInt32LE(kind, 8);
    payload.copy(packet, 12);
    return new Promise((ok, fail) => {
      // Never '' on a timeout, as a closed socket answers: a `clear` read as 0 removed would be refunded or charged
      // again. The caller fails with the error; the socket goes, so a late reply cannot be taken for the next command's.
      // The timer decides only after the loop's next poll (setImmediate runs after it): after a long stall, timers run
      // before the socket is read, and a reply already there would have been taken for a timeout
      const timer = setTimeout(() => setImmediate(() => {
        if (!this.waiting.delete(id)) return;
        this.timeouts++;
        console.log(`[rcon] timeout ${label.replace(/\s+/g, ' ').slice(0, 80)}`);
        if (this.socket === socket) this.socket = null;
        socket.destroy();
        fail(new RconTimeout(label.slice(0, 80)));
      }), TIMEOUT_MS);
      this.waiting.set(id, { ok: (reply) => ok(reply === '\u0000login failed' ? -1 : reply), timer });
      socket.write(packet);
    });
  }

  private enqueue(cmd: string): Promise<string> {
    const run = this.chain.then(async () => {
      await this.connect();
      return String(await this.request(2, cmd, cmd));
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** The current 10 s bucket of the last minute's figures, old ones dropped. */
  private bucket(now: number) {
    const at = now - (now % 10_000);
    while (this.recent.length && this.recent[0].at <= now - 60_000) this.recent.shift();
    let b = this.recent[this.recent.length - 1];
    if (!b || b.at !== at) this.recent.push((b = { at, peak: this.queued, lat: [] }));
    return b;
  }

  /** Run a server command (without the leading slash) and return its output. */
  command(cmd: string): Promise<string> {
    const start = Date.now();
    this.queued++;
    this.queueMax = Math.max(this.queueMax, this.queued);
    const b = this.bucket(start);
    b.peak = Math.max(b.peak, this.queued);
    const run = this.enqueue(cmd);
    const done = () => {
      this.queued--;
      const ms = Date.now() - start;
      this.latencies.push(ms);
      this.bucket(Date.now()).lat.push(ms);
    };
    run.then(done, done);
    return run;
  }

  // Charging on the server (E.1's review): an answer lost to a timeout or a closed socket ('') says nothing about what a
  // `clear` or `give` did, and reading it as 0 removed gave items back that were never taken, or charged them twice. Such
  // a command is settled by counting the player's items once RCON answers again, against the count known before it (the
  // server runs commands in the order they reach it, so the lost one has run by then if it ever will).

  /** How many of an item a player carries (`clear NAME ITEM 0`); a lost answer is asked again twice, then thrown. */
  async count(player: string, item: string): Promise<number> {
    for (let i = 0; ; i++) {
      const r = await this.command(`clear ${player} ${item} 0`).catch((e) => {
        if (e instanceof RconTimeout && i < 2) return '';
        throw e;
      });
      const m = /Found (\d+)/i.exec(r);
      if (m) return Number(m[1]);
      if (/No items were found/i.test(r)) return 0;
      if (r || i >= 2) throw new Error(`the server did not count ${player}'s ${item} (${r.slice(0, 80) || 'no answer'})`);
    }
  }

  /**
   * Take n of an item from a player (`clear NAME ITEM n`) and return how many were removed. `before` is the count before
   * (counted first when not given); a lost answer is settled by counting. Throws only when the count fails too.
   */
  async take(player: string, item: string, n: number, before?: number): Promise<number> {
    before ??= await this.count(player, item);
    const r = await this.command(`clear ${player} ${item} ${n}`).catch((e) => {
      if (e instanceof RconTimeout) return '';
      throw e;
    });
    const m = /Removed (\d+)/i.exec(r);
    if (m) return Number(m[1]);
    // (any other answer is the server's own: nothing removed)
    if (r) return 0;
    const now = await this.count(player, item);
    const removed = Math.max(0, Math.min(n, before - now));
    console.log(`[rcon] settled a lost clear of ${n} ${item} from ${player}: ${before} before, ${now} now, ${removed} taken`);
    return removed;
  }

  /**
   * Give n of an item to a player (`give`), returning the answer. A lost answer is settled by counting against `before`
   * (counted first when not given): only what is still missing is given again, once.
   */
  async give(player: string, item: string, n: number, before?: number): Promise<string> {
    before ??= await this.count(player, item);
    const r = await this.command(`give ${player} ${item} ${n}`).catch((e) => {
      if (e instanceof RconTimeout) return '';
      throw e;
    });
    if (r) return r;
    const missing = Math.max(0, Math.min(n, before + n - (await this.count(player, item))));
    console.log(`[rcon] settled a lost give of ${n} ${item} to ${player}: ${missing} given again`);
    return missing ? this.command(`give ${player} ${item} ${missing}`) : `Gave ${n} ${item} to ${player}`;
  }

  /**
   * A read for a log line only (S.0): sent once no other command is queued or running (looked at every 200 ms, for up to
   * `waitMs`; '' if the queue never empties), one at a time, and left out of stats(), so it does not hold up the agents'
   * commands or change the figures they are measured by. A command sent while it runs still waits for its reply.
   */
  async quietCommand(cmd: string, waitMs = 60000): Promise<string> {
    const until = Date.now() + waitMs;
    while (this.queued > 0 || this.quiet) {
      if (Date.now() > until) return '';
      await new Promise((ok) => setTimeout(ok, 200));
    }
    this.quiet = true;
    try {
      return await this.enqueue(cmd);
    } finally {
      this.quiet = false;
    }
  }

  /** The queue's peak depth and the commands' p90/p99 wait since the last call; starts a new window. */
  stats(): { queueMax: number; p90: number; p99: number; commands: number } {
    const l = this.latencies.sort((p, q) => p - q);
    const pct = (f: number) => (l.length ? l[Math.min(l.length - 1, Math.ceil(f * l.length) - 1)] : 0);
    const out = { queueMax: this.queueMax, p90: pct(0.9), p99: pct(0.99), commands: l.length };
    this.latencies = [];
    this.queueMax = this.queued;
    return out;
  }

  /** For /api/perf (E.1): commands queued or running now, the peak and p90 wait over the last minute, timeouts so far. */
  peek(): { inFlight: number; peak: number; p90: number; timeouts: number } {
    const now = Date.now();
    this.bucket(now);
    const l = this.recent.flatMap((b) => b.lat).sort((p, q) => p - q);
    const p90 = l.length ? l[Math.min(l.length - 1, Math.ceil(0.9 * l.length) - 1)] : 0;
    return { inFlight: this.queued, peak: Math.max(this.queued, ...this.recent.map((b) => b.peak)), p90, timeouts: this.timeouts };
  }

  close() {
    this.socket?.end();
  }
}
