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
import { BEES_AGE, COPPER_AGE, DIAMOND_AGE, DIAMOND_Y, ENCHANTMENT_AGE, HUSBANDRY_AGE, IRON_AGE, IRON_MINERS, LADDER, LADDER_START, LETTERS, MACHINES_AGE, MAPS_AGE, MUSIC_AGE, NETHER_AGE, SEA_AGE, TRADE_AGE } from './ladderFlags';
import { boatOf } from './enchantSea';
import { BUYS, ORDERS_ON } from './merchant';

export { BEES_AGE, COPPER_AGE, DIAMOND_AGE, ENCHANTMENT_AGE, HUSBANDRY_AGE, IRON_AGE, IRON_MINERS, LADDER, LETTERS, MACHINES_AGE, MAPS_AGE, MUSIC_AGE, NETHER_AGE, NETHER_PARTY, OWN_TOOLS, SEA_AGE, TRADE_AGE } from './ladderFlags';

/** What a stage counts: cells dug at the iron levels, raw iron brought up, ingots smelted, tools given to members; for
 *  letters (MC_LETTERS) sugar cane harvested, leather bought or caught, books bound and library pieces shelved; for diamond
 *  (MC_DIAMOND_AGE) blocks dug down below y 0, diamonds brought up and diamond pickaxes given; for trade (MC_TRADE_AGE) lots sold
 *  to the merchant, market stalls standing, emeralds in storage (its highest since the rung began), orders filled and lots
 *  of crafted goods sold; for copper (MC_COPPER_AGE) raw copper brought up, copper blocks made, the copper canopy built and
 *  the instruments in storage (a lightning rod, a spyglass); for husbandry (MC_HUSBANDRY_AGE) pen kinds holding a breeding
 *  pair, young born in the pens, wool sheared from a pen and hay bales in storage; for music (MC_MUSIC_AGE) redstone bought,
 *  note blocks made, the bandstand built and the bell post built; for machines (MC_MACHINES_AGE) the egg collector fitted, the
 *  rails and minecart stored, the rail line laid and its powered rails confirmed powered; for bees (MC_BEES_AGE) nests with
 *  bees in the apiary, honeycomb sheared, honey bottled and copper blocks waxed; for maps (MC_MAPS_AGE) the cartography
 *  table, the village's own area charted, maps hung on the map wall and areas of the atlas charted; for enchantment
 *  (MC_ENCHANTMENT_AGE) obsidian cast, the enchanting table placed, the highest level a member holds and books enchanted; for
 *  the sea (MC_SEA_AGE) boats made, the dock built, fish caught and the lighthouse built; for the Nether (MC_NETHER_AGE)
 *  the portal lit, Nether blocks brought back, ancient debris dug and a netherite ingot in storage. */
export type Counter = 'cells' | 'raw_iron' | 'ingots' | 'tools' | 'cane' | 'leather' | 'books' | 'shelved' | 'depth' | 'diamonds' | 'dtools'
  | 'sales' | 'stalls' | 'emeralds' | 'orders' | 'crafted' | 'copper' | 'cblocks' | 'croof' | 'instruments'
  | 'pens' | 'bred' | 'wool' | 'hay' | 'redstone' | 'notes' | 'bandstand' | 'bell'
  | 'collector' | 'carts' | 'railline' | 'powered' | 'hives' | 'honeycomb' | 'honey' | 'waxed' | 'ctable' | 'vmap' | 'mapwall' | 'mapped'
  | 'obsidian' | 'etable' | 'xplevel' | 'enchanted' | 'boats' | 'dock' | 'fish' | 'lighthouse'
  | 'portal' | 'nblocks' | 'debris' | 'netherite';

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

/** The machines rung's targets (#24; docs/specs/ladder-rungs.md): one egg collector; 16 rails (one craft of 6 ingots and a
 *  stick) and a minecart (5 ingots) in storage, so stage 2 is 17 pieces; the rail line from the mine to the storage hut
 *  laid (one; the workshop makes the rails its length takes); 6 powered rails (one craft: 6 gold ingots, a stick and a
 *  redstone) laid on a straight of it and confirmed powered by a redstone torch beside them. */
export const MACHINES_RAILS = 16, MACHINES_POWERED = 6;
/** The rail line's longest planned run (cells): a longer one fails its plan, as a path does. */
export const RAIL_LINE_MAX = 160;
/** The bees rung's targets: 2 bee nests housing their bees in the apiary (one work); 16 honeycomb (a full nest gives 3 to
 *  shears, so some 6 shearings); 8 honey bottles (a full nest fills one); the copper canopy's 5 copper blocks waxed with a
 *  honeycomb each (copper's stage 3 left its waxing for this rung). */
export const BEES_NESTS = 2, BEES_COMB = 16, BEES_HONEY = 8, BEES_WAX = COPPER_MADE;
/** The bees rung's work: the apiary (smallWorks.ts RUNG_WORKS), posted once storage holds its nests and campfires. */
export const BEES_APIARY = 'apiary';
/** The maps rung's targets: a cartography table; the village's own area charted (one); the map wall's 4 maps hung; 9 areas
 *  charted, the 3x3 of 128-block map areas around the village's own. */
