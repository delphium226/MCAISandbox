/**
 * G8, the ladder of ages (runs/2026-10-22/ladder/spec.md, draft 2 in section 6): the village climbs Minecraft's
 * progression as a ladder of village ambitions. A rung has four stages, each counted by code from the work members do;
 * a progress line goes into every member's prompt, the options that feed the current stage are tagged with `vw` 1.3,
 * and a stage's end is news for a village day (the dawn line) and a chronicle entry. Iron is the first rung (the
 * user's); after each rung a start-of-day ballot (vote.ts topic `rung`) picks the next among those whose earlier rungs
 * are reached. The state lives on the village record (`v.ladder`, village.ts' LadderState); wanted.ts reads `current`
 * and `offered` for the foundry's demand. Pure: no world access; mcWorld.ts calls it.
 */
import type { LadderState, Village } from './village';
import { rungNeeds, type RungId } from './wanted';
import { DIAMOND_AGE, DIAMOND_Y, IRON_MINERS, LADDER, LADDER_START, LETTERS } from './ladderFlags';

export { DIAMOND_AGE, IRON_AGE, IRON_MINERS, LADDER, LETTERS, OWN_TOOLS } from './ladderFlags';

/** What a stage counts: cells dug at the iron levels, raw iron brought up, ingots smelted, tools given to members; for
 *  letters (MC_LETTERS) sugar cane harvested, leather bought or caught, books bound and library pieces shelved; for diamond
 *  (MC_DIAMOND_AGE) blocks dug down below y 0, diamonds brought up and diamond pickaxes given. */
export type Counter = 'cells' | 'raw_iron' | 'ingots' | 'tools' | 'cane' | 'leather' | 'books' | 'shelved' | 'depth' | 'diamonds' | 'dtools';

export interface StageDef {
  /** The stage in words, with {n} and {t} for the count and the target where it is counted. */
  words: string;
  counter?: Counter;
  target?: number;
  /** Option ids that feed it (tagged "[for <rung>]" with vw), or the option's feed alias (feedsStage). */
  feeds?: RegExp;
}

export interface RungDef {
  id: RungId;
  /** "the iron age" */
  name: string;
  /** What it builds, for the ballot's preview. */
  what: string;
  after: RungId[];
  stages: [StageDef, StageDef, StageDef, StageDef];
  /** A rough time, for the preview. */
  time: string;
}

/** The option weight for work that feeds the current stage (inside the character factor's clamp where that is on). */
export const VW = 1.3;

/** The letters rung's targets (runs/2026-10-24/letters/spec.md, the user's 10-24: plains_library_2's 4 shelves and its
 *  lectern, and the enchanting table's book: 16 books, 48 cane, 16 leather). */
export const LETTERS_BOOKS = 16, LETTERS_PIECES = 5, LETTERS_SHELVES = 4;

/** The diamond rung's targets (runs/2026-10-30/diamond/spec.md): the blocks from y 0 down to the diamond level (DIAMOND_Y);
 *  10 diamonds (three pickaxes' 9); a diamond pickaxe for each of the deep miners (IRON_MINERS dig at once). */
export const DIAMOND_DEPTH = -DIAMOND_Y, DIAMOND_FIND = 10, DIAMOND_PICKS = IRON_MINERS;
export { DIAMOND_Y };

/** The rungs (spec section 3, sized by draft 2's B1 for iron). Iron's stages are counted by code, and letters' with
 *  MC_LETTERS. */
