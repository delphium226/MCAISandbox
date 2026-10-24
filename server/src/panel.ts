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
 *   GET /api/agents/:name/thoughts  the agent's last 40 model calls (s34): kind, what it saw, its reasoning, its answer
 *   GET /api/agents/:name/mind      what the agent carries (s34): its memory fields, temperament, persona, chore record
 *                                   (not /memory: the agent API's own route, read by the watch scripts)
 *   GET /api/agents/:name/decision  the agent's last chore decision in full (A2: menu, order shown, choice, reason,
 *                       prompt); the overview carries only `choice`, its one-line status
 *   GET /api/models     the models Ollama has loaded (name, VRAM, cloud)
 *   GET /api/maps       a top-down map around every agent (?radius=, default 24; ?agents=A,B: only those)
 *   GET /api/usage      model calls, tokens and cost by model, agent and kind (?since=<epoch ms>&agents=A,B), the spend
 *                       ledger's month and programme, and the call gate's waits (`gate`)
 *   POST /api/usage/budget  {tokensPerHour: number|null, windowMs?}: set the hourly cloud token budget (tests)
 *   GET /api/techtree   each complete village's whole tech tree (techTree.ts: goods made, known and locked, the library's
 *                       entries, linked by the recipes plans use), for the Tech tab's graph; computed at most every 30 s
 *   GET /api/scorecard  #80's thriving scorecard per complete village: 10-minute points, hours and the pass mark, from a
 *                       sample a minute this process keeps from its first request (a day of them) and the busy history
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WorldAdapter, WorldAgent } from './world';
import { readJson, sendJson } from './api';
import { OLLAMA_ROUTES, gate, recentCalls } from './modelCall';
import { usage, isCloudModel } from './modelUsage';
import { elevations } from './designs';
import { neighbourhoodNames } from './placeNames';
import type { Design, Village } from './village';
import { APPETITE, foodItems, foodPoints, stateOf } from './appetite';
import { TEMPERAMENT_MODE, kindWeights, personaOf, temperament } from './temperament';
import { MERCHANT_ON, OFFERS } from './merchant';
import { BARTER, boardOf, offerText, price } from './barter';
import { OWN, LEVY, OWN_FARM, OWN_SALES_ON, SPECIAL } from './own';
import { INNOVATE, LIBRARY, ROYALTY, pointsIn, techOf } from './tech';
import { GOALS_ON, goalsOf, progress } from './goals';
import { ScoreClock, scorecardView, type ScoreWorld } from './scorecard';
import { techTree, type RecipeOf, type TechTree } from './techTree';
import { MEMORY, agentMemory, liveNotes, membersOf, rosterOf, villageMemory } from './memory';
import { ACTS, socialView } from './acts';
import { SOCIAL } from './social';
import { PROPOSALS_ON, allProposals } from './proposals';
import { RULES, laws as lawsOf, rulesInForce } from './rules';
import { councilLine } from './council';
import { CHARACTER, glance, identityOf, memberView, seriesView, villageView } from './character';
import { phaseLine } from './society';
import { LADDER, ladderView } from './ladder';
import { rawSetting } from './settings';

/** A design's elevations, or nothing for a malformed one (villages.json is read unchecked; one must not break the panel). */
function safeElevations(d: Design): string {
  try {
    return elevations(d);
  } catch {
    return '';
  }
}

const PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../panel/index.html');
const OLLAMA_URL = rawSetting('MC_OLLAMA_URL') ?? 'http://localhost:11434';
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
    // (A.3p: the persona line its chore menus show; '' with MCAI_TEMPERAMENT off and no memory.persona)
    // (character v2: the identity line in its place, as the model sees it)
    persona: (typeof m.persona === 'string' && m.persona) || (v ? identityOf(v.name, a.name) : '') || personaOf(a.name),
    ...(v && glance(v.name, a.name, Date.now()) ? { char: glance(v.name, a.name, Date.now()) } : {}),
    notes: typeof m.notes === 'string' ? m.notes : null,
    // (G1: what it is doing and why, its intention for the day, the village's clock)
    intent: m.intent ?? null,
    ...(v ? (() => { const am = agentMemory(v.name, a.name); const ph = phaseLine(v.name); return { ...(am?.today ? { today: am.today } : {}), ...(ph ? { clock: ph } : {}) }; })() : {}),
    stats: m.stats ?? null,
    rescues: m.rescues ?? null,
    buildSpeed: m.buildSpeed ?? null,
    events: a.events.filter((e) => !NOISE.has(e.type)).slice(-OVERVIEW_EVENTS),
    nearby: o.nearbyEntities.slice(0, 25).map((e) => ({ kind: e.kind, name: e.name, x: e.x, z: e.z })),
    yaw: o.yaw,
    // A2: choosing, queued or running a chore and the last decision in one line (cached fields, ~300 bytes; the menu,
    // facts and prompt are at /decision)
    choice: a.world.choiceStatus?.(a) ?? null,
    // (s30's appetite, where the village keeps one: the bar's level and state, meals, the last meal, minutes hungry)
    ...appetiteView(a),
  };
}