export const MAPS_WALL = 4, MAPS_ATLAS = 9;
/** The maps rung's work: the map wall (smallWorks.ts RUNG_WORKS), posted once storage holds a cartography table. */
export const MAPS_WALL_WORK = 'map_wall';
/** The enchantment rung's targets (#23; docs/specs/ladder-rungs.md): 4 obsidian, the enchanting table's (a book, 2 diamonds
 *  and 4 obsidian); the table placed in the library (one); 8 levels held by a member (112 experience points: some 16
 *  bottles o' enchanting, or the deep level's lapis, redstone and diamond ores and the furnaces' takes); 5 books enchanted at
 *  the table (its cheapest slot: a level and a lapis each). */
export const ENCHANT_OBSIDIAN = 4, ENCHANT_LEVELS = 8, ENCHANT_BOOKS = 5;
/** The bottles o' enchanting storage keeps while the levels stage wants them (lib:buy buys them, 2 emeralds each). */
export const ENCHANT_BOTTLES = 4;
/** The sea rung's targets: 3 boats made in the village's wood; the dock built (one); 24 fish caught (a fishing trip lands
 *  some 5-8 in its 4 minutes); the lighthouse built (one). */
export const SEA_BOATS = 3, SEA_FISH = 24;
/** The sea rung's work: the lighthouse (smallWorks.ts RUNG_WORKS), posted once storage holds its lantern and lightning rod. */
export const SEA_LIGHTHOUSE = 'lighthouse';

/** The Nether rung's targets (docs/specs/nether.md section 1): a portal frame of 10 obsidian (4 by 5, no corners; the
 *  enchantment rung's 4 went into its table, so the stage casts 10 more with make_obsidian, some 3 trips), lit with a
 *  flint and steel (an ingot and a flint); 64 Nether blocks brought back (a party member brings up to 24 a trip: some 3
 *  member-trips of about 10 minutes); 4 ancient debris dug (the 4 netherite scrap of an ingot; the probe found 6-7 at y
 *  8-22 within 48 blocks of minevale3's far portal); a netherite ingot (4 scrap and 4 gold ingots, the merchant's gold).
 *  About 3 hours at 1x, most of it the obsidian and the debris dig. */
