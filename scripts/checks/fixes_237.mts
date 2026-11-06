// #237 (train 25, F362): all 112 "-> the village edge" stalls aimed at two ring spots, the north and south points of the
// circle round the hut (-1627,73,71 and -1627,70,-25), whose surface stood 6-9 above home: a castle tower on the fence
// ring, a rise. Now huntGround moves each spot onto level, dry ground near home's height, off structures, castle parts and
// fence cells, and drops a spot with none. A model of that village: home at 0,65,0, ground at 64, a tower at the south
// spot, a rise at the north one. Fails on the code before it (no huntGround: the walk aimed at the raised spots).
// Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/fixes_237.mts
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

const home = { x: 0, y: 65, z: 0 };
// (a castle tower 7x7 centred on the south spot, its deck at 72; a hill north from z 44 to 52 at 73; a pond east)
const tower = { x1: -3, z1: 45, x2: 3, z2: 51 };
const inBox = (b: { x1: number; z1: number; x2: number; z2: number }, x: number, z: number) => x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2;
const probe = (x: number, z: number) => {
  if (inBox(tower, x, z)) return { y: 72, liquid: false };
  if (z <= -42 && z >= -60 && Math.abs(x) <= 14) return { y: 73, liquid: false };
  if (x >= 44 && x <= 52 && Math.abs(z) <= 8) return { y: 63, liquid: true };
  return { y: 64, liquid: false };
};
const cols = [];
for (let x = tower.x1; x <= tower.x2; x++) for (let z = tower.z1; z <= tower.z2; z++) cols.push({ x, z, fill: 0, tops: [] });
const v = {
  structures: [{ id: 's1', kind: 'house', builtBy: 'Ada', y: 64, x1: 20, z1: 20, x2: 28, z2: 28 }],
  wall: { state: 'voted', at: 0, rects: [], segs: [], built: { '-10,48': { y: 64, top: 66 }, '-9,48': { y: 64, top: 66 } },
    castle: { state: 'voted', at: 0, parts: [{ id: 't1', kind: 'tower', at: { x: 0, z: 48 }, u: { x: 1, z: 0 }, n: { x: 0, z: -1 }, cols, ring: [] }], done: { t1: { base: 64, gates: [] } } } },
} as unknown as Parameters<typeof C.huntBlocked>[0];

await sec('ring spots', () => {
  ok(typeof C.huntGround === 'function' && typeof C.huntBlocked === 'function', 'huntGround and huntBlocked exist');
  const blocked = C.huntBlocked(v);
  ok(blocked(0, 48) && blocked(4, 52) && !blocked(5, 48), 'the tower and a block round it are kept off');
  ok(blocked(-10, 48) && blocked(-11, 47) && blocked(24, 24) && blocked(19, 19) && !blocked(18, 18), 'fence cells and structures too');
  // (the south spot, on the tower: moved off it onto ground at home's height)
  const s = C.huntGround({ x: 0, z: 48 }, home, probe, blocked);
  ok(s && s.y === 65 && !blocked(s.x, s.z) && Math.hypot(s.x, s.z - 48) <= C.HUNT_GROUND_REACH, `tower spot 0,48 -> ${JSON.stringify(s)}`);
  // (the north spot, on a rise 8 above: nothing level within reach, dropped)
  ok(C.huntGround({ x: 0, z: -48 }, home, probe, blocked) === null, 'rise spot 0,-48 (feet 74, home 65): dropped');
  // (the rise's edge: the cell just inside the reach toward home)
  const edge = C.huntGround({ x: 0, z: -44 }, home, probe, blocked);
  ok(edge && edge.y === 65 && edge.z > -42, `the rise's edge 0,-44 -> ${JSON.stringify(edge)}`);
  // (a pond spot: onto the dry bank)
  const bank = C.huntGround({ x: 48, z: 0 }, home, probe, blocked);
  ok(bank && bank.x < 44 && bank.y === 65, `pond spot 48,0 -> ${JSON.stringify(bank)}`);
  // (open ground: the spot itself)
  const same = C.huntGround({ x: -34, z: 34 }, home, probe, blocked);
  ok(same && same.x === -34 && same.z === 34 && same.y === 65, `open ground stays put (${JSON.stringify(same)})`);
  // (unloaded columns are never chosen)
  ok(C.huntGround({ x: 0, z: 30 }, home, () => null, blocked) === null, 'nothing loaded: none');
  // (train 25's ring: every spot of the circle round the hut gets level ground or is dropped; none on the tower or rise)
  const ring = C.huntSpotsHome([], home);
  const got = ring.map((p) => C.huntGround(p, home, probe, blocked));
  ok(got.every((g) => !g || (g.y === 65 && !blocked(g.x, g.z))), `the circle's ${ring.length} spots: ${got.filter(Boolean).length} on level ground, ${got.filter((g) => !g).length} dropped, none raised`);
});

console.log(fails ? `FAIL ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
