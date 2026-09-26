// Write the same small house as a schematic in every supported format, to test the importer.
// Usage: npx tsx scripts/gen_test_schematics.ts OUTDIR
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = process.argv[2];

// --- tiny NBT writer
type T = { t: number; v: unknown };
const B = (v: number): T => ({ t: 1, v }), S = (v: number): T => ({ t: 2, v }), I = (v: number): T => ({ t: 3, v });
const STR = (v: string): T => ({ t: 8, v }), BA = (v: number[]): T => ({ t: 7, v }), LA = (v: bigint[]): T => ({ t: 12, v });
const L = (type: number, v: T[]): T => ({ t: 9, v: { type, items: v } }), C = (v: Record<string, T>): T => ({ t: 10, v });
function enc(tag: T): Buffer {
  const parts: Buffer[] = [];
  const w = (t: T) => {
    const b = (n: number) => Buffer.alloc(n);
    switch (t.t) {
      case 1: { const x = b(1); x.writeInt8(t.v as number); parts.push(x); break; }
      case 2: { const x = b(2); x.writeInt16BE(t.v as number); parts.push(x); break; }
      case 3: { const x = b(4); x.writeInt32BE(t.v as number); parts.push(x); break; }
      case 7: { const a = t.v as number[]; const x = b(4); x.writeInt32BE(a.length); parts.push(x, Buffer.from(Int8Array.from(a).buffer)); break; }
      case 8: { const s = Buffer.from(t.v as string, 'utf8'); const x = b(2); x.writeUInt16BE(s.length); parts.push(x, s); break; }
      case 9: { const { type, items } = t.v as { type: number; items: T[] }; const x = b(5); x.writeUInt8(type); x.writeInt32BE(items.length, 1); parts.push(x); items.forEach(w); break; }
      case 10: {
        for (const [k, c] of Object.entries(t.v as Record<string, T>)) {
          const h = b(1); h.writeUInt8(c.t); parts.push(h); w(STR(k)); w(c);
        }
        parts.push(Buffer.from([0]));
        break;
      }
      case 12: { const a = t.v as bigint[]; const x = b(4); x.writeInt32BE(a.length); parts.push(x); for (const n of a) { const y = b(8); y.writeBigInt64BE(BigInt.asIntN(64, n)); parts.push(y); } break; }
    }
  };
  const root = Buffer.from([10]);
  parts.push(root);
  w(STR(''));
  w(tag);
  return zlib.gzipSync(Buffer.concat(parts));
}

// --- the house: 7 wide (x), 7 deep (z), 6 high; floor, walls with a door and windows, roof of stairs, a carpet, some sculk
const W = 7, H = 6, D = 7;
function blockAt(x: number, y: number, z: number): string {
  const edge = x === 0 || x === W - 1 || z === 0 || z === D - 1, corner = (x === 0 || x === W - 1) && (z === 0 || z === D - 1);
  if (y === 0) return 'minecraft:cobblestone';
  if (y <= 3) {
    if (!edge) return y === 1 && x === 3 && z === 3 ? 'minecraft:red_carpet' : 'minecraft:air';
    if (corner) return 'minecraft:dark_oak_log[axis=y]';
    if (x === 3 && z === D - 1 && y === 1) return 'minecraft:oak_door[facing=south,half=lower]';
    if (x === 3 && z === D - 1 && y === 2) return 'minecraft:oak_door[facing=south,half=upper]';
    if (y === 2 && (x === 3 || z === 3)) return 'minecraft:glass_pane';
    return 'minecraft:dark_oak_planks';
  }
  if (y === 4) return x === 1 && z === 1 ? 'minecraft:sculk' : 'minecraft:brick_stairs[facing=north]';
  return x >= 2 && x <= 4 && z >= 2 && z <= 4 ? 'minecraft:bricks' : 'minecraft:air';
}
const states: string[] = [];
const idOf = (s: string) => (states.includes(s) ? states.indexOf(s) : states.push(s) - 1);
const cellsYZX: number[] = []; // index x + z*W + y*W*D
for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) cellsYZX.push(idOf(blockAt(x, y, z)));
const varint = (n: number) => { const o: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b > 127 ? b - 256 : b); } while (n); return o; };

