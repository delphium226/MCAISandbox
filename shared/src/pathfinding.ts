import { BLOCKS } from './blocks';
import { World } from './world';

/**
 * A* pathfinding over standable voxel positions (feet coordinates).
 * A node is walkable if feet+head blocks are passable and the block below is solid (or it is water).
 */

export interface PathNode {
  x: number;
  y: number;
  z: number;
}

const passable = (w: World, x: number, y: number, z: number) => {
  const s = w.getBlock(x, y, z);
  const d = BLOCKS[s & 0xff];
  return !d.solid && d.name !== 'lava' && d.name !== 'cactus';
};
const isWater = (w: World, x: number, y: number, z: number) => BLOCKS[w.getBlock(x, y, z) & 0xff].name === 'water';
const solidBelow = (w: World, x: number, y: number, z: number) => {
  const d = BLOCKS[w.getBlock(x, y - 1, z) & 0xff];
  return d.solid && d.name !== 'cactus';
};
const dangerousBelow = (w: World, x: number, y: number, z: number) => {
  const n = BLOCKS[w.getBlock(x, y - 1, z) & 0xff].name;
  return n === 'lava' || n === 'cactus' || n === 'magma';
};

export function standable(w: World, x: number, y: number, z: number): boolean {
  if (!w.isLoaded(x, z)) return false;
  if (!passable(w, x, y, z) || !passable(w, x, y + 1, z)) return false;
  if (isWater(w, x, y, z)) return true;
  return solidBelow(w, x, y, z) && !dangerousBelow(w, x, y, z);
}

interface OpenNode {
  x: number;
  y: number;
  z: number;
  g: number;
  f: number;
  parent: OpenNode | null;
}

class Heap {
  items: OpenNode[] = [];
  push(n: OpenNode) {
    const a = this.items;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): OpenNode | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Find a path from start to within `range` blocks of goal. Returns list of feet positions or null.
 */
export function findPath(w: World, start: PathNode, goal: PathNode, range = 1, maxNodes = 4000): PathNode[] | null {
  const sx = Math.floor(start.x), sy = Math.floor(start.y), sz = Math.floor(start.z);
  const gx = Math.floor(goal.x), gy = Math.floor(goal.y), gz = Math.floor(goal.z);
  const h = (x: number, y: number, z: number) => {
    const dx = Math.abs(x - gx), dy = Math.abs(y - gy), dz = Math.abs(z - gz);
    return Math.max(dx, dz) + 0.41 * Math.min(dx, dz) + dy * 1.2;
  };
  // Numeric keys relative to the start position (much faster than string keys)
  const key = (x: number, y: number, z: number) => ((x - sx + 2048) * 4096 + (z - sz + 2048)) * 256 + y;
  const open = new Heap();
  const best = new Map<number, number>();
  const startNode: OpenNode = { x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz), parent: null };
  open.push(startNode);
  best.set(key(sx, sy, sz), 0);
  let closest = startNode;
  let closestH = h(sx, sy, sz);
  let expanded = 0;
  while (open.size && expanded < maxNodes) {
    const cur = open.pop()!;
    if (cur.g > (best.get(key(cur.x, cur.y, cur.z)) ?? Infinity)) continue;
    expanded++;
    const dist = Math.hypot(cur.x - gx, (cur.y - gy) * 1.0, cur.z - gz);
    if (dist <= range) return reconstruct(cur);
    const ch = h(cur.x, cur.y, cur.z);
    if (ch < closestH) {
      closestH = ch;
      closest = cur;
    }
    const inWater = isWater(w, cur.x, cur.y, cur.z);
    for (const [dx, dz] of DIRS) {
      const nx = cur.x + dx, nz = cur.z + dz;
      const diagonal = dx !== 0 && dz !== 0;
      if (diagonal && (!passable(w, cur.x + dx, cur.y, cur.z) || !passable(w, cur.x, cur.y, cur.z + dz) || !passable(w, cur.x + dx, cur.y + 1, cur.z) || !passable(w, cur.x, cur.y + 1, cur.z + dz))) continue;
      const stepCost = diagonal ? 1.414 : 1;
      // same level
      const tryNode = (ny: number, extra: number) => {
        if (!standable(w, nx, ny, nz)) return false;
        const water = isWater(w, nx, ny, nz);
        const g = cur.g + stepCost + extra + (water ? 2 : 0);
        const k = key(nx, ny, nz);
        if (g >= (best.get(k) ?? Infinity)) return true;
        best.set(k, g);
        open.push({ x: nx, y: ny, z: nz, g, f: g + 1.6 * h(nx, ny, nz), parent: cur });
        return true;
      };
      if (tryNode(cur.y, 0)) continue;
      // step up (needs headroom above current position)
      if (!diagonal && passable(w, cur.x, cur.y + 2, cur.z) && tryNode(cur.y + 1, 0.5)) continue;
      // drop down up to 3 blocks
      if (passable(w, nx, cur.y, nz) && passable(w, nx, cur.y + 1, nz)) {
        for (let d = 1; d <= 3; d++) {
          if (!passable(w, nx, cur.y - d + 1, nz)) break;
          if (tryNode(cur.y - d, d * 0.3)) break;
        }
      }
    }
    // swim up / down in water
    if (inWater) {
      for (const dy of [1, -1]) {
        const ny = cur.y + dy;
        if (!passable(w, cur.x, ny, cur.z) || !passable(w, cur.x, ny + 1, cur.z)) continue;
        const k = key(cur.x, ny, cur.z);
        const g = cur.g + 1.5;
        if (g >= (best.get(k) ?? Infinity)) continue;
        if (!isWater(w, cur.x, ny, cur.z) && !solidBelow(w, cur.x, ny, cur.z) && dy < 0) continue;
        best.set(k, g);
        open.push({ x: cur.x, y: ny, z: cur.z, g, f: g + 1.6 * h(cur.x, ny, cur.z), parent: cur });
      }
    }
  }
  // Partial path towards the goal if it got meaningfully closer
  if (closest !== startNode && closestH < h(sx, sy, sz) - 2) return reconstruct(closest);
  return null;
}

function reconstruct(n: OpenNode): PathNode[] {
  const out: PathNode[] = [];
  let c: OpenNode | null = n;
  while (c) {
    out.push({ x: c.x, y: c.y, z: c.z });
    c = c.parent;
  }
  return out.reverse();
}
