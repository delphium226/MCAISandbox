/**
 * A person's building request in two tiers (MC_TALK_DESIGNS, on; the user's 11-01): the pre-designed buildings first, a
 * coded design when none fits.
 *
 * 1. Pre-designed: code shortlists the civic tier's buildings (civic.ts' sources: the 80 guildhalls, mills, inns,
 *    lighthouses, churches, gates...) whose kind, name or description the person's words name ("windmill" and "mill"
 *    match a mill), and the talk call shows the Mayor that shortlist beside the vanilla works. A pick is built by the
 *    civic path (a civic record: its own site, yard, kiln and jobs) where the person asked, one at a time.
 * 2. Coded: when nothing listed fits, the Mayor answers `design` and the village's architect writes the building as a
 *    short program against the house library (#175, houseProgram.ts), run in a worker, compiled and fitted by code, and
 *    built as a public work. A statue, fountain, arch or other figure is drawn block by block instead (sculpture.ts: box()
 *    and block() in colours code turns into easy blocks, set on a plinth). A program that fails gives the listed building
 *    the Mayor named as nearest, with a line saying what failed; no model (the budget spent) gives a refusal naming it.
 *
 * World-free: the matcher, the offers and their lines, the program prompt and call. mcWorld.ts routes, places and builds.
 *
 * Settings (read once):
 *   MC_TALK_DESIGNS        on (default) | off: the two tiers; off, the Mayor offers the vanilla works alone as before
 *   MC_TALK_PROGRAM_MODEL  the architect's model (default ollama:gpt-oss:120b-cloud, every role's; a local model whose
 *                          server is not reachable falls back to it, mcWorld.ts talkDesignStart)
 */
import { aKind, civicEntries, civicScale, drawCivic, type CivicEntry } from './civic';
import { LIBRARY_DOC, describeSpec, extractProgram, houseFromRun, requoteNotes, runProgramIsolated, type HouseSpec, type ProgramBill } from './houseProgram';
import { SCULPTURE_DOC, fitSculpture, isSculpture, readSculpture, sculptureWords } from './sculpture';
import { familyWords } from './homeDesign';
import { CallWithdrawn, callModel, parseSpec, type ModelSpec } from './modelCall';
import { usage, isCloudModel } from './modelUsage';
import { rawSetting } from './settings';
import type { Design } from './village';

/** The architect's model when none is set, and the fallback for a local one that is down. */
export const TALK_ARCHITECT_DEFAULT = 'ollama:gpt-oss:120b-cloud';

export const TALK_DESIGNS = {
  on: !/^(off|0|false|no)$/i.test(rawSetting('MC_TALK_DESIGNS') ?? 'on'),
  // (11-12: the cloud model by default, as every role's: the local qwen3.8 it had is not running in cloud-only runs, and
  // the Mayor then could not have a chicken statue drawn; a local model set here that is down falls back to `fallback`)
  model: parseSpec(rawSetting('MC_TALK_PROGRAM_MODEL') || TALK_ARCHITECT_DEFAULT),
  fallback: parseSpec(TALK_ARCHITECT_DEFAULT),
};
/** Test hook. */
export function setTalkDesigns(s: Partial<typeof TALK_DESIGNS>): void { Object.assign(TALK_DESIGNS, s); }

/** A request's piece for a civic building ("civic:pitstone_windmill"), and back. */
export const CIVIC_PIECE = 'civic:';
export const civicPiece = (id: string) => `${CIVIC_PIECE}${id}`;
export const civicIdOf = (piece?: string) => (piece?.startsWith(CIVIC_PIECE) ? piece.slice(CIVIC_PIECE.length) : undefined);
/** A coded design's name prefix: never a dwelling (grow.ts isDwelling), its words without it (playerTalk workWords). */
export const ASKED_PREFIX = 'asked_';

// ---- tier 1: the shortlist ---------------------------------------------------------------------------------------------