function appetiteView(a: WorldAgent) {
  const e = a.world.appetiteOf?.(a);
  return e ? { appetite: { level: Math.round(e.level * 10) / 10, state: e.state, meals: e.meals, lastMeal: e.lastMeal ?? null, hungryMin: Math.round((e.hungryMs ?? 0) / 6000) / 10 } } : {};
}

/** A village's food at a glance (s30): storage's food in points and items, the ledger, who is hungry or peckish. */
function foodView(v: Village) {
  const f = v.food;
  // (with the appetite off, an old record is left out: the panel would show its levels as live bars, lens 3 L5)
  if (!f || !APPETITE.rate) return f ? { food: undefined } : {};
  const store: Record<string, number> = {};
  for (const c of v.storage?.chests ?? []) for (const [n, q] of Object.entries(c.items)) store[n] = (store[n] ?? 0) + q;
  const by = (s: string) => Object.entries(f.members).filter(([, e]) => stateOf(e.level) === s).map(([n]) => n);
  return { food: { points: foodPoints(store), items: foodItems(store), meals: f.meals, made: f.made, eaten: f.eaten, used: f.used ?? {}, hungry: by('hungry'), peckish: by('peckish'), members: f.members } };
}

/** s41's merchant for the Market card and the Trade tab: where it stands, the restock, every offer with its uses and stock
 *  (OFFERS' order), what members traded and the emeralds in storage (~2 kB). Null while it has not come (or MC_MERCHANT is
 *  off: `on` says which). */
function marketView(v: Village) {
  const m = v.merchant;
  let emeralds = 0;
  for (const c of v.storage?.chests ?? []) emeralds += c.items.emerald ?? 0;
  if (!m) return { market: MERCHANT_ON ? { on: true, here: false, emeralds } : null };
  return {
    market: {
      on: MERCHANT_ON, here: true, stall: m.stall, x: m.x, y: m.y, z: m.z, restockAt: m.restockAt, emeralds, ledger: m.ledger,
      offers: OFFERS.map((o, i) => ({ item: o.item, n: o.n, emeralds: o.emeralds, dir: o.dir, stock: o.stock, uses: Math.min(o.stock, m.uses[i] ?? 0) })),
    },
  };
}

/**
 * s43-s44's economy for the village card's Economy tab and the agents' wealth chips (~3-6 kB at 25 members): the flags;
 * each member's wealth (its own chest at the board's prices, emeralds, owed goods, royalty holdings, trades, research
 * credit, its life goal and progress), richest first; the barter board (counts, open offers, prices, what was traded);
 * the inventions (unlocked with inventor and minute, research under way, open pledges); the goals' spread. Null when none
 * of the economy's flags is on.
 */
