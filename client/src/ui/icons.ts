import { itemDef } from '../../../shared/src/items';
import { BlockDef, isDirectional } from '../../../shared/src/blocks';
import type { Atlas } from '../render/atlas';
import type { ItemModels } from '../render/itemModels';

/** Renders inventory icons (isometric blocks / flat sprites) into cached data URLs. */
export class IconRenderer {
  private cache = new Map<number, string>();
  private texCanvas = new Map<string, HTMLCanvasElement>();
  constructor(private atlas: Atlas, private items: ItemModels) {}

  private textureCanvas(name: string, tint?: number[], mask = false): HTMLCanvasElement {
    const key = `${name}|${tint?.join(',') ?? ''}|${mask}`;
    let c = this.texCanvas.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d')!;
    const src = this.atlas.pixels.get(name);
    const img = ctx.createImageData(16, 16);
    if (src) {
      for (let i = 0; i < 256; i++) {
        let r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2], a = src[i * 4 + 3];
        const doTint = tint && (!mask || (a > 100 && a < 200));
        if (doTint) {
          r = (r * tint![0]) / 255; g = (g * tint![1]) / 255; b = (b * tint![2]) / 255;
        }
        if (mask && a > 100 && a < 200) a = 255;
        img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.texCanvas.set(key, c);
    return c;
  }

  icon(id: number): string {
    let url = this.cache.get(id);
    if (url) return url;
    const def = itemDef(id);
    const S = 64;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const flatPx = this.items.iconPixels(id);
    if (flatPx) {
      const t = document.createElement('canvas');
      t.width = t.height = 16;
      const tctx = t.getContext('2d')!;
      const img = tctx.createImageData(16, 16);
      const tint = def.block && def.block.tint !== 'none' ? tintColor(def.block) : null;
      for (let i = 0; i < 256; i++) {
        img.data[i * 4] = tint ? (flatPx[i * 4] * tint[0]) / 255 : flatPx[i * 4];
        img.data[i * 4 + 1] = tint ? (flatPx[i * 4 + 1] * tint[1]) / 255 : flatPx[i * 4 + 1];
        img.data[i * 4 + 2] = tint ? (flatPx[i * 4 + 2] * tint[2]) / 255 : flatPx[i * 4 + 2];
        img.data[i * 4 + 3] = flatPx[i * 4 + 3];
      }
      tctx.putImageData(img, 0, 0);
      ctx.drawImage(t, 0, 0, S, S);
    } else if (def.block) {
      this.drawBlock(ctx, def.block, S);
    }
    url = c.toDataURL();
    this.cache.set(id, url);
    return url;
  }

  private drawBlock(ctx: CanvasRenderingContext2D, b: BlockDef, S: number) {
    const t = b.textures;
    const tint = b.tint !== 'none' ? tintColor(b) : undefined;
    const isGrass = b.name === 'grass_block';
    const top = this.textureCanvas(t.top, tint);
    const frontName = isDirectional(b.id) || b.name === 'crafting_table' ? t.front ?? t.side : t.side;
    const left = this.textureCanvas(frontName, tint, isGrass);
    const right = this.textureCanvas(t.side, tint, isGrass);
    // Box list (block units) for the item's shape, drawn back-to-front
    type Box = [number, number, number, number, number, number];
    let boxes: Box[] = [[0, 0, 0, 1, 1, 1]];
    switch (b.shape) {
      case 'slab': boxes = [[0, 0, 0, 1, 0.5, 1]]; break;
      case 'snow_layer': boxes = [[0, 0, 0, 1, 0.125, 1]]; break;
      case 'farmland': boxes = [[0, 0, 0, 1, 15 / 16, 1]]; break;
      case 'cactus': boxes = [[1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16]]; break;
      case 'stairs': boxes = [[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 1, 1, 0.5]]; break;
      case 'fence':
        boxes = b.name.endsWith('wall')
          ? [[0.25, 0, 0, 0.75, 1, 0.3], [0.31, 0, 0.3, 0.69, 0.8, 0.7], [0.25, 0, 0.7, 0.75, 1, 1]]
          : [[0.375, 0, 0, 0.625, 1, 0.25], [0.4375, 0.75, 0.25, 0.5625, 0.9375, 0.75], [0.4375, 0.375, 0.25, 0.5625, 0.5625, 0.75], [0.375, 0, 0.75, 0.625, 1, 1]];
        break;
    }
    // Isometric projection of block-space points (viewer at +X,+Z looking down)
    const s = S * 0.5, h = S * 0.29, H = S * 0.58;
    const cx = S / 2, baseY = S * 0.06 + H;
    const P = (x: number, y: number, z: number) => [cx + (x - z) * s, baseY + (x + z) * h - y * H] as const;
    const face = (tex: HTMLCanvasElement, o: readonly number[], du: readonly number[], dv: readonly number[], u0: number, v0: number, u1: number, v1: number, shade: number) => {
      ctx.save();
      ctx.setTransform((du[0] - o[0]) / 16, (du[1] - o[1]) / 16, (dv[0] - o[0]) / 16, (dv[1] - o[1]) / 16, o[0], o[1]);
      const w = Math.max(0.01, u1 - u0), hh = Math.max(0.01, v1 - v0);
      ctx.drawImage(tex, u0, v0, w, hh, u0, v0, w, hh);
      if (shade > 0) {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.fillRect(u0, v0, w, hh);
      }
      ctx.restore();
    };
    boxes.sort((p, q) => p[0] + p[2] - (q[0] + q[2]) || p[1] - q[1]);
    for (const [x0, y0, z0, x1, y1, z1] of boxes) {
      // top: u along +x, v along +z
      face(top, P(0, y1, 0), P(1, y1, 0), P(0, y1, 1), x0 * 16, z0 * 16, x1 * 16, z1 * 16, 0);
      // +z side (left): u along +x, v down
      face(left, P(0, 1, z1), P(1, 1, z1), P(0, 0, z1), x0 * 16, (1 - y1) * 16, x1 * 16, (1 - y0) * 16, 0.22);
      // +x side (right): u along -z, v down
      face(right, P(x1, 1, 1), P(x1, 1, 0), P(x1, 0, 1), (1 - z1) * 16, (1 - y1) * 16, (1 - z0) * 16, (1 - y0) * 16, 0.42);
    }
  }
}

function tintColor(b: BlockDef): number[] {
  switch (b.tint) {
    case 'grass': return [0x7f, 0xb2, 0x38];
    case 'foliage': return [0x59, 0xae, 0x30];
    case 'birch': return [128, 167, 85];
    case 'spruce': return [97, 153, 97];
    case 'water': return [0x3f, 0x76, 0xe4];
    default: return [255, 255, 255];
  }
}
