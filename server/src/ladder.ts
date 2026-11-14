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
import { COPPER_AGE, DIAMOND_AGE, DIAMOND_Y, HUSBANDRY_AGE, IRON_MINERS, LADDER, LADDER_START, LETTERS, MUSIC_AGE, TRADE_AGE } from './ladderFlags';
import { BUYS, ORDERS_ON } from './merchant';

export { COPPER_AGE, DIAMOND_AGE, HUSBANDRY_AGE, IRON_AGE, IRON_MINERS, LADDER, LETTERS, MUSIC_AGE, OWN_TOOLS, TRADE_AGE } from './ladderFlags';

/** What a stage counts: cells dug at the iron levels, raw iron brought up, ingots smelted, tools given to members; for
 *  letters (MC_LETTERS) sugar cane harvested, leather bought or caught, books bound and library pieces shelved; for diamond
 *  (MC_DIAMOND_AGE) blocks dug down below y 0, diamonds brought up and diamond pickaxes given; for trade (MC_TRADE_AGE) lots sold
 *  to the merchant, market stalls standing, emeralds in storage (its highest since the rung began), orders filled and lots
 *  of crafted goods sold; for copper (MC_COPPER_AGE) raw copper brought up, copper blocks made, the copper canopy built and
 *  the instruments in storage (a lightning rod, a spyglass); for husbandry (MC_HUSBANDRY_AGE) pen kinds holding a breeding
 *  pair, young born in the pens, wool sheared from a pen and hay bales in storage; for music (MC_MUSIC_AGE) redstone bought,
 *  note blocks made, the bandstand built and the bell post built. */
export type Counter = 'cells' | 'raw_iron' | 'ingots' | 'tools' | 'cane' | 'leather' | 'books' | 'shelved' | 'depth' | 'diamonds' | 'dtools'
  | 'sales' | 'stalls' | 'emeralds' | 'orders' | 'crafted' | 'copper' | 'cblocks' | 'croof' | 'instruments'
  | 'pens' | 'bred' | 'wool' | 'hay' | 'redstone' | 'notes' | 'bandstand' | 'bell';

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
  /** How advanced the rung is (1 iron; 2 letters, trade, copper; 3 diamond, machines; 4 enchantment; 5 the Nether): the
   *  ballot offers a rung only once every implemented rung of a lower tier is reached (the user's, 11-14). */
  tier: number;
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

/** The trade rung's targets (#246; docs/specs/ladder-rungs.md): 20 lots sold (a lot is one offer's 1 emerald: 16 logs,
 *  24 torches, 12 glass...; the merchant buys some 50 lots a restock, every 20 minutes); 3 market stalls standing (the
 *  first, posted at completion, and two more the village posts while the stage is current); 40 emeralds in storage at
 *  once (selling goes on past the usual keep while the rung is current); 10 orders filled with MC_MERCHANT_ORDERS, else 10
 *  lots of the workshop's goods sold (TRADE_GOODS, made a lot over their keep while the rung is current). */
export const TRADE_SALES = 20, TRADE_STALLS = 3, TRADE_EMERALDS = 40, TRADE_ORDERS = 10, TRADE_CRAFTED = 10;
/** The merchant's goods the workshop makes (planks are sawn from logs and not counted; bread only with an appetite). */
export const TRADE_GOODS = ['torch', 'glass', 'stone_bricks', 'bread'];
/** The copper rung's targets (#247): 64 raw copper brought up from the iron mine (about 18 ores); 5 copper blocks (45
 *  ingots), the canopy's roof; the canopy built (one); 2 instruments, a lightning rod (3 ingots) and a spyglass (2 ingots
 *  and an amethyst shard, which the merchant sells while the rung wants one). */
export const COPPER_RAW = 64, COPPER_MADE = 5, COPPER_INSTRUMENTS = 2;
/** The copper rung's work: the small work (smallWorks.ts RUNG_WORKS) whose roof is the stage 2 blocks. */
export const COPPER_CANOPY = 'copper_canopy';
const TRADE_FEEDS = /^(activity:lib:sell|make:(torch|glass|stone_bricks|bread))$/;

