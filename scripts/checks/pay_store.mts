/**
 * #111's storage by command (mcPay.ts storeByCommand, levySweep), offline against a fake server: the levy owed written
 * into a storage chest and counted, a stack topped up before a new slot, a full chest left for the next, a chest that
 * cannot be read skipped, an emerald taken out (a bounty's), the record changed only by what the count shows; and the
 * ledger's conservation with the sales levy and the deposits (members' chests + escrow + owed = minted + from the commons
 * + sales levy - deposited).
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/checks/pay_store.mts
 */
Object.assign(process.env, { MCAI_SOCIAL: 'on', MC_ACTS: 'on', MC_OWN: 'on', MC_PAY: 'on' });
const M = await import('../../server/src/mineflayer/mcPay');
const P = await import('../../server/src/pay');
type Village = import('../../server/src/village').Village;

let pass = 0, fail = 0;
const ok = (cond: unknown, what: string) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL ${what}`);
  }
};
const quiet = console.log;
console.log = () => {};

// A fake server: containers by position, Paper's replies to `data get block ... Items[i]` and `item replace`.
type Slot = { id: string; count: number; extra?: string };
const boxes = new Map<string, Map<number, Slot>>();
const unreadable = new Set<string>();
let writes = 0, broken = false;
const rcon = async (cmd: string): Promise<string> => {
  let m = /^data get block (-?\d+) (-?\d+) (-?\d+) Items\[(\d+)\]$/.exec(cmd);
  if (m) {
    const k = `${m[1]},${m[2]},${m[3]}`;
    if (unreadable.has(k) || !boxes.has(k)) return 'The target block is not a block entity';
    const list = [...boxes.get(k)!.entries()].sort((p, q) => p[0] - q[0]);
    const e = list[Number(m[4])];
    if (!e) return `Found no elements matching Items[${m[4]}]`;
    const [sl, x] = e;
    return `${m[1]}, ${m[2]}, ${m[3]} has the following block data: {Slot: ${sl}b, id: "minecraft:${x.id}", count: ${x.count}${x.extra ? `, components: ${x.extra}` : ''}}`;
  }
  m = /^item replace block (-?\d+) (-?\d+) (-?\d+) container\.(\d+) with minecraft:([a-z_]+)(?: (\d+))?$/.exec(cmd);
  if (m) {
    writes++;
    const b = boxes.get(`${m[1]},${m[2]},${m[3]}`);
    if (!b || broken) return 'No item was replaced';
    if (m[5] === 'air') b.delete(Number(m[4]));
    else b.set(Number(m[4]), { id: m[5], count: Number(m[6] ?? 1) });
    return 'Replaced a slot';
  }
  return 'Unknown command';
};
const box = (x: number, slots: Array<[number, Slot]>) => boxes.set(`${x},64,0`, new Map(slots));
const real = (x: number, item: string) => [...(boxes.get(`${x},64,0`)?.values() ?? [])].filter((s) => s.id === item).reduce((t, s) => t + s.count, 0);

// a parse: components nest braces, an empty chest, an unreadable one
box(1, [[0, { id: 'emerald', count: 3 }], [4, { id: 'iron_pickaxe', count: 1, extra: '{"minecraft:damage": 4, "minecraft:enchantments": {levels: {"minecraft:efficiency": 2}}}' }]]);
let s = await M.slotsOf(rcon, { x: 1, y: 64, z: 0 });
ok(s && s.length === 2 && s[0].id === 'emerald' && s[0].count === 3 && s[1].id === 'iron_pickaxe' && s[1].slot === 4, `slots parsed past nested components (${JSON.stringify(s)})`);
box(2, []);
ok(JSON.stringify(await M.slotsOf(rcon, { x: 2, y: 64, z: 0 })) === '[]', 'an empty chest reads as no slots');
ok((await M.slotsOf(rcon, { x: 9, y: 64, z: 0 })) === null, 'no container reads as null');

// a village: three storage chests (the misc one, a full one, one with emeralds)
const full: Array<[number, Slot]> = Array.from({ length: 27 }, (_, i) => [i, { id: 'cobblestone', count: 64 }]);
box(3, full);
box(4, [[0, { id: 'emerald', count: 60 }], [1, { id: 'stick', count: 5 }]]);
box(5, []);
const v = {
  name: 'Testvale',
  storage: { chests: [
    { x: 3, y: 64, z: 0, items: { cobblestone: 27 * 64 } },
    { x: 4, y: 64, z: 0, items: { emerald: 60, stick: 5 } },
    { x: 5, y: 64, z: 0, items: {}, group: 'misc' },
  ] },
  homes: { Ada: { owed: {}, got: {}, used: {}, chest: { x: 20, y: 64, z: 0, items: {} } } },
} as unknown as Village;
const rec = (x: number) => v.storage!.chests.find((c) => c.x === x)!.items;

// the levy: a stack topped up to 64, the rest into a new slot of the same chest
let n = await M.storeByCommand(rcon, v, 'emerald', 7);
ok(n === 7 && real(4, 'emerald') === 67 && rec(4).emerald === 67, `7 emeralds into the chest that holds them (moved ${n}, real ${real(4, 'emerald')}, record ${rec(4).emerald})`);
ok(boxes.get('4,64,0')!.get(0)!.count === 64 && [...boxes.get('4,64,0')!.values()].some((x) => x.id === 'emerald' && x.count === 3), 'the stack topped up to 64 first, then a free slot');

// taken out (a bounty's emerald): the record and the chest both lose one
n = await M.storeByCommand(rcon, v, 'emerald', -1);
ok(n === -1 && real(4, 'emerald') === 66 && rec(4).emerald === 66, `one emerald taken out (moved ${n}, real ${real(4, 'emerald')}, record ${rec(4).emerald})`);

// a server that refuses the writes: nothing counted, the record unchanged
broken = true;
n = await M.storeByCommand(rcon, v, 'emerald', 2);
ok(n === 0 && rec(4).emerald === 66, `refused writes count nothing (moved ${n}, record ${rec(4).emerald})`);
broken = false;

// a chest that cannot be read is skipped, the next takes it; with no emerald chest the misc chest first, never the full one
unreadable.add('4,64,0');
n = await M.storeByCommand(rcon, v, 'diamond', 3);
ok(n === 3 && real(5, 'diamond') === 3 && rec(5).diamond === 3 && real(3, 'diamond') === 0, `a new item into the misc chest (moved ${n}, misc ${real(5, 'diamond')})`);
n = await M.storeByCommand(rcon, v, 'emerald', 2);
ok(n === 2 && real(5, 'emerald') === 2 && real(4, 'emerald') === 66, `the emerald chest unreadable: the next chest takes them (moved ${n})`);
unreadable.delete('4,64,0');

// the levy sweep: owed written, then deposited on the ledger; once more owed than storage can hold, the rest stays owed
const p = P.payOf(v);
const t = 2_000_000_000;
P.oweLevy(v, 5, 'Ada', t, 'the sales levy on 20 wheat');
ok(p.levyOwed === 5 && p.ledger.some((r) => r.op === 'sales levy' && r.n === 5), 'merchant_own\'s levy owed and logged');
const w = { village: () => v, save: () => {}, rcon, commonsSpare: () => 0 };
M.levySweep(w, v);
M.levySweep(w, v);
for (let i = 0; i < 20 && p.levyOwed; i++) await new Promise((r) => setTimeout(r, 5));
ok(p.levyOwed === 0 && p.ledger.filter((r) => r.op === 'levy deposited').reduce((tt, r) => tt + r.n, 0) === 5, `the sweep deposited the levy once (owed ${p.levyOwed})`);
ok(real(4, 'emerald') + real(5, 'emerald') === 73, `the deposit reached storage (${real(4, 'emerald')} + ${real(5, 'emerald')})`);
for (const x of [4, 5]) box(x, Array.from({ length: 27 }, (_, i) => [i, { id: 'dirt', count: 64 }] as [number, Slot]));
P.oweLevy(v, 3, 'Ada', t, 'the sales levy');
M.levySweep(w, v);
await new Promise((r) => setTimeout(r, 30));
ok(p.levyOwed === 3, `a full storage leaves the levy owed for the next sweep (owed ${p.levyOwed})`);

// conservation with the sales levy and deposits
const v2 = { name: 'Two', homes: Object.fromEntries(['Ada', 'Ben'].map((nm, i) => [nm, { owed: {}, got: {}, used: {}, chest: { x: i, y: 64, z: 0, items: {} } }])) } as unknown as Village;
for (const nm of ['Ada', 'Ben']) P.givePurse(v2, nm, t);
P.oweLevy(v2, 2, 'Ada', t, 'sales');
P.levyDeposited(v2, 1, t);
const L = P.payOf(v2).ledger;
const sumOf = (op: string) => L.filter((r) => r.op === op).reduce((tt, r) => tt + r.n, 0);
ok(P.emeraldsSeen(v2) === P.mintedOf(v2) + sumOf('sales levy') - sumOf('levy deposited'), `conservation: seen ${P.emeraldsSeen(v2)} = minted ${P.mintedOf(v2)} + sales levy - deposited`);

console.log = quiet;
console.log(`pay_store: ${pass} passed, ${fail} failed (${writes} writes)`);
process.exit(fail ? 1 : 0);
