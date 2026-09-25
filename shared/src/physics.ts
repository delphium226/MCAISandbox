import { BLOCKS, fluidHeight, blockOf } from './blocks';
import { World } from './world';

/** Axis-aligned box as [minX,minY,minZ,maxX,maxY,maxZ]. */
export type AABB = [number, number, number, number, number, number];

const SOLID = new Uint8Array(256);
for (const b of BLOCKS) SOLID[b.id] = b.solid ? 1 : 0;

/** Collision boxes of a block state (in block-local coords), empty if passable. */
export function blockBoxes(state: number): AABB[] {
  const id = state & 0xff;
  if (!SOLID[id]) return [];
  const def = BLOCKS[id];
  switch (def.shape) {
    case 'slab': {
      const top = (state >> 8) & 1;
      return [top ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1]];
    }
    case 'farmland':
      return [[0, 0, 0, 1, 15 / 16, 1]];
    case 'cactus':
      return [[1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16]];
    default:
      return [[0, 0, 0, 1, 1, 1]];
  }
}

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  width: number;
  height: number;
  onGround: boolean;
  inWater: boolean;
  inLava: boolean;
  /** Head underwater */
  eyesInWater: boolean;
  onLadder: boolean;
  horizontalCollision: boolean;
  fallDistance: number;
  stepHeight: number;
}

export function makeBody(x: number, y: number, z: number, width = 0.6, height = 1.8): Body {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0, width, height,
    onGround: false, inWater: false, inLava: false, eyesInWater: false, onLadder: false,
    horizontalCollision: false, fallDistance: 0, stepHeight: 0.6,
  };
}

function collectBoxes(world: World, box: AABB, out: AABB[]) {
  out.length = 0;
  const x0 = Math.floor(box[0]) , x1 = Math.floor(box[3]);
  const y0 = Math.floor(box[1]) - 1, y1 = Math.floor(box[4]);
  const z0 = Math.floor(box[2]), z1 = Math.floor(box[5]);
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const loaded = world.isLoaded(x, z);
      for (let y = y0; y <= y1; y++) {
        if (!loaded) {
          // Unloaded chunks act as solid walls so nothing falls out of the world.
          out.push([x, y, z, x + 1, y + 1, z + 1]);
          continue;
        }
        const s = world.getBlock(x, y, z);
        if (!SOLID[s & 0xff]) continue;
        for (const b of blockBoxes(s)) out.push([b[0] + x, b[1] + y, b[2] + z, b[3] + x, b[4] + y, b[5] + z]);
      }
    }
}

const tmpBoxes: AABB[] = [];

function clipAxis(boxes: AABB[], box: AABB, axis: 0 | 1 | 2, d: number): number {
  const a = axis, b = (axis + 1) % 3, c = (axis + 2) % 3;
  for (const o of boxes) {
    if (o[b + 3] <= box[b] || o[b] >= box[b + 3] || o[c + 3] <= box[c] || o[c] >= box[c + 3]) continue;
    if (d > 0 && o[a] >= box[a + 3] - 1e-7) d = Math.min(d, o[a] - box[a + 3]);
    else if (d < 0 && o[a + 3] <= box[a] + 1e-7) d = Math.max(d, o[a + 3] - box[a]);
  }
  return d;
}

/**
 * Move a body through the world resolving collisions per-axis (Minecraft style, with step-up).
 * Returns the actual displacement.
 */
