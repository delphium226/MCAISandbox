/**
 * The Nether rung's skills (MC_NETHER_AGE; docs/specs/nether.md sections 1-3): build_portal (the frame of 10 obsidian
 * charged from storage, lit by a real flint and steel use), the way through and back (enterPortal, leavePortal),
 * nether_expedition (a party member gathers Nether blocks round the far portal and brings them home) and nether_dig (a
 * member with a diamond pickaxe digs ancient debris). A member off the overworld belongs to the skill that took it there:
 * the way back is in each skill's `finally` (walk back through the far portal, a teleport to it, the recall), and the
 * world's netherWatch recalls anyone a skill lost. Geometry in netherPlan.ts; every block confirmed on the server.
 */
import { Vec3 } from 'vec3';
import type { BotAgent } from './botAgent';
import type { Village } from '../village';
import { villageHome } from '../village';
import { NETHER_BLOCKS, NETHER_DEBRIS, NETHER_PARTY } from '../ladder';
import { DEBRIS_REACH, DEBRIS_Y, DIG_NETHER, FRAME_BLOCKS, HOT, TRIP_BLOCKS, TRIP_MIN, exposed, farStand, frameCells, inTripBox, innerCells, nearPortal, planPortal, planStair, safeToDig, stairStep, type Cell, type PortalSite } from '../netherPlan';
import { dimOf, inDim, overworld } from './mcDim';
import { recall } from './mcRescue';
import { timeScale } from './mcRules';
import { storageContents, withdrawItems } from './mcStorage';
import { mineBlock } from './mcSurvival';
import { at, checkAbort, goals, nearestBlocks, sleep, syncInventory, walk } from './mcUtil';
import { runJob } from './mcBuild';

/** The village's members in the Nether (a lease each, keyed by the village, held by the skill's run: dropped when it
 *  settles). The payload is the trip's deadline, which the world's netherWatch reads. */
export const netherParty = {
  /** (tiered-brain-building has no lease table: a map of the village's party, each entry dropped in the skill's finally) */
  table: new Map<string, Map<string, { until: number }>>(),
  holders(key: string): Array<{ holder: { agent: string }; payload: { until: number } }> {
    return [...(this.table.get(key) ?? new Map()).entries()].map(([agent, payload]) => ({ holder: { agent }, payload }));
  },
  take(key: string, agent: string, payload: { until: number }): boolean {
    const m = this.table.get(key) ?? new Map<string, { until: number }>();
    if (!m.has(agent) && m.size >= NETHER_PARTY) return false;
    m.set(agent, payload);
    this.table.set(key, m);
    return true;
  },
  drop(key: string, agent: string): void {
    this.table.get(key)?.delete(agent);
  },
};

const passed = (r: string) => /passed/i.test(r);
const AIR = /^(air|cave_air|void_air)$/;

/** A cell's block name from the bot's own world ('' when not loaded), by state id (cheap: no Block object). */
function nameAt(a: BotAgent, x: number, y: number, z: number): string {
  const id = a.bot.world.getBlockStateId(new Vec3(x, y, z)) as number | undefined;
  return id === undefined ? '' : a.world.registry.blocksByStateId[id]?.name ?? '';
}

const count = (a: BotAgent, item: string) => a.world.rcon.count(a.name, item).catch(() => 0);
async function counts(a: BotAgent, items: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const n of items) out[n] = await count(a, n);
  return out;
}

/** Whether the server shows all six inner cells as portal. */
async function litNow(a: BotAgent, p: { x: number; y: number; z: number; axis: 'x' | 'z' }): Promise<boolean> {
  for (const c of innerCells(p)) if (!passed(await a.world.rcon.command(`execute if block ${c.x} ${c.y} ${c.z} minecraft:nether_portal`).catch(() => ''))) return false;
  return true;
}

/** The ground at a column as planPortal reads it (the bot's own world, near the hint's level). */
function groundAt(a: BotAgent, x: number, z: number, hint: number): { y: number; firm: boolean; clear: boolean } | null {
  for (let y = hint + 8; y >= hint - 8; y--) {
    const n = nameAt(a, x, y, z);
    if (!n) return null;
    if (AIR.test(n) || isPlant(n)) continue;
    const firm = !/^(water|lava|ice|packed_ice|blue_ice)$|_leaves$|_log$|_wood$|_stem$|^farmland$/.test(n);
    let clear = true;
    for (let k = 1; k <= 5 && clear; k++) { const m = nameAt(a, x, y + k, z); clear = AIR.test(m) || isPlant(m); }
    return { y, firm, clear };
  }
  return null;
}
const isPlant = (n: string) => /^(short_grass|tall_grass|fern|large_fern|dead_bush|.*_flower|dandelion|poppy|.*_tulip|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|.*_petals|leaf_litter|bush|firefly_bush|snow)$/.test(n);

