/**
 * The building gallery: every monument preset (gothicGen.ts's cathedrals and castleGen.ts's castles at 1:3, the default
 * scale) and every civic building (civic.ts's sources, each at the scale the civic tier draws it) placed side by side in a
 * superflat Paper world of its own (mc/gallery, port 25571, RCON 25581), so they can be walked round in game.
 *
 * Buildings are placed by RCON straight from the generators' block lists (no members, no bills): each building's cells are
 * merged into boxes of one block (runs along x, then rows along z, then layers) and sent as /fill ... strict (no neighbour
 * updates, so doors, lanterns and banners stay as drawn), over several RCON connections at once, with its chunks
 * forceloaded while it is placed. Monuments stand in two avenues (cathedrals, castles), the civic buildings in one avenue per
 * source (timber, towers, stone churches, castle-family), sorted by kind; buildings alternate either side of a road along x,
 * each with a sign at the road naming it and its place. A north-south road at x = -12 joins the avenues; the spawn platform
 * with the legend is at its north end. A rebuild first clears the boxes of the last build (runs/<date>/gallery/layout.json).
 *
 * Writes runs/<date>/gallery/index.md (the avenues' and buildings' teleports) and layout.json, then spot-checks three cells
 * of every building with `execute if block`.
 *
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/gallery.mts [--dry] [--only ID,ID] [--conns N] [--out DIR]
 *   --dry     draw and lay out only (prints the layout and the command count; no server needed)
 *   --only    place only these buildings (the layout is still the whole gallery's)
 *   --plain   the generators' walls as drawn (by default dressed by dressing.ts when MC_DRESSING is on, as villages build them)
 *   --compare ID,ID,...  before and after: each building plain on the north side of an avenue of its own north of the
 *             spawn and dressed opposite it on the south side (layout-compare.json, compare.md; the gallery stays)
 * MC_SERVER_DIR (default mc/gallery) names the server whose server.properties gives the RCON port and password.
 */
import fs from 'node:fs';
import path from 'node:path';
import { GOTHIC_PRESETS, generateCathedral, type Cathedral } from '../server/src/gothicGen';
import { CASTLE_PRESETS, generateCastle } from '../server/src/castleGen';
import { civicEntries, civicScale, drawCivic } from '../server/src/civic';
import { Rcon } from '../server/src/mineflayer/rcon';
import { DRESSING, dress, type Supply } from '../server/src/dressing';
import { DEEP_STONE_ON } from '../server/src/monument';

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const DRY = flag('--dry');
const ONLY = new Set((opt('--only') ?? '').split(',').filter(Boolean));
const CONNS = Number(opt('--conns') ?? 6) || 6;
const today = new Date().toISOString().slice(0, 10);
const OUT = opt('--out') ?? path.join('runs', today, 'gallery');
const SERVER = process.env.MC_SERVER_DIR || 'mc/gallery';
const COMPARE = (opt('--compare') ?? '').split(',').filter(Boolean);
const DRESS = DRESSING.on && !flag('--plain');
/** The supply a village's building of this kind is dressed with (a cathedral begun with the detail palette and deep stone). */
const supplyOf = (kind: string): Supply => (kind === 'cathedral' ? (DEEP_STONE_ON ? 'deep' : 'detail') : 'base');
const dressed = (id: string, kind: string, c: Cathedral): Cathedral => dress(c, { seed: id, supply: supplyOf(kind) });

/** The world's surface: superflat grass at y = -61, buildings from y = -60. */
const GROUND = -61, Y0 = -60;
/** Monuments' scale (1:3, the default since 10-27). */
const MONUMENT_SCALE = 3;
const GAP = 14, ROAD = 5, SETBACK = 4, AVENUE_GAP = 24, SPINE_X = -12;

interface Item {
  id: string; title: string; place: string; kind: string; built?: string; scale: number;
  avenue: string; c: Cathedral;
  /** Placed: the grid's origin, the side of the road, the sign. */
  x?: number; z?: number; side?: 'n' | 's'; sign?: [number, number, number];
}

// ---- the buildings ----
const items: Item[] = [];
const head = (d: string) => d.split(':')[0].trim();
const rest = (d: string) => d.split(':').slice(1).join(':').trim();
console.log('drawing...');
for (const p of Object.values(GOTHIC_PRESETS))
  items.push({ id: p.name, title: head(p.description), place: rest(p.description), kind: 'cathedral', scale: MONUMENT_SCALE, avenue: 'Cathedrals',
    c: generateCathedral(p, MONUMENT_SCALE, { detail: true, furnish: true, copperRoof: true, accents: true }) });