/** The husbandry rung's targets (docs/specs/ladder-rungs.md): pens of 3 kinds (of chicken, sheep, pig, cow, rabbit, goat)
 *  each holding a breeding pair; 20 young born in the pens (breed_pen's count of the pen before and after, from the server);
 *  32 wool sheared from a pen's flock (a sheep gives 1-3, so some 16 shearings); 8 hay bales in storage at once (72 wheat,
 *  about 4 harvests of a neighbourhood field). */
export const HUSBANDRY_PENS = 3, HUSBANDRY_BRED = 20, HUSBANDRY_WOOL = 32, HUSBANDRY_HAY = 8;
/** The music rung's targets: 8 redstone bought (one a note block), 8 note blocks made (an octave of a scale), the bandstand
 *  built of them (one), the bell post built (one; the bell bought from the merchant). */
export const MUSIC_REDSTONE = 8, MUSIC_NOTES = 8;
/** The music rung's works (smallWorks.ts RUNG_WORKS), posted by the village while their stage is current. */
export const MUSIC_BANDSTAND = 'bandstand', MUSIC_BELL_POST = 'bell_post';

/** The rungs (spec section 3, sized by draft 2's B1 for iron). Iron's stages are counted by code, and letters' with
 *  MC_LETTERS. */
export const RUNG_DEFS: Record<RungId, RungDef> = {
  iron: {
    id: 'iron', name: 'the iron age', what: 'iron mining, smelting and iron tools for members', after: [], tier: 1, time: 'about 2-3 hours',
    stages: [
      { words: '{n} of {t} cells dug at the iron levels', counter: 'cells', target: 600, feeds: /^iron:dig\b/ },
      { words: '{n} of {t} raw iron brought up', counter: 'raw_iron', target: 30, feeds: /^iron:dig\b/ },
      { words: '{n} of {t} iron smelted to ingots at the works furnaces', counter: 'ingots', target: 24, feeds: /^iron:smelt\b/ },
      { words: '{n} of {t} iron tools given to members who need them', counter: 'tools', target: 10, feeds: /^iron:forge\b/ },
    ],
  },
  letters: {
    id: 'letters', name: 'the age of letters', what: 'paper, books and a library', after: ['iron'], tier: 2, time: 'about 2-3 hours',
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
    id: 'diamond', name: 'the diamond age', what: 'a deep mine past lava, diamonds and a diamond pickaxe', after: ['iron'], tier: 3, time: 'about 3-4 hours',
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
    id: 'enchantment', name: 'the age of enchantment', what: 'obsidian, an enchanting table and enchanted tools', after: ['letters', 'diamond'], tier: 4, time: 'about 3-4 hours',
    stages: [{ words: '4 obsidian' }, { words: 'the enchanting table in the library' }, { words: '8 levels held by an enchanter' }, { words: '5 enchanted tools or books' }],
  },
  nether: {
    id: 'nether', name: 'the Nether', what: 'a portal, an expedition, piglin barter and netherite', after: ['enchantment'], tier: 5, time: 'many hours',
    stages: [{ words: 'a lit portal' }, { words: 'an expedition bringing back 64 Nether blocks' }, { words: '20 barters with piglins at a bastion' }, { words: 'a netherite upgrade' }],
  },
  copper: {
    id: 'copper', name: 'the copper age', what: 'copper from the mine, copper roofs, a lightning rod and a spyglass', after: ['iron'], tier: 2, time: 'about 2 hours',
    // (MC_COPPER_AGE, #247: waxing needs honeycomb, so bees; stage 3 is a copper roof instead, the canopy of stage 2's blocks)
    stages: COPPER_AGE
      ? [
        { words: '{n} of {t} raw copper kept from the iron mine\'s copper ore', counter: 'copper', target: COPPER_RAW, feeds: /^iron:dig\b/ },
        { words: '{n} of {t} copper blocks made for a copper roof', counter: 'cblocks', target: COPPER_MADE, feeds: /^make:copper_block$/ },
        { words: 'a copper-roofed canopy built in the village', counter: 'croof', target: 1, feeds: /^help:copper_canopy$/ },
        { words: '{n} of {t} copper instruments made (a lightning rod and a spyglass)', counter: 'instruments', target: COPPER_INSTRUMENTS, feeds: /^(make:lightning_rod|make:spyglass|activity:lib:buy:amethyst_shard)$/ },
      ]
      : [{ words: '64 copper ore kept from the iron mine' }, { words: 'copper blocks and cut copper for a work' }, { words: 'waxed copper roofs' }, { words: 'a lightning rod and a spyglass' }],
  },
  machines: {
    id: 'machines', name: 'the age of machines', what: 'a hopper egg collector, rails and redstone', after: ['iron'], tier: 3, time: 'about 3 hours',
    stages: [{ words: 'a hopper egg collector' }, { words: '16 rails and a minecart' }, { words: 'a rail line from the mine to the hut' }, { words: 'a powered rail line' }],
  },
  trade: {
    id: 'trade', name: 'the age of trade', what: 'merchant sales, market stalls and emeralds', after: ['iron'], tier: 2, time: 'about 2 hours',
    // (MC_TRADE_AGE, #246: the last stage is orders filled only with MC_MERCHANT_ORDERS, off by default; lots of the
    // workshop's goods sold otherwise)
    stages: TRADE_AGE
      ? [
        { words: '{n} of {t} lots sold to the merchant', counter: 'sales', target: TRADE_SALES, feeds: TRADE_FEEDS },
        { words: '{n} of {t} market stalls standing', counter: 'stalls', target: TRADE_STALLS, feeds: /^help:market_stall$/ },
        { words: '{n} of {t} emeralds in the village storage', counter: 'emeralds', target: TRADE_EMERALDS, feeds: TRADE_FEEDS },
        ORDERS_ON
          ? { words: '{n} of {t} merchant orders filled', counter: 'orders', target: TRADE_ORDERS, feeds: /^activity:lib:sell$/ }
          : { words: '{n} of {t} lots of the workshop\'s goods sold (torches, glass, stone bricks, bread)', counter: 'crafted', target: TRADE_CRAFTED, feeds: TRADE_FEEDS },
      ]
      : [{ words: '20 merchant sales' }, { words: 'a market stall per neighbourhood' }, { words: '50 emeralds in the village chest' }, { words: '10 merchant orders filled' }],
  },
  husbandry: {
    id: 'husbandry', name: 'the age of husbandry', what: 'pens of several kinds, bred herds, wool from a flock and a hay store', after: ['iron'], tier: 2, time: 'about 2-3 hours',
    // (MC_HUSBANDRY_AGE: the pens, their breeding and shearing exist (#139, #229); stage 1 is a level, kinds of pen holding a
    // pair; the hay is a level of storage, baled by the workshop while the rung is current)
    stages: HUSBANDRY_AGE
      ? [
        { words: '{n} of {t} kinds of animal penned with a breeding pair', counter: 'pens', target: HUSBANDRY_PENS, feeds: /^(annex|pen:[a-z_]+)$/ },
        { words: '{n} of {t} young animals bred in the pens', counter: 'bred', target: HUSBANDRY_BRED, feeds: /^(penwork:\d+:breed|penwork:\d+:enlarge|penfeed)$/ },
        { words: '{n} of {t} wool sheared from a pen\'s flock', counter: 'wool', target: HUSBANDRY_WOOL, feeds: /^(penwork:\d+:shear|pen:sheep|iron:forge:shears)$/ },
        { words: '{n} of {t} hay bales in the village storage', counter: 'hay', target: HUSBANDRY_HAY, feeds: /^(make:hay_block|farm:\d+|slot:wheat)$/ },
      ]
      : [{ words: 'a breeding pen per animal' }, { words: '20 animals bred' }, { words: 'wool from a flock' }, { words: 'a hay bale store' }],
  },
  music: {
    id: 'music', name: 'the age of music', what: 'note blocks, a bandstand tuned to a scale and a bell in the square', after: ['iron'], tier: 2, time: 'about 2 hours',
    // (MC_MUSIC_AGE: a jukebox needs a diamond (tier 3) and a disc drops only from a creeper a skeleton kills or from a
    // dungeon chest, so the draft's jukebox and disc became the bandstand of tuned note blocks; the bell is bought, as no
    // recipe makes one)
    stages: MUSIC_AGE
      ? [
        { words: '{n} of {t} redstone bought from the merchant for note blocks', counter: 'redstone', target: MUSIC_REDSTONE, feeds: /^(activity:lib:buy:redstone|activity:lib:sell)$/ },
        { words: '{n} of {t} note blocks made', counter: 'notes', target: MUSIC_NOTES, feeds: /^(make:note_block|activity:lib:buy:redstone)$/ },
        { words: 'a bandstand of note blocks tuned to a scale built in the village', counter: 'bandstand', target: 1, feeds: /^help:bandstand$/ },
        { words: 'a bell hung on a post in the village', counter: 'bell', target: 1, feeds: /^(help:bell_post|activity:lib:buy:bell|activity:lib:sell)$/ },
      ]
      : [{ words: 'note blocks' }, { words: 'a jukebox' }, { words: 'a music disc' }, { words: 'a bell in the square' }],
  },
};
/** The ballot's fixed order: the trunk first, then the branches. */
const ORDER: RungId[] = ['letters', 'diamond', 'enchantment', 'nether', 'copper', 'machines', 'trade', 'husbandry', 'music'];
/** The ballot's order, for the checks (a ballot offers at most 4: the lowest tier's first four in this order). */
export const RUNG_ORDER: readonly RungId[] = ORDER;

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