/** The words a person may use for each kind (beside the kind's own words). */
const KIND_WORDS: Record<string, string[]> = {
  mill: ['windmill', 'watermill', 'waterwheel', 'gristmill', 'flour mill', 'water wheel'],
  lighthouse: ['beacon', 'light tower'],
  'clock tower': ['clock', 'clocktower'],
  'bell tower': ['belfry', 'bell', 'campanile', 'belltower'],
  'parish church': ['church', 'kirk', 'cathedral'],
  chapel: ['chapel', 'shrine', 'oratory'],
  abbey: ['monastery', 'priory', 'cloister', 'friary', 'convent', 'nunnery', 'cathedral'],
  inn: ['tavern', 'pub', 'alehouse', 'hostel', 'hotel', 'coaching inn'],
  almshouse: ['almshouses', 'hospital', 'hospice', 'poorhouse'],
  'tithe barn': ['barn', 'granary'],
  'market hall': ['market', 'marketplace', 'market house'],
  guildhall: ['guild', 'town hall', 'townhall', 'city hall', 'council', 'rathaus', 'hall'],
  'tower house': ['castle', 'keep', 'fort', 'fortress', 'stronghold', 'peel tower'],
  'town gate': ['gatehouse', 'barbican', 'gateway', 'city gate'],
  'fortified manor': ['manor', 'mansion', 'manor house'],
  watchtower: ['lookout', 'guard tower', 'tower'],
};
const QUIET = new Set(['the', 'and', 'of', 'a', 'an', 'at', 'on', 'in', 'st', 'by', 'to', 'for', 'with', 'its', 'old', 'new', 'great', 'little',
  'please', 'build', 'make', 'mayor', 'could', 'would', 'want', 'need', 'some', 'like', 'have', 'here', 'there', 'near', 'next', 'river',
  'village', 'town', 'water', 'lake', 'forest', 'woods', 'trees', 'north', 'south', 'east', 'west', 'side', 'small', 'large', 'big', 'tall', 'nice',
  'beautiful', 'real', 'proper', 'building', 'house', 'stone', 'timber', 'wood', 'wooden', 'brick', 'under', 'over', 'from', 'with', 'their',
  'two', 'three', 'four', 'storey', 'storeys', 'roof', 'walls', 'oldest', 'largest', 'last']);

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** A text's words, plurals folded ("mills" -> "mill"). */
export function wordsOf(text: string): string[] {
  return (fold(text).match(/[a-z]+/g) ?? []).map((w) => (w.length > 4 && /[^s]s$/.test(w) ? w.slice(0, -1) : w));
}
const has = (t: string, phrase: string) => new RegExp(`\\b${phrase.replace(/ /g, '\\s+')}s?\\b`).test(t);

/** How well a request's words name an entry: 10 a kind word (its own or a synonym; two kind words 20), 6 a word of its
 *  name, 1 a word of its description (at most 2); 0 none. */
export function matchScore(text: string, e: Pick<CivicEntry, 'kind' | 'title' | 'description' | 'id'>): number {
  const t = fold(text);
  const kindHits = [...new Set([...e.kind.split(' '), e.kind, ...(KIND_WORDS[e.kind] ?? [])])].filter((w) => !QUIET.has(w) && has(t, w));
  // ("clock tower": the clock tower's "clock" and "tower" are two hits, the watchtower's "tower" one)
  const kind = Math.min(2, kindHits.length) * 10;
  const words = new Set(wordsOf(text).filter((w) => w.length >= 4 && !QUIET.has(w)));
  const title = wordsOf(`${e.title} ${e.id.replace(/_/g, ' ')}`).filter((w) => w.length >= 4 && !QUIET.has(w) && !e.kind.split(' ').includes(w));
  const named = title.some((w) => words.has(w)) ? 6 : 0;
  const desc = new Set(wordsOf(e.description).filter((w) => w.length >= 5 && !QUIET.has(w) && words.has(w))).size;
  return kind + named + Math.min(2, desc);
}

