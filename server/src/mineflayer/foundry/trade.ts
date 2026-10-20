/**
 * Foundry skill `trade`: trade with the village's merchant at its market stall by server command (spec_shop_v2).
 * Sells village surplus for emeralds (`dir: 'sell'`, `lib:sell`) or buys goods a peaceful world lacks (`dir: 'buy'`,
 * `lib:buy`), without opening villager windows or digging/placing blocks.
 */
import { Vec3 } from 'vec3';
import type { BotAgent } from '../botAgent';
import type { FoundryPick, FoundryPlaceCtx, FoundrySkill } from './types';
import { BUYS, MERCHANT_TAG, OFFERS, SELLS, villageTag } from '../../merchant';
import { LIBRARY_KEEP } from '../../library';
import { checkAbort, goals, num, reach, str, syncInventory, walk } from '../mcUtil';

function clock(t: unknown): string {
  const ms = typeof t === 'number' && Number.isFinite(t) ? t : Date.now();
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function keepOf(item: string): number {
  return item === 'fishing_rod' ? 2 : LIBRARY_KEEP;
}

/** Walk within 3 blocks of the merchant's cell without digging or placing any block (lessons 30, 31). */
async function walkToStall(a: BotAgent, target: Vec3, signal: AbortSignal): Promise<void> {
  const pos = a.bot?.entity?.position;
  if (pos && Math.hypot(pos.x - (target.x + 0.5), pos.z - (target.z + 0.5)) <= 3 && Math.abs(pos.y - target.y) <= 2) {
    return;
  }
  const mv = typeof a.moves === 'function' ? a.moves() : undefined;
  const prevDig = mv?.canDig;
  const prevScaf = mv?.scafoldingBlocks;
  const prevTowers = mv?.allow1by1towers;
  if (mv) {
    mv.canDig = false;
    mv.scafoldingBlocks = [];
    mv.allow1by1towers = false;
  }
  try {
    try {
      await reach(a, target, 3, signal);
    } catch (e) {
      if ((e as Error)?.message === 'cancelled' || signal.aborted) throw e;
      await walk(a, new goals.GoalNearXZ(target.x, target.z, 3), `${target.x},${target.z}`, signal, 25000);
    }
  } finally {
    if (mv) {
      if (prevDig !== undefined) mv.canDig = prevDig;
      if (prevScaf !== undefined) mv.scafoldingBlocks = prevScaf;
      if (prevTowers !== undefined) mv.allow1by1towers = prevTowers;
    }
  }
}

export const FOUNDRY: FoundrySkill = {
  name: 'trade',
  skill: {
    check: (args) => {
      const q = args && typeof args === 'object' ? args : {};
      str(q.item, 'item');
      const dir = str(q.dir, 'dir').toLowerCase();
      if (dir !== 'sell' && dir !== 'buy') {
        throw new Error("dir must be 'sell' or 'buy'");
      }
      if (q.times !== undefined) {
        const t = num(q.times, 'times');
        if (!Number.isInteger(t) || t < 1 || t > 8) {
          throw new Error('times must be an integer 1..8');
        }
      }
      if (q.x !== undefined) num(q.x, 'x');
      if (q.y !== undefined) num(q.y, 'y');
      if (q.z !== undefined) num(q.z, 'z');
    },

    async run(a, args, signal) {
      checkAbort(signal);
      const q = args && typeof args === 'object' ? args : {};
      const item = str(q.item, 'item').toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_');
      const dir = str(q.dir, 'dir').toLowerCase();
      if (dir !== 'sell' && dir !== 'buy') {
        throw new Error("dir must be 'sell' or 'buy'");
      }
      const timesRaw = q.times !== undefined ? num(q.times, 'times') : 1;
      const times = Math.max(1, Math.min(8, Math.floor(timesRaw)));

      const v = typeof a?.village === 'function' ? a.village() : undefined;
      const m = v?.merchant;
      if (!v || !m || typeof m !== 'object') {
        throw new Error('no merchant in this village: a market stall must stand first');
      }
      if (!Array.isArray(m.uses)) m.uses = [];
      if (!m.ledger || typeof m.ledger !== 'object') m.ledger = {};

      const mx = q.x !== undefined ? Math.floor(num(q.x, 'x')) : typeof m.x === 'number' && Number.isFinite(m.x) ? Math.floor(m.x) : NaN;
      const my = q.y !== undefined ? Math.floor(num(q.y, 'y')) : typeof m.y === 'number' && Number.isFinite(m.y) ? Math.floor(m.y) : NaN;
      const mz = q.z !== undefined ? Math.floor(num(q.z, 'z')) : typeof m.z === 'number' && Number.isFinite(m.z) ? Math.floor(m.z) : NaN;
      if (!Number.isFinite(mx) || !Number.isFinite(my) || !Number.isFinite(mz)) {
        throw new Error('no merchant in this village: a market stall must stand first');
      }

      const offerDir = dir === 'sell' ? 'buys' : 'sells';
      const index = OFFERS.findIndex((o) => o.item === item && o.dir === offerDir);
      if (index < 0) {
        const buysList = BUYS.map((o) => `${o.n} ${o.item} for ${o.emeralds} emerald`).join(', ');
        const sellsList = SELLS.map((o) => `${o.n} ${o.item} for ${o.emeralds} emerald`).join(', ');
        throw new Error(
          `the merchant does not ${dir} ${item}: it buys ${buysList}; it sells ${sellsList}. Withdraw or bring one of those items to trade`,
        );
      }
      const offer = OFFERS[index];

      const used = typeof m.uses[index] === 'number' && Number.isFinite(m.uses[index]) ? m.uses[index] : 0;
      const stockLeft = offer.stock - used;
      if (stockLeft < times) {
        throw new Error(
          `the merchant has only ${Math.max(0, stockLeft)} left of that offer until its restock at ${clock(m.restockAt)}`,
        );
      }

      await walkToStall(a, new Vec3(mx, my, mz), signal);
      checkAbort(signal);

      const rcon = a.world?.rcon;
      if (!rcon || typeof rcon.command !== 'function') {
        throw new Error('the merchant is not at its stall (it comes back within a minute)');
      }
      const vtag = villageTag(v.name ?? '');
      const seen = await rcon.command(
        `execute if entity @e[type=minecraft:villager,tag=${MERCHANT_TAG},tag=${vtag},x=${mx},y=${my},z=${mz},distance=..4]`,
      );
      if (!/passed/i.test(String(seen ?? ''))) {
        throw new Error('the merchant is not at its stall (it comes back within a minute)');
      }

      const inputItem = dir === 'sell' ? offer.item : 'emerald';
      const need = dir === 'sell' ? offer.n * times : offer.emeralds * times;
      const outputItem = dir === 'sell' ? 'emerald' : offer.item;
      const outputCount = dir === 'sell' ? offer.emeralds * times : offer.n * times;

      const before = await rcon.count(a.name, inputItem);
      if (before === null || before < need) {
        throw new Error(`has ${before ?? 0} ${inputItem}, the trade takes ${need}: withdraw more from storage`);
      }

      const took = await rcon.take(a.name, inputItem, need, before);
      if (took === null || took < need) {
        if (took !== null && took > 0) {
          await rcon.give(a.name, inputItem, took, before - took).catch(() => false);
        }
        throw new Error(`has ${took ?? 0} ${inputItem}, the trade takes ${need}: withdraw more from storage`);
      }

      await rcon.give(a.name, outputItem, outputCount);
      if (typeof a.world?.merchantTraded === 'function') {
        await a.world.merchantTraded(v, index, times, a.name);
      }
      await syncInventory(a);

      const usedAfter = typeof m.uses?.[index] === 'number' && Number.isFinite(m.uses[index]) ? m.uses[index] : used + times;
      const leftAfter = Math.max(0, offer.stock - usedAfter);
      if (dir === 'sell') {
        return `traded with the merchant: sold ${offer.n * times} ${offer.item} for ${offer.emeralds * times} emerald (stock left ${leftAfter})`;
      }
      return `traded with the merchant: bought ${offer.n * times} ${offer.item} for ${offer.emeralds * times} emerald (stock left ${leftAfter})`;
    },
  },

  tool: {
    name: 'trade',
    description: 'Trade with the village merchant at its market stall by command: sell village goods for emeralds (dir "sell") or buy goods with emeralds (dir "buy").',
    input_schema: {
      type: 'object',
      properties: {
        item: { type: 'string', description: 'Item id of the merchant offer (e.g. birch_log, wheat, string, bone, gunpowder, fishing_rod).' },
        dir: { type: 'string', enum: ['sell', 'buy'], description: "'sell' to sell item to the merchant for emeralds, or 'buy' to buy item from the merchant with emeralds." },
        times: { type: 'number', description: 'How many times to repeat the offer (1-8, default 1).' },
        x: { type: 'number', description: 'Optional merchant stall X coordinate (defaults to the village merchant cell).' },
        y: { type: 'number', description: 'Optional merchant stall Y coordinate (defaults to the village merchant cell).' },
        z: { type: 'number', description: 'Optional merchant stall Z coordinate (defaults to the village merchant cell).' },
      },
      required: ['item', 'dir'],
    },
  },

  activity: {
    place(ctx: FoundryPlaceCtx): Record<string, unknown> | { why: string } {
      try {
        const m = ctx?.village?.merchant;
        if (!m || typeof m.x !== 'number' || typeof m.y !== 'number' || typeof m.z !== 'number') {
          return { why: 'no merchant' };
        }
        if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !Number.isFinite(m.z)) {
          return { why: 'no merchant' };
        }
        return { x: m.x, y: m.y, z: m.z };
      } catch {
        return { why: 'no merchant' };
      }
    },

    holds(): string[] {
      return ['merchant'];
    },

    pick(ctx): FoundryPick | { why: string } {
      try {
        const world = ctx?.agent?.world;
        const v = ctx?.village;
        if (!world || typeof world.merchantPick !== 'function' || !v) {
          return { why: 'no merchant' };
        }
        const spare = ctx.spare && typeof ctx.spare === 'object' ? ctx.spare : {};
        if (ctx.spec === 'lib:sell') {
          const p = world.merchantPick(v, 'buys', spare, () => 0);
          if ('why' in p) return p;
          const o = p.offer;
          const n = o.n * p.times;
          const e = o.emeralds * p.times;
          return {
            args: { item: o.item, dir: 'sell', times: p.times },
            needs: { [o.item]: n },
            gives: ['emerald'],
            facts: `sells ${n} ${o.item} for ${e} emeralds; the merchant buys it while storage holds more than it keeps`,
          };
        }
        if (ctx.spec === 'lib:buy') {
          const p = world.merchantPick(v, 'sells', spare, keepOf);
          if ('why' in p) return p;
          const o = p.offer;
          const n = o.n * p.times;
          const e = o.emeralds * p.times;
          let stored = 0;
          for (const c of v.storage?.chests ?? []) {
            const cnt = c?.items?.[o.item];
            if (typeof cnt === 'number' && Number.isFinite(cnt)) stored += cnt;
          }
          const k = keepOf(o.item);
          return {
            args: { item: o.item, dir: 'buy', times: p.times },
            needs: { emerald: e },
            gives: [o.item],
            facts: `buys ${n} ${o.item} for ${e} emeralds; storage holds ${stored} of the ${k} kept`,
          };
        }
        return { why: 'nothing to trade' };
      } catch {
        return { why: 'nothing to trade' };
      }
    },
  },
};
