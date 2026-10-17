/**
 * Agents in real Minecraft: connects agents as Mineflayer bots to the local Java server (set up in mc/, see
 * mc/setup.py) and serves the agent REST API, like the sandbox's, on its own port. Run with `npm run mc:agents`.
 *
 * Settings: MC_HOST (default 127.0.0.1), MC_PORT (25565), MC_VERSION (26.1, Mineflayer's name for the 26.1.x
 * protocol), MC_API_PORT (8766), MC_API_HOST (127.0.0.1; 0.0.0.0 serves the panel and API to the local network, with
 * no login: anyone who can reach it can spawn and command agents), MC_SERVER_DIR (mc/server; the test world is
 * mc/testserver), MC_TIME_SCALE (1; 2 runs the server and the bots at 2x for tests, mcRules.ts), MC_RANDOM_TICK (3, the
 * random tick speed; staged tests raise it so crops grow faster, mcRules.ts). The RCON port and
 * password are read from the server folder's server.properties.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson } from '../api';
import { handleMcApi, recordTick } from './mcApi';
import { applyWorldRules } from './mcRules';
import { MineflayerWorld } from './mcWorld';
import { Rcon } from './rcon';
import { gate } from '../modelCall';
import { monthKey, usage } from '../modelUsage';

// (MCAI_ROOT: the repo, when this runs from a code snapshot elsewhere, scripts/snapshot_code.py)
const ROOT = process.env.MCAI_ROOT ? path.resolve(process.env.MCAI_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// The Minecraft server's folder: its server.properties (RCON) and this world's villages.json and atlas.json
const SERVER_DIR = path.resolve(ROOT, process.env.MC_SERVER_DIR ?? path.join('mc', 'server'));
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
if (props['enable-rcon'] !== 'true' || !props['rcon.password']) throw new Error(`RCON is off in ${path.join(SERVER_DIR, 'server.properties')} (enable-rcon, rcon.password)`);
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

// The brains and skill queues tick at the game's 20 Hz, like the sandbox's (each tick timed for /api/perf, E.1)
setInterval(() => {
  const t0 = performance.now();
  try {
    world.tick();
  } finally {
    recordTick(performance.now() - t0);
  }
}, 50);

// A blocked event loop lets every bot miss the server's keep-alive (Accept4: all three timed out at once, and nothing
// in this log said why): report each stall of over 2 s, with what every agent was running when it ended
let lastBeat = Date.now();
setInterval(() => {
  const now = Date.now(), late = now - lastBeat - 1000;
  lastBeat = now;
  if (late <= 2000) return;
  // (at most 25 agents, 40 characters each: the whole line stays readable at 25)
  const agents = world.agentList();
  const doing = agents.slice(0, 25).map((a) => `${a.name}: ${a.current ? `${a.current.status.type} ${JSON.stringify(a.current.status.args)}` : 'idle'}`.slice(0, 40)).join('; ')
    + (agents.length > 25 ? `; and ${agents.length - 25} more` : '');
  console.log(`[lag] ${new Date(now).toISOString().slice(11, 19)} event loop blocked for ~${late} ms; ${doing || 'no agents'}`);
}, 1000);

// RCON's queue and wait every 30 s (S.0: building, crafting and charging all go through its one connection); quiet
// when no command ran
setInterval(() => {
  const s = rcon.stats();
  if (s.commands) console.log(`[rcon] queue max ${s.queueMax}, p90 ${s.p90} ms, p99 ${s.p99} ms, ${s.commands} commands`);
}, 30_000);

// The model call gate's waits per call class every 60 s (E.0); quiet when no call came to it
setInterval(() => {
  const line = gate.line();
  if (line) console.log(`[gate] ${line}`);
}, 60_000);

// The spend ledger (E.0): one line per model call in runs/spend/<date>-<api port>.jsonl (one file per process and day, so
// the test world's server never writes into the main one's), kept across restarts; the month's and the programme's
// totals are read back from every process's files at start and every 5 minutes (MC_SPEND_CAP_USD is checked on them)
const SPEND_DIR = path.join(ROOT, 'runs', 'spend');
const day = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
usage.setSink((r, usd) => {
  fs.mkdirSync(SPEND_DIR, { recursive: true });
  // (appended at once: a total read later counts every call before its start, and this process adds its own since)
  fs.appendFileSync(path.join(SPEND_DIR, `${day(r.at)}-${API_PORT}.jsonl`), `${JSON.stringify({ at: r.at, model: r.model, agent: r.agent, kind: r.kind, in: r.promptTokens, out: r.outputTokens, usd: Number(usd.toFixed(6)), outcome: r.outcome, run: process.env.MCAI_RUN ?? null })}\n`);
});
const PROGRAMME_START = process.env.MC_SPEND_PROGRAMME_START ? Date.parse(process.env.MC_SPEND_PROGRAMME_START) || 0 : 0;
async function seedSpend() {
  const cutoff = Date.now(), key = monthKey(cutoff);
  let month = 0, programme = 0;
  try {
    // (files by name: only days the month or the programme can hold)
    const from = day(Math.min(new Date(new Date(cutoff).getFullYear(), new Date(cutoff).getMonth(), 1).getTime(), PROGRAMME_START || 0));
    for (const f of (await fs.promises.readdir(SPEND_DIR).catch(() => [] as string[])).filter((n) => /^\d{4}-\d\d-\d\d-.*\.jsonl$/.test(n) && n.slice(0, 10) >= from)) {
      for (const line of (await fs.promises.readFile(path.join(SPEND_DIR, f), 'utf8')).split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as { at?: number; usd?: number };
          if (typeof r.at !== 'number' || typeof r.usd !== 'number' || r.at >= cutoff) continue;
          if (monthKey(r.at) === key) month += r.usd;
          if (r.at >= PROGRAMME_START) programme += r.usd;
        } catch { /* a torn line from a kill */ }
      }
    }
    usage.seedSpend({ cutoff, monthKey: key, month, programme });
  } catch (e) {
    console.log(`[usage] the spend ledger could not be read: ${(e as Error).message}`);
  }
}
void seedSpend();
setInterval(() => void seedSpend(), 5 * 60_000);

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    handleMcApi(world, req, res, url).catch((e: unknown) => sendJson(res, 500, { error: (e as Error).message }));
  })
  .listen(API_PORT, API_HOST, () => console.log(`MCAI agents for Minecraft ${VERSION} at ${HOST}:${PORT}; agent API on http://${API_HOST === '127.0.0.1' ? 'localhost' : API_HOST}:${API_PORT}/api`));

const shutdown = () => {
  for (const a of [...world.agents.values()]) world.remove(a.name);
  world.atlas.save();
  // (villages.json's saves are debounced, E.0: written now, and again at exit for anything changed in the last half second)
  world.villages.flushSync();
  rcon.close();
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// An exception nobody caught (a library's own tick: mineflayer-pathfinder's placement read an undefined block after a door,
// F153a, and took every bot down, X2q, s34): logged and survived, unless they come fast (more than 10 in a minute: a
// state that keeps throwing is not run on; the villages are flushed on the way out)
const crashes: number[] = [];
process.on('uncaughtException', (e) => {
  const now = Date.now();
  crashes.push(now);
  while (crashes.length && now - crashes[0] > 60000) crashes.shift();
  console.error(`[crash-guard] uncaught exception (${crashes.length} in the last minute):`, e);
  if (crashes.length > 10) {
    console.error('[crash-guard] too many in a minute: exiting');
    process.exit(1);
  }
});
process.on('exit', () => world.villages.flushSync());