/** A pre-designed building offered to the Mayor, drawn at its civic scale. */
export interface DesignOffer { id: string; title: string; kind: string; age: 'timber' | 'stone'; scale: number; width: number; depth: number; height: number; blocks: number; jobs: number; score: number }

/** One entry drawn as an offer (null: wider than a civic site may be, 72). */
function offerOf(e: CivicEntry, score: number): DesignOffer | null {
  const scale = civicScale(e.id), c = drawCivic(e.id, scale), d = c.design;
  if (Math.max(d.width, d.depth) > 72) return null;
  return { id: e.id, title: e.title, kind: e.kind, age: e.age, scale, width: d.width, depth: d.depth, height: d.height, blocks: d.blocks, jobs: c.jobs.length, score };
}

/**
 * The pre-designed buildings a request names (pure but for the drawing's cache): those whose kind or name its words name
 * (score 6 and up), the best first, then the smallest; `standing` (ids already built here) left out; at most `n`.
 */
export function shortlist(text: string, standing: Set<string> = new Set(), n = 4): DesignOffer[] {
  const scored = civicEntries().filter((e) => !standing.has(e.id)).map((e) => ({ e, score: matchScore(text, e) })).filter((x) => x.score >= 6);
  const out: DesignOffer[] = [];
  const offers = scored.map((x) => offerOf(x.e, x.score)).filter((o): o is DesignOffer => !!o).sort((a, b) => b.score - a.score || a.blocks - b.blocks);
  for (const o of offers) {
    if (out.length >= n) break;
    out.push(o);
  }
  return out;
}

/**
 * A few pre-designed buildings of different kinds to show when the words name none (so the Mayor can name the nearest):
 * one per kind, the smallest of each, timber first; `standing` left out; at most `n`.
 */
export function sampler(standing: Set<string> = new Set(), n = 6): DesignOffer[] {
  const best = new Map<string, DesignOffer>();
  for (const e of civicEntries()) {
    if (standing.has(e.id)) continue;
    const o = offerOf(e, 0);
    if (!o) continue;
    const cur = best.get(e.kind);
    if (!cur || o.blocks < cur.blocks) best.set(e.kind, o);
  }
  return [...best.values()].sort((a, b) => Number(a.age === 'stone') - Number(b.age === 'stone') || a.blocks - b.blocks).slice(0, n);
}

/** An offer's line in the talk prompt. */
export const offerLine = (o: DesignOffer) => `- ${o.id}: ${o.title}, ${aKind(o.kind)} (${o.width}x${o.depth}, ${o.height} high, ${o.blocks} blocks)`;

/** The building a model's `work` names among the offers (its id, else its title, else a word of its kind); undefined if
 *  none. Any civic entry by exact id is accepted too (an id the Mayor knew from the list before). */
export function matchDesign(offers: DesignOffer[], asked: string): DesignOffer | undefined {
  const a = asked.trim().toLowerCase().replace(/^(a|an|the)\s+/, '');
  if (!a) return undefined;
  const id = a.replace(/[\s-]+/g, '_');
  const hit = offers.find((o) => o.id === id) ?? offers.find((o) => fold(o.title).replace(/^the /, '') === fold(a)) ?? offers.find((o) => o.kind === a);
  if (hit) return hit;
  const e = civicEntries().find((x) => x.id === id);
  return e ? offerOf(e, 0) ?? undefined : undefined;
}

// ---- tier 2: the coded design ------------------------------------------------------------------------------------------