export const NETHER_OBSIDIAN = 10, NETHER_BROUGHT = 64, NETHER_DEBRIS = 4, NETHER_GOLD = 4;
/** What a Nether expedition gathers and counts (and the drops of the ores among them). */
export const NETHER_BLOCKS = ['netherrack', 'blackstone', 'basalt', 'soul_sand', 'soul_soil', 'magma_block', 'nether_quartz_ore', 'nether_gold_ore', 'crimson_nylium', 'warped_nylium', 'glowstone', 'quartz', 'gold_nugget', 'crimson_stem', 'warped_stem', 'nether_wart_block', 'warped_wart_block', 'shroomlight', 'glowstone_dust'];

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
    id: 'enchantment', name: 'the age of enchantment', what: 'obsidian, an enchanting table and enchanted books', after: ['letters', 'diamond'], tier: 4, time: 'about 2-3 hours',
    // (MC_ENCHANTMENT_AGE, #23: obsidian cast where the deep level meets still lava, a water bucket poured and taken back,
    // mined with the diamond rung's pickaxe; the levels are the highest a member holds, the server's `xp query`; the last
    // stage counts enchanted books, an item of their own the server counts, where an enchanted tool is the same item)
    stages: ENCHANTMENT_AGE && IRON_AGE
      ? [
        { words: '{n} of {t} obsidian cast from still lava in the deep mine', counter: 'obsidian', target: ENCHANT_OBSIDIAN, feeds: /^(rung:(fill_bucket|obsidian)|iron:forge:bucket)$/ },
        { words: 'the enchanting table made and placed in the library', counter: 'etable', target: 1, feeds: /^(make:(enchanting_table|book)|rung:place_table)$|^iron:dig\b/ },
        { words: '{n} of {t} experience levels held by the village\'s enchanter', counter: 'xplevel', target: ENCHANT_LEVELS, feeds: /^(rung:xp_bottles|activity:lib:buy:experience_bottle|activity:lib:sell)$|^iron:(dig|smelt)\b/ },
        { words: '{n} of {t} books enchanted at the enchanting table', counter: 'enchanted', target: ENCHANT_BOOKS, feeds: /^(rung:enchant|make:book|activity:lib:buy:lapis_lazuli)$/ },
      ]
      : [{ words: '4 obsidian' }, { words: 'the enchanting table in the library' }, { words: '8 levels held by an enchanter' }, { words: '5 enchanted tools or books' }],
  },
  nether: {
    id: 'nether', name: 'the Nether', what: 'a Nether portal, an expedition through it, ancient debris and a netherite ingot', after: ['enchantment'], tier: 5, time: 'about 3 hours',
    // (MC_NETHER_AGE, docs/specs/nether.md: peaceful only. Piglins are monsters (none on peaceful), so the barter became
    // ancient debris dug; the netherite upgrade's smithing template lies only in bastion chests, so the last stage is the
    // ingot)
    stages: NETHER_AGE && IRON_AGE
      ? [
        { words: 'a Nether portal of 10 obsidian built and lit with a flint and steel', counter: 'portal', target: 1, feeds: /^(rung:(portal|obsidian|fill_bucket|flint)|make:flint_and_steel)$/ },
        { words: '{n} of {t} Nether blocks brought back by expeditions through the portal', counter: 'nblocks', target: NETHER_BROUGHT, feeds: /^rung:expedition$/ },
        { words: '{n} of {t} ancient debris dug in the Nether', counter: 'debris', target: NETHER_DEBRIS, feeds: /^rung:debris$|^diamond:forge\b/ },
        { words: 'a netherite ingot made from the debris and gold', counter: 'netherite', target: 1, feeds: /^(make:netherite_ingot|activity:lib:buy:gold_ingot|activity:lib:sell)$/ },
      ]
      : [{ words: 'a lit portal' }, { words: 'an expedition bringing back 64 Nether blocks' }, { words: '4 ancient debris' }, { words: 'a netherite ingot' }],
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
    // (MC_MACHINES_AGE, #24: the collector a hopper under the chicken pen's floor feeding a chest; the line routed and laid
    // by command; its powered rails' gold and redstone the merchant's)
    stages: MACHINES_AGE && IRON_AGE
      ? [
        { words: 'a hopper egg collector under the chicken pen, feeding a chest', counter: 'collector', target: 1, feeds: /^(penwork:\d+:collector|make:hopper)$/ },
        { words: '{n} of {t} pieces of track made (16 rails and a minecart)', counter: 'carts', target: MACHINES_RAILS + 1, feeds: /^make:(rail|minecart)$/ },
        { words: 'a rail line laid from the mine to the storage hut', counter: 'railline', target: 1, feeds: /^(rung:rail_line|make:rail)$/ },
        { words: '{n} of {t} powered rails on the line, lit by a redstone torch', counter: 'powered', target: MACHINES_POWERED, feeds: /^(rung:power_line|make:(powered_rail|redstone_torch)|activity:lib:sell|activity:lib:buy:(gold_ingot|redstone))$/ },
      ]
      : [{ words: 'a hopper egg collector' }, { words: '16 rails and a minecart' }, { words: 'a rail line from the mine to the hut' }, { words: 'a powered rail line' }],
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
  bees: {
    id: 'bees', name: 'the age of bees', what: 'an apiary of bee nests among flowers, honeycomb, honey and waxed copper', after: ['husbandry', 'copper'], tier: 3, time: 'about 2-3 hours',
    // (MC_BEES_AGE: wild nests are few (4 within 150 blocks of minevale3) and moving one takes Silk Touch, so the merchant
    // sells a nest with its bees and the village sets two over campfires in its own apiary; the waxing is the copper
    // canopy's roof, the copper rung's stage 3)
    stages: BEES_AGE
      ? [
        { words: '{n} of {t} bee nests with their bees in the village apiary, over campfires among flowers', counter: 'hives', target: BEES_NESTS, feeds: /^(help:apiary|make:campfire|activity:lib:buy:bee_nest|activity:lib:sell)$/ },
        { words: '{n} of {t} honeycomb sheared from full bee nests', counter: 'honeycomb', target: BEES_COMB, feeds: /^(rung:apiary:shear|activity:lib:honeycomb|iron:forge:shears)$/ },
        { words: '{n} of {t} honey bottles filled at the apiary', counter: 'honey', target: BEES_HONEY, feeds: /^(rung:apiary:bottle|make:glass_bottle)$/ },
        { words: '{n} of {t} copper blocks of the copper canopy waxed with honeycomb', counter: 'waxed', target: BEES_WAX, feeds: /^(rung:wax_copper|rung:apiary:shear)$/ },
      ]
      : [{ words: '2 bee hives with a campfire under each' }, { words: '16 honeycomb' }, { words: '8 honey bottles' }, { words: 'waxed copper' }],
  },
  maps: {
    id: 'maps', name: 'the age of maps', what: 'a cartography table, a map of the village, a map wall and an atlas of the land', after: ['letters'], tier: 3, time: 'about 2-3 hours',
    // (MC_MAPS_AGE: an explorer map comes only from a cartographer villager's trade and a locator map is any map since
    // 1.20, so the last stage is a 3x3 atlas of the land around the village, each area charted by a member walking into it)
    stages: MAPS_AGE
      ? [
        { words: 'a cartography table made', counter: 'ctable', target: 1, feeds: /^make:cartography_table$/ },
        { words: 'a map of the village\'s own area, made at its centre', counter: 'vmap', target: 1, feeds: /^(rung:chart:-?\d+:-?\d+|make:map|activity:lib:buy:redstone)$/ },
        { words: '{n} of {t} maps of the nearest areas hung in item frames on the village\'s map wall', counter: 'mapwall', target: MAPS_WALL, feeds: /^(rung:chart:-?\d+:-?\d+|rung:hang_maps|help:map_wall|make:(map|item_frame))$/ },
        { words: '{n} of {t} areas of the land around the village charted (a 3x3 atlas)', counter: 'mapped', target: MAPS_ATLAS, feeds: /^(rung:chart:-?\d+:-?\d+|make:map|activity:lib:buy:redstone)$/ },
      ]
      : [{ words: 'a cartography table' }, { words: 'a map of the village' }, { words: 'a map wall' }, { words: 'an explorer map' }],
  },
  sea: {
    id: 'sea', name: 'the age of the sea', what: 'boats, a dock over the water, a fishing fleet and a lighthouse', after: ['copper'], tier: 4, time: 'about 2 hours',
    // (MC_SEA_AGE: prismarine and a conduit need an ocean monument's guardians (hostile, under water), so the draft's last
    // two stages became the fleet's fish and a lighthouse with the copper age's lightning rod on it)
    stages: SEA_AGE
      ? [
        { words: '{n} of {t} boats made for the village\'s fleet', counter: 'boats', target: SEA_BOATS, feeds: /^make:[a-z_]+_(boat|raft)$/ },
        { words: 'a dock built out over the nearest water', counter: 'dock', target: 1, feeds: /^rung:dock$/ },
        { words: '{n} of {t} fish caught by the fleet', counter: 'fish', target: SEA_FISH, feeds: /^(activity:lib:fish|make:fishing_rod)$/ },
        { words: 'a lighthouse built for the fleet', counter: 'lighthouse', target: 1, feeds: /^(help:lighthouse|make:(lantern|lightning_rod))$/ },
      ]
      : [{ words: 'a boat' }, { words: 'a dock' }, { words: 'prismarine from an ocean monument' }, { words: 'a conduit' }],
  },
};
/** The ballot's fixed order: the trunk first, then the branches. */
const ORDER: RungId[] = ['letters', 'diamond', 'enchantment', 'nether', 'copper', 'machines', 'trade', 'husbandry', 'music', 'bees', 'maps', 'sea'];
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
/** The most a pen is bred to: its cap, twice that while husbandry's stage 2 (young bred) is current (rungs test 11-14: three
 *  pens of 5, 8 and 12 were full at 12 young of the 20, and stage 2 could not end). */
