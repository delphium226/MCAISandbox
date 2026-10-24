/**
 * MC_HOME_BASICS checked offline (runs/2026-10-24/home-basics/spec.md; no server, seconds with the jar): buildingDecor's
 * `basics` (streetPlan.ts) on every owned house of a checkpoint's villages.json, and on every vanilla house of the five
 * biomes at four turns. Each piece on a "." cell with "." over it, inside the house's box (the checkpoint's) or grid,
 * the bed off every door and its 4 neighbours and the entrance's inside cell and its neighbours (the chest and the table
 * off those cells themselves), every piece off the lights' and the sign's cells; the bed's two cells side by side, its head before a wall (in `facing`); the chest facing away from a wall; no
 * cell twice; the furniture's spots off the basics' cells; the inside cells the entrance reached still reached with the
 * basics and the furniture down; the furniture without `basics` unchanged by the option's code (decor_check's job).
 * Prints, per source, how many houses get all three, and which piece is missing where. Exits non-zero on any failure or
 * when an owned house of the checkpoint misses a piece.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/home_basics.mts [CHECKPOINT|villages.json ...]   (default im2_mine; VERBOSE=1)
 */
import { existsSync, readFileSync } from 'node:fs';

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

const base = (b: string | undefined) => String(b ?? '').replace(/^minecraft:/, '').replace(/[[{].*$/, '');
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
  const cells = new Map<string, string>();
  d.layers.forEach((layer, l) => layer.forEach((row, j) => [...row].forEach((ch, i) => {
    const [u, q] = turnCell(i, j, d.width, d.depth, rot);
    cells.set(`${x1 + u},${l},${z1 + q}`, ch === '_' || ch === '.' ? ch : d.palette[ch] ?? 'air');
  })));
  return { x1, z1, x2: x1 + W - 1, z2: z1 + D - 1, cells };
}

const tally: Record<string, { houses: number; all3: number; noBed: number; noChest: number; noTable: number; furniture: number }> = {};

/** One placed house: its basics checked; `box` the structure's (a checkpoint's) or the grid's. Returns the pieces missing. */
function checkHouse(src: string, label: string, place: Place, lights: Any[], signs: Any[], box?: { x1: number; z1: number; x2: number; z2: number }, chestAt?: { x: number; z: number }): string[] {
  const g = grid(place);
  const at = (x: number, l: number, z: number) => g.cells.get(`${x},${l},${z}`);
  const b = box ?? g;
  const holder: { out?: Any; chestAt?: Any } = chestAt ? { chestAt } : {};
  const spots = SP.buildingDecor(place as Any, 'oak', { lights, signs, basics: holder });
  const again: { out?: Any; chestAt?: Any } = chestAt ? { chestAt } : {};
  SP.buildingDecor(place as Any, 'oak', { lights, signs, basics: again });
  ok(JSON.stringify(holder.out) === JSON.stringify(again.out), `${label}: two calls differ`);
  const hb = holder.out ?? {};
  const ent = SP.placedDoor(place as Any)!;
  const inX = ent.x - ent.ox, inZ = ent.z - ent.oz;
  const off = new Set<string>();
  const doorCells: Array<[number, number]> = [];
  for (const [k, blk] of g.cells) { const [x, l, z] = k.split(',').map(Number); if (l === 1 && /_door$/.test(base(blk))) doorCells.push([x, z]); }
  for (const [x, z] of [...doorCells, [inX, inZ] as [number, number]]) for (const [a, c] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) off.add(`${x + a},${z + c}`);
  const lit = new Set([...lights, ...signs].filter((s: Any) => s.layer === 1 || s.layer === 2).map((s: Any) => `${s.x},${s.z}`));
  const cells: Array<{ x: number; z: number; what: string }> = [];
  if (hb.bed) cells.push({ x: hb.bed.x, z: hb.bed.z, what: 'bed head' }, { x: hb.bed.foot.x, z: hb.bed.foot.z, what: 'bed foot' });
  if (hb.chest) cells.push({ x: hb.chest.x, z: hb.chest.z, what: 'chest' });
  if (hb.table) cells.push({ x: hb.table.x, z: hb.table.z, what: 'table' });
  const seen = new Set<string>();
  for (const c of cells) {
    const where = `${label}: ${c.what} at ${c.x},${c.z}`;
    ok(c.x >= b.x1 && c.x <= b.x2 && c.z >= b.z1 && c.z <= b.z2, `${where} outside the house's box`);
    ok(at(c.x, 1, c.z) === '.' && at(c.x, 2, c.z) === '.' && at(c.x, 0, c.z) !== '.', `${where}: not a "." cell with "." over it on a floor`);
    // (the bed keeps off the ring; the chest and the table may stand beside it as a small house's last resort, never on a
    // door or the entrance's inside cell)
    if (c.what.startsWith('bed')) ok(!off.has(`${c.x},${c.z}`), `${where}: on or next to a door or the entrance's inside cell`);
    else ok(!doorCells.some(([x, z]) => x === c.x && z === c.z) && !(c.x === inX && c.z === inZ), `${where}: on a door or the entrance's inside cell`);
    ok(!lit.has(`${c.x},${c.z}`), `${where}: on a light's or the sign's cell`);
    ok(!seen.has(`${c.x},${c.z}`), `${where}: a cell twice`);
    seen.add(`${c.x},${c.z}`);
  }
  if (hb.bed) {
    const [a, c] = STEP[hb.bed.facing];
    ok(hb.bed.foot.x + a === hb.bed.x && hb.bed.foot.z + c === hb.bed.z, `${label}: the bed's foot is not before its head in ${hb.bed.facing}`);
    ok(SP.holdsSign(at(hb.bed.x + a, 1, hb.bed.z + c)) && SP.holdsSign(at(hb.bed.x + a, 2, hb.bed.z + c)), `${label}: no wall behind the bed's head`);
  }
  // (an own chest already standing keeps its own facing)
  if (hb.chest && !chestAt) {
    const [a, c] = STEP[CW[CW[hb.chest.facing]]];
    ok(SP.holdsSign(at(hb.chest.x + a, 1, hb.chest.z + c)), `${label}: the chest does not face away from a wall`);
  }
  for (const s of spots) ok(!seen.has(`${s.x},${s.z}`), `${label}: furniture ${s.block} on a basics cell ${s.x},${s.z}`);
  // Connectivity, as decor_check's: the inside cells the entrance reached still reached
  const reach = (used: Set<string>) => {
    const got = new Set<string>(), queue: Array<[number, number]> = [[ent.x, ent.z]];
    while (queue.length) {
      const [x, z] = queue.pop()!;
      for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + a},${z + c}`;
        if (got.has(k) || used.has(k) || at(x + a, 1, z + c) !== '.') continue;
        got.add(k);
        queue.push([x + a, z + c]);
      }
    }
    return got;
  };
  const before = reach(new Set());
  const used = new Set([...seen, ...spots.map((s) => `${s.x},${s.z}`)]);
  const after = reach(used);
  const cut = [...before].filter((k) => !used.has(k) && !after.has(k));
  ok(!cut.length, `${label}: the basics and furniture cut ${cut.length} inside cells off the entrance`);
  const miss = [hb.bed ? '' : 'bed', hb.chest ? '' : 'chest', hb.table ? '' : 'table'].filter(Boolean);
  const t = (tally[src] ??= { houses: 0, all3: 0, noBed: 0, noChest: 0, noTable: 0, furniture: 0 });
  t.houses++;
  if (!miss.length) t.all3++;
  if (!hb.bed) t.noBed++;
  if (!hb.chest) t.noChest++;
  if (!hb.table) t.noTable++;
  t.furniture += spots.length;
  if (VERBOSE || miss.length) say(`  ${label}: ${hb.bed ? `bed ${hb.bed.x},${hb.bed.z} ${hb.bed.facing}` : 'NO BED'}; ${hb.chest ? `chest ${hb.chest.x},${hb.chest.z}` : 'NO CHEST'}; ${hb.table ? `table ${hb.table.x},${hb.table.z}` : 'NO TABLE'}; ${spots.length} furniture`);
  return miss;
}

if (!hasJar()) {
  say('no jar: nothing to check');
  process.exit(1);
}

// ---- the checkpoints' owned houses -------------------------------------------------------------------------------------
const args = process.argv.slice(2);
let ownedMissing = 0;
for (const arg of args.length ? args : ['im2_mine']) {
  const path = existsSync(arg) ? arg : `mc/testcheckpoints/${arg}/villages.json`;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const vs: Any[] = Array.isArray(raw) ? raw : Array.isArray(raw.villages) ? raw.villages : Object.values(raw.villages ?? raw);
  for (const v of vs) {
    const signs = (v.layouts ?? []).flatMap((l: Any) => l.signs ?? []);
    const lamps = (v.layouts ?? []).flatMap((l: Any) => l.lamps ?? []);
    for (const st of v.structures ?? []) {
      if (!st.owner) continue;
      const d: Design | undefined = v.designs?.[st.kind];
      if (!d) { ok(false, `${v.name} ${st.owner}: no design ${st.kind}`); continue; }
      // (the place as mcWorld.structurePlace finds it: the done build task whose grid starts at the box's corner)
      let place: Place | null = null;
      for (const t of v.tasks ?? []) {
        const mm = t.status === 'done' ? /^build_design "([^"]+)" x=(-?\d+) z=(-?\d+)(?: rotate=(-?\d+))?/.exec(t.detail) : null;
        if (!mm || mm[1] !== st.kind) continue;
        const rot = ((Math.round(Number(mm[4] ?? 0) / 90) % 4) + 4) % 4;
        const W = rot % 2 ? d.depth : d.width, D = rot % 2 ? d.width : d.depth;
        const x = Number(mm[2]), z = Number(mm[3]);
        if (x - Math.floor(W / 2) !== st.x1 || z - Math.floor(D / 2) !== st.z1) continue;
        place = { design: d, x, z, rot };
        break;
      }
      if (!place) { ok(false, `${v.name} ${st.owner}: no build task places ${st.kind} at ${st.x1},${st.z1}`); continue; }
      const lights = SP.buildingLights(place as Any, { vanilla: VP.vanillaLights(d), signs, lamps });
      // (an own chest standing at the floor's level is taken as the chest, as mcWorld.decorParts passes it)
      const own = v.homes?.[st.owner]?.chest;
      const miss = checkHouse(arg, `${arg} ${st.owner} ${st.kind}`, place, lights, signs, st, own && own.y === st.y + 1 ? { x: own.x, z: own.z } : undefined);
      if (miss.length) ownedMissing++;
    }
  }
}

// ---- the jar's houses at four turns -----------------------------------------------------------------------------------
for (const biome of VP.VILLAGE_BIOMES)
  for (const p of VP.listPieces(undefined, biome, 'houses')) {
    let imp: Any;
    try {
      imp = VP.pieceToDesign(VP.readPiece(p), biome);
    } catch {
      continue;
    }
    for (let rot = 0; rot < 4; rot++) {
      const place: Place = { design: imp.design, x: 37, z: -55, rot };
      const sign = SP.placeSigns([place as Any])[0];
      const signs = sign ? [sign] : [];
      const lights = SP.buildingLights(place as Any, { vanilla: imp.lights, signs: signs as Any });
      checkHouse(`jar ${biome}${rot ? '' : ''}`, `${imp.design.name} rot ${rot}`, place, lights, signs);
    }
  }

// ---- the pin (MC_HOME_BASICS): the fixed pick and the model's trim --------------------------------------------------
{
  const C = await import('../../server/src/choose');
  const opt = (id: string, kind: string, rank: number, extra: Any = {}) => ({ id, kind, key: id, name: id, rank, facts: '', holds: [], excludes: [], ...extra });
  const base = [opt('farm:1', 'farm', 11), opt('make:a', 'make', 610, { gw: 2, tw: 1.5 }), opt('own:basics', 'own', 5, { basic: true })];
  const fillers = Array.from({ length: 12 }, (_, i) => opt(`make:${i}`, 'make' + (i % 6), 600 + i, { tw: 1.4, lp: 1.5 }));
  const menu = (options: Any[]) => ({ options, reasons: {}, ctx: {} }) as Any;
  ok(C.fixedPick(menu(base))?.id === 'own:basics', 'pin: the fixed pick does not take the basic need over a goal option');
  ok(C.fixedPick(menu([...base, opt('eat', 'eat', 0)]))?.id === 'eat', 'pin: a meal does not come first');
  ok(C.trimMenu([...fillers, ...base] as Any).some((o: Any) => o.id === 'own:basics'), 'pin: the trim drops the basic need');
  ok(C.basicOf(menu([...base, opt('own:shear', 'own', 8, { basic: true })]))?.id === 'own:basics', 'pin: basicOf is not the lowest rank');
}

for (const [src, t] of Object.entries(tally))
  say(`  ${src}: ${t.houses} houses${src.startsWith('jar') ? ' (x4 turns)' : ''}, ${t.all3} with all three; no bed ${t.noBed}, no chest ${t.noChest}, no table ${t.noTable}; furniture ${(t.furniture / t.houses).toFixed(1)} a house`);
ok(!ownedMissing, `${ownedMissing} owned houses miss a piece`);
say(`${failures ? 'FAIL' : 'PASS'}: ${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
