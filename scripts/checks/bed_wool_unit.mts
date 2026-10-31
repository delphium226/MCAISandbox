/**
 * #187, offline: the bed wool rules (bedWool.ts). Shears first only while beds are owed and nobody has a pair; sheep
 * first in the pen order while beds are owed; a short wild shearing backs the village's wild shearing off WILD_BACK_MS,
 * a full one clears it; MC_BED_WOOL=off changes nothing.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/bed_wool_unit.mts
 */
const B = await import('../../server/src/bedWool');

let pass = 0, fail = 0;
const ok = (cond: boolean, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL ${what}`);
  }
};

ok(B.BED_WOOL.on, 'on by default');
ok(B.shearsFirst(3, 0), 'beds owed, no shears: shears first');
ok(!B.shearsFirst(3, 1), 'a pair somewhere: not first');
ok(!B.shearsFirst(0, 0), 'no bed owed: not first');

const order = ['chicken', 'sheep', 'pig', 'cow'];
ok(B.penOrder(order, 2).join() === 'sheep,chicken,pig,cow', `sheep first while beds are owed (${B.penOrder(order, 2)})`);
ok(B.penOrder(order, 0).join() === order.join(), 'the usual order otherwise');
ok(B.penOrder(['chicken', 'cow'], 2).join() === 'chicken,cow', 'no sheep kind: unchanged');

const t = 1_000_000;
ok(B.wildShearWait('V', t) === null, 'no shearing yet: free');
B.noteWildShear('V', true, t);
ok(/grows back in about 4 min/.test(B.wildShearWait('V', t + 1000) ?? ''), `short: backs off (${B.wildShearWait('V', t + 1000)})`);
ok(B.wildShearWait('W', t + 1000) === null, 'another village is not backed off');
ok(B.wildShearWait('V', t + B.WILD_BACK_MS + 1) === null, 'free after WILD_BACK_MS');
B.noteWildShear('V', true, t);
B.noteWildShear('V', false, t + 2000);
ok(B.wildShearWait('V', t + 3000) === null, 'a full shearing clears it');

B.BED_WOOL.on = false;
ok(!B.shearsFirst(3, 0) && B.penOrder(order, 2).join() === order.join(), 'off: no shears first, the usual pen order');
B.noteWildShear('V', true, t);
ok(B.wildShearWait('V', t + 1000) === null, 'off: no back-off');

console.log(`bed_wool_unit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