export function economyView(v: Village) {
  if (!OWN.on && !BARTER.on && !INNOVATE && !GOALS_ON) return { economy: null };
  const b = boardOf(v);
  const t = INNOVATE ? techOf(v) : null;
  const g = GOALS_ON ? goalsOf(v) : undefined;
  const round = (x: number) => Math.round(x * 10) / 10;
  const names = new Set([...Object.keys(v.homes ?? {}), ...Object.keys(g?.of ?? {})]);
  const members = [...names].map((name) => {
    const h = v.homes?.[name];
    const items = h?.chest?.items ?? {};
    const worth = Object.entries(items).reduce((s, [k, q]) => s + price(b, k) * q, 0);
    const top = Object.entries(items).filter(([, q]) => q > 0).sort((x, y) => price(b, y[0]) * y[1] - price(b, x[0]) * x[1]).slice(0, 4);
    const owed = Object.values(h?.owed ?? {}).reduce((s, q) => s + q, 0);
    const traded = b.offers.filter((o) => o.state === 'taken' && (o.by === name || o.takenBy === name)).length;
    const royalties = t ? Object.entries(t.owners).filter(([, o]) => (o[name] ?? 0) > 0).map(([id, o]) => `${id} ${Math.round((100 * o[name]) / Object.values(o).reduce((s, q) => s + q, 0))}%`) : [];
    const goal = g?.of[name];
    return {
      name, chest: !!h?.chest, worth: round(worth), emeralds: items.emerald ?? 0, items: Object.values(items).reduce((s, q) => s + q, 0), top, owed, traded,
      sold: Object.values(h?.sold ?? {}).reduce((s, q) => s + q, 0), made: Object.values(h?.made ?? {}).reduce((s, q) => s + q, 0),
      ...(t ? { credit: (t.credit[name] ?? []).length, points: Math.round(Object.values(t.points).reduce((s, p) => s + (p[name] ?? 0), 0) / 10), royalties } : {}),
      ...(goal ? { goal, goalText: progress(v, name, goal).text } : {}),
      ...(v.claims ? { claims: Object.values(v.claims).filter((c) => c.by === name).length } : {}),
    };
  }).sort((x, y) => y.worth - x.worth || x.name.localeCompare(y.name));
  const worths = members.filter((m) => m.chest).map((m) => m.worth).sort((x, y) => x - y);
  const total = worths.reduce((s, q) => s + q, 0);
  // (the Gini coefficient of chest worth: 0 all equal, 1 one member holds it all)
  const gini = worths.length > 1 && total > 0 ? worths.reduce((s, q, i) => s + (2 * (i + 1) - worths.length - 1) * q, 0) / (worths.length * total) : 0;
  const now = Date.now();
  const factors = Object.entries(b.factor).filter(([, f]) => Math.abs(f - 1) > 0.01).sort((x, y) => y[1] - x[1]);
  return {
    economy: {
      flags: { own: OWN.on, share: OWN.share, levy: LEVY, barter: BARTER.on, special: Object.entries(SPECIAL).filter(([, on]) => on).map(([k]) => k).join(', '), sales: OWN_SALES_ON, ownFarm: OWN_FARM, innovate: INNOVATE, royalty: ROYALTY, goals: GOALS_ON },
      members, totals: { worth: round(total), emeralds: members.reduce((s, m) => s + m.emeralds, 0), owed: members.reduce((s, m) => s + m.owed, 0), gini: Math.round(gini * 100) / 100, chests: worths.length },
      board: BARTER.on ? {
        posted: b.posted, taken: b.taken, lapsed: b.lapsed, traded: b.traded,
        open: b.offers.filter((o) => o.state === 'open').slice(-12).map((o) => ({ by: o.by, text: offerText(o), age: now - o.at })),
        recent: b.offers.filter((o) => o.state === 'taken').slice(-8).reverse().map((o) => ({ by: o.by, takenBy: o.takenBy, text: offerText(o), at: o.endAt ?? o.at })),
        prices: factors.map(([k, f]) => ({ item: k, factor: f, price: round(price(b, k)) })),
      } : null,
      innovation: t ? {
        unlocked: t.unlocked.map((id) => ({ id, name: LIBRARY.find((e) => e.id === id)?.name ?? id, inventor: t.inventor[id], at: t.at[id], researchers: Object.keys(t.points[id] ?? {}).length })),
        research: LIBRARY.filter((e) => !t.unlocked.includes(e.id) && (t.need[e.id] !== undefined || pointsIn(v, e.id) > 0)).map((e) => ({
          id: e.id, name: e.name, points: Math.round(pointsIn(v, e.id) / 10), need: t.need[e.id] !== undefined ? Math.round(t.need[e.id] / 10) : null,
          researchers: Object.entries(t.points[e.id] ?? {}).sort((x, y) => y[1] - x[1]).map(([m, q]) => `${m} ${Math.round(q / 10)}`),
          pledges: (t.pledges[e.id] ?? []).map((p) => `${p.n} ${p.item} by ${p.by}`),
        })),
        locked: LIBRARY.filter((e) => !t.unlocked.includes(e.id) && t.need[e.id] === undefined && !pointsIn(v, e.id)).map((e) => ({ id: e.id, name: e.name, after: e.after ?? [], tools: e.tools ?? [] })),
      } : null,
      goals: g ? Object.entries(Object.values(g.of).reduce((s: Record<string, number>, x) => ((s[x] = (s[x] ?? 0) + 1), s), {})).map(([goal, n]) => ({ goal, n })) : null,
    },
  };
}

