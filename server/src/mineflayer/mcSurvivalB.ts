/**
 * Survival stage (b) (MC_WORLD_MODE=easy and normal, worldMode.ts; spec runs/2026-10-31/survival/spec_b.md): the
 * after-burn (a member still burning after fire or lava walks into water within 6 blocks), the eating reflex (real
 * hunger: a member carrying food eats it when the bar runs low), the night's sleeper (one member asleep in its bed ends
 * the night for all, players_sleeping_percentage 1) and the spawnpoint's safety check (damage modes). The reflexes run
 * in botAgent's reflex slot (`runReflex`), the night tick from the world's tick.
 */
import { Vec3 } from 'vec3';
import type { BotAgent } from './botAgent';
import type { Village } from '../village';
import { FOOD_POINTS } from '../appetite';
import { nightsFall, realHunger } from '../worldMode';
import { basicsOf, homeOf } from './mcHome';
import { at, goals, syncInventory, walk } from './mcUtil';
import { hazardOf, safeCellNear } from './mcHazard';

// ---------------------------------------------------------------------------------------------
// Pure parts (scripts/checks/world_mode.mts)
// ---------------------------------------------------------------------------------------------

/** The night as a bed sees it (Mineflayer's sleep window, in ticks of the day). */
export const NIGHT = { from: 12541, to: 23458 };
export const isNight = (t: number | null | undefined): boolean => typeof t === 'number' && t >= NIGHT.from && t <= NIGHT.to;

/** Planting stock: eaten from a pack only when starving (the fields' slots keep 8 of each). */
const SEED_FOOD = new Set(['carrot', 'potato', 'beetroot']);

/**
 * What a member carrying `items` eats now (food `food`, health `health`), or null: at 14 or less, or below 18 while hurt
 * (under 14 health: vanilla heals only at 18 or more); planting stock only at 6 or less; raw fish and rotten flesh never
 * (not in FOOD_POINTS); the cake is a block. The item that fills the bar best without spilling over, then the bigger.
 */
export function packBite(items: Record<string, number>, food: number, health: number): string | null {
  if (!(food <= 14 || (food < 18 && health < 14))) return null;
  const room = 20 - food;
  let best: { item: string; over: number; pts: number } | null = null;
  for (const [item, n] of Object.entries(items)) {
    const pts = FOOD_POINTS[item];
    if (!n || pts === undefined || item === 'cake' || (SEED_FOOD.has(item) && food > 6)) continue;
    const over = Math.max(0, pts - room);
    if (!best || over < best.over || (over === best.over && pts > best.pts) || (over === best.over && pts === best.pts && item < best.item)) best = { item, over, pts };
  }
  return best?.item ?? null;
}

/** A block as the safety tests read it. */
export type Cell = { name: string; boundingBox: string } | null;
const HOT = new Set(['lava', 'fire', 'soul_fire', 'campfire', 'soul_campfire', 'magma_block']);

/**
 * A cell to respawn or stand on: feet and head not solid and free of water, lava and fire, no lava or fire beside the
 * feet, solid ground below that is not magma. Null when a block is not loaded (unknown: the caller keeps what it had).
 */
export function cellSafe(read: (p: Vec3) => Cell, p: Vec3): boolean | null {
  const below = read(p.offset(0, -1, 0)), f = read(p), h = read(p.offset(0, 1, 0));
  if (!below || !f || !h) return null;
  if (below.boundingBox !== 'block' || below.name === 'magma_block') return false;
  const bad = (c: Cell) => !!c && (c.boundingBox === 'block' || c.name === 'water' || HOT.has(c.name));
  if (bad(f) || bad(h)) return false;
  return ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([x, z]) => { const n = read(p.offset(x, 0, z))?.name ?? ''; return n === 'lava' || HOT.has(n); });
}

/** The home cell if safe, else the nearest safe cell within `r` blocks of it (null: none, or not loaded). */
export function safeSpawnCell(read: (p: Vec3) => Cell, home: Vec3, r = 6): { cell: Vec3; moved: boolean } | null {
  const here = cellSafe(read, home);
  if (here === null) return null;
  if (here) return { cell: home, moved: false };
  let best: Vec3 | null = null, bd = Infinity;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const d = dx * dx + dz * dz + dy * dy * 2;
        if (d >= bd || (!dx && !dy && !dz)) continue;
        const p = home.offset(dx, dy, dz);
        if (cellSafe(read, p)) { best = p; bd = d; }
      }
  return best ? { cell: best, moved: true } : null;
}

