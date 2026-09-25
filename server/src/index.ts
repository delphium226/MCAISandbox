import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { Game } from './game';
import { Player, Connection } from './player';
import { AgentManager } from './agents';
import { C2S, S2C } from '../../shared/src/protocol';
import { DEFAULT_PORT, PROTOCOL_VERSION } from '../../shared/src/constants';
import { hashString } from '../../shared/src/noise';
import { handleApi } from './api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const env = process.env[`MC_${name.toUpperCase().replace(/-/g, '_')}`];
  return env ?? def;
}

const port = parseInt(arg('port', String(DEFAULT_PORT)), 10);
const worldName = arg('world', 'world');
const seedArg = arg('seed', '');
const seed = seedArg ? (/^-?\d+$/.test(seedArg) ? parseInt(seedArg, 10) : hashString(seedArg)) : (Math.random() * 2 ** 31) | 0;

const game = new Game({
  seed,
  dir: path.join(ROOT, 'server', 'worlds', worldName),
  viewDistance: parseInt(arg('view-distance', '10'), 10),
  pvp: arg('pvp', 'true') === 'true',
  motd: 'Welcome to MCAI Sandbox! Type /help for commands.',
});
game.agents = new AgentManager(game);
game.start();

// ---- HTTP: static client + agent API ----
const DIST = path.join(ROOT, 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  if (url.pathname.startsWith('/api/')) return handleApi(game, req, res, url);
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    if (!fs.existsSync(path.join(DIST, 'index.html'))) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('MCAI Sandbox server is running. Build the client with `npm run build` or use `npm run dev` (Vite on :5173).');
    }
    file = path.join(DIST, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: { threshold: 1024 } });
wss.on('connection', (ws: WebSocket) => {
  let player: Player | null = null;
  const conn: Connection = {
    isAgent: false,
    send(msg: S2C) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    sendBinary(data: Uint8Array) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close(reason?: string) {
      if (reason) conn.send({ t: 'kick', reason });
      ws.close();
    },
    bufferedAmount: () => ws.bufferedAmount,
  };
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg: C2S;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!player) {
      if (msg.t !== 'hello') return;
      if (msg.version !== PROTOCOL_VERSION) return conn.close('Protocol version mismatch — refresh the page');
      const name = String(msg.name || 'Player').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16) || 'Player';
      player = game.join(conn, name, msg.skin);
      console.log(`${name} joined (${game.players.size} online)`);
      return;
    }
    try {
      player.handle(msg);
    } catch (e) {
      console.error('Error handling', msg.t, e);
    }
  });
  ws.on('close', () => {
    if (player) {
      console.log(`${player.name} left`);
      game.leave(player);
    }
  });
  ws.on('error', () => {});
});

server.listen(port, () => {
  console.log(`MCAI Sandbox server listening on http://localhost:${port} (ws: /ws) seed=${game.seed} world=${worldName}`);
});

const shutdown = () => {
  console.log('Saving world...');
  game.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