export const breedRoom = (v: Village, cap: number): number => (husbandryCurrent(v) && stageCounter(v) === 'bred' ? 2 * cap : cap);
/** Whether music is the current rung (MC_MUSIC_AGE and MC_LADDER on). */
export const musicCurrent = (v: Village): boolean => MUSIC_AGE && LADDER && v.ladder?.current === 'music';

/** Whether machines is the current rung (MC_MACHINES_AGE, MC_IRON_AGE and MC_LADDER on). */
export const machinesCurrent = (v: Village): boolean => MACHINES_AGE && IRON_AGE && LADDER && v.ladder?.current === 'machines';
/** Whether bees is the current rung (MC_BEES_AGE and MC_LADDER on). */
export const beesCurrent = (v: Village): boolean => BEES_AGE && LADDER && v.ladder?.current === 'bees';
/** Whether maps is the current rung (MC_MAPS_AGE and MC_LADDER on). */
export const mapsCurrent = (v: Village): boolean => MAPS_AGE && LADDER && v.ladder?.current === 'maps';
/** Whether enchantment is the current rung (MC_ENCHANTMENT_AGE, MC_IRON_AGE and MC_LADDER on). */
export const enchantmentCurrent = (v: Village): boolean => ENCHANTMENT_AGE && IRON_AGE && LADDER && v.ladder?.current === 'enchantment';
/** Whether the Nether is the current rung (MC_NETHER_AGE, MC_IRON_AGE and MC_LADDER on, a peaceful world). */
export const netherCurrent = (v: Village): boolean => NETHER_AGE && IRON_AGE && LADDER && v.ladder?.current === 'nether';
/** Whether the sea is the current rung (MC_SEA_AGE and MC_LADDER on). */
export const seaCurrent = (v: Village): boolean => SEA_AGE && LADDER && v.ladder?.current === 'sea';
/** The counter of the current rung's current stage ('' with none). */
export const stageCounter = (v: Village): string => (v.ladder?.current ? RUNG_DEFS[v.ladder.current as RungId]?.stages[v.ladder.stage]?.counter ?? '' : '');

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

/**
 * The bees rung's counts from a chore step's message: honeycomb from the apiary's shearing ("sheared 2 full bee nests at the
 * apiary: 6 honeycomb", counted on the server before and after) or from the wild nests' activity ("got 3 honeycomb from 1
 * bee nests ...", once its deposit landed: the world gates it as a trade); honey bottles filled ("filled 2 honey bottles at
 * the apiary"); copper blocks waxed ("waxed 3 copper blocks of the copper canopy", each confirmed by the server). [] with
 * MC_BEES_AGE off.
 */
