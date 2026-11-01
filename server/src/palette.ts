/**
 * The palette (#172, spec runs/2026-10-28/palette/spec.md): every chore a member of a complete village can take now, as a
 * coarse skill with its arguments, each with one verdict of the shared check. The world's sources make the entries
 * (mcWorld.ts choiceOptions: feasibility and reservation by busy keys stay with each source); the checks after them (a
 * plot claimed by another member, a law in force, the appetite) take entries off here with their verdict, as does the
 * menu's own shaping (`view`: #122's gated filler, the monument's share), which open mode skips. The menu is a view on
 * what is left (choose.ts menuView: the guards and the trim); `MC_CHOOSE=open` shows the model the whole of it.
 * World-free: it imports only the world's types.
 */
import type { ChoiceKind, ChoiceOption } from './world';

/** Why an entry left the palette: reserved by another member's claim, forbidden by a law, the appetite, or the menu's
 *  own shaping (open mode keeps those). */
export type DropBy = 'claimed' | 'law' | 'hungry' | 'view';
export interface Dropped {
  option: ChoiceOption;
  by: DropBy;
  why: string;
}

/** One member's palette while its options are made: `live` is the list the sources fill (the menu reads it), `dropped`
 *  what the checks took off, in order. */
export class Palette {
  readonly dropped: Dropped[] = [];
  constructor(readonly live: ChoiceOption[], readonly open = false) {}

  /** Take an entry off with its verdict (the menu's own shaping only when not open). Returns whether it was taken. */
  drop(o: ChoiceOption, by: DropBy, why: string): boolean {
    if (by === 'view' && this.open) return false;
    const i = this.live.indexOf(o);
    if (i < 0) return false;
    this.live.splice(i, 1);
    this.dropped.push({ option: o, by, why });
    return true;
  }

  /** The verdicts by kind of check, for a log line or the needs block ("law 3, claimed 1"). */
  counts(): Partial<Record<DropBy, number>> {
    const out: Partial<Record<DropBy, number>> = {};
    for (const d of this.dropped) out[d.by] = (out[d.by] ?? 0) + 1;
    return out;
  }
}

/** An option matches a busy key (ChoiceOption.excludes: "x=" exactly, "x" as itself or a prefix of "x:..."): reserved
 *  by a chore under way or a decision pending. */
export function reserved(excludes: string[], busy: Set<string>): boolean {
  for (const e of excludes) {
    if (e.endsWith('=')) {
      if (busy.has(e.slice(0, -1))) return true;
      continue;
    }
    if (busy.has(e)) return true;
    const p = `${e}:`;
    for (const k of busy) if (k.startsWith(p)) return true;
  }
  return false;
}

/** The coarse skill each kind runs (code still does the geometry: places, counts, routes). */
const SKILL: Record<ChoiceKind, string> = {
  farm: 'harvest', slot: 'harvest', start: 'plant', annex: 'build', pen: 'build', penwork: 'tend', cake: 'craft', iron: 'mine',
  explore: 'explore', works: 'build', make: 'craft', gather: 'collect', light: 'light', furnish: 'furnish', initiate: 'build',
  help: 'build', grow: 'build', eat: 'eat', tidy: 'tidy', activity: 'activity', own: 'own', innovate: 'research', rest: 'rest', watch: 'watch', hunt: 'hunt',
  monument: 'build',
};
/** The words of each skill in the open prompt's group headings. */
export const SKILL_WORDS: Record<string, string> = {
  craft: 'craft into storage', collect: 'collect materials', harvest: 'harvest', plant: 'plant', build: 'build and help build',
  tend: 'tend the animals', mine: 'mine and smelt', explore: 'explore', light: 'light', furnish: 'furnish', eat: 'eat',
  tidy: 'tidy', activity: 'activities', own: 'your own house and goods', research: 'research', rest: 'rest', hunt: 'hunt at night', board: 'the board and customs',
};

/** An entry's skill and arguments, from its kind and id ('make:torch' -> craft {item: torch}; 'farm:2' -> harvest {at: 2}). */
export function skillOf(o: ChoiceOption): { skill: string; args: Record<string, string> } {
  const parts = o.id.split(':');
  // (#164's board entries carry kinds of other families: their ids say what they are)
  if (/^(claim|report|custom|post)$/.test(parts[0])) return { skill: 'board', args: { [parts[0]]: parts.slice(1).join(':') } };
  const skill = SKILL[o.kind] ?? o.kind;
  if (o.kind === 'make' || o.kind === 'gather') return { skill, args: { item: parts.slice(1).join(':') } };
  if (o.kind === 'iron') return { skill, args: { step: parts.slice(1).join(':') || 'dig' } };
  return { skill, args: parts.length > 1 ? { what: parts[0], at: parts.slice(1).join(':') } : { what: parts[0] } };
}
