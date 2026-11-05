// Survival stage (c) (mcCombat.ts, spec runs/2026-10-31/survival/spec_c.md): the reflex's decision table (creeper,
// own fight armed/unarmed/low, defend with the 2-defender cap, nobody hurt), the cooldown by weapon and time scale,
// armour's choice, the ahead-cell safety test, the eat-when-hurt choice, the wake throttle, the grounds' torch spots, and
// by mode (a child process each, the settings are read at import): mob drops obtainable only with monsters, fightsMobs
// and armsOn, and the arms goods. Stage (d) (spec_d.md 0-3): the phase by tick, the built bounds and the distance beyond
// them, the distance bins, the guards' cap and loop, the reach by role, the deaths' fact, and the three flags by mode.
// The (d) fixes (#194-#196): when a curfew acts, code's home-by-dusk band and its flag, past the band.
// Stage (d) spec 4 (MC_HUNT): the hunt's target pick, its reach (the edge, home's height, the curfew's band), its flag by
// mode, the plan's words for the drops and the hunt goods. #201: the curfew's tail after dawn; #200: the rings with beds.
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
    grounds: C.groundsLightOn(), safety: C.safetyRulesOn(), guards: C.guardsOn(), home: C.homeByDuskOn(),
    hunt: C.huntOn(), huntPlan: M.HUNT_PLAN, boneWhy: M.UNOBTAINABLE.bone ?? '', huntGoods: W.HUNT_GOODS.map((g) => g.item),
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
  // (with the hunt, spec 4, its words; without it, the drops' own)
  ok(/none in peaceful/.test(peace.fleshWhy) && /night hunt/.test(host.fleshWhy) && /zombies at night/.test(child('hostile', { MC_HUNT: 'off' }).fleshWhy) && peace.glow === host.glow, 'the drop words by mode; Nether items unchanged');
  const dOff = child('hostile', { MC_GROUNDS_LIGHT: 'off', MC_SAFETY_RULES: 'off', MC_GUARDS: 'off' }), noFight = child('hostile', { MC_COMBAT: 'off' });
  ok(!peace.grounds && !peace.safety && !peace.guards && !easy.grounds && !easy.safety && !easy.guards, 'stage (d): nothing without monsters');
  ok(host.grounds && host.safety && host.guards && !dOff.grounds && !dOff.safety && !dOff.guards, 'stage (d): on by default with monsters; each flag off turns it off');
  ok(!noFight.guards && noFight.grounds, 'no guards without the combat reflex');
  const homeOff = child('hostile', { MC_HOME_BY_DUSK: 'off' });
  ok(!peace.home && !easy.home && host.home && !homeOff.home, '#194: home by dusk only with monsters, on by default, off by its flag');
  ok(host.armsTagged && !host.makeHasArms && host.armsGoods.includes('stone_sword') && host.armsGoods.includes('iron_chestplate'), 'the arms goods apart from MAKE_GOODS');

  // Stage (d): the phase, the bounds and bins
  ok(C.phaseOf(6000) === 'day' && C.phaseOf(11500) === 'dusk' && C.phaseOf(13000) === 'night' && C.phaseOf(23458) === 'night' && C.phaseOf(23600) === 'day' && C.phaseOf(undefined) === 'day', 'the phase by tick (dusk from 11000, the bed\'s night)');
  ok(C.fromPhase(11500, 'dusk') && !C.fromPhase(11500, 'night') && C.fromPhase(13000, 'night') && !C.fromPhase(1000, 'dusk'), 'a band from dusk or from nightfall until dawn');
  const vb = { layouts: [{ x1: 0, z1: 0, x2: 40, z2: 30, buildings: [] }, { x1: 50, z1: -20, x2: 80, z2: 10, buildings: [] }, { x1: 200, z1: 200, x2: 220, z2: 220, buildings: [], field: true }], structures: [{ x1: -5, z1: 5, x2: 2, z2: 12 }] } as never;
  const bb = C.builtBounds(vb)!;
  ok(bb.x1 === -5 && bb.z1 === -20 && bb.x2 === 80 && bb.z2 === 30, 'the built bounds: layouts and structures, fields left out');
  ok(C.builtBounds({ layouts: [], structures: [] } as never) === null, 'no bounds with nothing built');
  ok(C.beyond(bb, 10, 10) === 0 && C.beyond(bb, 96, 10) === 0 && C.beyond(bb, 100, 10) === 4 && Math.abs(C.beyond(bb, 99, 49) - Math.hypot(3, 3)) < 1e-9, 'beyond the bounds + 16 (0 inside, the corner by its diagonal)');
  ok(C.beyond(bb, 81, 10, 0) === 1, 'beyond the bounds alone with margin 0');
  ok(C.distBin(0) === '<48' && C.distBin(47.9) === '<48' && C.distBin(48) === '48-100' && C.distBin(100) === '100-200' && C.distBin(150) === '100-200' && C.distBin(200) === '200+', 'the distance bins');
  ok(C.deathsFact({ '100-200': 3, '200+': 1, '<48': 1 }, { night: 4, day: 1 }) === '4 of 5 deaths were on trips over 100 blocks out, 4 after dark', 'the deaths\' fact');
  ok(C.deathsFact({}, {}) === '' && /none on far trips/.test(C.deathsFact({ '<48': 2 }, { night: 2 })), 'the deaths\' fact with none, and near home');
  // The guards: the cap, the reach, the loop
  ok(C.guardCap(1) === 1 && C.guardCap(6) === 1 && C.guardCap(12) === 2 && C.guardCap(25) === 4, 'one guard per 6 members, one at least');
  const hurtFar = [{ name: 'Ada', dist: 20, hurtAgo: 500, mobs: [z(9, 2)] }];
  ok(C.decide(me({}), hurtFar, none) === null, 'a member hurt 20 blocks off: no defence at the default reach of 8');
  ok(C.decide(me({}), hurtFar, none, C.GUARD_REACH)?.kind === 'defend', 'a guard defends within 24');
  ok(C.decide(me({}), [{ name: 'Ada', dist: 25, hurtAgo: 500, mobs: [z(9, 2)] }], none, C.GUARD_REACH) === null, 'not past 24');
  ok(C.decide(me({}), hurtFar, new Map([[9, new Set(['A', 'B'])]]), C.GUARD_REACH) === null, 'the 2-defender cap holds for guards');
  const box = { x1: 0, z1: 0, x2: 60, z2: 60 };
  const grid = [{ x: 6, z: 6 }, { x: 30, z: 30 }, { x: 54, z: 6 }, { x: 54, z: 54 }, { x: 6, z: 54 }, { x: 30, z: 4 }];
  const loop = C.watchLoop(box, [{ x: 30, z: 58 }], grid);
  ok(!loop.some((q) => q.x === 30 && q.z === 30) && loop.length === 6, 'the loop: lamps and edge spots, not the middle');
  const ang = loop.map((q) => Math.atan2(q.z - 30, q.x - 30));
  ok(ang.every((x, i) => i === 0 || x >= ang[i - 1]), 'the loop in order round the centre');
  const many = Array.from({ length: 40 }, (_, i) => ({ x: i, z: 0 }));
  ok(C.watchLoop(box, many, []).length === 16, 'at most 16 spots');
  ok(C.watchLoop(box, [{ x: 1, z: 1 }, { x: 1, z: 1 }], []).length === 1, 'a spot once');
  // #196: a curfew acts ahead of its phase (a nightfall one from dusk, a dusk one CURFEW_LEAD before), until dawn
  ok(C.curfewActs(11500, 'night') && C.curfewActs(13000, 'night') && !C.curfewActs(10500, 'night') && !C.curfewActs(6000, 'night'), 'a nightfall curfew acts from dusk');
  ok(C.curfewActs(10000, 'dusk') && C.curfewActs(10500, 'dusk') && !C.curfewActs(9999, 'dusk') && C.curfewActs(20000, 'dusk') && !C.curfewActs(6000, 'dusk') && !C.curfewActs(undefined, 'dusk'), 'a dusk curfew acts from 1000 ticks before dusk, until dawn');
  // (#201: until CURFEW_TAIL after dawn, a slept night's 0 included)
  ok(C.CURFEW_TAIL === 3600 && C.curfewActs(23600, 'dusk') && C.curfewActs(0, 'night') && C.curfewActs(3000, 'dusk') && !C.curfewActs(3100, 'night') && !C.curfewActs(9000, 'night'), 'a curfew acts until 3600 ticks after dawn (#201)');
  // #194: code's band, past the built bounds + 16
  const hb = C.homeBand(vb)!;
  ok(hb.code && hb.phase === 'dusk' && hb.box?.x2 === 80 && C.homeBand({ layouts: [], structures: [] } as never) === null, 'home by dusk: the built bounds, from dusk; none without bounds');
  ok(!C.pastBand(hb, { x: 0, z: 0 }, 90, 10) && C.pastBand(hb, { x: 0, z: 0 }, 100, 10) && C.pastBand({ dist: 64, phase: 'night' }, { x: 0, z: 0 }, 65, 0) && !C.pastBand({ dist: 64, phase: 'night' }, { x: 0, z: 0 }, 60, 0), "past the band: the box + 16, or the rule's distance from home");
  ok(/no member has a bed/.test(C.bandWords(hb)) && C.bandWords({ dist: 64, phase: 'night' }) === 'the curfew: no trips past 64 blocks after nightfall', "the band's words");
  // #195: once a member a night
  const dn = C.dangerOf('UV');
  ok(!C.watchedTonight('UV', 'Ada') && C.WATCH_HEALTH === 12 && dn.night.at === 0, 'not watched tonight before a watch');

  // Spec 4: the hunt
  const huntOff = child('hostile', { MC_HUNT: 'off' });
  ok(!peace.hunt && !easy.hunt && host.hunt && !huntOff.hunt && !noFight.hunt, 'the hunt only with monsters and the combat reflex, on by default, off by its flag');
  ok(host.huntPlan && !huntOff.huntPlan && !peace.huntPlan && /night hunt/.test(host.boneWhy) && !/night hunt/.test(huntOff.boneWhy) && /none in peaceful/.test(peace.boneWhy), "the plan names the hunt for bone with it on, the old words without");
  ok(host.huntGoods.includes('fishing_rod') && host.huntGoods.includes('bone_meal'), 'the hunt goods: rods and bone meal');
  const sp = (id: number, name: string, dist: number, x = 10, z = 10, y = 64) => ({ id, name, dist, x, y, z });
  const all = () => true;
  ok(C.huntTarget([sp(1, 'zombie', 3), sp(2, 'skeleton', 20), sp(3, 'spider', 12)], all)?.id === 3, 'the nearest skeleton or spider before a nearer zombie');
  ok(C.huntTarget([sp(1, 'zombie', 9), sp(2, 'husk', 4)], all)?.id === 2, 'zombies when no prey: the nearest');
  ok(C.huntTarget([sp(1, 'creeper', 2), sp(2, 'enderman', 3), sp(3, 'witch', 4)], all) === null, 'never a creeper, an enderman or a witch');
  ok(C.huntTarget([sp(1, 'skeleton', 5, 500, 500)], (m) => m.x < 100) === null, 'none out of reach');
  ok(C.huntTarget([sp(1, 'skeleton', 5, 500, 500), sp(2, 'zombie', 9)], (m) => m.x < 100)?.id === 2, 'a zombie in reach before prey out of it');
  const hb2 = { x1: 0, z1: 0, x2: 60, z2: 60 }, home2 = { x: 30, y: 64, z: 30 };
  ok(C.huntReach(hb2, home2, null, { x: 90, y: 64, z: 30 }) && !C.huntReach(hb2, home2, null, { x: 93, y: 64, z: 30 }), 'the reach: the bounds + 32');
  ok(!C.huntReach(hb2, home2, null, { x: 30, y: 40, z: 30 }) && C.huntReach(hb2, home2, null, { x: 30, y: 71, z: 30 }), "not a cave mob: within 8 of home's height");
  ok(!C.huntReach(hb2, home2, { dist: 50, phase: 'night' }, { x: 85, y: 64, z: 30 }) && C.huntReach(hb2, home2, { dist: 64, phase: 'night' }, { x: 85, y: 64, z: 30 }), "never past the curfew's distance");
  ok(!C.huntReach(hb2, home2, C.homeBand({ layouts: [{ ...hb2, buildings: [] }], structures: [] } as never), { x: 80, y: 64, z: 30 }) && C.huntReach(hb2, home2, C.homeBand({ layouts: [{ ...hb2, buildings: [] }], structures: [] } as never), { x: 75, y: 64, z: 30 }), "home by dusk's band: the bounds + 16");
  const ring = C.huntRing(hb2);
  ok(ring.length === 16 && ring.every((q) => C.beyond(hb2, q.x, q.z, 0) > 11 && C.beyond(hb2, q.x, q.z) === 0), "the hunt's ring: 12 outside the bounds, inside home by dusk's 16, a spot every ~24");
  // (#200: with beds, rings 24 and 32 in turn, the reach the bounds + 48)
  const rings = C.huntRings(hb2, true), b0 = C.huntRings(hb2, false);
  const cheb = (q: { x: number; z: number }) => Math.max(hb2.x1 - q.x, q.x - hb2.x2, hb2.z1 - q.z, q.z - hb2.z2);
  ok(b0.length === 16 && rings.length === 40 && rings.filter((_, i) => i % 2 === 0).every((q) => cheb(q) === 24) && rings.filter((_, i) => i % 2).every((q) => cheb(q) === 32), 'with beds the hunt walks rings 24 and 32 in turn (#200); without, the 12 ring');
  ok(C.HUNT_EDGE_BEDS === 48 && C.huntReach(hb2, home2, null, { x: 105, y: 64, z: 30 }, C.HUNT_EDGE_BEDS) && !C.huntReach(hb2, home2, null, { x: 105, y: 64, z: 30 }), 'with beds the reach is the bounds + 48');
  ok(C.HUNT_HEALTH === 14 && !C.huntedTonight('UV', 'Ada') && C.huntHold() === 0 && C.HUNTED_NOT_BOUGHT.has('string') && C.HUNTED_NOT_BOUGHT.has('bone') && !C.HUNTED_NOT_BOUGHT.has('gunpowder'), 'the hunt starts above 14; no hold with nobody out; gunpowder stays bought');

  // (#217 step 6: the aim; a full-charge arrow reaches the target's height at 10, 16 and 24 out, level, below a wall and above)
  const A = await import('../../server/src/mineflayer/mcArchery');
  for (const [d, dy] of [[10, 0], [16, -5], [24, -6], [24, 2]] as const) {
    const p = A.aimPitch(d, dy);
    const h = p === null ? null : A.arrowHeightAt(p, d);
    ok(p !== null && h !== null && Math.abs(h - dy) < 0.05 && Math.abs(p) < 0.5, `aim at ${d} out, ${dy} up: pitch ${p?.toFixed(3)}, arrives at ${h?.toFixed(2)}`);
  }
  ok(A.aimPitch(200, 0) === null, "no aim past the arrow's reach");
  ok(A.nearLine({ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 10, y: 1, z: 1 }) && !A.nearLine({ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 10, y: 0, z: 3 }) && !A.nearLine({ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, { x: 25, y: 0, z: 0 }), 'a friend within 2 of the line holds the shot, one 3 off or past the target does not');

  console.log(fails ? `${fails} FAILED` : 'all passed');
  process.exit(fails ? 1 : 0);
}
