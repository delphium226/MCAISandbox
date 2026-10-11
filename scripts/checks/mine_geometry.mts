/**
 * The mine's per-part record checked offline (plan step S.2; no server): tunnels kept per part (`main`, `br`) against the
 * in-order counter they replace. For every count up to three stretches, in each direction: the cells the migration's record
 * gives (legCells over fromOrder) are the in-order code's (tunnelCell over the count). Then for every main tunnel in each
 * villages.json given (default both worlds'): the same for its recorded count, its box (legBox: never smaller than before,
 * one stretch larger while its main tunnel is at a dug junction's branches), its turns (turnFrom: the same on a tunnel that
 * ended; on one still going, a turn may come at the latest junction once that side's branch is done), and where the iron
 * stairs would start (ironStart, against the in-order code's choice). FAIL lines for what must agree; exits 1 on any.
 * Usage: node_modules/.bin/tsx scripts/checks/mine_geometry.mts [villages.json ...]
 */
import fs from 'node:fs';
import { fromOrder, type Mine, type MineLeg } from '../../server/src/village';
import { ironStart, legBox, legCells, tunnelCell, turnFrom } from '../../server/src/mineflayer/mcMine';

const MAIN_STEP = 3, BRANCH = 12, PER = MAIN_STEP + 2 * BRANCH;
let fails = 0;
const fail = (s: string) => { fails++; console.log(`FAIL ${s}`); };
const key = (c: { x: number; z: number }) => `${c.x},${c.z}`;
const same = (a: Array<{ x: number; z: number }>, b: Array<{ x: number; z: number }>) => {
  const A = new Set(a.map(key)), B = new Set(b.map(key));
  return A.size === B.size && [...A].every((k) => B.has(k));
};
/** A tunnel as the code before S.2 kept it (the in-order counter only), and as upgradeMine keeps it now. */
const inOrder = (l: MineLeg): MineLeg => { const { main: _m, br: _b, ...rest } = l; return { ...rest, ended: [...l.ended] }; };
const perPart = (l: MineLeg): MineLeg => ({ ...inOrder(l), ...fromOrder(l.dug) });

// The in-order code (HEAD before S.2), the reference
function oldLegBox(l: MineLeg) {
  const [dx, dz] = l.dir;
  const len = MAIN_STEP * (Math.floor(l.dug / PER) + 1) + 1;
  const ends = [{ x: l.x - dx + dz * (BRANCH + 1), z: l.z - dz - dx * (BRANCH + 1) }, { x: l.x + dx * len - dz * (BRANCH + 1), z: l.z + dz * len + dx * (BRANCH + 1) }];
  return { x1: Math.min(...ends.map((e) => e.x)), z1: Math.min(...ends.map((e) => e.z)), x2: Math.max(...ends.map((e) => e.x)), z2: Math.max(...ends.map((e) => e.z)) };
}
function oldTurnFrom(l: MineLeg, side: 1 | 2, first: boolean) {
  const [dx, dz] = l.dir;
  for (let s = Math.floor(l.dug / PER); s >= 1; s--) if (!l.ended.includes(3 * (s - 1) + side)) return { x: l.x + dx * MAIN_STEP * s, z: l.z + dz * MAIN_STEP * s };
  return first ? { x: l.x, z: l.z } : null;
}
const stairColumns = (m: Mine) => Array.from({ length: m.steps }, (_, i) => ({ x: m.top.x + m.dir[0] * i, z: m.top.z + m.dir[1] * i }));
const downColumns = (m: Mine, d: { x: number; z: number; steps: number }) => Array.from({ length: d.steps }, (_, i) => ({ x: d.x + m.dir[0] * (i + 1), z: d.z + m.dir[1] * (i + 1) }));
function oldIronStart(m: Mine) {
  const last = m.down?.filter((d) => d.level !== undefined).at(-1);
  const b = last ? downColumns(m, last)[last.steps - 1] : stairColumns(m)[m.steps - 1];
  const L = last ? last.level! : m.level!;
  if (!b || L === undefined) return null;
  const dug: Array<{ x: number; z: number }> = [...stairColumns(m), ...(m.down ?? []).flatMap((d) => downColumns(m, d))];
  const level: Array<{ x: number; z: number }> = [{ x: b.x, z: b.z }];
  for (const l of (m.legs ?? []).filter((q) => q.y === L)) {
    level.push({ x: l.x, z: l.z });
    for (let k = 0; k < l.dug; k++) level.push(tunnelCell(l, k));
    if (!l.end) for (let k = l.dug; k < l.dug + 2 * PER; k++) dug.push(tunnelCell(l, k));
  }
  dug.push(...level);
  const [dx, dz] = m.dir;
  const dirs: Array<[number, number]> = [[dz, -dx], [-dz, dx], [dx, dz], [-dx, -dz]];
  const starts = level.filter((c, n) => level.findIndex((o) => o.x === c.x && o.z === c.z) === n)
    .sort((p, q) => Math.abs(p.x - b.x) + Math.abs(p.z - b.z) - Math.abs(q.x - b.x) - Math.abs(q.z - b.z));
  for (const st of starts)
    for (const dir of dirs) {
      const clear = [1, 2, 3, 4].every((k) => {
        const c = { x: st.x + dir[0] * k, z: st.z + dir[1] * k };
        return dug.every((d) => (d.x === st.x && d.z === st.z) || Math.abs(d.x - c.x) + Math.abs(d.z - c.z) >= 2);
      });
      if (clear) return { x: st.x, z: st.z, dir };
    }
  return null;
}

