/**
 * The agent control panel: a web page (server/panel/index.html) served at /panel by the sandbox and the Minecraft
 * agent server, and the data behind it. Everything here uses the world interface, so the page works for either world.
 *
 *   GET /panel          the page
 *   GET /api/overview   every agent (body, brain state, plan, task, recent events, stats), their villages, token usage
 *                       (?agents=A,B: only those agents and their villages; ?designs=<etag>: the villages' designs are
 *                       left out while `designsEtag` still matches the page's copy)
 *   GET /api/agents/:name/calls  the agent's last planner and executor calls in full (prompt and reply); the overview
 *                       carries only their time, length and tokens
 *   GET /api/models     the models Ollama has loaded (name, VRAM, cloud)
 *   GET /api/maps       a top-down map around every agent (?radius=, default 24; ?agents=A,B: only those)
 *   GET /api/usage      model calls, tokens and cost by model, agent and kind (?since=<epoch ms>&agents=A,B), the spend
 *                       ledger's month and programme, and the call gate's waits (`gate`)
 *   POST /api/usage/budget  {tokensPerHour: number|null, windowMs?}: set the hourly cloud token budget (tests)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorldAdapter, WorldAgent } from './world';
import { readJson, sendJson } from './api';
import { OLLAMA_ROUTES, gate } from './modelCall';
import { usage, isCloudModel } from './modelUsage';
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
/** Events per agent in the overview (30 made it ~4-6 KB an agent; the page shows 15). */
const OVERVIEW_EVENTS = 15;

/** The last /api/overview: how long building and serialising it took, its size, and when (E.1: read by /api/perf). */
export const overviewStats = { ms: 0, bytes: 0, at: 0 };

/** A model call as the overview carries it: when, how long and the tokens; the prompt and reply are at /calls. */
function callSummary(c: unknown) {
  if (!c || typeof c !== 'object') return c ?? null;
  const { at, ms, model, think, promptTokens, outputTokens } = c as Record<string, unknown>;
  return { at, ms, model, think, promptTokens, outputTokens };
}

/** FNV-1a over a string, as 8 hex digits (the designs' etag). */
function fnv(s: string, h = 0x811c9dc5): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
/** Elevations by design content, so an unchanged design is never drawn again (~4 KB a design, every 2 s before). */
const elevationCache = new Map<string, string>();
function cachedElevations(d: Design, key: string): string {
  let e = elevationCache.get(key);
  if (e === undefined) {
    if (elevationCache.size > 500) elevationCache.clear();
    elevationCache.set(key, (e = safeElevations(d)));
  }
  return e;
}

function agentOverview(a: WorldAgent) {
  const o = a.observe(4);
  const m = a.memory;
  const v = a.village();
  const plan = m.plan as { goal?: string; steps?: string[]; step?: number; by?: string; taskId?: string } | undefined;
  const task = v && plan?.taskId ? v.tasks.find((t) => t.id === plan.taskId) : undefined;
  const inv = Object.entries(o.inventory).sort((x, y) => y[1] - x[1]);
  const st = a.brain?.status?.(a) ?? null;
  // (the full calls were ~15-30 KB an agent every 2 s: the page fetches them only while their tab is open)
  const status = st && ('lastPlannerCall' in st || 'lastExecutorCall' in st)
    ? { ...st, lastPlannerCall: callSummary(st.lastPlannerCall), lastExecutorCall: callSummary(st.lastExecutorCall) } : st;
  return {
    name: a.name,
    role: a.role,
    gamemode: a.gamemode,
    brain: a.brain?.name ?? null,
    status,
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
    events: a.events.filter((e) => !NOISE.has(e.type)).slice(-OVERVIEW_EVENTS),
    nearby: o.nearbyEntities.slice(0, 25).map((e) => ({ kind: e.kind, name: e.name, x: e.x, z: e.z })),
    yaw: o.yaw,
  };
}

/**
 * Every agent (or those named in `opts.agents`) and their villages. Each design comes with its elevations as text (D.3:
 * what the architect is shown), unless `opts.designs` is the etag of the designs as they stand: then the villages carry
 * no `designs` and the page keeps its copy.
 */
export function overview(w: WorldAdapter, opts: { agents?: Set<string>; designs?: string } = {}) {
  const agents = w.agentList().filter((a) => !opts.agents || opts.agents.has(a.name));
  const names = new Set(agents.map((a) => a.village()?.name).filter((n): n is string => !!n));
  const vs = [...w.villages.villages.values()].filter((v) => names.has(v.name));
  // (the etag covers the villages' names too, so a village joining or leaving the set sends the designs again)
  let h = 0x811c9dc5;
  const keyed = vs.map((v) => {
    h = fnv(`\u0000${v.name}`, h);
    return Object.entries(v.designs).map(([k, d]) => {
      const key = `${k}:${fnv(JSON.stringify(d)).toString(16)}`;
      h = fnv(key, h);
      return [k, d, key] as const;
    });
  });
  const designsEtag = h.toString(16);
  const send = opts.designs !== designsEtag;
  const villages = vs.map((v, i) => {
    const { designs, ...rest } = v;
    return send ? { ...rest, designs: Object.fromEntries(keyed[i].map(([k, d, key]) => [k, { ...d, elevations: cachedElevations(d, key) }])) } : rest;
  });
  return { world: { kind: w.kind, ticks: w.ticks, time: Date.now() }, agents: agents.map(agentOverview), villages, designsEtag, usage: usage.summary() };
}

