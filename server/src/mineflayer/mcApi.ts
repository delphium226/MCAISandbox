/**
 * The agent REST API for real Minecraft, with the sandbox's routes and JSON shapes (README "Agent API"), so the same
 * controllers and test scripts (scripts/watch_*.py) work against either world.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Vec3 } from 'vec3';
import { readJson, sendJson } from '../api';
import { validateDesign } from '../designs';
import type { BuildingStyle } from '../buildingGen';
import { TOOLS } from '../skills';
import { handlePanel, overviewStats } from '../panel';
import { describePlan, designBill, inWood, type Counts } from './mcMaterials';
import { registerChest } from './mcStorage';
import { postLayout } from '../layout';
import { villageHome } from '../village';
import { GROW, GROW_FARMS } from '../grow';
import { APPETITE } from '../appetite';
import { TEMPERAMENT_MODE, temperamentTable } from '../temperament';
import type { MineflayerWorld } from './mcWorld';

// GET /api/perf's figures (E.1: [lag] shows only stalls over 2 s): the event loop's delay, sampled every 10 ms and started
// over every minute, reported over that minute and the one before it (a stall recorded just before a restart would be
// lost, and the figures read 0 right after one), and world.tick()'s duration over the last minute (index.ts records each)
const LOOP_RES = 10;
const loopDelay = monitorEventLoopDelay({ resolution: LOOP_RES });
loopDelay.enable();
// (the minute before, in ns; count 0 before the first restart)
let loopPrev = { count: 0, p50: 0, p99: 0, max: 0 };
setInterval(() => {
  loopPrev = { count: loopDelay.count, p50: loopDelay.percentile(50), p99: loopDelay.percentile(99), max: loopDelay.max };
  loopDelay.reset();
}, 60_000).unref();
// (a ring of 2,400 ticks: two minutes at 20 Hz, so the last minute is always in it)
const tickMs = new Float64Array(2400), tickAt = new Float64Array(2400);
let tickN = 0;

/** One world.tick()'s duration in ms. */
export function recordTick(ms: number) {
  tickMs[tickN % tickMs.length] = ms;
  tickAt[tickN % tickMs.length] = Date.now();
  tickN++;
}

