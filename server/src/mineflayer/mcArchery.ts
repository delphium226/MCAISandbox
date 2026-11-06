/**
 * #217 step 6 (MC_BOWS, on; where monsters fight): bows and arrows for the watch and the hunt (the user's Q1: watchers on
 * the wall and hunters, so creepers die at range and the hunt brings gunpowder home). The aim is pure (a full-charge
 * arrow's flight: 3 blocks a tick, gravity 0.05 a tick, drag 0.99 a tick, simulated); a shot is never taken with a member
 * or a penned animal within 2 blocks of its line, nor through a solid block. Melee stays the reflex everywhere else.
 */
import { Vec3 } from 'vec3';
import type { Entity } from 'prismarine-entity';
import type { BotAgent } from './botAgent';
import type { Village } from '../village';
import { rawSetting } from '../settings';
import { modeSpec } from '../worldMode';
import { timeScale } from './mcRules';
import { storageContents, withdrawItems } from './mcStorage';
import { checkAbort, sleep } from './mcUtil';
import { noteShot } from './mcFlint';

const flagOn = (name: string) => !/^(off|0|false|no)$/i.test(rawSetting(name) ?? 'on');
/** Bows where monsters fight back (survival (d)). */
export const bowsOn = (): boolean => modeSpec().mobs && modeSpec().damage !== false && flagOn('MC_BOWS');
/** Shots are taken from MIN_RANGE to MAX_RANGE blocks (closer, the sword). */
export const MIN_RANGE = 6, MAX_RANGE = 24;
/** Arrows a member takes to keep watch or hunt with, and the fewest it shoots with. */
export const ARROWS_TAKEN = 16, ARROWS_MIN = 1;

// ---- The aim, pure ---------------------------------------------------------------------------------------------------

/** Where a full-charge arrow fired at `pitch` (radians, up positive) is when it has gone `dist` blocks out: its height, or null if it falls short. */
export function arrowHeightAt(pitch: number, dist: number, v0 = 3, g = 0.05, drag = 0.99): number | null {
  let x = 0, y = 0, vx = v0 * Math.cos(pitch), vy = v0 * Math.sin(pitch);
  for (let t = 0; t < 200; t++) {
    const nx = x + vx, ny = y + vy;
    if (nx >= dist) return y + ((ny - y) * (dist - x)) / (nx - x);
    x = nx;
    y = ny;
    vx *= drag;
    vy = vy * drag - g;
    if (y < -64) return null;
  }
  return null;
}

/** The low pitch (radians, up positive) that puts an arrow `dy` above (or below) the bow at `dist` out, or null out of reach. */
export function aimPitch(dist: number, dy: number): number | null {
  let lo = -Math.PI / 4, hi = Math.PI / 4;
  const hLo = arrowHeightAt(lo, dist), hHi = arrowHeightAt(hi, dist);
  if (hLo === null || hHi === null || hHi < dy || hLo > dy) return null;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2, h = arrowHeightAt(mid, dist);
    if (h === null || h < dy) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Whether point `p` lies within `r` of the segment from `a` to `b` (the friendly-fire check). */
export function nearLine(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, p: { x: number; y: number; z: number }, r = 2): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const L = dx * dx + dy * dy + dz * dz;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / L)) : 0;
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y, a.z + t * dz - p.z) <= r;
}

// ---- Shooting --------------------------------------------------------------------------------------------------------

export const archeryCounts = { shots: 0, hits: 0, kills: 0, held: 0, taken: 0, byMob: {} as Record<string, number>, assists: 0 };

/**
 * Bow kills: a mob hit by arrows and then finished with the sword (melee's kill) is the bow's assist. Train 22 and 23
 * counted 17 hits and 1 kill: every hit mob came within 6 blocks or out of sight and the sword (or another member) killed
 * it, uncounted. Mob id -> its arrow hits and the last one's time.
 */
const arrowHits = new Map<number, { n: number; t: number }>();
export function noteArrowHit(id: number, now = Date.now()): void {
  const h = arrowHits.get(id);
  arrowHits.set(id, { n: (h?.n ?? 0) + 1, t: now });
  if (arrowHits.size > 500) for (const [k, v] of arrowHits) if (now - v.t > 120000) arrowHits.delete(k);
}
/** The arrow hits a mob took in the last `ms` (0 if none): a kill after them is an assist (counted once). */
export function arrowHitsOn(id: number, now = Date.now(), ms = 60000): number {
  const h = arrowHits.get(id);
  return h && now - h.t <= ms ? h.n : 0;
}
export function noteAssist(id: number, now = Date.now()): number {
  const n = arrowHitsOn(id, now);
  arrowHits.delete(id);
  if (n) archeryCounts.assists++;
  return n;
}