export function moveBody(world: World, body: Body, dx: number, dy: number, dz: number, sneakEdge = false) {
  const hw = body.width / 2;
  const box: AABB = [body.x - hw, body.y, body.z - hw, body.x + hw, body.y + body.height, body.z + hw];
  const expanded: AABB = [
    Math.min(box[0], box[0] + dx), Math.min(box[1], box[1] + dy), Math.min(box[2], box[2] + dz),
    Math.max(box[3], box[3] + dx), Math.max(box[4], box[4] + dy), Math.max(box[5], box[5] + dz),
  ];
  expanded[4] += body.stepHeight;
  collectBoxes(world, expanded, tmpBoxes);

  // Sneaking prevents walking off edges
  if (sneakEdge && body.onGround) {
    const step = 0.05;
    const hasFloor = (ox: number, oz: number) => {
      const test: AABB = [box[0] + ox, box[1] - 1, box[2] + oz, box[3] + ox, box[1], box[5] + oz];
      for (const o of tmpBoxes)
        if (o[0] < test[3] && o[3] > test[0] && o[1] < test[4] - 0.4 && o[4] > test[1] && o[2] < test[5] && o[5] > test[2]) return true;
      return false;
    };
    while (dx !== 0 && !hasFloor(dx, 0)) dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
    while (dz !== 0 && !hasFloor(0, dz)) dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
    while (dx !== 0 && dz !== 0 && !hasFloor(dx, dz)) {
      dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
      dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
    }
  }

  const odx = dx, ody = dy, odz = dz;
  const b = box.slice() as AABB;
  dy = clipAxis(tmpBoxes, b, 1, dy);
  b[1] += dy; b[4] += dy;
  dx = clipAxis(tmpBoxes, b, 0, dx);
  b[0] += dx; b[3] += dx;
  dz = clipAxis(tmpBoxes, b, 2, dz);
  b[2] += dz; b[5] += dz;

  const onGroundNow = ody < 0 && dy !== ody;
  // Step up small ledges
  if (body.stepHeight > 0 && (onGroundNow || body.onGround) && (dx !== odx || dz !== odz)) {
    const s = box.slice() as AABB;
    let sy = clipAxis(tmpBoxes, s, 1, body.stepHeight);
    s[1] += sy; s[4] += sy;
    const sx = clipAxis(tmpBoxes, s, 0, odx);
    s[0] += sx; s[3] += sx;
    const sz = clipAxis(tmpBoxes, s, 2, odz);
    s[2] += sz; s[5] += sz;
    const down = clipAxis(tmpBoxes, s, 1, -sy + (ody < 0 ? ody : 0));
    s[1] += down; s[4] += down;
    sy += down;
    if (sx * sx + sz * sz > dx * dx + dz * dz + 1e-6) {
      dx = sx; dz = sz; dy = sy;
      b.splice(0, 6, ...s);
    }
  }

  body.x = (b[0] + b[3]) / 2;
  body.y = b[1];
  body.z = (b[2] + b[5]) / 2;
  body.horizontalCollision = dx !== odx || dz !== odz;
  body.onGround = ody < 0 && Math.abs(dy - ody) > 1e-9 && dy > ody;
  if (dx !== odx) body.vx = 0;
  if (dz !== odz) body.vz = 0;
  if (dy !== ody) body.vy = 0;
  return { dx, dy, dz };
}

/** Update fluid / ladder flags for a body. */
export function updateEnvironment(world: World, body: Body, eyeHeight: number) {
  const hw = body.width / 2 - 0.001;
  body.inWater = false;
  body.inLava = false;
  body.onLadder = false;
  const x0 = Math.floor(body.x - hw), x1 = Math.floor(body.x + hw);
  const z0 = Math.floor(body.z - hw), z1 = Math.floor(body.z + hw);
  const y0 = Math.floor(body.y + 0.001), y1 = Math.floor(body.y + body.height * 0.9);
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++) {
        const s = world.getBlock(x, y, z);
        const def = blockOf(s);
        if (def.fluid) {
          const surf = y + fluidHeight(s >> 8);
          if (body.y + 0.4 < surf || y > y0) {
            if (def.name === 'water') body.inWater = true;
            else body.inLava = true;
          }
        }
        if (def.climbable) body.onLadder = true;
      }
  const ey = body.y + eyeHeight;
  const es = world.getBlock(Math.floor(body.x), Math.floor(ey), Math.floor(body.z));
  const ed = blockOf(es);
  body.eyesInWater = ed.name === 'water' && ey < Math.floor(ey) + fluidHeight(es >> 8) + 0.1;
}

export interface MoveInput {
  forward: number; // -1..1
  strafe: number; // -1..1 (positive = right)
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
  yaw: number; // radians, 0 = looking towards -Z
  flying: boolean;
}

/**
 * One 20Hz physics tick of a player-like entity (Minecraft movement constants).
 */