export function beesCounts(type: string, message: string): Array<[Counter, number]> {
  if (!BEES_AGE) return [];
  const out: Array<[Counter, number]> = [];
  if (type === 'tend_apiary') {
    const c = /^sheared \d+ full bee nests? at the apiary: (\d+) honeycomb\b/.exec(message), h = /^filled (\d+) honey bottles? at the apiary\b/.exec(message);
    if (c) out.push(['honeycomb', Number(c[1])]);
    if (h) out.push(['honey', Number(h[1])]);
  } else if (type === 'harvest_honeycomb') {
    const m = /^got (\d+) honeycomb from\b/.exec(message);
    if (m) out.push(['honeycomb', Number(m[1])]);
  } else if (type === 'wax_copper') {
    const m = /^waxed (\d+) copper blocks? of the copper canopy\b/.exec(message);
    if (m) out.push(['waxed', Number(m[1])]);
  }
  return out.filter(([, q]) => q > 0);
}

/**
 * The enchantment rung's counts from a chore step's message: obsidian cast at the deep level ("made 2 obsidian from still
 * lava at the deep level", counted on the server before and after) and books enchanted ("enchanted 3 books at the enchanting
 * table", the server's count of enchanted books before and after). [] with MC_ENCHANTMENT_AGE off. The table and the levels
 * are levels (levelCounts).
 */
export function enchantCounts(type: string, message: string): Array<[Counter, number]> {
  if (!ENCHANTMENT_AGE || !IRON_AGE) return [];
  const out: Array<[Counter, number]> = [];
  if (type === 'make_obsidian') {
    const m = /^made (\d+) obsidian\b/.exec(message);
    if (m) out.push(['obsidian', Number(m[1])]);
  } else if (type === 'enchant_books') {
    const m = /^enchanted (\d+) books?\b/.exec(message);
    if (m) out.push(['enchanted', Number(m[1])]);
  }
  return out.filter(([, q]) => q > 0);
}

/**
 * The sea rung's counts from a chore step's message: boats a make put into storage ("put into storage: 2 birch_boat") and
 * the fish a fishing trip caught ("caught 5 fish (...)", once the activity's deposit landed: the world gates it as letters'
 * leather). [] with MC_SEA_AGE off. The dock and the lighthouse are levels (levelCounts).
 */
export function seaCounts(type: string, message: string): Array<[Counter, number]> {
  if (!SEA_AGE) return [];
  const out: Array<[Counter, number]> = [];
  if (type === 'make') {
    const m = /put into storage: (\d+) [a-z_]+_(boat|raft)\b/.exec(message);
    if (m) out.push(['boats', Number(m[1])]);
  } else if (type === 'fish') {
    const m = /^caught (\d+) fish\b/.exec(message);
    if (m) out.push(['fish', Number(m[1])]);
  }
  return out.filter(([, q]) => q > 0);
}

/**
 * The Nether rung's counts from a chore step's message: Nether blocks an expedition brought back ("brought back 18 Nether
 * blocks (4 kinds) ...", the member's server counts of NETHER_BLOCKS before it went and once it was back in the overworld;
 * the world counts it once the chore's deposit landed) and ancient debris dug ("dug 2 ancient debris ...", the server's
 * count before and after). [] with MC_NETHER_AGE off. The portal and the ingot are levels (levelCounts).
 */
export function netherCounts(type: string, message: string): Array<[Counter, number]> {
  if (!NETHER_AGE || !IRON_AGE) return [];
  const out: Array<[Counter, number]> = [];
  if (type === 'nether_expedition') {
    const m = /^brought back (\d+) Nether blocks?\b/.exec(message);
    if (m) out.push(['nblocks', Number(m[1])]);
  } else if (type === 'nether_dig') {
    const m = /^dug (\d+) ancient debris\b/.exec(message);
    if (m) out.push(['debris', Number(m[1])]);
  }
  return out.filter(([, q]) => q > 0);
}

/** The netherite items a level counts (the ingot, or anything made of one). */
export const netheriteHeld = (store: Record<string, number>): number => Object.entries(store).filter(([k]) => k === 'netherite_ingot' || k === 'netherite_block' || /^netherite_(pickaxe|axe|shovel|hoe|sword|helmet|chestplate|leggings|boots)$/.test(k)).reduce((n, [, q]) => n + q, 0);

/** The highest experience level a member holds, as `xp query` last read it (the levels stage). */
export function levelsHeld(v: Village): number {
  return Math.max(0, ...Object.values(v.enchant?.levels ?? {}));
}

/**
 * The village's enchanter: the member the levels collect in (the bottles and the enchanting are offered to it alone). The
 * one recorded while it is among `members`, else the member holding the most levels (by name on ties), else none (the
 * first who takes the work becomes it).
 */
export function enchanterOf(v: Village, members: string[]): string | undefined {
  const e = v.enchant?.enchanter;
  if (e && members.includes(e)) return e;
  const lv = v.enchant?.levels ?? {};
  return members.filter((m) => (lv[m] ?? 0) > 0).sort((p, q) => (lv[q] ?? 0) - (lv[p] ?? 0) || p.localeCompare(q))[0];
}