/** Step from where the bot stands into a portal cell; wait for the dimension to change (Paper's 80 ticks in survival). */
async function stepIn(a: BotAgent, cell: Cell, signal: AbortSignal, exit?: Cell, ms = 15000): Promise<boolean> {
  const bot = a.bot, d0 = dimOf(a);
  bot.pathfinder.setGoal(null);
  // (forward until the feet are in a portal cell, read each physics tick: a portal is one block thick, and the far side's
  // arrival platform ends a block beyond it; the probe walked Gus off it into the lava sea)
  const inPortal = () => nameAt(a, Math.floor(bot.entity.position.x), Math.floor(bot.entity.position.y), Math.floor(bot.entity.position.z)) === 'nether_portal';
  const stop = () => { if (inPortal()) bot.clearControlStates(); };
  try {
    await bot.lookAt(new Vec3(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5), true);
    bot.on('physicsTick', stop);
    bot.setControlState('forward', true);
    for (let t = 0; t < 60 && !inPortal() && dimOf(a) === d0; t++) await sleep(50, signal);
  } finally {
    bot.clearControlStates();
    bot.off('physicsTick', stop);
  }
  for (const t0 = Date.now(); Date.now() - t0 < ms && dimOf(a) === d0;) await sleep(100, signal);
  if (dimOf(a) === d0) return false;
  // (off the arrival portal at once: a member left standing in it is carried back once Paper's cooldown ends; the first
  // live trip went home and straight back to the Nether while its chunks loaded, nether1 11-14)
  await stepOut(a, signal, exit);
  await bot.waitForChunksToLoad().catch(() => undefined);
  bot.pathfinder.setGoal(null);
  return true;
}

/** Out of the portal the bot arrived in: the first cell beside it (four ways) with room and firm ground, walked to with the
 *  controls (no path: the portal's cells are in the avoid list); its chunk read first, up to 3 s. */
async function stepOut(a: BotAgent, signal: AbortSignal, exit?: Cell): Promise<void> {
  const bot = a.bot;
  const feet = () => bot.entity.position.floored();
  // (a known stand cell (the village's portal's, the far portal's) is walked to without reading the world: the arrival's
  // chunk can take seconds to come, and at 3x the arrival cooldown is 5 s; nether2 went back while it waited, 11-14)
  // (the position packet comes after the respawn: steering from the old dimension's x, z walked the member along the
  // portal's plane and back into it; wait until it stands near the exit, up to 4 s)
  if (exit) for (let i = 0; i < 40 && Math.hypot(bot.entity.position.x - exit.x - 0.5, bot.entity.position.z - exit.z - 0.5) > 4; i++) await sleep(100, signal);
  if (exit && Math.hypot(bot.entity.position.x - exit.x - 0.5, bot.entity.position.z - exit.z - 0.5) > 4) exit = undefined;
  if (exit) {
    try {
      await bot.lookAt(new Vec3(exit.x + 0.5, exit.y + 1.6, exit.z + 0.5), true);
      bot.setControlState('forward', true);
      for (let t = 0; t < 40; t++) {
        const p = bot.entity.position;
        if (Math.hypot(p.x - (exit.x + 0.5), p.z - (exit.z + 0.5)) < 0.45) break;
        await sleep(50, signal);
      }
    } finally {
      bot.clearControlStates();
    }
    return;
  }
  for (let i = 0; i < 30 && !nameAt(a, feet().x, feet().y - 1, feet().z); i++) await sleep(100, signal);
  const inPortal = () => nameAt(a, feet().x, feet().y, feet().z) === 'nether_portal';
  if (!inPortal()) return;
  const f = feet();
  const room = (x: number, y: number, z: number) => {
    const g = nameAt(a, x, y - 1, z);
    return AIR.test(nameAt(a, x, y, z)) && AIR.test(nameAt(a, x, y + 1, z)) && !!g && !AIR.test(g) && !/^(lava|fire|soul_fire|water|nether_portal)$/.test(g);
  };
  const out = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: f.x + dx, y: f.y, z: f.z + dz })).find((c) => room(c.x, c.y, c.z));
  if (!out) return;
  try {
    await bot.lookAt(new Vec3(out.x + 0.5, out.y + 1.6, out.z + 0.5), true);
    bot.setControlState('forward', true);
    for (let t = 0; t < 40 && inPortal(); t++) await sleep(50, signal);
    // (a step past the portal's face, not to the platform's edge)
    await sleep(150, signal);
  } finally {
    bot.clearControlStates();
  }
}