/** `?agents=A,B` as a set of names, or undefined for every agent. */
function agentsParam(url: URL): Set<string> | undefined {
  const names = url.searchParams.get('agents')?.split(',').map((s) => s.trim()).filter(Boolean);
  return names?.length ? new Set(names) : undefined;
}

/** The models loaded in every Ollama instance in use (the main one and any in MC_OLLAMA_ROUTES). */
async function loadedModels() {
  const urls = [...new Set([OLLAMA_URL, ...OLLAMA_ROUTES.values()])];
  const models: Array<{ name: string; server: string; sizeMB: number; vramMB: number; expires: string; cloud: boolean }> = [];
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(`${url}/api/ps`, { signal: AbortSignal.timeout(3000) });
      const data = (await res.json()) as { models?: Array<{ name: string; size: number; size_vram: number; expires_at: string }> };
      const server = new URL(url).port || url;
      // A cloud model is listed with no VRAM: flag it so the page does not read it as spilled to the CPU
      for (const x of data.models ?? []) {
        const cloud = isCloudModel(x.name) || (x.size_vram === 0 && /cloud/.test(x.name));
        models.push({ name: x.name, server, sizeMB: Math.round(x.size / 2 ** 20), vramMB: Math.round(x.size_vram / 2 ** 20), expires: x.expires_at, cloud });
      }
    } catch (e) {
      errors.push(`Ollama is not answering at ${url} (${(e as Error).message})`);
    }
  }
  return { ok: errors.length < urls.length, error: errors.join('; ') || undefined, models };
}

/** Serve the panel routes; returns false for anything else. */
export async function handlePanel(w: WorldAdapter, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === 'POST' && url.pathname === '/api/usage/budget') {
    const b = await readJson(req).catch(() => null); // bad JSON is answered below as a bad value
    const n = b?.tokensPerHour === null ? null : Number(b?.tokensPerHour);
    if (n !== null && !(n >= 0)) return sendJson(res, 400, { error: 'tokensPerHour: a number >= 0 or null' }), true;
    usage.setBudget(n === 0 ? null : n, b?.windowMs ? Number(b.windowMs) : undefined);
    return sendJson(res, 200, usage.summary().budget), true;
  }
  if (req.method !== 'GET') return false;
  if (url.pathname === '/panel' || url.pathname === '/panel/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(PAGE, 'utf8'));
    return true;
  }
  if (url.pathname === '/api/overview') {
    // Compact JSON (sendJson indents: ~30% more bytes every 2 s), measured for /api/perf
    const t0 = performance.now();
    const body = JSON.stringify(overview(w, { agents: agentsParam(url), designs: url.searchParams.get('designs') ?? undefined }));
    Object.assign(overviewStats, { ms: Math.round((performance.now() - t0) * 10) / 10, bytes: Buffer.byteLength(body), at: Date.now() });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return true;
  }
  // The full last calls of one agent, for the panel's "what the executor / planner saw" tabs
  const calls = /^\/api\/agents\/([^/]+)\/calls$/.exec(url.pathname);
  if (calls) {
    const name = decodeURIComponent(calls[1]);
    const a = w.agentList().find((x) => x.name === name);
    if (!a) return sendJson(res, 404, { error: `no agent called ${name}` }), true;
    const st = a.brain?.status?.(a);
    return sendJson(res, 200, { name, planner: st?.lastPlannerCall ?? null, executor: st?.lastExecutorCall ?? null }), true;
  }
  if (url.pathname === '/api/models') return sendJson(res, 200, await loadedModels()), true;
  if (url.pathname === '/api/maps') {
    const radius = Math.max(8, Math.min(40, Number(url.searchParams.get('radius') ?? 24) || 24));
    const only = agentsParam(url);
    const maps: Record<string, unknown> = {};
    const now = Date.now();
    for (const a of w.agentList()) {
      // (only the cards with their map open: ~2 ms and ~45 KB a map)
      if (!a.mapAround || (only && !only.has(a.name))) continue;
      // Maps are costly (every column scanned) and run in the agents' process: share one per agent for 1.5 s
      const c = mapCache.get(a.name);
      if (c && c.radius === radius && now - c.at < 1500) maps[a.name] = c.map;
      else mapCache.set(a.name, { at: now, radius, map: (maps[a.name] = a.mapAround(radius)) });
    }
    return sendJson(res, 200, maps), true;
  }
  if (url.pathname === '/api/usage') {
    const since = Number(url.searchParams.get('since')) || undefined;
    const agents = url.searchParams.get('agents')?.split(',').map((s) => s.trim()).filter(Boolean);
    // (with the call gate's waits per class and its peaks per key since start, E.0)
    return sendJson(res, 200, { ...usage.report({ since, agents }), gate: gate.stats() }), true;
  }
  return false;
}
