/**
 * Survival stage (c) (MC_WORLD_MODE=hostile and normal, worldMode.ts; spec runs/2026-10-31/survival/spec_c.md): hostile
 * mobs and the combat reflex. Per bot, a list of hostile mobs kept from entitySpawn/entityGone (no scan of every entity a
 * tick); the reflex, in botAgent's reflex slot: flee creepers, fight back when armed, run to the storage hut when not (and
 * take a sword there), defend a member within 8 blocks, eat when hurt; melee that steers directly within 5 blocks (no A*
 * in the fight: the research's loop cost) with the weapon's cooldown by time scale; armour put on from the pack. Code, like
 * the hazard reflexes: a zombie kills an unarmed member in 20-40 s, a model turn takes up to 20. The brain only hears
 * afterwards, and never wakes for it.
 */
import { Vec3 } from 'vec3';
import type { Entity } from 'prismarine-entity';
import type { BotAgent } from './botAgent';
import type { Village } from '../village';
import { rawSetting } from '../settings';
import { FOOD_POINTS, REGEN_FOOD, topUpMeal } from '../appetite';
import { modeSpec } from '../worldMode';
import { timeScale } from './mcRules';
import { bedOf, packBite, eatOne, setNightHold } from './mcSurvivalB';
import { surfaceAt } from './mcBuild';
import { STORAGE_SKILLS, storageContents, withdrawItems } from './mcStorage';
import { noteHunted } from './mcMaterials';
import { pickUpDrops } from './mcSurvival';
import { at, checkAbort, goals, sleep, walk } from './mcUtil';
import { MAX_RANGE, MIN_RANGE, bowReady, bowsOn, noteAssist, shootDown, takeBow } from './mcArchery';
import { pickUpArrows } from './mcFlint';

// ---------------------------------------------------------------------------------------------
// Pure parts (scripts/checks/combat_unit.mts)
// ---------------------------------------------------------------------------------------------

/** Mobs the reflex fights (creepers are fled from instead). */
export const HOSTILE = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged', 'spider', 'cave_spider', 'witch', 'pillager', 'vindicator', 'slime', 'silverfish', 'phantom', 'creaking', 'enderman']);
export const isHostile = (name: string | undefined): boolean => !!name && (HOSTILE.has(name) || name === 'creeper');

/** Weapons, best first (mcSurvival's attack and the reflex). */
export const WEAPONS = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'golden_sword', 'wooden_sword', 'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'golden_axe', 'wooden_axe'];
export const SWORDS = WEAPONS.filter((w) => w.endsWith('_sword'));
export const isWeapon = (name: string): boolean => /_(sword|axe)$/.test(name);

/** The stage (c) reflex is on (mob modes, MC_COMBAT not off). */
export function fightsMobs(): boolean {
  return modeSpec().mobs && !/^(off|0|false|no)$/i.test(rawSetting('MC_COMBAT') ?? 'on');
}
/** Swords and armour are goods and members arm at dusk (mob modes, MC_ARMS not off). */
export function armsOn(): boolean {
  return modeSpec().mobs && !/^(off|0|false|no)$/i.test(rawSetting('MC_ARMS') ?? 'on');
}

/**
 * Wall-clock ms between swings for full damage: vanilla's attack speed (sword 1.6 a second; axes 0.8-1.0 by material;
 * a fist 4, whose damage does not grow with the charge), divided by the time scale (the server's ticks run faster).
 */
export function cooldownMs(weapon: string | undefined, scale = 1): number {
  let ms = 250;
  if (weapon?.endsWith('_sword')) ms = 625;
  else if (weapon?.endsWith('_axe')) ms = /^(wooden|stone)_/.test(weapon) ? 1250 : /^iron_/.test(weapon) ? 1111 : 1000;
  return Math.round(ms / Math.max(1, scale));
}

/** Armour by slot and tier (worst first). */
export const ARMOUR_TIERS = ['leather', 'golden', 'chainmail', 'iron', 'diamond', 'netherite'];
export const ARMOUR_SLOTS = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' } as const;
export type ArmourDest = (typeof ARMOUR_SLOTS)[keyof typeof ARMOUR_SLOTS];
const ARMOUR = /^(leather|golden|chainmail|iron|diamond|netherite)_(helmet|chestplate|leggings|boots)$/;
export const isArmour = (name: string): boolean => ARMOUR.test(name);
const tierOf = (name: string | undefined): number => {
  const m = name ? ARMOUR.exec(name) : null;
  return m ? ARMOUR_TIERS.indexOf(m[1]) : -1;
};

/** What to put on: per slot, the best piece carried that beats the one worn (dest -> item). */
export function armourToWear(carried: string[], worn: Partial<Record<ArmourDest, string | undefined>>): Partial<Record<ArmourDest, string>> {
  const out: Partial<Record<ArmourDest, string>> = {};
  for (const n of carried) {
    const m = ARMOUR.exec(n);
    if (!m) continue;
    const dest = ARMOUR_SLOTS[m[2] as keyof typeof ARMOUR_SLOTS];
    if (tierOf(n) > Math.max(tierOf(worn[dest]), tierOf(out[dest]))) out[dest] = n;
  }
  return out;
}

export type Seen = { id: number; name: string; dist: number };
/**
 * #228: mobs that hurt from range (potions, arrows): a witch killed two members by day 58-61 blocks from home with no
 * fight or flight, the reflex acting only on a mob within 5. Within RANGED_REACH of a member hurt in the last 3 s, with no
 * other hostile within 5, the reflex shoots (a bow), closes and fights (armed, above RANGED_FIGHT), or runs.
 */
export const RANGED = new Set(['witch', 'skeleton', 'stray', 'bogged', 'pillager']);
export const RANGED_REACH = 16, RANGED_FIGHT = 10;
/**
 * #235: endermen. Train 24 A2 lost 3 members to them (two inside the ring by the storage hut): a member who looked at one
 * angered it, fought it with a stone sword at 14 health (40 health, 7 a hit) and ran to the hut, where it followed by
 * teleporting. Now no one starts a fight with one (the watch, bows, defenders and the shelter's fight pass them by), the
 * gaze guard turns a member's eyes off any within ENDER_SIGHT, and one that attacks (hurt, an enderman within 5 and no
 * other hostile there) is run from: into shallow water when a pool is near (endermen never enter water), else away, never
 * to the hut; an armed member hit again within ENDER_CORNERED of the run fights back, cornered.
 */
export const ENDERMAN = 'enderman';
export const ENDER_EYE = 2.55, ENDER_SIGHT = 64, ENDER_CORNERED = 15000, ENDER_RUN_MS = 8000;
const fightable = (name: string): boolean => name !== 'creeper' && name !== ENDERMAN;
/** The unit view vector for a mineflayer yaw and pitch (yaw 0 faces -z; pitch up is positive). */
export const viewOf = (yaw: number, pitch: number) => ({ x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });
/**
 * Whether eyes at `eye` with this yaw and pitch look at an enderman's eyes at `mob` (vanilla's isLookingAtMe: the cosine
 * to its eyes above 1 - tol / distance; vanilla's tol is 0.025, the guard uses a wider one so it turns away first).
 */
export function staresAt(eye: { x: number; y: number; z: number }, yaw: number, pitch: number, mob: { x: number; y: number; z: number }, tol = 0.025): boolean {
  const dx = mob.x - eye.x, dy = mob.y - eye.y, dz = mob.z - eye.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.01) return true;
  const v = viewOf(yaw, pitch);
  return (v.x * dx + v.y * dy + v.z * dz) / d > 1 - tol / d;
}
/** The pitch the gaze guard turns to: 0.6 rad off the line to the enderman's eyes (down when they are above). */
export function avertPitch(eye: { x: number; y: number; z: number }, mob: { x: number; y: number; z: number }): number {
  const up = Math.atan2(mob.y - eye.y, Math.hypot(mob.x - eye.x, mob.z - eye.z));
  return Math.max(-1.5, Math.min(1.5, up >= 0 ? up - 0.6 : up + 0.6));
}
/**
 * A refuge from an enderman: the nearest standable water cell with water on all 8 sides at its level (an enderman beside
 * the pool stays out of reach) and ground under it (no swim), within `r` blocks of `p`; null when none.
 */
export function waterRefuge(read: (p: Vec3) => Cell, p: Vec3, r = 12): Vec3 | null {
  const wet = (q: Vec3) => read(q)?.name === 'water';
  let best: Vec3 | null = null, bestD = Infinity;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > r || d >= bestD) continue;
        const q = new Vec3(Math.floor(p.x) + dx, Math.floor(p.y) + dy, Math.floor(p.z) + dz);
        if (!wet(q) || read(q.offset(0, -1, 0))?.boundingBox !== 'block' || read(q.offset(0, 1, 0))?.boundingBox === 'block') continue;
        let pool = true;
        for (let ax = -1; ax <= 1 && pool; ax++) for (let az = -1; az <= 1 && pool; az++) if (!wet(q.offset(ax, 0, az))) pool = false;
        if (pool) { best = q; bestD = d; }
      }
  return best;
}
export type Decision =
  | { kind: 'flee'; mob: Seen }
  | { kind: 'evade'; mob: Seen }
  | { kind: 'fight'; mob: Seen; cornered?: boolean; ranged?: boolean }
  | { kind: 'shelter'; mob: Seen; ranged?: boolean }
  | { kind: 'defend'; mob: Seen; member: string }
  | null;

/**
 * The reflex's choice (spec 2), in order: a creeper within 5 is fled; hurt in the last 3 s with a hostile within 5: an
 * armed member above 8 health fights; an unarmed one goes for a sword when storage within 64 blocks holds one, else fights
 * with its fists above 10 health (a fist hits 4 times a second: half a stone sword), else runs; a member who ran in the
 * last 5 s fights instead, cornered (the live pair's storage camp: running in place at the hut while a zombie hit). An
 * armed member above 12 health defends a member within 8 blocks who was hurt in the last 3 s with a hostile within 5 of
 * them, unless 2 already defend against that mob.
 */
export function decide(me: { health: number; armed: boolean; hurtAgo: number; mobs: Seen[]; swordNear?: boolean; ranAgo?: number; bow?: boolean },
  members: Array<{ name: string; dist: number; hurtAgo: number; mobs: Seen[] }>, defenders: ReadonlyMap<number, ReadonlySet<string>>, reach = 8): Decision {
  const near = [...me.mobs].sort((p, q) => p.dist - q.dist);
  const creeper = near.find((m) => m.name === 'creeper' && m.dist < 5);
  if (creeper) return { kind: 'flee', mob: creeper };
  const close = near.find((m) => fightable(m.name) && m.dist < 5);
  // (#235: an enderman within 5 with no other hostile there is what hurt the member: run, or fight back when cornered)
  const ender = close ? undefined : near.find((m) => m.name === ENDERMAN && m.dist < 5);
  if (ender && me.hurtAgo < 3000) {
    if (me.armed && (me.ranAgo ?? Infinity) < ENDER_CORNERED) return { kind: 'fight', mob: ender, cornered: true };
    return { kind: 'evade', mob: ender };
  }
  if (close && me.hurtAgo < 3000) {
    const mayRun = (me.ranAgo ?? Infinity) >= 5000;
    if (me.armed && me.health > 8) return { kind: 'fight', mob: close };
    if (!me.armed && me.swordNear && mayRun) return { kind: 'shelter', mob: close };
    if (!me.armed && me.health > 10) return { kind: 'fight', mob: close };
    return mayRun ? { kind: 'shelter', mob: close } : { kind: 'fight', mob: close, cornered: true };
  }
  // (#228: hurt from range: the nearest witch, skeleton or pillager within RANGED_REACH)
  const ranged = near.find((m) => RANGED.has(m.name) && m.dist <= RANGED_REACH);
  if (ranged && me.hurtAgo < 3000) {
    const bowShot = !!me.bow && ranged.dist >= MIN_RANGE && me.health > 6;
    if (bowShot || (me.armed && me.health > RANGED_FIGHT)) return { kind: 'fight', mob: ranged, ranged: true };
    if ((me.ranAgo ?? Infinity) >= 5000) return { kind: 'shelter', mob: ranged, ranged: true };
  }
  if (!me.armed || me.health <= 12) return null;
  for (const o of [...members].sort((p, q) => p.dist - q.dist)) {
    if (o.dist > reach || o.hurtAgo >= 3000) continue;
    const mob = [...o.mobs].sort((p, q) => p.dist - q.dist).find((m) => fightable(m.name) && m.dist < 5);
    if (mob && (defenders.get(mob.id)?.size ?? 0) < 2) return { kind: 'defend', mob, member: o.name };
  }
  return null;
}

/** A block as the ahead test reads it. */
export type Cell = { name: string; boundingBox: string } | null;
const DANGER = new Set(['lava', 'fire', 'soul_fire', 'magma_block', 'campfire', 'soul_campfire', 'sweet_berry_bush', 'cactus', 'powder_snow']);

/**
 * Safe to steer forward into the cell at `p` (feet level): not lava, fire or water at the feet or below, and ground within
 * 3 blocks down (a longer drop hurts). Unloaded cells are unsafe.
 */