/**
 * build_portal (option rung:portal, the Nether's stage 1): the portal's site planned once (netherPlan.ts planPortal: off
 * every village's ground, within 40 of the storage hut, facing it), the frame's 10 obsidian placed by runJob charged from
 * storage and each confirmed, then lit by a real use of a flint and steel on its inner floor; a command fills the six cells
 * when the use does not light it, said so. The frame goes into the village's structures (no walk digs or builds at it, and
 * the portal's cells are in every walk's avoid list).
 */
export async function buildPortal(a: BotAgent, _args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('build_portal: not in a village');
  if (!overworld(a)) throw new Error('build_portal: not in the overworld');
  const reg = a.world.villages;
  const rec = (v.nether ??= {});
  if (rec.portal?.lit && (await litNow(a, rec.portal))) return `the Nether portal stands lit already at ${rec.portal.x},${rec.portal.y},${rec.portal.z}`;
  if (!rec.portal) {
    if (rec.fail && Date.now() - (rec.at ?? 0) < 30 * 60000) throw new Error(`build_portal: ${rec.fail}`);
    const h = villageHome(v);
    const hut = v.storageHut ? { x: Math.floor((v.storageHut.x1 + v.storageHut.x2) / 2), z: Math.floor((v.storageHut.z1 + v.storageHut.z2) / 2) } : h ? { x: h.x, z: h.z } : null;
    if (!hut) throw new Error('build_portal: the village has no storage hut to build beside');
    await walk(a, new goals.GoalNearXZ(hut.x, hut.z, 4), 'the storage hut', signal, 90000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    await a.bot.waitForChunksToLoad().catch(() => undefined);
    const hint = v.plots[0]?.y ?? Math.floor(a.bot.entity.position.y);
    const boxes = [...a.protectedGround(), ...a.farmGround()];
    const blocked = (x: number, z: number, y: number) => boxes.some((q) => x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2 && y >= q.y - 1);
    const others = [...reg.villages.values()].filter((o) => o !== v && o.nether?.portal).map((o) => o.nether!.portal!);
    const site = planPortal(hut, (x, z) => groundAt(a, x, z, hint), blocked, others);
    if (!site) {
      v.nether = { ...rec, fail: 'no flat, clear ground off the village\'s plots within 40 blocks of the storage hut (or another village\'s portal within 160)', at: Date.now() };
      reg.save();
      throw new Error(`build_portal: ${v.nether.fail}`);
    }
    v.nether = { ...rec, portal: { ...site, lit: false }, fail: undefined };
    reg.save();
    console.log(`[nether] ${v.name}: the portal planned at ${site.x},${site.y},${site.z} along ${site.axis}, stand ${site.stand.x},${site.stand.y},${site.stand.z}`);
  }
  const p = v.nether!.portal!;
  const frame = frameCells(p), inner = innerCells(p);
  const xs = [...frame, ...inner].map((c) => c.x), zs = [...frame, ...inner].map((c) => c.z);
  const box = { x1: Math.min(...xs), z1: Math.min(...zs), x2: Math.max(...xs), z2: Math.max(...zs) };
  const summary = await runJob(a, { targets: [...frame.map((c) => ({ ...c, block: 'obsidian' })), ...inner.map((c) => ({ ...c, block: 'air' }))], area: box, y: p.y + 1, what: 'the Nether portal' }, signal);
  await sleep(500, signal);
  let built = 0;
  for (const c of frame) if (passed(await a.world.rcon.command(`execute if block ${c.x} ${c.y} ${c.z} minecraft:obsidian`).catch(() => ''))) built++;
  if (built < FRAME_BLOCKS) throw new Error(`build_portal: ${built} of ${FRAME_BLOCKS} obsidian of the frame stand (${summary})`);
  // (the frame is a structure: protectedGround keeps every walk from digging or building at it)
  if (!v.structures.some((s) => s.kind === 'nether_portal')) {
    v.structures.push({ id: reg.id('s'), kind: 'nether_portal', ...box, y: p.y, builtBy: a.name });
    reg.save();
  }
  // The light: a real use of a flint and steel on the inner floor (the obsidian under the first inner cell)
  if ((await count(a, 'flint_and_steel')) < 1) {
    if (!(storageContents(v).flint_and_steel ?? 0)) return `built the portal's frame (${built} obsidian confirmed; ${summary}); no flint and steel to light it yet (the workshop makes one of an iron ingot and a flint)`;
    await withdrawItems(a, v, { flint_and_steel: 1 }, signal);
  }
  await walk(a, new goals.GoalBlock(p.stand.x, p.stand.y, p.stand.z), 'the portal\'s front', signal, 60000).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
  });
  await syncInventory(a).catch(() => undefined);
  const fs = a.bot.inventory.items().find((it) => it.name === 'flint_and_steel');
  let how = 'with a flint and steel';
  if (fs) {
    await a.bot.equip(fs, 'hand').catch(() => undefined);
    const floor = a.bot.blockAt(new Vec3(inner[0].x, p.y, inner[0].z));
    if (floor) await a.bot.activateBlock(floor, new Vec3(0, 1, 0)).catch(() => undefined);
    await sleep(1000, signal);
  }
  let lit = await litNow(a, p);
  if (!lit) {
    // (the charged command: the use did not light it, or no flint and steel came to hand)
    await a.world.rcon.command(`fill ${inner[0].x} ${p.y + 1} ${inner[0].z} ${inner[inner.length - 1].x} ${p.y + 3} ${inner[inner.length - 1].z} minecraft:nether_portal[axis=${p.axis}] replace minecraft:air`).catch(() => '');
    await sleep(500, signal);
    lit = await litNow(a, p);
    how = fs ? 'by command (the flint and steel\'s use did not light it)' : 'by command (no flint and steel came to hand)';
  }
  if (!lit) throw new Error(`build_portal: the frame stands (${built} obsidian) but the portal did not light`);
  v.nether = { ...v.nether, portal: { ...p, lit: true, by: a.name, at: Date.now() } };
  reg.save();
  const out = `built the Nether portal at ${p.x},${p.y},${p.z} (${built} obsidian confirmed) and lit it ${how}: all six portal cells confirmed`;
  reg.note(v, `${a.name} ${out}`);
  console.log(`[nether] ${v.name}: ${a.name} ${out}`);
  return out;
}