/** Phase N's needs for the village card's tab (spec_needs_v2): kind -> level, status, line and minutes above LOW
 *  (~100 bytes a need; /api/needs has the full state). Null with MC_NEEDS off or no view, and the tab says so. */
function needsSummary(w: WorldAdapter, village: string) {
  const nv = w.needsView?.(village);
  if (!nv || nv.mode === 'off') return null;
  const kinds = Object.fromEntries(Object.entries(nv.needs).map(([k, n]) => [k, { level: Math.round(n.level * 100) / 100, status: n.status, text: n.text, above: Math.round((n.aboveMs ?? 0) / 6000) / 10 }]));
  return { mode: nv.mode, kinds };
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
    // (spec_vote1: only the last vote, ~8 kB at 25 ballots; /api/votes has them all)
    // (the raw need states are swapped for their summary with each need's line, as needGauges; `needs` is the mayor's add_need)
    const { designs, votes, needStates: _needStates, ...rest } = v;
    const vote = votes?.length ? votes[votes.length - 1] : null;
    // (A2: the village's decisions by source, fallbacks and the chosen positions for the header's chip, ~250 bytes)
    const choices = w.choiceSummary?.(v.name) ?? null;
    const needGauges = needsSummary(w, v.name);
    // (how long it has been running, ms, as of this answer)
    rest.runMs = w.villages.age(v);
    // (#10: each neighbourhood's name by layout number, an old village's worked out as it will be stored)
    const hoodNames = Object.fromEntries(neighbourhoodNames(v));
    return send ? { ...rest, ...foodView(v), ...marketView(v), ...economyView(v), choices, vote, needGauges, hoodNames, designs: Object.fromEntries(keyed[i].map(([k, d, key]) => [k, { ...d, elevations: cachedElevations(d, key) }])) } : { ...rest, ...foodView(v), ...marketView(v), ...economyView(v), choices, vote, needGauges, hoodNames };
  });
  return { world: { kind: w.kind, ticks: w.ticks, time: Date.now() }, agents: agents.map(agentOverview), villages, designsEtag, usage: usage.summary() };
}

/** A memory object made safe to send: long strings cut, long arrays cut to their last 30, depth 5 (s34's Memory tab). */
function capped(x: unknown, depth = 0): unknown {
  if (typeof x === 'string') return x.length > 2000 ? `${x.slice(0, 2000)}... (${x.length} chars)` : x;
  if (x === null || typeof x !== 'object') return typeof x === 'function' ? undefined : x;
  if (depth >= 5) return '...';
  if (Array.isArray(x)) return (x.length > 30 ? x.slice(-30) : x).map((y) => capped(y, depth + 1));
  if (x instanceof Set || x instanceof Map) return `(${x.constructor.name} of ${x.size})`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) out[k] = capped(v, depth + 1);
  return out;
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
/** #80: the scorecard's samples, one a minute of each complete village, from the first request this process serves. */
const scores = new ScoreClock();
let scoresFor: WorldAdapter | null = null;
/** The world's readings the sample takes (mcWorld's members and parts; a world without them gives what it has). */
function scoreWorldOf(w: WorldAdapter): ScoreWorld {
  const x = w as unknown as { lightParts?: ScoreWorld['lightParts']; decorParts?: ScoreWorld['decorParts'] };
  return {
    members: (v) => w.agentList().filter((a) => a.village() === v).length,
    ...(x.lightParts ? { lightParts: (v) => x.lightParts!.call(w, v) } : {}),
    ...(x.decorParts ? { decorParts: (v) => x.decorParts!.call(w, v) } : {}),
  };
}
function scoreTick(w: WorldAdapter) {
  try {
    scores.sample(scoreWorldOf(w), [...w.villages.villages.values()].filter((v) => v.complete));
  } catch (e) {
    console.error('[scorecard] sample failed:', e);
  }
}
function startScores(w: WorldAdapter) {
  if (scoresFor) return;
  scoresFor = w;
  scoreTick(w);
  setInterval(() => scoreTick(w), 60_000).unref();
}

