/**
 * The monument's stonecutter (#162, tier 2; runs/2026-10-26/tier2/spec.md, chain A): one stonecutter at the end of the
 * kiln's first row of furnaces, where the carver cuts the yard's stone (and the quarry's andesite, diorite and granite)
 * into what the stage's detail palette asks for: stone bricks, chiselled bricks, stairs, walls, polished stones. With the
 * stonecutter the build crafts none of them (the plan made with Materials' `cut` gives them only as cuts), so cutting is
 * a chore of its own and the carver a trade. A cut is instant, as in the game; the work is the load carried there and
 * back. World-free: the cell, what the stage wants cut and a chore's load, and the yard's ledger; mcCutter.ts places it
 * and cuts.
 */
import type { Kiln } from './kiln';
import { rawSetting } from './settings';

/** MC_MONUMENT_DETAIL=on (#162, off): the cathedral drawn with gothicGen's `detail` and its stone pieces cut here. */
export const CUTTER = {
  on: /^(on|1|true|yes)$/i.test(rawSetting('MC_MONUMENT_DETAIL') ?? 'off'),
};

/** The stonecutter's record beside the kiln's (it rides in the monument's JSON, as M3's fields do). */
export interface CutterRecord { x: number; y: number; z: number; at: number; by: string; loads: number; made: Record<string, number> }

/** A plan's steps as this reads them (mcMaterials' Step: a cut is a craft marked `cut`). */
export interface CutStep { do: 'craft' | 'smelt'; item: string; runs: number; makes?: number; input?: string; cut?: true }
/** One cut: `runs` of `input` into `makes` of `item` (`unit`: inputs a run takes together, a forged block's ingots). */
export interface Cut { item: string; input: string; runs: number; makes: number; unit?: number }

/** #162 tier 3, chain B: a cut's input the carver makes at the stonecutter's table first when the yard holds none (9 copper
 *  ingots a copper block, the roof's cut copper cut from it); charged by command with the cut. */
export const FORGE: Record<string, { input: string; n: number }> = { copper_block: { input: 'copper_ingot', n: 9 } };

/** The most input a carver carries to the stonecutter at a time (three stacks, half its inventory). */
export const CUT_LOAD = 192;

/** The stonecutter's cell: the kiln strip's end column beside its first row (the walks either side stay open). */
export function cutterCell(k: Pick<Kiln, 'x2' | 'z1' | 'y'>): { x: number; y: number; z: number } {
  return { x: k.x2, y: k.y + 1, z: k.z1 + 1 };
}

/**
 * What can be cut now: the plan's cut steps (the stage's still to build, against the yard) whose input the yard holds, as
 * many runs as it holds for each, inputs shared in the steps' order (a cut's output used by a later cut, as stone bricks
 * for nothing yet: every cut in the jar takes a raw stone, but bricks cut from bricks would come after).
 */
export function cutWants(steps: CutStep[], yard: Record<string, number>): Cut[] {
  const left: Record<string, number> = { ...yard };
  const out: Cut[] = [];
  for (const s of steps) {
    if (!s.cut || !s.input) continue;
    const per = Math.max(1, Math.round((s.makes ?? s.runs) / s.runs));
    const runs = Math.min(s.runs, Math.floor(left[s.input] ?? 0));
    if (runs > 0) {
      left[s.input] -= runs;
      out.push({ item: s.item, input: s.input, runs, makes: runs * per });
    }
    // (the rest from what the input is forged from)
    const f = FORGE[s.input];
    const more = f ? Math.min(s.runs - Math.max(0, runs), Math.floor((left[f.input] ?? 0) / f.n)) : 0;
    if (f && more > 0) {
      left[f.input] -= more * f.n;
      out.push({ item: s.item, input: f.input, runs: more * f.n, makes: more * per, unit: f.n });
    }
  }
  return out;
}

/** A chore's load: the wants in order up to `cap` of input (a cut split where it passes the cap). */
export function cutLoad(wants: Cut[], cap = CUT_LOAD): Cut[] {
  const out: Cut[] = [];
  let room = cap;
  for (const w of wants) {
    if (room <= 0) break;
    const u = w.unit ?? 1, runs = Math.floor(Math.min(w.runs, room) / u) * u;
    if (runs <= 0) break;
    out.push({ ...w, runs, makes: Math.round((w.makes / w.runs) * runs) });
    room -= runs;
  }
  return out;
}

/** The load's inputs together (what the carver takes from the yard). */
export function cutInputs(load: Cut[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of load) out[c.input] = (out[c.input] ?? 0) + c.runs;
  return out;
}

/** The yard's ledger after cuts made: each input out, each output in (what was really cut, `done`, may be less). */
export function applyCuts(yard: Record<string, number>, done: Cut[]): void {
  for (const c of done) {
    yard[c.input] = Math.max(0, (yard[c.input] ?? 0) - c.runs);
    if (!yard[c.input]) delete yard[c.input];
    yard[c.item] = (yard[c.item] ?? 0) + c.makes;
  }
}

/** Whether a plan still has cutting to do (a job waits for it: the build cuts nothing). */
export const needsCutting = (steps: CutStep[]) => steps.some((s) => s.cut);

/** A load's line ("64 stone_bricks, 12 chiseled_stone_bricks from 76 stone"). */
export function cutLine(load: Cut[]): string {
  const made = load.map((c) => `${c.makes} ${c.item}`).join(', ');
  const from = Object.entries(cutInputs(load)).map(([n, q]) => `${q} ${n}`).join(', ');
  return `${made} from ${from}`;
}