/** Whether trade is the current rung (MC_TRADE_AGE and MC_LADDER on). */
export const tradeCurrent = (v: Village): boolean => TRADE_AGE && LADDER && v.ladder?.current === 'trade';
/** Whether copper is the current rung (MC_COPPER_AGE and MC_LADDER on). */
export const copperCurrent = (v: Village): boolean => COPPER_AGE && LADDER && v.ladder?.current === 'copper';

/** Whether husbandry is the current rung (MC_HUSBANDRY_AGE and MC_LADDER on). */
export const husbandryCurrent = (v: Village): boolean => HUSBANDRY_AGE && LADDER && v.ladder?.current === 'husbandry';
/** Whether music is the current rung (MC_MUSIC_AGE and MC_LADDER on). */
export const musicCurrent = (v: Village): boolean => MUSIC_AGE && LADDER && v.ladder?.current === 'music';

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

/**
 * #247 (MC_COPPER_AGE): a copper good's target in storage while copper is the current rung, as the stock plus what is
 * still wanted: copper blocks, COPPER_MADE less those counted; once they are made, one lightning rod and one spyglass.
 * 0 when copper is not current.
 */
export function copperTarget(v: Village, item: string, store: Record<string, number>): number {
  if (!copperCurrent(v)) return 0;
  const left = Math.max(0, COPPER_MADE - (v.ladder?.totals?.cblocks ?? 0)), have = store[item] ?? 0;
  if (item === 'copper_block') return have + left;
  if ((item === 'lightning_rod' || item === 'spyglass') && !left) return Math.max(1, have);
  return have;
}

