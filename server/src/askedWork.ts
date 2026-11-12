/**
 * Requested works at full size (MC_TALK_BIG, on; docs/specs/requested-builds.md): a person's statue, pyramid, tower,
 * obelisk or arch up to 30x30x30, in any block the overworld village can get. World-free: the setting, the budget and
 * ETA, the block resolver (a block id the architect names checked against the yard's plan and routes, else the nearest
 * block the village can get, with a note), the raw items' routes, and the asked record's plan (the drawn design as
 * gothicGen's Cathedral: stages of layers bottom-up, jobs cut by civicDraw's x slices) the monument's machinery builds.
 *
 * Settings (read once):
 *   MC_TALK_BIG       on (default) | off: the 30x30x30 space, real blocks and the asked record; off, 11-12's 11x11x12 in
 *                     easy colours as a single public work
 *   MC_TALK_BIG_WAIT  30: game minutes a raw item may hold an asked record before the blocks made from it stand in
 */
import { Grid, finishCivic } from './civicDraw';
import type { Cathedral } from './gothicGen';
import { rawSetting } from './settings';
import type { Design } from './village';

export const TALK_BIG = {
  on: !/^(off|0|false|no)$/i.test(rawSetting('MC_TALK_BIG') ?? 'on'),
  wait: Math.max(1, Number(rawSetting('MC_TALK_BIG_WAIT') ?? 30) || 30),
  /** The design space: x and z, and the layers with the plinth. */
  side: 30,
  up: 30,
  /** Furnace runs a big work may take (the kiln smelts them; the units cap binds first). */
  smelts: 9000,
  /** A drawn work over this many blocks (or over 11x11x12, or in a material outside the easy list) is an asked record. */
  small: 400,
  /** The record's stages: at most this many layers and about this many blocks each; jobs of 120-360 blocks. */
  stageLayers: 6,
  stageBlocks: 900,
};
/** Test hook. */
export function setTalkBig(s: Partial<typeof TALK_BIG>): void { Object.assign(TALK_BIG, s); }

/** A big work's units cap: 150 a member, 3,000 to 9,000 (a solid 30-base stepped pyramid in glass is ~6,500). */
export const bigBudget = (members: number) => Math.max(3000, Math.min(9000, Math.round(150 * Math.max(1, members))));

/**
 * Minutes an asked record takes: the civic tier's pace (2,000 blocks in about an hour for ~25 members: ~1.3 blocks a
 * member-minute, gathering included), slowed by the share of its blocks from slow chains (wool, dyes, ores: x2), in game
 * time (divided by `scale`, MC_TIME_SCALE); rounded to 5, at least 10.
 */
export function askedEta(blocks: number, members: number, slowShare = 0, scale = 1): number {
  const min = (blocks / (1.3 * Math.max(1, members))) * (1 + Math.max(0, Math.min(1, slowShare))) / Math.max(0.1, scale);
  return Math.max(10, Math.round(min / 5) * 5);
}

/** Whether a person's words name a material or a size ("a red wool castle tower", "a 30-block pyramid"): then a "design"
 *  answer is kept although a pre-designed building of the kind is on the shortlist (a stone tower house is not red wool). */
export function namesMaterial(text: string): boolean {
  return /\b(wool|glass|concrete|terracotta|quartz|copper|gold(en)?|iron|diamond|emerald|lapis|prismarine|obsidian|deepslate|blackstone|marble|amethyst|white|orange|magenta|yellow|lime|pink|gr[ae]y|cyan|purple|blue|brown|green|red|black)\b|\b\d+[- ]?(blocks?|high|tall|wide)\b/i.test(text);
}

// ---- the asked record's preset -----------------------------------------------------------------------------------------

/** An asked record's preset: "asked:" and its design's name. */
export const ASKED_PRESET = 'asked:';
export const isAskedPreset = (p?: string) => !!p?.startsWith(ASKED_PRESET);
/** A preset's or design name's words: "asked:asked_blue_glass_pyramid_r12" -> "blue glass pyramid". */
export const askedWords = (p: string) => p.replace(ASKED_PRESET, '').replace(/^asked_/, '').replace(/_r\d+$/, '').replace(/_/g, ' ').trim() || 'work';
/** A work's noun from what was asked ("a statue of a chicken" -> "statue", "a blue glass pyramid" -> "pyramid"). */
export function askedNoun(what: string): string {
  const w = what.toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/\s+(of|in|made|with|for|from|at|by|near)\b.*$/, '').trim();
  return w.split(/\s+/).at(-1)?.replace(/[^a-z-]/g, '') || 'work';
}

