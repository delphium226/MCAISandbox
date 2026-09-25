/**
 * Procedurally generated Minecraft-style entity skins.
 *
 * Pure pixel math (no DOM / canvas), deterministic (seeded hashing), so it runs in Web Workers and Node.
 * Every texture follows the box-UV layout declared in `../entityModels` (Minecraft convention), and the
 * face regions are looked up from the model definitions so the two files can never drift apart.
 */
import { MODELS, boxFaceRects, type BoxDef } from '../entityModels';

export interface EntityTexture {
  width: number;
  height: number;
  /** RGBA, row-major, row 0 = top of the image. */
  data: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------------------------

type RGB = readonly [number, number, number];
type Face = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';
const FACES: readonly Face[] = ['top', 'bottom', 'right', 'front', 'left', 'back'];
const FACE_INDEX: Record<Face, number> = { top: 0, bottom: 1, right: 2, front: 3, left: 4, back: 5 };

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

function hex(s: string): RGB {
  const n = parseInt(s.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const c8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
function mix(a: RGB, b: RGB, t: number): RGB {
  return [c8(a[0] + (b[0] - a[0]) * t), c8(a[1] + (b[1] - a[1]) * t), c8(a[2] + (b[2] - a[2]) * t)];
}
function mul(c: RGB, f: number): RGB {
  return [c8(c[0] * f), c8(c[1] * f), c8(c[2] * f)];
}

interface Tones {
  hi: RGB;
  mid: RGB;
  lo: RGB;
  lo2: RGB;
}
function tones(c: RGB): Tones {
  return { hi: mix(mul(c, 1.12), WHITE, 0.06), mid: c, lo: mul(c, 0.84), lo2: mul(c, 0.7) };
}

/** Integer hash → [0,1). Deterministic, platform independent. */
function hash3(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0,1). */
function vnoise(x: number, y: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let tx = fx - ix;
  let ty = fy - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const a = hash3(ix, iy, seed);
  const b = hash3(ix + 1, iy, seed);
  const c = hash3(ix, iy + 1, seed);
  const d = hash3(ix + 1, iy + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

class Tex {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: RGB, a = 255): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }
  toEntityTexture(): EntityTexture {
    return { width: this.w, height: this.h, data: this.data };
  }
}

/**
 * Painter for one box: called for every pixel of every face with face-local coordinates
 * (x right, y down, face size w x h) and absolute texture coordinates (tx, ty).
 * Return null to leave the pixel untouched (transparent unless painted before).
 */
type Painter = (f: Face, x: number, y: number, w: number, h: number, tx: number, ty: number) => RGB | null;

function paintBox(t: Tex, box: Pick<BoxDef, 'size' | 'uv'>, p: Painter): void {
  const rects = boxFaceRects(box);
  for (const f of FACES) {
    const [rx, ry, rw, rh] = rects[f];
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const c = p(f, x, y, rw, rh, rx + x, ry + y);
        if (c) t.set(rx + x, ry + y, c);
      }
    }
  }
}

function getBox(kind: string, name: string): BoxDef {
  const b = MODELS[kind]?.boxes.find((bb) => bb.name === name);
  if (!b) throw new Error(`entityTextures: model ${kind} has no box ${name}`);
  return b;
}

function texFor(kind: string): Tex {
  const ts = MODELS[kind]?.texSize ?? [64, 64];
  return new Tex(ts[0], ts[1]);
}

/**
 * Distance of a side-face column from the box's FRONT (-Z) edge (0 = front edge).
 * In the box-UV unfold the right face's last column touches the front face, the left face's first does.
 */
function fromFront(f: Face, x: number, w: number): number {
  if (f === 'right') return w - 1 - x;
  if (f === 'left') return x;
  return 0;
}

/** Pick from a palette with a threshold list (ascending cumulative weights). */
function pick(v: number, pal: readonly RGB[], cum: readonly number[]): RGB {
  for (let i = 0; i < cum.length; i++) if (v < cum[i]) return pal[i];
  return pal[pal.length - 1];
}

// ---------------------------------------------------------------------------------------------
// Humanoids: player variants + zombie
// ---------------------------------------------------------------------------------------------

type HairStyle = 'short' | 'long' | 'buzz' | 'fringe' | 'bob';
type TopStyle = 'tshirt' | 'long' | 'hoodie' | 'jacket';

interface HumanSpec {
  seed: number;
  skin: RGB;
  hair: RGB;
  eye: RGB;
  hairStyle: HairStyle;
  beard?: 'stubble' | 'full';
  brows?: boolean;
  top: TopStyle;
  shirt: RGB;
  inner?: RGB;
  pants: RGB;
  shoes: RGB;
  shoeRows?: number;
  belt?: RGB;
  beanie?: RGB;
  glasses?: RGB;
  mouth?: RGB;
  zombie?: boolean;
}

/** Side-of-head masks, columns run from the FRONT edge (col 0) to the BACK edge (col 7). */
const SIDE_MASKS: Record<HairStyle, string[]> = {
  short: ['HHHHHHHH', 'HHHHHHHH', 'SHHHHHHH', 'SHHhHHHH', 'SSSEEHHH', 'SSSEeHHH', 'BBSSSSHH', 'BBSSSNHH'],
  fringe: ['HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'SHHhHHHH', 'SSSEEHHH', 'SSSEeHHH', 'BBSSSSHH', 'BBSSSNHH'],
  buzz: ['HHHHHHHH', 'SHHHHHHH', 'SSHhHHHH', 'SSSSHHHH', 'SSSEEHHH', 'SSSEeSHH', 'BBSSSSSS', 'BBSSSNNN'],
  long: ['HHHHHHHH', 'HHHHHHHH', 'SHHHHHHH', 'SHHHHHHH', 'SHHHHHHH', 'SHHHHHHH', 'BHHHHHHH', 'BHHHHHHH'],
  bob: ['HHHHHHHH', 'HHHHHHHH', 'HHHHHHHH', 'SHHHHHHH', 'SHHHHHHH', 'SHHHHHHH', 'BSHHHHHH', 'BSSHHHHH'],
};

function frontHair(hs: HairStyle, x: number, y: number): boolean {
  const edge = x === 0 || x === 7;
  switch (hs) {
    case 'short':
      return y <= 1 || (y === 2 && edge);
    case 'buzz':
      return y === 0 || (y === 1 && edge);
    case 'fringe':
      return (y <= 2 && !(y === 2 && x === 5)) || (y === 3 && (x === 0 || x === 6 || x === 7));
    case 'long':
      return y <= 1 || edge || (y === 2 && (x === 1 || x === 6));
    case 'bob':
      return (y <= 2 && !(y === 2 && (x === 3 || x === 4))) || (edge && y <= 6);
  }
}

function genHuman(kind: string, s: HumanSpec): Tex {
  const t = texFor(kind);
  const skin = tones(s.skin);
  const hair = tones(s.hair);
  const shirt = tones(s.shirt);
  const inner = tones(s.inner ?? s.shirt);
  const pants = tones(s.pants);
  const shoes = tones(s.shoes);
  const Z = !!s.zombie;
  const r = (k: number, f: Face, x: number, y: number): number => hash3(x + FACE_INDEX[f] * 23, y + k * 97, s.seed);

  const hairPx = (f: Face, x: number, y: number): RGB => {
    const v = r(1, f, x, y);
    return v < 0.12 ? hair.hi : v < 0.84 ? hair.mid : hair.lo;
  };
  const skinPx = (f: Face, x: number, y: number, k = 2): RGB => {
    const v = r(k, f, x, y);
    if (Z) return v < 0.1 ? skin.hi : v > 0.88 ? skin.lo : skin.mid;
    return v < 0.04 ? skin.hi : skin.mid;
  };
  const cloth = (tn: Tones, k: number, f: Face, x: number, y: number): RGB => {
    const v = r(k, f, x, y);
    return v < 0.035 ? tn.hi : v > 0.94 ? tn.lo : tn.mid;
  };
  const beardPx = (f: Face, x: number, y: number): RGB => {
    if (s.beard === 'full') return r(3, f, x, y) < 0.35 ? hair.lo : hair.mid;
    return r(3, f, x, y) < 0.5 ? mix(skin.lo, hair.mid, 0.35) : mix(skin.lo, hair.lo, 0.5);
  };
  const mouth = s.mouth ?? mix(skin.lo2, hex('#4a2418'), 0.45);
  const eyeLo = mul(s.eye, 0.75);

  // ---- Head (base layer) -------------------------------------------------------------------
  const head = getBox(kind, 'head');
  paintBox(t, head, (f, x, y, w) => {
    if (f === 'top') return hairPx(f, x, y);
    if (f === 'bottom') return s.hairStyle === 'long' && y === 0 ? hair.lo : skin.lo;
    if (f === 'back') {
      if (s.hairStyle === 'buzz' && y >= 6) return y === 7 ? skin.lo : skinPx(f, x, y);
      return y === 7 ? hair.lo : hairPx(f, x, y);
    }
    if (f === 'right' || f === 'left') {
      const ff = fromFront(f, x, w);
      const ch = SIDE_MASKS[s.hairStyle][y][ff];
      switch (ch) {
        case 'H':
          return hairPx(f, x, y);
        case 'h':
          return hair.lo;
        case 'E':
          return Z ? skin.lo : mix(skin.mid, skin.lo, 0.7);
        case 'e':
          return skin.lo2;
        case 'N':
          return skin.lo;
        case 'B':
          return s.beard ? beardPx(f, x, y) : skinPx(f, x, y);
        default:
          return ff === 0 && y >= 6 ? skin.lo : skinPx(f, x, y);
      }
    }
    // front: the face
    if (frontHair(s.hairStyle, x, y)) {
      const below = y < 7 && !frontHair(s.hairStyle, x, y + 1);
      return below ? (r(4, f, x, y) < 0.5 ? hair.lo : hair.mid) : hairPx(f, x, y);
    }
    if (y === 4) {
      if (Z) {
        if (x === 1 || x === 6) return eyeLo;
        if (x === 2 || x === 5) return s.eye;
      } else {
        if (x === 1 || x === 6) return WHITE;
        if (x === 2 || x === 5) return s.eye;
      }
    }
    if (y === 3 && s.brows && (x === 1 || x === 2 || x === 5 || x === 6)) return mix(hair.lo, skin.lo, 0.3);
    if (y === 5 && (x === 3 || x === 4)) return Z ? skin.lo2 : x === 3 ? mix(skin.lo, skin.lo2, 0.5) : skin.lo;
    if (Z) {
      if (y === 6 && x >= 2 && x <= 5) return skin.lo2;
      if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return skin.lo;
      if (y === 7 && (x === 3 || x === 4)) return skin.lo;
    } else {
      if (y === 6 && (x === 3 || x === 4)) return mouth;
      if (s.beard === 'full') {
        if ((y === 6 && x >= 1 && x <= 6) || (y === 7 && x >= 1 && x <= 6) || (y === 5 && (x === 1 || x === 6)))
          return beardPx(f, x, y);
      } else if (s.beard === 'stubble') {
        if ((y === 6 && (x === 2 || x === 5)) || (y === 7 && x >= 2 && x <= 5)) return beardPx(f, x, y);
      } else if (y === 6 && (x === 2 || x === 5)) return skin.lo;
      if (y === 5 && (x === 1 || x === 6)) return skin.hi; // cheeks
    }
    if (y === 7 && (x === 0 || x === 7)) return skin.lo;
    return skinPx(f, x, y);
  });

  // ---- Hat / hair overlay (mostly transparent) ---------------------------------------------
  const hat = getBox(kind, 'hat');
  if (s.beanie) {
    const bn = tones(s.beanie);
    paintBox(t, hat, (f, x, y) => {
      if (f === 'bottom') return null;
      if (f === 'top') return (x + y) % 3 === 0 ? bn.lo : bn.mid;
      if (y > 2) return null;
      if (y === 2) return x % 2 === 0 ? bn.hi : mix(bn.hi, bn.mid, 0.5); // folded cuff
      return x % 2 === 0 ? bn.mid : bn.lo; // knit ribs
    });
  } else if (s.hairStyle === 'long' || s.hairStyle === 'bob') {
    const maxY = s.hairStyle === 'long' ? 7 : 6;
    paintBox(t, hat, (f, x, y, w) => {
      if (f === 'bottom') return null;
      if (f === 'top') return r(5, f, x, y) < 0.7 ? hairPx(f, x, y) : null;
      if (f === 'back') return y <= maxY ? (y === maxY ? hair.lo : hairPx(f, x, y)) : null;
      if (f === 'front') {
        if (y === 0) return hairPx(f, x, y);
        if ((x === 0 || x === 7) && y <= maxY - 1 && y >= 1) return hair.lo;
        return null;
      }
      const ff = fromFront(f, x, w);
      if (ff >= 1 && y <= maxY) return y === maxY ? hair.lo : hairPx(f, x, y);
      if (ff === 0 && y <= 1) return hairPx(f, x, y);
      return null;
    });
  }
  if (s.glasses) {
    const g = s.glasses;
    const gl = tones(g);
    paintBox(t, hat, (f, x, y, w) => {
      if (f === 'front') {
        if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return g;
        if (y === 4 && (x === 0 || x === 3 || x === 4 || x === 7)) return x === 3 || x === 4 ? gl.hi : g;
        return null;
      }
      if (f === 'right' || f === 'left') {
        const ff = fromFront(f, x, w);
        if (y === 4 && ff <= 3) return g;
      }
      return null;
    });
  }

  // ---- Body ---------------------------------------------------------------------------------
  const body = getBox(kind, 'body');
  const torn = (k: number, f: Face, x: number, y: number, p: number): boolean => Z && r(k, f, x, y) < p;
  paintBox(t, body, (f, x, y, w) => {
    if (f === 'top') return s.top === 'jacket' && (x === 3 || x === 4) ? inner.mid : shirt.mid;
    if (f === 'bottom') return pants.lo;
    // trousers waistband
    if (y >= 10) {
      if (y === 10 && s.belt) {
        if (f === 'front' && (x === 3 || x === 4)) return hex('#c8b040');
        return tones(s.belt).mid;
      }
      if (y === 11 && torn(6, f, x, y, 0.06)) return skin.lo;
      return cloth(pants, 7, f, x, y);
    }
    if (torn(8, f, x, y, y >= 8 ? 0.16 : 0.035)) return r(9, f, x, y) < 0.5 ? skin.mid : skin.lo;
    if (Z && r(10, f, x, y) < 0.04) return shirt.lo2;
    const edgeShade = (f === 'front' || f === 'back') && (x === 0 || x === w - 1);
    let c = cloth(shirt, 11, f, x, y);
    if (edgeShade && r(12, f, x, y) < 0.6) c = shirt.lo;
    if (y === 9) c = shirt.lo; // hem
    if (f === 'front') {
      switch (s.top) {
        case 'tshirt':
          if (y === 0 && (x === 3 || x === 4)) return skin.mid;
          break;
        case 'long':
          if (y === 0 && x >= 2 && x <= 5) return x === 3 || x === 4 ? skin.mid : shirt.lo;
          break;
        case 'hoodie':
          if (y === 0 && x >= 2 && x <= 5) return x === 3 || x === 4 ? skin.lo : shirt.lo;
          if ((x === 2 || x === 5) && y >= 1 && y <= 3) return y === 3 ? hex('#c8c8c8') : hex('#eeeeee');
          if (y >= 6 && y <= 8 && x >= 1 && x <= 6) {
            if (y === 6 || x === 1 || x === 6) return shirt.lo;
            return shirt.mid;
          }
          break;
        case 'jacket':
          if (x === 3 || x === 4) {
            if (y === 0) return skin.mid;
            return cloth(inner, 13, f, x, y);
          }
          if ((x === 2 || x === 5) && y <= 1) return shirt.hi; // lapels
          if (x === 2 || x === 5) return shirt.lo;
          if (y === 5 && (x === 1 || x === 6)) return shirt.lo2; // pocket slit
          break;
      }
    }
    if (f === 'back' && s.top === 'hoodie' && y <= 2 && x >= 1 && x <= 6) {
      return y === 0 || x === 1 || x === 6 ? shirt.lo : shirt.lo2;
    }
    return c;
  });

  // ---- Arms ---------------------------------------------------------------------------------
  const sleeve = Z ? 3 : s.top === 'tshirt' ? 4 : 11;
  const arm = (name: string, k: number, outer: Face): void => {
    paintBox(t, getBox(kind, name), (f, x, y) => {
      if (f === 'top') return sleeve > 0 ? shirt.mid : skin.mid;
      if (f === 'bottom') return skin.lo;
      let inSleeve = y < sleeve;
      if (Z && y === sleeve) inSleeve = r(k, f, x, y) < 0.5;
      if (inSleeve) {
        if (torn(k + 1, f, x, y, 0.06)) return skin.lo;
        if (y === sleeve - 1 && !Z) return s.top === 'tshirt' ? shirt.lo : cloth(shirt, k + 2, f, x, y);
        if ((s.top === 'hoodie' || s.top === 'long') && y === 10) return shirt.lo;
        const c = cloth(shirt, k + 2, f, x, y);
        return f === outer && x % 2 === 0 ? mix(c, shirt.lo, 0.5) : c;
      }
      if (y === 11) return f === 'front' ? skin.lo : skinPx(f, x, y, k + 3);
      return f === 'back' && x === 0 ? skin.lo : skinPx(f, x, y, k + 3);
    });
  };
  arm('rightArm', 20, 'right');
  arm('leftArm', 30, 'left');

  // ---- Legs ---------------------------------------------------------------------------------
  const shoeRows = s.shoeRows ?? 2;
  const leg = (name: string, k: number, innerFace: Face): void => {
    paintBox(t, getBox(kind, name), (f, x, y, w) => {
      if (f === 'top') return pants.mid;
      if (f === 'bottom') return shoes.lo;
      if (y >= 12 - shoeRows) {
        if (y === 11) return shoes.lo;
        if (f === 'front' && y === 12 - shoeRows) return shoes.hi;
        return r(k, f, x, y) < 0.3 ? shoes.lo : shoes.mid;
      }
      if (Z && y >= 10 && r(k + 1, f, x, y) < 0.15) return skin.lo;
      let c = cloth(pants, k + 2, f, x, y);
      if (f === innerFace) c = r(k + 3, f, x, y) < 0.7 ? pants.lo : c;
      if (y === 11 - shoeRows) c = pants.lo; // hem
      if (f === 'front' && y === 6 && x === 1) c = pants.hi; // knee highlight
      if (f === 'back' && x === w - 1) c = pants.lo;
      return c;
    });
  };
  leg('rightLeg', 40, 'left');
  leg('leftLeg', 50, 'right');

  return t;
}

const PLAYER_VARIANTS: HumanSpec[] = [
  // 0: classic Steve-like
  {
    seed: 1001,
    skin: hex('#b78469'),
    hair: hex('#36230f'),
    eye: hex('#4a3a8c'),
    hairStyle: 'short',
    beard: 'stubble',
    top: 'tshirt',
    shirt: hex('#00a3a3'),
    pants: hex('#3f3a9c'),
    shoes: hex('#6b6b6b'),
    mouth: hex('#6a4030'),
  },
  // 1: Alex-like, ginger long hair, green top
  {
    seed: 1002,
    skin: hex('#efc6a4'),
    hair: hex('#d4712a'),
    eye: hex('#3b8a3a'),
    hairStyle: 'long',
    brows: false,
    top: 'long',
    shirt: hex('#5e9c46'),
    pants: hex('#6a4a2c'),
    shoes: hex('#3a3a3a'),
    belt: hex('#4a3020'),
    mouth: hex('#c07a6a'),
  },
  // 2: dark skin, black buzz cut, full beard, red tee, grey jeans, white trainers
  {
    seed: 1003,
    skin: hex('#6e4731'),
    hair: hex('#1e1815'),
    eye: hex('#3a2616'),
    hairStyle: 'buzz',
    beard: 'full',
    top: 'tshirt',
    shirt: hex('#b8302c'),
    pants: hex('#3d424c'),
    shoes: hex('#e2e2e2'),
    mouth: hex('#3a2016'),
  },
  // 3: blonde fringe, purple hoodie, black jeans, brown boots
  {
    seed: 1004,
    skin: hex('#d9a684'),
    hair: hex('#e0bf5a'),
    eye: hex('#3f6fc4'),
    hairStyle: 'fringe',
    top: 'hoodie',
    shirt: hex('#7b48ad'),
    pants: hex('#2a2a2e'),
    shoes: hex('#5c3a1e'),
    shoeRows: 3,
    mouth: hex('#8a5040'),
  },
  // 4: tan, black bob, yellow jacket over white tee, blue jeans
  {
    seed: 1005,
    skin: hex('#c58b62'),
    hair: hex('#231b17'),
    eye: hex('#4a2e1c'),
    hairStyle: 'bob',
    brows: true,
    top: 'jacket',
    shirt: hex('#e2b22c'),
    inner: hex('#ececec'),
    pants: hex('#3d5a8e'),
    shoes: hex('#8c2c2c'),
    mouth: hex('#9a4c44'),
  },
  // 5: older, grey hair + beard, brown jacket, khaki trousers
  {
    seed: 1006,
    skin: hex('#e2b89a'),
    hair: hex('#a9a9a4'),
    eye: hex('#50708f'),
    hairStyle: 'short',
    beard: 'full',
    brows: true,
    top: 'jacket',
    shirt: hex('#6c4a2e'),
    inner: hex('#c9b996'),
    pants: hex('#8d7d58'),
    shoes: hex('#3a2a1e'),
    belt: hex('#2e2018'),
  },
  // 6: deep brown skin, green beanie, orange hoodie, grey trousers
  {
    seed: 1007,
    skin: hex('#8c5a3b'),
    hair: hex('#3a2416'),
    eye: hex('#2a1a10'),
    hairStyle: 'short',
    beanie: hex('#2f8a52'),
    top: 'hoodie',
    shirt: hex('#d8721e'),
    pants: hex('#595b60'),
    shoes: hex('#262626'),
    mouth: hex('#4e2a1c'),
  },
  // 7: red long hair, glasses, blue long-sleeve, navy trousers, tan boots
  {
    seed: 1008,
    skin: hex('#f0cfb4'),
    hair: hex('#a2301e'),
    eye: hex('#3c7c5a'),
    hairStyle: 'long',
    glasses: hex('#262626'),
    top: 'long',
    shirt: hex('#3b6cc6'),
    pants: hex('#2f3a62'),
    shoes: hex('#8b5a2b'),
    shoeRows: 3,
    mouth: hex('#c07a6a'),
  },
];

const ZOMBIE_SPEC: HumanSpec = {
  seed: 2001,
  skin: hex('#5a8c42'),
  hair: hex('#2f5823'),
  eye: hex('#1a2614'),
  hairStyle: 'short',
  top: 'tshirt',
  shirt: hex('#00a2a2'),
  pants: hex('#3e3793'),
  shoes: hex('#2f2a70'),
  zombie: true,
};

// ---------------------------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------------------------

function genSkeleton(): Tex {
  const kind = 'skeleton';
  const t = texFor(kind);
  const bone = tones(hex('#bdbdbd'));
  const dark = hex('#2c2c2c');
  const dark2 = hex('#3c3c3c');
  const r = (k: number, f: Face, x: number, y: number): number => hash3(x + FACE_INDEX[f] * 23, y + k * 97, 3001);
  const bonePx = (k: number, f: Face, x: number, y: number): RGB => {
    const v = r(k, f, x, y);
    return v < 0.1 ? bone.hi : v > 0.93 ? bone.lo : bone.mid;
  };
  const gap = (k: number, f: Face, x: number, y: number): RGB => (r(k, f, x, y) < 0.3 ? dark2 : dark);

  paintBox(t, getBox(kind, 'head'), (f, x, y, w) => {
    if (f === 'bottom') return bone.lo;
    if (f === 'front') {
      const eye = (x === 1 || x === 2 || x === 5 || x === 6) && (y === 3 || y === 4);
      if (eye) return y === 3 ? dark2 : dark;
      if (y === 5 && (x === 3 || x === 4)) return dark2;
      if (y === 6 && x >= 1 && x <= 6) return x === 2 || x === 5 ? bone.hi : dark;
      if (y === 7 && x >= 2 && x <= 5) return bone.lo;
      if (y === 2 && (x === 1 || x === 2 || x === 5 || x === 6)) return bone.lo;
      return bonePx(1, f, x, y);
    }
    if (f === 'right' || f === 'left') {
      const ff = fromFront(f, x, w);
      if (y >= 5 && ff === 3) return bone.lo; // jaw hinge
      if (y === 4 && ff === 4) return bone.lo2;
    }
    if (f === 'back' && y === 7) return bone.lo;
    return bonePx(2, f, x, y);
  });

  paintBox(t, getBox(kind, 'body'), (f, x, y, w) => {
    if (f === 'top') return bonePx(3, f, x, y);
    if (f === 'bottom') return (x >= 1 && x <= 2) || (x >= 5 && x <= 6) ? bone.lo : dark;
    const spine = (f === 'front' || f === 'back') && (x === 3 || x === 4);
    if (y === 0) return bonePx(4, f, x, y);
    if (y === 2 || y === 4 || y === 6) {
      if (f === 'front' || f === 'back') {
        const inset = y === 6 ? 2 : 1;
        if (x >= inset && x <= w - 1 - inset) return y === 6 ? bone.lo : bonePx(5, f, x, y);
        return gap(6, f, x, y);
      }
      return y === 6 ? bone.lo : bonePx(5, f, x, y);
    }
    if (y === 9) {
      if (f === 'front' || f === 'back') return x >= 1 && x <= w - 2 ? bonePx(7, f, x, y) : gap(6, f, x, y);
      return bone.lo;
    }
    if (y === 10) {
      if (f === 'front' || f === 'back') return x === 0 || x === w - 1 ? gap(6, f, x, y) : x === 3 || x === 4 ? bone.lo : bone.mid;
      return gap(6, f, x, y);
    }
    if (y === 11) {
      if (f === 'front' || f === 'back') return (x >= 1 && x <= 2) || (x >= 5 && x <= 6) ? bone.lo : dark;
      return dark;
    }
    if (spine) return x === 3 ? bone.mid : bone.lo;
    return gap(6, f, x, y);
  });

  const limb = (name: string, k: number): void => {
    paintBox(t, getBox(kind, name), (f, x, y) => {
      if (f === 'top' || f === 'bottom') return bone.lo;
      if (y === 5) return bone.hi; // joint
      if (y === 6) return bone.lo;
      if (y === 11) return bone.lo;
      if (f === 'back' || (x === 1 && f !== 'front')) return r(k, f, x, y) < 0.5 ? bone.lo : bone.mid;
      return bonePx(k + 1, f, x, y);
    });
  };
  limb('rightArm', 10);
  limb('leftArm', 20);
  limb('rightLeg', 30);
  limb('leftLeg', 40);
  return t;
}

// ---------------------------------------------------------------------------------------------
// Pig
// ---------------------------------------------------------------------------------------------

function genPig(): Tex {
  const kind = 'pig';
  const t = texFor(kind);
  const pink = tones(hex('#efa09c'));
  const snoutC = tones(hex('#f6b7b1'));
  const nostril = hex('#9c4f58');
  const r = (k: number, f: Face, x: number, y: number): number => hash3(x + FACE_INDEX[f] * 23, y + k * 97, 4001);
  const skin = (k: number, f: Face, x: number, y: number): RGB => {
    const v = r(k, f, x, y);
    return v < 0.07 ? pink.hi : v > 0.94 ? pink.lo : pink.mid;
  };

  paintBox(t, getBox(kind, 'head'), (f, x, y, w) => {
    if (f === 'front') {
      if (y === 4) {
        if (x === 0) return WHITE;
        if (x === 1) return BLACK;
        if (x === 6) return BLACK;
        if (x === 7) return WHITE;
      }
      if (y === 3 && (x === 0 || x === 1 || x === 6 || x === 7)) return pink.lo; // brow shadow
      if (x >= 2 && x <= 5 && y >= 4 && y <= 6) return pink.lo; // behind the snout
      if (y === 7) return pink.lo;
      return skin(1, f, x, y);
    }
    if (f === 'right' || f === 'left') {
      const ff = fromFront(f, x, w);
      if (ff <= 1 && y <= 1) return pink.lo; // ear flap hint
      if (y === 7) return pink.lo;
    }
    if (f === 'bottom') return pink.lo;
    return skin(2, f, x, y);
  });

  paintBox(t, getBox(kind, 'snout'), (f, x, y) => {
    if (f === 'front') {
      if (y === 1 && (x === 0 || x === 3)) return nostril;
      if (y === 0) return snoutC.hi;
      if (y === 2) return snoutC.lo;
      return snoutC.mid;
    }
    if (f === 'top') return snoutC.hi;
    if (f === 'bottom') return snoutC.lo;
    return y === 2 ? snoutC.lo : snoutC.mid;
  });

  paintBox(t, getBox(kind, 'body'), (f, x, y, w, h) => {
    if (f === 'bottom') return r(3, f, x, y) < 0.3 ? pink.lo2 : pink.lo;
    if (f === 'top') {
        return skin(5, f, x, y);
    }
    if (y === h - 1) return pink.lo;
    if (y === 0) return pink.hi;
    // a few muddy speckles
    if (r(6, f, x, y) < 0.012) return pink.lo;
    if (f === 'back' && x >= 4 && x <= 5 && y >= 2 && y <= 3) return pink.lo; // tail nub
    return skin(7, f, x, y);
  });

  paintBox(t, getBox(kind, 'leg0'), (f, x, y) => {
    if (f === 'bottom') return hex('#8a5552');
    if (f === 'top') return pink.mid;
    if (y === 5) return mix(pink.lo2, hex('#8a5552'), 0.5); // trotter
    if (y === 4) return pink.lo;
    return skin(8, f, x, y);
  });
  return t;
}

// ---------------------------------------------------------------------------------------------
// Cow
// ---------------------------------------------------------------------------------------------

function genCow(): Tex {
  const kind = 'cow';
  const t = texFor(kind);
  const blk = tones(hex('#2e2520'));
  const wht = tones(hex('#e6e6e6'));
  const muzzle = tones(hex('#c4b0a2'));
  const r = (k: number, f: Face, x: number, y: number): number => hash3(x + FACE_INDEX[f] * 23, y + k * 97, 5001);
  const black = (k: number, f: Face, x: number, y: number): RGB => {
    const v = r(k, f, x, y);
    return v < 0.1 ? blk.hi : v > 0.92 ? blk.lo : blk.mid;
  };
  const white = (k: number, f: Face, x: number, y: number): RGB => {
    const v = r(k, f, x, y);
    return v < 0.12 ? wht.hi : v > 0.9 ? wht.lo : wht.mid;
  };
  const spotted = (k: number, f: Face, x: number, y: number, tx: number, ty: number, thr = 0.5): RGB => {
    const n = vnoise(tx, ty, 5, 5100) * 0.8 + vnoise(tx, ty, 2, 5200) * 0.2;
    return n > thr ? white(k, f, x, y) : black(k, f, x, y);
  };

  paintBox(t, getBox(kind, 'head'), (f, x, y, w, _h, tx, ty) => {
    if (f === 'front') {
      // eyes
      if (y === 3 && (x === 1 || x === 6)) return WHITE;
      if (y === 3 && (x === 2 || x === 5)) return BLACK;
      // white blaze down the forehead
      const blaze = (y >= 1 && y <= 4 && (x === 3 || x === 4)) || (y === 2 && (x === 2 || x === 5)) || (y === 0 && x === 4);
      if (blaze) return white(1, f, x, y);
      // muzzle
      if (y >= 5 && x >= 1 && x <= 6) {
        if (y === 6 && (x === 2 || x === 5)) return hex('#4e3e36');
        if (y === 5 && (x === 1 || x === 6)) return blk.mid;
        if (y === 5) return muzzle.hi;
        if (y === 7) return muzzle.lo;
        return muzzle.mid;
      }
      return black(2, f, x, y);
    }
    if (f === 'right' || f === 'left') {
      const ff = fromFront(f, x, w);
      if (y >= 5 && ff <= 1) return y === 7 ? muzzle.lo : muzzle.mid;
      if (y === 2 && ff === 2) return blk.lo2; // ear crease
      return spotted(3, f, x, y, tx, ty, 0.56);
    }
    if (f === 'bottom') return muzzle.lo;
    return spotted(4, f, x, y, tx, ty, 0.56);
  });

  paintBox(t, getBox(kind, 'horn0'), (f) => {
    if (f === 'top') return hex('#ece2c8');
    if (f === 'bottom') return hex('#a89c80');
    return f === 'right' || f === 'back' ? hex('#c2b699') : hex('#d8ceb2');
  });

  paintBox(t, getBox(kind, 'body'), (f, x, y, _w, _h, tx, ty) => {
    if (f === 'bottom') {
      // udder patch near the back of the belly
      return spotted(5, f, x, y, tx, ty, 0.45);
    }
    return spotted(6, f, x, y, tx, ty);
  });

  paintBox(t, getBox(kind, 'leg0'), (f, x, y, _w, _h, tx, ty) => {
    if (f === 'bottom') return hex('#3a322c');
    if (f === 'top') return black(7, f, x, y);
    if (y === 11) return hex('#4a403a');
    if (y === 10) return hex('#6a5e56');
    if (y >= 6) return white(8, f, x, y);
    return spotted(9, f, x, y, tx, ty, 0.52);
  });
  return t;
}

// ---------------------------------------------------------------------------------------------
// Sheep (sheared skin) + wool overlay
// ---------------------------------------------------------------------------------------------

function genSheep(): Tex {
  const kind = 'sheep';
  const t = texFor(kind);
  const skinT = tones(hex('#d6b9a8'));
  const faceT = tones(hex('#e2c8b3'));
  const r = (k: number, f: Face, x: number, y: number): number => hash3(x + FACE_INDEX[f] * 23, y + k * 97, 6001);
  const skin = (k: number, f: Face, x: number, y: number, tn: Tones = skinT): RGB => {
    const v = r(k, f, x, y);
    return v < 0.07 ? tn.hi : v > 0.94 ? tn.lo : tn.mid;
  };

  paintBox(t, getBox(kind, 'head'), (f, x, y, w) => {
    if (f === 'front') {
      if (y === 2) {
        if (x === 0) return WHITE;
        if (x === 1) return hex('#1a1a1a');
        if (x === 4) return hex('#1a1a1a');
        if (x === 5) return WHITE;
      }
      if (y === 1 && (x === 0 || x === 1 || x === 4 || x === 5)) return faceT.lo;
      if (y === 4 && (x === 2 || x === 3)) return hex('#e0928e'); // nose
      if (y === 5 && (x === 2 || x === 3)) return hex('#b8706c'); // mouth
      if (y === 5) return faceT.lo;
      return skin(1, f, x, y, faceT);
    }
    if (f === 'right' || f === 'left') {
      const ff = fromFront(f, x, w);
      if (ff <= 1) return skin(2, f, x, y, faceT);
      if (ff === 2 && y === 1) return skinT.lo2; // ear
    }
    if (f === 'bottom') return skinT.lo;
    return skin(3, f, x, y);
  });

  paintBox(t, getBox(kind, 'body'), (f, x, y, _w, h) => {
    if (f === 'bottom') return skinT.lo;
    if (f !== 'top' && y === h - 1) return skinT.lo;
    if (r(4, f, x, y) < 0.015) return skinT.lo; // shearing nicks
    return skin(5, f, x, y);
  });

  paintBox(t, getBox(kind, 'leg0'), (f, x, y) => {
    if (f === 'bottom') return hex('#5e4e46');
    if (f === 'top') return skinT.mid;
    if (y === 11) return hex('#6e5c52');
    if (y === 10) return skinT.lo2;
    return skin(6, f, x, y);
  });
  return t;
}

function genSheepFur(): Tex {
  const kind = 'sheep';
  const t = texFor(kind);
  const pal: RGB[] = [hex('#ffffff'), hex('#f1f1f1'), hex('#e3e3e3'), hex('#d2d2d2')];
  const woolPx: Painter = (f, x, y, w, h, tx, ty) => {
    // clumpy curls: a smooth field for the clumps plus a per-pixel dither, with shadowed undersides
    const n = vnoise(tx, ty, 2.2, 7001) * 0.65 + hash3(tx, ty, 7002) * 0.35;
    const under = vnoise(tx, ty + 1, 2.2, 7001) - vnoise(tx, ty, 2.2, 7001);
    let idx = n > 0.66 ? 0 : n > 0.4 ? 1 : n > 0.22 ? 2 : 3;
    if (under > 0.18) idx = Math.min(3, idx + 1);
    if (f === 'bottom') idx = Math.min(3, idx + 1);
    if (f !== 'top' && f !== 'bottom' && y === h - 1) idx = Math.min(3, idx + 1);
    void w;
    void x;
    return pal[idx];
  };
  for (const name of ['woolHead', 'woolBody', 'woolLeg0']) {
    paintBox(t, getBox(kind, name), woolPx);
  }
  return t;
}

// ---------------------------------------------------------------------------------------------
// Chicken
// ---------------------------------------------------------------------------------------------

function genChicken(): Tex {
  const kind = 'chicken';
  const t = texFor(kind);
  const wh = tones(hex('#f4f4f4'));
  const grey = hex('#d2d2d2');
  const r = (k: number, f: Face, x: number, y: number): number => hash3(x + FACE_INDEX[f] * 23, y + k * 97, 8001);
  const feather = (k: number, f: Face, x: number, y: number): RGB => {
    const v = r(k, f, x, y);
    return v < 0.25 ? WHITE : v > 0.9 ? grey : wh.mid;
  };
  const eyeC = hex('#141414');

  paintBox(t, getBox(kind, 'head'), (f, x, y, w) => {
    if (f === 'front') {
      if (y === 1 && (x === 0 || x === 3)) return eyeC;
      return feather(1, f, x, y);
    }
    if (f === 'right' || f === 'left') {
      const ff = fromFront(f, x, w);
      if (y === 1 && ff === 0) return eyeC;
      if (y === 1 && ff === 1) return hex('#9a9a9a');
    }
    if (f === 'bottom') return grey;
    return feather(2, f, x, y);
  });

  const beak = tones(hex('#f4ae2c'));
  paintBox(t, getBox(kind, 'beak'), (f, x, y) => {
    if (f === 'top') return beak.hi;
    if (f === 'bottom') return beak.lo;
    if (f === 'front') return y === 0 ? (x === 1 || x === 2 ? beak.hi : beak.mid) : beak.lo;
    return y === 0 ? beak.mid : beak.lo;
  });

  const red = tones(hex('#d42424'));
  paintBox(t, getBox(kind, 'wattle'), (f, x, y) => {
    if (f === 'top') return red.lo;
    if (f === 'bottom') return red.lo2;
    return y === 0 ? (x === 0 ? red.hi : red.mid) : red.lo;
  });

  paintBox(t, getBox(kind, 'body'), (f, x, y, w, h) => {
    if (f === 'bottom') return grey;
    if (f === 'back') {
      if (y <= 2 && x >= 1 && x <= w - 2) return y === 0 ? WHITE : feather(3, f, x, y); // tail
      if (y === h - 1) return grey;
    }
    if (f === 'right' || f === 'left' || f === 'front') {
      if (y === h - 1) return grey;
      if (r(4, f, x, y) < 0.08) return hex('#c4c4c4');
    }
    return feather(5, f, x, y);
  });

  paintBox(t, getBox(kind, 'wing0'), (f, x, y, w, h) => {
    if (f === 'top') return WHITE;
    if (f === 'bottom') return grey;
    if (f === 'right' || f === 'left') {
      const ff = fromFront(f, x, w);
      if (y === h - 1) return ff % 2 === 0 ? hex('#c8c8c8') : hex('#dedede'); // flight feathers
      if (y === h - 2 && ff >= 3 && ff % 2 === 1) return hex('#dcdcdc');
      if (y === 0) return WHITE;
      return feather(6, f, x, y);
    }
    return y === h - 1 ? grey : wh.mid;
  });

  const legC = tones(hex('#e89a2e'));
  paintBox(t, getBox(kind, 'leg0'), (f, _x, y) => {
    if (f === 'bottom') return legC.lo;
    if (f === 'top') return legC.mid;
    if (y === 4) return legC.lo;
    return f === 'front' ? legC.hi : legC.mid;
  });
  return t;
}

// ---------------------------------------------------------------------------------------------
// Creeper
// ---------------------------------------------------------------------------------------------

function genCreeper(): Tex {
  const kind = 'creeper';
  const t = texFor(kind);
  const pal: RGB[] = [
    hex('#b9dcae'), // pale speck
    hex('#83cf70'),
    hex('#58ba48'),
    hex('#3c9f30'),
    hex('#2c8224'),
    hex('#1f621b'),
  ];
  const cum = [0.035, 0.16, 0.42, 0.72, 0.9, 1];
  const mottle = (tx: number, ty: number, bias = 0): RGB => {
    let v = vnoise(tx, ty, 2, 9001) * 0.55 + hash3(tx, ty, 9002) * 0.45;
    // spread to use the whole palette
    v = Math.min(0.999, Math.max(0, (v - 0.2) * 1.6 + bias));
    // rare pale specks are purely per-pixel so they stay single pixels
    if (hash3(tx, ty, 9003) < 0.03) return pal[0];
    return pick(v, pal.slice(1), cum.slice(1).map((c) => (c - cum[0]) / (1 - cum[0])));
  };
  const face = ['........', '........', '.XX..XX.', '.XX..XX.', '...XX...', '..XXXX..', '..XXXX..', '..X..X..'];
  const faceDark = hex('#0c0c0c');
  const faceMid = hex('#242424');

  paintBox(t, getBox(kind, 'head'), (f, x, y, _w, _h, tx, ty) => {
    if (f === 'front' && face[y][x] === 'X') {
      // slight inner shading keeps the face readable while staying almost black
      const edgeTop = y === 0 || face[y - 1][x] !== 'X';
      return edgeTop && hash3(tx, ty, 9004) < 0.6 ? faceMid : faceDark;
    }
    return mottle(tx, ty);
  });
  paintBox(t, getBox(kind, 'body'), (_f, _x, _y, _w, _h, tx, ty) => mottle(tx, ty));
  paintBox(t, getBox(kind, 'leg0'), (f, _x, y, _w, _h, tx, ty) => {
    if (f === 'bottom') return pal[5];
    if (f === 'top') return mottle(tx, ty);
    return mottle(tx, ty, y >= 4 ? 0.22 : 0);
  });
  return t;
}

// ---------------------------------------------------------------------------------------------
// Spider
// ---------------------------------------------------------------------------------------------

function genSpider(): Tex {
  const kind = 'spider';
  const t = texFor(kind);
  const pal: RGB[] = [hex('#4d4239'), hex('#3a3029'), hex('#2d2520'), hex('#221c18'), hex('#17130f')];
  const cum = [0.07, 0.3, 0.7, 0.92, 1];
  const r = (tx: number, ty: number, k: number): number => hash3(tx, ty, 10001 + k);
  const fur = (tx: number, ty: number, bias = 0): RGB => {
    const v = Math.min(0.999, Math.max(0, r(tx, ty, 0) * 0.7 + vnoise(tx, ty, 2, 10002) * 0.3 + bias - 0.05));
    return pick(v, pal, cum);
  };
  const redHi = hex('#ff3a2a');
  const red = hex('#c81414');
  const redLo = hex('#7c0a0a');
  const fang = hex('#6a5a4a');
  const eyes = ['........', '........', 'd..dd..d', '.RR..RR.', '.RR..RR.', '........', '..f..f..', '..f..f..'];

  paintBox(t, getBox(kind, 'head'), (f, x, y, _w, _h, tx, ty) => {
    if (f === 'front') {
      const ch = eyes[y][x];
      if (ch === 'R') return y === 3 && (x === 1 || x === 5) ? redHi : y === 4 && (x === 2 || x === 6) ? mix(red, redLo, 0.5) : red;
      if (ch === 'd') return mix(red, redLo, 0.5);
      if (ch === 'f') return y === 7 ? mul(fang, 0.7) : fang;
    }
    return fur(tx, ty, f === 'bottom' ? 0.15 : 0);
  });
  paintBox(t, getBox(kind, 'neck'), (f, _x, _y, _w, _h, tx, ty) => fur(tx, ty, f === 'bottom' ? 0.15 : -0.06));
  paintBox(t, getBox(kind, 'abdomen'), (f, x, y, w, _h, tx, ty) => {
    if (f === 'top') {
      // faint darker chevron markings down the back
      const cx = Math.abs(x - (w - 1) / 2);
      if (Math.abs(cx - (y % 4) * 0.9) < 0.6 && y > 1 && y < 11) return pal[4];
      if (cx < 0.6) return pal[3];
    }
    return fur(tx, ty, f === 'bottom' ? 0.12 : 0);
  });
  paintBox(t, getBox(kind, 'legR0'), (f, x, _y, w, _h, tx, ty) => {
    if (f === 'right' || f === 'left') return pal[2];
    const joint = x === 5 || x === 10;
    if (joint) return pal[0];
    if (x === 0 || x === w - 1) return pal[4];
    return fur(tx, ty, 0.05);
  });
  return t;
}

// ---------------------------------------------------------------------------------------------
// Fallback + entry point
// ---------------------------------------------------------------------------------------------

function genMissing(): Tex {
  const t = new Tex(64, 64);
  const mag: RGB = [255, 0, 255];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) t.set(x, y, ((x >> 3) + (y >> 3)) & 1 ? BLACK : mag);
  return t;
}

/**
 * Generate an entity texture. `variant` only affects `player` (0..7, wraps).
 * Unknown kinds return a 64x64 magenta/black checker.
 */
export function generateEntityTexture(kind: string, variant = 0): EntityTexture {
  try {
    switch (kind) {
      case 'player': {
        const n = PLAYER_VARIANTS.length;
        const v = (((Math.floor(variant) || 0) % n) + n) % n;
        return genHuman('player', PLAYER_VARIANTS[v]).toEntityTexture();
      }
      case 'zombie':
        return genHuman('zombie', ZOMBIE_SPEC).toEntityTexture();
      case 'skeleton':
        return genSkeleton().toEntityTexture();
      case 'pig':
        return genPig().toEntityTexture();
      case 'cow':
        return genCow().toEntityTexture();
      case 'sheep':
        return genSheep().toEntityTexture();
      case 'sheep_fur':
        return genSheepFur().toEntityTexture();
      case 'chicken':
        return genChicken().toEntityTexture();
      case 'creeper':
        return genCreeper().toEntityTexture();
      case 'spider':
        return genSpider().toEntityTexture();
      default:
        return genMissing().toEntityTexture();
    }
  } catch {
    return genMissing().toEntityTexture();
  }
}

/** Number of distinct player skins available through `generateEntityTexture('player', variant)`. */
export const PLAYER_SKIN_VARIANTS = PLAYER_VARIANTS.length;
