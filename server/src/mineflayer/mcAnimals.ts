/**
 * Animal skills in real Minecraft: shearing sheep for wool (for beds and furniture, without hurting the sheep or
 * touching any block).
 */
import { Vec3 } from 'vec3';
import type { Entity } from 'prismarine-entity';
import type { BotAgent } from './botAgent';
import type { McSkill } from './mcSkills';
import { at, checkAbort, countItem, goals, itemId, num, reach, sleep, syncInventory, walk } from './mcUtil';

/** Guard against stubs or partial entities from Mineflayer (lesson 104). */
function validPos(p: unknown): p is Vec3 {
  return !!p && typeof (p as Vec3).x === 'number' && Number.isFinite((p as Vec3).x)
    && typeof (p as Vec3).y === 'number' && Number.isFinite((p as Vec3).y)
    && typeof (p as Vec3).z === 'number' && Number.isFinite((p as Vec3).z);
}

/** Indices of `baby` and `wool` in sheep entity metadata from the version's registry (16 and 18 on 26.1). */
function sheepMetaKeys(a: BotAgent): { baby: number; wool: number } {
  const keys = a.bot.registry?.entitiesByName?.sheep?.metadataKeys;
  const baby = Array.isArray(keys) ? keys.indexOf('baby') : -1;
  const wool = Array.isArray(keys) ? keys.indexOf('wool') : -1;
  return { baby: baby >= 0 ? baby : 16, wool: wool >= 0 ? wool : 18 };
}

function isSheep(e: Entity | null | undefined): e is Entity {
  return !!e && e.isValid !== false && (e.name === 'sheep' || e.name === 'Sheep') && validPos(e.position);
}

function isBabySheep(a: BotAgent, e: Entity): boolean {
  const m = e?.metadata;
  if (!m || typeof m !== 'object') return false;
  const { baby } = sheepMetaKeys(a);
  const v = (m as Record<number, unknown>)[baby];
  return v === true || v === 1;
}

/** Sheep wool byte: bit 0x10 is the sheared flag, bits 0x0f are the fleece colour. */
function isShearedSheep(a: BotAgent, e: Entity): boolean {
  const m = e?.metadata;
  if (!m || typeof m !== 'object') return false;
  const { wool } = sheepMetaKeys(a);
  const v = (m as Record<number, unknown>)[wool];
  return typeof v === 'number' ? (v & 0x10) !== 0 : v === true;
}

/** Count wool of any colour on the server (`clear <name> #minecraft:wool 0`). */
async function serverWool(a: BotAgent, fallback = 0): Promise<number> {
  const n = await a.world.rcon.count(a.name, '#minecraft:wool').catch(() => -1);
  return n >= 0 ? n : fallback;
}

/** Whether the bot still has shears on the server (syncing Mineflayer's inventory when needed). */
async function hasShears(a: BotAgent): Promise<boolean> {
  const id = itemId(a, 'shears');
  if (id === undefined) return false;
  const srv = await a.world.rcon.count(a.name, 'minecraft:shears').catch(() => -1);
  if (srv === 0) return false;
  if (countItem(a, id) === 0 && a.bot.heldItem?.type !== id) await syncInventory(a).catch(() => {});
  return srv > 0 || countItem(a, id) > 0 || a.bot.heldItem?.type === id;
}

/** Walk near a point without digging or placing any block. */
async function walkNoDig(a: BotAgent, pos: Vec3, range: number, target: string, signal: AbortSignal, timeoutMs = 15000) {
  if (validPos(a.bot.entity?.position) && a.bot.entity.position.distanceTo(pos) <= range) return;
  const mv = a.moves();
  const saved = { canDig: mv.canDig, scafoldingBlocks: mv.scafoldingBlocks, allow1by1towers: mv.allow1by1towers };
  Object.assign(mv, { canDig: false, scafoldingBlocks: [], allow1by1towers: false });
  try {
    if (range <= 1) await walk(a, new goals.GoalNear(pos.x, pos.y, pos.z, range), target, signal, timeoutMs, { scaffold: false });
    else await reach(a, pos, range, signal, timeoutMs);
  } finally {
    Object.assign(mv, saved);
  }
}