export function safeAhead(read: (p: Vec3) => Cell, p: Vec3): boolean {
  const feet = read(p);
  if (!feet || DANGER.has(feet.name) || feet.name === 'water') return false;
  for (let dy = 1; dy <= 3; dy++) {
    const c = read(p.offset(0, -dy, 0));
    if (!c || DANGER.has(c.name) || c.name === 'water') return false;
    if (c.boundingBox === 'block') return true;
  }
  return false;
}

/**
 * Whether the cell at `p` (feet level) stops a runner: a fence, wall or gate (1.5 high, no jump clears it), a full block at
 * the head, or a full block at the feet with no 2 free cells above it (no step up). Train 23: 55 of 151 creeper flees
 * ended hurt (up to 16 health off): the old steering ran straight away only, and stood still (`forward` off) while the
 * cell ahead was unsafe, and pushed into fences and walls it could not jump.
 */
export function walled(read: (p: Vec3) => Cell, p: Vec3): boolean {
  const tall = (c: Cell) => !!c && /_fence$|_fence_gate$|_wall$|^iron_bars$|_pane$/.test(c.name);
  const solid = (c: Cell) => !!c && c.boundingBox === 'block';
  const feet = read(p), head = read(p.offset(0, 1, 0));
  if (tall(feet) || tall(read(p.offset(0, -1, 0))) || solid(head)) return true;
  return solid(feet) && solid(read(p.offset(0, 2, 0)));
}
/** A runner may steer into the cell at `p`: not walled, and safe ground at it or one up (a step). */
export const runnable = (read: (p: Vec3) => Cell, p: Vec3): boolean => !walled(read, p) && (safeAhead(read, p) || safeAhead(read, p.offset(0, 1, 0)));
/** Headings to run on, away from a mob in direction (ux, uz) from it, best first: straight away, then 45 and 90 degrees off each side. */
export function fleeHeadings(ux: number, uz: number): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  for (const deg of [0, 45, -45, 90, -90]) {
    const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    out.push({ x: ux * c - uz * s, z: ux * s + uz * c });
  }
  return out;
}

/** The best food to eat when hurt (health 12 or less, the bar not full): stage (b)'s order, its hunger mark lifted. */
export function hurtBite(items: Record<string, number>, food: number, health: number): string | null {
  if (health > 12 || food >= 20) return null;
  return packBite(items, Math.min(food, 14), health);
}

/** A wake for a member at most every `gap` ms (spec 4): true when allowed, and the time is noted. */
export function wakeAllowed(seen: Map<string, number>, name: string, now: number, gap = 180000): boolean {
  const t = seen.get(name);
  if (t !== undefined && now - t < gap) return false;
  seen.set(name, now);
  return true;
}
const wakes = new Map<string, number>();
/** botAgent's damage and death events in mob modes: may this one wake the model (once per 3 minutes per member)? */
export const mayWake = (name: string, now = Date.now()): boolean => wakeAllowed(wakes, name, now);

/**
 * Torch spots for a village's open ground (spec 6, the light part `grounds`): a `step` grid over `box`, each spot moved
 * to the first open cell within 2 blocks (`open`), skipping spots within `clear` blocks of a light (lamps, torches) or of
 * a spot already chosen.
 */
export function groundLightSpots(box: { x1: number; z1: number; x2: number; z2: number }, lights: Array<{ x: number; z: number }>,
  open: (x: number, z: number) => boolean, step = 12, clear = 7): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  const lit = (x: number, z: number) => [...lights, ...out].some((l) => (l.x - x) ** 2 + (l.z - z) ** 2 < clear * clear);
  const half = Math.floor(step / 2);
  for (let x = box.x1 + half; x <= box.x2; x += step)
    for (let z = box.z1 + half; z <= box.z2; z += step) {
      if (lit(x, z)) continue;
      const spot = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]].map(([dx, dz]) => ({ x: x + dx, z: z + dz })).find((s) => open(s.x, s.z));
      if (spot) out.push(spot);
    }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The hostile list and the counts
// ---------------------------------------------------------------------------------------------

type Track = { ids: Set<number>; hurtAt: number; health: number; scanAt: number; ranAt: number; fightId?: number; averting?: boolean };
const tracks = new WeakMap<BotAgent, Track>();

/**
 * #235, the gaze guard (every physics tick, before the look is sent): eyes on an enderman's within ENDER_SIGHT (4x vanilla's
 * cone, so the turn's slew lands first) are turned to avertPitch, unless it is the one being fought (already angry).
 */
function avertGaze(a: BotAgent, t: Track): void {
  const bot = a.bot;
  if (!bot.entity) return;
  const p = bot.entity.position;
  const eye = { x: p.x, y: p.y + 1.62, z: p.z };
  let turned = false;
  for (const id of t.ids) {
    if (id === t.fightId) continue;
    const e = bot.entities[id];
    if (!e || e.name !== ENDERMAN || e.isValid === false) continue;
    const m = { x: e.position.x, y: e.position.y + ENDER_EYE, z: e.position.z };
    if (Math.hypot(m.x - eye.x, m.y - eye.y, m.z - eye.z) > ENDER_SIGHT || !staresAt(eye, bot.entity.yaw, bot.entity.pitch, m, 0.1)) continue;
    bot.entity.pitch = avertPitch(eye, m);
    turned = true;
    break;
  }
  if (turned && !t.averting) combatCounts.averts++;
  t.averting = turned;
}

/** The bot's track, its listeners installed on first use (the bot object lives through respawns). */
function track(a: BotAgent): Track {
  let t = tracks.get(a);
  if (t) return t;
  const bot = a.bot;
  const tr: Track = { ids: new Set(), hurtAt: 0, health: bot.health ?? 20, scanAt: 0, ranAt: 0 };
  t = tr;
  tracks.set(a, tr);
  for (const e of Object.values(bot.entities)) if (isHostile(e.name)) tr.ids.add(e.id);
  bot.on('entitySpawn', (e: Entity) => {
    if (isHostile(e.name)) tr.ids.add(e.id);
  });
  bot.on('entityGone', (e: Entity) => {
    tr.ids.delete(e.id);
  });
  // (a dying mob stays a second in the death animation: no new fight against it)
  bot.on('entityDead', (e: Entity) => {
    tr.ids.delete(e.id);
  });
  bot.on('entityHurt', (e: Entity) => {
    if (e === bot.entity) tr.hurtAt = Date.now();
  });
  bot.on('physicsTick', () => avertGaze(a, tr));
  return tr;
}

/** The counts (status and report): kills by mob, flees, shelters, defends, swords taken, bites, fights given up. */
export const combatCounts = { kills: {} as Record<string, number>, averts: 0, evades: 0, huntsCalledOff: 0, rangedFights: 0, rangedRuns: 0, fights: 0, flees: 0, shelters: 0, defends: 0, swordsTaken: 0, bites: 0, gaveUp: 0, armed: 0, towerVisits: 0, towerReached: 0, watchSpots: 0, watchOutside: 0 };

/** Mob id -> the members fighting it (the 2-defender cap). */
const defenders = new Map<number, Set<string>>();

/** Hostile mobs within `r` of `from`, as this bot sees them (gone ones dropped from the list). */
function mobsNear(a: BotAgent, t: Track, from: Vec3, r: number): Seen[] {
  const out: Seen[] = [];
  for (const id of t.ids) {
    const e = a.bot.entities[id];
    if (!e || e.isValid === false) { t.ids.delete(id); continue; }
    const d = e.position.distanceTo(from);
    if (d <= r) out.push({ id, name: e.name ?? '?', dist: d });
  }
  return out;
}

/** The entity is still in the bot's world (not dead, not gone). */
const alive = (a: BotAgent, e: Entity): boolean => !!a.bot.entities[e.id] && e.isValid !== false;
const armedOf = (a: BotAgent) => a.bot.inventory.items().some((it) => isWeapon(it.name));
const counts = (a: BotAgent) => {
  const c: Record<string, number> = {};
  for (const it of a.bot.inventory?.items() ?? []) c[it.name] = (c[it.name] ?? 0) + it.count;
  return c;
};

// ---------------------------------------------------------------------------------------------
// The reflex (botAgent's tick calls combatTick in mob modes)
// ---------------------------------------------------------------------------------------------

/** Every tick in mob modes (a scan every 250 ms): decide, and start the reflex. */
export function combatTick(a: BotAgent): void {
  const bot = a.bot;
  if (!bot.entity || (bot.health ?? 20) <= 0) return;
  const t = track(a);
  const now = Date.now();
  const hp = bot.health ?? 20;
  if (hp < t.health) {
    t.hurtAt = Math.max(t.hurtAt, now);
    noteHurt(a, t);
  }
  t.health = hp;
  if (now - t.scanAt < 250) return;
  t.scanAt = now;
  if (!t.ids.size || a.inReflex()) return;
  const p = bot.entity.position;
  // (stage (d), MC_GUARDS: a member on watch defends within 24 blocks)
  const reach = guards.has(a.name) ? GUARD_REACH : 8;
  const mine = mobsNear(a, t, p, Math.max(16, reach));
  if (!mine.length) return;
  const members: Array<{ name: string; dist: number; hurtAgo: number; mobs: Seen[] }> = [];
  for (const o of a.world.agents.values()) {
    if (o === a || !o.bot.entity) continue;
    const ot = tracks.get(o);
    if (!ot || now - ot.hurtAt >= 3000) continue;
    const d = o.bot.entity.position.distanceTo(p);
    if (d > reach) continue;
    members.push({ name: o.name, dist: d, hurtAgo: now - ot.hurtAt, mobs: mobsNear(a, t, o.bot.entity.position, 5) });
  }
  const armed = armedOf(a);
  const d = decide({ health: hp, armed, hurtAgo: now - t.hurtAt, mobs: mine.filter((m) => m.dist <= 16), swordNear: !armed && swordNear(a), ranAgo: now - t.ranAt, bow: bowReady(a) }, members, defenders, reach);
  if (!d) return;
  if (d.kind === 'shelter' || d.kind === 'evade') t.ranAt = now;
  start(a, d);
}

/** Storage within 64 blocks holds a sword. */
function swordNear(a: BotAgent): boolean {
  const v = a.village();
  const chest = v?.storage?.chests[0];
  const p = a.bot.entity.position;
  if (!v || !chest || Math.hypot(chest.x - p.x, chest.z - p.z) > 64) return false;
  const store = storageContents(v);
  return SWORDS.some((s) => (store[s] ?? 0) > 0);
}

function start(a: BotAgent, d: NonNullable<Decision>): void {
  const what = d.mob.name.replace(/_/g, ' ');
  const mob = a.bot.entities[d.mob.id];
  if (!mob) return;
  const from = a.bot.entity.position.clone();
  const hp0 = Math.round(a.bot.health ?? 20);
  let why = '';
  const fn = async (signal: AbortSignal): Promise<string> => {
    if (d.kind === 'flee') {
      combatCounts.flees++;
      const ran = await steerAway(a, mob, 4000, signal);
      return `ran from a creeper (creepers explode; ${ran} blocks)`;
    }
    if (d.kind === 'evade') return evade(a, mob, signal);
    if (d.kind === 'shelter') {
      if (d.ranged) {
        // (#228: out of the witch's or the archer's range, toward home when the hut is near)
        combatCounts.rangedRuns++;
        return `${await shelter(a, mob, signal)} (out of the ${what}'s range)`;
      }
      return shelter(a, mob, signal);
    }
    if (d.kind === 'defend') combatCounts.defends++;
    let pre = '';
    if (d.kind === 'fight' && d.ranged) {
      combatCounts.rangedFights++;
      // (#228: a bow shoots it first; then the sword closes on it, melee's walk beyond 5 blocks)
      if (bowReady(a) && mob.position.distanceTo(a.bot.entity.position) >= MIN_RANGE) {
        const s = await shootDown(a, mob, signal, 6);
        if (s.killed) return s.text;
        pre = `${s.text}; `;
      }
      if (!armedOf(a) || !a.bot.entities[mob.id] || mob.isValid === false) return `${pre}the ${what} is out of reach`;
    }
    const r = await melee(a, mob, signal, d.kind === 'fight' && d.cornered ? {} : { giveUpAt: 6 });
    if (r.low) {
      combatCounts.gaveUp++;
      return `${pre}${r.text}; health low, so ${await shelter(a, mob, signal)}`;
    }
    // (a creeper came within CREEPER_LEAVE in the fight: run from it now, not after the reflex ends and the next scan)
    if (r.creeper && r.creeper.isValid !== false) {
      combatCounts.flees++;
      const ran = await steerAway(a, r.creeper, 4000, signal);
      return `${pre}${r.text}; ran ${ran} blocks from it`;
    }
    await biteIfHurt(a);
    return `${pre}${r.text}`;
  };
  if (d.kind === 'defend') {
    const s = defenders.get(d.mob.id) ?? new Set<string>();
    s.add(a.name);
    defenders.set(d.mob.id, s);
    why = `came to ${d.member}'s help against a ${what}`;
  } else why = d.kind === 'flee' ? `a creeper came close` : d.kind === 'evade' ? `an enderman attacked you` : d.ranged ? `a ${what} hurt you from range` : `a ${what} attacked you${d.kind === 'fight' && !armedOf(a) ? ' (no weapon: fists)' : ''}`;
  const release = () => {
    const s = defenders.get(d.mob.id);
    if (s) { s.delete(a.name); if (!s.size) defenders.delete(d.mob.id); }
  };
  const started = a.runReflex(`combat ${d.kind}`, fn, (msg) => {
    release();
    console.log(`[combat] ${a.name} ${d.kind}${d.kind === 'defend' ? ` ${d.member}` : ''} ${d.mob.name} at ${at(from)}: ${msg} (health ${hp0} -> ${Math.round(a.bot.health ?? 0)})`);
    a.pushEvent('system', `Reflex: ${why}; ${msg}. Resuming your action.`);
  }, (e) => {
    release();
    console.log(`[combat] ${a.name} ${d.kind} ${d.mob.name} at ${at(from)}: ${e.message} (health ${hp0} -> ${Math.round(a.bot.health ?? 0)})`);
    a.pushEvent('system', `Reflex: ${why}; ${e.message}`);
  });
  if (!started) release();
}