export const RUNG_DEFS: Record<RungId, RungDef> = {
  iron: {
    id: 'iron', name: 'the iron age', what: 'iron mining, smelting and iron tools for members', after: [], time: 'about 2-3 hours',
    stages: [
      { words: '{n} of {t} cells dug at the iron levels', counter: 'cells', target: 600, feeds: /^iron:dig\b/ },
      { words: '{n} of {t} raw iron brought up', counter: 'raw_iron', target: 30, feeds: /^iron:dig\b/ },
      { words: '{n} of {t} iron smelted to ingots at the works furnaces', counter: 'ingots', target: 24, feeds: /^iron:smelt\b/ },
      { words: '{n} of {t} iron tools given to members who need them', counter: 'tools', target: 10, feeds: /^iron:forge\b/ },
    ],
  },
  letters: {
    id: 'letters', name: 'the age of letters', what: 'paper, books and a library', after: ['iron'], time: 'about 2-3 hours',
    // (the feeds test the option's id or its alias: a cane slot's harvest is `slot:K:J` whatever it grows, so the world
    // passes `slot:sugar_cane`; the merchant's buy names the item it would buy, `activity:lib:buy:leather`)
    stages: LETTERS
      ? [
        { words: '{n} of {t} sugar cane harvested for paper', counter: 'cane', target: 3 * LETTERS_BOOKS, feeds: /^(start:sugar_cane|slot:sugar_cane|activity:lib:buy:sugar_cane)$/ },
        { words: '{n} of {t} leather brought in', counter: 'leather', target: LETTERS_BOOKS, feeds: /^(activity:lib:buy:leather|activity:lib:sell|activity:lib:fish)$/ },
        { words: '{n} of {t} books bound', counter: 'books', target: LETTERS_BOOKS, feeds: /^make:book$/ },
        { words: '{n} of {t} pieces placed in the library (4 bookshelves and a lectern)', counter: 'shelved', target: LETTERS_PIECES, feeds: /^(make:bookshelf|make:lectern|shelve(:.*)?)$/ },
      ]
      : [{ words: 'a sugar cane farm' }, { words: '27 paper' }, { words: '9 books (leather bought from the merchant)' }, { words: 'a library: 3 bookshelves and a lectern' }],
  },
  diamond: {
    id: 'diamond', name: 'the diamond age', what: 'a deep mine past lava, diamonds and a diamond pickaxe', after: ['iron'], time: 'about 3-4 hours',
    // (the last two count one counter, diamond pickaxes given to deep miners: the first, then one each)
    stages: DIAMOND_AGE
      ? [
        { words: `{n} of {t} blocks dug down below y 0 toward the diamond level at y ${DIAMOND_Y}`, counter: 'depth', target: DIAMOND_DEPTH, feeds: /^iron:dig\b/ },
        { words: '{n} of {t} diamonds brought up', counter: 'diamonds', target: DIAMOND_FIND, feeds: /^iron:dig\b/ },
        { words: 'the first diamond pickaxe made for a deep miner', counter: 'dtools', target: 1, feeds: /^diamond:forge\b/ },
        { words: '{n} of {t} diamond pickaxes given to the deep miners', counter: 'dtools', target: DIAMOND_PICKS, feeds: /^diamond:forge\b/ },
      ]
      : [{ words: 'the deep stair from the iron level down to y -32' }, { words: '4 iron pickaxes held by deep miners' }, { words: '10 diamonds' }, { words: 'a diamond pickaxe' }],
  },
  enchantment: {
    id: 'enchantment', name: 'the age of enchantment', what: 'obsidian, an enchanting table and enchanted tools', after: ['letters', 'diamond'], time: 'about 3-4 hours',
    stages: [{ words: '4 obsidian' }, { words: 'the enchanting table in the library' }, { words: '8 levels held by an enchanter' }, { words: '5 enchanted tools or books' }],
  },
  nether: {
    id: 'nether', name: 'the Nether', what: 'a portal, an expedition, piglin barter and netherite', after: ['enchantment'], time: 'many hours',
    stages: [{ words: 'a lit portal' }, { words: 'an expedition bringing back 64 Nether blocks' }, { words: '20 barters with piglins at a bastion' }, { words: 'a netherite upgrade' }],
  },
  copper: {
    id: 'copper', name: 'the copper age', what: 'copper from the mine, copper roofs, a lightning rod and a spyglass', after: ['iron'], time: 'about 2 hours',
    stages: [{ words: '64 copper ore kept from the iron mine' }, { words: 'copper blocks and cut copper for a work' }, { words: 'waxed copper roofs' }, { words: 'a lightning rod and a spyglass' }],
  },
  machines: {
    id: 'machines', name: 'the age of machines', what: 'a hopper egg collector, rails and redstone', after: ['iron'], time: 'about 3 hours',
    stages: [{ words: 'a hopper egg collector' }, { words: '16 rails and a minecart' }, { words: 'a rail line from the mine to the hut' }, { words: 'a powered rail line' }],
  },
  trade: {
    id: 'trade', name: 'the age of trade', what: 'merchant sales, market stalls and emeralds', after: ['iron'], time: 'about 2 hours',
    stages: [{ words: '20 merchant sales' }, { words: 'a market stall per neighbourhood' }, { words: '50 emeralds in the village chest' }, { words: '10 merchant orders filled' }],
  },
};
/** The ballot's fixed order: the trunk first, then the branches. */
const ORDER: RungId[] = ['letters', 'diamond', 'enchantment', 'nether', 'copper', 'machines', 'trade'];