export function stepPlayer(world: World, body: Body, input: MoveInput, eyeHeight: number) {
  updateEnvironment(world, body, eyeHeight);
  const sin = Math.sin(input.yaw), cos = Math.cos(input.yaw);
  let f = input.forward, s = input.strafe;
  const len = Math.hypot(f, s);
  if (len > 1) { f /= len; s /= len; }
  // world-space wish direction (yaw 0 faces -Z)
  const wx = -sin * f + cos * s;
  const wz = -cos * f - sin * s;

  if (input.flying) {
    const speed = input.sprint ? 0.1 : 0.05;
    body.vx += wx * speed;
    body.vz += wz * speed;
    body.vy += (input.jump ? 0.15 : 0) - (input.sneak ? 0.15 : 0);
    const prevStep = body.stepHeight;
    body.stepHeight = 0;
    moveBody(world, body, body.vx, body.vy, body.vz);
    body.stepHeight = prevStep;
    body.vx *= 0.91 * 0.6 + 0.3;
    body.vz *= 0.91 * 0.6 + 0.3;
    body.vy *= 0.6;
    body.fallDistance = 0;
    return;
  }

  if (body.inWater || body.inLava) {
    const speed = body.inWater ? 0.02 * (input.sprint ? 1.8 : 1) : 0.02;
    body.vx += wx * speed;
    body.vz += wz * speed;
    if (input.jump) body.vy += 0.04;
    else if (input.sneak) body.vy -= 0.04;
    const startY = body.y;
    moveBody(world, body, body.vx, body.vy, body.vz);
    const drag = body.inWater ? 0.8 : 0.5;
    body.vx *= drag;
    body.vz *= drag;
    body.vy = body.vy * drag - 0.02;
    // climb out of water onto ledges
    if (body.horizontalCollision && input.jump) {
      body.vy = 0.3;
    }
    void startY;
    body.fallDistance = 0;
    return;
  }

  const slip = body.onGround ? 0.6 * 0.91 : 0.91;
  let accel: number;
  if (body.onGround) {
    const base = 0.1 * (input.sprint && f > 0 ? 1.3 : 1) * (input.sneak ? 0.3 : 1);
    accel = base * (0.16277136 / (slip * slip * slip));
  } else {
    accel = 0.02 * (input.sprint && f > 0 ? 1.3 : 1);
  }
  body.vx += wx * accel;
  body.vz += wz * accel;

  if (input.jump && body.onGround) {
    body.vy = 0.42;
    if (input.sprint && f > 0) {
      body.vx += -sin * 0.2;
      body.vz += -cos * 0.2;
    }
  }
  if (body.onLadder) {
    body.vx = Math.max(-0.15, Math.min(0.15, body.vx));
    body.vz = Math.max(-0.15, Math.min(0.15, body.vz));
    if (body.vy < -0.15) body.vy = -0.15;
    if (input.sneak && body.vy < 0) body.vy = 0;
    if (body.horizontalCollision || input.jump) body.vy = 0.2;
    body.fallDistance = 0;
  }

  const prevY = body.y;
  moveBody(world, body, body.vx, body.vy, body.vz, input.sneak);
  if (!body.onGround && body.y < prevY) body.fallDistance += prevY - body.y;

  body.vy -= 0.08;
  body.vy *= 0.98;
  body.vx *= slip;
  body.vz *= slip;
}

/** Simple physics for non-player entities (items, mobs). */
export function stepEntity(world: World, body: Body, gravity = 0.08, drag = 0.98, groundFriction = 0.6) {
  updateEnvironment(world, body, body.height * 0.85);
  const prevY = body.y;
  if (body.inWater) {
    body.vy += 0.01;
    body.vx *= 0.8; body.vz *= 0.8; body.vy *= 0.8;
  }
  moveBody(world, body, body.vx, body.vy, body.vz);
  if (!body.onGround && body.y < prevY) body.fallDistance += prevY - body.y;
  body.vy -= body.inWater ? gravity * 0.25 : gravity;
  body.vy *= drag;
  const f = body.onGround ? groundFriction * 0.91 : 0.91;
  body.vx *= f;
  body.vz *= f;
}

// ---- Ray casting ----------------------------------------------------------------------------

