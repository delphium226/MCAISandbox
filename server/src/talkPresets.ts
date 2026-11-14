/**
 * A preset monument a person names (MC_TALK_PRESETS, on; the user's 11-14; docs/specs/requested-builds.md): "build
 * salisbury cathedral here", "Conwy castle", "the White Tower", "a copy of Notre Dame". The Mayor refused Salisbury as
 * larger than 30x30x30, though the village builds whole cathedrals and castles at 1:3; the 30x30x30 limit is for designed
 * works only.
 *
 * Code matches the person's words against the Gothic cathedrals' and the castles' monument presets (gothicGen's
 * GOTHIC_PRESETS, castleGen's CASTLE_PRESETS; their civic entries are civic.ts' and talkDesign's shortlist already) by
 * name: the preset's id, its description's head ("York Minster", "The White Tower of London") and a few aliases. A name of
 * two words or more matches alone ("notre dame", "white tower", "krak des chevaliers"); a one-word name needs a word of
 * its type beside it ("salisbury cathedral", "conwy castle"), so "build wells" is not Wells Cathedral. Each match is
 * offered on the Mayor's shortlist as a pre-designed building at the monument's scale (MC_MONUMENT_SCALE, 1:3), id
 * "cathedral:salisbury"; the Mayor's pick, or its refusal or "design" while a preset matched (presetPick), becomes an
 * asked record of that type and preset (monument.ts newPresetMonument), queued behind the record under way as a
 * person's civic building is, and built by the monument's machinery (pad, yard, quarry, kiln, stages, jobs).
 *
 * World-free; mcWorld.ts routes, says and begins it.
 */
import { MONUMENT, monumentPlan, newPresetMonument, parsePresetId, presetId, presetTitle } from './monument';
import { GOTHIC_PRESETS } from './gothicGen';
import { CASTLE_PRESETS } from './castleGen';
import { TALK_PRESETS } from './askedWork';
import type { DesignOffer } from './talkDesign';
import type { Respond } from './playerTalk';

export { TALK_PRESETS };

/** Words that name a cathedral, or a castle, beside a one-word name. */
const TYPE_WORDS: Record<'cathedral' | 'castle', RegExp> = {
  cathedral: /\b(cathedrals?|minsters?|abbey|abbeys|churche?s?|basilicas?|duomo|dom|kathedrale|catedral|cattedrale|cathedrale)\b/,
  castle: /\b(castles?|fortress(es)?|forts?|keeps?|citadels?|chateau|castel|castello|castillo|alcazar|burg|schloss|hrad|zamek|palace|stronghold)\b/,
};
/** Names beside the id and the description's head. */
const ALIASES: Record<string, string[]> = {
  white_tower: ['tower of london'], alcazar_segovia: ['alcazar', 'segovia'], st_stephen: ['stephansdom', 'st stephens'], st_vitus: ['st vitus'],
  westminster: ['westminster abbey'], leon: ['pulchra leonina'], notre_dame: ['notre dame de paris'], krak_des_chevaliers: ['krak'],
};

/** Text folded for matching: lower case, no accents, "saint"/"st." as "st", no apostrophes, words split by spaces. */
export function foldName(text: string): string {
  return ` ${text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\bsaint\b/g, 'st').trim()} `;
}

interface PresetName { type: 'cathedral' | 'castle'; preset: string; names: string[] }
let NAMES: PresetName[] | null = null;
/** The monument presets (not the civic ones) and their folded names. */
export function presetNames(): PresetName[] {
  if (NAMES) return NAMES;
  const out: PresetName[] = [];
  const add = (type: 'cathedral' | 'castle', presets: Record<string, { description: string; kind?: string }>) => {
    for (const [preset, p] of Object.entries(presets)) {
      if (p.kind === 'civic') continue;
      const head = p.description.split(':')[0];
      const names = [preset.replace(/_/g, ' '), head, head.split(',')[0], ...(ALIASES[preset] ?? [])].map((n) => foldName(n).trim().replace(/^the /, ''));
      out.push({ type, preset, names: [...new Set(names.filter((n) => n.length >= 3))] });
    }
  };
  add('cathedral', GOTHIC_PRESETS as Record<string, { description: string; kind?: string }>);
  add('castle', CASTLE_PRESETS as Record<string, { description: string; kind?: string }>);
  return (NAMES = out);
}