/**
 * Through the village's portal: to its stand cell, a step in, the dimension changed within 15 s (else, with the far portal
 * known, a teleport to its stand cell, said so). The far portal and its stand cell recorded at the first arrival.
 */
export async function enterPortal(a: BotAgent, v: Village, signal: AbortSignal): Promise<string> {
  const p = v.nether?.portal;
  if (!p?.lit) throw new Error('the village has no lit Nether portal');
  if (!overworld(a)) return `already in ${dimOf(a)}`;
  await walk(a, new goals.GoalBlock(p.stand.x, p.stand.y, p.stand.z), 'the Nether portal', signal, 120000);
  let note = 'walked through the portal';
  if (!(await stepIn(a, innerCells(p)[0], signal, v.nether?.far?.stand))) {
    const f = v.nether?.far;
    if (!f) throw new Error('the portal did not take me through (15 s in it)');
    await a.world.rcon.command(inDim(f.dim, `tp ${a.name} ${(f.stand ?? f).x + 0.5} ${(f.stand ?? f).y} ${(f.stand ?? f).z + 0.5}`));
    for (let i = 0; i < 40 && overworld(a); i++) await sleep(200, signal);
    if (overworld(a)) throw new Error('the portal did not take me through, nor the teleport to the far portal');
    await sleep(1000, signal);
    await a.bot.waitForChunksToLoad().catch(() => undefined);
    note = 'teleported to the far portal (the portal did not take me through in 15 s)';
  }
  if (!v.nether?.far) {
    const id = a.world.registry.blocksByName.nether_portal.id;
    const cells = nearestBlocks(a, [id], 6, 12).map((q) => ({ x: q.x, y: q.y, z: q.z }));
    const stand = farStand(cells, (x, y, z) => nameAt(a, x, y, z));
    const low = cells.sort((q, r) => q.y - r.y || q.x - r.x || q.z - r.z)[0];
    const here = a.bot.entity.position.floored();
    const dim = dimOf(a);
    if (dim !== 'overworld') {
      v.nether = { ...v.nether, far: { ...(low ?? { x: here.x, y: here.y, z: here.z }), dim, stand: stand ?? { x: here.x, y: here.y, z: here.z } } };
      a.world.villages.save();
      console.log(`[nether] ${v.name}: the far portal at ${low ? at(new Vec3(low.x, low.y, low.z)) : at(here)} in ${dim}, stand ${stand ? `${stand.x},${stand.y},${stand.z}` : 'where the first arrival stood'}`);
    }
  }
  return note;
}

/**
 * Back through the far portal: to its stand cell, a step in, the overworld within 15 s; else a teleport to the stand cell
 * and a second step; else the recall. Then a step off the village's portal (an arrival standing in it is carried back
 * once it leaves and re-enters). Returns how.
 */
