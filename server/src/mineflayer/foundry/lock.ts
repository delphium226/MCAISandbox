/**
 * G6 (spec runs/2026-10-21/g6-loop/spec.md 3), G8: a foundry skill whose library spec carries a `rung` is locked to that
 * ladder rung (open while the village works or has reached it). A foundry skill whose library spec carries a `research` block is a locked
 * innovation entry (registered by loadLibrary into tech.ts LOCKED_SKILLS while MC_INNOVATE is on; with it off the spec is
 * not loaded at all). Its activity's place and pick answer "locked" until the member's village has unlocked the entry.
 * Looked up at each call: the registry fills when the world loads the library, after this module. The skill and its tool
 * stay registered either way (a planner may still call it, as any skill).
 */
import { LOCKED_SKILLS, RUNG_SKILLS, techOf } from '../../tech';
import type { FoundrySkill } from './types';

export function locked(f: FoundrySkill): FoundrySkill {
  const act = f.activity;
  if (!act) return f;
  const closed = (v: Parameters<typeof act.place>[0]['village']): { why: string } | null => {
    // (G8: a rung-locked skill, open while the village works that rung or has reached it; G2's v.ladder)
    const rung = RUNG_SKILLS.get(f.name);
    if (rung) {
      const l = v?.ladder;
      const reached = (l?.reached ?? []).some((r) => r?.rung === rung);
      if (l?.current !== rung && !reached) return { why: `locked: the village has not reached the ${rung} age` };
    }
    const e = LOCKED_SKILLS.get(f.name);
    if (!e) return null;
    try {
      return techOf(v).unlocked.includes(e.id) ? null : { why: `locked: the village has not researched ${e.name} yet` };
    } catch {
      return { why: 'locked' };
    }
  };
  return {
    ...f,
    activity: {
      ...act,
      place: (ctx) => closed(ctx.village) ?? act.place(ctx),
      ...(act.pick ? { pick: (ctx: Parameters<NonNullable<typeof act.pick>>[0]) => closed(ctx.village) ?? act.pick!(ctx) } : {}),
    },
  };
}