for (const p of Object.values(CASTLE_PRESETS))
  items.push({ id: p.name, title: head(p.description), place: rest(p.description), kind: 'castle', scale: MONUMENT_SCALE, avenue: 'Castles', c: generateCastle(p, MONUMENT_SCALE) });
const CIVIC_AVENUE: Record<string, string> = { timber: 'Civic: timber halls and mills', tower: 'Civic: lighthouses and clock towers', gothic: 'Civic: churches, chapels and bell towers', castle: 'Civic: gates, keeps and tower houses' };
for (const e of [...civicEntries()].sort((a, b) => a.source.family.localeCompare(b.source.family) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))) {
  const scale = civicScale(e.id);
  items.push({ id: e.id, title: e.title.replace(/^the /, 'The '), place: e.place, built: e.built, kind: e.kind, scale, avenue: CIVIC_AVENUE[e.source.family] ?? `Civic: ${e.source.family}`, c: drawCivic(e.id, scale) });
}
// (the plain drawings kept for --compare; the gallery's own buildings dressed as villages build them)
const plain = new Map(items.map((i) => [i.id, i.c]));
if (DRESS && !COMPARE.length) for (const it of items) it.c = dressed(it.id, it.kind, it.c);
const avenues = [...new Set(items.map((i) => i.avenue))];
const monuments = items.filter((i) => i.kind === 'cathedral' || i.kind === 'castle').length;
console.log(`${items.length} buildings: ${monuments} monuments, ${items.length - monuments} civic; avenues: ${avenues.join(' | ')}`);

// ---- the layout ----
// Each avenue: a road along x from x = 0; buildings alternate north and south of it (the side whose row is shorter), their
// faces SETBACK from the road, GAP between them along the row.
let zCursor = 0;
const avenueAt: Array<{ name: string; road: number; x1: number; count: number }> = [];
for (const name of avenues) {
  const list = items.filter((i) => i.avenue === name);
  const depthN = Math.max(0, ...list.filter((_, k) => k % 2 === 0).map((i) => i.c.design.depth));
  let xs = { n: 0, s: 0 };
  const north: Item[] = [], south: Item[] = [];
  for (const it of list) {
    const side: 'n' | 's' = xs.n <= xs.s ? 'n' : 's';
    it.side = side;
    it.x = xs[side];
    xs[side] += it.c.design.width + GAP;
    (side === 'n' ? north : south).push(it);
  }
  const dn = Math.max(depthN, ...north.map((i) => i.c.design.depth));
  const road = zCursor + dn + SETBACK;
  for (const it of north) {
    it.z = road - SETBACK - it.c.design.depth;
    it.sign = [it.x! + (it.c.design.width >> 1), Y0, road - 1];
  }
  for (const it of south) {
    it.z = road + ROAD + SETBACK;
    it.sign = [it.x! + (it.c.design.width >> 1), Y0, road + ROAD];
  }
  const ds = Math.max(0, ...south.map((i) => i.c.design.depth));
  avenueAt.push({ name, road, x1: Math.max(xs.n, xs.s), count: list.length });
  zCursor = road + ROAD + SETBACK + ds + AVENUE_GAP;
}
const SPAWN: [number, number, number] = [SPINE_X, Y0, avenueAt[0].road - 14];

// --compare: an avenue north of the spawn, each building plain on its north side and dressed opposite on its south side
if (COMPARE.length) {
  const pick = COMPARE.map((id) => items.find((i) => i.id === id) ?? (() => { throw new Error(`gallery: no building ${id}`); })());
  const pairs = pick.map((it) => [
    { ...it, id: `${it.id}_before`, title: `Before: ${it.title}`, avenue: 'Before and after', c: plain.get(it.id)!, side: 'n' as const },
    { ...it, id: `${it.id}_after`, title: `After: ${it.title}`, avenue: 'Before and after', c: dressed(it.id, it.kind, plain.get(it.id)!), side: 's' as const },
  ]);
  const ds = Math.max(...pairs.map(([, a]) => a.c.design.depth));
  // (south of it nothing below z = -AVENUE_GAP: the gallery's avenues start at z = 0)
  const road = Math.min(SPAWN[2] - 20, -AVENUE_GAP) - ds - SETBACK - ROAD;
  let x = 0;
  for (const [b, a] of pairs) {
    b.x = a.x = x;
    b.z = road - SETBACK - b.c.design.depth;
    a.z = road + ROAD + SETBACK;
    b.sign = [x + (b.c.design.width >> 1), Y0, road - 1];
    a.sign = [x + (a.c.design.width >> 1), Y0, road + ROAD];
    x += Math.max(b.c.design.width, a.c.design.width) + GAP;
  }
  items.length = 0;
  items.push(...pairs.flat());
  avenueAt.length = 0;
  avenueAt.push({ name: 'Before and after', road, x1: x, count: items.length });
}

