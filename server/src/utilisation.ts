/**
 * Utilisation over time (#67, s39): each agent's busy and seen time in 1-minute bins, sampled as the runs' BusyClock
 * counts it (scripts/checks/autonomy_metrics.py): an agent is busy while an action runs, and the time since the last
 * sample goes to the state seen now, at most 30 s (a pause in sampling counts for nothing). In memory, bounded to a day of
 * bins an agent; the panel draws the village's share and each agent's. World-free.
 */

/** One-minute bins kept an agent (a day). */
export const UTIL_BINS = 24 * 60;
const BIN_MS = 60_000;
const MAX_DT_MS = 30_000;

export interface UtilView {
  /** Minutes a point covers, and the start of the first point (ms since the epoch). */
  binMin: number;
  start: number;
  /** The village's (all agents') busy share per point, null where nobody was seen. */
  overall: Array<number | null>;
  /** Each agent's busy share per point, null where it was not seen. */
  agents: Record<string, Array<number | null>>;
  /** Busy share over the whole span shown (as the runs' "busy %"). */
  total: number | null;
}

/** An agent's bins: the minute each starts (its index from `first`), busy and seen seconds. */
interface Bins { first: number; busy: number[]; seen: number[] }

export class UtilClock {
  private last: number | null = null;
  private bins = new Map<string, Bins>();

  /** A sample: who is busy now. */
  sample(now: number, agents: Array<{ name: string; busy: boolean }>): void {
    const dt = this.last === null ? 0 : Math.max(0, Math.min(MAX_DT_MS, now - this.last));
    this.last = now;
    if (!dt) return;
    const minute = Math.floor(now / BIN_MS);
    for (const a of agents) {
      let b = this.bins.get(a.name);
      if (!b) this.bins.set(a.name, (b = { first: minute, busy: [], seen: [] }));
      const i = minute - b.first;
      while (b.seen.length <= i) {
        b.seen.push(0);
        b.busy.push(0);
      }
      b.seen[i] += dt / 1000;
      if (a.busy) b.busy[i] += dt / 1000;
      // (bounded: the oldest minutes dropped)
      const over = b.seen.length - UTIL_BINS;
      if (over > 0) {
        b.seen.splice(0, over);
        b.busy.splice(0, over);
        b.first += over;
      }
    }
  }

  /** The last `points` points of `binMin` minutes each, ending at the current minute. */
  view(now: number, binMin: number, points: number): UtilView {
    const bm = Math.max(1, Math.floor(binMin) || 1), n = Math.max(1, Math.min(1000, Math.floor(points) || 1));
    const endMin = Math.floor(now / BIN_MS) + 1;
    const startMin = endMin - bm * n;
    const agents: Record<string, Array<number | null>> = {};
    const allBusy = new Array<number>(n).fill(0), allSeen = new Array<number>(n).fill(0);
    let tb = 0, ts = 0;
    for (const [name, b] of this.bins) {
      const row: Array<number | null> = [];
      let any = false;
      for (let p = 0; p < n; p++) {
        let busy = 0, seen = 0;
        for (let m = startMin + p * bm; m < startMin + (p + 1) * bm; m++) {
          const i = m - b.first;
          if (i < 0 || i >= b.seen.length) continue;
          busy += b.busy[i];
          seen += b.seen[i];
        }
        row.push(seen > 0 ? busy / seen : null);
        if (seen > 0) any = true;
        allBusy[p] += busy;
        allSeen[p] += seen;
        tb += busy;
        ts += seen;
      }
      if (any) agents[name] = row;
    }
    return { binMin: bm, start: startMin * BIN_MS, overall: allSeen.map((s, p) => (s > 0 ? allBusy[p] / s : null)), agents, total: ts > 0 ? tb / ts : null };
  }

  /** An agent removed: its history goes. */
  forget(name: string): void {
    this.bins.delete(name);
  }
}
