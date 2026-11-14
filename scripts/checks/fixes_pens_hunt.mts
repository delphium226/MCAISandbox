// The user's 11-07 after train 25 (F362): "Keep 64, restock pens", then "(b) Hunt when monsters near". Train 25's hunts at
// 64 went out 17 / 14 times and killed 2 / 1; its pig pen stayed 2 of 5 all run (storage held one carrot, breeding needs
// 2; no slot grows a pig's food), and A2's cow restock lost its cow at the ring wall twice (the gate shut behind the
// member). Offline, each section fails on the code before it:
// - the hunt is offered only with a skeleton or spider within 64 of the storage hut (MC_HUNT_NEAR);
// - a built pig pen with no carrot farm keeps 8 carrots, which the merchant sells (MC_PIG_CARROTS);
// - the gatekeeper leaves a ring gate open while a member leading animals is within 8 of it.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/fixes_pens_hunt.mts
import { Vec3 } from 'vec3';

process.env.MC_WORLD_MODE ??= 'hostile';
const C = await import('../../server/src/mineflayer/mcCombat');
const F = await import('../../server/src/farmSlots');
const M = await import('../../server/src/merchant');
const W = await import('../../server/src/mineflayer/mcWalls');
let fails = 0;
const ok = (cond: unknown, what: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) fails++;
};
const sec = async (name: string, f: () => Promise<void> | void) => {
  try { await f(); } catch (e) { ok(false, `${name}: ${(e as Error).message}`); }
};

await sec('the hunt near', () => {
  const home = { x: 0, y: 64, z: 0 };
  const mob = (id: number, name: string, x: number, y = 64, z = 0) => ({ id, name, position: { x, y, z } });
  ok(C.huntNearOn(), 'MC_HUNT_NEAR is on by default');
  ok(C.huntPreyNear([], home, null) === 0, 'no mobs: no prey (the hunt is not offered)');
  ok(C.huntPreyNear([mob(1, 'skeleton', 40), mob(1, 'skeleton', 40), mob(2, 'spider', 0, 64, -50)], home, null) === 2, 'a skeleton seen by two members and a spider, within 64: 2');
  ok(C.huntPreyNear([mob(3, 'skeleton', 90), mob(4, 'spider', 30, 40)], home, null) === 0, 'one 90 out and one in a cave below: none');
  ok(C.huntPreyNear([mob(5, 'zombie', 10), mob(6, 'creeper', 10)], home, null) === 0, 'zombies and creepers do not count');
});

await sec('the pig pen', () => {
  const pigPen = { kind: 'pig', pen: { built: true } };
  ok(F.PIG_CARROTS, 'MC_PIG_CARROTS is on by default');
  ok(F.pigCarrotKeep([{ kind: 'chicken', pen: { built: true } }, pigPen, { kind: 'pumpkin' }]) === 8, 'a pig pen and no carrot farm: 8 carrots kept');
  ok(F.pigCarrotKeep([pigPen, { kind: 'carrots' }]) === 0, 'a carrot farm feeds it: none bought');
  ok(F.pigCarrotKeep([{ kind: 'pig', pen: { built: false } }]) === 0, 'no pig pen built: none');
  const o = M.OFFERS.find((x) => x.item === 'carrot' && x.dir === 'sells');
  // (#247, MC_COPPER_AGE: the amethyst shard appended after it; MC_MUSIC_AGE: the redstone after that)
  let last = M.OFFERS.length - 1;
  while (last > 0 && ['amethyst_shard', 'redstone', 'bell'].includes(M.OFFERS[last].item)) last--;
  ok(o && M.OFFERS.indexOf(o) === last, 'the merchant sells carrots, last in its list but for the rungs\' goods appended after (saved uses keep their indices)');
});

await sec('the gate', async () => {
  const gate = { x: 10, y: 64, z: 0 };
  W.wallGates.clear();
  W.wallGates.add(`${gate.x},${gate.y},${gate.z}`);
  const block = { name: 'oak_fence_gate', getProperties: () => ({ open: true, facing: 'south' }) };
  const bot = (name: string, x: number) => ({ name, bot: { entity: { position: new Vec3(x, 64, 0.5) }, world: { getColumn: () => ({}) }, blockAt: () => block, entities: {} } });
  const sent: string[] = [];
  const cmd = async (c: string) => { sent.push(c); return ''; };
  // (Finn led a cow through the gate: he is 5 past it, the cow 3-12 behind him)
  W.leading.add('Finn');
  await W.gateTick([bot('Finn', 15.5)] as never, cmd);
  ok(sent.length === 0, `a member leading animals 5 from the gate: it stays open (${sent.length} commands)`);
  W.leading.delete('Finn');
  await new Promise((r) => setTimeout(r, 1600));
  await W.gateTick([bot('Finn', 15.5)] as never, cmd);
  ok(sent.length === 1 && /open=false/.test(sent[0]), `not leading: shut as before (${sent[0] ?? 'none'})`);
  W.wallGates.clear();
});

console.log(fails ? `FAIL ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