/** Eat one item at health 12 or less (stage (b)'s order). */
async function biteIfHurt(a: BotAgent): Promise<void> {
  const item = hurtBite(counts(a), a.bot.food ?? 20, a.bot.health ?? 20);
  if (!item) return;
  await eatOne(a, item).then(() => { combatCounts.bites++; }, () => undefined);
}

/** #231's meal to REGEN_FOOD (appetite.ts since #238, where the appetite's meal shares it). */
export { REGEN_FOOD, topUpMeal };
/** Eat to REGEN_FOOD: carried food first, else a meal taken from storage (the hut within 64 blocks). Words, or ''. */
async function topUp(a: BotAgent, signal: AbortSignal): Promise<string> {
  const food0 = Math.round(a.bot.food ?? 20);
  let meal = topUpMeal(counts(a), a.bot.food ?? 20, a.bot.health ?? 20);
  const v = a.village();
  const chest = v?.storage?.chests[0];
  const p = a.bot.entity.position;
  let took = '';
  if (!meal && v && chest && Math.hypot(chest.x - p.x, chest.z - p.z) <= 64) {
    const want = topUpMeal(storageContents(v), a.bot.food ?? 20, a.bot.health ?? 20);
    if (want) {
      const r = await withdrawItems(a, v, { [want.item]: want.n }, signal).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        return null;
      });
      if (r && ((r.got as Record<string, number>)[want.item] ?? 0) > 0) { meal = want; took = ' from storage'; }
    }
  }
  let eaten = 0;
  for (let i = 0; meal && i < 3 && (a.bot.food ?? 20) < REGEN_FOOD; i++) {
    const item = topUpMeal(counts(a), a.bot.food ?? 20, a.bot.health ?? 20)?.item;
    if (!item) break;
    const ok = await eatOne(a, item).then(() => true, () => false);
    if (!ok) break;
    eaten++;
    combatCounts.bites++;
  }
  return eaten ? `ate ${eaten}${took} (food ${food0} -> ${Math.round(a.bot.food ?? 0)})` : '';
}

/**
 * To shelter (spec 2): without a weapon, to the storage hut for the best sword it holds (withdrawItems walks there), then
 * the fight; with one but hurt, to the hut and a bite; no hut within 64 blocks (or nothing to take): away for 8 s.
 */
async function shelter(a: BotAgent, mob: Entity, signal: AbortSignal): Promise<string> {
  combatCounts.shelters++;
  const v = a.village();
  const chest = v?.storage?.chests[0];
  const p = a.bot.entity.position;
  const near = chest && Math.hypot(chest.x - p.x, chest.z - p.z) <= 64;
  if (v && near && !armedOf(a)) {
    const store = storageContents(v);
    const sword = SWORDS.find((s) => (store[s] ?? 0) > 0);
    if (sword) {
      const r = await withdrawItems(a, v, { [sword]: 1 }, signal).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
        return null;
      });
      if (r && ((r.got as Record<string, number>)[sword] ?? 0) > 0) {
        combatCounts.swordsTaken++;
        const foe = nearestHostile(a, 8);
        if (!foe) return `ran to the storage hut and took a ${sword.replace(/_/g, ' ')}`;
        const f = await melee(a, foe, signal, { giveUpAt: 4 });
        await biteIfHurt(a);
        return `ran to the storage hut, took a ${sword.replace(/_/g, ' ')} and fought: ${f.text}`;
      }
    }
  }
  if (near && chest && armedOf(a)) {
    await walk(a, new goals.GoalNear(chest.x, chest.y, chest.z, 3), 'the storage hut', signal, 20000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    // (#231: a meal from storage, so the health comes back)
    const ate = await topUp(a, signal);
    return `ran to the storage hut to recover${ate ? `; ${ate}` : ''}`;
  }
  await steerAway(a, mob, 8000, signal);
  await biteIfHurt(a);
  return armedOf(a) ? 'ran away to recover' : 'ran away (no weapon: craft a wooden_sword or stone_sword to fight back)';
}

/**
 * #235: away from an enderman that attacked: into a pool when one is within 12 (it never enters water; the member waits
 * there), else ENDER_RUN_MS steering away. Never to the storage hut: Clara ran there at health 1 and it followed.
 */
async function evade(a: BotAgent, mob: Entity, signal: AbortSignal): Promise<string> {
  combatCounts.evades++;
  const pool = waterRefuge(readCell(a), a.bot.entity.position);
  if (pool) {
    const got = await walk(a, new goals.GoalNear(pool.x, pool.y, pool.z, 0.5), 'the water', signal, 10000).then(() => true, (e: Error) => {
      if (e.message === 'cancelled') throw e;
      return false;
    });
    if (got && a.bot.entity.position.distanceTo(pool.offset(0.5, 0, 0.5)) < 1.5) {
      await sleep(6000, signal);
      await biteIfHurt(a);
      return `ran into the water at ${pool.x},${pool.z} (endermen never enter water)`;
    }
  }
  const ran = await steerAway(a, mob, ENDER_RUN_MS, signal);
  await biteIfHurt(a);
  return `ran ${ran} blocks from the enderman (it follows by teleporting: not to the storage hut; armed, fight back if it hits again)`;
}

function nearestHostile(a: BotAgent, r: number): Entity | null {
  const t = track(a);
  const m = mobsNear(a, t, a.bot.entity.position, r).filter((s) => fightable(s.name)).sort((p, q) => p.dist - q.dist)[0];
  return m ? a.bot.entities[m.id] ?? null : null;
}

const readCell = (a: BotAgent) => (p: Vec3): Cell => {
  const b = a.bot.blockAt(p);
  return b ? { name: b.name, boundingBox: b.boundingBox } : null;
};

/**
 * Steer away from `mob` for `ms` (no A*; sprinting): straight away, else 45 or 90 degrees off where that cell is walled or
 * unsafe (fleeHeadings, runnable); a heading that made no ground in 600 ms is passed over for a second (a fence, a wall, a
 * tree). Returns the blocks gained from the mob.
 */
async function steerAway(a: BotAgent, mob: Entity, ms: number, signal: AbortSignal): Promise<number> {
  const bot = a.bot;
  const read = readCell(a);
  const t0 = Date.now();
  const d0 = bot.entity.position.distanceTo(mob.position);
  let mark = { t: t0, p: bot.entity.position.clone() };
  let banned = -1, bannedUntil = 0, last = -1;
  try {
    while (Date.now() - t0 < ms) {
      checkAbort(signal);
      const now = Date.now();
      const p = bot.entity.position;
      const dx = p.x - mob.position.x, dz = p.z - mob.position.z;
      const len = Math.hypot(dx, dz) || 1;
      // (no ground made: the heading under way is passed over for a second)
      if (now - mark.t >= 600) {
        if (last >= 0 && Math.hypot(p.x - mark.p.x, p.z - mark.p.z) < 0.6) {
          banned = last;
          bannedUntil = now + 1000;
        }
        mark = { t: now, p: p.clone() };
      }
      const heads = fleeHeadings(dx / len, dz / len);
      let pick = -1;
      for (let i = 0; i < heads.length; i++) {
        if (i === banned && now < bannedUntil) continue;
        const h = heads[i];
        if (runnable(read, new Vec3(Math.floor(p.x + h.x), Math.floor(p.y), Math.floor(p.z + h.z)))) {
          pick = i;
          break;
        }
      }
      last = pick;
      const h = heads[pick >= 0 ? pick : 0];
      await bot.look(Math.atan2(-h.x, -h.z), 0, true);
      const ok = pick >= 0;
      bot.setControlState('forward', ok);
      bot.setControlState('sprint', ok);
      bot.setControlState('jump', ok && !!(bot.entity as unknown as { isCollidedHorizontally?: boolean }).isCollidedHorizontally);
      await sleep(100, signal);
    }
  } finally {
    bot.clearControlStates();
  }
  return Math.round(bot.entity.position.distanceTo(mob.position) - d0);
}

/** A fight is left when a creeper comes this close (its fuse lights at 3). */
export const CREEPER_LEAVE = 5;
/**
 * Fight `target` (spec 3): armour on, the best weapon to hand; over 5 blocks one GoalFollow; within 5 direct steering and
 * a hit below 3 blocks when the weapon's cooldown allows. Ends when the mob is gone (killed), past 24 blocks, after 30 s,
 * at a creeper within 3, or (`giveUpAt`) when health falls to that.
 */
export async function melee(a: BotAgent, target: Entity, signal: AbortSignal, opts: { giveUpAt?: number; capMs?: number } = {}): Promise<{ text: string; killed: boolean; low?: boolean; at?: Vec3; creeper?: Entity }> {
  const bot = a.bot;
  const what = (target.name ?? target.username ?? 'target').replace(/_/g, ' ');
  await equipArmour(a).catch(() => undefined);
  const weapon = WEAPONS.map((w) => bot.inventory.items().find((it) => it.name === w)).find(Boolean);
  if (weapon) await bot.equip(weapon, 'hand');
  const cd = cooldownMs(weapon?.name, timeScale());
  const read = readCell(a);
  const t = track(a);
  combatCounts.fights++;
  const t0 = Date.now();
  let following = false, last = 0, hits = 0;
  let lastPos = target.position.clone();
  // (a kill is the mob's death, not its leaving the bot's view: the hunt's first pairs counted mobs that went out of sight
  // after 3 hits as kills, and found no drops)
  let dead = false;
  const onDead = (e: Entity) => {
    if (e.id === target.id) dead = true;
  };
  bot.on('entityDead', onDead);
  // (#235: the gaze guard leaves the mob being fought alone)
  t.fightId = target.id;
  try {
    while (!dead && bot.entities[target.id] && target.isValid !== false) {
      checkAbort(signal);
      lastPos = target.position.clone();
      if (Date.now() - t0 > (opts.capMs ?? 30000)) return { text: `the ${what} is still alive after ${Math.round((opts.capMs ?? 30000) / 1000)} s (${hits} hits)`, killed: false };
      if (opts.giveUpAt !== undefined && (bot.health ?? 20) <= opts.giveUpAt) return { text: `fought a ${what} (${hits} hits)`, killed: false, low: true };
      // (a creeper's fuse lights at 3 blocks: the fight is left at CREEPER_LEAVE, so the run starts before it)
      const cr = mobsNear(a, t, bot.entity.position, CREEPER_LEAVE).find((m) => m.name === 'creeper');
      if (cr) return { text: `left the ${what}: a creeper came close`, killed: false, creeper: bot.entities[cr.id] };
      const p = bot.entity.position;
      const d = target.position.distanceTo(p);
      if (d > 24) return { text: `the ${what} got away`, killed: false };
      if (d > 5) {
        if (!following) {
          bot.clearControlStates();
          bot.pathfinder.setMovements(a.moves());
          bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
          following = true;
        }
      } else {
        if (following) {
          bot.pathfinder.setGoal(null);
          following = false;
        }
        await bot.lookAt(target.position.offset(0, (target.height ?? 1.6) * 0.8, 0), true);
        const dx = target.position.x - p.x, dz = target.position.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        const ahead = new Vec3(Math.floor(p.x + dx / len), Math.floor(p.y), Math.floor(p.z + dz / len));
        const fwd = d > 2.2 && (safeAhead(read, ahead) || safeAhead(read, ahead.offset(0, 1, 0)));
        bot.setControlState('forward', fwd);
        bot.setControlState('jump', fwd && !!(bot.entity as unknown as { isCollidedHorizontally?: boolean }).isCollidedHorizontally);
        const now = Date.now();
        if (d < 3 && now - last >= cd) {
          bot.attack(target);
          hits++;
          last = now;
        }
      }
      await sleep(50, signal);
    }
  } finally {
    bot.removeListener('entityDead', onDead);
    if (t.fightId === target.id) t.fightId = undefined;
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
  }
  if (!dead) return { text: `lost sight of the ${what} (${hits} hits)`, killed: false };
  const name = target.name ?? 'target';
  combatCounts.kills[name] = (combatCounts.kills[name] ?? 0) + 1;
  // (a mob the bows hit first: the bow's assist, counted with the archery's)
  const arrows = noteAssist(target.id);
  // (its drops: walked over when close)
  if (lastPos.distanceTo(bot.entity.position) < 4) await walk(a, new goals.GoalNear(lastPos.x, lastPos.y, lastPos.z, 0.5), 'the drops', signal, 2000).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
  });
  return { text: `killed the ${what} (${hits} hits${arrows ? `, after ${arrows} arrow hit${arrows === 1 ? '' : 's'}` : ''})`, killed: true, at: lastPos };
}

