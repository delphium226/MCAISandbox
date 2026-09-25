import { GameMode } from './constants';
import { ItemStack } from './items';
import { Chunk, decodeBlocks, encodeBlocks } from './chunk';

export type EntityKind =
  | 'player'
  | 'item'
  | 'pig'
  | 'cow'
  | 'sheep'
  | 'chicken'
  | 'zombie'
  | 'skeleton'
  | 'creeper'
  | 'spider'
  | 'arrow'
  | 'tnt'
  | 'falling_block'
  | 'xp';

export interface EntityState {
  id: number;
  kind: EntityKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  name?: string;
  /** Dropped item stack / held item */
  item?: ItemStack | null;
  /** Falling block state */
  state?: number;
  skin?: number;
  /** Armor item ids [helmet, chest, legs, boots] */
  armor?: (number | null)[];
  sneaking?: boolean;
  /** Sheep colour / wool state etc. */
  variant?: number;
  isAgent?: boolean;
  health?: number;
  baby?: boolean;
}

export type WindowKind = 'player' | 'crafting_table' | 'furnace' | 'chest';

// ---- Client -> Server ----------------------------------------------------------------------
export type C2S =
  | { t: 'hello'; name: string; version: number; skin?: number }
  | { t: 'move'; x: number; y: number; z: number; yaw: number; pitch: number; onGround: boolean; sneak: boolean; sprint: boolean; flying: boolean }
  | { t: 'dig'; a: 'start' | 'stop' | 'done'; x: number; y: number; z: number; face: number }
  | { t: 'useBlock'; x: number; y: number; z: number; face: number; hx: number; hy: number; hz: number; sneak: boolean }
  | { t: 'useItem' }
  | { t: 'eat' }
  | { t: 'hotbar'; slot: number }
  | { t: 'click'; w: number; slot: number; button: number; shift: boolean }
  | { t: 'drag'; w: number; slots: number[]; button: number }
  | { t: 'creative'; slot: number; item: ItemStack | null }
  | { t: 'closeWindow' }
  | { t: 'chat'; text: string }
  | { t: 'attack'; id: number }
  | { t: 'interact'; id: number }
  | { t: 'drop'; all: boolean }
  | { t: 'respawn' }
  | { t: 'swing' }
  | { t: 'pickBlock'; state: number }
  | { t: 'ping'; n: number };

// ---- Server -> Client ----------------------------------------------------------------------
export interface WindowUpdate {
  t: 'window';
  id: number;
  kind: WindowKind;
  title: string;
  slots: (ItemStack | null)[];
  cursor: ItemStack | null;
  /** furnace: [cookProgress 0..1, burn 0..1] */
  props?: number[];
}

export type S2C =
  | {
      t: 'welcome';
      id: number;
      name: string;
      x: number;
      y: number;
      z: number;
      yaw: number;
      pitch: number;
      time: number;
      gamemode: GameMode;
      viewDistance: number;
      seed: number;
      spawn: [number, number, number];
    }
  | { t: 'unload'; cx: number; cz: number }
  | { t: 'block'; x: number; y: number; z: number; s: number }
  | { t: 'spawn'; e: EntityState }
  | { t: 'despawn'; ids: number[] }
  /** Batched positions: [id, x, y, z, yaw, pitch, id, ...] */
  | { t: 'moves'; d: number[] }
  | { t: 'meta'; id: number; e: Partial<EntityState> }
  | { t: 'anim'; id: number; a: 'swing' | 'hurt' | 'death' | 'eat' | 'shear' }
  | { t: 'inv'; slots: (ItemStack | null)[]; armor: (ItemStack | null)[]; selected: number }
  | WindowUpdate
  | { t: 'closeWindow' }
  | { t: 'health'; hp: number; food: number; sat: number; air: number }
  | { t: 'chat'; text: string; from?: string; color?: string }
  | { t: 'time'; time: number; rate: number }
  | { t: 'players'; list: { id: number; name: string; agent?: boolean; ping?: number }[] }
  | { t: 'sound'; s: string; x: number; y: number; z: number; v?: number; p?: number }
  | { t: 'particles'; k: 'block' | 'explosion' | 'smoke' | 'crit' | 'heart' | 'splash'; x: number; y: number; z: number; s?: number; n?: number }
  | { t: 'teleport'; x: number; y: number; z: number; yaw?: number; pitch?: number }
  | { t: 'gamemode'; mode: GameMode }
  | { t: 'death'; msg: string }
  | { t: 'breakAnim'; id: number; x: number; y: number; z: number; stage: number }
  | { t: 'velocity'; vx: number; vy: number; vz: number }
  | { t: 'pong'; n: number }
  | { t: 'kick'; reason: string };

export const BIN_CHUNK = 1;

/** Binary chunk packet: [u8 type][u8 pad][i32 cx][i32 cz][u8 biomes x256][u16 RLE...] */
export function encodeChunkPacket(chunk: Chunk): Uint8Array {
  const rle = encodeBlocks(chunk.blocks);
  const buf = new ArrayBuffer(10 + 256 + rle.byteLength);
  const dv = new DataView(buf);
  dv.setUint8(0, BIN_CHUNK);
  dv.setInt32(2, chunk.cx, true);
  dv.setInt32(6, chunk.cz, true);
  new Uint8Array(buf, 10, 256).set(chunk.biomes);
  new Uint16Array(buf, 266, rle.length).set(rle);
  return new Uint8Array(buf);
}

export function decodeChunkPacket(buf: ArrayBuffer): Chunk {
  const dv = new DataView(buf);
  const cx = dv.getInt32(2, true);
  const cz = dv.getInt32(6, true);
  const rle = new Uint16Array(buf.slice(266));
  const chunk = new Chunk(cx, cz, decodeBlocks(rle));
  chunk.biomes.set(new Uint8Array(buf, 10, 256));
  return chunk;
}
