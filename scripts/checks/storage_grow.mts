/**
 * #121 (MC_STORAGE_GROW) checked offline on im2_mine's villages.json (B25x2, whose storage hut is full): storageDue fires
 * for it and not for a village with room, a ready yard, a yard that failed three times or one backing off; the yard's 44
 * barrel spots are distinct, inside the yard, each with an aisle cell beside it that is not a spot, nearest the hut's door
 * first; for every candidate rectangle a yard could take, the spots stay off every other plot, side plot and building; with
 * a yard ready freeSpots lists its spots after the hut's at the yard's level and storageSlots' cap grows by 44 x 27; the
 * bulk cap splits a load as MC_STORAGE_CAP says. Sets MC_STORAGE_GROW=on itself. Exits non-zero on any failure.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/storage_grow.mts
 */
import fs from 'node:fs';

process.env.MC_STORAGE_GROW = 'on';
delete process.env.MC_STORAGE_CAP;
const { STORAGE_GROW, storageYardCandidates, storageYardSpots } = await import('../../server/src/huts');
const { freeSpots, yardSpots, storageSlots, spoilSplit, keepSplit, bulkCap, STORAGE_CAP, STORAGE_KEEP } = await import('../../server/src/mineflayer/mcStorage');
const { storageDue } = await import('../../server/src/mineflayer/mcWorld');
const { mineAreas } = await import('../../server/src/mineflayer/mcMine');
const { overlaps } = await import('../../server/src/village');
type Village = import('../../server/src/village').Village;

let failures = 0, checks = 0;
function ok(cond: unknown, what: string) {
  checks++;
  if (!cond) {
    failures++;
    process.stdout.write(`FAIL ${what}\n`);
  }
}

const raw = JSON.parse(fs.readFileSync('mc/testcheckpoints/im2_mine/villages.json', 'utf8'));
const vs: Village[] = Object.values(raw.villages ?? raw);
const v0 = vs.find((v) => v.name === 'B25x2')!;
const fresh = () => JSON.parse(JSON.stringify(v0)) as Village;
const now = Date.now();
ok(STORAGE_GROW, 'MC_STORAGE_GROW=on read');

// The trigger
{
  const v = fresh();
  const st = storageSlots(v);
  const free = freeSpots(v).length;
  ok(st.cap === 405 && st.used >= 0.75 * st.cap && free <= 2, `im2_mine's hut is nearly full (${st.used} of ${st.cap}, ${free} free)`);
  ok(storageDue(v, st, free, now).due, `due on im2_mine (${storageDue(v, st, free, now).why})`);
  ok(!storageDue(v, { used: 200, cap: 405 }, free, now).due, 'not due at half the slots');
  ok(!storageDue(v, st, 5, now).due, 'not due with 5 spots free');
  const lay = v.layouts![0];
  lay.store = { x1: 0, z1: 0, x2: -1, z2: -1, y: 65, side: 'n', state: 'preparing', tries: 3 };
  ok(!storageDue(v, st, free, now).due, 'not due after 3 failed tries');
  lay.store = { x1: 0, z1: 0, x2: -1, z2: -1, y: 65, side: 'n', state: 'preparing', tries: 1, lastTry: { at: now - 60000, why: 'x' } };
  ok(!storageDue(v, st, free, now).due, 'backing off a minute after a failure');
  ok(storageDue(v, st, free, now + 11 * 60000).due, 'due again 11 minutes after it');
  lay.store = { x1: 1, z1: 1, x2: 13, z2: 9, y: 65, side: 'n', state: 'ready' };
  ok(!storageDue(v, st, free, now).due, 'not due with the yard ready');
}