/** #247: the amethyst shards storage keeps for the merchant's sale (the world's tradeKeep): one while the copper rung's
 *  spyglass is wanted and none is stored; undefined otherwise. */
export function shardKeep(v: Village, store: Record<string, number>): number | undefined {
  return copperTarget(v, 'spyglass', store) > (store.spyglass ?? 0) ? 1 : undefined;
}

/**
 * The trade rung's counts from a chore step's message (#246): a trade's sale, "sold N item for E emerald", as lots of its
 * standing offer (and lots of crafted goods for TRADE_GOODS), or an order filled (an item no standing offer buys: the
 * trade skill fills an order only then) as one sale and one order. [] with MC_TRADE_AGE off; noteLadder keeps only what
 * the current rung counts.
 */
export function tradeCounts(type: string, message: string): Array<[Counter, number]> {
  if (!TRADE_AGE || type !== 'trade') return [];
  const m = /\bsold (\d+) ([a-z0-9_]+) for \d+ emerald/.exec(message);
  if (!m) return [];
  const n = Number(m[1]), item = m[2], offer = BUYS.find((o) => o.item === item);
  const out: Array<[Counter, number]> = [];
  if (offer) {
    const lots = Math.floor(n / offer.n);
    out.push(['sales', lots]);
    if (TRADE_GOODS.includes(item)) out.push(['crafted', lots]);
  } else out.push(['sales', 1], ['orders', 1]);
  return out.filter(([, q]) => q > 0);
}