/** What an asked record carries: the drawn design (the plan is made from it, the record needs no village to read), what
 *  was asked in words and its noun. */
export interface AskedWork { design: Design; what: string; noun: string; by?: string }

/** The record's stages: layers grouped bottom-up, a new stage at TALK_BIG.stageLayers layers or past stageBlocks. */
export function askedStages(design: Design): number[] {
  const counts = design.layers.map((layer) => layer.reduce((t, row) => t + [...row].filter((ch) => ch !== '.' && ch !== '_' && design.palette[ch] && design.palette[ch] !== 'air').length, 0));
  const out: number[] = [];
  let st = 1, layers = 0, blocks = 0;
  for (const n of counts) {
    if (layers && (layers >= TALK_BIG.stageLayers || blocks + n > TALK_BIG.stageBlocks)) [st, layers, blocks] = [st + 1, 0, 0];
    out.push(st);
    layers++;
    blocks += n;
  }
  return out;
}

/** The drawn design as gothicGen's Cathedral (the monument's plan): stages of layers, jobs of 120-360 blocks by x slice. */
export function askedCathedral(a: AskedWork): Cathedral {
  const d = a.design, stage = askedStages(d), g = new Grid();
  d.layers.forEach((layer, y) => layer.forEach((row, z) => {
    for (let x = 0; x < row.length; x++) {
      const b = d.palette[row[x]];
      if (row[x] === '.' || row[x] === '_' || !b || b === 'air') continue;
      g.set(x, y, z, b, stage[y]);
    }
  }));
  const n = Math.max(...stage);
  const names: string[] = [];
  for (let s = 1; s <= n; s++) {
    const ys = stage.map((v, i) => (v === s ? i : -1)).filter((i) => i >= 0);
    names.push(ys[0] === 0 ? `base and layers to ${ys.at(-1)}` : `layers ${ys[0]}-${ys.at(-1)}`);
  }
  return finishCivic(d.name, a.what, 1, g, names, 'asked', 120, 360);
}

// ---- materials -----------------------------------------------------------------------------------------------------------

export const DYE_COLOURS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
/** A block's dye colour, from its name ("light_blue_concrete" -> "light_blue"), or null. */
export function colourOf(block: string): string | null {
  const n = block.replace(/^minecraft:/, '');
  return [...DYE_COLOURS].sort((a, b) => b.length - a.length).find((c) => n.startsWith(`${c}_`)) ?? null;
}

const FLOWERS = /^(dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley|torchflower|sunflower|lilac|rose_bush|peony|pink_petals|wildflowers)$/;
/** How the yard gets a raw item for an asked record: the dyer (dye), shearing (wool), clay dug and crafted into blocks
 *  (clay), a collect trip (gather: clay balls, gravel), the iron mine's trips (ore, deep), the monument's own routes (yard:
 *  logs, sand, cobblestone, the quarry's stones, flowers); null: no way, the blocks made from it stand in. */
export type AskedRoute = 'dye' | 'wool' | 'clay' | 'gather' | 'ore' | 'deep' | 'yard';
export function askedRoute(item: string): AskedRoute | null {
  if (/_dye$/.test(item)) return 'dye';
  if (item === 'white_wool') return 'wool';
  if (item === 'clay') return 'clay';
  if (item === 'clay_ball' || item === 'gravel') return 'gather';
  if (item === 'raw_iron' || item === 'raw_copper') return 'ore';
  if (item === 'cobbled_deepslate' || item === 'tuff') return 'deep';
  if (/^(any:logs|any:cobblestone|.*_(log|stem)|sand|cobblestone|andesite|diorite|granite)$/.test(item) || FLOWERS.test(item)) return 'yard';
  return null;
}
/** The block a collect trip digs for a raw item (clay balls from clay). */
export const ASKED_BLOCK: Record<string, string> = { clay_ball: 'clay', clay: 'clay', gravel: 'gravel' };