// ---- cells to commands ----
const stripState = (b: string) => b.replace(/\[.*$/, '');
/** A building's boxes of one block (grid coordinates), bottom up. */
function boxes(c: Cathedral): Array<{ x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; b: string }> {
  const d = c.design, out: ReturnType<typeof boxes> = [];
  let open = new Map<string, ReturnType<typeof boxes>[number]>();
  for (let y = 0; y < d.height; y++) {
    // runs along x, then merged along z
    const rects: ReturnType<typeof boxes> = [];
    let rowOpen = new Map<string, ReturnType<typeof boxes>[number]>();
    for (let z = 0; z < d.depth; z++) {
      const row = d.layers[y][z], next = new Map<string, ReturnType<typeof boxes>[number]>();
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        const b = ch === '.' ? undefined : d.palette[ch];
        if (!b || b === 'air' || b === 'cave_air') { x++; continue; }
        let x1 = x;
        while (x1 + 1 < row.length && row[x1 + 1] === ch) x1++;
        const k = `${x},${x1},${b}`, r = rowOpen.get(k);
        if (r && r.z1 === z - 1 && (x1 - x + 1) * (z - r.z0 + 1) <= 32768) { r.z1 = z; next.set(k, r); }
        else { const n = { x0: x, x1, y0: y, y1: y, z0: z, z1: z, b }; rects.push(n); next.set(k, n); }
        x = x1 + 1;
      }
      rowOpen = next;
    }
    // merged along y with the layer below's box of the same footprint and block
    const nextOpen = new Map<string, ReturnType<typeof boxes>[number]>();
    for (const r of rects) {
      const k = `${r.x0},${r.x1},${r.z0},${r.z1},${r.b}`, below = open.get(k);
      const vol = (r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1);
      if (below && below.y1 === y - 1 && vol * (y - below.y0 + 1) <= 32768) { below.y1 = y; nextOpen.set(k, below); }
      else { out.push(r); nextOpen.set(k, r); }
    }
    open = nextOpen;
  }
  return out.sort((a, b) => a.y0 - b.y0);
}

const wrap = (s: string, n = 15): string[] => {
  const lines: string[] = [];
  let cur = '';
  for (const w of s.split(/\s+/).filter(Boolean)) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= n) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => (l.length > n ? l.slice(0, n - 1) + '.' : l));
};
const snbt = (s: string) => JSON.stringify(s);
const four = (l: string[]) => [...l, '', '', '', ''].slice(0, 4);
function signCmd(x: number, y: number, z: number, rotation: number, front: string[], back: string[], wood = 'oak'): string {
  const t = (l: string[]) => `{messages:[${four(l).map(snbt).join(',')}]}`;
  return `setblock ${x} ${y} ${z} ${wood}_sign[rotation=${rotation}]{front_text:${t(front)},back_text:${t(back)}} strict`;
}
function itemSign(it: Item): string {
  const [x, y, z] = it.sign!;
  const name = wrap(it.title);
  const civic = it.kind !== 'cathedral' && it.kind !== 'castle';
  const front = civic ? [...name.slice(0, 2), ...wrap(it.place).slice(0, 4 - Math.min(2, name.length))] : [...name.slice(0, 3), `1:${it.scale} ${it.kind}`];
  const back = civic ? [...wrap(it.kind).slice(0, 1), ...wrap(it.built ?? '').slice(0, 2), `1:${it.scale}`] : wrap(it.place).slice(0, 4);
  return signCmd(x, y, z, it.side === 'n' ? 0 : 8, front, back);
}

