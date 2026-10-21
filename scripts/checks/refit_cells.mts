/**
 * #75's refits checked in the world (lesson 138: judge the cells, not the stock): every structure of a village with a
 * refit tier, each changed cell of each tier it reached (refit.ts refitDesign, turned as build_design turns it, at the
 * record's floor), read back over RCON with `execute if block` against the tier's block (any state: stairs keep their
 * own); and for comparison the same cells of buildings not refitted, which must still hold the original block. Wood
 * blocks match any wood kind (builds swap kinds).
 * Usage: MC_SERVER_DIR=mc/testserver node node_modules/tsx/dist/cli.mjs scripts/checks/refit_cells.mts VILLAGES.json VILLAGE
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { refitDesign } from '../../server/src/refit';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const [file, name] = process.argv.slice(2);
if (!file || !name) {
  console.log('usage: refit_cells.mts VILLAGES.json VILLAGE');
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const v: Any = (Array.isArray(raw.villages) ? raw.villages : Object.values(raw.villages)).find((x: Any) => x.name === name);
if (!v) throw new Error(`no village ${name} in ${file}`);
const base = (b: string) => b.replace(/^minecraft:/, '').replace(/\[.*$/, '');
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak'];
// (the kinds a cell may hold: wood blocks and logs in any kind)
const kinds = (b: string) => {
  for (const w of WOODS) if (b.includes(w)) return WOODS.map((k) => b.replace(w, k));
  return [b];
};

const cells: Array<{ x: number; y: number; z: number; want: string[]; what: string }> = [];
for (const st of v.structures) {
  const d = v.designs[st.kind];
  if (!d) continue;
  const done = v.tasks.find((t: Any) => t.status === 'done' && String(t.detail).startsWith(`build_design "${st.kind}"`) && (() => {
    const m = /x=(-?\d+) z=(-?\d+)(?: rotate=(\d+))?/.exec(t.detail)!;
    const r = ((Math.round(Number(m[3] ?? 0) / 90) % 4) + 4) % 4, W = r % 2 ? d.depth : d.width, D = r % 2 ? d.width : d.depth;
    return Number(m[1]) - Math.floor(W / 2) === st.x1 && Number(m[2]) - Math.floor(D / 2) === st.z1;
  })());
  if (!done) continue;
  const rot = ((Math.round(Number(/rotate=(\d+)/.exec(done.detail)?.[1] ?? 0) / 90) % 4) + 4) % 4;
  const turn = (i: number, j: number): [number, number] => {
    let [u, q, w, h] = [i, j, d.width, d.depth];
    for (let r = 0; r < rot; r++) [u, q, w, h] = [h - 1 - q, u, h, w];
    return [u, q];
  };
  // (tier 3 is drawn over tier 2's result: a cell both change ends as tier 3's)
  for (const tier of [2, 3]) {
    const r = refitDesign(d, tier);
    if (!r) continue;
    const reached = (st.tier ?? 1) >= tier;
    r.layers.forEach((layer: string[], li: number) => layer.forEach((row: string, j: number) => {
      for (let i = 0; i < row.length; i++) {
        if (row[i] === '_') continue;
        if (tier === 2 && (st.tier ?? 1) >= 3 && refitDesign(d, 3)?.layers[li][j][i] !== '_') continue;
        const [ox, oz] = turn(i, j);
        const want = reached ? base(r.palette[row[i]]) : base(d.palette[d.layers[li][j][i]]);
        cells.push({ x: st.x1 + ox, y: st.y + li, z: st.z1 + oz, want: kinds(want), what: `${st.kind} t${tier} ${reached ? 'refitted' : 'as built'}` });
      }
    }));
  }
}
const rcon = (cmds: string[]): string[] => {
  const out = execFileSync('python', ['mc/rcon.py', ...cmds], { encoding: 'utf8', env: process.env, maxBuffer: 1 << 26 });
  return out.split(/\r?\n/).filter((l) => l.trim());
};
const tally = new Map<string, { ok: number; bad: number; ex: string[] }>();
for (let k = 0; k < cells.length; k += 40) {
  const batch = cells.slice(k, k + 40);
  for (const c of batch) {
    const res = rcon(c.want.map((b) => `execute if block ${c.x} ${c.y} ${c.z} minecraft:${b}`));
    const hit = res.some((l) => /passed/i.test(l));
    const t = tally.get(c.what) ?? { ok: 0, bad: 0, ex: [] };
    if (hit) t.ok++;
    else {
      t.bad++;
      if (t.ex.length < 3) t.ex.push(`${c.x},${c.y},${c.z} not ${c.want[0]}`);
    }
    tally.set(c.what, t);
  }
}
let bad = 0;
for (const [what, t] of [...tally].sort()) {
  console.log(`${what}: ${t.ok} of ${t.ok + t.bad} cells as expected${t.ex.length ? `; e.g. ${t.ex.join('; ')}` : ''}`);
  if (/refitted/.test(what)) bad += t.bad;
}
const refitted = [...tally].filter(([w]) => /refitted/.test(w)).reduce((s, [, t]) => s + t.ok + t.bad, 0);
console.log(`${bad || !refitted ? 'FAIL' : 'PASS'} refit_cells: ${refitted} refitted cells checked, ${bad} wrong`);
process.exit(bad || !refitted ? 1 : 0);