/** Blocks the village cannot get and the nearest it may (each resolved again: a dye it cannot make falls to easyOf). */
export const NEAREST: Record<string, string> = {
  quartz_block: 'white_concrete', smooth_quartz: 'white_concrete', quartz_bricks: 'white_concrete', quartz_pillar: 'white_concrete', chiseled_quartz_block: 'white_concrete',
  quartz_stairs: 'white_concrete', quartz_slab: 'white_concrete', smooth_quartz_stairs: 'white_concrete', smooth_quartz_slab: 'white_concrete',
  glowstone: 'yellow_stained_glass', sea_lantern: 'light_blue_stained_glass', shroomlight: 'orange_stained_glass', ochre_froglight: 'yellow_stained_glass', verdant_froglight: 'lime_stained_glass', pearlescent_froglight: 'pink_stained_glass',
  prismarine: 'cyan_terracotta', prismarine_bricks: 'cyan_terracotta', dark_prismarine: 'cyan_concrete',
  nether_bricks: 'bricks', red_nether_bricks: 'red_terracotta', netherrack: 'red_terracotta', nether_wart_block: 'red_wool', warped_wart_block: 'cyan_wool',
  blackstone: 'polished_deepslate', polished_blackstone: 'polished_deepslate', polished_blackstone_bricks: 'deepslate_bricks', basalt: 'polished_deepslate', polished_basalt: 'polished_deepslate',
  end_stone: 'sandstone', end_stone_bricks: 'cut_sandstone', purpur_block: 'magenta_terracotta', purpur_pillar: 'magenta_terracotta',
  obsidian: 'black_concrete', crying_obsidian: 'purple_concrete', diamond_block: 'light_blue_concrete', emerald_block: 'lime_concrete', gold_block: 'yellow_concrete',
  lapis_block: 'blue_concrete', netherite_block: 'black_concrete', redstone_block: 'red_concrete', coal_block: 'black_concrete', amethyst_block: 'purple_stained_glass',
  bone_block: 'white_concrete', ice: 'light_blue_stained_glass', packed_ice: 'light_blue_stained_glass', blue_ice: 'blue_stained_glass', snow_block: 'white_concrete',
  slime_block: 'lime_stained_glass', honey_block: 'orange_stained_glass', mud_bricks: 'brown_terracotta', packed_mud: 'brown_terracotta', moss_block: 'green_concrete',
  calcite: 'white_concrete', dripstone_block: 'brown_terracotta', water: 'light_blue_stained_glass', lava: 'orange_stained_glass', magma_block: 'orange_concrete',
  bedrock: 'cobblestone', spawner: 'iron_bars', barrier: 'glass', light: 'glass', command_block: 'stone_bricks', structure_block: 'stone_bricks', reinforced_deepslate: 'deepslate_bricks',
  gold_ore: 'stone', diamond_ore: 'stone', emerald_ore: 'stone', iron_ore: 'stone', coal_ore: 'stone', copper_ore: 'stone', lapis_ore: 'stone', redstone_ore: 'stone',
};

/** A block in the easiest stuff of its look: stained glass as glass, a dyed block as its colour's easy stone (the
 *  sculpture colours), gold and copper in yellow and orange, dark stones as cobblestone; else stone bricks. */
