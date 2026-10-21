/**
 * The activity library (s41, runs/2026-10-20/s41/spec_proposals_v2.md A): specs that run a foundry skill as a chore (the
 * `activity` menu kind), one JSON file each in server/library/. A spec names the skill, its fixed arguments, the items it
 * needs from storage (tools withdrawn first and put back after), what it gives and who uses it (F258: work whose products
 * nothing uses only fills storage, lesson 149). World-free: it reads the registry, never the world. The validator is
 * strict and never throws (it runs at start; a bad file is logged and skipped, lesson 104).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type minecraftData from 'minecraft-data';
import { UNOBTAINABLE } from './mineflayer/mcMaterials';
import { obtainableHere } from './merchant';
import { INNOVATE, registerResearch, type Research } from './tech';

type Registry = ReturnType<typeof minecraftData>;

/** Who uses what an activity gives: members' meals (food), the houses' furniture (furnish), designs' bills (build),
 *  lighting (light), the furnaces (fuel), the merchant's trades (trade: emeralds, s41). */
export type Consumer = 'food' | 'furnish' | 'build' | 'light' | 'fuel' | 'trade';
export const CONSUMERS: Consumer[] = ['food', 'furnish', 'build', 'light', 'fuel', 'trade'];

export interface LibrarySpec {
  /** 'lib:fish'. */
  id: string;
  /** Menu words, at most 60 characters ("Go fishing"). */
  name: string;
  /** A foundry skill with an activity adapter (foundry/types.ts). */
  skill: string;
  /** The skill's fixed arguments (no coordinates: places come from the skill's adapter). */
  args?: Record<string, string | number | boolean>;
  /** The argument the world fills with what is wanted (keep less stock, at most `max`). */
  count?: { arg: string; max: number };
  /** Items that must be spare in storage, withdrawn before the skill (tools are put back after). */
  needs?: Record<string, number>;
  /** What it gives, each with who uses it (none: capped at the default keep). */
  gives: Array<{ item: string; consumer?: Consumer }>;
  /** Other items it may bring (a catch's junk), deposited with the gives. */
  also?: string[];
  /** The gives' stock target together; without one, the consumer's (food: two a member) or LIBRARY_KEEP. */
  keep?: number;
  /** What it is for, at most 160 characters (lesson 127). */
  effect: string;
  /**
   * G6: locked until researched (tech.ts adds an innovation entry from it; foundry/list.ts offers the activity only once a
   * village has unlocked it, and never with MC_INNOVATE off). `goods`: the workshop goods the research also opens (at
   * least one: the menu's "research toward ..." and the unlock line name them); `capability`: the wanted list's id.
   */
  research?: Research;
}

/** The keep of a spec whose gives no consumer uses (F258, lesson 149: no surplus nobody uses). */
export const LIBRARY_KEEP = 8;

const ID = /^lib:[a-z0-9_]+$/;
const ARG = /^[a-z_]+$/;

/** What is wrong with a spec (empty: valid). `skills`: the foundry skills with an activity adapter. Never throws. */
export function validateLibrarySpec(s: LibrarySpec, ctx: { registry: Registry; skills: Set<string>; ids?: Set<string> }): string[] {
  try {
    return check(s, ctx);
  } catch (e) {
    return [`the validator failed: ${(e as Error).message}`];
  }
}

