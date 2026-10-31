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
import { rawSetting } from '../settings';
import { modeSpec } from '../worldMode';
import { timeScale } from './mcRules';
import { packBite, eatOne } from './mcSurvivalB';
import { storageContents, withdrawItems } from './mcStorage';
import { at, checkAbort, goals, sleep, walk } from './mcUtil';

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
export type Decision =
  | { kind: 'flee'; mob: Seen }
  | { kind: 'fight'; mob: Seen; cornered?: boolean }
  | { kind: 'shelter'; mob: Seen }
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
export function decide(me: { health: number; armed: boolean; hurtAgo: number; mobs: Seen[]; swordNear?: boolean; ranAgo?: number },
  members: Array<{ name: string; dist: number; hurtAgo: number; mobs: Seen[] }>, defenders: ReadonlyMap<number, ReadonlySet<string>>): Decision {
  const near = [...me.mobs].sort((p, q) => p.dist - q.dist);
  const creeper = near.find((m) => m.name === 'creeper' && m.dist < 5);
  if (creeper) return { kind: 'flee', mob: creeper };
  const close = near.find((m) => m.name !== 'creeper' && m.dist < 5);
  if (close && me.hurtAgo < 3000) {
    const mayRun = (me.ranAgo ?? Infinity) >= 5000;
    if (me.armed && me.health > 8) return { kind: 'fight', mob: close };
    if (!me.armed && me.swordNear && mayRun) return { kind: 'shelter', mob: close };
    if (!me.armed && me.health > 10) return { kind: 'fight', mob: close };
    return mayRun ? { kind: 'shelter', mob: close } : { kind: 'fight', mob: close, cornered: true };
  }
  if (!me.armed || me.health <= 12) return null;
  for (const o of [...members].sort((p, q) => p.dist - q.dist)) {
    if (o.dist > 8 || o.hurtAgo >= 3000) continue;
    const mob = [...o.mobs].sort((p, q) => p.dist - q.dist).find((m) => m.name !== 'creeper' && m.dist < 5);
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

type Track = { ids: Set<number>; hurtAt: number; health: number; scanAt: number; ranAt: number };
const tracks = new WeakMap<BotAgent, Track>();

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
  bot.on('entityHurt', (e: Entity) => {
    if (e === bot.entity) tr.hurtAt = Date.now();
  });
  return tr;
}

/** The counts (status and report): kills by mob, flees, shelters, defends, swords taken, bites, fights given up. */
export const combatCounts = { kills: {} as Record<string, number>, fights: 0, flees: 0, shelters: 0, defends: 0, swordsTaken: 0, bites: 0, gaveUp: 0, armed: 0 };

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
  if (hp < t.health) t.hurtAt = Math.max(t.hurtAt, now);
  t.health = hp;
  if (now - t.scanAt < 250) return;
  t.scanAt = now;
  if (!t.ids.size || a.inReflex()) return;
  const p = bot.entity.position;
  const mine = mobsNear(a, t, p, 16);
  if (!mine.length) return;
  const members: Array<{ name: string; dist: number; hurtAgo: number; mobs: Seen[] }> = [];
  for (const o of a.world.agents.values()) {
    if (o === a || !o.bot.entity) continue;
    const ot = tracks.get(o);
    if (!ot || now - ot.hurtAt >= 3000) continue;
    const d = o.bot.entity.position.distanceTo(p);
    if (d > 8) continue;
    members.push({ name: o.name, dist: d, hurtAgo: now - ot.hurtAt, mobs: mobsNear(a, t, o.bot.entity.position, 5) });
  }
  const armed = armedOf(a);
  const d = decide({ health: hp, armed, hurtAgo: now - t.hurtAt, mobs: mine, swordNear: !armed && swordNear(a), ranAgo: now - t.ranAt }, members, defenders);
  if (!d) return;
  if (d.kind === 'shelter') t.ranAt = now;
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
      await steerAway(a, mob, 4000, signal);
      return `ran from a creeper (creepers explode)`;
    }
    if (d.kind === 'shelter') return shelter(a, mob, signal);
    if (d.kind === 'defend') combatCounts.defends++;
    const r = await melee(a, mob, signal, d.kind === 'fight' && d.cornered ? {} : { giveUpAt: 6 });
    if (r.low) {
      combatCounts.gaveUp++;
      return `${r.text}; health low, so ${await shelter(a, mob, signal)}`;
    }
    await biteIfHurt(a);
    return r.text;
  };
  if (d.kind === 'defend') {
    const s = defenders.get(d.mob.id) ?? new Set<string>();
    s.add(a.name);
    defenders.set(d.mob.id, s);
    why = `came to ${d.member}'s help against a ${what}`;
  } else why = d.kind === 'flee' ? `a creeper came close` : `a ${what} attacked you${d.kind === 'fight' && !armedOf(a) ? ' (no weapon: fists)' : ''}`;
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
    await biteIfHurt(a);
    return 'ran to the storage hut to recover';
  }
  await steerAway(a, mob, 8000, signal);
  await biteIfHurt(a);
  return armedOf(a) ? 'ran away to recover' : 'ran away (no weapon: craft a wooden_sword or stone_sword to fight back)';
}