// The spots, for every rectangle the yard could take
{
  const v = fresh();
  const h = v.storageHut!, door = { x: h.x1 + 3, z: h.z2 + 1 };
  const lay = v.layouts![0];
  const plot = v.plots.find((p) => !p.annex && !p.works && overlaps(p, lay))!;
  // (taken as annexSpot takes it for the yard, from the record: other plots and growth layouts padded, side plots, the
  // mine's hut and stairs; buildings below)
  const pad = (q: { x1: number; z1: number; x2: number; z2: number }, n: number) => ({ x1: q.x1 - n, z1: q.z1 - n, x2: q.x2 + n, z2: q.z2 + n });
  const others = [
    ...[...v.layouts!.slice(1), ...v.plots.filter((p) => p !== plot)].map((q) => pad(q, 'grow' in q && q.grow ? 3 : 0)),
    ...(['annex', 'works'] as const).map((k) => lay[k]).filter((q): q is NonNullable<typeof q> => !!q && q.x2 >= q.x1),
    ...(v.mine ? mineAreas(v.mine).filter((b) => b.y2 >= plot.y - 2) : []),
  ];
  let rects = 0, clean = 0;
  for (const r of storageYardCandidates(plot)) {
    const spots = storageYardSpots(r, door);
    rects++;
    const key = (s: { x: number; z: number }) => `${s.x},${s.z}`;
    const set = new Set(spots.map(key));
    const inside = (s: { x: number; z: number }) => s.x >= r.x1 && s.x <= r.x2 && s.z >= r.z1 && s.z <= r.z2;
    ok(spots.length === 44 && set.size === 44, `${r.side} ${r.x1},${r.z1}: 44 distinct spots (${spots.length}, ${set.size})`);
    ok(spots.every((s) => inside(s) && inside(s.stand) && !set.has(key(s.stand)) && Math.abs(s.x - s.stand.x) + Math.abs(s.z - s.stand.z) === 1), `${r.side} ${r.x1},${r.z1}: inside, an aisle cell beside each`);
    // (the border ring stays walkable: no spot on the yard's edge)
    ok(spots.every((s) => s.x > r.x1 && s.x < r.x2 && s.z > r.z1 && s.z < r.z2), `${r.side} ${r.x1},${r.z1}: no spot on the edge`);
    const d = (s: { x: number; z: number }) => Math.abs(s.x - door.x) + Math.abs(s.z - door.z);
    ok(spots.every((s, i) => i === 0 || d(spots[i - 1]) <= d(s)), `${r.side} ${r.x1},${r.z1}: nearest the door first`);
    ok(!overlaps(r, plot), `${r.side} ${r.x1},${r.z1}: off the village plot`);
    // (annexSpot keeps off the others with a 2-cell pad; count how many rectangles would be free of them)
    const cell = (s: { x: number; z: number }) => ({ x1: s.x, z1: s.z, x2: s.x, z2: s.z });
    if (!others.some((o) => overlaps(r, o, 2)) && !v.structures.some((b) => overlaps(r, b, 2))) {
      clean++;
      ok(spots.every((s) => !others.some((o) => overlaps(cell(s), o)) && !v.structures.some((b) => overlaps(cell(s), b))), `${r.side} ${r.x1},${r.z1}: spots off other plots and buildings`);
    }
  }
  ok(clean > 0, `im2_mine has candidate rectangles clear of other plots and buildings (${clean} of ${rects})`);

  // A yard ready: its spots join the hut's, at the yard's level, after the hut's own
  const r = storageYardCandidates(plot).find((q) => !others.some((o) => overlaps(q, o, 2)) && !v.structures.some((b) => overlaps(q, b, 2)))!;
  const before = storageSlots(v), freeBefore = freeSpots(v);
  lay.store = { x1: r.x1, z1: r.z1, x2: r.x2, z2: r.z2, y: plot.y, side: r.side, state: 'preparing' };
  ok(yardSpots(v).length === 0 && freeSpots(v).length === freeBefore.length, 'a yard being prepared adds no spots');
  lay.store.state = 'ready';
  const ys = yardSpots(v), after = storageSlots(v), freeAfter = freeSpots(v);
  ok(ys.length === 44 && ys.every((s) => s.barrel && s.y === plot.y + 1 && s.stand), 'the ready yard: 44 barrel spots at its level + 1');
  ok(after.cap === before.cap + 44 * 27 && after.spots === before.spots + 44, `the cap grows by 44 x 27 (${before.cap} -> ${after.cap})`);
  ok(freeAfter.length === freeBefore.length + 44 && freeBefore.every((s, i) => freeAfter[i].x === s.x && freeAfter[i].z === s.z), "the yard's spots come after the hut's");
  ok(freeSpots(v, true).length === freeSpots(fresh(), true).length, 'a carried chest still goes in a hut chest spot only');
  // (a barrel down in the yard takes its spot)
  v.storage!.chests.push({ x: ys[0].x, y: ys[0].y!, z: ys[0].z, items: {}, barrel: true });
  ok(freeSpots(v).length === freeAfter.length - 1 && !freeSpots(v).some((s) => s.x === ys[0].x && s.z === ys[0].z), 'a placed yard barrel takes its spot');
  console.log(`yard for ${v.name}: ${r.side} ${r.x1},${r.z1}..${r.x2},${r.z2}; first spot ${ys[0].x},${ys[0].z}; cap ${before.cap} -> ${after.cap}`);
}