/** Put on the best armour carried, per slot (armour slots 5-8 are worn). */
export async function equipArmour(a: BotAgent): Promise<string[]> {
  const bot = a.bot;
  const slots = bot.inventory.slots;
  const worn = { head: slots[5]?.name, torso: slots[6]?.name, legs: slots[7]?.name, feet: slots[8]?.name };
  const put = armourToWear(bot.inventory.items().map((it) => it.name), worn);
  const done: string[] = [];
  for (const [dest, item] of Object.entries(put) as Array<[ArmourDest, string]>) {
    const it = bot.inventory.items().find((i) => i.name === item);
    if (!it) continue;
    await bot.equip(it, dest);
    done.push(item);
  }
  return done;
}

/**
 * Arm up (spec 5, the dusk chore): a sword from storage when none is carried, one armour piece per empty slot (best
 * first), then everything worn. Returns what was taken.
 */
export async function armUp(a: BotAgent, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v?.storage?.chests.length) throw new Error('arm: no village storage');
  const store = storageContents(v);
  const want: Record<string, number> = {};
  if (!armedOf(a)) {
    const sword = SWORDS.find((s) => (store[s] ?? 0) > 0);
    if (sword) want[sword] = 1;
  }
  const slots = a.bot.inventory.slots;
  const worn = { head: slots[5]?.name, torso: slots[6]?.name, legs: slots[7]?.name, feet: slots[8]?.name };
  const carried = a.bot.inventory.items().map((it) => it.name);
  const stocked = Object.keys(store).filter((n) => isArmour(n) && (store[n] ?? 0) > 0);
  const best = armourToWear([...carried, ...stocked], worn);
  for (const item of Object.values(best)) if (item && !carried.includes(item)) want[item] = 1;
  if (!Object.keys(want).length) {
    const on = await equipArmour(a);
    return on.length ? `put on ${on.join(', ')}` : 'nothing to take: storage holds no sword or armour you lack';
  }
  checkAbort(signal);
  const r = await withdrawItems(a, v, want, signal);
  const got = Object.entries(r.got as Record<string, number>).filter(([, q]) => q > 0).map(([n]) => n);
  if (got.some((n) => isWeapon(n))) combatCounts.armed++;
  const on = await equipArmour(a);
  return got.length ? `took ${got.join(', ')} from storage${on.length ? `; wearing ${on.join(', ')}` : ''}` : 'found none of it in storage (another member took it)';
}

const arming = new Set<string>();
const armTried = new Map<string, number>();
let armCheckedAt = 0;

/**
 * Every 5 s from the world's tick (mob modes, MC_ARMS): a member of a complete village who lacks a weapon (or wears
 * worse armour than storage holds) arms up (`armUp`, a reflex: the action under way resumes after), when storage holds
 * it and the member is within 48 blocks of the storage (any distance at night). At most 2 arm at once a village, each
 * member tried once per 5 minutes.
 */
export function armTick(agents: Iterable<BotAgent>, night: boolean): void {
  if (!armsOn()) return;
  const now = Date.now();
  if (now - armCheckedAt < 5000) return;
  armCheckedAt = now;
  const busy = new Map<string, number>();
  const list = [...agents];
  for (const a of list) if (arming.has(a.name)) { const v = a.village()?.name ?? ''; busy.set(v, (busy.get(v) ?? 0) + 1); }
  for (const a of list) {
    const v = a.village();
    const chest = v?.storage?.chests[0];
    if (!v || !v.complete || !chest || !a.bot.entity || a.inReflex() || arming.has(a.name) || (a.bot.health ?? 20) <= 0) continue;
    if (now - (armTried.get(a.name) ?? 0) < 5 * 60000 || (busy.get(v.name) ?? 0) >= 2) continue;
    const p = a.bot.entity.position;
    if (!night && Math.hypot(chest.x - p.x, chest.z - p.z) > 48) continue;
    const store = storageContents(v);
    const slots = a.bot.inventory.slots;
    const worn = { head: slots[5]?.name, torso: slots[6]?.name, legs: slots[7]?.name, feet: slots[8]?.name };
    const needSword = !armedOf(a) && SWORDS.some((s) => (store[s] ?? 0) > 0);
    const better = Object.keys(armourToWear(Object.keys(store).filter((n) => isArmour(n) && (store[n] ?? 0) > 0), worn)).length > 0;
    if (!needSword && !better) continue;
    armTried.set(a.name, now);
    arming.add(a.name);
    const started = a.runReflex('arm', (signal) => armUp(a, signal), (msg) => {
      arming.delete(a.name);
      console.log(`[combat] ${a.name} armed: ${msg}`);
      a.pushEvent('system', `Armed for the monsters (code): ${msg}.`);
    }, (e) => {
      arming.delete(a.name);
      console.log(`[combat] ${a.name} could not arm: ${e.message}`);
    });
    if (!started) { arming.delete(a.name); continue; }
    busy.set(v.name, (busy.get(v.name) ?? 0) + 1);
  }
}

// ---------------------------------------------------------------------------------------------
// Stage (d): defence as village works, roles and rules (runs/2026-10-31/survival/spec_d.md 0-3). Each piece acts only
// with monsters (MC_WORLD_MODE=hostile|normal) and has its own flag, on by default.
// ---------------------------------------------------------------------------------------------

const flagOn = (name: string) => !/^(off|0|false|no)$/i.test(rawSetting(name) ?? 'on');
/** Spec 1: the village's open ground is a light part (`grounds`), weighed up at night. */
export const groundsLightOn = (): boolean => modeSpec().mobs && flagOn('MC_GROUNDS_LIGHT');
/** Spec 2: the curfew rule is read from members' words, enforced on the menu, and its stake shown. */
export const safetyRulesOn = (): boolean => modeSpec().mobs && flagOn('MC_SAFETY_RULES');
/** Spec 3: the night watch chore. */
export const guardsOn = (): boolean => fightsMobs() && flagOn('MC_GUARDS');
/** Spec 4: the hunt at the village edge (drops for storage; members stop buying string and bone). */
export const huntOn = (): boolean => fightsMobs() && flagOn('MC_HUNT');

export type Box = { x1: number; z1: number; x2: number; z2: number };

/** The phase of the day by its tick: the evening before a bed may be used (dusk), the bed's night, else day. */
export const DUSK_FROM = 11000;
export function phaseOf(t: number | null | undefined): 'day' | 'dusk' | 'night' {
  if (typeof t !== 'number') return 'day';
  if (t >= 12541 && t <= 23458) return 'night';
  return t >= DUSK_FROM && t < 12541 ? 'dusk' : 'day';
}
/** From `phase` to dawn (the curfew's band and the watch's hours). */
export const fromPhase = (t: number | null | undefined, phase: 'dusk' | 'night'): boolean => phaseOf(t) === 'night' || (phase === 'dusk' && phaseOf(t) === 'dusk');
/**
 * Whether a curfew acts at `t` (#196): ahead of its phase, so the walk home ends before it. A nightfall curfew from dusk, a
 * dusk one from CURFEW_LEAD ticks before dusk (~50 s at 1x), both until CURFEW_TAIL ticks after dawn (#201: skeletons in
 * shade shot members 250-312 blocks out on trips begun at dawn, 106-144 s after it; 3 minutes at 1x).
 */
export const CURFEW_LEAD = 1000;
export const CURFEW_TAIL = 3600;
const DAWN = 23459;
export function curfewActs(t: number | null | undefined, phase: 'dusk' | 'night'): boolean {
  if (typeof t !== 'number') return false;
  const sinceDawn = t >= DAWN ? t - DAWN : t + 24000 - DAWN;
  return phaseOf(t) !== 'day' || sinceDawn < CURFEW_TAIL || (phase === 'dusk' && t >= DUSK_FROM - CURFEW_LEAD && t < DUSK_FROM);
}
/** #194: with monsters, code keeps members home by dusk while no member has a bed (the night then runs its length). */
export const homeByDuskOn = (): boolean => modeSpec().mobs && flagOn('MC_HOME_BY_DUSK');
/**
 * #230 (MC_NIGHT_BAND, on; with MC_HOME_BY_DUSK): code's home band holds with beds too while the nights run their length.
 * A sleeper ends a night in 5-35 s; a night still under way NIGHT_RUNS_AFTER ticks after nightfall (40 s at 1x) is one
 * nobody slept away. From then until a night ends short again, home by dusk acts (its dusk lead and dawn tail with it):
 * train 22's nights ran ~9 minutes with beds in the village, and 21 of 26 / 27 of 37 deaths came outside the ring at night,
 * a median ~125 blocks from storage, on hunts reaching the bounds + 48 and initiatives' far sites.
 */
export const nightBandOn = (): boolean => homeByDuskOn() && flagOn('MC_NIGHT_BAND');
export const NIGHTFALL = 12541;
export const NIGHT_RUNS_AFTER = 800;
const nightSeen = { in: false, long: false, runs: false };
/** Notes the time of day; whether the nights run their length (the last night, or this one past NIGHT_RUNS_AFTER). */
export function nightsRun(t: number | null | undefined): boolean {
  if (typeof t !== 'number') return nightSeen.runs;
  if (phaseOf(t) === 'night') {
    nightSeen.in = true;
    if (t - NIGHTFALL > NIGHT_RUNS_AFTER) nightSeen.long = nightSeen.runs = true;
  } else if (nightSeen.in) {
    // (a night just ended: short, a sleeper ended it; long, the next one is taken to run too)
    nightSeen.runs = nightSeen.long;
    nightSeen.in = nightSeen.long = false;
  }
  return nightSeen.runs;
}
/** For checks: forget the nights seen. */
export const resetNights = (): void => { nightSeen.in = nightSeen.long = nightSeen.runs = false; };
/** A curfew's band as the menu and the walk home read it: the rule's, or code's (`box`: past the built bounds + 16;
 *  `beds`: held with beds because the nights run, #230). */
export type SafetyBand = { dist: number; phase: 'dusk' | 'night'; box?: Box; code?: boolean; beds?: boolean };
/** Code's band (#194): home by dusk, out past the built bounds + 16 (the danger count's "out after dark"); null without bounds. */
export function homeBand(v: Pick<Village, 'layouts' | 'structures'>, beds = false): SafetyBand | null {
  const box = builtBounds(v);
  return box ? { dist: 0, phase: 'dusk', box, code: true, ...(beds ? { beds: true } : {}) } : null;
}
/**
 * Code's band for a complete village (#194, #230): without beds always (the night runs its length), with beds while the
 * nights run (nightsRun) and MC_NIGHT_BAND is on; null otherwise.
 */
export function codeBand(v: Pick<Village, 'layouts' | 'structures'>, beds: boolean, t: number | null | undefined): SafetyBand | null {
  const runs = nightsRun(t);
  if (!beds) return homeBand(v);
  return nightBandOn() && runs ? homeBand(v, true) : null;
}
/** Whether (x, z) lies past the band (from home, or past its box + 16). */
export const pastBand = (band: SafetyBand, home: { x: number; z: number }, x: number, z: number): boolean =>
  band.box ? beyond(band.box, x, z) > 0 : Math.hypot(x - home.x, z - home.z) > band.dist;
/**
 * #211: while the curfew acts for a member's village, whether (x, z) lies past its band (a gather keeps its targets
 * inside it: a night gather's flowers took members 50-80 out); null when no band acts now.
 */
export function bandNow(a: BotAgent): { past: (x: number, z: number) => boolean; band: SafetyBand } | null {
  const v = a.village();
  const home = v?.storage?.chests[0];
  const band = v && home ? a.world.safetyBand(v) : null;
  if (!band || !home || !curfewActs(a.bot.time?.timeOfDay, band.phase)) return null;
  return { past: (x, z) => pastBand(band, home, x, z), band };
}
/** The band's words for a dropped option and the walk's line. */
export const bandWords = (band: SafetyBand): string => band.code
  ? band.beds ? 'home by dusk: the nights here run their length (nobody sleeps them away)' : 'home by dusk: no member has a bed yet, so the night runs its length'
  : `the curfew: no trips past ${band.dist} blocks after ${band.phase === 'dusk' ? 'dusk' : 'nightfall'}`;
/** Whether any member has a bed (bedOf), checked at most every 30 s. */
let bedSeen = { at: 0, any: false };
export function anyBed(agents: Iterable<BotAgent>): boolean {
  const now = Date.now();
  if (now - bedSeen.at < 30000) return bedSeen.any;
  let any = false;
  for (const a of agents) if (bedOf(a)) { any = true; break; }
  bedSeen = { at: now, any };
  return any;
}

