/**
 * The supply gaps behind the village's needs (train 9c, F338; runs/2026-10-29/supply/): 93% of the first steps the needs
 * block named could not be taken then. Each fix is its own flag, off by default; world-free, read by mcWorld.ts.
 */
import { rawSetting } from './settings';

/**
 * MC_FIELD_RIPE (0.5 since 10-30; was 0.75): the share of a wheat field's grown plants that must be ripe before it is offered for harvest (and
 * 4 at least). At 0.75 a 16-cell field came ready about 1.4 times an hour; at 0.5 the wheat model gives 2.0-2.3 harvests
 * an hour and a tenth more wheat (ripe plants wait less for the slow ones; runs/2026-10-29/supply/wheat_sim.py).
 */
export const FIELD_RIPE = Math.min(1, Math.max(0, Number(rawSetting('MC_FIELD_RIPE') ?? 0.5) || 0));

/**
 * MC_OWN_ROD=on (with MC_OWN): a member whose own chest holds a fishing rod may go fishing with it while storage has none
 * to spare: the rod comes out of its chest at its door and goes back there after (train 9c: 25 rods in own chests, 3 in
 * storage, "no fishing rod in storage" 552 times).
 */
export const OWN_ROD = /^(on|1|true)$/i.test(rawSetting('MC_OWN_ROD') ?? 'on');

/**
 * MC_FLOWER_WANTS=on: the flower picking activity is offered for a flower whose dye a good under its keep takes (lilac for
 * magenta dye), counted by that flower's own stock, and picks it; without it the activity counts every flower it gives
 * together (train 9c: 423-543 wildflowers held it at its keep of 32 while lilac was 0, "get lilac" 1,565 times) and picks
 * the commonest flower near the hut.
 */
export const FLOWER_WANTS = /^(on|1|true)$/i.test(rawSetting('MC_FLOWER_WANTS') ?? 'on');

/**
 * MC_STRING=on (#178): the peaceful world's string comes from cobwebs (old mineshafts; a sword breaks one into a string):
 * the gather_string activity (foundry/cobweb.ts, server/library/string.json) and fishing rods in the workshop (two string,
 * three sticks). Without it, and with the merchant off, no rod or string exists and nobody fishes (train 12, F341).
 */
export const STRING = /^(on|1|true)$/i.test(rawSetting('MC_STRING') ?? 'on');

/** A wanted flower's own keep under MC_FLOWER_WANTS: picked while storage holds fewer. */
export const FLOWER_KEEP = 8;