/** A map's area (vanilla's grid at scale 0: 128 blocks a side, the first centred on 0,0): its column and row. */
export const mapCell = (x: number, z: number): [number, number] => [Math.floor((x + 64) / 128), Math.floor((z + 64) / 128)];
/** A map area's blocks. */
export const cellArea = (i: number, j: number) => ({ x1: 128 * i - 64, z1: 128 * j - 64, x2: 128 * i + 63, z2: 128 * j + 63 });
export const cellKey = (i: number, j: number) => `${i},${j}`;
/** The village's centre, where its own map is made: the storage hut's middle, else its first plot's. */
export function villageCentre(v: Village): { x: number; z: number } | null {
  const a = v.storageHut ?? v.plots?.[0];
  return a ? { x: Math.floor((a.x1 + a.x2) / 2), z: Math.floor((a.z1 + a.z2) / 2) } : null;
}
/** The map wall's four areas: the village's own and its neighbours toward the nearest corner of it, as they hang (north
 *  up, west left: nw, ne, sw, se). */
export function wallCells(c: { x: number; z: number }): Array<{ pos: 'nw' | 'ne' | 'sw' | 'se'; cell: [number, number] }> {
  const [i, j] = mapCell(c.x, c.z);
  const i0 = c.x >= 128 * i ? i : i - 1, j0 = c.z >= 128 * j ? j : j - 1;
  return [{ pos: 'nw', cell: [i0, j0] }, { pos: 'ne', cell: [i0 + 1, j0] }, { pos: 'sw', cell: [i0, j0 + 1] }, { pos: 'se', cell: [i0 + 1, j0 + 1] }];
}
/** The atlas: the 3x3 of areas around the village's own. */
export function atlasCells(c: { x: number; z: number }): Array<[number, number]> {
  const [i, j] = mapCell(c.x, c.z);
  const out: Array<[number, number]> = [];
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) out.push([i + di, j + dj]);
  return out;
}
/** Where a member charts an area: the point of it nearest `from`, 8 blocks inside its edges (a map is made for the area
 *  its maker stands in). */
export function chartPoint(cell: [number, number], from: { x: number; z: number }): { x: number; z: number } {
  const a = cellArea(cell[0], cell[1]);
  return { x: Math.max(a.x1 + 8, Math.min(a.x2 - 8, from.x)), z: Math.max(a.z1 + 8, Math.min(a.z2 - 8, from.z)) };
}
/** The areas the maps rung still wants charted for its current stage (the village's own; the wall's four; the atlas' nine),
 *  nearest first. [] when maps is not current. */
export function chartWanted(v: Village): Array<[number, number]> {
  const c = villageCentre(v);
  if (!mapsCurrent(v) || !c) return [];
  const done = v.maps?.cells ?? {}, st = v.ladder!;
  const want = st.stage === 1 ? [mapCell(c.x, c.z)] : st.stage === 2 ? wallCells(c).map((w) => w.cell) : st.stage === 3 ? atlasCells(c) : [];
  const d = (q: [number, number]) => { const p = chartPoint(q, c); return Math.hypot(p.x - c.x, p.z - c.z); };
  return want.filter((q) => !done[cellKey(q[0], q[1])]).sort((p, q) => d(p) - d(q));
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
  const stage = v.ladder?.stage ?? 0, totals = v.ladder?.totals ?? {};
  // (MC_MACHINES_AGE: the collector's hopper; 16 rails and a minecart, then the rails the line still takes; the powered
  // rails and their torch)
  if (machinesCurrent(v)) {
    const line = v.machines?.line;
    if (item === 'hopper') return v.machines?.collector ? have : Math.max(1, have);
    if (item === 'minecart') return stage <= 2 ? Math.max(1, have) : have;
    if (item === 'rail') {
      if (line?.done) return have;
      const left = line?.cells ? line.cells.length - (line.laid ?? 0) : 0;
      return Math.max(stage <= 1 ? MACHINES_RAILS : 0, left);
    }
    if (item === 'powered_rail') return stage === 3 ? Math.max(have, MACHINES_POWERED - (line?.powered?.length ?? 0)) : have;
    if (item === 'redstone_torch') return stage === 3 && !line?.torch ? Math.max(1, have) : have;
    return 0;
  }
  // (MC_BEES_AGE: the apiary's 2 campfires until it is posted; a glass bottle for each honey bottle still to fill)
  if (beesCurrent(v)) {
    if (item === 'campfire') return !rungWorkPosted(v, BEES_APIARY) ? Math.max(BEES_NESTS, have) : have;
    if (item === 'glass_bottle') return stage === 2 ? Math.max(have, BEES_HONEY - (totals.honey ?? 0)) : have;
    return 0;
  }
  // (MC_MAPS_AGE: the cartography table; an empty map for each area still to chart, 4 at a time; the wall's item frames)
  if (mapsCurrent(v)) {
    if (item === 'cartography_table') return stage === 0 || !rungWorkPosted(v, MAPS_WALL_WORK) ? Math.max(1, have) : have;
    if (item === 'map') return Math.max(have, Math.min(4, chartWanted(v).length));
    if (item === 'item_frame') return stage === 2 ? Math.max(have, MAPS_WALL - Object.keys(v.maps?.hung ?? {}).length) : have;
    return 0;
  }
  // (MC_ENCHANTMENT_AGE: the enchanting table until it is placed; a book for it and one for each book still to enchant)
  if (enchantmentCurrent(v)) {
    const table = !!v.enchant?.table;
    if (item === 'enchanting_table') return !table && stage <= 1 ? Math.max(1, have) : have;
    if (item === 'book') return Math.max(have, (table || (store.enchanting_table ?? 0) > 0 ? 0 : 1) + Math.max(0, ENCHANT_BOOKS - (totals.enchanted ?? 0)));
    return 0;
  }
  // (MC_NETHER_AGE: a flint and steel until the portal is lit; the ingot once the debris is dug)
  if (netherCurrent(v)) {
    if (item === 'flint_and_steel') return !v.nether?.portal?.lit ? Math.max(1, have) : have;
    if (item === 'netherite_ingot') return stage === 3 ? Math.max(1, have) : have;
    return 0;
  }
  // (MC_SEA_AGE: the boats still to make, in the village's wood; the lighthouse's lantern and lightning rod until it is
  // posted)
  if (seaCurrent(v)) {
    if (/_(boat|raft)$/.test(item)) return item === boatOf(v.catalogWood ?? v.wood) && stage === 0 ? have + Math.max(0, SEA_BOATS - (totals.boats ?? 0)) : have;
    if (item === 'lantern' || item === 'lightning_rod') return !rungWorkPosted(v, SEA_LIGHTHOUSE) ? Math.max(1, have) : have;
    return 0;
  }
  return 0;
}

