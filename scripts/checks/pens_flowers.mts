/**
 * #139's varied pens and #140's mixed flower beds, offline (farmSlots.ts penShapePlan, variedAnnexSlots, penCap,
 * penSlotFit, penLure; smallWorks.ts flowerMix and the flower works' designs; choose.ts' yields of the new pen work), with
 * MC_PEN_VARIETY, MC_GARDENS and MC_FLOWER_MIX set on for the import:
 * - every shape on every side: a closed fence ring (no inside cell next to the outside), the gate in the middle of the end
 *   facing the plot, the cell outside it and the one beyond outside the shape, the back cell inside, the boxes disjoint,
 *   inside the slot and off the ring, the area their cells; an L has two boxes and its cut corner outside them;
 * - every pen set on every side of a 25x13 annex: slots inside it with a 1-cell border, 1 apart, gates on the plot's side,
 *   the approach cell beyond the annex on that side;
 * - the classic 5x7 plan as before (one box, 15 cells), caps 6 chickens and 4 cows; shaped caps by area;
 * - penSlotFit gives sheep a bigger pen than chickens; penLure takes the lure storage holds;
 * - flowerMix: 2-4 kinds of those counted enough, the same for the same seed, wildflowers when none; a bed's design plants
 *   exactly its mix (bill by kind), its name carries the mix after "~" and smallWorkWood still reads the wood; without a
 *   mix the designs are as before;
 * - the yields of shear_pen and a goat milking read from their messages; both settings registered, off by default.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/pens_flowers.mts
 */
process.env.MC_PEN_VARIETY = 'on';
process.env.MC_GARDENS = 'on';
process.env.MC_FLOWER_MIX = 'on';
const F = await import('../../server/src/farmSlots');
const W = await import('../../server/src/smallWorks');
const { choreProductive } = await import('../../server/src/choose');
const { SETTINGS } = await import('../../server/src/settings');
type Side = 'n' | 's' | 'e' | 'w';
type Area = { x1: number; z1: number; x2: number; z2: number };

let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    if (fail <= 40) console.log(`FAIL ${what}`);
  }
};
const ins = (a: Area, x: number, z: number) => x >= a.x1 && x <= a.x2 && z >= a.z1 && z <= a.z2;
const SIDES: Side[] = ['n', 's', 'e', 'w'];

// ---- shapes on a slot of each direction ----
for (const shape of Object.values(F.PEN_SHAPES)) {
  for (const alongZ of [true, false]) {
    for (const face of (alongZ ? ['n', 's'] : ['e', 'w']) as Side[]) {
      const m = 100 + (shape.w - 1) / 2;
      const spot = alongZ
        ? { x1: 100, x2: 100 + shape.w - 1, z1: 200, z2: 200 + shape.l - 1, water: { x1: m, x2: m, z1: 200, z2: 200 + shape.l - 1 }, sow: [] as Array<[number, number]> }
        : { z1: 100, z2: 100 + shape.w - 1, x1: 200, x2: 200 + shape.l - 1, water: { z1: m, z2: m, x1: 200, x2: 200 + shape.l - 1 }, sow: [] as Array<[number, number]> };
      const P = F.penShapePlan(spot, face, shape);
      const tag = `${shape.name} ${alongZ ? 'along z' : 'along x'} face ${face}`;
      const ring = new Set(P.ring.map(([x, z]) => `${x},${z}`));
      const inside = new Set<string>();
      for (const b of P.boxes) for (let x = b.x1; x <= b.x2; x++) for (let z = b.z1; z <= b.z2; z++) {
        ok(!inside.has(`${x},${z}`), `${tag}: boxes overlap at ${x},${z}`);
        inside.add(`${x},${z}`);
        ok(!ring.has(`${x},${z}`), `${tag}: inside cell ${x},${z} on the ring`);
        ok(ins(spot, x, z), `${tag}: inside cell ${x},${z} off the slot`);
      }
      ok(inside.size === P.area, `${tag}: area ${P.area} is its cells ${inside.size}`);
      ok(P.boxes.length === (shape.cut ? 2 : 1), `${tag}: ${P.boxes.length} boxes`);
      const g = `${P.gate[0]},${P.gate[1]}`;
      ok(!ring.has(g) && !inside.has(g), `${tag}: the gate is neither ring nor inside`);
      // closed: every inside cell's 8 neighbours are inside, ring or gate
      for (const c of inside) {
        const [x, z] = c.split(',').map(Number);
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const k = `${x + dx},${z + dz}`;
          ok(inside.has(k) || ring.has(k) || k === g, `${tag}: inside ${c} opens to ${k}`);
        }
      }
      // the gate on the end facing `face`, in the middle
      const want = face === 'n' ? P.gate[1] === spot.z1 : face === 's' ? P.gate[1] === spot.z2 : face === 'w' ? P.gate[0] === spot.x1 : P.gate[0] === spot.x2;
      ok(want, `${tag}: the gate ${g} on the ${face} end`);
      ok(alongZ ? P.gate[0] === m : P.gate[1] === m, `${tag}: the gate in the middle`);
      for (const [n, c] of [['outside', P.outside], ['approach', P.approach]] as const) ok(!ins(spot, c[0], c[1]), `${tag}: ${n} ${c} outside the slot`);
      ok(inside.has(`${P.back[0]},${P.back[1]}`), `${tag}: the back cell inside`);
      // the cell 2 in from the gate (start_pen's first teleport and an L's nudge) inside
      const tw = (u: number, w: number) => u + 2 * Math.sign(w - u);
      ok(inside.has(`${tw(P.gate[0], P.back[0])},${tw(P.gate[1], P.back[1])}`), `${tag}: 2 in from the gate inside`);
      ok(F.penShapeArea(shape) === P.area, `${tag}: penShapeArea`);
    }
  }
}
ok(F.penShapeArea(F.PEN_SHAPES.small) === 9 && F.penShapeArea(F.PEN_SHAPES.large) === 63 && F.penShapeArea(F.PEN_SHAPES.ell) === 37, `areas small 9, large 63, ell 37 (${F.penShapeArea(F.PEN_SHAPES.ell)})`);

