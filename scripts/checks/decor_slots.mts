/**
 * #141's house decoration slots checked offline (spec runs/2026-10-27/houses/spec.md 5; no server, seconds with the jar):
 * decorSlots (streetPlan.ts) after the basics and the furniture (buildingDecor with `basics`, as mcWorld.decorParts calls
 * it), on the 24 members' own homes of the plains family (houseStyle.ts ownHomes, today's size or MC_BIG_HOUSES's) and on
 * every vanilla house of the five biomes, at four turns, with the building's lights and sign:
 * - every slot an air cell ("." in the grid) off the basics', furniture's, lights' and sign's cells;
 * - a floor slot over a floor ("_" or a block), a wall slot's banner backed by a solid block (its facing away from it),
 *   a ceiling slot under a solid block at layer 3 or up, a surface slot over a basics table or a full-block piece;
 * - 2 to 6 slots a house (8 with MC_DECOR_MORE, on: the villageReads count), at least 2 in every generated home (#141: "a
 *   floor of 2-3 even in a small house"); the default count's slots the first of MC_DECOR_MORE's;
 * - MC_HOME_FLOORS (on): no bare floor cell in a generated home, and on the same home drawn with floor none (the earlier
 *   draws) bareFloorCells gives every inside cell, each a "_" floor under a "." cell, the same at every turn;
 * - the same slots, turned, at every turn; two calls equal.
 * Prints per group the slots a house and by kind. Exits non-zero on any failure.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/decor_slots.mts   (MC_BIG_HOUSES=both for the bigger homes)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const SP = await import('../../server/src/streetPlan');
const VP = await import('../../server/src/vanillaPieces');
const { hasJar } = await import('../../server/src/vanillaData');
const { HOME_FLOORS, ownHomes } = await import('../../server/src/houseStyle');
const { DECOR_MORE } = await import('../../server/src/choose');
const { generateDesign } = await import('../../server/src/buildingGen');
const MORE = DECOR_MORE ? { per: 5, max: 8 } : {};
const { NAME_POOL } = await import('../../server/src/agentNames');
type Design = import('../../server/src/village').Design;

let failures = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 60) console.log(`FAIL ${what}`);
  }
};
const CW: Record<string, string> = { north: 'east', east: 'south', south: 'west', west: 'north' };
const STEP: Record<string, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const turnCell = (i: number, j: number, w: number, d: number, rot: number): [number, number] => {
  let [u, q, ww, dd] = [i, j, w, d];
  for (let r = 0; r < rot; r++) [u, q, ww, dd] = [dd - 1 - q, u, dd, ww];
  return [u, q];
};
interface Place { design: Design; x: number; z: number; rot: number }
function grid(p: Place) {
  const d = p.design, rot = ((p.rot % 4) + 4) % 4;
  const W = rot % 2 ? d.depth : d.width, D = rot % 2 ? d.width : d.depth;
  const x1 = p.x - Math.floor(W / 2), z1 = p.z - Math.floor(D / 2);
  const cells = new Map<string, string>(), back = new Map<string, [number, number]>();
  d.layers.forEach((layer, l) => layer.forEach((row, j) => [...row].forEach((ch, i) => {
    const [u, q] = turnCell(i, j, d.width, d.depth, rot);
    cells.set(`${x1 + u},${l},${z1 + q}`, ch === '_' || ch === '.' ? ch : d.palette[ch] ?? 'air');
    back.set(`${x1 + u},${z1 + q}`, [i, j]);
  })));
  return { cells, back };
}
const solid = (b: string | undefined) => !!b && b !== '.' && b !== '_' && b !== 'air';

const groups: Array<{ name: string; designs: Array<{ d: Design; lights?: Any[]; gen: boolean }> }> = [];
groups.push({ name: `gen homes (MC_BIG_HOUSES=${process.env.MC_BIG_HOUSES ?? 'off'})`, designs: [0, 4, 8, 12, 16, 20].flatMap((i) => ownHomes(NAME_POOL.slice(i, i + 4), 'plains')).map((d) => ({ d, gen: true })) });
if (hasJar()) {
  const v: Array<{ d: Design; lights?: Any[]; gen: boolean }> = [];
  for (const biome of VP.VILLAGE_BIOMES)
    for (const p of VP.listPieces(undefined, biome, 'houses')) {
      try {
        const imp = VP.pieceToDesign(VP.readPiece(p), biome);
        v.push({ d: imp.design, lights: imp.lights, gen: false });
      } catch {
        // (pieces the importer refuses are not in any library)
      }
    }
  groups.push({ name: 'vanilla houses', designs: v });
} else console.log('no jar: vanilla houses not checked');

let floored = 0;
for (const g0 of groups) {
  let houses = 0, slots = 0, two = 0;
  const kinds: Record<string, number> = {};
  for (const { d, lights: vl, gen } of g0.designs) {
    let first: string | null = null;
    houses++;
    for (let rot = 0; rot < 4; rot++) {
      const place: Place = { design: d, x: 37, z: -55, rot };
      const g = grid(place);
      const at = (x: number, l: number, z: number) => g.cells.get(`${x},${l},${z}`);
      const sign = SP.placeSigns([place as Any])[0];
      const signs = sign ? [sign] : [];
      const lights = SP.buildingLights(place as Any, { vanilla: vl ?? null, signs: signs as Any });
      const basics: Any = {};
      const spots = SP.buildingDecor(place as Any, 'oak', { lights, signs: signs as Any, basics });
      const b = basics.out ?? {};
      const taken: Array<{ x: number; layer: number; z: number }> = [], surfaces: Array<{ x: number; layer: number; z: number }> = [];
      for (const q of spots) {
        taken.push({ x: q.x, layer: q.layer, z: q.z });
        if (q.also) taken.push({ x: q.x, layer: q.also.layer, z: q.z });
        else if (/^(crafting_table|barrel)/.test(q.block)) surfaces.push({ x: q.x, layer: q.layer + 1, z: q.z });
      }
      if (b.bed) taken.push({ x: b.bed.x, layer: 1, z: b.bed.z }, { x: b.bed.foot.x, layer: 1, z: b.bed.foot.z });
      if (b.chest) taken.push({ x: b.chest.x, layer: 1, z: b.chest.z });
      if (b.table) {
        taken.push({ x: b.table.x, layer: 1, z: b.table.z });
        surfaces.unshift({ x: b.table.x, layer: 2, z: b.table.z });
      }
      const s = SP.decorSlots(place as Any, { taken, surfaces, lights, signs: signs as Any, ...MORE });
      ok(JSON.stringify(s) === JSON.stringify(SP.decorSlots(place as Any, { taken, surfaces, lights, signs: signs as Any, ...MORE })), `${d.name} rot ${rot}: two calls differ`);
      const s0 = SP.decorSlots(place as Any, { taken, surfaces, lights, signs: signs as Any });
      ok(JSON.stringify(s0) === JSON.stringify(s.slice(0, s0.length)), `${d.name} rot ${rot}: the default count's slots are not the first of MC_DECOR_MORE's`);
      // (MC_HOME_FLOORS: a generated home has its floor; the same home drawn with floor none leaves every inside cell bare)
      if (gen) {
        const bare = SP.bareFloorCells(place as Any);
        if (HOME_FLOORS) ok(!bare.length || /earth floor/.test(d.description), `${d.name} rot ${rot}: ${bare.length} bare floor cells`);
        if (rot === 0) floored += bare.length ? 0 : 1;
        const none = generateDesign({ ...(d.style as Any), floor: 'none' });
        const np: Place = { design: none, x: 37, z: -55, rot };
        const ng = grid(np);
        const nb = SP.bareFloorCells(np as Any);
        const inside = none.layers[1].reduce((t: number, row: string, j: number) => t + [...row].filter((ch, i) => ch === '.' && none.layers[0][j][i] === '_').length, 0);
        ok(nb.length === inside && inside > 0, `${d.name} rot ${rot}: drawn with floor none, ${nb.length} bare cells of ${inside} inside`);
        for (const c of nb) ok(ng.cells.get(`${c.x},0,${c.z}`) === '_' && ng.cells.get(`${c.x},1,${c.z}`) === '.', `${d.name} rot ${rot}: bare cell ${c.x},${c.z} is not a "_" floor under a "." cell`);
      }
      const blocked = new Set([...taken, ...lights, ...signs].map((c: Any) => `${c.x},${c.layer},${c.z}`));
      const tops = new Set(surfaces.map((c) => `${c.x},${c.layer},${c.z}`));
      for (const q of s) {
        const k = `${q.x},${q.layer},${q.z}`;
        ok(at(q.x, q.layer, q.z) === '.', `${d.name} rot ${rot}: ${q.kind} slot at ${k} is on "${at(q.x, q.layer, q.z)}", not air`);
        ok(!blocked.has(k), `${d.name} rot ${rot}: ${q.kind} slot at ${k} on a taken cell`);
        if (q.kind === 'floor') { const u = at(q.x, q.layer - 1, q.z); ok(u === '_' || solid(u), `${d.name} rot ${rot}: carpet at ${k} over "${u}"`); }
        if (q.kind === 'wall') {
          const [a, c] = STEP[CW[CW[q.facing!]]];
          ok(solid(at(q.x + a, q.layer, q.z + c)), `${d.name} rot ${rot}: banner at ${k} facing ${q.facing} has no wall behind`);
        }
        if (q.kind === 'ceiling') ok(q.layer >= 3 && solid(at(q.x, q.layer + 1, q.z)), `${d.name} rot ${rot}: lantern at ${k} not under a ceiling`);
        if (q.kind === 'surface') ok(tops.has(k), `${d.name} rot ${rot}: surface at ${k} is not a piece's top`);
      }
      ok(s.length <= (DECOR_MORE ? 8 : 6), `${d.name} rot ${rot}: ${s.length} slots`);
      if (gen) ok(s.length >= 2, `${d.name} rot ${rot}: a generated home with ${s.length} slots`);
      const sig = JSON.stringify(s.map((q) => [...g.back.get(`${q.x},${q.z}`)!, q.layer, q.kind]).sort());
      if (rot === 0) {
        first = sig;
        slots += s.length;
        if (s.length >= 2) two++;
        for (const q of s) kinds[q.kind] = (kinds[q.kind] ?? 0) + 1;
      } else ok(sig === first, `${d.name} rot ${rot}: slots differ from rot 0's`);
    }
  }
  console.log(`${g0.name}: ${houses} houses, ${(slots / Math.max(1, houses)).toFixed(1)} slots a house, ${two} with 2 or more; ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`);
}
console.log(`floors (MC_HOME_FLOORS ${HOME_FLOORS ? 'on' : 'off'}): ${floored} generated homes with no bare floor cell; slots by MC_DECOR_MORE ${DECOR_MORE ? 'on (one a 5 cells, 8 at most)' : 'off (one a 8 cells, 6 at most)'}`);
console.log(failures ? `FAIL decor_slots: ${failures} of ${checks} checks failed` : `PASS decor_slots: ${checks} checks`);
process.exit(failures ? 1 : 0);