/** What made the home cell unsafe, for the log. */
export function unsafeWhy(read: (p: Vec3) => Cell, p: Vec3): string {
  const f = read(p), h = read(p.offset(0, 1, 0)), b = read(p.offset(0, -1, 0));
  for (const c of [f, h]) if (c && (c.name === 'water' || HOT.has(c.name))) return `${c.name} at the cell`;
  if (f?.boundingBox === 'block' || h?.boundingBox === 'block') return `${f?.boundingBox === 'block' ? f.name : h!.name} in the cell`;
  if (b?.name === 'magma_block' || b?.boundingBox !== 'block') return `no ground (${b?.name ?? 'unknown'}) below`;
  return 'lava or fire beside it';
}

/** The sleeper to send: the nearest to its bed of those not tried twice tonight and free (not in a reflex). */
export function pickSleeper<T extends { name: string; dist: number; free: boolean }>(cands: T[], tries: Map<string, number>): T | null {
  return cands.filter((c) => c.free && (tries.get(c.name) ?? 0) < 2).sort((p, q) => p.dist - q.dist || p.name.localeCompare(q.name))[0] ?? null;
}

// ---------------------------------------------------------------------------------------------
// The reflexes (botAgent.survival calls survivalB every tick in damage modes)
// ---------------------------------------------------------------------------------------------

type Track = { fireAt: number; health: number; hurtAt: number; bitAt: number; burnAt: number };
const tracks = new WeakMap<BotAgent, Track>();

const name = (a: BotAgent, p: Vec3) => a.bot.blockAt(p)?.name ?? '';

/** The entity's on-fire flag (metadata 0, bit 0x01). */
function onFireFlag(a: BotAgent): boolean {
  const md = (a.bot.entity as unknown as { metadata?: unknown[] }).metadata?.[0];
  return typeof md === 'number' && (md & 1) === 1;
}

/** Stage (b)'s reflexes, every tick when damage is on (cheap: a flag and a few numbers until one fires). */
export function survivalB(a: BotAgent): void {
  const bot = a.bot;
  const now = Date.now();
  const t = tracks.get(a) ?? { fireAt: 0, health: bot.health ?? 20, hurtAt: 0, bitAt: 0, burnAt: 0 };
  tracks.set(a, t);
  const hp = bot.health ?? 20;
  const hurt = hp < t.health;
  if (hurt) t.hurtAt = now;
  t.health = hp;
  const feet = bot.entity.position.floored();
  const inHot = HOT.has(name(a, feet)) || HOT.has(name(a, feet.offset(0, 1, 0))) || (bot.entity as unknown as { isInLava?: boolean }).isInLava;
  // (a fire touching the member from the next cell sets it alight too, and hazardOf reads only its own cells: Finn burned
  // to death pressed against one in the stage (b) probe. Read only on a hurt, so a tick costs nothing more)
  if (inHot || (hurt && hotBeside(a, feet))) t.fireAt = now;
  // (the fire and air reflexes are botAgent's: nothing here while one runs or the member stands in the fire)
  if (inHot || a.inReflex() || hazardOf(a)) return;
  // The after-burn: out of the fire or lava but still burning (the flag, or hurt within 2 s of being in or beside it):
  // into water within 16 blocks, else to a safe cell away from the fire while one is beside it
  const wet = (bot.entity as unknown as { isInWater?: boolean }).isInWater;
  if (!wet && now - t.burnAt > 4000 && (onFireFlag(a) || (now - t.fireAt < 10000 && now - t.hurtAt < 2000))) {
    t.burnAt = now;
    // (#189: vanilla puts a burning member out only in water or rain, and after lava it burns ~8-15 s, a heart a second:
    // Gus left the lava at 7 health with no water within 6 and burned to death. So water within 16, nearest first; else,
    // out of the fire's reach, nothing here, so the eating reflex below can heal it: a walk "away from the fire" then only
    // spent the seconds. A carried water bucket poured at the feet was tried live and left no water: Mineflayer's use of it
    // emptied the bucket and placed nothing, three times)
    const w = waterNear(a, 16);
    const c = w || !hotBeside(a, feet) ? null : safeCellNear(a);
    if (!w && !c) console.log(`[hazard] ${a.name} burning at ${at(feet)} (health ${Math.round(hp)}): no water within 16 blocks; it burns out (eating if it can)`);
    if (w || c) {
      console.log(`[hazard] ${a.name} burning at ${at(feet)} (health ${Math.round(hp)}): ${w ? `to the water at ${at(w)}` : `away from the fire to ${at(c!)}`}`);
      a.runReflex('burning', async (signal) => {
        const to = (w ?? c)!;
        await walk(a, new goals.GoalBlock(to.x, to.y, to.z), w ? 'into the water' : 'away from the fire', signal, w ? 8000 : 5000);
        return w ? `into the water at ${at(to)}` : `away from the fire to ${at(to)}`;
      });
      return;
    }
  }
  // The eating reflex (real hunger), every 2 s at most
  if (realHunger() && now - t.bitAt > 2000) {
    t.bitAt = now;
    const items: Record<string, number> = {};
    for (const it of bot.inventory?.items() ?? []) items[it.name] = (items[it.name] ?? 0) + it.count;
    const item = packBite(items, bot.food ?? 20, hp);
    if (item) {
      const before = bot.food ?? 20;
      a.runReflex('eat', async () => {
        await eatOne(a, item);
        return `ate 1 ${item.replace(/_/g, ' ')} it carried (food ${before} -> ${bot.food ?? '?'})`;
      }, (msg) => console.log(`[food] ${a.name} ${msg}`));
    }
  }
}

