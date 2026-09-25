/**
 * Entity model definitions (Minecraft-style box models). Units are pixels (1/16 block).
 * Origin is at the entity's feet centre; +Y is up; the model FACES -Z (its front/face is the -Z side).
 *
 * Box UV layout (Minecraft convention) for a box of size (w,h,d) at texture offset (u,v):
 *   top    (+Y): x=u+d,       y=v,   size w x d
 *   bottom (-Y): x=u+d+w,     y=v,   size w x d
 *   right  (+X): x=u,         y=v+d, size d x h   (the entity's right side; it faces -Z)
 *   front  (-Z): x=u+d,       y=v+d, size w x h   (face / chest / snout side)
 *   left   (-X): x=u+d+w,     y=v+d, size d x h
 *   back   (+Z): x=u+d+w+d,   y=v+d, size w x h
 * Total region: (2d + 2w) wide, (d + h) tall. Texture rows go top→bottom (row 0 = top of the image),
 * and within each side face row 0 is the TOP of that face.
 */

export interface BoxDef {
  name: string;
  /** Min corner in pixels (model space) */
  from: [number, number, number];
  size: [number, number, number]; // w, h, d
  uv: [number, number];
  /** Rotation pivot in pixels (model space) */
  pivot: [number, number, number];
  /** Inflate amount (overlay layers) */
  inflate?: number;
  /** Mirror UVs horizontally (Minecraft 'mirror' flag) */
  mirror?: boolean;
  /** Static rotation in radians [x, y, z] */
  rot?: [number, number, number];
  /** Optional: which texture this part uses (default 'main'). */
  layer?: 'main' | 'overlay';
}

export interface ModelDef {
  texSize: [number, number];
  boxes: BoxDef[];
  /** Uniform scale applied to the model */
  scale?: number;
}

const humanoid = (thinLimbs = false): BoxDef[] => {
  const lw = thinLimbs ? 2 : 4;
  return [
    { name: 'head', from: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0], pivot: [0, 24, 0] },
    { name: 'hat', from: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], pivot: [0, 24, 0], inflate: 0.5 },
    { name: 'body', from: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16], pivot: [0, 24, 0] },
    { name: 'rightArm', from: [4, 12, -lw / 2], size: [lw, 12, lw], uv: [40, 16], pivot: [5, 22, 0] },
    { name: 'leftArm', from: [-4 - lw, 12, -lw / 2], size: [lw, 12, lw], uv: [32, 48], pivot: [-5, 22, 0] },
    { name: 'rightLeg', from: [4 - lw - (thinLimbs ? 1 : 0), 0, -lw / 2], size: [lw, 12, lw], uv: [0, 16], pivot: [2, 12, 0] },
    { name: 'leftLeg', from: [-4 + (thinLimbs ? 1 : 0), 0, -lw / 2], size: [lw, 12, lw], uv: [16, 48], pivot: [-2, 12, 0] },
  ];
};