/** #80: each complete village's scorecard view, its busy from the utilisation clock (its members' mean a 10-minute point). */
export function scorecards(w: WorldAdapter) {
  const out: Record<string, ReturnType<typeof scorecardView>> = {};
  const now = Date.now();
  for (const v of w.villages.villages.values()) {
    const xs = scores.of(v.name);
    if (!xs.length) continue;
    const start = xs[0].t;
    const points = Math.max(1, Math.ceil((now - start) / 600_000) + 1);
    const util = w.utilisation?.(10, points);
    const names = w.agentList().filter((a) => a.village() === v).map((a) => a.name);
    const busy = Array.from({ length: Math.max(1, Math.ceil((xs[xs.length - 1].t - start) / 600_000)) }, (_, k) => {
      if (!util) return null;
      const p = Math.floor((start + k * 600_000 - util.start) / 600_000);
      const vals = names.map((n) => util.agents[n]?.[p]).filter((q): q is number => typeof q === 'number');
      return vals.length ? vals.reduce((s, q) => s + q, 0) / vals.length : null;
    });
    out[v.name] = scorecardView(xs, busy);
  }
  return out;
}

/** The tech trees, kept 30 s (the Tech tab asks every 30 s; a tree reads every recipe chain once). */
let treesAt = 0, trees: Record<string, TechTree> = {};
/** Each complete village's tech tree; {} for a world with no recipe planner (the sandbox). */
export function techTrees(w: WorldAdapter, now = Date.now()): Record<string, TechTree> {
  if (now - treesAt < 30_000) return trees;
  const m = (w as unknown as { materials?: { recipe?: RecipeOf } }).materials;
  if (!m?.recipe) return {};
  const recipeOf: RecipeOf = (n) => m.recipe!(n);
  trees = Object.fromEntries([...w.villages.villages.values()].filter((v) => v.complete).map((v) => [v.name, techTree(v, recipeOf)]));
  treesAt = now;
  return trees;
}

