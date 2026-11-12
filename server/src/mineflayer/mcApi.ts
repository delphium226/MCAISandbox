/**
 * The agent REST API for real Minecraft, with the sandbox's routes and JSON shapes (README "Agent API"), so the same
 * controllers and test scripts (scripts/watch_*.py) work against either world.
 */
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Vec3 } from 'vec3';
import { readJson, sendJson } from '../api';
import { validateDesign } from '../designs';
import type { BuildingStyle } from '../buildingGen';
import { handlePanel, overviewStats } from '../panel';
import { describePlan, designBill, inWood, type Counts } from './mcMaterials';
import { registerChest } from './mcStorage';
import { postLayout } from '../layout';
import { villageHome } from '../village';
import { GROW, GROW_FARMS } from '../grow';
import { APPETITE } from '../appetite';
import { TEMPERAMENT_MODE, temperamentTable } from '../temperament';
import { GOALS_ON, goalPlan, goalsOf, progress, type GoalPlan } from '../goals';
import { WANTED_TOP } from '../tech';
import { allProposals, applyVerdict, guardVerdict, proposal, type Verdict } from '../proposals';
import { PLAYER_TALK, peopleOf, requestsOf } from '../playerTalk';
import type { Village } from '../village';
import { WANTED_ON, recordTop, topWanted, wantedList, type WantedHistory } from '../wanted';
import { MC_SKILLS } from './mcSkills';
import type { MineflayerWorld } from './mcWorld';
import { pause, resume, runState } from '../runClock';
import { SETTING_CHANGES, rawSetting, setSetting, settingsNow } from '../settings';
import { RULES, addLaw, boardSigns, enact, liveClaims, liveReports } from '../rules';
import { CUSTOMS, CUSTOM_IDS, seed as seedCustom, seeds, type CustomId } from '../customs';
import { combatCounts, dangerView } from './mcCombat';
import { archeryCounts } from './mcArchery';
import { flintCounts } from './mcFlint';
import { castleStats, gateStats } from './mcWalls';

// GET /api/perf's figures (E.1: [lag] shows only stalls over 2 s): the event loop's delay, sampled every 10 ms and started
// over every minute, reported over that minute and the one before it (a stall recorded just before a restart would be
// lost, and the figures read 0 right after one), and world.tick()'s duration over the last minute (index.ts records each)
const LOOP_RES = 10, LOOP_P99_MIN = 1000;
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
  // (p99 and max the higher of the two minutes; p50 the current one's, or the minute before's while it has no samples.
  // The current minute's p99 counts once it has LOOP_P99_MIN samples: just after a restart its p99 of a few samples was
  // its worst stall, and the 25-bot probe, reading every 2 s, reported that as the p99: 176-188 ms where a timer in the
  // process measured 46, looplag 10-31)
  const cur = loopDelay.count ? { count: loopDelay.count, p50: loopDelay.percentile(50), p99: loopDelay.percentile(99), max: loopDelay.max } : null;
  const prev = loopPrev.count ? loopPrev : null;
  const pick = (k: 'p99' | 'max') => k === 'p99' && cur && prev && cur.count < LOOP_P99_MIN ? prev.p99 : Math.max(cur?.[k] ?? 0, prev?.[k] ?? 0);
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

/** The repo (MCAI_ROOT when this runs from a code snapshot, as index.ts reads it). */
const REPO = rawSetting('MCAI_ROOT') ? path.resolve(rawSetting('MCAI_ROOT')!) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** G6's wanted list for a village (wanted.ts): the world's registry, recipe plan, skills and the library's activities. */
function wantedOf(w: MineflayerWorld, v: Village) {
  return wantedList(v, {
    items: w.registry.itemsArray.map((it) => it.name), plan: (b) => w.materials.plan(b), skills: new Set(Object.keys(MC_SKILLS)),
    // (the user's, 10-30: an unmatched pursuit's proposal is for the triage session only, never the wanted list's demand)
    activitySkills: new Set(w.library.specs.map((s) => s.skill)), now: Date.now(), proposals: allProposals(v.name).filter((p) => p.source !== 'pursuit'),
  });
}