/** News of a stage or a rung, shown for a village day. */
export interface LadderNews {
  kind: 'stage' | 'rung';
  rung: RungId;
  stage: number;
  text: string;
  /** The members who did most of the stage's work (most first). */
  workers: string[];
}

const fill = (s: string, n: number, t: number) => s.replace('{n}', String(n)).replace('{t}', String(t));
const words = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The village's ladder (started on iron the first time it is asked for, the village complete); undefined with the flag
 *  off. The caller saves the village. */
export function ladderOf(v: Village, now: number): LadderState | undefined {
  if (!LADDER || !v.complete) return undefined;
  v.ladder ??= { current: 'iron', stage: 0, stageStart: now, count: 0, work: {}, reached: [], ballots: [] };
  // (MC_LADDER_START, tests: a later rung, the rungs it needs reached)
  const start = RUNG_DEFS[LADDER_START as RungId];
  if (start && v.ladder.current === 'iron' && !v.ladder.reached.length && !v.ladder.totals) {
    const need = (id: RungId): RungId[] => [...RUNG_DEFS[id].after.flatMap(need), ...RUNG_DEFS[id].after];
    v.ladder.reached = [...new Set(need(start.id))].map((rung) => ({ rung, t: now, workers: [] }));
    v.ladder.current = start.id;
  }
  return v.ladder;
}

const stageKey = (rung: string, stage: number) => `${rung}:${stage}`;

/** The members who did most of a stage's work. */
export function topWorkers(st: LadderState, rung: string, stage: number, n = 3): string[] {
  const w = st.work[stageKey(rung, stage)] ?? {};
  return Object.entries(w).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([m]) => m);
}

/**
 * Work done: `n` of `counter` by `member`. Every counter runs from the rung's start (the user's, 10-23, after IM1: the
 * village smelts and forges while it still digs, and 18 tools given before stage 4 counted for nothing); the stages end in
 * order, each once its counter's total since the rung began reaches its target, several at once when the work is
 * already done. Returns the news of each stage ended (the last may be the rung), oldest first. The caller saves the
 * village and spreads the news (dawn line, chronicle, log).
 */
export function noteLadder(v: Village, counter: Counter, member: string, n: number, now: number, day?: number): LadderNews[] {
  const st = ladderOf(v, now);
  if (!st?.current || n <= 0) return [];
  const def = RUNG_DEFS[st.current as RungId];
  if (!def) return [];
  // (the current stage when it counts this, else the first that does: the diamond rung's last two share one counter)
  const i = def.stages[st.stage]?.counter === counter ? st.stage : def.stages.findIndex((q) => q.counter === counter);
  if (i < 0) return [];
  const totals = (st.totals ??= {});
  totals[counter] = (totals[counter] ?? 0) + n;
  // (the work is credited to the stage that counts it, ended or not)
  const w = (st.work[stageKey(def.id, i)] ??= {});
  w[member] = (w[member] ?? 0) + n;
  const out: LadderNews[] = [];
  for (;;) {
    const sd = def.stages[st.stage];
    const have = sd?.counter ? totals[sd.counter] ?? 0 : 0;
    st.count = sd?.target ? Math.min(sd.target, have) : 0;
    if (!sd?.counter || !sd.target || have < sd.target) break;
    (st.ends ??= {})[stageKey(def.id, st.stage)] = now;
    const workers = topWorkers(st, def.id, st.stage);
    const done = fill(sd.words, sd.target, sd.target).replace(/^\d+ of /, '');
    if (st.stage < 3) {
      const news: LadderNews = { kind: 'stage', rung: def.id, stage: st.stage, workers, text: `The village finished stage ${st.stage + 1} of ${def.name} (${done})${workers.length ? `, mostly by ${words(workers)}` : ''}.` };
      st.stage++;
      st.stageStart = now;
      st.news = { t: now, text: news.text };
      out.push(news);
      continue;
    }
    const all = [0, 1, 2, 3].map((k) => topWorkers(st, def.id, k));
    st.reached.push({ rung: def.id, t: now, ...(day !== undefined ? { day } : {}), workers: all });
    const names = [...new Set(all.flat())].slice(0, 5);
    const news: LadderNews = { kind: 'rung', rung: def.id, stage: 3, workers: names, text: `The village reached ${def.name}${day !== undefined ? ` on day ${day}` : ''}${names.length ? `, thanks most to ${words(names)}` : ''}.` };
    st.current = undefined;
    st.stage = 0;
    st.count = 0;
    st.stageStart = now;
    st.totals = {};
    st.news = { t: now, text: news.text };
    out.push(news);
    break;
  }
  return out;
}