function nearestHostile(a: BotAgent, r: number): Entity | null {
  const t = track(a);
  const m = mobsNear(a, t, a.bot.entity.position, r).filter((s) => s.name !== 'creeper').sort((p, q) => p.dist - q.dist)[0];
  return m ? a.bot.entities[m.id] ?? null : null;
}

const readCell = (a: BotAgent) => (p: Vec3): Cell => {
  const b = a.bot.blockAt(p);
  return b ? { name: b.name, boundingBox: b.boundingBox } : null;
};

/** Steer straight away from `mob` for `ms` (no A*; sprinting; stops at an unsafe cell ahead). */
async function steerAway(a: BotAgent, mob: Entity, ms: number, signal: AbortSignal): Promise<void> {
  const bot = a.bot;
  const read = readCell(a);
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < ms) {
      checkAbort(signal);
      const p = bot.entity.position;
      const dx = p.x - mob.position.x, dz = p.z - mob.position.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      await bot.look(Math.atan2(-ux, -uz), 0, true);
      const ahead = new Vec3(Math.floor(p.x + ux), Math.floor(p.y), Math.floor(p.z + uz));
      const ok = safeAhead(read, ahead) || safeAhead(read, ahead.offset(0, 1, 0));
      bot.setControlState('forward', ok);
      bot.setControlState('sprint', ok);
      bot.setControlState('jump', ok && !!(bot.entity as unknown as { isCollidedHorizontally?: boolean }).isCollidedHorizontally);
      await sleep(100, signal);
    }
  } finally {
    bot.clearControlStates();
  }
}

/**
 * Fight `target` (spec 3): armour on, the best weapon to hand; over 5 blocks one GoalFollow; within 5 direct steering and
 * a hit below 3 blocks when the weapon's cooldown allows. Ends when the mob is gone (killed), past 24 blocks, after 30 s,
 * at a creeper within 3, or (`giveUpAt`) when health falls to that.
 */
export async function melee(a: BotAgent, target: Entity, signal: AbortSignal, opts: { giveUpAt?: number; capMs?: number } = {}): Promise<{ text: string; killed: boolean; low?: boolean }> {
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
  try {
    while (bot.entities[target.id] && target.isValid !== false) {
      checkAbort(signal);
      lastPos = target.position.clone();
      if (Date.now() - t0 > (opts.capMs ?? 30000)) return { text: `the ${what} is still alive after ${Math.round((opts.capMs ?? 30000) / 1000)} s (${hits} hits)`, killed: false };
      if (opts.giveUpAt !== undefined && (bot.health ?? 20) <= opts.giveUpAt) return { text: `fought a ${what} (${hits} hits)`, killed: false, low: true };
      if (mobsNear(a, t, bot.entity.position, 3).some((m) => m.name === 'creeper')) return { text: `left the ${what}: a creeper came close`, killed: false };
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
    bot.pathfinder.setGoal(null);
    bot.clearControlStates();
  }
  const name = target.name ?? 'target';
  combatCounts.kills[name] = (combatCounts.kills[name] ?? 0) + 1;
  // (its drops: walked over when close)
  if (lastPos.distanceTo(bot.entity.position) < 4) await walk(a, new goals.GoalNear(lastPos.x, lastPos.y, lastPos.z, 0.5), 'the drops', signal, 2000).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
  });
  return { text: `killed the ${what} (${hits} hits)`, killed: true };
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