// ---- the varied annex ----
const plot = { x1: 0, z1: 0, x2: 39, z2: 39 };
for (const set of F.PEN_SETS) {
  const shapes = set.map((n) => F.PEN_SHAPES[n]);
  ok(shapes.reduce((s, q) => s + q.w, 0) + shapes.length - 1 + 2 <= F.ANNEX_VARIED[0], `${set}: fits the annex's length`);
  ok(Math.max(...shapes.map((q) => q.l)) + 2 <= F.ANNEX_VARIED[1], `${set}: fits the annex's depth`);
  for (const side of SIDES) {
    const r = F.annexCandidates(plot, F.ANNEX_VARIED).find((c) => c.side === side)!;
    ok(!!r && (side === 'n' || side === 's' ? r.x2 - r.x1 + 1 === 25 && r.z2 - r.z1 + 1 === 13 : r.z2 - r.z1 + 1 === 25 && r.x2 - r.x1 + 1 === 13), `${set} ${side}: a 25x13 candidate`);
    const slots = F.variedAnnexSlots(r, shapes);
    ok(slots.length === shapes.length, `${set} ${side}: ${slots.length} slots`);
    const inner = { x1: r.x1 + 1, z1: r.z1 + 1, x2: r.x2 - 1, z2: r.z2 - 1 };
    for (const [i, s] of slots.entries()) {
      ok(ins(inner, s.x1, s.z1) && ins(inner, s.x2, s.z2), `${set} ${side}: slot ${i + 1} inside the annex's border`);
      for (const t of slots.slice(i + 1)) ok(s.x2 + 1 < t.x1 || t.x2 + 1 < s.x1 || s.z2 + 1 < t.z1 || t.z2 + 1 < s.z1, `${set} ${side}: slots ${i + 1} and another 1 apart`);
      const P = F.penPlan(s, s.face);
      ok(s.face === F.FACING_PLOT[side], `${set} ${side}: slot faces the plot`);
      ok(ins(r, P.outside[0], P.outside[1]) && !ins(inner, P.outside[0], P.outside[1]), `${set} ${side}: the cell outside the gate on the annex's border`);
      ok(!ins(r, P.approach[0], P.approach[1]) && !ins(plot, P.approach[0], P.approach[1]), `${set} ${side}: the approach between the annex and the plot`);
    }
  }
}
// one set a village, the same each time; villages differ
ok(JSON.stringify(F.penSetFor('Minevale3')) === JSON.stringify(F.penSetFor('minevale3')), 'penSetFor: by name, any case');
ok(new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Mv1', 'Mv2'].map((n) => F.penSetFor(n).map((q) => q.name).join())).size >= 3, 'penSetFor: villages differ');

// ---- classic plan, caps, fit, lures ----
const classic = F.annexSlots({ ...F.annexCandidates(plot)[0] })[0];
const C = F.penPlan(classic, classic.face);
ok(C.boxes.length === 1 && C.area === 15 && JSON.stringify(C.boxes[0]) === JSON.stringify(C.inner), 'classic: one box of 15, the inner');
ok(F.penCap('chicken', {}) === 6 && F.penCap('cow', {}) === 4, 'classic caps 6 and 4');
ok(F.penCap('chicken', { shape: F.PEN_SHAPES.standard }) === 6 && F.penCap('cow', { shape: F.PEN_SHAPES.standard }) === 4, 'a shaped 3x5 keeps the classic caps');
ok(F.penCap('sheep', { shape: F.PEN_SHAPES.large }) === 18 && F.penCap('rabbit', { shape: F.PEN_SHAPES.small }) === 3, `shaped caps: sheep in large ${F.penCap('sheep', { shape: F.PEN_SHAPES.large })}, rabbits in small`);
const free = ['small', 'standard', 'square', 'large'].map((n) => ({ shape: F.PEN_SHAPES[n] }));
const area = (q?: { shape?: { w: number; l: number } }) => (q?.shape ? F.penShapeArea(q.shape as never) : 0);
ok(area(F.penSlotFit('sheep', free)) > area(F.penSlotFit('chicken', free)), 'sheep get a bigger pen than chickens');
ok(F.penSlotFit('chicken', free)?.shape?.name === 'standard', `chickens: the 3x5 (${F.penSlotFit('chicken', free)?.shape?.name})`);
ok(F.penLure('pig', { potato: 3 }) === 'potato' && F.penLure('pig', {}) === 'carrot' && F.penLure('chicken', {}) === 'wheat_seeds', 'penLure');
ok(F.PEN_ORDER.join() === 'chicken,sheep,pig,cow,rabbit,goat', `PEN_ORDER with the flag: ${F.PEN_ORDER}`);
for (const k of F.PEN_ORDER) ok(!!F.PEN_KINDS[k], `a kind for ${k}`);

// ---- flower mixes ----
const counts = { wildflowers: 300, lily_of_the_valley: 40, dandelion: 2, poppy: 9, cornflower: 30 };
for (let i = 0; i < 40; i++) {
  const mix = W.flowerMix(counts, `M${i}|${i % 3}`, 6);
  ok(mix.length >= 2 && mix.length <= 4 && new Set(mix).size === mix.length, `mix ${i}: 2-4 distinct (${mix})`);
  ok(mix.every((f) => (counts as Record<string, number>)[f] >= 6), `mix ${i}: only kinds counted enough (${mix})`);
  ok(JSON.stringify(mix) === JSON.stringify(W.flowerMix(counts, `M${i}|${i % 3}`, 6)), `mix ${i}: the same for the same seed`);
}
ok(new Set(Array.from({ length: 30 }, (_, i) => W.flowerMix(counts, `N${i}`, 6).join())).size > 3, 'members differ');
ok(W.flowerMix({}, 'x').join() === 'wildflowers', 'none counted: wildflowers');
ok(W.flowerMix({ poppy: 50 }, 'x').join() === 'poppy', 'one kind counted: that one');
for (const kind of ['front_bed', 'flower_ring']) {
  const k = W.GARDEN_WORKS.find((q) => q.kind === kind)!;
  const plain = k.make('oak');
  ok(JSON.stringify(plain.palette) === JSON.stringify({ F: W.GARDEN_FLOWER }) && !plain.name.includes('~'), `${kind}: without a mix as before`);
  for (const mix of [['wildflowers', 'poppy'], ['dandelion', 'poppy', 'cornflower'], ['wildflowers', 'lily_of_the_valley', 'poppy', 'cornflower']]) {
    const d = k.make('spruce', mix);
    const used = new Map<string, number>();
    for (const row of d.layers[1]) for (const c of row) if (c !== '_' && c !== '.') used.set(d.palette[c].split('[')[0], (used.get(d.palette[c].split('[')[0]) ?? 0) + 1);
    ok([...used.keys()].sort().join() === [...mix].sort().join(), `${kind} ${mix}: plants exactly its mix (${[...used.keys()]})`);
    ok(d.name === `small_${kind}_spruce~${mix.join('-')}` && W.smallWorkWood(d.name) === 'spruce', `${kind} ${mix}: named ${d.name}, wood ${W.smallWorkWood(d.name)}`);
    ok(d.description.includes(W.mixWords(mix)), `${kind} ${mix}: its description names the mix`);
    ok(d.blocks === (kind === 'front_bed' ? 4 : 12), `${kind} ${mix}: ${d.blocks} blocks`);
  }
}
ok(W.mixWords(['wildflowers', 'lily_of_the_valley', 'poppy']) === 'wildflowers, lily of the valley and poppy', 'mixWords');

// ---- yields and settings ----
ok(choreProductive('penwork', 'shear_pen', true, 'sheared 3 sheep in the pen on annex slot 2: 6 wool (6 white_wool)', null), 'shear_pen productive');
ok(!choreProductive('penwork', 'shear_pen', true, "no sheep with wool in the pen on annex slot 2 (wool grows back when they eat the pen's grass)", null), 'shear_pen with none not productive');
ok(choreProductive('penwork', 'milk_cows', true, 'milked the goats on annex slot 3: 2 milk buckets', null), 'goat milk productive');
ok(SETTINGS.find((q) => q.name === 'MC_PEN_VARIETY')?.default === 'on', 'MC_PEN_VARIETY registered, on (the user\'s, 10-25)');
ok(SETTINGS.find((q) => q.name === 'MC_FLOWER_MIX')?.default === 'on', 'MC_FLOWER_MIX registered, on (10-26, the user\'s)');

console.log(`${fail ? 'PENS_FLOWERS FAILED' : 'PENS_FLOWERS OK'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
