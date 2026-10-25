/**
 * The monument's blocks standing in the world (#150): every cell of the cathedral's jobs (monument.ts jobTargets, as
 * build_monument placed them, states turned) tested by command (`execute if block`, lesson 4), per job and stage; then
 * the share that stands of the jobs recorded done, and of the whole design. Needs the test world's Paper running.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/monument_standing.mts SERVER_DIR VILLAGE
 *        (e.g. mc/testserver4 G1: its villages.json and its server.properties' RCON port and password)
 *        OUT=FILE.json also writes the cells that stand, as a design JSON for scripts/render_design.py.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Rcon } from '../../server/src/mineflayer/rcon';
import { GOTHIC_STAGES } from '../../server/src/gothicGen';
import { jobTargets, monumentPlan } from '../../server/src/monument';
import { turnState } from '../../server/src/designs';
import type { Village } from '../../server/src/village';

const [dir, name] = process.argv.slice(2);
if (!dir || !name) {
  console.log('usage: monument_standing.mts SERVER_DIR VILLAGE');
  process.exit(2);
}
const props = Object.fromEntries(fs.readFileSync(path.join(dir, 'server.properties'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const vs = JSON.parse(fs.readFileSync(path.join(dir, 'villages.json'), 'utf8')).villages as Village[];
const v = vs.find((x) => x.name.toLowerCase() === name.toLowerCase());
const m = v?.monument;
if (!m?.site) {
  console.log(`no monument with a site in ${name}`);
  process.exit(1);
}
const plan = monumentPlan(m);
const rcon = new Rcon('127.0.0.1', Number(props['rcon.port']), props['rcon.password']);
const byStage = new Map<number, { done: number; stand: number; cells: number }>();
let standDone = 0, cellsDone = 0, standAll = 0;
const standing: Array<{ x: number; y: number; z: number; block: string }> = [];
for (let i = 0; i < plan.jobs.length; i++) {
  const j = plan.jobs[i];
  const done = m.done.includes(i);
  let stand = 0;
  const cells = jobTargets(m, i, turnState);
  for (const c of cells) {
    const r = await rcon.command(`execute if block ${c.x} ${c.y} ${c.z} minecraft:${c.block}`);
    if (/passed/i.test(r)) {
      stand++;
      standing.push(c);
    }
  }
  const s = byStage.get(j.stage) ?? { done: 0, stand: 0, cells: 0 };
  s.stand += stand;
  s.cells += cells.length;
  if (done) s.done++;
  byStage.set(j.stage, s);
  standAll += stand;
  if (done) {
    standDone += stand;
    cellsDone += cells.length;
  }
  console.log(`job ${i} (stage ${j.stage}${done ? ', done' : ''}): ${stand} of ${cells.length} stand`);
}
for (const [st, s] of [...byStage].sort((a, b) => a[0] - b[0])) console.log(`stage ${st} ${GOTHIC_STAGES[st - 1]}: ${s.stand} of ${s.cells} stand`);
const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : '-');
console.log(`site ${JSON.stringify(m.site)}; jobs done ${m.done.length} of ${plan.jobs.length}`);
console.log(`standing: ${standDone} of ${cellsDone} cells of the jobs done (${pct(standDone, cellsDone)}%); ${standAll} of ${plan.design.blocks} of the whole design (${pct(standAll, plan.design.blocks)}%)`);
if (process.env.OUT) {
  // (the standing cells as a design in world order, for the renderer: x west to east, rows north to south)
  const xs = standing.map((c) => c.x), ys = standing.map((c) => c.y), zs = standing.map((c) => c.z);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), z0 = Math.min(...zs);
  const W = Math.max(...xs) - x0 + 1, H = Math.max(...ys) - y0 + 1, D = Math.max(...zs) - z0 + 1;
  const blocks = [...new Set(standing.map((c) => c.block))];
  const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+-=<>?@!~^:;,(){}[]|/';
  const layers = Array.from({ length: H }, () => Array.from({ length: D }, () => new Array<string>(W).fill('.')));
  for (const c of standing) layers[c.y - y0][c.z - z0][c.x - x0] = CH[blocks.indexOf(c.block)];
  fs.writeFileSync(process.env.OUT, JSON.stringify({ name: `${name}_cathedral_standing`, palette: Object.fromEntries(blocks.map((b, i) => [CH[i], b])), layers: layers.map((l) => l.map((r) => r.join(''))), width: W, depth: D, height: H }));
  console.log(`wrote ${process.env.OUT} (${W}x${D}x${H}, corner ${x0},${y0},${z0})`);
}
process.exit(0);