export interface RayHit {
  x: number;
  y: number;
  z: number;
  face: number; // face index hit (normal direction)
  dist: number;
  state: number;
}

/** Selection box of a block for picking (plants have smaller boxes). */
export function selectionBox(state: number): AABB | null {
  const id = state & 0xff;
  const def = BLOCKS[id];
  switch (def.shape) {
    case 'none':
    case 'fluid':
      return null;
    case 'cross':
      return [0.1, 0, 0.1, 0.9, 0.8, 0.9];
    case 'crop':
      return [0, 0, 0, 1, 0.25 + ((state >> 8) & 7) / 10, 1];
    case 'torch':
      return [0.35, 0, 0.35, 0.65, 0.65, 0.65];
    case 'slab':
      return (state >> 8) & 1 ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
    case 'farmland':
      return [0, 0, 0, 1, 15 / 16, 1];
    case 'cactus':
      return [1 / 16, 0, 1 / 16, 15 / 16, 1, 15 / 16];
    case 'snow_layer':
      return [0, 0, 0, 1, 0.125, 1];
    case 'ladder': {
      const f = (state >> 8) & 7;
      const t = 3 / 16;
      if (f === 0) return [0, 0, 0, t, 1, 1];
      if (f === 1) return [1 - t, 0, 0, 1, 1, 1];
      if (f === 4) return [0, 0, 0, 1, 1, t];
      return [0, 0, 1 - t, 1, 1, 1];
    }
    default:
      return [0, 0, 0, 1, 1, 1];
  }
}

function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: AABB): [number, number] | null {
  let tmin = -Infinity, tmax = Infinity, face = -1;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < b[a] || o[a] > b[a + 3]) return null;
      continue;
    }
    let t1 = (b[a] - o[a]) / d[a];
    let t2 = (b[a + 3] - o[a]) / d[a];
    let f1 = a * 2 + 1; // hitting min side => normal negative
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; f1 = a * 2; }
    if (t1 > tmin) { tmin = t1; face = f1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  // face index mapping: axis0 -> 0/1, axis1 -> 2/3, axis2 -> 4/5 ; f1 computed as normal of the entered side
  return [Math.max(tmin, 0), face];
}

/**
 * Voxel DDA ray cast. `origin` in world space, dir normalised. Ignores fluids unless includeFluids.
 */
export function raycast(world: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, includeFluids = false): RayHit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
  let tmx = dx > 0 ? (x + 1 - ox) * tdx : (ox - x) * tdx;
  let tmy = dy > 0 ? (y + 1 - oy) * tdy : (oy - y) * tdy;
  let tmz = dz > 0 ? (z + 1 - oz) * tdz : (oz - z) * tdz;
  if (!isFinite(tmx)) tmx = Infinity;
  if (!isFinite(tmy)) tmy = Infinity;
  if (!isFinite(tmz)) tmz = Infinity;
  let t = 0;
  for (let i = 0; i < 256 && t <= maxDist; i++) {
    const s = world.getBlock(x, y, z);
    if ((s & 0xff) !== 0) {
      const def = BLOCKS[s & 0xff];
      let box = selectionBox(s);
      if (!box && includeFluids && def.fluid) box = [0, 0, 0, 1, fluidHeight(s >> 8), 1];
      if (box) {
        const hit = rayBox(ox - x, oy - y, oz - z, dx, dy, dz, box);
        if (hit && hit[0] <= maxDist) {
          // rayBox returns face as: axis*2 + (0 if entering max side i.e. normal +, 1 if normal -)
          return { x, y, z, face: hit[1], dist: hit[0], state: s };
        }
      }
    }
    if (tmx < tmy && tmx < tmz) { x += stepX; t = tmx; tmx += tdx; }
    else if (tmy < tmz) { y += stepY; t = tmy; tmy += tdy; }
    else { z += stepZ; t = tmz; tmz += tdz; }
  }
  return null;
}

/** Ray vs entity AABB (world space). Returns distance or -1. */
export function rayAABB(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, box: AABB): number {
  const r = rayBox(ox, oy, oz, dx, dy, dz, box);
  return r ? r[0] : -1;
}
