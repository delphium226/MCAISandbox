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
import { LADDER } from './ladderFlags';

export { IRON_AGE, IRON_MINERS, LADDER, OWN_TOOLS } from './ladderFlags';

/** What a stage counts: cells dug at the iron levels, raw iron brought up, ingots smelted, tools given to members. */
export type Counter = 'cells' | 'raw_iron' | 'ingots' | 'tools';

export interface StageDef {
  /** The stage in words, with {n} and {t} for the count and the target where it is counted. */
  words: string;
  counter?: Counter;
  target?: number;
  /** Option ids that feed it (tagged "[for <rung>]" with vw). */
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

/** The rungs (spec section 3, sized by draft 2's B1 for iron). Only iron's stages are counted by code so far. */
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
    stages: [{ words: 'a sugar cane farm' }, { words: '27 paper' }, { words: '9 books (leather bought from the merchant)' }, { words: 'a library: 3 bookshelves and a lectern' }],
  },
  diamond: {
    id: 'diamond', name: 'the diamond age', what: 'a deep mine past lava, diamonds and a diamond pickaxe', after: ['iron'], time: 'about 3-4 hours',
    stages: [{ words: 'the deep stair from the iron level down to y -32' }, { words: '4 iron pickaxes held by deep miners' }, { words: '10 diamonds' }, { words: 'a diamond pickaxe' }],
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
  return v.ladder;
}

const stageKey = (rung: string, stage: number) => `${rung}:${stage}`;

/** The members who did most of a stage's work. */
export function topWorkers(st: LadderState, rung: string, stage: number, n = 3): string[] {
  const w = st.work[stageKey(rung, stage)] ?? {};
  return Object.entries(w).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([m]) => m);
}

/**
 * Work done: `n` of `counter` by `member`. Counts toward the current stage when that stage counts it (each counter runs
 * from its stage's start); a stage that reaches its target ends, and the last ends the rung. Returns the news (a stage
 * or the rung) or null. The caller saves the village and spreads the news (dawn line, chronicle, log).
 */
export function noteLadder(v: Village, counter: Counter, member: string, n: number, now: number, day?: number): LadderNews | null {
  const st = ladderOf(v, now);
  if (!st?.current || n <= 0) return null;
  const def = RUNG_DEFS[st.current as RungId];
  const sd = def?.stages[st.stage];
  if (!sd || sd.counter !== counter || !sd.target) return null;
  const key = stageKey(def.id, st.stage);
  const w = (st.work[key] ??= {});
  w[member] = (w[member] ?? 0) + n;
  st.count = Math.min(sd.target, st.count + n);
  if (st.count < sd.target) return null;
  (st.ends ??= {})[key] = now;
  const workers = topWorkers(st, def.id, st.stage);
  const done = fill(sd.words, sd.target, sd.target).replace(/^\d+ of /, '');
  if (st.stage < 3) {
    const news: LadderNews = { kind: 'stage', rung: def.id, stage: st.stage, workers, text: `The village finished stage ${st.stage + 1} of ${def.name} (${done})${workers.length ? `, mostly by ${words(workers)}` : ''}.` };
    st.stage++;
    st.stageStart = now;
    st.count = 0;
    st.news = { t: now, text: news.text };
    return news;
  }
  const all = [0, 1, 2, 3].map((i) => topWorkers(st, def.id, i));
  st.reached.push({ rung: def.id, t: now, ...(day !== undefined ? { day } : {}), workers: all });
  const names = [...new Set(all.flat())].slice(0, 5);
  const news: LadderNews = { kind: 'rung', rung: def.id, stage: 3, workers: names, text: `The village reached ${def.name}${day !== undefined ? ` on day ${day}` : ''}${names.length ? `, thanks most to ${words(names)}` : ''}.` };
  st.current = undefined;
  st.stage = 0;
  st.count = 0;
  st.stageStart = now;
  st.news = { t: now, text: news.text };
  return news;
}

/** Whether an option feeds the current stage (it gets the tag and `vw`). */
export function feedsStage(v: Village, optionId: string): boolean {
  const st = LADDER ? v.ladder : undefined;
  const sd = st?.current ? RUNG_DEFS[st.current as RungId]?.stages[st.stage] : undefined;
  return !!sd?.feeds?.test(optionId);
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
        words: sd.target ? fill(sd.words, st.current === id && st.stage === i ? st.count : got || (st.current === id && i < st.stage) ? sd.target : 0, sd.target) : sd.words,
        counted: !!sd.counter, target: sd.target ?? null, work: st.work[stageKey(id, i)] ?? {}, ended: st.ends?.[stageKey(id, i)] ?? null,
        state: got || (st.current === id && i < st.stage) ? 'done' : st.current === id && i === st.stage ? 'current' : 'later',
      })),
    };
  });
  return { current: st.current ?? null, stage: st.stage, count: st.count, stageStart: st.stageStart, offered: st.offered ?? [], news: st.news ?? null, ballots: st.ballots, rungs };
}
