/**
 * MC_HOME_BASICS (off; runs/2026-10-24/home-basics/spec.md): every member's own house gets a bed, a chest and a crafting
 * table early. The cells are buildingDecor's `basics` (streetPlan.ts), put on the house's DecorPart by mcWorld.decorParts;
 * the owner's chore (mcWorld's menu) runs home_basics here, which sets each piece by command, charged to the village
 * storage as the own chest is (mcBuild.ts placeOwnChest); a house short of wool for its bed gets shear_for_bed first (the
 * user's choice A(2), 10-24: shears made from storage's iron, then 3 wool sheared at the atlas's sheep). What a house has
 * lives on the village (`v.basics`, by structure id).
 */
import { Vec3 } from 'vec3';
import type { Village } from '../village';
import type { BotAgent } from './botAgent';
import type { DecorPart, DecorSlotY } from './mcWorld';
import { decorPicks, type DecorPlaced } from '../houseDecor';
import type { McSkill } from './mcSkills';
import type { Counts } from './mcMaterials';
import { isDwelling } from '../grow';
import { OWN, ownOf } from '../own';
import { givePurse } from '../pay';
import { placedDoor } from '../streetPlan';
import { STORAGE_SKILLS, storageContents, withdrawItems } from './mcStorage';
import { SURVIVAL_SKILLS } from './mcSurvival';
import { ContentionError, goals, syncInventory, unmoved, walk } from './mcUtil';
import { FOUNDRY as WOOL } from './foundry/wool';
import { rawSetting } from '../settings';

/** MC_HOME_BASICS: on by default since 10-24 (the user's, after test train 1); off turns it off. */
export const HOME_BASICS = { on: !/^(off|0|false|no)$/i.test(rawSetting('MC_HOME_BASICS') ?? 'on') };

export type BasicsPiece = 'table' | 'chest' | 'bed';
/** The order a chore places them in: the cheapest first, so a house short of wool still gets its table and chest. */
export const BASICS_ORDER: BasicsPiece[] = ['table', 'chest', 'bed'];

/** A house's basics cells in the world (layer 1: the structure's floor y + 1). */
export interface BasicsCells {
  bed?: { x: number; y: number; z: number; facing: string; foot: { x: number; z: number } };
  chest?: { x: number; y: number; z: number; facing: string };
  table?: { x: number; y: number; z: number };
}

/** What a house has: each piece's time and who placed it (`chest: 'own'` an own chest placed before, anywhere inside). */
export interface BasicsRecord { table?: { at: number; by: string }; chest?: { at: number; by: string }; bed?: { at: number; by: string; item?: string } }

export function basicsOf(v: Village): Record<string, BasicsRecord> {
  const r = v as Village & { basics?: Record<string, BasicsRecord> };
  return (r.basics ??= {});
}

/** The pieces a house still lacks, in BASICS_ORDER (a piece without a cell is left out: the house has no room for it). */
export function basicsLeft(v: Village, structure: string, cells: BasicsCells | undefined, hasOwnChest = false): BasicsPiece[] {
  const r = basicsOf(v)[structure] ?? {};
  return BASICS_ORDER.filter((p) => cells?.[p] && !r[p] && !(p === 'chest' && hasOwnChest));
}

const LOG = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/;

/**
 * What one piece costs from the storage `store` (the most plentiful log kind; the planks a log makes, 4, are the
 * game's): a table 1 log, a chest 2 logs, a bed a bed item from storage, else 3 wool of one colour and 1 log. Null with
 * what is short when storage cannot pay. `block` is the block to set (a bed's colour from its wool).
 */
export function basicsCost(piece: BasicsPiece, store: Counts): { take: Counts; block: string } | { short: string } {
  const log = Object.keys(store).filter((n) => LOG.test(n) && (store[n] ?? 0) >= (piece === 'chest' ? 2 : 1)).sort((p, q) => store[q] - store[p] || p.localeCompare(q))[0];
  if (piece === 'table') return log ? { take: { [log]: 1 }, block: 'crafting_table' } : { short: '1 log' };
  if (piece === 'chest') return log ? { take: { [log]: 2 }, block: 'chest' } : { short: '2 logs of one kind' };
  const bed = Object.keys(store).filter((n) => /_bed$/.test(n) && (store[n] ?? 0) >= 1).sort()[0];
  if (bed) return { take: { [bed]: 1 }, block: bed };
  const wool = Object.keys(store).filter((n) => /_wool$/.test(n) && (store[n] ?? 0) >= 3).sort((p, q) => store[q] - store[p] || p.localeCompare(q))[0];
  if (!wool) return { short: '3 wool of one colour (or a bed)' };
  if (!log) return { short: '1 log for the bed\'s planks' };
  return { take: { [wool]: 3, [log]: 1 }, block: wool.replace(/_wool$/, '_bed') };
}