function perf(w: MineflayerWorld) {
  const now = Date.now(), round = (ms: number) => Math.round(ms * 10) / 10;
  // (each sample is the time between two checks, so the 10 ms interval itself is taken off: 0 is a loop never late)
  const loop = (ns: number) => round(Math.max(0, ns / 1e6 - LOOP_RES));
  // (p99 and max the higher of the two minutes; p50 the current one's, or the minute before's while it has no samples)
  const cur = loopDelay.count ? { p50: loopDelay.percentile(50), p99: loopDelay.percentile(99), max: loopDelay.max } : null;
  const prev = loopPrev.count ? loopPrev : null;
  const pick = (k: 'p99' | 'max') => Math.max(cur?.[k] ?? 0, prev?.[k] ?? 0);
  const ticks: number[] = [];
  for (let i = 0; i < Math.min(tickN, tickMs.length); i++) if (tickAt[i] >= now - 60_000) ticks.push(tickMs[i]);
  ticks.sort((p, q) => p - q);
  const mem = process.memoryUsage();
  return {
    rss: mem.rss, heapUsed: mem.heapUsed,
    loop: cur || prev ? { p50: loop((cur ?? prev)!.p50), p99: loop(pick('p99')), max: loop(pick('max')) } : { p50: 0, p99: 0, max: 0 },
    tick: { p99: round(ticks.length ? ticks[Math.min(ticks.length - 1, Math.ceil(0.99 * ticks.length) - 1)] : 0), max: round(ticks.length ? ticks[ticks.length - 1] : 0) },
    rcon: w.rcon.peek(),
    overview: { ms: overviewStats.ms, bytes: overviewStats.bytes, at: overviewStats.at },
    agents: w.agents.size,
    at: now,
  };
}

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

  // Load at a glance (E.1): memory, the event loop, the world tick, RCON and the panel's overview
  if (parts[1] === 'perf') return sendJson(res, 200, perf(w));
  // A.3p: every named agent's temperament, kind weights and persona line, and the mode in force
  if (parts[1] === 'temperaments') return sendJson(res, 200, { mode: TEMPERAMENT_MODE, agents: temperamentTable() });

  if (parts[1] === 'status') {
    return sendJson(res, 200, { world: 'minecraft', version: w.version, server: `${w.host}:${w.port}`, ticks: w.ticks, worldRules: w.worldRules, grow: GROW.on,
      // (s30's food step: the appetite's numbers, rate 0 when off, and the neighbourhood fields)
      growFarms: GROW_FARMS, appetite: { rate: APPETITE.rate, idle: APPETITE.idle, start: APPETITE.start }, agents: [...w.agents.values()].map((a) => a.name) });
  }
  // The shared atlas: chunk summaries around a village's home, a point or the first agent (?village= | ?x=&z=, radius=)
  if (parts[1] === 'atlas') {
    // ?all=1: every chunk and every village's ground, compact (~230 bytes a chunk, ~100 more with exposed ores): the
    // panel's world map
    if (url.searchParams.get('all') === '1') {
      const villages = [...w.villages.villages.values()].map((v) => ({
        name: v.name, layouts: v.layouts ?? [], plots: v.plots, structures: v.structures,
        storage: { chests: (v.storage?.chests ?? []).map(({ x, y, z }) => ({ x, y, z })) },
        // (the mining hut, for the map's mine icon)
        mine: v.mine?.hut ? { hut: v.mine.hut } : undefined,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: w.atlas.status(), all: true, chunks: [...w.atlas.chunks.values()], villages, animals: [...w.atlas.animals.values()] }));
      return;
    }
    const radius = Math.min(400, Math.max(16, Number(url.searchParams.get('radius') ?? 200) || 200));
    const v = url.searchParams.get('village') ? w.villages.get(url.searchParams.get('village')!) : undefined;
    const members = v ? w.agentList().filter((a) => a.memory.village === v.name) : w.agentList();
    const pos = (a: (typeof members)[number]) => a.bot.entity?.position;
    let centre: { x: number; z: number } | null = v ? villageHome(v, members.find((a) => a.memory.origin)?.memory) : null;
    const qx = Number(url.searchParams.get('x')), qz = Number(url.searchParams.get('z'));
    if (!centre && url.searchParams.has('x') && Number.isFinite(qx) && Number.isFinite(qz)) centre = { x: Math.floor(qx), z: Math.floor(qz) };
    const p = members.map(pos).find(Boolean);
    if (!centre && p) centre = { x: Math.floor(p.x), z: Math.floor(p.z) };
    return sendJson(res, 200, { status: w.atlas.status(), centre, radius, chunks: centre ? w.atlas.near(centre.x, centre.z, radius) : [],
      animals: centre ? [...w.atlas.animals.values()].filter((s) => Math.hypot(s.x - centre!.x, s.z - centre!.z) <= radius) : [] });
  }
  if (parts[1] === 'skills') return sendJson(res, 200, Object.fromEntries(TOOLS.filter((t) => w.skills.includes(t)).map((t) => [t.name, t.description])));

  // Write villages.json now (E.0: saves are debounced; a kill, as taskkill /F on Windows, runs no exit handler)
  if (parts[1] === 'villages' && parts[2] === 'flush' && req.method === 'POST') {
    w.villages.flushSync();
    return sendJson(res, 200, { ok: true, version: w.villages.version });
  }

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
      const body = await readJson(req);
      const { design, errors, fixes } = validateDesign(body, 'api', { isPlaceable: (b) => w.isPlaceable(b), states: true });
      if (!design) return sendJson(res, 400, { errors });
      // (the style a generated design came from: layouts pack it by its walls, builds claim its own area)
      if (body.style && typeof body.style === 'object') design.style = body.style as BuildingStyle;
      v.designs[design.name] = design;
      w.villages.note(v, `design "${design.name}" added through the API`);
      return sendJson(res, 200, { ok: true, name: design.name, fixes });
    }
    // Lay buildings out and post their tasks, as the mayor's plan_layout does (tests): {buildings, x, y, z, size?, wood?, economy?,
    // workers?} (workers: how many will work it, S.6's parts; the stage script lays out before it spawns them)
    if (v && parts[3] === 'layout' && req.method === 'POST') {
      const b = await readJson(req);
      const site = { x: Math.floor(Number(b.x)), y: Math.floor(Number(b.y ?? 64)), z: Math.floor(Number(b.z)), size: b.size !== undefined ? Number(b.size) : undefined, wood: typeof b.wood === 'string' && b.wood ? b.wood : undefined, woodLogs: Number(b.woodLogs) || undefined, biome: typeof b.biome === 'string' && b.biome ? b.biome : undefined };
      if (!Number.isFinite(site.x) || !Number.isFinite(site.z)) return sendJson(res, 400, { error: 'x and z (the site centre) are required' });
      // (plan "street": a vanilla town centre and streets, V2.3, the site's biome picking the centre; "rows" clears it)
      if (b.plan === 'street') v.plan = 'street';
      else if (b.plan === 'rows') delete v.plan;
      const result = postLayout(w, v, String(b.by ?? 'api'), site, b.buildings, b.economy !== false, typeof b.workers === 'number' ? b.workers : undefined);
      return sendJson(res, result.startsWith('plan_layout:') ? 400 : 200, { result, tasks: v.tasks });
    }
    // Set a task's status (tests skipping a stage): {status: "done" | "open" | "failed" | "claimed", by?}
    // ("claimed" by the test holds a task back from the workers while the test does it itself)
    if (v && parts[3] === 'tasks' && parts[4] && req.method === 'POST') {
      const t = v.tasks.find((x) => x.id === parts[4]);
      const body = await readJson(req);
      const status = String(body.status ?? '');
      if (!t || !['open', 'done', 'failed', 'claimed'].includes(status)) return sendJson(res, 400, { error: 'unknown task or status (open, done, failed, claimed)' });
      t.status = status as typeof t.status;
      if (status === 'open') t.claimedBy = undefined;
      if (status === 'claimed') t.claimedBy = String(body.by ?? 'api');
      t.updated = Date.now();
      w.villages.save();
      return sendJson(res, 200, t);
    }
    // Register a chest already in the world as village storage (tests): {x, y, z, group?}
    if (v && parts[3] === 'storage' && req.method === 'POST') {
      const b = await readJson(req);
      const pos = { x: Math.floor(Number(b.x)), y: Math.floor(Number(b.y)), z: Math.floor(Number(b.z)) };
      if (![pos.x, pos.y, pos.z].every(Number.isFinite)) return sendJson(res, 400, { error: 'x, y and z are required' });
      const block = (await w.rcon.command(`execute if block ${pos.x} ${pos.y} ${pos.z} chest`)).trim();
      if (!/passed/i.test(block)) return sendJson(res, 400, { error: `no chest at ${pos.x},${pos.y},${pos.z} (${block})` });
      return sendJson(res, 200, { result: registerChest({ name: 'api' }, v, pos, w.villages, typeof b.group === 'string' ? b.group : undefined), storage: v.storage });
    }
    // Appetite levels for tests (s30): {agent?, level}, one member or every member in the world; starts the village's record
    if (v && parts[3] === 'appetite' && req.method === 'POST') {
      // (not with the appetite off: the record it starts would persist and switch the food rules on in a later run before
      // any field is planted, and the watchers would follow it; lens 1 L4, lens 3 L4)
      if (!APPETITE.rate) return sendJson(res, 400, { error: 'the appetite is off on this agent server (MC_APPETITE)' });
      const b = await readJson(req);
      const level = Number(b.level);
      if (!Number.isFinite(level) || level < 0 || level > APPETITE.cap) return sendJson(res, 400, { error: `level: a number from 0 to ${APPETITE.cap}` });
      const names = typeof b.agent === 'string' && b.agent ? [b.agent] : w.growMembers(v).map((a) => a.name);
      if (typeof b.agent === 'string' && b.agent && w.get(b.agent)?.village()?.name !== v.name) return sendJson(res, 400, { error: `agent: ${b.agent} is not a member of ${v.name} in the world` });
      return sendJson(res, 200, { members: w.setAppetite(v, names, level), on: true });
    }
    // The chore menu a village member would choose from now (A.2; pure, nothing written): ?agent=Worker1
    if (v && parts[3] === 'choices' && req.method === 'GET') {
      const a = w.get(url.searchParams.get('agent') ?? '');
      if (!a || a.village()?.name !== v.name) return sendJson(res, 400, { error: `agent (a member of ${v.name} in the world) is required` });
      return sendJson(res, 200, w.choices(a));
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
      // (a sign's front text too, as the bot sees it: the name signs' check)
      const text = /_sign$/.test(b?.name ?? '') ? (b as unknown as { getSignText?: () => string[] }).getSignText?.()?.[0] : undefined;
      if (b) return sendJson(res, 200, { x: c[0], y: c[1], z: c[2], block: b.name, properties: b.getProperties(), ...(text !== undefined ? { text } : {}) });
    }
    return sendJson(res, 200, { x: c[0], y: c[1], z: c[2], loaded: false });
  }
  // A box of blocks (checks compare before and after): names by index into `names`, x fastest, then z, then y; -1 where
  // no agent has the chunk loaded. At most 65536 blocks.
  if (parts[1] === 'blocks') {
    const k = ['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].map((n) => (url.searchParams.get(n) ? Math.floor(Number(url.searchParams.get(n))) : NaN));
    if (k.some((n) => !Number.isFinite(n))) return sendJson(res, 400, { error: 'x1, y1, z1, x2, y2 and z2 are required' });
    const [x1, x2] = [Math.min(k[0], k[3]), Math.max(k[0], k[3])], [y1, y2] = [Math.min(k[1], k[4]), Math.max(k[1], k[4])], [z1, z2] = [Math.min(k[2], k[5]), Math.max(k[2], k[5])];
    if ((x2 - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1) > 65536) return sendJson(res, 400, { error: 'at most 65536 blocks' });
    const bots = [...w.agents.values()].filter((a) => a.bot.entity).map((a) => a.bot);
    // states=1: names with their block states ("oak_stairs[facing=north,half=bottom,shape=straight]"; phase D's checks)
    const withStates = url.searchParams.get('states') === '1';
    const names: string[] = [], index = new Map<string, number>(), cells: number[] = [];
    for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) for (let x = x1; x <= x2; x++) {
      let name: string | undefined;
      for (const bot of bots) {
        const b = bot.blockAt(new Vec3(x, y, z));
        if (b) {
          const props = withStates ? Object.entries(b.getProperties() as Record<string, unknown>).filter(([k]) => k !== 'waterlogged').map(([k, v]) => `${k}=${v}`) : [];
          name = props.length ? `${b.name}[${props.join(',')}]` : b.name;
          break;
        }
      }
      if (name === undefined) { cells.push(-1); continue; }
      if (!index.has(name)) { index.set(name, names.length); names.push(name); }
      cells.push(index.get(name)!);
    }
    return sendJson(res, 200, { x1, y1, z1, x2, y2, z2, names, cells });
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
  // Run one option of the agent's chore menu (A.2, tests): {id}, checked against a fresh menu as a model's pick is
  if (sub === 'choice' && req.method === 'POST') {
    const body = await readJson(req);
    const r = w.runChoice(a, String(body.id ?? ''), { source: 'fixed', reason: typeof body.reason === 'string' ? body.reason.slice(0, 200) : 'api' });
    return sendJson(res, r.ok ? 200 : 409, r);
  }
  // plan_layout's material count around where the agent stands, timed (F106): /api/agents/Gus/near?items=sand:64,stone:300&range=96
  if (sub === 'near') {
    const want = Object.fromEntries((url.searchParams.get('items') ?? '').split(',').filter(Boolean).map((x) => { const [n, q] = x.split(':'); return [n.trim(), Math.max(1, Number(q ?? 1) || 1)]; }));
    const p = a.bot.entity.position.floored();
    const out: Record<string, { found: number; ms: number }> = {};
    for (const [n, q] of Object.entries(want)) {
      const t0 = performance.now();
      const found = w.materialsNear(a.name, { [n]: q }, p.x, p.y - 1, p.z, Number(url.searchParams.get('range') ?? 96))?.[n] ?? 0;
      out[n] = { found, ms: Math.round(performance.now() - t0) };
    }
    return sendJson(res, 200, { at: { x: p.x, y: p.y - 1, z: p.z }, counts: out });
  }
  if (sub === 'memory') {
    if (req.method === 'POST') Object.assign(a.memory, await readJson(req));
    return sendJson(res, 200, a.memory);
  }
  sendJson(res, 404, { error: 'unknown endpoint' });
}
