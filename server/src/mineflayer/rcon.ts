/**
 * A small RCON client for the local Minecraft server: the adapter uses it for what bots cannot do themselves
 * (set game modes, teleport, op agents, run build commands). Commands run one at a time, in order.
 */
import net from 'node:net';

export class Rcon {
  private socket: net.Socket | null = null;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private waiting = new Map<number, (body: string) => void>();
  private chain: Promise<unknown> = Promise.resolve();
  // Measurement only (S.0): commands queued or running now, the most at once and each command's wait (queue and
  // reply, ms) since the last stats() call
  private queued = 0;
  private queueMax = 0;
  private latencies: number[] = [];
  /** A quietCommand read is running. */
  private quiet = false;

  constructor(private host: string, private port: number, private password: string) {}

  private async connect() {
    if (this.socket) return;
    const socket = net.createConnection({ host: this.host, port: this.port });
    await new Promise<void>((ok, fail) => {
      socket.once('connect', ok);
      socket.once('error', fail);
    });
    socket.on('data', (d: Buffer) => this.onData(d));
    socket.on('close', () => {
      this.socket = null;
      for (const w of this.waiting.values()) w('');
      this.waiting.clear();
    });
    socket.on('error', () => socket.destroy());
    this.socket = socket;
    const id = await this.request(3, this.password);
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
      const w = this.waiting.get(id) ?? (id === -1 ? [...this.waiting.values()][0] : undefined);
      if (w) {
        this.waiting.delete(id === -1 ? [...this.waiting.keys()][0] : id);
        w(id === -1 ? '\u0000login failed' : body);
      }
    }
  }

  /** Send one packet; resolves with the reply body (or -1 for a failed login). */
  private request(kind: number, body: string): Promise<number | string> {
    const id = this.nextId++;
    const payload = Buffer.from(body, 'utf8');
    const packet = Buffer.alloc(14 + payload.length);
    packet.writeInt32LE(10 + payload.length, 0);
    packet.writeInt32LE(id, 4);
    packet.writeInt32LE(kind, 8);
    payload.copy(packet, 12);
    return new Promise((ok) => {
      this.waiting.set(id, (reply) => ok(reply === '\u0000login failed' ? -1 : reply));
      this.socket!.write(packet);
    });
  }

  private enqueue(cmd: string): Promise<string> {
    const run = this.chain.then(async () => {
      await this.connect();
      return String(await this.request(2, cmd));
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Run a server command (without the leading slash) and return its output. */
  command(cmd: string): Promise<string> {
    const start = Date.now();
    this.queued++;
    this.queueMax = Math.max(this.queueMax, this.queued);
    const run = this.enqueue(cmd);
    const done = () => {
      this.queued--;
      this.latencies.push(Date.now() - start);
    };
    run.then(done, done);
    return run;
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

  close() {
    this.socket?.end();
  }
}