const total = items.reduce((t, it) => t + boxes(it.c).length, 0);
console.log(`${total} fill commands for ${items.reduce((t, it) => t + it.c.design.blocks, 0)} blocks`);
for (const a of avenueAt) console.log(`  ${a.name}: road z ${a.road}..${a.road + ROAD - 1}, x 0..${a.x1}, ${a.count} buildings`);
if (DRY) {
  for (const it of items) console.log(`  ${it.avenue.padEnd(42)} ${it.id.padEnd(26)} 1:${it.scale} ${it.c.design.width}x${it.c.design.depth}x${it.c.design.height} ${it.c.design.blocks} at ${it.x},${it.z}`);
  process.exit(0);
}

// ---- RCON ----
const props = Object.fromEntries(fs.readFileSync(path.join(SERVER, 'server.properties'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const conns = Array.from({ length: CONNS }, () => new Rcon('127.0.0.1', Number(props['rcon.port']), props['rcon.password']));
const one = conns[0];
let problems = 0;
const problemLines: string[] = [];
const ok = (r: string) => /^(Changed the block|Successfully filled|Could not set the block|No blocks were filled)/.test(r);
/** Run commands over every connection; a command answered "not loaded" is retried after a pause. */
async function runAll(cmds: string[]): Promise<void> {
  let i = 0;
  await Promise.all(conns.map(async (r) => {
    while (i < cmds.length) {
      const cmd = cmds[i++];
      for (let tries = 0; ; tries++) {
        const reply = await r.command(cmd).catch((e) => String(e));
        if (ok(reply)) break;
        if (/not loaded/i.test(reply) && tries < 20) { await new Promise((s) => setTimeout(s, 250)); continue; }
        problems++;
        if (problemLines.length < 30) problemLines.push(`${cmd.slice(0, 160)} -> ${reply.slice(0, 160)}`);
        break;
      }
    }
  }));
}
/** forceload a box (x, z) in pieces of at most 256 chunks; returns the pieces for removal. */
async function forceload(x0: number, z0: number, x1: number, z1: number, add: boolean): Promise<void> {
  const cx0 = x0 >> 4, cx1 = x1 >> 4, cz0 = z0 >> 4, cz1 = z1 >> 4;
  const step = 15;
  for (let cx = cx0; cx <= cx1; cx += step + 1)
    for (let cz = cz0; cz <= cz1; cz += step + 1) {
      const ex = Math.min(cx1, cx + step), ez = Math.min(cz1, cz + step);
      await one.command(`forceload ${add ? 'add' : 'remove'} ${cx * 16} ${cz * 16} ${ex * 16} ${ez * 16}`);
    }
}
/** Air over a box (y from Y0), in slabs of at most 32768 blocks. */
function clearCmds(x0: number, z0: number, x1: number, z1: number, y1: number): string[] {
  const out: string[] = [];
  const per = Math.max(1, Math.floor(32768 / ((x1 - x0 + 1) * (z1 - z0 + 1))));
  if (per >= 1 && (x1 - x0 + 1) * (z1 - z0 + 1) <= 32768) {
    for (let y = Y0; y <= y1; y += per) out.push(`fill ${x0} ${y} ${z0} ${x1} ${Math.min(y1, y + per - 1)} ${z1} air strict`);
  } else {
    for (let x = x0; x <= x1; x += 32) out.push(...clearCmds(x, z0, Math.min(x1, x + 31), z1, y1));
  }
  return out;
}

const t0 = Date.now();
for (const c of [`gamerule advance_time false`, `gamerule advance_weather false`, `gamerule spawn_mobs false`, `gamerule spawn_radius 0`, `time set noon`, `weather clear`, `difficulty peaceful`])
  await one.command(c);

// clear the last build's boxes (a rebuild after presets changed)
fs.mkdirSync(OUT, { recursive: true });
const layoutFile = path.join(OUT, COMPARE.length ? 'layout-compare.json' : 'layout.json');
if (fs.existsSync(layoutFile) && !ONLY.size) {
  const old = JSON.parse(fs.readFileSync(layoutFile, 'utf8')) as Array<{ box: [number, number, number, number, number] }>;
  console.log(`clearing ${old.length} boxes of the last build`);
  for (const o of old) {
    const [x0, z0, x1, z1, y1] = o.box;
    await forceload(x0, z0, x1, z1, true);
    await runAll(clearCmds(x0, z0, x1, z1, y1));
    await forceload(x0, z0, x1, z1, false);
  }
}

// the spine road, the spawn platform and the legend (compare mode: only the spine from its avenue to the spawn)
if (COMPARE.length) {
  const a = avenueAt[0];
  await forceload(SPINE_X - 3, a.road, SPINE_X + 3, SPAWN[2], true);
  await runAll([`fill ${SPINE_X - 2} ${GROUND} ${a.road} ${SPINE_X + 2} ${GROUND} ${SPAWN[2]} polished_andesite strict`]);
  await forceload(SPINE_X - 3, a.road, SPINE_X + 3, SPAWN[2], false);
} else {
  const zEnd = avenueAt[avenueAt.length - 1].road + ROAD - 1;
  await forceload(SPINE_X - 12, SPAWN[2] - 8, SPINE_X + 12, zEnd, true);
  const cmds: string[] = [];
  for (let z = SPAWN[2]; z <= zEnd; z += 64) cmds.push(`fill ${SPINE_X - 2} ${GROUND} ${z} ${SPINE_X + 2} ${GROUND} ${Math.min(zEnd, z + 63)} polished_andesite strict`);
  cmds.push(`fill ${SPINE_X - 6} ${GROUND} ${SPAWN[2] - 6} ${SPINE_X + 6} ${GROUND} ${SPAWN[2] + 6} smooth_stone strict`);
  cmds.push(`fill ${SPINE_X - 6} ${GROUND} ${SPAWN[2] - 6} ${SPINE_X + 6} ${GROUND} ${SPAWN[2] - 6} chiseled_stone_bricks strict`);
  await runAll(cmds);
  // the legend: a row of signs on the platform's north edge, facing south
  const legend: string[][] = [
    ['Building gallery', `${monuments} monuments 1:3`, `${items.length - monuments} civic`, 'Walk south'],
    ...avenueAt.map((a) => [...wrap(a.name.replace(/^Civic: /, 'Civic: ')).slice(0, 2), `${a.count} buildings`, `road z ${a.road + 2}`]),
  ];
  const signs = legend.map((l, k) => signCmd(SPINE_X - Math.floor(legend.length / 2) + k, Y0, SPAWN[2] - 5, 0, l, []));
  await runAll(signs);
  await one.command(`setworldspawn ${SPAWN[0]} ${Y0} ${SPAWN[2]}`);
  await forceload(SPINE_X - 12, SPAWN[2] - 8, SPINE_X + 12, zEnd, false);
}

// each avenue: its road and entrance sign, then its buildings with their signs
const layout: Array<Record<string, unknown>> = [];
let placed = 0;
for (const a of avenueAt) {
  const list = items.filter((i) => i.avenue === a.name);
  const roadCmds: string[] = [];
  for (let x = SPINE_X; x <= a.x1; x += 64) roadCmds.push(`fill ${x} ${GROUND} ${a.road} ${Math.min(a.x1, x + 63)} ${GROUND} ${a.road + ROAD - 1} polished_andesite strict`);
  for (let x = SPINE_X; x <= a.x1; x += 512) {
    await forceload(x, a.road - 2, Math.min(a.x1, x + 511), a.road + ROAD + 1, true);
    await runAll(roadCmds.filter((c) => { const cx = Number(c.split(' ')[1]); return cx >= x && cx < x + 512; }));
    if (x === SPINE_X) await runAll([signCmd(-4, Y0, a.road - 1, 0, [...wrap(a.name).slice(0, 3), `${a.count} buildings`], [])]);
    await forceload(x, a.road - 2, Math.min(a.x1, x + 511), a.road + ROAD + 1, false);
  }
  for (const it of list) {
    const d = it.c.design, x0 = it.x!, z0 = it.z!;
    const x1 = x0 + d.width - 1, z1 = z0 + d.depth - 1;
    const bx0 = Math.min(x0, it.sign![0]) - 1, bz0 = Math.min(z0, it.sign![2]) - 1, bx1 = Math.max(x1, it.sign![0]) + 1, bz1 = Math.max(z1, it.sign![2]) + 1;
    layout.push({ id: it.id, box: [x0, z0, x1, z1, Y0 + d.height - 1] });
    if (ONLY.size && !ONLY.has(it.id)) continue;
    const t = Date.now(), before = problems;
    await forceload(bx0, bz0, bx1, bz1, true);
    const bs = boxes(it.c);
    await runAll(bs.map((b) => `fill ${x0 + b.x0} ${Y0 + b.y0} ${z0 + b.z0} ${x0 + b.x1} ${Y0 + b.y1} ${z0 + b.z1} ${b.b} strict`));
    await runAll([itemSign(it)]);
    // spot-check: the first, the middle and the last cell drawn (the block's name, states aside)
    const cells: Array<[number, number, number, string]> = [];
    d.layers.forEach((layer, y) => layer.forEach((row, z) => { for (let x = 0; x < row.length; x++) { const b = row[x] === '.' ? undefined : d.palette[row[x]]; if (b && b !== 'air') cells.push([x, y, z, b]); } }));
    const picks = [cells[0], cells[cells.length >> 1], cells[cells.length - 1]];
    let checks = 0;
    for (const [x, y, z, b] of picks) {
      const r = await one.command(`execute if block ${x0 + x} ${Y0 + y} ${z0 + z} ${stripState(b)}`);
      if (/passed/i.test(r)) checks++;
      else { problems++; problemLines.push(`${it.id}: ${stripState(b)} not at ${x0 + x} ${Y0 + y} ${z0 + z}: ${r}`); }
    }
    await forceload(bx0, bz0, bx1, bz1, false);
    placed++;
    console.log(`[${placed}] ${it.avenue} / ${it.id} 1:${it.scale}: ${d.blocks} blocks in ${bs.length} fills, ${((Date.now() - t) / 1000).toFixed(1)} s, checks ${checks}/3${problems > before ? `, ${problems - before} problems` : ''}`);
  }
}
for (const r of conns) (r as unknown as { socket?: { destroy(): void } }).socket?.destroy();

// ---- the index ----
const tp = (it: Item) => {
  const [sx, , sz] = it.sign!;
  return it.side === 'n' ? `/tp @s ${sx} ${Y0} ${sz + 3} 180 0` : `/tp @s ${sx} ${Y0} ${sz - 3} 0 0`;
};
const md: string[] = [
  `# Building gallery (${today})`, '',
  `Server: 127.0.0.1:25571 (LAN 192.168.1.84:25571), superflat, creative, always day, no mobs; mc/gallery. Built by \`scripts/gallery.mts\`.`,
  `${items.length} buildings: ${monuments} monuments at 1:3 (cathedrals with the detailed palette, furnishing, copper roof and accents), ${items.length - monuments} civic buildings at the civic tier's scale.`, '',
  `Spawn and legend: \`/tp @s ${SPAWN[0]} ${Y0} ${SPAWN[2]}\`. The spine road runs south along x = ${SPINE_X}; each avenue's road runs east from it.`, '',
  '## Avenues', '', '| Avenue | Buildings | Teleport (avenue start) | Road |', '|---|---|---|---|',
  ...avenueAt.map((a) => `| ${a.name} | ${a.count} | \`/tp @s -6 ${Y0} ${a.road + 2} -90 0\` | z ${a.road}-${a.road + ROAD - 1}, x 0-${a.x1} |`), '',
];
for (const a of avenueAt) {
  md.push(`## ${a.name}`, '', '| Building | Kind | Place | Scale | Size (w x d x h) | Blocks | Corner (x, z) | Side | Teleport |', '|---|---|---|---|---|---|---|---|---|');
  for (const it of items.filter((i) => i.avenue === a.name)) {
    const d = it.c.design;
    md.push(`| ${it.title} (\`${it.id}\`) | ${it.kind} | ${it.place.replace(/\|/g, '/')}${it.built ? `, ${it.built}` : ''} | 1:${it.scale} | ${d.width} x ${d.depth} x ${d.height} | ${d.blocks} | ${it.x}, ${it.z} | ${it.side === 'n' ? 'north' : 'south'} | \`${tp(it)}\` |`);
  }
  md.push('');
}
fs.writeFileSync(path.join(OUT, COMPARE.length ? 'compare.md' : 'index.md'), md.join('\n') + '\n');
if (!ONLY.size) fs.writeFileSync(layoutFile, JSON.stringify(layout));
const placedMon = items.filter((i) => i.kind === 'cathedral' || i.kind === 'castle').length;
console.log(`placed ${placed} buildings (${placedMon} monuments, ${items.length - placedMon} civic) in ${((Date.now() - t0) / 60000).toFixed(1)} min; ${problems} problems`);
for (const l of problemLines) console.log('  ' + l);
console.log(`index: ${path.join(OUT, COMPARE.length ? 'compare.md' : 'index.md')}`);
process.exit(problems ? 1 : 0);