// The bulk cap
{
  ok(STORAGE_CAP.cobblestone === 1024 && STORAGE_CAP.stone === 256, 'default caps');
  ok(bulkCap('cobblestone') === 1024 && bulkCap('andesite') === 256 && bulkCap('cobbled_deepslate') === 256 && bulkCap('raw_copper') === null && bulkCap('oak_log') === null, 'bulkCap by kind');
  const s1 = spoilSplit({ cobblestone: 1000, andesite: 300 }, { cobblestone: 64, andesite: 10, granite: 64, oak_log: 30 });
  ok(s1.cobblestone === 40 && s1.andesite === 10 && !s1.granite && !s1.oak_log, `split: ${JSON.stringify(s1)}`);
  const v = fresh();
  const store: Record<string, number> = {};
  for (const c of v.storage!.chests) for (const [n, q] of Object.entries(c.items)) store[n] = (store[n] ?? 0) + q;
  const s2 = spoilSplit(store, { cobblestone: 128, raw_copper: 20 });
  ok(s2.cobblestone === 128 && !s2.raw_copper, `im2_mine's 6,145 cobblestone: a carried 128 all spoiled (${JSON.stringify(s2)})`);
  ok(!Object.keys(spoilSplit(store, { cobblestone: 5 }, {})).length, 'no caps: nothing spoiled');
}

// MC_STORAGE_KEEP (on by default): over the cap, kept while storage has room
{
  ok(STORAGE_KEEP, 'MC_STORAGE_KEEP on by default');
  const k1 = keepSplit({ cobblestone: 1000 }, { cobblestone: 64, oak_log: 30 }, { used: 100, cap: 405 });
  ok(!Object.keys(k1).length, `room: a load over the cap kept (${JSON.stringify(k1)})`);
  const k2 = keepSplit({ cobblestone: 1000 }, { cobblestone: 64 }, { used: 330, cap: 405 });
  ok(k2.cobblestone === 40, `past 80% of the slots: what is over the cap spoiled (${JSON.stringify(k2)})`);
  const k3 = keepSplit({ andesite: 10400 }, { andesite: 64, granite: 64 }, { used: 200, cap: 405 });
  ok(k3.andesite === 64 && !k3.granite, `one kind at most 40% of the slots (${JSON.stringify(k3)})`);
  const k4 = keepSplit({ andesite: 300, granite: 300 }, { andesite: 64, granite: 64 }, { used: 323, cap: 405 });
  ok(k4.andesite === undefined && k4.granite === 64, `the last 64 items of room go to the first kind (${JSON.stringify(k4)})`);
  const k5 = keepSplit({ cobblestone: 100 }, { cobblestone: 64 }, { used: 400, cap: 405 });
  ok(!Object.keys(k5).length, `under the cap: kept even when full (${JSON.stringify(k5)})`);
  // (the yard due sooner: im2_mine's full hut is due either way; a hut 65% used with no free spot is due only with it)
  const v = fresh();
  v.layouts![0].store = undefined;
  ok(storageDue(v, { used: 263, cap: 405 }, 0, Date.now()).due, 'MC_STORAGE_KEEP: the yard due at 65% used');
  ok(!storageDue(v, { used: 200, cap: 405 }, 0, Date.now()).due, 'MC_STORAGE_KEEP: not at 49% used');
}

process.stdout.write(`${failures ? 'FAILED' : 'ok'}: ${checks - failures} of ${checks} checks pass\n`);
process.exit(failures ? 1 : 0);