/** The beds the village's owned houses still lack (the wool they want: 3 each), for the wanted list and the shearing. */
export function bedsOwed(v: Village, cellsOf: (structure: string) => BasicsCells | undefined): number {
  let n = 0;
  for (const st of v.structures) if (st.owner && cellsOf(st.id)?.bed && !basicsOf(v)[st.id]?.bed) n++;
  return n;
}

/** The option's facts: what the house has and lacks, and what storage is short of (the model's eyes, lesson s2). */
export function basicsFacts(kind: string, left: BasicsPiece[], short: string[]): string {
  const has = BASICS_ORDER.filter((p) => !left.includes(p)).map((p) => (p === 'table' ? 'a crafting table' : `a ${p}`));
  const word = (p: BasicsPiece) => (p === 'table' ? 'a crafting table' : `a ${p}`);
  return `your ${kind.replace(/_/g, ' ')} ${has.length ? `has ${has.join(' and ')}; it ` : ''}lacks ${left.map(word).join(', ')}${short.length ? ` (storage is short of ${short.join('; ')})` : ''}`;
}

// ---------------------------------------------------------------------------------------------
// The skills (chores code queues)
// ---------------------------------------------------------------------------------------------

/** The member's own house, its furnishing part and the basics' cells, or why not. */
export function homeOf(a: BotAgent): { v: Village; P: DecorPart & { basics: BasicsCells } } | string {
  const v = a.village();
  if (!v) return 'not in a village';
  const st = v.structures.find((s) => s.owner === a.name && isDwelling(s.kind));
  if (!st) return 'you have no house of your own yet';
  const P = a.world.decorParts(v).find((q) => q.structure.id === st.id) as (DecorPart & { basics?: BasicsCells }) | undefined;
  if (!P?.basics) return `your house (${st.kind}) has no cells for a bed, a chest or a table`;
  return { v, P: P as DecorPart & { basics: BasicsCells } };
}

/** To beside the house's door (two out from it), as furnishing's walks: a failed walk places from where it stands. */
async function toDoor(a: BotAgent, P: DecorPart, signal: AbortSignal): Promise<boolean> {
  const d = placedDoor(P.place);
  if (!d) return false;
  const x = d.x + 2 * d.ox, z = d.z + 2 * d.oz, y = P.structure.y + 1;
  if (a.bot.entity.position.distanceTo(new Vec3(x, y, z)) <= 3) return true;
  return walk(a, new goals.GoalNear(x, y, z, 2), 'your own door', signal, 90000, { scaffold: false }).then(() => true, (e: Error) => {
    if (e.message === 'cancelled' || unmoved(e)) throw e;
    return false;
  });
}

const key = (c: { x: number; y: number; z: number }) => `${c.x},${c.y},${c.z}`;

/** The wool colour the member carries most of, from Mineflayer's view (the menu's guess; sheared sheep are not all white). */
export function woolInHand(a: BotAgent): { item: string; n: number } | null {
  const by: Counts = {};
  for (const it of a.bot.inventory?.items() ?? []) if (/_wool$/.test(it.name)) by[it.name] = (by[it.name] ?? 0) + it.count;
  const item = Object.keys(by).sort((p, q) => by[q] - by[p] || p.localeCompare(q))[0];
  return item ? { item, n: by[item] } : null;
}