/** The village's built bounds (spec 0): its neighbourhoods' areas (fields left out) and structures, one box; null with neither. */
export function builtBounds(v: Pick<Village, 'layouts' | 'structures'>): Box | null {
  const boxes: Box[] = [...(v.layouts ?? []).filter((l) => !l.field), ...(v.structures ?? [])];
  if (!boxes.length) return null;
  return { x1: Math.min(...boxes.map((b) => b.x1)), z1: Math.min(...boxes.map((b) => b.z1)), x2: Math.max(...boxes.map((b) => b.x2)), z2: Math.max(...boxes.map((b) => b.z2)) };
}
/** How far (x, z) lies beyond `box` grown by `margin` (0 inside). */
export function beyond(box: Box, x: number, z: number, margin = 16): number {
  const dx = Math.max(box.x1 - margin - x, 0, x - box.x2 - margin), dz = Math.max(box.z1 - margin - z, 0, z - box.z2 - margin);
  return Math.hypot(dx, dz);
}
/** A death's or a trip's distance from home in the report's bins. */
export const DIST_BINS = ['<48', '48-100', '100-200', '200+'] as const;
export type DistBin = (typeof DIST_BINS)[number];
export const distBin = (d: number): DistBin => (d < 48 ? '<48' : d < 100 ? '48-100' : d < 200 ? '100-200' : '200+');

/** At most one guard per 6 members (spec 3), one at least. */
export const guardCap = (members: number): number => Math.max(1, Math.floor(members / 6));
export const GUARD_REACH = 24;

/**
 * The watch's loop (spec 3): the village's lamps and the grounds grid's edge spots (those within `edge` of the bounds' sides),
 * in order round the bounds' centre, so a guard walks a ring; at most `max` spots, evenly taken.
 */
export function watchLoop(bounds: Box, lamps: Array<{ x: number; z: number }>, grounds: Array<{ x: number; z: number }>, edge = 8, max = 16): Array<{ x: number; z: number }> {
  const onEdge = (s: { x: number; z: number }) => s.x - bounds.x1 < edge || bounds.x2 - s.x < edge || s.z - bounds.z1 < edge || bounds.z2 - s.z < edge;
  const cx = (bounds.x1 + bounds.x2) / 2, cz = (bounds.z1 + bounds.z2) / 2;
  const seen = new Set<string>();
  const all = [...lamps, ...grounds.filter(onEdge)].filter((s) => {
    const k = `${s.x},${s.z}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((p, q) => Math.atan2(p.z - cz, p.x - cx) - Math.atan2(q.z - cz, q.x - cx));
  if (all.length <= max) return all;
  return Array.from({ length: max }, (_, i) => all[Math.floor((i * all.length) / max)]);
}

/** The deaths' fact (spec 2's stake): "4 of 5 deaths were on trips over 100 blocks out", or '' with none. */
export function deathsFact(byBin: Partial<Record<DistBin, number>>, byPhase: Partial<Record<'day' | 'dusk' | 'night', number>>): string {
  const all = DIST_BINS.reduce((n, b) => n + (byBin[b] ?? 0), 0);
  if (!all) return '';
  const far = (byBin['100-200'] ?? 0) + (byBin['200+'] ?? 0), dark = (byPhase.dusk ?? 0) + (byPhase.night ?? 0);
  return far ? `${far} of ${all} deaths were on trips over 100 blocks out${dark ? `, ${dark} after dark` : ''}` : `${all} death${all === 1 ? '' : 's'}, ${dark} after dark, none on far trips`;
}

/** The danger count of one village (spec 0): every pass mark of (d) reads these. */
export interface Danger {
  /** Hostiles within 48 and 96 of home at the last count, and the most seen at a count after dark. */
  near48: number; near96: number; peak48: number; peak96: number;
  /** Member-minutes (game) out past the built bounds + 16 after dusk, and the farthest (blocks from home). */
  outMin: number; outMax: number;
  deaths: Partial<Record<DistBin, number>>; deathsPhase: Partial<Record<'day' | 'dusk' | 'night', number>>;
  /** Hostiles first seen inside the built bounds (a spawn there, or one walked in unseen). */
  spawnsIn: number;
  /** Per member, game minutes in each defence chore (watch, home, grounds). */
  chores: Record<string, Record<string, number>>;
  /** The night under way and the last one: members out after dark and deaths (the curfew's result line). */
  // (#233: the night's most monsters within 48 at a count, and who died, for the talk prompt's facts)
  night: { out: string[]; deaths: number; at: number; peak48?: number; died?: string[] }; lastNight?: { out: number; deaths: number; peak48?: number; died?: string[] };
  /** Watch nights by member (spec 3's specialisation). */
  watchNights: Record<string, number>;
  /** Hit-to-kill times of the watch's fights inside the bounds (ms), the last 50. */
  killMs: number[];
  /** The hunt (spec 4): hunt nights by member, kills by mob, drops brought to storage by item, hunters killed on the hunt. */
  hunt: { nights: Record<string, number>; kills: Record<string, number>; drops: Record<string, number>; deaths: number };
  /** #217 step 1: hits on members by a monster within the built bounds + 16 (one a member every 5 s at most), and the last hit. */
  hurtNear?: number;
  lastHurtNear?: string;
}
const dangers = new Map<string, Danger>();
const newDanger = (): Danger => ({ near48: 0, near96: 0, peak48: 0, peak96: 0, outMin: 0, outMax: 0, deaths: {}, deathsPhase: {}, spawnsIn: 0, chores: {}, night: { out: [], deaths: 0, at: 0 }, watchNights: {}, killMs: [], hunt: { nights: {}, kills: {}, drops: {}, deaths: 0 } });
export const dangerOf = (village: string): Danger => {
  let d = dangers.get(village);
  if (!d) dangers.set(village, (d = newDanger()));
  return d;
};
/** /api/status world.danger. */
export const dangerView = (): Record<string, Danger> => Object.fromEntries(dangers);

const hurtSeen = new Map<string, number>();
/** #217 step 1: a member hurt with a hostile within 6 blocks, inside the built bounds + 16 (the wall ballot's facts). */
function noteHurt(a: BotAgent, t: Track): void {
  const v = a.village();
  const box = v && builtBounds(v);
  const p = a.bot.entity?.position;
  if (!v || !box || !p || !v.complete || beyond(box, p.x, p.z) > 0 || !mobsNear(a, t, p, 6).length) return;
  const now = Date.now();
  if (now - (hurtSeen.get(a.name) ?? 0) < 5000) return;
  hurtSeen.set(a.name, now);
  const d = dangerOf(v.name);
  d.hurtNear = (d.hurtNear ?? 0) + 1;
  d.lastHurtNear = a.name;
}

/** botAgent's death (mob modes): the distance from home and the phase. */
export function noteDeath(a: BotAgent, where: Vec3 | undefined): void {
  if (!modeSpec().mobs) return;
  const v = a.village();
  const home = v?.storage?.chests[0];
  if (!v || !home || !where) return;
  const d = dangerOf(v.name);
  const r = Math.hypot(where.x - home.x, where.z - home.z);
  const bin = distBin(r);
  const ph = phaseOf(a.bot.time?.timeOfDay);
  d.deaths[bin] = (d.deaths[bin] ?? 0) + 1;
  d.deathsPhase[ph] = (d.deathsPhase[ph] ?? 0) + 1;
  if (ph !== 'day') {
    d.night.deaths++;
    d.night.died = [...(d.night.died ?? []), a.name];
  }
  const hunting = hunters.has(a.name);
  if (hunting) d.hunt.deaths++;
  console.log(`[danger] ${v.name}: ${a.name} died ${Math.round(r)} blocks from home (${bin}) at ${ph}${hunting ? ' (on the hunt)' : ''}`);
}

const seenMobs = new Set<number>();
let dangerAt = 0, dangerLogAt = 0, lastPhase: 'day' | 'dusk' | 'night' = 'day';
/** Members heading home under the curfew (the head-home reflex), by name. */
export const headingHome = new Set<string>();

/**
 * Once a game minute (the world's tick, mob modes): each village's hostiles near home, members out after dark, spawns inside
 * the bounds, the defence chores' minutes (`choreOf`), and a `[danger]` line every 10 game minutes.
 */
export function dangerTick(agents: Iterable<BotAgent>, villages: Iterable<Village>, choreOf: (a: BotAgent) => string | undefined): void {
  if (!modeSpec().mobs) return;
  const now = Date.now();
  const minute = 60000 / Math.max(1, timeScale());
  if (now - dangerAt < minute) return;
  dangerAt = now;
  const list = [...agents].filter((a) => a.bot.entity);
  const t = list.find((a) => typeof a.bot.time?.timeOfDay === 'number')?.bot.time.timeOfDay;
  const ph = phaseOf(t);
  // (the night's record rolls over at dawn)
  if (ph === 'day' && lastPhase !== 'day') for (const d of dangers.values()) {
    d.lastNight = { out: d.night.out.length, deaths: d.night.deaths, peak48: d.night.peak48 ?? 0, died: d.night.died ?? [] };
    d.night = { out: [], deaths: 0, at: now };
  }
  lastPhase = ph;
  // (every hostile any bot sees, once)
  const mobs = new Map<number, Vec3>();
  for (const a of list) {
    const tr = tracks.get(a);
    if (tr) for (const id of tr.ids) {
      const e = a.bot.entities[id];
      if (e && e.isValid !== false && !mobs.has(id)) mobs.set(id, e.position);
    }
  }
  const log = now - dangerLogAt >= 10 * minute;
  if (log) dangerLogAt = now;
  for (const v of villages) {
    const home = v.storage?.chests[0];
    const box = builtBounds(v);
    if (!home || !box || !v.complete) continue;
    const d = dangerOf(v.name);
    let n48 = 0, n96 = 0;
    for (const [id, p] of mobs) {
      const r = Math.hypot(p.x - home.x, p.z - home.z);
      if (r < 48) n48++;
      if (r < 96) n96++;
      if (!seenMobs.has(id) && beyond(box, p.x, p.z, 0) === 0 && Math.abs(p.y - home.y) <= 8) d.spawnsIn++;
    }
    Object.assign(d, { near48: n48, near96: n96 });
    if (ph !== 'day') {
      Object.assign(d, { peak48: Math.max(d.peak48, n48), peak96: Math.max(d.peak96, n96) });
      d.night.peak48 = Math.max(d.night.peak48 ?? 0, n48);
    }
    for (const a of list) {
      if (a.village()?.name !== v.name) continue;
      const p = a.bot.entity.position;
      if (ph !== 'day' && beyond(box, p.x, p.z) > 0) {
        d.outMin++;
        d.outMax = Math.max(d.outMax, Math.round(Math.hypot(p.x - home.x, p.z - home.z)));
        if (!d.night.out.includes(a.name)) d.night.out.push(a.name);
      }
      const c = choreOf(a);
      if (c) {
        const m = (d.chores[a.name] ??= {});
        m[c] = (m[c] ?? 0) + 1;
      }
    }
    if (log) {
      const deaths = DIST_BINS.filter((b) => d.deaths[b]).map((b) => `${b} ${d.deaths[b]}`).join(', ') || 'none';
      const chores: Record<string, number> = {};
      for (const m of Object.values(d.chores)) for (const [k, q] of Object.entries(m)) chores[k] = (chores[k] ?? 0) + q;
      console.log(`[danger] ${v.name} (${ph}): hostiles ${n48} within 48, ${n96} within 96 (night peaks ${d.peak48}/${d.peak96}); out after dark ${d.outMin} member-min (farthest ${d.outMax}); deaths ${deaths}; spawns inside ${d.spawnsIn}; defence min ${Object.entries(chores).map(([k, q]) => `${k} ${q}`).join(', ') || 'none'}; watchers ${Object.keys(d.watchNights).length}${huntOn() ? `; hunt: ${Object.keys(d.hunt.nights).length} hunters, kills ${Object.entries(d.hunt.kills).map(([k, q]) => `${k} ${q}`).join(', ') || 'none'}, drops ${Object.entries(d.hunt.drops).map(([k, q]) => `${q} ${k}`).join(', ') || 'none'}, hunter deaths ${d.hunt.deaths}` : ''}`);
    }
  }
  for (const id of mobs.keys()) seenMobs.add(id);
  if (seenMobs.size > 5000) seenMobs.clear();
}

// ---- The night watch (spec 3) -------------------------------------------------------------------

/** Members on watch, by name: their village and when the watch began. */
export const guards = new Map<string, { village: string; since: number }>();
/** The night (its record's start, Danger.night.at) of each member's last watch, by "village|member". */
const watchedNight = new Map<string, number>();
/** Whether the member has kept watch this night already (#195: once a night; the menu offers it no more). */
export const watchedTonight = (village: string, member: string): boolean => watchedNight.get(`${village}|${member}`) === dangerOf(village).night.at;
/** The most arrows a watcher shoots at one stop. */
export const WATCH_SHOTS = 8;
/** The watch's health floor to start (the watch ends at 8: a hurt member took it and ended it at once, again and again). */
export const WATCH_HEALTH = 12;
export const guardsOf = (village: string): number => [...guards.values()].filter((g) => g.village === village).length;

/**
 * keep_watch (a chore, not in TOOLS): walk the loop of `spots` (watchLoop's) until dawn, fighting any hostile within 16 of the
 * spot reached and inside the bounds; ends at dawn, after 20 minutes, or at health 8 (to the hut, eat). The reflex still
 * defends members within 24 meanwhile.
 */
export async function keepWatch(a: BotAgent, spots: Array<{ x: number; z: number; tower?: boolean }>, bounds: Box, signal: AbortSignal, ring?: Box[]): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('keep_watch: not in a village');
  if (!armedOf(a)) throw new Error('keep_watch: no weapon (take a sword from storage first)');
  if (!spots.length) throw new Error('keep_watch: the village has no lamps or edge spots to walk');
  const t0 = Date.now();
  guards.set(a.name, { village: v.name, since: t0 });
  const d = dangerOf(v.name);
  // (#195: one a member a night, the night keyed by when its record began)
  if (!watchedTonight(v.name, a.name)) {
    watchedNight.set(`${v.name}|${a.name}`, d.night.at);
    d.watchNights[a.name] = (d.watchNights[a.name] ?? 0) + 1;
  }
  const home = v.storage?.chests[0];
  let visited = 0, kills = 0, i = Math.floor(Math.random() * spots.length);
  const t = track(a);
  // (#217 step 6, MC_BOWS: a bow and arrows from storage for the night)
  const took = await takeBow(a, v, signal).catch(() => '');
  if (took) console.log(`[guard] ${a.name} ${v.name}: ${took}`);
  try {
    while (phaseOf(a.bot.time?.timeOfDay) !== 'day' && Date.now() - t0 < 20 * 60000) {
      checkAbort(signal);
      if ((a.bot.health ?? 20) <= 8) {
        const chest = v.storage?.chests[0];
        if (chest) await walk(a, new goals.GoalNear(chest.x, chest.y, chest.z, 3), 'the storage hut', signal, 30000).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
        });
        await biteIfHurt(a);
        return `kept watch ${Math.round((Date.now() - t0) / 1000)} s: ${visited} spots, ${kills} kills; ended hurt (health ${Math.round(a.bot.health ?? 0)})`;
      }
      const s = spots[i++ % spots.length];
      let shotAt: Entity | null = null;
      // (on the ground at the spot: a goal in x and z alone took a guard down the mine to die at y 23, #196)
      const y0 = Math.floor(home?.y ?? a.bot.entity.position.y);
      const g = surfaceAt(a, s.x, s.z, y0);
      if (g && (g.liquid || Math.abs(g.y - y0) > 12)) {
        await sleep(500, signal);
        continue;
      }
      await walk(a, new goals.GoalNear(s.x, (g ? g.y : y0) + 1, s.z, g ? 2 : 4), 'the watch spot', signal, 30000).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
      });
      visited++;
      // (#217 step 5: counts for the report: tower posts reached, and spots stood at outside the ring)
      const pos = a.bot.entity.position;
      combatCounts.watchSpots++;
      if (ring?.length && !ring.some((b) => pos.x >= b.x1 && pos.x <= b.x2 + 1 && pos.z >= b.z1 && pos.z <= b.z2 + 1)) combatCounts.watchOutside++;
      if (s.tower) {
        combatCounts.towerVisits++;
        if (g && Math.hypot(pos.x - s.x - 0.5, pos.z - s.z - 0.5) < 3 && Math.abs(pos.y - (g.y + 1)) < 1.2) {
          combatCounts.towerReached++;
          console.log(`[guard] ${a.name} ${v.name}: on the wall's tower at ${s.x},${s.z}`);
        } else console.log(`[guard] ${a.name} ${v.name}: did not reach the tower at ${s.x},${s.z} (at ${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)})`);
      }
      // (#217 step 6: with a bow, the hostiles in range and sight first, creepers too, from the tower or the spot)
      if (bowReady(a)) {
        const far = mobsNear(a, t, a.bot.entity.position, MAX_RANGE).filter((m) => m.dist >= MIN_RANGE && m.name !== ENDERMAN).sort((p, q) => p.dist - q.dist)
          .map((m) => a.bot.entities[m.id]).filter((e): e is Entity => !!e && e.isValid !== false);
        let shot = 0;
        // (bow fixes: up to WATCH_SHOTS a stop on the nearest until it dies or leaves range and sight, then the next; the
        // old 4 a target left mobs hit 1-3 times for the next spot; one still alive is the sword's target below)
        for (const e of far.slice(0, 3)) {
          if (shot >= WATCH_SHOTS) break;
          const r = await shootDown(a, e, signal, WATCH_SHOTS - shot);
          if (!r.shots) continue;
          shot += r.shots;
          if (r.killed) {
            kills++;
            combatCounts.kills[e.name ?? '?'] = (combatCounts.kills[e.name ?? '?'] ?? 0) + 1;
          } else if (a.bot.entities[e.id] && e.isValid !== false) shotAt = e;
          console.log(`[guard] ${a.name} ${v.name}: ${r.text} from ${s.tower ? 'the tower' : 'the spot'} at ${s.x},${s.z}`);
          if (!r.killed) break;
        }
        // (#225, MC_BOWS_FIRST: the arrows that missed, picked up once no hostile is within 10: they despawn a minute after
        // they land)
        if (shot && !mobsNear(a, t, a.bot.entity.position, 10).length) {
          const got = await pickUpArrows(a, signal, 16, 15000);
          if (got) console.log(`[arrows] ${a.name} ${v.name}: picked up ${got} arrows after the fight at ${s.x},${s.z}`);
        }
      }
      const inside = (e: Entity | undefined | null): e is Entity => !!e && e.isValid !== false && beyond(bounds, e.position.x, e.position.z, 0) === 0;
      const near16 = (e: Entity) => e.position.distanceTo(new Vec3(s.x, a.bot.entity.position.y, s.z)) <= 16;
      const foe = (shotAt && fightable(shotAt.name ?? '') && inside(a.bot.entities[shotAt.id]) && near16(shotAt) ? shotAt : null)
        ?? mobsNear(a, t, new Vec3(s.x, a.bot.entity.position.y, s.z), 16).filter((m) => fightable(m.name)).sort((p, q) => p.dist - q.dist)
          .map((m) => a.bot.entities[m.id]).find(inside);
      shotAt = null;
      if (foe) {
        const f0 = Date.now();
        const r = await melee(a, foe, signal, { giveUpAt: 8 });
        if (r.killed) {
          kills++;
          d.killMs = [...d.killMs, Date.now() - f0].slice(-50);
        }
        console.log(`[guard] ${a.name} ${v.name}: ${r.text} near ${s.x},${s.z}`);
      } else await sleep(1500, signal);
    }
    return `kept watch ${Math.round((Date.now() - t0) / 1000)} s until dawn: ${visited} spots, ${kills} kills`;
  } finally {
    guards.delete(a.name);
  }
}