/** Whether an option feeds the current stage (it gets the tag and `vw`): its id, or the alias the world gives it from
 *  what it runs (a cane slot's harvest, the item a trade would buy). */
export function feedsStage(v: Village, optionId: string, alias?: string): boolean {
  const st = LADDER ? v.ladder : undefined;
  const sd = st?.current ? RUNG_DEFS[st.current as RungId]?.stages[st.stage] : undefined;
  return !!sd?.feeds && (sd.feeds.test(optionId) || (!!alias && sd.feeds.test(alias)));
}

/** A rung's counted total since it began (0 when it is not current). */
export function rungTotal(v: Village, rung: RungId, counter: Counter): number {
  const st = LADDER ? v.ladder : undefined;
  return st?.current === rung ? st.totals?.[counter] ?? 0 : 0;
}

/** Whether diamond is the current rung (MC_DIAMOND_AGE and MC_LADDER on). */
export const diamondCurrent = (v: Village): boolean => DIAMOND_AGE && LADDER && v.ladder?.current === 'diamond';

/** Whether letters is the current rung (MC_LETTERS and MC_LADDER on). */
export const lettersCurrent = (v: Village): boolean => LETTERS && LADDER && v.ladder?.current === 'letters';
/** Whether the village has reached letters. */
export const lettersReached = (v: Village): boolean => LETTERS && LADDER && !!v.ladder?.reached.some((r) => r.rung === 'letters');

/**
 * The letters counters from a chore step's message (spec section 9, B3; ladder_unit.mts has each message): cane from a
 * cane slot's harvest that went into storage, net of the cells it replanted; leather from a trade's purchase or a fishing
 * trip's catch; books from a make's puts. The library's pieces are the shelving's own count (`shelved N of M`, new
 * pieces only). [] with MC_LETTERS off.
 */
export function lettersCounts(type: string, message: string): Array<[Counter, number]> {
  if (!LETTERS) return [];
  const out: Array<[Counter, number]> = [];
  if (type === 'harvest_slot') {
    const m = /^harvested (\d+) sugar_cane\b.*?\((\d+) replanted\)/.exec(message);
    if (m && /into the village storage/.test(message)) out.push(['cane', Math.max(0, Number(m[1]) - Number(m[2]))]);
  } else if (type === 'trade') {
    const m = /\bbought (\d+) leather\b/.exec(message);
    if (m) out.push(['leather', Number(m[1])]);
  } else if (type === 'fish') {
    const m = /\b(\d+) leather(?![_a-z])/.exec(message);
    if (m) out.push(['leather', Number(m[1])]);
  } else if (type === 'make') {
    // (the good made comes first; leftovers after it, "put into storage: 1 bookshelf, 2 book", are not books bound)
    const m = /put into storage: (\d+) book\b/.exec(message);
    if (m) out.push(['books', Number(m[1])]);
  } else if (type === 'shelve_library') {
    const m = /^shelved (\d+) of \d+/.exec(message);
    if (m) out.push(['shelved', Number(m[1])]);
  }
  return out.filter(([, n]) => n > 0);
}

/** The tag on an option that feeds the current stage. */
export function stageTag(v: Village): string {
  return v.ladder?.current ? `[for ${RUNG_DEFS[v.ladder.current as RungId]?.name ?? v.ladder.current}]` : '';
}