/**
 * MC_WANTED's writer (G6): every 5 minutes each complete village's wanted list into wanted.json beside villages.json, with
 * each capability's time in the top 3 (#73's persistence), and the top 3 handed to innovation (tech.ts WANTED_TOP). Started
 * by the first API request (the API holds the world); a failure is logged and the next round tries again.
 */
let wantedTimer: NodeJS.Timeout | null = null;
const wantedHistory: Record<string, WantedHistory> = {};
function startWanted(w: MineflayerWorld) {
  if (wantedTimer || !WANTED_ON) return;
  // (the registry's file: villages.json in the world's data folder)
  const file = path.join(path.dirname((w.villages as unknown as { file: string }).file), 'wanted.json');
  try {
    Object.assign(wantedHistory, (JSON.parse(fs.readFileSync(file, 'utf8')) as { history?: Record<string, WantedHistory> }).history ?? {});
  } catch {
    // (none yet)
  }
  const round = () => {
    try {
      const now = Date.now(), villages: Record<string, unknown> = {};
      for (const v of w.villages.villages.values()) {
        if (!v.complete) continue;
        const list = wantedOf(w, v);
        wantedHistory[v.name] = recordTop(wantedHistory[v.name], list, now);
        WANTED_TOP.set(v.name, topWanted(list));
        villages[v.name] = list;
        console.log(`[wanted] ${v.name}: ${list.slice(0, 3).map((x) => `${x.id} ${x.rank}${x.demand ? ` (demand ${x.demand})` : ''}`).join(', ')}`);
      }
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ at: now, villages, history: wantedHistory }, null, 1));
      fs.renameSync(`${file}.tmp`, file);
    } catch (e) {
      console.log(`[wanted] the writer failed: ${(e as Error).message.slice(0, 160)}`);
    }
  };
  wantedTimer = setInterval(round, 5 * 60000);
  wantedTimer.unref();
  setTimeout(round, 1000).unref();
}