export async function leavePortal(a: BotAgent, v: Village, signal: AbortSignal): Promise<string> {
  if (overworld(a)) return 'in the overworld';
  const f = v.nether?.far;
  let how = '';
  if (f?.stand) {
    const id = a.world.registry.blocksByName.nether_portal.id;
    const cell = () => {
      const s = new Vec3(f.stand!.x, f.stand!.y, f.stand!.z);
      return nearestBlocks(a, [id], 8, 12).filter((q) => q.y === s.y || q.y === s.y + 1).sort((q, r) => q.distanceTo(s) - r.distanceTo(s))[0];
    };
    for (let tries = 0; tries < 2 && !overworld(a) && !how; tries++) {
      if (tries === 1) {
        await a.world.rcon.command(inDim(f.dim, `tp ${a.name} ${f.stand.x + 0.5} ${f.stand.y} ${f.stand.z + 0.5}`)).catch(() => '');
        await sleep(1000, signal);
      } else {
        await walk(a, new goals.GoalBlock(f.stand.x, f.stand.y, f.stand.z), 'the far portal', signal, 90000).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
        });
      }
      const c = cell();
      if (c && (await stepIn(a, { x: c.x, y: c.y, z: c.z }, signal, v.nether?.portal?.stand))) how = tries === 0 ? 'walked back through the far portal' : 'teleported to the far portal and stepped through';
    }
  }
  if (!overworld(a)) how = (await recall(a, 'the way back through the far portal failed', signal)) ?? 'could not be brought back';
  const p = v.nether?.portal;
  if (p && overworld(a)) await walk(a, new goals.GoalNear(p.stand.x, p.stand.y, p.stand.z, 2), 'off the portal', signal, 15000).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
  });
  return how;
}

/** A pickaxe in hand for the Nether's blocks (they drop nothing without one): the member's, else one from storage. */
async function pickaxe(a: BotAgent, v: Village, signal: AbortSignal, best: string[]): Promise<string | null> {
  let n = null as string | null;
  for (const q of best) if (!n && (await count(a, q)) > 0) n = q;
  if (!n) {
    const store = storageContents(v);
    const q = best.find((k) => (store[k] ?? 0) > 0);
    if (!q) return null;
    await withdrawItems(a, v, { [q]: 1 }, signal);
    if ((await count(a, q)) > 0) n = q;
  }
  if (!n) return null;
  // (in hand, and in Mineflayer's own view of the inventory: the first live trip held a pickaxe the server counted and the
  // bot did not see, and every nylium dig was refused for want of one, nether1 11-14)
  await syncInventory(a).catch(() => undefined);
  const it = a.bot.inventory.items().find((q) => q.name === n);
  if (it) await a.bot.equip(it, 'hand').catch(() => undefined);
  return it ? n : null;
}

/** The way home in a trip's `finally`: a cut-short trip (its signal aborted) is recalled at once; otherwise the walk back,
 *  which falls back to the recall itself. */
async function homeFrom(a: BotAgent, v: Village, signal: AbortSignal): Promise<string> {
  if (overworld(a)) return '';
  if (signal.aborted) return (await recall(a, 'the trip was cut short').catch(() => null)) ?? 'not brought back';
  return leavePortal(a, v, signal).catch(async (e: Error) => (await recall(a, `the way back failed (${e.message})`).catch(() => null)) ?? 'not brought back');
}

/** The party's lease for this run (with the trip's deadline), or why not. */
async function joinParty(a: BotAgent, v: Village, signal: AbortSignal, until: number): Promise<string | null> {
  void signal;
  return netherParty.take(v.name, a.name, { until }) ? null : `the Nether party is full (${NETHER_PARTY} members at most at once)`;
}

/** A trip's minutes in wall time (game time: shorter at MC_TIME_SCALE 2). */
const tripMs = (min: number) => (min * 60000) / Math.max(1, timeScale());

/**
 * nether_expedition (option rung:expedition, the Nether's stage 2; a party lease of MC_NETHER_PARTY): through the portal,
 * gathering Nether blocks within the trip's box round the far portal (netherPlan.ts: 32 out, 12 up and down) for up to
 * TRIP_BLOCKS blocks or TRIP_MIN minutes, digging only exposed blocks with no lava or fire beside them and never the one
 * underfoot; back through the far portal (in a `finally`). Counted on the server: the Nether items the member holds once
 * home against what it held before it went ("brought back N Nether blocks"); the chore's deposit stores them.
 */