/**
 * The copper rung's counts from a chore step's message (#247): the raw copper an iron trip brought up ("brought up ...,
 * N raw copper", mcBuild.ts digIron) and the copper blocks a make put into storage. [] with MC_COPPER_AGE off.
 */
export function copperCounts(type: string, message: string): Array<[Counter, number]> {
  if (!COPPER_AGE) return [];
  const out: Array<[Counter, number]> = [];
  if (type === 'dig_iron') {
    const m = /brought up [^;]*?\b(\d+) raw copper\b/.exec(message);
    if (m) out.push(['copper', Number(m[1])]);
  } else if (type === 'make') {
    const m = /put into storage: (\d+) copper_block\b/.exec(message);
    if (m) out.push(['cblocks', Number(m[1])]);
  }
  return out.filter(([, q]) => q > 0);
}

/**
 * The husbandry rung's counts from a chore step's message: the young a breeding saw born ("fed 2 cows wheat in the pen on
 * annex slot 1: 1 young born, 3 in the pen", breed_pen's count of the pen's entities by the server before and after) and
 * the wool a pen's shearing gave ("sheared 3 sheep in the pen on annex slot 2: 5 wool (...)", given by command and put in
 * storage by the chore's deposit). [] with MC_HUSBANDRY_AGE off.
 */
export function husbandryCounts(type: string, message: string): Array<[Counter, number]> {
  if (!HUSBANDRY_AGE) return [];
  const out: Array<[Counter, number]> = [];
  if (type === 'breed_pen') {
    const m = /: (\d+) young born\b/.exec(message);
    if (m) out.push(['bred', Number(m[1])]);
  } else if (type === 'shear_pen') {
    const m = /^sheared \d+ sheep in the pen on annex slot \d+: (\d+) wool\b/.exec(message);
    if (m) out.push(['wool', Number(m[1])]);
  }
  return out.filter(([, q]) => q > 0);
}

/**
 * The music rung's counts from a chore step's message: redstone a trade bought ("bought N redstone for E emerald", once
 * the activity's deposit landed: the world gates it as letters' leather) and note blocks a make put into storage. [] with
 * MC_MUSIC_AGE off.
 */
export function musicCounts(type: string, message: string): Array<[Counter, number]> {
  if (!MUSIC_AGE) return [];
  const out: Array<[Counter, number]> = [];
  if (type === 'trade') {
    const m = /\bbought (\d+) redstone\b/.exec(message);
    if (m) out.push(['redstone', Number(m[1])]);
  } else if (type === 'make') {
    const m = /put into storage: (\d+) note_block\b/.exec(message);
    if (m) out.push(['notes', Number(m[1])]);
  }
  return out.filter(([, q]) => q > 0);
}

/** The kinds of animal in a built pen holding a breeding pair (2 or more), husbandry's first stage. */
export function pairedPenKinds(v: Village): string[] {
  const kinds = new Set<string>();
  for (const l of v.layouts ?? []) for (const s of l.slots ?? []) if (s.annex && s.kind && s.pen?.built && (s.pen.animals ?? 0) >= 2) kinds.add(s.kind);
  return [...kinds].sort();
}

/**
 * A husbandry or music good's target in storage while its rung is current (the world's makeTarget): hay bales, the
 * rung's HUSBANDRY_HAY at least; note blocks, the stock plus those still to make (MUSIC_NOTES less those counted). 0 when
 * the rung is not current.
 */
