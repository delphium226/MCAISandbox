import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Game } from './game';
import { handlePanel } from './panel';

export async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

/** REST API; agent endpoints are added by the agent framework. */
export async function handleApi(game: Game, req: IncomingMessage, res: ServerResponse, url: URL) {
  try {
    if (url.pathname === '/api/status') {
      const tt = game.tickTimes;
      return sendJson(res, 200, {
        players: [...game.players].map((p) => ({ name: p.name, agent: p.isAgent, x: p.x, y: p.y, z: p.z })),
        entities: game.entities.size,
        chunks: game.world.chunks.size,
        time: game.time,
        mspt: tt.length ? tt.reduce((a, b) => a + b, 0) / tt.length : 0,
        seed: game.seed,
        profilePeakMs: Object.fromEntries(Object.entries(game.profilePeak).map(([k, v]) => [k, Math.round(v * 100) / 100])),
        profileMs: Object.fromEntries(Object.entries(game.profile).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      });
    }
    if (await handlePanel(game.agents, req, res, url)) return;
    const handled = await (game.agents as any).handleApi?.(req, res, url);
    if (handled) return;
    sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    sendJson(res, 500, { error: (e as Error).message });
  }
}