const PUBLIC_SYSTEM = 'You are the architect of a Minecraft village. A person asked the village for a public building or a small decorative '
  + 'work (a statue, a fountain, an arch...) that is not in its pattern book, and you draw it. Reply with only a short JavaScript program in one '
  + '```js block that calls the library below, then nothing else.\n\nFor a building:\n'
  + LIBRARY_DOC.replace('note(text)                     one sentence: why this house suits you', 'note(text)                     one sentence: what this building is')
  + '\nThe library was made for houses: make a public building from the same parts so that it reads as what was asked from the street '
  + '(a tower for a lighthouse, a lookout or a belfry; a long body with wings for a hall; stone walls and a base for a strong building; '
  + 'wide windows for a shop or a school).\n\n' + SCULPTURE_DOC;

export interface PublicContext {
  /** The person's own words. */
  text: string;
  /** What to draw, in a few words ("a lighthouse"). */
  what: string;
  family: string;
  wood?: string;
}

/** The architect's prompt for one requested building. */
export function buildPublicPrompt(ctx: PublicContext, budget: number): { system: string; user: string } {
  const lines = [
    `A person said to the Mayor: "${ctx.text.slice(0, 200)}"`,
    `Draw ${ctx.what} for the village.`,
    `The village builds in the ${ctx.family} style (${familyWords(ctx.family, ctx.wood)}).`,
    `Budget: ${budget} units of materials. A plain 5x5 building is about 90 units, a 7x7 one-storey about 120 and two-storey about 215; a wing adds about 45, a tower about 60. A figure costs a unit a block (a solid 5x7x8 statue about 200; code hollows its hidden inside when over). Code cuts what is over the budget.`,
    `Write ${ctx.what} as the person would want it, with note() saying what it is.`,
  ];
  return { system: PUBLIC_SYSTEM, user: lines.join('\n') };
}

export interface PublicRequest {
  agent: string;
  spec: ModelSpec;
  ctx: PublicContext;
  budget: number;
  bill: ProgramBill;
  /** The design's name (an ASKED_PREFIX name). */
  name: string;
  maxWaitMs?: number;
  /** Injected in checks; callModel by default. */
  call?: typeof callModel;
  /** The world's hard-to-gather check on a figure (mcWorld materialTasks' problems): a figure it fails is not drawn. */
  problems?: (d: Design) => string[];
}
export interface PublicResult {
  design: Design | null;
  built?: HouseSpec;
  cuts: string[];
  notes: string[];
  unknown: string[];
  code: string;
  said: string;
  /** What was drawn in words ("a 7x7 two-storey stone bricks building", "a 5x7 statue, 9 high, in diorite...") and whether
   *  it is a figure (sculpture.ts) rather than a building. */
  form?: string;
  figure?: boolean;
  /** Why no building: down (no model server), budget, model (no code), error (the program's), fit (none fits), timeout. */
  why?: 'down' | 'budget' | 'model' | 'error' | 'fit' | 'timeout' | 'withdrawn';
  error?: string;
  ms?: number;
}

/** A coded design in words: "a 7x7 two-storey stone bricks building with a tower" (describeSpec's, not a house). */
export const publicWords = (s: HouseSpec) => describeSpec(s).replace(/ house\b/, ' building');

/** A design name for a request: ASKED_PREFIX, the asked words (dwelling words swapped out) and the request's id. */
export function askedName(what: string, rid: string): string {
  const slug = wordsOf(what).filter((w) => !/^(a|an|the)$/.test(w)).join('_').replace(/house|home|cottage|cabin|hut|lodge|dwelling/g, 'hall').slice(0, 24).replace(/_+$/, '');
  return `${ASKED_PREFIX}${slug || 'building'}_${rid}`;
}