/** Fire, lava or magma in a cell beside the feet or head (or under the feet). */
function hotBeside(a: BotAgent, feet: Vec3): boolean {
  if (HOT.has(name(a, feet.offset(0, -1, 0)))) return true;
  for (const dy of [0, 1]) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) if (HOT.has(name(a, feet.offset(dx, dy, dz)))) return true;
  return false;
}

/** The nearest water to stand in within r blocks (feet in it, head in water or air), or null. */
function waterNear(a: BotAgent, r: number): Vec3 | null {
  const p0 = a.bot.entity.position.floored();
  let best: Vec3 | null = null, bd = Infinity;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const d = dx * dx + dz * dz + dy * dy;
        if (d >= bd || d > r * r) continue;
        const p = p0.offset(dx, dy, dz);
        if (name(a, p) !== 'water') continue;
        const h = a.bot.blockAt(p.offset(0, 1, 0));
        if (!h || (h.name !== 'water' && h.boundingBox === 'block')) continue;
        best = p;
        bd = d;
      }
  return best;
}

/** Eat one `item` from the inventory (to hand, then consume: vanilla refuses at a full bar). */
export async function eatOne(a: BotAgent, item: string): Promise<void> {
  const it = a.bot.inventory.items().find((i) => i.name === item);
  if (!it) throw new Error(`no ${item} carried`);
  await a.bot.equip(it, 'hand');
  await a.bot.consume();
}

/** Eat up to `n` of `item` (real hunger's meal): stops at a full bar; returns how many went down. */
export async function eatItems(a: BotAgent, item: string, n: number, signal: AbortSignal): Promise<number> {
  await syncInventory(a).catch(() => undefined);
  let eaten = 0;
  for (let i = 0; i < n && !signal.aborted && (a.bot.food ?? 20) < 20; i++) {
    try {
      await eatOne(a, item);
      eaten++;
    } catch (e) {
      if (eaten) break;
      throw e;
    }
  }
  return eaten;
}

/** The home cell to set the spawnpoint at (damage modes): home if safe, the nearest safe cell, or home when unknown. */
export function spawnCellFor(a: BotAgent, h: { x: number; y: number; z: number }): { x: number; y: number; z: number; why?: string } {
  const read = (p: Vec3): Cell => {
    const b = a.bot.blockAt(p);
    return b ? { name: b.name, boundingBox: b.boundingBox } : null;
  };
  const home = new Vec3(h.x, h.y, h.z);
  const s = safeSpawnCell(read, home);
  if (!s || !s.moved) return h;
  return { x: s.cell.x, y: s.cell.y, z: s.cell.z, why: unsafeWhy(read, home) };
}

// ---------------------------------------------------------------------------------------------
// The night (easy, normal): one sleeper ends it for all
// ---------------------------------------------------------------------------------------------

type BedAt = { x: number; y: number; z: number };
const night = { checkedAt: 0, on: false, since: 0, sleeper: '' as string, tries: new Map<string, number>(), retryAt: 0, noBed: false, nights: 0, slept: 0 };

/** The bed in a member's own house, if one was placed (home basics' record and cell). */
export function bedOf(a: BotAgent): BedAt | null {
  // (the record first: most members own no house with a bed, and the cells cost a furnishing lookup)
  const v = a.village();
  if (!v || !v.structures.some((s) => s.owner === a.name && basicsOf(v)[s.id]?.bed)) return null;
  const h = homeOf(a);
  if (typeof h === 'string') return null;
  const cell = h.P.basics.bed;
  if (!cell || !basicsOf(h.v)[h.P.structure.id]?.bed) return null;
  return { x: cell.x, y: cell.y, z: cell.z };
}

