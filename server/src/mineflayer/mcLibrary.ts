/**
 * #21 (MC_LETTERS): the age of letters' library (runs/2026-10-24/letters/spec.md, section 9): the village's first
 * plains_library_2 gets its 4 bookshelves and its lectern, set by command into the cells the jar's piece gives them (the
 * import keeps the piece's planks in the shelves' cells and air in the lectern's, vanillaPieces.ts `substitute`). The
 * record of what is placed lives on the village (`v.library`); the shelving skill is mcBuild.ts' shelve_library.
 */
import type { Design, Village } from '../village';
import type { VanillaShelf } from '../vanillaPieces';

/** One library cell: a shelf or the lectern, with the lectern's facing. */
export interface LibraryCell { x: number; y: number; z: number; part: 'shelf' | 'lectern'; facing?: string }

/** What the village shelved: the library structure, the cells done ("x,y,z") and how many of them are shelves and the
 *  lectern, cells that can never take a piece (something else stands there). */
export interface LibraryRecord { structure: string; done: string[]; shelves: number; lectern: boolean; never?: string[] }

/** The library's shelves (4) and lectern (1) still to place: none placed yet without a record. */
export function libraryLeft(v: Village): { shelves: number; lectern: number } {
  const r = libraryOf(v);
  return { shelves: Math.max(0, 4 - (r?.shelves ?? 0)), lectern: r?.lectern ? 0 : 1 };
}

export const cellKey = (c: { x: number; y: number; z: number }) => `${c.x},${c.y},${c.z}`;

/** The village's library record (kept beside the village's own fields; undefined until a shelving chose a library). */
export function libraryOf(v: Village): LibraryRecord | undefined {
  return (v as Village & { library?: LibraryRecord }).library;
}

export function setLibrary(v: Village, r: LibraryRecord): void {
  (v as Village & { library?: LibraryRecord }).library = r;
}

const CLOCKWISE: Record<string, 'north' | 'east' | 'south' | 'west'> = { north: 'east', east: 'south', south: 'west', west: 'north' };

/**
 * A placed library's shelf and lectern cells in the world: the design's cells (vanillaShelves) turned with the building
 * as build_design turns it (streetPlan.ts placedGrid, its centre x, z and quarter turns `rot`), at the structure's floor
 * level `y` plus the cell's layer; the lectern's facing turned on by the same quarter turns. At most `shelves` shelves
 * (the rung's 4) and one lectern, shelves first (the shelving places them in this order, the lectern last).
 */
export function libraryCells(place: { design: Design; x: number; z: number; rot: number }, cells: VanillaShelf[], y: number, shelves = 4): LibraryCell[] {
  const d = place.design, rot = ((place.rot % 4) + 4) % 4;
  const W = rot % 2 ? d.depth : d.width, D = rot % 2 ? d.width : d.depth;
  const x1 = place.x - Math.floor(W / 2), z1 = place.z - Math.floor(D / 2);
  const out: LibraryCell[] = [];
  for (const c of [...cells].sort((p, q) => (p.block === q.block ? p.layer - q.layer || p.j - q.j || p.i - q.i : p.block === 'bookshelf' ? -1 : 1))) {
    let [u, w, ww, dd] = [c.i, c.j, d.width, d.depth];
    for (let r = 0; r < rot; r++) [u, w, ww, dd] = [dd - 1 - w, u, dd, ww];
    let facing = c.facing;
    if (facing) for (let r = 0; r < rot; r++) facing = CLOCKWISE[facing];
    if (c.block === 'bookshelf' && out.filter((q) => q.part === 'shelf').length >= shelves) continue;
    if (c.block === 'lectern' && out.some((q) => q.part === 'lectern')) continue;
    out.push({ x: x1 + u, y: y + c.layer, z: z1 + w, part: c.block === 'bookshelf' ? 'shelf' : 'lectern', ...(facing ? { facing } : {}) });
  }
  return out;
}
