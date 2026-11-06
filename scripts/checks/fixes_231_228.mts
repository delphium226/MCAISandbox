// Train 23's fixes (F357, runs/2026-11-06/train23/report.md), offline; each section fails on the code before them:
// #231: a hunt hurt by its (re)start is called off and ends done (home to the hut, a bite), not failed: in train 23 27 of
//   44 picks failed at health 6-11 when a reflex (a creeper's blast as the member ran, the curfew's walk home, fights)
//   put the hunt back in the queue and its resume checked the start's health again. Its 4 minutes count from the first start.
// Creeper flees (what hurt them): 55 of 151 flees ended hurt; the runner stood still at a fence or wall (forward off).
//   Now it turns 45 or 90 degrees off where the way is walled, and a fight is left at 5 blocks from a creeper, not 3.
// #228: the reflex acts on a witch, skeleton or pillager within 16 that hurt the member (none within 5): a bow shoots it,
//   an armed member above 10 closes and fights, else it runs.
// #227: a bot logging in with its eyes in a block (an earlier run's saved position) is moved to the surface at once.
// Bows: a mob hit and then killed with the sword is the bow's assist; the hunt keeps the mob it shot as its target; the
//   aim's lead comes from the target's positions through the draw (mineflayer's velocity for a mob is stale).
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/fixes_231_228.mts
import { Vec3 } from 'vec3';

process.env.MC_WORLD_MODE ??= 'hostile';
const C = await import('../../server/src/mineflayer/mcCombat');
const H = await import('../../server/src/mineflayer/mcHazard');
let fails = 0;
const ok = (cond: unknown, what: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) fails++;
};
const sec = async (name: string, f: () => Promise<void> | void) => {
  try { await f(); } catch (e) { ok(false, `${name}: ${(e as Error).message}`); }
};
type Cell = { name: string; boundingBox: string } | null;
// (a world of cells: ground at y 63, air above, unless set)
const world = (set: Record<string, string>) => (p: Vec3): Cell => {
  const k = `${p.x},${p.y},${p.z}`;
  if (k in set) return set[k] === 'air' ? { name: 'air', boundingBox: 'empty' } : { name: set[k], boundingBox: /flower|torch|grass$/.test(set[k]) ? 'empty' : 'block' };
  return p.y <= 63 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' };
};

await sec('#231', async () => {
  const chest = { x: 10, y: 64, z: 10 };
  const v = { name: 'P1', storage: { chests: [chest] } };
  const fake = (health: number) => ({
    name: 'Kai',
    village: () => v,
    bot: { health, food: 20, inventory: { items: () => [{ name: 'iron_sword', count: 1 }] }, entity: { position: new Vec3(10.5, 64, 11.5) }, entities: {} },
  }) as never;
  const box = { x1: 0, z1: 0, x2: 20, z2: 20 };
  const signal = new AbortController().signal;
  // (train 23's Elena: hurt to 7 by a creeper's blast while the hunt was queued behind the reflex; on its resume)
  let out = '', err = '';
  try { out = await C.huntEdge(fake(7), [], box, () => null, signal, 32, { resumes: 2, firstStartedAt: Date.now() - 200000 }); } catch (e) { err = (e as Error).message; }
  ok(!err && /called off the hunt: health 7, hurt on the way out/.test(out), `a resumed hunt at health 7 is called off, done, not failed (${err || out})`);
  ok(/storage hut/.test(out), 'the call-off sends the member to the storage hut to eat');
  err = '';
  try { out = await C.huntEdge(fake(9), [], box, () => null, signal); } catch (e) { err = (e as Error).message; }
  ok(!err && /health 9, hurt before it began/.test(out), `a first start at 9 is called off too (${err || out})`);
  ok(C.combatCounts.huntsCalledOff === 2, 'called-off hunts are counted ([watch] line)');
  ok(C.huntStart(15) === 'go' && C.huntStart(13) === 'heal' && C.huntStart(11) === 'no', "the start's gate is #231's first fix (go above 14, heal at 12-14)");
});

