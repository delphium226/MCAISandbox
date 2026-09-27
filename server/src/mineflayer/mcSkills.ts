/**
 * Skills for agents in real Minecraft, with the same names and arguments as the sandbox's (skills.ts), so the brains'
 * tools and prompts do not change. Each skill checks its arguments when queued and runs as an async function that
 * resolves with a result message or throws what went wrong (what is short, where the problem is, what to try).
 * The survival skills (mining, crafting, fighting, ...) are in mcSurvival.ts, the building skills in mcBuild.ts.
 */
import { Vec3 } from 'vec3';
import type { BotAgent } from './botAgent';
import { BUILD_SKILLS } from './mcBuild';
import { STORAGE_SKILLS } from './mcStorage';
import { SURVIVAL_SKILLS } from './mcSurvival';
import { at, goals, num, sleep, standableY, str, walk } from './mcUtil';

export interface McSkill {
  /** Throws with a helpful message when the arguments are unusable (called when the skill is queued). */
  check?(args: Record<string, unknown>): void;
  /** Runs the skill; resolves with a result message, throws on failure, and stops when `signal` fires. */
  run(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string | void>;
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
      if (str(a.message, 'message').startsWith('/')) throw new Error('chat messages cannot start with "/" (no commands)');
    },
    async run(a, args) {
      const msg = str(args.message, 'message').replace(/\s+/g, ' ').slice(0, 256);
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
  ...SURVIVAL_SKILLS,
  ...BUILD_SKILLS,
  ...STORAGE_SKILLS,
};