/** Walk to the wool item entities that just dropped near `pos` and pick them up. */
async function pickUpWool(a: BotAgent, pos: Vec3, signal: AbortSignal) {
  const bot = a.bot;
  const t0 = Date.now();
  const attempts = new Map<number, number>();
  await sleep(400, signal);
  while (Date.now() - t0 < 6000) {
    checkAbort(signal);
    const botPos = bot.entity?.position;
    if (!validPos(botPos)) return;
    const drops = Object.values(bot.entities ?? {}).filter((e): e is Entity => {
      if (!e || e.isValid === false || (attempts.get(e.id) ?? 0) >= 2 || !validPos(e.position)) return false;
      if (e.name !== 'item' && e.name !== 'Item' && e.name !== 'item_stack') return false;
      if (e.position.distanceTo(pos) > 6 && e.position.distanceTo(botPos) > 6) return false;
      try {
        const item = e.getDroppedItem?.() as { name?: string; type?: number } | null;
        const name = item?.name || (typeof item?.type === 'number' ? a.world.registry.items[item.type]?.name : undefined);
        if (name && !name.endsWith('_wool')) return false;
      } catch { /* metadata may not be decoded yet */ }
      return true;
    });
    if (!drops.length) return;
    drops.sort((u, v) => u.position.distanceTo(botPos) - v.position.distanceTo(botPos));
    const drop = drops[0];
    attempts.set(drop.id, (attempts.get(drop.id) ?? 0) + 1);
    try {
      await walkNoDig(a, drop.position.clone(), 0.5, 'dropped wool', signal, 5000);
    } catch (err) {
      if ((err as Error).message === 'cancelled') throw err;
      attempts.set(drop.id, 2);
    }
    await sleep(300, signal);
  }
}

/**
 * shear_sheep: find adult, unsheared sheep within `radius`, walk to each without digging or placing any block, equip
 * shears and right-click the sheep (`bot.activateEntity`), then pick up the dropped wool until `count` wool is
 * gathered on the server (`#minecraft:wool`), no shearable sheep remains in range, or the shears break.
 */