await sec('creeper flee', () => {
  // (a fence one block east of the runner at 0,64,0)
  const fenced = world({ '1,64,0': 'oak_fence' });
  ok(C.walled(fenced, new Vec3(1, 64, 0)), 'a fence ahead is walled (no jump clears it)');
  ok(!C.runnable(fenced, new Vec3(1, 64, 0)), 'so it is not run into');
  ok(!C.walled(world({ '1,64,0': 'dirt' }), new Vec3(1, 64, 0)), 'a one-block step is not walled (jumped)');
  ok(C.walled(world({ '1,64,0': 'dirt', '1,65,0': 'dirt' }), new Vec3(1, 64, 0)), 'a two-high bank is walled');
  ok(C.walled(world({ '1,65,0': 'oak_log' }), new Vec3(1, 64, 0)), 'a block at the head is walled');
  ok(C.runnable(world({}), new Vec3(1, 64, 0)), 'open flat ground is runnable');
  // (running east from a creeper to the west; east fenced: the first runnable heading is 45 degrees off)
  const heads = C.fleeHeadings(1, 0);
  ok(Math.abs(heads[0].x - 1) < 1e-9 && heads.length === 5, 'headings: straight away first');
  const pick = heads.findIndex((h) => C.runnable(fenced, new Vec3(Math.floor(0.5 + h.x), 64, Math.floor(0.5 + h.z))));
  ok(pick === 1 || pick === 2, `a fence straight ahead: the runner turns 45 degrees (heading ${pick}), where the old steering stood still`);
  ok(C.CREEPER_LEAVE === 5, 'a fight is left with a creeper at 5 blocks (its fuse lights at 3)');
});

await sec('#228', () => {
  const none = new Map<number, Set<string>>();
  const me = (o: Partial<{ health: number; armed: boolean; hurtAgo: number; ranAgo: number; bow: boolean; mobs: Array<{ id: number; name: string; dist: number }> }>) =>
    ({ health: 18, armed: true, hurtAgo: 99999, mobs: [], ...o });
  const witch = { id: 7, name: 'witch', dist: 9 };
  const f = C.decide(me({ mobs: [witch], hurtAgo: 500 }), [], none);
  ok(f?.kind === 'fight' && f.ranged && f.mob.id === 7, 'hurt with a witch at 9 (Elena, #228): an armed member fights it');
  const r = C.decide(me({ mobs: [witch], hurtAgo: 500, health: 8 }), [], none);
  ok(r?.kind === 'shelter' && r.ranged, 'the same at health 8: runs out of range');
  ok(C.decide(me({ mobs: [witch], hurtAgo: 500, health: 8, bow: true }), [], none)?.kind === 'fight', 'with a bow at health 8 and the witch 9 out: shoots');
  ok(C.decide(me({ mobs: [witch], hurtAgo: 500, armed: false }), [], none)?.kind === 'shelter', 'unarmed: runs');
  ok(C.decide(me({ mobs: [{ id: 8, name: 'skeleton', dist: 14 }], hurtAgo: 800 }), [], none)?.kind === 'fight', 'a skeleton at 14 that hurt it: fight');
  ok(C.decide(me({ mobs: [{ id: 9, name: 'pillager', dist: 12 }], hurtAgo: 800 }), [], none)?.kind === 'fight', 'a pillager at 12: fight');
  ok(C.decide(me({ mobs: [witch] }), [], none) === null, 'a witch near but no hurt: nothing');
  ok(C.decide(me({ mobs: [{ id: 10, name: 'zombie', dist: 9 }], hurtAgo: 500 }), [], none) === null, 'a zombie at 9 is not a ranged attacker');
  ok(C.decide(me({ mobs: [{ id: 11, name: 'skeleton', dist: 20 }], hurtAgo: 500 }), [], none) === null, 'a skeleton past 16: nothing');
  const z = C.decide(me({ mobs: [witch, { id: 12, name: 'zombie', dist: 2 }], hurtAgo: 500 }), [], none);
  ok(z?.kind === 'fight' && z.mob.id === 12 && !z.ranged, 'a zombie within 5 still comes first');
});

await sec('#227', () => {
  const rock = world({ '0,27,0': 'stone', '0,26,0': 'stone' });
  ok(H.buriedAt(rock, { x: 0.3, y: 26, z: 0.7 }) === true, "Kai's log-in at y 26 in rock: buried");
  ok(H.buriedAt(world({}), { x: 0.5, y: 64, z: 0.5 }) === false, 'on the ground: not buried');
  ok(H.buriedAt(world({ '0,64,0': 'oak_slab' }), { x: 0.5, y: 64.5, z: 0.5 }) === false, 'on a slab: not buried');
  ok(H.buriedAt(world({ '0,65,0': 'glass' }), { x: 0.5, y: 64, z: 0.5 }) === false, 'eyes in glass: no suffocation');
  ok(H.buriedAt(world({ '0,65,0': 'deepslate' }), { x: 0.5, y: 64, z: 0.5 }) === true, 'eyes in deepslate: buried');
  ok(H.buriedAt(() => null, { x: 0, y: 64, z: 0 }) === null, 'chunk not loaded: unknown (waited for)');
});

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
