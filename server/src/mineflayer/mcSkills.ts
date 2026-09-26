/**
 * Skills for agents in real Minecraft, with the same names and arguments as the sandbox's (skills.ts), so the brains'
 * tools and prompts do not change. Each skill checks its arguments when queued and runs as an async function that
 * resolves with a result message or throws what went wrong (what is short, where the problem is, what to try).
 */
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { BotAgent } from './botAgent';

const { goals } = pathfinderPkg;

export interface McSkill {
  /** Throws with a helpful message when the arguments are unusable (called when the skill is queued). */
  check?(args: Record<string, unknown>): void;
  /** Runs the skill; resolves with a result message, throws on failure, and stops when `signal` fires. */
  run(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string | void>;
}

const num = (v: unknown, name: string): number => {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || !Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
};
const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required`);
  return v;
};
const at = (v: Vec3) => `${Math.floor(v.x)},${Math.floor(v.y)},${Math.floor(v.z)}`;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((ok, fail) => {
    const t = setTimeout(ok, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      fail(new Error('cancelled'));
    }, { once: true });
  });

/** Pathfinder errors, reworded to say what to do next. */
function pathError(e: Error, target: string): Error {
  const m = e.message;
  if (/no path/i.test(m)) return new Error(`no path to ${target} from here (blocked by terrain, water or buildings); try a nearer point or explore first`);
  if (/took to long|too long/i.test(m)) return new Error(`path search to ${target} took too long; try a nearer point`);
  return new Error(`could not reach ${target}: ${m}`);
}

/**
 * Walk to a goal with the pathfinder, giving up when the bot stops making progress, the time runs out or the skill is
 * cancelled (the pathfinder alone can keep retrying the same blocked move forever).
 */
async function walk(a: BotAgent, goal: InstanceType<typeof goals.Goal>, target: string, signal: AbortSignal, timeoutMs: number) {
  const bot = a.bot;
  bot.pathfinder.setMovements(a.moves());
  let settled = false;
  let last = bot.entity.position.clone();
  let lastMove = Date.now();
  const t0 = Date.now();
  await new Promise<void>((ok, fail) => {
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearInterval(watch);
      if (err) {
        bot.pathfinder.stop();
        fail(err);
      } else ok();
    };
    const watch = setInterval(() => {
      const p = bot.entity.position;
      if (p.distanceTo(last) > 0.5) {
        last = p.clone();
        lastMove = Date.now();
      }
      // Digging or placing a block on the way can hold the bot still for a while
      const busy = bot.pathfinder.isMining() || bot.pathfinder.isBuilding();
      if (!busy && Date.now() - lastMove > 10000) done(new Error(`stuck at ${at(p)} on the way to ${target}; try a different route or a nearer point`));
      else if (Date.now() - t0 > timeoutMs) done(new Error(`timed out at ${at(p)} on the way to ${target}`));
    }, 500);
    signal.addEventListener('abort', () => done(new Error('cancelled')), { once: true });
    bot.pathfinder.goto(goal).then(() => done(), (e: Error) => done(pathError(e, target)));
  });
}

/**
 * The nearest y in the column at x, z where a player can stand (solid below, two free blocks), searching up and down
 * from y; null if the column is not loaded or has no such spot nearby. Models often guess y from the wrong place.
 */
function standableY(a: BotAgent, x: number, y: number, z: number): number | null {
  const v = new Vec3(x, 0, z);
  const box = (yy: number) => a.bot.blockAt(v.set(x, yy, z))?.boundingBox;
  for (let d = 0; d <= 24; d++)
    for (const yy of d ? [y - d, y + d] : [y]) {
      const below = box(yy - 1);
      if (below === undefined) return null;
      if (below === 'block' && box(yy) === 'empty' && box(yy + 1) === 'empty') return yy;
    }
  return null;
}

export const MC_SKILLS: Record<string, McSkill> = {
  move_to: {
    check: (a) => ['x', 'y', 'z'].forEach((k) => num(a[k], k)),
    async run(a, args, signal) {
      const x = Math.floor(num(args.x, 'x')), z = Math.floor(num(args.z, 'z'));
      const asked = Math.floor(num(args.y, 'y'));
      const y = standableY(a, x, asked, z) ?? asked;
      const range = args.range !== undefined ? Math.max(0, num(args.range, 'range')) : 1;
      const p = a.bot.entity.position.floored();
      if ((p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 <= range * range) return `already at ${x},${y},${z}`;
      const goal = new goals.GoalNear(x, y, z, range);
      const dist = a.bot.entity.position.distanceTo(new Vec3(x, y, z));
      await walk(a, goal, `${x},${y},${z}`, signal, Math.min(120000, 20000 + 1500 * dist));
      return `arrived at ${at(a.bot.entity.position)}${y !== asked ? ` (the ground at ${x},${z} is at y=${y}, not ${asked})` : ''}`;
    },
  },
  chat: {
    check: (a) => {
      if (str(a.message, 'message').trim().startsWith('/')) throw new Error('chat messages cannot start with "/" (no commands)');
    },
    async run(a, args) {
      const msg = str(args.message, 'message').replace(/\s+/g, ' ').trim().slice(0, 256);
      a.bot.chat(msg);
    },
  },
  wait: {
    check: (a) => a.seconds !== undefined && num(a.seconds, 'seconds'),
    async run(_a, args, signal) {
      const s = args.seconds !== undefined ? Math.min(300, Math.max(0, num(args.seconds, 'seconds'))) : 1;
      await sleep(s * 1000, signal);
    },
  },
  look_at: {
    check: (a) => ['x', 'y', 'z'].forEach((k) => num(a[k], k)),
    async run(a, args) {
      await a.bot.lookAt(new Vec3(num(args.x, 'x'), num(args.y, 'y'), num(args.z, 'z')));
    },
  },
};
