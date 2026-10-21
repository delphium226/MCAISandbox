/**
 * Skill from practice (#17, PLAN A.3p item 3; G2): each member's per-kind skill grows with practice and fades with neglect
 * (the response-threshold model: what a member does often it comes to prefer), its temperament's liking for the kind (its
 * "passion") multiplying the gain. Code keeps it; the menu reads it as a weight (`sw`) beside the temperament's, needs',
 * wants', goal's and intention's, and the prompt shows it as a short line and on the option's record. World-free: the
 * world reports chore ends with the passion. Kept in the member's social memory (memory.ts' store).
 *
 * Settings (read once):
 *   MC_SKILL        off (default) | on
 *   MC_SKILL_GAIN   0.15: s += gain x passion x (1 - s) at each chore of the kind that was not cut
 *   MC_SKILL_DECAY  0.98: every other kind's skill multiplied by this at each chore end
 */
import { KIND_WORDS, touchMemory } from './memory';
import { memberSocial } from './social';

export const SKILL = {
  on: /^(on|1|true|yes)$/i.test(process.env.MC_SKILL ?? ''),
  gain: Number(process.env.MC_SKILL_GAIN ?? 0.15),
  decay: Number(process.env.MC_SKILL_DECAY ?? 0.98),
};

/** Test hook. */
export function setSkillSettings(s: Partial<typeof SKILL>): void {
  Object.assign(SKILL, s);
}

/** Harvests on fields and slots are one skill, as they are one role. */
const skillKind = (k: string) => (k === 'slot' ? 'farm' : k);

function table(village: string, agent: string): Record<string, number> {
  const s = memberSocial(village, agent) as { skill?: Record<string, number> };
  return (s.skill ??= {});
}

/** A chore of the kind ended, not cut (eating and tidying left out): practice raises it, every other kind fades. */
export function noteSkill(village: string, agent: string, kind: string, passion: number): void {
  if (!SKILL.on || kind === 'eat' || kind === 'tidy') return;
  const t = table(village, agent);
  const k = skillKind(kind);
  for (const other of Object.keys(t)) if (other !== k) t[other] = Math.round(t[other] * SKILL.decay * 1000) / 1000;
  const p = Math.min(1.5, Math.max(0.7, passion || 1));
  const s = t[k] ?? 0;
  t[k] = Math.round(Math.min(1, s + SKILL.gain * p * (1 - s)) * 1000) / 1000;
  touchMemory();
}

export function skillOf(village: string, agent: string, kind: string): number {
  return table(village, agent)[skillKind(kind)] ?? 0;
}

/** An option's skill weight, 0.8 (never practised) to 1.4 (mastered). */
export const skillWeight = (s: number) => Math.round((0.8 + 0.6 * s) * 100) / 100;

/** The prompt's line: kinds at some skill (0.3) or more, the highest first ('' when none or off). */
export function skillLine(village: string, agent: string): string {
  if (!SKILL.on) return '';
  const rows = Object.entries(table(village, agent)).filter(([, s]) => s >= 0.3).sort((x, y) => y[1] - x[1]).slice(0, 3);
  return rows.length ? `Your skill: ${rows.map(([k, s]) => `${KIND_WORDS[k] ?? k} ${s >= 0.6 ? 'high' : 'some'}`).join(', ')}.` : '';
}
