/**
 * Minimal reader for Minecraft's NBT format (big-endian, usually gzipped), enough to load schematic files.
 * Compounds become plain objects, lists become arrays, byte/int/long arrays become typed arrays.
 */
import zlib from 'node:zlib';

export type Nbt = number | bigint | string | Nbt[] | Int8Array | Int32Array | BigInt64Array | { [key: string]: Nbt };

export function readNbt(data: Buffer): { name: string; value: { [key: string]: Nbt } } {
  const buf = data[0] === 0x1f && data[1] === 0x8b ? zlib.gunzipSync(data) : data;
  let pos = 0;
  const need = (n: number) => {
    if (pos + n > buf.length) throw new Error('truncated NBT data');
  };
  const u8 = () => (need(1), buf.readUInt8(pos++));
  const i8 = () => (need(1), buf.readInt8(pos++));
  const i16 = () => (need(2), (pos += 2), buf.readInt16BE(pos - 2));
  const u16 = () => (need(2), (pos += 2), buf.readUInt16BE(pos - 2));
  const i32 = () => (need(4), (pos += 4), buf.readInt32BE(pos - 4));
  const i64 = () => (need(8), (pos += 8), buf.readBigInt64BE(pos - 8));
  const str = () => {
    const n = u16();
    need(n);
    pos += n;
    return buf.toString('utf8', pos - n, pos);
  };
  const payload = (type: number, depth: number): Nbt => {
    if (depth > 512) throw new Error('NBT nested too deeply');
    switch (type) {
      case 1: return i8();
      case 2: return i16();
      case 3: return i32();
      case 4: return i64();
      case 5: return (need(4), (pos += 4), buf.readFloatBE(pos - 4));
      case 6: return (need(8), (pos += 8), buf.readDoubleBE(pos - 8));
      case 7: {
        const n = i32();
        need(n);
        const a = new Int8Array(buf.buffer.slice(buf.byteOffset + pos, buf.byteOffset + pos + n));
        pos += n;
        return a;
      }
      case 8: return str();
      case 9: {
        const t = u8(), n = i32();
        const out: Nbt[] = [];
        for (let i = 0; i < n; i++) out.push(payload(t, depth + 1));
        return out;
      }
      case 10: {
        const out: { [key: string]: Nbt } = {};
        for (;;) {
          const t = u8();
          if (t === 0) return out;
          out[str()] = payload(t, depth + 1);
        }
      }
      case 11: {
        const n = i32();
        const a = new Int32Array(n);
        for (let i = 0; i < n; i++) a[i] = i32();
        return a;
      }
      case 12: {
        const n = i32();
        const a = new BigInt64Array(n);
        for (let i = 0; i < n; i++) a[i] = i64();
        return a;
      }
      default:
        throw new Error(`unknown NBT tag type ${type}`);
    }
  };
  if (u8() !== 10) throw new Error('not an NBT file (the root is not a compound)');
  const name = str();
  return { name, value: payload(10, 0) as { [key: string]: Nbt } };
}