export function rungGoodTarget(v: Village, item: string, store: Record<string, number>): number {
  const have = store[item] ?? 0;
  if (item === 'hay_block') return husbandryCurrent(v) ? Math.max(have, HUSBANDRY_HAY) : 0;
  if (item === 'note_block') return musicCurrent(v) ? have + Math.max(0, MUSIC_NOTES - (v.ladder?.totals?.notes ?? 0)) : 0;
  return 0;
}

/** Whether a rung work of this kind stands built in the village. */
const builtWork = (v: Village, kind: string) => (v.initiatives ?? []).some((i) => i.kind === kind && i.state === 'built');

/**
 * What storage keeps of a good the merchant sells for the music rung (the world's tradeKeep, so lib:buy buys it): redstone,
 * one for each note block still to make; the bell, one while the bell post is neither built nor posted (an open post holds
 * its bell as gathered). undefined otherwise.
 */
export function musicKeep(v: Village, item: string): number | undefined {
  if (!musicCurrent(v)) return undefined;
  if (item === 'redstone') {
    const left = Math.max(0, MUSIC_NOTES - (v.ladder?.totals?.notes ?? 0));
    return left > 0 ? left : undefined;
  }
  if (item === 'bell') {
    const posted = (v.initiatives ?? []).some((i) => i.kind === MUSIC_BELL_POST && i.state === 'open');
    return !builtWork(v, MUSIC_BELL_POST) && !posted ? 1 : undefined;
  }
  return undefined;
}

/**
 * The trade and copper rungs' counts that are levels, not events (#246, #247): market stalls standing, emeralds in
 * storage, the copper canopy built, the instruments in storage (a lightning rod, a spyglass: one of each); husbandry's pen
 * kinds holding a pair and hay bales stored; music's bandstand and bell post built. Each as what
 * is new over the rung's total so far, so its total is the highest level seen since the rung began. [] unless one of them
 * is current.
 */
export function levelCounts(v: Village, store: Record<string, number>): Array<[Counter, number]> {
  const st = LADDER ? v.ladder : undefined;
  if (!st?.current) return [];
  const built = (kind: string) => (v.initiatives ?? []).filter((i) => i.kind === kind && i.state === 'built').length;
  const lv: Array<[Counter, number]> = [];
  if (tradeCurrent(v)) lv.push(['stalls', built('market_stall')], ['emeralds', store.emerald ?? 0]);
  if (copperCurrent(v)) lv.push(['croof', built(COPPER_CANOPY)], ['instruments', ((store.lightning_rod ?? 0) > 0 ? 1 : 0) + ((store.spyglass ?? 0) > 0 ? 1 : 0)]);
  // (husbandry: pen kinds holding a pair, hay bales stored; music: the bandstand and the bell post built)
  if (husbandryCurrent(v)) lv.push(['pens', pairedPenKinds(v).length], ['hay', store.hay_block ?? 0]);
  if (musicCurrent(v)) lv.push(['bandstand', built(MUSIC_BANDSTAND)], ['bell', built(MUSIC_BELL_POST)]);
  return lv.map(([c, n]): [Counter, number] => [c, n - (st.totals?.[c] ?? 0)]).filter(([, n]) => n > 0);
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

/** A rung the code can finish: every stage counted (a stage in words only would hold the village on it for good). */
export function rungImplemented(id: RungId): boolean {
  return RUNG_DEFS[id].stages.every((s) => !!s.counter && !!s.target);
}

/** The rungs a ballot may offer now (the user's, 11-14): implemented, not reached, not current, every earlier rung
 *  reached, and of the lowest tier among the implemented rungs not yet reached (simpler rungs first); at most 4. */
export function rungOptions(v: Village): RungId[] {
  const st = v.ladder;
  const reached = new Set((st?.reached ?? []).map((r) => r.rung));
  const open = ORDER.filter((r) => rungImplemented(r) && !reached.has(r) && r !== st?.current);
  if (!open.length) return [];
  const tier = Math.min(...open.map((r) => RUNG_DEFS[r].tier));
  return open.filter((r) => RUNG_DEFS[r].tier === tier && RUNG_DEFS[r].after.every((a) => reached.has(a))).slice(0, 4);
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
