/**
 * The agent control panel: a web page (server/panel/index.html) served at /panel by the sandbox and the Minecraft
 * agent server, and the data behind it. Everything here uses the world interface, so the page works for either world.
 *
 *   GET /panel          the page
 *   GET /api/overview   every agent (body, brain state, plan, task, recent events, stats) and their villages
 *   GET /api/models     the models Ollama has loaded (name, VRAM)
 *   GET /api/maps       a top-down map around every agent (?radius=, default 24)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorldAdapter, WorldAgent } from './world';
import { sendJson } from './api';
import { OLLAMA_ROUTES } from './tieredBrain';
import { elevations } from './designs';
import type { Design } from './village';

/** A design's elevations, or nothing for a malformed one (villages.json is read unchecked; one must not break the panel). */
function safeElevations(d: Design): string {
  try {
    return elevations(d);
  } catch {
    return '';
  }
}

const PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../panel/index.html');
const OLLAMA_URL = process.env.MC_OLLAMA_URL ?? 'http://localhost:11434';
/** Event types too frequent to be worth showing. */
const NOISE = new Set(['broke', 'pickup']);
const mapCache = new Map<string, { at: number; radius: number; map: unknown }>();

function agentOverview(a: WorldAgent) {
  const o = a.observe(4);
  const m = a.memory;
  const v = a.village();
  const plan = m.plan as { goal?: string; steps?: string[]; step?: number; by?: string; taskId?: string } | undefined;
  const task = v && plan?.taskId ? v.tasks.find((t) => t.id === plan.taskId) : undefined;
  const inv = Object.entries(o.inventory).sort((x, y) => y[1] - x[1]);
  return {
    name: a.name,
    role: a.role,
    gamemode: a.gamemode,
    brain: a.brain?.name ?? null,
    status: a.brain?.status?.(a) ?? null,
    position: o.position,
    biome: o.biome,
    health: o.health,
    food: o.food,
    dead: o.dead,
    holding: o.holding,
    inventory: inv.slice(0, 16),
    inventoryKinds: inv.length,
    currentAction: o.currentAction,
    queued: o.queuedActions,
    objective: typeof m.objective === 'string' ? m.objective : null,
    plan: plan ?? null,
    task: task ?? null,
    village: v?.name ?? null,
    villageRole: typeof m.villageRole === 'string' ? m.villageRole : null,
    notes: typeof m.notes === 'string' ? m.notes : null,
    stats: m.stats ?? null,
    rescues: m.rescues ?? null,
    buildSpeed: m.buildSpeed ?? null,
    events: a.events.filter((e) => !NOISE.has(e.type)).slice(-30),
    nearby: o.nearbyEntities.slice(0, 25).map((e) => ({ kind: e.kind, name: e.name, x: e.x, z: e.z })),
    yaw: o.yaw,
  };
}

export function overview(w: WorldAdapter) {
  const agents = w.agentList();
  const names = new Set(agents.map((a) => a.village()?.name).filter((n): n is string => !!n));
  // Each design with its elevations as text (D.3: what the architect is shown)
  const villages = [...w.villages.villages.values()].filter((v) => names.has(v.name))
    .map((v) => ({ ...v, designs: Object.fromEntries(Object.entries(v.designs).map(([k, d]) => [k, { ...d, elevations: safeElevations(d) }])) }));
  return { world: { kind: w.kind, ticks: w.ticks, time: Date.now() }, agents: agents.map(agentOverview), villages };
}

/** The models loaded in every Ollama instance in use (the main one and any in MC_OLLAMA_ROUTES). */
async function loadedModels() {
  const urls = [...new Set([OLLAMA_URL, ...OLLAMA_ROUTES.values()])];
  const models: Array<{ name: string; server: string; sizeMB: number; vramMB: number; expires: string }> = [];
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(`${url}/api/ps`, { signal: AbortSignal.timeout(3000) });
      const data = (await res.json()) as { models?: Array<{ name: string; size: number; size_vram: number; expires_at: string }> };
      const server = new URL(url).port || url;
      for (const x of data.models ?? []) models.push({ name: x.name, server, sizeMB: Math.round(x.size / 2 ** 20), vramMB: Math.round(x.size_vram / 2 ** 20), expires: x.expires_at });
    } catch (e) {
      errors.push(`Ollama is not answering at ${url} (${(e as Error).message})`);
    }
  }
  return { ok: errors.length < urls.length, error: errors.join('; ') || undefined, models };
}

/** Serve the panel routes; returns false for anything else. */
export async function handlePanel(w: WorldAdapter, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method !== 'GET') return false;
  if (url.pathname === '/panel' || url.pathname === '/panel/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(PAGE, 'utf8'));
    return true;
  }
  if (url.pathname === '/api/overview') return sendJson(res, 200, overview(w)), true;
  if (url.pathname === '/api/models') return sendJson(res, 200, await loadedModels()), true;
  if (url.pathname === '/api/maps') {
    const radius = Math.max(8, Math.min(40, Number(url.searchParams.get('radius') ?? 24) || 24));
    const maps: Record<string, unknown> = {};
    const now = Date.now();
    for (const a of w.agentList()) {
      if (!a.mapAround) continue;
      // Maps are costly (every column scanned) and run in the agents' process: share one per agent for 1.5 s
      const c = mapCache.get(a.name);
      if (c && c.radius === radius && now - c.at < 1500) maps[a.name] = c.map;
      else mapCache.set(a.name, { at: now, radius, map: (maps[a.name] = a.mapAround(radius)) });
    }
    return sendJson(res, 200, maps), true;
  }
  return false;
}
