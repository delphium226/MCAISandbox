// #176: the fish skill's choice of water, on the real bank by P1's storage hut (t3_p1b). In train 11 (M) seven trips in a
// row went to -1658,62,-5 and caught nothing: by then the bank there had been filled in (grass at -1659/-1658,62,-6 and
// -1659,62,-5, as world 5 shows in train 12), leaving -1658,62,-5 a one-wide notch a cast flies past onto the grass.
// The blocks are read from the saved worlds (scripts/checks/data/fish_bank_*.json, dumped with region_blocks.py from
// mc/testserver5 in train 12 and from checkpoint t3_p1b) into a fake agent; findFishingCandidates runs unchanged.
// Run: node node_modules/tsx/dist/cli.mjs scripts/checks/fish_spot.mts
import { readFileSync } from 'node:fs';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { findFishingCandidates, markDead } from '../../server/src/mineflayer/foundry/fish';

const reg = minecraftData('26.1');
const byState = (reg as unknown as { blocksByStateId: Record<number, { name: string; boundingBox: string }> }).blocksByStateId;
const stone = reg.blocksByName.stone.defaultState, air = reg.blocksByName.air.defaultState;

function fakeAgent(file: string, pos: Vec3, structures: object[] = []) {
  const j = JSON.parse(readFileSync(new URL(`data/${file}`, import.meta.url), 'utf8')) as { box: number[]; names: string[]; data: number[] };
  const [x1, y1, z1, x2, y2, z2] = j.box;
  const states = j.names.map((n) => reg.blocksByName[n]?.defaultState ?? stone);
  const nx = x2 - x1 + 1, nz = z2 - z1 + 1;
  const state = (x: number, y: number, z: number) => {
    if (x < x1 || x > x2 || z < z1 || z > z2 || y < y1) return y < 63 ? stone : air;
    if (y > y2) return air;
    return states[j.data[((y - y1) * nz + (z - z1)) * nx + (x - x1)]];
  };
  const palette = [...new Set([...states, stone, air])];
  const column = (cx: number, cz: number) => ({
    minY: -64,
    sections: Array.from({ length: 24 }, (_, s) => ({
      palette,
      data: { get: (i: number) => state(cx * 16 + (i & 15), -64 + s * 16 + (i >> 8), cz * 16 + ((i >> 4) & 15)) },
    })),
    getBlockStateId: (q: Vec3) => state(cx * 16 + q.x, q.y, cz * 16 + q.z),
  });
  const world = { registry: reg, villages: { villages: new Map([['P1', { plots: [], structures, layouts: [] }]]) } };
  const bot = {
    entity: { position: pos },
    game: { minY: -64 },
    world: { getColumn: column },
    blockAt: (p: Vec3) => {
      const b = byState[state(p.x, p.y, p.z)];
      return b ? { name: b.name, boundingBox: b.boundingBox, position: p } : null;
    },
  };
  return { name: 'Gus', world, bot } as unknown as Parameters<typeof findFishingCandidates>[0];
}

let bad = 0;
const ok = (cond: boolean, what: string) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
const show = (c: ReturnType<typeof findFishingCandidates>) =>
  c.slice(0, 3).map((k) => `${k.water.x},${k.water.y},${k.water.z} from ${k.stand.x},${k.stand.y},${k.stand.z}`).join('; ') || 'none';
const key = (v: Vec3) => `${v.x},${v.z}`;

// Train 12's world 5 (the filled bank); the bot comes from the north, near the place train 11 gave (-1658, -10)
const a = fakeAgent('fish_bank_train12.json', new Vec3(-1655.5, 64, -9.5));
for (const z of [-10, -6]) {
  const c = findFishingCandidates(a, 32, -1658, 62, z);
  console.log(`  given -1658,62,${z}: ${show(c)}`);
  ok(c.length > 0, `filled bank, given z ${z}: some water is still chosen`);
  ok(!c.some((k) => key(k.water) === '-1658,-5'), `filled bank, given z ${z}: the notch -1658,62,-5 is not a candidate`);
}
// Train 11's M from +75 min: home_544734 (x -1655..-1645, z -22..-10) made the banks of z -10..-8 village ground, so the
// old rules took the notch first
const home = { x1: -1655, z1: -22, x2: -1645, z2: -10, y: 63 };
const m = findFishingCandidates(fakeAgent('fish_bank_train12.json', new Vec3(-1655.5, 64, -9.5), [home]), 32, -1658, 62, -10);
console.log(`  with home_544734, given -1658,62,-10: ${show(m)}`);
ok(m.length > 0 && !m.some((k) => key(k.water) === '-1658,-5'), 'with the new home: water other than the notch');

// A dead spot: the next trip goes elsewhere, and not to a neighbour of it
const first = findFishingCandidates(a, 32, -1658, 62, -10)[0];
markDead(a.world, first.water, true);
const next = findFishingCandidates(a, 32, -1658, 62, -10)[0];
console.log(`  after marking ${key(first.water)} dead: ${next ? show([next]) : 'none'}`);
ok(!!next && Math.max(Math.abs(next.water.x - first.water.x), Math.abs(next.water.z - first.water.z)) > 1, 'a dead spot and its neighbours are passed over');
markDead(a.world, first.water, false);
ok(key(findFishingCandidates(a, 32, -1658, 62, -10)[0].water) === key(first.water), 'a catch there clears it');

// The checkpoint's natural bank (train 10, train 11 before +75 min): the place's -1658,62,-6 still fishes
const b = fakeAgent('fish_bank_t3_p1b.json', new Vec3(-1655.5, 64, -9.5));
const cb = findFishingCandidates(b, 32, -1658, 62, -6);
console.log(`  checkpoint, given -1658,62,-6: ${show(cb)}`);
ok(cb.length > 0 && Math.hypot(cb[0].water.x + 1658, cb[0].water.z + 6) <= 3, 'natural bank: water at the given place is chosen');

console.log(bad ? `${bad} FAILED` : 'all passed');
process.exit(bad ? 1 : 0);