export function easyOf(block: string, colourBlocks: Record<string, string>, alias: Record<string, string>): string {
  const n = block.replace(/^minecraft:/, '').replace(/\[.*$/, '');
  if (/_stained_glass_pane$/.test(n)) return 'glass_pane';
  if (/_stained_glass$|^tinted_glass$|ice$|^water$/.test(n)) return 'glass';
  const c = colourOf(n);
  if (c) return colourBlocks[c] ?? colourBlocks[alias[c] ?? ''] ?? 'stone_bricks';
  if (/quartz|calcite|snow|bone|diorite/.test(n)) return colourBlocks.white;
  if (/gold|end_stone|sand/.test(n)) return colourBlocks.yellow;
  if (/copper|terracotta|granite|magma|lava/.test(n)) return colourBlocks.orange;
  if (/brick|nether|redstone/.test(n) && !/stone_brick|deepslate/.test(n)) return colourBlocks.red;
  if (/deepslate|blackstone|basalt|obsidian|coal|black/.test(n)) return 'cobblestone';
  if (/_planks$/.test(n)) return 'oak_planks';
  if (/_(log|wood|stem|hyphae)$/.test(n)) return 'oak_log';
  return 'stone_bricks';
}

/** What the resolver needs from the world: whether a name is a block, the yard's plan of one block, the dye colours the
 *  village can make. */
export interface ResolveCtx {
  known: (name: string) => boolean;
  plan: (bill: Record<string, number>) => { gather: Record<string, number>; problems: string[] };
  colours: Set<string>;
  colourBlocks: Record<string, string>;
  alias: Record<string, string>;
  /** The village's wood: another kind's wood is built in it (the yard fells the village's trees; oak is swapped for it
   *  on the record, as a civic building's). */
  wood?: string;
}
export interface Resolved { block: string | null; note?: string }

/** Why a block cannot be had by an asked record (its plan's raw items with no route, dyes the village cannot make,
 *  items not in this world), or null when it can. */
export function cannotGet(block: string, ctx: ResolveCtx): string | null {
  if (NEAREST[block]) return `${block.replace(/_/g, ' ')} is not to be had in this world`;
  const p = ctx.plan({ [block]: 1 });
  if (p.problems.length) return p.problems[0].slice(0, 80);
  for (const g of Object.keys(p.gather)) {
    if (!askedRoute(g)) return `no way to get ${g.replace(/^any:/, '').replace(/_/g, ' ')}`;
    const c = /^(\w+)_dye$/.exec(g)?.[1];
    if (c && !ctx.colours.has(c)) return `no ${c.replace(/_/g, ' ')} dye to be made here`;
  }
  return null;
}

/**
 * The architect's block word resolved: a block id the village can get as it is, else the nearest it can (NEAREST, then
 * its easy look), with a note; undefined when the word is no block (a colour word: sculpture.ts' colours). Cached.
 */
export function makeResolver(ctx: ResolveCtx): (word: string) => Resolved | undefined {
  const cache = new Map<string, Resolved | undefined>();
  return (raw: string) => {
    const w = raw.replace(/^minecraft:/, '').replace(/\[.*$/, '');
    if (cache.has(w)) return cache.get(w);
    let out: Resolved | undefined;
    const wood = /^(stripped_)?(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_(.+)$/.exec(w);
    if (wood && ctx.wood && wood[2] !== ctx.wood && wood[2] !== 'oak' && ctx.known(w)) {
      const as = `${wood[1] ?? ''}oak_${wood[3]}`;
      if (ctx.known(as)) out = { block: as, note: `${w.replace(/_/g, ' ')} built in the village's ${ctx.wood.replace(/_/g, ' ')} wood` };
    }
    if (out) {
      cache.set(w, out);
      return out;
    }
    if (NEAREST[w] || ctx.known(w)) {
      const why = cannotGet(w, ctx);
      if (!why) out = { block: w };
      else {
        const near = NEAREST[w];
        const sub = near && !cannotGet(near, ctx) ? near : easyOf(near ?? w, ctx.colourBlocks, ctx.alias);
        out = { block: sub, note: `${w.replace(/_/g, ' ')} built in ${sub.replace(/_/g, ' ')} (${why})` };
      }
    }
    cache.set(w, out);
    return out;
  };
}

/** The share of a design's blocks from slow chains (wool, dyes, ores) by the yard's plan of each block (the ETA's). */
export function slowShare(design: Design, plan: ResolveCtx['plan']): number {
  const count = new Map<string, number>();
  let all = 0;
  for (const layer of design.layers) for (const row of layer) for (const ch of row) {
    const b = design.palette[ch];
    if (ch === '.' || ch === '_' || !b) continue;
    count.set(b, (count.get(b) ?? 0) + 1);
    all++;
  }
  let slow = 0;
  // (each block by how much of a slow item it takes: stained glass an eighth of a dye, wool a fleece and a dye; planned
  // by the 8, as the planner makes dyed blocks 8 at a time)
  for (const [b, n] of count) {
    const g = plan({ [b]: 8 }).gather;
    const per = Object.entries(g).filter(([k]) => /_dye$|wool|^raw_|clay/.test(k)).reduce((t, [, q]) => t + q, 0) / 8;
    slow += n * Math.min(1, per);
  }
  return all ? slow / all : 0;
}
