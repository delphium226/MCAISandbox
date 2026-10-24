/**
 * Character archetypes (#115, spec 2b): the monoculture presets and culture mixes, pure and world-free so a profile's
 * check (profiles.ts) can read them without character.ts' state. character.ts applies them to members.
 */

// (choose.ts' seeded helpers, copied: choose.ts imports character.ts, whose draws run at load)
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffled<T>(xs: T[], seed: string): T[] {
  const out = [...xs];
  const rnd = mulberry32(fnv1a(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface Preset { hex: Record<'H' | 'E' | 'X' | 'A' | 'C' | 'O', number>; values: Record<'openness' | 'conservation' | 'enhancement' | 'transcendence', number>; goal: string }

/** The built-in archetypes: a value profile, matching traits and a life goal each (drafts from
 *  docs/research/character-model-v2.md's value circumplex; each to be checked with a choicebench before use). */
export const BUILT_IN: Readonly<Record<string, Preset>> = {
  // (a wealth-seeker: out for itself, hard-working and steady, a little outgoing for trade, slow to forgive, conventional)
  wealth: { hex: { H: -0.7, E: -0.3, X: 0.3, A: -0.3, C: 0.7, O: -0.1 }, values: { openness: 0.3, conservation: 0.45, enhancement: 0.9, transcendence: 0.15 }, goal: 'wealth' },
  // (an inventor: curious and unconventional above all, fairly diligent, mildly cooperative: new crafts and research)
  invention: { hex: { H: 0.1, E: -0.1, X: 0.1, A: 0.1, C: 0.3, O: 0.8 }, values: { openness: 0.9, conservation: 0.15, enhancement: 0.4, transcendence: 0.35 }, goal: 'invention' },
  // (a community member: fair, warm, forgiving and outgoing: helping, works and care for others)
  community: { hex: { H: 0.6, E: 0.3, X: 0.5, A: 0.7, C: 0.3, O: 0.1 }, values: { openness: 0.3, conservation: 0.45, enhancement: 0.15, transcendence: 0.9 }, goal: 'standing' },
  // (a traditionalist: dutiful and orderly, reserved, conventional: steady farming, keeping the rules)
  tradition: { hex: { H: 0.3, E: 0.1, X: -0.2, A: 0.3, C: 0.8, O: -0.7 }, values: { openness: 0.1, conservation: 0.9, enhancement: 0.3, transcendence: 0.45 }, goal: 'home' },
  // (a lover of beauty: open and sensitive, gentle, not driven: furnishing and decoration)
  beauty: { hex: { H: 0.2, E: 0.5, X: 0.1, A: 0.3, C: 0.1, O: 0.8 }, values: { openness: 0.85, conservation: 0.25, enhancement: 0.2, transcendence: 0.6 }, goal: 'beauty' },
};
/** The goals an archetype may name (character.ts' GOALS). */
export const PRESET_GOALS = ['invention', 'beauty', 'mastery', 'home', 'wealth', 'standing'];

/** Custom archetypes ({name: {hex, values, goal}}, MC_CHARACTER_ARCHETYPES' JSON or a profile's "archetypes"), checked:
 *  traits -1..1, values 0..1, a known goal, a plain new name. Throws on a fault. */
export function parseArchetypes(raw: string | Record<string, Preset>): Record<string, Preset> {
  if (typeof raw === 'string' && !raw.trim()) return {};
  const given = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, Preset>;
  const out: Record<string, Preset> = {};
  for (const [name, a] of Object.entries(given)) {
    const n = name.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]*$/.test(n) || n === 'drawn' || n === 'mayor' || BUILT_IN[n]) throw new Error(`archetype "${name}": not a usable name (plain, new, not drawn or mayor)`);
    for (const t of ['H', 'E', 'X', 'A', 'C', 'O'] as const) if (!(Math.abs(Number(a?.hex?.[t])) <= 1)) throw new Error(`archetype ${name}: trait ${t} must be -1..1`);
    for (const k of ['openness', 'conservation', 'enhancement', 'transcendence'] as const) if (!(Number(a?.values?.[k]) >= 0 && Number(a?.values?.[k]) <= 1)) throw new Error(`archetype ${name}: value ${k} must be 0..1`);
    if (!PRESET_GOALS.includes(a?.goal)) throw new Error(`archetype ${name}: goal must be one of ${PRESET_GOALS.join(', ')}`);
    out[n] = { hex: { ...a.hex }, values: { ...a.values }, goal: a.goal };
  }
  return out;
}

/** A mix ("wealth:40,invention:60", `drawn` for the draws, `mayor:<archetype>`) against the known archetypes: its shares
 *  and the Mayor's archetype if named. Throws on a fault. */
export function parseMix(mix: string, known: Record<string, Preset>): { shares: Array<[string, number]>; mayor?: string } {
  const shares: Array<[string, number]> = [];
  let mayor: string | undefined;
  const names = () => `${Object.keys(known).join(', ')}, drawn`;
  for (const part of mix.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    const [k, v] = part.split(':').map((x) => x.trim());
    if (k === 'mayor') {
      if (v !== 'drawn' && !known[v]) throw new Error(`MC_CHARACTER_MIX: mayor:${v}: no such archetype (${names()})`);
      mayor = v;
      continue;
    }
    if (k !== 'drawn' && !known[k]) throw new Error(`MC_CHARACTER_MIX: ${k}: no such archetype (${names()})`);
    const n = Number(v);
    if (!(n > 0)) throw new Error(`MC_CHARACTER_MIX: ${part}: a share must be a number above 0`);
    shares.push([k, n]);
  }
  if (!shares.length) throw new Error('MC_CHARACTER_MIX: no shares');
  return { shares, mayor };
}

/**
 * The workers' archetypes under a mix: counts by largest remainder over `workers` (24 x 40% = 9.6 -> 10), ties to the
 * earlier entry; the workers' order shuffled by `seed`, so a mix is reproducible and another seed reshuffles who gets
 * what. Index i is worker i + 1's archetype.
 */
export function assignMix(shares: Array<[string, number]>, workers: number, seed: string): string[] {
  const total = shares.reduce((t, [, n]) => t + n, 0);
  const exact = shares.map(([k, n]) => ({ k, q: (n / total) * workers }));
  const counts = exact.map((e) => Math.floor(e.q));
  let left = workers - counts.reduce((t, c) => t + c, 0);
  const order = exact.map((e, i) => ({ i, r: e.q - Math.floor(e.q) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const o of order) if (left-- > 0) counts[o.i]++;
  const slots = shuffled(Array.from({ length: workers }, (_, i) => i), `character-mix|${seed}`);
  const out: string[] = new Array(workers);
  let j = 0;
  for (const [i, c] of counts.entries()) for (let n = 0; n < c; n++) out[slots[j++]] = exact[i].k;
  return out;
}

/** The Mayor's archetype under a mix: the one named, else the largest share's (the earlier on a tie). */
export const mixMayor = (m: { shares: Array<[string, number]>; mayor?: string }): string => m.mayor ?? [...m.shares].sort((a, b) => b[1] - a[1])[0][0];