/** The progress line in every member's prompt ('' with the flag off), with the latest news for a village day. */
export function progressLine(v: Village, now: number, dayMs: number): string {
  const st = LADDER ? v.ladder : undefined;
  if (!st) return '';
  const news = st.news && now - st.news.t < dayMs ? ` ${st.news.text}` : '';
  if (st.current) {
    const def = RUNG_DEFS[st.current as RungId];
    const sd = def?.stages[st.stage];
    if (!def || !sd) return '';
    const what = sd.counter && sd.target ? fill(sd.words, st.count, sd.target) : `${sd.words} (this stage's work is not built yet)`;
    return `The village's ambition: ${def.name}, stage ${st.stage + 1} of 4: ${what}.${news}`.slice(0, 300);
  }
  const last = st.reached[st.reached.length - 1];
  const lastName = last ? RUNG_DEFS[last.rung as RungId]?.name ?? last.rung : '';
  const next = st.offered?.length ? ' The village is choosing its next ambition.' : '';
  return (news || (lastName ? `The village has reached ${lastName}.` : '')) + next;
}

/** The rungs a ballot may offer now: not reached, not current, every earlier rung reached; the trunk first, at most 4. */
export function rungOptions(v: Village): RungId[] {
  const st = v.ladder;
  const reached = new Set((st?.reached ?? []).map((r) => r.rung));
  return ORDER.filter((r) => !reached.has(r) && r !== st?.current && RUNG_DEFS[r].after.every((a) => reached.has(a))).slice(0, 4);
}

/** A rung's preview for the ballot (at most 200 characters): what it builds, its stages, the skills it needs. */
export function rungPreview(id: RungId, ctx?: Parameters<typeof rungNeeds>[1]): string {
  const def = RUNG_DEFS[id];
  const needs = rungNeeds(id, ctx);
  const low = (n: string) => n.charAt(0).toLowerCase() + n.slice(1);
  const ticket = needs.filter((q) => q.how === 'ticket' && q.status !== 'have').map((q) => low(q.name));
  const hand = needs.filter((q) => q.how === 'hand').map((q) => low(q.name));
  const skills = !ticket.length && !hand.length ? 'every skill exists'
    : [ticket.length ? `needs a new skill the foundry must build: ${ticket.join(', ')}` : '', hand.length ? `needs building by hand: ${hand.join(', ')}` : ''].filter(Boolean).join('; ');
  return `${def.what}; ${skills}; ${def.time}`.slice(0, 200);
}

/** A ballot opened on these rungs (wanted.ts reads `offered`). */
export function openRungBallot(v: Village, ids: RungId[]): void {
  if (v.ladder) v.ladder.offered = ids;
}

/** The ballot's winner becomes the current rung, from its first stage. */
export function chooseRung(v: Village, winner: RungId, options: RungId[], now: number): void {
  const st = v.ladder;
  if (!st) return;
  st.ballots.push({ t: now, options, winner });
  st.offered = undefined;
  st.current = winner;
  st.stage = 0;
  st.count = 0;
  st.totals = {};
  st.stageStart = now;
  st.news = { t: now, text: `The village chose ${RUNG_DEFS[winner].name} as its next ambition.` };
}

/** The panel's view: rungs, the current stage, who did each stage's work, the ballots. */
export function ladderView(v: Village): Record<string, unknown> | null {
  const st = v.ladder;
  if (!st) return null;
  const rungs = (Object.keys(RUNG_DEFS) as RungId[]).map((id) => {
    const def = RUNG_DEFS[id];
    const got = st.reached.find((r) => r.rung === id);
    return {
      id, name: def.name, after: def.after, reached: got ? { t: got.t, day: got.day } : null, current: st.current === id,
      stages: def.stages.map((sd, i) => ({
        words: sd.target ? fill(sd.words, got || (st.current === id && i < st.stage) ? sd.target : st.current === id && sd.counter ? Math.min(sd.target, st.totals?.[sd.counter] ?? 0) : 0, sd.target) : sd.words,
        counted: !!sd.counter, target: sd.target ?? null, work: st.work[stageKey(id, i)] ?? {}, ended: st.ends?.[stageKey(id, i)] ?? null,
        state: got || (st.current === id && i < st.stage) ? 'done' : st.current === id && i === st.stage ? 'current' : 'later',
      })),
    };
  });
  return { current: st.current ?? null, stage: st.stage, count: st.count, stageStart: st.stageStart, offered: st.offered ?? [], news: st.news ?? null, ballots: st.ballots, rungs };
}