/**
 * The target's motion a game tick, from its positions sampled through the draw (`samples`, oldest first, wall ms):
 * mineflayer's `entity.velocity` for a mob is only what the last velocity packet said (a walking zombie sends moves, not
 * velocities), so the lead was mostly nothing. Null with under 150 ms of samples.
 */
export function leadOf(samples: Array<{ t: number; x: number; z: number }>, scale = 1): { x: number; z: number } | null {
  if (samples.length < 2) return null;
  const a = samples[0], b = samples[samples.length - 1];
  const ticks = ((b.t - a.t) / 50) * Math.max(1, scale);
  if (b.t - a.t < 150 || ticks <= 0) return null;
  return { x: (b.x - a.x) / ticks, z: (b.z - a.z) / ticks };
}
const PASSIVE = new Set(['chicken', 'cow', 'sheep', 'pig', 'rabbit', 'goat', 'horse', 'villager', 'wandering_trader']);

const count = (a: BotAgent, name: string) => a.bot.inventory.items().filter((it) => it.name === name).reduce((n, it) => n + it.count, 0);
/** A bow and arrows carried. */
export const bowReady = (a: BotAgent): boolean => bowsOn() && count(a, 'bow') > 0 && count(a, 'arrow') >= ARROWS_MIN;

/** A bow and ARROWS_TAKEN arrows from storage when the member lacks them and storage holds them (the watch's and the hunt's start). */
export async function takeBow(a: BotAgent, v: Village, signal: AbortSignal): Promise<string> {
  if (!bowsOn() || !v.storage?.chests.length) return '';
  const st = storageContents(v);
  const want: Record<string, number> = {};
  if (!count(a, 'bow') && (st.bow ?? 0) > 0) want.bow = 1;
  const arrows = ARROWS_TAKEN - count(a, 'arrow');
  if (arrows > 0 && (st.arrow ?? 0) > 0) want.arrow = Math.min(arrows, st.arrow ?? 0);
  if (!Object.keys(want).length) return '';
  const r = await withdrawItems(a, v, want, signal).catch(() => ({ got: {} as Record<string, number> }));
  const got = Object.entries(r.got as Record<string, number>).filter(([, q]) => q > 0);
  if (got.some(([n]) => n === 'bow')) archeryCounts.taken++;
  return got.length ? `took ${got.map(([n, q]) => `${q} ${n}`).join(', ')}` : '';
}