/** The night's counts, for the status and the report: nights begun and nights a sleeper ended. */
export const nightCounts = () => ({ nights: night.nights, slept: night.slept });

/**
 * Every 5 s from the world's tick (nights only): at night with nobody asleep and no sleeper on its way, the nearest free
 * bed owner is sent to bed (`sleepIn`, a reflex); one that fails is tried again at most once a night, the next after
 * 20 s. No bed in any village: logged once a night, and the night runs its length.
 */
export function nightTick(agents: Iterable<BotAgent>, villageOf: (a: BotAgent) => Village | undefined): void {
  if (!nightsFall()) return;
  const now = Date.now();
  if (now - night.checkedAt < 5000) return;
  night.checkedAt = now;
  const all = [...agents].filter((a) => a.bot.entity && villageOf(a));
  const t = all.find((a) => typeof a.bot.time?.timeOfDay === 'number')?.bot.time.timeOfDay;
  if (t === undefined) return;
  if (!isNight(t)) {
    if (night.on) {
      console.log(`[night] the night ended after ${Math.round((now - night.since) / 1000)} s${night.sleeper ? ` (${night.sleeper} slept)` : ''}`);
      if (night.sleeper) night.slept++;
    }
    Object.assign(night, { on: false, sleeper: '', noBed: false, retryAt: 0 });
    night.tries.clear();
    return;
  }
  if (!night.on) {
    Object.assign(night, { on: true, since: now, sleeper: '', noBed: false, retryAt: 0 });
    night.nights++;
    night.tries.clear();
    console.log(`[night] dusk (time ${t})`);
  }
  if (all.some((a) => a.bot.isSleeping) || (night.sleeper && all.some((a) => a.name === night.sleeper && a.inReflex())) || now < night.retryAt) return;
  const cands = all.map((a) => {
    const bed = bedOf(a);
    return bed ? { a, bed, name: a.name, free: !a.inReflex(), dist: a.bot.entity.position.distanceTo(new Vec3(bed.x, bed.y, bed.z)) } : null;
  }).filter((c): c is NonNullable<typeof c> => !!c);
  if (!cands.length) {
    if (!night.noBed) console.log('[night] no member has a bed to sleep in: the night runs its length');
    night.noBed = true;
    return;
  }
  const s = pickSleeper(cands, night.tries);
  if (!s) return;
  night.tries.set(s.name, (night.tries.get(s.name) ?? 0) + 1);
  night.sleeper = s.name;
  console.log(`[night] ${s.name} to bed at ${at(s.bed)} (${Math.round(s.dist)} blocks)`);
  const started = s.a.runReflex('sleep', (signal) => sleepIn(s.a, s.bed, signal), (msg) => console.log(`[night] ${s.name} ${msg}`), (e) => {
    console.log(`[night] ${s.name} could not sleep: ${e.message}`);
    night.sleeper = '';
    night.retryAt = Date.now() + 20000;
  });
  if (!started) night.sleeper = '';
}

/** To the bed (90 s), into it, and asleep until the night passes (60 s at most); the spawnpoint back at home after. */
async function sleepIn(a: BotAgent, bed: BedAt, signal: AbortSignal): Promise<string> {
  const p = new Vec3(bed.x, bed.y, bed.z);
  if (a.bot.entity.position.distanceTo(p) > 2.5) await walk(a, new goals.GoalNear(bed.x, bed.y, bed.z, 2), 'your bed', signal, 90000, { scaffold: false });
  const b = a.bot.blockAt(p);
  if (!b || !/_bed$/.test(b.name)) throw new Error(`no bed at ${at(bed)} (${b?.name ?? 'not loaded'})`);
  if (!isNight(a.bot.time.timeOfDay)) return 'reached its bed as the day came';
  const t0 = Date.now();
  await a.bot.sleep(b);
  try {
    await new Promise<void>((ok) => {
      const done = () => { clearTimeout(cap); a.bot.removeListener('wake', done); signal.removeEventListener('abort', done); ok(); };
      const cap = setTimeout(done, 60000);
      a.bot.once('wake', done);
      signal.addEventListener('abort', done);
    });
  } finally {
    if (a.bot.isSleeping) await a.bot.wake().catch(() => undefined);
    a.resetSpawnpoint();
  }
  a.pushEvent('system', 'You slept in your bed and the night passed.');
  return `slept in its bed at ${at(bed)} for ${Math.round((Date.now() - t0) / 1000)} s`;
}