// Sponge v2
fs.writeFileSync(path.join(out, 'house.schem'), enc(C({
  Version: I(2), Width: S(W), Height: S(H), Length: S(D), PaletteMax: I(states.length),
  Palette: C(Object.fromEntries(states.map((s, i) => [s, I(i)]))), BlockData: BA(cellsYZX.flatMap(varint)),
})));

// Sponge v3 (nested under Schematic, Blocks compound)
fs.writeFileSync(path.join(out, 'house_v3.schem'), enc(C({
  Schematic: C({ Version: I(3), Width: S(W), Height: S(H), Length: S(D),
    Blocks: C({ Palette: C(Object.fromEntries(states.map((s, i) => [s, I(i)]))), Data: BA(cellsYZX.flatMap(varint)) }) }),
})));

// Legacy MCEdit (numeric ids): 4 cobblestone, 5:5 dark oak planks, 162:1 dark oak log, 64 door (8 = upper), 102 pane, 108 brick stairs, 45 bricks, 171 carpet
const legacyOf = (s: string): [number, number] => {
  if (s.includes('cobblestone')) return [4, 0];
  if (s.includes('dark_oak_planks')) return [5, 5];
  if (s.includes('dark_oak_log')) return [162, 1];
  if (s.includes('half=upper')) return [64, 8];
  if (s.includes('oak_door')) return [64, 0];
  if (s.includes('glass_pane')) return [102, 0];
  if (s.includes('brick_stairs')) return [108, 0];
  if (s.endsWith('bricks')) return [45, 0];
  if (s.includes('carpet')) return [171, 14];
  if (s.includes('sculk')) return [250, 0]; // unknown id
  return [0, 0];
};
const legacyCells = cellsYZX.map((id) => legacyOf(states[id]));
fs.writeFileSync(path.join(out, 'house.schematic'), enc(C({
  Width: S(W), Height: S(H), Length: S(D), Materials: STR('Alpha'),
  Blocks: BA(legacyCells.map(([id]) => (id > 127 ? id - 256 : id))), Data: BA(legacyCells.map(([, m]) => m)),
})));

// Litematica: bits per entry = max(2, ceil(log2(n))), entries packed across longs (may span two)
const bits = Math.max(2, Math.ceil(Math.log2(states.length)));
const words = new Array<bigint>(Math.ceil((cellsYZX.length * bits) / 64)).fill(0n);
cellsYZX.forEach((v, i) => {
  const bit = i * bits, word = Math.floor(bit / 64), off = BigInt(bit % 64);
  words[word] = BigInt.asUintN(64, words[word] | (BigInt(v) << off));
  if (bit % 64 + bits > 64) words[word + 1] = BigInt.asUintN(64, words[word + 1] | (BigInt(v) >> (64n - off)));
});
const paletteEntries = states.map((s) => {
  const [name, props] = [s.replace(/\[.*$/, ''), s.match(/\[(.*)\]/)?.[1]];
  const e: Record<string, T> = { Name: STR(name) };
  if (props) e.Properties = C(Object.fromEntries(props.split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, STR(v)])));
  return C(e);
});
fs.writeFileSync(path.join(out, 'house.litematic'), enc(C({
  Version: I(6),
  Regions: C({ house: C({ Position: C({ x: I(0), y: I(0), z: I(0) }), Size: C({ x: I(W), y: I(H), z: I(D) }), BlockStatePalette: L(10, paletteEntries), BlockStates: LA(words) }) }),
})));

// Structure block .nbt (air left out = structure void)
const blocks: T[] = [];
for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
  const id = cellsYZX[x + z * W + y * W * D];
  if (states[id] !== 'minecraft:air') blocks.push(C({ pos: L(3, [I(x), I(y), I(z)]), state: I(id) }));
}
fs.writeFileSync(path.join(out, 'house.nbt'), enc(C({ DataVersion: I(3700), size: L(3, [I(W), I(H), I(D)]), palette: L(10, paletteEntries), blocks: L(10, blocks) })));
console.log(`wrote 5 files, ${states.length} block states, ${bits} bits per litematic entry`);
