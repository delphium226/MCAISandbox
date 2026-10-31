// Survival stage (c) (mcCombat.ts, spec runs/2026-10-31/survival/spec_c.md): the reflex's decision table (creeper,
// own fight armed/unarmed/low, defend with the 2-defender cap, nobody hurt), the cooldown by weapon and time scale,
// armour's choice, the ahead-cell safety test, the eat-when-hurt choice, the wake throttle, the grounds' torch spots, and
// by mode (a child process each, the settings are read at import): mob drops obtainable only with monsters, fightsMobs
// and armsOn, and the arms goods.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/combat_unit.mts
import { execFileSync } from 'node:child_process';

if (process.env.MODE_CHILD) {
  const C = await import('../../server/src/mineflayer/mcCombat');
  const M = await import('../../server/src/mineflayer/mcMaterials');
  const W = await import('../../server/src/mineflayer/mcWorkshop');
  console.log(JSON.stringify({
    fights: C.fightsMobs(), arms: C.armsOn(), flesh: M.mobDropObtainable('rotten_flesh'), dirt: M.mobDropObtainable('dirt'),
    fleshWhy: M.UNOBTAINABLE.rotten_flesh ?? '', glow: M.UNOBTAINABLE.glowstone_dust ?? '',
    armsGoods: W.ARMS_GOODS.map((g) => g.item), armsTagged: W.ARMS_GOODS.every((g) => g.arms), makeHasArms: W.MAKE_GOODS.some((g) => g.arms),
  }));
} else {
  const { Vec3 } = await import('vec3');
  const C = await import('../../server/src/mineflayer/mcCombat');
  let fails = 0;
  const ok = (cond: unknown, what: string) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
    if (!cond) fails++;
  };

  // The decision table
  const z = (id: number, dist: number, name = 'zombie') => ({ id, name, dist });
  const none = new Map<number, Set<string>>();
  const me = (o: Partial<{ health: number; armed: boolean; hurtAgo: number; mobs: ReturnType<typeof z>[] }>) => ({ health: 20, armed: true, hurtAgo: 99999, mobs: [], ...o });
  ok(C.decide(me({ mobs: [z(1, 3, 'creeper'), z(2, 2)], hurtAgo: 100 }), [], none)?.kind === 'flee', 'a creeper within 5 is fled, before a fight');
  ok(C.decide(me({ mobs: [z(1, 6, 'creeper')] }), [], none) === null, 'a creeper at 6 is left alone');
  ok(C.decide(me({ mobs: [z(2, 3)], hurtAgo: 500 }), [], none)?.kind === 'fight', 'hurt, armed, healthy: fight');
  ok(C.decide(me({ mobs: [z(2, 3)], hurtAgo: 500, armed: false, swordNear: true }), [], none)?.kind === 'shelter', 'hurt, unarmed, a sword in storage: to it');
  ok(C.decide(me({ mobs: [z(2, 3)], hurtAgo: 500, armed: false }), [], none)?.kind === 'fight', 'hurt, unarmed, no sword in storage, healthy: fists');
  ok(C.decide(me({ mobs: [z(2, 3)], hurtAgo: 500, armed: false, health: 9 }), [], none)?.kind === 'shelter', 'hurt, unarmed, health 9: runs');
  const corner = C.decide(me({ mobs: [z(2, 3)], hurtAgo: 500, armed: false, health: 9, ranAgo: 2000 }), [], none);
  ok(corner?.kind === 'fight' && corner.cornered === true, 'ran in the last 5 s: fights, cornered');
  ok(C.decide(me({ mobs: [z(2, 3)], hurtAgo: 500, armed: false, swordNear: true, ranAgo: 2000 }), [], none)?.kind === 'fight', 'a sword in storage but ran just now: fists');
  ok(C.decide(me({ mobs: [z(2, 3)], hurtAgo: 500, health: 8 }), [], none)?.kind === 'shelter', 'hurt, armed, health 8: shelter');
  ok(C.decide(me({ mobs: [z(2, 3)], hurtAgo: 4000 }), [], none) === null, 'a mob near but no hurt in 3 s: nothing');
  ok(C.decide(me({ mobs: [z(2, 6)], hurtAgo: 500 }), [], none) === null, 'hurt, but the mob at 6: nothing');
  const ben = (o: Partial<{ dist: number; hurtAgo: number; mobs: ReturnType<typeof z>[] }> = {}) => ({ name: 'Ben', dist: 5, hurtAgo: 500, mobs: [z(7, 2)], ...o });
  const dd = C.decide(me({ mobs: [z(7, 6)] }), [ben()], none);
  ok(dd?.kind === 'defend' && dd.member === 'Ben' && dd.mob.id === 7, 'a member hurt within 8 with a mob on them: defend');
  ok(C.decide(me({ mobs: [z(7, 6)], armed: false }), [ben()], none) === null, 'unarmed: no defending');
  ok(C.decide(me({ mobs: [z(7, 6)], health: 12 }), [ben()], none) === null, 'health 12: no defending');
  ok(C.decide(me({ mobs: [z(7, 6)] }), [ben({ dist: 9 })], none) === null, 'a member 9 blocks off: no defending');
  ok(C.decide(me({ mobs: [z(7, 6)] }), [ben({ hurtAgo: 3500 })], none) === null, 'a member not hurt in 3 s: no defending');
  ok(C.decide(me({ mobs: [z(7, 6)] }), [ben()], new Map([[7, new Set(['Cy', 'Di'])]])) === null, 'two defend that mob already: no third');
  ok(C.decide(me({ mobs: [z(7, 6)] }), [ben()], new Map([[7, new Set(['Cy'])]]))?.kind === 'defend', 'one defends that mob: a second joins');
  ok(C.decide(me({ mobs: [z(7, 6)] }), [ben({ mobs: [z(7, 2, 'creeper')] })], none) === null, 'no defending against a creeper');

  // Cooldowns
  ok(C.cooldownMs('stone_sword') === 625 && C.cooldownMs('iron_sword', 2) === 313, 'a sword 625 ms, halved at 2x');
  ok(C.cooldownMs('stone_axe') === 1250 && C.cooldownMs('iron_axe') === 1111 && C.cooldownMs('diamond_axe') === 1000, 'axes by material');
  ok(C.cooldownMs(undefined) === 250 && C.cooldownMs('stick', 0.5) === 250, 'a fist 250 ms; a scale under 1 counts as 1');

  // Armour
  const wear = C.armourToWear(['leather_chestplate', 'iron_chestplate', 'iron_helmet', 'stone_sword', 'leather_boots'], { head: 'diamond_helmet', torso: 'leather_chestplate' });
  ok(wear.torso === 'iron_chestplate' && wear.head === undefined && wear.feet === 'leather_boots' && Object.keys(wear).length === 2, `armour: better pieces per slot only (${JSON.stringify(wear)})`);
  ok(C.isArmour('golden_leggings') && !C.isArmour('leather') && C.isWeapon('wooden_axe') && !C.isWeapon('stick'), 'armour and weapon names');

  // The cell ahead
  const world = (cells: Record<string, string>) => (p: InstanceType<typeof Vec3>) => {
    const n = cells[`${p.x},${p.y},${p.z}`] ?? (p.y < 64 ? 'stone' : 'air');
    return { name: n, boundingBox: n === 'air' || n === 'water' || n === 'lava' || n === 'fire' ? 'empty' : 'block' };
  };
  const at64 = new Vec3(0, 64, 0);
  ok(C.safeAhead(world({}), at64), 'flat ground ahead: safe');
  ok(!C.safeAhead(world({ '0,63,0': 'lava' }), at64), 'lava below: unsafe');
  ok(!C.safeAhead(world({ '0,64,0': 'fire' }), at64), 'fire at the feet: unsafe');
  ok(!C.safeAhead(world({ '0,63,0': 'air', '0,62,0': 'air', '0,61,0': 'air' }), at64), 'a drop over 3: unsafe');
  ok(C.safeAhead(world({ '0,63,0': 'air', '0,62,0': 'air' }), at64), 'a drop of 3 onto stone: safe');
  ok(!C.safeAhead(world({ '0,63,0': 'water' }), at64), 'water below: unsafe');
  ok(!C.safeAhead(() => null, at64), 'unloaded: unsafe');

  // Eating when hurt
  ok(C.hurtBite({ bread: 2 }, 19, 10) === 'bread', 'health 10, food 19: eats');
  ok(C.hurtBite({ bread: 2 }, 19, 13) === null, 'health 13: no bite');
  ok(C.hurtBite({ bread: 2 }, 20, 5) === null, 'a full bar: no bite');
  ok(C.hurtBite({ rotten_flesh: 3 }, 12, 5) === null, 'rotten flesh never');

  // The wake throttle
  const seen = new Map<string, number>();
  ok(C.wakeAllowed(seen, 'Ada', 0) && !C.wakeAllowed(seen, 'Ada', 60000) && C.wakeAllowed(seen, 'Ben', 60000) && C.wakeAllowed(seen, 'Ada', 180000), 'a wake per member per 3 minutes');

  // The grounds' torch spots
  const spots = C.groundLightSpots({ x1: 0, z1: 0, x2: 35, z2: 35 }, [{ x: 6, z: 6 }], (x, z) => !(x === 18 && z === 18));
  ok(!spots.some((s) => s.x === 6 && s.z === 6) && spots.length === 8, `a 3x3 grid less the lamp's spot: 8 (${spots.length})`);
  ok(spots.some((s) => s.x === 19 && s.z === 18), 'a blocked spot moves to an open cell beside it');

  // By mode
  const child = (mode: string, extra: Record<string, string> = {}) => JSON.parse(execFileSync(process.execPath, [...process.execArgv, new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], {
    env: { ...process.env, MODE_CHILD: '1', MC_WORLD_MODE: mode, ...extra }, encoding: 'utf-8',
  }).trim().split('\n').pop()!);
  const peace = child('peaceful'), easy = child('easy'), host = child('hostile'), off = child('hostile', { MC_COMBAT: 'off', MC_ARMS: 'off' });
  ok(!peace.fights && !peace.arms && !easy.fights && !easy.arms, 'no reflex or arms without monsters');
  ok(host.fights && host.arms && !off.fights && !off.arms, 'hostile: the reflex and arms on; MC_COMBAT/MC_ARMS=off turn them off');
  ok(!peace.flesh && !easy.flesh && host.flesh && !host.dirt, 'mob drops obtainable only with monsters');
  ok(/none in peaceful/.test(peace.fleshWhy) && /zombies at night/.test(host.fleshWhy) && peace.glow === host.glow, 'the drop words by mode; Nether items unchanged');
  ok(host.armsTagged && !host.makeHasArms && host.armsGoods.includes('stone_sword') && host.armsGoods.includes('iron_chestplate'), 'the arms goods apart from MAKE_GOODS');

  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
}
