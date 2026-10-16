/**
 * X.1's furniture spots checked offline (runs/2026-10-16/s34/spec_x1_v2.md B; no server, seconds with the jar):
 * buildingDecor (streetPlan.ts) on every vanilla house of the five biomes as the jar imports it, at four turns, with the
 * building's own lights (buildingLights with vanilla's cells) and sign: every spot inside the grid's area at layer 1 on a
 * "." cell with "." over it (a table's plate there), off every door and its 4 neighbours, off the entrance's inside cell
 * and its neighbours, off the lights' and the sign's cells; the inside cells the entrance reached before still reached;
 * a chair's stair backing onto a wall (its `facing` side), a smoker or furnace facing away from one, a grindstone along
 * one, judged on a grid built here (states turned as build_design turns them); at most clamp(inside / 6, 1, 8) spots;
 * the same spots, turned, at every turn (without lights, and with them where the lights are themselves rot 0's turned);
 * two calls equal. Prints per-biome totals. Exits non-zero on any failure.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/decor_check.mts   (VERBOSE=1: every house's spots)
 */
const VERBOSE = !!process.env.VERBOSE;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const SP = await import('../../server/src/streetPlan');
const VP = await import('../../server/src/vanillaPieces');
const { hasJar } = await import('../../server/src/vanillaData');
type Design = import('../../server/src/village').Design;

let failures = 0, checks = 0;
const say = (s: string) => console.log(s);
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) {
    failures++;
    if (failures <= 60) say(`FAIL ${what}`);
  }
};

