// #231 (the user's, 11-06: "Yes, limit to 64"): the hunt's reach is 64 blocks from the storage hut, beds or not, not the
// built bounds + 32/48 (train 24's hunts fought 51-182 blocks out, median 126 / 94). The ring's walk keeps inside it too.
// Fails on the code before it.
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/fixes_231_reach.mts
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

await sec('the reach', () => {
  const home = { x: 0, y: 64, z: 0 };
  // (a grown village: its built bounds run 90 out from the hut, so the old reach went to 122, 138 with beds)
  ok(C.HUNT_HOME === 64, 'the reach is 64');
  ok(C.huntReachHome(home, null, { x: 60, y: 64, z: 0 }), 'a skeleton 60 out is in reach');
  ok(!C.huntReachHome(home, null, { x: 50, y: 64, z: 50 }), 'one 71 out (diagonal) is not');
  ok(!C.huntReachHome(home, null, { x: 126, y: 64, z: 0 }), "train 24's median distance is out of reach");
  ok(!C.huntReachHome(home, null, { x: 20, y: 40, z: 0 }), "not a cave mob: within 8 of home's height");
  ok(!C.huntReachHome(home, { dist: 40, phase: 'night' }, { x: 50, y: 64, z: 0 }), "never past the curfew's distance");
});

await sec('the walk', () => {
  const home = { x: 0, z: 0 };
  const bounds = { x1: -90, z1: -90, x2: 90, z2: 90 };
  for (const beds of [false, true]) {
    const s = C.huntSpotsHome(C.huntRings(bounds, beds), home);
    ok(s.length >= 6 && s.every((q) => Math.hypot(q.x, q.z) <= C.HUNT_HOME - 8), `a village wider than the reach${beds ? ' (beds)' : ''}: ${s.length} spots, all within 56 of the hut`);
  }
  const small = { x1: -20, z1: -20, x2: 20, z2: 20 };
  const ring = C.huntRings(small, false);
  const s2 = C.huntSpotsHome(ring, home);
  ok(s2.length >= 3 && s2.every((q) => ring.includes(q)), `a small village keeps its ring's spots within the reach (${s2.length} of ${ring.length})`);
});

console.log(fails ? `FAIL ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