/** Whether a rung work of this kind is open or built (an open work holds its own goods as gathered). */
export const rungWorkPosted = (v: Village, kind: string) => (v.initiatives ?? []).some((i) => i.kind === kind && (i.state === 'open' || i.state === 'built'));

/**
 * What storage keeps of a good the merchant sells for a tier-3 rung (the world's tradeKeep, so lib:buy buys it): gold
 * ingots for the machines rung's powered rails while none are made, and redstone for them and their torch; redstone for the
 * compasses of the maps still to make; the apiary's 2 bee nests until it is posted. undefined otherwise.
 */
export function rungKeep(v: Village, item: string, store: Record<string, number>): number | undefined {
  const stage = v.ladder?.stage ?? 0;
  if (machinesCurrent(v) && stage === 3) {
    const line = v.machines?.line, rails = MACHINES_POWERED - (line?.powered?.length ?? 0) - (store.powered_rail ?? 0);
    if (item === 'gold_ingot' && rails > 0) return MACHINES_POWERED;
    if (item === 'redstone') {
      const n = (rails > 0 ? 1 : 0) + (!line?.torch && !(store.redstone_torch ?? 0) ? 1 : 0);
      return n > 0 ? n : undefined;
    }
  }
  if (mapsCurrent(v) && item === 'redstone') {
    const n = Math.min(4, chartWanted(v).length) - (store.map ?? 0) - (store.compass ?? 0);
    return n > 0 ? n : undefined;
  }
  if (beesCurrent(v) && item === 'bee_nest' && stage === 0 && !rungWorkPosted(v, BEES_APIARY)) return BEES_NESTS;
  // (MC_NETHER_AGE: the ingot's 4 gold ingots from the debris stage on, while no ingot is made)
  if (netherCurrent(v) && item === 'gold_ingot' && stage >= 2 && !netheriteHeld(store)) return NETHER_GOLD;
  // (MC_ENCHANTMENT_AGE: bottles o' enchanting while the levels stage is current; a lapis for each book still to enchant)
  if (enchantmentCurrent(v)) {
    if (item === 'experience_bottle' && stage === 2) return ENCHANT_BOTTLES;
    if (item === 'lapis_lazuli' && stage >= 2) {
      const n = ENCHANT_BOOKS - (v.ladder?.totals?.enchanted ?? 0);
      return n > 0 ? n : undefined;
    }
  }
  return undefined;
}

/** Whether a rung work of this kind stands built in the village. */
const builtWork = (v: Village, kind: string) => (v.initiatives ?? []).some((i) => i.kind === kind && i.state === 'built');

/**
 * What storage keeps of a good the merchant sells for the music rung (the world's tradeKeep, so lib:buy buys it): redstone,
 * one for each note block still to make; the bell, one while the bell post is neither built nor posted (an open post holds
 * its bell as gathered). undefined otherwise.
 */