// ---- The hunt (spec 4) ---------------------------------------------------------------------------

/** Prey the hunt seeks (bone and string), and zombies (rotten flesh), taken only when no prey is in reach; creepers never. */
export const HUNT_PREY = new Set(['skeleton', 'stray', 'bogged', 'spider', 'cave_spider']);
export const HUNT_ZOMBIES = new Set(['zombie', 'husk', 'zombie_villager', 'drowned']);
/** What the hunt brings to storage. */
export const HUNT_DROPS = ['bone', 'string', 'rotten_flesh', 'spider_eye', 'arrow'];
/** What members stop buying from the merchant while the hunt brings it in (gunpowder stays the merchant's: creepers need a bow). */
export const HUNTED_NOT_BOUGHT = new Set(['string', 'bone']);
/** A hunt starts above this health and ends at HUNT_LOW; it reaches HUNT_HOME from the storage hut. */
export const HUNT_HEALTH = 14;
export const HUNT_LOW = 10;
/**
 * #231: the menu offers the hunt above HUNT_HEALTH; the hunt itself starts above HUNT_HEALTH - HUNT_SLACK, healing first
 * (a bite while the bar is under 18, then up to HUNT_HEAL_MS for the regeneration) when at or under HUNT_HEALTH: the
 * menu's health is seconds old by the start, and in train 22 61 of 68 hunt picks failed at once at health 11-14 against
 * a start gate equal to the offer's.
 */
export const HUNT_SLACK = 3;
export const HUNT_HEAL_MS = 30000;
export const huntOffered = (health: number): boolean => health > HUNT_HEALTH;
export function huntStart(health: number): 'go' | 'heal' | 'no' {
  if (health > HUNT_HEALTH) return 'go';
  return health > HUNT_HEALTH - HUNT_SLACK ? 'heal' : 'no';
}
/**
 * #231 (train 23): the hunt still failed at the start in 27 of 44 picks, at health 6-11, 1.3-4.6 min after the pick: a
 * reflex (a creeper's blast as the member ran, the curfew's walk home, fights on the way) put the hunt back in the queue,
 * and on its resume hunt_edge checked the start's health again and failed. Now a hunt at or under the start's floor is
 * called off: the member goes to the storage hut and eats, and the chore ends done (no drops), not as a failure the
 * chooser bans the hunt for. Its words, for the chore's end.
 */
export function huntCallOff(health: number, resumed: boolean, healed = false, met = false, kills: Record<string, number> = {}): string {
  // (#234: a resume after the hunt met prey was hurt in its fights, not on the way out; its earlier kills are told)
  const why = resumed ? (met ? 'hurt in the hunt' : 'hurt on the way out') : healed ? 'still hurt after resting' : 'hurt before it began';
  const n = Object.values(kills).reduce((x, q) => x + q, 0);
  return `called off the hunt: health ${Math.round(health)}, ${why}${n ? ` after ${killWords(kills)}` : ''} (a hunt goes out above ${HUNT_HEALTH - HUNT_SLACK})`;
}
/** "3 kills (skeleton 2, spider 1)", "0 kills". */
export function killWords(kills: Record<string, number>): string {
  const n = Object.values(kills).reduce((x, q) => x + q, 0);
  return `${n} kill${n === 1 ? '' : 's'}${n ? ` (${Object.entries(kills).map(([k, q]) => `${k.replace(/_/g, ' ')} ${q}`).join(', ')})` : ''}`;
}
/**
 * #234: the hunt's kills and whether it met prey, kept in the action's memo (`kill:<mob>`, `met`), which a reflex putting
 * the hunt back does not reset: train 24's ok hunts read "0 kills" after kills before a resume (Clara 3, Dev 10 bones).
 */
export const huntKills = (memo: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(memo).filter(([k, q]) => k.startsWith('kill:') && q > 0).map(([k, q]) => [k.slice(5), q]));
/**
 * The hunt's target: the one shot at last while it lives and is in reach (`focus`; train 22-23's bows hit 17 times and
 * killed once: each hit mob was left for the nearest one, or for the next spot), else huntTarget's.
 */
export function huntPrey(seen: Spotted[], skip: ReadonlySet<number>, focus: number | null, inReach: (m: Spotted) => boolean): Spotted | null {
  const f = focus === null ? undefined : seen.find((m) => m.id === focus && !skip.has(m.id) && inReach(m));
  return f ?? huntTarget(seen.filter((m) => !skip.has(m.id)), inReach);
}
export const HUNT_EDGE = 32;
/**
 * #231 (the user's, 11-06: "Yes, limit to 64"): the hunt's reach is HUNT_HOME blocks from the storage hut, beds or not,
 * in place of the built bounds + 32/48. Train 24's hunts fought 51-182 blocks out (median 126 / 94), in the dark among
 * creepers and zombies, and all 24 calls-off followed those fights. Without a hut the old reach stays (huntReach).
 */
export const HUNT_HOME = 64;
export function huntReachHome(home: { x: number; y: number; z: number }, band: SafetyBand | null, p: { x: number; y: number; z: number }, r = HUNT_HOME): boolean {
  if (Math.hypot(p.x - home.x, p.z - home.z) > r || Math.abs(p.y - home.y) > 8) return false;
  return !band || !pastBand(band, home, p.x, p.z);
}
/**
 * The hunt's walk within HUNT_HOME: the ring's spots at most `r` - 8 from the hut (a mob seen from the spot is then in
 * reach); fewer than 3 left (a village wider than the reach), a circle of radius `r` - 16 round the hut, a spot every ~`step`.
 */