export const MODELS: Record<string, ModelDef> = {
  player: { texSize: [64, 64], boxes: humanoid() },
  zombie: { texSize: [64, 64], boxes: humanoid() },
  skeleton: { texSize: [64, 64], boxes: humanoid(true) },
  pig: {
    texSize: [64, 64],
    boxes: [
      { name: 'head', from: [-4, 8, -14], size: [8, 8, 8], uv: [0, 0], pivot: [0, 12, -6] },
      { name: 'snout', from: [-2, 9, -15], size: [4, 3, 1], uv: [32, 0], pivot: [0, 12, -6] },
      { name: 'body', from: [-5, 6, -8], size: [10, 8, 16], uv: [0, 16], pivot: [0, 10, 0] },
      { name: 'leg0', from: [1, 0, -7], size: [4, 6, 4], uv: [0, 40], pivot: [3, 6, -5] },
      { name: 'leg1', from: [-5, 0, -7], size: [4, 6, 4], uv: [0, 40], pivot: [-3, 6, -5] },
      { name: 'leg2', from: [1, 0, 3], size: [4, 6, 4], uv: [0, 40], pivot: [3, 6, 5] },
      { name: 'leg3', from: [-5, 0, 3], size: [4, 6, 4], uv: [0, 40], pivot: [-3, 6, 5] },
    ],
  },
  cow: {
    texSize: [64, 64],
    boxes: [
      { name: 'head', from: [-4, 16, -14], size: [8, 8, 6], uv: [0, 0], pivot: [0, 20, -8] },
      { name: 'horn0', from: [4, 22, -12], size: [1, 3, 1], uv: [28, 0], pivot: [0, 20, -8] },
      { name: 'horn1', from: [-5, 22, -12], size: [1, 3, 1], uv: [28, 0], pivot: [0, 20, -8] },
      { name: 'body', from: [-6, 12, -9], size: [12, 10, 18], uv: [0, 14], pivot: [0, 17, 0] },
      { name: 'leg0', from: [2, 0, -8], size: [4, 12, 4], uv: [0, 42], pivot: [4, 12, -6] },
      { name: 'leg1', from: [-6, 0, -8], size: [4, 12, 4], uv: [0, 42], pivot: [-4, 12, -6] },
      { name: 'leg2', from: [2, 0, 4], size: [4, 12, 4], uv: [0, 42], pivot: [4, 12, 6] },
      { name: 'leg3', from: [-6, 0, 4], size: [4, 12, 4], uv: [0, 42], pivot: [-4, 12, 6] },
    ],
  },
  sheep: {
    texSize: [64, 64],
    boxes: [
      { name: 'head', from: [-3, 16, -14], size: [6, 6, 8], uv: [0, 0], pivot: [0, 19, -6] },
      { name: 'body', from: [-4, 12, -8], size: [8, 6, 16], uv: [0, 14], pivot: [0, 15, 0] },
      { name: 'leg0', from: [1, 0, -7], size: [4, 12, 4], uv: [48, 14], pivot: [3, 12, -5] },
      { name: 'leg1', from: [-5, 0, -7], size: [4, 12, 4], uv: [48, 14], pivot: [-3, 12, -5] },
      { name: 'leg2', from: [1, 0, 3], size: [4, 12, 4], uv: [48, 14], pivot: [3, 12, 5] },
      { name: 'leg3', from: [-5, 0, 3], size: [4, 12, 4], uv: [48, 14], pivot: [-3, 12, 5] },
      // Wool layer (texture 'sheep_fur', same layout, tinted by wool colour)
      { name: 'woolHead', from: [-3, 16, -13], size: [6, 6, 6], uv: [0, 36], pivot: [0, 19, -6], inflate: 0.6, layer: 'overlay' },
      { name: 'woolBody', from: [-4, 12, -8], size: [8, 6, 16], uv: [0, 14], pivot: [0, 15, 0], inflate: 1.75, layer: 'overlay' },
      { name: 'woolLeg0', from: [1, 6, -7], size: [4, 6, 4], uv: [48, 14], pivot: [3, 12, -5], inflate: 0.5, layer: 'overlay' },
      { name: 'woolLeg1', from: [-5, 6, -7], size: [4, 6, 4], uv: [48, 14], pivot: [-3, 12, -5], inflate: 0.5, layer: 'overlay' },
      { name: 'woolLeg2', from: [1, 6, 3], size: [4, 6, 4], uv: [48, 14], pivot: [3, 12, 5], inflate: 0.5, layer: 'overlay' },
      { name: 'woolLeg3', from: [-5, 6, 3], size: [4, 6, 4], uv: [48, 14], pivot: [-3, 12, 5], inflate: 0.5, layer: 'overlay' },
    ],
  },
  chicken: {
    texSize: [64, 64],
    boxes: [
      { name: 'head', from: [-2, 9, -6], size: [4, 6, 3], uv: [0, 0], pivot: [0, 9, -4] },
      { name: 'beak', from: [-2, 11, -8], size: [4, 2, 2], uv: [14, 0], pivot: [0, 9, -4] },
      { name: 'wattle', from: [-1, 9, -7], size: [2, 2, 2], uv: [14, 4], pivot: [0, 9, -4] },
      { name: 'body', from: [-3, 5, -4], size: [6, 6, 8], uv: [0, 9], pivot: [0, 8, 0] },
      { name: 'wing0', from: [3, 7, -3], size: [1, 4, 6], uv: [28, 9], pivot: [3, 11, 0] },
      { name: 'wing1', from: [-4, 7, -3], size: [1, 4, 6], uv: [28, 9], pivot: [-3, 11, 0], mirror: true },
      { name: 'leg0', from: [1, 0, 0], size: [1, 5, 1], uv: [0, 23], pivot: [1.5, 5, 0.5] },
      { name: 'leg1', from: [-2, 0, 0], size: [1, 5, 1], uv: [0, 23], pivot: [-1.5, 5, 0.5] },
    ],
  },
  creeper: {
    texSize: [64, 64],
    boxes: [
      { name: 'head', from: [-4, 18, -4], size: [8, 8, 8], uv: [0, 0], pivot: [0, 18, 0] },
      { name: 'body', from: [-4, 6, -2], size: [8, 12, 4], uv: [16, 16], pivot: [0, 12, 0] },
      { name: 'leg0', from: [0, 0, -6], size: [4, 6, 4], uv: [0, 16], pivot: [2, 6, -4] },
      { name: 'leg1', from: [-4, 0, -6], size: [4, 6, 4], uv: [0, 16], pivot: [-2, 6, -4] },
      { name: 'leg2', from: [0, 0, 2], size: [4, 6, 4], uv: [0, 16], pivot: [2, 6, 4] },
      { name: 'leg3', from: [-4, 0, 2], size: [4, 6, 4], uv: [0, 16], pivot: [-2, 6, 4] },
    ],
  },
  spider: {
    texSize: [64, 64],
    boxes: [
      { name: 'head', from: [-4, 5, -11], size: [8, 8, 8], uv: [0, 0], pivot: [0, 9, -3] },
      { name: 'neck', from: [-3, 6, -3], size: [6, 6, 6], uv: [32, 0], pivot: [0, 9, 0] },
      { name: 'abdomen', from: [-5, 5, 3], size: [10, 8, 12], uv: [0, 16], pivot: [0, 9, 3] },
      // 8 legs: long thin boxes extending along +X (right side) or -X (left side), rotated at runtime
      ...[0, 1, 2, 3].flatMap((i) => [
        { name: `legR${i}`, from: [3, 8, -1.5 + (i - 1.5) * 2.2] as [number, number, number], size: [16, 2, 2] as [number, number, number], uv: [0, 36] as [number, number], pivot: [3, 9, (i - 1.5) * 2.2] as [number, number, number] },
        { name: `legL${i}`, from: [-19, 8, -1.5 + (i - 1.5) * 2.2] as [number, number, number], size: [16, 2, 2] as [number, number, number], uv: [0, 36] as [number, number], pivot: [-3, 9, (i - 1.5) * 2.2] as [number, number, number], mirror: true },
      ]),
    ],
  },
};

/** Pixel rectangles of each face of a box in its texture: [x, y, w, h]. */
export function boxFaceRects(b: Pick<BoxDef, 'size' | 'uv'>) {
  const [w, h, d] = b.size;
  const [u, v] = b.uv;
  return {
    top: [u + d, v, w, d],
    bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h],
    front: [u + d, v + d, w, h],
    left: [u + d + w, v + d, d, h],
    back: [u + d + w + d, v + d, w, h],
  } as Record<'top' | 'bottom' | 'right' | 'front' | 'left' | 'back', [number, number, number, number]>;
}