function check(s: LibrarySpec, ctx: { registry: Registry; skills: Set<string>; ids?: Set<string> }): string[] {
  const errs: string[] = [];
  if (!s || typeof s !== 'object') return ['not an object'];
  const reg = ctx.registry;
  if (typeof s.id !== 'string' || !ID.test(s.id)) errs.push(`id "${s.id}" is not like lib:fish`);
  else if (ctx.ids?.has(s.id)) errs.push(`id ${s.id} is taken`);
  if (typeof s.name !== 'string' || !s.name.length || s.name.length > 60) errs.push('name must be 1-60 characters');
  if (typeof s.effect !== 'string' || !s.effect.length || s.effect.length > 160) errs.push('effect must be 1-160 characters');
  if (typeof s.skill !== 'string' || !ctx.skills.has(s.skill)) errs.push(`skill "${s.skill}" is not a foundry skill with an activity`);
  const item = (n: unknown, what: string) => {
    if (typeof n !== 'string' || !reg.itemsByName[n]) errs.push(`${what} ${String(n)} does not exist`);
    // (what a peaceful world lacks is obtainable while the merchant sells it, the shop check's F1)
    else if (!obtainableHere(n, UNOBTAINABLE)) errs.push(`${what} ${n}: ${UNOBTAINABLE[n]}`);
  };
  for (const [k, v] of Object.entries(s.args ?? {})) {
    if (!ARG.test(k)) errs.push(`argument ${k} is not a name`);
    else if (/^[xyz]$/.test(k)) errs.push('no coordinates in a spec (places come from the skill)');
    if (!['string', 'number', 'boolean'].includes(typeof v)) errs.push(`argument ${k} must be a string, number or boolean`);
  }
  if (s.count !== undefined) {
    if (!s.count || typeof s.count.arg !== 'string' || !ARG.test(s.count.arg)) errs.push('count.arg is not a name');
    if (!Number.isInteger(s.count?.max) || s.count.max < 1 || s.count.max > 64) errs.push('count.max must be a whole number in 1..64');
  }
  for (const [n, q] of Object.entries(s.needs ?? {})) {
    item(n, 'need');
    if (!Number.isInteger(q) || q < 1 || q > 64) errs.push(`need ${n}: ${q} is not a whole number in 1..64`);
  }
  if (!Array.isArray(s.gives) || !s.gives.length) errs.push('gives nothing (a spec that picks in code names what it may give)');
  for (const g of Array.isArray(s.gives) ? s.gives : []) {
    item(g?.item, 'give');
    if (g?.consumer !== undefined && !CONSUMERS.includes(g.consumer)) errs.push(`consumer "${g.consumer}" is unknown`);
  }
  for (const n of s.also ?? []) item(n, 'also');
  if (s.keep !== undefined && (!Number.isInteger(s.keep) || s.keep < 1 || s.keep > 256)) errs.push('keep must be a whole number in 1..256');
  if (s.research !== undefined) {
    const r = s.research;
    if (!r || typeof r !== 'object') errs.push('research is not an object');
    else {
      if (typeof r.name !== 'string' || !r.name.length || r.name.length > 40) errs.push('research.name must be 1-40 characters');
      const counts = (c: unknown, what: string, need: boolean) => {
        if (c === undefined && !need) return;
        if (!c || typeof c !== 'object') return errs.push(`research.${what} is not a table of counts`);
        for (const [n, q] of Object.entries(c as Record<string, unknown>)) {
          item(n, `research.${what}`);
          if (!Number.isInteger(q) || (q as number) < 1 || (q as number) > 64) errs.push(`research.${what} ${n}: ${String(q)} is not a whole number in 1..64`);
        }
      };
      counts(r.requires, 'requires', true);
      counts(r.attempt, 'attempt', true);
      counts(r.success, 'success', false);
      if (typeof r.minutes !== 'number' || r.minutes < 0.5 || r.minutes > 10) errs.push('research.minutes must be 0.5..10');
      if (typeof r.chance !== 'number' || r.chance <= 0 || r.chance > 0.9) errs.push('research.chance must be in (0, 0.9]');
      if (typeof r.complexity !== 'number' || r.complexity < 1 || r.complexity > 20) errs.push('research.complexity must be 1..20');
      if (r.after !== undefined && (!Array.isArray(r.after) || r.after.some((x) => typeof x !== 'string'))) errs.push('research.after must be entry ids');
      if (r.tools !== undefined && (!Array.isArray(r.tools) || r.tools.some((x) => typeof x !== 'string' || !reg.itemsByName[x]))) errs.push('research.tools must be items');
      if (r.capability !== undefined && (typeof r.capability !== 'string' || !ARG.test(r.capability))) errs.push('research.capability is not a name');
      if (!Array.isArray(r.goods) || !r.goods.length) errs.push('research.goods: at least one workshop good (the menus name the research by them)');
      for (const g of Array.isArray(r.goods) ? r.goods : []) {
        item(g?.item, 'research good');
        if (typeof g?.words !== 'string' || !g.words.length || g.words.length > 40) errs.push(`research good ${String(g?.item)}: words must be 1-40 characters`);
        if (typeof g?.forWhat !== 'string' || !g.forWhat.length || g.forWhat.length > 120) errs.push(`research good ${String(g?.item)}: forWhat must be 1-120 characters`);
        for (const k of ['target', 'batch', 'unit'] as const) if (!Number.isInteger(g?.[k]) || g[k] < 1 || g[k] > 64) errs.push(`research good ${String(g?.item)}: ${k} must be a whole number in 1..64`);
        for (const n of g?.allow ?? []) item(n, 'research good allow');
      }
    }
  }
  return errs;
}

/** The library's folder (server/library), from this file's place. */
export const LIBRARY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../library');

/**
 * Every valid spec in `dir` (sorted by file name), and the files dropped with their errors. A valid spec with a `research`
 * block (G6) registers its innovation entry while MC_INNOVATE is on (tech.ts) and is kept out of the specs while it is
 * off (`locked`: the village has no innovation to unlock it with, and menus stay as they were).
 */
export function loadLibrary(registry: Registry, skills: Set<string>, dir = LIBRARY_DIR): { specs: LibrarySpec[]; dropped: Array<{ file: string; why: string }>; locked: string[] } {
  const specs: LibrarySpec[] = [], dropped: Array<{ file: string; why: string }> = [], locked: string[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return { specs, dropped, locked };
  }
  const ids = new Set<string>();
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as LibrarySpec;
      const errs = validateLibrarySpec(s, { registry, skills, ids });
      if (errs.length) {
        dropped.push({ file: f, why: errs.join('; ') });
        continue;
      }
      ids.add(s.id);
      if (s.research) {
        if (!INNOVATE) {
          locked.push(s.id);
          continue;
        }
        if (!registerResearch(s)) {
          dropped.push({ file: f, why: `research entry ${s.id.slice(4)} is taken by a built-in entry` });
          continue;
        }
      }
      specs.push(s);
    } catch (e) {
      dropped.push({ file: f, why: (e as Error).message });
    }
  }
  return { specs, dropped, locked };
}