export function huntSpotsHome(spots: Array<{ x: number; z: number }>, home: { x: number; z: number }, r = HUNT_HOME, step = 24): Array<{ x: number; z: number }> {
  const near = spots.filter((q) => Math.hypot(q.x - home.x, q.z - home.z) <= r - 8);
  if (near.length >= 3) return near;
  const rad = r - 16, n = Math.max(6, Math.round((2 * Math.PI * rad) / step));
  return Array.from({ length: n }, (_, k) => ({ x: Math.round(home.x + rad * Math.cos((2 * Math.PI * k) / n)), z: Math.round(home.z + rad * Math.sin((2 * Math.PI * k) / n)) }));
}
/**
 * #237 (train 25, F362): all 112 "-> the village edge" stalls aimed at two ring spots, the north and south points of the
 * circle round the hut, whose surface stood 6-9 above home (the castle ring's towers, a rise); the walk timed out there
 * 17-20 s a time. Now each spot is moved to the nearest cell within HUNT_GROUND_REACH of it that a member can stand on and
 * reach on foot: dry ground whose feet are within HUNT_GROUND_RISE of the hut's height, its four neighbours within a step,
 * and off every structure, castle part and fence cell (`blocked`). Null: no such ground there (the spot is skipped).
 * `probe` reads a column's top (surfaceAt), null where not loaded.
 */
export const HUNT_GROUND_REACH = 6;
/** The hunt's ring walks for the `[watch]` summary line: spots moved to other ground, dropped with none, reached, not. */
export const groundCounts = { moved: 0, none: 0, reached: 0, unreached: 0 };
export const HUNT_GROUND_RISE = 3;
export type GroundTop = { y: number; liquid: boolean } | null;
export function huntGround(spot: { x: number; z: number }, home: { x: number; y: number; z: number }, probe: (x: number, z: number) => GroundTop,
  blocked: (x: number, z: number) => boolean, reach = HUNT_GROUND_REACH, rise = HUNT_GROUND_RISE): { x: number; y: number; z: number } | null {
  const cand: Array<{ x: number; z: number; d: number; h: number }> = [];
  for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) {
    const d = Math.hypot(dx, dz);
    if (d > reach) continue;
    const x = spot.x + dx, z = spot.z + dz;
    cand.push({ x, z, d, h: Math.hypot(x - home.x, z - home.z) });
  }
  // (nearest the spot first, then nearer home: a spot moved inward stays in the hunt's reach)
  cand.sort((p, q) => p.d - q.d || p.h - q.h);
  for (const c of cand) {
    if (blocked(c.x, c.z)) continue;
    const g = probe(c.x, c.z);
    if (!g || g.liquid || Math.abs(g.y + 1 - home.y) > rise) continue;
    const flat = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => {
      const n = probe(c.x + dx, c.z + dz);
      return !!n && !n.liquid && Math.abs(n.y - g.y) <= 1 && !blocked(c.x + dx, c.z + dz);
    });
    if (flat) return { x: c.x, y: g.y + 1, z: c.z };
  }
  return null;
}
/** #237: the cells a hunt spot keeps off: the village's structures, its castle parts' columns and its built fence cells,
 *  each grown by a block. */
export function huntBlocked(v: Pick<Village, 'structures' | 'wall'>): (x: number, z: number) => boolean {
  const cells = new Set<string>();
  const grow = (x: number, z: number) => {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) cells.add(`${x + dx},${z + dz}`);
  };
  const c = v.wall?.castle;
  for (const p of c?.parts ?? []) if (!c?.dropped?.[p.id]) for (const q of p.cols) grow(q.x, q.z);
  for (const k of Object.keys(v.wall?.built ?? {})) {
    const [x, z] = k.split(',').map(Number);
    grow(x, z);
  }
  const boxes = (v.structures ?? []).map((b) => ({ x1: b.x1 - 1, z1: b.z1 - 1, x2: b.x2 + 1, z2: b.z2 + 1 }));
  return (x, z) => cells.has(`${x},${z}`) || boxes.some((b) => x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2);
}
/** The longest hunt (wall minutes at 1x), and the longest the night's sleeper waits for hunters out (mcSurvivalB's hold). */
export const HUNT_MIN = 4;
export const huntMs = (): number => (HUNT_MIN * 60000) / Math.max(1, timeScale());

export type Spotted = Seen & { x: number; y: number; z: number };
/**
 * Whether a mob at `p` is in the hunt's reach: within the built bounds + `edge`, near home's height (cave mobs are off the
 * hunt: the watch's walk down the mine killed a guard, #196), and never past the curfew's band while it acts.
 */
export function huntReach(bounds: Box, home: { x: number; y: number; z: number }, band: SafetyBand | null, p: { x: number; y: number; z: number }, edge = HUNT_EDGE): boolean {
  if (beyond(bounds, p.x, p.z, edge) > 0 || Math.abs(p.y - home.y) > 8) return false;
  return !band || !pastBand(band, home, p.x, p.z);
}
/**
 * The hunt's walk: a ring `margin` outside the built bounds (the dark ground past the lit village, inside home by dusk's
 * band of 16), a spot every ~`step` blocks round it, in order.
 */
export function huntRing(bounds: Box, margin = 12, step = 24): Array<{ x: number; z: number }> {
  return ringAt(bounds, margin, step);
}
/**
 * #200: once a member has a bed (no home by dusk band), the hunt walks two rings, 24 and 32 outside the bounds, their spots
 * in turn, and reaches the bounds + HUNT_EDGE_BEDS: the lit ground and the watch thin the mobs nearer in.
 */
export const HUNT_RINGS_BEDS = [24, 32];
export const HUNT_EDGE_BEDS = 48;
/** #230: whether the hunt walks the wide rings (HUNT_RINGS_BEDS, the bounds + 48): with beds and no code band holding. */
export const huntWide = (beds: boolean, band: SafetyBand | null): boolean => beds && !band?.code;
export function huntRings(bounds: Box, beds: boolean, step = 24): Array<{ x: number; z: number }> {
  if (!beds) return huntRing(bounds, 12, step);
  const [p, q] = HUNT_RINGS_BEDS.map((m) => ringAt(bounds, m, step));
  return Array.from({ length: Math.max(p.length, q.length) }, (_, i) => [p[i % p.length], q[i % q.length]]).flat();
}
function ringAt(bounds: Box, margin: number, step: number): Array<{ x: number; z: number }> {
  const x1 = bounds.x1 - margin, z1 = bounds.z1 - margin, x2 = bounds.x2 + margin, z2 = bounds.z2 + margin;
  const out: Array<{ x: number; z: number }> = [];
  const side = (ax: number, az: number, bx: number, bz: number) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let i = 0; i < n; i++) out.push({ x: Math.round(ax + ((bx - ax) * i) / n), z: Math.round(az + ((bz - az) * i) / n) });
  };
  side(x1, z1, x2, z1); side(x2, z1, x2, z2); side(x2, z2, x1, z2); side(x1, z2, x1, z1);
  return out;
}
/** The hunt's target: the nearest skeleton or spider in reach, else the nearest zombie, else none. */
export function huntTarget(mobs: Spotted[], inReach: (m: Spotted) => boolean): Spotted | null {
  const ok = mobs.filter(inReach).sort((p, q) => p.dist - q.dist);
  return ok.find((m) => HUNT_PREY.has(m.name)) ?? ok.find((m) => HUNT_ZOMBIES.has(m.name)) ?? null;
}

/** Members on the hunt, by name (as `guards`). */
export const hunters = new Map<string, { village: string; since: number }>();
const huntedNight = new Map<string, number>();
/** Whether the member has hunted this night already (once a night, as the watch). */
export const huntedTonight = (village: string, member: string): boolean => huntedNight.get(`${village}|${member}`) === dangerOf(village).night.at;
export const huntersOf = (village: string): number => [...hunters.values()].filter((g) => g.village === village).length;
/** For mcSurvivalB's night: while a hunt is out, how long from nightfall the sleeper waits (0: no hold). */
export const huntHold = (): number => (hunters.size ? huntMs() : 0);

const dropsCarried = (a: BotAgent): Record<string, number> => {
  const c = counts(a);
  // (#217 step 6: creepers shot at range drop gunpowder)
  return Object.fromEntries([...HUNT_DROPS, ...(bowsOn() ? ['gunpowder'] : [])].map((n) => [n, c[n] ?? 0]));
};

/**
 * hunt_edge (a chore, not in TOOLS): at night, the nearest skeleton or spider in reach (huntTarget, huntReach), zombies
 * when none; melee (a give-up at HUNT_LOW), the drops walked over; with none in reach, on round the ring outside the bounds
 * (huntRing). Ends at dawn, after huntMs, or hurt; then the drops go to storage. The reflex still fights back meanwhile.
 */