export async function handlePanel(w: WorldAdapter, req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  startScores(w);
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
  // #67: busy shares over time for the panel's graphs (?bin= minutes a point, ?points=)
  if (url.pathname === '/api/utilisation') {
    if (!w.utilisation) return sendJson(res, 404, { error: 'this world keeps no utilisation' }), true;
    const bin = Number(url.searchParams.get('bin') ?? 1), points = Number(url.searchParams.get('points') ?? 60);
    return sendJson(res, 200, w.utilisation(bin, points)), true;
  }
  if (url.pathname === '/api/scorecard') return sendJson(res, 200, scorecards(w)), true;
  if (url.pathname === '/api/techtree') return sendJson(res, 200, techTrees(w)), true;
  // The full last calls of one agent, for the panel's "what the executor / planner saw" tabs
  const calls = /^\/api\/agents\/([^/]+)\/calls$/.exec(url.pathname);
  if (calls) {
    const name = decodeURIComponent(calls[1]);
    const a = w.agentList().find((x) => x.name === name);
    if (!a) return sendJson(res, 404, { error: `no agent called ${name}` }), true;
    const st = a.brain?.status?.(a);
    return sendJson(res, 200, { name, planner: st?.lastPlannerCall ?? null, executor: st?.lastExecutorCall ?? null }), true;
  }
  // s34: an agent's recent model calls with its reasoning (in memory, the last 40), and what it carries
  const thoughts = /^\/api\/agents\/([^/]+)\/thoughts$/.exec(url.pathname);
  if (thoughts) {
    const name = decodeURIComponent(thoughts[1]);
    return sendJson(res, 200, { name, calls: recentCalls(name) }), true;
  }
  const memory = /^\/api\/agents\/([^/]+)\/mind$/.exec(url.pathname);
  if (memory) {
    const name = decodeURIComponent(memory[1]);
    const a = w.agentList().find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!a) return sendJson(res, 404, { error: `no agent ${name}` }), true;
    const tv = temperament(a.name);
    const vn = a.village()?.name;
    return sendJson(res, 200, {
      name: a.name, memory: capped(a.memory), temperament: { mode: TEMPERAMENT_MODE, vector: tv, weights: kindWeights(tv), persona: (typeof a.memory.persona === 'string' && a.memory.persona) || personaOf(a.name) },
      chores: w.choiceHistory?.(a) ?? [],
      // (G1: its journal)
      journal: vn ? agentMemory(vn, a.name) ?? null : null, clock: vn ? phaseLine(vn) : '',
      // (G2: its inbox, promises and requests, with the settings that made them)
      social: vn ? { mode: SOCIAL.mode, acts: ACTS.on, ...socialView(vn, a.name, Date.now()) } : null,
      character: { ...CHARACTER },
      // (G3: the village's rules in force, laws proposed, the council's lines)
      rules: vn && RULES.on ? { inForce: rulesInForce(vn).map((r) => ({ id: r.id, text: r.text, votes: r.votedBy })), laws: lawsOf(vn).slice(-10).reverse().map((l) => ({ id: l.id, by: l.by, text: l.text || l.what, status: l.status, backers: l.backers.length, opposers: l.opposers.length, refused: l.refused, result: l.result })), council: councilLine(vn, Date.now()) } : null,
      // (G5: the village's proposals, newest first)
      proposals: vn && PROPOSALS_ON ? allProposals(vn).slice(-12).reverse().map((p) => ({ id: p.id, by: p.by, kind: p.kind, what: p.what, status: p.status, check: p.check.verdict, backers: p.endorsements.length, against: p.objections.length, verdict: p.verdict ? `${p.verdict.decision}: ${p.verdict.reason}` : '' })) : null,
    }), true;
  }
  // G8: the ladder of ages (rungs, the current stage, who did each stage's work, ballots), and the iron work by member
  if (url.pathname === '/api/ladder') {
    const vn = url.searchParams.get('village') ?? '';
    const v = [...w.villages.villages.values()].find((x) => x.name.toLowerCase() === vn.toLowerCase());
    if (!v) return sendJson(res, 404, { error: `no village ${vn}` }), true;
    return sendJson(res, 200, { on: LADDER, ladder: ladderView(v), given: v.mine?.ironGiven ?? [], iron: v.mine?.iron ? { level: v.mine.iron.level ?? null, dug: v.mine.iron.dug, legs: v.mine.iron.legs.length, finished: v.mine.iron.finished ?? null } : null }), true;
  }
  // Character v2 (spec 14.2, S2): every member compact, one member in full since T, the village's series since T
  if (url.pathname === '/api/character') {
    const vn = url.searchParams.get('village') ?? '';
    const v = [...w.villages.villages.values()].find((x) => x.name.toLowerCase() === vn.toLowerCase());
    if (!v) return sendJson(res, 404, { error: `no village ${vn}` }), true;
    const names = w.agentList().filter((a) => a.village()?.name === v.name).map((a) => a.name);
    return sendJson(res, 200, villageView(v.name, names, (GOALS_ON ? goalsOf(v)?.of : undefined) ?? {}, Date.now())), true;
  }
  if (url.pathname === '/api/character/series') {
    const vn = url.searchParams.get('village') ?? '';
    return sendJson(res, 200, seriesView(vn, Number(url.searchParams.get('since') ?? 0) || 0, url.searchParams.get('matrix') === '1')), true;
  }
  const charOf = /^\/api\/agents\/([^/]+)\/character$/.exec(url.pathname);
  if (charOf) {
    const name = decodeURIComponent(charOf[1]);
    const a = w.agentList().find((x) => x.name.toLowerCase() === name.toLowerCase());
    const vn = a?.village()?.name;
    if (!a || !vn) return sendJson(res, 404, { error: `no member ${name}` }), true;
    return sendJson(res, 200, memberView(vn, a.name, Number(url.searchParams.get('since') ?? 0) || 0, Date.now())), true;
  }
  // G1: a village's members' memory (compact), and their rosters for scripts/respawn_agents.py
  const mem = /^\/api\/memory\/([^/]+)(\/roster)?$/.exec(url.pathname);
  if (mem) {
    const vn = decodeURIComponent(mem[1]);
    if (mem[2]) return sendJson(res, 200, { village: vn, members: rosterOf(vn) }), true;
    const vm = villageMemory(vn);
    return sendJson(res, 200, {
      village: vn, on: MEMORY.on, clock: phaseLine(vn), run: vm?.run ?? null, days: vm?.days ?? [],
      members: membersOf(vn).map((m) => ({
        name: m.name, intent: m.intent ?? null, today: m.today ?? null, notes: liveNotes(m), replaced: m.notes.filter((n) => n.replaced).length,
        log: m.log.length, days: m.days, kinds: m.kinds, nightDone: m.nightDone,
      })),
    }), true;
  }
  // A2: the agent's last chore decision in full (the menu with its facts, the order shown, the choice, the reason,
  // latency, tokens and the prompt), for the panel's Choice tab
  const decision = /^\/api\/agents\/([^/]+)\/decision$/.exec(url.pathname);
  if (decision) {
    const name = decodeURIComponent(decision[1]);
    const a = w.agentList().find((x) => x.name === name);
    if (!a) return sendJson(res, 404, { error: `no agent called ${name}` }), true;
    return sendJson(res, 200, { name, decision: w.lastDecision?.(a) ?? null }), true;
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