export async function handleMcApi(w: MineflayerWorld, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  startWanted(w);
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
  // #115: the settings (every one with its value; live ones may change: POST {name, value, by?}) and the run's changes
  if (parts[1] === 'settings' && req.method === 'GET') return sendJson(res, 200, { settings: settingsNow(), changes: SETTING_CHANGES });
  if (parts[1] === 'settings' && req.method === 'POST') {
    const body = await readJson(req);
    const r = setSetting(String(body.name ?? ''), String(body.value ?? ''), String(body.by ?? 'api').slice(0, 20));
    return sendJson(res, r.ok ? 200 : 400, r);
  }
  // #115: the run's pause: GET its state (pausedMs: time paused so far); POST pause or resume (Paper's ticks frozen with it)
  if (parts[1] === 'run' && !parts[2] && req.method === 'GET') return sendJson(res, 200, runState());
  if (parts[1] === 'run' && (parts[2] === 'pause' || parts[2] === 'resume') && req.method === 'POST') {
    const changed = parts[2] === 'pause' ? pause() : resume();
    const tick = changed ? await w.rcon.command(parts[2] === 'pause' ? 'tick freeze' : 'tick unfreeze').catch((e: Error) => `rcon: ${e.message}`) : '';
    return sendJson(res, 200, { ...runState(), changed, tick });
  }
  // The start screen (spec 3.5): each village's life goals: typed (text, measure, pursuits, by) or drawn, with progress
  if (parts[1] === 'goals') {
    const plan = goalPlan();
    return sendJson(res, 200, {
      on: GOALS_ON, plan: plan ? { mode: plan.mode, hash: plan.hash, village: plan.village ?? null, members: Object.keys(plan.specs).length, specs: plan.specs } : null,
      // (read only: the villages a plan or a draw has reached; the plan goes on a village with its first goals, not here)
      villages: [...w.villages.villages.values()].filter((v) => goalsOf(v) || (v as Village & { goalPlan?: GoalPlan }).goalPlan).map((v) => {
        const specs = (v as Village & { goalPlan?: GoalPlan }).goalPlan?.specs ?? {};
        const of = goalsOf(v)?.of ?? {};
        const names = [...new Set([...Object.keys(specs), ...Object.keys(of)])];
        return {
          village: v.name, complete: !!v.complete,
          members: names.map((n) => {
            const s = specs[n], m = s ? s.measure : of[n];
            return { name: n, by: s ? s.by : 'drawn', text: s?.text ?? null, measure: m ?? null, pursuits: s?.pursuits ?? [], unmatched: s?.unmatched ?? [],
              progress: m && goalsOf(v) ? progress(v, n, m).text : null };
          }),
        };
      }),
    });
  }
  // A.3p: every named agent's temperament, kind weights and persona line, and the mode in force
  if (parts[1] === 'temperaments') return sendJson(res, 200, { mode: TEMPERAMENT_MODE, agents: temperamentTable() });
  // The first vote (spec_vote1): every village's votes (?village= one), the tally, each ballot and its reason
  if (parts[1] === 'votes') {
    const one = url.searchParams.get('village');
    const vs = one ? [w.villages.get(one)].filter((v) => !!v) : [...w.villages.villages.values()];
    return sendJson(res, 200, vs.map((v) => ({ village: v!.name, next: v!.growth?.next ?? null, work: v!.growth?.work ?? null, votes: v!.votes ?? [] })));
  }
  // G6: the wanted list (wanted.ts): every capability the village lacks, ranked by what it unlocks and the village's demand
  // (?village=; default every complete village)
  if (parts[1] === 'wanted') {
    const one = url.searchParams.get('village');
    const vs = one ? [w.villages.get(one)].filter((v): v is Village => !!v) : [...w.villages.villages.values()].filter((v) => v.complete);
    if (one && !vs.length) return sendJson(res, 404, { error: 'no such village' });
    return sendJson(res, 200, vs.map((v) => ({ village: v.name, at: Date.now(), list: wantedOf(w, v), history: wantedHistory[v.name] ?? null })));
  }
  // G6: the foundry's request queue (scripts/foundry_requests.py keeps scripts/foundry/requests.json; read here as it
  // is, ranked by its own `order`)
  if (parts[1] === 'foundry' && parts[2] === 'requests' && req.method === 'GET') {
    try {
      return sendJson(res, 200, JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'foundry', 'requests.json'), 'utf8')));
    } catch (e) {
      return sendJson(res, 200, { version: 1, requests: [], error: `no request queue: ${(e as Error).message.slice(0, 120)}` });
    }
  }
  // G5's proposals (#90; proposals.ts, MC_PROPOSALS): the village's list (?village=), and a triage's verdict applied
  // through code's guard (impossible never accepted, the user's calls deferred, the foundry only for a ticketable
  // capability); the world reports it to the proposer and its backers on its next sweep
  // G7 (MC_TALK, #35): a person's line, as if said in the game (`to`: a village's Mayor or a member answers it wherever
  // it is); the request ledger with each person's record. `pos` {x, y, z}: where the person stands, for "here" when they
  // are not in the game (staged checks, #179)
  if (parts[1] === 'say' && req.method === 'POST') {
    const b = await readJson(req);
    const p = b.pos as { x?: unknown; y?: unknown; z?: unknown } | undefined;
    const pos = p && [p.x, p.y ?? 64, p.z].every((n) => Number.isFinite(Number(n))) ? { x: Number(p.x), y: Number(p.y ?? 64), z: Number(p.z) } : undefined;
    const out = await w.playerSay(typeof b.from === 'string' && b.from.trim() ? b.from.trim() : 'SausageOfDoom4', String(b.text ?? ''), typeof b.to === 'string' && b.to.trim() ? b.to.trim() : undefined, pos);
    return sendJson(res, 'error' in out ? 400 : 200, out);
  }
  if (parts[1] === 'requests' && req.method === 'GET') {
    const v = url.searchParams.get('village') ?? undefined;
    // (each with its progress as the talk prompt reads it: a requested work's parts built, MC_TALK_BIG)
    const open = (r: { status: string }) => r.status === 'queued' || r.status === 'under_way';
    return sendJson(res, 200, { on: PLAYER_TALK.on, requests: requestsOf(v).slice(-100).reverse().map((r) => (open(r) ? { ...r, progress: w.requestProgress(r) } : r)), people: peopleOf(v) });
  }
  if (parts[1] === 'proposals') {
    if (!parts[2] && req.method === 'GET') return sendJson(res, 200, allProposals(url.searchParams.get('village') ?? undefined));
    if (parts[2] && parts[3] === 'verdict' && req.method === 'POST') {
      const p = proposal(decodeURIComponent(parts[2]));
      if (!p) return sendJson(res, 404, { error: 'no such proposal' });
      const b = await readJson(req);
      const decision = b.decision;
      if (decision !== 'accept' && decision !== 'reject' && decision !== 'defer') return sendJson(res, 400, { error: 'decision must be accept, reject or defer' });
      if (typeof b.reason !== 'string' || !b.reason.trim()) return sendJson(res, 400, { error: 'a reason the members will read is required' });
      const pick = <T extends string>(x: unknown, ok: readonly T[]) => (typeof x === 'string' && (ok as readonly string[]).includes(x) ? (x as T) : undefined);
      const raw: Verdict = {
        by: 'triage', at: Date.now(), decision, reason: b.reason.trim().slice(0, 300),
        ...(pick(b.route, ['foundry', 'library', 'catalogue', 'issue', 'config', 'none'] as const) ? { route: pick(b.route, ['foundry', 'library', 'catalogue', 'issue', 'config', 'none'] as const) } : {}),
        ...(pick(b.size, ['small', 'medium', 'large'] as const) ? { size: pick(b.size, ['small', 'medium', 'large'] as const) } : {}),
        ...(typeof b.notes === 'string' ? { notes: b.notes.slice(0, 500) } : {}),
        ...(typeof b.ref === 'string' ? { ref: b.ref.slice(0, 120) } : {}),
      };
      const v = guardVerdict(p, raw);
      applyVerdict(p.id, v);
      console.log(`[proposal] ${p.village}: ${p.id} ${v.decision}${v.route ? ` (${v.route})` : ''}${v.decision !== raw.decision || v.route !== raw.route ? ` (guarded from ${raw.decision}${raw.route ? ` ${raw.route}` : ''})` : ''}: ${v.reason.slice(0, 120)}`);
      return sendJson(res, 200, proposal(p.id));
    }
    return sendJson(res, 404, { error: 'GET /api/proposals?village=V, POST /api/proposals/:id/verdict' });
  }
  // Phase N's needs (spec_needs_v2): one village's needs with their levels, status and line (?village=), or every village's
  if (parts[1] === 'needs') {
    const one = url.searchParams.get('village');
    if (one) {
      const view = w.needsView(one);
      return sendJson(res, view ? 200 : 404, view ?? { error: 'no such village' });
    }
    return sendJson(res, 200, [...w.villages.villages.keys()].map((n) => w.needsView(n)).filter((x) => !!x));
  }

  if (parts[1] === 'status') {
    return sendJson(res, 200, { world: 'minecraft', version: w.version, server: `${w.host}:${w.port}`, ticks: w.ticks, worldRules: w.worldRules, grow: GROW.on,
      // (s30's food step: the appetite's numbers, rate 0 when off, and the neighbourhood fields)
      growFarms: GROW_FARMS, appetite: { rate: APPETITE.rate, idle: APPETITE.idle, start: APPETITE.start },
      // (survival (c): the combat reflex's counts, mcCombat.ts)
      combat: combatCounts,
      // (#217/#225: bows (shots, hits, kills by mob, assists), the gravel trips for flint, the wall's gates and stone stage)
      archery: archeryCounts, flint: flintCounts, gates: gateStats, castle: castleStats,
      // (survival (d): the danger count by village, mcCombat.ts)
      danger: dangerView(), agents: [...w.agents.values()].map((a) => a.name) });
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
  if (parts[1] === 'skills') return sendJson(res, 200, Object.fromEntries(w.skills.map((t) => [t.name, t.description])));

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
    // #108's test hook (MC_PAY): an act for a member, {agent, act, act_to, act_item, act_project, act_price, act_steps,
    // act_amount}, as if it came with a decision: a priced request for a staged run's scripted workers to take up
    if (v && parts[3] === 'pay' && req.method === 'POST') {
      const b = await readJson(req);
      const str = (x: unknown) => (x === undefined || x === null ? undefined : String(x));
      const fields = Object.fromEntries(['act', 'act_to', 'act_item', 'act_project', 'act_price', 'act_steps', 'act_amount', 'say'].map((k) => [k, str(b[k])]).filter(([, x]) => x !== undefined));
      return sendJson(res, 200, { done: w.payTest(v, String(b.agent ?? ''), fields) });
    }
    // #164 (E.7's seeding, MC_CUSTOMS): {agents, custom, persona?}: members seeded with a custom, a persona line each, marked
    // in the ledger
    if (v && parts[3] === 'seed' && req.method === 'POST') {
      if (!CUSTOMS.on) return sendJson(res, 400, { error: 'customs are off on this agent server (MC_CUSTOMS)' });
      const b = await readJson(req);
      const custom = String(b.custom ?? '') as CustomId;
      if (!(CUSTOM_IDS as readonly string[]).includes(custom)) return sendJson(res, 400, { error: `custom: one of ${CUSTOM_IDS.join(', ')}` });
      const agents = Array.isArray(b.agents) ? b.agents.map(String) : [];
      const stray = agents.filter((n: string) => w.get(n)?.village()?.name !== v.name);
      if (!agents.length || stray.length) return sendJson(res, 400, { error: `agents: members of ${v.name} in the world${stray.length ? ` (not: ${stray.join(', ')})` : ''}` });
      const done = seedCustom(v.name, agents, custom, typeof b.persona === 'string' ? b.persona : undefined, Date.now());
      return sendJson(res, 200, { seeded: done, custom, seeds: seeds(v.name) });
    }
    // #164's test hook (MC_RULES): {what, by?}: a law read from its words and put into force at once, as if voted (staged
    // checks of a claim or report rule without a council's days)
    if (v && parts[3] === 'rule' && req.method === 'POST') {
      if (!RULES.on) return sendJson(res, 400, { error: 'rules are off on this agent server (MC_RULES)' });
      const b = await readJson(req);
      const l = addLaw(v.name, String(b.by ?? 'api'), { what: String(b.what ?? '') }, Date.now());
      if (l.status !== 'open') return sendJson(res, 400, { error: `the law was ${l.status}${l.refused ? `: ${l.refused}` : ''}`, law: l });
      l.status = 'passed';
      const r = enact(v.name, l, { yes: 1, no: 0, abstain: 0 }, Date.now());
      return sendJson(res, 200, { law: l, rule: r });
    }
    // #164: the board by the storage hut: claims holding, reports posted, the signs' text and where they stand
    if (v && parts[3] === 'board' && req.method === 'GET') {
      const now = Date.now();
      return sendJson(res, 200, { claims: liveClaims(v.name, now), reports: liveReports(v.name, now), signs: boardSigns(v.name, now, 3), cells: (v as { signBoard?: unknown; board?: unknown }).signBoard ?? (Array.isArray((v as { board?: unknown }).board) ? (v as { board?: unknown }).board : null) });
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