export function musicKeep(v: Village, item: string, store?: Record<string, number>): number | undefined {
  if (!musicCurrent(v)) return undefined;
  if (item === 'redstone') {
    // (rungs test 11-14: stage 1 counts redstone bought, so while it is short the keep stays over what storage holds:
    // redstone already in storage made the 8 note blocks with 4 bought, the keep fell to none and stage 1 never ended)
    const notes = Math.max(0, MUSIC_NOTES - (v.ladder?.totals?.notes ?? 0));
    const buy = Math.max(0, MUSIC_REDSTONE - (v.ladder?.totals?.redstone ?? 0));
    const left = Math.max(notes, buy ? (store?.redstone ?? 0) + buy : 0);
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
  // (machines: the collector fitted, rails and a minecart stored, the line laid, its powered rails confirmed powered; each
  // record written by its skill after the server confirmed the blocks)
  if (machinesCurrent(v)) {
    const m = v.machines;
    lv.push(['collector', m?.collector ? 1 : 0], ['carts', Math.min(MACHINES_RAILS, store.rail ?? 0) + Math.min(1, store.minecart ?? 0)],
      ['railline', m?.line?.done ? 1 : 0], ['powered', Math.min(MACHINES_POWERED, m?.line?.powered?.length ?? 0)]);
  }
  // (bees: the apiary's nests that took their bees; maps: the table made, the village's area charted, maps hung, the atlas)
  if (beesCurrent(v)) lv.push(['hives', Math.min(BEES_NESTS, v.apiary?.housed?.length ?? 0)]);
  if (mapsCurrent(v)) {
    const c = villageCentre(v), cells = v.maps?.cells ?? {};
    const own = c ? mapCell(c.x, c.z) : null;
    lv.push(['ctable', (store.cartography_table ?? 0) > 0 || built(MAPS_WALL_WORK) > 0 ? 1 : 0], ['vmap', own && cells[cellKey(own[0], own[1])] ? 1 : 0],
      ['mapwall', Math.min(MAPS_WALL, Object.keys(v.maps?.hung ?? {}).length)], ['mapped', c ? atlasCells(c).filter((q) => cells[cellKey(q[0], q[1])]).length : 0]);
  }
  // (enchantment: the table placed, as the server showed it; the highest level a member holds, as `xp query` read it.
  // The sea: the dock whole, the lighthouse built)
  if (enchantmentCurrent(v)) lv.push(['etable', v.enchant?.table ? 1 : 0], ['xplevel', Math.min(ENCHANT_LEVELS, levelsHeld(v))]);
  if (seaCurrent(v)) lv.push(['dock', v.sea?.dock?.done ? 1 : 0], ['lighthouse', built(SEA_LIGHTHOUSE)]);
  // (the Nether: the portal lit, as the server showed its six inner cells; a netherite ingot (or a netherite good) stored)
  if (netherCurrent(v)) lv.push(['portal', v.nether?.portal?.lit ? 1 : 0], ['netherite', Math.min(1, netheriteHeld(store))]);
  return lv.map(([c, n]): [Counter, number] => [c, n - (st.totals?.[c] ?? 0)]).filter(([, n]) => n > 0);
}

/** The tag on an option that feeds the current stage; with a wage (#250, MC_RUNG_WAGE with MC_PAY), what it pays. */
export function stageTag(v: Village, wage = 0): string {
  const pays = wage > 0 ? `, pays ${wage} emerald${wage === 1 ? '' : 's'}` : '';
  return v.ladder?.current ? `[for ${RUNG_DEFS[v.ladder.current as RungId]?.name ?? v.ladder.current}${pays}]` : '';
}

/** The progress line's wage sentence (#250): '' without one. */
export const wageWords = (wage: number) => (wage > 0 ? ` The village pays ${wage} emerald${wage === 1 ? '' : 's'} into your chest for each chore that feeds its ambition (up to ${Math.max(wage, 5)} a day).` : '');

/** The progress line in every member's prompt ('' with the flag off), with the latest news for a village day; `wage`
 *  (#250, MC_RUNG_WAGE with MC_PAY) the village's wage for work on the ambition, said after the stage. */
export function progressLine(v: Village, now: number, dayMs: number, wage = 0): string {
  const st = LADDER ? v.ladder : undefined;
  if (!st) return '';
  const news = st.news && now - st.news.t < dayMs ? ` ${st.news.text}` : '';
  if (st.current) {
    const def = RUNG_DEFS[st.current as RungId];
    const sd = def?.stages[st.stage];
    if (!def || !sd) return '';
    const what = sd.counter && sd.target ? fill(sd.words, st.count, sd.target) : `${sd.words} (this stage's work is not built yet)`;
    return `The village's ambition: ${def.name}, stage ${st.stage + 1} of 4: ${what}.${wageWords(wage)}${news}`.slice(0, wage > 0 ? 440 : 300);
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
  // (a rung that can never be offered, one of its earlier rungs neither reached nor reachable (maps or enchantment with
  // MC_LETTERS off), does not hold its tier open: the next tier is offered once the rest of this one is reached)
  const reachable = (r: RungId): boolean => rungImplemented(r) && RUNG_DEFS[r].after.every((a) => reached.has(a) || reachable(a));
  const open = ORDER.filter((r) => reachable(r) && !reached.has(r) && r !== st?.current);
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
