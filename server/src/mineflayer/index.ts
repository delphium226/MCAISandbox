/**
 * Agents in real Minecraft: connects agents as Mineflayer bots to the local Java server (set up in mc/, see
 * mc/setup.py) and serves the agent REST API, like the sandbox's, on its own port. Run with `npm run mc:agents`.
 *
 * Settings: MC_HOST (default 127.0.0.1), MC_PORT (25565), MC_VERSION (26.1, Mineflayer's name for the 26.1.x
 * protocol), MC_API_PORT (8766), MC_API_HOST (127.0.0.1; 0.0.0.0 serves the panel and API to the local network, with
 * no login: anyone who can reach it can spawn and command agents). The RCON port and password are read from mc/server/server.properties.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson } from '../api';
import { handleMcApi } from './mcApi';
import { applyWorldRules } from './mcRules';
import { MineflayerWorld } from './mcWorld';
import { Rcon } from './rcon';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SERVER_DIR = path.join(ROOT, 'mc', 'server');
const HOST = process.env.MC_HOST ?? '127.0.0.1';
const PORT = Number(process.env.MC_PORT ?? 25565);
const VERSION = process.env.MC_VERSION ?? '26.1';
const API_PORT = Number(process.env.MC_API_PORT ?? 8766);
const API_HOST = process.env.MC_API_HOST ?? '127.0.0.1';

function serverProperties(): Record<string, string> {
  const file = path.join(SERVER_DIR, 'server.properties');
  if (!fs.existsSync(file)) throw new Error(`${file} not found: run python mc/setup.py first`);
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && !line.startsWith('#')) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

const props = serverProperties();
if (props['enable-rcon'] !== 'true' || !props['rcon.password']) throw new Error('RCON is off in mc/server/server.properties (enable-rcon, rcon.password)');
const rcon = new Rcon(HOST, Number(props['rcon.port'] ?? 25575), props['rcon.password']);
const world = new MineflayerWorld(HOST, PORT, VERSION, rcon, SERVER_DIR);

// Peaceful, no damage: applied at every start (retried until the Minecraft server answers)
async function worldRules(attempt = 1): Promise<void> {
  try {
    world.worldRules = await applyWorldRules(rcon);
    console.log(`World settings: ${world.worldRules.summary}`);
  } catch (e) {
    world.worldRules = { ok: false, summary: `world settings not applied yet: ${(e as Error).message}`, problems: [(e as Error).message], checkedAt: Date.now() };
    if (attempt === 1) console.log(`World settings: RCON not answering (${(e as Error).message}); retrying every 10 s`);
    setTimeout(() => void worldRules(attempt + 1), 10_000);
  }
}
void worldRules();

// The brains and skill queues tick at the game's 20 Hz, like the sandbox's
setInterval(() => world.tick(), 50);

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    handleMcApi(world, req, res, url).catch((e: unknown) => sendJson(res, 500, { error: (e as Error).message }));
  })
  .listen(API_PORT, API_HOST, () => console.log(`MCAI agents for Minecraft ${VERSION} at ${HOST}:${PORT}; agent API on http://${API_HOST === '127.0.0.1' ? 'localhost' : API_HOST}:${API_PORT}/api`));

const shutdown = () => {
  for (const a of [...world.agents.values()]) world.remove(a.name);
  rcon.close();
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