async function shearSheep(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const want = Math.max(1, Math.min(32, Math.floor(args.count !== undefined ? num(args.count, 'count') : 3)));
  const radius = Math.max(1, Math.min(48, args.radius !== undefined ? num(args.radius, 'radius') : 24));
  const bot = a.bot;
  if (!validPos(bot.entity?.position)) throw new Error('bot is not spawned in the world yet');
  const startPos = bot.entity.position.clone();

  const shearsId = itemId(a, 'shears');
  if (shearsId === undefined || !(await hasShears(a))) {
    throw new Error('no shears in inventory; craft them from 2 iron ingots, or make_iron_tool shears');
  }

  const inRange = (e: Entity): boolean =>
    validPos(e.position) && (
      e.position.distanceTo(startPos) <= radius ||
      (validPos(bot.entity?.position) && e.position.distanceTo(bot.entity.position) <= radius)
    );

  const seenSheep = new Set<number>();
  const tried = new Set<number>();
  const scanShearable = (): Entity[] => {
    const curPos = validPos(bot.entity?.position) ? bot.entity.position : startPos;
    const out: Entity[] = [];
    for (const e of Object.values(bot.entities ?? {})) {
      if (!isSheep(e) || !inRange(e)) continue;
      seenSheep.add(e.id);
      if (tried.has(e.id) || isBabySheep(a, e) || isShearedSheep(a, e)) continue;
      out.push(e);
    }
    return out.sort((u, v) => u.position.distanceTo(curPos) - v.position.distanceTo(curPos));
  };

  const startWool = await serverWool(a, 0);
  let haveWool = startWool;
  let shearedCount = 0;
  let lastPos = startPos.clone();
  let shearsBroke = false;

  const mv = a.moves();
  const savedMoves = { canDig: mv.canDig, scafoldingBlocks: mv.scafoldingBlocks, allow1by1towers: mv.allow1by1towers };
  Object.assign(mv, { canDig: false, scafoldingBlocks: [], allow1by1towers: false });
  try {
    while (haveWool - startWool < want) {
      checkAbort(signal);
      if (shearedCount > 0 && !(await hasShears(a))) {
        shearsBroke = true;
        break;
      }
      const candidates = scanShearable();
      if (!candidates.length) break;
      const target = candidates[0];
      tried.add(target.id);

      // Walk near the sheep; if it wanders while we approach, step closer once more
      try {
        await walkNoDig(a, target.position.clone(), 2, 'sheep', signal, 15000);
      } catch (err) {
        if ((err as Error).message === 'cancelled') throw err;
      }
      let live = bot.entities?.[target.id];
      if (!isSheep(live) || isBabySheep(a, live) || isShearedSheep(a, live)) continue;
      if (validPos(bot.entity?.position) && bot.entity.position.distanceTo(live.position) > 2.8) {
        try {
          await walkNoDig(a, live.position.clone(), 1.8, 'sheep', signal, 10000);
        } catch (err) {
          if ((err as Error).message === 'cancelled') throw err;
        }
      }
      live = bot.entities?.[target.id];
      if (!isSheep(live) || isBabySheep(a, live) || isShearedSheep(a, live)) continue;
      if (!validPos(bot.entity?.position) || bot.entity.position.distanceTo(live.position) > 3.8) continue;

      if (!(await hasShears(a))) {
        shearsBroke = true;
        break;
      }
      if (bot.heldItem?.type !== shearsId) {
        try {
          await bot.equip(shearsId, 'hand');
        } catch {
          await syncInventory(a).catch(() => {});
          if (!(await hasShears(a))) {
            shearsBroke = true;
            break;
          }
          await bot.equip(shearsId, 'hand').catch(() => {});
        }
      }

      checkAbort(signal);
      live = bot.entities?.[target.id];
      if (!isSheep(live)) continue;
      const h = typeof live.height === 'number' && Number.isFinite(live.height) ? live.height : 1.3;
      const shearSpot = live.position.clone();
      await bot.lookAt(live.position.offset(0, h * 0.5, 0), true).catch(() => {});
      await bot.activateEntity(live);

      // If the sheep moved just as we clicked and is still unsheared with no drop, try one closer click
      await sleep(300, signal);
      live = bot.entities?.[target.id];
      const dropNear = Object.values(bot.entities ?? {}).some(
        (e) => !!e && e.isValid !== false && (e.name === 'item' || e.name === 'Item') && validPos(e.position) && e.position.distanceTo(shearSpot) < 4,
      );
      if (isSheep(live) && !isShearedSheep(a, live) && !dropNear && validPos(bot.entity?.position) && bot.entity.position.distanceTo(live.position) <= 3.8) {
        try {
          await walkNoDig(a, live.position.clone(), 1.4, 'sheep', signal, 6000);
        } catch (err) {
          if ((err as Error).message === 'cancelled') throw err;
        }
        live = bot.entities?.[target.id];
        if (isSheep(live) && !isShearedSheep(a, live) && validPos(bot.entity?.position) && bot.entity.position.distanceTo(live.position) <= 3.5) {
          await bot.lookAt(live.position.offset(0, h * 0.5, 0), true).catch(() => {});
          await bot.activateEntity(live);
        }
      }

      const dropCenter = isSheep(live) ? live.position.clone() : shearSpot;
      await pickUpWool(a, dropCenter, signal);
      let afterWool = await serverWool(a, haveWool);
      if (afterWool <= haveWool) {
        try {
          await walkNoDig(a, dropCenter, 0.5, 'dropped wool', signal, 4000);
        } catch (err) {
          if ((err as Error).message === 'cancelled') throw err;
        }
        await sleep(300, signal);
        await pickUpWool(a, dropCenter, signal);
        afterWool = await serverWool(a, haveWool);
      }
      if (afterWool > haveWool) {
        shearedCount++;
        lastPos = dropCenter;
        haveWool = afterWool;
      }
    }
  } finally {
    Object.assign(mv, savedMoves);
    bot.pathfinder.setGoal(null);
    await syncInventory(a).catch(() => {});
  }

  const got = Math.max(0, haveWool - startWool);
  if (got === 0) {
    if (shearsBroke) {
      throw new Error('shears broke before gathering any wool; craft them from 2 iron ingots, or make_iron_tool shears');
    }
    if (seenSheep.size === 0) {
      throw new Error(`no sheep within ${radius} blocks of ${at(startPos)}; try explore to find sheep or check a pen`);
    }
    throw new Error(
      `no shearable sheep within ${radius} blocks of ${at(startPos)} (all ${seenSheep.size} sheep are already sheared or lambs; wool regrows when sheep eat grass, try later)`,
    );
  }

  const leftInRange = Object.values(bot.entities ?? {}).filter(
    (e) => isSheep(e) && inRange(e) && !isBabySheep(a, e) && !isShearedSheep(a, e) && !tried.has(e.id),
  ).length;
  return `sheared ${got} wool from ${shearedCount} sheep at ${at(lastPos)} (${leftInRange} shearable sheep left within ${radius} blocks${shearsBroke ? '; shears broke' : ''})`;
}

export const ANIMAL_SKILLS: Record<string, McSkill> = {
  shear_sheep: {
    check: (x) => {
      if (x.count !== undefined) num(x.count, 'count');
      if (x.radius !== undefined) num(x.radius, 'radius');
    },
    run: shearSheep,
  },
};
