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
    const sideName = isDirectional(b.id) || b.name === 'crafting_table' ? t.front ?? t.side : t.side;
    const left = this.textureCanvas(sideName, isGrass ? tint : tint, isGrass);
    const right = this.textureCanvas(t.side, isGrass ? tint : tint, isGrass);
    // Isometric cube: size fits in S x S
    const s = S * 0.5; // half width
    const cx = S / 2;
    const h = S * 0.29; // top rhombus half-height
    let topY = S * 0.06;
    let sideH = S * 0.58;
    if (b.shape === 'slab') { topY += sideH * 0.5; sideH *= 0.5; }
    if (b.shape === 'snow_layer') { topY += sideH * 0.875; sideH *= 0.125; }
    // top face
    ctx.save();
    ctx.setTransform(s / 16, h / 16, -s / 16, h / 16, cx, topY);
    ctx.drawImage(top, 0, 0);
    ctx.restore();
    // left face (front)
    ctx.save();
    ctx.setTransform(s / 16, h / 16, 0, sideH / 16 * (b.shape === 'slab' ? 2 : 1), cx - s, topY + h);
    ctx.drawImage(left, 0, b.shape === 'slab' ? 8 : 0, 16, b.shape === 'slab' ? 8 : 16, 0, 0, 16, b.shape === 'slab' ? 8 : 16);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, 16, 16);
    ctx.restore();
    // right face
    ctx.save();
    ctx.setTransform(s / 16, -h / 16, 0, sideH / 16 * (b.shape === 'slab' ? 2 : 1), cx, topY + 2 * h);
    ctx.drawImage(right, 0, b.shape === 'slab' ? 8 : 0, 16, b.shape === 'slab' ? 8 : 16, 0, 0, 16, b.shape === 'slab' ? 8 : 16);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.fillRect(0, 0, 16, 16);
    ctx.restore();
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
