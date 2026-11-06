// #235 (train 24, F359): endermen killed 3 members in A2 (Ben outside; Clara and Dev inside the ring by the storage hut):
// a look angered one, members fought it with stone swords at 14 health and lost, and Clara ran to the hut at health 1 with
// it following. Offline, each section fails on the code before the fix:
// - the reflex runs from an enderman that hurt the member (none other within 5), fights back only cornered and armed,
//   fights a zombie beside it first, and never defends a member against one;
// - the gaze guard's test is vanilla's stare (isLookingAtMe) and its turn takes the eyes off;
// - the refuge is a pool of shallow water (all 8 sides wet), not one farm cell.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/fixes_235.mts
import { Vec3 } from 'vec3';

process.env.MC_WORLD_MODE ??= 'hostile';
const C = await import('../../server/src/mineflayer/mcCombat');
let fails = 0;
const ok = (cond: unknown, what: string) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) fails++;
};
const sec = async (name: string, f: () => Promise<void> | void) => {
  try { await f(); } catch (e) { ok(false, `${name}: ${(e as Error).message}`); }
};

await sec('the reflex', () => {
  const ender = { id: 7, name: 'enderman', dist: 2 };
  const me = (o: Partial<Parameters<typeof C.decide>[0]>) => ({ health: 14, armed: true, hurtAgo: 500, mobs: [ender], ...o });
  // (Clara: 14 health, a stone sword, hit by an enderman: the old reflex fought it)
  const d1 = C.decide(me({}), [], new Map());
  ok(d1?.kind === 'evade', `armed at 14 and hit by an enderman: run, not fight (${d1?.kind})`);
  ok(C.decide(me({ armed: false, health: 20 }), [], new Map())?.kind === 'evade', 'unarmed at 20: run (fists against 40 health)');
  const d2 = C.decide(me({ ranAgo: 9000 }), [], new Map());
  ok(d2?.kind === 'fight' && d2.cornered === true, `hit again 9 s after the run, armed: fight back, cornered (${d2?.kind})`);
  ok(C.decide(me({ armed: false, ranAgo: 9000 }), [], new Map())?.kind === 'evade', 'hit again unarmed: run again');
  ok(C.decide(me({ ranAgo: 20000 }), [], new Map())?.kind === 'evade', 'a hit 20 s after the run is a new attack: run');
  const d3 = C.decide(me({ mobs: [ender, { id: 8, name: 'zombie', dist: 3 }] }), [], new Map());
  ok(d3?.kind === 'fight' && d3.mob.name === 'zombie', `a zombie beside it is the attacker fought (${d3?.kind} ${d3?.mob.name})`);
  ok(C.decide(me({ hurtAgo: 10000 }), [], new Map()) === null, 'an enderman near, not hurt: nothing (no fight started)');
  // (Elena defended Clara against it: the old reflex came to a member's help against an enderman)
  const d4 = C.decide({ health: 20, armed: true, hurtAgo: 99999, mobs: [] }, [{ name: 'Clara', dist: 4, hurtAgo: 500, mobs: [ender] }], new Map());
  ok(d4 === null, `no defender against an enderman (${d4?.kind})`);
  const d5 = C.decide({ health: 20, armed: true, hurtAgo: 99999, mobs: [] }, [{ name: 'Clara', dist: 4, hurtAgo: 500, mobs: [{ id: 9, name: 'zombie', dist: 2 }] }], new Map());
  ok(d5?.kind === 'defend', 'a zombie is still defended against');
});

await sec('the gaze guard', () => {
  const eye = { x: 0, y: 65.62, z: 0 };
  const mob = (d: number) => ({ x: d, y: 64 + C.ENDER_EYE, z: 0 });
  // (facing +x: yaw -pi/2)
  const yaw = -Math.PI / 2;
  ok(C.staresAt(eye, yaw, Math.atan2(mob(10).y - eye.y, 10), mob(10)), 'eyes straight at its eyes 10 out: a stare');
  ok(C.staresAt(eye, yaw, 0, mob(30)), 'a level look at one 30 out is a stare (vanilla scales the cone by distance)');
  ok(!C.staresAt(eye, yaw, 0, mob(8)), 'a level look at one 8 out is not');
  ok(!C.staresAt(eye, yaw + Math.PI, 0, mob(30)), 'looking away is not');
  for (const d of [3, 10, 30, 60]) {
    const p = C.avertPitch(eye, mob(d));
    ok(!C.staresAt(eye, yaw, p, mob(d), 0.1), `the guard's turn at ${d} out leaves the wide cone (pitch ${p.toFixed(2)})`);
  }
  const below = { x: 10, y: 60, z: 0 };
  ok(!C.staresAt(eye, yaw, C.avertPitch(eye, below), below, 0.1), 'and for one below the member');
  ok(C.combatCounts.averts === 0 && C.combatCounts.evades === 0, 'the counts start at 0 ([watch] line)');
});

await sec('the water refuge', () => {
  type Cell = { name: string; boundingBox: string } | null;
  const wet = new Set<string>();
  const read = (p: Vec3): Cell => (wet.has(`${p.x},${p.y},${p.z}`) ? { name: 'water', boundingBox: 'empty' } : p.y <= 63 ? { name: 'stone', boundingBox: 'block' } : { name: 'air', boundingBox: 'empty' });
  // (a farm's one water cell 3 out: no refuge)
  wet.add('3,64,0');
  ok(C.waterRefuge(read, new Vec3(0, 64, 0)) === null, 'one farm water cell is no refuge (it hits from the farmland)');
  // (a 3x3 pool centred at 6,64,4)
  for (let x = 5; x <= 7; x++) for (let z = 3; z <= 5; z++) wet.add(`${x},64,${z}`);
  const r = C.waterRefuge(read, new Vec3(0, 64, 0));
  ok(r && r.x === 6 && r.z === 4 && r.y === 64, `a 3x3 pool's middle is the refuge (${r})`);
  ok(C.waterRefuge(read, new Vec3(-20, 64, 0)) === null, 'none past 12 blocks');
});

console.log(fails ? `FAIL ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
