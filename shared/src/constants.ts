export const CHUNK_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const WORLD_HEIGHT = 256;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
export const SEA_LEVEL = 63;
export const TICKS_PER_SECOND = 20;
export const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Ticks in a full day/night cycle (20 minutes, like Minecraft). */
export const DAY_LENGTH = 24000;
export const DEFAULT_PORT = 8765;
export const PROTOCOL_VERSION = 1;

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.62;
export const PLAYER_SNEAK_HEIGHT = 1.5;
export const PLAYER_SNEAK_EYE = 1.27;
export const REACH_DISTANCE = 5;
export const MAX_HEALTH = 20;
export const MAX_FOOD = 20;

/** Face indices used everywhere: +X, -X, +Y, -Y, +Z, -Z */
export const FACE_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
export const Face = { East: 0, West: 1, Up: 2, Down: 3, South: 4, North: 5 } as const;
export const OPPOSITE_FACE = [1, 0, 3, 2, 5, 4];

export type GameMode = 'survival' | 'creative' | 'spectator';
