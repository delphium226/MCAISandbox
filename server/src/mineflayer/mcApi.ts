/**
 * The agent REST API for real Minecraft, with the sandbox's routes and JSON shapes (README "Agent API"), so the same
 * controllers and test scripts (scripts/watch_*.py) work against either world.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Vec3 } from 'vec3';
import { readJson, sendJson } from '../api';
import { validateDesign } from '../designs';
import { TOOLS } from '../skills';
import { handlePanel } from '../panel';
import { describePlan, designBill, inWood, type Counts } from './mcMaterials';
import { registerChest } from './mcStorage';
import { postLayout } from '../layout';
import { villageHome } from '../village';
import type { MineflayerWorld } from './mcWorld';

export async function handleMcApi(w: MineflayerWorld, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (await handlePanel(w, req, res, url)) return;
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'agents', name, ...]
  if (parts[0] !== 'api') return sendJson(res, 404, { error: 'Not found' });

  // Watch an agent from the real client: spectator mode, then teleport to it
  if (parts[1] === 'watch' && req.method === 'POST') {
    const body = await readJson(req);
    const player = String(body.player ?? '').replace(/[^a-zA-Z0-9_]/g, '');
    const agent = w.get(String(body.agent ?? ''));
    if (!player || !agent) return sendJson(res, 400, { error: 'player and agent (the name of a running agent) are required' });
    const out = [await w.rcon.command(`gamemode spectator ${player}`), await w.rcon.command(`tp ${player} ${agent.name}`)];
    return sendJson(res, /No player was found/i.test(out.join(' ')) ? 404 : 200, { result: out });
  }

  if (parts[1] === 'status') {
    return sendJson(res, 200, { world: 'minecraft', version: w.version, server: `${w.host}:${w.port}`, ticks: w.ticks, worldRules: w.worldRules, agents: [...w.agents.values()].map((a) => a.name) });
  }
  // The shared atlas: chunk summaries around a village's home, a point or the first agent (?village= | ?x=&z=, radius=)
  if (parts[1] === 'atlas') {
    const radius = Math.min(400, Math.max(16, Number(url.searchParams.get('radius') ?? 200) || 200));
    const v = url.searchParams.get('village') ? w.villages.get(url.searchParams.get('village')!) : undefined;
    const members = v ? w.agentList().filter((a) => a.memory.village === v.name) : w.agentList();
    const pos = (a: (typeof members)[number]) => a.bot.entity?.position;
    let centre: { x: number; z: number } | null = v ? villageHome(v, members.find((a) => a.memory.origin)?.memory) : null;
    const qx = Number(url.searchParams.get('x')), qz = Number(url.searchParams.get('z'));
    if (!centre && url.searchParams.has('x') && Number.isFinite(qx) && Number.isFinite(qz)) centre = { x: Math.floor(qx), z: Math.floor(qz) };
    const p = members.map(pos).find(Boolean);
    if (!centre && p) centre = { x: Math.floor(p.x), z: Math.floor(p.z) };
    return sendJson(res, 200, { status: w.atlas.status(), centre, radius, chunks: centre ? w.atlas.near(centre.x, centre.z, radius) : [] });
  }
  if (parts[1] === 'skills') return sendJson(res, 200, Object.fromEntries(TOOLS.filter((t) => w.skills.includes(t)).map((t) => [t.name, t.description])));

  if (parts[1] === 'village') {
    if (req.method === 'POST' && !parts[2]) {
      const body = await readJson(req);
      const name = String(body.name ?? '').trim();
      if (!name) return sendJson(res, 400, { error: 'name is required' });
      return sendJson(res, 200, w.villages.ensure(name, typeof body.objective === 'string' ? body.objective : ''));
    }
    if (!parts[2]) return sendJson(res, 200, [...w.villages.villages.values()]);
    const v = w.villages.get(decodeURIComponent(parts[2]));
    if (v && parts[3] === 'designs' && req.method === 'POST') {
      const { design, errors, fixes } = validateDesign(await readJson(req), 'api', { isPlaceable: (b) => w.isPlaceable(b) });
      if (!design) return sendJson(res, 400, { errors });
      v.designs[design.name] = design;
      w.villages.note(v, `design "${design.name}" added through the API`);
      return sendJson(res, 200, { ok: true, name: design.name, fixes });
    }
    // Lay buildings out and post their tasks, as the mayor's plan_layout does (tests): {buildings, x, y, z, size?, wood?, economy?}
    if (v && parts[3] === 'layout' && req.method === 'POST') {
      const b = await readJson(req);
      const site = { x: Math.floor(Number(b.x)), y: Math.floor(Number(b.y ?? 64)), z: Math.floor(Number(b.z)), size: b.size !== undefined ? Number(b.size) : undefined, wood: typeof b.wood === 'string' && b.wood ? b.wood : undefined, woodLogs: Number(b.woodLogs) || undefined };
      if (!Number.isFinite(site.x) || !Number.isFinite(site.z)) return sendJson(res, 400, { error: 'x and z (the site centre) are required' });
      const result = postLayout(w, v, String(b.by ?? 'api'), site, b.buildings, b.economy !== false);
      return sendJson(res, result.startsWith('plan_layout:') ? 400 : 200, { result, tasks: v.tasks });
    }
    // Set a task's status (tests skipping a stage): {status: "done" | "open" | "failed"}
    if (v && parts[3] === 'tasks' && parts[4] && req.method === 'POST') {
      const t = v.tasks.find((x) => x.id === parts[4]);
      const status = String((await readJson(req)).status ?? '');
      if (!t || !['open', 'done', 'failed'].includes(status)) return sendJson(res, 400, { error: 'unknown task or status (open, done, failed)' });
      t.status = status as typeof t.status;
      if (status === 'open') t.claimedBy = undefined;
      t.updated = Date.now();
      w.villages.save();
      return sendJson(res, 200, t);
    }
    // Register a chest already in the world as village storage (tests): {x, y, z}
    if (v && parts[3] === 'storage' && req.method === 'POST') {
      const b = await readJson(req);
      const pos = { x: Math.floor(Number(b.x)), y: Math.floor(Number(b.y)), z: Math.floor(Number(b.z)) };
      if (![pos.x, pos.y, pos.z].every(Number.isFinite)) return sendJson(res, 400, { error: 'x, y and z are required' });
      const block = (await w.rcon.command(`execute if block ${pos.x} ${pos.y} ${pos.z} chest`)).trim();
      if (!/passed/i.test(block)) return sendJson(res, 400, { error: `no chest at ${pos.x},${pos.y},${pos.z} (${block})` });
      return sendJson(res, 200, { result: registerChest({ name: 'api' }, v, pos, w.villages), storage: v.storage });
    }
    // What a design needs and what getting it takes
    if (v && parts[3] === 'designs' && parts[5] === 'bill') {
      const d = v.designs[decodeURIComponent(parts[4] ?? '')];
      if (!d) return sendJson(res, 404, { error: `no design "${parts[4]}" in ${v.name}: ${Object.keys(v.designs).join(', ') || 'none'}` });
      const plan = w.materials.plan(inWood(designBill(d), v.wood));
      return sendJson(res, 200, { ...plan, wood: v.wood ?? null, text: describePlan(plan) });
    }
    return sendJson(res, v ? 200 : 404, v ?? { error: 'no such village' });
  }

  // Any list of items: /api/materials?items=glass:8,chest:1&have=oak_log:3
  if (parts[1] === 'materials') {
    const counts = (s: string | null): Counts =>
      Object.fromEntries((s ?? '').split(',').filter(Boolean).map((x) => { const [n, q] = x.split(':'); return [n.trim(), Math.max(1, Math.floor(Number(q ?? 1)) || 1)]; }));
    const plan = w.materials.plan(counts(url.searchParams.get('items')), counts(url.searchParams.get('have')));
    return sendJson(res, 200, { ...plan, text: describePlan(plan) });
  }

  if (parts[1] === 'block') {
    const c = ['x', 'y', 'z'].map((k) => Math.floor(Number(url.searchParams.get(k))));
    if (c.some((n) => !Number.isFinite(n))) return sendJson(res, 400, { error: 'x, y and z are required' });
    // Any agent that has the chunk loaded can see the block
    for (const a of w.agents.values()) {
      const b = a.bot.entity ? a.bot.blockAt(new Vec3(c[0], c[1], c[2])) : null;
      if (b) return sendJson(res, 200, { x: c[0], y: c[1], z: c[2], block: b.name, properties: b.getProperties() });
    }
    return sendJson(res, 200, { x: c[0], y: c[1], z: c[2], loaded: false });
  }

  if (parts[1] === 'chat' && req.method === 'POST') {
    const body = await readJson(req);
    await w.rcon.command(`say ${String(body.text ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);
    return sendJson(res, 200, { ok: true });
  }

  if (parts[1] !== 'agents') return sendJson(res, 404, { error: 'Not found' });
  const name = parts[2];
  if (!name) {
    if (req.method === 'GET') {
      return sendJson(res, 200, [...w.agents.values()].map((a) => ({
        name: a.name, role: a.role, brain: a.brain?.name ?? null,
        position: a.bot.entity ? { x: a.bot.entity.position.x, y: a.bot.entity.position.y, z: a.bot.entity.position.z } : null,
        action: a.current?.status ?? null,
      })));
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (w.get(String(body.name ?? ''))) return sendJson(res, 409, { error: 'agent already exists' });
      const a = await w.spawn(String(body.name ?? ''), {
        role: typeof body.role === 'string' ? body.role : undefined, brain: body.brain ?? null, gamemode: body.gamemode,
        position: body.position, memory: body.memory && typeof body.memory === 'object' ? body.memory : undefined, reset: body.reset === true,
      });
      return sendJson(res, 201, { name: a.name, id: a.bot.entity?.id });
    }
  }
  const a = w.get(name ?? '');
  if (!a) return sendJson(res, 404, { error: `agent ${name} not found` });
  const sub = parts[3];
  if (!sub && req.method === 'DELETE') {
    w.remove(a.name);
    return sendJson(res, 200, { ok: true });
  }
  if (sub === 'observe' || (!sub && req.method === 'GET')) {
    const r = Number(url.searchParams.get('radius') ?? 16);
    return sendJson(res, 200, a.observe(Math.max(4, Math.min(32, r))));
  }
  if (sub === 'act' && req.method === 'POST') {
    const body = await readJson(req);
    const list = Array.isArray(body) ? body : [body];
    const out = [];
    for (const b of list) {
      const { action, replace, ...args } = b;
      out.push(a.enqueue(String(action), args, !!replace));
    }
    return sendJson(res, 200, Array.isArray(body) ? out : out[0]);
  }
  if (sub === 'stop' && req.method === 'POST') {
    a.stop();
    return sendJson(res, 200, { ok: true });
  }
  if (sub === 'events') {
    const since = Number(url.searchParams.get('since') ?? 0);
    return sendJson(res, 200, a.events.filter((e) => e.id > since));
  }
  if (sub === 'actions') return sendJson(res, 200, { current: a.current?.status ?? null, queued: a.queue, history: a.history.slice(-30) });
  if (sub === 'memory') {
    if (req.method === 'POST') Object.assign(a.memory, await readJson(req));
    return sendJson(res, 200, a.memory);
  }
  sendJson(res, 404, { error: 'unknown endpoint' });
}