export async function netherExpedition(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('nether_expedition: not in a village');
  if (!v.nether?.portal?.lit) throw new Error('nether_expedition: the village has no lit Nether portal');
  if (!overworld(a)) throw new Error(`nether_expedition: already in ${dimOf(a)}`);
  const want = Math.max(1, Math.min(TRIP_BLOCKS, Number(args.n) || TRIP_BLOCKS));
  const deadline = Date.now() + tripMs(TRIP_MIN);
  const full = await joinParty(a, v, signal, deadline + tripMs(2));
  if (full) throw new Error(`nether_expedition: ${full}`);
  const pick = await pickaxe(a, v, signal, ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe']);
  if (!pick) netherParty.drop(v.name, a.name);
  if (!pick) throw new Error('nether_expedition: no pickaxe (the Nether\'s blocks drop nothing to a hand): the workshop makes stone ones');
  const before = await counts(a, NETHER_BLOCKS);
  const notes: string[] = [];
  let dug = 0, failed = 0, back = '';
  try {
    notes.push(await enterPortal(a, v, signal));
    const far = v.nether!.far!;
    const ids = DIG_NETHER.map((n) => a.world.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
    const tried = new Set<string>();
    const name = (x: number, y: number, z: number) => nameAt(a, x, y, z);
    while (dug < want && Date.now() < deadline) {
      checkAbort(signal);
      const feet = a.bot.entity.position.floored();
      const keep = (q: Vec3) => !tried.has(`${q.x},${q.y},${q.z}`) && inTripBox(far, q) && !nearPortal(far, q, true) && exposed(q, name) && safeToDig(q, feet, name);
      const c = nearestBlocks(a, ids, 10, 24, keep)[0] ?? nearestBlocks(a, ids, 20, 24, keep)[0];
      if (!c) break;
      tried.add(`${c.x},${c.y},${c.z}`);
      try {
        await mineBlock(a, c, signal, false, 20000);
        dug++;
      } catch (e) {
        if ((e as Error).message === 'cancelled') throw e;
        if (++failed >= 8) {
          notes.push(`stopped after 8 failed digs (${(e as Error).message.slice(0, 80)})`);
          break;
        }
      }
    }
  } finally {
    back = await homeFrom(a, v, signal);
    netherParty.drop(v.name, a.name);
  }
  const after = await counts(a, NETHER_BLOCKS);
  const got = Object.entries(after).map(([k, n]) => [k, n - (before[k] ?? 0)] as const).filter(([, n]) => n > 0);
  const brought = got.reduce((s, [, n]) => s + n, 0);
  v.nether = { ...v.nether, trips: (v.nether?.trips ?? 0) + 1, brought: (v.nether?.brought ?? 0) + brought };
  a.world.villages.save();
  const out = `brought back ${brought} Nether blocks (${got.length} kinds: ${got.map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}) from the Nether: ${dug} dug round the far portal; ${[...notes, back].filter(Boolean).join('; ')}`;
  console.log(`[nether] ${v.name}: ${a.name} ${out}`);
  if (!overworld(a)) throw new Error(`nether_expedition: still in ${dimOf(a)} (${out})`);
  return out;
}

/**
 * nether_dig (option rung:debris, the Nether's stage 3; the party's lease): a member with a diamond pickaxe goes through,
 * finds ancient debris in the chunks it holds at y 8-119 within 64 blocks (Paper's anti-xray is off: the probe read 6-7
 * there), and digs to each by the walks' own rules (natural Nether ground only; no block dug beside lava or water, the
 * pathfinder's flow rule; lava avoided), the debris itself only with no lava or fire beside it; back in a `finally`.
 * Counted on the server before and after ("dug N ancient debris").
 */
export async function netherDig(a: BotAgent, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const v = a.village();
  if (!v) throw new Error('nether_dig: not in a village');
  if (!v.nether?.portal?.lit) throw new Error('nether_dig: the village has no lit Nether portal');
  if (!overworld(a)) throw new Error(`nether_dig: already in ${dimOf(a)}`);
  const want = Math.max(1, Math.min(NETHER_DEBRIS, Number(args.n) || 2));
  const deadline = Date.now() + tripMs(12);
  const full = await joinParty(a, v, signal, deadline + tripMs(2));
  if (full) throw new Error(`nether_dig: ${full}`);
  const pick = await pickaxe(a, v, signal, ['netherite_pickaxe', 'diamond_pickaxe']);
  if (!pick) netherParty.drop(v.name, a.name);
  if (!pick) throw new Error('nether_dig: no diamond pickaxe (ancient debris drops nothing to a lesser one; the diamond age forges them)');
  const before = await count(a, 'ancient_debris');
  // (netherrack to bridge the stair over caves: the expeditions' from storage, up to 16)
  const rack = Math.min(32, storageContents(v).netherrack ?? 0);
  if (rack > 0 && (await count(a, 'netherrack')) < 8) await withdrawItems(a, v, { netherrack: rack }, signal).catch((e: Error) => {
    if (e.message === 'cancelled') throw e;
  });
  const tally = { bridged: 0 };
  const notes: string[] = [];
  let seen = 0, failed = 0, back = '';
  try {
    notes.push(await enterPortal(a, v, signal));
    const id = a.world.registry.blocksByName.ancient_debris.id;
    const tried = new Set<string>();
    const name = (x: number, y: number, z: number) => nameAt(a, x, y, z);
    while ((await count(a, 'ancient_debris')) - before < want && Date.now() < deadline) {
      checkAbort(signal);
      const feet = a.bot.entity.position.floored();
      const all = nearestBlocks(a, [id], DEBRIS_REACH, 24, (q) => !tried.has(`${q.x},${q.y},${q.z}`), DEBRIS_Y);
      seen = Math.max(seen, all.length);
      // (the first whose whole stair, read before any dig, keeps off lava and loose ground: netherPlan.ts planStair)
      const rack = await count(a, 'netherrack');
      // (from where it stands, else from a standing cell round the far portal nearer the debris: minevale3's portal stands
      // over the lava sea, and every stair from it met lava, nether10 11-14)
      const starts = [feet, ...standCells(a, v.nether!.far!, 24)];
      let c: Vec3 | undefined, from: Cell | undefined, best = Infinity;
      for (const q of all) {
        if (!safeToDig(q, feet, name)) continue;
        const near = starts.slice(1).sort((u, w) => Math.hypot(u.x - q.x, u.z - q.z) - Math.hypot(w.x - q.x, w.z - q.z)).slice(0, 4);
        for (const st of [feet, ...near]) {
          const r = planStair(st, q, name, rack);
          const cost = 'steps' in r ? r.steps + Math.hypot(st.x - feet.x, st.z - feet.z) : Infinity;
          if (cost < best) { best = cost; c = q; from = st; }
        }
      }
      if (c && from && (from.x !== feet.x || from.y !== feet.y || from.z !== feet.z)) {
        await walk(a, new goals.GoalBlock(from.x, from.y, from.z), `the stair's head at ${from.x},${from.y},${from.z}`, signal, 60000).catch((e: Error) => {
          if (e.message === 'cancelled') throw e;
        });
        const q = a.bot.entity.position.floored();
        if (q.x !== from.x || q.y !== from.y || q.z !== from.z) {
          notes.push(`could not reach the stair's head at ${from.x},${from.y},${from.z}`);
          tried.add(`${c.x},${c.y},${c.z}`);
          if (++failed >= 4) break;
          continue;
        }
      }
      if (!c) {
        const why = all.slice(0, 3).map((q) => { const r = planStair(feet, q, name, rack); return 'why' in r ? `${at(q)}: ${r.why}` : ''; }).filter(Boolean).join('; ');
        notes.push(all.length ? `${all.length} debris seen, none with a stair to it clear of lava (${why})` : `no ancient debris seen within ${DEBRIS_REACH} blocks at y ${DEBRIS_Y.min}-${DEBRIS_Y.max}`);
        break;
      }
      tried.add(`${c.x},${c.y},${c.z}`);
      try {
        await a.bot.equip(a.bot.inventory.items().find((it) => it.name === pick)!, 'hand').catch(() => undefined);
        // (the spec's B1: a stair dug down toward it, each cell and its neighbours read for lava first; the pathfinder
        // found no path 35 blocks down through the Nether's rock, nether7 11-14)
        const why = await stairTo(a, c, deadline, signal, tally);
        if (why) throw new Error(why);
        await mineBlock(a, c, signal, false, 30000);
      } catch (e) {
        if ((e as Error).message === 'cancelled') throw e;
        notes.push(`${at(c)}: ${(e as Error).message.slice(0, 80)}`);
        if (++failed >= 4) break;
      }
    }
  } finally {
    back = await homeFrom(a, v, signal);
    netherParty.drop(v.name, a.name);
  }
  const dug = (await count(a, 'ancient_debris')) - before;
  const out = `dug ${Math.max(0, dug)} ancient debris in the Nether (${seen} seen at y ${DEBRIS_Y.min}-${DEBRIS_Y.max}${tally.bridged ? `; ${tally.bridged} netherrack bridged caves under the stair by command` : ''}); ${[...notes, back].filter(Boolean).join('; ')}`;
  console.log(`[nether] ${v.name}: ${a.name} ${out}`);
  if (!overworld(a)) throw new Error(`nether_dig: still in ${dimOf(a)} (${out})`);
  return out;
}

/** Cells a member can stand on round the far portal (firm ground under two of air, no lava or fire under), within
 *  `reach` across and 12 up and down, off its kept floor; at most 200, from the bot's own world. */
function standCells(a: BotAgent, far: Cell, reach: number): Cell[] {
  const out: Cell[] = [];
  for (let dx = -reach; dx <= reach; dx += 2) for (let dz = -reach; dz <= reach; dz += 2) for (let dy = -12; dy <= 12; dy++) {
    const x = far.x + dx, y = far.y + dy, z = far.z + dz;
    const g = nameAt(a, x, y - 1, z);
    if (!g || AIR.test(g) || HOT.test(g) || /^(water|nether_portal|.*_fungus|.*_roots|nether_sprouts|twisting_vines|weeping_vines)$/.test(g)) continue;
    if (!AIR.test(nameAt(a, x, y, z)) || !AIR.test(nameAt(a, x, y + 1, z))) continue;
    if (nearPortal(far, { x, y: y - 1, z })) continue;
    out.push({ x, y, z });
    if (out.length >= 200) return out;
  }
  return out;
}

/**
 * A stair dug from where the member stands toward `target` (netherPlan.ts stairStep: one block along the longer of x and
 * z, one down while above it), until it is within reach. Each step's three cells (the head over the next cell, the next
 * cell's feet and head) are dug with bot.dig (Paper times it) only when safeToDig: no lava, fire or an unloaded cell beside
 * any, nothing that falls over them; the floor of the next cell must be firm. Returns why it stopped short, or null.
 */
async function stairTo(a: BotAgent, target: Cell, deadline: number, signal: AbortSignal, tally: { bridged: number }): Promise<string | null> {
  const bot = a.bot;
  const name = (x: number, y: number, z: number) => nameAt(a, x, y, z);
  for (let n = 0; n < 120; n++) {
    checkAbort(signal);
    if (Date.now() > deadline) return `the stair toward ${target.x},${target.y},${target.z} ran out of time`;
    const p = bot.entity.position.floored();
    if (bot.entity.position.offset(0, 1.62, 0).distanceTo(new Vec3(target.x + 0.5, target.y + 0.5, target.z + 0.5)) <= 4.2) return null;
    const step = stairStep(p, target);
    for (const c of step.dig) {
      const b = name(c.x, c.y, c.z);
      if (!b) return `the stair's cell ${c.x},${c.y},${c.z} is not loaded`;
      if (AIR.test(b)) continue;
      if (!safeToDig(c, p, name) || /^(gravel|sand|soul_sand|red_sand)$/.test(name(c.x, c.y + 1, c.z))) return `the stair stopped at ${at(p)}: lava, fire or loose ground by ${c.x},${c.y},${c.z}`;
      const blk = bot.blockAt(new Vec3(c.x, c.y, c.z));
      if (!blk || !bot.canDigBlock(blk) || /^(bedrock|obsidian|crying_obsidian|nether_portal|ancient_debris)$/.test(blk.name)) return `the stair stopped at ${at(p)}: ${b} at ${c.x},${c.y},${c.z}`;
      const tool = bot.pathfinder.bestHarvestTool(blk);
      if (tool) await bot.equip(tool, 'hand').catch(() => undefined);
      await bot.dig(blk, true);
      await sleep(100, signal);
    }
    const f = name(step.to.x, step.to.y - 1, step.to.z);
    if (!f || HOT.test(f) || /^(water|nether_portal)$/.test(f)) return `the stair stopped at ${at(p)}: no floor at ${step.to.x},${step.to.y - 1},${step.to.z} (${f || 'unloaded'})`;
    // (a cave under the next step: a netherrack the member carries set there by a command charged to it, confirmed on
    // the server; nether8's stairs all stopped at the first cave)
    if (AIR.test(f)) {
      const fx = step.to.x, fy = step.to.y - 1, fz = step.to.z;
      if ((await count(a, 'netherrack')) < 1) return `the stair stopped at ${at(p)}: a cave under ${fx},${fy},${fz} and no netherrack to bridge it`;
      await a.world.rcon.command(`clear ${a.name} minecraft:netherrack 1`);
      await a.world.rcon.command(inDim(dimOf(a), `setblock ${fx} ${fy} ${fz} minecraft:netherrack keep`));
      await sleep(200, signal);
      if (!passed(await a.world.rcon.command(inDim(dimOf(a), `execute if block ${fx} ${fy} ${fz} minecraft:netherrack`)).catch(() => ''))) {
        await a.world.rcon.command(`give ${a.name} minecraft:netherrack 1`);
        return `the stair stopped at ${at(p)}: the bridge block at ${fx},${fy},${fz} did not take`;
      }
      tally.bridged++;
    }
    await walk(a, new goals.GoalBlock(step.to.x, step.to.y, step.to.z), `the stair at ${step.to.x},${step.to.y},${step.to.z}`, signal, 8000).catch((e: Error) => {
      if (e.message === 'cancelled') throw e;
    });
    const q = bot.entity.position.floored();
    if (q.x === p.x && q.y === p.y && q.z === p.z) return `the stair stopped at ${at(p)}: could not step to ${step.to.x},${step.to.y},${step.to.z}`;
  }
  return `the stair toward ${target.x},${target.y},${target.z} is too long`;
}

export const NETHER_SKILLS = {
  build_portal: { run: buildPortal },
  nether_expedition: { run: netherExpedition },
  nether_dig: { run: netherDig },
};

export type { PortalSite };