const COLOURS = ['white', 'light_gray', 'gray', 'black', 'brown', 'red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'light_blue', 'blue', 'purple', 'magenta', 'pink'];

/** woolInHand after a sync, its count confirmed on the server (lesson 4); the server's colours counted when Mineflayer's
 *  view has none of the wool the server holds (HB1: a member with 7 sheared wool read as none, then went for storage's). */
async function carriedWool(a: BotAgent): Promise<{ item: string; n: number } | null> {
  await syncInventory(a).catch(() => undefined);
  const w = woolInHand(a);
  const n = w ? await a.world.rcon.count(a.name, w.item).catch(() => w.n) : 0;
  if (w && n >= 3) return { item: w.item, n };
  if ((await a.world.rcon.count(a.name, '#minecraft:wool').catch(() => 0)) < 3) return w && n > 0 ? { item: w.item, n } : null;
  let best: { item: string; n: number } | null = null;
  for (const c of COLOURS) {
    const k = await a.world.rcon.count(a.name, `${c}_wool`).catch(() => 0);
    if (k > (best?.n ?? 0)) best = { item: `${c}_wool`, n: k };
  }
  return best;
}

/**
 * Whether a cell can take a piece: air, or a furnishing chore's piece (lesson 138: judged by the cell) taken out and its
 * spot marked never (the basics come first; a checkpoint's houses had their one chair on a basics cell, 25 of 25).
 * False when anything else stands there.
 */
async function clearCell(a: BotAgent, v: Village, P: DecorPart, c: { x: number; y: number; z: number }): Promise<boolean> {
  const air = await a.world.rcon.command(`execute if block ${c.x} ${c.y} ${c.z} minecraft:air`).catch(() => '');
  if (/passed/i.test(air)) return true;
  const r = v.decor?.[P.part];
  if (!r?.done.includes(key(c))) return false;
  await a.world.rcon.command(`setblock ${c.x} ${c.y} ${c.z} minecraft:air`).catch(() => '');
  // (a table's plate one up goes with it)
  await a.world.rcon.command(`execute if block ${c.x} ${c.y + 1} ${c.z} #minecraft:pressure_plates run setblock ${c.x} ${c.y + 1} ${c.z} minecraft:air`).catch(() => '');
  const now = await a.world.rcon.command(`execute if block ${c.x} ${c.y} ${c.z} minecraft:air`).catch(() => '');
  if (!/passed/i.test(now)) return false;
  r.done = r.done.filter((k) => k !== key(c));
  (r.never ??= []).push(key(c));
  console.log(`[home] ${v.name}: ${a.name} took the furniture at ${key(c)} out for its home basics`);
  return true;
}

/** A block set by command where no entity stands, confirmed on the server. */
async function setConfirmed(a: BotAgent, c: { x: number; y: number; z: number }, block: string): Promise<boolean> {
  await a.world.rcon.command(`execute unless entity @e[type=!item,x=${c.x},y=${c.y},z=${c.z},dx=0,dy=0,dz=0] run setblock ${c.x} ${c.y} ${c.z} minecraft:${block} keep`).catch(() => '');
  const name = block.replace(/\[.*$/, '');
  return /passed/i.test(await a.world.rcon.command(`execute if block ${c.x} ${c.y} ${c.z} minecraft:${name}`).catch(() => ''));
}

/** The own chest's items written from the record (as mcBuild's writeOwnChest: the record is the authority). */
async function writeChest(a: BotAgent, c: { x: number; y: number; z: number; items: Record<string, number> }): Promise<void> {
  const slots: string[] = [];
  for (const [n, q0] of Object.entries(c.items)) {
    let q = q0;
    const max = a.world.registry.itemsByName[n]?.stackSize ?? 64;
    while (q > 0 && slots.length < 27) {
      const k = Math.min(q, max);
      slots.push(`{Slot:${slots.length}b,id:"minecraft:${n}",count:${k}}`);
      q -= k;
    }
  }
  await a.world.rcon.command(`data modify block ${c.x} ${c.y} ${c.z} Items set value [${slots.join(',')}]`).catch(() => undefined);
}

/**
 * home_basics: the pieces the member's house lacks, as many as storage (and, for a bed, the member's own carried wool)
 * pays for, cheapest first: withdrawn in one trip, then set by command on their cells from beside the door, each
 * confirmed on the server, the items taken from the member only for a piece that went down. With MC_OWN the chest is the
 * member's own chest.
 */
async function homeBasics(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const h = homeOf(a);
  if (typeof h === 'string') throw new Error(`home_basics: ${h}`);
  const { v, P } = h, cells = P.basics, st = P.structure;
  const own = OWN.on ? ownOf(v, a.name) : undefined;
  // (an own chest placed before, MC_OWN on or not, is the house's chest: a second one went down beside it in HB1)
  const left = basicsLeft(v, st.id, cells, !!v.homes?.[a.name]?.chest);
  if (!left.length) return 'your house already has a bed, a chest and a crafting table';
  // (the bed's wool: what the member carries first, the shearing's)
  const cw = await carriedWool(a);
  const carried = cw?.n ?? 0, woolItem = cw?.item ?? 'white_wool';
  const store: Counts = { ...storageContents(v) };
  const plan: Array<{ piece: BasicsPiece; take: Counts; block: string; fromStore: Counts }> = [];
  const short: string[] = [];
  for (const piece of left) {
    const pool = piece === 'bed' && carried >= 3 ? { ...store, [woolItem]: (store[woolItem] ?? 0) + carried } : store;
    const c = basicsCost(piece, pool);
    if ('short' in c) { short.push(`${piece}: ${c.short}`); continue; }
    const fromStore: Counts = {};
    for (const [n, q] of Object.entries(c.take)) {
      const mine = n === woolItem && piece === 'bed' ? Math.min(q, carried) : 0;
      if (q - mine > 0) fromStore[n] = q - mine;
      store[n] = (store[n] ?? 0) - (q - mine);
    }
    plan.push({ piece, take: c.take, block: c.block, fromStore });
  }
  if (!plan.length) throw new Error(`home_basics: storage cannot pay for ${short.join('; ')}`);
  const want: Counts = {};
  for (const p of plan) for (const [n, q] of Object.entries(p.fromStore)) want[n] = (want[n] ?? 0) + q;
  const before: Counts = {};
  for (const n of Object.keys(want)) before[n] = await a.world.rcon.count(a.name, n).catch(() => 0);
  await withdrawItems(a, v, want, signal);
  for (const [n, q] of Object.entries(want)) {
    const have = await a.world.rcon.count(a.name, n).catch(() => 0);
    if (have - before[n] < q) throw new ContentionError(`home_basics: another agent took the ${n}`, 'taken', `stock:${n}`);
  }
  const walked = await toDoor(a, P, signal);
  const done: string[] = [], failed: string[] = [];
  const rec = (basicsOf(v)[st.id] ??= {});
  for (const p of plan) {
    const c = cells[p.piece]!;
    const at = { x: c.x, y: c.y, z: c.z };
    const foot = p.piece === 'bed' ? { x: cells.bed!.foot.x, y: c.y, z: cells.bed!.foot.z } : null;
    // (the piece already on its cell, an own chest placed before: counted, nothing taken)
    const kind = p.piece === 'bed' ? '#minecraft:beds' : p.piece === 'chest' ? 'minecraft:chest' : 'minecraft:crafting_table';
    if (/passed/i.test(await a.world.rcon.command(`execute if block ${at.x} ${at.y} ${at.z} ${kind}`).catch(() => ''))) {
      rec[p.piece] = { at: Date.now(), by: a.name };
      done.push(`${p.piece === 'table' ? 'a crafting table' : `a ${p.piece}`} (already there)`);
      continue;
    }
    // (one crafting table a house, the user's, 10-25: a table furnishing put on another of the house's cells counts)
    if (p.piece === 'table') {
      let standing = false;
      for (const k of v.decor?.[P.part]?.done ?? []) {
        const [x, y, z] = k.split(',').map(Number);
        if (/passed/i.test(await a.world.rcon.command(`execute if block ${x} ${y} ${z} minecraft:crafting_table`).catch(() => ''))) {
          standing = true;
          break;
        }
      }
      if (standing) {
        rec.table = { at: Date.now(), by: a.name };
        done.push('a crafting table (one stands in the house already)');
        continue;
      }
    }
    if (!(await clearCell(a, v, P, at)) || (foot && !(await clearCell(a, v, P, foot)))) { failed.push(`${p.piece} (its cell is not free)`); continue; }
    // (the cost taken first, as the own chest's; given back when the block did not go down)
    const took: Counts = {};
    let paid = true;
    for (const [n, q] of Object.entries(p.take)) {
      const t = await a.world.rcon.take(a.name, n, q).catch(() => 0);
      took[n] = t;
      if (t < q) paid = false;
    }
    const giveBack = async () => { for (const [n, q] of Object.entries(took)) if (q > 0) await a.world.rcon.command(`give ${a.name} minecraft:${n} ${q}`).catch(() => undefined); };
    if (!paid) { await giveBack(); failed.push(`${p.piece} (its items were not all in your inventory)`); continue; }
    let ok: boolean;
    if (p.piece === 'bed') {
      const f = (c as NonNullable<BasicsCells['bed']>).facing;
      ok = (await setConfirmed(a, foot!, `${p.block}[facing=${f},part=foot]`)) && (await setConfirmed(a, at, `${p.block}[facing=${f},part=head]`));
      if (!ok) {
        await a.world.rcon.command(`setblock ${foot!.x} ${foot!.y} ${foot!.z} minecraft:air`).catch(() => '');
        await a.world.rcon.command(`setblock ${at.x} ${at.y} ${at.z} minecraft:air`).catch(() => '');
      }
    } else ok = await setConfirmed(a, at, p.piece === 'chest' ? `chest[facing=${(c as NonNullable<BasicsCells['chest']>).facing}]` : 'crafting_table');
    if (!ok) { await giveBack(); failed.push(`${p.piece} (it did not go down)`); continue; }
    rec[p.piece] = { at: Date.now(), by: a.name, ...(p.piece === 'bed' ? { item: p.block } : {}) };
    if (p.piece === 'chest' && own && !own.chest) {
      own.chest = { x: at.x, y: at.y, z: at.z, items: {} };
      if (givePurse(v, a.name, Date.now())) await writeChest(a, own.chest);
    }
    done.push(p.piece === 'table' ? 'a crafting table' : p.piece === 'bed' ? `a ${p.block.replace(/_/g, ' ')}` : own ? 'a chest of your own' : 'a chest');
  }
  a.world.villages.save();
  const has = basicsLeft(v, st.id, cells, !!v.homes?.[a.name]?.chest);
  console.log(`[home] ${v.name}: ${a.name} put ${done.join(', ') || 'nothing'} in its house${failed.length ? `; not ${failed.join(', ')}` : ''}${short.length ? `; short: ${short.join('; ')}` : ''}${walked ? '' : ' (from where it stood)'}; ${has.length ? `lacks ${has.join(', ')}` : 'all three'}`);
  if (!done.length) throw new Error(`home_basics: nothing went down: ${failed.join('; ')}`);
  return `put ${done.join(' and ')} in your house${has.length ? `; it still lacks ${has.join(', ')}${short.length ? ` (storage is short: ${short.join('; ')})` : ''}` : ': it has a bed, a chest and a crafting table'}`;
}

// ---------------------------------------------------------------------------------------------
// #141 (MC_HOUSE_DECOR): the owner decorates its house from what the trades stocked
// ---------------------------------------------------------------------------------------------

/** The decorations placed in each house (the village's record, by structure id). */
export function houseDecorOf(v: Village): Record<string, DecorPlaced[]> {
  const r = v as Village & { houseDecor?: Record<string, DecorPlaced[]> };
  return (r.houseDecor ??= {});
}

/** A house's slots still free (its record's cells taken out). */
export function freeDecorSlots(v: Village, P: DecorPart): DecorSlotY[] {
  const placed = houseDecorOf(v)[P.structure.id] ?? [];
  return (P.slots ?? []).filter((s) => !placed.some((q) => q.x === s.x && q.y === s.y && q.z === s.z));
}

/**
 * decorate_home: up to 2 decorations for the member's own house (decorPicks: the kinds it lacks first, in its taste's
 * order and colour, each with a free slot and storage's stock to pay), withdrawn in one trip, then set by command on their
 * slots from beside the door, each confirmed on the server, the items taken from the member only for a piece that went
 * down. A slot something else stands in is skipped.
 */
async function decorateHome(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('decorate_home: not in a village');
  const st = v.structures.find((s) => s.owner === a.name && isDwelling(s.kind));
  if (!st) throw new Error('decorate_home: you have no house of your own yet');
  const P = a.world.decorParts(v).find((q) => q.structure.id === st.id);
  if (!P?.slots?.length) throw new Error(`decorate_home: your house (${st.kind}) has no room for decorations`);
  const free = freeDecorSlots(v, P);
  if (!free.length) return 'every decoration slot of your house is taken';
  const rec = (houseDecorOf(v)[st.id] ??= []);
  const picks = decorPicks(a.name, free, rec, storageContents(v));
  if (!picks.length) throw new Error('decorate_home: storage holds no decoration your house has room for (the trades make carpets, banners, flower pots, candles and lanterns)');
  const want: Counts = {};
  for (const p of picks) for (const [n, q] of Object.entries(p.cost.take)) want[n] = (want[n] ?? 0) + q;
  const before: Counts = {};
  for (const n of Object.keys(want)) before[n] = await a.world.rcon.count(a.name, n).catch(() => 0);
  await withdrawItems(a, v, want, signal).catch((e: Error) => { if (e.message === 'cancelled') throw e; });
  // (what came is placed; a pick whose items another owner took first is skipped below: H141G's owners failed whole
  // chores 14 times on one banner)
  let got = 0;
  for (const n of Object.keys(want)) got += Math.max(0, (await a.world.rcon.count(a.name, n).catch(() => 0)) - before[n]);
  if (!got) throw new ContentionError(`decorate_home: another agent took the ${Object.keys(want).join(' and ')}`, 'taken', `stock:${Object.keys(want)[0]}`);
  const walked = await toDoor(a, P, signal);
  const done: string[] = [], failed: string[] = [];
  for (const p of picks) {
    const at = { x: p.slot.x, y: (p.slot as DecorSlotY).y, z: p.slot.z };
    if (!/passed/i.test(await a.world.rcon.command(`execute if block ${at.x} ${at.y} ${at.z} minecraft:air`).catch(() => ''))) { failed.push(`${p.kind} (its cell is not free)`); continue; }
    const took: Counts = {};
    let paid = true;
    for (const [n, q] of Object.entries(p.cost.take)) {
      const t = await a.world.rcon.take(a.name, n, q).catch(() => 0);
      took[n] = t;
      if (t < q) paid = false;
    }
    const giveBack = async () => { for (const [n, q] of Object.entries(took)) if (q > 0) await a.world.rcon.command(`give ${a.name} minecraft:${n} ${q}`).catch(() => undefined); };
    if (!paid) { await giveBack(); failed.push(`${p.kind} (its items were not all in your inventory)`); continue; }
    if (!(await setConfirmed(a, at, p.cost.block))) { await giveBack(); failed.push(`${p.kind} (it did not go down)`); continue; }
    rec.push({ ...at, kind: p.kind, block: p.cost.block.replace(/\[.*$/, ''), at: Date.now(), by: a.name });
    done.push(p.cost.block.replace(/\[.*$/, '').replace(/_/g, ' '));
  }
  a.world.villages.save();
  const left = freeDecorSlots(v, P).length;
  console.log(`[decor] ${v.name}: ${a.name} put ${done.join(', ') || 'nothing'} in its house${failed.length ? `; not ${failed.join(', ')}` : ''}${walked ? '' : ' (from where it stood)'}; ${rec.length} placed, ${left} slots free`);
  if (!done.length) throw new Error(`decorate_home: nothing went down: ${failed.join('; ')}`);
  return `put ${done.join(' and ')} in your house (${rec.length} decorations; room for ${left} more)`;
}

// ---------------------------------------------------------------------------------------------
// MC_HOME_FLOORS: the owner lays the floor its house was built without (the user's 11-15)
// ---------------------------------------------------------------------------------------------

/** A house's laid floor (the village's `homeFloors`, by structure id). */
export interface FloorRecord { at: number; by: string; block: string; n: number }

/** The village's laid floors, read only. */
export function floorsOf(v: Village): Readonly<Record<string, FloorRecord>> {
  return (v as Village & { homeFloors?: Record<string, FloorRecord> }).homeFloors ?? NO_FLOORS;
}
const NO_FLOORS: Readonly<Record<string, FloorRecord>> = Object.freeze({});

/** A house's own wood (its style's, else its design name's "@wood"). */
export function homeWood(P: DecorPart): string | undefined {
  const d = P.place.design;
  return (d.style as { wood?: string } | undefined)?.wood ?? /@(\w+)$/.exec(d.name)?.[1];
}

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak'];

/**
 * What a floor of `n` cells costs from storage `store`: planks of the house's own wood, else its logs (4 planks a log),
 * else the most plentiful wood's planks or logs. The planks block it lays, or what is short.
 */
export function floorCost(n: number, wood: string | undefined, store: Counts): { take: Counts; block: string } | { short: string } {
  const woods = [...(wood && WOODS.includes(wood) ? [wood] : []), ...WOODS.filter((w) => w !== wood).sort((p, q) => ((store[`${q}_planks`] ?? 0) + 4 * (store[`${q}_log`] ?? 0)) - ((store[`${p}_planks`] ?? 0) + 4 * (store[`${p}_log`] ?? 0)))];
  for (const w of woods) {
    if ((store[`${w}_planks`] ?? 0) >= n) return { take: { [`${w}_planks`]: n }, block: `${w}_planks` };
    if ((store[`${w}_log`] ?? 0) * 4 >= n) return { take: { [`${w}_log`]: Math.ceil(n / 4) }, block: `${w}_planks` };
  }
  return { short: `${n} planks (or ${Math.ceil(n / 4)} logs of one wood)` };
}

/** What a floor may go over: the ground left inside (grass, dirt, path, gravel, sand, the prepared ground's cobblestone
 *  patches); never a block the village placed there on purpose, nor a hole a member may stand in (lesson 44). */
const FLOOR_OVER = ['#minecraft:dirt', 'minecraft:dirt_path', 'minecraft:farmland', 'minecraft:cobblestone', 'minecraft:gravel', '#minecraft:sand'];

/**
 * lay_home_floor: the member's own house's bare cells (DecorPart.bare, the floor layer at the structure's y) laid with
 * planks of its wood: withdrawn in one trip, set by command (a fill a row span and a ground kind), each cell confirmed on
 * the server, and only the planks laid taken from the member (a log for 4). Recorded once laid (9 in 10 cells or more).
 */
async function layHomeFloor(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('lay_home_floor: not in a village');
  const st = v.structures.find((s) => s.owner === a.name && isDwelling(s.kind));
  if (!st) throw new Error('lay_home_floor: you have no house of your own yet');
  if (floorsOf(v)[st.id]) return 'your house has its floor already';
  const P = a.world.decorParts(v).find((q) => q.structure.id === st.id);
  const cells = P?.bare ?? [];
  if (!P || !cells.length) return `your house (${st.kind}) has a floor`;
  const c = floorCost(cells.length, homeWood(P), storageContents(v));
  if ('short' in c) throw new Error(`lay_home_floor: storage is short of ${c.short}`);
  const [item, q] = Object.entries(c.take)[0];
  const before = await a.world.rcon.count(a.name, item).catch(() => 0);
  await withdrawItems(a, v, { [item]: q }, signal).catch((e: Error) => { if (e.message === 'cancelled') throw e; });
  const have = (await a.world.rcon.count(a.name, item).catch(() => 0)) - before;
  const perItem = /_log$/.test(item) ? 4 : 1;
  if (have * perItem < cells.length) throw new ContentionError(`lay_home_floor: another agent took the ${item}`, 'taken', `stock:${item}`);
  const walked = await toDoor(a, P, signal);
  const y = st.y;
  const floored = async () => {
    let n = 0;
    for (const q of cells) if (/passed/i.test(await a.world.rcon.command(`execute if block ${q.x} ${y} ${q.z} minecraft:${c.block}`).catch(() => ''))) n++;
    return n;
  };
  const already = await floored();
  // (row spans of the cells, each filled over the ground kinds in turn)
  const rows = new Map<number, number[]>();
  for (const q of cells) (rows.get(q.z) ?? rows.set(q.z, []).get(q.z)!).push(q.x);
  for (const [z, xs] of rows) {
    xs.sort((p, q) => p - q);
    for (let i = 0; i < xs.length; ) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      for (const over of FLOOR_OVER) {
        if (signal.aborted) throw new Error('cancelled');
        await a.world.rcon.command(`fill ${xs[i]} ${y} ${z} ${xs[j]} ${y} ${z} minecraft:${c.block} replace ${over}`).catch(() => '');
      }
      i = j + 1;
    }
  }
  const laid = await floored(), fresh = Math.max(0, laid - already);
  // (the planks laid taken from the member, a log for 4; the rest stays carried, deposited as any carried stock)
  const cost = Math.min(have, Math.ceil(fresh / perItem));
  if (cost > 0) await a.world.rcon.take(a.name, item, cost).catch(() => 0);
  // (recorded once anything is down: a cell holding something else is left as it is, never laid again and again)
  if (laid) {
    ((v as Village & { homeFloors?: Record<string, FloorRecord> }).homeFloors ??= {})[st.id] = { at: Date.now(), by: a.name, block: c.block, n: laid };
    a.world.villages.save();
  }
  console.log(`[home] ${v.name}: ${a.name} laid ${fresh} ${c.block} in its house's floor (${laid} of ${cells.length} cells floored; ${cost} ${item})${walked ? '' : ' (from where it stood)'}`);
  if (!laid) throw new Error(`lay_home_floor: no ${c.block} went down (the cells hold something else)`);
  return `laid ${fresh} ${c.block.replace(/_/g, ' ')} as your house's floor${laid < cells.length ? ` (${cells.length - laid} cells hold something else)` : ''}`;
}

/** The atlas's sheep place for the village (the wool skill's own pick: the biggest recent cluster near the hut), or why none. */
export function sheepPlace(a: BotAgent, v: Village): { x: number; y: number; z: number } | string {
  const h = v.storageHut;
  const y = v.storage?.chests[0]?.y ?? v.plots[0]?.y ?? 64;
  const hut = h ? { x: Math.floor((h.x1 + h.x2) / 2), y, z: Math.floor((h.z1 + h.z2) / 2) } : null;
  const p = WOOL.activity!.place({ village: v, agent: a, hut });
  if ('why' in p) return String(p.why);
  return { x: Number(p.x), y: Number(p.y), z: Number(p.z) };
}

/**
 * shear_for_bed: shears from the member's inventory or storage (the chore puts make_iron_tool shears first when storage
 * has none), then 3 wool sheared at the atlas's sheep (shear_sheep_at); the wool stays in hand for home_basics, which the
 * chore queues next. Shears taken from storage go back to it at the end (a tool, kept by `deposit all`: test train's PF0b
 * had storage's 3 pairs gone with three members after their beds, and no sheep pen could be sheared; lesson 112).
 */
async function shearForBed(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('shear_for_bed: not in a village');
  let borrowed = false;
  try {
    const held = async () => (await a.world.rcon.count(a.name, 'shears').catch(() => 0)) >= 1;
    if (!(await held())) {
      if ((storageContents(v).shears ?? 0) >= 1) await withdrawItems(a, v, { shears: 1 }, signal).catch((e: Error) => { if (e.message === 'cancelled') throw e; });
      // (#141's A/B: one pair in storage for many beds gave 17 "another agent took the shears" a run, and 4 of 12 beds
      // never came: a member finding none makes a pair from 2 of storage's iron, and it goes to storage after, one more pair)
      if (!(await held()) && (storageContents(v).iron_ingot ?? 0) >= 2) {
        await withdrawItems(a, v, { iron_ingot: 2 }, signal);
        await SURVIVAL_SKILLS.craft.run(a, { item: 'shears', count: 1 }, signal).catch((e: Error) => { if (e.message === 'cancelled') throw e; });
      }
      if (!(await held())) {
        if ((storageContents(v).shears ?? 0) < 1 && (storageContents(v).iron_ingot ?? 0) < 2) throw new Error('shear_for_bed: no shears in your inventory or in storage, and no 2 iron to make a pair');
        throw new ContentionError('shear_for_bed: another agent took the shears', 'taken', 'stock:shears');
      }
      borrowed = true;
    }
    return await shearWool(a, v, signal);
  } finally {
    // (and a pair the member made or held when storage has none: H141D3's Mayor kept the village's only pair, 1 bed of 12)
    if ((borrowed || (storageContents(v).shears ?? 0) < 1) && !signal.aborted && (await a.world.rcon.count(a.name, 'shears').catch(() => 0)) > 0)
      await STORAGE_SKILLS.deposit.run(a, { item: 'shears' }, signal).catch(() => '');
  }
}

/** shear_for_bed's shearing, with shears in hand. */
async function shearWool(a: BotAgent, v: Village, signal: AbortSignal): Promise<string> {
  const have = (await carriedWool(a))?.n ?? 0;
  if (have >= 3) return `you already carry ${have} wool of one colour for your bed`;
  const at = sheepPlace(a, v);
  if (typeof at === 'string') throw new Error(`shear_for_bed: ${at}`);
  // (a bed takes 3 of one colour and a sheep gives 1-3 of its own: up to 6 sheared, for mixed colours)
  const msg = await WOOL.skill.run(a, { ...at, count: 6, radius: 24 }, signal);
  const now = await carriedWool(a);
  console.log(`[home] ${v.name}: ${a.name} sheared for its bed at ${at.x},${at.z}: ${now ? `${now.n} ${now.item}` : 'no wool'} in hand`);
  if (!now || now.n < 3) throw new Error(`shear_for_bed: ${now?.n ?? 0} of 3 wool of one colour after shearing (${String(msg ?? '').slice(0, 120)})`);
  return `sheared wool for your bed: ${now.n} ${now.item} (${String(msg ?? '').slice(0, 100)})`;
}

/**
 * shear_for_yard (MC_TALK_BIG, askedWork.ts): `count` white wool (up to 32) for a person's requested work, sheared at the
 * atlas's sheep with shears from the member's hands or storage, or made from 2 of storage's iron; the chore's deposit
 * takes the wool to the yard. Shears borrowed go back to storage. Other colours sheared stay in storage for beds.
 */
async function shearForYard(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('shear_for_yard: not in a village');
  const want = Math.max(1, Math.min(32, Math.floor(Number(args.count ?? 16)) || 16));
  const held = async () => (await a.world.rcon.count(a.name, 'shears').catch(() => 0)) >= 1;
  let borrowed = false;
  try {
    if (!(await held())) {
      if ((storageContents(v).shears ?? 0) >= 1) await withdrawItems(a, v, { shears: 1 }, signal).catch((e: Error) => { if (e.message === 'cancelled') throw e; });
      if (!(await held()) && (storageContents(v).iron_ingot ?? 0) >= 2) {
        await withdrawItems(a, v, { iron_ingot: 2 }, signal);
        await SURVIVAL_SKILLS.craft.run(a, { item: 'shears', count: 1 }, signal).catch((e: Error) => { if (e.message === 'cancelled') throw e; });
      }
      if (!(await held())) throw new Error('shear_for_yard: no shears in your inventory or in storage, and no 2 iron to make a pair');
      borrowed = true;
    }
    const at = sheepPlace(a, v);
    if (typeof at === 'string') throw new Error(`shear_for_yard: ${at}`);
    const before = await a.world.rcon.count(a.name, 'white_wool').catch(() => 0);
    const msg = await WOOL.skill.run(a, { ...at, count: want, radius: 32 }, signal);
    const got = (await a.world.rcon.count(a.name, 'white_wool').catch(() => 0)) - before;
    console.log(`[asked] ${v.name}: ${a.name} sheared ${got} white wool at ${at.x},${at.z} for the requested work`);
    if (got < 1) throw new Error(`shear_for_yard: no white wool sheared (${String(msg ?? '').slice(0, 120)})`);
    return `sheared ${got} white wool for the requested work (${String(msg ?? '').slice(0, 100)})`;
  } finally {
    if ((borrowed || (storageContents(v).shears ?? 0) < 1) && !signal.aborted && (await a.world.rcon.count(a.name, 'shears').catch(() => 0)) > 0)
      await STORAGE_SKILLS.deposit.run(a, { item: 'shears' }, signal).catch(() => '');
  }
}

export const HOME_SKILLS: Record<string, McSkill> = {
  home_basics: { run: homeBasics },
  decorate_home: { run: decorateHome },
  lay_home_floor: { run: layHomeFloor },
  shear_for_bed: { run: shearForBed },
  shear_for_yard: { run: shearForYard },
};
