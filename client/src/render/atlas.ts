import * as THREE from 'three';
import { allTextureNames } from '../../../shared/src/blocks';
import { generateBlockTexture } from './textures/blockTextures';

export interface Atlas {
  texture: THREE.DataArrayTexture;
  layers: Record<string, number>;
  /** Raw RGBA pixels per texture name (16x16), for icons and particles. */
  pixels: Map<string, Uint8ClampedArray>;
  /** Average colour per texture (0..255). */
  average: Map<string, [number, number, number]>;
}

let cached: Atlas | null = null;

export function buildAtlas(): Atlas {
  if (cached) return cached;
  const names = ['missing', ...allTextureNames()];
  const layers: Record<string, number> = {};
  const pixels = new Map<string, Uint8ClampedArray>();
  const average = new Map<string, [number, number, number]>();
  const data = new Uint8Array(16 * 16 * 4 * names.length);
  names.forEach((name, i) => {
    let px: Uint8ClampedArray;
    try {
      px = generateBlockTexture(name);
    } catch (e) {
      console.warn('texture failed', name, e);
      px = checker();
    }
    if (px.length !== 1024) px = checker();
    pixels.set(name, px);
    // Average opaque colour and bleed it into transparent pixels (prevents dark mip fringes)
    let r = 0, g = 0, b = 0, n = 0;
    for (let p = 0; p < 256; p++) {
      if (px[p * 4 + 3] > 0) {
        r += px[p * 4]; g += px[p * 4 + 1]; b += px[p * 4 + 2]; n++;
      }
    }
    const avg: [number, number, number] = n ? [r / n, g / n, b / n] : [128, 128, 128];
    average.set(name, avg);
    const out = data.subarray(i * 1024, (i + 1) * 1024);
    for (let p = 0; p < 256; p++) {
      const a = px[p * 4 + 3];
      if (a === 0) {
        out[p * 4] = avg[0]; out[p * 4 + 1] = avg[1]; out[p * 4 + 2] = avg[2]; out[p * 4 + 3] = 0;
      } else {
        out[p * 4] = px[p * 4]; out[p * 4 + 1] = px[p * 4 + 1]; out[p * 4 + 2] = px[p * 4 + 2]; out[p * 4 + 3] = a;
      }
    }
    layers[name] = i;
  });
  const texture = new THREE.DataArrayTexture(data, 16, 16, names.length);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 1;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  cached = { texture, layers, pixels, average };
  return cached;
}

function checker(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(1024);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const on = ((x >> 3) ^ (y >> 3)) & 1;
      const i = (y * 16 + x) * 4;
      px[i] = on ? 255 : 0; px[i + 1] = 0; px[i + 2] = on ? 255 : 0; px[i + 3] = 255;
    }
  return px;
}