export async function huntEdge(a: BotAgent, spots: Array<{ x: number; z: number }>, bounds: Box, bandOf: () => SafetyBand | null, signal: AbortSignal, edge = HUNT_EDGE,
  run?: { resumes?: number; firstStartedAt?: number; memo?: Record<string, number> }): Promise<string> {
  const v = a.village();
  const home = v?.storage?.chests[0];
  if (!v || !home) throw new Error('hunt_edge: not in a village with storage');
  if (!armedOf(a)) throw new Error('hunt_edge: no weapon (take a sword from storage first)');
  const resumed = (run?.resumes ?? 0) > 0;
  const memo = run ? (run.memo ??= {}) : {};
  // (#231: hurt by the start, the hunt is called off: home to the hut and a bite, and the chore ends done)
  const callOff = async (healed: boolean): Promise<string> => {
    const hp = a.bot.health ?? 0;
    const p = a.bot.entity.position;
    if (Math.hypot(home.x - p.x, home.z - p.z) > 4) await walk(a, new goals.GoalNear(home.x, home.y, home.z, 3), 'the storage hut', signal, 60000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    // (#231: a meal from storage to the bar's 18, where health comes back)
    const ate = await topUp(a, signal);
    combatCounts.huntsCalledOff++;
    const text = huntCallOff(hp, resumed, healed, !!memo.met, huntKills(memo));
    console.log(`[hunt] ${a.name} ${v.name}: ${text}; at the storage hut, health ${Math.round(a.bot.health ?? 0)}${ate ? `; ${ate}` : ''}`);
    // (#234: the drops of the kills before, carried home: into storage now (the bow's arrows stay with it))
    const prey = HUNT_DROPS.filter((k) => k !== 'arrow');
    const c = counts(a);
    if (memo.met && prey.some((k) => (c[k] ?? 0) > 0)) {
      await STORAGE_SKILLS.deposit.run(a, { item: prey[0], also: prey.join(','), ifAny: true }, signal).catch((e: Error) => {
        if (e.message === 'cancelled') throw e;
      });
      const left = counts(a);
      const put = prey.filter((k) => (c[k] ?? 0) > (left[k] ?? 0)).map((k) => `${(c[k] ?? 0) - (left[k] ?? 0)} ${k.replace(/_/g, ' ')}`);
      if (put.length) return `${text}; went to the storage hut to eat and heal, and deposited ${put.join(', ')}`;
    }
    return `${text}; went to the storage hut to eat and heal`;
  };
  // (#231: within HUNT_SLACK of the offer's health, a bite and the regeneration first; the hunt goes either way)
  const start = huntStart(a.bot.health ?? 20);
  if (start === 'no') return callOff(false);
  if (start === 'heal') {
    const hp0 = Math.round(a.bot.health ?? 0);
    // (#231: to the bar's 18 first, from storage when nothing is carried: at 15-17 the 30 s gave no health)
    const ate = await topUp(a, signal);
    const t1 = Date.now();
    while (Date.now() - t1 < HUNT_HEAL_MS && (a.bot.health ?? 20) <= HUNT_HEALTH) {
      checkAbort(signal);
      await sleep(1000, signal);
    }
    console.log(`[hunt] ${a.name} ${v.name}: health ${hp0} -> ${Math.round(a.bot.health ?? 0)} before the hunt (food ${Math.round(a.bot.food ?? 0)}, ${Math.round((Date.now() - t1) / 1000)} s${ate ? `; ${ate}` : ''})`);
    if ((a.bot.health ?? 20) <= HUNT_LOW) return callOff(true);
  }
  // (the hunt's length from its first start: a reflex puts it back in the queue and it starts again)
  const t0 = run?.firstStartedAt ?? Date.now();
  // (registered here, not at import: mcSurvivalB and this module import each other)
  setNightHold(huntHold);
  hunters.set(a.name, { village: v.name, since: t0 });
  const d = dangerOf(v.name);
  if (!huntedTonight(v.name, a.name)) {
    huntedNight.set(`${v.name}|${a.name}`, d.night.at);
    d.hunt.nights[a.name] = (d.hunt.nights[a.name] ?? 0) + 1;
  }
  let before = dropsCarried(a);
  const t = track(a);
  // (#231: the walk keeps within the reach from the hut)
  spots = huntSpotsHome(spots, home);
  // (#237: spots dropped this hunt, and the cells spots keep off)
  const dropped = new Set<string>();
  const blocked = huntBlocked(v);
  const grounds = new Map<string, { x: number; y: number; z: number } | null>();
  let ended = 'until dawn', i = Math.floor(Math.random() * Math.max(1, spots.length));
  // (#218: a creeper beside the prey made melee give up at once and the loop went straight back to the same spider, 6.2M
  // log lines and a heap OOM; now the hunter steps away first, a prey given up 3 times is skipped, 6 creeper give-ups end
  // the hunt, and a repeated line is logged once with its count)
  const gaveUp = new Map<number, number>(), skip = new Set<number>();
  // (bow fixes: `bowSkip` holds mobs the bow cannot shoot (out of sight): they stay the sword's prey, where the old `skip`
  // dropped them from the hunt; `focus` is the mob shot at last, kept until it dies or leaves reach)
  const bowSkip = new Set<number>();
  let focus: number | null = null;
  let creepers = 0, lastLine = '', repeats = 0;
  const ignore = (e: Error) => {
    if (e.message === 'cancelled') throw e;
  };
  const took = await takeBow(a, v, signal).catch(() => '');
  if (took) console.log(`[hunt] ${a.name} ${v.name}: ${took}`);
  // (the bow's own arrows are not the hunt's drops: the staged pair counted 32 stocked arrows as brought in)
  before = dropsCarried(a);
  try {
    while (phaseOf(a.bot.time?.timeOfDay) !== 'day') {
      checkAbort(signal);
      if (Date.now() - t0 > huntMs()) { ended = `after ${HUNT_MIN} min`; break; }
      if ((a.bot.health ?? 20) <= HUNT_LOW) { ended = `hurt (health ${Math.round(a.bot.health ?? 0)})`; break; }
      const band = bandOf();
      const seen: Spotted[] = [];
      for (const m of mobsNear(a, t, a.bot.entity.position, 64)) {
        const e = a.bot.entities[m.id];
        if (e) seen.push({ ...m, x: e.position.x, y: e.position.y, z: e.position.z });
      }
      const inReach = (m: Spotted) => huntReachHome(home, band, m);
      const prey = huntPrey(seen, skip, focus, inReach);
      focus = prey && prey.id === focus ? focus : null;
      // (#217 step 6, the user's Q1: with a bow, a creeper in reach is shot from range (gunpowder home), and prey 6+ out)
      if (bowReady(a)) {
        const inRange = (m: Spotted) => !skip.has(m.id) && !bowSkip.has(m.id) && m.dist >= MIN_RANGE && m.dist <= MAX_RANGE && inReach(m);
        const creeper = seen.filter((m) => m.name === 'creeper' && inRange(m)).sort((p, q) => p.dist - q.dist)[0];
        const tgt = creeper ?? (prey && inRange(prey) ? prey : undefined);
        const e = tgt && a.bot.entities[tgt.id];
        if (tgt && e && e.isValid !== false) {
          const at0 = e.position.clone();
          const r = await shootDown(a, e, signal);
          if (r.shots) memo.met = 1;
          if (r.killed) {
            memo[`kill:${tgt.name}`] = (memo[`kill:${tgt.name}`] ?? 0) + 1;
            d.hunt.kills[tgt.name] = (d.hunt.kills[tgt.name] ?? 0) + 1;
            const last = a.bot.entities[e.id]?.position ?? at0;
            await walk(a, new goals.GoalNear(last.x, last.y, last.z, 1), 'the drops', signal, 20000).catch(ignore);
            await pickUpDrops(a, last, signal).catch(ignore);
            // (#225: the arrows that missed, while they lie)
            const got = await pickUpArrows(a, signal, 16, 15000).catch(() => 0);
            if (got) console.log(`[arrows] ${a.name} ${v.name}: picked up ${got} arrows after the hunt's kill`);
          } else if (tgt.name === 'creeper') skip.add(tgt.id);
          else if (!r.shots) bowSkip.add(tgt.id);
          // (shot and alive: it stays the target, the sword's once it comes within MIN_RANGE)
          else if (alive(a, e)) focus = tgt.id;
          console.log(`[hunt] ${a.name} ${v.name}: ${r.text} (bow, ${Math.round(Math.hypot(tgt.x - home.x, tgt.z - home.z))} blocks from home)`);
          if (r.shots) continue;
        }
      }
      if (prey) {
        if (prey.dist > 20) await walk(a, new goals.GoalNear(prey.x, prey.y, prey.z, 4), 'the prey', signal, 30000).catch(ignore);
        const e = a.bot.entities[prey.id];
        if (!e || e.isValid === false) continue;
        memo.met = 1;
        const r = await melee(a, e, signal, { giveUpAt: HUNT_LOW });
        if (r.killed) {
          memo[`kill:${prey.name}`] = (memo[`kill:${prey.name}`] ?? 0) + 1;
          d.hunt.kills[prey.name] = (d.hunt.kills[prey.name] ?? 0) + 1;
          // (the drops: onto each item near the kill once it can be picked up; melee hits from 3 blocks, and in the first
          // pair no zombie's flesh was picked up)
          if (r.at && r.at.distanceTo(a.bot.entity.position) < 12) await pickUpDrops(a, r.at, signal).catch(ignore);
        }
        const left = r.at ? Object.values(a.bot.entities).filter((x) => x.name === 'item' && x.position.distanceTo(r.at!) < 6).length : 0;
        const line = `[hunt] ${a.name} ${v.name}: ${r.text} (${Math.round(Math.hypot(prey.x - home.x, prey.z - home.z))} blocks from home${r.killed ? `; ${left} items left there` : ''})`;
        if (line !== lastLine) {
          if (repeats) console.log(`[hunt] ${a.name} ${v.name}: (the line before repeated ${repeats} more times)`);
          console.log(line);
          lastLine = line;
          repeats = 0;
        } else repeats++;
        if (r.killed || r.low) continue;
        const n = (gaveUp.get(prey.id) ?? 0) + 1;
        gaveUp.set(prey.id, n);
        if (n >= 3) skip.add(prey.id);
        if (r.creeper) {
          if (++creepers >= 6) { ended = 'creepers kept close'; break; }
          if (r.creeper.isValid !== false) await steerAway(a, r.creeper, 3000, signal);
        }
        // (a floor on every give-up: melee can return at once)
        await sleep(500, signal);
        continue;
      }
      if (!spots.length) {
        await sleep(2000, signal);
        continue;
      }
      // (none in reach: on to the next spot of the ring, on its ground, as the watch)
      // (#230: a band that came to hold since the start (the night ran on past NIGHT_RUNS_AFTER) puts the hunt on the inner
      // ring, its spots inside the band)
      if (band && pastBand(band, home, spots[i % spots.length].x, spots[i % spots.length].z)) {
        const inner = huntSpotsHome(huntRing(bounds), home).filter((p) => !pastBand(band, home, p.x, p.z) && !dropped.has(`${p.x},${p.z}`));
        if (inner.length && inner.length !== spots.length) {
          spots = inner;
          i = 0;
          continue;
        }
      }
      const s = spots[i++ % spots.length];
      const y0 = Math.floor(home.y);
      // (#237: to walkable ground near the spot, off the village's structures and castle; a spot with none there, or whose
      // ground the walk did not reach, is dropped for this hunt)
      const drop = (why: string) => {
        dropped.add(`${s.x},${s.z}`);
        spots = spots.filter((q) => q !== s);
        console.log(`[hunt] ${a.name} ${v.name}: ring spot ${s.x},${s.z} dropped (${why}); ${spots.length} left`);
      };
      const probe = (x: number, z: number): GroundTop => surfaceAt(a, x, z, y0);
      if (!probe(s.x, s.z)) {
        // (not loaded: toward it as before)
        await walk(a, new goals.GoalNear(s.x, y0 + 1, s.z, 4), 'the village edge', signal, 30000).catch(ignore);
        await sleep(1000, signal);
        continue;
      }
      const sk = `${s.x},${s.z}`;
      const tgt = grounds.has(sk) ? grounds.get(sk)! : huntGround(s, home, probe, blocked);
      grounds.set(sk, tgt);
      if (!tgt) {
        drop(`no level ground within ${HUNT_GROUND_REACH}`);
        groundCounts.none++;
        await sleep(500, signal);
        continue;
      }
      if (tgt.x !== s.x || tgt.z !== s.z) groundCounts.moved++;
      await walk(a, new goals.GoalNear(tgt.x, tgt.y, tgt.z, 2), 'the village edge', signal, 30000).catch(ignore);
      const p = a.bot.entity.position;
      if (Math.hypot(p.x - tgt.x, p.z - tgt.z) > 3.5 || Math.abs(p.y - tgt.y) > 2) {
        groundCounts.unreached++;
        drop(`its ground ${tgt.x},${tgt.y},${tgt.z} not reached`);
      } else groundCounts.reached++;
      await sleep(1000, signal);
    }
  } finally {
    hunters.delete(a.name);
    if (repeats) console.log(`[hunt] ${a.name} ${v.name}: (the line before repeated ${repeats} more times)`);
  }
  // (#234: the kills of every run of this hunt, a resume's and the ones before it)
  const head = `hunted ${Math.round((Date.now() - t0) / 1000)} s at the village edge (${ended}): ${killWords(huntKills(memo))}`;
  // (the drops to storage, with any carried from before; the hunt's count is what it added to the pack)
  const got = dropsCarried(a);
  if (!Object.values(got).some((q) => q > 0)) return `${head}; no drops`;
  await STORAGE_SKILLS.deposit.run(a, { item: 'bone', also: HUNT_DROPS.join(','), ifAny: true }, signal);
  const left = dropsCarried(a);
  const put = HUNT_DROPS.filter((k) => got[k] > left[k]).map((k) => `${got[k] - left[k]} ${k.replace(/_/g, ' ')}`);
  for (const k of HUNT_DROPS) {
    const q = Math.min(got[k] - before[k], got[k] - left[k]);
    if (q <= 0) continue;
    d.hunt.drops[k] = (d.hunt.drops[k] ?? 0) + q;
    noteHunted(k, q);
  }
  return `${head}; deposited ${put.join(', ') || 'nothing'}`;
}

/**
 * The curfew's head-home reflex (spec 2): a member past the rule's distance from home in its phase walks home (at most once
 * in 10 minutes a member; the action under way resumes after, and the menu offers nothing past the distance meanwhile).
 */
const sentHome = new Map<string, number>();
export function curfewTick(agents: Iterable<BotAgent>, bandOf: (v: Village) => SafetyBand | null): void {
  if (!safetyRulesOn() && !homeByDuskOn()) return;
  const now = Date.now();
  for (const a of agents) {
    const v = a.village();
    const home = v?.storage?.chests[0];
    // (a guard on watch walks the edge by its own chore)
    if (!v || !home || !a.bot.entity || a.inReflex() || headingHome.has(a.name) || guards.has(a.name)) continue;
    const band = bandOf(v);
    if (!band || !curfewActs(a.bot.time?.timeOfDay, band.phase)) continue;
    const p = a.bot.entity.position;
    const r = Math.hypot(p.x - home.x, p.z - home.z);
    if (!pastBand(band, home, p.x, p.z) || now - (sentHome.get(a.name) ?? 0) < 10 * 60000) continue;
    sentHome.set(a.name, now);
    headingHome.add(a.name);
    console.log(`[curfew] ${a.name} ${v.name}: ${Math.round(r)} blocks out at ${phaseOf(a.bot.time?.timeOfDay)} (${bandWords(band)}): heads home`);
    const started = a.runReflex('curfew', async (signal) => {
      await walk(a, new goals.GoalNear(home.x, home.y, home.z, 4), 'home (the curfew)', signal, 180000);
      return `walked home ${Math.round(r)} blocks ${band.code ? band.beds ? 'before dark (the nights run their length)' : 'before dark (no bed yet)' : 'under the curfew'}`;
    }, (msg) => {
      headingHome.delete(a.name);
      console.log(`[curfew] ${a.name} ${msg}`);
      a.pushEvent('system', `${band.code ? 'Home by dusk' : "The village's curfew"} (code): you ${msg}.`);
    }, (e) => {
      headingHome.delete(a.name);
      console.log(`[curfew] ${a.name} could not walk home: ${e.message}`);
    });
    if (!started) headingHome.delete(a.name);
  }
}

/** The watch's and the hunt's skills (chores, not in TOOLS): the loop and the bounds from the world (MineflayerWorld.watchSpots). */
export const COMBAT_SKILLS = {
  keep_watch: {
    async run(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
      const v = a.village();
      const bounds = v ? builtBounds(v) : null;
      if (!v || !bounds) throw new Error('keep_watch: not in a village with buildings');
      return keepWatch(a, a.world.watchSpots(v), bounds, signal, v.wall?.state === 'voted' ? v.wall.rects : undefined);
    },
  },
  hunt_edge: {
    // (#231: the run's status, for its resumes and first start)
    async run(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
      const v = a.village();
      const bounds = v ? builtBounds(v) : null;
      if (!v || !bounds) throw new Error('hunt_edge: not in a village with buildings');
      // (#230: the wide rings only while no home band holds: with nights that run, the hunt keeps to the inner ring)
      const wide = huntWide(anyBed(a.world.agents.values()), a.world.safetyBand(v));
      return huntEdge(a, huntRings(bounds, wide), bounds, () => {
        const band = a.world.safetyBand(v);
        return band && curfewActs(a.bot.time?.timeOfDay, band.phase) ? band : null;
      }, signal, wide ? HUNT_EDGE_BEDS : HUNT_EDGE, a.runOf(_args));
    },
  },
};
