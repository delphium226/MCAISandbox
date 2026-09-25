import { C2S, S2C, BIN_CHUNK } from '../../../shared/src/protocol';

export type MessageHandler = (msg: S2C) => void;
export type ChunkHandler = (buf: ArrayBuffer) => void;

export class Connection {
  private ws: WebSocket | null = null;
  onMessage: MessageHandler = () => {};
  onChunk: ChunkHandler = () => {};
  onClose: (reason: string) => void = () => {};
  bytesIn = 0;
  private closedReason = '';

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      let opened = false;
      ws.onopen = () => {
        opened = true;
        resolve();
      };
      ws.onerror = () => {
        if (!opened) reject(new Error(`Could not connect to ${url}`));
      };
      ws.onclose = () => {
        this.onClose(this.closedReason || (opened ? 'Connection lost' : 'Could not connect'));
      };
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          this.bytesIn += e.data.length;
          const msg = JSON.parse(e.data) as S2C;
          if (msg.t === 'kick') this.closedReason = msg.reason;
          this.onMessage(msg);
        } else {
          const buf = e.data as ArrayBuffer;
          this.bytesIn += buf.byteLength;
          if (new Uint8Array(buf)[0] === BIN_CHUNK) this.onChunk(buf);
        }
      };
    });
  }

  send(msg: C2S) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.closedReason = 'Disconnected';
    this.ws?.close();
  }

  get open() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

/** Default server URL: same host (production) or the dev server port. */
export function defaultServerUrl(): string {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  if (loc.port === '5173' || loc.port === '4173') return `${proto}//${loc.hostname}:8765/ws`;
  return `${proto}//${loc.host}/ws`;
}