// 1. The migration's cells for every count up to three stretches, in each direction, with and without branches cut short
let counts = 0;
for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>)
  for (const ended of [[], [1], [2, 4]])
    for (let d = 0; d <= 3 * PER; d++) {
      const l: MineLeg = { x: 100, z: -50, y: 40, dir, dug: d, ended };
      const want = Array.from({ length: d }, (_, k) => tunnelCell(l, k));
      if (!same(legCells(perPart(l)), want)) fail(`count ${d} dir ${dir} ended ${ended}: legCells over fromOrder differs from tunnelCell`);
      counts++;
    }
console.log(`counts: ${counts} checked (0..${3 * PER} in 4 directions, 3 sets of branches cut short)`);

// 2. Every recorded tunnel
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['mc/server/villages.json', 'mc/testserver/villages.json'].filter((f) => fs.existsSync(f));
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { villages?: Array<{ name: string; mine?: Mine }> };
  let legs = 0, larger = 0, turnsMoved = 0, mines = 0, startsSame = 0;
  const moved: string[] = [];
  for (const v of data.villages ?? []) {
    const m = v.mine;
    if (!m || m.level === undefined || !m.legs?.length) continue;
    mines++;
    const old = m.legs.map(inOrder), now = old.map(perPart);
    for (const [i, l] of old.entries()) {
      legs++;
      const n = now[i];
      if (!same(legCells(n), Array.from({ length: l.dug }, (_, k) => tunnelCell(l, k)))) fail(`${file} ${v.name} leg ${i}: cells differ`);
      const a = oldLegBox(l), b = legBox(n);
      if (b.x1 > a.x1 || b.z1 > a.z1 || b.x2 < a.x2 || b.z2 < a.z2) fail(`${file} ${v.name} leg ${i}: box ${JSON.stringify(b)} smaller than ${JSON.stringify(a)}`);
      else if (b.x1 !== a.x1 || b.z1 !== a.z1 || b.x2 !== a.x2 || b.z2 !== a.z2) larger++;
      for (const side of [1, 2] as const)
        for (const first of [false, true]) {
          const o = oldTurnFrom(l, side, first), t = turnFrom(n, side, first);
          const differ = JSON.stringify(o) !== JSON.stringify(t && { x: t.x, z: t.z });
          if (differ && l.end) fail(`${file} ${v.name} leg ${i} (ended) side ${side} first ${first}: turn ${JSON.stringify(t && { x: t.x, z: t.z })} against ${JSON.stringify(o)}`);
          else if (differ) turnsMoved++;
        }
    }
    const so = oldIronStart({ ...m, legs: old }), sn = ironStart({ ...m, legs: now, iron: undefined });
    if (JSON.stringify(so) === JSON.stringify(sn && { x: sn.x, z: sn.z, dir: sn.dir })) startsSame++;
    else moved.push(`${v.name}: ${so ? `${so.x},${so.z} ${so.dir}` : 'none'} -> ${sn ? `${sn.x},${sn.z} ${sn.dir}` : 'none'}`);
  }
  console.log(`${file}: ${mines} mines, ${legs} tunnels; boxes larger by a stretch ${larger}; turns that differ on tunnels still going ${turnsMoved}; iron starts the same ${startsSame} of ${mines}`);
  for (const s of moved) console.log(`  iron start moved: ${s}`);
}
console.log(fails ? `${fails} FAIL` : 'PASS');
process.exit(fails ? 1 : 0);