/** The presets a person's words name (typed ids, "cathedral:salisbury"), the longest name matched first. */
export function presetsNamed(text: string): string[] {
  if (!TALK_PRESETS.on) return [];
  const t = foldName(text);
  const hits: Array<{ id: string; len: number }> = [];
  for (const p of presetNames()) {
    let best = 0;
    for (const n of p.names) {
      if (!new RegExp(` ${n.replace(/ /g, ' ')}s? `).test(t)) continue;
      // (one word: only with a word of its type, "salisbury cathedral"; "build wells" is not Wells Cathedral)
      if (!n.includes(' ') && !TYPE_WORDS[p.type].test(t)) continue;
      best = Math.max(best, n.length + (TYPE_WORDS[p.type].test(t) ? 100 : 0));
    }
    if (best) hits.push({ id: presetId(p.type, p.preset), len: best });
  }
  return hits.sort((a, b) => b.len - a.len).map((h) => h.id);
}

/** The score a preset offer carries on the shortlist: above any civic entry's (at most 22). */
export const PRESET_SCORE = 30;
const offers = new Map<string, DesignOffer & { stages: number }>();
/** A preset as a shortlist offer, drawn as its record would be at the monument's scale (cached). */
export function presetOffer(id: string): (DesignOffer & { stages: number }) | null {
  const p = parsePresetId(id);
  if (!p) return null;
  let o = offers.get(id);
  if (!o) {
    const c = monumentPlan(newPresetMonument(p.type, p.preset, 'oak', 0, ''));
    o = { id, title: presetTitle(p.type, p.preset), kind: p.type, age: 'stone', scale: Math.round(1 / MONUMENT.scale), width: c.design.width, depth: c.design.depth,
      height: c.design.height, blocks: c.design.blocks, jobs: c.jobs.length, stages: c.stageNames.length, score: PRESET_SCORE };
    offers.set(id, o);
  }
  return o;
}

/** The preset offers a person's words name (at most `n`). */
export function presetShortlist(text: string, n = 2): DesignOffer[] {
  return presetsNamed(text).slice(0, n).map(presetOffer).filter((o): o is DesignOffer & { stages: number } => !!o);
}

/**
 * The preset a Mayor's answer builds, or undefined (code verifies the id): its pick when it names a preset offer, else the
 * first preset offer when it refused or answered "design" (the person named a real cathedral or castle the village builds
 * at 1:3, never too big for it); a pick of another listed building or work stands.
 */
export function presetPick(p: Pick<Respond, 'kind' | 'work'>, designs: DesignOffer[]): DesignOffer | undefined {
  const presets = designs.filter((o) => parsePresetId(o.id));
  if (!TALK_PRESETS.on || !presets.length) return undefined;
  const w = (p.work ?? '').trim().toLowerCase();
  if (p.kind === 'build' && w) {
    // (requestbench, 11-14: gpt-oss wrote "conwy", "white_tower" and "cathedral" for the listed ids as often as the ids:
    // the bare preset, the title, any of its names, or its kind when one preset of the kind is listed)
    const f = foldName(w.replace(/_/g, ' ')).trim().replace(/^the /, '');
    const names = (o: DesignOffer) => {
      const x = parsePresetId(o.id)!;
      return presetNames().find((n) => n.type === x.type && n.preset === x.preset)?.names ?? [];
    };
    const hit = presets.find((o) => o.id === w || o.id === w.replace(/[\s-]+/g, '_') || o.id.split(':')[1] === w.replace(/[\s-]+/g, '_')
      || foldName(o.title).trim().replace(/^the /, '') === f || names(o).includes(f))
      ?? (presets.filter((o) => o.kind === f).length === 1 ? presets.find((o) => o.kind === f) : undefined);
    if (hit) return hit;
    return /^design$/.test(w) ? presets[0] : undefined;
  }
  return p.kind === 'refuse' ? presets[0] : undefined;
}
