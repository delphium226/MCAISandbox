/**
 * Survival stage (a)'s helpers (MC_WORLD_MODE=damage and up, worldMode.ts): why a member died, read from the server's
 * death message (else guessed from where it was), and what hurts it now (air running out, fire, lava) with the nearest
 * safe cell to step to. The reflexes themselves run in botAgent.ts, in the reflex slot.
 */
import { Vec3 } from 'vec3';
import type { BotAgent } from './botAgent';

export type DeathCause = 'fall' | 'drowning' | 'lava' | 'fire' | 'suffocation' | 'starvation' | 'mob' | 'other';

/** Vanilla's English death messages (26.1), by cause; the first that matches wins. */
const CAUSES: Array<[DeathCause, RegExp]> = [
  ['lava', /tried to swim in lava/],
  ['drowning', /\bdrowned\b/],
  ['fire', /burned to death|went up in flames|walked into fire|burned to a crisp|walked into the danger zone|was burnt/],
  ['fall', /fell from a high place|hit the ground too hard|fell off|fell while climbing|doomed to fall|fell too far|fell out of the world/],
  ['suffocation', /suffocated in a wall|was squished too much|was squashed/],
  ['starvation', /starved to death/],
  ['mob', /was slain by|was shot by|was blown up by|was fireballed by|was stung to death|was killed by/],
];

/**
 * The cause in a chat line that is this member's death message ("Ada fell from a high place"), or null for any other
 * line (a player's chat comes as "<Ada> ...": it never starts with the bare name).
 */
export function deathCauseOf(name: string, line: string): DeathCause | null {
  if (!line.startsWith(`${name} `)) return null;
  const rest = line.slice(name.length + 1);
  for (const [cause, re] of CAUSES) if (re.test(rest)) return cause;
  // (a death message we do not know: vanilla's all say "<name> <verb>..."; a chat line from the server about the name is
  // rare, and a wrong "other" only shows in the log)
  return /^(was|died|withered|froze|experienced|blew up|discovered)\b/.test(rest) ? 'other' : null;
}

/** What hurts the bot where it stands now (only checked when damage is on). */
export type Hazard = 'air' | 'lava' | 'fire';

const FIRE = new Set(['fire', 'soul_fire', 'campfire', 'soul_campfire', 'magma_block']);
const name = (a: BotAgent, p: Vec3) => a.bot.blockAt(p)?.name ?? '';

/**
 * #188: a lava block in the cells the bot's box (0.6 wide, 1.8 high) stands in. The entity's own isInLava flag is only
 * believed with one: it is the physics' last tick, kept across a death, so a respawned Gus "stepped out of lava" at the
 * world spawn.
 */
export function lavaAround(a: BotAgent, p: Vec3): boolean {
  for (let x = Math.floor(p.x - 0.3); x <= Math.floor(p.x + 0.3); x++)
    for (let z = Math.floor(p.z - 0.3); z <= Math.floor(p.z + 0.3); z++)
      for (let y = Math.floor(p.y); y <= Math.floor(p.y + 1.8); y++) if (name(a, new Vec3(x, y, z)) === 'lava') return true;
  return false;
}

/** Air below `airBelow` of 20 under water; in lava; in or on fire. Cheap: a few block reads. */
export function hazardOf(a: BotAgent, airBelow = 12): Hazard | null {
  const e = a.bot.entity as unknown as { position: Vec3; isInLava?: boolean; isInWater?: boolean };
  if (!e?.position) return null;
  const feet = e.position.floored();
  if (name(a, feet) === 'lava' || (e.isInLava && lavaAround(a, e.position))) return 'lava';
  if (FIRE.has(name(a, feet)) || FIRE.has(name(a, feet.offset(0, 1, 0))) || name(a, feet.offset(0, -1, 0)) === 'magma_block') return 'fire';
  const air = (a.bot as unknown as { oxygenLevel?: number }).oxygenLevel;
  if (e.isInWater && typeof air === 'number' && air < airBelow && name(a, feet.offset(0, 1, 0)) === 'water') return 'air';
  return null;
}

/** The guess when no death message came: what hurt it last. */
export function causeFromState(last: { hazard: Hazard | null; fell: number } | null): DeathCause {
  if (!last) return 'other';
  if (last.hazard === 'air') return 'drowning';
  if (last.hazard) return last.hazard;
  return last.fell >= 4 ? 'fall' : 'other';
}

/**
 * The nearest cell within `r` blocks to stand on out of the hazard: solid ground below (not magma), feet and head free of
 * water, lava and fire, no lava or fire beside the feet. Null if none (the caller jumps forward instead).
 */