/** Whether nothing solid stands between the bot's eye and the target's middle (a ray every 0.5 block). */
function inSight(a: BotAgent, from: Vec3, to: Vec3): boolean {
  const d = to.minus(from), L = d.norm();
  for (let s = 0.75; s < L - 0.5; s += 0.5) {
    const p = from.plus(d.scaled(s / L));
    const b = a.bot.blockAt(new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
    if (!b) return false;
    if (b.boundingBox === 'block' && !/_fence(_gate)?$|_wall$/.test(b.name)) return false;
  }
  return true;
}

/** Why a shot at `e` cannot be taken now ('' when it can): range, sight, a member or a penned animal near the line. */
export function shotBlocked(a: BotAgent, e: Entity): string {
  const eye = a.bot.entity.position.offset(0, 1.62, 0), aim = e.position.offset(0, (e.height ?? 1.8) * 0.6, 0);
  const d = Math.hypot(aim.x - eye.x, aim.z - eye.z);
  if (d < MIN_RANGE || d > MAX_RANGE) return `out of range (${Math.round(d)})`;
  if (!inSight(a, eye, aim)) return 'not in sight';
  for (const o of Object.values(a.bot.entities)) {
    if (o === e || o === a.bot.entity) continue;
    const friend = o.type === 'player' || PASSIVE.has(o.name ?? '');
    if (friend && nearLine(eye, aim, o.position.offset(0, 0.9, 0), 2)) return `${o.type === 'player' ? o.username ?? 'a member' : `a ${o.name}`} near the line`;
  }
  return '';
}

/**
 * One shot at `e`: the bow in hand, aimed (its motion led by the flight time), drawn ~1 s (game time), released. Returns
 * whether it hit (the target's health fell or it died within ~1.5 s), or why no shot was taken.
 */
export async function shootAt(a: BotAgent, e: Entity, signal: AbortSignal): Promise<{ shot: boolean; hit: boolean; killed: boolean; why?: string }> {
  const why = shotBlocked(a, e);
  if (why) {
    archeryCounts.held++;
    return { shot: false, hit: false, killed: false, why };
  }
  const bow = a.bot.inventory.items().find((it) => it.name === 'bow');
  if (!bow || count(a, 'arrow') < ARROWS_MIN) return { shot: false, hit: false, killed: false, why: 'no bow and arrows' };
  if (a.bot.heldItem?.name !== 'bow') await a.bot.equip(bow, 'hand');
  checkAbort(signal);
  const ms = Math.max(400, 1100 / Math.max(1, timeScale()));
  const hp0 = (e.health as number | undefined) ?? (e.metadata?.[9] as unknown as number | undefined) ?? 20;
  // (aimed again every 50 ms through the draw, led by the target's motion over the flight's ticks: step 0's probe hit a
  // walking zombie 0 of 12 aimed once before the draw, 7 of 7 aimed again through it; the motion from its positions over
  // the last 400 ms, leadOf)
  const samples: Array<{ t: number; x: number; z: number }> = [];
  const aimNow = async (): Promise<boolean> => {
    const eye = a.bot.entity.position.offset(0, 1.62, 0);
    const now = Date.now();
    samples.push({ t: now, x: e.position.x, z: e.position.z });
    while (samples.length > 2 && now - samples[0].t > 400) samples.shift();
    const vel = leadOf(samples, timeScale()) ?? e.velocity ?? new Vec3(0, 0, 0);
    let aim = e.position.offset(0, (e.height ?? 1.8) * 0.5, 0);
    const ticks = Math.hypot(aim.x - eye.x, aim.z - eye.z) / 2.7;
    aim = aim.offset(vel.x * ticks, 0, vel.z * ticks);
    const pitch = aimPitch(Math.hypot(aim.x - eye.x, aim.z - eye.z), aim.y - eye.y);
    if (pitch === null) return false;
    await a.bot.look(Math.atan2(-(aim.x - eye.x), -(aim.z - eye.z)), pitch, true);
    return true;
  };
  a.bot.activateItem();
  try {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (!(await aimNow())) return { shot: false, hit: false, killed: false, why: 'out of reach' };
      await sleep(50, signal);
    }
    if (!(await aimNow())) return { shot: false, hit: false, killed: false, why: 'out of reach' };
  } finally {
    a.bot.deactivateItem();
  }
  archeryCounts.shots++;
  // (#225: where the village shot from, for the sweep of the arrows that missed)
  noteShot(a.village()?.name, a.bot.entity.position);
  const t0 = Date.now();
  let hit = false, killed = false, hurt = false;
  // (the hurt event as well as the health: a mob's health is not always sent to players)
  const onHurt = (x: Entity) => {
    if (x.id === e.id) hurt = true;
  };
  a.bot.on('entityHurt', onHurt);
  try {
    while (Date.now() - t0 < 1500) {
      await sleep(100, signal);
      if (!a.bot.entities[e.id] || e.isValid === false) {
        killed = true;
        hit = true;
        break;
      }
      const hp = (e.health as number | undefined) ?? (e.metadata?.[9] as unknown as number | undefined);
      if (hurt || (typeof hp === 'number' && hp < hp0)) {
        hit = true;
        break;
      }
    }
  } finally {
    a.bot.removeListener('entityHurt', onHurt);
  }
  if (hit) archeryCounts.hits++;
  if (hit && !killed) noteArrowHit(e.id);
  if (killed) {
    archeryCounts.kills++;
    archeryCounts.byMob[e.name ?? '?'] = (archeryCounts.byMob[e.name ?? '?'] ?? 0) + 1;
  }
  return { shot: true, hit, killed };
}

/**
 * Shoots at `e` until it dies, leaves range or sight, `max` shots or the arrows run out; a line for the log. A shot held
 * for a friend near the line waits a second once and tries again.
 */
export async function shootDown(a: BotAgent, e: Entity, signal: AbortSignal, max = 6): Promise<{ text: string; killed: boolean; shots: number }> {
  let shots = 0, hits = 0, held = 0;
  while (shots < max && a.bot.entities[e.id] && e.isValid !== false && count(a, 'arrow') >= ARROWS_MIN) {
    checkAbort(signal);
    const r = await shootAt(a, e, signal);
    if (!r.shot) {
      if (/near the line/.test(r.why ?? '') && held++ < 1) {
        await sleep(1000, signal);
        continue;
      }
      return { text: `held fire at the ${e.name} (${r.why}) after ${shots} shots, ${hits} hits`, killed: false, shots };
    }
    shots++;
    if (r.hit) hits++;
    if (r.killed) return { text: `shot the ${e.name} dead (${shots} arrows, ${hits} hits)`, killed: true, shots };
  }
  return { text: `shot ${shots} arrows at the ${e.name}, ${hits} hits${a.bot.entities[e.id] ? '' : ' (it went)'}`, killed: false, shots };
}
