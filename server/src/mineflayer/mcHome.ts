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
import type { DecorPart } from './mcWorld';
import type { McSkill } from './mcSkills';
import type { Counts } from './mcMaterials';
import { isDwelling } from '../grow';
import { OWN, ownOf } from '../own';
import { givePurse } from '../pay';
import { placedDoor } from '../streetPlan';
import { storageContents, withdrawItems } from './mcStorage';
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
 * chore queues next.
 */
async function shearForBed(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('shear_for_bed: not in a village');
  if ((await a.world.rcon.count(a.name, 'shears').catch(() => 0)) < 1) {
    if ((storageContents(v).shears ?? 0) < 1) throw new Error('shear_for_bed: no shears in your inventory or in storage (make_iron_tool shears makes a pair from 2 iron)');
    await withdrawItems(a, v, { shears: 1 }, signal);
    if ((await a.world.rcon.count(a.name, 'shears').catch(() => 0)) < 1) throw new ContentionError('shear_for_bed: another agent took the shears', 'taken', 'stock:shears');
  }
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

export const HOME_SKILLS: Record<string, McSkill> = {
  home_basics: { run: homeBasics },
  shear_for_bed: { run: shearForBed },
};