export function safeCellNear(a: BotAgent, r = 4): Vec3 | null {
  const at = a.bot.entity.position.floored();
  let best: Vec3 | null = null, bd = Infinity;
  const bad = (p: Vec3) => {
    const n = name(a, p);
    return n === 'lava' || n === 'water' || FIRE.has(n);
  };
  for (let dy = -2; dy <= 3; dy++)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const d = dx * dx + dz * dz + dy * dy * 2;
        if (d >= bd || (dx === 0 && dz === 0)) continue;
        const p = at.offset(dx, dy, dz);
        const below = a.bot.blockAt(p.offset(0, -1, 0));
        if (below?.boundingBox !== 'block' || below.name === 'magma_block') continue;
        const f = a.bot.blockAt(p), h = a.bot.blockAt(p.offset(0, 1, 0));
        if (!f || !h || f.boundingBox === 'block' || h.boundingBox === 'block' || bad(p) || bad(p.offset(0, 1, 0))) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([x, z]) => { const n = name(a, p.offset(x, 0, z)); return n === 'lava' || FIRE.has(n); })) continue;
        best = p;
        bd = d;
      }
  return best;
}

/** #188: how long the lava step steers at most: lava does 4 damage every half second, so full health lasts ~2.5 s. */
export const LAVA_STEP_MS = 2000;

/**
 * #188: out of lava by steering, not the pathfinder (its 5-second walk outlasted the bot: Gus died in it with no line
 * logged): faced to the safe cell (else straight on), forward, sprint and jump, until the box is clear of lava or
 * LAVA_STEP_MS pass. True when out.
 */
export async function lavaStep(a: BotAgent, c: Vec3 | null, signal: AbortSignal): Promise<boolean> {
  const bot = a.bot;
  const t0 = Date.now();
  try {
    if (c) await bot.lookAt(new Vec3(c.x + 0.5, c.y + 1.6, c.z + 0.5), true);
    for (const k of ['forward', 'sprint', 'jump'] as const) bot.setControlState(k, true);
    while (Date.now() - t0 < LAVA_STEP_MS) {
      if (signal.aborted) throw new Error('cancelled');
      await new Promise((ok) => setTimeout(ok, 50));
      const p = bot.entity?.position;
      if (!p || (bot.health ?? 0) <= 0) return false;
      if (!lavaAround(a, p)) return true;
    }
    return false;
  } finally {
    bot.clearControlStates();
  }
}

/**
 * #181: whether a member under water is trapped rather than short of breath: a third swim-up within a minute and 3 blocks
 * of the others (each refills a little air and leads back down), or health at 10 or less. Train 14's D: Xavier and Uma
 * swam up every 10-20 s for 5 minutes in a water pocket under the lake shore, from 20 health to death. `ups` is the
 * member's recent swim-ups, this one included.
 */
export function trappedUnderWater(ups: Array<{ p: { x: number; y: number; z: number }; t: number }>, health: number): boolean {
  return ups.length >= 3 || health <= 10;
}

/** #181: where members were trapped under water lately (gathering keeps off them for TRAP_MS). */
const traps: Array<{ x: number; y: number; z: number; t: number }> = [];
const TRAP_MS = 30 * 60000;
export function noteTrap(p: { x: number; y: number; z: number }, now = Date.now()) {
  traps.push({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), t: now });
  while (traps.length && now - traps[0].t > TRAP_MS) traps.shift();
}
/** Within `r` blocks of a recent trap. */
export function nearTrap(p: { x: number; y: number; z: number }, r = 4, now = Date.now()): boolean {
  return traps.some((q) => now - q.t < TRAP_MS && Math.abs(q.x - p.x) <= r && Math.abs(q.z - p.z) <= r && Math.abs(q.y - p.y) <= r + 2);
}

/** #181: a death in words for the member's next choices ("you drowned at -1682,59,-3 2 min ago"). */
const DIED: Record<DeathCause, string> = {
  fall: 'you fell to your death', drowning: 'you drowned', lava: 'you burned in lava', fire: 'you burned to death',
  suffocation: 'you suffocated in a wall', starvation: 'you starved', mob: 'you were killed by a mob', other: 'you died',
};
export function deathWords(d: { cause: DeathCause; place: string; t: number }, now: number): string {
  const m = Math.max(1, Math.round((now - d.t) / 60000));
  return `${DIED[d.cause] ?? 'you died'} at ${d.place} ${m} min ago and woke at home with your things; keep away from that place`;
}
/** The same death as the member's own memory line ("I drowned at -1682,59,-3; I keep away from there"). */
export function deathMemory(d: { cause: DeathCause; place: string }): string {
  return `${(DIED[d.cause] ?? 'you died').replace(/^you were/, 'I was').replace(/^you/, 'I')} at ${d.place}; I keep away from there`;
}

