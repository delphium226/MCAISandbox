/**
 * Real Minecraft as a world for agents (WorldAdapter): agents are Mineflayer bots on a Java server, and RCON does
 * what bots cannot do themselves (game modes, teleports). Villages are kept in their own registry next to the server's
 * world, since their coordinates belong to that world.
 */
import path from 'node:path';
import minecraftData from 'minecraft-data';
import { VILLAGE_RANGE, FARM_TRIP_RANGE, MINE_TASK, PARTS_MAKE, PICK_GATHER, PICK_SUPPLY, STATION_NAMES, VillageRegistry, WINDOWS, preparedAt, signTask, stationsOwed, villageHome, type Task, type Village } from '../village';
import { MINING_HUT, STORAGE_GROW, STORAGE_HUT } from '../huts';
import type { ActionStatus, ChoiceContext, ChoiceKind, ChoiceMenu, ChoiceMeta, ChoiceOption, ChoiceStatus, ChoiceSummary, ToolDef, WorldAdapter, WorldAgent } from '../world';
import { TOOLS } from '../skills';
import { BotAgent } from './botAgent';
import { MC_SKILLS } from './mcSkills';
import { cellKey, libraryCells, libraryLeft, libraryOf, type LibraryCell } from './mcLibrary';
import { FOUNDRY_SKILLS } from './foundry/list';
import { TOOL } from './mcBlocks';
import { LIBRARY_KEEP, loadLibrary, type LibrarySpec } from '../library';
import { MERCHANT_ON, MERCHANT_RESTOCK_MIN, MERCHANT_TAG, OFFERS, ORDERS_ON, ORDER_EXPIRE_RESTOCKS, ORDER_RAW_CAP, ORDER_SIZE, levelOf, offersCommands, orderPay, ordersOpen, stablePick, stallCell, summonCommand, villageTag, type MerchantOffer, type MerchantOrder } from '../merchant';
import { Vec3 } from 'vec3';
import { collectFilter, collectTargets, exposed, villageStationCell } from './mcSurvival';
import { nearestBlocks, onVillageGround, stateAt } from './mcUtil';
import { annexBusy, biomeAt, cakeShort, harvesting, makeKeeps, seedsForFields, slotBusy, storeBusy, surfaceAt, wheatKeep } from './mcBuild';
import { ironDone, mineAreas, mineCanGive, mineCellsLeft, mineFaces, mineFacesGoing, mineGrowing, mineLights, nearMineFace, type MineLightSpot } from './mcMine';
import { EGGS, PEN_KINDS, PEN_ORDER, PEN_VARIETY, SLOT_KINDS, SLOT_ORDER, penCap, penLure, penPlan, penSlotFit, penWords, worksFurnaces } from '../farmSlots';
import { FOOD_GOODS, GATHER_ALSO, GATHER_KINDS, GATHER_LOGS_HOUR, LETTERS_GOODS, LIGHT_MIN_TRIP, LIGHT_TRIP, MAKE_GOODS, MAKE_KEEP, MAKE_NEVER, MAKE_PARALLEL, MINE_LIGHT_MIN, TORCH_DEMAND_CAP, TORCH_RESERVE, WORKS_FURNACES, FURNISH_TRIP, FURNISH_MIN_TRIP, decorCarried, holdKey, holdsDelete, holdsSet, holdsVersion, lightCarried, makeBill, makeHolds, makeLeft, worksBusy, type MakeGood, type Material } from './mcWorkshop';
import { hasteLevel, timeScale } from './mcRules';
import { choiceId, countsDelta, itemCounts, logChoice, logChoiceBan, logChoiceDrop, logChoiceEnd, type ChoiceDrop, type ChoiceLogOption } from './mcChoiceLog';
import { PROMPT_SELF, UNUSED_GOOD, UNUSED_TAG, ambitionGap, feedKinds, needsLine as basicNeedsLine, scarcityLine, selfLine, type HouseFacts, type SelfFacts } from '../promptSelf';
import { BAN_MEMBER, CHOOSE, ChoiceStats, ChooserQueue, DISLIKED, basicOf, buildPrompt, choose, choreProductive, fixedPick, fnv1a, mulberry32, shuffled, trimMenu, weighted, weights } from '../choose';
import { workerNumber } from '../agentNames';
import { KIND_PHRASE, TEMPERAMENT_MODE, activeKinds, kindWeights, optionWeight, personaOf, temperament, vectorOf } from '../temperament';
import { GOALS_ON, ensureGoals, goalLine, goalScore, goalWeight, goalsOf, noteEnd as goalNoteEnd, serves, topCraft, type Goals, type OptionFacts } from '../goals';
import { IRON_AGE, IRON_MINERS, LADDER, LETTERS, RUNG_DEFS, VW, chooseRung, feedsStage, ladderOf, lettersCounts, lettersCurrent, lettersReached, LETTERS_BOOKS, noteLadder, openRungBallot, progressLine, rungOptions, rungPreview, stageTag, type Counter as LadderCounter, type LadderNews } from '../ladder';
import type { RungId } from '../wanted';
import type { ChronicleEntry } from '../social';
import { BALLOTS_PARALLEL, STYLE_LOOK, VOTE_MAX_MS, VOTE_SETTING, castAll, predictedBallot, predictedChoice, parseStyle, styleOption, tally, woodStyleOptions, type Ballot, type BallotRequest, type StyleHouse, type VoteMode, type VoteOption, type VoteRecord, type VoteTopic } from '../vote';
import { callModel, isTransient, label, parseSpec, type ModelSpec } from '../modelCall';
import { TieredBrain } from '../tieredBrain';
import { REASONING, isCloudModel, usage } from '../modelUsage';
import { LLMBrain } from '../llmBrain';
import { TaskBrain } from '../taskBrain';
import type { AgentBrain } from '../world';
import type { Area, Design, Initiative, Monument, Structure } from '../village';
import { Materials, designBill, designBlockList, gatherNames, gatherTasks, hardToGather, inWood, type Counts, type MaterialPlan } from './mcMaterials';
import { PART_RE, freeSpots, storageContents, storageFlow, storageGross, storageSlots, storageStrays } from './mcStorage';
import { HOME_BASICS, basicsCost, basicsFacts, basicsLeft, basicsOf, freeDecorSlots, houseDecorOf, sheepPlace, woolInHand, type BasicsCells } from './mcHome';
import { HOUSE_DECOR, decorPicks, decorWants } from '../houseDecor';
import { contractOf, deliveriesOf, deliveryWords, earmarked, levyOwed, levySweep, markAtEnd, reconcilePay, startPay, storeByCommand, type PayWorld } from './mcPay';
import { PAY, payOf } from '../pay';
import { INNOVATE, LIBRARY, attemptPoints, candidates, chanceFor, needOf, payRoyalties, pointsIn, ROYALTY, ptsText, techGoods, techOf, techOwnRecipes } from '../tech';
import { BARTER, available, boardOf, draftOffer, lapse, offerText, surplus, wouldTake } from '../barter';
import { CLAIM_AFTER, CLAIM_LAPSE_MS, OWN, OWN_FARM, OWN_FARM_KINDS, farmKindScore, ownFieldReach, OWN_RECIPES, OWN_SALES, OWN_SALES_ON, OWN_SALE_LOTS, LEVY, SHARED, SPECIAL, earnShare, netPut, openWants, ownBatch, ownOf, wantsLine, type Wants } from '../own';
import type { WorldRulesStatus } from './mcRules';
import type { Rcon } from './rcon';
import { Atlas } from './mcAtlas';
import { VILLAGE_BIOMES, listPieces, pieceToDesign, readPiece, vanillaLibrary, vanillaLights, vanillaShelves, villageBiome } from '../vanillaPieces';
import { buildingDecor, buildingLights, decorSlots, type DecorSlot, type HomeBasics, placedDoor, signLabel, type DecorSpot, type LightSpot, type SignPlace, type SignSpot } from '../streetPlan';
import { buildCatalog, type ActivitySpec } from '../activities';
import { LETTERS_PACE } from '../ladderFlags';
import { isPaused } from '../runClock';
import { BED_FLOWERS, FLOWER_MIX, GARDENS, flowerMix, gardenSpots, isFlowerWork, isGarden, menuWorks, mixWords, smallWorkKind, smallWorkSpots, smallWorkWood, type GardenSpot, type SmallWorkKind } from '../smallWorks';
import { FLOWER_ITEMS } from './mcMaterials';
import { TIER_WORDS, parseRefitProject, refitDesign, refitOptions, refitProject } from '../refit';
import { postRefit } from '../layout';
import { signpostText } from '../placeNames';
import { LOW, NEED_TRAIT, needWeight, readNeeds, stepNeed, type NeedKind, type NeedReading } from '../needs';
import { UtilClock, type UtilView } from '../utilisation';
import { FARMSTEAD_ON, NEED_WORKS, addFlow, addMineFlow, farmsteadDue, fieldDue, foodTarget, foodflowReading, madePoints, mineflowReading, stepShort, storedPoints } from '../needWorks';
import { vanillaJar } from '../vanillaData';
import { MEMORY, agentMemory, rosterOf, contentWords as contentWordsOf, focusOf, initMemory, lastLines, logAct, noteEnd as memoryEnd, noteIntent, noteSpawn, recall } from '../memory';
import { tick as clockTick } from '../society';
import { SOCIAL, blockOn, awareness, noteChoice, noteHelp, observe, observing, roleLine, roleNoun, roleOf, socialOff, type Presence } from '../social';
import { ACTS, TALK, actsHelp, actsState, answerLines, deliverAnswer, failAnswer, impliedAccept, newsLines, openRequests, requestersOf, handle as handleActs, inbox as actsInbox, mayAct, noteEnd as actsEnd, noteStart as actsStart, setAnswerer, setSpeaker, sweep as actsSweep, tags as actsTags, type ActFields, type ActsWorld, type NewsTag, type Question } from '../acts';
import { CONTROLLER, SCRIPTED_ACTS, intentionFocus } from '../controller';
import { SKILL, noteSkill, skillLine, skillOf, skillWeight } from '../skill';
import { PROPOSALS_ON, allProposals, initProposals, markTriage, readyForTriage, verdictLine, type CheckCtx } from '../proposals';
import { setProposalCtx } from '../society';
import { topWanted, wantedList } from '../wanted';
import { SELLS } from '../merchant';
import { clockOf, noteAnswer, scrub, setProjectLines, toldAnswer, villageMemory } from '../memory';
import { codeNews, tellMember } from '../acts';
import { RULES, breaks, contributeTag, duties, levyRate, noteCompliance, notePuts, noteTakes, rulesLine, setZoneVillages, zoneBoxes } from '../rules';
import { lapsePending, levyLeft, pendShare, pendingOf, settlePending } from '../own';
import { councilLine, needBoost, noteNeedOffer, noteNeedStatus, setCouncilStore, withInfluence } from '../council';
import { CHARACTER, characterAny, characterFactor, characterRunBegin, goalFromValues, helpWeight, hexacoOf, hexacoWeights, identityLine, initCharacter, moodLine, moodWeight, needsLine, noteDecision, noteLines, noteRest, noteWork, requestWeight, restWeight, sample as characterSample, temperamentWords, think, valuesLine } from '../character';
import { HOUSE_UNITS, LANDMARK_UNITS, MAX_SMELTS, VANILLA_ALL, WOOD_VARIANTS, baseName, houseBudget, isLandmark, isVanillaPieceName, validateDesign } from '../designs';
import { GEN_HOMES, familyKey, homeOwner, isHomeName } from '../houseStyle';
import { GROW, GROW_FARMS, HOUSING, NO_FIELD_BIOME, growing, hoodWood, hoodWoodAt, hoodWoods, housesOf, isDwelling, isGrowTask, padFor, padLadder, pickHouses, taskNum, treesNear } from '../grow';
import { APPETITE, FOOD_POINTS, appetiteOn, chooseMeal, drain, foodPoints, foodText, holdMeal, isFoodKind, isFoodTask, releaseMeal, stateOf, storeForMeals, type Appetite } from '../appetite';
import { onSetting, rawSetting } from '../settings';
import { quarryFeeds } from './mcQuarry';
import { bannerStandIn, furnishBatch, furnishItem, furnishTrade, furnishWants } from '../furnish';
import { FLOWER_DYE, KILN, MONUMENT, capShare, currentStage, furnishStage, standInFrom, dyeFlowers, glassColours, ironReached, jobBuilt, jobBuiltPlanned, jobReady, monumentLine, monumentPlan, newMonument, openJobs, stageWants, stageWantsPlanned, yardCovers, M3, TRADE_WEIGHT, noteTrade, tradeOfStep, tradeOf, progressLine as monumentProgress, partLine, cathedralName, presetWords, stageNames as monumentStages, monumentNoun, m3, architectOptions, dyesOnOffer, ARCHITECT_SYSTEM, ARCHITECT_TOOL, architectPrompt, checkArchitect, newMonumentPicked, type ArchitectFacts, type ArchitectPick, type Trade } from '../monument';
import { kilnOn, laneWork, planOf } from './mcKiln';
import { BULK_LANES, LODGE, TRIP_MIN, bulkTrip } from '../lodge';
import { cutWork, cutterOn } from './mcCutter';
import { bedBuilding, dyeBedOn } from './mcDyeBed';
import { DYE_BED, DYE_FLOWERS, DYE_REACH, TALL_FLOWERS, dyeRecipes, makeableColours, windowColours } from '../dyeBed';
import { DETAIL_COLOURS } from '../gothicGen';
import { stoneStandIn, DEEP_BLOCKS, deepStandIn } from '../monument';
import { DEEP_KEEP, deepenForStone } from './mcMine';
/** #162: minutes (game time) a stage waits for a quarried stone before the rest stands in as another. */
const STONE_WAIT_MIN = 6;
/** MC_DEEP_STONE: the wait for the deep level's stone before the wood and bricks stand in (its trips are 5 min), and its
 *  miners at once (the iron level's legs). */
const DEEP_WAIT_MIN = 20, DEEP_LANES = 3;
/** #165: the iron stored (raw and ingots) above which no member digs for more while a monument is built. */
const IRON_MONUMENT_ENOUGH = 64;
/** #140 (F324): minutes (game time) a village leaves a bed flower it ran out of out of new mixes. */
const FLOWER_OUT_MIN = 60;
import { kilnLanes, kilnLine } from '../kiln';
import { quarryLine } from '../quarry';

/** Brains that only use the world interface (the scripted ones in brains.ts are sandbox-only). */
export const MC_BRAINS: Record<string, () => AgentBrain> = {
  idle: () => ({ name: 'idle' }),
  tiered: () => new TieredBrain(),
  llm: () => new LLMBrain(),
  // Scripted village worker (tests): runs the skill calls each task spells out
  tasks: () => new TaskBrain(),
};

export interface SpawnOptions {
  role?: string;
  brain?: string | null;
  gamemode?: string;
  position?: { x: number; y?: number; z: number };
  memory?: Record<string, unknown>;
  /** Start afresh: empty inventory, full health and food, at the world spawn (a name keeps its player data otherwise). */
  reset?: boolean;
}

/**
 * A chore's place in the decision log (A.1): its choice id and start, the storage and the agent's inventory then (for the
 * yield at its end), and the village's chores that overlapped it.
 */
type ChoiceState = {
  id: string; t: number; ended?: boolean; store: Counts; carried: Counts; with: Set<string>;
  /** #163: the member's odometer at the start (blocks walked, BotAgent.walked). */
  walked0?: number;
  /** #68: the member's commons flow (put minus taken) at the start, for its share of the net yield. */
  flow?: Counts;
  /** #108 (MC_PAY): its gross puts at the start, a priced request's evidence and earmark. */
  gross?: Counts;
  /** A.2: when it ended (heldKeys' async hold), its decision, the further keys it holds, what it was (kind, option id and
   *  name), and for an explore its ring point with how much of its land the atlas knew at the start. */
  endedAt?: number; decisionId?: string; holds: string[]; kind?: ChoiceKind; option?: string; name?: string;
  point?: { x: number; z: number; known0: number };
  /** S.9: a make's good, batch and furnace (k; none: crafted), netted out of its deficit while it goes; a gathering's
   *  material and trip (`n`: the amount, counted as incoming until the chore ends). */
  make?: { item: string; count: number; smelts: boolean; k?: number };
  gather?: { material: Material; n: number };
  /** s36: an initiative's gathering trip (its own field: the workshop's demand must not count it as incoming). */
  initiative?: { id: string; material: Material | 'flowers' | 'saplings' | 'sandstone'; n: number; item?: string };
  /** M1 (#144): a monument chore: a gathering trip's item, material and amount, a job's index, or the site. */
  monument?: { item?: string; material?: Material | 'flowers'; n?: number; job?: number; site?: boolean; kiln?: number; cut?: boolean; dye?: boolean; furnish?: boolean };
  /** S.9: a works furnace placement's k (its 8 cobblestone earmarked, so gathering's demand leaves it out). */
  furnace?: number;
  /** B.4: a light chore's part and its torches. */
  light?: { part: string; n: number };
  /** X.1: a furnish chore's part and its spots. */
  furnish?: { part: string; n: number };
  /** s41: a library activity's spec, the items it gives and its deposit step's place in the chore's statuses. */
  activity?: { id: string; items: string[]; depAt: number };
};

/**
 * A part the village lights (B.4): a building (a structure with its design and a done Build task) or a piece of the mine
 * ("mine:stairs", "mine:<leg>", "mine:down:<k>", "mine:iron"), its torch spots in the world, how many are unlit (not done,
 * not never; in the mine not within 2 cells of a face still going), whether it still grows (the mine) and, for a building,
 * the walk from the storage hut to its door (blocks).
 */
export type LightPart = {
  part: string; label: string; kind: 'building' | 'mine'; structure?: Structure; place?: SignPlace;
  spots: Array<{ x: number; y: number; z: number; block: 'wall_torch' | 'torch'; facing?: string; sides?: MineLightSpot['sides']; src?: 'vanilla' | 'code' }>;
  unlit: number; growing: boolean; walk?: number;
};

/**
 * A building the village furnishes (X.1): its furniture spots in the world (buildingDecor's, inside the structure's box,
 * `y` the cell's), the open ones (not done, not never), and lighting's label, place and walk from the storage hut.
 */
export type DecorPart = {
  part: string; label: string; structure: Structure; place: SignPlace; walk?: number;
  spots: Array<DecorSpot & { y: number }>; open: Array<DecorSpot & { y: number }>;
  /** #68 (MC_OWN): the cell for its owner's chest (one more spot by buildingDecor's rule, facing away from its wall). */
  chest?: { x: number; y: number; z: number; facing: string };
  /** MC_HOME_BASICS: an owned dwelling's bed, chest and crafting table cells (buildingDecor's `basics`, inside the box). */
  basics?: BasicsCells;
  /** #141 (MC_HOUSE_DECOR): an owned dwelling's decoration slots (decorSlots, after its basics and furniture, in the box). */
  slots?: DecorSlotY[];
};
/** A decoration slot in the world (`y` the cell's). */
export type DecorSlotY = DecorSlot & { y: number };

/** Vanilla's facade torches lit too (D4: vanilla's own look); off, only the spots inside. */
const LIGHT_FACADES = rawSetting('MC_LIGHT_FACADES') !== '0';

/** One good's plan for the workshop now (makePlan): the batch it makes, or why none. */
type MakePlan = { count: number; bill: Counts; inputs: Counts; smelts: boolean; craft?: { item: string; count: number; wood: string } } | { why: string };
/** Gathering's demand per material (gatherWanted). */
type GatherWanted = Record<Material, { need: number; incoming: number; want: number; for: string[] }>;
/** Gathering's materials in their table order (ties of the menu's order). */
const MATERIALS: Material[] = ['sand', 'logs', 'cobblestone'];
/** What small works keep off (smallBlocked), with the spots found on it (#149: by footprint size, and the gardens'). */
type SmallBlocked = {
  sig: string; blocked: Area[]; plots: Array<Area & { y: number; ground?: (x: number, z: number) => number | null }>; hard: Area[]; own: Area[];
  spots: Map<string, Array<{ x: number; z: number; y: number; prep?: true }>>; gardens?: { at: number; list: GardenSpot[] };
};
/** #149: how long the gardens' spots are kept on an unchanged village (their soil is read from the world). */
const GARDEN_SPOTS_MS = 60_000;
/** #117: a good made for later that nothing in the village uses yet (barrels go to the storage yard with MC_STORAGE_GROW). */
const unusedGood = (g: MakeGood) => UNUSED_GOOD.test(g.forWhat) && !(STORAGE_GROW && g.item === 'barrel');
/** The smallest trip a further gatherer is sent for while some of the material is already on the way (no walk for one
 *  log; with nothing incoming any want goes, so the last few still come). */
const GATHER_MIN_TRIP: Record<Material, number> = { logs: 6, sand: 8, cobblestone: 8 };
/** #45 (MC_GARDENS): a garden's wildflowers, gathered by its own crew only (not a workshop material: the catalogue reads
 *  GATHER_KINDS). */
const FLOWER_GATHER = { trip: 12, block: () => 'wildflowers', deposit: () => 'wildflowers' };
/** #140 (MC_FLOWER_MIX): how far from the storage hut the flowers a bed is planted from are counted (collect looks 96 out
 *  from where the gatherer stands, at the hut or on its way). */
const FLOWER_REACH = 80;
/** #46 (MC_GARDENS): a sapling of the village's wood, from its leaves (they drop saplings by chance: ~20 leaves a trip). */
// (the collect counts the saplings, not every drop: a leaf drops one 1 time in 20, F287)
const SAPLING_GATHER = { trip: 2, block: (wood?: string) => `${wood ?? 'oak'}_leaves`, deposit: (wood?: string) => `${wood ?? 'oak'}_sapling` };
/** R1 (MC_VANILLA_ALL): sandstone for a desert lamp's or yard's crew, collected as it lies. */
const SANDSTONE_GATHER = { trip: 16, block: () => 'sandstone', deposit: () => 'sandstone' };
/** A gathering that found none of its material backs it off this long; a second such answer counts toward "unavailable"
 *  only this long after the first (S.9's review, lens 4 M2). */
const GATHER_NONE_BACK = 30 * 60000;
const GATHER_NONE_APART = 10 * 60000;

/** Stone pickaxes the supply makes into storage (S.1; S.8 raises it to 8). */
const PICK_BATCH = 4;
/** Members from which a village gets the pickaxe supply whatever its workers are doing, and miners keep off the reserve. */
const SUPPLY_MEMBERS = 5;
/** How far a chat line is heard (E.0; the chat skill says the same), and the window of the wake caps per pair. */
const HEAR_RANGE = 48;
const PAIR_WINDOW_MS = 5 * 60000;

/** What an agent carries as Mineflayer sees it (no server command: measurement only); null if it cannot be read. */
function heldCounts(a: BotAgent): Counts | null {
  try {
    return itemCounts(a.bot.inventory.items());
  } catch {
    return null;
  }
}

export class MineflayerWorld implements WorldAdapter {
  readonly kind = 'minecraft' as const;
  readonly villages: VillageRegistry;
  /** The skills implemented so far (mcSkills.ts), with the shared tool definitions. */
  readonly skills: ToolDef[] = [...TOOLS, ...FOUNDRY_SKILLS.map((f) => f.tool)].filter((t) => t.name in MC_SKILLS);
  /** Skills only code-posted tasks name (S.3), kept out of the models' tools (a longer prompt each, lesson 32). */
  readonly taskSkills = ['make_into_storage', 'place_station'];
  /** What a handed-back task's holder may carry for it (F228): a village part's batch, or a gather task's material. */
  taskLeftovers(detail: string): string[] {
    const make = /\bmake_into_storage item=(\S+)/.exec(detail)?.[1];
    if (make) return makeKeeps(make.replace(/[,.;]+$/, ''));
    const block = /\bcollect block=(\S+)/.exec(detail)?.[1]?.replace(/[,.;]+$/, '');
    return block ? [block] : [];
  }
  readonly registry: ReturnType<typeof minecraftData>;
  /** Bills of materials and recipe chains (mcMaterials.ts). */
  readonly materials: Materials;
  /** s41: the activity library's valid specs and the files dropped (library.ts). */
  readonly library: { specs: LibrarySpec[]; dropped: Array<{ file: string; why: string }> };
  agents = new Map<string, BotAgent>();
  ticks = 0;
  /** Peaceful and no-damage settings (mcRules.ts), applied when the agent server starts. */
  worldRules: WorldRulesStatus | null = null;
  /** What the bots have seen, one summary per chunk, shared by every agent (mcAtlas.ts). */
  readonly atlas: Atlas;

  constructor(readonly host: string, readonly port: number, readonly version: string, readonly rcon: Rcon, dataDir: string) {
    this.registry = minecraftData(version);
    this.materials = new Materials(this.registry);
    this.villages = VillageRegistry.forWorld(dataDir);
    // (G1: members' memory, social.json beside villages.json)
    initMemory(dataDir);
    initCharacter(dataDir);
    // (M3, MC_MONUMENT_NEWS: a member's own part in the cathedral, in what it remembers)
    if (MONUMENT.on && M3.news)
      setProjectLines((village, agent) => {
        const m = this.villages.villages.get(village.toLowerCase())?.monument;
        const line = m ? partLine(m, agent) : '';
        return line ? [line] : [];
      });
    // (G5, #90, MC_PROPOSALS: members' proposals beside villages.json, and code's check of them from what this world can do)
    if (PROPOSALS_ON) {
      initProposals(dataDir);
      setProposalCtx((village) => this.proposalCtx(village));
    }
    // (G3, MC_RULES: a zone law's place found on its village)
    if (RULES.on) {
      setZoneVillages((name) => this.villages.villages.get(name.toLowerCase()));
      // (a floor's stake line on the ballot: what storage holds now)
      setCouncilStore((name) => {
        const v = this.villages.villages.get(name.toLowerCase());
        return v ? storageContents(v) : {};
      });
    }
    // (G2: a line a member says shows in the game by tellraw, "Ada says: ...", which matches neither of mineflayer's chat
    // patterns; hearChat also ignores it, so no brain wakes on it: the spec check's H4)
    setSpeaker((_village, agent, text) => {
      this.spoken.set(`${agent}\u0000${text}`, Date.now());
      void this.rcon.command(`tellraw @a ${JSON.stringify({ text: `${agent} says: ${text}`, color: 'gray' })}`).catch(() => {});
    });
    // (#108, MC_PAY: members pay each other; pay.ts' hooks into acts.ts, the world's env in mcPay.ts)
    startPay(this.payWorld);
    // (#107, MC_QUESTIONS: a question starts the addressee's answer call)
    if (TALK.questions) setAnswerer((village, q) => this.answerQuestion(village, q));
    this.villages.refreshNeeds = (v) => this.refreshNeeds(v);
    this.villages.onClaim = (v, t) => this.claimed(v, t);
    this.villages.claimLimit = (v, t, _by, cooled) => this.mineClaim(v, t, cooled);
    // (s41: the activity library, server/library/*.json, for the foundry skills with an activity adapter)
    this.library = loadLibrary(this.registry, new Set(FOUNDRY_SKILLS.filter((f) => f.activity).map((f) => f.name)));
    if (this.library.specs.length || this.library.dropped.length) console.log(`[activity] library: ${this.library.specs.map((s) => s.id).join(', ') || 'no specs'}${this.library.dropped.length ? `; dropped ${this.library.dropped.map((d) => `${d.file} (${d.why})`).join('; ')}` : ''}`);
    this.atlas = new Atlas(this.registry, path.join(dataDir, 'atlas.json'), (cx, cz) => {
      for (const a of this.agents.values()) {
        const column = (a.bot.world as unknown as { getColumn(x: number, z: number): unknown }).getColumn(cx, cz);
        if (column) return { by: a.name, column: column as Parameters<Atlas['summarise']>[0] };
      }
      return null;
    });
  }

  /**
   * How many blocks collect would gather for each name lie near x,y,z, up to the number wanted (plan_layout's check),
   * outside `skip` (the farm's grass check: prepare_site cuts the plot's own plants).
   */
  materialsNear(by: string, want: Record<string, number>, x: number, y: number, z: number, range: number, skip?: { x1: number; z1: number; x2: number; z2: number }) {
    const a = this.agents.get(by.toLowerCase());
    if (!a) return null;
    const out: Record<string, number> = {};
    for (const [n, count] of Object.entries(want)) {
      try {
        // What collect can get: near the surface (wood 36 blocks down in a mineshaft could not be reached), anything
        // close to the site, and farther out only blocks in the open (Accept12: sandstone buried under sand 50-90 blocks
        // away counted, and gatherers found "none within 96 blocks"); only as many as wanted
        const off = (p: Vec3) => !skip || p.x < skip.x1 || p.x > skip.x2 || p.z < skip.z1 || p.z > skip.z2;
        const keep = (p: Vec3) => { const d = Math.hypot(p.x - x, p.z - z); return p.y >= y - 16 && d <= range && off(p) && (d <= 40 || exposed(a, p)); };
        out[n] = nearestBlocks(a, collectTargets(a, n).blocks, 128, Math.max(1, Math.ceil(count)), keep, { min: y - 16 }).length;
      } catch {
        // An unknown name: not this check's business
      }
    }
    return out;
  }

  /**
   * Scouting (step 2.4): eight points on a ring of 160 blocks around home (a bot sees ~128 blocks, so the ring's
   * walkers bring in the land out to ~256), those whose surroundings the atlas mostly does not know yet, in order
   * around the ring. On land the atlas knows already, none: find_site reads it as it is.
   */
  scoutPoints(home: { x: number; z: number }) {
    const out: Array<{ x: number; z: number }> = [];
    for (let k = 0; k < 8; k++) {
      const t = (k * Math.PI) / 4;
      const x = Math.round(home.x + 160 * Math.cos(t)), z = Math.round(home.z + 160 * Math.sin(t));
      if (this.atlas.known(x, z, 64) < 0.5) out.push({ x, z });
    }
    return out;
  }

  /** The first vote's style (spec_vote1 1): a biome's accepted small houses, each with its bill's units, size and gathering. */
  styleHouses(biome: string): Array<StyleHouse & { design: Design }> {
    // (R2: a style voted with its wood, "plains@spruce", is its biome's houses; R1: every dwelling up to 13 across)
    const lib = this.vanillaLibrary(parseStyle(biome).biome)?.houses ?? [];
    return lib.filter((d) => (VANILLA_ALL ? isDwelling(d.name) && d.width <= 13 && d.depth <= 13 : /_small_house_\d+$/.test(d.name))).map((d) => {
      const m = this.materialTasks(d, d.name);
      const gather: Record<string, number> = {};
      for (const t of m.tasks ?? []) {
        const g = /^Gather (\d+) (\w+)/.exec(t.title);
        if (g) gather[g[2]] = (gather[g[2]] ?? 0) + Number(g[1]);
      }
      return { name: d.name, units: m.units ?? 0, volume: d.width * d.depth * d.height, gather, design: d };
    });
  }

  /**
   * Vanilla's pieces for a biome (V2.3), each passing the checks the architect's survival designs pass (valid with block
   * states, obtainable and easy materials, the budget, the furnace runs). Null when the jar cannot be read.
   */
  vanillaLibrary(biome: string) {
    const accept = (d: Design, centre: boolean) => {
      if (!validateDesign({ ...d } as unknown as Record<string, unknown>, 'vanilla', { isPlaceable: (b) => this.isPlaceable(b), states: true, requireDoor: !centre }).design) return false;
      const m = this.materialTasks(d, d.name);
      return !m.problems.length && (m.units ?? 0) <= houseBudget(d.name) && (m.smelts ?? 0) <= MAX_SMELTS;
    };
    try {
      return vanillaLibrary(villageBiome(biome), accept, vanillaJar());
    } catch (e) {
      console.warn(`[vanilla] cannot read the village pieces: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Gather tasks for building a design in survival: its raw materials (from the bill of materials and the recipe
   * chain, with a furnace and fuel when something must be smelted), in chunks two workers can share. Builders craft
   * and smelt the rest from the village storage themselves (build_design does it).
   */
  materialTasks(d: Design, label: string, wood?: string, stations = true, without: string[] = [], extra: Counts = {}) {
    // In the village's wood kind: its logs are what gets gathered (less the parts billed for the village once: S.3's windows)
    const own = designBill(d);
    for (const n of without) delete own[n];
    const bill = inWood(own, wood);
    let plan = this.materials.plan(bill);
    // A crafting table for the doors and the like, and a furnace when something must be smelted (not for a building
    // built after the storage hut, `stations` false: it uses the hut's, and each house billed 8 cobblestone and a log
    // for its own, the opportunities analysis #5)
    if (stations) plan = this.materials.plan({ ...bill, crafting_table: 1, ...(plan.fuel.smelts ? { furnace: 1 } : {}) });
    // Blocks that need iron ore, leather, clay or wool are too slow to gather for a village: a design using them is
    // sent back (a lantern meant mining raw iron with a stone pickaxe)
    const hard = hardToGather(plan.gather);
    const problems = [...plan.problems, ...(hard.length ? [`it needs ${hard.join(', ')}, which takes finding (drop the blocks made from it, e.g. mossy cobblestone, lanterns, bricks, wool, bookshelves; planks, logs, cobblestone and glass are gathered easily)`] : [])];
    // One log spare (a plank batch per wooden part rounds up; one kind, so no more than that)
    plan.gather['any:logs'] = (plan.gather['any:logs'] ?? 0) + (wood ? 1 : 2);
    // (and what the caller adds: the pooled windows' fuel on the first building with windows, S.3's review)
    for (const [n, q] of Object.entries(extra)) if (q > 0) plan.gather[n] = (plan.gather[n] ?? 0) + q;
    const logs = Object.entries(plan.gather).filter(([n]) => /_log$|^any:logs$/.test(n)).reduce((s, [, q]) => s + q, 0);
    const units = Object.values(plan.gather).reduce((s, q) => s + q, 0);
    return { tasks: gatherTasks(plan.gather, label, wood), problems, logs, units, smelts: plan.fuel.smelts };
  }

  /**
   * The windows billed once for the village (S.3): each building's glass and panes summed over every placed copy and
   * planned together (14 panes are 6 glass from 6 sand, where three buildings billed alone gather 18), with gather tasks
   * for the sand only. The fuel's logs (`logs`) go on the first building with windows' own log gathering (a log task "for
   * the windows" would never be closed as covered; billed nowhere, the smelting burned logs gathered for later houses,
   * S.3's review).
   */
  sharedParts(designs: Design[], wood?: string) {
    const parts = (d: Design) => { const b = designBill(d); return { glass_pane: b.glass_pane ?? 0, glass: b.glass ?? 0 }; };
    const sandOf = (c: Counts) => Object.entries(this.materials.plan(c).gather).filter(([n]) => /^(red_)?sand$/.test(n)).reduce((s, [, q]) => s + q, 0);
    const bill = { glass_pane: 0, glass: 0 };
    let separate = 0, copies = 0;
    const withWindows = new Set<string>();
    for (const d of designs) {
      const p = parts(d);
      if (!p.glass_pane && !p.glass) continue;
      bill.glass_pane += p.glass_pane;
      bill.glass += p.glass;
      separate += sandOf(Object.fromEntries(Object.entries(p).filter(([, q]) => q > 0)));
      copies++;
      withWindows.add(d.name);
    }
    if (!copies) return null;
    const pooled: Counts = Object.fromEntries(Object.entries(bill).filter(([, q]) => q > 0));
    const all = this.materials.plan(pooled).gather;
    const gather = Object.fromEntries(Object.entries(all).filter(([n]) => /^(red_)?sand$/.test(n)));
    const sand = Object.values(gather).reduce((s, q) => s + q, 0);
    const logs = Object.entries(all).filter(([n]) => /_log$|^any:logs$/.test(n)).reduce((s, [, q]) => s + q, 0);
    return { panes: bill.glass_pane, glass: bill.glass, sand, logs, separate, with: [...withWindows], copies, tasks: gatherTasks(gather, WINDOWS, wood) };
  }

  /**
   * How many of a part the village still wants made into storage (S.3's make_into_storage), and for how many buildings or
   * lamp jobs: glass and panes for every build not claimed yet or claimed with its stock not drawn, less what those
   * builders carry; torches for the unlit lamps whose job is open or under way, less what its holder carries.
   */
  partsWanted(v: Village, item: string): { want: number; buildings: number } {
    const carries = (name?: string) => (name ? heldCounts(this.agents.get(name.toLowerCase())!)?.[item] ?? 0 : 0);
    let want = 0, buildings = 0;
    if (item === 'torch') {
      (v.layouts ?? []).forEach((l, i) => {
        const t = v.tasks.find((x) => (x.status === 'open' || x.status === 'claimed') && x.detail.startsWith(`light_streets layout=${i + 1} `));
        if (!l.lamps?.length || l.lit || !t) return;
        want += Math.max(0, l.lamps.length - (t.status === 'claimed' && this.agents.has(t.claimedBy?.toLowerCase() ?? '') ? carries(t.claimedBy) : 0));
        buildings++;
      });
      return { want, buildings };
    }
    for (const t of v.tasks) {
      if (!/^Build /.test(t.title) || !(t.status === 'open' || (t.status === 'claimed' && this.drawn.get(`${v.name}:${t.id}`) !== t.claimedBy))) continue;
      const d = v.designs[/build_design "([^"]+)"/.exec(t.detail)?.[1] ?? ''];
      const n = d ? designBill(d)[item] ?? 0 : 0;
      if (!n) continue;
      const builder = t.status === 'claimed' && this.agents.has(t.claimedBy?.toLowerCase() ?? '') ? t.claimedBy : undefined;
      want += Math.max(0, n - carries(builder));
      buildings++;
    }
    return { want, buildings };
  }

  private needsAt = new Map<string, number>();

  /**
   * The one wood kind a village's numbers are in: its own, else the commonest in storage, and then any logs and planks
   * count as it (birch deposits never lowered an oak need). For refreshNeeds and the storage reserve alike.
   */
  private woodOf(v: Village, store: Counts): string {
    const logKinds = Object.entries(store).filter(([n]) => /_log$/.test(n)).sort((x, y) => y[1] - x[1]);
    return v.wood ?? logKinds[0]?.[0].replace(/_log$/, '') ?? 'oak';
  }

  /** One Build task's bill, in its own wood kind when it has one (F164's whole buildings, as the cover rule counts them). */
  private buildBill(v: Village, t: { title: string; detail: string }, wood: string): Counts | null {
    const d = v.designs[/build_design "([^"]+)"/.exec(t.detail)?.[1] ?? ''];
    if (!d) return null;
    const bill = inWood(designBill(d), (v.wood && v.woodFor?.[t.title.slice(6)]) || wood);
    // The storage hut's table and furnace (S.5): billed to their own task while it is open or held (stationsBill), and to
    // no one once they stand; only a hut whose stations task is over without them (the fallback) bills them itself
    if (d.name === STORAGE_HUT) for (const n of STATION_NAMES) if (v.stations?.[n] || stationsOwed(v).includes(n)) delete bill[n];
    return bill;
  }

  /** The stations their own task still owes (S.5), as a bill: a table (a log) and a furnace (8 cobblestone). */
  private stationsBill(v: Village): Counts {
    return Object.fromEntries(stationsOwed(v).map((n) => [n, 1]));
  }

  /** The bill of every laid-out building not claimed yet (open), each in its own wood kind, and their labels. */
  private openBill(v: Village, wood: string): { bill: Counts; unbuilt: string[] } {
    const bill: Counts = {};
    const unbuilt: string[] = [];
    for (const t of v.tasks) {
      if (!/^Build /.test(t.title) || t.status !== 'open') continue;
      const b = this.buildBill(v, t, wood);
      if (!b) continue;
      unbuilt.push(t.title.slice(6));
      for (const [n, q] of Object.entries(b)) bill[n] = (bill[n] ?? 0) + q;
    }
    return { bill, unbuilt };
  }

  /**
   * Claimed builds whose builder has taken everything it needs from storage (runJob's withdrawals and makeFromStock), by
   * village and task id, to the builder (S.1). A claim clears it (`onClaim`); not kept over a restart (reserved again).
   */
  private drawn = new Map<string, string>();

  /** A claimed build's materials are all in its builder's hands: the storage reserve leaves it out from now on. */
  markDrawn(v: Village, id: string, by: string) {
    this.drawn.set(`${v.name}:${id}`, by);
  }

  /**
   * When the pickaxe supply was claimed: its maker's cobblestone and stone pickaxes (3 each), and the storage's stone
   * pickaxes (3 each), by village and id.
   */
  private supplyStart = new Map<string, { by: string; held: number; stored: number }>();

  private stoneHeld(a: BotAgent): number {
    return a.bot.inventory.items().reduce((s, it) => s + (it.name === 'cobblestone' ? it.count : it.name === 'stone_pickaxe' ? 3 * it.count : 0), 0);
  }

  private claimed(v: Village, t: Task) {
    const key = `${v.name}:${t.id}`;
    this.drawn.delete(key);
    const maker = PICK_SUPPLY.test(t.title) ? this.agents.get(t.claimedBy?.toLowerCase() ?? '') : undefined;
    if (maker) this.supplyStart.set(key, { by: maker.name, held: this.stoneHeld(maker), stored: 3 * (storageContents(v).stone_pickaxe ?? 0) });
    // A worker back at the mine within its busy cooldown (S.2): a face came free (said before the claim ends the cooldown,
    // and to the agent, for the stage script's count of hand-backs)
    const cooled = t.claimedBy && MINE_TASK.test(t.detail) ? this.villages.cooledAt(v, t.claimedBy) : undefined;
    if (cooled !== undefined) {
      const f = this.faces(v);
      const said = `${t.id} ${Math.round((Date.now() - cooled) / 1000)} s into its busy cooldown: a face is free (faces ${f.faces}, held ${f.held})`;
      console.log(`[mine] ${t.claimedBy} claims ${said}`);
      this.agents.get(t.claimedBy!.toLowerCase())?.pushEvent('system', `Claims ${said}`);
    }
  }

  /** The mine's faces by village, kept 250 ms (the claim gate asks on every claimable call: ~220 a second with 11 idle workers). */
  private facesAt = new Map<string, { at: number; f: ReturnType<typeof mineFaces> }>();
  private faces(v: Village) {
    const now = Date.now(), c = this.facesAt.get(v.name);
    if (c && now - c.at < 250) return c.f;
    const f = mineFaces(v, (n) => this.agents.has(n.toLowerCase()));
    this.facesAt.set(v.name, { at: now, f });
    return f;
  }
  /** Villages whose claim gate was shut when last asked (said once a change). */
  private gateShut = new Set<string>();

  /**
   * The claim gate (S.2): no more mine tasks held than the mine has faces, plus two to be on their way; one always allowed
   * when none is held (a face count gone wrong can never shut the mine). A worker that handed a mine task back as busy
   * (`cooled`) takes the next only once a face is free. Other tasks, and a village whose mine cannot give, go through.
   * Only claims by agents in the world count, as in mineFaces (a removed agent's claims stay on the board).
   */
  private mineClaim(v: Village, t: Task, cooled?: number): boolean {
    if (!MINE_TASK.test(t.detail) || !mineCanGive(v, 'cobblestone')) return true;
    const f = this.faces(v);
    const held = v.tasks.filter((x) => x.status === 'claimed' && MINE_TASK.test(x.detail) && this.agents.has((x.claimedBy ?? '').toLowerCase())).length;
    if (held > 0 && cooled !== undefined && f.free === 0) return false;
    const open = held === 0 || held < f.faces + 2;
    if (open === this.gateShut.has(v.name)) {
      if (open) this.gateShut.delete(v.name);
      else this.gateShut.add(v.name);
      console.log(`[mine] claim gate ${open ? 'open' : 'shut'} in ${v.name}: ${held} cobblestone tasks held, ${f.faces} faces (+2)`);
    }
    return open;
  }

  /**
   * What of the storage is spoken for (S.1), by item (logs by kind, "any logs" in the village's): the raw materials of
   * every building not claimed yet, beyond the made things the storage already holds (planks, a furnace); of every
   * claimed build whose builder has not drawn its stock yet, beyond what that builder carries (runJob walks to the site,
   * withdraws, and makes the furnace from storage cobblestone only after that: Van12a's storage hut was short exactly its
   * furnace after miners took the cobblestone for pickaxes); the pickaxe supply's cobblestone; and the lamps' and signs'
   * logs (S.4). A build that comes up
   * short goes back to open (requeueBuild) and is counted again.
   */
  /**
   * Leftover building parts in storage nobody counts on (s37 S5, MC_PARTS): each part (mcStorage PART_RE) less what the
   * bills of Build tasks not done or failed and of open initiatives name of it (storageReserve lists raw materials only, and
   * build_design fetches exact-name parts from storage). What fuel may burn.
   */
  partsSpare(v: Village): Counts {
    const store = storageContents(v);
    const out: Counts = {};
    for (const [n, q] of Object.entries(store)) if (q > 0 && PART_RE.test(n)) out[n] = q;
    if (!Object.keys(out).length) return out;
    const take = (bill: Counts) => {
      for (const [n, q] of Object.entries(bill)) if (out[n]) out[n] = Math.max(0, out[n] - q);
    };
    for (const t of v.tasks) {
      if (!/^Build /.test(t.title) || t.status === 'done' || t.status === 'failed') continue;
      const d = v.designs[/build_design "([^"]+)"/.exec(t.detail)?.[1] ?? ''];
      // (in the wood it is built in, as buildBill: the parts' report)
      if (d) take(v.wood ? inWood(designBill(d), v.woodFor?.[t.title.slice(6)] ?? v.wood) : designBill(d));
    }
    const wood = v.catalogWood ?? v.wood ?? 'oak';
    for (const it of v.initiatives ?? []) {
      const d = it.state === 'open' ? v.designs[it.design] : undefined;
      if (d) take(inWood(designBill(d), wood));
    }
    for (const n of Object.keys(out)) if (!out[n]) delete out[n];
    return out;
  }

  storageReserve(v: Village): Counts {
    const store = storageContents(v);
    const wood = this.woodOf(v, store);
    const out: Counts = {};
    const add = (gather: Counts) => {
      for (const [n, q] of Object.entries(gather)) {
        const k = n === 'any:logs' ? `${wood}_log` : n.replace(/^any:/, '');
        out[k] = (out[k] ?? 0) + q;
      }
    };
    const { bill } = this.openBill(v, wood);
    // (and the stations their own task owes, S.5: the furnace's 8 cobblestone kept from the miners' pickaxes)
    for (const [n, q] of Object.entries(this.stationsBill(v))) bill[n] = (bill[n] ?? 0) + q;
    if (Object.keys(bill).length) {
      const raw = new Set(Object.keys(this.materials.plan(bill, {}).gather).map((n) => n.replace(/^any:/, '')));
      const made: Counts = {};
      for (const [n, q] of Object.entries(store)) if (!raw.has(n) && !/_log$/.test(n)) made[n] = q;
      add(this.materials.plan(bill, made).gather);
    }
    for (const t of v.tasks) {
      if (!/^Build /.test(t.title) || t.status !== 'claimed' || this.drawn.get(`${v.name}:${t.id}`) === t.claimedBy) continue;
      const b = this.buildBill(v, t, wood);
      if (!b) continue;
      const builder = this.agents.get(t.claimedBy?.toLowerCase() ?? '');
      add(this.materials.plan(b, (builder && heldCounts(builder)) ?? {}).gather);
    }
    // The street lamps' and name signs' logs (S.4: they now run while miners make pickaxes from spare logs), as the cover
    // rule counts them (a log a lamp, in a desert two sandstone a lamp in batches of 4 and a log for two lamps' torches; 2
    // a sign job less the stored signs), while open or held and not drawn yet
    const waiting = (t?: Task) => !!t && (t.status === 'open' || (t.status === 'claimed' && this.drawn.get(`${v.name}:${t.id}`) !== t.claimedBy));
    let lamps = 0, signs = 0;
    (v.layouts ?? []).forEach((l, i) => {
      if (l.lamps?.length && !l.lit && waiting(v.tasks.find((t) => t.detail.startsWith(`light_streets layout=${i + 1} `)))) lamps += l.lamps.length;
      if (!l.signed) signs += (l.signs ?? []).filter((s) => !s.up && !s.never && waiting(signTask(v, i + 1, s))).length;
    });
    const desert = v.vanillaBiome === 'desert';
    if (desert && lamps) out.sandstone = (out.sandstone ?? 0) + Math.ceil((2 * lamps) / 4) * 4;
    const stored = Object.entries(store).filter(([n]) => /_sign$/.test(n)).reduce((s, [, q]) => s + q, 0);
    const tail = (desert ? Math.ceil(lamps / 2) : lamps) + 2 * Math.max(0, signs - stored);
    if (tail) out[`${wood}_log`] = (out[`${wood}_log`] ?? 0) + tail;
    const draw = this.supplyDraw(v);
    if (draw) out.cobblestone = (out.cobblestone ?? 0) + draw;
    return out;
  }

  /** How much of an item in storage is spoken for (`storageReserve`); "logs": every kind together. */
  reservedInStorage(v: Village, item: string): number {
    const r = this.storageReserve(v);
    return item === 'logs' ? Object.entries(r).filter(([k]) => /_log$/.test(k)).reduce((s, [, q]) => s + q, 0) : r[item] ?? 0;
  }

  // ---- S.9: the workshop's numbers (pure; the menu, the make skill and the offline checks read them) --------------------

  /**
   * The logs the workshop leaves in storage (spec 4.5): a pen ring's 10 for each annex pen slot with no pen built yet, and
   * 4 for a new storage chest's and a hoe made on the spot (a ring is charged from storage through runJob, the check's M6).
   */
  logsKeep(v: Village): number {
    // (an annex not yet prepared has no slots recorded: its two count, or makes took the logs down to 4 while it was
    // prepared, S.9's review, lens 4 L2)
    const lay0 = v.layouts?.[0];
    const slots = lay0?.annex?.state === 'ready' || (lay0?.slots ?? []).some((s) => s.annex) ? (lay0?.slots ?? []).filter((s) => s.annex && !s.pen?.built).length : 2;
    return Math.min(24, MAKE_KEEP.logsBase + MAKE_KEEP.logsPerPen * slots);
  }

  /**
   * What of the storage a make may take (spec 4.5): the storage less the reserve (after completion ~nothing), the keeps
   * (cobblestone 14, coal 2, logsKeep in the village's kind, else from the most stocked kinds) and what other agents' queued
   * makes and furnace placements have earmarked (D6; `agent`'s own is its to withdraw); nothing of MAKE_NEVER or `except`
   * (the good's own item: a batch is never made from its own stock). A food good's `allow` (s30) lets those through, less
   * their keeps (`foodKeep`).
   */
  makeSpare(v: Village, agent: string, except?: string, store: Counts = storageContents(v), allow?: string[]): Counts {
    const reserve = this.storageReserve(v);
    const own = agent ? holdKey(v.name, agent) : '';
    const held: Counts = {};
    for (const [k, c] of makeHolds) if (k.startsWith(`${v.name}|`) && k !== own) for (const [n, q] of Object.entries(c)) held[n] = (held[n] ?? 0) + q;
    // (#108: goods earmarked for a buyer's delivery are nobody else's)
    for (const [n, q] of Object.entries(earmarked(v))) held[n] = (held[n] ?? 0) + q;
    // (M1, #144: what the monument's yard holds is the cathedral's)
    for (const [n, q] of Object.entries(v.monument?.yard ?? {})) held[n] = (held[n] ?? 0) + q;
    const out: Counts = {};
    for (const [n, q] of Object.entries(store)) {
      const allowed = !!allow?.includes(n);
      if ((MAKE_NEVER.has(n) && !allowed) || n === except) continue;
      const keep = (n === 'cobblestone' ? MAKE_KEEP.cobblestone : n === 'coal' ? MAKE_KEEP.coal : allowed && !(except === 'book' && n === 'sugar_cane') ? this.foodKeep(v, n, store) : 0)
        + (LETTERS ? this.lettersKeep(v, n, except) : 0);
      const s = q - (reserve[n] ?? 0) - keep - (held[n] ?? 0);
      if (s > 0) out[n] = s;
    }
    let keep = this.logsKeep(v);
    const kinds = v.wood ? [`${v.wood}_log`] : Object.keys(out).filter((n) => /_log$/.test(n)).sort((x, y) => out[y] - out[x]);
    for (const k of kinds) {
      const t = Math.min(out[k] ?? 0, keep);
      keep -= t;
      if (t && !(out[k] -= t)) delete out[k];
    }
    return out;
  }

  /**
   * What storage keeps of a food good's inputs (s30's food step, spec 5): wheat for the cake and a cow breeding (wheatKeep),
   * an egg for the cake when no other kind is stored, the cake's 2 sugar cane (and sugar while the cane is short), 2
   * pumpkins while a farm slot is free (a start from storage takes them, the check's L6).
   */
  private foodKeep(v: Village, item: string, store: Counts): number {
    if (item === 'wheat') return wheatKeep(v);
    if (item === 'egg') return (store.brown_egg ?? 0) + (store.blue_egg ?? 0) > 0 ? 0 : 1;
    // (#21, MC_LETTERS: the cane the books still to bind take comes before the cake's and the pie's, spec 9 S2)
    if (item === 'sugar_cane') return 2 + (lettersCurrent(v) ? 3 * this.booksLeft(v) : 0);
    if (item === 'sugar') return Math.max(0, 2 - (store.sugar_cane ?? 0));
    if (item === 'pumpkin') return (v.layouts ?? []).some((l) => (l.slots ?? []).some((q) => !q.annex && !q.kind)) ? 2 : 0;
    return 0;
  }

  /** The workshop's goods in a village: the food goods too where it keeps an appetite (s30); with X.1's catalog family
   *  on, the catalogue's (keeps first, then the recipe graph's goods in the village's pinned wood and what its furniture
   *  wants), as the catalogue's specs give them. */
  goodsFor(v: Village): MakeGood[] {
    const base = appetiteOn(v) ? [...MAKE_GOODS, ...FOOD_GOODS] : MAKE_GOODS;
    const c = CHOOSE.families.has('catalog') ? this.catalog(v) : null;
    let goods = c ? c.goods.filter((g) => !g.food || appetiteOn(v)) : base;
    // (#21, MC_LETTERS: the rung's books, shelves and lectern while letters is current, wood goods in the catalogue's wood)
    if (lettersCurrent(v)) {
      const wood = this.catalogWoodOf(v);
      goods = [...goods.filter((g) => !LETTERS_GOODS.some((q) => q.item === g.item)), ...LETTERS_GOODS.map((g) => (g.item === 'book' ? g : { ...g, wood }))];
    }
    // (s43's innovation: the goods of the techniques the village unlocked, in place of a good of the same item)
    if (!INNOVATE) return goods;
    const tech = techGoods(v);
    return tech.length ? [...goods.filter((g) => !tech.some((t) => t.item === g.item)), ...tech] : goods;
  }

  /** The catalogue's cache, by village: the key it was built on (wood and the furniture's demand). */
  private catalogCache = new Map<string, { key: string; goods: MakeGood[]; specs: Map<string, ActivitySpec> }>();
  private catalogFailed = new Set<string>();

  /** #140 (MC_FLOWER_MIX): each village's bed flowers counted near its storage hut, and when (#162: the dye census too,
   *  keyed by village and reach). */
  private flowerCensus = new Map<string, { at: number; counts: Record<string, number> }>();

  /**
   * The bed flowers near a village (#140): one search a kind round the storage hut (within FLOWER_REACH, near the hut's
   * height or in the open, as collect finds them; up to 24 each), counted by kind, kept 10 minutes. Empty when
   * no member is online to look.
   */
  flowerCounts(v: Village, by?: BotAgent, kinds: readonly string[] = BED_FLOWERS, reach = FLOWER_REACH): Record<string, number> {
    const ck = reach === FLOWER_REACH ? v.name : `${v.name}|${reach}`;
    const hit = this.flowerCensus.get(ck);
    if (hit && Date.now() - hit.at < 10 * 60000) return hit.counts;
    const h = v.storageHut, home = villageHome(v);
    const c = h ? { x: (h.x1 + h.x2) / 2, z: (h.z1 + h.z2) / 2 } : home;
    const a = by ?? [...this.agents.values()].find((q) => q.village()?.name === v.name && q.bot.entity);
    const counts: Record<string, number> = {};
    if (!c || !a?.bot.entity) return counts;
    try {
      const reg = a.bot.registry;
      const y = v.plots[0]?.y ?? Math.floor(a.bot.entity.position.y);
      const keep = (p: Vec3) => {
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        return p.y >= y - 16 && d <= reach && (d <= 40 || exposed(a, p));
      };
      // (a search a kind, each up to 24: one search for all filled its 400 with wildflowers near minevale3, PF0; a tall
      // flower is found as its two halves, so counted as half)
      for (const f of kinds) {
        const id = reg.blocksByName?.[f]?.id;
        if (id === undefined) continue;
        const found = nearestBlocks(a, [id], reach + 48, 24, keep, { min: y - 16 }).length;
        const n = TALL_FLOWERS.includes(f) ? Math.ceil(found / 2) : found;
        if (n) counts[f] = n;
      }
    } catch {
      // (a search that failed counts nothing: the bed takes wildflowers)
    }
    this.flowerCensus.set(ck, { at: Date.now(), counts });
    return counts;
  }

  /** #162 (MC_DYE_BED): the dye census: every dye flower, tall ones too, out to DYE_REACH (the tall flowers near G1 stand
   *  beyond the bed flowers' 80). */
  dyeCounts(v: Village, by?: BotAgent): Record<string, number> {
    return this.flowerCounts(v, by, DYE_FLOWERS, DYE_REACH);
  }

  /** #162: the dye colours a village can make (its census, storage, the composter and the merchant). */
  makeableColours(v: Village): string[] {
    return makeableColours(dyeRecipes(this.registry), { census: this.dyeCounts(v), stores: storageContents(v), composter: DYE_BED.on, merchant: MERCHANT_ON });
  }

  /** A member's flower work's mix (#140): from the village's census, seeded by the member and the village's works so far. */
  private flowerMixFor(v: Village, a: BotAgent, kind: string): string[] | undefined {
    if (!FLOWER_MIX || !isFlowerWork(kind)) return undefined;
    // (enough of each kind for a trip that finds them: a ring takes up to 8 of its main flower; the dye census, out to 144,
    // so the kinds that grow beyond 80 vary the mixes (F324: every mix was wildflowers and lilies); never a kind the
    // village ran out of within the last hour)
    return flowerMix(this.dyeCounts(v, a), `${a.name}|${v.initiativeN ?? 0}`, kind === 'flower_ring' ? 12 : 6, this.flowersOut(v));
  }

  /** #140 (F324): the bed flowers a village ran out of (a bed dropped them) within the last FLOWER_OUT_MIN, game time. */
  private flowersOut(v: Village): Set<string> {
    const rec = (v as Village & { flowersOut?: Record<string, number> }).flowersOut ?? {};
    const since = Date.now() - FLOWER_OUT_MIN * 60000 / timeScale();
    return new Set(Object.entries(rec).filter(([, t]) => t > since).map(([f]) => f));
  }

  /** The wood kind the catalogue makes wood goods in: pinned on the village by the sweep (catalogWood), else as it would be. */
  catalogWoodOf(v: Village): string {
    return v.catalogWood ?? v.wood ?? this.woodOf(v, storageContents(v));
  }

  /**
   * X.1's catalogue for a village (activities.ts buildCatalog: every spec validated), cached on its wood and the
   * furniture's open demand, logged once a change. An exception is logged once a village and gives null (the keeps alone):
   * it runs inside the menu, and one village's bad record must not stop every village's chores (B.4's review, lens 3 L5).
   */
  catalog(v: Village): { goods: MakeGood[]; specs: Map<string, ActivitySpec> } | null {
    try {
      const wood = this.catalogWoodOf(v);
      const demand = CHOOSE.families.has('furnish') ? this.decorDemand(v) : {};
      const key = `${wood}|${Object.entries(demand).sort(([x], [y]) => x.localeCompare(y)).map(([n, q]) => `${n}:${q}`).join(',')}`;
      const old = this.catalogCache.get(v.name);
      if (old?.key === key) return old;
      const { specs, dropped } = buildCatalog(this.registry, this.materials, { wood, decorDemand: demand, keep: MAKE_GOODS, food: FOOD_GOODS });
      const goods = specs.filter((sp) => sp.kind === 'make' && sp.good).map((sp) => (sp.wood ? { ...sp.good!, wood: sp.wood } : sp.good!));
      const entry = { key, goods, specs: new Map(specs.map((sp) => [sp.id, sp])) };
      this.catalogCache.set(v.name, entry);
      const by = (src: string) => specs.filter((sp) => sp.kind === 'make' && sp.source === src).length;
      console.log(`[catalog] ${v.name}: ${goods.length} goods (${by('keep')} keep, ${by('food')} food, ${by('catalog')} catalogue, ${by('decor')} furniture) in ${wood}; furniture wants ${countsList(demand)}${dropped.length ? `; ${dropped.length} dropped (${dropped.slice(0, 3).map((d) => `${d.id}: ${d.why}`).join('; ')})` : ''}`);
      return entry;
    } catch (e) {
      if (!this.catalogFailed.has(v.name)) console.error(`[catalog] ${v.name}: the catalogue could not be built (the keeps alone):`, e);
      this.catalogFailed.add(v.name);
      return null;
    }
  }

  /** decorParts' cache, by village, and the villages whose parts threw (logged once), as lighting's. */
  private decorCache = new Map<string, { sig: string; quick?: { light: LightPart[]; key: string }; parts: DecorPart[] }>();
  private decorFailed = new Set<string>();

  /**
   * The buildings a village furnishes (X.1): lighting's buildings but the storage and mining huts and town centres, each
   * with buildingDecor's spots in the catalogue's wood (off its torch spots and signs), kept inside the structure's box and
   * between its floor and its top (lessons 30, 102), by open spots, most first. Cached on a signature; an exception is
   * logged once a village and gives none (as lightParts).
   */
  decorParts(v: Village): DecorPart[] {
    try {
      return this.decorPartsOf(v);
    } catch (e) {
      if (!this.decorFailed.has(v.name)) console.error(`[decor] ${v.name}: the furniture spots could not be worked out (no furnishing):`, e);
      this.decorFailed.add(v.name);
      return [];
    }
  }

  private decorPartsOf(v: Village): DecorPart[] {
    const wood = this.catalogWoodOf(v);
    // (#142: as lightParts, a quick signature first: lightParts' own cached result, the wood, the signs' and the furnished
    // spots' counts, and what home basics and own chests read)
    const light = this.lightParts(v);
    const key = `${wood}|${(v.layouts ?? []).map((l) => l.signs?.length ?? 0).join(',')}|${Object.entries(v.decor ?? {}).map(([k, r]) => `${k}:${r.done.length}/${r.never?.length ?? 0}`).join(',')}|`
      + Object.entries(v.homes ?? {}).map(([n, h]) => (h?.chest ? `${n}@${h.chest.x},${h.chest.y},${h.chest.z}` : n)).join(',');
    const hit = this.decorCache.get(v.name);
    if (hit?.quick?.light === light && hit.quick.key === key) return hit.parts;
    const buildings = light.filter((P) => P.kind === 'building' && P.place && P.structure && P.structure.kind !== STORAGE_HUT && P.structure.kind !== MINING_HUT && !/_meeting_point_/.test(P.place.design.name) && !P.place.noSign);
    const signs = (v.layouts ?? []).flatMap((l) => l.signs ?? []);
    const sig = JSON.stringify([wood, buildings.map((P) => [P.part, P.place!.design.name, P.place!.x, P.place!.z, P.place!.rot, P.structure!.y, P.walk]), signs.map((q) => `${q.x},${q.layer},${q.z}`), v.decor ?? null]);
    const old = this.decorCache.get(v.name);
    if (old?.sig === sig) {
      old.quick = { light, key };
      return old.parts;
    }
    const parts: DecorPart[] = [];
    for (const P of buildings) {
      const st = P.structure!, place = P.place!;
      const lights: LightSpot[] = P.spots.map((q) => ({ x: q.x, layer: q.y - st.y, z: q.z, block: q.block, ...(q.facing ? { facing: q.facing as LightSpot['facing'] } : {}), src: q.src ?? 'code', inside: true }));
      const chest: { spot?: { x: number; z: number; facing: SignSpot['facing'] } } | undefined = OWN.on ? {} : undefined;
      // (MC_HOME_BASICS: an owned dwelling's bed, chest and table come first; its owner's chest is the basics' chest)
      const ownChest = st.owner ? v.homes?.[st.owner]?.chest : undefined;
      const hb: { out?: HomeBasics; chestAt?: { x: number; z: number } } | undefined = HOME_BASICS.on && st.owner && isDwelling(st.kind) ? { ...(ownChest && ownChest.y === st.y + 1 ? { chestAt: { x: ownChest.x, z: ownChest.z } } : {}) } : undefined;
      const spots = buildingDecor(place, wood, { lights, signs, ...(hb ? { basics: hb } : chest ? { chest } : {}) })
        .filter((q) => q.x >= st.x1 && q.x <= st.x2 && q.z >= st.z1 && q.z <= st.z2 && q.layer >= 1 && q.layer < place.design.height && (!q.also || q.also.layer < place.design.height))
        .map((q) => ({ ...q, y: st.y + q.layer }));
      const inBox = (q: { x: number; z: number }) => q.x >= st.x1 && q.x <= st.x2 && q.z >= st.z1 && q.z <= st.z2;
      const b = hb?.out;
      const basics: BasicsCells | undefined = b && (b.bed || b.chest || b.table) ? {
        ...(b.bed && inBox(b.bed) && inBox(b.bed.foot) ? { bed: { ...b.bed, y: st.y + 1 } } : {}),
        ...(b.chest && inBox(b.chest) ? { chest: { ...b.chest, y: st.y + 1 } } : {}),
        ...(b.table && inBox(b.table) ? { table: { ...b.table, y: st.y + 1 } } : {}),
      } : undefined;
      if (chest && basics?.chest) chest.spot = { x: basics.chest.x, z: basics.chest.z, facing: basics.chest.facing as SignSpot['facing'] };
      // (#141: an owned dwelling's decoration slots, off its furniture's and basics' cells; a full-block piece's top a surface)
      let slots: DecorSlotY[] | undefined;
      if (HOUSE_DECOR && st.owner && isDwelling(st.kind)) {
        const taken: Array<{ x: number; layer: number; z: number }> = [], surfaces: Array<{ x: number; layer: number; z: number }> = [];
        for (const q of spots) {
          taken.push({ x: q.x, layer: q.layer, z: q.z });
          if (q.also) taken.push({ x: q.x, layer: q.also.layer, z: q.z });
          else if (/^(crafting_table|barrel)/.test(q.block)) surfaces.push({ x: q.x, layer: q.layer + 1, z: q.z });
        }
        if (basics?.bed) taken.push({ x: basics.bed.x, layer: 1, z: basics.bed.z }, { x: basics.bed.foot.x, layer: 1, z: basics.bed.foot.z });
        if (basics?.chest) taken.push({ x: basics.chest.x, layer: 1, z: basics.chest.z });
        if (basics?.table) {
          taken.push({ x: basics.table.x, layer: 1, z: basics.table.z });
          surfaces.unshift({ x: basics.table.x, layer: 2, z: basics.table.z });
        }
        slots = decorSlots(place, { taken, surfaces, lights, signs })
          .filter((q) => inBox(q) && q.layer >= 1 && q.layer < place.design.height).map((q) => ({ ...q, y: st.y + q.layer }));
      }
      if (!spots.length && !basics) continue;
      const r = v.decor?.[P.part];
      const open = spots.filter((q) => !r?.done.includes(`${q.x},${q.y},${q.z}`) && !r?.never?.includes(`${q.x},${q.y},${q.z}`));
      const own = chest?.spot && chest.spot.x >= st.x1 && chest.spot.x <= st.x2 && chest.spot.z >= st.z1 && chest.spot.z <= st.z2 ? { x: chest.spot.x, y: st.y + 1, z: chest.spot.z, facing: chest.spot.facing } : undefined;
      parts.push({ part: P.part, label: P.label, structure: st, place, walk: P.walk, spots, open, ...(own ? { chest: own } : {}), ...(basics ? { basics } : {}), ...(slots?.length ? { slots } : {}) });
    }
    parts.sort((p, q) => q.open.length - p.open.length);
    this.decorCache.set(v.name, { sig, quick: { light, key }, parts });
    return parts;
  }

  /** The furniture the open spots want, by item, less what furnish chores carry (X.1; the catalogue's targets). */
  decorDemand(v: Village): Counts {
    const out: Counts = {};
    for (const P of this.decorParts(v))
      for (const q of P.open) {
        out[q.item] = (out[q.item] ?? 0) + 1;
        if (q.also) out[q.also.item] = (out[q.also.item] ?? 0) + 1;
      }
    for (const [k, c] of decorCarried) if (k.startsWith(`${v.name}|`)) for (const [n, q] of Object.entries(c)) if (out[n]) out[n] = Math.max(0, out[n] - q);
    for (const n of Object.keys(out)) if (!out[n]) delete out[n];
    return out;
  }

  /**
   * One good's plan now (spec 2.6): its deficit (the target less the stock and other agents' makes of it under way), then
   * batches from the largest whole one down by its unit, the first whose bill plans from the spare storage with nothing to
   * gather (lesson 1: code finds the batch). `inputs`: what the plan takes from storage plus the coal and charcoal it burns
   * (spare coal first); `smelts` by the plan's own fuel count, the rule the skill uses too (D5).
   */
  makePlan(v: Village, good: MakeGood, agent: string, store: Counts = storageContents(v), base?: Counts): MakePlan {
    const stock = store[good.item] ?? 0;
    const going = this.goingS9(v, agent).make.filter((m) => m.item === good.item).reduce((s, m) => s + m.count, 0);
    const want = this.makeTarget(v, good) - stock - going;
    if (want <= 0) return { why: 'at stock' };
    // (`base`: makeSpare(v, agent, undefined, store) computed once for many goods, X.1's catalogue: its reserve is a plan of
    // every open build, too dear to repeat for each of ~70 goods; the good's own item left out as makeSpare's `except`)
    let spare: Counts;
    if (base && !good.allow) {
      spare = { ...base };
      delete spare[good.item];
    } else spare = this.makeSpare(v, agent, good.item, store, good.allow);
    // (s44: a carved pumpkin is a pumpkin and the shears' cut, shears in storage)
    if (good.carve) {
      const n = Math.min(good.batch, Math.ceil(want / good.unit) * good.unit, store.pumpkin ?? 0, spare.pumpkin ?? 0);
      if (!(store.shears > 0)) return { why: 'inputs short' };
      return n > 0 ? { count: n, bill: { [good.item]: n }, inputs: { pumpkin: n }, smelts: false } : { why: 'inputs short' };
    }
    // A good of one wood kind (X.1) plans from that kind's logs and planks only (the critique's 2)
    if (good.wood) for (const n of Object.keys(spare)) if (/_(log|planks)$/.test(n) && !n.startsWith(`${good.wood}_`)) delete spare[n];
    const plans = new Map<string, MaterialPlan>();
    const plan = (b: Counts, have: Counts) => {
      const key = `${JSON.stringify(b)}|${have === spare ? '' : JSON.stringify(have)}`;
      let p = plans.get(key);
      if (!p) plans.set(key, (p = this.materials.plan(b, have)));
      return p;
    };
    const wood = v.wood ?? this.woodOf(v, store);
    for (let count = Math.min(good.batch, Math.ceil(want / good.unit) * good.unit); count > 0; count -= good.unit) {
      const b = makeBill(this.registry, plan, good, count, spare, wood);
      if (!b) return { why: 'no recipe' };
      if (!b.feasible) continue;
      const p = plan(b.bill, spare);
      if (Object.keys(p.gather).length || p.problems.length) continue;
      const inputs: Counts = { ...p.fromStock };
      // (the fuel's coal from what the ingredients left of the spare coal, then charcoal: D13's planner counts it once)
      let fuel = p.fuel.coal;
      for (const n of ['coal', 'charcoal']) {
        const t = Math.min(fuel, (spare[n] ?? 0) - (p.fromStock[n] ?? 0));
        if (t <= 0) continue;
        inputs[n] = (inputs[n] ?? 0) + t;
        fuel -= t;
      }
      return { count, bill: b.bill, inputs, smelts: p.fuel.smelts > 0, ...(b.craft ? { craft: b.craft } : {}) };
    }
    return { why: 'inputs short' };
  }

  /**
   * Gathering's demand per material (spec 4.8): the raw materials of every good's deficit (makes under way netted out, the
   * check's M1; variants in the village's wood unless stocked slabs make them), planned from the spare storage without the
   * goods themselves (a stock already lowers the deficit), with the works furnaces' cobblestone once the plot is ready (less
   * the placements under way); the keeps' shortfall (logs, cobblestone). Less what gathering chores under way bring
   * (incoming).
   */
  gatherWanted(v: Village, store: Counts = storageContents(v)): GatherWanted {
    const going = this.goingS9(v);
    const spare = this.makeSpare(v, '', undefined, store);
    // (X.1: with the catalog family, every good of the catalogue but food, as before only the keeps)
    const goods = CHOOSE.families.has('catalog') ? this.goodsFor(v).filter((g) => !g.food) : MAKE_GOODS;
    for (const g of goods) delete spare[g.item];
    const wood = v.wood ?? this.woodOf(v, store);
    const plan = (b: Counts, have: Counts) => this.materials.plan(b, have);
    // (a good of one wood kind planned from that kind's logs and planks only, as makePlan: its gather added beside the bill)
    const ownWood = (g: MakeGood) => {
      const s2 = { ...spare };
      for (const n of Object.keys(s2)) if (/_(log|planks)$/.test(n) && !n.startsWith(`${g.wood}_`)) delete s2[n];
      return s2;
    };
    // (each kind's goods in one bill, planned once: planned alone, each counted the same stored logs, the review's L4)
    const woodBills: Record<string, Counts> = {};
    const out = Object.fromEntries(MATERIALS.map((m) => [m, { need: 0, incoming: 0, want: 0, for: [] as string[] }])) as GatherWanted;
    const mat = (n: string): Material | null => (n === 'any:logs' || /_log$/.test(n) ? 'logs' : /^(red_)?sand$/.test(n) ? 'sand' : /^(any:)?cobblestone$/.test(n) ? 'cobblestone' : null);
    const bill: Counts = {};
    for (const g of goods) {
      const d = Math.max(0, this.makeTarget(v, g) - (store[g.item] ?? 0) - going.make.filter((x) => x.item === g.item).reduce((s, x) => s + x.count, 0));
      if (!d) continue;
      if (g.wood) {
        const wb = (woodBills[g.wood] ??= {});
        wb[g.item] = (wb[g.item] ?? 0) + d;
        for (const m of new Set(Object.keys(plan({ [g.item]: d }, ownWood(g)).gather).map(mat))) if (m) out[m].for.push(g.words);
        continue;
      }
      const b = g.variant ? makeBill(this.registry, plan, g, d, spare, wood)?.bill : { [g.item]: d };
      if (!b) continue;
      for (const [n, q] of Object.entries(b)) bill[n] = (bill[n] ?? 0) + q;
      // (what each good wants gathered, for the facts: planned alone)
      const own = plan(b, spare).gather;
      for (const m of new Set(Object.keys(own).map(mat))) if (m) out[m].for.push(g.words);
    }
    // The works furnaces' 8 cobblestone each, once the plot is ready: in the bill planned from the spare storage with the
    // goods, less the placements under way (their 8 are earmarked, so the spare is already short of them): a stocked village
    // gathered 24 cobblestone it held for as long as a furnace stood unplaced (S.9's review, lens 2 H1, lens 4 M1)
    const wk = v.layouts?.[0]?.works;
    if (wk?.state === 'ready') {
      const placed = (wk.furnaces ?? []).slice(0, WORKS_FURNACES).filter(Boolean).length;
      const missing = Math.max(0, WORKS_FURNACES - placed - going.furnaces.filter((k) => !wk.furnaces?.[k - 1]).length);
      if (missing > 0) {
        bill.cobblestone = (bill.cobblestone ?? 0) + 8 * missing;
        if (plan({ cobblestone: 8 * missing }, spare).gather.cobblestone) out.cobblestone.for.push('the works furnaces');
      }
    }
    const gathered = Object.keys(bill).length ? { ...plan(bill, spare).gather } : {};
    for (const [w, wb] of Object.entries(woodBills)) for (const [n, q] of Object.entries(plan(wb, ownWood({ wood: w } as MakeGood)).gather)) gathered[n] = (gathered[n] ?? 0) + q;
    for (const [n, q] of Object.entries(gathered)) {
      const m = mat(n);
      if (m) out[m].need += q;
    }
    const logs = v.wood ? store[`${v.wood}_log`] ?? 0 : Object.entries(store).filter(([n]) => /_log$/.test(n)).reduce((s, [, q]) => s + q, 0);
    const keepLogs = Math.max(0, this.logsKeep(v) - logs), keepCobble = Math.max(0, MAKE_KEEP.cobblestone - (store.cobblestone ?? 0));
    out.logs.need += keepLogs;
    out.cobblestone.need += keepCobble;
    if (keepLogs) out.logs.for.push('the keep');
    if (keepCobble) out.cobblestone.for.push('the keep');
    // (G2, MC_ACTS: a trip for each open request of a member's for the material)
    if (ACTS.on) for (const m of MATERIALS) {
      const n = openRequests(v.name, `gather:${m}`);
      if (n) {
        out[m].need += n * GATHER_KINDS[m].trip;
        out[m].for.push('a request');
      }
    }
    for (const g of going.gather) out[g.material].incoming += g.n;
    for (const m of MATERIALS) out[m].want = Math.max(0, out[m].need - out[m].incoming);
    return out;
  }

  /**
   * G8, MC_IRON_AGE (spec 4.1, draft 2's B1-B3): the iron chain as three kinds of work several members may hold at once:
   * a trip to the iron level on a leg of its own (up to IRON_MINERS: `irondig:1..3`), raw iron smelted at a free works
   * furnace (`ironsmelt:k`, the furnace held), and an iron tool forged from stored ingots for a member who asked for it or
   * whose work needs it and who has none of its own, given to that member (`ironforge:<member>`); the village's own
   * pickaxe and bucket first when it has none. The chain does not stop at "tools made".
   */
  private ironAgeOptions(v: Village, a: BotAgent, busy: Set<string>, store: Counts, now: number, reasons: Partial<Record<ChoiceKind, string>>,
    add: (o: Omit<ChoiceOption, 'holds'> & { holds?: string[] }, data: OptionRun) => void, record: (kind: ChoiceKind) => string,
    lastOf: (kind: ChoiceKind, id?: string) => string, others: (kind: ChoiceKind, id?: string) => string) {
    const m = v.mine;
    if (!m || m.level === undefined) {
      reasons.iron = 'no mine';
      return;
    }
    const tries = m.ironTries && m.ironLastTry && now - m.ironLastTry.at > 60 * 60000 ? {} : m.ironTries ?? {};
    // (several members work each kind at once: one member's failure is not the village's; three in a row since the last
    // success back that kind off 10 minutes, staged I1: one miner without a pickaxe stopped all digging for 25 minutes)
    const backing = (stage: string) => ((tries as Record<string, number>)[stage] ?? 0) >= 3 && m.ironLastTry?.stage === stage && now - m.ironLastTry.at < 10 * 60000;
    const raw = store.raw_iron ?? 0;
    // (ingots another chore has earmarked are not this forge's: two forges on 4-6 ingots failed "cannot be made" 18 times in
    // IM1, then the forge was banned for two hours)
    let held = 0;
    for (const [hk, c] of makeHolds) if (hk.startsWith(`${v.name}|`)) held += c.iron_ingot ?? 0;
    const ingots = Math.max(0, (store.iron_ingot ?? 0) - held);
    const why: string[] = [];
    let added = 0;
    const slot = Array.from({ length: IRON_MINERS }, (_, i) => i + 1).find((q) => !busy.has(`irondig:${q}`));
    // (#113: a level ended with no way down is offered again once its back-off is over: ironDone)
    // (#165: no digging while a monument is under way and storage holds IRON_MONUMENT_ENOUGH: Cologne's 1:3 run sent three
    // diggers down one shaft for 127 minutes with 230 ingots stored, 512 of its 1,376 [stuck] lines and most of its meals'
    // climbs out of the mine)
    const monumentBusy = MONUMENT.on && !!v.monument && v.monument.state !== 'site' && (v.monument.state !== 'built' || furnishStage(v.monument) > 0 && currentStage(v.monument) === furnishStage(v.monument));
    if (ironDone(m, now)) why.push('iron level finished');
    else if (monumentBusy && raw + ingots >= IRON_MONUMENT_ENOUGH) why.push(`iron enough while the monument is built (${raw + ingots} stored)`);
    else if (slot === undefined) why.push('every leg busy');
    else if (backing('dig')) why.push('digging backs off');
    else {
      added++;
      add({
        id: 'iron:dig', kind: 'iron', key: `irondig:${slot}`, excludes: [`irondig:${slot}=`], name: 'Dig for iron in the mine', rank: 700,
        facts: `${raw} raw iron and ${ingots} iron ingots in storage; the iron level ${m.iron ? `${m.iron.level !== undefined ? `at y ${m.iron.level}, ` : ''}${m.iron.dug} cells dug` : 'not started'}${others('iron', 'iron:dig')}; ${record('iron')}${lastOf('iron', 'iron:dig')}`,
        effect: `raw iron for the smelters (${raw} in storage)`,
      }, { kind: 'iron', stage: 'dig', tool: '', iron: raw });
    }
    // (a works furnace first, else the hut's: the workshop's makes held all three works furnaces most of staged I1)
    const free = this.freeFurnaces(v, busy), k = free.find((q) => q >= 1) ?? free[0];
    // (a load of 8 or fewer goes to one smelter at a time: two took the same 7 raw iron in staged I5, and the second failed)
    const smelting = [...busy].some((q) => q.startsWith('ironsmelt:'));
    if (raw < 1) why.push('no raw iron to smelt');
    else if (raw <= 8 && smelting) why.push('being smelted');
    else if (k === undefined) why.push('works furnaces busy');
    else if (backing('smelt')) why.push('smelting backs off');
    else {
      added++;
      const n = Math.min(8, raw);
      add({
        id: 'iron:smelt', kind: 'iron', key: `ironsmelt:${k}`, holds: [`furnace:${k}`], excludes: [`ironsmelt:${k}=`, `furnace:${k}=`], name: 'Smelt raw iron into ingots', rank: 701,
        facts: `${raw} raw iron and ${ingots} iron ingots in storage; at ${k ? `works furnace ${k}` : "the hut's furnace"}${others('iron', 'iron:smelt')}${lastOf('iron', 'iron:smelt')}`,
        effect: `up to ${n} iron ingots for the smiths`,
      }, { kind: 'iron', stage: 'smelt', tool: '', iron: raw, k, count: n });
    }
    const need = this.forgeNeed(v);
    const who = (need?.for ?? 'village').toLowerCase();
    if (!need) why.push('no tool wanted');
    else if (ingots < FORGE_COST[need.tool]) why.push(`ingots short for ${need.for ? `${need.for}'s` : 'the village\'s'} ${words(need.tool)} (${ingots} of ${FORGE_COST[need.tool]})`);
    else if (busy.has(`ironforge:${who}`)) why.push('being forged');
    else if (backing(`forge:${need.tool}`)) why.push('forging backs off');
    else {
      added++;
      add({
        id: need.for && !need.asked ? `iron:forge:${need.tool}:${need.for}` : `iron:forge:${need.tool}`, kind: 'iron', key: `ironforge:${who}`, excludes: [`ironforge:${who}=`],
        name: need.for ? `Make an iron tool for ${need.for}: ${words(need.tool)} (${need.why})` : `Make the village ${words(need.tool)} (${need.why})`, rank: 702,
        facts: `${ingots} iron ingots in storage, ${FORGE_COST[need.tool]} needed${others('iron', `iron:forge:${need.tool}`)}${lastOf('iron')}`,
        effect: need.for ? `${need.for} gets its own ${words(need.tool)}` : `a ${words(need.tool)} in the village storage`,
      }, { kind: 'iron', stage: 'forge', tool: need.tool, iron: ingots, ...(need.for ? { for: need.for } : {}) });
    }
    if (!added) reasons.iron = why.join('; ');
  }

  /** G8: who the next iron tool is for: an open request for one first, then members whose work needs it and who have none
   *  given (miners, farmers, shearers, milkers), then the village's own pickaxe and bucket (as before the iron age). */
  private forgeNeed(v: Village): { tool: string; for?: string; why: string; asked?: boolean } | null {
    const given = v.mine?.ironGiven ?? [];
    const has = (name: string, tool: string) => given.some((g) => g.to === name && g.item === tool);
    if (ACTS.on) for (const t of FORGE_TOOLS) {
      const asker = requestersOf(v.name, `iron:forge:${t}`).find((n) => !has(n, t));
      if (asker) return { tool: t, for: asker, why: 'asked for one', asked: true };
    }
    const members = [...this.agents.values()].filter((b) => b.village()?.name === v.name && b.memory.villageRole !== 'mayor');
    for (const [t, test, why] of FORGE_NEEDS)
      for (const b of members) {
        const kinds = this.workKinds.get(b.name.toLowerCase());
        if (kinds && test(kinds) && !has(b.name, t)) return { tool: t, for: b.name, why };
      }
    const made = v.mine?.ironMade ?? [];
    if (!made.includes('iron_pickaxe')) return { tool: 'iron_pickaxe', why: 'it has none' };
    if (!made.includes('bucket')) return { tool: 'bucket', why: 'it has none' };
    return null;
  }

  /** G8: the kinds of work each member has taken in this process (the forge's "work needs a tool"). */
  private workKinds = new Map<string, Map<string, number>>();

  /** Free furnace keys for a smelting make (D5), in order 1, 2, 3 (the works furnaces recorded), then 0 (the hut's). */
  freeFurnaces(v: Village, busy: Set<string>): number[] {
    const out: number[] = [];
    const f = v.layouts?.[0]?.works?.furnaces ?? [];
    const now = Date.now();
    // (not one a smelt could not reach in the last 10 minutes: F233's works furnace failed every catalogue smelt sent to it)
    for (let k = 1; k <= WORKS_FURNACES; k++) if (f[k - 1] && !busy.has(`furnace:${k}`) && (this.furnaceBack.get(`${v.name}:${k}`) ?? 0) <= now) out.push(k);
    if (villageStationCell(v, 'furnace') && !busy.has('furnace:0')) out.push(0);
    return out;
  }

  // ---- B.4: lighting's parts and the torch demand (pure; the menu, the skill and the offline checks read them) ----------

  /** lightParts' cache, by village: the signature it was computed on (L3; left out of the golden check's purity snapshot),
   *  and the quick signature checked first (#142). */
  private lightCache = new Map<string, { sig: string; quick: string; parts: LightPart[] }>();

  /**
   * The parts a village lights (B.4, D3, D9): its buildings (structures with a design in v.designs and a done Build task
   * at their x, z; turned by the task's rotate), by unlit spots, most first, then the mine's parts. A building's spots are
   * buildingLights' (vanilla's own cells, then code's inside ones; off its signs and lamps) at the structure's floor; the
   * mine's mineLights'. Cached on a signature of what they are computed from. An exception (a malformed stored design, a
   * mine record missing a field) is logged once a village and gives no parts: makeTarget, the make and gather menus and the
   * sweep read them, and one village's bad record stopped every village's chores (B.4's review, lens 3 L5).
   */
  lightParts(v: Village): LightPart[] {
    try {
      return this.lightPartsOf(v);
    } catch (e) {
      if (!this.lightFailed.has(v.name)) console.error(`[light] ${v.name}: the light parts could not be worked out (no lighting):`, e);
      this.lightFailed.add(v.name);
      return [];
    }
  }

  /** Villages whose light parts threw (logged once). */
  private lightFailed = new Set<string>();

  private lightPartsOf(v: Village): LightPart[] {
    const m = v.mine;
    // (#142: the full signature stringified every structure, done build and lit spot on each call, several calls a member's
    // menu: 336 of 579 ms of C1's late menus (217 structures, 166 small works). The quick one counts the same things; only
    // when it changes is the full one worked out. Done builds, lit spots and structures are only added or replaced, so a
    // change moves a count or an id)
    const doneBuilds = v.tasks.reduce((n, t) => n + (t.status === 'done' ? 1 : 0), 0);
    const quick = `${v.complete ?? false}|${v.structures.length}:${v.structures.map((st) => st.id).join(',')}|${v.tasks.length}:${doneBuilds}|${Object.keys(v.designs).length}|`
      + `${(v.layouts ?? []).map((l) => `${l.signs?.length ?? 0}/${l.lamps?.length ?? 0}`).join(',')}|${Object.entries(v.lights ?? {}).map(([k, r]) => `${k}:${r.done.length}/${r.never?.length ?? 0}`).join(',')}|`
      + JSON.stringify(m ? [m.level, m.steps, m.stopped, m.dug, (m.legs ?? []).map((l) => [l.main, l.br, l.dug, l.ended, l.end]), m.down, m.iron ? [m.iron.x, m.iron.z, m.iron.steps, m.iron.level, m.iron.finished, m.iron.legs.map((l) => [l.dug, l.end])] : null] : null);
    const hit = this.lightCache.get(v.name);
    if (hit?.quick === quick) return hit.parts;
    const builds = v.tasks.filter((t) => t.status === 'done' && /^build_design "/.test(t.detail)).map((t) => t.detail.slice(0, 120));
    const sig = JSON.stringify([
      v.complete ?? false, v.structures.map((st) => `${st.id}:${st.kind}:${st.x1},${st.z1},${st.y}`), builds, Object.keys(v.designs),
      (v.layouts ?? []).map((l) => [l.signs?.map((q) => `${q.x},${q.layer},${q.z}`), l.lamps]),
      m ? [m.level, m.steps, m.stopped, m.dug, (m.legs ?? []).map((l) => [l.main, l.br, l.dug, l.ended, l.end]), m.down, m.iron ? [m.iron.x, m.iron.z, m.iron.steps, m.iron.level, m.iron.finished, m.iron.legs.map((l) => [l.dug, l.end])] : null] : null,
      v.lights ?? null,
    ]);
    const old = this.lightCache.get(v.name);
    if (old?.sig === sig) {
      old.quick = quick;
      return old.parts;
    }
    const rec = (part: string) => v.lights?.[part];
    const unlitOf = (part: string, keys: string[]) => {
      const r = rec(part);
      return keys.filter((k) => !r?.done.includes(k) && !r?.never?.includes(k));
    };
    const signs = (v.layouts ?? []).flatMap((l) => l.signs ?? []);
    const lamps = (v.layouts ?? []).flatMap((l) => l.lamps ?? []);
    const buildings: LightPart[] = [];
    const labels = new Map<string, number>();
    for (const st of v.structures) {
      const d = v.designs[st.kind];
      if (!d) continue;
      const place = this.structurePlace(v, st, d);
      if (!place) continue;
      const lights = buildingLights(place, { vanilla: vanillaLights(d), signs, lamps, facades: LIGHT_FACADES })
        // (every spot inside the structure's area, the spec's assertion: one outside would light a neighbour)
        .filter((q) => q.x >= st.x1 && q.x <= st.x2 && q.z >= st.z1 && q.z <= st.z2);
      const spots = lights.map((q) => ({ x: q.x, y: st.y + q.layer, z: q.z, block: q.block, ...(q.facing ? { facing: q.facing } : {}), src: q.src }));
      const vanilla = d.by === 'vanilla' || isVanillaPieceName(d.name);
      let label = d.name === STORAGE_HUT ? 'storage hut' : d.name === MINING_HUT ? 'mining hut' : /_meeting_point_/.test(d.name) ? 'meeting point' : signLabel(d.name, vanilla).join(' ').toLowerCase();
      const seen = (labels.get(label) ?? 0) + 1;
      labels.set(label, seen);
      if (seen > 1) label = `${label} ${['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][seen] ?? seen}`;
      const keys = spots.map((q) => `${q.x},${q.y},${q.z}`);
      buildings.push({ part: st.id, label, kind: 'building', structure: st, place, spots, unlit: unlitOf(st.id, keys).length, growing: false });
    }
    // The walk from the storage hut's door to each building's (the facts' minutes)
    const hutPart = buildings.find((b) => b.structure?.kind === STORAGE_HUT);
    const hutDoor = (hutPart?.place && placedDoor(hutPart.place)) ?? (v.storageHut ? { x: Math.round((v.storageHut.x1 + v.storageHut.x2) / 2), z: v.storageHut.z2 + 1 } : null);
    for (const b of buildings) {
      const door = b.place ? placedDoor(b.place) : null;
      const to = door ?? (b.structure ? { x: (b.structure.x1 + b.structure.x2) / 2, z: (b.structure.z1 + b.structure.z2) / 2 } : null);
      if (hutDoor && to) b.walk = Math.round(Math.hypot(to.x - hutDoor.x, to.z - hutDoor.z));
    }
    buildings.sort((p, q) => q.unlit - p.unlit);
    const mine: LightPart[] = [];
    if (m) {
      const faces = mineFacesGoing(m);
      const byPart = new Map<string, MineLightSpot[]>();
      for (const q of mineLights(m)) byPart.set(q.part, [...(byPart.get(q.part) ?? []), q]);
      const tunnels = new Map<string, number>();
      for (const [part, list] of byPart) {
        const spots = list.map((q) => ({ x: q.x, y: q.y, z: q.z, block: 'wall_torch' as const, sides: q.sides }));
        const waiting = new Set(list.filter((q) => nearMineFace(faces, q)).map((q) => `${q.x},${q.y},${q.z}`));
        const unlit = unlitOf(part, spots.map((q) => `${q.x},${q.y},${q.z}`)).filter((k) => !waiting.has(k)).length;
        let label = 'mine stairs';
        const leg = /^mine:(\d+)$/.exec(part), down = /^mine:down:(\d+)$/.exec(part);
        if (part === 'mine:iron') label = 'iron level';
        else if (down) label = `mine's stairs down${Number(down[1]) ? ` ${['', 'two', 'three'][Number(down[1])] ?? Number(down[1]) + 1}` : ''}`;
        else if (leg) {
          const l = m.legs![Number(leg[1])];
          const dir = l.dir[0] > 0 ? 'east' : l.dir[0] < 0 ? 'west' : l.dir[1] > 0 ? 'south' : 'north';
          const n = (tunnels.get(dir) ?? 0) + 1;
          tunnels.set(dir, n);
          label = `mine's ${dir} tunnel${n > 1 ? ` ${['', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? n}` : ''}`;
        }
        mine.push({ part, label, kind: 'mine', spots, unlit, growing: mineGrowing(m, part) });
      }
    }
    const parts = [...buildings, ...mine];
    this.lightCache.set(v.name, { sig, quick, parts });
    return parts;
  }

  /** The torches lighting still wants (D7): every part's unlit spots, less the torches light chores carry (L2). */
  torchDemand(v: Village): number {
    let unlit = this.lightParts(v).reduce((n, p) => n + p.unlit, 0);
    // (a growing village's: the neighbourhood's lamps still to light, whose job takes stored torches first, s30)
    if (growing(v))
      (v.layouts ?? []).forEach((l, i) => {
        if (l.lamps?.length && !l.lit && v.tasks.some((t) => (t.status === 'open' || t.status === 'claimed') && t.detail.startsWith(`light_streets layout=${i + 1} `))) unlit += l.lamps.length;
      });
    let carried = 0;
    for (const [k, q] of lightCarried) if (k.startsWith(`${v.name}|`)) carried += q;
    return Math.max(0, unlit - carried);
  }

  /** A good's target in storage (D7): torches follow lighting's demand while the light family is on, max(32, min(64,
   *  demand) + 8); every other good, and torches with the family off, the table's. */
  makeTarget(v: Village, g: MakeGood): number {
    // (s42: and the merchant's open orders for it, on top)
    const ordered = ORDERS_ON ? (v.merchant?.orders ?? []).filter((o) => o.state === 'open' && o.item === g.item).reduce((s, o) => s + o.n, 0) : 0;
    // (G2, MC_ACTS: a batch for each open request of a member's for it)
    const requested = ACTS.on ? openRequests(v.name, `make:${g.item}`) * g.batch : 0;
    return ordered + requested + this.baseTarget(v, g);
  }

  private baseTarget(v: Village, g: MakeGood): number {
    if (g.rung === 'letters') return this.lettersTarget(v, g.item);
    // (food, s30's D13: bread two a member, pies one for two, where the village keeps an appetite; none otherwise)
    // (s39 tier 1, MC_NEED_WORKS: three and one a member while the food flow is short)
    if (g.food) return !appetiteOn(v) ? 0 : foodTarget(g.item === 'bread' ? 'bread' : 'pumpkin_pie', this.growMembers(v).length, NEED_WORKS && !!v.foodFlow?.short);
    if (g.item !== 'torch' || !CHOOSE.families.has('light')) return g.target;
    return Math.max(g.target, Math.min(TORCH_DEMAND_CAP, this.torchDemand(v)) + TORCH_RESERVE);
  }

  /** #21: the books the letters rung still wants bound (16 less those counted; 0 when letters is not current). */
  private booksLeft(v: Village): number {
    return lettersCurrent(v) ? Math.max(0, LETTERS_BOOKS - (v.ladder?.totals?.books ?? 0)) : 0;
  }

  /**
   * #21 (MC_LETTERS, spec 9 S4): a rung good's target in storage, as the stock plus what is still wanted, so a make's want
   * (target less stock and makes under way) is what the library needs: books, 16 less those bound; bookshelves, the
   * library's shelves and lectern still to place less the shelves and lecterns stored; the lectern, one once a shelf
   * beyond the 4 the shelving takes is stored and none is placed.
   */
  private lettersTarget(v: Village, item: string): number {
    if (!lettersCurrent(v)) return 0;
    const store = storageContents(v);
    const left = libraryLeft(v);
    const shelves = store.bookshelf ?? 0, lecterns = store.lectern ?? 0;
    if (item === 'book') return (store.book ?? 0) + this.booksLeft(v);
    if (item === 'bookshelf') return shelves + Math.max(0, left.shelves + left.lectern - shelves - lecterns);
    if (item === 'lectern') return left.lectern && !lecterns && shelves > left.shelves ? 1 : lecterns;
    return 0;
  }

  /**
   * #21 (MC_LETTERS, spec 9 S4): what other makes leave of the rung's goods and inputs: the shelves the shelving still
   * places (the lectern takes only a fifth), the enchanting table's book once 15 are bound (and after the rung), the
   * leather the books still to bind take (but to the book make itself).
   */
  private lettersKeep(v: Village, item: string, except?: string): number {
    if (item === 'bookshelf' && lettersCurrent(v)) return libraryLeft(v).shelves;
    if (item === 'book') return lettersReached(v) || (lettersCurrent(v) && (v.ladder?.totals?.books ?? 0) >= LETTERS_BOOKS - 1) ? 1 : 0;
    if (item === 'leather' && except !== 'book') return this.booksLeft(v);
    // (the cane farm's start first: staged L5s' first book took 6 of the 8 bought for it)
    if (item === 'sugar_cane' && except === 'book') return this.tradeKeep(v, 'sugar_cane') ?? 0;
    return 0;
  }

  /** s41: a library activity's keep (its gives together): the spec's own, else two a member for food while the village
   *  keeps an appetite, else LIBRARY_KEEP (F258: no surplus nobody uses, lesson 149). */
  libraryKeep(v: Village, sp: LibrarySpec): number {
    if (sp.keep) return sp.keep;
    if (sp.gives.some((g) => g.consumer === 'food') && appetiteOn(v)) return Math.max(LIBRARY_KEEP, 2 * this.growMembers(v).length);
    return LIBRARY_KEEP;
  }

  /** The village's makes and gathering trips under way (S.9), but `except`'s own (its make plans with itself left out). */
  private goingS9(v: Village, except?: string) {
    const make: Array<{ item: string; count: number; smelts: boolean; k?: number }> = [], gather: Array<{ material: Material; n: number }> = [], furnaces: number[] = [];
    const skip = except?.toLowerCase();
    for (const [id, c] of this.chores) {
      if (c.village !== v.name || id === skip || !this.agents.has(id) || !c.status.some((q) => q.state === 'queued' || q.state === 'running')) continue;
      if (c.choice.make) make.push(c.choice.make);
      if (c.choice.gather) gather.push(c.choice.gather);
      if (c.choice.furnace !== undefined) furnaces.push(c.choice.furnace);
    }
    return { make, gather, furnaces };
  }

  /**
   * Whether miners leave the storage's spoken-for cobblestone alone (S.1): only where the pickaxe supply makes up for it,
   * in a village of five or more or once a supply is posted. In a smaller one the reserve made the first pickaxe wooden
   * (half the digging speed, 59 blocks) where two or three miners took at most a few cobblestone before.
   */
  pickaxeReserve(v: Village): boolean {
    return v.tasks.some((t) => PICK_SUPPLY.test(t.title)) || [...this.agents.values()].filter((a) => a.village() === v).length >= SUPPLY_MEMBERS;
  }

  /**
   * Cobblestone in storage the pickaxe supply is still to take: all of it while the task waits with its own gathering
   * finished; while it runs, all of it less what its maker and the storage's pickaxes gained since its claim (withdrawn,
   * made into pickaxes, deposited: its own pickaxe and leftover cobblestone are not the task's); nothing otherwise.
   */
  private supplyDraw(v: Village): number {
    const t = v.tasks.find((x) => PICK_SUPPLY.test(x.title) && (x.status === 'open' || x.status === 'claimed'));
    if (!t) return 0;
    const n = 3 * Number(PICK_SUPPLY.exec(t.title)![1]);
    if (t.status === 'open') return t.after.every((id) => !/^(open|claimed)$/.test(v.tasks.find((q) => q.id === id)?.status ?? '')) ? n : 0;
    const maker = this.agents.get(t.claimedBy?.toLowerCase() ?? '');
    const start = this.supplyStart.get(`${v.name}:${t.id}`);
    if (!maker || !start || start.by !== maker.name) return n;
    const gained = this.stoneHeld(maker) - start.held + 3 * (storageContents(v).stone_pickaxe ?? 0) - start.stored;
    return Math.max(0, n - Math.max(0, gained));
  }

  /**
   * The soft pickaxe supply (S.1): "Make 4 stone_pickaxe into storage", once a village, when the mine is dug and buildings
   * still wait, so miners without a pickaxe take a stone one from storage instead of the builds' cobblestone. Its
   * cobblestone is gathered for it first unless the storage has that much to spare beyond the reserve. Posted last on the
   * board, and only where it is off the critical path: five or more members, or two workers holding no task (a scripted
   * worker takes the first claimable task, so in a three-agent village it would take it a second before a build). Closed
   * as moot once nothing is left to build.
   */
  private pickaxeSupply(v: Village, store: Counts, wood: string) {
    const reg = this.villages;
    const own = v.tasks.filter((t) => PICK_SUPPLY.test(t.title) || PICK_GATHER.test(t.title));
    if (!v.tasks.some((t) => /^Build /.test(t.title) && (t.status === 'open' || t.status === 'claimed'))) {
      const moot = own.filter((t) => t.status === 'open');
      for (const t of moot) {
        t.status = 'done';
        t.result = 'not needed: every building is built';
        t.updated = Date.now();
        reg.note(v, `${t.id} "${t.title}" was not needed: every building is built`);
      }
      if (moot.length) reg.save();
      return;
    }
    // (not in a complete village: a growing one's board would take it as the neighbourhood's, for miners who have pickaxes;
    // G3 made 4 nobody needed, s30's review)
    if (v.complete || own.length || v.mine?.level === undefined || !v.tasks.some((t) => /^Build /.test(t.title) && t.status === 'open')) return;
    const members = [...this.agents.values()].filter((a) => a.village() === v);
    const busy = new Set(v.tasks.filter((t) => t.status === 'claimed').map((t) => t.claimedBy?.toLowerCase()));
    const idle = members.filter((a) => a.role !== 'mayor' && !busy.has(a.name.toLowerCase())).length;
    if (members.length < SUPPLY_MEMBERS && idle < 2) return;
    // Logs for the sticks (and a table where none is near): the village's kind, else the storage's commonest
    const logs = Object.entries(store).filter(([n, q]) => /_log$/.test(n) && q >= 3).sort((x, y) => y[1] - x[1]);
    const kind = v.wood && (store[`${v.wood}_log`] ?? 0) >= 3 ? `${v.wood}_log` : logs[0]?.[0];
    if (!kind) return;
    const n = PICK_BATCH, need = 3 * n;
    const reserved = this.reservedInStorage(v, 'cobblestone');
    const gather = (store.cobblestone ?? 0) - reserved >= need ? [] : gatherTasks({ cobblestone: need }, 'stone pickaxes').map((t) => ({ ...t, soft: true }));
    const made = reg.post(v, [...gather, {
      title: `Make ${n} stone_pickaxe into storage`,
      detail: `withdraw item=cobblestone count=${need}, withdraw item=${kind} count=3, craft item=stone_pickaxe count=${n} wood=${kind.replace(/_log$/, '')}, then deposit item=stone_pickaxe count=${n} (by name: deposit all keeps tools)`,
      soft: true,
      after: gather.length ? [0] : [],
    }], 'code', 4);
    const why = `storage ${store.cobblestone ?? 0} cobblestone, ${reserved} reserved for buildings${gather.length ? `; its ${need} gathered first` : ''}`;
    reg.note(v, `code posted ${made.map((t) => t.id).join(', ')}: a stone pickaxe supply for the miners (${why})`);
    reg.save();
    console.log(`[pickaxe] code posted ${made.map((t) => `${t.id} "${t.title}"`).join(', ')} in ${v.name} (${why}; ${members.length} members, ${idle} workers idle)`);
  }

  /**
   * What a village still needs gathered (plan step V.3), kept in `v.needed` and shown in every village summary: the raw
   * materials of its laid-out buildings not built or being built yet and of the mayor's `add_need` items, less the
   * storage and what each worker carries of the material it is gathering. Gather tasks follow it (syncGather). At most
   * every 3 s per village.
   */
  refreshNeeds(v: Village) {
    if (!v.tasks.some((t) => t.title === 'Set up the village storage')) return;
    // (a growing village's neighbourhood is gathered for as before completion, s30 D12)
    if (v.complete && !growing(v)) {
      delete v.needed;
      return;
    }
    const now = Date.now();
    if (now - (this.needsAt.get(v.name) ?? 0) < 3000) return;
    this.needsAt.set(v.name, now);
    const add = (to: Counts, c: Counts) => { for (const [n, q] of Object.entries(c)) to[n] = (to[n] ?? 0) + q; };
    const store = storageContents(v);
    const wood = this.woodOf(v, store);
    const { bill, unbuilt } = this.openBill(v, wood);
    // The stations their own task owes (S.5): gathering is posted for them when the storage falls short, as for a building
    const owed = this.stationsBill(v);
    add(bill, owed);
    if (Object.keys(owed).length) unbuilt.push('the stations');
    // The mayor's items, in the same wood ("logs" and "planks" mean the village's kind)
    const extra: Counts = {};
    for (const [n, q] of Object.entries(v.needs ?? {})) extra[n === 'logs' ? `${wood}_log` : n === 'planks' ? `${wood}_planks` : n] = q;
    add(bill, inWood(extra, wood));
    // Held: the storage, and what a worker carries of the material its gather task is for (the preparer's felled logs
    // count once deposited: counted in hand, they closed the log tasks the builds wait for)
    const norm = (b: string) => (b === 'logs' ? `${wood}_log` : b);
    const task = new Map<string, string>();
    for (const t of v.tasks) {
      // (not the pickaxe supply's own cobblestone: it is not for the buildings, S.1)
      const m = t.status === 'claimed' && t.claimedBy && !PICK_GATHER.test(t.title) ? /^collect block=(\S+) count=\d+, then deposit/.exec(t.detail) : null;
      if (m) task.set(t.claimedBy!.toLowerCase(), norm(m[1]));
    }
    const have: Counts = { ...store };
    const carried = new Map<string, number>();
    for (const a of this.agents.values()) {
      const item = task.get(a.name.toLowerCase());
      if (a.village() !== v || !item) continue;
      const n = a.bot.inventory.items().filter((it) => (v.wood ? it.name === item : norm(it.name.replace(/^\w+_log$/, 'logs')) === item)).reduce((s, it) => s + it.count, 0);
      carried.set(a.name.toLowerCase(), n);
      have[item] = (have[item] ?? 0) + n;
    }
    // The windows' maker holds their sand, glass and panes between its withdrawal and its deposit (S.3): counted, or the
    // sand would be posted again "for the village" in that window
    for (const t of v.tasks) {
      const maker = t.status === 'claimed' && /^glass/.test(PARTS_MAKE.exec(t.title)?.[2] ?? '') ? this.agents.get(t.claimedBy?.toLowerCase() ?? '') : undefined;
      const held = maker ? heldCounts(maker) : null;
      if (held) for (const n of ['sand', 'glass', 'glass_pane']) if (held[n]) have[n] = (have[n] ?? 0) + held[n];
    }
    if (!v.wood)
      for (const n of Object.keys(have)) {
        const k = /_log$/.test(n) ? `${wood}_log` : /_planks$/.test(n) ? `${wood}_planks` : n;
        if (k !== n) {
          have[k] = (have[k] ?? 0) + have[n];
          delete have[n];
        }
      }
    // Not the cobblestone in storage the pickaxe supply is about to take (S.1): counted as the builds', it closed their
    // gathering and they came up short once the supply withdrew it
    const draw = this.supplyDraw(v);
    if (draw && have.cobblestone !== undefined) have.cobblestone = Math.max(0, have.cobblestone - draw);
    const items = Object.keys(bill).length ? gatherNames(this.materials.plan(bill, have).gather, wood) : {};
    // A village without a wood kind gathers any logs
    if (!v.wood && items[`${wood}_log`] !== undefined) {
      items.logs = items[`${wood}_log`];
      delete items[`${wood}_log`];
    }
    // Not what no one can find near the village (sand: the windows stay open)
    for (const n of v.unavailable ?? []) delete items[n];
    v.needed = { items, for: unbuilt, updated: now };
    // (before the guard below: a build under way must not hold the supply back)
    this.pickaxeSupply(v, store, wood);
    // Not while a build is under way: its builder withdraws and places, and the numbers jump (tasks were closed and
    // posted again)
    if (!v.tasks.some((t) => /^Build /.test(t.title) && t.status === 'claimed')) this.syncGather(v, items, carried);
  }

  /**
   * Gather tasks in step with what the village needs: what no open or held task covers is posted (a held task covers what
   * its worker has still to collect), and those posted here are closed again when no longer needed.
   */
  private syncGather(v: Village, need: Counts, carried: Map<string, number>) {
    const reg = this.villages;
    const norm = (b: string) => (b === 'logs' && v.wood ? `${v.wood}_log` : b);
    // (not the pickaxe supply's own cobblestone: it covers none of the buildings' need, S.1)
    const gather = (t: { title: string; detail: string }) => {
      if (PICK_GATHER.test(t.title)) return null;
      const m = /^collect block=(\S+) count=(\d+), then deposit/.exec(t.detail);
      return m ? { item: norm(m[1]), n: Number(m[2]) } : null;
    };
    // A material nobody found at all near the village (a gather task failed as not to be had) is not posted again
    const hopeless = new Set([...v.tasks.filter((t) => t.status === 'failed' && /cannot be gathered here/.test(t.result ?? '')).map((t) => gather(t)?.item), ...(v.unavailable ?? [])]);
    const storage = v.tasks.find((t) => t.title === 'Set up the village storage' && t.status !== 'failed');
    let changed = false;
    const items = new Set([...Object.keys(need), ...v.tasks.filter((t) => t.status === 'open').map((t) => gather(t)?.item).filter((x): x is string => !!x)]);
    for (const item of items) {
      const want = need[item] ?? 0;
      const open = v.tasks.filter((t) => t.status === 'open' && gather(t)?.item === item);
      const held = v.tasks.filter((t) => t.status === 'claimed' && gather(t)?.item === item);
      let covered = open.reduce((s, t) => s + gather(t)!.n, 0) + held.reduce((s, t) => s + Math.max(0, gather(t)!.n - (carried.get(t.claimedBy?.toLowerCase() ?? '') ?? 0)), 0);
      // More planned than needed: close open ones this code posted, the largest first, while the rest still covers the
      // need. Not a building's own gather tasks: closing one lets that build start early (StageH12: the storage hut's
      // cobblestone task closed because the hall's covered the total, and the hut came up 15 short); the storage check
      // closes those building by building (coveredByStock)
      for (const t of open.filter((x) => x.postedBy === 'code' && / for the village( \(\d+\/\d+\))?$/.test(x.title)).sort((x, y) => gather(y)!.n - gather(x)!.n)) {
        if (covered - gather(t)!.n < want) continue;
        covered -= gather(t)!.n;
        t.status = 'done';
        t.result = want ? `not needed: other gather tasks already cover the ${want} ${item} still to gather` : `not needed: the storage and the workers gathering it hold enough ${item}`;
        t.updated = Date.now();
        reg.note(v, `${t.id} "${t.title}" was not needed: ${t.result}`);
        changed = true;
      }
      // Less planned than needed (materials went elsewhere, the mayor asked for more): post the rest
      // A small rest of cobblestone or logs is rounded up to 8, or added to an open task this code posted (S.1: Van12a's
      // "Gather 1 cobblestone" tasks, each a whole trip to the mine). Not scarce or slow items: 1 seed made 8 is ~64 grass
      // broken, and 2 sand made 8 can fail as "only found" where the 2 were there (the check's #8)
      const rest = want - covered;
      const small = rest < 8 && /^(cobblestone|logs|\w+_log)$/.test(item);
      if (rest > 0 && !hopeless.has(item) && !open.length) {
        // Cobblestone after the mine is dug (it comes from there)
        const dig = item === 'cobblestone' ? v.tasks.find((t) => t.title === 'Dig the village mine' && (t.status === 'open' || t.status === 'claimed')) : undefined;
        // (logs and cobblestone wait for the storage; the rest is gathered meanwhile and deposited once it stands, #3)
        const early = /^(sand|red_sand|dirt|gravel|clay_ball|wheat_seeds)$/.test(item);
        const tasks = gatherTasks({ [item]: small ? 8 : rest }, 'the village', v.wood).map((t) => ({ ...t, soft: true, after: [...(storage && storage.status !== 'done' && !early ? [storage.id] : []), ...(dig ? [dig.id] : [])] }));
        const made = reg.post(v, tasks, 'code', 20);
        reg.note(v, `code posted ${made.map((t) => t.id).join(', ')}: ${want} ${item} still to gather, ${covered} planned${small ? ` (rounded up from ${rest})` : ''}`);
        changed = true;
      } else if (rest > 0 && small && !hopeless.has(item)) {
        // (a building's own gather tasks are never changed: the cover rule and their builds' prerequisites count them)
        const host = open.find((t) => t.postedBy === 'code' && / for the village( \(\d+\/\d+\))?$/.test(t.title));
        if (host) {
          const n = gather(host)!.n + rest;
          host.title = host.title.replace(/^Gather \d+/, `Gather ${n}`);
          host.detail = host.detail.replace(/count=\d+/, `count=${n}`);
          host.updated = Date.now();
          reg.note(v, `code added ${rest} ${item} to ${host.id} (now ${n}): ${want} still to gather, ${covered} planned`);
          changed = true;
        }
      }
    }
    if (changed) reg.save();
  }

  /** Whether an item id exists (add_need). */
  isItem(name: string) {
    return !!this.registry.itemsByName[name];
  }

  isAgent(name: string) {
    return this.agents.has(name.toLowerCase());
  }

  /**
   * A block with an item (so it can be carried and placed); states such as "[facing=east]" must name the block's own
   * states and values (a misspelt one passed, and /setblock then refused the block at build time, leaving a hole).
   */
  isPlaceable(block: string) {
    const m = /^(?:minecraft:)?([a-z0-9_]+)(?:\[(.*)\])?$/.exec(block.trim());
    if (!m) return false;
    const b = this.registry.blocksByName[m[1]];
    if (!b || !this.registry.itemsByName[m[1]]) return false;
    if (m[2] === undefined) return true;
    const states = (b.states ?? []) as Array<{ name: string; type: string; values?: string[] }>;
    return m[2].split(',').every((p) => {
      const [k, v] = p.split('=').map((t) => t.trim());
      const st = states.find((x) => x.name === k);
      if (!st || v === undefined) return false;
      return st.type === 'enum' ? !!st.values?.includes(v) : st.type === 'bool' ? v === 'true' || v === 'false' : /^\d+$/.test(v);
    });
  }

  /** What the architect may build with (phase D; mcMaterials.ts designBlockList), with block states. */
  designBlocks(survival: boolean) {
    return { blocks: designBlockList(survival), states: true };
  }

  get(name: string) {
    return this.agents.get(name.toLowerCase());
  }

  /** Chat is routed here (E.0): who hears a line (within HEAR_RANGE of its speaker) and who should answer it. */
  readonly routesChat = true;
  /** Lines just routed ("from\0text" to when): every bot hears every line, and it is routed once. */
  private heardAt = new Map<string, number>();
  /** Lines waiting to be routed, in order (a human's position may come over RCON). */
  private chatQueue: Promise<void> = Promise.resolve();
  /** Wakes by speaker and listener ("from|to") in the last PAIR_WINDOW_MS (the caps). */
  private pairWakes = new Map<string, number[]>();
  /** Humans' positions read over RCON (a spectator is not sent to the bots), kept a second. */
  private humanAt = new Map<string, { at: number; p: Vec3 | null }>();

  /** G2: lines members said by code (acts.ts' speaker) in the last seconds, by speaker and text: never routed as chat. */
  private spoken = new Map<string, number>();

  /** A chat line one of the bots heard (botAgent): routed once, in the order heard. */
  hearChat(from: string, text: string) {
    const now = Date.now(), key = `${from}\u0000${text}`;
    // (a world built without its constructor, chat_route.mts, has no map)
    if (this.spoken?.size) {
      for (const [k, t] of this.spoken) if (now - t > 5000) this.spoken.delete(k);
      if (this.spoken.has(key) || [...this.spoken.keys()].some((k) => text.includes(k.split('\u0000')[1]))) return;
    }
    if (now - (this.heardAt.get(key) ?? 0) < 1000) return;
    this.heardAt.set(key, now);
    if (this.heardAt.size > 100) for (const [k, t] of this.heardAt) if (now - t >= 1000) this.heardAt.delete(k);
    this.chatQueue = this.chatQueue.then(() => this.routeChat(from, text)).catch((e: unknown) => console.error('[chat] routing failed:', e));
  }

  /** Where a speaker is: an agent's own body, a player any bot sees, else (a spectator) the server's answer; null if unknown. */
  private async speakerAt(from: string): Promise<Vec3 | null> {
    const agent = this.get(from);
    if (agent) return agent.bot.entity?.position ?? null;
    for (const a of this.agents.values()) {
      const e = a.bot.players[from]?.entity;
      if (e) return e.position;
    }
    if (!/^[A-Za-z0-9_]{1,16}$/.test(from) || /^(Server|Rcon)$/.test(from)) return null;
    const c = this.humanAt.get(from);
    if (c && Date.now() - c.at < 1000) return c.p;
    let p: Vec3 | null = null;
    try {
      const out = await Promise.race([this.rcon.command(`data get entity ${from} Pos`), new Promise<string>((r) => setTimeout(() => r(''), 2000))]);
      const m = /\[(-?[\d.E-]+)d, (-?[\d.E-]+)d, (-?[\d.E-]+)d\]/.exec(out);
      if (m) p = new Vec3(Number(m[1]), Number(m[2]), Number(m[3]));
    } catch {
      /* unknown: out of range */
    }
    this.humanAt.set(from, { at: Date.now(), p });
    return p;
  }

  /** A wake from `from` to `to` within the pair's cap (counted when allowed). */
  private pairWake(from: string, to: string, cap: number): boolean {
    const now = Date.now(), k = `${from}|${to}`;
    const times = (this.pairWakes.get(k) ?? []).filter((t) => now - t < PAIR_WINDOW_MS);
    if (times.length >= cap) {
      this.pairWakes.set(k, times);
      return false;
    }
    times.push(now);
    this.pairWakes.set(k, times);
    return true;
  }

  /**
   * Who hears a line and who answers it (E.0, communications rule 2): agents within HEAR_RANGE of the speaker get it (an
   * unknown position is out of range). A human's line wakes the agents it names (as before, in any case: "mayor, ..."),
   * up to 3 and wherever they are, else the nearest in range; an agent's line wakes only agents it names, case-sensitively
   * and in range. Wakes are capped per speaker and listener (agents 2, humans 20 in 5 minutes): past it the line arrives
   * without one. Server lines (say, no player) reach every agent and wake none.
   */
  private async routeChat(from: string, text: string) {
    const listeners = [...this.agents.values()].filter((a) => a.name.toLowerCase() !== from.toLowerCase());
    if (!listeners.length) return;
    const human = !this.isAgent(from);
    const pos = await this.speakerAt(from);
    if (human && !pos && (/^(Server|Rcon)$/.test(from) || !/^[A-Za-z0-9_]{1,16}$/.test(from))) {
      for (const a of listeners) a.pushEvent('chat', `<${from}> ${text}`, { from, text });
      return;
    }
    const dist = new Map<BotAgent, number>();
    for (const a of listeners) if (pos && a.bot.entity) dist.set(a, pos.distanceTo(a.bot.entity.position));
    const inRange = (a: BotAgent) => (dist.get(a) ?? Infinity) <= HEAR_RANGE;
    const named = (a: BotAgent, flags: string) => new RegExp(`\\b${a.name}\\b`, flags).exec(text)?.index ?? -1;
    let wake: BotAgent[];
    if (human) {
      wake = listeners.filter((a) => named(a, 'i') >= 0).sort((x, y) => named(x, 'i') - named(y, 'i')).slice(0, 3);
      if (!wake.length) wake = listeners.filter(inRange).sort((x, y) => dist.get(x)! - dist.get(y)!).slice(0, 1);
    } else wake = listeners.filter((a) => inRange(a) && named(a, '') >= 0);
    wake = wake.filter((a) => this.pairWake(from, a.name, human ? 20 : 2));
    for (const a of listeners) {
      const woken = wake.includes(a);
      if (!woken && !inRange(a)) continue;
      const d = dist.get(a);
      a.pushEvent('chat', `<${from}> ${text}`, { from, text, ...(d !== undefined ? { distance: Math.round(d) } : {}), ...(woken ? { wake: true } : {}) });
    }
  }

  agentList() {
    return [...this.agents.values()];
  }

  /** prepare_site takes a layout's part (S.6). */
  readonly preparesParts = true;

  /** The village's workers in the world now (not its mayor): plan_layout splits the plot into more parts for four or more. */
  memberCount(v: Village): number {
    return [...this.agents.values()].filter((a) => a.village() === v && a.memory.villageRole !== 'mayor').length;
  }

  /** Every member of the village in the world, its mayor included: a village that grows wants a house for each (s30). */
  growMembers(v: Village): BotAgent[] {
    return [...this.agents.values()].filter((a) => a.village() === v);
  }

  /** The members whose brains take board tasks (the mayor never does): a neighbourhood nobody can build is not laid out. */
  growClaimers(v: Village): BotAgent[] {
    return this.growMembers(v).filter((a) => a.memory.villageRole !== 'mayor' && !!a.brain?.claimsTasks?.(a));
  }

  /** When each agent (lower-cased name) was last spawned: a claim older than its holder's spawn is no longer held (s30). */
  private spawnedAt = new Map<string, number>();

  // ---- s30: the village appetite (appetite.ts) ------------------------------------------------------------------------

  /** A member's appetite state where its village keeps one, else 'fed'. */
  private hungerOf(v: Village, a: { name: string }): 'fed' | 'peckish' | 'hungry' {
    const e = appetiteOn(v) ? v.food!.members[a.name] : undefined;
    return e ? stateOf(e.level) : 'fed';
  }

  /**
   * The claim gate (D8; brains filter their claims by task with it): a peckish member with food in storage takes no new
   * board task until it has eaten (one sweep, 30 s at most); a hungry one only food work (planting a field, its seeds).
   * True wherever the village keeps no appetite, before completion included (nothing drains then). "Food" is a meal this
   * member would eat (no cake while only peckish, lens 1 L1) beyond the meals other members are on their way to (M1).
   */
  mayClaim(agent: WorldAgent, task?: Task): boolean {
    const v = agent.village();
    // (N.2: another member's house is left to its owner a while, H7)
    if (HOUSING && v && task && this.ownerFirst(v, agent, task)) return false;
    if (!v || !appetiteOn(v)) return true;
    const s = this.hungerOf(v, agent);
    if (s === 'fed') return true;
    // (food work whatever storage holds: the meal may not be runnable, all eaters' places taken or its key cooling, lens 1 M2)
    if (s === 'hungry' && task && isFoodTask(task)) return true;
    if (chooseMeal(v.food.members[agent.name].level, storeForMeals(v.name, storageContents(v), agent.name))) return false;
    return s === 'peckish';
  }

  /** A member's appetite and state (the panel's bar), or null where its village keeps none. */
  appetiteOf(agent: WorldAgent): (Appetite & { state: string }) | null {
    const v = agent.village();
    const e = appetiteOn(v) ? v!.food!.members[agent.name] : undefined;
    return e ? { ...e, state: stateOf(e.level) } : null;
  }

  /** Levels set for tests (POST /api/village/:v/appetite): the members named, or every member in the world; the record
   *  started if it was not (the appetite then holds for the village from now). Returns the members' entries. */
  setAppetite(v: Village, names: string[], level: number): Record<string, Appetite> {
    const f = (v.food ??= { members: {}, made: {}, eaten: {}, meals: 0 });
    const now = Date.now();
    for (const raw of names) {
      const name = this.get(raw)?.name ?? raw;
      const e = (f.members[name] ??= { level, at: now, meals: 0, hungryMs: 0 });
      e.level = Math.max(0, Math.min(APPETITE.cap, level));
      e.at = now;
    }
    this.villages.save();
    console.log(`[food] ${v.name}: appetite set to ${level} for ${names.join(', ') || 'nobody'} (the API)`);
    return f.members;
  }

  /** #67: who is busy, every 5 s, as the runs' BusyClock counts it (an action running), for the panel's graphs. */
  private util = new UtilClock();
  private utilAt = 0;
  private utilTick() {
    const now = Date.now();
    if (now - this.utilAt < 5000) return;
    this.utilAt = now;
    this.util.sample(now, [...this.agents.values()].map((a) => ({ name: a.name, busy: !!a.current?.status })));
  }

  /** #67: busy shares over time (overall and per agent), the last `points` points of `binMin` minutes. */
  utilisation(binMin: number, points: number): UtilView {
    return this.util.view(Date.now(), binMin, points);
  }

  /** When the appetite last drained (wall ms; 0: not yet), the reference bot's world age then, and the last periodic save. */
  private appetiteAt = 0;
  private ageRef: { name: string; age: number } | null = null;
  private appetiteSaved = 0;
  private ageWarned = false;

  /**
   * Game minutes in a drain interval (the check's M4): the change in a bot's world age (the server's own ticks: a server
   * running slow at 2x drains less, as its crops grow less), else the wall time at the configured scale; an age that went
   * back, jumped (a rejoin) or nearly stopped falls back to the wall clock.
   */
  private gameMinutes(wallMs: number): number {
    const wall = (wallMs / 60000) * timeScale();
    const ref = [...this.agents.values()].find((a) => a.bot.entity && typeof a.bot.time?.age === 'number');
    const last = this.ageRef;
    this.ageRef = ref ? { name: ref.name, age: ref.bot.time.age } : null;
    if (!ref || !last || last.name !== ref.name) return wall;
    const game = (ref.bot.time.age - last.age) / 1200;
    if (game >= 0.25 * wall && game <= 2 * wall + 0.05) return game;
    if (!this.ageWarned && wall > 0) {
      this.ageWarned = true;
      console.log(`[food] world age moved ${game.toFixed(2)} game-min in ${(wallMs / 1000).toFixed(1)} s: draining by the wall clock (${timeScale()}x) when it does not follow it`);
    }
    return wall;
  }

  /**
   * The drain (D7; every 5 s from the world tick, off when MC_APPETITE is): each member of a complete village with a planted
   * wheat field loses appetite by game time, the full rate while busy (an action other than a meal running or queued), a
   * quarter idle. The interval is the tick's own, at most 15 s (the check's M3: never since a stored time, so a restart or a
   * long absence drains nothing extra). The village's record starts at its first drain; a member's entry at
   * MC_APPETITE_START. A state change is logged and saved, other changes saved at most once a minute.
   */
  private appetiteTick() {
    if (!APPETITE.rate) return;
    const now = Date.now();
    if (now - this.appetiteAt < 5000) return;
    const wallMs = this.appetiteAt ? Math.min(15000, now - this.appetiteAt) : 0;
    this.appetiteAt = now;
    const minutes = this.gameMinutes(wallMs);
    let changed = false, kept = false;
    const villages = new Map<string, Village>();
    for (const a of this.agents.values()) {
      const v = a.village();
      if (v) villages.set(v.name, v);
    }
    for (const v of villages.values()) {
      if (!v.complete || !(v.layouts ?? []).some((l) => (l.farm?.planted ?? 0) > 0)) continue;
      kept = true;
      if (!v.food) {
        v.food = { members: {}, made: {}, eaten: {}, meals: 0 };
        changed = true;
        console.log(`[food] ${v.name}: the appetite starts (${APPETITE.rate} a busy game-hour, ${APPETITE.rate * APPETITE.idle} idle; members start at ${APPETITE.start})`);
      }
      const store = storageContents(v);
      // (s39, MC_NEED_WORKS: what the members drain, counted as rate x minutes, never from levels, which stop at 0)
      let drained = 0;
      for (const a of this.growMembers(v)) {
        let e = v.food.members[a.name];
        if (!e) e = v.food.members[a.name] = { level: APPETITE.start, at: now, meals: 0, hungryMs: 0 };
        const was = stateOf(e.level);
        const running = a.current?.status.type ?? a.queue[0]?.type;
        const busy = !a.idle() && running !== 'eat_meal';
        drained += (minutes * (busy ? APPETITE.rate : APPETITE.rate * APPETITE.idle)) / 60;
        e.level = drain(e.level, minutes, busy);
        e.at = now;
        const s = stateOf(e.level);
        if (s === 'hungry') e.hungryMs = (e.hungryMs ?? 0) + wallMs;
        if (s !== was) {
          changed = true;
          console.log(`[food] ${a.name} ${s} (${e.level.toFixed(1)} of 20; storage ${foodText(store)})`);
        }
      }
      if (NEED_WORKS) {
        // (made: the rise of the ledger's finished food, in points; the first reading only sets where it stands)
        const seen = madePoints(v.food.made);
        const made = v.foodFlow?.madeSeen === undefined ? 0 : Math.max(0, seen - v.foodFlow.madeSeen);
        const flow = { ...addFlow(v.foodFlow, minutes, drained, made), madeSeen: seen };
        const reading = foodflowReading(flow, storedPoints(store));
        v.foodFlow = stepShort(flow, reading, minutes);
        if (!!v.foodFlow.short !== !!flow.short) {
          changed = true;
          console.log(`[needwork] ${v.name}: food ${v.foodFlow.short ? 'short' : 'no longer short'} (${reading?.text ?? 'no reading'}): bread and pie targets ${v.foodFlow.short ? 'raised' : 'back'}`);
        }
      }
    }
    if (changed || (kept && now - this.appetiteSaved >= 60000)) {
      this.appetiteSaved = now;
      this.villages.save();
    }
  }

  async spawn(rawName: string, o: SpawnOptions = {}): Promise<BotAgent> {
    const name = rawName.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);
    if (!name) throw new Error('invalid name');
    if (this.isAgent(name)) throw new Error(`agent ${name} already exists`);
    const brain = o.brain ?? null;
    if (brain && !MC_BRAINS[brain]) throw new Error(`unknown brain ${brain}. Options: ${Object.keys(MC_BRAINS).join(', ')}`);
    const a = new BotAgent(this, name, o.role ?? 'villager');
    this.agents.set(name.toLowerCase(), a);
    this.spawnedAt.set(name.toLowerCase(), Date.now());
    try {
      await a.ready;
    } catch (e) {
      this.agents.delete(name.toLowerCase());
      a.bot.quit();
      throw e;
    }
    if (o.reset) {
      for (const c of [`clear ${name}`, `effect clear ${name}`, `effect give ${name} minecraft:instant_health 1 10 true`, `effect give ${name} minecraft:saturation 1 10 true`, `xp set ${name} 0 levels`])
        await this.rcon.command(c);
      // Back to the world spawn (the server tells every bot where it is), on the surface
      const sp = a.bot.spawnPoint;
      if (!o.position && sp) o.position = { x: Math.floor(sp.x) + 0.5, z: Math.floor(sp.z) + 0.5 };
    }
    if (o.gamemode === 'creative' || o.gamemode === 'survival') await this.rcon.command(`gamemode ${o.gamemode} ${name}`);
    // (staged tests: real faster digging, MC_HASTE; after the reset's effect clear)
    if (hasteLevel()) await this.rcon.command(`effect give ${name} minecraft:haste infinite ${hasteLevel() - 1} true`);
    if (o.position) {
      // Without y, land on the highest block at x, z
      const { x, z } = o.position;
      if (o.position.y !== undefined) await this.rcon.command(`tp ${name} ${x} ${o.position.y} ${z}`);
      else {
        // spreadplayers refuses water ("Could not spread"), and the agent then stayed where its name last stood, 1,300
        // blocks away (Scout1, F105): the nearest dry land within 16, then 64 blocks, else dropped in from above
        let out = '';
        for (const r of [0, 16, 64]) {
          out = await this.rcon.command(`spreadplayers ${x} ${z} 0 ${Math.max(1, r)} false ${name}`);
          if (!/could not spread/i.test(out)) break;
        }
        if (/could not spread/i.test(out)) {
          console.log(`[spawn] ${name}: no dry land within 64 of ${x},${z}; dropped in from y 120`);
          await this.rcon.command(`tp ${name} ${x} 120 ${z}`);
        }
      }
      // Let the teleport arrive, then the chunks around the new place
      await new Promise((ok) => setTimeout(ok, 1000));
      await a.bot.waitForChunksToLoad();
    }
    if (o.memory) Object.assign(a.memory, o.memory);
    if (typeof a.memory.village === 'string' && a.memory.village) this.villages.ensure(a.memory.village);
    // (G1: the roster for a respawn; with memory on, a spawn with reset begins a run and empties the member's memory)
    if (typeof a.memory.village === 'string' && a.memory.village) {
      noteSpawn(a.memory.village, name, { role: a.role, brain, gamemode: o.gamemode, memory: o.memory ?? {}, reset: !!o.reset });
      // (character v2: a spawn with reset begins the village's run once in this process, as G1's memory)
      if (characterAny() && o.reset && typeof a.memory.village === 'string' && !this.characterBegun.has(a.memory.village)) {
        this.characterBegun.add(a.memory.village);
        characterRunBegin(a.memory.village, Date.now());
      }
      // (a respawn after a restart: the chooser's statistics, empty, refilled from the member's stored ends, so the option
      // facts, the pattern line, bans and cooldowns agree with what it remembers; the review's S4)
      const kept = MEMORY.on && !o.reset ? agentMemory(a.memory.village, name) : undefined;
      if (kept && !this.choiceStats.agentHistory(a.memory.village, name, 1).length)
        for (const e of kept.log) if (CHOICE_KINDS.includes(e.kind as ChoiceKind))
          this.choiceStats.record({ village: kept.village, agent: name, kind: e.kind as ChoiceKind, id: e.option, ok: e.ok, cut: e.cut, contention: false, productive: e.productive, minutes: e.minutes, at: e.t, line: e.line });
    }
    // (a fresh start empties the appetite too, s30's D6)
    const fresh = o.reset && APPETITE.rate ? a.village()?.food?.members[a.name] : undefined;
    if (fresh) {
      fresh.level = APPETITE.start;
      fresh.at = Date.now();
      // (saved now: the drain's periodic save may be a minute off, and a restart before it kept the old level, lens 1 L3)
      this.villages.save();
    }
    if (brain) {
      a.brain = MC_BRAINS[brain]();
      a.brain.init?.(a);
    }
    a.pushEvent('system', `You are ${name}, a ${a.role}. You just arrived in the world.`);
    // (the token budget's limit and shares follow the agent count, E.0)
    usage.setAgents(this.agents.size, [...this.agents.values()].filter((x) => x.role === 'mayor').map((x) => x.name));
    return a;
  }

  remove(name: string): boolean {
    const a = this.get(name);
    if (!a) return false;
    this.agents.delete(name.toLowerCase());
    a.quit();
    usage.setAgents(this.agents.size, [...this.agents.values()].filter((x) => x.role === 'mayor').map((x) => x.name));
    return true;
  }

  tick() {
    this.ticks++;
    // The task boards of the villages with agents here (E.0: the claim check only reads now): when one changed, and every
    // few seconds for what changes unsaved (what gatherers carry)
    const villages = new Set<Village>();
    for (const a of this.agents.values()) {
      const v = a.village();
      if (v) villages.add(v);
    }
    for (const v of villages)
      try {
        this.villages.tickBoard(v);
      } catch (e) {
        console.error(`[board] ${v.name}: refresh failed:`, e);
      }
    for (const a of this.agents.values()) {
      try {
        a.tick();
      } catch (e) {
        console.error(`[mc] ${a.name} tick failed:`, e);
      }
    }
    try {
      this.atlas.tick();
    } catch (e) {
      console.error('[atlas] tick failed:', e);
    }
    try {
      this.farmChores();
    } catch (e) {
      console.error('[farm] check failed:', e);
    }
    try {
      this.appetiteTick();
    } catch (e) {
      console.error('[food] appetite check failed:', e);
    }
    this.utilTick();
    try {
      this.endChoices();
    } catch (e) {
      console.error('[choice] end check failed:', e);
    }
    // Animals each bot can see, each bot about every 5 s (sightings for opportunistic farming, 10-08); one bot a tick in
    // turn (E.1), so 25 bots' passes over every recorded animal never land in one tick
    const bots = [...this.agents.values()], step = 5000 / Math.max(1, bots.length), now = Date.now();
    if (bots.length && now - this.animalsAt >= step) {
      // (stepped on from the last turn, not from now: at 25 bots a 200 ms step would drift to every 250 ms on 50 ms ticks)
      this.animalsAt = Math.max(this.animalsAt + step, now - step);
      const a = bots[this.animalsNext % bots.length];
      this.animalsNext = (this.animalsNext + 1) % bots.length;
      try {
        if (a.bot.entity) this.atlas.seen(a.name, a.bot.entity.position, Object.values(a.bot.entities));
      } catch (e) {
        console.error(`[atlas] ${a.name}'s animals:`, e);
      }
    }
  }

  private animalsAt = 0;
  /** The next bot in turn for the animal sightings. */
  private animalsNext = 0;

  private farmCheckAt = 0;

  /**
   * Ripe farms harvested (farming v2, 10-08, the user's choice: a chore, not a task on the board, so completion, the
   * mayor's wake-ups and the stop rules never see it): every 30 s, each planted field of a village with agents in the
   * world is read from the bots' view (ages are state ids); when 3/4 of its wheat (at least 4) is ripe, an idle worker
   * holding no task is given `harvest_farm`. Crops only grow near agents, so a field nobody has loaded is skipped. A
   * failed harvest waits 10 minutes before the next try. In a complete village the fields are options of its members'
   * menus instead (A.2, slotChores' sweep).
   */
  private farmChores() {
    const now = Date.now();
    // (#115: a paused run gives no chores and makes no choices)
    if (isPaused() || now - this.farmCheckAt < 30000) return;
    this.farmCheckAt = now;
    const wheat = this.registry.blocksByName.wheat;
    if (!wheat) return;
    const villages = new Map<string, Village>();
    for (const a of this.agents.values()) {
      const v = a.village();
      if (v) villages.set(v.name, v);
    }
    for (const v of villages.values()) {
      // (a complete village's fields go on its members' menus: the sweep in slotChores, A.2)
      for (const [i, lay] of (v.complete ? [] : v.layouts ?? []).entries()) {
        const farm = lay.farm;
        const k = i + 1;
        if (!farm?.planted || harvesting.has(`${v.name}:${k}`)) continue;
        // (nothing ripe after all, the bots' view and the server apart: 2 minutes)
        if (farm.lastHarvest && !farm.lastHarvest.ok && now - farm.lastHarvest.at < (farm.lastHarvest.why === 'nothing ripe' ? 2 : 10) * 60000) continue;
        // Not while the planting is still to finish (it may be back on the board for seeds)
        if (v.tasks.some((t) => t.detail.startsWith(`tend_farm layout=${k} `) && (t.status === 'open' || t.status === 'claimed'))) continue;
        // (its ground prepared: a plot prepared in parts covers it only once its parts are done, S.6)
        const plot = preparedAt(v, farm);
        if (!plot) continue;
        let grown = 0, ripe = 0, unloaded = false;
        for (const [x, z] of farm.sow) {
          let s = -1;
          // (not a bot without an entity: dead, respawning or disconnected, its view may be stale)
          for (const a of this.agents.values()) if (a.bot.entity && (s = stateAt(a, x, plot.y + 1, z)) >= 0) break;
          if (s < 0) {
            unloaded = true;
            break;
          }
          if (s < wheat.minStateId || s > wheat.maxStateId) continue;
          grown++;
          if (s - wheat.minStateId >= 7) ripe++;
        }
        // (with neighbourhood farms a field of 1-3 plants is harvested once they are ripe, so harvest_farm sows its bare cells)
        if (unloaded || ripe < (GROW_FARMS ? Math.min(4, Math.max(1, grown)) : 4) || ripe < 0.75 * grown) continue;
        // Never ahead of the board's work: a worker between tasks would take the next one only after the harvest (F163's
        // pattern, the diff review)
        if (!v.complete && this.villages.claimable(v).length) continue;
        // (not while a pen's lure runs: the harvester holds seeds the chickens would follow, the pen review's L3)
        const busy = this.choreKeys(v);
        if (busy.has(`farm:${k}`) || busy.has('pen')) continue;
        const worker = this.idleWorker(v);
        if (!worker) continue;
        // (`chore`: the brains leave its events alone, as the mayor's gathering)
        this.setChore(v, worker, `farm:${k}`, [worker.enqueue('harvest_farm', { layout: k, chore: true })], `harvest the wheat on layout ${k}`);
        console.log(`[farm] ${v.name} layout ${k}: ${ripe} of ${grown} wheat ripe, ${worker.name} harvests`);
        this.villages.note(v, `${ripe} of ${grown} wheat ripe on layout ${k}'s farm: ${worker.name} harvests it (a chore)`);
      }
      // (before the sweep, which leaves members to the growth's chore and tasks, s30)
      try {
        if (LETTERS_PACE && MERCHANT_ON && v.complete) this.postStall(v);
        if (v.initiatives?.length) this.initiativeTick(v);
      } catch (e) {
        console.error(`[initiative] ${v.name}: check failed:`, e);
      }
      try {
        if (MONUMENT.on && v.complete) this.monumentTick(v);
      } catch (e) {
        console.error(`[monument] ${v.name}: check failed:`, e);
      }
      try {
        if (MERCHANT_ON && v.complete) this.merchantTick(v);
      } catch (e) {
        console.error(`[merchant] ${v.name}: check failed:`, e);
      }
      try {
        if (HOUSING && v.complete) this.homeTick(v);
      } catch (e) {
        console.error(`[home] ${v.name}: check failed:`, e);
      }
      try {
        if (NEEDS_MODE !== 'off' && v.complete) this.needTick(v);
      } catch (e) {
        console.error(`[need] ${v.name}: check failed:`, e);
      }
      try {
        this.growTick(v);
      } catch (e) {
        console.error(`[grow] ${v.name}: check failed:`, e);
        // (and growth rests a while: the sweep's hold on the mayor must not outlive a check that keeps failing)
        this.growError.set(v.name, Date.now() + 10 * 60000);
      }
      this.slotChores(v);
    }
  }

  // ---- s30: a village that grows -----------------------------------------------------------------------------------------

  /** When this server first saw each village complete (the first growth waits GROW_WAIT_MS after it), by name. */
  private growSeen = new Map<string, number>();
  /** Villages this server has seen not complete: their completion happened here (the sweep's hold on the mayor, M1). */
  private growWatched = new Set<string>();
  /** The last "enough houses" line, by village (logged once per change of houses or members). */
  private growEnough = new Map<string, string>();
  /** Until when a village's growth rests after its check threw, by name. */
  private growError = new Map<string, number>();
  /** Checks in a row a growth task's holder was idle, on no chore, without its brain holding it, by "village|task". */
  private growOrphan = new Map<string, number>();

  /** Whether a village's growth chore is queued, running or not yet dropped (a pure read: no chore is dropped here). */
  private growQueued(v: Village, now: number): boolean {
    return this.heldKeys(v, now, 'sweep').has('grow') || [...this.chores.values()].some((c) => c.village === v.name && c.key === 'grow');
  }

  /**
   * Whether growth waits only for a free member (D2 but the agent): on, complete, no neighbourhood on the board, not
   * stopped or backing off, no growth chore, fewer houses than members. With `wait`, the first GROW_WAIT_MS after this
   * server first saw the village complete count too.
   */
  private growDue(v: Village, now: number, wait: boolean): boolean {
    const g = v.growth;
    if (!GROW.on || !v.complete || g?.active || g?.stop || (g?.backoff ?? 0) > now || (this.growError.get(v.name) ?? 0) > now) return false;
    // (N.2: growth's code trigger retired; a street of houses only when a member or a vote asked for one)
    if (HOUSING && !g?.request) return false;
    if (wait && now - (this.growSeen.get(v.name) ?? now) < GROW_WAIT_MS) return false;
    if (this.growQueued(v, now)) return false;
    // (and a worker whose brain takes board tasks: the mayor never does, and a layout nobody claims sat 10 minutes until
    // "stuck", three times over, s30's review)
    return (HOUSING ? this.homeless(v).length > 0 : housesOf(v) < this.growMembers(v).length) && this.growClaimers(v).length > 0;
  }

  /**
   * The growth decision (s30, D1-D2, D14; every 30 s from farmChores, before the sweep): a neighbourhood on the board is
   * watched to its end (growEnd); otherwise, once the village has stood complete GROW_WAIT_MS (a planner call in flight at
   * completion ends first; the golden check's sweeps fall inside it, L1) and has fewer houses than members, the mayor (else
   * the first idle member) gets the chore that lays out the next one. Code decides; no model is asked. A neighbourhood
   * inherited by a server running without MC_GROW is still watched to its end (its tasks stay claimable while it is on the
   * board: growing() does not read the flag), so it never stays on the board for good; no new one is laid out.
   */
  // ---------------------------------------------------------------------------------------------
  // The first vote: the next neighbourhood's style (spec runs/2026-10-16/s33/spec_vote1.md)
  // ---------------------------------------------------------------------------------------------

  /** Votes under way, by village: in memory only (a restart forgets one; growth then holds a new one, the critique's M6). */
  private voting = new Map<string, VoteRun>();

  /** MC_VOTE, else model when the village's members choose their chores by model (memory.choose), else predicted. */
  private voteMode(v: Village): VoteMode {
    if (VOTE_SETTING) return VOTE_SETTING;
    return this.growMembers(v).some((a) => this.chooseMode(a) === 'model') ? 'model' : 'predicted';
  }

  /** The style of a layout's houses: the biome all its vanilla small houses share (R3: members' own houses their family);
   *  null when it has none, or drawn or mixed. */
  private layoutStyle(names: string[], v?: Village): string | null {
    const b = new Set(names.filter(isDwelling).map((n) => (isHomeName(baseName(n)) ? v?.designs[n]?.style?.family : undefined)
      ?? /^(plains|desert|savanna|taiga|snowy)_small_house_\d+$/.exec(baseName(n))?.[1] ?? '?'));
    return b.size === 1 && !b.has('?') ? [...b][0] : null;
  }

  /** The village's current style: that of its last layout with houses (the critique's M7), null when not one vanilla style. */
  currentStyle(v: Village): string | null {
    for (const l of [...(v.layouts ?? [])].reverse()) if (l.buildings.some(isDwelling)) return this.layoutStyle(l.buildings, v);
    return null;
  }

  /**
   * The vote's options (spec 1, the critique's M5): the current style first, then each other biome with 2+ accepted small
   * houses whose bill's uncommon materials (not logs, cobblestone, sand or dirt) lie near home for a whole neighbourhood
   * (GROW.batch houses), counted from a member within 32 blocks of home (none there: such styles are left out); at most 4.
   */
  private styleOptions(v: Village, current: string): VoteOption[] {
    const built = (b: string) => (v.layouts ?? []).filter((l) => this.layoutStyle(l.buildings, v) === b).length;
    const cur = this.styleHouses(current);
    if (!cur.length) return [];
    const out: VoteOption[] = [styleOption(current, cur, built(current), true)];
    const home = villageHome(v);
    const y = v.plots[0]?.y ?? 64;
    const near = home ? this.growMembers(v).find((a) => a.bot.entity && Math.hypot(a.bot.entity.position.x - home.x, a.bot.entity.position.z - home.z) <= 32) : undefined;
    for (const b of Object.keys(STYLE_LOOK)) {
      if (b === current || out.length >= 4) continue;
      const hs = this.styleHouses(b);
      if (hs.length < 2) continue;
      const want: Record<string, number> = {};
      for (const h of hs) for (const [k, q] of Object.entries(h.gather)) if (!/(_log|^logs|^cobblestone|^sand|^dirt)$/.test(k)) want[k] = (want[k] ?? 0) + (q / hs.length) * GROW.batch;
      if (Object.keys(want).length) {
        const found = near && home ? this.materialsNear(near.name, want, home.x, y, home.z, WORK_MATERIAL_RANGE) : null;
        if (!found || Object.entries(want).some(([k, q]) => (found[k] ?? 0) < Math.ceil(q))) {
          console.log(`[vote] ${v.name}: ${STYLE_LOOK[b].name} left off the ballot (${Object.entries(want).map(([k, q]) => `${Math.ceil(q)} ${k}`).join(', ')} wanted near home; ${found ? `found ${Object.entries(want).map(([k]) => found[k] ?? 0).join(', ')}` : 'no member near home to look'})`);
          continue;
        }
      }
      out.push(styleOption(b, hs, built(b), false));
    }
    // (R2, MC_WOOD_VARIANTS: biome x wood, the woods with trees near home)
    return WOOD_VARIANTS && home ? woodStyleOptions(out, treesNear(this.atlas.near(home.x, home.z, 96)), this.hoodLogs(v, GROW.batch), hoodWoods(v), v.wood) : out;
  }

  /** R2: the logs `n` houses of the village's library take (its first dwelling's bill), for the woods' tree test. */
  private hoodLogs(v: Village, n: number): number {
    const d = (this.vanillaLibrary(v.vanillaBiome ?? 'plains')?.houses ?? []).find((h) => isDwelling(h.name));
    return (d ? this.materialTasks(d, d.name).logs ?? 20 : 20) * n;
  }

  /** R2: the next neighbourhood's wood among those with trees near home (grow.ts hoodWood), else undefined: the village's. */
  private nextHoodWood(v: Village, n: number): string | undefined {
    const home = villageHome(v);
    return WOOD_VARIANTS && home ? hoodWood(treesNear(this.atlas.near(home.x, home.z, 96)), this.hoodLogs(v, n), hoodWoods(v)) ?? undefined : undefined;
  }

  /** R2: the wood a small work's design is in (its neighbourhood's), else the catalogue's as before. */
  private workWood(v: Village, design: string): string {
    return (WOOD_VARIANTS && smallWorkWood(design)) || this.catalogWoodOf(v);
  }

  /** What a voter sees of itself and the village (spec 3). */
  private voterContext(v: Village, a: BotAgent): { persona: string; pattern: string; self: string; village: string } {
    const mine = v.structures.filter((s) => s.builtBy === a.name).length;
    const styles = new Map<string, number>();
    for (const l of v.layouts ?? []) {
      const s = this.layoutStyle(l.buildings, v);
      if (s) styles.set(s, (styles.get(s) ?? 0) + 1);
    }
    const hoods = [...styles.entries()].map(([s, n]) => `${n} of ${(STYLE_LOOK[s]?.name ?? s).toLowerCase()}`).join(', ');
    return {
      persona: (typeof a.memory.persona === 'string' && a.memory.persona) || personaOf(a.name),
      pattern: this.patternLine(v, a),
      self: `You built ${mine} of the village's ${v.structures.length} buildings.`,
      village: `${v.name}, ${housesOf(v)} houses for ${this.growMembers(v).length} members; areas of houses: ${hoods || 'none of one style'}`,
    };
  }

  /**
   * The next neighbourhood's style (spec 2): a biome (its houses only; the current: the picks as before), null (no vote:
   * growth as before), or undefined (a vote under way: growth waits). The style decided stays in `growth.next` until its
   * layout is posted (lay_out_houses clears it, the critique's H1).
   */
  private styleFor(v: Village, now: number): string | null | undefined {
    const g = (v.growth ??= { past: [] });
    if (g.next) return g.next.style || null;
    const run = this.voting.get(v.name);
    if (run) return run.topic !== 'style' ? undefined : run.done || now - run.started >= VOTE_MAX_MS + 35000 ? this.closeVote(v, run, now) : undefined;
    const mode = this.voteMode(v);
    if (mode === 'off' || v.plan !== 'street') return null;
    const current = this.currentStyle(v);
    const options = current ? this.styleOptions(v, current) : [];
    if (options.length < 2) {
      g.next = { style: '', vote: 'none' };
      console.log(`[vote] ${v.name}: no style vote (${!current ? 'its houses are of no one vanilla style' : 'no other style buildable here'})`);
      return null;
    }
    const k = g.past.length + 1;
    const id = `${v.name}-n${k}-${now.toString(36)}`;
    const voters = this.growMembers(v).filter((a) => a.bot.entity);
    const r: VoteRun = { id, topic: 'style', k, options, started: now, mode, done: false, ballots: [], voters: voters.map((a) => a.name), ac: new AbortController() };
    this.voting.set(v.name, r);
    console.log(`[vote] ${v.name}: style vote ${id} for neighbourhood ${k} (${mode}, ${voters.length} voters): ${options.map((o) => `${o.name}${o.current ? ' (current)' : ''}`).join(', ')}`);
    const predicted = (name: string) => predictedChoice(temperament(name), options, `${id}|${name}`);
    if (mode === 'predicted') {
      r.ballots = voters.map((a) => predictedBallot(id, a.name, options, predicted(a.name)));
      return this.closeVote(v, r, now);
    }
    const reqs: BallotRequest[] = [];
    for (const a of voters) {
      const spec = parseSpec(typeof a.memory.chooseModel === 'string' ? a.memory.chooseModel : typeof a.memory.execModel === 'string' ? a.memory.execModel : CHOOSE.model);
      if (spec) reqs.push({ voteId: id, agent: a.name, spec, level: REASONING.ballot, options, predicted: predicted(a.name), ctx: this.voterContext(v, a), signal: r.ac.signal });
    }
    castAll(id, reqs, BALLOTS_PARALLEL, now + VOTE_MAX_MS, r.ballots).then(() => (r.done = true), (e) => {
      console.log(`[vote] ${v.name}: ballots failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      r.done = true;
    });
    return undefined;
  }

  /** The tally (spec 3): the record written, the style kept for the next neighbourhood; returns the winner. */
  private closeVote(v: Village, r: VoteRun, now: number): string {
    this.voting.delete(v.name);
    r.ac.abort();
    const ballots = [...r.ballots];
    for (const name of r.voters) if (!ballots.some((b) => b.agent === name)) ballots.push({ agent: name, choice: null, reason: '', why: 'late', predicted: null, shown: [], source: 'model' });
    const t = tally(r.id, r.options, ballots);
    // (a work vote with no ballot cast starts nothing nobody chose: a rest, the review's 5)
    if (r.topic === 'work' && !ballots.some((b) => b.choice)) t.winner = PROJECT_NONE;
    const rec: VoteRecord = {
      id: r.id, topic: r.topic, k: r.k, at: r.started, mode: r.mode, options: r.options.map((o) => ({ id: o.id, name: o.name, facts: o.facts })),
      ballots, tally: t.tally, winner: t.winner, ...(t.tie ? { tie: t.tie } : {}), closedAt: now,
    };
    v.votes = [...(v.votes ?? []), rec].slice(-20);
    // (X.2: a public work's vote decides the next work, '' for "no new work"; the style vote the next neighbourhood's style;
    // G8's rung vote the ladder's next rung, set by rungTick)
    if (r.topic !== 'rung') {
      const g = (v.growth ??= { past: [] });
      if (r.topic === 'work') g.work = { piece: t.winner === PROJECT_NONE ? '' : t.winner, vote: r.id, at: now };
      else g.next = { style: t.winner, vote: r.id };
    }
    const what = r.topic === 'work' ? `public work ${r.k}` : r.topic === 'rung' ? 'the next ambition' : `neighbourhood ${r.k}`;
    const name = (id: string) => r.options.find((o) => o.id === id)?.name ?? id;
    for (const b of ballots) console.log(`[ballot] ${v.name}: ${b.agent} -> ${b.choice ? name(b.choice) : `none (${b.why ?? '?'})`} (predicted ${b.predicted ? name(b.predicted) : '-'}${b.position ? `, shown ${b.position} of ${b.shown.length}` : ''}): ${b.reason.replace(/\s+/g, ' ').slice(0, 160)}`);
    const cast = ballots.filter((b) => b.choice), agree = cast.filter((b) => b.choice === b.predicted).length;
    const counts = r.options.map((o) => `${o.name} ${t.tally[o.id]}`).join(', ');
    console.log(`[vote] ${v.name}: ${name(t.winner)} wins for ${what} (${counts})${t.tie ? `, a tie drawn among ${t.tie.map(name).join(', ')}` : ''}; ${cast.length} of ${ballots.length} ballots cast, ${agree} as their temperament predicts; ${Math.round((now - r.started) / 1000)} s`);
    this.villages.note(v, `the village voted ${name(t.winner)} for ${what} (${counts})`);
    this.villages.save();
    return t.winner;
  }

  private growTick(v: Village) {
    if (!GROW.on && !PROJECTS_ON && !v.growth?.active) return;
    const now = Date.now();
    if (!v.complete) {
      this.growWatched.add(v.name);
      this.growSeen.delete(v.name);
      return;
    }
    if (!this.growSeen.has(v.name)) this.growSeen.set(v.name, now);
    if (now - this.growSeen.get(v.name)! < GROW_WAIT_MS) return;
    // (a check that threw rests the growth, the neighbourhood's end included: a record it cannot read is not read again
    // every 30 s)
    if ((this.growError.get(v.name) ?? 0) > now) return;
    // A vote ended or overdue is closed here, whatever its topic: a member joining or leaving mid-vote moves growTick to
    // the other topic's path, which never closed it (the X.2 review's H1)
    const run = this.voting.get(v.name);
    // (not G8's rung vote: rungTick closes it and takes up its winner; closed here, staged I6 voted again every few seconds)
    if (run && run.topic !== 'rung' && (run.done || now - run.started >= VOTE_MAX_MS + 35000)) this.closeVote(v, run, now);
    // (s40, MC_NEED_WORKS: a field work beside growth and the vote, its own gate; the storage's tidy-up)
    if (NEED_WORKS) this.fieldTick(v, now);
    if (NEED_WORKS) this.tidyTick(v, now);
    if (STORAGE_GROW) this.storeTick(v, now);
    if (BARTER.on && v.complete) this.barterTick(v, now);
    if (v.growth?.active) return this.growEnd(v, now);
    if (HOUSING) this.homeRequestAge(v, now);
    if (!GROW.on || !this.growDue(v, now, true)) {
      if (GROW.on) {
        const M = this.growMembers(v).length, H = housesOf(v);
        const sig = H >= M ? `${H}|${M}` : !this.growClaimers(v).length ? `none|${H}|${M}` : '';
        if (sig && !v.growth?.stop && this.growEnough.get(v.name) !== sig) {
          this.growEnough.set(v.name, sig);
          console.log(H >= M ? `[grow] ${v.name}: enough houses (${H} for ${M} members)` : `[grow] ${v.name}: no worker here takes board tasks (houses ${H} for ${M} members)`);
        }
      }
      // X.2: a public work when growth has nothing to do
      if (PROJECTS_ON) this.projectTick(v, now);
      return;
    }
    this.growEnough.delete(v.name);
    // The next neighbourhood's style (spec_vote1): a vote under way holds the growth
    const style = this.styleFor(v, now);
    if (style === undefined) return;
    const members = this.growMembers(v);
    // (never a hungry member: it takes food work only, s30's D12)
    const fed = (a: BotAgent) => this.hungerOf(v, a) !== 'hungry';
    // (N.2: the member who asked for the street lays it out while it is idle, s37)
    const asker = HOUSING ? members.find((a) => a.name === v.growth?.request?.by && this.isIdleMember(v, a, now) && fed(a)) : undefined;
    const agent = asker ?? members.find((a) => a.memory.villageRole === 'mayor' && this.isIdleMember(v, a, now) && fed(a)) ?? this.idleMembers(v, now).find(fed);
    if (!agent) return;
    this.layOutNext(v, agent, style, now);
  }

  /** growTick's tail (s37: also a street of houses a member starts, H3): the next neighbourhood's houses and pad, and the
   *  lay_out_houses chore for `agent`; `meta`/`opt` when a member chose it from its menu. */
  private layOutNext(v: Village, agent: BotAgent, style: string | null, now: number, meta?: ChoiceMeta, opt?: ChoiceOption) {
    void now;
    const members = this.growMembers(v);
    const n = Math.min(GROW.batch, HOUSING ? this.homeless(v).length : members.length - housesOf(v));
    if (n < 1) return;
    const holds = opt?.holds ?? [];
    const lib = this.vanillaLibrary(v.vanillaBiome ?? 'plains')?.houses ?? null;
    // (a style voted in: its houses only, the current one too: as before, a won "current" savanna drew the village's own
    // plains library, Vm; no vote: the picks as before)
    const only = style ? this.styleHouses(style).map((h) => h.design) : undefined;
    // (R3, MC_GEN_HOMES: the owners-to-be as homeTick will give the houses, the asker first, and the family: the voted
    // style's biome, else the village's current style)
    const owners = GEN_HOMES && HOUSING ? this.homeless(v).map((a) => a.name) : [];
    const asker = v.growth?.request?.by;
    if (asker && owners.includes(asker)) owners.splice(owners.indexOf(asker), 1), owners.unshift(asker);
    const own = owners.length ? { owners, family: familyKey(style ? parseStyle(style).biome : this.currentStyle(v) ?? v.vanillaBiome ?? 'plains') } : undefined;
    const pick = pickHouses(v, n, lib, (d) => this.materialTasks(d, d.name).units ?? 0, only, WOOD_VARIANTS ? (style ? parseStyle(style).wood : undefined) ?? this.nextHoodWood(v, n) : undefined, own);
    const styled = style ? { style } : {};
    // With neighbourhood farms (s30's D2): the pad ladder, fields where the biome allows one (the village's library biome,
    // else the biome the agent's view has at home: a staged village has no library biome, lens 2 L5), and not once a
    // neighbourhood's field was refused for the biome (that holds for the village: a field-sized pad for no field took the
    // room of the squares growth needs, lens 2 L4; thin grass does not hold: harvests fill the seed stock it is judged by,
    // the food fix review's second Medium)
    const home = GROW_FARMS ? villageHome(v) : null;
    const biome = (v.vanillaBiome ?? (home ? biomeAt(agent, home.x, v.plots[0]?.y ?? agent.bot.entity?.position.y ?? 64, home.z) : '')).toLowerCase();
    const barren = (v.layouts ?? []).some((l) => l.grow && /biome/.test(l.farmWhy ?? ''));
    if (GROW_FARMS && pick.length && !NO_FIELD_BIOME.test(biome) && !barren) {
      const ladder = padLadder(pick.map((h) => v.designs[h]));
      if (!ladder.length) return this.growStop(v, 'no house design');
      const options = ladder.map((o) => `${o.size}:${o.n}:${o.slots}`).join(',');
      let st: ActionStatus;
      try {
        st = agent.enqueue('lay_out_houses', { chore: true, houses: pick.join(','), options, ...styled });
      } catch (e) {
        console.log(`[grow] ${v.name}: lay_out_houses not queued for ${agent.name}: ${(e as Error).message}`);
        return;
      }
      this.setChore(v, agent, 'grow', [st], `lay out ${ladder[0].n} house${ladder[0].n > 1 ? 's' : ''}`, (why) => this.growFailed(v, agent.name, why), meta, holds, opt);
      console.log(`[grow] ${v.name}: ${agent.name} lays out up to ${ladder[0].n} houses (${pick.join(', ')}) on the first of ${ladder.map((o) => `${o.size}x${o.size}/${o.n}/${o.slots < 0 ? 'no field' : `field+${o.slots}`}`).join(', ')}; houses ${housesOf(v)} for ${members.length} members`);
      return;
    }
    const pad = pick.length ? padFor(pick.map((h) => v.designs[h])) : null;
    if (!pad) return this.growStop(v, 'no house design');
    const houses = pick.slice(0, pad.n);
    let st: ActionStatus;
    try {
      st = agent.enqueue('lay_out_houses', { chore: true, houses: houses.join(','), size: pad.size, ...styled });
    } catch (e) {
      console.log(`[grow] ${v.name}: lay_out_houses not queued for ${agent.name}: ${(e as Error).message}`);
      return;
    }
    this.setChore(v, agent, 'grow', [st], `lay out ${houses.length} house${houses.length > 1 ? 's' : ''}`, (why) => this.growFailed(v, agent.name, why), meta, holds, opt);
    console.log(`[grow] ${v.name}: ${agent.name} lays out ${houses.length} houses (${houses.join(', ')}) on ${pad.size}x${pad.size}; houses ${housesOf(v)} for ${members.length} members`);
  }

  // ---- N.2: owned houses (MC_HOUSING; spec runs/2026-10-18/s37/spec_batch_n2.md H) ---------------------------------------

  /** When each owned Build task was first asked about as claimable (H7's hold), by "village|task id"; in memory. */
  private homeReady = new Map<string, number>();

  /** The village's members in the order houses are given out (H2): the Mayor, workers by number (agentNames.ts), other
   *  names alphabetical after. */
  private homeOrder(v: Village): BotAgent[] {
    const key = (a: BotAgent): [number, number, string] => {
      const n = a.name.toLowerCase(), w = workerNumber(n);
      return n === 'mayor' ? [0, 0, n] : w ? [1, w, n] : [2, 0, n];
    };
    return this.growMembers(v).sort((p, q) => {
      const x = key(p), y = key(q);
      return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
    });
  }

  /** A member's home (H1): the dwelling it owns, else the Build task of its house (not failed: being built, or built and
   *  not yet marked on its structure). */
  private homeOf(v: Village, name: string): Structure | Task | undefined {
    return v.structures.find((s) => s.owner === name && isDwelling(s.kind))
      ?? v.tasks.find((t) => t.owner === name && /^Build /.test(t.title) && t.status !== 'failed');
  }

  /**
   * #69 (MC_OWN): a member's own wants as code measures them: meals' worth of food in its own chest and its appetite, its
   * own house's open furniture and unlit spots, the tools it lacks (hands and own chest), its own initiative's missing
   * materials. Null for a member with no house (no own stock yet).
   */
  wantsOf(v: Village, name: string): Wants | null {
    const home = this.homeOf(v, name);
    if (!home || !('owner' in home) || !('x1' in home)) return null;
    const own = v.homes?.[name];
    const items = own?.chest?.items ?? {};
    const lvl = appetiteOn(v) ? v.food.members[name]?.level : undefined;
    const st = home as Structure;
    const decor = this.decorParts(v).find((P) => P.structure?.id === st.id);
    const light = this.lightParts(v).find((P) => P.kind === 'building' && P.structure?.id === st.id);
    const b = this.agents.get(name.toLowerCase());
    const has = { ...items, ...(b ? heldCounts(b) ?? {} : {}) };
    const tools = [['a pickaxe', /^(stone|iron|diamond)_pickaxe$/], ['an axe', /_axe$/], ['a fishing rod', /^fishing_rod$/]] as const;
    const it = (v.initiatives ?? []).find((i) => i.by === name && i.state === 'open');
    let project: Wants['project'];
    if (it && v.designs[it.design]) {
      const missing = Object.fromEntries(Object.entries(this.materials.plan(inWood(designBill(v.designs[it.design]), this.workWood(v, it.design)), it.gathered ?? {}).gather).filter(([, q]) => q > 0));
      project = { kind: it.kind.replace(/_/g, ' '), missing };
    }
    return {
      food: { meals: Math.floor(foodPoints(items) / 8), hungry: lvl !== undefined && lvl <= APPETITE.eatAt },
      house: { furnish: decor?.open.length ?? 0, light: light?.unlit ?? 0 },
      tools: tools.filter(([, re]) => !Object.entries(has).some(([n, q]) => q > 0 && re.test(n))).map(([w]) => w),
      ...(project ? { project } : {}),
    };
  }

  /** The members without a home (H1), in homeOrder. */
  private homeless(v: Village): BotAgent[] {
    return this.homeOrder(v).filter((a) => !this.homeOf(v, a.name));
  }

  /** A Build task's centre (its build_design x= z=). */
  private static taskXZ(t: Task): { x: number; z: number } | null {
    const m = /\bx=(-?\d+) z=(-?\d+)/.exec(t.detail);
    return m ? { x: Number(m[1]), z: Number(m[2]) } : null;
  }

  /** A house's name sign says whose it is (H2, H5): its text before it goes up, rewritten by RCON once up (text is free,
   *  as put_up_signs' own rewrite). */
  private houseSign(v: Village, building: string, at: (s: { cx: number; cz: number }) => boolean, name: string) {
    for (const l of v.layouts ?? []) for (const s of l.signs ?? []) {
      if (s.building !== building || !at(s)) continue;
      // (the neighbourhood's name on the third line kept, #10)
      const text = [`${name}'s`, 'house', ...s.text.slice(2)];
      if (s.text.join('|') === text.join('|')) return;
      s.text = text;
      this.villages.save();
      if (s.up && s.y !== undefined) {
        const nbt = `{front_text:{messages:[${[0, 1, 2, 3].map((i) => JSON.stringify(text[i] ?? '')).join(',')}]}}`;
        this.rcon.command(`data merge block ${s.x} ${s.y} ${s.z} ${nbt}`).catch((e: Error) => console.log(`[home] ${v.name}: ${name}'s sign at ${s.x},${s.y},${s.z} not rewritten: ${e.message}`));
      }
      return;
    }
  }

  /** A request for a street that has waited 15 minutes with no layout posted is dropped (H4). */
  private homeRequestAge(v: Village, now: number) {
    const r = v.growth?.request;
    if (!r || now - r.at < HOME_REQUEST_MS || this.growQueued(v, now)) return;
    delete v.growth!.request;
    this.villages.save();
    console.log(`[home] ${v.name}: ${r.by === 'vote' ? 'the vote\'s' : `${r.by}'s`} street of houses dropped: no layout in ${Math.round(HOME_REQUEST_MS / 60000)} min${v.growth?.stop ? ` (growth stopped: ${v.growth.stop})` : (v.growth?.backoff ?? 0) > now ? ' (growth backing off)' : ''}`);
  }

  /** A member's street of houses (H3): laid out now by `agent` when growth can (true), else left to growTick (a style
   *  vote under way, a back-off). */
  private homeLayout(v: Village, agent: BotAgent, now: number, meta?: ChoiceMeta, opt?: ChoiceOption): boolean {
    if (!this.growDue(v, now, false)) return false;
    const style = this.styleFor(v, now);
    if (style === undefined) return false;
    this.layOutNext(v, agent, style, now, meta, opt);
    return this.growQueued(v, now);
  }

  /**
   * Every farm tick with MC_HOUSING (H2, H5, H6): a houseless member moves into an unowned standing house; a new
   * neighbourhood's Build tasks get their owners (the asker first) and their signs the owners' names; a built house is
   * marked on its structure; a Build task that failed for good frees its owner.
   */
  private homeTick(v: Village) {
    if (!v.complete) return;
    let changed = false;
    // Built or failed: the owner's house marked on its structure, or the owner freed
    for (const t of v.tasks) {
      if (!t.owner || !/^Build /.test(t.title)) continue;
      if (t.status === 'failed' && !t.soft) {
        console.log(`[home] ${v.name}: ${t.owner}'s house (${t.id}) failed: ${t.owner} has no house again`);
        this.villages.note(v, `${t.owner}'s house (${t.id}) could not be built`);
        delete t.owner;
        changed = true;
        continue;
      }
      if (t.status !== 'done') continue;
      const c = MineflayerWorld.taskXZ(t);
      const st = c && v.structures.find((s) => isDwelling(s.kind) && c.x >= s.x1 && c.x <= s.x2 && c.z >= s.z1 && c.z <= s.z2);
      if (st && st.owner === t.owner) continue;
      if (!st || st.owner) {
        // (no house of its own at its spot: the owner is not housed by it, the safety review's L5)
        console.log(`[home] ${v.name}: ${t.owner}'s house (${t.id}) is done but ${st ? `${st.owner} owns the house there` : 'no house stands at its spot'}: ${t.owner} has no house again`);
        delete t.owner;
        changed = true;
        continue;
      }
      st.owner = t.owner;
      changed = true;
      console.log(`[home] ${v.name}: ${t.owner}'s house stands (${st.kind} ${st.id} at ${Math.round((st.x1 + st.x2) / 2)},${Math.round((st.z1 + st.z2) / 2)})`);
      this.villages.note(v, `${t.owner}'s house stands at ${Math.round((st.x1 + st.x2) / 2)},${Math.round((st.z1 + st.z2) / 2)}`);
    }
    // A new neighbourhood's houses: owners in board order, the asker first, then the houseless in homeOrder
    const g = v.growth;
    const act = g?.active;
    if (act && !act.project) {
      const builds = act.builds.map((id) => v.tasks.find((t) => t.id === id)).filter((t): t is Task => !!t && t.status !== 'failed');
      if (builds.length && builds.every((t) => !t.owner) && !act.owned) {
        const queue = this.homeless(v).map((a) => a.name);
        const asker = g!.request?.by;
        if (asker && queue.includes(asker)) queue.splice(queue.indexOf(asker), 1), queue.unshift(asker);
        const given: string[] = [];
        // (R3: a member's own house goes to that member while it has none; the others in queue order)
        const bound = new Map<string, string>();
        if (GEN_HOMES)
          for (const t of builds) {
            const m = homeOwner(v.designs[/build_design "([^"]+)"/.exec(t.detail)?.[1] ?? '']);
            if (m && queue.includes(m)) bound.set(t.id, m), queue.splice(queue.indexOf(m), 1);
          }
        for (const t of builds) {
          const who = bound.get(t.id) ?? queue.shift();
          if (!who) break;
          t.owner = who;
          given.push(`${who} (${t.id})`);
          const c = MineflayerWorld.taskXZ(t);
          const design = /build_design "([^"]+)"/.exec(t.detail)?.[1];
          if (c && design) this.houseSign(v, design, (s) => s.cx === c.x && s.cz === c.z, who);
        }
        act.owned = true;
        if (g!.request) delete g!.request;
        changed = true;
        console.log(`[home] ${v.name}: neighbourhood ${act.k}'s houses for ${given.join(', ') || 'nobody (no member without a house)'}`);
        if (given.length) this.villages.note(v, `neighbourhood ${act.k}'s houses are for ${given.map((x) => x.replace(/ \(.*/, '')).join(', ')}`);
      }
    }
    // Standing houses nobody owns, to the houseless (nearest the village's home first)
    const free = v.structures.filter((s) => isDwelling(s.kind) && !s.owner && !(act && !act.project && act.plot && s.x1 >= act.plot.x1 && s.x2 <= act.plot.x2 && s.z1 >= act.plot.z1 && s.z2 <= act.plot.z2));
    if (free.length) {
      const home = villageHome(v);
      const d = (s: Structure) => (home ? Math.hypot((s.x1 + s.x2) / 2 - home.x, (s.z1 + s.z2) / 2 - home.z) : 0);
      free.sort((p, q) => d(p) - d(q));
      for (const a of this.homeless(v)) {
        const st = free.shift();
        if (!st) break;
        st.owner = a.name;
        changed = true;
        const cx = Math.round((st.x1 + st.x2) / 2), cz = Math.round((st.z1 + st.z2) / 2);
        this.houseSign(v, st.kind, (s) => s.cx >= st.x1 && s.cx <= st.x2 && s.cz >= st.z1 && s.cz <= st.z2, a.name);
        console.log(`[home] ${v.name}: ${a.name} moves into ${st.kind} (${st.id}) at ${cx},${cz}`);
        this.villages.note(v, `${a.name} moves into the house at ${cx},${cz}`);
      }
    }
    if (changed) this.villages.save();
  }

  /** When each owned house's furnish or light option was first held back for its owner, by "village|option id". */
  private ownDecorSeen = new Map<string, number>();

  /** H8 (after the spec check's M2): another member's house is held for its owner while the owner is in the world, for
   *  OWN_DECOR_MS from the first time it was held; then anyone may help. */
  private ownDecorHeld(v: Village, id: string, owner: string, now: number): boolean {
    const o = this.agents.get(owner.toLowerCase());
    if (!o?.bot.entity || o.village() !== v) return false;
    const k = `${v.name}|${id}`;
    if (!this.ownDecorSeen.has(k)) this.ownDecorSeen.set(k, now);
    return now - this.ownDecorSeen.get(k)! < OWN_DECOR_MS;
  }

  /** The owner of a building part's structure when it is a dwelling (H8; read from the record: parts are cached). */
  private houseOwner(v: Village, st: Structure): string | undefined {
    const s = v.structures.find((x) => x.id === st.id) ?? st;
    return s.owner && isDwelling(s.kind) ? s.owner : undefined;
  }

  /**
   * H7: a Build task owned by another member is left to its owner for OWNER_FIRST_MS from when it was first asked about
   * as claimable, while the owner is in the world, takes board tasks and is not hungry (others may help after that).
   */
  private ownerFirst(v: Village, agent: WorldAgent, task: Task): boolean {
    if (!task.owner || task.owner === agent.name || !/^Build /.test(task.title)) return false;
    const o = this.agents.get(task.owner.toLowerCase());
    if (!o?.bot.entity || o.village() !== v || o.memory.villageRole === 'mayor' || !o.brain?.claimsTasks?.(o) || this.hungerOf(v, o) === 'hungry') return false;
    // (only while the owner is free to take it: an owner on a long chore held its house for nothing, the spec check's M3)
    if (!this.isIdleMember(v, o, Date.now())) return false;
    const k = `${v.name}|${task.id}`, now = Date.now();
    if (!this.homeReady.has(k)) this.homeReady.set(k, now);
    return now - this.homeReady.get(k)! < OWNER_FIRST_MS;
  }

  // ---- X.2: public works, voted (spec runs/2026-10-16/s34/spec_x2.md) --------------------------------------------------

  /** The pool, once a process: every biome's non-dwelling vanilla pieces that pass the survival test (the vanilla
   *  library's: placeable, no problems, a landmark's units and smelts) and fit a pad; null when the jar cannot be read. */
  private works: Array<{ biome: string; design: Design; units: number; volume: number; gather: Counts; size: number }> | null | undefined;

  publicWorks(): NonNullable<MineflayerWorld['works']> {
    if (this.works !== undefined) return this.works ?? [];
    const out: NonNullable<MineflayerWorld['works']> = [];
    try {
      const jar = vanillaJar();
      for (const biome of VILLAGE_BIOMES)
        for (const path of listPieces(jar, biome, 'houses')) {
          const name = path.split('/').pop()!;
          if (isDwelling(name)) continue;
          let d: Design;
          try {
            d = pieceToDesign(readPiece(path, jar), biome).design;
          } catch {
            continue;
          }
          if (!validateDesign({ ...d } as unknown as Record<string, unknown>, 'vanilla', { isPlaceable: (b) => this.isPlaceable(b), states: true, requireDoor: true }).design) continue;
          const m = this.materialTasks(d, d.name);
          if (m.problems.length || (m.units ?? 0) > LANDMARK_UNITS || (m.smelts ?? 0) > MAX_SMELTS) continue;
          const pad = padFor([d]);
          if (!pad) continue;
          const gather: Counts = {};
          for (const [n, q] of Object.entries(this.materials.plan(designBill(d)).gather)) gather[n] = q;
          out.push({ biome, design: d, units: m.units ?? 0, volume: d.width * d.depth * d.height, gather, size: pad.size });
        }
      this.works = out;
      console.log(`[work] ${out.length} public works in the pool (${VILLAGE_BIOMES.map((b) => `${b} ${out.filter((w) => w.biome === b).length}`).join(', ')})`);
    } catch (e) {
      console.warn(`[work] cannot read the public works: ${(e as Error).message}`);
      this.works = null;
    }
    return this.works ?? [];
  }

  /**
   * A public work vote's options (spec_x2 3): pieces not built here nor refused before, the village's biome first then
   * by cost, one of a kind (a library, a toolsmith...), their uncommon materials near home (as styleOptions), at most 3;
   * then the status quo, "no new public work for now", unless it won the last work vote: it may win once in a row (three
   * works split the builders' votes, and the easy-going's "none" won every predicted vote, 13 of 25).
   */
  private projectOptions(v: Village): VoteOption[] {
    const g = v.growth ?? { past: [] };
    const built = new Set([...v.structures.map((s) => s.kind), ...(v.layouts ?? []).flatMap((l) => l.buildings)]);
    const bad = new Set(g.projectBad ?? []);
    const own = v.vanillaBiome ? villageBiome(v.vanillaBiome) : this.currentStyle(v) ?? 'plains';
    const kindOf = workKind;
    const home = villageHome(v);
    const y = v.plots[0]?.y ?? 64;
    const near = home ? this.growMembers(v).find((a) => a.bot.entity && Math.hypot(a.bot.entity.position.x - home.x, a.bot.entity.position.z - home.z) <= 32) : undefined;
    const cands = this.publicWorks().filter((w) => !built.has(w.design.name) && !bad.has(w.design.name))
      .sort((p, q) => Number(q.biome === own) - Number(p.biome === own) || p.units - q.units || p.design.name.localeCompare(q.design.name));
    // (MC_WORKS_REPEAT, #75: once fewer than three unbuilt pieces qualify, built ones again, the fewest copies first; the
    // pool ran out at ~112 minutes in the sim at range 192)
    if (WORKS_REPEAT) {
      const copies = (n: string) => v.structures.filter((st) => st.kind === n).length;
      cands.push(...this.publicWorks().filter((w) => built.has(w.design.name) && !bad.has(w.design.name))
        .sort((p, q) => copies(p.design.name) - copies(q.design.name) || Number(q.biome === own) - Number(p.biome === own) || p.units - q.units || p.design.name.localeCompare(q.design.name)));
    }
    const out: VoteOption[] = [];
    const kinds = new Set<string>();
    for (const w of cands) {
      if (out.length >= 3) break;
      const kind = kindOf(w.design.name);
      if (kinds.has(kind)) continue;
      const want: Counts = {};
      for (const [k, q] of Object.entries(w.gather)) if (!/(_log|^any:logs|^logs|cobblestone|^sand|^dirt)$/.test(k)) want[k] = q;
      if (Object.keys(want).length) {
        const found = near && home ? this.materialsNear(near.name, want, home.x, y, home.z, WORK_MATERIAL_RANGE) : null;
        if (!found || Object.entries(want).some(([k, q]) => (found[k] ?? 0) < Math.ceil(q))) continue;
      }
      // (with the quarter it leads: its companions' uncommon materials checked the same way, X.2 part 2a)
      const q = this.quarterOf(v, w.design.name);
      if (!q) continue;
      const others: Counts = {};
      for (const c of q.pieces.slice(1)) for (const [k, n] of Object.entries(c.gather)) if (!/(_log|^any:logs|^logs|cobblestone|^sand|^dirt)$/.test(k)) others[k] = (others[k] ?? 0) + n;
      if (Object.keys(others).length) {
        const found = near && home ? this.materialsNear(near.name, others, home.x, y, home.z, WORK_MATERIAL_RANGE) : null;
        if (!found || Object.entries(others).some(([k, n]) => (found[k] ?? 0) < Math.ceil(n))) continue;
      }
      kinds.add(kind);
      const words = kind.replace(/_/g, ' ');
      const rest = q.pieces.slice(1).map((c) => workKind(c.design.name).replace(/_/g, ' '));
      const gather: Counts = {};
      for (const c of q.pieces) for (const [k, n] of Object.entries(c.gather)) gather[k] = (gather[k] ?? 0) + n;
      const main = Object.entries(gather).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `~${Math.round(n)} ${k.replace(/^any:/, '').replace(/_/g, ' ')}`).join(', ');
      out.push({
        id: w.design.name, name: rest.length ? `A ${words}'s quarter (${w.biome})` : `A ${words} (${w.biome})`,
        facts: `${rest.length ? `a ${words}${rest.length > 1 ? `, a ${rest.slice(0, -1).join(', a ')} and a ${rest[rest.length - 1]}` : ` and a ${rest[0]}`}` : `a ${w.design.width}x${w.design.depth} ${words}`} in the ${w.biome} look on one street; ~${q.units} units to gather (${main}); then furnished and lit`.slice(0, 200),
        current: false, novel: true, units: q.units, volume: q.pieces.reduce((s, c) => s + c.volume, 0),
      });
    }
    // (#75, MC_WORKS_GROW: refits fill the slots new works leave, the cheapest first, one a layout and refused ones never
    // again: a layout's standing buildings raised a tier on their own cells, no new land)
    // (MC_REFIT_FIRST=on, for tests: refits ahead of new works, so a staged run reaches one at once)
    if (WORKS_GROW && (out.length < 3 || REFIT_FIRST)) {
      const first: VoteOption[] = [];
      const refits = refitOptions(v).filter((o) => !bad.has(refitProject(o))).map((o) => {
        let units = 0, blocks = 0;
        for (const p of o.places) {
          const d = refitDesign(p.design, o.tier)!;
          units += this.refitUnits(d);
          blocks += d.blocks;
        }
        return { o, units, blocks };
      }).sort((p, q) => p.units - q.units || p.o.layout - q.o.layout);
      for (const r of refits) {
        if ((REFIT_FIRST ? first : out).length >= 3) break;
        const lay = v.layouts![r.o.layout - 1];
        const kinds = [...new Set(r.o.places.map((p) => (isDwelling(p.design.name) ? 'houses' : kindOf(p.design.name).replace(/_/g, ' '))))];
        const what = lay.name ? `${lay.name}'s ${kinds.length > 1 ? 'buildings' : kinds[0]}` : `the ${kinds.slice(0, 3).join(', ')}${kinds.length > 3 ? ' and more' : ''}`;
        const n = r.o.places.length;
        (REFIT_FIRST ? first : out).push({
          id: refitProject(r.o), name: `Refit ${what} ${TIER_WORDS[r.o.tier].short} (tier ${r.o.tier})`,
          facts: `${n} standing building${n > 1 ? 's' : ''} of layout ${r.o.layout}: ${TIER_WORDS[r.o.tier].facts}; ~${Math.round(r.units)} units to gather (${r.blocks} blocks changed); on their own ground, no new land`.slice(0, 200),
          current: false, novel: false, units: Math.round(r.units), volume: r.blocks,
        });
      }
      if (first.length) out.splice(0, out.length, ...[...first, ...out].slice(0, 3));
    }
    // (N.2: a street of houses for the members without one, H9)
    if (HOUSING) {
      const without = this.homeless(v).length, M = this.growMembers(v).length;
      // (only when growth could lay it out, and costed as houses: units 0 won every predicted ballot, the review's M2)
      const n = Math.min(GROW.batch, without);
      if (without >= 2 && GROW.on && !g.stop && this.growClaimers(v).length) out.push({ id: PROJECT_HOUSES, name: 'A street of houses for members without one', facts: `${without} of ${M} members have no house; up to ${GROW.batch} houses near the village, each with its owner's name on its sign`, current: false, novel: false, units: Math.round(n * HOUSE_UNITS * 0.6), volume: n * 300 });
    }
    // (s39's farmstead is no option here since s40: it is laid out beside the vote, projectTick, so it wins no vote a
    // public work would have)
    const rested = !!g.work && !g.work.piece;
    if (out.length && !rested) out.push({ id: PROJECT_NONE, name: 'No new public work for now', facts: 'members stay free for farms, pens and the workshop; the question comes back in a few minutes', current: true, novel: false, units: 0, volume: 0 });
    return out;
  }

  /** What a refit design costs to gather (materialTasks' units), once a design: votes ask every few minutes. */
  private refitUnitsOf = new Map<string, number>();
  private refitUnits(d: Design): number {
    let u = this.refitUnitsOf.get(d.name);
    if (u === undefined) this.refitUnitsOf.set(d.name, (u = this.materialTasks(d, d.name).units ?? 0));
    return u;
  }

  /**
   * A refit voted for (#75, MC_WORKS_GROW): its tasks posted (layout.ts postRefit) and watched to its end as a public
   * work (growth.active with the refit's project id: growEnd closes it, counts a failure and backs off). One no longer
   * due (built meanwhile) is dropped; one that cannot be had here is never offered again.
   */
  private startRefit(v: Village, piece: string, now: number) {
    const g = (v.growth ??= { past: [] });
    const rf = parseRefitProject(piece)!;
    delete g.work;
    const o = refitOptions(v).find((x) => x.layout === rf.layout && x.tier === rf.tier);
    if (!o) {
      this.villages.save();
      console.log(`[work] ${v.name}: the refit ${piece} is no longer due`);
      return;
    }
    const out = postRefit(this, v, o);
    if (typeof out === 'string') {
      g.projectBad = [...new Set([...(g.projectBad ?? []), piece])];
      this.villages.save();
      console.log(`[work] ${v.name}: the refit ${piece}: ${out}`);
      return;
    }
    const lay = v.layouts![o.layout - 1];
    g.active = {
      k: g.past.length + 1, layout: o.layout, from: Math.min(...out.made.map(taskNum)), at: now, by: 'grow', plot: { x1: lay.x1, z1: lay.z1, x2: lay.x2, z2: lay.z2 },
      houses: [], builds: out.builds, members: this.growMembers(v).length, before: housesOf(v), changed: now, sig: '', project: piece,
    };
    this.villages.save();
    console.log(`[work] ${v.name}: the refit of layout ${o.layout} to tier ${o.tier} posted: ${out.builds.length} buildings, ${out.made.length} tasks (${Math.round(out.units)} units)`);
  }

  /**
   * A public work's quarter (X.2 part 2a): the voted piece and up to QUARTER - 1 companions of its biome, the cheapest
   * not built here nor refused, each of a kind no other piece of it has, at most one over a house's budget (postLayout's
   * village rule), on the smallest pad that places them (padFor drops the last until they fit). A lone piece built in
   * 1.5-3.5 min and the rests and gaps filled the rest of each cycle (F241). null when the lead is not in the pool.
   */
  quarterOf(v: Village, lead: string): { pieces: Array<NonNullable<MineflayerWorld['works']>[number]>; size: number; units: number } | null {
    const pool = this.publicWorks(), L = pool.find((w) => w.design.name === lead);
    if (!L) return null;
    const g = v.growth ?? { past: [] };
    const built = new Set([...v.structures.map((s) => s.kind), ...(v.layouts ?? []).flatMap((l) => l.buildings)]);
    const bad = new Set(g.projectBad ?? []);
    const pieces = [L];
    const kinds = new Set([workKind(L.design.name)]);
    let big = L.units > HOUSE_UNITS ? 1 : 0;
    for (const w of pool.filter((x) => x.biome === L.biome && x.design.name !== lead && !built.has(x.design.name) && !bad.has(x.design.name)).sort((p, q) => p.units - q.units || p.design.name.localeCompare(q.design.name))) {
      if (pieces.length >= QUARTER) break;
      if (kinds.has(workKind(w.design.name)) || (w.units > HOUSE_UNITS && big)) continue;
      pieces.push(w);
      kinds.add(workKind(w.design.name));
      if (w.units > HOUSE_UNITS) big++;
    }
    // (no larger than the room a failed survey left: companions dropped until the pad fits, F243)
    const room = g.workRoom ?? Infinity;
    let pad = padFor(pieces.map((w) => w.design));
    while (pad && pad.size > room && pieces.length > 1) {
      pieces.pop();
      pad = padFor(pieces.map((w) => w.design));
    }
    if (!pad || pad.size > room) return null;
    const kept = pieces.slice(0, pad.n);
    return { pieces: kept, size: pad.size, units: kept.reduce((s, w) => s + w.units, 0) };
  }

  /** Whether a public work may start now (spec_x2 2): growth has nothing to do, nothing on the board or queued, a worker
   *  takes board tasks, a minute after the last layout ended, growth's back-off and failure rules. */
  private projectDue(v: Village, now: number): boolean {
    const g = v.growth;
    if (!PROJECTS_ON || !v.complete || g?.active || (g?.backoff ?? 0) > now || (g?.projectBackoff ?? 0) > now || (g?.projectFails ?? 0) >= 3 || (this.growError.get(v.name) ?? 0) > now) return false;
    // (growth's stop for want of room or after failures holds projects too; one for want of house designs does not)
    if (g?.stop && !/house design/.test(g.stop)) return false;
    if (this.growQueued(v, now)) return false;
    if (GROW.on && !HOUSING && !g?.stop && housesOf(v) < this.growMembers(v).length) return false;
    // (N.2: houses are voluntary now; a street asked for goes first, and while members without a house have started one in
    // the last HOME_FIRST_MS (from completion on) no work vote cuts in: the spec check's M4, H9)
    if (HOUSING && g?.request) return false;
    if (HOUSING && this.homeless(v).length) {
      const last = Math.max(g?.active?.at ?? 0, g?.past?.[g.past.length - 1]?.end ?? 0, this.growSeen.get(v.name) ?? 0);
      if (now - last < HOME_FIRST_MS) return false;
    }
    const last = g?.past?.[g.past.length - 1];
    if (last && now - last.end < 60000) return false;
    return this.growClaimers(v).length > 0;
  }

  /**
   * G8 (MC_LADDER): the ladder begun on iron once the village is complete; after a rung, at the next dawn (at once without
   * the clock), a ballot among the rungs whose earlier rungs are reached (vote.ts topic `rung`, 2-4 options with code's
   * previews; one option is taken without a vote); its winner becomes the current rung.
   */
  private rungTick(v: Village, now: number) {
    const st = ladderOf(v, now);
    if (!st || st.current) return;
    const run = this.voting.get(v.name);
    if (run) {
      if (run.topic !== 'rung') return;
      if (!run.done && now - run.started < VOTE_MAX_MS + 35000) return;
      // (no ballot cast, a scripted run's voters or every call failed: the temperament-predicted ballots, not the first option
      // by default as in staged I6)
      if (!run.ballots.some((b) => b.choice)) run.ballots = run.voters.map((n) => predictedBallot(run.id, n, run.options, predictedChoice(temperament(n), run.options, `${run.id}|${n}`)));
      const w = this.closeVote(v, run, now) as RungId;
      chooseRung(v, w, run.options.map((o) => o.id as RungId), now);
      this.ladderNote(v, `the village chose ${RUNG_DEFS[w]?.name ?? w} as its next ambition`);
      return;
    }
    if (!st.reached.length) return;
    const ck = clockOf(v.name, now);
    if (ck && ck.phase !== 'dawn') return;
    const ids = rungOptions(v);
    if (!ids.length) return;
    const mode = this.voteMode(v);
    if (ids.length === 1 || mode === 'off') {
      chooseRung(v, ids[0], ids, now);
      this.ladderNote(v, `the village takes up ${RUNG_DEFS[ids[0]].name}${ids.length === 1 ? ', the one open to it' : ''}`);
      return;
    }
    openRungBallot(v, ids);
    const options: VoteOption[] = ids.map((id) => ({ id, name: RUNG_DEFS[id].name, facts: rungPreview(id, { skills: new Set(Object.keys(MC_SKILLS)), activitySkills: new Set(this.library.specs.map((s) => s.skill)) }), current: false, novel: true, units: 0, volume: 0 }));
    const k = (v.votes ?? []).filter((x) => x.topic === 'rung').length + 1;
    const id = `${v.name}-r${k}-${now.toString(36)}`;
    const voters = this.growMembers(v).filter((a) => a.bot.entity);
    const r: VoteRun = { id, topic: 'rung', k, options, started: now, mode, done: false, ballots: [], voters: voters.map((a) => a.name), ac: new AbortController() };
    this.voting.set(v.name, r);
    this.villages.save();
    console.log(`[vote] ${v.name}: rung vote ${id} (${mode}, ${voters.length} voters): ${options.map((o) => o.name).join(', ')}`);
    const predicted = (name: string) => predictedChoice(temperament(name), options, `${id}|${name}`);
    if (mode === 'predicted') {
      r.ballots = voters.map((a) => predictedBallot(id, a.name, options, predicted(a.name)));
      r.done = true;
      return;
    }
    const reqs: BallotRequest[] = [];
    for (const a of voters) {
      const spec = parseSpec(typeof a.memory.chooseModel === 'string' ? a.memory.chooseModel : typeof a.memory.execModel === 'string' ? a.memory.execModel : CHOOSE.model);
      if (spec) reqs.push({ voteId: id, agent: a.name, spec, level: REASONING.ballot, options, predicted: predicted(a.name), ctx: this.voterContext(v, a), signal: r.ac.signal, topic: 'rung' });
    }
    castAll(id, reqs, BALLOTS_PARALLEL, now + VOTE_MAX_MS, r.ballots).then(() => (r.done = true), (e) => {
      console.log(`[vote] ${v.name}: rung ballots failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      r.done = true;
    });
  }

  /** G8: a stage's or rung's news: the log, the village's notes, its chronicle (the day's facts) and the acts record. */
  private ladderNews(v: Village, news: LadderNews) {
    console.log(`[ladder] ${v.name}: ${news.text}`);
    this.villages.note(v, news.text.replace(/^The village /, 'the village ').replace(/\.$/, ''));
    const day = clockOf(v.name, Date.now())?.day;
    const vm = villageMemory(v.name);
    if (vm && day !== undefined) {
      const ch = ((vm.social.chronicle as ChronicleEntry[] | undefined) ?? []);
      const e = ch.find((x) => x.day === day) ?? (ch.push({ day, facts: [] }), ch[ch.length - 1]);
      e.facts.push(news.text);
      vm.social.chronicle = ch.slice(-30);
    }
    logAct({ type: 'ladder', village: v.name, kind: news.kind, rung: news.rung, stage: news.stage, text: news.text, workers: news.workers, t: Date.now() });
  }

  private ladderNote(v: Village, text: string) {
    console.log(`[ladder] ${v.name}: ${text}`);
    this.villages.note(v, text);
    this.villages.save();
  }

  /** The next public work (as styleFor): a piece, null (none now: "no new work" won lately, or nothing buildable), or
   *  undefined (a vote under way). With MC_VOTE off, code's first option. */
  private projectFor(v: Village, now: number): string | null | undefined {
    const g = (v.growth ??= { past: [] });
    if (g.work?.piece) return g.work.piece;
    const run = this.voting.get(v.name);
    if (run) {
      if (run.topic !== 'work') return undefined;
      if (!run.done && now - run.started < VOTE_MAX_MS + 35000) return undefined;
      const w = this.closeVote(v, run, now);
      return w === PROJECT_NONE ? null : w;
    }
    if (g.work && !g.work.piece && now - g.work.at < PROJECT_REST_MS) return null;
    // (nothing buildable found lately on the same buildings and refusals: not searched again for 5 minutes, the review's 4)
    const noneSig = `${v.structures.length}|${(v.layouts ?? []).length}|${g.projectBad?.length ?? 0}|${g.workRoom ?? ''}`, none = this.workNone.get(v.name);
    if (none && none.sig === noneSig && none.until > now) return null;
    const options = this.projectOptions(v);
    if (!options.some((o) => o.id !== PROJECT_NONE) || (options.length < 2 && options[0]?.id === PROJECT_NONE)) {
      if (this.workLogged.get(v.name) !== 'none') console.log(`[work] ${v.name}: no public work buildable here (pool ${this.publicWorks().length}, refused ${g.projectBad?.length ?? 0})`);
      this.workLogged.set(v.name, 'none');
      this.workNone.set(v.name, { sig: noneSig, until: now + 5 * 60000 });
      return null;
    }
    this.workLogged.delete(v.name);
    // (each work vote its own number: a rest and the vote after it were both "public work 1", the review's 6)
    const k = (v.votes ?? []).filter((x) => x.topic === 'work').length + 1;
    const mode = this.voteMode(v);
    if (mode === 'off') {
      g.work = { piece: options[0].id, vote: 'none', at: now };
      return options[0].id;
    }
    const id = `${v.name}-w${k}-${now.toString(36)}`;
    const voters = this.growMembers(v).filter((a) => a.bot.entity);
    const r: VoteRun = { id, topic: 'work', k, options, started: now, mode, done: false, ballots: [], voters: voters.map((a) => a.name), ac: new AbortController() };
    this.voting.set(v.name, r);
    console.log(`[vote] ${v.name}: public work vote ${id} (${mode}, ${voters.length} voters): ${options.map((o) => o.name).join(', ')}`);
    const predicted = (name: string) => predictedChoice(temperament(name), options, `${id}|${name}`);
    if (mode === 'predicted') {
      r.ballots = voters.map((a) => predictedBallot(id, a.name, options, predicted(a.name)));
      const w = this.closeVote(v, r, now);
      return w === PROJECT_NONE ? null : w;
    }
    const reqs: BallotRequest[] = [];
    for (const a of voters) {
      const spec = parseSpec(typeof a.memory.chooseModel === 'string' ? a.memory.chooseModel : typeof a.memory.execModel === 'string' ? a.memory.execModel : CHOOSE.model);
      if (spec) reqs.push({ voteId: id, agent: a.name, spec, level: REASONING.ballot, options, predicted: predicted(a.name), ctx: this.voterContext(v, a), signal: r.ac.signal, topic: 'work' });
    }
    castAll(id, reqs, BALLOTS_PARALLEL, now + VOTE_MAX_MS, r.ballots).then(() => (r.done = true), (e) => {
      console.log(`[vote] ${v.name}: ballots failed: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      r.done = true;
    });
    return undefined;
  }

  /** What public works last logged, by village (once a change); when "nothing buildable" was last found, and on what. */
  private workLogged = new Map<string, string>();
  private workNone = new Map<string, { sig: string; until: number }>();

  /**
   * A public work's layout chore failed (the review's 3): its piece is never offered again and projects alone back off
   * (5 min a failure in a row, stopping after 3): growth's own counters, "no site" answers and stop stay its own.
   */
  private projectFailed(v: Village, piece: string, why: string) {
    if (why === 'cancelled') return;
    const g = (v.growth ??= { past: [] });
    // No free square of that size: the land's fault, not the piece's; later works ask for smaller pads (F243)
    const noSite = /^lay_out_houses: no free (\d+)x\d+ site/.exec(why);
    if (noSite) {
      g.workRoom = Math.min(g.workRoom ?? Infinity, Number(noSite[1]) - 1);
      delete g.work;
      g.projectBackoff = Date.now() + 2 * 60000;
      this.villages.save();
      console.log(`[work] ${v.name}: no room for the public work ${piece} (${why.slice(0, 120)}); works now ask for pads up to ${g.workRoom}x${g.workRoom}`);
      return;
    }
    g.projectBad = [...new Set([...(g.projectBad ?? []), piece])];
    delete g.work;
    g.projectFails = (g.projectFails ?? 0) + 1;
    g.projectBackoff = Date.now() + 5 * 60000 * g.projectFails;
    this.villages.save();
    console.log(`[work] ${v.name}: the public work ${piece} could not be laid out (${why.slice(0, 160)}); not offered again; projects rest ${5 * g.projectFails} min`);
  }

  /** A public work from vote to layout (spec_x2 5): the piece's design into the village's, its pad, the layout chore. */
  private projectTick(v: Village, now: number) {
    if (!this.projectDue(v, now)) return;
    // (s40, MC_NEED_WORKS: a farmstead due is laid out beside the vote, before the next one opens; one voted or under way
    // goes first. In s39 it was a vote option and won votes the larger quarters would have, Won2's busy 17% vs 20%)
    // (s40: behind MC_NEED_FARMSTEAD since the field works, which fit where it cannot)
    if (FARMSTEAD_ON && !this.voting.get(v.name) && !v.growth?.work?.piece && this.farmsteadPlan(v)) return this.layOutFarmstead(v, now);
    const piece = this.projectFor(v, now);
    if (!piece) return;
    const g = (v.growth ??= { past: [] });
    if (piece === PROJECT_HOUSES) {
      g.request = { by: 'vote', at: now, ...(g.work?.vote ? { vote: g.work.vote } : {}) };
      delete g.work;
      this.villages.save();
      console.log(`[home] ${v.name}: the village voted for a street of houses (${this.homeless(v).length} members without one)`);
      return;
    }
    if (piece === PROJECT_FARMSTEAD) return this.layOutFarmstead(v, now);
    if (parseRefitProject(piece)) return this.startRefit(v, piece, now);
    const q = this.quarterOf(v, piece);
    const w = q?.pieces[0];
    if (!q || !w) {
      g.projectBad = [...new Set([...(g.projectBad ?? []), piece])];
      delete g.work;
      this.villages.save();
      return;
    }
    const fed = (a: BotAgent) => this.hungerOf(v, a) !== 'hungry';
    const agent = this.growMembers(v).find((a) => a.memory.villageRole === 'mayor' && this.isIdleMember(v, a, now) && fed(a)) ?? this.idleMembers(v, now).find(fed);
    if (!agent) return;
    for (const c of q.pieces) if (!v.designs[c.design.name]) v.designs[c.design.name] = structuredClone(c.design);
    const names = q.pieces.map((c) => c.design.name);
    let st: ActionStatus;
    try {
      st = agent.enqueue('lay_out_houses', { chore: true, houses: names.join(','), size: q.size, project: piece });
    } catch (e) {
      console.log(`[work] ${v.name}: lay_out_houses not queued for ${agent.name}: ${(e as Error).message}`);
      return;
    }
    this.setChore(v, agent, 'grow', [st], `lay out the public work ${piece}`, (why) => this.projectFailed(v, piece, why));
    console.log(`[work] ${v.name}: ${agent.name} lays out the public work ${piece}${names.length > 1 ? ` with ${names.slice(1).join(', ')}` : ''} (${q.units} units) on ${q.size}x${q.size}`);
  }

  /**
   * s39 tier 3 (MC_NEED_WORKS; spec_needworks_v2 B3): what a farmstead would be now, or null with the reason logged once
   * a change: the food flow short for the hold, no farm slot left to start (the slots answer first), none under way, the
   * cooldown since the last; its house the first small house growth would pick, on the pad padFor sizes for a field and
   * two slots.
   */
  private farmsteadPlan(v: Village): { house: string; size: number; units: number; why: string } | null {
    if (!NEED_WORKS || !appetiteOn(v)) return null;
    const free = this.freeFarmSlots(v);
    const underWay = v.growth?.active?.project === PROJECT_FARMSTEAD || this.voting.get(v.name)?.options.some((o) => o.id === PROJECT_FARMSTEAD) === true;
    const due = farmsteadDue(v.foodFlow, free, underWay);
    const log = (why: string) => {
      if (this.farmsteadLogged.get(v.name) !== why) console.log(`[needwork] ${v.name}: no farmstead offered (${why})`);
      this.farmsteadLogged.set(v.name, why);
    };
    if (!due.due) {
      if (v.foodFlow?.short) log(due.why);
      return null;
    }
    const lib = this.vanillaLibrary(v.vanillaBiome ?? 'plains')?.houses ?? null;
    const pick = pickHouses(v, 1, lib, (d) => this.materialTasks(d, d.name).units ?? 0, undefined, this.nextHoodWood(v, 1));
    const pad = pick.length ? padFor([v.designs[pick[0]]].filter(Boolean), 2) : null;
    if (!pad) {
      log('no small house design');
      return null;
    }
    this.farmsteadLogged.set(v.name, '');
    const r = foodflowReading(v.foodFlow, storedPoints(storageContents(v)));
    return { house: pick[0], size: pad.size, units: Math.round(HOUSE_UNITS * 0.6), why: r?.text ?? 'food short' };
  }

  /** Farm slots the menus could start now (the slots answer first): with neighbourhood farms off a slot takes only a kind
   *  no other slot farms, so none once all are farmed; none while the menus said "nothing seen to farm" (s39's Won). */
  private freeFarmSlots(v: Village): number {
    const layouts = v.layouts ?? [];
    const farmed = new Set(layouts.flatMap((l) => (l.slots ?? []).map((q) => q.kind)).filter(Boolean));
    const startable = GROW_FARMS || farmed.size < SLOT_ORDER.length;
    const why = this.startSeen.get(v.name);
    const menuCan = !why || /^(busy|free slots taken)$/.test(why);
    return startable && menuCan ? layouts.flatMap((l) => l.slots ?? []).filter((q) => !q.annex && !q.kind && (q.tries ?? 0) < 3).length : 0;
  }

  /**
   * s40 (MC_NEED_WORKS; runs/2026-10-20/s40/spec_fields_v1.md and its check): the food flow's answer once no farm slot is
   * left, a wheat field on its own 9x9 pad (lay_out_field), by an idle fed member (the Mayor first), beside growth and the
   * vote: its own gate and back-off (projectDue's held it during every neighbourhood and after public works' failures, the
   * check's 6), never while a growth chore is queued. A field laid out but not sown (seeds short) is planted first.
   */
  private fieldTick(v: Village, now: number) {
    if (!appetiteOn(v) || !v.complete || (this.fieldBackoff.get(v.name) ?? 0) > now) return;
    if ([...this.chores.values()].some((c) => c.village === v.name && (c.key === 'grow:field' || c.key === 'grow'))) return;
    const layouts = v.layouts ?? [];
    const fields = layouts.filter((l) => l.field).length;
    if (this.fieldCount.get(v.name) !== fields) {
      this.fieldCount.set(v.name, fields);
      this.fieldFails.delete(v.name);
    }
    const fed = (a: BotAgent) => this.hungerOf(v, a) !== 'hungry';
    const pick = () => this.growMembers(v).find((a) => a.memory.villageRole === 'mayor' && this.isIdleMember(v, a, now) && fed(a)) ?? this.idleMembers(v, now).find(fed);
    const failed = (what: string) => (why: string) => {
      if (why === 'cancelled') return;
      const n = (this.fieldFails.get(v.name) ?? 0) + 1;
      this.fieldFails.set(v.name, n);
      // ("no site": the land is full, looked for again in 20 minutes; any other failure 5 minutes a failure in a row, to 30)
      const min = /no free \d+x\d+ site/.test(why) ? 20 : Math.min(30, 5 * n);
      this.fieldBackoff.set(v.name, Date.now() + min * 60000);
      console.log(`[needwork] ${v.name}: ${what} failed (${why.slice(0, 160)}); fields rest ${min} min`);
    };
    // (a field not sown yet: planted again, as its own chore)
    const k = layouts.findIndex((l) => l.field && l.farm && !l.farm.planted && preparedAt(v, l.farm)) + 1;
    if (k > 0) {
      const agent = pick();
      if (!agent) return;
      let st: ActionStatus;
      try {
        st = agent.enqueue('tend_farm', { chore: true, layout: k });
      } catch (e) {
        console.log(`[needwork] ${v.name}: tend_farm not queued for ${agent.name}: ${(e as Error).message}`);
        return;
      }
      this.setChore(v, agent, 'grow:field', [st], 'plant a wheat field', failed(`planting the field of layout ${k}`));
      console.log(`[needwork] ${v.name}: ${agent.name} plants the field of layout ${k}`);
      return;
    }
    const due = fieldDue(v.foodFlow, this.freeFarmSlots(v), false);
    if (!due.due) {
      if (v.foodFlow?.short && this.fieldLogged.get(v.name) !== due.why) console.log(`[needwork] ${v.name}: no field laid out (${due.why})`);
      this.fieldLogged.set(v.name, due.why);
      return;
    }
    const agent = pick();
    if (!agent) return;
    let st: ActionStatus;
    try {
      st = agent.enqueue('lay_out_field', { chore: true });
    } catch (e) {
      console.log(`[needwork] ${v.name}: lay_out_field not queued for ${agent.name}: ${(e as Error).message}`);
      return;
    }
    this.fieldLogged.set(v.name, '');
    this.setChore(v, agent, 'grow:field', [st], 'lay out a wheat field', failed('the field'));
    if (v.foodFlow) v.foodFlow.sinceField = 0;
    this.villages.save();
    const r = foodflowReading(v.foodFlow, storedPoints(storageContents(v)));
    console.log(`[needwork] ${v.name}: ${agent.name} lays out a wheat field (field ${fields + 1}): ${r?.text ?? 'food short'}`);
  }

  /**
   * s40 (F256): the storage hut tidied by an idle fed member when strays fill TIDY_SLOTS slots or more and two spots are
   * free for the sorted deposit to open new chests or barrels in (with one, misc keeps it for a material and the strays
   * would go back where they were); at most every TIDY_MS.
   */
  private tidyTick(v: Village, now: number) {
    if (!v.complete || !v.storageHut || (this.tidyAt.get(v.name) ?? 0) > now) return;
    if ([...this.chores.values()].some((c) => c.village === v.name && c.key === 'tidy')) return;
    const s = storageStrays(v, this.registry as never);
    if (s.slots < TIDY_SLOTS || s.free < 2) return;
    const fed = (a: BotAgent) => this.hungerOf(v, a) !== 'hungry';
    const agent = this.idleMembers(v, now).find(fed);
    if (!agent) return;
    let st: ActionStatus;
    try {
      st = agent.enqueue('tidy_storage', { chore: true });
    } catch (e) {
      console.log(`[storage] ${v.name}: tidy_storage not queued for ${agent.name}: ${(e as Error).message}`);
      return;
    }
    this.tidyAt.set(v.name, now + TIDY_MS);
    this.setChore(v, agent, 'tidy', [st], 'tidy the storage');
    console.log(`[storage] ${v.name}: ${agent.name} tidies the storage (${s.slots} slots of strays, ${s.free} spots free)`);
  }

  private tidyAt = new Map<string, number>();

  /**
   * #121 (MC_STORAGE_GROW): the storage yard prepared by an idle fed member once storageDue says the hut is nearly full;
   * one chore at a time, a failure backing off as the works plot's do (3 tries, 10 minutes apart).
   */
  private storeTick(v: Village, now: number) {
    if (!v.complete || !v.storageHut || storeBusy.has(v.name)) return;
    if ([...this.chores.values()].some((c) => c.village === v.name && c.key === 'tidy:yard')) return;
    const st = storageSlots(v, this.registry as never);
    const due = storageDue(v, st, freeSpots(v).length, now);
    if (!due.due) return;
    const fed = (a: BotAgent) => this.hungerOf(v, a) !== 'hungry';
    const agent = this.idleMembers(v, now).find(fed);
    if (!agent) return;
    let s: ActionStatus;
    try {
      s = agent.enqueue('prepare_storage_yard', { chore: true });
    } catch (e) {
      console.log(`[storage] ${v.name}: prepare_storage_yard not queued for ${agent.name}: ${(e as Error).message}`);
      return;
    }
    this.setChore(v, agent, 'tidy:yard', [s], 'prepare the storage yard');
    console.log(`[storage] ${v.name}: ${agent.name} prepares the storage yard (${st.used} of ${st.cap} slots used, ${freeSpots(v).length} spots free)`);
  }

  /**
   * #70 (MC_BARTER): the notice board once a minute: open offers past their time lapse (each cheapening its good), and
   * each member with a chest and none open gets the offer code drafts (its most pressing want some other member can spare,
   * paid in its surplus at the board's prices).
   */
  private barterTick(v: Village, now: number) {
    if ((this.barterAt.get(v.name) ?? 0) > now) return;
    this.barterAt.set(v.name, now + 60000);
    const b = boardOf(v);
    for (const o of lapse(b, now)) console.log(`[barter] ${v.name}: ${o.by}'s offer ${o.id} (${offerText(o)}) lapsed unanswered`);
    const names = Object.keys(v.homes ?? {}).filter((n) => v.homes![n].chest);
    const spare = new Map(names.map((n) => [n, surplus(available(b, n, v.homes![n]))]));
    for (const n of names) {
      const others: Counts = {};
      for (const [m, c] of spare) if (m !== n) for (const [k, q] of Object.entries(c)) others[k] = (others[k] ?? 0) + q;
      const o = draftOffer(b, n, available(b, n, v.homes![n]), others, now);
      if (!o) continue;
      b.offers.push(o);
      b.posted++;
      spare.set(n, surplus(available(b, n, v.homes![n])));
      console.log(`[barter] ${v.name}: ${n} offers ${offerText(o)} (${o.id})`);
    }
    this.villages.save();
  }

  private barterAt = new Map<string, number>();
  /** #108: villages whose contracts were reconciled since the load. */
  private payReconciled = new Set<string>();
  /** #111's staged check: deliveries held off the menus (payTest's test:hold). */
  private payTestHold = false;
  /** #108, #111: what payments need of the world (villages, saves, commands, the commons' spare emeralds). */
  private payWorld: PayWorld = {
    village: (name) => this.villages.villages.get(name.toLowerCase()),
    save: () => this.villages.save(),
    rcon: (cmd) => this.rcon.command(cmd),
    // (above the merchant's keep, one of each used sold item kept: a bounty never starves the merchant's buys)
    commonsSpare: (v) => (storageContents(v).emerald ?? 0) - (MERCHANT_ON && v.merchant ? this.emeraldKeep(v, () => 1) : 0),
  };
  /** s43's own farms: members whose house had no room for one, offered none for a while ("village|name"). */
  private ownFarmBack = new Set<string>();
  /** s43's sales: lots of each good members sold this restock, by village (reset at the merchant's restock). */
  ownSold = new Map<string, Counts>();
  /** s43's claims: harvests of each unclaimed plot by member ("village|key" -> name -> n). */
  private claimWork = new Map<string, Map<string, number>>();

  private fieldBackoff = new Map<string, number>();
  private fieldFails = new Map<string, number>();
  private fieldCount = new Map<string, number>();
  private fieldLogged = new Map<string, string>();

  private farmsteadLogged = new Map<string, string>();
  /** The last menu's word on starting a farm slot, by village: '' when one was offered, else the reason none was. */
  private startSeen = new Map<string, string>();

  /** A farmstead to layout (beside the vote since s40): the neighbourhood path with one house, a field and two slots (public work's rules). */
  private layOutFarmstead(v: Village, now: number) {
    const g = (v.growth ??= { past: [] });
    const fs = this.farmsteadPlan(v);
    // (the vote's record, g.work, is the vote's own: a farmstead beside it leaves it be, s40)
    if (!fs) return;
    const fed = (a: BotAgent) => this.hungerOf(v, a) !== 'hungry';
    const agent = this.growMembers(v).find((a) => a.memory.villageRole === 'mayor' && this.isIdleMember(v, a, now) && fed(a)) ?? this.idleMembers(v, now).find(fed);
    if (!agent) return;
    let st: ActionStatus;
    try {
      st = agent.enqueue('lay_out_houses', { chore: true, houses: fs.house, options: `${fs.size}:1:2`, project: PROJECT_FARMSTEAD });
    } catch (e) {
      console.log(`[needwork] ${v.name}: lay_out_houses not queued for ${agent.name}: ${(e as Error).message}`);
      return;
    }
    // (a failure backs off as a public work's, but a farmstead is never refused for good: the land's fault, not the work's)
    this.setChore(v, agent, 'grow', [st], 'lay out a farmstead', (why) => {
      if (why === 'cancelled') return;
      g.projectFails = (g.projectFails ?? 0) + 1;
      g.projectBackoff = Date.now() + 5 * 60000 * g.projectFails;
      this.villages.save();
      console.log(`[needwork] ${v.name}: the farmstead could not be laid out (${why.slice(0, 160)}); projects rest ${5 * g.projectFails} min`);
    });
    if (v.foodFlow) v.foodFlow.sinceFarmstead = 0;
    this.villages.save();
    console.log(`[needwork] ${v.name}: ${agent.name} lays out a farmstead (${fs.house}, field + 2 slots) on ${fs.size}x${fs.size}: ${fs.why}`);
  }

  // ---- s35: initiatives, small works members start and help with (spec runs/2026-10-18/s35/spec_initiatives_v2.md) --------

  /** Areas a small work keeps off (every village's buildings with a ring, streets, lamps, signs, farms, slots, the side
   *  plots, the mine, door fronts, reservations, other initiatives' spots); cached on a signature of what they come from.
   *  #149: the spots found on them are kept with them (`spots` by footprint size; `gardens` for GARDEN_SPOTS_MS, as the
   *  soil is read from the world): every member's menu asked again, and a pad village's search held the loop 4-6 s. */
  private smallBlockedCache = new Map<string, SmallBlocked>();

  private smallBlocked(v: Village): SmallBlocked {
    const now = Date.now();
    const res = v.reservations.filter((q) => q.until > now);
    const bot = [...this.agents.values()].find((a) => a.village()?.name === v.name && a.bot.entity);
    const sig = JSON.stringify([!!bot, v.structures.length, (v.layouts ?? []).length, (v.layouts ?? []).map((l) => [l.lamps?.length, l.signs?.length, l.slots?.length, !!l.farm, (l.paths ?? []).filter((q) => q.cells).length]), v.plots.length,
      (v.initiatives ?? []).map((i) => `${i.id}:${i.state}:${i.pending ? 'p' : ''}`), res.map((q) => `${q.x1},${q.z1},${q.x2},${q.z2}`),
      v.tasks.filter((t) => t.status !== 'done' && /^Build /.test(t.title)).length, ...(RULES.on ? [zoneBoxes(v.name, 'build').map((z) => z.text)] : [])]);
    const old = this.smallBlockedCache.get(v.name);
    if (old?.sig === sig) return old;
    const pad = (q: Area, n: number): Area => ({ x1: q.x1 - n, z1: q.z1 - n, x2: q.x2 + n, z2: q.z2 + n });
    const cell = (x: number, z: number, n = 0): Area => ({ x1: x - n, z1: z - n, x2: x + n, z2: z + n });
    const blocked: Area[] = [];
    // (#45: the same areas for a garden, which hugs buildings and door fronts: structures without their ring, no door
    // fronts; `soft` collects what only `blocked` keeps)
    const soft = new Set<Area>();
    const own: Area[] = [];
    for (const o of this.villages.villages.values()) for (const st of o.structures) {
      const ring = pad(st, 1);
      blocked.push(ring);
      soft.add(ring);
      own.push({ x1: st.x1, z1: st.z1, x2: st.x2, z2: st.z2 });
    }
    for (const l of v.layouts ?? []) {
      for (const st of l.streets ?? []) blocked.push(st);
      // (#84 C2: the graded paths between pads, each cell)
      for (const q of l.paths ?? []) for (const [x, z] of q.cells ?? []) blocked.push(cell(x, z));
      for (const lp of l.lamps ?? []) blocked.push(cell(lp.x, lp.z, 1));
      for (const sg of l.signs ?? []) blocked.push(cell(sg.x, sg.z, 1));
      if (l.farm) blocked.push(pad(l.farm, 1));
      for (const sl of l.slots ?? []) blocked.push(pad(sl, 1));
      for (const side of [l.annex, l.works, l.store]) if (side && side.x2 >= side.x1) blocked.push(pad(side, 1));
    }
    if (v.mine) blocked.push(...mineAreas(v.mine).map((q) => pad(q, 1)));
    // (three cells out from every building's door: the way in stays clear)
    for (const P of this.lightParts(v)) {
      const door = P.kind === 'building' && P.place ? placedDoor(P.place) : null;
      if (door) for (let k = 0; k <= 3; k++) {
        const c = cell(door.x + door.ox * k, door.z + door.oz * k, 1);
        blocked.push(c);
        soft.add(c);
      }
    }
    for (const q of res) blocked.push(q);
    // (G3, MC_RULES: a zone voted free of building, or kept for farms: no small work, garden or stall on it)
    if (RULES.on) for (const z of zoneBoxes(v.name, 'build')) blocked.push({ x1: z.x1, z1: z.z1, x2: z.x2, z2: z.z2 });
    // (a building laid out and not built yet, by its Build task's footprint: an initiative took a public work's spot before
    // its builder reserved it, and both builds failed, s43's Rch4)
    for (const t of v.tasks) {
      if (t.status === 'done' || !/^Build /.test(t.title)) continue;
      const f = /footprint x (-?\d+)\.\.(-?\d+), z (-?\d+)\.\.(-?\d+)/.exec(t.detail);
      if (f) blocked.push(pad({ x1: Number(f[1]), x2: Number(f[2]), z1: Number(f[3]), z2: Number(f[4]) }, 1));
    }
    for (const i of v.initiatives ?? []) if (i.state === 'open' && !i.pending) {
      const k = smallWorkKind(i.kind);
      const d = k ? v.designs[i.design] : undefined;
      const w = d?.width ?? 7, dd = d?.depth ?? 7;
      blocked.push(pad({ x1: i.x - Math.floor(w / 2), z1: i.z - Math.floor(dd / 2), x2: i.x - Math.floor(w / 2) + w - 1, z2: i.z - Math.floor(dd / 2) + dd - 1 }, 2));
    }
    // (a green waits for its own initiative's spot before others may use it, s36's review)
    const waiting = new Set((v.initiatives ?? []).filter((i) => i.state === 'open' && i.pending).map((i) => i.id));
    // (#84, MC_PAD_PER_BUILDING: a village on pads keeps its layout-wide record, parts and all; the ground between its pads
    // is the slope's own, so a spot there is read column by column: train 3's P1 offered initiatives on 27 of 507 menus)
    // (a column under a tree counts at its ground, `wooded`: the spot is prepared first, felling it)
    const groundOf = (yHint: number) => {
      const memo = new Map<string, { y: number; trees: boolean } | null>();
      const read = (x: number, z: number) => {
        const k = `${x},${z}`;
        if (!memo.has(k)) {
          let g: { y: number; trees: boolean } | null = null;
          try {
            const c = bot ? surfaceAt(bot, x, z, yHint) : null;
            g = c && !c.liquid && c.block !== 'air' && Math.abs(c.y - yHint) <= 6 ? { y: c.y, trees: c.trees > 0 } : null;
          } catch {
            g = null;
          }
          memo.set(k, g);
        }
        return memo.get(k)!;
      };
      return { ground: (x: number, z: number) => read(x, z)?.y ?? null, wooded: (x: number, z: number) => !!read(x, z)?.trees };
    };
    const plots = v.plots.filter((q) => !q.annex && !q.works && (!q.parts || (q.pads && bot)) && !(q.green && waiting.has(q.green)))
      .map((q) => ({ x1: q.x1, z1: q.z1, x2: q.x2, z2: q.z2, y: q.y, ...(q.pads ? groundOf(q.y) : {}) }));
    // (hard: every blocked area but the rings and door fronts, with the structures' own footprints back)
    const hard = [...blocked.filter((q) => !soft.has(q)), ...own];
    const entry: SmallBlocked = { sig, blocked, plots, hard, own, spots: new Map() };
    this.smallBlockedCache.set(v.name, entry);
    return entry;
  }

  /** A free spot for a small work (pure): one of the first spots smallWorkSpots finds, chosen by `seed` so members spread. */
  private smallWorkSpot(v: Village, k: SmallWorkKind, wood: string, seed: string): { x: number; y: number; z: number; prep?: true } | null {
    const d = k.make(wood);
    const entry = this.smallBlocked(v);
    const { blocked, plots, hard, own } = entry;
    // (#45, MC_GARDENS: a garden's spots by its doors and greens, gardenSpots in smallWorks.ts)
    if (GARDENS && isGarden(k.kind) && entry.gardens && Date.now() - entry.gardens.at < GARDEN_SPOTS_MS) {
      const spots = entry.gardens.list.filter((sp) => sp.kind === k.kind);
      if (!spots.length) return null;
      const sp = spots[fnv1a(`${seed}|${k.kind}`) % spots.length];
      return { x: sp.x, y: sp.y, z: sp.z };
    }
    if (GARDENS && isGarden(k.kind)) {
      const doors: Array<{ x: number; z: number; ox: number; oz: number; y: number }> = [];
      for (const P of this.lightParts(v)) {
        const door = P.kind === 'building' && P.place ? placedDoor(P.place) : null;
        if (door && P.structure) doors.push({ x: door.x, z: door.z, ox: door.ox, oz: door.oz, y: P.structure.y });
      }
      // (#46: greens with their areas, and the building plots, for the corner trees)
      const greens = v.plots.filter((p) => p.green).map((p) => ({ x: Math.floor((p.x1 + p.x2) / 2), z: Math.floor((p.z1 + p.z2) / 2), y: p.y, x1: p.x1, z1: p.z1, x2: p.x2, z2: p.z2 }));
      const bot = [...this.agents.values()].find((a) => a.village()?.name === v.name && a.bot.entity)?.bot;
      const SOIL = new Set(['grass_block', 'dirt', 'podzol', 'coarse_dirt', 'rooted_dirt', 'moss_block']);
      const soil = (x: number, z: number, y: number) => {
        try {
          const g = bot?.blockAt(new Vec3(x, y, z)), up = bot?.blockAt(new Vec3(x, y + 1, z));
          return !!g && !!up && SOIL.has(g.name) && up.name === 'air';
        } catch {
          return false;
        }
      };
      // (every village's building footprints: a garden's box and its 1-cell margin keep clear of them)
      entry.gardens = { at: Date.now(), list: gardenSpots({ doors, greens, plots, hard, structures: own, soil }) };
      const spots = entry.gardens.list.filter((sp) => sp.kind === k.kind);
      if (!spots.length) return null;
      const sp = spots[fnv1a(`${seed}|${k.kind}`) % spots.length];
      return { x: sp.x, y: sp.y, z: sp.z };
    }
    const size = `${d.width}x${d.depth}`;
    let spots = entry.spots.get(size);
    if (!spots) entry.spots.set(size, (spots = smallWorkSpots({ plots, blocked }, d.width, d.depth, 8)));
    if (!spots.length) return null;
    return { ...spots[fnv1a(`${seed}|${k.kind}`) % spots.length] };
  }

  /**
   * An open initiative's next step (s35): build once the spare storage covers its bill (one builder), else gather its
   * largest missing raw material that gathering can bring (logs, cobblestone from a free mine face, sand), up to
   * INITIATIVE_GATHERERS at once; null when nothing can be taken now.
   */
  initiativeStep(v: Village, it: Pick<Initiative, 'id' | 'design' | 'pending'>, spare: Counts, busy: Set<string>, design?: Design): InitiativeStep | null {
    // (no spot yet: its green first, one preparer, s36)
    if (it.pending) return busy.has(`initiative:${it.id}:prepare`) || v.plots.some((p) => p.green === it.id) ? null : { what: 'prepare' };
    const d = design ?? v.designs[it.design];
    if (!d) return null;
    if ([...busy].some((k) => k.startsWith(`initiative:${it.id}:build`))) return null;
    // (built already, before initiativeTick has marked it: no second build onto it, s36)
    const at = it as Partial<Initiative>;
    if (at.x !== undefined && at.z !== undefined && v.structures.some((st) => st.kind === d.name && at.x! >= st.x1 && at.x! <= st.x2 && at.z! >= st.z1 && at.z! <= st.z2)) return null;
    const wood = this.workWood(v, d.name);
    // (against what its crew has gathered, not the spare storage: initiatives gather their own, the user's, s36)
    void spare;
    const gather = this.materials.plan(inWood(designBill(d), wood), (it as Partial<Initiative>).gathered ?? {}).gather;
    const left = Object.entries(gather).filter(([, q]) => q > 0);
    if (!left.length) return [...busy].some((k) => k.startsWith(`initiative:${it.id}:`)) ? null : { what: 'build' };
    if ([1, 2].slice(0, INITIATIVE_GATHERERS).every((n) => busy.has(`initiative:${it.id}:${n}`))) return null;
    const mat = (n: string): Material | 'flowers' | 'saplings' | 'sandstone' | null => (n === 'any:logs' || /_log$/.test(n) ? 'logs' : /^(red_)?sand$/.test(n) ? 'sand' : VANILLA_ALL && /^(red_)?sandstone$/.test(n) ? 'sandstone' : /^(any:)?cobblestone$/.test(n) ? 'cobblestone'
      // (#45, #46, MC_GARDENS: a garden's wildflowers and a corner tree's sapling, gathered by its crew)
      : GARDENS && (n === 'wildflowers' || FLOWER_ITEMS.includes(n)) ? 'flowers' : GARDENS && /_sapling$/.test(n) ? 'saplings' : null);
    for (const [n, q] of left.sort((x, y) => y[1] - x[1])) {
      const m = mat(n);
      if (!m) continue;
      if (m === 'cobblestone' && !mineCanGive(v, 'cobblestone')) continue;
      if (m === 'sand' && v.unavailable?.includes('sand')) continue;
      const spec = m === 'flowers' ? FLOWER_GATHER : m === 'saplings' ? SAPLING_GATHER : m === 'sandstone' ? SANDSTONE_GATHER : GATHER_KINDS[m];
      // (a sapling trip breaks leaves within reach of the ground until it holds the saplings wanted, at most 2)
      if (m === 'saplings') {
        const wood = this.workWood(v, d.name);
        return { what: 'gather', material: m, amount: Math.min(spec.trip, Math.max(1, Math.ceil(q))), block: spec.block(wood), deposit: spec.deposit(wood), item: spec.deposit(wood) };
      }
      // (#140: a flower bed's own flowers, kind by kind, picked, deposited and credited by name; wildflowers as before)
      // (a mix's other kinds by 2 at least: a 2x2 bed of four kinds took four trips of 4)
      if (m === 'flowers' && FLOWER_MIX) return { what: 'gather', material: m, amount: Math.min(spec.trip, Math.max(n === 'wildflowers' ? 4 : 2, Math.ceil(q))), block: n, deposit: n, ...(n === 'wildflowers' ? {} : { item: n }) };
      return { what: 'gather', material: m, amount: Math.min(spec.trip, Math.max(4, Math.ceil(q))), block: spec.block((WOOD_VARIANTS && smallWorkWood(d.name)) || (v.wood ?? v.catalogWood)), deposit: spec.deposit(v.wood) };
    }
    return null;
  }

  /** One step queued as a chore: a gathering trip into storage, or the build (build_design at its spot). */
  private runInitiativeStep(v: Village, worker: BotAgent, it: Initiative, step: InitiativeStep, opt: ChoiceOption, meta: ChoiceMeta | undefined) {
    const k = smallWorkKind(it.kind);
    // (the step's own key held too: an initiator's first step runs under its initiate key, and a help option for the same
    // step must not be offered beside it, in this sweep or later; s36)
    const stepKey = `initiative:${it.id}:${step.what === 'gather' ? 1 : step.what}`;
    if (!opt.key.startsWith(`initiative:${it.id}:`) && !opt.holds.some((h) => h.startsWith(`initiative:${it.id}:`))) {
      opt = { ...opt, holds: [...opt.holds, stepKey] };
      this.sweepCtx?.busy.add(stepKey);
      this.sweepCtx?.first?.busy.add(stepKey);
    }
    it.steps.push({ agent: worker.name, what: step.what === 'gather' ? `gather ${step.amount} ${step.material}` : step.what, at: Date.now() });
    this.villages.save();
    if (step.what === 'prepare') {
      const st = worker.enqueue('prepare_green', { initiative: it.id, size: GREEN_SIZE, chore: true });
      const failed = (why: string) => {
        if (why === 'cancelled' || st.code) return;
        it.fails = (it.fails ?? 0) + 1;
        it.backoff = Date.now() + 10 * 60000;
        // (three tries: a first "no level ground" may be unloaded chunks, s36's review M2)
        if (it.fails >= 3) this.endInitiative(v, it, 'failed', `its green could not be prepared (${why.slice(0, 120)})`);
        this.villages.save();
      };
      this.setChore(v, worker, opt.key, [st], `prepare a green for ${it.id} (${k?.words ?? it.kind})`, failed, meta, opt.holds, opt);
      console.log(`[initiative] ${v.name}: ${worker.name} prepares a green for ${it.id} (${it.by}'s ${k?.words ?? it.kind})`);
      return;
    }
    if (step.what === 'build') {
      // (#84: a spot between pads not level enough, its footprint and ring prepared first, at their own level)
      const dz = it.prep ? v.designs[it.design] : undefined;
      const prep = dz ? worker.enqueue('prepare_site', { x: it.x, z: it.z, width: dz.width + 2, depth: dz.depth + 2, margin: 0, chore: true }) : null;
      const st = worker.enqueue('build_design', { design: it.design, x: it.x, z: it.z, chore: true });
      const failed = (why: string) => {
        if (why === 'cancelled' || st.code || prep?.code) return;
        it.fails = (it.fails ?? 0) + 1;
        it.backoff = Date.now() + 10 * 60000;
        if (it.fails >= 3) this.endInitiative(v, it, 'failed', `the build failed 3 times (${why.slice(0, 120)})`);
        this.villages.save();
      };
      this.setChore(v, worker, opt.key, prep ? [prep, st] : [st], `build ${it.id} (${k?.words ?? it.kind})`, failed, meta, opt.holds, opt);
      console.log(`[initiative] ${v.name}: ${worker.name} builds ${it.id} (${it.by}'s ${k?.words ?? it.kind}) at ${it.x},${it.z}`);
      return;
    }
    const collect = worker.enqueue('collect', { block: step.block, count: step.amount, chore: true, ...(step.item ? { item: step.item } : {}) });
    const deposit = worker.enqueue('deposit', { item: step.deposit, also: GATHER_ALSO, chore: true });
    const failed = (why: string) => {
      if (why === 'cancelled' || collect.code || deposit.code) return;
      if (deposit.state === 'done' && depositedOf(deposit.message ?? '', step.material, step.item) > 0) return;
      it.backoff = Date.now() + 5 * 60000;
      if (/cannot be gathered here/.test(collect.message ?? '')) this.initiativeNoneNear(v, it, step);
    };
    this.setChore(v, worker, opt.key, [collect, deposit], `gather ${step.amount} ${step.material} for ${it.id}`, failed, meta, opt.holds, opt);
    // (judged by its deposit as gathering is: a partial collect whose load landed is a success, s36)
    const c = this.chores.get(worker.name.toLowerCase());
    if (c) c.choice.initiative = { id: it.id, material: step.material, n: step.amount, ...(step.material === 'flowers' && step.item ? { item: step.item } : {}) };
    console.log(`[initiative] ${v.name}: ${worker.name} gathers ${step.amount} ${step.material} for ${it.id} (${it.by}'s ${k?.words ?? it.kind})`);
  }

  /** M1 (#144): a bill of the monument's blocks as the items members gather for it (logs as its wood's). */
  monumentRaw(m: Monument, bill: Counts): Counts {
    const out: Counts = {};
    for (const [n, q] of Object.entries(this.materials.plan(bill).gather)) {
      if (q <= 0) continue;
      const item = n === 'any:logs' ? `${m.wood}_log` : n.replace(/^any:/, '');
      out[item] = (out[item] ?? 0) + q;
    }
    return out;
  }

  /** M1: when each village's monument line was last logged, and jobs backed off after a failure (until). */
  private monumentAt = new Map<string, number>();
  private monumentBack = new Map<string, number>();
  /** #162: when the stage began waiting for a quarried stone (village:item), for its stand-in after STONE_WAIT_MIN. */
  private stoneWait = new Map<string, { since: number; last: number }>();

  /** M1 (#144, MC_MONUMENT): the cathedral begun once the iron age is complete (no vote: the user's, 10-25), and its
   *  progress logged every 5 minutes. */
  private monumentTick(v: Village) {
    const now = Date.now();
    if (!v.monument) {
      if (!ironReached(v)) return;
      // (M3, MC_MONUMENT_ARCHITECT: the architect model picks the parameters first; the record waits for its answer; the
      // cathedral's only, #153: code sets the castle's)
      if (M3.architect && MONUMENT.type === 'cathedral') {
        const pick = this.architectPicks.get(v.name);
        if (!pick) {
          this.architectPicks.set(v.name, 'asking');
          this.askArchitect(v).then((r) => this.architectPicks.set(v.name, r), (e) => this.architectPicks.set(v.name, { pick: null, by: 'code', why: String((e as Error)?.message ?? e).slice(0, 160) }));
          return;
        }
        if (pick === 'asking') return;
        this.architectPicks.delete(v.name);
        v.monument = newMonumentPicked(this.catalogWoodOf(v), now, pick.pick, pick.by, pick.why);
      } else v.monument = newMonument(this.catalogWoodOf(v), now);
      // (M2, #145: the glass colours the flowers near the village give, chosen once; M3: the architect's when it chose)
      if (MONUMENT.glazing && v.monument.palette === 'full') {
        // (#162, MC_DYE_BED: the dye census, tall flowers and out to 144)
        const counts = DYE_BED.on ? this.dyeCounts(v) : this.flowerCounts(v);
        if (!(M3.architect && m3(v.monument).arch?.by !== 'code')) v.monument.colours = glassColours(counts);
        v.monument.flowers = dyeFlowers(counts);
        // (#162: a detail cathedral's windows in every colour the village can make, each colour standing for itself)
        if (DYE_BED.on && m3(v.monument).detail) {
          const cs = windowColours(DETAIL_COLOURS, this.makeableColours(v));
          v.monument.colours = Object.fromEntries(cs.map((x) => [x, x]));
          console.log(`[dyebed] ${v.name}: the windows' colours: ${cs.join(', ') || 'none (plain glass)'}`);
        }
      }
      const c = monumentPlan(v.monument);
      this.villages.save();
      const named = m3(v.monument).name ? `, dedicated to ${m3(v.monument).name}` : '';
      const text = `The village begins its ${monumentNoun(v.monument)} (${presetWords(v.monument.preset)} at 1:${v.monument.scale}${named}) after the iron age: ${c.design.blocks} blocks in ${c.jobs.length} parts over ${c.stageNames.length} stages`;
      if (M3.news) this.monumentNews(v, text, m3(v.monument).arch?.by && m3(v.monument).arch!.by !== 'code' ? m3(v.monument).arch!.by : 'Mayor');
      else this.villages.note(v, text);
      console.log(`[monument] ${v.name}: begun after the iron age: ${monumentLine(v.monument)}${m3(v.monument).arch ? ` (by ${m3(v.monument).arch!.by}${m3(v.monument).arch!.fallback ? `: ${m3(v.monument).arch!.fallback}` : `: ${m3(v.monument).arch!.reason}`})` : ''}`);
      return;
    }
    if ((this.monumentAt.get(v.name) ?? 0) > now) return;
    this.monumentAt.set(v.name, now + 5 * 60000);
    console.log(`[monument] ${v.name}: ${monumentLine(v.monument)}`);
    if (v.monument.quarry) console.log(`[quarry] ${v.name}: ${quarryLine(v.monument.quarry)}`);
    if (v.monument.kiln) console.log(`[kiln] ${v.name}: ${kilnLine(v.monument.kiln, now, timeScale())}`);
    if (M3.roles && m3(v.monument).trades) console.log(`[trade] ${v.name}: ${Object.entries(m3(v.monument).trades!).filter(([, r]) => r.trade).map(([n, r]) => `${n} ${r.trade}`).join(', ') || 'no trades yet'}`);
  }

  /** M3 (MC_MONUMENT_ARCHITECT): the pick under way ('asking') or answered, by village. */
  private architectPicks = new Map<string, 'asking' | { pick: ArchitectPick | null; by: string; why?: string }>();

  /**
   * M3 (MC_MONUMENT_ARCHITECT): the architect model (the mayor's design model, else the planner's, else the default) picks
   * the preset, the scale among those allowed, the glass colours the flowers allow and a dedication; code checks the
   * pick and draws everything (lesson 1). One retry with the problems; then the settings' preset, with why.
   */
  private async askArchitect(v: Village): Promise<{ pick: ArchitectPick | null; by: string; why?: string }> {
    const mayor = [...this.agents.values()].find((a) => a.village() === v && a.role === 'mayor');
    const by = mayor?.name ?? 'Mayor';
    const mem = mayor?.memory ?? {};
    const spec = [mem.designModel, mem.planModel, mem.execModel, rawSetting('MC_PLAN_MODEL'), rawSetting('MC_EXEC_MODEL'), 'ollama:gpt-oss:120b-cloud']
      .map((x) => (typeof x === 'string' ? parseSpec(x) : null)).find((x) => x);
    const counts = MONUMENT.glazing && MONUMENT.palette === 'full' ? (DYE_BED.on ? this.dyeCounts(v) : this.flowerCounts(v)) : null;
    const facts: ArchitectFacts = {
      // (the roster as memory keeps it too: M3a's trigger came while members were still spawning, 11 of 25)
      village: v.name, members: Math.max([...this.agents.values()].filter((a) => a.village() === v).length, rosterOf(v.name).length),
      wood: this.catalogWoodOf(v), dyes: counts ? dyesOnOffer(counts) : null, options: architectOptions(),
    };
    let user = architectPrompt(facts);
    let why = 'no model';
    // (a transient error, a 429 or 5xx, waits and asks again, up to 6 times, without spending the one retry: M3a's two
    // tries both met an Ollama 500 at the trigger and code chose)
    let transient = 0;
    for (let attempt = 0; spec && attempt < 2; attempt++) {
      try {
        const { reply } = await callModel({ spec, system: ARCHITECT_SYSTEM, user, tools: [ARCHITECT_TOOL], level: REASONING.design, agent: by, kind: 'design', priority: 'plan' });
        const call = reply.calls?.find((c) => c.name === ARCHITECT_TOOL.name);
        if (!call) {
          why = 'the architect called no plan_cathedral';
          user = `${architectPrompt(facts)}\nCall plan_cathedral now.`;
          continue;
        }
        const r = checkArchitect(call.input as Record<string, unknown>, facts);
        console.log(`[architect] ${v.name}: ${by} (${label(spec)}) ${'pick' in r ? `picks ${r.pick.preset} 1:${r.pick.scale}, glass ${JSON.stringify(r.pick.colours)}${r.pick.name ? `, dedicated to ${r.pick.name}` : ''}: ${r.pick.reason}` : `sent back: ${r.problems.join('; ')}`}`);
        if ('pick' in r) return { pick: r.pick, by };
        why = r.problems.join('; ');
        user = `${architectPrompt(facts)}\nYour last choice could not be used: ${why}. Choose again.`;
      } catch (e) {
        why = String((e as Error)?.message ?? e).slice(0, 160);
        console.log(`[architect] ${v.name}: the call failed: ${why}`);
        if (isTransient(e) && transient < 6) {
          transient++;
          attempt--;
          await new Promise((r) => setTimeout(r, (30000 * transient) / timeScale()).unref?.());
        }
      }
    }
    console.log(`[architect] ${v.name}: code chooses ${MONUMENT.preset} (${why})`);
    return { pick: null, by: 'code', why };
  }

  /** M3 (MC_MONUMENT_NEWS): the cathedral's news: its record (shown a village day), the village log, the chronicle, and
   *  (MC_NEWS) every member's news, told by `from`. */
  private monumentNews(v: Village, text: string, from: string) {
    const now = Date.now();
    if (v.monument) m3(v.monument).news = { t: now, text };
    this.villages.note(v, text);
    const day = clockOf(v.name, now)?.day;
    const vm = villageMemory(v.name);
    if (vm && day !== undefined) {
      const ch = ((vm.social.chronicle as ChronicleEntry[] | undefined) ?? []);
      const e = ch.find((x) => x.day === day) ?? (ch.push({ day, facts: [] }), ch[ch.length - 1]);
      e.facts.push(text);
      vm.social.chronicle = ch.slice(-30);
    }
    const members = [...this.agents.values()].filter((a) => a.village() === v).map((a) => a.name);
    codeNews(v.name, from, text, members, now);
    logAct({ type: 'monument', village: v.name, text, from, t: now });
    console.log(`[monument] ${v.name}: news: ${text}`);
  }

  /** M3 (MC_MONUMENT_ROLES): a credited monument chore counted to its trade, the trade taken or changed and logged. */
  private creditTrade(v: Village, agent: string, trade: Trade, what?: { built?: boolean; item?: string; n?: number }) {
    const m = v.monument;
    if (!m) return;
    const ch = noteTrade(m, agent, trade, Date.now(), what);
    console.log(`[trade] ${v.name}: ${agent} works as ${trade} in stage ${currentStage(m) || 'built'}${tradeOf(m, agent) ? ` (holds ${tradeOf(m, agent)})` : ''}`);
    if (ch) console.log(`[trade] ${v.name}: ${agent} ${ch.from ? `changes trade: ${ch.from} -> ${ch.took}` : `takes the trade of ${ch.took}`} in stage ${currentStage(m) || 'built'}`);
  }

  /** G2's role note for a choice: its kind, or (MC_MONUMENT_ROLES) a monument option's cathedral trade. */
  private roleKindOf(v: Village, kind: string, opt?: ChoiceOption): string {
    const d = opt && kind === 'monument' && M3.roles && v.monument ? OPTION_RUN.get(opt) : undefined;
    return d?.kind === 'monument' ? tradeOfStep(v.monument!, d) : kind;
  }

  /**
   * #140: an initiative's gathering found none near the village. Each retry was a step, so the project never lapsed:
   * train 5's C1 kept six beds open on used-up lilies of the valley, the whole project cap. A bed's flower is dropped from
   * its mix; anything else, or a bed down to wildflowers, ends the project after 3 such answers.
   */
  initiativeNoneNear(v: Village, it: Initiative, step: { material: string; block: string; item?: string }) {
    if (step.material === 'flowers' && step.item && this.dropBedFlower(v, it, step.item)) return;
    it.fails = (it.fails ?? 0) + 1;
    if (it.fails >= 3) this.endInitiative(v, it, 'failed', `no ${step.item ?? step.block} can be gathered near the village`);
    this.villages.save();
  }

  /**
   * #140: a flower bed's flower that cannot be gathered near the village any more leaves its mix: the bed is drawn again
   * from the rest (wildflowers when nothing else is left) under its new design's name, and the census is read afresh.
   * False when the bed has no mix holding that flower.
   */
  private dropBedFlower(v: Village, it: Initiative, flower: string): boolean {
    const k = smallWorkKind(it.kind), at = it.design.indexOf('~');
    if (!k || at < 0) return false;
    const mix = it.design.slice(at + 1).split('-');
    if (!mix.includes(flower)) return false;
    const rest = mix.filter((f) => f !== flower);
    const d = k.make(smallWorkWood(it.design) ?? v.wood ?? 'oak', rest.length ? rest : ['wildflowers']);
    v.designs[d.name] = d;
    const was = it.design;
    it.design = d.name;
    // (and no new bed is offered with it for a while: F324)
    ((v as Village & { flowersOut?: Record<string, number> }).flowersOut ??= {})[flower] = Date.now();
    this.flowerCensus.delete(v.name);
    this.flowerCensus.delete(`${v.name}|${DYE_REACH}`);
    this.villages.save();
    console.log(`[initiative] ${v.name}: ${it.id} drops ${flower} (none left near the village): ${was} -> ${d.name}`);
    return true;
  }

  /** An initiative ended: the record, a note, a line with its crew. */
  private endInitiative(v: Village, it: Initiative, state: 'built' | 'failed' | 'lapsed', why: string) {
    it.state = state;
    if (state === 'built' && it.by !== STALL_BY) think(v.name, it.by, 'built', `your ${smallWorkKind(it.kind)?.words ?? it.kind} was built`, Date.now());
    it.end = Date.now();
    it.why = why;
    this.villages.note(v, `${it.by}'s ${it.kind} (${it.id}) ${state}: ${why}; crew ${it.crew.join(', ')}`);
    this.villages.save();
    console.log(`[initiative] ${v.name}: ${it.id} ${state} in ${((it.end - it.at) / 60000).toFixed(1)} min (${why}); started by ${it.by}, crew ${it.crew.join(', ')}; ${it.steps.length} steps`);
  }

  /** A signpost that stands shows its neighbourhood's name (#10; build_design puts it up blank): once, by RCON, its sign
   *  in the post's column (the design's centre) found by trying the heights over the spot. */
  private nameSignpost(v: Village, it: Initiative) {
    const text = signpostText(v, it.x, it.z);
    it.text = text;
    this.villages.save();
    const nbt = `{front_text:{messages:[${[0, 1, 2, 3].map((i) => JSON.stringify(text[i] ?? '')).join(',')}]},is_waxed:1b}`;
    void (async () => {
      for (let y = it.y; y <= it.y + 5; y++)
        if (/^Modified/i.test(await this.rcon.command(`data merge block ${it.x} ${y} ${it.z} ${nbt}`).catch(() => ''))) return console.log(`[initiative] ${v.name}: ${it.id}'s signpost reads "${text.join(' / ')}"`);
      console.log(`[initiative] ${v.name}: ${it.id}'s signpost at ${it.x},${it.z}: no sign found to write "${text.join(' / ')}" on`);
    })();
  }

  /** Every farm tick: an open initiative whose design stands at its spot is built (judged by the structure, lesson 138);
   *  one with no step taken for INITIATIVE_LAPSE_MS lapses. */
  /**
   * s40 (the user's, 10-20; F256): an open initiative takes what storage holds above its keeps first and gathers only the
   * rest (s36 had every initiative gather its own: Night40's 42 felled 916 logs and storage's birch logs rose by 709).
   * What it takes is credited to its `gathered`, which its build withdraws as any other, so the next initiative sees that
   * much less; the goods other open initiatives have gathered and not built with yet stay theirs.
   */
  private claimStoredSurplus(v: Village) {
    if (!INITIATIVE_STORE) return;
    const open = (v.initiatives ?? []).filter((i) => i.state === 'open' && !i.pending);
    if (!open.length) return;
    const spare = this.makeSpare(v, '');
    for (const i of open) for (const [n, q] of Object.entries(i.gathered ?? {})) spare[n] = (spare[n] ?? 0) - q;
    const wood = this.catalogWoodOf(v);
    for (const it of open) {
      const d = v.designs[it.design];
      if (!d) continue;
      const gather = this.materials.plan(inWood(designBill(d), wood), it.gathered ?? {}).gather;
      const took: Record<string, number> = {};
      for (const [n, q] of Object.entries(gather)) {
        // (the items a trip credits: logs as the catalog wood's, cobblestone, sand; runInitiativeStep's own names)
        const item = n === 'any:logs' ? `${wood}_log` : n.replace(/^any:/, '');
        if (!/_log$|^cobblestone$|^(red_)?sand$/.test(item)) continue;
        const t = Math.min(Math.ceil(q), Math.floor(spare[item] ?? 0));
        if (t <= 0) continue;
        it.gathered = { ...(it.gathered ?? {}), [item]: (it.gathered?.[item] ?? 0) + t };
        it.fromStore = { ...(it.fromStore ?? {}), [item]: (it.fromStore?.[item] ?? 0) + t };
        spare[item] -= t;
        took[item] = (took[item] ?? 0) + t;
      }
      if (!Object.keys(took).length) continue;
      this.villages.save();
      console.log(`[initiative] ${v.name}: ${it.id} takes ${Object.entries(took).map(([n, q]) => `${q} ${n}`).join(', ')} from storage's surplus`);
    }
  }

  /** s41: when each village's merchant was last checked, and the checks under way (one RCON round at a time). */
  private merchantAt = new Map<string, number>();
  private merchantBusy = new Set<string>();

  /**
   * The merchant (MC_MERCHANT, spec_shop_v2): once a minute, the village's first built market stall gets a merchant (its
   * record, then the entity); the entity is summoned only while its chunk is loaded (a check that cannot see it would
   * summon a second), every one beyond the nearest is removed, and the offers are restocked on their clock.
   */
  private merchantTick(v: Village) {
    const now = Date.now();
    if ((this.merchantAt.get(v.name) ?? 0) > now || this.merchantBusy.has(v.name)) return;
    this.merchantAt.set(v.name, now + 60000);
    if (!v.merchant) {
      const stall = (v.initiatives ?? []).filter((i) => i.kind === 'market_stall' && i.state === 'built').sort((a, b) => a.at - b.at)[0];
      if (!stall) return;
      const c = stallCell(stall);
      v.merchant = { stall: stall.id, ...c, uses: [], restockAt: now + this.restockMs(), ledger: {} };
      this.villages.save();
      console.log(`[merchant] ${v.name}: a merchant comes to ${stall.by}'s market stall (${stall.id}) at ${c.x},${c.y},${c.z}`);
      this.villages.note(v, `A merchant comes to the market stall at ${c.x},${c.z}: it buys the village's goods and sells what the land cannot give, for emeralds`);
    }
    const m = v.merchant;
    // (s42, #73: orders once for each restock, the first when the merchant comes; restockAt moves at the restock below)
    if (ORDERS_ON && m.ordersFor !== m.restockAt) {
      const aged = m.ordersFor !== undefined;
      m.ordersFor = m.restockAt;
      this.merchantOrders(v, now, aged);
    }
    this.merchantBusy.add(v.name);
    void (async () => {
      try {
        const loaded = await this.rcon.command(`execute if loaded ${m.x} ${m.y} ${m.z}`);
        if (!/passed/i.test(loaded)) return;
        const sel = `@e[type=minecraft:villager,tag=${MERCHANT_TAG},tag=${villageTag(v.name)}]`;
        const seen = await this.rcon.command(`execute if entity ${sel}`);
        const n = Number(/count: (\d+)/.exec(seen)?.[1] ?? (/passed/i.test(seen) ? 1 : 0));
        if (n === 0) {
          const r = await this.rcon.command(summonCommand(v.name, m.x, m.y, m.z));
          if (!/summoned/i.test(r)) throw new Error(`the summon failed: ${r.slice(0, 120)}`);
          for (const c of offersCommands(sel.replace(']', ',limit=1]'), m.uses)) await this.rcon.command(c);
          console.log(`[merchant] ${v.name}: summoned at ${m.x},${m.y},${m.z}`);
        } else if (n > 1) {
          await this.rcon.command(`execute positioned ${m.x} ${m.y} ${m.z} run kill ${sel.replace(']', `,sort=furthest,limit=${n - 1}]`)}`);
          console.log(`[merchant] ${v.name}: ${n - 1} extra merchant${n > 2 ? 's' : ''} removed`);
        }
        if (Date.now() >= m.restockAt) {
          m.uses = [];
          this.ownSold.delete(v.name);
          m.restockAt = Date.now() + this.restockMs();
          // (#21, MC_LETTERS: the whole list again, so a saved merchant gains the offers appended since it was summoned)
          if (LETTERS) for (const c of offersCommands(sel.replace(']', ',limit=1]'), m.uses)) await this.rcon.command(c);
          else for (const [i] of OFFERS.entries()) await this.rcon.command(`data modify entity ${sel.replace(']', ',limit=1]')} Offers.Recipes[${i}].uses set value 0`);
          this.villages.save();
          console.log(`[merchant] ${v.name}: restocked (next in ${Math.round(this.restockMs() / 60000)} min)`);
        }
      } catch (e) {
        console.error(`[merchant] ${v.name}: RCON failed:`, (e as Error).message);
      } finally {
        this.merchantBusy.delete(v.name);
      }
    })();
  }

  /**
   * s42 (#73): the merchant's orders at a restock: open ones a restock older, expired after ORDER_EXPIRE_RESTOCKS (logged, a
   * candidate for the foundry later); then new ones up to its level's number, for goods the workshop makes and the
   * merchant does not buy already, whose batch takes at most the level's raw materials, paid by orderPay. A stable pick by
   * the order's number: a run repeats.
   */
  private merchantOrders(v: Village, now: number, aged: boolean) {
    const m = v.merchant!;
    const orders = (m.orders ??= []);
    for (const o of orders)
      if (o.state === 'open' && aged && ++o.restocks >= ORDER_EXPIRE_RESTOCKS) {
        o.state = 'expired';
        o.end = now;
        console.log(`[merchant] ${v.name}: order ${o.id} (${o.n} ${o.item} for ${o.emeralds} emeralds) expired unfilled after ${o.restocks} restocks`);
      }
    const level = levelOf(m.xp ?? 0);
    const open = orders.filter((o) => o.state === 'open');
    const bought = new Set(OFFERS.filter((o) => o.dir === 'buys').map((o) => o.item));
    const cands = this.goodsFor(v).filter((g) => !g.food && !g.rung && !bought.has(g.item) && !open.some((o) => o.item === g.item))
      .map((g) => ({ g, n: g.batch * ORDER_SIZE, raw: this.orderRaw(g.item, g.batch * ORDER_SIZE) })).filter((c) => c.raw > 0 && c.raw <= ORDER_RAW_CAP[level] * ORDER_SIZE);
    for (let k = open.length; k < ordersOpen(level) && cands.length; k++) {
      const c = stablePick(cands, `${v.name}|${(m.orderN ?? 0) + 1}`)!;
      cands.splice(cands.indexOf(c), 1);
      const o: MerchantOrder = { id: `o${(m.orderN = (m.orderN ?? 0) + 1)}`, item: c.g.item, n: c.n, emeralds: orderPay(c.raw), raw: c.raw, at: now, restocks: 0, state: 'open' };
      orders.push(o);
      console.log(`[merchant] ${v.name}: order ${o.id}: ${o.n} ${o.item} for ${o.emeralds} emeralds (${o.raw} raw materials; level ${level}, ${m.xp ?? 0} emeralds traded)`);
      this.villages.note(v, `The merchant orders ${o.n} ${o.item.replace(/_/g, ' ')} for ${o.emeralds} emeralds`);
    }
    if (orders.length > 40) m.orders = [...orders.filter((o) => o.state === 'open'), ...orders.filter((o) => o.state !== 'open').slice(-30)];
    this.villages.save();
  }

  /** The raw materials n of a good take (the planner's gather from nothing), 0 when it cannot be planned. */
  private orderRaw(item: string, n: number): number {
    try {
      const p = this.materials.plan({ [item]: n }, {});
      return p.problems.length ? 0 : Object.values(p.gather).reduce((s, q) => s + q, 0);
    } catch {
      return 0;
    }
  }

  /** s42: the open order for an item, if any (the trade skill fills it). */
  merchantOrder(v: Village, item: string): MerchantOrder | undefined {
    return ORDERS_ON ? v.merchant?.orders?.find((o) => o.state === 'open' && o.item === item) : undefined;
  }

  /** s42: an order filled (the trade skill's call, after it charged both sides): the record, the ledger, the level's XP. */
  merchantFilled(v: Village, id: string, member: string) {
    const m = v.merchant, o = m?.orders?.find((x) => x.id === id);
    if (!m || !o || o.state !== 'open') return;
    Object.assign(o, { state: 'filled', by: member, end: Date.now() });
    const l = (m.ledger[o.item] ??= { bought: 0, sold: 0 });
    l.bought += o.n;
    const was = levelOf(m.xp ?? 0);
    m.xp = (m.xp ?? 0) + o.emeralds;
    this.villages.save();
    console.log(`[merchant] ${v.name}: ${member} fills order ${o.id}: ${o.n} ${o.item} for ${o.emeralds} emeralds${levelOf(m.xp) > was ? `; the merchant reaches level ${levelOf(m.xp)}` : ''}`);
  }

  private restockMs(): number {
    return (MERCHANT_RESTOCK_MIN * 60000) / timeScale();
  }

  /**
   * What storage keeps of a good before the merchant may have it (the check's F3): the workshop's target and a batch, the
   * food target (no food at all while the food flow is short), wheat for bread (3 a missing bread) and its own keep, logs
   * the logs' keep and 64 for initiatives' bills; anything else 16.
   */
  sellKeep(v: Village, item: string, store: Counts = storageContents(v)): number {
    const goods = this.goodsFor(v);
    const g = goods.find((x) => x.item === item);
    if (g?.food) return v.foodFlow?.short ? Infinity : this.makeTarget(v, g) + g.batch;
    if (g) return this.makeTarget(v, g) + g.batch;
    if (item === 'wheat') {
      const bread = goods.find((x) => x.item === 'bread');
      const missing = bread ? Math.max(0, this.makeTarget(v, bread) - (store.bread ?? 0)) : 0;
      return v.foodFlow?.short ? Infinity : this.foodKeep(v, 'wheat', store) + 3 * missing;
    }
    if (/_log$/.test(item)) return this.logsKeep(v) + 64;
    return 16;
  }

  /**
   * The merchant's offer a member would take now (spec_shop_v2's lib:sell and lib:buy, picked in code): selling, the good
   * storage holds most above its sellKeep (in whole lots, at most `maxTimes`) among those the merchant still buys; buying,
   * the sold item furthest below its keep (`keepOf`) that storage's spare emeralds pay for. With the offer's index in OFFERS
   * and the times; or why there is none.
   */
  merchantPick(v: Village, dir: 'buys' | 'sells', spare: Counts, keepOf: (item: string) => number, maxTimes = 4): { offer: MerchantOffer; index: number; times: number; order?: string } | { why: string } {
    const m = v.merchant;
    if (!MERCHANT_ON || !m) return { why: 'no merchant' };
    // (s42: an open order storage can fill comes first; index -1, the trade skill finds it by item)
    if (dir === 'buys' && ORDERS_ON)
      for (const o of m.orders ?? []) if (o.state === 'open' && (spare[o.item] ?? 0) >= o.n) return { offer: { item: o.item, n: o.n, emeralds: o.emeralds, stock: 1, dir: 'buys' }, index: -1, times: 1, order: o.id };
    const store = storageContents(v);
    let best: { offer: MerchantOffer; index: number; times: number; score: number } | null = null;
    for (const [i, o] of OFFERS.entries()) {
      if (o.dir !== dir) continue;
      const left = o.stock - (m.uses[i] ?? 0);
      if (left <= 0) continue;
      if (dir === 'buys') {
        const over = (spare[o.item] ?? 0) - this.sellKeep(v, o.item, store);
        const times = Math.min(left, maxTimes, Math.floor(over / o.n));
        if (times >= 1 && (!best || over > best.score)) best = { offer: o, index: i, times, score: over };
      } else {
        // (only what something in the village uses: F259's run bought slime balls and ender pearls for nothing)
        if (!this.merchantUses(v).has(o.item)) continue;
        const short = keepOf(o.item) - (store[o.item] ?? 0);
        const times = Math.min(left, maxTimes, Math.ceil(short / o.n), Math.floor((spare.emerald ?? 0) / o.emeralds));
        if (short > 0 && times >= 1 && (!best || short > best.score)) best = { offer: o, index: i, times, score: short };
      }
    }
    if (!best) return { why: dir === 'buys' ? 'nothing above its keep the merchant buys' : (spare.emerald ?? 0) ? 'nothing wanted' : 'no emeralds' };
    // (selling stops once storage holds what buying would spend: emeralds nobody spends are a surplus too, lesson 149)
    if (dir === 'buys' && (store.emerald ?? 0) >= this.emeraldKeep(v, keepOf, store)) return { why: 'enough emeralds' };
    return { offer: best.offer, index: best.index, times: best.times };
  }

  /** The emeralds storage keeps for buying: what the used sold items below their keep would cost, at least 4 (spec_shop_v2). */
  emeraldKeep(v: Village, keepOf: (item: string) => number, store: Counts = storageContents(v)): number {
    let e = 0;
    const uses = this.merchantUses(v);
    for (const o of OFFERS) if (o.dir === 'sells' && uses.has(o.item)) e += Math.ceil(Math.max(0, keepOf(o.item) - (store[o.item] ?? 0)) / o.n) * o.emeralds;
    return Math.max(4, e);
  }

  /**
   * #21 (MC_LETTERS, spec 9 S1): what storage keeps of a good the merchant sells while letters is current, for the trade
   * skill's buys and sales (emeraldKeep): leather, until stage 2 is counted the leather it still wants on top of what
   * storage holds, then what the books still to bind take; sugar cane, a start's 6 while no slot farms cane. Undefined
   * otherwise (the trade's own keeps).
   */
  tradeKeep(v: Village, item: string): number | undefined {
    if (!lettersCurrent(v)) return undefined;
    const store = storageContents(v);
    const farmed = (v.layouts ?? []).some((l) => (l.slots ?? []).some((q) => q.kind === 'sugar_cane'));
    if (item === 'leather') {
      // (the cane farm's seed first: im2_mine's 5 emeralds spent on leather would leave the start a cane short)
      if (!farmed && (store.sugar_cane ?? 0) < SLOT_KINDS.sugar_cane.count) return store.leather ?? 0;
      // (#134, MC_LETTERS_PACE: the cane slots' stalks before leather too, while storage holds less cane than they lack)
      if (LETTERS_PACE && farmed && (store.sugar_cane ?? 0) < CANE_FULL - this.caneStalks(v)) return store.leather ?? 0;
      const st = v.ladder!;
      const counted = st.totals?.leather ?? 0, books = st.totals?.books ?? 0;
      return st.stage <= 1 ? (store.leather ?? 0) + Math.max(0, LETTERS_BOOKS - counted) : Math.max(0, LETTERS_BOOKS - books);
    }
    // (#134, MC_LETTERS_PACE: until the cane slots hold a slot's 14 stalks, the stalks still to plant; a start's 14 before)
    if (item === 'sugar_cane') return LETTERS_PACE ? (farmed ? Math.max(0, CANE_FULL - this.caneStalks(v)) : CANE_FULL) : farmed ? 0 : SLOT_KINDS.sugar_cane.count;
    return undefined;
  }

  /** #134: the cane stalks the village's cane slots hold (their planted cells), all slots together. */
  caneStalks(v: Village): number {
    let n = 0;
    for (const l of v.layouts ?? []) for (const q of l.slots ?? []) if (q.kind === 'sugar_cane' && !q.laying) n += q.cells?.length ?? q.planted ?? 0;
    return n;
  }

  /**
   * #134 (MC_LETTERS_PACE): the cane a visit to a cane slot plants from storage now: while letters is current and the cane
   * slots hold fewer than CANE_FULL stalks in all, up to the slot's empty cells and the shortfall, from what storage holds;
   * 0 otherwise. The harvest skill withdraws it (mcBuild.ts harvestSlot); the menu offers a visit on it with nothing ripe.
   */
  caneTopUp(v: Village, slot: { kind?: string; laying?: unknown; cells?: Array<[number, number]>; planted?: number }): number {
    if (!LETTERS_PACE || !lettersCurrent(v) || slot.kind !== 'sugar_cane' || slot.laying) return 0;
    const empty = CANE_FULL - (slot.cells?.length ?? slot.planted ?? 0);
    const short = CANE_FULL - this.caneStalks(v);
    return Math.max(0, Math.min(empty, short, storageContents(v).sugar_cane ?? 0));
  }

  /** #134: when each village's posted market stall was last looked at (once a minute). */
  private stallAt = new Map<string, number>();

  /**
   * #134 (MC_LETTERS_PACE, with MC_MERCHANT): once the village is complete, its first market stall is posted as a village
   * work (an initiative of the village's, its steps ranked high on every member's menu) instead of waiting on a member's
   * own (W4's came at minute ~96, the merchant at ~106). One a village, open or built; posted again if it fails or lapses.
   */
  private postStall(v: Village) {
    const now = Date.now();
    if ((this.stallAt.get(v.name) ?? 0) > now) return;
    this.stallAt.set(v.name, now + 60000);
    if (v.merchant || !v.storageHut || !CHOOSE.families.has('initiatives')) return;
    if ((v.initiatives ?? []).some((i) => i.kind === 'market_stall' && (i.state === 'open' || i.state === 'built'))) return;
    const k = smallWorkKind('market_stall');
    if (!k) return;
    const wood = this.catalogWoodOf(v);
    const spot = this.smallWorkSpot(v, k, wood, STALL_BY);
    if (!spot) return console.log(`[initiative] ${v.name}: no spot for the village's market stall yet`);
    const design = k.make((WOOD_VARIANTS && hoodWoodAt(v, spot.x, spot.z)) || wood);
    if (!this.initiativeStep(v, { id: '_new', design: design.name }, this.makeSpare(v, STALL_BY), new Set(), design)) return console.log(`[initiative] ${v.name}: the village's market stall waits (nothing to gather for it now)`);
    if (!v.designs[design.name]) v.designs[design.name] = design;
    const it: Initiative = { id: `i${(v.initiativeN = (v.initiativeN ?? 0) + 1)}`, by: STALL_BY, kind: k.kind, design: design.name, x: spot.x, y: spot.y, z: spot.z, at: now, state: 'open', crew: [], steps: [] };
    v.initiatives = [...(v.initiatives ?? []), it];
    this.villages.note(v, `The village posts a market stall at ${spot.x},${spot.z} (${it.id}): a merchant comes to the first one built`);
    this.villages.save();
    console.log(`[initiative] ${v.name}: the village posts ${it.id}, a ${k.words} (${design.name}) at ${spot.x},${spot.y},${spot.z}`);
  }

  /** A built structure's placement: the Build task that put it here, its centre and quarter turns (L4: rotate is in
   *  degrees), matched by its corner; null when no done task placed it. */
  private structurePlace(v: Village, st: Village['structures'][number], d: Design): SignPlace | null {
    for (const t of v.tasks) {
      const mm = t.status === 'done' ? /^build_design "([^"]+)" x=(-?\d+) z=(-?\d+)(?: rotate=(-?\d+))?/.exec(t.detail) : null;
      if (!mm || mm[1] !== st.kind) continue;
      const rot = ((Math.round(Number(mm[4] ?? 0) / 90) % 4) + 4) % 4;
      const W = rot % 2 ? d.depth : d.width, D = rot % 2 ? d.width : d.depth;
      const x = Number(mm[2]), z = Number(mm[3]);
      if (x - Math.floor(W / 2) !== st.x1 || z - Math.floor(D / 2) !== st.z1) continue;
      return { design: d, x, z, rot, ...(/_meeting_point_/.test(d.name) ? { noSign: true } : {}) };
    }
    return null;
  }

  /**
   * #21 (MC_LETTERS, spec 9 S3): the library the letters rung shelves and its cells: the one recorded (v.library), else
   * the first-built plains_library_2, else the first built structure with vanilla shelf cells; its 4 shelf cells and its
   * lectern's (mcLibrary.ts libraryCells), those not done or never still open. Null when the village has none.
   */
  libraryPlan(v: Village): { structure: Village['structures'][number]; place: SignPlace; label: string; cells: LibraryCell[]; open: LibraryCell[] } | null {
    const r = libraryOf(v);
    const sts = r ? v.structures.filter((q) => q.id === r.structure) : [...v.structures.filter((q) => q.kind === 'plains_library_2'), ...v.structures.filter((q) => q.kind !== 'plains_library_2')];
    for (const st of sts) {
      const d = v.designs[st.kind];
      const shelves = d ? vanillaShelves(d) : null;
      if (!d || !shelves?.some((c) => c.block === 'bookshelf')) continue;
      const place = this.structurePlace(v, st, d);
      if (!place) continue;
      const cells = libraryCells(place, shelves, st.y);
      const shut = new Set([...(r?.done ?? []), ...(r?.never ?? [])]);
      return { structure: st, place, label: signLabel(d.name, true).join(' ').toLowerCase() || 'library', cells, open: cells.filter((c) => !shut.has(cellKey(c))) };
    }
    return null;
  }

  /** An option's feed alias for the ladder (ladder.ts feedsStage): what it runs where its id does not say, a slot's crop
   *  (`slot:sugar_cane`), a start's, the item a trade would buy (`activity:lib:buy:leather`). */
  private feedAlias(o: ChoiceOption): string | undefined {
    const d = OPTION_RUN.get(o);
    if (d?.kind === 'slot' || d?.kind === 'start') return `${d.kind}:${d.slotKind}`;
    if (d?.kind === 'activity' && d.spec.id === 'lib:buy' && typeof d.args.item === 'string') return `${o.id}:${d.args.item}`;
    return undefined;
  }

  /**
   * The merchant's goods something in the village uses now (F259: lib:buy spent every emerald on string, bones, gunpowder,
   * slime balls and an ender pearl nothing used): the library activities' needs (fishing's rod) and the houses' open
   * furniture. Bills of builds and the workshop's goods take only easy materials, so they add none today.
   */
  merchantUses(v: Village): Set<string> {
    const out = new Set<string>();
    for (const sp of this.library.specs) for (const n of Object.keys(sp.needs ?? {})) out.add(n);
    // (#21, MC_LETTERS: leather while the rung's books want it, cane while no slot farms it, spec 9 B1)
    if (lettersCurrent(v)) for (const n of ['leather', 'sugar_cane']) if ((this.tradeKeep(v, n) ?? 0) > 0) out.add(n);
    try {
      if (CHOOSE.families.has('furnish')) for (const n of Object.keys(this.decorDemand(v))) out.add(n);
    } catch {
      // (furniture spots unreadable: none)
    }
    return out;
  }

  /** A trade done (the trade skill's call, after it charged both sides on the server): the offer's uses on the record and
   *  the entity, the ledger, a line. */
  async merchantTraded(v: Village, index: number, times: number, member: string): Promise<void> {
    const m = v.merchant, o = OFFERS[index];
    if (!m || !o) return;
    m.uses[index] = (m.uses[index] ?? 0) + times;
    // (s42: the emeralds traded are the merchant's XP, its level for orders)
    m.xp = (m.xp ?? 0) + o.emeralds * times;
    const l = (m.ledger[o.item] ??= { bought: 0, sold: 0 });
    if (o.dir === 'buys') l.bought += o.n * times;
    else l.sold += o.n * times;
    this.villages.save();
    console.log(`[merchant] ${v.name}: ${member} ${o.dir === 'buys' ? `sells ${o.n * times} ${o.item} for ${o.emeralds * times} emerald` : `buys ${o.n * times} ${o.item} for ${o.emeralds * times} emerald`}${o.emeralds * times === 1 ? '' : 's'}`);
    const sel = `@e[type=minecraft:villager,tag=${MERCHANT_TAG},tag=${villageTag(v.name)},limit=1]`;
    await this.rcon.command(`data modify entity ${sel} Offers.Recipes[${index}].uses set value ${Math.min(o.stock, m.uses[index])}`).catch(() => '');
  }

  private initiativeTick(v: Village) {
    const now = Date.now();
    this.claimStoredSurplus(v);
    for (const it of v.initiatives ?? []) {
      if (it.state === 'built' && it.kind === 'signpost' && !it.text) this.nameSignpost(v, it);
      if (it.state !== 'open') continue;
      // (a green ready: the spot on it, s36)
      if (it.pending) {
        const green = v.plots.find((p) => p.green === it.id);
        const k = smallWorkKind(it.kind);
        const d = v.designs[it.design];
        if (green && k && d) {
          // (its own green's reservation is not in the way: prepare_green holds it until prepareSite has deposited the
          // felled logs, after the plot is recorded; N1m's i5 failed on it, s36)
          const own = `prepare a green for ${it.id}`;
          const blocked = this.smallBlocked(v).blocked.filter((q) => (q as { purpose?: string }).purpose !== own);
          const spot = smallWorkSpots({ plots: [{ x1: green.x1, z1: green.z1, x2: green.x2, z2: green.z2, y: green.y }], blocked }, d.width, d.depth, 1)[0];
          // (and no verdict while its preparer is still at work)
          if (!spot && this.choreKeys(v).has(`initiative:${it.id}:prepare`)) continue;
          if (!spot) {
            this.endInitiative(v, it, 'failed', `no spot for it on its green at ${green.x1},${green.z1}`);
            continue;
          }
          Object.assign(it, { x: spot.x, y: spot.y, z: spot.z });
          delete it.pending;
          this.villages.save();
          console.log(`[initiative] ${v.name}: ${it.id}'s green is ready: its ${k.words} goes at ${spot.x},${spot.y},${spot.z}`);
        }
      }
      if (!it.pending && v.structures.some((st) => st.kind === it.design && it.x >= st.x1 && it.x <= st.x2 && it.z >= st.z1 && it.z <= st.z2)) {
        this.endInitiative(v, it, 'built', 'it stands');
        continue;
      }
      const last = Math.max(it.at, ...it.steps.map((q) => q.at));
      // (not while its green is being prepared: a slow preparer must not let a second green open, s36's review L2)
      if (it.pending && now - last > INITIATIVE_LAPSE_MS && this.choreKeys(v).has(`initiative:${it.id}:prepare`)) continue;
      if (now - last > INITIATIVE_LAPSE_MS) this.endInitiative(v, it, 'lapsed', `no step for ${Math.round(INITIATIVE_LAPSE_MS / 60000)} min`);
    }
  }

  /** N.1: the furniture the village wants, read once a menu for needOf (s36's review L1). */
  private needDemand(v: Village): Counts {
    return CHOOSE.families.has('furnish') ? this.decorDemand(v) : {};
  }

  /** N.1: the need an option answers, directly or by making what answers it (spec_needs_v2 B), or null. */
  private needOf(v: Village, o: { kind: ChoiceKind; id: string }, demand: Counts): NeedKind | null {
    if (o.kind === 'light' || o.id === 'make:torch') return 'light';
    if (o.kind === 'grow') return 'housing';
    if (o.kind === 'furnish' || (o.kind === 'make' && (demand[o.id.slice(5)] ?? 0) > 0)) return 'furnish';
    if (appetiteOn(v) && isFoodKind(o.kind, o)) return 'food';
    return null;
  }

  /** N.1: what the last sweep's menus showed of each need, for the next needTick: offered to an idle member, taken, or
   *  none offered with the direct kind's reason. */
  private needSeen = new Map<string, { offered: Set<NeedKind>; taken: Set<NeedKind>; blocked: Map<NeedKind, string> }>();
  private needAt = new Map<string, number>();
  private needReadings = new Map<string, NeedReading[]>();

  /** N.1: a sweep's menu and pick noted for the needs (show and on). */
  private needNote(v: Village, menu?: ChoiceMenu, ran?: ChoiceOption) {
    if (NEEDS_MODE === 'off') return;
    const seen = this.needSeen.get(v.name) ?? { offered: new Set(), taken: new Set(), blocked: new Map() };
    this.needSeen.set(v.name, seen);
    // (taken: an option that answers it ran, by either chooser, noted by runOption)
    const demand = this.needDemand(v);
    const t = ran && this.needOf(v, ran, demand);
    if (t) seen.taken.add(t);
    if (!menu) return;
    for (const o of menu.options) {
      const k = this.needOf(v, o, demand);
      if (k) seen.offered.add(k);
      // (#1, MC_NEED_VOTE: the chores that answer it, for a need item's choices)
      if (k) noteNeedOffer(v.name, k, o);
    }
    // (s39: whether a free farm slot could be started, as the menu says: a slot no kind can be found for answers nothing)
    if (NEED_WORKS) this.startSeen.set(v.name, menu.options.some((o) => o.kind === 'start') ? '' : menu.reasons.start ?? '');
    const direct: Array<[NeedKind, ChoiceKind]> = [['light', 'light'], ['furnish', 'furnish'], ['food', 'eat'], ...(HOUSING ? [['housing', 'grow'] as [NeedKind, ChoiceKind]] : [])];
    for (const [k, kind] of direct) {
      const why = menu.reasons[kind];
      // (busy: another member is on it; hungry: this member's menu only; neither blocks the need)
      // (nor a housed member's "has a house", nor a street under way: the review's L3)
      if (why && !NOT_BLOCKING.has(why) && !seen.blocked.has(k)) seen.blocked.set(k, why);
    }
  }

  /** N.1: a village's needs read and stepped, once per NEED_TICK_MS, whether or not anyone is idle (spec_needs_v2 B);
   *  `[need]` on a status change. Never from choices() or a menu (board_golden, the purity check). */
  private needTick(v: Village) {
    const now = Date.now();
    const last = this.needAt.get(v.name);
    if (last !== undefined && now - last < NEED_TICK_MS) return;
    this.needAt.set(v.name, now);
    const members = this.growMembers(v);
    const lights = this.lightParts(v).filter((p) => p.kind === 'building');
    const decor = CHOOSE.families.has('furnish') ? this.decorParts(v) : [];
    const faces = v.mine ? mineFaces(v, (n) => this.agents.has(n.toLowerCase())) : null;
    const readings = readNeeds({
      members: members.length,
      // (N.2: members housed, a house being built for them included, H10)
      houses: HOUSING ? members.length - this.homeless(v).length : housesOf(v),
      ...(lights.length ? { unlit: lights.reduce((s, p) => s + p.unlit, 0), spots: lights.reduce((s, p) => s + p.spots.length, 0), unlitParts: lights.filter((p) => p.unlit > 0).length } : {}),
      ...(decor.length ? { openDecor: decor.reduce((s, p) => s + p.open.length, 0), decorSpots: decor.reduce((s, p) => s + p.spots.length, 0), openDecorParts: decor.filter((p) => p.open.length).length } : {}),
      ...(appetiteOn(v) ? { hungry: members.filter((a) => stateOf(v.food!.members[a.name]?.level ?? 20) !== 'fed').length } : {}),
      // (s37 S1: slots used of the hut's, not chest spots: "9 of 9" had half its slots free)
      ...(v.storageHut ? (() => { const st = storageSlots(v, this.registry as never); return { slots: st.used, slotCap: st.cap, chests: st.chests, chestSpots: st.spots }; })() : {}),
      ...(faces && faces.faces ? { mineHeld: faces.held, mineFaces: faces.faces } : {}),
      ...(v.mine && !mineCanGive(v, 'cobblestone') ? { mineBlocked: 'it gives no stone' } : {}),
    });
    // (s39, MC_NEED_WORKS: the food flow, its level the net drain's share; answered by targets, slots and a farmstead)
    if (NEED_WORKS && appetiteOn(v)) {
      const fr = foodflowReading(v.foodFlow, storedPoints(storageContents(v)));
      if (fr) readings.push({ kind: 'foodflow', level: fr.level, amount: Math.round(fr.level * 100), text: fr.text.slice(0, 80) });
    }
    // (s40, F256: the mine trend, cells dug per game hour and hours of mine left; a gauge, nothing answers it yet)
    if (v.mine) {
      const wallMs = last === undefined ? 0 : Math.min(2 * NEED_TICK_MS, now - last);
      const dug = v.mineFlow?.dugSeen === undefined ? 0 : Math.max(0, v.mine.dug - v.mineFlow.dugSeen);
      v.mineFlow = { ...addMineFlow(v.mineFlow, this.gameMinutes(wallMs), dug), dugSeen: v.mine.dug };
      const mr = mineflowReading(v.mineFlow, mineCellsLeft(v.mine));
      if (mr) readings.push({ kind: 'mineflow', level: mr.level, amount: Math.round(mr.hours * 10) / 10, text: mr.text.slice(0, 80) });
    }
    this.needReadings.set(v.name, readings);
    const seen = this.needSeen.get(v.name);
    this.needSeen.delete(v.name);
    const states = (v.needStates ??= {});
    let changed = false;
    for (const r of readings) {
      const answerable = r.kind === 'light' || r.kind === 'furnish' || r.kind === 'food' || r.kind === 'foodflow' || (HOUSING && r.kind === 'housing');
      const prev = states[r.kind];
      const next = stepNeed(prev, r, last === undefined ? 0 : now - last, {
        offered: !!seen?.offered.has(r.kind), taken: !!seen?.taken.has(r.kind),
        ...(seen && !seen.offered.has(r.kind) && seen.blocked.has(r.kind) ? { blocked: seen.blocked.get(r.kind) } : {}),
      }, answerable);
      states[r.kind] = next;
      // (#1, MC_NEED_VOTE: the status since when, for the council's agenda)
      noteNeedStatus(v.name, r.kind, next.status, r.text, now);
      if (prev?.status !== next.status) {
        changed = true;
        console.log(`[need] ${v.name}: ${r.kind} ${prev?.status ?? 'new'} -> ${next.status} (level ${next.level.toFixed(2)}: ${r.text}${next.why ? `; ${next.why}` : ''})`);
      }
    }
    for (const k of Object.keys(states)) if (!readings.some((r) => r.kind === k)) {
      delete states[k];
      changed = true;
    }
    if (changed) this.villages.save();
  }

  /** N.1: a village's needs for the API and panel (null for an unknown village). */
  needsView(name: string) {
    // (the registry is keyed by the lower-cased name)
    const v = this.villages.villages.get(name.toLowerCase());
    if (!v) return null;
    const texts = new Map((this.needReadings.get(v.name) ?? []).map((r) => [r.kind, r.text]));
    return {
      village: v.name, mode: NEEDS_MODE,
      needs: Object.fromEntries(Object.entries(v.needStates ?? {}).map(([k, s]) => [k, { ...s, text: texts.get(k as NeedKind) ?? '' }])),
    };
  }

  /** Growth stopped for good (logged once). */
  private growStop(v: Village, why: string) {
    const g = (v.growth ??= { past: [] });
    if (g.stop) return;
    g.stop = why;
    this.villages.note(v, `the village stops growing: ${why}`);
    this.villages.save();
    console.log(`[grow] ${v.name}: stopped: ${why}`);
  }

  /**
   * The growth chore failed (D14): a stop or removal is nobody's fault; "no site" stops growth on its second answer at
   * least 5 minutes after the first (one survey of unloaded chunks must not end it) and backs off 5 minutes on the first;
   * anything else backs off 2 minutes and stops after 5 in a row.
   */
  private growFailed(v: Village, by: string, why: string) {
    if (why === 'cancelled') return;
    const g = (v.growth ??= { past: [] });
    const now = Date.now();
    let wait = 2;
    if (/^lay_out_houses: no free \d+x\d+ site/.test(why)) {
      const first = g.noSite?.[0];
      g.noSite = [...(g.noSite ?? []), { at: now, by }].slice(-5);
      if (first && now - first.at >= 5 * 60000) return this.growStop(v, `no site within ${GROW.range} blocks`);
      wait = 5;
    } else {
      g.tries = (g.tries ?? 0) + 1;
      if (g.tries >= 5) {
        this.growStop(v, `the layout chore failed ${g.tries} times (${why.slice(0, 120)})`);
        // (and a back-off all the same: growStop writes nothing when growth had stopped already, and a chore failing every
        // 30 s ran on, the X.2 review's 2)
        g.backoff = now + 10 * 60000;
        this.villages.save();
        return;
      }
    }
    g.backoff = now + wait * 60000;
    this.villages.save();
    console.log(`[grow] ${v.name}: chore failed: ${why.slice(0, 200)}; next try after ${wait} min`);
  }

  /**
   * A neighbourhood watched to its end (s30, D13, D14; every growTick while it is on the board). Claims nobody holds any
   * more are given back (below). A hard-failed prepare ends it at once (L4: every build waits for it). A failed house's
   * gathering is closed; once every build is done or failed, the gathering and making nothing open waits for are closed and
   * the signs of failed houses failed; once nothing is open or held, it ends. Stuck: open tasks, none held, none claimable
   * (or no worker able to claim), no change for 10 minutes; with every house built that still ends as built. A layout that
   * built every house resets the failures; one that did not backs off 10 minutes a failure, and three in a row stop growth.
   */
  private growEnd(v: Village, now: number) {
    const g = v.growth!, act = g.active!;
    const reg = this.villages;
    const mine = v.tasks.filter((t) => taskNum(t) >= act.from);
    // Claims nobody holds any more go back on the board: a holder no longer in the world (L3); one spawned again since it
    // claimed (agent memory is not kept: its new brain knows nothing of the task); one idle, on no chore, whose brain does
    // not hold the task, GROW_ORPHAN_CHECKS checks in a row. A claim so left stopped the layout's end and every later
    // neighbourhood for good (the review's L-3 and M2)
    for (const t of mine) {
      if (t.status !== 'claimed' || !t.claimedBy) continue;
      const id = t.claimedBy.toLowerCase(), h = this.agents.get(id), key = `${v.name}|${t.id}`;
      let gone: string | undefined;
      if (!h) gone = 'its holder is no longer in the world';
      else if (h.brain?.holdsTask?.(h, t.id) === true) this.growOrphan.delete(key);
      else if ((t.claimedAt ?? t.updated) < (this.spawnedAt.get(id) ?? 0)) gone = 'its holder was spawned again since it claimed it';
      else if (this.chores.has(id) || this.pending.has(id) || !h.idle()) this.growOrphan.delete(key);
      else {
        const n = (this.growOrphan.get(key) ?? 0) + 1;
        this.growOrphan.set(key, n);
        if (n >= GROW_ORPHAN_CHECKS) gone = `its holder has been idle without it for ${n} checks`;
      }
      if (!gone) continue;
      this.growOrphan.delete(key);
      reg.unclaim(v, t.id, t.claimedBy, gone);
      console.log(`[grow] ${v.name}: ${t.id} "${t.title}" handed back for ${t.claimedBy}: ${gone}`);
    }
    const close = (t: Task, status: 'done' | 'failed', why: string) => {
      t.status = status;
      t.result = why;
      t.updated = now;
      reg.note(v, `${t.id} "${t.title}" ${status === 'done' ? 'was not needed' : 'closed'}: ${why}`);
    };
    let why: 'built' | 'failed' | 'stuck' | undefined;
    let left = 0;
    const prep = mine.find((t) => /^Prepare the village plot/.test(t.title));
    if (prep?.status === 'failed') {
      for (const t of mine) if (t.status === 'open') close(t, 'failed', "cancelled: the neighbourhood's plot could not be prepared");
      why = 'failed';
    }
    const builds = act.builds.map((id) => reg.task(v, id)).filter((t): t is Task => !!t);
    // (what an open or held task still waits for stays: a lamps task put back behind new gathering when torches ran short
    // would be claimable again without them, the review's L-1)
    const waitedNow = () => new Set(v.tasks.filter((t) => t.status === 'open' || t.status === 'claimed').flatMap((t) => t.after));
    let waited = waitedNow();
    const gather = (t: Task) => !!t.soft && /^collect block=\S+ count=\d+, then deposit/.test(t.detail);
    // A failed house's own gathering is closed at once (stockCovers no longer counts that house, so its gathering stayed
    // claimable to the neighbourhood's end, the review's L7)
    if (!why)
      for (const b of builds)
        if (b.status === 'failed')
          for (const id of b.after) {
            const t = reg.task(v, id);
            if (t && t.status === 'open' && taskNum(t) >= act.from && gather(t) && !waited.has(t.id)) close(t, 'done', 'not needed: its house was not built');
          }
    if (!why && builds.every((t) => t.status === 'done' || t.status === 'failed')) {
      const failed = new Set(builds.filter((t) => t.status === 'failed').map((t) => t.id));
      const all = failed.size ? 'not needed: every house of the neighbourhood is built or failed' : 'not needed: every house of the neighbourhood is built';
      // (until nothing more closes: the windows' sand goes once their make is closed)
      for (let more = true; more; ) {
        more = false;
        waited = waitedNow();
        for (const t of mine) {
          if (t.status !== 'open') continue;
          if ((gather(t) || PARTS_MAKE.test(t.title) || PICK_SUPPLY.test(t.title)) && !waited.has(t.id)) close(t, 'done', all);
          else if (/^put_up_signs /.test(t.detail) && t.after.some((id) => failed.has(id))) close(t, 'failed', 'its house was not built');
          else continue;
          more = true;
        }
      }
    }
    // The stuck rule: the tasks' statuses as a signature, and when it last changed
    const sig = mine.map((t) => t.status[0]).join('');
    if (sig !== act.sig) {
      act.sig = sig;
      act.changed = now;
    }
    // (with no worker here able to claim, what is claimable counts for nothing: the workers left or none takes board tasks,
    // the review's lens 3 L1)
    if (!why && mine.some((t) => t.status === 'open') && !mine.some((t) => t.status === 'claimed') && now - act.changed >= GROW_STUCK_MS
      && (!this.growClaimers(v).length || !reg.claimable(v).some((t) => isGrowTask(v, t)))) {
      for (const t of mine)
        if (t.status === 'open') {
          close(t, 'failed', "cancelled: the neighbourhood's board is stuck");
          left++;
        }
      // (every house standing: the village grew as meant, and lamps or signs left are no failed layout, lens 3 L2)
      why = builds.length && builds.every((t) => t.status === 'done') ? 'built' : 'stuck';
    }
    if (mine.some((t) => t.status === 'open' || t.status === 'claimed')) {
      // (saved only on a change: a save bumps the board's version, and every idle worker looks for a task again)
      if (act.changed === now) reg.save();
      return;
    }
    const built = builds.filter((t) => t.status === 'done').length, failed = builds.length - built;
    why ??= failed ? 'failed' : 'built';
    const lay = v.layouts?.[act.layout - 1];
    const M = this.growMembers(v).length, H = housesOf(v);
    g.past.push({ k: act.k, layout: act.layout, at: act.at, end: now, houses: builds.length, built, failed, members: act.members, why, ...(left ? { left } : {}), ...(act.style ? { style: act.style } : {}), ...(act.project ? { project: act.project } : {}) });
    // (X.2: a public work not built is never offered again)
    if (act.project && why !== 'built') g.projectBad = [...new Set([...(g.projectBad ?? []), act.project])];
    if (act.project) console.log(`[work] ${v.name}: public work ${act.project} ended ${why} in ${((now - act.at) / 60000).toFixed(1)} min`);
    delete g.active;
    for (const k of this.growOrphan.keys()) if (k.startsWith(`${v.name}|`)) this.growOrphan.delete(k);
    if (act.project) {
      // (a public work's failures are projects' own: house growth keeps its counters, the review's 3)
      if (why === 'built') delete g.projectFails;
      else {
        g.projectFails = (g.projectFails ?? 0) + 1;
        g.projectBackoff = now + 10 * 60000 * g.projectFails;
      }
    } else if (why === 'built') delete g.fails;
    else {
      g.fails = (g.fails ?? 0) + 1;
      g.backoff = now + 10 * 60000 * g.fails;
    }
    reg.note(v, act.project ? `the public work ${act.project} ended (${why})` : `neighbourhood ${act.k} ended (${why}): ${built} of ${builds.length} houses built`);
    reg.save();
    const signs = lay?.signs ? (lay.signed ? lay.signs.length : lay.signs.filter((s) => s.up).length) : 0;
    console.log(`[grow] ${v.name}: layout ${act.layout} ended ${why} in ${((now - act.at) / 60000).toFixed(1)} min: built ${built} of ${builds.length} houses, signs ${signs}, lamps ${lay?.lit ? 'lit' : 'not'}; houses ${H} for ${M} members${left ? `; ${left} tasks left open` : ''}`);
    if ((g.fails ?? 0) >= 3) this.growStop(v, `${g.fails} neighbourhoods in a row ended without every house built`);
  }

  /**
   * Chores under way, by agent (lower-cased name; F193, 10-09: one chore an agent, so a second idle worker and the mayor
   * take chores of other kinds at the same time). `key` names what the chore works on: `slot:k:j`, `farm:k`, `start`,
   * `annex`, `pen`, `iron` or `explore` (A.2's instances: `explore:i`, `start:k:j`, and further keys in `choice.holds`;
   * S.9's `works`, `worksfurnace:k`, `make:<item>` holding `furnace:k` when it smelts, `gather:<material>:<n>`);
   * no two chores of a village hold the same key (the skills' own locks are taken only when an action runs, so a key also
   * covers the time it waits in the queue).
   */
  private chores = new Map<string, ChoreEnd & { key: string; what: string }>();
  /** Keys of chores just ended, by "village|key", held until the time given. */
  private cooling = new Map<string, number>();
  /** Kinds with no sighting in range, by "village:kind": not searched for again until then. */
  private slotSkip = new Map<string, number>();
  /** When the cake was last tried, by village (a back-off). */
  private cakeAt = new Map<string, number>();
  /** S.9's back-offs: failed makes by "village:item" (10 minutes, an hour after 3), gathering by "village:material" (until),
   *  a works furnace by "village:k" (until); and the logs gathering deposited, by village (the hourly cap). */
  private makeBack = new Map<string, { tries: number; at: number }>();
  private gatherBack = new Map<string, number>();
  private worksBack = new Map<string, number>();
  /** B.4: a failed light chore backs its part off, by "village:part" (until); and the demand last logged, by village. */
  private lightBack = new Map<string, number>();
  /** X.1: a failed furnish chore backs its building off, by "village:part" (until). */
  private decorBack = new Map<string, number>();
  /** A works furnace a smelting make found no path to, by "village:k" (until; F233). */
  private furnaceBack = new Map<string, number>();
  /** A.3p: since when a disliked option has been left by members (by village|option id); anyone takes it after DECLINE_MS. */
  private declined = new Map<string, number>();
  private lightLogged = new Map<string, { sig: string; at: number }>();
  private gatherLog = new Map<string, Array<{ at: number; n: number }>>();
  /** A gathering's first "none found" answer, by "village:material": the material is marked unavailable only on a second
   *  from another agent at least GATHER_NONE_APART later (S.9's review, lens 4 M2). */
  private gatherNone = new Map<string, { agent: string; at: number }>();

  /**
   * The keys of a village's chores still under way (from the actions' own state: a stop fails them, lesson 67); finished
   * ones are dropped and a failure reported to their `failed` (reportFailed: in model mode endChoice did, at the end).
   */
  private choreKeys(v: Village): Set<string> {
    const keys = new Set<string>();
    for (const [k, until] of this.cooling)
      if (until < Date.now()) this.cooling.delete(k);
      else if (k.startsWith(`${v.name}|`)) keys.add(k.slice(v.name.length + 1));
    for (const [id, c] of this.chores) {
      if (c.village !== v.name) continue;
      // (the agents map is keyed by the lower-cased name: VanX2 sent a second explorer out while the first walked home)
      const going = c.status.some((q) => q.state === 'queued' || q.state === 'running');
      if (going && this.agents.has(id)) {
        keys.add(c.key);
        for (const h of c.choice.holds) keys.add(h);
        continue;
      }
      // (a stopped or removed agent's statuses fail at once while its skill's finally still runs its commands (a teleport,
      // the gate, the slot's lock): the key is held 10 s more, the design review's M3 and the diff review's L3; its further
      // keys with it, A.2)
      this.chores.delete(id);
      this.endChoice(c);
      this.cooling.set(`${v.name}|${c.key}`, Date.now() + 10000);
      for (const h of c.choice.holds) this.cooling.set(`${v.name}|${h}`, Date.now() + 10000);
      // (MC_QUICK_NEXT: a chore whose actions all finished, its agent here, leaves the member free at once)
      const finished = QUICK_NEXT && this.agents.has(id) && c.status.every((q) => q.state === 'done' || (q.state === 'failed' && !/stopped|cancel/i.test(q.message ?? '')));
      if (!finished) this.cooling.set(`agent|${id}`, Date.now() + 10000);
      this.reportFailed(c);
    }
    return keys;
  }

  /**
   * The keys a village's chores hold now, written nowhere (A.2). 'sweep' is what choreKeys would return at this moment
   * (cooled keys, then the keys of chores under way whose agent is here, with their further keys; chores it would drop
   * are not in it, nor the keys their drop would cool). 'async' (a pick checked after a model reply, an expiry or an API
   * call) also holds every chore that ended within 10 s, dropped or not: its keys and its agent (`agent|<id>`), which
   * closes the gap between a chore's end and the next sweep's drop (and a stop whose skill's finally still runs).
   */
  private heldKeys(v: Village, now: number, mode: 'sweep' | 'async'): Set<string> {
    const keys = new Set<string>();
    for (const [k, until] of this.cooling)
      if (until >= now && (k.startsWith(`${v.name}|`) || (mode === 'async' && k.startsWith('agent|')))) keys.add(k.startsWith('agent|') ? k : k.slice(v.name.length + 1));
    for (const [id, c] of this.chores) {
      if (c.village !== v.name) continue;
      const going = c.status.some((q) => q.state === 'queued' || q.state === 'running');
      if (going && this.agents.has(id)) {
        keys.add(c.key);
        for (const h of c.choice.holds) keys.add(h);
      } else if (mode === 'async' && now - (c.choice.endedAt ?? now) <= 10000) {
        keys.add(c.key);
        for (const h of c.choice.holds) keys.add(h);
        keys.add(`agent|${id}`);
      }
    }
    return keys;
  }

  private setChore(v: Village, worker: BotAgent, key: string, status: ActionStatus[], what: string, failed?: (why: string) => void, meta?: ChoiceMeta, holds: string[] = [], opt?: ChoiceOption) {
    const id = worker.name.toLowerCase();
    // (G8: the kinds of work a member takes, for the forge's recipients: a dig trip, milking and shearing by their ids)
    if (IRON_AGE && opt) {
      const wk = opt.id.startsWith('iron:dig') ? 'iron:dig' : /milk/.test(opt.id) ? 'milk' : /shear/.test(opt.id) ? 'shear' : opt.kind;
      const m = this.workKinds.get(id) ?? new Map<string, number>();
      m.set(wk, (m.get(wk) ?? 0) + 1);
      this.workKinds.set(id, m);
    }
    // (idleWorker never offers an agent holding a chore, so nothing is replaced; if one were, its end is logged)
    const old = this.chores.get(id);
    if (old) this.endChoice(old);
    const kind = (opt?.kind ?? key.split(':')[0]) as ChoiceKind;
    const choice: ChoiceState = { id: meta?.decisionId ?? choiceId(v.name), t: Date.now(), store: storageContents(v), carried: heldCounts(worker) ?? {}, ...(OWN.on || RULES.on ? { flow: storageFlow(worker.name) } : {}), ...(PAY.on ? { gross: storageGross(worker.name) } : {}), with: new Set(), holds, kind, option: opt?.id ?? key, name: opt?.name ?? choreName(key, what), decisionId: meta?.decisionId, walked0: worker.walked };
    if (opt?.kind === 'explore' && opt.at) {
      try {
        choice.point = { x: opt.at.x, z: opt.at.z, known0: this.atlas.known(opt.at.x, opt.at.z, 48) };
      } catch {
        // (measurement only)
      }
    }
    // (the village's chores under way meanwhile: their deposits show in this one's storage change, and its in theirs)
    for (const o of this.chores.values())
      if (o.village === v.name && !o.choice.ended) {
        o.choice.with.add(choice.id);
        choice.with.add(o.choice.id);
      }
    this.chores.set(id, { agent: worker.name, village: v.name, key, status, what, failed, choice });
    // (G1: what the member is doing now and why, for the panel and its memory)
    const intent = { kind, what: choice.name ?? what, why: meta?.reason ?? 'fixed order', since: choice.t, source: meta?.source ?? 'fixed' };
    worker.memory.intent = intent;
    noteIntent(v.name, worker.name, intent);
    // (G2: a member's own choices make its role, code's label)
    if ((meta?.source === 'model' || meta?.source === 'scripted') && (SOCIAL.mode !== 'legacy' || MEMORY.on)) noteChoice(v.name, worker.name, this.roleKindOf(v, kind, opt), choice.t);
    if (characterAny() && (meta?.source === 'model' || meta?.source === 'scripted')) noteDecision(v.name, worker.name, opt?.cf ?? 1);
    // (MC_WORK_BLOCKS: a decided choice opens a block of the same option; a block's own repeats keep it)
    // (only a decided choice opens one: the model's or the scripted controller's, or the fixed pick in fixed mode; IM1's rate
    // fallbacks opened blocks too, and fixed picks held most of the members' work for 6 minutes at a time)
    const decided = meta?.source === 'model' || meta?.source === 'scripted' || (meta?.source === 'fixed' && CHOOSE.mode === 'fixed');
    if (WORK_BLOCKS && opt && meta && decided && meta.reason !== 'work block' && opt.kind !== 'rest') this.blocks.set(id, { option: opt.id, until: choice.t + BLOCK_MS, from: meta.source });
    if (ACTS.on) actsStart(v.name, worker.name, choice.option ?? key, choice.id);
    if (RULES.on && opt?.takes) noteTakes(v.name, worker.name, opt.takes, choice.t);
    // The decision log (A.1; A.2 adds the menu the choice was made on and how it was decided). Chores before completion
    // (the wheat field and ripe slots) are still code-driven: no menu, `options` empty.
    const menu = meta?.menu;
    // (positions only for the model's own choice: a fallback ran a fixed pick from a fresh menu, and the ids the model was
    // shown are logged apart, `shownIds`)
    const shown = meta?.source === 'model' ? meta.shown : undefined;
    const options: ChoiceLogOption[] = (menu?.options ?? []).map((o) => ({
      id: o.id, kind: o.kind, key: o.key, name: o.name, facts: o.facts, effect: o.effect, rank: o.rank,
      ...(o.lp !== undefined ? { lp: o.lp } : {}), ...(o.tw !== undefined ? { tw: o.tw } : {}), ...(o.nw !== undefined ? { nw: o.nw } : {}), ...(o.ww !== undefined ? { ww: o.ww } : {}), ...(o.gw !== undefined ? { gw: o.gw } : {}), ...(o.iw !== undefined ? { iw: o.iw } : {}), ...(o.sw !== undefined ? { sw: o.sw } : {}), ...(o.social ? { social: o.social } : {}), ...(o.ruleTag ? { ruleTag: o.ruleTag } : {}), ...(o.vw !== undefined ? { vw: o.vw, ladderTag: o.ladderTag } : {}), ...(o.rw !== undefined ? { rw: o.rw } : {}), ...(o.basic ? { basic: true, ...(o.basicNeed ? { basicNeed: o.basicNeed } : {}) } : {}), ...(o.mark ? { mark: o.mark } : {}), ...(o.mw !== undefined ? { mw: o.mw } : {}), ...(o.fw !== undefined ? { fw: o.fw } : {}), ...(o.dw !== undefined ? { dw: o.dw } : {}), ...(o.cf !== undefined ? { cf: o.cf, pre: Math.round((o.tw ?? 1) * (o.nw ?? 1) * (o.ww ?? 1) * (o.gw ?? 1) * (o.iw ?? 1) * (o.sw ?? 1) * o.cf * 1000) / 1000 } : {}), ...(shown && shown.includes(o.id) ? { shown: shown.indexOf(o.id) + 1 } : {}),
    }));
    const position = opt && shown?.includes(opt.id) ? shown.indexOf(opt.id) + 1 : undefined;
    logChoice({
      id: choice.id, agent: worker.name, village: v.name, t: choice.t, key, what, kind, reason: meta?.reason ?? 'fixed order', options,
      ...(opt ? { chosen: opt.id } : {}), source: meta?.source ?? 'fixed', ...(meta?.why ? { why: meta.why } : {}),
      ...(position ? { position } : {}), ...(shown ? { shownCount: shown.length } : {}),
      ...(!shown && meta?.shown?.length ? { shownIds: meta.shown } : {}),
      ...(meta?.modelChose ? { modelChose: meta.modelChose, modelReason: meta.modelReason ?? '' } : {}),
      ...(meta?.reaskOf ? { reaskOf: meta.reaskOf } : {}),
      ...(meta?.backupOf ? { backupOf: meta.backupOf } : {}),
      ...(meta?.decisionId && meta.shown?.length ? { seed: `${meta.decisionId}|${worker.name}` } : {}),
      ...(meta?.model ? { model: meta.model } : {}), ...(meta?.latencyMs !== undefined ? { latencyMs: meta.latencyMs } : {}),
      ...(meta?.waitMs !== undefined ? { waitMs: meta.waitMs } : {}), ...(meta?.queueWaitMs !== undefined ? { queueWaitMs: meta.queueWaitMs } : {}),
      ...(meta?.promptTokens !== undefined ? { promptTokens: meta.promptTokens } : {}), ...(meta?.outputTokens !== undefined ? { outputTokens: meta.outputTokens } : {}),
      ...(menu?.guarded.length ? { guarded: menu.guarded } : {}), ...(menu ? { ctx: menu.ctx } : {}),
    });
    if (meta) {
      this.decisions.set(id, { ...meta, chosen: opt?.id ?? null, at: choice.t });
      this.summarise(v.name, meta, opt);
    }
  }

  /**
   * A chore's `[choice-end]` record, once: from choreKeys when it drops the chore, or from the tick as soon as its actions
   * have ended (choreKeys runs only every 30 s and only for villages with agents in the world, so the tick gives the
   * minutes and catches chores whose agents were all removed). Logging only: the chore stays in `chores` until choreKeys
   * drops it. A.2: it also stamps the end (heldKeys' async hold), and feeds the outcome to the choice statistics (the
   * guards' learning progress, bans and cooldowns), judged from the chore's own result. In model mode it also reports a
   * failure to the chore's `failed` (reportFailed).
   */
  private endChoice(c: ChoreEnd) {
    if (c.choice.ended) return;
    c.choice.ended = true;
    c.choice.endedAt = Date.now();
    this.idleSince.set(c.agent.toLowerCase(), c.choice.endedAt);
    const bad = c.status.find((q) => q.state === 'failed');
    const agent = this.agents.get(c.agent.toLowerCase());
    if ((agent ? this.chooseMode(agent) : CHOOSE.mode) === 'model') this.reportFailed(c);
    const done = c.status.every((q) => q.state === 'done');
    let message = bad?.message ?? (done ? c.status[c.status.length - 1]?.message ?? '' : 'agent gone');
    let ok = !bad && done;
    // S.9's gathering is judged by its deposit: a partial collect ("only found 9") whose load landed is a success (the
    // check's M3), and the deposit's message is what choreProductive reads
    const g = c.choice.gather ?? c.choice.initiative;
    if (g) {
      const dep = c.status[c.status.length - 1];
      const n = dep?.state === 'done' ? depositedOf(dep.message ?? '', g.material, c.choice.initiative?.item) : 0;
      ok = n > 0;
      // (a failed deposit after a failed collect says only "not carrying sand": the collect's reason, the first failure,
      // is the one the log and the model's last chores read; S.9's review, lens 2 L1)
      if (dep?.state === 'done' && (n > 0 || !bad)) message = dep.message ?? message;
      // (a load landed: the material is there after all, a first "none found" is forgotten)
      if (n > 0) this.gatherNone.delete(`${c.village}:${g.material}`);
      if (n > 0 && g.material === 'logs' && c.choice.kind === 'gather') this.gatherLog.set(c.village, [...(this.gatherLog.get(c.village) ?? []).filter((e) => Date.now() - e.at < 60 * 60000), { at: Date.now(), n }]);
      // (an initiative's trip: what landed is credited to it, by the item its bill plans with; s36)
      const ini = c.choice.initiative;
      const vi = ini && n > 0 ? this.villages.villages.get(c.village.toLowerCase()) : undefined;
      const it = vi?.initiatives?.find((i) => i.id === ini!.id);
      if (vi && it && ini) {
        const item = ini.material === 'logs' ? `${this.workWood(vi, it.design)}_log` : ini.material === 'flowers' ? ini.item ?? 'wildflowers' : ini.material === 'saplings' ? `${this.workWood(vi, it.design)}_sapling` : ini.material;
        it.gathered = { ...(it.gathered ?? {}), [item]: (it.gathered?.[item] ?? 0) + n };
        this.villages.save();
      }
    }
    // M1 (#144): a monument trip judged by its deposit as gathering and its load credited to the yard; a job built marked
    const mon = c.choice.monument;
    const vm = mon ? this.villages.villages.get(c.village.toLowerCase()) : undefined;
    if (mon && vm?.monument) {
      const m = vm.monument;
      const am = this.agents.get(c.agent.toLowerCase());
      if (am) {
        delete am.memory.monumentGather;
        delete am.memory.lodge;
      }
      if (mon.item && mon.material) {
        const dep = c.status[c.status.length - 1];
        const n = dep?.state === 'done' ? depositedOf(dep.message ?? '', mon.material, mon.item) : 0;
        ok = n > 0;
        if (dep?.state === 'done' && (n > 0 || !bad)) message = dep.message ?? message;
        // (#162, the detail palette: a quarry trip's andesite, diorite and granite are the yard's too, as far as the stage
        // wants them: T2a's collect trips for them failed 16 of 22 on stone under water)
        if (dep?.state === 'done' && m3(m).detail && mon.material === 'cobblestone') {
          const wants = stageWantsPlanned(m, planOf(this));
          for (const st of ['andesite', 'diorite', 'granite']) {
            const k = Math.min(wants[st] ?? 0, depositedOf(dep.message ?? '', 'flowers', st));
            if (k > 0) {
              m.yard[st] = (m.yard[st] ?? 0) + k;
              console.log(`[monument] ${c.village}: ${c.agent}'s quarry trip brings ${k} ${st} too`);
            }
          }
        }
        if (n > 0) {
          m.yard[mon.item] = (m.yard[mon.item] ?? 0) + n;
          if (M3.roles) this.creditTrade(vm, c.agent, tradeOfStep(m, { step: mon.furnish ? 'furnish' : 'gather', item: mon.item }), { item: mon.item, n });
          this.villages.save();
          console.log(`[monument] ${c.village}: ${c.agent} brings ${n} ${mon.item} to the yard (${monumentLine(m)})`);
        }
      } else if (mon.job !== undefined && ok) {
        const st0 = currentStage(m);
        // (M2, MC_KILN: the yard holds made goods, and the job takes what its plan took)
        if (KILN.on) jobBuiltPlanned(m, mon.job, planOf(this), Date.now());
        else jobBuilt(m, mon.job, this.monumentRaw(m, monumentPlan(m).jobs[mon.job].bill), Date.now());
        this.villages.save();
        const st1 = currentStage(m);
        if (M3.roles) this.creditTrade(vm, c.agent, tradeOfStep(m, { step: 'job', job: mon.job }), { built: true });
        console.log(`[monument] ${c.village}: ${c.agent} built job ${mon.job}: ${monumentLine(m)}`);
        // (M3, MC_MONUMENT_NEWS: a stage's end is news, told by the member who finished it; a part built shows in the line)
        const names = monumentStages(m), noun = monumentNoun(m);
        const stageText = st1 ? `The ${noun}'s ${names[st0 - 1]} is done; its ${names[st1 - 1]} begins` : `The ${noun} is finished`;
        if (st1 !== st0) {
          if (M3.news) this.monumentNews(vm, `${stageText.replace(`The ${noun}`, cathedralName(m).replace(/^t/, 'T'))} (stage ${st0} of ${names.length} finished by ${c.agent})`, c.agent);
          else this.villages.note(vm, stageText);
        } else if (M3.news) m3(m).news = { t: Date.now(), text: `${c.agent} built a part of its ${names[st0 - 1]}` };
      } else if (mon.site && ok) {
        if (M3.roles) this.creditTrade(vm, c.agent, 'quarryman');
        console.log(`[monument] ${c.village}: ${c.agent} prepared the site: ${monumentLine(m)}`);
      } else if (mon.kiln !== undefined && ok && M3.roles) this.creditTrade(vm, c.agent, 'mason');
      else if (mon.cut && ok && M3.roles) this.creditTrade(vm, c.agent, 'carver');
    }
    // s41: a library activity by its gives' deposit, as gathering (the check's F3: the first step is a withdraw)
    const act = c.choice.activity;
    if (act) {
      const dep = c.status[act.depAt];
      const n = dep?.state === 'done' ? depositedItems(dep.message ?? '', act.items) : 0;
      ok = n > 0;
      if (n > 0) message = dep.message ?? message;
      else if (!bad && done) message = c.status[act.depAt - 1]?.message ?? message;
      console.log(`[activity] ${c.village}: ${c.agent} ends ${act.id}: ${n} ${act.items.join('/')} deposited${n ? '' : ` (${message.slice(0, 120)})`}`);
    }
    // (an earmark left by a make or furnace placement stopped while queued, lesson 67; the skill's finally deletes its own)
    if (c.choice.kind === 'make' || c.choice.kind === 'works' || c.choice.kind === 'light' || c.choice.kind === 'furnish' || (IRON_AGE && c.choice.kind === 'iron')) holdsDelete(holdKey(c.village, c.agent));
    // (and a meal's: eat_meal's finally deletes its own, s30)
    if (c.choice.kind === 'eat') releaseMeal(c.village, c.agent);
    // A light run that confirmed, found and ruled out nothing (the lighter inside, spots not loaded) ends ok but backs the
    // part off 10 minutes as a failure does: otherwise it is the fixed pick again at once, forever (B.4's review, lens 2 M1)
    if (ok && c.choice.kind === 'light' && c.choice.light && /no progress\)$/.test(message)) this.lightBack.set(`${c.village}:${c.choice.light.part}`, Date.now() + 10 * 60000);
    // (and a furnish run's, X.1)
    if (ok && c.choice.kind === 'furnish' && c.choice.furnish && /no progress\)$/.test(message)) this.decorBack.set(`${c.village}:${c.choice.furnish.part}`, Date.now() + 10 * 60000);
    const v = this.villages.get(c.village);
    const held = agent ? heldCounts(agent) : null;
    const carried = held ? countsDelta(c.choice.carried, held) : null;
    // (a stop or a removal fails every action as "cancelled", which the chores' own failed callbacks ignore too)
    const cut = !ok && (!agent || bad?.message === 'cancelled');
    // (a gathering whose deposit landed is no contention, whatever its collect met)
    const code = ok ? undefined : bad?.code;
    let known: number | undefined;
    if (c.choice.point) {
      try {
        known = Math.round((this.atlas.known(c.choice.point.x, c.choice.point.z, 48) - c.choice.point.known0) * 1000) / 1000;
      } catch {
        known = undefined;
      }
    }
    const productive = choreProductive(c.choice.kind, c.status[0]?.type ?? '', ok, message, carried, known);
    // s43 (MC_SPECIAL=claim): a plot worked counts toward its claim; a claimant working its own keeps the claim fresh
    if (SPECIAL.claim && v && ok && productive && (c.choice.kind === 'farm' || c.choice.kind === 'slot' || c.choice.kind === 'penwork')) {
      const claims = (v.claims ??= {});
      // (the plot's key from the option's id: farm:k, slot:k:j, penwork:j of penwork:j:what)
      const ck = (c.choice.option ?? '').split(':').slice(0, c.choice.kind === 'slot' ? 3 : 2).join(':');
      const own = claims[ck];
      if (own?.by === c.agent) own.last = Date.now();
      else if (!own && !Object.values(claims).some((q) => q.by === c.agent && !q.own)) {
        const w = this.claimWork.get(`${v.name}|${ck}`) ?? new Map<string, number>();
        w.set(c.agent, (w.get(c.agent) ?? 0) + 1);
        this.claimWork.set(`${v.name}|${ck}`, w);
        if (w.get(c.agent)! >= CLAIM_AFTER) {
          claims[ck] = { by: c.agent, at: Date.now(), last: Date.now() };
          console.log(`[claim] ${v.name}: ${c.agent} claims ${ck} (its ${CLAIM_AFTER}rd harvest of it)`);
        }
      }
    }
    // (G3, MC_RULES: what the chore put into the commons, net of its takes, for a contribution rule's member-day and tag)
    // (#108, MC_PAY: goods put for a buyer's priced request, earmarked for it, come off the net the share and G3's puts are
    // taken from, once)
    const mark = PAY.on && v ? markAtEnd(v, c.agent, c.choice.option ?? '', c.choice.id, c.choice.gross, storageGross(c.agent)) : {};
    const netOf = (flow: Counts) => {
      const n = netPut(flow, storageFlow(c.agent));
      for (const [k, q] of Object.entries(mark)) if (n[k]) n[k] = Math.max(0, n[k] - q);
      return n;
    };
    if (RULES.on && v && c.choice.flow) notePuts(v.name, c.agent, c.choice.option ?? '', netOf(c.choice.flow), Date.now());
    // #68: the member's share of the new goods the chore put into the commons, owed until it carries it home (a member
    // with a house of its own; chores that bring goods from the world only, own.ts SHARED)
    if (OWN.on && v && c.choice.flow && SHARED.has(c.choice.kind ?? '') && this.homeOf(v, c.agent)) {
      const ownField = (c.choice.kind === 'farm' || c.choice.kind === 'slot') && (v.layouts ?? [])[Number((c.choice.option ?? '').split(':')[1]) - 1]?.owner === c.agent;
      // (G3: while a levy is in force the share is pending, answered on the member's next model decision)
      const levy = levyRate(v.name);
      const added = levy !== undefined ? pendShare(ownOf(v, c.agent), netOf(c.choice.flow), Date.now(), ownField ? 1 : undefined) : earnShare(ownOf(v, c.agent), netOf(c.choice.flow), ownField ? 1 : undefined);
      if (Object.keys(added).length) console.log(`[own] ${v.name}: ${c.agent} earns ${Object.entries(added).map(([n, q]) => `${q} ${n}`).join(', ')} (owed ${Object.entries(ownOf(v, c.agent).owed).map(([n, q]) => `${q} ${n}`).join(', ')})`);
    }
    // (#79: the chore's end into its member's goal counters: its craft, lights, furnishings, help)
    if (GOALS_ON && v && ok) goalNoteEnd(v, c.agent, c.choice.kind ?? '', c.choice.option ?? '', c.choice.name ?? '', message);
    // (s44, the user's: the inventors' royalty on a make of an invention's goods, owed to its researchers and pledgers)
    // (what the make's own steps put into storage, "put into storage: N item": the flow nets puts against the member's
    // earlier takes of the item, a pie eaten from storage, and paid a third of what was made)
    if (INNOVATE && OWN.on && v && c.choice.kind === 'make') {
      const made: Counts = {};
      for (const q of c.status) {
        const m = q.type === 'make' && q.state === 'done' ? /put into storage: (\d+) ([a-z0-9_]+)/.exec(q.message ?? '') : null;
        if (m) made[m[2]] = (made[m[2]] ?? 0) + Number(m[1]);
      }
      const paid = payRoyalties(v, made, (m) => !!this.homeOf(v, m));
      for (const [m, got] of Object.entries(paid)) console.log(`[innovate] ${v.name}: ${m} earns a royalty of ${Object.entries(got).map(([n, q]) => `${q} ${n}`).join(', ')} on ${c.agent}'s make`);
    }
    // (G8, MC_LADDER: the work done into the ladder's stage: cells and raw iron from a dig trip, ingots from a smelt, a tool
    // given to a member)
    if (IRON_AGE && v?.mine?.ironTries) for (const q of c.status) {
      // (a success clears its kind's failures in a row, the iron age's back-off)
      const sk = q.state !== 'done' ? '' : q.type === 'dig_iron' ? 'dig' : q.type === 'smelt_iron' ? 'smelt' : q.type === 'make_iron_tool' ? `forge:${String(q.args?.item ?? '')}` : '';
      if (sk && v.mine.ironTries[sk]) v.mine.ironTries = { ...v.mine.ironTries, [sk]: 0 };
    }
    if (LADDER && v) {
      for (const q of c.status) {
        if (q.state !== 'done' || !q.message) continue;
        const got: Array<[LadderCounter, number]> = [];
        if (q.type === 'dig_iron') {
          const cells = /(\d+) cells dug this trip/.exec(q.message), up = /brought up (\d+) raw iron/.exec(q.message);
          if (cells) got.push(['cells', Number(cells[1])]);
          if (up) got.push(['raw_iron', Number(up[1])]);
        } else if (q.type === 'smelt_iron') {
          const n = /smelted (\d+) iron_ingot/.exec(q.message);
          if (n) got.push(['ingots', Number(n[1])]);
        } else if (q.type === 'make_iron_tool' && /given to [A-Za-z0-9_]+/.test(q.message)) got.push(['tools', 1]);
        // (#21, MC_LETTERS: cane harvested, leather bought or caught once the activity's deposit landed, books made, pieces
        // shelved)
        else if (LETTERS && (q.type !== 'trade' && q.type !== 'fish' || (act && c.status[act.depAt]?.state === 'done'))) got.push(...lettersCounts(q.type, q.message));
        for (const [counter, n] of got) {
          for (const news of noteLadder(v, counter, c.agent, n, Date.now(), clockOf(v.name, Date.now())?.day)) this.ladderNews(v, news);
        }
        if (got.length) this.villages.save();
      }
    }
    // (G1: every chore's end into its member's journal and kind table, grow, eat and tidy too; a contention end is no lesson
    // about the chore; the intent marked ended)
    if (MEMORY.on && !code) {
      try {
        const mins = Math.round((Date.now() - c.choice.t) / 600) / 100;
        const verb = ok ? (productive ? 'done' : 'done, nothing gained') : cut ? 'cut short' : `failed (${message.slice(0, 60)})`;
        const nm = c.choice.name ?? c.choice.option ?? c.choice.id;
        memoryEnd(c.village, c.agent, { kind: c.choice.kind ?? 'chore', option: c.choice.option ?? c.choice.id, name: nm, ok, productive, cut, minutes: mins, line: `${nm}: ${verb}, ${Math.round(mins * 10) / 10} min`, message });
      } catch (e) {
        console.error('[memory] a chore end was not kept:', e);
      }
    }
    const intent = agent?.memory.intent as { since?: number; ended?: number } | undefined;
    if (intent && intent.since === c.choice.t) intent.ended = Date.now();
    logChoiceEnd({
      id: c.choice.id, ok, message, minutes: Math.round((Date.now() - c.choice.t) / 600) / 100, tEnd: Date.now(), cut,
      yield: { storage: v ? countsDelta(c.choice.store, storageContents(v)) : {}, carried, with: [...c.choice.with], ...(known !== undefined ? { known } : {}) },
      ...(code ? { code } : {}), productive,
      // (#163: blocks walked in the chore)
      ...(agent && c.choice.walked0 !== undefined ? { walked: Math.round(agent.walked - c.choice.walked0) } : {}),
      steps: c.status.map((q) => ({ type: q.type, ms: q.startedAt && q.endedAt ? q.endedAt - q.startedAt : null, state: q.state })),
    });
    try {
      this.noteEnd(c, ok, cut, !!code, productive, message, known);
    } catch (e) {
      console.error('[choice] end statistics failed:', e);
    }
  }

  /**
   * A failed chore's `failed` (the iron age's back-off), once. In model mode endChoice calls it at the end itself: picks are
   * also made outside the sweep (after a reply, an expiry, the API), and one made before choreKeys drops the chore would
   * see the option without its back-off (RACES-1). In fixed mode every pick follows choreKeys in a sweep, so the drop
   * reports it, as before A.2 (the golden check records the back-off's time).
   */
  private reportFailed(c: ChoreEnd) {
    // (an end seen while an action still runs, its agent gone: reported by the drop, once the actions have ended)
    if (c.failReported || c.status.some((q) => q.state === 'queued' || q.state === 'running')) return;
    c.failReported = true;
    const bad = c.status.find((q) => q.state === 'failed');
    if (!bad || !c.failed) return;
    try {
      c.failed(bad.message ?? 'failed');
    } catch (e) {
      console.error("[choice] a chore's failure callback failed:", e);
    }
  }

  /** Chores whose actions have ended (or whose agent is gone) get their end record now (see endChoice); pending decisions
   *  whose agent went away, got busy or left a complete village are dropped (A.2, spec 6). */
  private endChoices() {
    for (const [id, c] of this.chores) {
      if (c.choice.ended) continue;
      const going = c.status.some((q) => q.state === 'queued' || q.state === 'running');
      if (!going || !this.agents.has(id)) {
        this.endChoice(c);
        // (MC_QUICK_NEXT: the village's check (its sweep) comes within QUICK_GAP_MS, not at the 30 s cycle)
        if (QUICK_NEXT) this.farmCheckAt = Math.min(this.farmCheckAt, Date.now() - 30000 + QUICK_GAP_MS);
      }
    }
    for (const p of [...this.pending.values()]) {
      const a = this.agents.get(p.id);
      const v = this.villages.get(p.village);
      const why: ChoiceDrop['why'] | null = !a ? 'gone' : a !== p.agent ? 'replaced' : !a.bot.entity ? 'no body' : !v?.complete || a.village()?.name !== p.village ? 'not complete'
        : v.tasks.some((t) => t.status === 'claimed' && t.claimedBy === a.name) ? 'task' : !a.idle() || this.chores.has(p.id) ? 'busy' : null;
      if (why) this.dropDecision(p, why);
    }
  }

  // ---- A.2: the menu ---------------------------------------------------------------------------------------------------

  /** Decisions waiting for or in a model call, by agent (lower-cased). */
  private pending = new Map<string, PendingChoice>();

  /** MC_CHOICE_HOLDS: the keys the other members' pending decisions in the village hold. */
  private heldFor(v: Village, a: BotAgent): string[] {
    const me = a.name.toLowerCase();
    const out: string[] = [];
    for (const p of this.pending.values()) if (p.village === v.name && p.id !== me && p.holds) out.push(...p.holds);
    return out;
  }

  /** MC_CHOICE_HOLDS: whether another member's pending decision was shown a project of its own, as one open project at
   *  most (#142: counted one each, they filled the cap while none chose one: 61% of train 3's cap-gate samples had fewer
   *  projects open than the cap; most decisions shown a project choose something else). */
  private heldProjects(v: Village, a: BotAgent): number {
    if (!CHOICE_HOLDS) return 0;
    const me = a.name.toLowerCase();
    for (const p of this.pending.values()) if (p.village === v.name && p.id !== me && p.initiates) return 1;
    return 0;
  }

  /** MC_CHOICE_HOLDS: a pending decision's holds gone (answered, expired or dropped): the next sweep within QUICK_GAP_MS, so a
   *  member whose menu they emptied chooses soon. */
  private holdsReleased(p: PendingChoice) {
    if (CHOICE_HOLDS && p.holds?.length) this.farmCheckAt = Math.min(this.farmCheckAt, Date.now() - 30000 + QUICK_GAP_MS);
  }
  private chooser = new ChooserQueue({ parallel: CHOOSE.parallel, queueMs: CHOOSE.queueMs });
  private choiceStats = new ChoiceStats();
  /** Each agent's last decision (the panel's drill-down). */
  private decisions = new Map<string, ChoiceMeta & { chosen: string | null; at: number }>();
  /** The kind of each agent's last model decision (the repeat rule). */
  private lastModelKind = new Map<string, ChoiceKind>();
  /** Each village's decisions counted (the panel's chip). */
  private summaries = new Map<string, { s: ChoiceSummary; ms: number[]; queue: number[] }>();
  /** Each village's last explore yields (the scouting fact). */
  private exploreYields = new Map<string, number[]>();
  /** Bans already logged, by "village|id", with their end. */
  private bansLogged = new Map<string, number>();
  /** MC_BAN_SCOPE=member: a member's missing tool after a failed dig (the fix it is shown), until when. */
  private needTool = new Map<string, { item: string; until: number }>();
  /** The last [choice-none] line by village: its reasons and when. */
  private noneAt = new Map<string, { sig: string; at: number }>();
  /** The village facts of the latest sweep or menu, by village (C10: one per sweep time). */
  private factsCache = new Map<string, Facts>();
  /** The sweep under way: its village, busy keys and the first ready field's own (today's choreKeys quirk, spec 2.3). */
  private sweepCtx: SweepCtx | undefined;

  /** Fixed order or the model, by agent (memory.choose; every agent of a village runs one mode, D5). */
  private chooseMode(a: BotAgent): 'fixed' | 'model' {
    const m = a.memory.choose;
    // (G2: the scripted controller takes the model path's menus, guards and trim, and picks without a call)
    if (m === 'scripted') return 'model';
    return m === 'model' || m === 'fixed' ? m : CHOOSE.mode === 'scripted' ? 'model' : CHOOSE.mode;
  }

  /** G2 (MC_CHOOSE=scripted, or memory.choose 'scripted'): E.4's scripted controller, E.8's null picker. */
  private scripted(a: BotAgent): boolean {
    const m = a.memory.choose;
    return m === 'scripted' || (m !== 'model' && m !== 'fixed' && CHOOSE.mode === 'scripted');
  }

  /** idleWorker's test for one agent (workers and, once the village is complete, the mayor), plus no decision pending. */
  private isIdleMember(v: Village, a: BotAgent, now: number, held?: Set<string>): boolean {
    const id = a.name.toLowerCase();
    return a.village()?.name === v.name && !!a.bot.entity && a.idle() && !this.chores.has(id)
      && (this.cooling.get(`agent|${id}`) ?? 0) < now && !held?.has(`agent|${id}`)
      && !v.tasks.some((t) => t.status === 'claimed' && t.claimedBy === a.name)
      && (a.memory.villageRole !== 'mayor' || !!v.complete) && !this.pending.has(id);
  }

  /** The idle members in idleWorker's order: workers, then the mayor. */
  private idleMembers(v: Village, now: number): BotAgent[] {
    const free = [...this.agents.values()].filter((a) => this.isIdleMember(v, a, now));
    return [...free.filter((a) => a.memory.villageRole !== 'mayor'), ...free.filter((a) => a.memory.villageRole === 'mayor')];
  }

  /** A2: the menu this agent would choose from now; written nowhere (spec 1.3, 4.3). */
  choices(agent: WorldAgent): ChoiceMenu | null {
    const a = this.agents.get(agent.name.toLowerCase());
    if (!a || a !== (agent as unknown)) return null;
    const v = a.village();
    if (!v?.complete) return null;
    const now = Date.now();
    const ctx = this.sweepCtx?.village === v.name ? this.sweepCtx : undefined;
    if (!this.isIdleMember(v, a, now)) return null;
    const busy = ctx?.busy ?? this.heldKeys(v, now, 'sweep');
    return this.menu(v, a, busy, this.chooseMode(a) === 'model', this.sweepFacts(v, now, a), ctx?.first).menu;
  }

  /** A2: run one option, checked again against a fresh menu; never throws (D9). */
  runChoice(agent: WorldAgent, id: string, meta: ChoiceMeta): { ok: true; key: string } | { ok: false; why: string } {
    return this.runPick(agent, id, meta);
  }

  /**
   * One pick run: the option `id` if it is still on the agent's fresh menu, else (a model's pick taken meanwhile, or no id:
   * a fallback) the fresh menu's fixed pick. Inside a sweep the menu is the sweep's (its busy keys); after a reply, an
   * expiry or an API call it holds what heldKeys' async mode holds. Never throws.
   */
  private runPick(agent: WorldAgent, id: string | null, meta: ChoiceMeta, reask?: (fresh: ChoiceMenu) => boolean, backup?: string): { ok: true; key: string } | { ok: false; why: string } {
    try {
      const a = this.agents.get(agent.name.toLowerCase());
      const v = a?.village();
      const drop = (why: ChoiceDrop['why']) => {
        if (meta.decisionId) this.logDrop(meta.decisionId, agent.name, v?.name ?? String(agent.memory.village ?? ''), why, meta.queueWaitMs, meta, id);
        return { ok: false as const, why };
      };
      if (!a || a !== (agent as unknown)) return drop(a ? 'replaced' : 'gone');
      if (!v?.complete) return drop('not complete');
      const ctx = this.sweepCtx?.village === v.name ? this.sweepCtx : undefined;
      // (inside a sweep, the sweep's time: its facts are reused, C10)
      const now = ctx?.t ?? Date.now();
      // (outside a sweep, ended chores' back-offs first: in fixed mode the drop that reports them may be 30 s away, and an
      // API pick would see iron without its back-off, the fix review; reportFailed runs once a chore)
      if (!ctx) for (const c of this.chores.values()) if (c.village === v.name && c.choice.ended) this.reportFailed(c);
      const held = ctx ? undefined : this.heldKeys(v, now, 'async');
      if (!this.isIdleMember(v, a, now, held)) return drop(!a.bot.entity ? 'no body' : v.tasks.some((t) => t.status === 'claimed' && t.claimedBy === a.name) ? 'task' : 'busy');
      const busy = ctx?.busy ?? held!;
      const fresh = this.menu(v, a, busy, this.chooseMode(a) === 'model', this.sweepFacts(v, now, a), ctx?.first);
      // (checked against the guarded options before the trim: one the trim would cut now is still feasible, spec 6)
      let opt = id ? fresh.feasible.find((o) => o.id === id) : undefined;
      let m = meta;
      // (MC_CHOOSE_BACKUP: a first pick taken meanwhile gives way to the model's own second, before any re-ask)
      if (id && !opt && backup) {
        const b = fresh.feasible.find((o) => o.id === backup);
        if (b) {
          opt = b;
          m = { ...meta, reason: `${meta.reason} (its second choice: ${id} was taken)`, backupOf: id };
        }
      }
      // (s40, F253: a pick taken meanwhile is asked once more on the fresh menu, the plan's E.4 rule; Night40 lost 103 of
      // 149 model decisions to the fixed pick, several members shown one single-holder option at once)
      if (id && !opt && reask && fresh.menu.options.length > 1 && reask(fresh.menu)) return drop('reask');
      if (id && !opt) m = { ...meta, source: 'fallback', why: 'taken', reason: 'fixed order', ...(meta.source === 'model' ? { modelChose: id, modelReason: meta.reason } : {}) };
      opt ??= fixedPick(fresh.menu);
      if (!opt) return drop('empty');
      // (a fallback is logged with the fresh menu its fixed pick was made on; the ids shown to the model stay in `shown`)
      if (!m.menu || m.source === 'fallback') m = { ...m, menu: fresh.menu };
      this.runOption(v, a, opt, m);
      // (#108: a pick that was not the model's own accepts a priced request of its option only at or above the guide; #107's
      // MC_ACT_FIXES an unpriced one too)
      if ((PAY.on || TALK.fixes) && m.source !== 'model' && m.source !== 'scripted') {
        const c = this.chores.get(a.name.toLowerCase());
        if (c) {
          const pid = impliedAccept(v.name, a.name, { option: c.choice.option ?? c.key, kind: c.choice.kind ?? '', name: c.choice.name ?? c.what, chore: c.choice.id }, this.actsWorld(v, now), now);
          if (pid) console.log(`[acts] ${v.name}: ${a.name}'s ${m.source} pick took up a request (${pid})`);
        }
      }
      return { ok: true, key: opt.key };
    } catch (e) {
      console.log(`[choice-error] ${agent?.name}: ${String((e as Error)?.stack ?? e).slice(0, 300)}`);
      return { ok: false, why: 'error' };
    }
  }

  /** The facts a village's members share, once per sweep time (C10): storage, collect's filter, ripe counts, sightings. */
  private sweepFacts(v: Village, t: number, a: BotAgent): Facts {
    const old = this.factsCache.get(v.name);
    if (old && old.t === t && this.agents.has(old.agent.name.toLowerCase())) return old;
    const f = this.makeFacts(v, t, a);
    this.factsCache.set(v.name, f);
    return f;
  }

  private makeFacts(v: Village, t: number, a: BotAgent): Facts {
    const store = storageContents(v);
    const memo = <T,>(fn: (k: string) => T) => {
      const m = new Map<string, T>();
      return (k: string) => {
        if (!m.has(k)) m.set(k, fn(k));
        return m.get(k)!;
      };
    };
    const since = <T,>(fn: () => T) => {
      let at: string | undefined, val: T;
      return () => {
        const g = this.goingS9(v);
        const sig = `${holdsVersion()}|${JSON.stringify(g)}`;
        if (sig !== at) {
          val = fn();
          at = sig;
        }
        return val;
      };
    };
    let ok: ((p: { x: number; y: number; z: number }) => boolean) | undefined;
    const chest = v.storage?.chests[0];
    const startHome = chest ? { x: chest.x, z: chest.z } : villageHome(v, a.memory);
    const read = (x: number, y: number, z: number) => {
      for (const b of this.agents.values()) {
        const st = b.bot.entity ? stateAt(b, x, y, z) : -1;
        if (st >= 0) return st;
      }
      return -1;
    };
    const is = (st: number, name: string) => {
      const b = this.registry.blocksByName[name];
      return !!b && st >= b.minStateId && st <= b.maxStateId;
    };
    const lay0 = v.layouts?.[0];
    const ax = lay0?.annex;
    const annexHome = ax ? { x: (ax.x1 + ax.x2) / 2, z: (ax.z1 + ax.z2) / 2 } : null;
    const bad = ax ? (ax.penBad ?? []).map((s) => (s.includes(':') ? s : `chicken:${s}`).split(':')).map(([k, c]) => [k, ...c.split(',').map(Number)] as [string, number, number, number])
      .filter(([, , , tt]) => !tt || t - tt < 60 * 60000) : [];
    return {
      t, agent: a, store,
      ok: () => (ok ??= collectFilter(a, FARM_TRIP_RANGE)),
      startHome,
      exploreHome: villageHome(v, a.memory),
      // The wheat fields as farmChores reads them (everything but the busy keys and an idle worker)
      field: memo((ks) => {
        const k = Number(ks), farm = v.layouts?.[k - 1]?.farm;
        const wheat = this.registry.blocksByName.wheat;
        if (!wheat || !farm?.planted || harvesting.has(`${v.name}:${k}`)) return null;
        if (farm.lastHarvest && !farm.lastHarvest.ok && t - farm.lastHarvest.at < (farm.lastHarvest.why === 'nothing ripe' ? 2 : 10) * 60000) return null;
        if (v.tasks.some((tk) => tk.detail.startsWith(`tend_farm layout=${k} `) && (tk.status === 'open' || tk.status === 'claimed'))) return null;
        const plot = preparedAt(v, farm);
        if (!plot) return null;
        let grown = 0, ripe = 0;
        for (const [x, z] of farm.sow) {
          let s = -1;
          for (const b of this.agents.values()) if (b.bot.entity && (s = stateAt(b, x, plot.y + 1, z)) >= 0) break;
          if (s < 0) return null;
          if (s < wheat.minStateId || s > wheat.maxStateId) continue;
          grown++;
          if (s - wheat.minStateId >= 7) ripe++;
        }
        return ripe < (GROW_FARMS ? Math.min(4, Math.max(1, grown)) : 4) || ripe < 0.75 * grown ? null : { ripe, grown, plot };
      }),
      // A planted slot as slotChores' ripe loop reads it ("k:j")
      slot: memo((kj) => {
        const [k, j] = kj.split(':').map(Number);
        const slot = v.layouts?.[k - 1]?.slots?.[j - 1];
        const spec = slot?.kind ? SLOT_KINDS[slot.kind] : undefined;
        if (!slot || !spec || slot.laying || !slot.planted || slotBusy.has(`${v.name}:${k}:${j}`)) return null;
        if (slot.lastHarvest && !slot.lastHarvest.ok && t - slot.lastHarvest.at < (slot.lastHarvest.why === 'nothing ripe' ? 2 : 10) * 60000) return null;
        const plot = preparedAt(v, slot);
        if (!plot) return null;
        const y = plot.y + 1;
        let ripe = 0, of = 0;
        if (spec.ripe !== undefined) {
          const b = this.registry.blocksByName[spec.block];
          for (const [x, z] of slot.cells ?? []) {
            const st = read(x, y, z);
            if (st < 0) return null;
            if (b && is(st, spec.block)) {
              of++;
              if (st - b.minStateId >= spec.ripe) ripe++;
            }
          }
        } else
          for (const [x, z] of (spec.fruit ? slot.fruit : slot.cells) ?? []) {
            const st = read(x, spec.fruit ? y : y + 1, z);
            if (st < 0) return null;
            if (is(st, spec.fruit ?? 'sugar_cane')) ripe++;
          }
        // (#134, MC_LETTERS_PACE: a cane slot short of stalks with cane in storage is worth a visit, ripe or not)
        const topUp = this.caneTopUp(v, slot);
        if (topUp && (ripe >= 2 || topUp >= Math.min(2, CANE_FULL - (slot.cells?.length ?? 0)))) return { ripe, of, topUp };
        return ripe < 2 || (spec.ripe !== undefined && ripe < 0.75 * of) ? null : { ripe, of, topUp: 0 };
      }),
      // Sightings a start may go for, by kind (searched from collect's home, judged by collect's filter; bad sightings
      // are the slots', left to the menu)
      sightings: memo((kind) => (startHome ? this.atlas.sightings(kind, Math.floor(startHome.x), Math.floor(startHome.z), FARM_TRIP_RANGE) : [])),
      // Animals a pen may lure, by kind (within 96 of the annex in 30 minutes, off village ground, away from failed spots)
      animals: memo((kind) => (annexHome && ax ? this.atlas.animalSightings(kind, annexHome.x, annexHome.z, 96, 30 * 60000, (x, z) => onVillageGround(a, x, z) || bad.some(([bk, bx, bz]) => bk === kind && Math.hypot(x - bx, z - bz) <= 8)) : [])),
      // Eggs lying in a chicken pen ("j"), seen by any bot
      eggs: memo((js) => {
        const slot = lay0?.slots?.[Number(js) - 1];
        const plot = v.plots.find((p) => p.annex);
        if (!slot || !plot) return false;
        const P = penPlan(slot, slot.face ?? 'n');
        const inPen = (q: { x: number; y: number; z: number }) => P.boxes.some((b) => q.x >= b.x1 && q.x < b.x2 + 1 && q.z >= b.z1 && q.z < b.z2 + 1) && Math.abs(q.y - (plot.y + 1)) <= 2;
        return [...this.agents.values()].some((b) => b.bot.entity && Object.values(b.bot.entities).some((e) => e.name === 'item' && inPen(e.position)));
      }),
      known: memo((xz) => {
        const [x, z] = xz.split(',').map(Number);
        return this.atlas.known(x, z, 48);
      }),
      // S.9's workshop, for no one agent (an idle member holds no earmark): planned again only once the earmarks or the
      // makes and trips under way changed, i.e. after one was taken in the sweep (spec 4.6)
      makePlans: since(() => {
        const goods = this.goodsFor(v);
        // (with the catalogue, one spare for every good: makeSpare's reserve is too dear to repeat for each, X.1)
        const base = goods.length > MAKE_GOODS.length + FOOD_GOODS.length ? this.makeSpare(v, '', undefined, store) : undefined;
        return new Map(goods.map((g) => [g.item, this.makePlan(v, g, '', store, base)]));
      }),
      gather: since(() => this.gatherWanted(v, store)),
      spare: since(() => this.makeSpare(v, '', undefined, store)),
    };
  }

  /** The full menu: options (guarded and trimmed in model mode), the reasons for kinds with none, and the context; beside
   *  it the guarded options before the trim (`feasible`, what a model's pick is checked against). */
  private menu(v: Village, a: BotAgent, busy: Set<string>, guards: boolean, facts: Facts, first?: SweepCtx['first']): { menu: ChoiceMenu; feasible: ChoiceOption[]; skips: string[] } {
    // (#97: the options other members' pending decisions were shown are busy for this one; the sets given stay as they were)
    const held = CHOICE_HOLDS ? this.heldFor(v, a) : [];
    if (held.length) {
      busy = new Set([...busy, ...held]);
      if (first) first = { ...first, busy: new Set([...first.busy, ...held]) };
    }
    const r = this.choiceOptions(v, a, busy, guards, facts, first);
    const ctx = this.choiceContext(v, a, facts, r.options.map((o) => o.kind));
    // (#117: when nothing on the menu feeds the ambition's stage, why not)
    if (PROMPT_SELF && ctx.ladder && !r.options.some((o) => o.vw)) {
      const gap = this.ambitionWhyNot(v, r.guarded, r.reasons);
      if (gap) ctx.ladder = `${ctx.ladder} ${gap}`.slice(0, 420);
    }
    // (G3: a pending share under a levy, asked by amounts only, the answers shuffled per member and moment)
    if (RULES.on && OWN.on) {
      const rate = levyRate(v.name);
      const p = rate !== undefined ? pendingOf(v.homes?.[a.name]) : null;
      if (p && p.total >= RULES.levyMin && rate !== undefined) {
        const l = levyLeft(p.total, rate);
        const answers = shuffled([{ id: 'none' as const, text: `Keep all ${p.total}` }, { id: 'levy' as const, text: `Leave ${l} of ${p.total}` }, { id: 'all' as const, text: `Leave all ${p.total}` }], `${a.name}|${Math.floor(facts.t / 60000)}`);
        ctx.share = { total: p.total, levy: l, answers };
      }
    }
    // (G2, MC_ACTS: the items any member was offered lately, the member's inbox, and the acts on offer to it)
    if (ACTS.on) {
      for (const o of r.feasible) if (/^(gather|make):/.test(o.id)) this.offered.set(`${v.name}|${o.id}`, facts.t);
      const ib = actsInbox(v.name, a.name, facts.t);
      if (ib.length) ctx.inbox = ib;
      const help = actsHelp(v.name, a.name, facts.t, this.actsWorld(v, facts.t));
      if (help) ctx.acts = help;
      // (#107: news heard and answers, their own sections)
      const nw = newsLines(v.name, a.name, facts.t), an = answerLines(v.name, a.name, facts.t);
      if (nw.length) ctx.news = nw;
      if (an.length) ctx.answers = an;
    }
    return { menu: { agent: a.name, village: v.name, t: facts.t, options: r.options, guarded: r.guarded, reasons: r.reasons, ctx }, feasible: r.feasible, skips: r.effects.skips };
  }

  /** G2: item options seen on any member's menu lately, by village|option id (acts.ts' items on offer). */
  private offered = new Map<string, number>();

  /** G2: what the acts need from the world now: items on offer (seen on a menu in the last 10 minutes), open projects,
   *  members' places, the stock check. */
  private actsWorld(v: Village, now: number): ActsWorld {
    const offered = new Set<string>();
    for (const [k, t] of this.offered) {
      if (!k.startsWith(`${v.name}|`)) continue;
      if (now - t > 10 * 60000) {
        this.offered.delete(k);
        continue;
      }
      offered.add(k.slice(v.name.length + 1));
    }
    // (what a request may name: every good the workshop can make here, every gather material; G2a's members asked for
    // stone hoes and logs the menus no longer offered, and a request raises the demand that brings the option back)
    const items = new Map<string, string>();
    if (CHOOSE.families.has('make')) for (const g of this.goodsFor(v)) items.set(`make:${g.item}`, g.words);
    if (CHOOSE.families.has('gather')) for (const m of MATERIALS) items.set(`gather:${m}`, m);
    // (G8, MC_IRON_AGE: an iron tool may be asked for; the forge option for the asker carries the request's id)
    if (IRON_AGE) for (const t of FORGE_TOOLS) items.set(`iron:forge:${t}`, `an iron tool: ${words(t)}`);
    const projects = new Map<string, { words: string; owner: string }>();
    for (const it of (v.initiatives ?? []).filter((i) => i.state === 'open')) projects.set(`help:${it.id}`, { words: smallWorkKind(it.kind)?.words ?? it.kind, owner: it.by });
    const at = new Map<string, { x: number; z: number }>();
    for (const p of this.presences(v)) at.set(p.name, { x: p.x, z: p.z });
    return {
      items, offered, projects, at, verify: (c) => this.verifyClaim(v.name, c),
      ...(TALK.news || TALK.questions ? { checkNews: (text: string) => this.checkNews(v, text, items), answerer: (asker: string, text: string) => this.answererFor(v, asker, text, at) } : {}),
    };
  }

  /**
   * #107: code's tag on a news line or an answer, for the measures only (it passes whatever the tag): a shortage of an
   * item the village makes or gathers (no, none, out of, short of, need, ran out) checked when storage holds under a trip
   * of it and refuted when it holds plenty; hunger checked or refuted by the village's hungry members; else unchecked.
   */
  private checkNews(v: Village, text: string, items: Map<string, string>): NewsTag {
    const t = text.toLowerCase();
    const short = /\b(no|none|out of|short|shortage|low on|need|needs|ran out|run out|empty|lacks?|missing)\b/.test(t);
    if (/\b(hungry|starving|no food|out of food|food is (short|low))\b/.test(t)) {
      const hungry = appetiteOn(v) ? Object.values(v.food?.members ?? {}).filter((e) => e.level <= APPETITE.hungryAt).length : -1;
      if (hungry >= 0) return hungry > 0 ? 'checked' : 'refuted';
    }
    if (!short) return 'unchecked';
    const store = storageContents(v);
    for (const [option, words] of items) {
      const item = option.split(':')[1] ?? '';
      const names = new Set([words.toLowerCase(), item.replace(/_/g, ' '), item.replace(/_/g, ' ').replace(/s$/, '')]);
      if (![...names].some((x) => x.length > 2 && t.includes(x.replace(/s$/, '')))) continue;
      const have = item === 'logs' ? Object.entries(store).filter(([n]) => /_log$/.test(n)).reduce((s, [, q]) => s + q, 0) : store[item] ?? 0;
      return have < 8 ? 'checked' : 'refuted';
    }
    return 'unchecked';
  }

  /** #107: who answers a question to anyone: the member near the asker (32 blocks) whose role or skill words the question
   *  names most, then the nearest. */
  private answererFor(v: Village, asker: string, text: string, at: Map<string, { x: number; z: number }>): string | undefined {
    const p = at.get(asker);
    if (!p) return undefined;
    const words = contentWordsOf(text);
    const near = [...at.entries()].filter(([n, q]) => n !== asker && Math.hypot(q.x - p.x, q.z - p.z) <= 32).map(([n, q]) => {
      const role = roleOf(v.name, n)?.kind ?? '';
      const lines = `${role ? `${role} ${roleNoun(role)}` : ''} ${this.lastModelKind.get(n.toLowerCase()) ?? ''}`;
      return { n, k: [...contentWordsOf(lines)].filter((x) => words.has(x)).length, d: Math.hypot(at.get(n)!.x - p.x, at.get(n)!.z - p.z) };
    });
    return near.sort((x, y) => y.k - x.k || x.d - y.d)[0]?.n;
  }

  /**
   * #107 (MC_QUESTIONS): a member's answer to a question, one call: its persona, character, role, skill, the village, what
   * it remembers and its view of the others, then the question; a reply in words, no tools, so an answer can neither ask
   * nor tell (depth 1). The gate's low class, billed to the asker, no decision counted for either; off with the budget's
   * `answers` degrade. The answer is tagged by code like news and delivered (or held out) through acts.ts.
   */
  private answerQuestion(villageName: string, q: Question): void {
    const v = this.villages.villages.get(villageName.toLowerCase());
    const a = this.agents.get(q.to.toLowerCase());
    if (!v || !a || a.village()?.name !== v.name) return failAnswer(villageName, q.id, `${q.to} is not in the village`);
    const spec = parseSpec(typeof a.memory.chooseModel === 'string' ? a.memory.chooseModel : typeof a.memory.execModel === 'string' ? a.memory.execModel : CHOOSE.model);
    if (!spec) return failAnswer(v.name, q.id, 'no model');
    if ((isCloudModel(spec.model) && !usage.allows('answers')) || usage.blocked(spec.model, q.from)) return failAnswer(v.name, q.id, 'budget');
    const now = Date.now();
    let user: string;
    try {
      const ctx = this.choiceContext(v, a, this.sweepFacts(v, now, a));
      const rc = MEMORY.on ? recall(v.name, a.name, now) : null;
      user = [ctx.persona, ctx.character, ctx.role, ctx.skill, ctx.village && `Village: ${ctx.village}`, ctx.social || (ctx.others && `Others now: ${ctx.others}`), ctx.needs?.length ? `Village needs: ${ctx.needs.join('; ')}` : '', rc?.text,
        `${q.from} asks you: "${q.text}"`, 'Answer in one or two short sentences, from what you know; if you do not know, say so.'].filter((x) => x && String(x).trim()).join('\n');
    } catch (e) {
      return failAnswer(v.name, q.id, String((e as Error)?.message ?? e).slice(0, 100));
    }
    const system = 'You are a member of a Minecraft village. Another member has asked you a question. Answer it plainly and briefly, as yourself, from what you know and remember; do not ask anything back.';
    callModel({ spec, system, user, tools: [], level: REASONING.answer, agent: q.from, kind: 'answer', priority: 'answer' }).then((r) => {
      const text = (r.reply.text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (!text) return failAnswer(v.name, q.id, 'an empty reply');
      const items = this.actsWorld(v, Date.now()).items;
      const ok = deliverAnswer(v.name, q.id, text, this.checkNews(v, text, items), Date.now(), r.ms);
      if (ok) console.log(`[talk] ${v.name}: ${q.to} answered ${q.from}'s ${q.id} ("${q.text.slice(0, 60)}"): ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
    }, (e) => failAnswer(v.name, q.id, String((e as Error)?.message ?? e).slice(0, 120)));
  }

  /**
   * G2 (E.5's claims, `WorldAdapter.verifyClaim`): whether a claim about the world holds, else why not. `stock`: the
   * storage does not already hold plenty of the item a request asks for (twice a batch of a good, or a trip of a material:
   * then the request is answered from storage, E.5's local recovery).
   */
  verifyClaim(village: string, claim: { type: 'stock'; option: string }): true | string {
    const v = this.villages.get(village);
    if (!v || claim.type !== 'stock') return true;
    const [kind, item] = claim.option.split(':');
    const store = storageContents(v);
    if (kind === 'make') {
      const g = this.goodsFor(v).find((x) => x.item === item);
      const n = store[item] ?? 0;
      if (g && n >= 2 * g.batch) return `the storage holds ${n} ${g.words} already: the village has plenty`;
    } else if (kind === 'gather') {
      const m = item as Material;
      const n = m === 'logs' ? Object.entries(store).filter(([k]) => /_log$/.test(k)).reduce((s, [, q]) => s + q, 0) : store[m] ?? 0;
      if (GATHER_KINDS[m] && n >= 2 * GATHER_KINDS[m].trip && this.gatherWanted(v, store)[m].want <= 0) return `the storage holds ${n} ${m} already: the village has plenty`;
    }
    return true;
  }

  /**
   * The feasible chores for an idle member of a complete village, in rank order (today's fixed order: fields, ripe slots,
   * farm starts, the annex, pens, pen work, the cake, the iron age, exploring; then S.9's works plot, making and gathering
   * for the workshop, while MC_CHOICE_FAMILIES names them). Pure: the writes the old picker made while
   * looking are the sweep's housekeeping, the option's run (runOption) or `effects.skips` (spec 1.3). With `guards` (model
   * mode), banned and cooling options go to `guarded` and the rest are trimmed (choose.ts trimMenu).
   */
  private choiceOptions(v: Village, a: BotAgent, busy: Set<string>, guards: boolean, facts: Facts, first?: SweepCtx['first']):
    { options: ChoiceOption[]; feasible: ChoiceOption[]; effects: { skips: string[] }; reasons: Partial<Record<ChoiceKind, string>>; guarded: Array<{ id: string; why: string }> } {
    const now = facts.t;
    const out: ChoiceOption[] = [];
    const reasons: Partial<Record<ChoiceKind, string>> = {};
    const skips: string[] = [];
    const layouts = v.layouts ?? [];
    const store = facts.store;
    const multi = layouts.filter((l) => l.farm).length > 1;
    const instances = (kind: string) => CHOOSE.instances.has(kind);
    // (`id`: that option's chores and ends only: make's and gather's, whose ids are goods and materials; a glass maker was
    // "on it" for torches, S.9's review, lens 2 L2)
    // (G2, MCAI_SOCIAL=off: no other member's name or activity in any option, E.8's (b2))
    const anon = socialOff();
    const others = (kind: ChoiceKind, id?: string) => {
      if (anon) return '';
      const names = [...this.chores.values()].filter((c) => c.village === v.name && c.agent !== a.name && !c.choice.ended && c.choice.kind === kind && (id === undefined || c.choice.option === id)).map((c) => c.agent);
      return names.length ? `; on it: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}` : '';
    };
    const record = (kind: ChoiceKind) => {
      const s = this.choiceStats.agentKind(v.name, a.name, kind);
      // (#17, MC_SKILL: the village's time beside the member's, "village ~9 min"; not under MCAI_SOCIAL=off)
      const vk = SKILL.on && !anon ? this.choiceStats.villageKind(v.name, kind) : null;
      const vt = vk ? `; village ~${Math.max(0.1, Math.round(vk.minutes * 10) / 10)} min` : '';
      return s ? `you: ${s.ok} of ${s.n} done, ~${Math.max(0.1, Math.round(s.minutes * 10) / 10)} min each${vt}` : `you: never done${vt}`;
    };
    const lastOf = (kind: ChoiceKind, id?: string) => {
      if (anon) return '';
      const l = this.choiceStats.villageLast(v.name, kind, id);
      return l ? `; last ${ago(now - l.at)}, ${l.ok ? 'done' : 'failed'}` : '';
    };
    const dist = (x: number, z: number) => {
      const p = a.bot.entity?.position;
      return p ? `${Math.round(Math.hypot(p.x - x, p.z - z))} blocks from you` : '';
    };
    // (#122: the gated options added, and the reason each kind's gate gives when they are taken off again)
    const gated = new Set<ChoiceOption>();
    const gateWhy: Partial<Record<ChoiceKind, string>> = {};
    const add = (o: Omit<ChoiceOption, 'holds'> & { holds?: string[] }, data: OptionRun) => {
      const opt: ChoiceOption = { holds: [], ...o, facts: o.facts.slice(0, 240) };
      OPTION_RUN.set(opt, data);
      out.push(opt);
    };

    // MC_HOME_BASICS: the member's own house gets a crafting table, a chest and a bed (spec runs/2026-10-24/home-basics),
    // early: ranked after a meal and growth, before the harvests (at 945 it fell off most menus, HB1; the chest is the
    // basics' chest); a bed short of wool: shear for it first (the
    // user's A(2), 10-24: shears from storage, or made from its iron)
    if (HOME_BASICS.on && !busy.has(`own:${a.name.toLowerCase()}`)) {
      const me = `own:${a.name.toLowerCase()}`;
      const st = v.structures.find((q) => q.owner === a.name && isDwelling(q.kind));
      const P = st ? this.decorParts(v).find((q) => q.structure.id === st.id) : undefined;
      const left = st && P?.basics ? basicsLeft(v, st.id, P.basics, !!v.homes?.[a.name]?.chest) : [];
      if (st && P?.basics && left.length) {
        const inv = (n: string) => a.bot.inventory?.items().filter((i) => i.name === n).reduce((t, i) => t + i.count, 0) ?? 0;
        const wool = woolInHand(a);
        const pool = wool && wool.n >= 3 ? { ...store, [wool.item]: (store[wool.item] ?? 0) + wool.n } : store;
        const short = left.map((q) => [q, basicsCost(q, pool)] as const).filter(([, c]) => 'short' in c);
        const at = P.basics.table ?? P.basics.chest ?? P.basics.bed!;
        if (short.length < left.length) add({
          id: 'own:basics', kind: 'own', key: me, excludes: [`${me}=`], name: 'Set up your own house', rank: 5, basic: true,
          // (#117: the tag names the need it meets, the bed first)
          ...(PROMPT_SELF ? { basicNeed: left.includes('bed') ? 'a bed' : left.includes('chest') ? 'a chest' : 'a crafting table' } : {}),
          at: { x: at.x, z: at.z },
          facts: `${basicsFacts(st.kind, left, short.map(([q, c]) => `${q}: ${(c as { short: string }).short}`))}; ${dist(at.x, at.z)}`,
          effect: 'a crafting table to craft at, a chest and a bed in your own house',
        }, { kind: 'own', what: 'basics' });
        else if (left.includes('bed')) {
          const shears = inv('shears') > 0 || (store.shears ?? 0) > 0;
          const sheep = sheepPlace(a, v);
          if (typeof sheep === 'string') reasons.own ??= `no wool for your bed: ${sheep}`;
          else if (!shears && (store.iron_ingot ?? 0) < 2 && (store.raw_iron ?? 0) < 2) reasons.own ??= 'no wool for your bed and no shears or 2 iron for a pair';
          else add({
            id: 'own:shear', kind: 'own', key: me, holds: [], excludes: [`${me}=`], name: 'Shear wool for your bed', rank: 8, basic: true,
            ...(PROMPT_SELF ? { basicNeed: 'a bed' } : {}),
            at: { x: sheep.x, z: sheep.z },
            facts: `your ${words(st.kind)} has no bed and storage has no wool; 3 wool from the sheep at ${sheep.x},${sheep.z}${shears ? '' : ', shears made from 2 iron first'}; ${dist(sheep.x, sheep.z)}`,
            effect: 'wool for a bed in your own house, then the bed',
          }, { kind: 'own', what: 'shear', make: !shears });
        } else reasons.own ??= `storage is short for your house: ${short.map(([q, c]) => `${q}: ${(c as { short: string }).short}`).join('; ')}`;
      }
      // #141 (MC_HOUSE_DECOR): basics in, the owner decorates its house from the trades' stock (2 pieces a chore, its taste's)
      if (HOUSE_DECOR && st && P?.slots && P.basics && !left.length) {
        const free = freeDecorSlots(v, P);
        const placed = houseDecorOf(v)[st.id] ?? [];
        const picks = free.length ? decorPicks(a.name, free, placed, store) : [];
        if (picks.length) {
          const at = picks[0].slot;
          const named = picks.map((p) => words(p.cost.block.replace(/\[.*$/, ''))).join(' and ');
          add({
            // (rank 190, before the farms: at 945 the fixed order took it once in 77 offers, H141D; a chore is a walk and 2 commands)
            id: 'own:decor', kind: 'own', key: me, excludes: [`${me}=`], name: 'Decorate your own house', rank: 190,
            at: { x: at.x, z: at.z },
            facts: `your ${words(st.kind)} has ${placed.length} decoration${placed.length === 1 ? '' : 's'} and room for ${free.length} more; storage pays for ${named}; ${dist(at.x, at.z)}`,
            effect: `${named} in your own house, in your own colour`,
          }, { kind: 'own', what: 'decor' });
        } else if (free.length) reasons.own ??= 'storage holds no decoration your house has room for';
      }
    }

    // #68 (MC_OWN): a chest in the member's own house, then its share carried home once 8 items are owed (ahead of the
    // makes from 32: a claimant busy on its plot never got to it, s43) (or any food
    // while its own chest holds under 2 meals), as far as the commons can spare them (makeSpare, less the meals others
    // are on their way to)
    if (OWN.on && this.homeOf(v, a.name) && !busy.has(`own:${a.name.toLowerCase()}`)) {
      const me = `own:${a.name.toLowerCase()}`;
      const own = v.homes?.[a.name];
      const st = v.structures.find((q) => q.owner === a.name && isDwelling(q.kind));
      const P = st ? this.decorParts(v).find((q) => q.structure.id === st.id) : undefined;
      if (!own?.chest) {
        if (P?.chest && !HOME_BASICS.on) add({
          id: 'own:chest', kind: 'own', key: me, excludes: [`${me}=`], name: 'Put a chest in your own house', rank: 940,
          // (#117: a chest of its own is a basic need, pinned and taken before the weights)
          ...(PROMPT_SELF ? { basic: true, basicNeed: 'a chest' } : {}),
          at: { x: P.chest.x, z: P.chest.z },
          facts: `your ${words(st!.kind)} has no chest; one takes 2 logs from storage; ${dist(P.chest.x, P.chest.z)}`,
          effect: 'a chest of your own: your share of what you bring in goes there',
        }, { kind: 'own', what: 'chest' });
        else reasons.own ??= HOME_BASICS.on ? 'your chest comes with your house\'s basics' : 'no cell for a chest';
      } else {
        const owed = own.owed;
        const total = Object.values(owed).reduce((t, q) => t + q, 0);
        const lowFood = foodPoints(own.chest.items) < 16 && Object.keys(owed).some((n) => FOOD_POINTS[n] !== undefined);
        if (total >= 8 || lowFood) {
          const spare = this.makeSpare(v, a.name);
          const meals = storeForMeals(v.name, store, a.name);
          const want: Counts = {};
          for (const [n, q] of Object.entries(owed)) {
            const k = Math.min(q, Math.floor(spare[n] ?? store[n] ?? 0), meals[n] ?? store[n] ?? 0);
            if (k > 0) want[n] = k;
          }
          const n = Object.values(want).reduce((t, q) => t + q, 0);
          if (n) add({
            id: 'own:carry', kind: 'own', key: me, excludes: [`${me}=`], name: 'Take your share home', rank: total >= 32 ? 880 : 941,
            // (a weight growing with what is owed: a claimant on a plot ripe every minute never chose it, s43)
            nw: Math.round(Math.min(3, 1 + total / 48) * 100) / 100,
            at: { x: own.chest.x, z: own.chest.z },
            facts: `owed you: ${Object.entries(owed).slice(0, 6).map(([k, q]) => `${q} ${words(k)}`).join(', ')}; the storage can spare ${n} now; ${dist(own.chest.x, own.chest.z)}`,
            effect: `${n} items into your own chest`,
          }, { kind: 'own', what: 'carry', want });
          else reasons.own ??= 'the storage cannot spare what is owed';
        } else reasons.own ??= total ? `${total} owed (under 8)` : 'nothing owed';
        // (#70: offers on the board it would take, the two worth most to it)
        if (BARTER.on) {
          const b = boardOf(v);
          const mineNow = available(b, a.name, own);
          const others: Counts = {};
          for (const [m, h] of Object.entries(v.homes ?? {})) if (m !== a.name && h.chest) for (const [k, q] of Object.entries(surplus(available(b, m, h)))) others[k] = (others[k] ?? 0) + q;
          const takes = b.offers.filter((o) => !busy.has(`offer:${o.id}`) && wouldTake(b, o, a.name, mineNow, others)).slice(0, 2);
          const h = v.storageHut;
          for (const o of takes) add({
            id: `own:trade:${o.id}`, kind: 'own', key: me, holds: [`offer:${o.id}`], excludes: [`${me}=`, `offer:${o.id}=`], name: `Trade ${o.wantN} ${words(o.want)} for ${o.giveN} ${words(o.give)} with ${anon ? `a member (offer ${o.id})` : o.by}`, rank: 939,
            ...(h ? { at: { x: Math.floor((h.x1 + h.x2) / 2), z: Math.floor((h.z1 + h.z2) / 2) } } : {}),
            facts: `${anon ? "a member's" : `${o.by}'s`} offer on the notice board by the storage hut; you can spare ${mineNow[o.want] ?? 0} ${words(o.want)}; posted ${ago(now - o.at)}`,
            effect: `+${o.giveN} ${words(o.give)}, -${o.wantN} ${words(o.want)} in your own chest`,
          }, { kind: 'own', what: 'trade', offer: o.id });
        }
        // (s43, MC_OWN_FARM: a wheat field of its own by its house, from the commons' spare seeds; one a member, one laid
        // out at a time in the village)
        if (OWN_FARM && !(v.layouts ?? []).some((l) => l.owner === a.name) && !busy.has('ownfarm') && !this.ownFarmBack.has(`${v.name}|${a.name}`)) {
          const st = v.structures.find((q) => q.owner === a.name && isDwelling(q.kind));
          // (the kinds the commons has plants for, best for this member first: the board's price, what it lacks, how many
          // own farms of the kind stand already; the best two offered by name)
          const spare = this.makeSpare(v, a.name);
          const standing: Counts = {};
          for (const l of v.layouts ?? []) if (l.owner) { const kd = l.farm ? 'wheat' : l.slots?.[0]?.kind; if (kd) standing[kd] = (standing[kd] ?? 0) + 1; }
          const holds = own.chest!.items, factor = boardOf(v).factor;
          const kinds = Object.entries(OWN_FARM_KINDS).filter(([, q]) => (spare[q.plant] ?? store[q.plant] ?? 0) >= q.need)
            .map(([kd]) => ({ kd, score: farmKindScore(kd, factor, holds, standing) })).sort((x, y) => y.score - x.score).slice(0, 2);
          // (a house too far from the storage hut for any field: no option, and the reason why)
          const hutAt = v.storageHut ? { x: (v.storageHut.x1 + v.storageHut.x2) / 2, z: (v.storageHut.z1 + v.storageHut.z2) / 2 } : undefined;
          const far = !!st && !!hutAt && ownFieldReach(hutAt, { x: Math.floor((st.x1 + st.x2) / 2), z: Math.floor((st.z1 + st.z2) / 2) }) < 8;
          if (far) reasons.own ??= 'your house is too far from the storage hut for a farm of your own';
          if (st && !far) for (const [i, { kd, score }] of kinds.entries()) add({
            id: `own:farm:${kd}`, kind: 'own', key: me, holds: ['ownfarm'], excludes: [`${me}=`, 'ownfarm='], name: `Start a ${words(kd)} farm of your own by your house`, rank: 948 + i,
            at: { x: Math.floor((st.x1 + st.x2) / 2), z: Math.floor((st.z1 + st.z2) / 2) },
            facts: `a 5x7 farm on a 9x9 pad within 24 blocks of your house, planted from the storage's ${words(OWN_FARM_KINDS[kd].plant)}; ${standing[kd] ?? 0} own ${words(kd)} farms stand; its harvests are all yours`,
            effect: `${words(OWN_FARM_KINDS[kd].product)} of your own (appeal ${Math.round(score * 100) / 100})`,
          }, { kind: 'own', what: 'farm', crop: kd });
          if (!st) reasons.own ??= 'no house for a farm beside';
          else if (!kinds.length) reasons.own ??= 'no plants in storage for a farm';
        }
        // (s43, MC_OWN_SALES: its surplus sold to the merchant, the levy to the storage; a tool it wants bought with emeralds)
        if (OWN_SALES_ON && v.merchant) {
          const sp = surplus(available(boardOf(v), a.name, own));
          const sold = (this.ownSold.get(v.name) ?? {}) as Counts;
          const sale = Object.entries(OWN_SALES).map(([n, per]) => ({ n, per, lots: Math.min(Math.floor((sp[n] ?? 0) / per), OWN_SALE_LOTS - (sold[n] ?? 0)) })).filter((x) => x.lots > 0)
            .sort((x, y) => y.lots - x.lots)[0];
          const at = { x: v.merchant.x, z: v.merchant.z };
          if (sale) add({
            id: `own:sell:${sale.n}`, kind: 'own', key: me, excludes: [`${me}=`], name: `Sell ${sale.lots * sale.per} ${words(sale.n)} of your own to the merchant`, rank: sale.lots >= 2 ? 885 : 946, at,
            // (a surplus big enough to sell weighs by its lots, as the share carried home: at 946 it lost to every make)
            nw: Math.min(3, 1 + sale.lots / 2),
            facts: `${sale.per} ${words(sale.n)} an emerald; ${sale.lots} emerald${sale.lots === 1 ? '' : 's'}, ${Math.round(LEVY * 100)}% of it to the village's storage as the levy; ${dist(at.x, at.z)}`,
            effect: `about ${Math.round(sale.lots * (1 - LEVY) * 10) / 10} emeralds in your own chest`,
          }, { kind: 'own', what: 'sell', item: sale.n, lots: sale.lots });
          const w = this.wantsOf(v, a.name);
          const em = own.chest!.items.emerald ?? 0;
          if (w?.tools.includes('a fishing rod') && em >= 2) add({
            id: 'own:buy:fishing_rod', kind: 'own', key: me, excludes: [`${me}=`], name: 'Buy a fishing rod of your own from the merchant', rank: 947, at,
            facts: `2 emeralds; you hold ${em}; ${dist(at.x, at.z)}`, effect: 'a fishing rod in your own chest',
          }, { kind: 'own', what: 'buy', item: 'fishing_rod' });
        }
        // (s43: food made from its own stock, its own chest to its own chest; a smelt burns the commons' fuel)
        const spare = this.makeSpare(v, a.name);
        const h = v.storageHut;
        [...OWN_RECIPES, ...(INNOVATE ? techOwnRecipes(v) : [])].forEach((r, i) => {
          const n = ownBatch(r, own.chest!.items);
          if (n <= 0) return;
          const plank = Object.keys(spare).find((k) => /_planks$/.test(k) && spare[k] >= n);
          const fuel: Counts = !r.smelt ? {} : (spare.charcoal ?? 0) >= 1 ? { charcoal: 1 } : plank ? { [plank]: n } : { none: 1 };
          if (fuel.none) {
            reasons.own ??= 'no fuel to spare for a smelt';
            return;
          }
          add({
            id: `own:make:${r.item}`, kind: 'own', key: me, excludes: [`${me}=`], name: `Make ${words(r.item)} from your own stock`, rank: 942 + i,
            ...(h ? { at: { x: Math.floor((h.x1 + h.x2) / 2), z: Math.floor((h.z1 + h.z2) / 2) } } : {}),
            facts: `your own chest: ${Object.entries(r.inputs).map(([k, q]) => `${own.chest!.items[k] ?? 0} ${words(k)} (${q} a ${words(r.item)})`).join(', ')}; ${r.smelt ? `smelted at a works furnace with ${Object.entries(fuel).map(([k, q]) => `${q} ${words(k)}`).join('')} of the village's fuel` : "crafted at the hut's table"}; your own food made: ${Object.entries(own.made ?? {}).map(([k, q]) => `${q} ${words(k)}`).join(', ') || 'none yet'}`,
            effect: `+${n} ${words(r.item)} in your own chest`,
          }, { kind: 'own', what: 'make', item: r.item, n, fuel });
        });
      }
    }

    // (#108, MC_PAY: a priced request's goods earmarked for its buyer, carried to the buyer's own chest; ahead of the own
    // options, as the price is paid only once they arrive)
    if (PAY.on && !this.payTestHold) for (const k of deliveriesOf(v, a.name).slice(0, 1)) {
      const me = `own:${a.name.toLowerCase()}`;
      const home = v.homes?.[k.payer]?.chest;
      add({
        id: `own:deliver:${k.id}`, kind: 'own', key: me, excludes: [`${me}=`], name: `Deliver ${deliveryWords(k)} to ${k.payer}'s own chest`, rank: 860,
        ...(home ? { at: { x: home.x, z: home.z } } : {}),
        facts: `${k.payer} pays ${k.price} emerald${k.price === 1 ? '' : 's'} once the goods reach their chest (less the levy); held in storage for them${home ? `; ${dist(home.x, home.z)}` : ''}`,
        effect: `+${k.price} emerald${k.price === 1 ? '' : 's'} to your own chest`,
      }, { kind: 'own', what: 'deliver', contract: k.id });
    }

    // s43's innovation (MC_INNOVATE): experiments on the candidates (the library's entries the village could try now,
    // ranked by wants nobody filled and gluts they would use), the curious drawn most; and pledges toward them from
    // members who asked for their goods in vain
    if (INNOVATE && v.complete) {
      const b = boardOf(v);
      const wants: Counts = {};
      for (const o of b.offers) if (o.state === 'lapsed' && (o.endAt ?? 0) > now - 30 * 60000) wants[o.want] = (wants[o.want] ?? 0) + 1;
      const held: Counts = {};
      for (const h of Object.values(v.homes ?? {})) for (const [k, q] of Object.entries(h.chest?.items ?? {})) held[k] = (held[k] ?? 0) + q;
      const t = techOf(v);
      const tv = TEMPERAMENT_MODE !== 'off' ? temperament(a.name) : null;
      // (s44, the user's: entries started or wanted on everyone's menu, the untouched rest for curious members only)
      const plan = (b: Counts) => this.materials.plan(b);
      for (const c of candidates(v, store, wants, held, now, v.mine?.ironMade ?? []).filter((x) => x.demand || x.started || (tv?.curiosity ?? 0) >= 0.5 || (GOALS_ON && goalsOf(v)?.of[a.name] === 'invention')).slice(0, 2)) {
        const key = `innovate:${c.e.id}`;
        if (busy.has(key)) continue;
        const chance = chanceFor(c.e, t.tries[`${c.e.id}|${a.name}`] ?? 0);
        const need = needOf(v, c.e, plan), done = pointsIn(v, c.e.id), mine = t.points[c.e.id]?.[a.name] ?? 0;
        const others = Object.entries(t.points[c.e.id] ?? {}).filter(([m, q]) => m !== a.name && q > 0).sort((x, y) => y[1] - x[1]).slice(0, 2);
        const earlier = t.attempts[`${c.e.id}|${a.name}`] ?? 0, cur = tv?.curiosity ?? 0;
        const h = v.storageHut;
        add({
          id: key, kind: 'innovate', key, excludes: [`${key}=`], name: `Experiment with ${c.e.name}`, rank: 955,
          ...(h ? { at: { x: Math.floor((h.x1 + h.x2) / 2), z: Math.floor((h.z1 + h.z2) / 2) } } : {}),
          facts: `research ${ptsText(done)} of ${ptsText(need)} points${done ? ` (you ${ptsText(mine)}${anon ? '' : others.map(([m, q]) => `, ${m} ${ptsText(q)}`).join('')})` : ''}; ${c.why.join('; ') || 'one step from what the village has'}; an attempt takes ${Object.entries(c.e.attempt).map(([k, q]) => `${q} ${words(k)}`).join(', ')} from storage${c.e.success ? ` (and ${Object.entries(c.e.success).map(([k, q]) => `${q} ${words(k)}`).join(', ')} if it goes well)` : ''} and ~${c.e.minutes} min; your chance ${Math.round(chance * 100)}%: +${ptsText(attemptPoints(true, cur, earlier, c.boost))} points if it goes well, +${ptsText(attemptPoints(false, cur, earlier, c.boost))} if not`,
          effect: `research toward ${c.e.goods.map((g) => g.words).join(' and ')} (${ptsText(need)} points to unlock)${OWN.on ? `; once unlocked its researchers and pledgers share ${Math.round(ROYALTY * 100)}% of every batch made, by points` : ''}`,
          ...(tv ? { ww: Math.round(2.5 ** tv.curiosity * 100) / 100 } : {}),
        }, { kind: 'innovate', entry: c.e.id, chance, boost: c.boost });
        // (a pledge from a member whose offers asked in vain for the candidate's goods, one a member and entry)
        const own = v.homes?.[a.name];
        // (or one sitting on a glut the candidate would use: its pumpkins worth something once pies are made)
        const asked = b.offers.some((o) => o.by === a.name && o.state === 'lapsed' && c.e.goods.some((g) => g.item === o.want))
          || c.e.uses.some((u) => (own?.chest?.items[u] ?? 0) >= 32);
        // (none once its pledges are full: half the need, s44)
        if (OWN.on && own?.chest && asked && !(t.pledges[c.e.id] ?? []).some((q) => q.by === a.name) && (t.pledgePts[c.e.id] ?? 0) < Math.floor(needOf(v, c.e, plan) / 2)) {
          const em = own.chest.items.emerald ?? 0;
          const sp = surplus(available(b, a.name, own));
          const pay = em >= 1 ? { item: 'emerald', n: 1 } : Object.entries(sp).sort((x, y) => y[1] - x[1]).map(([k, q]) => ({ item: k, n: Math.min(q, 4) }))[0];
          if (pay) add({
            id: `own:pledge:${c.e.id}`, kind: 'own', key: `own:${a.name.toLowerCase()}`, excludes: [`own:${a.name.toLowerCase()}=`], name: `Pledge ${pay.n} ${words(pay.item)} toward ${c.e.name}`, rank: 944,
            ...(h ? { at: { x: Math.floor((h.x1 + h.x2) / 2), z: Math.floor((h.z1 + h.z2) / 2) } } : {}),
            facts: `${c.e.goods.map((g) => g.words).join(' or ')} would answer what you asked for or use what you hold too much of; a pledge adds research points (${ptsText(pointsIn(v, c.e.id))} of ${ptsText(needOf(v, c.e, plan))} so far) and goes to its researchers when it is unlocked (${(t.pledges[c.e.id] ?? []).length} pledges so far); your points also earn you a share of the ${Math.round(ROYALTY * 100)}% royalty on every batch made after`,
            effect: `-${pay.n} ${words(pay.item)} from your own chest, held on the board for the inventor`,
          }, { kind: 'own', what: 'pledge', entry: c.e.id, item: pay.item, n: pay.n });
        }
      }
    }

    // A meal first (s30's appetite, D11): a peckish member's own, while storage holds food and one of APPETITE.eaters
    // places at the hut is free (25 withdrawers at once would crowd its chest spots)
    const ap = appetiteOn(v) ? v.food!.members[a.name] : undefined;
    const state = ap ? stateOf(ap.level) : 'fed';
    if (ap && state !== 'fed') {
      // (from what the meals other members are on their way to leave: the record stays as it was until each has withdrawn,
      // lens 1 M1)
      const food = storeForMeals(v.name, store, a.name);
      const meal = chooseMeal(ap.level, food);
      const me = `eat:${a.name.toLowerCase()}`;
      const k = Array.from({ length: APPETITE.eaters }, (_, i) => i + 1).find((i) => !busy.has(`eaters:${i}`));
      // (#68: a meal of its own first, eaten at its own door; no hut place held)
      const mine = OWN.on ? v.homes?.[a.name]?.chest : undefined;
      const ownMeal = mine ? chooseMeal(ap.level, mine.items) : null;
      if (ownMeal && !busy.has(me)) {
        const after = Math.min(APPETITE.cap, ap.level + ownMeal.n * FOOD_POINTS[ownMeal.item]);
        add({
          id: 'eat:own', kind: 'eat', key: me, excludes: [`${me}=`], name: 'Eat a meal from your own chest', rank: -1,
          at: { x: mine!.x, z: mine!.z },
          facts: `you: appetite ${Math.round(ap.level)} of 20; your own chest: ${foodText(mine!.items)}; ${dist(mine!.x, mine!.z)}`,
          effect: `back to about ${Math.round(after)} of 20 (${ownMeal.n} ${words(ownMeal.item)})`,
        }, { kind: 'eat', level: ap.level, item: ownMeal.item, n: ownMeal.n, own: true });
        reasons.eat ??= 'eats from its own chest';
      } else if (!meal) reasons.eat = 'no food in storage';
      else if (busy.has(me) || k === undefined) reasons.eat = 'busy';
      else {
        const after = Math.min(APPETITE.cap, ap.level + meal.n * FOOD_POINTS[meal.item]);
        const h = v.storageHut;
        add({
          id: 'eat', kind: 'eat', key: me, holds: [`eaters:${k}`], excludes: [`${me}=`, `eaters:${k}=`], name: 'Eat a meal from the storage', rank: 0,
          ...(h ? { at: { x: Math.floor((h.x1 + h.x2) / 2), z: Math.floor((h.z1 + h.z2) / 2) } } : {}),
          facts: `you: appetite ${Math.round(ap.level)} of 20 (hungry at ${APPETITE.hungryAt}: then only food work); storage: ${foodText(food)}`,
          effect: `back to about ${Math.round(after)} of 20 (${meal.n} ${words(meal.item)})`,
        }, { kind: 'eat', level: ap.level, item: meal.item, n: meal.n });
      }
    }

    // The wheat fields
    for (const [i, lay] of layouts.entries()) {
      if (!lay.farm) continue;
      const k = i + 1;
      const f = facts.field(String(k));
      if (!f) {
        reasons.farm ??= 'nothing ripe';
        continue;
      }
      const excludes = [`farm:${k}`, 'pen'];
      if (excluded(excludes, first?.k === k ? first.busy : busy)) {
        reasons.farm ??= 'busy';
        continue;
      }
      // (a field work's by its number among the fields: several on one menu, the field spec's check 9)
      const name = lay.grow ? `Harvest the wheat field of neighbourhood ${lay.grow}` : lay.field ? `Harvest wheat field ${layouts.slice(0, k).filter((l) => l.field).length}` : `Harvest the wheat field${multi && k > 1 ? ' of the second plot' : ''}`;
      add({
        id: `farm:${k}`, kind: 'farm', key: `farm:${k}`, excludes, name, rank: 10 + k, at: { x: Math.floor((lay.farm.x1 + lay.farm.x2) / 2), z: Math.floor((lay.farm.z1 + lay.farm.z2) / 2) },
        facts: `${f.ripe} of ${f.grown} ripe; ${dist((lay.farm.x1 + lay.farm.x2) / 2, (lay.farm.z1 + lay.farm.z2) / 2)}; storage: ${store.wheat ?? 0} wheat, ${store.wheat_seeds ?? 0} seeds, ${store.bread ?? 0} bread; ${record('farm')}${others('farm')}${lastOf('farm')}`,
        effect: `about ${f.ripe} wheat and seeds`,
      }, { kind: 'farm', k, ripe: f.ripe, grown: f.grown });
    }

    // Ripe farm slots
    for (const [i, lay] of layouts.entries())
      for (const [jj, slot] of (lay.slots ?? []).entries()) {
        if (!slot.kind || !SLOT_KINDS[slot.kind]) continue;
        const k = i + 1, j = jj + 1;
        const f = facts.slot(`${k}:${j}`);
        if (!f) {
          reasons.slot ??= 'nothing ripe';
          continue;
        }
        const excludes = [`slot:${k}:${j}`, 'pen'];
        if (excluded(excludes, busy)) {
          reasons.slot ??= 'busy';
          continue;
        }
        add({
          id: `slot:${k}:${j}`, kind: 'slot', key: `slot:${k}:${j}`, excludes, name: `Harvest the ${words(slot.kind)} farm${lay.grow ? ` of neighbourhood ${lay.grow}` : layouts.length > 1 && k > 1 ? ' of the second plot' : ''}${(lay.slots ?? []).filter((s) => s.kind === slot.kind).length > 1 ? ` on slot ${numberWord(j)}` : ''}`,
          rank: 100 + 10 * k + j, at: { x: Math.floor((slot.x1 + slot.x2) / 2), z: Math.floor((slot.z1 + slot.z2) / 2) },
          facts: `${f.ripe} ripe${f.topUp ? `; ${slot.cells?.length ?? 0} of ${CANE_FULL} stalks planted, ${f.topUp} more to plant from storage` : ''}; ${dist((slot.x1 + slot.x2) / 2, (slot.z1 + slot.z2) / 2)}; ${record('slot')}${others('slot')}${lastOf('slot')}`,
          effect: f.topUp ? `${f.ripe ? `about ${f.ripe} ${words(slot.kind)} and ` : ''}a fuller cane farm (+${f.topUp} stalks)` : `about ${f.ripe} ${words(slot.kind)}`,
        }, { kind: 'slot', k, j, ripe: f.ripe, slotKind: slot.kind });
      }

    // Farm starts: a free slot started with a kind found near the village. Single keys: one start at a time, on the first
    // free slot, with the first kind seen (today's); instances: up to two at once, on different slots and of different
    // kinds (each holds its slot and its kind, spec 3)
    const freeSlots = layouts.flatMap((lay, i) => (lay.slots ?? []).map((slot, jj) => ({ slot, k: i + 1, j: jj + 1 })))
      .filter(({ slot, k, j }) => !slot.annex && !slot.kind && !slotBusy.has(`${v.name}:${k}:${j}`) && effTries(slot.tries, slot.lastTry?.at, now) < 3 && (!slot.lastTry || now - slot.lastTry.at > 10 * 60000)
        // (a neighbourhood's slot once its plot is prepared: it is laid out while the village stands complete, s30's food step)
        && (!layouts[k - 1]?.grow || !!preparedAt(v, slot)));
    const startInst = instances('start');
    const freeOpen = startInst ? freeSlots.filter(({ k, j }) => !busy.has(`start:${k}:${j}`)) : freeSlots.slice(0, 1);
    const want = startInst ? Math.min(2, freeOpen.length) : freeOpen.length ? 1 : 0;
    if (!freeOpen.length) reasons.start = freeSlots.length ? 'free slots taken' : 'no free slot';
    else if (startInst ? busy.has('pen') : busy.has('start') || busy.has('pen')) reasons.start = 'busy';
    else {
      const free = freeOpen[0];
      const farmed = new Set(layouts.flatMap((l) => (l.slots ?? []).map((q) => q.kind)).filter(Boolean));
      // (with neighbourhood farms, s30's D4: a slot may take a kind the village farms on another layout, started from storage)
      const here = GROW_FARMS ? new Set((layouts[free.k - 1]?.slots ?? []).map((q) => q.kind).filter(Boolean)) : farmed;
      const badSeen = new Set(layouts.flatMap((l) => (l.slots ?? []).flatMap((q) => q.bad ?? [])));
      const home = facts.startHome;
      let found = 0;
      for (const [s, kind] of SLOT_ORDER.entries()) {
        if (found >= want) break;
        const skip = `${v.name}:${kind}`;
        if (here.has(kind)) continue;
        // (a kind another start holds: not walked, not skipped)
        if (startInst && busy.has(`farmkind:${kind}`)) continue;
        // (#21, MC_LETTERS: the age of letters' first cane farm from storage, the merchant's cane, spec 9 B1)
        const seed = kind === 'sugar_cane' && !farmed.has(kind) && lettersCurrent(v);
        if (farmed.has(kind) || seed) {
          // Farmed elsewhere: from storage when it holds a start's worth (its harvests are the stock), never from a sighting
          const spec = SLOT_KINDS[kind];
          const stock = store[spec.take] ?? 0;
          if (stock < spec.count) continue;
          found++;
          const fs = layouts[free.k - 1]?.slots?.[free.j - 1];
          const key = startInst ? `start:${free.k}:${free.j}` : 'start';
          const excludes = startInst ? [`start:${free.k}:${free.j}=`, `farmkind:${kind}=`, 'pen'] : ['start', 'pen'];
          add({
            id: `start:${kind}`, kind: 'start', key, holds: startInst ? [`farmkind:${kind}`] : [], excludes, name: `Start a ${words(kind)} farm`, rank: 200 + s,
            ...(fs ? { at: { x: Math.floor((fs.x1 + fs.x2) / 2), z: Math.floor((fs.z1 + fs.z2) / 2) } } : {}),
            facts: `from storage (${stock} ${words(spec.take)} there; ${seed ? 'bought from the merchant for the age of letters' : `the village farms ${words(kind)} on another slot`}); ${freeSlots.length} free slot${freeSlots.length === 1 ? '' : 's'}; ${record('start')}${others('start')}`,
            effect: `a ${words(kind)} farm to harvest${layouts[free.k - 1]?.grow ? ` in neighbourhood ${layouts[free.k - 1].grow}` : ''}`,
          }, { kind: 'start', k: free.k, j: free.j, slotKind: kind, x: 0, y: 0, z: 0, store: true });
          continue;
        }
        if (seed) continue;
        if ((this.slotSkip.get(skip) ?? 0) > now || !home) continue;
        const ok = facts.ok();
        const seen = facts.sightings(kind)
          // (bad by column, F192; cane by the blocks a cut can take, which must cover the two a start needs: the atlas counts
          // a stalk's blocks above its base for cane, and a one-stalk sighting of two blocks gave one and failed twice)
          .find(([x, y, z, n]) => ok({ x, y, z }) && !badSeen.has(`${kind}@${x},${z}`) && !badSeen.has(`${kind}@${x},${y},${z}`) && (kind !== 'sugar_cane' || n >= 2));
        if (!seen) {
          skips.push(skip);
          continue;
        }
        found++;
        const [x, y, z, n] = seen;
        const key = startInst ? `start:${free.k}:${free.j}` : 'start';
        const excludes = startInst ? [`start:${free.k}:${free.j}=`, `farmkind:${kind}=`, 'pen'] : ['start', 'pen'];
        const tries = layouts.flatMap((l) => l.slots ?? []).filter((q) => q.lastTry?.kind === kind).reduce((t, q) => t + (q.tries ?? 0), 0);
        add({
          id: `start:${kind}`, kind: 'start', key, holds: startInst ? [`farmkind:${kind}`] : [], excludes, name: `Start a ${words(kind)} farm`, rank: 200 + s, at: { x, y, z },
          facts: `${words(kind)} seen ${Math.round(Math.hypot(x - home!.x, z - home!.z))} blocks from the storage${kind === 'sugar_cane' ? ` (${n} stalks)` : ''}; ${freeSlots.length} free slot${freeSlots.length === 1 ? '' : 's'}; ${record('start')}${tries ? `; the village tried this kind ${tries} time${tries === 1 ? '' : 's'}` : ''}${others('start')}`,
          effect: `a ${words(kind)} farm to harvest`,
        }, { kind: 'start', k: free.k, j: free.j, slotKind: kind, x, y, z });
      }
      if (!found) reasons.start = 'nothing seen to farm';
    }

    // The annex (before its pens)
    const lay0 = layouts[0];
    const ax = lay0?.annex;
    if (!lay0 || !v.plots.some((p) => !p.annex) || ax?.state === 'ready') reasons.annex = ax?.state === 'ready' ? 'ready' : 'no layout';
    else if (annexBusy.has(v.name) || excluded(['annex'], busy)) reasons.annex = 'busy';
    else if (effTries(ax?.tries, ax?.lastTry?.at, now) >= 3 || (ax?.lastTry && now - ax.lastTry.at < 10 * 60000)) reasons.annex = 'backing off';
    else
      add({
        id: 'annex', kind: 'annex', key: 'annex', excludes: ['annex'], name: 'Prepare the annex for animal pens', rank: 300,
        facts: `${ax && ax.x2 >= ax.x1 ? `${ax.x2 - ax.x1 + 1}x${ax.z2 - ax.z1 + 1} at ${ax.x1},${ax.z1}, tried ${effTries(ax.tries, ax.lastTry?.at, now)} times` : `a ${PEN_VARIETY ? '25x13' : '13x9'} field beside the village, not started`}; ${record('annex')}${others('annex')}`,
        // (#139, MC_PEN_VARIETY: pens of the village's own sizes and shapes)
        effect: PEN_VARIETY ? 'room for three or four pens of different sizes, for chickens, sheep, pigs or cows' : 'room for two pens',
      }, { kind: 'annex', again: !!(ax && ax.x2 >= ax.x1), area: ax ? `${ax.x1},${ax.z1}..${ax.x2},${ax.z2}` : '' });

    // Pens on the annex: one with animals of each kind (no harvest, farm start or other lure beside it, the pen review's L3;
    // nor while the works plot beside the annex is prepared, S.9)
    const penEx = ['pen', 'annex', 'start', 'slot', 'farm', 'works'];
    if (!lay0 || ax?.state !== 'ready') reasons.pen = 'no annex';
    else if (excluded(penEx, busy)) reasons.pen = 'busy';
    else {
      const slots = (lay0.slots ?? []).map((slot, jj) => ({ slot, j: jj + 1 })).filter(({ slot }) => slot.annex);
      for (const [p, kind] of PEN_ORDER.entries()) {
        if (slots.some(({ slot }) => slot.kind === kind && (slot.pen?.animals ?? 0) >= 2)) continue;
        // (a lure storage holds; seeds also come from the grass. #139: a pig's carrots, potatoes or beetroot)
        const lure = penLure(kind, store);
        if (lure !== 'wheat_seeds' && !(store[lure] ?? 0)) continue;
        const by = ax.penBy?.[kind];
        // (an entry over an hour old is forgiven: the sweep deletes it)
        if (by && now - by.at <= 60 * 60000 && (by.tries >= 3 || now - by.at < 10 * 60000)) continue;
        // (#139: a free pen whose size suits the kind's herd)
        const pick = slots.find(({ slot }) => slot.kind === kind && !slot.laying) ?? (PEN_VARIETY ? penSlotFit(kind, slots.filter(({ slot }) => !slot.kind).map((q) => ({ ...q, shape: q.slot.shape }))) : slots.find(({ slot }) => !slot.kind));
        if (!pick || slotBusy.has(`${v.name}:1:${pick.j}`)) continue;
        const near = facts.animals(kind);
        const dy = (s: { y: number }) => s.y - (ax.y + 1);
        const seen = near.find((s) => Math.abs(dy(s)) <= 4) ?? near.find((s) => dy(s) >= -4 && dy(s) <= 8);
        if (!seen) continue;
        const [x, y, z] = [Math.floor(seen.x), Math.floor(seen.y), Math.floor(seen.z)];
        const many = kind === 'sheep' ? 'sheep' : `${kind}s`;
        const size = PEN_VARIETY ? `the ${penWords(pick.slot)} pen (room for ${penCap(kind, pick.slot)}); ` : '';
        const gives = kind === 'chicken' ? 'eggs' : kind === 'cow' || kind === 'goat' ? 'milk' : kind === 'sheep' ? 'wool' : '';
        add({
          id: `pen:${kind}`, kind: 'pen', key: 'pen', excludes: penEx, name: `Lead ${many} into a pen`, rank: 400 + p, at: { x, y, z },
          facts: `the nearest ${kind} seen ${Math.round(Math.hypot(seen.x - (ax.x1 + ax.x2) / 2, seen.z - (ax.z1 + ax.z2) / 2))} blocks from the annex, ${Math.abs(Math.round(dy(seen)))} ${dy(seen) >= 0 ? 'above' : 'below'} it; ${size}${store[lure] ?? 0} ${words(lure)} in storage; tried ${by && now - by.at <= 60 * 60000 ? by.tries : 0} times; ${record('pen')}`,
          effect: `a pen of ${many} to breed${PEN_VARIETY && gives ? ` (${gives})` : ''}`,
        }, { kind: 'pen', j: pick.j, slotKind: kind, x, y, z });
      }
      if (!out.some((o) => o.kind === 'pen')) reasons.pen = 'no animals to lead';
    }

    // A pen's own work, then the cake (the annex ready and its plot recorded, C3)
    const annexPlot = v.plots.find((p) => p.annex);
    if (!lay0 || ax?.state !== 'ready' || !annexPlot) {
      reasons.penwork = 'no pens';
      reasons.cake = 'no annex';
    } else {
      const scale = timeScale();
      const due = (pen: { workAt?: Record<string, number> }, what: string, minutes: number) => now - (pen.workAt?.[what] ?? 0) > minutes * 60000;
      for (const [jj, slot] of (lay0.slots ?? []).entries()) {
        const j = jj + 1, pen = slot.pen;
        const spec = slot.kind ? PEN_KINDS[slot.kind] : undefined;
        if (!slot.annex || !spec || !pen?.built || slot.laying || !(pen.animals ?? 0) || slotBusy.has(`${v.name}:1:${j}`)) continue;
        const excludes = [`penwork:${j}`];
        if (excluded(excludes, busy)) {
          reasons.penwork ??= 'busy';
          continue;
        }
        const works: Array<[number, string, string, string, string]> = [];
        if (slot.kind === 'chicken' && due(pen, 'eggs', 1) && facts.eggs(String(j))) works.push([0, 'eggs', 'collect_eggs', 'Collect eggs in the chicken pen', 'eggs lying in the pen']);
        if ((slot.kind === 'cow' || slot.kind === 'goat') && (store.bucket ?? 0) > 0 && (store.milk_bucket ?? 0) < 3 && due(pen, 'milk', 2)) works.push([1, 'milk', 'milk_cows', `Milk the ${slot.kind}s`, `${store.bucket ?? 0} buckets and ${store.milk_bucket ?? 0} milk in storage`]);
        // (#139: a sheep pen's wool, with shears from storage; wool grows back on grass)
        if (slot.kind === 'sheep' && (store.shears ?? 0) > 0 && due(pen, 'shear', 5 / scale)) works.push([3, 'shear', 'shear_pen', 'Shear the sheep in the pen', `${store.shears} shears in storage; ${pen.wool ?? 0} wool sheared here so far`]);
        // (never the seeds a field's open planting still needs: G3f's neighbourhood field was sown half, s30)
        const lure = penLure(slot.kind!, store), cap = penCap(slot.kind!, slot);
        const feed = (store[lure] ?? 0) - (lure === 'wheat_seeds' ? seedsForFields(v) : 0);
        if ((pen.animals ?? 0) >= 2 && (pen.animals ?? 0) < cap && feed >= 2 && due(pen, 'breed', 5 / scale)) works.push([2, 'breed', 'breed_pen', `Breed the ${slot.kind === 'sheep' ? 'sheep' : `${slot.kind}s`}`, `${store[lure] ?? 0} ${words(lure)} in storage${PEN_VARIETY ? `; room for ${cap}` : ''}`]);
        const twin = (lay0.slots ?? []).filter((s) => s.annex && s.kind === slot.kind && s.pen?.built).length > 1;
        for (const [w, what, skill, name, fact] of works) {
          const last = pen.workAt?.[what];
          add({
            id: `penwork:${j}:${what}`, kind: 'penwork', key: `penwork:${j}`, excludes, name: `${name}${twin ? ` on slot ${numberWord(j)}` : ''}`, rank: 500 + 10 * j + w,
            at: { x: Math.floor((slot.x1 + slot.x2) / 2), z: Math.floor((slot.z1 + slot.z2) / 2) },
            facts: `${pen.animals} ${slot.kind === 'sheep' ? 'sheep' : `${slot.kind}s`} in the pen; ${fact}; ${last ? `last done ${ago(now - last)}` : 'never done'}; ${record('penwork')}`,
            effect: what === 'eggs' ? 'eggs into storage' : what === 'milk' ? 'milk buckets toward a cake' : what === 'shear' ? 'wool into storage, for beds, banners and carpets' : `a young ${slot.kind}`,
          }, { kind: 'penwork', j, what, skill, slotKind: slot.kind ?? '', animals: pen.animals ?? 0 });
        }
      }
      if (!out.some((o) => o.kind === 'penwork')) reasons.penwork ??= 'nothing due';
      // The cake (at most two in storage; with an appetite one for six members, s30's D13)
      const cakeCap = appetiteOn(v) ? Math.max(2, Math.ceil(this.growMembers(v).length / 6)) : 2;
      if (excluded(['cake'], busy)) reasons.cake = 'busy';
      else if (cakeShort(store).length) reasons.cake = 'storage short';
      else if ((store.cake ?? 0) >= cakeCap) reasons.cake = cakeCap === 2 ? 'two cakes stored' : `${cakeCap} cakes stored`;
      else if (now - (this.cakeAt.get(v.name) ?? 0) <= 5 * 60000) reasons.cake = 'backing off';
      else
        add({
          id: 'cake', kind: 'cake', key: 'cake', excludes: ['cake'], name: 'Bake a cake', rank: 600,
          facts: `storage has ${store.milk_bucket ?? 0} milk, ${EGGS.reduce((s, e) => s + (store[e] ?? 0), 0)} eggs, ${store.wheat ?? 0} wheat, ${store.sugar ?? 0} sugar, ${store.sugar_cane ?? 0} sugar cane; ${store.cake ?? 0} cakes stored; ${record('cake')}`,
          // (what it is for, not only what it makes: choicebench's labelled case went to a dull scout 7 times in 10, s28)
          effect: `+1 cake, the village's best food (${store.cake ?? 0} stored); uses the milk, egg, wheat and sugar storage holds now`,
        }, { kind: 'cake' });
    }

    // The iron age: an iron pickaxe once storage holds 3 iron, then a bucket; while short, trips to the iron level (not
    // while milking or the cake hold the buckets: storage reads none then, the fixes review's M1)
    const m = v.mine;
    // (G8, MC_IRON_AGE: dig, smelt and forge as kinds any number may hold, spec 4.1)
    if (IRON_AGE) this.ironAgeOptions(v, a, busy, store, now, reasons, add, record, lastOf, others);
    else if (!m || m.level === undefined) reasons.iron = 'no mine';
    else if (excluded(['iron', 'cake', 'penwork'], busy)) reasons.iron = 'busy';
    else {
      const made = m.ironMade ?? [];
      // (three buckets once a cow pen holds cows: a cake takes three milk buckets at once, pens v2)
      const cows = (lay0?.slots ?? []).some((s) => s.annex && (s.kind === 'cow' || s.kind === 'goat') && (s.pen?.animals ?? 0) > 0);
      // (buckets the village holds count too: VanC2 was stocked with three and still made one)
      const buckets = Math.max(made.filter((t) => t === 'bucket').length, (store.bucket ?? 0) + (store.milk_bucket ?? 0));
      const iron = (store.raw_iron ?? 0) + (store.iron_ingot ?? 0);
      const tool = made.includes('iron_pickaxe') ? 'bucket' : 'iron_pickaxe';
      const stage = iron >= 3 ? tool : 'dig';
      // (failed stages forgiven after an hour, as the farm slots': the sweep resets them)
      const triesAll = m.ironTries && m.ironLastTry && now - m.ironLastTry.at > 60 * 60000 ? {} : m.ironTries ?? {};
      const t = (triesAll as Record<string, number>)[stage] ?? 0, last = m.ironLastTry;
      if (made.includes('iron_pickaxe') && buckets >= (cows ? 3 : 1)) reasons.iron = 'tools made';
      else if (stage === 'dig' && m.iron?.finished) reasons.iron = 'iron level finished';
      else if (t >= 3 || (last?.stage === stage && now - last.at < 10 * 60000)) reasons.iron = 'backing off';
      else
        add({
          id: `iron:${stage}`, kind: 'iron', key: 'iron', excludes: ['iron', 'cake', 'penwork'],
          name: stage === 'dig' ? 'Dig for iron in the mine' : stage === 'iron_pickaxe' ? 'Make an iron pickaxe' : 'Make a bucket', rank: 700,
          facts: `${iron} iron in storage; ${made.length ? `made: ${made.map(words).join(', ')}` : 'no iron tools made'}; ${stage === 'dig' ? `the iron level ${m.iron ? 'being dug' : 'not started'}` : `${words(stage)} next`}; tried ${t} times; ${record('iron')}${lastOf('iron')}`,
          // (what the tool is for: the bucket case went to a 1-ripe harvest or a scout 6 times in 10, s28)
          effect: stage === 'dig' ? `iron toward ${tool === 'bucket' ? 'a bucket' : 'an iron pickaxe'} (${iron} of 3 in storage)`
            : stage === 'bucket' ? `a bucket (the village has ${buckets}${cows ? '; the penned cows can be milked only with buckets, and a cake takes 3 milk' : '; milk once cows are penned'})`
            : 'an iron pickaxe, the first iron tool (a bucket comes next)',
        }, { kind: 'iron', stage, tool, iron });
    }

    // Exploring: ring points FARM_TRIP_RANGE from home, the least known first, each point once (the bots at home already
    // see ~128 blocks: view distance 8, the design review's H3); only while a farm slot is free (there is nothing else to
    // find for yet, the diff review's L4); single keys: one trip at a time, not while a start may fill the slot, and not
    // beside a lure; instances: a trip a point, free slot or not (A2f, s28: two starts took both free slots in the first
    // sweep and the eight points left every menu while 21 of 25 idled; a scout's sightings feed the pens and later farms
    // too), beside a lure as well (F224, live 10-14: a scout walking past or through a led herd changed nothing; the scout
    // skill puts a lure in hand away first, as one held took an animal away)
    const exInst = instances('explore');
    const exFree = exInst || freeSlots.length > 0;
    const ex = v.explore;
    const exHome = facts.exploreHome;
    if (!exFree) reasons.explore = 'no free slot';
    else if (!exInst && excluded(['explore', 'start', 'pen'], busy)) reasons.explore = 'busy';
    else if (ex?.done) reasons.explore = 'explored';
    else if (!exHome) reasons.explore = 'no home';
    else {
      const visited = ex?.visited ?? [];
      const points = Array.from({ length: 8 }, (_, i) => ({ i, x: Math.round(exHome.x + FARM_TRIP_RANGE * Math.cos((i * Math.PI) / 4)), z: Math.round(exHome.z + FARM_TRIP_RANGE * Math.sin((i * Math.PI) / 4)) }))
        .filter((q) => !visited.includes(q.i)).map((q) => ({ ...q, known: facts.known(`${q.x},${q.z}`) }))
        .sort((p, q) => p.known - q.known);
      const yields = this.exploreYields.get(v.name) ?? [];
      const dull = yields.length >= 2 && yields.slice(-2).every((y) => y < 0.1);
      const trips = yields.length ? `last trips: ${yields.filter((y) => y >= 0.1).length} of ${yields.length} found new land` : 'no trips yet';
      for (const [r, q] of points.entries()) {
        const excludes = exInst ? [`explore:${q.i}=`] : ['explore', 'start', 'pen'];
        if (exInst && excluded(excludes, busy)) continue;
        add({
          id: `explore:${q.i}`, kind: 'explore', key: exInst ? `explore:${q.i}` : 'explore', excludes, name: `Explore to the ${DIRECTIONS[q.i]}`, rank: 800 + r, at: { x: q.x, z: q.z },
          facts: `${dist(q.x, q.z)}; ${points.length} of 8 points left; this point's land ${Math.round(q.known * 100)}% known; ${dull ? 'the last 2 trips found nothing new' : trips}${others('explore')}`,
          // (sightings are what scouting is for: animals for the pens, plants for farm starts)
          effect: dull ? `probably little: the last 2 trips found nothing new, and the point is ${Math.round(q.known * 100)}% known` : 'new land in the atlas, with animals and plants for pens and farms',
          ...(dull ? { lp: 0.5 } : {}),
        }, { kind: 'explore', i: q.i, x: q.x, z: q.z, home: { x: Math.round(exHome.x), z: Math.round(exHome.z) } });
      }
      if (!out.some((o) => o.kind === 'explore')) reasons.explore = points.length ? 'busy' : 'all visited';
    }

    // S.9's families, each only while MC_CHOICE_FAMILIES names it (off: no option and no reason). Code does the arithmetic
    // (targets, batches, earmarks, what is wanted and how much at once), the model only chooses (lesson 1)
    const family = (f: string) => CHOOSE.families.has(f);

    // The works plot beside the annex (D8), then its three furnaces, one at a time on the menu
    const wk = lay0?.works;
    if (!family('works')) {
      // (off)
    } else if (!lay0 || ax?.state !== 'ready') reasons.works = 'no annex';
    else if (wk?.state !== 'ready') {
      if (worksBusy.has(v.name) || excluded(['works', 'annex', 'pen'], busy)) reasons.works = 'busy';
      else if (effTries(wk?.tries, wk?.lastTry?.at, now) >= 3 || (wk?.lastTry && now - wk.lastTry.at < 10 * 60000)) reasons.works = 'backing off';
      else
        add({
          id: 'works:prepare', kind: 'works', key: 'works', excludes: ['works', 'annex', 'pen'], name: 'Prepare the works plot', rank: 850,
          facts: `${wk && wk.x2 >= wk.x1 ? `${wk.x2 - wk.x1 + 1}x${wk.z2 - wk.z1 + 1} at ${wk.x1},${wk.z1}, tried ${effTries(wk.tries, wk.lastTry?.at, now)} times` : 'a 13x9 field beside the annex, not started'}; ${record('works')}${others('works')}`,
          effect: "room for a row of three furnaces (the hut's one furnace smelts one batch at a time) and later a sheep pen",
        }, { kind: 'works', stage: 'prepare', again: !!(wk && wk.x2 >= wk.x1), area: wk ? `${wk.x1},${wk.z1}..${wk.x2},${wk.z2}` : '' });
    } else {
      const placed = (wk.furnaces ?? []).slice(0, WORKS_FURNACES).filter(Boolean).length;
      const k = Array.from({ length: WORKS_FURNACES }, (_, i) => i + 1).find((kk) => !wk.furnaces?.[kk - 1] && !excluded([`worksfurnace:${kk}=`, 'works='], busy) && (this.worksBack.get(`${v.name}:${kk}`) ?? 0) <= now);
      const spare = facts.spare().cobblestone ?? 0;
      if (placed >= WORKS_FURNACES) reasons.works = 'furnaces placed';
      else if (!k) reasons.works = 'busy';
      else if (spare < 8) reasons.works = 'cobblestone short';
      else {
        const cell = worksFurnaces(wk)[k - 1];
        add({
          id: `works:furnace:${k}`, kind: 'works', key: `worksfurnace:${k}`, excludes: [`worksfurnace:${k}=`, 'works='], name: 'Put a furnace on the works plot', rank: 851 + k,
          at: { x: cell.x, y: wk.y + 1, z: cell.z },
          facts: `${placed} of ${WORKS_FURNACES} furnaces stand; takes 8 cobblestone (${spare} spare); ${record('works')}${others('works')}`,
          effect: `a ${ORDINALS[placed + 2] ?? 'further'} furnace: smelting jobs side by side`,
        }, { kind: 'works', stage: 'furnace', k });
      }
    }

    // Lighting (B.4): a chore a part, its torches from the spare storage (earmarked from the queue, D6), buildings first,
    // most unlit first, then the mine's parts; a mine part still growing waits for 2 unlit spots (ranks 860-899: here, so
    // the options stay in rank order, which the fixed sweep's first option relies on)
    if (!family('light')) {
      // (off)
    } else if (!v.storageHut) reasons.light = 'no hut';
    else {
      let spare = facts.spare().torch ?? 0;
      const why: string[] = [];
      const ts = timeScale();
      for (const [r, P] of this.lightParts(v).entries()) {
        if (excluded([`light:${P.part}=`], busy)) {
          why.push('busy');
          continue;
        }
        if ((this.lightBack.get(`${v.name}:${P.part}`) ?? 0) > now) {
          why.push('backing off');
          continue;
        }
        if (P.unlit < (P.kind === 'mine' && P.growing ? MINE_LIGHT_MIN : 1)) {
          why.push('nothing unlit');
          continue;
        }
        // (N.2: another member's house is its own to light; one's own is named so and goes first, H8)
        const owner = HOUSING && P.structure ? this.houseOwner(v, P.structure) : undefined;
        const theirs = owner && owner !== a.name ? owner : undefined;
        if (theirs && this.ownDecorHeld(v, `light:${P.part}`, theirs, now)) {
          why.push("others' houses");
          continue;
        }
        const n = Math.min(P.unlit, LIGHT_TRIP, spare);
        if (n < Math.min(P.unlit, LIGHT_MIN_TRIP)) {
          why.push('torches short');
          continue;
        }
        const id = `light:${P.part}`;
        const tail = `${record('light')}${others('light', id)}${lastOf('light', id)}`;
        let facts2: string, effect: string, at: { x: number; y?: number; z: number } | undefined;
        if (P.kind === 'building') {
          const r0 = v.lights?.[P.part];
          const k = P.spots.filter((q) => q.src === 'vanilla' && !r0?.done.includes(`${q.x},${q.y},${q.z}`) && !r0?.never?.includes(`${q.x},${q.y},${q.z}`)).length;
          const d = P.walk ?? 0;
          const min = Math.max(0.1, Math.round(((0.3 + (2 * d) / 4.3 / 60) / ts) * 10) / 10);
          // (short enough for add()'s 240-character cut with a record, others on it and a last end: the tail is what the cut
          // took first, B.4's review, lens 2 L4)
          facts2 = `${P.unlit} of ${P.spots.length} torch spots unlit${k ? ` (${k} vanilla's own)` : ''}; takes ${n} torches (${spare} spare); walks ${d} blocks from the hut and back, ~${min} min; ${tail}`;
          effect = `+${n} torches in the ${P.label}: for the village's look (time stands at day and no mobs spawn in this peaceful world, so the light is for the look)`;
          const door = P.place ? placedDoor(P.place) : null;
          if (door && P.structure) at = { x: door.x, y: P.structure.y + 1, z: door.z };
        } else {
          const min = Math.max(0.1, Math.round((0.4 / ts) * 10) / 10);
          facts2 = `${P.unlit} of ${P.spots.length} torch spots unlit; takes ${n} torches from storage (${spare} spare); set from the storage hut by command, ~${min} min; ${tail}`;
          // (no claim the bots need it: they dig in the dark as well, lesson 127; B.4's review, lens 2 L3)
          effect = `+${n} torches along the ${P.label}: for the look of the tunnels (bots dig in the dark too; no mobs spawn here)`;
        }
        add({
          id, kind: 'light', key: id, excludes: [`${id}=`], name: theirs ? `Help light ${anon ? 'a member' : theirs}'s house (${P.label})` : owner ? `Light your own house (${P.label})` : `Light the ${P.label}`, rank: Math.min(899, 860 + r) - (owner && !theirs ? 5 : 0), ...(at ? { at } : {}),
          facts: theirs ? `${anon ? 'a member' : theirs}'s house; ${facts2}` : owner ? `your own house; ${facts2}` : facts2, effect,
        }, { kind: 'light', part: P.part, n, unlit: P.unlit, label: P.label });
        spare -= n;
      }
      if (!out.some((o) => o.kind === 'light')) reasons.light = ['torches short', 'backing off', 'busy', "others' houses"].find((w) => why.includes(w)) ?? 'nothing unlit';
    }

    // Making into storage (the workshop, D1): each good below its target with a whole batch from spare storage; crafting
    // at the hut (MAKE_PARALLEL at once), smelting at a free furnace each (the works plot's, then the hut's)
    if (!family('make')) {
      // (off)
    } else if (!v.storageHut || !villageStationCell(v, 'crafting_table') || !villageStationCell(v, 'furnace')) reasons.make = 'no workshop';
    else {
      const plans = facts.makePlans();
      const going = this.goingS9(v).make;
      const crafting = going.filter((g) => !g.smelts).length;
      const free = this.freeFurnaces(v, busy);
      let nextFurnace = 0;
      const goingOf = (item: string) => going.filter((g) => g.item === item).reduce((s, g) => s + g.count, 0);
      // (the deficit order: the largest share of its target missing first, ties in the table's order)
      // (with lighting on, torches by their demand's target, L10: both reads)
      // (food goods only where the village keeps an appetite, ranked by D13: after the cake, before it while food is short)
      const goods = this.goodsFor(v);
      const order = goods.map((g, i) => ({ g, i, target: this.makeTarget(v, g) })).map(({ g, i, target }) => ({ g, i, target, d: Math.max(0, target - (store[g.item] ?? 0) - goingOf(g.item)) / Math.max(1, target) })).sort((p, q) => q.d - p.d || p.i - q.i);
      const why = new Set<string>();
      let atStock = 0;
      // (food goods present: by the flag, the catalogue's goods outnumber the keeps without any, the critique's 12)
      const foodLow = goods.some((g) => g.food) && foodPoints(store) < 5 * this.growMembers(v).length;
      for (const [r, { g, target }] of order.entries()) {
        const p = plans.get(g.item);
        if (!p || 'why' in p) {
          if (p && p.why === 'at stock') atStock++;
          else why.add('inputs short');
          continue;
        }
        if (excluded([`make:${g.item}=`], busy)) {
          why.add('busy');
          continue;
        }
        const back = this.makeBack.get(`${v.name}:${g.item}`);
        if (back && now - back.at < (effTries(back.tries, back.at, now) >= 3 ? 60 : 10) * 60000) {
          why.add('backing off');
          continue;
        }
        let k: number | undefined;
        if (p.smelts) {
          k = free[nextFurnace];
          if (k === undefined) {
            why.add('furnaces busy');
            continue;
          }
          nextFurnace++;
        } else if (crafting >= MAKE_PARALLEL) {
          why.add('hut busy');
          continue;
        }
        const stock = store[g.item] ?? 0;
        const smelts = p.smelts ? this.materials.plan(p.bill, p.inputs).fuel.smelts : 0;
        const min = Math.max(0.1, Math.round(((0.3 + (smelts * 10) / 60) / timeScale()) * 10) / 10);
        const cell = k === undefined ? villageStationCell(v, 'crafting_table') : k === 0 ? villageStationCell(v, 'furnace') : (() => {
          const f = wk?.furnaces?.[k - 1];
          return f ? { x: f.x, y: f.y, z: f.z } : null;
        })();
        add({
          id: `make:${g.item}`, kind: 'make', key: `make:${g.item}`, holds: k === undefined ? [] : [`furnace:${k}`], excludes: [`make:${g.item}=`, ...(k === undefined ? [] : [`furnace:${k}=`])],
          // (900 + r below gathering's 950 with the catalogue's many goods too, X.1: the options stay in rank order)
          name: `Make ${g.words}`, rank: g.food ? (foodLow ? 590 : 610) + (g.item === 'pumpkin_pie' ? 5 : 0) : 900 + Math.min(r, 49), ...(cell ? { at: { x: cell.x, y: cell.y, z: cell.z } } : {}),
          facts: `${stock} of the ${target} kept are in storage; this batch of ${p.count} takes ${countsText(p.inputs)} (all spare); ${k === undefined ? `crafted at the hut, ~${min} min` : `smelted at ${k ? `works furnace ${numberWord(k)}` : "the hut's furnace"}, ~${min} min`}; ${record('make')}${others('make', `make:${g.item}`)}${lastOf('make', `make:${g.item}`)}`,
          // (torches with lighting on: the spots beyond what storage holds, or the reserve once it covers them; the demand alone
          // read as the reason with 28 stored for 10 spots, B.4's review, lens 2 L1)
          effect: `+${p.count} ${g.words} (${stock} stored): ${g.item === 'torch' && family('light') ? torchWhy(this.torchDemand(v), stock) : g.forWhat}`,
        }, { kind: 'make', good: g, count: p.count, inputs: p.inputs, smelts: p.smelts, stock, ...(k === undefined ? {} : { k }) });
      }
      if (!out.some((o) => o.kind === 'make')) reasons.make = atStock === goods.length ? 'all at stock' : ['inputs short', 'hut busy', 'furnaces busy', 'backing off', 'busy'].find((w) => why.has(w)) ?? 'all at stock';
    }

    // Gathering for the workshop (D9): one option a material, as much as the goods' deficits, the keeps and the furnaces
    // want less what is on the way; sand two at once, logs three (within the hourly cap), cobblestone a free mine face each
    if (family('gather')) {
      const want = facts.gather();
      const going = this.goingS9(v).gather;
      const order = MATERIALS.map((m, i) => ({ m, i })).sort((p, q) => want[q.m].want - want[p.m].want || p.i - q.i);
      const logsHour = (this.gatherLog.get(v.name) ?? []).filter((e) => now - e.at < 60 * 60000).reduce((s, e) => s + e.n, 0);
      const why: string[] = [];
      for (const [r, { m }] of order.entries()) {
        const w = want[m], spec = GATHER_KINDS[m];
        const stored = m === 'logs' ? (v.wood ? store[`${v.wood}_log`] ?? 0 : Object.entries(store).filter(([x]) => /_log$/.test(x)).reduce((s, [, q]) => s + q, 0)) : store[m] ?? 0;
        // (#122: nothing wants it: gathered anyway as a gated option, while storage holds little of it; its stops are not
        // the gather's reasons)
        const anyway = w.want <= 0;
        // (#142: never sand: the lake-edge sand collect takes for dry sent train 3's gatherers into the water, 544 [stuck])
        if (anyway && !(POLICY_OPTIONS && stored < GATHER_ANYWAY_MAX && m !== 'sand')) continue;
        const note = (x: string) => {
          if (!anyway) why.push(x);
        };
        const held = [...busy].filter((key) => key.startsWith(`gather:${m}:`)).length;
        let trip = anyway ? spec.trip : Math.min(spec.trip, w.want), extra = '';
        if (m === 'sand' && v.unavailable?.includes('sand')) {
          note('no sand near');
          continue;
        }
        if ((this.gatherBack.get(`${v.name}:${m}`) ?? 0) > now) {
          note('backing off');
          continue;
        }
        if (spec.atOnce === 'faces') {
          // (S.2's gate: a queued or walking miner holds no face yet, so the trips under way count against the faces; and
          // not the stairs down once the iron level exists, the check's M2 and L12)
          if (!mineCanGive(v, 'cobblestone')) {
            note('no mine');
            continue;
          }
          const f = this.faces(v);
          const free = Math.max(0, f.faces - (v.mine?.iron ? f.down : 0) - Math.max(f.held, going.filter((x) => x.material === m).length));
          if (free <= 0) {
            note('mine busy');
            continue;
          }
          extra = `; the mine has ${free} free face${free === 1 ? '' : 's'}`;
        } else if (held >= spec.atOnce) {
          note('busy');
          continue;
        }
        if (m === 'logs') {
          const left = GATHER_LOGS_HOUR - logsHour - w.incoming;
          if (left <= 0) {
            note('logs capped');
            continue;
          }
          trip = Math.min(trip, left);
        }
        if (w.incoming > 0 && trip < GATHER_MIN_TRIP[m]) {
          note('trip too small');
          continue;
        }
        let n = 1;
        while (busy.has(`gather:${m}:${n}`)) n++;
        const goods = w.for.slice(0, 4).join(', ') || 'the workshop';
        if (anyway) {
          add({
            id: `gather:${m}`, kind: 'gather', key: `gather:${m}:${n}`, excludes: [`gather:${m}:${n}=`], name: `${spec.words.replace('for the workshop', 'for the storage')} (nothing wants it now)`, rank: 1300 + r, mark: PAST_TAG,
            facts: `${m}: ${spec.forWhat}; storage holds ${stored}; nothing the workshop makes wants more now, so it keeps for later work${extra}`,
            effect: `+${trip} ${m} into the village storage`,
          }, { kind: 'gather', material: m, n, amount: trip, block: spec.block(v.wood ?? (family('catalog') ? v.catalogWood : undefined)), deposit: spec.deposit(v.wood), need: 0, incoming: w.incoming, for: [] });
          gated.add(out[out.length - 1]);
          gateWhy.gather = 'nothing wanted';
          continue;
        }
        add({
          id: `gather:${m}`, kind: 'gather', key: `gather:${m}:${n}`, excludes: [`gather:${m}:${n}=`], name: spec.words, rank: 950 + r,
          facts: `${m}: ${spec.forWhat}; storage holds ${stored}, the workshop wants ${w.need} (${goods}); ${w.incoming} on the way${extra}`,
          effect: `+${trip} ${m} toward ${goods}`,
          // (the catalogue's wood goods plan from its pinned kind's logs: with the catalog family, that kind is felled, X.1)
        }, { kind: 'gather', material: m, n, amount: trip, block: spec.block(v.wood ?? (family('catalog') ? v.catalogWood : undefined)), deposit: spec.deposit(v.wood), need: w.need, incoming: w.incoming, for: w.for });
      }
      if (!out.some((o) => o.kind === 'gather')) reasons.gather = why[0] ?? 'nothing wanted';
    }

    // Furnishing (X.1): a chore a building, its open furniture spots (buildingDecor's) whose pieces the spare storage holds,
    // FURNISH_TRIP at most, earmarked from the queue as lighting's torches (ranks 1000 + r: after gathering, in rank order)
    if (!family('furnish')) {
      // (off)
    } else if (!v.storageHut) reasons.furnish = 'no hut';
    else {
      const spare = { ...facts.spare() };
      const why: string[] = [];
      const ts = timeScale();
      for (const [r, P] of this.decorParts(v).filter((q) => q.open.length).entries()) {
        const id = `furnish:${P.part}`;
        if (excluded([`${id}=`], busy)) {
          why.push('busy');
          continue;
        }
        if ((this.decorBack.get(`${v.name}:${P.part}`) ?? 0) > now) {
          why.push('backing off');
          continue;
        }
        // (N.2: another member's house is its own to furnish; one's own is named so and goes first, H8)
        const owner = HOUSING ? this.houseOwner(v, P.structure) : undefined;
        const theirs = owner && owner !== a.name ? owner : undefined;
        if (theirs && this.ownDecorHeld(v, id, theirs, now)) {
          why.push("others' houses");
          continue;
        }
        const items: Counts = {};
        let n = 0;
        for (const q of P.open) {
          if (n >= FURNISH_TRIP) break;
          const need: Counts = { [q.item]: 1 };
          if (q.also) need[q.also.item] = (need[q.also.item] ?? 0) + 1;
          if (!Object.entries(need).every(([k, c]) => (spare[k] ?? 0) - (items[k] ?? 0) >= c)) continue;
          for (const [k, c] of Object.entries(need)) items[k] = (items[k] ?? 0) + c;
          n++;
        }
        if (n < Math.min(P.open.length, FURNISH_MIN_TRIP)) {
          why.push('furniture short');
          continue;
        }
        for (const [k, c] of Object.entries(items)) spare[k] -= c;
        const d = P.walk ?? 0;
        const min = Math.max(0.1, Math.round(((0.4 + (2 * d) / 4.3 / 60) / ts) * 10) / 10);
        const door = placedDoor(P.place);
        add({
          id, kind: 'furnish', key: id, excludes: [`${id}=`], name: theirs ? `Help furnish ${anon ? 'a member' : theirs}'s house (${P.label})` : owner ? `Furnish your own house (${P.label})` : `Furnish the ${P.label}`, rank: 1000 + r - (owner && !theirs ? 5 : 0),
          ...(door ? { at: { x: door.x, y: P.structure.y + 1, z: door.z } } : {}),
          facts: `${theirs ? `${anon ? 'a member' : theirs}'s house; ` : owner ? 'your own house; ' : ''}${P.spots.length - P.open.length} of ${P.spots.length} furniture spots done; takes ${countsText(items)} (spare); walks ${d} blocks from the hut and back, ~${min} min; ${record('furnish')}${others('furnish', id)}${lastOf('furnish', id)}`,
          effect: `+${n} pieces of furniture in the ${P.label} (chairs, tables, workbenches, barrels): for the village's look and its homes`,
        }, { kind: 'furnish', part: P.part, n, items, open: P.open.length, label: P.label });
      }
      if (!out.some((o) => o.kind === 'furnish')) reasons.furnish = ['furniture short', 'backing off', 'busy', "others' houses"].find((w) => why.includes(w)) ?? 'nothing to furnish';
      // #141 (MC_HOUSE_DECOR): the trades stock storage with what the owned houses' free decoration slots want, two items a
      // menu at most (make_furnishing into storage); a colour only where its dye is stored, else white
      if (HOUSE_DECOR) {
        const store = facts.spare();
        const houses = this.decorParts(v).filter((P) => P.slots?.length && P.structure.owner).map((P) => ({ owner: P.structure.owner!, free: freeDecorSlots(v, P) })).filter((h) => h.free.length);
        const wants = decorWants(houses, store);
        // (wool goes to the beds first: carpets and banners wait while an owned house lacks its bed, H141D's 20 bed failures)
        const bedless = this.decorParts(v).some((P) => P.structure.owner && P.basics?.bed && !basicsOf(v)[P.structure.id]?.bed);
        const can = (item: string) => /_(carpet|banner)$/.test(item) ? !bedless : item === 'flower_pot' ? (store.brick ?? 0) >= 3 : item === 'lantern' ? (store.iron_ingot ?? 0) >= 1 || (store.iron_nugget ?? 0) >= 8
          : item === 'candle' ? (store.string ?? 0) >= 1 && (store.honeycomb ?? 0) >= 1 : true;
        let shown = 0;
        for (const [want, q] of Object.entries(wants).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))) {
          if (shown >= 2) break;
          const colour = /^(\w+)_(carpet|banner)$/.exec(want);
          const item = colour && colour[1] !== 'white' && (store[`${colour[1]}_dye`] ?? 0) < 2 ? `white_${colour[2]}` : want;
          const key = `decor:make:${item}`;
          if (!can(item) || excluded([`${key}=`], busy) || (this.decorBack.get(`${v.name}:decor:${item}`) ?? 0) > now || out.some((o) => o.id === key)) continue;
          const amount = Math.min(furnishBatch(item), q);
          shown++;
          // (the kind storage holds least first: at 1010 + shown carpets took every pick, H141D)
          const held = Object.entries(store).filter(([k]) => k.replace(/^\w+?_(carpet|banner)$/, '$1') === item.replace(/^\w+?_(carpet|banner)$/, '$1')).reduce((t, [, n]) => t + n, 0);
          add({
            id: key, kind: 'furnish', key, excludes: [`${key}=`], rank: 1010 + Math.min(80, held) + shown,
            name: `Make ${amount} ${words(item)} for the village's houses`,
            facts: `${houses.length} house${houses.length === 1 ? ' has' : 's have'} room for decorations; they want ${q} more ${words(want)}; storage holds ${store[item] ?? 0}; the ${furnishTrade(item)}'s work; ${record('furnish')}`,
            effect: `+${amount} ${words(item)} in storage, for members to decorate their own houses`,
          }, { kind: 'decor', item, amount });
        }
      }
    }

    // #21 (MC_LETTERS): the library's shelves and lectern from storage into its cells, while letters is current (a furnishing,
    // ranked beside the furnish options); offered once a piece the open cells take is stored, the lectern only with no shelf
    // cell open (the shelving's order)
    if (lettersCurrent(v)) {
      const id = 'shelve:library';
      const L = this.libraryPlan(v);
      const shelvesOpen = L ? L.open.filter((c) => c.part === 'shelf').length : 0, lecternOpen = !!L?.open.some((c) => c.part === 'lectern');
      const n = Math.min(shelvesOpen, store.bookshelf ?? 0) + (lecternOpen && !shelvesOpen && (store.lectern ?? 0) > 0 ? 1 : 0);
      if (L && n > 0 && !excluded([`${id}=`], busy)) {
        const door = placedDoor(L.place);
        add({
          id, kind: 'furnish', key: id, excludes: [`${id}=`], name: `Shelve the ${L.label}`, rank: 995,
          ...(door ? { at: { x: door.x, y: L.structure.y + 1, z: door.z } } : {}),
          facts: `${L.cells.length - L.open.length} of ${L.cells.length} pieces placed (4 bookshelves and a lectern); places ${n} now, ${store.bookshelf ?? 0} bookshelves and ${store.lectern ?? 0} lecterns in storage; ${record('furnish')}${others('furnish', id)}${lastOf('furnish', id)}`,
          effect: `+${n} piece${n === 1 ? '' : 's'} in the ${L.label}: the age of letters' library`,
        }, { kind: 'shelve', n });
      }
    }

    // s41: the library's activities (a foundry skill run from a server/library spec): one option a spec whose needs are
    // spare in storage, whose place the skill's adapter finds and whose gives are below their keep; one holder a spec and
    // a shared thing (the adapter's holds); ranks 870-879, a free band between lighting's and furnishing's
    if (family('activities')) {
      const why: string[] = [];
      if (!this.library.specs.length) why.push('none loaded');
      const spare = this.library.specs.length ? facts.spare() : {};
      const chest = v.storage?.chests?.[0];
      const hut = v.storageHut && chest ? { x: Math.floor((v.storageHut.x1 + v.storageHut.x2) / 2), y: chest.y, z: Math.floor((v.storageHut.z1 + v.storageHut.z2) / 2) } : null;
      for (const [r, sp] of this.library.specs.entries()) {
        const f = FOUNDRY_SKILLS.find((x) => x.name === sp.skill);
        if (!f?.activity) {
          why.push('none loaded');
          continue;
        }
        const key = `activity:${sp.id}`;
        if (excluded([`${key}=`], busy)) {
          why.push('busy');
          continue;
        }
        // (a spec that picks in code, the merchant's: its needs and gives from the pick, no keep of its own; spec_shop_v2)
        const keep = this.libraryKeep(v, sp);
        const stock = sp.gives.reduce((s, g) => s + (store[g.item] ?? 0), 0);
        let needs: Counts = sp.needs ?? {}, gives = sp.gives.map((g) => g.item), pickArgs: Record<string, unknown> = {}, pickFacts = '';
        if (f.activity.pick) {
          let p: ReturnType<NonNullable<typeof f.activity.pick>>;
          try {
            p = f.activity.pick({ village: v, agent: a, hut, spare, spec: sp.id });
          } catch {
            p = { why: 'nothing to trade' };
          }
          if ('why' in p) {
            why.push(p.why);
            continue;
          }
          needs = p.needs;
          gives = p.gives ?? gives;
          pickArgs = p.args;
          pickFacts = p.facts ?? '';
        } else if (stock >= keep) {
          why.push('at keep');
          continue;
        }
        if (Object.entries(needs).some(([n, q]) => (spare[n] ?? 0) < q)) {
          why.push('needs short');
          continue;
        }
        let place: Record<string, unknown>;
        try {
          place = f.activity.place({ village: v, agent: a, hut });
        } catch {
          place = { why: 'no place' };
        }
        if (typeof place.why === 'string') {
          why.push('no place');
          continue;
        }
        let holds: string[] = [];
        try {
          holds = f.activity.holds?.(v) ?? [];
        } catch {
          holds = [];
        }
        if (excluded(holds.map((h) => `${h}=`), busy)) {
          why.push('busy');
          continue;
        }
        const count = sp.count && !f.activity.pick ? Math.max(1, Math.min(sp.count.max, keep - stock)) : 0;
        const args = { ...(sp.args ?? {}), ...place, ...pickArgs, ...(count ? { [sp.count!.arg]: count } : {}) };
        const giveWords = sp.gives.filter((g) => gives.includes(g.item)).map((g) => `${g.item}${g.consumer ? ` (${g.consumer})` : ''}`).join(', ') || gives.join(', ');
        add({
          id: key, kind: 'activity', key, holds, excludes: [`${key}=`, ...holds.map((h) => `${h}=`)], name: sp.name, rank: 870 + Math.min(r, 9),
          ...(typeof place.x === 'number' && typeof place.z === 'number' ? { at: { x: place.x, y: typeof place.y === 'number' ? place.y : hut?.y ?? 64, z: place.z } } : {}),
          facts: `${pickFacts ? `${pickFacts}; ` : `gives ${giveWords}; ${stock} of the ${keep} kept are in storage`}${Object.keys(needs).length ? `; takes ${countsText(needs)} from storage${Object.keys(needs).some((n) => TOOL.has(n)) ? ' and puts the tools back' : ''}` : ''}; ${record('activity')}${others('activity', key)}${lastOf('activity', key)}`,
          effect: `${count ? `up to ${count} ` : ''}${gives.map((g) => g.replace(/_/g, ' ')).join(' or ')}: ${sp.effect}`,
        }, { kind: 'activity', spec: sp, args, count, stock, keep, needs, gives });
      }
      if (!out.some((o) => o.kind === 'activity')) reasons.activity = ['needs short', 'no place', 'busy', 'at keep'].find((w) => why.includes(w)) ?? why[0] ?? 'none loaded';
    }

    // N.2 (MC_HOUSING): a houseless member's first preference, a street of houses of its own starting (H3)
    if (HOUSING) {
      const g = v.growth;
      const why = !GROW.on ? 'growth off' : this.homeOf(v, a.name) ? 'has a house' : g?.active ? 'a layout is being built' : g?.request ? 'a street is asked for' : this.voting.has(v.name) ? 'a vote is under way'
        : g?.stop ? 'growth stopped' : (g?.backoff ?? 0) > now || (this.growError.get(v.name) ?? 0) > now ? 'backing off'
        : excluded(['grow='], busy) || [...this.chores.values()].some((c) => c.village === v.name && c.key === 'grow') ? 'busy'
        : !this.growClaimers(v).length ? 'no builders' : '';
      if (why) reasons.grow = why;
      else {
        const without = this.homeless(v).length, M = this.growMembers(v).length, more = Math.min(GROW.batch, without) - 1;
        add({
          id: 'grow:street', kind: 'grow', key: 'grow', excludes: ['grow='], rank: 1,
          // (#117: a house of its own is the first basic need after food)
          ...(PROMPT_SELF ? { basic: true, basicNeed: 'a house' } : {}),
          name: `Start a street of houses: your own${more > 0 ? ` and up to ${more} more for members without one` : ''} (your own project)`,
          facts: `you have no house; ${without} of ${M} members have none; a small street near the village, built from the task board by the village's workers with you; your name goes on your house's sign`,
          effect: `a house of your own${more > 0 ? ` and homes for ${more} other${more > 1 ? 's' : ''}` : ''}`,
        }, { kind: 'grow', houseless: without });
      }
    }

    // Initiatives (s35): each open one's next step for anyone (ranks 1050 + r), then up to two of the member's own to start
    // (1100 + r) while fewer than INITIATIVES_MAX are open and it has none of its own open
    if (family('initiatives') && INITIATIVES_MAX > 0 && v.storageHut) {
      const open = (v.initiatives ?? []).filter((i) => i.state === 'open');
      const why: string[] = [];
      for (const [r, it] of open.entries()) {
        const kindOf = smallWorkKind(it.kind);
        if (!kindOf) continue;
        if ((it.backoff ?? 0) > now) {
          why.push('backing off');
          continue;
        }
        const step = this.initiativeStep(v, it, facts.spare(), busy);
        if (!step) {
          why.push('busy');
          continue;
        }
        const mine = it.by === a.name;
        const posted = it.by === STALL_BY;
        const id = `help:${it.id}`;
        const key = step.what === 'gather' ? `initiative:${it.id}:${[1, 2].find((n) => !busy.has(`initiative:${it.id}:${n}`)) ?? 1}` : `initiative:${it.id}:${step.what}`;
        const crew = it.crew.filter((n) => n !== a.name);
        const short = step.what === 'build' ? 'build it' : step.what === 'prepare' ? `prepare a ${GREEN_SIZE}x${GREEN_SIZE} green for it` : `gather ${step.amount} ${step.material}`;
        const where = it.pending ? 'no spot yet: a green near the village first' : `at ${it.x},${it.z}`;
        add({
          id, kind: 'help', key, excludes: [`${key}=`, ...(step.what === 'gather' ? [`initiative:${it.id}:build=`] : [`initiative:${it.id}:`])],
          name: mine ? `Continue your ${kindOf.words}: ${short}` : posted ? `Help build the village's ${kindOf.words} at ${it.x},${it.z}: ${short}` : anon ? `Help build the ${kindOf.words} at ${it.pending ? 'a new green' : `${it.x},${it.z}`}: ${short}` : `Help ${it.by} build a ${kindOf.words}: ${short}`,
          rank: (posted ? 150 : 1050) + r, at: { x: it.x, y: it.y, z: it.z },
          facts: `${mine ? 'your own project' : posted ? 'the village\'s project: a merchant comes to the first market stall built' : anon ? "a member's project" : `${it.by}'s project`}, started ${ago(now - it.at)}; ${anon ? '' : `${crew.length ? `helping: ${crew.slice(0, 4).join(', ')}${crew.length > 4 ? ` and ${crew.length - 4} more` : ''}` : 'nobody helping yet'}; ${it.steps.length} steps taken; `}${where}${step.what === 'gather' ? `; ${step.material} still to gather for it` : step.what === 'build' ? '; its materials are gathered' : ''}`,
          effect: step.what === 'build' ? `a ${kindOf.words} stands in the village: ${kindOf.forWhat}` : step.what === 'prepare' ? `level ground for the ${kindOf.words} and later small works` : `+${step.amount} ${step.material} toward the ${kindOf.words} (${kindOf.forWhat})`,
        }, { kind: 'help', id: it.id, step });
      }
      const mineOpen = open.some((i) => i.by === a.name);
      // (#97: with holds, the projects other members are choosing now count as open)
      const openN = open.length + this.heldProjects(v, a);
      // (#122: past the cap, under twice it, a member's projects are gated options; #142: only on a menu that is filler so
      // far, as the gate keeps them only there: the spot search ran for every member past the cap and was thrown away)
      const past = POLICY_OPTIONS && openN >= INITIATIVES_MAX && openN < 2 * INITIATIVES_MAX && out.every((o) => gated.has(o) || o.kind === 'eat' || isFiller(o));
      if (mineOpen) why.push('own project open');
      else if (openN >= INITIATIVES_MAX && !past) why.push('enough projects open');
      else {
        const wood = this.catalogWoodOf(v);
        // (two kinds a member, seeded by its name and how many initiatives the village has had: members differ, and a
        // member's offer changes once one is started)
        const order = shuffled(menuWorks(v.vanillaBiome), `${a.name}|${v.initiativeN ?? 0}`);
        let r = 0;
        const roomless: SmallWorkKind[] = [];
        // (#45: front gardens read alike: one of them a menu)
        let frontGarden = false;
        for (const k of order) {
          if (r >= 2) break;
          // (a sapling is not a front garden: it took the slot from front_bed in staged L1)
          const front = GARDENS && isGarden(k.kind) && k.kind !== 'flower_ring' && k.kind !== 'sapling';
          if (front && frontGarden) continue;
          const spot = this.smallWorkSpot(v, k, wood, a.name);
          if (!spot) {
            if (!(GARDENS && isGarden(k.kind))) roomless.push(k);
            continue;
          }
          if (front) frontGarden = true;
          // (R2: in the wood of the neighbourhood it stands in)
          const kw = (WOOD_VARIANTS && hoodWoodAt(v, spot.x, spot.z)) || wood;
          // (#140, MC_FLOWER_MIX: a flower work of the flowers growing near the village, the member's own mix)
          const mix = this.flowerMixFor(v, a, k.kind);
          const d = k.make(kw, mix);
          // (only a work whose first step can be taken now: otherwise it would open, sit and lapse; s36)
          if (!this.initiativeStep(v, { id: '_new', design: d.name }, facts.spare(), busy, d)) {
            why.push('nothing to gather for it now');
            continue;
          }
          const bill = inWood(designBill(d), kw);
          const raw = this.materials.plan(bill, {}).gather;
          // (logs of any kind counted with the wood's own: "18 birch_log", not "17 birch_log, 1 logs")
          const sum: Record<string, number> = {};
          for (const [n, q] of Object.entries(raw)) if (q > 0) {
            const key = n === 'any:logs' ? `${kw}_log` : n.replace(/^any:/, '');
            sum[key] = (sum[key] ?? 0) + q;
          }
          const takes = Object.entries(sum).map(([n, q]) => `${q} ${n}`).join(', ');
          const alone = open.filter((i) => !i.crew.some((n) => n !== i.by)).length;
          add({
            id: `initiate:${k.kind}`, kind: 'initiate', key: `initiate:${a.name.toLowerCase()}`, excludes: [`initiate:${a.name.toLowerCase()}=`],
            name: past ? `Start another project: a ${k.words}${mix ? ` of ${mixWords(mix)}` : ''} (your own)` : `Start building a ${k.words}${mix ? ` of ${mixWords(mix)}` : ''} (your own project)`, rank: (past ? 1350 : 1100) + r, at: spot, ...(past ? { mark: PAST_TAG } : {}),
            facts: past ? `${open.length} projects open${openN > open.length ? ` and ${openN - open.length} being chosen by others now` : ' already'}, past the usual ${INITIATIVES_MAX} (${alone} with nobody helping): another splits the helpers; a ${d.width}x${d.depth} ${k.words} at ${spot.x},${spot.z}; takes ${takes || 'little'}, gathered by you and whoever helps`
              : `a ${d.width}x${d.depth} ${k.words} at ${spot.x},${spot.z}; takes ${takes || 'little'}, gathered by you and whoever helps; ${open.length} of ${INITIATIVES_MAX} projects open; others may help you`,
            effect: `your own ${k.words} in the village: ${k.forWhat}`,
          }, { kind: 'initiate', work: k.kind, ...(mix ? { mix } : {}) });
          if (past) {
            gated.add(out[out.length - 1]);
            gateWhy.initiate = 'enough projects open';
          }
          r++;
        }
        // (no room on the plots for a kind: started on a green of its own, one green prepared at a time and at most
        // GREENS_MAX a village, s36)
        const greens = v.plots.filter((p) => p.green).length;
        const greensMax = Math.max(1, Math.ceil(this.growMembers(v).length / GREENS_PER));
        if (!r && !past && roomless.length && !open.some((i) => i.pending) && greens < greensMax) {
          const k = roomless[0];
          const d = k.make(wood);
          add({
            id: `initiate:${k.kind}`, kind: 'initiate', key: `initiate:${a.name.toLowerCase()}`, excludes: [`initiate:${a.name.toLowerCase()}=`],
            name: `Start building a ${k.words} on a new green (your own project)`, rank: 1100 + r,
            facts: `no room left on the village's plots: first a ${GREEN_SIZE}x${GREEN_SIZE} green is prepared near the village (room for more small works), then a ${d.width}x${d.depth} ${k.words}; ${open.length} of ${INITIATIVES_MAX} projects open; others may help you`,
            effect: `your own ${k.words} on a new green: ${k.forWhat}`,
          }, { kind: 'initiate', work: k.kind, green: true });
          r++;
        }
        if (!r) why.push(greens >= greensMax ? 'no room (greens full)' : open.some((i) => i.pending) ? 'no room (a green is being prepared)' : 'no room');
      }
      // (help's own reasons only: initiate's "no room" is not why nothing can be helped, s36)
      if (!out.some((o) => o.kind === 'help')) reasons.help = (open.length ? why.find((w) => w === 'busy' || w === 'backing off') : undefined) ?? 'no project open';
      if (!out.some((o) => o.kind === 'initiate')) reasons.initiate = why.find((w) => w !== 'busy' && w !== 'backing off') ?? 'no room';
    }

    // M1 (#144, MC_MONUMENT): the cathedral's site, a gathering trip for its stage's yard, a job the yard covers
    if (MONUMENT.on && v.monument && v.monument.state !== 'built' && v.storageHut) {
      const m = v.monument;
      const c = monumentPlan(m);
      const st = currentStage(m);
      const stageName = c.stageNames[st - 1] ?? '';
      // (#153: the cathedral's or the castle's)
      const N = monumentNoun(m);
      if (m.state === 'site') {
        if ((m.backoff ?? 0) <= now && !busy.has('monument:site'))
          add({
            id: 'monument:site', kind: 'monument', key: 'monument:site', excludes: ['monument:site='], rank: 155,
            name: `Choose and level the ${N}'s site (the village's monument)`,
            facts: `the village began a ${N} after the iron age: ${c.design.width}x${c.design.depth}, ${c.design.blocks} blocks in ${c.stageNames.length} stages; its pad goes at the edge of the village`,
            effect: `the ${N}'s pad, level and ready for its foundations`,
          }, { kind: 'monument', step: 'site' });
      } else {
        // (M2, #145, MC_KILN: a plan of the stage's bill against the yard and the kiln's load: the yard holds made goods)
        const wants = KILN.on ? stageWantsPlanned(m, planOf(this)) : stageWants(m, (b) => this.monumentRaw(m, b));
        for (const [item, q] of Object.entries(wants)) {
          // (#162, MC_DYE_BED: a dye the stage wants, made by the dyer: up to 8 a chore, 2 at once)
          if (/_dye$/.test(item) && dyeBedOn(v)) {
            if (bedBuilding(v)) continue;
            const n = Array.from({ length: 2 }, (_, i) => i + 1).find((i) => !busy.has(`monument:dye:${item}:${i}`));
            if (!n || (this.monumentBack.get(`${v.name}:dye:${item}`) ?? 0) > now) continue;
            const key = `monument:dye:${item}:${n}`, amount = Math.min(8, q);
            add({
              id: `monument:dye:${item}`, kind: 'monument', key, excludes: [`${key}=`], rank: 160,
              name: `Make ${amount} ${item.replace(/_/g, ' ')} for the ${N}'s windows (stage ${st}: ${stageName})`,
              facts: `the ${N}'s stage ${st} still wants ${q} ${item}; dyes come from flowers, lapis and bone meal, mixed at the table${m3(m).dyeBed ? '; the dye bed copies its tall flowers with bone meal' : ''}`,
              effect: `+${amount} ${item} in the ${N}'s yard for its stained glass`,
            }, { kind: 'monument', step: 'dye', item, amount });
            continue;
          }
          // (what is not gathered (glass, coal for its smelting) is made at the build from storage; M2's chains)
          // (M2, MC_GLAZING: a dye's flower, picked where it grows)
          const flower = MONUMENT.glazing && !!FLOWER_DYE[item];
          // (#162, the detail palette: andesite and diorite collected where they lie, as flowers are picked; first what
          // storage holds of them (the mine's and the quarry's by-products, 256 each at iron_age_g1), claimed for the yard:
          // T2a and T2b's trips to the open stone 50-70 out failed 32 of 40)
          const stone = !!m3(m).detail && /^(andesite|diorite|granite)$/.test(item);
          // (#162 C-E: never the furnishing's own pieces here; they have their own chores after the cathedral stands)
          if (furnishItem(item)) continue;
          // (#162 tier 3, MC_DEEP_STONE: the roof's cobbled deepslate and the plinth's tuff: storage's claimed first, then
          // iron trips on a deep level; with no way down, or still short after DEEP_WAIT_MIN, the wood and stone bricks
          // stand in from the first job the yard does not cover)
          if (m3(m).deep && DEEP_KEEP.includes(item)) {
            const free = Math.floor((storageContents(v)[item] ?? 0) - (m.yard[item] ?? 0));
            const k = Math.min(q, free);
            if (k > 0) {
              m.yard[item] = (m.yard[item] ?? 0) + k;
              this.villages.save();
              console.log(`[monument] ${v.name}: ${k} ${item} in storage claimed for the ${N}'s yard`);
              if (k >= q) continue;
            }
            const blocks = item === 'tuff' ? ['tuff_bricks'] : DEEP_BLOCKS;
            // (stood in already: nothing more to do for it; D1 logged it on every look)
            if (blocks.every((b) => (m3(m).standIns ?? {})[b])) continue;
            const standIn = (why: string) => {
              for (const b of blocks) {
                if ((m3(m).standIns ?? {})[b]) continue;
                // (its job first, from the plan without the stand-in: after it no job holds the block, and D2's tuff stood
                // in "from job 15", none, with job 3 waiting on 22 tuff)
                // (the yard's raw tuff too, cut 1:1 into the plinth's bricks: tuff claimed but not yet cut still covers its
                // jobs)
                const from = standInFrom(m, b, (m.yard[b] ?? 0) + (b === 'tuff_bricks' ? m.yard.tuff ?? 0 : 0));
                (m3(m).standIns ??= {})[b] = deepStandIn(b, m.wood || 'oak');
                (m3(m).standInFrom ??= {})[b] = from;
              }
              this.villages.save();
              console.log(`[monument] ${v.name}: the ${N}'s ${blocks.join(', ')} stand in (${why}; short ${q - Math.max(0, k)} ${item})`);
            };
            const wk = `${v.name}:deep:${item}`;
            const was = this.stoneWait.get(wk);
            const since = was && now - was.last < 2 * 60000 ? was.since : now;
            this.stoneWait.set(wk, { since, last: now });
            if (now - since > DEEP_WAIT_MIN * 60000 / timeScale()) {
              this.stoneWait.delete(wk);
              standIn(`after ${DEEP_WAIT_MIN} min`);
              continue;
            }
            const deepY = deepenForStone(this.villages, v, a);
            if (deepY === null) {
              standIn('no deep level to dig');
              continue;
            }
            const n = Array.from({ length: DEEP_LANES }, (_, i) => i + 1).find((i) => !busy.has(`monument:deep:${i}`));
            if (!n || (this.monumentBack.get(`${v.name}:deep`) ?? 0) > now) continue;
            const key = `monument:deep:${n}`;
            add({
              id: 'monument:deep', kind: 'monument', key, excludes: [`${key}=`], rank: 160,
              name: `Dig the deep level (y ${deepY}) for the ${N}'s ${item.replace(/_/g, ' ')} (stage ${st}: ${stageName})`,
              facts: `the ${N}'s stage ${st} still wants ${q - Math.max(0, k)} ${item}; below y 0 the iron mine's tunnels are deepslate and tuff, cut at the stonecutter into roof tiles and plinth bricks`,
              effect: `+${item.replace(/_/g, ' ')} in storage for the ${N}'s yard`,
            }, { kind: 'monument', step: 'deep', item });
            continue;
          }
          if (stone) {
            const free = Math.floor((storageContents(v)[item] ?? 0) - (m.yard[item] ?? 0));
            const k = Math.min(q, free);
            if (k > 0) {
              m.yard[item] = (m.yard[item] ?? 0) + k;
              this.villages.save();
              console.log(`[monument] ${v.name}: ${k} ${item} in storage claimed for the ${N}'s yard`);
              if (k >= q) continue;
            }
            // (#165: the yard's own stone before the open: while it holds some, the jobs it covers keep the polished stone and
            // the rest stands in from the first job it does not cover, at once. Cologne 1:3 sent 11 trips into the open (1
            // found any) and then stood the whole floor in as plain stone, with 265 andesite in the yard left unused)
            if ((m.yard[item] ?? 0) > 0 && !(m3(m).standIns ?? {})[`polished_${item}`]) {
              const free: Record<string, number> = {};
              for (const [n2, q2] of Object.entries(storageContents(v))) free[n2] = q2 - (m.yard[n2] ?? 0);
              const sub = stoneStandIn(item, q, free);
              const from = standInFrom(m, `polished_${item}`, (m.yard[item] ?? 0) + (m.yard[`polished_${item}`] ?? 0));
              (m3(m).standIns ??= {})[`polished_${item}`] = sub;
              (m3(m).standInFrom ??= {})[`polished_${item}`] = from;
              this.villages.save();
              console.log(`[monument] ${v.name}: the ${N}'s polished_${item} stands in as ${sub} from job ${from} (the yard's ${m.yard[item]} ${item} cover the jobs before it; short ${q})`);
              continue;
            }
            // (still short after STONE_WAIT_MIN: the rest stands in as another stone, the spec's rule; T2d waited on 60
            // andesite for 10 minutes with 256 granite in storage)
            // (the wait restarts when the want lapsed for 2 minutes: a later stage's want is a new wait)
            const wk = `${v.name}:${item}`;
            const was = this.stoneWait.get(wk);
            const since = was && now - was.last < 2 * 60000 ? was.since : now;
            this.stoneWait.set(wk, { since, last: now });
            if (now - since > STONE_WAIT_MIN * 60000 / timeScale()) {
              const free: Record<string, number> = {};
              for (const [n2, q2] of Object.entries(storageContents(v))) free[n2] = q2 - (m.yard[n2] ?? 0);
              const sub = stoneStandIn(item, q - Math.max(0, k), free);
              (m3(m).standIns ??= {})[`polished_${item}`] = sub;
              this.stoneWait.delete(wk);
              this.villages.save();
              console.log(`[monument] ${v.name}: the ${N}'s polished_${item} stands in as ${sub} (short ${q - Math.max(0, k)} after ${STONE_WAIT_MIN} min)`);
              if (M3.news) this.monumentNews(v, `The ${N}'s floor goes on in ${sub.replace(/_/g, ' ')}: no more ${item} to be had`, a.name);
              continue;
            }
          }
          const mat: Material | 'flowers' | null = /_log$/.test(item) ? 'logs' : /^(red_)?sand$/.test(item) ? 'sand' : item === 'cobblestone' ? 'cobblestone' : flower || stone ? 'flowers' : null;
          if (!mat) continue;
          // (M2, #145: or from the cathedral's quarry, MC_QUARRY)
          const quarry = mat === 'cobblestone' && quarryFeeds(v, 'cobblestone');
          if (mat === 'cobblestone' && !mineCanGive(v, 'cobblestone') && !quarry) continue;
          if ((mat === 'sand' || mat === 'flowers') && v.unavailable?.includes(item)) continue;
          // (a quarry trip digs 64: its walk down the steps is the same for any load)
          const spec = mat === 'flowers' ? { trip: stone ? 32 : 12, block: () => item, deposit: () => item } : quarry ? { ...GATHER_KINDS.cobblestone, trip: 64 } : GATHER_KINDS[mat];
          let lanes = Math.min(6, Math.ceil(q / spec.trip)), amount = Math.min(spec.trip, q);
          // #163 (MC_LODGE): bulk trips, MC_LODGE_TRIP stacks or 5 minutes, cut to what the stage still wants after the trips
          // out for it, at most BULK_LANES at once (the others keep the kiln and the builders fed)
          const bulk = LODGE.on && (mat === 'cobblestone' || mat === 'logs' || mat === 'sand');
          if (bulk) {
            let out = 0;
            for (const ch of this.chores.values()) if (ch.village === v.name && !ch.choice.ended && ch.choice.monument?.item === item) out += ch.choice.monument.n ?? 0;
            const t = bulkTrip(q, out);
            if (t === null) continue;
            amount = t;
            // (6 out until the kiln stands: there is nothing else to feed, and the pit's topsoil takes the first trips, L1)
            lanes = m.kiln?.state === 'ready' ? BULK_LANES : 6;
          }
          const n = Array.from({ length: lanes }, (_, i) => i + 1).find((i) => !busy.has(`monument:gather:${item}:${i}`));
          if (!n) continue;
          const key = `monument:gather:${item}:${n}`;
          add({
            id: `monument:gather:${item}`, kind: 'monument', key, excludes: [`${key}=`], rank: 160,
            name: `Gather ${amount} ${stone ? item : mat} for the ${N} (stage ${st}: ${stageName})`,
            facts: `the ${N}'s stage ${st} still wants ${q} ${item}; its yard holds ${m.yard[item] ?? 0}; ${m.done.length} of ${c.jobs.length} jobs built`,
            effect: `+${amount} ${item} in the ${N}'s yard toward its ${stageName}`,
          }, { kind: 'monument', step: 'gather', item, material: mat, amount, block: spec.block(m.wood), deposit: spec.deposit(m.wood), ...(bulk ? { bulk: true } : {}) });
        }
        let shown = 0;
        for (const i of openJobs(m)) {
          if (shown >= 2) break;
          const key = `monument:job:${i}`;
          if (busy.has(key) || (this.monumentBack.get(`${v.name}:${i}`) ?? 0) > now) continue;
          const j = c.jobs[i];
          if (KILN.on ? !jobReady(m, i, planOf(this)) : !yardCovers(m, this.monumentRaw(m, j.bill))) continue;
          shown++;
          add({
            id: key, kind: 'monument', key, excludes: [`${key}=`], rank: 158,
            name: `Build part of the ${N}: its ${stageName} (${j.blocks} blocks)`,
            facts: `stage ${st} of ${c.stageNames.length}; ${m.done.length} of ${c.jobs.length} jobs built; its materials are in the yard`,
            effect: `${j.blocks} more blocks of the ${N} stand`,
          }, { kind: 'monument', step: 'job', job: i });
        }
      }
      // M2 (#145, MC_KILN): the kiln built once something wants smelting, then tended a lane at a time (loaded and unloaded)
      if (kilnOn(v)) {
        const kl = m.kiln;
        if (kl?.state !== 'ready') {
          if ((m.kilnBackoff ?? 0) <= now && !busy.has('monument:kiln:0') && (m.yard.cobblestone ?? 0) >= 64)
            add({
              id: 'monument:kiln:0', kind: 'monument', key: 'monument:kiln:0', excludes: ['monument:kiln:0='], rank: 157,
              name: `Build the ${N}'s kiln (a row of furnaces for its stone bricks)`,
              facts: `the ${N}'s stone bricks${MONUMENT.glazing ? ' and glass' : ''} are smelted there, many at once; its yard holds ${m.yard.cobblestone ?? 0} cobblestone`,
              effect: `the ${N}'s kiln stands, ready to smelt`,
            }, { kind: 'monument', step: 'kiln', lane: 0 });
        } else
          for (let lane = 1; lane <= kilnLanes(kl); lane++) {
            const key = `monument:kiln:${lane}`;
            if (busy.has(key) || (this.monumentBack.get(`${v.name}:kiln:${lane}`) ?? 0) > now) continue;
            const w = laneWork(v, lane, planOf(this), now);
            // (a few done with nothing more to load are taken out too: Kiln152's 19 stone over 3 lanes held stage 1's
            // last job, which wanted 300 with 281 in the yard)
            if (w.load < 16 && w.ready < 16 && !(w.ready > 0 && !w.load)) continue;
            add({
              id: key, kind: 'monument', key, excludes: [`${key}=`], rank: 159,
              name: `Tend the ${N}'s kiln (load ${w.load}, take out ${w.ready})`,
              facts: `stage ${st} wants its stone smelted; ${kl.furnaces.length} furnaces, lane ${lane} of ${kilnLanes(kl)}; ${kilnLine(kl, now, timeScale())}`,
              effect: `${w.ready} smelted for the ${N}, ${w.load} more smelting`,
            }, { kind: 'monument', step: 'kiln', lane });
          }
      }
      // #162 (MC_MONUMENT_DETAIL): the carver's load at the stonecutter, once the kiln's stone is out
      if (cutterOn(v) && !busy.has('monument:cut') && (this.monumentBack.get(`${v.name}:cut`) ?? 0) <= now) {
        const work = cutWork(v, planOf(this));
        const n = work.reduce((t, w) => t + w.makes, 0);
        // (a load of 64 at least, or what there is when no job can go on without it: T2a's 19 loads of 43-60 at 1:4)
        if (n >= 64 || (n > 0 && openJobs(m).every((i) => !jobReady(m, i, planOf(this)))))
          add({
            id: 'monument:cut', kind: 'monument', key: 'monument:cut', excludes: ['monument:cut='], rank: 159,
            name: `Cut stone at the ${N}'s stonecutter (${n} pieces: ${[...new Set(work.map((w) => w.item))].slice(0, 3).join(', ')})`,
            facts: `stage ${st} wants its capitals, arches and polished stone cut from the yard's stone; ${m3(m).cutter ? `the stonecutter has made ${m3(m).cutter!.loads} loads` : 'the stonecutter is set up beside the kiln on the first load'}`,
            effect: `${n} cut pieces in the ${N}'s yard, ready for its builders`,
          }, { kind: 'monument', step: 'cut' });
      }
      if (!out.some((o) => o.kind === 'monument')) reasons.monument = m.state === 'site' ? 'the site is being chosen' : 'nothing wanted now';
    }

    // #162 C-E (MC_FURNISH_*): once the cathedral stands, its furnishing: each piece made by its trade's chore (the smith's
    // lanterns, chains, candles and bell, the weaver's banners), a job once the yard holds a job's pieces
    if (MONUMENT.on && v.monument?.state === 'built' && v.storageHut && furnishStage(v.monument) && currentStage(v.monument) === furnishStage(v.monument)) {
      const m = v.monument, c = monumentPlan(m), N = monumentNoun(m), open = openJobs(m);
      const wants = furnishWants(open.map((i) => c.jobs[i].bill), m.yard);
      for (const [item, q] of Object.entries(wants)) {
        const key = `monument:furnish:${item}`;
        if (busy.has(key) || (this.monumentBack.get(`${v.name}:furnish:${item}`) ?? 0) > now) continue;
        const amount = Math.min(furnishBatch(item), q);
        add({
          id: key, kind: 'monument', key, excludes: [`${key}=`], rank: 161,
          name: `Make ${amount} ${words(item)} for the ${N}'s furnishing`,
          facts: `the ${N} stands; its furnishing still wants ${q} ${words(item)}; its yard holds ${m.yard[item] ?? 0}; ${open.length} furnishing part${open.length === 1 ? '' : 's'} to place`,
          effect: `+${amount} ${words(item)} in the ${N}'s yard for its furnishing`,
        }, { kind: 'monument', step: 'furnish', item, amount });
      }
      let shown = 0;
      for (const i of open) {
        const key = `monument:job:${i}`;
        if (shown >= 2 || busy.has(key) || (this.monumentBack.get(`${v.name}:${i}`) ?? 0) > now) continue;
        if (Object.keys(furnishWants([c.jobs[i].bill], m.yard)).length) continue;
        shown++;
        add({
          id: key, kind: 'monument', key, excludes: [`${key}=`], rank: 158,
          name: `Furnish the ${N} (${c.jobs[i].blocks} pieces)`,
          facts: `the ${N} stands; ${open.length} furnishing part${open.length === 1 ? '' : 's'} to place; its pieces are in the yard`,
          effect: `${c.jobs[i].blocks} more pieces of the ${N}'s furnishing in place`,
        }, { kind: 'monument', step: 'job', job: i });
      }
    }

    // #122: the gated options stay only on a menu with nothing but filler makes (a meal aside), and the filler leaves it;
    // otherwise they go and their kinds keep the gate's reason
    if (gated.size) {
      const fillerOnly = out.every((o) => gated.has(o) || o.kind === 'eat' || isFiller(o));
      for (let i = out.length - 1; i >= 0; i--) if (fillerOnly ? isFiller(out[i]) : gated.has(out[i])) out.splice(i, 1);
      if (!fillerOnly) {
        for (const [k, w] of Object.entries(gateWhy) as Array<[ChoiceKind, string]>) if (!out.some((o) => o.kind === k)) reasons[k] = w;
      } else if (!out.some((o) => o.kind === 'make')) reasons.make ??= 'filler left for the gated options';
    }
    // M1 (#144): the monument's options at most MONUMENT.share of the menu (one at least), the lowest-ranked kept
    if (MONUMENT.on) capShare(out, (o) => o.kind === 'monument');
    // A.3p: the temperament's weight on every option (both modes; the fixed pick and the trim read it), from the kind and
    // sociability's pull toward the kinds other members are on now
    if (TEMPERAMENT_MODE !== 'off') {
      // (character v2, MC_HEXACO: the six traits' kind weights, and extraversion's pull in sociability's place)
      const tv = CHARACTER.hexaco ? { ...temperament(a.name), sociability: hexacoOf(a.name).X } : temperament(a.name);
      const weights = CHARACTER.hexaco ? hexacoWeights(a.name, activeKinds()) : kindWeights(tv);
      const on = new Map<string, number>();
      for (const c of this.chores.values()) if (c.village === v.name && c.agent !== a.name && !c.choice.ended && c.choice.kind) on.set(c.choice.kind, (on.get(c.choice.kind) ?? 0) + 1);
      // (a help option pulls a sociable member by its crew: members on its steps come and go, s35's check 10)
      const crewOf = (o: ChoiceOption) => {
        const d = OPTION_RUN.get(o);
        return d?.kind === 'help' ? (v.initiatives ?? []).find((i) => i.id === d.id)?.crew.filter((n) => n !== a.name).length ?? 0 : undefined;
      };
      for (const o of out) o.tw = optionWeight(tv, weights, o.kind, crewOf(o) ?? on.get(o.kind) ?? 0);
      // (N.2: a house of one's own is a houseless member's first preference whatever its temperament: the scale's top, H3)
      for (const o of out) if (o.kind === 'grow') o.tw = 2.5;
    }
    // M3 (MC_MONUMENT_ROLES): a monument option of the member's own cathedral trade weighs TRADE_WEIGHT and says so
    if (MONUMENT.on && M3.roles && v.monument) {
      const t = tradeOf(v.monument, a.name);
      if (t)
        for (const o of out) {
          const d = OPTION_RUN.get(o);
          if (d?.kind !== 'monument' || tradeOfStep(v.monument, d) !== t) continue;
          o.rw = TRADE_WEIGHT;
          o.tradeTag = `[your trade: ${t}]`;
        }
    }
    // N.1 (MC_NEEDS=on): an option that answers a village need at LOW or above says so, and the need weighs on it by its
    // level and the member's trait for it (needWeight; a neutral trait without temperaments)
    if (NEEDS_MODE === 'on') {
      const reads = new Map((this.needReadings.get(v.name) ?? []).filter((r) => r.level >= LOW).map((r) => [r.kind, r]));
      if (reads.size) {
        const tv = TEMPERAMENT_MODE !== 'off' ? temperament(a.name) : null;
        const demand = this.needDemand(v);
        for (const o of out) {
          const k = this.needOf(v, o, demand);
          const r = k && reads.get(k);
          if (!k || !r) continue;
          o.need = `village need: ${r.text}`;
          o.nw = Math.round(needWeight(r.level, tv ? tv[NEED_TRAIT[k]] : 0.5) * 100) / 100;
        }
      }
    }
    // #69 (MC_OWN): the member's own wants weigh on the options that answer them, 1 + 0.3 a want (food work for its own
    // food, its own house's furnishing and lighting, a tool it lacks made, its own project's steps)
    if (OWN.on) {
      const w = this.wantsOf(v, a.name);
      if (w && openWants(w).length) {
        const food = w.food.meals < 2, house = !!w.house && (w.house.furnish > 0 || w.house.light > 0);
        const tools = new Set(w.tools);
        const mine = (v.initiatives ?? []).find((i) => i.by === a.name && i.state === 'open');
        for (const o of out) {
          let n = 0;
          if (food && o.kind !== 'eat' && (isFoodKind(o.kind, o) || o.kind === 'activity' || o.kind === 'own')) n++;
          if (house && (o.kind === 'furnish' || o.kind === 'light') && /your own house/.test(o.facts ?? '')) n++;
          if (tools.size && o.kind === 'make' && ((tools.has('a pickaxe') && /pickaxe$/.test(o.id)) || (tools.has('an axe') && /_axe$/.test(o.id)) || (tools.has('a fishing rod') && /fishing_rod$/.test(o.id)))) n++;
          if (mine && o.kind === 'help') { const d = OPTION_RUN.get(o); if (d?.kind === 'help' && d.id === mine.id) n++; }
          if (n) o.ww = 1 + 0.3 * n;
        }
      }
    }

    // s43 (MC_SPECIAL=claim): a plot claimed by another member is its own (claims unworked CLAIM_LAPSE_MS lapse)
    if ((SPECIAL.claim || OWN_FARM) && v.claims) {
      for (const [k, q] of Object.entries(v.claims))
        if (!q.own && now - q.last > CLAIM_LAPSE_MS) {
          delete v.claims[k];
          console.log(`[claim] ${v.name}: ${q.by}'s claim on ${k} lapsed (unworked ${Math.round((now - q.last) / 60000)} min)`);
        }
      for (let i = out.length - 1; i >= 0; i--) {
        const o = out[i], q = (o.kind === 'farm' || o.kind === 'slot' || o.kind === 'penwork') ? v.claims[o.key] : undefined;
        if (q && q.by !== a.name) {
          reasons[o.kind] ??= `claimed by ${q.by}`;
          out.splice(i, 1);
        }
      }
    }
    // s43 (MC_SPECIAL): specialists. Habit: the kinds the member has done lately weigh more; price: the goods a chore brings
    // in weigh by the board's price factors (dear goods draw members, cheap ones push them off)
    if (SPECIAL.habit || SPECIAL.price) {
      const counts = SPECIAL.habit ? this.choiceStats.kindCounts(v.name, a.name, 12) : [];
      const total = counts.reduce((t, c) => t + c.n, 0);
      const factor = SPECIAL.price ? boardOf(v).factor : {};
      for (const o of out) {
        if (o.kind === 'eat') continue;
        let w = 1;
        if (total) w *= 1 + 0.6 * ((counts.find((c) => c.kind === o.kind)?.n ?? 0) / total);
        if (SPECIAL.price) {
          const goods = this.optionGoods(o).filter((g) => factor[g] !== undefined);
          if (goods.length) w *= Math.min(1.6, Math.max(0.6, goods.reduce((t, g) => t + factor[g], 0) / goods.length));
        }
        if (w !== 1) o.ww = Math.round((o.ww ?? 1) * w * 1000) / 1000;
      }
    }

    // The appetite (s30): the food makes and the meal in rank order (the fixed sweep runs the first option); a hungry member
    // takes food work only (D8), the rest guarded in model mode, left out in fixed mode, with why
    const starved: ChoiceOption[] = [];
    if (appetiteOn(v)) {
      out.sort((p, q) => p.rank - q.rank);
      if (state === 'hungry') {
        starved.push(...out.filter((o) => !isFoodKind(o.kind, o)));
        out.splice(0, out.length, ...out.filter((o) => isFoodKind(o.kind, o)));
        if (!guards) for (const o of starved) reasons[o.kind] ??= 'hungry';
      }
    }
    // Model mode's guards (D5): bans, the agent's own cooldown, learning progress, then the trim
    // #79 (MC_GOALS=on): the member's life goal weighs on the options that serve it (not meals, not a houseless member's
    // house), more while it is behind the best member at the same goal
    if (GOALS_ON && v.complete) {
      const g = this.goalsFor(v);
      const goal = g.of[a.name];
      if (goal) {
        const gw = goalWeight(goalScore(v, a.name));
        const craft = goal === 'mastery' ? topCraft(g.stats[a.name]) : undefined;
        for (const o of out) if (o.kind !== 'eat' && o.kind !== 'grow' && serves(goal, o, this.goalFacts(v, o), craft)) o.gw = gw;
      }
    }
    // G2 (MC_CONTROLLER=on): the day's intention weighs on the options of its focus kind
    if (CONTROLLER.on) {
      const focus = intentionFocus(v.name, a.name, now);
      if (focus) for (const o of out) if (o.kind !== 'eat' && focusOf(o.kind) === focus) o.iw = CONTROLLER.intentWeight;
    }
    // G2 (MC_SKILL=on, #17): the member's skill at each option's kind
    if (SKILL.on) for (const o of out) if (o.kind !== 'eat') o.sw = skillWeight(skillOf(v.name, a.name, o.kind));
    // G8 (MC_LADDER): the options that feed the ladder's current stage
    if (LADDER && v.ladder?.current) for (const o of out) if (feedsStage(v, o.id, this.feedAlias(o))) {
      o.vw = VW;
      o.ladderTag = stageTag(v);
    }
    // G5 (MC_PROPOSALS): an option an accepted proposal of the member's (or one it backed) brought, once built (verdict.ref)
    if (PROPOSALS_ON) for (const p of allProposals(v.name)) {
      const ref = p.verdict?.decision === 'accept' ? p.verdict.ref : undefined;
      if (!ref) continue;
      const mine = p.by === a.name ? 'you proposed this' : p.endorsements.some((e) => e.by === a.name) ? 'you backed this' : '';
      if (mine) for (const o of out) if (o.key === ref || o.id === ref) o.mark = `[${mine}]`;
    }
    // #117 (MC_PROMPT_SELF): a good made for later that nothing in the village uses yet says so (barrels have the storage
    // yard with MC_STORAGE_GROW)
    if (PROMPT_SELF) for (const o of out) {
      const d = OPTION_RUN.get(o);
      if (d?.kind === 'make' && unusedGood(d.good)) o.mark ??= UNUSED_TAG;
    }
    // G3 (MC_RULES): options whose takes from storage break a quota or a floor leave the menu, the rule named (logged once
    // a member, option and hour); a duty's options are tagged and ranked first until the member has done it today
    if (RULES.on) {
      const ds = duties(v.name);
      const doneToday = (kind: string) => {
        const c = clockOf(v.name, now);
        return !!agentMemory(v.name, a.name)?.log.some((e) => e.kind === kind && e.ok && (!c || e.day === c.day));
      };
      for (let i = out.length - 1; i >= 0; i--) {
        const o = out[i];
        if (o.kind === 'eat') continue;
        const takes = this.takesOf(o);
        if (Object.keys(takes).length) o.takes = takes;
        const why = Object.keys(takes).length ? breaks(v.name, a.name, takes, store, now) : null;
        if (why) {
          out.splice(i, 1);
          const k = `${v.name}|${a.name}|${o.id}|${Math.floor(now / 3600000)}`;
          if (!this.ruleLogged.has(k)) {
            this.ruleLogged.add(k);
            noteCompliance(v.name, a.name, { op: 'refused', option: o.id, why, takes });
          }
          continue;
        }
        if (ds.includes(o.kind) && !doneToday(o.kind)) {
          o.ruleTag = '[the duty: once a day]';
          o.rank = 1;
        }
        // (a contribution not yet met today: the options whose runs have put its class into storage, tagged and first)
        const ct = !o.ruleTag ? contributeTag(v.name, a.name, o.id, now) : null;
        if (ct) {
          o.ruleTag = ct;
          o.rank = 1;
        }
        // (#1, MC_NEED_VOTE: the need vote's winner weighs 1.5x for two days)
        const nb = needBoost(v.name, o.id, now);
        if (nb.w !== 1) {
          o.nw = Math.round((o.nw ?? 1) * nb.w * 100) / 100;
          o.ruleTag ??= nb.tag;
        }
      }
    }
    // G2 (MC_ACTS=on): an option answering a request to the member or keeping its promise is tagged, and the trim keeps it
    if (ACTS.on) {
      const t = actsTags(v.name, a.name, now);
      if (t.size) for (const o of out) if (t.has(o.id)) o.social = t.get(o.id);
    }
    // Character v2: the night's rest at home for a tired member (the user's: at night only), then each option's character
    // factor: mood on own projects, affinity on help for a friend and on a request's tag, needs on the rest
    if (CHARACTER.gauges && v.complete && clockOf(v.name, now)?.phase === 'night' && !busy.has(`rest:${a.name}`)) {
      const w = restWeight(v.name, a.name);
      const h = this.homeOf(v, a.name);
      if (w !== null && h && 'x1' in h) {
        const x = Math.floor(((h as Structure).x1 + (h as Structure).x2) / 2), z = Math.floor(((h as Structure).z1 + (h as Structure).z2) / 2);
        add({ id: 'rest', kind: 'rest', key: `rest:${a.name}`, excludes: [`rest:${a.name}=`], name: 'Rest at home', rank: 1200, at: { x, y: (h as Structure).y, z },
          facts: `your energy is ${Math.round((1 - (w - 1) / 2) * 100)}%; walk home and rest a while`, effect: 'your energy back up' }, { kind: 'rest', x, y: (h as Structure).y, z });
      }
    }
    if (characterAny()) {
      for (const o of out) {
        if (o.kind === 'eat') continue;
        const mw = moodWeight(v.name, a.name, o.kind, now);
        let fw = 1;
        if (CHARACTER.affinity && o.kind === 'help') {
          const d = OPTION_RUN.get(o);
          const it = d?.kind === 'help' ? (v.initiatives ?? []).find((i) => i.id === d.id) : undefined;
          if (it && it.by !== a.name) fw = helpWeight(v.name, a.name, it.by);
        }
        const asker = /^\[(\w+) asked you\]/.exec(o.social ?? '')?.[1];
        if (asker) fw *= requestWeight(v.name, a.name, asker);
        const dw = o.kind === 'rest' ? restWeight(v.name, a.name) ?? 1 : 1;
        if (mw !== 1) o.mw = mw;
        if (fw !== 1) o.fw = Math.round(fw * 100) / 100;
        if (dw !== 1) o.dw = dw;
        o.cf = characterFactor({ mw, fw, dw });
      }
    }
    // (MC_BAN_SCOPE=member: a member whose dig failed for want of a pickaxe sees the fix marked: making stone pickaxes, or the
    // cobblestone for one when that cannot be made)
    const need = BAN_MEMBER ? this.needTool.get(a.name.toLowerCase()) : undefined;
    if (need && need.until > now) {
      const fix = out.find((o) => o.id === 'make:stone_pickaxe') ?? out.find((o) => o.id === 'gather:cobblestone');
      if (fix) fix.need = fix.id === 'make:stone_pickaxe' ? 'you need a pickaxe to dig for iron' : 'cobblestone for the pickaxe you need to dig for iron';
    }
    const guarded: Array<{ id: string; why: string }> = guards ? starved.map((o) => ({ id: o.id, why: 'hungry' })) : [];
    let options = out;
    // (`feasible`: guarded but not trimmed; the trim only presents the menu, so a pick it would cut now is still runnable)
    let feasible = out;
    if (guards) {
      options = [];
      for (const o of out) {
        const ban = this.choiceStats.banned(v.name, o.kind, o.id, now, a.name);
        if (ban) {
          guarded.push({ id: o.id, why: `banned until ${clock(ban.until)}` });
          continue;
        }
        if (this.choiceStats.agentCooling(v.name, a.name, o.kind, now, o.kind === 'make' || o.kind === 'gather' || o.kind === 'light' || o.kind === 'furnish' || o.kind === 'initiate' || o.kind === 'help' || o.kind === 'activity' ? o.id : undefined)) {
          guarded.push({ id: o.id, why: 'you failed this kind in the last 5 minutes' });
          continue;
        }
        if (o.lp === undefined) o.lp = Math.round((0.5 + this.choiceStats.learningProgress(v.name, o.kind)) * 100) / 100;
        options.push(o);
      }
      feasible = options;
      const kept = trimMenu(options);
      for (const o of options) if (!kept.includes(o)) guarded.push({ id: o.id, why: 'trimmed' });
      options = kept;
    }
    for (const o of options) if (reasons[o.kind]) delete reasons[o.kind];
    return { options, feasible, effects: { skips }, reasons, guarded };
  }

  /** #79: the village's life goals, drawn over its members (their temperament vectors, whatever the mode) on first use. */
  goalsFor(v: Village): Goals {
    const members = [...this.agents.values()].filter((b) => b.village() === v).map((b) => ({ name: b.name, t: vectorOf(b.name) }));
    const before = goalsOf(v)?.drawnFor;
    const g = ensureGoals(v, members, Date.now());
    // (character v2, MC_VALUES: life goals drawn from values, the user's choice; a checkpoint's stored goals redrawn once, logged)
    if (CHARACTER.values) for (const m of members) {
      const want = goalFromValues(m.name);
      if (g.of[m.name] !== want) {
        console.log(`[goal] ${v.name}: ${m.name}'s goal ${g.of[m.name] ?? 'none'} -> ${want} (from values)`);
        g.of[m.name] = want as typeof g.of[string];
      }
    }
    if (before === undefined) console.log(`[goal] ${v.name}: goals drawn over ${members.length} members: ${Object.entries(g.of).map(([m, x]) => `${m} ${x}`).join(', ')}`);
    return g;
  }

  /** #79: what an option's run data says for the goals (the work an initiative builds, a make's good, an own option's what). */
  private goalFacts(v: Village, o: ChoiceOption): OptionFacts {
    const d = OPTION_RUN.get(o);
    if (!d) return {};
    if (d.kind === 'initiate') return { work: d.work };
    if (d.kind === 'help') {
      const it = (v.initiatives ?? []).find((i) => i.id === d.id);
      return { helpKind: it?.kind, mine: /^Continue your /.test(o.name) };
    }
    if (d.kind === 'make') return { good: d.good.item };
    if (d.kind === 'own') return { own: d.what };
    return {};
  }

  /** A.3p's own-pattern line from the agent's last 10 ends ('' when temperaments are off or none yet). */
  /** The goods an option brings in (s43's price weight): the field's wheat, a slot's crop, a pen's eggs, a catch, a make's product. */
  private optionGoods(o: ChoiceOption): string[] {
    const d = OPTION_RUN.get(o);
    if (!d) return [];
    if (d.kind === 'farm') return ['wheat'];
    if (d.kind === 'slot') return [d.slotKind === 'sugar_cane' ? 'sugar_cane' : d.slotKind];
    if (d.kind === 'penwork') return d.what === 'eggs' ? ['egg'] : [];
    if (d.kind === 'activity') return d.gives;
    if (d.kind === 'make') return [d.good.item];
    if (d.kind === 'own' && d.what === 'make') return [d.item];
    return [];
  }

  private patternLine(v: Village, a: BotAgent): string {
    const counts = TEMPERAMENT_MODE === 'off' ? [] : this.choiceStats.kindCounts(v.name, a.name, 10);
    const total = counts.reduce((s, c) => s + c.n, 0);
    // (farm and slot are both harvesting: one entry a phrase, in the counts' order)
    const byPhrase = new Map<string, number>();
    for (const c of counts) byPhrase.set(KIND_PHRASE[c.kind] ?? c.kind, (byPhrase.get(KIND_PHRASE[c.kind] ?? c.kind) ?? 0) + c.n);
    return total ? `Your last ${total} chore${total === 1 ? '' : 's'}: ${[...byPhrase.entries()].sort((x, y) => y[1] - x[1]).map(([p, n]) => `${p} ${n}`).join(', ')}` : '';
  }

  /** G5 (#90): what this village can do, for code's check of a proposal (scripts/proposals_ctx.mts builds the same
   *  offline): the registry and recipe graph, the skills, the library's activities and what they give, the workshop's
   *  goods, the inventions' goods, the merchant's wares, and the chores that failed in the last 2 hours. */
  proposalCtx(village: string): CheckCtx | null {
    const v = this.villages.get(village);
    if (!v) return null;
    const activityGives = new Map<string, string>();
    for (const sp of this.library.specs) for (const g of sp.gives) if (!activityGives.has(g.item)) activityGives.set(g.item, sp.name);
    const makeItems = new Map<string, string>();
    for (const g of this.goodsFor(v)) if (!makeItems.has(g.item)) makeItems.set(g.item, g.words);
    const inventionItems = new Map<string, string>();
    for (const e of LIBRARY) for (const g of e.goods) if (!inventionItems.has(g.item)) inventionItems.set(g.item, e.name);
    const now = Date.now();
    const fails = new Map<string, { name: string; message: string; n: number }>();
    for (const a of this.agents.values()) {
      if (a.village()?.name !== v.name) continue;
      for (const e of this.choiceStats.agentHistory(v.name, a.name, 30)) {
        if (e.ok || e.cut || e.at < now - 2 * 3600000) continue;
        const name = e.line.split(':')[0];
        const f = fails.get(name) ?? { name, message: e.line.slice(name.length + 1, name.length + 100).trim(), n: 0 };
        f.n++;
        fails.set(name, f);
      }
    }
    return {
      items: new Set(this.registry.itemsArray.map((it) => it.name)), plan: (b) => this.materials.plan(b),
      skills: new Set([...Object.keys(MC_SKILLS), ...FOUNDRY_SKILLS.map((f) => f.name)]),
      activitySkills: new Set([...this.library.specs.map((s) => s.skill), ...FOUNDRY_SKILLS.filter((f) => f.activity).map((f) => f.name)]),
      activityGives, makeItems, inventionItems, merchantSells: new Set(SELLS.map((o) => o.item)), failures: [...fails.values()],
    };
  }

  /** G3: a member's answer to its pending share under the levy, settled (kept to its own stock, the rest left in the
   *  commons) and logged for compliance (rules_use.py's levy table). */
  private settleShare(v: Village, agent: string, split: 'none' | 'levy' | 'all', decisionId?: string) {
    const rate = levyRate(v.name);
    const own = v.homes?.[agent];
    if (rate === undefined || !own) return;
    const total = pendingOf(own)?.total ?? 0;
    const r = settlePending(own, split, rate);
    if (!r) return;
    const left = Object.values(r.left).reduce((t, q) => t + q, 0);
    noteCompliance(v.name, agent, { op: 'levy', split, rate, total, left, decisionId });
    this.villages.save();
  }

  /** MC_WORK_BLOCKS: each member's open block of work (the option it repeats, until when, who decided it). */
  private blocks = new Map<string, { option: string; until: number; from: string }>();
  /** When each member's last chore ended (MC_QUICK_NEXT: the longest idle choose first). */
  private idleSince = new Map<string, number>();

  /** Character v2: villages whose run began in this process (a spawn with reset clears the state once). */
  private characterBegun = new Set<string>();

  /** G3: refusals by a rule already logged (village|agent|option|hour). */
  private ruleLogged = new Set<string>();

  /** G3: what an option takes from the village storage when it runs (its make's inputs, a light trip's torches, furniture,
   *  an activity's needs), for the quota and floor rules. */
  private takesOf(o: ChoiceOption): Record<string, number> {
    const d = OPTION_RUN.get(o);
    if (!d) return {};
    if (d.kind === 'make') return { ...d.inputs };
    if (d.kind === 'light') return { torch: d.n };
    if (d.kind === 'furnish') return { ...d.items };
    if (d.kind === 'activity') return { ...d.needs };
    return {};
  }

  /** G5: the village day whose triage marking is done, by village. */
  private triageDay = new Map<string, number>();

  /**
   * G5 (#90, MC_PROPOSALS), each sweep: once a village day, proposals ready for triage (two backers, a failure seen three
   * times, or a capability in the wanted list's top 3) are marked for it; and every answer (code's at once, triage's when
   * it lands) reaches its proposer and backers once: pinned in their memory, and a report in their inbox.
   */
  private proposalSweep(v: Village, now: number) {
    const day = clockOf(v.name, now)?.day ?? Math.floor(now / MEMORY.dayMs);
    const ps = allProposals(v.name);
    if (this.triageDay.get(v.name) !== day && ps.some((p) => p.status === 'open' || p.status === 'endorsed')) {
      this.triageDay.set(v.name, day);
      let top: string[] = [];
      try {
        top = topWanted(wantedList(v, { items: this.registry.itemsArray.map((it) => it.name), plan: (b) => this.materials.plan(b), skills: new Set(Object.keys(MC_SKILLS)), activitySkills: new Set(this.library.specs.map((s) => s.skill)), now }));
      } catch {
        // (the wanted list is G6's: a failure leaves the top empty)
      }
      for (const p of ps) if (readyForTriage(p, top) && markTriage(p.id)) console.log(`[proposal] ${v.name}: ${p.id} (${p.by}: ${p.what.slice(0, 60)}) ready for triage`);
    }
    for (const p of ps) {
      if (!p.verdict) continue;
      for (const who of [p.by, ...p.endorsements.map((e) => e.by)]) {
        if (toldAnswer(v.name, who, p.id)) continue;
        const line = who === p.by ? verdictLine(p) : verdictLine(p).replace(/^Your proposal/, `${p.by}'s proposal you backed,`);
        if (noteAnswer(v.name, who, p.id, line, now)) {
          tellMember(v.name, who, line, now);
          if (who === p.by && p.verdict.by === 'triage') think(v.name, who, p.verdict.decision === 'accept' ? 'accepted' : 'rejected', `your proposal was ${p.verdict.decision === 'accept' ? 'accepted' : 'not taken up'}`, now);
        }
      }
    }
  }

  /** G2: the village's members present, where they stand and the chore each has under way (social.observe's input). */
  private presences(v: Village): Presence[] {
    const out: Presence[] = [];
    for (const b of this.agents.values()) {
      if (b.village()?.name !== v.name) continue;
      const p = b.bot.entity?.position;
      if (!p) continue;
      const c = this.chores.get(b.name.toLowerCase());
      out.push({ name: b.name, x: p.x, z: p.z, ...(c && !c.choice.ended ? { chore: { id: c.choice.id, kind: c.choice.kind ?? c.key.split(':')[0] } } : {}) });
    }
    return out;
  }

  /** G2: the members within social.SEE blocks of `a` now. */
  private nearOf(v: Village, a: BotAgent): string[] {
    const p = a.bot.entity?.position;
    if (!p) return [];
    return this.presences(v).filter((q) => q.name !== a.name && Math.hypot(q.x - p.x, q.z - p.z) <= 32).map((q) => q.name);
  }

  /** Character v2: the identity line (in the persona's place: name, temperament words, life goal, house; the role only
   *  with roles shown) and the values, needs and mood lines, as the model sees them (names scrubbed under
   *  MCAI_SOCIAL=off); recorded as last written for the panel. */
  private characterLines(v: Village, a: BotAgent, now: number): { persona: string; character: string } {
    if (!characterAny()) return { persona: '', character: '' };
    const h = this.homeOf(v, a.name);
    const house = h && 'x1' in h ? `the ${(h as Structure).kind.replace(/_/g, ' ')} at ${Math.round(((h as Structure).x1 + (h as Structure).x2) / 2)},${Math.round(((h as Structure).z1 + (h as Structure).z2) / 2)}` : undefined;
    const goal = GOALS_ON ? goalsOf(v)?.of[a.name] : undefined;
    const role = SOCIAL.roles ? roleOf(v.name, a.name)?.kind : undefined;
    const persona = CHARACTER.identity ? identityLine(a.name, { goal, house, ...(role ? { role: roleNoun(role) } : {}) }) : CHARACTER.hexaco ? `You are ${temperamentWords(a.name)}.` : '';
    const lines = { identity: persona, values: CHARACTER.values ? valuesLine(a.name) : '', needs: needsLine(v.name, a.name), mood: moodLine(v.name, a.name, now) };
    const character = scrub(v.name, a.name, [lines.values, lines.needs, lines.mood].filter(Boolean).join(' '));
    noteLines(v.name, a.name, lines, now);
    return { persona: scrub(v.name, a.name, persona), character };
  }

  /** #117 (MC_PROMPT_SELF): the member's own state for its prompt: its house (standing, being built or none) and what the
   *  house has and lacks of its basics, what it carries, its emeralds (MC_OWN), its appetite (an appetite). */
  private selfFacts(v: Village, a: BotAgent): SelfFacts {
    const st = v.structures.find((q) => q.owner === a.name && isDwelling(q.kind));
    const own = v.homes?.[a.name];
    let house: HouseFacts;
    if (!st) house = { state: this.homeOf(v, a.name) ? 'building' : 'none' };
    else {
      const P = HOME_BASICS.on ? this.decorParts(v).find((q) => q.structure.id === st.id) : undefined;
      const piece = (p: string) => (p === 'table' ? 'crafting table' : p);
      let has: string[], lacks: string[];
      if (P?.basics) {
        const left = basicsLeft(v, st.id, P.basics, !!own?.chest);
        has = (['chest', 'table', 'bed'] as const).filter((p) => !left.includes(p)).map((p) => `a ${piece(p)}`);
        lacks = left.map(piece);
      } else {
        has = own?.chest ? ['a chest of your own'] : [];
        lacks = OWN.on && !own?.chest ? ['chest'] : [];
      }
      house = { state: 'standing', label: `the ${words(st.kind)} at ${Math.round((st.x1 + st.x2) / 2)},${Math.round((st.z1 + st.z2) / 2)}`, has, lacks };
    }
    const carry: Counts = {};
    for (const i of a.bot.inventory?.items() ?? []) carry[i.name] = (carry[i.name] ?? 0) + i.count;
    const ap = appetiteOn(v) ? v.food?.members[a.name] : undefined;
    return {
      house, carry, bedPossible: HOME_BASICS.on, chestPossible: HOME_BASICS.on || OWN.on,
      ...(OWN.on ? { emeralds: (own?.chest?.items.emerald ?? 0) + (carry.emerald ?? 0) } : {}),
      ...(ap ? { appetite: ap.level, hungry: stateOf(ap.level) !== 'fed' } : {}),
    };
  }

  /** #117: what the workshop is short of (gathering's demand against storage) and the goods made for nothing yet. */
  private scarcityText(v: Village, facts: Facts): string {
    const s = facts.store;
    const short = CHOOSE.families.has('gather') ? (() => {
      const want = facts.gather();
      return MATERIALS.map((m) => ({ item: m, wanted: want[m].need, stored: m === 'logs' ? (v.wood ? s[`${v.wood}_log`] ?? 0 : Object.entries(s).filter(([x]) => /_log$/.test(x)).reduce((t, [, q]) => t + q, 0)) : s[m] ?? 0 }));
    })() : [];
    const unused = CHOOSE.families.has('make') ? this.goodsFor(v).filter(unusedGood).map((g) => g.words) : [];
    return scarcityLine(short, unused);
  }

  /** #117: why nothing on the menu feeds the ambition's current stage: its options held back (a ban, a recent failure) or
   *  the reasons its kinds have none ('' when the stage has no feeding work yet). */
  private ambitionWhyNot(v: Village, guarded: Array<{ id: string; why: string }>, reasons: Partial<Record<string, string>>): string {
    const st = LADDER ? v.ladder : undefined;
    const sd = st?.current ? RUNG_DEFS[st.current as keyof typeof RUNG_DEFS]?.stages[st.stage] : undefined;
    if (!sd?.feeds) return '';
    const held = guarded.filter((g) => g.why !== 'trimmed' && feedsStage(v, g.id)).map((g) => `${KIND_WORDS[g.id.split(':')[0]] ?? g.id}: ${/^banned/.test(g.why) ? 'held back after a failure' : g.why}`);
    const none = feedKinds(sd.feeds).filter((k) => reasons[k]).map((k) => `${KIND_WORDS[k] ?? k}: ${reasons[k]}`);
    return ambitionGap([...new Set([...held, ...none])]);
  }

  /** The prompt's context (pure): the village at a glance, the others' chores, the agent's last outcomes. */
  private choiceContext(v: Village, a: BotAgent, facts: Facts, menuKinds: string[] = []): ChoiceContext {
    const s = facts.store;
    const items = ['wheat', 'wheat_seeds', 'bread', 'raw_iron', 'bucket', 'milk_bucket', 'egg', 'sugar_cane', 'cake', ...(CHOOSE.families.has('light') ? ['torch'] : [])].filter((n) => s[n]).map((n) => `${s[n]} ${words(n)}`);
    const lay0 = v.layouts?.[0];
    const slots = (v.layouts ?? []).flatMap((l) => l.slots ?? []);
    const farms = [...(v.layouts ?? []).filter((l) => l.farm?.planted).map(() => 'a wheat field'), ...slots.filter((q) => !q.annex && q.kind).map((q) => `${words(q.kind!)} on a slot`)];
    const freeN = slots.filter((q) => !q.annex && !q.kind).length;
    const pens = slots.filter((q) => q.annex && q.kind && q.pen?.built).map((q) => `${q.pen?.animals ?? 0} ${q.kind}s`);
    const m = v.mine;
    const iron = !m || m.level === undefined ? 'no mine' : (m.ironMade ?? []).length ? `made ${(m.ironMade ?? []).map(words).join(', ')}` : m.iron ? 'being dug' : 'not started';
    const village = [`${v.name}, complete`, `Storage: ${items.join(', ') || 'nothing of note'}`,
      `Farms: ${farms.join(', ') || 'none'}${freeN ? `, ${freeN} slot${freeN === 1 ? '' : 's'} free` : ''}`,
      `Pens: ${lay0?.annex?.state === 'ready' ? pens.join(', ') || 'none yet' : 'no annex yet'}`,
      `Explored: ${v.explore?.visited.length ?? 0} of 8 points round the village`, `Iron: ${iron}`].join('. ');
    const kinds = new Map<string, string[]>();
    let choosing = 0, idle = 0;
    for (const b of this.agents.values()) {
      if (b === a || b.village()?.name !== v.name) continue;
      const c = this.chores.get(b.name.toLowerCase());
      if (c && !c.choice.ended) {
        const k = c.choice.kind ?? c.key.split(':')[0];
        kinds.set(k, [...(kinds.get(k) ?? []), b.name]);
      } else if (this.pending.has(b.name.toLowerCase())) choosing++;
      else if (b.idle()) idle++;
    }
    // (G2: under MCAI_SOCIAL on and countsonly the awareness block replaces this line; off shows neither)
    const others = blockOn() || socialOff() ? '' : [...[...kinds.entries()].map(([k, n]) => `${KIND_WORDS[k] ?? k} ${n.length} (${n.slice(0, 3).join(', ')}${n.length > 3 ? ', ...' : ''})`),
      ...(choosing ? [`choosing ${choosing}`] : []), `idle ${idle}`].join(', ');
    const block = blockOn() ? awareness(v.name, a.name, facts.t, { kinds, choosing, idle, menuKinds, near: this.nearOf(v, a) }).text : '';
    const role = roleLine(v.name, a.name);
    const skill = skillLine(v.name, a.name);
    const rules = RULES.on ? [rulesLine(v.name), councilLine(v.name, facts.t)].filter(Boolean).join(' ') : '';
    // (A.3p: the user's own persona first, else the temperament's line; the own-pattern reminder from the last 10 ends)
    const own = typeof a.memory.persona === 'string' ? a.memory.persona.slice(0, 300) : '';
    const pattern = this.patternLine(v, a);
    const char = this.characterLines(v, a, facts.t);
    return {
      // (Experiment 2, MCAI_INFLUENCERS: an influencer's line on the levy; unchanged for everyone else)
      persona: withInfluence(a.name, own || char.persona || personaOf(a.name)),
      ...(char.character ? { character: char.character } : {}),
      ...(pattern ? { pattern } : {}),
      village: village.slice(0, 300), others: others.slice(0, 200),
      ...(block ? { social: block } : {}), ...(role ? { role } : {}), ...(skill ? { skill } : {}), ...(rules ? { rules } : {}),
      outcomes: this.choiceStats.outcomes(v.name, a.name, 5).map((l) => scrub(v.name, a.name, l)),
      // (#69: the member's own wants, one line)
      ...(OWN.on ? (() => { const w = this.wantsOf(v, a.name); const line = w ? wantsLine(w) : ''; return line ? { wants: line.slice(0, 240) } : {}; })() : {}),
      // (#79: the member's life goal and its progress, one line)
      ...(GOALS_ON && v.complete ? (() => { this.goalsFor(v); const line = goalLine(v, a.name, PROMPT_SELF); return line ? { goal: line.slice(0, PROMPT_SELF ? 460 : 200) } : {}; })() : {}),
      // (#117: the member's own state and basic needs; what is short and what is made for nothing)
      ...(PROMPT_SELF ? (() => {
        const d = this.selfFacts(v, a);
        const sc = this.scarcityText(v, facts);
        return { self: [selfLine(d), basicNeedsLine(d)].filter(Boolean).join(' '), ...(sc ? { scarcity: sc } : {}) };
      })() : {}),
      // (G8: the ladder's progress line, with a stage's news for a village day)
      ...(LADDER && v.complete ? (() => { ladderOf(v, Date.now()); const line = progressLine(v, Date.now(), MEMORY.dayMs); return line ? { ladder: line } : {}; })() : {}),
      // (M3, MC_MONUMENT_NEWS: the cathedral's progress line, its news for a village day and the member's trade)
      ...(MONUMENT.on && M3.news && v.monument ? { monument: monumentProgress(v.monument, Date.now(), MEMORY.dayMs, a.name) } : {}),
      // (N.1: the needs at LOW or above, most acute first)
      ...(NEEDS_MODE === 'on' && (this.needReadings.get(v.name) ?? []).some((r) => r.level >= LOW)
        ? { needs: (this.needReadings.get(v.name) ?? []).filter((r) => r.level >= LOW).sort((x, y) => y.level - x.level).slice(0, 3).map((r) => r.text) } : {}),
    };
  }

  /**
   * Run an option: the writes the old picker made at queue time (spec 1.3: a pen's workAt, the cake's back-off, the explore
   * ring), then the skill queued and the chore recorded. Called only inside runPick's try (D9).
   */
  private runOption(v: Village, worker: BotAgent, opt: ChoiceOption, meta: ChoiceMeta) {
    this.needNote(v, undefined, opt);
    const d = OPTION_RUN.get(opt);
    if (!d) throw new Error(`no run data for ${opt.id}`);
    switch (d.kind) {
      case 'rest':
        this.setChore(v, worker, opt.key, [worker.enqueue('move_to', { x: d.x, y: d.y, z: d.z, range: 3, chore: true }), worker.enqueue('wait', { seconds: Math.max(10, Math.round(120 / timeScale())), chore: true })], 'rest at home', undefined, meta, opt.holds, opt);
        return;
      case 'innovate':
        this.setChore(v, worker, opt.key, [worker.enqueue('experiment', { entry: d.entry, boost: d.boost, chore: true })], `experiment with ${d.entry}`, undefined, meta, opt.holds, opt);
        console.log(`[innovate] ${v.name}: ${worker.name} experiments with ${d.entry} (chance ${Math.round(d.chance * 100)}%)`);
        return;
      case 'own':
        if (d.what === 'pledge') {
          this.setChore(v, worker, opt.key, [worker.enqueue('pledge', { entry: d.entry, item: d.item, count: d.n, chore: true })], `pledge toward ${d.entry}`, undefined, meta, opt.holds, opt);
          console.log(`[innovate] ${v.name}: ${worker.name} goes to pledge ${d.n} ${d.item} toward ${d.entry}`);
          return;
        }
        if (d.what === 'farm') {
          this.setChore(v, worker, opt.key, [worker.enqueue('lay_out_field', { own: true, crop: d.crop, chore: true })], `start a ${d.crop} farm of your own`, (why) => {
            // (a member whose house has no room for a field is not offered one again for 30 minutes)
            this.ownFarmBack.add(`${v.name}|${worker.name}`);
            setTimeout(() => this.ownFarmBack.delete(`${v.name}|${worker.name}`), 30 * 60000).unref?.();
            console.log(`[own] ${v.name}: ${worker.name} could not start a farm of its own: ${why.slice(0, 160)}`);
          }, meta, opt.holds, opt);
          console.log(`[own] ${v.name}: ${worker.name} goes to start a farm of its own`);
          return;
        }
        if (d.what === 'sell' || d.what === 'buy') {
          if (d.what === 'sell') {
            const sold = (this.ownSold.get(v.name) ?? {}) as Counts;
            sold[d.item] = (sold[d.item] ?? 0) + d.lots;
            this.ownSold.set(v.name, sold);
          }
          this.setChore(v, worker, opt.key, [worker.enqueue('merchant_own', d.what === 'sell' ? { sell: d.item, lots: d.lots, chore: true } : { buy: d.item, chore: true })], d.what === 'sell' ? `sell ${d.lots * OWN_SALES[d.item]} ${d.item}` : `buy a ${d.item}`, undefined, meta, opt.holds, opt);
          console.log(`[own] ${v.name}: ${worker.name} goes to ${d.what === 'sell' ? `sell ${d.lots * OWN_SALES[d.item]} ${d.item}` : `buy a ${d.item}`} at the merchant's`);
          return;
        }
        if (d.what === 'trade') {
          this.setChore(v, worker, opt.key, [worker.enqueue('trade_offer', { offer: d.offer, chore: true })], `take offer ${d.offer}`, undefined, meta, opt.holds, opt);
          console.log(`[barter] ${v.name}: ${worker.name} goes to take offer ${d.offer}`);
          return;
        }
        if (d.what === 'make') {
          this.setChore(v, worker, opt.key, [worker.enqueue('make_own', { item: d.item, count: d.n, fuel: d.fuel, chore: true })], `make ${d.n} ${d.item} from your own stock`, undefined, meta, opt.holds, opt);
          console.log(`[own] ${v.name}: ${worker.name} goes to make ${d.n} ${d.item} from its own stock`);
          return;
        }
        if (d.what === 'deliver') {
          const k = contractOf(v, d.contract);
          this.setChore(v, worker, opt.key, [worker.enqueue('deliver_own', { contract: d.contract, chore: true })], `deliver to ${k?.payer ?? 'a buyer'}`, undefined, meta, opt.holds, opt);
          console.log(`[pay] ${v.name}: ${worker.name} goes to deliver ${k ? deliveryWords(k) : 'goods'} to ${k?.payer ?? '?'} (${d.contract})`);
          return;
        }
        if (d.what === 'decor') {
          this.setChore(v, worker, opt.key, [worker.enqueue('decorate_home', { chore: true })], 'decorate your own house', undefined, meta, opt.holds, opt);
          console.log(`[decor] ${v.name}: ${worker.name} goes to decorate its house`);
          return;
        }
        if (d.what === 'basics') {
          this.setChore(v, worker, opt.key, [worker.enqueue('home_basics', { chore: true })], 'set up your own house', undefined, meta, opt.holds, opt);
          console.log(`[home] ${v.name}: ${worker.name} goes to set up its house`);
          return;
        }
        if (d.what === 'shear') {
          const ids = [
            ...(d.make ? [worker.enqueue('make_iron_tool', { item: 'shears', chore: true })] : []),
            worker.enqueue('shear_for_bed', { chore: true }),
            worker.enqueue('home_basics', { chore: true }),
          ];
          this.setChore(v, worker, opt.key, ids, 'shear wool for your bed', undefined, meta, opt.holds, opt);
          console.log(`[home] ${v.name}: ${worker.name} goes to shear wool for its bed${d.make ? ' (shears made first)' : ''}`);
          return;
        }
        if (d.what === 'chest') this.setChore(v, worker, opt.key, [worker.enqueue('place_own_chest', { chore: true })], 'put a chest in your own house', undefined, meta, opt.holds, opt);
        else this.setChore(v, worker, opt.key, [worker.enqueue('carry_home', { want: d.want, chore: true })], 'take your share home', undefined, meta, opt.holds, opt);
        console.log(`[own] ${v.name}: ${worker.name} goes to ${d.what === 'chest' ? 'put a chest in its house' : `take ${Object.entries((d as { want: Counts }).want).map(([n, q]) => `${q} ${n}`).join(', ')} home`}`);
        return;
      case 'eat':
        if (d.own) {
          this.setChore(v, worker, opt.key, [worker.enqueue('eat_own', { chore: true })], `eat ${d.n} ${d.item} from your own chest`, undefined, meta, opt.holds, opt);
          console.log(`[food] ${v.name}: ${worker.name} goes to eat ${d.n} ${d.item} from its own chest (${d.level.toFixed(1)} of 20)`);
          return;
        }
        this.setChore(v, worker, opt.key, [worker.enqueue('eat_meal', { chore: true })], `eat ${d.n} ${d.item}`, undefined, meta, opt.holds, opt);
        // (held from the other members' meals and claims until the chore ends: lens 1 M1)
        holdMeal(v.name, worker.name, { item: d.item, n: d.n });
        console.log(`[food] ${v.name}: ${worker.name} goes to eat ${d.n} ${d.item} (${d.level.toFixed(1)} of 20)`);
        return;
      case 'farm':
        // (`chore`: the brains leave its events alone, as the mayor's gathering)
        this.setChore(v, worker, opt.key, [worker.enqueue('harvest_farm', { layout: d.k, chore: true })], `harvest the wheat on layout ${d.k}`, undefined, meta, opt.holds, opt);
        console.log(`[farm] ${v.name} layout ${d.k}: ${d.ripe} of ${d.grown} wheat ripe, ${worker.name} harvests`);
        this.villages.note(v, `${d.ripe} of ${d.grown} wheat ripe on layout ${d.k}'s farm: ${worker.name} harvests it (a chore)`);
        return;
      case 'slot':
        this.setChore(v, worker, opt.key, [worker.enqueue('harvest_slot', { layout: d.k, slot: d.j, chore: true })], `harvest ${d.slotKind}`, undefined, meta, opt.holds, opt);
        console.log(`[farm] ${v.name} slot ${d.k}.${d.j}: ${d.ripe} ${d.slotKind} ripe, ${worker.name} harvests`);
        return;
      case 'start':
        // (from storage, s30's D4: a kind the village farms on another slot)
        if (d.store) {
          this.setChore(v, worker, opt.key, [worker.enqueue('start_farm', { layout: d.k, slot: d.j, kind: d.slotKind, from: 'storage', chore: true })], `start ${d.slotKind}`, undefined, meta, opt.holds, opt);
          console.log(`[farm] ${v.name}: ${worker.name} starts a ${d.slotKind} farm on slot ${d.k}.${d.j} from storage`);
          this.villages.note(v, `${worker.name} starts a ${d.slotKind} farm on farm slot ${d.j} of layout ${d.k} from the village storage (a chore)`);
          return;
        }
        this.setChore(v, worker, opt.key, [worker.enqueue('start_farm', { layout: d.k, slot: d.j, kind: d.slotKind, x: d.x, y: d.y, z: d.z, chore: true })], `start ${d.slotKind}`, undefined, meta, opt.holds, opt);
        console.log(`[farm] ${v.name}: ${d.slotKind} seen at ${d.x},${d.y},${d.z}; ${worker.name} starts a ${d.slotKind} farm on slot ${d.k}.${d.j}`);
        this.villages.note(v, `${d.slotKind} seen at ${d.x},${d.y},${d.z}: ${worker.name} starts a ${d.slotKind} farm on farm slot ${d.j} (a chore)`);
        return;
      case 'annex':
        this.setChore(v, worker, opt.key, [worker.enqueue('prepare_annex', { chore: true })], 'prepare the annex', undefined, meta, opt.holds, opt);
        console.log(`[annex] ${v.name}: ${worker.name} prepares the annex${d.again ? ` at ${d.area} (again)` : ''}`);
        return;
      case 'pen':
        this.setChore(v, worker, opt.key, [worker.enqueue('start_pen', { layout: 1, slot: d.j, kind: d.slotKind, x: d.x, y: d.y, z: d.z, chore: true })], `start a ${d.slotKind} pen`, undefined, meta, opt.holds, opt);
        console.log(`[pen] ${v.name}: ${d.slotKind} seen at ${d.x},${d.y},${d.z}; ${worker.name} starts a pen on annex slot ${d.j}`);
        this.villages.note(v, `${d.slotKind}s seen at ${d.x},${d.y},${d.z}: ${worker.name} leads them into a pen on the annex (a chore)`);
        return;
      case 'penwork': {
        const pen = v.layouts?.[0]?.slots?.[d.j - 1]?.pen;
        if (!pen) throw new Error(`no pen on annex slot ${d.j}`);
        // (each kind of work backs off after it was queued, done or not)
        pen.workAt = { ...pen.workAt, [d.what]: Date.now() };
        this.villages.save();
        this.setChore(v, worker, opt.key, [worker.enqueue(d.skill, { layout: 1, slot: d.j, chore: true })], `${d.skill} on annex slot ${d.j}`, undefined, meta, opt.holds, opt);
        console.log(`[pen] ${v.name}: ${worker.name} ${d.skill} on annex slot ${d.j} (${d.slotKind}, ${d.animals} in the pen)`);
        return;
      }
      case 'cake':
        this.cakeAt.set(v.name, Date.now());
        this.setChore(v, worker, opt.key, [worker.enqueue('bake_cake', { chore: true })], 'bake a cake', undefined, meta, opt.holds, opt);
        console.log(`[cake] ${v.name}: ${worker.name} bakes a cake`);
        return;
      case 'iron': {
        const stage = d.stage;
        // (G8, MC_IRON_AGE: a full trip, never cut at the first ore; a smelt at its works furnace; a forge from ingots only,
        // for its recipient)
        const status = IRON_AGE
          ? stage === 'dig' ? worker.enqueue('dig_iron', { chore: true, minutes: 4, want: 6 })
            : stage === 'smelt' ? worker.enqueue('smelt_iron', { count: d.count ?? 8, furnace: d.k, chore: true })
            : worker.enqueue('make_iron_tool', { item: d.tool, smelt: false, ...(d.for ? { for: d.for } : {}), chore: true })
          : stage === 'dig'
          ? worker.enqueue('dig_iron', { chore: true, minutes: 4, want: Math.max(1, (d.tool === 'bucket' ? 3 : 6) - d.iron) })
          : worker.enqueue('make_iron_tool', { item: stage, chore: true });
        const failed = (why: string) => {
          const mm = v.mine;
          if (!mm || why === 'cancelled') return;
          // (another miner on the stairs or every leg taken: contention, not this work's failure)
          if (IRON_AGE && IRON_WAIT.test(why)) return;
          const sk = IRON_AGE && stage === 'forge' ? `forge:${d.tool}` : stage;
          mm.ironTries = { ...(mm.ironTries ?? {}), [sk]: (mm.ironTries?.[sk] ?? 0) + 1 };
          mm.ironLastTry = { at: Date.now(), stage: sk, why: why.slice(0, 200) };
          this.villages.save();
        };
        this.setChore(v, worker, opt.key, [status], `iron: ${stage}`, failed, meta, opt.holds, opt);
        // (G8: a forge's ingots earmarked until its chore ends, set after the chore as a make's are)
        if (IRON_AGE && stage === 'forge') holdsSet(holdKey(v.name, worker.name), { iron_ingot: FORGE_COST[d.tool] ?? 3 });
        console.log(`[iron] ${v.name}: ${worker.name} ${stage === 'dig' ? `digs the iron level (${d.iron} iron in storage)` : stage === 'smelt' ? `smelts ${d.count} raw iron at works furnace ${d.k}`
          : stage === 'forge' ? `forges ${d.tool}${d.for ? ` for ${d.for}` : ' for the village'}` : `makes a ${stage}`}`);
        return;
      }
      case 'explore': {
        const ex = (v.explore ??= { visited: [] });
        ex.visited.push(d.i);
        ex.last = `${worker.name} to ${d.x},${d.z}`;
        this.villages.save();
        const out = worker.enqueue('scout', { x: d.x, z: d.z, chore: true });
        // (home: true, teleported home when the walk back fails: Worker1 floated in a lake 4 min, F189)
        const back = worker.enqueue('scout', { x: d.home.x, z: d.home.z, chore: true, home: true });
        this.setChore(v, worker, opt.key, [out, back], `explore ${d.x},${d.z}`, undefined, meta, opt.holds, opt);
        console.log(`[explore] ${v.name}: ${worker.name} scouts ${d.x},${d.z} (${ex.visited.length} of 8), then home`);
        return;
      }
      case 'make': {
        const item = d.good.item;
        // (X.1: the catalogue's spec says the skill and its fixed arguments; the count and furnace are this batch's)
        const step = CHOOSE.families.has('catalog') ? this.catalog(v)?.specs.get(`make:${item}`)?.steps[0] : undefined;
        const status = worker.enqueue(step?.skill ?? 'make', { ...(step?.args ?? {}), item, count: d.count, ...(d.k !== undefined ? { furnace: d.k } : {}), chore: true });
        // (a failure backs the good off, 10 minutes, an hour after 3; not a stop, nor another agent's work in the way)
        const failed = (why: string) => {
          if (why === 'cancelled' || status.code) return;
          // (no path to a works furnace: the furnace waits, not the good, F233)
          if (d.k && /no path to/.test(why)) {
            this.furnaceBack.set(`${v.name}:${d.k}`, Date.now() + 10 * 60000);
            return;
          }
          const k = `${v.name}:${item}`, b = this.makeBack.get(k);
          this.makeBack.set(k, { tries: effTries(b?.tries, b?.at, Date.now()) + 1, at: Date.now() });
        };
        this.setChore(v, worker, opt.key, [status], `make ${d.count} ${item}`, failed, meta, opt.holds, opt);
        const c = this.chores.get(worker.name.toLowerCase());
        if (c) c.choice.make = { item, count: d.count, smelts: d.smelts, ...(d.k !== undefined ? { k: d.k } : {}) };
        // Its inputs earmarked until it withdraws them (D6): other agents' plans leave them out meanwhile (set after the
        // chore, whose replacement of an old one would end it and delete the earmark)
        holdsSet(holdKey(v.name, worker.name), d.inputs);
        console.log(`[make] ${v.name}: ${worker.name} makes ${d.count} ${item} (${d.stock} of ${this.makeTarget(v, d.good)}; inputs ${countsList(d.inputs)}; ${d.k !== undefined ? `furnace ${d.k}` : 'crafted'})`);
        return;
      }
      case 'gather': {
        const collect = worker.enqueue('collect', { block: d.block, count: d.amount, chore: true });
        // (deposit runs after a failed collect too: a partial load is put in and counts, the check's M3)
        const deposit = worker.enqueue('deposit', { item: d.deposit, also: GATHER_ALSO, chore: true });
        const failed = (why: string) => {
          if (why === 'cancelled' || collect.code || deposit.code) return;
          if (deposit.state === 'done' && depositedOf(deposit.message ?? '', d.material) > 0) return;
          // Nothing landed. "None found" is one gatherer's answer: candidates another held as unreachable for 10 minutes, or
          // a search from far out, gave it while sand lay near (S.9's review, lens 4 M2). The first answer backs the
          // material off 30 minutes; sand is marked unavailable for the village (as noneToGather does: the windows and the
          // glass goods go without) only when another agent answers the same at least GATHER_NONE_APART later. Anything
          // else waits 10 minutes
          const gk = `${v.name}:${d.material}`;
          if (/cannot be gathered here/.test(collect.message ?? '')) {
            const first = this.gatherNone.get(gk), now = Date.now();
            if (d.material === 'sand' && first && first.agent !== worker.name && now - first.at >= GATHER_NONE_APART) {
              this.gatherNone.delete(gk);
              if (!v.unavailable?.includes('sand')) {
                v.unavailable = [...(v.unavailable ?? []), 'sand'];
                this.villages.note(v, `no sand near the village (found none by ${first.agent} and ${worker.name}): the workshop makes no glass`);
                this.villages.save();
              }
              return;
            }
            // (the first answer is kept: the second must come from another agent; one older than two hours starts afresh)
            if (!first || now - first.at > 2 * 60 * 60000) this.gatherNone.set(gk, { agent: worker.name, at: now });
            this.gatherBack.set(gk, now + GATHER_NONE_BACK);
            return;
          }
          this.gatherBack.set(gk, Date.now() + 10 * 60000);
        };
        this.setChore(v, worker, opt.key, [collect, deposit], `gather ${d.amount} ${d.material}`, failed, meta, opt.holds, opt);
        const c = this.chores.get(worker.name.toLowerCase());
        if (c) c.choice.gather = { material: d.material, n: d.amount };
        console.log(`[gather] ${v.name}: ${worker.name} gathers ${d.amount} ${d.material} (need ${d.need}, incoming ${d.incoming}; for ${d.for.join(', ') || 'the workshop'})`);
        return;
      }
      case 'works': {
        if (d.stage === 'prepare') {
          this.setChore(v, worker, opt.key, [worker.enqueue('prepare_works', { chore: true })], 'prepare the works plot', undefined, meta, opt.holds, opt);
          console.log(`[works] ${v.name}: ${worker.name} is to prepare the works plot${d.again ? ` (again, at ${d.area})` : ''}`);
          return;
        }
        const k = d.k;
        const status = worker.enqueue('place_works_furnace', { k, chore: true });
        // (a failed placement waits 10 minutes; the skill clears nothing on the record, the furnace k stays unrecorded)
        const failed = (why: string) => {
          if (why !== 'cancelled' && !status.code) this.worksBack.set(`${v.name}:${k}`, Date.now() + 10 * 60000);
        };
        this.setChore(v, worker, opt.key, [status], `place works furnace ${k}`, failed, meta, opt.holds, opt);
        const c = this.chores.get(worker.name.toLowerCase());
        if (c) c.choice.furnace = k;
        // Its 8 cobblestone earmarked (the check's M5), as a make's inputs
        holdsSet(holdKey(v.name, worker.name), { cobblestone: 8 });
        console.log(`[works] ${v.name}: ${worker.name} places works furnace ${k} (8 cobblestone earmarked)`);
        return;
      }
      case 'light': {
        const status = worker.enqueue('put_up_torches', { part: d.part, count: d.n, chore: true });
        // (a failure backs the part off 10 minutes; not a stop, nor another agent's work in the way)
        const failed = (why: string) => {
          if (why !== 'cancelled' && !status.code) this.lightBack.set(`${v.name}:${d.part}`, Date.now() + 10 * 60000);
        };
        this.setChore(v, worker, opt.key, [status], `light ${d.label}`, failed, meta, opt.holds, opt);
        const c = this.chores.get(worker.name.toLowerCase());
        if (c) c.choice.light = { part: d.part, n: d.n };
        // (the spare before this earmark: what the menu offered from)
        const spare = this.makeSpare(v, worker.name).torch ?? 0;
        // Its torches earmarked until it withdraws them (D6), set after the chore as a make's inputs
        holdsSet(holdKey(v.name, worker.name), { torch: d.n });
        console.log(`[light] ${v.name}: ${worker.name} lights ${d.part} (${d.label}): ${d.n} of ${d.unlit} unlit, ${spare} torches spare`);
        return;
      }
      case 'initiate': {
        // The record first, at a spot found again now (the menu's may be taken), then its first step at once (s35)
        const k = smallWorkKind(d.work);
        const wood = this.catalogWoodOf(v);
        const found = k ? this.smallWorkSpot(v, k, wood, worker.name) : null;
        // (no room on the plots: on a green of its own when offered so and none is being prepared, s36)
        const home = villageHome(v);
        const pending = !found && !!d.green && !!home && !(v.initiatives ?? []).some((i) => i.state === 'open' && i.pending);
        const spot = found ?? (pending && home ? { x: home.x, y: v.plots[0]?.y ?? 64, z: home.z } : null);
        if (!k || !spot || (v.initiatives ?? []).some((i) => i.state === 'open' && i.by === worker.name)) {
          console.log(`[initiative] ${v.name}: ${worker.name} could not start a ${d.work} (${!k ? 'unknown kind' : !spot ? 'no room left' : 'its own is open'})`);
          return;
        }
        // (#140: the mix the menu offered: the same census and seed)
        const design = k.make((WOOD_VARIANTS && hoodWoodAt(v, spot.x, spot.z)) || wood, d.mix ?? this.flowerMixFor(v, worker, k.kind));
        // (its first step decided before the record: no initiative opens that nobody can work on, s36)
        const first = this.initiativeStep(v, { id: '_new', design: design.name, pending }, this.makeSpare(v, worker.name), new Set(), design);
        if (!first) {
          console.log(`[initiative] ${v.name}: ${worker.name} could not start a ${d.work} (nothing to gather for it now)`);
          return;
        }
        if (!v.designs[design.name]) v.designs[design.name] = design;
        const it: Initiative = { id: `i${(v.initiativeN = (v.initiativeN ?? 0) + 1)}`, by: worker.name, kind: k.kind, design: design.name, x: spot.x, y: spot.y, z: spot.z, at: Date.now(), state: 'open', crew: [worker.name], steps: [], ...(pending ? { pending: true } : {}), ...(found?.prep ? { prep: true } : {}) };
        v.initiatives = [...(v.initiatives ?? []), it];
        this.villages.note(v, `${worker.name} starts a ${k.words} of its own ${pending ? 'on a new green' : `at ${spot.x},${spot.z}`} (${it.id})`);
        this.villages.save();
        console.log(`[initiative] ${v.name}: ${worker.name} starts ${it.id}, a ${k.words} (${design.name}) ${pending ? 'on a new green' : `at ${spot.x},${spot.y},${spot.z}`}`);
        this.runInitiativeStep(v, worker, it, first, opt, meta);
        return;
      }
      case 'grow': {
        // N.2: the request first (growTick finishes it if it cannot be laid out now: a style vote under way), H3
        const g = (v.growth ??= { past: [] });
        if (g.request || g.active || this.homeOf(v, worker.name)) {
          console.log(`[home] ${v.name}: ${worker.name} could not start a street of houses (${g.request ? 'one is asked for' : g.active ? 'a layout is being built' : 'it has a house'})`);
          return;
        }
        const now = Date.now();
        g.request = { by: worker.name, at: now };
        this.villages.save();
        console.log(`[home] ${v.name}: ${worker.name} starts a street of houses (${d.houseless} of ${this.growMembers(v).length} members without one)`);
        this.villages.note(v, `${worker.name} starts a street of houses for itself and others without one`);
        if (!this.homeLayout(v, worker, now, meta, opt)) console.log(`[home] ${v.name}: ${worker.name}'s street waits (${this.voting.has(v.name) ? 'the style vote' : 'growth not ready'}): growTick lays it out`);
        return;
      }
      case 'monument': {
        const m = v.monument;
        if (!m) return;
        const N = monumentNoun(m);
        // (#163, MC_LODGE: its withdrawals and deposits at the masons' lodge, mcStorage.ts' atLodge; cleared at its end)
        // (not the dyer's: it works at the dye bed by the hut, and its seeds and flowers are the hut's)
        if (LODGE.on && d.step !== 'dye') worker.memory.lodge = true;
        if (d.step === 'site') {
          const st = worker.enqueue('monument_site', { chore: true });
          const failed = (why: string) => {
            if (why === 'cancelled' || st.code) return;
            m.fails = (m.fails ?? 0) + 1;
            m.backoff = Date.now() + 5 * 60000;
            this.villages.save();
          };
          this.setChore(v, worker, opt.key, [st], `prepare the ${N}'s site`, failed, meta, opt.holds, opt);
          const c = this.chores.get(worker.name.toLowerCase());
          if (c) c.choice.monument = { site: true };
          console.log(`[monument] ${v.name}: ${worker.name} prepares the ${N}'s site`);
          return;
        }
        if (d.step === 'job') {
          const job = d.job;
          const st = worker.enqueue('build_monument', { job, chore: true });
          const failed = (why: string) => {
            if (why !== 'cancelled' && !st.code) this.monumentBack.set(`${v.name}:${job}`, Date.now() + 5 * 60000);
          };
          this.setChore(v, worker, opt.key, [st], `build the ${N}'s job ${job}`, failed, meta, opt.holds, opt);
          const c = this.chores.get(worker.name.toLowerCase());
          if (c) c.choice.monument = { job };
          console.log(`[monument] ${v.name}: ${worker.name} builds job ${job} (stage ${monumentPlan(m).jobs[job].stage}, ${monumentPlan(m).jobs[job].blocks} blocks)`);
          return;
        }
        if (d.step === 'deep') {
          // (an iron trip on the deep level: its tunnels' stone deposited in storage, claimed for the yard on the next look)
          const dig = worker.enqueue('dig_iron', { chore: true, minutes: 5, want: 999 });
          worker.memory.monumentGather = d.item;
          const failed = (why: string) => {
            if (why !== 'cancelled' && !dig.code) this.monumentBack.set(`${v.name}:deep`, Date.now() + 3 * 60000);
          };
          this.setChore(v, worker, opt.key, [dig], `dig the deep level for the ${N}'s ${d.item}`, failed, meta, opt.holds, opt);
          const c = this.chores.get(worker.name.toLowerCase());
          if (c) c.choice.monument = { item: d.item, material: 'cobblestone', n: 0 };
          console.log(`[monument] ${v.name}: ${worker.name} digs the deep level for ${d.item} (stage ${currentStage(m)})`);
          return;
        }
        if (d.step === 'dye') {
          const make = worker.enqueue('make_dye', { item: d.item, count: d.amount, chore: true });
          const deposit = worker.enqueue('deposit', { item: 'all', chore: true });
          worker.memory.monumentGather = d.item;
          const failed = (why: string) => {
            if (why !== 'cancelled' && !make.code) this.monumentBack.set(`${v.name}:dye:${d.item}`, Date.now() + 3 * 60000);
          };
          this.setChore(v, worker, opt.key, [make, deposit], `make ${d.amount} ${d.item} for the ${N}`, failed, meta, opt.holds, opt);
          const c = this.chores.get(worker.name.toLowerCase());
          if (c) c.choice.monument = { item: d.item, material: 'flowers', n: d.amount, dye: true };
          console.log(`[monument] ${v.name}: ${worker.name} makes ${d.amount} ${d.item} for stage ${currentStage(m)}`);
          return;
        }
        if (d.step === 'furnish') {
          const make = worker.enqueue('make_furnishing', { item: d.item, count: d.amount, chore: true });
          const deposit = worker.enqueue('deposit', { item: 'all', chore: true });
          worker.memory.monumentGather = d.item;
          const failed = (why: string) => {
            if (why === 'cancelled' || make.code) return;
            this.monumentBack.set(`${v.name}:furnish:${d.item}`, Date.now() + 4 * 60000);
            // (a coloured banner not made stands in as white: the furnishing is never held by a colour)
            const sb = bannerStandIn(d.item);
            if (sb && make.state === 'failed' && !(m3(m).standIns ?? {})[sb.block]) {
              (m3(m).standIns ??= {})[sb.block] = sb.as;
              this.villages.save();
              console.log(`[monument] ${v.name}: the ${N}'s ${sb.block} stands in as ${sb.as} (${(make.message ?? why).slice(0, 120)})`);
            }
          };
          this.setChore(v, worker, opt.key, [make, deposit], `make ${d.amount} ${d.item} for the ${N}'s furnishing`, failed, meta, opt.holds, opt);
          const c = this.chores.get(worker.name.toLowerCase());
          if (c) c.choice.monument = { item: d.item, material: 'flowers', n: d.amount, furnish: true };
          console.log(`[monument] ${v.name}: ${worker.name} makes ${d.amount} ${d.item} for the furnishing`);
          return;
        }
        if (d.step === 'cut') {
          const st = worker.enqueue('cut_stone', { chore: true });
          const failed = (why: string) => {
            if (why !== 'cancelled' && !st.code) this.monumentBack.set(`${v.name}:cut`, Date.now() + 2 * 60000);
          };
          this.setChore(v, worker, opt.key, [st], `cut stone at the ${N}'s stonecutter`, failed, meta, opt.holds, opt);
          const c = this.chores.get(worker.name.toLowerCase());
          if (c) c.choice.monument = { cut: true };
          console.log(`[monument] ${v.name}: ${worker.name} cuts stone at the stonecutter`);
          return;
        }
        if (d.step === 'kiln') {
          const lane = d.lane;
          const st = worker.enqueue(lane ? 'tend_kiln' : 'build_kiln', { ...(lane ? { lane } : {}), chore: true });
          const failed = (why: string) => {
            if (why === 'cancelled' || st.code) return;
            if (lane) this.monumentBack.set(`${v.name}:kiln:${lane}`, Date.now() + 2 * 60000);
            else {
              m.kilnBackoff = Date.now() + 5 * 60000;
              this.villages.save();
            }
          };
          this.setChore(v, worker, opt.key, [st], lane ? `tend the ${N}'s kiln (lane ${lane})` : `build the ${N}'s kiln`, failed, meta, opt.holds, opt);
          const c = this.chores.get(worker.name.toLowerCase());
          if (c) c.choice.monument = { kiln: lane };
          console.log(`[monument] ${v.name}: ${worker.name} ${lane ? `tends the kiln's lane ${lane}` : 'builds the kiln'}`);
          return;
        }
        // (#162: the detail palette's quarried stones only from the open, `surface`)
        // (#163: a bulk trip ends at its time with what it has, collect's `trip`)
        const collect = worker.enqueue('collect', { block: d.block, count: d.amount, chore: true, ...(/^(andesite|diorite|granite)$/.test(d.block) ? { surface: true } : {}), ...(d.bulk ? { trip: TRIP_MIN } : {}) });
        // (M2: a quarry trip's other stone goes in too: the bulk cap puts what is over it on the spoil heap)
        const deposit = worker.enqueue('deposit', { item: d.deposit, also: d.material === 'cobblestone' && quarryFeeds(v, 'cobblestone') ? `${GATHER_ALSO},andesite,diorite,granite,tuff` : GATHER_ALSO, chore: true });
        // (its load is the cathedral's: the bulk cap leaves it, mcStorage.ts spoilSurplus)
        worker.memory.monumentGather = d.item;
        this.setChore(v, worker, opt.key, [collect, deposit], `gather ${d.amount} ${d.material} for the ${N}`, undefined, meta, opt.holds, opt);
        const c = this.chores.get(worker.name.toLowerCase());
        if (c) c.choice.monument = { item: d.item, material: d.material, n: d.amount };
        console.log(`[monument] ${v.name}: ${worker.name} gathers ${d.amount} ${d.material} for stage ${currentStage(m)}`);
        return;
      }
      case 'help': {
        const it = (v.initiatives ?? []).find((i) => i.id === d.id && i.state === 'open');
        if (!it) return;
        if (!it.crew.includes(worker.name)) {
          it.crew.push(worker.name);
          console.log(`[initiative] ${v.name}: ${worker.name} joins ${it.id} (${it.by}'s ${it.kind}; crew ${it.crew.length})`);
        }
        this.runInitiativeStep(v, worker, it, d.step, opt, meta);
        return;
      }
      case 'furnish': {
        const status = worker.enqueue('furnish', { part: d.part, count: d.n, chore: true });
        // (a failure backs the building off 10 minutes; not a stop, nor another agent's work in the way)
        const failed = (why: string) => {
          if (why !== 'cancelled' && !status.code) this.decorBack.set(`${v.name}:${d.part}`, Date.now() + 10 * 60000);
        };
        this.setChore(v, worker, opt.key, [status], `furnish ${d.label}`, failed, meta, opt.holds, opt);
        const c = this.chores.get(worker.name.toLowerCase());
        if (c) c.choice.furnish = { part: d.part, n: d.n };
        // Its furniture earmarked until it withdraws it (D6), set after the chore as a make's inputs
        holdsSet(holdKey(v.name, worker.name), d.items);
        console.log(`[furnish] ${v.name}: ${worker.name} furnishes ${d.part} (${d.label}): ${d.n} of ${d.open} open spots, takes ${countsList(d.items)}`);
        return;
      }
      case 'decor': {
        // (#141: a house decoration made into storage; a failure backs the item off 5 minutes)
        const make = worker.enqueue('make_furnishing', { item: d.item, count: d.amount, decor: true, chore: true });
        const deposit = worker.enqueue('deposit', { item: 'all', chore: true });
        const failed = (why: string) => {
          if (why !== 'cancelled' && !make.code) this.decorBack.set(`${v.name}:decor:${d.item}`, Date.now() + 5 * 60000);
        };
        this.setChore(v, worker, opt.key, [make, deposit], `make ${d.amount} ${d.item} for the village's houses`, failed, meta, opt.holds, opt);
        console.log(`[decor] ${v.name}: ${worker.name} makes ${d.amount} ${d.item} for the village's houses`);
        return;
      }
      case 'shelve': {
        // (#21: the shelving withdraws its own pieces at the hut and puts back what it did not set)
        const status = worker.enqueue('shelve_library', { chore: true });
        this.setChore(v, worker, opt.key, [status], 'shelve the library', undefined, meta, opt.holds, opt);
        console.log(`[shelve] ${v.name}: ${worker.name} shelves the library (${d.n} pieces)`);
        return;
      }
      case 'activity': {
        // (s41: the needs withdrawn, the skill, its gives deposited by name, then the tools put back by name: "all" keeps
        // tools, the check's F7; a failed skill still runs the deposits, as gathering's collect then deposit)
        const sp = d.spec;
        const st: ActionStatus[] = [];
        const needs = Object.entries(d.needs);
        for (const [n, q] of needs) st.push(worker.enqueue('withdraw', { item: n, count: q, chore: true }));
        st.push(worker.enqueue(sp.skill, { ...d.args, chore: true }));
        const items = d.gives;
        const also = [...items.slice(1), ...(sp.also ?? [])];
        const depAt = st.length;
        st.push(worker.enqueue('deposit', { item: items[0], ...(also.length ? { also: also.join(',') } : {}), chore: true }));
        for (const [n] of needs) if (TOOL.has(n)) st.push(worker.enqueue('deposit', { item: n, chore: true }));
        // (and what the skill did not use of the other needs: a trade cut short leaves goods in hand, the shop check's F2)
        const back = needs.map(([n]) => n).filter((n) => !TOOL.has(n) && !items.includes(n));
        if (back.length) st.push(worker.enqueue('deposit', { item: back[0], ...(back.length > 1 ? { also: back.slice(1).join(',') } : {}), ifAny: true, chore: true }));
        this.setChore(v, worker, opt.key, st, sp.name.toLowerCase(), undefined, meta, opt.holds, opt);
        const c = this.chores.get(worker.name.toLowerCase());
        if (c) c.choice.activity = { id: sp.id, items, depAt };
        console.log(`[activity] ${v.name}: ${worker.name} starts ${sp.id} (${sp.skill} ${JSON.stringify(d.args)}; ${d.stock} of ${d.keep} kept)`);
        return;
      }
    }
  }

  /**
   * An idle member of a village (F193's helper, kept for the chores before completion): a worker, else (once the village
   * is complete, the user's choice for F193) the mayor, whose brain makes no model calls by then.
   */
  private idleWorker(v: Village): BotAgent | undefined {
    const free = [...this.agents.values()].filter((a) => a.village()?.name === v.name && !!a.bot.entity && a.idle() && !this.chores.has(a.name.toLowerCase())
      && (this.cooling.get(`agent|${a.name.toLowerCase()}`) ?? 0) < Date.now()
      && !v.tasks.some((t) => t.status === 'claimed' && t.claimedBy === a.name));
    return free.find((a) => a.memory.villageRole !== 'mayor') ?? (v.complete ? free.find((a) => a.memory.villageRole === 'mayor') : undefined);
  }

  /**
   * Opportunistic farming and exploring (10-08; chores beside the board, lesson 93): a planted slot that is ripe is
   * harvested (as the wheat: before completion only when nothing is claimable); once the village is complete, every idle
   * member chooses its chore from a menu (A.2: the sweep).
   */
  private slotChores(v: Village) {
    const busy = this.choreKeys(v);
    const now = Date.now();
    const layouts = v.layouts ?? [];
    // A start cut off by a restart (its finally never ran): the slot free again, or its planting kept (the diff review's
    // M1); failed starts forgiven after an hour
    for (const [i, lay] of layouts.entries())
      for (const [jj, slot] of (lay.slots ?? []).entries()) {
        if (slot.laying && !slotBusy.has(`${v.name}:${i + 1}:${jj + 1}`)) {
          // (a pen whose ring stands keeps it; its gate is shut, the count waits for the next try: the pen design's H2)
          if (slot.kind && PEN_KINDS[slot.kind] && slot.pen?.built) {
            const plot = v.plots.find((p) => p.annex && p.x1 <= slot.x1 && p.x2 >= slot.x2 && p.z1 <= slot.z1 && p.z2 >= slot.z2);
            if (plot) {
              // (a village agent inside is put out first, the review's M2; then the gate shut in the pen's own wood)
              const out = penPlan(slot, slot.face ?? 'n').approach;
              const inside = [...this.agents.values()].filter((b) => b.village()?.name === v.name && b.bot.entity
                && b.bot.entity.position.x >= slot.x1 && b.bot.entity.position.x < slot.x2 + 1 && b.bot.entity.position.z >= slot.z1 && b.bot.entity.position.z < slot.z2 + 1
                // (at the pen's level: a miner in a tunnel under the annex is not in the pen, lesson 102)
                && Math.abs(b.bot.entity.position.y - (plot.y + 1)) <= 3);
              const cmds = [...inside.map((b) => `tp ${b.name} ${out[0] + 0.5} ${plot.y + 1} ${out[1] + 0.5}`),
                `setblock ${slot.pen.gate[0]} ${plot.y + 1} ${slot.pen.gate[1]} minecraft:${slot.pen.wood ?? v.wood ?? 'oak'}_fence_gate[facing=${slot.pen.facing},open=false]`];
              void (async () => {
                for (const c of cmds) await this.rcon.command(c).catch(() => '');
              })();
            }
          } else if (!slot.planted) {
            delete slot.kind;
            delete slot.pen;
          }
          delete slot.laying;
          this.villages.save();
        }
        if (slot.tries && slot.lastTry && now - slot.lastTry.at > 60 * 60000) slot.tries = 0;
      }
    if (v.complete) {
      this.sweep(v, busy);
      return;
    }
    const read = (x: number, y: number, z: number) => {
      for (const a of this.agents.values()) {
        const st = a.bot.entity ? stateAt(a, x, y, z) : -1;
        if (st >= 0) return st;
      }
      return -1;
    };
    const is = (st: number, name: string) => {
      const b = this.registry.blocksByName[name];
      return !!b && st >= b.minStateId && st <= b.maxStateId;
    };
    // Ripe slots
    for (const [i, lay] of layouts.entries())
      for (const [jj, slot] of (lay.slots ?? []).entries()) {
        const spec = slot.kind ? SLOT_KINDS[slot.kind] : undefined;
        const k = i + 1, j = jj + 1;
        // (not while a pen's lure runs: pumpkin and melon seeds tempt chickens too, the pen review's L3)
        if (!spec || slot.laying || !slot.planted || slotBusy.has(`${v.name}:${k}:${j}`) || busy.has(`slot:${k}:${j}`) || busy.has('pen')) continue;
        if (slot.lastHarvest && !slot.lastHarvest.ok && now - slot.lastHarvest.at < (slot.lastHarvest.why === 'nothing ripe' ? 2 : 10) * 60000) continue;
        const plot = preparedAt(v, slot);
        if (!plot) continue;
        const y = plot.y + 1;
        let ripe = 0, of = 0, unloaded = false;
        if (spec.ripe !== undefined) {
          const b = this.registry.blocksByName[spec.block];
          for (const [x, z] of slot.cells ?? []) {
            const st = read(x, y, z);
            if (st < 0) unloaded = true;
            else if (b && is(st, spec.block)) {
              of++;
              if (st - b.minStateId >= spec.ripe) ripe++;
            }
          }
        } else
          for (const [x, z] of (spec.fruit ? slot.fruit : slot.cells) ?? []) {
            const st = read(x, spec.fruit ? y : y + 1, z);
            if (st < 0) unloaded = true;
            else if (is(st, spec.fruit ?? 'sugar_cane')) ripe++;
          }
        if (unloaded || ripe < 2 || (spec.ripe !== undefined && ripe < 0.75 * of)) continue;
        if (!v.complete && this.villages.claimable(v).length) continue;
        const worker = this.idleWorker(v);
        if (!worker) return;
        this.setChore(v, worker, `slot:${k}:${j}`, [worker.enqueue('harvest_slot', { layout: k, slot: j, chore: true })], `harvest ${slot.kind}`);
        busy.add(`slot:${k}:${j}`);
        console.log(`[farm] ${v.name} slot ${k}.${j}: ${ripe} ${slot.kind} ripe, ${worker.name} harvests`);
      }
  }

  /**
   * The after-completion sweep (A.2, spec 4.1): every idle member, in idleWorker's order, gets a menu of the feasible
   * chores; in fixed mode it runs the menu's lowest rank (today's fixed order: the first member with nothing ends the
   * sweep, as nextChore's loop did), in model mode it decides (decide). `q` is this sweep's choreKeys: the busy keys come
   * out exactly as the old picker's several choreKeys calls gave them (the wheat loop's first call read the cooling
   * entries before its drops, every later call after them).
   */
  private sweep(v: Village, q: Set<string>) {
    const now = Date.now();
    // (G1: the village clock's sweep, with the members present)
    if (MEMORY.clock) {
      const members = [...this.agents.values()].filter((b) => b.village()?.name === v.name).map((b) => ({
        name: b.name, persona: withInfluence(b.name, (typeof b.memory.persona === 'string' && b.memory.persona) || this.characterLines(v, b, now).persona || personaOf(b.name)),
        model: typeof b.memory.chooseModel === 'string' ? b.memory.chooseModel : typeof b.memory.execModel === 'string' ? b.memory.execModel : undefined,
      }));
      clockTick(now, [{ name: v.name, members }]);
    }
    // (G2: who sees whom doing what, before anything below may end the sweep early: the spec check's M8)
    if (observing()) observe(v.name, this.presences(v), now);
    if (ACTS.on) actsSweep(v.name, this.actsWorld(v, now), now);
    if (PROPOSALS_ON) this.proposalSweep(v, now);
    // (character v2: a point per member once a village minute, the matrix every 10)
    if (characterAny()) characterSample(v.name, [...this.agents.values()].filter((b) => b.village()?.name === v.name).map((b) => ({ name: b.name })), now);
    // (G8: the ladder started, and after a rung the start-of-day ballot on the next)
    if (LADDER && v.complete) this.rungTick(v, now);
    // (#108: contracts orphaned by a restart refunded, once a village after the load)
    if (PAY.on && !this.payReconciled.has(v.name)) {
      this.payReconciled.add(v.name);
      reconcilePay(v, new Set(Object.keys(v.homes ?? {})), now);
    }
    // (#111: the levy owed the commons, payments' and merchant_own's, written into storage by command and counted)
    if (levyOwed(v) > 0) levySweep(this.payWorld, v);
    // (G3: a pending share unanswered for a village day is kept whole, outside the levy's measure)
    if (RULES.on && OWN.on && v.homes) for (const [agent, own] of Object.entries(v.homes)) {
      const kept = lapsePending(own, now, MEMORY.dayMs);
      if (kept) noteCompliance(v.name, agent, { op: 'levy', split: 'lapsed', total: Object.values(kept).reduce((t, q) => t + q, 0) });
    }
    const all = this.heldKeys(v, now, 'sweep');
    // Forgiven after an hour (the readers read the effective value; the old picker wrote these as it looked)
    const ax = v.layouts?.[0]?.annex;
    if (ax?.tries && ax.lastTry && now - ax.lastTry.at > 60 * 60000) ax.tries = 0;
    if (ax?.penBy) for (const [k, by] of Object.entries(ax.penBy)) if (now - by.at > 60 * 60000) delete ax.penBy[k];
    const m = v.mine;
    if (m?.ironTries && m.ironLastTry && now - m.ironLastTry.at > 60 * 60000) m.ironTries = {};
    // (and the works plot's, S.9)
    const wk = v.layouts?.[0]?.works;
    if (wk?.tries && wk.lastTry && now - wk.lastTry.at > 60 * 60000) wk.tries = 0;
    // Expired guards' bookkeeping
    for (const [k, until] of this.bansLogged) if (until < now) this.bansLogged.delete(k);
    for (const [k, until] of this.gatherBack) if (until <= now) this.gatherBack.delete(k);
    for (const [k, until] of this.lightBack) if (until <= now) this.lightBack.delete(k);
    for (const [k, until] of this.decorBack) if (until <= now) this.decorBack.delete(k);
    // X.1: the catalogue's and the furniture's wood kind, pinned once the village is complete (here, not in the pure menu;
    // furniture in a kind that followed the most stocked logs reopened its own chairs as another kind's, the review's L3)
    if ((CHOOSE.families.has('catalog') || CHOOSE.families.has('furnish')) && v.complete && !v.catalogWood) {
      v.catalogWood = this.catalogWoodOf(v);
      this.villages.save();
      console.log(`[catalog] ${v.name}: wood goods in ${v.catalogWood}`);
    }
    for (const [k, at] of this.declined) if (now - at > 10 * DECLINE_MS) this.declined.delete(k);
    // The torch demand, when it changed, at most once a minute (B.4)
    if (CHOOSE.families.has('light') && v.complete) {
      const parts = this.lightParts(v);
      const b = parts.filter((p) => p.kind === 'building').reduce((n, p) => n + p.unlit, 0), mn = parts.filter((p) => p.kind === 'mine').reduce((n, p) => n + p.unlit, 0);
      const dm = this.torchDemand(v), torch = MAKE_GOODS.find((g) => g.item === 'torch');
      const sig = `${dm}|${b}|${mn}`, last = this.lightLogged.get(v.name);
      if (torch && last?.sig !== sig && (!last || now - last.at >= 60000)) {
        this.lightLogged.set(v.name, { sig, at: now });
        console.log(`[light] ${v.name}: torch demand ${dm} (buildings ${b}, mine ${mn}), make target ${this.makeTarget(v, torch)}`);
      }
    }
    // What a stopped make left in an idle member's hands goes back into storage by name (S.9's 4.10, the check's L8): it is
    // busy with that and skips this sweep's menu
    for (const a of this.agents.values()) {
      const hk = holdKey(v.name, a.name), left = makeLeft.get(hk);
      if (!left || !this.isIdleMember(v, a, now)) continue;
      makeLeft.delete(hk);
      const items = Object.entries(left).filter(([, q]) => q > 0);
      for (const [n, q] of items) a.enqueue('deposit', { item: n, count: q, keep_wood: true, chore: true });
      if (items.length) console.log(`[make] ${v.name}: ${a.name} puts back what a stopped make left (${countsList(left)})`);
    }
    // (a public work's tasks are held for as a neighbourhood's, X.2)
    let members = GROW.on || PROJECTS_ON ? this.growHold(v, this.idleMembers(v, now), now) : this.idleMembers(v, now);
    if (!members.length) return;
    // (MC_QUICK_NEXT: the longest idle first, the Mayor still last: with a sweep at each chore's end, the first members in
    // the list took every freed option again and again and the last ones never chose, staged L1's Rosa to Xavier)
    if (QUICK_NEXT) {
      const since = (b: BotAgent) => this.idleSince.get(b.name.toLowerCase()) ?? 0;
      members = [...members.filter((b) => b.memory.villageRole !== 'mayor').sort((x, y) => since(x) - since(y)), ...members.filter((b) => b.memory.villageRole === 'mayor')];
    }
    const facts = this.sweepFacts(v, now, members[0]);
    // The fields the old wheat loop got as far as reading the busy keys for
    const ready = (v.layouts ?? []).map((l, i) => (l.farm && facts.field(String(i + 1)) ? i + 1 : 0)).filter(Boolean);
    const busy = new Set(ready.length ? all : q);
    const ctx: SweepCtx = { village: v.name, t: now, busy, first: ready.length ? { k: ready[0], busy: new Set(q) } : undefined };
    const take = (key: string) => {
      ctx.busy.add(key);
      ctx.first?.busy.add(key);
    };
    const none: Array<{ agent: string; reasons: Partial<Record<ChoiceKind, string>> }> = [];
    let capped = 0;
    this.sweepCtx = ctx;
    try {
      // (model mode's cap: decisions that call the model only while the members still to decide have keys left over
      // the decisions in flight, C15)
      const modelVillage = members.some((a) => this.chooseMode(a) === 'model');
      const keysLeft = modelVillage ? new Map(members.map((a) => [a.name, new Set(this.menu(v, a, busy, true, facts, ctx.first).menu.options.map((o) => o.key))])) : null;
      // (A.3p, the response threshold: in a fixed sweep with temperaments on, the members who like their best option most
      // choose first, so a chore goes to one who likes it rather than to Worker1 because it is first)
      if (TEMPERAMENT_MODE === 'on' && !modelVillage && members.length > 1) {
        const best = new Map(members.map((a) => [a.name, fixedPick(this.menu(v, a, busy, false, facts, ctx.first).menu)?.tw ?? 0]));
        members = [...members].sort((x, y) => (best.get(y.name) ?? 0) - (best.get(x.name) ?? 0));
      }
      for (const [n, a] of members.entries()) {
        if (!this.isIdleMember(v, a, now)) continue;
        const model = this.chooseMode(a) === 'model';
        const { menu, skips } = this.menu(v, a, ctx.busy, model, facts, ctx.first);
        // (A.3p: with temperament weights on the options, the fixed pick weighs them; without, the first in rank order as
        // before)
        const pick = !model && menu.options.some(weighted) ? fixedPick(menu) : menu.options[0];
        this.needNote(v, menu);
        // (the old picker wrote these only when it walked the farm starts: a member whose pick is a field or a ripe slot
        // never got there)
        // (A.3p: judged on the first in rank order, as before temperaments, so they never change when skips are written)
        const first = menu.options[0];
        if (model || !first || first.rank >= 200) for (const s of skips) this.slotSkip.set(s, now + 10 * 60000);
        // (every ring point visited: the ring is done once a member finds none left, as the old picker wrote it when it got
        // that far; the village's log keeps 40 notes, so the note's timing shows in it)
        if ((model || !pick) && menu.reasons.explore === 'all visited' && v.explore && !v.explore.done) {
          v.explore.done = true;
          this.villages.note(v, 'explored all round the village');
          this.villages.save();
        }
        if (!pick) {
          none.push({ agent: a.name, reasons: menu.reasons });
          // (today's loop stopped at the first member with nothing: the rest have nothing either; not with an appetite, where
          // menus differ by member: a hungry member's empty menu must not cost a fed one its chore, the food check's H2)
          if (!model && !appetiteOn(v)) {
            for (const b of members.slice(n + 1)) if (this.isIdleMember(v, b, now)) none.push({ agent: b.name, reasons: menu.reasons });
            break;
          }
          continue;
        }
        // MC_WORK_BLOCKS: a member in a block runs its option again, no decision, while it is on the menu and it is not
        // hungry (a meal on the menu of a hungry member ends the block)
        const blk = WORK_BLOCKS ? this.blocks.get(a.name.toLowerCase()) : undefined;
        if (blk) {
          const again = menu.options.find((o) => o.id === blk.option);
          const hungry = blk.option.split(':')[0] !== 'eat' && menu.options.some((o) => o.kind === 'eat') && this.hungerOf(v, a) === 'hungry';
          if (blk.until <= now || !again || hungry || !!basicOf(menu)) this.blocks.delete(a.name.toLowerCase());
          else {
            const r = this.runChoice(a, again.id, { source: 'repeat', reason: 'work block', menu });
            if (r.ok) {
              take(r.key);
              for (const h of this.chores.get(a.name.toLowerCase())?.choice.holds ?? []) take(h);
              continue;
            }
            this.blocks.delete(a.name.toLowerCase());
          }
        }
        // A meal is code's to run, never a model call (the food check's M2: 72-86 meals a wall-hour at 25 members)
        if (pick.kind === 'eat') {
          const r = this.runChoice(a, pick.id, { source: 'fixed', reason: 'appetite', menu });
          if (r.ok) {
            take(r.key);
            for (const h of this.chores.get(a.name.toLowerCase())?.choice.holds ?? []) take(h);
          }
          continue;
        }
        if (!model) {
          // (A.3p: a disliked pick is left for a member who likes it, until it has waited DECLINE_MS; then anyone takes it)
          // (#79: a goal's weight lifts a disliked kind out of the decline)
          if (pick.tw !== undefined && pick.tw * (pick.gw ?? 1) < DISLIKED) {
            const dk = `${v.name}|${pick.id}`;
            const since = this.declined.get(dk);
            if (since === undefined) {
              this.declined.set(dk, now);
              console.log(`[temper] ${v.name}: ${a.name} leaves ${pick.id} (weight ${pick.tw}) for one who likes it, at most ${Math.round(DECLINE_MS / 1000)} s`);
            }
            if (since === undefined || now - since < DECLINE_MS) continue;
          }
          const r = this.runChoice(a, pick.id, { source: 'fixed', reason: 'fixed order', menu });
          if (r.ok) this.declined.delete(`${v.name}|${pick.id}`);
          if (r.ok) {
            take(r.key);
            for (const h of this.chores.get(a.name.toLowerCase())?.choice.holds ?? []) take(h);
          }
          continue;
        }
        const d = this.decideAt(v, a, menu);
        if ('ran' in d) {
          if (d.ran.ok && d.ran.key) {
            take(d.ran.key);
            for (const h of this.chores.get(a.name.toLowerCase())?.choice.holds ?? []) take(h);
          }
          continue;
        }
        // A model call: only while keys are left for it
        const left = new Set<string>();
        for (const b of members.slice(n)) for (const k of keysLeft?.get(b.name) ?? []) if (!ctx.busy.has(k)) left.add(k);
        const inFlight = [...this.pending.values()].filter((p) => p.village === v.name).length;
        if (left.size - inFlight <= 0) {
          capped++;
          continue;
        }
        this.submitDecision(v, a, menu, d.call);
      }
    } finally {
      this.sweepCtx = undefined;
    }
    if (none.length || capped) this.noteNone(v, none, capped, now);
  }

  /**
   * The members a growing village's sweep leaves alone (s30, D10): the first k idle workers, k the neighbourhood's tasks
   * that can be claimed now (brains run before the sweep, so they claim on their next tick; board work first, as the
   * wheat's rule before completion), never the mayor; and the mayor while growth waits only for a free member (the check's
   * M1: the first sweep would send it on a 20-minute iron trip just before growTick wants it), from completion when this
   * server saw it happen, else once the first wait has passed.
   */
  private growHold(v: Village, members: BotAgent[], now: number): BotAgent[] {
    let out = members;
    if (growing(v)) {
      const tasks = this.villages.claimable(v).filter((t) => isGrowTask(v, t));
      let k = tasks.length;
      // (only workers whose brains take board tasks: one that never claims would be held for nothing, s30's review; and only
      // those the appetite lets claim one of them: a peckish member held here never got its meal, the food check's H1)
      if (!HOUSING) out = out.filter((a) => a.memory.villageRole === 'mayor' || !a.brain?.claimsTasks?.(a) || !tasks.some((t) => this.mayClaim(a, t)) || k-- <= 0);
      else {
        // (N.2: the owners of houses that can be claimed now are held first, H7)
        const owners = new Set(tasks.filter((t) => t.owner && /^Build /.test(t.title)).map((t) => t.owner!));
        const held = new Set<BotAgent>();
        for (const a of [...out.filter((x) => owners.has(x.name)), ...out.filter((x) => !owners.has(x.name))])
          if (a.memory.villageRole !== 'mayor' && a.brain?.claimsTasks?.(a) && tasks.some((t) => this.mayClaim(a, t)) && k-- > 0) held.add(a);
        out = out.filter((a) => !held.has(a));
      }
    }
    // (not a hungry mayor: growTick gives the chore to a fed member then, and a mayor held here would never eat)
    if (this.growDue(v, now, !this.growWatched.has(v.name))) out = out.filter((a) => a.memory.villageRole !== 'mayor' || this.hungerOf(v, a) === 'hungry');
    return out;
  }

  /** `[choice-none]`: idle members with nothing feasible, by reason; when the reasons change, at most every 5 minutes. */
  private noteNone(v: Village, none: Array<{ agent: string; reasons: Partial<Record<ChoiceKind, string>> }>, capped: number, now: number) {
    const counts = new Map<string, number>();
    for (const n of none) for (const [k, why] of Object.entries(n.reasons)) counts.set(`${k}: ${why}`, (counts.get(`${k}: ${why}`) ?? 0) + 1);
    if (capped) counts.set('capped', capped);
    const sig = [...counts.keys()].sort().join('|');
    const last = this.noneAt.get(v.name);
    if (last && last.sig === sig && now - last.at < 5 * 60000) return;
    this.noneAt.set(v.name, { sig, at: now });
    console.log(`[choice-none] ${v.name}: ${none.length} idle, nothing feasible (${[...counts.entries()].map(([k, n]) => `${k} ${n}`).join(', ')})`);
  }

  /**
   * A model-mode decision's start (spec 5.1 steps 0-4; E.4 swaps this one place for reservation and a re-ask, D6): a menu of
   * one runs at once ('only'); within minGapMs of the agent's last model decision an option of the same kind runs
   * ('repeat', else the fixed pick as 'rate'); over the hourly cap or the budget the fixed pick runs at once. Otherwise
   * the call is to be made (`call`: the decision id and the model).
   */
  private decideAt(v: Village, a: BotAgent, menu: ChoiceMenu): { ran: { ok: boolean; key?: string } } | { call: { decisionId: string; spec: ModelSpec } } {
    const decisionId = choiceId(v.name);
    const now = Date.now();
    const run = (id: string | null, meta: Omit<ChoiceMeta, 'decisionId' | 'menu'>) => {
      const r = id ? this.runChoice(a, id, { ...meta, decisionId, menu }) : this.runPick(a, null, { ...meta, decisionId, menu });
      return { ran: r.ok ? { ok: true, key: r.key } : { ok: false } };
    };
    if (menu.options.length === 1) return run(menu.options[0].id, { source: 'only', reason: 'fixed order' });
    const id = a.name.toLowerCase();
    // (MC_WORK_BLOCKS: a model decision buys a block of work, so the floor is 30 s, and a member inside it with nothing of the
    // same kind waits for its turn instead of taking the fixed pick: in IM1, with chores ending every 5-40 s, 421 rate
    // fallbacks against 168 model decisions)
    const gap = WORK_BLOCKS ? Math.min(CHOOSE.minGapMs, BLOCK_GAP_MS) : CHOOSE.minGapMs;
    if (now - this.choiceStats.lastModelAt(a.name) < gap) {
      const kind = this.lastModelKind.get(id);
      // (character v2's B1: a repeat honours the options' weights when a layer is on, else the lowest rank as before)
      const same = kind ? menu.options.filter((o) => o.kind === kind).sort((p, q) => (characterAny() ? weights(q) - weights(p) : 0) || p.rank - q.rank)[0] : undefined;
      // (MC_HOME_BASICS: a basic need of the member's own house before the repeat)
      const basic = basicOf(menu);
      if (basic) return run(basic.id, { source: 'repeat', reason: 'a basic need' });
      if (!same && WORK_BLOCKS) return { ran: { ok: false } };
      return same ? run(same.id, { source: 'repeat', reason: 'fixed order' }) : run(null, { source: 'fallback', why: 'rate', reason: 'fixed order' });
    }
    if (this.choiceStats.modelCallsLastHour(a.name, now) >= CHOOSE.perHour) return run(null, { source: 'fallback', why: 'rate', reason: 'fixed order' });
    const spec = parseSpec(typeof a.memory.chooseModel === 'string' ? a.memory.chooseModel : typeof a.memory.execModel === 'string' ? a.memory.execModel : CHOOSE.model);
    if (!spec) return run(null, { source: 'fallback', why: 'error', reason: 'fixed order' });
    if (this.scripted(a)) return this.scriptedDecision(v, a, menu, decisionId);
    if ((isCloudModel(spec.model) && !usage.allows('decisions')) || usage.blocked(spec.model, a.name)) return run(null, { source: 'fallback', why: 'budget', reason: 'fixed order', model: label(spec) });
    return { call: { decisionId, spec } };
  }

  /**
   * G2: E.4's scripted controller (E.8's null picker): the prompt built and logged as a model decision's would be, nothing
   * sent; a seeded draw by the options' weights; with probability MC_SCRIPTED_ACTS an act and a line the validator can
   * take (accept a request by its option, a request, an offer of the chosen option, a report of a closed promise).
   */
  private scriptedDecision(v: Village, a: BotAgent, menu: ChoiceMenu, decisionId: string): { ran: { ok: boolean; key?: string } } {
    const now = Date.now();
    const rnd = mulberry32(fnv1a(`${decisionId}|${a.name}`));
    const shown = shuffled(menu.options, `${decisionId}|${a.name}`);
    const p = buildPrompt(menu, shown, MEMORY.on ? { recall: recall(v.name, a.name, now, { lastShown: menu.ctx.outcomes?.length || 5 }), outcomes: lastLines(v.name, a.name, 5) } : undefined);
    // (#111: a priced request's tag, "[Ada pays 2 emeralds]", draws the scripted pick as an asking one does)
    const tagged = menu.options.filter((o) => o.social && /asked|pays \d/.test(o.social));
    const total = menu.options.reduce((t, o) => t + weights(o), 0);
    // (MC_HOME_BASICS: a basic need of the member's own house is taken, as the fixed pick takes it)
    let pick = basicOf(menu) ?? (tagged.length && rnd() < 0.5 ? tagged[Math.floor(rnd() * tagged.length)] : undefined);
    if (!pick) {
      let x = rnd() * total;
      for (const o of menu.options) if ((x -= weights(o)) <= 0 && !pick) pick = o;
      pick ??= menu.options[menu.options.length - 1];
    }
    const fields: ActFields = {};
    if (ACTS.on && mayAct(v.name, a.name) && rnd() < SCRIPTED_ACTS) {
      const w = this.actsWorld(v, now);
      const near = [...w.at.keys()].filter((n) => n !== a.name);
      const roll = rnd();
      const items = [...w.items.keys()];
      if (roll < 0.45 && items.length) Object.assign(fields, { act: 'request', act_to: rnd() < 0.5 || !near.length ? 'anyone' : near[Math.floor(rnd() * near.length)], act_item: items[Math.floor(rnd() * items.length)] });
      else if (roll < 0.8 && near.length && (w.items.has(pick.id) || w.projects.has(pick.id))) Object.assign(fields, { act: 'offer', act_to: near[Math.floor(rnd() * near.length)] });
      else {
        const known = (menu.ctx.inbox ?? []).map((l) => /^(\w+) (kept|broke) a promise to you: .*\((c\d+)\)/.exec(l)).find(Boolean);
        if (known) Object.assign(fields, { act: 'report', act_to: known[1], act_claim: known[2], act_ref: known[3] });
      }
      fields.say = `I am going to ${pick.name.toLowerCase().replace(/[:(].*$/, '').trim()}.`;
      // (#107: scripted news, half of it retelling news heard, and now and then a question to anyone: the paths a staged
      // run exercises; drawn only with the flags on, so the draws above stay as they were)
      if (TALK.news && rnd() < 0.5) {
        const heard = (menu.ctx.news ?? []).map((l) => /: "(.+)" \(/.exec(l)?.[1]).filter((x): x is string => !!x);
        const store = storageContents(v);
        const low = items.filter((o) => o.startsWith('make:') || o.startsWith('gather:')).map((o) => ({ o, n: store[o.split(':')[1]] ?? 0 })).sort((x, y) => x.n - y.n);
        if (heard.length && rnd() < 0.4) fields.news = heard[Math.floor(rnd() * heard.length)];
        else if (low.length) fields.news = `The storage is short of ${w.items.get(low[Math.floor(rnd() * Math.min(5, low.length))].o)} now.`;
      }
      if (TALK.questions && rnd() < 0.15) Object.assign(fields, { question: rnd() < 0.5 ? 'Where have you seen iron ore or sheep lately?' : 'What does the village need most right now?', question_to: 'anyone' });
    }
    logAct({ type: 'decision', village: v.name, agent: a.name, decisionId, scripted: true, system: p.system, prompt: p.user, choice: pick.id, ...fields });
    this.choiceStats.noteModel(a.name, now);
    this.lastModelKind.set(a.name.toLowerCase(), pick.kind);
    const r = this.runChoice(a, pick.id, { source: 'scripted', reason: 'scripted', decisionId, menu, shown: shown.map((o) => o.id) });
    if (r.ok && ACTS.on) this.afterActs(v, a, decisionId, fields, now);
    // (G3: the scripted controller answers a pending share by a seeded draw: keep 30%, the levy 50%, all 20%)
    if (menu.ctx.share && RULES.on && OWN.on) {
      const x = rnd();
      this.settleShare(v, a.name, x < 0.3 ? 'none' : x < 0.8 ? 'levy' : 'all', decisionId);
    }
    return { ran: r.ok ? { ok: true, key: r.key } : { ok: false } };
  }

  /** #108's test hook (POST /api/villages/:v/pay): an act for a member as if it came with a decision whose pick did not
   *  run (a request, a pay), offered whatever the cadence; what happened. */
  payTest(v: Village, agent: string, fields: ActFields): string[] {
    if (!PAY.on) return ['payments are off (MC_PAY)'];
    // (#111's staged checks: test:hold / test:release hold every delivery off the menus, test:empty takes an item out of
    // storage by command, test:state lists the contracts and the open projects; no member needed)
    if (fields.act?.startsWith('test:')) {
      const op = fields.act.slice(5);
      if (op === 'hold' || op === 'release') this.payTestHold = op === 'hold';
      if (op === 'empty' && fields.act_item) {
        const item = fields.act_item, n = storageContents(v)[item] ?? 0;
        void storeByCommand(this.payWorld.rcon, v, item, -n).then((got) => {
          console.log(`[pay] ${v.name}: test: ${-got} of ${n} ${item} taken out of storage`);
          this.villages.save();
        });
        return [`emptying ${n} ${item}`];
      }
      const now = Date.now();
      return [
        ...payOf(v).contracts.map((c) => JSON.stringify({ id: c.id, kind: c.kind, state: c.state, payer: c.payer, payee: c.payee, option: c.option, price: c.price, steps: c.steps, paidSteps: c.paidSteps, escrow: c.escrow, why: c.why, earmark: c.earmark, arrived: c.arrived })),
        ...[...this.actsWorld(v, now).projects.entries()].map(([o, p]) => JSON.stringify({ project: o, ...p })),
        JSON.stringify({ hold: this.payTestHold, levyOwed: levyOwed(v) }),
      ];
    }
    const a = this.agents.get(agent.toLowerCase());
    if (!a || a.village()?.name !== v.name) return [`${agent} is not a member of ${v.name} in the world`];
    const now = Date.now();
    actsState(v.name).since[a.name] = ACTS.every;
    const done = handleActs(v.name, a.name, fields, { option: '', kind: '', name: '', decisionId: `paytest-${now}` }, this.actsWorld(v, now), now, false);
    console.log(`[pay] ${v.name}: test act for ${a.name}: ${done.join('; ') || 'nothing'}`);
    this.villages.save();
    return done;
  }

  /** G2: a decision's acts after its pick ran (the chore it started), through acts.ts' validator. */
  private afterActs(v: Village, a: BotAgent, decisionId: string, fields: ActFields, now: number, ran = true) {
    const c = this.chores.get(a.name.toLowerCase());
    if (ran && (!c || c.choice.decisionId !== decisionId)) return;
    try {
      const chosen = ran && c ? { option: c.choice.option ?? c.key, kind: c.choice.kind ?? '', name: c.choice.name ?? c.what, decisionId, chore: c.choice.id } : { option: '', kind: '', name: '', decisionId };
      const done = handleActs(v.name, a.name, fields, chosen, this.actsWorld(v, now), now, ran);
      if (done.length) console.log(`[acts] ${v.name}: ${a.name}: ${done.join('; ')}`);
    } catch (e) {
      console.log(`[acts] ${v.name}: ${a.name}: ${String((e as Error)?.stack ?? e).slice(0, 300)}`);
    }
  }

  /** Steps 5-9: the decision queued, the call made, the reply run (or the fixed pick over a fresh menu). Every continuation is
   *  caught (D9): a throw logs `[choice-error]` and releases the agent. */
  private submitDecision(v: Village, a: BotAgent, menu: ChoiceMenu, call: { decisionId: string; spec: ModelSpec }, reaskOf?: string) {
    const id = a.name.toLowerCase();
    const p: PendingChoice = {
      id, agent: a, village: v.name, decisionId: call.decisionId, ac: new AbortController(), since: Date.now(), state: 'queued', menu, ...(reaskOf ? { reaskOf } : {}),
      ...(CHOICE_HOLDS ? { holds: [...new Set(menu.options.flatMap((o) => [o.key, ...o.holds]))], initiates: menu.options.some((o) => o.kind === 'initiate') } : {}),
    };
    this.pending.set(id, p);
    this.chooser.submit(a.name, async (queueWaitMs) => {
      try {
        if (this.pending.get(id) !== p) return;
        p.state = 'running';
        p.queueWaitMs = queueWaitMs;
        const r = await choose({ agent: a.name, spec: call.spec, level: REASONING.choose, menu, seed: call.decisionId, signal: p.ac.signal });
        // (dropped meanwhile: the drop rule wrote its record; nothing queued, no fallback, C16)
        if (p.ac.signal.aborted || this.pending.get(id) !== p) return;
        this.pending.delete(id);
        this.holdsReleased(p);
        const meta: ChoiceMeta = {
          source: r.id ? 'model' : 'fallback', ...(r.id ? {} : { why: r.why ?? 'error' }), reason: r.id ? r.reason || '(no reason)' : 'fixed order',
          decisionId: p.decisionId, shown: r.shown, model: label(call.spec), latencyMs: r.latencyMs, waitMs: r.waitMs, queueWaitMs,
          promptTokens: r.promptTokens, outputTokens: r.outputTokens, menu, prompt: r.prompt, ...(p.reaskOf ? { reaskOf: p.reaskOf } : {}),
        };
        if (this.agents.get(id) !== a) {
          this.logDrop(p.decisionId, a.name, v.name, this.agents.has(id) ? 'replaced' : 'gone', queueWaitMs, meta, r.id);
          return;
        }
        // (a call that reached the model counts toward the agent's rate, answered or not)
        const reached = !!r.id || r.why === 'invalid' || r.why === 'timeout' || r.why === 'error';
        if (reached) this.choiceStats.noteModel(a.name, Date.now());
        if (r.id) {
          const kind = menu.options.find((o) => o.id === r.id)?.kind;
          if (kind) this.lastModelKind.set(id, kind);
        } else if (reached) {
          // (the latest model decision chose nothing: no kind to repeat within the gap, the fixed pick goes as 'rate')
          this.lastModelKind.delete(id);
        }
        // (one re-ask, never a re-ask's re-ask, and only while the budget allows a call)
        const reask = p.reaskOf ? undefined : (fresh: ChoiceMenu) => {
          if ((isCloudModel(call.spec.model) && !usage.allows('decisions')) || usage.blocked(call.spec.model, a.name)) return false;
          this.submitDecision(v, a, fresh, { decisionId: choiceId(v.name), spec: call.spec }, p.decisionId);
          return true;
        };
        this.runPick(a, r.id, meta, reask, r.backup);
        // (G3: the share's answer settles the member's pending share, whatever the pick did)
        if (r.share && RULES.on && OWN.on) this.settleShare(v, a.name, r.share, p.decisionId);
        if (ACTS.on && r.id) {
          const d = this.decisions.get(id);
          if (d?.decisionId === p.decisionId && d.source === 'model') this.afterActs(v, a, p.decisionId, r.acts ?? {}, Date.now());
          // (the acts that do not depend on the pick still go through: acts.handle with ran false)
          else if (r.acts && Object.keys(r.acts).length) this.afterActs(v, a, p.decisionId, r.acts, Date.now(), false);
        }
      } catch (e) {
        this.choiceError(p, e);
      }
    }, () => {
      try {
        if (this.pending.get(id) !== p || p.ac.signal.aborted) return;
        this.pending.delete(id);
        this.holdsReleased(p);
        this.runPick(a, null, { source: 'fallback', why: 'queue', reason: 'fixed order', decisionId: p.decisionId, queueWaitMs: CHOOSE.queueMs, menu });
      } catch (e) {
        this.choiceError(p, e);
      }
    });
  }

  private choiceError(p: PendingChoice, e: unknown) {
    try {
      console.log(`[choice-error] ${p.agent.name}: ${String((e as Error)?.stack ?? e).slice(0, 300)}`);
      if (this.pending.get(p.id) === p) this.pending.delete(p.id);
      this.holdsReleased(p);
      this.chooser.cancel(p.agent.name);
    } catch {
      // (nothing may escape, D9)
    }
  }

  /** A pending decision dropped (spec 6): its call aborted or its queue entry cancelled, one record. */
  private dropDecision(p: PendingChoice, why: ChoiceDrop['why']) {
    if (this.pending.get(p.id) !== p) return;
    this.pending.delete(p.id);
    this.holdsReleased(p);
    p.ac.abort();
    this.chooser.cancel(p.agent.name);
    this.logDrop(p.decisionId, p.agent.name, p.village, why, p.queueWaitMs);
  }

  /** A dropped decision's record; one dropped after its call carries the call's numbers (`meta`) and the model's pick
   *  (`chose`), and its tokens count in the village's summary (no source counted: it ran nothing). */
  private logDrop(decisionId: string, agent: string, village: string, why: ChoiceDrop['why'], queueWaitMs?: number, meta?: ChoiceMeta, chose?: string | null) {
    const m = meta;
    logChoiceDrop({
      decisionId, agent, village, t: Date.now(), why, ...(queueWaitMs !== undefined ? { queueWaitMs } : {}),
      ...(m?.model ? { model: m.model } : {}), ...(m?.latencyMs !== undefined ? { latencyMs: m.latencyMs } : {}), ...(m?.waitMs !== undefined ? { waitMs: m.waitMs } : {}),
      ...(m?.promptTokens !== undefined ? { promptTokens: m.promptTokens } : {}), ...(m?.outputTokens !== undefined ? { outputTokens: m.outputTokens } : {}),
      ...(m?.source === 'model' && chose ? { modelChose: chose, modelReason: m.reason } : {}),
    });
    const acc = this.summaryOf(village);
    acc.s.drops++;
    if (m) {
      acc.s.promptTokens += m.promptTokens ?? 0;
      acc.s.outputTokens += m.outputTokens ?? 0;
      if (m.latencyMs && replied(m)) acc.ms = [...acc.ms, m.latencyMs].slice(-500);
    }
    const id = agent.toLowerCase();
    // (the model's reply and tokens kept for the panel when the decision reached it, the fix review)
    if (why === 'empty')
      this.decisions.set(id, {
        ...(m ?? {}), source: 'fallback', why: m?.why ?? 'taken', reason: 'fixed order', decisionId, chosen: null, at: Date.now(),
        ...(m?.source === 'model' && chose ? { modelChose: chose, modelReason: m.reason } : {}),
      });
  }

  private summaryOf(village: string) {
    let acc = this.summaries.get(village);
    if (!acc) this.summaries.set(village, (acc = { s: { model: 0, fixed: 0, only: 0, repeat: 0, rate: 0, fallback: {}, drops: 0, positions: [], expected: [], promptTokens: 0, outputTokens: 0, msP50: 0, queueWaitP90: 0 }, ms: [], queue: [] }));
    return acc;
  }

  /** A decision counted for the panel's chip. */
  private summarise(village: string, meta: ChoiceMeta, opt?: ChoiceOption) {
    const acc = this.summaryOf(village);
    const s = acc.s;
    if (meta.source === 'fallback') {
      if (meta.why === 'rate') s.rate++;
      else if (meta.why) s.fallback[meta.why] = (s.fallback[meta.why] ?? 0) + 1;
    } else if (meta.source === 'scripted') s.scripted = (s.scripted ?? 0) + 1;
    else s[meta.source]++;
    if (meta.source === 'model' && opt && meta.shown?.length) {
      const n = meta.shown.length, at = meta.shown.indexOf(opt.id);
      for (let p = 0; p < n; p++) {
        s.positions[p] ??= 0;
        s.expected[p] = Math.round(((s.expected[p] ?? 0) + 1 / n) * 1000) / 1000;
      }
      if (at >= 0) s.positions[at]++;
    }
    s.promptTokens += meta.promptTokens ?? 0;
    s.outputTokens += meta.outputTokens ?? 0;
    // (the model answer's time: only decisions whose reply came, not timeouts, errors or calls never sent)
    if (meta.latencyMs && replied(meta)) acc.ms = [...acc.ms, meta.latencyMs].slice(-500);
    if (meta.queueWaitMs !== undefined) acc.queue = [...acc.queue, meta.queueWaitMs + (meta.waitMs ?? 0)].slice(-500);
  }

  /** An end fed to the statistics; a ban that starts is logged once (spec 7.3). */
  private noteEnd(c: { agent: string; village: string; choice: ChoiceState }, ok: boolean, cut: boolean, contention: boolean, productive: boolean, message: string, known?: number) {
    const kind = c.choice.kind;
    if (!kind || !CHOICE_KINDS.includes(kind)) return;
    // (G8, MC_IRON_AGE: a miner turned back by another on the stairs or by a full level met contention, not a failure: staged
    // I3's turned-back trips banned the whole iron kind for an hour after its first two minutes)
    if (IRON_AGE && kind === 'iron' && IRON_WAIT.test(message)) contention = true;
    const now = Date.now();
    const id = c.choice.option ?? kind;
    const verb = ok ? (productive ? 'done' : 'done, nothing gained') : cut ? 'cut short' : `failed (${message.slice(0, 60)})`;
    // (G2, MC_CONTROLLER: a chore over in under 30 s with nothing gained counts as a failure toward the kind's cooldown, E.4)
    const quick = CONTROLLER.on && ok && !productive && !cut && kind !== 'eat' && now - c.choice.t < 30000;
    if (ACTS.on) actsEnd(c.village, c.agent, { option: id, chore: c.choice.id, started: c.choice.t, ok, productive, cut }, now);
    // (MC_WORK_BLOCKS: a failure or a chore that gained nothing ends the member's block)
    if (WORK_BLOCKS && (!ok || (!productive && !cut))) this.blocks.delete(c.agent.toLowerCase());
    // (character v2: a rest restores energy; other work spends it; a failure is a small bad feeling)
    if (characterAny() && !cut) {
      if (kind === 'rest') {
        if (ok) {
          noteRest(c.village, c.agent, now);
          think(c.village, c.agent, 'rested', 'you rested at home', now);
        }
      } else if (kind !== 'eat') {
        noteWork(c.village, c.agent, (now - c.choice.t) / 60000);
        if (!ok && !contention) think(c.village, c.agent, 'failed', `"${(c.choice.name ?? id).slice(0, 40)}" failed`, now);
      }
    }
    if (SKILL.on && !cut) noteSkill(c.village, c.agent, kind, TEMPERAMENT_MODE === 'on' ? kindWeights(vectorOf(c.agent))[kind] ?? 1 : 1);
    this.choiceStats.record({
      village: c.village, agent: c.agent, kind, id, ok: ok && !quick, cut, contention, productive, minutes: Math.round((now - c.choice.t) / 600) / 100, at: now,
      line: `${c.choice.name ?? id}: ${verb}, ${Math.round((now - c.choice.t) / 6000) / 10} min${known !== undefined ? `, ${known >= 0.1 ? 'new land' : 'little new land'}` : ''}`,
    });
    // (G2: a step on another member's project, done: help given and received)
    if (kind === 'help' && ok && !cut && observing()) {
      const it = (this.villages.get(c.village)?.initiatives ?? []).find((i) => `help:${i.id}` === id);
      if (it && it.by !== c.agent) noteHelp(c.village, c.agent, it.by, now, it.id);
    }
    // (every trip that was not cut, failed ones too: spec 7.5's "the last 2 trips found nothing new")
    if (kind === 'explore' && known !== undefined && !cut) this.exploreYields.set(c.village, [...(this.exploreYields.get(c.village) ?? []), known].slice(-10));
    // (MC_BAN_SCOPE=member: a dig that failed for want of a pickaxe shows its member the fix for 20 minutes)
    if (BAN_MEMBER && !ok && !cut && kind === 'iron' && /no (stone |iron )?pickaxe/i.test(message)) this.needTool.set(c.agent.toLowerCase(), { item: 'stone_pickaxe', until: now + 20 * 60000 });
    // Bans apply only in model mode (D5): a fixed run logs none
    const agent = this.agents.get(c.agent.toLowerCase());
    if (!ok && !cut && !contention && (agent ? this.chooseMode(agent) : CHOOSE.mode) === 'model') {
      const ban = this.choiceStats.banned(c.village, kind, id, now, c.agent);
      // (a ban of the whole kind is logged once, under the kind's name)
      const name = ban?.scope === 'kind' ? kind : id;
      const k = `${c.village}|${name}${BAN_MEMBER ? `|${c.agent}` : ''}`;
      if (ban && this.bansLogged.get(k) !== ban.until) {
        this.bansLogged.set(k, ban.until);
        logChoiceBan({ village: c.village, t: now, id: name, scope: ban.scope, until: ban.until, message });
      }
    }
  }

  /** A2: the panel's compact line (cached fields only, C10). */
  choiceStatus(agent: WorldAgent): ChoiceStatus | null {
    const id = agent.name.toLowerCase();
    const p = this.pending.get(id);
    if (p) return { state: p.state === 'running' ? 'choosing' : 'queued', since: p.since, menuSize: p.menu.options.length };
    const c = this.chores.get(id);
    const d = this.decisions.get(id);
    const last = d ? {
      ...(d.chosen ? { name: d.menu?.options.find((o) => o.id === d.chosen)?.name, kind: d.menu?.options.find((o) => o.id === d.chosen)?.kind } : {}),
      source: d.source, ...(d.why ? { why: d.why } : {}), reason: d.reason.slice(0, 160),
      ...(d.source === 'model' && d.chosen && d.shown?.includes(d.chosen) ? { position: d.shown.indexOf(d.chosen) + 1 } : {}), ...(d.source === 'model' && d.shown ? { shown: d.shown.length } : {}),
      at: d.at, ...(d.menu ? { menuSize: d.menu.options.length } : {}),
    } : {};
    if (c && !c.choice.ended) return { ...last, state: 'running', since: c.choice.t, ...(c.choice.name ? { name: c.choice.name } : {}), ...(c.choice.kind ? { kind: c.choice.kind } : {}) };
    return d ? { ...last, state: 'none' } : null;
  }

  choiceHistory(agent: WorldAgent) {
    const v = agent.village();
    return v ? this.choiceStats.agentHistory(v.name, agent.name) : [];
  }

  lastDecision(agent: WorldAgent): (ChoiceMeta & { chosen: string | null; at: number }) | null {
    return this.decisions.get(agent.name.toLowerCase()) ?? null;
  }

  choiceSummary(village: string): ChoiceSummary | null {
    const acc = this.summaries.get(village);
    if (!acc) return null;
    const q = (xs: number[], f: number) => {
      const s = [...xs].sort((a, b) => a - b);
      return s.length ? s[Math.min(s.length - 1, Math.ceil(f * s.length) - 1)] : 0;
    };
    return { ...acc.s, fallback: { ...acc.s.fallback }, positions: [...acc.s.positions], expected: [...acc.s.expected], msP50: q(acc.ms, 0.5), queueWaitP90: q(acc.queue, 0.9) };
  }
}

/** The wait between chores (the user's, 10-22): MC_QUICK_NEXT=on runs the village's check within a few seconds of a
 *  chore's end (at most every QUICK_GAP_MS) instead of at the 30 s cycle, and skips the 10 s member cooling for a chore
 *  whose actions all finished (the cooling is for a stopped or removed agent whose skill's finally still runs). */
const QUICK_NEXT = /^(on|1|true|yes)$/i.test(rawSetting('MC_QUICK_NEXT') ?? '');
/** #97 (MC_CHOICE_HOLDS=on, off): a pending decision holds the options it was shown (their keys and further keys) until its
 *  answer runs or it is dropped, so no other member's menu offers them meanwhile; one shown a project of its own counts
 *  as an open project against INITIATIVES_MAX. The counterfactual on All1 and train 1 (runs/2026-10-24/collisions-97):
 *  56-63% of the model's lost picks were taken in flight by another member, 13-18% lost to the projects' cap. */
// (on by default since 10-25, the user's after test train 3, F316; MC_CHOICE_HOLDS=off turns it off)
const CHOICE_HOLDS = !/^(off|0|false|no)$/i.test(rawSetting('MC_CHOICE_HOLDS') ?? 'on');
/** #122 (MC_POLICY_OPTIONS; on by default since 10-25, the user's after the confirm run, F322; =off turns it off): on a menu that is empty or holds only filler makes, code's policy gates become options
 *  with their facts: a material nothing wants gathered anyway (under GATHER_ANYWAY_MAX in storage), a project past the
 *  village's cap (under twice it); the filler makes leave such a menu (spec runs/2026-10-24/policy-122). */
const POLICY_OPTIONS = !/^(off|0|false|no)$/i.test(rawSetting('MC_POLICY_OPTIONS') ?? 'on');
const GATHER_ANYWAY_MAX = 192;
const PAST_TAG = '[past a village limit]';
/** A make of a good nothing uses now: its effect says it is for later, nothing places it, or it is the torch reserve (All1
 *  after minute 80: 104 of 148 makes). */
const FILLER_EFFECT = /\blater\b|nothing places it yet|the reserve kept beyond/;
const isFiller = (o: ChoiceOption) => o.kind === 'make' && FILLER_EFFECT.test(o.effect);
const QUICK_GAP_MS = 5000;
/** A choice commits a member to a block of work (the user's, 10-22): MC_WORK_BLOCKS=on: a model or fixed choice opens a
 *  block of MC_BLOCK_MIN minutes (6, divided by MC_TIME_SCALE) in which the same option runs again with no new decision
 *  while it is on the member's menu; a failure, a chore that gained nothing, or hunger ends it early. */
const WORK_BLOCKS = /^(on|1|true|yes)$/i.test(rawSetting('MC_WORK_BLOCKS') ?? '');
const BLOCK_MS = (Number(rawSetting('MC_BLOCK_MIN') ?? 6) * 60000) / Math.max(0.1, Number(rawSetting('MC_TIME_SCALE') ?? 1) || 1);
/** With work blocks, an agent's model decisions at least this far apart (CHOOSE.minGapMs' 90 s otherwise). */
const BLOCK_GAP_MS = 30000;

/** A2: what the sweep needs per village, once per sweep time (spec 2.3, C10). */
interface Facts {
  t: number;
  /** The member the village-level reads go through (collect's filter, village ground: the same for every member). */
  agent: BotAgent;
  store: Counts;
  ok: () => (p: { x: number; y: number; z: number }) => boolean;
  startHome: { x: number; z: number } | null;
  exploreHome: { x: number; z: number } | null;
  field: (k: string) => { ripe: number; grown: number; plot: { y: number } } | null;
  slot: (kj: string) => { ripe: number; of: number; topUp: number } | null;
  sightings: (kind: string) => Array<[number, number, number, number]>;
  animals: (kind: string) => Array<{ x: number; y: number; z: number }>;
  eggs: (j: string) => boolean;
  known: (xz: string) => number;
  /** S.9: every good's makePlan, by item; gathering's demand; the spare storage (makeSpare), all for no one agent. */
  makePlans: () => Map<string, MakePlan>;
  gather: () => GatherWanted;
  spare: () => Counts;
}

/** A chore as its end is handled: its actions, its `failed` callback and whether that was called (reportFailed). */
interface ChoreEnd {
  agent: string;
  village: string;
  status: ActionStatus[];
  failed?: (why: string) => void;
  failReported?: boolean;
  choice: ChoiceState;
}

/** The sweep under way (A.2): its busy keys, and the first ready field's own (choreKeys' first-call quirk). */
interface SweepCtx {
  village: string;
  t: number;
  busy: Set<string>;
  first?: { k: number; busy: Set<string> };
}

/** A decision waiting for or in its model call (A.2, spec 5.1). */
interface PendingChoice {
  id: string;
  agent: BotAgent;
  village: string;
  decisionId: string;
  ac: AbortController;
  since: number;
  state: 'queued' | 'running';
  menu: ChoiceMenu;
  queueWaitMs?: number;
  /** A re-ask (s40): the first decision's id; its own pick, if taken too, runs the fixed pick. */
  reaskOf?: string;
  /** MC_CHOICE_HOLDS: the keys its shown options hold for it, and whether one was a project of its own. */
  holds?: string[];
  initiates?: boolean;
}

/** What running an option takes, beside the option's data (kept off the option, which stays plain data). */
type OptionRun =
  | { kind: 'farm'; k: number; ripe: number; grown: number }
  | { kind: 'slot'; k: number; j: number; ripe: number; slotKind: string }
  | { kind: 'start'; k: number; j: number; slotKind: string; x: number; y: number; z: number; store?: boolean }
  | { kind: 'annex'; again: boolean; area: string }
  | { kind: 'pen'; j: number; slotKind: string; x: number; y: number; z: number }
  | { kind: 'penwork'; j: number; what: string; skill: string; slotKind: string; animals: number }
  | { kind: 'cake' }
  | { kind: 'iron'; stage: string; tool: string; iron: number; k?: number; count?: number; for?: string }
  | { kind: 'explore'; i: number; x: number; z: number; home: { x: number; z: number } }
  | { kind: 'make'; good: MakeGood; count: number; inputs: Counts; smelts: boolean; k?: number; stock: number }
  | { kind: 'gather'; material: Material; n: number; amount: number; block: string; deposit: string; need: number; incoming: number; for: string[] }
  | { kind: 'works'; stage: 'prepare'; again: boolean; area: string }
  | { kind: 'works'; stage: 'furnace'; k: number }
  | { kind: 'light'; part: string; n: number; unlit: number; label: string }
  | { kind: 'furnish'; part: string; n: number; items: Counts; open: number; label: string }
  | { kind: 'shelve'; n: number }
  | { kind: 'initiate'; work: string; green?: boolean; mix?: string[] }
  | { kind: 'help'; id: string; step: InitiativeStep }
  | { kind: 'monument'; step: 'site' } | { kind: 'monument'; step: 'job'; job: number }
  | { kind: 'monument'; step: 'gather'; item: string; material: Material | 'flowers'; amount: number; block: string; deposit: string; bulk?: true }
  | { kind: 'monument'; step: 'kiln'; lane: number } | { kind: 'monument'; step: 'cut' } | { kind: 'monument'; step: 'dye'; item: string; amount: number } | { kind: 'monument'; step: 'deep'; item: string } | { kind: 'monument'; step: 'furnish'; item: string; amount: number }
  | { kind: 'grow'; houseless: number }
  | { kind: 'eat'; level: number; item: string; n: number; own?: boolean }
  | { kind: 'own'; what: 'chest' }
  | { kind: 'own'; what: 'basics' }
  | { kind: 'own'; what: 'decor' }
  | { kind: 'decor'; item: string; amount: number }
  | { kind: 'own'; what: 'shear'; make: boolean }
  | { kind: 'own'; what: 'carry'; want: Counts }
  | { kind: 'own'; what: 'deliver'; contract: string }
  | { kind: 'own'; what: 'make'; item: string; n: number; fuel: Counts }
  | { kind: 'own'; what: 'trade'; offer: string }
  | { kind: 'own'; what: 'sell'; item: string; lots: number }
  | { kind: 'own'; what: 'buy'; item: string }
  | { kind: 'own'; what: 'farm'; crop: string }
  | { kind: 'own'; what: 'pledge'; entry: string; item: string; n: number }
  | { kind: 'innovate'; entry: string; chance: number; boost: number }
  | { kind: 'rest'; x: number; y: number; z: number }
  | { kind: 'activity'; spec: LibrarySpec; args: Record<string, unknown>; count: number; stock: number; keep: number; needs: Counts; gives: string[] };
const OPTION_RUN = new WeakMap<ChoiceOption, OptionRun>();

/** The first growth waits this long after the village is first seen complete (s30, D2); a neighbourhood whose open tasks
 *  nobody holds or can claim for GROW_STUCK_MS is ended as stuck (D13); a site within the village's range (D6). */
const GROW_WAIT_MS = 60000, GROW_STUCK_MS = 10 * 60000;
/** A growth claim whose holder was idle on no chore, its brain not holding it, this many checks in a row (30 s apart) is
 *  handed back (s30's review, L-3). */
const GROW_ORPHAN_CHECKS = 4;
const CHOICE_KINDS: ChoiceKind[] = ['farm', 'slot', 'start', 'annex', 'pen', 'penwork', 'cake', 'iron', 'explore', 'works', 'make', 'gather', 'light', 'furnish', 'initiate', 'help', 'activity', 'own', 'innovate', 'rest', 'monument'];
/** An initiative's next step (s35): gathering a material into storage, or building it once the storage covers the bill. */
type InitiativeStep = { what: 'gather'; material: Material | 'flowers' | 'saplings' | 'sandstone'; amount: number; block: string; deposit: string; item?: string } | { what: 'build' } | { what: 'prepare' };
/** A green's side (s36): room for two or three small works with their rings. */
const GREEN_SIZE = 15;
/** Members a green (the user's, s36): a village prepares one green per GREENS_PER members for small works (MC_GREENS_PER
 *  for experiments, s43). */
const GREENS_PER = Number(rawSetting('MC_GREENS_PER')) || 5;
/** Ring point i's direction (0 east, clockwise: z grows to the south). */
const DIRECTIONS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
/** A vote under way (spec_vote1): its ballots come in as the calls end. */
interface VoteRun { id: string; topic: VoteTopic; k: number; options: VoteOption[]; started: number; mode: VoteMode; done: boolean; ballots: Ballot[]; voters: string[]; ac: AbortController }

/** #134: a cane slot's stalks when full (farmSlots.ts slotPlan: two columns of 7), and who a posted market stall is by. */
const CANE_FULL = 14;
const STALL_BY = 'the village';
/** X.2: public works (MC_PROJECTS, on by default since X2p: 7 works in an hour, steady busy 1% -> 3-4%); the status quo
 *  option's id; how long a "no new work" win rests the question (2 min: at 5 the rests were most of each cycle, X2p). */
const PROJECTS_ON = !/^(off|0|false)$/i.test(rawSetting('MC_PROJECTS') ?? 'on');
/** #75: public works may repeat a piece once the unbuilt ones run out (off by default, s43). */
const WORKS_REPEAT = /^(on|1|true)$/i.test(rawSetting('MC_WORKS_REPEAT') ?? 'off');
/** #75: works that grow with the village (off by default): standing buildings refitted a tier on their own cells (refit.ts),
 *  offered in the public-work vote where new works leave slots (runs/2026-10-21/works-grow/design.md). */
const WORKS_GROW = /^(on|1|true)$/i.test(rawSetting('MC_WORKS_GROW') ?? 'off');
const REFIT_FIRST = /^(on|1|true)$/i.test(rawSetting('MC_REFIT_FIRST') ?? 'off');
/** How far a public work's uncommon materials are looked for (96, not the village range: at 144 the atlas saw sandstone
 *  that collect never reached, and a savanna quarter waited an hour for it, s43's Rch6). */
const WORK_MATERIAL_RANGE = 96;
/** Menu reasons that do not block a need (needNote): another member is on it, this member only, or it is under way. */
const NOT_BLOCKING = new Set(['busy', 'hungry', 'has a house', 'a street is asked for', 'a layout is being built', 'a vote is under way']);
const PROJECT_FARMSTEAD = 'farmstead';
const PROJECT_NONE = 'none', PROJECT_HOUSES = 'houses', PROJECT_REST_MS = Number(rawSetting('MC_PROJECT_REST_MS') ?? 2 * 60000);
/** s35: initiatives open at once in a village (MC_INITIATIVES; 0: none), gatherers on one initiative at once, and how
 *  long one waits with no step taken before it lapses. */
/** N.2 (s37): a street of houses asked for and not laid out within this long is dropped (H4); a member's own house is
 *  left to it this long once its Build task can be claimed (H7); public works wait this long after the last street while
 *  members have no house; another member's house is its own to furnish and light this long, then anyone may help (H8). */
const HOME_REQUEST_MS = 15 * 60000, OWNER_FIRST_MS = 3 * 60000, HOME_FIRST_MS = 10 * 60000, OWN_DECOR_MS = 10 * 60000;
const INITIATIVES_MAX = Number(rawSetting('MC_INITIATIVES') ?? 3), INITIATIVE_GATHERERS = 2, INITIATIVE_LAPSE_MS = 30 * 60000;
/** MC_INITIATIVE_STORE=off: initiatives gather all their own (s36's rule); on by default since s40 (the user's, 10-20). */
const INITIATIVE_STORE = !/^(off|0|false)$/i.test(rawSetting('MC_INITIATIVE_STORE') ?? 'on');
/** #121: the storage yard is due at this share of the storage's slots used, with at most STORE_FREE spots free. */
const STORE_AT = 0.75, STORE_FREE = 2;

/**
 * Whether the storage yard is due (#121, pure, for storage_grow.mts): a storage hut, no yard ready or recorded with three
 * failed tries, the last try 10+ minutes ago, at most STORE_FREE spots free and STORE_AT of the slots used.
 */
export function storageDue(v: Village, st: { used: number; cap: number }, free: number, now: number): { due: boolean; why: string } {
  const yd = v.layouts?.[0]?.store;
  if (!v.storageHut || !v.layouts?.[0]) return { due: false, why: 'no storage hut' };
  if (yd?.state === 'ready') return { due: false, why: 'the yard is ready' };
  if ((yd?.tries ?? 0) >= 3) return { due: false, why: `the yard failed ${yd!.tries} times` };
  if (yd?.lastTry && now - yd.lastTry.at < 10 * 60000) return { due: false, why: 'backing off' };
  if (free > STORE_FREE) return { due: false, why: `${free} spots free` };
  if (st.cap <= 0 || st.used / st.cap < STORE_AT) return { due: false, why: `${st.used} of ${st.cap} slots used` };
  return { due: true, why: '' };
}

/** The storage's tidy-up (s40): strays filling this many slots, at most every TIDY_MS. */
const TIDY_SLOTS = 6, TIDY_MS = 10 * 60000;
/** N.1's needs (spec_needs_v2): off; show (measured, logged, on the API and panel); on (also on the menus). */
let NEEDS_MODE: 'off' | 'show' | 'on' = rawSetting('MC_NEEDS') === 'show' || rawSetting('MC_NEEDS') === 'on' ? (rawSetting('MC_NEEDS') as 'show' | 'on') : 'off';
// (#115: needs measured, shown or on the menus, changed during a run)
onSetting('MC_NEEDS', (v) => {
  NEEDS_MODE = v === 'show' || v === 'on' ? v : 'off';
});
/** How often a village's needs are read. */
const NEED_TICK_MS = 30000;

/** X.2 part 2a: the most pieces a public work's quarter holds (MC_QUARTER; 1: a lone piece, as part 1). */
const QUARTER = Math.max(1, Number(rawSetting('MC_QUARTER') ?? 3));
/** A non-dwelling piece's kind ("plains_tool_smith_1" -> "tool_smith"): one of a kind on a ballot and in a quarter. */
const workKind = (name: string) => name.replace(/^(plains|desert|savanna|snowy|taiga)_/, '').replace(/_\d+$/, '').replace(/_(house|shop)$/, '').replace(/s$/, '');

/** A.3p: how long a disliked option waits for a member who likes it before anyone takes it (MC_DECLINE_MS). */
const DECLINE_MS = Number(rawSetting('MC_DECLINE_MS') ?? 90000);

const KIND_WORDS: Record<string, string> = { farm: 'harvesting', slot: 'harvesting', start: 'starting farms', annex: 'preparing the annex', pen: 'leading animals', penwork: 'tending pens', cake: 'baking', iron: 'iron work', explore: 'exploring',
  works: 'preparing the works', make: 'making goods', gather: 'gathering for the workshop', light: 'lighting', furnish: 'furnishing', initiate: 'starting projects', help: 'helping with projects', grow: 'laying out houses', eat: 'eating', tidy: 'tidying the storage', activity: 'the new crafts' };
/** The furnaces counted with the hut's (a works furnace is the village's second, third or fourth). */
const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth'];

/** Items as the facts say them ("12 cobblestone, 1 oak log") and as the log lines list them ("cobblestone:12,oak_log:1"). */
const countsText = (c: Counts) => Object.entries(c).filter(([, q]) => q > 0).map(([n, q]) => `${q} ${words(n)}`).join(', ') || 'nothing';
const countsList = (c: Counts) => Object.entries(c).filter(([, q]) => q > 0).map(([n, q]) => `${n}:${q}`).join(',') || 'none';

/** What a deposit's message says went in of a gathering's material ("deposited 4 oak_log, 8 birch_log (...). Storage now
 *  holds ...": only the head, not the storage's own list). */
/** How many of `items` a deposit's message says went in (s41's activities). */
function depositedItems(message: string, items: string[]): number {
  const head = /^deposited ([^(;.]*)/.exec(message)?.[1] ?? '';
  let n = 0;
  for (const x of head.matchAll(/(\d+) ([a-z_]+)/g)) if (items.includes(x[2])) n += Number(x[1]);
  return n;
}

function depositedOf(message: string, m: Material | 'flowers' | 'saplings' | 'sandstone', item?: string): number {
  const head = /^deposited ([^(;.]*)/.exec(message)?.[1] ?? '';
  // (#140: a flower bed's trip by the flower it picked)
  const name = m === 'logs' ? '[a-z_]+_log' : m === 'sand' ? '(?:red_)?sand' : m === 'flowers' ? item ?? 'wildflowers' : m === 'saplings' ? '[a-z_]+_sapling' : m === 'sandstone' ? '(?:red_)?sandstone' : 'cobblestone';
  let n = 0;
  for (const x of head.matchAll(new RegExp(`(\\d+) ${name}\\b`, 'g'))) n += Number(x[1]);
  return n;
}

/** Whether a decision's model reply came (a choice, an invalid one, or a pick taken meanwhile). */
const replied = (m: ChoiceMeta) => m.source === 'model' || m.why === 'invalid' || !!m.modelChose;

/** A chore's words-only name when it was set without an option (the wheat field and ripe slots before completion: the
 *  outcome lines the model reads, spec 5.3), as the menu names them. */
function choreName(key: string, what: string): string {
  const [kind, k] = key.split(':');
  if (kind === 'farm') return `Harvest the wheat field${Number(k) > 1 ? ' of the second plot' : ''}`;
  const crop = /^harvest (.+)$/.exec(what)?.[1];
  if (kind === 'slot' && crop) return `Harvest the ${words(crop)} farm`;
  return what ? what[0].toUpperCase() + what.slice(1) : KIND_WORDS[kind] ?? kind;
}

/** G8: the iron tools a smith forges, their ingots, and whose work needs each (miners first; spec B3). */
const FORGE_TOOLS = ['iron_pickaxe', 'iron_hoe', 'shears', 'bucket'];
/** G8: the iron level's answers that mean another miner is in the way (mcMine's gate, stairs and leg claims). */
const IRON_WAIT = /another worker is digging|miners are on the iron level|has its miner|another miner finished|no raw iron in storage|no raw_iron in inventory/;
const FORGE_COST: Record<string, number> = { iron_pickaxe: 3, iron_hoe: 2, shears: 2, bucket: 3 };
const FORGE_NEEDS: Array<[string, (k: Map<string, number>) => boolean, string]> = [
  ['iron_pickaxe', (k) => (k.get('iron:dig') ?? 0) >= 1, 'mines without one'],
  ['iron_hoe', (k) => (k.get('farm') ?? 0) + (k.get('slot') ?? 0) + (k.get('start') ?? 0) >= 2, 'farms without one'],
  ['shears', (k) => (k.get('shear') ?? 0) >= 1, 'shears sheep without them'],
  ['bucket', (k) => (k.get('milk') ?? 0) >= 1, 'milks cows without one'],
];

/** An option matches a busy key (ChoiceOption.excludes: "x=" exactly, "x" as itself or a prefix of "x:..."). */
function excluded(excludes: string[], busy: Set<string>): boolean {
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

/** Tries forgiven an hour after the last (the readers' effective value). */
function effTries(tries: number | undefined, lastAt: number | undefined, now: number): number {
  return tries && lastAt !== undefined && now - lastAt > 60 * 60000 ? 0 : tries ?? 0;
}

const words = (s: string) => s.replace(/_/g, ' ');
const numberWord = (n: number) => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] ?? 'another';
/** What a torch batch is for with lighting on (B.4): the spots storage cannot light yet, else the reserve. */
const torchWhy = (demand: number, stock: number) => demand > stock
  ? `${demand - stock} more torch spot${demand - stock === 1 ? '' : 's'} wait in the houses and the mine than storage holds torches for`
  : `the reserve kept beyond the ${demand} torch spot${demand === 1 ? '' : 's'} still waiting (storage covers them)`;
const ago =(ms: number) => (ms < 90000 ? `${Math.max(0, Math.round(ms / 1000))} s ago` : `${Math.round(ms / 60000)} min ago`);
const clock = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