// ---- a placed building's grid, on its own (build_design's turn, block states turned with it) --------------------------
const base = (b: string | undefined) => String(b ?? '').replace(/^minecraft:/, '').replace(/[[{].*$/, '');
const stateOf = (b: string | undefined, k: string) => new RegExp(`[[,]${k}=([a-z_]+)`).exec(String(b ?? ''))?.[1];
const CW: Record<string, string> = { north: 'east', east: 'south', south: 'west', west: 'north' };
const ACW: Record<string, string> = { north: 'west', west: 'south', south: 'east', east: 'north' };
const STEP: Record<string, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const turnF = (f: string | undefined, rot: number) => { let g = f; for (let r = 0; g && r < rot; r++) g = CW[g]; return g; };
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
  const cells = new Map<string, string>();
  const back = new Map<string, [number, number]>();
  d.layers.forEach((layer, l) => layer.forEach((row, j) => [...row].forEach((ch, i) => {
    const [u, q] = turnCell(i, j, d.width, d.depth, rot);
    let b = ch === '_' || ch === '.' ? ch : d.palette[ch] ?? 'air';
    const f = stateOf(b, 'facing');
    if (f && STEP[f]) b = b.replace(`facing=${f}`, `facing=${turnF(f, rot)}`);
    cells.set(`${x1 + u},${l},${z1 + q}`, b);
    back.set(`${x1 + u},${z1 + q}`, [i, j]);
  })));
  return { x1, z1, x2: x1 + W - 1, z2: z1 + D - 1, cells, back };
}
const isDoor = (b: string | undefined) => /_door$/.test(base(b));
/** A wall's block: anything standing that is not a way through or a thin thing on the floor. */
const wallish = (b: string | undefined) => !!b && b !== '.' && b !== '_' && !/^(air|cave_air)$|_door$|_trapdoor$|_fence_gate$|torch|lantern|carpet|_button$|_pressure_plate$|_sign$|_banner$|_bed$|rail$/.test(base(b));

// ---- the pieces ------------------------------------------------------------------------------------------------------
const WOOD: Record<string, string> = { plains: 'oak', savanna: 'acacia', snowy: 'spruce', taiga: 'spruce', desert: 'birch' };
const pieces: Array<{ biome: string; design: Design; lights: Any[] }> = [];
if (!hasJar()) {
  say('no jar: nothing to check');
  process.exit(1);
}
for (const biome of VP.VILLAGE_BIOMES)
  for (const p of VP.listPieces(undefined, biome, 'houses')) {
    try {
      const imp = VP.pieceToDesign(VP.readPiece(p), biome);
      pieces.push({ biome, design: imp.design, lights: imp.lights });
    } catch {
      // (pieces the importer refuses are not in any library)
    }
  }

const totals: Record<string, { pieces: number; spots: number; zero: number; short: number; tables: number; litTurns: number }> = {};
const kinds = new Map<string, number>();
for (const pc of pieces) {
  const d = pc.design, wood = WOOD[pc.biome];
  const t = (totals[pc.biome] ??= { pieces: 0, spots: 0, zero: 0, short: 0, tables: 0, litTurns: 0 });
  t.pieces++;
  const inside = (d.layers[1] ?? []).reduce((n, row) => n + [...row].filter((c) => c === '.').length, 0);
  const want = Math.max(1, Math.min(8, Math.floor(inside / 6)));
  let first: { bare: string[]; lit: string[]; lights: string[] } | null = null;
  for (let rot = 0; rot < 4; rot++) {
    const place: Place = { design: d, x: 37, z: -55, rot };
    const g = grid(place);
    const at = (x: number, l: number, z: number) => g.cells.get(`${x},${l},${z}`);
    const sign = SP.placeSigns([place as Any])[0];
    const signs = sign ? [sign] : [];
    const lights = SP.buildingLights(place as Any, { vanilla: pc.lights, signs: signs as Any });
    const spots = SP.buildingDecor(place as Any, wood, { lights, signs: signs as Any });
    const bare = SP.buildingDecor(place as Any, wood);
    ok(JSON.stringify(spots) === JSON.stringify(SP.buildingDecor(place as Any, wood, { lights, signs: signs as Any })), `${d.name} rot ${rot}: two calls differ`);
    const label = `${d.name} rot ${rot}`;
    ok(spots.length <= want, `${label}: ${spots.length} spots, at most ${want}`);
    // The doors, the entrance's inside cell
    const doorCells: Array<[number, number]> = [];
    for (const [k, b] of g.cells) { const [x, l, z] = k.split(',').map(Number); if (l === 1 && isDoor(b)) doorCells.push([x, z]); }
    const ent = SP.placedDoor(place as Any)!;
    const inX = ent.x - ent.ox, inZ = ent.z - ent.oz;
    const offLimits = new Set<string>();
    for (const [x, z] of [...doorCells, [inX, inZ] as [number, number]]) for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) offLimits.add(`${x + a},${z + b}`);
    const lightAt = new Set([...lights, ...signs].filter((s) => s.layer === 1 || s.layer === 2).map((s) => `${s.x},${s.z}`));
    const seen = new Set<string>();
    for (const s of [...spots, ...bare]) {
      const where = `${label}: ${s.block} at ${s.x},${s.layer},${s.z}`;
      ok(s.x >= g.x1 && s.x <= g.x2 && s.z >= g.z1 && s.z <= g.z2, `${where} outside the grid's area`);
      ok(s.layer === 1 && at(s.x, 1, s.z) === '.' && at(s.x, 2, s.z) === '.', `${where}: not a "." cell with "." over it`);
      ok(!offLimits.has(`${s.x},${s.z}`), `${where}: on or next to a door or the entrance's inside cell`);
      const f = stateOf(s.block, 'facing');
      const wallAt = (dir: string) => { const [a, b] = STEP[dir]; return wallish(at(s.x + a, 1, s.z + b)) && wallish(at(s.x + a, 2, s.z + b)); };
      const n = base(s.block);
      if (/_stairs$/.test(n)) ok(f && wallAt(f) && stateOf(s.block, 'half') === 'bottom', `${where}: the chair's back is not on a wall`);
      else if (n === 'smoker' || n === 'furnace') ok(f && wallAt(CW[CW[f]]), `${where}: does not face away from a wall`);
      else if (n === 'grindstone') ok(f && stateOf(s.block, 'face') === 'floor' && wallAt(ACW[f]), `${where}: does not run along a wall`);
      else if (n === 'barrel') ok(f === 'up', `${where}: a barrel not facing up`);
      else ok(!f, `${where}: a facing on a block that takes none`);
      ok(base(s.item) === n, `${where}: item ${s.item}`);
      if (/_fence$/.test(n)) ok(s.also && s.also.layer === 2 && s.also.block === `${wood}_pressure_plate` && s.also.item === s.also.block, `${where}: a table without its plate`);
      ok(/^(crafting_table|barrel|smoker|grindstone|composter|furnace)$/.test(n) || n === `${wood}_stairs` || n === `${wood}_fence`, `${where}: not one of the pieces in the village's wood`);
    }
    for (const s of spots) {
      const k = `${s.x},${s.z}`;
      ok(!seen.has(k), `${label}: ${k} twice`);
      seen.add(k);
      ok(!lightAt.has(k), `${label}: ${s.block} at ${k} on a light's or the sign's cell`);
    }
    // Connectivity: the inside cells the entrance reached (through its door) still reached
    const reach = (used: Set<string>) => {
      const got = new Set<string>(), queue: Array<[number, number]> = [[ent.x, ent.z]];
      while (queue.length) {
        const [x, z] = queue.pop()!;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${x + a},${z + b}`;
          if (got.has(k) || used.has(k) || at(x + a, 1, z + b) !== '.') continue;
          got.add(k);
          queue.push([x + a, z + b]);
        }
      }
      return got;
    };
    const before = reach(new Set());
    for (const list of [spots, bare]) {
      const used = new Set(list.map((s) => `${s.x},${s.z}`));
      const after = reach(used);
      const cut = [...before].filter((k) => !used.has(k) && !after.has(k));
      ok(!cut.length, `${label}: furniture cuts ${cut.length} inside cells off the entrance (${cut.slice(0, 4).join(' ')})`);
    }
    // The same spots at every turn, in the design's cells (facings turned back)
    const key = (s: Any) => {
      const [i, j] = g.back.get(`${s.x},${s.z}`) ?? [-1, -1];
      const f = stateOf(s.block, 'facing');
      const f0 = f && STEP[f] ? turnF(f, (4 - rot) % 4) : f;
      return `${i},${j}:${f ? s.block.replace(`facing=${f}`, `facing=${f0}`) : s.block}${s.also ? '+' + s.also.block : ''}`;
    };
    const lightKeys = lights.map((s) => { const [i, j] = g.back.get(`${s.x},${s.z}`) ?? [-1, -1]; return `${i},${j},${s.layer}`; }).sort();
    const now = { bare: bare.map(key), lit: spots.map(key), lights: lightKeys };
    if (rot === 0) {
      first = now;
      t.spots += spots.length;
      if (!spots.length) t.zero++;
      if (spots.length < want) t.short++;
      t.tables += spots.filter((s) => s.also).length;
      for (const s of spots) kinds.set(base(s.block), (kinds.get(base(s.block)) ?? 0) + 1);
      if (VERBOSE) say(`  ${d.name} (${inside} inside, want ${want}): ${now.lit.join(' ')}`);
      continue;
    }
    ok(JSON.stringify(now.bare) === JSON.stringify(first!.bare), `${label}: the spots (no lights) are not rot 0's turned: ${now.bare.join(' ')} | ${first!.bare.join(' ')}`);
    if (JSON.stringify(now.lights) === JSON.stringify(first!.lights))
      ok(JSON.stringify(now.lit) === JSON.stringify(first!.lit), `${label}: the spots are not rot 0's turned: ${now.lit.join(' ')} | ${first!.lit.join(' ')}`);
    else t.litTurns++;
  }
}
let all = { pieces: 0, spots: 0 };
for (const [b, t] of Object.entries(totals)) {
  say(`  ${b}: ${t.pieces} houses, ${t.spots} spots (${(t.spots / t.pieces).toFixed(1)} a house, ${t.tables} tables), ${t.zero} with none, ${t.short} short of clamp(inside / 6, 1, 8); turns whose lights differ from rot 0's ${t.litTurns}`);
  all = { pieces: all.pieces + t.pieces, spots: all.spots + t.spots };
}
say(`  all: ${all.pieces} houses, ${all.spots} spots (${(all.spots / Math.max(1, all.pieces)).toFixed(1)} a house); by block: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}`);
say(`${failures ? 'FAIL' : 'PASS'}: ${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