/** A requested building drawn by program; never throws (no design and `why` on any failure: the caller falls back). */
export async function castPublic(req: PublicRequest): Promise<PublicResult> {
  const out: PublicResult = { design: null, cuts: [], notes: [], unknown: [], code: '', said: '' };
  const t0 = Date.now();
  try {
    const p = buildPublicPrompt(req.ctx, req.budget);
    if ((isCloudModel(req.spec.model) && !usage.allows('decisions')) || usage.blocked(req.spec.model, req.agent)) return { ...out, why: 'budget' };
    const r = await (req.call ?? callModel)({
      spec: req.spec, system: p.system, user: p.user, tools: [], level: 'low', agent: req.agent, kind: 'home', priority: 'human',
      fallbackMs: 60000, ...(req.maxWaitMs !== undefined ? { maxWaitMs: Math.max(1000, req.maxWaitMs) } : {}),
    });
    out.ms = r.ms;
    out.code = extractProgram(r.reply.text ?? '');
    if (!/\w+\s*\(/.test(out.code)) return { ...out, why: 'model', error: `no program in the reply: ${(r.reply.text ?? '').slice(0, 100)}` };
    let run = await runProgramIsolated(out.code);
    const fixed = /^syntax/.test(run.error ?? '') ? requoteNotes(out.code) : out.code;
    if (fixed !== out.code) run = await runProgramIsolated(fixed);
    // (a statue, fountain or arch: block() and box() draw a figure, sculpture.ts, not a house)
    if (isSculpture(run.calls)) {
      const notes: string[] = [];
      const sp = readSculpture(run.calls, notes);
      const thing = req.ctx.what.replace(/^(a|an|the)\s+/i, '').split(/\s+/).slice(0, 4).join(' ') || 'figure';
      const f = fitSculpture(sp, req.budget, { ...req.bill, ...(req.problems ? { problems: req.problems } : {}) }, req.name, req.ctx.what);
      out.unknown = run.unknown;
      out.notes = [...notes, ...f.notes];
      out.said = sp.note.trim().replace(/\s+/g, ' ');
      out.figure = true;
      if (run.error) out.error = run.error;
      if (!f.design) return { ...out, why: 'fit', error: f.why ?? run.error };
      out.cuts = f.cuts;
      out.form = sculptureWords(f.design, thing);
      out.design = { ...f.design, name: req.name, description: `${req.ctx.what}: ${out.form}`, by: 'program' };
      return out;
    }
    const h = houseFromRun(run, req.ctx.family, req.budget, req.bill, req.name, req.ctx.wood);
    out.unknown = h.run.unknown;
    out.notes = h.notes;
    out.said = h.spec.note.trim().replace(/\s+/g, ' ');
    if (h.run.error) out.error = h.run.error;
    if (!h.fit) return { ...out, why: h.run.calls.length ? 'fit' : 'error', ...(h.run.calls.length && !out.error ? { error: 'even the plainest building is over the budget' } : {}) };
    out.built = h.fit.spec;
    out.form = publicWords(h.fit.spec);
    out.cuts = h.fit.cuts;
    out.design = { ...h.fit.design, name: req.name, description: `${req.ctx.what}: ${publicWords(h.fit.spec)}`, by: 'program' };
    return out;
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    out.ms = Date.now() - t0;
    const why = err instanceof CallWithdrawn ? 'withdrawn' : /ECONNREFUSED|fetch failed|connect|ENOTFOUND|socket/i.test(msg) ? 'down' : /budget/i.test(msg) ? 'budget'
      : /fallback|timed? ?out/i.test(`${(err as Error)?.name ?? ''} ${msg}`) ? 'timeout' : 'error';
    return { ...out, why, error: msg.slice(0, 120) };
  }
}

/** A failed program's reason in a person's words, with what failed when known (`error`, cut to a clause). */
export function failWords(why: PublicResult['why'], error?: string): string {
  const what = error ? ` (${error.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').slice(0, 100)})` : '';
  return why === 'down' ? `our architect's model cannot be reached just now${what}` : why === 'budget' ? 'our architect has used up its model budget for this hour'
    : why === 'timeout' || why === 'withdrawn' ? 'our architect did not answer in time'
    : why === 'fit' ? `our architect could not make it fit what the village can build${what}` : why === 'model' ? 'our architect answered without a drawing'
    : `our architect's drawing did not work out${what}`;
}
